-- GoTrue برای این فیلدهای متنی، مقدار NULL را هنگام ورود نمی‌پذیرد؛
-- همهٔ حساب‌های ساخته‌شدهٔ پرسنلی را نرمال می‌کنیم و درج‌های بعدی را هم اصلاح می‌کنیم.
UPDATE auth.users
SET confirmation_token=coalesce(confirmation_token,''),
    recovery_token=coalesce(recovery_token,''),
    email_change=coalesce(email_change,''),
    email_change_token_new=coalesce(email_change_token_new,'')
WHERE email LIKE '%@staff.engkpi.invalid'
  AND (confirmation_token IS NULL OR recovery_token IS NULL OR email_change IS NULL OR email_change_token_new IS NULL);

CREATE OR REPLACE FUNCTION public.kpi_provision_employee_account(p_employee_no text,p_role text DEFAULT 'expert')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
declare
  emp text:=btrim(p_employee_no); em text; wanted_role text:=coalesce(p_role,'expert');
  eid integer; target uuid; old_email text; changed boolean:=false;
begin
  if (public.kpi_access()->>'role') is distinct from 'admin' then raise exception 'ساخت حساب فقط برای ادمین مجاز است.' using errcode='42501'; end if;
  if emp is null or emp !~ '^[0-9]+$' then raise exception 'کد پرسنلی باید فقط شامل رقم باشد.' using errcode='22023'; end if;
  if wanted_role not in ('expert','head') then raise exception 'برای حساب پرسنلی فقط نقش کارشناس یا رییس دپارتمان مجاز است.' using errcode='22023'; end if;
  select id into eid from public.personnel where employee_no=emp and active;
  if eid is null then raise exception 'کد پرسنلی فعال پیدا نشد.' using errcode='22023'; end if;
  em:=emp||'@staff.engkpi.invalid';
  select m.user_id,u.email into target,old_email from engineering_access.members m join auth.users u on u.id=m.user_id where m.employee_id=eid and u.deleted_at is null and coalesce(u.is_sso_user,false)=false;
  if target is null then
    if exists(select 1 from auth.users where lower(email)=lower(em) and deleted_at is null) then raise exception 'این نام کاربری از قبل به حساب دیگری متصل است؛ بررسی دستی لازم است.' using errcode='23505'; end if;
    target:=gen_random_uuid();
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,confirmation_token,recovery_token,email_change,email_change_token_new,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_sso_user,is_anonymous)
    values('00000000-0000-0000-0000-000000000000',target,'authenticated','authenticated',em,extensions.crypt(emp,extensions.gen_salt('bf')),now(),'','','','',now(),now(),'{"provider":"email","providers":["email"]}'::jsonb,jsonb_build_object('employee_no',emp),false,false);
    insert into auth.identities(id,user_id,provider_id,provider,identity_data,last_sign_in_at,created_at,updated_at)
    values(gen_random_uuid(),target,target::text,'email',jsonb_build_object('sub',target::text,'email',em,'email_verified',true),null,now(),now());
    changed:=true;
  elsif old_email is distinct from em then
    if exists(select 1 from auth.users where lower(email)=lower(em) and id<>target and deleted_at is null) then raise exception 'نام کاربری کد پرسنلی از قبل استفاده شده است.' using errcode='23505'; end if;
    update auth.users set email=em,encrypted_password=extensions.crypt(emp,extensions.gen_salt('bf')),email_confirmed_at=coalesce(email_confirmed_at,now()),updated_at=now(),raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('employee_no',emp),confirmation_token=coalesce(confirmation_token,''),recovery_token=coalesce(recovery_token,''),email_change=coalesce(email_change,''),email_change_token_new=coalesce(email_change_token_new,'') where id=target;
    update auth.identities set provider_id=target::text,identity_data=coalesce(identity_data,'{}'::jsonb)||jsonb_build_object('sub',target::text,'email',em,'email_verified',true),updated_at=now() where user_id=target and provider='email';
    if not found then insert into auth.identities(id,user_id,provider_id,provider,identity_data,last_sign_in_at,created_at,updated_at) values(gen_random_uuid(),target,target::text,'email',jsonb_build_object('sub',target::text,'email',em,'email_verified',true),null,now(),now()); end if;
    changed:=true;
  end if;
  insert into engineering_access.members(user_id,role,employee_id,must_change_password) values(target,wanted_role,eid,changed)
  on conflict(user_id) do update set role=excluded.role,employee_id=excluded.employee_id,must_change_password=case when changed then true else engineering_access.members.must_change_password end;
  return jsonb_build_object('username',emp,'role',wanted_role,'must_change_password',(select m.must_change_password from engineering_access.members m where m.user_id=target));
exception when unique_violation then raise exception 'این کد پرسنلی یا نام کاربری به حساب دیگری متصل است.' using errcode='23505';
end $function$;

CREATE OR REPLACE FUNCTION public.kpi_create_account(p_email text,p_password text,p_role text DEFAULT 'expert',p_employee_no text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
declare target uuid; eid integer; em text:=lower(btrim(p_email));
begin
  if (public.kpi_access()->>'role') is distinct from 'admin' then raise exception 'ساخت حساب فقط برای ادمین مجاز است.' using errcode='42501'; end if;
  if em is null or em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'ایمیل معتبر وارد کنید.' using errcode='22023'; end if;
  if p_password is null or length(p_password)<8 then raise exception 'رمز عبور باید حداقل ۸ کاراکتر باشد.' using errcode='22023'; end if;
  if p_role is null or p_role not in ('admin','management','head','expert') then raise exception 'نقش نامعتبر است.' using errcode='22023'; end if;
  if p_role in ('expert','head') then select id into eid from public.personnel where employee_no=btrim(p_employee_no) and active; if eid is null then raise exception 'کد پرسنلی فعال پیدا نشد.' using errcode='22023'; end if; end if;
  if exists(select 1 from auth.users where lower(email)=em) then raise exception 'حسابی با این ایمیل از قبل وجود دارد.' using errcode='23505'; end if;
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,confirmation_token,recovery_token,email_change,email_change_token_new,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_sso_user,is_anonymous)
  values('00000000-0000-0000-0000-000000000000',gen_random_uuid(),'authenticated','authenticated',em,extensions.crypt(p_password,extensions.gen_salt('bf')),now(),'','','','',now(),now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,false,false)
  returning id into target;
  insert into auth.identities(id,user_id,provider_id,provider,identity_data,last_sign_in_at,created_at,updated_at)
  values(gen_random_uuid(),target,target::text,'email',jsonb_build_object('sub',target::text,'email',em,'email_verified',true),now(),now(),now());
  insert into engineering_access.members(user_id,role,employee_id) values(target,p_role,eid) on conflict(user_id) do update set role=excluded.role,employee_id=excluded.employee_id;
  return jsonb_build_object('email',em,'role',p_role);
exception when unique_violation then raise exception 'این کد پرسنلی به حساب دیگری متصل است.' using errcode='23505';
end $function$;
