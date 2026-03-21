/**
 * sw.js - Service Worker（オフライン対応）
 * アプリファイルをキャッシュして、ネットワーク不要で動作させる
 * GitHub Pages（サブパス）にも対応
 */

const CACHE_NAME = 'cmf-v17';

// sw.js の置き場所からベースパスを動的に取得
// localhost: '/'  /  GitHub Pages: '/taiwan-flashcard/'
const BASE = new URL('./', self.location.href).pathname;

// プリキャッシュ対象（基本レベル語彙のみ先行キャッシュ）
// 大容量の level3-5 は使用時にキャッシュ
const CORE_ASSETS = [
  `${BASE}index.html`,
  `${BASE}manifest.json`,
  `${BASE}css/base.css`,
  `${BASE}css/layout.css`,
  `${BASE}css/flashcard.css`,
  `${BASE}css/components.css`,
  `${BASE}js/app.js`,
  `${BASE}js/srs.js`,
  `${BASE}js/store.js`,
  `${BASE}js/vocab.js`,
  `${BASE}js/flashcard.js`,
  `${BASE}js/session.js`,
  `${BASE}js/stats.js`,
  `${BASE}js/gestures.js`,
  `${BASE}js/ui.js`,
  `${BASE}data/vocab-novice1.json`,
  `${BASE}data/vocab-novice2.json`,
  `${BASE}data/vocab-level1.json`,
  `${BASE}data/vocab-level2.json`,
  `${BASE}data/vocab-level3.json`,
  `${BASE}data/vocab-level4.json`,
  `${BASE}data/vocab-level5.json`,
  `${BASE}apple-touch-icon.png`,
  `${BASE}icon-192.png`,
  `${BASE}icon-512.png`,
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

  // 語彙 JSON は Cache First（バージョン番号で更新管理）、その他は Network First
  const isVocabJson = url.pathname.match(/\/data\/vocab-.*\.json$/);
  event.respondWith(isVocabJson ? cacheFirst(event.request) : networkFirst(event.request));
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
