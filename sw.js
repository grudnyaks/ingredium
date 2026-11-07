// Service Worker: офлайн и обновления по воздуху.
// При выпуске новой версии меняется VERSION — браузер видит новый sw.js, ставит его в ожидание,
// приложение показывает «Доступно обновление», и по нажатию новая версия активируется.
const VERSION = "0.1.0";
const DATA = "2026-11-08.1";
const SHELL = `ingredium-shell-${VERSION}`;
const DATA_CACHE = `ingredium-data-${DATA}`;

const SHELL_FILES = [
  "./", "index.html", "manifest.webmanifest", "css/app.css",
  "js/app.js", "js/data.js", "js/store.js", "js/theme.js", "js/functions-ru.js",
  "js/learn-content.js", "js/quizgen.js", "js/scan.js",
  "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png", "icons/favicon-32.png"
];
const DATA_FILES = ["data/cards.json", "data/inci.json", "data/annex.json"].map((f) => `${f}?v=${DATA}`);

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(SHELL_FILES.map((u) => new Request(u, { cache: "reload" })));
    const data = await caches.open(DATA_CACHE);
    // Данные кэшируем по возможности: если сеть оборвётся, они докачаются при первом запросе.
    await Promise.all(DATA_FILES.map((u) => data.add(new Request(u, { cache: "reload" })).catch(() => {})));
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, DATA_CACHE]);
    for (const k of await caches.keys()) if (k.startsWith("ingredium-") && !keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => { if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting(); });

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // CDN распознавания и внешние ссылки — напрямую в сеть
  if (url.pathname.endsWith("/version.json") || url.pathname.endsWith("/sw.js")) return; // всегда из сети

  if (url.pathname.includes("/data/")) {
    e.respondWith((async () => {
      const c = await caches.open(DATA_CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    })());
    return;
  }

  e.respondWith((async () => {
    const c = await caches.open(SHELL);
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && url.pathname.startsWith(new URL("./", self.location).pathname)) c.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === "navigate") return (await c.match("index.html")) || Response.error();
      throw err;
    }
  })());
});
