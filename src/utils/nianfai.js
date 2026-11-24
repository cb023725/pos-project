// src/utils/nianfai.js — 年菜畫面共用的格式化

// 取貨日加星期：'2027-01-29' → '2027-01-29（五）'
// 直接解析 YYYY-MM-DD 字串，不經過本地時區轉換，避免日期偏移一天
export function formatPickupDate(dateStr) {
    if (!dateStr) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
    if (!m) return dateStr;
    const wd = '日一二三四五六'[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
    return `${m[1]}-${m[2]}-${m[3]}（${wd}）`;
}

// 流水號：年份末兩碼＋3 位流水號，例如 2027 年第 1 號 → 27001（2028 從 28001 開始）
// 跟後端 server.js 的 nianfaiSeqLabel 同一套規則
export function formatNianfaiSeq(year, seqNo) {
    return `${Number(year) % 100}${String(seqNo).padStart(3, '0')}`;
}

// 套餐畫面上只顯示品名本體（「富貴套餐：五菜一湯 (六人份)」→「富貴套餐」），
// 資料庫品名與收據不變（品名是對應表單欄位的依據，不能改）
export function nianfaiDisplayName(item) {
    return String(item.name || '').split('：')[0].trim();
}
