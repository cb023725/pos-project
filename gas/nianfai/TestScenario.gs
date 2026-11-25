/**
 * 只限測試環境（dev）：用真實流程建立各種類型的訂單並寄出各階段的信，給 Yw 確認信件內容
 *
 *   testSubmit    送出一筆表單回應（線上單：onlineLast5；現場單：seqLabel），表單「提交時」觸發照正式流程寄確認信
 *   testStatus    查這筆訂單的確認信狀態（「表單回應」寄信狀態欄）
 *   testFollowUp  依時程寄後續的信：宅配先填出貨日、託運單號 → 寄出前確認 → 出貨通知；自取 → 取貨提醒
 *                 走正式的寄信程式（nfMailSend_），現場單會照規則跳過並回報原因
 */
function nfTestGuard_() {
  if (NF_CTX.env !== 'dev') throw new Error('只有測試環境可以使用');
}

function nfTestSubmit_(order) {
  nfTestGuard_();
  return nfSubmitWebposOrder_(order);
}

function nfTestStatus_(id) {
  nfTestGuard_();
  var data = nfReadResponses_();
  var cols = nfMapColumns_(data.headers, nfReadSettings_());
  for (var i = 0; i < data.rows.length; i++) {
    if (nfFormatTimestamp_(data.rows[i][0]) === id) {
      return { row: i + 2, confirm: cols.status !== undefined ? String(data.rows[i][cols.status] || '') : '' };
    }
  }
  return { row: null, confirm: '' };
}

function nfTestFollowUp_(id, ship) {
  nfTestGuard_();
  nfSyncOrderSheets_();
  var settings = nfReadSettings_();
  var all = nfReadOrderSheets_(nfSpreadsheet_(), settings);
  var kind = all.rows.delivery.some(function (r) { return r.id === id; }) ? 'delivery' : 'pickup';
  var out = { kind: kind, steps: [] };
  if (kind === 'delivery' && ship) {
    var sh = nfSheet_(NF.SHEET_DELIVERY);
    var defs = nfOrderCols_('delivery', settings);
    var r = all.rows.delivery.map(function (x) { return x.id; }).indexOf(id) + 2;
    sh.getRange(r, nfColIndex_(defs, 'shipDate')).setValue(ship.shipDate);
    sh.getRange(r, nfColIndex_(defs, 'trackNo')).setValue(ship.trackNo);
  }
  var types = kind === 'delivery' ? ['preShip', 'shipped'] : ['pickupReminder'];
  types.forEach(function (t) {
    var res = nfMailSend_(t, [id], null, {});
    var skip = res.skipped.filter(function (x) { return x.id === id; })[0];
    out.steps.push({ type: NF_MAIL_TYPES[t].label, sent: res.sent.length > 0, failed: res.failed.map(function (x) { return x.error; }), skipped: skip ? skip.reason : '' });
    Utilities.sleep(2000); // 讓信件依時程順序到達
  });
  return out;
}

/** 清掉這個年度所有的開信／客人確認紀錄（之前被信箱掃描誤記的「已開信」、測試按過的確認） */
function nfTestClearOpened_() {
  nfTestGuard_();
  var prefix = 'ML_' + NF_CTX.env + ':' + NF_CTX.year + ':';
  var props = nfProps_(), n = 0;
  Object.keys(props.getProperties()).forEach(function (k) {
    if (k.indexOf(prefix) !== 0) return;
    var st = JSON.parse(props.getProperty(k));
    Object.keys(st).forEach(function (t) { if (st[t].openedAt || st[t].ackAt) { delete st[t].openedAt; delete st[t].ackAt; n++; } });
    props.setProperty(k, JSON.stringify(st));
  });
  nfSyncOrderSheets_();
  return { cleared: n };
}

/** 排查用：讀某個分頁某格的原始值、型別、格式、驗證 */
function nfTestCell_(sheet, a1) {
  nfTestGuard_();
  var rg = nfSheet_(sheet).getRange(a1);
  var v = rg.getValue(), dv = rg.getDataValidation();
  return { value: String(v), type: typeof v, format: rg.getNumberFormat(), validation: dv ? String(dv.getCriteriaType()) : null };
}

function nfTestFormat_(sheet, a1, fmt) {
  nfTestGuard_();
  var rg = nfSheet_(sheet).getRange(a1);
  var out = { before: rg.getNumberFormat() };
  try { rg.setNumberFormat(fmt); SpreadsheetApp.flush(); out.after = rg.getNumberFormat(); } catch (e) { out.error = String(e); }
  return out;
}

/** 測試用：某筆訂單某種信的確認連結（和信裡的一樣） */
function nfTestConfirmUrl_(id, type) {
  nfTestGuard_();
  nfSyncOrderSheets_();
  var all = nfReadOrderSheets_(nfSpreadsheet_(), nfReadSettings_());
  var row = all.rows.delivery.concat(all.rows.pickup).filter(function (r) { return r.id === id; })[0];
  if (!row) throw new Error('找不到訂單 ' + id);
  return nfConfirmUrl_(row, type);
}
