/* Service Worker — داشبورد عملکرد معاونت مهندسی */
'use strict';

const CACHE_NAME = 'engkpi-shell-v12';
const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css?v=charts12',
  './management.css?v=charts12',
  './industry.css?v=charts12',
  './assets/gas-compressor-station.webp',
  './app.js?v=charts12',
  './config.js?v=charts12',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // درخواست‌های Supabase، احراز هویت و API هرگز کش نمی‌شوند
  if (url.hostname.endsWith('.supabase.co') ||
      url.pathname.includes('/rest/v1/') ||
      url.pathname.includes('/auth/v1/')) {
    return;
  }

  // فقط فایل‌های هم‌دامنه (App Shell) با راهبرد Network-First
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: false }).then(hit => hit || caches.match('./index.html')))
  );
});
