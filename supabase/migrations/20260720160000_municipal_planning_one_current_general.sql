do $$
begin
  if exists (select 1 from public.municipal_planning where status = 'vigente' group by municipality_id having count(*) > 1) then
    raise exception 'municipal_planning has more than one vigente instrument for a municipality; resolve the catalogue before applying this constraint';
  end if;
end $$;

create unique index if not exists municipal_planning_one_vigente_per_municipality
  on public.municipal_planning (municipality_id)
  where status = 'vigente';
