#!/bin/bash
# 正式環境 WebPOS 開機啟動腳本（launchd com.kai.posserver 執行 /Users/kai/pos-project/start.sh）
#
# 只啟動伺服器，不 build。
# 以前開機時發現 src 比 build 新就會在背景直接重建 build/，重建那一分多鐘畫面會壞掉，
# 而且等於「沒人確認就自動上新版」，2026-11-29 拿掉。
# 部署畫面一律手動：BUILD_PATH=build_next npm run build → 換上 build（見 DEPLOY_PROD_NIANFAI.md）。
cd /Users/kai/pos-project

# launchd 環境的 PATH 很精簡
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

if [ ! -f build/index.html ]; then
    echo "[start.sh] $(date) - 警告：找不到 build/index.html，畫面會打不開；請手動 build（不自動 build）"
fi

echo "[start.sh] $(date) - 啟動 server.js..."
# exec 取代 shell，讓 launchd 直接管理 node 進程
exec /usr/local/bin/node /Users/kai/pos-project/server.js
