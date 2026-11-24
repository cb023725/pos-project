/**
 * 建立「訂單整理」「供需庫存」「備料表」「修改紀錄」分頁（handoff 第 6 節，取代 2026 年的
 * 訂單整理金額／供需庫存／樞紐分析表／製作）。
 *
 * - 全部直接讀同一個檔案的「表單回應」，不用 IMPORTRANGE；明年由系統重新建立，不用複製
 * - 金額用公式，價格與運費讀「設定」（價格只存一個地方），改了數量所有統計立即更新
 * - 取消的訂單是「清除內容、不刪列」，時間戳記空白的列一律不計入
 * - 手動欄（已收、已取貨、出貨日、託運單號）放在「訂單整理」右側，旁邊再顯示一次時間戳記，
 *   列位移時一眼就看得出來
 */
var NF_DATA_ROWS = 1000; // 預留的資料列數（表單回應第 2 列起）

function nfBuildTabs_(settings) {
  var ss = nfSpreadsheet_();
  var resp = nfSheet_(NF.SHEET_RESPONSES);
  var headers = resp.getRange(1, 1, 1, resp.getLastColumn()).getValues()[0];
  var cols = nfMapColumns_(headers, settings);
  var layout = nfBuildOrdersSheet_(ss, settings, cols, headers);
  nfBuildStockSheet_(ss, settings, layout);
  nfBuildPrepSheet_(ss, settings, layout);
  nfBuildLogSheet_(ss);
}

function nfGetOrCreateSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (sh) sh.clear(); else sh = ss.insertSheet(name);
  return sh;
}

function nfBuildOrdersSheet_(ss, s, cols, respHeaders) {
  var sh = nfGetOrCreateSheet_(ss, NF.SHEET_ORDERS);
  var R = "'" + NF.SHEET_RESPONSES + "'!";
  var S = "'" + NF.SHEET_SETTINGS + "'!";
  var last = NF_DATA_ROWS + 1;
  var src = function (idx) { // 表單回應欄位（0-based）→ 第 2 列起的範圍
    var L = nfColLetter_(idx + 1);
    return R + L + '2:' + L + last;
  };
  var kvRow = nfSettingsKvRows_();
  var cell = function (key) { return S + '$B$' + kvRow[key]; };

  var out = []; // { header, formula }
  var colOf = {}; // 名稱 → 欄位字母
  var push = function (key, header, formula) {
    out.push({ header: header, formula: formula });
    colOf[key] = nfColLetter_(out.length);
  };
  var A = function () { return '$A2:$A' + last; };
  var rng = function (key) { return colOf[key] + '2:' + colOf[key] + last; };
  var blankOr = function (expr) { return '=ARRAYFORMULA(IF(' + A() + '="",,' + expr + '))'; };

  push('ts', '時間戳記', '=ARRAYFORMULA(IF(' + src(0) + '="",,' + src(0) + '))');
  push('source', '來源', cols.last5 !== undefined ? blankOr('IF(LEFT(' + src(cols.last5) + ',2)="' + NF.ONSITE_PREFIX + '","現場","線上")') : '');
  var textCols = [['last5', '匯款末五碼'], ['name', '訂購人'], ['phone', '訂購電話'], ['email', '訂購 e-mail'], ['method', '取貨方式'],
    ['pickupDate', '取貨日'], ['recipientName', '收件人'], ['recipientPhone', '收件電話'], ['recipientAddress', '收件地址']];
  textCols.forEach(function (tc) {
    push(tc[0], tc[1], cols[tc[0]] !== undefined ? blankOr(src(cols[tc[0]]) + '&""') : '');
  });

  // 各品項數量（依「設定」順序；同品名多欄加總）
  s.items.forEach(function (it, i) {
    var srcCols = cols.items.filter(function (c) { return c.item.name === it.name; }).map(function (c) { return 'IFERROR(VALUE(' + src(c.col) + '),0)'; });
    push('qty_' + i, it.name + (it.isBundle ? '（套餐）' : ''), srcCols.length ? blankOr(srcCols.join('+')) : blankOr('0'));
  });
  var priceCell = function (i) { return S + '$' + nfColLetter_(NF_SETTINGS_ITEM_COL + 2) + '$' + (i + 2); };
  var subtotalExpr = s.items.map(function (it, i) { return rng('qty_' + i) + '*' + priceCell(i); }).join('+');
  push('subtotal', '小計', blankOr(subtotalExpr || '0'));
  var bundleIdx = [];
  s.items.forEach(function (it, i) { if (it.isBundle) bundleIdx.push(i); });
  var bundleQtyExpr = bundleIdx.length ? bundleIdx.map(function (i) { return rng('qty_' + i); }).join('+') : '0';
  var bundleAmtExpr = bundleIdx.length ? bundleIdx.map(function (i) { return rng('qty_' + i) + '*' + priceCell(i); }).join('+') : '0';
  push('singleSubtotal', '單點小計', blankOr(rng('subtotal') + '-(' + bundleAmtExpr + ')'));
  push('shipping', '運費', blankOr('IF((' + rng('method') + '="宅配")*(' + rng('subtotal') + '>0)*(' + rng('subtotal') + '<' + cell('免運門檻') + '),' + cell('運費') + ',0)'));
  push('total', '總額', blankOr(rng('subtotal') + '+' + rng('shipping')));
  // 保冷袋（只算自取）＝套餐份數＋單點小計每滿 3,000 元加 1 個
  push('bags', '保冷袋', blankOr('IF(' + rng('method') + '="來店自取",(' + bundleQtyExpr + ')+INT(' + rng('singleSubtotal') + '/' + cell('免運門檻') + '),0)'));
  push('edited', '已修改', cols.edited !== undefined ? blankOr('IF(' + src(cols.edited) + '=TRUE,TRUE,FALSE)')
    : blankOr('FALSE'));

  // 各單品含套餐的總數（套餐依「設定」組成拆開），給供需庫存與備料表用
  var singles = [];
  s.items.forEach(function (it, i) {
    if (it.isBundle) return;
    var parts = [rng('qty_' + i)];
    s.items.forEach(function (b, bi) {
      if (!b.isBundle) return;
      b.composition.forEach(function (c) { if (c.item.name === it.name) parts.push(rng('qty_' + bi) + '*' + c.qty); });
    });
    push('pack_' + i, it.name + '（含套餐）', blankOr(parts.join('+')));
    singles.push({ item: it, key: 'pack_' + i });
  });

  // 手動欄
  push('paid', '已收', '');
  push('picked', '已取貨', '');
  push('shipDate', '出貨日', '');
  push('trackNo', '託運單號', '');
  push('tsRef', '時間戳記（對照）', '=ARRAYFORMULA(IF(' + A() + '="",,' + A() + '))');

  // 寫入
  sh.getRange(1, 1, 1, out.length).setValues([out.map(function (o) { return o.header; })]).setFontWeight('bold').setBackground('#f3f4f6');
  out.forEach(function (o, i) { if (o.formula) sh.getRange(2, i + 1).setFormula(o.formula); });
  sh.setFrozenRows(1);
  sh.setFrozenColumns(4);
  sh.getRange(colOf.ts + '2:' + colOf.ts + last).setNumberFormat('yyyy/mm/dd hh:mm:ss');
  sh.getRange(colOf.tsRef + '2:' + colOf.tsRef + last).setNumberFormat('yyyy/mm/dd hh:mm:ss');
  ['subtotal', 'singleSubtotal', 'shipping', 'total'].forEach(function (k) { sh.getRange(rng(k)).setNumberFormat('#,##0'); });
  sh.getRange(rng('paid')).insertCheckboxes();
  sh.getRange(rng('picked')).insertCheckboxes();
  sh.getRange(rng('shipDate')).setNumberFormat('yyyy/mm/dd');
  sh.getRange(1, nfColNumber_(colOf.paid), 1, 5).setBackground('#fef3c7'); // 手動欄標題黃色

  // 已修改的訂單整列淺色標示
  var editedRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$' + colOf.edited + '2=TRUE')
    .setBackground('#fff7e6')
    .setRanges([sh.getRange(2, 1, NF_DATA_ROWS, out.length)])
    .build();
  sh.setConditionalFormatRules([editedRule]);

  return { colOf: colOf, singles: singles, bundleIdx: bundleIdx, last: last };
}

function nfColNumber_(letter) {
  var n = 0;
  for (var i = 0; i < letter.length; i++) n = n * 26 + (letter.charCodeAt(i) - 64);
  return n;
}

function nfSettingsKvRows_() {
  var sh = nfSheet_(NF.SHEET_SETTINGS);
  var rows = {};
  sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues().forEach(function (r, i) {
    if (r[0]) rows[String(r[0]).trim()] = i + 1;
  });
  return rows;
}

function nfBuildStockSheet_(ss, s, L) {
  var sh = nfGetOrCreateSheet_(ss, NF.SHEET_STOCK);
  var O = "'" + NF.SHEET_ORDERS + "'!";
  var r = function (key) { return O + L.colOf[key] + '2:' + L.colOf[key] + L.last; };
  var rows = [['品項', '年菜總訂購量', '宅配', '來店自取', '已出貨／已取貨', '未出貨／未取貨', '現場單', '線上單']];
  L.singles.forEach(function (x) {
    var q = r(x.key);
    rows.push([
      x.item.name,
      '=SUM(' + q + ')',
      '=SUMIF(' + r('method') + ',"宅配",' + q + ')',
      '=SUMIF(' + r('method') + ',"來店自取",' + q + ')',
      '=SUMPRODUCT(' + q + ',--(((' + r('picked') + '=TRUE)+(' + r('shipDate') + '<>""))>0))',
      '=B{row}-E{row}',
      '=SUMIF(' + r('source') + ',"現場",' + q + ')',
      '=SUMIF(' + r('source') + ',"線上",' + q + ')',
    ]);
  });
  rows = rows.map(function (row, i) { return row.map(function (v) { return typeof v === 'string' ? v.replace(/\{row\}/g, i + 1) : v; }); });
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sh.getRange(1, 1, 1, rows[0].length).setFontWeight('bold').setBackground('#f3f4f6');

  var start = rows.length + 2;
  var bundleQty = L.bundleIdx.length ? L.bundleIdx.map(function (i) { return 'SUM(' + r('qty_' + i) + ')'; }).join('+') : '0';
  var summary = [
    ['統計', '數值'],
    ['訂單數', '=COUNTA(' + r('ts') + ')'],
    ['套餐份數', '=' + bundleQty],
    ['總收益', '=SUM(' + r('total') + ')'],
    ['已收', '=SUMIF(' + r('paid') + ',TRUE,' + r('total') + ')'],
    ['未收', '=B' + (start + 3) + '-B' + (start + 4)],
    ['保冷袋總數（自取）', '=SUM(' + r('bags') + ')'],
    ['宅配件數', '=COUNTIF(' + r('method') + ',"宅配")'],
    ['現場訂單數', '=COUNTIF(' + r('source') + ',"現場")'],
    ['線上訂單數', '=COUNTIF(' + r('source') + ',"線上")'],
  ];
  sh.getRange(start, 1, summary.length, 2).setValues(summary);
  sh.getRange(start, 1, 1, 2).setFontWeight('bold').setBackground('#f3f4f6');
  sh.getRange(start + 3, 2, 3, 1).setNumberFormat('#,##0');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, rows[0].length);
}

function nfBuildPrepSheet_(ss, s, L) {
  var sh = nfGetOrCreateSheet_(ss, NF.SHEET_PREP);
  var O = "'" + NF.SHEET_ORDERS + "'!A2:" + nfColLetter_(nfColNumber_(L.colOf.tsRef)) + L.last;
  var sums = L.singles.map(function (x) { return 'sum(' + L.colOf[x.key] + ")"; });
  var labels = L.singles.map(function (x) { return 'sum(' + L.colOf[x.key] + ") '" + x.item.name + "'"; });
  // 自取：依取貨日
  sh.getRange(1, 1).setValue('來店自取（依取貨日）').setFontWeight('bold');
  sh.getRange(2, 1).setFormula('=IFERROR(QUERY(' + O + ',"select ' + L.colOf.pickupDate + ', ' + sums.join(', ') + ', sum(' + L.colOf.bags + ')' +
    ' where ' + L.colOf.ts + " is not null and " + L.colOf.method + " = '來店自取' group by " + L.colOf.pickupDate +
    ' order by ' + L.colOf.pickupDate + ' label ' + L.colOf.pickupDate + " '取貨日', " + labels.join(', ') + ', sum(' + L.colOf.bags + ") '保冷袋'\",0),\"（尚無自取訂單）\")");
  // 宅配：依出貨日（空白＝尚未出貨）
  var row2 = 20;
  sh.getRange(row2, 1).setValue('宅配（依出貨日，空白＝尚未出貨）').setFontWeight('bold');
  sh.getRange(row2 + 1, 1).setFormula('=IFERROR(QUERY(' + O + ',"select ' + L.colOf.shipDate + ', ' + sums.join(', ') + ', count(' + L.colOf.ts + ')' +
    ' where ' + L.colOf.ts + " is not null and " + L.colOf.method + " = '宅配' group by " + L.colOf.shipDate +
    ' order by ' + L.colOf.shipDate + ' label ' + L.colOf.shipDate + " '出貨日', " + labels.join(', ') + ', count(' + L.colOf.ts + ") '宅配件數'\",0),\"（尚無宅配訂單）\")");
}

function nfBuildLogSheet_(ss) {
  var sh = nfGetOrCreateSheet_(ss, NF.SHEET_LOG);
  sh.getRange(1, 1, 1, 6).setValues([['時間', '訂單（時間戳記＋姓名）', '欄位', '原值', '新值', '原因']])
    .setFontWeight('bold').setBackground('#f3f4f6');
  sh.setFrozenRows(1);
  // 原因沒填的列標紅
  var rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($A2<>"",$F2="")')
    .setBackground('#fde2e2')
    .setRanges([sh.getRange('A2:F2000')])
    .build();
  sh.setConditionalFormatRules([rule]);
  sh.setColumnWidth(2, 220);
}
