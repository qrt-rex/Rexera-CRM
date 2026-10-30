-- =====================================================================================================
-- Rexera CRM · user activity log (IT Support dashboard → User activity). Safe to run more than once.
--  * Every page opened, click, choice, form submit, action result and screen error of every person — what was
--    clicked and where, never what was typed. Each browser adds its own person's events, in small batches.
--  * ONLY the IT Support team reads (and clears) it — not Super Admin, not anyone else.
--  * Kept outside the CRM's data document (it grows fast): the IT dashboard reads it page by page.
-- =====================================================================================================
create table if not exists activity_log (
  id      text primary key,
  at      timestamptz not null default now(),
  user_id text not null references app_users(id) on delete cascade,
  role    text not null default '',
  kind    text not null check (kind in ('page', 'click', 'change', 'submit', 'action', 'error')),
  label   text not null check (length(label) <= 300),
  path    text not null default '' check (length(path) <= 300),
  area    text check (area is null or length(area) <= 200),
  detail  text check (detail is null or length(detail) <= 600),
  ok      boolean
);
create index if not exists activity_log_at_idx on activity_log(at desc);
create index if not exists activity_log_user_idx on activity_log(user_id, at desc);
create index if not exists activity_log_kind_idx on activity_log(kind, at desc);

alter table activity_log enable row level security;
drop policy if exists activity_log_insert on activity_log;
create policy activity_log_insert on activity_log for insert to authenticated
  with check (app.is_staff() and user_id = app.me() and at > now() - interval '1 day' and at < now() + interval '5 minutes');
drop policy if exists activity_log_read on activity_log;
create policy activity_log_read on activity_log for select to authenticated using (app.has_role('it'));
drop policy if exists activity_log_delete on activity_log;
create policy activity_log_delete on activity_log for delete to authenticated using (app.has_role('it'));
