-- data-fixes/prod-delete-test-order-20261127.sql
-- 刪除 2026-11-27 部署後檢查用的一般測試單：內用 002、一碗雞湯（Supabase SQL Editor 執行）
--
-- 先在 WebPOS 發票頁把這張發票「作廢並恢復庫存」（庫存會自動補回、留下異動紀錄），再跑這份把訂單與發票刪掉，
-- 這樣它也不會出現在發票頁的作廢紀錄和錢櫃的本期作廢裡。
--
-- 鎖定條件（全部符合才算）：今天（台北時間）開單、內用、單號 2、不是年菜單、品項含「雞湯」。
-- 第 2 步會先數符合的筆數，不是剛好 1 筆就整段停止，什麼都不刪。

-- ════════ 第 1 步：預覽（只讀） ════════
select o.id as 訂單id, o.daily_order_no as 單號, o.order_type as 類型, o.table_number as 桌號, o.status as 狀態,
       o.total as 金額, o.timestamp at time zone 'Asia/Taipei' as 開單時間,
       (select string_agg(it->>'name' || '×' || coalesce(it->>'quantity', '1'), '、') from jsonb_array_elements(o.items) it) as 品項,
       (select string_agg(i.id || ':' || i.status || ':' || coalesce(i.amount, i.total), '、') from public.invoices i where i.order_id = o.id) as 發票
from public.orders o
where o.daily_order_no = 2
  and o.order_type = '內用'
  and o.is_nianfai is not true
  and (o.timestamp at time zone 'Asia/Taipei')::date = (now() at time zone 'Asia/Taipei')::date
  and o.items::text like '%雞湯%';
-- 預期剛好 1 列：內用、單號 2、品項雞湯、發票狀態「已作廢」（先在 WebPOS 作廢才會是已作廢）


-- ════════ 第 2 步：刪除（確認第 1 步只有那 1 筆後執行） ════════
do $$
declare
  n int;
  target bigint;
begin
  select count(*), max(o.id) into n, target
  from public.orders o
  where o.daily_order_no = 2
    and o.order_type = '內用'
    and o.is_nianfai is not true
    and (o.timestamp at time zone 'Asia/Taipei')::date = (now() at time zone 'Asia/Taipei')::date
    and o.items::text like '%雞湯%';
  if n <> 1 then
    raise exception '符合條件的訂單有 % 筆（應該剛好 1 筆），已停止，什麼都沒刪', n;
  end if;
  delete from public.adjustments where original_invoice_id in (select id from public.invoices where order_id = target);
  delete from public.invoices where order_id = target;
  update public.tables set status = 'idle', order_id = null, updated_at = now() where order_id = target;
  delete from public.orders where id = target and is_nianfai is not true;
  raise notice '已刪除訂單 % 與它的發票', target;
end $$;
