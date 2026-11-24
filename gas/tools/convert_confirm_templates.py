#!/usr/bin/env python3
"""把 2026 年確認信範本（email 編輯器產生、11 個品項寫死）轉成 2027 年 GAS 用的範本。

- 11 段寫死的品項列 → 一段 data.items 迴圈（只列有訂的品項，套餐下方附組成）
- 數量.xxx／你的金額.xxx → data.xxx（資料由 Confirm.gs 的 buildOrderData 產生）
- 寫死的年份、最後取貨日、寄出日 → 從「設定」帶入
- 問候段落後加上「訂單時間」（與 Sheet 顯示一致，取貨時出示用）
- Outlook 備用按鈕（<!--[if mso]>）與同一顆按鈕的連結 → 當年度表單網址

視覺與文案不動（handoff 第 2 節「信件」）。

用法：python3 -I convert_confirm_templates.py <2026 確認信資料夾> <輸出資料夾>
"""
import re
import sys
from pathlib import Path

ITEM_KEYS = ['套餐', '雞湯', '牛腩筋', '無錫排', '鹹菜滷肉', '麻油蝦', '松阪豬', '燉羊肉', '掛霜腰', '薄鹽腰', '海味']
ROW_SPLIT = re.compile(r'(?=\t\t\t\t\t<table class="row row-\d+")')
OLD_BUTTON_LINK = 'https://forms.gle/QNz4qR8LRgutPSqZ9'


def convert(src: str) -> str:
    parts = ROW_SPLIT.split(src)
    item_idx = [i for i, p in enumerate(parts) if any(f'數量.{k} ?>' in p for k in ITEM_KEYS)]
    if len(item_idx) != len(ITEM_KEYS):
        raise SystemExit(f'找到 {len(item_idx)} 段品項列，預期 {len(ITEM_KEYS)} 段，範本結構可能變了')
    first, last = item_idx[0], item_idx[-1]
    item_block = parts[first]
    divider_block = parts[first + 1]
    if 'divider_block' not in divider_block:
        raise SystemExit('品項列後面不是分隔線，範本結構可能變了')
    # 最後一個品項後面若有分隔線也一併取代
    end = last + 1
    if end < len(parts) and 'divider_block' in parts[end] and '數量.' not in parts[end]:
        end += 1

    # 品項列：品名欄（<strong>單價</strong> 名稱）、數量欄、金額欄
    row = re.sub(
        r'<p style="margin: 0; word-break: break-word;"><strong>[^<]*</strong>[^<]*</p>',
        '<p style="margin: 0; word-break: break-word;"><strong><?= it.priceText ?></strong> <?= it.label ?>'
        '<? if (it.subs) { ?><br><span style="font-size:12px;color:#8a8d93;">含：<?= it.subs ?></span><? } ?></p>',
        item_block, count=1)
    row = row.replace('<?= 數量.套餐 ?>', '<?= it.qty ?>').replace('<?= 你的金額.套餐 ?>', '<?= it.amountText ?>')
    if '<?= it.label ?>' not in row or '<?= it.qty ?>' not in row:
        raise SystemExit('品項列替換失敗，範本結構可能變了')

    loop = ('<? for (var i = 0; i < data.items.length; i++) { var it = data.items[i]; ?>\n'
            + row + divider_block + '<? } ?>\n')
    out = ''.join(parts[:first]) + loop + ''.join(parts[end:])

    # 其餘欄位
    repl = {
        '<?= 數量.訂購姓名 ?>': '<?= data.name ?>',
        '<?= 數量.取貨方式 ?>': '<?= data.method ?>',
        '<?= 數量.店取日期 ?>': '<?= data.pickupDate ?>',
        '<?= 數量.收件人 ?>': '<?= data.recipientName ?>',
        '<?= 數量.收件電話 ?>': '<?= data.recipientPhone ?>',
        '<?= 數量.收件地址 ?>': '<?= data.recipientAddress ?>',
        '<?= 你的金額.運 ?>': '<?= data.shippingText ?>',
        '<?=你的金額.加總?>': '<?= data.totalText ?>',
    }
    for a, b in repl.items():
        out = out.replace(a, b)

    # 年份、日期從「設定」帶入
    out = out.replace('【 2026 咕咕義小餐館新春年菜 】訂單，您的訂單內容如下：',
                      '【 <?= data.year ?> 咕咕義小餐館新春年菜 】訂單，您的訂單內容如下：'
                      '<br>訂單時間：<strong><?= data.timestamp ?></strong>（取貨或查詢時請出示）')
    out = out.replace('2026/2/15 (日) 除夕前一天取貨時間只到 ', '<?= data.lastPickupText ?> 除夕前一天取貨時間只到 ')
    out = out.replace('>16:00<', '><?= data.lastPickupEnd ?><')
    out = out.replace('宅配統一 2026/2/2 (一) ~ 2/4 (三) 寄出', '宅配統一 <?= data.shipPeriod ?> 寄出')
    out = out.replace('<p style="margin: 0;">2026/2/2 (一) ~ 2/4 (三)</p>', '<p style="margin: 0;"><?= data.shipPeriod ?></p>')
    out = re.sub(r'<title>[^<]*</title>', '<title><?= data.year ?> 咕咕義小餐館新春年菜訂單</title>', out)

    # Outlook 備用按鈕與同一顆按鈕 → 當年度表單網址
    def fix_mso(m):
        return re.sub(r'href="https://docs\.google\.com/forms/[^"]*"', 'href="<?= data.formUrl ?>"', m.group(0))
    out = re.sub(r'<!--\[if mso\]>.*?<!\[endif\]-->', fix_mso, out, flags=re.S)
    out = out.replace(f'href="{OLD_BUTTON_LINK}"', 'href="<?= data.formUrl ?>"')

    # 匯款資訊（戶名／銀行／分行／帳號）不放在範本與 repo 裡：依欄位標籤找到後面的值那一格，
    # 改讀「設定」，預設留空，由 Yw 自己填
    sec = out.find('>匯款資訊<')
    if sec < 0:
        raise SystemExit('找不到「匯款資訊」區塊，範本結構可能變了')
    pos = sec
    for label, key in [('戶名', 'bankHolder'), ('銀行名稱', 'bankName'), ('分行名稱', 'bankBranch'), ('匯款帳號', 'bankAccount')]:
        li = out.find(label, pos)
        if li < 0:
            raise SystemExit('找不到匯款欄位：' + label)
        m = re.compile(r'>((?:(?!&nbsp;)[^<>\s])[^<>]*)<').search(out, li + len(label))
        if not m:
            raise SystemExit('找不到匯款欄位的值：' + label)
        out = out[:m.start()] + '><?= data.' + key + ' ?><' + out[m.end():]
        pos = m.start()

    leftover = re.findall(r'<\?=\s*(數量|你的金額)\.[^?]*\?>', out)
    if leftover:
        raise SystemExit(f'還有沒替換的舊變數：{leftover}')
    return out


def main():
    src_dir, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    for src_name, out_name in [('temp_自取.html', 'ConfirmPickup.html'), ('temp宅_宅配.html', 'ConfirmDelivery.html')]:
        html = (src_dir / src_name).read_text(encoding='utf-8')
        (out_dir / out_name).write_text(convert(html), encoding='utf-8')
        print('OK', out_name)


if __name__ == '__main__':
    main()
