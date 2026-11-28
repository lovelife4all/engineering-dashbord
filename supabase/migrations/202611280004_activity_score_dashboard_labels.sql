-- شناسه و نام واحد را کنار ردیف داشبورد می‌فرستیم تا فعالیتی که در چند واحد Effort متفاوت دارد جدا محاسبه شود.
CREATE OR REPLACE FUNCTION public.kpi_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
declare r text:=coalesce(public.kpi_access()->>'role',''); my_dept integer; depts integer[]; result jsonb;
begin
if r not in ('admin','management','head') then raise exception 'دسترسی به داشبورد مجاز نیست.' using errcode='42501'; end if;
if r='head' then
  select p.department_id into my_dept from public.personnel p where p.id=(public.kpi_access()->>'employee_id')::integer and p.active;
  if my_dept is null then raise exception 'دپارتمان فعال برای این حساب پیدا نشد.' using errcode='42501'; end if;
  select coalesce(array_agg(d.id order by d.id),array[my_dept]) into depts from public.departments d where d.discipline_code=(select discipline_code from public.departments where id=my_dept) and d.active;
  depts:=depts||my_dept;
end if;
with buckets as (
  select l.period_year,l.period_month,l.employee_id,l.source,l.activity_id,l.stakeholder_id,sum(l.hours) hours,sum(l.doc_count) doc_count,count(*) event_count
  from public.activity_logs l left join public.monthly_submissions s using(employee_id,period_year,period_month)
  join public.personnel lp on lp.id=l.employee_id
  where s.status is distinct from 'draft' and (r<>'head' or lp.department_id=any(depts)) group by 1,2,3,4,5,6)
select jsonb_build_object(
'logs',coalesce((select jsonb_agg(jsonb_build_object('period_year',b.period_year,'period_month',b.period_month,'hours',b.hours,'doc_count',b.doc_count,'event_count',b.event_count,'source',b.source,'activity_id',b.activity_id,'employee',jsonb_build_object('id',p.id,'department',jsonb_build_object('id',d.id,'name_fa',d.name_fa)), 'activity',jsonb_build_object('id',a.id,'general_fa',a.general_fa,'specific_title',a.specific_title,'effort_score',coalesce((select e.effort_score from engineering_access.department_activity_effort e where e.department_id=p.department_id and e.activity_id=b.activity_id),a.effort_score),'value_score',a.value_score),'stakeholder',case when t.id is not null then jsonb_build_object('name_fa',t.name_fa) end) order by b.period_year,b.period_month) from buckets b join public.personnel p on p.id=b.employee_id join public.departments d on d.id=p.department_id join public.activities a on a.id=b.activity_id left join public.stakeholders t on t.id=b.stakeholder_id),'[]'::jsonb),
'personnel',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name_en',p.name_en,'active',p.active,'department',jsonb_build_object('name_fa',d.name_fa)) order by p.id) from public.personnel p join public.departments d on d.id=p.department_id where r<>'head' or p.department_id=any(depts)),'[]'::jsonb),
'submissions',coalesce((select jsonb_agg(jsonb_build_object('employee_id',s.employee_id,'period_year',s.period_year,'period_month',s.period_month,'status',s.status) order by s.employee_id) from public.monthly_submissions s join public.personnel sp on sp.id=s.employee_id where s.status='submitted' and (r<>'head' or sp.department_id=any(depts))),'[]'::jsonb),
'scope',case when r='head' then jsonb_build_object('departments',(select jsonb_agg(d.name_fa order by d.name_fa) from public.departments d where d.id=any(depts))) else null end,
'role',r) into result;
return result;
end $function$;
