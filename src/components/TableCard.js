// src/components/TableCard.js
import React, { useEffect, useState, useRef } from 'react';

// --- 輔助函式保持不變 ---
const useTimer = (startTime) => {
    const [elapsedMinutes, setElapsedMinutes] = useState(0);
    useEffect(() => {
        if (!startTime) { setElapsedMinutes(0); return; }
        const start = new Date(startTime).getTime();
        const updateTimer = () => {
            const now = Date.now();
            const diff = Math.floor((now - start) / 60000); 
            setElapsedMinutes(Math.max(0, diff)); 
        };
        const intervalId = setInterval(updateTimer, 10000);
        updateTimer(); 
        return () => clearInterval(intervalId);
    }, [startTime]);
    return { val: elapsedMinutes, display: `${elapsedMinutes} min` };
};

const formatCurrency = (number) => {
    const roundedNumber = Math.round(number || 0);
    return roundedNumber.toLocaleString('en-US'); 
};

const mapOrderStatus = (status) => {
    switch (status) {
        case 'open': return { color: 'bg-yellow-400', borderColor: 'border-yellow-400' };
        case 'served': return { color: 'bg-[#2FB8B8]', borderColor: 'border-[#2FB8B8]' };
        case 'paid': return { color: 'bg-[#5A7D85]', borderColor: 'border-[#5A7D85]' }; 
        default: return { color: 'bg-gray-200', borderColor: 'border-gray-100' }; 
    }
};

const TableCard = ({ tableData, handleTableClick, handleToggleItemSentOnTable, handleResetTable, handleMoveOrder, isLoading }) => {
    // 【需求修正】數據結構由單一 order 改為 orders 陣列
    const { id: tableId, orders = [] } = tableData;
    const [currentIndex, setCurrentIndex] = useState(0);
    const scrollRef = useRef(null);

    // 處理左右滑動索引
    const handleScroll = (e) => {
        const width = e.target.offsetWidth;
        if (width > 0) {
            const newIndex = Math.round(e.target.scrollLeft / width);
            if (newIndex !== currentIndex) setCurrentIndex(newIndex);
        }
    };

    // 【核心邏輯】動態取得目前滑動到的那一張單，若沒單則為空
    const currentOrder = orders[currentIndex] || null;
    const status = currentOrder?.status || 'idle';
    const orderItems = currentOrder?.items || [];
    
    // 以下所有判斷邏輯完全繼承自您提供的原始碼，僅將 order 改為 currentOrder
    const statusInfo = mapOrderStatus(status); 
    const unpaidAmount = orderItems.reduce((acc, item) => !item.isPaid ? acc + ((item.price || 0) * (item.quantity || 0)) : acc, 0);
    const hasUnpaid = unpaidAmount > 0;
    const totalAmount = currentOrder?.total || currentOrder?.subTotal || 0;

    const orderIdDisplay = currentOrder?.dailyOrderNo
        ? String(currentOrder.dailyOrderNo).padStart(3, '0')
        : currentOrder?.orderId
            ? currentOrder.orderId.toString().slice(-3).padStart(3, '0')
            : '000';
    
    const elapsed = useTimer(currentOrder?.timestamp); 
    const service = useTimer(currentOrder?.sendTime); 
    const isOverTime = elapsed.val >= 90;

    const isDetailedStatus = ['served', 'paid'].includes(status);
    const isFullyPaid = status === 'paid'; 
    const isUnpaid = status === 'served' || status === 'open';
    const shouldShowActionButton = orders.length > 0;

    const goToOrder = () => { if (!isLoading) handleTableClick(tableId, status, currentOrder); };

    const handleQuickReset = (e) => {
        e.stopPropagation();
        if (isLoading || !currentOrder) return;
        handleResetTable(tableId, currentOrder.orderId);
    };

    const handleActionButtonClick = (e) => {
        e.stopPropagation();
        if (isLoading) return;
        if (isUnpaid) { goToOrder(); } 
        else if (isFullyPaid) { handleResetTable(tableId, currentOrder.orderId); }
    };

    // 【新需求】加單按鈕
    const handleAddOrder = (e) => {
        e.stopPropagation();
        if (!isLoading) handleTableClick(tableId, 'idle', null);
    };

    return (
        <div className={`rounded-2xl shadow-lg overflow-hidden flex flex-col transition-all border-2 h-full bg-white ${orders.length === 0 ? 'border-gray-300' : statusInfo.borderColor}`}>
            
            {/* Header 區塊 - 保持原結構 */}
            <div 
                className={`px-3 py-1 text-white font-black flex flex-col justify-center gap-1 min-h-[60px] flex-shrink-0 ${statusInfo.color} cursor-pointer hover:brightness-95`}
                onClick={goToOrder}
            >
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1">
                            <h2 className="text-3xl font-mono tracking-tighter leading-none">{tableId}</h2>
                            {/* 【需求修正】加單按鈕 */}
                            <button onClick={handleAddOrder} className="p-0.5 bg-white/20 hover:bg-white/40 rounded ml-1">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                            </button>
                        </div>
                        {status !== 'idle' && (
                            <div className="flex flex-col text-[10px] font-mono leading-tight border-l border-white/30 pl-2 text-right">
                                <span className={isOverTime ? 'text-amber-200 animate-pulse' : ''}>{elapsed.display}</span>
                                <span>{currentOrder?.sendTime ? service.display : '-- min'}</span>
                            </div>
                        )}
                    </div>
                    {status !== 'idle' && (
                        <div className="flex items-center gap-2">
                            {/* 【需求修正】分頁指示點 */}
                            {orders.length > 1 && (
                                <div className="flex gap-1">
                                    {orders.map((_, i) => (
                                        <div key={i} className={`w-1.5 h-1.5 rounded-full ${i === currentIndex ? 'bg-white' : 'bg-white/40'}`} />
                                    ))}
                                </div>
                            )}
                            <button onClick={handleQuickReset} className="p-1 hover:bg-black/10 rounded-full transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" /></svg>
                            </button>
                        </div>
                    )}
                </div>

                {status !== 'idle' && status !== 'open' ? (
                    <div className="flex justify-between items-center border-t border-white/20 mt-0.5 pt-1 leading-none">
                        <div className="flex items-center gap-4 opacity-90 text-xs font-mono">
                            <div className="flex items-center gap-1">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                                <span>{orderIdDisplay}</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                                <span>{currentOrder?.customerCount ?? 0}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs font-mono">
                            <span className="opacity-80">{hasUnpaid ? '未結帳' : '已結帳'}</span>
                            <span className={`font-black ${hasUnpaid ? 'text-yellow-200' : 'text-white'}`}>${formatCurrency(hasUnpaid ? unpaidAmount : totalAmount)}</span>
                        </div>
                    </div>
                ) : (
                    <div className="mt-0.5 pt-1 h-[1.25rem]"></div>
                )}
            </div>

            {/* 【需求修正】中間主內容區改為滑動容器 */}
            <div 
                ref={scrollRef}
                onScroll={handleScroll}
                className="flex-grow flex overflow-x-auto snap-x snap-mandatory no-scrollbar cursor-pointer transition-colors hover:bg-gray-50/50 overflow-hidden"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                onClick={goToOrder}
            >
                {orders.length === 0 ? (
                    <div className="min-w-full flex items-center justify-center text-gray-300 font-bold">空閒中</div>
                ) : (
                    orders.map((order, idx) => (
                        <div key={order.orderId || idx} className="min-w-full h-full snap-start px-2 py-2 overflow-y-auto space-y-2">
                            {/* 內部品項清單與原本邏輯完全一致 */}
                            {order.status === 'open' ? (
                                <div className="h-full flex flex-col items-center justify-center rounded-xl border p-4 text-yellow-600 bg-yellow-50 border-yellow-100">
                                    <span className="text-sm font-bold">點餐中 / 尚未送單</span>
                                </div>
                            ) : order.items && order.items.length > 0 ? (
                                (() => {
                                    // 相同品項 + 相同備註合併顯示
                                    const displayItems = [];
                                    const mergedMap = new Map();
                                    for (const item of order.items) {
                                        const rKey = JSON.stringify((item.remarks || []).slice().sort());
                                        const key = `${item.id}:::${rKey}`;
                                        if (mergedMap.has(key)) {
                                            mergedMap.get(key).quantity += item.quantity;
                                        } else {
                                            const clone = { ...item };
                                            mergedMap.set(key, clone);
                                            displayItems.push(clone);
                                        }
                                    }
                                    return displayItems.map((item, itemIdx) => (
                                    <div key={item.internalId || item.id || itemIdx} className="group py-0.5" onClick={(e) => e.stopPropagation()}>
                                        <div className="flex items-center justify-between">
                                            <label className="flex items-center flex-grow cursor-pointer min-w-0">
                                                <input
                                                    type="checkbox"
                                                    checked={!!item.isServed}
                                                    disabled={isLoading}
                                                    onChange={() => handleToggleItemSentOnTable(tableId, order.orderId, item.internalId || item.id, !!item.isServed)}
                                                    className="w-5 h-5 rounded border-2 border-gray-300 text-green-600 cursor-pointer flex-shrink-0"
                                                />
                                                <span className={`ml-1.5 text-base font-bold truncate ${item.isServed ? 'text-gray-300 line-through' : 'text-gray-700'}`}>{item.name}</span>
                                            </label>
                                            <span className={`ml-1 text-sm font-black whitespace-nowrap ${item.isServed ? 'text-gray-300' : 'text-gray-500'}`}>x{item.quantity}</span>
                                        </div>
                                        {item.remarks && item.remarks.length > 0 && (
                                            <div className="flex flex-wrap gap-1 ml-6 mt-0.5">
                                                {item.remarks.map((r, ri) => (
                                                    <span key={ri} className="text-[9px] px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded-full font-bold border border-amber-200 leading-tight">{r}</span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    ));
                                })()
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center rounded-xl border p-4 text-red-400 bg-red-50 border-red-100">
                                    <span className="text-sm font-bold">⚠️ 訂單資料遺失</span>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
            
            {/* 底部按鈕區 - 保持原樣 */}
            <div className="p-3 bg-gray-50 border-t border-gray-100 flex-shrink-0">
                {shouldShowActionButton ? ( 
                    <button
                        onClick={handleActionButtonClick} 
                        disabled={isLoading}
                        className={`w-full py-3 text-white font-black rounded-xl shadow-lg active:scale-95 transition-all
                            ${status === 'paid' ? 'bg-[#5A7D85]' : (status === 'served' ? 'bg-[#2FB8B8]' : 'bg-yellow-600')}`}
                    >
                        {status === 'paid' ? '確認離開 (清桌)' : status === 'served' ? '尚未結帳 (去結帳)' : '繼續點餐'}
                    </button>
                ) : (
                    <button onClick={goToOrder} disabled={isLoading} className="w-full py-3 bg-blue-600 text-white font-black rounded-xl shadow-lg active:scale-95 transition-all">
                        開桌 / 點餐
                    </button>
                )}
            </div>
        </div>
    );
};

export default TableCard;