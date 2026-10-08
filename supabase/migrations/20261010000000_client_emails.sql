-- =====================================================================================================================
-- Rexera CRM · Emails to clients
--  - The Operation team and Admin email the client from the CRM entry (branded templates, sent by the mail server).
--  - Every email is logged on the entry: who, when, to / cc, subject, template and whether it was sent.
--  - Safe to run more than once.
-- =====================================================================================================================

create table if not exists booking_client_emails (
  id text primary key default gen_random_uuid()::text,
  booking_id text not null references bookings(id) on delete cascade,
  sent_by text references app_users(id) on delete set null,
  sent_at timestamptz not null default now(),
  to_email citext not null,
  cc text[] not null default '{}',
  subject text not null check (length(subject) between 1 and 200),
  template text not null,
  status text not null check (status in ('SENT', 'MAIL_APP', 'FAILED')),
  error text
);
create index if not exists booking_client_emails_booking_idx on booking_client_emails(booking_id, sent_at desc);

alter table booking_client_emails enable row level security;
