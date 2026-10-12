-- =====================================================================================================================
-- Rexera CRM · Monthly sales targets per person and team (the team scorecards: Team A, BRD, Team Y …)
--  - One row per person per month. user_id links to the CRM user; people not in the CRM yet keep their name only.
--  - reported_collection is the collection the team's own scorecard shows, kept next to what the CRM records so the two
--    can be compared on Sales Incentives · Supabase.
--  - Only the server (secret key) reads or writes it: row-level security is on and there are no policies.
--  - Safe to run more than once.
-- =====================================================================================================================

create table if not exists sales_targets (
  month                char(7) not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  name                 text not null check (length(trim(name)) >= 2),
  team                 text not null,
  user_id              text references app_users(id) on delete set null,
  target               numeric(14,2) not null check (target >= 0),
  reported_collection  numeric(14,2),
  scorecard_rank       int,
  source               text not null default '',
  updated_at           timestamptz not null default now(),
  primary key (month, name)
);
create index if not exists sales_targets_user_idx on sales_targets(user_id, month);
alter table sales_targets enable row level security;
