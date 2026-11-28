#!/bin/bash
# gas/tools/setup_sheet_menu.sh — 在年度試算表建立綁定的小程式，加上「📧 年菜寄信」選單（每個年度做一次）
# 用法：gas/tools/setup_sheet_menu.sh <綁定專案的指令碼 ID> [.env 檔，預設 .env.dev]
#   綁定專案：在年度試算表點「擴充功能 → Apps Script」，打開的專案網址 /projects/<這段>/edit 就是 ID
#   （clasp create-script --parentId 建立的專案不一定會綁到試算表，所以改用試算表自己建立的專案）
# 事前：Apps Script API 開啟、npx -y @google/clasp@3.4.1 login（同 deploy_gas.sh）
# 之後第一次在試算表點選單時，Google 會要求授權一次。
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO=$(pwd)
MENU_ID=$(echo "$1" | sed -E 's#.*/projects/([^/]+).*#\1#')
ENV_FILE="${2:-.env.dev}"
LIB_ID=$(grep '^NIANFAI_GAS_SCRIPT_ID=' "$ENV_FILE" | cut -d= -f2-)
CLASP="npx -y @google/clasp@3.4.1"
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
# 程式庫至少要有一個已存版本；開發模式（HEAD）會一直用年菜系統最新的程式
mkdir -p "$WORK/lib" && echo "{\"scriptId\":\"$LIB_ID\",\"rootDir\":\".\"}" > "$WORK/lib/.clasp.json"
LIB_VER=$(cd "$WORK/lib" && $CLASP list-versions | grep -E '^[0-9]+ ' | tail -1 | cut -d' ' -f1)
mkdir -p "$WORK/menu"
cd "$WORK/menu"
echo "{\"scriptId\":\"$MENU_ID\",\"rootDir\":\".\"}" > .clasp.json
cp "$REPO/gas/sheet-menu/Menu.gs" .
cat > appsscript.json <<JSON
{
  "timeZone": "Asia/Taipei",
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "dependencies": { "libraries": [ { "userSymbol": "NianfaiLib", "libraryId": "$LIB_ID", "version": "$LIB_VER", "developmentMode": true } ] }
}
JSON
rm -f Code.gs Code.js 程式碼.gs
$CLASP push --force | head -1
echo "已更新選單程式（${MENU_ID}）；重新整理試算表就會出現「📧 年菜寄信」"
