-- supabase/migrations/20261121_report_order_invoices_new_group.sql
-- report_order_invoices 加回傳 orders.is_new_group，讓報表頁「歷史單據明細」
-- 可以顯示每筆訂單的新客/舊客標記，不用再另外查一次 orders 表。

begin;

-- 回傳欄位有變（多一個 order_is_new_group），Postgres 不允許 create or replace 改變
-- RETURNS TABLE 的欄位組成，要先刪除舊的再重建
drop function if exists public.report_order_invoices(timestamptz, timestamptz);

create function public.report_order_invoices(p_start_ts timestamptz, p_end_ts timestamptz)
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
  select i.order_id, i.daily_order_no, i.invoice_number, i.payment_time, i.total, i.amount,
         i.items_snapshot, i.table_name, i.order_type, i.customer_count,
         o.timestamp, o.table_number, o.customer_count, o.order_type, o.daily_order_no, o.is_new_group
  from invoices i
  left join orders o on o.id = i.order_id
  where i.status = '已開立'
    and (p_start_ts is null or i.payment_time >= p_start_ts)
    and (p_end_ts   is null or i.payment_time <  p_end_ts)
  order by i.payment_time;
$fn$;

revoke all on function public.report_order_invoices(timestamptz, timestamptz) from public;
grant execute on function public.report_order_invoices(timestamptz, timestamptz) to anon, authenticated, service_role;

commit;
