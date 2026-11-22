-- supabase/migrations/20261122c_sync_dev_to_prod_schema.sql
-- dev、prod 是兩個獨立的 Supabase 專案，這段時間各自套用 migration 的時間點不同，
-- 導致欄位型別／預設值／約束累積出落差。這份 migration 只套用在 dev，把 dev 的
-- 資料庫「結構」（欄位型別、預設值、NOT NULL、索引/約束）對齊 prod，不搬動任何
-- 既有資料列（dev 原本的測試資料維持不變，只有欄位本身的型別/預設值改變）。
--
-- 背景：report_valid_invoices / report_base_orders 直接參照 orders.id / invoices.id，
-- 這兩欄要從 integer 改成 bigint，Postgres 不允許在有 view 依賴時直接改型別，
-- 所以要先刪掉 3 個 report view（與建立在其上的 4 個函式），改完欄位型別後再重建。

begin;

-- ── 第 0 步：先刪掉有依賴關係的 view / 函式，改完欄位型別後在檔案最後重建 ──────────
drop function if exists public.report_sessions(date, date);
drop function if exists public.report_items(date, date);
drop function if exists public.report_attach(date, date);
drop function if exists public.report_order_invoices(timestamptz, timestamptz);
drop view if exists public.report_item_lines;
drop view if exists public.report_base_orders;
drop view if exists public.report_valid_invoices;

-- ── orders ──────────────────────────────────────────────────────────────────
alter table public.orders
  alter column id            type bigint,
  alter column total         type numeric,
  alter column sub_total     type numeric,
  alter column paid_amount   type numeric,
  alter column daily_order_no drop default,
  alter column finish_time   type bigint using finish_time::bigint,
  alter column send_time     type bigint using send_time::bigint,
  alter column order_date    type text using (
    replace(to_char(order_date at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS'), ' ', 'T') || 'Z'
  );

-- ── invoices ────────────────────────────────────────────────────────────────
alter table public.invoices
  alter column id              type bigint,
  alter column total           type numeric,
  alter column amount          type numeric,
  alter column customer_count  set default 0,
  alter column daily_order_no  drop default,
  alter column payment_time    set default now(),
  alter column table_name      drop default;
alter table public.invoices add column if not exists payment_method text;
alter table public.invoices drop column if exists updated_at;
alter table public.invoices drop constraint if exists invoices_order_id_fkey;
alter table public.invoices add constraint invoices_invoice_number_key unique (invoice_number);

-- ── menu_items ──────────────────────────────────────────────────────────────
alter table public.menu_items
  alter column name       set not null,
  alter column category   set default '',
  alter column consumes   set default '[]'::jsonb,
  alter column price      type numeric,
  alter column price      drop default,
  alter column sort_order type numeric,
  alter column sort_order set default 9999,
  alter column stock      type numeric;
alter table public.menu_items add column if not exists created_at timestamptz default now();

-- ── remark_groups ───────────────────────────────────────────────────────────
alter table public.remark_groups
  alter column name    set not null,
  alter column remarks set default '[]'::jsonb;
alter table public.remark_groups add column if not exists created_at timestamptz default now();

-- ── customers：補上 prod 有的欄位，刪掉 prod 沒有的舊版遺留欄位（程式都沒在用）──
alter table public.customers add column if not exists created_at timestamptz default now();
alter table public.customers add column if not exists email text;
alter table public.customers drop column if exists "createdAt";
alter table public.customers drop column if exists "lastVisit";
alter table public.customers drop column if exists "visitCount";

-- ── 補一個 prod 有、dev 沒有、但目前程式沒有呼叫的舊函式（純粹求結構一致）───────
create or replace function public.get_orders_customer_count(order_ids integer[])
returns table(id integer, customer_count integer)
language sql
security definer
as $function$
    select id, customer_count from orders where id = any(order_ids);
$function$;

-- ── 重建第 1～3 層 view（內容與 20261122_consolidate_report_rpcs.sql 完全相同）──
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

-- ── 重建 4 個報表函式（內容與 20261122_consolidate_report_rpcs.sql 完全相同）────
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
