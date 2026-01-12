// src/components/OrderModals.js

import React, { useState, useEffect } from 'react';

// --- Modal Components ---

export const RiceWarningModal = ({ isOpen, onClose, riceStock, onConfirm, item }) => {
    if (!isOpen || !item) return null;
    const message = `您正在點 ${item.name}\n飯鍋剩餘 ${riceStock.toFixed(1)} 碗白飯\n請確認飯量足夠或盡快煮飯！`;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-xl shadow-2xl w-96">
                <h3 className="text-2xl font-black mb-4 text-orange-600 border-b pb-2">🍚 飯量不足警告</h3>
                <p className="text-lg mb-6 font-medium text-gray-800 leading-relaxed whitespace-pre-wrap">{message}</p>
                <div className="flex gap-4">
                    <button onClick={() => onConfirm(item)} className="flex-1 py-3 rounded-xl bg-green-500 hover:bg-green-600 text-white font-black text-lg transition-colors">確認點餐</button>
                    <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-black text-lg transition-colors">取消點餐</button>
                </div>
            </div>
        </div>
    );
};

export const NumberPadModal = ({ isOpen, onClose, currentValue, onSave }) => {
    const [inputValue, setInputValue] = useState(currentValue.toFixed(1)); 
    useEffect(() => { if (isOpen) setInputValue(currentValue.toFixed(1)); }, [isOpen, currentValue]);
    
    const handleInput = (digit) => setInputValue(prev => {
        if (prev === '0.0') prev = '0';
        if (digit === '.' && prev.includes('.')) return prev;
        let newValue = prev === '0' && digit !== '.' ? digit : prev + digit;
        if (newValue.includes('.')) { const parts = newValue.split('.'); if (parts[1] && parts[1].length > 1) newValue = parts[0] + '.' + parts[1].slice(0, 1); }
        if (newValue.length > 1 && newValue.startsWith('0') && !newValue.startsWith('0.')) newValue = newValue.slice(1);
        return newValue;
    });
    const handleDelete = () => setInputValue(prev => prev.length > 1 && prev !== '-' ? prev.slice(0, -1) : '0');
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-xl shadow-2xl w-80">
                <h3 className="text-xl font-black mb-4 text-gray-800 border-b pb-2">🍚 輸入當日飯量 (份)</h3>
                <div className="text-4xl font-black text-right border-4 border-gray-200 p-3 mb-4 rounded-xl bg-gray-50 text-blue-700">{inputValue}</div>
                <div className="grid grid-cols-3 gap-3">
                    {[7, 8, 9, 4, 5, 6, 1, 2, 3].map(n => (<button key={n} onClick={() => handleInput(String(n))} className="bg-gray-200 hover:bg-gray-300 p-4 rounded-xl text-xl font-bold transition-colors">{n}</button>))}
                    <button onClick={() => setInputValue('0')} className="bg-red-500/70 hover:bg-red-600 text-white p-4 rounded-xl font-bold transition-colors">清空</button>
                    <button onClick={() => handleInput('0')} className="bg-gray-200 hover:bg-gray-300 p-4 rounded-xl text-xl font-bold transition-colors">0</button>
                    <button onClick={() => handleInput('.')} className="bg-gray-200 hover:bg-gray-300 p-4 rounded-xl text-xl font-bold transition-colors">.</button>
                </div>
                <div className="flex gap-2 mt-4">
                    <button onClick={handleDelete} className="flex-grow bg-yellow-500/70 hover:bg-yellow-600 text-white p-3 rounded-xl font-bold transition-colors">刪除</button>
                    <button onClick={() => { onSave(Number(inputValue)); onClose(); }} className="flex-grow bg-blue-500 hover:bg-blue-700 text-white p-3 rounded-xl font-bold transition-colors">確定</button>
                </div>
            </div>
        </div>
    );
};

export const NumberPadInputModal = ({ isOpen, onClose, currentValue, onSave, title, max = Infinity, min = 0, itemInternalId = null, onQuantityChange }) => {
    const [inputValue, setInputValue] = useState(String(currentValue)); 
    useEffect(() => { if (isOpen) setInputValue(String(currentValue)); }, [isOpen, currentValue]);
    const parseValue = (val) => { let numValue = parseInt(val, 10) || 0; if (min !== undefined) numValue = Math.max(min, numValue); if (max !== Infinity) numValue = Math.min(max, numValue); return numValue; };
    const handleInput = (digit) => setInputValue(prev => { if (prev === '0' && digit === '0') return prev; let newValue = prev === '0' ? digit : prev + digit; if (max !== Infinity && Number(newValue) > max) return prev; return newValue; });
    const handleDelete = () => setInputValue(prev => prev.length > 1 ? prev.slice(0, -1) : '0');
    const handleSave = () => { const numValue = parseValue(inputValue); onSave(numValue); onClose(); };
    const handleIncrement = () => { const newQty = parseValue(inputValue) + 1; if (newQty <= max) { setInputValue(String(newQty)); if (itemInternalId && onQuantityChange) onQuantityChange(itemInternalId, newQty); } };
    const handleDecrement = () => { const newQty = parseValue(inputValue) - 1; if (newQty >= 0) { setInputValue(String(newQty)); if (itemInternalId && onQuantityChange) onQuantityChange(itemInternalId, newQty); } };
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-xl shadow-2xl w-80">
                <h3 className="text-xl font-black mb-4 text-gray-800 border-b pb-2">{title}</h3>
                <div className="flex items-center justify-between mb-4">
                    <button onClick={handleDecrement} disabled={parseValue(inputValue) <= min} className="w-12 h-12 rounded-xl bg-red-100 text-red-600 hover:bg-red-200 p-3 text-3xl font-black disabled:opacity-50 transition-colors">-</button>
                    <div className="text-5xl font-black text-center border-4 border-gray-200 p-3 flex-grow mx-2 rounded-xl bg-gray-50 text-blue-700">{inputValue}</div>
                    <button onClick={handleIncrement} disabled={parseValue(inputValue) >= max} className="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 hover:bg-blue-200 p-3 text-3xl font-black disabled:opacity-50 transition-colors">+</button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                    {[7, 8, 9, 4, 5, 6, 1, 2, 3].map(n => (<button key={n} onClick={() => handleInput(String(n))} className="bg-gray-200 hover:bg-gray-300 p-4 rounded-xl text-xl font-bold transition-colors">{n}</button>))}
                    <button onClick={() => setInputValue('0')} className="bg-red-500/70 hover:bg-red-600 text-white p-4 rounded-xl font-bold transition-colors">清空</button>
                    <button onClick={() => handleInput('0')} className="bg-gray-200 hover:bg-gray-300 p-4 rounded-xl text-xl font-bold transition-colors">0</button>
                    <button onClick={handleDelete} className="bg-yellow-500/70 hover:bg-yellow-600 text-white p-4 rounded-xl font-bold transition-colors">刪除</button>
                </div>
                <button onClick={handleSave} className="w-full mt-4 bg-blue-500 hover:bg-blue-700 text-white p-3 rounded-xl font-black transition-colors">確定</button>
            </div>
        </div>
    );
};