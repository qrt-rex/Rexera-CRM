-- =====================================================================================================================
-- Rexera CRM · Part payments 2, 3, 4 … are added only by Accounts (a CRM entry is made with part 1, the advance).
-- Safe to run more than once.
-- =====================================================================================================================
drop policy if exists b_payments_later_parts on booking_payments;
create policy b_payments_later_parts on booking_payments as restrictive for insert to authenticated
  with check (part = 1 or app.has_perm('bookings.accounts'));
