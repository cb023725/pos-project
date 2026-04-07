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

const TableManagementPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [tableStatuses, setTableStatuses] = useState({});
    const [isLoading, setIsLoading] = useState(true);
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
                    statuses[tableId].orders.push({
                        status: 'open',
                        timestamp: dbRecord.lastOrderTime,
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

        const currentStatus = targetOrder?.status;
        const isOnlyOccupied = currentStatus === 'open' && !orderId;
        const isFullyPaid = currentStatus === 'paid'; 
        const isServed = currentStatus === 'served'; 
        
        let msg = '';
        if (isFullyPaid) {
            msg = `確定要將 ${tableNumber} 該筆訂單結案並清桌嗎？`;
        } else if (isOnlyOccupied) {
            msg = `確定要取消 ${tableNumber} 的佔位嗎？`;
        } else if (isServed) {
            msg = `⚠️ 桌位 ${tableNumber} 此單尚未結帳 (出餐中)。\n若客人已離開，點擊「確定」將強制刪除此單並清桌。`;
        } else {
            alert(`桌位 ${tableNumber} 目前狀態為點餐中，無法直接清桌。`);
            return;
        }

        if (window.confirm(msg)) {
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
    }, [loadTableStatuses]);

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

        </div>
    );
};

export default TableManagementPage;