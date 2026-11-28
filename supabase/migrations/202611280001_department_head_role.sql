-- مهاجرت: نقش «رییس دپارتمان» (محدود به واحد خودش)، ساخت حساب با ایمیل/رمز و فهرست حساب‌ها
-- روی پروژهٔ Supabase (engineering-kpi) اعمال شده است: department_head_core + department_head_accounts
-- 1) نقش جدید «رییس دپارتمان» و اتصال آن به کارشناس (پرسنلی)
alter table engineering_access.members drop constraint if exists members_role_check;
alter table engineering_access.members add constraint members_role_check check (role in ('admin','management','head','expert'));
alter table engineering_access.members drop constraint if exists members_check;
alter table engineering_access.members add constraint members_check check (role in ('expert','head') = (employee_id is not null));

-- 2) دسترسی: رییس دپارتمان هم کارشناس متصل دارد
CREATE OR REPLACE FUNCTION public.kpi_access()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
select coalesce((select jsonb_build_object('role',m.role,'employee_id',m.employee_id,'department',d.name_fa,'department_id',d.id)
  from engineering_access.members m
  left join public.personnel p on p.id=m.employee_id
  left join public.departments d on d.id=p.department_id
  where m.user_id=auth.uid() and (m.role not in ('expert','head') or p.active)), '{}'::jsonb);
$function$;

-- 3) داشبورد محدود به واحد رییس دپارتمان
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
'logs',coalesce((select jsonb_agg(jsonb_build_object('period_year',b.period_year,'period_month',b.period_month,'hours',b.hours,'doc_count',b.doc_count,'event_count',b.event_count,'source',b.source,'employee',jsonb_build_object('id',p.id,'department',jsonb_build_object('name_fa',d.name_fa)), 'activity',jsonb_build_object('general_fa',a.general_fa,'specific_title',a.specific_title,'effort_score',a.effort_score,'value_score',a.value_score),'stakeholder',case when t.id is not null then jsonb_build_object('name_fa',t.name_fa) end) order by b.period_year,b.period_month) from buckets b join public.personnel p on p.id=b.employee_id join public.departments d on d.id=p.department_id join public.activities a on a.id=b.activity_id left join public.stakeholders t on t.id=b.stakeholder_id),'[]'::jsonb),
'personnel',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name_en',p.name_en,'active',p.active,'department',jsonb_build_object('name_fa',d.name_fa)) order by p.id) from public.personnel p join public.departments d on d.id=p.department_id where r<>'head' or p.department_id=any(depts)),'[]'::jsonb),
'submissions',coalesce((select jsonb_agg(jsonb_build_object('employee_id',s.employee_id,'period_year',s.period_year,'period_month',s.period_month,'status',s.status) order by s.employee_id) from public.monthly_submissions s join public.personnel sp on sp.id=s.employee_id where s.status='submitted' and (r<>'head' or sp.department_id=any(depts))),'[]'::jsonb),
'scope',case when r='head' then jsonb_build_object('departments',(select jsonb_agg(d.name_fa order by d.name_fa) from public.departments d where d.id=any(depts))) else null end,
'role',r) into result;
return result;
end $function$;

-- 4) بار پروژه‌ها/ذینفعان محدود به واحد رییس دپارتمان
CREATE OR REPLACE FUNCTION public.kpi_project_load(p_demo boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
declare r text:=coalesce(public.kpi_access()->>'role',''); my_dept integer; depts integer[]; outp jsonb;
begin
 if r not in ('admin','management','head') then raise exception 'مشاهدهٔ بار پروژه‌ها مجاز نیست.' using errcode='42501'; end if;
 if r='head' then
   select p.department_id into my_dept from public.personnel p where p.id=(public.kpi_access()->>'employee_id')::integer and p.active;
   if my_dept is null then raise exception 'دپارتمان فعال برای این حساب پیدا نشد.' using errcode='42501'; end if;
   select coalesce(array_agg(d.id order by d.id),array[my_dept]) into depts from public.departments d where d.discipline_code=(select discipline_code from public.departments where id=my_dept) and d.active;
   depts:=depts||my_dept;
 end if;
 with lines as (
   select l.period_year,l.period_month,l.employee_id,l.project_id,l.stakeholder_id,l.hours
   from public.activity_logs l
   left join public.monthly_submissions s using(employee_id,period_year,period_month)
   join public.personnel lp on lp.id=l.employee_id
   where (not coalesce(p_demo,false) or (l.period_year=1405 and l.period_month=6))
     and (r<>'head' or lp.department_id=any(depts))
     and ((r='admin' and not coalesce(p_demo,false)) or s.status is distinct from 'draft')
   union all
   select period_year,period_month,employee_id,project_id,stakeholder_id,hours from engineering_access.demo_activity where p_demo is true
 ),totals as (select period_year,period_month,employee_id,project_id,stakeholder_id,sum(hours) hours from lines group by 1,2,3,4,5)
 select coalesce(jsonb_agg(jsonb_build_object('period_year',t.period_year,'period_month',t.period_month,'employee_id',t.employee_id,'department',d.name_fa,'project_id',t.project_id,'project',rj.name_fa,'project_code',rj.contract_no,'stakeholder_id',t.stakeholder_id,'stakeholder',s.name_fa,'hours',t.hours) order by t.period_year,t.period_month,t.employee_id,t.project_id,t.stakeholder_id),'[]'::jsonb) into outp
 from totals t join public.personnel p on p.id=t.employee_id join public.departments d on d.id=p.department_id left join public.projects rj on rj.id=t.project_id left join public.stakeholders s on s.id=t.stakeholder_id;
 return outp;
end $function$;

-- 5) مدیریت فهرست‌ها: ادارهٔ واحد هم مجاز (فقط همان واحد)
CREATE OR REPLACE FUNCTION public.kpi_catalog(p_kind text, p_action text DEFAULT 'list', p_id integer DEFAULT NULL, p_name text DEFAULT NULL, p_meta jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare tab text; result jsonb; rid integer; label text:=nullif(btrim(p_name),''); emp text:=nullif(btrim(p_meta->>'employee_no'),''); dep integer; st integer; contract text:=nullif(btrim(p_meta->>'contract_no'),''); r text:=coalesce(public.kpi_access()->>'role',''); my_dept integer; depts integer[]; target_dept integer;
begin
if r not in ('admin','head') then raise exception 'مدیریت فهرست‌ها مجاز نیست.' using errcode='42501'; end if;
if r='head' then
  select p.department_id into my_dept from public.personnel p where p.id=(public.kpi_access()->>'employee_id')::integer and p.active;
  if my_dept is null then raise exception 'دپارتمان فعال برای این حساب پیدا نشد.' using errcode='42501'; end if;
  select coalesce(array_agg(d.id order by d.id),array[my_dept]) into depts from public.departments d where d.discipline_code=(select discipline_code from public.departments where id=my_dept) and d.active;
  depts:=depts||my_dept;
end if;
tab:=case p_kind when 'personnel' then 'personnel' when 'projects' then 'projects' when 'stakeholders' then 'stakeholders' when 'departments' then 'departments' end;
if tab is null then raise exception 'فهرست نامعتبر است.' using errcode='22023'; end if;
if p_action='list' then
 if p_kind='personnel' then select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name_en,'active',p.active,'employee_no',p.employee_no,'department',d.name_fa,'department_id',p.department_id) order by p.active desc,p.name_en,p.id),'[]'::jsonb) into result from public.personnel p join public.departments d on d.id=p.department_id where r<>'head' or p.department_id=any(depts);
 elsif p_kind='projects' then select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name_fa,'active',p.active,'contract_no',p.contract_no,'stakeholder',s.name_fa) order by p.active desc,p.name_fa,p.id),'[]'::jsonb) into result from public.projects p left join public.stakeholders s on s.id=p.stakeholder_id;
 elsif p_kind='departments' then select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name_fa,'active',d.active) order by d.active desc,d.name_fa,d.id),'[]'::jsonb) into result from public.departments d where r<>'head' or d.id=any(depts);
 else execute format('select coalesce(jsonb_agg(jsonb_build_object(''id'',id,''name'',name_fa,''active'',active) order by active desc,name_fa,id),''[]''::jsonb) from public.%I',tab) into result; end if;
 return result;
end if;
if p_kind='departments' then raise exception 'ویرایش این فهرست در این فرم مجاز نیست.' using errcode='42501'; end if;
if r='head' then
  if not (p_kind='personnel' and p_action in ('add','archive','restore')) then raise exception 'رییس دپارتمان فقط می‌تواند کارشناسان واحد خود را مدیریت کند.' using errcode='42501'; end if;
  if p_action='add' then target_dept:=(p_meta->>'department_id')::integer; end if;
  if p_action in ('archive','restore') then select department_id into target_dept from public.personnel where id=p_id; end if;
  if target_dept is null or not (target_dept=any(depts)) then raise exception 'فقط کارشناسان واحد خودتان قابل مدیریت‌اند.' using errcode='42501'; end if;
end if;
perform pg_advisory_xact_lock(68240,0);
if p_action in ('archive','restore') then
 execute format('update public.%I set active=$1 where id=$2 returning id',tab) into rid using p_action='restore',p_id;
 if rid is null then raise exception 'مورد انتخاب‌شده پیدا نشد.' using errcode='22023'; end if;
elsif p_action='add' then
 if label is null or length(label)>250 or length(emp)>40 or length(contract)>100 then raise exception 'نام و طول مشخصات را بررسی کنید.' using errcode='22023'; end if;
 if p_kind='personnel' then
  dep:=(p_meta->>'department_id')::integer;
  if emp is null or not exists(select 1 from public.departments where id=dep and active) then raise exception 'کد پرسنلی و دپارتمان فعال الزامی است.' using errcode='22023'; end if;
  insert into public.personnel(employee_no,name_en,department_id,discipline_code) select emp,label,id,discipline_code from public.departments where id=dep returning id into rid;
 elsif p_kind='projects' then
  st:=(p_meta->>'stakeholder_id')::integer;
  if st is not null and not exists(select 1 from public.stakeholders where id=st and active) then raise exception 'ذینفع پروژه باید فعال باشد.' using errcode='22023'; end if;
  if exists(select 1 from public.projects where lower(btrim(name_fa))=lower(label) and coalesce(btrim(contract_no),'')=coalesce(contract,'')) then raise unique_violation; end if;
  insert into public.projects(name_fa,contract_no,stakeholder_id) values(label,contract,st) returning id into rid;
 else
  if exists(select 1 from public.stakeholders where lower(btrim(name_fa))=lower(label)) then raise unique_violation; end if;
  insert into public.stakeholders(name_fa) values(label) returning id into rid;
 end if;
else raise exception 'عملیات فهرست نامعتبر است.' using errcode='22023'; end if;
return jsonb_build_object('id',rid);
exception when unique_violation then raise exception 'این مورد از قبل وجود دارد. اگر بایگانی شده است، آن را بازیابی کنید.' using errcode='23505';
end $function$;

-- 6) تعیین نقش: پشتیبانی از رییس دپارتمان
CREATE OR REPLACE FUNCTION public.kpi_set_role(p_email text, p_role text, p_employee_no text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare target uuid; eid integer;
begin
if (public.kpi_access()->>'role') is distinct from 'admin' then raise exception 'فقط ادمین مجاز به تغییر نقش است.' using errcode='42501'; end if;
select id into target from auth.users where lower(email)=lower(btrim(p_email)) and deleted_at is null and coalesce(is_sso_user,false)=false;
if target is null then raise exception 'ابتدا حساب را در بخش Authentication ایجاد کنید.' using errcode='22023'; end if;
if target=auth.uid() or target='e8813830-7e04-44ae-b10b-f35e63aecaab'::uuid then raise exception 'نقش حساب خودتان یا ادمین اولیه از اینجا تغییر نمی‌کند.' using errcode='42501'; end if;
if p_role='none' then delete from engineering_access.members where user_id=target; return jsonb_build_object('role','none'); end if;
if p_role is null or p_role not in ('admin','management','head','expert') then raise exception 'نقش نامعتبر است.' using errcode='22023'; end if;
if p_role in ('expert','head') then select id into eid from public.personnel where employee_no=btrim(p_employee_no) and active; if eid is null then raise exception 'کد پرسنلی فعال پیدا نشد.' using errcode='22023'; end if; end if;
insert into engineering_access.members(user_id,role,employee_id) values(target,p_role,eid) on conflict(user_id) do update set role=excluded.role,employee_id=excluded.employee_id;
return jsonb_build_object('role',p_role);
exception when unique_violation then raise exception 'این کد پرسنلی به حساب دیگری متصل است.' using errcode='23505'; end $function$;

-- 7) فهرست حساب‌ها و نقش‌ها برای ادمین
CREATE OR REPLACE FUNCTION public.kpi_accounts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
declare result jsonb;
begin
if (public.kpi_access()->>'role') is distinct from 'admin' then raise exception 'مشاهدهٔ حساب‌ها فقط برای ادمین مجاز است.' using errcode='42501'; end if;
select coalesce(jsonb_agg(jsonb_build_object('email',u.email,'role',coalesce(m.role,'none'),'employee_id',m.employee_id,'employee_no',p.employee_no,'name',p.name_en,'department',d.name_fa,'active',p.active) order by coalesce(m.role,'none'),u.email),'[]'::jsonb) into result
from auth.users u left join engineering_access.members m on m.user_id=u.id
 left join public.personnel p on p.id=m.employee_id left join public.departments d on d.id=p.department_id
 where u.deleted_at is null;
return result;
end $function$;

-- 8) ساخت حساب کاربری با ایمیل و رمز (فقط ادمین) و اتصال نقش
create extension if not exists pgcrypto with schema extensions;

CREATE OR REPLACE FUNCTION public.kpi_create_account(p_email text, p_password text, p_role text DEFAULT 'expert', p_employee_no text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare target uuid; eid integer; em text:=lower(btrim(p_email));
begin
if (public.kpi_access()->>'role') is distinct from 'admin' then raise exception 'ساخت حساب فقط برای ادمین مجاز است.' using errcode='42501'; end if;
if em is null or em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'ایمیل معتبر وارد کنید.' using errcode='22023'; end if;
if p_password is null or length(p_password)<8 then raise exception 'رمز عبور باید حداقل ۸ کاراکتر باشد.' using errcode='22023'; end if;
if p_role is null or p_role not in ('admin','management','head','expert') then raise exception 'نقش نامعتبر است.' using errcode='22023'; end if;
if p_role in ('expert','head') then select id into eid from public.personnel where employee_no=btrim(p_employee_no) and active; if eid is null then raise exception 'کد پرسنلی فعال پیدا نشد؛ ابتدا فرد را در فهرست کارشناسان اضافه کنید.' using errcode='22023'; end if; end if;
if exists(select 1 from auth.users where lower(email)=em) then raise exception 'حسابی با این ایمیل از قبل وجود دارد.' using errcode='23505'; end if;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_sso_user,is_anonymous)
values('00000000-0000-0000-0000-000000000000',gen_random_uuid(),'authenticated','authenticated',em,extensions.crypt(p_password,extensions.gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,false,false)
returning id into target;
insert into auth.identities(id,user_id,provider_id,provider,identity_data,last_sign_in_at,created_at,updated_at)
values(gen_random_uuid(),target,target::text,'email',jsonb_build_object('sub',target::text,'email',em,'email_verified',true),now(),now(),now());
insert into engineering_access.members(user_id,role,employee_id) values(target,p_role,eid) on conflict(user_id) do update set role=excluded.role,employee_id=excluded.employee_id;
return jsonb_build_object('email',em,'role',p_role);
exception when unique_violation then raise exception 'این کد پرسنلی به حساب دیگری متصل است.' using errcode='23505';
end $function$;
