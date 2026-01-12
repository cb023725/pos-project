// src/pages/TableManagement.js (最終修正版本：強化清桌提示)

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    getActiveOrders, 
    updateOrderStatus,
    resetTableStatus, 
    getTableStatuses, 
} from '../db'; 

import TableCard from '../components/TableCard'; 

const TABLE_OPTIONS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'];

// TableManagementPage 組件開始
const TableManagementPage = () => {
    const navigate = useNavigate();
    const [tableStatuses, setTableStatuses] = useState({});
    const [isLoading, setIsLoading] = useState(true); 
    
    const tableStatusesRef = useRef(tableStatuses);

    useEffect(() => {
        tableStatusesRef.current = tableStatuses;
    }, [tableStatuses]);


    /**
     * 載入並刷新所有桌位的實時狀態。
     */
    const loadTableStatuses = useCallback(async (manualRefresh = false) => {
        console.log(`[LOAD] 載入桌位狀態 (手動刷新: ${manualRefresh})`);

        if (manualRefresh || Object.keys(tableStatusesRef.current).length === 0) {
             setIsLoading(true);
        }
        
        try {
            // 1. 獲取桌位基礎狀態 (來自 STORE_TABLES)
            const dbTableRecords = await getTableStatuses();
            const dbTableMap = new Map();
            dbTableRecords.forEach(record => dbTableMap.set(record.tableNumber, record));
            
            const statuses = {};
            TABLE_OPTIONS.forEach(tableId => {
                const dbRecord = dbTableMap.get(tableId);
                
                statuses[tableId] = { 
                    id: tableId, 
                    status: dbRecord?.status || 'idle', 
                    order: dbRecord?.lastOrderTime ? { 
                        orderId: dbRecord?.orderId || null, // 確保 orderId 欄位存在
                        timestamp: dbRecord.lastOrderTime,
                        items: [] 
                    } : null, 
                };
            });

            // 2. 獲取活躍訂單 (來自 STORE_ORDERS)，並以訂單數據覆蓋
            const activeOrders = await getActiveOrders(); 
            
            activeOrders.forEach(order => {
                const tableId = order.table;
                
                if (statuses.hasOwnProperty(tableId)) {
                    
                    const normalizedItems = (order.items || []).map((item) => ({
                        ...item,
                        // 修正：讓 isSent 狀態完全依賴後端儲存的值
                        isSent: !!item.isSent, 
                    }));

                    statuses[tableId] = { 
                        id: tableId, 
                        status: order.status, 
                        order: { 
                            ...order, 
                            orderId: order.id, // 確保使用 order.id 作為 orderId
                            items: normalizedItems,
                            timestamp: order.timestamp || statuses[tableId].order?.timestamp
                        }
                    };
                }
            });
            
            setTableStatuses(statuses);
            
        } catch (error) {
            console.error("載入桌位狀態失敗:", error);
        } finally {
            setIsLoading(false); 
        }
    }, []); 

    // 初始載入及設定定時刷新
    useEffect(() => {
        loadTableStatuses(true);
    }, [loadTableStatuses]); 

    /**
     * 點擊桌位處理 (保持不變)
     */
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
                } 
            });
            return;
        }

        // 閒置桌位點擊進入
        navigate('/order', { 
            state: { 
                initialTableNumber: tableId,
                openTimestamp: Date.now() 
            } 
        });
    }, [navigate]);
    
    /**
     * 出餐切換邏輯 (純註記，將新狀態儲存回後端) (保持不變)
     */
    const handleToggleItemSentOnTable = useCallback(async (tableId, orderId, itemId, currentIsSent) => {
        if (!orderId || !tableId) return;

        const currentData = tableStatusesRef.current[tableId]; 
        if (!currentData?.order) return;
        
        const order = currentData.order;
        const newItems = order.items.map(item => {
            const itemUniqueId = item.internalId || item.id;
            // 傳入的 currentIsSent 是舊值，所以我們傳入 !currentIsSent 才是新值
            return (itemUniqueId === itemId) ? { ...item, isSent: !currentIsSent } : item;
        });
        
        let updatedStatus = order.status; 
        
        setIsLoading(true);
        try {
             // 儲存操作員的手動勾選狀態
             await updateOrderStatus({ 
                orderId: orderId, 
                newStatus: updatedStatus, 
                newItems: newItems,   
             });
             
             // 重新載入
             await loadTableStatuses(true); 
        } catch (error) {
            console.error("更新失敗:", error);
        } finally {
            setIsLoading(false);
        }
    }, [loadTableStatuses]); 

    /**
     * 處理清桌 
     * 只有在 status === 'paid' (完全結帳) 或 'open' 且無訂單 (僅佔位) 時才允許清桌。
     */
    const handleResetTable = useCallback(async (tableNumber) => {
        const currentTableData = tableStatusesRef.current[tableNumber];
        const currentStatus = currentTableData?.status;
        const currentOrderId = currentTableData?.order?.orderId; // 檢查是否有 orderId
        
        // 1. 允許：僅佔位 (open 且無 orderId)
        const isOnlyOccupied = currentStatus === 'open' && !currentOrderId;
        
        // 2. 允許：已完全結帳 (paid)
        const isFullyPaid = currentStatus === 'paid'; 
        
        // 只有這兩種情況可以清桌
        const isReadyToReset = isFullyPaid || isOnlyOccupied;

        if (!isReadyToReset) {
             let message = '';
             if (currentStatus === 'served') {
                 // served 狀態代表仍有未結帳項目 (或未清桌的已結帳項目)
                 message = `桌位 ${tableNumber} 狀態為「已點餐/部分結帳」（served），請先到訂單頁面完成所有款項結清，或確認是否仍有未出餐點。`;
             } else {
                 message = `桌位 ${tableNumber} 狀態為 ${currentStatus}，無法清桌。`;
             }
             alert(message);
             return;
        }

        const msg = isOnlyOccupied 
            ? `桌位 ${tableNumber} 尚未點餐，確定要取消佔位嗎？`
            : `桌位 ${tableNumber} 已結帳，確定要清桌並將訂單歸檔嗎？`;

        if (window.confirm(msg)) {
            setIsLoading(true);
            try {
                // resetTableStatus 會處理訂單歸檔和桌位狀態重置
                await resetTableStatus(tableNumber); 
                await loadTableStatuses(true); 
            } catch (error) {
                console.error("清桌操作失敗:", error);
            } finally {
                setIsLoading(false);
            }
        }
    }, [loadTableStatuses]);

    // 渲染部分 (保持不變)
    return (
        <div className="p-8 min-h-screen bg-gray-100 flex flex-col font-sans">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-black text-gray-800 tracking-tight">桌位管理系統</h1>
                </div>
                <button
                    onClick={() => navigate('/order', { state: { initialTableNumber: '外帶', openTimestamp: Date.now() } })}
                    className="px-8 py-3 bg-blue-600 text-white font-black rounded-2xl shadow-xl hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-2"
                >
                    <span className="text-xl">+</span> 新增外帶訂單
                </button>
            </div>
            
            {isLoading && Object.keys(tableStatuses).length === 0 ? (
                <div className="flex-grow flex items-center justify-center">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                        <p className="text-gray-500 font-bold">載入桌況中...</p>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {TABLE_OPTIONS.map(tableId => (
                        <TableCard
                            key={tableId}
                            tableData={tableStatuses[tableId] || { id: tableId, status: 'idle', order: null }}
                            handleTableClick={handleTableClick}
                            handleToggleItemSentOnTable={handleToggleItemSentOnTable}
                            handleResetTable={handleResetTable} 
                            isLoading={isLoading} 
                        />
                    ))}
                </div>
            )}
        
            {isLoading && (
                <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center">
                    <div className="bg-white px-8 py-4 rounded-2xl shadow-2xl font-black text-blue-600 animate-pulse">
                        資料同步中...
                    </div>
                </div>
            )}
        </div>
    );
};

export default TableManagementPage;