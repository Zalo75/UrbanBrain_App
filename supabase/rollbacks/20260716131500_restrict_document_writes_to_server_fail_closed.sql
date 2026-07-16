-- Fail-closed rollback for private-beta document write hardening.
-- It deliberately does not restore browser writes or remove restrictive
-- policies, because doing so would recreate the viewer/direct-write bypass.
begin;

do $rollback$
begin
  if to_regclass('public.documents') is not null then
    revoke insert, update, delete on table public.documents
      from public, anon, authenticated;
    grant select, insert, update, delete on table public.documents to service_role;
  end if;

  if to_regclass('public.document_chunks') is not null then
    revoke insert, update, delete on table public.document_chunks
      from public, anon, authenticated;
    grant select, insert, update, delete on table public.document_chunks to service_role;
  end if;

  if to_regclass('storage.objects') is not null then
    grant select, insert, update, delete on table storage.objects to service_role;
  end if;
end;
$rollback$;

-- Recreate the migration-owned restrictions instead of removing them. This
-- rollback is intentionally fail-closed and is safe if run more than once.
do $storage_rollback$
begin
  if to_regclass('storage.objects') is not null then
    if not (
      select relrowsecurity
      from pg_catalog.pg_class
      where oid = 'storage.objects'::regclass
    ) then
      raise exception 'storage.objects must have RLS enabled';
    end if;

    drop policy if exists urbanbrain_exp442_signed_insert_only on storage.objects;
    drop policy if exists urbanbrain_exp442_signed_update_only on storage.objects;
    drop policy if exists urbanbrain_exp442_signed_delete_only on storage.objects;

    create policy urbanbrain_exp442_signed_insert_only
      on storage.objects as restrictive for insert to anon, authenticated
      with check (bucket_id <> 'expedientes');

    create policy urbanbrain_exp442_signed_update_only
      on storage.objects as restrictive for update to anon, authenticated
      using (bucket_id <> 'expedientes')
      with check (bucket_id <> 'expedientes');

    create policy urbanbrain_exp442_signed_delete_only
      on storage.objects as restrictive for delete to anon, authenticated
      using (bucket_id <> 'expedientes');
  end if;
end;
$storage_rollback$;

commit;
