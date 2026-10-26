-- =====================================================================================================
-- Rexera CRM · the Digital Media section (dashboard, posts, flyers) is the Digital Media team's only: no other role
-- manages media (Super Admin / IT keep everything). Safe to run more than once.
-- =====================================================================================================
delete from role_permissions where permission = 'media.manage' and role::text <> 'digitalmedia';
delete from user_permission_overrides where permission = 'media.manage' and effect = 'allow'
  and user_id in (select id from app_users where role::text not in ('digitalmedia', 'superadmin', 'it'));
