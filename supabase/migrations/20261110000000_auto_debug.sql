-- =====================================================================================================
-- Rexera CRM · Auto-debug (Error log) and Old CRM sync autopilot. Safe to run more than once.
--  * app_errors: every error the CRM meets — on anyone's screen, a save Supabase refused, on the server, in the old
--    CRM sync — grouped (the same error counts up instead of repeating), with a plain diagnosis, how to fix it, and
--    what the CRM already fixed by itself. Only the server writes it (log_app_error); IT Support reads it and marks
--    errors solved. A solved error that happens again opens again by itself.
--  * legacy_sync.autopilot: after a successful Test connection the sync copies everything and turns itself on, and
--    retries problems by itself (on by default).
--  * legacy_sync_runs.status 'partial': a copy that finished with a few records or files left over (tried again).
-- =====================================================================================================
alter table legacy_sync add column if not exists autopilot boolean not null default true;

alter table legacy_sync_runs drop constraint if exists legacy_sync_runs_status_check;
alter table legacy_sync_runs add constraint legacy_sync_runs_status_check check (status in ('running', 'ok', 'partial', 'error', 'stopped'));

create table if not exists app_errors (
  id          bigint generated always as identity primary key,
  key         text not null unique,                 -- the same error (source + kind + where) always has the same key
  source      text not null check (source in ('browser', 'save', 'server', 'sync')),
  code        text not null default 'unknown',      -- the diagnosis (supabase/debug-rules.mjs)
  title       text not null default '',
  message     text not null,
  detail      text,
  place       text,                                 -- page address or server route
  user_id     text references app_users(id) on delete set null,
  count       int not null default 1,
  first_at    timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  status      text not null default 'open' check (status in ('open', 'auto_fixed', 'solved')),
  diagnosis   text,
  fix         text,
  auto_fix    text,                                 -- what the CRM did by itself (null = nothing it can do alone)
  solved_by   text references app_users(id) on delete set null,
  solved_at   timestamptz
);
create index if not exists app_errors_last_idx on app_errors(last_at desc);
create index if not exists app_errors_status_idx on app_errors(status);

alter table app_errors enable row level security;
drop policy if exists app_errors_it_read on app_errors;
create policy app_errors_it_read on app_errors for select to authenticated using (app.has_role('it'));
drop policy if exists app_errors_it_update on app_errors;
create policy app_errors_it_update on app_errors for update to authenticated using (app.has_role('it')) with check (app.has_role('it'));
-- no insert / delete policy: errors are written only by the server (log_app_error), and never deleted from the screen

/** One error happened (server only): counts up an existing one, or adds it; a solved error that comes back opens again. */
create or replace function public.log_app_error(
  p_key text, p_source text, p_code text, p_title text, p_message text, p_detail text, p_place text, p_user text,
  p_diagnosis text, p_fix text, p_auto_fix text, p_status text, p_count int default 1
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into app_errors (key, source, code, title, message, detail, place, user_id, count, diagnosis, fix, auto_fix, status)
  values (p_key, p_source, p_code, left(p_title, 200), left(p_message, 2000), left(p_detail, 4000), left(p_place, 300),
          (select id from app_users where id = p_user), greatest(1, p_count), p_diagnosis, p_fix, p_auto_fix, p_status)
  on conflict (key) do update set
    count = app_errors.count + greatest(1, excluded.count),
    last_at = now(),
    message = excluded.message,
    detail = coalesce(excluded.detail, app_errors.detail),
    user_id = coalesce(excluded.user_id, app_errors.user_id),
    auto_fix = coalesce(excluded.auto_fix, app_errors.auto_fix),
    -- solved but back again → open again; auto-fixed stays auto-fixed while the CRM keeps fixing it
    status = case when app_errors.status = 'solved' then excluded.status
                  when excluded.status = 'open' then 'open' else app_errors.status end,
    solved_by = case when app_errors.status = 'solved' then null else app_errors.solved_by end,
    solved_at = case when app_errors.status = 'solved' then null else app_errors.solved_at end;
end $$;
revoke all on function public.log_app_error(text, text, text, text, text, text, text, text, text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.log_app_error(text, text, text, text, text, text, text, text, text, text, text, text, int) to service_role;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_errors') then
    alter publication supabase_realtime add table public.app_errors;
  end if;
end $$;
