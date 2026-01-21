// src/pages/TableManagement.js (平板優化版本：全螢幕無捲軸)

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    getActiveOrders, 
    updateOrderStatus,
    resetTableStatus, 
    getTableStatuses, 
} from '../db'; 

import TableCard from '../components/TableCard'; 

// 假設固定為 8 桌以符合兩排佈局 (4x2)
const TABLE_OPTIONS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'];

const TableManagementPage = () => {
    const navigate = useNavigate();
    const [tableStatuses, setTableStatuses] = useState({});
    const [isLoading, setIsLoading] = useState(true); 
    
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
                    status: dbRecord?.status || 'idle', 
                    order: dbRecord?.lastOrderTime ? { 
                        orderId: dbRecord?.orderId || null,
                        timestamp: dbRecord.lastOrderTime,
                        items: [] 
                    } : null, 
                };
            });

            const activeOrders = await getActiveOrders(); 
            activeOrders.forEach(order => {
                const tableId = order.table;
                if (statuses.hasOwnProperty(tableId)) {
                    const normalizedItems = (order.items || []).map((item) => ({
                        ...item,
                        isSent: !!item.isSent, 
                    }));

                    statuses[tableId] = { 
                        id: tableId, 
                        status: order.status, 
                        order: { 
                            ...order, 
                            orderId: order.id,
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

    useEffect(() => {
        loadTableStatuses(true);
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
    
    const handleToggleItemSentOnTable = useCallback(async (tableId, orderId, itemId, currentIsSent) => {
        if (!orderId || !tableId) return;
        const currentData = tableStatusesRef.current[tableId]; 
        if (!currentData?.order) return;
        
        const order = currentData.order;
        const newItems = order.items.map(item => {
            const itemUniqueId = item.internalId || item.id;
            return (itemUniqueId === itemId) ? { ...item, isSent: !currentIsSent } : item;
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

    const handleResetTable = useCallback(async (tableNumber) => {
        const currentTableData = tableStatusesRef.current[tableNumber];
        const currentStatus = currentTableData?.status;
        const currentOrderId = currentTableData?.order?.orderId;
        
        const isOnlyOccupied = currentStatus === 'open' && !currentOrderId;
        const isFullyPaid = currentStatus === 'paid'; 
        const isServed = currentStatus === 'served'; 
        
        let msg = '';
        
        if (isFullyPaid) {
            msg = `確定要將 ${tableNumber} 訂單結案並清桌嗎？`;
        } else if (isOnlyOccupied) {
            msg = `確定要取消 ${tableNumber} 的佔位嗎？`;
        } else if (isServed) {
            msg = `⚠️ 桌位 ${tableNumber} 尚未結帳 (出餐中)。\n若客人已離開，點擊「確定」將強制刪除此單並清桌。`;
        } else {
            alert(`桌位 ${tableNumber} 目前狀態為點餐中，無法直接清桌。`);
            return;
        }

        if (window.confirm(msg)) {
            setIsLoading(true);
            try {
                await resetTableStatus(tableNumber); 
                await loadTableStatuses(true); 
            } catch (error) {
                console.error("清桌操作失敗:", error);
            } finally {
                setIsLoading(false);
            }
        }
    }, [loadTableStatuses]);

return (
        /* 修正點：
           1. 加入 p-2：讓整體內容與螢幕邊緣保持適度距離。
           2. gap-2：微調間距，讓卡片之間呼吸空間更自然。
        */
        <div className="h-[100dvh] w-full overflow-hidden grid grid-rows-2 font-sans gap-3 p-3 bg-gray-50">
            
            {isLoading && Object.keys(tableStatuses).length === 0 ? (
                <div className="h-full w-full flex items-center justify-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                </div>
            ) : (
                <>
                    {/* 上排：A1 ~ A5 */}
                    <div className="grid grid-cols-5 gap-2 min-h-0">
                        {['A1', 'A2', 'A3', 'A4', 'A5'].map(tableId => (
                            <div key={tableId} className="h-full min-h-0 overflow-hidden">
                                <TableCard
                                    tableData={tableStatuses[tableId] || { id: tableId, status: 'idle', order: null }}
                                    handleTableClick={handleTableClick}
                                    handleToggleItemSentOnTable={handleToggleItemSentOnTable}
                                    handleResetTable={handleResetTable} 
                                    isLoading={isLoading} 
                                />
                            </div>
                        ))}
                    </div>

                    {/* 下排：A6 ~ A8 */}
                    <div className="grid grid-cols-5 gap-2 min-h-0">
                        <div className="col-start-2 col-span-3 grid grid-cols-3 gap-2 h-full min-h-0">
                            {['A6', 'A7', 'A8'].map(tableId => (
                                <div key={tableId} className="h-full min-h-0 overflow-hidden">
                                    <TableCard
                                        tableData={tableStatuses[tableId] || { id: tableId, status: 'idle', order: null }}
                                        handleTableClick={handleTableClick}
                                        handleToggleItemSentOnTable={handleToggleItemSentOnTable}
                                        handleResetTable={handleResetTable} 
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