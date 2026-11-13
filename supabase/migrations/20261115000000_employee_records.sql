-- =====================================================================================================
-- Rexera CRM · HR's employee register: private details and attendance marks. Safe to run more than once.
--  * employee_private: gender, personal mobile / email, bank name / account / IFSC and the salary parts — kept out of
--    app_users (which every staff member reads). Seen by the person, HR (employees.manage), Super Admin and IT;
--    changed by HR, Super Admin and IT.
--  * attendance_marks: a day's attendance set by HR or imported from HR's register (P / H / A / L). Payroll uses it
--    over sign-ins for that day. Seen by the person and by those who see everyone's attendance; set by HR / masters.
-- =====================================================================================================
create table if not exists employee_private (
  user_id        text primary key references app_users(id) on delete cascade,
  gender         text,
  personal_phone text,
  personal_email text,
  bank_name      text,
  bank_account   text,
  bank_ifsc      text check (bank_ifsc is null or bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  ctc            numeric(12,2),
  basic          numeric(12,2),
  hra            numeric(12,2),
  allowance      numeric(12,2),
  pf             numeric(12,2),
  pt             numeric(12,2),
  updated_at     timestamptz,
  updated_by     text references app_users(id) on delete set null
);
alter table employee_private enable row level security;
drop policy if exists employee_private_read on employee_private;
create policy employee_private_read on employee_private for select to authenticated
  using (user_id = app.current_user_id() or app.is_master() or app.has_perm('employees.manage'));
drop policy if exists employee_private_write on employee_private;
create policy employee_private_write on employee_private for all to authenticated
  using (app.is_master() or app.has_perm('employees.manage')) with check (app.is_master() or app.has_perm('employees.manage'));

create table if not exists attendance_marks (
  id         text primary key,                      -- "<user id>|<yyyy-mm-dd>": one mark per person per day
  user_id    text not null references app_users(id) on delete cascade,
  day        date not null,
  mark       text not null check (mark in ('P', 'H', 'A', 'L')),
  source     text,
  updated_at timestamptz,
  updated_by text references app_users(id) on delete set null,
  unique (user_id, day)
);
create index if not exists attendance_marks_day_idx on attendance_marks(day);
alter table attendance_marks enable row level security;
drop policy if exists attendance_marks_read on attendance_marks;
create policy attendance_marks_read on attendance_marks for select to authenticated
  using (user_id = app.current_user_id() or app.is_master() or app.has_perm('attendance.all') or app.has_perm('employees.manage'));
drop policy if exists attendance_marks_write on attendance_marks;
create policy attendance_marks_write on attendance_marks for all to authenticated
  using (app.is_master() or app.has_perm('employees.manage')) with check (app.is_master() or app.has_perm('employees.manage'));

do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['employee_private', 'attendance_marks'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
