-- Integration specification for `supabase test db` on an ephemeral database.
-- It creates isolated fixtures inside a transaction and always rolls them back.

begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into public.organizations (id, name, slug)
values
  ('a0000000-0000-4000-8000-000000000001', 'RLS test organization A', 'rls-test-org-a'),
  ('b0000000-0000-4000-8000-000000000001', 'RLS test organization B', 'rls-test-org-b');

insert into public.profiles (id, full_name)
values
  ('a0000000-0000-4000-8000-000000000002', 'RLS test user A'),
  ('b0000000-0000-4000-8000-000000000002', 'RLS test user B');

insert into public.organization_members (org_id, profile_id, role)
values
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'owner'),
  ('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'owner');

insert into public.expedientes (id, org_id, name, municipio)
values
  ('a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'RLS expediente A', 'betanzos'),
  ('b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'RLS expediente B', 'betanzos');

insert into public.chat_messages (id, expediente_id, user_id, role, content)
values
  ('a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 'user', 'fixture A'),
  ('b0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 'user', 'fixture B');

insert into public.context_detections (
  id, expediente_id, summary, source_apis
)
values
  ('a0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000003', '{}'::jsonb, '[]'::jsonb),
  ('b0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000003', '{}'::jsonb, '[]'::jsonb);

insert into public.afeccion_types (id, category, name)
values ('a0000000-0000-4000-8000-000000000006', 'test', 'RLS test constraint');

insert into public.expediente_afecciones (
  id, expediente_id, afeccion_type_id, status
)
values
  ('a0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000006', 'detected'),
  ('b0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000006', 'detected');

insert into public.municipal_planning (
  id, province_id, municipality_id, name, status
)
values (
  'a0000000-0000-4000-8000-000000000008',
  '15',
  '15009',
  'RLS test public catalogue',
  'vigente'
);

select extensions.ok(
  not has_table_privilege('anon', 'public.chat_messages', 'SELECT')
    and not has_table_privilege('anon', 'public.chat_messages', 'INSERT')
    and not has_table_privilege('anon', 'public.chat_messages', 'UPDATE')
    and not has_table_privilege('anon', 'public.chat_messages', 'DELETE'),
  'anon has no chat CRUD privileges'
);
select extensions.ok(
  not has_table_privilege('anon', 'public.context_detections', 'SELECT')
    and not has_table_privilege('anon', 'public.context_detections', 'INSERT')
    and not has_table_privilege('anon', 'public.context_detections', 'UPDATE')
    and not has_table_privilege('anon', 'public.context_detections', 'DELETE'),
  'anon has no context CRUD privileges'
);
select extensions.ok(
  not has_table_privilege('anon', 'public.expediente_afecciones', 'SELECT')
    and not has_table_privilege('anon', 'public.expediente_afecciones', 'INSERT')
    and not has_table_privilege('anon', 'public.expediente_afecciones', 'UPDATE')
    and not has_table_privilege('anon', 'public.expediente_afecciones', 'DELETE'),
  'anon has no constraint CRUD privileges'
);
select extensions.ok(
  not has_table_privilege('anon', 'public.municipal_planning', 'SELECT')
    and not has_table_privilege('anon', 'public.municipal_planning', 'INSERT')
    and not has_table_privilege('anon', 'public.municipal_planning', 'UPDATE')
    and not has_table_privilege('anon', 'public.municipal_planning', 'DELETE'),
  'anon has no planning catalogue CRUD privileges'
);

-- anon has neither grants nor policies.
set local role anon;
select extensions.throws_ok(
  $$select id from public.chat_messages limit 1$$,
  '42501',
  'permission denied for table chat_messages',
  'anon cannot read chat messages'
);
select extensions.throws_ok(
  $$select id from public.context_detections limit 1$$,
  '42501',
  'permission denied for table context_detections',
  'anon cannot read context detections'
);
select extensions.throws_ok(
  $$select id from public.expediente_afecciones limit 1$$,
  '42501',
  'permission denied for table expediente_afecciones',
  'anon cannot read expediente constraints'
);
select extensions.throws_ok(
  $$select id from public.municipal_planning limit 1$$,
  '42501',
  'permission denied for table municipal_planning',
  'anon cannot read the authenticated catalogue'
);
reset role;

-- User A sees only organization A.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
select extensions.results_eq(
  $$select count(*)::bigint from public.chat_messages$$,
  array[1::bigint],
  'user A reads only A chat'
);
select extensions.results_eq(
  $$select count(*)::bigint from public.context_detections$$,
  array[1::bigint],
  'user A reads only A context'
);
select extensions.results_eq(
  $$select count(*)::bigint from public.expediente_afecciones$$,
  array[1::bigint],
  'user A reads only A constraints'
);
select extensions.results_eq(
  $$select count(*)::bigint from public.municipal_planning$$,
  array[1::bigint],
  'authenticated users read the explicit global catalogue'
);
select extensions.results_eq(
  $$select count(*)::bigint from public.afeccion_types$$,
  array[1::bigint],
  'authenticated users read the explicit constraint catalogue'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.organization_members', 'INSERT,UPDATE,DELETE'),
  'authenticated users cannot fabricate memberships'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.expedientes', 'INSERT,UPDATE,DELETE'),
  'authenticated users cannot bypass server-side expediente authorization'
);
select extensions.ok(
  case
    when to_regclass('public.normativa_documents') is null then true
    else not has_table_privilege('authenticated', 'public.normativa_documents', 'SELECT')
  end,
  'authenticated users cannot read V1 document metadata directly when present'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.normativa_chunks', 'SELECT'),
  'authenticated users cannot read V1 chunks directly'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.normative_chunks_v2', 'SELECT'),
  'authenticated users cannot read V2 chunks directly'
);
select extensions.throws_ok(
  $$insert into public.chat_messages (expediente_id, user_id, role, content)
    values (
      'a0000000-0000-4000-8000-000000000003',
      'a0000000-0000-4000-8000-000000000002',
      'user',
      'blocked direct A message'
    )$$,
  '42501',
  'permission denied for table chat_messages',
  'user A cannot bypass the server chat channel even in A expediente'
);
select extensions.throws_ok(
  $$insert into public.chat_messages (expediente_id, user_id, role, content)
    values (
      'b0000000-0000-4000-8000-000000000003',
      'a0000000-0000-4000-8000-000000000002',
      'user',
      'forbidden cross-tenant message'
    )$$,
  '42501',
  'permission denied for table chat_messages',
  'user A cannot insert into B expediente'
);
select extensions.throws_ok(
  $$insert into public.chat_messages (expediente_id, user_id, role, content)
    values (
      'a0000000-0000-4000-8000-000000000003',
      'b0000000-0000-4000-8000-000000000002',
      'user',
      'forged author'
    )$$,
  '42501',
  'permission denied for table chat_messages',
  'user A cannot forge user B as author'
);
select extensions.throws_ok(
  $$insert into public.chat_messages (expediente_id, user_id, role, content)
    values (
      'a0000000-0000-4000-8000-000000000003',
      'a0000000-0000-4000-8000-000000000002',
      'assistant',
      'forged assistant message'
    )$$,
  '42501',
  'permission denied for table chat_messages',
  'authenticated users cannot forge assistant messages'
);
select extensions.throws_ok(
  $$update public.chat_messages
    set expediente_id = 'b0000000-0000-4000-8000-000000000003'
    where id = 'a0000000-0000-4000-8000-000000000004'$$,
  '42501',
  'permission denied for table chat_messages',
  'user A cannot move a message to another expediente'
);
reset role;

-- User B sees only organization B, proving the boundary in both directions.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
select extensions.results_eq(
  $$select content from public.chat_messages order by content$$,
  array['fixture B'::text],
  'user B cannot read A chat'
);
select extensions.results_eq(
  $$select count(*)::bigint from public.context_detections$$,
  array[1::bigint],
  'user B cannot read A context'
);
select extensions.results_eq(
  $$select count(*)::bigint from public.expediente_afecciones$$,
  array[1::bigint],
  'user B cannot read A constraints'
);
reset role;

-- service_role remains the trusted server channel.
select extensions.ok(
  (select rolbypassrls from pg_catalog.pg_roles where rolname = 'service_role'),
  'service_role bypasses RLS for server operations'
);
select extensions.ok(
  has_table_privilege('service_role', 'public.chat_messages', 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role keeps chat DML'
);
select extensions.ok(
  has_table_privilege('service_role', 'public.context_detections', 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role keeps context DML'
);
select extensions.ok(
  has_table_privilege('service_role', 'public.expediente_afecciones', 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role keeps constraint DML'
);
select extensions.ok(
  case
    when to_regclass('public.normativa_documents') is null then true
    else has_table_privilege('service_role', 'public.normativa_documents', 'SELECT')
  end,
  'service_role keeps V1 document metadata access when present'
);
select extensions.ok(
  has_table_privilege('service_role', 'public.normativa_chunks', 'SELECT'),
  'service_role keeps V1 RAG access'
);
select extensions.ok(
  has_table_privilege('service_role', 'public.normative_chunks_v2', 'SELECT'),
  'service_role keeps V2 RAG access'
);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.match_normativa_chunks(vector,integer,text)',
    'EXECUTE'
  ),
  'anon cannot execute the RAG RPC'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.match_normativa_chunks(vector,integer,text)',
    'EXECUTE'
  ),
  'authenticated cannot execute the RAG RPC directly'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.match_normativa_chunks(vector,integer,text)',
    'EXECUTE'
  ),
  'service_role executes the RAG RPC'
);

set local role service_role;
select extensions.lives_ok(
  $$insert into public.context_detections (
      expediente_id,
      summary,
      source_apis
    ) values (
      'b0000000-0000-4000-8000-000000000003',
      '{}'::jsonb,
      '[]'::jsonb
    )$$,
  'service_role retains server-side context writes'
);
select extensions.lives_ok(
  $$select *
    from public.match_normativa_chunks(
      null,
      0,
      '__urbanbrain_rls_test_no_match__'
    )$$,
  'the authorized RAG channel remains callable'
);
reset role;

select * from extensions.finish();
rollback;
