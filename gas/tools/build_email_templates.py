#!/usr/bin/env python3
"""
產生年菜 5 封信的 HTML 範本（gas/nianfai/*.html），全部使用 2026 年「出貨通知」「取貨提醒」的樣式：
白底卡片、問候區、紅條「訂購明細」、藍條資訊區、頁尾 logo＋社群＋店家資訊。

  ConfirmPickup / ConfirmDelivery   確認信（表單送出時，Confirm.gs）
  PreShip                           寄出前確認（Mail.gs）
  Shipped                           出貨通知
  PickupReminder                    取貨提醒

文案以 2026 年為底，每句盡量控制在 16～18 字、長短一致，手機上不會斷成兩行。
年份、日期、祝賀語、時段、店家電話／地址／地圖連結／LINE、匯款資訊由程式帶入（讀「設定」），範本裡不放匯款帳號。
要改樣式或文案請改這支程式再執行：
  python3 gas/tools/build_email_templates.py
"""
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'nianfai'

RED, BLUE, AMBER, GREEN = '#d32f2f', '#2A52BE', '#f59e0b', '#4A9A7A'
BRAND = '#C1032F'  # logo 紅（按鈕）
LOGO = 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/945a049c-4a56-d37c-288c-e12771643211.png'
SOCIAL = [
    ('https://www.facebook.com/bistrogoodgoodeat/', 'https://app-rsrc.getbee.io/public/resources/social-networks-icon-sets/t-only-logo-default-gray/facebook@2x.png', 'Facebook'),
    ('https://www.instagram.com/goodgoodeatrestaurant/', 'https://app-rsrc.getbee.io/public/resources/social-networks-icon-sets/t-only-logo-default-gray/instagram@2x.png', 'Instagram'),
    ('<?= data.line ?>', 'https://app-rsrc.getbee.io/public/resources/social-networks-icon-sets/t-only-logo-default-gray/line@2x.png', 'LINE'),
]
MAP = '<?= data.mapUrl ?>'  # 「設定」的地圖連結（Google 商家資訊）


def lines(*ls):
    """問候區：一句一行"""
    return '<br>\n'.join('        ' + l for l in ls)


def page(title, greeting, body):
    social = ''.join(
        f'<td style="padding: 0 8px;"><a href="{href}" target="_blank"><img src="{img}" width="24" height="auto" alt="{alt}" title="{alt}" style="display: block; height: auto; border: 0;"></a></td>'
        for href, img, alt in SOCIAL)
    return f'''<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
  <meta name="x-apple-disable-message-reformatting">
  <title>{title}</title>
  <style>
    a[x-apple-data-detectors] {{ color: inherit !important; text-decoration: none !important; font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important; }}
    body {{ font-family: "Microsoft JhengHei", "PingFang TC", "Heiti TC", sans-serif; color: #333; line-height: 1.5; }}
  </style>
</head>
<!-- 由 gas/tools/build_email_templates.py 產生，要改樣式或文案請改產生器再重新產生 -->
<body style="margin: 0; padding: 10px; background-color: #f9f9f9;">
  <div style="max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; padding: 25px; border-radius: 8px; background-color: #ffffff;">

    <div style="margin-bottom: 14px; font-size: 14px;">
      <span style="font-weight: bold; color: #000;"><?= data.name ?></span> 先生/小姐你好：<br><br>
      <div style="font-size: 13px; color: #444; line-height: 1.8;">
{greeting}
      </div>
    </div>
{body}
    <div style="margin-top: 20px; text-align: center;">
      <div><a href="{MAP}" target="_blank"><img src="{LOGO}" width="200" height="auto" alt="咕咕義小餐館" style="display: inline-block; border: 0;"></a></div>
      <div style="display: inline-block; opacity: 0.6; margin-top: -5px;">
        <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin: 0 auto;"><tr>{social}</tr></table>
      </div>
      <div style="color: #b2b2b2; font-size: 10px; line-height: 1.5; text-align: center; margin-top: 5px; padding: 0 22px;">
        <p style="margin: 0;">聯絡電話：<?= data.storePhone ?></p>
        <p style="margin: 0;">地址：<a href="{MAP}" target="_blank" style="text-decoration: underline; color: #969696;"><?= data.storeAddress ?></a></p>
        <p style="margin: 0;">© Copyright <?= data.year ?>. 咕咕義小餐館. All Rights Reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>
'''


def section(title, color, inner, boxed=False):
    box = ('background-color: #fcfcfc; border: 1px solid #f0f0f0; border-radius: 8px; padding: 5px 10px; margin-bottom: 10px;' if boxed
           else 'border: 1px solid #f0f0f0; border-radius: 8px; padding: 5px; margin-bottom: 10px;')
    return f'''
    <h3 style="color: #333; font-size: 15px; margin-top: 30px; margin-bottom: 12px; letter-spacing: 1px; border-left: 8px solid {color}; padding-left: 10px;">{title}</h3>
    <div style="{box}">
{inner}
    </div>
'''


def info_rows(rows):
    """rows: [(標籤, 值 HTML)]"""
    out = []
    for i, (label, value) in enumerate(rows):
        border = '' if i == len(rows) - 1 else ' style="border-bottom: 1px solid #f0f0f0;"'
        out.append(f'''        <tr{border}>
          <td style="border: none; padding: 8px 0; width: 80px; color: #888; font-size: 12px; vertical-align: top;">{label}</td>
          <td style="border: none; padding: 8px 0; color: #333; font-size: 12px; font-weight: bold; line-height: 1.5;">{value}</td>
        </tr>''')
    return '      <table style="width: 100%; border-collapse: collapse; border: none; margin: 0;">\n' + '\n'.join(out) + '\n      </table>'


def nb(text):
    """不讓這段文字中間斷行（句尾用，避免換行後一行只剩一兩個字或標點）"""
    return f'<span style="white-space: nowrap;">{text}</span>'


# 取貨時段：最後一天（除夕前一天）結束時間用紅字，和注意事項的紅字一致
HOURS = ('<? if (data.isLastDay) { ?><?= String(data.pickupHours).split(" - ")[0] ?> - '
         '<span style="color: #d32f2f; font-weight: bold;"><?= String(data.pickupHours).split(" - ")[1] ?></span>'
         '<? } else { ?><?= data.pickupHours ?><? } ?>')


def notes(items):
    """注意事項：一點一段（不加項目符號），段落之間留空隙。
    items 可以是字串，或 (條件, 字串)：條件是範本 JS 運算式，成立才顯示。
    每點的句尾自己用 nb() 包起來，換行時不會只剩一兩個字。"""
    rows = []
    for it in items:
        cond, text = (it if isinstance(it, tuple) else (None, it))
        # 逗號處才斷行：每個子句不拆開，放不下就整句換到下一行
        parts = text.split('，')
        text = '，'.join(nb(p) for p in parts[:-1]) + ('，' if len(parts) > 1 else '') + nb(parts[-1])
        row = f'        <tr><td style="padding: 6px 6px; vertical-align: top; font-size: 12px; color: #444; line-height: 1.45;">{text}</td></tr>'
        rows.append(f'        <? if ({cond}) {{ ?>\n{row}\n        <? }} ?>' if cond else row)
    return ('      <table style="width: 100%; border-collapse: collapse; border: none;">\n'
            + '\n'.join(rows) + '\n      </table>')


TH = 'padding: 8px 5px; font-size: 12px; color: #666; font-weight: bold; letter-spacing: 1px; border: none;'
TD = 'padding: 8px 5px; vertical-align: top; border: none;'
SUBS = '''              <? if ({subs}) {{ ?>
                <div style="border-left: 1px solid #e5e5e5; margin-left: 1px; padding-left: 6px; margin-top: 4px;">
                  <? var subItems = {subs}.split('、'); for (var k = 0; k < subItems.length; k++) {{ ?>
                    <div style="font-size: 11px; color: #999; margin-bottom: 2px; line-height: 1.3; white-space: nowrap;"><?= subItems[k] ?></div>
                  <? }} ?>
                </div>
              <? }} ?>'''

# 訂購明細最上方：現場單顯示訂購編號，線上單顯示訂單時間（每封信的訂購明細都一定有其中一個）
def order_ref(time_field):
    return f'''      <div style="padding: 8px 5px 10px; font-size: 12px; color: #666; border-bottom: 1px solid #f0f0f0; margin-bottom: 4px;">
        <? if (data.isOnsite && data.seqLabel) {{ ?>
        訂購編號：<span style="color: {BLUE}; font-weight: bold;"><?= data.seqLabel ?></span>
        <? }} else {{ ?>
        訂單時間：<span style="color: {BLUE}; font-weight: bold;"><?= {time_field} ?></span>
        <? }} ?>
      </div>
'''


# 出貨通知／取貨提醒／寄出前確認：品項＋數量，共計 N 件
ITEMS_QTY = order_ref('data.orderTime') + f'''      <table style="width: 100%; border-collapse: collapse; border: none;">
        <thead>
          <tr style="background-color: #f8f8f8;">
            <th style="{TH} text-align: left; border-radius: 4px 0 0 4px;">品項名稱</th>
            <th style="{TH} width: 75px; text-align: center; border-radius: 0 4px 4px 0;">數量</th>
          </tr>
        </thead>
        <tbody>
          <? for (var i = 0; i < data.items.length; i++) {{ ?>
          <tr style="border-bottom: 1px solid #f6f6f6;">
            <td style="{TD}">
              <div style="font-size: 12px; color: #333; font-weight: bold; line-height: 1.2;"><?= data.items[i].name ?></div>
{SUBS.format(subs='data.items[i].sub')}
            </td>
            <td style="{TD} text-align: center; font-size: 12px; color: #333; font-weight: bold;"><?= data.items[i].qty ?></td>
          </tr>
          <? }} ?>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2" style="padding: 12px 18px 12px 12px; text-align: right; font-size: 12px; color: #999; border: none;">
              共計 <span style="color: #333; font-weight: bold; margin-left: 3px;"><?= data.totalCount ?></span> 件商品
            </td>
          </tr>
        </tfoot>
      </table>'''

# 確認信：同樣顯示訂單時間（線上）或訂購編號（WebPOS 現場單）
ORDER_REF = order_ref('data.timestamp').rstrip('\n')


def items_amount(with_shipping):
    """確認信：品項＋數量＋金額（不列單價），運費、總金額"""
    # 運費為 0（滿額免運）時不顯示這一列
    ship = f'''          <? if (data.shippingText && data.shippingText !== '0') {{ ?>
          <tr>
            <td colspan="2" style="padding: 8px 5px; text-align: right; font-size: 12px; color: #999; border: none;">運費</td>
            <td style="padding: 8px 5px; text-align: right; font-size: 12px; color: #333; border: none;">$<?= data.shippingText ?></td>
          </tr>
          <? }} ?>
''' if with_shipping else ''
    return ORDER_REF + f'''
      <table style="width: 100%; border-collapse: collapse; border: none;">
        <thead>
          <tr style="background-color: #f8f8f8;">
            <th style="{TH} text-align: left; border-radius: 4px 0 0 4px;">品項名稱</th>
            <th style="{TH} width: 50px; text-align: center;">數量</th>
            <th style="{TH} width: 75px; text-align: right; border-radius: 0 4px 4px 0;">金額</th>
          </tr>
        </thead>
        <tbody>
          <? for (var i = 0; i < data.items.length; i++) {{ var it = data.items[i]; ?>
          <tr style="border-bottom: 1px solid #f6f6f6;">
            <td style="{TD}">
              <div style="font-size: 12px; color: #333; font-weight: bold; line-height: 1.3;"><?= it.label ?></div>
{SUBS.format(subs='it.subs')}
            </td>
            <td style="{TD} text-align: center; font-size: 12px; color: #333; font-weight: bold;"><?= it.qty ?></td>
            <td style="{TD} text-align: right; font-size: 12px; color: #333; font-weight: bold;">$<?= it.amountText ?></td>
          </tr>
          <? }} ?>
        </tbody>
        <tfoot>
{ship}          <tr>
            <td colspan="2" style="padding: 10px 5px; text-align: right; font-size: 13px; color: #333; font-weight: bold; border: none;">總金額</td>
            <td style="padding: 10px 5px; text-align: right; font-size: 15px; color: {RED}; font-weight: bold; border: none;">$<?= data.totalText ?></td>
          </tr>
        </tfoot>
      </table>'''


def blue(v):
    return f'<span style="color: {BLUE}; font-weight: bold;">{v}</span>'


def map_link(v):
    return f'<a href="{MAP}" target="_blank" style="color: #333; text-decoration: underline;">{v}</a>'


ADD_BUTTON = f'''
    <div style="text-align: center; margin: 20px 0 6px;">
      <a href="<?= data.formUrl ?>" target="_blank" style="background-color: {BRAND}; border-radius: 28px; color: #ffffff; display: inline-block; font-size: 14px; font-weight: bold; letter-spacing: 1px; padding: 9px 30px; text-decoration: none;">我要加購年菜</a>
    </div>
'''

# 匯款資訊：現場單已在店內付清，不顯示
BANK = '\n    <? if (!data.isOnsite) { ?>' + section('匯款資訊', GREEN, info_rows([
    ('戶名', '<?= data.bankHolder ?>'),
    ('銀行名稱', '<?= data.bankName ?>'),
    ('分行名稱', '<?= data.bankBranch ?>'),
    ('匯款帳號', '<?= data.bankAccount ?>'),
]), boxed=True) + '    <? } ?>\n'

LINE_LINK = f'<a href="<?= data.line ?>" target="_blank" style="color: {BLUE}; font-weight: bold;">官方 LINE</a>'
PAY_NOTES = [
    ('!data.isOnsite', f'預購商品需付款完成才算訂購成功，尚未付款請轉帳至下方{nb("匯款帳號。")}'),
    ('!data.isOnsite', f'<strong>修改訂單</strong>或<strong>確認匯款狀態</strong>，{nb("請加入" + LINE_LINK + "洽詢。")}'),
    ('data.isOnsite', f'<strong>修改訂單</strong>，{nb("請加入" + LINE_LINK + "洽詢。")}'),
]


def ack_button(text):
    """客人確認按鈕：點一下送出「年菜確認」表單並顯示感謝畫面，工作表顯示「已確認」"""
    return f'''
    <div style="text-align: center; margin: 24px 0 4px;">
      <a href="<?= data.ackUrl ?>" target="_blank" style="background-color: {BRAND}; border-radius: 28px; color: #ffffff; display: inline-block; font-size: 14px; font-weight: bold; letter-spacing: 1px; padding: 10px 30px; text-decoration: none;">{text}</a>
      <div style="font-size: 11px; color: #999; margin-top: 8px;">按下按鈕讓我們知道您已收到這封信</div>
    </div>
'''


def confirm(delivery):
    greeting = lines(
        '感謝您訂購咕咕義 <strong style="font-weight: 700; color: #000;"><?= data.year ?> 新春年菜</strong>',
        '這封信是您的訂購證明，請妥善保存',
    )
    if delivery:
        info = section('配送資訊', BLUE, info_rows([
            ('取貨方式', '<?= data.method ?>'),
            ('寄出日期', '<?= data.shipPeriodShort ?>'),
            ('收件姓名', '<?= data.recipientName ?>'),
            ('收件電話', '<?= data.recipientPhone ?>'),
            ('收件地址', '<?= data.recipientAddress ?>'),
        ]), boxed=True)
        first = [f'宅配統一於 <?= data.shipPeriodShort ?> 寄出，年節物流繁忙，{nb("恕無法指定到貨日期。")}']
    else:
        info = section('取貨資訊', BLUE, info_rows([
            ('取貨方式', '<?= data.method ?>'),
            ('取貨日期', '<?= data.pickupDate ?>'),
            ('取貨時段', HOURS),
            ('取貨地點', map_link('<?= data.storeAddress ?>')),
        ]), boxed=True)
        # 每日取貨時段已寫在「取貨資訊」；除夕前一天提早結束的提醒只在最後一天取貨的訂單出現（紅字）
        first = [
            f'請依指定的取貨日期前往取貨，如需變更取貨日請{nb("提前通知我們備貨。")}',
            ('data.isLastDay', f'除夕前一天取貨時間只到 <span style="color: {RED}; font-weight: bold;"><?= data.lastPickupEnd ?></span>。'),
        ]
    body = (section('訂購明細', RED, items_amount(delivery)) + info
            + section('注意事項', AMBER, notes(first + PAY_NOTES)) + ADD_BUTTON + BANK)
    return page('<?= data.year ?> 新春年菜訂單', greeting, body)


def pre_ship():
    greeting = lines(
        '感謝您訂購咕咕義冷凍年菜料理包',
        f'年菜將於 {blue("<?= data.shipPeriodShort ?>")} 寄出',
        '寄出前請確認以下配送資訊是否正確',
    )
    body = (section('訂購明細', RED, ITEMS_QTY) + section('配送資訊', BLUE, info_rows([
        ('收件姓名', '<?= data.receiverName ?>'),
        ('收件電話', '<?= data.receiverPhone ?>'),
        ('收件地址', '<?= data.receiverAddress ?>'),
    ]), boxed=True)
        + section('注意事項', AMBER, notes([
            f'年菜由黑貓低溫宅配，寄出後約 <strong>1~3</strong> 天送達，實際仍以{nb("物流配送為準。")}',
            f'春節期間物流較繁忙，無法指定{nb("到貨日期與時段。")}',
            f'若近期有<strong>出國計畫</strong>或<strong>不便收貨</strong>，請盡快告知我們{nb("調整出貨日期。")}',
        ]))
        + ack_button('配送資訊正確，我已確認')
        + '''
    <p style="color: #d9534f; font-weight: bold; font-size: 14px; text-align: center; margin: 24px 0 0;">預祝 新年快樂，<?= data.greeting ?>！</p>
''')
    return page('冷凍年菜宅配寄出前確認', greeting, body)


def shipped():
    greeting = lines(
        f'您的年菜已於 {blue("<?= data.shipDate ?>")} 低溫宅配寄出',
        '收到商品請確認品項及數量正確無誤',
        '如商品有任何問題請即時與我們聯絡',
        '商品存放及加熱方式請參考附件小卡',
        '<strong>咕咕義小餐館</strong>感謝您的訂購與支持！',
    )
    track = (f'<a href="https://www.t-cat.com.tw/inquire/trace.aspx?no=<?= data.trackingNo ?>" target="_blank" '
             f'style="color: {BLUE}; font-weight: bold; text-decoration: none; border-bottom: 1px solid {BLUE};"><?= data.trackingNo ?></a>'
             f'<span style="font-weight: normal; color: #999; font-size: 11px;">（點擊查詢黑貓配送進度）</span>')
    body = section('訂購明細', RED, ITEMS_QTY) + section('配送資訊', BLUE, info_rows([
        ('收件姓名', '<?= data.receiverName ?>'),
        ('收件電話', '<?= data.receiverPhone ?>'),
        ('收件地址', '<?= data.receiverAddress ?>'),
        ('託運單號', track),
    ]), boxed=True) + ack_button('我已收到出貨通知')
    return page('冷凍年菜寄出通知', greeting, body)


def pickup_reminder():
    greeting = lines(
        '您的年菜已準備完成，歡迎來店取貨',
        f'您預定的取貨日期：{blue("<?= data.shipDate ?>")}',
        '取貨請帶白色訂購單據或此畫面截圖',
        '如需變更取貨日請提前告知我們備貨',
        '<strong>咕咕義小餐館</strong>感謝您的訂購與支持！',
    )
    body = section('訂購明細', RED, ITEMS_QTY) + section('取貨資訊', BLUE, info_rows([
        ('取貨日期', '<?= data.shipDate ?>'),
        ('取貨時段', HOURS),
        ('取貨地點', map_link('<?= data.storeAddress ?>')),
    ]), boxed=True) + ack_button('我已收到取貨提醒')
    return page('冷凍年菜取貨提醒', greeting, body)


def main():
    files = {
        'ConfirmPickup.html': confirm(False),
        'ConfirmDelivery.html': confirm(True),
        'PreShip.html': pre_ship(),
        'Shipped.html': shipped(),
        'PickupReminder.html': pickup_reminder(),
    }
    for name, html in files.items():
        (OUT / name).write_text(html, encoding='utf-8')
        print('寫入', OUT / name)


if __name__ == '__main__':
    main()
