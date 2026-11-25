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
  nfEnsureKv_(['寄出日', '加熱說明小卡ID', '地圖連結']);
  settings = nfReadSettings_();
  var synced = nfSyncOrderSheets_({ rebuild: true, reset: !!opts.reset });
  var defs = { delivery: nfOrderCols_('delivery', settings), pickup: nfOrderCols_('pickup', settings) };
  nfBuildLookupSheet_(ss, settings, defs);
  nfBuildStatsSheet_(ss, settings, defs);
  nfBuildPrepSheet_(ss, settings, defs);
  if (opts.reset || !ss.getSheetByName(NF.SHEET_LOG)) nfBuildLogSheet_(ss);
  else nfStyleLogSheet_(ss.getSheetByName(NF.SHEET_LOG));
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
  var defaults = {};
  NF_SETTINGS_DEFAULTS.forEach(function (r) { defaults[r[0]] = r[1]; });
  keys.forEach(function (k) {
    if (have.indexOf(k) >= 0) return;
    lastKv++;
    sh.getRange(lastKv, 1, 1, 2).setValues([[k, defaults[k] !== undefined ? defaults[k] : '']]);
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
    try { sh.getBandings().forEach(function (b) { b.remove(); }); } catch (e4) { /* 沒有色帶 */ }
    try { sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart(); } catch (e5) { /* 沒有合併 */ }
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
/**
 * 查詢：B1 輸入姓名、電話、末五碼或流水號的任何一部分 → 每筆符合的訂單一欄（像訂單卡片），
 * 每列一個欄位，重要的在上面：訂購人、取貨方式、進度、日期、品項、金額、付款、電話、末五碼、收件資訊、信件
 */
var NF_LOOKUP_COLS = 26; // 最多同時顯示 25 筆
function nfBuildLookupSheet_(ss, s, defs) {
  var sh = nfGetOrCreateSheet_(ss, NF.SHEET_LOOKUP);
  var D = function (k) { return nfOrderRange_('delivery', defs.delivery, k); };
  var P = function (k) { return nfOrderRange_('pickup', defs.pickup, k); };
  var labels = ['訂購人', '取貨方式', '進度', '取貨／出貨日', '品項', '金額', '付款', '電話', '末五碼', '收件資訊', '信件'];
  var mail = function (label, rng) { return '"' + label + '："&IF(' + rng + '="","未寄",' + rng + ')'; };
  var dArr = [
    D('name'), 'IF(' + D('id') + '="","","宅配")', D('status'), 'IF(' + D('shipDate') + '="","尚未出貨",' + D('shipDate') + ')',
    D('summary'), D('amount'), 'IF(' + D('paid') + ',"已付款","未付款")', D('phone'), D('last5'),
    D('recipientName') + '&"　"&' + D('recipientPhone') + '&CHAR(10)&' + D('recipientAddress'),
    mail('寄出前確認', D('preShipStatus')) + '&CHAR(10)&' + mail('出貨通知', D('shippedStatus')),
  ];
  var pArr = [
    P('name'), 'IF(' + P('id') + '="","","自取")', P('status'), P('pickupDate'),
    P('summary'), P('amount'), 'IF(' + P('paid') + ',"已付款","未付款")', P('phone'), P('last5'),
    'IF(' + P('picked') + ',"已取貨 "&' + P('pickedAt') + ',"—")',
    mail('取貨提醒', P('remindStatus')),
  ];
  var formula = '=IF(LEN($B$1)=0,"",IFERROR(TRANSPOSE(LET(d,ARRAYFORMULA({' + dArr.join(',') + ';' + pArr.join(',') + '}),' +
    'FILTER(d,INDEX(d,,1)<>"",ISNUMBER(SEARCH($B$1,INDEX(d,,1)&"|"&INDEX(d,,8)&"|"&INDEX(d,,9)))))),"查無符合的訂單"))';
  var n = labels.length, top = 3;
  sh.getRange(1, 1, top + n + 2, NF_LOOKUP_COLS).setFontSize(11).setVerticalAlignment('middle').setFontFamily('Arial')
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sh.setRowHeight(1, 44);
  sh.setRowHeights(top, n, 32);
  sh.setRowHeight(top + 4, 52);  // 品項
  sh.setRowHeight(top + 9, 52);  // 收件資訊
  sh.setRowHeight(top + 10, 52); // 信件
  nfStyleTitle_(sh, 'A1', '🔍 查詢訂單');
  sh.getRange('B1').setBackground('#fef3c7').setNumberFormat('@').setFontSize(13).setFontWeight('bold')
    .setBorder(true, true, true, true, false, false, '#f59e0b', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.getRange('C1').setValue('← 輸入姓名、電話、末五碼或流水號的任何一部分，例如「王」「0912」「27001」；每筆訂單一欄')
    .setFontColor(NF_HINT).setFontSize(10).setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW);
  // 左邊欄位名稱
  nfStyleHead_(sh.getRange(top, 1, n, 1).setValues(labels.map(function (l) { return [l]; })));
  sh.getRange(top, 1, n, 1).setHorizontalAlignment('right');
  sh.getRange(top, 2).setFormula(formula);
  var cards = sh.getRange(top, 2, n, NF_LOOKUP_COLS - 1);
  cards.setHorizontalAlignment('left'); // 卡片：每列一個欄位，內容一律靠左
  cards.setBorder(null, null, null, null, true, true, '#e5e7eb', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(top, 2, 1, NF_LOOKUP_COLS - 1).setFontSize(13).setFontWeight('bold');         // 訂購人
  sh.getRange(top + 2, 2, 1, NF_LOOKUP_COLS - 1).setFontWeight('bold'); // 進度
  sh.getRange(top + 5, 2, 1, NF_LOOKUP_COLS - 1).setNumberFormat('$#,##0').setFontWeight('bold');         // 金額
  sh.getRange(top + 8, 2, 1, NF_LOOKUP_COLS - 1).setNumberFormat('@');

  var rule = function () { return SpreadsheetApp.newConditionalFormatRule(); };
  var st = sh.getRange(top + 2, 2, 1, NF_LOOKUP_COLS - 1), pay = sh.getRange(top + 6, 2, 1, NF_LOOKUP_COLS - 1);
  var rules = [];
  [['待付款', '#fee2e2', '#b91c1c'], ['待出貨', '#fef3c7', '#92400e'], ['待取貨', '#fef3c7', '#92400e'],
    ['已出貨', '#dcfce7', '#166534'], ['已取貨', '#dcfce7', '#166534'], ['已取消', '#f3f4f6', '#9ca3af']].forEach(function (x) {
    rules.push(rule().whenTextEqualTo(x[0]).setBackground(x[1]).setFontColor(x[2]).setRanges([st]).build());
  });
  rules.push(rule().whenTextEqualTo('未付款').setFontColor('#b91c1c').setBold(true).setRanges([pay]).build());
  rules.push(rule().whenTextEqualTo('查無符合的訂單').setFontColor('#9ca3af').setRanges([sh.getRange(top, 2)]).build());
  sh.setConditionalFormatRules(rules);
  sh.setColumnWidth(1, 120);
  for (var c = 2; c <= NF_LOOKUP_COLS; c++) sh.setColumnWidth(c, 240);
  sh.setFrozenRows(1);   // 搜尋列固定在上面
  sh.setFrozenColumns(1); // 欄位名稱固定在左邊
  sh.setHiddenGridlines(true);
  nfSaveBounds_(NF.SHEET_LOOKUP, top + n - 1, NF_LOOKUP_COLS, 'B1');
}

/** 顯示順序：單品在前（照設定順序），套餐放最後 */
function nfItemOrder_(s) {
  var idx = s.items.map(function (it, i) { return i; });
  return idx.filter(function (i) { return !s.items[i].isBundle; }).concat(idx.filter(function (i) { return s.items[i].isBundle; }));
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

/**
 * 共用外觀規則（所有分頁一致）：
 *   字體 Arial；內文 11、分頁標題 16、區塊標題 12、提示 10 灰；標題列深灰底白字置中
 *   對齊：文字靠左、金額靠右、數量／狀態／日期／代碼／勾選置中；查詢卡片一律靠左
 */
var NF_HINT = '#6b7280';
function nfStyleTitle_(sh, a1, text, width) {
  sh.getRange(a1).setValue(text).setFontSize(16).setFontWeight('bold').setFontColor('#111827');
}
function nfStyleHead_(rg) {
  rg.setFontWeight('bold').setFontColor('#ffffff').setBackground('#374151').setHorizontalAlignment('center').setVerticalAlignment('middle');
}
function nfBar_(value, max, color) {
  return '=IFERROR(SPARKLINE(' + value + ',{"charttype","bar";"max",MAX(1,' + max + ');"color1","' + color + '";"color2","#e5e7eb"}),"")';
}

/**
 * 統計：上方四個大數字（訂單數、總金額、已收、未收）→ 出貨／取貨進度條 → 來源與包材 → 各品項
 * 已取消的訂單不計入；套餐拆成組成計入單點品項
 */
function nfBuildStatsSheet_(ss, s, defs) {
  var sh = nfGetOrCreateSheet_(ss, NF.SHEET_STATS);
  var R = function (kind, k) { return nfOrderRange_(kind, defs[kind], k); };
  var ok = function (kind) { return R(kind, 'note') + ',' + NF_NOT_CANCELLED; };
  var sumIfs = function (kind, k, extra) { return 'SUMIFS(' + R(kind, k) + ',' + R(kind, 'id') + ',"<>",' + ok(kind) + (extra ? ',' + extra : '') + ')'; };
  var cnt = function (kind, extra) { return 'COUNTIFS(' + R(kind, 'id') + ',"<>",' + ok(kind) + (extra ? ',' + extra : '') + ')'; };
  var both = function (fn) { return '=' + fn('delivery') + '+' + fn('pickup'); };
  sh.getRange(1, 1, 60, 8).setFontSize(11).setVerticalAlignment('middle').setFontFamily('Arial');
  sh.setRowHeights(1, 60, 30);
  [140, 110, 90, 90, 90, 90, 90, 160].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  nfStyleTitle_(sh, 'A1', '📊 ' + s.year + ' 年菜統計');
  sh.getRange('E1').setValue('已取消的訂單不計入').setFontColor(NF_HINT).setFontSize(10);
  // 大數字
  var kpi = [
    ['A', '訂單數', '=' + cnt('delivery') + '+' + cnt('pickup'), '0'],
    ['C', '總金額（含運費）', both(function (k) { return sumIfs(k, 'amount'); }), '$#,##0'],
    ['E', '已收', both(function (k) { return sumIfs(k, 'amount', R(k, 'paid') + ',TRUE'); }), '$#,##0'],
    ['G', '未收', '=C4-E4', '$#,##0'],
  ];
  kpi.forEach(function (x) {
    var c2 = String.fromCharCode(x[0].charCodeAt(0) + 1);
    sh.getRange(x[0] + '3:' + c2 + '3').merge().setValue(x[1]).setFontColor('#6b7280').setFontSize(10).setHorizontalAlignment('center').setBackground('#f9fafb');
    sh.getRange(x[0] + '4:' + c2 + '4').merge().setFormula(x[2]).setNumberFormat(x[3]).setFontSize(20).setFontWeight('bold')
      .setHorizontalAlignment('center').setBackground('#f9fafb');
  });
  sh.setRowHeight(4, 44);
  sh.getRange('G4').setFontColor('#b91c1c');

  // 進度
  sh.getRange('A6').setValue('出貨／取貨進度').setFontWeight('bold').setFontSize(12);
  var prog = [
    ['宅配已出貨', cnt('delivery', R('delivery', 'shipDate') + ',"<>"'), cnt('delivery'), '#16a34a'],
    ['自取已取貨', cnt('pickup', R('pickup', 'picked') + ',TRUE'), cnt('pickup'), '#16a34a'],
    ['已付款', both(function (k) { return cnt(k, R(k, 'paid') + ',TRUE'); }).slice(1), '(' + cnt('delivery') + '+' + cnt('pickup') + ')', '#2563eb'],
  ];
  prog.forEach(function (x, i) {
    var r = 7 + i;
    sh.getRange(r, 1).setValue(x[0]);
    sh.getRange(r, 2).setFormula('=(' + x[1] + ')&" / "&(' + x[2] + ')').setHorizontalAlignment('center').setFontWeight('bold');
    sh.getRange(r, 3, 1, 6).merge().setFormula(nfBar_('(' + x[1] + ')', '(' + x[2] + ')', x[3]));
  });

  // 來源與包材
  sh.getRange('A11').setValue('來源與包材').setFontWeight('bold').setFontSize(12);
  var mini = [
    ['宅配', '=' + cnt('delivery'), '筆'], ['自取', '=' + cnt('pickup'), '筆'],
    ['線上', both(function (k) { return cnt(k, R(k, 'note') + ',"<>*現場單*"'); }), '筆'], ['現場', both(function (k) { return cnt(k, R(k, 'note') + ',"*現場單*"'); }), '筆'],
    ['宅配紙箱', '=' + cnt('delivery'), '個'], ['保冷提袋', '=' + sumIfs('pickup', 'bags'), '個'],
  ];
  mini.forEach(function (x, i) {
    var r = 12 + Math.floor(i / 2), c = (i % 2) * 4 + 1;
    sh.getRange(r, c).setValue(x[0]).setFontColor('#6b7280');
    sh.getRange(r, c + 1).setFormula(x[1]).setFontWeight('bold').setHorizontalAlignment('right');
    sh.getRange(r, c + 2).setValue(x[2]).setFontColor('#6b7280');
  });

  // 各品項
  var top = 16;
  sh.getRange(top - 1, 1).setValue('各品項（套餐拆成組成計入）').setFontWeight('bold').setFontSize(12);
  var head = ['品項', '總訂購量', '宅配', '自取', '已出／取', '未出／取', '品項金額', '完成進度'];
  nfStyleHead_(sh.getRange(top, 1, 1, head.length).setValues([head]));
  // 和備料表同樣順序：單品在前，套餐放最後當參考（已拆入各單品）
  var order = nfItemOrder_(s);
  var nSingle = order.filter(function (i) { return !s.items[i].isBundle; }).length;
  var rows = order.map(function (i, k) { var it = s.items[i];
    var parts = nfItemParts_(s, i);
    var sum = function (kind, extra) {
      return parts.map(function (p) { return (p.mult === 1 ? '' : p.mult + '*') + sumIfs(kind, p.key, extra); }).join('+');
    };
    var r = top + 1 + k;
    return [
      it.isBundle ? it.name + '（份，已拆入上方單品）' : it.name,
      '=C' + r + '+D' + r,
      '=' + sum('delivery'),
      '=' + sum('pickup'),
      '=' + sum('delivery', R('delivery', 'shipDate') + ',"<>"') + '+' + sum('pickup', R('pickup', 'picked') + ',TRUE'),
      '=B' + r + '-E' + r,
      '=(' + sumIfs('delivery', 'qty_' + i) + '+' + sumIfs('pickup', 'qty_' + i) + ')*' + it.price,
      nfBar_('E' + r, 'B' + r, '#16a34a'),
    ];
  });
  if (rows.length) {
    sh.getRange(top + 1, 1, rows.length, head.length).setValues(rows);
    if (nSingle) sh.getRange(top + 1, 1, nSingle, head.length).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
    sh.getRange(top + 1, 2, rows.length, 5).setHorizontalAlignment('center'); // 數量置中
    sh.getRange(top + 1, 7, rows.length + 1, 1).setHorizontalAlignment('right'); // 金額靠右
    sh.getRange(top + 1, 7, rows.length + 1, 1).setNumberFormat('$#,##0');
    sh.getRange(top + 1, 2, rows.length, 1).setFontWeight('bold');
    if (rows.length > nSingle) sh.getRange(top + 1 + nSingle, 1, rows.length - nSingle, head.length - 1).setFontColor('#9ca3af').setFontSize(10).setFontStyle('italic').setFontWeight('normal');
  }
  var tr = top + 1 + rows.length;
  sh.getRange(tr, 1).setValue('品項金額合計（不含運費）').setFontWeight('bold');
  sh.getRange(tr, 7).setFormula('=SUM(G' + (top + 1) + ':G' + (tr - 1) + ')').setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setHiddenGridlines(true);
  nfSaveBounds_(NF.SHEET_STATS, tr, 8, null);
}

/**
 * 備料表：
 *   上方「截至日期」：選一個日期，顯示這天（含）以前要準備好的總數量（宅配依出貨日，還沒填出貨日的算第一個寄出日；自取依取貨日）
 *   下方「每日明細」：列是品項、欄是 宅配｜各取貨日｜合計，最下面是每天的保冷袋與宅配件數
 */
function nfBuildPrepSheet_(ss, s, defs) {
  var old = ss.getSheetByName(NF.SHEET_PREP);
  var keepDate = old ? old.getRange('B3').getValue() : null; // 重建時保留已選的截至日期
  var sh = nfGetOrCreateSheet_(ss, NF.SHEET_PREP);
  var R = function (kind, k) { return nfOrderRange_(kind, defs[kind], k); };
  var ok = function (kind) { return R(kind, 'note') + ',' + NF_NOT_CANCELLED; };
  var dates = s.pickupDates.map(nfFormDateLabel_);
  var ncol = Math.max(dates.length + 3, 5);
  sh.getRange(1, 1, 80, ncol).setFontSize(11).setVerticalAlignment('middle').setFontFamily('Arial');
  sh.setRowHeights(1, 80, 30);
  sh.setColumnWidth(1, 230);
  for (var c = 2; c <= ncol; c++) sh.setColumnWidth(c, 110);
  nfStyleTitle_(sh, 'A1', '🥘 ' + s.year + ' 備料表');

  // ── 截至日期 ──
  sh.getRange('A3').setValue('截至日期').setFontWeight('bold').setHorizontalAlignment('right');
  var first = s.pickupDates[0] ? /^(\d{4})-(\d{2})-(\d{2})/.exec(s.pickupDates[0]) : null;
  sh.getRange('B3').setValue(keepDate instanceof Date ? keepDate : first ? new Date(+first[1], +first[2] - 1, +first[3]) : new Date())
    .setNumberFormat('yyyy/m/d').setBackground('#fef3c7').setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center')
    .setBorder(true, true, true, true, false, false, '#f59e0b', SpreadsheetApp.BorderStyle.SOLID_MEDIUM)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).setHelpText('點兩下選日期').build());
  sh.getRange('C3').setValue('← 點兩下選日期：顯示這天（含）以前要準備好的數量').setFontColor(NF_HINT).setFontSize(10);
  // 需準備總數＝單點＋套餐內含（例：雞湯＝單點的雞湯＋富貴套餐份數×套餐裡的雞湯數）
  var cumHead = ['品項', '需準備總數', '單點', '套餐內含', '其中宅配', '其中自取'];
  nfStyleHead_(sh.getRange(5, 1, 1, cumHead.length).setValues([cumHead]));
  sh.getRange('B5').setNote('需準備總數＝單點＋套餐內含＝其中宅配＋其中自取');
  var upTo = R('delivery', 'sortDate'), upToP = R('pickup', 'sortDate');
  var dateOf = function (kind) { return kind === 'delivery' ? upTo : upToP; };
  // 單品排前面（要準備的重點），套餐放最後當參考（已拆入各單品）
  var order = nfItemOrder_(s);
  var nSingle = order.filter(function (i) { return !s.items[i].isBundle; }).length;
  var label = function (it) { return it.isBundle ? it.name + '（份，已拆入上方單品）' : it.name; };
  var cumRows = order.map(function (i, k) { var it = s.items[i];
    var parts = nfItemParts_(s, i);
    var sum = function (kinds, which) {
      var ps = parts.filter(function (p, pi) { return which === 'all' || (which === 'own' ? pi === 0 : pi > 0); });
      if (!ps.length) return '0';
      return kinds.map(function (kind) {
        return ps.map(function (p) {
          return (p.mult === 1 ? '' : p.mult + '*') + 'SUMIFS(' + R(kind, p.key) + ',' + R(kind, 'id') + ',"<>",' + ok(kind) + ',' + dateOf(kind) + ',"<="&$B$3)';
        }).join('+');
      }).join('+');
    };
    var r = 6 + k;
    return [label(it), '=E' + r + '+F' + r,
      '=' + sum(['delivery', 'pickup'], 'own'), it.isBundle ? '' : '=' + sum(['delivery', 'pickup'], 'bundle'),
      '=' + sum(['delivery'], 'all'), '=' + sum(['pickup'], 'all')];
  });
  var cumEnd = 6 + cumRows.length;
  if (cumRows.length) {
    sh.getRange(6, 1, cumRows.length, cumHead.length).setValues(cumRows);
    sh.getRange(6, 2, cumRows.length, cumHead.length - 1).setHorizontalAlignment('center');
    sh.getRange(6, 3, cumRows.length, cumHead.length - 2).setFontColor('#6b7280');
    // 重點：單品＋需準備總數 → 淡黃網底、粗橘框、大字
    if (nSingle) {
      sh.getRange(6, 1, nSingle, 2).setBackground('#fff7e0').setFontSize(13).setFontWeight('bold')
        .setBorder(true, true, true, true, null, true, '#f59e0b', SpreadsheetApp.BorderStyle.SOLID_THICK);
      sh.getRange(6, 1, nSingle, 2).setBorder(null, null, null, null, null, true, '#fde68a', SpreadsheetApp.BorderStyle.SOLID);
      sh.getRange(6, 2, nSingle, 1).setFontSize(15).setFontColor('#b91c1c');
      sh.getRange(5, 1, 1, 2).setBackground('#b45309');
      sh.setRowHeights(6, nSingle, 32);
    }
    // 套餐：灰色小字參考列
    if (cumRows.length > nSingle) sh.getRange(6 + nSingle, 1, cumRows.length - nSingle, cumHead.length).setFontColor('#9ca3af').setFontSize(10).setFontStyle('italic');
  }
  sh.getRange(cumEnd, 1, 2, cumHead.length).setValues([
    ['保冷提袋（自取）', '=F' + cumEnd, '', '', '', '=SUMIFS(' + R('pickup', 'bags') + ',' + R('pickup', 'id') + ',"<>",' + ok('pickup') + ',' + upToP + ',"<="&$B$3)'],
    ['宅配紙箱', '=E' + (cumEnd + 1), '', '', '=COUNTIFS(' + R('delivery', 'id') + ',"<>",' + ok('delivery') + ',' + upTo + ',"<="&$B$3)', ''],
  ]).setFontColor('#374151');
  sh.getRange(cumEnd, 2, 2, cumHead.length - 1).setHorizontalAlignment('center');
  sh.getRange(cumEnd, 1, 2, 1).setFontWeight('bold');
  sh.getRange(cumEnd, 1, 1, cumHead.length).setBorder(true, null, null, null, null, null, '#9ca3af', SpreadsheetApp.BorderStyle.SOLID);

  // ── 每日明細 ──
  var t = cumEnd + 4;
  sh.getRange(t - 1, 1).setValue('每日明細（宅配＋各取貨日）').setFontWeight('bold').setFontSize(12);
  var head = ['品項', '宅配'].concat(dates).concat(['合計']);
  nfStyleHead_(sh.getRange(t, 1, 1, head.length).setValues([head]));
  var rows = order.map(function (i, k) { var it = s.items[i];
    var parts = nfItemParts_(s, i);
    var cell = function (kind, extra) {
      return '=' + parts.map(function (p) {
        return (p.mult === 1 ? '' : p.mult + '*') + 'SUMIFS(' + R(kind, p.key) + ',' + R(kind, 'id') + ',"<>",' + ok(kind) + (extra ? ',' + extra : '') + ')';
      }).join('+');
    };
    var r = t + 1 + k;
    var row = [label(it), cell('delivery')];
    dates.forEach(function (d, di) { row.push(cell('pickup', R('pickup', 'pickupDate') + ',' + nfColLetter_(di + 3) + '$' + t)); });
    row.push('=SUM(B' + r + ':' + nfColLetter_(head.length - 1) + r + ')');
    return row;
  });
  if (rows.length) {
    sh.getRange(t + 1, 1, rows.length, head.length).setValues(rows);
    if (nSingle) sh.getRange(t + 1, 1, nSingle, head.length).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
    sh.getRange(t + 1, 2, rows.length, head.length - 1).setHorizontalAlignment('center');
    sh.getRange(t + 1, head.length, rows.length, 1).setFontWeight('bold');
    if (rows.length > nSingle) sh.getRange(t + 1 + nSingle, 1, rows.length - nSingle, head.length).setFontColor('#9ca3af').setFontSize(10).setFontStyle('italic');
    // 0 顯示成淡灰，數字一眼看得出來
    sh.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule().whenNumberEqualTo(0).setFontColor('#d1d5db')
      .setRanges([sh.getRange(t + 1, 2, nSingle, head.length - 1), sh.getRange(6, 2, nSingle, 5)]).build()]);
  }
  var b = t + 1 + rows.length;
  var bagRow = ['保冷提袋（自取）', ''];
  dates.forEach(function (d, di) {
    bagRow.push('=SUMIFS(' + R('pickup', 'bags') + ',' + ok('pickup') + ',' + R('pickup', 'pickupDate') + ',' + nfColLetter_(di + 3) + '$' + t + ')');
  });
  bagRow.push('=SUM(C' + b + ':' + nfColLetter_(head.length - 1) + b + ')');
  var shipRow = ['宅配紙箱', '=COUNTIFS(' + R('delivery', 'id') + ',"<>",' + ok('delivery') + ')'].concat(dates.map(function () { return ''; })).concat(['']);
  sh.getRange(b, 1, 2, head.length).setValues([bagRow, shipRow]).setHorizontalAlignment('center');
  sh.getRange(b, 1, 2, 1).setFontWeight('bold').setHorizontalAlignment('left');
  sh.getRange(b, 1, 1, head.length).setBorder(true, null, null, null, null, null, '#9ca3af', SpreadsheetApp.BorderStyle.SOLID);
  sh.setFrozenColumns(1);
  sh.setHiddenGridlines(true);
  nfSaveBounds_(NF.SHEET_PREP, b + 1, Math.max(head.length, cumHead.length), 'B3');
}

function nfBuildLogSheet_(ss) {
  nfStyleLogSheet_(nfGetOrCreateSheet_(ss, NF.SHEET_LOG));
}

/** 修改紀錄的外觀（不動已有的紀錄） */
function nfStyleLogSheet_(sh) {
  var head = ['時間', '訂單（時間戳記＋姓名）', '欄位', '原值', '新值', '原因'];
  sh.getRange(1, 1, 2000, head.length).setFontSize(11).setFontFamily('Arial').setVerticalAlignment('middle')
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  nfStyleHead_(sh.getRange(1, 1, 1, head.length).setValues([head]));
  sh.getRange(1, 6).setBackground('#f59e0b').setFontColor('#1f2937').setNote('修改的原因請自己補填（沒填的列會標紅）');
  sh.setRowHeight(1, 40);
  sh.setRowHeights(2, 1999, 30);
  sh.setFrozenRows(1);
  [150, 240, 160, 200, 200, 240].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange(2, 1, 1999, 1).setHorizontalAlignment('center');
  // 原因沒填的列標紅
  var rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($A2<>"",$F2="")')
    .setBackground('#fde2e2')
    .setRanges([sh.getRange('A2:F2000')])
    .build();
  sh.setConditionalFormatRules([rule]);
}

/**
 * 公式分頁（統計、備料表、查詢）的鎖定範圍：資料用到的區域（最後一列、最後一欄），input 是唯一可以填的格子。
 * 存在年度資訊裡，保護範圍與編輯觸發（擁有者改到時自動還原）共用。
 */
function nfSaveBounds_(sheet, lastRow, lastCol, input) {
  NF_CTX.meta.bounds = NF_CTX.meta.bounds || {};
  NF_CTX.meta.bounds[sheet] = { lastRow: lastRow, lastCol: lastCol, input: input };
  nfSaveMeta_(NF_CTX.env, NF_CTX.year, NF_CTX.meta);
}

/** 擁有者改到公式分頁的鎖定區域 → 重建這一頁（保留截至日期／查詢關鍵字），跳提示 */
function nfFormulaSheetEdit_(e, name) {
  var b = (NF_CTX.meta.bounds || {})[name];
  if (!b) return;
  var r0 = e.range.getRow(), c0 = e.range.getColumn();
  var r1 = r0 + e.range.getNumRows() - 1, c1 = c0 + e.range.getNumColumns() - 1;
  if (r0 > b.lastRow || c0 > b.lastCol) return; // 鎖定區域以外可以自由使用
  if (b.input && r0 === r1 && c0 === c1 && e.range.getA1Notation() === b.input) return; // 唯一可以填的格子
  var settings = nfReadSettings_();
  var defs = { delivery: nfOrderCols_('delivery', settings), pickup: nfOrderCols_('pickup', settings) };
  var ss = nfSpreadsheet_();
  var keep = name === NF.SHEET_LOOKUP ? ss.getSheetByName(name).getRange('B1').getValue() : null;
  if (name === NF.SHEET_STATS) nfBuildStatsSheet_(ss, settings, defs);
  else if (name === NF.SHEET_PREP) nfBuildPrepSheet_(ss, settings, defs);
  else if (name === NF.SHEET_LOOKUP) { nfBuildLookupSheet_(ss, settings, defs); if (keep) ss.getSheetByName(name).getRange('B1').setValue(keep); }
  nfApplyProtections_();
  nfToast_(e, '「' + name + '」是自動計算的內容，已還原。' + (b.input ? '可以填的只有黃色格子（' + b.input + '）。' : ''));
}
