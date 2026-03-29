import React, { useState, useEffect, useCallback } from 'react';
import { getAllCustomers, upsertCustomer, deleteCustomer, getOrdersByPhones } from '../db';

const formatCurrency = (n) => Math.round(n || 0).toLocaleString('en-US');

const formatDate = (ts) => {
    if (!ts) return '--';
    return new Date(ts).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
};

const calcStats = (orders) => {
    const done = orders.filter(o => o.status === 'paid' || o.status === 'paid_report_complete');
    if (done.length === 0) return { totalVisits: 0, avgSpend: 0, avgCycle: null, lastVisit: null };
    const totalVisits = done.length;
    const avgSpend = done.reduce((s, o) => s + (o.total || 0), 0) / totalVisits;
    const sorted = [...done].sort((a, b) => a.id - b.id);
    let avgCycle = null;
    if (sorted.length > 1) {
        const diffs = [];
        for (let i = 1; i < sorted.length; i++) {
            const t1 = new Date(sorted[i - 1].timestamp || 0).getTime();
            const t2 = new Date(sorted[i].timestamp || 0).getTime();
            diffs.push((t2 - t1) / 86400000);
        }
        avgCycle = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    }
    const lastVisit = sorted[sorted.length - 1]?.timestamp;
    return { totalVisits, avgSpend, avgCycle, lastVisit };
};

// Customer form supporting multiple names/phones
const CustomerForm = ({ initial, onSave, onCancel }) => {
    const [names, setNames] = useState(initial?.names || [initial?.name || ''].filter(Boolean));
    const [phones, setPhones] = useState(initial?.phones || [initial?.phone || ''].filter(Boolean));
    const [notes, setNotes] = useState(initial?.notes || '');
    const [newName, setNewName] = useState('');
    const [newPhone, setNewPhone] = useState('');

    const addName = () => {
        if (newName.trim() && !names.includes(newName.trim())) {
            setNames(v => [...v, newName.trim()]);
            setNewName('');
        }
    };
    const addPhone = () => {
        if (newPhone.trim() && !phones.includes(newPhone.trim())) {
            setPhones(v => [...v, newPhone.trim()]);
            setNewPhone('');
        }
    };

    const handleSave = () => {
        if (names.length === 0 && phones.length === 0) return;
        onSave({ id: initial?.id, names, phones, notes });
    };

    return (
        <div className="bg-white border-2 border-[#2FB8B8] rounded-2xl p-4 mb-4 shadow-md">
            <h2 className="font-black text-gray-700 mb-3">{initial?.id ? '編輯顧客' : '新增顧客'}</h2>

            {/* Names */}
            <div className="mb-3">
                <label className="text-xs font-bold text-gray-500 block mb-1">姓名（可多個）</label>
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {names.map((n, i) => (
                        <span key={i} className="flex items-center bg-[#2FB8B8]/10 text-[#2FB8B8] text-sm font-bold px-2 py-0.5 rounded-lg">
                            {n}
                            <button onClick={() => setNames(v => v.filter((_, j) => j !== i))} className="ml-1.5 text-red-400 hover:text-red-600 font-black text-xs">✕</button>
                        </span>
                    ))}
                </div>
                <div className="flex gap-2">
                    <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addName()} placeholder="新增姓名" className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-bold outline-none focus:border-[#2FB8B8]" />
                    <button onClick={addName} className="px-3 py-1.5 bg-[#2FB8B8] text-white font-bold rounded-lg text-sm">加入</button>
                </div>
            </div>

            {/* Phones */}
            <div className="mb-3">
                <label className="text-xs font-bold text-gray-500 block mb-1">電話（可多個）</label>
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {phones.map((p, i) => (
                        <span key={i} className="flex items-center bg-gray-100 text-gray-700 text-sm font-bold px-2 py-0.5 rounded-lg">
                            {p}
                            <button onClick={() => setPhones(v => v.filter((_, j) => j !== i))} className="ml-1.5 text-red-400 hover:text-red-600 font-black text-xs">✕</button>
                        </span>
                    ))}
                </div>
                <div className="flex gap-2">
                    <input type="tel" value={newPhone} onChange={e => setNewPhone(e.target.value)} onKeyDown={e => e.key === 'Enter' && addPhone()} placeholder="新增電話" className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-bold outline-none focus:border-[#2FB8B8]" />
                    <button onClick={addPhone} className="px-3 py-1.5 bg-[#2FB8B8] text-white font-bold rounded-lg text-sm">加入</button>
                </div>
            </div>

            {/* Notes */}
            <div className="mb-4">
                <label className="text-xs font-bold text-gray-500 block mb-1">備註</label>
                <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="備註（過敏、偏好等）" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-bold outline-none focus:border-[#2FB8B8]" />
            </div>

            <div className="flex gap-2">
                <button onClick={handleSave} className="flex-1 bg-[#2FB8B8] text-white font-black py-2 rounded-xl hover:opacity-90">儲存</button>
                <button onClick={onCancel} className="px-6 bg-gray-200 text-gray-700 font-bold py-2 rounded-xl">取消</button>
            </div>
        </div>
    );
};

// Customer stats row
const CustomerStatsBar = ({ phones }) => {
    const [stats, setStats] = useState(null);

    useEffect(() => {
        if (!phones || phones.length === 0) return;
        getOrdersByPhones(phones).then(orders => setStats(calcStats(orders)));
    }, [phones]);

    if (!stats) return null;

    return (
        <div className="grid grid-cols-4 gap-2 mt-2 px-1">
            <div className="text-center">
                <div className="text-lg font-black text-[#2FB8B8]">{stats.totalVisits}</div>
                <div className="text-[10px] text-gray-400 font-bold">消費次數</div>
            </div>
            <div className="text-center">
                <div className="text-lg font-black text-gray-700">${formatCurrency(stats.avgSpend)}</div>
                <div className="text-[10px] text-gray-400 font-bold">平均消費</div>
            </div>
            <div className="text-center">
                <div className="text-lg font-black text-gray-700">{stats.avgCycle ? `${Math.round(stats.avgCycle)}天` : '--'}</div>
                <div className="text-[10px] text-gray-400 font-bold">平均週期</div>
            </div>
            <div className="text-center">
                <div className="text-sm font-black text-gray-700">{formatDate(stats.lastVisit)}</div>
                <div className="text-[10px] text-gray-400 font-bold">上次消費</div>
            </div>
        </div>
    );
};

const CustomerManagement = () => {
    const [customers, setCustomers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [editTarget, setEditTarget] = useState(null); // null=hidden, {}=new, customer=edit
    const [searchQ, setSearchQ] = useState('');
    const [expandedId, setExpandedId] = useState(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            const all = await getAllCustomers();
            setCustomers(all.sort((a, b) => {
                const an = (a.names || [])[0] || '';
                const bn = (b.names || [])[0] || '';
                return an.localeCompare(bn, 'zh-TW');
            }));
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleSave = async (data) => {
        await upsertCustomer(data);
        setEditTarget(null);
        await load();
    };

    const handleDelete = async (id, names) => {
        if (!window.confirm(`確定刪除顧客「${names[0] || id}」？`)) return;
        await deleteCustomer(id);
        await load();
    };

    const filtered = customers.filter(c => {
        if (!searchQ) return true;
        const q = searchQ.toLowerCase();
        return (c.names || []).some(n => n.toLowerCase().includes(q)) ||
               (c.phones || []).some(p => p.includes(q));
    });

    return (
        <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-2xl font-black text-gray-800">顧客資料庫</h1>
                <button
                    onClick={() => setEditTarget({})}
                    className="bg-[#2FB8B8] text-white font-black px-4 py-2 rounded-xl hover:opacity-90 transition-opacity"
                >
                    + 新增顧客
                </button>
            </div>

            {/* Search */}
            <div className="mb-4 relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <input
                    value={searchQ}
                    onChange={e => setSearchQ(e.target.value)}
                    placeholder="搜尋姓名或電話"
                    className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-xl font-bold outline-none focus:border-[#2FB8B8]"
                />
            </div>

            {editTarget !== null && (
                <CustomerForm
                    initial={editTarget}
                    onSave={handleSave}
                    onCancel={() => setEditTarget(null)}
                />
            )}

            {isLoading ? (
                <div className="flex justify-center py-10">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#2FB8B8]"></div>
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                    <div className="text-4xl mb-2">👤</div>
                    <p className="font-bold">{searchQ ? '無搜尋結果' : '尚無顧客資料'}</p>
                </div>
            ) : (
                <div className="bg-white rounded-2xl overflow-hidden shadow border border-gray-200">
                    {filtered.map((c, i) => {
                        const names = c.names || [];
                        const phones = c.phones || [];
                        const isExpanded = expandedId === c.id;

                        return (
                            <div key={c.id} className={`${i !== 0 ? 'border-t border-gray-100' : ''}`}>
                                <div
                                    className="flex items-center px-4 py-3 hover:bg-gray-50 cursor-pointer"
                                    onClick={() => setExpandedId(isExpanded ? null : c.id)}
                                >
                                    <div className="w-10 h-10 rounded-full bg-[#2FB8B8]/15 text-[#2FB8B8] font-black flex items-center justify-center mr-3 flex-shrink-0 text-lg">
                                        {names[0]?.charAt(0) || '?'}
                                    </div>
                                    <div className="flex-grow min-w-0">
                                        <div className="font-black text-gray-800 flex flex-wrap gap-1.5">
                                            {names.length > 0
                                                ? names.map((n, j) => <span key={j}>{n}{j < names.length - 1 ? ' /' : ''}</span>)
                                                : <span className="text-gray-400">(未填名稱)</span>
                                            }
                                        </div>
                                        <div className="text-sm text-gray-500 font-bold">
                                            {phones.length > 0 ? phones.join(' · ') : '(未填電話)'}
                                        </div>
                                        {c.notes && <div className="text-xs text-gray-400 mt-0.5">{c.notes}</div>}
                                    </div>
                                    <div className="flex gap-2 flex-shrink-0 ml-2" onClick={e => e.stopPropagation()}>
                                        <button onClick={() => setEditTarget(c)} className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold rounded-lg text-sm">編輯</button>
                                        <button onClick={() => handleDelete(c.id, names)} className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-500 font-bold rounded-lg text-sm">刪除</button>
                                    </div>
                                </div>
                                {isExpanded && (
                                    <div className="px-4 pb-3 bg-gray-50 border-t border-gray-100">
                                        <p className="text-xs font-black text-gray-400 mt-2 mb-1 uppercase tracking-wide">消費紀錄</p>
                                        <CustomerStatsBar phones={phones} />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default CustomerManagement;
