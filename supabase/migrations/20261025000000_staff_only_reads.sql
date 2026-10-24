-- Staff-only reads for directory and settings tables.
--
-- These policies were `to authenticated using (true)`: fine while only staff could sign in, but
-- the website client portal signs clients in to the same Supabase project. A signed-in client
-- must never see the staff directory (salaries, phones, addresses), settings, templates or
-- incentive rules, so each read now requires an active CRM user (app.me() is null for anyone
-- who is not one). Safe to run again.

drop policy if exists settings_read on app_settings;
create policy settings_read on app_settings for select to authenticated using (app.me() is not null);

drop policy if exists users_read on app_users;
create policy users_read on app_users for select to authenticated using (app.me() is not null);

drop policy if exists acks_read on broadcast_acks;
create policy acks_read on broadcast_acks for select to authenticated using (app.me() is not null);

drop policy if exists automations_read on email_automations;
create policy automations_read on email_automations for select to authenticated using (app.me() is not null);

drop policy if exists events_read on events;
create policy events_read on events for select to authenticated using (app.me() is not null);

drop policy if exists rules_read on incentive_rule_versions;
create policy rules_read on incentive_rule_versions for select to authenticated using (app.me() is not null);

drop policy if exists templates_read on message_templates;
create policy templates_read on message_templates for select to authenticated using (app.me() is not null);

drop policy if exists role_perms_read on role_permissions;
create policy role_perms_read on role_permissions for select to authenticated using (app.me() is not null);

drop policy if exists sales_kit_read on sales_kit;
create policy sales_kit_read on sales_kit for select to authenticated using (app.me() is not null);

drop policy if exists services_read on services;
create policy services_read on services for select to authenticated using (app.me() is not null);

drop policy if exists extra_roles_read on user_extra_roles;
create policy extra_roles_read on user_extra_roles for select to authenticated using (app.me() is not null);

-- CRM file storage: staff only (clients get their own files through the portal's narrower policy).
drop policy if exists crm_files_read on storage.objects;
create policy crm_files_read on storage.objects for select to authenticated
    using (bucket_id = 'crm-files' and app.me() is not null);

drop policy if exists crm_files_add on storage.objects;
create policy crm_files_add on storage.objects for insert to authenticated
    with check (bucket_id = 'crm-files' and app.me() is not null);
