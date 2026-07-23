-- Operational rollback for the remaining public-table hardening.
-- It removes FORCE RLS for compatibility, but intentionally keeps RLS enabled
-- and browser/Data API roles revoked. Restoring an insecure state is not safe.

begin;

do $block$
declare
  protected_table text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'service_role'
      and rolbypassrls
  ) then
    raise exception 'service_role must have BYPASSRLS for fail-closed rollback';
  end if;

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
        'alter table public.%I no force row level security',
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
