const CACHE_NAME = "hsa-notes-shell-v6";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/variables.css",
  "./css/base.css",
  "./css/layout.css",
  "./css/components.css",
  "./css/pages.css",
  "./css/rtl.css",
  "./assets/logo/hsa-notes-logo.svg",
  "./assets/icons/sprite.svg",
  "./assets/icons/icon-192.svg",
  "./assets/icons/icon-512.svg",
  "./assets/lang/ar.json",
  "./assets/lang/en.json",
  "./assets/fonts/Cairo-Arabic-Light.woff2",
  "./assets/fonts/Cairo-Latin-Light.woff2",
  "./assets/fonts/Cairo-LatinExt-Light.woff2",
  "./assets/fonts/Cairo-Arabic-Regular.woff2",
  "./assets/fonts/Cairo-Latin-Regular.woff2",
  "./assets/fonts/Cairo-LatinExt-Regular.woff2",
  "./assets/fonts/Cairo-Arabic-Medium.woff2",
  "./assets/fonts/Cairo-Latin-Medium.woff2",
  "./assets/fonts/Cairo-LatinExt-Medium.woff2",
  "./assets/fonts/Cairo-Arabic-SemiBold.woff2",
  "./assets/fonts/Cairo-Latin-SemiBold.woff2",
  "./assets/fonts/Cairo-LatinExt-SemiBold.woff2",
  "./assets/fonts/Cairo-Arabic-Bold.woff2",
  "./assets/fonts/Cairo-Latin-Bold.woff2",
  "./assets/fonts/Cairo-LatinExt-Bold.woff2",
  "./assets/fonts/Cairo-Arabic-ExtraBold.woff2",
  "./assets/fonts/Cairo-Latin-ExtraBold.woff2",
  "./assets/fonts/Cairo-LatinExt-ExtraBold.woff2",
  "./js/about.js",
  "./js/apikeys.js",
  "./js/auth.js",
  "./js/crypto-utils.js",
  "./js/dashboard.js",
  "./js/drive-sync.js",
  "./js/credentials.js",
  "./js/i18n.js",
  "./js/main.js",
  "./js/notes.js",
  "./js/password-generator.js",
  "./js/router.js",
  "./js/settings.js",
  "./js/storage.js",
  "./js/ui.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request).then((response) => {
        if (response && response.ok && response.type === "basic") {
          const responseCopy = response.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseCopy))
          );
        }
        return response;
      }).catch(() => {
        if (request.mode === "navigate") {
          return caches.match("./index.html");
        }
        return Response.error();
      });
    })
  );
});
