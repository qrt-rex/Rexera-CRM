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
