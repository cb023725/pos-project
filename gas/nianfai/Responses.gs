/**
 * 「表單回應」讀取：一律依題目名稱找欄位，不用欄位編號（表單調整題目順序也不會讀錯）。
 *
 * 品項欄位標題的樣子：
 *   套餐（下拉）：「富貴套餐 (3500元)」
 *   單點（表格）：「單點年菜 [鮑魚人蔘雞湯 (1380元)]」、「單點年菜 [*紅燒牛腩筋 (380元)]」
 * 取出括號前的品名（去掉前面的 *），與「設定」的品名完全比對。同一品名有多欄（例如改過價格
 * 產生新欄）時加總。清空的列（取消的訂單）時間戳記是空的，一律略過。
 */
function nfParseItemTitle_(title) {
  var t = String(title || '').trim();
  var m = /^[^\[]*\[(.*)\]\s*$/.exec(t); // 「單點年菜 [xxx]」
  if (m) t = m[1];
  t = t.replace(/^\*+/, '').replace(/\s*[（(]\s*[\d,]+\s*元\s*[)）]\s*$/, '');
  return t.trim();
}

function nfMapColumns_(headers, settings) {
  var cols = { items: [] };
  headers.forEach(function (h, i) {
    var t = String(h || '').trim();
    if (!t) return;
    if (i === 0) { cols.timestamp = i; return; }
    if (t === NF.STATUS_HEADER) { cols.status = i; return; }
    var itemName = nfParseItemTitle_(t);
    if (settings.byName[itemName]) { cols.items.push({ col: i, item: settings.byName[itemName] }); return; }
    if (t.indexOf('取貨方式') >= 0) cols.method = i;
    else if (t.indexOf('訂購人') >= 0 && t.indexOf('姓名') >= 0) cols.name = i;
    else if (t.indexOf('訂購人') >= 0 && t.indexOf('電話') >= 0) cols.phone = i;
    else if (/e-?mail|電子郵件/i.test(t)) cols.email = i;
    else if (t.indexOf('收件人') >= 0 && t.indexOf('電話') >= 0) cols.recipientPhone = i;
    else if (t.indexOf('收件地址') >= 0) cols.recipientAddress = i;
    else if (t.indexOf('收件人') === 0) cols.recipientName = i;
    else if (t.indexOf('取貨日') >= 0) cols.pickupDate = i;
    else if (t.indexOf('末五碼') >= 0) cols.last5 = i;
  });
  return cols;
}

function nfReadResponses_() {
  var sh = nfSheet_(NF.SHEET_RESPONSES);
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  var values = lastRow > 0 ? sh.getRange(1, 1, lastRow, lastCol).getValues() : [[]];
  return { sheet: sh, headers: values[0], rows: values.slice(1) };
}

function nfCell_(row, idx) {
  return idx === undefined ? '' : row[idx];
}

/** 一列 → 訂單物件；空白列（取消）回傳 null */
function nfParseOrder_(row, cols, settings, rowNumber) {
  var ts = nfCell_(row, cols.timestamp);
  if (!ts) return null;
  var qtyById = {};
  cols.items.forEach(function (c) {
    var q = parseInt(row[c.col], 10);
    if (q > 0) qtyById[c.item.name] = (qtyById[c.item.name] || 0) + q;
  });
  var items = [];
  settings.items.forEach(function (it) {
    if (qtyById[it.name]) items.push({ item: it, qty: qtyById[it.name] });
  });
  var subtotal = items.reduce(function (s, x) { return s + x.item.price * x.qty; }, 0);
  var method = String(nfCell_(row, cols.method) || '');
  var isDelivery = method.indexOf('宅配') >= 0;
  var shipping = isDelivery && subtotal > 0 && subtotal < settings.freeThreshold ? settings.shippingFee : 0;
  var last5 = String(nfCell_(row, cols.last5) || '').trim();
  var isOnsite = last5.indexOf(NF.ONSITE_PREFIX) === 0;
  return {
    rowNumber: rowNumber,
    timestamp: ts,
    timestampText: nfFormatTimestamp_(ts),
    name: String(nfCell_(row, cols.name) || ''),
    phone: String(nfCell_(row, cols.phone) || ''),
    email: String(nfCell_(row, cols.email) || '').trim(),
    method: method,
    isDelivery: isDelivery,
    pickupDateRaw: nfCell_(row, cols.pickupDate),
    recipientName: String(nfCell_(row, cols.recipientName) || ''),
    recipientPhone: String(nfCell_(row, cols.recipientPhone) || ''),
    recipientAddress: String(nfCell_(row, cols.recipientAddress) || ''),
    last5: last5,
    isOnsite: isOnsite,
    seqLabel: isOnsite ? last5.slice(NF.ONSITE_PREFIX.length).trim() : '',
    items: items,
    subtotal: subtotal,
    shipping: shipping,
    total: subtotal + shipping,
  };
}

/** 確保「寄信狀態」欄存在（表單回應最右側），回傳欄號（1-based） */
function nfEnsureStatusColumn_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = headers.indexOf(NF.STATUS_HEADER);
  if (idx >= 0) return idx + 1;
  sheet.getRange(1, lastCol + 1).setValue(NF.STATUS_HEADER).setFontWeight('bold');
  return lastCol + 1;
}
