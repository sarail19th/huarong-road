// Apps on the same github.io address share Cache Storage and the list of service workers. Update (worker upgrade and the
// in-app Update button) must leave other apps' caches and workers alone, and the app must still work offline afterwards.
// Run after `node build.js`. Needs Playwright (npm i playwright, or the one on the machine).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const D = path.join(__dirname, '..', 'dist');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };
const ok = (c, m) => { if (!c) fail(m); };

(async () => {
  let ver = null; // null = serve dist as built; otherwise pretend a new build shipped
  const server = http.createServer((q, s) => {
    let p = decodeURIComponent(q.url.split('?')[0]);
    if (p === '/other/sw.js') { s.writeHead(200, { 'content-type': 'text/javascript' }); return s.end('self.addEventListener("fetch",()=>{});'); }
    p = p.replace(/^\/huarong-road/, '') || '/'; if (p.endsWith('/')) p += 'index.html';
    const f = path.join(D, p); if (!f.startsWith(D) || !fs.existsSync(f)) { s.writeHead(404); return s.end(); }
    let b = fs.readFileSync(f);
    if (ver && p === '/sw.js') b = Buffer.from(b.toString().replace(/huarong-[0-9a-f]+/, 'huarong-' + ver));
    s.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); s.end(b);
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const B = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch(), ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(B + '/huarong-road/'); await page.evaluate(() => navigator.serviceWorker.ready);
    const names = () => page.evaluate(() => caches.keys().then((k) => k.sort()));
    const regs = () => page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.map((x) => new URL(x.scope).pathname).sort()));
    // another app: its own cache and its own worker, at a different scope
    await page.evaluate(() => caches.open('other-app-1').then((c) => c.put('/other/', new Response('x'))));
    await page.evaluate(() => navigator.serviceWorker.register('/other/sw.js', { scope: '/other/' }).then(() => navigator.serviceWorker.ready));
    ok(JSON.stringify(await regs()) === '["/huarong-road/","/other/"]', 'setup: both workers registered, got ' + await regs());

    // 1) a new build ships: the worker upgrades
    ver = 'aaaaaaa';
    await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/huarong-road/'); await r.update(); });
    let n = [];
    for (let i = 0; i < 40; i++) { // wait until the new worker has activated and tidied up: exactly our new cache + the other app's
      n = await names(); if (n.length === 2 && n.includes('huarong-aaaaaaa')) break; await page.waitForTimeout(250);
    }
    ok(n.includes('other-app-1'), 'upgrade deleted another app\'s cache: ' + n);
    ok(!n.some((k) => k.startsWith('huarong-') && k !== 'huarong-aaaaaaa'), 'old huarong cache not removed: ' + n);

    // 2) the Update pill
    await page.reload(); await page.evaluate(() => navigator.serviceWorker.ready);
    await page.evaluate(() => document.getElementById('refreshBtn').click());
    await page.waitForTimeout(8000);
    n = await names();
    ok(n.includes('other-app-1'), 'Update button deleted another app\'s cache: ' + n);
    ok(n.some((k) => k.startsWith('huarong-')), 'Update button left no huarong cache: ' + n);
    ok((await regs()).includes('/other/'), 'Update button unregistered another app\'s worker: ' + await regs());

    // 3) offline right afterwards
    await ctx.setOffline(true);
    const off = await ctx.newPage();
    await off.goto(B + '/huarong-road/', { timeout: 8000 }).catch((e) => fail('offline after Update: ' + e.message.split('\n')[0]));
    ok((await off.title()) === 'Huarong Road', 'offline page did not load');
    console.log('OK: update keeps other apps\' caches and workers, and Huarong still opens offline');
  } finally { await browser.close(); server.close(); }
})();
