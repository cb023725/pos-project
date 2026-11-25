// gas/tools/gas_mock_test.js — 在本機用模擬的 Google 服務跑年菜 GAS 主要流程，抓執行期錯誤
// （真正的行為仍以部署到 Google 後的實測為準）
// 用法：node gas/tools/gas_mock_test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createGasEnv() {
let idSeq = 1000;
const nextId = () => String(++idSeq);
const chain = (obj) => new Proxy(obj, { get: (t, k) => (k in t ? t[k] : () => chain(t)) });

// ── Spreadsheet mock ──
function makeSheet(name) {
  const data = []; const notes = {}; let formUrl = null;
  const sh = {
    _data: data, name,
    getName: () => sh.name, setName: (n) => { sh.name = n; return sh; },
    getLastRow: () => { for (let r = data.length; r > 0; r--) if ((data[r - 1] || []).some(v => v !== '' && v !== undefined && v !== null)) return r; return 0; },
    getLastColumn: () => data.reduce((m, row) => { let c = 0; (row || []).forEach((v, i) => { if (v !== '' && v !== undefined) c = i + 1; }); return Math.max(m, c); }, 0),
    getMaxRows: () => 1000, getMaxColumns: () => 26 * 3,
    getRange: (r, c, nr = 1, nc = 1) => {
      if (typeof r === 'string') { const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(r); const col = (L) => L.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0); const c1 = col(m[1]), r1 = +m[2]; return sh.getRange(r1, c1, m[4] ? (+m[4] - r1 + 1) : 1, m[3] ? (col(m[3]) - c1 + 1) : 1); }
      const get = (i, j) => ((data[r - 1 + i] || [])[c - 1 + j]);
      const set = (i, j, v) => { const rr = r - 1 + i; data[rr] = data[rr] || []; data[rr][c - 1 + j] = v; };
      const rg = chain({
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => get(i, j) ?? '')),
        setValues: (vals) => { vals.forEach((row, i) => row.forEach((v, j) => set(i, j, v))); return rg; },
        setValue: (v) => { set(0, 0, v); return rg; }, getValue: () => get(0, 0) ?? '',
        setFormula: (f) => { set(0, 0, f); return rg; },
        getDisplayValue: () => String(get(0, 0) ?? ''),
        getNote: () => notes[`${r},${c}`] || '', setNote: (n) => { notes[`${r},${c}`] = n; return rg; },
        getRow: () => r, getColumn: () => c, getNumRows: () => nr, getNumColumns: () => nc, getSheet: () => sh,
        clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) set(i, j, ''); return rg; },
        protect: () => chain({ addEditor: () => {}, getEditors: () => [], removeEditors: () => {}, canDomainEdit: () => false }),
      });
      return rg;
    },
    getFormUrl: () => formUrl, _setFormUrl: (u) => { formUrl = u; },
    clear: () => { data.length = 0; return sh; },
    deleteRows: (r, n) => { data.splice(r - 1, n); return sh; },
    protect: () => chain({}),
  };
  return chain(sh);
}
function makeSpreadsheet(title) {
  const id = 'ss' + nextId(); const sheets = [makeSheet('工作表1')];
  const ss = chain({
    getId: () => id, getName: () => title, getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id,
    getSheets: () => sheets, getSheetByName: (n) => sheets.find(s => s.getName() === n) || null,
    insertSheet: (n) => { const s = makeSheet(n); sheets.push(s); return s; },
    deleteSheet: (sh) => { const i = sheets.indexOf(sh); if (i >= 0) sheets.splice(i, 1); },
    getProtections: () => [], _sheets: sheets,
  });
  return ss;
}
const spreadsheets = {};

// ── Form mock ──
const ItemType = { MULTIPLE_CHOICE: 'MC', LIST: 'LIST', GRID: 'GRID', TEXT: 'TEXT', PARAGRAPH_TEXT: 'PARA', PAGE_BREAK: 'PB', SECTION_HEADER: 'SH', IMAGE: 'IMG' };
function makeForm(title) {
  const id = 'form' + nextId(); const items = []; let accepting = true; let dest = null; const responses = [];
  const mkItem = (type) => {
    const it = { id: Number(nextId()), type, title: '', help: '', choices: [], rows: [], cols: [], required: false };
    const api = chain({
      getId: () => it.id, getType: () => type, getTitle: () => it.title,
      setTitle: (t) => { it.title = t; return api; }, setHelpText: (h) => { it.help = h; return api; }, setRequired: (b) => { it.required = b; return api; },
      setChoiceValues: (v) => { it.choices = v.slice(); return api; }, setChoices: (cs) => { it.choices = cs.map(c => c.v); return api; },
      createChoice: (v, page) => ({ v, page, getValue: () => v }),
      getChoices: () => it.choices.map(v => ({ getValue: () => v })),
      setRows: (r) => { it.rows = r.slice(); return api; }, getRows: () => it.rows, setColumns: (c) => { it.cols = c.slice(); return api; }, getColumns: () => it.cols,
      asMultipleChoiceItem: () => api, asListItem: () => api, asGridItem: () => api, asTextItem: () => api,
      createResponse: (v) => ({ item: it, v }), _it: it,
    });
    items.push(api); return api;
  };
  const form = chain({
    getId: () => id, getPublishedUrl: () => 'https://docs.google.com/forms/d/e/' + id + '/viewform', getEditUrl: () => 'https://docs.google.com/forms/d/' + id + '/edit',
    addMultipleChoiceItem: () => mkItem(ItemType.MULTIPLE_CHOICE), addListItem: () => mkItem(ItemType.LIST), addGridItem: () => mkItem(ItemType.GRID),
    addTextItem: () => mkItem(ItemType.TEXT), addPageBreakItem: () => mkItem(ItemType.PAGE_BREAK), addSectionHeaderItem: () => mkItem(ItemType.SECTION_HEADER), addImageItem: () => mkItem(ItemType.IMAGE),
    getItems: (type) => items.filter(i => !type || i.getType() === type), getItemById: (iid) => items.find(i => i.getId() === Number(iid)) || null,
    isAcceptingResponses: () => accepting, setAcceptingResponses: (b) => { accepting = b; return form; }, getResponses: () => responses, deleteAllResponses: () => { responses.length = 0; return form; },
    setDestination: (t, ssId) => {
      dest = spreadsheets[ssId]; const sh = dest.insertSheet('表單回應 1'); sh._setFormUrl('https://docs.google.com/forms/d/' + id + '/edit');
      const headers = ['時間戳記'];
      items.forEach(i => { const x = i._it; if ([ItemType.PAGE_BREAK, ItemType.SECTION_HEADER, ItemType.IMAGE].includes(x.type)) return; if (x.type === ItemType.GRID) x.rows.forEach(r => headers.push(x.title + ' [' + r + ']')); else headers.push(x.title); });
      sh.getRange(1, 1, 1, headers.length).setValues([headers]); form._respSheet = sh; return form;
    },
    createResponse: () => {
      const answers = []; const resp = chain({ withItemResponse: (r) => { answers.push(r); return resp; }, submit: () => {
        if (!accepting) throw new Error('表單未開放');
        const sh = form._respSheet; const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
        const row = new Array(headers.length).fill(''); row[0] = new ctx._Date(Date.parse('2026-11-25T10:00:00+08:00') + (ctx._tick++) * 1000); // 用 vm 內的 Date，instanceof Date 才成立
        answers.forEach(a => { const x = a.item; if (x.type === ItemType.GRID) x.rows.forEach((r, i) => { if (a.v[i]) row[headers.indexOf(x.title + ' [' + r + ']')] = a.v[i]; }); else row[headers.indexOf(x.title)] = a.v; });
        sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]); responses.push(row);
        return { getTimestamp: () => row[0] };
      } }); return resp;
    },
    _items: items,
  });
  return form;
}
const forms = {};

const ctx = {
  console,
  PropertiesService: { getScriptProperties: () => { const p = ctx._props; return { getProperty: (k) => p[k] ?? null, setProperty: (k, v) => { p[k] = v; }, deleteProperty: (k) => { delete p[k]; }, getProperties: () => ({ ...p }) }; } },
  _props: { WEBPOS_SECRET: 'x'.repeat(20) },
  DriveApp: chain({ getRootFolder: () => chain({ getName: () => '我的雲端硬碟', getFoldersByName: () => ({ hasNext: () => false }), createFolder: (n) => chain({ getId: () => 'folder' + nextId(), getName: () => n }) }),
    getFileById: () => chain({ moveTo: () => {}, getBlob: () => ({}) }) }),
  SpreadsheetApp: chain({ create: (t) => { const s = makeSpreadsheet(t); spreadsheets[s.getId()] = s; return s; }, openById: (id) => spreadsheets[id], flush: () => {},
    newConditionalFormatRule: () => chain({ build: () => ({}) }), ProtectionType: { RANGE: 'R', SHEET: 'S' } }),
  FormApp: { create: (t) => { const f = makeForm(t); forms[f.getId()] = f; return f; }, openById: (id) => forms[id], ItemType, DestinationType: { SPREADSHEET: 'SS' },
    createTextValidation: () => chain({ build: () => ({}) }) },
  ScriptApp: { getProjectTriggers: () => ctx._triggers.map(h => ({ getHandlerFunction: () => h, getTriggerSourceId: () => null })), deleteTrigger: () => {}, newTrigger: (h) => chain({ create: () => { ctx._triggers.push(h); } }) },
  Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, tryLock: () => true, releaseLock: () => {} }) },
  Utilities: { sleep: () => {}, computeHmacSha256Signature: (v, k) => Array.from(require('crypto').createHmac('sha256', k).update(v).digest()), base64EncodeWebSafe: (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'), formatDate: (d, tz, f) => new Date(d).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).replace(/-/g, '/') },
  MailApp: { sendEmail: (o) => { ctx._mails.push({ to: o.to, subject: o.subject, body: o.body }); if (!ctx._quiet) console.log('  [MailApp]', o.subject); }, getRemainingDailyQuota: () => ctx._quota },
  GmailApp: { sendEmail: (to, subj, b, o) => { if (ctx._failTo === to) throw new Error('模擬寄送失敗'); ctx._mails.push({ to, subject: subj, html: o.htmlBody, attachments: (o.attachments || []).length }); if (!ctx._quiet) console.log('  [Gmail] to', to, 'bcc', o.bcc || '-', subj); } },
  // 簡易 Apps Script 範本引擎（<? ?> 程式、<?= ?> 輸出），讓 HTML 範本真的跑一遍
  HtmlService: { createTemplateFromFile: (name) => { const src = fs.readFileSync(path.join(__dirname, '..', 'nianfai', name + '.html'), 'utf8'); const t = {
    evaluate: () => { let code = 'let __o="";'; let last = 0; src.replace(/<\?(=?)([\s\S]*?)\?>/g, (m, eq, body, idx) => { code += '__o+=' + JSON.stringify(src.slice(last, idx)) + ';'; code += eq ? '__o+=String(' + body + ');' : body; last = idx + m.length; return m; });
      code += '__o+=' + JSON.stringify(src.slice(last)) + ';return __o;'; const html = new Function('data', code)(t.data); return { getContent: () => html }; } }; return t; } },
  ContentService: { createTextOutput: (s) => ({ setMimeType: () => s }), MimeType: { JSON: 'json' } },
};
ctx._mails = []; ctx._quota = 100; ctx._triggers = []; ctx._tick = 0;
vm.createContext(ctx);
ctx._Date = vm.runInContext('Date', ctx);
const dir = path.join(__dirname, '..', 'nianfai');
fs.readdirSync(dir).filter(f => f.endsWith('.gs')).forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));

  return ctx;
}
module.exports = { createGasEnv };

if (require.main === module) {
const ctx = createGasEnv();
const items = [
  { id: 'fugui_set', name: '富貴套餐', price: 3500, isBundle: true, regular: false, cap: null,
    composition: ['鮑魚人蔘雞湯', '無錫排骨', '藥膳紹興松阪豬', '鹹菜干滷肉', '麻油酒香鮮蝦', '花雕雞'].map(n => ({ name: n, qty: 1 })) },
  ...[['abalone', '鮑魚人蔘雞湯', 1380, false], ['beef', '紅燒牛腩筋', 380, true], ['ribs', '無錫排骨', 380, true], ['veg', '鹹菜干滷肉', 450, false],
    ['shrimp', '麻油酒香鮮蝦', 450, false], ['pork', '藥膳紹興松阪豬', 450, false], ['chicken', '花雕雞', 480, false], ['c1', '糖霜腰果', 300, true],
    ['c2', '薄鹽腰果', 300, true], ['xo', '海味XO醬', 320, true]].map(([id, name, price, regular]) => ({ id, name, price, isBundle: false, regular, cap: null, composition: [] })),
];
const payload = { env: 'dev', year: 2027, folderName: '咕咕義年菜（測試）', shippingFee: 160, freeThreshold: 3000, bundleMax: 8, singleMax: 8,
  pickupDates: ['2027-01-29', '2027-01-30', '2027-01-31', '2027-02-01', '2027-02-02', '2027-02-03', '2027-02-04'], orderDeadline: '2027-01-07', pickupHours: '12:00 ~ 20:00',
  deliveryPeriod: '2027/1/25 (一) ~ 1/27 (三)', lastPickupText: '2027/2/4 (四)', lastPickupEnd: '16:00', items };

const run = (label, fn) => { try { const r = fn(); console.log('✔', label, r === undefined ? '' : JSON.stringify(r).slice(0, 400)); return r; } catch (e) { console.log('✘', label, e.stack); process.exitCode = 1; } };
const created = run('createYear', () => ctx.nfCreateYear_(payload));
run('ping', () => ctx.nfPing_('dev', 2027));
run('useYear', () => { ctx.nfUseYear_('dev', 2027); return Object.keys(ctx.NF_CTX.meta.ids); });
const respSheet = ctx.NF_CTX.ss.getSheetByName('表單回應');
console.log('  回應欄位：', respSheet.getRange(1, 1, 1, respSheet.getLastColumn()).getValues()[0].join(' | '));
run('checkForm (before orders)', () => ctx.nfCheckForm_());
run('submitOrder pickup', () => ctx.nfSubmitWebposOrder_({ orderId: 101, seqLabel: '27001', customerName: '測試', customerPhone: '0900', email: 'goodgoodeatrestaurant@gmail.com', deliveryMethod: 'pickup', pickupDate: '2027-01-30',
  items: [{ name: '富貴套餐', qty: 1 }, { name: '花雕雞', qty: 2 }] }));
run('submitOrder duplicate (same order)', () => ctx.nfSubmitWebposOrder_({ orderId: 101, seqLabel: '27001', items: [{ name: '花雕雞', qty: 1 }] }));
run('submitOrder collision (other order, same seq) → 應該報錯', () => { try { ctx.nfSubmitWebposOrder_({ orderId: 999, seqLabel: '27001', items: [{ name: '花雕雞', qty: 1 }] }); return 'NO ERROR (bad)'; } catch (e) { return 'error: ' + e.message; } });
run('submitOrder delivery', () => ctx.nfSubmitWebposOrder_({ orderId: 102, seqLabel: '27002', customerName: '測試2', customerPhone: '0911', email: 'guest@example.com', deliveryMethod: 'delivery',
  recipientName: '收', recipientPhone: '0922', recipientAddress: '台北', items: [{ name: '海味XO醬', qty: 1 }] }));
run('demand', () => { const d = ctx.nfComputeDemand_(); return { byName: d.demandByName, onsite: d.onsiteSeqs }; });
run('onFormSubmit (confirm mail)', () => ctx.nfOnFormSubmit({ range: respSheet.getRange(2, 1), source: ctx.NF_CTX.ss }));
run('onFormSubmit delivery', () => ctx.nfOnFormSubmit({ range: respSheet.getRange(3, 1), source: ctx.NF_CTX.ss }));
run('planFormSync', () => { const p = ctx.nfPlanFormSync_(); return { changes: p.changes, warnings: p.warnings }; });
run('finishProduction + sellout', () => { ctx.nfSetSelloutCap_('chicken', '花雕雞', 3); return ctx.nfCheckSellout_('test'); });
run('submit when closed', () => ctx.nfSubmitWebposOrder_({ orderId: 103, seqLabel: '27003', customerName: 'x', customerPhone: '1', email: 'goodgoodeatrestaurant@gmail.com', deliveryMethod: 'pickup', pickupDate: '2027-01-29', items: [{ name: '鮑魚人蔘雞湯', qty: 1 }] }));
run('form closed again?', () => ctx.NF_CTX.form.isAcceptingResponses());
run('clear whole row → no 已修改', () => { const lc = respSheet.getLastColumn(); const hdr = respSheet.getRange(1, 1, 1, lc).getValues()[0]; const ed = hdr.indexOf('已修改') + 1;
  respSheet.getRange(3, 1, 1, ed - 2).clearContent(); ctx.nfOnEdit({ range: respSheet.getRange(3, 1, 2, ed - 2), source: ctx.NF_CTX.ss });
  return { row3edited: respSheet.getRange(3, ed).getValue(), row4edited: respSheet.getRange(4, ed).getValue(), log: ctx.NF_CTX.ss.getSheetByName('修改紀錄').getRange(2, 1, 1, 3).getValues()[0] }; });
run('onEdit response log', () => { respSheet.getRange(2, 2).setValue('改'); ctx.nfOnEdit({ range: respSheet.getRange(2, 2), source: ctx.NF_CTX.ss, oldValue: '原' }); return ctx.NF_CTX.ss.getSheetByName('修改紀錄').getRange(2, 1, 1, 6).getValues()[0]; });
run('resetTestData', () => ctx.nfResetTestData_());
run('submit after reset (same seq, new order)', () => ctx.nfSubmitWebposOrder_({ orderId: 202, seqLabel: '27001', customerName: '重來', customerPhone: '0900', email: 'goodgoodeatrestaurant@gmail.com', deliveryMethod: 'pickup', pickupDate: '2027-01-29', items: [{ name: '花雕雞', qty: 1 }] }));
run('goLive (第一次)', () => { ctx.nfSubmitWebposOrder_({ orderId: 303, seqLabel: '27002', customerName: 't', customerPhone: '1', email: 'goodgoodeatrestaurant@gmail.com', deliveryMethod: 'pickup', pickupDate: '2027-01-29', items: [{ name: '花雕雞', qty: 1 }] });
  const r = ctx.nfGoLive_(false); return { ...r, rows: respSheet.getLastRow(), accepting: ctx.NF_CTX.form.isAcceptingResponses(), responses: ctx.NF_CTX.form.getResponses().length }; });
run('goLive (第二次) → 應該拒絕', () => { try { ctx.nfGoLive_(true); return 'NO ERROR (bad)'; } catch (e) { return 'error: ' + e.message; } });
run('ping live flag', () => { const p = ctx.nfPing_('dev', 2027); return { live: p.live, liveAt: !!p.liveAt }; });
run('正式上線後第一筆從第 2 列開始', () => { ctx.NF_CTX.form.setAcceptingResponses(true); ctx.nfSubmitWebposOrder_({ orderId: 404, seqLabel: '27001', customerName: '正式', customerPhone: '1', email: 'goodgoodeatrestaurant@gmail.com', deliveryMethod: 'pickup', pickupDate: '2027-01-29', items: [{ name: '花雕雞', qty: 1 }] }); return respSheet.getRange(2, 1, 1, 1).getValues()[0][0] ? 'row 2 filled' : 'row 2 empty (bad)'; });
// ── 宅配／自取／寄信 ──
const ss = () => ctx.NF_CTX.ss;
const colOf = (name, h) => ss().getSheetByName(name).getRange(1, 1, 1, 40).getValues()[0].indexOf(h) + 1;
const sheetObj = (name) => { const sh = ss().getSheetByName(name); const lr = sh.getLastRow(), lc = sh.getLastColumn(); const v = sh.getRange(1, 1, lr, lc).getValues();
  return v.slice(1).map(r => Object.fromEntries(v[0].map((h, i) => [h, r[i]]))); };
run('設定寄出日', () => { ctx.nfSetKv_('寄出日', '2027-01-25,2027-01-26,2027-01-27'); return ctx.nfReadSettings_().kv['寄出日']; });
// 線上單：直接寫進表單回應（模擬客人填表單）
const addOnline = (f) => {
  const lc = respSheet.getLastColumn(); const hdr = respSheet.getRange(1, 1, 1, lc).getValues()[0]; const row = hdr.map(() => '');
  const set = (pred, v) => { const i = hdr.findIndex(pred); if (i >= 0 && v !== undefined) row[i] = v; };
  row[0] = new ctx._Date(Date.parse('2026-12-01T20:00:00+08:00') + (ctx._tick++) * 1000);
  set(h => h.includes('取貨方式'), f.method); set(h => h.includes('訂購人') && h.includes('姓名'), f.name); set(h => h.includes('訂購人') && h.includes('電話'), f.phone);
  set(h => /e-?mail/i.test(h), f.email); set(h => h.includes('末五碼'), f.last5); set(h => h.includes('取貨日'), f.date);
  set(h => h.startsWith('收件人') && !h.includes('電話'), f.rn); set(h => h.includes('收件人') && h.includes('電話'), f.rp); set(h => h.includes('收件地址'), f.ra);
  Object.entries(f.items).forEach(([n, q]) => set(h => h.includes(n), q));
  const r = respSheet.getLastRow() + 1; respSheet.getRange(r, 1, 1, lc).setValues([row]);
  ctx.nfOnFormSubmit({ range: respSheet.getRange(r, 1), source: ss() });
};
run('再送 3 筆（線上宅配、線上自取明天、現場宅配）', () => {
  addOnline({ method: '宅配', name: '宅配客', phone: '0911222333', email: 'a@example.com', last5: '11111', rn: '收件人', rp: '0922', ra: '台中', items: { '富貴套餐': 1 } });
  addOnline({ method: '來店自取', name: '線上自取', phone: '0955000111', email: 'b@example.com', last5: '54321', date: ctx.nfFormDateLabel_(ctx.nfTomorrowIso_()), items: { '花雕雞': 2, '鮑魚': 3 } });
  ctx.nfSubmitWebposOrder_({ orderId: 502, seqLabel: '27003', customerName: '現場宅配', customerPhone: '0933', email: 'goodgoodeatrestaurant@gmail.com', deliveryMethod: 'delivery', recipientName: '收', recipientPhone: '0944', recipientAddress: '台北', items: [{ name: '花雕雞', qty: 1 }] });
  ctx.nfOnFormSubmit({ range: respSheet.getRange(respSheet.getLastRow(), 1), source: ss() });
  return { delivery: sheetObj('宅配').length, pickup: sheetObj('自取').length };
});
run('宅配／自取內容', () => ({ delivery: sheetObj('宅配').map(r => [r['訂單編號'], r['付款'], r['訂購姓名'], r['金額'], r['狀態'], r['品項']]),
  pickup: sheetObj('自取').map(r => [r['訂購姓名'], r['取貨日'], r['金額'], r['保冷袋'], r['付款'], r['狀態']]) }));
run('手動欄跟著訂單：付款打勾＋新訂單插進來後仍在同一筆', () => {
  const sh = ss().getSheetByName('宅配'); const r = sheetObj('宅配').findIndex(x => x['訂購姓名'] === '宅配客') + 2;
  sh.getRange(r, colOf('宅配', '付款')).setValue(true); sh.getRange(r, colOf('宅配', '託運單號')).setValue('1234567890'); ctx.nfOnEdit({ range: sh.getRange(r, 2), source: ss() });
  ctx.nfSyncOrderSheets_({ rebuild: true });
  const me = sheetObj('宅配').find(x => x['訂購姓名'] === '宅配客'); return { paid: me['付款'], trackNo: me['託運單號'] };
});
run('改非手動欄 → 還原', () => { const sh = ss().getSheetByName('宅配'); const old = sh.getRange(2, 3).getValue(); sh.getRange(2, 3).setValue('亂改');
  ctx.nfOnEdit({ range: sh.getRange(2, 3), source: ss(), oldValue: old }); return sh.getRange(2, 3).getValue() === old; });
run('已取貨打勾 → 自動記時間', () => { const sh = ss().getSheetByName('自取'); sh.getRange(2, 3).setValue(true); ctx.nfOnEdit({ range: sh.getRange(2, 3), source: ss() }); return { at: sh.getRange(2, 4).getValue() }; });
run('寄出前確認預覽', () => { const p = ctx.nfMailPreview_('preShip'); return { eligible: p.eligible.map(x => x.name), skipped: p.skipped.map(x => x.name + ':' + x.reason), quota: p.quota }; });
run('寄出前確認寄出（再寄一次不會重寄）', () => { ctx._mails = []; const r1 = ctx.nfMailSend_('preShip'); const r2 = ctx.nfMailSend_('preShip');
  const m = ctx._mails.find(x => x.html); return { sent1: r1.sent.length, sent2: r2.sent.length, htmlOk: !!m && m.html.includes('收件人') && m.html.includes('1/25') && !m.html.includes('<?'), status: sheetObj('宅配').map(x => x['寄出前確認']) }; });
run('出貨通知：缺出貨日的跳過', () => { const p = ctx.nfMailPreview_('shipped'); return p.skipped.map(x => x.name + ':' + x.reason); });
run('出貨通知：填出貨日後寄出', () => { const sh = ss().getSheetByName('宅配'); const rows = sheetObj('宅配'); const r = rows.findIndex(x => x['訂購姓名'] === '宅配客') + 2;
  sh.getRange(r, colOf('宅配', '出貨日')).setValue('1/26 (二)'); ctx._mails = []; const res = ctx.nfMailSend_('shipped'); const m = ctx._mails.find(x => x.html);
  return { sent: res.sent.map(x => x.name), html: !!m && m.html.includes('1234567890') && m.html.includes('1/26') && m.html.includes('鮑魚人蔘雞湯') }; });
run('託運單號：格式不對、重複 → 不寄', () => {
  const sh = ss().getSheetByName('宅配'); const rows = sheetObj('宅配'); const tc = colOf('宅配', '託運單號');
  const me = rows.findIndex(x => x['訂購姓名'] === '宅配客') + 2; const other = rows.findIndex(x => x['訂購姓名'] === '現場宅配') + 2;
  const keep = sh.getRange(me, tc).getValue();
  const rowsNow = () => ctx.nfReadOrderSheets_(ss(), ctx.nfReadSettings_()).rows.delivery;
  sh.getRange(me, tc).setValue('12345'); const bad = ctx.nfTrackNoProblem_(rowsNow()[me - 2], rowsNow());
  sh.getRange(me, tc).setValue('123456789012'); sh.getRange(other, tc).setValue('1234-5678-9012'); const dup = ctx.nfTrackNoProblem_(rowsNow()[me - 2], rowsNow());
  const okNo = (() => { sh.getRange(other, tc).setValue(''); return ctx.nfTrackNoProblem_(rowsNow()[me - 2], rowsNow()) || '通過'; })();
  sh.getRange(other, tc).setValue(''); sh.getRange(me, tc).setValue(keep);
  return { bad, dup, okNo, link: String(sh.getRange(me, colOf('宅配', '查詢')).getValue()).includes('HYPERLINK') };
});
run('開信追蹤：簽章正確才記錄，工作表顯示已開信', () => {
  ctx._props.WEB_APP_URL = 'https://script.google.com/macros/s/TEST/exec';
  const id = sheetObj('宅配').find(x => x['訂購姓名'] === '宅配客')['訂單編號'];
  const key = 'dev|2027|preShip|' + id; const good = ctx.nfOpenToken_(key);
  const forged = ctx.nfRecordOpen_(key, 'forged'); const ok = ctx.nfRecordOpen_(key, good);
  return { forged, ok, status: sheetObj('宅配').find(x => x['訂單編號'] === id)['寄出前確認'] };
});
run('Sheet 選單模式：只寄選取的列、取貨提醒不限日期', () => { const p = ctx.nfMailPlan_('pickupReminder', null, [sheetObj('自取')[1]['訂單編號']]); return p.list.map(x => x.name + ':' + (x.reason || '可寄')); });
run('取貨提醒（明天）＋失敗重試一次', () => { ctx._mails = []; ctx._failTo = 'b@example.com'; const r = ctx.nfMailSend_('pickupReminder', null, null, { retry: true, auto: true }); ctx._failTo = null;
  return { failed: r.failed.map(x => x.name), report: ctx._mails.filter(x => x.subject && x.subject.includes('取貨提醒')).map(x => x.subject), status: sheetObj('自取').map(x => x['取貨提醒']) }; });
run('取貨提醒失敗後可補寄', () => { ctx._mails = []; const r = ctx.nfMailSend_('pickupReminder'); const m = ctx._mails.find(x => x.html); return { sent: r.sent.map(x => x.name), hours: m && /12:00 ~ (20|16):00/.test(m.html) }; });
run('每日 08:00 觸發已安裝', () => ctx._triggers.includes('nfDailyPickupReminder'));
run('取消訂單（清除表單回應整列）→ 標已取消、統計不計入', () => {
  const rows = sheetObj('宅配'); const id = rows.find(x => x['訂購姓名'] === '現場宅配')['訂單編號'];
  const lc = respSheet.getLastColumn(); const all = respSheet.getRange(1, 1, respSheet.getLastRow(), lc).getValues();
  const r = all.findIndex((x, i) => i > 0 && ctx.nfFormatTimestamp_(x[0]) === id) + 1; const ed = all[0].indexOf('已修改');
  respSheet.getRange(r, 1, 1, ed - 1).clearContent(); ctx.nfOnEdit({ range: respSheet.getRange(r, 1, 1, ed - 1), source: ss() });
  const me = sheetObj('宅配').find(x => x['訂單編號'] === id); return { note: me['狀態'], stillThere: !!me };
});
run('改取貨方式 → 搬到另一張表、付款跟著走', () => {
  const id = sheetObj('宅配').find(x => x['訂購姓名'] === '宅配客')['訂單編號'];
  const lc = respSheet.getLastColumn(); const all = respSheet.getRange(1, 1, respSheet.getLastRow(), lc).getValues();
  const r = all.findIndex((x, i) => i > 0 && ctx.nfFormatTimestamp_(x[0]) === id) + 1; const mc = all[0].findIndex(h => String(h).includes('取貨方式')) + 1; const dc = all[0].findIndex(h => String(h).includes('取貨日')) + 1;
  respSheet.getRange(r, mc).setValue('來店自取'); respSheet.getRange(r, dc).setValue('2027/2/1 (一)'); ctx.nfOnEdit({ range: respSheet.getRange(r, mc), source: ss(), oldValue: '宅配' });
  const p = sheetObj('自取').find(x => x['訂單編號'] === id); return { inPickup: !!p, paid: p && p['付款'], inDelivery: sheetObj('宅配').some(x => x['訂單編號'] === id) };
});
run('分頁', () => ss().getSheets().map(s => s.getName()).join(' | '));
run('統計／備料表公式（取樣）', () => ({ stats: ss().getSheetByName('統計').getRange(2, 2).getValue().slice(0, 160), prepHead: ss().getSheetByName('備料表').getRange(1, 1, 1, 4).getValues()[0].join(' | '),
  lookup: ss().getSheetByName('查詢').getRange('A4').getValue().slice(0, 120) }));
run('寄範本（6 封，含確認信）', () => { ctx._mails = []; const r = ctx.nfMailSample_('review@example.com');
  const dir = process.env.MAIL_DUMP; if (dir) ctx._mails.filter(m => m.html).forEach((m, i) => fs.writeFileSync(require('path').join(dir, (i + 1) + '.html'), m.html));
  return { sent: r.sent, leftovers: ctx._mails.filter(m => m.html && /<\?|undefined|NaN/.test(m.html)).map(m => m.subject), subjects: ctx._mails.map(m => m.subject) }; });
run('測試清空 → 宅配／自取與寄信狀態歸零', () => { ctx.NF_CTX.meta.live = false; ctx.nfResetTestData_(); return { d: ss().getSheetByName('宅配').getLastRow(), p: ss().getSheetByName('自取').getLastRow(), ml: Object.keys(ctx._props).filter(k => k.startsWith('ML_')).length }; });
if (process.argv.includes('--texts')) {
  const f = ctx.NF_CTX.form;
  console.log('\n===== 表單說明 =====\n' + ctx.nfFormTexts_(ctx.nfReadSettings_()).description);
  f._items.forEach(i => console.log(`\n[${i._it.type}] ${i._it.title}${i._it.required ? ' *' : ''}\n${i._it.help}\n選項：${(i._it.choices.length ? i._it.choices : i._it.rows).join('、')}${i._it.cols.length ? '｜欄：' + i._it.cols.join(',') : ''}`));
}


}
