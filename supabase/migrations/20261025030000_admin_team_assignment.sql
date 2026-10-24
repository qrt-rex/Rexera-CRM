-- =====================================================================================================
-- Rexera CRM · Operations Dashboard → Team: an Admin given documents there (Pitch Deck, Finance, DPR, Certification,
-- Submission — stored in app_settings.workflow.adminStageAccess) works only on what is assigned to them.
-- Safe to run more than once.
--  * they see only the CRM entries where they are the file's Admin or hold an Admin stage (and those entries' rows);
--  * they can change only their own Admin stages on those entries;
--  * they can't change the workflow settings (where the assignment itself is stored).
-- Admins never set up there, and everyone else, keep the access they had.
-- =====================================================================================================
create or replace function app.stage_only_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    app.user_roles(app.me()) = array['admin']::app_role[]
    and exists (select 1 from app_settings s where s.key = 'workflow' and coalesce(s.value -> 'adminStageAccess', '{}'::jsonb) ? app.me()),
    false)
$$;
grant execute on function app.stage_only_admin() to authenticated, service_role;

create or replace function app.can_see_booking(b_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from bookings b where b.id = b_id and (
      case when app.stage_only_admin() then
        b.admin_id = app.me()
        or exists (select 1 from jsonb_each(coalesce(b.admin_work, '{}'::jsonb)) w where w.value ->> 'assignee' = app.me())
      else
        app.has_perm('bookings.all')
        or b.created_by = app.me()
        or (app.has_perm('bookings.team') and (b.team_lead_id = app.me() or exists (select 1 from app_users u where u.id = b.created_by and u.team_lead_id = app.me())))
      end
    )
  )
$$;

-- their own stages only: any other stage on the entry must stay exactly as it was
create or replace function app.guard_admin_work() returns trigger language plpgsql as $$
declare k text;
begin
  if not app.stage_only_admin() then return new; end if;
  for k in select jsonb_object_keys(coalesce(old.admin_work, '{}'::jsonb) || coalesce(new.admin_work, '{}'::jsonb)) loop
    if coalesce(old.admin_work -> k ->> 'assignee', '') <> app.me() and (old.admin_work -> k) is distinct from (new.admin_work -> k) then
      raise exception 'You can change only the Admin stages assigned to you.';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists guard_admin_work on bookings;
create trigger guard_admin_work before update of admin_work on bookings for each row execute function app.guard_admin_work();

-- client forms (Document Form Builder) belong to the Operation team's work, not theirs
drop policy if exists doc_forms_manage on doc_forms;
create policy doc_forms_manage on doc_forms for all to authenticated using (app.has_perm('forms.manage') and not app.stage_only_admin()) with check (app.has_perm('forms.manage') and not app.stage_only_admin());
drop policy if exists doc_form_submissions_read on doc_form_submissions;
create policy doc_form_submissions_read on doc_form_submissions for select to authenticated using (app.has_perm('forms.manage') and not app.stage_only_admin());
drop policy if exists doc_form_submissions_review on doc_form_submissions;
create policy doc_form_submissions_review on doc_form_submissions for update to authenticated using (app.has_perm('forms.manage') and not app.stage_only_admin()) with check (app.has_perm('forms.manage') and not app.stage_only_admin());

-- the assignment lives in the workflow settings: such an Admin can't change it
drop policy if exists settings_write on app_settings;
create policy settings_write on app_settings for all to authenticated
  using (app.is_master() or (key in ('pf', 'breaks') and app.has_role('hr')) or (key = 'counters' and app.me() is not null) or (key = 'workflow' and app.has_perm('workflow.manage') and not app.stage_only_admin()))
  with check (app.is_master() or (key in ('pf', 'breaks') and app.has_role('hr')) or (key = 'counters' and app.me() is not null) or (key = 'workflow' and app.has_perm('workflow.manage') and not app.stage_only_admin()));
