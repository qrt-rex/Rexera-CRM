-- =====================================================================================================
-- Rexera CRM · the whole database, for a NEW, EMPTY Supabase project only (all migrations in order).
-- Do not run it on a project that already has the schema: the first part creates policies that already exist
-- there and stops. For the existing project, run only the migrations it has not had (see supabase/run-now.sql).
-- Generated from supabase/migrations/.
-- =====================================================================================================


-- ##################################################################### 20261006000000_rexera_schema.sql

-- =====================================================================================================
-- Rexera CRM · PostgreSQL schema for Supabase
--
--  * One table per entity, snake_case, text primary keys (existing ids such as 'u-sa' or 'bk-12' are kept;
--    new rows get a UUID), real foreign keys, enums for every fixed list, numeric(…) for money.
--  * Every table has row-level security. Policies call app.has_perm(), which applies the same rules as the
--    app: role permissions + extra roles + per-person allow − deny; Super Admin and IT Support hold everything.
--  * People sign in with Supabase Auth; app_users.auth_user_id links an auth account to a CRM user.
--  * Helper functions live in the private "app" schema, which is not exposed through the API.
-- Run once in Supabase → SQL Editor (or `supabase db push`). Safe to re-run: objects are created if missing.
-- =====================================================================================================

create extension if not exists citext;
create schema if not exists app;

-- ----------------------------------------------------------------------------------------------- enums
-- each type in its own block, so a re-run creates whatever is missing
do $$ declare spec text[]; specs text[][] := array[
  array['app_role',           $v$'superadmin','admin','accounts','legal','operations','teamlead','sales','hr','it','support'$v$],
  array['lead_status',        $v$'NEW','ATTEMPTED','CALL_BACK','INTERESTED','NOT_INTERESTED','CONVERTED','INVALID'$v$],
  array['call_outcome',       $v$'NO_ANSWER','BUSY','CALL_BACK','INTERESTED','NOT_INTERESTED','CONVERTED','WRONG_NUMBER'$v$],
  array['booking_status',     $v$'PENDING_TL','PENDING_ACCOUNTS','ACCOUNTS_HOLD','PENDING_LEGAL','IN_OPERATIONS','WITH_ADMIN','ON_HOLD','COMPLETED','REJECTED'$v$],
  array['booking_mode',       $v$'Refundable','Non-Refundable'$v$],
  array['priority_level',     $v$'LOW','MEDIUM','HIGH'$v$],
  array['doc_status',         $v$'PENDING','VERIFIED','REJECTED'$v$],
  array['invoice_type',       $v$'TAX','PROFORMA'$v$],
  array['invoice_status',     $v$'ISSUED','PARTIALLY_PAID','PAID','CANCELLED'$v$],
  array['post_kind',          $v$'FLYER','POST','SALES_INFO'$v$],
  array['broadcast_priority', $v$'NORMAL','HIGH','URGENT'$v$],
  array['event_kind',         $v$'MEETING','TRAINING','HOLIDAY','DEADLINE','CELEBRATION'$v$],
  array['leave_type',         $v$'CL','SL','EL','LOP'$v$],
  array['leave_status',       $v$'PENDING','APPROVED','REJECTED','CANCELLED'$v$],
  array['notice_kind',        $v$'info','success','warning','action'$v$],
  array['payroll_status',     $v$'CALCULATED','APPROVED','FINALIZED','PAID'$v$],
  array['backup_kind',        $v$'DOWNLOAD','SNAPSHOT','AUTO_SNAPSHOT','RESTORE','IMPORT'$v$],
  array['dataset_kind',       $v$'csv','excel'$v$]
]; begin
  foreach spec slice 1 in array specs loop
    if not exists (select 1 from pg_type where typname = spec[1] and typnamespace = 'public'::regnamespace) then
      execute format('create type public.%I as enum (%s)', spec[1], spec[2]);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------------------------- shared trigger
create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ======================================================================================== people & access
create table if not exists app_users (
  id              text primary key default gen_random_uuid()::text,
  auth_user_id    uuid unique references auth.users(id) on delete set null,
  name            text not null check (length(trim(name)) >= 2),
  username        citext not null unique,
  email           citext not null unique,
  phone           text check (phone is null or phone ~ '^[6-9][0-9]{9}$'),
  role            app_role not null,
  team_lead_id    text references app_users(id) on delete set null,
  department      text not null default '',
  designation     text not null default '',
  joined_on       date not null default current_date,
  exit_on         date,
  active          boolean not null default true,
  salary          numeric(12,2) check (salary is null or salary >= 0),
  sales_target    numeric(14,2) check (sales_target is null or sales_target >= 0),
  photo_url       text,
  address         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists app_users_role_idx on app_users(role) where active;
create index if not exists app_users_team_lead_idx on app_users(team_lead_id);

create table if not exists user_extra_roles (
  user_id text not null references app_users(id) on delete cascade,
  role    app_role not null,
  primary key (user_id, role)
);
create table if not exists user_permission_overrides (
  user_id    text not null references app_users(id) on delete cascade,
  permission text not null,
  effect     text not null check (effect in ('allow','deny')),
  primary key (user_id, permission)
);
create table if not exists role_permissions (
  role       app_role not null,
  permission text not null,
  primary key (role, permission)
);
-- failed sign-ins: only the server (service role) reads or writes this
create table if not exists login_attempts (
  login        citext primary key,
  failures     int not null default 0,
  locked_until timestamptz
);

-- --------------------------------------------------------------------------------- permission helpers
create or replace function app.current_user_id() returns text
language sql stable security definer set search_path = public as $$
  select id from app_users where auth_user_id = auth.uid() and active
$$;

create or replace function app.user_roles(uid text) returns app_role[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(r), '{}') from (
    select role as r from app_users where id = uid
    union select role from user_extra_roles where user_id = uid
  ) x
$$;

create or replace function app.is_master() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app.user_roles(app.current_user_id()) && array['superadmin','it']::app_role[], false)
$$;

create or replace function app.has_role(r app_role) returns boolean
language sql stable security definer set search_path = public as $$
  select r = any(app.user_roles(app.current_user_id()))
$$;

-- role permissions + extra roles + per-person allow − deny; master roles hold everything
create or replace function app.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  with me as (select app.current_user_id() as id)
  select case
    when (select id from me) is null then false
    when app.is_master() then true
    when exists (select 1 from user_permission_overrides o, me where o.user_id = me.id and o.permission = p and o.effect = 'deny') then false
    when exists (select 1 from user_permission_overrides o, me where o.user_id = me.id and o.permission = p and o.effect = 'allow') then true
    else exists (select 1 from role_permissions rp, me where rp.permission = p and rp.role = any(app.user_roles(me.id)))
  end
$$;

-- ======================================================================================== sales
create table if not exists services (
  id         text primary key default gen_random_uuid()::text,
  name       text not null unique,
  category   text not null,
  price      numeric(12,2) not null default 0 check (price >= 0),
  gst_rate   numeric(5,2) not null default 18 check (gst_rate between 0 and 28),
  deduction  numeric(12,2) not null default 0 check (deduction >= 0),
  active     boolean not null default true
);

create table if not exists leads (
  id           text primary key default gen_random_uuid()::text,
  code         text not null unique,
  name         text not null,
  company      text not null default '',
  phone        text not null unique check (phone ~ '^[0-9]{10}$'),
  email        citext,
  city         text not null default '',
  state        text not null default '',
  service      text not null default '',
  source       text not null default '',
  price        numeric(12,2) check (price is null or price >= 0),
  status       lead_status not null default 'NEW',
  follow_up    date,
  notes        text not null default '',
  assigned_to  text references app_users(id) on delete set null,
  created_by   text references app_users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists leads_assigned_status_idx on leads(assigned_to, status);
create index if not exists leads_follow_up_idx on leads(follow_up) where status in ('NEW','ATTEMPTED','CALL_BACK','INTERESTED');

create table if not exists lead_calls (
  id            text primary key default gen_random_uuid()::text,
  lead_id       text not null references leads(id) on delete cascade,
  called_at     timestamptz not null default now(),
  called_by     text references app_users(id) on delete set null,
  outcome       call_outcome not null,
  note          text not null default '',
  duration_sec  int not null default 0 check (duration_sec >= 0)
);
create index if not exists lead_calls_lead_idx on lead_calls(lead_id, called_at desc);
create index if not exists lead_calls_by_idx on lead_calls(called_by, called_at desc);

-- ======================================================================================== client files (CRM entries)
create table if not exists bookings (
  id               text primary key default gen_random_uuid()::text,
  booking_code     text not null unique,
  company_name     text not null,
  contact_person   text not null,
  mobile           text not null check (mobile ~ '^[0-9]{10}$'),
  email            citext,
  pan              text check (pan is null or pan = '' or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  gstin            text check (gstin is null or gstin = '' or length(gstin) = 15),
  city             text not null default '',
  state            text not null default '',
  industry         text not null default '',
  service_id       text references services(id) on delete set null,
  service_name     text not null,
  mode             booking_mode not null default 'Refundable',
  success_fee_pct  numeric(5,2) not null default 0,
  total_quoted     numeric(14,2) not null check (total_quoted > 0),
  gst_rate         numeric(5,2) not null default 18,
  deduction        numeric(12,2) not null default 0,
  created_by       text references app_users(id) on delete set null,
  team_lead_id     text references app_users(id) on delete set null,
  status           booking_status not null default 'PENDING_TL',
  hold_from        booking_status,
  hold_reason      text,
  ops_member_id    text references app_users(id) on delete set null,
  admin_id         text references app_users(id) on delete set null,
  stage            smallint not null default 1 check (stage between 1 and 9),
  max_stage        smallint not null default 1 check (max_stage between 1 and 9),
  priority         priority_level not null default 'MEDIUM',
  deadline         date,
  lead_id          text references leads(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists bookings_status_idx on bookings(status);
create index if not exists bookings_created_by_idx on bookings(created_by);
create index if not exists bookings_team_lead_idx on bookings(team_lead_id);
create index if not exists bookings_ops_idx on bookings(ops_member_id) where status in ('IN_OPERATIONS','ON_HOLD');
create index if not exists bookings_admin_idx on bookings(admin_id) where status = 'WITH_ADMIN';
create index if not exists bookings_mobile_idx on bookings(mobile);

create table if not exists booking_payments (
  id           text primary key default gen_random_uuid()::text,
  booking_id   text not null references bookings(id) on delete cascade,
  part         smallint not null check (part >= 1),
  amount       numeric(14,2) not null check (amount > 0),
  gst          numeric(14,2) not null default 0,
  total        numeric(14,2) not null,
  paid_on      date not null,
  mode         text not null,
  proof_name   text not null,
  recorded_by  text references app_users(id) on delete set null,
  verified     boolean not null default false,
  unique (booking_id, part)
);
create index if not exists booking_payments_paid_on_idx on booking_payments(paid_on);

create table if not exists booking_approvals (
  id          text primary key default gen_random_uuid()::text,
  booking_id  text not null references bookings(id) on delete cascade,
  level       text not null,
  action      text not null,
  decided_by  text references app_users(id) on delete set null,
  decided_at  timestamptz not null default now(),
  remark      text not null default ''
);
create index if not exists booking_approvals_booking_idx on booking_approvals(booking_id, decided_at);

create table if not exists booking_stage_moves (
  id          text primary key default gen_random_uuid()::text,
  booking_id  text not null references bookings(id) on delete cascade,
  stage       smallint not null check (stage between 1 and 9),
  moved_at    timestamptz not null default now(),
  moved_by    text references app_users(id) on delete set null,
  note        text not null default ''
);
create index if not exists booking_stage_moves_booking_idx on booking_stage_moves(booking_id, moved_at);

create table if not exists booking_comments (
  id          text primary key default gen_random_uuid()::text,
  booking_id  text not null references bookings(id) on delete cascade,
  author_id   text references app_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  body        text not null,
  kind        text not null default ''
);
create index if not exists booking_comments_booking_idx on booking_comments(booking_id, created_at);

-- files themselves go to the Supabase Storage bucket "client-documents"; storage_path points at them
create table if not exists booking_documents (
  id            text primary key default gen_random_uuid()::text,
  booking_id    text not null references bookings(id) on delete cascade,
  name          text not null,
  category      text not null,
  size_bytes    bigint not null default 0 check (size_bytes >= 0),
  uploaded_at   timestamptz not null default now(),
  uploaded_by   text references app_users(id) on delete set null,
  status        doc_status not null default 'PENDING',
  storage_path  text
);
create index if not exists booking_documents_booking_idx on booking_documents(booking_id);

create table if not exists booking_tasks (
  id          text primary key default gen_random_uuid()::text,
  booking_id  text not null references bookings(id) on delete cascade,
  title       text not null,
  done        boolean not null default false,
  due_on      date,
  created_by  text references app_users(id) on delete set null,
  assignee_id text references app_users(id) on delete set null
);
create index if not exists booking_tasks_booking_idx on booking_tasks(booking_id);

-- ======================================================================================== billing
create table if not exists invoices (
  id            text primary key default gen_random_uuid()::text,
  number        text not null unique,
  type          invoice_type not null,
  booking_id    text references bookings(id) on delete set null,
  client        text not null,
  gstin         text not null default '',
  state         text not null,
  paid          numeric(14,2) not null default 0 check (paid >= 0),
  status        invoice_status not null default 'ISSUED',
  issued_on     date not null default current_date,
  due_on        date not null,
  sales_person  text references app_users(id) on delete set null,
  created_by    text references app_users(id) on delete set null
);
create index if not exists invoices_sales_person_idx on invoices(sales_person);
create table if not exists invoice_items (
  invoice_id   text not null references invoices(id) on delete cascade,
  position     smallint not null,
  description  text not null,
  sac          text not null default '',
  qty          numeric(10,2) not null check (qty > 0),
  rate         numeric(14,2) not null check (rate >= 0),
  gst_rate     numeric(5,2) not null default 18,
  primary key (invoice_id, position)
);

-- ======================================================================================== content
create table if not exists schemes (
  id text primary key default gen_random_uuid()::text, title text not null, category text not null default '', summary text not null default '',
  benefit text not null default '', eligibility text not null default '', active boolean not null default true,
  created_at timestamptz not null default now(), created_by text references app_users(id) on delete set null
);
create table if not exists posts (
  id text primary key default gen_random_uuid()::text, kind post_kind not null, title text not null, body text not null default '',
  theme text not null default 'navy', pinned boolean not null default false,
  created_at timestamptz not null default now(), created_by text references app_users(id) on delete set null
);
create table if not exists broadcasts (
  id text primary key default gen_random_uuid()::text, title text not null, body text not null, priority broadcast_priority not null default 'NORMAL',
  audience app_role[],          -- null = everyone
  created_at timestamptz not null default now(), created_by text references app_users(id) on delete set null
);
create table if not exists broadcast_acks (
  broadcast_id text not null references broadcasts(id) on delete cascade,
  user_id text not null references app_users(id) on delete cascade,
  acked_at timestamptz not null default now(),
  primary key (broadcast_id, user_id)
);
create table if not exists events (
  id text primary key default gen_random_uuid()::text, title text not null, event_date date not null, event_time time,
  kind event_kind not null, description text not null default '', created_by text references app_users(id) on delete set null
);
create index if not exists events_date_idx on events(event_date);

-- ======================================================================================== people operations
create table if not exists day_sessions (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references app_users(id) on delete cascade,
  work_date date not null,
  login_at timestamptz not null,
  logout_at timestamptz,
  unique (user_id, work_date),
  check (logout_at is null or logout_at >= login_at)
);
create index if not exists day_sessions_date_idx on day_sessions(work_date);

create table if not exists leave_requests (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references app_users(id) on delete cascade,
  type leave_type not null,
  from_date date not null,
  to_date date not null,
  days numeric(4,1) not null check (days > 0),
  reason text not null,
  status leave_status not null default 'PENDING',
  approver_roles app_role[] not null,
  decided_by text references app_users(id) on delete set null,
  decided_at timestamptz,
  remark text,
  created_at timestamptz not null default now(),
  check (to_date >= from_date)
);
create index if not exists leave_requests_user_idx on leave_requests(user_id, from_date);
create index if not exists leave_requests_pending_idx on leave_requests(status) where status = 'PENDING';

-- ======================================================================================== payroll, PF, incentives
create table if not exists payroll_runs (
  id text primary key default gen_random_uuid()::text,
  month char(7) not null unique check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  status payroll_status not null default 'CALCULATED',
  provisional boolean not null default false,
  calculated_at timestamptz not null default now(),
  calculated_by text references app_users(id) on delete set null
);
create table if not exists payroll_rows (
  run_id text not null references payroll_runs(id) on delete cascade,
  user_id text not null references app_users(id) on delete restrict,
  name text not null, designation text not null default '', department text not null default '',
  ctc numeric(12,2), basic numeric(12,2) not null, hra numeric(12,2), other_allowance numeric(12,2),
  pf_wages numeric(12,2) not null default 0, pf_employer numeric(12,2) not null default 0, gross numeric(12,2) not null,
  days_in_month smallint not null, paid_days numeric(4,1) not null, lop_days numeric(4,1) not null, lop_amount numeric(12,2) not null default 0,
  pf_employee numeric(12,2) not null default 0, professional_tax numeric(10,2) not null default 0,
  incentive numeric(12,2) not null default 0,   -- HR reference only; never part of net salary / payslip
  net_salary numeric(12,2) not null,
  primary key (run_id, user_id)
);
create index if not exists payroll_rows_user_idx on payroll_rows(user_id);
create table if not exists payroll_history (
  id bigint generated always as identity primary key,
  run_id text not null references payroll_runs(id) on delete cascade,
  at timestamptz not null default now(), by_user text references app_users(id) on delete set null,
  action text not null, note text not null default ''
);
create table if not exists pf_accounts (
  user_id text primary key references app_users(id) on delete cascade,
  uan text check (uan is null or uan = '' or uan ~ '^[0-9]{12}$'),
  enrolled boolean not null default true
);
create table if not exists incentive_rule_versions (
  version int primary key,
  rules jsonb not null,                       -- thresholds, percentages and slabs
  updated_at timestamptz not null default now(),
  updated_by text references app_users(id) on delete set null
);
create table if not exists manual_incentives (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references app_users(id) on delete cascade,
  month char(7) not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  amount numeric(12,2) not null check (amount > 0),
  reason text not null,
  added_by text references app_users(id) on delete set null,
  added_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists manual_incentives_month_idx on manual_incentives(month);

-- ======================================================================================== communication
create table if not exists notifications (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references app_users(id) on delete cascade,
  title text not null, body text not null default '', link text, kind notice_kind not null default 'info',
  created_at timestamptz not null default now(), read boolean not null default false
);
create index if not exists notifications_user_idx on notifications(user_id, created_at desc);

create table if not exists messages (
  id text primary key default gen_random_uuid()::text,
  from_user text not null references app_users(id) on delete cascade,
  to_user text not null references app_users(id) on delete cascade,
  body text not null, sent_at timestamptz not null default now(), read boolean not null default false
);
create index if not exists messages_pair_idx on messages(least(from_user, to_user), greatest(from_user, to_user), sent_at);

create table if not exists message_templates (
  id text primary key default gen_random_uuid()::text, name text not null, body text not null,
  created_by text references app_users(id) on delete set null
);

create table if not exists emails (
  id text primary key default gen_random_uuid()::text,
  batch_id text not null,
  to_user text not null references app_users(id) on delete cascade,
  to_email citext not null,
  from_user text references app_users(id) on delete set null,   -- null = sent by an automation
  subject text not null, body text not null,
  sent_at timestamptz not null default now(),
  automation text,
  read boolean not null default false
);
create index if not exists emails_to_idx on emails(to_user, sent_at desc);
create index if not exists emails_batch_idx on emails(batch_id);

create table if not exists email_automations (
  key text primary key, enabled boolean not null default true, subject text not null, body text not null,
  last_run_key text, last_run_at timestamptz, sent int not null default 0
);

-- ======================================================================================== recruitment imports
create table if not exists recruitment_datasets (
  id text primary key default gen_random_uuid()::text,
  name text not null, file_name text not null, sheet text, kind dataset_kind not null,
  columns jsonb not null,                    -- ["Candidate","Stage",…]
  imported_at timestamptz not null default now(),
  imported_by text references app_users(id) on delete set null,
  bytes bigint not null default 0
);
create table if not exists recruitment_rows (
  dataset_id text not null references recruitment_datasets(id) on delete cascade,
  row_no int not null,
  cells jsonb not null,                      -- ["Aarav Shah","Interview",…] in column order
  primary key (dataset_id, row_no)
);

-- ======================================================================================== administration
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  by_user text references app_users(id) on delete set null,
  action text not null,
  detail text not null default ''
);
create index if not exists audit_log_at_idx on audit_log(at desc);
create index if not exists audit_log_by_idx on audit_log(by_user, at desc);

-- company settings, maintenance mode, PF & salary structure … one row per key
create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text references app_users(id) on delete set null
);

create table if not exists api_keys (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  prefix text not null,
  key_hash text not null unique,             -- SHA-256 of the key; the key itself is never stored
  scopes text[] not null,
  created_by text references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by text references app_users(id) on delete set null
);
create table if not exists backup_log (
  id text primary key default gen_random_uuid()::text,
  at timestamptz not null default now(),
  by_user text references app_users(id) on delete set null,
  kind backup_kind not null, note text not null default '', bytes bigint not null default 0, encrypted boolean not null default false
);

-- ------------------------------------------------------------------- guard: no self-promotion, protect Super Admins
-- People may edit their own profile (name, phone, address, photo) but never their role, access, salary or sign-in
-- identity; only access managers can, and only a Super Admin can touch Super Admin accounts. Service-role calls
-- (migrations, the server) have no CRM user and pass through.
create or replace function app.guard_user_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if app.me() is null then return new; end if;
  if (new.role, new.active, new.salary, new.sales_target, new.team_lead_id, new.auth_user_id, new.username, new.email, new.exit_on)
     is distinct from (old.role, old.active, old.salary, old.sales_target, old.team_lead_id, old.auth_user_id, old.username, old.email, old.exit_on)
     and not (app.has_perm('access.manage') or app.has_perm('employees.manage')) then
    raise exception 'Only HR or access managers can change role, access, salary or sign-in details.';
  end if;
  if old.id = app.me() and (new.role, new.active) is distinct from (old.role, old.active) then
    raise exception 'You cannot change your own role or deactivate yourself.';
  end if;
  if (old.role = 'superadmin' or new.role = 'superadmin') and not app.has_role('superadmin') then
    raise exception 'Only a Super Admin can change Super Admin accounts.';
  end if;
  return new;
end $$;
drop trigger if exists app_users_guard on app_users;
create trigger app_users_guard before update on app_users for each row execute function app.guard_user_update();

create or replace function app.guard_extra_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if app.me() is null then return coalesce(new, old); end if;
  if coalesce(new.role, old.role) = 'superadmin' and not app.has_role('superadmin') then
    raise exception 'Only a Super Admin can grant the Super Admin role.';
  end if;
  if coalesce(new.user_id, old.user_id) = app.me() then
    raise exception 'You cannot change your own access.';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists user_extra_roles_guard on user_extra_roles;
create trigger user_extra_roles_guard before insert or update or delete on user_extra_roles for each row execute function app.guard_extra_role();

-- ------------------------------------------------------------------------------- updated_at triggers
do $$ declare t text; begin
  foreach t in array array['app_users','bookings'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before update on %I for each row execute function app.touch_updated_at()', t, t);
  end loop;
end $$;

-- ======================================================================================== row-level security
-- enable on every table (nothing is readable until a policy allows it; the service role bypasses RLS)
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- small helpers used by policies
create or replace function app.me() returns text language sql stable as $$ select app.current_user_id() $$;
create or replace function app.can_see_booking(b_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from bookings b where b.id = b_id and (
      app.has_perm('bookings.all')
      or b.created_by = app.me()
      or (app.has_perm('bookings.team') and (b.team_lead_id = app.me() or exists (select 1 from app_users u where u.id = b.created_by and u.team_lead_id = app.me())))
    )
  )
$$;
create or replace function app.can_see_lead(l_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from leads l where l.id = l_id and (
      app.has_perm('leads.manage')
      or l.assigned_to = app.me()
      or (l.assigned_to is null and l.created_by = app.me())
      or (app.has_perm('leads.assign') and (l.assigned_to is null or exists (select 1 from app_users u where u.id = l.assigned_to and u.team_lead_id = app.me())))
    )
  )
$$;

-- drop-and-create so the file can be re-run
do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- people & access
create policy users_read on app_users for select to authenticated using (true);
create policy users_write on app_users for all to authenticated using (app.has_perm('access.manage') or app.has_perm('employees.manage')) with check (app.has_perm('access.manage') or app.has_perm('employees.manage'));
create policy users_self_update on app_users for update to authenticated using (id = app.me()) with check (id = app.me());
create policy extra_roles_read on user_extra_roles for select to authenticated using (true);
create policy extra_roles_write on user_extra_roles for all to authenticated using (app.has_perm('access.manage')) with check (app.has_perm('access.manage'));
create policy overrides_read on user_permission_overrides for select to authenticated using (user_id = app.me() or app.has_perm('access.manage'));
create policy overrides_write on user_permission_overrides for all to authenticated using (app.has_perm('access.manage')) with check (app.has_perm('access.manage'));
create policy role_perms_read on role_permissions for select to authenticated using (true);
create policy role_perms_write on role_permissions for all to authenticated using (app.has_perm('access.manage')) with check (app.has_perm('access.manage'));
-- login_attempts: no policy → only the service role can touch it

-- sales
create policy services_read on services for select to authenticated using (true);
create policy services_write on services for all to authenticated using (app.is_master() or app.has_perm('schemes.manage')) with check (app.is_master() or app.has_perm('schemes.manage'));
create policy leads_read on leads for select to authenticated using (app.can_see_lead(id));
create policy leads_insert on leads for insert to authenticated with check (app.has_perm('leads.own') or app.has_perm('leads.manage'));
create policy leads_update on leads for update to authenticated using (app.can_see_lead(id)) with check (app.can_see_lead(id));
create policy leads_delete on leads for delete to authenticated using (app.has_perm('leads.manage'));
create policy calls_read on lead_calls for select to authenticated using (app.can_see_lead(lead_id));
create policy calls_insert on lead_calls for insert to authenticated with check (app.can_see_lead(lead_id) and (app.has_perm('dialer.use') or app.has_perm('leads.manage')));

-- client files: the parent decides who sees children
create policy bookings_read on bookings for select to authenticated using (app.can_see_booking(id));
create policy bookings_insert on bookings for insert to authenticated with check (app.has_perm('bookings.create'));
create policy bookings_update on bookings for update to authenticated using (app.can_see_booking(id)) with check (app.can_see_booking(id));
create policy bookings_delete on bookings for delete to authenticated using (app.is_master());
create policy b_payments_all on booking_payments for all to authenticated using (app.can_see_booking(booking_id)) with check (app.can_see_booking(booking_id));
create policy b_approvals_all on booking_approvals for all to authenticated using (app.can_see_booking(booking_id)) with check (app.can_see_booking(booking_id));
create policy b_stages_all on booking_stage_moves for all to authenticated using (app.can_see_booking(booking_id)) with check (app.can_see_booking(booking_id));
create policy b_comments_all on booking_comments for all to authenticated using (app.can_see_booking(booking_id)) with check (app.can_see_booking(booking_id));
create policy b_docs_all on booking_documents for all to authenticated using (app.can_see_booking(booking_id)) with check (app.can_see_booking(booking_id));
create policy b_tasks_all on booking_tasks for all to authenticated using (app.can_see_booking(booking_id)) with check (app.can_see_booking(booking_id));

-- billing
create policy invoices_read on invoices for select to authenticated using (app.has_perm('billing.manage') or sales_person = app.me() or created_by = app.me());
create policy invoices_insert on invoices for insert to authenticated with check (app.has_perm('billing.create') or app.has_perm('billing.manage'));
create policy invoices_update on invoices for update to authenticated using (app.has_perm('billing.manage')) with check (app.has_perm('billing.manage'));
create policy invoice_items_read on invoice_items for select to authenticated using (exists (select 1 from invoices i where i.id = invoice_id and (app.has_perm('billing.manage') or i.sales_person = app.me() or i.created_by = app.me())));
create policy invoice_items_write on invoice_items for all to authenticated using (app.has_perm('billing.create') or app.has_perm('billing.manage')) with check (app.has_perm('billing.create') or app.has_perm('billing.manage'));

-- content
create policy schemes_read on schemes for select to authenticated using (active or app.has_perm('schemes.manage'));
create policy schemes_write on schemes for all to authenticated using (app.has_perm('schemes.manage')) with check (app.has_perm('schemes.manage'));
create policy posts_read on posts for select to authenticated using (app.has_perm('content.view') or app.has_perm('content.manage'));
create policy posts_write on posts for all to authenticated using (app.has_perm('content.manage')) with check (app.has_perm('content.manage'));
create policy broadcasts_read on broadcasts for select to authenticated using (audience is null or app.user_roles(app.me()) && audience or app.has_perm('broadcasts.manage'));
create policy broadcasts_write on broadcasts for all to authenticated using (app.has_perm('broadcasts.manage')) with check (app.has_perm('broadcasts.manage'));
create policy acks_read on broadcast_acks for select to authenticated using (true);
create policy acks_insert on broadcast_acks for insert to authenticated with check (user_id = app.me());
create policy events_read on events for select to authenticated using (true);
create policy events_write on events for all to authenticated using (app.has_perm('events.manage')) with check (app.has_perm('events.manage'));

-- people operations
create policy sessions_read on day_sessions for select to authenticated using (user_id = app.me() or app.has_perm('attendance.all'));
create policy sessions_write on day_sessions for all to authenticated using (user_id = app.me() or app.is_master()) with check (user_id = app.me() or app.is_master());
create policy leave_read on leave_requests for select to authenticated using (user_id = app.me() or app.has_perm('leave.approve') or app.has_perm('attendance.all'));
create policy leave_insert on leave_requests for insert to authenticated with check (user_id = app.me());
create policy leave_update on leave_requests for update to authenticated using (user_id = app.me() or app.has_perm('leave.approve')) with check (user_id = app.me() or app.has_perm('leave.approve'));

-- payroll: HR / master manage; everyone sees their own finalised rows (payslips)
create policy runs_read on payroll_runs for select to authenticated using (app.has_perm('payroll.view') or status in ('FINALIZED','PAID'));
create policy runs_write on payroll_runs for all to authenticated using (app.has_perm('payroll.manage')) with check (app.has_perm('payroll.manage'));
create policy rows_read on payroll_rows for select to authenticated using (app.has_perm('payroll.view') or (user_id = app.me() and exists (select 1 from payroll_runs r where r.id = run_id and r.status in ('FINALIZED','PAID'))));
create policy rows_write on payroll_rows for all to authenticated using (app.has_perm('payroll.manage')) with check (app.has_perm('payroll.manage'));
create policy payroll_history_read on payroll_history for select to authenticated using (app.has_perm('payroll.view'));
create policy payroll_history_write on payroll_history for insert to authenticated with check (app.has_perm('payroll.manage'));
create policy pf_read on pf_accounts for select to authenticated using (user_id = app.me() or app.has_perm('payroll.view'));
create policy pf_write on pf_accounts for all to authenticated using (app.has_perm('payroll.manage')) with check (app.has_perm('payroll.manage'));
create policy rules_read on incentive_rule_versions for select to authenticated using (true);
create policy rules_write on incentive_rule_versions for insert to authenticated with check (app.has_perm('incentives.manage'));
-- manual incentives are HR-only (never shown to the employee)
create policy manual_inc_all on manual_incentives for all to authenticated using (app.has_perm('incentives.manage') or app.has_perm('payroll.view')) with check (app.has_perm('incentives.manage'));

-- communication
create policy notices_own on notifications for select to authenticated using (user_id = app.me());
create policy notices_update_own on notifications for update to authenticated using (user_id = app.me()) with check (user_id = app.me());
create policy notices_insert on notifications for insert to authenticated with check (app.me() is not null);
create policy messages_read on messages for select to authenticated using (from_user = app.me() or to_user = app.me());
create policy messages_insert on messages for insert to authenticated with check (from_user = app.me() and app.has_perm('messages.use'));
create policy messages_update on messages for update to authenticated using (to_user = app.me()) with check (to_user = app.me());
create policy templates_read on message_templates for select to authenticated using (true);
create policy templates_write on message_templates for all to authenticated using (app.has_perm('templates.manage')) with check (app.has_perm('templates.manage'));
create policy emails_read on emails for select to authenticated using (to_user = app.me() or app.has_perm('email.send'));
create policy emails_mark_read on emails for update to authenticated using (to_user = app.me()) with check (to_user = app.me());
create policy emails_send on emails for insert to authenticated with check (app.has_perm('email.send'));
create policy emails_delete on emails for delete to authenticated using (app.has_perm('email.send'));
create policy automations_read on email_automations for select to authenticated using (true);
create policy automations_write on email_automations for update to authenticated using (app.has_perm('email.send')) with check (app.has_perm('email.send'));

-- recruitment
create policy datasets_all on recruitment_datasets for all to authenticated using (app.has_perm('recruitment.manage')) with check (app.has_perm('recruitment.manage'));
create policy dataset_rows_all on recruitment_rows for all to authenticated using (app.has_perm('recruitment.manage')) with check (app.has_perm('recruitment.manage'));

-- administration
create policy audit_read on audit_log for select to authenticated using (app.has_perm('audit.view'));
create policy audit_insert on audit_log for insert to authenticated with check (by_user = app.me());
create policy settings_read on app_settings for select to authenticated using (true);
create policy settings_write on app_settings for all to authenticated using (app.is_master() or (key = 'pf' and app.has_role('hr'))) with check (app.is_master() or (key = 'pf' and app.has_role('hr')));
create policy api_keys_master on api_keys for all to authenticated using (app.is_master()) with check (app.is_master());
create policy backup_log_master on backup_log for all to authenticated using (app.is_master()) with check (app.is_master());

-- the API roles may call the helper functions used by policies (but the "app" schema itself is not exposed)
grant usage on schema app to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;


-- ##################################################################### 20261006010000_legacy_import.sql

-- =====================================================================================================================
-- Rexera CRM · records imported from the old PHP CRM (u417368936_crm)
--  - Keeps every original column (legacy jsonb) so the import stays lossless in the cloud too.
--  - New entries keep the strict checks; rows imported from the old CRM (legacy_id is not null) are stored exactly as
--    they were, even where the old system allowed things the new one doesn't (short mobiles, odd PANs, ₹0 quotes,
--    small negative rounding adjustments).
--  - Safe to run more than once.
-- =====================================================================================================================

-- ------------------------------------------------------------------ people
alter table app_users add column if not exists legacy_id int unique;
alter table app_users add column if not exists legacy_role text;
alter table app_users add column if not exists needs_password_reset boolean not null default false;
alter table app_users drop constraint if exists app_users_phone_check;
alter table app_users add constraint app_users_phone_check check (phone is null or phone ~ '^[6-9][0-9]{9}$' or legacy_id is not null);
alter table app_users drop constraint if exists app_users_name_check;
alter table app_users add constraint app_users_name_check check (length(trim(name)) >= 2 or legacy_id is not null);

-- ------------------------------------------------------------------ leads
alter table leads add column if not exists legacy jsonb;
alter table leads drop constraint if exists leads_phone_check;
alter table leads add constraint leads_phone_check check (phone ~ '^[0-9]{10}$' or legacy is not null);
-- the old CRM allowed the same number on several leads; keep the number unique for new leads only
alter table leads drop constraint if exists leads_phone_key;
create unique index if not exists leads_phone_new_uidx on leads(phone) where legacy is null;
create index if not exists leads_phone_idx on leads(phone);

-- ------------------------------------------------------------------ client files
alter table bookings add column if not exists legacy_id int unique;
-- { crm: {...every column...}, workflow: {...}, deductions: [...] } exactly as in the old database
alter table bookings add column if not exists legacy jsonb;
alter table bookings drop constraint if exists bookings_mobile_check;
alter table bookings add constraint bookings_mobile_check check (mobile ~ '^[0-9]{10}$' or legacy_id is not null);
alter table bookings drop constraint if exists bookings_pan_check;
alter table bookings add constraint bookings_pan_check check (pan is null or pan = '' or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$' or legacy_id is not null);
alter table bookings drop constraint if exists bookings_gstin_check;
alter table bookings add constraint bookings_gstin_check check (gstin is null or gstin = '' or length(gstin) = 15 or legacy_id is not null);
alter table bookings drop constraint if exists bookings_total_quoted_check;
alter table bookings add constraint bookings_total_quoted_check check (total_quoted > 0 or (legacy_id is not null and total_quoted >= 0));
-- client details the old CRM recorded
alter table bookings add column if not exists address text;
alter table bookings add column if not exists website text;
alter table bookings add column if not exists cin text;
alter table bookings add column if not exists startup_contact jsonb;   -- { phone, email }
alter table bookings add column if not exists billing jsonb;           -- invoice-to { name, pan, gstin, contact, email }
alter table bookings add column if not exists owner_name text;         -- closer's name when not a CRM user
create index if not exists bookings_legacy_idx on bookings(legacy_id) where legacy_id is not null;

-- payments: the old CRM has a few tiny negative amounts (rounding fixes); they are imported as adjustments
alter table booking_payments add column if not exists is_adjustment boolean not null default false;
alter table booking_payments add column if not exists date_unknown boolean not null default false;  -- old CRM had no date; paid_on = booking day
alter table booking_payments drop constraint if exists booking_payments_amount_check;
alter table booking_payments add constraint booking_payments_amount_check check (amount > 0 or (is_adjustment and amount <> 0));

-- documents: the file stays on the old server until copied; legacy_path says where it was
alter table booking_documents add column if not exists legacy_path text;


-- ##################################################################### 20261007000000_hr_updates.sql

-- =====================================================================================================================
-- Rexera CRM · HR updates
--  - Pause / resume: breaks inside a working day (40-minute daily budget enforced by the app), re-opened days
--  - Leave attachments, employee resumes (file metadata; the files go to Storage buckets "leave-attachments" / "resumes")
--  - Candidate forms: a public apply link per role; anyone may apply while the form is open, only HR reads applications
--  - Safe to run more than once.
-- =====================================================================================================================

alter table day_sessions add column if not exists breaks jsonb not null default '[]'::jsonb;      -- [{ start, end }]
alter table day_sessions add column if not exists reopened_by text references app_users(id) on delete set null;
alter table leave_requests add column if not exists attachment jsonb;                              -- { id, name, type, size, at }
alter table app_users add column if not exists resume jsonb;

create table if not exists candidate_forms (
  id           text primary key default gen_random_uuid()::text,
  token        text not null unique check (length(token) >= 10),
  title        text not null check (length(trim(title)) >= 2),
  kind         text not null default 'JOB' check (kind in ('JOB', 'INTERNSHIP')),
  department   text not null default '',
  description  text not null default '',
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   text references app_users(id) on delete set null
);

create table if not exists candidate_applications (
  id               text primary key default gen_random_uuid()::text,
  form_id          text not null references candidate_forms(id) on delete restrict,
  name             text not null check (length(trim(name)) >= 2),
  email            citext not null,
  phone            text not null check (phone ~ '^[0-9]{10}$'),
  city             text not null default '',
  dob              date,
  qualification    text not null,
  college          text,
  experience       text not null default '',
  current_company  text,
  expected_salary  text,
  notice_period    text,
  linkedin         text,
  message          text,
  resume           jsonb not null,                                       -- mandatory: { id, name, type, size, at }
  status           text not null default 'NEW' check (status in ('NEW', 'SHORTLISTED', 'REJECTED', 'HIRED')),
  notes            text,
  submitted_at     timestamptz not null default now(),
  unique (form_id, email)
);
create index if not exists candidate_applications_form_idx on candidate_applications(form_id, submitted_at desc);

alter table candidate_forms enable row level security;
alter table candidate_applications enable row level security;

drop policy if exists candidate_forms_public_read on candidate_forms;
drop policy if exists candidate_forms_hr on candidate_forms;
drop policy if exists candidate_apps_public_insert on candidate_applications;
drop policy if exists candidate_apps_hr on candidate_applications;

-- the public form page reads open forms by token
create policy candidate_forms_public_read on candidate_forms for select to anon, authenticated using (active);
create policy candidate_forms_hr on candidate_forms for all to authenticated using (app.has_perm('recruitment.manage')) with check (app.has_perm('recruitment.manage'));
-- anyone may apply to an open form, always as a NEW application; nobody but HR can read applications back
create policy candidate_apps_public_insert on candidate_applications for insert to anon, authenticated
  with check (status = 'NEW' and notes is null and exists (select 1 from candidate_forms f where f.id = form_id and f.active));
create policy candidate_apps_hr on candidate_applications for all to authenticated using (app.has_perm('recruitment.manage')) with check (app.has_perm('recruitment.manage'));

grant select on candidate_forms to anon;
grant insert on candidate_applications to anon;


-- ##################################################################### 20261008000000_crm_updates.sql

-- =====================================================================================================================
-- Rexera CRM · CRM updates
--  - Workflow: Admin finishes client work → "Pending Operations approval" (OPS_REVIEW) → Operations approves → Completed
--  - 8 work stages; stage 3 has a step (in process / in review), stage 8 a result (approved / rejected / re-submission / hold)
--  - New CRM entry fields: several services with price bifurcation, combo period, payment contact, booking date,
--    after-discount success fee, remarks, closed by; payment proofs and documents as stored files
--  - Task reminders every 15 days · invoice branch + both parties' details · documents shared in messages
--  - Safe to run more than once.
-- =====================================================================================================================

alter type booking_status add value if not exists 'OPS_REVIEW' after 'WITH_ADMIN';

alter table bookings drop constraint if exists bookings_stage_check;
alter table bookings add constraint bookings_stage_check check (stage between 1 and 8);
alter table bookings drop constraint if exists bookings_max_stage_check;
alter table bookings add constraint bookings_max_stage_check check (max_stage between 1 and 8);
alter table booking_stage_moves drop constraint if exists booking_stage_moves_stage_check;
alter table booking_stage_moves add constraint booking_stage_moves_stage_check check (stage between 1 and 8);

alter table bookings add column if not exists stage_outcome text check (stage_outcome is null or stage_outcome in ('IN_PROCESS', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'RESUBMISSION', 'HOLD_CLIENT'));
alter table bookings add column if not exists stage_reason text;           -- why stage 8 is rejected / re-submission / hold
alter table booking_stage_moves add column if not exists outcome text;
alter table bookings add column if not exists services jsonb;          -- [{ serviceId, name, price }]
alter table bookings add column if not exists combo jsonb;             -- { months, startedOn, deadline, deadlineNotified }
alter table bookings add column if not exists payment_contact text check (payment_contact is null or payment_contact ~ '^[0-9]{10}$');
alter table bookings add column if not exists payment_email citext;
alter table bookings add column if not exists booking_date date;
alter table bookings add column if not exists success_fee jsonb;       -- { type: 'AMOUNT' | 'PCT', value }
alter table bookings add column if not exists remarks text;
alter table bookings add column if not exists closed_by text references app_users(id) on delete set null;

alter table booking_payments add column if not exists proof jsonb;     -- stored file { id, name, type, size, at }
alter table booking_documents add column if not exists file jsonb;

alter table booking_tasks add column if not exists remind_every_days smallint check (remind_every_days is null or remind_every_days > 0);
alter table booking_tasks add column if not exists last_reminded_at timestamptz;
alter table booking_tasks add column if not exists created_at timestamptz not null default now();

alter table invoices add column if not exists branch_id text;
alter table invoices add column if not exists client_address text;
alter table invoices add column if not exists client_pan text;

alter table messages add column if not exists attachments jsonb;       -- [{ id, name, type, size, at }]


-- ##################################################################### 20261009000000_break_monitoring.sql

-- =====================================================================================================================
-- Rexera CRM · Break time & late-break monitoring
--  - Late-break record per working day (break start, expected / actual return, minutes late, when the employee was warned)
--  - Per-employee shift: own break window, time zone and weekly off days (missing = company policy)
--  - Company break policy lives in app_settings under key 'break_policy':
--      { start, end, timeZone, offDays, warnAfterMin, remind, monitor, warnMessage }
--  - Safe to run more than once.
-- =====================================================================================================================

alter table day_sessions add column if not exists late_break jsonb;     -- { breakStart, expectedReturn, returnedAt, lateMinutes, warnedAt }
alter table app_users add column if not exists shift jsonb;             -- { breakStart, breakEnd, timeZone, offDays }

create index if not exists day_sessions_late_break_idx on day_sessions(user_id, work_date) where late_break is not null;

insert into app_settings (key, value)
values ('break_policy', '{"start":"13:00","end":"13:40","timeZone":"Asia/Kolkata","offDays":[0],"warnAfterMin":2,"remind":true,"monitor":true,"warnMessage":"Bhai, tame late chho. Break time complete thai gayu chhe. Please immediately return to work."}'::jsonb)
on conflict (key) do nothing;


-- ##################################################################### 20261010000000_client_emails.sql

-- =====================================================================================================================
-- Rexera CRM · Emails to clients
--  - The Operation team and Admin email the client from the CRM entry (branded templates, sent by the mail server).
--  - Every email is logged on the entry: who, when, to / cc, subject, template and whether it was sent.
--  - Safe to run more than once.
-- =====================================================================================================================

create table if not exists booking_client_emails (
  id text primary key default gen_random_uuid()::text,
  booking_id text not null references bookings(id) on delete cascade,
  sent_by text references app_users(id) on delete set null,
  sent_at timestamptz not null default now(),
  to_email citext not null,
  cc text[] not null default '{}',
  subject text not null check (length(subject) between 1 and 200),
  template text not null,
  status text not null check (status in ('SENT', 'MAIL_APP', 'FAILED')),
  error text
);
create index if not exists booking_client_emails_booking_idx on booking_client_emails(booking_id, sent_at desc);

alter table booking_client_emails enable row level security;


-- ##################################################################### 20261011000000_assets_expenses.sql

-- =====================================================================================================================
-- Rexera CRM · Company assets, inventory and expenses (HR)
--  - Assets: tracked one by one (tag RX-AST-0001), handed to employees, with a history of every hand-over and repair.
--  - Inventory: consumables counted by quantity, with stock in / out movements and a low-stock level.
--  - Expenses: company spending with GST, payment mode and the bill (file metadata; files go to Storage bucket "bills").
--  - Safe to run more than once.
-- =====================================================================================================================

create table if not exists company_assets (
  id text primary key default gen_random_uuid()::text,
  tag text not null unique,
  name text not null,
  category text not null,
  brand text, model text, serial text,
  purchase_date date, cost numeric(12,2) check (cost is null or cost >= 0), vendor text, warranty_until date,
  location text, condition text check (condition is null or condition in ('NEW', 'GOOD', 'FAIR', 'POOR')),
  status text not null default 'IN_STOCK' check (status in ('IN_STOCK', 'ASSIGNED', 'REPAIR', 'RETIRED')),
  assigned_to text references app_users(id) on delete set null,
  assigned_on date,
  notes text,
  invoice jsonb,                                   -- { id, name, type, size, at }
  created_at timestamptz not null default now(),
  check ((status = 'ASSIGNED') = (assigned_to is not null))
);
create unique index if not exists company_assets_serial_idx on company_assets (lower(serial)) where serial is not null;

create table if not exists asset_events (
  id bigint generated always as identity primary key,
  asset_id text not null references company_assets(id) on delete cascade,
  at timestamptz not null default now(),
  by_user text references app_users(id) on delete set null,
  action text not null check (action in ('ADDED', 'ASSIGNED', 'RETURNED', 'REPAIR', 'RETIRED', 'BACK_IN_STOCK', 'EDITED')),
  user_id text references app_users(id) on delete set null,
  note text
);
create index if not exists asset_events_asset_idx on asset_events(asset_id, at desc);

create table if not exists stock_items (
  id text primary key default gen_random_uuid()::text,
  name text not null unique,
  category text not null,
  unit text not null,
  qty integer not null default 0 check (qty >= 0),
  min_qty integer not null default 0 check (min_qty >= 0),
  unit_cost numeric(12,2) check (unit_cost is null or unit_cost >= 0),
  location text,
  created_at timestamptz not null default now()
);

create table if not exists stock_moves (
  id bigint generated always as identity primary key,
  item_id text not null references stock_items(id) on delete cascade,
  at timestamptz not null default now(),
  by_user text references app_users(id) on delete set null,
  qty integer not null check (qty <> 0),
  note text,
  issued_to text references app_users(id) on delete set null
);

create table if not exists company_expenses (
  id text primary key default gen_random_uuid()::text,
  spent_on date not null,
  category text not null,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  gst numeric(12,2) not null default 0 check (gst >= 0 and gst <= amount),
  vendor text,
  paid_via text not null check (paid_via in ('CASH', 'UPI', 'BANK', 'CARD', 'CHEQUE')),
  paid_by text references app_users(id) on delete set null,
  bill jsonb,
  added_by text references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists company_expenses_date_idx on company_expenses(spent_on desc);

alter table company_assets enable row level security;
alter table asset_events enable row level security;
alter table stock_items enable row level security;
alter table stock_moves enable row level security;
alter table company_expenses enable row level security;


-- ##################################################################### 20261012000000_branch_director.sql

-- =====================================================================================================================
-- Rexera CRM · Branch Director role and branches on people
--  - New role 'branchdirector': runs one or more branches, sees branch-wise and per-sales-person progress, assigns clients.
--  - Every person can belong to a branch (branch-wise reports); a Branch Director can run several (empty = every branch).
--  - Safe to run more than once.
-- =====================================================================================================================

alter type app_role add value if not exists 'branchdirector';

alter table app_users add column if not exists branch_id text;                       -- the branch the person works in
alter table app_users add column if not exists branch_ids text[] not null default '{}'; -- Branch Director: branches they run
create index if not exists app_users_branch_idx on app_users(branch_id);


-- ##################################################################### 20261012020000_sales_incentive_report.sql

-- =====================================================================================================================
-- Rexera CRM · Sales incentive report, calculated inside Supabase
--  - Same rules as the app (src/lib/payroll.ts → salesIncentive): collections are payment amounts before GST, credited
--    to the CRM entry's sales owner (bookings.created_by), using the latest incentive_rule_versions row.
--      daily   : rules.dailyPct % of every day with collections ≥ rules.dailyThreshold
--      weekly  : rules.weeklyPct % of every Monday–Sunday week ≥ rules.weeklyThreshold
--      monthly : slab % of the month's collections once they reach salary × rules.monthlyMultiple
--      nothing automatic is paid below salary × rules.eligibilityMultiple (or when no salary is set)
--  - Also returns what the incentive is based on: deals closed, quoted value, collections with GST, the daily and weekly
--    breakdown, and incentives HR added by hand (manual_incentives).
--  - Deal date = bookings.booking_date, else the old CRM's payment_date (imported files), else the day it was created (IST).
--  - security invoker: row-level security still applies, so only the server (secret key) gets rows.
--  - Safe to run more than once.
-- =====================================================================================================================

create or replace function public.sales_incentive_report(p_month text)
returns table (
  user_id text, name text, email text, role text, salary numeric,
  deals_closed int, quoted numeric, payments int, collected numeric, collected_with_gst numeric,
  eligible_at numeric, eligible boolean, monthly_at numeric,
  daily_incentive numeric, weekly_incentive numeric, monthly_pct numeric, monthly_incentive numeric,
  auto_incentive numeric, manual_incentive numeric, total_incentive numeric,
  days jsonb, weeks jsonb
)
language sql stable security invoker set search_path = public as $$
  with
  m as (
    select to_date(p_month || '-01', 'YYYY-MM-DD') as first_day,
           (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month')::date as next_month
  ),
  r as (
    select (rules->>'eligibilityMultiple')::numeric as elig_x, (rules->>'monthlyMultiple')::numeric as month_x,
           (rules->>'dailyThreshold')::numeric as day_at, (rules->>'dailyPct')::numeric as day_pct,
           (rules->>'weeklyThreshold')::numeric as week_at, (rules->>'weeklyPct')::numeric as week_pct,
           rules->'slabs' as slabs
    from incentive_rule_versions order by version desc limit 1
  ),
  pay as (                                   -- collections per owner per day
    select b.created_by as uid, p.paid_on as day, sum(p.amount) as amount, sum(p.total) as with_gst, count(*)::int as n
    from booking_payments p join bookings b on b.id = p.booking_id, m
    where b.created_by is not null and p.paid_on >= m.first_day and p.paid_on < m.next_month
    group by 1, 2
  ),
  daily as (
    select pay.uid, pay.day, pay.amount, case when pay.amount >= r.day_at then round(pay.amount * r.day_pct / 100, 2) else 0 end as incentive
    from pay, r
  ),
  weekly as (
    select w.uid, w.week, w.amount, case when w.amount >= r.week_at then round(w.amount * r.week_pct / 100, 2) else 0 end as incentive
    from (select uid, date_trunc('week', day)::date as week, sum(amount) as amount from pay group by 1, 2) w, r
  ),
  deals as (
    select b.created_by as uid, count(*)::int as n, sum(b.total_quoted) as quoted
    from bookings b, m
    where b.created_by is not null and b.status <> 'REJECTED'
      and coalesce(
            b.booking_date,
            case when b.legacy->'crm'->>'payment_date' ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$' then (b.legacy->'crm'->>'payment_date')::date end,
            (b.created_at at time zone 'Asia/Kolkata')::date
          ) >= m.first_day
      and coalesce(
            b.booking_date,
            case when b.legacy->'crm'->>'payment_date' ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$' then (b.legacy->'crm'->>'payment_date')::date end,
            (b.created_at at time zone 'Asia/Kolkata')::date
          ) < m.next_month
    group by 1
  ),
  manual as (
    select mi.user_id as uid, sum(mi.amount) as amount from manual_incentives mi where mi.month = p_month group by 1
  ),
  people as (                                -- active sales people and team leaders, plus anyone with deals or collections
    select u.id from app_users u
    where u.active and (u.role in ('sales', 'teamlead') or exists (select 1 from user_extra_roles x where x.user_id = u.id and x.role in ('sales', 'teamlead')))
    union select uid from pay union select uid from deals union select uid from manual
  ),
  totals as (
    select u.id, u.name, u.email::text as email, u.role::text as role, coalesce(u.salary, 0) as salary,
           coalesce(d.n, 0) as deals_closed, coalesce(d.quoted, 0) as quoted,
           coalesce((select sum(n) from pay where uid = u.id), 0)::int as payments,
           round(coalesce((select sum(amount) from pay where uid = u.id), 0), 2) as collected,
           round(coalesce((select sum(with_gst) from pay where uid = u.id), 0), 2) as collected_with_gst,
           coalesce((select sum(incentive) from daily where uid = u.id), 0) as daily_incentive,
           coalesce((select sum(incentive) from weekly where uid = u.id), 0) as weekly_incentive,
           coalesce(mn.amount, 0) as manual_incentive,
           coalesce((select jsonb_agg(jsonb_build_object('date', day, 'amount', amount, 'incentive', incentive) order by day) from daily where uid = u.id), '[]') as days,
           coalesce((select jsonb_agg(jsonb_build_object('week', week, 'amount', amount, 'incentive', incentive) order by week) from weekly where uid = u.id), '[]') as weeks
    from people p join app_users u on u.id = p.id
    left join deals d on d.uid = u.id
    left join manual mn on mn.uid = u.id
  ),
  scored as (
    select t.*, t.salary * r.elig_x as eligible_at, t.salary * r.month_x as monthly_at,
           (t.salary > 0 and t.collected >= t.salary * r.elig_x) as eligible,
           case when t.salary > 0 and t.collected >= t.salary * r.month_x then (
             select (s->>'pct')::numeric from jsonb_array_elements(r.slabs) with ordinality as e(s, i)
             where s->>'upTo' is null or t.collected < (s->>'upTo')::numeric order by i limit 1
           ) end as slab_pct
    from totals t, r
  )
  select id, name, email, role, salary,
         deals_closed, quoted, payments, collected, collected_with_gst,
         eligible_at, eligible, monthly_at,
         daily_incentive, weekly_incentive, coalesce(slab_pct, 0),
         round(collected * coalesce(slab_pct, 0) / 100, 2) as monthly_incentive,
         case when eligible then round(daily_incentive + weekly_incentive + round(collected * coalesce(slab_pct, 0) / 100, 2), 2) else 0 end as auto_incentive,
         manual_incentive,
         case when eligible then round(daily_incentive + weekly_incentive + round(collected * coalesce(slab_pct, 0) / 100, 2), 2) else 0 end + manual_incentive as total_incentive,
         days, weeks
  from scored
  order by collected desc, deals_closed desc, name
$$;

-- only the server calls this (with the secret key); never the browser
revoke all on function public.sales_incentive_report(text) from public, anon, authenticated;
grant execute on function public.sales_incentive_report(text) to service_role;


-- ##################################################################### 20261012030000_sales_targets.sql

-- =====================================================================================================================
-- Rexera CRM · Monthly sales targets per person and team (the team scorecards: Team A, BRD, Team Y …)
--  - One row per person per month. user_id links to the CRM user; people not in the CRM yet keep their name only.
--  - reported_collection is the collection the team's own scorecard shows, kept next to what the CRM records so the two
--    can be compared on Sales Incentives · Supabase.
--  - Only the server (secret key) reads or writes it: row-level security is on and there are no policies.
--  - Safe to run more than once.
-- =====================================================================================================================

create table if not exists sales_targets (
  month                char(7) not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  name                 text not null check (length(trim(name)) >= 2),
  team                 text not null,
  user_id              text references app_users(id) on delete set null,
  target               numeric(14,2) not null check (target >= 0),
  reported_collection  numeric(14,2),
  scorecard_rank       int,
  source               text not null default '',
  updated_at           timestamptz not null default now(),
  primary key (month, name)
);
create index if not exists sales_targets_user_idx on sales_targets(user_id, month);
alter table sales_targets enable row level security;


-- ##################################################################### 20261012040000_incentive_split_rule.sql

-- =====================================================================================================================
-- Rexera CRM · Sales incentive report: collections credited the way the old CRM's scorecards do (user_collections.php)
--  - Every payment part counts on the day it was received, before GST (dateless payments and rounding adjustments don't).
--  - Credit goes to the person who submitted the CRM entry and the person who closed the lead: 50% each when they are
--    different people, 100% when it is the same person. Old-CRM entries use their original submitted_by /
--    lead_closed_by_email; entries made in this app use created_by / closed_by.
--  - Deals closed use the same split (½ a deal each when two people share it), by booking date.
--  - Daily / weekly / monthly incentive rules are unchanged (latest incentive_rule_versions row).
--  - security invoker: row-level security still applies, so only the server (secret key) gets rows.
--  - Safe to run more than once. Replaces 20261012020000_sales_incentive_report.sql (deals_closed is now numeric).
-- =====================================================================================================================

drop function if exists public.sales_incentive_report(text);

create function public.sales_incentive_report(p_month text)
returns table (
  user_id text, name text, email text, role text, salary numeric,
  deals_closed numeric, quoted numeric, payments int, collected numeric, collected_with_gst numeric, shared_collected numeric,
  eligible_at numeric, eligible boolean, monthly_at numeric,
  daily_incentive numeric, weekly_incentive numeric, monthly_pct numeric, monthly_incentive numeric,
  auto_incentive numeric, manual_incentive numeric, total_incentive numeric,
  days jsonb, weeks jsonb
)
language sql stable security invoker set search_path = public as $$
  with
  m as (
    select to_date(p_month || '-01', 'YYYY-MM-DD') as first_day,
           (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month')::date as next_month
  ),
  r as (
    select (rules->>'eligibilityMultiple')::numeric as elig_x, (rules->>'monthlyMultiple')::numeric as month_x,
           (rules->>'dailyThreshold')::numeric as day_at, (rules->>'dailyPct')::numeric as day_pct,
           (rules->>'weeklyThreshold')::numeric as week_at, (rules->>'weeklyPct')::numeric as week_pct,
           rules->'slabs' as slabs
    from incentive_rule_versions order by version desc limit 1
  ),
  people_of as (                             -- submitter and lead closer of every CRM entry
    select b.id as booking_id, b.total_quoted,
           coalesce(
             (select u.id from app_users u where b.legacy->'crm'->>'submitted_by' ~ '^\d+$' and u.legacy_id = (b.legacy->'crm'->>'submitted_by')::int),
             b.created_by) as submitter,
           coalesce(
             (select u.id from app_users u where nullif(trim(b.legacy->'crm'->>'lead_closed_by_email'), '') is not null
                and lower(u.email::text) = lower(trim(b.legacy->'crm'->>'lead_closed_by_email')) limit 1),
             b.closed_by,
             (select u.id from app_users u where b.legacy->'crm'->>'submitted_by' ~ '^\d+$' and u.legacy_id = (b.legacy->'crm'->>'submitted_by')::int),
             b.created_by) as closer,
           coalesce(
             b.booking_date,
             case when b.legacy->'crm'->>'payment_date' ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$' then (b.legacy->'crm'->>'payment_date')::date end,
             (b.created_at at time zone 'Asia/Kolkata')::date) as deal_day,
           b.status
    from bookings b
  ),
  credit as (                                -- who gets which share of an entry
    select booking_id, submitter as uid, case when closer is null or closer = submitter then 1.0 else 0.5 end as share, total_quoted, deal_day, status from people_of where submitter is not null
    union all
    select booking_id, closer, 0.5, total_quoted, deal_day, status from people_of where closer is not null and submitter is not null and closer <> submitter
    union all
    select booking_id, closer, 1.0, total_quoted, deal_day, status from people_of where submitter is null and closer is not null
  ),
  pay as (                                   -- credited collections per person per day
    select c.uid, p.paid_on as day,
           sum(round(p.amount * c.share, 2)) as amount, sum(round(p.total * c.share, 2)) as with_gst,
           sum(case when c.share < 1 then round(p.amount * c.share, 2) else 0 end) as shared,
           count(*)::int as n
    from booking_payments p join credit c on c.booking_id = p.booking_id, m
    where p.paid_on >= m.first_day and p.paid_on < m.next_month and p.amount > 0 and not p.is_adjustment and not p.date_unknown
    group by 1, 2
  ),
  daily as (
    select pay.uid, pay.day, pay.amount, case when pay.amount >= r.day_at then round(pay.amount * r.day_pct / 100, 2) else 0 end as incentive
    from pay, r
  ),
  weekly as (
    select w.uid, w.week, w.amount, case when w.amount >= r.week_at then round(w.amount * r.week_pct / 100, 2) else 0 end as incentive
    from (select uid, date_trunc('week', day)::date as week, sum(amount) as amount from pay group by 1, 2) w, r
  ),
  deals as (
    select c.uid, sum(c.share) as n, sum(round(c.total_quoted * c.share, 2)) as quoted
    from credit c, m
    where c.status <> 'REJECTED' and c.deal_day >= m.first_day and c.deal_day < m.next_month
    group by 1
  ),
  manual as (
    select mi.user_id as uid, sum(mi.amount) as amount from manual_incentives mi where mi.month = p_month group by 1
  ),
  people as (
    select u.id from app_users u
    where u.active and (u.role in ('sales', 'teamlead') or exists (select 1 from user_extra_roles x where x.user_id = u.id and x.role in ('sales', 'teamlead')))
    union select uid from pay union select uid from deals union select uid from manual
  ),
  totals as (
    select u.id, u.name, u.email::text as email, u.role::text as role, coalesce(u.salary, 0) as salary,
           coalesce(d.n, 0) as deals_closed, coalesce(d.quoted, 0) as quoted,
           coalesce((select sum(n) from pay where uid = u.id), 0)::int as payments,
           round(coalesce((select sum(amount) from pay where uid = u.id), 0), 2) as collected,
           round(coalesce((select sum(with_gst) from pay where uid = u.id), 0), 2) as collected_with_gst,
           round(coalesce((select sum(shared) from pay where uid = u.id), 0), 2) as shared_collected,
           coalesce((select sum(incentive) from daily where uid = u.id), 0) as daily_incentive,
           coalesce((select sum(incentive) from weekly where uid = u.id), 0) as weekly_incentive,
           coalesce(mn.amount, 0) as manual_incentive,
           coalesce((select jsonb_agg(jsonb_build_object('date', day, 'amount', amount, 'incentive', incentive) order by day) from daily where uid = u.id), '[]') as days,
           coalesce((select jsonb_agg(jsonb_build_object('week', week, 'amount', amount, 'incentive', incentive) order by week) from weekly where uid = u.id), '[]') as weeks
    from people p join app_users u on u.id = p.id
    left join deals d on d.uid = u.id
    left join manual mn on mn.uid = u.id
  ),
  scored as (
    select t.*, t.salary * r.elig_x as eligible_at, t.salary * r.month_x as monthly_at,
           (t.salary > 0 and t.collected >= t.salary * r.elig_x) as eligible,
           case when t.salary > 0 and t.collected >= t.salary * r.month_x then (
             select (s->>'pct')::numeric from jsonb_array_elements(r.slabs) with ordinality as e(s, i)
             where s->>'upTo' is null or t.collected < (s->>'upTo')::numeric order by i limit 1
           ) end as slab_pct
    from totals t, r
  )
  select id, name, email, role, salary,
         deals_closed, quoted, payments, collected, collected_with_gst, shared_collected,
         eligible_at, eligible, monthly_at,
         daily_incentive, weekly_incentive, coalesce(slab_pct, 0),
         round(collected * coalesce(slab_pct, 0) / 100, 2) as monthly_incentive,
         case when eligible then round(daily_incentive + weekly_incentive + round(collected * coalesce(slab_pct, 0) / 100, 2), 2) else 0 end as auto_incentive,
         manual_incentive,
         case when eligible then round(daily_incentive + weekly_incentive + round(collected * coalesce(slab_pct, 0) / 100, 2), 2) else 0 end + manual_incentive as total_incentive,
         days, weeks
  from scored
  order by collected desc, deals_closed desc, name
$$;

revoke all on function public.sales_incentive_report(text) from public, anon, authenticated;
grant execute on function public.sales_incentive_report(text) to service_role;


-- ##################################################################### 20261013000000_sync_gaps.sql

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


-- ##################################################################### 20261014000000_cloud_sync.sql

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


-- ##################################################################### 20261015000000_file_storage.sql

-- =====================================================================================================
-- Uploaded files (payment proofs, client documents, leave attachments, resumes) in Supabase Storage, so everyone
-- signed in can open them from any computer. Used when VITE_DATA_BACKEND=supabase. Safe to re-run.
-- =====================================================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('crm-files', 'crm-files', false, 5242880, array[
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- staff (signed in) open and add files; only Super Admin / IT delete
drop policy if exists crm_files_read on storage.objects;
create policy crm_files_read on storage.objects for select to authenticated using (bucket_id = 'crm-files');
drop policy if exists crm_files_add on storage.objects;
create policy crm_files_add on storage.objects for insert to authenticated with check (bucket_id = 'crm-files');
drop policy if exists crm_files_remove on storage.objects;
create policy crm_files_remove on storage.objects for delete to authenticated using (bucket_id = 'crm-files' and (app.is_master() or owner_id = auth.uid()::text));
-- the public job application form (signed out) attaches a resume; it can add files, never read them
drop policy if exists crm_files_apply on storage.objects;
create policy crm_files_apply on storage.objects for insert to anon with check (bucket_id = 'crm-files' and name like 'file-%');


-- ##################################################################### 20261016000000_old_crm_files.sql

-- =====================================================================================================
-- Old-CRM uploads (supabase/upload-old-crm-files.mjs) include files over 5 MB and types such as PowerPoint, CSV or
-- HEIC photos. The bucket takes them; the CRM itself still limits new uploads to 5 MB (src/lib/files.ts). Safe to re-run.
-- =====================================================================================================
update storage.buckets set file_size_limit = 52428800, allowed_mime_types = null where id = 'crm-files';


-- ##################################################################### 20261017000000_leads_module.sql

-- =====================================================================================================
-- The old CRM's leads module in the new CRM:
--  * the 14 dispositions of the Blutec dialer / old CRM replace the 7 lead statuses and call outcomes
--    (Attempted → Not pickup, Interested → Hot prospect, Invalid → Wrong number, No answer → Not pickup)
--  * the fields of uploaded lead sheets, the hand-over chain (assigned / reassigned / forwarded), the activity log,
--    when the owner got the lead and first opened it
--  * upload batches (Super Admin → CRM Leads → Upload)
-- Status and outcome become text with a check, so the list can change without enum migrations. Safe to re-run.
-- =====================================================================================================

-- ---------------------------------------------------------------------------- dispositions
drop index if exists leads_follow_up_idx;   -- it named the old statuses
alter table leads alter column status drop default;
alter table leads alter column status type text using status::text;
update leads set status = case status when 'ATTEMPTED' then 'NOT_PICKUP' when 'INTERESTED' then 'HOT_PROSPECT' when 'INVALID' then 'WRONG_NUMBER' else status end;
alter table leads alter column status set default 'NEW';
alter table leads drop constraint if exists leads_status_check;
alter table leads add constraint leads_status_check check (status in (
  'NEW','ANSWER','INTRO','HOT_PROSPECT','CALL_BACK','NOT_PICKUP','BUSY','VOICE_MAIL','NOT_INTERESTED','WRONG_NUMBER','DND','LANGUAGE_ISSUE','SCRAP','CONVERTED'));
create index if not exists leads_open_follow_up_idx on leads(follow_up)
  where status in ('NEW','ANSWER','INTRO','HOT_PROSPECT','CALL_BACK','NOT_PICKUP','BUSY','VOICE_MAIL','LANGUAGE_ISSUE');

alter table lead_calls alter column outcome type text using outcome::text;
update lead_calls set outcome = case outcome when 'NO_ANSWER' then 'NOT_PICKUP' when 'INTERESTED' then 'HOT_PROSPECT' else outcome end;
alter table lead_calls drop constraint if exists lead_calls_outcome_check;
alter table lead_calls add constraint lead_calls_outcome_check check (outcome in (
  'ANSWER','INTRO','HOT_PROSPECT','CALL_BACK','NOT_PICKUP','BUSY','VOICE_MAIL','NOT_INTERESTED','WRONG_NUMBER','DND','LANGUAGE_ISSUE','SCRAP','CONVERTED'));

-- ---------------------------------------------------------------------------- upload batches
create table if not exists lead_uploads (
  id           text primary key default gen_random_uuid()::text,
  file_name    text not null,
  size_bytes   bigint not null default 0,
  total_rows   int not null default 0,
  imported     int not null default 0,
  uploaded_by  text references app_users(id) on delete set null,
  uploaded_at  timestamptz not null default now()
);
alter table lead_uploads enable row level security;
drop policy if exists lead_uploads_read on lead_uploads;
create policy lead_uploads_read on lead_uploads for select to authenticated using (app.has_role('superadmin') or app.has_perm('leads.manage'));
drop policy if exists lead_uploads_write on lead_uploads;
create policy lead_uploads_write on lead_uploads for all to authenticated using (app.has_role('superadmin')) with check (app.has_role('superadmin'));

-- ---------------------------------------------------------------------------- lead fields
alter table leads add column if not exists alt_phone text;
alter table leads add column if not exists location text;
alter table leads add column if not exists industry text;
alter table leads add column if not exists business_type text;
alter table leads add column if not exists turnover text;
alter table leads add column if not exists funding_amount text;
alter table leads add column if not exists funding_category text;
alter table leads add column if not exists requirement text;
alter table leads add column if not exists form_at timestamptz;
alter table leads add column if not exists extra jsonb;              -- the sheet's other columns, as they were
alter table leads add column if not exists upload_id text references lead_uploads(id) on delete set null;
alter table leads add column if not exists chain jsonb;              -- [{ to, by, at, kind: ASSIGNED|REASSIGNED|FORWARDED, note }]
alter table leads add column if not exists assigned_at timestamptz;  -- when the current owner got it
alter table leads add column if not exists seen_at timestamptz;      -- when they first opened it (empty = "new")
alter table leads add column if not exists history jsonb;            -- [{ at, by, action, note }] newest first
create index if not exists leads_upload_idx on leads(upload_id) where upload_id is not null;
-- "still New from before today" (overdue) and "pending 2 days" look these up
create index if not exists leads_new_assigned_idx on leads(assigned_to, assigned_at) where status = 'NEW';

-- live updates for the new table
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lead_uploads') then
    alter publication supabase_realtime add table public.lead_uploads;
  end if;
end $$;


-- ##################################################################### 20261018000000_lead_visibility.sql

-- A sales person sees only the leads given to them (by the Super Admin or a colleague) — not unassigned leads they
-- created. Same rule as visibleLeads() in the app. Safe to re-run.
create or replace function app.can_see_lead(l_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from leads l where l.id = l_id and (
      app.has_perm('leads.manage')
      or l.assigned_to = app.me()
      or (app.has_perm('leads.assign') and (l.assigned_to is null or exists (select 1 from app_users u where u.id = l.assigned_to and u.team_lead_id = app.me())))
    )
  )
$$;


-- ##################################################################### 20261019000000_blutec_webhooks.sql

-- =====================================================================================================
-- Blutec webhooks (server/blutecWebhook.mjs): every verified delivery is kept once — IVR "interested" leads and
-- dialer call events. The server writes them with the secret key; the Super Admin / IT read them on the Dialer page.
-- Safe to re-run.
-- =====================================================================================================
create table if not exists blutec_webhook_events (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('ivr', 'calls')),
  event        text not null,                 -- ivr.interested · call.initiated · call.completed · test events
  ref          text not null,                 -- what makes a delivery the same one (Blutec may send it twice)
  payload      jsonb not null,
  test         boolean not null default false,
  received_at  timestamptz not null default now(),
  unique (kind, event, ref)
);
create index if not exists blutec_webhook_events_recent_idx on blutec_webhook_events(received_at desc);
alter table blutec_webhook_events enable row level security;
drop policy if exists blutec_webhook_events_read on blutec_webhook_events;
create policy blutec_webhook_events_read on blutec_webhook_events for select to authenticated using (app.is_master());
-- no write policy: only the server (secret key) adds deliveries

-- ##################################################################### 20261020000000_sales_target_setters.sql
-- =====================================================================================================================
-- Rexera CRM · Who sets a sales person's monthly target (app_users.sales_target)
--  - HR / Super Admin / IT (employees.manage, access.manage): anyone, as before.
--  - Team Leader: the people in their own team. Branch Director: the people in the branches they run.
--  - Those two may change only sales_target on someone else's row, never their own. Safe to run more than once.
-- =====================================================================================================================

create or replace function app.can_set_target(target_branch text, target_team_lead text) returns boolean
language sql stable security definer set search_path = public as $$
  select (app.has_role('teamlead') and target_team_lead = app.me())
      or (app.has_role('branchdirector') and target_branch is not null and exists (
            select 1 from app_users d where d.id = app.me()
              and target_branch = any(case when cardinality(d.branch_ids) > 0 then d.branch_ids else array[d.branch_id] end)))
$$;

drop policy if exists users_target_update on app_users;
create policy users_target_update on app_users for update to authenticated
  using (id <> app.me() and app.can_set_target(branch_id, team_lead_id))
  with check (id <> app.me() and app.can_set_target(branch_id, team_lead_id));

create or replace function app.guard_user_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if app.me() is null then return new; end if;
  if not (app.has_perm('access.manage') or app.has_perm('employees.manage')) then
    if old.id <> app.me() then
      -- a Team Leader / Branch Director setting a target: nothing else on the row may change
      if (to_jsonb(new) - 'sales_target' - 'updated_at') is distinct from (to_jsonb(old) - 'sales_target' - 'updated_at')
         or not app.can_set_target(old.branch_id, old.team_lead_id) then
        raise exception 'Team leaders and branch directors can only set the monthly target of their own people.';
      end if;
    elsif (new.role, new.active, new.salary, new.sales_target, new.team_lead_id, new.auth_user_id, new.username, new.email, new.exit_on)
       is distinct from (old.role, old.active, old.salary, old.sales_target, old.team_lead_id, old.auth_user_id, old.username, old.email, old.exit_on) then
      raise exception 'Only HR or access managers can change role, access, salary or sign-in details.';
    end if;
  end if;
  if old.id = app.me() and (new.role, new.active) is distinct from (old.role, old.active) then
    raise exception 'You cannot change your own role or deactivate yourself.';
  end if;
  if (old.role = 'superadmin' or new.role = 'superadmin') and not app.has_role('superadmin') then
    raise exception 'Only a Super Admin can change Super Admin accounts.';
  end if;
  return new;
end $$;

-- ##################################################################### 20261021000000_crm_requests.sql

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

-- ##################################################################### 20261021010000_payments_accounts_only.sql
-- =====================================================================================================================
-- Rexera CRM · Part payments 2, 3, 4 … are added only by Accounts (a CRM entry is made with part 1, the advance).
-- Safe to run more than once.
-- =====================================================================================================================
drop policy if exists b_payments_later_parts on booking_payments;
create policy b_payments_later_parts on booking_payments as restrictive for insert to authenticated
  with check (part = 1 or app.has_perm('bookings.accounts'));

-- ##################################################################### 20261022000000_workflow_automation.sql
-- =====================================================================================================
-- Rexera CRM · workflow automation (Legal → Operations → Admin). Safe to run more than once.
--  * CRM entries: "Changes required" status; client welcome message, 15-day follow-up and Admin checklist state.
--  * Schemes: price, start / end date (expiry alert the day before).
--  * reminder_log: every scheduled reminder is recorded once (the server job's duplicate guard).
--  * Document Form Builder: doc_forms + doc_form_submissions (clients reach them only through the server).
--  * Permissions: workflow.manage, followup.manage (Admin), forms.manage (Admin, Operation team).
--  * Admin may save Workflow settings (app_settings key 'workflow').
--  * Status changes on CRM entries are checked in the database too (who may move a file from which status to which).
-- =====================================================================================================

alter type booking_status add value if not exists 'CHANGES_REQUIRED' after 'PENDING_LEGAL';

-- ---------------------------------------------------------------------------- CRM entries
alter table bookings add column if not exists welcome jsonb;      -- { email: Delivery, whatsapp: Delivery, createdAt, createdBy }
alter table bookings add column if not exists follow_up jsonb;    -- { everyDays, startedOn, nextOn, lastOn, paused, log[] }
alter table bookings add column if not exists admin_work jsonb;   -- { PRECHECK|FINANCE|DPR|CERTIFICATION|SUBMISSION: { status, assignee, due, history[], … } }

-- ---------------------------------------------------------------------------- schemes
alter table schemes add column if not exists price numeric(12,2);
alter table schemes add column if not exists start_date date;
alter table schemes add column if not exists end_date date;
alter table schemes add column if not exists updated_at timestamptz;
alter table schemes add column if not exists updated_by text references app_users(id) on delete set null;
alter table schemes drop constraint if exists schemes_dates_check;
alter table schemes drop constraint if exists schemes_price_check;
alter table schemes add constraint schemes_price_check check (price is null or price >= 0);
alter table schemes drop constraint if exists schemes_end_after_start;
alter table schemes add constraint schemes_end_after_start check (start_date is null or end_date is null or end_date >= start_date);
create index if not exists schemes_end_idx on schemes(end_date) where active;

-- ---------------------------------------------------------------------------- reminders sent (server job)
create table if not exists reminder_log (
  key        text primary key,              -- e.g. followup:<file>:<date> — the same reminder can't be taken twice
  kind       text not null,                 -- FOLLOW_UP | PRECHECK | SCHEME_EXPIRY
  ref_id     text not null,
  recipients text[] not null default '{}',
  sent_at    timestamptz not null default now()
);
create index if not exists reminder_log_kind_idx on reminder_log(kind, sent_at desc);
alter table reminder_log enable row level security;
drop policy if exists reminder_log_read on reminder_log;
create policy reminder_log_read on reminder_log for select to authenticated using (app.is_master() or app.has_perm('workflow.manage'));
-- written only by the server (secret key)

-- ---------------------------------------------------------------------------- Document Form Builder
create table if not exists doc_forms (
  id             text primary key,
  token          text not null unique,      -- secret part of the client link (/f/<token>)
  name           text not null,
  description    text not null default '',
  instructions   text not null default '',
  kind           text not null default 'ONLINE' check (kind in ('ONLINE', 'UPLOAD')),
  fields         jsonb not null default '[]',
  version        int not null default 1 check (version >= 1),
  versions       jsonb not null default '[]',
  status         text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED')),
  booking_id     text references bookings(id) on delete set null,
  expires_on     date,
  verify         text not null default 'NONE' check (verify in ('NONE', 'MOBILE')),
  document       jsonb,                     -- FileRef in the private crm-files bucket
  created_by     text references app_users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     text references app_users(id) on delete set null,
  views          int not null default 0,
  last_viewed_at timestamptz
);
create index if not exists doc_forms_booking_idx on doc_forms(booking_id);
create table if not exists doc_form_submissions (
  id           text primary key,
  form_id      text not null references doc_forms(id) on delete cascade,
  form_version int not null,
  booking_id   text references bookings(id) on delete set null,
  fields       jsonb not null default '[]',  -- the fields as the client saw them
  answers      jsonb not null default '{}',
  files        jsonb not null default '[]',  -- [{ fieldId, file: FileRef }]
  submitted_at timestamptz not null default now(),
  status       text not null default 'NEW' check (status in ('NEW', 'REVIEWED', 'ACCEPTED', 'REJECTED')),
  reviewed_by  text references app_users(id) on delete set null,
  reviewed_at  timestamptz,
  note         text
);
create index if not exists doc_form_submissions_form_idx on doc_form_submissions(form_id, submitted_at desc);
alter table doc_forms enable row level security;
alter table doc_form_submissions enable row level security;
-- staff with the Form Builder only; clients never touch these tables (the server reads / writes them with the secret key)
drop policy if exists doc_forms_manage on doc_forms;
create policy doc_forms_manage on doc_forms for all to authenticated using (app.has_perm('forms.manage')) with check (app.has_perm('forms.manage'));
drop policy if exists doc_form_submissions_read on doc_form_submissions;
create policy doc_form_submissions_read on doc_form_submissions for select to authenticated using (app.has_perm('forms.manage'));
drop policy if exists doc_form_submissions_review on doc_form_submissions;
create policy doc_form_submissions_review on doc_form_submissions for update to authenticated using (app.has_perm('forms.manage')) with check (app.has_perm('forms.manage'));
drop policy if exists doc_form_submissions_delete on doc_form_submissions;
create policy doc_form_submissions_delete on doc_form_submissions for delete to authenticated using (app.is_master());

-- ---------------------------------------------------------------------------- permissions
insert into role_permissions (role, permission) values
  ('admin', 'workflow.manage'), ('admin', 'followup.manage'), ('admin', 'forms.manage'), ('operations', 'forms.manage')
on conflict do nothing;

-- ---------------------------------------------------------------------------- Admin saves Workflow settings
drop policy if exists settings_write on app_settings;
create policy settings_write on app_settings for all to authenticated
  using (app.is_master() or (key in ('pf', 'breaks') and app.has_role('hr')) or (key = 'counters' and app.me() is not null) or (key = 'workflow' and app.has_perm('workflow.manage')))
  with check (app.is_master() or (key in ('pf', 'breaks') and app.has_role('hr')) or (key = 'counters' and app.me() is not null) or (key = 'workflow' and app.has_perm('workflow.manage')));

-- ---------------------------------------------------------------------------- status changes (same rules as the app)
-- The app only offers the allowed actions; this keeps the same rules for anyone writing to the table directly.
-- The server (secret key), the SQL editor and Super Admin / IT are not limited.
create or replace function app.booking_status_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me   text := app.me();
  step text := old.status::text || '>' || new.status::text;
  ok   boolean;
begin
  if new.status = old.status or auth.uid() is null or app.is_master() then return new; end if;
  ok := case
    when step in ('PENDING_TL>PENDING_ACCOUNTS', 'PENDING_TL>REJECTED')
      then app.has_perm('bookings.approve_tl') and old.team_lead_id = me
    when step in ('PENDING_ACCOUNTS>PENDING_LEGAL', 'PENDING_ACCOUNTS>ACCOUNTS_HOLD', 'PENDING_ACCOUNTS>REJECTED', 'ACCOUNTS_HOLD>PENDING_LEGAL', 'ACCOUNTS_HOLD>REJECTED')
      then app.has_perm('bookings.accounts')
    when step in ('PENDING_LEGAL>IN_OPERATIONS', 'PENDING_LEGAL>CHANGES_REQUIRED', 'PENDING_LEGAL>REJECTED')
      then app.has_perm('bookings.legal')
    when step in ('CHANGES_REQUIRED>PENDING_LEGAL', 'REJECTED>PENDING_ACCOUNTS', 'REJECTED>PENDING_TL')
      then old.created_by = me
    when step in ('IN_OPERATIONS>WITH_ADMIN', 'IN_OPERATIONS>ON_HOLD', 'OPS_REVIEW>COMPLETED', 'OPS_REVIEW>WITH_ADMIN')
      then app.has_perm('bookings.process') and old.ops_member_id = me
    when step in ('WITH_ADMIN>OPS_REVIEW', 'WITH_ADMIN>ON_HOLD', 'WITH_ADMIN>IN_OPERATIONS')
      then app.has_perm('bookings.admin') and old.admin_id = me
    when step in ('ON_HOLD>IN_OPERATIONS', 'ON_HOLD>WITH_ADMIN')
      then (app.has_perm('bookings.process') and old.ops_member_id = me) or (app.has_perm('bookings.admin') and old.admin_id = me)
    when step = 'COMPLETED>IN_OPERATIONS'   -- re-opened by moving the stage back
      then app.has_perm('bookings.process') or app.has_perm('bookings.admin')
    else false
  end;
  if not coalesce(ok, false) then
    raise exception 'Moving this file from % to % is not allowed for you.', old.status, new.status using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists bookings_status_guard on bookings;
create trigger bookings_status_guard before update of status on bookings for each row execute function app.booking_status_guard();

-- ---------------------------------------------------------------------------- live updates
do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['doc_forms', 'doc_form_submissions'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ##################################################################### 20261023000000_invoice_shares.sql
-- =====================================================================================================
-- Rexera CRM · invoices sent to clients (email with the PDF attached, WhatsApp document via Interakt). Safe to run more than once.
--  * invoice_shares: one row per send, written only by the live server (secret key) with the provider's answer.
--  * Read by whoever can open the invoice.
-- =====================================================================================================
create table if not exists invoice_shares (
  id         text primary key,
  invoice_id text not null references invoices(id) on delete cascade,
  sent_at    timestamptz not null default now(),
  sent_by    text references app_users(id) on delete set null,
  channel    text not null check (channel in ('email', 'whatsapp')),
  to_addr    text not null default '',
  status     text not null check (status in ('SENT', 'FAILED', 'NOT_CONFIGURED', 'NO_CONTACT')),  -- SENT = accepted by the provider
  error      text,
  message_id text                                -- Interakt's message id
);
create index if not exists invoice_shares_invoice_idx on invoice_shares(invoice_id, sent_at desc);
alter table invoice_shares enable row level security;
drop policy if exists invoice_shares_read on invoice_shares;
-- the invoice's own read rule decides (the sub-select runs with the reader's row-level security)
create policy invoice_shares_read on invoice_shares for select to authenticated using (exists (select 1 from invoices i where i.id = invoice_id));
-- no insert / update / delete policy: only the server writes it

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'invoice_shares') then
    alter publication supabase_realtime add table public.invoice_shares;
  end if;
end $$;

-- ##################################################################### 20261024000000_sales_kit.sql
-- =====================================================================================================
-- Rexera CRM · Sales Kit (schemes, benefits, eligibility, last date, charges) — everyone reads it, only the Operation
-- team (and Super Admin / IT) edits it. Starts with the 55 schemes from Sales Kit.xlsx. Safe to run more than once.
-- =====================================================================================================
create table if not exists sales_kit (
  id                  text primary key,
  category            text not null,
  position            int not null default 0,
  name                text not null,
  benefits            text not null default '',
  sectors             text not null default '',
  eligibility         text not null default '',
  last_date           text not null default '',          -- a date or "Rolling basis"
  organisation        text not null default '',
  scheme_type         text not null default '',
  applicable_for      text not null default '',
  min_charge          text not null default '',
  registration_charge text,
  updated_at          timestamptz,
  updated_by          text references app_users(id) on delete set null
);
create index if not exists sales_kit_category_idx on sales_kit(category, position);
alter table sales_kit enable row level security;
drop policy if exists sales_kit_read on sales_kit;
create policy sales_kit_read on sales_kit for select to authenticated using (true);
drop policy if exists sales_kit_write on sales_kit;
create policy sales_kit_write on sales_kit for all to authenticated using (app.has_perm('saleskit.manage')) with check (app.has_perm('saleskit.manage'));

insert into role_permissions (role, permission) values ('operations', 'saleskit.manage') on conflict do nothing;

-- the list as given (rows already there are left as the team edited them)
insert into sales_kit (id, category, position, name, benefits, sectors, eligibility, last_date, organisation, scheme_type, applicable_for, min_charge, registration_charge) values
  ('sk-grant-01', 'Grant', 1, 'Global Impact Challenge', '>>Stage 1 (Pilot): Grant up to ₹1.5 Cr (USD 200K)
>>Stage 2 (Test & Scale Readiness): Grant up to ₹4.5 Cr (USD 500K)
>>Stage 3 (Scale): Grant up to ₹14 Cr (USD 1.5M)', 'Socially Impactful areas
● Agriculture/Food Security
● Democracy/Rights/Governance
● Economic Growth
● Education and Training
● Energy
● Environment
● Health
● Water Sanitation and Hygiene', 'Private Limited
LLP
Partnership
OPC
Public Limited
Proprietorship
Non-profits
Section 8, NGO
Foundation', 'Rolling basis', 'DIV Fund', 'International Organization', 'Pan India', 'INR 15,000 + 18% GST', null),
  ('sk-grant-02', 'Grant', 2, 'Fisheries Grant', 'Grant up to 10 Lakhs (Standard)
and Grant up to 50 Lakhs (Exceptional)', '● Agriculture/Food Security
● Democracy/Rights/Governance
● Economic Growth
● Education and Training
● Energy
● Environment
● Health
● Water Sanitation and Hygiene', 'Companies and private enterprises developing relevant products or technologies.
Academic and research institutions conducting applied research.
Government institutions working on relevant projects.
Non-governmental organisations (NGOs) and nonprofit organisations.
Individual innovators, researchers, and entrepreneurs.', '18 Nov 2026', 'Interventions to Improve the Welfare of Farmed Fishes', 'FWI', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grant-03', 'Grant', 3, 'Elevate Minority (KA)', 'Grant-in-aid of up to ₹50 lakh.', 'Information Technology and Digital Solutions
Artificial Intelligence and Emerging Technologies
Healthcare and Lifesciences
AgriTech and FoodTech
Clean Energy and Sustainability
Electric Mobility and Transportation
Manufacturing and Industrial Innovation
Education and Social Impact Solutions
FinTech and Business Technology', 'Startups incorporated in Karnataka as a Private Limited Company, One Person Company (OPC), Registered Partnership Firm, LLP or eligible Cooperative Society.
Startups incorporated within the last 10 years.
Startups with turnover not exceeding ₹200 crore in any financial year since incorporation.
At least 51% equity must be held by eligible minority-community director(s) or partner(s).
Applicants must not have received an ELEVATE grant in the previous three years.', '12 Nov 2026', 'Department of Electronics, IT & BT', 'Government of Karnataka', 'Karnataka', 'INR 15,000 + 18% GST', null),
  ('sk-grant-04', 'Grant', 4, 'Elevate Nxt (KA)', 'Grant-in-aid of up to ₹1 crore', 'Artificial Intelligence (AI), Machine Learning and Generative AI
Quantum Technologies
Semiconductors and Microelectronics
Robotics, IoT and Industrial Automation
Space, Aerospace and Defence
Cybersecurity and Secure Systems
Electric Mobility, Logistics and Transportation
Energy and Climate Technology
AgriTech and FoodTech
Healthcare, Biotechnology and Lifesciences
FinTech
Nanotechnology and Advanced Materials', 'Startups registered as a Private Limited Company, Registered Partnership Firm, LLP or eligible Cooperative Society.
Startups incorporated within the last 20 years.
Startups with turnover not exceeding ₹300 crore in any financial year since incorporation.
Startups developing DeepTech innovations with a Technology Readiness Level (TRL) between 3 and 8.
Startups registered outside Karnataka must shift their registered office to Karnataka within four months of the result announcement if selected.', '12 Nov 2026', 'Department of Electronics, IT & BT', '', 'Karnataka', 'INR 15,000 + 18% GST', null),
  ('sk-grant-05', 'Grant', 5, 'CSR Grant for Health Tech Startups', 'Grant up to 8 Lakhs', 'Digital health
Artificial intelligence in healthcare
Health information systems
Healthcare monitoring solutions
ICT-enabled healthcare innovations', 'Early-stage startups working in the health technology sector.
Indian startups registered with the DPIIT.
Startups developing innovative healthcare solutions with an ICT component.', '30 Oct 2026', '', '', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grant-06', 'Grant', 6, 'Elevate North-East 2.0', 'Non Refundable Grant up to ₹ 80 Lakh', 'All Sectors', '· Private Limited Company / OPC
· LLP
· Partnership
· Proprietorship

Companies from North Eastern states as well as all India can apply but their product or service should have impact on North-East India (Arunachal Pradesh, Assam, Manipur, Meghalaya, Mizoram, Nagaland and Tripura).', '14 Nov 2026', 'AIC SMU', 'Government authorised incubator', 'North Eastern States and Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grant-07', 'Grant', 7, 'Grand Startup Challenge - 2026', 'Up to INR 1 Cr total', 'Lending & Fintech
Mobility & Road Safety
Supply Chain
Sovereign AI', 'Early-stage startups incorporated in India, as a private limited company or an LLP, with at least one founder working on it full-time.
If you have raised more than ₹50 crore in funding, the challenge is not for you.', '09 Nov 2026', 'DPIIT and Meity Hub', 'Startup India Challenge', 'pan India', 'INR 5,000 + 18% GST', null),
  ('sk-grant-08', 'Grant', 8, 'Funding Support (UP)', 'Seed Capital Assistance: Up to ₹15 lakh; up to ₹50 lakh in special cases
Sustenance Allowance: ₹20,000/month for up to 2 years
Prototype Grant: Up to ₹10 lakh
Matching Grant: 50% of eligible funds raised, up to ₹5 crore
Additional support may be available for certain eligible categories and deep-tech startups', 'All sectors', 'DPIIT registered Uttar Pradesh based

Private Limited
LLP
Registered Partnership', 'Rolling basis', 'Govt of Uttar Pradesh', 'Government Scheme', 'Uttar Pradesh', 'INR 10,000 + 18% GST', null),
  ('sk-grant-09', 'Grant', 9, 'Agri-Tech Innovation Grant', '>Maximum Grant Amount: ₹7,50,000
>Funding Type: Non-repayable grant (subject to compliance)
>Disbursement: Milestone-based installments', 'A. Advanced Farming Technologies
B. Agri Product Innovation
C. Cold Storage & Infrastructure
D. Digital Agriculture (Software & Applications)
E. Supply Chain & Delivery Innovation', '>Individual farmers and farmer groups
>Farmer Producer Organizations (FPOs)
>Agri-startups and innovators
>Proprietorships, partnerships, and registered companies
>Technology developers working in agriculture', 'Rolling basis', 'Vibrant India Innovation Hub', 'Government Sponsored Scheme', 'Pan India', 'INR 20,000 + 18% GST', null),
  ('sk-grant-10', 'Grant', 10, 'RKVY RAFTAAR', '1) Idea stage (grant support up to Rs. 5.00 Lakh)
2) Seed Stage (grant support up to Rs. 25.00 Lakh)', 'AgriTech
Animal Husbandry
Dairy and Food Technology
Agri Waste Management
Agri Biotech
Natural Resource Management', '1.Registered Partnership, LLP, Pvt. Ltd, OPC, Sole Proprietorship and Individual
2.Start-ups with at least Minimum Viable Product (MVP).
3.A startup supported once will not be eligible for applying for the subsequent round of seed support.
4. One month of incubation is compulsory after selection.', 'Rolling basis', 'Ministry of Agriculture and Farmers'' Welfare, Govt of India', 'Government Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grant-11', 'Grant', 11, 'GUJARAT GRANT', '> Grant support: Up to ₹30 lakh
> Assistance to Startups: Up to ₹10 lakh
> Sustenance allowance: ₹20,000/month for one year (₹25,000 for women)
> Skill development: Up to ₹1 lakh
> Acceleration program assistance: Up to ₹3 lakh
> Pre-Series A Funding: ₹50 lakh to ₹3 crore
> Interest Subsidy: 1% to 9% interest subsidy, on term loans', 'All Sector', 'LLP, Pvt Ltd, & Partnership can apply
This scheme is applicable to Gujarat State only
The applicant does not own more than 10% in any other company.', 'Rolling basis', 'GUIITAR Council', 'Government Authorized Incubator Scheme', 'Gujarat Only', 'INR 30,000 + 18% GST', null),
  ('sk-grant-12', 'Grant', 12, 'Srujan Scheme (Guj)', '> Grant of 2.5 to 10 Lakhs', 'All Sector', 'Any innovator or startup founder age under 35 years who is:

1) Any Gujarati student Middle/Secondary (up to Class 12), Diploma, Vocational, Undergraduate, Postgraduate, or Doctoral programs, as well as any dropout from a Gujarati school, institution, or university
2) Only Gujarat-based startups can apply', 'Rolling basis', 'I hub', 'Government Authorized Incubator Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grant-13', 'Grant', 13, 'Young Innovators Grant', '> Up To INR 20 Lakh Grant', 'Sector-agnostic (all sectors) funding to foster diverse and innovative ideas.', 'Person, who’s aged up to 25 years or under from across India,', 'Rolling basis', 'Zerodha', 'Private Investor scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grant-14', 'Grant', 14, 'NIDHI Prayas', '> Non Refundable grant support up to Rs. 10 Lakh', 'Healthcare
Manufacturing
Agriculture
Energy
IoT
Cleantech
Other Technology Areas', 'An early stage businesses are eligible in NIDHI PRAYAS (Individual, Proprietorship, LLP, Pvt Ltd, Registered Partnership)
The startup should not be more than 7 years of existence.
The startup should not have annual turnover exceeding Rs. 25 lakhs for any of the financial years since its inception.', 'Rolling basis', 'Department of Science & Technology', 'Government Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grant-15', 'Grant', 15, 'Innovation Grant (KL)', '1. Idea Grant: Grant of upto INR 3 lakhs.
2. Productization Grant: Grant of upto INR 7 lakhs
3. Market Acceleration Grant: Grant of upto INR 10 lakhs
4. Scale-up Grant: Grant of upto INR 15 lakhs
5. R&D Grant: Grant of INR 30 lakhs
6. Idea Grant (Student Innovator): Grant of upto INR 2 lakhs
7. Women/Transgender Productization Grant: Grant of upto INR 12 lakhs.', 'All Sector', '1) PVT LTD/LLP/OPC can apply for productization, Market Acceleration, Scale-up and Women/ Transgender Productization and R&D Grant
2) Individuals have unique Idea can apply for Idea Grant
3) Only Kerala based startups can apply
4) For Idea, Productization, Market Acceleration, Scale-up and Women/Transgender Productization Gran: KSUM unique ID certificate is compulsory
5) For R&D Grant: KSUM unique ID and DIPP certificate are compulsory', 'Rolling basis', 'Govt of Kerala, Kerala Technology Startup Policy', 'Government Scheme', 'Kerala State Only', 'INR 25,000 + 18% GST', null),
  ('sk-grant-16', 'Grant', 16, 'NGO Kickstarter', 'Grant support of up to ₹15 Lakh', 'The focus depends on the selected city:

Ahmedabad: Urban Livelihoods, Rural Livelihoods
Bengaluru: Urban Livelihoods, Disability/Special Needs, Waste Management
Delhi NCR: Urban Livelihoods
Hyderabad: Urban Livelihoods, Rural Livelihoods, Healthcare, Disability/Special Needs, Waste Management
Kolkata: Urban Livelihoods, Rural Livelihoods, Disability/Special Needs
Mumbai: Urban Livelihoods, Healthcare, Disability/Special Needs, Waste Management
Pune: Urban Livelihoods, Rural Livelihoods, Healthcare, Disability/Special Needs
Chennai: Urban Livelihoods, Rural Livelihoods, Healthcare, Disability/Special Needs .', 'Eligible NGOs that:

Have a valid 12A and 80G certificate.
Have been operating for at least 3 years.
Have projects based in one of the supported chapter cities.
Work within the focus areas of the selected city', 'Rolling basis', 'SVP India', 'National Level Organization', 'Selected areas as per focus sector', 'INR 10,000 + 18% GST', null),
  ('sk-grant-17', 'Grant', 17, 'Tide 2.0', 'Grant of up to INR 7 Lakh.', 'ICT, Agri-Tech/Food-Tech, Social Impact
, Health-Tech, Green Energy Fintech Women-Led, EV, Clean-Teach, Infrastructure & Transportation, SaaS', 'Pvt. Ltd, LLP, Reg Partnership and Sole Proprietorship
Startup at Revenue Stage or Market Ready Stage
Registered as a legal entity at the time of application', 'Rolling basis', 'TIDE 2.0', 'Government Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grant-18', 'Grant', 18, 'Growth Grant', '> Non- refundable Grant up to ₹ 1.7 Cr [$200,000]', 'All Sectors', '1. Applicants must be aged 22 or younger at the time of application

2. Must not hold a university degree and should be ready to drop out or defer enrollment if selected

3. Should be working on a high-impact idea with early traction or a strong vision', 'Rolling basis', 'Thiel Foundation, California', 'International Organization', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grant-19', 'Grant', 19, 'Socialpreneur Grant', 'Grant up to ₹ 12.5 Lakh', 'Youth Employment Innovation
Future-Ready Skills Development
Entrepreneurship & Self-Employment
Rural Income Enhancement
Inclusive Economic Participation', 'Private Limited, LLP, Partnerships
Proprietorships
Section 8, Foundations
Non registered or team
Minimum 1 year of operations
Impact-first venture with potential to impact at least 3 UN Sustainable Development Goal', 'Rolling basis', 'NSRCEL, the startup hub at IIM Bangalore, in collaboration with Capgemini', 'Government Authorized Incubator and Private CSR based Fund', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grant-20', 'Grant', 20, 'IVP (TN)', '> Voucher A: Grant upto Rs. 3 lakhs for converting the Idea into a working Prototype

> Voucher B: Grant up to Rs. 7 lakh for commercialization support.', '1. Agriculture,
2. Environment,
3. Energy
4. Horticulture,
5. Veterinary,
6. Fisheries
7. Engineering,
8. Waste Management,
9. Health
10. Automobiles,
11. Nanotechnology,
12. Electronics,
13. Deep Technology
14. Etc', '1. Should be a manufacturing MSME.
2. Be registered and located in Tamil Nadu.
3. Willing to co finance the innovation investment as per IVP norms.
4. Should have a CIBIL score of 750 or more.', 'Rolling basis', 'Government of Tamil Nadu', 'Government Scheme', 'Pan India', 'INR 5,000 + 18% GST', null),
  ('sk-grantdebtequity-01', 'Grant + Debt + Equity', 1, 'Sprint Yojna', '1) Maximum funding support of up to INR 25 lakhs per startup (Grant/debt/equity, any)
2) Link to investment ventures and angel fund community
3) Support from Prototype to product launch
4) Partnership, Collaboration and Connects
5) Testbed and support in joint technology Development
6) Deployment of Market ready products
7) Support in exploring Global Market
8) Customized Training & Mentoring
9) Support in Tech commercialization
10) Technology enhancement for pre-launched Products', '> Agriculture Science / Agriculture Engineering
> Biotechnology / Life science/ Health tech/ Med tech
> Water Management, and Technology
> Interdisciplinary Cyber-Physical Systems
> IoT / Deep-tech / Hardware Tech / Tech Focused
> Sustainable Development Goals', '1. Recognized startups
2. Sole Proprietorship, Limited Liability Partnership (LLP), One Person Company (OPC), Private Limited (Pvt Ltd), Foreign Collaboration, Not Registered can apply
3. Granted patents and deep tech innovations are encouraged
4. Focus on Cyber-Physical Systems (CPS)
5. Women founders are highly encouraged to apply
6. Generating revenue are encouraged
7. Stages of Startup: Ideation, PoC / Prototype, Minimum Viable Product (MVP) and Commercialized
8. Already raised past investments will be edge over others', 'Rolling basis', 'IIT Ropar', 'Government Authorized Incubator Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grantdebtequity-02', 'Grant + Debt + Equity', 2, 'Pro-Fund Support', '> Funding support from ₹2 lakhs to ₹30 Lakhs, depending on eligibility.', '> All Sectors', '1. Any registered entity can apply, such as a Proprietorship, Partnership, LLP, Pvt Ltd
2. Individuals can also apply.', 'Rolling basis', 'i-Create', 'Government Authorized Incubator Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grantdebtequity-03', 'Grant + Debt + Equity', 3, 'Fund for Agri (MH)', 'Funding opportunities up to INR 1 Cr, as per the project/ask (grant/debt/equity, subject to the revenue meeting and to be decided by the evaluating committee)', 'Agri-Tech', 'Maharashtra based all Startups

Only Pvt Ltd, LLP and Not for Profit can apply', 'Rolling basis', 'MCCIA & Mr Ajinkya Rahane', 'Government Authorized NGO + Private Investor Scheme', 'Only Maharashtra based', 'INR 10,000 + 18% GST', null),
  ('sk-grantdebtequity-04', 'Grant + Debt + Equity', 4, 'Excel Your Venture', 'Financial Support Up to INR 42 Lakhs (USD 50,000) for every startup supported', 'Fintech
Livelihood, Job & Skilling', 'Registered businesses in India can app;y
Exceptional individuals starting off with promising ideas on financial inclusion are also welcome', 'Rolling basis', 'IIMA Venture', 'Government Authorized Incubator Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grantdebtequity-05', 'Grant + Debt + Equity', 5, 'BI Initiative Bharat Inclusion Initiative', 'Financial Support Up to INR 42 Lakhs (USD 50,000) for every startup supported', 'Fintech
Livelihood, Job & Skilling', 'Registered businesses in India can app;y
Exceptional individuals starting off with promising ideas on financial inclusion are also welcome', 'Rolling basis', 'IIMA Venture', 'Government Authorized Incubator Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-debtequity-01', 'Debt + Equity', 1, 'Defence Fund', 'USD $400,000 (Up to INR 3.6 Cr) in pre-seed/seed funding for each selected startup (equity or debt-equity-linked instruments).
Technical & Product Support & Global Market Insights & Access', 'Defence & aerospace
> Autonomy & Onboard Intelligence
> Secure Communications & Strategic Systems
Propulsion & In-space / Aerospace technologies
> Advanced Manufacturing
> High-performance & Advanced Materials', 'Early-Stage Innovators
Startups at the pre-seed or seed stage
For-profit entities: Proprietorship, Partnership, Pvt Ltd, LLP, Unregistered (they need to register)', 'Rolling basis', 'IIMA Venture & Jaivel Aerospace', 'Government Authorized Incubator Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-debtequity-02', 'Debt + Equity', 2, 'Titanium Fund', 'Funding support up to ₹50 Lakh
Mentorship from IIT Bombay faculty, industry experts and domain specialists
Access to advanced R&D infrastructure, labs and prototyping facilities
Industry connect, investor network and business development support
Support in technology validation, intellectual property and commercialisation', 'Advanced Materials
Electronics & Semiconductors
Advanced Manufacturing
Clean Energy & Sustainability
Biotechnology & Life Sciences
Al, Robotics & Emerging Tech', 'India-registered startup (Private Limited)
Technology in deep tech/science-based domain
Early-stage startups with strong technology IP
Clear plan for product development & commercialisation
Commitment from founding team to actively work on the venture
Other criteria as specified in the program guidelines', '30 Oct 2026', 'SINE,IIT Bombay', '', 'Pan India', 'INR 5,000 + 18% GST', null),
  ('sk-debtequity-03', 'Debt + Equity', 3, 'Climate Tech', '1) Funding support of up to INR 40 Lakh (Equity/Debt)

2) Mentoring by experts, market and investor connects', 'ClimateTech Solutions
Circular Economy Initiatives', 'Registered Partnerships
Limited Liability Partnership (LLP)
Private Limited (Pvt Ltd)', 'Rolling basis', 'IIM Venture Ahmedabad', 'Government Authorized Incubator Scheme', 'Pan India', 'INR 15,000 + 18% GST', null),
  ('sk-debtequity-04', 'Debt + Equity', 4, 'Start up Support Scheme SSS', '₹25 Lakh to ₹1 Crore
Please Note: It may be equity-linked instruments like equity/CCD/CCPS/Debt', 'Agriculture,
Healthcare,
Manufacturing,
Engineering,
IoT,
biotechnology,
Medical devices,
Water,
Waste management,
Energy,
Climate tech,
Fintech
etc.', '• Proprietorship/ Partnership/ LLP/ Pvt Ltd companies
• Must be at - Idea stage / PoC stage / Prototype stage / MVP stage/ Scaleup stage
• Must be incorporated within the last 10 years
• The idea must be related to technology and innovation.', 'Rolling basis', 'Department of Science & Technology', 'Government Scheme', 'Pan India', 'INR 20,000 + 18% GST', null),
  ('sk-debtequity-05', 'Debt + Equity', 5, 'Sustainability Sprint', '1) Funding support of up to INR 40 Lakh (Equity/Debt)

2) Mentoring by experts, market and investor connects', 'ClimateTech Solutions
Circular Economy Initiatives', 'Registered Partnerships
Limited Liability Partnership (LLP)
Private Limited (Pvt Ltd)', 'Rolling basis', 'IIM Venture Ahmedabad', 'Government Authorized Incubator Scheme', 'Pan India', 'INR 15,000 + 18% GST', null),
  ('sk-equity-01', 'Equity', 1, 'Evolve-Tech Funding', 'Funding up to ₹ 30 Lakh in exchange of 5% of Equity.', 'All sectors', 'DPIIT Recognized Startups (Reg Partnership, LLP, OPC, Pvt Ltd)

Tech-enabled startup seeking private funding

Revenue generating startups (compulsory)', 'Rolling basis', 'WeFounderCircle', 'Private Investor Scheme', 'Pan India', 'INR 20,000 + 18% GST', null),
  ('sk-equity-02', 'Equity', 2, 'Velocity Fund', 'Investment support of up to ₹ 9 Cr', 'Technology startups
Scalable digital solutions
Innovation-driven ventures
AI and emerging technologies
Global high-growth startups', 'Private Limited
LLP
Partnership
Limited Company', 'Rolling basis', 'a16z and Speedrun investors', 'Private Investor Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-equity-03', 'Equity', 3, 'Venture Fund for Defence & Aerospace', 'Equity based funding as per project cost (Max up to ₹50 Cr)', '> Defence
> Aerospace', '• Private Limited Companies
• Public Limited Companies
• The company shall fall in the definition of Start-up as defined by Start-up initiative of Govt. of India or MSME as per the Ministry of MSME/Micro, Small and Medium Enterprises Development Act, 2006.
• The entrepreneur and all operations of the business should be domiciled in the state of Maharashtra.', 'Rolling basis', 'Maharashtra Industrial Development Corporation and IDBI Trusteeship Services Limited', 'CSR involved program', 'Maharashtra', 'INR 10,000 + 18% GST', null),
  ('sk-equity-04', 'Equity', 4, 'Agri-Sure Fund', 'Equity based fund upto a maximum of up to ₹25 crore in one Start-up, subject to AIF (Alternative Investment Funds) Regulations.', '1. Agritech,
2. Food Processing,
3. Animal Husbandry,
4. Fisheries,
Other Agri and related areas', 'Start-ups recognized by DPIIT and incorporated in India.', 'Rolling basis', 'Ministry of Agri and Farmer Welfare & NABARD', 'Govt Scheme', 'Pan India', 'INR 20,000 + 18% GST', null),
  ('sk-equity-05', 'Equity', 5, 'Fintech Bridge', 'Investment up to $1 Million USD (upto ₹ 8 Cr)', 'Fintech', 'Registered as a Private Limited with a DPIIT Certificate

Revenue Generating Startups', 'Rolling basis', 'AIC RNTU', 'Government Authorized Incubator Scheme', 'Pan India', 'INR 15,000 + 18% GST', null),
  ('sk-equity-06', 'Equity', 6, 'Equity Elevator', 'Financial Benefits: Equity-based investment up to ₹ 4 Cr (USD 5,00,000)
Mentoring & Networking Support
In person guidance from experts at San Francisco', 'All Sectors', 'All registered entities / Solo entrepreneurs', 'Rolling basis', 'Y Combinator', 'Private Investor Scheme', 'World Wide', 'INR 20,000 + 18% GST', null),
  ('sk-equity-07', 'Equity', 7, 'Genesis Pilot 2.0', 'Funding up to ₹40 Lakhs', 'Electronic design and manufacturing
Deeptech (AI, IoT, robotics-based, other emerging areas) software and product
Information and Communication Technology (ICT) space
Other emerging and technological areas', 'DPIIT-recognised startups incorporated in a Tier 2 or Tier 3 city, 1-5 years old, with Indian founders holding at least 51%.
An MVP or working prototype, and at least one full-time founder.
A Pilot PO/WO of ₹1 lakh–₹1 crore from an eligible, independent Pilot Partner, covering deployment of the startup''s own product.
Cumulative revenue up to ₹1.5 crore.
Prior government funding up to ₹40 lakh and prior private funding up to ₹1.5 crore.
Beneficiaries of TIDE 2.0 (Scale-up), SAMRIDH or the GENESIS Investment Component, and startups in an ongoing GENESIS EIR cohort, are not eligible.
MSH & MeitY reserve the right to amend or modify the selection procedure, as deemed necessary.', '29 Oct 2026', 'Meity', 'Govt Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-equity-08', 'Equity', 8, 'VC Fund (KA)', 'Fund Type A
Range of INR 50 lakhs to 1 Cr.
upto INR 2 Cr at a later stage / follow-on investment

Fund Type B
Range of 2 to 3 Cr
& later stage follow-on investment.', 'Fund Type A
Animation, visual effects, Gaming, Comics, Media, Original IP Content and such other allied sectors

Fund Type B
AI, ML, MedTech, EV
Other Disruptive Technologies', 'Startups having registered entities with CIN Number (CIN number compulsory)', 'Rolling basis', 'Kitven Fund', 'Private Investor Scheme', 'Karnataka Only', 'INR 15,000 + 18% GST', null),
  ('sk-equity-09', 'Equity', 9, 'Cutting-Edge Inception', 'Expertise

Technological Support

Venture Capital Connects for private funding

Awareness: Access to exclusive NVIDIA Inception events', 'AI, ML, deep learning, data science, HPC, networking, graphics, AR/VR, and gaming and any other IT, IOT, AI powered solutions where CPU, DPU & NVIDIA play a vital role', 'At least one developer and one founder/co-founder, C-level executive (like CEO, CFO, CMO, etc), sales executive, or marketing executive.

Your startup needs to maintain a functional website live.

Your startup needs to be incorporated and have been incorporated in the last 10 years. (Proprietorship, Reg partnership, LLP, Private Limited, other registered)', 'Rolling basis', 'NVIDIA', 'Private Investor Scheme', 'Pan India', 'INR 5,000 + 18% GST', null),
  ('sk-equity-10', 'Equity', 10, 'Equity Linked Seed Fund', 'Investment of up to INR 30 Lakhs

Investment based in Equity or Equity linked (Equity linked means, debt-equity combined).

Equity based investment of up to 10% Equity stake', 'Biotech in agri, health, energy, environment and other emerging areas', 'Only Pvt Ltd companies are eligible
A company shall be considered as start up DPIIT
Up to 5 years from the date of its incorporation/registration
Turnover for any of the financial years has not exceeded Rs 25 cr', 'Rolling basis', 'BIRAC and Govt Authorized INCUBATORS', 'Government Authorized Incubator Scheme', 'Pan India', 'INR 15,000 + 18% GST', null),
  ('sk-equity-11', 'Equity', 11, 'Fund for SC/ST Entrepreneurs', 'Equity based funding as per project cost (Max up to ₹5 Cr)', '> Manufacturing based businesses (All Sectors)
> Service based businesses (Health Care, Renewable and Non-Conventional Energy, Agri ancillary, Food Processing, Energy efficiency – transmission – distribution, Clean Technology, Light Engineering, Information Technology, Medical Devices, Water and related technologies, Bio-Medical , and Consumption lead sectors)', '• Proprietor Unit
• Partnership firm
• Private Limited Companies
• Public Limited Companies
• SC/ST Promoters having 100% controlling stake in the Company
• The company shall fall in the definition of Start-up as defined by Start-up initiative of Govt. of India or MSME as per the Ministry of MSME/Micro, Small and Medium Enterprises Development Act, 2006.
• The entrepreneur and all operations of the business should be domiciled in the state of Maharashtra.', 'Rolling basis', 'Maharashtra Industrial Development Corporation and IDBI Trusteeship Services Limited', 'CSR involved program', 'Maharashtra', 'INR 10,000 + 18% GST', null),
  ('sk-loan-01', 'Loan', 1, 'CGSS Scheme', '1. The maximum amount of debt (fund-based or non-fund-based facilities) eligible for guarantee cover under the Scheme is up to ₹20 crore per borrower.
2. The Trust shall provide guarantee cover, subject to a maximum of Rs. 20 crore per borrower, as per the details given below:
 85% of the amount in default for loan amount up to Rs. 10 crore
 75% of the amount in default for loan amount exceeding Rs. 10 crore
3. RoI and repayment tenure as per bank norms', 'All Sectors', '1. The DPIIT recognizes startup (Reg. Partnership, LLP & Pvt Ltd) as per gazette notification(s) issued from time to time;
2. It is not in default to any lending/investing institution and is not classified as a Non-Performing Asset as per the guidelines of the Reserve Bank of India (RBI)', 'Rolling basis', 'DPIIT', 'Government Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-loan-02', 'Loan', 2, 'Mudra Loan', 'Shishu Category: Up to Rs. 50,000

Kishore Category: Rs. 50,001 to Rs. 5 Lakhs

Tarun Category: Rs. 5 Lakhs to Rs. 10 Lakhs

Tarun Plus: Loans sanctioned under the PMMY scheme Rs. 10 Lakhs up to Rs. 20 Lakhs (Only for those who have successfully repaid their Tarun category Loans)', 'Trading
Manufacturing
Service Sector', 'Anyone with individual docs , MSME Certificate', 'Rolling basis', 'Ministry Of Finance', 'Government Scheme', 'Pan India', 'INR 5,000 + 18% GST', null),
  ('sk-loan-03', 'Loan', 3, 'CGTMSE', 'Up to 10 CR Loan
ROI: Approx 7%-12%
Tenure: Depends on loan amount', 'Manufacturing and services', 'Any for profit registered entity with MSME Certificate and 1/2 years Company ITR', 'Rolling basis', 'MSME', 'Government Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-loan-04', 'Loan', 4, 'Seed Fund (KL)', 'Seed Fund of Rs.15 Lakhs at a subsidised interest rate of 6% per annum for Both Components in Seed Fund (KL).', 'All Sectors', 'Startup Approved by DPIIT and get Kerala Startup Mission Unique ID.

The startup director should have a good CIBIL Score, preferably more than 750.

Kerala based startup can apply', 'Rolling basis', 'Govt of Kerala', 'Government Scheme', 'Kerala State Only', 'INR 15,000 + 18% GST', null),
  ('sk-loan-05', 'Loan', 5, 'Financial Assistance for SC, ST & OBC', 'Loan INR 10 Lakh to ₹ 15 Cr. for SC
for SC(ROI: 4%, For women and Divyang: 3.75%)
Loan INR 10 Lakh to ₹ 5 Cr. for ST
for SC(ROI: 4%, For women and Divyang: 3.75%
Loan INR 20 Lakh to ₹ 15 Cr. for OBC
for OBC(ROI: 6%, For women and Divyang: 5.75%)', 'All Sectors

Non eligible companies:
Trading Company, Liquor, Commercial Vehicle, Dealership Businesses, Retailers, Petrol Pumps, School/College/Hospital, etc', '1. The company age should be more than 1 year.
2. Only Private\Public Limited Companies having CIN number.
3. A new company that is a successor entity of a Business entity (Proprietary Firm / Partnership Firm / One Person Company (OPC) / Limited Liability Partnership (LLP) / any other establishment incorporated under any law in force) meeting the above criteria with sound business model.
A maximum of 20% working capital is allowed out of the total financial assistance.', 'Rolling basis', 'Ministry of Social Justice and Empowerment', 'Government Scheme', 'Pan India', 'INR 30,000 + 18% GST', null),
  ('sk-loansubsidy-01', 'Loan + Subsidy', 1, 'Udyam Kranti Yojana (MP)', 'Loans ranging from ₹1,00,000 to ₹50,00,000 will be provided to the youth setting up manufacturing units and enterprises and ₹1,00,000 to ₹25,00,000 for the service sector

3% per annum interest subsidy', 'Manufacturing

Service

Retail Trade', '1. The age of the applicant should be between 18 to 45 years.

2. The minimum educational qualification of the applicant should be 8th class.

3. The benefit of this scheme will be provided to the applicant only if the annual income of the applicant''s family is Rs 12 lakh or less.', 'Rolling basis', 'Govt. of Madhya Pradesh', 'Government Scheme', 'Madhya Pradesh', 'INR 15,000 + 18% GST', null),
  ('sk-loansubsidy-02', 'Loan + Subsidy', 2, 'National Agri Infra Financing Facility - NAIFF', 'Up to 2 CR Loan
Interest Subvention: 3%
ROI: Approx 9%
Re-payment period: 7 years including 2 years moratorium', 'Only New Agriculture projects can apply, like cold storage, primary processing, warehouse, custom hiring, green house, poly house, vertical farming, etc.
Land is mandatory own or on lease for 7 to 8 years', 'FPOs
Private companies
Individual entrepreneurs
Startup
MSMEs', 'Rolling basis', 'Department of Agriculture & Farmers Welfare', 'Government Scheme', 'Pan India', 'INR 30,000 + 18% GST', null),
  ('sk-loansubsidy-03', 'Loan + Subsidy', 3, 'Animal Husbandry Infrastructure Development Fund - AHIDF', 'Loan up to 90% of Projects
Interest Subvention: 3%
Credit Guarantee Coverage 25%
Re-payment period: 8 years including 2 years moratorium', 'Dairy processing
Value-addition Dairy product Manufacturing
Animal Feed Manufacturing units
Setting up of Veterinary Vaccine Manufacturing facilities
Animal Waste to Wealth Management', 'FPOs
Private companies
Individual entrepreneurs
Section 8 companies
MSMEs', 'Rolling basis', 'Department of animal husbandry and dairying', 'Government Scheme', 'Pan India', 'INR 30,000 + 18% GST', null),
  ('sk-loansubsidy-04', 'Loan + Subsidy', 4, 'NEEDS Scheme (TN)', '-Project cost should be above ₹10 lakh, and below ₹5 crore.
-Rate of interest applicable to Micro & Small enterprises as per banking norms.
-Subsidy assistance will be provided by the State Government up to 25% of the project cost (Subject to a maximum limit of ₹75 Lakhs).
-Interest subvention provided at the rate of 3%, throughout the period of repayment.', 'Manufacturing and service activities are eligible

Note: PFA Attached PDF for Ineligible Projects under NEEDS Yojana', 'Applicant should be a resident of Tamil Nadu State for not less than 3 years.
First Generation Individual Entrepreneur (Proprietorship) or Group of Entrepreneurs (Partnership).
Applicant should be a first-generation entrepreneur.
Entrepreneurship Development Programme (EDP) training is mandatory (1 Month).
Age of the applicant should be between 21 to 35 years in general and for special (Women/BC/MBC/SC/ST/Ex-servicemen/Transgender/Differently abled), age relaxation is up to 45 years.', 'Rolling basis', 'Govt. of TN', 'Government Scheme', 'Tamil Nadu', 'INR 20,000 + 18% GST', null),
  ('sk-loansubsidy-05', 'Loan + Subsidy', 5, 'PMFME - Prime Minister Micro Food Processing Enterprises', 'Credit-linked capital subsidy @35% of the eligible project cost -
maximum of Rs. 10.0 lakhs per unit for upgradation or
setting up of new units.

ROI & Tenure: Depend on bank and loan facility provider', 'Food Processing', 'Individuals / Proprietorship / Partnership/ FPOs/ NGOs/ Cooperatives/ SHGs/ Private Limited Company', 'Rolling basis', 'Ministry of Food Processing Industries', 'Government Scheme', 'Pan India', 'INR 20,000 + 18% GST', null),
  ('sk-loansubsidy-06', 'Loan + Subsidy', 6, 'Fisheries and Aquaculture Infrastructure Development Fund (FIDF)', 'Loan up to 80% of the project cost
Interest subvention: 3%

Maximum repayment period of 12 years inclusive of moratorium of 2 years
The land should be for Minimum of 12 years lease period (in case of lease)
Beneficiaries require to contribute min 20% of the project cost as margin money', 'Fisheries and Aquaculture Infrastructure

Detailed components are available in full proposal', '1. Private Companies/ Entrepreneurs
2. State Governments/Union Territories
3. State Owned Corporations/State Government Under taking/ Government Sponsored/ Supported Organizations
4. Fisheries Cooperative Federations (including FISHCOPPED etc.)
5. Cooperatives, collective groups of fish farmers & fish produce groups etc.
6. Panchayat Raj Institutions/ Self Help Groups (SHGs)/ NGOs
7. SCs/STs/Marginal Farmers, Women & Entrepreneurs, Self Help Groups and cooperatives of these etc.
8. Physically disabled
9. Any other Institution/ Entity to be decided by the Government', 'Rolling basis', 'The Department of Fisheries, Ministry of Fisheries, Animal Husbandry & Dairying, Government of India', 'Government Scheme', 'Pan India', 'INR 25,000 + 18% GST', null),
  ('sk-certgemaward-01', 'Certification / GeM / Award', 1, 'Tender through GeM', 'Wider Market Access
Enhance Transparency & Efficiency
Cost Savings
Real-Time Updates
Equal Opportunity
Ease of Use & Secure Transactions
Support for MSMEs and Startups
Policy Compliance
EMD exempt if have a DPIIT Certificate', 'All focus sectors', 'Registered Vendors
Local Suppliers
Startups
Registration on the GeM portal is a prerequisite for all entities to participate in tenders and procurement activities.', 'Rolling basis', 'GeM', '', 'Pan India', 'INR 15,000 + 18% GST', 'Our consultancy fees are for
above mentioned scope of
work and do not include
any government fees/charges.
Whatever fees for tender document
fee/processing fee, EMD, bid security,
courier charges or any other charges
will be paid by you (customer).'),
  ('sk-certgemaward-02', 'Certification / GeM / Award', 2, 'IEC Code', 'An Importer -Exporter Code (IEC) is a key business identification number which mandatory for export from India or Import to India. No export or import shall be made by any person without obtaining an IEC unless specifically exempted. For services exports however, IEC shall be not be necessary except when the service provider is taking benefits under the Foreign Trade Policy.', 'Importer -Exporter', '1. Proprietorship
2. Partnership
3. Limited Liability Partnership
4. Private Limited
5. Public Limited
6. Government Undertaking
7. Registered Society
8. Trust
9. HUF
10. One person company
11. Other', 'Rolling basis', 'MINISTRY OF COMMERCE AND INDUSTRY', '', 'Pan India', 'INR 5,000 + 18% GST', 'excluding the government
processing fee (500), the
government processing fee is not
included in our consultancy charge;
the government processing fee
needs to be paid by client at
scheme authorities.'),
  ('sk-certgemaward-03', 'Certification / GeM / Award', 3, 'Gobardhan Certificate', 'The registration number is required to avail benefits/ support from other Ministries/ Departments.
Like
Interest subvention -AHIDF
Interest subvention - Agri-Infra Fund
Central Financial Assistance (CFA)- Waste to Energy
Additional Central Assistance - Swachh Bharat Mission
bio-CNG/Compressed Bio Gas (CBG) offtake - (SATAT) Initiative
Swachh Bharat Mission (Gramin)
Market Development Assistance', 'biogas/ Compressed Bio Gas (CBG) / Bio CNG plant', 'Anyone who operates or intending to setup a biogas/ Compressed Bio Gas (CBG) / Bio CNG plant in India can obtain a gobardhan registration certificate by registering in this unified registration portal.', 'Rolling basis', 'MINISTRY OF JAL SHAKTI DEPARTMENT OF DRINKING WATER & SANITATION', '', 'Pan India', 'INR 5,000 + 18% GST', null)
on conflict (id) do nothing;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sales_kit') then
    alter publication supabase_realtime add table public.sales_kit;
  end if;
end $$;

-- ##################################################################### 20261024010000_document_review_lock.sql
-- =====================================================================================================
-- Rexera CRM · client documents: who verified / rejected each one, and that decision is final — only a Super Admin can
-- change a verified or rejected document. The database records the reviewer itself (it can't be typed in by hand).
-- Safe to run more than once.
-- =====================================================================================================
alter table booking_documents add column if not exists reviewed_by text references app_users(id) on delete set null;
alter table booking_documents add column if not exists reviewed_at timestamptz;

create or replace function app.booking_document_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- the server (secret key) and the SQL editor are not limited
  if auth.uid() is null then return new; end if;
  if new.status is not distinct from old.status then
    -- no status change: the reviewer stays as recorded (only a Super Admin may correct it)
    if not app.has_role('superadmin') then new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at; end if;
    return new;
  end if;
  if old.status in ('VERIFIED', 'REJECTED') and not app.has_role('superadmin') then
    raise exception 'This document was already % — only a Super Admin can change it.', lower(old.status::text) using errcode = '42501';
  end if;
  new.reviewed_by := app.me();
  new.reviewed_at := now();
  return new;
end $$;
drop trigger if exists booking_documents_review on booking_documents;
create trigger booking_documents_review before update on booking_documents for each row execute function app.booking_document_review();

-- ##################################################################### 20261024020000_candidate_branch.sql
-- =====================================================================================================
-- Rexera CRM · job applications: the branch the candidate applies for (Ahmedabad (A), Ahmedabad (Y), Vadodara).
-- Applicants send it with the public form (anon insert is already allowed). Safe to run more than once.
-- =====================================================================================================
alter table candidate_applications add column if not exists branch text check (branch is null or length(branch) <= 100);
create index if not exists candidate_applications_branch_idx on candidate_applications(branch);

-- ##################################################################### 20261024030000_candidate_details.sql
-- =====================================================================================================
-- Rexera CRM · job applications: position applied for, Internship / Fresher / Employee (experienced), current CTC
-- (experienced only) and the preferred interview date & time (India time, YYYY-MM-DDTHH:mm). Safe to run more than once.
-- =====================================================================================================
alter table candidate_applications add column if not exists position text check (position is null or length(position) <= 120);
alter table candidate_applications add column if not exists candidate_type text check (candidate_type is null or candidate_type in ('INTERNSHIP', 'FRESHER', 'EXPERIENCED'));
alter table candidate_applications add column if not exists current_ctc text check (current_ctc is null or length(current_ctc) <= 60);
alter table candidate_applications add column if not exists interview_at text check (interview_at is null or interview_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$');
create index if not exists candidate_applications_interview_idx on candidate_applications(interview_at);

-- ##################################################################### 20261024040000_realtime_all_tables.sql
-- =====================================================================================================
-- Rexera CRM · live updates for every table: each open CRM screen gets other people's changes at once (row-level
-- security still decides who sees what). Adds any table not yet in the realtime publication. Safe to run more than once.
-- =====================================================================================================
do $$ declare t text; begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
  for t in select tablename from pg_tables where schemaname = 'public' and tablename not in ('login_attempts', 'reminder_log') loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ##################################################################### 20261024050000_candidate_form_position.sql
-- =====================================================================================================
-- Rexera CRM · job application forms: the position HR is hiring for (BDM, BDE, Admin, Operation Team Member, HR …),
-- shown chosen on the candidate's form. Safe to run more than once.
-- =====================================================================================================
alter table candidate_forms add column if not exists position text check (position is null or length(position) <= 120);

-- ##################################################################### 20261024060000_candidate_form_positions.sql
-- =====================================================================================================
-- Rexera CRM · job application forms: one or more positions per form (HR ticks them; the candidate picks one).
-- Forms saved with a single position keep it. Safe to run more than once.
-- =====================================================================================================
alter table candidate_forms add column if not exists position text check (position is null or length(position) <= 120);
alter table candidate_forms add column if not exists positions text[] not null default '{}';
update candidate_forms set positions = array[position] where position is not null and cardinality(positions) = 0;

-- ##################################################################### 20261025000000_website_cms.sql
-- =====================================================================================================
-- Rexera CRM · the website managed from the CRM (Super Admin) and the website lead log. Safe to run more than once.
--  * site_content: each part of rexera.co.in — draft (edited in the CRM) and published (what the website reads,
--    through the server's GET /api/site/content).
--  * site_content_history: every published version (restore an earlier one).
--  * website_lead_log: every website form submission as it arrived, written by the server; failed ones can be retried.
--  * site-assets: public bucket for website images (only website managers upload / delete).
-- =====================================================================================================
create table if not exists site_content (
  key          text primary key check (key in ('hero', 'banners', 'about', 'services', 'portfolio', 'sections', 'contact', 'forms', 'seo')),
  draft        jsonb,
  published    jsonb,
  updated_at   timestamptz not null default now(),
  updated_by   text references app_users(id) on delete set null,
  published_at timestamptz,
  published_by text references app_users(id) on delete set null
);
create table if not exists site_content_history (
  id           text primary key,
  key          text not null,
  content      jsonb,
  published_at timestamptz not null default now(),
  published_by text references app_users(id) on delete set null
);
-- an older copy of these tables may already exist: give it every column
alter table site_content add column if not exists draft jsonb;
alter table site_content add column if not exists published jsonb;
alter table site_content add column if not exists updated_at timestamptz not null default now();
alter table site_content add column if not exists updated_by text references app_users(id) on delete set null;
alter table site_content add column if not exists published_at timestamptz;
alter table site_content add column if not exists published_by text references app_users(id) on delete set null;
alter table site_content_history add column if not exists key text;
alter table site_content_history add column if not exists content jsonb;
alter table site_content_history add column if not exists published_at timestamptz not null default now();
alter table site_content_history add column if not exists published_by text references app_users(id) on delete set null;
create index if not exists site_content_history_idx on site_content_history(published_at desc);
alter table site_content enable row level security;
alter table site_content_history enable row level security;
drop policy if exists site_content_manage on site_content;
create policy site_content_manage on site_content for all to authenticated using (app.has_perm('website.manage')) with check (app.has_perm('website.manage'));
drop policy if exists site_history_manage on site_content_history;
create policy site_history_manage on site_content_history for all to authenticated using (app.has_perm('website.manage')) with check (app.has_perm('website.manage'));

create table if not exists website_lead_log (
  id         text primary key,
  at         timestamptz not null default now(),
  status     text not null check (status in ('SAVED', 'EXISTING', 'FAILED', 'INVALID', 'SPAM')),
  form       text,
  name       text,
  phone      text,
  email      text,
  error      text,
  lead_id    text,
  fields     jsonb,
  retried_at timestamptz,
  retried_by text references app_users(id) on delete set null
);
create index if not exists website_lead_log_at_idx on website_lead_log(at desc);
alter table website_lead_log enable row level security;
drop policy if exists website_lead_log_read on website_lead_log;
create policy website_lead_log_read on website_lead_log for select to authenticated using (app.has_perm('website.manage'));
-- written only by the server (secret key)

-- public images for the website
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-assets', 'site-assets', true, 3145728, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])
on conflict (id) do update set public = true;
drop policy if exists site_assets_add on storage.objects;
create policy site_assets_add on storage.objects for insert to authenticated with check (bucket_id = 'site-assets' and app.has_perm('website.manage'));
drop policy if exists site_assets_remove on storage.objects;
create policy site_assets_remove on storage.objects for delete to authenticated using (bucket_id = 'site-assets' and app.has_perm('website.manage'));

do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['site_content', 'site_content_history', 'website_lead_log'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ##################################################################### 20261025010000_staff_only_reads.sql
-- Client portal, step 1: client logins are Supabase "authenticated" users too, so everything that any signed-in
-- account could read is narrowed to CRM staff (a signed-in account linked to an active app_users row). Clients reach
-- their own data only through the server (/api/portal/*), never these tables.
create or replace function app.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select app.current_user_id() is not null
$$;
grant execute on function app.is_staff() to authenticated, service_role;

drop policy if exists users_read on app_users;
create policy users_read on app_users for select to authenticated using (app.is_staff());
drop policy if exists extra_roles_read on user_extra_roles;
create policy extra_roles_read on user_extra_roles for select to authenticated using (app.is_staff());
drop policy if exists role_perms_read on role_permissions;
create policy role_perms_read on role_permissions for select to authenticated using (app.is_staff());
drop policy if exists services_read on services;
create policy services_read on services for select to authenticated using (app.is_staff());
drop policy if exists schemes_read on schemes;
create policy schemes_read on schemes for select to authenticated using (app.is_staff() and (active or app.has_perm('schemes.manage')));
drop policy if exists broadcasts_read on broadcasts;
create policy broadcasts_read on broadcasts for select to authenticated using (app.is_staff() and (audience is null or app.user_roles(app.me()) && audience or app.has_perm('broadcasts.manage')));
drop policy if exists acks_read on broadcast_acks;
create policy acks_read on broadcast_acks for select to authenticated using (app.is_staff());
drop policy if exists events_read on events;
create policy events_read on events for select to authenticated using (app.is_staff());
drop policy if exists runs_read on payroll_runs;
create policy runs_read on payroll_runs for select to authenticated using (app.has_perm('payroll.view') or (app.is_staff() and status in ('FINALIZED','PAID')));
drop policy if exists rules_read on incentive_rule_versions;
create policy rules_read on incentive_rule_versions for select to authenticated using (app.is_staff());
drop policy if exists templates_read on message_templates;
create policy templates_read on message_templates for select to authenticated using (app.is_staff());
drop policy if exists automations_read on email_automations;
create policy automations_read on email_automations for select to authenticated using (app.is_staff());
drop policy if exists settings_read on app_settings;
create policy settings_read on app_settings for select to authenticated using (app.is_staff());
drop policy if exists sales_kit_read on sales_kit;
create policy sales_kit_read on sales_kit for select to authenticated using (app.is_staff());
drop policy if exists notices_insert on notifications;
create policy notices_insert on notifications for insert to authenticated with check (app.is_staff());
drop policy if exists audit_insert on audit_log;
create policy audit_insert on audit_log for insert to authenticated with check (app.is_staff() and (by_user = app.me() or by_user is null));

-- CRM files: staff only (a client gets a short-lived link to their own files from the server)
drop policy if exists crm_files_read on storage.objects;
create policy crm_files_read on storage.objects for select to authenticated using (bucket_id = 'crm-files' and app.is_staff());
drop policy if exists crm_files_add on storage.objects;
create policy crm_files_add on storage.objects for insert to authenticated with check (bucket_id = 'crm-files' and app.is_staff());

-- ##################################################################### 20261025020000_client_portal.sql
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

-- ##################################################################### 20261025030000_admin_team_assignment.sql
-- =====================================================================================================
-- Rexera CRM · Operations Dashboard → Team: an Admin given documents there (Pitch Deck, Finance, DPR, Certification,
-- Submission — stored in app_settings.workflow.adminStageAccess) works only on what is assigned to them.
-- Safe to run more than once.
--  * they see only the CRM entries where they are the file's Admin or hold an Admin stage (and those entries' rows);
--  * they can change only their own Admin stages on those entries;
--  * they can't change the workflow settings (where the assignment itself is stored).
-- Admins never set up there, and everyone else, keep the access they had.
-- =====================================================================================================
create or replace function app.stage_only_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    app.user_roles(app.me()) = array['admin']::app_role[]
    and exists (select 1 from app_settings s where s.key = 'workflow' and coalesce(s.value -> 'adminStageAccess', '{}'::jsonb) ? app.me()),
    false)
$$;
grant execute on function app.stage_only_admin() to authenticated, service_role;

create or replace function app.can_see_booking(b_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from bookings b where b.id = b_id and (
      case when app.stage_only_admin() then
        b.admin_id = app.me()
        or exists (select 1 from jsonb_each(coalesce(b.admin_work, '{}'::jsonb)) w where w.value ->> 'assignee' = app.me())
      else
        app.has_perm('bookings.all')
        or b.created_by = app.me()
        or (app.has_perm('bookings.team') and (b.team_lead_id = app.me() or exists (select 1 from app_users u where u.id = b.created_by and u.team_lead_id = app.me())))
      end
    )
  )
$$;

-- their own stages only: any other stage on the entry must stay exactly as it was
create or replace function app.guard_admin_work() returns trigger language plpgsql as $$
declare k text;
begin
  if not app.stage_only_admin() then return new; end if;
  for k in select jsonb_object_keys(coalesce(old.admin_work, '{}'::jsonb) || coalesce(new.admin_work, '{}'::jsonb)) loop
    if coalesce(old.admin_work -> k ->> 'assignee', '') <> app.me() and (old.admin_work -> k) is distinct from (new.admin_work -> k) then
      raise exception 'You can change only the Admin stages assigned to you.';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists guard_admin_work on bookings;
create trigger guard_admin_work before update of admin_work on bookings for each row execute function app.guard_admin_work();

-- client forms (Document Form Builder) belong to the Operation team's work, not theirs
drop policy if exists doc_forms_manage on doc_forms;
create policy doc_forms_manage on doc_forms for all to authenticated using (app.has_perm('forms.manage') and not app.stage_only_admin()) with check (app.has_perm('forms.manage') and not app.stage_only_admin());
drop policy if exists doc_form_submissions_read on doc_form_submissions;
create policy doc_form_submissions_read on doc_form_submissions for select to authenticated using (app.has_perm('forms.manage') and not app.stage_only_admin());
drop policy if exists doc_form_submissions_review on doc_form_submissions;
create policy doc_form_submissions_review on doc_form_submissions for update to authenticated using (app.has_perm('forms.manage') and not app.stage_only_admin()) with check (app.has_perm('forms.manage') and not app.stage_only_admin());

-- the assignment lives in the workflow settings: such an Admin can't change it
drop policy if exists settings_write on app_settings;
create policy settings_write on app_settings for all to authenticated
  using (app.is_master() or (key in ('pf', 'breaks') and app.has_role('hr')) or (key = 'counters' and app.me() is not null) or (key = 'workflow' and app.has_perm('workflow.manage') and not app.stage_only_admin()))
  with check (app.is_master() or (key in ('pf', 'breaks') and app.has_role('hr')) or (key = 'counters' and app.me() is not null) or (key = 'workflow' and app.has_perm('workflow.manage') and not app.stage_only_admin()));

-- ##################################################################### 20261026000000_digital_media.sql
-- =====================================================================================================
-- Rexera CRM · Digital Media Dashboard → Media Function. Safe to run more than once.
--  * media_items: one record per post / flyer / poster / video / … with its files, where it is published (internal =
--    company dashboards, external = client portals), assignment date / time / person and work status. One source
--    record whatever it is published to — never copied.
--  * media-files: private bucket for the files (images, videos, PDF, Word, PowerPoint; 50 MB each).
--  * Who sees what: media managers (media.manage) everything; the assignee and creator their records; company users
--    (media.view) published internal media. Clients get external media only through the live server (/api/portal).
--  * The assignee may only upload files and update the work status (not put it on hold): checked here too.
-- =====================================================================================================
create table if not exists media_items (
  id                 text primary key,
  serial             int not null unique,
  scheme_name        text not null,
  title              text not null,
  description        text not null default '',
  media_type         text not null check (media_type in ('POST', 'FLYER', 'POSTER', 'VIDEO', 'IMAGE', 'PDF', 'OTHER')),
  files              jsonb not null default '[]'::jsonb,
  internal           boolean not null default false,
  external           boolean not null default false,
  client_booking_ids text[] not null default '{}',
  assign_date        date,
  assign_time        text check (assign_time is null or assign_time ~ '^\d{2}:\d{2}$'),
  assigned_to        text references app_users(id) on delete set null,
  work_status        text not null default 'PENDING' check (work_status in ('PENDING', 'ON_HOLD', 'COMPLETED')),
  notes              text,
  submitted          boolean not null default false,
  submitted_at       timestamptz,
  submitted_by       text references app_users(id) on delete set null,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  created_by         text references app_users(id) on delete set null,
  updated_at         timestamptz not null default now(),
  updated_by         text references app_users(id) on delete set null,
  history            jsonb not null default '[]'::jsonb,
  check (not submitted or internal or external)
);
create index if not exists media_items_assigned_idx on media_items(assigned_to);

create or replace function app.can_see_media(m_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from media_items m where m.id = m_id and app.is_staff() and (
    app.has_perm('media.manage') or m.assigned_to = app.me() or m.created_by = app.me()
    or (app.has_perm('media.view') and m.internal and m.submitted and jsonb_array_length(m.files) > 0)))
$$;
grant execute on function app.can_see_media(text) to authenticated, service_role;

alter table media_items enable row level security;
drop policy if exists media_read on media_items;
create policy media_read on media_items for select to authenticated using (app.can_see_media(id));
drop policy if exists media_insert on media_items;
create policy media_insert on media_items for insert to authenticated with check (app.has_perm('media.manage'));
drop policy if exists media_update on media_items;
create policy media_update on media_items for update to authenticated
  using (app.has_perm('media.manage') or (app.is_staff() and assigned_to = app.me()))
  with check (app.has_perm('media.manage') or (app.is_staff() and assigned_to = app.me()));
drop policy if exists media_delete on media_items;
create policy media_delete on media_items for delete to authenticated using (app.has_perm('media.manage'));

-- the assignee: files and work status only (on hold is for media managers)
create or replace function app.guard_media_update() returns trigger language plpgsql as $$
declare keep text[] := array['files', 'work_status', 'completed_at', 'history', 'updated_at', 'updated_by'];
begin
  if app.has_perm('media.manage') or app.me() is null then return new; end if;
  if (to_jsonb(new) - keep) is distinct from (to_jsonb(old) - keep) then
    raise exception 'You can only upload files and update the work status of media assigned to you.';
  end if;
  if (old.work_status = 'ON_HOLD') <> (new.work_status = 'ON_HOLD') then
    raise exception 'Only a media manager can put work on hold or take it off hold.';
  end if;
  return new;
end $$;
drop trigger if exists guard_media_update on media_items;
create trigger guard_media_update before update on media_items for each row execute function app.guard_media_update();

-- files
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media-files', 'media-files', false, 52428800, array[
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists media_files_read on storage.objects;
create policy media_files_read on storage.objects for select to authenticated using (
  bucket_id = 'media-files' and app.is_staff() and (owner_id = auth.uid()::text
    or exists (select 1 from media_items m where m.files @> jsonb_build_array(jsonb_build_object('id', name)) and app.can_see_media(m.id))));
drop policy if exists media_files_add on storage.objects;
create policy media_files_add on storage.objects for insert to authenticated with check (
  bucket_id = 'media-files' and app.is_staff() and name like 'media-%'
  and (app.has_perm('media.manage') or exists (select 1 from media_items m where m.assigned_to = app.me())));
drop policy if exists media_files_remove on storage.objects;
create policy media_files_remove on storage.objects for delete to authenticated using (
  bucket_id = 'media-files' and (app.has_perm('media.manage') or owner_id = auth.uid()::text));

-- everyone sees company media; Admins manage it (Access Management can change both)
insert into role_permissions (role, permission)
select r::app_role, 'media.view' from unnest(array['admin', 'accounts', 'legal', 'operations', 'teamlead', 'sales', 'hr', 'support', 'branchdirector']) r
on conflict do nothing;
insert into role_permissions (role, permission) values ('admin', 'media.manage') on conflict do nothing;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'media_items') then
    alter publication supabase_realtime add table public.media_items;
  end if;
end $$;

-- ##################################################################### 20261026010000_digital_media_role.sql
-- =====================================================================================================
-- Rexera CRM · the Digital Media role: its own dashboard (Digital Media → Media Function) and the Flyers & Posts it
-- feeds. Safe to run more than once. Give a person this role in Access Management → Users.
-- =====================================================================================================
alter type app_role add value if not exists 'digitalmedia';
-- a new role can only be used once it is saved
commit;

insert into role_permissions (role, permission)
select 'digitalmedia'::app_role, p from unnest(array['broadcasts.view', 'messages.use', 'schemes.view', 'content.view', 'content.manage', 'media.view', 'media.manage']) p
on conflict do nothing;

-- ##################################################################### 20261026020000_digital_media_section_only.sql
-- =====================================================================================================
-- Rexera CRM · the Digital Media section (dashboard, posts, flyers) is the Digital Media team's only: no other role
-- manages media (Super Admin / IT keep everything). Safe to run more than once.
-- =====================================================================================================
delete from role_permissions where permission = 'media.manage' and role::text <> 'digitalmedia';
delete from user_permission_overrides where permission = 'media.manage' and effect = 'allow'
  and user_id in (select id from app_users where role::text not in ('digitalmedia', 'superadmin', 'it'));

-- ##################################################################### 20261026030000_close_direct_applications.sql
-- =====================================================================================================
-- Rexera CRM · job applications are saved only by the live server (/api/apply), which checks every answer and the
-- resume's real content. The old rule letting anyone insert straight into candidate_applications (skipping all of
-- those checks — e.g. a "javascript:" LinkedIn link) is closed. Safe to run more than once.
-- (Resumes are still uploaded by the form page itself; the server checks and removes bad ones.)
-- =====================================================================================================
drop policy if exists candidate_apps_public_insert on candidate_applications;
revoke insert on candidate_applications from anon;

-- ##################################################################### 20261028000000_client_entries.sql
-- =====================================================================================================
-- Rexera CRM · client entries (pre-CRM entries). Safe to run more than once.
--  * The flow is now: sales person → dialer → client entry → follow-ups (if needed) → CRM entry. While the dialer
--    call is on, the sales person fills the client entry (date, client name, company name, number, scheme, pitched
--    price, status, requirement and note are compulsory; the follow-up date is not). Once the payment is received
--    they convert it into the CRM entry, and only that counts as a CRM entry.
--  * Seen only by the sales person who made it and their team leader (Super Admin / IT keep access for backups).
--  * Converting it is checked here too: the CRM entry must exist and belong to the entry's owner, and a converted
--    entry can no longer be changed (except by Super Admin / IT).
-- =====================================================================================================
create table if not exists client_entries (
  id            text primary key,
  entry_date    date not null,
  client_name   text not null check (length(trim(client_name)) >= 2),
  company_name  text not null check (length(trim(company_name)) >= 2),
  phone         text not null check (phone ~ '^[6-9][0-9]{9}$'),
  service_id    text references services(id) on delete set null,
  scheme        text not null check (length(trim(scheme)) >= 1),
  pitched_price numeric(14,2) not null check (pitched_price > 0),
  status        text not null check (status in ('INTERESTED', 'HOT', 'CALL_BACK', 'PAYMENT_PENDING', 'NOT_INTERESTED', 'CONVERTED')),
  requirement   text not null check (length(trim(requirement)) >= 3),
  note          text not null check (length(trim(note)) >= 3),
  follow_up     date,
  follow_ups    jsonb not null default '[]'::jsonb,
  lead_id       text references leads(id) on delete set null,
  owner_id      text references app_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  booking_id    text references bookings(id) on delete set null,
  converted_at  timestamptz
);
create index if not exists client_entries_owner_idx on client_entries(owner_id);
create index if not exists client_entries_lead_idx on client_entries(lead_id);

create or replace function app.can_see_client_entry(owner text) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_staff() and (owner = app.me() or app.is_master()
    or exists (select 1 from app_users u where u.id = owner and u.team_lead_id = app.me()))
$$;
grant execute on function app.can_see_client_entry(text) to authenticated, service_role;

alter table client_entries enable row level security;
drop policy if exists client_entries_read on client_entries;
create policy client_entries_read on client_entries for select to authenticated using (app.can_see_client_entry(owner_id));
drop policy if exists client_entries_insert on client_entries;
create policy client_entries_insert on client_entries for insert to authenticated
  with check (app.is_staff() and owner_id = app.me() and app.has_perm('dialer.use') and status <> 'CONVERTED' and booking_id is null);
drop policy if exists client_entries_update on client_entries;
create policy client_entries_update on client_entries for update to authenticated
  using (app.can_see_client_entry(owner_id)) with check (app.can_see_client_entry(owner_id));
drop policy if exists client_entries_delete on client_entries;
create policy client_entries_delete on client_entries for delete to authenticated using (app.is_master());

-- the owner stays the owner; converting needs the owner's own CRM entry; a converted entry is final
create or replace function app.guard_client_entry_update() returns trigger language plpgsql as $$
begin
  if app.me() is null or app.is_master() then return new; end if;
  if new.owner_id is distinct from old.owner_id then raise exception 'A client entry stays with the sales person who made it.'; end if;
  if old.status = 'CONVERTED' then raise exception 'This client entry is already a CRM entry.'; end if;
  if new.status = 'CONVERTED' then
    if new.owner_id is distinct from app.me() then raise exception 'Only the sales person who made the client entry can convert it.'; end if;
    if not exists (select 1 from bookings b where b.id = new.booking_id and b.created_by = new.owner_id) then
      raise exception 'Convert a client entry by making its CRM entry.';
    end if;
  elsif new.booking_id is not null then
    raise exception 'Convert a client entry by making its CRM entry.';
  end if;
  return new;
end $$;
drop trigger if exists guard_client_entry_update on client_entries;
create trigger guard_client_entry_update before update on client_entries for each row execute function app.guard_client_entry_update();

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'client_entries') then
    alter publication supabase_realtime add table public.client_entries;
  end if;
end $$;

-- ##################################################################### 20261029000000_dialer_dashboard.sql
-- =====================================================================================================
-- Rexera CRM · Dialer dashboard. Safe to run more than once. Existing rows are not changed.
--  * lead_calls gets three optional columns the dashboard reads: total_sec (the whole Blutec call, ringing included —
--    duration_sec stays the talk time), call_status (Blutec's final status, e.g. completed / no_answer / busy) and
--    wrap_sec (from the end of the call until the agent saved the outcome).
--  * lead_calls can now be updated by the person who made the call: the Blutec call-completed webhook files a call
--    under the same id (bt-<ref>) the agent saves it under, so the agent's save merges into that row instead of
--    making a second one (or failing).
--  * Campaigns given to each sales person (Dialer → IVR campaigns → Dialer campaigns, Super Admin) are kept in the
--    app_settings row "dialerCampaigns"; the server reads it so a sales person only gets their own campaigns.
-- =====================================================================================================
alter table lead_calls add column if not exists total_sec int check (total_sec is null or total_sec >= 0);
alter table lead_calls add column if not exists call_status text;
alter table lead_calls add column if not exists wrap_sec int check (wrap_sec is null or wrap_sec >= 0);

drop policy if exists calls_update on lead_calls;
create policy calls_update on lead_calls for update to authenticated
  using (app.can_see_lead(lead_id) and (called_by = app.me() or called_by is null))
  with check (app.can_see_lead(lead_id) and called_by = app.me());

-- ##################################################################### 20261029010000_invoice_remarks.sql
-- =====================================================================================================
-- Rexera CRM · invoice remarks, printed on the invoice (preview, print and PDF). Safe to run more than once.
-- An invoice is issued from the branch of the person who creates it (set by the app; no branch is picked by hand).
-- =====================================================================================================
alter table invoices add column if not exists remarks text check (remarks is null or length(remarks) <= 1000);

-- ##################################################################### 20261030000000_sales_self_service.sql
-- =====================================================================================================
-- Rexera CRM · sales self-service. Safe to run more than once.
--  * Client entries: a pitched price of 0 is allowed (e.g. a full discount); a negative one is not.
--  * Invoices: the sales person who made a proforma (or is on it) edits it themselves while nothing has been paid
--    against it; Accounts (billing.manage) keeps every other change. They can never change its number, type, status,
--    payments, sales person or CRM entry.
--  * Invoice lines follow the same rule (they were open to anyone with billing.create, for any invoice).
-- =====================================================================================================
alter table client_entries drop constraint if exists client_entries_pitched_price_check;
alter table client_entries add constraint client_entries_pitched_price_check check (pitched_price >= 0);

-- a proforma of mine with no payment on it
create or replace function app.own_open_proforma(inv_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_perm('billing.create') and exists (
    select 1 from invoices i where i.id = inv_id and (i.created_by = app.me() or i.sales_person = app.me())
      and i.type = 'PROFORMA' and i.status = 'ISSUED' and i.paid = 0)
$$;
grant execute on function app.own_open_proforma(text) to authenticated, service_role;

drop policy if exists invoices_update on invoices;
create policy invoices_update on invoices for update to authenticated
  using (app.has_perm('billing.manage') or app.own_open_proforma(id))
  with check (app.has_perm('billing.manage') or (app.has_perm('billing.create') and (created_by = app.me() or sales_person = app.me())
    and type = 'PROFORMA' and status = 'ISSUED' and paid = 0));

create or replace function app.guard_invoice_update() returns trigger language plpgsql as $$
begin
  if app.me() is null or app.has_perm('billing.manage') then return new; end if;
  if new.number is distinct from old.number or new.type is distinct from old.type or new.paid is distinct from old.paid
     or new.status is distinct from old.status or new.sales_person is distinct from old.sales_person or new.created_by is distinct from old.created_by
     or new.booking_id is distinct from old.booking_id or new.issued_on is distinct from old.issued_on or new.branch_id is distinct from old.branch_id then
    raise exception 'Only Accounts can change the number, type, status, payments, branch or sales person of an invoice.';
  end if;
  return new;
end $$;
drop trigger if exists guard_invoice_update on invoices;
create trigger guard_invoice_update before update on invoices for each row execute function app.guard_invoice_update();

drop policy if exists invoice_items_write on invoice_items;
create policy invoice_items_write on invoice_items for all to authenticated
  using (app.has_perm('billing.manage') or app.own_open_proforma(invoice_id))
  with check (app.has_perm('billing.manage') or app.own_open_proforma(invoice_id));

-- ##################################################################### 20261030010000_scheme_checker_rules.sql
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

-- ##################################################################### 20261030020000_automation_center.sql
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

-- ##################################################################### 20261030030000_user_activity.sql
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

-- ##################################################################### 20261030040000_portal_view.sql
-- =====================================================================================================
-- Rexera CRM · client portal progress for the Operation team, Admin and IT. Safe to run more than once.
--  * portal.view: see EVERY client's portal login, sign-ins, uploads and progress (Client Portal → Progress) —
--    the Operation team and Admin (IT Support and Super Admin hold every permission already). An Admin limited to
--    their own stages keeps seeing only their own files' clients.
--  * Inviting, linking, deactivating and resetting access stay with portal.manage (Super Admin) — unchanged.
-- =====================================================================================================
insert into role_permissions (role, permission) values ('operations', 'portal.view'), ('admin', 'portal.view') on conflict do nothing;

drop policy if exists client_accounts_read on client_accounts;
create policy client_accounts_read on client_accounts for select to authenticated
  using (app.has_perm('portal.manage') or (app.has_perm('portal.view') and not app.stage_only_admin())
    or (app.is_staff() and exists (select 1 from unnest(booking_ids) b(id) where app.can_see_booking(b.id))));

drop policy if exists client_activity_read on client_activity;
create policy client_activity_read on client_activity for select to authenticated
  using (app.has_perm('portal.manage') or (app.has_perm('portal.view') and not app.stage_only_admin())
    or (booking_id is not null and app.can_see_booking(booking_id)));

-- ##################################################################### 20261031000000_client_messages.sql
-- =====================================================================================================
-- Rexera CRM · client communication (WhatsApp / email to clients). Safe to run more than once.
--  * client_messages: every message sent to a client — content, sender, recipient, channel, time, status, error.
--    ONLY the live server writes it (POST /api/client-message, with the service key), after checking the sender's
--    team, the step of the file and the recipient saved on the record — a browser can't add or change a row.
--    Read by the Operation Team, Admin, Super Admin and IT (every message), and by anyone who can see the CRM entry /
--    client entry it is about.
--  * client_entries.email: optional, for the Sales Team's welcome email.
--  * app_settings 'clientTemplates': the message templates — edited by the Operation Team and Admin (and masters).
-- =====================================================================================================
alter table client_entries add column if not exists email text check (email is null or email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$');

create table if not exists client_messages (
  id              text primary key,
  booking_id      text references bookings(id) on delete cascade,
  client_entry_id text references client_entries(id) on delete cascade,
  stage           text not null,
  channel         text not null check (channel in ('EMAIL', 'WHATSAPP')),
  to_addr         text not null,
  subject         text,
  body            text not null check (length(body) <= 6000),
  status          text not null check (status in ('SENT', 'MANUAL', 'FAILED', 'NOT_CONFIGURED')),
  error           text,
  sent_by         text references app_users(id) on delete set null,
  sent_at         timestamptz not null default now(),
  provider_id     text,
  check ((booking_id is null) <> (client_entry_id is null))
);
create index if not exists client_messages_booking_idx on client_messages(booking_id, sent_at desc);
create index if not exists client_messages_entry_idx on client_messages(client_entry_id, sent_at desc);
create index if not exists client_messages_sent_idx on client_messages(sent_at desc);

alter table client_messages enable row level security;
drop policy if exists client_messages_read on client_messages;
create policy client_messages_read on client_messages for select to authenticated using (
  app.is_master() or ((app.has_role('operations') or app.has_role('admin')) and not app.stage_only_admin())
  or (booking_id is not null and app.can_see_booking(booking_id))
  or (client_entry_id is not null and exists (select 1 from client_entries e where e.id = client_entry_id and app.can_see_client_entry(e.owner_id))));
-- no insert / update / delete policy: only the server (service key) writes

-- the templates: the Operation Team and Admin (as before for everything else)
drop policy if exists settings_write on app_settings;
create policy settings_write on app_settings for all to authenticated
  using (app.is_master() or (key in ('pf', 'breaks') and app.has_role('hr')) or (key = 'counters' and app.me() is not null) or (key = 'workflow' and app.has_perm('workflow.manage') and not app.stage_only_admin())
    or (key = 'clientTemplates' and (app.has_role('operations') or app.has_role('admin')) and not app.stage_only_admin()))
  with check (app.is_master() or (key in ('pf', 'breaks') and app.has_role('hr')) or (key = 'counters' and app.me() is not null) or (key = 'workflow' and app.has_perm('workflow.manage') and not app.stage_only_admin())
    or (key = 'clientTemplates' and (app.has_role('operations') or app.has_role('admin')) and not app.stage_only_admin()));

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'client_messages') then
    alter publication supabase_realtime add table public.client_messages;
  end if;
end $$;

-- ##################################################################### 20261031010000_portal_legal_it_logins.sql
-- =====================================================================================================
-- Rexera CRM · client portal: the Legal team also sees it; client logins are IT Support's. Safe to run more than once.
--  * portal.view (Client Portal → Progress, Accounts, Activity, read-only) now also for Legal — with the Operation
--    team and Admin (Super Admin and IT Support hold every permission already).
--  * Creating a client's login (ID + password), new passwords, linking entries and deactivating are done by IT Support
--    only: the live server (/api/portal-admin, server/portal.mjs) refuses everyone else, the Super Admin included.
-- =====================================================================================================
insert into role_permissions (role, permission) values ('legal', 'portal.view') on conflict do nothing;

-- ##################################################################### 20261031020000_candidate_letters.sql
-- =====================================================================================================
-- Rexera CRM · HR: selected candidates, and the offer / joining letters sent to them. Safe to run more than once.
--  * candidate_applications.selected: HR ticks a candidate for a letter (unticking takes them off the list).
--  * candidate_letters: every letter sent by email or WhatsApp — written only by the live server (/api/hr/letter);
--    HR (recruitment.manage) reads it.
-- =====================================================================================================
alter table candidate_applications add column if not exists selected boolean;
alter table candidate_applications add column if not exists selected_at timestamptz;
alter table candidate_applications add column if not exists selected_by text;

create table if not exists candidate_letters (
  id           text primary key,
  candidate_id text not null references candidate_applications(id) on delete cascade,
  kind         text not null check (kind in ('OFFER', 'JOINING')),
  channel      text not null check (channel in ('EMAIL', 'WHATSAPP')),
  to_addr      text not null,
  subject      text,
  body         text not null,
  status       text not null check (status in ('SENT', 'MANUAL', 'FAILED', 'NOT_CONFIGURED')),
  error        text,
  sent_by      text references app_users(id) on delete set null,
  sent_at      timestamptz not null default now()
);
create index if not exists candidate_letters_candidate_idx on candidate_letters(candidate_id, sent_at desc);

alter table candidate_letters enable row level security;
drop policy if exists candidate_letters_read on candidate_letters;
create policy candidate_letters_read on candidate_letters for select to authenticated using (app.has_perm('recruitment.manage'));
-- no insert / update / delete policies: only the server (secret key) writes the log

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'candidate_letters') then
    alter publication supabase_realtime add table public.candidate_letters;
  end if;
end $$;

-- ##################################################################### 20261031030000_deleted_items.sql
-- =====================================================================================================
-- Rexera CRM · Deleted files: a copy of everything deleted, for IT Support to review. Safe to run more than once.
--  * Whoever deletes something (a document, a lead, a refund, a task, an asset …) writes its copy here first — their
--    own copies only, never changed afterwards.
--  * Only IT Support reads the copies (IT Support dashboard → Deleted files) and deletes them for good; the stored
--    files that belonged to them are removed only then.
-- =====================================================================================================
create table if not exists deleted_items (
  id          text primary key,
  module      text not null,
  kind        text not null,
  label       text not null,
  rows        integer not null default 1,
  data        jsonb,
  files       jsonb,
  deleted_by  text references app_users(id) on delete set null,
  deleted_at  timestamptz not null default now()
);
create index if not exists deleted_items_at_idx on deleted_items(deleted_at desc);

alter table deleted_items enable row level security;
drop policy if exists deleted_items_insert on deleted_items;
create policy deleted_items_insert on deleted_items for insert to authenticated with check (app.is_staff() and deleted_by = app.current_user_id());
drop policy if exists deleted_items_read on deleted_items;
create policy deleted_items_read on deleted_items for select to authenticated using (app.has_role('it'));
drop policy if exists deleted_items_delete on deleted_items;
create policy deleted_items_delete on deleted_items for delete to authenticated using (app.has_role('it'));
-- no update policy: a copy is never changed

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'deleted_items') then
    alter publication supabase_realtime add table public.deleted_items;
  end if;
end $$;
