// Vérifie qu'une « preuve » (citation courte donnée par l'IA) se trouve bien dans l'extrait cité.
// C'est le garde-fou anti-invention : une carte ou une question dont la preuve n'existe pas
// dans tes sources est marquée « à vérifier » dans l'interface.
import { foldAccents } from './normalize.js';

function norm(s) {
  return foldAccents(String(s ?? ''))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Score entre 0 et 1 : part de la citation retrouvée dans le texte.
 * 1 = citation exacte (insensible aux accents, à la casse et à la ponctuation).
 */
export function quoteScore(quote, text) {
  const q = norm(quote);
  const t = norm(text);
  if (!q || !t) return 0;
  if (t.includes(q)) return 1;
  const qw = q.split(' ');
  const tw = t.split(' ');
  if (qw.length < 4) {
    const set = new Set(tw);
    return qw.filter((w) => set.has(w)).length / qw.length;
  }
  const grams = new Set();
  for (let i = 0; i + 2 < tw.length; i++) grams.add(`${tw[i]} ${tw[i + 1]} ${tw[i + 2]}`);
  let hit = 0;
  let total = 0;
  for (let i = 0; i + 2 < qw.length; i++) {
    total++;
    if (grams.has(`${qw[i]} ${qw[i + 1]} ${qw[i + 2]}`)) hit++;
  }
  return total ? hit / total : 0;
}

export function isGrounded(quote, text, threshold = 0.5) {
  return quoteScore(quote, text) >= threshold;
}

/** Cherche la position (approximative) d'une citation dans un texte, pour la surligner. */
export function findQuoteRange(quote, text) {
  const raw = String(quote ?? '').trim();
  if (!raw) return null;
  const direct = text.toLowerCase().indexOf(raw.toLowerCase());
  if (direct >= 0) return [direct, direct + raw.length];
  // Repli : on cherche les 4 premiers mots, puis les 4 derniers.
  const ws = raw.split(/\s+/);
  if (ws.length < 5) return null;
  const head = ws.slice(0, 4).join(' ');
  const tail = ws.slice(-4).join(' ');
  const lower = text.toLowerCase();
  const a = lower.indexOf(head.toLowerCase());
  if (a < 0) return null;
  const bIdx = lower.indexOf(tail.toLowerCase(), a);
  if (bIdx >= 0) return [a, bIdx + tail.length];
  return [a, Math.min(text.length, a + raw.length)];
}
