// src/pages/Inventory.js
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { getInventoryItems, addMenuItem, updateMenuItem, deleteMenuItem, getMenuItems, getInventoryLogs, addInventoryLog } from '../db';

const DEFAULT_THRESHOLDS = { full: 30, low: 10, urgent: 5 };

// ----------------------------------------------------------------------
// ThresholdInput
// ----------------------------------------------------------------------
const ThresholdInput = ({ label, value, onChange, color }) => (
    <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
        <input
            type="number"
            value={value}
            onChange={onChange}
            min="0"
            className={`w-full p-3 border-2 rounded-lg text-lg font-bold text-right focus:ring-blue-500 focus:border-blue-500 ${color}`}
        />
    </div>
);

// ----------------------------------------------------------------------
// ThresholdSettingModal
// ----------------------------------------------------------------------
const ThresholdSettingModal = ({ isOpen, onClose, item, onSave, onSaveLinks, allMenuItems, consumesMapping }) => {
    const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS);
    const [linkedIds, setLinkedIds] = useState(new Set());
    const [savingLinks, setSavingLinks] = useState(false);

    const consumingMenuItems = useMemo(() => consumesMapping[item?.id] || [], [item, consumesMapping]);

    const menuItemsByCategory = useMemo(() =>
        allMenuItems.reduce((acc, mi) => {
            (acc[mi.category] = acc[mi.category] || []).push(mi);
            return acc;
        }, {}),
    [allMenuItems]);

    useEffect(() => {
        if (isOpen && item) {
            setThresholds(item.thresholds || DEFAULT_THRESHOLDS);
            setLinkedIds(new Set(consumingMenuItems.map(mi => mi.id)));
        }
    }, [isOpen, item, consumingMenuItems]);

    const handleInputChange = (key, value) => {
        setThresholds(prev => ({ ...prev, [key]: Math.max(0, parseInt(value, 10) || 0) }));
    };

    const handleSave = () => {
        const { full, low, urgent } = thresholds;
        if (!(urgent < low && low < full)) {
            alert('閾值設定錯誤：必須滿足 緊急 < 偏低 < 充足');
            return;
        }
        onSave(item.id, thresholds);
    };

    const handleSaveLinks = async () => {
        setSavingLinks(true);
        try {
            await onSaveLinks(item.id, [...linkedIds]);
        } finally {
            setSavingLinks(false);
        }
    };

    const handleLinkToggle = (foodItemId) => {
        setLinkedIds(prev => {
            const next = new Set(prev);
            if (next.has(foodItemId)) next.delete(foodItemId); else next.add(foodItemId);
            return next;
        });
    };

    if (!isOpen || !item) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-xl shadow-2xl w-[620px] max-h-[90vh] overflow-y-auto relative">
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-700">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
                <h3 className="text-2xl font-black mb-6 text-gray-800 border-b pb-2">⚙️ {item.name} 設定</h3>

                {/* 區塊 1：警戒線 */}
                <h4 className="text-lg font-bold text-gray-700 mb-3 border-l-4 border-blue-500 pl-3">1. 庫存警戒線 (充足 &gt; 偏低 &gt; 緊急)</h4>
                <div className="grid grid-cols-3 gap-4 mb-4">
                    <ThresholdInput label="充足數量" value={thresholds.full}   onChange={e => handleInputChange('full', e.target.value)}   color="text-green-600 border-green-300" />
                    <ThresholdInput label="偏低數量" value={thresholds.low}    onChange={e => handleInputChange('low', e.target.value)}    color="text-orange-600 border-orange-300" />
                    <ThresholdInput label="緊急數量" value={thresholds.urgent} onChange={e => handleInputChange('urgent', e.target.value)} color="text-red-600 border-red-300" />
                </div>
                <button onClick={handleSave} className="w-full mb-8 bg-blue-500 hover:bg-blue-600 text-white p-2.5 rounded-xl font-black shadow-md">儲存警戒線</button>

                {/* 區塊 2：菜單連動（可編輯） */}
                <h4 className="text-lg font-bold text-gray-700 mb-2 border-l-4 border-emerald-500 pl-3">2. 菜單銷售連動</h4>
                <p className="text-sm text-gray-500 mb-4">勾選售出後消耗 <strong>{item.name}</strong> 一份庫存的菜單品項。</p>
                {allMenuItems.length === 0 ? (
                    <div className="bg-gray-50 p-4 rounded-lg text-center text-gray-400 text-sm mb-4">載入中...</div>
                ) : (
                    <div className="space-y-3 mb-4">
                        {Object.entries(menuItemsByCategory).map(([category, catItems]) => (
                            <div key={category} className="border border-gray-200 rounded-lg overflow-hidden">
                                <p className="bg-gray-100 px-4 py-2 font-bold text-gray-700 text-sm">{category}</p>
                                <div className="grid grid-cols-2 gap-0 divide-y divide-gray-100">
                                    {catItems.map(mi => (
                                        <label key={mi.id} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-emerald-50 transition-colors ${linkedIds.has(mi.id) ? 'bg-emerald-50' : ''}`}>
                                            <input
                                                type="checkbox"
                                                checked={linkedIds.has(mi.id)}
                                                onChange={() => handleLinkToggle(mi.id)}
                                                className="w-4 h-4 accent-emerald-500 cursor-pointer"
                                            />
                                            <span className={`text-sm font-medium ${linkedIds.has(mi.id) ? 'text-emerald-700 font-bold' : 'text-gray-700'}`}>{mi.name}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                <button onClick={handleSaveLinks} disabled={savingLinks} className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white p-2.5 rounded-xl font-black shadow-md mb-3">
                    {savingLinks ? '儲存中...' : '儲存連動設定'}
                </button>
                <button onClick={onClose} className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 p-2.5 rounded-xl font-bold">關閉</button>
            </div>
        </div>
    );
};

// ----------------------------------------------------------------------
// StockOperationModal
// ----------------------------------------------------------------------
const StockOperationModal = ({ isOpen, onClose, item, onSave }) => {
    const [inputValue, setInputValue] = useState(0);
    const [operationType, setOperationType] = useState('replenish');

    useEffect(() => {
        if (isOpen) { setInputValue(0); setOperationType('replenish'); }
    }, [isOpen, item]);

    const handleInput = (digit) => {
        setInputValue(prev => {
            const cur = String(prev);
            let next = cur === '0' ? digit : cur + digit;
            if (next.length > 1 && next.startsWith('0')) next = next.slice(1);
            return Number(next);
        });
    };

    const handleDelete = () => setInputValue(prev => {
        const cur = String(prev);
        return cur.length > 1 ? Number(cur.slice(0, -1)) : 0;
    });

    const handleSave = () => {
        if (inputValue <= 0 && operationType !== 'inventory') { alert('數量必須大於 0'); return; }
        let finalStock = item.stock;
        if (operationType === 'replenish') finalStock = item.stock + inputValue;
        else if (operationType === 'consume') finalStock = item.stock - inputValue; // 允許負數
        else if (operationType === 'inventory') finalStock = inputValue;
        onSave(item.id, finalStock, operationType);
        onClose();
    };

    if (!isOpen || !item) return null;

    const opLabel = { replenish: '補貨', consume: '消耗', inventory: '盤點' };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-xl shadow-2xl w-[400px] relative">
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-700">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
                <h3 className="text-2xl font-black mb-4 text-gray-800">庫存操作: {item.name}</h3>
                <div className="flex justify-between mb-4 bg-gray-100 rounded-lg p-1">
                    {['replenish','consume','inventory'].map(op => (
                        <button key={op} onClick={() => setOperationType(op)}
                            className={`flex-grow p-2 rounded-lg text-sm font-bold transition-all ${operationType === op ? (op === 'replenish' ? 'bg-emerald-500' : op === 'consume' ? 'bg-orange-500' : 'bg-blue-500') + ' text-white shadow-md' : 'text-gray-600'}`}>
                            {opLabel[op]}
                        </button>
                    ))}
                </div>
                <div className="text-lg font-bold text-gray-600 mb-2">當前庫存: <span className="text-2xl font-black text-green-700 ml-2">{item.stock}</span> 份</div>
                <div className="text-3xl font-black text-right border-4 border-gray-200 p-3 mb-4 rounded-xl bg-gray-50">{inputValue} 份</div>
                <div className="grid grid-cols-3 gap-2">
                    {[1,2,3,4,5,6,7,8,9].map(n => (
                        <button key={n} onClick={() => handleInput(String(n))} className="bg-gray-200 hover:bg-gray-300 p-3 rounded-xl text-xl font-bold">{n}</button>
                    ))}
                    <button onClick={() => setInputValue(0)} className="bg-red-200 hover:bg-red-300 p-3 rounded-xl text-lg font-bold">清空</button>
                    <button onClick={() => handleInput('0')} className="bg-gray-200 hover:bg-gray-300 p-3 rounded-xl text-xl font-bold">0</button>
                    <button onClick={handleDelete} className="bg-orange-500 hover:bg-orange-600 text-white p-3 rounded-xl text-lg font-bold">刪除</button>
                </div>
                <button onClick={handleSave} className="w-full mt-4 bg-emerald-500 hover:bg-emerald-600 text-white p-3 rounded-xl text-lg font-black shadow-md">
                    確認執行{opLabel[operationType]}
                </button>
            </div>
        </div>
    );
};

// ----------------------------------------------------------------------
// AddItemModal - 新增庫存品項
// ----------------------------------------------------------------------
const AddItemModal = ({ isOpen, onClose, onSave, existingCategories }) => {
    const [name, setName] = useState('');
    const [category, setCategory] = useState('');
    const [stock, setStock] = useState(0);
    const [thresholds, setThresholds] = useState({ full: 30, low: 10, urgent: 5 });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isOpen) { setName(''); setCategory(''); setStock(0); setThresholds({ full: 30, low: 10, urgent: 5 }); }
    }, [isOpen]);

    const handleSave = async () => {
        if (!name.trim()) { alert('請輸入品項名稱'); return; }
        if (!category.trim()) { alert('請輸入類別'); return; }
        const { full, low, urgent } = thresholds;
        if (!(urgent < low && low < full)) { alert('閾值設定錯誤：必須滿足 緊急 < 偏低 < 充足'); return; }
        setSaving(true);
        try {
            const id = 'inv_' + Date.now();
            await onSave({ id, name: name.trim(), category: category.trim(), stock, thresholds, price: null, sortOrder: 99 });
            onClose();
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-xl shadow-2xl w-[480px] relative">
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-700">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
                <h3 className="text-2xl font-black mb-6 text-gray-800 border-b pb-2">新增庫存品項</h3>

                <div className="space-y-4 mb-6">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">品項名稱 *</label>
                        <input type="text" value={name} onChange={e => setName(e.target.value)}
                            placeholder="例：紅燒牛腩筋"
                            className="w-full border-2 border-gray-200 rounded-lg p-2.5 text-sm focus:border-blue-400 focus:outline-none" />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">類別 *</label>
                        <input type="text" value={category} onChange={e => setCategory(e.target.value)}
                            list="category-list"
                            placeholder="例：主食庫存"
                            className="w-full border-2 border-gray-200 rounded-lg p-2.5 text-sm focus:border-blue-400 focus:outline-none" />
                        <datalist id="category-list">
                            {existingCategories.map(c => <option key={c} value={c} />)}
                        </datalist>
                        <p className="text-xs text-gray-400 mt-1">輸入現有類別或新建類別名稱</p>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">初始庫存（份）</label>
                        <input type="number" value={stock} onChange={e => setStock(Math.max(0, parseInt(e.target.value)||0))}
                            min="0"
                            className="w-full border-2 border-gray-200 rounded-lg p-2.5 text-sm focus:border-blue-400 focus:outline-none" />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">庫存警戒線</label>
                        <div className="grid grid-cols-3 gap-3">
                            <ThresholdInput label="充足" value={thresholds.full}   onChange={e => setThresholds(t => ({...t, full: Math.max(0, parseInt(e.target.value)||0)}))}   color="text-green-600 border-green-300" />
                            <ThresholdInput label="偏低" value={thresholds.low}    onChange={e => setThresholds(t => ({...t, low: Math.max(0, parseInt(e.target.value)||0)}))}    color="text-orange-600 border-orange-300" />
                            <ThresholdInput label="緊急" value={thresholds.urgent} onChange={e => setThresholds(t => ({...t, urgent: Math.max(0, parseInt(e.target.value)||0)}))} color="text-red-600 border-red-300" />
                        </div>
                    </div>
                </div>

                <div className="flex gap-3">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-bold text-sm bg-gray-100 text-gray-600 hover:bg-gray-200">取消</button>
                    <button onClick={handleSave} disabled={saving}
                        className="flex-1 py-2.5 rounded-lg font-bold text-sm bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
                        {saving ? '儲存中...' : '新增'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ----------------------------------------------------------------------
// LogModal — 庫存異動紀錄
// ----------------------------------------------------------------------
const LogModal = ({ isOpen, onClose, item, logs, isLoading }) => {
    if (!isOpen || !item) return null;
    const fmtTime = (iso) => {
        const d = new Date(iso);
        return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col relative">
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-700">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
                <h3 className="text-2xl font-black mb-1 text-gray-800">📒 {item.name}</h3>
                <p className="text-xs text-gray-400 mb-4">近 3 天異動紀錄（最新在最上）</p>
                {isLoading ? (
                    <div className="flex-grow flex items-center justify-center text-gray-400">載入中...</div>
                ) : logs.length === 0 ? (
                    <div className="flex-grow flex items-center justify-center text-gray-400">無紀錄</div>
                ) : (
                    <div className="overflow-y-auto flex-grow">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 sticky top-0">
                                <tr>
                                    <th className="px-3 py-2 text-left text-gray-500 font-bold">時間</th>
                                    <th className="px-3 py-2 text-center text-gray-500 font-bold w-20">變動</th>
                                    <th className="px-3 py-2 text-left text-gray-500 font-bold">備註</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {logs.map(log => (
                                    <tr key={log.id} className="hover:bg-gray-50">
                                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtTime(log.createdAt)}</td>
                                        <td className={`px-3 py-2 text-center font-black whitespace-nowrap ${log.changeAmount > 0 ? 'text-emerald-600' : log.changeAmount < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                                            {log.changeAmount > 0 ? `+${log.changeAmount}` : log.changeAmount}
                                        </td>
                                        <td className="px-3 py-2 text-gray-600">{log.note || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <button onClick={onClose} className="mt-4 w-full py-2 rounded-xl bg-gray-200 text-gray-700 font-bold hover:bg-gray-300">關閉</button>
            </div>
        </div>
    );
};

// ----------------------------------------------------------------------
// Card & FilterButton
// ----------------------------------------------------------------------
const Card = ({ title, count, color, onClick, isActive, icon }) => {
    const baseColor = { green: 'border-green-500 text-green-700 bg-green-50/50', orange: 'border-orange-600 text-orange-700 bg-orange-50/50', red: 'border-red-600 text-red-700 bg-red-50/50' };
    const mainColor = { green: 'text-green-600', orange: 'text-orange-600', red: 'text-red-600' };
    return (
        <button onClick={onClick} className={`w-full bg-white p-5 rounded-xl shadow-lg border-l-4 transition-all text-left ${baseColor[color]} ${isActive ? 'ring-2 ring-offset-2 ring-blue-500 shadow-xl scale-[1.01] border-l-8' : 'hover:scale-[1.01] hover:shadow-xl'}`}>
            <div className="flex justify-between items-center mb-1">
                <p className="text-sm font-bold">{title}</p>
                <div className={`p-2 rounded-full bg-opacity-80 ${mainColor[color]}`}>{icon}</div>
            </div>
            <p className="text-3xl font-black text-gray-800">{count} 項</p>
        </button>
    );
};

const FilterButton = ({ label, status, currentStatus, onClick }) => (
    <button onClick={() => onClick(status)}
        className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors ${currentStatus === status ? 'bg-blue-600 text-white shadow-md hover:bg-blue-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
        {label}
    </button>
);

// ----------------------------------------------------------------------
// InventoryPage
// ----------------------------------------------------------------------
const InventoryPage = () => {
    const [inventory, setInventory] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState('全部');
    const [isOperationModalOpen, setIsOperationModalOpen] = useState(false);
    const [isThresholdModalOpen, setIsThresholdModalOpen] = useState(false);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isLogModalOpen, setIsLogModalOpen] = useState(false);
    const [logModalLogs, setLogModalLogs] = useState([]);
    const [isLogLoading, setIsLogLoading] = useState(false);
    const [selectedItem, setSelectedItem] = useState(null);
    const [allMenuItems, setAllMenuItems] = useState([]);

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            const [invItems, menuItems] = await Promise.all([getInventoryItems(), getMenuItems()]);
            // 若 sort_order 全部相同（初始狀態），自動指定流水號並寫入
            const allSame = invItems.length > 1 && invItems.every(i => i.sortOrder === invItems[0].sortOrder);
            let items = invItems;
            if (allSame) {
                items = invItems.map((item, i) => ({ ...item, sortOrder: i }));
                await Promise.all(items.map(item => updateMenuItem(item.id, { sortOrder: item.sortOrder })));
            }
            setInventory(items.map(item => ({ ...item, thresholds: item.thresholds || DEFAULT_THRESHOLDS })));
            setAllMenuItems(menuItems);
        } catch (e) {
            console.error('載入庫存資料失敗', e);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const inventoryConsumesMapping = useMemo(() =>
        allMenuItems.reduce((acc, mi) => {
            (mi.consumes || []).forEach(invId => {
                if (!acc[invId]) acc[invId] = [];
                acc[invId].push(mi);
            });
            return acc;
        }, {}),
    [allMenuItems]);

    const getStockStatus = useCallback((item) => {
        const { stock } = item;
        const { low, urgent } = item.thresholds || DEFAULT_THRESHOLDS;
        if (stock <= urgent) return { status: '緊急', display: '極需補貨', badge: 'bg-red-600' };
        if (stock < low)    return { status: '偏低', display: '庫存偏低', badge: 'bg-orange-500' };
        return                     { status: '充足', display: '庫存充足', badge: 'bg-green-500' };
    }, []);

    const handleStockSave = useCallback(async (id, newStock, opType) => {
        const item = inventory.find(i => i.id === id);
        const oldStock = item?.stock ?? 0;
        const delta = newStock - oldStock;
        const noteMap = { replenish: '補貨', consume: '消耗', inventory: '盤點' };
        try {
            await updateMenuItem(id, { stock: newStock });
            setInventory(prev => prev.map(i => i.id === id ? { ...i, stock: newStock } : i));
        } catch (e) { alert('儲存失敗：' + e.message); return; }
        if (delta !== 0) {
            try {
                await addInventoryLog(id, item?.name, delta, noteMap[opType] || opType || '手動調整');
            } catch (e) { console.error('紀錄寫入失敗:', e.message); }
        }
    }, [inventory]);

    const handleThresholdSave = useCallback(async (id, newThresholds) => {
        try {
            await updateMenuItem(id, { thresholds: newThresholds });
            setInventory(prev => prev.map(item => item.id === id ? { ...item, thresholds: newThresholds } : item));
        } catch (e) { alert('儲存失敗：' + e.message); }
    }, []);

    // 儲存菜單連動（更新食物品項的 consumes 欄位）
    const handleLinksUpdate = useCallback(async (inventoryItemId, selectedFoodItemIds) => {
        const selectedSet = new Set(selectedFoodItemIds);
        const toUpdate = allMenuItems
            .map(mi => {
                const currentConsumes = mi.consumes || [];
                const hasLink = currentConsumes.includes(inventoryItemId);
                const shouldHave = selectedSet.has(mi.id);
                if (hasLink === shouldHave) return null;
                return {
                    id: mi.id,
                    consumes: shouldHave
                        ? [...currentConsumes, inventoryItemId]
                        : currentConsumes.filter(id => id !== inventoryItemId),
                };
            })
            .filter(Boolean);

        if (toUpdate.length === 0) { alert('無變更'); return; }
        try {
            await Promise.all(toUpdate.map(u => updateMenuItem(u.id, { consumes: u.consumes })));
            setAllMenuItems(prev => prev.map(mi => {
                const upd = toUpdate.find(u => u.id === mi.id);
                return upd ? { ...mi, consumes: upd.consumes } : mi;
            }));
            alert(`連動設定已儲存（${toUpdate.length} 個品項更新）`);
        } catch (e) { alert('儲存失敗：' + e.message); }
    }, [allMenuItems]);

    const handleAddItem = async (newItem) => {
        try {
            const added = await addMenuItem(newItem);
            setInventory(prev => [...prev, { ...added, thresholds: newItem.thresholds || DEFAULT_THRESHOLDS }]);
        } catch (e) { alert('新增失敗：' + e.message); }
    };

    const moveItem = async (id, direction) => {
        const item = inventory.find(i => i.id === id);
        if (!item) return;
        // 同類別內排序
        const sameCategory = [...inventory]
            .filter(i => i.category === item.category)
            .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
        const idx = sameCategory.findIndex(i => i.id === id);
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= sameCategory.length) return;
        const a = sameCategory[idx];
        const b = sameCategory[targetIdx];
        const aOrder = a.sortOrder ?? 99;
        const bOrder = b.sortOrder ?? 99;
        setInventory(prev => prev.map(i => {
            if (i.id === a.id) return { ...i, sortOrder: bOrder };
            if (i.id === b.id) return { ...i, sortOrder: aOrder };
            return i;
        }));
        await Promise.all([
            updateMenuItem(a.id, { sortOrder: bOrder }),
            updateMenuItem(b.id, { sortOrder: aOrder }),
        ]);
    };

    const handleOpenLogs = async (item) => {
        setSelectedItem(item);
        setIsLogModalOpen(true);
        setIsLogLoading(true);
        setLogModalLogs([]);
        try {
            const logs = await getInventoryLogs(item.id);
            setLogModalLogs(logs);
        } catch (e) { console.error(e); }
        finally { setIsLogLoading(false); }
    };

    const handleDeleteItem = async (id, name) => {
        if (!window.confirm(`確定刪除「${name}」？此操作無法復原。`)) return;
        try {
            await deleteMenuItem(id);
            setInventory(prev => prev.filter(item => item.id !== id));
        } catch (e) { alert('刪除失敗：' + e.message); }
    };

    const existingCategories = useMemo(() => [...new Set(inventory.map(i => i.category))], [inventory]);

    const filteredInventory = useMemo(() => {
        if (filterStatus === '全部') return inventory;
        return inventory.filter(item => getStockStatus(item).status === filterStatus);
    }, [inventory, filterStatus, getStockStatus]);

    const groupedInventory = useMemo(() =>
        filteredInventory.reduce((acc, item) => {
            (acc[item.category] = acc[item.category] || []).push(item);
            return acc;
        }, {}),
    [filteredInventory]);

    const summary = useMemo(() => {
        let fullCount = 0, lowCount = 0, urgentCount = 0;
        inventory.forEach(item => {
            const { status } = getStockStatus(item);
            if (status === '緊急') urgentCount++;
            else if (status === '偏低') lowCount++;
            else fullCount++;
        });
        return { fullCount, lowCount, urgentCount };
    }, [inventory, getStockStatus]);

    if (isLoading) return (
        <div className="flex items-center justify-center h-64">
            <div className="text-gray-400 text-lg">載入中...</div>
        </div>
    );

    return (
        <div className="flex flex-col h-full w-full p-6 bg-gray-50 overflow-y-auto">
            {/* 標題 */}
            <div className="flex justify-between items-center mb-6 border-b pb-3 flex-shrink-0">
                <h2 className="text-3xl font-black text-gray-800">庫存管理</h2>
                <button
                    onClick={() => setIsAddModalOpen(true)}
                    className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-bold text-sm shadow-sm transition-colors"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                    新增品項
                </button>
            </div>

            {inventory.length === 0 ? (
                <div className="flex-grow flex flex-col items-center justify-center text-gray-400 gap-4">
                    <svg className="w-16 h-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                    <p className="text-lg font-bold">尚無庫存品項</p>
                    <p className="text-sm">點擊右上角「新增品項」開始建立庫存</p>
                </div>
            ) : (
                <>
                    {/* 狀態總覽 */}
                    <div className="grid grid-cols-3 gap-5 mb-6 flex-shrink-0">
                        <Card title="庫存充足" count={summary.fullCount}   color="green"  onClick={() => setFilterStatus('充足')} isActive={filterStatus === '充足'}
                            icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
                        <Card title="庫存偏低" count={summary.lowCount}    color="orange" onClick={() => setFilterStatus('偏低')} isActive={filterStatus === '偏低'}
                            icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 7c-.77-1.333-2.694-1.333-3.464 0L3.318 16c-.77 1.333.192 3 1.732 3z" /></svg>} />
                        <Card title="極需補貨" count={summary.urgentCount} color="red"    onClick={() => setFilterStatus('緊急')} isActive={filterStatus === '緊急'}
                            icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>} />
                    </div>

                    {/* 篩選 */}
                    <div className="flex gap-2 mb-4 flex-shrink-0">
                        {['全部','充足','偏低','緊急'].map(s => (
                            <FilterButton key={s} label={s} status={s} currentStatus={filterStatus} onClick={setFilterStatus} />
                        ))}
                    </div>

                    {/* 庫存列表（直接在最外層容器） */}
                    <table className="min-w-full divide-y divide-gray-200 bg-white rounded-xl shadow overflow-hidden">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase w-16">排序</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">品項名稱</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-2/12">類別</th>
                                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-2/12">當前庫存 (份)</th>
                                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-2/12">狀態</th>
                                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">紀錄</th>
                                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">設定</th>
                                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">刪除</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {Object.entries(groupedInventory).map(([category, items]) => {
                                const sortedItems = [...items].sort((a,b) => (a.sortOrder??99)-(b.sortOrder??99));
                                return (
                                    <React.Fragment key={category}>
                                        <tr className="bg-gray-100">
                                            <td colSpan="9" className="px-6 py-3 text-sm font-black text-gray-800 border-l-4 border-blue-600">{category}</td>
                                        </tr>
                                        {sortedItems.map((item, idx) => {
                                            const { display, badge } = getStockStatus(item);
                                            const isFirst = idx === 0;
                                            const isLast  = idx === sortedItems.length - 1;
                                            return (
                                                <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                                                    {/* 排序按鈕 */}
                                                    <td className="px-2 py-3 text-center">
                                                        <div className="flex flex-col items-center gap-0.5">
                                                            <button onClick={() => moveItem(item.id, 'up')} disabled={isFirst}
                                                                className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-20 disabled:cursor-not-allowed transition-colors">
                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 15l7-7 7 7" /></svg>
                                                            </button>
                                                            <button onClick={() => moveItem(item.id, 'down')} disabled={isLast}
                                                                className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-20 disabled:cursor-not-allowed transition-colors">
                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">{item.name}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{item.category}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-center text-lg font-black text-gray-800">{item.stock ?? 0}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-center">
                                                        <span className={`px-3 py-1 text-xs font-bold rounded-full text-white ${badge}`}>{display}</span>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-center">
                                                        <button onClick={() => { setSelectedItem(item); setIsOperationModalOpen(true); }}
                                                            className="text-emerald-600 hover:text-white hover:bg-emerald-600 transition-colors p-2 rounded-lg active:scale-95"
                                                            title="補貨／消耗／盤點">
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h3m-1 4v-3" /></svg>
                                                        </button>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-center">
                                                        <button onClick={() => handleOpenLogs(item)}
                                                            className="text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors p-2 rounded-lg"
                                                            title="查看異動紀錄">
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                                        </button>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-center">
                                                        <button onClick={() => { setSelectedItem(item); setIsThresholdModalOpen(true); }}
                                                            className="text-gray-400 hover:text-blue-600 hover:bg-gray-200 transition-colors p-2 rounded-lg"
                                                            title="設定警戒線">
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.941 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.941-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.572-1.065z" />
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                            </svg>
                                                        </button>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-center">
                                                        <button onClick={() => handleDeleteItem(item.id, item.name)}
                                                            className="text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors p-2 rounded-lg"
                                                            title="刪除品項">
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </>
            )}

            {isOperationModalOpen && selectedItem && (
                <StockOperationModal isOpen={isOperationModalOpen} onClose={() => setIsOperationModalOpen(false)} item={selectedItem} onSave={handleStockSave} />
            )}
            {isThresholdModalOpen && selectedItem && (
                <ThresholdSettingModal isOpen={isThresholdModalOpen} onClose={() => setIsThresholdModalOpen(false)} item={selectedItem} onSave={handleThresholdSave} onSaveLinks={handleLinksUpdate} allMenuItems={allMenuItems} consumesMapping={inventoryConsumesMapping} />
            )}
            {isAddModalOpen && (
                <AddItemModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onSave={handleAddItem} existingCategories={existingCategories} />
            )}
            <LogModal isOpen={isLogModalOpen} onClose={() => setIsLogModalOpen(false)} item={selectedItem} logs={logModalLogs} isLoading={isLogLoading} />
        </div>
    );
};

export default InventoryPage;
