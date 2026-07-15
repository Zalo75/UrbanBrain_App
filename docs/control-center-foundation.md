# CC-01: Control Center security foundation

## Boundary

`organization_members.role` is a tenant role and never grants Control Center access. The only
authority is an active row in `platform_admins`, resolved on the server for the authenticated
`profiles.id`. Browser roles have no direct grants or RLS policies on either administrative table.

The role matrix is centralized in `platformPermissions.ts`. Every future page, Route Handler, and
Server Action must call `requirePlatformPermission()` with the narrowest permission it needs. A
Proxy/middleware redirect is only an optimistic check and is not an authorization boundary.

## Audit policy

`admin_audit_events` is append-only for the server role. It accepts minimal sanitized metadata and
must never contain credentials, tokens, complete prompts, complete conversations, or unnecessary
personal data. Explicit mutations and sensitive content reveals must produce an audit event.

Ordinary `/control-center` renders are not persisted. Recording each render would introduce a
database side effect during React rendering and create a noisy, unbounded trail. Relevant denials
at mutation or sensitive-read boundaries must be recorded by those explicit server operations.

## First superadmin bootstrap (not automatic)

This procedure is intentionally manual. Run it only after the CC-01 migration has been reviewed and
applied in a controlled window. Replace both placeholders locally; do not commit their values.

```sql
begin;

do $bootstrap$
declare
  target_profile_id uuid := '<EXISTING_PROFILE_UUID>'::uuid;
  operator_reference text := '<CHANGE_TICKET_OR_OPERATOR_REFERENCE>';
begin
  if not exists (select 1 from public.profiles where id = target_profile_id) then
    raise exception 'The selected existing profile does not exist';
  end if;

  if exists (select 1 from public.platform_admins) then
    raise exception 'Bootstrap refused: a platform administrator already exists';
  end if;

  insert into public.platform_admins (profile_id, role, active, created_by)
  values (target_profile_id, 'superadmin', true, null);

  insert into public.admin_audit_events (
    actor_profile_id,
    actor_role,
    action,
    permission,
    resource_type,
    resource_id,
    result,
    reason
  ) values (
    target_profile_id,
    'superadmin',
    'platform_admin.bootstrap',
    'platform_admin.manage',
    'platform_admin',
    target_profile_id::text,
    'success',
    operator_reference
  );
end;
$bootstrap$;

commit;
```

Immediately verify that exactly one active, non-revoked superadmin exists and that the matching
audit event was inserted. Never derive the profile from an email inside a committed script and
never auto-promote the first registered user.

## Deployment ordering

The application route must not be deployed before the migration: the guard intentionally fails
closed if `platform_admins` is absent. Validate the migration on isolated Supabase/PostgreSQL first,
then apply it in a controlled database window, perform the one-time bootstrap, and only then deploy
the application commit. This document does not authorize any remote execution.
