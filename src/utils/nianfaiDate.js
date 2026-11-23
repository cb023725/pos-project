// src/utils/nianfaiDate.js — 年菜取貨日顯示加星期：'2027-01-29' → '2027-01-29（五）'
// 直接解析 YYYY-MM-DD 字串，不經過本地時區轉換，避免日期偏移一天
export function formatPickupDate(dateStr) {
    if (!dateStr) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
    if (!m) return dateStr;
    const wd = '日一二三四五六'[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
    return `${m[1]}-${m[2]}-${m[3]}（${wd}）`;
}
