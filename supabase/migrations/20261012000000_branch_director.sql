-- =====================================================================================================================
-- Rexera CRM · Branch Director role and branches on people
--  - New role 'branchdirector': runs one or more branches, sees branch-wise and per-sales-person progress, assigns clients.
--  - Every person can belong to a branch (branch-wise reports); a Branch Director can run several (empty = every branch).
--  - Safe to run more than once.
-- =====================================================================================================================

alter type app_role add value if not exists 'branchdirector';

alter table app_users add column if not exists branch_id text;                       -- the branch the person works in
alter table app_users add column if not exists branch_ids text[] not null default '{}'; -- Branch Director: branches they run
create index if not exists app_users_branch_idx on app_users(branch_id);
