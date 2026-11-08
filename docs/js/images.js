// Image helpers for receipts: safe decoding, OCR pre-processing,
// compression for storage and a content hash for duplicate detection.

const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const ALLOWED = /^image\/(jpeg|png|webp|gif|bmp|heic|heif)$/i;

export function checkImageFile(file) {
  if (!file) throw new Error('No image selected.');
  if (file.size > MAX_INPUT_BYTES) throw new Error('This image is too large (over 25 MB). Please choose a smaller photo.');
  if (file.type && !ALLOWED.test(file.type)) throw new Error('Please choose a photo or screenshot (JPG, PNG, WEBP or HEIC).');
}

export async function loadBitmap(file) {
  // createImageBitmap respects photo orientation in modern browsers
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('This image could not be opened. Try a JPG or PNG screenshot.')); img.src = url; });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function canvasFor(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

function toBlob(canvas, type, quality) {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Image processing failed.'))), type, quality));
}

/** Greyscale + contrast-stretched copy sized for text recognition. */
export async function prepareForOCR(bitmap) {
  const w0 = bitmap.width; const h0 = bitmap.height;
  let scale = 1;
  if (w0 > 1800) scale = 1800 / w0;
  if (w0 < 900) scale = Math.min(2, 1200 / w0);
  if (h0 * scale > 6000) scale = 6000 / h0;
  const c = canvasFor(w0 * scale, h0 * scale);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = y; hist[y | 0]++;
  }
  // stretch between the 2nd and 98th percentile
  const total = c.width * c.height;
  let lo = 0; let hi = 255; let acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > total * 0.02) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > total * 0.02) { hi = i; break; } }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span));
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Compressed JPEG for keeping with the receipt (long side ≤ 1400 px). */
export async function compressForStorage(bitmap, { maxSide = 1400, quality = 0.6 } = {}) {
  const s = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const c = canvasFor(bitmap.width * s, bitmap.height * s);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bitmap, 0, 0, c.width, c.height);
  return toBlob(c, 'image/jpeg', quality);
}

export async function hashFile(file) {
  const buf = await file.arrayBuffer();
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
