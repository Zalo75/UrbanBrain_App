-- CC-01: server-only platform administration boundary and append-only audit log.
-- This migration targets the audited Release Candidate schema directly and
-- must not be applied through the broken historical migration chain.

begin;

do $block$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Required table public.profiles does not exist';
  end if;

  if to_regclass('public.organizations') is null then
    raise exception 'Required table public.organizations does not exist';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'service_role' and rolbypassrls
  ) then
    raise exception 'service_role must exist with BYPASSRLS';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'postgres' and rolbypassrls
  ) then
    raise exception 'postgres must exist with BYPASSRLS for the direct server connection';
  end if;

  if to_regclass('public.platform_admins') is not null
    or to_regclass('public.admin_audit_events') is not null then
    raise exception 'CC-01 tables already exist; refusing to overwrite an unknown definition';
  end if;
end;
$block$;

create type public.platform_admin_role as enum (
  'superadmin',
  'operations',
  'support',
  'readonly'
);

create type public.admin_audit_result as enum (
  'success',
  'denied',
  'error'
);

create table public.platform_admins (
  profile_id uuid primary key
    references public.profiles(id) on delete restrict,
  role public.platform_admin_role not null,
  active boolean not null default true,
  created_by uuid
    references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_reviewed_at timestamptz,
  constraint platform_admins_revocation_state_check check (
    (active and revoked_at is null)
    or (not active and revoked_at is not null)
  )
);

comment on table public.platform_admins is
  'Server-managed platform roles; independent from organization membership roles.';
comment on column public.platform_admins.created_by is
  'Null only for the explicitly provisioned bootstrap superadmin.';

create table public.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  -- Historical identifiers intentionally have no FK and survive target deletion.
  actor_profile_id uuid,
  actor_role public.platform_admin_role,
  action text not null,
  permission text,
  resource_type text not null,
  resource_id text,
  organization_id uuid,
  result public.admin_audit_result not null,
  reason text,
  correlation_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint admin_audit_events_action_not_blank check (btrim(action) <> ''),
  constraint admin_audit_events_resource_type_not_blank check (btrim(resource_type) <> ''),
  constraint admin_audit_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);

comment on table public.admin_audit_events is
  'Append-only audit trail for explicit Control Center actions; page renders are excluded.';

create index admin_audit_events_actor_created_at_idx
  on public.admin_audit_events (actor_profile_id, created_at);
create index admin_audit_events_org_created_at_idx
  on public.admin_audit_events (organization_id, created_at);
create index admin_audit_events_created_at_idx
  on public.admin_audit_events (created_at);

alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;
alter table public.admin_audit_events enable row level security;
alter table public.admin_audit_events force row level security;

-- No RLS policies are created. Browser roles are intentionally denied even
-- when the authenticated user is itself a platform administrator.
revoke all privileges on table public.platform_admins
  from public, anon, authenticated, service_role;
revoke all privileges on table public.admin_audit_events
  from public, anon, authenticated, service_role;
revoke all privileges on type public.platform_admin_role
  from public, anon, authenticated;
revoke all privileges on type public.admin_audit_result
  from public, anon, authenticated;

-- The trusted server channel can manage role state but cannot delete its
-- history. Audit events can only be selected or appended, never rewritten.
grant select, insert, update on table public.platform_admins to service_role;
grant select, insert on table public.admin_audit_events to service_role;
grant usage on type public.platform_admin_role to service_role;
grant usage on type public.admin_audit_result to service_role;

commit;
