# 交接文件：正式環境（pos-project）與 dev（webpos-dev）同步狀態

> **給新的 Claude 工作階段：** 先讀完這份，再讀 `DEPLOY_PROD_NIANFAI.md`（部署手冊與完整部署紀錄）和 `TECH_DEBT.md`（待處理清單）。
> 這份記錄截至 **2026-11-29**：正式環境做過哪些新增、刪減、修正，以及兩個專案目前是否一致。

---

## 1. 結論：兩個專案的程式已經一致

| | dev | 正式環境 |
|---|---|---|
| 資料夾 | `~/webpos-dev` | `~/pos-project` |
| 分支 | `feature/nianfai` | `main`（本機） |
| commit | 和正式相同（本文件 commit 之後也會一起 ff） | 和 dev 相同 |
| port／launchd | 3001／`com.kai.posdevserver`（直接跑 `node ~/webpos-dev/server.js --dev`） | 3000／`com.kai.posserver`（跑 `~/pos-project/start.sh`） |
| Supabase | dev 專案（`.env.dev`） | 正式專案（`~/pos-project/.env`，**不要讀**） |
| 年菜 GAS | dev 部署 @58（`.env.dev`） | 正式部署 @4（`.env.prod-gas`） |
| GitHub | `origin/feature/nianfai` 已推到 cd0ac2e | GitHub `origin/main` 還停在 dcb13d5（見 `TECH_DEBT.md` §4） |

- **確認方式：** `git -C ~/webpos-dev rev-parse HEAD` 和 `git -C ~/pos-project rev-parse HEAD` 應該相同；`git -C ~/pos-project status --short` 應該只剩 `?? src/setupProxy.js`。
- **GAS 程式相同：** 正式 @4 和 dev @58 都是從 57c9c64 的 `gas/nianfai/` 部署，之後的 commit 沒有改 GAS。
- **正式環境原本有、dev 沒有的東西，全部已搬進 dev 並 commit：**
  - 配色調整：7b66067。
  - `start.sh`：b3096e2，已拿掉開機自動 build。
- **不需要同步、刻意不同的：**
  - `.env`／`.env.dev`／`.env.prod-gas`：各環境設定，都在 `.gitignore`。
  - `build/`、`build_prev*`、`logs/`、`image-cache/`、`pos.db`：產物或本機資料，已忽略。
  - `src/setupProxy.js`：只有正式資料夾有，未追蹤。用途是 `npm start` 開發模式時把 `/api` 轉到 3001，正式 build 用不到，無害；Yw 同意保留不動，**不要搬進 dev**。
- **Supabase 資料本來就不同：** dev 和正式是兩個資料庫，只同步 schema，不同步資料。正式資料庫已跑過的 migration 見第 3 節。

### 以後的同步規則（避免再分岔）

1. 所有改動都先在 `~/webpos-dev` 的 `feature/nianfai` 修改、測試、commit。
2. 部署時才到正式資料夾執行 `cd ~/pos-project && git fetch -q ~/webpos-dev feature/nianfai && git merge --ff-only -q FETCH_HEAD`。
3. **不要在 `~/pos-project` 直接改檔案或 commit。** 如果發現正式資料夾有未 commit 的修改，先存 patch 到備份資料夾，搬到 dev commit，再 ff 回去。2026-11-29 配色就是這樣處理的。
4. 不推 GitHub `main`，除非 Yw 明確要求。`feature/nianfai` 可在 Yw 要求時推。

---

## 2. 正式環境的程式變更（依時間）

基準點：正式環境原本在 `dcb13d5`。之後 dev 共 131 個 commit 進到正式環境。

| 時間 | 變更 | commit／版本 | 重啟 |
|---|---|---|---|
| 11-27 13:07 | 年菜系統首次部署：年菜點單、佇列、年菜管理、發票／關帳／錢櫃的年菜處理；一般結帳流程修正（先存未付款→發票→扣庫存→標已付款） | ff 到 feature/nianfai，前端 main.699ff136.js | 是 |
| 11-27 13:35 | 正式 GAS 專案連線（Yw 把 GAS 網址／密鑰加進 `.env`） | GAS @1 | 是 |
| 11-27 16:40 | Sheet 寄信 0 封修正（訂單編號欄純文字）、補寄、清除時間按鈕、正式上線清空寄出前確認時間、發票頁年菜原始單號只顯示末三碼 | 92e1aeb，GAS @2 | 是 |
| 11-27 17:01 | 年菜管理頁依操作順序重排、「現在要做的事」、iPad（http）複製短網址修正 | 775d496 | 是 |
| 11-27 17:08 | 分類設定沒有「年菜」時自動補預設值（菜單管理年菜 tab） | 2bfc6bc | 否（只換 build） |
| 11-27 17:23 | 明年不用工程師：年菜庫存自動給年度 id、菜單年菜 tab 只顯示今年、生肖依年度、建立年度沿用去年匯款／小卡／店家資料 | c6d8731，GAS @3 | 否 |
| 11-27 22:2x | 「清空測試資料」按鈕：只限測試中，只清年菜，放在收合的「10. 維護工具」最下方 | 57c9c64＋1e42e12，GAS @4 | 是 |
| 11-29 | 配色調整補 commit（原本只在正式資料夾未 commit） | 7b66067 | 否（build 本來就含） |
| 11-29 | `start.sh` 納入版本控制、拿掉開機自動 build；`.gitignore` 加 `/build_next`、`/build_prev*` | b3096e2 | 否（下次開機生效，**尚未實際開機驗證**） |
| 11-29 | 刪除 `start-dev.sh`（移到備份資料夾，舊 dev 啟動腳本，已不用） | — | 否 |
| 11-29 | 文件：孤兒訂單 #449、GitHub main／`.env` 備份（`TECH_DEBT.md` §3、§4），本交接文件 | e98e1c8、cd0ac2e 之後 | — |

前端目前是 **main.6c101d55.js**（11-27 22:2x 部署的 build；之後只有文件、配色補 commit、start.sh 變更，畫面內容相同）。

---

## 3. 正式資料庫（Supabase）的變更：全部由 Yw 在 SQL Editor 執行

| 時間 | 內容 | 檔案 | 結果 |
|---|---|---|---|
| 11-27 部署前 | 年菜 7 個 migration（合併版，順序已排好） | `data-fixes/prod-deploy-nianfai-7-migrations.sql` | Success |
| 11-27 下午 | 刪除部署檢查用的一般測試單（內用 002、雞湯） | `data-fixes/prod-delete-test-order-20261127.sql` | **不確定是否執行過**，新工作階段可用檔案第 1 步只讀預覽確認 |
| 11-27 晚上 | 年菜測試單清除：Yw 用 WebPOS「清空測試資料」按鈕（沒用 SQL） | 備用：`data-fixes/nianfai-clear-test-orders.sql` | 已清，之後 Claude 只讀檢查年菜歸零、一般發票 12 張都在 |
| 待執行 | 歸檔孤兒訂單 #449 | `data-fixes/prod-archive-orphan-order-449.sql` | 未執行（見 `TECH_DEBT.md` §3） |

**正式資料庫裡由畫面操作產生的設定（不是程式，不用同步到 dev）：**
- 年菜年度 2027 已建立，狀態「測試中」（`nianfai_2027_phase = testing`），尚未正式上線。
- 正式試算表與表單已建立，表單對應檢查通過，匯款資訊已填，表單開放中。
- 寄出前確認時間目前是空的，正式上線後要填實際日期。
- 分類設定：正式資料庫存的版本沒有「年菜」，靠程式自動補，不用改資料。
- 清空之後 Yw 又下了一張年菜測試單 27261127001（「測試一鍵清空第二列」，宅配 1,540，付款方式空白）。正式上線時會自動清掉，或再按一次「清空測試資料」。

---

## 4. 正式 GAS（Google Apps Script）

- 專案「咕咕義年菜系統」，用店家帳號建立；部署：`gas/tools/deploy_gas.sh .env.prod-gas "說明"`，網址不變。
- 版本：@1 首次 → @2 寄信修正 → @3 沿用去年設定 → @4 清空測試資料。
- 指令碼屬性 `WEBPOS_SECRET` 由 Yw 設定；Claude 沒看過、也不能顯示。
- **待辦：** Yw 用完要 `npx -y @google/clasp@3.4.1 logout`，並關閉 Apps Script API（已提醒過）。

---

## 5. 正式環境的檔案與備份

- **備份資料夾：** `~/pos-project-deploy-backup-20261127/`
  - `HEAD.txt`、`uncommitted.patch`、`build_old.tgz`：部署前狀態。
  - `MenuManagement-color-1722.patch`、`color-tweaks-20261129.patch`：配色 patch，已 commit，留作備份。
  - `start.sh`、`start.sh.old-20261129`：舊啟動腳本（含自動 build）。
  - `start-dev.sh`、`start-dev.sh.removed-20261129`：已刪的舊 dev 腳本。
  - `setupProxy.js`：複本。
- **git stash：** `~/pos-project` 有 `stash@{0}`「prod uncommitted color tweaks before nianfai deploy 2026-11-27」。內容已 commit（7b66067），可以由 Yw 決定是否 `git stash drop`。
- **舊畫面：** `~/pos-project/build_prev`（上一版）、`build_prev_1307`（11-27 13:07 版），用來快速退回：`mv build build_bad && mv build_prev build`。
- **`start.sh` 新版：** 只啟動 server，找不到 `build/index.html` 時只寫警告、不自動 build。舊版會在 src 比 build 新時背景重建 build，畫面會壞一分多鐘。

---

## 6. 還沒做的事

**Yw 要做的：**
- [ ] 下次重開機後確認 WebPOS 正常起來，驗證新版 `start.sh`。
- [ ] 正式上線前，iPad 上確認菜單年菜 tab、配色、庫存頁年菜庫存選單。
- [ ] 準備好後按「測試完畢，正式上線」，再填實際的寄出前確認時間。
- [ ] clasp logout、關閉 Apps Script API。
- [ ] 正式 `.env` 自己另存到安全的地方（`TECH_DEBT.md` §4）。
- [ ] 有空時在 SQL Editor 執行 #449 歸檔 SQL（`TECH_DEBT.md` §3）。
- [ ] 年菜圖片：要加圖片到年菜品項時，把圖片放在 Mac 的資料夾，告訴 Claude 位置。Claude 會壓縮、放進 WebPOS，再產生 SQL 或給網址讓 Yw 設定。

**程式待處理（`TECH_DEBT.md`）：**
- §1、§2：年菜上線穩定後，刪掉已停用的 `nianfai_production_qty`、`nianfai_sellout_cap` 欄位與 Sheet「停售上限」欄。
- §3：建單時擋空桌號、桌位頁顯示沒有桌號的訂單並可手動歸檔。
- §4：年菜季結束後決定 GitHub main 怎麼更新。

---

## 7. 必須遵守的規則（Yw 交代過，新工作階段照做）

- 正式環境 = port 3000、`~/pos-project`。**沒有 Yw 明確同意不碰**。重啟前先 `lpstat -o` 確認列印佇列是空的，而且要在沒人點單的時候。
- 只換畫面（前端）不用重啟：`BUILD_PATH=build_next npm run build` → `mv build build_prev && mv build_next build`。改到 `server.js` 才要重啟。
- 不讀正式 `.env`，不在對話顯示任何金鑰（特別是 `NIANFAI_GAS_SECRET`）。
- 正式資料庫不由 Claude 寫入；Claude 只做唯讀查詢，SQL 給 Yw 在 SQL Editor 執行。清除資料只能清年菜測試資料，**不能動到一般營業資料**。
- dev 的「一鍵清空測試資料」（桌位頁左下角）會清一般營業的進行中訂單，**只限 dev**；正式環境伺服器會拒絕、畫面也不顯示。
- 寄信（含補寄、GAS 通知）要先經 Yw 同意。實體列印只在被要求時做。
- 不推 GitHub main。銀行帳號不進 repo。文案只提建議。
- 不准加回任何「編輯後自動 build／重啟正式機」的 hook，`start.sh` 也不能再加回自動 build。
- 部署前讀 `DEPLOY_PROD_NIANFAI.md`，部署後在第 9 節補紀錄。
