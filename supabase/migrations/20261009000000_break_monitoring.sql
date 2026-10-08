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
