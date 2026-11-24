/**
 * 分頁建立：宅配、自取（OrderSheets.gs，由 GAS 寫入）＋查詢、統計、備料表、修改紀錄（公式，讀宅配／自取）
 *
 *   查詢    B1 輸入姓名、電話、末五碼或流水號（例 27001）的任何一部分，列出符合的訂單（宅配＋自取）
 *   統計    收款（總額／已收／未收）、訂單數（宅配／自取、線上／現場）、包材、各品項訂購量與出貨／取貨進度
 *           （入庫、需求、差額、停售在 WebPOS 年菜管理頁看，這裡不重複）
 *   備料表  列是品項（套餐拆成組成）、欄是 宅配｜各取貨日｜合計；下方每天保冷袋與宅配件數
 *   修改紀錄 手動修改「表單回應」的紀錄（Protect.gs）
 * 已取消的訂單（狀態欄含「已取消」）一律不計入。
 * 舊版的「訂單整理」「供需庫存」分頁在重建時刪除。
 */
var NF_OLD_SHEETS = ['訂單整理', '供需庫存'];

/** opts.reset：清空宅配／自取的手動欄與取消列、修改紀錄（正式上線、測試清空） */
function nfBuildTabs_(settings, opts) {
  opts = opts || {};
  var ss = nfSpreadsheet_();
  nfEnsureKv_(['寄出日', '加熱說明小卡ID']);
  settings = nfReadSettings_();
  var synced = nfSyncOrderSheets_({ rebuild: true, reset: !!opts.reset });
  var defs = { delivery: nfOrderCols_('delivery', settings), pickup: nfOrderCols_('pickup', settings) };
  nfBuildLookupSheet_(ss, settings, defs);
  nfBuildStatsSheet_(ss, settings, defs);
  nfBuildPrepSheet_(ss, settings, defs);
  if (opts.reset || !ss.getSheetByName(NF.SHEET_LOG)) nfBuildLogSheet_(ss);
  NF_OLD_SHEETS.forEach(function (n) { var sh = ss.getSheetByName(n); if (sh) ss.deleteSheet(sh); });
  // 分頁順序：宅配、自取、查詢、統計、備料表、修改紀錄、設定、表單回應
  [NF.SHEET_DELIVERY, NF.SHEET_PICKUP, NF.SHEET_LOOKUP, NF.SHEET_STATS, NF.SHEET_PREP, NF.SHEET_LOG, NF.SHEET_SETTINGS, NF.SHEET_RESPONSES]
    .forEach(function (n, i) {
      var sh = ss.getSheetByName(n);
      if (!sh) return;
      try { ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1); } catch (e) { /* 排序失敗不影響 */ }
    });
  try { nfEnsureDailyTrigger_(); } catch (e) { console.error('取貨提醒觸發安裝失敗：' + e); }
  return synced;
}

/** 「設定」缺少的項目補上（舊年度升級用），寫在 A 欄最後一個項目之後 */
function nfEnsureKv_(keys) {
  var sh = nfEnsureSettingsSheet_();
  var last = Math.max(sh.getLastRow(), 1);
  var have = sh.getRange(1, 1, last, 1).getValues().map(function (r) { return String(r[0]).trim(); });
  var lastKv = 0;
  have.forEach(function (k, i) { if (k) lastKv = i + 1; });
  keys.forEach(function (k) {
    if (have.indexOf(k) >= 0) return;
    lastKv++;
    sh.getRange(lastKv, 1, 1, 2).setValues([[k, '']]);
    have[lastKv - 1] = k;
  });
}

function nfGetOrCreateSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (sh) {
    sh.clear();
    if (sh.clearConditionalFormatRules) sh.clearConditionalFormatRules();
    try { sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setDataValidation(null); } catch (e) { /* 略過 */ }
    try { for (var d = 0; d < 3; d++) sh.getRange(1, 1, 1, sh.getMaxColumns()).shiftColumnGroupDepth(-1); } catch (e2) { /* 沒有群組 */ }
    try { sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { if (String(p.getDescription() || '').indexOf(NF_PROTECT_PREFIX) === 0) p.remove(); }); } catch (e3) { /* 略過 */ }
  } else {
    sh = ss.insertSheet(name);
  }
  return sh;
}

function nfColNumber_(letter) {
  var n = 0;
  for (var i = 0; i < letter.length; i++) n = n * 26 + (letter.charCodeAt(i) - 64);
  return n;
}

var NF_NOT_CANCELLED = '"<>*已取消*"';

/** 查詢：B1 輸入關鍵字 */
function nfBuildLookupSheet_(ss, s, defs) {
  var sh = nfGetOrCreateSheet_(ss, NF.SHEET_LOOKUP);
  var D = function (k) { return nfOrderRange_('delivery', defs.delivery, k); };
  var P = function (k) { return nfOrderRange_('pickup', defs.pickup, k); };
  var head = ['取貨方式', '訂單編號', '訂購姓名', '電話', '末五碼', '品項', '金額', '取貨日／出貨日', '付款', '進度', '信件', '狀態'];
  var dArr = [
    'IF(' + D('id') + '="","","宅配")', D('id'), D('name'), D('phone'), D('last5'), D('summary'), D('amount'), D('shipDate'),
    'IF(' + D('paid') + ',"已付","未付")',
    'IF(' + D('shipDate') + '<>"","已出貨 "&' + D('shipDate') + ',"未出貨")',
    '"寄出前確認："&IF(' + D('preShipStatus') + '="","—",' + D('preShipStatus') + ')&"／出貨通知："&IF(' + D('shippedStatus') + '="","—",' + D('shippedStatus') + ')',
    D('note'),
  ];
  var pArr = [
    'IF(' + P('id') + '="","","自取")', P('id'), P('name'), P('phone'), P('last5'), P('summary'), P('amount'), P('pickupDate'),
    'IF(' + P('paid') + ',"已付","未付")',
    'IF(' + P('picked') + ',"已取貨 "&' + P('pickedAt') + ',"未取貨")',
    '"取貨提醒："&IF(' + P('remindStatus') + '="","—",' + P('remindStatus') + ')',
    P('note'),
  ];
  var formula = '=IF(LEN($B$1)=0,"",IFERROR(LET(d,ARRAYFORMULA({' + dArr.join(',') + ';' + pArr.join(',') + '}),' +
    'FILTER(d,INDEX(d,,2)<>"",ISNUMBER(SEARCH($B$1,INDEX(d,,3)&"|"&INDEX(d,,4)&"|"&INDEX(d,,5))))),"查無符合的訂單"))';
  sh.getRange('A1').setValue('🔍 輸入姓名／電話／末五碼／流水號：').setFontWeight('bold');
  sh.getRange('B1').setBackground('#fef3c7').setNumberFormat('@');
  sh.getRange('C1').setValue('← 輸入任何一部分即可，例如「王」「0912」「27001」').setFontColor('#6b7280');
  sh.getRange(3, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#f3f4f6');
  sh.getRange('A4').setFormula(formula);
  sh.getRange(4, 7, NF_DATA_ROWS, 1).setNumberFormat('#,##0');
  sh.setFrozenRows(3);
  [[1, 220], [2, 150], [3, 90], [4, 105], [5, 90], [6, 260], [7, 70], [8, 110], [9, 50], [10, 170], [11, 260], [12, 110]]
    .forEach(function (w) { sh.setColumnWidth(w[0], w[1]); });
}

/** 品項要加總哪些欄位：單點＝自己的欄＋含它的套餐欄×份數；套餐只算自己 */
function nfItemParts_(s, i) {
  var it = s.items[i];
  var parts = [{ key: 'qty_' + i, mult: 1 }];
  if (!it.isBundle) {
    s.items.forEach(function (b, bi) {
      if (!b.isBundle) return;
      b.composition.forEach(function (c) { if (c.item.name === it.name) parts.push({ key: 'qty_' + bi, mult: c.qty }); });
    });
  }
  return parts;
}

/** 統計：A:B 收款／訂單數／包材／進度；D:J 各品項 */
function nfBuildStatsSheet_(ss, s, defs) {
  var sh = nfGetOrCreateSheet_(ss, NF.SHEET_STATS);
  var R = function (kind, k) { return nfOrderRange_(kind, defs[kind], k); };
  var ok = function (kind) { return R(kind, 'note') + ',' + NF_NOT_CANCELLED; };
  var sumIfs = function (kind, k, extra) { return 'SUMIFS(' + R(kind, k) + ',' + R(kind, 'id') + ',"<>",' + ok(kind) + (extra ? ',' + extra : '') + ')'; };
  var cnt = function (kind, extra) { return 'COUNTIFS(' + R(kind, 'id') + ',"<>",' + ok(kind) + (extra ? ',' + extra : '') + ')'; };
  var both = function (fn) { return '=' + fn('delivery') + '+' + fn('pickup'); };

  var left = [
    ['收款', ''],
    ['總金額（含運費）', both(function (k) { return sumIfs(k, 'amount'); })],
    ['已收', both(function (k) { return sumIfs(k, 'amount', R(k, 'paid') + ',TRUE'); })],
    ['未收', '=B2-B3'],
    ['', ''],
    ['訂單數', ''],
    ['宅配', '=' + cnt('delivery')],
    ['自取', '=' + cnt('pickup')],
    ['線上', both(function (k) { return cnt(k, R(k, 'note') + ',"<>*現場單*"'); })],
    ['現場', both(function (k) { return cnt(k, R(k, 'note') + ',"*現場單*"'); })],
    ['合計', '=B7+B8'],
    ['', ''],
    ['包材', ''],
    ['宅配紙箱＋保冷袋', '=B7'],
    ['保冷提袋（自取）', '=' + sumIfs('pickup', 'bags')],
    ['', ''],
    ['出貨／取貨進度', ''],
    ['宅配已出貨', '=' + cnt('delivery', R('delivery', 'shipDate') + ',"<>"')],
    ['宅配未出貨', '=B7-B18'],
    ['自取已取貨', '=' + cnt('pickup', R('pickup', 'picked') + ',TRUE')],
    ['自取未取貨', '=B8-B20'],
  ];
  sh.getRange(1, 1, left.length, 2).setValues(left);
  [1, 6, 13, 17].forEach(function (r) { sh.getRange(r, 1, 1, 2).setFontWeight('bold').setBackground('#f3f4f6'); });
  sh.getRange(2, 2, 3, 1).setNumberFormat('#,##0');

  // D 品項｜E 總訂購量｜F 宅配｜G 自取｜H 已出貨＋已取貨｜I 未出貨＋未取貨｜J 金額（品項，不含運費）
  var head = ['品項', '總訂購量', '宅配', '自取', '已出貨＋已取貨', '未出貨＋未取貨', '金額'];
  var rows = s.items.map(function (it, i) {
    var parts = nfItemParts_(s, i);
    var sum = function (kind, extra) {
      return parts.map(function (p) { return (p.mult === 1 ? '' : p.mult + '*') + sumIfs(kind, p.key, extra); }).join('+');
    };
    var r = i + 2;
    return [
      it.isBundle ? it.name + '（份）' : it.name,
      '=F' + r + '+G' + r,
      '=' + sum('delivery'),
      '=' + sum('pickup'),
      '=' + sum('delivery', R('delivery', 'shipDate') + ',"<>"') + '+' + sum('pickup', R('pickup', 'picked') + ',TRUE'),
      '=E' + r + '-H' + r,
      '=(' + sumIfs('delivery', 'qty_' + i) + '+' + sumIfs('pickup', 'qty_' + i) + ')*' + it.price,
    ];
  });
  sh.getRange(1, 4, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#f3f4f6');
  if (rows.length) sh.getRange(2, 4, rows.length, head.length).setValues(rows);
  var tr = rows.length + 2;
  sh.getRange(tr, 4).setValue('品項金額合計（不含運費）').setFontWeight('bold');
  sh.getRange(tr, 10).setFormula('=SUM(J2:J' + (tr - 1) + ')').setFontWeight('bold');
  sh.getRange(2, 10, tr - 1, 1).setNumberFormat('#,##0');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 150);
  sh.setColumnWidth(3, 24);
  sh.setColumnWidth(4, 170);
  [5, 6, 7, 8, 9, 10].forEach(function (c) { sh.setColumnWidth(c, 100); });
}

/** 備料表：列是品項、欄是 宅配｜各取貨日｜合計 */
function nfBuildPrepSheet_(ss, s, defs) {
  var sh = nfGetOrCreateSheet_(ss, NF.SHEET_PREP);
  var R = function (kind, k) { return nfOrderRange_(kind, defs[kind], k); };
  var ok = function (kind) { return R(kind, 'note') + ',' + NF_NOT_CANCELLED; };
  var dates = s.pickupDates.map(nfFormDateLabel_);
  var head = ['品項', '宅配'].concat(dates).concat(['合計']);
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#f3f4f6');
  var rows = s.items.map(function (it, i) {
    var parts = nfItemParts_(s, i);
    var cell = function (kind, extra) {
      return '=' + parts.map(function (p) {
        return (p.mult === 1 ? '' : p.mult + '*') + 'SUMIFS(' + R(kind, p.key) + ',' + R(kind, 'id') + ',"<>",' + ok(kind) + (extra ? ',' + extra : '') + ')';
      }).join('+');
    };
    var r = i + 2;
    var row = [it.isBundle ? it.name + '（份）' : it.name, cell('delivery')];
    dates.forEach(function (d, di) { row.push(cell('pickup', R('pickup', 'pickupDate') + ',' + nfColLetter_(di + 3) + '$1')); });
    row.push('=SUM(B' + r + ':' + nfColLetter_(head.length - 1) + r + ')');
    return row;
  });
  if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows);
  var b = rows.length + 3;
  var bagRow = ['保冷袋', ''];
  dates.forEach(function (d, di) {
    bagRow.push('=SUMIFS(' + R('pickup', 'bags') + ',' + ok('pickup') + ',' + R('pickup', 'pickupDate') + ',' + nfColLetter_(di + 3) + '$1)');
  });
  bagRow.push('=SUM(C' + b + ':' + nfColLetter_(head.length - 1) + b + ')');
  var shipRow = ['宅配件數', '=COUNTIFS(' + R('delivery', 'id') + ',"<>",' + ok('delivery') + ')'].concat(dates.map(function () { return ''; })).concat(['']);
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
