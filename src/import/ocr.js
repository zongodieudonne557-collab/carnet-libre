// OCR hors ligne (Tesseract.js + modèle français « best_int », embarqués dans vendor/).
// Navigateur uniquement. Aucun envoi sur Internet : le moteur, le modèle et l'image restent sur l'appareil.
import { reflowOcr } from './ocrtext.js';

const BASE = new URL('../../vendor/tesseract/', import.meta.url);

export function ocrSupported() {
  return typeof WebAssembly === 'object' && typeof Worker !== 'undefined' && typeof document !== 'undefined';
}

const abortError = () => new DOMException('Import annulé.', 'AbortError');

/**
 * Prépare une image pour l'OCR : redimensionnement raisonnable (≈ 300 dpi pour une page A4),
 * puis suppression des ombres et de l'éclairage inégal (le fond est ramené au blanc).
 * @param {HTMLCanvasElement|ImageBitmap|Blob|File} source
 * @param {{longSide?: number, minSide?: number, flatten?: boolean}} [opts]
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function prepareForOcr(source, { longSide = 3000, minSide = 1600, flatten: doFlatten = true } = {}) {
  let bitmap = null;
  let drawable = source;
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    try {
      bitmap = await createImageBitmap(source);
    } catch {
      throw Object.assign(new Error('Ce format d’image n’est pas pris en charge par ton navigateur. Utilise une photo JPEG ou PNG.'), { code: 'unsupported' });
    }
    drawable = bitmap;
  }
  const w = drawable.width;
  const h = drawable.height;
  if (!w || !h) throw new Error('Image vide.');
  const long = Math.max(w, h);
  let k = Math.min(1, longSide / long, Math.sqrt(8e6 / (w * h)));
  if (long < minSide) k = Math.min(2.5, minSide / long); // petite image : on agrandit (le texte doit faire ≥ 20 px)
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(drawable, 0, 0, canvas.width, canvas.height);
  bitmap?.close?.();
  if (doFlatten) flatten(canvas);
  return canvas;
}

/** Ramène le fond de l'image au blanc (divise chaque pixel par le niveau local du papier). */
export function flatten(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;
  const gray = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) gray[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;

  // niveau du papier par blocs de B × B pixels : moyenne de la moitié la plus claire du bloc
  const B = 16;
  const bw = Math.ceil(w / B);
  const bh = Math.ceil(h / B);
  let bg = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const x1 = Math.min(w, (bx + 1) * B);
      const y1 = Math.min(h, (by + 1) * B);
      let sum = 0;
      let cnt = 0;
      for (let y = by * B; y < y1; y++) for (let x = bx * B; x < x1; x++) (sum += gray[y * w + x]), cnt++;
      const mean = sum / cnt;
      let hi = 0;
      let hc = 0;
      for (let y = by * B; y < y1; y++) {
        for (let x = bx * B; x < x1; x++) {
          const g = gray[y * w + x];
          if (g >= mean) (hi += g), hc++;
        }
      }
      bg[by * bw + bx] = hc ? hi / hc : mean;
    }
  }
  // lissage : le texte ne doit pas creuser le fond (2 passes de flou 3 × 3)
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(bg.length);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        let s = 0;
        let c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) (s += bg[yy * bw + xx]), c++;
          }
        }
        next[y * bw + x] = s / c;
      }
    }
    bg = next;
  }
  // division par le fond, interpolé bilinéairement entre les centres de blocs
  for (let y = 0; y < h; y++) {
    const fy = Math.min(bh - 1, Math.max(0, (y + 0.5) / B - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(bh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1, Math.max(0, (x + 0.5) / B - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(bw - 1, x0 + 1);
      const tx = fx - x0;
      const top = bg[y0 * bw + x0] * (1 - tx) + bg[y0 * bw + x1] * tx;
      const bot = bg[y1 * bw + x0] * (1 - tx) + bg[y1 * bw + x1] * tx;
      const paper = Math.max(64, top * (1 - ty) + bot * ty);
      const v = Math.min(255, (gray[y * w + x] * 255) / paper);
      const j = (y * w + x) * 4;
      d[j] = d[j + 1] = d[j + 2] = v;
      d[j + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Crée un moteur d'OCR (un worker Tesseract). À fermer avec `close()`.
 * @param {{onStatus?: (m: object) => void}} [opts]
 */
export async function createOcr({ onStatus } = {}) {
  if (!ocrSupported()) {
    throw Object.assign(new Error('La lecture de texte sur image (OCR) n’est pas disponible sur cet appareil ou ce navigateur.'), { code: 'unsupported' });
  }
  let mod;
  try {
    mod = await import(new URL('tesseract.esm.min.js', BASE).href);
  } catch {
    throw Object.assign(new Error('Impossible de charger le module d’OCR. Vérifie ta connexion puis réessaie.'), { code: 'failed' });
  }
  const Tesseract = mod.default ?? mod;
  let progressCb = null;
  let worker;
  try {
    worker = await Tesseract.createWorker('fra', 1, {
      workerPath: new URL('worker.min.js', BASE).href,
      corePath: new URL('core/', BASE).href,
      langPath: new URL('lang/', BASE).href,
      workerBlobURL: false,
      cacheMethod: 'none', // le modèle est déjà un fichier local (et mis en cache par le service worker)
      gzip: true,
      logger: (m) => {
        onStatus?.(m);
        if (m?.status === 'recognizing text') progressCb?.(m.progress);
      },
    });
    await worker.setParameters({ user_defined_dpi: '300' });
  } catch (e) {
    throw Object.assign(new Error(`Le moteur d’OCR n’a pas pu démarrer (${e?.message || e}).`), { code: 'failed' });
  }

  let closed = false;
  return {
    /**
     * @param {HTMLCanvasElement|ImageBitmap|Blob|File} source
     * @param {{signal?: AbortSignal, onProgress?: (p: number) => void, prepare?: boolean}} [opts]
     * @returns {Promise<{text: string, confidence: number, raw: string}>}
     */
    async recognize(source, { signal, onProgress, prepare = true } = {}) {
      if (closed) throw new Error('Le moteur d’OCR est fermé.');
      if (signal?.aborted) throw abortError();
      const canvas = prepare ? await prepareForOcr(source) : source;
      progressCb = onProgress || null;
      const onAbort = () => {
        closed = true;
        worker.terminate();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const { data } = await worker.recognize(canvas);
        return { text: reflowOcr(data.text), confidence: Math.round(data.confidence), raw: data.text };
      } catch (e) {
        if (signal?.aborted) throw abortError();
        throw e;
      } finally {
        signal?.removeEventListener('abort', onAbort);
        progressCb = null;
        if (prepare && canvas !== source) canvas.width = canvas.height = 0;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await worker.terminate();
    },
  };
}
