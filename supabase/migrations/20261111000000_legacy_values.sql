-- =====================================================================================================
-- Rexera CRM · Old CRM data keeps its exact values. Safe to run more than once.
-- The old CRM has a few client files and payments with values the new CRM never allows for new work (a negative or
-- zero total, a zero or negative payment line). Copied from the old CRM (legacy_id set / ids starting "lg-") they are
-- kept exactly as they were — the import checks that the totals match the old CRM — instead of being refused.
-- New files and payments made in this CRM keep the strict rules.
-- =====================================================================================================
alter table bookings drop constraint if exists bookings_total_quoted_check;
alter table bookings add constraint bookings_total_quoted_check check (total_quoted > 0 or legacy_id is not null);

alter table booking_payments drop constraint if exists booking_payments_amount_check;
alter table booking_payments add constraint booking_payments_amount_check check (amount > 0 or (is_adjustment and amount <> 0) or id like 'lg-%');
