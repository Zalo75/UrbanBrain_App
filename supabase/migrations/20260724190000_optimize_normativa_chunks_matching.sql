-- Replace the name-based municipal RAG scan with an exact INE-code lookup.
-- The B-tree predicate narrows the corpus before the exact pgvector ranking.

begin;

do $block$
begin
  if not exists (
    select 1
    from pg_catalog.pg_extension
    where extname = 'vector'
      and (
        split_part(extversion, '.', 1)::integer > 0
        or split_part(extversion, '.', 2)::integer >= 8
      )
  ) then
    raise exception 'pgvector 0.8.0 or newer is required';
  end if;

  if to_regclass('public.normativa_chunks') is null then
    raise exception 'public.normativa_chunks is required';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.normativa_chunks'::regclass
      and attribute.attname = 'municipio_codigo'
      and not attribute.attisdropped
  ) then
    raise exception 'public.normativa_chunks.municipio_codigo is required';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.normativa_chunks'::regclass
      and attribute.attname = 'embedding'
      and not attribute.attisdropped
  ) then
    raise exception 'public.normativa_chunks.embedding is required';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index as index_entry
    inner join pg_catalog.pg_class as index_relation
      on index_relation.oid = index_entry.indexrelid
    inner join pg_catalog.pg_am as access_method
      on access_method.oid = index_relation.relam
    where index_entry.indrelid = 'public.normativa_chunks'::regclass
      and index_entry.indisvalid
      and index_entry.indisready
      and access_method.amname = 'btree'
      and pg_catalog.pg_get_indexdef(index_entry.indexrelid, 1, true) = 'municipio_codigo'
  ) then
    raise exception 'A valid B-tree index beginning with municipio_codigo is required';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'service_role'
      and rolbypassrls
  ) then
    raise exception 'service_role must exist with BYPASSRLS';
  end if;
end;
$block$;

create index if not exists normativa_chunks_embedding_hnsw_cosine_idx
  on public.normativa_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

do $block$
begin
  if not exists (
    select 1
    from pg_catalog.pg_index as index_entry
    where index_entry.indexrelid =
        to_regclass('public.normativa_chunks_embedding_hnsw_cosine_idx')
      and index_entry.indisvalid
      and index_entry.indisready
      and pg_catalog.pg_get_indexdef(index_entry.indexrelid)
        like '%USING hnsw (embedding vector_cosine_ops)%'
  ) then
    raise exception 'The normativa_chunks cosine HNSW index is not valid and ready';
  end if;
end;
$block$;

drop function if exists public.match_normativa_chunks(vector, integer, text);

create function public.match_normativa_chunks(
  query_embedding vector(768),
  match_count integer default 10,
  filter_municipio_codigo text default null
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
    where filter_municipio_codigo is not null
      and nc.municipio_codigo = filter_municipio_codigo
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
  on function public.match_normativa_chunks(vector, integer, text)
  from public, anon, authenticated;
grant execute
  on function public.match_normativa_chunks(vector, integer, text)
  to service_role;

comment on function public.match_normativa_chunks(vector, integer, text) is
  'Server-only exact municipal normative retrieval by five-digit INE code.';

notify pgrst, 'reload schema';

commit;
