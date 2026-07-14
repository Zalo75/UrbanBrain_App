-- Emergency fail-closed rollback for the policy layer only.
-- It intentionally does NOT restore anon/authenticated broad grants.

begin;

drop policy if exists urbanbrain_chat_messages_select_tenant
  on public.chat_messages;
drop policy if exists urbanbrain_chat_messages_insert_self
  on public.chat_messages;
drop policy if exists urbanbrain_context_detections_select_tenant
  on public.context_detections;
drop policy if exists urbanbrain_expediente_afecciones_select_tenant
  on public.expediente_afecciones;
drop policy if exists urbanbrain_municipal_planning_select_authenticated
  on public.municipal_planning;
drop policy if exists urbanbrain_afeccion_types_select_authenticated
  on public.afeccion_types;

revoke all privileges on table public.chat_messages
  from public, anon, authenticated;
revoke all privileges on table public.context_detections
  from public, anon, authenticated;
revoke all privileges on table public.expediente_afecciones
  from public, anon, authenticated;
revoke all privileges on table public.municipal_planning
  from public, anon, authenticated;
revoke all privileges on table public.afeccion_types
  from public, anon, authenticated;
revoke all privileges on table public.organizations
  from public, anon, authenticated;
revoke all privileges on table public.profiles
  from public, anon, authenticated;
revoke all privileges on table public.organization_members
  from public, anon, authenticated;
revoke all privileges on table public.expedientes
  from public, anon, authenticated;
revoke all privileges on table public.normativa_chunks
  from public, anon, authenticated;
revoke all privileges on table public.normative_documents_v2
  from public, anon, authenticated;
revoke all privileges on table public.normative_chunks_v2
  from public, anon, authenticated;

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
