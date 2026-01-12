// src/pages/Printer.js
import React, { useState } from 'react';

export default function PrinterPage() {
    const [status, setStatus] = useState('');

    const handlePrint = async () => {
        setStatus('正在發送列印請求...');
        
        // 結構化收據資料 (由後端 server.js 負責格式化成純文字)
        const receiptData = {
            title: '咕咕義小餐館',
            items: [
                { name: '義大利麵', qty: 2, price: 300 },
                { name: '青菜沙拉', qty: 1, price: 120 }
            ],
            total: 720
        };

        try {
            // 🎯 請求純文字模式路由
            const res = await fetch('http://192.168.0.114:3000/print', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify(receiptData) // 傳送結構化 JSON
            });
            
            // 確保嘗試解析 JSON，以便獲取後端返回的錯誤訊息
            const data = await res.json().catch(() => ({ 
                status: '無效的後端響應', 
                error: '伺服器未返回 JSON' 
            }));
            
            if (res.ok) {
                setStatus(`✅ 列印請求成功: ${data.status}`);
            } else {
                // 顯示後端回傳的錯誤資訊
                setStatus(`❌ 後端錯誤 (${res.status}): ${data.error || data.status}`);
            }

        } catch (err) {
            console.error('列印失敗:', err);
            // 這次捕獲的錯誤是網路層級的 (如 Load failed)
            setStatus(`🔴 連線錯誤：請檢查後端服務是否運行及防火牆設置。詳細: ${err.message}`);
        }
    };

    return (
        <div style={{ padding: 20 }}>
            <h1>列印測試 (純文字模式)</h1>
            <button onClick={handlePrint}>列印收據</button>
            <p>狀態: **{status}**</p>
            <p style={{ marginTop: '20px', border: '1px dashed #ccc', padding: '10px' }}>
                **注意:** 純文字模式可能會因中文排版寬度問題而導致格式不對齊。
            </p>
        </div>
    );
}