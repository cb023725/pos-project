#!/usr/bin/env python3
"""
產生年菜 5 封信的 HTML 範本（gas/nianfai/*.html），全部使用 2026 年「出貨通知」「取貨提醒」的樣式：
白底卡片、問候區、紅條「訂購明細」、藍條資訊區、頁尾 logo＋社群＋店家資訊。

  ConfirmPickup / ConfirmDelivery   確認信（表單送出時，Confirm.gs）
  PreShip                           寄出前確認（Mail.gs）
  Shipped                           出貨通知
  PickupReminder                    取貨提醒

文案沿用 2026 年；年份、日期、祝賀語、時段、店家電話／地址／LINE、匯款資訊由程式帶入（讀「設定」），
範本裡不放匯款帳號。要改樣式或文案請改這支程式再執行：
  python3 gas/tools/build_email_templates.py
"""
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'nianfai'

RED, BLUE, AMBER, GREEN = '#d32f2f', '#2A52BE', '#f59e0b', '#4A9A7A'
LOGO = 'https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/945a049c-4a56-d37c-288c-e12771643211.png'
SOCIAL = [
    ('https://www.facebook.com/bistrogoodgoodeat/', 'https://app-rsrc.getbee.io/public/resources/social-networks-icon-sets/t-only-logo-default-gray/facebook@2x.png', 'Facebook'),
    ('https://www.instagram.com/goodgoodeatrestaurant/', 'https://app-rsrc.getbee.io/public/resources/social-networks-icon-sets/t-only-logo-default-gray/instagram@2x.png', 'Instagram'),
    ('<?= data.line ?>', 'https://app-rsrc.getbee.io/public/resources/social-networks-icon-sets/t-only-logo-default-gray/line@2x.png', 'LINE'),
]
MAP = 'https://www.google.com/maps/search/?api=1&amp;query=<?= encodeURIComponent(data.storeAddress) ?>'


def page(title, greeting, body):
    social = ''.join(
        f'<td style="padding: 0 8px;"><a href="{href}" target="_blank"><img src="{img}" width="24" height="auto" alt="{alt}" title="{alt}" style="display: block; height: auto; border: 0;"></a></td>'
        for href, img, alt in SOCIAL)
    return f'''<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <style>
    body {{ font-family: "Microsoft JhengHei", "PingFang TC", "Heiti TC", sans-serif; color: #333; line-height: 1.5; }}
  </style>
</head>
<!-- 由 gas/tools/build_email_templates.py 產生，要改樣式或文案請改產生器再重新產生 -->
<body style="margin: 0; padding: 10px; background-color: #f9f9f9;">
  <div style="max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; padding: 25px; border-radius: 8px; background-color: #ffffff;">

    <div style="margin-bottom: 14px; font-size: 14px;">
      <span style="font-weight: bold; color: #000;"><?= data.name ?></span> 先生/小姐你好：<br><br>
      <div style="font-size: 12px; color: #444; line-height: 1.6;">
{greeting}
      </div>
    </div>
{body}
    <div style="margin-top: 20px; text-align: center;">
      <div><img src="{LOGO}" width="200" height="auto" alt="咕咕義小餐館" style="display: inline-block; border: 0;"></div>
      <div style="display: inline-block; opacity: 0.6; margin-top: -5px;">
        <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin: 0 auto;"><tr>{social}</tr></table>
      </div>
      <div style="color: #b2b2b2; font-size: 10px; line-height: 1.5; text-align: center; margin-top: 5px; padding: 0 22px;">
        <p style="margin: 0;">聯絡電話：<?= data.storePhone ?></p>
        <p style="margin: 0;">地址：<a href="{MAP}" target="_blank" style="text-decoration: none; color: #969696;"><?= data.storeAddress ?></a></p>
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
          <td style="border: none; padding: 8px 0; width: 90px; color: #888; font-size: 12px; vertical-align: top;">{label}</td>
          <td style="border: none; padding: 8px 0; color: #333; font-size: 12px; font-weight: bold; line-height: 1.5;">{value}</td>
        </tr>''')
    return '      <table style="width: 100%; border-collapse: collapse; border: none; margin: 0;">\n' + '\n'.join(out) + '\n      </table>'


def notes(lines):
    return '\n'.join(f'      <div style="font-size: 12px; color: #444; line-height: 1.6; padding: 6px 4px;">・{l}</div>' for l in lines)


TH = 'padding: 8px 5px; font-size: 12px; color: #666; font-weight: bold; letter-spacing: 1px; border: none;'
TD = 'padding: 8px 5px; vertical-align: top; border: none;'
SUBS = '''              <? if ({subs}) {{ ?>
                <div style="border-left: 0.5px solid #ddd; margin-left: 8px; padding-left: 10px; margin-top: 4px;">
                  <? var subItems = {subs}.split('、'); for (var k = 0; k < subItems.length; k++) {{ ?>
                    <div style="font-size: 11px; color: #999; margin-bottom: 2px; line-height: 1.3;"><?= subItems[k] ?></div>
                  <? }} ?>
                </div>
              <? }} ?>'''

# 出貨通知／取貨提醒：品項＋數量，共計 N 件
ITEMS_QTY = f'''      <table style="width: 100%; border-collapse: collapse; border: none;">
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


def items_amount(with_shipping):
    """確認信：品項（單價）＋數量＋金額，運費、總金額"""
    ship = f'''          <tr>
            <td colspan="2" style="padding: 8px 5px; text-align: right; font-size: 12px; color: #999; border: none;">運費</td>
            <td style="padding: 8px 5px; text-align: right; font-size: 12px; color: #333; border: none;">$<?= data.shippingText ?></td>
          </tr>
''' if with_shipping else ''
    return f'''      <table style="width: 100%; border-collapse: collapse; border: none;">
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
              <div style="font-size: 12px; color: #333; font-weight: bold; line-height: 1.2;"><?= it.label ?></div>
              <div style="font-size: 11px; color: #999; margin-top: 2px;">$<?= it.priceText ?></div>
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


ADD_BUTTON = f'''
    <div style="text-align: center; margin: 20px 0 6px;">
      <a href="<?= data.formUrl ?>" target="_blank" style="background-color: #68a0a9; border-radius: 28px; color: #ffffff; display: inline-block; font-size: 14px; font-weight: bold; padding: 8px 28px; text-decoration: none;">我要加購年菜</a>
    </div>
'''

BANK = section('匯款資訊', GREEN, info_rows([
    ('戶名', '<?= data.bankHolder ?>'),
    ('銀行名稱', '<?= data.bankName ?>'),
    ('分行名稱', '<?= data.bankBranch ?>'),
    ('匯款帳號', '<?= data.bankAccount ?>'),
]), boxed=True)

PAY_NOTES = [
    '預購商品需付款完成才算訂購成功，如尚未結帳請記得撥空轉帳至下方匯款帳號',
    '如需變更訂購數量/取貨日期/確認匯款/或其他年菜相關諮詢請加入<a href="<?= data.line ?>" target="_blank" style="color: ' + BLUE + '; font-weight: bold;">官方LINE</a>洽詢',
]

CONFIRM_GREETING = f'''        我們確認收到【 <?= data.year ?> 咕咕義小餐館新春年菜 】訂單，您的訂單內容如下：<br>
        訂單時間：{blue('<?= data.timestamp ?>')}（取貨或查詢時請出示）'''


def confirm(delivery):
    if delivery:
        info = section('配送資訊', BLUE, info_rows([
            ('取貨方式', '<?= data.method ?>'),
            ('寄出日期', '<?= data.shipPeriod ?>'),
            ('收件姓名', '<?= data.recipientName ?>'),
            ('收件電話', '<?= data.recipientPhone ?>'),
            ('收件地址', '<?= data.recipientAddress ?>'),
        ]), boxed=True)
        first_note = '宅配統一 <?= data.shipPeriod ?> 寄出，年節物流繁忙，恕無法指定到貨日期'
    else:
        info = section('取貨資訊', BLUE, info_rows([
            ('取貨方式', '<?= data.method ?>'),
            ('取貨日期', '<?= data.pickupDate ?>'),
            ('店取地址', f'<a href="{MAP}" target="_blank" style="color: #333; text-decoration: none;"><?= data.storeAddress ?></a>'),
        ]), boxed=True)
        first_note = '<?= data.lastPickupText ?> 除夕前一天取貨時間只到 <?= data.lastPickupEnd ?>'
    body = (section('訂購明細', RED, items_amount(delivery)) + info
            + section('注意事項', AMBER, notes([first_note] + PAY_NOTES)) + ADD_BUTTON + BANK)
    return page('<?= data.year ?> 咕咕義小餐館新春年菜訂單', CONFIRM_GREETING, body)


def pre_ship():
    greeting = f'''        感謝訂購 <strong>咕咕義小餐館-冷凍年菜料理包</strong><br>
        年菜將於 {blue('<?= data.shipPeriod ?>')} 黑貓低溫宅配寄出<br>
        請確認您的收件資訊：'''
    body = (section('收件資訊', BLUE, info_rows([
        ('收件姓名', '<?= data.receiverName ?>'),
        ('收件電話', '<?= data.receiverPhone ?>'),
        ('收件地址', '<?= data.receiverAddress ?>'),
    ]), boxed=True)
        + section('物流小叮嚀', AMBER, notes([
            '春節期間物流較繁忙，無法指定到貨日期與時段，通常寄出後 <strong>1~3</strong> 天會送達，但實際仍以物流配送為準。',
            '若您近期有 <strong>出國計畫</strong> 或 <strong>不便收貨</strong>，請盡快告知我們調整出貨日期。',
        ]))
        + f'''
    <p style="color: #d9534f; font-weight: bold; font-size: 14px; text-align: center; margin: 24px 0 0;">預祝 新年快樂，<?= data.greeting ?>！</p>
''')
    return page('冷凍年菜宅配寄出前確認', greeting, body)


def shipped():
    greeting = f'''        您的年菜{blue('<?= data.shipDate ?>')}已由黑貓低溫宅配寄出<br>
        收到商品請確認品項及數量正確無誤<br>
        如商品有任何問題請即時與我們聯絡<br>
        商品存放及加熱方式請參考附件小卡<br>
        <strong>咕咕義小餐館</strong>感謝您的訂購與支持！'''
    track = (f'<a href="https://www.t-cat.com.tw/inquire/trace.aspx?no=<?= data.trackingNo ?>" target="_blank" '
             f'style="color: {BLUE}; font-weight: bold; text-decoration: none; border-bottom: 1px solid {BLUE};"><?= data.trackingNo ?></a>')
    body = section('訂購明細', RED, ITEMS_QTY) + section('配送資訊', BLUE, info_rows([
        ('收件姓名', '<?= data.receiverName ?>'),
        ('聯絡電話', '<?= data.receiverPhone ?>'),
        ('收件地址', '<?= data.receiverAddress ?>'),
        ('託運單號', track),
    ]), boxed=True)
    return page('年菜寄出通知', greeting, body)


def pickup_reminder():
    greeting = f'''        您的年菜已準備完成<br>
        您預定取貨日期：{blue('<?= data.shipDate ?>')}<br>
        取貨請攜帶粉紅色單據或此畫面截圖<br>
        如需變更取貨日請提前告知我們備貨<br>
        <strong>咕咕義小餐館</strong>感謝您的支持！'''
    body = section('訂購明細', RED, ITEMS_QTY) + section('取貨資訊', BLUE, info_rows([
        ('自取日期', '<?= data.shipDate ?>'),
        ('取貨時段', '<?= data.pickupHours ?>'),
        ('取貨地點', f'<a href="{MAP}" target="_blank" style="color: #333; text-decoration: none;"><?= data.storeAddress ?></a>'),
    ]), boxed=True)
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
