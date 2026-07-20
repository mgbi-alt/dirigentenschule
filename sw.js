// Service Worker – Dirigentenschule (einfacher App-Shell-Cache)
const CACHE = 'dirschule-v2';
const ASSETS = ['./','./index.html','./css/main.css','./js/config.js','./js/app.js','./manifest.json'];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e=>{
  const url=e.request.url;
  // Supabase-Aufrufe immer aus dem Netz
  if(url.includes('supabase')||e.request.method!=='GET') return;
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
