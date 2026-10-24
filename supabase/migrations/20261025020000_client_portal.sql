-- =====================================================================================================
-- Rexera CRM · client portal (clients sign in with email + password after an invite from the Super Admin).
-- Safe to run more than once. Needs 20261025010000_staff_only_reads.sql first (client logins can't read staff data).
--  * bookings.client_docs / milestones / client_updates: what the Operation team asks the client for, the project's
--    milestones and the updates published to the client (edited in the CRM).
--  * client_accounts: one portal login per client email, linked to their CRM entries (no entry in two accounts).
--  * client_activity: everything that happens in or to a portal account.
--  * client_doc_uploads: files the client uploaded (into the private crm-files bucket).
--  Clients never read these tables: the live server answers /api/portal/* for them, checking which entries are theirs.
--  The accounts, activity and uploads are written only by the server (secret key); the CRM reads them.
-- =====================================================================================================
alter table bookings add column if not exists client_docs jsonb;
alter table bookings add column if not exists milestones jsonb;
alter table bookings add column if not exists client_updates jsonb;

create table if not exists client_accounts (
  id            text primary key,
  auth_user_id  uuid unique,
  email         citext not null unique,
  name          text not null,
  phone         text,
  booking_ids   text[] not null default '{}',
  status        text not null default 'INVITED' check (status in ('INVITED', 'ACTIVE', 'DISABLED')),
  invited_at    timestamptz not null default now(),
  invited_by    text references app_users(id) on delete set null,
  activated_at  timestamptz,
  last_login_at timestamptz,
  assigned_to   text references app_users(id) on delete set null,
  disabled_at   timestamptz
);
create index if not exists client_accounts_bookings_idx on client_accounts using gin (booking_ids);

-- one CRM entry belongs to one portal account
create or replace function app.client_account_unique_bookings() returns trigger language plpgsql as $$
begin
  if exists (select 1 from client_accounts c where c.id <> new.id and c.booking_ids && new.booking_ids) then
    raise exception 'A CRM entry is already linked to another client portal account.';
  end if;
  return new;
end $$;
drop trigger if exists client_account_unique_bookings on client_accounts;
create trigger client_account_unique_bookings before insert or update of booking_ids on client_accounts
  for each row execute function app.client_account_unique_bookings();

create table if not exists client_activity (
  id         text primary key,
  account_id text not null references client_accounts(id) on delete cascade,
  booking_id text,
  at         timestamptz not null default now(),
  action     text not null,
  detail     text,
  by_user    text references app_users(id) on delete set null
);
create index if not exists client_activity_idx on client_activity(account_id, at desc);

create table if not exists client_doc_uploads (
  id         text primary key,
  booking_id text not null references bookings(id) on delete cascade,
  category   text not null check (category in ('PRECHECK', 'FINANCE', 'DPR', 'CERTIFICATION', 'SUBMISSION')),
  file       jsonb not null,
  at         timestamptz not null default now(),
  account_id text references client_accounts(id) on delete set null,
  note       text
);
create index if not exists client_doc_uploads_idx on client_doc_uploads(booking_id, at);

alter table client_accounts enable row level security;
alter table client_activity enable row level security;
alter table client_doc_uploads enable row level security;
-- staff only: portal managers see every account; others see the accounts of entries they can open
drop policy if exists client_accounts_read on client_accounts;
create policy client_accounts_read on client_accounts for select to authenticated
  using (app.has_perm('portal.manage') or (app.is_staff() and exists (select 1 from unnest(booking_ids) b(id) where app.can_see_booking(b.id))));
drop policy if exists client_activity_read on client_activity;
create policy client_activity_read on client_activity for select to authenticated
  using (app.has_perm('portal.manage') or (booking_id is not null and app.can_see_booking(booking_id)));
drop policy if exists client_doc_uploads_read on client_doc_uploads;
create policy client_doc_uploads_read on client_doc_uploads for select to authenticated using (app.can_see_booking(booking_id));

-- "sign out everywhere" for a client (the server calls it; nobody else may)
create or replace function public.portal_revoke_sessions(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from auth.refresh_tokens where user_id = uid::text;
  delete from auth.sessions where user_id = uid;
end $$;
revoke all on function public.portal_revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function public.portal_revoke_sessions(uuid) to service_role;

do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['client_accounts', 'client_activity', 'client_doc_uploads'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
