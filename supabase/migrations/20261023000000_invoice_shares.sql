-- =====================================================================================================
-- Rexera CRM · invoices sent to clients (email with the PDF attached, WhatsApp document via Interakt). Safe to run more than once.
--  * invoice_shares: one row per send, written only by the live server (secret key) with the provider's answer.
--  * Read by whoever can open the invoice.
-- =====================================================================================================
create table if not exists invoice_shares (
  id         text primary key,
  invoice_id text not null references invoices(id) on delete cascade,
  sent_at    timestamptz not null default now(),
  sent_by    text references app_users(id) on delete set null,
  channel    text not null check (channel in ('email', 'whatsapp')),
  to_addr    text not null default '',
  status     text not null check (status in ('SENT', 'FAILED', 'NOT_CONFIGURED', 'NO_CONTACT')),  -- SENT = accepted by the provider
  error      text,
  message_id text                                -- Interakt's message id
);
create index if not exists invoice_shares_invoice_idx on invoice_shares(invoice_id, sent_at desc);
alter table invoice_shares enable row level security;
drop policy if exists invoice_shares_read on invoice_shares;
-- the invoice's own read rule decides (the sub-select runs with the reader's row-level security)
create policy invoice_shares_read on invoice_shares for select to authenticated using (exists (select 1 from invoices i where i.id = invoice_id));
-- no insert / update / delete policy: only the server writes it

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'invoice_shares') then
    alter publication supabase_realtime add table public.invoice_shares;
  end if;
end $$;
