-- schema.sql
-- 咕咕義 WebPOS 資料庫結構（Supabase，public schema）
-- 2026-11-19 依正式資料庫實際結構重新產生，已包含 migrations/20261119_analytics_foundation.sql
--
-- 用途：記錄資料庫「現在長什麼樣子」，以及在新專案從零重建時使用。
-- 規則：之後任何資料表變更，都先寫成 supabase/migrations/YYYYMMDD_說明.sql 執行，再同步更新這份檔案。
-- 這份檔案不含任何會清空資料的指令；開始營業時的清空腳本是 init.sql，執行前務必先備份。
-- 可安全重複執行（IF NOT EXISTS / OR REPLACE）。

-- ================================================================
-- menu_items 菜單
-- ================================================================
create table if not exists public.menu_items (
  id                   text primary key,
  name                 text not null,
  print_name           text default '',
  customer_print_name  text,                     -- 顧客聯（結帳單）名稱，留空用 name；舊資料退回用 server.js 的 FULL_NAME_MAP
  price                numeric,
  category             text default '',          -- 主餐 / 單點 / 小點 / 飲品 / 冷凍包 …
  sort_order           numeric default 9999,
  stock                numeric,
  sold_out             boolean default false,
  consumes             jsonb default '[]'::jsonb,
  image_url            text,
  created_at           timestamptz default now(),
  thresholds           jsonb,
  bundle_composition   jsonb,                    -- 年菜套餐組成 [{"itemId":"...","qty":1}, ...]；單點品項維持 null
  nianfai_year         integer                   -- 這個品項今年要在年菜通路賣，值是年度（例如 2027）；不是年菜品項則為 null
);

-- ================================================================
-- remark_groups 備註群組
-- ================================================================
create table if not exists public.remark_groups (
  id              text primary key,
  name            text not null,
  remarks         jsonb default '[]'::jsonb,
  sort_order      integer default 99,
  created_at      timestamptz default now(),
  type            text default 'single',
  required        boolean default false,
  options         jsonb default '[]'::jsonb,
  applies_to      jsonb default '[]'::jsonb,
  option_item_map jsonb default '{}'::jsonb
);

-- ================================================================
-- tables 桌況（只有即時狀態，沒有歷史）
-- ================================================================
create table if not exists public.tables (
  table_number text primary key,          -- A1–A8
  status       text default 'idle',       -- idle / open / served / paid
  order_id     integer,
  updated_at   timestamptz default now(),
  seats        integer                    -- 桌位人數：A5、A8 = 4，其餘 = 2（合計 20 席）
);

-- ================================================================
-- orders 訂單（含個資欄位：customer_name、customer_phone、customer_id、special_notes、pickup_time）
-- status：open / served / paid / archived_paid / archived_voided / abandoned / merged / paid_report_complete（外帶封存）
-- ================================================================
create table if not exists public.orders (
  id              bigserial primary key,
  table_number    text,
  order_type      text default '內用',    -- 內用 / 外帶
  status          text default 'open',
  items           jsonb default '[]'::jsonb,
  total           numeric default 0,
  daily_order_no  integer,
  timestamp       timestamptz default now(),   -- 開單時間（入座時間以此為準）
  updated_at      timestamptz default now(),
  customer_count  integer default 1,           -- 來客數以此欄為準
  customer_name   text default '',
  customer_phone  text default '',
  customer_id     integer,
  needs_utensils  boolean default false,
  pickup_time     text,
  sub_total       numeric default 0,
  paid_amount     numeric default 0,
  send_time       bigint,                      -- 毫秒時間戳
  finish_time     bigint,                      -- 毫秒時間戳
  order_date      text,
  special_notes   jsonb default '[]'::jsonb,
  cleared_at      timestamptz,                 -- 清桌時間（未來功能，程式尚未寫入）
  tables_used     text[],                      -- 併桌、加桌實際佔用的桌子，例如 {A6,A7}（未來功能）
  is_new_group    boolean,                     -- 新客(true)/舊客(false)/未標記(null)，開單時選擇
  is_nianfai      boolean default false        -- 年菜訂單：報表排除依據，也用來判斷結帳時跳過扣庫存
);

-- ================================================================
-- nianfai_orders 年菜訂單明細（1 筆對應 1 筆 orders，is_nianfai=true）
-- 年菜專屬欄位獨立成表，不污染共用的 orders。流水號每年從 001 起，不含線上單
-- （線上單用表單時間戳記辨識，不在這張表）。
-- form_submission_status：pending(待送)/sent(已送)/failed(失敗，會重試)
-- ================================================================
create table if not exists public.nianfai_orders (
  order_id               bigint primary key references public.orders(id) on delete cascade,
  year                   integer not null,
  seq_no                 integer not null,
  customer_name          text,
  customer_phone         text,
  delivery_method        text check (delivery_method in ('pickup', 'delivery')),
  pickup_date            date,
  recipient_name         text,
  recipient_phone        text,
  recipient_address      text,
  form_submission_status text default 'pending',
  form_submission_error  text,
  created_at             timestamptz default now()
);
create unique index if not exists nianfai_orders_year_seq_idx on public.nianfai_orders (year, seq_no);
alter table public.nianfai_orders enable row level security;

-- ================================================================
-- invoices 發票（營收的事實來源；一張訂單分次結帳時會有多張）
-- status：已開立 / 已作廢
-- ================================================================
create table if not exists public.invoices (
  id              bigserial primary key,
  order_id        integer,                     -- 刻意不設外鍵：清桌流程會刪除未結帳訂單
  invoice_number  text unique,
  payment_method  text,                        -- 目前全現金，未寫入
  payment_time    timestamptz default now(),
  status          text default '已開立',
  total           numeric default 0,
  items_snapshot  jsonb default '[]'::jsonb,   -- 結帳當下的品項與成交單價
  daily_order_no  integer,
  created_at      timestamptz default now(),
  customer_count  integer default 0,           -- 結帳當下的快照，報表不使用
  table_name      text,
  order_type      text default '內用',
  void_time       text,
  amount          numeric default 0,
  items           jsonb default '[]'::jsonb    -- 舊欄位，已不使用
);
create index if not exists invoices_order_id_idx     on public.invoices (order_id);
create index if not exists invoices_payment_time_idx on public.invoices (payment_time);

-- ================================================================
-- adjustments 折扣、退款、補差價（計入實收營業額，日期歸到原發票）
-- ================================================================
create table if not exists public.adjustments (
  id                  uuid primary key default gen_random_uuid(),
  original_invoice_id integer not null references public.invoices(id),
  reason_preset       text not null check (reason_preset in ('出餐錯誤', '餐點問題', '補差價', '其他')),
  reason_note         text,                          -- 自由文字，不匯出
  amount              numeric not null,              -- 退款為負、補差價為正
  affected_items      jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now()
);
create index if not exists adjustments_invoice_idx on public.adjustments (original_invoice_id);

-- ================================================================
-- customers 外帶常客（個資，整張表不匯出）
-- ================================================================
create table if not exists public.customers (
  id          bigserial primary key,
  name        text,
  phone       text,
  email       text,
  notes       text,
  created_at  timestamptz default now(),
  names       text[] default '{}'::text[],
  phones      text[] default '{}'::text[]
);

-- ================================================================
-- app_settings 設定值
-- key：category_settings / quick_tags / reserve_amount / pending_transactions /
--      last_close_time / last_close_order_id / store_holiday_dates（已轉入 store_calendar，程式改完後停用） /
--      nianfai_<year>_season_active（年菜開賣/收單總開關） / nianfai_<year>_next_seq（年菜流水號計數器）
-- ================================================================
create table if not exists public.app_settings (
  key         text primary key,
  value       text,
  updated_at  timestamptz default now()
);

-- ================================================================
-- inventory_logs 庫存異動
-- ================================================================
create table if not exists public.inventory_logs (
  id            bigserial primary key,
  item_id       text not null,
  item_name     text,
  change_amount integer not null,
  note          text,
  created_at    timestamptz default now()
);
create index if not exists idx_inventory_logs_created_at on public.inventory_logs (created_at desc);
create index if not exists idx_inventory_logs_item_id    on public.inventory_logs (item_id);

-- ================================================================
-- store_calendar 營業日曆：只記和平常不同的日子；沒有紀錄 = 照常營業
-- ================================================================
create table if not exists public.store_calendar (
  date        date primary key,
  lunch_open  boolean not null default false,
  dinner_open boolean not null default false,
  note        text,
  updated_at  timestamptz not null default now()
);

-- ================================================================
-- turnaways 客滿婉拒、候位紀錄（未來功能）
-- ================================================================
create table if not exists public.turnaways (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  party_size  integer check (party_size > 0),
  kind        text not null default '婉拒' check (kind in ('婉拒', '候位')),
  note        text
);

-- ================================================================
-- Row Level Security
-- 全部資料表都啟用 RLS。POS 後端用 service role 金鑰，不受 RLS 限制。
-- 專案另有 Supabase 的 rls_auto_enable 事件觸發器，新建的資料表會自動啟用 RLS。
-- ================================================================
alter table public.menu_items     enable row level security;
alter table public.remark_groups  enable row level security;
alter table public.tables         enable row level security;
alter table public.orders         enable row level security;
alter table public.invoices       enable row level security;
alter table public.adjustments    enable row level security;
alter table public.customers      enable row level security;
alter table public.app_settings   enable row level security;
alter table public.inventory_logs enable row level security;
alter table public.store_calendar enable row level security;
alter table public.turnaways      enable row level security;

-- 目前開放匿名讀取的資料表（Vercel 儀表板使用）。
-- 注意：invoices 開放匿名讀取，拿到儀表板網址的人可讀到全部營業額；改用 report_sessions 後可考慮移除。
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='invoices' and policyname='allow anon read') then
    create policy "allow anon read" on public.invoices for select to public using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='menu_items' and policyname='allow anon read') then
    create policy "allow anon read" on public.menu_items for select to public using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='inventory_logs' and policyname='allow anon read') then
    create policy "allow anon read" on public.inventory_logs for select to public using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='adjustments' and policyname='anon select') then
    create policy "anon select" on public.adjustments for select to anon using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='adjustments' and policyname='service all') then
    create policy "service all" on public.adjustments for all to service_role using (true);
  end if;
end $$;

-- ================================================================
-- 函式
-- ================================================================

-- Vercel 儀表板用：只回傳訂單人數，繞過 orders 的 RLS
create or replace function public.get_orders_customer_count(order_ids integer[])
returns table (id integer, customer_count integer)
language sql security definer as $fn$
  select id, customer_count from orders where id = any(order_ids);
$fn$;

-- ================================================================
-- 報表共用 view（3 層，由淺到深）。只給下面 4 個 security definer 函式用，
-- 明確 revoke 掉 anon/authenticated，避免被 PostgREST 自動開成公開端點。
-- 設計與背景見 supabase/migrations/20261122_consolidate_report_rpcs.sql
-- ================================================================

-- 第 1 層：有效發票（status='已開立'）＋ 對應訂單欄位，列層級、不彙總
create or replace view public.report_valid_invoices as
select
  i.id               as invoice_id,
  i.order_id         as order_id,
  i.payment_time     as payment_time,
  i.total            as total,
  i.amount           as amount,
  i.items_snapshot   as items_snapshot,
  i.daily_order_no   as invoice_daily_order_no,
  i.invoice_number   as invoice_number,
  i.table_name       as invoice_table_name,
  i.order_type       as invoice_order_type,
  i.customer_count   as invoice_customer_count,
  o.timestamp        as order_timestamp,
  o.table_number     as order_table_number,
  o.order_type       as order_order_type,
  o.customer_count   as order_customer_count,
  o.daily_order_no   as order_daily_order_no,
  o.is_new_group     as order_is_new_group
from public.invoices i
left join public.orders o on o.id = i.order_id
where i.status = '已開立';

-- 第 2 層：每筆訂單彙總出 business_date／meal_period／營業額
create or replace view public.report_base_orders as
select
  o.id as order_id,
  o.order_type,
  o.customer_count,
  o.is_new_group,
  (min(v.payment_time) at time zone 'Asia/Taipei')::date as business_date,
  case when ((o.timestamp at time zone 'Asia/Taipei')::time < time '15:45')
       then 'lunch' else 'dinner' end as meal_period,
  sum(v.total) as gross_revenue
from public.orders o
join public.report_valid_invoices v on v.order_id = o.id
group by o.id;

-- 第 3 層：品項行展開，帶 business_date／meal_period
create or replace view public.report_item_lines as
select
  v.order_id,
  bo.business_date,
  bo.meal_period,
  bo.order_type,
  it->>'id' as item_id,
  it->>'name' as item_name,
  coalesce(it->>'category', '') as category,
  (it->>'price')::numeric as unit_price,
  coalesce((it->>'quantity')::numeric, 1) as quantity
from public.report_valid_invoices v
join public.report_base_orders bo on bo.order_id = v.order_id
cross join lateral jsonb_array_elements(coalesce(v.items_snapshot, '[]'::jsonb)) it;

revoke all on public.report_valid_invoices from public, anon, authenticated;
revoke all on public.report_base_orders    from public, anon, authenticated;
revoke all on public.report_item_lines     from public, anon, authenticated;

-- ================================================================
-- 報表函式（不含個資）。營業額一律為實收（扣折扣、退款）。定義見 ANALYTICS_DATA_FIXES.md 第 0 節
-- ================================================================

-- 彙總報表資料（午/晚各一列），四個地方的「營業額」「客單價」共用的單一來源
create or replace function public.report_sessions(p_start date, p_end date)
returns table (
  business_date        date,
  meal_period          text,     -- 'lunch' | 'dinner'（依開單時間，15:45 分界）
  orders               int,      -- 有有效發票的訂單數（含只買冷凍包的訂單）
  dine_in_orders       int,
  takeout_orders       int,
  customers            int,      -- 人數：訂單人數加總（含外帶份數，不含只買冷凍包的訂單）
  dine_in_customers    int,
  total_groups         int,      -- 組數：不含只買冷凍包的訂單（內用＋外帶）
  new_groups           int,
  new_customers        int,
  returning_groups     int,
  returning_customers  int,
  unmarked_groups      int,      -- 未標記新舊客的組數；new + returning + unmarked = total_groups
  unmarked_customers   int,
  gross_revenue        numeric,  -- 有效發票 total 合計（折扣前）
  adjustment_amount    numeric,  -- 折扣、退款，依原發票日期歸屬
  net_revenue          numeric,  -- 實收營業額
  frozen_revenue       numeric,  -- 冷凍包（另計）
  meal_net_revenue     numeric   -- 餐點實收，客單價分子
)
language sql stable security definer set search_path = public as $fn$
  with items as (
    select order_id,
           sum(case when category = '冷凍包' then unit_price * quantity else 0 end) as frozen,
           sum(case when category <> '冷凍包' then unit_price * quantity else 0 end) as meal
    from report_item_lines
    group by order_id
  ), adj as (
    select v.order_id, sum(a.amount) as amount
    from adjustments a
    join report_valid_invoices v on v.invoice_id = a.original_invoice_id
    group by v.order_id
  ), x as (
    select bo.*, coalesce(it.meal, 0) as meal, coalesce(it.frozen, 0) as frozen, coalesce(adj.amount, 0) as adj_amount,
           (coalesce(it.meal, 0) > 0) as is_meal_order
    from report_base_orders bo
    left join items it on it.order_id = bo.order_id
    left join adj on adj.order_id = bo.order_id
    where bo.business_date between p_start and p_end
  )
  select x.business_date, x.meal_period,
         count(*)::int,
         count(*) filter (where order_type = '內用')::int,
         count(*) filter (where order_type = '外帶')::int,
         coalesce(sum(customer_count) filter (where is_meal_order), 0)::int,
         coalesce(sum(customer_count) filter (where is_meal_order and order_type = '內用'), 0)::int,
         count(*) filter (where is_meal_order)::int,
         count(*) filter (where is_meal_order and is_new_group is true)::int,
         coalesce(sum(customer_count) filter (where is_meal_order and is_new_group is true), 0)::int,
         count(*) filter (where is_meal_order and is_new_group is false)::int,
         coalesce(sum(customer_count) filter (where is_meal_order and is_new_group is false), 0)::int,
         count(*) filter (where is_meal_order and is_new_group is null)::int,
         coalesce(sum(customer_count) filter (where is_meal_order and is_new_group is null), 0)::int,
         sum(gross_revenue),
         sum(adj_amount),
         sum(gross_revenue) + sum(adj_amount),
         sum(frozen),
         sum(meal) + sum(adj_amount)
  from x
  group by x.business_date, x.meal_period
  order by x.business_date, x.meal_period;
$fn$;

-- 品項銷售排行（POS 銷售排行頁、週報 email 可用；目前兩者仍各自重算，尚未改用這個）
create or replace function public.report_items(p_start date, p_end date)
returns table (
  business_date    date,
  meal_period      text,
  order_type       text,
  menu_item_id     text,
  item_name        text,
  category         text,
  unit_price       numeric,
  quantity         numeric,
  line_revenue     numeric,
  orders_with_item int
)
language sql stable security definer set search_path = public as $fn$
  select business_date, meal_period, order_type, item_id, max(item_name), max(category), unit_price,
         sum(quantity), sum(unit_price * quantity), count(distinct order_id)::int
  from report_item_lines
  where business_date between p_start and p_end
  group by business_date, meal_period, order_type, item_id, unit_price
  order by 1, 2, 3, 4;
$fn$;

-- 加點率／分類銷售彙總
create or replace function public.report_attach(p_start date, p_end date)
returns table (
  business_date        date,
  meal_period          text,
  order_type           text,
  category             text,
  orders_with_category int,
  quantity             numeric,
  line_revenue         numeric
)
language sql stable security definer set search_path = public as $fn$
  select business_date, meal_period, order_type, category,
         count(distinct order_id)::int, sum(quantity), sum(unit_price * quantity)
  from report_item_lines
  where business_date between p_start and p_end
  group by 1, 2, 3, 4
  order by 1, 2, 3, 4;
$fn$;

-- 發票／訂單明細（報表頁「歷史單據明細」、下載分析資料用）
create or replace function public.report_order_invoices(p_start_ts timestamptz, p_end_ts timestamptz)
returns table (
  invoice_order_id       bigint,
  invoice_daily_order_no integer,
  invoice_number         text,
  payment_time           timestamptz,
  total                  numeric,
  amount                 numeric,
  items_snapshot         jsonb,
  invoice_table_name     text,
  invoice_order_type     text,
  invoice_customer_count integer,
  order_timestamp        timestamptz,
  order_table_number     text,
  order_customer_count   integer,
  order_order_type       text,
  order_daily_order_no   integer,
  order_is_new_group     boolean
)
language sql stable security definer set search_path = public as $fn$
  select order_id, invoice_daily_order_no, invoice_number, payment_time, total, amount, items_snapshot,
         invoice_table_name, invoice_order_type, invoice_customer_count,
         order_timestamp, order_table_number, order_customer_count, order_order_type, order_daily_order_no,
         order_is_new_group
  from report_valid_invoices
  where (p_start_ts is null or payment_time >= p_start_ts)
    and (p_end_ts   is null or payment_time <  p_end_ts)
  order by payment_time;
$fn$;

revoke all on function public.report_sessions(date, date) from public;
revoke all on function public.report_items(date, date) from public;
revoke all on function public.report_attach(date, date) from public;
revoke all on function public.report_order_invoices(timestamptz, timestamptz) from public;
grant execute on function public.report_sessions(date, date) to anon, authenticated, service_role;
grant execute on function public.report_items(date, date) to anon, authenticated, service_role;
grant execute on function public.report_attach(date, date) to anon, authenticated, service_role;
grant execute on function public.report_order_invoices(timestamptz, timestamptz) to anon, authenticated, service_role;
grant execute on function public.get_orders_customer_count(integer[]) to anon, authenticated;

select 'Schema 建立/補齊完成' as result;
