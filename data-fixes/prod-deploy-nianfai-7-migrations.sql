-- 正式環境部署：年菜 7 個 migration 合併成一份（順序已排好，整份貼進 Supabase SQL Editor 執行一次）
-- 全部是「新增」欄位／資料表／年菜品項，不修改、不刪除任何既有營業資料；可重複執行（第二次不會重複新增）。
-- 2026-11-27 本機空白資料庫預演：依序執行與重跑都成功。

-- ════════ 20261123_nianfai_phase1_schema.sql ════════
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


-- ════════ 20261123b_nianfai_phase2_sellout.sql ════════
-- supabase/migrations/20261123b_nianfai_phase2_sellout.sql
-- 2027 年菜系統第二階段（收單前）：庫存與停售機制。
-- 背景見 nianfai-handoff/NIANFAI_2027_HANDOFF.md 第 2 節「庫存與停售」。
--
-- nianfai_sellout_cap 為 null = 還在製作中，不設上限；
-- 按下「製作完成」的當下把 nianfai_production_qty 複製成這個值，之後不再變動，
-- 即是停售上限。平常也賣的 5 項不使用這組欄位（維持用既有的 menu_items.stock）。

begin;

alter table public.menu_items
  add column if not exists nianfai_production_qty integer,
  add column if not exists nianfai_sellout_cap integer;

commit;


-- ════════ 20261123c_nianfai_report_revenue.sql ════════
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


-- ════════ 20261124_nianfai_revision01_phaseA.sql ════════
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


-- ════════ 20261124b_nianfai_revision01_phaseD.sql ════════
-- supabase/migrations/20261124b_nianfai_revision01_phaseD.sql
-- 年菜系統修正單 #01 Phase D：資料後補與送出表單（第 4、6 節）。
--
-- form_submission_status 狀態：
--   incomplete = 資料待補（結帳後的預設狀態，客人手寫在存根聯、還沒補登）
--   pending    = 資料已補齊、已按送出，等待送 GAS（GAS 網址未設定時停在這裡）
--   sent       = 已送出表單
--   failed     = 送出失敗（5 分鐘重試）
-- 原本預設是 pending，Phase C 結帳後的單資料還是空的，但重試計時器只看 pending
-- 就會送——一旦設定 GAS 網址，未補資料的單也會被送出去。這裡改預設並回填。

begin;

alter table public.nianfai_orders
  alter column form_submission_status set default 'incomplete';

-- 客人有填 email 就用客人的，沒填送表單時用店家預設 email
alter table public.nianfai_orders
  add column if not exists customer_email text;

-- 成功送出表單的時間（結帳時間在 orders.timestamp）
alter table public.nianfai_orders
  add column if not exists submitted_at timestamptz;

update public.nianfai_orders
   set form_submission_status = 'incomplete'
 where form_submission_status = 'pending'
   and (customer_name is null or customer_name = '');

commit;


-- ════════ 20261126_nianfai_2027_items_prod_seed.sql ════════
-- supabase/migrations/20261126_nianfai_2027_items_prod_seed.sql
-- 正式環境部署用：建立 2027 年菜 11 個品項（從 dev 複製，id／名稱／價格／排序／套餐組成相同）。
-- 執行順序：20261123 ～ 20261124b → 本檔 → 20261124c（建年節限定 5 項的「年菜庫存」並補上 nianfai_stock_ref）。
-- 平常也賣的 5 項（牛腩筋、排骨、XO醬、兩種腰果）指向冷凍包庫存，id 已確認正式環境相同。
-- 不設定目前年度（nianfai_active_year）：部署後年菜畫面全部隱藏，等 Yw 要開始準備時再設。
-- 在 dev 執行無影響（on conflict do nothing）。

begin;

insert into public.menu_items (id, name, print_name, customer_print_name, price, category, sort_order, stock, sold_out, consumes, nianfai_year, bundle_composition, nianfai_stock_ref)
values
  ('fugui_set', '富貴套餐', '', '', 3500, '年菜', 1, 0, false, '[]'::jsonb, 2027, '[{"qty":1,"itemId":"abalone_ginseng_soup"},{"qty":1,"itemId":"nf_pork_ribs_2027"},{"qty":1,"itemId":"herbal_shaoxing_pork"},{"qty":1,"itemId":"preserved_veg_pork"},{"qty":1,"itemId":"sesame_wine_shrimp"},{"qty":1,"itemId":"huadiao_chicken"}]'::jsonb, null),
  ('abalone_ginseng_soup', '鮑魚人蔘雞湯', '', '', 1380, '年菜', 2, 0, false, '[]'::jsonb, 2027, null, null),
  ('nf_beef_stew_2027', '紅燒牛腩筋', '', '', 380, '年菜', 3, 0, false, '[]'::jsonb, 2027, null, 'inv_1775499142948'),
  ('nf_pork_ribs_2027', '無錫排骨', '', '', 380, '年菜', 4, 0, false, '[]'::jsonb, 2027, null, 'inv_1775499157078'),
  ('preserved_veg_pork', '鹹菜干滷肉', '', '', 450, '年菜', 5, 0, false, '[]'::jsonb, 2027, null, null),
  ('sesame_wine_shrimp', '麻油酒香鮮蝦', '', '', 450, '年菜', 6, 0, false, '[]'::jsonb, 2027, null, null),
  ('herbal_shaoxing_pork', '藥膳紹興松阪豬', '', '', 450, '年菜', 7, 0, false, '[]'::jsonb, 2027, null, null),
  ('huadiao_chicken', '花雕雞', '', '', 480, '年菜', 8, 0, false, '[]'::jsonb, 2027, null, null),
  ('nf_cashew_sugar_2027', '糖霜腰果', '', '', 300, '年菜', 9, 0, false, '[]'::jsonb, 2027, null, 'inv_1779366303887'),
  ('nf_cashew_mild_2027', '薄鹽腰果', '', '', 300, '年菜', 10, 0, false, '[]'::jsonb, 2027, null, 'inv_1779366289525'),
  ('nf_xo_sauce_2027', '海味XO醬', '', '', 320, '年菜', 11, 0, false, '[]'::jsonb, 2027, null, 'inv_1775499177326')
on conflict (id) do nothing;

commit;


-- ════════ 20261124c_nianfai_stock_category.sql ════════
-- supabase/migrations/20261124c_nianfai_stock_category.sql
-- 年菜修正單 #01 後續（2026-11-24 Yw 要求）：庫存統一在庫存管理頁修改。
-- 年節限定品項的「製作入庫量」改成庫存管理頁的「年菜庫存」分類品項，
-- 年菜品項用 nianfai_stock_ref 指過去（跟平常也賣的 5 項指向冷凍包庫存同一套機制）。
-- 年菜結帳仍不扣庫存；製作完成時以當下年菜庫存數作為停售上限。
-- 年菜庫存 id 規則：nfstock_<年度>_<年菜品項 id>，庫存管理頁只顯示目前年度（未封存時）。
-- menu_items.nianfai_production_qty 不再使用（保留欄位，不刪資料）。

begin;

insert into public.menu_items (id, name, print_name, customer_print_name, price, category, sort_order, stock, sold_out, consumes, thresholds)
values
  ('nfstock_2027_abalone_ginseng_soup', '鮑魚人蔘雞湯',   '', '', null, '年菜庫存', 1, coalesce((select nianfai_production_qty from public.menu_items where id = 'abalone_ginseng_soup'), 0), false, '[]', '{"low":3,"full":10,"urgent":0,"disabled":true}'),
  ('nfstock_2027_preserved_veg_pork',   '鹹菜干滷肉',     '', '', null, '年菜庫存', 2, coalesce((select nianfai_production_qty from public.menu_items where id = 'preserved_veg_pork'), 0), false, '[]', '{"low":3,"full":10,"urgent":0,"disabled":true}'),
  ('nfstock_2027_sesame_wine_shrimp',   '麻油酒香鮮蝦',   '', '', null, '年菜庫存', 3, coalesce((select nianfai_production_qty from public.menu_items where id = 'sesame_wine_shrimp'), 0), false, '[]', '{"low":3,"full":10,"urgent":0,"disabled":true}'),
  ('nfstock_2027_herbal_shaoxing_pork', '藥膳紹興松阪豬', '', '', null, '年菜庫存', 4, coalesce((select nianfai_production_qty from public.menu_items where id = 'herbal_shaoxing_pork'), 0), false, '[]', '{"low":3,"full":10,"urgent":0,"disabled":true}'),
  ('nfstock_2027_huadiao_chicken',      '花雕雞',         '', '', null, '年菜庫存', 5, coalesce((select nianfai_production_qty from public.menu_items where id = 'huadiao_chicken'), 0), false, '[]', '{"low":3,"full":10,"urgent":0,"disabled":true}')
on conflict (id) do nothing;

update public.menu_items set nianfai_stock_ref = 'nfstock_2027_' || id
 where id in ('abalone_ginseng_soup', 'preserved_veg_pork', 'sesame_wine_shrimp', 'herbal_shaoxing_pork', 'huadiao_chicken')
   and nianfai_stock_ref is null;

commit;

