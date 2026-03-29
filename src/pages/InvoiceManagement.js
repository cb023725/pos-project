// src/pages/InvoiceManagementPage.js

import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getInvoices, voidInvoice, getOrderById, getTableStatuses } from '../db';

const InvoiceManagementPage = () => {
    const navigate = useNavigate();
    const [invoices, setInvoices] = useState([]);
    const [tableStatuses, setTableStatuses] = useState([]); 
    const [isLoading, setIsLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState(null); 
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    // 輔助函式：取得本地 YYYY-MM-DD 字串，解決 ISOString 的時區差問題
    const getLocalDateString = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const addDays = (dateStr, n) => {
        const d = new Date(dateStr);
        d.setDate(d.getDate() + n);
        return getLocalDateString(d);
    };

    // UI 狀態控制
    const [activeTab, setActiveTab] = useState('active'); // 'active' | 'voided'
    const [startDate, setStartDate] = useState(getLocalDateString(new Date()));
    const [endDate, setEndDate] = useState(getLocalDateString(new Date()));
    
    // 起始發票流水號設定
    const START_INVOICE_NUM = 14760;

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [invoiceData, tableData] = await Promise.all([
                getInvoices(),
                getTableStatuses()
            ]);
            setInvoices(invoiceData);
            setTableStatuses(tableData);
        } catch (error) {
            console.error("載入資料失敗:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const setQuickDate = (start, end) => { setStartDate(start); setEndDate(end); };

    /**
     * 過濾與排序發票數據
     */
    const filteredInvoices = useMemo(() => {
        return invoices
            .filter(inv => {
                const statusMatch = activeTab === 'active' ? inv.status === '已開立' : inv.status === '已作廢';
                if (!statusMatch) return false;
                const dateStr = getLocalDateString(new Date(inv.paymentTime));
                return dateStr >= startDate && dateStr <= endDate;
            })
            .sort((a, b) => new Date(b.paymentTime).getTime() - new Date(a.paymentTime).getTime());
    }, [invoices, startDate, endDate, activeTab]);

    /**
     * 財務統計計算
     */
    const stats = useMemo(() => {
        const rangeInvoices = invoices.filter(inv => {
            const dateStr = getLocalDateString(new Date(inv.paymentTime));
            return dateStr >= startDate && dateStr <= endDate;
        });

        const activeInvs = rangeInvoices.filter(i => i.status === '已開立');
        const voidedInvs = rangeInvoices.filter(i => i.status === '已作廢');

        return {
            totalAmount: activeInvs.reduce((sum, i) => sum + i.amount, 0),
            voidedAmount: voidedInvs.reduce((sum, i) => sum + i.amount, 0),
            activeCount: activeInvs.length,
            voidedCount: voidedInvs.length
        };
    }, [invoices, startDate, endDate]);

    const getDisplayInvoiceNumber = (invoiceId) => {
        const chronologicalInvoices = [...invoices].sort((a, b) => new Date(a.paymentTime).getTime() - new Date(b.paymentTime).getTime());
        const index = chronologicalInvoices.findIndex(inv => inv.id === invoiceId);
        if (index === -1) return "#-00000000";
        const currentNum = START_INVOICE_NUM + index;
        return `#-${currentNum.toString().padStart(8, '0')}`;
    };

    const formatOrderId = (inv) => {
        if (inv?.dailyOrderNo) return String(inv.dailyOrderNo).padStart(3, '0');
        if (!inv?.orderId) return '000';
        return inv.orderId.toString().slice(-3).padStart(3, '0');
    };

    const formatDateTime24h = (dateStr) => {
        if (!dateStr) return "-";
        return new Date(dateStr).toLocaleString('zh-TW', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        });
    };

    const canVoidInvoice = (inv) => {
        if (inv.status === '已作廢') return false;
        if (inv.orderType === '外帶') return true;
        const currentTable = tableStatuses.find(t => t.tableNumber === inv.tableName);
        if (!currentTable || currentTable.status === 'idle') return true;
        if (currentTable.orderId !== inv.orderId) return true;
        return false;
    };

    const handleVoid = async (invoice) => {
        if (!canVoidInvoice(invoice)) {
            alert("安全性限制：該桌位尚未執行「離開（清桌）」動作，請先至桌位總覽執行客離。");
            return;
        }
        const displayNum = getDisplayInvoiceNumber(invoice.id);
        if (window.confirm(`確定要作廢發票 ${displayNum} 嗎？`)) {
            try {
                await voidInvoice(invoice.id);
                navigate(`/tables?reopenOrderId=${invoice.orderId}&tableName=${invoice.tableName || '外帶'}`);
            } catch (error) {
                alert("作廢失敗: " + error.message);
            }
        }
    };

    const showOrderDetail = async (inv) => {
        try {
            const orderSnapshot = await getOrderById(inv.orderId, inv.id);
            if (orderSnapshot) {
                setSelectedOrder({
                    ...orderSnapshot,
                    displayInvoiceNumber: getDisplayInvoiceNumber(inv.id),
                    paymentTime: inv.paymentTime,
                    voidTime: inv.voidTime,
                    invoiceStatus: inv.status
                });
                setIsDetailModalOpen(true);
            }
        } catch (error) {
            console.error("讀取訂單失敗:", error);
        }
    };

    const formatCurrency = (num) => Math.round(num || 0).toLocaleString();

    if (isLoading) return <div className="p-10 text-center font-bold text-gray-500">正在讀取發票紀錄...</div>;

    return (
        <div className="p-6 font-sans bg-gray-50 min-h-screen">
            {/* Header & Quick Filters */}
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4">
                <h2 className="text-3xl font-black text-gray-900">發票收據管理</h2>
                <div className="flex flex-col gap-2">
                    {/* Reports-style date range bar */}
                    <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2 shadow-sm flex-wrap">
                        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <rect x="3" y="4" width="18" height="18" rx="2" strokeWidth="2"/>
                            <path d="M16 2v4M8 2v4M3 10h18" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                        <input
                            type="date" value={startDate}
                            onChange={e => { const v = e.target.value; setStartDate(v); if (v > endDate) setEndDate(v); }}
                            className="text-sm font-bold border-none outline-none bg-transparent text-gray-700"
                        />
                        <span className="text-gray-400 font-bold">—</span>
                        <input
                            type="date" value={endDate}
                            onChange={e => { const v = e.target.value; setEndDate(v < startDate ? startDate : v); }}
                            className="text-sm font-bold border-none outline-none bg-transparent text-gray-700"
                        />
                        <div className="flex gap-1 ml-2">
                            {[
                                { label: '今天',    s: getLocalDateString(new Date()), e: getLocalDateString(new Date()) },
                                { label: '前三天',  s: addDays(getLocalDateString(new Date()), -2), e: getLocalDateString(new Date()) },
                                { label: '最近七天',s: addDays(getLocalDateString(new Date()), -6), e: getLocalDateString(new Date()) },
                                { label: '近30天',  s: addDays(getLocalDateString(new Date()), -29), e: getLocalDateString(new Date()) },
                                { label: '本月',    s: `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-01`, e: getLocalDateString(new Date()) },
                                { label: '今年',    s: `${new Date().getFullYear()}-01-01`, e: getLocalDateString(new Date()) },
                                { label: '全部',    s: '2020-01-01', e: getLocalDateString(new Date()) },
                            ].map(sc => (
                                <button key={sc.label} onClick={() => setQuickDate(sc.s, sc.e)}
                                    className="text-xs font-bold text-[#2FB8B8] hover:bg-[#2FB8B8]/10 px-2 py-0.5 rounded whitespace-nowrap transition-colors"
                                >{sc.label}</button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Stats Dashboard */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                    <p className="text-gray-400 text-xs font-bold uppercase">發票總額 (淨)</p>
                    <p className="text-2xl font-black text-blue-600">${formatCurrency(stats.totalAmount)}</p>
                </div>
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                    <p className="text-gray-400 text-xs font-bold uppercase">已開立張數</p>
                    <p className="text-2xl font-black text-gray-800">{stats.activeCount} <span className="text-xs text-gray-400">張</span></p>
                </div>
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                    <p className="text-gray-400 text-xs font-bold uppercase">作廢總額</p>
                    <p className="text-2xl font-black text-red-500">${formatCurrency(stats.voidedAmount)}</p>
                </div>
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                    <p className="text-gray-400 text-xs font-bold uppercase">已作廢張數</p>
                    <p className="text-2xl font-black text-red-500">{stats.voidedCount} <span className="text-xs text-gray-400">張</span></p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-4">
                <button 
                    onClick={() => setActiveTab('active')}
                    className={`px-6 py-2 rounded-t-xl font-black transition-all ${activeTab === 'active' ? 'bg-white text-blue-600 border-t-2 border-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                >
                    結帳紀錄
                </button>
                <button 
                    onClick={() => setActiveTab('voided')}
                    className={`px-6 py-2 rounded-t-xl font-black transition-all ${activeTab === 'voided' ? 'bg-white text-red-600 border-t-2 border-red-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                >
                    作廢紀錄
                </button>
            </div>

            {/* Main Table */}
            <div className="bg-white rounded-b-2xl rounded-tr-2xl shadow-xl border border-gray-100 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-wider">發票號碼</th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-wider">結帳時間</th>
                                <th className="px-6 py-4 text-center text-xs font-bold text-gray-400 uppercase tracking-wider">原始單號</th>
                                <th className="px-6 py-4 text-center text-xs font-bold text-gray-400 uppercase tracking-wider">類型</th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-wider">總金額</th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-wider">{activeTab === 'active' ? '狀態' : '作廢時間'}</th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-wider">管理操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {filteredInvoices.length === 0 ? (
                                <tr>
                                    <td colSpan="7" className="px-6 py-10 text-center text-gray-400 font-bold">該時段無相關紀錄</td>
                                </tr>
                            ) : (
                                filteredInvoices.map((inv) => (
                                    <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap align-middle">
                                            <span className={`font-mono font-bold px-2 py-1 rounded ${activeTab === 'active' ? 'text-blue-600 bg-blue-50' : 'text-gray-400 bg-gray-100'}`}>
                                                {getDisplayInvoiceNumber(inv.id)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 align-middle">
                                            {formatDateTime24h(inv.paymentTime)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-center font-mono text-gray-500 align-middle">
                                            {formatOrderId(inv)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-center align-middle">
                                            <span className={`px-3 py-1 rounded-full font-bold text-xs ${inv.orderType === '外帶' ? 'bg-orange-100 text-orange-600' : 'bg-indigo-100 text-indigo-600'}`}>
                                                {inv.orderType}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap align-middle">
                                            <span className={`font-black ${activeTab === 'voided' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                                                ${formatCurrency(inv.amount)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm align-middle">
                                            {activeTab === 'active' ? (
                                                <span className="text-green-500 font-black">● 已開立</span>
                                            ) : (
                                                <span className="text-red-400 font-bold">{formatDateTime24h(inv.voidTime)}</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-left space-x-2 align-middle">
                                            <button onClick={() => showOrderDetail(inv)} className="px-4 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 font-bold text-sm transition-colors">
                                                明細
                                            </button>
                                            {activeTab === 'active' && (
                                                <button onClick={() => handleVoid(inv)} className="px-4 py-1.5 rounded-lg font-bold text-sm bg-red-100 text-red-600 hover:bg-red-500 hover:text-white transition-all">
                                                    作廢
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>


            {/* 發票明細 Modal */}
            {isDetailModalOpen && selectedOrder && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 border border-gray-100">
                        <div className="p-6 border-b flex justify-between items-center bg-gray-50">
                            <h3 className="text-xl font-black text-gray-800">發票詳情</h3>
                            <button onClick={() => setIsDetailModalOpen(false)} className="text-gray-400 text-2xl hover:text-gray-600">&times;</button>
                        </div>
                        
                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4 text-sm border-b pb-4">
                                <div>
                                    <p className="text-gray-400 font-bold">發票號碼</p>
                                    <p className="font-mono font-bold text-blue-600">{selectedOrder.displayInvoiceNumber}</p>
                                </div>
                                <div>
                                    <p className="text-gray-400 font-bold">桌號</p>
                                    <p className="font-bold text-gray-800">{selectedOrder.table || '外帶'}</p>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-gray-400 font-bold">結帳時間</p>
                                    <p className="text-gray-700">{formatDateTime24h(selectedOrder.paymentTime)}</p>
                                </div>
                                {selectedOrder.invoiceStatus === '已作廢' && (
                                    <div className="col-span-2">
                                        <p className="text-red-400 font-bold">作廢時間</p>
                                        <p className="text-red-600 font-bold">{formatDateTime24h(selectedOrder.voidTime)}</p>
                                    </div>
                                )}
                            </div>

                            <div>
                                <p className="text-gray-400 font-bold text-xs mb-2 uppercase">餐點明細</p>
                                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                    {selectedOrder.items && selectedOrder.items.map((item, idx) => (
                                        <div key={idx} className="flex justify-between text-sm">
                                            <span className="text-gray-800 font-medium">{item.name} x {item.quantity}</span>
                                            <span className="font-bold text-gray-900">${formatCurrency(item.price * item.quantity)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="mt-4 pt-4 border-t flex justify-between items-center">
                                <span className="font-bold text-gray-500">總計金額</span>
                                <span className="text-2xl font-black text-gray-900">${formatCurrency(selectedOrder.total)}</span>
                            </div>
                        </div>

                        <div className="p-4 bg-gray-50 text-center">
                            <button onClick={() => setIsDetailModalOpen(false)} className="w-full py-3 bg-gray-900 text-white rounded-xl font-bold hover:bg-gray-800 transition-colors">
                                關閉
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default InvoiceManagementPage;