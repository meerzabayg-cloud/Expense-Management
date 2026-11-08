// Service worker: makes the app work offline and handles safe updates.
// Bump VERSION whenever any app file changes so phones download the update.
const VERSION = '1.0.0';
const SHELL_CACHE = `sfem-shell-${VERSION}`;
const OCR_CACHE = 'sfem-ocr-v1'; // large scanner files; only re-downloaded if this name changes

const SHELL = [
    './',
    'css/app.css',
    'icons/apple-touch-icon.png',
    'icons/favicon.svg',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/maskable-512.png',
    'icons/maskable.svg',
    'index.html',
    'js/app.js',
    'js/backup.js',
    'js/calc.js',
    'js/charts.js',
    'js/dates.js',
    'js/db.js',
    'js/images.js',
    'js/match.js',
    'js/money.js',
    'js/ocr.js',
    'js/receipt-parser.js',
    'js/repo.js',
    'js/theme.js',
    'js/ui.js',
    'js/units.js',
    'js/views/dashboard.js',
    'js/views/expenses.js',
    'js/views/forms.js',
    'js/views/funds.js',
    'js/views/help.js',
    'js/views/history.js',
    'js/views/items.js',
    'js/views/lists.js',
    'js/views/onboarding.js',
    'js/views/prices.js',
    'js/views/reports.js',
    'js/views/scan.js',
    'js/views/settings.js',
    'manifest.webmanifest',
];

const OCR = [
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
  './vendor/tesseract/eng.traineddata.gz',
  './vendor/tesseract/tesseract-core-lstm.wasm.js',
  './vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
    // The scanner is large: download it in the same step, but never fail the install because of it.
    try {
      const ocr = await caches.open(OCR_CACHE);
      for (const u of OCR) if (!(await ocr.match(u))) await ocr.add(new Request(u, { cache: 'reload' }));
    } catch (e) { /* will be fetched on first scan */ }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('sfem-') && k !== SHELL_CACHE && k !== OCR_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // the app never calls other sites
  if (req.mode === 'navigate') {
    event.respondWith((async () => (await caches.match('./index.html', { ignoreSearch: true })) || (await caches.match('./')) || fetch(req))());
    return;
  }
  event.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && url.pathname.includes('/vendor/tesseract/')) {
      const c = await caches.open(OCR_CACHE);
      c.put(req, res.clone());
    }
    return res;
  })());
});
