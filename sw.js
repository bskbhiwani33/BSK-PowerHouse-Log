const CACHE_NAME = "bsk-shell-v3";
const APP_SHELL = ["/", "/index.html", "/style.css", "/app.js", "/manifest.webmanifest"];
const FIREBASE_MODULES = [
  "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js",
  "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await Promise.all(FIREBASE_MODULES.map(url => cache.add(url).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("bsk-shell-") && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isAppAsset(request) {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/.netlify/") || url.pathname.startsWith("/api/")) return false;
  return APP_SHELL.includes(url.pathname) || /\\.(?:css|js|webmanifest|png|jpe?g|svg|ico|woff2?)$/i.test(url.pathname);
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || !isAppAsset(request)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    try {
      const fresh = await fetch(request);
      if (fresh && fresh.status === 200 && fresh.type === "basic") {
        cache.put(request, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (error) {
      if (cached) return cached;
      if (request.mode === "navigate") {
        const fallback = await cache.match("/index.html");
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});
