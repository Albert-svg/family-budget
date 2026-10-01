/* Family Budget service worker: app shell offline. API calls always go to the network. */
const VERSION = "budget-v5";
const SHELL = ["/", "/index.html", "/app.css", "/app.js", "/manifest.webmanifest",
  "/icons/icon-192.png?v=1", "/icons/icon-512.png?v=1", "/icons/apple-touch-icon.png?v=1"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (url.origin !== location.origin && !isFont) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/cdn-cgi/")) return;
  if (isFont) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put(e.request, c)); return r; })));
    return;
  }
  // Network first (redirects to the Cloudflare sign-in page pass straight through), cache when offline.
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && r.type === "basic") { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request.mode === "navigate" ? "/" : e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request.mode === "navigate" ? "/" : e.request)));
});
