-- =====================================================================================================
-- Rexera CRM · several Admin members on one client file. Safe to run more than once.
--  * bookings.admin_ids: the file's other Admin members, next to its main Admin (admin_id). The Operations Team adds,
--    removes or changes them at any time from the CRM entry.
--  * Every Admin member works the file like the main Admin: sees it (also an Admin limited to their own files in
--    Operations Dashboard → Team) and may move it on (complete, hold, return to Operations, resume).
-- Nothing else changes: files with one Admin keep working as before (admin_ids stays empty).
-- =====================================================================================================
alter table bookings add column if not exists admin_ids text[] not null default '{}';
create index if not exists bookings_admin_ids_idx on bookings using gin (admin_ids);

create or replace function app.can_see_booking(b_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from bookings b where b.id = b_id and (
      case when app.stage_only_admin() then
        b.admin_id = app.me()
        or app.me() = any(b.admin_ids)
        or exists (select 1 from jsonb_each(coalesce(b.admin_work, '{}'::jsonb)) w where w.value ->> 'assignee' = app.me())
      else
        app.has_perm('bookings.all')
        or b.created_by = app.me()
        or (app.has_perm('bookings.team') and (b.team_lead_id = app.me() or exists (select 1 from app_users u where u.id = b.created_by and u.team_lead_id = app.me())))
      end
    )
  )
$$;

create or replace function app.booking_status_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me   text := app.me();
  step text := old.status::text || '>' || new.status::text;
  ok   boolean;
  -- the file's main Admin or one of its Admin members
  file_admin boolean := app.has_perm('bookings.admin') and (old.admin_id = me or me = any(coalesce(old.admin_ids, '{}')));
begin
  if new.status = old.status or auth.uid() is null or app.is_master() then return new; end if;
  ok := case
    when step in ('PENDING_TL>PENDING_ACCOUNTS', 'PENDING_TL>REJECTED')
      then app.has_perm('bookings.approve_tl') and old.team_lead_id = me
    when step in ('PENDING_ACCOUNTS>PENDING_LEGAL', 'PENDING_ACCOUNTS>ACCOUNTS_HOLD', 'PENDING_ACCOUNTS>REJECTED', 'ACCOUNTS_HOLD>PENDING_LEGAL', 'ACCOUNTS_HOLD>REJECTED')
      then app.has_perm('bookings.accounts')
    when step in ('PENDING_LEGAL>IN_OPERATIONS', 'PENDING_LEGAL>CHANGES_REQUIRED', 'PENDING_LEGAL>REJECTED')
      then app.has_perm('bookings.legal')
    when step in ('CHANGES_REQUIRED>PENDING_LEGAL', 'REJECTED>PENDING_ACCOUNTS', 'REJECTED>PENDING_TL')
      then old.created_by = me
    when step in ('IN_OPERATIONS>WITH_ADMIN', 'IN_OPERATIONS>ON_HOLD', 'OPS_REVIEW>COMPLETED', 'OPS_REVIEW>WITH_ADMIN')
      then app.has_perm('bookings.process') and old.ops_member_id = me
    when step in ('WITH_ADMIN>OPS_REVIEW', 'WITH_ADMIN>ON_HOLD', 'WITH_ADMIN>IN_OPERATIONS')
      then file_admin
    when step in ('ON_HOLD>IN_OPERATIONS', 'ON_HOLD>WITH_ADMIN')
      then (app.has_perm('bookings.process') and old.ops_member_id = me) or file_admin
    when step = 'COMPLETED>IN_OPERATIONS'   -- re-opened by moving the stage back
      then app.has_perm('bookings.process') or app.has_perm('bookings.admin')
    else false
  end;
  if not coalesce(ok, false) then
    raise exception 'Moving this file from % to % is not allowed for you.', old.status, new.status using errcode = '42501';
  end if;
  return new;
end $$;
