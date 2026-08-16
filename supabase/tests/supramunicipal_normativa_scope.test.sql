-- Contract test for optional municipal scoping in match_normativa_chunks_scoped.
-- Fixtures are synthetic and no normativa_chunks rows are modified.

begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

select extensions.ok(
  position(
    '(filter_municipio_codigo is null or nc.municipio_codigo = filter_municipio_codigo)'
    in lower(pg_get_functiondef(
      'public.match_normativa_chunks_scoped(vector,integer,text,text[],text)'::regprocedure
    ))
  ) > 0,
  'the deployed RPC uses an optional exact municipal predicate'
);

with fixture(chunk_id, municipio_codigo, nombre_pdf) as (
  values
    ('municipal-ames', '15002', 'PXOM_Ames.pdf'),
    ('municipal-sada', '15075', 'PXOM_Sada.pdf'),
    ('autonomic-lsg', null::text, 'LSG CONSOLIDADA ENERO 2026- V2.pdf'),
    ('sectorial-roads', null::text, 'Lei_8_2013_Estradas_Galicia.pdf')
)
select extensions.ok(
  (select array_agg(chunk_id order by chunk_id)
   from fixture
   where ('15002'::text is null or municipio_codigo = '15002'))
    = array['municipal-ames']::text[],
  'a municipal INE code returns only the matching municipality'
);

with fixture(chunk_id, municipio_codigo, nombre_pdf) as (
  values
    ('municipal-ames', '15002', 'PXOM_Ames.pdf'),
    ('autonomic-lsg', null::text, 'LSG CONSOLIDADA ENERO 2026- V2.pdf'),
    ('sectorial-roads', null::text, 'Lei_8_2013_Estradas_Galicia.pdf')
)
select extensions.ok(
  (select count(*) from fixture
   where (null::text is null or municipio_codigo = null::text)) = 3,
  'NULL permits municipal and supramunicipal rows before document scoping'
);

with fixture(chunk_id, municipio_codigo, nombre_pdf) as (
  values
    ('municipal-ames', '15002', 'PXOM_Ames.pdf'),
    ('autonomic-lsg', null::text, 'LSG CONSOLIDADA ENERO 2026- V2.pdf'),
    ('sectorial-roads', null::text, 'Lei_8_2013_Estradas_Galicia.pdf')
)
select extensions.ok(
  (select array_agg(chunk_id order by chunk_id)
   from fixture
   where (null::text is null or municipio_codigo = null::text)
     and nombre_pdf = any(array['LSG CONSOLIDADA ENERO 2026- V2.pdf']::text[]))
    = array['autonomic-lsg']::text[],
  'NULL plus an LSG allowlist returns only the permitted LSG document'
);

with fixture(chunk_id, municipio_codigo, nombre_pdf) as (
  values
    ('municipal-ames', '15002', 'PXOM_Ames.pdf'),
    ('autonomic-lsg', null::text, 'LSG CONSOLIDADA ENERO 2026- V2.pdf')
)
select extensions.ok(
  (select count(*) from fixture
   where (''::text is null or municipio_codigo = '')) = 0,
  'an empty string remains a literal filter and is not the no-filter sentinel'
);

with fixture(chunk_id, municipio_codigo) as (
  values
    ('autonomic-lsg', null::text),
    ('sectorial-roads', null::text)
)
select extensions.ok(
  (select count(*) from fixture
   where ''::text is not null and municipio_codigo = '') = 0
  and
  (select count(*) from fixture
   where null::text is null or municipio_codigo = null::text) = 2,
  'the former empty-string contract loses supramunicipal rows while NULL recovers them'
);

select * from extensions.finish();
rollback;
