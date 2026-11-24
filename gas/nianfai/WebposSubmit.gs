/**
 * WebPOS 現場單 → 用 FormApp 送出同一份表單（handoff 第 2 節：不再人工輸入第二次）
 *
 * - 匯款末五碼填「現結＋流水號」（例：現結27001），送出前先找「表單回應」有沒有同一個，
 *   有就不重送（WebPOS 重試或網路重送都不會變兩筆）
 * - 題目一律依名稱對應；品項找不到題目就整筆失敗，請 Yw 先「同步到表單」
 * - 表單已關閉（停售／收單）時：暫時開啟 → 送出 → 立即關閉（只有 WebPOS 能在關閉後加單）
 * - 送出後表單的「提交時」觸發照常執行：寄確認信、檢查停售
 *
 * order：{ seqLabel, customerName, customerPhone, email, deliveryMethod: 'pickup'|'delivery',
 *          pickupDate: 'YYYY-MM-DD', recipientName, recipientPhone, recipientAddress,
 *          items: [{ id, name, qty }] }
 */
function nfSubmitWebposOrder_(order) {
  if (!order || !order.seqLabel) throw new Error('缺少流水號');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var last5 = NF.ONSITE_PREFIX + order.seqLabel;
    var dup = nfFindOnsiteRow_(last5);
    if (dup) return { ok: true, duplicate: true, timestamp: dup.timestampText };

    var settings = nfReadSettings_();
    var qtyByName = {};
    (order.items || []).forEach(function (it) {
      var q = parseInt(it.qty, 10);
      if (q > 0) qtyByName[it.name] = (qtyByName[it.name] || 0) + q;
    });
    var used = {};
    var email = String(order.email || '').trim() || NF.STORE_EMAIL;
    var isDelivery = order.deliveryMethod === 'delivery';

    var form = nfForm_();
    var resp = form.createResponse();
    form.getItems().forEach(function (item) {
      var title = String(item.getTitle() || '');
      var type = item.getType();
      var r = null;
      if (type === FormApp.ItemType.MULTIPLE_CHOICE) {
        var mc = item.asMultipleChoiceItem();
        var choices = mc.getChoices().map(function (c) { return c.getValue(); });
        if (title.indexOf('須知') >= 0) {
          r = mc.createResponse(choices[0]);
        } else if (title.indexOf('取貨方式') >= 0) {
          var want = choices.filter(function (c) { return isDelivery ? c.indexOf('宅配') >= 0 : c.indexOf('自取') >= 0; })[0];
          if (!want) throw new Error('表單「取貨方式」找不到' + (isDelivery ? '宅配' : '自取') + '選項');
          r = mc.createResponse(want);
        }
      } else if (type === FormApp.ItemType.LIST) {
        var li = item.asListItem();
        var opts = li.getChoices().map(function (c) { return c.getValue(); });
        if (title.indexOf('取貨日') >= 0) {
          if (!isDelivery) {
            var dateOpt = opts.filter(function (o) { return nfIsoDate_(o) === order.pickupDate; })[0];
            if (!dateOpt) throw new Error('表單取貨日沒有 ' + order.pickupDate + '，請先同步到表單');
            r = li.createResponse(dateOpt);
          }
        } else {
          var bundleName = nfParseItemTitle_(title);
          if (qtyByName[bundleName]) {
            var q = String(qtyByName[bundleName]);
            if (opts.indexOf(q) < 0) throw new Error('「' + bundleName + '」數量 ' + q + ' 超過表單選項，請送出後到表單回應修改');
            r = li.createResponse(q);
            used[bundleName] = true;
          }
        }
      } else if (type === FormApp.ItemType.GRID) {
        var gi = item.asGridItem();
        var cols = gi.getColumns();
        var any = false;
        var answers = gi.getRows().map(function (rowTitle) {
          var name = nfParseItemTitle_(rowTitle);
          var qty = qtyByName[name];
          if (!qty) return null;
          if (cols.indexOf(String(qty)) < 0) throw new Error('「' + name + '」數量 ' + qty + ' 超過表單選項，請送出後到表單回應修改');
          used[name] = true;
          any = true;
          return String(qty);
        });
        if (any) r = gi.createResponse(answers);
      } else if (type === FormApp.ItemType.TEXT || type === FormApp.ItemType.PARAGRAPH_TEXT) {
        var v = nfTextAnswer_(title, order, email, isDelivery, last5);
        if (v) r = type === FormApp.ItemType.TEXT ? item.asTextItem().createResponse(v) : item.asParagraphTextItem().createResponse(v);
      }
      if (r) resp.withItemResponse(r);
    });

    var missing = Object.keys(qtyByName).filter(function (n) { return !used[n]; });
    if (missing.length) throw new Error('表單找不到品項：' + missing.join('、') + '（請先「同步到表單」）');

    var wasAccepting = form.isAcceptingResponses();
    if (!wasAccepting) form.setAcceptingResponses(true);
    var submitted;
    try {
      submitted = resp.submit();
    } finally {
      if (!wasAccepting) form.setAcceptingResponses(false);
    }
    return { ok: true, duplicate: false, timestamp: nfFormatTimestamp_(submitted.getTimestamp()) };
  } finally {
    lock.releaseLock();
  }
}

function nfTextAnswer_(title, o, email, isDelivery, last5) {
  if (title.indexOf('末五碼') >= 0) return last5;
  if (title.indexOf('訂購人') >= 0 && title.indexOf('姓名') >= 0) return o.customerName;
  if (title.indexOf('訂購人') >= 0 && title.indexOf('電話') >= 0) return o.customerPhone;
  if (/e-?mail|電子郵件/i.test(title)) return email;
  if (!isDelivery) return '';
  if (title.indexOf('收件人') >= 0 && title.indexOf('電話') >= 0) return o.recipientPhone;
  if (title.indexOf('收件地址') >= 0) return o.recipientAddress;
  if (title.indexOf('收件人') === 0) return o.recipientName;
  return '';
}

function nfFindOnsiteRow_(last5) {
  var settings = nfReadSettings_();
  var data = nfReadResponses_();
  var cols = nfMapColumns_(data.headers, settings);
  if (cols.last5 === undefined) return null;
  for (var i = 0; i < data.rows.length; i++) {
    if (String(data.rows[i][cols.last5]).trim() === last5 && data.rows[i][cols.timestamp]) {
      return { rowNumber: i + 2, timestampText: nfFormatTimestamp_(data.rows[i][cols.timestamp]) };
    }
  }
  return null;
}
