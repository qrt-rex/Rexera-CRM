-- Client portal, step 1: client logins are Supabase "authenticated" users too, so everything that any signed-in
-- account could read is narrowed to CRM staff (a signed-in account linked to an active app_users row). Clients reach
-- their own data only through the server (/api/portal/*), never these tables.
create or replace function app.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select app.current_user_id() is not null
$$;
grant execute on function app.is_staff() to authenticated, service_role;

drop policy if exists users_read on app_users;
create policy users_read on app_users for select to authenticated using (app.is_staff());
drop policy if exists extra_roles_read on user_extra_roles;
create policy extra_roles_read on user_extra_roles for select to authenticated using (app.is_staff());
drop policy if exists role_perms_read on role_permissions;
create policy role_perms_read on role_permissions for select to authenticated using (app.is_staff());
drop policy if exists services_read on services;
create policy services_read on services for select to authenticated using (app.is_staff());
drop policy if exists schemes_read on schemes;
create policy schemes_read on schemes for select to authenticated using (app.is_staff() and (active or app.has_perm('schemes.manage')));
drop policy if exists broadcasts_read on broadcasts;
create policy broadcasts_read on broadcasts for select to authenticated using (app.is_staff() and (audience is null or app.user_roles(app.me()) && audience or app.has_perm('broadcasts.manage')));
drop policy if exists acks_read on broadcast_acks;
create policy acks_read on broadcast_acks for select to authenticated using (app.is_staff());
drop policy if exists events_read on events;
create policy events_read on events for select to authenticated using (app.is_staff());
drop policy if exists runs_read on payroll_runs;
create policy runs_read on payroll_runs for select to authenticated using (app.has_perm('payroll.view') or (app.is_staff() and status in ('FINALIZED','PAID')));
drop policy if exists rules_read on incentive_rule_versions;
create policy rules_read on incentive_rule_versions for select to authenticated using (app.is_staff());
drop policy if exists templates_read on message_templates;
create policy templates_read on message_templates for select to authenticated using (app.is_staff());
drop policy if exists automations_read on email_automations;
create policy automations_read on email_automations for select to authenticated using (app.is_staff());
drop policy if exists settings_read on app_settings;
create policy settings_read on app_settings for select to authenticated using (app.is_staff());
drop policy if exists sales_kit_read on sales_kit;
create policy sales_kit_read on sales_kit for select to authenticated using (app.is_staff());
drop policy if exists notices_insert on notifications;
create policy notices_insert on notifications for insert to authenticated with check (app.is_staff());
drop policy if exists audit_insert on audit_log;
create policy audit_insert on audit_log for insert to authenticated with check (app.is_staff() and (by_user = app.me() or by_user is null));

-- CRM files: staff only (a client gets a short-lived link to their own files from the server)
drop policy if exists crm_files_read on storage.objects;
create policy crm_files_read on storage.objects for select to authenticated using (bucket_id = 'crm-files' and app.is_staff());
drop policy if exists crm_files_add on storage.objects;
create policy crm_files_add on storage.objects for insert to authenticated with check (bucket_id = 'crm-files' and app.is_staff());
