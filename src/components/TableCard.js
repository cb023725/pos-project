// src/components/TableCard.js
import React, { useEffect, useState } from 'react';

// ----------------------------------------------------------------------
// 【輔助函式 A】正計時器邏輯
// ----------------------------------------------------------------------
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
    return `${elapsedMinutes} min`;
};

// ----------------------------------------------------------------------
// 【輔助函式 C】金額格式化
// ----------------------------------------------------------------------
const formatCurrency = (number) => {
    const roundedNumber = Math.round(number || 0);
    return roundedNumber.toLocaleString('en-US'); 
};

// ----------------------------------------------------------------------
// 【輔助函式 D】映射顯示樣式
// ----------------------------------------------------------------------
const mapOrderStatus = (status) => {
    switch (status) {
        case 'open':
            return { color: 'bg-yellow-400', borderColor: 'border-yellow-400' };
        case 'served':
            return { color: 'bg-[#2FB8B8]', borderColor: 'border-[#2FB8B8]' };
        case 'paid': 
            return { color: 'bg-[#5A7D85]', borderColor: 'border-[#5A7D85]' }; 
        default:
            return { color: 'bg-gray-300', borderColor: 'border-gray-200' }; 
    }
};

const TableCard = ({ tableData, handleTableClick, handleToggleItemSentOnTable, handleResetTable, isLoading }) => {
    const { id: tableId, status = 'idle', order = null } = tableData;
    const statusInfo = mapOrderStatus(status); 
    const orderItems = order?.items || [];
    
    // --- 【修正】僅顯示未結帳金額之邏輯 ---
    const unpaidAmount = orderItems.reduce((acc, item) => {
        return !item.isPaid ? acc + ((item.price || 0) * (item.quantity || 0)) : acc;
    }, 0);
    const hasUnpaid = unpaidAmount > 0;
    const totalAmount = order?.total || order?.subTotal || 0;
    // ----------------------------------

    const orderIdDisplay = order?.orderId 
        ? order.orderId.toString().slice(-3).padStart(3, '0') 
        : '000';
    
    const openTimestamp = order?.timestamp || null;
    const sendTime = order?.sendTime || null;
    const elapsedTimeDisplay = useTimer(openTimestamp); 
    const serviceTimeDisplay = useTimer(sendTime); 

    const isDetailedStatus = ['served', 'paid'].includes(status);
    const shouldShowItems = isDetailedStatus && orderItems.length > 0;
    const canToggleItems = isDetailedStatus && !isLoading;
    const isFullyPaid = status === 'paid'; 
    const isUnpaid = status === 'served' || status === 'open';
    const shouldShowActionButton = status !== 'idle';

    const goToOrder = () => { if (!isLoading) handleTableClick(tableId, status, order); };

    const handleQuickReset = (e) => {
        e.stopPropagation();
        if (isLoading) return;
        if (isUnpaid && window.confirm('⚠️ 確定要執行清桌嗎？')) {
            handleResetTable(tableId);
        } else if (!isUnpaid) {
            handleResetTable(tableId);
        }
    };

    const handleActionButtonClick = (e) => {
        e.stopPropagation();
        if (isLoading) return;
        if (isUnpaid) { goToOrder(); } 
        else if (isFullyPaid) { handleResetTable(tableId); }
    };

    return (
        /* 外層容器固定高度 h-[350px] */
        // 將 h-[350px] 改為 h-full
<div className={`rounded-2xl shadow-lg overflow-hidden flex flex-col transition-all border-4 h-full bg-white ${status === 'idle' ? 'border-gray-100' : statusInfo.borderColor}`}>
            
            {/* Header 區塊 - 固定高度不縮放 flex-shrink-0 */}
            <div 
                className={`px-3 py-1 text-white font-black flex flex-col justify-center gap-1 min-h-[60px] flex-shrink-0 ${statusInfo.color} cursor-pointer hover:brightness-95`}
                onClick={goToOrder}
            >
                {/* 第一列：桌號與計時 */}
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <h2 className="text-3xl font-mono tracking-tighter leading-none">{tableId}</h2>
                        {status !== 'idle' && (
                            <div className="flex flex-col text-[10px] font-mono leading-tight border-l border-white/30 pl-2 text-right">
                                <span>{elapsedTimeDisplay}</span>
                                <span>{sendTime ? serviceTimeDisplay : '-- min'}</span>
                            </div>
                        )}
                    </div>
                    {status !== 'idle' && (
                        <button onClick={handleQuickReset} className="p-1 hover:bg-black/10 rounded-full transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
                            </svg>
                        </button>
                    )}
                </div>

                {/* 第二列：單號與金額狀態 (修正：status 為 open 時不顯示金額區域) */}
                {status !== 'idle' && status !== 'open' ? (
                    <div className="flex justify-between items-center border-t border-white/20 mt-0.5 pt-1 leading-none">
                        <div className="flex items-center gap-1 opacity-90 text-xs font-mono">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                                <line x1="16" y1="13" x2="8" y2="13"></line>
                                <line x1="16" y1="17" x2="8" y2="17"></line>
                            </svg>
                            <span>{orderIdDisplay}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs font-mono">
                            <span className="opacity-80">{hasUnpaid ? '未結帳' : '已結帳'}</span>
                            <span className={`font-black ${hasUnpaid ? 'text-yellow-200' : 'text-white'}`}>
                                ${formatCurrency(hasUnpaid ? unpaidAmount : totalAmount)}
                            </span>
                        </div>
                    </div>
                ) : (
                    /* open 狀態下渲染空 div 佔位以保持 border-t 效果不存在但高度結構一致 */
                    <div className="mt-0.5 pt-1 h-[1.25rem]"></div>
                )}
            </div>

            {/* 中間主內容區 */}
            <div className={`flex-grow px-2 py-2 flex flex-col cursor-pointer transition-colors hover:bg-gray-50/50 overflow-hidden`} onClick={goToOrder}>
                {status === 'idle' ? (
                    <div className="flex-grow flex items-center justify-center text-gray-400 font-bold italic">空閒中</div>
                ) : (
                    <div className="flex-grow overflow-y-auto px-1 space-y-2">
                        {shouldShowItems ? (
                            orderItems.map((item, index) => {
                                const itemUniqueId = item.internalId || item.id || `item-${index}`;
                                const isSent = !!item.isSent; 
                                return (
                                    <div key={itemUniqueId} className="flex items-center justify-between group py-0.5" onClick={(e) => e.stopPropagation()}>
                                        <label className="flex items-center flex-grow cursor-pointer min-w-0">
                                            <input
                                                type="checkbox"
                                                checked={isSent} 
                                                disabled={!canToggleItems}
                                                onChange={() => handleToggleItemSentOnTable(tableId, order.orderId, itemUniqueId, isSent)}
                                                className={`w-5 h-5 rounded border-2 border-gray-300 text-green-600 focus:ring-green-500 transition-all ${!canToggleItems ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                                            />
                                            <span className={`ml-1.5 text-sm font-bold flex-grow overflow-hidden ${isSent ? 'text-gray-300 line-through' : 'text-gray-700'}`}>
                                                {item.name}
                                            </span>
                                        </label>
                                        <span className={`ml-1 text-sm font-black whitespace-nowrap ${isSent ? 'text-gray-300' : 'text-gray-500'}`}>x{item.quantity}</span>
                                    </div>
                                );
                            })
                        ) : (
                            <div className={`h-full flex flex-col items-center justify-center rounded-xl border p-4 ${status === 'open' ? 'text-yellow-600 bg-yellow-50 border-yellow-100' : 'text-red-400 bg-red-50 border-red-100'}`}>
                                <span className="text-sm font-bold">{status === 'open' ? '點餐中 / 尚未送單' : '⚠️ 訂單資料遺失'}</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
            
            {/* 底部按鈕區 */}
            <div className="p-3 bg-gray-50 border-t border-gray-100 flex-shrink-0">
                {shouldShowActionButton ? ( 
                    <button
                        onClick={handleActionButtonClick} 
                        disabled={isLoading}
                        className={`w-full py-3 text-white font-black rounded-xl shadow-lg hover:brightness-110 active:scale-95 transition-all disabled:opacity-50
                            ${status === 'paid' ? 'bg-[#5A7D85]' : (status === 'served' ? 'bg-[#2FB8B8]' : 'bg-yellow-600')}`}
                    >
                        {status === 'paid' ? '確認離開 (清桌)' : status === 'served' ? '尚未結帳 (去結帳)' : '繼續點餐'}
                    </button>
                ) : (
                    <button onClick={(e) => { e.stopPropagation(); goToOrder(); }} disabled={isLoading} className="w-full py-3 bg-blue-600 text-white font-black rounded-xl shadow-lg hover:brightness-110 active:scale-95 transition-all">
                        開桌 / 點餐
                    </button>
                )}
            </div>
        </div>
    );
};

export default TableCard;