-- supabase/migrations/20261124_nianfai_revision01_phaseA.sql
-- 年菜系統修正單 #01（2026-11-24）Phase A：資料模型基礎建設。
-- 背景見 /Users/kai/Downloads/NIANFAI REVISION 01。

begin;

-- 年菜品項對應的冷凍包庫存 id，只用於年菜庫存頁顯示現有庫存數，
-- 不是 consumes（不會扣庫存）——年菜不扣冷凍包庫存，冷凍包照常自己的邏輯扣。
alter table public.menu_items
  add column if not exists nianfai_stock_ref text;

-- 流水號保留制：「確認訂購」當下就要保留流水號並印顧客聯，但這時候還沒有
-- 真正的 orders/invoices（要等「結帳」才建立），所以需要一張獨立於 orders
-- 的表記錄保留狀態。reserved=已確認訂購、used=已結帳（對應到 nianfai_orders）、
-- abandoned=客人最後沒買，按下「取消」才會標記。
create table if not exists public.nianfai_seq_reservations (
  id              bigint generated always as identity primary key,
  year            integer not null,
  seq_no          integer not null,
  status          text not null default 'reserved' check (status in ('reserved', 'used', 'abandoned')),
  items_snapshot  jsonb not null,       -- 「確認訂購」當下的購物車內容，結帳前拿來比對購物車有沒有被改過
  delivery_method text not null check (delivery_method in ('pickup', 'delivery')),
  pickup_date     date,
  total           numeric not null,
  confirmed_at    timestamptz default now(),
  used_at         timestamptz,
  abandoned_at    timestamptz
);
create unique index if not exists nianfai_seq_reservations_year_seq_idx
  on public.nianfai_seq_reservations (year, seq_no);
alter table public.nianfai_seq_reservations enable row level security;

commit;
