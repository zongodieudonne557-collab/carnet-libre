// Import PDF : texte extrait avec PDF.js (fichier vendu avec l'appli, aucun envoi sur Internet).
// Les pages scannées ou illisibles passent par l'OCR quand il est permis et disponible.
import { reconstruct, toSections } from './pdftext.js';
import { acceptOcr, confidenceWarning } from './ocrtext.js';
import { ImportError, throwIfAborted } from './common.js';
import { sleep } from '../util.js';

const URLS = {
  lib: new URL('../../vendor/pdfjs/pdf.min.mjs', import.meta.url).href,
  worker: new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href,
  wasm: new URL('../../vendor/pdfjs/wasm/', import.meta.url).href,
};

let libPromise;
/** Charge PDF.js une seule fois (import dynamique : rien n'est téléchargé tant qu'on n'ouvre pas de PDF). */
export function loadPdfjs() {
  libPromise ??= import(URLS.lib)
    .then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = URLS.worker;
      return lib;
    })
    .catch(() => {
      libPromise = undefined;
      throw new ImportError(
        'Le lecteur de PDF n’a pas pu être chargé. Vérifie ta connexion (il n’est téléchargé qu’une fois, puis gardé hors ligne) et réessaie.',
        'failed'
      );
    });
  return libPromise;
}

function friendly(e) {
  switch (e?.name) {
    case 'PasswordException':
      return new ImportError('Ce PDF est protégé par un mot de passe. Ouvre-le, puis enregistre-le sans mot de passe avant de l’ajouter.', 'password');
    case 'InvalidPDFException':
    case 'FormatError':
      return new ImportError('Ce fichier PDF est illisible ou abîmé. Essaie de l’ouvrir puis de le réenregistrer en PDF.', 'corrupt');
    default:
      return new ImportError(`Ce PDF est illisible ou n’a pas pu être ouvert${e?.message ? ` (${String(e.message).slice(0, 120)})` : ''}.`, 'corrupt');
  }
}

/** Fragments de texte de PDF.js → coordonnées « origine en haut à gauche » prêtes pour pdftext.js. */
function toFrags(items, vp, Util) {
  const out = [];
  for (const it of items) {
    if (typeof it.str !== 'string') continue; // marqueurs de contenu
    const t = Util.transform(vp.transform, it.transform);
    const len = Math.hypot(t[0], t[1]) || 1;
    out.push({
      str: it.str,
      x: t[4],
      y: t[5],
      w: it.width,
      size: Math.hypot(t[2], t[3]) || it.height || 10,
      dx: t[0] / len,
      dy: t[1] / len,
    });
  }
  return out;
}

const IMAGE_OP_NAMES = [
  'paintImageXObject',
  'paintInlineImageXObject',
  'paintImageMaskXObject',
  'paintImageXObjectRepeat',
  'paintImageMaskXObjectRepeat',
  'paintInlineImageXObjectGroup',
  'paintImageMaskXObjectGroup',
];

async function hasImages(page, OPS) {
  const wanted = new Set(IMAGE_OP_NAMES.map((k) => OPS[k]).filter((v) => v !== undefined));
  const list = await page.getOperatorList();
  return list.fnArray.some((fn) => wanted.has(fn));
}

/** Dessine une page dans un canvas assez grand pour l'OCR (≈ 250 dpi pour une page A4). */
async function renderToCanvas(page, signal) {
  const base = page.getViewport({ scale: 1 });
  const k = Math.min(3000 / Math.max(base.width, base.height), Math.sqrt(8e6 / (base.width * base.height)));
  const viewport = page.getViewport({ scale: k });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const task = page.render({ canvasContext: ctx, canvas, viewport });
  const stop = () => task.cancel?.();
  signal?.addEventListener('abort', stop, { once: true });
  try {
    await task.promise;
  } finally {
    signal?.removeEventListener('abort', stop);
  }
  return canvas;
}

const SCANNED_NO_OCR =
  'Ce PDF est un document scanné : ses pages sont des images, sans texte à lire. Active la lecture par OCR (reconnaissance de texte) pour le convertir.';

/**
 * @param {Uint8Array} bytes contenu du PDF (consommé : PDF.js en prend possession)
 * @param {{
 *   signal?: AbortSignal,
 *   onProgress?: (p: {phase: 'read'|'ocr', done: number, total: number, page?: number}) => void,
 *   ocr?: 'auto'|'never',
 *   confirmOcr?: (info: {pages: number, pageNumbers: number[], scanned: number, garbled: number}) => boolean|Promise<boolean>,
 *   getOcr?: () => Promise<{recognize(source: any, o?: {signal?: AbortSignal}): Promise<{text: string, confidence: number}>}>,
 *   maxPages?: number, maxOcrPages?: number
 * }} [opts]
 * @returns {Promise<{pages: {label: string, text: string}[], meta: object, warnings: string[]}>}
 */
export async function extractPdf(bytes, { signal, onProgress, ocr = 'auto', confirmOcr, getOcr, maxPages = 500, maxOcrPages = 60 } = {}) {
  const lib = await loadPdfjs();
  throwIfAborted(signal);

  const task = lib.getDocument({
    data: bytes,
    wasmUrl: URLS.wasm,
    isEvalSupported: false, // la politique de sécurité de l'appli interdit eval
    disableFontFace: true,
    verbosity: lib.VerbosityLevel.ERRORS,
  });

  try {
    let doc;
    try {
      doc = await task.promise;
    } catch (e) {
      throw friendly(e);
    }

    const total = doc.numPages;
    const count = Math.min(total, maxPages);
    const warnings = [];
    if (total > count) warnings.push(`Seules les ${count} premières pages sur ${total} ont été lues (limite de l’appli).`);

    // 1. texte de chaque page
    const input = [];
    for (let p = 1; p <= count; p++) {
      throwIfAborted(signal);
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      input.push({ pageNumber: p, width: vp.width, height: vp.height, frags: toFrags(tc.items, vp, lib.Util) });
      page.cleanup();
      onProgress?.({ phase: 'read', done: p, total: count });
      if (p % 8 === 0) await sleep(0); // laisse respirer l'interface
    }
    const rec = reconstruct(input);
    const pages = rec.pages;

    // 2. pages à lire par OCR : scannées (sans texte mais avec image) ou au texte illisible
    const candidates = [];
    for (const pg of pages) {
      throwIfAborted(signal);
      if (pg.garbled) candidates.push({ pg, reason: 'garbled' });
      else if (pg.chars < 25) {
        const page = await doc.getPage(pg.pageNumber);
        if (await hasImages(page, lib.OPS)) candidates.push({ pg, reason: 'scan' });
        page.cleanup();
      }
    }

    let allowOcr = ocr !== 'never' && typeof getOcr === 'function';
    if (candidates.length && allowOcr && confirmOcr) {
      allowOcr =
        (await confirmOcr({
          pages: Math.min(candidates.length, maxOcrPages), // nombre de pages qui seraient lues
          pageNumbers: candidates.map((c) => c.pg.pageNumber),
          scanned: candidates.filter((c) => c.reason === 'scan').length,
          garbled: candidates.filter((c) => c.reason === 'garbled').length,
        })) !== false;
    }

    const ocrPages = [];
    const confidences = [];
    let ocrTried = false;
    let ocrError = '';
    if (candidates.length && allowOcr) {
      ocrTried = true;
      const todo = candidates.slice(0, maxOcrPages);
      if (candidates.length > todo.length) {
        warnings.push(`${candidates.length - todo.length} page(s) n’ont pas été lues par OCR (limite de ${maxOcrPages} pages par fichier). Découpe le PDF en deux pour les lire.`);
      }
      onProgress?.({ phase: 'ocr', done: 0, total: todo.length });
      let engine = null;
      try {
        engine = await getOcr();
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        ocrError = e?.message || 'Le module de lecture de texte (OCR) n’est pas disponible.';
        warnings.push(ocrError);
      }
      for (let i = 0; engine && i < todo.length; i++) {
        throwIfAborted(signal);
        const { pg } = todo[i];
        onProgress?.({ phase: 'ocr', done: i, total: todo.length, page: pg.pageNumber });
        const page = await doc.getPage(pg.pageNumber);
        let res;
        try {
          const canvas = await renderToCanvas(page, signal);
          try {
            res = await engine.recognize(canvas, { signal });
          } finally {
            canvas.width = canvas.height = 0;
          }
        } finally {
          page.cleanup();
        }
        if (acceptOcr(res, pg.text)) {
          pg.text = res.text.replace(/^#+(?=\s)/gm, '').trim(); // un « # » lu par erreur ne doit pas devenir un titre
          pg.chars = pg.text.replace(/\s/g, '').length;
          pg.garbled = false;
          ocrPages.push(pg.pageNumber);
          confidences.push(res.confidence);
        }
      }
      onProgress?.({ phase: 'ocr', done: todo.length, total: todo.length });
    }

    const scannedPages = candidates.filter((c) => c.reason === 'scan').map((c) => c.pg.pageNumber);
    const unread = scannedPages.filter((n) => !ocrPages.includes(n));
    const garbled = pages.filter((p) => p.garbled).map((p) => p.pageNumber);
    const avgConfidence = confidences.length ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : null;

    // rien de lisible du tout
    if (!pages.some((p) => p.chars >= 25)) {
      if (scannedPages.length && !ocrTried) throw new ImportError(SCANNED_NO_OCR, 'empty', { pages: scannedPages });
      if (scannedPages.length && ocrError) throw new ImportError(`Ce PDF est un document scanné, mais la lecture par OCR n’a pas pu démarrer. ${ocrError}`, 'empty', { pages: scannedPages });
      if (scannedPages.length) {
        throw new ImportError('Ce PDF est un document scanné et la lecture par OCR n’a rien donné de lisible (image floue, écriture manuscrite ?). Essaie avec une version plus nette.', 'empty');
      }
      throw new ImportError('Aucun texte trouvé dans ce PDF.', 'empty');
    }

    if (ocrPages.length) {
      const cw = confidenceWarning(avgConfidence);
      if (cw) warnings.push(cw);
    }
    if (unread.length) {
      const list = `${unread.slice(0, 8).join(', ')}${unread.length > 8 ? '…' : ''}`;
      warnings.push(
        ocrTried
          ? `${unread.length} page(s) sans texte lisible n’ont pas pu être converties (pages ${list}).`
          : `${unread.length} page(s) sont des images sans texte (pages ${list}) : elles sont ignorées sans OCR.`
      );
    }
    if (garbled.length) warnings.push(`Texte douteux sur ${garbled.length} page(s) (${garbled.slice(0, 8).join(', ')}${garbled.length > 8 ? '…' : ''}) : formules ou police spéciale ?`);

    return {
      pages: toSections(pages),
      meta: {
        kind: 'pdf',
        pages: total,
        readPages: count,
        ocrPages,
        ocrConfidence: avgConfidence,
        garbledPages: garbled,
        strippedLines: rec.stats.removed,
      },
      warnings,
    };
  } finally {
    await task.destroy().catch(() => {});
  }
}
