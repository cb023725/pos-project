// gas/tools/gas_next_year_test.js — 模擬「明年品項／價格／套餐組成／日期都改了」，確認建立出來的表單與 Sheet 都正確
// 用法：node gas/tools/gas_next_year_test.js
const { createGasEnv } = require('./gas_mock_test.js');
const ctx = createGasEnv();
ctx._quiet = true;
let fail = 0;
const check = (label, ok, detail) => { console.log((ok ? '✔ ' : '✘ ') + label + (detail ? '　' + detail : '')); if (!ok) fail++; };

// 2028：富貴套餐漲價、組成改（拿掉花雕雞、加入紅燒牛腩筋×1、鮑魚雞湯×2），單點只剩 7 項並改名、漲價
const items = [
  { id: 'b28', name: '富貴套餐', price: 3800, isBundle: true, regular: false, cap: null,
    composition: [['鮑魚人蔘雞湯', 2], ['無錫排骨', 1], ['紅燒牛腩筋', 1], ['鹹菜干滷肉', 1]].map(([name, qty]) => ({ name, qty })) },
  ...[['s1', '鮑魚人蔘雞湯', 1480], ['s2', '紅燒牛腩筋', 420], ['s3', '無錫排骨', 420], ['s4', '鹹菜干滷肉', 480],
    ['s5', '花雕雞', 520], ['s6', '佛跳牆', 1680], ['s7', '海味XO醬', 350]]
    .map(([id, name, price]) => ({ id, name, price, isBundle: false, regular: false, cap: null, composition: [] })),
];
const payload = { env: 'dev', year: 2028, folderName: '咕咕義年菜（測試）', shippingFee: 180, freeThreshold: 3500, bundleMax: 6, singleMax: 8,
  pickupDates: ['2028-01-20', '2028-01-21', '2028-01-22', '2028-01-23', '2028-01-24', '2028-01-25'], orderDeadline: '2028-01-05',
  pickupHours: '11:00 ~ 19:00', deliveryPeriod: '2028/1/15 (六) ~ 1/17 (一)', shipDates: ['2028-01-15', '2028-01-16', '2028-01-17'],
  lastPickupText: '2028/1/25 (二)', lastPickupEnd: '15:00', items };
ctx.nfCreateYear_(payload);
ctx.nfUseYear_('dev', 2028);
const ss = ctx.NF_CTX.ss, form = ctx.NF_CTX.form;

// ── 表單 ──
const fi = form._items.map(i => i._it);
const bundleQ = fi.find(i => i.type === 'LIST' && i.title.startsWith('富貴套餐'));
check('表單：套餐題目與新價格', bundleQ && bundleQ.title === '富貴套餐 (3800元)', bundleQ && bundleQ.title);
check('表單：套餐數量選項 1～6', bundleQ && bundleQ.choices.join(',') === '1,2,3,4,5,6', bundleQ && bundleQ.choices.join(','));
const grid = fi.find(i => i.type === 'GRID');
const wantRows = ['鮑魚人蔘雞湯 (1480元)', '紅燒牛腩筋 (420元)', '無錫排骨 (420元)', '鹹菜干滷肉 (480元)', '*花雕雞 (520元)', '*佛跳牆 (1680元)', '*海味XO醬 (350元)'];
check('表單：單點 7 列、新價格、不在套餐的加 *', grid && grid.rows.join('|') === wantRows.join('|'), grid && grid.rows.join('、'));
check('表單：單點數量 1～8', grid && grid.cols.join(',') === '1,2,3,4,5,6,7,8');
const dateQ = fi.find(i => i.type === 'LIST' && i.title.includes('取貨日'));
check('表單：取貨日選項', dateQ && dateQ.choices.length === 6 && dateQ.choices[0] === '2028/1/20 (四)', dateQ && dateQ.choices.join('、'));
const texts = ctx.nfFormTexts_(ctx.nfReadSettings_());
check('表單：說明帶入新的運費／免運門檻／日期', /180/.test(JSON.stringify(texts)) && /3,?500/.test(JSON.stringify(texts)) && /15:00/.test(JSON.stringify(texts)) && !/1899/.test(JSON.stringify(texts)));
check('表單：檢查表單對應通過', ctx.nfCheckForm_().ok, ctx.nfCheckForm_().problems.join('；'));
const resp = ss.getSheetByName('表單回應');
const hdr = resp.getRange(1, 1, 1, resp.getLastColumn()).getValues()[0];
check('表單回應：欄位用新品名', hdr.includes('富貴套餐 (3800元)') && hdr.some(h => h.includes('佛跳牆')) && !hdr.some(h => String(h).includes('麻油酒香鮮蝦')));

// ── 訂單 ──
ctx._mails = [];
const add = (o) => { ctx.nfSubmitWebposOrder_(o); ctx.nfOnFormSubmit({ range: resp.getRange(resp.getLastRow(), 1), source: ss }); };
// 宅配：套餐 1 份＋佛跳牆 1 → 3800+1680=5480，滿 3500 免運
add({ onlineLast5: '12345', customerName: '甲', customerPhone: '0911', email: 'a@example.com', deliveryMethod: 'delivery', recipientName: '甲', recipientPhone: '0911', recipientAddress: '台中', items: [{ name: '富貴套餐', qty: 1 }, { name: '佛跳牆', qty: 1 }] });
// 宅配：花雕雞 2 → 1040，未滿 3500 加運費 180 → 1220
add({ onlineLast5: '23456', customerName: '乙', customerPhone: '0922', email: 'b@example.com', deliveryMethod: 'delivery', recipientName: '乙', recipientPhone: '0922', recipientAddress: '台北', items: [{ name: '花雕雞', qty: 2 }] });
// 自取最後一天：套餐 2 份＋鮑魚雞湯 1 → 7600+1480=9080；保冷袋＝套餐 2＋單點 1480/3500 取整 0 = 2
add({ seqLabel: '28001', customerName: '丙', customerPhone: '0933', email: 'c@example.com', deliveryMethod: 'pickup', pickupDate: '2028-01-25', items: [{ name: '富貴套餐', qty: 2 }, { name: '鮑魚人蔘雞湯', qty: 1 }] });
const sheetObj = (name) => { const sh = ss.getSheetByName(name); const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues(); return v.slice(1).map(r => Object.fromEntries(v[0].map((h, i) => [h, r[i]]))); };
const dh = ss.getSheetByName('宅配').getRange(1, 1, 1, 60).getValues()[0].filter(String);
check('宅配：品項欄＝新的 8 項', dh.slice(dh.indexOf('備料日') + 1).join('|') === '富貴套餐|鮑魚人蔘雞湯|紅燒牛腩筋|無錫排骨|鹹菜干滷肉|花雕雞|佛跳牆|海味XO醬', dh.slice(dh.indexOf('備料日') + 1).join('、'));
const d = sheetObj('宅配'), p = sheetObj('自取');
check('宅配：滿 3,500 免運（新門檻）', d.find(x => x['訂購人'] === '甲')['金額'] === 5480, String(d.find(x => x['訂購人'] === '甲')['金額']));
check('宅配：未滿加運費 180（新運費）', d.find(x => x['訂購人'] === '乙')['金額'] === 1220, String(d.find(x => x['訂購人'] === '乙')['金額']));
check('自取：金額與保冷袋', p[0]['金額'] === 9080 && p[0]['保冷袋'] === 2, p[0]['金額'] + '／保冷袋 ' + p[0]['保冷袋']);

// ── 確認信 ──
const mails = ctx._mails.filter(m => m.html);
const m1 = mails[0].html.replace(/\u200B/g, ""), m3 = mails[2].html.replace(/\u200B/g, ""); // 日期裡的零寬字元（防手機變連結）
check('確認信：新價格、新套餐組成', m1.includes('$3,800') && m1.includes('$1,680') && m1.includes('紅燒牛腩筋') && !m1.includes('花雕雞</div>'), '');
check('確認信：寄出期間（新）', m1.includes('1/15 (六) ~ 1/17 (一)'));
check('確認信：最後一天取貨時段 11:00 - 15:00、現場單顯示 28001', m3.includes('11:00 - 15:00') && m3.includes('28001'));

// ── 統計／備料表公式：套餐組成用新的 ──
const prep = ss.getSheetByName('備料表');
const rows = prep.getRange(6, 1, 10, 4).getValues();
const row = (n) => rows.find(r => String(r[0]).startsWith(n));
check('備料表：品項＝新的 7 項單品＋套餐', rows.filter(r => r[0] && !String(r[0]).includes('（份')).length >= 7 && !!row('佛跳牆') && !row('麻油酒香鮮蝦'));
check('備料表：鮑魚雞湯的套餐內含 ×2（新組成）', String(row('鮑魚人蔘雞湯')[3]).includes('2*SUMIFS'), String(row('鮑魚人蔘雞湯')[3]).slice(0, 60));
check('備料表：紅燒牛腩筋含套餐（新組成）、花雕雞不含', String(row('紅燒牛腩筋')[3]).includes('SUMIFS') && String(row('花雕雞')[3]) === '=0');
const stats = ss.getSheetByName('統計').getRange(17, 1, 10, 7).getValues();
const srow = stats.find(r => r[0] === '佛跳牆');
check('統計：品項金額用新價格', srow && String(srow[6]).endsWith('*1680'), srow && String(srow[6]).slice(-20));

console.log(fail ? `\n${fail} 項不符` : '\n明年改品項／價格／組成／日期：表單與 Sheet 全部正確');
process.exitCode = fail ? 1 : 0;
