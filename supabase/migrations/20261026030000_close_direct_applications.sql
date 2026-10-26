-- =====================================================================================================
-- Rexera CRM · job applications are saved only by the live server (/api/apply), which checks every answer and the
-- resume's real content. The old rule letting anyone insert straight into candidate_applications (skipping all of
-- those checks — e.g. a "javascript:" LinkedIn link) is closed. Safe to run more than once.
-- (Resumes are still uploaded by the form page itself; the server checks and removes bad ones.)
-- =====================================================================================================
drop policy if exists candidate_apps_public_insert on candidate_applications;
revoke insert on candidate_applications from anon;
