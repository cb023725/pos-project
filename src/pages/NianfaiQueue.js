// src/pages/NianfaiQueue.js — 年菜佇列頁（修正單 #01 第 4、6 節）
// 介面參考外帶頁：待補區（資料待補／送出失敗／待傳，最新在最上面）、
// 歷史區（已送出，預設收合）。點待補單開補資料表單，資料完整才能送出表單。
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getNianfaiQueue, saveNianfaiOrderDetails, submitNianfaiOrder, getSettingValue, getNianfaiReservations, abandonNianfaiReservation } from '../db';
import useNianfaiSeason from '../hooks/useNianfaiSeason';
import useDialog from '../components/useDialog';
import { formatPickupDate, formatNianfaiSeq, nianfaiDisplayName } from '../utils/nianfai';

const STATUS_META = {
    incomplete: { label: '資料待補', cls: 'bg-orange-100 text-orange-600' },
    failed:     { label: '送出失敗', cls: 'bg-red-100 text-red-600' },
    pending:    { label: '待傳送',   cls: 'bg-gray-100 text-gray-500' },
    sent:       { label: '已送出',   cls: 'bg-green-100 text-green-700' },
};

const seqLabel = (o) => formatNianfaiSeq(o.year, o.seqNo);
const fmtTime = (iso) => new Date(iso).toLocaleString('zh-TW', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const fmtMoney = (n) => `$${Number(n || 0).toLocaleString('en-US')}`;
const deliveryText = (o) => o.deliveryMethod === 'delivery' ? '宅配' : `自取 ${formatPickupDate(o.pickupDate) || '（未選日期）'}`;

// 品項條列：一行一項（品名 × 數量）
const ItemList = ({ items, showPrice = false, className = '' }) => (
    <ul className={`space-y-0.5 ${className}`}>
        {items.map((it, i) => (
            <li key={`${it.id}-${i}`} className="flex justify-between gap-3">
                <span className="min-w-0 break-words">{nianfaiDisplayName(it)} <span className="font-black">× {it.quantity}</span></span>
                {showPrice && <span className="flex-shrink-0 text-gray-500">{fmtMoney((it.price || 0) * (it.quantity || 1))}</span>}
            </li>
        ))}
    </ul>
);

// 前端必填檢查，跟後端 nianfaiMissingFields 同一套規則（後端會再擋一次）
function missingFields(f) {
    const blank = v => !v || !String(v).trim();
    const m = [];
    if (blank(f.customerName)) m.push('姓名');
    if (blank(f.customerPhone)) m.push('電話');
    if (f.deliveryMethod === 'pickup' && blank(f.pickupDate)) m.push('取貨日');
    if (f.deliveryMethod === 'delivery') {
        if (blank(f.recipientName)) m.push('收件人');
        if (blank(f.recipientPhone)) m.push('收件電話');
        if (blank(f.recipientAddress)) m.push('收件地址');
    }
    return m;
}

const OrderRow = ({ order, onClick }) => {
    const meta = STATUS_META[order.status] || STATUS_META.incomplete;
    return (
        <div onClick={onClick}
            className={`grid grid-cols-12 gap-2 px-4 py-3 items-start border-b border-gray-200 bg-white ${onClick ? 'cursor-pointer hover:bg-gray-50' : ''}`}>
            <div className="col-span-2 flex flex-col">
                <span className="text-xl font-black text-gray-800 leading-none">{seqLabel(order)}</span>
                <span className={`mt-1 self-start text-[11px] font-black px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
            </div>
            <div className="col-span-2 text-sm font-bold text-gray-600">{fmtTime(order.checkoutTime)}</div>
            <div className="col-span-3 text-sm text-gray-700 min-w-0">
                <ItemList items={order.items} />
                {order.customerName && <p className="text-xs text-gray-400 mt-1">{order.customerName} {order.customerPhone}</p>}
                {order.status === 'failed' && order.error && <p className="text-xs text-red-500">{order.error}</p>}
            </div>
            <div className="col-span-3 text-sm font-bold text-gray-600 whitespace-nowrap">{deliveryText(order)}</div>
            <div className="col-span-2 text-right pr-2 text-lg font-black text-gray-800">{fmtMoney(order.total)}</div>
        </div>
    );
};

const DetailsModal = ({ order, pickupDates, onClose, onDone, showAlert }) => {
    // 取貨方式在結帳時已決定（影響運費與總額），這裡只能看不能改
    const deliveryMethod = order.deliveryMethod || 'pickup';
    const [form, setForm] = useState({
        customerName: order.customerName, customerPhone: order.customerPhone, customerEmail: order.customerEmail,
        pickupDate: order.pickupDate || '',
        recipientName: order.recipientName, recipientPhone: order.recipientPhone, recipientAddress: order.recipientAddress,
    });
    // 收件人同訂購人：勾選時收件人姓名／電話跟著訂購人同步、不能另外編輯
    const [sameAsCustomer, setSameAsCustomer] = useState(
        deliveryMethod === 'delivery' && !!order.recipientName
        && order.recipientName === order.customerName && order.recipientPhone === order.customerPhone);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (e) => setForm(prev => ({ ...prev, [k]: e.target.value }));
    const effective = sameAsCustomer ? { ...form, recipientName: form.customerName, recipientPhone: form.customerPhone } : form;
    const missing = missingFields({ ...effective, deliveryMethod });

    const payload = () => ({
        customerName: effective.customerName, customerPhone: effective.customerPhone, customerEmail: effective.customerEmail,
        ...(deliveryMethod === 'pickup'
            ? { pickupDate: effective.pickupDate }
            : { recipientName: effective.recipientName, recipientPhone: effective.recipientPhone, recipientAddress: effective.recipientAddress }),
    });

    const handleSave = async () => {
        setBusy(true); setError('');
        try { await saveNianfaiOrderDetails(order.orderId, payload()); onDone(payload()); }
        catch (e) { setError(`儲存失敗：${e.message}`); }
        finally { setBusy(false); }
    };

    const handleSubmit = async () => {
        if (missing.length > 0) return;
        setBusy(true); setError('');
        try {
            const r = await submitNianfaiOrder(order.orderId, payload());
            if (r.status === 'failed') {
                await showAlert('資料已儲存，系統每 5 分鐘自動重試', { title: '表單送出失敗', icon: 'warning', note: r.error });
            } else if (r.status === 'pending') {
                await showAlert('表單網址尚未設定，設定後自動送出', { title: '資料已儲存', icon: 'info' });
            }
            onDone(payload());
        } catch (e) {
            setError(`送出失敗：${e.message}`);
        } finally {
            setBusy(false);
        }
    };

    const input = 'w-full border border-gray-300 rounded-lg p-2.5 text-base disabled:bg-gray-100 disabled:text-gray-500';
    const label = 'block text-sm font-bold text-gray-600 mb-1';

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between mb-1">
                    <h3 className="text-xl font-black text-gray-800">補填資料 {seqLabel(order)}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
                </div>
                <p className="text-sm text-gray-500 mb-2">結帳 {fmtTime(order.checkoutTime)}</p>
                <div className="bg-gray-50 rounded-xl p-3 mb-4 text-sm text-gray-700">
                    <ItemList items={order.items} showPrice />
                    <div className="flex justify-between border-t border-gray-200 mt-2 pt-2 font-black text-gray-800">
                        <span>總額</span><span>{fmtMoney(order.total)}</span>
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div><label className={label}>姓名 *</label><input className={input} value={form.customerName} onChange={set('customerName')} /></div>
                        <div><label className={label}>電話 *</label><input className={input} type="tel" value={form.customerPhone} onChange={set('customerPhone')} /></div>
                    </div>
                    <div>
                        <label className={label}>Email（選填，沒填用店家信箱）</label>
                        <input className={input} type="email" value={form.customerEmail} onChange={set('customerEmail')} />
                    </div>
                    <div>
                        <label className={label}>取貨方式</label>
                        <div className="flex items-center gap-2">
                            <span className="px-4 py-2 rounded-xl bg-[#4A9A7A] text-white font-bold">{deliveryMethod === 'delivery' ? '宅配' : '自取'}</span>
                            <span className="text-xs text-gray-400">結帳後不能變更，如需更改請作廢後重新點單</span>
                        </div>
                    </div>
                    {deliveryMethod === 'pickup' ? (
                        <div>
                            <label className={label}>取貨日 *</label>
                            <select className={input} value={form.pickupDate} onChange={set('pickupDate')}>
                                <option value="">請選擇取貨日</option>
                                {pickupDates.map(d => <option key={d} value={d}>{formatPickupDate(d)}</option>)}
                            </select>
                        </div>
                    ) : (
                        <>
                            <label className="flex items-center gap-2 text-base font-bold text-gray-700 cursor-pointer select-none">
                                <input type="checkbox" className="w-5 h-5 accent-[#4A9A7A]" checked={sameAsCustomer}
                                    onChange={e => setSameAsCustomer(e.target.checked)} />
                                收件人同訂購人
                            </label>
                            <div className="grid grid-cols-2 gap-3">
                                <div><label className={label}>收件人 *</label><input className={input} value={effective.recipientName} onChange={set('recipientName')} disabled={sameAsCustomer} /></div>
                                <div><label className={label}>收件電話 *</label><input className={input} type="tel" value={effective.recipientPhone} onChange={set('recipientPhone')} disabled={sameAsCustomer} /></div>
                            </div>
                            <div><label className={label}>收件地址 *</label><input className={input} value={form.recipientAddress} onChange={set('recipientAddress')} /></div>
                        </>
                    )}
                </div>

                {missing.length > 0 && <p className="text-sm text-orange-500 font-bold mt-4">尚缺：{missing.join('、')}</p>}
                {error && <p className="text-sm text-red-500 font-bold mt-2">{error}</p>}

                <div className="flex gap-2 mt-5">
                    <button onClick={handleSave} disabled={busy}
                        className="flex-1 py-3 rounded-xl bg-white border border-gray-300 text-gray-600 font-black disabled:opacity-50">儲存（暫不送出）</button>
                    <button onClick={handleSubmit} disabled={busy || missing.length > 0}
                        className="flex-1 py-3 rounded-xl bg-[#C1032F] text-white font-black disabled:opacity-40">{busy ? '處理中...' : '送出表單'}</button>
                </div>
            </div>
        </div>
    );
};

const NianfaiQueuePage = () => {
    const navigate = useNavigate();
    const { dialog, showAlert, showConfirm } = useDialog();
    const [reservations, setReservations] = useState([]); // 已確認訂購、尚未結帳（保留中）
    const { year, showOrderQueue, loading: seasonLoading } = useNianfaiSeason();
    const [queue, setQueue] = useState({ pending: [], history: [] });
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [showHistory, setShowHistory] = useState(false);
    const [editing, setEditing] = useState(null);
    const [pickupDates, setPickupDates] = useState([]);

    const load = useCallback(async () => {
        if (!year) return;
        try {
            const [q, resv] = await Promise.all([getNianfaiQueue(year), getNianfaiReservations(year)]);
            setQueue(q);
            setReservations(resv);
            setLoadError('');
        } catch (e) {
            setLoadError(`讀取失敗：${e.message}`);
        } finally {
            setIsLoading(false);
        }
    }, [year]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        if (!year) return;
        getSettingValue(`nianfai_${year}_pickup_dates`, '[]').then(v => {
            try { setPickupDates(JSON.parse(v) || []); } catch { setPickupDates([]); }
        });
    }, [year]);

    if (!seasonLoading && !showOrderQueue) {
        return <div className="p-8 text-center text-gray-400">目前沒有進行中的年菜活動。</div>;
    }

    return (
        <div className="h-[100dvh] w-full flex flex-col bg-gray-50 font-sans overflow-hidden">
            <div className="flex-shrink-0 bg-[#C1032F] text-white px-4 py-3 flex items-center justify-between shadow-md">
                <div className="flex items-center space-x-3">
                    <button onClick={() => navigate('/tables')} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M15 19l-7-7 7-7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                    <h1 className="text-xl font-black">🧧 {year || ''} 年菜訂單</h1>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={load} className="p-2 rounded-lg hover:bg-white/20 transition-colors" title="重新整理">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                    <button onClick={() => navigate('/nianfai-order')}
                        className="bg-white text-[#C1032F] font-black px-4 py-2 rounded-xl flex items-center space-x-1.5 hover:bg-gray-50 transition-colors shadow">
                        <span className="text-lg leading-none">+</span><span>新增年菜訂單</span>
                    </button>
                </div>
            </div>

            <div className="flex-shrink-0 bg-gray-100 px-4 py-1.5 grid grid-cols-12 gap-2 text-[11px] font-black text-gray-500 tracking-wide border-b border-gray-300">
                <div className="col-span-2">流水號</div>
                <div className="col-span-2">結帳時間</div>
                <div className="col-span-3">品項</div>
                <div className="col-span-3">取貨方式</div>
                <div className="col-span-2 text-right pr-2">金額</div>
            </div>

            <div className="flex-grow overflow-y-auto">
                {loadError && <p className="p-4 text-red-500 font-bold">{loadError}</p>}
                {isLoading ? (
                    <div className="py-20 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#C1032F]"></div>
                    </div>
                ) : (
                    <>
                        {reservations.length > 0 && (
                            <>
                                <div className="px-4 py-2 text-sm font-black text-blue-700 bg-blue-50 border-b border-blue-100">
                                    保留中・已確認訂購、尚未結帳（{reservations.length}）
                                </div>
                                {reservations.map(r => (
                                    <div key={r.id} className="grid grid-cols-12 gap-2 px-4 py-3 items-start border-b border-gray-200 bg-white">
                                        <div className="col-span-2 flex flex-col">
                                            <span className="text-xl font-black text-gray-800 leading-none">{seqLabel(r)}</span>
                                            <span className="mt-1 self-start text-[11px] font-black px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">保留中</span>
                                        </div>
                                        <div className="col-span-2 text-sm font-bold text-gray-600">確認 {fmtTime(r.confirmedAt)}</div>
                                        <div className="col-span-3 text-sm text-gray-700 min-w-0"><ItemList items={r.items} /></div>
                                        <div className="col-span-3 text-sm font-bold text-gray-600 whitespace-nowrap">{deliveryText(r)}</div>
                                        <div className="col-span-2 flex flex-col items-end gap-1.5">
                                            <span className="text-lg font-black text-gray-800">{fmtMoney(r.total)}</span>
                                            <div className="flex gap-1.5">
                                                <button onClick={async () => {
                                                    const ok = await showConfirm(`流水號 ${seqLabel(r)} 將記為放棄`, { title: '放棄此單', icon: 'danger', confirmText: '放棄', danger: true });
                                                    if (!ok) return;
                                                    try { await abandonNianfaiReservation(r.id); } catch (e) { await showAlert(e.message, { title: '放棄失敗', icon: 'warning' }); }
                                                    load();
                                                }} className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-sm font-bold hover:bg-gray-200">放棄</button>
                                                <button onClick={() => navigate('/nianfai-order', { state: { resumeReservationId: r.id } })}
                                                    className="px-3 py-1.5 rounded-lg bg-[#C1032F] text-white text-sm font-bold hover:brightness-95">繼續點單</button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </>
                        )}
                        <div className="px-4 py-2 text-sm font-black text-gray-600 bg-orange-50 border-b border-orange-100">
                            待補區（{queue.pending.length}）
                        </div>
                        {queue.pending.length === 0
                            ? <p className="py-10 text-center text-gray-400 font-bold">沒有待補資料的訂單</p>
                            : queue.pending.map(o => <OrderRow key={o.orderId} order={o} onClick={() => setEditing(o)} />)}

                        <button onClick={() => setShowHistory(v => !v)}
                            className="w-full text-left px-4 py-2 text-sm font-black text-gray-600 bg-gray-100 border-y border-gray-200 hover:bg-gray-200">
                            {showHistory ? '▾' : '▸'} 歷史區・已送出（{queue.history.length}）
                        </button>
                        {showHistory && queue.history.map(o => <OrderRow key={o.orderId} order={o} />)}
                    </>
                )}
            </div>

            {editing && (
                <DetailsModal order={editing} pickupDates={pickupDates} showAlert={showAlert}
                    onClose={() => setEditing(null)}
                    onDone={(saved) => {
                        // 先把剛存的資料寫回列表，避免重新載入完成前再點開時拿到舊資料、存檔蓋掉
                        if (saved) {
                            const id = editing.orderId;
                            setQueue(prev => ({ ...prev, pending: prev.pending.map(o => o.orderId === id ? { ...o, ...saved } : o) }));
                        }
                        setEditing(null);
                        load();
                    }} />
            )}
            {dialog}
        </div>
    );
};

export default NianfaiQueuePage;
