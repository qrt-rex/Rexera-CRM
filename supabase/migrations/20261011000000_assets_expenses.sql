-- =====================================================================================================================
-- Rexera CRM · Company assets, inventory and expenses (HR)
--  - Assets: tracked one by one (tag RX-AST-0001), handed to employees, with a history of every hand-over and repair.
--  - Inventory: consumables counted by quantity, with stock in / out movements and a low-stock level.
--  - Expenses: company spending with GST, payment mode and the bill (file metadata; files go to Storage bucket "bills").
--  - Safe to run more than once.
-- =====================================================================================================================

create table if not exists company_assets (
  id text primary key default gen_random_uuid()::text,
  tag text not null unique,
  name text not null,
  category text not null,
  brand text, model text, serial text,
  purchase_date date, cost numeric(12,2) check (cost is null or cost >= 0), vendor text, warranty_until date,
  location text, condition text check (condition is null or condition in ('NEW', 'GOOD', 'FAIR', 'POOR')),
  status text not null default 'IN_STOCK' check (status in ('IN_STOCK', 'ASSIGNED', 'REPAIR', 'RETIRED')),
  assigned_to text references app_users(id) on delete set null,
  assigned_on date,
  notes text,
  invoice jsonb,                                   -- { id, name, type, size, at }
  created_at timestamptz not null default now(),
  check ((status = 'ASSIGNED') = (assigned_to is not null))
);
create unique index if not exists company_assets_serial_idx on company_assets (lower(serial)) where serial is not null;

create table if not exists asset_events (
  id bigint generated always as identity primary key,
  asset_id text not null references company_assets(id) on delete cascade,
  at timestamptz not null default now(),
  by_user text references app_users(id) on delete set null,
  action text not null check (action in ('ADDED', 'ASSIGNED', 'RETURNED', 'REPAIR', 'RETIRED', 'BACK_IN_STOCK', 'EDITED')),
  user_id text references app_users(id) on delete set null,
  note text
);
create index if not exists asset_events_asset_idx on asset_events(asset_id, at desc);

create table if not exists stock_items (
  id text primary key default gen_random_uuid()::text,
  name text not null unique,
  category text not null,
  unit text not null,
  qty integer not null default 0 check (qty >= 0),
  min_qty integer not null default 0 check (min_qty >= 0),
  unit_cost numeric(12,2) check (unit_cost is null or unit_cost >= 0),
  location text,
  created_at timestamptz not null default now()
);

create table if not exists stock_moves (
  id bigint generated always as identity primary key,
  item_id text not null references stock_items(id) on delete cascade,
  at timestamptz not null default now(),
  by_user text references app_users(id) on delete set null,
  qty integer not null check (qty <> 0),
  note text,
  issued_to text references app_users(id) on delete set null
);

create table if not exists company_expenses (
  id text primary key default gen_random_uuid()::text,
  spent_on date not null,
  category text not null,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  gst numeric(12,2) not null default 0 check (gst >= 0 and gst <= amount),
  vendor text,
  paid_via text not null check (paid_via in ('CASH', 'UPI', 'BANK', 'CARD', 'CHEQUE')),
  paid_by text references app_users(id) on delete set null,
  bill jsonb,
  added_by text references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists company_expenses_date_idx on company_expenses(spent_on desc);

alter table company_assets enable row level security;
alter table asset_events enable row level security;
alter table stock_items enable row level security;
alter table stock_moves enable row level security;
alter table company_expenses enable row level security;
