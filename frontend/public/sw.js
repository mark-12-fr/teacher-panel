/* sw.js — AcadTrack Teacher Panel service worker.
 *
 * Two jobs:
 *   1. Push notifications (unchanged — see the push/notificationclick handlers).
 *   2. Offline app shell — so the teacher can open the app and read the last
 *      data they loaded even with no connection, the way the faci panel does.
 *
 * Offline strategy is deliberately SAFE for a live SSR Next.js app:
 *   • Documents (navigations) are NETWORK-FIRST — an online teacher ALWAYS gets
 *     fresh HTML, so a new deploy can never be masked by a stale cache and the
 *     app can never "black-screen" from serving old HTML that points at chunks
 *     that no longer exist. The cache is only ever a fallback when the network
 *     actually fails.
 *   • Immutable build assets (/_next/static/*, fonts, logo, manifest) are
 *     content-hashed, so they're cache-first (stale-while-revalidate) — instant
 *     repeat loads and available offline, and a hashed URL never serves the
 *     wrong content.
 *   • Cross-origin requests (the API backend, Supabase, avatars) are NOT
 *     intercepted at all — offline data reads/writes are handled in the app
 *     layer (the localStorage read-cache + save-on-reconnect), exactly like the
 *     faci panel handles its Supabase calls.
 *   • The fetch handler never rejects respondWith without a fallback, so a bug
 *     here can't take the online app down.
 */

const CACHE = "acadtrack-shell-v1";
const OFFLINE_URL = "/offline.html";
// Precache only URLs guaranteed to exist so install can never fail. The app
// shell (documents + chunks) fills in naturally as the teacher browses online.
const PRECACHE = [OFFLINE_URL, "/manifest.json", "/logo-192.png"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // add() each item tolerantly — one missing file must not abort install.
      Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})))
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older SW versions.
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

function isImmutableAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/manifest.json" ||
    url.pathname === "/logo-192.png" ||
    url.pathname === "/logo.jpg" ||
    /\.(?:js|css|woff2?|ttf|otf|png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname)
  );
}

function cacheable(response) {
  return (
    response &&
    response.ok &&
    response.status === 200 &&
    response.type === "basic" // same-origin, non-opaque
  );
}

// Cache-first with a background refresh — for immutable, content-hashed assets.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (cacheable(res)) cache.put(request, res.clone());
      return res;
    })
    .catch(() => undefined);
  return cached || (await network) || fetch(request);
}

// Network-first with a cache fallback — for documents and other dynamic GETs.
async function networkFirst(request, { isNavigation }) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (cacheable(res)) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (isNavigation) {
      const offline = await cache.match(OFFLINE_URL);
      if (offline) return offline;
      return new Response(
        "<!doctype html><meta charset=utf-8><title>Offline</title><body style=\"font-family:system-ui;padding:40px;text-align:center\"><h1>You're offline</h1><p>Reconnect and try again.</p>",
        { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 }
      );
    }
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return; // never touch POST/PATCH/DELETE

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return; // let cross-origin pass through

  const isNavigation =
    request.mode === "navigate" ||
    (request.headers.get("accept") || "").includes("text/html");

  if (isImmutableAsset(url) && !isNavigation) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  event.respondWith(networkFirst(request, { isNavigation }));
});

/* ── Push notifications (unchanged) ─────────────────────────────────────── */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    /* non-JSON payload — ignore */
  }
  const title = data.title || "AcadTrack";
  let body = data.body || "";
  if (data.submitted_at) {
    try {
      const t = new Date(data.submitted_at);
      const when = t.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      if (body) body += " · " + when;
    } catch (e) {
      /* keep body as-is */
    }
  }
  const options = {
    body: body,
    icon: "/logo-192.png",
    badge: "/logo-192.png",
    tag: data.tag || "acadtrack",
    renotify: true,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
