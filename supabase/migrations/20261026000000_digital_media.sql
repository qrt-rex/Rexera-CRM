-- =====================================================================================================
-- Rexera CRM · Digital Media Dashboard → Media Function. Safe to run more than once.
--  * media_items: one record per post / flyer / poster / video / … with its files, where it is published (internal =
--    company dashboards, external = client portals), assignment date / time / person and work status. One source
--    record whatever it is published to — never copied.
--  * media-files: private bucket for the files (images, videos, PDF, Word, PowerPoint; 50 MB each).
--  * Who sees what: media managers (media.manage) everything; the assignee and creator their records; company users
--    (media.view) published internal media. Clients get external media only through the live server (/api/portal).
--  * The assignee may only upload files and update the work status (not put it on hold): checked here too.
-- =====================================================================================================
create table if not exists media_items (
  id                 text primary key,
  serial             int not null unique,
  scheme_name        text not null,
  title              text not null,
  description        text not null default '',
  media_type         text not null check (media_type in ('POST', 'FLYER', 'POSTER', 'VIDEO', 'IMAGE', 'PDF', 'OTHER')),
  files              jsonb not null default '[]'::jsonb,
  internal           boolean not null default false,
  external           boolean not null default false,
  client_booking_ids text[] not null default '{}',
  assign_date        date,
  assign_time        text check (assign_time is null or assign_time ~ '^\d{2}:\d{2}$'),
  assigned_to        text references app_users(id) on delete set null,
  work_status        text not null default 'PENDING' check (work_status in ('PENDING', 'ON_HOLD', 'COMPLETED')),
  notes              text,
  submitted          boolean not null default false,
  submitted_at       timestamptz,
  submitted_by       text references app_users(id) on delete set null,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  created_by         text references app_users(id) on delete set null,
  updated_at         timestamptz not null default now(),
  updated_by         text references app_users(id) on delete set null,
  history            jsonb not null default '[]'::jsonb,
  check (not submitted or internal or external)
);
create index if not exists media_items_assigned_idx on media_items(assigned_to);

create or replace function app.can_see_media(m_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from media_items m where m.id = m_id and app.is_staff() and (
    app.has_perm('media.manage') or m.assigned_to = app.me() or m.created_by = app.me()
    or (app.has_perm('media.view') and m.internal and m.submitted and jsonb_array_length(m.files) > 0)))
$$;
grant execute on function app.can_see_media(text) to authenticated, service_role;

alter table media_items enable row level security;
drop policy if exists media_read on media_items;
create policy media_read on media_items for select to authenticated using (app.can_see_media(id));
drop policy if exists media_insert on media_items;
create policy media_insert on media_items for insert to authenticated with check (app.has_perm('media.manage'));
drop policy if exists media_update on media_items;
create policy media_update on media_items for update to authenticated
  using (app.has_perm('media.manage') or (app.is_staff() and assigned_to = app.me()))
  with check (app.has_perm('media.manage') or (app.is_staff() and assigned_to = app.me()));
drop policy if exists media_delete on media_items;
create policy media_delete on media_items for delete to authenticated using (app.has_perm('media.manage'));

-- the assignee: files and work status only (on hold is for media managers)
create or replace function app.guard_media_update() returns trigger language plpgsql as $$
declare keep text[] := array['files', 'work_status', 'completed_at', 'history', 'updated_at', 'updated_by'];
begin
  if app.has_perm('media.manage') or app.me() is null then return new; end if;
  if (to_jsonb(new) - keep) is distinct from (to_jsonb(old) - keep) then
    raise exception 'You can only upload files and update the work status of media assigned to you.';
  end if;
  if (old.work_status = 'ON_HOLD') <> (new.work_status = 'ON_HOLD') then
    raise exception 'Only a media manager can put work on hold or take it off hold.';
  end if;
  return new;
end $$;
drop trigger if exists guard_media_update on media_items;
create trigger guard_media_update before update on media_items for each row execute function app.guard_media_update();

-- files
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media-files', 'media-files', false, 52428800, array[
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists media_files_read on storage.objects;
create policy media_files_read on storage.objects for select to authenticated using (
  bucket_id = 'media-files' and app.is_staff() and (owner_id = auth.uid()::text
    or exists (select 1 from media_items m where m.files @> jsonb_build_array(jsonb_build_object('id', name)) and app.can_see_media(m.id))));
drop policy if exists media_files_add on storage.objects;
create policy media_files_add on storage.objects for insert to authenticated with check (
  bucket_id = 'media-files' and app.is_staff() and name like 'media-%'
  and (app.has_perm('media.manage') or exists (select 1 from media_items m where m.assigned_to = app.me())));
drop policy if exists media_files_remove on storage.objects;
create policy media_files_remove on storage.objects for delete to authenticated using (
  bucket_id = 'media-files' and (app.has_perm('media.manage') or owner_id = auth.uid()::text));

-- everyone sees company media; Admins manage it (Access Management can change both)
insert into role_permissions (role, permission)
select r::app_role, 'media.view' from unnest(array['admin', 'accounts', 'legal', 'operations', 'teamlead', 'sales', 'hr', 'support', 'branchdirector']) r
on conflict do nothing;
insert into role_permissions (role, permission) values ('admin', 'media.manage') on conflict do nothing;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'media_items') then
    alter publication supabase_realtime add table public.media_items;
  end if;
end $$;
