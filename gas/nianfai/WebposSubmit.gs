/**
 * WebPOS 現場單 → 用 FormApp 送出同一份表單（handoff 第 2 節：不再人工輸入第二次）
 *
 * - 匯款末五碼填「現結＋訂購編號」（例：現結27261205001＝2027 年菜、2026/12/05 出單、第 1 號）
 * - 防重複用 WebPOS 訂單編號（指令碼屬性 SUB_<env>:<year>:<orderId>）：同一張訂單重送直接回報已送出；
 *   「表單回應」已經有同一個「現結流水號」但不是這張訂單 → 明確回報錯誤（例如測試資料清空後流水號
 *   重新開始），不會默默跳過
 * - 題目一律依名稱對應；品項找不到題目就整筆失敗，請 Yw 先「同步到表單」
 * - 表單已關閉（停售／收單）時：暫時開啟 → 送出 → 立即關閉（只有 WebPOS 能在關閉後加單）
 * - 送出後表單的「提交時」觸發照常執行：寄確認信、檢查停售
 *
 * order：{ seqLabel, customerName, customerPhone, email, deliveryMethod: 'pickup'|'delivery',
 *          pickupDate: 'YYYY-MM-DD', recipientName, recipientPhone, recipientAddress,
 *          items: [{ id, name, qty }] }
 */
function nfSubmitWebposOrder_(order) {
  // order.onlineLast5：只限測試（TestScenario.gs），模擬客人在表單上填寫的線上單
  if (!order || (!order.seqLabel && !order.onlineLast5)) throw new Error('缺少流水號');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var last5 = order.onlineLast5 ? String(order.onlineLast5) : NF.ONSITE_PREFIX + order.seqLabel;
    var subKey = order.orderId ? 'SUB_' + NF_CTX.env + ':' + NF_CTX.year + ':' + order.orderId : null;
    var prev = subKey ? nfProps_().getProperty(subKey) : null;
    if (prev) return { ok: true, duplicate: true, timestamp: prev };
    var dup = order.onlineLast5 ? null : nfFindOnsiteRow_(last5);
    if (dup) {
      if (!subKey) return { ok: true, duplicate: true, timestamp: dup.timestampText }; // 舊版 WebPOS 沒帶訂單編號
      throw new Error('表單回應第 ' + dup.rowNumber + ' 列已經有「' + last5 + '」，但不是這張訂單（可能是測試資料清空後流水號重新開始），請先處理那一列');
    }

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
    var roles = nfItemRoles_(form);
    form.getItems().forEach(function (item) {
      var role = roles[item.getId()];
      if (!role) return;
      var type = item.getType();
      var r = null;
      if (role.kind === 'consent') {
        var cc = item.asMultipleChoiceItem();
        r = cc.createResponse(cc.getChoices()[0].getValue());
      } else if (role.kind === 'method') {
        var mc = item.asMultipleChoiceItem();
        var choices = mc.getChoices().map(function (c) { return c.getValue(); });
        var want = choices.filter(function (c) { return isDelivery ? c.indexOf('宅配') >= 0 : c.indexOf('自取') >= 0; })[0];
        if (!want) throw new Error('表單「取貨方式」找不到' + (isDelivery ? '宅配' : '自取') + '選項');
        r = mc.createResponse(want);
      } else if (role.kind === 'pickupDate') {
        if (!isDelivery) {
          var li = item.asListItem();
          var dateOpt = li.getChoices().map(function (c) { return c.getValue(); })
            .filter(function (o) { return nfIsoDate_(o) === order.pickupDate; })[0];
          if (!dateOpt) throw new Error('表單取貨日沒有 ' + order.pickupDate + '，請先同步到表單');
          r = li.createResponse(dateOpt);
        }
      } else if (role.kind === 'bundle') {
        if (qtyByName[role.name]) {
          var bl = item.asListItem();
          var q = String(qtyByName[role.name]);
          if (bl.getChoices().map(function (c) { return c.getValue(); }).indexOf(q) < 0) {
            throw new Error('「' + role.name + '」數量 ' + q + ' 超過表單選項，請送出後到表單回應修改');
          }
          r = bl.createResponse(q);
          used[role.name] = true;
        }
      } else if (role.kind === 'grid') {
        var gi = item.asGridItem();
        var cols = gi.getColumns();
        var any = false;
        var answers = gi.getRows().map(function (rowTitle, idx) {
          var name = (role.rows && role.rows[idx]) || nfParseItemTitle_(rowTitle);
          var qty = qtyByName[name];
          if (!qty) return null;
          if (cols.indexOf(String(qty)) < 0) throw new Error('「' + name + '」數量 ' + qty + ' 超過表單選項，請送出後到表單回應修改');
          used[name] = true;
          any = true;
          return String(qty);
        });
        if (any) r = gi.createResponse(answers);
      } else if (role.kind === 'text') {
        var v = nfTextValue_(role.field, order, email, isDelivery, last5);
        if (v) r = type === FormApp.ItemType.PARAGRAPH_TEXT ? item.asParagraphTextItem().createResponse(v) : item.asTextItem().createResponse(v);
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
    var tsText = nfFormatTimestamp_(submitted.getTimestamp());
    if (subKey) nfProps_().setProperty(subKey, tsText);
    return { ok: true, duplicate: false, timestamp: tsText };
  } finally {
    lock.releaseLock();
  }
}

// 每一題的角色：優先用建立表單時記下的 ID，沒有 ID 資料（例如舊表單）才用題目名稱判斷
function nfItemRoles_(form) {
  var roles = {};
  var ids = NF_CTX && NF_CTX.meta && NF_CTX.meta.ids;
  if (ids) {
    if (ids.consent) roles[ids.consent] = { kind: 'consent' };
    if (ids.method) roles[ids.method] = { kind: 'method' };
    if (ids.pickupDate) roles[ids.pickupDate] = { kind: 'pickupDate' };
    if (ids.grid) roles[ids.grid] = { kind: 'grid', rows: NF_CTX.meta.gridRows || [] };
    Object.keys(ids.bundles || {}).forEach(function (name) { roles[ids.bundles[name]] = { kind: 'bundle', name: name }; });
    ['name', 'phone', 'email', 'recipientName', 'recipientPhone', 'recipientAddress', 'last5'].forEach(function (k) {
      if (ids[k]) roles[ids[k]] = { kind: 'text', field: k };
    });
    return roles;
  }
  form.getItems().forEach(function (item) {
    var t = String(item.getTitle() || '');
    var type = item.getType();
    var id = item.getId();
    if (type === FormApp.ItemType.MULTIPLE_CHOICE) {
      if (t.indexOf('須知') >= 0) roles[id] = { kind: 'consent' };
      else if (t.indexOf('取貨方式') >= 0) roles[id] = { kind: 'method' };
    } else if (type === FormApp.ItemType.LIST) {
      roles[id] = t.indexOf('取貨日') >= 0 ? { kind: 'pickupDate' } : { kind: 'bundle', name: nfParseItemTitle_(t) };
    } else if (type === FormApp.ItemType.GRID) {
      roles[id] = { kind: 'grid', rows: [] };
    } else if (type === FormApp.ItemType.TEXT || type === FormApp.ItemType.PARAGRAPH_TEXT) {
      var f = t.indexOf('末五碼') >= 0 ? 'last5'
        : (t.indexOf('訂購人') >= 0 && t.indexOf('姓名') >= 0) ? 'name'
        : (t.indexOf('訂購人') >= 0 && t.indexOf('電話') >= 0) ? 'phone'
        : /e-?mail|電子郵件/i.test(t) ? 'email'
        : (t.indexOf('收件人') >= 0 && t.indexOf('電話') >= 0) ? 'recipientPhone'
        : t.indexOf('收件地址') >= 0 ? 'recipientAddress'
        : t.indexOf('收件人') === 0 ? 'recipientName' : null;
      if (f) roles[id] = { kind: 'text', field: f };
    }
  });
  return roles;
}

function nfTextValue_(field, o, email, isDelivery, last5) {
  switch (field) {
    case 'last5': return last5;
    case 'name': return o.customerName;
    case 'phone': return o.customerPhone;
    case 'email': return email;
    case 'recipientName': return isDelivery ? o.recipientName : '';
    case 'recipientPhone': return isDelivery ? o.recipientPhone : '';
    case 'recipientAddress': return isDelivery ? o.recipientAddress : '';
    default: return '';
  }
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
