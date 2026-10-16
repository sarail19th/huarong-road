// Inlines CSS + JS into one self-contained dist/index.html and writes PWA files.
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
// function replacers so "$&"-style sequences in the source are never interpreted
const html = read('src/index.html')
  .replace('/*INLINE_CSS*/', () => read('src/style.css'))
  .replace('/*INLINE_SOLVER*/', () => read('src/solver.js'))
  .replace('/*INLINE_LEVELS*/', () => read('src/levels.js'))
  .replace('/*INLINE_GAME*/', () => read('src/game.js'));
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/index.html'), html);

fs.writeFileSync(path.join(__dirname, 'dist/manifest.webmanifest'), JSON.stringify({
  name: 'Huarong Road', short_name: 'Huarong', start_url: './', scope: './', display: 'standalone',
  orientation: 'portrait', background_color: '#0d1117', theme_color: '#0d1117',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
}, null, 2));

const v = Date.now().toString(36);
fs.writeFileSync(path.join(__dirname, 'dist/sw.js'), `const C='huarong-${v}';
const FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
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
