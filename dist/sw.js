const C='huarong-3447a99';
const FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable-512.png','./icon-monochrome-512.png','./apple-touch-icon.png'];
// Other apps on the same origin (github.io) share Cache Storage: only ever delete our own 'huarong-' caches.
// cache:'reload' goes to the server, never the browser's HTTP cache, so a new version can't be filled with stale files
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>Promise.all(FILES.map(f=>fetch(f,{cache:'reload'}).then(r=>{if(!r.ok)throw new Error(f);return c.put(f,r)})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('huarong-')&&k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
// Cache first; anything loaded online and missing is saved, so a wiped cache refills itself on the next online visit.
self.addEventListener('fetch',e=>{const q=e.request;if(q.method!=='GET'||new URL(q.url).origin!==location.origin)return;e.respondWith(caches.open(C).then(c=>c.match(q).then(r=>r||fetch(q).then(res=>{if(res.ok&&!new URL(q.url).search)c.put(q,res.clone());return res},err=>q.mode==='navigate'?c.match('./').then(x=>x||Promise.reject(err)):Promise.reject(err)))))});
