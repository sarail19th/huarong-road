// Inlines CSS + JS into one self-contained dist/index.html and writes PWA files.
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
// function replacers so "$&"-style sequences in the source are never interpreted
const draft = read('src/index.html')
  .replace('/*INLINE_CSS*/', () => read('src/style.css'))
  .replace('/*INLINE_SOLVER*/', () => read('src/solver.js'))
  .replace('/*INLINE_LEVELS*/', () => read('src/levels.js'))
  .replace('/*INLINE_DAILY*/', () => read('src/daily.js'))
  .replace('/*INLINE_GAME*/', () => read('src/game.js'));
// Version id = short hash of the app itself: it only changes when the app does, and the page, the service worker's
// cache name and the "Version" label in the menu all agree on it.
const v = require('crypto').createHash('sha1').update(draft).digest('hex').slice(0, 7);
const html = draft.split('__BUILD__').join(v);
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/index.html'), html);

// icons: gen/icons.py, screenshots: gen/shots.py (both write into dist/)
fs.writeFileSync(path.join(__dirname, 'dist/manifest.webmanifest'), JSON.stringify({
  id: './', name: 'Huarong Road', short_name: 'Huarong',
  description: 'Slide the big red block out through the exit. 100 levels, a new daily puzzle, hints, a stage designer, English and Thai. Works offline.',
  lang: 'en', dir: 'ltr', categories: ['games', 'entertainment'],
  start_url: './', scope: './', display: 'standalone',
  orientation: 'portrait', background_color: '#0d1117', theme_color: '#0d1117',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: 'icon-monochrome-512.png', sizes: '512x512', type: 'image/png', purpose: 'monochrome' }
  ],
  screenshots: [
    { src: 'screenshot-wide.png', sizes: '1280x720', type: 'image/png', form_factor: 'wide', label: 'Pick a level or play the daily puzzle' },
    { src: 'screenshot-menu.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'Pick a level or play the daily puzzle' },
    { src: 'screenshot-game.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'Slide the red block to the exit' }
  ]
}, null, 2));

fs.writeFileSync(path.join(__dirname, 'dist/sw.js'), `const C='huarong-${v}';
const FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable-512.png','./icon-monochrome-512.png','./apple-touch-icon.png'];
// cache:'reload' goes to the server, never the browser's HTTP cache, so a new version can't be filled with stale files
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>Promise.all(FILES.map(f=>fetch(f,{cache:'reload'}).then(r=>{if(!r.ok)throw new Error(f);return c.put(f,r)})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});
`);
console.log('built dist/index.html', (html.length / 1024).toFixed(1) + ' KB');

// Artifact variant: the host wraps the page in its own skeleton, so emit title + style + body content only.
const css = read('src/style.css');
const body = html.split('<body data-phase="setup">')[1].split('</body>')[0].replace(/<style>[\s\S]*?<\/style>/, '');
fs.writeFileSync(path.join(__dirname, 'dist/artifact.html'),
  '<title>Huarong Road</title>\n<style>' + css + '</style>\n' + body);
console.log('built dist/artifact.html');
