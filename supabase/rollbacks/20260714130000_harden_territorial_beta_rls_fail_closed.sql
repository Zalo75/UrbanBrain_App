-- Emergency fail-closed rollback for the policy layer only.
-- It intentionally does NOT restore anon/authenticated broad grants.

begin;

do $block$
declare
  protected_table text;
  policy_target record;
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'service_role'
      and rolbypassrls
  ) then
    raise exception 'service_role must have BYPASSRLS for fail-closed rollback';
  end if;

  -- Keep every relation closed even when the rollback is applied to a drifted
  -- or partially hardened schema. Missing optional tables are skipped safely.
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

  for policy_target in
    select * from (values
      ('chat_messages', 'urbanbrain_chat_messages_select_tenant'),
      ('chat_messages', 'urbanbrain_chat_messages_insert_self'),
      ('context_detections', 'urbanbrain_context_detections_select_tenant'),
      ('expediente_afecciones', 'urbanbrain_expediente_afecciones_select_tenant'),
      ('municipal_planning', 'urbanbrain_municipal_planning_select_authenticated'),
      ('afeccion_types', 'urbanbrain_afeccion_types_select_authenticated')
    ) as policies(table_name, policy_name)
  loop
    if to_regclass('public.' || policy_target.table_name) is not null then
      execute format(
        'drop policy if exists %I on public.%I',
        policy_target.policy_name,
        policy_target.table_name
      );
    end if;
  end loop;
end;
$block$;

drop function if exists public.urbanbrain_can_access_expediente(uuid);

-- Keep the RPC server-only. Restoring public execution is never a safe rollback.
do $block$
declare
  rpc_signature regprocedure;
begin
  select p.oid::regprocedure
    into rpc_signature
  from pg_catalog.pg_proc as p
  inner join pg_catalog.pg_namespace as n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'match_normativa_chunks'
    and pg_catalog.pg_get_function_identity_arguments(p.oid)
      = 'query_embedding vector, match_count integer, filter_municipio text';

  if rpc_signature is not null then
    execute format('alter function %s security invoker', rpc_signature);
    execute format(
      'alter function %s set search_path to pg_catalog, public, extensions',
      rpc_signature
    );
    execute format(
      'revoke all privileges on function %s from public, anon, authenticated',
      rpc_signature
    );
    execute format(
      'grant execute on function %s to service_role',
      rpc_signature
    );
  end if;
end;
$block$;

commit;
