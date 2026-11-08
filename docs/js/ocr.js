// On-device receipt text recognition using Tesseract.js (WebAssembly).
// The engine and English language data are served from this app's own
// files and cached for offline use. Receipt images never leave the phone.

const BASE = new URL('../vendor/tesseract/', import.meta.url).href;
let workerPromise = null;
const CACHE_PATH = 'sfem-ocr';

// Tesseract's worker looks for language data in its own IndexedDB cache
// ("keyval-store") before using the network. We put the data there from the
// page, so the worker never needs the network (important on iPhone offline).
function seedLanguageCache(bytes) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('keyval-store');
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('keyval')) req.result.createObjectStore('keyval'); };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('keyval')) { db.close(); resolve(); return; }
      const t = db.transaction('keyval', 'readwrite');
      t.objectStore('keyval').put(bytes, `${CACHE_PATH}/eng.traineddata`);
      t.oncomplete = () => { db.close(); resolve(); };
      t.onerror = () => { db.close(); reject(t.error); };
    };
  });
}
let progressCb = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the scanner. If you are offline, open the app once while online so the scanner can be saved for offline use.'));
    document.head.appendChild(s);
  });
}

function simdSupported() {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch { return false; }
}

async function fetchOk(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Scanner file missing (${r.status}).`);
  return r;
}

async function createWorker() {
  if (typeof WebAssembly !== 'object') throw new Error('This browser cannot run the offline scanner. Please enter the receipt manually.');
  await loadScript(`${BASE}tesseract.min.js`);
  const coreFile = simdSupported() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js';
  // Fetch engine + language in the page (served from the offline cache), then hand them
  // to the worker directly so the worker itself never needs the network.
  const [coreBlob, lang] = await Promise.all([
    fetchOk(`${BASE}${coreFile}`).then((r) => r.blob()),
    fetchOk(`${BASE}eng.traineddata.gz`).then((r) => r.arrayBuffer()),
  ]);
  const coreURL = URL.createObjectURL(new Blob([coreBlob], { type: 'text/javascript' })) + '#.js';
  await seedLanguageCache(new Uint8Array(lang));
  const worker = await window.Tesseract.createWorker('eng', 1, {
    workerPath: `${BASE}worker.min.js`,
    corePath: coreURL,
    langPath: BASE.replace(/\/$/, ''),
    cachePath: CACHE_PATH,
    cacheMethod: 'readOnly',
    workerBlobURL: false,
    gzip: true,
    logger: (m) => progressCb?.(m),
    errorHandler: (e) => console.warn('OCR worker', e),
  });
  await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
  return worker;
}

export function getWorker() {
  if (!workerPromise) workerPromise = createWorker().catch((e) => { workerPromise = null; throw e; });
  return workerPromise;
}

/** Recognise text. Returns {text, lines:[{text, conf}], confidence}. */
export async function recognise(image, onProgress) {
  progressCb = onProgress;
  onProgress?.({ status: 'loading scanner', progress: 0 });
  const worker = await getWorker();
  const { data } = await worker.recognize(image);
  progressCb = null;
  const lines = (data.lines || []).map((l) => ({ text: (l.text || '').replace(/\n$/, ''), conf: l.confidence ?? 0 }));
  return { text: data.text || '', lines: lines.length ? lines : (data.text || '').split('\n').map((t) => ({ text: t, conf: data.confidence ?? 0 })), confidence: data.confidence ?? 0 };
}

export async function terminate() {
  if (!workerPromise) return;
  try { (await workerPromise).terminate(); } catch { /* ignore */ }
  workerPromise = null;
}

/** Check whether the scanner files are already in the offline cache. */
export async function scannerCached() {
  try {
    if (!('caches' in window)) return false;
    const names = ['tesseract.min.js', 'worker.min.js', 'eng.traineddata.gz', simdSupported() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js'];
    for (const n of names) if (!(await caches.match(`${BASE}${n}`))) return false;
    return true;
  } catch { return false; }
}

/** Download the scanner files into the offline cache (the service worker stores them). */
export async function prepareScanner() {
  const names = ['tesseract.min.js', 'worker.min.js', 'eng.traineddata.gz', 'tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'];
  if ('caches' in window) {
    const cache = await caches.open('sfem-ocr-v1');
    for (const n of names) {
      const url = `${BASE}${n}`;
      if (!(await cache.match(url))) await cache.add(url);
    }
  }
  return true;
}
