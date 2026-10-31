-- =====================================================================================================
-- Rexera CRM · HR: selected candidates, and the offer / joining letters sent to them. Safe to run more than once.
--  * candidate_applications.selected: HR ticks a candidate for a letter (unticking takes them off the list).
--  * candidate_letters: every letter sent by email or WhatsApp — written only by the live server (/api/hr/letter);
--    HR (recruitment.manage) reads it.
-- =====================================================================================================
alter table candidate_applications add column if not exists selected boolean;
alter table candidate_applications add column if not exists selected_at timestamptz;
alter table candidate_applications add column if not exists selected_by text;

create table if not exists candidate_letters (
  id           text primary key,
  candidate_id text not null references candidate_applications(id) on delete cascade,
  kind         text not null check (kind in ('OFFER', 'JOINING')),
  channel      text not null check (channel in ('EMAIL', 'WHATSAPP')),
  to_addr      text not null,
  subject      text,
  body         text not null,
  status       text not null check (status in ('SENT', 'MANUAL', 'FAILED', 'NOT_CONFIGURED')),
  error        text,
  sent_by      text references app_users(id) on delete set null,
  sent_at      timestamptz not null default now()
);
create index if not exists candidate_letters_candidate_idx on candidate_letters(candidate_id, sent_at desc);

alter table candidate_letters enable row level security;
drop policy if exists candidate_letters_read on candidate_letters;
create policy candidate_letters_read on candidate_letters for select to authenticated using (app.has_perm('recruitment.manage'));
-- no insert / update / delete policies: only the server (secret key) writes the log

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'candidate_letters') then
    alter publication supabase_realtime add table public.candidate_letters;
  end if;
end $$;
