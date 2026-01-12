// server.js (最終修正版 - 測試 ESC BEL 複合指令)
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const net = require('net');
const iconv = require('iconv-lite'); 

const app = express();
const PORT = 3000; 

// ----------------------------------------------------
// 【關鍵設定】Star Micronics MC-Print3 配置
// ----------------------------------------------------
const PRINTER_IP = '192.168.0.104'; // ⚠️ 請確認您的印表機 IP 是否為此
const PRINTER_PORT = 9100;
const PRINTER_ENCODING = 'big5';    // 根據中文列印需求選擇編碼

// ... (中間件和 formatReceiptText 函式保持不變，略過) ...
app.use(bodyParser.json());

// CORS 配置：允許所有來源的請求
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'OPTIONS'], 
    allowedHeaders: ['Content-Type'], 
    credentials: true
})); 

// 輔助函式 (略過，與之前相同)
const formatReceiptText = (data) => {
    let text = `================================\n`;
    text += `       ${data.title}\n`;
    text += `--------------------------------\n`;
    text += `品項      數量      單價      小計\n`; 
    text += `--------------------------------\n`;

    if (data.items && Array.isArray(data.items)) {
        data.items.forEach(item => {
            const name = item.name.padEnd(8, ' ');
            const qty = item.qty.toString().padStart(4, ' ');
            const price = item.price.toString().padStart(8, ' ');
            const subtotal = (item.qty * item.price).toString().padStart(8, ' ');
            text += `${name}${qty}${price}${subtotal}\n`;
        });
    }

    text += `--------------------------------\n`;
    const totalString = (data.total || 0).toString();
    text += `總金額: ${totalString.padStart(32 - '總金額: '.length + totalString.length)}\n`; 
    text += `================================\n`;
    text += `\n\n`; 

    return text;
};


// ----------------------------------------------------
// POST /api/cash-drawer (處理開錢櫃請求 - ESC BEL 複合指令)
// ----------------------------------------------------
app.post('/api/cash-drawer', (req, res) => {
    console.log('--- 收到開錢箱請求 ---');
    console.log(`嘗試連線印表機: ${PRINTER_IP}:${PRINTER_PORT}`);

    const client = new net.Socket();
    
    client.connect(PRINTER_PORT, PRINTER_IP, () => {
        console.log('✅ TCP 連線成功，開始發送開錢箱複合指令...');

        try {
            // 1. 初始化印表機 (ESC @) - 確保印表機退出任何狀態
            const initPrinter = Buffer.from([0x1b, 0x40]); 
            
            // 2. 開錢櫃指令 (ESC BEL) - 您最初測試成功的指令
            const openDrawer = Buffer.from([0x1B, 0x07]); 
            
            // 3. 切紙指令 (ESC i, Full Cut) - 使用更穩定的切紙指令
            const cutPaper = Buffer.from([0x1b, 0x69]); // 0x69 是 ASCII 'i'

            // 組合命令：初始化 + 開錢櫃 + 切紙
            const jobBuffer = Buffer.concat([initPrinter, openDrawer, cutPaper]);

            client.write(jobBuffer, (err) => {
                if (err) {
                    console.error('寫入開錢箱指令錯誤：', err.message);
                    client.end();
                    if (!res.headersSent) {
                         return res.status(500).json({ success: false, message: `TCP 寫入數據失敗: ${err.message}` });
                    }
                    return;
                }
                console.log('開錢箱複合指令發送完成。');
                
                client.end();
                
                if (!res.headersSent) {
                    res.json({ success: true, message: '開錢箱指令已成功發送' });
                }
            });
            
        } catch (e) {
             console.error('🔴 指令處理錯誤:', e);
             client.destroy();
             if (!res.headersSent) {
                 res.status(500).json({ success: false, message: `後端處理錯誤: ${e.message}` });
             }
        }
    });

    client.on('close', () => console.log('開錢箱 TCP 連線關閉'));
    
    client.on('error', (err) => {
        console.error('❌ TCP 連線錯誤：無法連接到印表機', err.message);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: `無法連線到印表機 (${PRINTER_IP}:${PRINTER_PORT}): ${err.message}` });
        }
        client.destroy();
    });
});


// ----------------------------------------------------
// POST /print (處理純文字列印請求)
// ----------------------------------------------------
app.post('/print', (req, res) => {
    const receiptData = req.body;
    
    if (!receiptData || !receiptData.title) {
        return res.status(400).json({ status: '錯誤', error: '請求格式錯誤或缺少資料欄位 (title)' });
    }

    const text = formatReceiptText(receiptData);
    console.log('--- 收到純文字列印請求 ---');
    console.log(`嘗試連線印表機: ${PRINTER_IP}:${PRINTER_PORT}`);
    
    const client = new net.Socket();
    client.setTimeout(5000); 

    client.connect(PRINTER_PORT, PRINTER_IP, () => {
        console.log('✅ TCP 連線成功，開始發送列印內容...');

        try {
            // 1. 初始化印表機 (ESC @)
            const initPrinter = Buffer.from([0x1b, 0x40]);
            // 2. 設定 StarPRNT 中文模式
            const setChineseMode = Buffer.from([0x1b, 0x1d, 0x74, 0x01]); 
            // 3. 核心：將 UTF-8 文字轉為目標編碼
            const textBuffer = iconv.encode(text, PRINTER_ENCODING); 
            // 4. 切紙指令 (ESC d 2)
            const cutPaper = Buffer.from([0x1b, 0x64, 0x02]);

            const jobBuffer = Buffer.concat([initPrinter, setChineseMode, textBuffer, cutPaper]);

            client.write(jobBuffer, (err) => {
                if (err) {
                    console.error('寫入數據錯誤：', err.message);
                    client.end();
                    if (!res.headersSent) {
                         return res.status(500).json({ status: 'TCP 寫入數據失敗', error: err.message });
                    }
                    return;
                }
                console.log('數據發送完成。');
                client.end();
                if (!res.headersSent) {
                    res.json({ status: '列印請求已送出，正在發送數據' });
                }
            });
            
        } catch (e) {
             console.error('🔴 編碼或指令處理錯誤:', e);
             client.destroy();
             if (!res.headersSent) {
                 res.status(500).json({ status: '後端處理錯誤', error: e.message });
             }
        }
    });

    client.on('close', () => console.log('TCP 連線關閉'));
    
    client.on('error', (err) => {
        console.error('❌ TCP 連線錯誤：無法連接到印表機', err.message);
        if (!res.headersSent) {
            res.status(500).json({ status: `連線印表機錯誤: ${err.message}`, error: `無法連接到印表機 (${PRINTER_IP}:${PRINTER_PORT})` });
        }
        client.destroy();
    });
    
    client.on('timeout', () => {
        console.error('❌ TCP 連線超時');
        if (!res.headersSent) {
            res.status(500).json({ status: '連線印表機超時', error: 'TCP 連線超時，請檢查印表機電源和網路' });
        }
        client.destroy();
    });
});


// ------------------------
// Catch-all route (保留在最底部)
// ------------------------
app.all(/.*/, (req, res) => {
    // 確保這裡回傳 JSON 格式的 404
    res.status(404).json({ success: false, message: 'API 路由未找到' });
});

// ------------------------
// 啟動 server
// ------------------------
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Node server running on http://localhost:${PORT}`);
    console.log(`TCP Printer IP: ${PRINTER_IP}:${PRINTER_PORT}, Encoding: ${PRINTER_ENCODING}`);
});