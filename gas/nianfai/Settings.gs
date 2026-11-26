/**
 * 「設定」分頁：品項的唯一來源是 WebPOS（menu management → 年菜管理頁「同步品項到 Sheet」）。
 *
 * 版面：
 *   A:B  項目｜值        （年度、運費、免運門檻、數量上限、取貨日、寄出期間… 部分由 WebPOS 寫入，
 *                          祝賀語、最後取貨日說明等由 Yw 自己填，WebPOS 同步時不覆蓋沒傳的項目）
 *   D:K  品項表          品項ID｜品名｜單價｜類型｜套餐組成｜平常也賣｜停售上限｜製作入庫
 *        製作入庫：WebPOS 對應庫存的目前數量（年節限定＝年菜庫存、平常也賣＝冷凍包庫存），供需庫存「製作」欄用
 *        套餐組成格式：「鮑魚人蔘雞湯×1、無錫排骨×1」（用品名，方便閱讀）
 */
var NF_SETTINGS_ITEM_HEADERS = ['品項ID', '品名', '單價', '類型', '套餐組成', '平常也賣', '停售上限', '製作入庫'];
var NF_SETTINGS_ITEM_COL = 4; // D 欄

var NF_SETTINGS_DEFAULTS = [
  ['年度', ''],
  ['運費', 160],
  ['免運門檻', 3000],
  ['套餐上限', 8],
  ['單點上限', 8],
  ['預購截止日', ''],            // YYYY-MM-DD（WebPOS 年菜管理頁設定）
  ['取貨日', ''],               // YYYY-MM-DD，逗號分隔（WebPOS 同步）
  ['每日取貨時間', '12:00 ~ 20:00'],
  ['寄出期間', ''],             // 例：2027/1/25 (一) ~ 1/27 (三)
  ['寄出日', ''],               // YYYY-MM-DD，逗號分隔（WebPOS 同步）→「宅配」出貨日下拉選單
  ['最後取貨日說明', ''],        // 例：2027/2/4 (四)
  ['最後取貨結束時間', '16:00'],
  ['祝賀語', '羊年行大運'],
  ['表單問候語', '家家圍爐慶團圓\n鴻運呈祥賀新年\n咕咕義新春年菜\n陪你迎接嶄新羊年！'],
  ['店址', '台中市西區東興路三段13號1樓'],
  ['電話', '04 2471 5526'],
  ['LINE', 'https://lin.ee/ntYrjY9'],
  ['地圖連結', 'https://maps.google.com/?cid=15270325023204343081'], // 信件底部地址連到 Google 商家資訊
  ['套餐圖片ID', ''],           // 雲端硬碟圖片檔案 ID，建立表單時插在套餐題目前（空白就不放）
  ['單點圖片ID', ''],           // 插在單點表格前
  ['取貨提醒開關', '關'],        // 開：每天 08:00 自動寄給明天取貨的客人（WebPOS 年菜管理頁切換）
  ['加熱說明小卡ID', ''],        // 雲端硬碟圖片檔案 ID，出貨通知與取貨提醒的附件（空白就不附）
  ['匯款戶名', ''],             // 確認信「匯款資訊」，由 Yw 自己填（不放在程式裡）
  ['匯款銀行', ''],
  ['匯款分行', ''],
  ['匯款帳號', ''],
];

var NF_MONEY_KEYS = ['運費', '免運門檻'];
var NF_BANK_KEYS = ['匯款戶名', '匯款銀行', '匯款分行', '匯款帳號'];
/** 「設定」還沒填的匯款資訊（確認信要用，沒填完不能正式上線／開賣） */
function nfBankMissing_(settings) {
  var kv = (settings || nfReadSettings_()).kv;
  return NF_BANK_KEYS.filter(function (k) { return !String(kv[k] || '').trim(); });
}
/** 「1,000」「$3,000」也讀得懂 */
function nfNum_(v) { return Number(String(v === null || v === undefined ? '' : v).replace(/[,$＄\s]/g, '')) || 0; }

/** 「設定」的金額（運費、免運門檻、品項單價）一律顯示千分位 */
function nfFormatSettingsMoney_(sh) {
  var last = Math.max(sh.getLastRow(), 2);
  sh.getRange(2, NF_SETTINGS_ITEM_COL + 2, last - 1, 1).setNumberFormat('#,##0'); // 單價
  sh.getRange(1, 1, last, 1).getValues().forEach(function (r, i) {
    if (NF_MONEY_KEYS.indexOf(String(r[0]).trim()) < 0) return;
    var c = sh.getRange(i + 1, 2), v = c.getValue();
    if (v !== '' && v !== null) c.setNumberFormat('#,##0').setValue(nfNum_(v));
  });
}

function nfEnsureSettingsSheet_() {
  var ss = nfSpreadsheet_();
  var sh = ss.getSheetByName(NF.SHEET_SETTINGS);
  if (!sh) sh = ss.insertSheet(NF.SHEET_SETTINGS);
  if (!sh.getRange(1, 1).getValue()) {
    sh.getRange(1, 1, 1, 2).setValues([['項目', '值']]).setFontWeight('bold');
    sh.getRange(2, 1, NF_SETTINGS_DEFAULTS.length, 2).setValues(NF_SETTINGS_DEFAULTS);
  }
  nfFormatSettingsMoney_(sh);
  if (!sh.getRange(1, NF_SETTINGS_ITEM_COL).getValue()) {
    sh.getRange(1, NF_SETTINGS_ITEM_COL, 1, NF_SETTINGS_ITEM_HEADERS.length)
      .setValues([NF_SETTINGS_ITEM_HEADERS]).setFontWeight('bold');
  }
  return sh;
}

function nfReadSettings_() {
  var sh = nfSheet_(NF.SHEET_SETTINGS);
  var last = Math.max(sh.getLastRow(), 1);
  var kv = {};
  sh.getRange(1, 1, last, 2).getValues().forEach(function (r, i) {
    if (i === 0 || !r[0]) return;
    var v = r[1];
    // 「16:00」「2027/2/4」這類值會被試算表自動轉成時間／日期，讀回文字
    if (v instanceof Date) v = Utilities.formatDate(v, NF.TZ, v.getFullYear() < 1901 ? 'HH:mm' : 'yyyy/M/d');
    kv[String(r[0]).trim()] = v;
  });
  var items = [];
  if (last > 1) {
    sh.getRange(2, NF_SETTINGS_ITEM_COL, last - 1, NF_SETTINGS_ITEM_HEADERS.length).getValues().forEach(function (r) {
      if (!r[1]) return;
      items.push({
        id: String(r[0] || '').trim(),
        name: String(r[1]).trim(),
        price: nfNum_(r[2]) || 0,
        isBundle: String(r[3]).trim() === '套餐',
        compositionText: String(r[4] || ''),
        regular: String(r[5]).trim() === '是',
        cap: r[6] === '' || r[6] === null ? null : Number(r[6]),
      });
    });
  }
  var byName = {};
  items.forEach(function (it) { byName[it.name] = it; });
  // 套餐組成：品名×數量 → [{item, qty}]
  items.forEach(function (it) {
    it.composition = [];
    if (!it.isBundle) return;
    it.compositionText.split(/[、,，]/).forEach(function (part) {
      var m = /^\s*(.+?)\s*[×xX*]\s*(\d+)\s*$/.exec(part);
      if (!m) return;
      var sub = byName[m[1]];
      if (sub) it.composition.push({ item: sub, qty: Number(m[2]) });
    });
  });
  // 有沒有包含在任何套餐裡（表單上不在套餐裡、只能單點的品項加 *，沿用 2026 年寫法）
  items.forEach(function (it) {
    it.inBundle = items.some(function (b) { return b.isBundle && b.composition.some(function (c) { return c.item === it; }); });
  });
  var pickupDates = String(kv['取貨日'] || '').split(/[,，\s]+/).filter(String);
  return {
    kv: kv,
    items: items,
    byName: byName,
    year: String(kv['年度'] || ''),
    shippingFee: nfNum_(kv['運費']) || 160,
    freeThreshold: nfNum_(kv['免運門檻']) || 3000,
    bundleMax: Number(kv['套餐上限']) || 8,
    singleMax: Number(kv['單點上限']) || 8,
    pickupDates: pickupDates,
  };
}

/** WebPOS → 「設定」：只覆蓋 payload 有傳的項目，其餘（祝賀語等）保留 Yw 填的值 */
function nfWriteSettingsFromWebpos_(p) {
  var sh = nfEnsureSettingsSheet_();
  var kvUpdates = {
    '年度': p.year,
    '運費': p.shippingFee,
    '免運門檻': p.freeThreshold,
    '套餐上限': p.bundleMax,
    '單點上限': p.singleMax,
    '取貨日': (p.pickupDates || []).join(','),
    '預購截止日': p.orderDeadline,
    '每日取貨時間': p.pickupHours,
    '寄出期間': p.deliveryPeriod,
    '寄出日': p.shipDates ? p.shipDates.join(',') : undefined,
    '最後取貨日說明': p.lastPickupText,
    '最後取貨結束時間': p.lastPickupEnd,
  };
  var last = Math.max(sh.getLastRow(), 1);
  var keys = sh.getRange(1, 1, last, 1).getValues().map(function (r) { return String(r[0]).trim(); });
  Object.keys(kvUpdates).forEach(function (k) {
    var v = kvUpdates[k];
    if (v === undefined || v === null) return;
    var idx = keys.indexOf(k);
    if (NF_MONEY_KEYS.indexOf(k) >= 0) { // 金額：存數字＋千分位格式
      var r0 = idx >= 0 ? idx + 1 : keys.length + 1;
      sh.getRange(r0, 1, 1, 2).setValues([[k, nfNum_(v)]]);
      sh.getRange(r0, 2).setNumberFormat('#,##0');
      if (idx < 0) keys.push(k);
    } else if (idx >= 0) {
      sh.getRange(idx + 1, 2).setNumberFormat('@').setValue(String(v));
    } else {
      var row = keys.length + 1;
      sh.getRange(row, 2).setNumberFormat('@');
      sh.getRange(row, 1, 1, 2).setValues([[k, String(v)]]);
      keys.push(k);
    }
  });

  var items = p.items || [];
  var rows = items.map(function (it) {
    var comp = (it.composition || []).map(function (c) { return c.name + '×' + c.qty; }).join('、');
    return [it.id, it.name, it.price, it.isBundle ? '套餐' : '單點', comp, it.regular ? '是' : '否',
      it.cap === null || it.cap === undefined ? '' : it.cap,
      it.productionQty === null || it.productionQty === undefined ? '' : it.productionQty];
  });
  var itemLast = sh.getLastRow();
  if (itemLast > 1) sh.getRange(2, NF_SETTINGS_ITEM_COL, itemLast - 1, NF_SETTINGS_ITEM_HEADERS.length).clearContent();
  if (rows.length) sh.getRange(2, NF_SETTINGS_ITEM_COL, rows.length, NF_SETTINGS_ITEM_HEADERS.length).setValues(rows);
  nfFormatSettingsMoney_(sh);
  return { items: rows.length };
}

/** 寫入「設定」A:B 的單一項目（沒有就新增在最後一個項目之後） */
function nfSetKv_(key, value) {
  nfEnsureKv_([key]);
  var rows = {};
  var sh = nfSheet_(NF.SHEET_SETTINGS);
  sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues().forEach(function (r, i) { if (r[0]) rows[String(r[0]).trim()] = i + 1; });
  sh.getRange(rows[key], 2).setValue(value);
}
