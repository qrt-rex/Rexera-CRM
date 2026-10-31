-- =====================================================================================================
-- Rexera CRM · client communication (WhatsApp / email to clients). Safe to run more than once.
--  * client_messages: every message sent to a client — content, sender, recipient, channel, time, status, error.
--    ONLY the live server writes it (POST /api/client-message, with the service key), after checking the sender's
--    team, the step of the file and the recipient saved on the record — a browser can't add or change a row.
--    Read by the Operation Team, Admin, Super Admin and IT (every message), and by anyone who can see the CRM entry /
--    client entry it is about.
--  * client_entries.email: optional, for the Sales Team's welcome email.
--  * app_settings 'clientTemplates': the message templates — edited by the Operation Team and Admin (and masters).
-- =====================================================================================================
alter table client_entries add column if not exists email text check (email is null or email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$');

create table if not exists client_messages (
  id              text primary key,
  booking_id      text references bookings(id) on delete cascade,
  client_entry_id text references client_entries(id) on delete cascade,
  stage           text not null,
  channel         text not null check (channel in ('EMAIL', 'WHATSAPP')),
  to_addr         text not null,
  subject         text,
  body            text not null check (length(body) <= 6000),
  status          text not null check (status in ('SENT', 'MANUAL', 'FAILED', 'NOT_CONFIGURED')),
  error           text,
  sent_by         text references app_users(id) on delete set null,
  sent_at         timestamptz not null default now(),
  provider_id     text,
  check ((booking_id is null) <> (client_entry_id is null))
);
create index if not exists client_messages_booking_idx on client_messages(booking_id, sent_at desc);
create index if not exists client_messages_entry_idx on client_messages(client_entry_id, sent_at desc);
create index if not exists client_messages_sent_idx on client_messages(sent_at desc);

alter table client_messages enable row level security;
drop policy if exists client_messages_read on client_messages;
create policy client_messages_read on client_messages for select to authenticated using (
  app.is_master() or ((app.has_role('operations') or app.has_role('admin')) and not app.stage_only_admin())
  or (booking_id is not null and app.can_see_booking(booking_id))
  or (client_entry_id is not null and exists (select 1 from client_entries e where e.id = client_entry_id and app.can_see_client_entry(e.owner_id))));
-- no insert / update / delete policy: only the server (service key) writes

-- the templates: the Operation Team and Admin (as before for everything else)
drop policy if exists settings_write on app_settings;
create policy settings_write on app_settings for all to authenticated
  using (app.is_master() or (key in ('pf', 'breaks') and app.has_role('hr')) or (key = 'counters' and app.me() is not null) or (key = 'workflow' and app.has_perm('workflow.manage') and not app.stage_only_admin())
    or (key = 'clientTemplates' and (app.has_role('operations') or app.has_role('admin')) and not app.stage_only_admin()))
  with check (app.is_master() or (key in ('pf', 'breaks') and app.has_role('hr')) or (key = 'counters' and app.me() is not null) or (key = 'workflow' and app.has_perm('workflow.manage') and not app.stage_only_admin())
    or (key = 'clientTemplates' and (app.has_role('operations') or app.has_role('admin')) and not app.stage_only_admin()));

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'client_messages') then
    alter publication supabase_realtime add table public.client_messages;
  end if;
end $$;
