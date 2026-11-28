-- امتیاز Effort مستقل برای هر دپارتمان؛ مقدار Value همچنان سراسری و در اختیار مدیریت است.
CREATE TABLE IF NOT EXISTS engineering_access.department_activity_effort (
  department_id integer NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  activity_id integer NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  effort_score smallint NOT NULL CHECK (effort_score BETWEEN 1 AND 10),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id,activity_id)
);
ALTER TABLE engineering_access.department_activity_effort ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE engineering_access.department_activity_effort FROM anon,authenticated;

-- حفظ امتیازهای فعلی به‌عنوان پیش‌فرض اولیه برای همهٔ واحدها.
INSERT INTO engineering_access.department_activity_effort(department_id,activity_id,effort_score)
SELECT d.id,a.id,a.effort_score
FROM public.departments d CROSS JOIN public.activities a
WHERE d.active AND a.active
ON CONFLICT(department_id,activity_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.kpi_activity_score_list()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
declare r text:=coalesce(public.kpi_access()->>'role',''); my_dept integer; result jsonb;
begin
  if r not in ('admin','management','head') then raise exception 'مشاهدهٔ امتیاز فعالیت‌ها مجاز نیست.' using errcode='42501'; end if;
  if r='head' then
    select p.department_id into my_dept from public.personnel p where p.id=(public.kpi_access()->>'employee_id')::integer and p.active;
    if my_dept is null then raise exception 'دپارتمان فعال برای این حساب پیدا نشد.' using errcode='42501'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'activity_id',a.id,'general_fa',a.general_fa,'specific_title',a.specific_title,
    'effort_score',coalesce(e.effort_score,a.effort_score),'value_score',a.value_score,
    'department_id',case when r='head' then my_dept else null end,
    'department',case when r='head' then d.name_fa else null end
  ) order by a.general_fa,a.specific_title,a.id),'[]'::jsonb)
  into result
  from public.activities a
  left join engineering_access.department_activity_effort e on e.activity_id=a.id and r='head' and e.department_id=my_dept
  left join public.departments d on d.id=my_dept
  where a.active;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.kpi_set_activity_effort(p_activity_id integer,p_effort_score integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare r text:=coalesce(public.kpi_access()->>'role',''); my_dept integer;
begin
  if r<>'head' then raise exception 'تنظیم Effort فقط برای رییس دپارتمان مجاز است.' using errcode='42501'; end if;
  if p_effort_score is null or p_effort_score not between 1 and 10 then raise exception 'Effort باید عدد صحیح بین ۱ تا ۱۰ باشد.' using errcode='22023'; end if;
  select p.department_id into my_dept from public.personnel p where p.id=(public.kpi_access()->>'employee_id')::integer and p.active;
  if my_dept is null then raise exception 'دپارتمان فعال برای این حساب پیدا نشد.' using errcode='42501'; end if;
  if not exists(select 1 from public.activities where id=p_activity_id and active) then raise exception 'نوع فعالیت فعال پیدا نشد.' using errcode='22023'; end if;
  insert into engineering_access.department_activity_effort(department_id,activity_id,effort_score,updated_by,updated_at)
  values(my_dept,p_activity_id,p_effort_score,auth.uid(),now())
  on conflict(department_id,activity_id) do update set effort_score=excluded.effort_score,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  return jsonb_build_object('department_id',my_dept,'activity_id',p_activity_id,'effort_score',p_effort_score);
end $function$;

CREATE OR REPLACE FUNCTION public.kpi_set_activity_value(p_activity_id integer,p_value_score integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare r text:=coalesce(public.kpi_access()->>'role','');
begin
  if r not in ('management','admin') then raise exception 'تنظیم Value فقط برای مدیریت مجاز است.' using errcode='42501'; end if;
  if p_value_score is null or p_value_score not between 1 and 7 then raise exception 'Value باید عدد صحیح بین ۱ تا ۷ باشد.' using errcode='22023'; end if;
  update public.activities set value_score=p_value_score where id=p_activity_id and active;
  if not found then raise exception 'نوع فعالیت فعال پیدا نشد.' using errcode='22023'; end if;
  return jsonb_build_object('activity_id',p_activity_id,'value_score',p_value_score);
end $function$;

-- نقشهٔ امتیاز تلاش برای نمایش در داشبورد کلی ادمین.
CREATE OR REPLACE FUNCTION public.kpi_effort_score_map()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if (public.kpi_access()->>'role') is distinct from 'admin' then raise exception 'دسترسی به نقشهٔ امتیازهای Effort مجاز نیست.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('department_id',e.department_id,'activity_id',e.activity_id,'effort_score',e.effort_score) order by e.department_id,e.activity_id),'[]'::jsonb)
  into result
  from engineering_access.department_activity_effort e
  join public.departments d on d.id=e.department_id and d.active
  join public.activities a on a.id=e.activity_id and a.active;
  return result;
end $function$;

-- اعمال Effort مصوب هر واحد بر فعالیت‌های ثبت‌شده در داشبورد.
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
  from public.activity_logs l
  left join public.monthly_submissions s using(employee_id,period_year,period_month)
  join public.personnel lp on lp.id=l.employee_id
  where s.status is distinct from 'draft' and (r<>'head' or lp.department_id=any(depts))
  group by 1,2,3,4,5,6)
select jsonb_build_object(
'logs',coalesce((select jsonb_agg(jsonb_build_object('period_year',b.period_year,'period_month',b.period_month,'hours',b.hours,'doc_count',b.doc_count,'event_count',b.event_count,'source',b.source,'activity_id',b.activity_id,'employee',jsonb_build_object('id',p.id,'department',jsonb_build_object('id',d.id,'name_fa',d.name_fa)), 'activity',jsonb_build_object('id',a.id,'general_fa',a.general_fa,'specific_title',a.specific_title,'effort_score',coalesce((select e.effort_score from engineering_access.department_activity_effort e where e.department_id=p.department_id and e.activity_id=b.activity_id),a.effort_score),'value_score',a.value_score),'stakeholder',case when t.id is not null then jsonb_build_object('name_fa',t.name_fa) end) order by b.period_year,b.period_month) from buckets b join public.personnel p on p.id=b.employee_id join public.departments d on d.id=p.department_id join public.activities a on a.id=b.activity_id left join public.stakeholders t on t.id=b.stakeholder_id),'[]'::jsonb),
'personnel',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name_en',p.name_en,'active',p.active,'department',jsonb_build_object('name_fa',d.name_fa)) order by p.id) from public.personnel p join public.departments d on d.id=p.department_id where r<>'head' or p.department_id=any(depts)),'[]'::jsonb),
'submissions',coalesce((select jsonb_agg(jsonb_build_object('employee_id',s.employee_id,'period_year',s.period_year,'period_month',s.period_month,'status',s.status) order by s.employee_id) from public.monthly_submissions s join public.personnel sp on sp.id=s.employee_id where s.status='submitted' and (r<>'head' or sp.department_id=any(depts))),'[]'::jsonb),
'scope',case when r='head' then jsonb_build_object('departments',(select jsonb_agg(d.name_fa order by d.name_fa) from public.departments d where d.id=any(depts))) else null end,
'role',r) into result;
return result;
end $function$;

-- فرم کارشناسی هم امتیاز Effort واحد خودش را دریافت می‌کند.
CREATE OR REPLACE FUNCTION public.kpi_expert_form()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
declare eid integer; result jsonb;
begin
select (public.kpi_access()->>'employee_id')::integer into eid;
if eid is null then raise exception 'دسترسی به فرم کارشناس مجاز نیست.' using errcode='42501'; end if;
select jsonb_build_object(
'personnel',jsonb_build_array(jsonb_build_object('id',p.id,'employee_no',p.employee_no,'name_en',p.name_en,'active',p.active,'department',jsonb_build_object('name_fa',d.name_fa))),
'activities',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'general_fa',a.general_fa,'specific_title',a.specific_title,'avg_hours_doc',a.avg_hours_doc,'effort_score',coalesce(e.effort_score,a.effort_score),'value_score',a.value_score) order by a.general_fa,a.id) from public.activities a left join engineering_access.department_activity_effort e on e.activity_id=a.id and e.department_id=p.department_id where a.active),'[]'::jsonb),
'stakeholders',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name_fa',t.name_fa) order by t.name_fa) from public.stakeholders t where t.active),'[]'::jsonb),
'projects',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name_fa',r.name_fa) order by r.name_fa) from public.projects r where r.active),'[]'::jsonb),
'logs',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'employee',jsonb_build_object('id',eid),'period_year',l.period_year,'period_month',l.period_month,'hours',l.hours,'doc_count',l.doc_count,'source',l.source,'activity_id',l.activity_id,'stakeholder_id',l.stakeholder_id,'project_id',l.project_id,'letter_date',l.letter_date,'notes',l.notes,'activity',jsonb_build_object('general_fa',a.general_fa,'specific_title',a.specific_title),'stakeholder',case when t.id is not null then jsonb_build_object('name_fa',t.name_fa) end) order by l.id) from public.activity_logs l join public.activities a on a.id=l.activity_id left join public.stakeholders t on t.id=l.stakeholder_id where l.employee_id=eid),'[]'::jsonb),
'submissions',coalesce((select jsonb_agg(jsonb_build_object('employee_id',s.employee_id,'period_year',s.period_year,'period_month',s.period_month,'status',s.status)) from public.monthly_submissions s where s.employee_id=eid),'[]'::jsonb)) into result from public.personnel p join public.departments d on d.id=p.department_id where p.id=eid;
return result;
end $function$;
