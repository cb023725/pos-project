// src/components/TableCard.js
import React, { useEffect, useState, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';

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
        case 'open': return { color: 'bg-yellow-400', borderColor: 'border-yellow-400', dotColor: 'bg-yellow-400' };
        case 'served': return { color: 'bg-[#2FB8B8]', borderColor: 'border-[#2FB8B8]', dotColor: 'bg-[#2FB8B8]' };
        case 'paid': return { color: 'bg-[#6888A8]', borderColor: 'border-[#6888A8]', dotColor: 'bg-[#6888A8]' };
        default: return { color: 'bg-gray-200', borderColor: 'border-gray-100', dotColor: 'bg-gray-300' };
    }
};

const TableCard = ({
    tableData,
    handleTableClick,
    handleToggleItemSentOnTable,
    handleResetTable,
    onMoveRequest,
    onMergeRequest,
    onMoveToTakeout,
    isLoading,
}) => {
    const { id: tableId, orders = [] } = tableData;
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isGearOpen, setIsGearOpen] = useState(false);
    const [gearMenuPos, setGearMenuPos] = useState({ top: 0, left: 0 });
    const [isNoteOpen, setIsNoteOpen] = useState(false);
    const [notePos, setNotePos] = useState({ top: 0, left: 0 });
    const scrollRef = useRef(null);
    const gearRef = useRef(null);
    const menuRef = useRef(null);
    const noteRef = useRef(null);
    const notePopoverRef = useRef(null);

    useEffect(() => { setCurrentIndex(0); }, [orders.length]);

    // 處理左右滑動索引
    const handleScroll = (e) => {
        const width = e.target.offsetWidth;
        if (width > 0) {
            const newIndex = Math.round(e.target.scrollLeft / width);
            if (newIndex !== currentIndex) setCurrentIndex(newIndex);
        }
    };

    const currentOrder = orders[currentIndex] || null;
    const status = currentOrder?.status || 'idle';
    const orderItems = currentOrder?.items || [];

    const unpaidAmount = orderItems.reduce((acc, item) => !item.isPaid ? acc + ((item.price || 0) * (item.quantity || 0)) : acc, 0);
    const hasUnpaid = unpaidAmount > 0;
    // 若 DB status 為 paid 但仍有未結帳品項（合併後情況），顯示 served 顏色
    const effectiveStatus = (status === 'paid' && hasUnpaid) ? 'served' : status;
    const statusInfo = mapOrderStatus(effectiveStatus);
    const totalAmount = currentOrder?.total || currentOrder?.subTotal || 0;

    const orderIdDisplay = currentOrder?.dailyOrderNo
        ? String(currentOrder.dailyOrderNo).padStart(3, '0')
        : currentOrder?.orderId
            ? currentOrder.orderId.toString().slice(-3).padStart(3, '0')
            : '000';

    const elapsed = useTimer(currentOrder?.timestamp);
    const service = useTimer(currentOrder?.sendTime);
    const isOverTime = elapsed.val >= 90;

    const isFullyPaid = effectiveStatus === 'paid';
    const isUnpaid = effectiveStatus === 'served' || effectiveStatus === 'open';
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

    // ── 齒輪選單 ──────────────────────────────────────────────
    useEffect(() => {
        if (!isGearOpen) return;
        const close = (e) => {
            const inGear = gearRef.current?.contains(e.target);
            const inMenu = menuRef.current?.contains(e.target);
            if (!inGear && !inMenu) setIsGearOpen(false);
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('touchstart', close);
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); };
    }, [isGearOpen]);

    const handleGearClick = (e) => {
        e.stopPropagation();
        if (!isLoading) {
            if (isGearOpen) {
                setIsGearOpen(false);
            } else {
                const rect = gearRef.current.getBoundingClientRect();
                setGearMenuPos({ top: rect.bottom + 4, left: rect.left });
                setIsGearOpen(true);
            }
        }
    };

    // ── 特殊備註 popover ──────────────────────────────────────
    useEffect(() => {
        if (!isNoteOpen) return;
        const close = (e) => {
            const inIcon = noteRef.current?.contains(e.target);
            const inPopover = notePopoverRef.current?.contains(e.target);
            if (!inIcon && !inPopover) setIsNoteOpen(false);
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('touchstart', close);
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); };
    }, [isNoteOpen]);

    const handleNoteClick = (e) => {
        e.stopPropagation();
        if (isNoteOpen) {
            setIsNoteOpen(false);
        } else {
            const rect = noteRef.current.getBoundingClientRect();
            setNotePos({ top: rect.bottom + 4, left: rect.left });
            setIsNoteOpen(true);
        }
    };

    const handleAddOrderFromGear = (e) => {
        e.stopPropagation();
        setIsGearOpen(false);
        if (!isLoading) handleTableClick(tableId, 'idle', null);
    };

    const handleMoveFromGear = (e) => {
        e.stopPropagation();
        setIsGearOpen(false);
        if (!isLoading && currentOrder && onMoveRequest) onMoveRequest(tableId, currentOrder);
    };

    const handleMergeFromGear = (e) => {
        e.stopPropagation();
        setIsGearOpen(false);
        if (!isLoading && currentOrder && onMergeRequest) onMergeRequest(tableId, currentOrder, orders);
    };

    const handleMoveToTakeoutFromGear = (e) => {
        e.stopPropagation();
        setIsGearOpen(false);
        if (!isLoading && currentOrder && onMoveToTakeout) onMoveToTakeout(tableId, currentOrder);
    };

    return (
        <div
            className={`rounded-2xl shadow-lg overflow-hidden flex flex-col transition-all border-2 h-full bg-white
                ${orders.length === 0 ? 'border-gray-300' : statusInfo.borderColor}`}
        >
            {/* Header 區塊 */}
            <div
                className={`px-3 py-1 text-white font-black flex flex-col justify-center gap-1 min-h-[60px] flex-shrink-0 ${statusInfo.color} cursor-pointer hover:brightness-95`}
                onClick={goToOrder}
            >
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1">
                            <h2 className="text-3xl font-mono tracking-tighter leading-none">{tableId}</h2>
                            {/* 齒輪選單 */}
                            <div className="ml-1 flex items-center" ref={gearRef} onTouchStart={(e) => e.stopPropagation()}>
                                <button onClick={handleGearClick} className="p-1 bg-white/20 hover:bg-white/40 rounded">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                                </button>
                            </div>
                            {/* 特殊備註（有備註才顯示） */}
                            {currentOrder?.specialNotes?.length > 0 && (
                                <div className="ml-1 flex items-center" ref={noteRef} onTouchStart={(e) => e.stopPropagation()}>
                                    <button onClick={handleNoteClick} className="p-1 bg-amber-400 hover:bg-amber-300 rounded text-red-700">
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                                        </svg>
                                    </button>
                                </div>
                            )}
                        </div>
                        {status !== 'idle' && (
                            <div className="flex flex-col text-[8px] font-mono leading-tight border-l border-white/30 pl-1 text-right whitespace-nowrap">
                                <span className={isOverTime ? 'text-amber-200 animate-pulse' : ''}>{elapsed.display}</span>
                                <span>{currentOrder?.sendTime ? service.display : '-- min'}</span>
                            </div>
                        )}
                    </div>
                    {status !== 'idle' && (
                        <button onClick={handleQuickReset} className="p-1 hover:bg-black/10 rounded-full transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" /></svg>
                        </button>
                    )}
                </div>

                {status !== 'idle' && status !== 'open' ? (
                    <div className="flex justify-between items-center border-t border-white/20 mt-0.5 pt-1 leading-none">
                        <div className="flex items-center gap-2 opacity-90 text-xs font-mono">
                            <div className="flex items-center gap-1">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                                <span>{orderIdDisplay}</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                                <span>{currentOrder?.customerCount ?? 0}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-1 text-xs font-mono whitespace-nowrap">
                            <span className="opacity-80">{hasUnpaid ? '未結' : ''}</span>
                            <span className={`font-black ${hasUnpaid ? 'text-yellow-200' : 'text-white'}`}>${formatCurrency(hasUnpaid ? unpaidAmount : totalAmount)}</span>
                        </div>
                    </div>
                ) : (
                    <div className="mt-0.5 pt-1 h-[1.25rem]"></div>
                )}
            </div>

            {/* 中間主內容區（橫向滑動） + 分頁點 overlay */}
            <div className="flex-grow relative min-h-0 overflow-hidden">
                <div
                    ref={scrollRef}
                    onScroll={handleScroll}
                    className="absolute inset-0 flex overflow-x-auto snap-x snap-mandatory no-scrollbar cursor-pointer transition-colors hover:bg-gray-50/50"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                    onClick={goToOrder}
                >
                    {orders.length === 0 ? (
                        <div className="min-w-full flex items-center justify-center text-gray-300 font-bold">空閒中</div>
                    ) : (
                        orders.map((order, idx) => (
                            <div key={order.orderId || idx} className="min-w-full h-full snap-start px-2 py-2 overflow-y-auto space-y-2">
                                {order.status === 'open' ? (
                                    <div className="h-full flex flex-col items-center justify-center rounded-xl border p-4 text-yellow-600 bg-yellow-50 border-yellow-100">
                                        <span className="text-sm font-bold">點餐中 / 尚未送單</span>
                                    </div>
                                ) : order.items && order.items.length > 0 ? (
                                    (() => {
                                        const mergeKey = (item) => `${item.id}:::${JSON.stringify((item.remarks || []).slice().sort())}:::${item.isTakeoutPortion ? 'T' : ''}`;
                                        const displayItems = [];
                                        const mergedMap = new Map();
                                        const groupIdsMap = new Map(); // key → [internalId, ...]
                                        for (const item of order.items) {
                                            const key = mergeKey(item);
                                            if (!groupIdsMap.has(key)) groupIdsMap.set(key, []);
                                            groupIdsMap.get(key).push(item.internalId || item.id);
                                            if (mergedMap.has(key)) {
                                                const existing = mergedMap.get(key);
                                                existing.quantity += item.quantity;
                                                existing.isServed = existing.isServed && !!item.isServed;
                                            } else {
                                                const clone = { ...item, isServed: !!item.isServed };
                                                mergedMap.set(key, clone);
                                                displayItems.push(clone);
                                            }
                                        }
                                        return displayItems.map((item, itemIdx) => {
                                            const groupIds = groupIdsMap.get(mergeKey(item)) || [item.internalId || item.id];
                                            return (
                                            <div key={item.internalId || item.id || itemIdx} className="group py-0.5" onClick={(e) => e.stopPropagation()}>
                                                <div className="flex items-center justify-between">
                                                    <label className="flex items-center flex-grow cursor-pointer min-w-0">
                                                        <input
                                                            type="checkbox"
                                                            checked={!!item.isServed}
                                                            disabled={isLoading}
                                                            onChange={() => handleToggleItemSentOnTable(tableId, order.orderId, groupIds, !!item.isServed)}
                                                            className="w-5 h-5 rounded border-2 border-gray-300 text-green-600 cursor-pointer flex-shrink-0"
                                                        />
                                                        <span className={`ml-1.5 text-base font-bold truncate ${item.isServed ? 'text-gray-300 line-through' : 'text-gray-700'}`}>{item.name}</span>
                                                        {item.isTakeoutPortion && (
                                                            <span className="ml-1 text-[9px] font-bold text-teal-700 bg-teal-100 rounded px-1 py-0.5 flex-shrink-0">外帶</span>
                                                        )}
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
                                            );
                                        });
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
                {orders.length > 1 && (
                    <div className="absolute bottom-1 left-0 right-0 flex justify-center items-center gap-1.5 pointer-events-none">
                        {orders.map((_, i) => (
                            <div key={i} className={`rounded-full transition-all opacity-50 ${i === currentIndex ? `w-3 h-1.5 ${statusInfo.dotColor}` : 'w-1.5 h-1.5 bg-gray-400'}`} />
                        ))}
                    </div>
                )}
            </div>

            {/* 底部按鈕區 */}
            <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 flex-shrink-0">
                {shouldShowActionButton ? (
                    <button
                        onClick={handleActionButtonClick}
                        disabled={isLoading}
                        className={`w-full py-2 text-white font-black rounded-xl shadow-lg active:scale-95 transition-all
                            ${effectiveStatus === 'paid' ? 'bg-[#6888A8]' : (effectiveStatus === 'served' ? 'bg-[#2FB8B8]' : 'bg-yellow-600')}`}
                    >
                        {effectiveStatus === 'paid' ? '確認離開' : effectiveStatus === 'served' ? '尚未結帳' : '繼續點餐'}
                    </button>
                ) : (
                    <button onClick={goToOrder} disabled={isLoading} className="w-full py-2 bg-blue-600 text-white font-black rounded-xl shadow-lg active:scale-95 transition-all">
                        開桌
                    </button>
                )}
            </div>

            {/* 齒輪選單 Portal（渲染到 body，完全脫離 overflow-hidden） */}
            {isGearOpen && ReactDOM.createPortal(
                <div
                    ref={menuRef}
                    style={{ position: 'fixed', top: gearMenuPos.top, left: gearMenuPos.left, zIndex: 9999 }}
                    className="bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden min-w-[110px]"
                >
                    <button onClick={handleAddOrderFromGear} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-bold text-gray-700 hover:bg-[#4A9A7A]/10 hover:text-[#4A9A7A] transition-colors whitespace-nowrap">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        新增訂單
                    </button>
                    {orders.length > 0 && currentOrder && (
                        <button onClick={handleMoveFromGear} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-bold text-gray-700 hover:bg-amber-50 hover:text-amber-700 transition-colors whitespace-nowrap border-t border-gray-100">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 9l4-4 4 4"/><path d="M9 5v14"/><path d="M19 15l-4 4-4-4"/><path d="M15 19V5"/></svg>
                            換桌
                        </button>
                    )}
                    {orders.length > 0 && currentOrder && onMoveToTakeout && (
                        <button onClick={handleMoveToTakeoutFromGear} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-bold text-gray-700 hover:bg-[#2FB8B8]/10 hover:text-[#2FB8B8] transition-colors whitespace-nowrap border-t border-gray-100">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
                            換到外帶
                        </button>
                    )}
                    {orders.length > 1 && currentOrder?.orderId && (
                        <button onClick={handleMergeFromGear} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-bold text-gray-700 hover:bg-green-50 hover:text-green-700 transition-colors whitespace-nowrap border-t border-gray-100">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>
                            合併訂單
                        </button>
                    )}
                </div>,
                document.body
            )}

            {/* 特殊備註 Popover（渲染到 body，完全脫離 overflow-hidden） */}
            {isNoteOpen && ReactDOM.createPortal(
                <div
                    ref={notePopoverRef}
                    style={{ position: 'fixed', top: notePos.top, left: notePos.left, zIndex: 9999 }}
                    className="bg-white rounded-xl shadow-2xl border border-amber-300 overflow-hidden min-w-[160px] max-w-[240px] p-3"
                >
                    <div className="text-[11px] font-bold text-amber-700 mb-1.5">特殊備註</div>
                    <div className="flex flex-col gap-1">
                        {currentOrder?.specialNotes?.map((note, idx) => (
                            <div key={idx} className="text-sm font-bold text-gray-800 leading-snug break-words">
                                {note}
                            </div>
                        ))}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default TableCard;
