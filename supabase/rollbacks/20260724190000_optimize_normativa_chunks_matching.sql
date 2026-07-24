-- Restore the previous name-based RPC while keeping it server-only.

begin;

do $block$
begin
  if to_regclass('public.normativa_chunks') is null then
    raise exception 'public.normativa_chunks is required';
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

drop function if exists public.match_normativa_chunks(vector, integer, text);

create function public.match_normativa_chunks(
  query_embedding vector(768),
  match_count integer default 10,
  filter_municipio text default null
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
as $function$
  select
    nc.chunk_id,
    nc.municipio_nombre,
    nc.nombre_pdf,
    nc.titulo_detectado,
    nc.texto,
    1 - (nc.embedding <=> query_embedding) as similarity,
    nc.ruta_pdf as original_path,
    substring(nc.texto from '--- PAGINA (\d+) ---') as pagina_detectada,
    trim(substring(replace(nc.texto, E'\n', ' '), 1, 150)) || '...' as fragmento_corto
  from public.normativa_chunks as nc
  where filter_municipio is null
    or nc.municipio_nombre ilike '%' || filter_municipio || '%'
  order by nc.embedding <=> query_embedding
  limit match_count;
$function$;

revoke all privileges
  on function public.match_normativa_chunks(vector, integer, text)
  from public, anon, authenticated;
grant execute
  on function public.match_normativa_chunks(vector, integer, text)
  to service_role;

drop index if exists public.normativa_chunks_embedding_hnsw_cosine_idx;

notify pgrst, 'reload schema';

commit;
