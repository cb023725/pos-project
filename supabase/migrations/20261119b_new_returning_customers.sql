-- supabase/migrations/20261119b_new_returning_customers.sql
-- 新舊客紀錄與國定假日。只新增欄位、重建報表函式，不修改任何既有訂單資料。

begin;

-- 1. 新舊客：以「組」（一張訂單）為單位
--    true = 新客組；false = 舊客組（組內只要有一人來過）；null = 未標記（功能上線前的訂單一律為 null，不回補）
--    刻意不設預設值：要等 POS 介面上線後由程式在開單時寫入，否則上線前的訂單會被自動標成新客
alter table public.orders add column if not exists is_new_group boolean;
comment on column public.orders.is_new_group is
  '新客組 true / 舊客組 false / 未標記 null。由經營者依印象判斷；沒印象、確定沒來過或不常來視為新客；組內有人來過即為舊客。';

-- 2. 營業日曆：國定假日名稱（例如 國慶日）。有營業的國定假日也要建一筆，lunch_open、dinner_open 設為 true
alter table public.store_calendar add column if not exists public_holiday text;

-- 3. 報表函式加入新舊客欄位。回傳欄位有變，必須先刪除再建立（目前還沒有程式在呼叫它）
drop function if exists public.report_sessions(date, date);

create function public.report_sessions(p_start date, p_end date)
returns table (
  business_date        date,
  meal_period          text,     -- 'lunch' | 'dinner'（依開單時間，15:45 分界）
  orders               int,      -- 有有效發票的訂單數（含只買冷凍包的訂單）
  dine_in_orders       int,
  takeout_orders       int,
  customers            int,      -- 人數：訂單人數加總（含外帶份數，不含只買冷凍包的訂單）
  dine_in_customers    int,
  total_groups         int,      -- 組數：不含只買冷凍包的訂單（內用 + 外帶）
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
  with inv as (
    select i.* from invoices i where i.status = '已開立'
  ), ord as (
    select o.id, o.order_type, o.customer_count, o.is_new_group,
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
  ), x as (
    select o.*, coalesce(it.meal, 0) as meal, coalesce(it.frozen, 0) as frozen, coalesce(adj.amount, 0) as adj_amount,
           (coalesce(it.meal, 0) > 0) as is_meal_order
    from ord o
    left join items it on it.order_id = o.id
    left join adj on adj.order_id = o.id
    where o.business_date between p_start and p_end
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
         sum(gross),
         sum(adj_amount),
         sum(gross) + sum(adj_amount),
         sum(frozen),
         sum(meal) + sum(adj_amount)
  from x
  group by x.business_date, x.meal_period
  order by x.business_date, x.meal_period;
$fn$;

revoke all on function public.report_sessions(date, date) from public;
grant execute on function public.report_sessions(date, date) to anon, authenticated, service_role;

commit;
