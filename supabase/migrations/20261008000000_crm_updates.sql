-- =====================================================================================================================
-- Rexera CRM · CRM updates
--  - Workflow: Admin finishes client work → "Pending Operations approval" (OPS_REVIEW) → Operations approves → Completed
--  - 11 work stages (adds "Company Information Under Process" and "Hold – Client Not Responding")
--  - New CRM entry fields: several services with price bifurcation, combo period, payment contact, booking date,
--    after-discount success fee, remarks, closed by; payment proofs and documents as stored files
--  - Task reminders every 15 days · invoice branch + both parties' details · documents shared in messages
--  - Safe to run more than once.
-- =====================================================================================================================

alter type booking_status add value if not exists 'OPS_REVIEW' after 'WITH_ADMIN';

alter table bookings drop constraint if exists bookings_stage_check;
alter table bookings add constraint bookings_stage_check check (stage between 1 and 11);
alter table bookings drop constraint if exists bookings_max_stage_check;
alter table bookings add constraint bookings_max_stage_check check (max_stage between 1 and 11);
alter table booking_stage_moves drop constraint if exists booking_stage_moves_stage_check;
alter table booking_stage_moves add constraint booking_stage_moves_stage_check check (stage between 1 and 11);

alter table bookings add column if not exists services jsonb;          -- [{ serviceId, name, price }]
alter table bookings add column if not exists combo jsonb;             -- { months, startedOn, deadline, deadlineNotified }
alter table bookings add column if not exists payment_contact text check (payment_contact is null or payment_contact ~ '^[0-9]{10}$');
alter table bookings add column if not exists payment_email citext;
alter table bookings add column if not exists booking_date date;
alter table bookings add column if not exists success_fee jsonb;       -- { type: 'AMOUNT' | 'PCT', value }
alter table bookings add column if not exists remarks text;
alter table bookings add column if not exists closed_by text references app_users(id) on delete set null;

alter table booking_payments add column if not exists proof jsonb;     -- stored file { id, name, type, size, at }
alter table booking_documents add column if not exists file jsonb;

alter table booking_tasks add column if not exists remind_every_days smallint check (remind_every_days is null or remind_every_days > 0);
alter table booking_tasks add column if not exists last_reminded_at timestamptz;
alter table booking_tasks add column if not exists created_at timestamptz not null default now();

alter table invoices add column if not exists branch_id text;
alter table invoices add column if not exists client_address text;
alter table invoices add column if not exists client_pan text;

alter table messages add column if not exists attachments jsonb;       -- [{ id, name, type, size, at }]
