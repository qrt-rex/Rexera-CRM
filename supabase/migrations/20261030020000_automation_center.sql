-- =====================================================================================================
-- Rexera CRM · Automation Center. Safe to run more than once.
--  * automation_rules: custom rules ("when this happens and these conditions hold, do that") and the on / off
--    switches of the built-in automations (rows "builtin:<key>"). Every staff member reads them (rules run in the
--    browser that makes the change); ONLY IT Support adds, changes or removes them.
--  * automation_runs: what the rules did. Any staff browser may add a run of an enabled rule, as itself; a run id is
--    written once (daily checks use "one id per record and period", so two browsers never repeat one). Super Admin
--    and IT read them; IT clears them.
--  * emails: a rule's email may be sent from any staff browser — only as the system (no sender), marked with the
--    rule, and only while that rule exists and is switched on.
-- =====================================================================================================
create table if not exists automation_rules (
  id          text primary key,
  name        text not null check (length(trim(name)) between 3 and 160),
  description text,
  enabled     boolean not null default true,
  position    int not null default 0,
  trigger     text not null,
  entity      text,
  match       text check (match is null or match in ('all', 'any')),
  conditions  jsonb not null default '[]'::jsonb check (jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) <= 15),
  actions     jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) <= 10),
  repeat_days int check (repeat_days is null or repeat_days between 0 and 365),
  created_at  timestamptz,
  updated_at  timestamptz,
  updated_by  text references app_users(id) on delete set null
);
create index if not exists automation_rules_position_idx on automation_rules(position);

alter table automation_rules enable row level security;
drop policy if exists automation_rules_read on automation_rules;
create policy automation_rules_read on automation_rules for select to authenticated using (app.is_staff());
drop policy if exists automation_rules_write on automation_rules;
create policy automation_rules_write on automation_rules for all to authenticated using (app.has_role('it')) with check (app.has_role('it'));

create table if not exists automation_runs (
  id           text primary key,
  rule_id      text not null,
  rule_name    text not null default '',
  at           timestamptz not null default now(),
  by_user      text references app_users(id) on delete set null,
  trigger      text not null,
  record_type  text not null,
  record_id    text not null default '',
  record_label text not null default '',
  ok           boolean not null default true,
  detail       text not null default ''
);
create index if not exists automation_runs_at_idx on automation_runs(at desc);
create index if not exists automation_runs_rule_idx on automation_runs(rule_id);

alter table automation_runs enable row level security;
drop policy if exists automation_runs_read on automation_runs;
create policy automation_runs_read on automation_runs for select to authenticated using (app.is_master());
drop policy if exists automation_runs_insert on automation_runs;
create policy automation_runs_insert on automation_runs for insert to authenticated
  with check (app.is_staff() and (by_user is null or by_user = app.me())
    and exists (select 1 from automation_rules r where r.id = rule_id and r.enabled));
drop policy if exists automation_runs_delete on automation_runs;
create policy automation_runs_delete on automation_runs for delete to authenticated using (app.has_role('it'));

-- a rule's email, from whichever staff browser ran the rule
drop policy if exists emails_by_rule on emails;
create policy emails_by_rule on emails for insert to authenticated
  with check (app.is_staff() and from_user is null and automation like 'rule:%'
    and exists (select 1 from automation_rules r where r.id = substr(automation, 6) and r.enabled));

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'automation_rules') then
    alter publication supabase_realtime add table public.automation_rules;
  end if;
end $$;
