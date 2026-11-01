// Mode hors ligne : savoir ce qui est déjà gardé sur l'appareil, et le préparer à l'avance.
// L'appli elle-même est gardée par le service worker (sw.js) ; les gros fichiers (lecteur de PDF, OCR)
// ne le sont qu'au premier usage, ou ici à la demande, pour ne pas faire télécharger 15 Mo à tout le monde.
import { createOcr, ocrSupported } from './import/ocr.js';
import { loadPdfjs } from './import/pdf.js';

const abs = (p) => new URL(`../${p}`, import.meta.url).href;

export const offlineSupported = () =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof caches !== 'undefined' && globalThis.isSecureContext !== false;

/** Liste des fichiers connus du service worker (lue dans precache.js, le même fichier que lui). */
export async function readPrecache() {
  const res = await fetch(abs('precache.js'), { cache: 'no-store' });
  if (!res.ok) throw new Error('precache.js introuvable');
  const text = await res.text();
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}

async function cachedUrls() {
  const urls = new Set();
  for (const name of await caches.keys()) {
    if (!name.startsWith('carnet-')) continue;
    for (const req of await (await caches.open(name)).keys()) urls.add(req.url);
  }
  return urls;
}

/**
 * @returns {Promise<{supported: boolean, active: boolean, app: boolean, pdf: boolean, ocr: boolean}>}
 *   active : le service worker contrôle cette page ; app / pdf / ocr : prêt hors ligne ou non.
 */
export async function offlineStatus() {
  if (!offlineSupported()) return { supported: false, active: false, app: false, pdf: false, ocr: false };
  const active = !!navigator.serviceWorker.controller;
  const urls = await cachedUrls();
  const has = (p) => urls.has(abs(p));
  const app = active && has('index.html') && has('src/main.js');
  const pdf = has('vendor/pdfjs/pdf.min.mjs') && has('vendor/pdfjs/pdf.worker.min.mjs');
  const core = [...urls].some((u) => u.startsWith(abs('vendor/tesseract/core/')));
  const ocr = has('vendor/tesseract/tesseract.esm.min.js') && has('vendor/tesseract/worker.min.js') && has('vendor/tesseract/lang/fra.traineddata.gz') && core;
  return { supported: true, active, app, pdf, ocr };
}

const mo = (bytes) => `${Math.max(1, Math.round(bytes / 1048576))} Mo`;

/** Taille approximative de ce qu'il reste à télécharger, pour l'annoncer avant. */
export async function lazySize() {
  try {
    const p = await readPrecache();
    return mo(p.lazyBytes);
  } catch {
    return '15 Mo';
  }
}

/**
 * Télécharge à l'avance le lecteur de PDF et l'OCR : le service worker les garde dans le cache.
 * @param {{onStep?: (label: string) => void, signal?: AbortSignal}} [opts]
 */
export async function prepareOffline({ onStep, signal } = {}) {
  const st = await offlineStatus();
  if (!st.supported) throw new Error('Ce navigateur ne sait pas garder l’appli hors ligne.');
  if (!st.active) throw new Error('Le mode hors ligne n’est pas encore actif : recharge la page une fois, puis réessaie.');
  const check = () => {
    if (signal?.aborted) throw new DOMException('Annulé.', 'AbortError');
  };
  const pre = await readPrecache();
  const fetchAll = async (paths) => {
    for (const p of paths) {
      check();
      const res = await fetch(abs(p), { signal });
      if (!res.ok) throw new Error(`Fichier introuvable : ${p}`);
      await res.arrayBuffer(); // lire jusqu'au bout : c'est là que le service worker le range dans le cache
    }
  };

  if (!st.pdf) {
    onStep?.('Lecteur de PDF…');
    await fetchAll(pre.lazy.filter((p) => p.startsWith('vendor/pdfjs/')));
    await loadPdfjs();
  }
  if (!st.ocr && ocrSupported()) {
    onStep?.('Lecture de texte sur images (OCR)…');
    await fetchAll(pre.lazy.filter((p) => p.startsWith('vendor/tesseract/') && !p.startsWith('vendor/tesseract/core/')));
    check();
    // On démarre vraiment le moteur : c'est lui qui choisit (et donc télécharge) la bonne variante de calcul pour cet appareil.
    const ocr = await createOcr();
    await ocr.close();
  }
  return offlineStatus();
}
