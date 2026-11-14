-- =====================================================================================================
-- Rexera CRM · custom employee fields from HR's sheets. Safe to run more than once.
--  * Any column of an imported employee sheet that the CRM has no field for becomes a custom employee field (made by
--    the import itself): its definition (name, type) in app_settings 'employeeFields', the values per person in
--    employee_private.custom — private like the rest of HR's register (the person, HR, Super Admin, IT).
--  * HR (employees.manage) may now save 'employeeFields'; everything else in settings_write is as before.
-- =====================================================================================================
alter table employee_private add column if not exists custom jsonb not null default '{}'::jsonb;

drop policy if exists settings_write on app_settings;
create policy settings_write on app_settings for all to authenticated
  using (app.is_master() or (key in ('pf', 'breaks') and app.has_role('hr')) or (key = 'counters' and app.me() is not null) or (key = 'workflow' and app.has_perm('workflow.manage') and not app.stage_only_admin())
    or (key = 'clientTemplates' and (app.has_role('operations') or app.has_role('admin')) and not app.stage_only_admin())
    or (key = 'employeeFields' and app.has_perm('employees.manage')))
  with check (app.is_master() or (key in ('pf', 'breaks') and app.has_role('hr')) or (key = 'counters' and app.me() is not null) or (key = 'workflow' and app.has_perm('workflow.manage') and not app.stage_only_admin())
    or (key = 'clientTemplates' and (app.has_role('operations') or app.has_role('admin')) and not app.stage_only_admin())
    or (key = 'employeeFields' and app.has_perm('employees.manage')));
