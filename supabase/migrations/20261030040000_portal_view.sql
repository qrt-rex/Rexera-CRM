-- =====================================================================================================
-- Rexera CRM · client portal progress for the Operation team, Admin and IT. Safe to run more than once.
--  * portal.view: see EVERY client's portal login, sign-ins, uploads and progress (Client Portal → Progress) —
--    the Operation team and Admin (IT Support and Super Admin hold every permission already). An Admin limited to
--    their own stages keeps seeing only their own files' clients.
--  * Inviting, linking, deactivating and resetting access stay with portal.manage (Super Admin) — unchanged.
-- =====================================================================================================
insert into role_permissions (role, permission) values ('operations', 'portal.view'), ('admin', 'portal.view') on conflict do nothing;

drop policy if exists client_accounts_read on client_accounts;
create policy client_accounts_read on client_accounts for select to authenticated
  using (app.has_perm('portal.manage') or (app.has_perm('portal.view') and not app.stage_only_admin())
    or (app.is_staff() and exists (select 1 from unnest(booking_ids) b(id) where app.can_see_booking(b.id))));

drop policy if exists client_activity_read on client_activity;
create policy client_activity_read on client_activity for select to authenticated
  using (app.has_perm('portal.manage') or (app.has_perm('portal.view') and not app.stage_only_admin())
    or (booking_id is not null and app.can_see_booking(booking_id)));
