import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getActiveOrders, archiveTakeoutOrder } from '../db';

const formatOrderId = (order) => {
    if (!order) return '---';
    if (order.dailyOrderNo) return String(order.dailyOrderNo).padStart(3, '0');
    const id = order.id || order;
    if (!id) return '---';
    const s = String(id);
    return s.length > 3 ? s.slice(-3) : s.padStart(3, '0');
};

const formatCurrency = (n) => Math.round(n || 0).toLocaleString('en-US');

const formatClockTime = (timestamp) => {
    if (!timestamp) return '--:--';
    const d = new Date(typeof timestamp === 'number' ? timestamp : timestamp);
    if (isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
};

const STATUS_MAP = {
    open:   { dot: 'bg-yellow-400', label: '點餐中',  rowBg: 'bg-white' },
    served: { dot: 'bg-[#2FB8B8]',  label: '已送出',  rowBg: 'bg-white' },
    paid:   { dot: 'bg-[#5A7D85]',  label: '已結帳',  rowBg: 'bg-white' },
};

const getStatus = (s) => STATUS_MAP[s] || { dot: 'bg-gray-300', label: s, rowBg: 'bg-white' };

const TakeoutBagIcon = ({ size = 24, className = '' }) => (
    <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
        <line x1="3" y1="6" x2="21" y2="6"/>
        <path d="M16 10a4 4 0 01-8 0"/>
    </svg>
);

const TakeoutPage = () => {
    const navigate = useNavigate();
    const [orders, setOrders] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [swipedOrderId, setSwipedOrderId] = useState(null);

    // Long-press refs
    const longPressTimer = useRef(null);
    const didLongPress = useRef(false);

    // Swipe tracking refs
    const touchStartX = useRef(0);
    const touchStartY = useRef(0);

    const loadOrders = useCallback(async () => {
        try {
            const all = await getActiveOrders();
            const takeout = all
                .filter(o => o.table === '外帶')
                .sort((a, b) => a.id - b.id);
            setOrders(takeout);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { loadOrders(); }, [loadOrders]);

    const handleArchive = async (order) => {
        if (order.status === 'served') {
            // 尚未結帳 → 進入外帶 OrderPage（可在 OrderPage 棄單或結帳）
            setSwipedOrderId(null);
            navigate('/order', {
                state: {
                    isTakeout: true,
                    orderId: order.id,
                    initialTableNumber: '外帶',
                    orderStatus: order.status,
                    openTimestamp: order.timestamp ? new Date(order.timestamp).getTime() : Date.now(),
                    customerCount: order.customerCount || 1,
                    sendTime: order.sendTime || null,
                    dailyOrderNo: order.dailyOrderNo || null,
                }
            });
            return;
        }
        if (order.status !== 'paid') {
            alert(`訂單 ${formatOrderId(order)} 尚未完成結帳。\n請先完成結帳才能結案離店。`);
            setSwipedOrderId(null);
            return;
        }
        if (window.confirm(`確定將訂單 ${formatOrderId(order)}（${order.customerName || '無顧客資訊'}）標記為「已取餐離店」並結案？`)) {
            await archiveTakeoutOrder(order.id);
            setSwipedOrderId(null);
            await loadOrders();
        }
    };

    const handleRowClick = (order) => {
        // If a row is swiped open, close it instead of navigating
        if (swipedOrderId !== null) {
            setSwipedOrderId(null);
            return;
        }
        if (didLongPress.current) return;
        navigate('/order', {
            state: {
                isTakeout: true,
                orderId: order.id,
                initialTableNumber: '外帶',
                orderStatus: order.status,
                openTimestamp: order.timestamp ? new Date(order.timestamp).getTime() : Date.now(),
                customerCount: order.customerCount || 1,
                sendTime: order.sendTime || null,
                dailyOrderNo: order.dailyOrderNo || null,
            }
        });
    };

    // Long-press handlers
    const startLongPress = (e, order) => {
        didLongPress.current = false;
        longPressTimer.current = setTimeout(async () => {
            didLongPress.current = true;
            await handleArchive(order);
        }, 600);
    };

    const cancelLongPress = () => {
        clearTimeout(longPressTimer.current);
    };

    const handleMouseUp = () => {
        cancelLongPress();
        // reset after click event fires
        setTimeout(() => { didLongPress.current = false; }, 0);
    };

    // Swipe handlers
    const handleTouchStart = (e, order) => {
        touchStartX.current = e.touches[0].clientX;
        touchStartY.current = e.touches[0].clientY;
        startLongPress(e, order);
    };

    const handleTouchMove = (e) => {
        const dx = e.touches[0].clientX - touchStartX.current;
        const dy = e.touches[0].clientY - touchStartY.current;
        // Cancel long press if moved
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) cancelLongPress();
    };

    const handleTouchEnd = (e, order) => {
        cancelLongPress();
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        const dy = e.changedTouches[0].clientY - touchStartY.current;
        if (Math.abs(dx) > Math.abs(dy) * 1.5) {
            if (dx < -50) {
                // Left swipe → open
                e.preventDefault();
                setSwipedOrderId(order.id);
                return;
            } else if (dx > 30 && swipedOrderId === order.id) {
                // Right swipe → close
                e.preventDefault();
                setSwipedOrderId(null);
                return;
            }
        }
        setTimeout(() => { didLongPress.current = false; }, 0);
    };

    return (
        <div className="h-[100dvh] w-full flex flex-col bg-gray-50 font-sans overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 bg-[#2FB8B8] text-white px-4 py-3 flex items-center justify-between shadow-md">
                <div className="flex items-center space-x-3">
                    <button onClick={() => navigate('/tables')} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M15 19l-7-7 7-7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                    <TakeoutBagIcon size={26} />
                    <h1 className="text-xl font-black">外帶管理</h1>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={loadOrders} className="p-2 rounded-lg hover:bg-white/20 transition-colors" title="重新整理">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                    <button
                        onClick={() => navigate('/order', { state: { isTakeout: true, forceNew: true } })}
                        className="bg-white text-[#2FB8B8] font-black px-4 py-2 rounded-xl flex items-center space-x-1.5 hover:bg-gray-50 transition-colors shadow"
                    >
                        <span className="text-lg leading-none">+</span>
                        <span>新增外帶單</span>
                    </button>
                </div>
            </div>

            {/* Column headers */}
            <div className="flex-shrink-0 bg-gray-100 px-4 py-1.5 grid grid-cols-12 gap-2 text-[11px] font-black text-gray-500 uppercase tracking-wide border-b border-gray-300">
                <div className="col-span-1 text-center">#</div>
                <div className="col-span-2">單號</div>
                <div className="col-span-2">顧客資訊</div>
                <div className="col-span-2">餐具</div>
                <div className="col-span-3">時間</div>
                <div className="col-span-2 text-right pr-4">金額</div>
            </div>

            {/* Order list */}
            <div className="flex-grow overflow-y-auto">
                {isLoading ? (
                    <div className="h-full flex items-center justify-center">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#2FB8B8]"></div>
                    </div>
                ) : orders.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400">
                        <TakeoutBagIcon size={56} className="mb-3 text-gray-300" />
                        <p className="text-lg font-bold">目前沒有外帶訂單</p>
                        <button
                            onClick={() => navigate('/order', { state: { isTakeout: true, forceNew: true } })}
                            className="mt-4 bg-[#2FB8B8] text-white font-black px-6 py-2.5 rounded-xl hover:opacity-90 transition-opacity"
                        >
                            + 新增外帶單
                        </button>
                    </div>
                ) : (
                    orders.map((order, index) => {
                        const st = getStatus(order.status);
                        const total = order.total || order.items?.reduce((s, i) => s + i.price * i.quantity, 0) || 0;
                        const openTime = formatClockTime(order.timestamp);
                        const pickupTimeDisplay = order.pickupTime ? formatClockTime(order.pickupTime) : null;
                        const isPickupOverdue = order.pickupTime && order.pickupTime < Date.now() && order.status !== 'paid';
                        const isSwiped = swipedOrderId === order.id;

                        return (
                            <div key={order.id} className="relative overflow-hidden border-b border-gray-200">
                                {/* Swipe-reveal button */}
                                <div
                                    className={`absolute right-0 top-0 bottom-0 flex items-center transition-all duration-200 ${isSwiped ? 'w-24' : 'w-0'}`}
                                >
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleArchive(order); }}
                                        className={`w-full h-full text-white font-black text-sm flex flex-col items-center justify-center gap-0.5
                                            ${order.status === 'served' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-green-500 hover:bg-green-600'}`}
                                    >
                                        {order.status === 'served' ? (
                                            <>
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M9 18l6-6-6-6"/>
                                                </svg>
                                                <span className="text-xs">尚未結帳</span>
                                            </>
                                        ) : (
                                            <>
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M20 6L9 17l-5-5"/>
                                                </svg>
                                                <span>離店</span>
                                            </>
                                        )}
                                    </button>
                                </div>

                                {/* Main row */}
                                <div
                                    onClick={() => handleRowClick(order)}
                                    onMouseDown={(e) => startLongPress(e, order)}
                                    onMouseUp={handleMouseUp}
                                    onMouseLeave={cancelLongPress}
                                    onTouchStart={(e) => handleTouchStart(e, order)}
                                    onTouchMove={handleTouchMove}
                                    onTouchEnd={(e) => handleTouchEnd(e, order)}
                                    style={{ transform: isSwiped ? 'translateX(-96px)' : 'translateX(0)', transition: 'transform 0.2s ease' }}
                                    className={`grid grid-cols-12 gap-2 px-4 py-3 cursor-pointer items-center select-none ${st.rowBg} hover:bg-gray-50`}
                                >
                                    {/* # 排序 */}
                                    <div className="col-span-1 text-center">
                                        <span className="text-2xl font-black text-gray-300 leading-none">{index + 1}</span>
                                    </div>

                                    {/* 單號 + 狀態 */}
                                    <div className="col-span-2 flex flex-col">
                                        <span className="text-xl font-black text-gray-800 leading-none">{formatOrderId(order)}</span>
                                        <span className="inline-flex items-center mt-1">
                                            <span className={`w-2 h-2 rounded-full mr-1 flex-shrink-0 ${st.dot}`}></span>
                                            <span className="text-[11px] text-gray-500 font-bold">{st.label}</span>
                                        </span>
                                    </div>

                                    {/* 顧客資訊 */}
                                    <div className="col-span-2 flex flex-col justify-center min-w-0">
                                        {order.customerName ? (
                                            <>
                                                <span className="text-base font-black text-gray-800 truncate">{order.customerName}</span>
                                                {order.customerPhone && (
                                                    <span className="text-xs text-gray-500 font-bold truncate">{order.customerPhone}</span>
                                                )}
                                            </>
                                        ) : (
                                            <span className="text-sm text-gray-400 italic">無資訊</span>
                                        )}
                                    </div>

                                    {/* 餐具 */}
                                    <div className="col-span-2 flex items-center">
                                        {order.needsUtensils ? (
                                            <span className="text-[11px] text-orange-500 font-bold flex items-center gap-0.5">
                                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg>
                                                需餐具
                                            </span>
                                        ) : (
                                            <span className="text-[11px] text-gray-400 font-bold flex items-center gap-0.5">
                                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg>
                                                不需餐具
                                            </span>
                                        )}
                                    </div>

                                    {/* 時間：點餐 + 取餐 */}
                                    <div className="col-span-3 flex flex-col text-xs font-bold text-gray-500 space-y-1">
                                        <span className="flex items-center space-x-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block flex-shrink-0"></span>
                                            <span className="text-gray-400">點餐</span>
                                            <span>{openTime}</span>
                                        </span>
                                        {pickupTimeDisplay ? (
                                            <span className={`flex items-center space-x-1 ${isPickupOverdue ? 'text-red-500 animate-pulse font-black' : ''}`}>
                                                <span className={`w-1.5 h-1.5 rounded-full inline-block flex-shrink-0 ${isPickupOverdue ? 'bg-red-500' : 'bg-orange-400'}`}></span>
                                                <span className={isPickupOverdue ? 'text-red-400' : 'text-gray-400'}>取餐</span>
                                                <span>{pickupTimeDisplay}</span>
                                            </span>
                                        ) : (
                                            <span className="flex items-center space-x-1 text-gray-300">
                                                <span className="w-1.5 h-1.5 rounded-full bg-gray-200 inline-block flex-shrink-0"></span>
                                                <span>未設取餐</span>
                                            </span>
                                        )}
                                    </div>

                                    {/* 金額 + 箭頭 */}
                                    <div className="col-span-2 flex items-center justify-end space-x-1">
                                        <span className="text-base font-black text-gray-800">${formatCurrency(total)}</span>
                                        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path d="M9 5l7 7-7 7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Footer hint */}
            <div className="flex-shrink-0 bg-white border-t border-gray-200 px-4 py-2 flex justify-center">
                <span className="text-xs text-gray-400 font-bold">向左滑或長按訂單可快速操作</span>
            </div>
        </div>
    );
};

export default TakeoutPage;
