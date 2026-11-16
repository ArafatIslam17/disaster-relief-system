/*
 * Field app service worker (NFR08: works with no network for days).
 *
 * - App shell: the /field routes are precached on install and refreshed whenever the app reports it
 *   is online. Every /_next/static asset referenced by those pages (and fonts referenced by their
 *   CSS) is cached too, so a cold start with no network renders the full app.
 * - Navigations under /field: network-first with a 4 s timeout (2G-friendly), falling back to cache.
 * - /_next/static and icons: cache-first (content-hashed, immutable).
 * - /api/*: never cached. Household data lives encrypted in IndexedDB, not in the HTTP cache.
 */
const VERSION = "v1";
const SHELL_CACHE = `field-shell-${VERSION}`;
const STATIC_CACHE = `field-static-${VERSION}`;
const SHELL_ROUTES = ["/field", "/field/register", "/field/distribute", "/field/records", "/field/sync"];
const EXTRA_ASSETS = ["/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png"];
const STATIC_LIMIT = 400;
const NAV_TIMEOUT_MS = 4000;

const ASSET_RE = /\/_next\/static\/[^"'\s)\\<>]+/g;

async function refreshShell() {
  const shell = await caches.open(SHELL_CACHE);
  const statics = await caches.open(STATIC_CACHE);
  const assets = new Set(EXTRA_ASSETS);
  for (const route of SHELL_ROUTES) {
    try {
      const res = await fetch(route, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) continue;
      const html = await res.clone().text();
      await shell.put(route, res);
      for (const m of html.matchAll(ASSET_RE)) assets.add(m[0]);
    } catch {
      // Offline during refresh: keep the previous shell.
    }
  }
  const cssAssets = [...assets].filter((a) => a.endsWith(".css"));
  for (const css of cssAssets) {
    try {
      const res = await fetch(css);
      if (!res.ok) continue;
      const text = await res.clone().text();
      await statics.put(css, res);
      for (const m of text.matchAll(ASSET_RE)) assets.add(m[0]);
    } catch {
      // Ignore; it will be cached on first use.
    }
  }
  await Promise.all(
    [...assets].map(async (url) => {
      if (await statics.match(url)) return;
      try {
        const res = await fetch(url);
        if (res.ok) await statics.put(url, res);
      } catch {
        // Ignore; it will be cached on first use.
      }
    }),
  );
  await trimStatic();
}

async function trimStatic() {
  const statics = await caches.open(STATIC_CACHE);
  const keys = await statics.keys();
  for (let i = 0; i < keys.length - STATIC_LIMIT; i++) await statics.delete(keys[i]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(refreshShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
      for (const name of await caches.keys()) if (name.startsWith("field-") && !keep.has(name)) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "REFRESH_SHELL") event.waitUntil(refreshShell());
});

async function cacheFirst(request) {
  const statics = await caches.open(STATIC_CACHE);
  const hit = await statics.match(request, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) statics.put(request, res.clone()).then(trimStatic);
  return res;
}

async function networkFirstPage(request, pathname) {
  const shell = await caches.open(SHELL_CACHE);
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NAV_TIMEOUT_MS)),
    ]);
    if (res.ok) await shell.put(pathname, res.clone());
    return res;
  } catch {
    const cached = (await shell.match(pathname)) || (await shell.match("/field"));
    if (cached) return cached;
    return new Response("<!doctype html><meta charset=utf-8><title>Offline</title><p>Offline. Open the app once with a network connection.</p>", {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/static/") || EXTRA_ASSETS.includes(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  const isField = url.pathname === "/field" || url.pathname.startsWith("/field/");
  if (isField && request.mode === "navigate") {
    event.respondWith(networkFirstPage(request, url.pathname.replace(/\/$/, "") || "/field"));
  }
});
