-- data-fixes/nianfai-clear-test-orders.sql
-- 清除某一年度的「年菜」測試訂單（Supabase SQL Editor 手動執行用，備用）
--
-- 平常不需要：WebPOS 年菜管理頁「測試完畢，正式上線」會自動做同樣的事（server.js clearNianfaiYearOrders）。
-- 只有在那個按鈕沒辦法用、或正式上線後還要清測試單時才用這份。
--
-- 只會動到年菜資料，判斷條件「同時」符合：
--   1. nianfai_orders.year = 指定年度（年菜專屬表）
--   2. orders.is_nianfai = true
-- 一般營運的訂單 is_nianfai 是 false、也沒有 nianfai_orders 紀錄，不會被選到。
--
-- 會刪除（只限上面選到的年菜訂單）：
--   adjustments（這些訂單發票的折扣／退款）→ invoices（這些訂單的發票）→ nianfai_orders → orders
--   nianfai_seq_reservations（該年度的保留編號）
-- 不會動：一般訂單、一般發票、菜單、庫存、關帳設定、其他年度的年菜。
--
-- 用法：
--   第 1 步「預覽」整段貼上執行，確認列出來的都是測試單、一般訂單數字不變。
--   第 2 步「刪除」整段貼上執行（在 transaction 裡，最後會再印一次數量）。
--   年度預設 2027，要改年度請把下面所有的 2027 換掉（第 1、2 步都要改）。

-- ════════════════════════════════════════════════════════════════
-- 第 1 步：預覽（只讀，不會改任何資料）
-- ════════════════════════════════════════════════════════════════
with target as (
  select o.id
  from public.orders o
  join public.nianfai_orders n on n.order_id = o.id
  where n.year = 2027 and o.is_nianfai is true
)
select '要刪的年菜訂單' as 項目, count(*) as 數量 from target
union all
select '要刪的年菜發票', count(*) from public.invoices where order_id in (select id from target)
union all
select '要刪的折扣/退款', count(*) from public.adjustments
  where original_invoice_id in (select id from public.invoices where order_id in (select id from target))
union all
select '要刪的保留編號', count(*) from public.nianfai_seq_reservations where year = 2027
union all
select '（不會動）一般訂單總數', count(*) from public.orders where is_nianfai is not true
union all
select '（不會動）一般發票總數', count(*) from public.invoices i
  where not exists (select 1 from public.orders o where o.id = i.order_id and o.is_nianfai is true)
union all
select '（請確認為 0）年菜訂單但沒有 nianfai_orders 紀錄', count(*) from public.orders o
  where o.is_nianfai is true and not exists (select 1 from public.nianfai_orders n where n.order_id = o.id);

-- 要刪的年菜訂單明細（訂購編號＝年度後兩碼＋訂購日期＋流水號，對照 WebPOS／Sheet）
select n.seq_no as 流水號, n.customer_name as 訂購人, n.delivery_method as 取貨方式, n.pickup_date as 取貨日,
       o.total as 金額, o.status as 訂單狀態, n.created_at as 建立時間
from public.orders o
join public.nianfai_orders n on n.order_id = o.id
where n.year = 2027 and o.is_nianfai is true
order by n.created_at;


-- ════════════════════════════════════════════════════════════════
-- 第 2 步：刪除（確認第 1 步沒問題後，整段貼上執行）
-- ════════════════════════════════════════════════════════════════
begin;

create temporary table _nf_target on commit drop as
  select o.id
  from public.orders o
  join public.nianfai_orders n on n.order_id = o.id
  where n.year = 2027 and o.is_nianfai is true;

create temporary table _nf_invoices on commit drop as
  select id from public.invoices where order_id in (select id from _nf_target);

delete from public.adjustments where original_invoice_id in (select id from _nf_invoices);
delete from public.invoices    where id in (select id from _nf_invoices);
delete from public.nianfai_orders where order_id in (select id from _nf_target);
delete from public.orders      where id in (select id from _nf_target) and is_nianfai is true;
delete from public.nianfai_seq_reservations where year = 2027;

-- 訂購編號流水號回到 001（和「正式上線」一樣）
update public.app_settings set value = '1', updated_at = now() where key = 'nianfai_2027_next_seq';

-- 刪完再看一次：年菜都應該是 0，一般訂單／發票數字和第 1 步一樣
select '剩下的 2027 年菜訂單' as 項目, count(*) as 數量 from public.nianfai_orders where year = 2027
union all
select '一般訂單總數', count(*) from public.orders where is_nianfai is not true
union all
select '一般發票總數', count(*) from public.invoices i
  where not exists (select 1 from public.orders o where o.id = i.order_id and o.is_nianfai is true);

commit;
