// src/pages/NianfaiAdmin.js — 年菜管理頁（控制中心）
// 對應 handoff 文件第 8 節「年菜管理頁」表格裡，開賣前階段需要的 3 個按鈕：
// 新年度初始化、修正品項（連到既有 menu management）、開賣/收單開關。
// 庫存/停售機制是下一階段的範圍，這裡先不做。
import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getSettingValue, saveSettingValue, getMenuItems, updateMenuItem } from '../db';

const NianfaiAdminPage = () => {
    const [activeYear, setActiveYear] = useState(null);
    const [seasonActive, setSeasonActive] = useState(false);
    const [items, setItems] = useState([]);
    const [newYearInput, setNewYearInput] = useState('');
    const [isInitializing, setIsInitializing] = useState(false);
    const [isToggling, setIsToggling] = useState(false);

    const load = useCallback(async () => {
        const year = await getSettingValue('nianfai_active_year', null);
        const activeYearNum = year ? parseInt(year, 10) : null;
        setActiveYear(activeYearNum);
        setNewYearInput(String((activeYearNum || new Date().getFullYear()) + 1));
        if (activeYearNum) {
            const active = await getSettingValue(`nianfai_${activeYearNum}_season_active`, 'false');
            setSeasonActive(active === 'true');
        }
        const all = await getMenuItems();
        setItems(activeYearNum ? all.filter(i => i.nianfaiYear === activeYearNum) : []);
    }, []);

    useEffect(() => { load(); }, [load]);

    // 新年度初始化：沿用去年（目前 active year）標記 nianfai_year 的品項當草稿，
    // 設成新年度但「不送出」——season_active 固定設 false，Yw 自己到菜單管理頁
    // 快速修正完（名稱、價格、要不要繼續賣）再手動按「開賣」。
    const handleInitNewYear = async () => {
        const newYear = parseInt(newYearInput, 10);
        if (!newYear) { alert('請輸入有效的年度'); return; }
        if (!window.confirm(`確定要初始化 ${newYear} 年菜嗎？\n\n會把目前標記 ${activeYear || '（無）'} 年菜的品項複製成 ${newYear} 的草稿（不會建立新品項、不會開賣）。`)) return;
        setIsInitializing(true);
        try {
            const all = await getMenuItems();
            const lastYearItems = activeYear ? all.filter(i => i.nianfaiYear === activeYear) : [];
            for (const it of lastYearItems) {
                await updateMenuItem(it.id, { nianfaiYear: newYear });
            }
            await saveSettingValue('nianfai_active_year', String(newYear));
            await saveSettingValue(`nianfai_${newYear}_season_active`, 'false');
            alert(`已初始化 ${newYear} 年菜草稿（沿用 ${lastYearItems.length} 筆去年品項），請到菜單管理頁確認/修正後再開賣。`);
            await load();
        } catch (e) {
            alert(`初始化失敗：${e.message}`);
        } finally {
            setIsInitializing(false);
        }
    };

    const handleToggleSeason = async () => {
        if (!activeYear) return;
        const next = !seasonActive;
        if (next && !window.confirm(`確定要開賣 ${activeYear} 年菜嗎？\n\n開賣後 WebPOS 點餐頁會出現「年菜」tab。`)) return;
        if (!next && !window.confirm(`確定要收單嗎？\n\n收單後 WebPOS 點餐頁的「年菜」tab 會立即隱藏。`)) return;
        setIsToggling(true);
        try {
            await saveSettingValue(`nianfai_${activeYear}_season_active`, next ? 'true' : 'false');
            setSeasonActive(next);
        } catch (e) {
            alert(`設定失敗：${e.message}`);
        } finally {
            setIsToggling(false);
        }
    };

    return (
        <div className="p-6 max-w-3xl mx-auto">
            <h2 className="text-4xl font-black text-gray-800 mb-6">🧧 年菜管理</h2>

            <div className="bg-white rounded-xl shadow p-6 mb-5">
                <h3 className="text-xl font-bold text-gray-700 mb-3">目前狀態</h3>
                <p className="text-gray-600">
                    目前年度：<span className="font-black text-gray-800">{activeYear || '（尚未設定）'}</span>
                </p>
                <p className="text-gray-600 mt-1">
                    開賣狀態：
                    <span className={`font-black ml-1 ${seasonActive ? 'text-[#4A9A7A]' : 'text-gray-400'}`}>
                        {activeYear ? (seasonActive ? '開賣中' : '未開賣／已收單') : '—'}
                    </span>
                </p>
                <p className="text-gray-600 mt-1">
                    目前年度品項數：<span className="font-black text-gray-800">{items.length}</span>
                </p>
            </div>

            <div className="bg-white rounded-xl shadow p-6 mb-5">
                <h3 className="text-xl font-bold text-gray-700 mb-3">1. 新年度初始化</h3>
                <p className="text-sm text-gray-500 mb-3">把目前年度標記為年菜的品項複製成新年度的草稿（不會開賣），複製完請到菜單管理頁修正名稱/價格/是否繼續賣。</p>
                <div className="flex items-center gap-3">
                    <input type="number" value={newYearInput} onChange={e => setNewYearInput(e.target.value)}
                        className="w-28 border border-gray-300 rounded-lg p-2.5 text-base" />
                    <button onClick={handleInitNewYear} disabled={isInitializing}
                        className="px-5 py-2.5 rounded-lg bg-[#4A9A7A] text-white font-bold disabled:opacity-50">
                        {isInitializing ? '處理中...' : '建立新年度年菜'}
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow p-6 mb-5">
                <h3 className="text-xl font-bold text-gray-700 mb-3">2. 修正品項</h3>
                <p className="text-sm text-gray-500 mb-3">品項的名稱、價格、套餐組成都在菜單管理頁編輯（品項編輯視窗會多一個「🧧 年菜」區塊）。</p>
                <Link to="/menu" className="inline-block px-5 py-2.5 rounded-lg bg-gray-700 text-white font-bold hover:bg-gray-800">
                    前往菜單管理頁
                </Link>
            </div>

            <div className="bg-white rounded-xl shadow p-6">
                <h3 className="text-xl font-bold text-gray-700 mb-3">3. 開賣 / 收單</h3>
                <p className="text-sm text-gray-500 mb-3">開賣後 WebPOS 點餐頁才會出現「年菜」tab；收單後立即隱藏（現場已無法再點年菜）。</p>
                <button onClick={handleToggleSeason} disabled={!activeYear || isToggling}
                    className={`px-5 py-2.5 rounded-lg font-bold text-white disabled:opacity-50 ${seasonActive ? 'bg-red-500 hover:bg-red-600' : 'bg-[#D47856] hover:bg-[#C46848]'}`}>
                    {isToggling ? '處理中...' : seasonActive ? '收單（隱藏年菜 tab）' : '開賣（顯示年菜 tab）'}
                </button>
            </div>
        </div>
    );
};

export default NianfaiAdminPage;
