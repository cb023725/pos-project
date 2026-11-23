// src/pages/NianfaiOrder.js — 年菜點單頁（修正單 #01 第 5 節）
// 取代舊的 NianfaiModal 彈窗。版面比照一般點單頁：左側工作區、右側品項卡片。
// 兩步流程：「確認訂購」保留流水號、印顧客聯（不含訂購人資料）；
// 「結帳」才真的成立訂單/發票，資料待補，交給年菜佇列頁處理（Phase D）。
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
    getNianfaiItems, getSettingValue,
    confirmNianfaiReservation, abandonNianfaiReservation, checkoutNianfaiReservation,
} from '../db';
import MenuCard from '../components/MenuCard';
import useNianfaiSeason from '../hooks/useNianfaiSeason';

const BUNDLE_MAX = 8;
const SINGLE_MAX = 9;
const SHIPPING_FEE = 160;
const FREE_SHIPPING_THRESHOLD = 3000;

const NianfaiOrderPage = () => {
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
        getNianfaiItems(year).then(setItems).catch(() => setItems([]));
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

    const setItemQty = (item, value) => {
        const max = item.bundleComposition ? BUNDLE_MAX : SINGLE_MAX;
        if (value > max) {
            setCapNotice(`「${item.name}」已達上限 ${max} 份，超過請先在表單送出後，到「表單回應」直接修改數量（不拆單）`);
            return;
        }
        const current = qty[item.id] || 0;
        if (item.soldOut && current === 0 && value > current) {
            if (!window.confirm(`「${item.name}」已停售，確定要加入嗎？`)) return;
        }
        setCapNotice('');
        setQty(prev => ({ ...prev, [item.id]: Math.max(0, value) }));
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

    const handleCancelOrder = async () => {
        if (!window.confirm('確定要取消這筆訂購嗎？已保留的流水號會記為放棄。')) return;
        if (reservationId) {
            try { await abandonNianfaiReservation(reservationId); } catch (e) { /* 放棄失敗不擋使用者清空畫面 */ }
        }
        resetOrder();
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
        alert(`結帳完成！流水號 ${label}\n\n請讓客人在存根聯上填寫姓名/電話等資料，稍後到「年菜佇列」頁補登。`);
        resetOrder();
    };

    const handleCheckout = async () => {
        setError('');
        if (isDirty) { setError('購物車內容已變更，請重新按「確認訂購」並重印顧客聯後才能結帳'); return; }
        setCheckingOut(true);
        try {
            await doCheckout(false);
        } catch (e) {
            if (e.code === 'FORM_CLOSED') {
                if (window.confirm(`${e.message || '年菜表單已關閉'}\n\n確定要繼續結帳嗎？`)) {
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
        <div className="p-6 min-h-screen bg-gray-50 flex gap-6">
            {/* 左側工作區 */}
            <div className="w-[340px] flex-shrink-0 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-black text-gray-800">🧧 年菜點單 {year}</h2>
                    <Link to="/tables" className="text-sm text-gray-400 hover:text-gray-600">返回桌位</Link>
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
                            className="w-full border border-gray-300 rounded-lg p-2.5">
                            <option value="">請選擇取貨日</option>
                            {pickupDates.map(d => <option key={d} value={d}>{d}</option>)}
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
                        <div className="space-y-1.5 max-h-60 overflow-y-auto">
                            {cartItems.map(it => (
                                <div key={it.id} className="flex items-center justify-between text-sm">
                                    <span className="font-bold text-gray-700 truncate">{it.name} × {it.quantity}</span>
                                    <span className="text-gray-500 flex-shrink-0 ml-2">${(it.price * it.quantity).toLocaleString('en-US')}</span>
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
                                    <MenuCard item={item} onAddItem={() => setItemQty(item, q + 1)} onLongPress={() => setItemQty(item, q - 1)} allowOverride />
                                </div>
                            </div>
                        );
                    })}
                    {items.length === 0 && <p className="col-span-full text-gray-400 text-center py-10">目前沒有年菜品項，請先到菜單管理設定</p>}
                </div>
            </div>
        </div>
    );
};

export default NianfaiOrderPage;
