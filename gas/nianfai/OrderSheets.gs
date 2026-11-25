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
  preShip: { label: '寄出前確認', kind: 'delivery', statusKey: 'preShipStatus', atKey: 'preShipAt' },
  shipped: { label: '出貨通知', kind: 'delivery', statusKey: 'shippedStatus', atKey: 'shippedAt' },
  pickupReminder: { label: '取貨提醒', kind: 'pickup', statusKey: 'remindStatus', atKey: 'remindAt' },
};

function nfOrderSheetName_(kind) {
  return kind === 'delivery' ? NF.SHEET_DELIVERY : NF.SHEET_PICKUP;
}

/**
 * 欄位定義。manual：開放手動填；state：跟著訂單編號保存（重寫時帶回）；text：純文字格式（避免 0 開頭電話、
 * 編號被 Sheets 轉成數字或日期）；mail：寄信狀態（以指令碼屬性為準）
 */
function nfOrderCols_(kind, settings) {
  var c = [];
  var add = function (key, header, o) {
    o = o || {};
    c.push({ key: key, header: header, manual: !!o.manual, state: !!(o.state || o.manual), text: !!o.text, type: o.type || '', width: o.width || 0, itemIdx: o.itemIdx });
  };
  add('id', '訂單編號', { text: true, width: 150 });
  add('paid', '付款', { manual: true, type: 'check', width: 44 });
  if (kind === 'pickup') {
    add('picked', '已取貨', { manual: true, type: 'check', width: 52 });
    add('pickedAt', '取貨時間', { state: true, text: true, width: 140 });
    add('pickupDate', '取貨日', { text: true, width: 110 });
  }
  add('name', '訂購姓名', { width: 90 });
  add('phone', '電話', { text: true, width: 105 });
  add('last5', '末五碼', { text: true, width: 90 });
  add('summary', '品項', { width: 260 });
  add('amount', '金額', { type: 'money', width: 70 });
  if (kind === 'delivery') {
    add('recipientName', '收件姓名', { width: 90 });
    add('recipientPhone', '收件電話', { text: true, width: 105 });
    add('recipientAddress', '收件地址', { width: 220 });
    add('shipDate', '出貨日', { manual: true, type: 'shipDate', text: true, width: 100 });
    add('trackNo', '託運單號', { manual: true, text: true, width: 120 });
    add('trackLink', '查詢', { type: 'trackLink', width: 50 }); // 點擊到黑貓查件
    add('preShipStatus', '寄出前確認', { type: 'mail', width: 90 });
    add('preShipAt', '寄出前確認時間', { type: 'mail', text: true, width: 140 });
    add('shippedStatus', '出貨通知', { type: 'mail', width: 90 });
    add('shippedAt', '出貨通知時間', { type: 'mail', text: true, width: 140 });
  } else {
    add('bags', '保冷袋', { width: 52 });
    add('remindStatus', '取貨提醒', { type: 'mail', width: 90 });
    add('remindAt', '取貨提醒時間', { type: 'mail', text: true, width: 140 });
  }
  add('note', '狀態', { width: 110 });
  add('email', '訂購e-mail', { text: true, width: 180 });
  settings.items.forEach(function (it, i) { add('qty_' + i, it.name, { type: 'qty', width: 64, itemIdx: i }); });
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
          r[T.atKey] = ms[t] ? ms[t].at : '';
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
  var trackCol = nfColL_(defs, 'trackNo');
  var values = rows.map(function (r, i) {
    return defs.map(function (d) {
      if (d.type === 'trackLink') {
        var c = '$' + trackCol + (i + 2);
        return '=IF(' + c + '="","",HYPERLINK("https://www.t-cat.com.tw/inquire/trace.aspx?no="&REGEXREPLACE(TO_TEXT(' + c + '),"[^0-9]",""),"查詢"))';
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

/** 建立（或清空重建）一張表的版面：標題、格式、欄寬、品項欄收合、顏色規則 */
function nfSetupOrderSheet_(ss, kind, defs, settings) {
  var sh = nfGetOrCreateSheet_(ss, nfOrderSheetName_(kind));
  if (sh.getMaxRows() < NF_DATA_ROWS + 1) sh.insertRowsAfter(sh.getMaxRows(), NF_DATA_ROWS + 1 - sh.getMaxRows());
  if (sh.getMaxColumns() < defs.length) sh.insertColumnsAfter(sh.getMaxColumns(), defs.length - sh.getMaxColumns());
  var ncol = defs.length;
  sh.getRange(1, 1, 1, ncol).setValues([defs.map(function (d) { return d.header; })])
    .setFontWeight('bold').setBackground('#f3f4f6').setVerticalAlignment('middle');
  defs.forEach(function (d, j) {
    var col = j + 1;
    if (d.manual) sh.getRange(1, col).setBackground('#fef3c7'); // 手動欄標題黃底
    if (d.text) sh.getRange(2, col, NF_DATA_ROWS, 1).setNumberFormat('@');
    if (d.type === 'money') sh.getRange(2, col, NF_DATA_ROWS, 1).setNumberFormat('#,##0');
    if (d.width) sh.setColumnWidth(col, d.width);
  });
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);
  // 各品項數量收合成一組（點欄位上方的「+」展開）
  var q0 = nfColIndex_(defs, 'qty_0');
  if (q0) {
    try {
      sh.getRange(1, q0, 1, settings.items.length).shiftColumnGroupDepth(1);
      sh.getColumnGroup(q0, 1).collapse();
    } catch (e) { /* 群組失敗不影響資料 */ }
  }
  var all = sh.getRange(2, 1, NF_DATA_ROWS, ncol);
  var L = function (key) { return '$' + nfColL_(defs, key) + '2'; };
  var cancelled = 'ISNUMBER(SEARCH("已取消",' + L('note') + '))';
  var rules = [
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=' + cancelled)
      .setBackground('#eeeeee').setFontColor('#9ca3af').setStrikethrough(true).setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(' + L('id') + '<>"",' + L('paid') + '=FALSE,NOT(' + cancelled + '))')
      .setBackground('#fde2e2').setRanges([sh.getRange(2, nfColIndex_(defs, 'paid'), NF_DATA_ROWS, 1)]).build(),
  ];
  var done = kind === 'delivery' ? L('shipDate') + '<>""' : L('picked') + '=TRUE';
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(' + L('id') + '<>"",' + done + ')')
    .setBackground('#e8f5e9').setRanges([all]).build());
  // 託運單號：格式不對（不是 10 或 12 碼數字）標紅底、和別筆重複標橘底
  if (kind === 'delivery') {
    var T = '$' + nfColL_(defs, 'trackNo');
    var tr = sh.getRange(2, nfColIndex_(defs, 'trackNo'), NF_DATA_ROWS, 1);
    rules.unshift(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND(' + T + '2<>"",NOT(REGEXMATCH(REGEXREPLACE(TO_TEXT(' + T + '2),"[\\s-]",""),"^([0-9]{10}|[0-9]{12})$")))')
        .setBackground('#fecaca').setFontColor('#b91c1c').setBold(true).setRanges([tr]).build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND(' + T + '2<>"",COUNTIF(' + T + '$2:' + T + '$' + (NF_DATA_ROWS + 1) + ',' + T + '2)>1)')
        .setBackground('#fed7aa').setRanges([tr]).build());
  }
  // 寄信失敗標紅字
  defs.forEach(function (d, j) {
    if (d.type === 'mail' && /Status$/.test(d.key)) {
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith('失敗').setFontColor('#dc2626').setBold(true)
        .setRanges([sh.getRange(2, j + 1, NF_DATA_ROWS, 1)]).build());
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith('已開信').setFontColor('#1d4ed8').setBold(true)
        .setRanges([sh.getRange(2, j + 1, NF_DATA_ROWS, 1)]).build());
    }
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
          if (!sh.getRange(r, 1).getValue()) continue;
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

/** 工作表顯示用：已開信 MM/dd HH:mm ＞ 已寄出 ／ 失敗：原因 */
function nfMailStatusText_(ms) {
  if (!ms) return '';
  if (ms.openedAt) return '已開信 ' + String(ms.openedAt).slice(5, 16);
  return ms.status;
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
