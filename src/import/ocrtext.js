// Mise en forme du texte renvoyé par l'OCR et décision de l'accepter ou non.
// Module pur (testé sans navigateur).
import { joinLines, textQuality } from './pdftext.js';

const LIST_ITEM = /^(?:[-•*·–—]\s|\d{1,2}[.)]\s)/;

/**
 * Tesseract renvoie une ligne par ligne visuelle et un saut de ligne vide entre blocs :
 * on recolle les lignes d'un même paragraphe (mots coupés réparés) et on garde les puces.
 */
export function reflowOcr(raw) {
  const blocks = String(raw ?? '')
    .replace(/\r/g, '')
    .replace(/­/g, '')
    .split(/\n{2,}/);
  const out = [];
  for (const block of blocks) {
    const acc = [];
    for (const l of block.split('\n').map((x) => x.replace(/[ \t]+/g, ' ').trim()).filter(Boolean)) {
      if (acc.length && !LIST_ITEM.test(l)) acc[acc.length - 1] = joinLines(acc[acc.length - 1], l);
      else acc.push(l);
    }
    if (acc.length) out.push(acc.join('\n'));
  }
  return out.join('\n\n');
}

/**
 * Faut-il remplacer le texte actuel d'une page par le résultat de l'OCR ?
 * @param {{text: string, confidence?: number}} res
 * @param {string} [current] texte déjà extrait de la page (couche texte du PDF)
 */
export function acceptOcr(res, current = '') {
  const text = String(res?.text ?? '').trim();
  if (text.replace(/\s/g, '').length < 15) return false;
  if (typeof res.confidence === 'number' && res.confidence < 35) return false; // du bruit, pas du texte
  const q = textQuality(text);
  if (q.garbled) return false;
  const cur = textQuality(current);
  if (!current.trim() || cur.chars < 25) return true;
  return cur.garbled || q.score > cur.score + 0.1;
}

/** Message d'avertissement selon la confiance moyenne de lecture (0–100), ou chaîne vide. */
export function confidenceWarning(avg) {
  if (typeof avg !== 'number' || Number.isNaN(avg)) return '';
  if (avg < 55) return 'Lecture peu sûre (écriture manuscrite, photo floue ou sombre ?). Relis le texte extrait et corrige-le si besoin.';
  if (avg < 75) return 'Lecture moyennement sûre : vérifie le texte extrait avant de t’en servir pour réviser.';
  return '';
}
