-- =====================================================================================================
-- Phases 2–3 of the switch: the app signs in with Supabase Auth and reads/writes these tables directly.
-- Safe to re-run.
-- =====================================================================================================

-- ---------------------------------------------------------------------------- sign in with a username
-- The sign-in form takes a username or an email; Supabase Auth needs the email. Only active accounts answer.
-- ponytail: tells anyone which email belongs to a username; move behind the server if that matters
create or replace function public.login_email(login text) returns text
language sql stable security definer set search_path = public as $$
  select email::text from app_users
  where active and (lower(username::text) = lower(trim(login)) or lower(email::text) = lower(trim(login)))
  limit 1
$$;
revoke all on function public.login_email(text) from public;
grant execute on function public.login_email(text) to anon, authenticated;

-- ---------------------------------------------------------------------------- numbering (LD-…, RX-…, invoice numbers)
-- Anyone who creates a lead, CRM entry or invoice moves the counter on. Unique codes on leads, bookings and invoices
-- stop two devices from issuing the same number (the second save fails and that person's screen reloads).
-- ponytail: last-writer counter; a sequence + RPC if two people regularly create records in the same second
drop policy if exists settings_write on app_settings;
create policy settings_write on app_settings for all to authenticated
  using (app.is_master() or (key in ('pf', 'breaks') and app.has_role('hr')) or (key = 'counters' and app.me() is not null))
  with check (app.is_master() or (key in ('pf', 'breaks') and app.has_role('hr')) or (key = 'counters' and app.me() is not null));

-- ---------------------------------------------------------------------------- audit entries the app writes itself
-- (automations and system checks are logged without a person)
drop policy if exists audit_insert on audit_log;
create policy audit_insert on audit_log for insert to authenticated with check (by_user = app.me() or by_user is null);

-- ---------------------------------------------------------------------------- live updates
-- every open CRM gets other people's changes (row-level security still decides who sees what)
do $$ declare t text; begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
  for t in select tablename from pg_tables where schemaname = 'public' and tablename not in ('login_attempts') loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
