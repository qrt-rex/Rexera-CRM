-- =====================================================================================================
-- Rexera CRM · Deleted files: a copy of everything deleted, for IT Support to review. Safe to run more than once.
--  * Whoever deletes something (a document, a lead, a refund, a task, an asset …) writes its copy here first — their
--    own copies only, never changed afterwards.
--  * Only IT Support reads the copies (IT Support dashboard → Deleted files) and deletes them for good; the stored
--    files that belonged to them are removed only then.
-- =====================================================================================================
create table if not exists deleted_items (
  id          text primary key,
  module      text not null,
  kind        text not null,
  label       text not null,
  rows        integer not null default 1,
  data        jsonb,
  files       jsonb,
  deleted_by  text references app_users(id) on delete set null,
  deleted_at  timestamptz not null default now()
);
create index if not exists deleted_items_at_idx on deleted_items(deleted_at desc);

alter table deleted_items enable row level security;
drop policy if exists deleted_items_insert on deleted_items;
create policy deleted_items_insert on deleted_items for insert to authenticated with check (app.is_staff() and deleted_by = app.current_user_id());
drop policy if exists deleted_items_read on deleted_items;
create policy deleted_items_read on deleted_items for select to authenticated using (app.has_role('it'));
drop policy if exists deleted_items_delete on deleted_items;
create policy deleted_items_delete on deleted_items for delete to authenticated using (app.has_role('it'));
-- no update policy: a copy is never changed

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'deleted_items') then
    alter publication supabase_realtime add table public.deleted_items;
  end if;
end $$;
