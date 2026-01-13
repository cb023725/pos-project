// src/db.js (最終清理版本：移除飯量追蹤，強制區分 served/paid 狀態)

import { openDB } from 'idb';

const DB_NAME = 'ipad-pos-db';
const DB_VERSION = 3; 
export const STORE_MENU = 'menuItems';
const STORE_ORDERS = 'orders';
export const STORE_TABLES = 'tables'; 

// ----------------------------------------------------------------------
// 資料庫設定與版本控制
// ----------------------------------------------------------------------
const dbConfig = {
    upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains(STORE_MENU)) {
            const menuStore = db.createObjectStore(STORE_MENU, { keyPath: 'id' });
            menuStore.createIndex('byCategory', 'category');
        }
        
        if (db.objectStoreNames.contains(STORE_ORDERS)) {
            db.deleteObjectStore(STORE_ORDERS); 
        }
        
        const ordersStore = db.createObjectStore(STORE_ORDERS, { keyPath: 'id', autoIncrement: true });
        ordersStore.createIndex('byDate', 'date');
        ordersStore.createIndex('byStatus', 'status'); 
        
        if (!db.objectStoreNames.contains(STORE_TABLES)) {
            db.createObjectStore(STORE_TABLES, { keyPath: 'tableNumber' }); 
        }

        if (oldVersion < DB_VERSION) {
             console.log(`[IndexedDB] 資料庫已升級至 V${DB_VERSION}`);
        }
    },
};

// ----------------------------------------------------------------------
// 資料初始化：菜單項目
// ----------------------------------------------------------------------
export async function populateInitialData() {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const count = await dbInstance.count(STORE_MENU);
    if (count > 0) return; 

    const tx = dbInstance.transaction(STORE_MENU, 'readwrite');
    const store = tx.objectStore(STORE_MENU);

    const menuItems = [
        // 🍗 小點
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

        // 🍽 主餐
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

        // 🥤 飲品
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

        // 📦 冷凍包
        { id: 'frozen_beef', name: '[冷凍包]紅燒牛腩筋', price: 380, category: '冷凍包', stock: 30, sortOrder: 31, imageUrl: '/images/frozen_beef.jpg' },
        { id: 'frozen_pork', name: '[冷凍包]無錫排骨', price: 380, category: '冷凍包', stock: 30, sortOrder: 32, imageUrl: '/images/frozen_pork.jpg' },
        { id: 'frozen_chicken_soup', name: '[冷凍包]陳年菜脯雞湯', price: 220, category: '冷凍包', stock: 30, sortOrder: 33, imageUrl: '/images/frozen_chicken_soup.jpg' },
        { id: 'frozen_goulash', name: '[冷凍包]匈牙利牛肉湯', price: 240, category: '冷凍包', stock: 30, sortOrder: 34, imageUrl: '/images/frozen_goulash.jpg' },
        { id: 'xo_sauce', name: '海味XO醬', price: 320, category: '冷凍包', stock: 30, sortOrder: 35, imageUrl: 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/31d89146-d9b3-2bdd-0b71-67676db370fe.png' },
        { id: 'casher', name: '腰果', price: 300, category: '冷凍包', stock: 30, sortOrder: 36, imageUrl: '/images/frozen_beef.jpg' },

        // 單點
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
    
    const consumedIds = new Set();
    menuItems.forEach(item => item.consumes?.forEach(id => consumedIds.add(id)));

    const inventoryNameMap = {
        'seafood_i': '海鮮(份)', 'fried_chicken_i': '炸雞(份)', 'pig_balls_i': '小豬球(份)',
        'beef_i': '牛腩筋(克)', 'pork_ribs_i': '排骨(份)', 'milkfish_i': '虱目魚肚(份)',
        'curry_chicken_i': '咖哩雞胸(份)', 'pork_shoulder_i': '松阪豬(份)',
        'goulash_i': '匈牙利燉肉(份)', 'chicken_soup_i': '菜脯雞湯(份)',
        'salted_pork_i': '鹹豬肉(份)', 'tofu_i': '豆腐(塊)',
    };
    
    for (const item of menuItems) {
        const isStockItem = item.category === '' && item.stock !== undefined; 
        await store.put({
            id: item.id,
            name: item.name,
            price: isStockItem ? undefined : (Number(item.price) || 0), 
            category: item.category || '',
            stock: item.stock !== undefined ? Number(item.stock) : undefined, 
            consumes: item.consumes || [],
            sortOrder: item.sortOrder !== undefined ? Number(item.sortOrder) : Infinity, 
            imageUrl: item.imageUrl || undefined, 
        }); 
    }

    let invSortOrder = 1;
    for (const id of consumedIds) {
        if (!menuItems.some(item => item.id === id)) {
            await store.put({
                id: id,
                name: inventoryNameMap[id] || `${id} (庫存)`,
                price: undefined, category: '庫存', stock: 100, sortOrder: invSortOrder++, consumes: [],
                imageUrl: undefined, 
            });
        }
    }
    await tx.done;
}

// ----------------------------------------------------------------------
// 基礎 CRUD 操作
// ----------------------------------------------------------------------

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
    if (item) {
        await store.put({ ...item, ...updates });
    }
    await tx.done;
    return true;
}

// ----------------------------------------------------------------------
// 數據獲取
// ----------------------------------------------------------------------

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
    const tx = dbInstance.transaction(STORE_ORDERS, 'readonly');
    const index = tx.store.index('byStatus');
    const reportOrders = await index.getAll('paid_report_complete'); 
    await tx.done;
    return reportOrders;
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

// ----------------------------------------------------------------------
// 桌位佔用邏輯
// ----------------------------------------------------------------------

export async function occupyTableWithoutOrder(tableNumber, timestamp) {
    if (!tableNumber || tableNumber === '外帶') return false;
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    await dbInstance.put(STORE_TABLES, {
        tableNumber,
        status: 'open',
        orderId: null, 
        lastOrderTime: timestamp || Date.now() 
    });
    return true;
}

// ----------------------------------------------------------------------
// 訂單狀態操作
// ----------------------------------------------------------------------

export async function createNewOrder(orderData) {
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const baseData = {
        table: orderData.table,
        customerCount: orderData.customerCount || 1,
        items: orderData.items || [],
        subTotal: orderData.subTotal || 0,
        total: orderData.total || 0,
        date: orderData.date || new Date().toISOString(),
        timestamp: orderData.timestamp || Date.now(),
        status: orderData.status || 'open', 
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
        return orderId;
    } catch (error) {
        return false;
    }
}

export async function updateOrderStatus({ orderId, newStatus, newItems, subTotal, total, sendTime, finishTime, customerCount }) {
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


    const updatedOrder = { ...existingOrder, ...updates };
    await storeOrders.put(updatedOrder);

    if (existingOrder.table && existingOrder.table !== '外帶') {
        const storeTables = tx.objectStore(STORE_TABLES);
        const existingTable = await storeTables.get(existingOrder.table) || { tableNumber: existingOrder.table, status: 'idle', orderId: null };
        await storeTables.put({ 
            ...existingTable, 
            status: newStatus, 
            orderId: orderId, 
            lastOrderTime: existingOrder.timestamp || Date.now() 
        });
    }
    await tx.done;
    return true;
}

// ----------------------------------------------------------------------
// 桌位狀態與結帳流程
// ----------------------------------------------------------------------

export async function updateTableStatusByOrder({ tableNumber, orderId, status, timestamp }) {
    if (!tableNumber || !orderId || tableNumber === '外帶') return false;
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    await dbInstance.put(STORE_TABLES, { 
        tableNumber, 
        status, 
        orderId, 
        lastOrderTime: timestamp || Date.now() 
    });
    return true;
}

/**
 * 處理訂單結帳。
 * @param {boolean} isFullyPaid - 必須明確指定 true (完全結帳) 或 false (部分結帳)。
 */
export async function completeOrderAndReport({ orderId, newItems, tableNumber, isFullyPaid }) {
    if (!orderId) return false;

    // 🚨 關鍵修正：檢查 isFullyPaid 參數，確保不是因為預設值導致狀態錯誤。
    if (isFullyPaid === undefined || isFullyPaid === null) {
         console.error("completeOrderAndReport 錯誤: 缺少 isFullyPaid 參數。請明確指定 true 或 false。");
         return false; 
    }
    
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const tx = dbInstance.transaction([STORE_ORDERS, STORE_MENU, STORE_TABLES], 'readwrite');
    const orderStore = tx.objectStore(STORE_ORDERS);
    const existingOrder = await orderStore.get(orderId);
    if (!existingOrder) return false;

    // 判斷最終狀態：
    const finalStatus = isFullyPaid ? 'paid' : 'served'; 

    // 確保儲存到資料庫時，isSent 狀態被清空 (設為 false)
    const finalItemsToStore = (newItems || existingOrder.items).map(item => {
        const { isSent, ...rest } = item;
        return { ...rest, isSent: false }; 
    });
    
    const newSubTotal = finalItemsToStore.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const newTotal = newSubTotal; 


    // 1. 更新訂單狀態
    const updatedOrder = { 
        ...existingOrder, 
        status: finalStatus, 
        leaveTime: isFullyPaid ? new Date().toISOString() : existingOrder.leaveTime, 
        items: finalItemsToStore, 
        subTotal: newSubTotal, 
        total: newTotal
    };
    await orderStore.put(updatedOrder);

    // 2. 桌位更新狀態
    if (tableNumber && tableNumber !== '外帶') {
        const tableStore = tx.objectStore(STORE_TABLES);
        const table = await tableStore.get(tableNumber) || { tableNumber };
        await tableStore.put({ ...table, status: finalStatus, orderId: orderId, lastOrderTime: existingOrder.timestamp || Date.now() });
    }

    // 3. 庫存扣減 (僅針對 isPaid: true 的品項)
    const menuStore = tx.objectStore(STORE_MENU);
    for (const orderItem of finalItemsToStore) {
        if (orderItem.isPaid) {
             const menuItem = await menuStore.get(orderItem.id);
             if (menuItem?.stock !== undefined) {
                 await menuStore.put({ ...menuItem, stock: Math.max(0, menuItem.stock - orderItem.quantity) });
             }
             if (menuItem?.consumes) {
                 for (const cId of menuItem.consumes) {
                     const cItem = await menuStore.get(cId);
                     if (cItem?.stock !== undefined) {
                         await menuStore.put({ ...cItem, stock: Math.max(0, cItem.stock - orderItem.quantity) });
                     }
                 }
             }
        }
    }
    await tx.done;
    return true;
}

export async function resetTableStatus(tableNumber) {
    if (!tableNumber || tableNumber === '外帶') return false;
    const dbInstance = await openDB(DB_NAME, DB_VERSION, dbConfig);
    const tx = dbInstance.transaction([STORE_TABLES, STORE_ORDERS], 'readwrite');
    
    const table = await tx.objectStore(STORE_TABLES).get(tableNumber);
    if (table?.orderId) {
        const order = await tx.objectStore(STORE_ORDERS).get(table.orderId);
        if (order) {
            // 只有當狀態為 'paid' (完全結帳) 時，才將其歸檔
            if (order.status === 'paid') {
                order.status = 'paid_report_complete';
                await tx.objectStore(STORE_ORDERS).put(order);
            }
        }
    }

    await tx.objectStore(STORE_TABLES).put({ tableNumber, status: 'idle', orderId: null, lastOrderTime: Date.now() });
    await tx.done;
    return true;
}

// ----------------------------------------------------------------------
// 相容性導出
// ----------------------------------------------------------------------
export async function payOrder(orderData) {
    // 假設 payOrder 始終意味著完全結帳
    return completeOrderAndReport({ ...orderData, isFullyPaid: true });
}
export async function serveOrder(orderData) {
    return updateOrderStatus({ orderId: orderData.orderId, newStatus: 'served' });
}