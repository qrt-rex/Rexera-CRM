-- =====================================================================================================
-- Gaps found before moving the app from browser storage to Supabase (phase 1 of the switch).
--  * Six tables had row-level security on but no policies, so no signed-in user could read or write them.
--  * Client-file document notes and unlinked old-CRM uploads had nowhere to live.
--  * HR edits the break policy, so HR may write that one setting (like 'pf').
-- Safe to re-run.
-- =====================================================================================================

-- ---------------------------------------------------------------------------- policies that were missing
drop policy if exists client_emails_all on booking_client_emails;
create policy client_emails_all on booking_client_emails for all to authenticated
  using (app.can_see_booking(booking_id)) with check (app.can_see_booking(booking_id));

do $$ declare t text; begin
  foreach t in array array['company_assets', 'asset_events', 'stock_items', 'stock_moves', 'company_expenses'] loop
    execute format('drop policy if exists %I on %I', t || '_manage', t);
    execute format('create policy %I on %I for all to authenticated using (app.is_master() or app.has_perm(''assets.manage'')) with check (app.is_master() or app.has_perm(''assets.manage''))', t || '_manage', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------- columns / tables the app needs
alter table booking_documents add column if not exists note text;

-- old-CRM uploads that no client file refers to (IT → Legacy import keeps them so nothing is lost)
create table if not exists legacy_files (
  path  text primary key,
  file  jsonb not null,                 -- { id, name, type, size, at }
  kind  text not null default ''
);
alter table legacy_files enable row level security;
drop policy if exists legacy_files_master on legacy_files;
create policy legacy_files_master on legacy_files for all to authenticated using (app.is_master()) with check (app.is_master());

-- ---------------------------------------------------------------------------- HR owns the break policy
drop policy if exists settings_write on app_settings;
create policy settings_write on app_settings for all to authenticated
  using (app.is_master() or (key in ('pf', 'breaks') and app.has_role('hr')))
  with check (app.is_master() or (key in ('pf', 'breaks') and app.has_role('hr')));
