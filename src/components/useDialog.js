// src/components/useDialog.js — Tailwind 樣式的提示／確認彈窗，取代瀏覽器原生 alert/confirm。
// 用法：
//   const { dialog, showAlert, showConfirm } = useDialog();
//   await showAlert('訊息');                         // 單一按鈕
//   if (await showConfirm('確定嗎？', { danger: true })) { ... }  // 回傳 true/false
//   畫面上要渲染 {dialog}
// 選項：title、confirmText、cancelText、danger（確認鍵紅色）
import React, { useState, useCallback, useRef } from 'react';

export default function useDialog() {
    const [state, setState] = useState(null); // { type, message, title, confirmText, cancelText, danger }
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

    const dialog = state ? (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-7">
                {state.title && <h3 className="text-2xl font-black text-gray-800 mb-3">{state.title}</h3>}
                <p className="text-xl text-gray-700 font-bold leading-relaxed whitespace-pre-line">{state.message}</p>
                <div className="flex gap-3 mt-7">
                    {state.type === 'confirm' && (
                        <button onClick={() => close(false)}
                            className="flex-1 py-3.5 rounded-xl bg-gray-100 text-gray-700 text-lg font-black hover:bg-gray-200">
                            {state.cancelText || '取消'}
                        </button>
                    )}
                    <button onClick={() => close(true)} autoFocus
                        className={`flex-1 py-3.5 rounded-xl text-white text-lg font-black ${state.danger ? 'bg-red-500 hover:bg-red-600' : 'bg-[#4A9A7A] hover:bg-[#3A8A6A]'}`}>
                        {state.confirmText || '確定'}
                    </button>
                </div>
            </div>
        </div>
    ) : null;

    return { dialog, showAlert, showConfirm };
}
