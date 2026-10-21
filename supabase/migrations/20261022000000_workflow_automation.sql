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
