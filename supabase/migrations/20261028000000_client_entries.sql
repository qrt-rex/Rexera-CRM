-- =====================================================================================================
-- Rexera CRM · client entries (pre-CRM entries). Safe to run more than once.
--  * The flow is now: sales person → dialer → client entry → follow-ups (if needed) → CRM entry. While the dialer
--    call is on, the sales person fills the client entry (date, client name, company name, number, scheme, pitched
--    price, status, requirement and note are compulsory; the follow-up date is not). Once the payment is received
--    they convert it into the CRM entry, and only that counts as a CRM entry.
--  * Seen only by the sales person who made it and their team leader (Super Admin / IT keep access for backups).
--  * Converting it is checked here too: the CRM entry must exist and belong to the entry's owner, and a converted
--    entry can no longer be changed (except by Super Admin / IT).
-- =====================================================================================================
create table if not exists client_entries (
  id            text primary key,
  entry_date    date not null,
  client_name   text not null check (length(trim(client_name)) >= 2),
  company_name  text not null check (length(trim(company_name)) >= 2),
  phone         text not null check (phone ~ '^[6-9][0-9]{9}$'),
  service_id    text references services(id) on delete set null,
  scheme        text not null check (length(trim(scheme)) >= 1),
  pitched_price numeric(14,2) not null check (pitched_price > 0),
  status        text not null check (status in ('INTERESTED', 'HOT', 'CALL_BACK', 'PAYMENT_PENDING', 'NOT_INTERESTED', 'CONVERTED')),
  requirement   text not null check (length(trim(requirement)) >= 3),
  note          text not null check (length(trim(note)) >= 3),
  follow_up     date,
  follow_ups    jsonb not null default '[]'::jsonb,
  lead_id       text references leads(id) on delete set null,
  owner_id      text references app_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  booking_id    text references bookings(id) on delete set null,
  converted_at  timestamptz
);
create index if not exists client_entries_owner_idx on client_entries(owner_id);
create index if not exists client_entries_lead_idx on client_entries(lead_id);

create or replace function app.can_see_client_entry(owner text) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_staff() and (owner = app.me() or app.is_master()
    or exists (select 1 from app_users u where u.id = owner and u.team_lead_id = app.me()))
$$;
grant execute on function app.can_see_client_entry(text) to authenticated, service_role;

alter table client_entries enable row level security;
drop policy if exists client_entries_read on client_entries;
create policy client_entries_read on client_entries for select to authenticated using (app.can_see_client_entry(owner_id));
drop policy if exists client_entries_insert on client_entries;
create policy client_entries_insert on client_entries for insert to authenticated
  with check (app.is_staff() and owner_id = app.me() and app.has_perm('dialer.use') and status <> 'CONVERTED' and booking_id is null);
drop policy if exists client_entries_update on client_entries;
create policy client_entries_update on client_entries for update to authenticated
  using (app.can_see_client_entry(owner_id)) with check (app.can_see_client_entry(owner_id));
drop policy if exists client_entries_delete on client_entries;
create policy client_entries_delete on client_entries for delete to authenticated using (app.is_master());

-- the owner stays the owner; converting needs the owner's own CRM entry; a converted entry is final
create or replace function app.guard_client_entry_update() returns trigger language plpgsql as $$
begin
  if app.me() is null or app.is_master() then return new; end if;
  if new.owner_id is distinct from old.owner_id then raise exception 'A client entry stays with the sales person who made it.'; end if;
  if old.status = 'CONVERTED' then raise exception 'This client entry is already a CRM entry.'; end if;
  if new.status = 'CONVERTED' then
    if new.owner_id is distinct from app.me() then raise exception 'Only the sales person who made the client entry can convert it.'; end if;
    if not exists (select 1 from bookings b where b.id = new.booking_id and b.created_by = new.owner_id) then
      raise exception 'Convert a client entry by making its CRM entry.';
    end if;
  elsif new.booking_id is not null then
    raise exception 'Convert a client entry by making its CRM entry.';
  end if;
  return new;
end $$;
drop trigger if exists guard_client_entry_update on client_entries;
create trigger guard_client_entry_update before update on client_entries for each row execute function app.guard_client_entry_update();

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'client_entries') then
    alter publication supabase_realtime add table public.client_entries;
  end if;
end $$;
