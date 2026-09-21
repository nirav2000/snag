const CACHE='snag-v12';
const BUILD='2026.09.21.1605';
const ASSETS=['./','./index.html','./styles.css?v='+BUILD,'./notes.css?v='+BUILD,'./app.js?v='+BUILD,'./notes.js?v='+BUILD,'./firebase-config.js?v='+BUILD,'./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  const core=url.pathname.endsWith('/snag/')||url.pathname.endsWith('/index.html')||url.pathname.endsWith('/app.js')||url.pathname.endsWith('/firebase-config.js')||url.pathname.endsWith('/version.json')||url.pathname.endsWith('/sw.js');
  if(core){
    event.respondWith(fetch(event.request,{cache:'no-store'}).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));return r}).catch(()=>caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));return r})));
});
