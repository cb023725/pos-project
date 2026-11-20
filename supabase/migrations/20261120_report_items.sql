-- supabase/migrations/20261120_report_items.sql
-- 品項分析用的共用函式，查詢主體與 report_sessions 使用相同的有效發票、營業日、餐期定義
-- （ANALYTICS_DATA_FIXES.md 第 9 節，SQL 內容已在正式資料庫用唯讀 SELECT 試跑過：
--  2026 年 10 月合計 $300,425、冷凍包 $13,400，與第 7 節一致）

begin;

create or replace function public.report_items(p_start date, p_end date)
returns table (
  business_date    date,
  meal_period      text,      -- 'lunch' | 'dinner'
  order_type       text,      -- 內用 / 外帶
  menu_item_id     text,
  item_name        text,
  category         text,      -- 主餐 / 單點 / 小點 / 飲品 / 冷凍包
  unit_price       numeric,   -- 成交單價（折扣前）
  quantity         numeric,
  line_revenue     numeric,
  orders_with_item int        -- 有點這個品項的訂單數
)
language sql stable security definer set search_path = public as $fn$
  with inv as (select * from invoices where status = '已開立'),
  ord as (
    select o.id, o.order_type,
           (min(i.payment_time) at time zone 'Asia/Taipei')::date as business_date,
           case when ((o.timestamp at time zone 'Asia/Taipei')::time < time '15:45') then 'lunch' else 'dinner' end as meal_period
    from orders o join inv i on i.order_id = o.id group by o.id
  ),
  li as (
    select i.order_id, it->>'id' as item_id, it->>'name' as item_name, coalesce(it->>'category', '') as category,
           (it->>'price')::numeric as price, coalesce((it->>'quantity')::numeric, 1) as qty
    from inv i, jsonb_array_elements(coalesce(i.items_snapshot, '[]'::jsonb)) it
  )
  select o.business_date, o.meal_period, o.order_type, li.item_id, max(li.item_name), max(li.category), li.price,
         sum(li.qty), sum(li.price * li.qty), count(distinct li.order_id)::int
  from li join ord o on o.id = li.order_id
  where o.business_date between p_start and p_end
  group by o.business_date, o.meal_period, o.order_type, li.item_id, li.price
  order by 1, 2, 3, 4;
$fn$;

create or replace function public.report_attach(p_start date, p_end date)
returns table (
  business_date        date,
  meal_period          text,
  order_type           text,
  category             text,
  orders_with_category int,     -- 加點率 = 這個數字 ÷ report_sessions 的 dine_in_orders（同日同餐期）
  quantity              numeric,
  line_revenue          numeric
)
language sql stable security definer set search_path = public as $fn$
  with inv as (select * from invoices where status = '已開立'),
  ord as (
    select o.id, o.order_type,
           (min(i.payment_time) at time zone 'Asia/Taipei')::date as business_date,
           case when ((o.timestamp at time zone 'Asia/Taipei')::time < time '15:45') then 'lunch' else 'dinner' end as meal_period
    from orders o join inv i on i.order_id = o.id group by o.id
  ),
  li as (
    select i.order_id, coalesce(it->>'category', '') as category,
           (it->>'price')::numeric as price, coalesce((it->>'quantity')::numeric, 1) as qty
    from inv i, jsonb_array_elements(coalesce(i.items_snapshot, '[]'::jsonb)) it
  )
  select o.business_date, o.meal_period, o.order_type, li.category,
         count(distinct li.order_id)::int, sum(li.qty), sum(li.price * li.qty)
  from li join ord o on o.id = li.order_id
  where o.business_date between p_start and p_end
  group by 1, 2, 3, 4
  order by 1, 2, 3, 4;
$fn$;

revoke all on function public.report_items(date, date)  from public;
revoke all on function public.report_attach(date, date) from public;
grant execute on function public.report_items(date, date)  to anon, authenticated, service_role;
grant execute on function public.report_attach(date, date) to anon, authenticated, service_role;

commit;
