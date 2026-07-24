-- Individual ownership boundary, including users in the same organization.
-- Intended for `supabase test db`; every fixture is rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into public.organizations (id, name, slug)
values ('c0000000-0000-4000-8000-000000000001', 'Owner isolation organization', 'owner-isolation-org');

insert into public.profiles (id, full_name)
values
  ('c0000000-0000-4000-8000-000000000002', 'Owner isolation user A'),
  ('c0000000-0000-4000-8000-000000000003', 'Owner isolation admin B');

insert into public.organization_members (org_id, profile_id, role)
values
  ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'member'),
  ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', 'admin');

insert into public.expedientes (id, org_id, owner_id, name, municipio)
values
  ('c0000000-0000-4000-8000-000000000010', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'Owned by A', 'betanzos'),
  ('c0000000-0000-4000-8000-000000000020', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', 'Owned by B', 'betanzos');

insert into public.chat_messages (id, expediente_id, user_id, role, content)
values
  ('c0000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000010', 'c0000000-0000-4000-8000-000000000002', 'user', 'A'),
  ('c0000000-0000-4000-8000-000000000021', 'c0000000-0000-4000-8000-000000000020', 'c0000000-0000-4000-8000-000000000003', 'user', 'B');

insert into public.documents (id, expediente_id, filename, storage_path, document_type, uploaded_by)
values
  ('c0000000-0000-4000-8000-000000000012', 'c0000000-0000-4000-8000-000000000010', 'a.pdf', 'organizations/c0000000-0000-4000-8000-000000000001/expedientes/c0000000-0000-4000-8000-000000000010/a.pdf', 'normativa', 'c0000000-0000-4000-8000-000000000002'),
  ('c0000000-0000-4000-8000-000000000022', 'c0000000-0000-4000-8000-000000000020', 'b.pdf', 'organizations/c0000000-0000-4000-8000-000000000001/expedientes/c0000000-0000-4000-8000-000000000020/b.pdf', 'normativa', 'c0000000-0000-4000-8000-000000000003');

insert into public.document_chunks (id, document_id, expediente_id, content)
values
  ('c0000000-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000012', 'c0000000-0000-4000-8000-000000000010', 'chunk A'),
  ('c0000000-0000-4000-8000-000000000023', 'c0000000-0000-4000-8000-000000000022', 'c0000000-0000-4000-8000-000000000020', 'chunk B');

insert into public.context_detections (id, expediente_id, summary, source_apis)
values
  ('c0000000-0000-4000-8000-000000000014', 'c0000000-0000-4000-8000-000000000010', '{}'::jsonb, '[]'::jsonb),
  ('c0000000-0000-4000-8000-000000000024', 'c0000000-0000-4000-8000-000000000020', '{}'::jsonb, '[]'::jsonb);

insert into public.afeccion_types (id, category, name)
values ('c0000000-0000-4000-8000-000000000030', 'test', 'Owner isolation affect');
insert into public.expediente_afecciones (id, expediente_id, afeccion_type_id, status)
values
  ('c0000000-0000-4000-8000-000000000015', 'c0000000-0000-4000-8000-000000000010', 'c0000000-0000-4000-8000-000000000030', 'detected'),
  ('c0000000-0000-4000-8000-000000000025', 'c0000000-0000-4000-8000-000000000020', 'c0000000-0000-4000-8000-000000000030', 'detected');

insert into public.conversations (id, expediente_id, created_by)
values
  ('c0000000-0000-4000-8000-000000000016', 'c0000000-0000-4000-8000-000000000010', 'c0000000-0000-4000-8000-000000000002'),
  ('c0000000-0000-4000-8000-000000000026', 'c0000000-0000-4000-8000-000000000020', 'c0000000-0000-4000-8000-000000000003');
insert into public.messages (id, conversation_id, role, content)
values
  ('c0000000-0000-4000-8000-000000000017', 'c0000000-0000-4000-8000-000000000016', 'user', 'message A'),
  ('c0000000-0000-4000-8000-000000000027', 'c0000000-0000-4000-8000-000000000026', 'user', 'message B');
insert into public.message_sources (id, message_id, document_ref, excerpt)
values
  ('c0000000-0000-4000-8000-000000000018', 'c0000000-0000-4000-8000-000000000017', 'A', 'source A'),
  ('c0000000-0000-4000-8000-000000000028', 'c0000000-0000-4000-8000-000000000027', 'B', 'source B');

insert into public.expediente_normative_context (id, expediente_id, scope_type, category)
values
  ('c0000000-0000-4000-8000-000000000019', 'c0000000-0000-4000-8000-000000000010', 'estatal', 'CTE'),
  ('c0000000-0000-4000-8000-000000000029', 'c0000000-0000-4000-8000-000000000020', 'estatal', 'CTE');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select extensions.results_eq(
  $$select name from public.expedientes order by name$$,
  array['Owned by A'::text],
  'user A lists only its own expediente despite sharing the organization with admin B'
);
select extensions.results_eq($$select count(*)::bigint from public.chat_messages$$, array[1::bigint], 'A reads only own chat');
select extensions.results_eq($$select count(*)::bigint from public.documents$$, array[1::bigint], 'A reads only own documents');
select extensions.results_eq($$select count(*)::bigint from public.document_chunks$$, array[1::bigint], 'A reads only own chunks');
select extensions.results_eq($$select count(*)::bigint from public.context_detections$$, array[1::bigint], 'A reads only own territorial results');
select extensions.results_eq($$select count(*)::bigint from public.expediente_afecciones$$, array[1::bigint], 'A reads only own affects');
select extensions.results_eq($$select count(*)::bigint from public.conversations$$, array[1::bigint], 'A reads only own conversations');
select extensions.results_eq($$select count(*)::bigint from public.messages$$, array[1::bigint], 'A reads only own messages');
select extensions.results_eq($$select count(*)::bigint from public.message_sources$$, array[1::bigint], 'A reads only own message sources');
select extensions.results_eq($$select count(*)::bigint from public.expediente_normative_context$$, array[1::bigint], 'A reads only own normative context');
select extensions.is_empty(
  $$update public.expedientes set status = 'archived' where id = 'c0000000-0000-4000-8000-000000000020' returning id$$,
  'A cannot archive B expediente'
);
select extensions.is_empty(
  $$delete from public.expedientes where id = 'c0000000-0000-4000-8000-000000000020' returning id$$,
  'A cannot delete B expediente'
);
select extensions.throws_ok(
  $$insert into public.expedientes (org_id, owner_id, name, municipio)
    values ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', 'Forged owner', 'betanzos')$$,
  '42501',
  'new row violates row-level security policy for table "expedientes"',
  'A cannot forge B as expediente owner'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select extensions.results_eq(
  $$select name from public.expedientes order by name$$,
  array['Owned by B'::text],
  'same-organization admin B cannot read user A expediente'
);
reset role;

select extensions.ok(
  not has_table_privilege('anon', 'public.expedientes', 'SELECT,INSERT,UPDATE,DELETE'),
  'anon has no expediente access'
);
select extensions.ok(
  has_table_privilege('service_role', 'public.expedientes', 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role keeps server recovery access'
);
select extensions.ok(
  exists (
    select 1 from pg_catalog.pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname = 'urbanbrain_expedientes_owner_select'
      and not polpermissive
  ),
  'private Storage reads have a restrictive owner gate'
);

select * from extensions.finish();
rollback;
