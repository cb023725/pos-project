-- supabase/migrations/20261122b_menu_customer_print_name.sql
-- 菜單品項目前有三種名稱用途：iPad 顯示（name）、廚房聯（print_name，可編輯），
-- 但顧客聯（結帳單）的完整品名寫死在 server.js 的 FULL_NAME_MAP 對照表裡，
-- 後台改不到，跟 name/print_name 不同步。新增 customer_print_name 讓三個名稱
-- 都能在菜單管理頁獨立編輯，彼此互不影響，也都不影響報表統計（統計一律用 id 分組）。
--
-- 用現有 FULL_NAME_MAP 的值回填既有品項，之後才不會讓顧客聯名稱突然變短。

begin;

alter table public.menu_items add column if not exists customer_print_name text;

update public.menu_items set customer_print_name = v.full_name
from (values
    ('seafood_fry','酥炸海鮮'), ('chicken_fry','台式五香炸雞'), ('pork_ball','蜜椒小豬球'),
    ('mushrooms_fry','酥炸綜合菇'), ('fries','脆薯'), ('egg_tofu','酥炸雞蛋豆腐'),
    ('rice_bowl','關山香Ｑ白米飯'), ('bread','麵包'), ('fried_egg','荷包蛋'), ('soft_egg','溏心蛋'),
    ('side_dish','當日小菜'), ('salad','輕沙拉'), ('soup','海帶豆腐湯'), ('grass_jelly','仙草凍'),
    ('beef_stew','台式紅燒牛腩筋飯'), ('pork_ribs','紅麴慢燒無錫排骨飯'),
    ('milkfish','紅燒無刺虱目魚肚飯'), ('chicken_curry','舒肥酒香嫩雞胸爪哇咖哩飯'),
    ('pork_noodle','炙烤霜降豬XO醬乾拌麵'), ('seafood_tomato','西西里風味蕃茄煮海鮮'),
    ('goulash','匈牙利燉牛肉湯'), ('wine_seafood','麻油海鮮醉老酒'),
    ('chicken_soup','客家陳年菜脯雞湯飯'), ('mentaiko_pasta','奶油明太子義大利麵附半熟太陽蛋'),
    ('shrimp_pasta','蕃茄蛤蜊鮮蝦義大利麵'), ('salted_pork_pasta','清炒鹹豬肉義大利麵'),
    ('mushroom_pasta','奶油野菇義大利麵'),
    ('luohan','百草羅漢 (冷泡)'), ('chrysanthemum','菊花枸杞 (冷泡)'), ('roselle','洛神山楂 (冷泡)'),
    ('coke','可樂'), ('sprite','雪碧'), ('ruby_tea','18號紅玉 (熱)'),
    ('osmanthus_oolong','桂花烏龍茶 (熱)'), ('rose_fruit','玫瑰雙果茶 (熱)'),
    ('americano','經典美式咖啡'), ('latte','經典拿鐵咖啡'), ('soymilk','微糖豆奶'),
    ('frozen_beef','(冷凍包) 台式紅燒牛腩筋'), ('frozen_pork','(冷凍包) 紅麴慢燒無錫排骨'),
    ('frozen_chicken_soup','(冷凍包) 客家陳年菜脯雞湯'), ('frozen_goulash','(冷凍包) 匈牙利燉牛肉湯'),
    ('xo_sauce','海味XO醬'), ('casher','腰果'),
    ('beef_stew1','(單點) 台式紅燒牛腩筋'), ('pork_ribs1','(單點) 紅麴慢燒無錫排骨'),
    ('milkfish1','(單點) 紅燒無刺虱目魚肚'), ('chicken_curry1','(單點) 舒肥酒香嫩雞胸爪哇咖哩'),
    ('pork_noodle1','(單點) 炙烤霜降豬XO醬乾拌麵'), ('seafood_tomato1','(單點) 西西里風味蕃茄煮海鮮'),
    ('goulash1','(單點) 匈牙利燉牛肉湯'), ('wine_seafood1','(單點) 麻油海鮮醉老酒'),
    ('chicken_soup1','(單點) 客家陳年菜脯雞湯'),
    ('mentaiko_pasta1','(單點) 奶油明太子義大利麵附半熟太陽蛋'),
    ('shrimp_pasta1','(單點) 蕃茄蛤蜊鮮蝦義大利麵'),
    ('salted_pork_pasta1','(單點) 清炒鹹豬肉義大利麵'),
    ('mushroom_pasta1','(單點) 奶油野菇義大利麵')
) as v(id, full_name)
where menu_items.id = v.id and menu_items.customer_print_name is null;

commit;
