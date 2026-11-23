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
