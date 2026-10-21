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
