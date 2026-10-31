-- =====================================================================================================
-- Rexera CRM · refund requests. Safe to run more than once.
--  * Sales, Team Leaders, Operations, Legal and Admin ask for a refund on a client they can open (refunds.request):
--    a new PENDING row, theirs, with the payments, reason and supporting documents — nothing else.
--  * Only Accounts (refunds.manage) approves, rejects and completes refunds, and changes or deletes a row.
--  * A completed refund needs its proof (receipt, transaction screenshot or bank confirmation).
--  * Everyone who may ask sees the refunds of the clients they can open (their status and history).
-- =====================================================================================================
alter table booking_refunds drop constraint if exists booking_refunds_status_check;
alter table booking_refunds add constraint booking_refunds_status_check check (status in ('PENDING', 'APPROVED', 'REJECTED', 'REFUNDED'));
alter table booking_refunds add column if not exists payment_ids  jsonb;
alter table booking_refunds add column if not exists documents    jsonb;
alter table booking_refunds add column if not exists proof        jsonb;
alter table booking_refunds add column if not exists review_note  text;
alter table booking_refunds add column if not exists reviewed_by  text references app_users(id) on delete set null;
alter table booking_refunds add column if not exists reviewed_at  timestamptz;
alter table booking_refunds add column if not exists completed_by text references app_users(id) on delete set null;
alter table booking_refunds add column if not exists completed_at timestamptz;
alter table booking_refunds add column if not exists history      jsonb;
-- refunds completed before this change have no proof: the rule applies to new and changed rows
alter table booking_refunds drop constraint if exists booking_refunds_completed_proof;
alter table booking_refunds add constraint booking_refunds_completed_proof
  check (status <> 'REFUNDED' or created_at < '2026-10-31' or (jsonb_typeof(proof) = 'array' and jsonb_array_length(proof) > 0 and coalesce(length(trim(ref)), 0) >= 3)) not valid;

insert into role_permissions (role, permission) values
  ('sales', 'refunds.request'), ('teamlead', 'refunds.request'), ('operations', 'refunds.request'), ('legal', 'refunds.request'), ('admin', 'refunds.request')
on conflict do nothing;

drop policy if exists booking_refunds_accounts on booking_refunds;
drop policy if exists booking_refunds_read on booking_refunds;
create policy booking_refunds_read on booking_refunds for select to authenticated
  using (app.has_perm('refunds.manage') or (app.has_perm('refunds.request') and app.can_see_booking(booking_id)));
drop policy if exists booking_refunds_request on booking_refunds;
create policy booking_refunds_request on booking_refunds for insert to authenticated
  with check (app.can_see_booking(booking_id) and (app.has_perm('refunds.manage') or (
    app.has_perm('refunds.request') and status = 'PENDING' and created_by = app.current_user_id()
    and reviewed_by is null and completed_by is null and proof is null and refunded_on is null and ref is null)));
drop policy if exists booking_refunds_update on booking_refunds;
create policy booking_refunds_update on booking_refunds for update to authenticated
  using (app.has_perm('refunds.manage')) with check (app.has_perm('refunds.manage') and app.can_see_booking(booking_id));
drop policy if exists booking_refunds_delete on booking_refunds;
create policy booking_refunds_delete on booking_refunds for delete to authenticated using (app.has_perm('refunds.manage'));
