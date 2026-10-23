-- =====================================================================================================
-- Rexera CRM · job applications: the branch the candidate applies for (Ahmedabad - Kargil, Ahmedabad - Riverfront
-- (Altimus), Vadodara). Applicants send it with the public form (anon insert is already allowed). Safe to run more than once.
-- =====================================================================================================
alter table candidate_applications add column if not exists branch text check (branch is null or length(branch) <= 100);
create index if not exists candidate_applications_branch_idx on candidate_applications(branch);
