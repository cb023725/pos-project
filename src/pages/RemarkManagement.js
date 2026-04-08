import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    getRemarkGroups,
    saveRemarkGroup,
    deleteRemarkGroup,
    getMenuItems,
} from '../db';

const CATEGORY_ORDER = ['小點', '主餐', '飲品', '冷凍包', '單點'];
const genId = () => 'rg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

// ─── 品項選擇器 ────────────────────────────────────────────────────────────────
const ItemPicker = ({ menuItems, selected, onChange, compact = false }) => {
    const byCategory = CATEGORY_ORDER.map(cat => ({
        cat,
        items: menuItems
            .filter(i => i.category === cat)
            .sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99)),
    })).filter(g => g.items.length > 0);

    const toggleItem = id =>
        onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);

    return (
        <div>
            {byCategory.map(({ cat, items }) => (
                <div key={cat} className={compact ? 'mb-1' : 'mb-2'}>
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">{cat}</div>
                    <div className="flex flex-wrap gap-1">
                        {items.map(item => {
                            const sel = selected.includes(item.id);
                            return (
                                <button key={item.id} onClick={() => toggleItem(item.id)}
                                    className={`px-2 py-0.5 rounded-lg text-sm font-bold border transition-all ${
                                        sel ? 'bg-teal-500 text-white border-teal-500' : 'bg-white text-gray-500 border-gray-200 hover:border-teal-300'
                                    }`}
                                >{item.name}</button>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
};

// ─── 新增群組 Modal ────────────────────────────────────────────────────────────
const AddGroupModal = ({ onAdd, onClose }) => {
    const [name, setName] = useState('');
    const [type, setType] = useState('single');
    const [required, setRequired] = useState(false);
    const inputRef = useRef(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const handleAdd = () => {
        if (!name.trim()) return;
        onAdd({
            id: genId(),
            name: name.trim(),
            type,
            required,
            options: [],
            appliesTo: [],
            optionItemMap: {},
        });
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
                <h2 className="text-lg font-black text-gray-800 mb-4">新增註記群組</h2>

                <div className="mb-4">
                    <label className="text-sm font-bold text-gray-600 block mb-1">群組名稱</label>
                    <input
                        ref={inputRef}
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAdd()}
                        placeholder="例：辣度"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400"
                    />
                </div>

                <div className="mb-4">
                    <label className="text-sm font-bold text-gray-600 block mb-2">選擇類型</label>
                    <div className="flex gap-2">
                        {[['single', '單選'], ['multi', '多選']].map(([v, l]) => (
                            <button key={v} onClick={() => setType(v)}
                                className={`flex-1 py-2 rounded-lg font-bold text-sm border-2 transition-all ${
                                    type === v ? 'bg-teal-500 text-white border-teal-500' : 'bg-white text-gray-500 border-gray-200'
                                }`}
                            >{l}</button>
                        ))}
                    </div>
                </div>

                <div className="mb-6 flex items-center gap-3">
                    <button onClick={() => setRequired(r => !r)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${required ? 'bg-teal-500' : 'bg-gray-200'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${required ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                    <span className="text-sm font-bold text-gray-700">必填</span>
                    <span className="text-xs text-gray-400">（點餐時強制選擇）</span>
                </div>

                <div className="flex gap-2">
                    <button onClick={onClose}
                        className="flex-1 py-2 rounded-lg font-bold text-sm bg-gray-100 text-gray-600 hover:bg-gray-200"
                    >取消</button>
                    <button onClick={handleAdd} disabled={!name.trim()}
                        className="flex-1 py-2 rounded-lg font-bold text-sm bg-teal-500 text-white hover:bg-teal-600 disabled:opacity-40"
                    >新增</button>
                </div>
            </div>
        </div>
    );
};

// ─── 單一選項列（含細項品項對應） ─────────────────────────────────────────────
const OptionRow = ({ opt, optionItemMap, menuItems, groupAppliesTo, onDelete, onMapChange }) => {
    const [expanded, setExpanded] = useState(false);
    const mappedItems = optionItemMap[opt] || [];
    const hasMap = mappedItems.length > 0;

    return (
        <div className={`border rounded-lg overflow-hidden ${expanded ? 'border-teal-200' : 'border-gray-200'}`}>
            <div className="flex items-center gap-2 px-3 py-2 bg-white">
                {/* 拖曳選項排序（未來可擴充，目前為視覺錨點） */}
                <span className="text-gray-300 select-none text-xs">⠿</span>
                <span className="flex-1 text-sm font-bold text-teal-700">{opt}</span>
                <button
                    onClick={() => setExpanded(e => !e)}
                    className={`text-xs px-2 py-0.5 rounded-full font-bold border transition-all ${
                        hasMap
                            ? 'bg-amber-50 text-amber-600 border-amber-200'
                            : 'bg-gray-50 text-gray-400 border-gray-200'
                    }`}
                >
                    {hasMap ? `指定 ${mappedItems.length} 品` : '全部品項'}
                </button>
                <button
                    onClick={() => onDelete(opt)}
                    className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-red-100 text-gray-400 hover:text-red-500 text-sm leading-none"
                >×</button>
            </div>

            {expanded && (
                <div className="border-t border-teal-100 px-3 py-2 bg-teal-50">
                    <p className="text-xs text-gray-500 mb-2">
                        <span className="font-bold text-teal-700">細項品項對應</span>：留空表示套用群組所有品項；選擇後此選項僅在這些品項出現
                    </p>
                    <ItemPicker
                        menuItems={menuItems.filter(m => groupAppliesTo.length === 0 || groupAppliesTo.includes(m.id))}
                        selected={mappedItems}
                        onChange={items => onMapChange(opt, items)}
                        compact
                    />
                    {hasMap && (
                        <button
                            onClick={() => onMapChange(opt, [])}
                            className="mt-2 text-xs text-red-500 hover:text-red-600 font-bold"
                        >清除（恢復全部品項）</button>
                    )}
                </div>
            )}
        </div>
    );
};

// ─── 群組卡片 ──────────────────────────────────────────────────────────────────
const RemarkGroupCard = ({ group, menuItems, onSave, onDelete, onMoveUp, onMoveDown, isFirst, isLast }) => {
    const [expanded, setExpanded] = useState(false);
    const [name, setName] = useState(group.name);
    const [type, setType] = useState(group.type || 'single');
    const [required, setRequired] = useState(group.required || false);
    const [appliesTo, setAppliesTo] = useState(group.appliesTo || []);
    const [options, setOptions] = useState(group.options || []);
    const [optionItemMap, setOptionItemMap] = useState(group.optionItemMap || {});
    const [newOption, setNewOption] = useState('');
    const [dirty, setDirty] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setName(group.name);
        setType(group.type || 'single');
        setRequired(group.required || false);
        setAppliesTo(group.appliesTo || []);
        setOptions(group.options || []);
        setOptionItemMap(group.optionItemMap || {});
        setDirty(false);
    }, [group]);

    const mark = () => setDirty(true);

    const addOption = () => {
        const t = newOption.trim();
        if (!t || options.includes(t)) return;
        setOptions(p => [...p, t]);
        setNewOption('');
        mark();
    };

    const removeOption = opt => {
        setOptions(p => p.filter(o => o !== opt));
        setOptionItemMap(p => { const n = { ...p }; delete n[opt]; return n; });
        mark();
    };

    const handleMapChange = (opt, items) => {
        setOptionItemMap(p => {
            const n = { ...p };
            if (items.length === 0) delete n[opt];
            else n[opt] = items;
            return n;
        });
        mark();
    };

    const handleSave = async () => {
        setSaving(true);
        await onSave({ ...group, name, type, required, options, appliesTo, optionItemMap });
        setDirty(false);
        setSaving(false);
    };

    const typeBadge = type === 'single' ? '單選' : '多選';
    const reqBadge = required ? '必填' : '可選';

    return (
        <div className="bg-white rounded-xl border shadow-sm border-gray-200">
            {/* Header row */}
            <div className="flex items-center">
                {/* 上下排序按鈕 */}
                <div className="flex flex-col gap-0.5 pl-2 flex-shrink-0">
                    <button
                        onClick={onMoveUp}
                        disabled={isFirst}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 15l7-7 7 7" />
                        </svg>
                    </button>
                    <button
                        onClick={onMoveDown}
                        disabled={isLast}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                </div>
                <button
                    onClick={() => setExpanded(e => !e)}
                    className="flex-1 flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors text-left min-w-0"
                >
                    <div className="w-9 h-9 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                        </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="font-bold text-gray-800">{name}</div>
                        <div className="flex gap-1.5 mt-0.5">
                            <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full font-bold">{typeBadge}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${required ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>{reqBadge}</span>
                        </div>
                    </div>
                    <div className="text-sm text-gray-400 max-w-[160px] truncate flex-shrink-0">
                        {options.join(' / ') || '無選項'}
                    </div>
                    <div className="text-sm text-teal-600 font-bold flex-shrink-0">{appliesTo.length} 品項</div>
                    <svg className={`w-5 h-5 text-gray-400 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                </button>
            </div>

            {/* Expanded content */}
            {expanded && (
                <div className="border-t border-gray-100 p-4 space-y-5">
                    {/* 名稱 / 類型 / 必填 */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-bold text-gray-500 block mb-1">群組名稱</label>
                            <input
                                type="text"
                                value={name}
                                onChange={e => { setName(e.target.value); mark(); }}
                                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-teal-400"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-gray-500 block mb-1">選擇類型</label>
                            <div className="flex gap-1">
                                {[['single', '單選'], ['multi', '多選']].map(([v, l]) => (
                                    <button key={v} onClick={() => { setType(v); mark(); }}
                                        className={`flex-1 py-1.5 rounded-lg text-sm font-bold border transition-all ${
                                            type === v ? 'bg-teal-500 text-white border-teal-500' : 'bg-white text-gray-500 border-gray-200'
                                        }`}
                                    >{l}</button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button onClick={() => { setRequired(r => !r); mark(); }}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${required ? 'bg-teal-500' : 'bg-gray-200'}`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${required ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                        <span className="text-sm font-bold text-gray-700">必填</span>
                        <span className="text-xs text-gray-400">點餐時需強制選擇</span>
                    </div>

                    {/* 選項列表 */}
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-bold text-gray-600">選項</span>
                            <span className="text-xs text-gray-400">可點選「全部品項」設定細項對應</span>
                        </div>
                        <div className="space-y-1.5 mb-2">
                            {options.map(opt => (
                                <OptionRow
                                    key={opt}
                                    opt={opt}
                                    optionItemMap={optionItemMap}
                                    menuItems={menuItems}
                                    groupAppliesTo={appliesTo}
                                    onDelete={removeOption}
                                    onMapChange={handleMapChange}
                                />
                            ))}
                            {options.length === 0 && (
                                <div className="text-sm text-gray-400 py-2 text-center border border-dashed border-gray-200 rounded-lg">尚無選項</div>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={newOption}
                                onChange={e => setNewOption(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && addOption()}
                                placeholder="輸入新選項…"
                                className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-teal-400"
                            />
                            <button onClick={addOption} disabled={!newOption.trim()}
                                className="px-3 py-1.5 rounded-lg text-sm font-bold bg-teal-100 text-teal-700 hover:bg-teal-200 disabled:opacity-40"
                            >新增</button>
                        </div>
                    </div>

                    {/* 群組適用品項 */}
                    <div>
                        <div className="text-sm font-bold text-gray-600 mb-2">
                            群組適用品項
                            <span className="text-xs font-normal text-gray-400 ml-2">這些品項點餐時會出現本群組選項</span>
                        </div>
                        <ItemPicker
                            menuItems={menuItems}
                            selected={appliesTo}
                            onChange={items => { setAppliesTo(items); mark(); }}
                        />
                    </div>

                    {/* 操作按鈕 */}
                    <div className="flex gap-2 pt-1 border-t border-gray-100">
                        <button
                            onClick={handleSave}
                            disabled={!dirty || saving}
                            className={`flex-1 py-2 rounded-lg font-bold text-sm transition-colors ${
                                dirty && !saving ? 'bg-teal-500 text-white hover:bg-teal-600' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            }`}
                        >
                            {saving ? '儲存中…' : '儲存'}
                        </button>
                        {showDeleteConfirm ? (
                            <>
                                <button onClick={() => setShowDeleteConfirm(false)}
                                    className="px-3 py-2 rounded-lg font-bold text-sm bg-gray-100 text-gray-600 hover:bg-gray-200"
                                >取消</button>
                                <button onClick={() => onDelete(group.id)}
                                    className="px-3 py-2 rounded-lg font-bold text-sm bg-red-500 text-white hover:bg-red-600"
                                >確認刪除</button>
                            </>
                        ) : (
                            <button onClick={() => setShowDeleteConfirm(true)}
                                className="px-4 py-2 rounded-lg font-bold text-sm bg-red-50 text-red-500 hover:bg-red-100"
                            >刪除群組</button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// ─── 主頁面 ───────────────────────────────────────────────────────────────────
const RemarkManagementPage = () => {
    const [groups, setGroups] = useState([]);
    const [menuItems, setMenuItems] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);

    const load = useCallback(async () => {
        const [g, m] = await Promise.all([getRemarkGroups(), getMenuItems()]);
        g.sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
        setGroups(g);
        setMenuItems(m);
        setIsLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleSave = async updatedGroup => {
        await saveRemarkGroup(updatedGroup);
        setGroups(prev => prev.map(g => g.id === updatedGroup.id ? updatedGroup : g));
    };

    const handleAdd = async newGroup => {
        const sortOrder = groups.length;
        const groupWithOrder = { ...newGroup, sortOrder };
        await saveRemarkGroup(groupWithOrder);
        setGroups(prev => [...prev, groupWithOrder]);
        setShowAddModal(false);
    };

    const handleDelete = async id => {
        await deleteRemarkGroup(id);
        setGroups(prev => prev.filter(g => g.id !== id));
    };

    const handleMove = async (index, direction) => {
        const target = index + direction;
        if (target < 0 || target >= groups.length) return;
        const newGroups = [...groups];
        [newGroups[index], newGroups[target]] = [newGroups[target], newGroups[index]];
        const reordered = newGroups.map((g, i) => ({ ...g, sortOrder: i }));
        setGroups(reordered);
        await saveRemarkGroup(reordered[index]);
        await saveRemarkGroup(reordered[target]);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-gray-400 text-lg">載入中...</div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto">
            {/* 頁頭 */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-teal-500 flex items-center justify-center">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                        </svg>
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-gray-800">註記管理</h1>
                        <p className="text-sm text-gray-500">設定各品項可選的備註選項</p>
                    </div>
                </div>
                <button
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center gap-2 px-4 py-2.5 bg-teal-500 text-white rounded-xl font-bold text-sm hover:bg-teal-600 transition-colors shadow-sm"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                    </svg>
                    新增群組
                </button>
            </div>

            {/* 說明 */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-sm text-blue-700">
                <strong>點選左側箭頭可調整群組順序。</strong>展開後可編輯名稱、類型、選項與適用品項。每個選項可點選標籤進一步指定對應特定品項（細項對應）。
            </div>

            {/* 群組列表 */}
            <div className="flex flex-col gap-3">
                {groups.map((group, index) => (
                    <RemarkGroupCard
                        key={group.id}
                        group={group}
                        menuItems={menuItems}
                        onSave={handleSave}
                        onDelete={handleDelete}
                        onMoveUp={() => handleMove(index, -1)}
                        onMoveDown={() => handleMove(index, 1)}
                        isFirst={index === 0}
                        isLast={index === groups.length - 1}
                    />
                ))}
                {groups.length === 0 && (
                    <div className="text-center text-gray-400 py-12 border-2 border-dashed border-gray-200 rounded-xl">
                        尚無註記群組，請點擊「新增群組」
                    </div>
                )}
            </div>

            {showAddModal && (
                <AddGroupModal onAdd={handleAdd} onClose={() => setShowAddModal(false)} />
            )}
        </div>
    );
};

export default RemarkManagementPage;
