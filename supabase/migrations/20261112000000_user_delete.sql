-- =====================================================================================================
-- Rexera CRM · Delete a user (Access Management → Users → Delete). Safe to run more than once.
-- A deleted user can never sign in and disappears from every list, while their history stays (client files keep
-- their sales owner, attendance, payroll, messages and the activity log are not touched). "Deleted" in Access
-- Management lists them, with Undo. Rows are never removed: many tables point at the person.
-- =====================================================================================================
alter table app_users add column if not exists deleted_at timestamptz;
alter table app_users add column if not exists deleted_by text references app_users(id) on delete set null;
create index if not exists app_users_deleted_idx on app_users(deleted_at) where deleted_at is not null;
