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
