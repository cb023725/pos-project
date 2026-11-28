// gas/tools/gas_mock_server.js — 本機假 GAS 伺服器：跑真正的 gas/nianfai 程式碼，只有 Google 服務是模擬的
// 用法：node gas/tools/gas_mock_server.js <port> <secret>，再把 NIANFAI_GAS_URL 指到 http://127.0.0.1:<port>/exec
const http = require('http');
const { createGasEnv } = require('./gas_mock_test');
const [port = 3997, secret = ''] = process.argv.slice(2);
const ctx = createGasEnv();
ctx._props.WEBPOS_SECRET = secret;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const reply = (out) => { res.setHeader('Content-Type', 'application/json'); res.end(typeof out === 'string' ? out : JSON.stringify(out)); };
  if (req.method === 'GET') return reply(ctx.doGet({ parameter: Object.fromEntries(u.searchParams) }));
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    try { console.log('POST', JSON.parse(b).action); } catch {}
    reply(ctx.doPost({ postData: { contents: b } }));
  });
}).listen(Number(port), '127.0.0.1', () => console.log('mock GAS on', port));
