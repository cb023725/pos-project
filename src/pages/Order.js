import React, { useState, useEffect, useMemo, useCallback, useReducer, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import MenuCard from '../components/MenuCard';
import {
    getMenuItems,
    getActiveOrders,
    createNewOrder,
    updateOrderStatus,
    completeOrderAndReport,
    occupyTableWithoutOrder,
    resetTableStatus,
} from '../db';

// ----------------------------------------------------------------------
// 【新增功能】開錢櫃 API 呼叫輔助函式 (直接整合在 OrderPage.js 內部)
// ----------------------------------------------------------------------
const BACKEND_URL = 'http://localhost:3000'; 

/**
 * 呼叫後端 API 以開啟錢櫃。
 * 由於結帳流程的成功不應被開錢櫃失敗所阻擋，我們只記錄錯誤但不拋出。
 */
async function openCashDrawer() {
    try {
        console.log(`🚀 呼叫後端 API: ${BACKEND_URL}/api/cash-drawer (開錢櫃)`);

        const response = await fetch(`${BACKEND_URL}/api/cash-drawer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json(); 

        if (response.ok && data.success) {
            console.log("✅ 開錢箱指令發送成功。");
            return true;
        } else {
            const errorMessage = data.message || `HTTP Status ${response.status}: ${response.statusText}`;
            console.error("❌ 開錢箱後端錯誤: 指令發送失敗。", errorMessage);
            return false;
        }

    } catch (error) {
        console.error("⚠️ 開錢箱網路請求失敗 (前端): 請確認 Node.js 服務是否已啟動。", error);
        return false;
    }
}
// ----------------------------------------------------------------------


// --- 動態計算視口高度 Hook ---
const useDynamicVh = () => {
    useEffect(() => {
        const setVh = () => {
            // 獲取視口高度 (排除瀏覽器 UI)
            let vh = window.innerHeight * 0.01;
            document.documentElement.style.setProperty('--vh', `${vh}px`);
        };

        setVh();
        
        window.addEventListener('resize', setVh);
        window.addEventListener('orientationchange', setVh);

        return () => {
            window.removeEventListener('resize', setVh);
            window.removeEventListener('orientationchange', setVh);
        };
    }, []);
};


// --- 常數定義 ---
const TABLE_OPTIONS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', '外帶'];
const CATEGORY_ORDER = ['小點', '主餐', '飲品', '冷凍包', '單點'];

// --- 輔助函數 ---
const formatCurrency = (number) => {
    const roundedNumber = Math.round(number || 0);
    return roundedNumber.toLocaleString('en-US');
};

const formatOrderId = (id) => {
    if (!id) return '---';
    const idString = String(id);
    return idString.length > 3 ? idString.slice(-3) : idString.padStart(3, '0');
};

const ACTION_TYPE = {
    SET_ORDER_AND_RICE: 'SET_ORDER_AND_RICE',
    SET_MENU: 'SET_MENU',
    ADD_ITEM: 'ADD_ITEM',
    CHANGE_QUANTITY: 'CHANGE_QUANTITY',
    MARK_ITEM_PAID: 'MARK_ITEM_PAID',
    // 僅保留類型定義，OrderPage 內不使用此 action
    TOGGLE_ITEM_SENT: 'TOGGLE_ITEM_SENT', 
};

const initialOrderState = {
    currentOrder: [],
    menuItems: [],
};

// --- Reducer 函數 ---
const orderReducer = (state, action) => {
    switch (action.type) {
        case ACTION_TYPE.SET_MENU:
            return { ...state, menuItems: action.payload };
        case ACTION_TYPE.SET_ORDER_AND_RICE: {
            const { newOrder } = action.payload;
            const itemsWithPaidStatus = newOrder.map(item => ({
                ...item,
                // 載入時確保 isSent 是一個布林值，作為註記狀態
                isSent: item.isSent === undefined ? false : !!item.isSent, 
                isPaid: item.isPaid === undefined ? false : !!item.isPaid,
            }));
            return {
                ...state,
                currentOrder: itemsWithPaidStatus,
            };
        }
        case ACTION_TYPE.ADD_ITEM: {
            const { item: itemToAdd, setIsDirty, menuItems } = action.payload;
            const updatedOrder = [...state.currentOrder];
            // 檢查是否已存在未結帳的相同餐點
            const existingIndex = updatedOrder.findIndex(oi => oi.id === itemToAdd.id && !oi.isPaid);

            if (existingIndex !== -1) {
                updatedOrder[existingIndex] = {
                    ...updatedOrder[existingIndex],
                    quantity: updatedOrder[existingIndex].quantity + 1
                };
            } else {
                const dbItem = menuItems.find(i => i.id === itemToAdd.id);
                updatedOrder.push({
                    ...itemToAdd,
                    quantity: 1,
                    isSent: false, // 預設未勾選 (作為註記)
                    isPaid: false,
                    stock: dbItem?.stock,
                    consumes: dbItem?.consumes,
                    category: dbItem?.category || '未分類',
                    internalId: Date.now() + Math.random().toString(36).substring(2, 9),
                });
            }
            setIsDirty(true);
            return { ...state, currentOrder: updatedOrder };
        }
        case ACTION_TYPE.CHANGE_QUANTITY: {
            const { internalId, newQty, setFinishTime, setSendTime, setOrderStatus, currentOrderStatus, setIsDirty } = action.payload;
            const currentItem = state.currentOrder.find(i => i.internalId === internalId);
            if (!currentItem || currentItem.isPaid) return state; // 已結帳項目不允許修改數量
            
            if (newQty <= 0) {
                // 數量歸零，移除項目
                const updatedOrder = state.currentOrder.filter(i => i.internalId !== internalId);
                
                // 僅處理移除項目後的訂單狀態
                if (updatedOrder.length === 0) {
                    setSendTime(null); setFinishTime(null); setOrderStatus('new');
                } else if (updatedOrder.length > 0 && currentOrderStatus === 'served-complete') {
                     // 狀態邏輯 (已送達完成)
                     const allSent = updatedOrder.every(item => item.isSent);
                     setOrderStatus(allSent ? 'served-complete' : 'served');
                } else if (currentOrderStatus === 'served') {
                    setOrderStatus('served');
                }
                
                setIsDirty(true);
                return { ...state, currentOrder: updatedOrder };
            }
            
            // 數量變動時，不影響 isSent 狀態，僅更新數量
            const updatedOrder = state.currentOrder.map(i => i.internalId === internalId ? { ...i, quantity: newQty } : i);
            
            setIsDirty(true);
            return { ...state, currentOrder: updatedOrder };
        }
        
        case ACTION_TYPE.MARK_ITEM_PAID: {
            const { itemIds } = action.payload;
            const updatedOrder = state.currentOrder.map(item =>
                itemIds.includes(item.internalId)
                    // 僅標記 isPaid: true，保持 isSent 的現有狀態 (作為註記)
                    ? { ...item, isPaid: true } 
                    : item
            );
            
            // 此處不需設置 setIsDirty(true)，因為 executeCheckout 成功後會統一設為 false
            return {
                ...state,
                currentOrder: updatedOrder,
            };
        }
        
        case ACTION_TYPE.TOGGLE_ITEM_SENT: {
            // OrderPage 不應觸發此 action
            return state;
        }
        
        default: return state;
    }
};

// --- Modal Components (保持不變) ---
const QuantityPadModal = ({ isOpen, onClose, currentValue, onSave, title = '設定數量', isItem = false }) => {
    const [inputValue, setInputValue] = useState(String(currentValue));
    
    useEffect(() => { if (isOpen) setInputValue(String(currentValue)); }, [isOpen, currentValue]);
    
    const handleInput = (digit) => setInputValue(prev => {
        if (prev === '0' && digit !== '0') return digit;
        if (prev === '0' && digit === '0') return '0';
        return prev + digit;
    });

    const handleQuickChange = (diff) => {
        let newQty = Math.max(0, (Number(inputValue) || 0) + diff);
        if (!isItem) newQty = Math.max(1, newQty); // 人數至少為 1
        setInputValue(String(newQty));
    }

    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-xl shadow-2xl w-80">
                <h3 className="text-xl font-black mb-4 border-b pb-2">{title}</h3>
                
                {/* 顯示和 +/- 按鈕 */}
                <div className="flex items-center justify-between border-4 p-1 mb-4 rounded-xl bg-gray-50 text-blue-700">
                    <button 
                        onClick={() => handleQuickChange(-1)} 
                        className="w-10 h-10 bg-red-100 text-red-600 rounded-lg text-2xl font-black transition-colors hover:bg-red-200"
                        disabled={!isItem && (Number(inputValue) <= 1)} // 人數不能減到 0
                    >-</button>
                    <div className="text-4xl font-black text-center flex-grow">{inputValue}</div>
                    <button 
                        onClick={() => handleQuickChange(1)} 
                        className="w-10 h-10 bg-green-100 text-green-600 rounded-lg text-2xl font-black transition-colors hover:bg-green-200"
                    >+</button>
                </div>

                {/* 數字鍵盤 */}
                <div className="grid grid-cols-3 gap-3">
                    {[7, 8, 9, 4, 5, 6, 1, 2, 3].map(n => (<button key={n} onClick={() => handleInput(String(n))} className="bg-gray-200 p-4 rounded-xl font-bold">{n}</button>))}
                    <button onClick={() => setInputValue('0')} className="bg-red-100 text-red-600 p-4 rounded-xl font-bold">清空</button>
                    <button onClick={() => handleInput('0')} className="bg-gray-200 p-4 rounded-xl font-bold">0</button>
                    <button onClick={() => setInputValue(prev => prev.slice(0, -1) || '0')} className="bg-yellow-100 text-yellow-600 p-4 rounded-xl font-bold">倒退</button>
                </div>
                
                {/* 確定按鈕 */}
                <button 
                    onClick={() => { 
                        // 確保傳回的數量符合規則 (人數 >= 1，餐點 >= 0)
                        let finalQty = Number(inputValue) || 0;
                        if (!isItem) finalQty = Math.max(1, finalQty);
                        onSave(finalQty); 
                        onClose(); 
                    }} 
                    className="w-full mt-4 bg-blue-600 text-white p-3 rounded-xl font-bold"
                >確定</button>
            </div>
        </div>
    );
};

// --- 結帳選項 Modal (保持不變) ---
const CheckoutOptionModal = ({ isOpen, onClose, onFullCheckout, onStartPartialCheckout }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-xl shadow-2xl w-80">
                <h3 className="text-xl font-black mb-4 border-b pb-2">結帳選項</h3>
                <div className="flex flex-col space-y-3">
                    <button onClick={onFullCheckout} className="py-3 rounded-xl bg-blue-600 text-white font-black">
                        全部結帳
                    </button>
                    <button onClick={onStartPartialCheckout} className="py-3 rounded-xl bg-orange-500 text-white font-black">
                        分開結帳
                    </button>
                    <button onClick={onClose} className="py-2 rounded-xl bg-gray-200 text-gray-700 font-bold">
                        取消
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- OrderPage 組件 ---
const OrderPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const initialTableNumber = location.state?.initialTableNumber || '';
    const initialOrderId = location.state?.orderId || null;
    const initialOpenTime = location.state?.openTimestamp || Date.now();

    useDynamicVh(); 

    const [state, dispatch] = useReducer(orderReducer, initialOrderState);
    const { currentOrder, menuItems } = state;

    // --- 狀態與 Hooks ---
    const [selectedCategory, setSelectedCategory] = useState(CATEGORY_ORDER[1] || CATEGORY_ORDER[0]);
    const [currentOrderId, setCurrentOrderId] = useState(initialOrderId);
    const [orderStatus, setOrderStatus] = useState(location.state?.orderStatus || (initialOrderId ? 'open' : 'new')); 
    const [tableNumber, setTableNumber] = useState(initialTableNumber);
    const [customerCount, setCustomerCount] = useState(location.state?.customerCount || 1);
    const [isLoading, setIsLoading] = useState(true);
    const [isDirty, setIsDirty] = useState(false); // 標記訂單是否有變動
    const [openTimestamp, setOpenTimestamp] = useState(initialOpenTime);
    const [sendTime, setSendTime] = useState(location.state?.sendTime || null);
    const [finishTime, setFinishTime] = useState(location.state?.finishTime || null);
    const [currentTime, setCurrentTime] = useState(Date.now());
    const checkoutLockRef = useRef(false);
    const [isQuantityModalOpen, setIsQuantityModalOpen] = useState(false);
    const [quantityTarget, setQuantityTarget] = useState(null); // 用於 QuantityPadModal

    const [isCheckoutOptionModalOpen, setIsCheckoutOptionModalOpen] = useState(false);
    const [isPartialCheckoutMode, setIsPartialCheckoutMode] = useState(false);
    const [selectedItemsForCheckout, setSelectedItemsForCheckout] = useState([]); // 部分結帳時選中的項目 internalId

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(Date.now()), 60000); // 每分鐘更新時間
        return () => clearInterval(timer);
    }, []);

    // --- 計算屬性 ---
    const subTotal = useMemo(() => currentOrder.reduce((sum, item) => sum + (item.price * item.quantity), 0), [currentOrder]);
    const totalItems = useMemo(() => currentOrder.reduce((sum, item) => sum + item.quantity, 0), [currentOrder]);

    const elapsedTimeMin = useMemo(() => {
        if (!tableNumber || orderStatus === 'new') return 0;
        return Math.floor((currentTime - openTimestamp) / 60000);
    }, [tableNumber, openTimestamp, orderStatus, currentTime]); 

    // 服務時間 (單純依賴 sendTime)
    const serviceTimeMin = useMemo(() => {
        if (!sendTime) return null;
        let diff = (currentTime - sendTime);
        return { 
            minutes: Math.floor(Math.max(0, diff) / 60000)
        };
    }, [sendTime, currentTime]);

    // 未結帳/已結帳分組
    const { unpaidItems, paidItems, unpaidTotal, paidTotal } = useMemo(() => {
        const unpaid = currentOrder.filter(item => !item.isPaid);
        const paid = currentOrder.filter(item => item.isPaid);
        const unpaidT = unpaid.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const paidT = paid.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        return { unpaidItems: unpaid, paidItems: paid, unpaidTotal: unpaidT, paidTotal: paidT };
    }, [currentOrder]);
    
    // 檢查是否可以清桌 (所有項目都已結帳)
    const canAbortOrder = useMemo(() => {
        return currentOrder.length === 0 || currentOrder.every(item => item.isPaid);
    }, [currentOrder]);

    // --- 資料載入邏輯 (保持不變) ---
    const loadMenuData = useCallback(async () => {
        try {
            const items = await getMenuItems();
            dispatch({ type: ACTION_TYPE.SET_MENU, payload: items });
        } catch (e) { console.error(e); }
    }, []);

    const loadOpenOrder = useCallback(async (tableId) => {
        if (!tableId) return;
        try {
            const allActive = await getActiveOrders();
            const openOrder = initialOrderId ? allActive.find(o => o.id === initialOrderId) : allActive.find(o => o.table === tableId);
            if (openOrder) {
                const loadedItems = openOrder.items.map(item => ({
                    ...item,
                    isSent: !!item.isSent, // 載入時保留 DB 中的手動註記狀態
                    isPaid: !!item.isPaid,
                    internalId: item.internalId || Math.random().toString(36).substr(2, 9),
                    sortOrder: item.sortOrder
                }));
                dispatch({ type: ACTION_TYPE.SET_ORDER_AND_RICE, payload: { newOrder: loadedItems } });
                setCurrentOrderId(openOrder.id);
                setOrderStatus(openOrder.status);
                setCustomerCount(openOrder.customerCount || 1);
                setOpenTimestamp(new Date(openOrder.timestamp).getTime());
                setSendTime(openOrder.sendTime);
                setFinishTime(openOrder.finishTime);
            }
        } catch (e) { console.error(e); } finally { setIsLoading(false); }
    }, [initialOrderId]);

    useEffect(() => { loadMenuData().then(() => setIsLoading(false)); }, [loadMenuData]);

    useEffect(() => {
        // 根據桌號載入或清空訂單
        if (tableNumber && menuItems.length > 0) {
            setIsLoading(true);
            loadOpenOrder(tableNumber);
        }
        if (!tableNumber) {
            dispatch({ type: ACTION_TYPE.SET_ORDER_AND_RICE, payload: { newOrder: [] } });
            setCurrentOrderId(null);
            setOrderStatus('new');
            setCustomerCount(1);
            setOpenTimestamp(Date.now());
            setSendTime(null);
            setFinishTime(null);
        }
    }, [tableNumber, menuItems, loadOpenOrder]);

    const categories = useMemo(() => CATEGORY_ORDER, []);
    
    const filteredMenu = useMemo(() => {
        let items = menuItems.filter(i => i.category === selectedCategory);
        return [...items].sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));
    }, [menuItems, selectedCategory]);

    // --- 訂單操作邏輯 ---
    const saveOrderBeforeNavigate = useCallback(async (targetTable, orderItems, orderId, count, total, status, currentSendTime, currentFinishTime) => {
        const orderData = {
            orderId, table: targetTable, customerCount: count,
            // 🚨 重點：將帶有最新數量、isSent 註記、isPaid 狀態的 orderItems 列表傳入 DB 儲存
            items: orderItems.map(({ id, name, price, quantity, isSent, isPaid, category, internalId, sortOrder }) => ({ id, name, price, quantity, isSent: !!isSent, isPaid: !!isPaid, category, internalId, sortOrder })),
            subTotal: total, total, timestamp: new Date(openTimestamp).toISOString(),
            status: status || 'new', sendTime: currentSendTime, finishTime: currentFinishTime,
        };
        try {
            const itemsExist = orderItems.length > 0;
            const isFullyPaid = itemsExist && orderItems.every(item => item.isPaid);
            
            // 嚴格執行狀態邏輯 (只依賴 items Exist 和 isFullyPaid)
            let finalStatus;
            if (!itemsExist) {
                 finalStatus = 'new';
            } else if (isFullyPaid) {
                finalStatus = 'paid';
            } else {
                // 只要有項目且未結清，狀態維持原本的 status (可能是 open, served, served-complete)
                finalStatus = status === 'new' ? 'open' : status;
                if (finalStatus === 'open') finalStatus = 'served'; // 確保點餐後是 served
            }
            
            orderData.status = finalStatus;

            if (orderId) {
                // 訂單存在，更新狀態 (包含 items 和 isSent 註記)
                await updateOrderStatus({ 
                    orderId, 
                    newStatus: finalStatus, 
                    newItems: orderData.items, // 將最新的 items 列表傳入，以更新數量和註記狀態
                    customerCount: count, 
                    sendTime: currentSendTime, 
                    finishTime: currentFinishTime 
                });
                if (finalStatus === 'paid') setOrderStatus('paid'); // 前端同步
                return orderId;
            } else if (orderItems.length > 0) {
                // 訂單不存在，創建新訂單
                const newId = await createNewOrder({ ...orderData, status: finalStatus });
                if (newId) setCurrentOrderId(newId);
                return newId;
            } else {
                return true;
            }
        } catch (e) { 
            console.error("Save Order Failed:", e);
            return false; 
        }
    }, [openTimestamp]);

    const handleGoBack = async () => {
        if (isLoading) return;
        
        // 1. 檢查是否有未儲存的變動 (且訂單有項目)
        if (isDirty && currentOrder.length > 0) {
            // 🚨 僅提示：取消則留下，確認則不儲存並返回 (變更遺失)
            const confirmDiscard = window.confirm("您有未儲存的點餐變動！\n確定要返回嗎？");
            
            if (!confirmDiscard) {
                // 選擇取消（不返回）：停留在當前頁面
                return;
            } 
            
            // 選擇確認：繼續執行返回邏輯，並丟棄變動
            setIsDirty(false); 
        }
        
        // 2. 處理空訂單或已清桌的狀態 (無論是否丟棄變動，都要處理佔桌邏輯)
        if (orderStatus === 'new' && currentOrder.length === 0 && tableNumber && tableNumber !== '外帶') {
            setIsLoading(true);
            // 佔桌操作：如果桌位是新的且沒有點餐，則僅佔用桌位時間
            await occupyTableWithoutOrder(tableNumber, openTimestamp);
            setIsLoading(false);
        }
        
        // 3. 導航回桌位管理頁
        navigate('/tables');
    };

    const handleAbortOrder = async () => {
        if (!canAbortOrder) {
            alert("尚有未結帳項目，請先結清或手動移除所有項目。");
            return;
        }
        if (!window.confirm(`確定 ${tableNumber} 客人離開並清空計時？`)) return;
        setIsLoading(true);
        try {
            await resetTableStatus(tableNumber);
            navigate('/tables');
        } catch (e) { alert("操作失敗"); } finally { setIsLoading(false); }
    };

const handleConfirmOrder = async () => {
        // ... (此處保留原邏輯，不添加開錢櫃功能)
        if (currentOrder.length === 0) return alert("請先點餐");
        
        // 如果目前沒有未結帳的項目 (unpaidItems.length === 0)，則無需點餐
        if (unpaidItems.length === 0) {
             return alert("目前沒有新的未結帳項目需要送出。");
        }
        
        // 如果是 Served/Served-Complete 狀態，且沒有新的變動，提示即可
        if ((orderStatus === 'served' || orderStatus === 'served-complete') && !isDirty) {
             return alert("訂單已送出，且沒有新的變動需要儲存。");
        }
        
        // 狀態為 'new', 'open', 或 'paid' (有新加點) 時，都允許執行儲存
        
        setIsLoading(true);
        try {
            const now = Date.now();
            
            // 狀態邏輯：
            // 1. 如果訂單原本是 'paid'，但有新加點，狀態應變為 'served'。
            // 2. 如果訂單原本是 'new'/'open'，狀態應變為 'served'。
            const targetStatus = (orderStatus === 'paid' || orderStatus === 'new' || orderStatus === 'open') ? 'served' : orderStatus; 
            
            // 【關鍵修正】：如果目前沒有計時起點，則以現在時間作為 sendTime
            const newSendTime = sendTime || now; 
            const newFinishTime = null; 

            // 將最新的 currentOrder 數據（包含已結帳項目、數量、isSent註記、新加入的項目）傳遞給儲存函數
            const itemsToSave = currentOrder; 
            
            // 儲存訂單：會將整個 items 列表更新到 DB，並更新訂單狀態為 targetStatus
            const orderId = await saveOrderBeforeNavigate(tableNumber, itemsToSave, currentOrderId, customerCount, subTotal, targetStatus, newSendTime, newFinishTime);
            
            if (orderId) {
                setOrderStatus(targetStatus);
                setSendTime(newSendTime); // 更新本地狀態以啟動計時
                setFinishTime(newFinishTime);
                navigate('/tables'); // 儲存成功後返回桌位頁
            }
            setIsDirty(false);
        } catch (e) { alert("儲存失敗"); } finally { setIsLoading(false); }
    };

    const handlePreCheckout = () => {
        if (unpaidItems.length === 0) {
            alert("沒有未結帳的項目可以操作。");
            return;
        }
        setIsCheckoutOptionModalOpen(true);
    };

    const executeCheckout = async (itemsToCheckout) => {
        if (checkoutLockRef.current) return;
        checkoutLockRef.current = true;
        setIsLoading(true);
        setIsPartialCheckoutMode(false);
        setSelectedItemsForCheckout([]);

        try {
            const now = Date.now();
            const totalToPay = itemsToCheckout.reduce((sum, item) => sum + item.price * item.quantity, 0);
            
            if (!window.confirm(`確認結帳金額：NT$ ${formatCurrency(totalToPay)}？`)) {
                checkoutLockRef.current = false;
                setIsLoading(false);
                return;
            }

            const itemIds = itemsToCheckout.map(i => i.internalId);
            
            // 1. 🚨 計算本次結帳後，訂單在 DB 中應有的最終狀態列表。
            const updatedOrderForDb = currentOrder.map(item => {
                if (itemIds.includes(item.internalId)) {
                    return { ...item, isPaid: true }; 
                }
                return item;
            });
            
            const isFullyPaid = updatedOrderForDb.every(item => item.isPaid); 
            
            let finalStatus;
            if (updatedOrderForDb.length === 0) {
                 finalStatus = 'new';
            } else if (isFullyPaid) {
                finalStatus = 'paid';
            } else {
                finalStatus = 'served'; 
            }
            
            const newFinishTime = isFullyPaid ? now : finishTime; 
            
            // 【關鍵修正】：結帳時若尚未計時，直接開始計時
            const newSendTime = sendTime || now; 
            
            // 2. 【DB 主訂單狀態更新】儲存訂單到 DB
            const orderId = await saveOrderBeforeNavigate(tableNumber, updatedOrderForDb, currentOrderId, customerCount, subTotal, finalStatus, newSendTime, newFinishTime);
            
            if (!orderId) {
                throw new Error("DB 訂單主狀態更新失敗。");
            }
            
            // 3. 【DB 結帳記錄/庫存扣減】建立結帳記錄
            const completeSuccess = await completeOrderAndReport({
                orderId: currentOrderId || orderId, 
                itemsToCheckout: itemsToCheckout, 
                tableNumber: tableNumber, 
                isFullyPaid: isFullyPaid 
            });
            
            if (!completeSuccess) {
                throw new Error("DB 結帳記錄/庫存扣減失敗。請檢查 DB 連線。");
            }
            
            // 4. 【新增】調用開錢櫃功能
            openCashDrawer(); 
            
            // 5. 【前端狀態更新】只有在 DB 操作 100% 成功後，才 dispatch 到 Reducer
            dispatch({
                type: ACTION_TYPE.MARK_ITEM_PAID,
                payload: { itemIds } 
            });

            // 6. 更新前端狀態並導航
            if (currentOrderId === null) { 
                setCurrentOrderId(orderId);
            }
            
            // 同步更新本地 sendTime 狀態，確保 UI 計時器即刻運作
            setSendTime(newSendTime);

            if (finalStatus === 'paid') {
                setOrderStatus('paid');
                if (tableNumber !== '外帶') navigate('/tables', { replace: true });
            } else {
                setOrderStatus('served'); 
                // 此處已在上方統一處理 setSendTime
            }
            
            setIsDirty(false); 

        } catch (e) {
            alert("結帳操作失敗: " + e.message);
        } finally {
            checkoutLockRef.current = false;
            setIsLoading(false);
        }
    };
    
    // ...其餘代碼保持不變
    
    const handleFullCheckout = async () => {
        setIsCheckoutOptionModalOpen(false);
        if (unpaidItems.length === 0) return;
        
        await executeCheckout(unpaidItems);
    };

    const handleStartPartialCheckout = () => {
        setIsCheckoutOptionModalOpen(false);
        setIsPartialCheckoutMode(true);
        setSelectedItemsForCheckout([]);
    };

    const toggleItemSelection = (item) => {
        if (item.isPaid) return;
        setSelectedItemsForCheckout(prev => {
            const isSelected = prev.includes(item.internalId);
            return isSelected
                ? prev.filter(id => id !== item.internalId)
                : [...prev, item.internalId];
        });
    };

    const handleExecutePartialCheckout = async () => {
        const selectedItems = currentOrder.filter(item => selectedItemsForCheckout.includes(item.internalId));
        if (selectedItems.length === 0) {
            alert("請選擇要結帳的項目。");
            return;
        }
        await executeCheckout(selectedItems);
    };
    
    const handleCancelPartialCheckout = () => {
        setIsPartialCheckoutMode(false);
        setSelectedItemsForCheckout([]);
    };
    
    // 點擊訂單項目行事件 (正常模式下僅靜態顯示，分帳模式下選取)
    const handleItemClick = (item) => {
        if (item.isPaid || isLoading) return; 

        if (isPartialCheckoutMode) {
            // 分帳模式：選取項目
            toggleItemSelection(item);
        } else {
            // 正常模式：不執行任何操作
            return;
        }
    };
    
    const handleChangeItemQuantity = (internalId, diff) => {
        const currentItem = currentOrder.find(i => i.internalId === internalId);
        if (!currentItem || currentItem.isPaid) return;
        
        const newQty = Math.max(0, currentItem.quantity + diff);
        
        dispatch({
            type: ACTION_TYPE.CHANGE_QUANTITY,
            payload: {
                internalId: internalId,
                newQty: newQty,
                setFinishTime,
                setSendTime,
                setOrderStatus,
                currentOrderStatus: orderStatus,
                setIsDirty
            }
        });
    };
    // --- 輔助邏輯 (保持不變) ---
    const handleTableChange = async (event) => {
        const newTable = event.target.value;
        if (isDirty && currentOrder.length > 0) {
            if (!window.confirm(`訂單有變更，切換桌號 ${tableNumber} -> ${newTable} 前是否要儲存此筆訂單？ (否則變更將會遺失)`)) {
                // 如果選擇不儲存，直接切換桌號，isDirty 在此處被忽略
                setTableNumber(newTable);
                setIsDirty(false); // 重設為乾淨狀態以避免二次彈窗
                return;
            } else {
                // 儲存時，會自動更新為 served 或 paid 狀態
                const savedId = await saveOrderBeforeNavigate(tableNumber, currentOrder, currentOrderId, customerCount, subTotal, orderStatus, sendTime, finishTime);
                if (!savedId) {
                    alert('儲存失敗，無法切換桌號。');
                    return;
                }
            }
        }
        setTableNumber(newTable);
        setCurrentOrderId(null);
        setOrderStatus('new');
        setCustomerCount(1);
        setOpenTimestamp(Date.now());
        setSendTime(null);
        setFinishTime(null);
        setIsDirty(false);
    };

    const handleChangeCustomerCount = (diff) => {
        const newCount = Math.max(1, customerCount + diff);
        setCustomerCount(newCount);
        setIsDirty(true);
    };

    const handleQuantitySave = (newQty) => {
        if (quantityTarget.type === 'item') {
            // 用於處理數量鍵盤輸入的餐點數量
            dispatch({
                type: ACTION_TYPE.CHANGE_QUANTITY,
                payload: {
                    internalId: quantityTarget.internalId,
                    newQty: newQty,
                    setFinishTime,
                    setSendTime,
                    setOrderStatus,
                    currentOrderStatus: orderStatus,
                    setIsDirty
                }
            });
        } else if (quantityTarget.type === 'customer') {
            // 用於處理數量鍵盤輸入的顧客人數
            setCustomerCount(Math.max(1, newQty));
            setIsDirty(true);
        }
        setQuantityTarget(null);
    };
    
    // 點擊訂單項目數量，彈出數字鍵盤
    const handleOpenItemQuantityModal = (item) => {
        if (item.isPaid || isPartialCheckoutMode) return;
        setQuantityTarget({ type: 'item', internalId: item.internalId, currentValue: item.quantity });
        setIsQuantityModalOpen(true);
    };
    
    // 點擊客戶人數，彈出數字鍵盤
    const handleOpenCustomerCountModal = () => {
        setQuantityTarget({ type: 'customer', currentValue: customerCount });
        setIsQuantityModalOpen(true);
    };

    return (
        <div 
            className="flex w-full overflow-hidden font-sans" 
            style={{ height: 'calc(var(--vh, 1vh) * 100)' }} 
        >
            
            <div className="flex flex-grow p-2 bg-gray-50 h-full">
                
                {/* 左側區塊：訂單明細與結帳區 */}
                <div className="w-[30%] flex flex-col bg-white rounded-xl overflow-hidden mr-2 h-full">
                    
                    {/* 頂部區塊 */}
                    <div className="flex-shrink-0"> 
                        {/* 第一行：返回按鈕、桌號、內用/外帶、人數、時間 */}
                        <div className="p-2 bg-red-600 text-white flex justify-between items-center">
                            
                            <div className="flex items-center space-x-2">
                                <button 
                                    onClick={handleGoBack} 
                                    className="text-white hover:bg-white/10 p-0 rounded-full transition-colors"
                                    title="返回桌位管理"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                </button>
                                
                                <select
                                    value={tableNumber}
                                    onChange={handleTableChange}
                                    className="bg-transparent text-white font-black text-xl appearance-none cursor-pointer border-none p-1.5 0 focus:outline-none w-auto"
                                >
                                    {TABLE_OPTIONS.map(opt => <option key={opt} value={opt} className="bg-red-600">{opt || ''}</option>)}
                                </select>
                                
                                <div className="flex items-center space-x-1 bg-white/20 p-0.5 rounded-full">
                                    <div className="text-xs font-bold bg-white text-red-600 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                        {tableNumber === '外帶' ? '外帶' : '內用'}
                                    </div>

                                    {tableNumber !== '' && (
                                        <div className="flex items-center text-xs font-black space-x-1.5">
                                            <button
                                                onClick={() => handleChangeCustomerCount(-1)}
                                                className="w-5 h-5 bg-white/10 text-white rounded-full transition-colors hover:bg-white/30 flex items-center justify-center text-sm leading-none"
                                                disabled={customerCount <= 1}
                                            >-</button>
                                            <span
                                                onClick={handleOpenCustomerCountModal}
                                                className="text-white font-black text-base cursor-pointer px-3">
                                                {customerCount}
                                            </span>
                                            <button
                                                onClick={() => handleChangeCustomerCount(1)}
                                                className="w-5 h-5 bg-white/10 text-white rounded-full transition-colors hover:bg-white/30 flex items-center justify-center text-sm leading-none"
                                            >+</button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center space-x-2 text-xs font-bold">
                                <div className="flex flex-col text-right">
                                    <span className="text-[10px]">
                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/70 mr-1" />
                                        {elapsedTimeMin} min
                                    </span>
                                    {serviceTimeMin && <span className="text-[10px]">
                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/70 mr-1" />
                                        {serviceTimeMin.minutes} min
                                    </span>}
                                </div>
                            </div>
                        </div>

                        {/* 第二行：單號、商品總數 */}
                        <div className="flex-shrink-0"> 
                            <div className="py-1 px-3 bg-red-500 text-white flex justify-between items-center text-sm font-bold">
                                <div className="flex items-center">
                                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2H7a2 2 0 00-2 2v2M7 7a2 2 0 012-2h6a2 2 0 012 2v2H7V7z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                    <span className="text-base">{formatOrderId(currentOrderId)}</span>
                                </div>
                                <div className="text-right pr-1">
                                    <span>商品總數 {totalItems}</span>
                                </div>
                            </div>
                        </div>                    
                    </div>

                    {/* 內容區：訂單明細 (可滾動) */}
                    <div className="flex-grow overflow-y-auto p-3">
                        {currentOrder.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400">
                                <span className="text-4xl mb-2">📥</span>
                                <p className="font-bold">尚未選取餐點</p>
                                {(orderStatus === 'new' || orderStatus === 'open') && tableNumber && (
                                    <button onClick={handleAbortOrder} className="mt-4 text-red-500 border border-red-200 px-4 py-2 rounded-lg hover:bg-red-50 font-bold">客人已離開 (清空桌位)</button>
                                )}
                            </div>
                        ) : (
                            // 依據結帳狀態分組顯示
                            <>
                                {/* 未結帳分組 */}
                                {unpaidItems.length > 0 && (
                                    <div className="mb-3">
                                        <div className="text-xs font-black text-red-600 mb-1 flex items-center justify-between border-b pb-0.5 px-1">
                                            <div className='flex items-center'>
                                                <span className={`w-2 h-2 rounded-full mr-2 bg-red-600`} />
                                                未結帳
                                                {isPartialCheckoutMode 
                                                    ? <span className="text-xs font-normal text-gray-500 ml-2">(點擊選取結帳)</span>
                                                    : <span className="text-xs font-normal text-gray-500 ml-2"></span> 
                                                }
                                            </div>
                                            {/* 未結帳金額放在同一列尾巴 */}
                                            <span className="text-base font-black pr-2">${formatCurrency(unpaidTotal)}</span>
                                        </div>
                                        {unpaidItems.map(item => (
                                            <div 
                                                key={item.internalId} 
                                                // 正常模式下，只在分帳模式下才允許點擊（切換選擇狀態）
                                                className={`flex items-center justify-between p-2 border rounded-xl mb-1 bg-white shadow-sm transition-colors ${isPartialCheckoutMode ? (selectedItemsForCheckout.includes(item.internalId) ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-500 cursor-pointer' : 'hover:bg-gray-100 cursor-pointer') : ''}`}
                                                onClick={isPartialCheckoutMode ? () => handleItemClick(item) : undefined}
                                            >
                                                {/* 1. 核取方塊/狀態標誌 (isSent 獨立控制) */}
                                                <div className="w-5 h-5 mr-2 flex-shrink-0 flex items-center justify-center">
                                                    {isPartialCheckoutMode ? (
                                                        // 分帳模式下的選擇框
                                                        selectedItemsForCheckout.includes(item.internalId) ? (
                                                            <svg className="w-full h-full text-orange-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                                                        ) : (
                                                            <div className="w-full h-full rounded-full border-2 border-gray-400"></div>
                                                        )
                                                    ) : (
                                                        // 正常模式下，顯示 isSent 註記狀態 (靜態)
                                                        item.isSent ? (
                                                            // 已送餐 (打勾)
                                                            <svg className="w-full h-full text-green-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                                                        ) : (
                                                            // 未送餐 (空心圓圈)
                                                            <div className="w-full h-full rounded-full border-2 border-gray-400"></div>
                                                        )
                                                    )}
                                                </div>
                                                
                                                {/* 2. 餐點名稱 */}
                                                <div className="flex flex-col flex-grow">
                                                    <div className="flex items-center gap-1">
                                                        {/* 判斷：如果是主餐，且有 sortOrder，就顯示黑色小標籤 */}
                                                        {item.category === '主餐' && item.sortOrder && (
                                                            <div 
                                                                className="flex-shrink-0 flex items-center justify-center w-5 h-5 bg-black rounded-md"
                                                            >
                                                                <span className="text-white font-bold text-[10px] leading-none">
                                                                    {item.sortOrder}
                                                                </span>
                                                            </div>
                                                        )}
                                                        <span className="font-bold text-[16px]">{item.name}</span>
                                                    </div>
                                                </div>
                                                
                                                {/* 3. 數量控制與金額 */}
                                                <div className="flex flex-col items-end space-y-1"> 
                                                    {/* 數量控制 */}
                                                    <div className="flex items-center space-x-2"> 
                                                        {/* 數量減按鈕 (灰底半透明) */}
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleChangeItemQuantity(item.internalId, -1); }}
                                                            className="w-6 h-6 bg-black/5 text-gray-700 rounded-full transition-colors hover:bg-gray-300 flex items-center justify-center text-sm leading-none font-bold shadow-sm"
                                                            disabled={isLoading || isPartialCheckoutMode}
                                                        >-</button>
                                                        
                                                        {/* 數量顯示 (可點擊彈出數字鍵盤) */}
                                                        <span 
                                                            onClick={(e) => { e.stopPropagation(); handleOpenItemQuantityModal(item); }}
                                                            className={`text-xl font-black text-gray-800 px-1 ${!isPartialCheckoutMode ? 'cursor-pointer' : ''}`}
                                                        >
                                                            {item.quantity}
                                                        </span>
                                                        
                                                        {/* 數量加按鈕 (灰底半透明) */}
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleChangeItemQuantity(item.internalId, 1); }}
                                                            className="w-6 h-6 bg-black/5 text-gray-700 rounded-full transition-colors hover:bg-gray-300 flex items-center justify-center text-sm leading-none font-bold shadow-sm"
                                                            disabled={isLoading || isPartialCheckoutMode}
                                                        >+</button>
                                                    </div>
                                                    
                                                    {/* 單項總金額 (向下移動，與右側拉開距離) */}
                                                    <span className="text-xs font-black text-gray-800 self-end pr-2"> 
                                                        ${formatCurrency(item.price * item.quantity)}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                
                                {/* 已結帳分組 */}
                                {paidItems.length > 0 && (
                                    <div className="mb-3 opacity-80">
                                        <div className="text-xs font-black text-green-600 mb-1 flex items-center justify-between border-b pb-0.5 px-1">
                                            <div className='flex items-center'>
                                                <span className={`w-2 h-2 rounded-full mr-2 bg-green-600`} />
                                                已結帳
                                            </div>
                                            {/* 已結帳金額放在同一列尾巴 */}
                                            <span className="text-base font-black pr-2">${formatCurrency(paidTotal)}</span>
                                        </div>
                                        {paidItems.map(item => (
                                            <div key={item.internalId} className="flex items-center justify-between p-2 border border-green-200 rounded-xl mb-1 bg-white shadow-sm">
                                                {/* 已結帳項目，顯示 isSent 註記狀態 (靜態) */}
                                                <div className="w-5 h-5 mr-2 flex-shrink-0 flex items-center justify-center">
                                                    {item.isSent ? (
                                                        <svg className="w-full h-full text-green-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                                                    ) : (
                                                        <div className="w-full h-full rounded-full border-2 border-gray-400"></div>
                                                    )}
                                                </div>
                                                <div className="flex flex-col flex-grow">
                                                    {/* 使用 block 確保內部元素可以浮動繞排 */}
                                                    <div className="block w-full">
                                                        {item.category === '主餐' && item.sortOrder && (
                                                            <div 
                                                                className="float-left flex items-center justify-center w-5 h-5 bg-black rounded-md mr-1 mt-0.5"
                                                            >
                                                                <span className="text-white font-bold text-[10px] leading-none">
                                                                    {Number(item.sortOrder)}
                                                                </span>
                                                            </div>
                                                        )}
                                                        <span className="font-bold text-[16px] leading-tight inline">
                                                            {item.name}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col items-end space-y-1">
                                                    <span className="text-xl font-black text-gray-800 px-1 pr-2">{item.quantity}</span>
                                                    {/* 單項總金額 (向下移動，與右側拉開距離) */}
                                                    <span className="text-xs font-black text-gray-800 self-end pr-2">${formatCurrency(item.price * item.quantity)}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* 底部按鈕區 */}
                    <div className="p-3 bg-gray-50 border-t flex-shrink-0">
                        
                        <div className="border p-2 rounded-lg mb-2 bg-white shadow-inner flex justify-between items-center">
                             <span className="font-bold text-gray-800">總金額</span>
                             <span className="font-black text-2xl text-red-600">NT$ {formatCurrency(subTotal)}</span>
                        </div>
                        
                        {/* 根據模式顯示不同按鈕 */}
                        <div className="flex flex-col space-y-1">
                            {isPartialCheckoutMode ? (
                                // 部分結帳模式下的按鈕
                                <div className="flex space-x-2">
                                    <button
                                        onClick={handleExecutePartialCheckout}
                                        className="flex-1 py-3 bg-orange-500 text-white rounded-xl font-black text-base shadow-lg active:scale-95"
                                        disabled={selectedItemsForCheckout.length === 0 || isLoading}
                                    >
                                        確認結帳 ({selectedItemsForCheckout.length} 項)
                                    </button>
                                    <button
                                        onClick={handleCancelPartialCheckout}
                                        className="py-3 px-4 bg-gray-300 text-gray-700 rounded-xl font-black text-base shadow-lg active:scale-95"
                                    >
                                        取消
                                    </button>
                                </div>
                            ) : (
                                // 正常模式下的按鈕
                                currentOrder.length > 0 ? (
                                    <div className="flex space-x-2">
                                        <button
                                            onClick={handleConfirmOrder}
                                            className="flex-1 py-3 bg-orange-500 text-white rounded-xl font-black text-base shadow-lg active:scale-95"
                                            // 只有在 unpaidItems.length > 0 才允許點「確認點餐」
                                            disabled={isLoading || unpaidItems.length === 0}
                                        >
                                            確認點餐
                                        </button>
                                        <button
                                            onClick={handlePreCheckout}
                                            className="flex-1 py-3 bg-red-600 text-white rounded-xl font-black text-base shadow-lg active:scale-95"
                                            disabled={isLoading || unpaidItems.length === 0}
                                        >
                                            結帳
                                        </button>
                                    </div>
                                ) : (
                                    <button onClick={handleGoBack} className="w-full py-3 bg-blue-600 text-white rounded-xl font-black text-base shadow-lg" disabled={isLoading}>
                                        ＜ 返回桌位管理頁
                                    </button>
                                )
                            )}

                            {/* 清桌/離開按鈕，只有在全部 paid 或無項目時才能用 */}
                            <button 
                                onClick={handleAbortOrder} 
                                className={`w-full py-1 font-bold text-xs transition-colors ${canAbortOrder ? 'text-blue-600 hover:bg-blue-50' : 'text-gray-400 cursor-not-allowed'}`} 
                                disabled={isLoading}
                            >
                                客人離開 ({canAbortOrder ? '清空桌位' : '請先結清或手動移除所有項目'})
                            </button>
                        </div>
                    </div>
                </div>

                {/* 右側區塊：菜單選擇區 */}
                <div className="w-[70%] flex flex-col bg-white rounded-xl p-2 h-full">
                    {/* 菜單類別 Tabs 區塊 */}
                    <div className="flex items-center mb-3 flex-shrink-0">
                        <div className="flex space-x-2 overflow-x-auto scrollbar-hide flex-grow">
                            {categories.map(cat => (
                                <button 
                                    key={cat} 
                                    onClick={() => setSelectedCategory(cat)} 
                                    className={`px-8 py-2.5 rounded-xl font-bold transition-all whitespace-nowrap text-m ${selectedCategory === cat ? 'bg-blue-600 text-white shadow-lg' : 'bg-gray-100'}`}
                                >
                                    {cat}
                                </button>
                            ))}
                        </div>
                    </div>
                    
                    {/* 菜單內容區塊 (滾動區) */}
                    <div className="flex-grow overflow-y-auto">
                        {/* 移除左右 padding (px-0)，並確保寬度為 full */}
                        <div className="w-full px-0 py-2"> 
                            {/* 設定 gap-3 並確保 grid 撐滿全寬 */}
                            <div className="grid grid-cols-5 gap-3 w-full"> 
    {filteredMenu.flatMap(item => {
        // 判斷條件：當前是主餐 Tab，且項目編號是 10
        if (item.category === '主餐' && Number(item.sortOrder) === 10 || item.category === '單點' && Number(item.sortOrder) === 46) {
            return [
                // 1. 插入一個完全空白的佔位格子 (對應 grid-cols-5 的最後一格)
                <div key="gap-10" className="w-full" aria-hidden="true" />,
                
                // 2. 渲染原本的 10 號 MenuCard (會自動跳到下一排第一格)
                <MenuCard
                    key={item.id}
                    item={item}
                    onAddItem={(i) => {
                        dispatch({ 
                            type: ACTION_TYPE.ADD_ITEM, 
                            payload: { item: i, setIsDirty, menuItems } 
                        });
                    }}
                />
            ];
        }

        // 一般情況：正常渲染
        return (
            <MenuCard
                key={item.id}
                item={item}
                onAddItem={(i) => {
                    dispatch({ 
                        type: ACTION_TYPE.ADD_ITEM, 
                        payload: { item: i, setIsDirty, menuItems } 
                    });
                }}
            />
        );
    })}
</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Modal 元件區 */}
            <QuantityPadModal
                isOpen={isQuantityModalOpen}
                onClose={() => setIsQuantityModalOpen(false)}
                currentValue={quantityTarget?.currentValue || 1}
                onSave={handleQuantitySave}
                title={quantityTarget?.type === 'customer' ? '設定用餐人數' : '設定餐點數量'}
                isItem={quantityTarget?.type === 'item'} 
            />
            
            <CheckoutOptionModal
                isOpen={isCheckoutOptionModalOpen}
                onClose={() => setIsCheckoutOptionModalOpen(false)}
                onFullCheckout={handleFullCheckout}
                onStartPartialCheckout={handleStartPartialCheckout}
            />
            
            {/* Loading 覆蓋層 */}
            {isLoading && <div className="fixed inset-0 bg-black/20 z-[60] flex items-center justify-center"><div className="bg-white p-4 rounded-lg animate-pulse font-bold">處理中...</div></div>}
        </div>
    );
};

export default OrderPage;