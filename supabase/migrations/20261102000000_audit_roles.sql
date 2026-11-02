-- =====================================================================================================
-- Rexera CRM · Activity Log: role, client and before / after on every entry. Safe to run more than once.
--  * role: the person's role(s) when they did it · ref: the CRM entry it is about · before_value / after_value: changes.
--  * The log stays append-only: nobody can change or delete an entry (there are no update / delete rules).
-- =====================================================================================================
alter table audit_log add column if not exists role         text;
alter table audit_log add column if not exists ref          text;
alter table audit_log add column if not exists before_value text;
alter table audit_log add column if not exists after_value  text;
create index if not exists audit_log_ref_idx on audit_log(ref) where ref is not null;
