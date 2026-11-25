/**
 * 同步到表單與檢查表單對應（WebPOS 年菜管理頁按鈕呼叫）
 *
 * 同步到表單：依「設定」更新套餐題目、單點表格的列與數量選項、取貨日選項。
 *   WebPOS 先呼叫 planFormSync 顯示差異，Yw 確認後再呼叫 applyFormSync。
 *   只動題目名稱與選項，說明文字、圖片不會被覆蓋。開賣期間不要改品名（品名是對應欄位的依據）。
 *
 * 檢查表單對應：逐一確認每個品項、每個必要欄位在表單與「表單回應」都找得到，
 *   開賣前一定要通過（WebPOS 會擋開賣）。Yw 修改文案後可以再按一次確認。
 */
function nfPlanFormSync_() {
  var settings = nfReadSettings_();
  var form = nfForm_();
  var ids = (NF_CTX.meta && NF_CTX.meta.ids) || {};
  var changes = [];
  var apply = [];
  var warnings = [];

  // 套餐（下拉）：題目「品名 (價格元)」，選項 1～套餐上限
  settings.items.filter(function (it) { return it.isBundle; }).forEach(function (b) {
    var id = (ids.bundles || {})[b.name];
    var item = id ? form.getItemById(id) : null;
    if (!item) {
      // 品名改過：找第一個不是取貨日的下拉題
      item = form.getItems(FormApp.ItemType.LIST).filter(function (li) { return li.getId() !== ids.pickupDate; })[0];
    }
    if (!item) { warnings.push('找不到「' + b.name + '」的下拉題'); return; }
    var li = item.asListItem();
    var title = b.name + ' (' + b.price + '元)';
    var choices = nfRange_(settings.bundleMax);
    var cur = li.getChoices().map(function (c) { return c.getValue(); });
    if (item.getTitle() !== title) changes.push('套餐題目：「' + item.getTitle() + '」→「' + title + '」');
    if (cur.join(',') !== choices.join(',')) changes.push('套餐數量選項：' + cur.join(',') + ' → ' + choices.join(','));
    var bundleName = b.name;
    apply.push(function () {
      item.setTitle(title); li.setChoiceValues(choices);
      NF_CTX.meta.ids.bundles = NF_CTX.meta.ids.bundles || {};
      NF_CTX.meta.ids.bundles[bundleName] = item.getId();
    });
  });

  // 單點（表格）：列「[*]品名 (價格元)」，欄 1～單點上限
  var gridItem = ids.grid ? form.getItemById(ids.grid) : form.getItems(FormApp.ItemType.GRID)[0];
  if (gridItem) {
    var gi = gridItem.asGridItem();
    var singles = settings.items.filter(function (it) { return !it.isBundle; });
    var rows = singles.map(nfGridRowTitle_);
    var cols = nfRange_(settings.singleMax);
    var curRows = gi.getRows();
    var curCols = gi.getColumns();
    if (curRows.join('|') !== rows.join('|')) {
      // 只列出有變動的列（新增／移除／改名或改價）
      var removed = curRows.filter(function (r) { return rows.indexOf(r) < 0; });
      var added = rows.filter(function (r) { return curRows.indexOf(r) < 0; });
      var lines = [];
      if (removed.length === added.length) removed.forEach(function (r, i) { lines.push('  ' + r + ' → ' + added[i]); });
      else {
        if (removed.length) lines.push('  移除：' + removed.join('、'));
        if (added.length) lines.push('  新增：' + added.join('、'));
      }
      if (!removed.length && !added.length) lines.push('  調整順序');
      changes.push('單點表格：\n' + lines.join('\n'));
    }
    if (curCols.join(',') !== cols.join(',')) changes.push('單點數量選項：' + curCols.join(',') + ' → ' + cols.join(','));
    apply.push(function () {
      gi.setRows(rows); gi.setColumns(cols);
      NF_CTX.meta.gridRows = singles.map(function (it) { return it.name; });
    });
  } else {
    warnings.push('找不到單點表格題');
  }

  // 取貨日（下拉）
  var dateItem = ids.pickupDate ? form.getItemById(ids.pickupDate) : null;
  if (dateItem && settings.pickupDates.length) {
    var dl = dateItem.asListItem();
    var want = settings.pickupDates.map(nfFormDateLabel_);
    var curDates = dl.getChoices().map(function (c) { return c.getValue(); });
    if (curDates.join('|') !== want.join('|')) changes.push('取貨日：' + curDates.join('、') + ' → ' + want.join('、'));
    apply.push(function () { dl.setChoiceValues(want); });
  }

  var hasResponses = form.getResponses().length > 0;
  return { changes: changes, warnings: warnings, hasResponses: hasResponses, apply: apply };
}

function nfApplyFormSync_() {
  var plan = nfPlanFormSync_();
  if (!plan.changes.length) return { changes: [] };
  plan.apply.forEach(function (fn) { fn(); });
  nfSaveMeta_(NF_CTX.env, NF_CTX.year, NF_CTX.meta);
  return { changes: plan.changes };
}

function nfCheckForm_() {
  var settings = nfReadSettings_();
  var form = nfForm_();
  var problems = [];
  var ids = (NF_CTX.meta && NF_CTX.meta.ids) || {};
  var labels = {
    consent: '訂購須知', method: '取貨方式', name: '訂購人姓名', phone: '訂購人聯絡電話', email: '訂購人e-mail',
    recipientName: '收件人', recipientPhone: '收件人聯絡電話', recipientAddress: '收件地址', pickupDate: '預計取貨日期', last5: '預計匯款帳號末五碼',
  };
  Object.keys(labels).forEach(function (k) {
    if (!ids[k] || !form.getItemById(ids[k])) problems.push('表單找不到「' + labels[k] + '」這一題（可能被刪除了）');
  });
  var methodItem = ids.method && form.getItemById(ids.method);
  if (methodItem) {
    var ch = methodItem.asMultipleChoiceItem().getChoices().map(function (c) { return c.getValue(); });
    if (!ch.some(function (c) { return c.indexOf('宅配') >= 0; })) problems.push('「取貨方式」沒有「宅配」選項');
    if (!ch.some(function (c) { return c.indexOf('自取') >= 0; })) problems.push('「取貨方式」沒有「來店自取」選項');
  }
  var dateItem = ids.pickupDate && form.getItemById(ids.pickupDate);
  if (dateItem) {
    var opts = dateItem.asListItem().getChoices().map(function (c) { return nfIsoDate_(c.getValue()); });
    var missing = settings.pickupDates.filter(function (d) { return opts.indexOf(d) < 0; });
    if (missing.length) problems.push('「預計取貨日期」缺少：' + missing.map(nfFormDateLabel_).join('、') + '（請按「同步到表單」）');
  }

  // 品項：表單題目與「表單回應」欄位都要找得到
  var resp = nfSheet_(NF.SHEET_RESPONSES);
  var headers = resp.getRange(1, 1, 1, resp.getLastColumn()).getValues()[0];
  var cols = nfMapColumns_(headers, settings);
  var gridRows = (NF_CTX.meta && NF_CTX.meta.gridRows) || [];
  settings.items.forEach(function (it) {
    if (it.isBundle) {
      if (!(ids.bundles || {})[it.name] || !form.getItemById(ids.bundles[it.name])) problems.push('表單找不到套餐「' + it.name + '」（請按「同步到表單」）');
    } else if (gridRows.indexOf(it.name) < 0) {
      problems.push('單點表格沒有「' + it.name + '」（請按「同步到表單」）');
    }
    if (!cols.items.some(function (c) { return c.item.name === it.name; })) problems.push('「表單回應」找不到「' + it.name + '」的欄位');
  });
  ['method', 'name', 'phone', 'email', 'pickupDate', 'last5'].forEach(function (k) {
    if (cols[k] === undefined) problems.push('「表單回應」找不到「' + labels[k] + '」的欄位');
  });
  var plan = nfPlanFormSync_();
  if (plan.changes.length) problems.push('表單與「設定」不一致，請按「同步到表單」：' + plan.changes.join('；'));
  return { ok: problems.length === 0, problems: problems };
}

/**
 * 修正表單說明裡被試算表轉成日期字串的時間（例「Sat Dec 30 1899 16:00:00 GMT+0800 (台北標準時間)」→「16:00」）。
 * 只替換這種錯誤字串，Yw 改過的其他文案不動。
 */
function nfFixFormTimeTexts_() {
  var form = nfForm_();
  var re = /[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} 1899 (\d{2}:\d{2}):\d{2} GMT[+-]\d{4}(?: \([^)]*\))?/g;
  var fixed = 0;
  var d = form.getDescription();
  if (re.test(d)) { form.setDescription(d.replace(re, '$1')); fixed++; }
  form.getItems().forEach(function (it) {
    var h = it.getHelpText();
    re.lastIndex = 0;
    if (h && re.test(h)) { re.lastIndex = 0; it.setHelpText(h.replace(re, '$1')); fixed++; }
    re.lastIndex = 0;
  });
  return { fixed: fixed };
}
