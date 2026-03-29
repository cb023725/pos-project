import React, { useState, useEffect, useCallback } from 'react';
import {
    getRemarkGroups,
    saveRemarkGroup,
    getMenuItems,
    DEFAULT_REMARK_GROUPS,
} from '../db';

// ─── 類別順序 ────────────────────────────────────────────────────────────────
const CATEGORY_ORDER = ['小點', '主餐', '飲品', '冷凍包', '單點'];

// ─── 單一 remark group 編輯卡片 ────────────────────────────────────────────
const RemarkGroupCard = ({ group, menuItems, onSave }) => {
    const [expanded, setExpanded] = useState(false);
    const [appliesTo, setAppliesTo] = useState(group.appliesTo || []);
    const [options, setOptions] = useState(group.options || []);
    const [newOption, setNewOption] = useState('');
    const [dirty, setDirty] = useState(false);

    // 當 group 從外層更新時同步
    useEffect(() => {
        setAppliesTo(group.appliesTo || []);
        setOptions(group.options || []);
        setDirty(false);
    }, [group]);

    const toggleItem = (id) => {
        setAppliesTo(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
        setDirty(true);
    };

    const removeOption = (opt) => {
        setOptions(prev => prev.filter(o => o !== opt));
        setDirty(true);
    };

    const addOption = () => {
        const trimmed = newOption.trim();
        if (!trimmed || options.includes(trimmed)) return;
        setOptions(prev => [...prev, trimmed]);
        setNewOption('');
        setDirty(true);
    };

    const handleSave = async () => {
        await onSave({ ...group, options, appliesTo });
        setDirty(false);
    };

    const handleReset = async () => {
        const def = DEFAULT_REMARK_GROUPS.find(g => g.id === group.id);
        if (!def) return;
        setAppliesTo(def.appliesTo);
        setOptions(def.options);
        setDirty(true);
    };

    // 依類別分組 menuItems
    const byCategory = CATEGORY_ORDER.map(cat => ({
        cat,
        items: menuItems.filter(i => i.category === cat)
            .sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99)),
    })).filter(g => g.items.length > 0);

    const typeBadge = group.type === 'single' ? '單選' : '多選';
    const reqBadge = group.required ? '必填' : '可選';
    const selectedCount = appliesTo.length;

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {/* 卡片 Header */}
            <button
                onClick={() => setExpanded(e => !e)}
                className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                        </svg>
                    </div>
                    <div className="text-left">
                        <div className="font-bold text-gray-800 text-base">{group.name}</div>
                        <div className="flex gap-1.5 mt-0.5">
                            <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full font-bold">{typeBadge}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${group.required ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>{reqBadge}</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="text-sm text-gray-500 max-w-xs truncate">
                        選項：<span className="font-bold text-gray-700">{options.join(' / ')}</span>
                    </div>
                    <div className="text-sm text-teal-600 font-bold">{selectedCount} 品項</div>
                    <svg className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </button>

            {/* 展開內容 */}
            {expanded && (
                <div className="border-t border-gray-100 p-4">
                    {/* 選項編輯 */}
                    <div className="mb-4">
                        <div className="text-sm font-bold text-gray-600 mb-2">選項</div>
                        <div className="flex flex-wrap gap-2 mb-2">
                            {options.map(opt => (
                                <span key={opt} className="flex items-center gap-1 px-3 py-1 bg-teal-50 text-teal-700 rounded-full text-sm font-bold border border-teal-200">
                                    {opt}
                                    <button
                                        onClick={() => removeOption(opt)}
                                        className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-teal-200 text-teal-500 hover:text-teal-800 text-xs leading-none"
                                    >×</button>
                                </span>
                            ))}
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
                            <button
                                onClick={addOption}
                                disabled={!newOption.trim()}
                                className="px-3 py-1.5 rounded-lg text-sm font-bold bg-teal-100 text-teal-700 hover:bg-teal-200 disabled:opacity-40 disabled:cursor-not-allowed"
                            >新增</button>
                        </div>
                    </div>

                    {/* 適用品項選擇 */}
                    <div className="text-sm font-bold text-gray-600 mb-3">適用品項（點擊切換）</div>
                    {byCategory.map(({ cat, items }) => (
                        <div key={cat} className="mb-3">
                            <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1.5">{cat}</div>
                            <div className="flex flex-wrap gap-1.5">
                                {items.map(item => {
                                    const selected = appliesTo.includes(item.id);
                                    return (
                                        <button
                                            key={item.id}
                                            onClick={() => toggleItem(item.id)}
                                            className={`px-2.5 py-1 rounded-lg text-sm font-bold border transition-all ${
                                                selected
                                                    ? 'bg-teal-500 text-white border-teal-500 shadow-sm'
                                                    : 'bg-white text-gray-500 border-gray-200 hover:border-teal-300'
                                            }`}
                                        >
                                            {item.name}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}

                    {/* 操作按鈕 */}
                    <div className="flex gap-2 mt-4">
                        <button
                            onClick={handleSave}
                            disabled={!dirty}
                            className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${
                                dirty ? 'bg-teal-500 text-white hover:bg-teal-600' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            }`}
                        >
                            儲存
                        </button>
                        <button
                            onClick={handleReset}
                            className="px-4 py-2 rounded-lg font-bold text-sm bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                        >
                            重設預設
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

// ─── 主頁面 ────────────────────────────────────────────────────────────────
const RemarkManagementPage = () => {
    const [groups, setGroups] = useState([]);
    const [menuItems, setMenuItems] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const load = useCallback(async () => {
        const [g, m] = await Promise.all([getRemarkGroups(), getMenuItems()]);
        // Sort groups by DEFAULT_REMARK_GROUPS order
        const order = DEFAULT_REMARK_GROUPS.map(d => d.id);
        g.sort((a, b) => {
            const ai = order.indexOf(a.id);
            const bi = order.indexOf(b.id);
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });
        setGroups(g);
        setMenuItems(m);
        setIsLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleSave = async (updatedGroup) => {
        await saveRemarkGroup(updatedGroup);
        setGroups(prev => prev.map(g => g.id === updatedGroup.id ? updatedGroup : g));
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
            {/* 頁面標題 */}
            <div className="flex items-center gap-3 mb-6">
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

            {/* 說明 */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-sm text-blue-700">
                <strong>使用說明：</strong>展開各群組後，點擊品項名稱即可切換該群組是否適用於此品項。點餐時，點選含有適用註記的品項，系統會彈出選項視窗。
            </div>

            {/* 群組列表 */}
            <div className="flex flex-col gap-3">
                {groups.map(group => (
                    <RemarkGroupCard
                        key={group.id}
                        group={group}
                        menuItems={menuItems}
                        onSave={handleSave}
                    />
                ))}
                {groups.length === 0 && (
                    <div className="text-center text-gray-400 py-12">尚無註記群組</div>
                )}
            </div>
        </div>
    );
};

export default RemarkManagementPage;
