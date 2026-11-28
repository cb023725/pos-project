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
