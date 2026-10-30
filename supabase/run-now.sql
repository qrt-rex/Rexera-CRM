-- =====================================================================================================
-- Rexera CRM · migrations to run on the live Supabase project (2026-10-15 … 2026-10-30, in order).
-- Paste all of it into Supabase → SQL Editor → Run. Each part is safe to run more than once.
-- Generated from supabase/migrations/.
-- =====================================================================================================


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
