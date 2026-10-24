-- =====================================================================================================
-- Rexera CRM · job application forms: the position HR is hiring for (BDM, BDE, Admin, Operation Team Member, HR …),
-- shown chosen on the candidate's form. Safe to run more than once.
-- =====================================================================================================
alter table candidate_forms add column if not exists position text check (position is null or length(position) <= 120);
