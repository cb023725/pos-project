-- supabase/migrations/20261119_analytics_foundation.sql
-- 2026-11-19 營運分析基礎：只新增，不刪除、不修改任何既有交易資料
-- 執行前的完整備份：~/Downloads/Supabase Snippet Untitled query.csv（2026-11-19 03:30）

begin;

-- 1. 欄位預設值改成和程式實際寫入的值一致（只影響之後沒有指定值的新資料）
alter table public.invoices alter column status     set default '已開立';
alter table public.orders   alter column order_type set default '內用';
alter table public.tables   alter column status     set default 'idle';

-- 2. 未來功能用的新欄位（程式更新前都是空值，不影響現有功能）
alter table public.orders add column if not exists cleared_at  timestamptz;  -- 清桌時間
alter table public.orders add column if not exists tables_used text[];       -- 併桌、加桌時實際佔用的桌子，例如 {A6,A7}
alter table public.tables add column if not exists seats integer;            -- 桌位人數

update public.tables
set seats = case when table_number in ('A5', 'A8') then 4 else 2 end
where table_number ~ '^A[1-8]$' and seats is null;

-- 3. 營業日曆：只記和平常不同的日子（全天休、只休午餐、只休晚餐）。沒有紀錄的日子 = 照常營業
create table if not exists public.store_calendar (
  date        date primary key,
  lunch_open  boolean not null default false,
  dinner_open boolean not null default false,
  note        text,
  updated_at  timestamptz not null default now()
);
alter table public.store_calendar enable row level security;

-- 把 app_settings.store_holiday_dates 現有的全天店休日期搬進來（原設定保留，等程式改完再停用）
insert into public.store_calendar (date, lunch_open, dinner_open, note)
select d::date, false, false, '由 store_holiday_dates 轉入'
from public.app_settings s, jsonb_array_elements_text(s.value::jsonb) d
where s.key = 'store_holiday_dates'
on conflict (date) do nothing;

-- 4. 客滿婉拒、候位紀錄（未來功能）
create table if not exists public.turnaways (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  party_size  integer check (party_size > 0),
  kind        text not null default '婉拒' check (kind in ('婉拒', '候位')),
  note        text
);
alter table public.turnaways enable row level security;

-- 5. 報表查詢常用的索引
create index if not exists invoices_order_id_idx     on public.invoices (order_id);
create index if not exists invoices_payment_time_idx on public.invoices (payment_time);

-- 6. 所有報表共用的彙總函式（不含個資）。營業額一律為實收（扣折扣、退款）
create or replace function public.report_sessions(p_start date, p_end date)
returns table (
  business_date     date,
  meal_period       text,     -- 'lunch' | 'dinner'
  orders            int,      -- 有有效發票的訂單數
  dine_in_orders    int,
  takeout_orders    int,
  customers         int,      -- 訂單人數加總（不含只買冷凍包的訂單）
  dine_in_customers int,
  gross_revenue     numeric,  -- 有效發票 total 合計（折扣前）
  adjustment_amount numeric,  -- 折扣、退款，依原發票日期歸屬
  net_revenue       numeric,  -- 實收營業額
  frozen_revenue    numeric,  -- 冷凍包（另計）
  meal_net_revenue  numeric   -- 餐點實收 = 品項金額（不含冷凍包）+ 折扣退款；客單價分子
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

commit;
