-- =====================================================================================================
-- Rexera CRM · job applications: position applied for, Internship / Fresher / Employee (experienced), current CTC
-- (experienced only) and the preferred interview date & time (India time, YYYY-MM-DDTHH:mm). Safe to run more than once.
-- =====================================================================================================
alter table candidate_applications add column if not exists position text check (position is null or length(position) <= 120);
alter table candidate_applications add column if not exists candidate_type text check (candidate_type is null or candidate_type in ('INTERNSHIP', 'FRESHER', 'EXPERIENCED'));
alter table candidate_applications add column if not exists current_ctc text check (current_ctc is null or length(current_ctc) <= 60);
alter table candidate_applications add column if not exists interview_at text check (interview_at is null or interview_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$');
create index if not exists candidate_applications_interview_idx on candidate_applications(interview_at);
