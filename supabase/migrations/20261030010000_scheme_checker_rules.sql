-- =====================================================================================================
-- Rexera CRM · Rexy's Scheme Checker rules. Safe to run more than once.
--  * One row per government scheme: details, benefits, documents, how to apply, and the conditions the client is
--    checked against (jsonb). While the table is empty the CRM uses its built-in schemes; the first change saves them.
--  * Every staff member reads them (sales people use the checker); only Super Admin and the Operation team (with
--    eligibility.manage) add, change, hide or remove schemes — IT Support is left out on purpose.
-- =====================================================================================================
create table if not exists eligibility_schemes (
  id            text primary key,
  position      int not null default 0,
  active        boolean not null default true,
  name          text not null check (length(trim(name)) between 3 and 160),
  kind          text not null default '',
  agency        text not null default '',
  url           text not null default '' check (url = '' or url ~* '^https?://'),
  service_match text not null default '',
  status_note   text not null default '',
  summary       text not null check (length(trim(summary)) >= 10),
  benefits      jsonb not null default '[]'::jsonb check (jsonb_typeof(benefits) = 'array'),
  documents     jsonb not null default '[]'::jsonb check (jsonb_typeof(documents) = 'array'),
  process       jsonb not null default '[]'::jsonb check (jsonb_typeof(process) = 'array'),
  conditions    jsonb not null default '[]'::jsonb check (jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) <= 40),
  subsidy       jsonb,
  bands         jsonb,
  verified_on   date not null,
  updated_at    timestamptz,
  updated_by    text references app_users(id) on delete set null
);
create index if not exists eligibility_schemes_position_idx on eligibility_schemes(position);

-- Super Admin, or the Operation team holding eligibility.manage (not IT, though IT holds every other permission)
create or replace function app.can_edit_scheme_rules() returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('superadmin') or (app.has_role('operations') and app.has_perm('eligibility.manage'))
$$;
grant execute on function app.can_edit_scheme_rules() to authenticated, service_role;

alter table eligibility_schemes enable row level security;
drop policy if exists eligibility_schemes_read on eligibility_schemes;
create policy eligibility_schemes_read on eligibility_schemes for select to authenticated using (app.is_staff());
drop policy if exists eligibility_schemes_write on eligibility_schemes;
create policy eligibility_schemes_write on eligibility_schemes for all to authenticated
  using (app.can_edit_scheme_rules()) with check (app.can_edit_scheme_rules());

insert into role_permissions (role, permission) values ('operations', 'eligibility.manage') on conflict do nothing;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'eligibility_schemes') then
    alter publication supabase_realtime add table public.eligibility_schemes;
  end if;
end $$;
