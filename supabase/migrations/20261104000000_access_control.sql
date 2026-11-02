-- =====================================================================================================
-- Rexera CRM · Access Control (IT Support). Safe to run more than once.
--  * Roles & permissions are IT Support's alone: role permissions, extra roles, per-person permissions / functions,
--    custom roles and changing anyone's role. Nobody else — the Super Admin included — unless IT Support gives that
--    person "roles.manage" by name. (User accounts — create, activate, passwords — stay with access.manage.)
--  * Custom roles (app_settings 'accessControl'): built on a built-in role, with their own permission set, given to
--    people by IT. app.has_perm() reads them.
--  * Per-person denies now count for everyone, the Super Admin included (IT Support can take anything away by name).
--  * Functions: fn:<module>:<action> (view, create, edit, delete, download, export, approve, send) — switched off per
--    role ('accessControl'.roleDeny) or per person (user_permission_overrides). app.fn_allowed() decides; deletes and
--    new records in the main tables are checked by triggers, whatever page or request they come from.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------- who manages access
create or replace function app.access_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select value from app_settings where key = 'accessControl'), '{}'::jsonb)
$$;

create or replace function app.can_manage_roles() returns boolean
language sql stable security definer set search_path = public as $$
  select app.current_user_id() is not null and (
    app.has_role('it')
    or (exists (select 1 from user_permission_overrides o where o.user_id = app.current_user_id() and o.permission = 'roles.manage' and o.effect = 'allow')
        and not exists (select 1 from user_permission_overrides o where o.user_id = app.current_user_id() and o.permission = 'roles.manage' and o.effect = 'deny'))
  )
$$;

-- the custom role IT gave this person (null = their built-in role's permissions)
create or replace function app.custom_role(uid text) returns jsonb
language sql stable security definer set search_path = public as $$
  select r from jsonb_array_elements(coalesce(app.access_config()->'customRoles', '[]'::jsonb)) r
  where r->>'id' = app.access_config()->'userRole'->>uid
  limit 1
$$;

-- per-person deny / allow first (for everyone), then master roles, then the custom role or the built-in roles
create or replace function app.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  with me as (select app.current_user_id() as id)
  select case
    when (select id from me) is null then false
    when p = 'roles.manage' then app.can_manage_roles()
    when exists (select 1 from user_permission_overrides o, me where o.user_id = me.id and o.permission = p and o.effect = 'deny') then false
    when exists (select 1 from user_permission_overrides o, me where o.user_id = me.id and o.permission = p and o.effect = 'allow') then true
    when app.is_master() then true
    else exists (select 1 from me where coalesce(app.custom_role(me.id)->'perms', '[]'::jsonb) ? p)
      or exists (select 1 from role_permissions rp, me where rp.permission = p and rp.role = any(app.user_roles(me.id))
                 -- a custom role stands in for the person's main role
                 and not (app.custom_role(me.id) is not null and rp.role = (select u.role from app_users u where u.id = me.id)))
  end
$$;

-- ---------------------------------------------------------------------------------------------- functions
create or replace function app.fn_allowed(mod text, act text) returns boolean
language sql stable security definer set search_path = public as $$
  with me as (select app.current_user_id() as id),
       k as (select mod || ':' || act as f, 'fn:' || mod || ':' || act as p)
  select case
    -- the live server (secret key) and the SQL Editor
    when (select id from me) is null then true
    -- IT Support always keeps Access Control
    when mod = 'access' and app.has_role('it') then true
    when exists (select 1 from user_permission_overrides o, me, k where o.user_id = me.id and o.permission = k.p and o.effect = 'deny') then false
    when exists (select 1 from user_permission_overrides o, me, k where o.user_id = me.id and o.permission = k.p and o.effect = 'allow') then true
    -- off only when every one of the person's roles has it off
    else not coalesce((
      select bool_and(coalesce(app.access_config()->'roleDeny'->r, '[]'::jsonb) ? (select f from k))
      from me, unnest(
        array[coalesce(app.access_config()->'userRole'->>me.id, (select u.role::text from app_users u where u.id = me.id))]
        || array(select x.role::text from user_extra_roles x where x.user_id = me.id and x.role::text <> (select u.role::text from app_users u where u.id = me.id))
      ) as r
    ), false)
  end
$$;

create or replace function app.guard_fn() returns trigger
language plpgsql security definer set search_path = public as $$
declare act text := case tg_op when 'DELETE' then 'delete' when 'INSERT' then 'create' else 'edit' end;
begin
  if not app.fn_allowed(tg_argv[0], act) then
    raise exception 'You don''t have access to % here — IT Support manages access.', act using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

do $$ declare x record; begin
  for x in select * from (values
    ('leads', 'leads', 'delete'),
    ('bookings', 'bookings', 'insert or delete'),
    ('booking_documents', 'bookings', 'delete'),
    ('schemes', 'schemes', 'insert or delete'),
    ('posts', 'content', 'insert or delete'),
    ('events', 'events', 'insert or delete'),
    ('broadcasts', 'broadcasts', 'insert or delete'),
    ('company_assets', 'assets', 'insert or delete'),
    ('stock_items', 'assets', 'insert or delete'),
    ('company_expenses', 'assets', 'insert or delete'),
    ('invoices', 'billing', 'insert'),
    ('client_entries', 'client-entries', 'delete'),
    ('candidate_forms', 'candidates', 'insert or delete')
  ) as t(tbl, module, ops) loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = x.tbl) then
      execute format('drop trigger if exists %I on %I', x.tbl || '_fn_guard', x.tbl);
      execute format('create trigger %I before %s on %I for each row execute function app.guard_fn(%L)', x.tbl || '_fn_guard', x.ops, x.tbl, x.module);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------- write rules
drop policy if exists extra_roles_write on user_extra_roles;
create policy extra_roles_write on user_extra_roles for all to authenticated using (app.can_manage_roles()) with check (app.can_manage_roles());
drop policy if exists overrides_write on user_permission_overrides;
create policy overrides_write on user_permission_overrides for all to authenticated using (app.can_manage_roles()) with check (app.can_manage_roles());
drop policy if exists overrides_read on user_permission_overrides;
create policy overrides_read on user_permission_overrides for select to authenticated using (user_id = app.me() or app.has_perm('access.manage') or app.can_manage_roles());
drop policy if exists role_perms_write on role_permissions;
create policy role_perms_write on role_permissions for all to authenticated using (app.can_manage_roles()) with check (app.can_manage_roles());

-- 'accessControl': everyone on the staff reads it (each screen works out its own functions); only IT writes it
drop policy if exists access_control_write on app_settings;
create policy access_control_write on app_settings for all to authenticated
  using (key = 'accessControl' and app.can_manage_roles()) with check (key = 'accessControl' and app.can_manage_roles());
drop policy if exists access_control_only_it_ins on app_settings;
create policy access_control_only_it_ins on app_settings as restrictive for insert to authenticated with check (key <> 'accessControl' or app.can_manage_roles());
drop policy if exists access_control_only_it_upd on app_settings;
create policy access_control_only_it_upd on app_settings as restrictive for update to authenticated
  using (key <> 'accessControl' or app.can_manage_roles()) with check (key <> 'accessControl' or app.can_manage_roles());
drop policy if exists access_control_only_it_del on app_settings;
create policy access_control_only_it_del on app_settings as restrictive for delete to authenticated using (key <> 'accessControl' or app.can_manage_roles());

-- someone's role: IT Support only (the rest as before)
create or replace function app.guard_user_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if app.me() is null then return new; end if;
  if new.role is distinct from old.role and not app.can_manage_roles() then
    raise exception 'Roles and permissions are managed by IT Support only.';
  end if;
  if not (app.has_perm('access.manage') or app.has_perm('employees.manage') or app.can_manage_roles()) then
    if old.id <> app.me() then
      -- a Team Leader / Branch Director setting a target: nothing else on the row may change
      if (to_jsonb(new) - 'sales_target' - 'updated_at') is distinct from (to_jsonb(old) - 'sales_target' - 'updated_at')
         or not app.can_set_target(old.branch_id, old.team_lead_id) then
        raise exception 'Team leaders and branch directors can only set the monthly target of their own people.';
      end if;
    elsif (new.role, new.active, new.salary, new.sales_target, new.team_lead_id, new.auth_user_id, new.username, new.email, new.exit_on)
       is distinct from (old.role, old.active, old.salary, old.sales_target, old.team_lead_id, old.auth_user_id, old.username, old.email, old.exit_on) then
      raise exception 'Only HR or access managers can change role, access, salary or sign-in details.';
    end if;
  end if;
  if old.id = app.me() and (new.role, new.active) is distinct from (old.role, old.active) then
    raise exception 'You cannot change your own role or deactivate yourself.';
  end if;
  if (old.role = 'superadmin' or new.role = 'superadmin') and not app.has_role('superadmin') and not app.can_manage_roles() then
    raise exception 'Only a Super Admin or IT Support can change Super Admin accounts.';
  end if;
  return new;
end $$;

create or replace function app.guard_extra_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if app.me() is null then return coalesce(new, old); end if;
  if not app.can_manage_roles() then
    raise exception 'Roles and permissions are managed by IT Support only.';
  end if;
  if coalesce(new.user_id, old.user_id) = app.me() then
    raise exception 'You cannot change your own access.';
  end if;
  return coalesce(new, old);
end $$;
