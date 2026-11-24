// src/pages/NianfaiOrder.js — 年菜點單頁（修正單 #01 第 5 節）
// 取代舊的 NianfaiModal 彈窗。版面比照一般點單頁：左側工作區、右側品項卡片。
// 兩步流程：「確認訂購」保留流水號、印顧客聯（不含訂購人資料）；
// 「結帳」才真的成立訂單/發票，資料待補，結帳完回到年菜佇列頁補登。
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
    getNianfaiItems, getSettingValue,
    confirmNianfaiReservation, abandonNianfaiReservation, checkoutNianfaiReservation, getNianfaiReservation,
} from '../db';
import MenuCard from '../components/MenuCard';
import useDialog from '../components/useDialog';
import useNianfaiSeason from '../hooks/useNianfaiSeason';
import { formatPickupDate, formatNianfaiSeq, nianfaiDisplayName } from '../utils/nianfai';

const BUNDLE_MAX = 8;
const SINGLE_MAX = 9;
const SHIPPING_FEE = 160;
const FREE_SHIPPING_THRESHOLD = 3000;

// 卡片排列：套餐一律在最前面（左上角第一個），其餘照菜單管理的排序（sort_order）
const sortForCards = (list) => list.slice().sort((a, b) =>
    (!!b.bundleComposition - !!a.bundleComposition) || ((a.sortOrder ?? 99) - (b.sortOrder ?? 99)));

// 套餐只顯示「富貴套餐」，卡片與購物車前面加紅包 emoji 提醒（只在畫面上，收據不加）
const cardName = (item) => item.bundleComposition ? `🧧 ${nianfaiDisplayName(item)}` : item.name;

// 購物車品名（套餐帶紅包 emoji）
const CartItemName = ({ item }) => cardName(item);

// 購物車＋取貨方式＋取貨日的快照，跟最後一次「確認訂購」比對（防呆，見第 5 節）
const makeSnapshot = (qtyMap, deliveryMethod, pickupDate) => JSON.stringify({
    items: Object.entries(qtyMap).filter(([, q]) => q > 0).map(([id, q]) => ({ id, qty: q })).sort((a, b) => a.id.localeCompare(b.id)),
    deliveryMethod, pickupDate: pickupDate || '',
});

// 已確認訂購、尚未結帳的保留單號記在本機：不管用什麼方式離開（重新整理、切到其他頁面），
// 回到點單頁都會還原，流水號不會卡在「保留中」找不回來
const ACTIVE_RESERVATION_KEY = 'nianfai_active_reservation';
const rememberReservation = (id) => { try { localStorage.setItem(ACTIVE_RESERVATION_KEY, String(id)); } catch { /* 本機儲存不可用就略過 */ } };
const forgetReservation = () => { try { localStorage.removeItem(ACTIVE_RESERVATION_KEY); } catch { /* 略過 */ } };
const storedReservation = () => { try { return localStorage.getItem(ACTIVE_RESERVATION_KEY); } catch { return null; } };

const NianfaiOrderPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { dialog, showAlert, showConfirm } = useDialog();
    const { year, status } = useNianfaiSeason();
    const [items, setItems] = useState([]);
    const [qty, setQty] = useState({});
    // 點餐順序：從卡片點進來時記一個遞增序號，購物車照序號由新到舊排列（最新點的在最上面）
    const [addSeq, setAddSeq] = useState({});
    const seqCounter = useRef(0);
    const cartListRef = useRef(null);
    const [hiddenBelow, setHiddenBelow] = useState(0); // 購物車捲軸下方還藏著幾項
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
    const [resumeNotice, setResumeNotice] = useState('');

    useEffect(() => {
        if (!year) return;
        getNianfaiItems(year).then(list => setItems(sortForCards(list))).catch(() => setItems([]));
        getSettingValue(`nianfai_${year}_pickup_dates`, '[]').then(v => {
            try { setPickupDates(JSON.parse(v) || []); } catch { setPickupDates([]); }
        });
        getSettingValue(`nianfai_${year}_delivery_period`, '').then(setDeliveryPeriod);
    }, [year]);

    // 還原保留中的單：佇列頁按「繼續點單」帶進來的，或本機記住的上一張未結帳單
    useEffect(() => {
        if (!year) return;
        const fromQueue = location.state?.resumeReservationId;
        const resumeId = fromQueue || storedReservation();
        if (!resumeId) return;
        let cancelled = false;
        getNianfaiReservation(resumeId).then(r => {
            if (cancelled) return;
            if (r.status !== 'reserved' || r.year !== year) { forgetReservation(); return; }
            const qtyMap = {};
            const seqMap = {};
            r.items.forEach((it, i) => { qtyMap[it.id] = it.quantity; seqMap[it.id] = r.items.length - i; });
            seqCounter.current = r.items.length;
            setAddSeq(seqMap);
            const pd = r.deliveryMethod === 'pickup' ? (r.pickupDate || '') : '';
            const label = formatNianfaiSeq(r.year, r.seqNo);
            setQty(qtyMap); setDeliveryMethod(r.deliveryMethod); setPickupDate(pd);
            setReservationId(r.id); setSeqLabel(label);
            setConfirmedSnapshot(makeSnapshot(qtyMap, r.deliveryMethod, pd));
            rememberReservation(r.id);
            setResumeNotice(`已還原尚未結帳的訂單 ${label}，可以直接結帳、修改後重新確認，或取消本單。`);
        }).catch(() => forgetReservation());
        if (fromQueue) navigate(location.pathname, { replace: true, state: null });
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [year]);

    const cartItems = useMemo(() =>
        items.filter(it => (qty[it.id] || 0) > 0)
            .map(it => ({ ...it, quantity: qty[it.id] }))
            .sort((a, b) => (addSeq[b.id] || 0) - (addSeq[a.id] || 0)),
    [items, qty, addSeq]);

    // 購物車捲軸下方還有幾項沒露出來：底部顯示漸層＋「還有 N 項」，避免藏在捲軸下被忽略
    const updateHiddenBelow = useCallback(() => {
        const el = cartListRef.current;
        if (!el) return;
        const bottom = el.getBoundingClientRect().bottom;
        const rows = el.querySelectorAll('[data-cart-row]');
        let n = 0;
        rows.forEach(row => { if (row.getBoundingClientRect().bottom > bottom + 2) n += 1; });
        setHiddenBelow(n);
    }, []);
    useEffect(() => { updateHiddenBelow(); }, [cartItems, updateHiddenBelow]);
    useEffect(() => {
        window.addEventListener('resize', updateHiddenBelow);
        return () => window.removeEventListener('resize', updateHiddenBelow);
    }, [updateHiddenBelow]);

    const subtotal = cartItems.reduce((s, it) => s + (it.price || 0) * it.quantity, 0);
    const shippingFee = deliveryMethod === 'delivery' && subtotal > 0 && subtotal < FREE_SHIPPING_THRESHOLD ? SHIPPING_FEE : 0;
    const total = subtotal + shippingFee;

    // 目前購物車+取貨方式+取貨日的快照，跟最後一次「確認訂購」的快照比對，
    // 不一致就代表客人在結帳前又改了內容，要求重新確認訂購（防呆，見第 5 節）
    const currentSnapshot = useMemo(() => makeSnapshot(qty, deliveryMethod, pickupDate), [qty, deliveryMethod, pickupDate]);
    const isDirty = !reservationId || currentSnapshot !== confirmedSnapshot;

    // 數量調整（卡片點擊、購物車的 −／＋ 共用）：超過上限擋下，減到 0 就從購物車移除
    const setItemQty = async (item, value, { bump = false } = {}) => {
        const max = item.bundleComposition ? BUNDLE_MAX : SINGLE_MAX;
        if (value > max) {
            setCapNotice(`「${cardName(item)}」已達上限 ${max} 份，超過請先在表單送出後，到「表單回應」直接修改數量（不拆單）`);
            return;
        }
        const current = qty[item.id] || 0;
        if (item.soldOut && current === 0 && value > current) {
            const ok = await showConfirm(`「${nianfaiDisplayName(item)}」已停售`, { title: '仍要加入嗎？', icon: 'warning', confirmText: '仍要加入', danger: true });
            if (!ok) return;
        }
        setCapNotice('');
        if (bump && value > current) {
            seqCounter.current += 1;
            const seq = seqCounter.current;
            setAddSeq(prev => ({ ...prev, [item.id]: seq }));
            cartListRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); // 新點的在最上面，捲回頂端讓它看得到
        }
        setQty(prev => {
            const next = { ...prev };
            if (value <= 0) delete next[item.id]; else next[item.id] = value;
            return next;
        });
    };

    // 套餐在收據上要展開組成明細（修正單第 5 節：品項「套餐列出組成」）
    // 收據照菜單順序（套餐在最上面），不跟購物車「最新在上」的畫面順序
    const buildPrintItems = useCallback(() => items.filter(it => (qty[it.id] || 0) > 0).map(it => ({ ...it, quantity: qty[it.id] })).map(it => {
        if (!it.bundleComposition) return { name: it.name, price: it.price, quantity: it.quantity };
        const bundleComponents = it.bundleComposition.map(c => {
            const sub = items.find(i => i.id === c.itemId);
            return { name: sub?.name || c.itemId, qty: c.qty };
        });
        return { name: it.name, price: it.price, quantity: it.quantity, bundleComponents };
    }), [items, qty]);

    // 一鍵清空購物車：只清品項，不動已保留的流水號（要放棄整張單用「取消本單」）
    const handleClearCart = async () => {
        const ok = await showConfirm('購物車內的品項會全部移除', { title: '清空購物車', icon: 'danger', confirmText: '清空', danger: true });
        if (!ok) return;
        setQty({}); setAddSeq({}); setCapNotice('');
    };

    const resetOrder = () => {
        setQty({}); setAddSeq({}); setDeliveryMethod('pickup'); setPickupDate('');
        setReservationId(null); setSeqLabel(''); setConfirmedSnapshot(null);
        setError(''); setCapNotice(''); setResumeNotice('');
        forgetReservation();
    };

    const abandonReservation = async () => {
        forgetReservation();
        if (!reservationId) return;
        try { await abandonNianfaiReservation(reservationId); } catch (e) { /* 放棄失敗不擋使用者離開 */ }
    };

    const handleCancelOrder = async () => {
        const ok = await showConfirm(
            reservationId ? `流水號 ${seqLabel} 將記為放棄` : '這筆訂購會清空',
            { title: '取消本單', icon: 'danger', confirmText: '取消本單', cancelText: '繼續點單', danger: true });
        if (!ok) return;
        await abandonReservation();
        resetOrder();
    };

    // 返回：已確認訂購（保留了流水號、印了顧客聯）但還沒結帳 → 提醒，確定就記為放棄；
    // 還沒確認訂購 → 這筆訂單視為不曾存在，直接離開
    const handleGoBack = async () => {
        if (reservationId) {
            const ok = await showConfirm(
                `流水號 ${seqLabel} 已確認、尚未結帳`,
                { title: '尚未結帳', icon: 'warning', note: '返回後此單取消，流水號記為放棄', confirmText: '放棄並返回', cancelText: '繼續點單', danger: true });
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
            const label = formatNianfaiSeq(year, result.seqNo);
            setReservationId(result.reservationId);
            setSeqLabel(label);
            setConfirmedSnapshot(currentSnapshot);
            rememberReservation(result.reservationId);

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
        const label = formatNianfaiSeq(year, result.seqNo);
        fetch('/print', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                printMode: 'nianfai-stub', seqLabel: label,
                deliveryMethod, items: buildPrintItems(), total: result.total,
            }),
        }).catch(e => console.warn('年菜存根聯列印失敗：', e));
        resetOrder();
        await showAlert(`流水號 ${label}\n請客人在存根聯填寫資料，稍後補登`, { title: '結帳完成', icon: 'success', confirmText: '前往年菜訂單' });
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
                const ok = await showConfirm('年菜表單已關閉（已達停售上限）', { title: '仍要結帳嗎？', icon: 'warning', confirmText: '繼續結帳', danger: true });
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

    // 版面比照內用／外帶點單頁：整頁固定高度（跟著 Layout 的 100dvh 容器，iPad Safari 扣掉工具列也不會超出），左側工作區（30%）只有購物車清單捲動，
    // 標題列、取貨方式、金額與按鈕固定不動；右側品項區（70%）自己捲動
    return (
        <div className="flex w-full h-full overflow-hidden font-sans">
            <div className="flex flex-grow p-2 bg-gray-50 h-full">

                {/* 左側工作區 */}
                <div className="w-[30%] flex flex-col bg-white rounded-xl overflow-hidden mr-2 h-full">
                    {/* 標題列：左上角返回（比照一般點單頁） */}
                    <div className="flex-shrink-0 p-1.5 bg-[#C1032F] text-white flex items-center gap-1">
                        <button onClick={handleGoBack} className="text-white hover:bg-white/10 p-0.5 rounded-full transition-colors" title="返回年菜訂單">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </button>
                        <h2 className="text-xl font-black">{year} 年菜訂單</h2>
                        {seqLabel && <span className="ml-auto text-sm font-black bg-white/20 rounded-lg px-2 py-0.5">{seqLabel}</span>}
                    </div>

                    {/* 購物車標題：只放購物車 icon；右側清空在前、數量在後 */}
                    <div className="flex-shrink-0 px-3 pt-2 pb-1 flex items-center justify-between border-b border-gray-100">
                        <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-label="購物車">
                            <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
                            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                        </svg>
                        <div className="flex items-center gap-2">
                            {cartItems.length > 0 && (
                                <button onClick={handleClearCart}
                                    className="flex items-center gap-1 text-xs font-bold text-red-500 bg-red-50 hover:bg-red-100 px-2 py-1 rounded-lg">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                                    清空
                                </button>
                            )}
                            <span className="text-xs font-bold text-gray-400">共 {cartItems.reduce((n, it) => n + it.quantity, 0)} 份</span>
                        </div>
                    </div>

                    {/* 購物車清單（唯一會捲動的區塊）；下方還有品項時顯示漸層與提示 */}
                    <div className="flex-grow min-h-0 relative">
                    <div ref={cartListRef} onScroll={updateHiddenBelow} className="h-full overflow-y-auto px-3 pb-6">
                        {cartItems.length === 0 ? (
                            <p className="text-gray-300 text-sm text-center py-8">尚未選擇品項</p>
                        ) : (
                            <div className="divide-y divide-gray-100">
                                {cartItems.map(it => (
                                    <div key={it.id} data-cart-row className="flex items-center justify-between py-2 gap-2">
                                        <span className="font-bold text-lg text-gray-800 leading-tight min-w-0 break-words"><CartItemName item={it} /></span>
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
                        {capNotice && <p className="text-orange-500 font-bold text-xs py-2">{capNotice}</p>}
                    </div>
                    {hiddenBelow > 0 && (
                        <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-white via-white/80 to-transparent pointer-events-none flex items-end justify-center pb-1">
                            <span className="text-xs font-black text-white bg-gray-500/90 rounded-full px-3 py-0.5 shadow">▼ 下方還有 {hiddenBelow} 項</span>
                        </div>
                    )}
                    </div>

                    {/* 取貨方式（固定在購物車下方） */}
                    <div className="flex-shrink-0 px-3 py-2 border-t border-gray-200">
                        <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-bold text-gray-700 text-sm flex-shrink-0 whitespace-nowrap">取貨方式</h3>
                            <button onClick={() => { setDeliveryMethod('pickup'); setPickupDate(''); }}
                                className={`flex-1 min-w-0 py-2 rounded-xl font-bold whitespace-nowrap transition-colors ${deliveryMethod === 'pickup' ? 'bg-[#4A9A7A] text-white' : 'bg-gray-100 text-gray-600'}`}>自取</button>
                            <button onClick={() => { setDeliveryMethod('delivery'); setPickupDate(''); }}
                                className={`flex-1 min-w-0 py-2 rounded-xl font-bold whitespace-nowrap transition-colors ${deliveryMethod === 'delivery' ? 'bg-[#4A9A7A] text-white' : 'bg-gray-100 text-gray-600'}`}>宅配</button>
                        </div>
                        {deliveryMethod === 'pickup' ? (
                            <select value={pickupDate} onChange={e => setPickupDate(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg p-2 text-base">
                                <option value="">請選擇取貨日</option>
                                {pickupDates.map(d => <option key={d} value={d}>{formatPickupDate(d)}</option>)}
                            </select>
                        ) : (
                            <p className="text-sm text-gray-500">寄出期間：{deliveryPeriod || '（尚未設定，請到年菜管理頁設定）'}</p>
                        )}
                    </div>

                    {/* 底部：狀態提示、金額、按鈕（固定） */}
                    <div className="flex-shrink-0 p-3 bg-gray-50 border-t space-y-2">
                        {seqLabel && (
                            <p className={`rounded-lg px-2.5 py-1.5 text-xs font-bold ${isDirty ? 'bg-orange-50 text-orange-600' : 'bg-green-50 text-green-700'}`}>
                                {isDirty
                                    ? `流水號 ${seqLabel} 已保留，但內容已變更——請重新按「確認訂購」`
                                    : `流水號 ${seqLabel} 已確認，可以結帳`}
                            </p>
                        )}
                        {resumeNotice && <p className="rounded-lg px-2.5 py-1.5 text-xs font-bold bg-blue-50 text-blue-700">{resumeNotice}</p>}
                        {error && <p className="text-red-500 font-bold text-xs">{error}</p>}

                        <div className="border p-2 rounded-lg bg-white shadow-inner text-sm">
                            {/* 宅配一律顯示運費列：未滿 3,000 加 160，滿額顯示免運；切換取貨方式即時重算 */}
                            {deliveryMethod === 'delivery' && subtotal > 0 && (
                                <>
                                    <div className="flex justify-between text-gray-500"><span>小計</span><span>${subtotal.toLocaleString('en-US')}</span></div>
                                    <div className="flex justify-between text-gray-500">
                                        <span>運費{shippingFee > 0 && <span className="text-xs">（未滿 ${FREE_SHIPPING_THRESHOLD.toLocaleString('en-US')}）</span>}</span>
                                        <span>{shippingFee > 0 ? `$${shippingFee}` : '免運'}</span>
                                    </div>
                                </>
                            )}
                            <div className="flex justify-between items-center">
                                <span className="font-bold text-gray-800">總金額</span>
                                <span className="font-black text-2xl text-red-600">NT$ {total.toLocaleString('en-US')}</span>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <button onClick={handleConfirmOrder} disabled={confirming || cartItems.length === 0}
                                className="flex-1 py-2 rounded-xl bg-gray-700 text-white disabled:opacity-50 flex flex-col items-center leading-tight">
                                <span className="font-black text-base">{confirming ? '處理中...' : reservationId ? '重新確認' : '確認訂購'}</span>
                                <span className="text-[11px] font-bold opacity-80">{reservationId ? '重印顧客聯' : '印顧客聯'}</span>
                            </button>
                            <button onClick={handleCheckout} disabled={checkingOut || isDirty}
                                className="flex-1 py-2 rounded-xl bg-[#D47856] text-white disabled:opacity-50 flex flex-col items-center leading-tight">
                                <span className="font-black text-base">{checkingOut ? '處理中...' : '結帳'}</span>
                                <span className="text-[11px] font-bold opacity-80">印存根聯</span>
                            </button>
                        </div>
                        {(cartItems.length > 0 || reservationId) && (
                            <button onClick={handleCancelOrder} className="w-full py-1.5 rounded-xl bg-white border border-gray-200 text-gray-400 font-bold text-sm hover:bg-gray-50">
                                取消本單
                            </button>
                        )}
                    </div>
                </div>

                {/* 右側品項卡片（比照一般點單頁：自己捲動；年菜品項少，一列四張比較大） */}
                <div className="w-[70%] flex flex-col bg-white rounded-xl py-2 px-1 h-full">
                    <div className="flex-grow overflow-y-auto">
                        {/* 一列四張；auto-rows-fr＋fillHeight：所有卡片取最高那張的高度，大小一致 */}
                        <div className="grid grid-cols-4 auto-rows-fr gap-2 w-full p-1">
                            {items.map(item => {
                                const q = qty[item.id] || 0;
                                const isBundle = !!item.bundleComposition;
                                return (
                                    <div key={item.id} className="relative h-full">
                                        {/* 年菜三角標籤 */}
                                        <span className="absolute top-0 left-0 z-20 w-0 h-0 border-t-[28px] border-r-[28px] border-t-[#C1032F] border-r-transparent rounded-tl-xl pointer-events-none" />
                                        <span className="absolute top-1 left-1 z-20 text-white text-[11px] font-black pointer-events-none">年</span>
                                        {isBundle && (
                                            <span className="absolute top-1 right-1 z-20 bg-[#C1032F] text-white text-[10px] font-black px-1.5 py-0.5 rounded pointer-events-none">套餐</span>
                                        )}
                                        {/* 卡片上不顯示已點數量（數量看左側購物車） */}
                                        <MenuCard item={isBundle ? { ...item, name: cardName(item) } : item} onAddItem={() => setItemQty(item, q + 1, { bump: true })} onLongPress={() => setItemQty(item, q - 1)} allowOverride hideStock fillHeight priceClassName="text-amber-700" />
                                    </div>
                                );
                            })}
                            {items.length === 0 && <p className="col-span-full text-gray-400 text-center py-10">目前沒有年菜品項，請先到菜單管理設定</p>}
                        </div>
                    </div>
                </div>
            </div>
            {dialog}
        </div>
    );
};

export default NianfaiOrderPage;
