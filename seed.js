// seed.js — 初始化 Supabase 菜單與備註群組
// 用法：
//   prod: node seed.js
//   dev:  node seed.js --dev

const path = require('path');
const isDev = process.argv.includes('--dev');
const envFile = isDev ? '.env.dev' : '.env';
const envPath = [
    path.resolve(__dirname, envFile),
    path.resolve(__dirname, '../../..', envFile),
].find(p => require('fs').existsSync(p));
if (!envPath) { console.error(`❌ 找不到 ${envFile}`); process.exit(1); }
require('dotenv').config({ path: envPath });

const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
console.log(`🔧 目標：${isDev ? 'dev' : 'prod'} — ${process.env.SUPABASE_URL}`);

const MENU_PRINT_NAMES = {
    seafood_fry:'炸海鮮', chicken_fry:'五香炸G', pork_ball:'小豬球', mushrooms_fry:'炸綜合菇',
    fries:'脆薯', egg_tofu:'炸豆腐', rice_bowl:'白飯', bread:'麵包', fried_egg:'荷包蛋',
    soft_egg:'溏心蛋', side_dish:'小菜', salad:'輕沙拉', soup:'海帶湯', grass_jelly:'仙草凍',
    beef_stew:'紅燒牛腩筋', pork_ribs:'無錫排骨', milkfish:'虱目魚肚', chicken_curry:'雞胸咖哩',
    pork_noodle:'松阪豬拌麵', seafood_tomato:'西西里海鮮', goulash:'匈牙利牛肉湯',
    wine_seafood:'麻油海鮮', chicken_soup:'菜脯雞湯', mentaiko_pasta:'明太子義麵',
    shrimp_pasta:'蛤蜊蝦義麵', salted_pork_pasta:'鹹豬肉義麵', mushroom_pasta:'野菇義麵',
    luohan:'百草羅漢', chrysanthemum:'菊花枸杞', roselle:'洛神山楂', ruby_tea:'18號紅玉',
    osmanthus_oolong:'桂花烏龍茶', rose_fruit:'玫瑰雙果茶', americano:'美式咖啡', latte:'拿鐵咖啡',
    coke:'可樂', sprite:'雪碧', soymilk:'豆奶',
    frozen_beef:'[凍]牛腩筋', frozen_pork:'[凍]無錫排骨', frozen_chicken_soup:'[凍]菜脯雞湯',
    frozen_goulash:'[凍]匈牙利湯', xo_sauce:'XO醬', casher:'腰果',
    beef_stew1:'[單]牛腩筋', pork_ribs1:'[單]無錫排骨', milkfish1:'[單]虱目魚肚',
    chicken_curry1:'[單]雞胸咖哩', pork_noodle1:'[單]松阪豬拌麵', seafood_tomato1:'[單]西西里海鮮',
    goulash1:'[單]匈牙利湯', wine_seafood1:'[單]麻油海鮮', chicken_soup1:'[單]菜脯雞湯',
    mentaiko_pasta1:'[單]明太子義麵', shrimp_pasta1:'[單]蛤蜊蝦義麵',
    salted_pork_pasta1:'[單]鹹豬肉義麵', mushroom_pasta1:'[單]野菇義麵',
};

const menuItems = [
    // ── 小點 ──────────────────────────────────────────────────────
    { id:'seafood_fry',    name:'酥炸海鮮',       price:210, category:'小點', sort_order:1,
      consumes:['seafood_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/a8df4cdb-0a43-0765-10d0-8e38592b6bbb.png' },
    { id:'chicken_fry',    name:'五香炸雞',        price:140, category:'小點', sort_order:2,
      consumes:['fried_chicken_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/4a266704-3a40-8d79-2845-245039beeedd.png' },
    { id:'pork_ball',      name:'蜜椒小豬球',      price:130, category:'小點', sort_order:3,
      consumes:['pig_balls_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/52e8a64a-356f-3051-42aa-b317c2d6f953.png' },
    { id:'mushrooms_fry',  name:'炸綜合菇',        price:100, category:'小點', sort_order:4,
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/e09c070d-524a-c8fc-0245-32ab57d43600.png' },
    { id:'fries',          name:'脆薯',            price:80,  category:'小點', sort_order:5 },
    { id:'egg_tofu',       name:'炸雞蛋豆腐',      price:70,  category:'小點', sort_order:6 },
    { id:'rice_bowl',      name:'白飯',            price:30,  category:'小點', sort_order:7, consumes:[] },
    { id:'bread',          name:'麵包',            price:50,  category:'小點', sort_order:8 },
    { id:'fried_egg',      name:'荷包蛋',          price:30,  category:'小點', sort_order:9 },
    { id:'soft_egg',       name:'溏心蛋',          price:35,  category:'小點', sort_order:10 },
    { id:'side_dish',      name:'當日小菜',        price:35,  category:'小點', sort_order:11 },
    { id:'salad',          name:'輕沙拉',          price:35,  category:'小點', sort_order:12 },
    { id:'soup',           name:'海帶豆腐湯',      price:30,  category:'小點', sort_order:13 },
    { id:'grass_jelly',    name:'仙草凍',          price:30,  category:'小點', sort_order:14 },

    // ── 主餐 ──────────────────────────────────────────────────────
    { id:'beef_stew',      name:'紅燒牛腩筋飯',    price:340, category:'主餐', sort_order:1,
      consumes:['beef_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/586621ea-28f5-292d-d151-bbc97d5dd4be.png' },
    { id:'pork_ribs',      name:'無錫排骨飯',      price:340, category:'主餐', sort_order:2,
      consumes:['pork_ribs_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/80131adf-4522-9940-a324-c5ea2da81972.png' },
    { id:'milkfish',       name:'虱目魚肚飯',      price:280, category:'主餐', sort_order:3,
      consumes:['milkfish_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/5a43829e-05c8-5831-e3eb-ca9f16b8b5ff.png' },
    { id:'chicken_curry',  name:'雞胸咖哩飯',      price:280, category:'主餐', sort_order:4,
      consumes:['curry_chicken_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/a21361c5-721f-de13-14cc-9cbbb0542171.png' },
    { id:'pork_noodle',    name:'松阪豬乾拌麵',    price:280, category:'主餐', sort_order:5,
      consumes:['pork_shoulder_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/1086c28b-d344-b8f5-ee37-2a9d4c10a491.png' },
    { id:'seafood_tomato', name:'西西里煮海鮮',    price:330, category:'主餐', sort_order:6,
      consumes:['seafood_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/8cbbf4f5-73c8-3c85-b987-986c08d99ade.png' },
    { id:'goulash',        name:'匈牙利燉牛肉湯',  price:330, category:'主餐', sort_order:7,
      consumes:['goulash_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/4f27047f-2729-385b-cdd7-26020396d716.png' },
    { id:'wine_seafood',   name:'麻油海鮮醉老酒',  price:320, category:'主餐', sort_order:8,
      consumes:['seafood_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/20c9505d-298d-745c-35b7-8a5433a11fee.png' },
    { id:'chicken_soup',   name:'陳年菜脯雞湯飯',  price:300, category:'主餐', sort_order:9,
      consumes:['chicken_soup_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/eb1851ad-8649-ac16-cf08-993889e24bd3.png' },
    { id:'mentaiko_pasta', name:'明太子義大利麵',   price:280, category:'主餐', sort_order:10,
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/b30df6de-850a-f973-874c-3ad2b6d24de0.png' },
    { id:'shrimp_pasta',   name:'蕃茄鮮蝦義大利麵',price:290, category:'主餐', sort_order:11,
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/7d50e1cc-8bec-902a-3f51-f39738d1c01a.png' },
    { id:'salted_pork_pasta',name:'鹹豬肉義大利麵',price:280, category:'主餐', sort_order:12,
      consumes:['salted_pork_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/fa8e1cb8-cae7-062a-1334-b4799feb464d.png' },
    { id:'mushroom_pasta', name:'野菇義大利麵',     price:260, category:'主餐', sort_order:13,
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/35a31b29-334e-790f-af83-b992d80f0884.png' },

    // ── 飲品 ──────────────────────────────────────────────────────
    { id:'luohan',          name:'百草羅漢',        price:75,  category:'飲品', sort_order:20 },
    { id:'chrysanthemum',   name:'菊花枸杞',        price:85,  category:'飲品', sort_order:21 },
    { id:'roselle',         name:'洛神山楂',        price:85,  category:'飲品', sort_order:22 },
    { id:'coke',            name:'可樂',            price:40,  category:'飲品', sort_order:23 },
    { id:'sprite',          name:'雪碧',            price:40,  category:'飲品', sort_order:24 },
    { id:'ruby_tea',        name:'18號紅玉',        price:60,  category:'飲品', sort_order:25 },
    { id:'osmanthus_oolong',name:'桂花烏龍茶',      price:60,  category:'飲品', sort_order:26 },
    { id:'rose_fruit',      name:'玫瑰雙果茶',      price:65,  category:'飲品', sort_order:27 },
    { id:'americano',       name:'美式咖啡',        price:70,  category:'飲品', sort_order:28 },
    { id:'latte',           name:'拿鐵咖啡',        price:90,  category:'飲品', sort_order:29 },
    { id:'soymilk',         name:'豆奶',            price:30,  category:'飲品', sort_order:30 },

    // ── 冷凍包 ────────────────────────────────────────────────────
    { id:'frozen_beef',     name:'[冷凍包]紅燒牛腩筋',    price:380, category:'冷凍包', sort_order:31, stock:30 },
    { id:'frozen_pork',     name:'[冷凍包]無錫排骨',      price:380, category:'冷凍包', sort_order:32, stock:30 },
    { id:'frozen_chicken_soup',name:'[冷凍包]陳年菜脯雞湯',price:220,category:'冷凍包', sort_order:33, stock:30 },
    { id:'frozen_goulash',  name:'[冷凍包]匈牙利牛肉湯',  price:240, category:'冷凍包', sort_order:34, stock:30 },
    { id:'xo_sauce',        name:'海味XO醬',              price:320, category:'冷凍包', sort_order:35, stock:30,
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/31d89146-d9b3-2bdd-0b71-67676db370fe.png' },
    { id:'casher',          name:'腰果',                  price:300, category:'冷凍包', sort_order:36, stock:30 },

    // ── 單點 ──────────────────────────────────────────────────────
    { id:'beef_stew1',      name:'[單點]紅燒牛腩筋',      price:270, category:'單點', sort_order:37,
      consumes:['beef_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/586621ea-28f5-292d-d151-bbc97d5dd4be.png' },
    { id:'pork_ribs1',      name:'[單點]無錫排骨',        price:270, category:'單點', sort_order:38,
      consumes:['pork_ribs_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/80131adf-4522-9940-a324-c5ea2da81972.png' },
    { id:'milkfish1',       name:'[單點]虱目魚肚',        price:210, category:'單點', sort_order:39,
      consumes:['milkfish_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/5a43829e-05c8-5831-e3eb-ca9f16b8b5ff.png' },
    { id:'chicken_curry1',  name:'[單點]雞胸咖哩',        price:210, category:'單點', sort_order:40,
      consumes:['curry_chicken_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/a21361c5-721f-de13-14cc-9cbbb0542171.png' },
    { id:'pork_noodle1',    name:'[單點]松阪豬乾拌麵',    price:240, category:'單點', sort_order:41,
      consumes:['pork_shoulder_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/1086c28b-d344-b8f5-ee37-2a9d4c10a491.png' },
    { id:'seafood_tomato1', name:'[單點]西西里煮海鮮',    price:270, category:'單點', sort_order:42,
      consumes:['seafood_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/8cbbf4f5-73c8-3c85-b987-986c08d99ade.png' },
    { id:'goulash1',        name:'[單點]匈牙利燉牛肉湯',  price:270, category:'單點', sort_order:43,
      consumes:['goulash_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/4f27047f-2729-385b-cdd7-26020396d716.png' },
    { id:'wine_seafood1',   name:'[單點]麻油海鮮醉老酒',  price:260, category:'單點', sort_order:44,
      consumes:['seafood_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/20c9505d-298d-745c-35b7-8a5433a11fee.png' },
    { id:'chicken_soup1',   name:'[單點]陳年菜脯雞湯',    price:250, category:'單點', sort_order:45,
      consumes:['chicken_soup_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/eb1851ad-8649-ac16-cf08-993889e24bd3.png' },
    { id:'mentaiko_pasta1', name:'[單點]明太子義大利麵',  price:240, category:'單點', sort_order:46,
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/b30df6de-850a-f973-874c-3ad2b6d24de0.png' },
    { id:'shrimp_pasta1',   name:'[單點]蕃茄鮮蝦義大利麵',price:250, category:'單點', sort_order:47,
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/7d50e1cc-8bec-902a-3f51-f39738d1c01a.png' },
    { id:'salted_pork_pasta1',name:'[單點]鹹豬肉義大利麵',price:240, category:'單點', sort_order:48,
      consumes:['salted_pork_i'],
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/fa8e1cb8-cae7-062a-1334-b4799feb464d.png' },
    { id:'mushroom_pasta1', name:'[單點]野菇義大利麵',    price:220, category:'單點', sort_order:49,
      image_url:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/35a31b29-334e-790f-af83-b992d80f0884.png' },
];

const remarkGroups = [
    { id:'bread_rice', name:'附餐選擇', remarks:['配麵包','配白飯'], sort_order:1 },
    { id:'rice_amount', name:'飯量', remarks:['多飯','全滿','七分','五分','三分','不要飯'], sort_order:2 },
    { id:'egg_type', name:'雞蛋', remarks:['全熟蛋','半熟蛋'], sort_order:3 },
    { id:'side_choice', name:'附餐', remarks:['不要仙草','不要湯'], sort_order:4 },
    { id:'side_veg', name:'附餐小菜', remarks:['換三格小菜','換沙拉'], sort_order:5 },
    { id:'noodle', name:'麵條', remarks:['麵硬','麵軟'], sort_order:6 },
    { id:'flavor', name:'口味', remarks:['正常','清淡'], sort_order:7 },
    { id:'other', name:'其他', remarks:['不加黑胡椒','不加香菇','不加蒜頭','不加洋蔥','不加紅椒粉','不加紅白蘿蔔','不要胡麻醬','不要鹽巴','不要松露油','要鹽巴','要醬油'], sort_order:8 },
    { id:'drink_temp', name:'溫度', remarks:['冰','少冰','熱'], sort_order:9 },
    { id:'coke_ice', name:'冰塊', remarks:['附冰塊','去冰'], sort_order:10 },
    { id:'honey_ver', name:'蜂蜜版', remarks:['蜂蜜版','不要黑胡椒','不要蒜頭'], sort_order:11 },
    { id:'clam_shrimp', name:'換料', remarks:['換蛤蜊','換蝦子'], sort_order:12 },
];

async function seed() {
    console.log('開始填入菜單...');
    const rows = menuItems.map(i => ({
        id: i.id, name: i.name, print_name: MENU_PRINT_NAMES[i.id] || '',
        price: i.price, category: i.category || '', sort_order: i.sort_order || 9999,
        stock: i.stock || null, sold_out: false,
        consumes: i.consumes !== undefined ? i.consumes : [],
        image_url: i.image_url || null,
    }));
    const { error: me } = await sb.from('menu_items').upsert(rows);
    if (me) { console.error('菜單錯誤:', me.message); } else { console.log(`✅ 菜單：${rows.length} 筆`); }

    console.log('開始填入備註群組...');
    const { error: re } = await sb.from('remark_groups').upsert(remarkGroups);
    if (re) { console.error('備註錯誤:', re.message); } else { console.log(`✅ 備註群組：${remarkGroups.length} 筆`); }

    console.log('完成！');
    process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
