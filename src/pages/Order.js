import React, { useState, useEffect, useMemo, useCallback, useReducer, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import MenuCard from '../components/MenuCard';
import {
    getMenuItems,
    getInventoryItems,
    getActiveOrders,
    createNewOrder,
    updateOrderStatus,
    completeOrderAndReport,
    occupyTableWithoutOrder,
    resetTableStatus,
    getTableStatuses,
    searchCustomer,
    autoSaveCustomer,
    updateMenuItem,
    resetAllSoldOut,
    getRemarkGroups,
    getCategorySettings,
    DEFAULT_CATEGORY_SETTINGS,
} from '../db';

// ----------------------------------------------------------------------
// 【新增功能】開錢櫃 API 呼叫輔助函式 (直接整合在 OrderPage.js 內部)
// ----------------------------------------------------------------------
const BACKEND_URL = ''; // 相對路徑，支援任何裝置（電腦/平板）

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
const CATEGORY_ORDER = ['主餐', '小點', '飲品', '冷凍包', '單點'];

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
    UPDATE_REMARKS: 'UPDATE_REMARKS',
    TOGGLE_ITEM_SENT: 'TOGGLE_ITEM_SENT',
    MARK_ITEMS_SENT: 'MARK_ITEMS_SENT',
    TOGGLE_ITEM_SERVED: 'TOGGLE_ITEM_SERVED',
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
                isSent: item.isSent === undefined ? false : !!item.isSent,
                isServed: item.isServed === undefined ? false : !!item.isServed,
                isPaid: item.isPaid === undefined ? false : !!item.isPaid,
            }));
            return {
                ...state,
                currentOrder: itemsWithPaidStatus,
            };
        }
        case ACTION_TYPE.ADD_ITEM: {
            const { item: itemToAdd, setIsDirty, menuItems, remarks } = action.payload;
            const updatedOrder = [...state.currentOrder];
            const itemRemarks = remarks || [];
            // 每次點擊都建立獨立一行（qty=1），讓每個品項可以單獨設定備註
            const dbItem = menuItems.find(i => i.id === itemToAdd.id);
            updatedOrder.push({
                ...itemToAdd,
                quantity: 1,
                isSent: false,
                isServed: false,
                isPaid: false,
                stock: dbItem?.stock,
                consumes: dbItem?.consumes,
                category: dbItem?.category || '未分類',
                internalId: Date.now() + Math.random().toString(36).substring(2, 9),
                remarks: itemRemarks,
            });
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
        
        case ACTION_TYPE.UPDATE_REMARKS: {
            const { internalId, remarks, setIsDirty } = action.payload;
            const updatedOrder = state.currentOrder.map(item =>
                item.internalId === internalId ? { ...item, remarks: remarks || [] } : item
            );
            if (setIsDirty) setIsDirty(true);
            return { ...state, currentOrder: updatedOrder };
        }

        case ACTION_TYPE.TOGGLE_ITEM_SENT: {
            const { internalId } = action.payload;
            const updatedOrder = state.currentOrder.map(item =>
                item.internalId === internalId ? { ...item, isSent: !item.isSent } : item
            );
            return { ...state, currentOrder: updatedOrder };
        }

        case ACTION_TYPE.MARK_ITEMS_SENT: {
            const { internalIds } = action.payload;
            const idSet = new Set(internalIds);
            const updatedOrder = state.currentOrder.map(item =>
                idSet.has(item.internalId) ? { ...item, isSent: true } : item
            );
            return { ...state, currentOrder: updatedOrder };
        }

        case ACTION_TYPE.TOGGLE_ITEM_SERVED: {
            const { internalId } = action.payload;
            const updatedOrder = state.currentOrder.map(item =>
                item.internalId === internalId ? { ...item, isServed: !item.isServed } : item
            );
            return { ...state, currentOrder: updatedOrder };
        }

        default: return state;
    }
};

// --- Modal Components (保持不變) ---
const QuantityPadModal = ({ isOpen, onClose, currentValue, onSave, title = '設定數量', isItem = false, allowZero = false }) => {
    const [inputValue, setInputValue] = useState(String(currentValue));

    useEffect(() => { if (isOpen) setInputValue(String(currentValue)); }, [isOpen, currentValue]);

    const handleInput = (digit) => setInputValue(prev => {
        if (prev === '0' && digit !== '0') return digit;
        if (prev === '0' && digit === '0') return '0';
        return prev + digit;
    });

    const handleQuickChange = (diff) => {
        let newQty = Math.max(0, (Number(inputValue) || 0) + diff);
        if (!isItem && !allowZero) newQty = Math.max(1, newQty); // 人數至少為 1（除非 allowZero）
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
                        disabled={!isItem && !allowZero && (Number(inputValue) <= 1)}
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
                        let finalQty = Number(inputValue) || 0;
                        if (!isItem && !allowZero) finalQty = Math.max(1, finalQty);
                        onSave(finalQty);
                        onClose();
                    }}
                    className="w-full mt-4 bg-blue-600 text-white p-3 rounded-xl font-bold"
                >確定</button>
            </div>
        </div>
    );
};

// --- 即時庫存不足 Modal（本次點餐超出庫存）---
const StockLimitModal = ({ warning, onConfirm, onCancel }) => {
    if (!warning) return null;
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-2xl shadow-2xl w-80">
                <h3 className="text-xl font-black mb-2 border-b pb-2 text-red-600">⚠️ 庫存即將售完</h3>
                <p className="text-gray-800 font-bold text-lg mb-1">{warning.menuItemName}</p>
                <p className="text-gray-500 text-sm mb-1">庫存品項：<span className="font-bold text-gray-700">{warning.invItemName}</span></p>
                <p className="text-gray-500 text-sm mb-5">
                    資料庫剩 <span className="font-black text-red-600">{warning.dbStock}</span> 份，
                    本桌已點 <span className="font-black">{warning.consumed}</span> 份，
                    可用 <span className={`font-black ${warning.available <= 0 ? 'text-red-600' : 'text-orange-500'}`}>{warning.available}</span> 份
                </p>
                <div className="flex gap-3">
                    <button onClick={onCancel}  className="flex-1 py-3 rounded-xl font-black bg-gray-100 text-gray-700 hover:bg-gray-200">取消</button>
                    <button onClick={onConfirm} className="flex-1 py-3 rounded-xl font-black text-white bg-red-500 hover:bg-red-600">強制點餐</button>
                </div>
            </div>
        </div>
    );
};

// --- 售完確認 Modal（庫存耗盡，仍可點餐）---
const DepletedConfirmModal = ({ item, onConfirm, onCancel }) => {
    if (!item) return null;
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-2xl shadow-2xl w-80">
                <h3 className="text-xl font-black mb-2 border-b pb-2 text-orange-600">⚠️ 庫存售完</h3>
                <p className="text-gray-800 font-bold text-lg mb-1">{item.name}</p>
                <p className="text-gray-500 text-sm mb-5">此品項庫存已售完，確定要繼續點餐？</p>
                <div className="flex gap-3">
                    <button onClick={onCancel}  className="flex-1 py-3 rounded-xl font-black bg-gray-100 text-gray-700 hover:bg-gray-200">取消</button>
                    <button onClick={onConfirm} className="flex-1 py-3 rounded-xl font-black text-white bg-orange-500 hover:bg-orange-600">確認點餐</button>
                </div>
            </div>
        </div>
    );
};

// --- 停售確認 Modal ---
const SoldOutModal = ({ item, onConfirm, onCancel }) => {
    if (!item) return null;
    const isSoldOut = !!item.soldOut;
    const isMain    = item.category === '主餐';
    const isSingle  = item.category === '單點';
    const hasCascade = isMain || (isSingle && item.id.endsWith('1'));
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-2xl shadow-2xl w-80">
                <h3 className="text-xl font-black mb-2 border-b pb-2">
                    {isSoldOut ? '取消停售' : '停售確認'}
                </h3>
                <p className="text-gray-800 font-bold text-lg mb-1">{item.name}</p>
                {hasCascade && !isSoldOut && (
                    <p className="text-xs text-orange-500 mb-4">
                        ⚠️ {isMain ? '對應的單點版本' : '對應的主餐版本'}也會一併停售
                    </p>
                )}
                {hasCascade && isSoldOut && (
                    <p className="text-xs text-green-600 mb-4">
                        {isMain ? '對應的單點版本' : '對應的主餐版本'}也會一併恢復
                    </p>
                )}
                {!hasCascade && <div className="mb-4" />}
                <div className="flex gap-3">
                    <button
                        onClick={onConfirm}
                        className={`flex-1 py-3 rounded-xl font-black text-white transition-colors
                            ${isSoldOut ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'}`}
                    >
                        {isSoldOut ? '恢復販售' : '確認停售'}
                    </button>
                    <button
                        onClick={onCancel}
                        className="flex-1 py-3 rounded-xl font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                    >
                        取消
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- 結帳選項 Modal ---
const CheckoutOptionModal = ({ isOpen, onClose, onFullCheckout, onStartPartialCheckout, onPrintKitchen, onPrintCustomer, isAllPaid }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-xl shadow-2xl w-80">
                <h3 className="text-xl font-black mb-4 border-b pb-2">結帳選項</h3>
                <div className="flex flex-col space-y-3">
                    {isAllPaid ? (
                        <div className="py-3 rounded-xl bg-gray-200 text-gray-400 font-black text-center text-sm">
                            本單已結帳
                        </div>
                    ) : (
                        <>
                            <button onClick={onFullCheckout} className="py-3 rounded-xl bg-blue-600 text-white font-black">
                                全部結帳
                            </button>
                            <button onClick={onStartPartialCheckout} className="py-3 rounded-xl bg-orange-500 text-white font-black">
                                分開結帳
                            </button>
                        </>
                    )}
                    <div className="flex gap-2">
                        <button onClick={onPrintKitchen} className="flex-1 py-3 rounded-xl bg-teal-600 text-white font-black text-sm">
                            印廚房單
                        </button>
                        <button onClick={onPrintCustomer} className="flex-1 py-3 rounded-xl bg-teal-700 text-white font-black text-sm">
                            印顧客單
                        </button>
                    </div>
                    <button onClick={onClose} className="py-2 rounded-xl bg-gray-200 text-gray-700 font-bold">
                        取消
                    </button>
                </div>
            </div>
        </div>
    );
};

const QUICK_CASH = [1000, 500, 100, 50, 10, 5];

const CheckoutSuccessModal = ({ isOpen, total, isPartial, isTakeout, onConfirm }) => {
    const [cashInput, setCashInput] = React.useState('');
    const rounded = Math.round(total);
    const cash = parseInt(cashInput, 10) || 0;
    const change = Math.max(0, cash - rounded);
    const fmt = (n) => Math.round(n).toLocaleString('en-US');

    React.useEffect(() => {
        if (isOpen) setCashInput('');
    }, [isOpen]);

    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                {/* 頂部 */}
                <div className="flex flex-col items-center pt-8 pb-5 px-6">
                    <div className="w-16 h-16 rounded-full border-[3px] border-[#2FB8B8] flex items-center justify-center mb-3">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2FB8B8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    </div>
                    <h3 className="text-2xl font-black mb-1">{isPartial ? '部分結帳完成' : '結帳完成'}</h3>
                    <p className="text-base text-gray-500">本次結帳金額為 <span className="font-black text-gray-800">${fmt(rounded)}</span></p>
                </div>

                <div className="border-t border-gray-100" />

                {/* 兩欄：付款金額 | 找零 */}
                <div className="grid grid-cols-2 divide-x divide-gray-100 py-4">
                    <div className="text-center py-2">
                        <p className="text-xs text-gray-400 font-bold mb-1">付款金額</p>
                        <p className="text-3xl font-black text-gray-800">${fmt(cash || rounded)}</p>
                    </div>
                    <div className="text-center py-2">
                        <p className="text-xs text-gray-400 font-bold mb-1">找零</p>
                        <p className={`text-3xl font-black ${change > 0 ? 'text-red-500' : 'text-gray-800'}`}>${fmt(change)}</p>
                    </div>
                </div>

                <div className="border-t border-gray-100" />

                {/* 收取現金輸入區 */}
                <div className="px-5 pt-4 pb-3">
                    <p className="text-xs font-bold text-gray-400 mb-1.5">收取現金</p>
                    <div className="relative mb-3">
                        <input
                            type="number"
                            inputMode="numeric"
                            value={cashInput}
                            onChange={e => setCashInput(e.target.value)}
                            className="w-full text-right text-2xl font-black border-2 border-gray-200 focus:border-[#2FB8B8] rounded-xl px-4 py-2 pr-10 outline-none"
                        />
                        <button
                            onClick={() => setCashInput('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full bg-gray-200 hover:bg-gray-300 text-gray-500 font-black text-xs"
                        >✕</button>
                    </div>
                    {/* 快捷按鈕（累加，由大到小） */}
                    <div className="grid grid-cols-3 gap-2">
                        {QUICK_CASH.map(v => (
                            <button key={v}
                                onClick={() => setCashInput(prev => String((parseInt(prev, 10) || 0) + v))}
                                className="py-2.5 rounded-xl bg-gray-100 active:bg-gray-300 font-black text-gray-700 text-sm">
                                +{v}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="border-t border-gray-100" />

                <button
                    onClick={onConfirm}
                    className="w-full py-5 text-gray-700 font-black text-lg hover:bg-gray-50 transition-colors"
                >
                    {isPartial ? '確認' : isTakeout ? '回到外帶頁' : '回到桌況頁'}
                </button>
            </div>
        </div>
    );
};

const PartialCheckoutConfirmModal = ({ isOpen, items, onConfirm, onCancel }) => {
    const fmt = (n) => Math.round(n).toLocaleString('en-US');
    if (!isOpen || !items) return null;
    const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                {/* 頂部 */}
                <div className="flex flex-col items-center pt-8 pb-5 px-6">
                    <div className="w-16 h-16 rounded-full border-[3px] border-orange-500 flex items-center justify-center mb-3">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
                        </svg>
                    </div>
                    <h3 className="text-2xl font-black mb-1">確認分開結帳</h3>
                </div>

                <div className="border-t border-gray-100" />

                {/* 品項列表 */}
                <div className="px-6 py-4 max-h-52 overflow-y-auto space-y-3">
                    {items.map(item => (
                        <div key={item.internalId} className="flex justify-between items-center">
                            <div>
                                <span className="text-lg font-black text-gray-800">{item.name}</span>
                                {item.remarks?.length > 0 && (
                                    <span className="ml-2 text-xs text-amber-600 font-bold">{item.remarks.join('・')}</span>
                                )}
                            </div>
                            <div className="text-right ml-4 flex-shrink-0">
                                <span className="text-base text-gray-400 font-bold">×{item.quantity}　</span>
                                <span className="text-lg font-black">${fmt(item.price * item.quantity)}</span>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="border-t border-gray-100" />

                {/* 合計 */}
                <div className="flex justify-between items-center px-6 py-4">
                    <span className="text-base font-bold text-gray-400">合計</span>
                    <span className="text-3xl font-black">${fmt(total)}</span>
                </div>

                <div className="border-t border-gray-100" />

                {/* 按鈕 */}
                <div className="flex divide-x divide-gray-100">
                    <button onClick={onCancel} className="flex-1 py-5 text-gray-400 font-black text-lg hover:bg-gray-50 transition-colors">取消</button>
                    <button onClick={() => onConfirm(items)} className="flex-1 py-5 text-orange-500 font-black text-lg hover:bg-orange-50 transition-colors">確認結帳</button>
                </div>
            </div>
        </div>
    );
};

// --- 外帶顧客資訊元件 ---
const TakeoutCustomerInfo = ({ customerName, setCustomerName, customerPhone, setCustomerPhone, needsUtensils, setNeedsUtensils, pickupTime, setPickupTime, customerSuggestions, setCustomerSuggestions }) => {
    const phoneSearchTimeout = React.useRef(null);

    const pickupTimeStr = React.useMemo(() => {
        const d = new Date(pickupTime || Date.now() + 20 * 60000);
        return d.toTimeString().substring(0, 5);
    }, [pickupTime]);

    const handlePhoneChange = (val) => {
        setCustomerPhone(val);
        clearTimeout(phoneSearchTimeout.current);
        if (val.length >= 1) {
            phoneSearchTimeout.current = setTimeout(async () => {
                const results = await searchCustomer(val);
                setCustomerSuggestions(results);
            }, 300);
        } else {
            setCustomerSuggestions([]);
        }
    };

    const handleNameChange = (val) => {
        setCustomerName(val);
        clearTimeout(phoneSearchTimeout.current);
        if (val.length >= 1) {
            phoneSearchTimeout.current = setTimeout(async () => {
                const results = await searchCustomer(val);
                setCustomerSuggestions(results);
            }, 300);
        } else {
            setCustomerSuggestions([]);
        }
    };

    const handleSelectSuggestion = (c) => {
        const names = c.names || (c.name ? [c.name] : []);
        const phones = c.phones || (c.phone ? [c.phone] : []);
        setCustomerName(names[0] || '');
        setCustomerPhone(phones[0] || '');
        setCustomerSuggestions([]);
    };

    const handlePickupTimeInput = (e) => {
        const [h, m] = e.target.value.split(':').map(Number);
        if (isNaN(h) || isNaN(m)) return;
        const d = new Date();
        d.setHours(h, m, 0, 0);
        setPickupTime(d.getTime());
    };

    const addMinutes = (mins) => {
        setPickupTime(prev => (prev || Date.now() + 20 * 60000) + mins * 60000);
    };

    return (
        <div className="bg-white border-b border-gray-200 px-3 py-2 flex flex-col gap-2">
            {/* 姓名 + 電話 row */}
            <div className="flex gap-2 relative">
                <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-[10px] font-bold text-gray-500 mb-0.5">姓名</span>
                    <input
                        type="text"
                        value={customerName}
                        onChange={e => handleNameChange(e.target.value)}
                        placeholder="顧客姓名"
                        className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm font-bold outline-none focus:border-orange-400 w-full"
                    />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-[10px] font-bold text-gray-500 mb-0.5">電話</span>
                    <input
                        type="tel"
                        value={customerPhone}
                        onChange={e => handlePhoneChange(e.target.value)}
                        placeholder="輸入電話搜尋"
                        className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm font-bold outline-none focus:border-orange-400 w-full"
                    />
                    {customerSuggestions.length > 0 && (
                        <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-50 mt-0.5">
                            {customerSuggestions.map(c => (
                                <div
                                    key={c.id}
                                    onClick={() => handleSelectSuggestion(c)}
                                    className="px-3 py-2 hover:bg-orange-50 cursor-pointer text-sm font-bold border-b last:border-b-0"
                                >
                                    <span className="text-gray-800">{(c.names || [c.name]).filter(Boolean).join(' / ')}</span>
                                    <span className="text-gray-400 ml-2 text-xs">{(c.phones || [c.phone]).filter(Boolean).join(', ')}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* 餐具 + 取餐時間 row */}
            <div className="flex items-end gap-2">
                {/* 餐具 toggle */}
                <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-[10px] font-bold text-gray-500 mb-0.5">餐具</span>
                    <button
                        type="button"
                        onClick={() => setNeedsUtensils(v => !v)}
                        className={`flex items-center justify-center gap-1.5 px-2.5 h-9 rounded-lg border-2 font-bold text-sm transition-colors w-full
                            ${needsUtensils ? 'bg-orange-500 border-orange-500 text-white' : 'bg-white border-gray-300 text-gray-500'}`}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg>
                        <span>{needsUtensils ? '需要餐具' : '不需餐具'}</span>
                    </button>
                </div>

                {/* 取餐時間 */}
                <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-[10px] font-bold text-gray-500 mb-0.5">取餐時間</span>
                    <div className="flex items-center gap-1 h-9">
                        <input
                            type="time"
                            value={pickupTimeStr}
                            onChange={handlePickupTimeInput}
                            className="border border-gray-300 rounded-lg px-1.5 h-full text-sm font-bold outline-none focus:border-orange-400 flex-1 min-w-0"
                        />
                        <button onClick={() => addMinutes(5)} className="h-full px-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-bold text-gray-600 flex-shrink-0">+5</button>
                        <button onClick={() => addMinutes(10)} className="h-full px-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-bold text-gray-600 flex-shrink-0">+10</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─── 備註群組排序（依 DB sortOrder） ────────────────────────────────────────
const sortRemarkGroups = (groups) => {
    return [...groups].sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
};

// 根據 optionItemMap 過濾出該品項可看到的選項
const getVisibleOptions = (group, itemId) => {
    if (!group.optionItemMap) return group.options;
    return group.options.filter(opt => {
        const allowed = group.optionItemMap[opt];
        return !allowed || allowed.includes(itemId);
    });
};

// ─── 備註標籤元件（3個一行） ────────────────────────────────────────────────
const RemarkBadges = ({ remarks }) => {
    if (!remarks || remarks.length === 0) return null;
    return (
        <div className="grid mt-1" style={{ gridTemplateColumns: 'repeat(3,auto)', gap: '3px', justifyContent: 'start' }}>
            {remarks.map((r, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded-full font-bold leading-tight whitespace-nowrap">
                    {r}
                </span>
            ))}
        </div>
    );
};

// ─── 註記選擇 Modal（即時儲存，無確認按鈕，再點品項即關閉） ──────────────
const RemarkSelectionModal = ({ item, groups, initialRemarks, onToggle, onCancel }) => {
    const [selections, setSelections] = useState({});

    // 初始化：從現有備註還原選擇狀態
    useEffect(() => {
        if (!item) return;
        const init = {};
        const existing = initialRemarks || [];
        for (const g of groups) {
            if (g.type === 'multi') {
                init[g.id] = g.options.filter(opt => existing.includes(opt));
            } else {
                init[g.id] = g.options.find(opt => existing.includes(opt)) || '';
            }
        }
        setSelections(init);
    }, [item]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!item) return null;

    const sortedGroups = sortRemarkGroups(groups);

    // 計算目前 selections 對應的備註陣列
    const computeRemarks = (sels) => {
        const remarks = [];
        for (const g of sortedGroups) {
            const sel = sels[g.id];
            if (!sel) continue;
            if (Array.isArray(sel)) remarks.push(...sel);
            else if (sel) remarks.push(sel);
        }
        return remarks;
    };

    const handleSingle = (groupId, opt) => {
        const newSels = { ...selections, [groupId]: selections[groupId] === opt ? '' : opt };
        setSelections(newSels);
        onToggle(computeRemarks(newSels));
    };

    const handleMulti = (groupId, opt) => {
        const cur = selections[groupId] || [];
        const newCur = cur.includes(opt) ? cur.filter(x => x !== opt) : [...cur, opt];
        const newSels = { ...selections, [groupId]: newCur };
        setSelections(newSels);
        onToggle(computeRemarks(newSels));
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onCancel}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="p-4 border-b flex items-center justify-between flex-shrink-0">
                    <div>
                        <div className="text-xs text-gray-500 mb-0.5">備註設定・即時儲存・再點品項關閉</div>
                        <div className="font-black text-xl text-gray-800">{item.name}</div>
                    </div>
                    <button onClick={onCancel} className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="flex-grow overflow-y-auto p-5 space-y-6">
                    {sortedGroups.map(g => {
                        const visibleOptions = getVisibleOptions(g, item.id);
                        if (visibleOptions.length === 0) return null;
                        const sel = selections[g.id] || (g.type === 'multi' ? [] : '');
                        return (
                            <div key={g.id}>
                                <div className="flex items-center gap-2 mb-3">
                                    <span className="font-bold text-gray-800">{g.name}</span>
                                    {g.type === 'multi' && <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded-full font-bold">可多選</span>}
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    {visibleOptions.map(opt => {
                                        const active = g.type === 'multi' ? sel.includes(opt) : sel === opt;
                                        return (
                                            <button key={opt}
                                                onClick={() => g.type === 'multi' ? handleMulti(g.id, opt) : handleSingle(g.id, opt)}
                                                className={`px-3 py-2.5 rounded-xl text-base font-bold border-2 transition-all whitespace-nowrap ${
                                                    active ? 'bg-teal-500 text-white border-teal-500 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-teal-300'
                                                }`}
                                            >{opt}</button>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
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
    const isTakeout = location.state?.isTakeout || false;

    // 建立一個 State 來追蹤「已存檔」的桌號
    const [originalTableId, setOriginalTableId] = useState(initialTableNumber);

    useDynamicVh(); 

    const [state, dispatch] = useReducer(orderReducer, initialOrderState);
    const { currentOrder, menuItems } = state;

    // --- 狀態與 Hooks ---
    const [selectedCategory, setSelectedCategory] = useState('主餐');
    const [soldOutItem, setSoldOutItem] = useState(null); // 停售確認 modal
    const [depletedConfirmItem, setDepletedConfirmItem] = useState(null); // 售完確認 modal
    const [stockLimitWarning, setStockLimitWarning] = useState(null); // 即時庫存不足警告
    const [showResumeConfirm, setShowResumeConfirm] = useState(false); // 恢復供應確認 modal
    const [currentOrderId, setCurrentOrderId] = useState(initialOrderId);
    const [dailyOrderNo, setDailyOrderNo] = useState(null);
    const [orderStatus, setOrderStatus] = useState(location.state?.orderStatus || (initialOrderId ? 'open' : 'new')); 
    const [tableNumber, setTableNumber] = useState(isTakeout ? '外帶' : initialTableNumber);
    const [customerCount, setCustomerCount] = useState(
        isTakeout ? (location.state?.customerCount ?? 0) : (location.state?.customerCount || 1)
    );
    const [customerName, setCustomerName] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');
    const [needsUtensils, setNeedsUtensils] = useState(false);
    const [pickupTime, setPickupTime] = useState(() => Date.now() + 20 * 60000);
    const [customerSuggestions, setCustomerSuggestions] = useState([]);

    // 請在您的 const [customerCount, setCustomerCount] = useState(...) 下方加入：
    const [originalCustomerCount, setOriginalCustomerCount] = useState(
        isTakeout ? (location.state?.customerCount ?? 0) : (location.state?.customerCount || 1)
    );
    const [originalNeedsUtensils, setOriginalNeedsUtensils] = useState(false);
    const [originalPickupTime, setOriginalPickupTime] = useState(() => Date.now() + 20 * 60000);

    const [originalItems, setOriginalItems] = useState([]);

    const [isLoading, setIsLoading] = useState(false);
    const [isDirty, setIsDirty] = useState(false); // 標記訂單是否有變動
    const [openTimestamp, setOpenTimestamp] = useState(initialOpenTime);
    const [sendTime, setSendTime] = useState(location.state?.sendTime || null);
    const [finishTime, setFinishTime] = useState(location.state?.finishTime || null);
    const [currentTime, setCurrentTime] = useState(Date.now());
    const checkoutLockRef = useRef(false);
    const pendingDailyOrderNoRef = useRef(null); // 儲存剛建立訂單的 dailyOrderNo 供印單使用
    const [isQuantityModalOpen, setIsQuantityModalOpen] = useState(false);
    const [quantityTarget, setQuantityTarget] = useState(null); // 用於 QuantityPadModal

    const [isCheckoutOptionModalOpen, setIsCheckoutOptionModalOpen] = useState(false);
    const [checkoutResult, setCheckoutResult] = useState(null); // { total, isPartial, navigateTo }
    const [partialConfirmItems, setPartialConfirmItems] = useState(null); // 分開結帳確認 modal
    const [isPartialCheckoutMode, setIsPartialCheckoutMode] = useState(false);
    const [selectedItemsForCheckout, setSelectedItemsForCheckout] = useState([]); // 部分結帳時選中的項目 internalId

    // 註記相關
    const [remarkGroups, setRemarkGroups] = useState([]);
    const [pendingRemarkItem, setPendingRemarkItem] = useState(null); // { item, applicableGroups, editingInternalId? }
    const [isOrderMerged, setIsOrderMerged] = useState(true); // true=合併顯示（預設），false=全部展開逐列

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

    const hasSoldOut = useMemo(() => menuItems.some(i => i.soldOut), [menuItems]);

    // 庫存品項（for 即時庫存驗證，與 menuItems 分開存放）
    const [invItems, setInvItems] = useState([]);
    const [categorySettings, setCategorySettings] = useState(DEFAULT_CATEGORY_SETTINGS);

    // --- 資料載入邏輯 ---
    const loadMenuData = useCallback(async () => {
        try {
            const [items, rg, invs, catSettings] = await Promise.all([
                getMenuItems(),
                getRemarkGroups(),
                getInventoryItems(),
                getCategorySettings(),
            ]);
            // 依 name+category 去重（保留 sortOrder 最小的），防止 DB 重複品項干擾點餐頁
            const deduped = [];
            const seen = new Map();
            const sorted = [...items].sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));
            sorted.forEach(item => {
                const key = `${item.name}::${item.category}`;
                if (!seen.has(key)) { seen.set(key, true); deduped.push(item); }
            });
            dispatch({ type: ACTION_TYPE.SET_MENU, payload: deduped });
            setRemarkGroups(rg);
            setInvItems(invs);
            setCategorySettings(catSettings);
        } catch (e) { console.error(e); }
    }, []);

    // --- 停售 handlers ---
    const handleLongPressMenu = useCallback((item) => {
        setSoldOutItem(item);
    }, []);

    // --- 即時庫存輔助：計算本單已消耗各庫存項目的數量 ---
    const computeOrderConsumption = useCallback((order) => {
        const consumption = {};
        order.forEach(orderItem => {
            (orderItem.consumes || []).forEach(invId => {
                consumption[invId] = (consumption[invId] || 0) + orderItem.quantity;
            });
        });
        return consumption;
    }, []);

    // 回傳第一個超出庫存的資訊，或 null 代表可以加入
    const checkStockLimit = useCallback((item, deltaQty, order) => {
        const consumes = item.consumes || [];
        if (!consumes.length) return null;
        const invMap = {};
        invItems.forEach(m => { invMap[m.id] = m; });
        if (Object.keys(invMap).length === 0) return null; // 庫存資料尚未載入
        const consumption = computeOrderConsumption(order);
        for (const invId of consumes) {
            const invItem = invMap[invId];
            if (!invItem || invItem.stock == null) continue;
            const consumed = consumption[invId] || 0;
            const available = invItem.stock - consumed;
            if (available < deltaQty) {
                return { menuItemName: item.name, invItemName: invItem.name, dbStock: invItem.stock, consumed, available };
            }
        }
        return null;
    }, [invItems, computeOrderConsumption]);

    // --- 菜單點擊：直接加入購物車（不開備註彈窗）---
    const handleAddItemClick = useCallback((item) => {
        if (item.depleted) { setDepletedConfirmItem(item); return; }
        const limit = checkStockLimit(item, 1, currentOrder);
        if (limit) {
            setStockLimitWarning({ ...limit, action: 'addItem', payload: { item } });
            return;
        }
        dispatch({ type: ACTION_TYPE.ADD_ITEM, payload: { item, setIsDirty, menuItems, remarks: [] } });
    }, [menuItems, setIsDirty, currentOrder, checkStockLimit]);

    const handleConfirmDepletedOrder = useCallback(() => {
        if (!depletedConfirmItem) return;
        dispatch({ type: ACTION_TYPE.ADD_ITEM, payload: { item: depletedConfirmItem, setIsDirty, menuItems, remarks: [] } });
        setDepletedConfirmItem(null);
    }, [depletedConfirmItem, menuItems, setIsDirty]);

    const handleConfirmStockLimit = useCallback(() => {
        if (!stockLimitWarning) return;
        const { action, payload } = stockLimitWarning;
        if (action === 'addItem') {
            dispatch({ type: ACTION_TYPE.ADD_ITEM, payload: { item: payload.item, setIsDirty, menuItems, remarks: [] } });
        } else if (action === 'changeQty') {
            setIsDirty(true);
            dispatch({ type: ACTION_TYPE.CHANGE_QUANTITY, payload: { internalId: payload.internalId, newQty: payload.newQty, setFinishTime, setSendTime, setOrderStatus, currentOrderStatus: orderStatus, setIsDirty } });
        }
        setStockLimitWarning(null);
    }, [stockLimitWarning, menuItems, setIsDirty, orderStatus]);

    // --- 點擊購物車品項：開啟/關閉備註編輯（再點相同品項即關閉） ---
    const getApplicableRemarkGroups = useCallback((item) => {
        return remarkGroups.filter(g => g.appliesTo && g.appliesTo.includes(item.id));
    }, [remarkGroups]);

    const handleCartItemClick = useCallback((item) => {
        if (isPartialCheckoutMode) return; // 分帳模式下由 handleItemClick 處理
        // 再點同一品項 → 關閉彈窗
        if (pendingRemarkItem?.editingInternalId === item.internalId) {
            setPendingRemarkItem(null);
            return;
        }
        const applicable = getApplicableRemarkGroups(item);
        if (applicable.length === 0) return; // 無備註群組 → 不開彈窗
        setPendingRemarkItem({ item, applicableGroups: applicable, editingInternalId: item.internalId });
    }, [isPartialCheckoutMode, getApplicableRemarkGroups, pendingRemarkItem]);

    // --- 備註即時儲存（每次勾選即觸發）---
    const handleRemarkToggle = useCallback((remarks) => {
        if (!pendingRemarkItem) return;
        const { editingInternalId } = pendingRemarkItem;
        if (editingInternalId) {
            dispatch({ type: ACTION_TYPE.UPDATE_REMARKS, payload: { internalId: editingInternalId, remarks, setIsDirty } });
        }
    }, [pendingRemarkItem, setIsDirty]);

    const handleRemarkCancel = useCallback(() => setPendingRemarkItem(null), []);


    const handleConfirmSoldOut = useCallback(async () => {
        if (!soldOutItem) return;
        const newSoldOut = !soldOutItem.soldOut;
        await updateMenuItem(soldOutItem.id, { soldOut: newSoldOut });
        // 主餐 → 同步停售/恢復對應單點 (id + '1')
        if (soldOutItem.category === '主餐') {
            await updateMenuItem(soldOutItem.id + '1', { soldOut: newSoldOut });
        }
        // 單點 → 同步停售/恢復對應主餐 (移除結尾的 '1')
        if (soldOutItem.category === '單點' && soldOutItem.id.endsWith('1')) {
            await updateMenuItem(soldOutItem.id.slice(0, -1), { soldOut: newSoldOut });
        }
        setSoldOutItem(null);
        await loadMenuData();
    }, [soldOutItem, loadMenuData]);

    const handleResetAllSoldOut = useCallback(async () => {
        await resetAllSoldOut();
        await loadMenuData();
        setShowResumeConfirm(false);
    }, [loadMenuData]);

    const loadOpenOrder = useCallback(async (tableId) => {
        if (!tableId) return;
        try {
            const allActive = await getActiveOrders();
            const openOrder = initialOrderId
                ? allActive.find(o => o.id === initialOrderId)
                : (isTakeout ? null : allActive.find(o => o.table === tableId));
            if (openOrder) {
                const loadedItems = openOrder.items.map(item => ({
                    ...item,
                    isSent: !!item.isSent,
                    isServed: !!item.isServed,
                    isPaid: !!item.isPaid,
                    internalId: item.internalId || Math.random().toString(36).substr(2, 9),
                    sortOrder: item.sortOrder
                }));
                dispatch({ type: ACTION_TYPE.SET_ORDER_AND_RICE, payload: { newOrder: loadedItems } });
                setCurrentOrderId(openOrder.id);
                setOrderStatus(openOrder.status);
                setCustomerCount(isTakeout ? (openOrder.customerCount ?? 0) : (openOrder.customerCount || 1));
                if (openOrder.customerName) setCustomerName(openOrder.customerName);
                if (openOrder.customerPhone) setCustomerPhone(openOrder.customerPhone);
                if (openOrder.needsUtensils !== undefined) {
                    setNeedsUtensils(!!openOrder.needsUtensils);
                    setOriginalNeedsUtensils(!!openOrder.needsUtensils);
                }
                if (openOrder.pickupTime) {
                    setPickupTime(openOrder.pickupTime);
                    setOriginalPickupTime(openOrder.pickupTime);
                }

                setOriginalCustomerCount(isTakeout ? (openOrder.customerCount ?? 0) : (openOrder.customerCount || 1));

                setOriginalItems(loadedItems);

                setOpenTimestamp(new Date(openOrder.timestamp).getTime());
                setSendTime(openOrder.sendTime);
                setFinishTime(openOrder.finishTime);
                if (openOrder.dailyOrderNo) setDailyOrderNo(openOrder.dailyOrderNo);
            }
        } catch (e) { console.error(e); } finally { setIsLoading(false); }
    }, [initialOrderId]);

    useEffect(() => { loadMenuData().then(() => setIsLoading(false)); }, [loadMenuData]);

    useEffect(() => {
        // 根據桌號載入或清空訂單
        if (tableNumber && menuItems.length > 0) {
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

    const categories = useMemo(() => {
        if (categorySettings.length === 0) return CATEGORY_ORDER;
        return categorySettings
            .filter(c => isTakeout ? c.showInTakeout : c.showInDineIn)
            .map(c => c.name);
    }, [categorySettings, isTakeout]);

    // 當類別清單載入或變更時，確保 selectedCategory 在清單中
    useEffect(() => {
        if (categories.length > 0 && !categories.includes(selectedCategory)) {
            setSelectedCategory(categories[0]);
        }
    }, [categories]); // eslint-disable-line react-hooks/exhaustive-deps

    const filteredMenu = useMemo(() => {
        let items = menuItems.filter(i => i.category === selectedCategory);
        return [...items].sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));
    }, [menuItems, selectedCategory]);

    // --- 訂單操作邏輯 ---
    const saveOrderBeforeNavigate = useCallback(async (targetTable, orderItems, orderId, count, total, status, currentSendTime, currentFinishTime) => {
        const orderData = {
            orderId, table: targetTable, customerCount: count,
            customerName: customerName,
            customerPhone: customerPhone,
            needsUtensils: needsUtensils,
            pickupTime: pickupTime,
            // 🚨 重點：將帶有最新數量、isSent 註記、isPaid 狀態的 orderItems 列表傳入 DB 儲存
            items: orderItems.map(({ id, name, price, quantity, isSent, isServed, isPaid, category, internalId, sortOrder, remarks }) => ({ id, name, price, quantity, isSent: !!isSent, isServed: !!isServed, isPaid: !!isPaid, category, internalId, sortOrder, remarks: remarks || [] })),
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
                    newItems: orderData.items,
                    customerCount: count,
                    sendTime: currentSendTime,
                    finishTime: currentFinishTime,
                    customerName: customerName,
                    customerPhone: customerPhone,
                    needsUtensils: needsUtensils,
                    pickupTime: pickupTime,
                });
                if (finalStatus === 'paid') setOrderStatus('paid'); // 前端同步
                return orderId;
            } else if (orderItems.length > 0) {
                // 訂單不存在，創建新訂單
                const result = await createNewOrder({ ...orderData, status: finalStatus });
                if (result) {
                    setCurrentOrderId(result.id);
                    if (result.dailyOrderNo) {
                        setDailyOrderNo(result.dailyOrderNo);
                        pendingDailyOrderNoRef.current = result.dailyOrderNo;
                    }
                }
                return result ? result.id : false;
            } else {
                return true;
            }
        } catch (e) { 
            console.error("Save Order Failed:", e);
            return false; 
        }
    }, [openTimestamp, customerName, customerPhone, needsUtensils, pickupTime]);

    const handleGoBack = async () => {
        if (isLoading) return;
        
        const hasCountChanged = customerCount !== originalCustomerCount;
        const hasUtensilsChanged = isTakeout && needsUtensils !== originalNeedsUtensils;
        const hasPickupChanged = isTakeout && pickupTime !== originalPickupTime;

        if ((hasCountChanged || hasUtensilsChanged || hasPickupChanged) && currentOrderId) {
            setIsLoading(true);
            try {
                const itemsToSave = currentOrder.map(({ id, name, price, quantity, isSent, isPaid, category, internalId, sortOrder, remarks }) =>
                    ({ id, name, price, quantity, isSent: !!isSent, isPaid: !!isPaid, category, internalId, sortOrder, remarks: remarks || [] })
                );
                await updateOrderStatus({
                    orderId: currentOrderId,
                    newStatus: orderStatus,
                    newItems: itemsToSave,
                    customerCount: customerCount,
                    needsUtensils: isTakeout ? needsUtensils : undefined,
                    pickupTime: isTakeout ? pickupTime : undefined,
                    sendTime: sendTime,
                    finishTime: finishTime
                });
                setOriginalCustomerCount(customerCount);
                setOriginalNeedsUtensils(needsUtensils);
                setOriginalPickupTime(pickupTime);
                setOriginalItems(currentOrder);
            } catch (e) {
                console.error("自動儲存失敗:", e);
            } finally {
                setIsLoading(false);
            }
        }

        // 檢查變動類型：僅備註變動（排除 remarks 後內容相同）→ 自動儲存；有新增/刪除品項 → 跳通知
        const isContentChanged = JSON.stringify(currentOrder) !== JSON.stringify(originalItems);
        const stripRemarks = arr => JSON.stringify(arr.map(({ remarks, ...rest }) => rest));
        const isStructureChanged = stripRemarks(currentOrder) !== stripRemarks(originalItems);
        const isRemarksOnlyChanged = isContentChanged && !isStructureChanged;

        if (isRemarksOnlyChanged && currentOrderId) {
            setIsLoading(true);
            try {
                const itemsToSave = currentOrder.map(({ id, name, price, quantity, isSent, isPaid, category, internalId, sortOrder, remarks }) =>
                    ({ id, name, price, quantity, isSent: !!isSent, isPaid: !!isPaid, category, internalId, sortOrder, remarks: remarks || [] })
                );
                await updateOrderStatus({ orderId: currentOrderId, newStatus: orderStatus, newItems: itemsToSave, sendTime, finishTime });
                setOriginalItems(currentOrder);
                setIsDirty(false);
            } catch (e) {
                console.error("備註自動儲存失敗:", e);
            } finally {
                setIsLoading(false);
            }
        } else if (isDirty && isStructureChanged) {
            const confirmDiscard = window.confirm("您有未儲存的點餐變動！\n確定要返回嗎？");
            if (!confirmDiscard) return;
            setIsDirty(false);
        }
        
        // 其餘原本的佔桌邏輯...
        if (orderStatus === 'new' && currentOrder.length === 0 && tableNumber && tableNumber !== '外帶') {
            setIsLoading(true);
            await occupyTableWithoutOrder(tableNumber, openTimestamp);
            setIsLoading(false);
        }
        navigate(isTakeout ? '/takeout' : '/tables');
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
            navigate(isTakeout ? '/takeout' : '/tables');
        } catch (e) { alert("操作失敗"); } finally { setIsLoading(false); }
    };

const handleConfirmOrder = async () => {
        if (currentOrder.length === 0) return alert("請先點餐");
        if (unpaidItems.length === 0) return alert("目前沒有新的未結帳項目需要送出。");
        if ((orderStatus === 'served' || orderStatus === 'served-complete') && !isDirty)
            return alert("訂單已送出，且沒有新的變動需要儲存。");

        setIsLoading(true);
        try {
            const now = Date.now();
            const targetStatus = (orderStatus === 'paid' || orderStatus === 'new' || orderStatus === 'open') ? 'served' : orderStatus;
            const newSendTime = sendTime || now;
            const newFinishTime = null;

            // 確定要印的品項（尚未送廚房的）
            const catPrintMap = Object.fromEntries(categorySettings.map(c => [c.name, c.printOnKitchen !== false]));
            const newItems = currentOrder.filter(i => !i.isSent);
            const sentIds = newItems.map(i => i.internalId);
            const kitchenItems = newItems.filter(i => catPrintMap[i.category] !== false);
            const idSet = new Set(sentIds);

            // 將新品項標記為 isSent:true，直接存進 DB（避免 race condition）
            const orderWithSent = currentOrder.map(i =>
                idSet.has(i.internalId) ? { ...i, isSent: true } : i
            );

            // 儲存訂單（含 isSent:true，同時設定 pendingDailyOrderNoRef）
            const orderId = await saveOrderBeforeNavigate(
                tableNumber, orderWithSent, currentOrderId,
                customerCount, subTotal, targetStatus, newSendTime, newFinishTime
            );

            if (orderId) {
                // 外帶：自動儲存顧客資料
                if (isTakeout && (customerPhone || customerName)) {
                    const cid = await autoSaveCustomer(customerName, customerPhone);
                    if (cid) await updateOrderStatus({ orderId: currentOrderId || orderId, newStatus: targetStatus, customerId: cid });
                }

                setOrderStatus(targetStatus);
                setSendTime(newSendTime);
                setFinishTime(newFinishTime);
                setOriginalCustomerCount(customerCount);

                // 立即更新本地 reducer 狀態
                if (sentIds.length > 0) {
                    dispatch({ type: ACTION_TYPE.MARK_ITEMS_SENT, payload: { internalIds: sentIds } });
                }
                setOriginalItems(orderWithSent);
                setIsDirty(false);

                // 廚房聯：fire-and-forget，isSent 已正確存入 DB
                if (kitchenItems.length > 0) {
                    const orderNo = pendingDailyOrderNoRef.current || dailyOrderNo || orderId;
                    pendingDailyOrderNoRef.current = null;
                    fetch('/print', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            printMode: 'kitchen',
                            table: tableNumber || '外帶',
                            orderNo,
                            total: subTotal,
                            items: kitchenItems.map(i => ({
                                id: i.id,
                                name: i.name,
                                printName: i.printName || null,
                                category: i.category || null,
                                sortOrder: i.sortOrder != null ? i.sortOrder : null,
                                price: i.price || 0,
                                qty: i.quantity,
                                remarks: i.remarks || [],
                            })),
                            customerName: customerName || null,
                            customerPhone: customerPhone || null,
                            pickupTime: pickupTime || null,
                            needsUtensils: needsUtensils,
                        }),
                    }).catch(e => console.warn('列印失敗：', e));
                }
                // 停留在原頁面（不 navigate）
            }
        } catch (e) {
            alert("儲存失敗");
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePreCheckout = () => {
        setIsCheckoutOptionModalOpen(true);
    };

    const buildPrintBaseData = () => ({
        table: tableNumber || '外帶',
        orderNo: pendingDailyOrderNoRef.current || dailyOrderNo || currentOrderId || 0,
        total: subTotal,
        items: currentOrder.map(i => ({
            id: i.id,
            name: i.name,
            printName: i.printName || null,
            category: i.category || null,
            sortOrder: i.sortOrder != null ? i.sortOrder : null,
            price: i.price || 0,
            qty: i.quantity,
            remarks: i.remarks || [],
        })),
        ...(isTakeout && {
            customerName:  customerName  || null,
            customerPhone: customerPhone || null,
            pickupTime:    pickupTime    || null,
            needsUtensils: needsUtensils,
        }),
    });

    const handlePrintKitchen = () => {
        setIsCheckoutOptionModalOpen(false);
        fetch(`${BACKEND_URL}/print`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...buildPrintBaseData(), printMode: 'kitchen', kitchenCopies: 1 }),
        }).catch(e => console.warn(`印廚房單失敗：${e.message}`));
    };

    const handlePrintCustomer = () => {
        setIsCheckoutOptionModalOpen(false);
        fetch(`${BACKEND_URL}/print`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...buildPrintBaseData(), printMode: 'customer' }),
        }).catch(e => console.warn(`印顧客單失敗：${e.message}`));
    };

    const executeCheckout = async (itemsToCheckout, isPartial = false) => {
        if (checkoutLockRef.current) return;
        checkoutLockRef.current = true;
        setIsLoading(true);
        setIsPartialCheckoutMode(false);
        setSelectedItemsForCheckout([]);
        setOriginalCustomerCount(customerCount);
        setOriginalItems(currentOrder);

        try {
            const now = Date.now();
            const totalToPay = itemsToCheckout.reduce((sum, item) => sum + item.price * item.quantity, 0);
            
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
            
            // 4. 列印（fire-and-forget，不阻塞結帳流程）
            const effectiveOrderNo = pendingDailyOrderNoRef.current || dailyOrderNo || currentOrderId || orderId;
            pendingDailyOrderNoRef.current = null;
            const checkoutTotal = itemsToCheckout.reduce((s, i) => s + i.price * i.quantity, 0);
            const takeoutExtra = isTakeout ? {
                customerName:  customerName  || null,
                customerPhone: customerPhone || null,
                pickupTime:    pickupTime    || null,
                needsUtensils: needsUtensils,
            } : {};
            const toLine = (i) => ({
                id: i.id, name: i.name,
                printName: i.printName || null,
                category: i.category || null,
                sortOrder: i.sortOrder != null ? i.sortOrder : null,
                price: i.price || 0, qty: i.quantity,
                remarks: i.remarks || [],
            });

            // 顧客聯先送（確保排在 CUPS 佇列第一，立即出紙），廚房單後送
            fetch('/print', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    printMode: 'customer',
                    openDrawer: true,
                    table: tableNumber || '外帶',
                    orderNo: effectiveOrderNo,
                    total: checkoutTotal,
                    items: itemsToCheckout.map(toLine),
                    ...takeoutExtra,
                }),
            }).catch(e => console.warn('顧客聯列印失敗：', e));

            // 廚房單後送（若有尚未送出廚房的品項，且類別允許廚房出單）
            const catPrintMapCheckout = Object.fromEntries(categorySettings.map(c => [c.name, c.printOnKitchen !== false]));
            const unsentItems = itemsToCheckout.filter(i => !i.isSent && catPrintMapCheckout[i.category] !== false);
            if (unsentItems.length > 0) {
                fetch('/print', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        printMode: 'kitchen',
                        kitchenCopies: isPartial ? 1 : 2,
                        table: tableNumber || '外帶',
                        orderNo: effectiveOrderNo,
                        total: checkoutTotal,
                        items: unsentItems.map(toLine),
                        ...takeoutExtra,
                    }),
                }).catch(e => console.warn('廚房單列印失敗：', e));
            }

            // 6. 【前端狀態更新】只有在 DB 操作 100% 成功後，才 dispatch 到 Reducer
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

            // 外帶訂單：自動儲存顧客資料
            if (isTakeout && (customerPhone || customerName)) {
                const cid = await autoSaveCustomer(customerName, customerPhone);
                if (cid) {
                    await updateOrderStatus({ orderId: currentOrderId || orderId, newStatus: finalStatus, customerId: cid });
                }
            }

            if (finalStatus === 'paid') {
                setOrderStatus('paid');
            } else {
                setOrderStatus('served');
            }

            setIsDirty(false);

            // 顯示結帳成功 modal，等使用者確認後才導航
            setCheckoutResult({
                total: totalToPay,
                isPartial,
                navigateTo: finalStatus === 'paid' ? (isTakeout ? '/takeout' : '/tables') : null,
            });

        } catch (e) {
            alert("結帳操作失敗: " + e.message);
        } finally {
            checkoutLockRef.current = false;
            setIsLoading(false);
        }
    };    
    
    const handleCheckoutResultConfirm = () => {
        const navigateTo = checkoutResult?.navigateTo;
        setCheckoutResult(null);
        if (navigateTo) navigate(navigateTo, { replace: true });
    };

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

    const handleExecutePartialCheckout = () => {
        const selectedItems = currentOrder.filter(item => selectedItemsForCheckout.includes(item.internalId));
        if (selectedItems.length === 0) {
            alert("請選擇要結帳的項目。");
            return;
        }
        setPartialConfirmItems(selectedItems);
    };

    const handlePartialConfirm = async (items) => {
        setPartialConfirmItems(null);
        await executeCheckout(items, true);
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

        // 增加數量時進行庫存檢查
        if (diff > 0) {
            // 暫時以不含此行的訂單計算消耗（排除自身），再加上 newQty
            const orderWithout = currentOrder.map(i =>
                i.internalId === internalId ? { ...i, quantity: 0 } : i
            );
            const limit = checkStockLimit({ ...currentItem }, newQty, orderWithout);
            if (limit) {
                setStockLimitWarning({ ...limit, action: 'changeQty', payload: { internalId, newQty } });
                return;
            }
        }

        setIsDirty(true);
        dispatch({
            type: ACTION_TYPE.CHANGE_QUANTITY,
            payload: { internalId, newQty, setFinishTime, setSendTime, setOrderStatus, currentOrderStatus: orderStatus, setIsDirty }
        });
    };
    // --- 輔助邏輯 (保持不變) ---
const handleTableChange = async (event) => {
    const newTable = event.target.value;
    
    // 1. 基本檢查：如果選到目前的桌號，或是空值，則不處理
    if (newTable === tableNumber || !newTable) return;

    const oldTable = tableNumber;

    try {
        setIsLoading(true);

        // 2. 獲取最新資料庫桌況，檢查目標桌是否已被佔用
        const dbTableRecords = await getTableStatuses();
        const targetRecord = dbTableRecords.find(r => r.tableNumber === newTable);
        
        // 只要不是 idle，都視為需要確認的狀態 (包含 open, served, paid)
        const isTargetOccupied = targetRecord && targetRecord.status !== 'idle';

        if (isTargetOccupied) {
            const confirmOverwrite = window.confirm(
                `⚠️ 注意：${newTable} 目前狀態為 [${targetRecord.status}]。\n確定要將 ${oldTable} 的內容移過去並覆蓋嗎？`
            );
            
            if (!confirmOverwrite) {
                // 使用者取消：將下拉選單還原回舊桌號，並結束函式
                event.target.value = oldTable;
                setIsLoading(false);
                return;
            }
        }

        // 3. 準備轉移與寫入新桌
        let savedId = null;
        const statusToSave = orderStatus || 'served';

        if (currentOrder && currentOrder.length > 0) {
            // 情境 A：已有餐點內容 (Served / Paid / Submitted)
            // 💡 關鍵：傳入目前的 currentOrderId 確保是同一筆訂單轉移，而非建立新單
            savedId = await saveOrderBeforeNavigate(
                newTable, 
                currentOrder, 
                currentOrderId, 
                customerCount, 
                subTotal, 
                statusToSave, 
                sendTime, 
                finishTime
            );
            
            if (!savedId) throw new Error("寫入新桌位失敗，請檢查網路連線");

        } else {
            // 情境 B：純佔桌 (Open 狀態，尚無點餐內容)
            const occupySuccess = await occupyTableWithoutOrder(newTable, openTimestamp);
            if (!occupySuccess) throw new Error("佔用新桌失敗");
            savedId = "occupy_success"; 
        }

        // 4. 🚀 重要安全邏輯：確認新桌寫入成功後，才清除舊桌位狀態
        if (savedId && oldTable && oldTable !== '外帶') {
            await resetTableStatus(oldTable);
        }

        // 5. 更新前端 UI 狀態
        setTableNumber(newTable);          // 更新畫面上顯示的桌號
        setOriginalTableId(newTable);      // 更新存檔基準桌號
        setIsDirty(false);                 // 重置「未存檔」標記
        
        // 如果是從 Open 狀態轉移且無餐點，確保狀態同步為 open
        if (!currentOrder || currentOrder.length === 0) {
            setOrderStatus('open');
        }

        console.log(`✅ 換桌成功：從 ${oldTable} 轉至 ${newTable}`);

    } catch (e) {
        console.error("切換桌號失敗:", e);
        alert(`換桌操作失敗: ${e.message}`);
        // 發生錯誤時，將下拉選單還原
        event.target.value = oldTable; 
    } finally {
        setIsLoading(false);
    }
};

    const handleChangeCustomerCount = (diff) => {
        const newCount = Math.max(isTakeout ? 0 : 1, customerCount + diff);
        setCustomerCount(newCount);
    };

    const handleQuantitySave = (newQty) => {
        if (quantityTarget.type === 'item') {
            const currentItem = currentOrder.find(i => i.internalId === quantityTarget.internalId);
            if (currentItem && newQty > currentItem.quantity) {
                const orderWithout = currentOrder.map(i =>
                    i.internalId === quantityTarget.internalId ? { ...i, quantity: 0 } : i
                );
                const limit = checkStockLimit({ ...currentItem }, newQty, orderWithout);
                if (limit) {
                    setStockLimitWarning({ ...limit, action: 'changeQty', payload: { internalId: quantityTarget.internalId, newQty } });
                    setQuantityTarget(null);
                    return;
                }
            }
            dispatch({
                type: ACTION_TYPE.CHANGE_QUANTITY,
                payload: { internalId: quantityTarget.internalId, newQty, setFinishTime, setSendTime, setOrderStatus, currentOrderStatus: orderStatus, setIsDirty }
            });
        } else if (quantityTarget.type === 'customer') {
            setCustomerCount(Math.max(isTakeout ? 0 : 1, newQty));
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

    // 點擊 isSent 圖示，切換送出註記並存 DB
    // handleToggleItemSent 已移除 UI 觸發，isSent 由系統自動管理（廚房單印出時設定）

    const handleToggleItemServed = useCallback(async (item) => {
        if (isLoading || !currentOrderId) return;
        const newIsServed = !item.isServed;
        dispatch({ type: ACTION_TYPE.TOGGLE_ITEM_SERVED, payload: { internalId: item.internalId } });
        setOriginalItems(prev => prev.map(i =>
            i.internalId === item.internalId ? { ...i, isServed: newIsServed } : i
        ));
        try {
            const updatedItems = currentOrder.map(i =>
                i.internalId === item.internalId ? { ...i, isServed: newIsServed } : i
            ).map(({ id, name, price, quantity, isSent, isServed, isPaid, category, internalId, sortOrder, remarks }) =>
                ({ id, name, price, quantity, isSent: !!isSent, isServed: !!isServed, isPaid: !!isPaid, category, internalId, sortOrder, remarks: remarks || [] })
            );
            await updateOrderStatus({ orderId: currentOrderId, newStatus: orderStatus, newItems: updatedItems });
        } catch (e) {
            console.error('更新 isServed 失敗：', e);
        }
    }, [isLoading, currentOrderId, currentOrder, orderStatus, dispatch]);

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
                                
                                {isTakeout ? (
                                    <span className="text-white font-black text-xl px-1.5">外帶</span>
                                ) : (
                                    <select
                                        value={tableNumber}
                                        onChange={handleTableChange}
                                        className="bg-transparent text-white font-black text-xl appearance-none cursor-pointer border-none p-1.5 0 focus:outline-none w-auto"
                                    >
                                        {TABLE_OPTIONS.map(opt => <option key={opt} value={opt} className="bg-red-600">{opt || ''}</option>)}
                                    </select>
                                )}
                                
                                <div className="flex items-center space-x-1 bg-white/20 p-0.5 rounded-full">
                                    <div className="text-xs font-bold bg-white text-red-600 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                        {tableNumber === '外帶' ? '外帶' : '內用'}
                                    </div>

                                    {tableNumber !== '' && (
                                        <div className="flex items-center text-xs font-black space-x-1.5">
                                            <button
                                                onClick={() => handleChangeCustomerCount(-1)}
                                                className="w-5 h-5 bg-white/10 text-white rounded-full transition-colors hover:bg-white/30 flex items-center justify-center text-sm leading-none"
                                                disabled={customerCount <= (isTakeout ? 0 : 1)}
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
                                    <span className="text-base">{dailyOrderNo ? String(dailyOrderNo).padStart(3, '0') : formatOrderId(currentOrderId)}</span>
                                </div>
                                <div className="text-right pr-1">
                                    <span>商品總數 {totalItems}</span>
                                </div>
                            </div>
                        </div>

                        {/* 外帶顧客資訊區塊 */}
                        {isTakeout && (
                            <TakeoutCustomerInfo
                                customerName={customerName}
                                setCustomerName={setCustomerName}
                                customerPhone={customerPhone}
                                setCustomerPhone={setCustomerPhone}
                                needsUtensils={needsUtensils}
                                setNeedsUtensils={setNeedsUtensils}
                                pickupTime={pickupTime}
                                setPickupTime={setPickupTime}
                                customerSuggestions={customerSuggestions}
                                setCustomerSuggestions={setCustomerSuggestions}
                            />
                        )}
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
                                {/* 未結帳清單 */}
                                {unpaidItems.length > 0 && (() => {
                                    // 合併鍵：id + 排序後的備註，相同則合併數量
                                    const remarkKey = (item) =>
                                        JSON.stringify((item.remarks || []).slice().sort());
                                    const mergeKey = (item) => `${item.id}:::${remarkKey(item)}`;

                                    // 新點的在上、先點的在下：反轉後處理
                                    const reversedUnpaid = [...unpaidItems].reverse();
                                    let displayRows;
                                    if (isOrderMerged) {
                                        const map = new Map();
                                        const order = [];
                                        for (const item of reversedUnpaid) {
                                            const k = mergeKey(item);
                                            if (map.has(k)) {
                                                map.get(k).quantity += item.quantity;
                                            } else {
                                                const clone = { ...item };
                                                map.set(k, clone);
                                                order.push(clone);
                                            }
                                        }
                                        displayRows = order;
                                    } else {
                                        displayRows = reversedUnpaid;
                                    }

                                    return (
                                        <div className="mb-3">
                                            {/* 標題列 + 合併/展開切換 */}
                                            <div className="text-xs font-black text-red-600 mb-1 flex items-center justify-between border-b pb-0.5 px-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="w-2 h-2 rounded-full bg-red-600 flex-shrink-0" />
                                                    未結帳
                                                    {isPartialCheckoutMode && <span className="text-xs font-normal text-gray-500">(點擊選取結帳)</span>}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => setIsOrderMerged(v => !v)}
                                                        className="text-[11px] font-bold text-gray-400 hover:text-gray-700 border border-gray-200 rounded px-1.5 py-0.5"
                                                    >
                                                        {isOrderMerged ? '展開' : '合併'}
                                                    </button>
                                                    <span className="text-base font-black pr-1">${formatCurrency(unpaidTotal)}</span>
                                                </div>
                                            </div>

                                            {/* 品項列表 */}
                                            {displayRows.map(item => {
                                                const hasItemRemarks = item.remarks && item.remarks.length > 0;
                                                const hasApplicableGroups = remarkGroups.some(g => g.appliesTo && g.appliesTo.includes(item.id));
                                                const isEditingThis = pendingRemarkItem?.editingInternalId === item.internalId;
                                                return (
                                                    <div
                                                        key={item.internalId}
                                                        className={`flex items-start justify-between p-2 border rounded-xl mb-0.5 bg-white shadow-sm transition-colors
                                                            ${isPartialCheckoutMode
                                                                ? (selectedItemsForCheckout.includes(item.internalId) ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-500 cursor-pointer' : 'hover:bg-gray-100 cursor-pointer')
                                                                : (hasApplicableGroups ? `cursor-pointer ${isEditingThis ? 'border-teal-400 bg-teal-50 ring-2 ring-teal-400' : 'hover:bg-amber-50 hover:border-amber-200'}` : '')
                                                            }`}
                                                        onClick={isPartialCheckoutMode
                                                            ? () => handleItemClick(item)
                                                            : (hasApplicableGroups ? () => handleCartItemClick(item) : undefined)
                                                        }
                                                    >
                                                        {/* 1. 出餐圓圈（手動記錄是否已出餐給客人） */}
                                                        <div
                                                            className="w-5 h-5 mr-2 mt-0.5 flex-shrink-0 flex items-center justify-center cursor-pointer"
                                                            onClick={(e) => { e.stopPropagation(); if (!isPartialCheckoutMode) handleToggleItemServed(item); }}
                                                        >
                                                            {isPartialCheckoutMode ? (
                                                                selectedItemsForCheckout.includes(item.internalId)
                                                                    ? <svg className="w-full h-full text-orange-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                                                                    : <div className="w-full h-full rounded-full border-2 border-gray-400" />
                                                            ) : (
                                                                item.isServed
                                                                    ? <svg className="w-full h-full text-green-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                                                                    : <div className="w-full h-full rounded-full border-2 border-gray-400" />
                                                            )}
                                                        </div>

                                                        {/* 2. 名稱 + 備註 */}
                                                        <div className="flex flex-col flex-grow min-w-0">
                                                            <div className="flex items-center gap-1">
                                                                {item.category === '主餐' && item.sortOrder && (
                                                                    <div className="flex-shrink-0 flex items-center justify-center w-5 h-5 bg-black rounded-md">
                                                                        <span className="text-white font-bold text-[10px] leading-none">{item.sortOrder}</span>
                                                                    </div>
                                                                )}
                                                                <span className="font-bold text-2xl whitespace-nowrap">{item.name}</span>
                                                                {hasApplicableGroups && !isPartialCheckoutMode && (
                                                                    <svg className={`w-3 h-3 flex-shrink-0 ${isEditingThis ? 'text-teal-500' : hasItemRemarks ? 'text-amber-500' : 'text-gray-300'}`} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>
                                                                )}
                                                            </div>
                                                            <RemarkBadges remarks={item.remarks} />
                                                        </div>

                                                        {/* 3. 數量控制 */}
                                                        <div className="flex flex-col items-end space-y-1 ml-1">
                                                            <div className="flex items-center space-x-1.5">
                                                                <button onClick={(e) => { e.stopPropagation(); handleChangeItemQuantity(item.internalId, -1); }}
                                                                    className="w-6 h-6 bg-black/5 text-gray-700 rounded-full hover:bg-gray-300 flex items-center justify-center text-sm font-bold shadow-sm"
                                                                    disabled={isLoading || isPartialCheckoutMode}>-</button>
                                                                <span onClick={(e) => { e.stopPropagation(); handleOpenItemQuantityModal(item); }}
                                                                    className={`text-xl font-black text-gray-800 px-0.5 ${!isPartialCheckoutMode ? 'cursor-pointer' : ''}`}>
                                                                    {item.quantity}
                                                                </span>
                                                                <button onClick={(e) => { e.stopPropagation(); handleChangeItemQuantity(item.internalId, 1); }}
                                                                    className="w-6 h-6 bg-black/5 text-gray-700 rounded-full hover:bg-gray-300 flex items-center justify-center text-sm font-bold shadow-sm"
                                                                    disabled={isLoading || isPartialCheckoutMode}>+</button>
                                                            </div>
                                                            <span className="text-xs font-black text-gray-800 pr-1">${formatCurrency(item.price * item.quantity)}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })()}

                                {/* 已結帳分組 */}
                                {paidItems.length > 0 && (
                                    <div className="mb-3 opacity-80">
                                        <div className="text-xs font-black text-green-600 mb-1 flex items-center justify-between border-b pb-0.5 px-1">
                                            <div className='flex items-center'>
                                                <span className="w-2 h-2 rounded-full mr-2 bg-green-600" />
                                                已結帳
                                            </div>
                                            <span className="text-base font-black pr-2">${formatCurrency(paidTotal)}</span>
                                        </div>
                                        {paidItems.map(item => {
                                            const hasApplicableGroups = remarkGroups.some(g => g.appliesTo && g.appliesTo.includes(item.id));
                                            const isEditingThis = pendingRemarkItem?.editingInternalId === item.internalId;
                                            const hasItemRemarks = item.remarks && item.remarks.length > 0;
                                            return (
                                            <div
                                                key={item.internalId}
                                                className={`flex items-start justify-between p-2 border border-green-200 rounded-xl mb-1 bg-white shadow-sm transition-colors
                                                    ${hasApplicableGroups ? `cursor-pointer ${isEditingThis ? 'border-teal-400 bg-teal-50 ring-2 ring-teal-400' : 'hover:bg-amber-50 hover:border-amber-200'}` : ''}`}
                                                onClick={hasApplicableGroups ? () => handleCartItemClick(item) : undefined}
                                            >
                                                <div
                                                    className="w-5 h-5 mr-2 mt-0.5 flex-shrink-0 flex items-center justify-center cursor-pointer"
                                                    onClick={(e) => { e.stopPropagation(); handleToggleItemServed(item); }}
                                                >
                                                    {item.isServed
                                                        ? <svg className="w-full h-full text-green-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                                                        : <div className="w-full h-full rounded-full border-2 border-gray-400" />
                                                    }
                                                </div>
                                                <div className="flex flex-col flex-grow min-w-0">
                                                    <div className="flex items-center gap-1">
                                                        {item.category === '主餐' && item.sortOrder && (
                                                            <div className="flex-shrink-0 flex items-center justify-center w-5 h-5 bg-black rounded-md">
                                                                <span className="text-white font-bold text-[10px] leading-none">{Number(item.sortOrder)}</span>
                                                            </div>
                                                        )}
                                                        <span className="font-bold text-2xl whitespace-nowrap">{item.name}</span>
                                                        {hasApplicableGroups && (
                                                            <svg className={`w-3 h-3 flex-shrink-0 ${isEditingThis ? 'text-teal-500' : hasItemRemarks ? 'text-amber-500' : 'text-gray-300'}`} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>
                                                        )}
                                                    </div>
                                                    <RemarkBadges remarks={item.remarks} />
                                                </div>
                                                <div className="flex flex-col items-end space-y-1 ml-1">
                                                    <span className="text-xl font-black text-gray-800 pr-1">{item.quantity}</span>
                                                    <span className="text-xs font-black text-gray-800 pr-1">${formatCurrency(item.price * item.quantity)}</span>
                                                </div>
                                            </div>
                                            );
                                        })}
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
                                            disabled={isLoading || currentOrder.length === 0}
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
                    <div className="flex items-center mb-3 flex-shrink-0 gap-2">
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
                        {/* 一鍵恢復供應 */}
                        <button
                            onClick={() => setShowResumeConfirm(true)}
                            disabled={!hasSoldOut}
                            className={`flex-shrink-0 px-4 py-2.5 rounded-xl font-bold text-sm transition-colors whitespace-nowrap
                                ${hasSoldOut
                                    ? 'bg-orange-100 text-orange-600 hover:bg-orange-200 active:bg-orange-300'
                                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                }`}
                            title="恢復所有停售品項"
                        >
                            恢復供應
                        </button>
                    </div>
                    
                    {/* 菜單內容區塊 (滾動區) */}
                    <div className="flex-grow overflow-y-auto">
                        {/* 移除左右 padding (px-0)，並確保寬度為 full */}
                        <div className="w-full px-0 py-2"> 
                            {/* 設定 gap-3 並確保 grid 撐滿全寬 */}
                            <div className="grid grid-cols-5 gap-2 w-full">
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
                    onAddItem={handleAddItemClick}
                    onLongPress={handleLongPressMenu}
                />
            ];
        }

        // 一般情況：正常渲染
        return (
            <MenuCard
                key={item.id}
                item={item}
                onAddItem={handleAddItemClick}
                onLongPress={handleLongPressMenu}
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
                currentValue={quantityTarget?.currentValue ?? (quantityTarget?.type === 'customer' && isTakeout ? 0 : 1)}
                onSave={handleQuantitySave}
                title={quantityTarget?.type === 'customer' ? '設定用餐人數' : '設定餐點數量'}
                isItem={quantityTarget?.type === 'item'}
                allowZero={quantityTarget?.type === 'customer' && isTakeout}
            />
            
            <CheckoutOptionModal
                isOpen={isCheckoutOptionModalOpen}
                onClose={() => setIsCheckoutOptionModalOpen(false)}
                onFullCheckout={handleFullCheckout}
                onStartPartialCheckout={handleStartPartialCheckout}
                onPrintKitchen={handlePrintKitchen}
                onPrintCustomer={handlePrintCustomer}
                isAllPaid={unpaidItems.length === 0}
            />


            <PartialCheckoutConfirmModal
                isOpen={!!partialConfirmItems}
                items={partialConfirmItems}
                onConfirm={handlePartialConfirm}
                onCancel={() => setPartialConfirmItems(null)}
            />

            {/* 停售確認 Modal */}
            <SoldOutModal
                item={soldOutItem}
                onConfirm={handleConfirmSoldOut}
                onCancel={() => setSoldOutItem(null)}
            />

            {/* 售完確認 Modal */}
            <DepletedConfirmModal
                item={depletedConfirmItem}
                onConfirm={handleConfirmDepletedOrder}
                onCancel={() => setDepletedConfirmItem(null)}
            />

            {/* 即時庫存不足 Modal */}
            <StockLimitModal
                warning={stockLimitWarning}
                onConfirm={handleConfirmStockLimit}
                onCancel={() => setStockLimitWarning(null)}
            />

            <CheckoutSuccessModal
                isOpen={!!checkoutResult}
                total={checkoutResult?.total || 0}
                isPartial={checkoutResult?.isPartial || false}
                isTakeout={isTakeout}
                onConfirm={handleCheckoutResultConfirm}
            />

            {/* 恢復供應確認 Modal */}
            {showResumeConfirm && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
                    <div className="bg-white p-6 rounded-2xl shadow-2xl w-80">
                        <h3 className="text-xl font-black mb-2 border-b pb-2">恢復供應確認</h3>
                        <p className="text-gray-700 mb-5">確定要將所有停售品項恢復為正常販售？</p>
                        <div className="flex gap-3">
                            <button
                                onClick={handleResetAllSoldOut}
                                className="flex-1 py-3 rounded-xl font-black text-white bg-green-500 hover:bg-green-600 transition-colors"
                            >
                                確認恢復
                            </button>
                            <button
                                onClick={() => setShowResumeConfirm(false)}
                                className="flex-1 py-3 rounded-xl font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                            >
                                取消
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 備註選擇 Modal */}
            <RemarkSelectionModal
                item={pendingRemarkItem?.item || null}
                groups={pendingRemarkItem?.applicableGroups || []}
                initialRemarks={pendingRemarkItem?.item?.remarks || []}
                onToggle={handleRemarkToggle}
                onCancel={handleRemarkCancel}
            />

            {/* Loading 覆蓋層 */}
            {isLoading && <div className="fixed inset-0 bg-black/20 z-[60] flex items-center justify-center"><div className="bg-white p-4 rounded-lg animate-pulse font-bold">處理中...</div></div>}
        </div>
    );
};

export default OrderPage;