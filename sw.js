/**
 * sw.js - Service Worker（オフライン対応）
 * アプリファイルをキャッシュして、ネットワーク不要で動作させる
 */

const CACHE_NAME = 'cmf-v1';

const CORE_ASSETS = [
  '/index.html',
  '/css/base.css',
  '/css/layout.css',
  '/css/flashcard.css',
  '/css/components.css',
  '/js/app.js',
  '/js/srs.js',
  '/js/store.js',
  '/js/vocab.js',
  '/js/flashcard.js',
  '/js/session.js',
  '/js/stats.js',
  '/js/gestures.js',
  '/js/ui.js',
  '/data/categories.json',
  '/data/vocab-core.json',
];

const LAZY_ASSETS = [
  '/data/vocab-everyday.json',
  '/data/vocab-advanced.json',
];

// ─── インストール ────────────────────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(CORE_ASSETS)
    ).then(() => self.skipWaiting())
  );
});

// ─── アクティベート ──────────────────────────────────────────────────

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── フェッチ（Network First → Cache Fallback） ───────────────────────

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 同一オリジンのリクエストのみ処理
  if (url.origin !== location.origin) return;

  // GET のみキャッシュ
  if (event.request.method !== 'GET') return;

  // 語彙 JSON は Cache First（大きいファイルのため）
  if (url.pathname.startsWith('/data/')) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // JS/CSS/HTML は Network First（最新版を優先）
  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('オフラインです。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
