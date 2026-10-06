-- =====================================================================================================================
-- Rexera CRM · records imported from the old PHP CRM (u417368936_crm)
--  - Keeps every original column (legacy jsonb) so the import stays lossless in the cloud too.
--  - New entries keep the strict checks; rows imported from the old CRM (legacy_id is not null) are stored exactly as
--    they were, even where the old system allowed things the new one doesn't (short mobiles, odd PANs, ₹0 quotes,
--    small negative rounding adjustments).
--  - Safe to run more than once.
-- =====================================================================================================================

-- ------------------------------------------------------------------ people
alter table app_users add column if not exists legacy_id int unique;
alter table app_users add column if not exists legacy_role text;
alter table app_users add column if not exists needs_password_reset boolean not null default false;
alter table app_users drop constraint if exists app_users_phone_check;
alter table app_users add constraint app_users_phone_check check (phone is null or phone ~ '^[6-9][0-9]{9}$' or legacy_id is not null);
alter table app_users drop constraint if exists app_users_name_check;
alter table app_users add constraint app_users_name_check check (length(trim(name)) >= 2 or legacy_id is not null);

-- ------------------------------------------------------------------ leads
alter table leads add column if not exists legacy jsonb;
alter table leads drop constraint if exists leads_phone_check;
alter table leads add constraint leads_phone_check check (phone ~ '^[0-9]{10}$' or legacy is not null);
-- the old CRM allowed the same number on several leads; keep the number unique for new leads only
alter table leads drop constraint if exists leads_phone_key;
create unique index if not exists leads_phone_new_uidx on leads(phone) where legacy is null;
create index if not exists leads_phone_idx on leads(phone);

-- ------------------------------------------------------------------ client files
alter table bookings add column if not exists legacy_id int unique;
-- { crm: {...every column...}, workflow: {...}, deductions: [...] } exactly as in the old database
alter table bookings add column if not exists legacy jsonb;
alter table bookings drop constraint if exists bookings_mobile_check;
alter table bookings add constraint bookings_mobile_check check (mobile ~ '^[0-9]{10}$' or legacy_id is not null);
alter table bookings drop constraint if exists bookings_pan_check;
alter table bookings add constraint bookings_pan_check check (pan is null or pan = '' or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$' or legacy_id is not null);
alter table bookings drop constraint if exists bookings_gstin_check;
alter table bookings add constraint bookings_gstin_check check (gstin is null or gstin = '' or length(gstin) = 15 or legacy_id is not null);
alter table bookings drop constraint if exists bookings_total_quoted_check;
alter table bookings add constraint bookings_total_quoted_check check (total_quoted > 0 or (legacy_id is not null and total_quoted >= 0));
-- client details the old CRM recorded
alter table bookings add column if not exists address text;
alter table bookings add column if not exists website text;
alter table bookings add column if not exists cin text;
alter table bookings add column if not exists startup_contact jsonb;   -- { phone, email }
alter table bookings add column if not exists billing jsonb;           -- invoice-to { name, pan, gstin, contact, email }
alter table bookings add column if not exists owner_name text;         -- closer's name when not a CRM user
create index if not exists bookings_legacy_idx on bookings(legacy_id) where legacy_id is not null;

-- payments: the old CRM has a few tiny negative amounts (rounding fixes); they are imported as adjustments
alter table booking_payments add column if not exists is_adjustment boolean not null default false;
alter table booking_payments add column if not exists date_unknown boolean not null default false;  -- old CRM had no date; paid_on = booking day
alter table booking_payments drop constraint if exists booking_payments_amount_check;
alter table booking_payments add constraint booking_payments_amount_check check (amount > 0 or (is_adjustment and amount <> 0));

-- documents: the file stays on the old server until copied; legacy_path says where it was
alter table booking_documents add column if not exists legacy_path text;
