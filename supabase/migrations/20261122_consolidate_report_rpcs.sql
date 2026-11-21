-- supabase/migrations/20261122_consolidate_report_rpcs.sql
-- 把 report_sessions / report_items / report_attach / report_order_invoices
-- 共用的「有效發票 + business_date + meal_period」join 邏輯抽成共用的 view，
-- 四個函式改成各自在共用結果上面做彙總，不再各自重複 join 一次。
-- 背景與風險說明見 ANALYTICS_DATA_FIXES.md 第 11 節。
--
-- 設計（由淺到深三層 view，report_order_invoices 只用第一層、不需要彙總）：
--   1. report_valid_invoices：有效發票（status='已開立'）＋ 對應訂單欄位，列層級、不彙總
--      —— report_order_invoices 直接查這層，效能跟現在一樣（單純 join，可被 planner 內聯）
--   2. report_base_orders：以上面那層依 order_id 彙總，算出 business_date／meal_period／營業額
--      —— report_sessions／report_items／report_attach 都從這層出發
--   3. report_item_lines：發票品項展開（jsonb_array_elements），帶上第 2 層的 business_date／meal_period
--      —— report_items／report_attach 直接用；report_sessions 的冷凍/餐點拆分也從這層彙總
--
-- 這三個 view 只給資料庫內部的 security definer 函式用，明確 revoke 掉 anon/authenticated
-- 的存取權，避免被 PostgREST 自動開成公開端點（繞過原本函式層級的存取控制）。

begin;

-- ── 第 1 層：有效發票 + 訂單欄位（列層級）──────────────────────────────────────
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

-- ── 第 2 層：每筆訂單彙總出 business_date／meal_period／營業額 ─────────────────
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

-- ── 第 3 層：品項行展開，帶 business_date／meal_period ────────────────────────
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

-- ── report_sessions：改用第 2／3 層 ───────────────────────────────────────────
create or replace function public.report_sessions(p_start date, p_end date)
returns table (
  business_date        date,
  meal_period          text,
  orders               int,
  dine_in_orders       int,
  takeout_orders       int,
  customers            int,
  dine_in_customers    int,
  total_groups         int,
  new_groups           int,
  new_customers        int,
  returning_groups     int,
  returning_customers  int,
  unmarked_groups      int,
  unmarked_customers   int,
  gross_revenue        numeric,
  adjustment_amount    numeric,
  net_revenue          numeric,
  frozen_revenue       numeric,
  meal_net_revenue     numeric
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

-- ── report_items：改用第 3 層 ─────────────────────────────────────────────────
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

-- ── report_attach：改用第 3 層 ────────────────────────────────────────────────
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

-- ── report_order_invoices：改用第 1 層（單純 view，可被 planner 內聯，效能不變）──
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

commit;
