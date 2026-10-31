-- =====================================================================================================
-- Rexera CRM · client portal: the Legal team also sees it; client logins are IT Support's. Safe to run more than once.
--  * portal.view (Client Portal → Progress, Accounts, Activity, read-only) now also for Legal — with the Operation
--    team and Admin (Super Admin and IT Support hold every permission already).
--  * Creating a client's login (ID + password), new passwords, linking entries and deactivating are done by IT Support
--    only: the live server (/api/portal-admin, server/portal.mjs) refuses everyone else, the Super Admin included.
-- =====================================================================================================
insert into role_permissions (role, permission) values ('legal', 'portal.view') on conflict do nothing;
