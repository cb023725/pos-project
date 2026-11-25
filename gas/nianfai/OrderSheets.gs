/**
 * 「宅配」「自取」兩張工作表（取代原本的「訂單整理」）——由 GAS 寫入，不用公式。
 *
 * 為什麼不用公式（FILTER）：公式拆表時，新訂單或取消訂單會讓後面的列整個上下移動，
 * 但手動填的付款、出貨日、託運單號不會跟著移動，就會對到別人的訂單。
 * 改成每張訂單用「訂單編號」（表單時間戳記 yyyy/MM/dd HH:mm:ss）當鑰匙：
 *   - 表單送出、WebPOS 現場單、手動修改「表單回應」後自動同步
 *   - 手動欄（付款、出貨日、託運單號、已取貨）跟著訂單編號保存，重建、排序都不會錯位
 *   - 改了取貨方式 → 自動搬到另一張表（付款狀態跟著過去）
 *   - 「表單回應」清除整列（取消訂單）→ 那一列保留、變灰、加刪除線、標「已取消」
 *   - 寄信狀態存在指令碼屬性（ML_<env>:<year>:<訂單編號>），工作表只是顯示；就算格子被改也不會重寄
 *
 * 規則：訂單內容只能從「表單回應」改（會留修改紀錄）；兩張表只開放手動欄，
 * 改到其他欄會自動還原（nfOrderSheetEdit_）。
 */
var NF_DATA_ROWS = 1000; // 每張表預留的資料列數（第 2 列起）
var NF_MAIL_TYPES = {
  preShip: { label: '寄出前確認', kind: 'delivery', statusKey: 'preShipStatus' },
  shipped: { label: '出貨通知', kind: 'delivery', statusKey: 'shippedStatus' },
  pickupReminder: { label: '取貨提醒', kind: 'pickup', statusKey: 'remindStatus' },
};

function nfOrderSheetName_(kind) {
  return kind === 'delivery' ? NF.SHEET_DELIVERY : NF.SHEET_PICKUP;
}

/**
 * 欄位定義（照閱讀順序：先看狀態與客人、再看品項金額、付款、出貨／取貨、信件；其餘收進可展開的群組）。
 * manual：開放手動填（標題橘底）；state：跟著訂單編號保存；text：純文字格式；
 * group：收進群組（點欄位上方的「+」展開）；type：formula 類（status／trackLink／sortDate）每列由 GAS 寫公式
 */
function nfOrderCols_(kind, settings) {
  var c = [];
  var add = function (key, header, o) {
    o = o || {};
    c.push({ key: key, header: header, manual: !!o.manual, state: !!(o.state || o.manual), text: !!o.text, type: o.type || '',
      width: o.width || 0, align: o.align || '', group: !!o.group, note: o.note || '', itemIdx: o.itemIdx });
  };
  var NOTE_STATUS = kind === 'delivery'
    ? '顏色：紅＝待付款｜黃＝待出貨（已付款、還沒填出貨日）｜綠＝已出貨｜灰＝已取消'
    : '顏色：紅＝待付款｜黃＝待取貨（已付款）｜綠＝已取貨｜灰＝已取消';
  var NOTE_MAIL = '只顯示最新狀態與時間。顏色：藍＝已寄出｜紫＝已開信（僅供參考）｜綠＝客人已按確認｜紅＝寄送失敗。\n沒有變綠的客人可以電話提醒。';
  add('status', '狀態', { type: 'status', width: 70, align: 'center', note: NOTE_STATUS });
  if (kind === 'pickup') add('pickupDate', '取貨日', { text: true, width: 110, align: 'center' });
  add('name', '訂購人', { width: 100 });
  add('phone', '電話', { text: true, width: 110 });
  add('summary', '品項', { width: 300 });
  add('amount', '金額', { type: 'money', width: 80, align: 'right', note: '含運費的最終金額' });
  add('last5', '末五碼', { text: true, width: 140, align: 'center', note: '匯款帳號末五碼；現場單顯示「現結＋訂購編號」（例 現結27261205001）' });
  add('paid', '付款', { manual: true, type: 'check', width: 56, align: 'center', note: '確認收到款項後打勾（現場單自動打勾）' });
  if (kind === 'delivery') {
    add('recipientName', '收件人', { width: 100 });
    add('recipientPhone', '收件電話', { text: true, width: 110 });
    add('recipientAddress', '收件地址', { width: 260 });
    add('shipDate', '出貨日', { manual: true, type: 'shipDate', text: true, width: 100, align: 'center', note: '用下拉選單選寄出日' });
    add('trackNo', '託運單號', { manual: true, text: true, width: 130, align: 'center', note: '黑貓託運單號（10 或 12 碼數字）。格式錯誤標紅、重複標橘；出貨日和託運單號都填好才能寄出貨通知' });
    add('trackLink', '查詢', { type: 'trackLink', width: 56, align: 'center', note: '點擊到黑貓查件，核對單號' });
    add('preShipStatus', '寄出前確認', { type: 'mail', width: 150, align: 'center', note: NOTE_MAIL });
    add('shippedStatus', '出貨通知', { type: 'mail', width: 150, align: 'center', note: NOTE_MAIL });
  } else {
    add('bags', '保冷袋', { width: 64, align: 'center' });
    add('picked', '已取貨', { manual: true, type: 'check', width: 64, align: 'center', note: '客人取貨時打勾，會自動記下取貨時間' });
    add('pickedAt', '取貨時間', { state: true, text: true, width: 130, align: 'center' });
    add('remindStatus', '取貨提醒', { type: 'mail', width: 150, align: 'center', note: NOTE_MAIL });
  }
  // 以下收進群組
  add('note', '備註', { width: 120, group: true, note: '現場單／已修改／已取消' });
  add('email', '訂購e-mail', { text: true, width: 200, group: true });
  add('id', '訂單編號', { text: true, width: 160, group: true, note: '表單送出的時間戳記，每張訂單唯一，請勿修改' });
  add('sortDate', kind === 'delivery' ? '備料日' : '備料日', { type: 'sortDate', width: 90, group: true, align: 'center',
    note: kind === 'delivery' ? '備料表「截至日期」用：有出貨日用出貨日，沒有就算第一個寄出日' : '備料表「截至日期」用：取貨日' });
  settings.items.forEach(function (it, i) { add('qty_' + i, it.name, { type: 'qty', width: 76, align: 'center', group: true, itemIdx: i }); });
  return c;
}

function nfColIndex_(defs, key) {
  for (var i = 0; i < defs.length; i++) if (defs[i].key === key) return i + 1;
  return 0;
}

/** 'A' 欄字母 */
function nfColL_(defs, key) {
  return nfColLetter_(nfColIndex_(defs, key));
}

/** 「宅配」「自取」整欄範圍（給統計、備料表、查詢公式用） */
function nfOrderRange_(kind, defs, key) {
  var L = nfColL_(defs, key);
  return "'" + nfOrderSheetName_(kind) + "'!$" + L + '$2:$' + L + '$' + (NF_DATA_ROWS + 1);
}

/** 讀兩張表：各列內容（取消的訂單要保留舊內容）與手動欄狀態（依訂單編號） */
function nfReadOrderSheets_(ss, settings) {
  var out = { rows: { delivery: [], pickup: [] }, state: {} };
  ['delivery', 'pickup'].forEach(function (kind) {
    var sh = ss.getSheetByName(nfOrderSheetName_(kind));
    if (!sh) return;
    var lr = sh.getLastRow(), lc = sh.getLastColumn();
    if (lr < 2 || lc < 1) return;
    var defs = nfOrderCols_(kind, settings);
    var byHeader = {};
    defs.forEach(function (d) { byHeader[d.header] = d; });
    var vals = sh.getRange(1, 1, lr, lc).getValues();
    var head = vals[0].map(function (h) { return String(h || '').trim(); });
    vals.slice(1).forEach(function (row) {
      var r = { _kind: kind };
      head.forEach(function (h, j) { var d = byHeader[h]; if (d) r[d.key] = row[j]; });
      if (!r.id) return;
      r.id = String(r.id);
      out.rows[kind].push(r);
      var st = out.state[r.id] || {};
      defs.forEach(function (d) { if (d.state && r[d.key] !== undefined) st[d.key] = r[d.key]; });
      out.state[r.id] = st;
    });
  });
  return out;
}

/** 表單回應一筆訂單 → 工作表的一列 */
function nfOrderRecord_(o, settings, id, edited) {
  var r = {
    id: id,
    name: o.name,
    phone: o.phone,
    last5: o.last5,
    email: o.email,
    summary: o.items.map(function (x) { return x.item.name + '×' + x.qty; }).join('、'),
    amount: o.total, // 含運費的最終金額
  };
  settings.items.forEach(function (it, i) {
    var x = o.items.filter(function (y) { return y.item === it; })[0];
    r['qty_' + i] = x ? x.qty : '';
  });
  if (o.isDelivery) {
    r.recipientName = o.recipientName || o.name;
    r.recipientPhone = o.recipientPhone || o.phone;
    r.recipientAddress = o.recipientAddress;
  } else {
    var iso = nfIsoDate_(o.pickupDateRaw);
    r.pickupDate = iso ? nfFormDateLabel_(iso) : String(o.pickupDateRaw || '');
    // 保冷袋＝套餐份數＋單點小計每滿免運門檻加 1 個
    var bundleQty = 0, bundleAmt = 0;
    o.items.forEach(function (x) { if (x.item.isBundle) { bundleQty += x.qty; bundleAmt += x.qty * x.item.price; } });
    r.bags = bundleQty + Math.floor((o.subtotal - bundleAmt) / (settings.freeThreshold || 3000));
  }
  var note = [];
  if (o.isOnsite) note.push('現場單');
  if (edited) note.push('已修改');
  r.note = note.join('・');
  return r;
}

function nfIsCancelled_(r) {
  return String(r.note || '').indexOf('已取消') >= 0;
}

/**
 * 依「表單回應」重寫兩張表。opts.reset：不保留舊的手動欄與取消列（正式上線／測試清空）；
 * opts.rebuild：重建版面（欄位、格式、驗證）。
 */
/** 品項清單的指紋：名稱、順序、價格、類型、套餐組成 */
function nfItemsSig_(settings) {
  return settings.items.map(function (it) { return [it.name, it.price, it.isBundle ? 'B' : 'S', it.compositionText].join('|'); }).join('\n');
}

/** 宅配／自取欄位變了（品項增減、改名、改順序）→ 統計、備料表、查詢跟著重建，保護範圍重新套用 */
function nfRebuildFormulaSheets_(settings, defs) {
  var ss = nfSpreadsheet_();
  var keep = ss.getSheetByName(NF.SHEET_LOOKUP) ? ss.getSheetByName(NF.SHEET_LOOKUP).getRange('B1').getValue() : '';
  nfBuildLookupSheet_(ss, settings, defs);
  if (keep) ss.getSheetByName(NF.SHEET_LOOKUP).getRange('B1').setValue(keep);
  nfBuildStatsSheet_(ss, settings, defs);
  nfBuildPrepSheet_(ss, settings, defs);
  try { nfApplyProtections_(); } catch (e) { console.error('保護範圍：' + e); }
}

/** 同一次執行裡只取一次鎖（巢狀呼叫直接執行），避免同步與寄信同時改同一張表 */
var NF_LOCKED = false;
function nfWithLock_(fn) {
  if (NF_LOCKED) return fn();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  NF_LOCKED = true;
  try { return fn(); } finally { NF_LOCKED = false; lock.releaseLock(); }
}

function nfSyncOrderSheets_(opts) {
  opts = opts || {};
  return nfWithLock_(function () {
    var ss = nfSpreadsheet_();
    var settings = nfReadSettings_();
    var prev = opts.reset ? { rows: { delivery: [], pickup: [] }, state: {} } : nfReadOrderSheets_(ss, settings);
    var defs = { delivery: nfOrderCols_('delivery', settings), pickup: nfOrderCols_('pickup', settings) };
    var data = nfReadResponses_();
    var cols = nfMapColumns_(data.headers, settings);
    var seen = {};
    var out = { delivery: [], pickup: [] };
    data.rows.forEach(function (row, i) {
      var o = nfParseOrder_(row, cols, settings, i + 2);
      if (!o) return;
      var id = o.timestampText, n = 2;
      while (seen[id]) id = o.timestampText + '#' + (n++);
      seen[id] = true;
      var kind = o.isDelivery ? 'delivery' : 'pickup';
      var rec = nfOrderRecord_(o, settings, id, cols.edited !== undefined && row[cols.edited] === true);
      var st = prev.state[id];
      defs[kind].forEach(function (d) {
        if (!d.state) return;
        rec[d.key] = st && st[d.key] !== undefined ? st[d.key] : (d.type === 'check' ? false : '');
      });
      if (!st && o.isOnsite) rec.paid = true; // 現場單已在 POS 付清
      out[kind].push(rec);
    });
    // 已取消：之前在表上、現在「表單回應」找不到 → 保留舊內容並標示
    ['delivery', 'pickup'].forEach(function (kind) {
      prev.rows[kind].forEach(function (r) {
        if (seen[r.id]) return;
        seen[r.id] = true;
        if (!nfIsCancelled_(r)) r.note = r.note ? '已取消・' + r.note : '已取消';
        out[kind].push(r);
      });
    });
    // 寄信狀態以指令碼屬性為準
    ['delivery', 'pickup'].forEach(function (kind) {
      out[kind].forEach(function (r) {
        var ms = nfMailState_(r.id);
        Object.keys(NF_MAIL_TYPES).forEach(function (t) {
          var T = NF_MAIL_TYPES[t];
          if (T.kind !== kind) return;
          r[T.statusKey] = nfMailStatusText_(ms[t]);
        });
      });
    });
    out.delivery.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    out.pickup.sort(function (a, b) {
      var da = nfIsoDate_(a.pickupDate), db = nfIsoDate_(b.pickupDate);
      if (da !== db) return da < db ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    nfWriteOrderSheet_(ss, 'delivery', defs.delivery, out.delivery, settings, opts.rebuild);
    nfWriteOrderSheet_(ss, 'pickup', defs.pickup, out.pickup, settings, opts.rebuild);
    // 品項清單（名稱、順序、價格、套餐組成）變了 → 統計、備料表、查詢的公式跟著重建
    var sig = nfItemsSig_(settings);
    if (NF_CTX.meta.itemsSig !== sig) {
      if (!opts.rebuild) nfRebuildFormulaSheets_(settings, defs); // 完整重建（nfBuildTabs_）時會自己建
      NF_CTX.meta.itemsSig = sig;
      nfSaveMeta_(NF_CTX.env, NF_CTX.year, NF_CTX.meta);
    }
    return { delivery: out.delivery.length, pickup: out.pickup.length };
  });
}

function nfShipDateLabels_(settings) {
  return String(settings.kv['寄出日'] || '').split(/[,，\s]+/).filter(String).map(function (iso) {
    return nfFormDateLabel_(iso).replace(/^\d{4}\//, ''); // '1/25 (一)'
  });
}

function nfWriteOrderSheet_(ss, kind, defs, rows, settings, rebuild) {
  var name = nfOrderSheetName_(kind);
  var sh = ss.getSheetByName(name);
  var headers = defs.map(function (d) { return d.header; });
  var cur = sh && sh.getLastColumn() ? sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), headers.length)).getValues()[0].map(String) : [];
  if (!sh || rebuild || cur.slice(0, headers.length).join('|') !== headers.join('|') || cur.slice(headers.length).some(String)) {
    sh = nfSetupOrderSheet_(ss, kind, defs, settings);
  }
  var ncol = defs.length;
  sh.getRange(2, 1, NF_DATA_ROWS, ncol).clearContent();
  defs.forEach(function (d, j) {
    if (d.type === 'check' || d.type === 'shipDate') sh.getRange(2, j + 1, NF_DATA_ROWS, 1).setDataValidation(null);
  });
  if (!rows.length) return sh;
  var L = function (key, i) { return '$' + nfColL_(defs, key) + (i + 2); };
  var firstShip = String(settings.kv['寄出日'] || '').split(/[,，\s]+/).filter(String)[0] || '';
  var yr = Number(settings.year) || new Date().getFullYear();
  var values = rows.map(function (r, i) {
    return defs.map(function (d) {
      if (d.type === 'trackLink') {
        var c = L('trackNo', i);
        return '=IF(' + c + '="","",HYPERLINK("https://www.t-cat.com.tw/inquire/trace.aspx?no="&REGEXREPLACE(TO_TEXT(' + c + '),"[^0-9]",""),"查詢"))';
      }
      if (d.type === 'status') {
        var cancel = 'ISNUMBER(SEARCH("已取消",' + L('note', i) + '))';
        return kind === 'delivery'
          ? '=IF(' + cancel + ',"已取消",IF(' + L('paid', i) + '<>TRUE,"待付款",IF(' + L('shipDate', i) + '="","待出貨","已出貨")))'
          : '=IF(' + cancel + ',"已取消",IF(' + L('picked', i) + '=TRUE,"已取貨",IF(' + L('paid', i) + '<>TRUE,"待付款","待取貨")))';
      }
      if (d.type === 'sortDate') {
        if (kind === 'pickup') {
          var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nfIsoDate_(r.pickupDate));
          return m ? '=DATE(' + (+m[1]) + ',' + (+m[2]) + ',' + (+m[3]) + ')' : '';
        }
        var fm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(firstShip);
        var dflt = fm ? 'DATE(' + (+fm[1]) + ',' + (+fm[2]) + ',' + (+fm[3]) + ')' : '""';
        var sd = L('shipDate', i);
        return '=IF(' + sd + '="",' + dflt + ',IFERROR(DATE(' + yr + ',VALUE(REGEXEXTRACT(' + sd + ',"^(\\d+)/")),VALUE(REGEXEXTRACT(' + sd + ',"/(\\d+)"))),' + dflt + '))';
      }
      var v = r[d.key];
      if (d.type === 'check') return v === true || String(v).toUpperCase() === 'TRUE';
      if (v === undefined || v === null) return '';
      return d.text ? String(v) : v;
    });
  });
  sh.getRange(2, 1, rows.length, ncol).setValues(values);
  var checkRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  var shipLabels = nfShipDateLabels_(settings);
  defs.forEach(function (d, j) {
    if (d.type === 'check') sh.getRange(2, j + 1, rows.length, 1).setDataValidation(checkRule);
    if (d.type === 'shipDate' && shipLabels.length) {
      sh.getRange(2, j + 1, rows.length, 1).setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInList(shipLabels, true).setAllowInvalid(false).setHelpText('請選擇寄出日').build());
    }
  });
  return sh;
}

/** 建立（或清空重建）一張表的版面：標題、字體、欄寬列高、對齊、群組、狀態顏色 */
function nfSetupOrderSheet_(ss, kind, defs, settings) {
  var sh = nfGetOrCreateSheet_(ss, nfOrderSheetName_(kind));
  if (sh.getMaxRows() < NF_DATA_ROWS + 1) sh.insertRowsAfter(sh.getMaxRows(), NF_DATA_ROWS + 1 - sh.getMaxRows());
  if (sh.getMaxColumns() < defs.length) sh.insertColumnsAfter(sh.getMaxColumns(), defs.length - sh.getMaxColumns());
  if (sh.getMaxColumns() > defs.length) sh.deleteColumns(defs.length + 1, sh.getMaxColumns() - defs.length);
  var ncol = defs.length;
  var data = sh.getRange(2, 1, NF_DATA_ROWS, ncol);
  // 清掉舊版面留下的格式（例如舊的純文字欄會讓勾選框變成 true/false 文字）
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearFormat();
  // 全表：字大一點、垂直置中、不換行（列高一致）
  sh.getRange(1, 1, NF_DATA_ROWS + 1, ncol).setFontSize(11).setVerticalAlignment('middle')
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP).setFontFamily('Arial');
  sh.setRowHeight(1, 40);
  sh.setRowHeights(2, NF_DATA_ROWS, 30);
  // 標題列：深灰底白字；可以填的欄（手動欄）橘底
  var head = sh.getRange(1, 1, 1, ncol);
  head.setValues([defs.map(function (d) { return d.header; })]).setFontWeight('bold').setFontColor('#ffffff')
    .setBackground('#374151').setHorizontalAlignment('center');
  defs.forEach(function (d, j) {
    var col = j + 1;
    if (d.manual) sh.getRange(1, col).setBackground('#f59e0b').setFontColor('#1f2937');
    if (d.group) sh.getRange(1, col).setBackground('#6b7280');
    if (d.note) sh.getRange(1, col).setNote(d.note + (d.manual ? '\n（這一欄可以填寫）' : ''));
    // 每一欄都明確設定格式（清除分頁不會重設數字格式，舊版面的純文字格式會讓勾選框變成 true/false 文字）
    sh.getRange(2, col, NF_DATA_ROWS, 1).setNumberFormat(
      d.text ? '@' : d.type === 'money' ? '#,##0' : d.type === 'sortDate' ? 'm/d' : 'General');
    if (d.align) sh.getRange(2, col, NF_DATA_ROWS, 1).setHorizontalAlignment(d.align);
    if (d.width) sh.setColumnWidth(col, d.width);
    if (d.type === 'status' || d.type === 'mail') sh.getRange(2, col, NF_DATA_ROWS, 1).setFontWeight('bold');
  });
  sh.setFrozenRows(1);
  sh.setFrozenColumns(kind === 'delivery' ? 2 : 3); // 狀態＋（取貨日）＋訂購人
  // 其他欄位收進群組（預設收合）
  var g0 = 0;
  defs.forEach(function (d, j) { if (d.group && !g0) g0 = j + 1; });
  if (g0) {
    try {
      sh.getRange(1, g0, 1, ncol - g0 + 1).shiftColumnGroupDepth(1);
      sh.getColumnGroup(g0, 1).collapse();
    } catch (e) { /* 群組失敗不影響資料 */ }
  }
  var L = function (key) { return '$' + nfColL_(defs, key) + '2'; };
  var colRange = function (key) { return sh.getRange(2, nfColIndex_(defs, key), NF_DATA_ROWS, 1); };
  var rule = function () { return SpreadsheetApp.newConditionalFormatRule(); };
  var rules = [
    // 已取消：整列灰、刪除線
    rule().whenFormulaSatisfied('=ISNUMBER(SEARCH("已取消",' + L('note') + '))')
      .setBackground('#f3f4f6').setFontColor('#9ca3af').setStrikethrough(true).setRanges([data]).build(),
  ];
  // 狀態欄
  [['待付款', '#fee2e2', '#b91c1c'], ['待出貨', '#fef3c7', '#92400e'], ['待取貨', '#fef3c7', '#92400e'],
    ['已出貨', '#dcfce7', '#166534'], ['已取貨', '#dcfce7', '#166534']].forEach(function (x) {
    rules.push(rule().whenTextEqualTo(x[0]).setBackground(x[1]).setFontColor(x[2]).setRanges([colRange('status')]).build());
  });
  // 付款沒勾：付款格淡紅
  rules.push(rule().whenFormulaSatisfied('=AND(' + L('id') + '<>"",' + L('paid') + '<>TRUE,NOT(ISNUMBER(SEARCH("已取消",' + L('note') + '))))')
    .setBackground('#fee2e2').setRanges([colRange('paid')]).build());
  // 託運單號：格式不對（不是 10 或 12 碼數字）標紅、和別筆重複標橘
  if (kind === 'delivery') {
    var T = '$' + nfColL_(defs, 'trackNo');
    rules.unshift(
      rule().whenFormulaSatisfied('=AND(' + T + '2<>"",NOT(REGEXMATCH(REGEXREPLACE(TO_TEXT(' + T + '2),"[\\s-]",""),"^([0-9]{10}|[0-9]{12})$")))')
        .setBackground('#fecaca').setFontColor('#b91c1c').setBold(true).setRanges([colRange('trackNo')]).build(),
      rule().whenFormulaSatisfied('=AND(' + T + '2<>"",COUNTIF(' + T + '$2:' + T + '$' + (NF_DATA_ROWS + 1) + ',' + T + '2)>1)')
        .setBackground('#fed7aa').setRanges([colRange('trackNo')]).build());
  }
  // 信件狀態：網底顏色區分
  defs.forEach(function (d) {
    if (d.type !== 'mail') return;
    [['客人已確認', '#dcfce7', '#166534'], ['已開信', '#ede9fe', '#5b21b6'], ['已寄出', '#dbeafe', '#1e40af'], ['失敗', '#fee2e2', '#b91c1c']]
      .forEach(function (x) { rules.push(rule().whenTextStartsWith(x[0]).setBackground(x[1]).setFontColor(x[2]).setRanges([colRange(d.key)]).build()); });
  });
  sh.setConditionalFormatRules(rules);
  return sh;
}

/**
 * 「宅配」「自取」被手動編輯：
 *   - 手動欄照常可以改；「已取貨」打勾自動記下取貨時間（取消勾選就清掉）
 *   - 改到其他欄 → 還原（單格用原值，多格重新同步），跳提示請到「表單回應」修改
 */
function nfOrderSheetEdit_(e, kind) {
  var sh = e.range.getSheet();
  var settings = nfReadSettings_();
  var defs = nfOrderCols_(kind, settings);
  var r0 = e.range.getRow(), c0 = e.range.getColumn();
  var nr = e.range.getNumRows(), nc = e.range.getNumColumns();
  if (r0 === 1) { // 標題列
    sh.getRange(1, 1, 1, defs.length).setValues([defs.map(function (d) { return d.header; })]);
    if (nr === 1) { nfToast_(e, '標題列不能修改，已還原。'); return; }
  }
  var bad = false;
  for (var c = c0; c < c0 + nc; c++) {
    var d = defs[c - 1];
    if (d && d.manual) {
      if (d.key === 'trackNo' && r0 > 1) {
        var probs = [];
        var rowsNow = nfReadOrderSheets_(nfSpreadsheet_(), settings).rows.delivery;
        for (var tr2 = r0; tr2 < r0 + nr; tr2++) {
          var me = rowsNow[tr2 - 2];
          if (!me || !me.trackNo) continue;
          var p = nfTrackNoProblem_(me, rowsNow);
          if (p) probs.push(me.name + '：' + p);
        }
        if (probs.length) nfToast_(e, probs.join('\n') + '\n（有問題的單號不會寄出貨通知）');
      }
      if (d.key === 'picked') {
        var atCol = nfColIndex_(defs, 'pickedAt');
        for (var r = Math.max(r0, 2); r < r0 + nr; r++) {
          if (!sh.getRange(r, nfColIndex_(defs, 'id')).getValue()) continue;
          var on = sh.getRange(r, c).getValue() === true;
          var at = sh.getRange(r, atCol);
          if (on && !at.getValue()) at.setValue(nfFormatTimestamp_(new Date()));
          if (!on) at.clearContent();
        }
      }
      continue;
    }
    bad = true;
  }
  if (!bad) return;
  if (nr === 1 && nc === 1 && r0 > 1) {
    if (e.oldValue === undefined) e.range.clearContent(); else e.range.setValue(e.oldValue);
  } else {
    nfSyncOrderSheets_();
  }
  nfToast_(e, '這一欄由「表單回應」自動產生，已還原。訂單內容請到「表單回應」修改（會留下修改紀錄）。');
}

function nfToast_(e, msg) {
  try { e.source.toast(msg, '年菜', 8); } catch (err) { /* 沒有畫面時略過 */ }
}

/** 託運單號檢查：格式（10 或 12 碼數字，黑貓沒有公開檢查碼）、和其他訂單重複。沒問題回傳 '' */
function nfNormTrackNo_(v) {
  return String(v || '').replace(/[\s-]/g, '');
}
function nfTrackNoProblem_(row, allRows) {
  var no = nfNormTrackNo_(row.trackNo);
  if (!no) return '缺託運單號';
  if (!/^(\d{10}|\d{12})$/.test(no)) return '託運單號格式不對（應為 10 或 12 碼數字，目前 ' + no.length + ' 碼）';
  var dup = (allRows || []).filter(function (r) { return r.id !== row.id && !nfIsCancelled_(r) && nfNormTrackNo_(r.trackNo) === no; });
  if (dup.length) return '託運單號和「' + dup.map(function (r) { return r.name; }).join('、') + '」重複';
  return '';
}

/** 工作表顯示用（只顯示最新狀態與時間）：客人已確認 ＞ 已開信 ＞ 已寄出 ／ 失敗 */
function nfMailStatusText_(ms) {
  if (!ms) return '';
  var t = function (v) { return String(v || '').slice(5, 16); }; // MM/dd HH:mm
  if (ms.ackAt) return '客人已確認 ' + t(ms.ackAt) + (ms.ackFast ? '（1 分鐘內，可能是信箱自動檢查）' : '');
  if (ms.openedAt) return '已開信 ' + t(ms.openedAt);
  if (ms.status === '已寄出') return '已寄出 ' + t(ms.at);
  return '失敗 ' + t(ms.at) + ' ' + String(ms.status || '').replace(/^失敗：/, '');
}

// ── 寄信狀態（指令碼屬性，一張訂單一筆）──
function nfMailKey_(id) {
  return 'ML_' + NF_CTX.env + ':' + NF_CTX.year + ':' + id;
}

function nfMailState_(id) {
  var raw = nfProps_().getProperty(nfMailKey_(id));
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}

function nfSetMailState_(id, type, status) {
  var st = nfMailState_(id);
  st[type] = { status: status, at: nfFormatTimestamp_(new Date()) }; // 重寄會清掉舊的開信時間
  nfProps_().setProperty(nfMailKey_(id), JSON.stringify(st));
  return st[type];
}

function nfClearMailStates_() {
  var prefix = 'ML_' + NF_CTX.env + ':' + NF_CTX.year + ':';
  var props = nfProps_();
  Object.keys(props.getProperties()).forEach(function (k) { if (k.indexOf(prefix) === 0) props.deleteProperty(k); });
}
