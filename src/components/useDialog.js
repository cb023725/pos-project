// src/components/useDialog.js — Tailwind 提示／確認彈窗，樣式比照一般點單頁的清桌、棄單彈窗
// （圓形 icon、標題、精簡說明、底部分隔按鈕），取代瀏覽器原生 alert/confirm。
// 用法：
//   const { dialog, showAlert, showConfirm } = useDialog();
//   await showAlert('訊息', { title, icon });
//   if (await showConfirm('訊息', { title, icon, confirmText, cancelText, danger, note })) { ... }
//   畫面上要渲染 {dialog}
// icon：'success' | 'warning' | 'danger' | 'info'（預設 confirm 用 info、alert 用 info）
// note：紅色重點框（例如「此操作無法復原」）
import React, { useState, useCallback, useRef } from 'react';

const ICONS = {
    success: {
        wrap: 'bg-green-50 border-green-400', stroke: '#22c55e',
        path: <polyline points="20 6 9 17 4 12" />,
    },
    warning: {
        wrap: 'bg-orange-50 border-orange-400', stroke: '#f97316',
        path: <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
    },
    danger: {
        wrap: 'bg-red-50 border-red-400', stroke: '#ef4444',
        path: <><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" /></>,
    },
    info: {
        wrap: 'bg-gray-100 border-gray-300', stroke: '#6b7280',
        path: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>,
    },
};

export default function useDialog() {
    const [state, setState] = useState(null);
    const resolverRef = useRef(null);

    const open = useCallback((type, message, opts = {}) => new Promise(resolve => {
        resolverRef.current = resolve;
        setState({ type, message, ...opts });
    }), []);

    const close = (result) => {
        setState(null);
        const r = resolverRef.current;
        resolverRef.current = null;
        if (r) r(result);
    };

    const showAlert = useCallback((message, opts) => open('alert', message, opts), [open]);
    const showConfirm = useCallback((message, opts) => open('confirm', message, opts), [open]);

    let dialog = null;
    if (state) {
        const icon = ICONS[state.icon] || ICONS.info;
        dialog = (
            <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                    <div className="flex flex-col items-center pt-8 pb-5 px-6">
                        <div className={`w-20 h-20 rounded-full border-[3px] flex items-center justify-center mb-5 ${icon.wrap}`}>
                            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke={icon.stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                {icon.path}
                            </svg>
                        </div>
                        {state.title && <h3 className="text-2xl font-black text-gray-800 mb-2 text-center">{state.title}</h3>}
                        {state.message && <p className="text-lg text-gray-600 text-center leading-relaxed font-bold whitespace-pre-line">{state.message}</p>}
                        {state.note && (
                            <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 w-full text-center">
                                <span className="text-sm text-red-500 font-bold whitespace-pre-line">{state.note}</span>
                            </div>
                        )}
                    </div>
                    <div className="border-t border-gray-100" />
                    <div className="flex divide-x divide-gray-100">
                        {state.type === 'confirm' && (
                            <button onClick={() => close(false)} className="flex-1 py-5 text-gray-400 font-black text-xl hover:bg-gray-50 transition-colors">
                                {state.cancelText || '取消'}
                            </button>
                        )}
                        <button onClick={() => close(true)} autoFocus
                            className={`flex-1 py-5 font-black text-xl transition-colors ${state.danger ? 'text-red-500 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-100'}`}>
                            {state.confirmText || '確定'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return { dialog, showAlert, showConfirm };
}
