-- =====================================================================================================
-- Rexera CRM · Scheme Kit master list: one record per scheme, the only place its name is set. Safe to run again.
-- Each record is linked to the same scheme in Services, the Sales Kit, Schemes and the Scheme Checker; renaming it
-- (Operation Team, IT Support, Super Admin) renames it in all of them. Everyone on the staff reads it.
-- The first time the Scheme Kit page is opened by an editor, it is built from the names already in the CRM.
-- =====================================================================================================
create table if not exists scheme_master (
  id           text primary key,
  name         text not null check (length(trim(name)) between 2 and 120),
  category     text not null default 'Other',
  active       boolean not null default true,
  description  text,
  aliases      text[] not null default '{}',
  service_ids  text[] not null default '{}',
  sales_kit_ids text[] not null default '{}',
  scheme_ids   text[] not null default '{}',
  checker_ids  text[] not null default '{}',
  position     int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  updated_by   text references app_users(id) on delete set null
);
create unique index if not exists scheme_master_name_idx on scheme_master (lower(trim(name)));
alter table scheme_master enable row level security;
drop policy if exists scheme_master_read on scheme_master;
create policy scheme_master_read on scheme_master for select to authenticated using (app.is_staff());
drop policy if exists scheme_master_write on scheme_master;
create policy scheme_master_write on scheme_master for all to authenticated using (app.can_edit_schemes()) with check (app.can_edit_schemes());

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'scheme_master') then
    alter publication supabase_realtime add table public.scheme_master;
  end if;
end $$;
