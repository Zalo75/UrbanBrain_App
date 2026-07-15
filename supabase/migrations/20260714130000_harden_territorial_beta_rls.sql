-- Harden the Data API boundary used by the private territorial beta.
-- This migration targets the already deployed schema directly and does not
-- depend on the historical migration chain being replayable.

begin;

do $block$
declare
  required_table text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'postgres'
      and rolbypassrls
  ) then
    raise exception 'postgres must have BYPASSRLS for the membership helper';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'service_role'
      and rolbypassrls
  ) then
    raise exception 'service_role must have BYPASSRLS for server operations';
  end if;

  -- These relations are authorization roots used by the helper and therefore
  -- are not optional. Everything else is hardened independently when present.
  foreach required_table in array array[
    'organizations',
    'profiles',
    'organization_members',
    'expedientes'
  ] loop
    if to_regclass('public.' || required_table) is null then
      raise exception 'Required authorization table public.% does not exist', required_table;
    end if;
  end loop;
end;
$block$;

-- Avoid recursive RLS evaluation through organization_members. The function
-- returns information only about the caller's own membership, uses fully
-- qualified objects, and is intentionally unavailable to anon.
create or replace function public.urbanbrain_can_access_expediente(
  target_expediente_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.expedientes as e
      inner join public.organization_members as om
        on om.org_id = e.org_id
      where e.id = target_expediente_id
        and om.profile_id = (select auth.uid())
    );
$function$;

alter function public.urbanbrain_can_access_expediente(uuid) owner to postgres;
revoke all privileges on function public.urbanbrain_can_access_expediente(uuid) from public;
revoke all privileges on function public.urbanbrain_can_access_expediente(uuid) from anon;
grant execute on function public.urbanbrain_can_access_expediente(uuid)
  to authenticated, service_role;

-- The remote schema has historical drift: V1 metadata may be absent while V1
-- chunks remain. Protect every known relation independently and explicitly.
do $block$
declare
  protected_table text;
begin
  foreach protected_table in array array[
    'chat_messages',
    'context_detections',
    'expediente_afecciones',
    'municipal_planning',
    'afeccion_types',
    'organizations',
    'profiles',
    'organization_members',
    'expedientes',
    'normativa_documents',
    'normativa_chunks',
    'normative_documents_v2',
    'normative_chunks_v2'
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

-- Re-running the migration recreates only policies owned by this change.
-- Each block is conditional because non-core product tables may legitimately
-- be absent in an operational schema assembled before migration versioning.
do $block$
begin
  if to_regclass('public.chat_messages') is not null then
    execute 'drop policy if exists urbanbrain_chat_messages_select_tenant on public.chat_messages';
    execute 'drop policy if exists urbanbrain_chat_messages_insert_self on public.chat_messages';
    execute 'create policy urbanbrain_chat_messages_select_tenant
      on public.chat_messages for select to authenticated
      using (public.urbanbrain_can_access_expediente(expediente_id))';
    grant select on table public.chat_messages to authenticated;
  end if;

  if to_regclass('public.context_detections') is not null then
    execute 'drop policy if exists urbanbrain_context_detections_select_tenant on public.context_detections';
    execute 'create policy urbanbrain_context_detections_select_tenant
      on public.context_detections for select to authenticated
      using (public.urbanbrain_can_access_expediente(expediente_id))';
    grant select on table public.context_detections to authenticated;
  end if;

  if to_regclass('public.expediente_afecciones') is not null then
    execute 'drop policy if exists urbanbrain_expediente_afecciones_select_tenant on public.expediente_afecciones';
    execute 'create policy urbanbrain_expediente_afecciones_select_tenant
      on public.expediente_afecciones for select to authenticated
      using (public.urbanbrain_can_access_expediente(expediente_id))';
    grant select on table public.expediente_afecciones to authenticated;
  end if;

  if to_regclass('public.municipal_planning') is not null then
    execute 'drop policy if exists urbanbrain_municipal_planning_select_authenticated on public.municipal_planning';
    execute 'create policy urbanbrain_municipal_planning_select_authenticated
      on public.municipal_planning for select to authenticated using (true)';
    grant select on table public.municipal_planning to authenticated;
  end if;

  if to_regclass('public.afeccion_types') is not null then
    execute 'drop policy if exists urbanbrain_afeccion_types_select_authenticated on public.afeccion_types';
    execute 'create policy urbanbrain_afeccion_types_select_authenticated
      on public.afeccion_types for select to authenticated using (true)';
    grant select on table public.afeccion_types to authenticated;
  end if;
end;
$block$;

-- The webapp calls this RPC only from /api/chat with SUPABASE_SERVICE_ROLE_KEY.
-- Fail closed if the audited signature is not present or is ambiguous.
do $block$
declare
  rpc_count integer;
  rpc_signature regprocedure;
begin
  select count(*), (array_agg(p.oid))[1]::regprocedure
    into rpc_count, rpc_signature
  from pg_catalog.pg_proc as p
  inner join pg_catalog.pg_namespace as n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'match_normativa_chunks'
    and pg_catalog.pg_get_function_identity_arguments(p.oid)
      = 'query_embedding vector, match_count integer, filter_municipio text';

  if rpc_count <> 1 then
    raise exception
      'Expected exactly one public.match_normativa_chunks(vector, integer, text); found %',
      rpc_count;
  end if;

  execute format('alter function %s security invoker', rpc_signature);
  execute format(
    'alter function %s set search_path to pg_catalog, public, extensions',
    rpc_signature
  );
  execute format(
    'revoke all privileges on function %s from public',
    rpc_signature
  );
  execute format(
    'revoke all privileges on function %s from anon, authenticated',
    rpc_signature
  );
  execute format(
    'grant execute on function %s to service_role',
    rpc_signature
  );
end;
$block$;

commit;
