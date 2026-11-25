#!/bin/bash
# gas/tools/setup_sheet_menu.sh — 在年度試算表建立綁定的小程式，加上「📧 年菜寄信」選單（每個年度做一次）
# 用法：gas/tools/setup_sheet_menu.sh <試算表 ID 或網址> [.env 檔，預設 .env.dev]
# 事前：Apps Script API 開啟、npx -y @google/clasp@3.4.1 login（同 deploy_gas.sh）
# 之後第一次在試算表點選單時，Google 會要求授權一次。
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO=$(pwd)
SS_ID=$(echo "$1" | sed -E 's#.*/spreadsheets/d/([^/]+).*#\1#')
ENV_FILE="${2:-.env.dev}"
LIB_ID=$(grep '^NIANFAI_GAS_SCRIPT_ID=' "$ENV_FILE" | cut -d= -f2-)
CLASP="npx -y @google/clasp@3.4.1"
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
# 程式庫至少要有一個已存版本；開發模式（HEAD）會一直用年菜系統最新的程式
mkdir -p "$WORK/lib" && echo "{\"scriptId\":\"$LIB_ID\",\"rootDir\":\".\"}" > "$WORK/lib/.clasp.json"
LIB_VER=$(cd "$WORK/lib" && $CLASP list-versions | grep -E '^[0-9]+ ' | tail -1 | cut -d' ' -f1)
mkdir -p "$WORK/menu"
cd "$WORK/menu"
$CLASP create-script --type sheets --title "年菜寄信選單" --parentId "$SS_ID" --rootDir . >/dev/null
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
echo "已建立選單程式（試算表 $SS_ID）"
