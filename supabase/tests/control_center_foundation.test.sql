-- CC-01 integration specification for an isolated Supabase/PostgreSQL database.
-- All fixtures are synthetic and rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into public.profiles (id, full_name)
values ('c1000000-0000-4000-8000-000000000001', 'Synthetic CC-01 administrator');

select extensions.ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.platform_admins'::regclass),
  'platform_admins has forced RLS'
);
select extensions.ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.admin_audit_events'::regclass),
  'admin_audit_events has forced RLS'
);

select extensions.ok(
  not has_table_privilege('anon', 'public.platform_admins', 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated', 'public.platform_admins', 'SELECT,INSERT,UPDATE,DELETE'),
  'browser roles have no platform administrator privileges'
);
select extensions.ok(
  not has_table_privilege('anon', 'public.admin_audit_events', 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated', 'public.admin_audit_events', 'SELECT,INSERT,UPDATE,DELETE'),
  'browser roles have no audit event privileges'
);

set local role anon;
select extensions.throws_ok(
  $$select profile_id from public.platform_admins limit 1$$,
  '42501',
  'permission denied for table platform_admins',
  'anon cannot enumerate platform administrators'
);
select extensions.throws_ok(
  $$select id from public.admin_audit_events limit 1$$,
  '42501',
  'permission denied for table admin_audit_events',
  'anon cannot read the administrative audit trail'
);
reset role;

set local role authenticated;
select extensions.throws_ok(
  $$select profile_id from public.platform_admins limit 1$$,
  '42501',
  'permission denied for table platform_admins',
  'authenticated users cannot enumerate platform administrators'
);
select extensions.throws_ok(
  $$insert into public.platform_admins (profile_id, role)
    values ('c1000000-0000-4000-8000-000000000001', 'superadmin')$$,
  '42501',
  'permission denied for table platform_admins',
  'a client cannot promote itself through the Data API'
);
select extensions.throws_ok(
  $$insert into public.admin_audit_events (action, resource_type, result)
    values ('forged.event', 'platform', 'success')$$,
  '42501',
  'permission denied for table admin_audit_events',
  'a client cannot forge an audit event'
);
reset role;

select extensions.ok(
  has_table_privilege('service_role', 'public.platform_admins', 'SELECT,INSERT,UPDATE')
    and not has_table_privilege('service_role', 'public.platform_admins', 'DELETE'),
  'service_role can manage state but cannot delete platform administrators'
);
select extensions.ok(
  has_table_privilege('service_role', 'public.admin_audit_events', 'SELECT,INSERT')
    and not has_table_privilege('service_role', 'public.admin_audit_events', 'UPDATE,DELETE'),
  'service_role can append and read but cannot rewrite audit history'
);

set local role service_role;
select extensions.lives_ok(
  $$insert into public.platform_admins (profile_id, role)
    values ('c1000000-0000-4000-8000-000000000001', 'superadmin')$$,
  'the trusted server channel can provision an administrator'
);
select extensions.lives_ok(
  $$insert into public.admin_audit_events (
      actor_profile_id, actor_role, action, permission, resource_type, result
    ) values (
      'c1000000-0000-4000-8000-000000000001',
      'superadmin',
      'platform_admin.bootstrap',
      'platform_admin.manage',
      'platform_admin',
      'success'
    )$$,
  'the trusted server channel can append an audit event'
);
select extensions.throws_ok(
  $$update public.admin_audit_events set result = 'error'$$,
  '42501',
  'permission denied for table admin_audit_events',
  'service_role cannot rewrite audit history'
);
select extensions.throws_ok(
  $$delete from public.platform_admins$$,
  '42501',
  'permission denied for table platform_admins',
  'service_role cannot delete administrator history'
);
reset role;

select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_policy
    where polrelid in (
      'public.platform_admins'::regclass,
      'public.admin_audit_events'::regclass
    )
  ),
  'administrative tables expose no browser RLS policy'
);

select * from extensions.finish();
rollback;
