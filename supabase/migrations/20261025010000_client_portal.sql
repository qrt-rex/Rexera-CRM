-- Client portal (rexera.co.in/portal): clients sign in to see their own files.
--
-- Clients are Supabase sign-ins that are NOT CRM users (no app_users row, so app.me() is null and
-- every CRM policy denies them). They never read CRM tables directly: the portal_* functions
-- below run as definer, check the caller's own links, and return only client-safe fields. The
-- portal never writes to bookings (the CRM rewrites whole booking rows from each person's local
-- copy); a client upload becomes a booking_documents row plus notices for the staff on the file.
-- Safe to run again.

-- ── Document columns the portal needs ───────────────────────────────────────
alter table booking_documents add column if not exists client_visible boolean not null default false;
alter table booking_documents add column if not exists client_note text;          -- remark for the client (never `note`)
alter table booking_documents add column if not exists uploaded_by_client uuid references auth.users(id) on delete set null;
alter table booking_documents add column if not exists portal_stage text
    check (portal_stage is null or portal_stage in ('PRECHECK', 'FINANCE', 'DPR', 'CERTIFICATION', 'SUBMISSION'));

-- ── Accounts and links ──────────────────────────────────────────────────────
create table if not exists portal_clients (
    auth_user_id uuid primary key references auth.users(id) on delete cascade,
    name         text not null check (length(trim(name)) between 2 and 120),
    email        citext not null unique,
    phone        text check (phone is null or phone ~ '^[0-9]{10}$'),
    status       text not null default 'PENDING' check (status in ('PENDING', 'ACTIVE', 'SUSPENDED')),
    invited_by   text references app_users(id) on delete set null,
    approved_by  text references app_users(id) on delete set null,
    approved_at  timestamptz,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create table if not exists portal_client_bookings (
    auth_user_id uuid not null references portal_clients(auth_user_id) on delete cascade,
    booking_id   text not null references bookings(id) on delete cascade,
    linked_how   text not null check (linked_how in ('EMAIL_MATCH', 'STAFF', 'INVITE')),
    linked_by    text references app_users(id) on delete set null,
    linked_at    timestamptz not null default now(),
    primary key (auth_user_id, booking_id)
);
create index if not exists portal_client_bookings_booking_idx on portal_client_bookings (booking_id);

-- Client-facing updates posted by staff from the CRM file.
create table if not exists portal_updates (
    id          uuid primary key default gen_random_uuid(),
    booking_id  text not null references bookings(id) on delete cascade,
    title       text not null check (length(trim(title)) between 2 and 160),
    body        text not null default '' check (length(body) <= 4000),
    created_by  text references app_users(id) on delete set null,
    created_at  timestamptz not null default now()
);
create index if not exists portal_updates_booking_idx on portal_updates (booking_id, created_at desc);

create table if not exists portal_notifications (
    id           uuid primary key default gen_random_uuid(),
    auth_user_id uuid not null references portal_clients(auth_user_id) on delete cascade,
    booking_id   text references bookings(id) on delete cascade,
    kind         text not null check (kind in ('DOC_REQUIRED', 'DOC_APPROVED', 'DOC_REJECTED', 'REVISION', 'STAGE', 'REPORT', 'UPDATE', 'ACCOUNT')),
    title        text not null,
    body         text not null default '',
    created_at   timestamptz not null default now(),
    read_at      timestamptz
);
create index if not exists portal_notifications_user_idx on portal_notifications (auth_user_id, created_at desc);

create table if not exists portal_audit (
    id           bigint generated always as identity primary key,
    at           timestamptz not null default now(),
    auth_user_id uuid,
    staff_id     text,
    booking_id   text,
    action       text not null,
    detail       jsonb not null default '{}'::jsonb
);
create index if not exists portal_audit_at_idx on portal_audit (at desc);

-- Simple fixed-window limits for the public endpoints (register, resend).
create table if not exists portal_rate_limits (
    bucket       text not null,
    window_start timestamptz not null,
    hits         int not null default 0,
    primary key (bucket, window_start)
);

-- ── Row-level security ──────────────────────────────────────────────────────
alter table portal_clients enable row level security;
alter table portal_client_bookings enable row level security;
alter table portal_updates enable row level security;
alter table portal_notifications enable row level security;
alter table portal_audit enable row level security;
alter table portal_rate_limits enable row level security;

-- Clients may read their own account row and notices (the notices table is also used for live updates).
drop policy if exists portal_clients_own on portal_clients;
create policy portal_clients_own on portal_clients for select to authenticated
    using (auth_user_id = auth.uid() or app.me() is not null);
drop policy if exists portal_notifications_own on portal_notifications;
create policy portal_notifications_own on portal_notifications for select to authenticated
    using (auth_user_id = auth.uid());
-- Staff read links, updates and the audit trail for files they can see.
drop policy if exists portal_links_staff on portal_client_bookings;
create policy portal_links_staff on portal_client_bookings for select to authenticated
    using (app.can_see_booking(booking_id));
drop policy if exists portal_updates_staff on portal_updates;
create policy portal_updates_staff on portal_updates for select to authenticated
    using (app.can_see_booking(booking_id));
drop policy if exists portal_audit_staff on portal_audit;
create policy portal_audit_staff on portal_audit for select to authenticated
    using (app.is_master() or (booking_id is not null and app.can_see_booking(booking_id)));
-- No insert/update/delete policies: every write goes through the functions below.

revoke all on portal_clients, portal_client_bookings, portal_updates, portal_notifications, portal_audit, portal_rate_limits from anon;
grant select on portal_clients, portal_client_bookings, portal_updates, portal_notifications, portal_audit to authenticated;

-- Clients get no storage policy: the portal Edge Function checks portal_file_for() and hands out a
-- short-lived signed link (and logs it), so crm-files stays staff-only for direct access.

-- ── Helpers ─────────────────────────────────────────────────────────────────
create or replace function portal_is_client(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
    select exists (select 1 from portal_clients where auth_user_id = uid and status = 'ACTIVE')
$$;

create or replace function portal_owns(uid uuid, b_id text) returns boolean
language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from portal_client_bookings l join portal_clients c using (auth_user_id)
        where l.auth_user_id = uid and l.booking_id = b_id and c.status = 'ACTIVE'
    )
$$;

create or replace function portal_stage_label(s text) returns text language sql immutable as $$
    select case s when 'PRECHECK' then 'Pitch Deck' when 'FINANCE' then 'Finance' when 'DPR' then 'DPR'
                  when 'CERTIFICATION' then 'Certification' when 'SUBMISSION' then 'Submission' else s end
$$;

create or replace function portal_work_label(st text) returns text language sql immutable as $$
    select case st
        when 'NOT_STARTED' then 'Not started'      when 'IN_PROGRESS' then 'In progress'
        when 'PENDING_DOCUMENTS' then 'Upload needed' when 'PENDING_REVIEW' then 'Under review'
        when 'SUBMITTED' then 'Submitted'          when 'APPROVED' then 'Approved'
        when 'RETURNED' then 'Revision requested'  when 'COMPLETED' then 'Completed'
        else 'Not assigned' end
$$;

-- Documents that belong to a work stage when the CRM didn't tag them with portal_stage.
create or replace function portal_doc_stage(category text, tagged text) returns text language sql immutable as $$
    select coalesce(tagged, case
        when category = 'Pitch deck' then 'PRECHECK'
        when category in ('F.R (Financial report)', 'Financial', 'CMA report', 'Bank statement', 'ITR') then 'FINANCE'
        when category = 'D.P.R (Detailed project report)' then 'DPR'
        when category in ('Government certificates', 'MSME / Udyam certificate', 'GST certificate') then 'CERTIFICATION'
        when category = 'Submission' then 'SUBMISSION'
        else null end)
$$;

create or replace function portal_status_label(st booking_status) returns text language sql immutable as $$
    select case st::text
        when 'COMPLETED' then 'Completed' when 'ON_HOLD' then 'On hold'
        when 'IN_OPERATIONS' then 'In progress' when 'WITH_ADMIN' then 'In progress' when 'OPS_REVIEW' then 'In progress'
        else 'Onboarding' end
$$;

-- Notifies every active client linked to a file.
create or replace function portal_notify(b_id text, p_kind text, p_title text, p_body text default '') returns void
language sql security definer set search_path = public as $$
    insert into portal_notifications (auth_user_id, booking_id, kind, title, body)
    select l.auth_user_id, b_id, p_kind, p_title, coalesce(p_body, '')
    from portal_client_bookings l join portal_clients c using (auth_user_id)
    where l.booking_id = b_id and c.status = 'ACTIVE'
$$;

create or replace function portal_hit_limit(p_bucket text, p_max int, p_window interval) returns boolean
language plpgsql security definer set search_path = public as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window));
        n int;
begin
    insert into portal_rate_limits (bucket, window_start, hits) values (p_bucket, w, 1)
    on conflict (bucket, window_start) do update set hits = portal_rate_limits.hits + 1
    returning hits into n;
    delete from portal_rate_limits where window_start < now() - interval '1 day';
    return n > p_max;
end;
$$;

-- ── Client functions (callable by a signed-in client) ───────────────────────

-- Links the caller's verified email to matching CRM files. Never creates CRM records.
create or replace function portal_claim() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); u auth.users%rowtype; c portal_clients%rowtype; added int := 0;
begin
    if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
    select * into u from auth.users where id = uid;
    select * into c from portal_clients where auth_user_id = uid;
    if c.auth_user_id is null then raise exception 'no portal account' using errcode = '42501'; end if;
    if u.email_confirmed_at is not null and c.status <> 'SUSPENDED' then
        with matched as (
            select b.id from bookings b
            where lower(b.email::text) = lower(u.email)
               or lower(coalesce(b.payment_email::text, '')) = lower(u.email)
               or lower(coalesce(b.startup_contact ->> 'email', '')) = lower(u.email)
        ), ins as (
            insert into portal_client_bookings (auth_user_id, booking_id, linked_how)
            select uid, id from matched on conflict do nothing returning 1
        )
        select count(*) into added from ins;
        if added > 0 then
            insert into portal_audit (auth_user_id, action, detail) values (uid, 'auto_link', jsonb_build_object('files', added));
        end if;
        if c.status = 'PENDING' and exists (select 1 from portal_client_bookings where auth_user_id = uid) then
            update portal_clients set status = 'ACTIVE', updated_at = now() where auth_user_id = uid;
            insert into portal_notifications (auth_user_id, kind, title, body)
            values (uid, 'ACCOUNT', 'Your account is active', 'Your REXERA files are now available in your dashboard.');
        end if;
    end if;
    return portal_me();
end;
$$;

create or replace function portal_me() returns jsonb
language sql stable security definer set search_path = public as $$
    select jsonb_build_object(
        'name', c.name, 'email', c.email, 'phone', c.phone, 'status', c.status,
        'emailVerified', u.email_confirmed_at is not null,
        'files', (select count(*) from portal_client_bookings l where l.auth_user_id = c.auth_user_id),
        'unread', (select count(*) from portal_notifications n where n.auth_user_id = c.auth_user_id and n.read_at is null)
    )
    from portal_clients c join auth.users u on u.id = c.auth_user_id
    where c.auth_user_id = auth.uid()
$$;

create or replace function portal_update_profile(p_name text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); ph text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
begin
    if uid is null or not exists (select 1 from portal_clients where auth_user_id = uid) then
        raise exception 'no portal account' using errcode = '42501';
    end if;
    if length(trim(coalesce(p_name, ''))) not between 2 and 120 then raise exception 'Enter your full name.' using errcode = '22023'; end if;
    if ph is not null and length(ph) = 12 and ph like '91%' then ph := substr(ph, 3); end if;
    if ph is not null and ph !~ '^[0-9]{10}$' then raise exception 'Enter a 10-digit mobile number.' using errcode = '22023'; end if;
    update portal_clients set name = trim(p_name), phone = ph, updated_at = now() where auth_user_id = uid;
    insert into portal_audit (auth_user_id, action, detail) values (uid, 'profile_update', jsonb_build_object('name', trim(p_name), 'phone', ph));
    return portal_me();
end;
$$;

create or replace function portal_mark_read(p_ids uuid[] default null) returns void
language sql security definer set search_path = public as $$
    update portal_notifications set read_at = now()
    where auth_user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids))
$$;

-- Progress of one file, from its real records: the 8 processing stages (milestones), the five work
-- items that apply to it (done = Approved / Completed) and its tasks. The percentage is the average
-- of the parts that exist; a Completed file is 100.
create or replace function portal_progress(b_id text) returns jsonb
language sql stable security definer set search_path = public as $$
    with b as (select * from bookings where id = b_id),
    m as (
        select case when b.status = 'COMPLETED' or (b.stage >= 8 and b.stage_outcome = 'APPROVED') then 8
                    else greatest(0, least(8, b.stage - 1)) end as done
        from b
    ),
    w as (
        select count(*) filter (where v ->> 'status' <> 'NOT_NEEDED') as total,
               count(*) filter (where v ->> 'status' in ('APPROVED', 'COMPLETED')) as done
        from b, jsonb_each(coalesce(b.admin_work, '{}'::jsonb)) as e(k, v)
        where k in ('PRECHECK', 'FINANCE', 'DPR', 'CERTIFICATION', 'SUBMISSION')
    ),
    t as (select count(*) as total, count(*) filter (where done) as done from booking_tasks where booking_id = b_id),
    parts as (
        select (select done from m)::numeric / 8 as r
        union all select w.done::numeric / w.total from w where w.total > 0
        union all select t.done::numeric / t.total from t where t.total > 0
    )
    select jsonb_build_object(
        'percent', case when (select status from b) = 'COMPLETED' then 100 else round(100 * (select avg(r) from parts)) end,
        'milestonesDone', (select done from m), 'milestonesTotal', 8,
        'workDone', (select done from w), 'workTotal', (select total from w),
        'tasksDone', (select done from t), 'tasksTotal', (select total from t)
    )
$$;

-- Everything the dashboard shows, for the caller's own active files only.
create or replace function portal_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); result jsonb;
begin
    if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
    if not portal_is_client(uid) then return jsonb_build_object('me', portal_me(), 'files', '[]'::jsonb, 'notifications', '[]'::jsonb); end if;

    select jsonb_build_object(
        'me', portal_me(),
        'notifications', coalesce((
            select jsonb_agg(jsonb_build_object('id', n.id, 'bookingId', n.booking_id, 'kind', n.kind, 'title', n.title,
                                                'body', n.body, 'at', n.created_at, 'read', n.read_at is not null) order by n.created_at desc)
            from (select * from portal_notifications where auth_user_id = uid order by created_at desc limit 100) n
        ), '[]'::jsonb),
        'files', coalesce((
            select jsonb_agg(f order by f ->> 'createdAt' desc) from (
                select jsonb_build_object(
                    'id', b.id, 'code', b.booking_code, 'company', b.company_name, 'contact', b.contact_person,
                    'email', b.email, 'mobile', b.mobile, 'city', b.city, 'state', b.state, 'address', b.address,
                    'website', b.website, 'industry', b.industry,
                    'services', coalesce((select jsonb_agg(s ->> 'name') from jsonb_array_elements(coalesce(b.services, '[]'::jsonb)) s), jsonb_build_array(b.service_name)),
                    'status', portal_status_label(b.status), 'completed', b.status = 'COMPLETED', 'onHold', b.status = 'ON_HOLD',
                    'stage', b.stage, 'stageOutcome', b.stage_outcome,
                    'stageReason', case when b.stage_outcome in ('REJECTED', 'RESUBMISSION', 'HOLD_CLIENT') then b.stage_reason end,
                    'deadline', b.deadline, 'bookedOn', coalesce(b.booking_date, b.created_at::date),
                    'createdAt', b.created_at, 'updatedAt', b.updated_at,
                    'stageHistory', coalesce((select jsonb_agg(jsonb_build_object('stage', m.stage, 'outcome', m.outcome, 'at', m.moved_at) order by m.moved_at)
                                              from booking_stage_moves m where m.booking_id = b.id), '[]'::jsonb),
                    'work', coalesce((
                        select jsonb_agg(jsonb_build_object(
                            'stage', k, 'label', portal_stage_label(k),
                            'status', coalesce(w -> k ->> 'status', 'NOT_ASSIGNED'),
                            'statusLabel', portal_work_label(w -> k ->> 'status'),
                            'assigned', coalesce(w -> k ->> 'status' <> 'NOT_NEEDED', false),
                            'canUpload', coalesce((w -> k ->> 'status') in ('NOT_STARTED', 'IN_PROGRESS', 'PENDING_DOCUMENTS', 'RETURNED'), false),
                            'actionNeeded', coalesce((w -> k ->> 'status') in ('PENDING_DOCUMENTS', 'RETURNED'), false),
                            'due', w -> k ->> 'due', 'submittedAt', w -> k ->> 'submittedAt', 'doneAt', w -> k ->> 'doneAt',
                            'updatedAt', w -> k ->> 'updatedAt',
                            -- status changes only: history notes are internal
                            'history', coalesce((select jsonb_agg(jsonb_build_object('status', h ->> 'status', 'label', portal_work_label(h ->> 'status'), 'at', h ->> 'at'))
                                                 from jsonb_array_elements(coalesce(w -> k -> 'history', '[]'::jsonb)) h), '[]'::jsonb)
                        ) order by ord)
                        from (select coalesce(b.admin_work, '{}'::jsonb) w) ww,
                             unnest(array['PRECHECK', 'FINANCE', 'DPR', 'CERTIFICATION', 'SUBMISSION']) with ordinality as t(k, ord)
                    ), '[]'::jsonb),
                    'documents', coalesce((
                        select jsonb_agg(jsonb_build_object(
                            'id', d.id, 'name', d.name, 'category', d.category, 'stage', portal_doc_stage(d.category, d.portal_stage),
                            'status', d.status, 'remark', d.client_note, 'size', d.size_bytes,
                            'uploadedAt', d.uploaded_at, 'reviewedAt', d.reviewed_at,
                            'byClient', d.uploaded_by_client is not null, 'hasFile', d.file is not null,
                            'isReport', d.category in ('Progress report', 'Report')
                        ) order by d.uploaded_at desc)
                        from booking_documents d
                        where d.booking_id = b.id and (d.client_visible or d.uploaded_by_client = uid)
                    ), '[]'::jsonb),
                    'updates', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'body', p.body, 'at', p.created_at) order by p.created_at desc)
                                         from portal_updates p where p.booking_id = b.id), '[]'::jsonb),
                    'progress', portal_progress(b.id)
                ) as f
                from bookings b
                join portal_client_bookings l on l.booking_id = b.id and l.auth_user_id = uid
            ) files
        ), '[]'::jsonb)
    ) into result;
    return result;
end;
$$;

-- ── Server functions (the portal Edge Function only, with the service key) ──

create or replace function portal_register_account(p_uid uuid, p_name text, p_email text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
begin
    insert into portal_clients (auth_user_id, name, email, phone) values (p_uid, trim(p_name), lower(p_email), nullif(p_phone, ''))
    on conflict (auth_user_id) do nothing;
    insert into portal_audit (auth_user_id, action, detail) values (p_uid, 'register', jsonb_build_object('email', lower(p_email)));
end;
$$;

-- Can this client upload to this work stage of this file? Returns null when allowed, else the reason.
create or replace function portal_upload_problem(p_uid uuid, p_booking text, p_stage text) returns text
language sql stable security definer set search_path = public as $$
    select case
        when not portal_owns(p_uid, p_booking) then 'This file is not linked to your account.'
        when p_stage not in ('PRECHECK', 'FINANCE', 'DPR', 'CERTIFICATION', 'SUBMISSION') then 'Unknown document type.'
        when (select admin_work -> p_stage ->> 'status' from bookings where id = p_booking)
             not in ('NOT_STARTED', 'IN_PROGRESS', 'PENDING_DOCUMENTS', 'RETURNED') then 'This document is not open for upload.'
        when (select admin_work -> p_stage ->> 'status' from bookings where id = p_booking) is null then 'This document has not been requested.'
        else null end
$$;

-- Records a client upload as a CRM document and tells the staff on the file.
create or replace function portal_record_upload(p_uid uuid, p_booking text, p_stage text, p_object text,
                                                p_name text, p_type text, p_size bigint) returns text
language plpgsql security definer set search_path = public as $$
declare problem text := portal_upload_problem(p_uid, p_booking, p_stage); doc_id text; b bookings%rowtype; who text;
        cat text := case p_stage when 'PRECHECK' then 'Pitch deck' when 'FINANCE' then 'F.R (Financial report)'
                                 when 'DPR' then 'D.P.R (Detailed project report)' when 'CERTIFICATION' then 'Government certificates'
                                 else 'Submission' end;
begin
    if problem is not null then raise exception '%', problem using errcode = '42501'; end if;
    select * into b from bookings where id = p_booking;
    select name into who from portal_clients where auth_user_id = p_uid;
    insert into booking_documents (booking_id, name, category, size_bytes, status, storage_path, file, uploaded_by_client, portal_stage, client_visible)
    values (p_booking, left(p_name, 200), cat, p_size, 'PENDING', p_object,
            jsonb_build_object('id', p_object, 'name', left(p_name, 200), 'type', p_type, 'size', p_size, 'at', now()),
            p_uid, p_stage, true)
    returning id into doc_id;
    insert into notifications (user_id, title, body, link, kind)
    select distinct u, 'Client uploaded ' || portal_stage_label(p_stage),
           coalesce(who, 'The client') || ' uploaded "' || left(p_name, 80) || '" on ' || b.booking_code || ' · ' || b.company_name,
           '/bookings/' || b.id, 'info'
    from unnest(array[b.admin_id, b.ops_member_id, b.created_by, b.admin_work -> p_stage ->> 'assignee']) as u
    where u is not null and exists (select 1 from app_users where id = u and active);
    insert into portal_audit (auth_user_id, booking_id, action, detail)
    values (p_uid, p_booking, 'upload', jsonb_build_object('document', doc_id, 'stage', p_stage, 'name', p_name, 'size', p_size));
    return doc_id;
end;
$$;

-- Storage object of a document the client may open, or null.
create or replace function portal_file_for(p_uid uuid, p_doc text) returns text
language sql stable security definer set search_path = public as $$
    select d.file ->> 'id' from booking_documents d
    where d.id = p_doc and d.file is not null and portal_owns(p_uid, d.booking_id)
      and (d.client_visible or d.uploaded_by_client = p_uid)
$$;

create or replace function portal_log(p_uid uuid, p_booking text, p_action text, p_detail jsonb) returns void
language sql security definer set search_path = public as $$
    insert into portal_audit (auth_user_id, booking_id, action, detail) values (p_uid, p_booking, p_action, coalesce(p_detail, '{}'::jsonb))
$$;

-- ── Staff functions (CRM users) ─────────────────────────────────────────────

-- Link a client account to a file the staff member can see, and activate the account.
create or replace function portal_staff_link(p_client uuid, p_booking text) returns void
language plpgsql security definer set search_path = public as $$
declare me text := app.me();
begin
    if me is null or not app.can_see_booking(p_booking) then raise exception 'not allowed' using errcode = '42501'; end if;
    insert into portal_client_bookings (auth_user_id, booking_id, linked_how, linked_by) values (p_client, p_booking, 'STAFF', me)
    on conflict do nothing;
    update portal_clients set status = 'ACTIVE', approved_by = coalesce(approved_by, me), approved_at = coalesce(approved_at, now()), updated_at = now()
    where auth_user_id = p_client and status = 'PENDING';
    insert into portal_notifications (auth_user_id, booking_id, kind, title, body)
    values (p_client, p_booking, 'ACCOUNT', 'A new file is linked to your account', 'You can now follow its progress and documents here.');
    insert into portal_audit (staff_id, auth_user_id, booking_id, action) values (me, p_client, p_booking, 'staff_link');
end;
$$;

create or replace function portal_staff_unlink(p_client uuid, p_booking text) returns void
language plpgsql security definer set search_path = public as $$
declare me text := app.me();
begin
    if me is null or not app.can_see_booking(p_booking) then raise exception 'not allowed' using errcode = '42501'; end if;
    delete from portal_client_bookings where auth_user_id = p_client and booking_id = p_booking;
    insert into portal_audit (staff_id, auth_user_id, booking_id, action) values (me, p_client, p_booking, 'staff_unlink');
end;
$$;

create or replace function portal_staff_set_status(p_client uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare me text := app.me();
begin
    if me is null or not app.has_perm('bookings.all') then raise exception 'not allowed' using errcode = '42501'; end if;
    if p_status not in ('PENDING', 'ACTIVE', 'SUSPENDED') then raise exception 'bad status' using errcode = '22023'; end if;
    update portal_clients set status = p_status, updated_at = now(),
           approved_by = case when p_status = 'ACTIVE' then coalesce(approved_by, me) else approved_by end,
           approved_at = case when p_status = 'ACTIVE' then coalesce(approved_at, now()) else approved_at end
    where auth_user_id = p_client;
    insert into portal_audit (staff_id, auth_user_id, action, detail) values (me, p_client, 'staff_status', jsonb_build_object('status', p_status));
end;
$$;

-- Share a CRM document with the client (or hide it), with an optional remark for them.
create or replace function portal_staff_share_document(p_doc text, p_visible boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me text := app.me(); d booking_documents%rowtype;
begin
    select * into d from booking_documents where id = p_doc;
    if me is null or d.id is null or not app.can_see_booking(d.booking_id) then raise exception 'not allowed' using errcode = '42501'; end if;
    update booking_documents set client_visible = p_visible, client_note = nullif(trim(coalesce(p_note, '')), '') where id = p_doc;
    insert into portal_audit (staff_id, booking_id, action, detail)
    values (me, d.booking_id, 'staff_share_document', jsonb_build_object('document', p_doc, 'visible', p_visible));
end;
$$;

create or replace function portal_staff_post_update(p_booking text, p_title text, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me text := app.me(); new_id uuid;
begin
    if me is null or not app.can_see_booking(p_booking) then raise exception 'not allowed' using errcode = '42501'; end if;
    insert into portal_updates (booking_id, title, body, created_by) values (p_booking, trim(p_title), coalesce(p_body, ''), me) returning id into new_id;
    insert into portal_audit (staff_id, booking_id, action, detail) values (me, p_booking, 'staff_post_update', jsonb_build_object('update', new_id));
    return new_id;
end;
$$;

-- ── Notices from CRM changes ────────────────────────────────────────────────

create or replace function portal_on_booking_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text; was text; now_st text;
        labels text[] := array['Data Collection', 'Data Received', 'Document In-process / In-review', 'Document Approved',
                               'Ready to Submit', 'Submission', 'Company Information Under Process', 'Approved / Rejected / Re-submission / Hold'];
begin
    if not exists (select 1 from portal_client_bookings where booking_id = new.id) then return new; end if;
    if new.stage is distinct from old.stage or new.stage_outcome is distinct from old.stage_outcome then
        perform portal_notify(new.id, 'STAGE', 'Project stage updated',
            new.booking_code || ' is now at stage ' || new.stage || ': ' ||
            case new.stage_outcome when 'APPROVED' then 'Approved' when 'REJECTED' then 'Rejected' when 'RESUBMISSION' then 'Re-submission'
                                   when 'HOLD_CLIENT' then 'On hold' when 'IN_REVIEW' then 'Document in review'
                                   else coalesce(labels[new.stage], '') end || '.');
    end if;
    if new.status is distinct from old.status and new.status = 'COMPLETED' then
        perform portal_notify(new.id, 'STAGE', 'Work completed', new.booking_code || ' has been marked complete.');
    end if;
    foreach k in array array['PRECHECK', 'FINANCE', 'DPR', 'CERTIFICATION', 'SUBMISSION'] loop
        was := old.admin_work -> k ->> 'status';
        now_st := new.admin_work -> k ->> 'status';
        continue when now_st is null or now_st is not distinct from was;
        if now_st = 'PENDING_DOCUMENTS' then
            perform portal_notify(new.id, 'DOC_REQUIRED', portal_stage_label(k) || ' needed', 'Please upload your ' || portal_stage_label(k) || ' for ' || new.booking_code || '.');
        elsif now_st = 'RETURNED' then
            perform portal_notify(new.id, 'REVISION', portal_stage_label(k) || ': revision requested', 'Please upload a revised ' || portal_stage_label(k) || ' for ' || new.booking_code || '.');
        elsif now_st in ('APPROVED', 'COMPLETED') then
            perform portal_notify(new.id, 'DOC_APPROVED', portal_stage_label(k) || ' approved', portal_stage_label(k) || ' for ' || new.booking_code || ' is ' || lower(portal_work_label(now_st)) || '.');
        elsif now_st = 'SUBMITTED' then
            perform portal_notify(new.id, 'STAGE', portal_stage_label(k) || ' submitted', portal_stage_label(k) || ' for ' || new.booking_code || ' has been submitted.');
        end if;
    end loop;
    return new;
end;
$$;
drop trigger if exists portal_booking_change on bookings;
create trigger portal_booking_change after update on bookings for each row execute function portal_on_booking_change();

create or replace function portal_on_document_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare visible boolean := new.client_visible or new.uploaded_by_client is not null;
begin
    if not exists (select 1 from portal_client_bookings where booking_id = new.booking_id) then return new; end if;
    if tg_op = 'INSERT' then
        if new.client_visible and new.uploaded_by_client is null then
            perform portal_notify(new.booking_id,
                case when new.category in ('Progress report', 'Report') then 'REPORT' else 'UPDATE' end,
                case when new.category in ('Progress report', 'Report') then 'New report available' else 'New document shared' end,
                '"' || left(new.name, 80) || '" is ready to view.');
        end if;
        return new;
    end if;
    if new.client_visible and not old.client_visible and new.uploaded_by_client is null then
        perform portal_notify(new.booking_id,
            case when new.category in ('Progress report', 'Report') then 'REPORT' else 'UPDATE' end,
            case when new.category in ('Progress report', 'Report') then 'New report available' else 'New document shared' end,
            '"' || left(new.name, 80) || '" is ready to view.');
    end if;
    if visible and new.status is distinct from old.status then
        if new.status = 'VERIFIED' then
            perform portal_notify(new.booking_id, 'DOC_APPROVED', 'Document approved', '"' || left(new.name, 80) || '" was approved.');
        elsif new.status = 'REJECTED' then
            perform portal_notify(new.booking_id, 'DOC_REJECTED', 'Document needs changes',
                '"' || left(new.name, 80) || '" was not accepted.' || coalesce(' ' || new.client_note, ''));
        end if;
    end if;
    return new;
end;
$$;
drop trigger if exists portal_document_change on booking_documents;
create trigger portal_document_change after insert or update on booking_documents for each row execute function portal_on_document_change();

create or replace function portal_on_update_posted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    perform portal_notify(new.booking_id, 'UPDATE', new.title, left(new.body, 300));
    return new;
end;
$$;
drop trigger if exists portal_update_posted on portal_updates;
create trigger portal_update_posted after insert on portal_updates for each row execute function portal_on_update_posted();

-- ── Who may call what ───────────────────────────────────────────────────────
revoke all on function portal_progress(text) from public, anon, authenticated;
revoke all on function portal_is_client(uuid), portal_owns(uuid, text), portal_notify(text, text, text, text),
    portal_hit_limit(text, int, interval), portal_register_account(uuid, text, text, text),
    portal_upload_problem(uuid, text, text), portal_record_upload(uuid, text, text, text, text, text, bigint),
    portal_file_for(uuid, text), portal_log(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function portal_hit_limit(text, int, interval), portal_register_account(uuid, text, text, text),
    portal_upload_problem(uuid, text, text), portal_record_upload(uuid, text, text, text, text, text, bigint),
    portal_file_for(uuid, text), portal_log(uuid, text, text, jsonb), portal_owns(uuid, text) to service_role;

revoke all on function portal_claim(), portal_me(), portal_update_profile(text, text), portal_mark_read(uuid[]), portal_dashboard(),
    portal_staff_link(uuid, text), portal_staff_unlink(uuid, text), portal_staff_set_status(uuid, text),
    portal_staff_share_document(text, boolean, text), portal_staff_post_update(text, text, text) from public, anon;
grant execute on function portal_claim(), portal_me(), portal_update_profile(text, text), portal_mark_read(uuid[]), portal_dashboard(),
    portal_staff_link(uuid, text), portal_staff_unlink(uuid, text), portal_staff_set_status(uuid, text),
    portal_staff_share_document(text, boolean, text), portal_staff_post_update(text, text, text) to authenticated;

-- Live dashboard updates for the client's own notices.
do $$ begin
    alter publication supabase_realtime add table portal_notifications;
exception when duplicate_object then null; when undefined_object then null; end $$;
