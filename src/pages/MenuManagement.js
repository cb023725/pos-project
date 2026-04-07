// src/pages/MenuManagement.js
import React, { useState, useEffect } from 'react';
import {
    getMenuItems, getInventoryItems,
    updateMenuItem, addMenuItem, deleteMenuItem,
    getCategorySettings, saveCategorySettings, DEFAULT_CATEGORY_SETTINGS,
} from '../db';

// ======================================================================
// 輔助函式
// ======================================================================
const formatCurrency = (number) => {
    return Math.round(number).toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const getCategoryStyles = (category) => {
    const palette = [
        'bg-teal-50 text-teal-700 border-teal-200',
        'bg-amber-50 text-amber-700 border-amber-200',
        'bg-lime-50 text-lime-700 border-lime-200',
        'bg-indigo-50 text-indigo-700 border-indigo-200',
        'bg-purple-50 text-purple-700 border-purple-200',
        'bg-pink-50 text-pink-700 border-pink-200',
        'bg-orange-50 text-orange-700 border-orange-200',
        'bg-cyan-50 text-cyan-700 border-cyan-200',
    ];
    // 固定顏色對應
    const fixed = {
        '主餐': palette[0], '小點': palette[1], '飲品': palette[2],
        '冷凍包': palette[3], '單點': palette[4],
    };
    return fixed[category] || palette[Object.keys(fixed).length % palette.length];
};

const deduplicateAndFormat = (items) => {
    const map = new Map();
    items.forEach(item => {
        const key = `${item.name}-${item.category}`;
        if (!map.has(key)) {
            map.set(key, {
                ...item,
                imageUrl: item.imageUrl || '',
                price: item.price || 0,
                stock: item.stock || 0,
                consumes: item.consumes || [],
                sortOrder: item.sortOrder !== undefined ? Number(item.sortOrder) : Infinity,
            });
        }
    });
    return Array.from(map.values()).sort((a, b) => a.sortOrder - b.sortOrder);
};

// ======================================================================
// CategorySettingsModal — 每個類別的設定
// ======================================================================
const REPORT_GROUPS = ['營業額', '冷凍包'];

const CategorySettingsModal = ({ category, allCategories, onClose, onSave, onDelete }) => {
    const [form, setForm] = useState({ ...category });
    const [customReport, setCustomReport] = useState(
        REPORT_GROUPS.includes(category.reportGroup) ? '' : category.reportGroup
    );
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const reportValue = REPORT_GROUPS.includes(form.reportGroup) ? form.reportGroup : '__custom__';

    const handleReportChange = (val) => {
        if (val === '__custom__') {
            setForm(f => ({ ...f, reportGroup: customReport || '' }));
        } else {
            setForm(f => ({ ...f, reportGroup: val }));
        }
    };

    const handleCustomReport = (val) => {
        setCustomReport(val);
        setForm(f => ({ ...f, reportGroup: val }));
    };

    const toggle = (field) => setForm(f => ({ ...f, [field]: !f[field] }));

    const handleSave = () => {
        if (!form.name.trim()) { alert('類別名稱不能空白'); return; }
        const duplicate = allCategories.find(c => c.name === form.name.trim() && c.name !== category.name);
        if (duplicate) { alert('已有相同名稱的類別'); return; }
        onSave({ ...form, name: form.name.trim() });
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 relative">
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-700">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>

                <h3 className="text-2xl font-black text-gray-800 mb-5">類別設定 — {category.name}</h3>

                {/* 類別名稱 */}
                <div className="mb-4">
                    <label className="block text-sm font-bold text-gray-600 mb-1">類別名稱</label>
                    <input
                        type="text"
                        value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg p-2.5 text-base focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>

                {/* 顯示設定 */}
                <div className="mb-4 border rounded-xl p-4 bg-gray-50 space-y-3">
                    <p className="text-sm font-bold text-gray-600 mb-1">顯示於點餐頁</p>
                    {[
                        { field: 'showInDineIn', label: '內用顯示' },
                        { field: 'showInTakeout', label: '外帶顯示' },
                        { field: 'printOnKitchen', label: '廚房出單' },
                    ].map(({ field, label }) => (
                        <label key={field} className="flex items-center justify-between cursor-pointer">
                            <span className="text-base font-medium text-gray-700">{label}</span>
                            <div
                                onClick={() => toggle(field)}
                                className={`relative w-12 h-6 rounded-full transition-colors ${form[field] ? 'bg-blue-500' : 'bg-gray-300'}`}
                            >
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form[field] ? 'translate-x-7' : 'translate-x-1'}`} />
                            </div>
                        </label>
                    ))}
                </div>

                {/* 關帳分類 */}
                <div className="mb-4">
                    <label className="block text-sm font-bold text-gray-600 mb-1">關帳報表分類</label>
                    <select
                        value={reportValue}
                        onChange={e => handleReportChange(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg p-2.5 text-base mb-2"
                    >
                        {REPORT_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                        <option value="__custom__">自訂...</option>
                    </select>
                    {reportValue === '__custom__' && (
                        <input
                            type="text"
                            placeholder="輸入自訂分類名稱"
                            value={customReport}
                            onChange={e => handleCustomReport(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg p-2.5 text-base"
                        />
                    )}
                </div>

                {/* 計入總營收 / 顯示KPI（只在非營業額分類時顯示） */}
                {form.reportGroup !== '營業額' && form.reportGroup !== '' && (
                    <div className="mb-5 border rounded-xl p-4 bg-gray-50 space-y-3">
                        <label className="flex items-center justify-between cursor-pointer">
                            <div>
                                <span className="text-base font-medium text-gray-700">計入總營收</span>
                                <p className="text-xs text-gray-400 mt-0.5">
                                    {form.includeInTotal !== false ? '銷售額加入總營收計算' : '銷售額不計入總營收（如冷凍包）'}
                                </p>
                            </div>
                            <div
                                onClick={() => toggle('includeInTotal')}
                                className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ml-4 ${form.includeInTotal !== false ? 'bg-blue-500' : 'bg-gray-300'}`}
                            >
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.includeInTotal !== false ? 'translate-x-7' : 'translate-x-1'}`} />
                            </div>
                        </label>
                        <label className="flex items-center justify-between cursor-pointer">
                            <div>
                                <span className="text-base font-medium text-gray-700">顯示報表KPI卡片</span>
                                <p className="text-xs text-gray-400 mt-0.5">
                                    {form.showInKpi !== false ? '在報表頁顯示此分類的收益卡片' : '隱藏此分類的KPI卡片'}
                                </p>
                            </div>
                            <div
                                onClick={() => toggle('showInKpi')}
                                className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ml-4 ${form.showInKpi !== false ? 'bg-blue-500' : 'bg-gray-300'}`}
                            >
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.showInKpi !== false ? 'translate-x-7' : 'translate-x-1'}`} />
                            </div>
                        </label>
                    </div>
                )}

                <div className="flex justify-between items-center pt-4 border-t">
                    {onDelete && !showDeleteConfirm && (
                        <button
                            onClick={() => setShowDeleteConfirm(true)}
                            className="text-red-500 text-sm font-bold hover:underline"
                        >刪除此類別</button>
                    )}
                    {showDeleteConfirm && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-red-600 font-bold">確定刪除？</span>
                            <button onClick={onDelete} className="px-3 py-1 bg-red-500 text-white text-sm rounded-lg font-bold">刪除</button>
                            <button onClick={() => setShowDeleteConfirm(false)} className="px-3 py-1 bg-gray-200 text-sm rounded-lg">取消</button>
                        </div>
                    )}
                    {!onDelete && <div />}
                    <div className="flex gap-2 ml-auto">
                        <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300">取消</button>
                        <button onClick={handleSave} className="px-4 py-2 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700">儲存</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ======================================================================
// AddCategoryModal — 新增類別
// ======================================================================
const AddCategoryModal = ({ existingNames, onClose, onAdd }) => {
    const [name, setName] = useState('');
    const handleAdd = () => {
        const trimmed = name.trim();
        if (!trimmed) { alert('類別名稱不能空白'); return; }
        if (existingNames.includes(trimmed)) { alert('已有相同名稱的類別'); return; }
        onAdd(trimmed);
    };
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6">
                <h3 className="text-xl font-black text-gray-800 mb-4">新增類別</h3>
                <input
                    type="text"
                    autoFocus
                    placeholder="例如：年菜"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAdd()}
                    className="w-full border border-gray-300 rounded-lg p-3 text-base mb-4 focus:ring-blue-500 focus:border-blue-500"
                />
                <div className="flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300">取消</button>
                    <button onClick={handleAdd} className="px-4 py-2 text-sm font-bold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700">新增</button>
                </div>
            </div>
        </div>
    );
};

// ======================================================================
// ItemModal — 新增/編輯菜單品項
// ======================================================================
const ItemModal = ({ item, onClose, onSave, isAdding = false, inventoryItems = [], categories = [] }) => {
    const baseItem = { name: '', printName: '', price: 0, category: categories[0]?.name || '', imageUrl: '', stock: 0, consumes: [] };
    const initialData = isAdding ? baseItem : {
        ...baseItem,
        ...item,
        price: item?.price || 0,
        consumes: item?.consumes || [],
        sortOrder: item?.sortOrder !== undefined ? item.sortOrder : Infinity,
        printName: item?.printName || '',
    };
    const [formData, setFormData] = useState(initialData);
    const [submitting, setSubmitting] = useState(false);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: name === 'price' || name === 'stock' ? Math.max(0, parseFloat(value) || 0) : value,
        }));
    };

    const handleConsumeToggle = (inventoryId) => {
        setFormData(prev => {
            const current = prev.consumes;
            return {
                ...prev,
                consumes: current.includes(inventoryId)
                    ? current.filter(id => id !== inventoryId)
                    : [...current, inventoryId],
            };
        });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (submitting) return;
        if (!formData.name || formData.price <= 0) {
            alert('名稱與價格是必填且價格需大於零。');
            return;
        }
        setSubmitting(true);
        onSave(formData);
    };

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-lg relative max-h-[90vh] overflow-y-auto">
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-700" title="關閉">
                    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
                <h3 className="text-3xl font-black mb-6 text-gray-800 border-b pb-3">
                    {isAdding ? '✨ 新增菜單項目' : `🛠 編輯：${item?.name || '項目'}`}
                </h3>
                <form onSubmit={handleSubmit}>
                    <div className="mb-6 border p-5 rounded-xl bg-gray-50">
                        <h4 className="text-xl font-bold text-gray-700 mb-4 border-l-4 border-blue-400 pl-3">基本資訊</h4>
                        <div className="mb-4 flex justify-center">
                            {formData.imageUrl ? (
                                <img src={formData.imageUrl} alt="預覽圖" className="h-24 w-24 object-cover rounded-full border-2 border-gray-300 shadow-md" onError={e => { e.target.style.opacity = 0; }}/>
                            ) : (
                                <div className="h-24 w-24 bg-gray-200 rounded-full flex items-center justify-center text-sm text-gray-500">無圖片</div>
                            )}
                        </div>
                        <div className="mb-4">
                            <label className="block text-base font-medium text-gray-700">圖片 URL</label>
                            <input type="text" name="imageUrl" value={formData.imageUrl} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-lg shadow-sm p-3 text-base"/>
                        </div>
                        <div className="mb-4">
                            <label className="block text-base font-medium text-gray-700">名稱</label>
                            <input type="text" name="name" value={formData.name} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-lg shadow-sm p-3 text-base font-bold" required/>
                        </div>
                        <div className="mb-4">
                            <label className="block text-base font-medium text-gray-700">
                                出單短名
                                <span className="ml-2 text-xs text-gray-400 font-normal">（留空使用原名稱）</span>
                            </label>
                            <input type="text" name="printName" value={formData.printName || ''} onChange={handleChange} placeholder={formData.name} className="mt-1 block w-full border border-gray-300 rounded-lg shadow-sm p-3 text-base"/>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="mb-4">
                                <label className="block text-base font-medium text-gray-700">類別</label>
                                <select name="category" value={formData.category} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-lg shadow-sm p-3 text-base h-[52px]">
                                    {categories.map(cat => <option key={cat.name} value={cat.name}>{cat.name}</option>)}
                                </select>
                            </div>
                            <div className="mb-4">
                                <label className="block text-base font-medium text-gray-700">價格 ($)</label>
                                <input type="number" name="price" value={formData.price} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-lg shadow-sm p-3 text-base text-right font-black h-[52px]" min="1" required/>
                            </div>
                        </div>
                        <input type="hidden" name="stock" value={formData.stock}/>
                    </div>
                    <div className="mb-6 border p-5 rounded-xl bg-green-50">
                        <h4 className="text-xl font-bold text-gray-700 mb-4 border-l-4 border-green-500 pl-3">📦 庫存連動</h4>
                        <p className="text-sm text-gray-600 mb-3">勾選此品項售出時會消耗的庫存原料。</p>
                        <div className="space-y-4 max-h-72 overflow-y-auto pr-3">
                            {inventoryItems.length === 0 ? (
                                <p className="text-sm text-gray-400">無庫存項目</p>
                            ) : (
                                Object.entries(inventoryItems.reduce((acc, inv) => {
                                    (acc[inv.category] = acc[inv.category] || []).push(inv);
                                    return acc;
                                }, {})).map(([category, items]) => (
                                    <div key={category} className="border border-green-200 p-3 rounded-lg bg-white shadow-sm">
                                        <p className="text-base font-black text-green-800 mb-2">{category}</p>
                                        <div className="grid grid-cols-2 gap-2">
                                            {items.map(inv => (
                                                <label key={inv.id} className="flex items-center space-x-2 text-base cursor-pointer hover:bg-green-100 p-2 rounded-lg">
                                                    <input type="checkbox" checked={formData.consumes.includes(inv.id)} onChange={() => handleConsumeToggle(inv.id)} className="form-checkbox text-green-600 h-5 w-5 rounded"/>
                                                    <span className={formData.consumes.includes(inv.id) ? 'font-bold text-green-700' : 'text-gray-800'}>{inv.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                    <div className="flex justify-end space-x-4 pt-4 border-t">
                        <button type="button" onClick={onClose} className="px-6 py-3 text-base font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300">取消</button>
                        <button type="submit" disabled={submitting} className={`px-6 py-3 text-base font-bold text-white rounded-lg shadow-md transition-colors ${submitting ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}>{submitting ? '處理中...' : isAdding ? '確認新增' : '儲存變更'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// ======================================================================
// 主元件：菜單管理頁面
// ======================================================================
const MenuManagementPage = () => {
    const [menuItems, setMenuItems] = useState([]);
    const [inventoryItems, setInventoryItems] = useState([]);
    const [categories, setCategories] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const [editingItem, setEditingItem] = useState(null);
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [editingCategory, setEditingCategory] = useState(null); // category settings modal
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [filterCategory, setFilterCategory] = useState(null);

    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            const [items, invItems, catSettings] = await Promise.all([
                getMenuItems(),
                getInventoryItems(),
                getCategorySettings(),
            ]);
            const formatted = deduplicateAndFormat(items);
            setMenuItems(formatted);
            setInventoryItems(invItems);
            setCategories(catSettings);
            setFilterCategory(catSettings[0]?.name || null);
            setIsLoading(false);
        };
        loadData();
    }, []);

    // ── 類別管理 ─────────────────────────────────────────────
    const handleSaveCategory = async (updatedCat) => {
        const newCats = categories.map(c => c.name === editingCategory.name ? updatedCat : c);
        await saveCategorySettings(newCats);
        setCategories(newCats);
        if (filterCategory === editingCategory.name) setFilterCategory(updatedCat.name);
        setEditingCategory(null);
    };

    const handleDeleteCategory = async () => {
        if (menuItems.some(i => i.category === editingCategory.name)) {
            alert(`請先將「${editingCategory.name}」的所有品項移至其他類別，再刪除此類別。`);
            return;
        }
        const newCats = categories.filter(c => c.name !== editingCategory.name);
        await saveCategorySettings(newCats);
        setCategories(newCats);
        setFilterCategory(newCats[0]?.name || null);
        setEditingCategory(null);
    };

    const handleAddCategory = async (name) => {
        const newCat = {
            name,
            showInDineIn: true,
            showInTakeout: true,
            reportGroup: '營業額',
            printOnKitchen: true,
            includeInTotal: true,
            showInKpi: true,
        };
        const newCats = [...categories, newCat];
        await saveCategorySettings(newCats);
        setCategories(newCats);
        setFilterCategory(name);
        setIsAddingCategory(false);
    };

    // ── 品項管理 ─────────────────────────────────────────────
    const handleAddItem = async (newItemData) => {
        const itemToSave = {
            ...newItemData,
            stock: 0,
            consumes: newItemData.consumes || [],
            sortOrder: (menuItems.length + 1) * 10,
        };
        try {
            const added = await addMenuItem(itemToSave);
            setMenuItems(prev => deduplicateAndFormat([...prev, added]));
            setIsAddingNew(false);
            alert(`項目「${itemToSave.name}」已成功新增。`);
        } catch (error) {
            console.error('新增菜單項目失敗:', error);
            alert('新增失敗，請重試。');
        }
    };

    const handleSaveEdit = async (updatedData) => {
        const { id, consumes, stock, sortOrder, ...updates } = updatedData;
        const finalSortOrder = sortOrder !== undefined ? sortOrder : (menuItems.length + 1) * 10;
        try {
            await updateMenuItem(id, { ...updates, consumes, stock, sortOrder: finalSortOrder });
            setMenuItems(prev => deduplicateAndFormat(prev.map(item => item.id === id ? { ...updatedData, sortOrder: finalSortOrder } : item)));
            setEditingItem(null);
            alert(`項目「${updatedData.name}」已成功更新。`);
        } catch (error) {
            console.error('更新菜單失敗:', error);
            alert('更新失敗，請重試。');
        }
    };

    const handleDelete = async (id, name) => {
        if (!window.confirm(`確定要永久刪除「${name}」嗎？此操作無法復原。`)) return;
        try {
            await deleteMenuItem(id);
            setMenuItems(prev => prev.filter(item => item.id !== id));
            alert(`項目「${name}」已成功刪除。`);
        } catch (error) {
            console.error('刪除菜單項目失敗:', error);
            alert('刪除失敗，請重試。');
        }
    };

    if (isLoading) {
        return <div className="p-8 text-center text-2xl text-gray-600">菜單資料載入中...</div>;
    }

    const filteredItems = menuItems.filter(item => item.category === filterCategory);
    const currentCatSetting = categories.find(c => c.name === filterCategory);

    return (
        <div className="p-8 min-h-screen bg-gray-50">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-4xl font-black text-gray-800">菜單管理</h2>
                <button
                    onClick={() => setIsAddingNew(true)}
                    className="bg-emerald-600 text-white px-5 py-3 rounded-lg hover:bg-emerald-700 font-bold text-base shadow-md flex items-center space-x-2"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
                    <span>新增菜單項目</span>
                </button>
            </div>

            {/* 類別 Tab 導航列 */}
            <div className="mb-6 border-b border-gray-200">
                <nav className="-mb-px flex items-center space-x-2 overflow-x-auto" aria-label="Tabs">
                    {categories.map(cat => (
                        <div key={cat.name} className="flex items-center flex-shrink-0">
                            <button
                                onClick={() => setFilterCategory(cat.name)}
                                className={`whitespace-nowrap py-3 px-2 border-b-4 text-lg font-medium transition-colors duration-150
                                    ${cat.name === filterCategory
                                        ? 'border-blue-600 text-blue-600 font-black'
                                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                                    }`}
                            >
                                {cat.name} ({menuItems.filter(i => i.category === cat.name).length})
                            </button>
                            {/* 齒輪設定鈕 */}
                            <button
                                onClick={() => setEditingCategory(cat)}
                                className="ml-1 p-1 text-gray-300 hover:text-gray-500 transition-colors"
                                title={`設定「${cat.name}」`}
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                                    <circle cx="12" cy="12" r="3"/>
                                </svg>
                            </button>
                        </div>
                    ))}
                    {/* 新增類別按鈕 */}
                    <button
                        onClick={() => setIsAddingCategory(true)}
                        className="flex-shrink-0 ml-2 flex items-center gap-1 px-3 py-2 text-sm text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="新增類別"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
                        新增類別
                    </button>
                </nav>
            </div>

            {/* 當前類別設定標籤 */}
            {currentCatSetting && (
                <div className="flex flex-wrap gap-2 mb-4">
                    {[
                        { label: '內用', active: currentCatSetting.showInDineIn },
                        { label: '外帶', active: currentCatSetting.showInTakeout },
                        { label: '廚房出單', active: currentCatSetting.printOnKitchen },
                    ].map(({ label, active }) => (
                        <span key={label} className={`px-2.5 py-1 rounded-full text-xs font-bold border ${active ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-gray-100 text-gray-400 border-gray-200 line-through'}`}>
                            {label}
                        </span>
                    ))}
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold border bg-purple-50 text-purple-600 border-purple-200">
                        報表：{currentCatSetting.reportGroup}
                    </span>
                </div>
            )}

            {/* 菜單列表 */}
            <div className="bg-white p-6 rounded-xl shadow-xl overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0">
                        <tr>
                            <th className="px-3 py-2 text-left text-sm font-medium text-gray-500 uppercase tracking-wider w-[10%]">圖片</th>
                            <th className="px-3 py-2 text-left text-sm font-medium text-gray-500 uppercase tracking-wider w-[30%]">名稱</th>
                            <th className="px-3 py-2 text-center text-sm font-medium text-gray-500 uppercase tracking-wider w-[10%]">類別</th>
                            <th className="px-3 py-2 text-right text-sm font-medium text-gray-500 uppercase tracking-wider w-[15%]">價格</th>
                            <th className="px-3 py-2 w-[10%]"></th>
                            <th className="px-3 py-2 text-center text-sm font-medium text-gray-500 uppercase tracking-wider w-[25%]">操作</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {filteredItems.length > 0 ? (
                            filteredItems.map(item => (
                                <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-3 py-3 whitespace-nowrap">
                                        {item.imageUrl ? (
                                            <img src={item.imageUrl} alt={item.name} className="h-10 w-10 object-cover rounded shadow-sm" onError={e => { e.target.style.opacity = 0; }}/>
                                        ) : (
                                            <div className="h-10 w-10 bg-gray-100 rounded flex items-center justify-center text-gray-400 text-xs">圖</div>
                                        )}
                                    </td>
                                    <td className="px-3 py-3 text-base font-semibold text-gray-900">{item.name}</td>
                                    <td className="px-3 py-3 whitespace-nowrap text-base text-center">
                                        <div className="flex justify-center">
                                            <span className={`px-3 py-1 inline-flex text-sm leading-5 font-semibold rounded-full border min-w-[75px] text-center justify-center ${getCategoryStyles(item.category)}`}>
                                                {item.category}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-3 py-3 whitespace-nowrap text-base text-gray-900 font-black text-right">
                                        NT$ {formatCurrency(item.price)}
                                    </td>
                                    <td className="px-3 py-3"></td>
                                    <td className="px-3 py-3 whitespace-nowrap text-center text-base font-medium space-x-3">
                                        <button onClick={() => setEditingItem(item)} className="text-blue-600 hover:bg-blue-100 p-2 rounded-full transition-colors" title="編輯項目">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-9-4l9-9m-4 4l-9 9"/></svg>
                                        </button>
                                        <button onClick={() => handleDelete(item.id, item.name)} className="text-red-600 hover:bg-red-100 p-2 rounded-full transition-colors" title="刪除項目">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                        </button>
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan="6" className="px-3 py-8 text-center text-lg text-gray-500">
                                    {`「${filterCategory}」類別中沒有任何項目。`}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Modals */}
            {editingItem && (
                <ItemModal
                    item={editingItem}
                    onClose={() => setEditingItem(null)}
                    onSave={handleSaveEdit}
                    isAdding={false}
                    inventoryItems={inventoryItems}
                    categories={categories}
                />
            )}
            {isAddingNew && (
                <ItemModal
                    item={null}
                    onClose={() => setIsAddingNew(false)}
                    onSave={handleAddItem}
                    isAdding={true}
                    inventoryItems={inventoryItems}
                    categories={categories}
                />
            )}
            {editingCategory && (
                <CategorySettingsModal
                    category={editingCategory}
                    allCategories={categories}
                    onClose={() => setEditingCategory(null)}
                    onSave={handleSaveCategory}
                    onDelete={DEFAULT_CATEGORY_SETTINGS.some(d => d.name === editingCategory.name) ? null : handleDeleteCategory}
                />
            )}
            {isAddingCategory && (
                <AddCategoryModal
                    existingNames={categories.map(c => c.name)}
                    onClose={() => setIsAddingCategory(false)}
                    onAdd={handleAddCategory}
                />
            )}
        </div>
    );
};

export default MenuManagementPage;
