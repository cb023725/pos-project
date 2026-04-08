#!/usr/bin/env node
// migrate_menu.js — 修正菜單資料（名稱/價格/圖片/consumes）
// 用法：
//   prod: node migrate_menu.js
//   dev:  node migrate_menu.js --dev

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
console.log(`🔧 修正目標：${isDev ? 'dev' : 'prod'} — ${process.env.SUPABASE_URL}`);

// ================================================================
// 正確的菜單資料（依原始 DB 校正）
// name      = POS 點餐畫面顯示名
// price     = 正確售價
// sortOrder = 排序
// imageUrl  = 圖片
// consumes  = 消耗庫存 ID
// ================================================================
const CORRECT_MENU = [
    // ── 小點 ──────────────────────────────────────────────────────
    { id:'seafood_fry',    name:'酥炸海鮮',       price:210, category:'小點', sortOrder:1,
      consumes:['seafood_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/a8df4cdb-0a43-0765-10d0-8e38592b6bbb.png' },
    { id:'chicken_fry',    name:'五香炸雞',        price:140, category:'小點', sortOrder:2,
      consumes:['fried_chicken_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/4a266704-3a40-8d79-2845-245039beeedd.png' },
    { id:'pork_ball',      name:'蜜椒小豬球',      price:130, category:'小點', sortOrder:3,
      consumes:['pig_balls_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/52e8a64a-356f-3051-42aa-b317c2d6f953.png' },
    { id:'mushrooms_fry',  name:'炸綜合菇',        price:100, category:'小點', sortOrder:4,
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/e09c070d-524a-c8fc-0245-32ab57d43600.png' },
    { id:'fries',          name:'脆薯',            price:80,  category:'小點', sortOrder:5,
      imageUrl:'/images/fries.jpg' },
    { id:'egg_tofu',       name:'炸雞蛋豆腐',      price:70,  category:'小點', sortOrder:6,
      imageUrl:'/images/egg_tofu.jpg' },
    { id:'rice_bowl',      name:'白飯',            price:30,  category:'小點', sortOrder:7,
      consumes:[],
      imageUrl:'/images/rice_bowl.jpg' },
    { id:'bread',          name:'麵包',            price:50,  category:'小點', sortOrder:8,
      imageUrl:'/images/bread.jpg' },
    { id:'fried_egg',      name:'荷包蛋',          price:30,  category:'小點', sortOrder:9,
      imageUrl:'/images/fried_egg.jpg' },
    { id:'soft_egg',       name:'溏心蛋',          price:35,  category:'小點', sortOrder:10,
      imageUrl:'/images/soft_egg.jpg' },
    { id:'side_dish',      name:'當日小菜',        price:35,  category:'小點', sortOrder:11,
      imageUrl:'/images/side_dish.jpg' },
    { id:'salad',          name:'輕沙拉',          price:35,  category:'小點', sortOrder:12,
      imageUrl:'/images/salad.jpg' },
    { id:'soup',           name:'海帶豆腐湯',      price:30,  category:'小點', sortOrder:13,
      imageUrl:'/images/soup.jpg' },
    { id:'grass_jelly',    name:'仙草凍',          price:30,  category:'小點', sortOrder:14,
      imageUrl:'/images/grass_jelly.jpg' },

    // ── 主餐 ──────────────────────────────────────────────────────
    { id:'beef_stew',      name:'紅燒牛腩筋飯',    price:340, category:'主餐', sortOrder:1,
      consumes:['beef_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/586621ea-28f5-292d-d151-bbc97d5dd4be.png' },
    { id:'pork_ribs',      name:'無錫排骨飯',      price:340, category:'主餐', sortOrder:2,
      consumes:['pork_ribs_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/80131adf-4522-9940-a324-c5ea2da81972.png' },
    { id:'milkfish',       name:'虱目魚肚飯',      price:280, category:'主餐', sortOrder:3,
      consumes:['milkfish_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/5a43829e-05c8-5831-e3eb-ca9f16b8b5ff.png' },
    { id:'chicken_curry',  name:'雞胸咖哩飯',      price:280, category:'主餐', sortOrder:4,
      consumes:['curry_chicken_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/a21361c5-721f-de13-14cc-9cbbb0542171.png' },
    { id:'pork_noodle',    name:'松阪豬乾拌麵',    price:280, category:'主餐', sortOrder:5,
      consumes:['pork_shoulder_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/1086c28b-d344-b8f5-ee37-2a9d4c10a491.png' },
    { id:'seafood_tomato', name:'西西里煮海鮮',    price:330, category:'主餐', sortOrder:6,
      consumes:['seafood_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/8cbbf4f5-73c8-3c85-b987-986c08d99ade.png' },
    { id:'goulash',        name:'匈牙利燉牛肉湯',  price:330, category:'主餐', sortOrder:7,
      consumes:['goulash_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/4f27047f-2729-385b-cdd7-26020396d716.png' },
    { id:'wine_seafood',   name:'麻油海鮮醉老酒',  price:320, category:'主餐', sortOrder:8,
      consumes:['seafood_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/20c9505d-298d-745c-35b7-8a5433a11fee.png' },
    { id:'chicken_soup',   name:'陳年菜脯雞湯飯',  price:300, category:'主餐', sortOrder:9,
      consumes:['chicken_soup_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/eb1851ad-8649-ac16-cf08-993889e24bd3.png' },
    { id:'mentaiko_pasta', name:'明太子義大利麵',   price:280, category:'主餐', sortOrder:10,
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/b30df6de-850a-f973-874c-3ad2b6d24de0.png' },
    { id:'shrimp_pasta',   name:'蕃茄鮮蝦義大利麵',price:290, category:'主餐', sortOrder:11,
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/7d50e1cc-8bec-902a-3f51-f39738d1c01a.png' },
    { id:'salted_pork_pasta',name:'鹹豬肉義大利麵',price:280, category:'主餐', sortOrder:12,
      consumes:['salted_pork_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/fa8e1cb8-cae7-062a-1334-b4799feb464d.png' },
    { id:'mushroom_pasta', name:'野菇義大利麵',     price:260, category:'主餐', sortOrder:13,
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/35a31b29-334e-790f-af83-b992d80f0884.png' },

    // ── 飲品 ──────────────────────────────────────────────────────
    { id:'luohan',         name:'百草羅漢',        price:75,  category:'飲品', sortOrder:20, imageUrl:'/images/luohan.jpg' },
    { id:'chrysanthemum',  name:'菊花枸杞',        price:85,  category:'飲品', sortOrder:21, imageUrl:'/images/chrysanthemum.jpg' },
    { id:'roselle',        name:'洛神山楂',        price:85,  category:'飲品', sortOrder:22, imageUrl:'/images/roselle.jpg' },
    { id:'coke',           name:'可樂',            price:40,  category:'飲品', sortOrder:23, imageUrl:'/images/coke.jpg' },
    { id:'sprite',         name:'雪碧',            price:40,  category:'飲品', sortOrder:24, imageUrl:'/images/sprite.jpg' },
    { id:'ruby_tea',       name:'18號紅玉',        price:60,  category:'飲品', sortOrder:25, imageUrl:'/images/ruby_tea.jpg' },
    { id:'osmanthus_oolong',name:'桂花烏龍茶',     price:60,  category:'飲品', sortOrder:26, imageUrl:'/images/osmanthus_oolong.jpg' },
    { id:'rose_fruit',     name:'玫瑰雙果茶',      price:65,  category:'飲品', sortOrder:27, imageUrl:'/images/rose_fruit.jpg' },
    { id:'americano',      name:'美式咖啡',        price:70,  category:'飲品', sortOrder:28, imageUrl:'/images/americano.jpg' },
    { id:'latte',          name:'拿鐵咖啡',        price:90,  category:'飲品', sortOrder:29, imageUrl:'/images/latte.jpg' },
    { id:'soymilk',        name:'豆奶',            price:30,  category:'飲品', sortOrder:30, imageUrl:'/images/soymilk.jpg' },

    // ── 冷凍包 ────────────────────────────────────────────────────
    { id:'frozen_beef',    name:'[冷凍包]紅燒牛腩筋',   price:380, category:'冷凍包', sortOrder:31, stock:30, imageUrl:'/images/frozen_beef.jpg' },
    { id:'frozen_pork',    name:'[冷凍包]無錫排骨',     price:380, category:'冷凍包', sortOrder:32, stock:30, imageUrl:'/images/frozen_pork.jpg' },
    { id:'frozen_chicken_soup',name:'[冷凍包]陳年菜脯雞湯',price:220,category:'冷凍包',sortOrder:33,stock:30,imageUrl:'/images/frozen_chicken_soup.jpg' },
    { id:'frozen_goulash', name:'[冷凍包]匈牙利牛肉湯', price:240, category:'冷凍包', sortOrder:34, stock:30, imageUrl:'/images/frozen_goulash.jpg' },
    { id:'xo_sauce',       name:'海味XO醬',            price:320, category:'冷凍包', sortOrder:35, stock:30,
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/31d89146-d9b3-2bdd-0b71-67676db370fe.png' },
    { id:'casher',         name:'腰果',                price:300, category:'冷凍包', sortOrder:36, stock:30, imageUrl:'/images/frozen_beef.jpg' },

    // ── 單點 ──────────────────────────────────────────────────────
    { id:'beef_stew1',     name:'[單點]紅燒牛腩筋',    price:270, category:'單點', sortOrder:37,
      consumes:['beef_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/586621ea-28f5-292d-d151-bbc97d5dd4be.png' },
    { id:'pork_ribs1',     name:'[單點]無錫排骨',      price:270, category:'單點', sortOrder:38,
      consumes:['pork_ribs_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/80131adf-4522-9940-a324-c5ea2da81972.png' },
    { id:'milkfish1',      name:'[單點]虱目魚肚',      price:210, category:'單點', sortOrder:39,
      consumes:['milkfish_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/5a43829e-05c8-5831-e3eb-ca9f16b8b5ff.png' },
    { id:'chicken_curry1', name:'[單點]雞胸咖哩',      price:210, category:'單點', sortOrder:40,
      consumes:['curry_chicken_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/a21361c5-721f-de13-14cc-9cbbb0542171.png' },
    { id:'pork_noodle1',   name:'[單點]松阪豬乾拌麵',  price:240, category:'單點', sortOrder:41,
      consumes:['pork_shoulder_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/1086c28b-d344-b8f5-ee37-2a9d4c10a491.png' },
    { id:'seafood_tomato1',name:'[單點]西西里煮海鮮',  price:270, category:'單點', sortOrder:42,
      consumes:['seafood_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/8cbbf4f5-73c8-3c85-b987-986c08d99ade.png' },
    { id:'goulash1',       name:'[單點]匈牙利燉牛肉湯',price:270, category:'單點', sortOrder:43,
      consumes:['goulash_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/4f27047f-2729-385b-cdd7-26020396d716.png' },
    { id:'wine_seafood1',  name:'[單點]麻油海鮮醉老酒',price:260, category:'單點', sortOrder:44,
      consumes:['seafood_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/20c9505d-298d-745c-35b7-8a5433a11fee.png' },
    { id:'chicken_soup1',  name:'[單點]陳年菜脯雞湯',  price:250, category:'單點', sortOrder:45,
      consumes:['chicken_soup_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/eb1851ad-8649-ac16-cf08-993889e24bd3.png' },
    { id:'mentaiko_pasta1',name:'[單點]明太子義大利麵', price:240, category:'單點', sortOrder:46,
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/b30df6de-850a-f973-874c-3ad2b6d24de0.png' },
    { id:'shrimp_pasta1',  name:'[單點]蕃茄鮮蝦義大利麵',price:250,category:'單點', sortOrder:47,
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/7d50e1cc-8bec-902a-3f51-f39738d1c01a.png' },
    { id:'salted_pork_pasta1',name:'[單點]鹹豬肉義大利麵',price:240,category:'單點',sortOrder:48,
      consumes:['salted_pork_i'],
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/fa8e1cb8-cae7-062a-1334-b4799feb464d.png' },
    { id:'mushroom_pasta1',name:'[單點]野菇義大利麵',   price:220, category:'單點', sortOrder:49,
      imageUrl:'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/35a31b29-334e-790f-af83-b992d80f0884.png' },
];

async function run() {
    let ok = 0, fail = 0;
    for (const item of CORRECT_MENU) {
        const row = {
            id:         item.id,
            name:       item.name,
            price:      item.price,
            category:   item.category,
            sort_order: item.sortOrder,
            image_url:  item.imageUrl || null,
        };
        if (item.consumes !== undefined) row.consumes = item.consumes;
        if (item.stock    !== undefined) row.stock    = item.stock;

        const { error } = await sb.from('menu_items').update(row).eq('id', item.id);
        if (error) {
            console.error(`  ❌ ${item.id}: ${error.message}`);
            fail++;
        } else {
            process.stdout.write('.');
            ok++;
        }
    }
    console.log(`\n✅ 完成：${ok} 筆更新，${fail} 筆失敗`);
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
