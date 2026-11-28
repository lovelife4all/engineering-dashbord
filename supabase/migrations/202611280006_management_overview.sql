-- Official management reports use finalized submissions and omit raw entries.
create or replace function public.kpi_management_overview()
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  result jsonb;
begin
  if (public.kpi_access()->>'role') is distinct from 'management' then
    raise exception 'دسترسی به گزارش مدیریتی مجاز نیست.' using errcode = '42501';
  end if;

  with finalized as (
    select s.employee_id, s.period_year, s.period_month,
      to_jsonb(s)->>'submitted_at' as submitted_at
    from public.monthly_submissions s
    where s.status = 'submitted'
  ), buckets as (
    select l.period_year, l.period_month, l.employee_id, l.source, l.activity_id,
      l.stakeholder_id, l.project_id, sum(l.hours) as hours,
      sum(l.doc_count) as doc_count, count(*) as event_count
    from public.activity_logs l
    where exists (
      select 1 from finalized s
      where (s.employee_id, s.period_year, s.period_month) =
            (l.employee_id, l.period_year, l.period_month)
    )
    group by l.period_year, l.period_month, l.employee_id, l.source, l.activity_id,
      l.stakeholder_id, l.project_id
  )
  select jsonb_build_object(
    'logs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'period_year', b.period_year, 'period_month', b.period_month, 'source', b.source,
        'hours', b.hours, 'doc_count', b.doc_count, 'event_count', b.event_count,
        'activity_id', b.activity_id, 'project_id', b.project_id, 'stakeholder_id', b.stakeholder_id,
        'employee', jsonb_build_object('id', p.id,
          'department', jsonb_build_object('id', d.id, 'name_fa', d.name_fa)),
        'activity', jsonb_build_object('id', a.id, 'general_fa', a.general_fa,
          'specific_title', a.specific_title, 'effort_score', coalesce(e.effort_score, a.effort_score),
          'value_score', a.value_score),
        'project', case when pr.id is not null then
          jsonb_build_object('name_fa', pr.name_fa, 'contract_no', pr.contract_no) end,
        'stakeholder', case when st.id is not null then
          jsonb_build_object('name_fa', st.name_fa) end
      ) order by b.period_year, b.period_month, b.employee_id, b.activity_id)
      from buckets b
      join public.personnel p on p.id = b.employee_id
      join public.departments d on d.id = p.department_id
      left join public.activities a on a.id = b.activity_id
      left join engineering_access.department_activity_effort e
        on e.department_id = p.department_id and e.activity_id = b.activity_id
      left join public.projects pr on pr.id = b.project_id
      left join public.stakeholders st on st.id = b.stakeholder_id
    ), '[]'::jsonb),
    'personnel', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name_en', p.name_en, 'active', p.active,
        'department', jsonb_build_object('id', d.id, 'name_fa', d.name_fa)) order by p.id)
      from public.personnel p join public.departments d on d.id = p.department_id
    ), '[]'::jsonb),
    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object('employee_id', s.employee_id,
        'period_year', s.period_year, 'period_month', s.period_month,
        'status', 'submitted', 'submitted_at', s.submitted_at))
      from finalized s
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$function$;

revoke all on function public.kpi_management_overview() from public, anon;
grant execute on function public.kpi_management_overview() to authenticated;
