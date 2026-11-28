-- Enable the Bale reporting entry for active experts in every active department.
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
    join public.personnel p on p.id = m.employee_id
    join public.departments d on d.id = p.department_id
    where m.user_id = auth.uid()
      and m.role = 'expert'
      and p.active
      and d.active
  );
$$;

revoke all on function public.kpi_bale_pilot_access() from public, anon;
grant execute on function public.kpi_bale_pilot_access() to authenticated;
