// src/components/NewVersionBanner.js — 有新版 WebPOS 時提示重新整理
// WebPOS 是單頁應用程式：iPad 上的分頁沒重新整理，就會一直跑舊版程式（例如列印模式改名後，舊版送出的指令新版不認）。
// 每分鐘、以及切回這個 App 時，比對伺服器上的 asset-manifest.json 與目前載入的主程式；不一樣就在最上方顯示提示。
// 不自動重新整理，避免打斷正在點單或輸入中的畫面。
import React, { useEffect, useState } from 'react';

const currentMain = () => {
    const s = [...document.querySelectorAll('script[src]')].map(x => x.getAttribute('src')).find(src => /\/static\/js\/main\.[^/]+\.js$/.test(src));
    return s || null;
};

export default function NewVersionBanner() {
    const [hasNew, setHasNew] = useState(false);
    useEffect(() => {
        const mine = currentMain();
        if (!mine) return undefined; // 開發模式（npm start）沒有雜湊檔名，不檢查
        let stopped = false;
        const check = async () => {
            try {
                const r = await fetch('/asset-manifest.json', { cache: 'no-store' });
                const m = await r.json();
                const latest = m.files && m.files['main.js'];
                if (!stopped && latest && !mine.endsWith(latest.replace(/^\./, ''))) setHasNew(true);
            } catch { /* 伺服器重開中，下次再檢查 */ }
        };
        const timer = setInterval(check, 60 * 1000);
        const onVisible = () => { if (document.visibilityState === 'visible') check(); };
        document.addEventListener('visibilitychange', onVisible);
        check();
        return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
    }, []);
    if (!hasNew) return null;
    return (
        <button onClick={() => window.location.reload()}
            className="fixed top-0 inset-x-0 z-[9999] bg-[#C1032F] text-white font-bold text-lg py-3 shadow-lg">
            WebPOS 已更新，點此重新整理
        </button>
    );
}
