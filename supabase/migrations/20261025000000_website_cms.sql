-- =====================================================================================================
-- Rexera CRM · the website managed from the CRM (Super Admin) and the website lead log. Safe to run more than once.
--  * site_content: each part of rexera.co.in — draft (edited in the CRM) and published (what the website reads,
--    through the server's GET /api/site/content).
--  * site_content_history: every published version (restore an earlier one).
--  * website_lead_log: every website form submission as it arrived, written by the server; failed ones can be retried.
--  * site-assets: public bucket for website images (only website managers upload / delete).
-- =====================================================================================================
create table if not exists site_content (
  key          text primary key check (key in ('hero', 'banners', 'about', 'services', 'portfolio', 'sections', 'contact', 'forms', 'seo')),
  draft        jsonb,
  published    jsonb,
  updated_at   timestamptz not null default now(),
  updated_by   text references app_users(id) on delete set null,
  published_at timestamptz,
  published_by text references app_users(id) on delete set null
);
create table if not exists site_content_history (
  id           text primary key,
  key          text not null,
  content      jsonb,
  published_at timestamptz not null default now(),
  published_by text references app_users(id) on delete set null
);
-- an older copy of these tables may already exist: give it every column
alter table site_content add column if not exists draft jsonb;
alter table site_content add column if not exists published jsonb;
alter table site_content add column if not exists updated_at timestamptz not null default now();
alter table site_content add column if not exists updated_by text references app_users(id) on delete set null;
alter table site_content add column if not exists published_at timestamptz;
alter table site_content add column if not exists published_by text references app_users(id) on delete set null;
alter table site_content_history add column if not exists key text;
alter table site_content_history add column if not exists content jsonb;
alter table site_content_history add column if not exists published_at timestamptz not null default now();
alter table site_content_history add column if not exists published_by text references app_users(id) on delete set null;
create index if not exists site_content_history_idx on site_content_history(published_at desc);
alter table site_content enable row level security;
alter table site_content_history enable row level security;
drop policy if exists site_content_manage on site_content;
create policy site_content_manage on site_content for all to authenticated using (app.has_perm('website.manage')) with check (app.has_perm('website.manage'));
drop policy if exists site_history_manage on site_content_history;
create policy site_history_manage on site_content_history for all to authenticated using (app.has_perm('website.manage')) with check (app.has_perm('website.manage'));

create table if not exists website_lead_log (
  id         text primary key,
  at         timestamptz not null default now(),
  status     text not null check (status in ('SAVED', 'EXISTING', 'FAILED', 'INVALID', 'SPAM')),
  form       text,
  name       text,
  phone      text,
  email      text,
  error      text,
  lead_id    text,
  fields     jsonb,
  retried_at timestamptz,
  retried_by text references app_users(id) on delete set null
);
create index if not exists website_lead_log_at_idx on website_lead_log(at desc);
alter table website_lead_log enable row level security;
drop policy if exists website_lead_log_read on website_lead_log;
create policy website_lead_log_read on website_lead_log for select to authenticated using (app.has_perm('website.manage'));
-- written only by the server (secret key)

-- public images for the website
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-assets', 'site-assets', true, 3145728, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])
on conflict (id) do update set public = true;
drop policy if exists site_assets_add on storage.objects;
create policy site_assets_add on storage.objects for insert to authenticated with check (bucket_id = 'site-assets' and app.has_perm('website.manage'));
drop policy if exists site_assets_remove on storage.objects;
create policy site_assets_remove on storage.objects for delete to authenticated using (bucket_id = 'site-assets' and app.has_perm('website.manage'));

do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['site_content', 'site_content_history', 'website_lead_log'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
