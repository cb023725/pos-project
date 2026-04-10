// src/pages/TableManagement.js (修正換桌邏輯版本)

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    getActiveOrders,
    updateOrderStatus,
    resetTableStatus,
    getTableStatuses,
} from '../db';

import TableCard from '../components/TableCard';

const TABLE_OPTIONS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'];

const ClearTableModal = ({ target, onConfirm, onCancel }) => {
    if (!target) return null;
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                <div className="flex flex-col items-center pt-8 pb-5 px-6">
                    <div className="w-20 h-20 rounded-full bg-gray-100 border-[3px] border-gray-300 flex items-center justify-center mb-5">
                        <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                            <polyline points="16 17 21 12 16 7"/>
                            <line x1="21" y1="12" x2="9" y2="12"/>
                        </svg>
                    </div>
                    <h3 className="text-2xl font-black text-gray-800 mb-2">清桌確認</h3>
                    <p className="text-base text-gray-500 text-center leading-relaxed font-medium">
                        <span className="font-black text-gray-700">{target.label}</span> 尚未點餐，<br />確定清除佔位嗎？
                    </p>
                </div>
                <div className="border-t border-gray-100" />
                <div className="flex divide-x divide-gray-100">
                    <button onClick={onCancel} className="flex-1 py-5 text-gray-400 font-black text-xl hover:bg-gray-50 transition-colors">取消</button>
                    <button onClick={onConfirm} className="flex-1 py-5 text-gray-600 font-black text-xl hover:bg-gray-100 transition-colors">確認清桌</button>
                </div>
            </div>
        </div>
    );
};

const AbandonOrderModal = ({ target, onConfirm, onCancel }) => {
    const navigate = useNavigate();
    const [consumeChoice, setConsumeChoice] = React.useState(null);
    React.useEffect(() => { if (!target) setConsumeChoice(null); }, [target]);
    if (!target) return null;
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                <div className="flex flex-col items-center pt-8 pb-5 px-6">
                    <div className="w-20 h-20 rounded-full bg-red-50 border-[3px] border-red-400 flex items-center justify-center mb-5">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                    </div>
                    <h3 className="text-2xl font-black text-gray-800 mb-3">客人離開確認</h3>
                    <p className="text-lg text-gray-600 text-center leading-relaxed font-bold">
                        此單尚未結帳，<br />確認客人已離開嗎？
                    </p>
                    <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 w-full text-center">
                        <span className="text-sm text-red-500 font-bold">{target.label} 訂單將標記為棄單，不產生結帳記錄</span>
                    </div>
                    <div className="w-full mt-4">
                        <p className="text-xs font-bold text-gray-400 mb-2 text-center tracking-wide">食材備製狀態</p>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => setConsumeChoice(true)}
                                className={`py-3 px-2 rounded-xl border-2 text-center transition-all ${consumeChoice === true ? 'bg-amber-500 border-amber-500 text-white' : 'border-gray-200 text-gray-600 hover:border-amber-300'}`}
                            >
                                <div className="text-xl mb-0.5">🍳</div>
                                <div className="font-black text-sm">食材已備製</div>
                                <div className="text-xs opacity-75">扣除庫存</div>
                            </button>
                            <button
                                onClick={() => setConsumeChoice(false)}
                                className={`py-3 px-2 rounded-xl border-2 text-center transition-all ${consumeChoice === false ? 'bg-green-500 border-green-500 text-white' : 'border-gray-200 text-gray-600 hover:border-green-300'}`}
                            >
                                <div className="text-xl mb-0.5">🚫</div>
                                <div className="font-black text-sm">食材未備製</div>
                                <div className="text-xs opacity-75">庫存不異動</div>
                            </button>
                        </div>
                    </div>
                    <button onClick={() => navigate('/inventory')} className="mt-3 text-xs text-blue-400 font-bold hover:text-blue-600 transition-colors">
                        查看庫存頁面 →
                    </button>
                </div>
                <div className="border-t border-gray-100" />
                <div className="flex divide-x divide-gray-100">
                    <button onClick={onCancel} className="flex-1 py-5 text-gray-400 font-black text-xl hover:bg-gray-50 transition-colors">取消</button>
                    <button
                        onClick={() => consumeChoice !== null && onConfirm(consumeChoice)}
                        disabled={consumeChoice === null}
                        className={`flex-1 py-5 font-black text-xl transition-colors ${consumeChoice === null ? 'text-gray-300 cursor-not-allowed' : 'text-red-500 hover:bg-red-50'}`}
                    >確認棄單</button>
                </div>
            </div>
        </div>
    );
};

const TableManagementPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [tableStatuses, setTableStatuses] = useState({});
    const [isLoading, setIsLoading] = useState(true);
    const [abandonTarget, setAbandonTarget] = useState(null);    // { tableNumber, orderId, label }
    const [clearTarget, setClearTarget]     = useState(null);    // { tableNumber, orderId, label }
    const [hasTakeoutOrders, setHasTakeoutOrders] = useState(false);

    const tableStatusesRef = useRef(tableStatuses);

    useEffect(() => {
        tableStatusesRef.current = tableStatuses;
    }, [tableStatuses]);

    /**
     * 載入並刷新所有桌位的實時狀態
     */
    const loadTableStatuses = useCallback(async (manualRefresh = false) => {
        if (manualRefresh || Object.keys(tableStatusesRef.current).length === 0) {
             setIsLoading(true);
        }

        try {
            const dbTableRecords = await getTableStatuses();
            const dbTableMap = new Map();
            dbTableRecords.forEach(record => dbTableMap.set(record.tableNumber, record));

            const statuses = {};
            TABLE_OPTIONS.forEach(tableId => {
                const dbRecord = dbTableMap.get(tableId);
                statuses[tableId] = {
                    id: tableId,
                    orders: []
                };

                if (dbRecord && dbRecord.status === 'open' && !dbRecord.orderId) {
                    // tables.updated_at 被 Supabase 觸發器覆蓋，改從 localStorage 讀開桌時間
                    const storedOpenTime = localStorage.getItem(`table_open_${tableId}`);
                    statuses[tableId].orders.push({
                        status: 'open',
                        timestamp: storedOpenTime ? parseInt(storedOpenTime) : Date.now(),
                        items: [],
                        orderId: null
                    });
                }
            });

            const activeOrders = await getActiveOrders();
            activeOrders.forEach(order => {
                const tableId = order.table;
                if (statuses.hasOwnProperty(tableId)) {
                    const normalizedItems = (order.items || []).map((item) => ({
                        ...item,
                        isSent: !!item.isSent,
                    }));

                    statuses[tableId].orders.push({
                        ...order,
                        orderId: order.id,
                        items: normalizedItems,
                        timestamp: order.timestamp
                    });
                }
            });

            // 同一桌有多張單時，未結帳（served/open）優先顯示，其次依 id 降冪（新的在前）
            const STATUS_PRIORITY = { served: 0, open: 1, paid: 2 };
            Object.keys(statuses).forEach(tid => {
                statuses[tid].orders.sort((a, b) => {
                    const pa = STATUS_PRIORITY[a.status] ?? 3;
                    const pb = STATUS_PRIORITY[b.status] ?? 3;
                    if (pa !== pb) return pa - pb;
                    return (b.orderId || 0) - (a.orderId || 0);
                });
            });

            setTableStatuses(statuses);
            const activeTakeout = activeOrders.filter(o => o.table === '外帶');
            setHasTakeoutOrders(activeTakeout.length > 0);
        } catch (error) {
            console.error("載入桌位狀態失敗:", error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // 每次導航進入此頁面時強制刷新（含結帳後返回的情況）
    useEffect(() => {
        loadTableStatuses(true);
    }, [loadTableStatuses, location.key]);

    // 每 30 秒自動輪詢，多裝置同步用
    useEffect(() => {
        const interval = setInterval(() => loadTableStatuses(false), 30000);
        return () => clearInterval(interval);
    }, [loadTableStatuses]);

    /**
     * 【修正處】處理拖曳換桌邏輯
     * 支援 open/served/paid 狀態的完整訂單遷移
     */
    const handleMoveOrder = useCallback(async (fromTableId, toTableId, order) => {
        // 1. 基本防錯與「純佔桌(無單)」處理
        if (fromTableId === toTableId) return;

        setIsLoading(true);
        try {
            if (!order.orderId) {
                // 如果是「純佔桌」換桌 (無實體訂單 ID)
                await resetTableStatus(fromTableId); // 原桌清空
                // 這裡假設 resetTableStatus 或 updateOrderStatus 邏輯能直接建立新佔桌
                // 如果 db.js 有專門佔桌 API 請替換，此處以更新訂單邏輯兼容
                await updateOrderStatus({
                    newTable: toTableId,
                    newStatus: 'open'
                });
            } else {
                // 2. 如果是「實體訂單」換桌 (served/paid/open 有單狀態)
                // 更新該訂單的桌號，並同步通知後端處理桌位狀態紀錄的搬移
                await updateOrderStatus({ 
                    orderId: order.orderId, 
                    newTable: toTableId,
                    newStatus: order.status,
                    // 確保搬移後，原桌位狀態在資料庫中被重置，新桌位被標記
                    fromTable: fromTableId 
                });
            }
            
            // 重新讀取所有狀態
            await loadTableStatuses(true);
        } catch (error) {
            console.error("換桌失敗:", error);
        } finally {
            setIsLoading(false);
        }
    }, [loadTableStatuses]);

    const handleTableClick = useCallback((tableId, status, currentOrder) => {
        const OCCUPIED_STATUSES = ['open', 'served', 'paid']; 
        const isOccupied = OCCUPIED_STATUSES.includes(status);
        const openTimestamp = currentOrder?.timestamp || Date.now();

        if (isOccupied) {
             navigate('/order', {
                state: {
                    initialTableNumber: tableId,
                    orderId: currentOrder?.orderId || null,
                    orderStatus: status,
                    openTimestamp: openTimestamp,
                    customerCount: currentOrder?.customerCount || 1,
                    sendTime: currentOrder?.sendTime || null,
                    dailyOrderNo: currentOrder?.dailyOrderNo || null,
                }
            });
            return;
        }

        navigate('/order', { 
            state: { 
                initialTableNumber: tableId,
                openTimestamp: Date.now() 
            } 
        });
    }, [navigate]);
    
    const handleToggleItemSentOnTable = useCallback(async (tableId, orderId, itemId, currentIsServed) => {
        if (!orderId || !tableId) return;
        const currentData = tableStatusesRef.current[tableId];
        const order = currentData?.orders?.find(o => o.orderId === orderId);
        if (!order) return;

        const newItems = order.items.map(item => {
            const itemUniqueId = item.internalId || item.id;
            return (itemUniqueId === itemId) ? { ...item, isServed: !currentIsServed } : item;
        });
        
        setIsLoading(true);
        try {
             await updateOrderStatus({ 
                orderId: orderId, 
                newStatus: order.status, 
                newItems: newItems,   
             });
             await loadTableStatuses(true); 
        } catch (error) {
            console.error("更新失敗:", error);
        } finally {
            setIsLoading(false);
        }
    }, [loadTableStatuses]); 

    const handleResetTable = useCallback(async (tableNumber, orderId) => {
        const currentTableData = tableStatusesRef.current[tableNumber];
        const targetOrder = orderId
            ? currentTableData?.orders?.find(o => o.orderId === orderId)
            : currentTableData?.orders?.[0];

        const currentStatus  = targetOrder?.status;
        const isOnlyOccupied = currentStatus === 'open' && !orderId;
        const isEmptyOrder   = currentStatus === 'open' && !!orderId && !(targetOrder?.items?.length);
        const isFullyPaid    = currentStatus === 'paid';
        const isServed       = currentStatus === 'served';

        if (isServed) {
            setAbandonTarget({ tableNumber, orderId, label: tableNumber });
            return;
        }

        if (isOnlyOccupied || isEmptyOrder) {
            // 純佔桌 或 有 orderId 但未點餐（只改人數）→ 清桌確認 modal
            setClearTarget({ tableNumber, orderId: isEmptyOrder ? orderId : null, label: tableNumber });
            return;
        }

        if (isFullyPaid) {
            if (window.confirm(`確定要將 ${tableNumber} 該筆訂單結案並清桌嗎？`)) {
                setIsLoading(true);
                try {
                    await resetTableStatus(tableNumber, orderId);
                    await loadTableStatuses(true);
                } catch (error) {
                    console.error("清桌操作失敗:", error);
                } finally {
                    setIsLoading(false);
                }
            }
            return;
        }

        alert(`桌位 ${tableNumber} 目前狀態為點餐中，無法直接清桌。`);
    }, [loadTableStatuses]);

    const handleConfirmClear = async () => {
        if (!clearTarget) return;
        const { tableNumber, orderId } = clearTarget;
        setClearTarget(null);
        setIsLoading(true);
        try {
            localStorage.removeItem(`table_open_${tableNumber}`);
            await resetTableStatus(tableNumber, orderId);
            await loadTableStatuses(true);
        } catch (error) {
            console.error("清桌操作失敗:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleConfirmAbandon = async (consumeInventory) => {
        if (!abandonTarget) return;
        const { tableNumber, orderId } = abandonTarget;
        setAbandonTarget(null);
        setIsLoading(true);
        try {
            localStorage.removeItem(`table_open_${tableNumber}`);
            await resetTableStatus(tableNumber, orderId, consumeInventory);
            await loadTableStatuses(true);
        } catch (e) {
            console.error("棄單失敗:", e);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="h-[100dvh] w-full overflow-hidden grid grid-rows-2 font-sans gap-4 p-4 bg-gray-50">
            {isLoading && Object.keys(tableStatuses).length === 0 ? (
                <div className="h-full w-full flex items-center justify-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-5 gap-2 min-h-0">
                        {['A1', 'A2', 'A3', 'A4', 'A5'].map(tableId => (
                            <div key={tableId} className="h-full min-h-0 overflow-hidden">
                                <TableCard
                                    tableData={tableStatuses[tableId] || { id: tableId, orders: [] }}
                                    handleTableClick={handleTableClick}
                                    handleToggleItemSentOnTable={handleToggleItemSentOnTable}
                                    handleResetTable={handleResetTable} 
                                    handleMoveOrder={handleMoveOrder}
                                    isLoading={isLoading} 
                                />
                            </div>
                        ))}
                    </div>

                    <div className="grid grid-cols-5 gap-2 min-h-0">
                        {/* 外帶按鈕 */}
                        <div className="h-full min-h-0 overflow-hidden">
                            <div
                                onClick={() => navigate('/takeout')}
                                className={`w-full h-full rounded-2xl flex flex-col items-center justify-center shadow-lg transition-all cursor-pointer border-2
                                    ${hasTakeoutOrders
                                        ? 'bg-[#2FB8B8] border-[#2FB8B8] text-white hover:brightness-95'
                                        : 'bg-white border-gray-300 text-gray-400 hover:border-gray-400'
                                    }`}
                            >
                                <svg className="mb-1" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                                    <line x1="3" y1="6" x2="21" y2="6"/>
                                    <path d="M16 10a4 4 0 01-8 0"/>
                                </svg>
                                <span className="text-xl font-black tracking-wide">外帶</span>
                                <span className={`text-xs font-bold mt-0.5 ${hasTakeoutOrders ? 'text-white/80' : 'text-gray-400'}`}>
                                    {hasTakeoutOrders ? '有待處理單' : '點擊管理'}
                                </span>
                            </div>
                        </div>
                        <div className="col-span-3 grid grid-cols-3 gap-2 h-full min-h-0">
                            {['A6', 'A7', 'A8'].map(tableId => (
                                <div key={tableId} className="h-full min-h-0 overflow-hidden">
                                    <TableCard
                                        tableData={tableStatuses[tableId] || { id: tableId, orders: [] }}
                                        handleTableClick={handleTableClick}
                                        handleToggleItemSentOnTable={handleToggleItemSentOnTable}
                                        handleResetTable={handleResetTable}
                                        handleMoveOrder={handleMoveOrder}
                                        isLoading={isLoading}
                                    />
                                </div>
                            ))}
                        </div>

                    </div>
                </>
            )}

            <ClearTableModal
                target={clearTarget}
                onConfirm={handleConfirmClear}
                onCancel={() => setClearTarget(null)}
            />
            <AbandonOrderModal
                target={abandonTarget}
                onConfirm={handleConfirmAbandon}
                onCancel={() => setAbandonTarget(null)}
            />
        </div>
    );
};

export default TableManagementPage;