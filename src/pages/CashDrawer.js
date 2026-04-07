import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { getInvoices, getLastCloseTime, performDayClose } from '../db';

const BACKEND_URL = '';
const RESERVE_KEY      = 'pos_reserve_amount';
const START_INVOICE_NUM = 14760;  // 與 InvoiceManagement.js 一致

// 計算發票顯示流水號（跨期不重置，與 InvoiceManagement 邏輯相同）
const getDisplayInvoiceNum = (invoiceId, allInvoices) => {
    const sorted = [...allInvoices].sort((a, b) =>
        new Date(a.paymentTime).getTime() - new Date(b.paymentTime).getTime()
    );
    const index = sorted.findIndex(inv => inv.id === invoiceId);
    if (index === -1) return '';
    return `#-${(START_INVOICE_NUM + index).toString().padStart(8, '0')}`;
};

// 計算某發票列表中冷凍包品項的總金額
// 冷凍包判定：優先看 category，備用看 item.id 前綴或品名
const isFrozenItem = (i) =>
    i.category === '冷凍包' ||
    (i.id && (i.id.startsWith('frozen_') || i.id === 'xo_sauce' || i.id === 'casher')) ||
    (i.name && i.name.startsWith('[冷凍包]'));

const calcFrozenAmount = (invList) =>
    invList.reduce((sum, inv) =>
        sum + (inv.itemsSnapshot || [])
            .filter(isFrozenItem)
            .reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0), 0);
const PASSWORD_KEY     = 'pos_cash_password';
const TX_KEY           = 'pos_pending_transactions';
const CLOSE_REPORT_KEY = 'pos_last_close_report';

const DEFAULT_PASSWORD = '1234';
const DEFAULT_RESERVE  = 3000;
const LONG_PRESS_MS    = 600;

const fmt = (n) => Math.round(n || 0).toLocaleString('en-US');

const globalStyle = `
    input::-webkit-outer-spin-button,
    input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    input[type=number] { -moz-appearance: textfield; }
    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        15%  { transform: translateX(-8px); }
        35%  { transform: translateX(8px); }
        55%  { transform: translateX(-5px); }
        75%  { transform: translateX(5px); }
    }
    .pin-shake { animation: shake 0.45s ease-in-out; }
`;

// ─────────────────────────────────────────────────────────────────────────────
// 密碼鍵盤 Modal
// ─────────────────────────────────────────────────────────────────────────────
const PinModal = ({ title, onSuccess, onCancel }) => {
    const [pin, setPin] = useState('');
    const [shake, setShake] = useState(false);

    const verify = useCallback((p) => {
        const stored = localStorage.getItem(PASSWORD_KEY) || DEFAULT_PASSWORD;
        if (p === stored) {
            onSuccess();
        } else {
            setShake(true);
            setPin('');
            setTimeout(() => setShake(false), 500);
        }
    }, [onSuccess]);

    const handleNum = (n) => {
        if (shake) return;
        const next = pin + n;
        if (next.length > 4) return;
        setPin(next);
        if (next.length === 4) {
            setTimeout(() => verify(next), 80);
        }
    };

    const handleBack = () => {
        if (shake) return;
        setPin(p => p.slice(0, -1));
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-2xl shadow-2xl w-72 font-sans relative">
                {/* 關閉 X */}
                <button
                    onClick={onCancel}
                    className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors text-lg leading-none"
                >✕</button>

                <h3 className="text-lg font-black mb-5 text-center text-gray-800 pr-6">{title}</h3>

                {/* 點點顯示 */}
                <div className={`flex justify-center gap-4 mb-6 ${shake ? 'pin-shake' : ''}`}>
                    {[0, 1, 2, 3].map(i => (
                        <div key={i} className={`w-5 h-5 rounded-full border-2 transition-all duration-100
                            ${i < pin.length
                                ? (shake ? 'bg-red-500 border-red-500' : 'bg-blue-600 border-blue-600')
                                : 'bg-white border-gray-300'}`} />
                    ))}
                </div>

                {/* 數字鍵盤 */}
                <div className="grid grid-cols-3 gap-2">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                        <button key={n} onClick={() => handleNum(String(n))}
                            className="py-4 rounded-xl bg-gray-100 font-black text-xl hover:bg-gray-200 active:scale-95 transition-all">
                            {n}
                        </button>
                    ))}
                    <button onClick={handleBack}
                        className="py-4 rounded-xl bg-yellow-100 text-yellow-700 font-black hover:bg-yellow-200 active:scale-95 transition-all">⌫</button>
                    <button onClick={() => handleNum('0')}
                        className="py-4 rounded-xl bg-gray-100 font-black text-xl hover:bg-gray-200 active:scale-95 transition-all">0</button>
                    <button onClick={() => setPin('')}
                        className="py-4 rounded-xl bg-red-100 text-red-500 font-black hover:bg-red-200 active:scale-95 transition-all">清空</button>
                </div>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// 主頁面
// ─────────────────────────────────────────────────────────────────────────────
const CashDrawerPage = () => {

    // ── 結算狀態（需在 periodStart 之前宣告） ─────────────────────────────────
    const [withdrawalAmount, setWithdrawalAmount] = useState(0);
    const [discrepancyNote, setDiscrepancyNote]   = useState('');
    const [isClosed, setIsClosed]                 = useState(false);

    // ── 關帳區間 ──────────────────────────────────────────────────────────────
    // 首次：今日 00:00；爾後：上次關帳時間
    const periodStart = useMemo(() => {
        const last = getLastCloseTime();
        if (last) return last;
        const d = new Date(); d.setHours(0, 0, 0, 0);
        return d.getTime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isClosed]);

    const periodStartLabel = useMemo(() => {
        const d = new Date(periodStart);
        return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }, [periodStart]);

    // ── 發票 ──────────────────────────────────────────────────────────────────
    const [invoices, setInvoices] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    // ── 臨時收支 ──────────────────────────────────────────────────────────────
    const [transactions, setTransactions] = useState(() => {
        const saved = localStorage.getItem(TX_KEY);
        return saved ? JSON.parse(saved) : [];
    });
    const [newNote, setNewNote]     = useState('');
    const [newAmount, setNewAmount] = useState('');
    const [newType, setNewType]     = useState('expense');

    // ── 點鈔 ──────────────────────────────────────────────────────────────────
    const denoms = [1000, 500, 100, 50, 10, 5, 1];
    const inputRefs = useRef({});
    const [denominations, setDenominations] = useState({ 1000: 0, 500: 0, 100: 0, 50: 0, 10: 0, 5: 0, 1: 0 });

    // ── 零用金 ────────────────────────────────────────────────────────────────
    const [reserveAmount, setReserveAmount] = useState(() => {
        const v = localStorage.getItem(RESERVE_KEY);
        return v !== null ? parseInt(v, 10) : DEFAULT_RESERVE;
    });
    const reserveTimerRef      = useRef(null);
    const reserveDidLongPress  = useRef(false);
    const [editReserveOpen, setEditReserveOpen]   = useState(false);
    const [editReserveInput, setEditReserveInput] = useState('');

    // ── 密碼 Modal ────────────────────────────────────────────────────────────
    // purpose: null | 'drawer' | 'edit-reserve'
    const [pinModal, setPinModal] = useState(null);
    const [drawerMsg, setDrawerMsg] = useState(null); // null | 'ok' | 'fail'

    const expenseOptions  = ["冠成", "楓康", "銘利行", "晉新", "小北", "午餐", "晚餐", "市場", "樹森", "米食家", "開元", "瓦斯", "彩券(私人)"];
    const incomeOptions   = ["退瓶", "廢油"];
    const nonCashOptions  = ["轉帳", "訂金"];

    // ── 資料載入 ──────────────────────────────────────────────────────────────
    useEffect(() => { loadInvoices(); }, []);

    useEffect(() => {
        localStorage.setItem(TX_KEY, JSON.stringify(transactions));
    }, [transactions]);

    const loadInvoices = async () => {
        setIsLoading(true);
        try {
            setInvoices(await getInvoices());
        } catch (e) { console.error(e); }
        finally { setIsLoading(false); }
    };

    // ── 本期發票分組 ──────────────────────────────────────────────────────────
    const periodInvoices = useMemo(() =>
        invoices.filter(inv => new Date(inv.paymentTime).getTime() >= periodStart),
        [invoices, periodStart]);

    const activeInvoices = useMemo(() => periodInvoices.filter(i => i.status === '已開立'), [periodInvoices]);
    const voidedInvoices = useMemo(() => periodInvoices.filter(i => i.status === '已作廢'), [periodInvoices]);

    // periodGrossSales 用於錢款核算（active + voided 以確保帳對得上）
    const periodGrossSales = useMemo(() =>
        activeInvoices.reduce((s, i) => s + i.amount, 0) + voidedInvoices.reduce((s, i) => s + i.amount, 0),
        [activeInvoices, voidedInvoices]);
    const periodVoided = useMemo(() => voidedInvoices.reduce((s, i) => s + i.amount, 0), [voidedInvoices]);

    // ── UI 顯示用（含作廢，總覽用） ──────────────────────────────────────────
    const periodAllFrozenSales = useMemo(() =>
        calcFrozenAmount(activeInvoices) + calcFrozenAmount(voidedInvoices),
        [activeInvoices, voidedInvoices]);

    // ── 列印用（只算已開立，扣除冷凍包） ─────────────────────────────────────
    const periodNetSales = useMemo(() =>
        activeInvoices.reduce((s, i) => s + i.amount, 0),
        [activeInvoices]);
    const periodFrozenSales = useMemo(() =>
        calcFrozenAmount(activeInvoices),          // 列印只算已開立
        [activeInvoices]);
    const periodRegularSales = useMemo(() =>
        periodNetSales - periodFrozenSales,
        [periodNetSales, periodFrozenSales]);

    // ── 收支彙總 ──────────────────────────────────────────────────────────────
    const summary = useMemo(() =>
        transactions.reduce((acc, t) => {
            if (t.type === 'income')    acc.income   += t.amount;
            if (t.type === 'expense')   acc.expense  += t.amount;
            if (t.type === 'non-cash')  acc.nonCash  += t.amount;
            return acc;
        }, { income: 0, expense: 0, nonCash: 0 }),
        [transactions]);

    // ── 計算 ──────────────────────────────────────────────────────────────────
    const cashTotal = useMemo(() =>
        Object.entries(denominations).reduce((s, [v, c]) => s + Number(v) * c, 0),
        [denominations]);

    // 現金應有 = 零用金 + 毛營業額 + 臨時收入 - 臨時支出 - 非現金 - 現金作廢
    const expectedCash = reserveAmount + periodGrossSales + summary.income
                       - summary.expense - summary.nonCash - periodVoided;
    const diff         = cashTotal - expectedCash;
    const finalReserve = cashTotal - withdrawalAmount;
    const canComplete  = diff === 0 || (diff !== 0 && discrepancyNote.trim().length > 0);

    // ── 開錢櫃 ────────────────────────────────────────────────────────────────
    const openDrawer = useCallback(async () => {
        try {
            const res  = await fetch(`${BACKEND_URL}/api/cash-drawer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                setDrawerMsg('fail');
                setTimeout(() => setDrawerMsg(null), 3000);
                alert(`開錢箱失敗：${data.message || res.status}`);
            } else {
                setDrawerMsg('ok');
                setTimeout(() => setDrawerMsg(null), 2000);
            }
        } catch (e) {
            setDrawerMsg('fail');
            setTimeout(() => setDrawerMsg(null), 3000);
            alert(`開錢箱連線失敗：${e.message}`);
        }
    }, []);

    // ── 密碼成功 ──────────────────────────────────────────────────────────────
    const handlePinSuccess = useCallback(() => {
        const purpose = pinModal?.purpose;
        setPinModal(null);
        if (purpose === 'drawer') {
            openDrawer();
        } else if (purpose === 'edit-reserve') {
            setEditReserveInput(String(reserveAmount));
            setEditReserveOpen(true);
        }
    }, [pinModal, openDrawer, reserveAmount]);

    // ── 新增臨時收支 ──────────────────────────────────────────────────────────
    const handleAddTransaction = () => {
        const amt = parseFloat(newAmount);
        if (!newNote || isNaN(amt) || amt <= 0) return;
        setTransactions(prev => [...prev, { id: Date.now(), type: newType, note: newNote, amount: amt }]);
        setNewNote(''); setNewAmount('');
    };

    // ── 長按預留零用金 ────────────────────────────────────────────────────────
    const startReserveLongPress = () => {
        reserveDidLongPress.current = false;
        reserveTimerRef.current = setTimeout(() => {
            reserveDidLongPress.current = true;
            setPinModal({ purpose: 'edit-reserve' });
        }, LONG_PRESS_MS);
    };
    const cancelReserveLongPress = () => clearTimeout(reserveTimerRef.current);

    // ── 儲存零用金 ────────────────────────────────────────────────────────────
    const handleSaveReserve = () => {
        const v = parseInt(editReserveInput, 10);
        if (!isNaN(v) && v >= 0) {
            setReserveAmount(v);
            localStorage.setItem(RESERVE_KEY, String(v));
        }
        setEditReserveOpen(false);
    };

    // ── 送出列印關帳單 ────────────────────────────────────────────────────────
    const sendPrintClose = useCallback(async (closeData) => {
        try {
            const r = await fetch(`${BACKEND_URL}/print-close`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(closeData),
            });
            if (!r.ok) {
                const d = await r.json().catch(() => ({}));
                alert(`關帳列印失敗：${d.error || r.status}`);
            }
        } catch (e) {
            alert(`關帳列印連線失敗：${e.message}`);
        }
    }, []);

    // ── 關帳 ──────────────────────────────────────────────────────────────────
    const handleFinalSubmit = async () => {
        // 已關帳 → 重新列印上次的關帳單
        if (isClosed) {
            const saved = localStorage.getItem(CLOSE_REPORT_KEY);
            if (saved) await sendPrintClose(JSON.parse(saved));
            return;
        }

        if (!canComplete) return;
        if (!window.confirm(
            '確定執行關帳？\n\n' +
            '• 訂單流水號將從 001 重新計算\n' +
            '• 本期臨時收支記錄將清空\n' +
            `• 下期零用金設為 $${fmt(finalReserve)}`
        )) return;

        // 在清空 transactions 前先組好關帳資料
        const periodEnd = Date.now();

        // ── 除錯輸出（確認資料是否正確，開發完成後可移除） ───────────────────
        console.log('[關帳] invoices 總數:', invoices.length);
        console.log('[關帳] activeInvoices 數:', activeInvoices.length);
        console.log('[關帳] activeInvoices ids:', activeInvoices.map(i => i.id));
        console.log('[關帳] periodFrozenSales:', periodFrozenSales);
        if (activeInvoices.length > 0) {
            console.log('[關帳] 第一張發票 itemsSnapshot:', JSON.stringify(activeInvoices[0].itemsSnapshot?.slice(0,3)));
        }

        // 計算發票號碼區間（與 InvoicePage 相同的 #-XXXXXXXX 格式）
        const makeInvoiceRange = (invList) => {
            const nums = invList.map(i => {
                const num = getDisplayInvoiceNum(i.id, invoices);
                console.log(`[關帳] invoice id=${i.id} → display=${num}`);
                return num;
            }).filter(Boolean).sort();
            console.log('[關帳] invoiceRange nums:', nums);
            if (nums.length === 0) return '';
            if (nums.length === 1) return nums[0];
            return `${nums[0]}～${nums[nums.length - 1]}`;
        };

        const closeData = {
            periodStart,
            periodEnd,
            // 營業日期用 periodEnd（關帳當日，非跨日）
            activeCount:   activeInvoices.length,
            invoiceRange:  makeInvoiceRange(activeInvoices),   // '#-00014763～#-00014765'
            voidedCount:   voidedInvoices.length,
            voidedNums:    voidedInvoices.map(i => getDisplayInvoiceNum(i.id, invoices)).filter(Boolean).sort(),
            voidedAmount:  periodVoided,
            sales:        periodRegularSales,   // 已開立，不含冷凍包
            frozenSales:  periodFrozenSales,    // 冷凍包專屬
            diff,                               // 短溢金額（0 = 無差異）
            discrepancyNote: discrepancyNote.trim(),
            withdrawalAmount,
            reserveAmount: finalReserve,
            // 外部支出（record-only）不影響錢款，但仍列入印單紀錄，加「外」標記區別
            expenses: [
                ...transactions.filter(t => t.type === 'expense')
                    .map(t => ({ note: t.note, amount: t.amount, external: false })),
                ...transactions.filter(t => t.type === 'record-only')
                    .map(t => ({ note: t.note, amount: t.amount, external: true })),
            ],
            incomes:  transactions.filter(t => t.type === 'income') .map(t => ({ note: t.note, amount: t.amount })),
        };
        localStorage.setItem(CLOSE_REPORT_KEY, JSON.stringify(closeData));

        await performDayClose();
        localStorage.setItem(RESERVE_KEY, String(finalReserve));
        setTransactions([]);
        localStorage.removeItem(TX_KEY);
        setIsClosed(true);

        await sendPrintClose(closeData);
    };

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div className="p-6 bg-gray-50 min-h-screen font-sans text-gray-800">
            <style>{globalStyle}</style>

            <div className="max-w-7xl mx-auto">

                {/* ── Header ─────────────────────────────────────────────── */}
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h2 className="text-2xl font-black text-gray-900">關帳結算</h2>
                        <p className="text-xs text-gray-400 font-bold mt-0.5">
                            本期區間：{periodStartLabel} 起至今
                        </p>
                    </div>
                    <button
                        onClick={() => setPinModal({ purpose: 'drawer' })}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold shadow transition-colors
                            ${drawerMsg === 'ok'   ? 'bg-green-600 text-white'
                            : drawerMsg === 'fail' ? 'bg-red-500 text-white'
                            : 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800'}`}
                    >
                        {drawerMsg === 'ok' ? (
                            <>✓ 已開啟</>
                        ) : drawerMsg === 'fail' ? (
                            <>✕ 開啟失敗</>
                        ) : (
                            <>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                                    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="2" y="7" width="20" height="14" rx="2"/>
                                    <path d="M16 7V5a2 2 0 00-4 0v2"/>
                                    <circle cx="12" cy="14" r="2"/>
                                </svg>
                                開錢櫃
                            </>
                        )}
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                    {/* ── 左側：收支表單 + 明細 ────────────────────────── */}
                    <div className="lg:col-span-8 space-y-6">

                        {/* 新增臨時收支 */}
                        <div className="bg-white rounded-2xl p-4 border-l-4 border-amber-700 shadow-sm">
                            <h3 className="text-gray-500 text-lg font-black uppercase mb-4 tracking-widest">新增臨時收支</h3>
                            <div className="flex gap-2 mb-4">
                                {[
                                    { id: 'expense',     label: '支出',    activeColor: 'bg-red-500'    },
                                    { id: 'income',      label: '收入',    activeColor: 'bg-green-600'  },
                                    { id: 'non-cash',    label: '非現金',  activeColor: 'bg-purple-600' },
                                    { id: 'record-only', label: '外部支出', activeColor: 'bg-gray-600'  },
                                ].map(type => (
                                    <button key={type.id} onClick={() => setNewType(type.id)}
                                        className={`flex-1 py-2 rounded-xl font-bold transition-all
                                            ${newType === type.id
                                                ? `${type.activeColor} text-white shadow-lg`
                                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                                        {type.label}
                                    </button>
                                ))}
                            </div>
                            <div className="flex flex-wrap gap-2 mb-4 p-2 bg-gray-50 rounded-lg">
                                {(newType === 'income'   ? incomeOptions
                                  : newType === 'non-cash' ? nonCashOptions
                                  : expenseOptions
                                ).map(opt => (
                                    <button key={opt} onClick={() => setNewNote(opt)}
                                        className={`px-4 py-1 rounded-lg text-[13px] font-bold border transition-colors
                                            ${newNote === opt ? 'bg-amber-700 text-white border-amber-700' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                                        {opt}
                                    </button>
                                ))}
                            </div>
                            <div className="flex gap-3">
                                <input type="text" placeholder="項目說明" value={newNote}
                                    onChange={e => setNewNote(e.target.value)}
                                    className="flex-1 p-2 bg-gray-50 border rounded-xl font-bold outline-none focus:ring-2 focus:ring-amber-200" />
                                <input type="number" inputMode="numeric" pattern="[0-9]*" placeholder="金額"
                                    value={newAmount} onChange={e => setNewAmount(e.target.value)}
                                    className="w-32 p-2 bg-gray-50 border rounded-xl font-bold outline-none focus:ring-2 focus:ring-amber-200" />
                                <button onClick={handleAddTransaction}
                                    className="px-8 py-2 bg-amber-700 text-white rounded-xl font-black hover:bg-amber-900 transition-all">
                                    新增
                                </button>
                            </div>
                        </div>

                        {/* 本期明細 */}
                        <div className="bg-white rounded-xl shadow-sm border p-6 min-h-[300px]">
                            <h3 className="text-gray-500 text-lg font-black mb-4 uppercase tracking-widest">本期明細</h3>
                            <div className="space-y-3">
                                {transactions.length === 0 && voidedInvoices.length === 0 && (
                                    <div className="text-center py-10 text-gray-300 font-bold italic">尚無紀錄項目</div>
                                )}
                                {transactions.map(t => (
                                    <div key={t.id}
                                        className="flex justify-between items-center p-4 bg-gray-50 rounded-2xl group hover:bg-gray-100 transition-all">
                                        <div className="flex items-center gap-4">
                                            <span className={`px-2 py-1 rounded text-[10px] font-black uppercase
                                                ${t.type === 'expense'     ? 'text-red-500 bg-red-50'
                                                : t.type === 'income'      ? 'text-green-600 bg-green-50'
                                                : t.type === 'record-only' ? 'text-gray-500 bg-gray-200'
                                                :                            'text-purple-600 bg-purple-50'}`}>
                                                {t.type === 'expense' ? '支出' : t.type === 'income' ? '收入' : t.type === 'non-cash' ? '非現金' : '外部'}
                                            </span>
                                            <span className="font-bold text-gray-700">{t.note}</span>
                                        </div>
                                        <div className="flex items-center gap-6">
                                            <span className={`font-mono font-black
                                                ${t.type === 'income'      ? 'text-green-600'
                                                : t.type === 'record-only' ? 'text-gray-400'
                                                :                            'text-red-500'}`}>
                                                {t.type === 'income' ? '+' : t.type === 'record-only' ? '•' : '-'}${fmt(t.amount)}
                                            </span>
                                            <button onClick={() => setTransactions(transactions.filter(x => x.id !== t.id))}
                                                className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 font-bold transition-opacity">
                                                刪除
                                            </button>
                                        </div>
                                    </div>
                                ))}

                                {/* 本期作廢發票 */}
                                {voidedInvoices.length > 0 && (
                                    <div className="mt-4 pt-4 border-t border-dashed border-gray-200">
                                        <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">
                                            本期作廢發票（{voidedInvoices.length} 張）
                                        </p>
                                        {voidedInvoices.map(inv => (
                                            <div key={inv.id}
                                                className="flex justify-between items-center p-3 bg-red-50 rounded-xl mb-2">
                                                <div className="flex items-center gap-3">
                                                    <span className="px-2 py-0.5 rounded text-[10px] font-black bg-red-100 text-red-600">作廢</span>
                                                    <span className="text-sm font-bold text-gray-600">
                                                        {inv.tableName || '外帶'}
                                                    </span>
                                                    <span className="text-xs text-gray-400">
                                                        {new Date(inv.paymentTime).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                                <span className="font-mono font-black text-red-500">-${fmt(inv.amount)}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ── 右側：點鈔 + 結算 ───────────────────────────────── */}
                    <div className="lg:col-span-4 space-y-4">

                        {/* 點鈔 */}
                        <div className="bg-white rounded-2xl p-4 shadow-sm border">
                            <div className="space-y-2">
                                {denoms.map((val, idx) => (
                                    <div key={val} className="flex items-center justify-between">
                                        <div className="w-24 font-black text-gray-400 text-lg">${val.toLocaleString()}</div>
                                        <input
                                            ref={el => inputRefs.current[val] = el}
                                            type="number" inputMode="numeric" pattern="[0-9]*"
                                            className="w-24 p-2 bg-gray-50 rounded-xl text-center text-xl font-black outline-none focus:bg-blue-50 focus:ring-2 focus:ring-blue-100 transition-all"
                                            value={denominations[val] || ''}
                                            onChange={e => setDenominations({ ...denominations, [val]: parseInt(e.target.value) || 0 })}
                                            onFocus={e => e.target.select()}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    const nxt = denoms[idx + 1];
                                                    if (nxt) { inputRefs.current[nxt].focus(); inputRefs.current[nxt].select(); }
                                                }
                                            }}
                                        />
                                        <div className="w-28 text-right font-mono font-bold text-gray-400 text-lg">
                                            ${((denominations[val] || 0) * val).toLocaleString()}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* 結算卡片 */}
                        <div className="bg-white rounded-2xl p-5 border shadow-xl space-y-4">

                            {/* 現金應有 + 現金實點 並排 */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-gray-50 rounded-xl px-4 py-3">
                                    <div className="text-xs text-gray-400 font-bold mb-1">現金應有</div>
                                    <div className="text-2xl font-black text-gray-800">${fmt(expectedCash)}</div>
                                </div>
                                <div className="bg-gray-50 rounded-xl px-4 py-3">
                                    <div className="text-xs text-gray-400 font-bold mb-1">現金實點</div>
                                    <div className="text-2xl font-black text-gray-800">${fmt(cashTotal)}</div>
                                </div>
                            </div>

                            {/* Breakdown 細項 */}
                            <div className="pl-3 border-l-2 border-gray-100 space-y-1">

                                {/* 預留零用金：長按可改 */}
                                <div
                                    className="flex justify-between items-center py-0.5 select-none cursor-default"
                                    onMouseDown={startReserveLongPress}
                                    onMouseUp={cancelReserveLongPress}
                                    onMouseLeave={cancelReserveLongPress}
                                    onTouchStart={startReserveLongPress}
                                    onTouchEnd={cancelReserveLongPress}
                                    onContextMenu={e => e.preventDefault()}
                                >
                                    <span className="text-xs text-gray-400">預留零用金</span>
                                    <span className="text-xs text-gray-400 font-mono">+${fmt(reserveAmount)}</span>
                                </div>

                                {/* 本期營業額（含作廢，不含冷凍包） */}
                                <div className="flex justify-between items-center py-0.5">
                                    <span className="text-xs text-gray-400">本期營業額</span>
                                    <span className="text-xs text-gray-400 font-mono">+${fmt(periodGrossSales - periodAllFrozenSales)}</span>
                                </div>

                                {/* 冷凍包（含作廢，有才顯示） */}
                                {periodAllFrozenSales > 0 && (
                                    <div className="flex justify-between items-center py-0.5">
                                        <span className="text-xs text-gray-400">冷凍包</span>
                                        <span className="text-xs text-gray-400 font-mono">+${fmt(periodAllFrozenSales)}</span>
                                    </div>
                                )}

                                {/* 臨時收入 */}
                                <div className="flex justify-between items-center py-0.5">
                                    <span className="text-xs text-gray-400">臨時收入</span>
                                    <span className={`text-xs font-mono ${summary.income > 0 ? 'text-gray-500' : 'text-gray-300'}`}>
                                        +${fmt(summary.income)}
                                    </span>
                                </div>

                                {/* 臨時支出 */}
                                <div className="flex justify-between items-center py-0.5">
                                    <span className="text-xs text-gray-400">臨時支出</span>
                                    <span className={`text-xs font-mono ${summary.expense > 0 ? 'text-gray-500' : 'text-gray-300'}`}>
                                        -{fmt(summary.expense) === '0' ? '$0' : `$${fmt(summary.expense)}`}
                                    </span>
                                </div>

                                {/* 非現金 */}
                                {summary.nonCash > 0 && (
                                    <div className="flex justify-between items-center py-0.5">
                                        <span className="text-xs text-gray-400">非現金</span>
                                        <span className="text-xs text-gray-500 font-mono">-${fmt(summary.nonCash)}</span>
                                    </div>
                                )}

                                {/* 現金作廢（有作廢才顯示） */}
                                {periodVoided > 0 && (
                                    <div className="flex justify-between items-center py-0.5">
                                        <span className="text-xs text-gray-400">現金作廢</span>
                                        <span className="text-xs text-gray-500 font-mono">-${fmt(periodVoided)}</span>
                                    </div>
                                )}
                            </div>

                            {/* 對帳損益 */}
                            <div className={`p-3 rounded-xl border-2 transition-colors
                                ${diff === 0 ? 'border-gray-100 bg-gray-50' : 'border-red-100 bg-red-50'}`}>
                                <div className="flex justify-between items-center">
                                    <span className="text-sm font-black text-gray-400 uppercase tracking-wider">對帳損益</span>
                                    <span className={`font-black ${diff === 0 ? 'text-gray-300' : diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {diff > 0 ? '+' : ''}{diff.toLocaleString()}
                                    </span>
                                </div>
                                {diff !== 0 && (
                                    <input type="text" placeholder="請填寫差異原因…" value={discrepancyNote}
                                        onChange={e => setDiscrepancyNote(e.target.value)}
                                        className="w-full mt-2 p-2 rounded-lg text-sm font-bold bg-transparent outline-none focus:ring-2 focus:ring-red-200" />
                                )}
                            </div>

                            {/* 匯出 + 下期零用金 */}
                            <div className="bg-gray-50 border rounded-xl p-3 space-y-3">
                                <div className="flex justify-between items-center">
                                    <span className="font-bold text-gray-500">匯出現金</span>
                                    <input type="number" inputMode="numeric" pattern="[0-9]*"
                                        value={withdrawalAmount || ''}
                                        onChange={e => setWithdrawalAmount(parseInt(e.target.value) || 0)}
                                        onFocus={e => e.target.select()}
                                        className="w-28 p-1 bg-white border rounded-xl text-right text-sm font-black text-blue-600 outline-none" />
                                </div>
                                <div className="flex justify-between items-center pt-2 border-t">
                                    <span className="font-black text-gray-800">下期零用金</span>
                                    <span className="text-sm font-black text-gray-900">${fmt(finalReserve)}</span>
                                </div>
                            </div>

                            {/* 關帳按鈕 + 補印按鈕 */}
                            <div className="flex gap-2 items-stretch">
                                <button
                                    disabled={!isClosed && !canComplete}
                                    onClick={handleFinalSubmit}
                                    className={`flex-1 py-5 rounded-2xl font-black text-xl shadow-lg transition-all active:scale-95 flex flex-col items-center justify-center gap-1
                                        ${isClosed
                                            ? 'bg-green-600 text-white hover:bg-green-700'
                                            : canComplete
                                                ? 'bg-blue-600 text-white hover:bg-blue-700'
                                                : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                                >
                                    <span>{isClosed ? '本期已關帳 ✓' : '確認完成關帳 + 列印'}</span>
                                    <span className="text-xs opacity-80 font-bold">
                                        {isClosed
                                            ? '點擊重新列印關帳單'
                                            : '關帳後流水號重新從 001 計算'}
                                    </span>
                                </button>

                                {/* 補印按鈕（有儲存的關帳資料才顯示） */}
                                {localStorage.getItem(CLOSE_REPORT_KEY) && (
                                    <button
                                        onClick={async () => {
                                            const saved = localStorage.getItem(CLOSE_REPORT_KEY);
                                            if (saved) await sendPrintClose(JSON.parse(saved));
                                        }}
                                        title="補印關帳單"
                                        className="w-14 rounded-2xl bg-gray-700 text-white hover:bg-gray-800 active:scale-95 transition-all shadow-lg flex items-center justify-center flex-shrink-0"
                                    >
                                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
                                            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="6" y="1" width="12" height="8" rx="1"/>
                                            <rect x="6" y="14" width="12" height="9" rx="1"/>
                                            <path d="M6 18H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2"/>
                                            <circle cx="18" cy="11.5" r="1" fill="currentColor" stroke="none"/>
                                        </svg>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── 密碼 Modal ──────────────────────────────────────────────────── */}
            {pinModal && (
                <PinModal
                    title={pinModal.purpose === 'drawer' ? '請輸入密碼以開啟錢櫃' : '請輸入密碼以修改零用金'}
                    onSuccess={handlePinSuccess}
                    onCancel={() => setPinModal(null)}
                />
            )}

            {/* ── 編輯零用金 Modal ─────────────────────────────────────────────── */}
            {editReserveOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
                    <div className="bg-white p-6 rounded-2xl shadow-2xl w-72 font-sans">
                        <h3 className="text-xl font-black mb-2 text-gray-800">設定錢櫃零用金</h3>
                        <p className="text-xs text-gray-400 mb-4">請輸入目前錢櫃內的實際備用金金額（首次使用或手動調整時）</p>
                        <input
                            type="number" inputMode="numeric"
                            value={editReserveInput}
                            onChange={e => setEditReserveInput(e.target.value)}
                            onFocus={e => e.target.select()}
                            autoFocus
                            className="w-full p-3 text-2xl font-black text-center border-2 rounded-xl outline-none focus:ring-2 focus:ring-blue-200 mb-4"
                        />
                        <div className="flex gap-3">
                            <button onClick={() => setEditReserveOpen(false)}
                                className="flex-1 py-3 rounded-xl bg-gray-100 font-bold text-gray-600 hover:bg-gray-200">
                                取消
                            </button>
                            <button onClick={handleSaveReserve}
                                className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-black hover:bg-blue-700">
                                儲存
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CashDrawerPage;
