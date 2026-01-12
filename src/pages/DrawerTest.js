// src/pages/DrawerTest.js (完整程式碼)
import React from 'react';

const BACKEND_URL = 'http://localhost:3000'; 

function DrawerTest() {

    const handleOpenDrawer = async () => {
        try {
            console.log(`🚀 呼叫後端 API: ${BACKEND_URL}/api/cash-drawer`);

            const response = await fetch(`${BACKEND_URL}/api/cash-drawer`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json(); 

            if (response.ok && data.success) {
                console.log("✅ 開錢箱指令發送成功。");
                alert("開錢箱指令已成功發送！");
            } else {
                const errorMessage = data.message || `HTTP Status ${response.status}: ${response.statusText}`;
                console.error("❌ 後端錯誤:", errorMessage);
                alert(`開錢箱失敗！ ${errorMessage}`);
            }

        } catch (error) {
            console.error("⚠️ 網路請求失敗 (前端):", error);
            alert("網路請求失敗！請確認後端服務是否已啟動，或檢查 CORS 設定。");
        }
    };

    return (
        <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '8px', maxWidth: '400px', margin: '50px auto' }}>
            <h2>mC-Print3 開錢箱測試頁面 (透過 Node.js 後端)</h2>
            
            <button 
                onClick={handleOpenDrawer}
                style={{ 
                    padding: '12px 20px', 
                    backgroundColor: '#007bff', 
                    color: 'white', 
                    border: 'none', 
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontSize: '16px'
                }}
            >
                💥 點擊測試開錢箱
            </button>
            <p style={{ marginTop: '15px', fontSize: '14px', color: '#666' }}>
                測試前請確保：<br/>
                1. Node.js 後端服務已啟動 (`node server.js`)。<br/>
                2. 錢箱已連接到 Star mC-Print3 印表機。<br/>
                3. 後端 **`PRINTER_IP`** 和 **`PRINTER_PORT` (9100)** 設定正確。
            </p>
        </div>
    );
}

export default DrawerTest;