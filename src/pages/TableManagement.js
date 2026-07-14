// src/pages/TableManagement.js (修正換桌邏輯版本)

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    getActiveOrders,
    updateOrderStatus,
    resetTableStatus,
    getTableStatuses,
    occupyTableWithoutOrder,
    moveOrderToTable,
} from '../db';

import TableCard from '../components/TableCard';

const TABLE_OPTIONS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'];

const PaidClearModal = ({ target, onConfirm, onCancel }) => {
    if (!target) return null;
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                <div className="flex flex-col items-center pt-8 pb-5 px-6">
                    <div className="w-20 h-20 rounded-full bg-[#5A7D85]/10 border-[3px] border-[#5A7D85] flex items-center justify-center mb-5">
                        <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#5A7D85" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                            <polyline points="16 17 21 12 16 7"/>
                            <line x1="21" y1="12" x2="9" y2="12"/>
                        </svg>
                    </div>
                    <h3 className="text-2xl font-black text-gray-800 mb-2">清桌確認</h3>
                    <p className="text-base text-gray-500 text-center leading-relaxed font-medium">
                        <span className="font-black text-gray-700">{target.label}</span> 訂單已全部結帳，<br />確定結案並清桌嗎？
                    </p>
                </div>
                <div className="border-t border-gray-100" />
                <div className="flex divide-x divide-gray-100">
                    <button onClick={onCancel} className="flex-1 py-5 text-gray-400 font-black text-xl hover:bg-gray-50 transition-colors">取消</button>
                    <button onClick={onConfirm} className="flex-1 py-5 text-[#5A7D85] font-black text-xl hover:bg-[#5A7D85]/5 transition-colors">確認清桌</button>
                </div>
            </div>
        </div>
    );
};

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

// 同桌合併訂單 Modal
const SameTableMergeModal = ({ sourceOrder, allOrders, onMerge, onCancel }) => {
    if (!sourceOrder) return null;
    const fmtNo = (o) => o.dailyOrderNo ? String(o.dailyOrderNo).padStart(3, '0') : (o.orderId ? String(o.orderId).slice(-3).padStart(3, '0') : '???');
    const others = allOrders.filter(o => o.orderId && o.orderId !== sourceOrder.orderId);
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden">
                <div className="pt-6 pb-2 px-6">
                    <h3 className="text-xl font-black text-gray-800 mb-1 text-center">合併訂單</h3>
                    <p className="text-sm text-gray-500 text-center mb-4">
                        將 <span className="font-black text-gray-700">#{fmtNo(sourceOrder)}</span> 的品項合入：
                    </p>
                    <div className="space-y-2">
                        {others.map(o => (
                            <button key={o.orderId} onClick={() => onMerge(o)}
                                className="w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 border-green-200 bg-green-50 text-green-700 hover:bg-green-100 transition-all active:scale-95">
                                <span className="font-black text-base">#{fmtNo(o)}</span>
                                <span className="text-xs font-bold opacity-70">{(o.items || []).length} 項品項</span>
                            </button>
                        ))}
                        {others.length === 0 && (
                            <p className="text-center text-gray-400 text-sm py-2">無其他可合併的訂單</p>
                        )}
                    </div>
                </div>
                <div className="border-t border-gray-100 mt-4">
                    <button onClick={onCancel} className="w-full py-4 text-gray-400 font-black text-lg hover:bg-gray-50 transition-colors">取消</button>
                </div>
            </div>
        </div>
    );
};

// 換桌目標桌選擇 Modal
const TablePickerModal = ({ sourceTableId, tableStatuses, onSelect, onCancel }) => {
    if (!sourceTableId) return null;
    const allTables = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'];
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden">
                <div className="pt-6 pb-2 px-6">
                    <h3 className="text-xl font-black text-gray-800 mb-1 text-center">選擇目標桌位</h3>
                    <p className="text-sm text-gray-500 text-center mb-4">將 <span className="font-black text-gray-700">{sourceTableId}</span> 的訂單移至：</p>
                    <div className="grid grid-cols-4 gap-2">
                        {allTables.filter(t => t !== sourceTableId).map(t => {
                            const td = tableStatuses[t] || { orders: [] };
                            const occupied = td.orders.some(o => ['open','served','paid'].includes(o.status));
                            return (
                                <button key={t} onClick={() => onSelect(t)}
                                    className={`py-3 rounded-xl font-black text-sm transition-all active:scale-95 ${occupied ? 'bg-amber-50 border-2 border-amber-300 text-amber-700 hover:bg-amber-100' : 'bg-blue-50 border-2 border-blue-200 text-blue-700 hover:bg-blue-100'}`}>
                                    {t}
                                    {occupied && <div className="text-[9px] font-bold opacity-70 leading-none mt-0.5">有訂單</div>}
                                </button>
                            );
                        })}
                    </div>
                </div>
                <div className="border-t border-gray-100 mt-4">
                    <button onClick={onCancel} className="w-full py-4 text-gray-400 font-black text-lg hover:bg-gray-50 transition-colors">取消</button>
                </div>
            </div>
        </div>
    );
};

// 換桌確認 Modal（長按拖曳放開後永遠跳出）
const MoveConfirmModal = ({ conflictData, onConfirm, onIndependent, onMerge, onCancel }) => {
    if (!conflictData) return null;
    const { fromTable, toTable, toOrders, movedOrder } = conflictData;
    const isOccupied = toOrders && toOrders.length > 0;
    const hasSourceItems = movedOrder?.items?.length > 0;
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                <div className="flex flex-col items-center pt-7 pb-4 px-6">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${isOccupied ? 'bg-amber-50 border-[3px] border-amber-400' : 'bg-blue-50 border-[3px] border-blue-400'}`}>
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={isOccupied ? '#f59e0b' : '#3b82f6'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 9l4-4 4 4"/><path d="M9 5v14"/>
                            <path d="M19 15l-4 4-4-4"/><path d="M15 19V5"/>
                        </svg>
                    </div>
                    <h3 className="text-xl font-black text-gray-800 mb-1">換桌確認</h3>
                    <div className="flex items-center gap-3 my-2">
                        <span className="text-2xl font-black text-gray-700 bg-gray-100 px-3 py-1 rounded-xl">{fromTable}</span>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                        <span className={`text-2xl font-black px-3 py-1 rounded-xl ${isOccupied ? 'text-amber-700 bg-amber-50' : 'text-blue-700 bg-blue-50'}`}>{toTable}</span>
                    </div>
                    {isOccupied ? (
                        <p className="text-sm text-amber-600 font-bold text-center mt-1 bg-amber-50 rounded-xl px-4 py-2 w-full">
                            桌 {toTable} 已有訂單，請選擇處理方式
                        </p>
                    ) : (
                        <p className="text-sm text-gray-500 text-center mt-1">確認將訂單從 <span className="font-black text-gray-700">{fromTable}</span> 移至 <span className="font-black text-gray-700">{toTable}</span>？</p>
                    )}
                </div>

                {isOccupied ? (
                    <div className="grid grid-cols-2 gap-3 px-6 pb-6">
                        <button onClick={onIndependent}
                            className="flex flex-col items-center py-4 px-2 rounded-xl border-2 border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-all active:scale-95">
                            <svg className="mb-1" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="2" y="3" width="9" height="18" rx="2"/><rect x="13" y="3" width="9" height="18" rx="2"/>
                            </svg>
                            <div className="font-black text-sm">各自獨立</div>
                            <div className="text-[10px] font-bold opacity-70 mt-0.5 text-center leading-tight">各自計算<br/>各自結帳</div>
                        </button>
                        {hasSourceItems && (
                            <button onClick={() => onMerge(toOrders[0])}
                                className="flex flex-col items-center py-4 px-2 rounded-xl border-2 border-green-200 bg-green-50 text-green-700 hover:bg-green-100 transition-all active:scale-95">
                                <svg className="mb-1" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>
                                </svg>
                                <div className="font-black text-sm">合併訂單</div>
                                <div className="text-[10px] font-bold opacity-70 mt-0.5 text-center leading-tight">品項合入<br/>{toTable} 訂單</div>
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="px-6 pb-6">
                        <button onClick={onConfirm}
                            className="w-full py-4 rounded-xl font-black text-lg bg-blue-600 text-white hover:bg-blue-700 active:scale-95 transition-all">
                            確認換桌
                        </button>
                    </div>
                )}

                <div className="border-t border-gray-100">
                    <button onClick={onCancel} className="w-full py-4 text-gray-400 font-black text-lg hover:bg-gray-50 transition-colors">取消</button>
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
    const [abandonTarget, setAbandonTarget]     = useState(null);    // { tableNumber, orderId, label }
    const [clearTarget, setClearTarget]         = useState(null);    // { tableNumber, orderId, label }
    const [paidClearTarget, setPaidClearTarget] = useState(null);    // { tableNumber, orderId, label }
    const [hasTakeoutOrders, setHasTakeoutOrders] = useState(false);
    const [conflictData, setConflictData] = useState(null);      // { movedOrder, fromTable, toTable, toOrders }
    const [moveSource, setMoveSource] = useState(null);           // { tableId, order }
    const [mergeSource, setMergeSource] = useState(null);         // { tableId, order, allOrders }

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

    const handleMoveRequest = useCallback((tableId, order) => {
        setMoveSource({ tableId, order });
    }, []);

    const handleMergeRequest = useCallback((tableId, order, allOrders) => {
        setMergeSource({ tableId, order, allOrders });
    }, []);

    const handlePickTargetTable = useCallback((targetTableId) => {
        if (!moveSource) return;
        const toTableData = tableStatusesRef.current[targetTableId] || { orders: [] };
        const toOrders = toTableData.orders.filter(o => ['open', 'served', 'paid'].includes(o.status));
        setConflictData({ movedOrder: moveSource.order, fromTable: moveSource.tableId, toTable: targetTableId, toOrders });
        setMoveSource(null);
    }, [moveSource]);

    /**
     * 換桌：執行實際的換桌 API 呼叫
     */
    const executeMoveOrder = useCallback(async (order, fromTable, toTable, mergeWithOrder) => {
        setConflictData(null);
        setIsLoading(true);
        try {
            if (order.orderId) {
                await moveOrderToTable(order.orderId, {
                    newTable: toTable,
                    fromTable,
                    mergeWithOrderId: mergeWithOrder?.orderId || null,
                });
            } else {
                // 純佔桌（無實體訂單）：清空舊桌，佔用新桌
                localStorage.removeItem(`table_open_${fromTable}`);
                await resetTableStatus(fromTable);
                const newTime = Date.now();
                localStorage.setItem(`table_open_${toTable}`, String(newTime));
                await occupyTableWithoutOrder(toTable, newTime);
            }
            await loadTableStatuses(true);
        } catch (error) {
            console.error('換桌失敗:', error);
        } finally {
            setIsLoading(false);
        }
    }, [loadTableStatuses]);

    const handleMoveToTakeout = useCallback(async (tableId, order) => {
        // 換到外帶：直接執行，不顯示合併確認（外帶一律獨立新單），完成後直接切換到外帶 OrderPage
        await executeMoveOrder(order, tableId, '外帶', null);
        navigate('/order', {
            state: {
                isTakeout: true,
                orderId: order.orderId || null,
                orderStatus: order.status || 'open',
                openTimestamp: order.timestamp || Date.now(),
                customerCount: order.customerCount ?? 0,
                sendTime: order.sendTime || null,
                dailyOrderNo: order.dailyOrderNo || null,
                forceNewOrder: !order.orderId,
            }
        });
    }, [executeMoveOrder, navigate]);

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
                    forceNewOrder: !currentOrder?.orderId,
                }
            });
            return;
        }

        navigate('/order', {
            state: {
                initialTableNumber: tableId,
                openTimestamp: Date.now(),
                forceNewOrder: true,
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

        // Optimistic update：立即更新本地 state，不等待 API
        setTableStatuses(prev => {
            const prevTable = prev[tableId];
            if (!prevTable) return prev;
            return {
                ...prev,
                [tableId]: {
                    ...prevTable,
                    orders: prevTable.orders.map(o =>
                        o.orderId === orderId ? { ...o, items: newItems } : o
                    ),
                },
            };
        });

        try {
            await updateOrderStatus({
                orderId: orderId,
                newStatus: order.status,
                newItems: newItems,
            });
        } catch (error) {
            console.error("更新失敗:", error);
            // 失敗時 reload 還原正確狀態
            await loadTableStatuses(true);
        }
    }, [loadTableStatuses]);

    const handleResetTable = useCallback(async (tableNumber, orderId) => {
        const currentTableData = tableStatusesRef.current[tableNumber];
        const targetOrder = orderId
            ? currentTableData?.orders?.find(o => o.orderId === orderId)
            : currentTableData?.orders?.[0];

        const currentStatus  = targetOrder?.status;
        const isOnlyOccupied = currentStatus === 'open' && !orderId;

        // 計算 effectiveStatus：paid 但仍有未結帳品項（合併後）→ 視為 served
        const orderItems = targetOrder?.items || [];
        const unpaidAmount = orderItems.reduce((acc, item) => !item.isPaid ? acc + ((item.price || 0) * (item.quantity || 0)) : acc, 0);
        const hasUnpaid = unpaidAmount > 0;
        const effectiveStatus = (currentStatus === 'paid' && hasUnpaid) ? 'served' : currentStatus;

        // 有尚未結帳品項（served 狀態，含合併後 paid+未結帳）→ 棄單流程
        if (effectiveStatus === 'served') {
            setAbandonTarget({ tableNumber, orderId, label: tableNumber });
            return;
        }

        // 純佔桌（無訂單）→ 清桌確認 modal
        if (isOnlyOccupied) {
            setClearTarget({ tableNumber, orderId: null, label: tableNumber });
            return;
        }

        // open 狀態（點餐中或只有佔桌有 orderId）→ 清桌確認 modal（品項尚未送出，不需棄單流程）
        if (effectiveStatus === 'open') {
            setClearTarget({ tableNumber, orderId: orderId || null, label: tableNumber });
            return;
        }

        // 全部結帳完成 → 清桌 modal
        if (effectiveStatus === 'paid') {
            setPaidClearTarget({ tableNumber, orderId, label: tableNumber });
            return;
        }
    }, [loadTableStatuses]);

    const handleConfirmPaidClear = async () => {
        if (!paidClearTarget) return;
        const { tableNumber, orderId } = paidClearTarget;
        setPaidClearTarget(null);
        setIsLoading(true);
        try {
            await resetTableStatus(tableNumber, orderId);
            await loadTableStatuses(true);
        } catch (error) {
            console.error("清桌操作失敗:", error);
        } finally {
            setIsLoading(false);
        }
    };

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
                            <div key={tableId} data-table-id={tableId} className="h-full min-h-0 overflow-hidden">
                                <TableCard
                                    tableData={tableStatuses[tableId] || { id: tableId, orders: [] }}
                                    handleTableClick={handleTableClick}
                                    handleToggleItemSentOnTable={handleToggleItemSentOnTable}
                                    handleResetTable={handleResetTable}
                                    onMoveRequest={handleMoveRequest}
                                    onMergeRequest={handleMergeRequest}
                                    onMoveToTakeout={handleMoveToTakeout}
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
                                <div key={tableId} data-table-id={tableId} className="h-full min-h-0 overflow-hidden">
                                    <TableCard
                                        tableData={tableStatuses[tableId] || { id: tableId, orders: [] }}
                                        handleTableClick={handleTableClick}
                                        handleToggleItemSentOnTable={handleToggleItemSentOnTable}
                                        handleResetTable={handleResetTable}
                                        onMoveRequest={handleMoveRequest}
                                        onMergeRequest={handleMergeRequest}
                                        onMoveToTakeout={handleMoveToTakeout}
                                        isLoading={isLoading}
                                    />
                                </div>
                            ))}
                        </div>

                    </div>
                </>
            )}

            <PaidClearModal
                target={paidClearTarget}
                onConfirm={handleConfirmPaidClear}
                onCancel={() => setPaidClearTarget(null)}
            />
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
            <SameTableMergeModal
                sourceOrder={mergeSource?.order || null}
                allOrders={mergeSource?.allOrders || []}
                onMerge={(targetOrder) => {
                    const src = mergeSource;
                    setMergeSource(null);
                    executeMoveOrder(src.order, src.tableId, src.tableId, targetOrder);
                }}
                onCancel={() => setMergeSource(null)}
            />
            <TablePickerModal
                sourceTableId={moveSource?.tableId || null}
                tableStatuses={tableStatuses}
                onSelect={handlePickTargetTable}
                onCancel={() => setMoveSource(null)}
            />
            <MoveConfirmModal
                conflictData={conflictData}
                onConfirm={() => executeMoveOrder(conflictData.movedOrder, conflictData.fromTable, conflictData.toTable, null)}
                onIndependent={() => executeMoveOrder(conflictData.movedOrder, conflictData.fromTable, conflictData.toTable, null)}
                onMerge={(destOrder) => executeMoveOrder(conflictData.movedOrder, conflictData.fromTable, conflictData.toTable, destOrder)}
                onCancel={() => setConflictData(null)}
            />
        </div>
    );
};

export default TableManagementPage;