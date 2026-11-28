-- supabase/migrations/20261123c_nianfai_report_revenue.sql
-- 年菜報表統計：report_sessions 補上 nianfai_revenue，做法比照冷凍包的 frozen_revenue。
-- 背景：nianfai-handoff/NIANFAI_2027_HANDOFF.md 第 61、271 行「報表排除年菜，做法和冷凍包
-- 相同，年菜另外統計」——Phase 1 只做了「排除」（report_valid_invoices/report_base_orders
-- 直接濾掉 is_nianfai 訂單），沒有補「另外統計」那一半，年菜營業額在 Reports.js 完全看不到。
--
-- 年菜訂單整張被 report_valid_invoices 排除，所以不能從 report_item_lines 算，
-- 改成直接查 invoices+orders 另外算一份，用 business_date/meal_period 當 key 跟主查詢
-- full outer join 起來——避免「某個時段只有年菜訂單、完全沒有一般餐點訂單」時，
-- 因為主查詢（report_base_orders 來源）沒有那個 key 而整列憑空消失、年菜金額跟著不見。

begin;

-- 回傳型別多了一欄，create or replace 會因為型別改變被拒絕，要先 drop
drop function if exists public.report_sessions(date, date);

create function public.report_sessions(p_start date, p_end date)
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
  meal_net_revenue     numeric,
  nianfai_revenue       numeric  -- 年菜（另計，不計入來客數/組數，不含作廢發票）
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
  ), main as (
    select x.business_date, x.meal_period,
           count(*)::int as orders,
           count(*) filter (where order_type = '內用')::int as dine_in_orders,
           count(*) filter (where order_type = '外帶')::int as takeout_orders,
           coalesce(sum(customer_count) filter (where is_meal_order), 0)::int as customers,
           coalesce(sum(customer_count) filter (where is_meal_order and order_type = '內用'), 0)::int as dine_in_customers,
           count(*) filter (where is_meal_order)::int as total_groups,
           count(*) filter (where is_meal_order and is_new_group is true)::int as new_groups,
           coalesce(sum(customer_count) filter (where is_meal_order and is_new_group is true), 0)::int as new_customers,
           count(*) filter (where is_meal_order and is_new_group is false)::int as returning_groups,
           coalesce(sum(customer_count) filter (where is_meal_order and is_new_group is false), 0)::int as returning_customers,
           count(*) filter (where is_meal_order and is_new_group is null)::int as unmarked_groups,
           coalesce(sum(customer_count) filter (where is_meal_order and is_new_group is null), 0)::int as unmarked_customers,
           sum(gross_revenue) as gross_revenue,
           sum(adj_amount) as adjustment_amount,
           sum(gross_revenue) + sum(adj_amount) as net_revenue,
           sum(frozen) as frozen_revenue,
           sum(meal) + sum(adj_amount) as meal_net_revenue
    from x
    group by x.business_date, x.meal_period
  ), nf as (
    select
      (i.payment_time at time zone 'Asia/Taipei')::date as business_date,
      case when ((o.timestamp at time zone 'Asia/Taipei')::time < time '15:45')
           then 'lunch' else 'dinner' end as meal_period,
      sum(i.total) as revenue
    from public.invoices i
    join public.orders o on o.id = i.order_id
    where i.status = '已開立' and o.is_nianfai is true
    group by 1, 2
  )
  select
    coalesce(main.business_date, nf.business_date),
    coalesce(main.meal_period, nf.meal_period),
    coalesce(main.orders, 0),
    coalesce(main.dine_in_orders, 0),
    coalesce(main.takeout_orders, 0),
    coalesce(main.customers, 0),
    coalesce(main.dine_in_customers, 0),
    coalesce(main.total_groups, 0),
    coalesce(main.new_groups, 0),
    coalesce(main.new_customers, 0),
    coalesce(main.returning_groups, 0),
    coalesce(main.returning_customers, 0),
    coalesce(main.unmarked_groups, 0),
    coalesce(main.unmarked_customers, 0),
    coalesce(main.gross_revenue, 0),
    coalesce(main.adjustment_amount, 0),
    coalesce(main.net_revenue, 0),
    coalesce(main.frozen_revenue, 0),
    coalesce(main.meal_net_revenue, 0),
    coalesce(nf.revenue, 0)
  from main
  full outer join nf on nf.business_date = main.business_date and nf.meal_period = main.meal_period
  where coalesce(main.business_date, nf.business_date) between p_start and p_end
  order by 1, 2;
$fn$;

revoke all on function public.report_sessions(date, date) from public;
grant execute on function public.report_sessions(date, date) to anon, authenticated, service_role;

commit;
