-- data-fixes/schema-fingerprint-1-summary.sql
-- 比對 dev 與正式環境 Supabase 的「資料庫結構」是否一致（只讀，不改任何資料、不讀營業資料）
-- 只看 public schema。欄位比對名稱、型別、預設值、可否為空（不看欄位順序）。
--
-- 用法：在 dev 和正式的 Supabase SQL Editor 各執行一次（整份貼上按 Run），把兩邊結果（8 列）貼給 Claude。
-- 每一類的「指紋」相同 = 那一類完全一樣；有不同再跑 schema-fingerprint-2-detail.sql。

-- ════════ 第 1 步：摘要（約 8 列） ════════
with objs as (
  -- 資料表欄位
  select '1 資料表欄位' as 類別, c.table_name || '.' || c.column_name as 名稱,
         c.data_type || '|' || coalesce(c.udt_name, '') || '|' || c.is_nullable || '|' || coalesce(c.column_default, '') as 定義
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
  where c.table_schema = 'public'
  union all
  -- 函式（含報表 RPC）
  select '2 函式', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind in ('f', 'p')
  union all
  -- 索引
  select '3 索引', i.tablename || '.' || i.indexname, i.indexdef
  from pg_indexes i where i.schemaname = 'public'
  union all
  -- 主鍵、外鍵、唯一、check 限制
  select '4 限制', cl.relname || '.' || co.conname, pg_get_constraintdef(co.oid)
  from pg_constraint co join pg_class cl on cl.oid = co.conrelid join pg_namespace n on n.oid = cl.relnamespace
  where n.nspname = 'public'
  union all
  -- 權限規則（RLS policy）
  select '5 權限規則', p.tablename || '.' || p.policyname,
         p.cmd || '|' || array_to_string(p.roles, ',') || '|' || coalesce(p.qual, '') || '|' || coalesce(p.with_check, '')
  from pg_policies p where p.schemaname = 'public'
  union all
  -- 每張表是否開啟 RLS
  select '6 RLS 開關', cl.relname, cl.relrowsecurity::text
  from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
  where n.nspname = 'public' and cl.relkind = 'r'
  union all
  -- 觸發器
  select '7 觸發器', cl.relname || '.' || tg.tgname, pg_get_triggerdef(tg.oid)
  from pg_trigger tg join pg_class cl on cl.oid = tg.tgrelid join pg_namespace n on n.oid = cl.relnamespace
  where n.nspname = 'public' and not tg.tgisinternal
  union all
  -- 檢視表
  select '8 檢視表', v.viewname, v.definition
  from pg_views v where v.schemaname = 'public'
)
select 類別, count(*) as 數量,
       left(md5(string_agg(名稱 || '=' || md5(定義), ';' order by 名稱)), 12) as 指紋
from objs
group by 類別
order by 類別;
