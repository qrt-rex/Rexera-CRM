-- =====================================================================================================
-- Rexera CRM · sales self-service. Safe to run more than once.
--  * Client entries: a pitched price of 0 is allowed (e.g. a full discount); a negative one is not.
--  * Invoices: the sales person who made a proforma (or is on it) edits it themselves while nothing has been paid
--    against it; Accounts (billing.manage) keeps every other change. They can never change its number, type, status,
--    payments, sales person or CRM entry.
--  * Invoice lines follow the same rule (they were open to anyone with billing.create, for any invoice).
-- =====================================================================================================
alter table client_entries drop constraint if exists client_entries_pitched_price_check;
alter table client_entries add constraint client_entries_pitched_price_check check (pitched_price >= 0);

-- a proforma of mine with no payment on it
create or replace function app.own_open_proforma(inv_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_perm('billing.create') and exists (
    select 1 from invoices i where i.id = inv_id and (i.created_by = app.me() or i.sales_person = app.me())
      and i.type = 'PROFORMA' and i.status = 'ISSUED' and i.paid = 0)
$$;
grant execute on function app.own_open_proforma(text) to authenticated, service_role;

drop policy if exists invoices_update on invoices;
create policy invoices_update on invoices for update to authenticated
  using (app.has_perm('billing.manage') or app.own_open_proforma(id))
  with check (app.has_perm('billing.manage') or (app.has_perm('billing.create') and (created_by = app.me() or sales_person = app.me())
    and type = 'PROFORMA' and status = 'ISSUED' and paid = 0));

create or replace function app.guard_invoice_update() returns trigger language plpgsql as $$
begin
  if app.me() is null or app.has_perm('billing.manage') then return new; end if;
  if new.number is distinct from old.number or new.type is distinct from old.type or new.paid is distinct from old.paid
     or new.status is distinct from old.status or new.sales_person is distinct from old.sales_person or new.created_by is distinct from old.created_by
     or new.booking_id is distinct from old.booking_id or new.issued_on is distinct from old.issued_on or new.branch_id is distinct from old.branch_id then
    raise exception 'Only Accounts can change the number, type, status, payments, branch or sales person of an invoice.';
  end if;
  return new;
end $$;
drop trigger if exists guard_invoice_update on invoices;
create trigger guard_invoice_update before update on invoices for each row execute function app.guard_invoice_update();

drop policy if exists invoice_items_write on invoice_items;
create policy invoice_items_write on invoice_items for all to authenticated
  using (app.has_perm('billing.manage') or app.own_open_proforma(invoice_id))
  with check (app.has_perm('billing.manage') or app.own_open_proforma(invoice_id));
