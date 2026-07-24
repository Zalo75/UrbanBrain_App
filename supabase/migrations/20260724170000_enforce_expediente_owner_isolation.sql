-- Enforce individual expediente ownership without inferring ownership from
-- organization roles. Historical rows are backfilled only when the organization
-- has exactly one member; ambiguous rows remain inaccessible until explicitly assigned.
begin;

do $preflight$
declare
  required_relation text;
begin
  foreach required_relation in array array[
    'public.profiles',
    'public.organization_members',
    'public.expedientes'
  ] loop
    if to_regclass(required_relation) is null then
      raise exception 'Required relation % does not exist', required_relation;
    end if;
  end loop;
end;
$preflight$;

alter table public.expedientes add column if not exists owner_id uuid;

do $constraint$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.expedientes'::regclass
      and conname = 'expedientes_owner_id_profiles_id_fk'
  ) then
    alter table public.expedientes
      add constraint expedientes_owner_id_profiles_id_fk
      foreign key (owner_id) references public.profiles(id)
      on delete restrict not valid;
  end if;
end;
$constraint$;

with single_member_organizations as (
  select org_id, min(profile_id::text)::uuid as profile_id
  from public.organization_members
  group by org_id
  having count(distinct profile_id) = 1
)
update public.expedientes as e
set owner_id = single.profile_id
from single_member_organizations as single
where e.org_id = single.org_id
  and e.owner_id is null;

do $constraint$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.expedientes'::regclass
      and conname = 'expedientes_owner_id_required'
  ) then
    alter table public.expedientes
      add constraint expedientes_owner_id_required
      check (owner_id is not null) not valid;
  end if;

  if not exists (select 1 from public.expedientes where owner_id is null) then
    alter table public.expedientes validate constraint expedientes_owner_id_profiles_id_fk;
    alter table public.expedientes validate constraint expedientes_owner_id_required;
    alter table public.expedientes alter column owner_id set not null;
  else
    raise notice 'Some historical expedientes have ambiguous ownership and remain inaccessible';
  end if;
end;
$constraint$;

create index if not exists expedientes_owner_created_at_idx
  on public.expedientes (owner_id, created_at desc);

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
      where e.id = target_expediente_id
        and e.owner_id = (select auth.uid())
    );
$function$;

alter function public.urbanbrain_can_access_expediente(uuid) owner to postgres;
revoke all privileges on function public.urbanbrain_can_access_expediente(uuid) from public, anon;
grant execute on function public.urbanbrain_can_access_expediente(uuid) to authenticated, service_role;

alter table public.expedientes enable row level security;
alter table public.expedientes force row level security;
revoke all privileges on table public.expedientes from public, anon;
grant select, insert, update, delete on table public.expedientes to authenticated, service_role;

drop policy if exists urbanbrain_expedientes_owner_select on public.expedientes;
drop policy if exists urbanbrain_expedientes_owner_insert on public.expedientes;
drop policy if exists urbanbrain_expedientes_owner_update on public.expedientes;
drop policy if exists urbanbrain_expedientes_owner_delete on public.expedientes;
drop policy if exists urbanbrain_expedientes_owner_isolation on public.expedientes;
create policy urbanbrain_expedientes_owner_select on public.expedientes
  for select to authenticated using (owner_id = (select auth.uid()));
create policy urbanbrain_expedientes_owner_insert on public.expedientes
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy urbanbrain_expedientes_owner_update on public.expedientes
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy urbanbrain_expedientes_owner_delete on public.expedientes
  for delete to authenticated using (owner_id = (select auth.uid()));
create policy urbanbrain_expedientes_owner_isolation on public.expedientes
  as restrictive for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

do $policies$
declare
  child_table text;
  policy_name text;
begin
  foreach child_table in array array[
    'chat_messages',
    'context_detections',
    'expediente_afecciones',
    'documents',
    'document_chunks',
    'conversations',
    'expediente_normative_context'
  ] loop
    if to_regclass('public.' || child_table) is not null then
      policy_name := 'urbanbrain_' || child_table || '_owner_select';
      execute format('alter table public.%I enable row level security', child_table);
      execute format('alter table public.%I force row level security', child_table);
      execute format('revoke all privileges on table public.%I from public, anon, authenticated', child_table);
      execute format('grant select on table public.%I to authenticated', child_table);
      execute format('grant select, insert, update, delete on table public.%I to service_role', child_table);
      execute format('drop policy if exists %I on public.%I', policy_name, child_table);
      execute format(
        'drop policy if exists %I on public.%I',
        'urbanbrain_' || child_table || '_owner_isolation',
        child_table
      );
      execute format(
        'create policy %I on public.%I for select to authenticated using (public.urbanbrain_can_access_expediente(expediente_id))',
        policy_name,
        child_table
      );
      execute format(
        'create policy %I on public.%I as restrictive for all to authenticated using (public.urbanbrain_can_access_expediente(expediente_id)) with check (public.urbanbrain_can_access_expediente(expediente_id))',
        'urbanbrain_' || child_table || '_owner_isolation',
        child_table
      );
    end if;
  end loop;

  if to_regclass('public.messages') is not null then
    alter table public.messages enable row level security;
    alter table public.messages force row level security;
    revoke all privileges on table public.messages from public, anon, authenticated;
    grant select on table public.messages to authenticated;
    grant select, insert, update, delete on table public.messages to service_role;
    drop policy if exists urbanbrain_messages_owner_select on public.messages;
    drop policy if exists urbanbrain_messages_owner_isolation on public.messages;
    create policy urbanbrain_messages_owner_select on public.messages
      for select to authenticated using (
        exists (
          select 1 from public.conversations as c
          where c.id = conversation_id
            and public.urbanbrain_can_access_expediente(c.expediente_id)
        )
      );
    create policy urbanbrain_messages_owner_isolation on public.messages
      as restrictive for all to authenticated
      using (
        exists (
          select 1 from public.conversations as c
          where c.id = conversation_id
            and public.urbanbrain_can_access_expediente(c.expediente_id)
        )
      )
      with check (
        exists (
          select 1 from public.conversations as c
          where c.id = conversation_id
            and public.urbanbrain_can_access_expediente(c.expediente_id)
        )
      );
  end if;

  if to_regclass('public.message_sources') is not null then
    alter table public.message_sources enable row level security;
    alter table public.message_sources force row level security;
    revoke all privileges on table public.message_sources from public, anon, authenticated;
    grant select on table public.message_sources to authenticated;
    grant select, insert, update, delete on table public.message_sources to service_role;
    drop policy if exists urbanbrain_message_sources_owner_select on public.message_sources;
    drop policy if exists urbanbrain_message_sources_owner_isolation on public.message_sources;
    create policy urbanbrain_message_sources_owner_select on public.message_sources
      for select to authenticated using (
        exists (
          select 1
          from public.messages as m
          inner join public.conversations as c on c.id = m.conversation_id
          where m.id = message_id
            and public.urbanbrain_can_access_expediente(c.expediente_id)
        )
      );
    create policy urbanbrain_message_sources_owner_isolation on public.message_sources
      as restrictive for all to authenticated
      using (
        exists (
          select 1
          from public.messages as m
          inner join public.conversations as c on c.id = m.conversation_id
          where m.id = message_id
            and public.urbanbrain_can_access_expediente(c.expediente_id)
        )
      )
      with check (
        exists (
          select 1
          from public.messages as m
          inner join public.conversations as c on c.id = m.conversation_id
          where m.id = message_id
            and public.urbanbrain_can_access_expediente(c.expediente_id)
        )
      );
  end if;
end;
$policies$;

drop policy if exists "Users can view documents of their organization's expedientes" on public.documents;
drop policy if exists "Users can insert documents into their organization's expedientes" on public.documents;
drop policy if exists "Users can update documents of their organization's expedientes" on public.documents;
drop policy if exists urbanbrain_chat_messages_select_tenant on public.chat_messages;
drop policy if exists urbanbrain_context_detections_select_tenant on public.context_detections;
drop policy if exists urbanbrain_expediente_afecciones_select_tenant on public.expediente_afecciones;

do $storage$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists urbanbrain_expedientes_owner_select on storage.objects;
    create policy urbanbrain_expedientes_owner_select
      on storage.objects as restrictive for select to authenticated
      using (
        bucket_id <> 'expedientes'
        or exists (
          select 1
          from public.documents as d
          inner join public.expedientes as e on e.id = d.expediente_id
          where d.storage_path = name
            and e.owner_id = (select auth.uid())
        )
      );
  end if;
end;
$storage$;

commit;
