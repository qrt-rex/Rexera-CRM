-- =====================================================================================================
-- Rexera CRM · HR Form Builder: forms HR makes for employees, each employee's submission, HR's internal notes and
-- the uploaded files. Safe to run more than once.
--  * hr_forms: the form (fields as JSON, versions, who it is assigned to, deadline). HR (hrforms.manage), Super Admin
--    and IT create / change them; every staff member reads the published ones (drafts: HR only).
--  * hr_form_submissions: one per employee per form, with the fields as they were when it was filled (editing the
--    form later never changes an answer). The employee reads and fills their own; HR reads and reviews all.
--    A guard checks every step an employee makes: only their own, only while the form is open (published, before
--    the deadline) or HR asked for a correction, and never the review fields.
--  * hr_form_notes: HR's internal comments — never visible to the employee.
--  * hr-form-files: private storage. A file's name starts with hrf-<employee id>~ : the employee uploads, reads and
--    removes only their own; HR reads all. 25 MB per file (each field can set less).
-- =====================================================================================================
insert into role_permissions (role, permission) values ('hr', 'hrforms.manage') on conflict do nothing;

create table if not exists hr_forms (
  id           text primary key,
  title        text not null,
  description  text,
  status       text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED')),
  fields       jsonb not null default '[]'::jsonb,
  version      int not null default 1,
  versions     jsonb not null default '[]'::jsonb,
  assign       jsonb not null default '{}'::jsonb,
  deadline     date,
  allow_draft  boolean not null default true,
  reviewer_ids text[] not null default '{}',
  created_by   text references app_users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  updated_by   text references app_users(id) on delete set null,
  published_at timestamptz
);
alter table hr_forms enable row level security;
drop policy if exists hr_forms_read on hr_forms;
create policy hr_forms_read on hr_forms for select to authenticated
  using (app.is_master() or app.has_perm('hrforms.manage') or (app.is_staff() and status <> 'DRAFT'));
drop policy if exists hr_forms_write on hr_forms;
create policy hr_forms_write on hr_forms for all to authenticated
  using (app.is_master() or app.has_perm('hrforms.manage')) with check (app.is_master() or app.has_perm('hrforms.manage'));

create table if not exists hr_form_submissions (
  id           text primary key,
  -- forms are archived, never deleted: a submission always keeps its form
  form_id      text not null references hr_forms(id) on delete restrict,
  form_version int not null default 1,
  user_id      text not null references app_users(id) on delete cascade,
  status       text not null default 'IN_PROGRESS' check (status in ('IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED')),
  fields       jsonb not null default '[]'::jsonb,
  answers      jsonb not null default '{}'::jsonb,
  started_at   timestamptz not null default now(),
  updated_at   timestamptz,
  submitted_at timestamptz,
  reviewed_by  text references app_users(id) on delete set null,
  reviewed_at  timestamptz,
  review_note  text,
  history      jsonb not null default '[]'::jsonb,
  unique (form_id, user_id)
);
create index if not exists hr_form_submissions_user_idx on hr_form_submissions(user_id);
create index if not exists hr_form_submissions_form_idx on hr_form_submissions(form_id, status);
alter table hr_form_submissions enable row level security;
drop policy if exists hr_form_subs_read on hr_form_submissions;
create policy hr_form_subs_read on hr_form_submissions for select to authenticated
  using (user_id = app.me() or app.is_master() or app.has_perm('hrforms.manage'));
drop policy if exists hr_form_subs_insert on hr_form_submissions;
create policy hr_form_subs_insert on hr_form_submissions for insert to authenticated
  with check (user_id = app.me() or app.is_master() or app.has_perm('hrforms.manage'));
drop policy if exists hr_form_subs_update on hr_form_submissions;
create policy hr_form_subs_update on hr_form_submissions for update to authenticated
  using (user_id = app.me() or app.is_master() or app.has_perm('hrforms.manage'))
  with check (user_id = app.me() or app.is_master() or app.has_perm('hrforms.manage'));
drop policy if exists hr_form_subs_delete on hr_form_submissions;
create policy hr_form_subs_delete on hr_form_submissions for delete to authenticated
  using (app.is_master() or app.has_perm('hrforms.manage'));

-- the steps an employee may take (HR, Super Admin, IT and the server pass)
create or replace function app.guard_hr_form_submission() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  f hr_forms%rowtype;
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is null or app.is_master() or app.has_perm('hrforms.manage') then return new; end if;
  if new.user_id is distinct from app.me() then raise exception 'You can only fill in your own forms.'; end if;
  select * into f from hr_forms where id = new.form_id;
  if not found then raise exception 'This form does not exist.'; end if;
  if tg_op = 'INSERT' then
    -- the app saves with "insert … on conflict update": an existing submission is checked by the update branch
    if exists (select 1 from hr_form_submissions s where s.id = new.id) then return new; end if;
    if new.status not in ('IN_PROGRESS', 'SUBMITTED') then raise exception 'A new form can only be saved as a draft or submitted.'; end if;
    if f.status <> 'PUBLISHED' then raise exception 'This form is not open.'; end if;
    if f.deadline is not null and f.deadline < today then raise exception 'The deadline for this form has passed.'; end if;
    new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;
    return new;
  end if;
  if new.form_id is distinct from old.form_id or new.user_id is distinct from old.user_id then raise exception 'A submission stays with its form and employee.'; end if;
  if old.status not in ('IN_PROGRESS', 'CHANGES_REQUESTED') then raise exception 'This form was already sent to HR — it can''t be changed now.'; end if;
  if not (new.status = 'SUBMITTED' or new.status = old.status) then raise exception 'You can save a draft or submit — HR does the review.'; end if;
  if old.status = 'IN_PROGRESS' and (f.status <> 'PUBLISHED' or (f.deadline is not null and f.deadline < today)) then
    raise exception 'This form is closed (unpublished or past its deadline).';
  end if;
  -- the review stays as HR left it
  new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at; new.review_note := old.review_note;
  return new;
end $$;
drop trigger if exists guard_hr_form_submission on hr_form_submissions;
create trigger guard_hr_form_submission before insert or update on hr_form_submissions for each row execute function app.guard_hr_form_submission();

create table if not exists hr_form_notes (
  id            text primary key,
  submission_id text not null references hr_form_submissions(id) on delete cascade,
  by_user       text references app_users(id) on delete set null,
  at            timestamptz not null default now(),
  body          text not null
);
create index if not exists hr_form_notes_sub_idx on hr_form_notes(submission_id);
alter table hr_form_notes enable row level security;
drop policy if exists hr_form_notes_all on hr_form_notes;
create policy hr_form_notes_all on hr_form_notes for all to authenticated
  using (app.is_master() or app.has_perm('hrforms.manage')) with check (app.is_master() or app.has_perm('hrforms.manage'));

-- files: private; hrf-<employee id>~<random>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-form-files', 'hr-form-files', false, 26214400, null)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
drop policy if exists hr_form_files_read on storage.objects;
create policy hr_form_files_read on storage.objects for select to authenticated using (
  bucket_id = 'hr-form-files' and (starts_with(name, 'hrf-' || app.me() || '~') or app.is_master() or app.has_perm('hrforms.manage')));
drop policy if exists hr_form_files_add on storage.objects;
create policy hr_form_files_add on storage.objects for insert to authenticated with check (
  bucket_id = 'hr-form-files' and app.is_staff() and starts_with(name, 'hrf-' || app.me() || '~'));
drop policy if exists hr_form_files_remove on storage.objects;
create policy hr_form_files_remove on storage.objects for delete to authenticated using (
  bucket_id = 'hr-form-files' and (starts_with(name, 'hrf-' || app.me() || '~') or app.is_master() or app.has_perm('hrforms.manage')));

do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['hr_forms', 'hr_form_submissions', 'hr_form_notes'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
