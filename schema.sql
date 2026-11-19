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
  id          text primary key,
  name        text not null,
  print_name  text default '',
  price       numeric,
  category    text default '',          -- 主餐 / 單點 / 小點 / 飲品 / 冷凍包 …
  sort_order  numeric default 9999,
  stock       numeric,
  sold_out    boolean default false,
  consumes    jsonb default '[]'::jsonb,
  image_url   text,
  created_at  timestamptz default now(),
  thresholds  jsonb
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
  tables_used     text[]                       -- 併桌、加桌實際佔用的桌子，例如 {A6,A7}（未來功能）
);

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
--      last_close_time / last_close_order_id / store_holiday_dates（已轉入 store_calendar，程式改完後停用）
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

-- 所有報表共用的彙總函式（不含個資）。營業額一律為實收（扣折扣、退款）
-- 定義見 ANALYTICS_DATA_FIXES.md 第 0 節
create or replace function public.report_sessions(p_start date, p_end date)
returns table (
  business_date     date,
  meal_period       text,     -- 'lunch' | 'dinner'（依開單時間，15:45 分界）
  orders            int,
  dine_in_orders    int,
  takeout_orders    int,
  customers         int,      -- 訂單人數加總（不含只買冷凍包的訂單）
  dine_in_customers int,
  gross_revenue     numeric,  -- 有效發票 total 合計（折扣前）
  adjustment_amount numeric,  -- 折扣、退款，依原發票日期歸屬
  net_revenue       numeric,  -- 實收營業額
  frozen_revenue    numeric,  -- 冷凍包（另計）
  meal_net_revenue  numeric   -- 餐點實收，客單價分子
)
language sql stable security definer set search_path = public as $fn$
  with inv as (
    select i.* from invoices i where i.status = '已開立'
  ), ord as (
    select o.id, o.order_type, o.customer_count,
           (min(i.payment_time) at time zone 'Asia/Taipei')::date as business_date,
           case when ((o.timestamp at time zone 'Asia/Taipei')::time < time '15:45')
                then 'lunch' else 'dinner' end as meal_period,
           sum(i.total) as gross
    from orders o join inv i on i.order_id = o.id
    group by o.id
  ), items as (
    select i.order_id,
           sum(case when it->>'category' = '冷凍包'
                    then (it->>'price')::numeric * coalesce((it->>'quantity')::numeric, 1) else 0 end) as frozen,
           sum(case when coalesce(it->>'category', '') <> '冷凍包'
                    then (it->>'price')::numeric * coalesce((it->>'quantity')::numeric, 1) else 0 end) as meal
    from inv i, jsonb_array_elements(coalesce(i.items_snapshot, '[]'::jsonb)) it
    group by i.order_id
  ), adj as (
    select i.order_id, sum(a.amount) as amount
    from adjustments a join inv i on i.id = a.original_invoice_id
    group by i.order_id
  )
  select o.business_date, o.meal_period,
         count(*)::int,
         count(*) filter (where o.order_type = '內用')::int,
         count(*) filter (where o.order_type = '外帶')::int,
         coalesce(sum(o.customer_count) filter (where coalesce(it.meal, 0) > 0), 0)::int,
         coalesce(sum(o.customer_count) filter (where o.order_type = '內用' and coalesce(it.meal, 0) > 0), 0)::int,
         sum(o.gross),
         coalesce(sum(adj.amount), 0),
         sum(o.gross) + coalesce(sum(adj.amount), 0),
         coalesce(sum(it.frozen), 0),
         coalesce(sum(it.meal), 0) + coalesce(sum(adj.amount), 0)
  from ord o
  left join items it on it.order_id = o.id
  left join adj on adj.order_id = o.id
  where o.business_date between p_start and p_end
  group by 1, 2
  order by 1, 2;
$fn$;

revoke all on function public.report_sessions(date, date) from public;
grant execute on function public.report_sessions(date, date) to anon, authenticated, service_role;
grant execute on function public.get_orders_customer_count(integer[]) to anon, authenticated;

select 'Schema 建立/補齊完成' as result;
