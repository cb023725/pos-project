// src/pages/NianfaiOrder.js — 年菜點單頁（修正單 #01 第 5 節）
// 取代舊的 NianfaiModal 彈窗。版面比照一般點單頁：左側工作區、右側品項卡片。
// 兩步流程：「確認訂購」保留流水號、印顧客聯（不含訂購人資料）；
// 「結帳」才真的成立訂單/發票，資料待補，結帳完回到年菜佇列頁補登。
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    getNianfaiItems, getSettingValue,
    confirmNianfaiReservation, abandonNianfaiReservation, checkoutNianfaiReservation,
} from '../db';
import MenuCard from '../components/MenuCard';
import useDialog from '../components/useDialog';
import useNianfaiSeason from '../hooks/useNianfaiSeason';
import { formatPickupDate } from '../utils/nianfaiDate';

const BUNDLE_MAX = 8;
const SINGLE_MAX = 9;
const SHIPPING_FEE = 160;
const FREE_SHIPPING_THRESHOLD = 3000;

// 卡片排列：套餐一律在最前面（左上角第一個），其餘照菜單管理的排序（sort_order）
const sortForCards = (list) => list.slice().sort((a, b) =>
    (!!b.bundleComposition - !!a.bundleComposition) || ((a.sortOrder ?? 99) - (b.sortOrder ?? 99)));

// 套餐只顯示品名本體（「富貴套餐：五菜一湯 (六人份)」→「富貴套餐」），
// 只影響畫面顯示，資料庫品名與收據不變（品名是對應表單欄位的依據，不能改）
const cardName = (item) => item.bundleComposition ? item.name.split(/[：:]/)[0].trim() : item.name;

const NianfaiOrderPage = () => {
    const navigate = useNavigate();
    const { dialog, showAlert, showConfirm } = useDialog();
    const { year, status } = useNianfaiSeason();
    const [items, setItems] = useState([]);
    const [qty, setQty] = useState({});
    const [deliveryMethod, setDeliveryMethod] = useState('pickup');
    const [pickupDate, setPickupDate] = useState('');
    const [pickupDates, setPickupDates] = useState([]);
    const [deliveryPeriod, setDeliveryPeriod] = useState('');
    const [capNotice, setCapNotice] = useState('');
    const [error, setError] = useState('');

    const [reservationId, setReservationId] = useState(null);
    const [seqLabel, setSeqLabel] = useState('');
    const [confirmedSnapshot, setConfirmedSnapshot] = useState(null);
    const [confirming, setConfirming] = useState(false);
    const [checkingOut, setCheckingOut] = useState(false);

    useEffect(() => {
        if (!year) return;
        getNianfaiItems(year).then(list => setItems(sortForCards(list))).catch(() => setItems([]));
        getSettingValue(`nianfai_${year}_pickup_dates`, '[]').then(v => {
            try { setPickupDates(JSON.parse(v) || []); } catch { setPickupDates([]); }
        });
        getSettingValue(`nianfai_${year}_delivery_period`, '').then(setDeliveryPeriod);
    }, [year]);

    const cartItems = useMemo(() =>
        items.filter(it => (qty[it.id] || 0) > 0).map(it => ({ ...it, quantity: qty[it.id] })),
    [items, qty]);

    const subtotal = cartItems.reduce((s, it) => s + (it.price || 0) * it.quantity, 0);
    const shippingFee = deliveryMethod === 'delivery' && subtotal > 0 && subtotal < FREE_SHIPPING_THRESHOLD ? SHIPPING_FEE : 0;
    const total = subtotal + shippingFee;

    // 目前購物車+取貨方式+取貨日的快照，跟最後一次「確認訂購」的快照比對，
    // 不一致就代表客人在結帳前又改了內容，要求重新確認訂購（防呆，見第 5 節）
    const currentSnapshot = useMemo(() => JSON.stringify({
        items: cartItems.map(it => ({ id: it.id, qty: it.quantity })).sort((a, b) => a.id.localeCompare(b.id)),
        deliveryMethod, pickupDate,
    }), [cartItems, deliveryMethod, pickupDate]);
    const isDirty = !reservationId || currentSnapshot !== confirmedSnapshot;

    // 數量調整（卡片點擊、已選購的 −／＋ 共用）：超過上限擋下，減到 0 就從已選購移除
    const setItemQty = async (item, value) => {
        const max = item.bundleComposition ? BUNDLE_MAX : SINGLE_MAX;
        if (value > max) {
            setCapNotice(`「${cardName(item)}」已達上限 ${max} 份，超過請先在表單送出後，到「表單回應」直接修改數量（不拆單）`);
            return;
        }
        const current = qty[item.id] || 0;
        if (item.soldOut && current === 0 && value > current) {
            const ok = await showConfirm(`「${cardName(item)}」已停售，確定要加入嗎？`, { title: '已停售品項', confirmText: '仍要加入', danger: true });
            if (!ok) return;
        }
        setCapNotice('');
        setQty(prev => {
            const next = { ...prev };
            if (value <= 0) delete next[item.id]; else next[item.id] = value;
            return next;
        });
    };

    // 套餐在收據上要展開組成明細（修正單第 5 節：品項「套餐列出組成」）
    const buildPrintItems = useCallback(() => cartItems.map(it => {
        if (!it.bundleComposition) return { name: it.name, price: it.price, quantity: it.quantity };
        const bundleComponents = it.bundleComposition.map(c => {
            const sub = items.find(i => i.id === c.itemId);
            return { name: sub?.name || c.itemId, qty: c.qty };
        });
        return { name: it.name, price: it.price, quantity: it.quantity, bundleComponents };
    }), [cartItems, items]);

    const resetOrder = () => {
        setQty({}); setDeliveryMethod('pickup'); setPickupDate('');
        setReservationId(null); setSeqLabel(''); setConfirmedSnapshot(null);
        setError(''); setCapNotice('');
    };

    const abandonReservation = async () => {
        if (!reservationId) return;
        try { await abandonNianfaiReservation(reservationId); } catch (e) { /* 放棄失敗不擋使用者離開 */ }
    };

    const handleCancelOrder = async () => {
        const ok = await showConfirm(
            reservationId ? `確定要取消這筆訂購嗎？\n已保留的流水號 ${seqLabel} 會記為放棄。` : '確定要清空這筆訂購嗎？',
            { title: '取消本單', confirmText: '取消本單', cancelText: '繼續點單', danger: true });
        if (!ok) return;
        await abandonReservation();
        resetOrder();
    };

    // 返回：已確認訂購（保留了流水號、印了顧客聯）但還沒結帳 → 提醒，確定就記為放棄；
    // 還沒確認訂購 → 這筆訂單視為不曾存在，直接離開
    const handleGoBack = async () => {
        if (reservationId) {
            const ok = await showConfirm(
                `流水號 ${seqLabel} 已確認訂購、尚未結帳。\n返回後這筆訂購會取消，流水號記為放棄。`,
                { title: '尚未結帳', confirmText: '放棄並返回', cancelText: '繼續點單', danger: true });
            if (!ok) return;
            await abandonReservation();
        }
        navigate('/nianfai-queue');
    };

    const handleConfirmOrder = async () => {
        setError('');
        if (cartItems.length === 0) { setError('請至少選擇一項品項'); return; }
        if (deliveryMethod === 'pickup' && !pickupDate) { setError('請選擇取貨日'); return; }
        setConfirming(true);
        try {
            const payload = {
                reservationId: reservationId || undefined,
                year, deliveryMethod, pickupDate: deliveryMethod === 'pickup' ? pickupDate : null, total,
                items: cartItems.map(it => ({ id: it.id, name: it.name, price: it.price, quantity: it.quantity })),
            };
            const result = await confirmNianfaiReservation(payload);
            const label = `${year}-${String(result.seqNo).padStart(3, '0')}`;
            setReservationId(result.reservationId);
            setSeqLabel(label);
            setConfirmedSnapshot(currentSnapshot);

            fetch('/print', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    printMode: 'nianfai-confirm', seqLabel: label,
                    deliveryMethod, pickupDate, deliveryPeriod,
                    items: buildPrintItems(), subtotal, shippingFee, total,
                }),
            }).catch(e => console.warn('年菜顧客聯列印失敗：', e));
        } catch (e) {
            setError(`確認訂購失敗：${e.message}`);
        } finally {
            setConfirming(false);
        }
    };

    const doCheckout = async (override) => {
        const result = await checkoutNianfaiReservation(reservationId, { override });
        const label = `${year}-${String(result.seqNo).padStart(3, '0')}`;
        fetch('/print', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                printMode: 'nianfai-stub', seqLabel: label,
                deliveryMethod, items: buildPrintItems(), total: result.total,
            }),
        }).catch(e => console.warn('年菜存根聯列印失敗：', e));
        resetOrder();
        await showAlert(`流水號 ${label}\n\n請讓客人在存根聯上填寫姓名、電話等資料，稍後在年菜訂單佇列補登。`, { title: '結帳完成' });
        navigate('/nianfai-queue');
    };

    const handleCheckout = async () => {
        setError('');
        if (isDirty) { setError('購物車內容已變更，請重新按「確認訂購」並重印顧客聯後才能結帳'); return; }
        setCheckingOut(true);
        try {
            await doCheckout(false);
        } catch (e) {
            if (e.code === 'FORM_CLOSED') {
                const ok = await showConfirm(`${e.message || '年菜表單已關閉'}\n\n確定要繼續結帳嗎？`, { title: '表單已關閉', confirmText: '繼續結帳', danger: true });
                if (ok) {
                    try { await doCheckout(true); } catch (e2) { setError(`結帳失敗：${e2.message}`); }
                }
            } else {
                setError(`結帳失敗：${e.message}`);
            }
        } finally {
            setCheckingOut(false);
        }
    };

    if (!year || status === 'archived') {
        return (
            <div className="p-8 text-center text-gray-400">
                目前沒有進行中的年菜活動。
                <Link to="/nianfai-admin" className="text-[#4A9A7A] font-bold ml-2">前往年菜管理頁</Link>
            </div>
        );
    }

    return (
        <div className="p-4 min-h-screen bg-gray-50 flex gap-4">
            {/* 左側工作區 */}
            <div className="w-[360px] flex-shrink-0 flex flex-col gap-3">
                {/* 標題列：左上角返回（比照一般點單頁） */}
                <div className="bg-[#C1032F] text-white rounded-xl px-2 py-2 flex items-center gap-2 shadow">
                    <button onClick={handleGoBack} className="p-1.5 rounded-full hover:bg-white/15 transition-colors" title="返回年菜訂單">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                    <h2 className="text-xl font-black">🧧 年菜點單 {year}</h2>
                    {seqLabel && <span className="ml-auto text-sm font-black bg-white/20 rounded-lg px-2 py-0.5">{seqLabel}</span>}
                </div>

                <div className="bg-white rounded-xl shadow p-4">
                    <h3 className="font-bold text-gray-700 mb-2">取貨方式</h3>
                    <div className="flex gap-2 mb-3">
                        <button onClick={() => { setDeliveryMethod('pickup'); setPickupDate(''); }}
                            className={`flex-1 py-2.5 rounded-xl font-bold transition-colors ${deliveryMethod === 'pickup' ? 'bg-[#4A9A7A] text-white' : 'bg-gray-100 text-gray-600'}`}>自取</button>
                        <button onClick={() => { setDeliveryMethod('delivery'); setPickupDate(''); }}
                            className={`flex-1 py-2.5 rounded-xl font-bold transition-colors ${deliveryMethod === 'delivery' ? 'bg-[#4A9A7A] text-white' : 'bg-gray-100 text-gray-600'}`}>宅配</button>
                    </div>
                    {deliveryMethod === 'pickup' ? (
                        <select value={pickupDate} onChange={e => setPickupDate(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg p-2.5 text-base">
                            <option value="">請選擇取貨日</option>
                            {pickupDates.map(d => <option key={d} value={d}>{formatPickupDate(d)}</option>)}
                        </select>
                    ) : (
                        <p className="text-sm text-gray-500">寄出期間：{deliveryPeriod || '（尚未設定，請到年菜管理頁設定）'}</p>
                    )}
                </div>

                <div className="bg-white rounded-xl shadow p-4">
                    <h3 className="font-bold text-gray-700 mb-2">已選購</h3>
                    {cartItems.length === 0 ? (
                        <p className="text-gray-300 text-sm text-center py-4">尚未選擇品項</p>
                    ) : (
                        <div className="divide-y divide-gray-100 max-h-[42vh] overflow-y-auto">
                            {cartItems.map(it => (
                                <div key={it.id} className="flex items-center justify-between py-2 gap-2">
                                    <span className="font-bold text-lg text-gray-800 leading-tight min-w-0 break-words">{cardName(it)}</span>
                                    {/* 數量控制：比照一般點單頁，− 減到 0 就刪除 */}
                                    <div className="flex flex-col items-end flex-shrink-0">
                                        <div className="flex items-center gap-1.5">
                                            <button onClick={() => setItemQty(it, it.quantity - 1)}
                                                className="w-7 h-7 bg-black/5 text-gray-700 rounded-full hover:bg-gray-300 flex items-center justify-center text-base font-bold shadow-sm">-</button>
                                            <span className="text-xl font-black text-gray-800 w-6 text-center">{it.quantity}</span>
                                            <button onClick={() => setItemQty(it, it.quantity + 1)}
                                                className="w-7 h-7 bg-black/5 text-gray-700 rounded-full hover:bg-gray-300 flex items-center justify-center text-base font-bold shadow-sm">+</button>
                                        </div>
                                        <span className="text-xs font-black text-gray-700 pr-1">${(it.price * it.quantity).toLocaleString('en-US')}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    {capNotice && <p className="text-orange-500 font-bold text-xs mt-2">{capNotice}</p>}
                    <div className="border-t border-gray-100 mt-3 pt-3 space-y-1 text-sm">
                        <div className="flex justify-between text-gray-500"><span>小計</span><span>${subtotal.toLocaleString('en-US')}</span></div>
                        {shippingFee > 0 && <div className="flex justify-between text-gray-500"><span>運費</span><span>${shippingFee}</span></div>}
                        <div className="flex justify-between text-lg font-black text-gray-800 pt-1"><span>總額</span><span>${total.toLocaleString('en-US')}</span></div>
                    </div>
                </div>

                {seqLabel && (
                    <div className={`rounded-xl p-3 text-sm font-bold ${isDirty ? 'bg-orange-50 text-orange-600' : 'bg-green-50 text-green-700'}`}>
                        {isDirty
                            ? `流水號 ${seqLabel} 已保留，但內容已變更——請重新按「確認訂購」`
                            : `流水號 ${seqLabel} 已確認，可以結帳`}
                    </div>
                )}
                {error && <p className="text-red-500 font-bold text-sm">{error}</p>}

                <div className="space-y-2">
                    <div className="flex gap-2">
                        <button onClick={handleConfirmOrder} disabled={confirming || cartItems.length === 0}
                            className="flex-1 py-3 rounded-xl bg-gray-700 text-white font-black disabled:opacity-50">
                            {confirming ? '處理中...' : reservationId ? '重新確認並重印' : '確認訂購（印顧客聯）'}
                        </button>
                        <button onClick={handleCheckout} disabled={checkingOut || isDirty}
                            className="flex-1 py-3 rounded-xl bg-[#D47856] text-white font-black disabled:opacity-50">
                            {checkingOut ? '處理中...' : '結帳（印存根聯）'}
                        </button>
                    </div>
                    {(cartItems.length > 0 || reservationId) && (
                        <button onClick={handleCancelOrder} className="w-full py-2 rounded-xl bg-white border border-gray-200 text-gray-400 font-bold text-sm hover:bg-gray-50">
                            取消本單
                        </button>
                    )}
                </div>
            </div>

            {/* 右側品項卡片 */}
            <div className="flex-grow">
                <div className="grid grid-cols-4 gap-3">
                    {items.map(item => {
                        const q = qty[item.id] || 0;
                        const isBundle = !!item.bundleComposition;
                        return (
                            <div key={item.id} className="relative">
                                {q > 0 && (
                                    <span className="absolute -top-2 -right-2 z-30 min-w-[26px] h-[26px] px-1.5 rounded-full bg-[#D47856] text-white text-sm font-black flex items-center justify-center shadow-lg">
                                        {q}
                                    </span>
                                )}
                                {/* 年菜三角標籤 */}
                                <span className="absolute top-0 left-0 z-20 w-0 h-0 border-t-[28px] border-r-[28px] border-t-[#C1032F] border-r-transparent rounded-tl-xl pointer-events-none" />
                                <span className="absolute top-1 left-1 z-20 text-white text-[11px] font-black pointer-events-none">年</span>
                                {isBundle && (
                                    <span className="absolute top-1 right-1 z-20 bg-[#C1032F] text-white text-[10px] font-black px-1.5 py-0.5 rounded pointer-events-none">套餐</span>
                                )}
                                <div className={isBundle ? 'ring-4 ring-[#C1032F] rounded-xl' : ''}>
                                    <MenuCard item={isBundle ? { ...item, name: cardName(item) } : item} onAddItem={() => setItemQty(item, q + 1)} onLongPress={() => setItemQty(item, q - 1)} allowOverride hideStock />
                                </div>
                            </div>
                        );
                    })}
                    {items.length === 0 && <p className="col-span-full text-gray-400 text-center py-10">目前沒有年菜品項，請先到菜單管理設定</p>}
                </div>
            </div>
            {dialog}
        </div>
    );
};

export default NianfaiOrderPage;
