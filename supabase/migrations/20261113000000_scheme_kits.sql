-- =====================================================================================================
-- Rexera CRM · Schemes: edited only by the Operation Team, IT Support and Super Admin; Scheme Kits. Safe to run again.
--  * app.can_edit_schemes(): the signed-in person has the Operation Team, IT Support or Super Admin role (main or
--    extra). Schemes (schemes), the Sales Kit (sales_kit) and the Scheme Checker rules (eligibility_schemes) are
--    written only by them — nobody else, whatever permissions they were given by name.
--  * scheme_kits: named lists of Sales Kit schemes (picked by hand and / or a saved filter). A personal kit is seen
--    and changed by its owner only; a shared kit is seen by all staff and changed by the scheme editors.
-- =====================================================================================================
create or replace function app.can_edit_schemes() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select u.active and (app.user_roles(u.id) && array['operations', 'it', 'superadmin']::app_role[])
                   from app_users u where u.id = app.current_user_id()), false)
$$;
revoke all on function app.can_edit_schemes() from public, anon;
grant execute on function app.can_edit_schemes() to authenticated;

-- the Scheme Checker rules follow the same rule (IT Support included now)
create or replace function app.can_edit_scheme_rules() returns boolean
language sql stable security definer set search_path = public as $$ select app.can_edit_schemes() $$;

drop policy if exists schemes_write on schemes;
create policy schemes_write on schemes for all to authenticated using (app.can_edit_schemes()) with check (app.can_edit_schemes());
drop policy if exists schemes_read on schemes;
create policy schemes_read on schemes for select to authenticated using (app.is_staff() and (active or app.can_edit_schemes()));
drop policy if exists sales_kit_write on sales_kit;
create policy sales_kit_write on sales_kit for all to authenticated using (app.can_edit_schemes()) with check (app.can_edit_schemes());
drop policy if exists eligibility_schemes_write on eligibility_schemes;
create policy eligibility_schemes_write on eligibility_schemes for all to authenticated using (app.can_edit_schemes()) with check (app.can_edit_schemes());

-- the services price list keeps its editors (Admin included): it used schemes.manage, which Admin loses below
drop policy if exists services_write on services;
create policy services_write on services for all to authenticated
  using (app.is_master() or app.has_perm('schemes.manage') or app.has_role('admin'))
  with check (app.is_master() or app.has_perm('schemes.manage') or app.has_role('admin'));

-- the permissions follow: the Operation Team holds them; Admin no longer edits schemes
delete from role_permissions where permission in ('schemes.manage', 'saleskit.manage', 'eligibility.manage') and role not in ('operations', 'it', 'superadmin');
insert into role_permissions (role, permission) values ('operations', 'schemes.manage'), ('operations', 'saleskit.manage'), ('operations', 'eligibility.manage') on conflict do nothing;

create table if not exists scheme_kits (
  id           text primary key,
  name         text not null check (length(trim(name)) between 2 and 60),
  description  text,
  color        text,
  scheme_ids   text[] not null default '{}',
  excluded_ids text[] not null default '{}',
  filter       jsonb,
  sort         text,
  shared       boolean not null default false,
  owner_id     text not null references app_users(id) on delete cascade,
  position     int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  updated_by   text references app_users(id) on delete set null
);
create index if not exists scheme_kits_owner_idx on scheme_kits(owner_id);
alter table scheme_kits enable row level security;
drop policy if exists scheme_kits_read on scheme_kits;
create policy scheme_kits_read on scheme_kits for select to authenticated
  using (app.is_staff() and (shared or owner_id = app.current_user_id()));
drop policy if exists scheme_kits_insert on scheme_kits;
create policy scheme_kits_insert on scheme_kits for insert to authenticated
  with check (app.is_staff() and owner_id = app.current_user_id() and (not shared or app.can_edit_schemes()));
drop policy if exists scheme_kits_update on scheme_kits;
create policy scheme_kits_update on scheme_kits for update to authenticated
  using ((not shared and owner_id = app.current_user_id()) or (shared and app.can_edit_schemes()))
  with check ((not shared and owner_id = app.current_user_id()) or (shared and app.can_edit_schemes()));
drop policy if exists scheme_kits_delete on scheme_kits;
create policy scheme_kits_delete on scheme_kits for delete to authenticated
  using ((not shared and owner_id = app.current_user_id()) or (shared and app.can_edit_schemes()));

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'scheme_kits') then
    alter publication supabase_realtime add table public.scheme_kits;
  end if;
end $$;
