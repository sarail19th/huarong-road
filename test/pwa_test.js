// Checks the PWA files in dist/ that directories and Chrome's install dialog look at. Run after `node build.js`,
// `python3 gen/icons.py` and `python3 gen/shots.py`.
const fs = require('fs'), path = require('path');
const D = path.join(__dirname, '..', 'dist');
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };
const m = JSON.parse(fs.readFileSync(path.join(D, 'manifest.webmanifest'), 'utf8'));
for (const k of ['id', 'name', 'short_name', 'description', 'lang', 'categories', 'start_url', 'scope', 'display', 'icons', 'screenshots'])
  if (!m[k] || (Array.isArray(m[k]) && !m[k].length)) fail('manifest is missing ' + k);
const size = (f) => { const b = fs.readFileSync(path.join(D, f)); return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20); };
for (const i of [...m.icons, ...m.screenshots]) {
  if (!fs.existsSync(path.join(D, i.src))) fail(i.src + ' is declared but missing');
  if (size(i.src) !== i.sizes) fail(i.src + ' is ' + size(i.src) + ' but declared ' + i.sizes);
}
for (const p of ['any', 'maskable', 'monochrome']) if (!m.icons.some((i) => i.purpose === p)) fail('no ' + p + ' icon');
if (!m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any')) fail('no 512 any icon');
for (const f of ['wide', 'narrow']) if (!m.screenshots.some((s) => s.form_factor === f)) fail('no ' + f + ' screenshot');
const sw = fs.readFileSync(path.join(D, 'sw.js'), 'utf8');
const list = sw.match(/const FILES=\[(.*?)\]/)[1].split(',').map((s) => s.replace(/['"]/g, '').trim());
for (const i of m.icons) if (!list.includes('./' + i.src)) fail(i.src + ' is not in the service worker cache list');
if (!list.includes('./apple-touch-icon.png')) fail('apple-touch-icon not cached');
const html = fs.readFileSync(path.join(D, 'index.html'), 'utf8');
if (!/rel="apple-touch-icon"/.test(html)) fail('no apple-touch-icon link');
if (!/name="description"/.test(html)) fail('no meta description');
if (/user-scalable=no|maximum-scale/.test(html)) fail('viewport blocks zoom');
if (size('apple-touch-icon.png') !== '180x180') fail('apple-touch-icon must be 180x180');
console.log('OK: manifest, icons, screenshots, cache list and head tags');
