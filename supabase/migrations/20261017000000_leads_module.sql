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
