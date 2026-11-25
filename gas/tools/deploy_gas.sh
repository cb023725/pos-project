#!/bin/bash
# gas/tools/deploy_gas.sh — 用 clasp 把 gas/nianfai/ 上傳到「年菜系統」Apps Script 專案，並把現用的網頁應用程式部署更新成新版本（網址不變）
#
# 事前（每次更新）：
#   1. https://script.google.com/home/usersettings 開啟「Google Apps Script API」
#   2. npx -y @google/clasp@3.4.1 login
# 用完建議：npx -y @google/clasp@3.4.1 logout，並關閉上面的開關
#
# 用法：gas/tools/deploy_gas.sh [.env 檔，預設 .env.dev] [部署說明]
#   .env 需要 NIANFAI_GAS_SCRIPT_ID（專案設定 → 指令碼 ID）與 NIANFAI_GAS_URL（…/s/<部署ID>/exec）
# 專案設定檔 appsscript.json 一律先從 Google 下載沿用（時區、網頁應用程式執行身分與存取權不會被改到），
# 並檢查 Google 端有沒有 repo 沒有的檔案（有就停止，避免上傳時被刪掉）。
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE="${1:-.env.dev}"
DESC="${2:-$(git log -1 --format=%s)}"
CLASP="npx -y @google/clasp@3.4.1"
SCRIPT_ID=$(grep '^NIANFAI_GAS_SCRIPT_ID=' "$ENV_FILE" | cut -d= -f2-)
DEPLOY_ID=$(grep '^NIANFAI_GAS_URL=' "$ENV_FILE" | sed -E 's#.*/s/([^/]+)/exec.*#\1#')
[ -n "$SCRIPT_ID" ] && [ -n "$DEPLOY_ID" ] || { echo "$ENV_FILE 缺 NIANFAI_GAS_SCRIPT_ID 或 NIANFAI_GAS_URL"; exit 1; }

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/remote" "$WORK/push"
echo "{\"scriptId\":\"$SCRIPT_ID\",\"rootDir\":\".\"}" | tee "$WORK/remote/.clasp.json" > "$WORK/push/.clasp.json"
(cd "$WORK/remote" && $CLASP pull >/dev/null)
EXTRA=$(cd "$WORK/remote" && for f in *.js *.gs *.html; do [ -e "$f" ] || continue; b="${f%.js}"; [ "$b" != "$f" ] && b="$b.gs"; [ -e "$OLDPWD/gas/nianfai/$b" ] || echo "$f"; done)
if [ -n "$EXTRA" ]; then echo "Google 端有 repo 沒有的檔案，上傳會刪掉它們，先停止：$EXTRA"; exit 1; fi
cp gas/nianfai/*.gs gas/nianfai/*.html "$WORK/push/"
cp "$WORK/remote/appsscript.json" "$WORK/push/"
(cd "$WORK/push" && $CLASP push --force | head -1 && $CLASP update-deployment "$DEPLOY_ID" -d "$DESC" | sed -E "s#$DEPLOY_ID#<現用部署>#")
# Google 切換到新版本需要幾秒，等一下再讓後續的呼叫（重建分頁等）打到新版本
sleep 30
