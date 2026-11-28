-- نام کاربری پرسنل = کد پرسنلی؛ رمز اولیه همان کد و تغییر آن در ورود اول اجباری است.
-- برای سازگاری با Supabase Auth، حساب‌های پرسنلی از ایمیل داخلی غیرقابل‌دریافت استفاده می‌کنند.

ALTER TABLE engineering_access.members
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.kpi_access()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
select coalesce((
  select case when m.must_change_password then
    jsonb_build_object('must_change_password',true,'employee_no',p.employee_no)
  else
    jsonb_build_object('role',m.role,'employee_id',m.employee_id,'employee_no',p.employee_no,
      'department',d.name_fa,'department_id',d.id,'must_change_password',false)
  end
  from engineering_access.members m
  left join public.personnel p on p.id=m.employee_id
  left join public.departments d on d.id=p.department_id
  where m.user_id=auth.uid() and (m.role not in ('expert','head') or p.active)
), '{}'::jsonb);
$function$;

-- پاک‌کردن پرچم فقط پس از اینکه رمز ذخیره‌شده دیگر با کد پرسنلی تطبیق نکند.
CREATE OR REPLACE FUNCTION public.kpi_finish_first_login()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare emp text; hashed text;
begin
  select p.employee_no,u.encrypted_password into emp,hashed
  from engineering_access.members m
  join public.personnel p on p.id=m.employee_id
  join auth.users u on u.id=m.user_id
  where m.user_id=auth.uid() and m.must_change_password and p.active;
  if emp is null then raise exception 'این حساب نیازی به تکمیل فعال‌سازی ندارد.' using errcode='42501'; end if;
  if hashed is null or extensions.crypt(emp,hashed)=hashed then
    raise exception 'رمز اولیه هنوز تغییر نکرده است.' using errcode='22023';
  end if;
  update engineering_access.members set must_change_password=false where user_id=auth.uid();
  return jsonb_build_object('ok',true);
end $function$;

-- ساخت یا ارتقای حساب یک پرسنل. اگر حساب ایمیلی قبلی به همین پرسنل متصل باشد،
-- نام کاربری و رمز آن به کد پرسنلی تغییر می‌کند و تعویض رمز در ورود اول اجباری می‌شود.
CREATE OR REPLACE FUNCTION public.kpi_provision_employee_account(p_employee_no text,p_role text DEFAULT 'expert')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  emp text:=btrim(p_employee_no);
  em text;
  wanted_role text:=coalesce(p_role,'expert');
  eid integer;
  target uuid;
  old_email text;
  changed boolean:=false;
begin
  if (public.kpi_access()->>'role') is distinct from 'admin' then
    raise exception 'ساخت حساب فقط برای ادمین مجاز است.' using errcode='42501';
  end if;
  if emp is null or emp !~ '^[0-9]+$' then
    raise exception 'کد پرسنلی باید فقط شامل رقم باشد.' using errcode='22023';
  end if;
  if wanted_role not in ('expert','head') then
    raise exception 'برای حساب پرسنلی فقط نقش کارشناس یا رییس دپارتمان مجاز است.' using errcode='22023';
  end if;
  select id into eid from public.personnel where employee_no=emp and active;
  if eid is null then raise exception 'کد پرسنلی فعال پیدا نشد.' using errcode='22023'; end if;
  em:=emp||'@staff.engkpi.invalid';

  select m.user_id,u.email into target,old_email
  from engineering_access.members m join auth.users u on u.id=m.user_id
  where m.employee_id=eid and u.deleted_at is null and coalesce(u.is_sso_user,false)=false;

  if target is null then
    if exists(select 1 from auth.users where lower(email)=lower(em) and deleted_at is null) then
      raise exception 'این نام کاربری از قبل به حساب دیگری متصل است؛ بررسی دستی لازم است.' using errcode='23505';
    end if;
    target:=gen_random_uuid();
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_sso_user,is_anonymous)
    values('00000000-0000-0000-0000-000000000000',target,'authenticated','authenticated',em,
      extensions.crypt(emp,extensions.gen_salt('bf')),now(),now(),now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('employee_no',emp),false,false);
    insert into auth.identities(id,user_id,provider_id,provider,identity_data,last_sign_in_at,created_at,updated_at)
    values(gen_random_uuid(),target,target::text,'email',
      jsonb_build_object('sub',target::text,'email',em,'email_verified',true),null,now(),now());
    changed:=true;
  elsif old_email is distinct from em then
    if exists(select 1 from auth.users where lower(email)=lower(em) and id<>target and deleted_at is null) then
      raise exception 'نام کاربری کد پرسنلی از قبل استفاده شده است.' using errcode='23505';
    end if;
    update auth.users set email=em,
      encrypted_password=extensions.crypt(emp,extensions.gen_salt('bf')),
      email_confirmed_at=coalesce(email_confirmed_at,now()),updated_at=now(),
      raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('employee_no',emp)
    where id=target;
    update auth.identities set provider_id=target::text,
      identity_data=coalesce(identity_data,'{}'::jsonb)||jsonb_build_object('sub',target::text,'email',em,'email_verified',true),updated_at=now()
    where user_id=target and provider='email';
    if not found then
      insert into auth.identities(id,user_id,provider_id,provider,identity_data,last_sign_in_at,created_at,updated_at)
      values(gen_random_uuid(),target,target::text,'email',jsonb_build_object('sub',target::text,'email',em,'email_verified',true),null,now(),now());
    end if;
    changed:=true;
  end if;

  insert into engineering_access.members(user_id,role,employee_id,must_change_password)
  values(target,wanted_role,eid,changed)
  on conflict(user_id) do update set role=excluded.role,employee_id=excluded.employee_id,
    must_change_password=case when changed then true else engineering_access.members.must_change_password end;

  return jsonb_build_object('username',emp,'role',wanted_role,'must_change_password',
    (select m.must_change_password from engineering_access.members m where m.user_id=target));
exception when unique_violation then
  raise exception 'این کد پرسنلی یا نام کاربری به حساب دیگری متصل است.' using errcode='23505';
end $function$;

-- در جدول ادمین ایمیل فنی پنهان می‌ماند و کد پرسنلی به‌عنوان نام کاربری نمایش داده می‌شود.
CREATE OR REPLACE FUNCTION public.kpi_accounts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if (public.kpi_access()->>'role') is distinct from 'admin' then
    raise exception 'مشاهدهٔ حساب‌ها فقط برای ادمین مجاز است.' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'username',coalesce(p.employee_no,u.email),'role',coalesce(m.role,'none'),
    'employee_id',m.employee_id,'employee_no',p.employee_no,'name',p.name_en,
    'department',d.name_fa,'active',p.active,'must_change_password',coalesce(m.must_change_password,false)
  ) order by coalesce(m.role,'none'),coalesce(p.employee_no,u.email)),'[]'::jsonb)
  into result
  from auth.users u left join engineering_access.members m on m.user_id=u.id
  left join public.personnel p on p.id=m.employee_id
  left join public.departments d on d.id=p.department_id
  where u.deleted_at is null;
  return result;
end $function$;

-- فرم تغییر نقش موجود، نام کاربری کد پرسنلی یا ایمیل مدیران را می‌پذیرد.
CREATE OR REPLACE FUNCTION public.kpi_set_role(p_email text, p_role text, p_employee_no text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare target uuid; eid integer; ident text:=lower(btrim(p_email));
begin
  if (public.kpi_access()->>'role') is distinct from 'admin' then raise exception 'فقط ادمین مجاز به تغییر نقش است.' using errcode='42501'; end if;
  if ident ~ '^[0-9]+$' then ident:=ident||'@staff.engkpi.invalid'; end if;
  select id into target from auth.users where lower(email)=ident and deleted_at is null and coalesce(is_sso_user,false)=false;
  if target is null then raise exception 'حسابی با این کد پرسنلی یا ایمیل پیدا نشد.' using errcode='22023'; end if;
  if target=auth.uid() or target='e8813830-7e04-44ae-b10b-f35e63aecaab'::uuid then raise exception 'نقش حساب خودتان یا ادمین اولیه از اینجا تغییر نمی‌کند.' using errcode='42501'; end if;
  if p_role='none' then delete from engineering_access.members where user_id=target; return jsonb_build_object('role','none'); end if;
  if p_role is null or p_role not in ('admin','management','head','expert') then raise exception 'نقش نامعتبر است.' using errcode='22023'; end if;
  if p_role in ('expert','head') then
    select id into eid from public.personnel where employee_no=btrim(p_employee_no) and active;
    if eid is null then raise exception 'کد پرسنلی فعال پیدا نشد.' using errcode='22023'; end if;
  end if;
  insert into engineering_access.members(user_id,role,employee_id) values(target,p_role,eid)
  on conflict(user_id) do update set role=excluded.role,employee_id=excluded.employee_id;
  return jsonb_build_object('role',p_role);
exception when unique_violation then raise exception 'این کد پرسنلی به حساب دیگری متصل است.' using errcode='23505';
end $function$;
