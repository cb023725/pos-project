/**
 * 建立「訂單整理」「供需庫存」「備料表」「修改紀錄」分頁——版面照 Yw 2026 年的模板
 * （訂單整理金額／供需庫存／樞紐分析表），只把 IMPORTRANGE 換成直接讀同一個檔案的「表單回應」、
 * 價格與運費改讀「設定」、樞紐分析表改成公式（列是品項、欄是取貨日）。
 *
 * 訂單整理（第 1 列：查詢與各品項總數；第 2 列：標題；第 3 列起：資料，對應表單回應第 2 列起）
 *   A 付款 B 取貨（手動勾選）｜C 取貨方式 D 取貨日 E 金額 F 簽收（含運費）｜G 訂購姓名 H 帳號末五碼
 *   I 訂購聯絡 J 訂購e-mail K 收件姓名 L 收件聯絡 M 收件地址｜N～ 各品項「品名 (價格元)」｜出貨日（手動）
 *   之後是 2027 新增欄位：託運單號（手動）、保冷袋、來源、時間戳記、已修改
 *   第 1 列：在 G1 輸入姓名，A1 顯示該訂單簽收金額、H1 顯示末五碼（沿用 2026 年寫法）；品項欄顯示總數
 *
 * 取消的訂單是「清除內容、不刪列」，所以手動欄（付款、取貨、出貨日）跟資料列永遠對得上。
 */
var NF_DATA_ROWS = 1000;  // 預留的資料列數
var NF_ORDERS_HEADER_ROW = 2;
var NF_ORDERS_FIRST_ROW = 3; // 訂單整理第 3 列 ↔ 表單回應第 2 列

function nfBuildTabs_(settings) {
  var ss = nfSpreadsheet_();
  var resp = nfSheet_(NF.SHEET_RESPONSES);
  var headers = resp.getRange(1, 1, 1, resp.getLastColumn()).getValues()[0];
  var cols = nfMapColumns_(headers, settings);
  var L = nfBuildOrdersSheet_(ss, settings, cols);
  nfBuildStockSheet_(ss, settings, L);
  nfBuildPrepSheet_(ss, settings, L);
  nfBuildLogSheet_(ss);
  return { orders: L.lastCol };
}

function nfGetOrCreateSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (sh) { sh.clear(); sh.clearConditionalFormatRules && sh.clearConditionalFormatRules(); }
  else sh = ss.insertSheet(name);
  return sh;
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

function nfBuildOrdersSheet_(ss, s, cols) {
  var sh = nfGetOrCreateSheet_(ss, NF.SHEET_ORDERS);
  var R = "'" + NF.SHEET_RESPONSES + "'!";
  var S = "'" + NF.SHEET_SETTINGS + "'!";
  var first = NF_ORDERS_FIRST_ROW;
  var last = first + NF_DATA_ROWS - 1;
  var respLast = 1 + NF_DATA_ROWS;
  var src = function (idx) { var Lr = nfColLetter_(idx + 1); return R + Lr + '2:' + Lr + respLast; };
  var kvRow = nfSettingsKvRows_();
  var kv = function (key) { return S + '$B$' + kvRow[key]; };
  var priceCell = function (i) { return S + '$' + nfColLetter_(NF_SETTINGS_ITEM_COL + 2) + '$' + (i + 2); };
  var tsSrc = src(0);
  var whenFilled = function (expr) { return '=ARRAYFORMULA(IF(' + tsSrc + '="","",' + expr + '))'; };
  var text = function (key) { return cols[key] !== undefined ? whenFilled(src(cols[key]) + '&""') : ''; };

  var colDefs = []; // { key, header, formula, manual }
  var colOf = {};
  var add = function (key, header, formula, manual) {
    colDefs.push({ key: key, header: header, formula: formula || '', manual: !!manual });
    colOf[key] = nfColLetter_(colDefs.length);
  };
  var rng = function (key) { return colOf[key] + first + ':' + colOf[key] + last; };

  // A～M：照 2026 年模板
  add('paid', '付款', '', true);
  add('picked', '取貨', '', true);
  add('method', '取貨方式', text('method'));
  add('pickupDate', '取貨日', text('pickupDate'));
  add('amount', '金額', '');    // 品項欄建立後再填公式
  add('signed', '簽收', '');
  add('name', '訂購姓名', text('name'));
  add('last5', '帳號末五碼', text('last5'));
  add('phone', '訂購聯絡', text('phone'));
  add('email', '訂購e-mail', text('email'));
  add('recipientName', '收件姓名', text('recipientName'));
  add('recipientPhone', '收件聯絡', text('recipientPhone'));
  add('recipientAddress', '收件地址', text('recipientAddress'));
  // 品項：套餐在前、單點照「設定」順序（跟表單一樣）
  s.items.forEach(function (it, i) {
    var srcCols = cols.items.filter(function (c) { return c.item.name === it.name; })
      .map(function (c) { return 'IFERROR(VALUE(' + src(c.col) + '),0)'; });
    var expr = srcCols.length ? srcCols.join('+') : '0';
    add('qty_' + i, it.name + ' (' + nfMoney_(it.price) + '元)', whenFilled('IF((' + expr + ')=0,"",' + expr + ')'));
  });
  add('shipDate', '出貨日', '', true);
  // 2027 新增
  add('trackNo', '託運單號', '', true);
  var bundleIdx = [];
  s.items.forEach(function (it, i) { if (it.isBundle) bundleIdx.push(i); });
  var nArr = function (key) { return 'IFERROR(VALUE(' + rng(key) + '),0)'; };
  var bundleQty = bundleIdx.length ? bundleIdx.map(function (i) { return nArr('qty_' + i); }).join('+') : '0';
  var bundleAmt = bundleIdx.length ? bundleIdx.map(function (i) { return nArr('qty_' + i) + '*' + priceCell(i); }).join('+') : '0';
  add('bags', '保冷袋', '');
  add('source', '來源', cols.last5 !== undefined ? whenFilled('IF(LEFT(' + src(cols.last5) + ',2)="' + NF.ONSITE_PREFIX + '","現場","線上")') : '');
  add('ts', '時間戳記', whenFilled(tsSrc));
  add('edited', '已修改', cols.edited !== undefined ? whenFilled('IF(' + src(cols.edited) + '=TRUE,"✓","")') : '');

  // 金額（品項小計）、簽收（含運費）、保冷袋
  var amountExpr = s.items.map(function (it, i) { return nArr('qty_' + i) + '*' + priceCell(i); }).join('+') || '0';
  colDefs[nfColNumber_(colOf.amount) - 1].formula = whenFilled('IF((' + amountExpr + ')=0,"",' + amountExpr + ')');
  colDefs[nfColNumber_(colOf.signed) - 1].formula = whenFilled('IF(' + rng('amount') + '="","",IF((' + rng('method') + '="宅配")*(' + rng('amount') + '<' + kv('免運門檻') + '),' + rng('amount') + '+' + kv('運費') + ',' + rng('amount') + '))');
  // 保冷袋（只算自取）＝套餐份數＋單點小計每滿 3,000 元加 1 個
  colDefs[nfColNumber_(colOf.bags) - 1].formula = whenFilled('IF(' + rng('method') + '="來店自取",(' + bundleQty + ')+INT((' + nArr('amount') + '-(' + bundleAmt + '))/' + kv('免運門檻') + '),"")');

  var lastCol = colDefs.length;
  // 第 2 列標題、第 3 列公式
  sh.getRange(NF_ORDERS_HEADER_ROW, 1, 1, lastCol).setValues([colDefs.map(function (c) { return c.header; })])
    .setFontWeight('bold').setBackground('#f3f4f6').setWrap(true).setVerticalAlignment('middle');
  colDefs.forEach(function (c, i) { if (c.formula) sh.getRange(first, i + 1).setFormula(c.formula); });
  // 手動欄標題黃底；付款、取貨用核取方塊；出貨日日期格式
  colDefs.forEach(function (c, i) { if (c.manual) sh.getRange(NF_ORDERS_HEADER_ROW, i + 1).setBackground('#fef3c7'); });
  sh.getRange(rng('paid')).insertCheckboxes();
  sh.getRange(rng('picked')).insertCheckboxes();
  sh.getRange(rng('shipDate')).setNumberFormat('m/d');
  sh.getRange(rng('ts')).setNumberFormat('yyyy/mm/dd hh:mm:ss');
  ['amount', 'signed'].forEach(function (k) { sh.getRange(rng(k)).setNumberFormat('#,##0'); });

  // 第 1 列：G1 輸入姓名查詢，A1 簽收金額、H1 末五碼；品項欄顯示總數（沿用 2026 年）
  sh.getRange('G1').setValue('合計').setFontWeight('bold');
  sh.getRange('A1').setFormula('=IFERROR(INDEX(' + rng('signed') + ',MATCH($G1,' + rng('name') + ',0)),"")');
  sh.getRange('H1').setFormula('=IFERROR(INDEX(' + rng('last5') + ',MATCH($G1,' + rng('name') + ',0)),"")');
  s.items.forEach(function (it, i) { sh.getRange(colOf['qty_' + i] + '1').setFormula('=SUM(' + rng('qty_' + i) + ')').setFontWeight('bold'); });
  sh.getRange(colOf.signed + '1').setFormula('=SUM(' + rng('signed') + ')').setNumberFormat('#,##0').setFontWeight('bold');

  sh.setFrozenRows(NF_ORDERS_HEADER_ROW);
  sh.setFrozenColumns(2);
  sh.setColumnWidths(1, 2, 44);
  s.items.forEach(function (it, i) { sh.setColumnWidth(nfColNumber_(colOf['qty_' + i]), 72); });

  // 已修改的訂單整列淺色標示
  var editedRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$' + colOf.edited + first + '="✓"')
    .setBackground('#fff7e6')
    .setRanges([sh.getRange(first, 1, NF_DATA_ROWS, lastCol)])
    .build();
  sh.setConditionalFormatRules([editedRule]);

  return { colOf: colOf, first: first, last: last, lastCol: lastCol, bundleIdx: bundleIdx };
}

function nfBuildStockSheet_(ss, s, L) {
  var sh = nfGetOrCreateSheet_(ss, NF.SHEET_STOCK);
  var O = "'" + NF.SHEET_ORDERS + "'!";
  var S = "'" + NF.SHEET_SETTINGS + "'!";
  var col = function (key) { return O + '$' + L.colOf[key] + '$' + L.first + ':$' + L.colOf[key] + '$' + L.last; };
  var sumOf = function (key) { return 'SUM(' + col(key) + ')'; };
  var sumIf = function (critKey, crit, key) { return 'SUMIF(' + col(critKey) + ',' + crit + ',' + col(key) + ')'; };
  var prodCell = function (i) { return S + '$' + nfColLetter_(NF_SETTINGS_ITEM_COL + 7) + '$' + (i + 2); }; // 製作入庫（WebPOS 同步）

  var head = [['品項', '總訂購量', '已出貨數量', '未出貨數量', '製作', '現貨庫存', '缺', '宅配', '來店自取', '金額']];
  var rows = [];
  // 每一列的「這個品項在訂單整理裡要加總哪些欄位」：套餐列只算套餐欄；單點列＝自己的欄＋含它的套餐欄×份數
  s.items.forEach(function (it, i) {
    var parts = [{ key: 'qty_' + i, mult: 1 }];
    if (!it.isBundle) {
      s.items.forEach(function (b, bi) {
        if (!b.isBundle) return;
        b.composition.forEach(function (c) { if (c.item.name === it.name) parts.push({ key: 'qty_' + bi, mult: c.qty }); });
      });
    }
    var expr = function (fn) { return parts.map(function (p) { return (p.mult === 1 ? '' : p.mult + '*') + fn(p.key); }).join('+'); };
    var r = rows.length + 2;
    rows.push([
      it.name + ' (' + nfMoney_(it.price) + '元)',
      '=' + expr(sumOf),
      '=' + expr(function (k) { return sumIf('picked', 'TRUE', k); }),
      '=' + expr(function (k) { return sumIf('picked', 'FALSE', k); }),
      it.isBundle ? '' : '=IF(' + prodCell(i) + '="","",' + prodCell(i) + ')',
      it.isBundle ? '' : '=IF(E' + r + '="","",E' + r + '-C' + r + ')',
      it.isBundle ? '' : '=IF(E' + r + '="","",E' + r + '-B' + r + ')',
      '=' + expr(function (k) { return sumIf('method', '"宅配"', k); }),
      '=' + expr(function (k) { return sumIf('method', '"來店自取"', k); }),
      '=' + sumOf('qty_' + i) + '*' + S + '$' + nfColLetter_(NF_SETTINGS_ITEM_COL + 2) + '$' + (i + 2),
    ]);
  });
  var all = head.concat(rows);
  sh.getRange(1, 1, all.length, head[0].length).setValues(all);
  sh.getRange(1, 1, 1, head[0].length).setFontWeight('bold').setBackground('#f3f4f6');
  var lastItemRow = rows.length + 1;
  sh.getRange(2, 10, rows.length, 1).setNumberFormat('#,##0');
  // 缺為負數標紅
  var shortRule = SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor('#dc2626').setBold(true)
    .setRanges([sh.getRange(2, 7, rows.length, 1)]).build();

  // 下方：金額合計、總收益、已收、未收、套餐折扣驗算（沿用 2026 年）
  var t = lastItemRow + 1;
  var bundleRow = s.items.map(function (it, i) { return it.isBundle ? i + 2 : null; }).filter(function (x) { return x; });
  sh.getRange(t, 1).setFormula('=SUM(J2:J' + lastItemRow + ')').setNumberFormat('#,##0');
  sh.getRange(t + 1, 1, 3, 1).setValues([['總收益'], ['已收'], ['未收']]);
  sh.getRange(t + 1, 2).setFormula('=' + sumOf('signed')).setNumberFormat('#,##0');
  sh.getRange(t + 2, 2).setFormula('=' + sumIf('paid', 'TRUE', 'signed')).setNumberFormat('#,##0');
  sh.getRange(t + 3, 2).setFormula('=B' + (t + 1) + '-B' + (t + 2)).setNumberFormat('#,##0');
  sh.getRange(t + 1, 3).setFormula('=SUM(B2:B' + lastItemRow + ')');
  if (bundleRow.length) sh.getRange(t + 1, 4).setFormula('=' + bundleRow.map(function (r) { return 'B' + r; }).join('+') + '*-90');
  sh.getRange(t + 1, 1, 3, 1).setFontWeight('bold');

  // 右側：件數與包材（沿用 2026 年的統計方式，保冷袋改用 2027 規則合計）
  var bundleCols = L.bundleIdx.map(function (i) { return 'qty_' + i; });
  var cnt = function (crit) { return 'COUNTIFS(' + col('method') + ',' + crit + ')'; };
  var side = [
    ['', '筆數', '', '套餐數'],
    ['宅配', '=' + cnt('"宅配"'), '宅配套餐數', bundleCols.length ? '=' + bundleCols.map(function (k) { return sumIf('method', '"宅配"', k); }).join('+') : '0'],
    ['自取>=3000', '=COUNTIFS(' + col('method') + ',"來店自取",' + col('amount') + ',">=3000")', '自取套餐數', bundleCols.length ? '=' + bundleCols.map(function (k) { return sumIf('method', '"來店自取"', k); }).join('+') : '0'],
    ['自取<3000', '=COUNTIFS(' + col('method') + ',"來店自取",' + col('amount') + ',"<3000")', '', ''],
    ['宅配<3000', '=COUNTIFS(' + col('method') + ',"宅配",' + col('amount') + ',"<3000")', '', ''],
    ['宅配紙箱＋保冷袋', '=' + cnt('"宅配"'), '', ''],
    ['保冷提袋（自取）', '=' + sumOf('bags'), '', ''],
  ];
  sh.getRange(1, 12, side.length, 4).setValues(side);
  sh.getRange(1, 12, 1, 4).setFontWeight('bold').setBackground('#f3f4f6');
  sh.getRange(2, 12, side.length - 1, 1).setFontWeight('bold');

  sh.setConditionalFormatRules([shortRule]);
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 200);
}

function nfBuildPrepSheet_(ss, s, L) {
  var sh = nfGetOrCreateSheet_(ss, NF.SHEET_PREP);
  var O = "'" + NF.SHEET_ORDERS + "'!";
  var col = function (key) { return O + '$' + L.colOf[key] + '$' + L.first + ':$' + L.colOf[key] + '$' + L.last; };
  var dates = s.pickupDates.map(nfFormDateLabel_);
  // 第 1 列：各取貨日＋宅配＋合計（照 2026 年樞紐分析表的樣子：列是品項、欄是日期）
  var head = ['品項'].concat(dates).concat(['宅配', '合計']);
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#f3f4f6');
  var rows = [];
  s.items.forEach(function (it, i) {
    var parts = [{ key: 'qty_' + i, mult: 1 }];
    if (!it.isBundle) {
      s.items.forEach(function (b, bi) {
        if (!b.isBundle) return;
        b.composition.forEach(function (c) { if (c.item.name === it.name) parts.push({ key: 'qty_' + bi, mult: c.qty }); });
      });
    }
    var cell = function (critExpr) {
      return '=' + parts.map(function (p) { return (p.mult === 1 ? '' : p.mult + '*') + 'SUMIFS(' + col(p.key) + ',' + critExpr + ')'; }).join('+');
    };
    var r = rows.length + 2;
    var row = [it.isBundle ? it.name + '（份）' : it.name];
    dates.forEach(function (d, di) {
      row.push(cell(col('method') + ',"來店自取",' + col('pickupDate') + ',' + nfColLetter_(di + 2) + '$1'));
    });
    row.push(cell(col('method') + ',"宅配"'));
    row.push('=SUM(B' + r + ':' + nfColLetter_(head.length - 1) + r + ')');
    rows.push(row);
  });
  sh.getRange(2, 1, rows.length, head.length).setValues(rows);
  // 下方：每天的保冷袋與宅配件數
  var b = rows.length + 3;
  var bagRow = ['保冷袋'];
  dates.forEach(function (d, di) { bagRow.push('=SUMIFS(' + col('bags') + ',' + col('pickupDate') + ',' + nfColLetter_(di + 2) + '$1)'); });
  bagRow.push('');
  bagRow.push('=SUM(B' + b + ':' + nfColLetter_(head.length - 1) + b + ')');
  var shipRow = ['宅配件數'].concat(dates.map(function () { return ''; })).concat(['=COUNTIFS(' + col('method') + ',"宅配")', '']);
  sh.getRange(b, 1, 2, head.length).setValues([bagRow, shipRow]);
  sh.getRange(b, 1, 2, 1).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);
  sh.setColumnWidth(1, 160);
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
