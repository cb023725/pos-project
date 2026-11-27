/**
 * 建立新年度：試算表＋表單＋各分頁＋保護範圍＋觸發條件（WebPOS 年菜管理頁「建立 Google 試算表與表單」）
 *
 * 表單結構與文案沿用 2026 年（只替換年份、日期、價格、套餐組成、品項），題目：
 *   須知（同意）→［訂購頁面］套餐下拉 1～套餐上限、單點表格 1～單點上限 → 取貨方式（分支）
 *   → 訂購人姓名／電話／e-mail →［宅配資訊］收件人／電話／地址 →［來店自取］預計取貨日期
 *   →［匯款資訊］預計匯款帳號末五碼
 *
 * 每一題建立後記下 ID（YEAR_<env>:<year>.ids），之後送單、讀回應都優先用 ID 找題目，
 * Yw 修改說明文字、段落說明、圖片都不影響對應。題目名稱、選項、單點品名請不要改
 * （「檢查表單對應」會擋下對不上的情況）。
 */
function nfCreateYear_(p) {
  var env = p.env || 'prod';
  var year = String(p.year);
  if (nfProps_().getProperty(nfYearKey_(env, year))) {
    throw new Error(year + ' 年的試算表與表單已經建立過了（' + env + '）');
  }
  var folder = nfGetOrCreatePath_(p.folderPath || ['000GGE', '2. 年菜', year + (env === 'prod' ? ' 年菜' : ' 年菜測試')]);
  var title = year + ' 年菜訂單' + (env === 'prod' ? '' : '（測試）');

  // 1. 試算表：預設分頁改名為「設定」，寫入 WebPOS 傳來的品項與日期
  var ss = SpreadsheetApp.create(title);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  ss.getSheets()[0].setName(NF.SHEET_SETTINGS);
  NF_CTX = { key: nfYearKey_(env, year), env: env, year: year, meta: {}, ss: ss, form: null };
  nfEnsureSettingsSheet_();
  nfWriteSettingsFromWebpos_(p);
  var carried = nfCarryOverSettings_(env, year); // 生肖、去年的匯款資訊／小卡／店家資料
  var settings = nfReadSettings_();

  // 2. 表單
  var form = FormApp.create(year + ' 咕咕義小餐館年菜預購頁' + (env === 'prod' ? '' : '（測試）'));
  DriveApp.getFileById(form.getId()).moveTo(folder);
  NF_CTX.form = form;
  var ids = nfBuildForm_(form, settings);

  // 3. 連到試算表，回應分頁命名為「表單回應」
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();
  var respSheet = nfFindResponseSheet_(ss, form);
  respSheet.setName(NF.SHEET_RESPONSES);
  ss.setActiveSheet(respSheet);
  ss.moveActiveSheet(1);
  nfEnsureStatusColumn_(respSheet);
  nfEnsureEditedColumn_(respSheet);

  // 建立後是「測試中」：表單開放，可以真實送單測試；測試完畢由 WebPOS「正式上線」清空（nfGoLive_）
  var meta = { ssId: ss.getId(), formId: form.getId(), folderId: folder.getId(), ids: ids.ids, gridRows: ids.gridRows, createdAt: nfFormatTimestamp_(new Date()), live: false };
  NF_CTX.meta = meta;
  nfSaveMeta_(env, year, meta);

  // 4. 其他分頁、保護範圍、觸發條件
  nfBuildTabs_(settings);
  nfApplyProtections_();
  nfInstallTriggers_(ss);

  return {
    ok: true,
    spreadsheetUrl: ss.getUrl(),
    formUrl: form.getPublishedUrl(),
    formEditUrl: form.getEditUrl(),
    carriedFrom: carried.from,
    carriedKeys: carried.keys,
  };
}

/** 依路徑找資料夾（從我的雲端硬碟根目錄開始），沒有就建立；第一層在根目錄找不到時，再找整個雲端硬碟 */
function nfGetOrCreatePath_(names) {
  var folder = DriveApp.getRootFolder();
  names.forEach(function (name, i) {
    var it = folder.getFoldersByName(name);
    if (it.hasNext()) { folder = it.next(); return; }
    if (i === 0) { var any = DriveApp.getFoldersByName(name); if (any.hasNext()) { folder = any.next(); return; } }
    folder = folder.createFolder(name);
  });
  return folder;
}

function nfGetOrCreateFolder_(name) {
  var it = DriveApp.getRootFolder().getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(name);
}

function nfFindResponseSheet_(ss, form) {
  var formId = form.getId();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var url = sheets[i].getFormUrl();
    if (url && url.indexOf(formId) >= 0) return sheets[i];
  }
  // 少數情況 getFormUrl 還沒更新：取名稱像「表單回應 1」的分頁
  for (var j = 0; j < sheets.length; j++) {
    if (/表單回應|Form Responses/.test(sheets[j].getName())) return sheets[j];
  }
  throw new Error('找不到表單回應分頁');
}

function nfInstallTriggers_(ss) {
  var id = ss.getId();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getTriggerSourceId && t.getTriggerSourceId() === id) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('nfOnFormSubmit').forSpreadsheet(id).onFormSubmit().create();
  ScriptApp.newTrigger('nfOnEdit').forSpreadsheet(id).onEdit().create();
}

/** 表單文案（沿用 2026 年，只替換年份、日期、數字、品項） */
function nfFormTexts_(s) {
  var kv = s.kv;
  var bundle = s.items.filter(function (it) { return it.isBundle; })[0];
  var singles = s.items.filter(function (it) { return !it.isBundle; });
  var compLines = bundle ? bundle.composition.map(function (c) { return '    ・' + c.item.name; }).join('\n') : '';
  var singleLines = singles.map(function (it) { return '    ・' + it.name + (it.inBundle ? '' : '*'); }).join('\n');
  var line = '────────────────';
  var dates = s.pickupDates;
  var firstPick = dates.length ? nfFormDateLabel_(dates[0]) : '';
  var lastPick = dates.length ? nfFormDateLabel_(dates[dates.length - 1]) : '';
  var lastPickShort = lastPick.replace(/^\d{4}\//, '');
  var deadline = kv['預購截止日'] ? nfFormDateLabel_(nfIsoDate_(kv['預購截止日'])) : '';
  var fee = nfMoney_(s.shippingFee);
  var threshold = nfMoney_(s.freeThreshold);
  var bundlePrice = bundle ? nfMoney_(bundle.price) : '';
  var line_ = String(kv['LINE'] || '');
  var noBeef = '因應部分顧客不吃牛肉或年節不拜牛\n年菜套餐內容 不包含 紅燒牛腩筋\n若需加購紅燒牛腩筋請至單點區選擇';

  return {
    description: [
      String(kv['表單問候語'] || ''),
      '',
      '套餐菜單（六人份優惠價＄' + bundlePrice + '）',
      '五菜一湯：',
      compLines,
      '',
      noBeef,
      line,
      '單點菜單',
      '以下菜色可單點：',
      singleLines,
      line,
      '優惠活動',
      '✧ 訂購套餐或單筆訂購滿' + threshold + '元，加贈保冷袋一只 (限來店自取)',
      line,
      '冷凍宅配',
      '✧ 低溫運費：' + fee + '元',
      '✧ 訂購套餐 或 同地址消費滿' + threshold + '元享免運優惠 (限台灣本島)',
      line,
      '來店自取',
      '✧ 店取地址：' + (kv['店址'] || ''),
      line,
      '訂購諮詢',
      '✧ 聯絡電話：' + (kv['電話'] || ''),
      '✧ LINE官方〖' + line_ + '〗',
    ].join('\n'),
    notice: [
      '・預購截止日： ' + deadline,
      '    手工小量製作，數量有限·售完為止。',
      '    截止日前滿單將提前收單。',
      '',
      '・產品內容',
      '    年菜皆為冷凍調理包。',
      '    主廚精選多樣菜式、純手工耗時製作。',
      '    冷凍包皆為熟食且已調味，解凍加熱後即可食用。',
      '    酒香鮮蝦為生鮮白蝦，需自行加熱保留最佳口感。*',
      '',
      '・口味調整',
      '    主廚依多年經驗調整為大眾口味，',
      '    但個人的口味偏好及感受度不同，',
      '    若覺得味道偏鹹可加少量水；',
      '    覺得偏淡可多滾一下讓湯汁濃縮。',
      '    加水或加鹽建議少量多次調整',
      '',
      '・訂購方式',
      '    可自由選擇 套餐 或 單點。',
      '',
      '・宅配服務',
      '    低溫運費' + fee + '元',
      '    訂購套餐或同地址滿' + threshold + '元享免運優惠(限台灣本島)',
      '',
      '・付款方式',
      '    需先匯款完成才成立訂單製作。',
      '',
      '・出貨與取貨',
      '    寄件日期：',
      '    ' + String(kv['寄出期間'] || ''),
      '    年節物流繁忙，恕無法指定到貨日',
      '',
      '    店取日期：',
      '    ' + firstPick + '~' + lastPick,
      '    取貨時間：' + (kv['每日取貨時間'] || ''),
      '    ' + lastPickShort + ' 取貨時間只到 ' + (kv['最後取貨結束時間'] || ''),
      '',
      '・客服協助',
      '    如有訂購問題，歡迎加入官方LINE由專人服務：〖' + line_ + '〗',
    ].join('\n'),
    bundleHelp: [
      '年菜套餐為 6 人份配餐，如需 12 人份餐點請下 2 套，依此類推',
      '',
      '套餐內含 五菜一湯：',
      compLines,
      line,
      noBeef,
    ].join('\n'),
    singleSectionHelp: [
      '・如果套餐不夠，可以在此頁加購更多冷凍包',
      '・若不選套餐，或想自由搭配，請在此處單點',
      '・單筆訂購滿' + threshold + '元，加贈保冷袋一只 (限來店自取)',
    ].join('\n'),
    gridHelp: '如果套餐吃不夠，可以在此頁加購更多冷凍包喔～\n訂購更多請加入官方LINE〖' + line_ + '〗洽詢',
    emailHelp: '訂單確認\n訂單送出後，您將收到一封確認電子郵件。\n若未收到確認信，請加入官方LINE〖' + line_ + '〗確認訂單。',
    deliveryHelp: '宅配寄出日：' + (kv['寄出期間'] || '') + '\n年節物流繁忙，恕無法指定到貨日期。',
    pickupSectionHelp: '店取地址：' + (kv['店址'] || '') + '\n聯絡電話：' + (kv['電話'] || '') + '\nLINE官方〖' + line_ + '〗',
    pickupDateHelp: '請先填寫預計取貨日，以便我們準備好您的餐點。\n若需變更取貨日期，後續可再與我們聯繫。\n店取地址：' + (kv['店址'] || '') +
      '\n每日取貨時間：' + (kv['每日取貨時間'] || '') + '\n最後取貨日：\n' + lastPick + ' 除夕前一天，取貨時間至 ' + (kv['最後取貨結束時間'] || ''),
    // 2026 年列印版看不到這兩段的原文，先用簡單說明，請 Yw 在表單上修改
    remitSectionHelp: '需先匯款完成才成立訂單製作',
    remitHelp: '請填寫您預計匯款帳號的末五碼，方便我們核對款項。',
  };
}

function nfAddImage_(form, fileId) {
  if (!fileId) return;
  try {
    form.addImageItem().setImage(DriveApp.getFileById(String(fileId).trim()).getBlob());
  } catch (e) {
    console.error('插入圖片失敗（' + fileId + '）：' + e);
  }
}

function nfBuildForm_(form, s) {
  var t = nfFormTexts_(s);
  var ids = { bundles: {} };
  form.setDescription(t.description);
  form.setProgressBar(false);
  form.setCollectEmail(false);

  var consent = form.addMultipleChoiceItem().setTitle('咕咕義小餐館年菜訂購須知').setHelpText(t.notice).setRequired(true);
  consent.setChoiceValues(['我已詳閱、瞭解並同意上述訂購須知相關內容']);
  ids.consent = consent.getId();

  form.addPageBreakItem().setTitle('訂購頁面');
  nfAddImage_(form, s.kv['套餐圖片ID']);
  s.items.filter(function (it) { return it.isBundle; }).forEach(function (b) {
    var li = form.addListItem().setTitle(b.name + ' (' + b.price + '元)').setHelpText(t.bundleHelp);
    li.setChoiceValues(nfRange_(s.bundleMax));
    ids.bundles[b.name] = li.getId();
  });

  form.addSectionHeaderItem().setTitle('單點年菜').setHelpText(t.singleSectionHelp);
  nfAddImage_(form, s.kv['單點圖片ID']);
  var singles = s.items.filter(function (it) { return !it.isBundle; });
  var grid = form.addGridItem().setTitle(NF.GRID_TITLE).setHelpText(t.gridHelp);
  grid.setRows(singles.map(nfGridRowTitle_));
  grid.setColumns(nfRange_(s.singleMax));
  ids.grid = grid.getId();

  var method = form.addMultipleChoiceItem().setTitle('取貨方式').setRequired(true);
  ids.method = method.getId();
  ids.name = form.addTextItem().setTitle('訂購人姓名').setRequired(true).getId();
  ids.phone = form.addTextItem().setTitle('訂購人聯絡電話').setRequired(true).getId();
  var email = form.addTextItem().setTitle('訂購人e-mail').setHelpText(t.emailHelp).setRequired(true);
  email.setValidation(FormApp.createTextValidation().requireTextIsEmail().build());
  ids.email = email.getId();

  var deliveryPage = form.addPageBreakItem().setTitle('宅配資訊').setHelpText(t.deliveryHelp);
  ids.recipientName = form.addTextItem().setTitle('收件人').setRequired(true).getId();
  ids.recipientPhone = form.addTextItem().setTitle('收件人聯絡電話').setRequired(true).getId();
  ids.recipientAddress = form.addTextItem().setTitle('收件地址').setRequired(true).getId();

  var pickupPage = form.addPageBreakItem().setTitle('來店自取').setHelpText(t.pickupSectionHelp);
  var pickupDate = form.addListItem().setTitle('預計取貨日期').setHelpText(t.pickupDateHelp).setRequired(true);
  pickupDate.setChoiceValues(s.pickupDates.map(nfFormDateLabel_));
  ids.pickupDate = pickupDate.getId();

  var remitPage = form.addPageBreakItem().setTitle('匯款資訊').setHelpText(t.remitSectionHelp);
  ids.last5 = form.addTextItem().setTitle('預計匯款帳號末五碼').setHelpText(t.remitHelp).setRequired(true).getId();

  // 分支：宅配 → 宅配資訊；來店自取 → 來店自取；宅配資訊填完跳到匯款資訊（跳過來店自取）
  method.setChoices([
    method.createChoice('宅配', deliveryPage),
    method.createChoice('來店自取', pickupPage),
  ]);
  pickupPage.setGoToPage(remitPage); // 設在「來店自取」分頁上 = 前一段（宅配資訊）填完後跳到匯款資訊

  return { ids: ids, gridRows: singles.map(function (it) { return it.name; }) };
}

// 單點表格每一列：「[*]品名 (價格元)」（不在套餐裡、只能單點的加 *，沿用 2026 年寫法）
function nfGridRowTitle_(it) {
  return (it.inBundle ? '' : '*') + it.name + ' (' + it.price + '元)';
}

function nfRange_(n) {
  var out = [];
  for (var i = 1; i <= n; i++) out.push(String(i));
  return out;
}
