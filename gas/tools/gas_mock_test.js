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
        const row = new Array(headers.length).fill(''); row[0] = new Date('2026-11-25T10:00:00+08:00');
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
  ScriptApp: { getProjectTriggers: () => [], deleteTrigger: () => {}, newTrigger: () => chain({}) },
  Session: { getEffectiveUser: () => ({}) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  Utilities: { formatDate: (d, tz, f) => new Date(d).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).replace(/-/g, '/') },
  MailApp: { sendEmail: (o) => console.log('  [MailApp]', o.subject) }, GmailApp: { sendEmail: (to, subj, b, o) => console.log('  [Gmail] to', to, 'bcc', o.bcc || '-', subj) },
  HtmlService: { createTemplateFromFile: () => ({ evaluate: () => ({ getContent: () => '<html/>' }) }) },
  ContentService: { createTextOutput: (s) => ({ setMimeType: () => s }), MimeType: { JSON: 'json' } },
};
vm.createContext(ctx);
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
const orders = ctx.NF_CTX.ss.getSheetByName('訂單整理');
console.log('  訂單整理欄位：', orders.getRange(1, 1, 1, orders.getLastColumn()).getValues()[0].join(' | '));
console.log('  小計公式：', orders.getRange(2, 1, 1, orders.getLastColumn()).getValues()[0].find(v => String(v).includes('設定')));
if (process.argv.includes('--texts')) {
  const f = ctx.NF_CTX.form;
  console.log('\n===== 表單說明 =====\n' + ctx.nfFormTexts_(ctx.nfReadSettings_()).description);
  f._items.forEach(i => console.log(`\n[${i._it.type}] ${i._it.title}${i._it.required ? ' *' : ''}\n${i._it.help}\n選項：${(i._it.choices.length ? i._it.choices : i._it.rows).join('、')}${i._it.cols.length ? '｜欄：' + i._it.cols.join(',') : ''}`));
}


}
