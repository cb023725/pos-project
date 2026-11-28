-- data-fixes/prod-archive-orphan-order-449.sql
-- 歸檔沒有桌號的孤兒訂單 #449（2026-06-02 內用、松阪豬拌麵 280 元、已結帳），見 TECH_DEBT.md §3
-- Supabase SQL Editor 執行；關帳後做。
--
-- 只做「清桌」會做的事：status paid → archived_paid、補 cleared_at。
-- 不刪訂單、不刪或改發票（6/2 營業額本來就算進去了）、不改類型，報表數字不變。

-- ════════ 第 1 步：預覽（只讀） ════════
select o.id, o.status, o.order_type, o.table_number, o.is_nianfai,
       o.timestamp at time zone 'Asia/Taipei' as 開單時間, o.total, o.cleared_at,
       (select string_agg(i.id || ':' || i.status || ':' || coalesce(i.amount, i.total), '、') from public.invoices i where i.order_id = o.id) as 發票
from public.orders o
where o.id = 449;
-- 預期：paid、內用、桌號空、is_nianfai 不是 true、2026-06-02 16:51、280、cleared_at 空、發票 478:已開立:280

-- ════════ 第 2 步：歸檔（確認第 1 步後執行） ════════
do $$
declare n int;
begin
  select count(*) into n
  from public.orders o
  where o.id = 449
    and o.status = 'paid'
    and coalesce(o.table_number, '') = ''
    and o.is_nianfai is not true
    and exists (select 1 from public.invoices i where i.order_id = o.id and i.status = '已開立');
  if n <> 1 then
    raise exception '訂單 449 的狀態和預期不同（符合 % 筆），已停止，什麼都沒改', n;
  end if;
  update public.orders set status = 'archived_paid', cleared_at = now(), updated_at = now()
  where id = 449 and status = 'paid';
  raise notice '訂單 449 已歸檔（archived_paid）';
end $$;

-- 確認
select id, status, cleared_at from public.orders where id = 449;
