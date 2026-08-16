-- Make the municipal constraint optional for explicitly scoped supramunicipal
-- retrieval. NULL disables municipal filtering for supramunicipal retrieval;
-- an empty string remains a literal municipal code and is not a sentinel.

begin;

do $block$
begin
  if to_regclass('public.normativa_chunks') is null then
    raise exception 'Required table public.normativa_chunks does not exist';
  end if;
  if to_regclass('public.normativa_chunks_embedding_hnsw_cosine_idx') is null then
    raise exception 'Required HNSW index normativa_chunks_embedding_hnsw_cosine_idx does not exist';
  end if;
end;
$block$;

-- Loading the pgvector library in this session registers its user-settable
-- HNSW parameters before CREATE FUNCTION validates the per-function SET clauses.
select '[1]'::vector <=> '[1]'::vector;

create or replace function public.match_normativa_chunks_scoped(
  query_embedding vector(768),
  match_count integer default 10,
  filter_municipio_codigo text default null,
  filter_document_names text[] default null,
  filter_ordinance text default null
)
returns table (
  chunk_id text,
  municipio_nombre text,
  nombre_pdf text,
  titulo_detectado text,
  texto text,
  similarity double precision,
  original_path text,
  pagina_detectada text,
  fragmento_corto text
)
language sql
stable
security invoker
set search_path = pg_catalog, public, extensions
set hnsw.iterative_scan = strict_order
set hnsw.ef_search = 100
set hnsw.max_scan_tuples = 50000
set hnsw.scan_mem_multiplier = 2
as $function$
  with candidates as materialized (
    select
      nc.id,
      nc.embedding <=> query_embedding as distance
    from public.normativa_chunks as nc
    where (filter_municipio_codigo is null or nc.municipio_codigo = filter_municipio_codigo)
      and (
        filter_document_names is null
        or cardinality(filter_document_names) = 0
        or nc.nombre_pdf = any(filter_document_names)
      )
      and (
        filter_ordinance is null
        or btrim(filter_ordinance) = ''
        or position(
          lower(btrim(filter_ordinance))
          in lower(concat_ws(E'\n', nc.titulo_detectado, nc.texto))
        ) > 0
      )
    order by nc.embedding <=> query_embedding
    limit greatest(match_count * 8, 64)
  ),
  ranked as materialized (
    select candidates.id, candidates.distance
    from candidates
    order by candidates.distance
    limit match_count
  )
  select
    nc.chunk_id,
    nc.municipio_nombre,
    nc.nombre_pdf,
    nc.titulo_detectado,
    nc.texto,
    1 - ranked.distance as similarity,
    nc.ruta_pdf as original_path,
    substring(nc.texto from '--- PAGINA (\d+) ---') as pagina_detectada,
    trim(substring(replace(nc.texto, E'\n', ' '), 1, 150)) || '...' as fragmento_corto
  from ranked
  inner join public.normativa_chunks as nc
    on nc.id = ranked.id
  order by ranked.distance;
$function$;

revoke all privileges
  on function public.match_normativa_chunks_scoped(vector, integer, text, text[], text)
  from public, anon, authenticated;
grant execute
  on function public.match_normativa_chunks_scoped(vector, integer, text, text[], text)
  to service_role;

comment on function public.match_normativa_chunks_scoped(vector, integer, text, text[], text) is
  'Server-only scoped normative retrieval. A municipal INE code filters strictly; NULL permits document-scoped supramunicipal retrieval.';

notify pgrst, 'reload schema';

commit;
