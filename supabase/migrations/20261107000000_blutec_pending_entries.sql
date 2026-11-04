-- =====================================================================================================
-- Rexera CRM · Client entries from Blutec calls. Safe to run more than once. Needs 20261028000000_client_entries.sql.
--  * A sales person calls from Blutec's own dialer; an Intro or Hot Prospect there becomes a client entry here
--    automatically, marked pending: Blutec has no scheme, pitched price or requirement, so those (and the
--    company, when Blutec doesn't have it) stay empty until the sales person fills them in.
--  * Only pending entries may leave those empty; filling them in clears pending. A pending entry can't become
--    a CRM entry (the app checks; the scheme and price are needed for one anyway).
-- =====================================================================================================
alter table client_entries add column if not exists pending boolean not null default false;

alter table client_entries drop constraint if exists client_entries_company_name_check;
alter table client_entries add constraint client_entries_company_name_check check (pending or length(trim(company_name)) >= 2);
alter table client_entries drop constraint if exists client_entries_scheme_check;
alter table client_entries add constraint client_entries_scheme_check check (pending or length(trim(scheme)) >= 1);
alter table client_entries drop constraint if exists client_entries_requirement_check;
alter table client_entries add constraint client_entries_requirement_check check (pending or length(trim(requirement)) >= 3);
-- a converted entry is never pending
alter table client_entries drop constraint if exists client_entries_pending_not_converted;
alter table client_entries add constraint client_entries_pending_not_converted check (not (pending and status = 'CONVERTED'));
