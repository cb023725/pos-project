// server.js
const IS_DEV = process.argv.includes('--dev');
require('dotenv').config({ path: IS_DEV ? '.env.dev' : '.env' });
const express    = require('express');
const bodyParser = require('body-parser');
const cors       = require('cors');
const net        = require('net');
const path       = require('path');
const os         = require('os');
const fs         = require('fs');
const { execFile } = require('child_process');
const PDFDocument  = require('pdfkit');
const { createClient } = require('@supabase/supabase-js');

// Supabase 連線（service_role，只在 server 端使用）
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const app  = express();
const PORT = IS_DEV ? 3001 : 3000;

// ----------------------------------------------------
// 【印表機設定】從 .env 讀取，避免 IP 硬寫進程式碼
// ----------------------------------------------------
const PRINTER_IP   = process.env.PRINTER_IP   || '192.168.0.104';
const PRINTER_PORT = Number(process.env.PRINTER_PORT) || 9100;
const CUPS_PRINTER = process.env.CUPS_PRINTER  || '_192_168_0_104';

// 58mm 紙寬，但 Star MCprint3 CUPS 驅動可列印寬度為 48mm
const MM          = 2.8346;
const PAGE_W      = Math.round(48 * MM);    // ≈ 136pt（驅動 printable width）
const MARGIN_TOP  = Math.round(15 * MM); // 上方 15mm
const MARGIN_SIDE = 4;                       // 左右最小留邊 4pt（驅動已含實體邊距）
const CONT_W      = PAGE_W - MARGIN_SIDE * 2;

// 字型：品項用 SimHei（黑體，視覺效果等同 Bold）；分類標題用 JhengHei（細）
// 啟動時一次性載入至記憶體，避免每次生成 PDF 都從磁碟讀取大型中文字型（各 10-21MB）
const FONT_BOLD = fs.readFileSync('/Library/Fonts/Microsoft/SimHei.ttf');
const FONT_REG  = fs.readFileSync('/Library/Fonts/Microsoft/Microsoft Jhenghei.ttf');
console.log('字型已載入記憶體（Bold:', Math.round(FONT_BOLD.length/1024/1024*10)/10, 'MB, Reg:', Math.round(FONT_REG.length/1024/1024*10)/10, 'MB）');

// ----------------------------------------------------
// Middleware
// ----------------------------------------------------
app.use(bodyParser.json({ limit: '5mb' }));
// CORS：僅允許同網段裝置，不開放憑證
app.use(cors({
    origin: /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
}));

// 速率限制：每個 IP 每 60 秒最多 20 次列印請求，防止誤觸或惡意濫用
const printRateMap = new Map();
function printRateLimit(req, res, next) {
    const ip  = req.ip;
    const now = Date.now();
    const win = printRateMap.get(ip) || { count: 0, start: now };
    if (now - win.start > 60_000) { win.count = 0; win.start = now; }
    win.count++;
    printRateMap.set(ip, win);
    if (win.count > 20) return res.status(429).json({ error: '請求過於頻繁，請稍後再試' });
    next();
}

// ----------------------------------------------------
// 【現金抽屜】POST /api/cash-drawer
// ----------------------------------------------------
app.post('/api/cash-drawer', printRateLimit, (req, res) => {
    console.log('--- 收到開錢箱請求 ---');
    const client = new net.Socket();

    client.connect(PRINTER_PORT, PRINTER_IP, () => {
        console.log('✅ TCP 連線成功，發送開錢箱指令...');
        try {
            // Star MCprint3 StarPRNT 開錢櫃指令
            // BEL (0x07) 為最直接的 DK1 開啟脈衝，不加 ESC @ 或 ESC i 避免干擾
            const cmd = Buffer.from([0x07]);
            client.write(cmd, (err) => {
                client.end();
                if (err) {
                    console.error('寫入錯誤：', err.message);
                    if (!res.headersSent)
                        return res.status(500).json({ success: false, message: `TCP 寫入失敗: ${err.message}` });
                    return;
                }
                console.log('開錢箱指令發送完成。');
                if (!res.headersSent)
                    res.json({ success: true, message: '開錢箱指令已成功發送' });
            });
        } catch (e) {
            client.destroy();
            if (!res.headersSent)
                res.status(500).json({ success: false, message: `後端錯誤: ${e.message}` });
        }
    });

    client.on('close', () => console.log('開錢箱 TCP 連線關閉'));
    client.on('error', (err) => {
        console.error('❌ 連線錯誤：', err.message);
        if (!res.headersSent)
            res.status(500).json({ success: false, message: `無法連線印表機: ${err.message}` });
        client.destroy();
    });
});

// ----------------------------------------------------
// 【生成出單 PDF】
// ----------------------------------------------------
const ITEM_FONT_SZ = 16;   // 品項字號
const CAT_FONT_SZ  = 10;   // 分類標題字號
const HDR_FONT_SZ  = 18;   // 表頭桌號字號
const TS_FONT_SZ   = 10;   // 底部時間字號

const HEADER_H   = 34;               // 表頭高度（桌號30pt + 實線 + 2pt 緊縮間距）
const CAT_HEAD_H = 14;               // 分類標題行高
const CAT_LINE_H = 6;                // 分類虛線高度
const CAT_GAP    = 8;                // 分類間距
const ITEM_PAD   = 6;                // 每品項下方留白
const FOOTER_H   = 28;               // 底部（實線+時間）
const MARGIN_BOT = Math.round(5 * MM);

const QTY_BOX_W = 22;   // 數量框寬
const QTY_BOX_H = 20;   // 數量框高
const QTY_PAD   = 3;    // 名稱與數量框間距
const TEXT_W    = CONT_W - QTY_BOX_W - QTY_PAD;  // 品項名稱可用寬度

// 廚房單分類列印順序：小點 → 主餐 → 單點 → 飲品 → 冷凍包
const CAT_ORDER    = ['小點', '主餐', '單點', '飲品', '冷凍包'];
const KITCHEN_CATS = new Set(['小點', '主餐', '單點']);
const BAR_CATS     = new Set(['飲品', '冷凍包']);

// 相同品項＋相同備註合併數量（備註排序後比對）
function mergeNoRemarkItems(items) {
    const merged = new Map();
    const order = [];
    for (const item of items) {
        const remarks = item.remarks || [];
        const rKey = [...remarks].sort().join('|||');
        const key = (item.category || '') + '|' + (item.printName || item.name || '') + '|' + rKey;
        if (merged.has(key)) {
            merged.get(key).qty = (merged.get(key).qty || 1) + (item.qty || 1);
        } else {
            const clone = { ...item, qty: item.qty || 1 };
            merged.set(key, clone);
            order.push(clone);
        }
    }
    return order;
}

// 依分類分組：分類依 CAT_ORDER 排序，同分類內品項依 sortOrder 排序
function groupByCategory(items) {
    const map = new Map();
    for (const item of items) {
        const cat = item.category || '其他';
        if (!map.has(cat)) map.set(cat, []);
        map.get(cat).push(item);
    }
    return [...map.entries()]
        .sort(([a], [b]) => {
            const ai = CAT_ORDER.indexOf(a);
            const bi = CAT_ORDER.indexOf(b);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        })
        .map(([category, catItems]) => ({
            category,
            items: catItems.slice().sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99)),
        }));
}

// 出單短字：截到最多 8 個字元
const truncateName = (n) => [...(n || '')].slice(0, 8).join('');

const REMARK_FONT_SZ = 12;
const REMARK_LINE_H  = 15;

// 計算頁面高度
function calcRemarkH(remarks, measureDoc) {
    if (!remarks || remarks.length === 0) return 0;
    measureDoc.font('Reg').fontSize(REMARK_FONT_SZ);
    let h = 0;
    for (let ri = 0; ri < remarks.length; ri += 3) {
        const trio = remarks.slice(ri, ri + 3).join('  ');
        h += measureDoc.heightOfString(trio, { width: CONT_W - 10 });
    }
    return h;
}

function calcPageHeight(groups, measureDoc, extraFooterH = 0) {
    let contentH = 0;
    groups.forEach((g, gi) => {
        if (gi > 0) contentH += CAT_GAP;
        contentH += CAT_HEAD_H + CAT_LINE_H;
        g.items.forEach(item => {
            const name    = truncateName(item.printName || item.name);
            measureDoc.font('Bold').fontSize(ITEM_FONT_SZ);
            const textH   = measureDoc.heightOfString(name, { width: TEXT_W });
            const remarks = item.remarks || [];
            const remarkH = calcRemarkH(remarks, measureDoc);
            contentH += Math.max(textH, QTY_BOX_H) + ITEM_PAD + remarkH;
        });
    });
    return MARGIN_TOP + HEADER_H + contentH + extraFooterH + FOOTER_H + MARGIN_BOT;
}

// 建立出單 PDF，回傳 pageH
function buildReceiptPDF(data, filePath, groups) {
    return new Promise((resolve, reject) => {
        // ── 量測高度（不寫檔的暫存 doc） ─────────────────────────
        const mDoc = new PDFDocument({ size: [PAGE_W, 1000] });
        mDoc.registerFont('Bold', FONT_BOLD);
        mDoc.registerFont('Reg',  FONT_REG);
        const hasTakeout = (data.table === '外帶') &&
            (data.customerName || data.customerPhone || data.pickupTime != null);
        const hasTotal   = (data.table === '外帶') && data.total != null;
        const TOTAL_H    = hasTotal ? 28 : 0;
        const TAKEOUT_H  = (hasTakeout ? 62 : 0) + TOTAL_H;
        const pageH = calcPageHeight(groups, mDoc, TAKEOUT_H);
        // mDoc 不 end()，讓 GC 回收

        // ── 建立正式 PDF ─────────────────────────────────────────
        const doc = new PDFDocument({
            size:    [PAGE_W, pageH],
            margins: { top: MARGIN_TOP, bottom: MARGIN_BOT, left: MARGIN_SIDE, right: MARGIN_SIDE },
            compress: false,
        });
        const chunks = [];
        doc.on('data',  c => chunks.push(c));
        doc.on('end',   () => fs.writeFile(filePath, Buffer.concat(chunks),
                                e => e ? reject(e) : resolve(pageH)));
        doc.on('error', reject);

        doc.registerFont('Bold', FONT_BOLD);
        doc.registerFont('Reg',  FONT_REG);

        // ── 虛線輔助 ─────────────────────────────────────────────
        const dashedLine = (y1, dl, gl, lw, col) => {
            doc.save().dash(dl, { space: gl })
               .moveTo(MARGIN_SIDE, y1).lineTo(PAGE_W - MARGIN_SIDE, y1)
               .lineWidth(lw).strokeColor(col).stroke()
               .undash().restore();
        };

        // ── 時間戳記 ─────────────────────────────────────────────
        const now = new Date();
        const ts  = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ` +
                    `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

        let y = MARGIN_TOP;

        // ── 表頭：桌號＋單號（無空格，單行不換行） ───────────────
        const tableLabel = data.table || '外帶';
        const orderNo    = `No.${String(data.orderNo || 0).padStart(3,'0')}`;
        doc.font('Bold').fontSize(HDR_FONT_SZ).fillColor('black')
           .text(`[${tableLabel}]${orderNo}`,
                 MARGIN_SIDE, y, { width: CONT_W, align: 'center', lineBreak: false });
        y += 26;

        // 表頭實線 → 第一分類緊接
        doc.moveTo(MARGIN_SIDE, y).lineTo(PAGE_W - MARGIN_SIDE, y)
           .lineWidth(0.8).strokeColor('black').stroke();
        y += 2;

        // ── 品項（依分類分組） ────────────────────────────────────
        groups.forEach((group, gIdx) => {
            const totalQty = group.items.reduce((s, i) => s + (i.qty || 1), 0);

            if (gIdx > 0) y += CAT_GAP;

            // 分類名稱靠左，共N樣靠右
            doc.font('Reg').fontSize(CAT_FONT_SZ).fillColor('black')
               .text(group.category, MARGIN_SIDE, y, { lineBreak: false });
            doc.font('Reg').fontSize(CAT_FONT_SZ).fillColor('black')
               .text(`共${totalQty}樣`, MARGIN_SIDE, y,
                     { width: CONT_W, align: 'right', lineBreak: false });
            y += CAT_HEAD_H;

            dashedLine(y, 3, 2, 0.5, '#bbbbbb');
            y += CAT_LINE_H;

            group.items.forEach((item, iIdx) => {
                const name    = truncateName(item.printName || item.name);
                const qty     = item.qty || 1;
                const remarks = item.remarks || [];

                doc.font('Bold').fontSize(ITEM_FONT_SZ).fillColor('black');
                const textH   = doc.heightOfString(name, { width: TEXT_W });
                const remarkH = calcRemarkH(remarks, doc);
                const rowH    = Math.max(textH, QTY_BOX_H) + ITEM_PAD + remarkH;

                // 品項名稱靠左
                doc.font('Bold').fontSize(ITEM_FONT_SZ).fillColor('black');
                doc.text(name, MARGIN_SIDE, y, { width: TEXT_W, lineBreak: true });

                // 數量框：1→黑框白底；>1→黑底白字加粗（更醒目）
                const boxX = MARGIN_SIDE + TEXT_W + QTY_PAD;
                const boxY = y + (Math.max(textH, QTY_BOX_H) - QTY_BOX_H) / 2;
                if (qty === 1) {
                    doc.roundedRect(boxX, boxY, QTY_BOX_W, QTY_BOX_H, 3)
                       .lineWidth(1).strokeColor('black').stroke();
                    doc.font('Bold').fillColor('black').fontSize(14)
                       .text(String(qty), boxX, boxY + 2,
                             { width: QTY_BOX_W, align: 'center', lineBreak: false });
                } else {
                    doc.roundedRect(boxX, boxY, QTY_BOX_W, QTY_BOX_H, 3)
                       .fillAndStroke('black', 'black');
                    doc.font('Bold').fillColor('white').fontSize(14)
                       .text(String(qty), boxX, boxY + 2,
                             { width: QTY_BOX_W, align: 'center', lineBreak: false });
                }

                // 備註（縮排，自動換行，高度動態計算）
                if (remarks.length > 0) {
                    let remarkY = y + Math.max(textH, QTY_BOX_H) + 1;
                    doc.font('Reg').fontSize(REMARK_FONT_SZ).fillColor('black');
                    for (let ri = 0; ri < remarks.length; ri += 3) {
                        const trio = remarks.slice(ri, ri + 3).join('  ');
                        const trioH = doc.heightOfString(trio, { width: CONT_W - 10 });
                        doc.text(trio, MARGIN_SIDE + 8, remarkY,
                                 { width: CONT_W - 10, lineBreak: true });
                        remarkY += trioH;
                    }
                }

                y += rowH;

                if (iIdx < group.items.length - 1)
                    dashedLine(y - ITEM_PAD / 2, 2, 4, 0.3, '#cccccc');
            });
        });

        // ── 外帶取餐資訊（若有） ──────────────────────────────────
        if (hasTakeout) {
            y += 4;
            // 黑底白字標題
            const TK_BH = 16;
            doc.rect(MARGIN_SIDE, y, CONT_W, TK_BH).fill('black');
            doc.font('Bold').fontSize(9).fillColor('white')
               .text('取餐資訊', MARGIN_SIDE, y + 3, { width: CONT_W, align: 'center', lineBreak: false });
            y += TK_BH + 4;

            const half = CONT_W / 2;
            // 姓名 + 電話
            if (data.customerName || data.customerPhone) {
                doc.font('Bold').fontSize(11).fillColor('black')
                   .text(data.customerName || '', MARGIN_SIDE, y, { width: half, lineBreak: false });
                doc.font('Bold').fontSize(11).fillColor('black')
                   .text(data.customerPhone || '', MARGIN_SIDE + half, y, { width: half, lineBreak: false });
                y += 15;
            }
            // 取餐時間 + 餐具
            const ptMs = data.pickupTime;
            if (ptMs || data.needsUtensils != null) {
                const ptStr = ptMs ? (() => {
                    const d = new Date(ptMs);
                    return `取餐 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                })() : '';
                const utStr = data.needsUtensils ? '需要餐具' : '不需餐具';
                doc.font('Reg').fontSize(11).fillColor('black')
                   .text(ptStr, MARGIN_SIDE, y, { width: half, lineBreak: false });
                doc.font('Reg').fontSize(11).fillColor('black')
                   .text(utStr, MARGIN_SIDE + half, y, { width: half, lineBreak: false });
                y += 15;
            }

            y += 4;
        }

        // ── 外帶總金額（若有） ────────────────────────────────────
        if (hasTotal) {
            y += 6;
            doc.moveTo(MARGIN_SIDE, y).lineTo(PAGE_W - MARGIN_SIDE, y)
               .lineWidth(0.5).strokeColor('#555555').stroke();
            y += 5;
            doc.font('Reg').fontSize(10).fillColor('#333333')
               .text('合計', MARGIN_SIDE, y, { lineBreak: false });
            if (data.alreadyPaid) {
                doc.font('Bold').fontSize(12).fillColor('black')
                   .text('本單已結帳',
                         MARGIN_SIDE, y, { width: CONT_W, align: 'right', lineBreak: false });
            } else {
                doc.font('Bold').fontSize(14).fillColor('black')
                   .text(`$${Math.round(data.total).toLocaleString('en-US')}`,
                         MARGIN_SIDE, y, { width: CONT_W, align: 'right', lineBreak: false });
            }
            y += 16;
        }

        // ── 底部時間 ──────────────────────────────────────────────
        y += 4;
        doc.moveTo(MARGIN_SIDE, y).lineTo(PAGE_W - MARGIN_SIDE, y)
           .lineWidth(0.8).strokeColor('black').stroke();
        y += 4;
        doc.font('Reg').fontSize(7).fillColor('black')
           .text(ts, MARGIN_SIDE, y, { width: CONT_W, align: 'right' });

        doc.end();
    });
}

// lp 列印並刪除暫存檔（copies = 份數，預設 1，多份同時送出以確保切割且無等待延遲）
function printOnce(filePath, pageH) {
    return new Promise((resolve, reject) => {
        const media = `Custom.${PAGE_W}x${Math.ceil(pageH)}`;
        const args = ['-d', CUPS_PRINTER, '-o', `media=${media}`, '-o', 'CashDrawerSetting=0DoNotOpenDrawers', filePath];
        execFile('lp', args, (err, stdout, stderr) => {
            if (err) {
                console.error('lp 失敗：', stderr);
                reject(err);
            } else {
                console.log('lp 送出：', stdout.trim());
                resolve();
            }
        });
    });
}

async function printPDF(filePath, pageH, copies = 1) {
    try {
        // 多份同時送出（parallel），避免循序等待造成延遲
        await Promise.all(Array.from({ length: copies }, () => printOnce(filePath, pageH)));
    } finally {
        fs.unlink(filePath, () => {});
    }
}

// ----------------------------------------------------
// 【關帳報表 PDF】buildCloseReportPDF
// ----------------------------------------------------
function buildCloseReportPDF(data, filePath) {
    return new Promise((resolve, reject) => {
        const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString('en-US')}`;
        const fmtDate  = (ts) => {
            const d = new Date(ts);
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        };
        const fmtDT = (ts) => {
            const d = new Date(ts);
            return `${fmtDate(ts)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        };

        const activeCount  = data.activeCount  ?? (data.activeInvoices?.length || 0);
        const invoiceRange = data.invoiceRange ?? '';
        const voidedCount  = data.voidedCount  ?? (data.voidedInvoices?.length || 0);
        const voidedNums   = data.voidedNums   ?? [];
        const voidedAmount = data.voidedAmount ?? (data.voidedInvoices || []).reduce((s, i) => s + (i.amount || 0), 0);
        const expenses     = data.expenses || [];
        const incomes      = data.incomes  || [];
        const cancelledItems = data.cancelledItems || [];

        // ── 常數 ─────────────────────────────────────────────────────
        const CR_MT  = Math.round(1 * MM);
        const CR_MB  = Math.round(5 * MM);
        const CL     = 0;
        const CW     = PAGE_W;
        const AMT_PR = 5;           // 右側留白
        const BH     = 26;          // 黑色標題列高
        const RH     = 20;          // 一般 row 高
        const SRH    = 14;          // 小字 row 高
        const SH     = 7;           // 分隔線高（含間距）
        const GAP    = 4;           // 黑色列後空白
        const TCH    = 38;          // 兩欄金額（大數字 + 小標籤）
        const HALF   = Math.floor((CW - 4) / 2);
        const IH     = 22;          // 單品 row 高
        // 版面：品名 | qty框 | 金額
        const PRICE_W = 44;         // 金額欄寬（含 AMT_PR）
        const BOX_W   = 24;
        const BOX_H   = 17;
        const boxX    = CW - AMT_PR - PRICE_W - 4 - BOX_W;
        const nameW   = boxX - 4;

        const customGroups = data.customGroups
            || (data.frozenSales > 0 ? [{ name: '冷凍包', amount: data.frozenSales }] : []);
        const activeCustomGroups = customGroups.filter(g => (g.amount || 0) > 0);

        // ── 短溢原因預量測 ────────────────────────────────────────────
        let diffNoteH = 0;
        if (data.diff && data.diff !== 0 && data.discrepancyNote) {
            const mDoc = new PDFDocument({ size: [PAGE_W, 1000] });
            mDoc.registerFont('Reg', FONT_REG);
            mDoc.font('Reg').fontSize(9);
            diffNoteH = Math.max(SRH, mDoc.heightOfString(data.discrepancyNote, { width: CW - 8 }));
        }

        // ── 計算頁面高度 ──────────────────────────────────────────────
        let h = CR_MT;
        h += (BH + SRH + SRH) + GAP;                              // 關帳紀錄 header
        h += RH + SH;                                              // 營業日期
        h += RH + SH;                                              // 營業額
        activeCustomGroups.forEach(() => { h += RH + SH; });
        if (expenses.length > 0) h += SRH + Math.ceil(expenses.length / 2) * RH + SH;
        if (incomes.length  > 0) h += SRH + Math.ceil(incomes.length  / 2) * RH + SH;
        if (data.diff && data.diff !== 0) h += RH + diffNoteH + SH;

        h += BH + GAP;                                             // 發票/收據 header
        h += RH + SH;                                              // 發票張數
        if (activeCount > 0 && invoiceRange) h += RH + SH;        // 發票號碼（一行）
        if (voidedCount > 0) {
            h += RH + SH;                                          // 作廢張數/金額
            h += Math.max(1, voidedNums.length) * RH + SH;        // 作廢號碼
        }

        h += BH + GAP;                                             // 現金取出 header
        h += TCH + SH;

        if (cancelledItems.length > 0) {
            h += BH + GAP;                                         // 註銷單品 header
            h += cancelledItems.length * IH + SH;
            h += TCH + SH;
        }
        h += CR_MB + 8;

        // ── 建立 PDF ──────────────────────────────────────────────────
        const doc = new PDFDocument({
            size:    [PAGE_W, h],
            margins: { top: CR_MT, bottom: CR_MB, left: 0, right: 0 },
            compress: false,
        });
        const chunks = [];
        doc.on('data',  c => chunks.push(c));
        doc.on('end',   () => fs.writeFile(filePath, Buffer.concat(chunks), e => e ? reject(e) : resolve(h)));
        doc.on('error', reject);

        doc.registerFont('Bold', FONT_BOLD);
        doc.registerFont('Reg',  FONT_REG);

        let y = CR_MT;
        const col1X = CL, col2X = CL + CW / 2, colW = CW / 2 - AMT_PR;

        // ── 輔助函式 ──────────────────────────────────────────────────
        const solidLine = () => {
            doc.moveTo(CL, y).lineTo(CL + CW, y).lineWidth(0.6).strokeColor('black').stroke();
        };
        const sep = () => { solidLine(); y += SH; };

        // 左標籤 右值（同一行）
        const row = (label, value, labelSz = 10, valueSz = 11) => {
            doc.font('Reg').fontSize(labelSz).fillColor('black')
               .text(label, CL, y, { lineBreak: false });
            doc.font('Bold').fontSize(valueSz).fillColor('black')
               .text(value, CL, y, { width: CW - AMT_PR, align: 'right', lineBreak: false });
            y += RH;
        };

        // 並排兩欄（支出/收入）
        const twoPerRow = (items, prefix) => {
            for (let i = 0; i < items.length; i += 2) {
                const a = items[i], b = items[i + 1];
                const x2 = CL + HALF + 4;
                const labelW = HALF - AMT_PR - 32;
                doc.font('Reg').fontSize(9).fillColor('black')
                   .text(a.note, CL, y, { width: labelW, lineBreak: false });
                doc.font('Reg').fontSize(9).fillColor('black')
                   .text(`${prefix}${fmtMoney(a.amount)}`, CL, y, { width: HALF - AMT_PR, align: 'right', lineBreak: false });
                if (b) {
                    doc.font('Reg').fontSize(9).fillColor('black')
                       .text(b.note, x2, y, { width: labelW, lineBreak: false });
                    doc.font('Reg').fontSize(9).fillColor('black')
                       .text(`${prefix}${fmtMoney(b.amount)}`, x2, y, { width: HALF - AMT_PR, align: 'right', lineBreak: false });
                }
                y += RH;
            }
        };

        // 黑色標題列
        const blackBar = (lines) => {
            const barH = BH + (lines.length - 1) * SRH;
            doc.rect(CL, y, CW, barH).fill('black');
            doc.fillColor('white').font('Bold').fontSize(13)
               .text(lines[0], CL, y + 5, { width: CW, align: 'center', lineBreak: false });
            lines.slice(1).forEach((ln, i) => {
                doc.font('Reg').fontSize(9)
                   .text(ln, CL, y + BH + i * SRH - 2, { width: CW, align: 'center', lineBreak: false });
            });
            doc.fillColor('black');
            y += barH + GAP;
        };

        // ── Section 1：關帳紀錄 ──────────────────────────────────────
        blackBar(['關帳紀錄', fmtDT(data.periodStart), `~ ${fmtDT(data.periodEnd)}`]);

        row('營業日期', fmtDate(data.periodEnd || data.periodStart));
        sep();

        doc.font('Reg').fontSize(10).fillColor('black')
           .text('營業額', CL, y, { lineBreak: false });
        doc.font('Bold').fontSize(14).fillColor('black')
           .text(fmtMoney(data.sales), CL, y - 2, { width: CW - AMT_PR, align: 'right', lineBreak: false });
        y += RH; sep();

        activeCustomGroups.forEach(group => {
            doc.font('Reg').fontSize(10).fillColor('black')
               .text(group.name, CL, y, { lineBreak: false });
            doc.font('Bold').fontSize(14).fillColor('black')
               .text(fmtMoney(group.amount), CL, y - 2, { width: CW - AMT_PR, align: 'right', lineBreak: false });
            y += RH; sep();
        });

        if (expenses.length > 0) {
            doc.font('Reg').fontSize(9).fillColor('black')
               .text('臨時支出', CL, y, { lineBreak: false });
            y += SRH;
            twoPerRow(expenses, '-');
            sep();
        }
        if (incomes.length > 0) {
            doc.font('Reg').fontSize(9).fillColor('black')
               .text('臨時收入', CL, y, { lineBreak: false });
            y += SRH;
            twoPerRow(incomes, '+');
            sep();
        }

        if (data.diff && data.diff !== 0) {
            const sign = data.diff > 0 ? '+' : '';
            const diffLabel = data.diff > 0 ? '溢額' : '短額';
            doc.font('Reg').fontSize(10).fillColor('black')
               .text(diffLabel, CL, y, { lineBreak: false });
            doc.font('Bold').fontSize(11).fillColor('black')
               .text(`${sign}${fmtMoney(data.diff)}`, CL, y, { width: CW - AMT_PR, align: 'right', lineBreak: false });
            y += RH;
            if (data.discrepancyNote) {
                doc.font('Reg').fontSize(9).fillColor('black')
                   .text(data.discrepancyNote, CL + 4, y, { width: CW - 8, lineBreak: true });
                y += diffNoteH;
            }
            sep();
        }

        // ── Section 2：發票/收據 ──────────────────────────────────────
        blackBar(['發票/收據']);

        // 發票張數（左標籤 右大數字）
        doc.font('Reg').fontSize(10).fillColor('black')
           .text('發票張數', CL, y, { lineBreak: false });
        doc.font('Bold').fontSize(18).fillColor('black')
           .text(String(activeCount), CL, y - 3, { width: CW - AMT_PR, align: 'right', lineBreak: false });
        y += RH; sep();

        // 發票號碼（標籤 + 號碼同一行）
        if (activeCount > 0 && invoiceRange) {
            doc.font('Reg').fontSize(9).fillColor('black')
               .text('發票號碼', CL, y, { width: 48, lineBreak: false });
            doc.font('Bold').fontSize(9).fillColor('black')
               .text(invoiceRange, CL, y, { width: CW - AMT_PR, align: 'right', lineBreak: false });
            y += RH; sep();
        }

        // 作廢發票（有才印）
        if (voidedCount > 0) {
            doc.font('Reg').fontSize(10).fillColor('black')
               .text(`發票作廢 ${voidedCount}張`, CL, y, { width: CW / 2, lineBreak: false });
            doc.font('Bold').fontSize(10).fillColor('black')
               .text(fmtMoney(voidedAmount), CL, y, { width: CW - AMT_PR, align: 'right', lineBreak: false });
            y += RH; sep();
            // 每張號碼一列，標籤只在第一列顯示
            for (let i = 0; i < Math.max(1, voidedNums.length); i++) {
                doc.font('Reg').fontSize(9).fillColor('black')
                   .text(i === 0 ? '作廢號碼' : '', CL, y, { width: 48, lineBreak: false });
                if (voidedNums[i]) {
                    doc.font('Bold').fontSize(9).fillColor('black')
                       .text(voidedNums[i], CL, y, { width: CW - AMT_PR, align: 'right', lineBreak: false });
                }
                y += RH;
            }
            sep();
        }

        // ── Section 3：現金取出 / 預留零用金 ─────────────────────────
        blackBar(['現金取出 / 預留零用金']);
        doc.font('Bold').fontSize(15).fillColor('black')
           .text(fmtMoney(data.withdrawalAmount || 0), col1X, y, { width: colW, align: 'right', lineBreak: false });
        doc.font('Bold').fontSize(15).fillColor('black')
           .text(fmtMoney(data.reserveAmount || 0), col2X, y, { width: colW, align: 'right', lineBreak: false });
        y += 20;
        doc.font('Reg').fontSize(8).fillColor('black')
           .text('期間取出金額', col1X, y, { width: colW, align: 'right', lineBreak: false });
        doc.font('Reg').fontSize(8).fillColor('black')
           .text('預留零用金', col2X, y, { width: colW, align: 'right', lineBreak: false });
        y += 18; sep();

        // ── Section 4：註銷單品明細（有棄單才印）────────────────────
        if (cancelledItems.length > 0) {
            blackBar(['註銷單品明細']);
            let totalQty = 0, totalAmt = 0;
            for (const ci of cancelledItems) {
                const qty   = ci.quantity || 1;
                const price = (ci.price || 0) * qty;
                totalQty += qty;
                totalAmt += price;
                const textY = y + Math.floor((IH - 10) / 2);
                const bY    = y + Math.floor((IH - BOX_H) / 2);
                // 品名（廚房短名）
                doc.font('Reg').fontSize(10).fillColor('black')
                   .text(ci.printName || ci.name, CL + 2, textY, { width: nameW, lineBreak: false });
                // 數量框
                doc.rect(boxX, bY, BOX_W, BOX_H).lineWidth(0.8).strokeColor('black').stroke();
                doc.font('Bold').fontSize(10).fillColor('black')
                   .text(String(qty), boxX, bY + Math.floor((BOX_H - 10) / 2), { width: BOX_W, align: 'center', lineBreak: false });
                // 金額（右）
                doc.font('Bold').fontSize(10).fillColor('black')
                   .text(fmtMoney(price), CL, textY, { width: CW - AMT_PR, align: 'right', lineBreak: false });
                y += IH;
            }
            sep();
            doc.font('Bold').fontSize(15).fillColor('black')
               .text(String(totalQty), col1X, y, { width: colW, align: 'right', lineBreak: false });
            doc.font('Bold').fontSize(15).fillColor('black')
               .text(fmtMoney(totalAmt), col2X, y, { width: colW, align: 'right', lineBreak: false });
            y += 20;
            doc.font('Reg').fontSize(8).fillColor('black')
               .text('註銷單品數量', col1X, y, { width: colW, align: 'right', lineBreak: false });
            doc.font('Reg').fontSize(8).fillColor('black')
               .text('註銷單品金額', col2X, y, { width: colW, align: 'right', lineBreak: false });
            y += 18; sep();
        }

        doc.end();
    });
}

// ----------------------------------------------------
// 【顧客聯】buildCustomerReceiptPDF
// ----------------------------------------------------

// 完整品名對照表（顧客聯使用完整中文名）
const FULL_NAME_MAP = {
    // 小點
    seafood_fry:'酥炸海鮮', chicken_fry:'台式五香炸雞', pork_ball:'蜜椒小豬球',
    mushrooms_fry:'酥炸綜合菇', fries:'脆薯', egg_tofu:'酥炸雞蛋豆腐',
    rice_bowl:'關山香Ｑ白米飯', bread:'麵包', fried_egg:'荷包蛋', soft_egg:'溏心蛋',
    side_dish:'當日小菜', salad:'輕沙拉', soup:'海帶豆腐湯', grass_jelly:'仙草凍',
    // 主餐
    beef_stew:'台式紅燒牛腩筋飯', pork_ribs:'紅麴慢燒無錫排骨飯',
    milkfish:'紅燒無刺虱目魚肚飯', chicken_curry:'舒肥酒香嫩雞胸爪哇咖哩飯',
    pork_noodle:'炙烤霜降豬XO醬乾拌麵', seafood_tomato:'西西里風味蕃茄煮海鮮',
    goulash:'匈牙利燉牛肉湯', wine_seafood:'麻油海鮮醉老酒',
    chicken_soup:'客家陳年菜脯雞湯飯', mentaiko_pasta:'奶油明太子義大利麵附半熟太陽蛋',
    shrimp_pasta:'蕃茄蛤蜊鮮蝦義大利麵', salted_pork_pasta:'清炒鹹豬肉義大利麵',
    mushroom_pasta:'奶油野菇義大利麵',
    // 飲品
    luohan:'百草羅漢 (冷泡)', chrysanthemum:'菊花枸杞 (冷泡)', roselle:'洛神山楂 (冷泡)',
    coke:'可樂', sprite:'雪碧', ruby_tea:'18號紅玉 (熱)',
    osmanthus_oolong:'桂花烏龍茶 (熱)', rose_fruit:'玫瑰雙果茶 (熱)',
    americano:'經典美式咖啡', latte:'經典拿鐵咖啡', soymilk:'微糖豆奶',
    // 冷凍包
    frozen_beef:'(冷凍包) 台式紅燒牛腩筋', frozen_pork:'(冷凍包) 紅麴慢燒無錫排骨',
    frozen_chicken_soup:'(冷凍包) 客家陳年菜脯雞湯', frozen_goulash:'(冷凍包) 匈牙利燉牛肉湯',
    xo_sauce:'海味XO醬', casher:'腰果',
    // 單點
    beef_stew1:'(單點) 台式紅燒牛腩筋', pork_ribs1:'(單點) 紅麴慢燒無錫排骨',
    milkfish1:'(單點) 紅燒無刺虱目魚肚', chicken_curry1:'(單點) 舒肥酒香嫩雞胸爪哇咖哩',
    pork_noodle1:'(單點) 炙烤霜降豬XO醬乾拌麵', seafood_tomato1:'(單點) 西西里風味蕃茄煮海鮮',
    goulash1:'(單點) 匈牙利燉牛肉湯', wine_seafood1:'(單點) 麻油海鮮醉老酒',
    chicken_soup1:'(單點) 客家陳年菜脯雞湯',
    mentaiko_pasta1:'(單點) 奶油明太子義大利麵附半熟太陽蛋',
    shrimp_pasta1:'(單點) 蕃茄蛤蜊鮮蝦義大利麵',
    salted_pork_pasta1:'(單點) 清炒鹹豬肉義大利麵',
    mushroom_pasta1:'(單點) 奶油野菇義大利麵',
};

function getCustomerItemName(item) {
    const base = FULL_NAME_MAP[item.id] || item.name || '';
    // 主餐加序號前綴（數字緊接品名，不加空格）
    if ((item.category || '') === '主餐' && item.sortOrder != null) {
        return `${item.sortOrder}.${base}`;
    }
    return base;
}

// 顧客聯版面常數（無留白，使用紙面全寬）
const CM        = 2;                          // 最小側邊距（pt）
const CCW       = PAGE_W - CM * 2;           // 內容寬度
const C_NAME_W  = Math.round(CCW * 0.56);   // 品名欄
const C_QTY_W   = 13;                        // 數量欄
const C_UPR_W   = 24;                        // 單價欄
const C_PRI_W   = CCW - C_NAME_W - C_QTY_W - C_UPR_W; // 金額欄
const C_NAME_X  = CM;
const C_QTY_X   = CM + C_NAME_W;
const C_UPR_X   = C_QTY_X + C_QTY_W;
const C_PRI_X   = C_UPR_X + C_UPR_W;

const C_STO_SZ  = 9;   // 店名
const C_HDR_SZ  = 8;   // 主標題
const C_SUB_SZ  = 6;   // 副標題（時間）
const C_COL_SZ  = 6;   // 欄位標題
const C_ITEM_SZ = 8;   // 品項名稱
const C_REM_SZ  = 6.5; // 備註
const C_TOT_SZ  = 10;  // 合計
const C_REM_LH  = 7;   // 備註行高（緊湊單行）

function buildCustomerReceiptPDF(data, filePath) {
    return new Promise((resolve, reject) => {

        // ── 合併同品項（id+備註相同才合併） ─────────────────────────────────
        const remKey = (r) => JSON.stringify((r || []).slice().sort());
        const mmap = new Map();
        const rows = [];
        for (const item of (data.items || [])) {
            const k = (item.id || item.name) + ':::' + remKey(item.remarks);
            const ex = mmap.get(k);
            if (ex) { ex.qty = (ex.qty || 1) + (item.qty || 1); }
            else {
                const c = { ...item, qty: item.qty || 1 };
                mmap.set(k, c);
                rows.push(c);
            }
        }

        // ── 量測高度 ──────────────────────────────────────────────────────────
        const mDoc = new PDFDocument({ size: [PAGE_W, 1000] });
        mDoc.registerFont('Bold', FONT_BOLD).registerFont('Reg', FONT_REG);
        mDoc.font('Bold').fontSize(C_ITEM_SZ);

        let h = (C_STO_SZ + 3) + (C_HDR_SZ + 3) + (C_SUB_SZ + 3) + 4 + (C_COL_SZ + 3) + 3;
        for (const row of rows) {
            mDoc.font('Bold').fontSize(C_ITEM_SZ);  // reset each iteration
            const nameH = mDoc.heightOfString(getCustomerItemName(row), { width: C_NAME_W });
            const rems  = row.remarks || [];
            mDoc.font('Reg').fontSize(C_REM_SZ);
            const remH  = rems.length > 0
                ? mDoc.heightOfString(rems.join('  '), { width: C_NAME_W - 8, lineGap: 0 })
                : 0;
            h += Math.max(nameH, C_ITEM_SZ + 3) + 1 + remH + 1; // +1 gap, +1 divider
        }
        h += 10 + (C_TOT_SZ + 8); // 合計 section: line + gap + text + bottom buffer

        // ── 建立 PDF ──────────────────────────────────────────────────────────
        const doc = new PDFDocument({
            size: [PAGE_W, h],
            margins: { top: 0, bottom: 0, left: CM, right: CM },
            compress: false,
        });
        const chunks = [];
        doc.on('data',  c => chunks.push(c));
        doc.on('end',   () => fs.writeFile(filePath, Buffer.concat(chunks),
                                e => e ? reject(e) : resolve(h)));
        doc.on('error', reject);
        doc.registerFont('Bold', FONT_BOLD).registerFont('Reg', FONT_REG);

        const hLine = (y, lw) => {
            doc.moveTo(CM, y).lineTo(PAGE_W - CM, y)
               .lineWidth(lw || 0.6).strokeColor('black').stroke();
        };
        const cnow = new Date();
        const ts   = `${cnow.getFullYear()}/${String(cnow.getMonth()+1).padStart(2,'0')}/${String(cnow.getDate()).padStart(2,'0')} ` +
                     `${String(cnow.getHours()).padStart(2,'0')}:${String(cnow.getMinutes()).padStart(2,'0')}`;

        let y = 0;

        // 店名
        doc.font('Bold').fontSize(C_STO_SZ).fillColor('black')
           .text('咕咕義小餐館', CM, y, { width: CCW, align: 'center', lineBreak: false });
        y += C_STO_SZ + 3;

        // 主標題（桌號 + 單號）
        const tableLabel = data.table || '外帶';
        const orderLabel = `No.${String(data.orderNo || 0).padStart(3, '0')}`;
        doc.font('Reg').fontSize(C_HDR_SZ).fillColor('black')
           .text(`[${tableLabel}] ${orderLabel}  交易明細`, CM, y,
                 { width: CCW, align: 'center', lineBreak: false });
        y += C_HDR_SZ + 3;

        // 時間副標題
        doc.font('Reg').fontSize(C_SUB_SZ).fillColor('black')
           .text(ts, CM, y, { width: CCW, align: 'center', lineBreak: false });
        y += C_SUB_SZ + 3;

        // 上實線
        hLine(y, 0.8); y += 4;

        // 欄位標題（品名 / 數 / 單價 / 金額）
        doc.font('Reg').fontSize(C_COL_SZ).fillColor('black')
           .text('品名', C_NAME_X, y, { lineBreak: false });
        doc.font('Reg').fontSize(C_COL_SZ).fillColor('black')
           .text('數量', C_QTY_X, y, { width: C_QTY_W, align: 'center', lineBreak: false });
        doc.font('Reg').fontSize(C_COL_SZ).fillColor('black')
           .text('單價', C_UPR_X, y, { width: C_UPR_W, align: 'right', lineBreak: false });
        doc.font('Reg').fontSize(C_COL_SZ).fillColor('black')
           .text('金額', C_PRI_X, y, { width: C_PRI_W, align: 'right', lineBreak: false });
        y += C_COL_SZ + 3;

        // 細實線
        hLine(y, 0.4); y += 3;

        // 品項列表
        for (let idx = 0; idx < rows.length; idx++) {
            const row  = rows[idx];
            const name = getCustomerItemName(row);
            const qty  = row.qty || 1;
            const price = row.price || 0;
            const rems  = row.remarks || [];

            doc.font('Bold').fontSize(C_ITEM_SZ);
            const nameH = doc.heightOfString(name, { width: C_NAME_W });
            const rowH  = Math.max(nameH, C_ITEM_SZ + 3);

            // 品名（可換行）
            doc.font('Bold').fontSize(C_ITEM_SZ).fillColor('black')
               .text(name, C_NAME_X, y, { width: C_NAME_W, lineBreak: true });
            // 數量
            doc.font('Reg').fontSize(C_ITEM_SZ).fillColor('black')
               .text(String(qty), C_QTY_X, y, { width: C_QTY_W, align: 'center', lineBreak: false });
            // 單價
            doc.font('Reg').fontSize(C_ITEM_SZ).fillColor('black')
               .text(String(price), C_UPR_X, y, { width: C_UPR_W, align: 'right', lineBreak: false });
            // 金額
            doc.font('Reg').fontSize(C_ITEM_SZ).fillColor('black')
               .text(String(price * qty), C_PRI_X, y,
                     { width: C_PRI_W, align: 'right', lineBreak: false });
            y += rowH + 1;  // 1pt 緊密間距

            // 備註（縮排、單行間距、緊密排列）
            if (rems.length > 0) {
                doc.font('Reg').fontSize(C_REM_SZ).fillColor('black');
                const remText = rems.join('  ');
                const remH = doc.heightOfString(remText, { width: C_NAME_W - 8, lineGap: 0 });
                doc.text(remText, C_NAME_X + 8, y,
                         { width: C_NAME_W - 8, lineBreak: true, lineGap: 0 });
                y += remH;
            }

            // 品項間細線
            if (idx < rows.length - 1) {
                doc.moveTo(CM, y).lineTo(PAGE_W - CM, y)
                   .lineWidth(0.3).strokeColor('black').stroke();
                y += 1;
            }
        }

        // 下實線
        hLine(y, 0.8); y += 5;

        // 合計（同一列：左側「合計」右側金額）
        // 注意：PDFKit 在第一個 text() 後會推進 doc.y；
        // 第二個 text() 若提供相同 y 且 y < doc.y，PDFKit 會開新頁。
        // 解法：第一個 text() 後手動將 doc.y 重設回同一行再渲染金額。
        const total = data.total != null
            ? data.total
            : rows.reduce((s, r) => s + (r.price || 0) * (r.qty || 1), 0);
        const totY = y;
        doc.font('Reg').fontSize(C_TOT_SZ - 1).fillColor('black')
           .text('合計', CM, totY, { lineBreak: false });
        // 重設 x 與 y 游標，確保金額從 CM 起算、不超出版面
        doc.y = totY;
        doc.x = CM;
        doc.font('Bold').fontSize(C_TOT_SZ).fillColor('black')
           .text(`$${total.toLocaleString('en-US')}`,
                 { width: CCW, align: 'right', lineBreak: false });

        doc.end();
    });
}

// ----------------------------------------------------
// 【列印】POST /print
// printMode: 'kitchen' → 廚房聯×2, 'customer' → 顧客聯×1, 'all' → 廚房聯×2 + 顧客聯×1
// ----------------------------------------------------
app.post('/print', printRateLimit, async (req, res) => {
    const data = req.body;
    if (!data) return res.status(400).json({ error: '格式錯誤' });

    const printMode = data.printMode || 'kitchen';
    const kitchenCopies = data.kitchenCopies !== undefined ? Number(data.kitchenCopies) : 2;
    const openDrawer = !!data.openDrawer;
    console.log('--- 收到列印請求 ---', data.table, data.orderNo, 'mode:', printMode, 'kitchenCopies:', kitchenCopies, 'openDrawer:', openDrawer);

    // 立即回應前端，印表在背景執行（避免前端等待印表完成才解鎖）
    res.json({ status: '列印請求已送出' });

    // 背景非同步執行印表與開錢櫃
    (async () => {
        try {
            // 開錢櫃（僅結帳顧客聯才開，且在印單前執行）
            if (openDrawer) {
                await new Promise((resolve) => {
                    const client = new net.Socket();
                    client.connect(PRINTER_PORT, PRINTER_IP, () => {
                        const cmd = Buffer.from([0x07]);
                        client.write(cmd, () => { client.end(); resolve(); });
                    });
                    client.on('error', (e) => {
                        console.warn('開錢櫃失敗：', e.message);
                        resolve();
                    });
                });
                console.log('開錢櫃指令已發送');
            }

            const rawItems = data.items || [];
            const allItems = mergeNoRemarkItems(rawItems);

            // 廚房聯（kitchen 或 all 模式）：預設 2 份各自切割，kitchenCopies 可覆蓋
            if (printMode === 'kitchen' || printMode === 'all') {
                const allGroups = groupByCategory(allItems);
                if (allGroups.length > 0) {
                    const f = path.join(os.tmpdir(), `receipt_k_${Date.now()}.pdf`);
                    const h = await buildReceiptPDF(data, f, allGroups);
                    await printPDF(f, h, kitchenCopies);
                    console.log(`廚房聯已送出（${kitchenCopies}份，各自切割）`);
                }
            }

            // 顧客聯（customer 或 all 模式）：印一張
            if (printMode === 'customer' || printMode === 'all') {
                const f = path.join(os.tmpdir(), `receipt_c_${Date.now()}.pdf`);
                const h = await buildCustomerReceiptPDF(data, f);
                await printPDF(f, h, 1);
                console.log('顧客聯已送出（1份）');
            }
        } catch (e) {
            console.error('🔴 列印錯誤：', e);
        }
    })();
});

// ----------------------------------------------------
// 【列印關帳單】POST /print-close
// ----------------------------------------------------
app.post('/print-close', printRateLimit, async (req, res) => {
    const data = req.body;
    if (!data) return res.status(400).json({ error: '格式錯誤' });
    console.log('--- 收到關帳列印請求 ---');
    console.log('[關帳] activeCount:', data.activeCount, 'invoiceRange:', data.invoiceRange);
    console.log('[關帳] sales:', data.sales, 'frozenSales:', data.frozenSales);
    console.log('[關帳] voidedCount:', data.voidedCount, 'voidedAmount:', data.voidedAmount);
    try {
        const f = path.join(os.tmpdir(), `close_${Date.now()}.pdf`);
        const h = await buildCloseReportPDF(data, f);
        await printPDF(f, h);
        console.log('關帳單已送出');
        res.json({ status: '列印請求已送出' });
    } catch (e) {
        console.error('🔴 關帳列印錯誤：', e);
        if (!res.headersSent) res.status(500).json({ error: e.message });
    }
});

// ====================================================
// Supabase API 路由
// ====================================================

// ---- 工具：snake_case ↔ camelCase（僅轉最外層 key）----
const sc = s => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const cs = s => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
const rowToCamel = obj => obj ? Object.fromEntries(Object.entries(obj).map(([k,v])=>[sc(k),v])) : obj;
const rowsToCamel = r => Array.isArray(r) ? r.map(rowToCamel) : rowToCamel(r);

// ---- 健康檢查 ----
app.get('/api/health', async (req, res) => {
    const { error } = await supabase.from('menu_items').select('id').limit(1);
    res.json({ ok: !error, supabase: error ? error.message : 'connected', dev: IS_DEV });
});

// ============================================================
// 菜單
// ============================================================
app.get('/api/menu', async (req, res) => {
    const { data, error } = await supabase.from('menu_items').select('*').order('sort_order');
    if (error) return res.status(500).json({ error: error.message });
    // 建立庫存品項 stock 對照表
    const invMap = {};
    (data||[]).forEach(r => { if ((r.category||'').includes('庫存')) invMap[r.id] = r.stock; });
    res.json((data||[]).map(r => {
        const consumes = r.consumes || [];
        const linkedStocks = consumes.filter(cId => cId in invMap && invMap[cId] !== null).map(cId => invMap[cId]);
        const linkedStock = linkedStocks.length > 0 ? Math.min(...linkedStocks) : null;
        return {
            id: r.id, name: r.name, printName: r.print_name, price: r.price,
            category: r.category, sortOrder: r.sort_order, stock: r.stock,
            soldOut: r.sold_out, consumes, imageUrl: r.image_url,
            thresholds: r.thresholds || null,
            depleted: consumes.some(cId => cId in invMap && invMap[cId] !== null && invMap[cId] <= 0),
            linkedStock,
        };
    }));
});
app.post('/api/menu', async (req, res) => {
    const b = req.body;
    let id = b.id;
    if (!id) {
        const base = (b.name || 'item')
            .replace(/[^\w\u4e00-\u9fff]/g, '_')
            .replace(/_+/g, '_')
            .toLowerCase()
            .slice(0, 20);
        id = `${base}_${Date.now()}`;
    }
    const row = { id, name: b.name, print_name: b.printName||'',
        price: b.price, category: b.category||'', sort_order: b.sortOrder,
        stock: b.stock, sold_out: b.soldOut||false, consumes: b.consumes||[],
        image_url: b.imageUrl||null, thresholds: b.thresholds||null };
    const { data, error } = await supabase.from('menu_items').upsert(row).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(rowToCamel(data));
});
app.patch('/api/menu/:id', async (req, res) => {
    const b = req.body;
    const updates = {};
    if (b.name        !== undefined) updates.name       = b.name;
    if (b.printName   !== undefined) updates.print_name = b.printName;
    if (b.price       !== undefined) updates.price      = b.price;
    if (b.category    !== undefined) updates.category   = b.category;
    if (b.sortOrder   !== undefined) updates.sort_order = b.sortOrder;
    if (b.stock       !== undefined) updates.stock      = b.stock;
    if (b.soldOut     !== undefined) updates.sold_out   = b.soldOut;
    if (b.consumes    !== undefined) updates.consumes    = b.consumes;
    if (b.imageUrl    !== undefined) updates.image_url  = b.imageUrl;
    if (b.thresholds  !== undefined) updates.thresholds = b.thresholds;
    const { data, error } = await supabase.from('menu_items').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(rowToCamel(data));
});
app.delete('/api/menu/:id', async (req, res) => {
    const { error } = await supabase.from('menu_items').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});
app.post('/api/menu/reset-soldout', async (req, res) => {
    const { error } = await supabase.from('menu_items').update({ sold_out: false }).eq('sold_out', true);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============================================================
// 庫存異動紀錄
// ============================================================
app.get('/api/inventory-logs', async (req, res) => {
    const { item_id } = req.query;
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    let q = supabase.from('inventory_logs').select('*').gte('created_at', threeDaysAgo).order('created_at', { ascending: false }).limit(200);
    if (item_id) q = q.eq('item_id', item_id);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json((data||[]).map(r => ({ id: r.id, itemId: r.item_id, itemName: r.item_name, changeAmount: r.change_amount, note: r.note, createdAt: r.created_at })));
});
app.post('/api/inventory-logs', async (req, res) => {
    const { itemId, itemName, changeAmount, note } = req.body;
    const { data, error } = await supabase.from('inventory_logs').insert({ item_id: itemId, item_name: itemName, change_amount: changeAmount, note: note || null }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ id: data.id, itemId: data.item_id, itemName: data.item_name, changeAmount: data.change_amount, note: data.note, createdAt: data.created_at });
});

// ============================================================
// 桌位
// ============================================================
app.get('/api/tables', async (req, res) => {
    const { data, error } = await supabase.from('tables').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.json((data||[]).map(r => ({ tableNumber: r.table_number, status: r.status, orderId: r.order_id, lastOrderTime: r.updated_at })));
});
app.put('/api/tables/:tableNumber', async (req, res) => {
    const b = req.body;
    const row = { table_number: req.params.tableNumber, status: b.status,
        order_id: b.orderId||null, updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from('tables').upsert(row).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ tableNumber: data.table_number, status: data.status, orderId: data.order_id });
});
// 清桌（resetTableStatus）
app.post('/api/tables/:tableNumber/reset', async (req, res) => {
    const tn = req.params.tableNumber;
    const now = new Date().toISOString();
    const { consumeInventory = false } = req.body || {};
    // 優先使用 body 傳入的 orderId（外帶棄單需要），否則從 tables 表查
    let ord = null;
    if (req.body.orderId) {
        const { data } = await supabase.from('orders').select('*').eq('id', req.body.orderId).single();
        ord = data;
    } else {
        const { data: tableRow } = await supabase.from('tables').select('*').eq('table_number', tn).single();
        if (tableRow?.order_id) {
            const { data } = await supabase.from('orders').select('*').eq('id', tableRow.order_id).single();
            ord = data;
        }
    }
    if (ord) {
        const newStatus = ord.status === 'paid'   ? 'archived_paid'
                        : ord.status === 'served' ? 'abandoned'   // 有餐未結帳 → 保留 orderID
                        : null;                                    // new/open → 直接刪除
        if (newStatus) {
            await supabase.from('orders').update({ status: newStatus, updated_at: now }).eq('id', ord.id);
            // 棄單庫存扣除（依員工選擇）
            // 注意：庫存只在結帳時扣除，所以只處理「尚未結帳」的品項（isPaid !== true）
            if (newStatus === 'abandoned' && consumeInventory) {
                const merged = new Map();
                (ord.items || []).filter(it => !it.isPaid).forEach(it => {
                    const e = merged.get(it.id);
                    if (e) e.quantity += (it.quantity || 1);
                    else merged.set(it.id, { ...it, quantity: it.quantity || 1 });
                });
                for (const [, it] of merged) {
                    const { data: mi } = await supabase.from('menu_items').select('stock,consumes').eq('id', it.id).single();
                    if (!mi) continue;
                    const qty = it.quantity;
                    if (mi.stock != null) {
                        await supabase.from('menu_items').update({ stock: mi.stock - qty }).eq('id', it.id);
                        await supabase.from('inventory_logs').insert({ item_id: it.id, item_name: it.name, change_amount: -qty, note: '棄單消耗' });
                    }
                    for (const cId of (mi.consumes || [])) {
                        const { data: ci } = await supabase.from('menu_items').select('name,stock').eq('id', cId).single();
                        if (!ci || ci.stock == null) continue;
                        await supabase.from('menu_items').update({ stock: ci.stock - qty }).eq('id', cId);
                        await supabase.from('inventory_logs').insert({ item_id: cId, item_name: ci.name, change_amount: -qty, note: `棄單消耗 (${it.name})` });
                    }
                }
            }
        } else {
            await supabase.from('orders').delete().eq('id', ord.id);
        }
    }
    if (tn !== '外帶') {
        await supabase.from('tables').upsert({ table_number: tn, status: 'idle', order_id: null, updated_at: now });
    }
    res.json({ ok: true });
});
// 佔位但不開單（occupyTableWithoutOrder）
app.post('/api/tables/:tableNumber/occupy', async (req, res) => {
    const { timestamp } = req.body;
    await supabase.from('tables').upsert({
        table_number: req.params.tableNumber, status: 'open',
        order_id: null, updated_at: new Date(timestamp||Date.now()).toISOString()
    });
    res.json({ ok: true });
});

// 換桌：移動訂單到新桌位（或合併）
app.post('/api/orders/:id/move-table', async (req, res) => {
    const orderId = parseInt(req.params.id);
    const { newTable, fromTable, mergeWithOrderId } = req.body;
    const now = new Date().toISOString();
    const STATUS_PRIO = { served: 0, open: 1, paid: 2 };

    try {
        if (mergeWithOrderId) {
            // 合併模式：將來源訂單的品項合入目標訂單，來源訂單標記為棄單（佔號）
            const [{ data: srcOrder, error: srcErr }, { data: dstOrder, error: dstErr }] = await Promise.all([
                supabase.from('orders').select('*').eq('id', orderId).single(),
                supabase.from('orders').select('*').eq('id', mergeWithOrderId).single(),
            ]);
            if (srcErr || !srcOrder) return res.status(404).json({ error: '找不到來源訂單' });
            if (dstErr || !dstOrder) return res.status(404).json({ error: '找不到目標訂單' });

            const mergedItems = [...(dstOrder.items || []), ...(srcOrder.items || [])];
            const newTotal = mergedItems.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
            const mergedCount = (dstOrder.customer_count || 0) + (srcOrder.customer_count || 0);

            await supabase.from('orders').update({
                items: mergedItems, total: newTotal, sub_total: newTotal,
                customer_count: mergedCount, updated_at: now,
            }).eq('id', mergeWithOrderId);

            await supabase.from('orders').update({ status: 'abandoned', updated_at: now }).eq('id', orderId);
        } else {
            // 獨立模式：只更新桌號
            await supabase.from('orders').update({ table_number: newTable, updated_at: now }).eq('id', orderId);
        }

        // 重算來源桌位狀態
        if (fromTable && fromTable !== '外帶') {
            const { data: remaining } = await supabase.from('orders')
                .select('id, status').eq('table_number', fromTable).in('status', ['open', 'served', 'paid']);
            if (!remaining || remaining.length === 0) {
                await supabase.from('tables').upsert({ table_number: fromTable, status: 'idle', order_id: null, updated_at: now });
            } else {
                const best = remaining.slice().sort((a, b) => (STATUS_PRIO[a.status] ?? 3) - (STATUS_PRIO[b.status] ?? 3))[0];
                await supabase.from('tables').upsert({ table_number: fromTable, status: best.status, order_id: best.id, updated_at: now });
            }
        }

        // 更新目標桌位狀態（獨立模式）
        if (!mergeWithOrderId && newTable && newTable !== '外帶') {
            const { data: ordRow } = await supabase.from('orders').select('status').eq('id', orderId).single();
            const { data: existingAtNew } = await supabase.from('orders')
                .select('id, status').eq('table_number', newTable).in('status', ['open', 'served', 'paid']);
            const allAtNew = [...(existingAtNew || []), { id: orderId, status: ordRow?.status || 'open' }];
            const best = allAtNew.sort((a, b) => (STATUS_PRIO[a.status] ?? 3) - (STATUS_PRIO[b.status] ?? 3))[0];
            await supabase.from('tables').upsert({ table_number: newTable, status: best.status, order_id: best.id, updated_at: now });
        }

        res.json({ ok: true });
    } catch (e) {
        console.error('move-table error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ============================================================
// 訂單
// ============================================================

// 注意：specific routes 必須在 /:id 前面
app.get('/api/orders/active', async (req, res) => {
    const { data, error } = await supabase.from('orders').select('*')
        .in('status', ['open','served','paid']).order('id');
    if (error) return res.status(500).json({ error: error.message });
    res.json((data||[]).map(orderToCamel));
});
app.get('/api/orders/abandoned', async (req, res) => {
    const since = req.query.since ? new Date(parseInt(req.query.since)).toISOString() : null;
    let q = supabase.from('orders').select('*').eq('status', 'abandoned').order('id');
    if (since) q = q.gte('updated_at', since);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json((data || []).map(orderToCamel));
});
app.get('/api/orders/max-id', async (req, res) => {
    const { data } = await supabase.from('orders').select('id').order('id', { ascending: false }).limit(1);
    res.json({ maxId: data?.[0]?.id || 0 });
});
app.get('/api/orders/report', async (req, res) => {
    const { data: invs, error } = await supabase.from('invoices').select('*')
        .eq('status', '已開立').order('payment_time');
    if (error) return res.status(500).json({ error: error.message });
    const orderIds = [...new Set((invs||[]).map(i => i.order_id))];
    const { data: ords } = orderIds.length
        ? await supabase.from('orders').select('*').in('id', orderIds)
        : { data: [] };
    const oMap = new Map((ords||[]).map(o => [o.id, o]));
    res.json((invs||[]).map(inv => {
        const o = oMap.get(inv.order_id);
        return {
            id: inv.order_id, orderId: inv.order_id,
            dailyOrderNo: inv.daily_order_no || o?.daily_order_no,
            invoiceNumber: inv.invoice_number,
            timestamp: new Date(inv.payment_time).getTime(),
            total: inv.total || inv.amount,
            items: inv.items_snapshot || [],
            table: inv.table_name || o?.table_number || '外帶',
            currentOrderCustomerCount: o?.customer_count,
            customerCount: inv.customer_count || 0,
            orderType: inv.order_type,
        };
    }));
});
app.get('/api/orders/:id', async (req, res) => {
    const { id } = req.params;
    const { inv } = req.query; // optional invoice id
    if (inv) {
        const { data: invRow } = await supabase.from('invoices').select('*').eq('id', inv).single();
        if (invRow?.items_snapshot) {
            const { data: ord } = await supabase.from('orders').select('*').eq('id', id).single();
            const o = orderToCamel(ord || {});
            return res.json({ ...o, items: invRow.items_snapshot, total: invRow.total||invRow.amount, isSnapshot: true });
        }
    }
    const { data, error } = await supabase.from('orders').select('*').eq('id', id).single();
    if (error) return res.status(404).json({ error: error.message });
    res.json(orderToCamel(data));
});
// 建立新訂單（daily_order_no 一律為 null，待確認點餐時透過 /assign-no 補派）
app.post('/api/orders/new', async (req, res) => {
    const od = req.body;
    const now = new Date().toISOString();
    const row = {
        table_number: od.table, order_type: od.table === '外帶' ? '外帶' : '內用',
        status: od.status || 'open', items: od.items || [], total: od.total || 0,
        daily_order_no: null, sub_total: od.subTotal || 0, paid_amount: 0,
        customer_count: od.customerCount || 1, customer_name: od.customerName || '',
        customer_phone: od.customerPhone || '', customer_id: od.customerId || null,
        needs_utensils: od.needsUtensils || false, pickup_time: od.pickupTime || null,
        order_date: od.date || now,
        timestamp: od.timestamp ? new Date(od.timestamp).toISOString() : now,
        send_time: od.sendTime || null,
        updated_at: now,
    };
    const { data, error } = await supabase.from('orders').insert(row).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (od.table && od.table !== '外帶') {
        await supabase.from('tables').upsert({ table_number: od.table, status: od.status||'open', order_id: data.id, updated_at: now });
    }
    res.json({ id: data.id, dailyOrderNo: null });
});
// 為 daily_order_no=null 的訂單補派單號（首次送單時呼叫）
app.post('/api/orders/:id/assign-no', async (req, res) => {
    const orderId = parseInt(req.params.id);
    // 從 Supabase app_settings 讀取關帳邊界，不信任 client localStorage（多裝置不一致）
    const [{ data: closeIdRow }, { data: closeTsRow }] = await Promise.all([
        supabase.from('app_settings').select('value').eq('key', 'last_close_order_id').single(),
        supabase.from('app_settings').select('value').eq('key', 'last_close_time').single(),
    ]);
    const storedCloseOrderId = parseInt(closeIdRow?.value || '0', 10);
    const lastCloseTs = closeTsRow?.value || null;
    const { data: existing } = await supabase.from('orders').select('daily_order_no').eq('id', orderId).single();
    if (!existing) return res.status(404).json({ error: 'not found' });
    if (existing.daily_order_no) return res.json({ dailyOrderNo: existing.daily_order_no }); // 已派過
    // 計算：與 /api/orders/new 相同的期間邊界，只計已派號的訂單
    let count = 0;
    if (storedCloseOrderId > 0) {
        const { count: c } = await supabase.from('orders').select('id', { count: 'exact', head: true })
            .gt('id', storedCloseOrderId).not('daily_order_no', 'is', null);
        count = c || 0;
    } else if (lastCloseTs) {
        const { data: before } = await supabase.from('orders').select('id')
            .lt('timestamp', new Date(lastCloseTs).toISOString()).order('id', { ascending: false }).limit(1);
        const lastId = before?.[0]?.id || 0;
        const { count: c } = await supabase.from('orders').select('id', { count: 'exact', head: true })
            .gt('id', lastId).not('daily_order_no', 'is', null);
        count = c || 0;
    } else {
        const midnight = new Date(); midnight.setHours(0,0,0,0);
        const { count: c } = await supabase.from('orders').select('id', { count: 'exact', head: true })
            .gte('timestamp', midnight.toISOString()).not('daily_order_no', 'is', null);
        count = c || 0;
    }
    const dailyOrderNo = count + 1;
    await supabase.from('orders').update({ daily_order_no: dailyOrderNo }).eq('id', orderId);
    res.json({ dailyOrderNo });
});
// 更新訂單狀態
app.patch('/api/orders/:id', async (req, res) => {
    const b = req.body; const now = new Date().toISOString();
    const updates = { updated_at: now };
    if (b.status        !== undefined) updates.status        = b.status;
    if (b.items         !== undefined) updates.items         = b.items;
    if (b.total         !== undefined) updates.total         = b.total;
    if (b.subTotal      !== undefined) updates.sub_total     = b.subTotal;
    if (b.paidAmount    !== undefined) updates.paid_amount   = b.paidAmount;
    if (b.sendTime      !== undefined) updates.send_time     = b.sendTime;
    if (b.finishTime    !== undefined) updates.finish_time   = b.finishTime;
    if (b.customerCount !== undefined) updates.customer_count = b.customerCount;
    if (b.customerName  !== undefined) updates.customer_name = b.customerName;
    if (b.customerPhone !== undefined) updates.customer_phone = b.customerPhone;
    if (b.needsUtensils !== undefined) updates.needs_utensils = b.needsUtensils;
    if (b.pickupTime    !== undefined) updates.pickup_time   = b.pickupTime;
    if (b.customerId    !== undefined) updates.customer_id   = b.customerId;
    const { data, error } = await supabase.from('orders').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    // 同步桌位
    if (b.status && data.table_number && data.table_number !== '外帶') {
        await supabase.from('tables').upsert({ table_number: data.table_number, status: b.status, order_id: data.id, updated_at: now });
    }
    res.json(orderToCamel(data));
});
// completeOrderAndReport
app.post('/api/orders/:id/complete', async (req, res) => {
    const orderId = parseInt(req.params.id);
    const { newItems, tableNumber, isFullyPaid, sendTime } = req.body;
    const now = new Date().toISOString();
    const { data: existing, error: fetchErr } = await supabase.from('orders').select('*').eq('id', orderId).single();
    if (fetchErr || !existing) return res.status(404).json({ error: '找不到訂單' });

    const finalItems = newItems || existing.items || [];
    const currentTotal = finalItems.reduce((s, i) => s + (i.price||0) * (i.quantity||1), 0);
    const prevPaid = existing.paid_amount || 0;

    // 查已開立的發票，避免重複計入庫存／重複開立
    const { data: prevInvs } = await supabase.from('invoices').select('*').eq('order_id', orderId).eq('status', '已開立');
    const alreadyCounted = new Map();
    (prevInvs||[]).forEach(inv => (inv.items_snapshot||[]).forEach(it => {
        alreadyCounted.set(it.id, (alreadyCounted.get(it.id)||0) + (it.quantity||1));
    }));

    // 本次結帳品項：
    // - 全額結帳：所有品項
    // - 部分結帳：僅 isPaid=true 的品項（本次被選中結帳的）
    const itemsToCount = isFullyPaid ? finalItems : finalItems.filter(it => it.isPaid);
    const merged = new Map();
    itemsToCount.forEach(it => {
        const e = merged.get(it.id);
        if (e) e.quantity += it.quantity; else merged.set(it.id, { ...it });
    });

    // 扣掉已開立發票中已計入的數量，得到本次實際新增的快照
    const snapshot = [];
    merged.forEach((it) => {
        const diff = it.quantity - (alreadyCounted.get(it.id)||0);
        if (diff > 0) snapshot.push({ ...it, quantity: diff });
    });

    const amountNow = snapshot.reduce((s, it) => s + (it.price||0) * (it.quantity||1), 0);
    const newPaidAmount = prevPaid + amountNow;

    await supabase.from('orders').update({
        status: isFullyPaid ? 'paid' : 'served',
        items: finalItems, total: currentTotal,
        paid_amount: newPaidAmount,
        send_time: sendTime || existing.send_time || Date.now(),
        updated_at: now,
    }).eq('id', orderId);

    if (amountNow > 0) {
        // 建立發票（部分結帳也會建立，每次結帳一張）
        await supabase.from('invoices').insert({
            invoice_number: `INV-${Date.now()}`,
            payment_time: now,
            order_id: orderId, daily_order_no: existing.daily_order_no,
            order_type: tableNumber === '外帶' ? '外帶' : '內用',
            table_name: tableNumber, customer_count: existing.customer_count||0,
            total: amountNow, amount: amountNow,
            items_snapshot: snapshot, status: '已開立', void_time: null,
        });
        // 扣庫存 + 寫紀錄
        for (const it of snapshot) {
            const { data: mi } = await supabase.from('menu_items').select('stock,consumes').eq('id', it.id).single();
            if (!mi) continue;
            const qty = it.quantity || 1;
            if (mi.stock != null) {
                await supabase.from('menu_items').update({ stock: mi.stock - qty }).eq('id', it.id);
                await supabase.from('inventory_logs').insert({ item_id: it.id, item_name: it.name, change_amount: -qty, note: '點餐消耗' });
            }
            for (const cId of (mi.consumes||[])) {
                const { data: ci } = await supabase.from('menu_items').select('name,stock').eq('id', cId).single();
                if (!ci || ci.stock == null) continue;
                await supabase.from('menu_items').update({ stock: ci.stock - qty }).eq('id', cId);
                await supabase.from('inventory_logs').insert({ item_id: cId, item_name: ci.name, change_amount: -qty, note: `點餐消耗 (${it.name})` });
            }
        }
    }
    if (tableNumber && tableNumber !== '外帶') {
        await supabase.from('tables').upsert({ table_number: tableNumber, status: isFullyPaid ? 'paid' : 'served', order_id: orderId, updated_at: now });
    }
    res.json({ ok: true });
});

// ============================================================
// 發票
// ============================================================
app.get('/api/invoices', async (req, res) => {
    const { status, from } = req.query;
    let q = supabase.from('invoices').select('*').order('id');
    if (status) q = q.eq('status', status);
    if (from)   q = q.gte('payment_time', from);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json((data||[]).map(invoiceToCamel));
});
// 作廢發票
app.post('/api/invoices/:id/void', async (req, res) => {
    const invId = parseInt(req.params.id);
    const { restoreStock = false } = req.body || {};
    const now = new Date().toISOString();
    const { data: inv, error: fe } = await supabase.from('invoices').select('*').eq('id', invId).single();
    if (fe || !inv) return res.status(404).json({ error: '找不到發票' });
    if (inv.status === '已作廢') return res.status(400).json({ error: '此發票已作廢' });

    await supabase.from('invoices').update({ status: '已作廢', void_time: now }).eq('id', invId);

    const { data: ord } = await supabase.from('orders').select('*').eq('id', inv.order_id).single();
    if (ord) {
        const { data: tableRow } = ord.table_number && ord.table_number !== '外帶'
            ? await supabase.from('tables').select('*').eq('table_number', ord.table_number).single()
            : { data: null };
        const isArchived = ord.status === 'archived_paid' || ord.status === 'archived_voided';
        const isReleased = !tableRow || tableRow.status === 'idle' || tableRow.order_id !== ord.id;
        const newStatus = (isArchived || isReleased) ? 'archived_voided' : 'served';
        const newPaid = Math.max(0, (ord.paid_amount||0) - (inv.total||inv.amount||0));
        await supabase.from('orders').update({ status: newStatus, paid_amount: newPaid, updated_at: now }).eq('id', ord.id);
        if (!isArchived && !isReleased && tableRow) {
            await supabase.from('tables').upsert({ table_number: ord.table_number, status: 'served', order_id: ord.id, updated_at: now });
        }
        // 還庫存（依 restoreStock 決定是否執行）
        if (restoreStock) {
            for (const it of (inv.items_snapshot||[])) {
                const { data: mi } = await supabase.from('menu_items').select('stock,consumes').eq('id', it.id).single();
                if (!mi) continue;
                const qty = it.quantity || 1;
                if (mi.stock != null) {
                    await supabase.from('menu_items').update({ stock: mi.stock + qty }).eq('id', it.id);
                    await supabase.from('inventory_logs').insert({ item_id: it.id, item_name: it.name, change_amount: qty, note: `發票作廢還原` });
                }
                for (const cId of (mi.consumes||[])) {
                    const { data: ci } = await supabase.from('menu_items').select('name,stock').eq('id', cId).single();
                    if (!ci || ci.stock == null) continue;
                    await supabase.from('menu_items').update({ stock: ci.stock + qty }).eq('id', cId);
                    await supabase.from('inventory_logs').insert({ item_id: cId, item_name: ci.name, change_amount: qty, note: `發票作廢還原 (${it.name})` });
                }
            }
        }
    }
    res.json({ ok: true });
});

// ============================================================
// 備註群組
// ============================================================
app.get('/api/remarks', async (req, res) => {
    const { data, error } = await supabase.from('remark_groups').select('*').order('sort_order');
    if (error) return res.status(500).json({ error: error.message });
    res.json((data||[]).map(r => ({
        id: r.id,
        name: r.name,
        type: r.type || 'single',
        required: r.required || false,
        options: r.options || [],
        appliesTo: r.applies_to || [],
        optionItemMap: r.option_item_map || {},
        sortOrder: r.sort_order ?? 99,
    })));
});
app.post('/api/remarks', async (req, res) => {
    const b = req.body;
    const row = {
        id: b.id,
        name: b.name,
        type: b.type || 'single',
        required: b.required || false,
        options: b.options || [],
        applies_to: b.appliesTo || [],
        option_item_map: b.optionItemMap || {},
        sort_order: b.sortOrder ?? 99,
    };
    const { data, error } = await supabase.from('remark_groups').upsert(row).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});
app.patch('/api/remarks/reorder', async (req, res) => {
    const updates = req.body; // [{ id, sortOrder }]
    for (const { id, sortOrder } of updates) {
        const { error } = await supabase.from('remark_groups').update({ sort_order: sortOrder }).eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
    }
    res.json({ ok: true });
});
app.delete('/api/remarks/all', async (req, res) => {
    const { error } = await supabase.from('remark_groups').delete().not('id', 'is', null);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});
app.delete('/api/remarks/:id', async (req, res) => {
    const { error } = await supabase.from('remark_groups').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============================================================
// 顧客
// ============================================================
app.get('/api/customers', async (req, res) => {
    const { data, error } = await supabase.from('customers').select('*').order('id');
    if (error) return res.status(500).json({ error: error.message });
    res.json((data||[]).map(c => ({ ...c, names: c.names||[], phones: c.phones||[] })));
});
app.post('/api/customers/search', async (req, res) => {
    const { query } = req.body;
    if (!query) return res.json([]);
    const { data } = await supabase.from('customers').select('*');
    const q = query.toLowerCase().replace(/\s/g,'');
    res.json((data||[]).filter(c =>
        (c.names||[]).some(n => n.toLowerCase().includes(q)) ||
        (c.phones||[]).some(p => p.replace(/\s/g,'').includes(q))
    ).map(c => ({ ...c, names: c.names||[], phones: c.phones||[] })));
});
app.post('/api/customers', async (req, res) => {
    const { id, names, phones, notes } = req.body;
    if (id) {
        const { data: ex } = await supabase.from('customers').select('*').eq('id', id).single();
        if (ex) {
            const { data, error } = await supabase.from('customers').update({ names: names||ex.names||[], phones: phones||ex.phones||[], notes: notes !== undefined ? notes : ex.notes }).eq('id', id).select().single();
            if (error) return res.status(500).json({ error: error.message });
            return res.json(data);
        }
    }
    const { data, error } = await supabase.from('customers').insert({ names: names||[], phones: phones||[], notes: notes||'' }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});
app.delete('/api/customers/:id', async (req, res) => {
    const { error } = await supabase.from('customers').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});
app.get('/api/customers/:id/orders', async (req, res) => {
    const { data: cust } = await supabase.from('customers').select('phones').eq('id', req.params.id).single();
    if (!cust?.phones?.length) return res.json([]);
    const { data } = await supabase.from('orders').select('*')
        .eq('table_number', '外帶').in('customer_phone', cust.phones).order('id', { ascending: false });
    res.json((data||[]).map(orderToCamel));
});

// ============================================================
// 設定（關帳資訊跨裝置同步）
// ============================================================
app.get('/api/settings/:key', async (req, res) => {
    const { data } = await supabase.from('app_settings').select('value').eq('key', req.params.key).single();
    res.json({ value: data?.value ?? null });
});
app.post('/api/settings/:key', async (req, res) => {
    const { value } = req.body;
    await supabase.from('app_settings').upsert({ key: req.params.key, value: String(value), updated_at: new Date().toISOString() });
    res.json({ ok: true });
});

// ============================================================
// 轉換輔助函式（供上方路由使用）
// ============================================================
function orderToCamel(r) {
    if (!r) return r;
    return {
        id: r.id, table: r.table_number, orderType: r.order_type, status: r.status,
        items: r.items||[], total: r.total||0, subTotal: r.sub_total||0,
        paidAmount: r.paid_amount||0, dailyOrderNo: r.daily_order_no,
        customerCount: r.customer_count||1, customerName: r.customer_name||'',
        customerPhone: r.customer_phone||'', customerId: r.customer_id||null,
        needsUtensils: r.needs_utensils||false, pickupTime: r.pickup_time != null ? Number(r.pickup_time) : null,
        date: r.order_date, timestamp: r.timestamp ? new Date(r.timestamp).getTime() : null,
        sendTime: r.send_time ? Number(r.send_time) : null,
        finishTime: r.finish_time ? Number(r.finish_time) : null,
    };
}
function invoiceToCamel(r) {
    if (!r) return r;
    return {
        id: r.id, orderId: r.order_id, invoiceNumber: r.invoice_number,
        paymentMethod: r.payment_method, paymentTime: r.payment_time,
        status: r.status, amount: r.total||r.amount||0, total: r.total||r.amount||0,
        itemsSnapshot: r.items_snapshot||[], dailyOrderNo: r.daily_order_no,
        orderType: r.order_type, tableName: r.table_name,
        customerCount: r.customer_count||0, voidTime: r.void_time||null,
    };
}

// ----------------------------------------------------
// 【列印預覽】GET /print-preview（測試用）
// ----------------------------------------------------
app.get('/print-preview', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="zh-TW">
<head><meta charset="UTF-8"><title>列印預覽</title>
<style>
  body { font-family: sans-serif; background: #1a1a1a; color: #eee; margin: 0; padding: 20px; }
  h2 { color: #f97316; }
  textarea { width: 100%; height: 200px; font-size: 12px; background: #2a2a2a; color: #eee; border: 1px solid #444; padding: 8px; border-radius: 4px; }
  button { margin-top: 12px; padding: 10px 28px; background: #f97316; color: white; border: none; border-radius: 6px; font-size: 15px; cursor: pointer; }
  button:hover { background: #ea6c0a; }
  #frames { margin-top: 24px; display: flex; gap: 16px; flex-wrap: wrap; }
  .frame-wrap { background: #2a2a2a; border-radius: 8px; padding: 10px; }
  .frame-wrap h3 { margin: 0 0 8px; font-size: 13px; color: #aaa; }
  embed { border: none; }
</style>
</head>
<body>
<h2>⚠️ 列印預覽（開發測試用）</h2>
<p style="color:#aaa;font-size:13px">貼上或編輯下方 JSON，點「預覽」查看各張出單版面</p>
<textarea id="json">${JSON.stringify({
    table: 'A3',
    orderNo: 7,
    total: 1190,
    items: [
        { id: 'beefNoodle', name: '紅燒牛腩筋飯', printName: '牛腩筋飯', category: '主餐', sortOrder: 1, price: 340, qty: 2, remarks: ['七分'] },
        { id: 'pastaSpicy', name: '清炒鹹豬肉義大利麵', printName: '鹹豬肉義', category: '義大利麵', sortOrder: 12, price: 270, qty: 1, remarks: [] },
        { id: 'cola', name: '可樂', printName: '可樂', category: '飲料', sortOrder: 0, price: 50, qty: 2, remarks: [] },
        { id: 'rice', name: '關山香Ｑ白米飯', printName: '白飯', category: '附餐', sortOrder: 0, price: 30, qty: 1, remarks: ['加飯'] },
    ]
}, null, 2)}</textarea>
<button onclick="preview()">預覽出單</button>
<div id="frames"></div>
<script>
async function preview() {
    const json = document.getElementById('json').value;
    let data;
    try { data = JSON.parse(json); } catch(e) { alert('JSON 格式錯誤：' + e.message); return; }
    const btn = document.querySelector('button');
    btn.textContent = '產生中...'; btn.disabled = true;
    const res = await fetch('/print-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    const result = await res.json();
    btn.textContent = '預覽出單'; btn.disabled = false;
    const frames = document.getElementById('frames');
    frames.innerHTML = '';
    for (const slip of result.slips) {
        const div = document.createElement('div');
        div.className = 'frame-wrap';
        const h = Math.min(Math.round(slip.height * 2.83) + 40, 700);
        div.innerHTML = \`<h3>\${slip.name} <a href="\${slip.url}" target="_blank" style="color:#f97316;font-size:11px;margin-left:8px">新分頁開啟</a></h3>
<iframe src="\${slip.url}" width="220" height="\${h}" style="border:1px solid #444;border-radius:4px;background:white"></iframe>\`;
        frames.appendChild(div);
    }
}
</script>
</body></html>`);
});

// 提供預覽 PDF 檔案
app.get('/print-preview/:file', (req, res) => {
    const f = path.join(os.tmpdir(), req.params.file);
    if (!fs.existsSync(f)) return res.status(404).send('not found');
    res.setHeader('Content-Type', 'application/pdf');
    res.sendFile(f);
});

app.post('/print-preview', async (req, res) => {
    const data = req.body;
    if (!data) return res.status(400).json({ error: '格式錯誤' });
    try {
        const rawItems = data.items || [];
        const allItems = mergeNoRemarkItems(rawItems);
        const kitchenItems = allItems.filter(i => !BAR_CATS.has(i.category || ''));
        const barItems     = allItems.filter(i =>  BAR_CATS.has(i.category || ''));
        const kitchenGroups = groupByCategory(kitchenItems);
        const barGroups     = groupByCategory(barItems);

        const ts = Date.now();
        const slips = [];

        // 顧客聯
        {
            const fname = `preview_c_${ts}.pdf`;
            const f = path.join(os.tmpdir(), fname);
            const h = await buildCustomerReceiptPDF(data, f);
            slips.push({ name: '顧客聯', url: `/print-preview/${fname}`, height: h });
        }
        // 廚房單
        if (kitchenGroups.length > 0) {
            const fname = `preview_k_${ts}.pdf`;
            const f = path.join(os.tmpdir(), fname);
            const h = await buildReceiptPDF(data, f, kitchenGroups);
            slips.push({ name: '廚房單', url: `/print-preview/${fname}`, height: h });
        }
        // 吧台單
        if (barGroups.length > 0) {
            const fname = `preview_b_${ts}.pdf`;
            const f = path.join(os.tmpdir(), fname);
            const h = await buildReceiptPDF(data, f, barGroups);
            slips.push({ name: '吧台單', url: `/print-preview/${fname}`, height: h });
        }

        res.json({ slips });
    } catch (e) {
        console.error('預覽錯誤：', e);
        res.status(500).json({ error: e.message });
    }
});

// ----------------------------------------------------
// React build 靜態檔案（API 路由之後）
// ----------------------------------------------------
app.use(express.static(path.join(__dirname, 'build')));
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// ----------------------------------------------------
// 啟動 server
// ----------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Node server running on http://localhost:${PORT}`);
    console.log(`CUPS Printer: ${CUPS_PRINTER}`);

    // 啟動時清空 CUPS 佇列，避免藍牙重連後印出積壓的舊工作
    execFile('cancel', ['-a', CUPS_PRINTER], (err, stdout, stderr) => {
        if (err && !stderr.includes('No jobs')) {
            console.warn('清空 CUPS 佇列失敗：', stderr || err.message);
        } else {
            console.log('CUPS 佇列已清空');
        }
    });
});
