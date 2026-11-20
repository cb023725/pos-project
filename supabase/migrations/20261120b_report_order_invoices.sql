-- supabase/migrations/20261120b_report_order_invoices.sql
-- 把 /api/orders/report 原本「先查發票、再依 order_id 查訂單」的兩次依序查詢，
-- 合併成資料庫端一次 join，省掉一次網路往返（量測：每次往返約 100-130ms）。
-- 刻意不對 invoices.order_id 加外鍵（見 schema.sql 註解：清桌流程會刪除未結帳訂單），
-- 所以這裡用 left join，訂單已被刪除時 order_* 欄位為 null，比照原本 JS 端 oMap.get() 找不到時的行為。

begin;

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
  order_daily_order_no   integer
)
language sql stable security definer set search_path = public as $fn$
  select i.order_id, i.daily_order_no, i.invoice_number, i.payment_time, i.total, i.amount,
         i.items_snapshot, i.table_name, i.order_type, i.customer_count,
         o.timestamp, o.table_number, o.customer_count, o.order_type, o.daily_order_no
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
