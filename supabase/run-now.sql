-- =====================================================================================================
-- Rexera CRM · migrations to run on the live Supabase project (2026-10-15 … 2026-10-23, in order).
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
