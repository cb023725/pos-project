-- supabase/migrations/20261123_nianfai_phase1_schema.sql
-- 2027 年菜系統第一階段（開賣前）資料模型。只套在 dev 專案，不動 prod。
-- 背景與決策見 nianfai-handoff/NIANFAI_2027_HANDOFF.md。
--
-- 設計重點：
-- - 年菜品項就是 menu_items 的 row（文件要求「品項唯一來源是 menu management」），
--   不另外做品項表。bundle_composition 存套餐組成，nianfai_year 標記「今年要在年菜
--   通路賣」，兩者都是 nullable，不影響既有的一般菜單品項。
-- - 年菜訂單是獨立的 orders row（is_nianfai=true），專屬欄位（訂購人、取貨方式、
--   流水號…）獨立放 nianfai_orders，不污染共用的 orders 表。

begin;

alter table public.menu_items
  add column if not exists bundle_composition jsonb,
  add column if not exists nianfai_year integer;

alter table public.orders
  add column if not exists is_nianfai boolean default false;

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

-- report_valid_invoices / report_base_orders 排除年菜訂單，餐點營收/來客數/組數
-- 都不再含年菜。欄位沒變，用 create or replace 不用砍掉重建。
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
where i.status = '已開立'
  and (o.is_nianfai is not true);

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
where (o.is_nianfai is not true)
group by o.id;

commit;
