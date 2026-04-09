// src/db.js — Supabase 版（所有資料存雲端，透過 server.js API 存取）

// ======================================================================
// API 基礎路徑（相對路徑，自動對應平板或電腦的 server IP）
// ======================================================================
const API = '';  // 使用相對路徑，fetch('/api/...') 即可

async function api(method, path, body) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(`${API}${path}`, opts);
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
    }
    return res.json();
}

// ======================================================================
// 出單短名對照表（保留，供 printName 參照）
// ======================================================================
export const MENU_PRINT_NAMES = {
    seafood_fry:        '炸海鮮',
    chicken_fry:        '五香炸G',
    pork_ball:          '小豬球',
    mushrooms_fry:      '炸綜合菇',
    fries:              '脆薯',
    egg_tofu:           '炸豆腐',
    rice_bowl:          '白飯',
    bread:              '麵包',
    fried_egg:          '荷包蛋',
    soft_egg:           '溏心蛋',
    side_dish:          '小菜',
    salad:              '輕沙拉',
    soup:               '海帶湯',
    grass_jelly:        '仙草凍',
    beef_stew:          '紅燒牛腩筋',
    pork_ribs:          '無錫排骨',
    milkfish:           '虱目魚肚',
    chicken_curry:      '雞胸咖哩',
    pork_noodle:        '松阪豬拌麵',
    seafood_tomato:     '西西里海鮮',
    goulash:            '匈牙利牛肉湯',
    wine_seafood:       '麻油海鮮',
    chicken_soup:       '菜脯雞湯',
    mentaiko_pasta:     '明太子義麵',
    shrimp_pasta:       '蛤蜊蝦義麵',
    salted_pork_pasta:  '鹹豬肉義麵',
    mushroom_pasta:     '野菇義麵',
    luohan:             '百草羅漢',
    chrysanthemum:      '菊花枸杞',
    roselle:            '洛神山楂',
    ruby_tea:           '18號紅玉',
    osmanthus_oolong:   '桂花烏龍茶',
    rose_fruit:         '玫瑰雙果茶',
    americano:          '美式咖啡',
    latte:              '拿鐵咖啡',
    coke:               '可樂',
    sprite:             '雪碧',
    soymilk:            '豆奶',
    frozen_beef:        '[凍]牛腩筋',
    frozen_pork:        '[凍]無錫排骨',
    frozen_chicken_soup:'[凍]菜脯雞湯',
    frozen_goulash:     '[凍]匈牙利湯',
    xo_sauce:           'XO醬',
    casher:             '腰果',
    beef_stew1:         '[單]牛腩筋',
    pork_ribs1:         '[單]無錫排骨',
    milkfish1:          '[單]虱目魚肚',
    chicken_curry1:     '[單]雞胸咖哩',
    pork_noodle1:       '[單]松阪豬拌麵',
    seafood_tomato1:    '[單]西西里海鮮',
    goulash1:           '[單]匈牙利湯',
    wine_seafood1:      '[單]麻油海鮮',
    chicken_soup1:      '[單]菜脯雞湯',
    mentaiko_pasta1:    '[單]明太子義麵',
    shrimp_pasta1:      '[單]蛤蜊蝦義麵',
    salted_pork_pasta1: '[單]鹹豬肉義麵',
    mushroom_pasta1:    '[單]野菇義麵',
};

// ======================================================================
// 菜單
// ======================================================================
export async function getMenuItemsForOrder() {
    const items = await api('GET', '/api/menu');
    return items.filter(i => i.price != null && !(i.category||'').includes('庫存'));
}
export const getMenuItems = getMenuItemsForOrder;

export async function getInventoryItems() {
    const items = await api('GET', '/api/menu');
    return items.filter(i => (i.category||'').includes('庫存'))
        .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
}

export async function addMenuItem(item) {
    return api('POST', '/api/menu', {
        ...item,
        printName: item.printName || MENU_PRINT_NAMES[item.id] || '',
    });
}
export async function updateMenuItem(id, updates) {
    return api('PATCH', `/api/menu/${id}`, updates);
}
export async function deleteMenuItem(id) {
    return api('DELETE', `/api/menu/${id}`);
}
export async function resetAllSoldOut() {
    return api('POST', '/api/menu/reset-soldout');
}

// ── 類別設定 ──────────────────────────────────────────────────
export const DEFAULT_CATEGORY_SETTINGS = [
    { name: '主餐',   showInDineIn: true, showInTakeout: true, reportGroup: '營業額', printOnKitchen: true,  includeInTotal: true,  showInKpi: true },
    { name: '小點',   showInDineIn: true, showInTakeout: true, reportGroup: '營業額', printOnKitchen: true,  includeInTotal: true,  showInKpi: true },
    { name: '飲品',   showInDineIn: true, showInTakeout: true, reportGroup: '營業額', printOnKitchen: false, includeInTotal: true,  showInKpi: true },
    { name: '冷凍包', showInDineIn: true, showInTakeout: true, reportGroup: '冷凍包', printOnKitchen: false, includeInTotal: false, showInKpi: true },
    { name: '單點',   showInDineIn: true, showInTakeout: true, reportGroup: '營業額', printOnKitchen: true,  includeInTotal: true,  showInKpi: true },
];

export async function getCategorySettings() {
    try {
        const { value } = await api('GET', '/api/settings/category_settings');
        if (value) return JSON.parse(value);
    } catch {}
    return DEFAULT_CATEGORY_SETTINGS;
}

export async function saveCategorySettings(settings) {
    return api('POST', '/api/settings/category_settings', { value: JSON.stringify(settings) });
}

// ── 常用標籤 ───────────────────────────────────────────────────────────────
export const DEFAULT_QUICK_TAGS = {
    expense: ["冠成", "楓康", "銘利行", "晉新", "小北", "午餐", "晚餐", "市場", "樹森", "米食家", "開元", "瓦斯", "彩券(私人)"],
    income: ["退瓶", "廢油"],
    nonCash: ["轉帳", "訂金"],
};

export async function getQuickTags() {
    try {
        const { value } = await api('GET', '/api/settings/quick_tags');
        if (value) return JSON.parse(value);
    } catch {}
    return DEFAULT_QUICK_TAGS;
}

export async function saveQuickTags(tags) {
    return api('POST', '/api/settings/quick_tags', { value: JSON.stringify(tags) });
}

// ── 通用 app_settings 讀寫 ────────────────────────────────────────────────
export async function getSettingValue(key, defaultValue = null) {
    try {
        const { value } = await api('GET', `/api/settings/${key}`);
        if (value !== undefined && value !== null) return value;
    } catch {}
    return defaultValue;
}
export async function saveSettingValue(key, value) {
    return api('POST', `/api/settings/${key}`, { value });
}

// ── 庫存異動紀錄 ──────────────────────────────────────────────
export async function getInventoryLogs(itemId) {
    const params = itemId ? `?item_id=${encodeURIComponent(itemId)}` : '';
    return api('GET', `/api/inventory-logs${params}`);
}
export async function addInventoryLog(itemId, itemName, changeAmount, note) {
    return api('POST', '/api/inventory-logs', { itemId, itemName, changeAmount, note });
}

// 初始化：若 Supabase 沒有任何菜單資料，則填入預設
export async function populateInitialData() {
    const items = await api('GET', '/api/menu');
    if (items.length > 0) return; // 已有資料，跳過

    const menuItems = [
        { id: 'seafood_fry',    name: '酥炸海鮮',        price: 180, category: '小點', sortOrder: 51 },
        { id: 'chicken_fry',    name: '台式五香炸雞',     price: 160, category: '小點', sortOrder: 52 },
        { id: 'pork_ball',      name: '蜜椒小豬球',       price: 160, category: '小點', sortOrder: 53 },
        { id: 'mushrooms_fry',  name: '酥炸綜合菇',       price: 120, category: '小點', sortOrder: 54 },
        { id: 'fries',          name: '脆薯',             price: 80,  category: '小點', sortOrder: 55 },
        { id: 'egg_tofu',       name: '酥炸雞蛋豆腐',     price: 80,  category: '小點', sortOrder: 56 },
        { id: 'rice_bowl',      name: '關山香Ｑ白米飯',   price: 30,  category: '小點', sortOrder: 57 },
        { id: 'bread',          name: '麵包',             price: 30,  category: '小點', sortOrder: 58 },
        { id: 'fried_egg',      name: '荷包蛋',           price: 30,  category: '小點', sortOrder: 59 },
        { id: 'soft_egg',       name: '溏心蛋',           price: 30,  category: '小點', sortOrder: 60 },
        { id: 'side_dish',      name: '當日小菜',         price: 50,  category: '小點', sortOrder: 61 },
        { id: 'salad',          name: '輕沙拉',           price: 80,  category: '小點', sortOrder: 62 },
        { id: 'soup',           name: '海帶豆腐湯',       price: 60,  category: '小點', sortOrder: 63 },
        { id: 'grass_jelly',    name: '仙草凍',           price: 50,  category: '小點', sortOrder: 64 },
        { id: 'beef_stew',      name: '台式紅燒牛腩筋飯', price: 340, category: '主餐', sortOrder: 1,  consumes: ['beef_i'],          imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/586621ea-28f5-292d-d151-bbc97d5dd4be.png' },
        { id: 'pork_ribs',      name: '紅麴慢燒無錫排骨飯',price: 320,category: '主餐', sortOrder: 2,  consumes: ['pork_ribs_i'],     imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/80131adf-4522-9940-a324-c5ea2da81972.png' },
        { id: 'milkfish',       name: '紅燒無刺虱目魚肚飯',price: 280,category: '主餐', sortOrder: 3,  consumes: ['milkfish_i'],      imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/5a43829e-05c8-5831-e3eb-ca9f16b8b5ff.png' },
        { id: 'chicken_curry',  name: '舒肥酒香嫩雞胸爪哇咖哩飯',price: 280,category: '主餐',sortOrder: 4,consumes: ['curry_chicken_i'],imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/a21361c5-721f-de13-14cc-9cbbb0542171.png' },
        { id: 'pork_noodle',    name: '炙烤霜降豬XO醬乾拌麵',price: 320,category: '主餐',sortOrder: 5, consumes: ['pork_shoulder_i'],imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/1086c28b-d344-b8f5-ee37-2a9d4c10a491.png' },
        { id: 'seafood_tomato', name: '西西里風味蕃茄煮海鮮',price: 320,category: '主餐',sortOrder: 6, consumes: ['seafood_i'],       imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/8cbbf4f5-73c8-3c85-b987-986c08d99ade.png' },
        { id: 'goulash',        name: '匈牙利燉牛肉湯',   price: 330, category: '主餐', sortOrder: 7,  consumes: ['goulash_i'],       imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/4f27047f-2729-385b-cdd7-26020396d716.png' },
        { id: 'wine_seafood',   name: '麻油海鮮醉老酒',   price: 320, category: '主餐', sortOrder: 8,  consumes: ['seafood_i'],       imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/20c9505d-298d-745c-35b7-8a5433a11fee.png' },
        { id: 'chicken_soup',   name: '客家陳年菜脯雞湯飯',price: 300,category: '主餐', sortOrder: 9,  consumes: ['chicken_soup_i'],  imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/eb1851ad-8649-ac16-cf08-993889e24bd3.png' },
        { id: 'mentaiko_pasta', name: '奶油明太子義大利麵附半熟太陽蛋',price: 280,category: '主餐',sortOrder: 10,imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/b30df6de-850a-f973-874c-3ad2b6d24de0.png' },
        { id: 'shrimp_pasta',   name: '蕃茄蛤蜊鮮蝦義大利麵',price: 290,category: '主餐',sortOrder: 11,imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/7d50e1cc-8bec-902a-3f51-f39738d1c01a.png' },
        { id: 'salted_pork_pasta',name: '清炒鹹豬肉義大利麵',price: 280,category: '主餐',sortOrder: 12,consumes: ['salted_pork_i'],  imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/fa8e1cb8-cae7-062a-1334-b4799feb464d.png' },
        { id: 'mushroom_pasta', name: '奶油野菇義大利麵',  price: 260, category: '主餐', sortOrder: 13, imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/35a31b29-334e-790f-af83-b992d80f0884.png' },
        { id: 'luohan',         name: '百草羅漢',          price: 75,  category: '飲品', sortOrder: 20 },
        { id: 'chrysanthemum',  name: '菊花枸杞',          price: 85,  category: '飲品', sortOrder: 21 },
        { id: 'roselle',        name: '洛神山楂',          price: 85,  category: '飲品', sortOrder: 22 },
        { id: 'coke',           name: '可樂',              price: 40,  category: '飲品', sortOrder: 23 },
        { id: 'sprite',         name: '雪碧',              price: 40,  category: '飲品', sortOrder: 24 },
        { id: 'ruby_tea',       name: '18號紅玉',          price: 60,  category: '飲品', sortOrder: 25 },
        { id: 'osmanthus_oolong',name: '桂花烏龍茶',       price: 60,  category: '飲品', sortOrder: 26 },
        { id: 'rose_fruit',     name: '玫瑰雙果茶',        price: 65,  category: '飲品', sortOrder: 27 },
        { id: 'americano',      name: '經典美式咖啡',      price: 70,  category: '飲品', sortOrder: 28 },
        { id: 'latte',          name: '經典拿鐵咖啡',      price: 90,  category: '飲品', sortOrder: 29 },
        { id: 'soymilk',        name: '微糖豆奶',          price: 30,  category: '飲品', sortOrder: 30 },
        { id: 'frozen_beef',    name: '(冷凍包) 台式紅燒牛腩筋',price: 380,category: '冷凍包',stock: 30,sortOrder: 31 },
        { id: 'frozen_pork',    name: '(冷凍包) 紅麴慢燒無錫排骨',price: 380,category: '冷凍包',stock: 30,sortOrder: 32 },
        { id: 'frozen_chicken_soup',name: '(冷凍包) 客家陳年菜脯雞湯',price: 220,category: '冷凍包',stock: 30,sortOrder: 33 },
        { id: 'frozen_goulash', name: '(冷凍包) 匈牙利燉牛肉湯',price: 240,category: '冷凍包',stock: 30,sortOrder: 34 },
        { id: 'xo_sauce',       name: '海味XO醬',          price: 320, category: '冷凍包',stock: 30,sortOrder: 35,imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/31d89146-d9b3-2bdd-0b71-67676db370fe.png' },
        { id: 'casher',         name: '腰果',              price: 300, category: '冷凍包',stock: 30, sortOrder: 36 },
        { id: 'beef_stew1',     name: '(單點) 台式紅燒牛腩筋', price: 270,category: '單點',sortOrder: 37,consumes: ['beef_i'],     imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/586621ea-28f5-292d-d151-bbc97d5dd4be.png' },
        { id: 'pork_ribs1',     name: '(單點) 紅麴慢燒無錫排骨',price: 270,category: '單點',sortOrder: 38,consumes: ['pork_ribs_i'],imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/80131adf-4522-9940-a324-c5ea2da81972.png' },
        { id: 'milkfish1',      name: '(單點) 紅燒無刺虱目魚肚',price: 210,category: '單點',sortOrder: 39,consumes: ['milkfish_i'],imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/5a43829e-05c8-5831-e3eb-ca9f16b8b5ff.png' },
        { id: 'chicken_curry1', name: '(單點) 舒肥酒香嫩雞胸爪哇咖哩',price: 210,category: '單點',sortOrder: 40,consumes: ['curry_chicken_i'],imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/a21361c5-721f-de13-14cc-9cbbb0542171.png' },
        { id: 'pork_noodle1',   name: '(單點) 炙烤霜降豬XO醬乾拌麵',price: 240,category: '單點',sortOrder: 41,consumes: ['pork_shoulder_i'],imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/1086c28b-d344-b8f5-ee37-2a9d4c10a491.png' },
        { id: 'seafood_tomato1',name: '(單點) 西西里風味蕃茄煮海鮮',price: 270,category: '單點',sortOrder: 42,consumes: ['seafood_i'],imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/8cbbf4f5-73c8-3c85-b987-986c08d99ade.png' },
        { id: 'goulash1',       name: '(單點) 匈牙利燉牛肉湯',price: 270,category: '單點',sortOrder: 43,consumes: ['goulash_i'],   imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/4f27047f-2729-385b-cdd7-26020396d716.png' },
        { id: 'wine_seafood1',  name: '(單點) 麻油海鮮醉老酒',price: 260,category: '單點',sortOrder: 44,consumes: ['seafood_i'],   imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/20c9505d-298d-745c-35b7-8a5433a11fee.png' },
        { id: 'chicken_soup1',  name: '(單點) 客家陳年菜脯雞湯',price: 250,category: '單點',sortOrder: 45,consumes: ['chicken_soup_i'],imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/eb1851ad-8649-ac16-cf08-993889e24bd3.png' },
        { id: 'mentaiko_pasta1',name: '(單點) 奶油明太子義大利麵附半熟太陽蛋',price: 240,category: '單點',sortOrder: 46,imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/b30df6de-850a-f973-874c-3ad2b6d24de0.png' },
        { id: 'shrimp_pasta1',  name: '(單點) 蕃茄蛤蜊鮮蝦義大利麵',price: 250,category: '單點',sortOrder: 47,imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/7d50e1cc-8bec-902a-3f51-f39738d1c01a.png' },
        { id: 'salted_pork_pasta1',name: '(單點) 清炒鹹豬肉義大利麵',price: 240,category: '單點',sortOrder: 48,consumes: ['salted_pork_i'],imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/fa8e1cb8-cae7-062a-1334-b4799feb464d.png' },
        { id: 'mushroom_pasta1',name: '(單點) 奶油野菇義大利麵',price: 220,category: '單點',sortOrder: 49,imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/35a31b29-334e-790f-af83-b992d80f0884.png' },
    ];
    for (const item of menuItems) {
        await api('POST', '/api/menu', { ...item, printName: MENU_PRINT_NAMES[item.id]||'' });
    }
}

export async function migrateMenuPrintNames() {
    // Supabase 版：print_name 在 populateInitialData 時已設定，不需要 migrate
}

// ======================================================================
// 桌位
// ======================================================================
export async function getTableStatuses() {
    return api('GET', '/api/tables');
}
export async function updateTableStatusByOrder({ tableNumber, orderId, status, timestamp }) {
    if (!tableNumber || !orderId || tableNumber === '外帶') return false;
    await api('PUT', `/api/tables/${tableNumber}`, { status, orderId, updatedAt: timestamp });
    return true;
}
export async function occupyTableWithoutOrder(tableNumber, timestamp) {
    if (!tableNumber || tableNumber === '外帶') return false;
    await api('POST', `/api/tables/${tableNumber}/occupy`, { timestamp });
    return true;
}
export async function resetTableStatus(tableNumber, orderId, consumeInventory = false) {
    if (!tableNumber) return false;
    const body = {};
    if (orderId) body.orderId = orderId;
    if (consumeInventory) body.consumeInventory = true;
    await api('POST', `/api/tables/${tableNumber}/reset`, body);
    return true;
}

// ======================================================================
// 訂單
// ======================================================================
export async function getActiveOrders() {
    return api('GET', '/api/orders/active');
}
export async function getOrderById(orderId, invoiceId = null) {
    const url = invoiceId ? `/api/orders/${orderId}?inv=${invoiceId}` : `/api/orders/${orderId}`;
    return api('GET', url);
}
export async function createNewOrder(orderData) {
    const storedCloseOrderId = getLastCloseOrderId();
    const lastCloseTs = getLastCloseTime();
    return api('POST', '/api/orders/new', { ...orderData, storedCloseOrderId, lastCloseTs });
}
export async function updateOrderStatus({ orderId, newStatus, newItems, subTotal, total, sendTime, finishTime, customerCount, customerName, customerPhone, needsUtensils, pickupTime, customerId }) {
    if (!orderId || !newStatus) return false;
    const updates = { status: newStatus };
    if (newItems    !== undefined) { updates.items = newItems; updates.subTotal = subTotal; updates.total = total; }
    if (sendTime    !== undefined) updates.sendTime    = sendTime;
    if (finishTime  !== undefined) updates.finishTime  = finishTime;
    if (customerCount !== undefined) updates.customerCount = customerCount;
    if (customerName  !== undefined) updates.customerName  = customerName;
    if (customerPhone !== undefined) updates.customerPhone = customerPhone;
    if (needsUtensils !== undefined) updates.needsUtensils = needsUtensils;
    if (pickupTime    !== undefined) updates.pickupTime    = pickupTime;
    if (customerId    !== undefined) updates.customerId    = customerId;
    await api('PATCH', `/api/orders/${orderId}`, updates);
    return true;
}
export async function completeOrderAndReport({ orderId, newItems, tableNumber, isFullyPaid, sendTime }) {
    if (!orderId) return false;
    await api('POST', `/api/orders/${orderId}/complete`, { newItems, tableNumber, isFullyPaid, sendTime });
    return true;
}
export async function payOrder(orderData) {
    return completeOrderAndReport({ ...orderData, isFullyPaid: true });
}
export async function serveOrder(orderData) {
    return updateOrderStatus({ orderId: orderData.orderId, newStatus: 'served' });
}
export async function archiveTakeoutOrder(orderId) {
    await api('PATCH', `/api/orders/${orderId}`, { status: 'paid_report_complete' });
    return true;
}
export async function getReportOrders() {
    return api('GET', '/api/orders/report');
}

// ======================================================================
// 發票
// ======================================================================
export async function getInvoices() {
    return api('GET', '/api/invoices');
}
export async function voidInvoice(invoiceId, restoreStock = false) {
    await api('POST', `/api/invoices/${invoiceId}/void`, { restoreStock });
}

// ======================================================================
// 顧客
// ======================================================================
export async function getAllCustomers() {
    return api('GET', '/api/customers');
}
export async function searchCustomer(query) {
    if (!query || query.length < 1) return [];
    return api('POST', '/api/customers/search', { query });
}
export async function searchCustomerByPhone(phone) {
    return searchCustomer(phone);
}
export async function upsertCustomer({ id, names, phones, notes }) {
    return api('POST', '/api/customers', { id, names, phones, notes });
}
export async function autoSaveCustomer(name, phone) {
    if (!phone && !name) return null;
    const matches = phone ? await searchCustomer(phone) : [];
    const found = matches[0];
    if (found) {
        if (name && !(found.names||[]).includes(name)) {
            await upsertCustomer({ id: found.id, names: [...(found.names||[]), name], phones: found.phones });
        }
        return found.id;
    }
    const created = await upsertCustomer({ names: name ? [name] : [], phones: phone ? [phone] : [], notes: '' });
    return created.id;
}
export async function deleteCustomer(id) {
    await api('DELETE', `/api/customers/${id}`);
    return true;
}
export async function getOrdersByPhones(phones) {
    if (!phones?.length) return [];
    // 找到有這些電話的第一個客人
    const custs = await searchCustomer(phones[0]);
    if (!custs.length) return [];
    return api('GET', `/api/customers/${custs[0].id}/orders`);
}

// ======================================================================
// 備註群組
// ======================================================================
const ALL_MAIN   = ['beef_stew','pork_ribs','milkfish','chicken_curry','pork_noodle','seafood_tomato','goulash','wine_seafood','chicken_soup','mentaiko_pasta','shrimp_pasta','salted_pork_pasta','mushroom_pasta'];
const ALL_SINGLE = ['beef_stew1','pork_ribs1','milkfish1','chicken_curry1','pork_noodle1','seafood_tomato1','goulash1','wine_seafood1','chicken_soup1','mentaiko_pasta1','shrimp_pasta1','salted_pork_pasta1','mushroom_pasta1'];
const PASTA_MAIN   = ['pork_noodle','mentaiko_pasta','shrimp_pasta','salted_pork_pasta','mushroom_pasta'];
const PASTA_SINGLE = ['pork_noodle1','mentaiko_pasta1','shrimp_pasta1','salted_pork_pasta1','mushroom_pasta1'];
const COFFEE_DRINKS = ['americano','latte'];
const COKE_DRINKS   = ['coke','sprite'];

export const DEFAULT_REMARK_GROUPS = [
    { id: 'bread_rice', name: '附餐選擇', type: 'single', required: true, options: ['配麵包','配白飯'], appliesTo: ['seafood_tomato','goulash','seafood_tomato1','goulash1'] },
    { id: 'rice_amount', name: '飯量', type: 'single', required: false, options: ['多飯','全滿','七分','五分','三分','不要飯'], appliesTo: ['rice_bowl','beef_stew','pork_ribs','milkfish','chicken_curry','seafood_tomato','goulash','wine_seafood','chicken_soup'] },
    { id: 'egg_type', name: '雞蛋', type: 'single', required: true, options: ['全熟蛋','半熟蛋'], appliesTo: ['mentaiko_pasta','mentaiko_pasta1','fried_egg'] },
    { id: 'side_choice', name: '附餐', type: 'multi', required: false, options: ['不要仙草','不要湯'], appliesTo: ['seafood_tomato','goulash','seafood_tomato1','goulash1'] },
    { id: 'side_veg', name: '附餐小菜', type: 'single', required: false, options: ['換三格小菜','換沙拉'], appliesTo: ALL_MAIN },
    { id: 'noodle', name: '麵條', type: 'single', required: false, options: ['麵硬','麵軟'], appliesTo: [...PASTA_MAIN,...PASTA_SINGLE] },
    { id: 'flavor', name: '口味', type: 'single', required: false, options: ['正常','清淡'], appliesTo: [...ALL_MAIN,...ALL_SINGLE] },
    { id: 'other', name: '其他', type: 'multi', required: false,
        options: ['不加黑胡椒','不加香菇','不加蒜頭','不加洋蔥','不加紅椒粉','不加紅白蘿蔔','不要胡麻醬','不要鹽巴','不要松露油','要鹽巴','要醬油'],
        optionItemMap: { '不加黑胡椒': [...ALL_MAIN,...ALL_SINGLE], '不加香菇': [...ALL_MAIN,...ALL_SINGLE], '不加蒜頭': [...ALL_MAIN,...ALL_SINGLE], '不加洋蔥': [...ALL_MAIN,...ALL_SINGLE], '不加紅椒粉': [...ALL_MAIN,...ALL_SINGLE], '不加紅白蘿蔔': [...ALL_MAIN,...ALL_SINGLE], '不要胡麻醬': [...ALL_MAIN,...ALL_SINGLE], '不要鹽巴': ['fries','fried_egg'], '不要松露油': ['fries'], '要鹽巴': ['fried_egg'], '要醬油': ['fried_egg'] },
        appliesTo: [...ALL_MAIN,...ALL_SINGLE,'fries','fried_egg'] },
    { id: 'drink_temp', name: '溫度', type: 'single', required: false, options: ['冰','少冰','熱'], appliesTo: COFFEE_DRINKS },
    { id: 'coke_ice', name: '冰塊', type: 'single', required: false, options: ['附冰塊','去冰'], appliesTo: COKE_DRINKS },
    { id: 'honey_ver', name: '蜂蜜版', type: 'multi', required: false, options: ['蜂蜜版','不要黑胡椒','不要蒜頭'], appliesTo: ['pork_ball'] },
    { id: 'clam_shrimp', name: '換料', type: 'single', required: false, options: ['換蛤蜊','換蝦子'], appliesTo: ['shrimp_pasta','shrimp_pasta1'] },
];

export async function getRemarkGroups() {
    return api('GET', '/api/remarks');
}
export async function saveRemarkGroup(group) {
    await api('POST', '/api/remarks', group);
}
export async function reorderRemarkGroups(groups) {
    await api('PATCH', '/api/remarks/reorder', groups.map(g => ({ id: g.id, sortOrder: g.sortOrder })));
}
export async function deleteRemarkGroup(id) {
    await api('DELETE', `/api/remarks/${id}`);
}
export async function migrateRemarkGroups() {
    const existing = await api('GET', '/api/remarks');
    // 若資料存在且至少有一筆有效選項，則不重新初始化
    const hasValidData = existing.some(g => g.options && g.options.length > 0);
    if (existing.length > 0 && hasValidData) return;
    // 清除損壞或空白的舊資料
    if (existing.length > 0) {
        await api('DELETE', '/api/remarks/all');
    }
    for (const [i, group] of DEFAULT_REMARK_GROUPS.entries()) {
        await api('POST', '/api/remarks', { ...group, sortOrder: i });
    }
}

// ======================================================================
// 關帳 / 流水號（localStorage + Supabase 雙存）
// ======================================================================
const CLOSE_TIME_KEY     = 'pos_last_close_time';
const CLOSE_ORDER_ID_KEY = 'pos_last_close_order_id';

export function getLastCloseTime() {
    const s = localStorage.getItem(CLOSE_TIME_KEY);
    return s ? parseInt(s, 10) : null;
}
export function getLastCloseOrderId() {
    const s = localStorage.getItem(CLOSE_ORDER_ID_KEY);
    return s ? parseInt(s, 10) : 0;
}
export async function performDayClose() {
    const now = Date.now();
    localStorage.setItem(CLOSE_TIME_KEY, String(now));
    try {
        const { maxId } = await api('GET', '/api/orders/max-id');
        localStorage.setItem(CLOSE_ORDER_ID_KEY, String(maxId));
        // 同時存 Supabase，讓其他裝置也能取得
        await api('POST', '/api/settings/last_close_time', { value: now });
        await api('POST', '/api/settings/last_close_order_id', { value: maxId });
    } catch(e) {
        console.error('performDayClose error', e);
    }
    return now;
}

// ======================================================================
// 舊接口相容（部分頁面仍使用）
// ======================================================================
export const STORE_MENU    = 'menuItems';
export const STORE_TABLES  = 'tables';
export const STORE_REMARKS = 'remarkGroups';
