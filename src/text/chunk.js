// Découpage d'un texte en « extraits » (chunks) d'environ 900 caractères.
// Chaque extrait garde son étiquette (page, diapo, section) pour les citations.
// Pas de chevauchement : les extraits forment une partition propre du texte
// (le contexte voisin est rajouté au moment de la recherche).

const SENTENCE_SPLIT = /(?<=[.!?…»)])\s+(?=[A-ZÀ-ÖØ-Þ0-9(«"“\-•])/u;

/** Découpe un texte en phrases (heuristique adaptée au français courant). */
export function splitSentences(text) {
  return String(text ?? '')
    .split(SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitParagraphs(text) {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function hardSplit(text, max) {
  const out = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Coupe un paragraphe trop long en morceaux ≤ max, de préférence entre deux phrases. */
function splitLong(par, max) {
  if (par.length <= max) return [par];
  const sentences = par.split(SENTENCE_SPLIT);
  const out = [];
  let buf = '';
  for (const s of sentences) {
    if (s.length > max) {
      if (buf) out.push(buf), (buf = '');
      out.push(...hardSplit(s, max));
      continue;
    }
    if (buf && buf.length + s.length + 1 > max) {
      out.push(buf);
      buf = s;
    } else {
      buf = buf ? buf + ' ' + s : s;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * @param {{label?: string|null, text: string}[]} pages
 * @param {{target?: number, max?: number, min?: number}} [opts]
 * @returns {{idx: number, label: string|null, text: string}[]}
 */
export function chunkPages(pages, opts = {}) {
  const target = opts.target ?? 900;
  const max = opts.max ?? 1400;
  const min = opts.min ?? 160;
  const raw = [];

  for (const page of pages) {
    const label = page.label ?? null;
    let buf = '';
    const flush = () => {
      const t = buf.trim();
      if (t) raw.push({ label, text: t });
      buf = '';
    };
    for (const par of splitParagraphs(page.text || '')) {
      for (const piece of splitLong(par, max)) {
        if (buf && buf.length + piece.length + 2 > target) flush();
        buf = buf ? buf + '\n\n' + piece : piece;
      }
    }
    flush();
  }

  // Fusionne les très petits extraits avec le précédent de même étiquette.
  const merged = [];
  for (const c of raw) {
    const prev = merged[merged.length - 1];
    if (prev && c.text.length < min && prev.label === c.label && prev.text.length + c.text.length + 2 <= max) {
      prev.text += '\n\n' + c.text;
    } else {
      merged.push({ ...c });
    }
  }
  return merged.map((c, idx) => ({ idx, label: c.label, text: c.text }));
}

const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;

/**
 * Découpe un texte Markdown / brut en « pages » logiques selon les titres (# …).
 * Un titre sans texte (ex. le titre du cours suivi directement d'un sous-titre) est
 * rattaché à la section suivante au lieu de former un extrait vide.
 * Sans titre, renvoie une seule page.
 */
export function splitByHeadings(text) {
  const pages = [];
  let cur = { label: null, lines: [], body: false };
  for (const line of String(text ?? '').split('\n')) {
    const m = HEADING.exec(line);
    if (m) {
      let carry = [];
      if (cur.body) pages.push(cur);
      else carry = cur.lines.filter((l) => l.trim());
      cur = { label: '§ ' + m[2].trim().slice(0, 60), lines: [...carry, line], body: false };
    } else {
      cur.lines.push(line);
      if (line.trim()) cur.body = true;
    }
  }
  if ((cur.body || !pages.length) && cur.lines.join('').trim()) pages.push(cur);
  return pages.map((p) => ({ label: p.label, text: p.lines.join('\n') }));
}
