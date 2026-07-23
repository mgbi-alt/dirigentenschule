// Service Worker – Dirigentenschule (App-Shell-Cache, network-first)
const CACHE = 'dirschule-v6';
const ASSETS = ['./','./index.html','./css/main.css','./js/config.js','./js/app.js','./manifest.json'];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e=>{
  const req=e.request;
  // Supabase-Aufrufe immer aus dem Netz
  if(req.url.includes('supabase')||req.method!=='GET') return;
  // Network-first: immer die neueste Version laden, Cache nur als Offline-Fallback.
  // (Cache-first verhinderte frueher, dass Aenderungen bei Nutzern ankamen.)
  e.respondWith(
    fetch(req).then(res=>{
      const copy=res.clone();
      caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});
      return res;
    }).catch(()=>caches.match(req))
  );
});
