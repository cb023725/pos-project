// src/components/TableCard.js
import React, { useEffect, useState } from 'react';

// ----------------------------------------------------------------------
// 【輔助函式 A】正計時器邏輯
// ----------------------------------------------------------------------
const useTimer = (startTime) => {
    const [elapsedTime, setElapsedTime] = useState(0);
    
    useEffect(() => {
        if (!startTime) {
            setElapsedTime(0);
            return;
        }

        const start = new Date(startTime).getTime();
        if (isNaN(start)) {
            setElapsedTime(0);
            return;
        }
        
        const updateTimer = () => {
            const now = Date.now();
            const diff = Math.floor((now - start) / 1000); 
            setElapsedTime(Math.max(0, diff)); 
        };

        const intervalId = setInterval(updateTimer, 1000);
        updateTimer(); 

        return () => clearInterval(intervalId);
    }, [startTime]);

    const formatTime = (totalSeconds) => {
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `(${minutes}分${seconds < 10 ? '0' : ''}${seconds}秒)`;
    };

    return formatTime(elapsedTime);
};

// ----------------------------------------------------------------------
// 【輔助函式 B】獲取實際開桌時間
// ----------------------------------------------------------------------
const getDisplayStartTime = (startTime) => {
    if (!startTime) return '';
    const date = new Date(startTime);
    if (isNaN(date.getTime())) return '';
    
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
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
            return { label: '點餐中', color: 'bg-yellow-400', borderColor: 'border-yellow-400' };
        case 'served':
            // served: 已送單，可能部分結帳或完全未結帳 (尚未完全結清)
            return { label: '出餐中', color: 'bg-orange-500', borderColor: 'border-orange-500' };
        case 'paid': 
            // paid: 所有品項皆已結帳
            return { label: '💰出餐中', color: 'bg-teal-600', borderColor: 'border-teal-600' }; 
        default:
            return { label: '空桌', color: 'bg-gray-300', borderColor: 'border-gray-200' }; 
    }
};

// ----------------------------------------------------------------------
// 桌位卡片元件 (TableCard)
// ----------------------------------------------------------------------
const TableCard = ({ tableData, handleTableClick, handleToggleItemSentOnTable, handleResetTable, isLoading }) => {
    
    const { id: tableId, status = 'idle', order = null } = tableData;
    const statusInfo = mapOrderStatus(status); 
    
    const orderItems = order?.items || [];
    const totalAmount = order?.total || order?.subTotal || 0;
    const orderTimestamp = order?.timestamp || null;
    const elapsedTime = useTimer(orderTimestamp); 
    const displayStartTime = getDisplayStartTime(orderTimestamp); 

    /**
     * 【判斷顯示邏輯】
     */
    const isDetailedStatus = ['served', 'paid'].includes(status);
    const shouldShowItems = isDetailedStatus && orderItems.length > 0;

    // 定義核取方塊是否可點擊 (僅在 served/paid 狀態，且非讀取中時可操作)
    const canToggleItems = isDetailedStatus && !isLoading;
    
    // 檢查是否已**完全**結帳 (用於清桌)
    // 只有當 status === 'paid' 時，才視為完全結帳，可以清桌。
    const isFullyPaid = status === 'paid'; 
    
    // 實際可清桌的條件
    const canResetTable = isFullyPaid; 
    
    // 顯示按鈕的條件：非閒置狀態
    const shouldShowActionButton = status !== 'idle';


    /**
     * 處理底部按鈕點擊事件
     */
    const handleActionButtonClick = () => {
        if (isLoading) return;

        if (status === 'open') {
             // open 狀態：導向訂單/點餐
            handleTableClick(tableId, status, order);
            return;
        }

        if (status === 'served') {
            // served 狀態：尚未完全結帳，導向結帳頁面（無論部分或全部未結）
            
            handleTableClick(tableId, status, order); 
            return;
        } 
        
        if (status === 'paid') {
            // paid 狀態：執行清桌
            if (canResetTable) {
                handleResetTable(tableId);
            } else {
                 // 訂單狀態為 paid，但 canResetTable 為 false (邏輯上的防護)
                window.alert('訂單尚未完全結帳，無法清桌。');
                handleTableClick(tableId, status, order); 
            }
            return;
        }
    };


    return (
        <div 
            className={`rounded-2xl shadow-xl overflow-hidden flex flex-col transition-all border-4 h-full min-h-[380px] bg-white ${status === 'idle' ? 'border-gray-100' : statusInfo.borderColor}`}
        >
            {/* 頂部 Header */}
            <div 
                className={`p-3 text-white font-black flex justify-between items-center ${statusInfo.color} cursor-pointer hover:brightness-95`}
                onClick={() => handleTableClick(tableId, status, order)}
            >
                <h2 className="text-2xl font-mono tracking-tighter">{tableId}</h2>
                <span className="text-base font-bold">{statusInfo.label}</span>
            </div>

            {/* 中間主內容區 */}
            <div className="flex-grow p-4 flex flex-col">
                
                {status === 'idle' ? (
                    <div className="flex-grow flex items-center justify-center text-gray-400 font-bold italic">
                        空閒中
                    </div>
                ) : (
                    <>
                        {/* 頂部時間條 */}
                        <div className="mb-3 text-sm font-semibold border-b pb-2 border-gray-100 flex justify-between items-center"> 
                            <span className="text-gray-500 text-xs">開桌 {displayStartTime}</span>
                            <span className="text-blue-500 font-mono font-bold">{elapsedTime}</span>
                        </div>

                        {/* 品項列表區域 */}
                        <div className="flex-grow overflow-y-auto pr-1 mb-2 space-y-2 max-h-[180px]">
                            {shouldShowItems ? (
                                // 【正確顯示：品項清單】
                                orderItems.map((item, index) => {
                                    const itemUniqueId = item.internalId || item.id || `item-${index}`;
                                    // isSent 來自 TableManagement.js 的強制重設，或手動點擊
                                    const isSent = !!item.isSent; 

                                    return (
                                        <div key={itemUniqueId} className="flex items-center justify-between group py-0.5">
                                            <label className="flex items-center flex-grow cursor-pointer min-w-0">
                                                <input
                                                    type="checkbox"
                                                    checked={isSent} 
                                                    disabled={!canToggleItems}
                                                    // 點擊後，呼叫父元件函式，更新 isSent
                                                    onChange={() => handleToggleItemSentOnTable(tableId, order.orderId, itemUniqueId, isSent)}
                                                    className={`w-5 h-5 rounded border-2 border-gray-300 text-green-600 focus:ring-green-500 transition-all ${!canToggleItems ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                                                />
                                                <span className={`ml-3 truncate text-sm font-bold ${isSent ? 'text-gray-300 line-through' : 'text-gray-700'}`}>
                                                    {item.name}
                                                </span>
                                            </label>
                                            <span className={`ml-2 text-sm font-black ${isSent ? 'text-gray-300' : 'text-gray-500'}`}>
                                                x{item.quantity}
                                            </span>
                                        </div>
                                    );
                                })
                            ) : (
                                // 【判斷顯示何種提示】
                                <div className={`h-full flex flex-col items-center justify-center rounded-xl border p-4 ${status === 'open' ? 'text-yellow-600 bg-yellow-50 border-yellow-100' : 'text-red-400 bg-red-50 border-red-100'}`}>
                                    {status === 'open' ? (
                                        <span className="text-sm font-bold">點餐中 / 尚未送單</span>
                                    ) : (
                                        <div className="text-center">
                                            <span className="text-sm font-bold">⚠️ 訂單資料遺失</span>
                                            <p className="text-[10px] mt-1 opacity-70">請確認資料庫中此桌品項是否存在</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* 金額展示：隨狀態變化顏色 */}
                        <div className="mt-auto pt-2 border-t border-gray-100 flex justify-between items-end">
                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${isFullyPaid ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'}`}>
                                {isFullyPaid ? '已結帳' : '小計'}
                            </span>
                            <span className={`text-2xl font-black tracking-tight ${isFullyPaid ? 'text-purple-600' : 'text-red-600'}`}>
                                ${formatCurrency(totalAmount)}
                            </span>
                        </div>
                    </>
                )}
            </div>
            
            {/* 底部按鈕區 - 修正按鈕邏輯和標籤 */}
            <div className="p-3 bg-gray-50 border-t border-gray-100">
                {shouldShowActionButton ? ( 
                    <button
                        onClick={handleActionButtonClick} 
                        disabled={isLoading}
                        className={`w-full py-3 text-white font-black rounded-xl shadow-lg hover:brightness-110 active:scale-95 transition-all disabled:opacity-50
                            ${status === 'paid' ? 'bg-teal-600 hover:bg-teal-700' : (status === 'served' ? 'bg-red-500 hover:bg-red-600' : 'bg-yellow-600')}`
                        }
                    >
                        {status === 'paid' ? 
                            '確認離開 (清桌)' // 只有完全結帳 (paid) 才顯示清桌
                            : status === 'served' ?
                                '尚未結帳 (去結帳)' // served/部分結帳 狀態
                            : 
                                '繼續點餐' // open 狀態
                        }
                    </button>
                ) : (
                     // 閒置狀態按鈕
                    <button
                        onClick={() => handleTableClick(tableId, status, order)} 
                        disabled={isLoading}
                        className={`w-full py-3 bg-blue-600 text-white font-black rounded-xl shadow-lg hover:brightness-110 active:scale-95 transition-all disabled:opacity-50`}
                    >
                        開桌 / 點餐
                    </button>
                )}
            </div>
        </div>
    );
};

export default TableCard;