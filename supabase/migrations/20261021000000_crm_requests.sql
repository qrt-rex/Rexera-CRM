-- =====================================================================================================
-- Rexera CRM · October requests. Safe to run more than once.
--  * Services: a price for each booking type (Single / Multiple / Combo 3, 6, 9, 12 months).
--  * CRM entries: booking type, CA / DSA commission (Accounts), refunds (Accounts only).
--  * Payments: TDS the client deducted (1–15 %).
--  * Expenses: branch (AMD-A, AMD-Y, BRD …; empty = all branches).
--  * Payroll: salary paid / not paid per person (date, reference, who marked it).
--  * Permissions: leads.admin (CRM Leads page — Super Admin) and refunds.manage (Accounts).
-- =====================================================================================================

-- ---------------------------------------------------------------------------- services
alter table services add column if not exists prices jsonb;            -- { "MULTIPLE": 9000, "COMBO6": 0, … }

-- ---------------------------------------------------------------------------- CRM entries
alter table bookings add column if not exists booking_type text;
alter table bookings drop constraint if exists bookings_booking_type_check;
alter table bookings add constraint bookings_booking_type_check
  check (booking_type is null or booking_type in ('SINGLE', 'MULTIPLE', 'COMBO3', 'COMBO6', 'COMBO9', 'COMBO12'));
alter table bookings add column if not exists commission jsonb;        -- { to: CA|DSA, name, pct, amount, by, at }

-- ---------------------------------------------------------------------------- payments: TDS
alter table booking_payments add column if not exists tds_pct numeric(5,2);
alter table booking_payments add column if not exists tds_amount numeric(12,2);
alter table booking_payments drop constraint if exists booking_payments_tds_check;
alter table booking_payments add constraint booking_payments_tds_check
  check (tds_pct is null or (tds_pct between 1 and 15 and coalesce(tds_amount, 0) >= 0));

-- ---------------------------------------------------------------------------- refunds (Accounts only)
create table if not exists booking_refunds (
  id           text primary key,
  booking_id   text not null references bookings(id) on delete cascade,
  amount       numeric(12,2) not null check (amount > 0),
  requested_on date not null,
  reason       text not null default '',
  status       text not null default 'PENDING' check (status in ('PENDING', 'REFUNDED')),
  refunded_on  date,
  mode         text,
  ref          text,
  created_by   text references app_users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists booking_refunds_booking_idx on booking_refunds(booking_id);
alter table booking_refunds enable row level security;
drop policy if exists booking_refunds_accounts on booking_refunds;
create policy booking_refunds_accounts on booking_refunds for all to authenticated
  using (app.has_perm('refunds.manage'))
  with check (app.has_perm('refunds.manage') and app.can_see_booking(booking_id));

-- ---------------------------------------------------------------------------- expenses by branch
alter table company_expenses add column if not exists branch_id text;
create index if not exists company_expenses_branch_idx on company_expenses(branch_id);

-- ---------------------------------------------------------------------------- salary paid / not paid
alter table payroll_rows add column if not exists paid_on date;
alter table payroll_rows add column if not exists paid_ref text;
alter table payroll_rows add column if not exists paid_by text;

-- ---------------------------------------------------------------------------- permissions
-- leads.admin: the CRM Leads page (manual leads, website leads, CSV, auto-assign) — Super Admin / IT hold every permission
-- refunds.manage: the Refunds page and refund entries — Accounts
insert into role_permissions (role, permission) values ('accounts', 'refunds.manage') on conflict do nothing;

-- ---------------------------------------------------------------------------- Vadodara is called BRD (Baroda)
update app_settings set value = (
  select jsonb_agg(case when e->>'id' = 'br-vdr' and coalesce(e->>'code', '') in ('', 'VDR') then e || '{"code": "BRD"}'::jsonb else e end)
  from jsonb_array_elements(value) e)
where key = 'branches' and jsonb_typeof(value) = 'array' and jsonb_array_length(value) > 0;

-- ---------------------------------------------------------------------------- live updates
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'booking_refunds') then
    alter publication supabase_realtime add table public.booking_refunds;
  end if;
end $$;
