-- =====================================================================================================
-- Rexera CRM · invoice remarks, printed on the invoice (preview, print and PDF). Safe to run more than once.
-- An invoice is issued from the branch of the person who creates it (set by the app; no branch is picked by hand).
-- =====================================================================================================
alter table invoices add column if not exists remarks text check (remarks is null or length(remarks) <= 1000);
