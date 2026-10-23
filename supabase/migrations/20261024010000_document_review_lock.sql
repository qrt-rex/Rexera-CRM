-- =====================================================================================================
-- Rexera CRM · client documents: who verified / rejected each one, and that decision is final — only a Super Admin can
-- change a verified or rejected document. The database records the reviewer itself (it can't be typed in by hand).
-- Safe to run more than once.
-- =====================================================================================================
alter table booking_documents add column if not exists reviewed_by text references app_users(id) on delete set null;
alter table booking_documents add column if not exists reviewed_at timestamptz;

create or replace function app.booking_document_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- the server (secret key) and the SQL editor are not limited
  if auth.uid() is null then return new; end if;
  if new.status is not distinct from old.status then
    -- no status change: the reviewer stays as recorded (only a Super Admin may correct it)
    if not app.has_role('superadmin') then new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at; end if;
    return new;
  end if;
  if old.status in ('VERIFIED', 'REJECTED') and not app.has_role('superadmin') then
    raise exception 'This document was already % — only a Super Admin can change it.', lower(old.status::text) using errcode = '42501';
  end if;
  new.reviewed_by := app.me();
  new.reviewed_at := now();
  return new;
end $$;
drop trigger if exists booking_documents_review on booking_documents;
create trigger booking_documents_review before update on booking_documents for each row execute function app.booking_document_review();
