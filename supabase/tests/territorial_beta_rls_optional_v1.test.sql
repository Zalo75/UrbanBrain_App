-- Dedicated drift scenario executed with psql against an ephemeral Supabase
-- PostgreSQL database. It intentionally does not replay historical migrations.
-- `normativa_documents` is absent while V1 chunks and both V2 tables exist.

\set ON_ERROR_STOP on

set search_path = public, extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pgtap with schema extensions;

create table public.organizations (
  id uuid primary key,
  name text not null,
  slug text unique not null
);
create table public.profiles (
  id uuid primary key,
  full_name text
);
create table public.organization_members (
  org_id uuid not null references public.organizations(id),
  profile_id uuid not null references public.profiles(id),
  role text not null
);
create table public.expedientes (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  name text not null,
  municipio text not null
);
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  expediente_id uuid not null references public.expedientes(id),
  user_id uuid not null references public.profiles(id),
  role text not null,
  content text not null
);
create table public.context_detections (
  id uuid primary key default gen_random_uuid(),
  expediente_id uuid not null references public.expedientes(id),
  summary jsonb not null,
  source_apis jsonb not null
);
create table public.afeccion_types (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  name text not null
);
create table public.expediente_afecciones (
  id uuid primary key default gen_random_uuid(),
  expediente_id uuid not null references public.expedientes(id),
  afeccion_type_id uuid not null references public.afeccion_types(id),
  status text not null
);
create table public.municipal_planning (
  id uuid primary key default gen_random_uuid(),
  province_id text not null,
  municipality_id text not null,
  name text not null,
  status text not null
);

-- Deliberate operational drift: V1 chunks survived without their metadata table.
create table public.normativa_chunks (
  id uuid primary key default gen_random_uuid(),
  content text not null
);
create table public.normative_documents_v2 (
  id uuid primary key default gen_random_uuid(),
  title text not null
);
create table public.normative_chunks_v2 (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.normative_documents_v2(id),
  content text not null
);

create function public.match_normativa_chunks(
  query_embedding vector,
  match_count integer,
  filter_municipio text
)
returns table (id uuid)
language sql
security definer
set search_path = public, extensions
as $function$
  select nc.id
  from public.normativa_chunks as nc
  where filter_municipio is not null
  limit greatest(match_count, 0);
$function$;

insert into public.organizations (id, name, slug)
values
  ('a1000000-0000-4000-8000-000000000001', 'Optional V1 organization A', 'optional-v1-a'),
  ('b1000000-0000-4000-8000-000000000001', 'Optional V1 organization B', 'optional-v1-b');
insert into public.profiles (id, full_name)
values
  ('a1000000-0000-4000-8000-000000000002', 'Optional V1 user A'),
  ('b1000000-0000-4000-8000-000000000002', 'Optional V1 user B');
insert into public.organization_members (org_id, profile_id, role)
values
  ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'owner'),
  ('b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'owner');
insert into public.expedientes (id, org_id, name, municipio)
values
  ('a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'Optional V1 expediente A', 'betanzos'),
  ('b1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000001', 'Optional V1 expediente B', 'betanzos');
insert into public.chat_messages (id, expediente_id, user_id, role, content)
values
  ('a1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002', 'user', 'optional fixture A'),
  ('b1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000002', 'user', 'optional fixture B');

-- Simulate the broad Data API defaults found before hardening.
grant all privileges on all tables in schema public to anon, authenticated, service_role;
grant execute on function public.match_normativa_chunks(vector, integer, text)
  to public, anon, authenticated, service_role;

-- Apply the exact migration twice: the second application proves idempotency.
\ir ../migrations/20260714130000_harden_territorial_beta_rls.sql
\ir ../migrations/20260714130000_harden_territorial_beta_rls.sql

select extensions.no_plan();

select extensions.ok(
  to_regclass('public.normativa_documents') is null,
  'V1 document metadata is deliberately absent'
);
select extensions.ok(
  to_regclass('public.normativa_chunks') is not null,
  'V1 chunks remain present'
);
select extensions.ok(
  to_regclass('public.normative_documents_v2') is not null
    and to_regclass('public.normative_chunks_v2') is not null,
  'both V2 relations are present'
);

select extensions.ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where oid = 'public.normativa_chunks'::regclass),
  'existing V1 chunks have forced RLS'
);
select extensions.ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where oid = 'public.normative_documents_v2'::regclass),
  'existing V2 documents have forced RLS'
);
select extensions.ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where oid = 'public.normative_chunks_v2'::regclass),
  'existing V2 chunks have forced RLS'
);

select extensions.ok(
  not has_table_privilege('anon', 'public.normativa_chunks', 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated', 'public.normativa_chunks', 'SELECT,INSERT,UPDATE,DELETE'),
  'browser roles cannot access existing V1 chunks directly'
);
select extensions.ok(
  not has_table_privilege('anon', 'public.normative_documents_v2', 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated', 'public.normative_documents_v2', 'SELECT,INSERT,UPDATE,DELETE'),
  'browser roles cannot access V2 documents directly'
);
select extensions.ok(
  not has_table_privilege('anon', 'public.normative_chunks_v2', 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated', 'public.normative_chunks_v2', 'SELECT,INSERT,UPDATE,DELETE'),
  'browser roles cannot access V2 chunks directly'
);
select extensions.ok(
  not has_table_privilege('anon', 'public.chat_messages', 'SELECT,INSERT,UPDATE,DELETE'),
  'anon cannot access tenant chat'
);

set role anon;
select extensions.throws_ok(
  $$select id from public.normativa_chunks limit 1$$,
  '42501',
  'permission denied for table normativa_chunks',
  'anon cannot read V1 chunks'
);
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',
  false
);
select extensions.results_eq(
  $$select content from public.chat_messages order by content$$,
  array['optional fixture A'::text],
  'authenticated user A reads only organization A chat'
);
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config(
  'request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated"}',
  false
);
select extensions.results_eq(
  $$select content from public.chat_messages order by content$$,
  array['optional fixture B'::text],
  'authenticated user B reads only organization B chat'
);
reset role;

set role authenticated;
select extensions.throws_ok(
  $$select id from public.normativa_chunks limit 1$$,
  '42501',
  'permission denied for table normativa_chunks',
  'authenticated cannot read V1 chunks directly'
);
reset role;

select extensions.ok(
  has_table_privilege('service_role', 'public.normativa_chunks', 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role retains V1 chunk DML'
);
select extensions.ok(
  has_table_privilege('service_role', 'public.normative_documents_v2', 'SELECT,INSERT,UPDATE,DELETE')
    and has_table_privilege('service_role', 'public.normative_chunks_v2', 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role retains V2 DML'
);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.match_normativa_chunks(vector,integer,text)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'authenticated',
      'public.match_normativa_chunks(vector,integer,text)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.match_normativa_chunks(vector,integer,text)',
      'EXECUTE'
    ),
  'only service_role can execute the RAG RPC'
);

set role service_role;
select extensions.lives_ok(
  $$select * from public.match_normativa_chunks(null, 0, '__optional_v1_test__')$$,
  'RAG remains callable through the trusted server channel'
);
reset role;

-- Exercise the exact fail-closed rollback against the same drifted schema.
\ir ../rollbacks/20260714130000_harden_territorial_beta_rls_fail_closed.sql

select extensions.ok(
  to_regclass('public.normativa_documents') is null
    and to_regclass('public.normativa_chunks') is not null,
  'rollback tolerates the same absent/present V1 combination'
);
select extensions.ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where oid = 'public.normativa_chunks'::regclass),
  'rollback leaves existing V1 chunks fail-closed'
);
select extensions.ok(
  not has_table_privilege('anon', 'public.normativa_chunks', 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated', 'public.normativa_chunks', 'SELECT,INSERT,UPDATE,DELETE'),
  'rollback leaves browser roles blocked from V1 chunks'
);
select extensions.ok(
  not has_table_privilege('anon', 'public.chat_messages', 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated', 'public.chat_messages', 'SELECT,INSERT,UPDATE,DELETE'),
  'rollback leaves tenant chat closed to browser roles'
);
select extensions.ok(
  has_table_privilege('service_role', 'public.normativa_chunks', 'SELECT,INSERT,UPDATE,DELETE')
    and has_table_privilege('service_role', 'public.normative_chunks_v2', 'SELECT,INSERT,UPDATE,DELETE'),
  'rollback preserves the server RAG tables'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.match_normativa_chunks(vector,integer,text)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'authenticated',
      'public.match_normativa_chunks(vector,integer,text)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.match_normativa_chunks(vector,integer,text)',
      'EXECUTE'
    ),
  'rollback keeps the RPC server-only'
);
select extensions.ok(
  to_regprocedure('public.urbanbrain_can_access_expediente(uuid)') is null,
  'rollback removes the tenant helper after dropping its policies'
);

select * from extensions.finish();
