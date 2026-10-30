-- =====================================================================================================
-- Rexera CRM · Dialer dashboard. Safe to run more than once. Existing rows are not changed.
--  * lead_calls gets three optional columns the dashboard reads: total_sec (the whole Blutec call, ringing included —
--    duration_sec stays the talk time), call_status (Blutec's final status, e.g. completed / no_answer / busy) and
--    wrap_sec (from the end of the call until the agent saved the outcome).
--  * lead_calls can now be updated by the person who made the call: the Blutec call-completed webhook files a call
--    under the same id (bt-<ref>) the agent saves it under, so the agent's save merges into that row instead of
--    making a second one (or failing).
--  * Campaigns given to each sales person (Dialer → IVR campaigns → Dialer campaigns, Super Admin) are kept in the
--    app_settings row "dialerCampaigns"; the server reads it so a sales person only gets their own campaigns.
-- =====================================================================================================
alter table lead_calls add column if not exists total_sec int check (total_sec is null or total_sec >= 0);
alter table lead_calls add column if not exists call_status text;
alter table lead_calls add column if not exists wrap_sec int check (wrap_sec is null or wrap_sec >= 0);

drop policy if exists calls_update on lead_calls;
create policy calls_update on lead_calls for update to authenticated
  using (app.can_see_lead(lead_id) and (called_by = app.me() or called_by is null))
  with check (app.can_see_lead(lead_id) and called_by = app.me());
