-- =====================================================================================================================
-- Rexera CRM · Sales incentive report, calculated inside Supabase
--  - Same rules as the app (src/lib/payroll.ts → salesIncentive): collections are payment amounts before GST, credited
--    to the CRM entry's sales owner (bookings.created_by), using the latest incentive_rule_versions row.
--      daily   : rules.dailyPct % of every day with collections ≥ rules.dailyThreshold
--      weekly  : rules.weeklyPct % of every Monday–Sunday week ≥ rules.weeklyThreshold
--      monthly : slab % of the month's collections once they reach salary × rules.monthlyMultiple
--      nothing automatic is paid below salary × rules.eligibilityMultiple (or when no salary is set)
--  - Also returns what the incentive is based on: deals closed, quoted value, collections with GST, the daily and weekly
--    breakdown, and incentives HR added by hand (manual_incentives).
--  - Deal date = bookings.booking_date, else the old CRM's payment_date (imported files), else the day it was created (IST).
--  - security invoker: row-level security still applies, so only the server (secret key) gets rows.
--  - Safe to run more than once.
-- =====================================================================================================================

create or replace function public.sales_incentive_report(p_month text)
returns table (
  user_id text, name text, email text, role text, salary numeric,
  deals_closed int, quoted numeric, payments int, collected numeric, collected_with_gst numeric,
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
  pay as (                                   -- collections per owner per day
    select b.created_by as uid, p.paid_on as day, sum(p.amount) as amount, sum(p.total) as with_gst, count(*)::int as n
    from booking_payments p join bookings b on b.id = p.booking_id, m
    where b.created_by is not null and p.paid_on >= m.first_day and p.paid_on < m.next_month
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
    select b.created_by as uid, count(*)::int as n, sum(b.total_quoted) as quoted
    from bookings b, m
    where b.created_by is not null and b.status <> 'REJECTED'
      and coalesce(
            b.booking_date,
            case when b.legacy->'crm'->>'payment_date' ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$' then (b.legacy->'crm'->>'payment_date')::date end,
            (b.created_at at time zone 'Asia/Kolkata')::date
          ) >= m.first_day
      and coalesce(
            b.booking_date,
            case when b.legacy->'crm'->>'payment_date' ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$' then (b.legacy->'crm'->>'payment_date')::date end,
            (b.created_at at time zone 'Asia/Kolkata')::date
          ) < m.next_month
    group by 1
  ),
  manual as (
    select mi.user_id as uid, sum(mi.amount) as amount from manual_incentives mi where mi.month = p_month group by 1
  ),
  people as (                                -- active sales people and team leaders, plus anyone with deals or collections
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
         deals_closed, quoted, payments, collected, collected_with_gst,
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

-- only the server calls this (with the secret key); never the browser
revoke all on function public.sales_incentive_report(text) from public, anon, authenticated;
grant execute on function public.sales_incentive_report(text) to service_role;
