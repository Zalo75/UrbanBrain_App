-- Close the public-schema RLS gaps left outside the previous beta hardening.
-- These relations have no browser Data API consumer in the current webapp.
-- This migration changes only RLS/ACL metadata and never mutates business data.

begin;

do $block$
declare
  required_role text;
  protected_table text;
begin
  foreach required_role in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (
      select 1
      from pg_catalog.pg_roles
      where rolname = required_role
    ) then
      raise exception 'Required Supabase role % does not exist', required_role;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'service_role'
      and rolbypassrls
  ) then
    raise exception 'service_role must have BYPASSRLS for server operations';
  end if;

  -- Some legacy or optional relations may not exist in every deployed schema.
  -- Harden every relation independently so schema drift cannot abort the rest.
  foreach protected_table in array array[
    'conversations',
    'messages',
    'message_sources',
    'document_chunks',
    'planning_zones',
    'normative_families',
    'expediente_normative_context',
    'legal_updates'
  ] loop
    if to_regclass('public.' || protected_table) is not null then
      execute format(
        'alter table public.%I enable row level security',
        protected_table
      );
      execute format(
        'alter table public.%I force row level security',
        protected_table
      );
      execute format(
        'revoke all privileges on table public.%I from public, anon, authenticated',
        protected_table
      );
      execute format(
        'grant select, insert, update, delete on table public.%I to service_role',
        protected_table
      );
    end if;
  end loop;
end;
$block$;

commit;
