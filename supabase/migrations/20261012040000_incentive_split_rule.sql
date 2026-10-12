-- =====================================================================================================================
-- Rexera CRM · Sales incentive report: collections credited the way the old CRM's scorecards do (user_collections.php)
--  - Every payment part counts on the day it was received, before GST (dateless payments and rounding adjustments don't).
--  - Credit goes to the person who submitted the CRM entry and the person who closed the lead: 50% each when they are
--    different people, 100% when it is the same person. Old-CRM entries use their original submitted_by /
--    lead_closed_by_email; entries made in this app use created_by / closed_by.
--  - Deals closed use the same split (½ a deal each when two people share it), by booking date.
--  - Daily / weekly / monthly incentive rules are unchanged (latest incentive_rule_versions row).
--  - security invoker: row-level security still applies, so only the server (secret key) gets rows.
--  - Safe to run more than once. Replaces 20261012020000_sales_incentive_report.sql (deals_closed is now numeric).
-- =====================================================================================================================

drop function if exists public.sales_incentive_report(text);

create function public.sales_incentive_report(p_month text)
returns table (
  user_id text, name text, email text, role text, salary numeric,
  deals_closed numeric, quoted numeric, payments int, collected numeric, collected_with_gst numeric, shared_collected numeric,
  eligible_at numeric, eligible boolean, monthly_at numeric,
  daily_incentive numeric, weekly_incentive numeric, monthly_pct numeric, monthly_incentive numeric,
  auto_incentive numeric, manual_incentive numeric, total_incentive numeric,
  days jsonb, weeks jsonb
)
language sql stable security invoker set search_path = public as $$
  with
  m as (
    select to_date(p_month || '-01', 'YYYY-MM-DD') as first_day,
           (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month')::date as next_month
  ),
  r as (
    select (rules->>'eligibilityMultiple')::numeric as elig_x, (rules->>'monthlyMultiple')::numeric as month_x,
           (rules->>'dailyThreshold')::numeric as day_at, (rules->>'dailyPct')::numeric as day_pct,
           (rules->>'weeklyThreshold')::numeric as week_at, (rules->>'weeklyPct')::numeric as week_pct,
           rules->'slabs' as slabs
    from incentive_rule_versions order by version desc limit 1
  ),
  people_of as (                             -- submitter and lead closer of every CRM entry
    select b.id as booking_id, b.total_quoted,
           coalesce(
             (select u.id from app_users u where b.legacy->'crm'->>'submitted_by' ~ '^\d+$' and u.legacy_id = (b.legacy->'crm'->>'submitted_by')::int),
             b.created_by) as submitter,
           coalesce(
             (select u.id from app_users u where nullif(trim(b.legacy->'crm'->>'lead_closed_by_email'), '') is not null
                and lower(u.email::text) = lower(trim(b.legacy->'crm'->>'lead_closed_by_email')) limit 1),
             b.closed_by,
             (select u.id from app_users u where b.legacy->'crm'->>'submitted_by' ~ '^\d+$' and u.legacy_id = (b.legacy->'crm'->>'submitted_by')::int),
             b.created_by) as closer,
           coalesce(
             b.booking_date,
             case when b.legacy->'crm'->>'payment_date' ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$' then (b.legacy->'crm'->>'payment_date')::date end,
             (b.created_at at time zone 'Asia/Kolkata')::date) as deal_day,
           b.status
    from bookings b
  ),
  credit as (                                -- who gets which share of an entry
    select booking_id, submitter as uid, case when closer is null or closer = submitter then 1.0 else 0.5 end as share, total_quoted, deal_day, status from people_of where submitter is not null
    union all
    select booking_id, closer, 0.5, total_quoted, deal_day, status from people_of where closer is not null and submitter is not null and closer <> submitter
    union all
    select booking_id, closer, 1.0, total_quoted, deal_day, status from people_of where submitter is null and closer is not null
  ),
  pay as (                                   -- credited collections per person per day
    select c.uid, p.paid_on as day,
           sum(round(p.amount * c.share, 2)) as amount, sum(round(p.total * c.share, 2)) as with_gst,
           sum(case when c.share < 1 then round(p.amount * c.share, 2) else 0 end) as shared,
           count(*)::int as n
    from booking_payments p join credit c on c.booking_id = p.booking_id, m
    where p.paid_on >= m.first_day and p.paid_on < m.next_month and p.amount > 0 and not p.is_adjustment and not p.date_unknown
    group by 1, 2
  ),
  daily as (
    select pay.uid, pay.day, pay.amount, case when pay.amount >= r.day_at then round(pay.amount * r.day_pct / 100, 2) else 0 end as incentive
    from pay, r
  ),
  weekly as (
    select w.uid, w.week, w.amount, case when w.amount >= r.week_at then round(w.amount * r.week_pct / 100, 2) else 0 end as incentive
    from (select uid, date_trunc('week', day)::date as week, sum(amount) as amount from pay group by 1, 2) w, r
  ),
  deals as (
    select c.uid, sum(c.share) as n, sum(round(c.total_quoted * c.share, 2)) as quoted
    from credit c, m
    where c.status <> 'REJECTED' and c.deal_day >= m.first_day and c.deal_day < m.next_month
    group by 1
  ),
  manual as (
    select mi.user_id as uid, sum(mi.amount) as amount from manual_incentives mi where mi.month = p_month group by 1
  ),
  people as (
    select u.id from app_users u
    where u.active and (u.role in ('sales', 'teamlead') or exists (select 1 from user_extra_roles x where x.user_id = u.id and x.role in ('sales', 'teamlead')))
    union select uid from pay union select uid from deals union select uid from manual
  ),
  totals as (
    select u.id, u.name, u.email::text as email, u.role::text as role, coalesce(u.salary, 0) as salary,
           coalesce(d.n, 0) as deals_closed, coalesce(d.quoted, 0) as quoted,
           coalesce((select sum(n) from pay where uid = u.id), 0)::int as payments,
           round(coalesce((select sum(amount) from pay where uid = u.id), 0), 2) as collected,
           round(coalesce((select sum(with_gst) from pay where uid = u.id), 0), 2) as collected_with_gst,
           round(coalesce((select sum(shared) from pay where uid = u.id), 0), 2) as shared_collected,
           coalesce((select sum(incentive) from daily where uid = u.id), 0) as daily_incentive,
           coalesce((select sum(incentive) from weekly where uid = u.id), 0) as weekly_incentive,
           coalesce(mn.amount, 0) as manual_incentive,
           coalesce((select jsonb_agg(jsonb_build_object('date', day, 'amount', amount, 'incentive', incentive) order by day) from daily where uid = u.id), '[]') as days,
           coalesce((select jsonb_agg(jsonb_build_object('week', week, 'amount', amount, 'incentive', incentive) order by week) from weekly where uid = u.id), '[]') as weeks
    from people p join app_users u on u.id = p.id
    left join deals d on d.uid = u.id
    left join manual mn on mn.uid = u.id
  ),
  scored as (
    select t.*, t.salary * r.elig_x as eligible_at, t.salary * r.month_x as monthly_at,
           (t.salary > 0 and t.collected >= t.salary * r.elig_x) as eligible,
           case when t.salary > 0 and t.collected >= t.salary * r.month_x then (
             select (s->>'pct')::numeric from jsonb_array_elements(r.slabs) with ordinality as e(s, i)
             where s->>'upTo' is null or t.collected < (s->>'upTo')::numeric order by i limit 1
           ) end as slab_pct
    from totals t, r
  )
  select id, name, email, role, salary,
         deals_closed, quoted, payments, collected, collected_with_gst, shared_collected,
         eligible_at, eligible, monthly_at,
         daily_incentive, weekly_incentive, coalesce(slab_pct, 0),
         round(collected * coalesce(slab_pct, 0) / 100, 2) as monthly_incentive,
         case when eligible then round(daily_incentive + weekly_incentive + round(collected * coalesce(slab_pct, 0) / 100, 2), 2) else 0 end as auto_incentive,
         manual_incentive,
         case when eligible then round(daily_incentive + weekly_incentive + round(collected * coalesce(slab_pct, 0) / 100, 2), 2) else 0 end + manual_incentive as total_incentive,
         days, weeks
  from scored
  order by collected desc, deals_closed desc, name
$$;

revoke all on function public.sales_incentive_report(text) from public, anon, authenticated;
grant execute on function public.sales_incentive_report(text) to service_role;
