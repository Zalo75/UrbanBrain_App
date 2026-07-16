-- Restrict private-beta document writes to the authorized server channel.
-- This migration changes only ACLs and RLS policies; it does not mutate data.
begin;

do $preflight$
declare
  required_relation text;
  required_role text;
begin
  foreach required_relation in array array[
    'public.documents',
    'public.document_chunks',
    'storage.buckets',
    'storage.objects'
  ] loop
    if to_regclass(required_relation) is null then
      raise exception 'Required document relation % does not exist', required_relation;
    end if;
  end loop;

  foreach required_role in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select 1 from pg_catalog.pg_roles where rolname = required_role) then
      raise exception 'Required role % does not exist', required_role;
    end if;
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'service_role' and rolbypassrls
  ) then
    raise exception 'service_role must have BYPASSRLS for the signed server flow';
  end if;

  if not exists (
    select 1 from storage.buckets where id = 'expedientes' and public is false
  ) then
    raise exception 'Required private storage bucket expedientes does not exist';
  end if;

  if not (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'storage.objects'::regclass
  ) then
    raise exception 'storage.objects must have RLS enabled';
  end if;
end;
$preflight$;

-- Metadata and derived chunks are written only by the server. Existing SELECT
-- grants and policies remain untouched so tenant-scoped reads keep working.
revoke insert, update, delete on table public.documents
  from public, anon, authenticated;
revoke insert, update, delete on table public.document_chunks
  from public, anon, authenticated;

grant select, insert, update, delete on table public.documents to service_role;
grant select, insert, update, delete on table public.document_chunks to service_role;
grant select, insert, update, delete on table storage.objects to service_role;

-- Restrictive policies are ANDed with every existing permissive policy. Their
-- names are owned by this migration, so differently named historical policies
-- cannot re-enable direct writes to the expediente bucket.
drop policy if exists urbanbrain_exp442_signed_insert_only on storage.objects;
drop policy if exists urbanbrain_exp442_signed_update_only on storage.objects;
drop policy if exists urbanbrain_exp442_signed_delete_only on storage.objects;

create policy urbanbrain_exp442_signed_insert_only
  on storage.objects
  as restrictive
  for insert
  to anon, authenticated
  with check (bucket_id <> 'expedientes');

create policy urbanbrain_exp442_signed_update_only
  on storage.objects
  as restrictive
  for update
  to anon, authenticated
  using (bucket_id <> 'expedientes')
  with check (bucket_id <> 'expedientes');

create policy urbanbrain_exp442_signed_delete_only
  on storage.objects
  as restrictive
  for delete
  to anon, authenticated
  using (bucket_id <> 'expedientes');

commit;
