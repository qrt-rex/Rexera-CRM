-- =====================================================================================================
-- Rexera CRM · the Digital Media role: its own dashboard (Digital Media → Media Function) and the Flyers & Posts it
-- feeds. Safe to run more than once. Give a person this role in Access Management → Users.
-- =====================================================================================================
alter type app_role add value if not exists 'digitalmedia';
-- a new role can only be used once it is saved
commit;

insert into role_permissions (role, permission)
select 'digitalmedia'::app_role, p from unnest(array['broadcasts.view', 'messages.use', 'schemes.view', 'content.view', 'content.manage', 'media.view', 'media.manage']) p
on conflict do nothing;
