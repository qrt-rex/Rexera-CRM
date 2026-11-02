-- =====================================================================================================
-- Rexera CRM · sent messages can't be changed. Safe to run more than once.
--  * Clients are messaged only by WhatsApp and email: client_messages, invoice_shares and candidate_letters already
--    allow only those two channels and are written only by the server (no browser can add, edit or delete a row).
--  * booking_client_emails (the emails sent from a CRM entry) was "for all": anyone who could see the entry could also
--    edit or delete what was sent. Now it can be read and added to (as the sender, by email only) — never edited or
--    deleted, by Sales or anyone else. A whole CRM entry deleted by a Super Admin still takes its log with it (cascade).
-- =====================================================================================================
drop policy if exists client_emails_all on booking_client_emails;
drop policy if exists client_emails_read on booking_client_emails;
drop policy if exists client_emails_insert on booking_client_emails;

create policy client_emails_read on booking_client_emails for select to authenticated
  using (app.can_see_booking(booking_id));
create policy client_emails_insert on booking_client_emails for insert to authenticated
  with check (app.can_see_booking(booking_id) and sent_by = app.me());
-- no update / delete policy: a sent email stays exactly as it was sent
