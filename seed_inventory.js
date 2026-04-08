// seed_inventory.js — 插入庫存品項並更新菜單連結
// 用法: node seed_inventory.js --prod | --dev | --all
const arg = process.argv[2];
if (!arg || !['--prod','--dev','--all'].includes(arg)) {
    console.error('用法: node seed_inventory.js --prod | --dev | --all');
    process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

const INVENTORY_ITEMS = [
    { id: 'beef_i',          name: '紅燒牛腩筋',   category: '主食庫存', stock: 15, thresholds: { full: 45, low: 25, urgent: 10 } },
    { id: 'pork_ribs_i',     name: '無錫排骨',     category: '主食庫存', stock: 15, thresholds: { full: 45, low: 25, urgent: 10 } },
    { id: 'pork_shoulder_i', name: '松阪豬',       category: '主食庫存', stock: 15, thresholds: { full: 30, low: 10, urgent: 5  } },
    { id: 'chicken_soup_i',  name: '菜脯雞湯',     category: '主食庫存', stock: 10, thresholds: { full: 18, low: 10, urgent: 5  } },
    { id: 'curry_chicken_i', name: '咖哩雞胸',     category: '主食庫存', stock: 15, thresholds: { full: 15, low: 8,  urgent: 5  } },
    { id: 'salted_pork_i',   name: '鹹豬肉',       category: '主食庫存', stock: 15, thresholds: { full: 15, low: 8,  urgent: 3  } },
    { id: 'goulash_i',       name: '匈牙利牛肉湯', category: '主食庫存', stock: 10, thresholds: { full: 30, low: 12, urgent: 8  } },
    { id: 'pig_balls_i',     name: '小豬球',       category: '點心庫存', stock: 30, thresholds: { full: 30, low: 10, urgent: 6  } },
    { id: 'fried_chicken_i', name: '炸雞',         category: '點心庫存', stock: 30, thresholds: { full: 20, low: 10, urgent: 5  } },
];

// 需要更新 consumes 的菜單品項（原本沒有設定）
const CONSUMES_UPDATES = [
    { id: 'pork_ball',   consumes: ['pig_balls_i']     },
    { id: 'chicken_fry', consumes: ['fried_chicken_i'] },
];

async function seed(envFile, label) {
    dotenv.config({ path: envFile, override: true });
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    console.log(`\n=== ${label} (${process.env.SUPABASE_URL}) ===`);

    // 插入庫存品項
    const rows = INVENTORY_ITEMS.map(i => ({
        id: i.id, name: i.name, category: i.category,
        stock: i.stock, thresholds: i.thresholds,
        price: null, sort_order: 99, sold_out: false,
        print_name: '', consumes: [],
    }));
    const { error: e1 } = await supabase.from('menu_items').upsert(rows);
    if (e1) { console.error('❌ 插入庫存品項失敗:', e1.message); return; }
    console.log(`✅ 插入/更新 ${rows.length} 筆庫存品項`);

    // 更新菜單 consumes
    for (const u of CONSUMES_UPDATES) {
        const { error: e2 } = await supabase.from('menu_items').update({ consumes: u.consumes }).eq('id', u.id);
        if (e2) console.error(`❌ 更新 ${u.id} consumes 失敗:`, e2.message);
        else console.log(`✅ 更新 ${u.id} consumes →`, u.consumes);
    }

    // 驗證
    const { data } = await supabase.from('menu_items').select('id,name,stock').in('id', INVENTORY_ITEMS.map(i => i.id));
    console.log('--- 驗證結果 ---');
    (data||[]).forEach(r => console.log(` ${r.id}: ${r.name} stock=${r.stock}`));
}

(async () => {
    if (arg === '--prod' || arg === '--all') await seed('.env',     'PROD');
    if (arg === '--dev'  || arg === '--all') await seed('.env.dev', 'DEV');
})();
