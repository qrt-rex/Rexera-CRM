-- =====================================================================================================
-- Rexera CRM · Old CRM sync (IT Support only). Safe to run more than once.
--  * legacy_sync: one row — on / off, the connector's address, how often to check, the storage limits of the
--    Supabase plan, and what the server last saw (state). IT Support reads and changes it; the server (secret key)
--    keeps the state up to date.
--  * legacy_sync_runs: every copy from the old CRM — what changed, rows read, records written per table, files
--    copied / failed, errors. IT Support reads it; only the server writes it.
--  * legacy_sync_rows: what the sync last wrote for each record, so records changed in the new CRM are never
--    overwritten by the old CRM (unless IT Support chooses "take the old CRM's version"). Server only.
--  * crm_storage_stats(): Supabase database size, the biggest tables and the file storage per bucket — IT Support
--    (and the server) only.
-- The secret both sides use is never stored here: it is LEGACY_SYNC_SECRET on the server (Render → Environment).
-- =====================================================================================================
create table if not exists legacy_sync (
  id                  int primary key default 1 check (id = 1),
  enabled             boolean not null default false,
  url                 text,
  interval_sec        int not null default 60 check (interval_sec between 15 and 3600),
  db_limit_bytes      bigint not null default 524288000,      -- Supabase Free: 500 MB database
  storage_limit_bytes bigint not null default 1073741824,     -- Supabase Free: 1 GB file storage
  old_name            text,
  old_logo            text,
  -- a record changed both in the new CRM and in the old CRM: keep the new CRM's version (default) or take the old one
  prefer              text not null default 'new' check (prefer in ('new', 'old')),
  state               jsonb not null default '{}'::jsonb,
  updated_by          text references app_users(id) on delete set null,
  updated_at          timestamptz not null default now()
);
insert into legacy_sync (id) values (1) on conflict (id) do nothing;

create table if not exists legacy_sync_runs (
  id             bigint generated always as identity primary key,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  trigger        text not null default 'auto' check (trigger in ('auto', 'manual', 'full')),
  status         text not null default 'running' check (status in ('running', 'ok', 'error', 'stopped')),
  changed_tables text[] not null default '{}',
  rows_read      int not null default 0,
  written        jsonb not null default '{}'::jsonb,
  files          jsonb not null default '{}'::jsonb,
  error          text,
  by_user        text references app_users(id) on delete set null
);
create index if not exists legacy_sync_runs_started_idx on legacy_sync_runs(started_at desc);

-- what the sync last wrote for each record (a hash): a record that no longer matches was changed in the new CRM, and
-- the sync then keeps the new CRM's work instead of overwriting it with the old CRM's version
create table if not exists legacy_sync_rows (
  table_name text not null,
  row_key    text not null,
  hash       text not null,
  synced_at  timestamptz not null default now(),
  primary key (table_name, row_key)
);
alter table legacy_sync_rows enable row level security;
-- no policies: only the server (secret key) reads and writes it

alter table legacy_sync enable row level security;
alter table legacy_sync_runs enable row level security;
drop policy if exists legacy_sync_it on legacy_sync;
create policy legacy_sync_it on legacy_sync for all to authenticated using (app.has_role('it')) with check (app.has_role('it'));
drop policy if exists legacy_sync_runs_read on legacy_sync_runs;
create policy legacy_sync_runs_read on legacy_sync_runs for select to authenticated using (app.has_role('it'));
-- no write policy on legacy_sync_runs: only the server (secret key) writes the log

/** Supabase storage for the IT dashboard: database size, biggest tables, files per bucket. */
create or replace function public.crm_storage_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not app.has_role('it') then
    raise exception 'Storage details are for IT Support.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'tables', coalesce((select jsonb_agg(t order by (t->>'bytes')::bigint desc) from (
        select jsonb_build_object('name', s.relname, 'rows', s.n_live_tup, 'bytes', pg_total_relation_size(s.relid)) as t
        from pg_stat_user_tables s where s.schemaname = 'public' order by pg_total_relation_size(s.relid) desc limit 30) x), '[]'::jsonb),
    'buckets', coalesce((select jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'files', o.n, 'bytes', o.bytes)) from (
        select bucket_id, count(*) as n, coalesce(sum((metadata->>'size')::bigint), 0) as bytes from storage.objects group by bucket_id) o), '[]'::jsonb),
    'at', now());
end $$;
revoke all on function public.crm_storage_stats() from public, anon;
grant execute on function public.crm_storage_stats() to authenticated, service_role;

do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['legacy_sync', 'legacy_sync_runs'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
