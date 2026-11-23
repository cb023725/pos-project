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
