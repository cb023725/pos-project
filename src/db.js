// src/db.js (修復加點單明細消失與作廢回流邏輯 + 錢櫃功能支援版)

import { openDB } from 'idb';

const DB_NAME = 'ipad-pos-db';
const DB_VERSION = 6;
export const STORE_MENU = 'menuItems';
const STORE_ORDERS = 'orders';
export const STORE_TABLES = 'tables';
const STORE_INVOICES = 'invoices';
const STORE_CUSTOMERS = 'customers';
export const STORE_REMARKS = 'remarkGroups';

const dbConfig = {
    upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains(STORE_MENU)) {
            const menuStore = db.createObjectStore(STORE_MENU, { keyPath: 'id' });
            menuStore.createIndex('byCategory', 'category');
        }
        if (!db.objectStoreNames.contains(STORE_ORDERS)) {
            const ordersStore = db.createObjectStore(STORE_ORDERS, { keyPath: 'id', autoIncrement: true });
            ordersStore.createIndex('byDate', 'date');
            ordersStore.createIndex('byStatus', 'status');
        }
        if (!db.objectStoreNames.contains(STORE_TABLES)) {
            db.createObjectStore(STORE_TABLES, { keyPath: 'tableNumber' });
        }
        if (!db.objectStoreNames.contains(STORE_INVOICES)) {
            const invoiceStore = db.createObjectStore(STORE_INVOICES, { keyPath: 'id', autoIncrement: true });
            invoiceStore.createIndex('byInvoiceNumber', 'invoiceNumber', { unique: true });
            invoiceStore.createIndex('byPaymentTime', 'paymentTime');
            invoiceStore.createIndex('byStatus', 'status');
            invoiceStore.createIndex('byOrderId', 'orderId');
        }
        if (!db.objectStoreNames.contains(STORE_CUSTOMERS)) {
            const custStore = db.createObjectStore(STORE_CUSTOMERS, { keyPath: 'id', autoIncrement: true });
            custStore.createIndex('byPhone', 'phone');
        }
        // V6: 新增 remarkGroups store
        if (!db.objectStoreNames.contains(STORE_REMARKS)) {
            db.createObjectStore(STORE_REMARKS, { keyPath: 'id' });
        }
    },
};

// 出單短名對照表（可在菜單管理頁個別覆寫）
export const MENU_PRINT_NAMES = {
    // 小點
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
    // 主餐
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
    // 飲品
    luohan:             '百草羅漢',
    chrysanthemum:      '菊花枸杞',
    roselle:            '洛神山楂',
    coke:               '可樂',
    sprite:             '雪碧',
    ruby_tea:           '紅玉 (熱)',
    osmanthus_oolong:   '桂花 (熱)',
    rose_fruit:         '玫瑰 (熱)',
    americano:          '美式',
    latte:              '拿鐵',
    soymilk:            '豆奶',
    // 冷凍包
    frozen_beef:        '[冷凍]牛腩筋',
    frozen_pork:        '[冷凍]排骨',
    frozen_chicken_soup:'[冷凍]雞湯',
    frozen_goulash:     '[冷凍]匈牙利',
    xo_sauce:           'XO醬',
    casher:             '腰果',
    // 單點（主餐名＋[單]）
    beef_stew1:         '[單]牛腩筋',
    pork_ribs1:         '[單]無錫排骨',
    milkfish1:          '[單]虱目魚肚',
    chicken_curry1:     '[單]雞胸咖哩',
    pork_noodle1:       '[單]松阪豬',
    seafood_tomato1:    '[單]西西里',
    goulash1:           '[單]匈牙利',
    wine_seafood1:      '[單]麻油海鮮',
    chicken_soup1:      '[單]菜脯雞湯',
    mentaiko_pasta1:    '[單]明太子麵',
    shrimp_pasta1:      '[單]蛤蜊蝦麵',
    salted_pork_pasta1: '[單]鹹豬肉麵',
    mushroom_pasta1:    '[單]野菇義麵',
};

export async function populateInitialData() {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const count = await dbInstance.count(STORE_MENU);
    if (count > 0) return;

    const tx = dbInstance.transaction(STORE_MENU, 'readwrite');
    const store = tx.objectStore(STORE_MENU);
    const menuItems = [
        { id: 'seafood_fry', name: '酥炸海鮮', price: 210, category: '小點', sortOrder: 1, consumes: ['seafood_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/a8df4cdb-0a43-0765-10d0-8e38592b6bbb.png' },
        { id: 'chicken_fry', name: '五香炸雞', price: 140, category: '小點', sortOrder: 2, consumes: ['fried_chicken_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/4a266704-3a40-8d79-2845-245039beeedd.png' },
        { id: 'pork_ball', name: '蜜椒小豬球', price: 130, category: '小點', sortOrder: 3, consumes: ['pig_balls_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/52e8a64a-356f-3051-42aa-b317c2d6f953.png' },
        { id: 'mushrooms_fry', name: '炸綜合菇', price: 100, category: '小點', sortOrder: 4, imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/e09c070d-524a-c8fc-0245-32ab57d43600.png' },
        { id: 'fries', name: '脆薯', price: 80, category: '小點', sortOrder: 5, imageUrl: '/images/fries.jpg' },
        { id: 'egg_tofu', name: '炸雞蛋豆腐', price: 70, category: '小點', sortOrder: 6, imageUrl: '/images/egg_tofu.jpg' },
        { id: 'rice_bowl', name: '白飯', price: 30, category: '小點', sortOrder: 7, consumes: [], imageUrl: '/images/rice_bowl.jpg' },
        { id: 'bread', name: '麵包', price: 50, category: '小點', sortOrder: 8, imageUrl: '/images/bread.jpg' },
        { id: 'fried_egg', name: '荷包蛋', price: 30, category: '小點', sortOrder: 9, imageUrl: '/images/fried_egg.jpg' },
        { id: 'soft_egg', name: '溏心蛋', price: 35, category: '小點', sortOrder: 10, imageUrl: '/images/soft_egg.jpg' },
        { id: 'side_dish', name: '當日小菜', price: 35, category: '小點', sortOrder: 11, imageUrl: '/images/side_dish.jpg' },
        { id: 'salad', name: '輕沙拉', price: 35, category: '小點', sortOrder: 12, imageUrl: '/images/salad.jpg' },
        { id: 'soup', name: '海帶豆腐湯', price: 30, category: '小點', sortOrder: 13, imageUrl: '/images/soup.jpg' },
        { id: 'grass_jelly', name: '仙草凍', price: 30, category: '小點', sortOrder: 14, imageUrl: '/images/grass_jelly.jpg' },
        { id: 'beef_stew', name: '紅燒牛腩筋飯', price: 340, category: '主餐', sortOrder: 1, consumes: ['beef_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/586621ea-28f5-292d-d151-bbc97d5dd4be.png' },
        { id: 'pork_ribs', name: '無錫排骨飯', price: 340, category: '主餐', sortOrder: 2, consumes: ['pork_ribs_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/80131adf-4522-9940-a324-c5ea2da81972.png' },
        { id: 'milkfish', name: '虱目魚肚飯', price: 280, category: '主餐', sortOrder: 3, consumes: ['milkfish_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/5a43829e-05c8-5831-e3eb-ca9f16b8b5ff.png' },
        { id: 'chicken_curry', name: '雞胸咖哩飯', price: 280, category: '主餐', sortOrder: 4, consumes: ['curry_chicken_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/a21361c5-721f-de13-14cc-9cbbb0542171.png' },
        { id: 'pork_noodle', name: '松阪豬乾拌麵', price: 280, category: '主餐', sortOrder: 5, consumes: ['pork_shoulder_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/1086c28b-d344-b8f5-ee37-2a9d4c10a491.png' },
        { id: 'seafood_tomato', name: '西西里煮海鮮', price: 330, category: '主餐', sortOrder: 6, consumes: ['seafood_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/8cbbf4f5-73c8-3c85-b987-986c08d99ade.png' },
        { id: 'goulash', name: '匈牙利燉牛肉湯', price: 330, category: '主餐', sortOrder: 7, consumes: ['goulash_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/4f27047f-2729-385b-cdd7-26020396d716.png' },
        { id: 'wine_seafood', name: '麻油海鮮醉老酒', price: 320, category: '主餐', sortOrder: 8, consumes: ['seafood_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/20c9505d-298d-745c-35b7-8a5433a11fee.png' },
        { id: 'chicken_soup', name: '陳年菜脯雞湯飯', price: 300, category: '主餐', sortOrder: 9, consumes: ['chicken_soup_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/eb1851ad-8649-ac16-cf08-993889e24bd3.png' },
        { id: 'mentaiko_pasta', name: '明太子義大利麵', price: 280, category: '主餐', sortOrder: 10, imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/b30df6de-850a-f973-874c-3ad2b6d24de0.png' },
        { id: 'shrimp_pasta', name: '蕃茄鮮蝦義大利麵', price: 290, category: '主餐', sortOrder: 11, imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/7d50e1cc-8bec-902a-3f51-f39738d1c01a.png' },
        { id: 'salted_pork_pasta', name: '鹹豬肉義大利麵', price: 280, category: '主餐', sortOrder: 12, consumes: ['salted_pork_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/fa8e1cb8-cae7-062a-1334-b4799feb464d.png' },
        { id: 'mushroom_pasta', name: '野菇義大利麵', price: 260, category: '主餐', sortOrder: 13, imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/35a31b29-334e-790f-af83-b992d80f0884.png' },
        { id: 'luohan', name: '百草羅漢', price: 75, category: '飲品', sortOrder: 20, imageUrl: '/images/luohan.jpg' },
        { id: 'chrysanthemum', name: '菊花枸杞', price: 85, category: '飲品', sortOrder: 21, imageUrl: '/images/chrysanthemum.jpg' },
        { id: 'roselle', name: '洛神山楂', price: 85, category: '飲品', sortOrder: 22, imageUrl: '/images/roselle.jpg' },
        { id: 'coke', name: '可樂', price: 40, category: '飲品', sortOrder: 23, imageUrl: '/images/coke.jpg' },
        { id: 'sprite', name: '雪碧', price: 40, category: '飲品', sortOrder: 24, imageUrl: '/images/sprite.jpg' },
        { id: 'ruby_tea', name: '18號紅玉', price: 60, category: '飲品', sortOrder: 25, imageUrl: '/images/ruby_tea.jpg' },
        { id: 'osmanthus_oolong', name: '桂花烏龍茶', price: 60, category: '飲品', sortOrder: 26, imageUrl: '/images/osmanthus_oolong.jpg' },
        { id: 'rose_fruit', name: '玫瑰雙果茶', price: 65, category: '飲品', sortOrder: 27, imageUrl: '/images/rose_fruit.jpg' },
        { id: 'americano', name: '美式咖啡', price: 70, category: '飲品', sortOrder: 28, imageUrl: '/images/americano.jpg' },
        { id: 'latte', name: '拿鐵咖啡', price: 90, category: '飲品', sortOrder: 29, imageUrl: '/images/latte.jpg' },
        { id: 'soymilk', name: '豆奶', price: 30, category: '飲品', sortOrder: 30, imageUrl: '/images/soymilk.jpg' },
        { id: 'frozen_beef', name: '[冷凍包]紅燒牛腩筋', price: 380, category: '冷凍包', stock: 30, sortOrder: 31, imageUrl: '/images/frozen_beef.jpg' },
        { id: 'frozen_pork', name: '[冷凍包]無錫排骨', price: 380, category: '冷凍包', stock: 30, sortOrder: 32, imageUrl: '/images/frozen_pork.jpg' },
        { id: 'frozen_chicken_soup', name: '[冷凍包]陳年菜脯雞湯', price: 220, category: '冷凍包', stock: 30, sortOrder: 33, imageUrl: '/images/frozen_chicken_soup.jpg' },
        { id: 'frozen_goulash', name: '[冷凍包]匈牙利牛肉湯', price: 240, category: '冷凍包', stock: 30, sortOrder: 34, imageUrl: '/images/frozen_goulash.jpg' },
        { id: 'xo_sauce', name: '海味XO醬', price: 320, category: '冷凍包', stock: 30, sortOrder: 35, imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/31d89146-d9b3-2bdd-0b71-67676db370fe.png' },
        { id: 'casher', name: '腰果', price: 300, category: '冷凍包', stock: 30, sortOrder: 36, imageUrl: '/images/frozen_beef.jpg' },
        { id: 'beef_stew1', name: '[單點]紅燒牛腩筋', price: 270, category: '單點', sortOrder: 37, consumes: ['beef_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/586621ea-28f5-292d-d151-bbc97d5dd4be.png' },
        { id: 'pork_ribs1', name: '[單點]無錫排骨', price: 270, category: '單點', sortOrder: 38, consumes: ['pork_ribs_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/80131adf-4522-9940-a324-c5ea2da81972.png' },
        { id: 'milkfish1', name: '[單點]虱目魚肚', price: 210, category: '單點', sortOrder: 39, consumes: ['milkfish_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/5a43829e-05c8-5831-e3eb-ca9f16b8b5ff.png' },
        { id: 'chicken_curry1', name: '[單點]雞胸咖哩', price: 210, category: '單點', sortOrder: 40, consumes: ['curry_chicken_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/a21361c5-721f-de13-14cc-9cbbb0542171.png' },
        { id: 'pork_noodle1', name: '[單點]松阪豬乾拌麵', price: 240, category: '單點', sortOrder: 41, consumes: ['pork_shoulder_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/1086c28b-d344-b8f5-ee37-2a9d4c10a491.png' },
        { id: 'seafood_tomato1', name: '[單點]西西里煮海鮮', price: 270, category: '單點', sortOrder: 42, consumes: ['seafood_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/8cbbf4f5-73c8-3c85-b987-986c08d99ade.png' },
        { id: 'goulash1', name: '[單點]匈牙利燉牛肉湯', price: 270, category: '單點', sortOrder: 43, consumes: ['goulash_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/4f27047f-2729-385b-cdd7-26020396d716.png' },
        { id: 'wine_seafood1', name: '[單點]麻油海鮮醉老酒', price: 260, category: '單點', sortOrder: 44, consumes: ['seafood_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/20c9505d-298d-745c-35b7-8a5433a11fee.png' },
        { id: 'chicken_soup1', name: '[單點]陳年菜脯雞湯', price: 250, category: '單點', sortOrder: 45, consumes: ['chicken_soup_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/eb1851ad-8649-ac16-cf08-993889e24bd3.png' },
        { id: 'mentaiko_pasta1', name: '[單點]明太子義大利麵', price: 240, category: '單點', sortOrder: 46, imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/b30df6de-850a-f973-874c-3ad2b6d24de0.png' },
        { id: 'shrimp_pasta1', name: '[單點]蕃茄鮮蝦義大利麵', price: 250, category: '單點', sortOrder: 47, imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/7d50e1cc-8bec-902a-3f51-f39738d1c01a.png' },
        { id: 'salted_pork_pasta1', name: '[單點]鹹豬肉義大利麵', price: 240, category: '單點', sortOrder: 48, consumes: ['salted_pork_i'], imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/fa8e1cb8-cae7-062a-1334-b4799feb464d.png' },
        { id: 'mushroom_pasta1', name: '[單點]野菇義大利麵', price: 220, category: '單點', sortOrder: 49, imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/35a31b29-334e-790f-af83-b992d80f0884.png' },
    ];
    for (const item of menuItems) {
        await store.put({
            id: item.id,
            name: item.name,
            printName: MENU_PRINT_NAMES[item.id] || '',
            price: item.price !== undefined ? (Number(item.price) || 0) : undefined,
            category: item.category || '',
            stock: item.stock !== undefined ? Number(item.stock) : undefined,
            consumes: item.consumes || [],
            sortOrder: item.sortOrder !== undefined ? Number(item.sortOrder) : Infinity,
            imageUrl: item.imageUrl || undefined,
        });
    }
    await tx.done;
}

// 為已存在的 DB 品項補上 printName（首次升級時執行一次）
export async function migrateMenuPrintNames() {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const tx = dbInstance.transaction(STORE_MENU, 'readwrite');
    const store = tx.objectStore(STORE_MENU);
    const all = await store.getAll();
    for (const item of all) {
        if (MENU_PRINT_NAMES[item.id] !== undefined) {
            await store.put({ ...item, printName: MENU_PRINT_NAMES[item.id] });
        }
    }
    await tx.done;
}

export async function addMenuItem(item) { 
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    await dbInstance.add(STORE_MENU, item);
    return item; 
}
export async function deleteMenuItem(id) { 
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    await dbInstance.delete(STORE_MENU, id);
    return true; 
}
export async function updateMenuItem(id, updates) { 
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const tx = dbInstance.transaction(STORE_MENU, 'readwrite');
    const store = tx.objectStore(STORE_MENU);
    const item = await store.get(id);
    if (item) await store.put({ ...item, ...updates });
    await tx.done;
    return true;
}

export async function resetAllSoldOut() {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const tx = dbInstance.transaction(STORE_MENU, 'readwrite');
    const store = tx.objectStore(STORE_MENU);
    const all = await store.getAll();
    for (const item of all) {
        if (item.soldOut) await store.put({ ...item, soldOut: false });
    }
    await tx.done;
    return true;
}

export async function getTableStatuses() {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    return await dbInstance.getAll(STORE_TABLES);
}

export async function getMenuItemsForOrder() {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const items = await dbInstance.getAll(STORE_MENU);
    const filteredItems = items.filter(item => item.price !== undefined && item.price !== null && !(item.category && item.category.includes('庫存')));
    filteredItems.sort((a, b) => (a.sortOrder || Infinity) - (b.sortOrder || Infinity));
    return filteredItems;
}

export async function getInventoryItems() {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const items = await dbInstance.getAll(STORE_MENU); 
    return items.filter(item => (item.category && item.category.includes('庫存')) || item.stock !== undefined).sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'));
}
export const getMenuItems = getMenuItemsForOrder; 

export async function getReportOrders() {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const tx = dbInstance.transaction([STORE_INVOICES, STORE_ORDERS], 'readonly');
    const invoiceStore = tx.objectStore(STORE_INVOICES);
    const orderStore = tx.objectStore(STORE_ORDERS);
    
    const index = invoiceStore.index('byStatus');
    const activeInvoices = await index.getAll('已開立');
    
    const seenOrderIds = new Set();
    const result = [];

    activeInvoices.sort((a, b) => new Date(a.paymentTime) - new Date(b.paymentTime));

    for (const inv of activeInvoices) {
        const order = await orderStore.get(inv.orderId);
        
        const isFirstInvoice = !seenOrderIds.has(inv.orderId);
        if (isFirstInvoice) {
            seenOrderIds.add(inv.orderId);
        }

        result.push({
            id: inv.orderId,
            orderId: inv.orderId,
            dailyOrderNo: order?.dailyOrderNo,
            invoiceNumber: inv.invoiceNumber,
            timestamp: new Date(inv.paymentTime).getTime(),
            total: inv.amount,
            items: inv.itemsSnapshot || [],
            table: inv.tableName || order?.table || '外帶',
            currentOrderCustomerCount: order?.customerCount,
            customerCount: inv.customerCount || 0,
            orderType: inv.orderType
        });
    }
    await tx.done;
    return result;
}

export async function getActiveOrders() {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const tx = dbInstance.transaction(STORE_ORDERS, 'readonly');
    const index = tx.store.index('byStatus');
    const openOrders = await index.getAll('open');
    const servedOrders = await index.getAll('served');
    const paidOrders = await index.getAll('paid');
    await tx.done;
    return [...openOrders, ...servedOrders, ...paidOrders]; 
}

export async function getInvoices() {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    return await dbInstance.getAll(STORE_INVOICES);
}

export async function getOrderById(orderId, invoiceId = null) {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    if (invoiceId) {
        const inv = await dbInstance.get(STORE_INVOICES, invoiceId);
        if (inv && inv.itemsSnapshot) {
            const originalOrder = await dbInstance.get(STORE_ORDERS, orderId);
            return {
                ...originalOrder,
                items: inv.itemsSnapshot,
                total: inv.amount,
                isSnapshot: true
            };
        }
    }
    return await dbInstance.get(STORE_ORDERS, orderId);
}

/**
 * 作廢發票：解決加點單作廢回流與清桌邏輯同步
 */
export async function voidInvoice(invoiceId) {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const tx = dbInstance.transaction([STORE_INVOICES, STORE_ORDERS, STORE_MENU, STORE_TABLES], 'readwrite');
    const invStore = tx.objectStore(STORE_INVOICES);
    const orderStore = tx.objectStore(STORE_ORDERS);
    const menuStore = tx.objectStore(STORE_MENU);
    const tableStore = tx.objectStore(STORE_TABLES);

    const invoice = await invStore.get(invoiceId);
    if (!invoice) throw new Error("找不到發票");
    if (invoice.status === '已作廢') throw new Error("此發票已作廢，不可重複操作");

    invoice.status = '已作廢';
    invoice.voidTime = new Date().toISOString();
    await invStore.put(invoice);

    const order = await orderStore.get(invoice.orderId);
    if (order) {
        const currentTable = order.table ? await tableStore.get(order.table) : null;
        const isArchived = order.status === 'archived_paid' || order.status === 'archived_voided';
        const isTableReleased = !currentTable || currentTable.status === 'idle' || currentTable.orderId !== order.id;

        if (isArchived || isTableReleased) {
            order.status = 'archived_voided';
        } else {
            order.status = 'served'; 
            if (currentTable && currentTable.orderId === order.id) {
                await tableStore.put({ ...currentTable, status: 'served' });
            }
        }

        order.paidAmount = Math.max(0, (order.paidAmount || 0) - invoice.amount);
        await orderStore.put(order);

        const itemsToRefund = invoice.itemsSnapshot || [];
        for (const item of itemsToRefund) {
            const menuItem = await menuStore.get(item.id);
            if (menuItem?.stock !== undefined) {
                await menuStore.put({ ...menuItem, stock: menuItem.stock + item.quantity });
            }
            if (menuItem?.consumes) {
                for (const cId of menuItem.consumes) {
                    const cItem = await menuStore.get(cId);
                    if (cItem?.stock !== undefined) {
                        await menuStore.put({ ...cItem, stock: cItem.stock + item.quantity });
                    }
                }
            }
        }
    }
    await tx.done;
}

export async function createNewOrder(orderData) {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);

    // 用 IDB auto-increment id 計算流水號：id > 關帳時最大 id 的訂單才算本期
    const allOrders = await dbInstance.getAll(STORE_ORDERS);
    const nowTs = typeof (orderData.timestamp || null) === 'string'
        ? new Date(orderData.timestamp).getTime()
        : (orderData.timestamp || Date.now());

    let periodCount;
    const storedCloseOrderId = getLastCloseOrderId(); // 0 if not stored

    if (storedCloseOrderId > 0) {
        // ── 新版：關帳時有記錄 maxId，直接用 ──────────────────────────────
        periodCount = allOrders.filter(o => (o.id || 0) > storedCloseOrderId).length;

    } else {
        const lastCloseTs = getLastCloseTime();
        if (lastCloseTs) {
            // ── 舊版升級相容：有關帳時間但沒有 maxId → 從時間倒推 ─────────
            const lastCloseOrderId = allOrders.reduce((max, o) => {
                const oTs = typeof o.timestamp === 'string'
                    ? new Date(o.timestamp).getTime() : (o.timestamp || 0);
                return oTs < lastCloseTs ? Math.max(max, o.id || 0) : max;
            }, 0);
            periodCount = allOrders.filter(o => (o.id || 0) > lastCloseOrderId).length;
        } else {
            // ── 無任何關帳記錄（初次使用或 localStorage 被清空）→ 以今日00:00計 ──
            const midnight = new Date(nowTs);
            midnight.setHours(0, 0, 0, 0);
            const midnightTs = midnight.getTime();
            periodCount = allOrders.filter(o => {
                const oTs = typeof o.timestamp === 'string'
                    ? new Date(o.timestamp).getTime() : (o.timestamp || 0);
                return oTs >= midnightTs;
            }).length;
        }
    }

    const dailyOrderNo = periodCount + 1;
    console.log('[createNewOrder] storedCloseOrderId:', storedCloseOrderId,
        '| closeTs:', getLastCloseTime(),
        '| periodCount:', periodCount, '| dailyOrderNo:', dailyOrderNo);

    const baseData = {
        table: orderData.table,
        customerCount: orderData.customerCount || 1,
        customerName: orderData.customerName || '',
        customerPhone: orderData.customerPhone || '',
        customerId: orderData.customerId || null,
        needsUtensils: orderData.needsUtensils ?? false,
        pickupTime: orderData.pickupTime || null,
        items: orderData.items || [],
        subTotal: orderData.subTotal || 0,
        total: orderData.total || 0,
        paidAmount: 0,
        date: orderData.date || new Date().toISOString(),
        timestamp: nowTs,
        status: orderData.status || 'open',
        dailyOrderNo,
    };
    try {
        let orderId = orderData.orderId ? orderData.orderId : await dbInstance.add(STORE_ORDERS, baseData);
        if (orderData.orderId) await dbInstance.put(STORE_ORDERS, { ...baseData, id: orderId });
        if (orderData.table && orderData.table !== '外帶') {
            await updateTableStatusByOrder({ 
                tableNumber: orderData.table, 
                orderId: orderId, 
                status: baseData.status,
                timestamp: baseData.timestamp 
            });
        }
        return { id: orderId, dailyOrderNo };
    } catch (error) {
        return false;
    }
}

/**
 * 核心修復：completeOrderAndReport 
 * 修正加點單明細消失與庫存計算問題
 */
export async function completeOrderAndReport({ orderId, newItems, tableNumber, isFullyPaid, sendTime }) {
    if (!orderId) return false;
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const tx = dbInstance.transaction([STORE_ORDERS, STORE_MENU, STORE_TABLES, STORE_INVOICES], 'readwrite');
    const orderStore = tx.objectStore(STORE_ORDERS);
    const menuStore = tx.objectStore(STORE_MENU);
    const tableStore = tx.objectStore(STORE_TABLES);
    const invStore = tx.objectStore(STORE_INVOICES);

    const existingOrder = await orderStore.get(orderId);
    if (!existingOrder) return false;

    // 1. 更新訂單狀態與金額
    const finalItems = newItems || existingOrder.items;
    const currentOrderTotal = finalItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const previouslyPaidAmount = existingOrder.paidAmount || 0;
    const amountToPayThisTime = currentOrderTotal - previouslyPaidAmount;

    const updatedOrder = { 
        ...existingOrder, 
        status: isFullyPaid ? 'paid' : 'served', 
        sendTime: sendTime || existingOrder.sendTime || Date.now(),
        items: finalItems, 
        total: currentOrderTotal,
        paidAmount: isFullyPaid ? currentOrderTotal : previouslyPaidAmount 
    };
    await orderStore.put(updatedOrder);

    // 2. 如果是結帳且有金額需要開立發票
    if (isFullyPaid && amountToPayThisTime > 0) {
        // 獲取此訂單所有已生效的發票明細，用來排除重複開立
        const allInvoices = await invStore.index('byOrderId').getAll(orderId);
        const validInvoices = allInvoices.filter(i => i.status === '已開立');

        const alreadyInvoicedItemsMap = new Map();
        validInvoices.forEach(inv => {
            if (inv.itemsSnapshot) {
                inv.itemsSnapshot.forEach(item => {
                    const count = alreadyInvoicedItemsMap.get(item.id) || 0;
                    alreadyInvoicedItemsMap.set(item.id, count + item.quantity);
                });
            }
        });

        // 先將相同 id 的品項合併（同一品項跨結帳批次會產生多筆記錄）
        const aggregatedByIdMap = new Map();
        for (const item of finalItems) {
            const existing = aggregatedByIdMap.get(item.id);
            if (existing) {
                existing.quantity += item.quantity;
            } else {
                aggregatedByIdMap.set(item.id, { ...item });
            }
        }

        // 計算本次發票應包含的明細（合併後總量 - 之前已開過的量）
        const snapshotForThisInvoice = [];
        for (const [, item] of aggregatedByIdMap) {
            const previouslyCounted = alreadyInvoicedItemsMap.get(item.id) || 0;
            const diffQuantity = item.quantity - previouslyCounted;
            if (diffQuantity > 0) {
                snapshotForThisInvoice.push({
                    ...item,
                    quantity: diffQuantity
                });
            }
        }

        const invoiceNumber = `INV-${Date.now()}`;
        await invStore.add({
            invoiceNumber,
            paymentTime: new Date().toISOString(),
            orderId: orderId,
            dailyOrderNo: existingOrder.dailyOrderNo || null,
            orderType: tableNumber === '外帶' ? '外帶' : '內用',
            tableName: tableNumber,
            customerCount: existingOrder.customerCount || 0,
            amount: amountToPayThisTime,
            itemsSnapshot: snapshotForThisInvoice,
            status: '已開立',
            voidTime: null
        });

        // 3. 根據本次發票明細回扣庫存
        for (const diffItem of snapshotForThisInvoice) {
            const menuItem = await menuStore.get(diffItem.id);
            if (menuItem?.stock !== undefined) {
                await menuStore.put({ ...menuItem, stock: Math.max(0, menuItem.stock - diffItem.quantity) });
            }
            if (menuItem?.consumes) {
                for (const cId of menuItem.consumes) {
                    const cItem = await menuStore.get(cId);
                    if (cItem?.stock !== undefined) {
                        await menuStore.put({ ...cItem, stock: Math.max(0, cItem.stock - diffItem.quantity) });
                    }
                }
            }
        }
    }

    // 4. 更新桌位狀態
    if (tableNumber && tableNumber !== '外帶') {
        const table = await tableStore.get(tableNumber) || { tableNumber };
        await tableStore.put({ 
            ...table, 
            status: isFullyPaid ? 'paid' : 'served', 
            orderId: orderId, 
            lastOrderTime: existingOrder.timestamp 
        });
    }
    await tx.done;
    return true;
}

export async function resetTableStatus(tableNumber) {
    if (!tableNumber || tableNumber === '外帶') return false;
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const tx = dbInstance.transaction([STORE_TABLES, STORE_ORDERS], 'readwrite');
    const tableStore = tx.objectStore(STORE_TABLES);
    const orderStore = tx.objectStore(STORE_ORDERS);
    const table = await tableStore.get(tableNumber);
    if (table?.orderId) {
        const order = await orderStore.get(table.orderId);
        if (order) {
            if (order.status === 'paid') {
                order.status = 'archived_paid'; 
                await orderStore.put(order);
            } else {
                await orderStore.delete(table.orderId);
            }
        }
    }
    await tableStore.put({ 
        tableNumber, status: 'idle', orderId: null, lastOrderTime: Date.now() 
    });
    await tx.done;
    return true;
}

export async function occupyTableWithoutOrder(tableNumber, timestamp) {
    if (!tableNumber || tableNumber === '外帶') return false;
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    await dbInstance.put(STORE_TABLES, {
        tableNumber, status: 'open', orderId: null, lastOrderTime: timestamp || Date.now() 
    });
    return true;
}

export async function updateOrderStatus(params) {
    const { orderId, newStatus, newItems, subTotal, total, sendTime, finishTime, customerCount } = params;
    if (!orderId || !newStatus) return false;
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const tx = dbInstance.transaction([STORE_ORDERS, STORE_TABLES], 'readwrite');
    const storeOrders = tx.objectStore(STORE_ORDERS);
    const existingOrder = await storeOrders.get(orderId);
    if (!existingOrder) return false;
    const updates = { status: newStatus };
    if (newItems) {
         updates.items = newItems;
         updates.subTotal = subTotal !== undefined ? subTotal : newItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
         updates.total = total !== undefined ? total : updates.subTotal;
    }
    if (sendTime !== undefined) updates.sendTime = sendTime;
    if (finishTime !== undefined) updates.finishTime = finishTime;
    if (customerCount !== undefined) updates.customerCount = customerCount;
    if (params.customerName !== undefined) updates.customerName = params.customerName;
    if (params.customerPhone !== undefined) updates.customerPhone = params.customerPhone;
    if (params.needsUtensils !== undefined) updates.needsUtensils = params.needsUtensils;
    if (params.pickupTime !== undefined) updates.pickupTime = params.pickupTime;
    if (params.customerId !== undefined) updates.customerId = params.customerId;
    await storeOrders.put({ ...existingOrder, ...updates });
    if (existingOrder.table && existingOrder.table !== '外帶') {
        const storeTables = tx.objectStore(STORE_TABLES);
        const existingTable = await storeTables.get(existingOrder.table) || { tableNumber: existingOrder.table };
        await storeTables.put({ 
            ...existingTable, status: newStatus, orderId: orderId, lastOrderTime: existingOrder.timestamp 
        });
    }
    await tx.done;
    return true;
}

export async function updateTableStatusByOrder({ tableNumber, orderId, status, timestamp }) {
    if (!tableNumber || !orderId || tableNumber === '外帶') return false;
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    await dbInstance.put(STORE_TABLES, { 
        tableNumber, status, orderId, lastOrderTime: timestamp || Date.now() 
    });
    return true;
}

export async function payOrder(orderData) {
    return completeOrderAndReport({ ...orderData, isFullyPaid: true });
}
export async function serveOrder(orderData) {
    return updateOrderStatus({ orderId: orderData.orderId, newStatus: 'served' });
}

// ----------------------------------------------------------------------
// 顧客資料庫 (支援多名字多電話)
// ----------------------------------------------------------------------

export async function getAllCustomers() {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const all = await dbInstance.getAll(STORE_CUSTOMERS);
    // normalize old format
    return all.map(c => ({
        ...c,
        names: c.names || (c.name ? [c.name] : []),
        phones: c.phones || (c.phone ? [c.phone] : []),
    }));
}

// 廣泛搜尋：同時搜尋所有名字和電話欄位
export async function searchCustomer(query) {
    if (!query || query.length < 1) return [];
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const all = await dbInstance.getAll(STORE_CUSTOMERS);
    const q = query.toLowerCase().replace(/\s/g, '');
    return all
        .map(c => ({
            ...c,
            names: c.names || (c.name ? [c.name] : []),
            phones: c.phones || (c.phone ? [c.phone] : []),
        }))
        .filter(c =>
            c.names.some(n => n.toLowerCase().includes(q)) ||
            c.phones.some(p => p.replace(/\s/g, '').includes(q))
        );
}

// 保留舊接口相容
export async function searchCustomerByPhone(phone) {
    return searchCustomer(phone);
}

export async function upsertCustomer({ id, names, phones, notes }) {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    if (id) {
        const existing = await dbInstance.get(STORE_CUSTOMERS, id);
        if (existing) {
            const updated = {
                ...existing,
                names: names || existing.names || [],
                phones: phones || existing.phones || [],
                notes: notes !== undefined ? notes : existing.notes,
            };
            await dbInstance.put(STORE_CUSTOMERS, updated);
            return id;
        }
    }
    return await dbInstance.add(STORE_CUSTOMERS, {
        names: names || [],
        phones: phones || [],
        notes: notes || '',
        createdAt: Date.now(),
    });
}

// 自動儲存外帶顧客：依電話找到現有客人或建立新客人，回傳 customerId
export async function autoSaveCustomer(name, phone) {
    if (!phone && !name) return null;
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const all = await dbInstance.getAll(STORE_CUSTOMERS);

    // 搜尋電話是否已存在
    let found = null;
    if (phone) {
        found = all.find(c => {
            const phones = c.phones || (c.phone ? [c.phone] : []);
            return phones.some(p => p === phone);
        });
    }

    if (found) {
        // 如果有新名字，加入 names 陣列
        if (name) {
            const existingNames = found.names || (found.name ? [found.name] : []);
            if (!existingNames.includes(name)) {
                await dbInstance.put(STORE_CUSTOMERS, {
                    ...found,
                    names: [...existingNames, name],
                    phones: found.phones || (found.phone ? [found.phone] : []),
                });
            }
        }
        return found.id;
    } else {
        // 建立新客人
        return await dbInstance.add(STORE_CUSTOMERS, {
            names: name ? [name] : [],
            phones: phone ? [phone] : [],
            notes: '',
            createdAt: Date.now(),
        });
    }
}

export async function deleteCustomer(id) {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    await dbInstance.delete(STORE_CUSTOMERS, id);
    return true;
}

// 取得某客人的所有外帶訂單（依電話比對）
export async function getOrdersByPhones(phones) {
    if (!phones || phones.length === 0) return [];
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const allOrders = await dbInstance.getAll(STORE_ORDERS);
    return allOrders
        .filter(o => o.table === '外帶' && phones.some(p => o.customerPhone === p))
        .sort((a, b) => (b.id || 0) - (a.id || 0));
}

// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// 關帳 / 流水號重置 (localStorage)
// ----------------------------------------------------------------------
const CLOSE_TIME_KEY      = 'pos_last_close_time';
const CLOSE_ORDER_ID_KEY  = 'pos_last_close_order_id'; // 關帳當時最後一筆訂單的 IDB id

export function getLastCloseTime() {
    const stored = localStorage.getItem(CLOSE_TIME_KEY);
    return stored ? parseInt(stored, 10) : null;
}

export function getLastCloseOrderId() {
    const stored = localStorage.getItem(CLOSE_ORDER_ID_KEY);
    return stored ? parseInt(stored, 10) : 0;
}

export async function performDayClose() {
    const now = Date.now();
    localStorage.setItem(CLOSE_TIME_KEY, String(now));
    // 記錄關帳時最大的訂單 IDB id，之後用來計算新期間的流水號
    try {
        const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
        const allOrders = await dbInstance.getAll(STORE_ORDERS);
        const maxId = allOrders.reduce((m, o) => Math.max(m, o.id || 0), 0);
        localStorage.setItem(CLOSE_ORDER_ID_KEY, String(maxId));
    } catch (e) {
        console.error('performDayClose: 無法讀取訂單 id', e);
    }
    return now;
}

// ----------------------------------------------------------------------
// 外帶結案：已取餐離店
// ----------------------------------------------------------------------
export async function archiveTakeoutOrder(orderId) {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const order = await dbInstance.get(STORE_ORDERS, orderId);
    if (!order || order.status !== 'paid') return false;
    await dbInstance.put(STORE_ORDERS, { ...order, status: 'paid_report_complete' });
    return true;
}

// ----------------------------------------------------------------------
// 註記群組 (Remark Groups)
// ----------------------------------------------------------------------

// 預設的所有主餐 IDs
const ALL_MAIN = ['beef_stew','pork_ribs','milkfish','chicken_curry','pork_noodle','seafood_tomato','goulash','wine_seafood','chicken_soup','mentaiko_pasta','shrimp_pasta','salted_pork_pasta','mushroom_pasta'];
const ALL_SINGLE = ['beef_stew1','pork_ribs1','milkfish1','chicken_curry1','pork_noodle1','seafood_tomato1','goulash1','wine_seafood1','chicken_soup1','mentaiko_pasta1','shrimp_pasta1','salted_pork_pasta1','mushroom_pasta1'];
const PASTA_MAIN = ['pork_noodle','mentaiko_pasta','shrimp_pasta','salted_pork_pasta','mushroom_pasta'];
const PASTA_SINGLE = ['pork_noodle1','mentaiko_pasta1','shrimp_pasta1','salted_pork_pasta1','mushroom_pasta1'];
// 咖啡類（需要溫度選擇）
const COFFEE_DRINKS = ['americano','latte'];
// 可加冰塊飲品
const COKE_DRINKS = ['coke','sprite'];

export const DEFAULT_REMARK_GROUPS = [
    {
        id: 'bread_rice',
        name: '附餐選擇',
        type: 'single',
        required: true,
        options: ['配麵包','配白飯'],
        appliesTo: ['seafood_tomato','goulash','seafood_tomato1','goulash1'],
    },
    {
        id: 'rice_amount',
        name: '飯量',
        type: 'single',
        required: false,
        options: ['多飯','全滿','七分','五分','三分','不要飯'],
        appliesTo: ['rice_bowl','beef_stew','pork_ribs','milkfish','chicken_curry','seafood_tomato','goulash','wine_seafood','chicken_soup'],
    },
    {
        id: 'egg_type',
        name: '雞蛋',
        type: 'single',
        required: true,
        options: ['全熟蛋','半熟蛋'],
        appliesTo: ['mentaiko_pasta','mentaiko_pasta1','fried_egg'],
    },
    {
        id: 'side_choice',
        name: '附餐',
        type: 'multi',
        required: false,
        options: ['不要仙草','不要湯'],
        appliesTo: ['seafood_tomato','goulash','seafood_tomato1','goulash1'],
    },
    {
        id: 'side_veg',
        name: '附餐小菜',
        type: 'single',
        required: false,
        options: ['換三格小菜','換沙拉'],
        appliesTo: ALL_MAIN,
    },
    {
        id: 'noodle',
        name: '麵條',
        type: 'single',
        required: false,
        options: ['麵硬','麵軟'],
        appliesTo: [...PASTA_MAIN, ...PASTA_SINGLE],
    },
    {
        id: 'flavor',
        name: '口味',
        type: 'single',
        required: false,
        options: ['正常','清淡'],
        appliesTo: [...ALL_MAIN, ...ALL_SINGLE],
    },
    {
        // 其他：每個選項都有 optionItemMap 限制適用品項
        id: 'other',
        name: '其他',
        type: 'multi',
        required: false,
        options: [
            '不加黑胡椒','不加香菇','不加蒜頭','不加洋蔥',
            '不加紅椒粉','不加紅白蘿蔔','不要胡麻醬','不要鹽巴','不要松露油','要鹽巴','要醬油',
        ],
        // 有設定的選項只會在對應品項中顯示；沒設定則顯示給所有 appliesTo 品項
        optionItemMap: {
            '不加黑胡椒':   [...ALL_MAIN, ...ALL_SINGLE],
            '不加香菇':     [...ALL_MAIN, ...ALL_SINGLE],
            '不加蒜頭':     [...ALL_MAIN, ...ALL_SINGLE],
            '不加洋蔥':     [...ALL_MAIN, ...ALL_SINGLE],
            '不加紅椒粉':   [...ALL_MAIN, ...ALL_SINGLE],
            '不加紅白蘿蔔': [...ALL_MAIN, ...ALL_SINGLE],
            '不要胡麻醬':   [...ALL_MAIN, ...ALL_SINGLE],
            '不要鹽巴':     ['fries','fried_egg'],
            '不要松露油':   ['fries'],
            '要鹽巴':       ['fried_egg'],
            '要醬油':       ['fried_egg'],
        },
        appliesTo: [...ALL_MAIN, ...ALL_SINGLE, 'fries', 'fried_egg'],
    },
    {
        // 咖啡溫度（僅適用咖啡）
        id: 'drink_temp',
        name: '溫度',
        type: 'single',
        required: false,
        options: ['冰','少冰','熱'],
        appliesTo: COFFEE_DRINKS,
    },
    {
        // 可樂/雪碧冰塊
        id: 'coke_ice',
        name: '冰塊',
        type: 'single',
        required: false,
        options: ['附冰塊','去冰'],
        appliesTo: COKE_DRINKS,
    },
    {
        id: 'honey_ver',
        name: '蜂蜜版',
        type: 'multi',
        required: false,
        options: ['蜂蜜版','不要黑胡椒','不要蒜頭'],
        appliesTo: ['pork_ball'],
    },
    {
        id: 'clam_shrimp',
        name: '換料',
        type: 'single',
        required: false,
        options: ['換蛤蜊','換蝦子'],
        appliesTo: ['shrimp_pasta','shrimp_pasta1'],
    },
];

export async function getRemarkGroups() {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const all = await dbInstance.getAll(STORE_REMARKS);
    return all;
}

export async function saveRemarkGroup(group) {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    await dbInstance.put(STORE_REMARKS, group);
}

export async function migrateRemarkGroups() {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const tx = dbInstance.transaction(STORE_REMARKS, 'readwrite');
    const store = tx.objectStore(STORE_REMARKS);
    const existing = await store.getAll();
    const existingMap = new Map(existing.map(g => [g.id, g]));
    for (const group of DEFAULT_REMARK_GROUPS) {
        const cur = existingMap.get(group.id);
        // 合併選項：以最新預設為基準，保留使用者透過 UI 額外新增的選項
        const mergedOptions = cur
            ? [...group.options, ...(cur.options || []).filter(o => !group.options.includes(o))]
            : group.options;
        await store.put({
            ...group,
            options: mergedOptions,
            // 保留使用者自訂的 appliesTo；若無則用預設
            appliesTo: cur ? cur.appliesTo : group.appliesTo,
        });
    }
    await tx.done;
}