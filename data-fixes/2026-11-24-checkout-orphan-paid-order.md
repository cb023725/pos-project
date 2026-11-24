# 2026-11-24：結帳中斷造成「已付款但沒有發票」的游離訂單（for pos-project）

> 在 `~/webpos-dev`（feature/nianfai）修正並實測，commit `ee0d8c8`。
> `pos-project` main（`dcb13d5`）的程式是同一個寫法、有同樣問題。
> 同目錄的 `2026-11-24-checkout-orphan-paid-order.patch` 已確認可以直接套用到 pos-project main（`git apply --check` 通過，只有行號位移）。

## 調查結論：內用／外帶點單頁

| 項目 | 現況 | 風險 |
|---|---|---|
| 自動還原 | **沒有**。還沒「確認點餐」或「結帳」的品項只存在畫面上（React state），不會寫進 DB | 非正常離開（重新整理、關分頁、當機）時，**還沒送出的品項會遺失**，但 DB 不會留下奇怪的資料 |
| 內用開新桌 | 一進點單頁就呼叫 `occupyTableWithoutOrder` 佔桌 | 非正常離開時，桌位顯示「佔用但沒有訂單」。桌位頁看得到、可以清桌，**不算游離** |
| 外帶新單 | 送單或結帳時才建立訂單，建立時派流水號 | 建立後一定出現在外帶清單，**不會游離** |
| **結帳** | 分兩個 request，先標成已付款、再開發票 | **會產生游離訂單**（見下方），這次修正的就是這個 |
| 送單／結帳列印 | DB 寫入完成後才送 `/print`（fire-and-forget） | DB 寫完、列印送出前的極短時間內中斷，廚房單或顧客聯可能沒印。這段時間只有幾毫秒，這次不處理 |

## 問題

`src/pages/Order.js` 的 `executeCheckout` 原本流程：

1. `saveOrderBeforeNavigate(...)`：把要結帳的品項標成 `isPaid: true`，訂單狀態改成 `paid`。
2. `completeOrderAndReport(...)` → `POST /api/orders/:id/complete`：開發票、扣庫存、更新桌位狀態。

第 1 步成功、但第 2 步**沒送到或失敗**時（重新整理、斷網、關分頁、平板休眠、伺服器回錯誤）：

- 訂單停在「已付款」，但**沒有發票**：這筆營收不會出現在發票頁、關帳、報表，庫存也沒扣。
- 畫面上品項已經全部付清，**沒辦法再按結帳補開**。
- 清桌時會被歸檔成 `archived_paid`（或 `abandoned`），從此不會再出現在任何畫面。

另外有一個順帶的 bug：前端呼叫 `completeOrderAndReport({ itemsToCheckout, ... })`，但這個函式只接受 `newItems`，`itemsToCheckout` 等於沒傳，後端只能用第 1 步已經寫進去的品項。

後端 `/complete` 原本先把訂單標成已付款，再開發票，而且沒有檢查寫入錯誤。發票寫入失敗時，一樣會留下「已付款但沒有發票」的訂單。

## 修正內容

### 1. `src/pages/Order.js` — `executeCheckout`

- 新增模組層級的 `toDbItems(arr)`：品項寫進 DB 的欄位，跟 `saveOrderBeforeNavigate`／`handleGoBack` 用的欄位一致。
- 第 1 步改成存「**未付款**」的訂單：傳原本的 `currentOrder`（沒有付款標記）、狀態 `'served'`、原本的 `finishTime`。用途只剩確保訂單存在（沒有就建立，外帶會在這時派號），以及寫入品項和顧客資料。
- 第 2 步改成帶 `newItems: toDbItems(updatedOrderForDb)`（含 `isPaid`、出單批次）和 `finishTime: newFinishTime`。付款標記、發票、扣庫存都在同一個 request 裡完成。

```js
// 2. 先存未付款的訂單
const orderId = await saveOrderBeforeNavigate(tableNumber, currentOrder, currentOrderId, customerCount, subTotal, 'served', newSendTime, finishTime);
...
// 3. 付款標記＋發票＋扣庫存，同一個 request
completeOrderAndReport({
    orderId: currentOrderId || orderId,
    newItems: toDbItems(updatedOrderForDb),
    tableNumber, isFullyPaid,
    sendTime: newSendTime,
    finishTime: newFinishTime,
}),
```

### 2. `src/db.js` — `completeOrderAndReport`

多接收、多傳一個 `finishTime`。

### 3. `server.js` — `POST /api/orders/:id/complete`

- 順序改成**先開發票、扣庫存，最後才更新訂單**（狀態、品項、`paid_amount`、`send_time`，有傳時也寫 `finish_time`）。
- 發票寫入失敗回 500，並且**不更新訂單**；訂單更新失敗也回 500。
- `paid_amount` 改成「所有有效發票加總＋本次金額」（取它和原值的較大者），不再用原值累加。如果上次發票已經開了、訂單卻沒更新，重新結帳時本次金額是 0，用累加會少算。

修正後不管哪一步中斷，訂單都還是**未付款**、照樣出現在桌位頁或外帶清單，重新結帳就能補完。後端原本就有的 `alreadyCounted` 會扣掉已經開過發票的數量，所以**不會重複開發票，也不會漏開**。

## 套用到 pos-project

```bash
cd ~/pos-project
git apply --check ~/webpos-dev/data-fixes/2026-11-24-checkout-orphan-paid-order.patch   # 先檢查
git am ~/webpos-dev/data-fixes/2026-11-24-checkout-orphan-paid-order.patch              # 套用（保留 commit 訊息）
npm run build   # 重新 build 前端，再重啟正式機 server
```

> pos-project 目前工作區有還沒 commit 的修改（`schema.sql`、`src/components/MenuCard.js`、`src/pages/Home.js`），跟這個 patch 不是同一批檔案，但 `git am` 前最好先處理掉。

這個修正不需要改資料庫結構。

## 檢查正式資料庫是否已經有游離訂單

在 Supabase SQL Editor（**正式專案**）執行，列出「已付款品項金額 > 有效發票金額」的訂單：

```sql
with paid_items as (
  select o.id, sum((it->>'price')::numeric * coalesce((it->>'quantity')::numeric, 1)) as paid_amount_by_items
  from public.orders o
  cross join lateral jsonb_array_elements(o.items) it
  where coalesce(o.is_nianfai, false) = false
    and o.status <> 'archived_voided'
    and coalesce((it->>'isPaid')::boolean, false)
  group by o.id
),
active_inv as (
  select order_id, sum(coalesce(amount, total)) as invoiced
  from public.invoices
  where status = '已開立'
  group by order_id
)
select o.id, o.daily_order_no, o.table_number, o.status, o.timestamp,
       p.paid_amount_by_items, coalesce(a.invoiced, 0) as invoiced,
       p.paid_amount_by_items - coalesce(a.invoiced, 0) as missing
from paid_items p
join public.orders o on o.id = p.id
left join active_inv a on a.order_id = p.id
where p.paid_amount_by_items > coalesce(a.invoiced, 0)
order by o.timestamp desc;
```

- 已作廢（`archived_voided`）的訂單已經排除，因為作廢後品項還留著 `isPaid`。
- 查出來的每一筆都要**人工確認**：可能是真的漏開發票，也可能是手動刪過發票的測試資料。dev 上跑出 6 筆（4～5 月），推測大多是用「一鍵清空測試資料」刪過發票的資料。
- 確認是漏開的話，可以對該訂單呼叫一次 `POST /api/orders/<id>/complete`（body `{"isFullyPaid": true}`）補開發票、扣庫存。補開的發票時間會是補開當下，**營業日要另外確認**。

## 驗證（webpos-dev 3001＋列印沙盒，已做）

- API 模擬中斷：建立未付款訂單、不呼叫 complete → 訂單仍是 `served`、出現在外帶清單、沒有發票。
- 接著呼叫 complete → 補開發票，訂單 `paid`、`paid_amount` 正確。
- 再送一次 complete → 不會重複開發票。
- 畫面上實際跑一次外帶點餐＋全部結帳：訂單 `paid`，品項的 `isPaid`、`isSent`、出單批次都正確，`finish_time` 有寫入，發票金額正確。
- 測試訂單和發票已刪除。

## 沒處理、可以之後再評估的

- **還沒送出的品項沒有自動還原**：如果需要，可以比照年菜點單頁的做法，在本機暫存每一桌的草稿。但多台平板同時操作同一桌時會有衝突，要先決定以哪一台為準。
- **列印沒有重試機制**：DB 寫完、列印還沒送出的極短時間內中斷，紙本可能沒印出來。
