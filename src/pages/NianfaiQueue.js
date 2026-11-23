// src/pages/NianfaiQueue.js — 年菜佇列頁（修正單 #01 第 4、6 節）
// 介面參考外帶頁：待補區（資料待補／送出失敗／待傳，最新在最上面）、
// 歷史區（已送出，預設收合）。點待補單開補資料表單，資料完整才能送出表單。
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getNianfaiQueue, saveNianfaiOrderDetails, submitNianfaiOrder, getSettingValue } from '../db';
import useNianfaiSeason from '../hooks/useNianfaiSeason';

const STATUS_META = {
    incomplete: { label: '資料待補', cls: 'bg-orange-100 text-orange-600' },
    failed:     { label: '送出失敗', cls: 'bg-red-100 text-red-600' },
    pending:    { label: '待傳送',   cls: 'bg-gray-100 text-gray-500' },
    sent:       { label: '已送出',   cls: 'bg-green-100 text-green-700' },
};

const seqLabel = (o) => `${o.year}-${String(o.seqNo).padStart(3, '0')}`;
const fmtTime = (iso) => new Date(iso).toLocaleString('zh-TW', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
const itemSummary = (items) => items.map(it => `${it.name}×${it.quantity}`).join('、');
const deliveryText = (o) => o.deliveryMethod === 'delivery' ? '宅配' : `自取 ${o.pickupDate || '（未選日期）'}`;

// 前端必填檢查，跟後端 nianfaiMissingFields 同一套規則（後端會再擋一次）
function missingFields(f) {
    const blank = v => !v || !String(v).trim();
    const m = [];
    if (blank(f.customerName)) m.push('姓名');
    if (blank(f.customerPhone)) m.push('電話');
    if (!['pickup', 'delivery'].includes(f.deliveryMethod)) m.push('取貨方式');
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
            className={`grid grid-cols-12 gap-2 px-4 py-3 items-center border-b border-gray-200 bg-white ${onClick ? 'cursor-pointer hover:bg-gray-50' : ''}`}>
            <div className="col-span-2 flex flex-col">
                <span className="text-xl font-black text-gray-800 leading-none">{seqLabel(order)}</span>
                <span className={`mt-1 self-start text-[11px] font-black px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
            </div>
            <div className="col-span-2 text-sm font-bold text-gray-600">{fmtTime(order.checkoutTime)}</div>
            <div className="col-span-4 text-sm text-gray-700 min-w-0">
                <p className="truncate">{itemSummary(order.items)}</p>
                {order.customerName && <p className="text-xs text-gray-400 truncate">{order.customerName} {order.customerPhone}</p>}
                {order.status === 'failed' && order.error && <p className="text-xs text-red-500 truncate">{order.error}</p>}
            </div>
            <div className="col-span-2 text-sm font-bold text-gray-600">{deliveryText(order)}</div>
            <div className="col-span-2 text-right pr-2 text-lg font-black text-gray-800">${Number(order.total || 0).toLocaleString('en-US')}</div>
        </div>
    );
};

const DetailsModal = ({ order, pickupDates, onClose, onDone }) => {
    const [form, setForm] = useState({
        customerName: order.customerName, customerPhone: order.customerPhone, customerEmail: order.customerEmail,
        deliveryMethod: order.deliveryMethod || 'pickup', pickupDate: order.pickupDate || '',
        recipientName: order.recipientName, recipientPhone: order.recipientPhone, recipientAddress: order.recipientAddress,
    });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (e) => setForm(prev => ({ ...prev, [k]: e.target.value }));
    const missing = missingFields(form);
    // 取貨方式影響運費，結帳時已依顧客聯計價；這裡改方式不會重算金額，提醒一下
    const methodChanged = order.deliveryMethod && form.deliveryMethod !== order.deliveryMethod;

    const payload = () => ({
        ...form,
        pickupDate: form.deliveryMethod === 'pickup' ? form.pickupDate : null,
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
                alert(`資料已儲存，但送出表單失敗：${r.error}\n系統會每 5 分鐘自動重試。`);
            } else if (r.status === 'pending') {
                alert('資料已儲存。表單送出網址尚未設定，訂單會保持「待傳送」，設定後自動送出。');
            }
            onDone(payload());
        } catch (e) {
            setError(`送出失敗：${e.message}`);
        } finally {
            setBusy(false);
        }
    };

    const input = 'w-full border border-gray-300 rounded-lg p-2.5 text-base';
    const label = 'block text-sm font-bold text-gray-600 mb-1';

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between mb-1">
                    <h3 className="text-xl font-black text-gray-800">補填資料 {seqLabel(order)}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
                </div>
                <p className="text-sm text-gray-500 mb-4">
                    結帳 {fmtTime(order.checkoutTime)}｜${Number(order.total || 0).toLocaleString('en-US')}｜{itemSummary(order.items)}
                </p>

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
                        <label className={label}>取貨方式 *</label>
                        <div className="flex gap-2">
                            {[['pickup', '自取'], ['delivery', '宅配']].map(([v, t]) => (
                                <button key={v} type="button" onClick={() => setForm(prev => ({ ...prev, deliveryMethod: v }))}
                                    className={`flex-1 py-2.5 rounded-xl font-bold ${form.deliveryMethod === v ? 'bg-[#4A9A7A] text-white' : 'bg-gray-100 text-gray-600'}`}>{t}</button>
                            ))}
                        </div>
                        {methodChanged && <p className="text-xs text-orange-500 font-bold mt-1">與結帳時的取貨方式不同，運費不會重新計算；如需改金額請作廢重新點單。</p>}
                    </div>
                    {form.deliveryMethod === 'pickup' ? (
                        <div>
                            <label className={label}>取貨日 *</label>
                            <select className={input} value={form.pickupDate} onChange={set('pickupDate')}>
                                <option value="">請選擇取貨日</option>
                                {pickupDates.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <div><label className={label}>收件人 *</label><input className={input} value={form.recipientName} onChange={set('recipientName')} /></div>
                                <div><label className={label}>收件電話 *</label><input className={input} type="tel" value={form.recipientPhone} onChange={set('recipientPhone')} /></div>
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
            setQueue(await getNianfaiQueue(year));
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
        return <div className="p-8 text-center text-gray-400">目前不是年菜開賣／收單期間。</div>;
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
                    <h1 className="text-xl font-black">🧧 年菜訂單 {year || ''}</h1>
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
                <div className="col-span-4">品項</div>
                <div className="col-span-2">取貨方式</div>
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
                <DetailsModal order={editing} pickupDates={pickupDates}
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
        </div>
    );
};

export default NianfaiQueuePage;
