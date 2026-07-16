-- Document writes in the private beta are authorized by server actions.
-- Signed upload tokens are issued only after checking the expediente role.
begin;

do $block$
begin
  if to_regclass('public.documents') is not null then
    revoke insert, update, delete on table public.documents from public, anon, authenticated;
    grant select, insert, update, delete on table public.documents to service_role;
  end if;

  if to_regclass('storage.objects') is not null then
    revoke insert, update, delete on table storage.objects from public, anon, authenticated;
    grant select, insert, update, delete on table storage.objects to service_role;
  end if;
end;
$block$;

commit;
