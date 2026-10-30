// Point d'entrée des imports : reconnaît le type du fichier (par son contenu, pas seulement
// son extension), l'envoie au bon lecteur et renvoie des « pages » prêtes pour db.addSource().
import { unzipSync } from '../../vendor/fflate/fflate.js';
import { splitByHeadings } from '../text/chunk.js';
import { cleanText } from '../text/normalize.js';
import { formatBytes } from '../util.js';
import { extractDocx } from './docx.js';
import { extractPptx } from './pptx.js';
import { extractPdf } from './pdf.js';
import { ImportError } from './common.js';
import { acceptOcr, confidenceWarning } from './ocrtext.js';
import { decodeText, htmlToMarkdown, latexToMarkdown, stripFrontMatter, subtitlesToText } from './plain.js';

export const LIMITS = { maxBytes: 80 * 1024 * 1024, maxImageBytes: 40 * 1024 * 1024, maxChars: 3_000_000 };

/** Extensions proposées dans le sélecteur de fichiers. */
export const ACCEPT = '.pdf,.docx,.pptx,.txt,.md,.markdown,.html,.htm,.srt,.vtt,.tex,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,image/*';

export { ImportError }; // classe partagée avec les lecteurs (common.js)

const EXT = {
  pdf: 'pdf', docx: 'docx', pptx: 'pptx',
  txt: 'text', text: 'text', md: 'markdown', markdown: 'markdown', html: 'html', htm: 'html', xhtml: 'html',
  srt: 'subtitles', vtt: 'subtitles', tex: 'latex',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', bmp: 'image', avif: 'image',
  doc: 'legacy-office', ppt: 'legacy-office', pps: 'legacy-office', odt: 'open-document', odp: 'open-document', ods: 'spreadsheet', rtf: 'rtf',
  xls: 'spreadsheet', xlsx: 'spreadsheet', csv: 'spreadsheet', tsv: 'spreadsheet', epub: 'ebook', pages: 'legacy-office', key: 'legacy-office',
};

const REFUSAL = {
  'legacy-office': 'Ce format ancien (.doc, .ppt…) n’est pas lu directement. Ouvre le fichier dans Word, LibreOffice ou WPS Office, puis « Enregistrer sous » au format .docx (ou PDF).',
  'open-document': 'Les fichiers OpenDocument (.odt, .odp) ne sont pas encore pris en charge. Enregistre-les au format PDF ou .docx, puis ajoute-les.',
  spreadsheet: 'Les tableurs (.xls, .xlsx, .csv…) ne sont pas pris en charge. Copie les cellules utiles et colle-les comme texte, ou exporte la feuille en PDF.',
  rtf: 'Le format .rtf n’est pas pris en charge. Enregistre le document au format .docx ou PDF.',
  ebook: 'Les livres numériques (.epub) ne sont pas pris en charge. Exporte les pages utiles en PDF.',
  unknown: 'Ce type de fichier n’est pas reconnu. Formats acceptés : PDF, Word (.docx), PowerPoint (.pptx), texte, Markdown, page web (.html), sous-titres (.srt, .vtt), LaTeX (.tex) et images (photos de cahiers, scans).',
};

const at = (b, i, ...sig) => sig.every((v, k) => b[i + k] === v);
const ascii = (b, i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));

/** Type du fichier, d'après ses premiers octets puis son extension. */
export function detectKind(name, bytes) {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name || '')?.[1]?.toLowerCase() || '';
  const head = bytes.subarray(0, 1024);
  // l'en-tête %PDF- peut être précédé de quelques octets parasites, sauf dans un fichier clairement textuel
  if (ascii(head, 0, '%PDF-') || (indexOfAscii(head, '%PDF-') >= 0 && (!EXT[ext] || EXT[ext] === 'pdf'))) return 'pdf';
  const png = at(bytes, 0, 0x89, 0x50, 0x4e, 0x47);
  const jpeg = at(bytes, 0, 0xff, 0xd8, 0xff);
  const webp = ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP');
  const bmp = ascii(bytes, 0, 'BM') && ext === 'bmp';
  if (png || jpeg || webp || bmp || ascii(bytes, 0, 'GIF8') || ascii(bytes, 4, 'ftypavif')) return 'image';
  if (at(bytes, 0, 0xd0, 0xcf, 0x11, 0xe0)) return ext === 'xls' ? 'spreadsheet' : 'legacy-office';
  if (at(bytes, 0, 0x50, 0x4b, 0x03, 0x04)) {
    const names = [];
    try {
      unzipSync(bytes, { filter: (f) => (names.push(f.name), false) });
    } catch {
      return EXT[ext] === 'docx' || EXT[ext] === 'pptx' ? EXT[ext] : 'unknown'; // archive abîmée : l'extracteur dira pourquoi
    }
    if (names.includes('word/document.xml')) return 'docx';
    if (names.includes('ppt/presentation.xml')) return 'pptx';
    if (names.includes('xl/workbook.xml')) return 'spreadsheet';
    if (names.some((n) => n === 'content.xml') && names.includes('mimetype')) return 'open-document';
    return 'unknown';
  }
  const byExt = EXT[ext];
  if (byExt && !['pdf', 'docx', 'pptx', 'image'].includes(byExt)) return byExt;
  if (byExt) return EXT[ext] === 'image' ? 'image' : 'unknown'; // extension d'un format binaire mais contenu différent
  // sans extension connue : du texte ?
  const sample = bytes.subarray(0, 4096);
  return sample.length && !sample.includes(0) ? 'text' : 'unknown';
}

function indexOfAscii(head, s) {
  const first = s.charCodeAt(0);
  outer: for (let i = 0; i <= head.length - s.length; i++) {
    if (head[i] !== first) continue;
    for (let k = 1; k < s.length; k++) if (head[i + k] !== s.charCodeAt(k)) continue outer;
    return i;
  }
  return -1;
}

export function titleFromName(name) {
  return String(name || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || 'Sans titre';
}

/** Longs textes sans titres : découpés en parties de ~4000 caractères (repère de citation « partie 3 »). */
function partsOf(text, size = 4000) {
  const paras = text.split(/\n{2,}/);
  const parts = [];
  let buf = '';
  for (const p of paras) {
    if (buf && buf.length + p.length > size) {
      parts.push(buf);
      buf = '';
    }
    buf = buf ? `${buf}\n\n${p}` : p;
  }
  if (buf) parts.push(buf);
  return parts.length > 1 ? parts.map((t, i) => ({ label: `partie ${i + 1}`, text: t })) : [{ label: null, text }];
}

/** Titres Markdown → sections ; texte long sans titre → parties. */
function structure(text) {
  const pages = splitByHeadings(text);
  if (pages.length === 1 && pages[0].label === null && pages[0].text.length > 6000) return partsOf(pages[0].text);
  return pages;
}

function finish(res, warnings) {
  let pages = res.pages.map((p) => ({ label: p.label ?? null, text: String(p.text ?? '').trim() })).filter((p) => p.text);
  if (!pages.length) throw new ImportError('Aucun texte exploitable dans ce fichier.', 'empty');
  let total = 0;
  const kept = [];
  for (const p of pages) {
    if (total + p.text.length > LIMITS.maxChars) {
      warnings.push('Le document est très long : la fin a été ignorée.');
      break;
    }
    total += p.text.length;
    kept.push(p);
  }
  pages = kept;
  return { ...res, pages, warnings, meta: { ...res.meta, chars: total } };
}

/**
 * Crée une session d'import. Le moteur d'OCR (lourd) n'est démarré qu'au premier besoin
 * et partagé par tous les fichiers de la session : appeler `close()` à la fin.
 * @param {{ocr?: 'auto'|'never', confirmOcr?: Function}} [session]
 */
export function createImporter(session = {}) {
  let engine = null;
  const getOcr = async () => {
    if (!engine) engine = await (await import('./ocr.js')).createOcr({});
    return engine;
  };

  return {
    /**
     * @param {File} file
     * @param {{signal?: AbortSignal, onProgress?: Function, title?: string}} [opts]
     * @returns {Promise<{title: string, kind: string, pages: {label: string|null, text: string}[], meta: object, warnings: string[]}>}
     */
    async importFile(file, { signal, onProgress, title } = {}) {
      const name = file.name || 'document';
      if (!file.size) throw new ImportError('Ce fichier est vide.', 'empty');
      if (file.size > LIMITS.maxBytes) throw new ImportError(`Ce fichier est trop volumineux (${formatBytes(file.size)}). La limite est de ${formatBytes(LIMITS.maxBytes)}.`, 'too_big');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const kind = detectKind(name, bytes);
      if (REFUSAL[kind]) throw new ImportError(REFUSAL[kind], 'unsupported');
      const warnings = [];
      let extractedTitle = '';
      let res;
      try {
        switch (kind) {
          case 'pdf':
            res = await extractPdf(bytes, { signal, onProgress, ocr: session.ocr, confirmOcr: session.confirmOcr, getOcr });
            warnings.push(...res.warnings);
            break;
          case 'docx':
            res = extractDocx(bytes);
            break;
          case 'pptx':
            res = extractPptx(bytes);
            break;
          case 'image': {
            if (file.size > LIMITS.maxImageBytes) throw new ImportError(`Cette image est trop lourde (${formatBytes(file.size)}). Réduis-la ou prends une photo moins grande.`, 'too_big');
            if (session.ocr === 'never') throw new ImportError('La lecture des images (OCR) est désactivée.', 'ocr_off');
            onProgress?.({ phase: 'ocr', done: 0, total: 1 });
            let r;
            try {
              const ocr = await getOcr();
              r = await ocr.recognize(file, { signal, onProgress: (p) => onProgress?.({ phase: 'ocr', done: p, total: 1 }) });
            } catch (e) {
              if (e?.name === 'AbortError') engine = null;
              throw e;
            }
            if (!acceptOcr(r)) throw new ImportError('Aucun texte lisible n’a été trouvé sur cette image. Essaie une photo plus nette, bien éclairée et cadrée sur le texte imprimé (l’écriture manuscrite est mal lue).', 'empty');
            const cw = confidenceWarning(r.confidence);
            if (cw) warnings.push(cw);
            res = { pages: [{ label: null, text: r.text }], meta: { kind: 'image', ocrConfidence: r.confidence } };
            break;
          }
          case 'html': {
            const r = htmlToMarkdown(decodeText(bytes).text);
            extractedTitle = r.title;
            res = { pages: structure(r.text), meta: { kind: 'html' } };
            break;
          }
          case 'subtitles': {
            const t = subtitlesToText(decodeText(bytes).text);
            res = { pages: partsOf(t), meta: { kind: 'subtitles' } };
            break;
          }
          case 'latex': {
            const r = latexToMarkdown(decodeText(bytes).text);
            extractedTitle = r.title;
            res = { pages: structure(r.text), meta: { kind: 'latex' } };
            break;
          }
          case 'markdown':
          case 'text': {
            const { text: raw } = decodeText(bytes);
            const fm = kind === 'markdown' ? stripFrontMatter(raw) : { text: raw, title: '' };
            extractedTitle = fm.title;
            res = { pages: structure(cleanText(fm.text, { keepIndent: 'all' })), meta: { kind } };
            break;
          }
          default:
            throw new ImportError(REFUSAL.unknown, 'unsupported');
        }
      } catch (e) {
        if (e instanceof ImportError || e?.name === 'AbortError') throw e;
        throw new ImportError(e?.message || 'Lecture du fichier impossible.', e?.code || 'failed');
      }
      const out = finish(res, warnings);
      return { title: (title || extractedTitle || titleFromName(name)).slice(0, 120), kind: res.meta?.kind || kind, ...out };
    },

    /** Texte collé ou saisi à la main. */
    importText(text, { title } = {}) {
      const clean = cleanText(String(text ?? ''), { keepIndent: 'all' });
      if (clean.replace(/\s/g, '').length < 20) throw new ImportError('Ce texte est trop court pour servir de source.', 'empty');
      const out = finish({ pages: structure(clean), meta: { kind: 'paste' } }, []);
      return { title: (title || 'Texte collé').slice(0, 120), kind: 'paste', ...out };
    },

    async close() {
      const e = engine;
      engine = null;
      await e?.close().catch(() => {});
    },
  };
}
