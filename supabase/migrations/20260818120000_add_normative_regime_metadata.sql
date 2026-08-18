-- Migration to add structured normative regime metadata

-- 1. Add metadata column to normative_chunks_v2 (V1 already has it, but it might be null)
ALTER TABLE public.normative_chunks_v2 ADD COLUMN metadata jsonb;

-- 2. Update RPC to return metadata
DROP FUNCTION IF EXISTS public.match_normativa_chunks_scoped(vector, integer, text, text[], text);

CREATE OR REPLACE FUNCTION public.match_normativa_chunks_scoped(
  query_embedding vector(768),
  match_count integer default 10,
  filter_municipio_codigo text default null,
  filter_document_names text[] default null,
  filter_ordinance text default null
)
RETURNS table (
  chunk_id text,
  municipio_nombre text,
  nombre_pdf text,
  titulo_detectado text,
  texto text,
  similarity double precision,
  original_path text,
  pagina_detectada text,
  fragmento_corto text,
  metadata jsonb -- <-- NEW COLUMN
)
LANGUAGE sql STABLE SECURITY invoker
SET search_path = pg_catalog, public, extensions
SET hnsw.iterative_scan = strict_order
SET hnsw.ef_search = 100
SET hnsw.max_scan_tuples = 50000
SET hnsw.scan_mem_multiplier = 2
AS $function$
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
    trim(substring(replace(nc.texto, E'\n', ' '), 1, 150)) || '...' as fragmento_corto,
    nc.metadata -- <-- RETURN METADATA
  from ranked
  inner join public.normativa_chunks as nc
    on nc.id = ranked.id
  order by ranked.distance;
$function$;

-- Update permissions
REVOKE ALL PRIVILEGES ON FUNCTION public.match_normativa_chunks_scoped(vector, integer, text, text[], text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_normativa_chunks_scoped(vector, integer, text, text[], text) TO service_role;

COMMENT ON FUNCTION public.match_normativa_chunks_scoped(vector, integer, text, text[], text) IS
  'Server-only scoped normative retrieval returning structured regime metadata.';

-- 3. Update match_normativa_chunks to also return metadata
DROP FUNCTION IF EXISTS public.match_normativa_chunks(vector, integer, text);

CREATE OR REPLACE FUNCTION public.match_normativa_chunks(
  query_embedding vector(768),
  match_count integer default 10,
  filter_municipio_codigo text default null
)
RETURNS table (
  chunk_id text,
  municipio_nombre text,
  nombre_pdf text,
  titulo_detectado text,
  texto text,
  similarity double precision,
  original_path text,
  pagina_detectada text,
  fragmento_corto text,
  metadata jsonb -- <-- NEW COLUMN
)
LANGUAGE sql STABLE SECURITY invoker
SET search_path = pg_catalog, public, extensions
SET hnsw.iterative_scan = strict_order
SET hnsw.ef_search = 100
SET hnsw.max_scan_tuples = 50000
SET hnsw.scan_mem_multiplier = 2
AS $function$
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
    trim(substring(replace(nc.texto, E'\n', ' '), 1, 150)) || '...' as fragmento_corto,
    nc.metadata -- <-- RETURN METADATA
  from ranked
  inner join public.normativa_chunks as nc
    on nc.id = ranked.id
  order by ranked.distance;
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.match_normativa_chunks(vector, integer, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_normativa_chunks(vector, integer, text) TO service_role;

COMMENT ON FUNCTION public.match_normativa_chunks(vector, integer, text) IS
  'Server-only exact municipal normative retrieval returning structured regime metadata.';

