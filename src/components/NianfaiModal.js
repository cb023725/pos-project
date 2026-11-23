import React, { useState, useEffect, useMemo } from 'react';
import { getNianfaiItems, createNianfaiOrder } from '../db';
import MenuCard from './MenuCard';

// 套餐上限 8、單點上限 9，對應 Google 表單本身的題型上限（下拉 1~8 / 表格 1~9）。
// 超過的大單無法透過這裡送出，Yw 要自己先填表單送出，再到「表單回應」直接改數量（不拆單）。
const BUNDLE_MAX = 8;
const SINGLE_MAX = 9;

const NianfaiModal = ({ isOpen, year, onClose }) => {
    const [items, setItems] = useState([]);
    const [qty, setQty] = useState({});
    const [customerName, setCustomerName] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');
    const [deliveryMethod, setDeliveryMethod] = useState('pickup');
    const [pickupDate, setPickupDate] = useState('');
    const [recipientName, setRecipientName] = useState('');
    const [recipientPhone, setRecipientPhone] = useState('');
    const [recipientAddress, setRecipientAddress] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [capNotice, setCapNotice] = useState('');

    useEffect(() => {
        if (isOpen && year) {
            getNianfaiItems(year).then(setItems).catch(() => setItems([]));
        }
    }, [isOpen, year]);

    useEffect(() => {
        if (isOpen) {
            setQty({}); setCustomerName(''); setCustomerPhone('');
            setDeliveryMethod('pickup'); setPickupDate('');
            setRecipientName(''); setRecipientPhone(''); setRecipientAddress('');
            setError(''); setCapNotice('');
        }
    }, [isOpen]);

    const cartItems = useMemo(() =>
        items.filter(it => (qty[it.id] || 0) > 0).map(it => ({ ...it, quantity: qty[it.id] })),
    [items, qty]);

    const total = cartItems.reduce((s, it) => s + (it.price || 0) * it.quantity, 0);

    const setItemQty = (item, value) => {
        const max = item.bundleComposition ? BUNDLE_MAX : SINGLE_MAX;
        if (value > max) {
            setCapNotice(`「${item.name}」已達上限 ${max} 份，超過請先在表單送出後，到「表單回應」直接修改數量（不拆單）`);
            return;
        }
        const current = qty[item.id] || 0;
        // 已停售的品項第一次加入時跳確認（比照一般餐點停售的做法），確認後才放行；
        // 已經加過的話再加減不用每次都問
        if (item.soldOut && current === 0 && value > current) {
            if (!window.confirm(`「${item.name}」已停售，確定要加入嗎？`)) return;
        }
        setCapNotice('');
        setQty(prev => ({ ...prev, [item.id]: Math.max(0, value) }));
    };

    const handleSubmit = async () => {
        setError('');
        if (cartItems.length === 0) { setError('請至少選擇一項品項'); return; }
        if (!customerName.trim()) { setError('請輸入訂購人姓名'); return; }
        if (deliveryMethod === 'pickup' && !pickupDate) { setError('請選擇取貨日'); return; }
        if (deliveryMethod === 'delivery' && (!recipientName.trim() || !recipientAddress.trim())) {
            setError('請輸入收件人姓名與地址'); return;
        }
        setSubmitting(true);
        try {
            const payload = {
                items: cartItems.map(it => ({ id: it.id, name: it.name, price: it.price, quantity: it.quantity })),
                year,
                customerName: customerName.trim(),
                customerPhone: customerPhone.trim(),
                deliveryMethod,
                pickupDate: deliveryMethod === 'pickup' ? pickupDate : null,
                recipientName: deliveryMethod === 'delivery' ? recipientName.trim() : null,
                recipientPhone: deliveryMethod === 'delivery' ? recipientPhone.trim() : null,
                recipientAddress: deliveryMethod === 'delivery' ? recipientAddress.trim() : null,
            };
            let result;
            try {
                result = await createNianfaiOrder(payload);
            } catch (e) {
                // 表單已因達停售上限自動關閉：跳確認視窗，確認後才用 override 繼續送出
                if (e.code === 'FORM_CLOSED') {
                    if (!window.confirm(`${e.message || '年菜表單已關閉'}\n\n確定要繼續新增這筆訂單嗎？`)) {
                        setSubmitting(false);
                        return;
                    }
                    result = await createNianfaiOrder({ ...payload, override: true });
                } else {
                    throw e;
                }
            }
            const seqLabel = `${year}-${String(result.seqNo).padStart(3, '0')}`;

            // 二聯單列印：不用等這個 fetch 回應，失敗也不擋結帳成功的流程
            fetch('/print', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    printMode: 'nianfai', seqLabel,
                    customerName: payload.customerName, customerPhone: payload.customerPhone,
                    deliveryMethod, pickupDate: payload.pickupDate,
                    recipientName: payload.recipientName, recipientAddress: payload.recipientAddress,
                    items: payload.items, total: result.total,
                }),
            }).catch(e => console.warn('年菜列印失敗：', e));

            alert(`年菜訂單已送出！流水號 ${seqLabel}`);
            onClose();
        } catch (e) {
            setError(`送出失敗：${e.message}`);
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
                <div className="flex-shrink-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
                    <h3 className="text-2xl font-black text-gray-800">🧧 年菜訂購 {year}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
                        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                </div>

                <div className="flex-grow overflow-y-auto p-6 space-y-5">
                    <div>
                        <h4 className="text-lg font-bold text-gray-700 mb-3">品項（點一下加入，長按減少一份）</h4>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                            {items.map(item => {
                                const q = qty[item.id] || 0;
                                return (
                                    <div key={item.id} className="relative">
                                        {q > 0 && (
                                            <span className="absolute -top-2 -right-2 z-30 min-w-[26px] h-[26px] px-1.5 rounded-full bg-[#D47856] text-white text-sm font-black flex items-center justify-center shadow-lg">
                                                {q}
                                            </span>
                                        )}
                                        <MenuCard
                                            item={item}
                                            onAddItem={() => setItemQty(item, q + 1)}
                                            onLongPress={() => setItemQty(item, q - 1)}
                                            allowOverride
                                        />
                                    </div>
                                );
                            })}
                            {items.length === 0 && <p className="col-span-full text-gray-400 text-center py-6">目前沒有年菜品項，請先到菜單管理設定</p>}
                        </div>
                        {capNotice && <p className="text-orange-500 font-bold text-sm mt-2">{capNotice}</p>}

                        {cartItems.length > 0 && (
                            <div className="mt-4 bg-gray-50 rounded-xl p-3 space-y-1.5">
                                {cartItems.map(it => (
                                    <div key={it.id} className="flex items-center justify-between text-sm">
                                        <span className="font-bold text-gray-700">{it.name} × {it.quantity}</span>
                                        <div className="flex items-center gap-3">
                                            <span className="text-gray-500">${(it.price * it.quantity).toLocaleString('en-US')}</span>
                                            <button onClick={() => setItemQty(it, 0)} className="text-gray-300 hover:text-red-500 font-bold">✕</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div>
                        <h4 className="text-lg font-bold text-gray-700 mb-3">訂購人資訊</h4>
                        <div className="grid grid-cols-2 gap-3">
                            <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="姓名"
                                className="border border-gray-300 rounded-lg p-3" />
                            <input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="電話"
                                className="border border-gray-300 rounded-lg p-3" />
                        </div>
                    </div>

                    <div>
                        <h4 className="text-lg font-bold text-gray-700 mb-3">取貨方式</h4>
                        <div className="flex gap-2 mb-3">
                            <button onClick={() => setDeliveryMethod('pickup')}
                                className={`flex-1 py-3 rounded-xl font-bold transition-colors ${deliveryMethod === 'pickup' ? 'bg-[#4A9A7A] text-white' : 'bg-gray-100 text-gray-600'}`}>自取</button>
                            <button onClick={() => setDeliveryMethod('delivery')}
                                className={`flex-1 py-3 rounded-xl font-bold transition-colors ${deliveryMethod === 'delivery' ? 'bg-[#4A9A7A] text-white' : 'bg-gray-100 text-gray-600'}`}>宅配</button>
                        </div>
                        {deliveryMethod === 'pickup' ? (
                            <input type="date" value={pickupDate} onChange={e => setPickupDate(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg p-3" />
                        ) : (
                            <div className="grid grid-cols-2 gap-3">
                                <input value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="收件人姓名"
                                    className="border border-gray-300 rounded-lg p-3" />
                                <input value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)} placeholder="收件人電話"
                                    className="border border-gray-300 rounded-lg p-3" />
                                <input value={recipientAddress} onChange={e => setRecipientAddress(e.target.value)} placeholder="收件地址"
                                    className="col-span-2 border border-gray-300 rounded-lg p-3" />
                            </div>
                        )}
                    </div>

                    {error && <p className="text-red-500 font-bold text-sm">{error}</p>}
                </div>

                <div className="flex-shrink-0 bg-white border-t border-gray-100 px-6 py-4 flex items-center justify-between">
                    <div>
                        <p className="text-xs text-gray-400 font-bold">年菜小計</p>
                        <p className="text-2xl font-black text-gray-800">${total.toLocaleString('en-US')}</p>
                    </div>
                    <button onClick={handleSubmit} disabled={submitting || cartItems.length === 0}
                        className="px-8 py-3 rounded-xl bg-[#D47856] text-white font-black text-lg disabled:opacity-50 transition-opacity">
                        {submitting ? '送出中...' : '確認結帳並列印'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NianfaiModal;
