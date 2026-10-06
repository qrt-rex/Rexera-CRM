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
