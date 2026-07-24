-- Fail-closed rollback: preserve owner data and block all browser access while
-- leaving the trusted server channel available for recovery.
begin;

do $block$
declare
  protected_table text;
begin
  foreach protected_table in array array[
    'expedientes',
    'conversations',
    'messages',
    'message_sources',
    'chat_messages',
    'documents',
    'document_chunks',
    'expediente_afecciones',
    'context_detections',
    'expediente_normative_context'
  ] loop
    if to_regclass('public.' || protected_table) is not null then
      execute format('alter table public.%I enable row level security', protected_table);
      execute format('alter table public.%I force row level security', protected_table);
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

  if to_regclass('storage.objects') is not null then
    drop policy if exists urbanbrain_expedientes_owner_select on storage.objects;
    create policy urbanbrain_expedientes_owner_select
      on storage.objects as restrictive for select to anon, authenticated
      using (bucket_id <> 'expedientes');
  end if;
end;
$block$;

commit;
