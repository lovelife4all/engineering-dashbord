-- Use the existing dashboard roles for entry from the Bale mini-app.
create or replace function public.kpi_bale_pilot_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from engineering_access.members m
    left join public.personnel p on p.id = m.employee_id
    left join public.departments d on d.id = p.department_id
    where m.user_id = auth.uid()
      and (
        m.role in ('admin', 'management')
        or (m.role in ('expert', 'head') and p.active and d.active)
      )
  );
$$;

revoke all on function public.kpi_bale_pilot_access() from public, anon;
grant execute on function public.kpi_bale_pilot_access() to authenticated;
