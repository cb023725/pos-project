// src/hooks/useNianfaiSeason.js
// 年菜修正單 #01 第 2 節：單一狀態控制所有年菜畫面顯示與否，只隱藏畫面不刪資料。
// 所有年菜相關畫面都只看這個 hook 回傳的旗標，不要自己再組合 active_year/status 判斷式。
import { useState, useEffect, useCallback } from 'react';
import { getSettingValue } from '../db';

const STATUSES = ['preparing', 'selling', 'closed', 'archived'];

export default function useNianfaiSeason() {
    const [year, setYear] = useState(null);
    const [status, setStatus] = useState('archived');
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        const y = await getSettingValue('nianfai_active_year', null);
        const yearNum = y ? parseInt(y, 10) : null;
        setYear(yearNum);
        if (yearNum) {
            const s = await getSettingValue(`nianfai_${yearNum}_status`, 'archived');
            setStatus(STATUSES.includes(s) ? s : 'archived');
        } else {
            setStatus('archived');
        }
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const isArchived = !year || status === 'archived';

    return {
        year,
        status,
        loading,
        reload: load,
        // 畫面顯示旗標，對應修正單第 2 節的表格
        showTableCard:   status === 'selling' || status === 'closed',   // 桌位頁年菜卡片
        showOrderQueue:  status === 'selling' || status === 'closed',   // 年菜佇列頁／點單頁可用
        showNavEntry:    !isArchived,                                   // 導覽列「年菜」（管理頁）
        showMenuCategory: !isArchived,                                  // 菜單管理「年菜」類別
        isArchived,
    };
}
