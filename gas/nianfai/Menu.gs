/**
 * 「年菜工具」選單
 *   初始化：安裝「提交表單時」觸發條件、建立「設定」分頁與寄信狀態欄（新年度檔案按一次，需 Yw 授權）
 *   設定 WebPOS 密鑰：寫入指令碼屬性 WEBPOS_SECRET（要跟 WebPOS .env 的 NIANFAI_GAS_SECRET 一樣）
 *   同步到表單：依「設定」更新套餐題目、單點表格、取貨日選項，先列出差異再套用
 *   檢查停售：手動跑一次停售檢查
 * 之後再加：取消訂單、寄出前確認、出貨通知、補寄取貨提醒（handoff 第 7 節）
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('年菜工具')
    .addItem('初始化（安裝觸發條件）', 'nfMenuInit')
    .addItem('設定 WebPOS 密鑰', 'nfMenuSetSecret')
    .addSeparator()
    .addItem('同步到表單', 'nfMenuSyncForm')
    .addItem('檢查停售', 'nfMenuCheckSellout')
    .addToUi();
}

function nfMenuInit() {
  var ss = nfSpreadsheet_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'nfOnFormSubmit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('nfOnFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  nfEnsureSettingsSheet_();
  nfEnsureStatusColumn_(nfSheet_(NF.SHEET_RESPONSES));
  SpreadsheetApp.getUi().alert('初始化完成\n\n・已安裝「提交表單時」觸發條件\n・已建立「設定」分頁與「寄信狀態」欄\n\n下一步：設定 WebPOS 密鑰，然後部署網頁應用程式。');
}

function nfMenuSetSecret() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('設定 WebPOS 密鑰', '輸入與 WebPOS 相同的密鑰（NIANFAI_GAS_SECRET）', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var v = r.getResponseText().trim();
  if (v.length < 16) { ui.alert('密鑰至少 16 個字元'); return; }
  PropertiesService.getScriptProperties().setProperty('WEBPOS_SECRET', v);
  ui.alert('已儲存');
}

function nfMenuCheckSellout() {
  var r = nfCheckSellout_('手動檢查');
  SpreadsheetApp.getUi().alert(
    (r.reached.length ? '已達上限：' + r.reached.join('、') : '沒有品項達到上限') +
    '\n表單目前' + (r.formAccepting ? '開放中' : '已關閉') + (r.closedNow ? '（剛剛自動關閉）' : ''));
}

function nfMenuSyncForm() {
  var ui = SpreadsheetApp.getUi();
  var settings = nfReadSettings_();
  if (!settings.items.length) { ui.alert('「設定」沒有品項，請先從 WebPOS 年菜管理頁「同步品項到 Sheet」'); return; }
  var form = nfForm_();
  var plan = nfPlanFormSync_(form, settings);
  if (!plan.changes.length) { ui.alert('表單已是最新，不需要更新'); return; }
  var warn = form.getResponses().length > 0
    ? '\n\n⚠️ 表單已經有回應。開賣期間不要改品名（品名是對應欄位的依據）。' : '';
  var ok = ui.alert('同步到表單', '將更新：\n\n' + plan.changes.join('\n') + warn + '\n\n確定套用？', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  plan.apply.forEach(function (fn) { fn(); });
  ui.alert('已更新表單');
}

function nfRange_(n) {
  var out = [];
  for (var i = 1; i <= n; i++) out.push(String(i));
  return out;
}

function nfPlanFormSync_(form, settings) {
  var changes = [];
  var apply = [];
  var items = form.getItems();
  var lists = items.filter(function (it) { return it.getType() === FormApp.ItemType.LIST; });
  var grid = items.filter(function (it) { return it.getType() === FormApp.ItemType.GRID; })[0];

  // 套餐（下拉）：題目「品名 (價格元)」，選項 1～套餐上限
  settings.items.filter(function (it) { return it.isBundle; }).forEach(function (b) {
    var target = lists.filter(function (li) { return nfParseItemTitle_(li.getTitle()) === b.name; })[0]
      || lists.filter(function (li) { return li.getTitle().indexOf('套餐') >= 0 && li.getTitle().indexOf('取貨日') < 0; })[0];
    if (!target) { changes.push('（找不到「' + b.name + '」的下拉題，請手動新增）'); return; }
    var title = b.name + ' (' + b.price + '元)';
    var choices = nfRange_(settings.bundleMax);
    var li = target.asListItem();
    var cur = li.getChoices().map(function (c) { return c.getValue(); });
    if (target.getTitle() !== title) changes.push('套餐題目：「' + target.getTitle() + '」→「' + title + '」');
    if (cur.join(',') !== choices.join(',')) changes.push('套餐選項：' + cur.join(',') + ' → ' + choices.join(','));
    apply.push(function () { target.setTitle(title); li.setChoiceValues(choices); });
  });

  // 單點（表格）：列「[*]品名 (價格元)」（平常也賣的加 *），欄 1～單點上限
  if (grid) {
    var gi = grid.asGridItem();
    var rows = settings.items.filter(function (it) { return !it.isBundle; })
      .map(function (it) { return (it.regular ? '*' : '') + it.name + ' (' + it.price + '元)'; });
    var cols = nfRange_(settings.singleMax);
    var curRows = gi.getRows();
    var curCols = gi.getColumns();
    if (curRows.join('|') !== rows.join('|')) changes.push('單點表格：\n  原本：' + curRows.join('、') + '\n  改成：' + rows.join('、'));
    if (curCols.join(',') !== cols.join(',')) changes.push('單點數量選項：' + curCols.join(',') + ' → ' + cols.join(','));
    apply.push(function () { gi.setRows(rows); gi.setColumns(cols); });
  } else {
    changes.push('（找不到單點表格題，請手動確認）');
  }

  // 取貨日（下拉）
  var dateList = lists.filter(function (li) { return li.getTitle().indexOf('取貨日') >= 0; })[0];
  if (dateList && settings.pickupDates.length) {
    var dl = dateList.asListItem();
    var want = settings.pickupDates.map(nfFormDateLabel_);
    var curDates = dl.getChoices().map(function (c) { return c.getValue(); });
    if (curDates.join('|') !== want.join('|')) changes.push('取貨日：' + curDates.join('、') + ' → ' + want.join('、'));
    apply.push(function () { dl.setChoiceValues(want); });
  }

  // 沒有實際差異的話不套用（apply 只在 changes 非空時執行）
  return { changes: changes, apply: apply };
}
