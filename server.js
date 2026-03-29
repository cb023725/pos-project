// server.js
const express    = require('express');
const bodyParser = require('body-parser');
const cors       = require('cors');
const net        = require('net');
const path       = require('path');
const os         = require('os');
const fs         = require('fs');
const { execFile } = require('child_process');
const PDFDocument  = require('pdfkit');

const app  = express();
const PORT = 3000;

// ----------------------------------------------------
// 【印表機設定】
// ----------------------------------------------------
const PRINTER_IP   = '192.168.0.104';
const PRINTER_PORT = 9100;
const CUPS_PRINTER = '_192_168_0_104';   // macOS CUPS 印表機名稱

// 58mm 紙寬，但 Star MCprint3 CUPS 驅動可列印寬度為 48mm
const MM          = 2.8346;
const PAGE_W      = Math.round(48 * MM);    // ≈ 136pt（驅動 printable width）
const MARGIN_TOP  = Math.round(15 * MM); // 上方 15mm
const MARGIN_SIDE = 4;                       // 左右最小留邊 4pt（驅動已含實體邊距）
const CONT_W      = PAGE_W - MARGIN_SIDE * 2;

// 字型：品項用 SimHei（黑體，視覺效果等同 Bold）；分類標題用 JhengHei（細）
const FONT_BOLD = '/Library/Fonts/Microsoft/SimHei.ttf';
const FONT_REG  = '/Library/Fonts/Microsoft/Microsoft Jhenghei.ttf';

// ----------------------------------------------------
// Middleware
// ----------------------------------------------------
app.use(bodyParser.json({ limit: '5mb' }));
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
}));

// ----------------------------------------------------
// 【現金抽屜】POST /api/cash-drawer
// ----------------------------------------------------
app.post('/api/cash-drawer', (req, res) => {
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

// 分類排列順序（前三張廚房單，後兩張吧台單）
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

// 依分類分組，並依 CAT_ORDER 排序
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
        .map(([category, items]) => ({ category, items }));
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
                const utStr = data.needsUtensils ? '需要餐具' : '';
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
            doc.font('Bold').fontSize(14).fillColor('black')
               .text(`$${Math.round(data.total).toLocaleString('en-US')}`,
                     MARGIN_SIDE, y, { width: CONT_W, align: 'right', lineBreak: false });
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

// lp 列印並刪除暫存檔
function printPDF(filePath, pageH) {
    return new Promise((resolve, reject) => {
        const media = `Custom.${PAGE_W}x${Math.ceil(pageH)}`;
        execFile('lp', ['-d', CUPS_PRINTER, '-o', `media=${media}`, filePath], (err, stdout, stderr) => {
            fs.unlink(filePath, () => {});
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

        // 支援新格式（range）與舊格式（activeInvoices array）
        const activeCount  = data.activeCount  ?? (data.activeInvoices?.length || 0);
        const invoiceRange = data.invoiceRange ?? '';
        const voidedCount  = data.voidedCount  ?? (data.voidedInvoices?.length || 0);
        const voidedNums   = data.voidedNums   ?? [];   // 每張作廢號碼（獨立列印）
        const voidedAmount = data.voidedAmount ?? (data.voidedInvoices || []).reduce((s, i) => s + (i.amount || 0), 0);
        const expenses = data.expenses || [];
        const incomes  = data.incomes  || [];

        // ── 常數 ─────────────────────────────────────────────────────
        const CR_MT  = Math.round(1 * MM);  // 上邊距 1mm
        const CR_MB  = Math.round(5 * MM);  // 下邊距 5mm
        const CL     = 0;                   // 左起點（無邊距）
        const CW     = PAGE_W;              // 內容全寬（無左右邊距）
        const AMT_PR = 5;                   // 金額右側留白 pt
        const BH     = 26;  // 單行黑色標題列高
        const RH     = 18;  // 一般 row 高
        const SRH    = 13;  // 小字 row 高
        const SH     = 6;   // 分隔線（含間距）
        const GAP    = 4;   // 黑色列後空白
        const TCH    = 36;  // 兩欄金額（數字 + 標籤）
        const HALF   = Math.floor((CW - 4) / 2);  // 並排每欄寬

        // ── 短溢原因預量測（字多自動換行，需先知道高度才能計算頁高） ──
        let diffNoteH = 0;
        if (data.diff && data.diff !== 0 && data.discrepancyNote) {
            const mDoc = new PDFDocument({ size: [PAGE_W, 1000] });
            mDoc.registerFont('Reg', FONT_REG);
            mDoc.font('Reg').fontSize(9);
            diffNoteH = Math.max(SRH, mDoc.heightOfString(data.discrepancyNote, { width: CW - 8 }));
        }

        // ── 計算頁面高度 ──────────────────────────────────────────────
        let h = CR_MT;

        // 關帳紀錄 (3行黑色列)
        h += (BH + SRH + SRH) + GAP;
        h += RH + SH;                                             // 營業日期
        h += RH + SH;                                             // 營業額（不含冷凍包）
        if (data.frozenSales > 0) h += RH + SH;                  // 冷凍包
        if (expenses.length > 0) h += SRH + Math.ceil(expenses.length / 2) * RH + SH;
        if (incomes.length  > 0) h += SRH + Math.ceil(incomes.length  / 2) * RH + SH;
        if (data.diff && data.diff !== 0) h += RH + diffNoteH + SH;  // 短溢金額列 + 原因列（可多行）

        // 發票/收據
        h += BH + GAP;
        h += RH + SH;                          // 發票張數
        if (activeCount > 0 && invoiceRange)
            h += RH + RH + SH;                 // 發票號碼標籤列 + 號碼列
        if (voidedCount > 0) {
            h += RH + SH;                          // 本期作廢張數/金額
            if (voidedNums.length > 0)
                h += SRH + voidedNums.length * SRH + SH;  // 「作廢號碼」標籤 + 每張一列
        }
        h += TCH + SH;                         // 匯出 | 留存

        h += CR_MB + 8;

        // ── 建立 PDF ─────────────────────────────────────────────────
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

        // ── 輔助函式 ─────────────────────────────────────────────────
        const solidLine = (y1, color = '#333333') => {
            doc.moveTo(CL, y1).lineTo(CL + CW, y1)
               .lineWidth(0.6).strokeColor(color).stroke();
        };
        const sep = () => { solidLine(y); y += SH; };

        // 左標籤 右值（右留 AMT_PR 空白）
        const row = (label, value, labelSz = 10, valueSz = 11) => {
            doc.font('Reg').fontSize(labelSz).fillColor('#111111')
               .text(label, CL, y, { lineBreak: false });
            doc.font('Bold').fontSize(valueSz).fillColor('black')
               .text(value, CL, y, { width: CW - AMT_PR, align: 'right', lineBreak: false });
            y += RH;
        };

        // 支出/收入並排兩個（金額右側留 AMT_PR 空白）
        const twoPerRow = (items, prefix) => {
            for (let i = 0; i < items.length; i += 2) {
                const a = items[i], b = items[i + 1];
                const x1 = CL, x2 = CL + HALF + 4;
                doc.font('Reg').fontSize(10).fillColor('#111111')
                   .text(a.note, x1, y, { lineBreak: false });
                doc.font('Reg').fontSize(10).fillColor('black')
                   .text(`${prefix}${fmtMoney(a.amount)}`, x1, y, { width: HALF - AMT_PR, align: 'right', lineBreak: false });
                if (b) {
                    doc.font('Reg').fontSize(10).fillColor('#111111')
                       .text(b.note, x2, y, { lineBreak: false });
                    doc.font('Reg').fontSize(10).fillColor('black')
                       .text(`${prefix}${fmtMoney(b.amount)}`, x2, y, { width: HALF - AMT_PR, align: 'right', lineBreak: false });
                }
                y += RH;
            }
        };

        // 黑色標題列（lines[0]=主標，其餘為小字）
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

        // 營業日期（用 periodEnd = 關帳當日，餐廳不跨日）
        row('營業日期', fmtDate(data.periodEnd || data.periodStart));
        sep();

        // 營業額（不含冷凍包）
        doc.font('Reg').fontSize(10).fillColor('#111111')
           .text('營業額', CL, y, { lineBreak: false });
        doc.font('Bold').fontSize(14).fillColor('black')
           .text(fmtMoney(data.sales), CL, y - 2, { width: CW - AMT_PR, align: 'right', lineBreak: false });
        y += RH; sep();

        // 冷凍包（若有才列印）
        if (data.frozenSales > 0) {
            doc.font('Reg').fontSize(10).fillColor('#111111')
               .text('冷凍包', CL, y, { lineBreak: false });
            doc.font('Bold').fontSize(14).fillColor('black')
               .text(fmtMoney(data.frozenSales), CL, y - 2, { width: CW - AMT_PR, align: 'right', lineBreak: false });
            y += RH; sep();
        }

        // 臨時支出 breakdown（每列並排兩項）
        if (expenses.length > 0) {
            doc.font('Reg').fontSize(9).fillColor('#333333')
               .text('臨時支出', CL, y, { lineBreak: false });
            y += SRH;
            twoPerRow(expenses, '-');
            sep();
        }

        // 臨時收入 breakdown（每列並排兩項）
        if (incomes.length > 0) {
            doc.font('Reg').fontSize(9).fillColor('#333333')
               .text('臨時收入', CL, y, { lineBreak: false });
            y += SRH;
            twoPerRow(incomes, '+');
            sep();
        }

        // 短溢金額（有差異才印）
        if (data.diff && data.diff !== 0) {
            const sign = data.diff > 0 ? '+' : '';
            const diffLabel = data.diff > 0 ? '溢額' : '短額';
            const diffColor = data.diff > 0 ? '#16a34a' : '#dc2626';
            // 第一列：標籤 左 / 金額 右
            doc.font('Reg').fontSize(10).fillColor('#111111')
               .text(diffLabel, CL, y, { lineBreak: false });
            doc.font('Bold').fontSize(11).fillColor(diffColor)
               .text(`${sign}${fmtMoney(data.diff)}`, CL, y,
                     { width: CW - AMT_PR, align: 'right', lineBreak: false });
            y += RH;
            // 第二列：原因（若有），允許換行，高度由 diffNoteH 決定
            if (data.discrepancyNote) {
                doc.font('Reg').fontSize(9).fillColor('#555555')
                   .text(data.discrepancyNote, CL + 4, y,
                         { width: CW - 8, lineBreak: true });
                y += diffNoteH;
            }
            sep();
        }

        // ── Section 2：發票/收據 ─────────────────────────────────────
        blackBar(['發票/收據']);

        // 發票張數
        doc.font('Reg').fontSize(10).fillColor('#111111')
           .text('發票張數', CL, y, { lineBreak: false });
        doc.font('Bold').fontSize(18).fillColor('black')
           .text(String(activeCount), CL, y - 4, { width: CW - AMT_PR, align: 'right', lineBreak: false });
        y += RH; sep();

        // 發票號碼區間（標籤一列，號碼獨立一列）
        if (activeCount > 0 && invoiceRange) {
            doc.font('Reg').fontSize(10).fillColor('#111111')
               .text('發票號碼', CL, y, { lineBreak: false });
            y += RH;
            doc.font('Bold').fontSize(10).fillColor('black')
               .text(invoiceRange, CL, y, { width: CW - AMT_PR, align: 'right', lineBreak: false });
            y += RH; sep();
        }

        // 本期作廢（若有才印）
        if (voidedCount > 0) {
            doc.font('Reg').fontSize(9).fillColor('#111111')
               .text(`本期發票作廢  ${voidedCount}張`, CL, y, { lineBreak: false });
            doc.font('Bold').fontSize(10).fillColor('black')
               .text(fmtMoney(voidedAmount), CL, y, { width: CW - AMT_PR, align: 'right', lineBreak: false });
            y += RH; sep();
            if (voidedNums.length > 0) {
                doc.font('Reg').fontSize(9).fillColor('#111111')
                   .text('作廢號碼', CL, y, { lineBreak: false });
                y += SRH;
                for (const num of voidedNums) {
                    doc.font('Bold').fontSize(9).fillColor('black')
                       .text(num, CL, y, { width: CW - AMT_PR, align: 'right', lineBreak: false });
                    y += SRH;
                }
                sep();
            }
        }

        // 今日匯出 | 留存現金（兩欄，右側留 AMT_PR）
        const col1X = CL, col2X = CL + CW / 2, colW = CW / 2 - AMT_PR;
        doc.font('Bold').fontSize(15).fillColor('black')
           .text(fmtMoney(data.withdrawalAmount || 0), col1X, y, { width: colW, align: 'right', lineBreak: false });
        doc.font('Bold').fontSize(15).fillColor('black')
           .text(fmtMoney(data.reserveAmount || 0),    col2X, y, { width: colW, align: 'right', lineBreak: false });
        y += 20;
        doc.font('Reg').fontSize(8).fillColor('#333333')
           .text('今日匯出金額', col1X, y, { width: colW, align: 'right', lineBreak: false });
        doc.font('Reg').fontSize(8).fillColor('#333333')
           .text('留存現金', col2X, y, { width: colW, align: 'right', lineBreak: false });
        y += 14;

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
                ? mDoc.heightOfString(rems.join('  '), { width: C_NAME_W - 4 })
                : 0;
            h += Math.max(nameH, C_ITEM_SZ + 3) + 2 + remH + 1; // +1 for item divider
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
            y += rowH + 2;

            // 備註（平行排列，自動換行）
            if (rems.length > 0) {
                doc.font('Reg').fontSize(C_REM_SZ).fillColor('black');
                const remText = rems.join('  ');
                const remH = doc.heightOfString(remText, { width: C_NAME_W - 4 });
                doc.text(remText, C_NAME_X + 4, y, { width: C_NAME_W - 4, lineBreak: true });
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

        // 合計（同一列：左側「合計」右側金額，用同一 y 絕對定位）
        const total = data.total != null
            ? data.total
            : rows.reduce((s, r) => s + (r.price || 0) * (r.qty || 1), 0);
        const totY = y;
        doc.font('Reg').fontSize(C_TOT_SZ - 1).fillColor('black')
           .text('合計', CM, totY, { lineBreak: false });
        doc.font('Bold').fontSize(C_TOT_SZ).fillColor('black')
           .text(`$${total.toLocaleString('en-US')}`, CM, totY,
                 { width: CCW, align: 'right', lineBreak: false });

        doc.end();
    });
}

// ----------------------------------------------------
// 【列印】POST /print  → 廚房單 + 吧台單（各一張）
// ----------------------------------------------------
app.post('/print', async (req, res) => {
    const data = req.body;
    if (!data) return res.status(400).json({ error: '格式錯誤' });

    console.log('--- 收到列印請求 ---', data.table, data.orderNo);

    try {
        const rawItems = data.items || [];
        // 無備註的相同品項合併數量
        const allItems = mergeNoRemarkItems(rawItems);

        // 依廚房 / 吧台拆分品項
        const kitchenItems = allItems.filter(i => !BAR_CATS.has(i.category || ''));
        const barItems     = allItems.filter(i =>  BAR_CATS.has(i.category || ''));

        const kitchenGroups = groupByCategory(kitchenItems);
        const barGroups     = groupByCategory(barItems);

        // 顧客聯（最先印，交給顧客）
        {
            const f = path.join(os.tmpdir(), `receipt_c_${Date.now()}.pdf`);
            const h = await buildCustomerReceiptPDF(data, f);
            await printPDF(f, h);
            console.log('顧客聯已送出');
        }

        // 廚房單（小點→主餐→單點，若有品項才印）
        if (kitchenGroups.length > 0) {
            const f = path.join(os.tmpdir(), `receipt_k_${Date.now()}.pdf`);
            const h = await buildReceiptPDF(data, f, kitchenGroups);
            await printPDF(f, h);
            console.log('廚房單已送出');
        }

        // 吧台單（飲料→冷凍包，若有品項才印）
        if (barGroups.length > 0) {
            const f = path.join(os.tmpdir(), `receipt_b_${Date.now()}.pdf`);
            const h = await buildReceiptPDF(data, f, barGroups);
            await printPDF(f, h);
            console.log('吧台單已送出');
        }

        res.json({ status: '列印請求已送出' });

    } catch (e) {
        console.error('🔴 列印錯誤：', e);
        if (!res.headersSent)
            res.status(500).json({ error: e.message });
    }
});

// ----------------------------------------------------
// 【列印關帳單】POST /print-close
// ----------------------------------------------------
app.post('/print-close', async (req, res) => {
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

// ----------------------------------------------------
// React build 靜態檔案（API 路由之後）
// ----------------------------------------------------
app.use(express.static(path.join(__dirname, 'build'), { dotfiles: 'allow' }));
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'), { dotfiles: 'allow' });
});

// ----------------------------------------------------
// 啟動 server
// ----------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Node server running on http://localhost:${PORT}`);
    console.log(`CUPS Printer: ${CUPS_PRINTER}`);
});
