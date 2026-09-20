-- Apply the canonical expediente-owner isolation model to HAS alignments and
-- source transformations. Browser clients may read only rows belonging to
-- their own expedientes; server-side mutations remain reserved to service_role.
begin;

do $preflight$
declare
  required_role text;
  required_relation text;
begin
  foreach required_role in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select 1 from pg_catalog.pg_roles where rolname = required_role) then
      raise exception 'Required role % does not exist', required_role;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'service_role'
      and rolbypassrls
  ) then
    raise exception 'service_role must bypass RLS before owner isolation can be enforced';
  end if;

  if to_regprocedure('public.urbanbrain_can_access_expediente(uuid)') is null then
    raise exception 'Required function public.urbanbrain_can_access_expediente(uuid) does not exist';
  end if;

  foreach required_relation in array array[
    'public.has_alignments',
    'public.source_transformations'
  ] loop
    if to_regclass(required_relation) is null then
      raise exception 'Required relation % does not exist', required_relation;
    end if;
  end loop;
end;
$preflight$;

alter table public.has_alignments enable row level security;
alter table public.has_alignments force row level security;
revoke all privileges on table public.has_alignments from public, anon, authenticated;
grant select on table public.has_alignments to authenticated;
grant select, insert, update, delete on table public.has_alignments to service_role;

drop policy if exists urbanbrain_has_alignments_owner_select on public.has_alignments;
drop policy if exists urbanbrain_has_alignments_owner_isolation on public.has_alignments;
create policy urbanbrain_has_alignments_owner_select
  on public.has_alignments
  for select to authenticated
  using (public.urbanbrain_can_access_expediente(expediente_id));
create policy urbanbrain_has_alignments_owner_isolation
  on public.has_alignments
  as restrictive for all to authenticated
  using (public.urbanbrain_can_access_expediente(expediente_id))
  with check (public.urbanbrain_can_access_expediente(expediente_id));

alter table public.source_transformations enable row level security;
alter table public.source_transformations force row level security;
revoke all privileges on table public.source_transformations from public, anon, authenticated;
grant select on table public.source_transformations to authenticated;
grant select, insert, update, delete on table public.source_transformations to service_role;

drop policy if exists source_transformations_authenticated_access on public.source_transformations;
drop policy if exists urbanbrain_source_transformations_owner_select on public.source_transformations;
drop policy if exists urbanbrain_source_transformations_owner_isolation on public.source_transformations;
create policy urbanbrain_source_transformations_owner_select
  on public.source_transformations
  for select to authenticated
  using (public.urbanbrain_can_access_expediente(expediente_id));
create policy urbanbrain_source_transformations_owner_isolation
  on public.source_transformations
  as restrictive for all to authenticated
  using (public.urbanbrain_can_access_expediente(expediente_id))
  with check (public.urbanbrain_can_access_expediente(expediente_id));

commit;
