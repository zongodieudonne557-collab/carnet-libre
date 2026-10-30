// Choix des extraits envoyés au modèle (« RAG ») et lecture des citations dans sa réponse.
import { BM25 } from '../text/bm25.js';

export const CHARS_PER_TOKEN = 3.6;

/** Quantité de texte envoyée au service d'IA à chaque demande (protège les quotas gratuits). */
export const BUDGETS = {
  small: { label: 'Petit', tokens: 3000, hint: 'Pour les offres très limitées' },
  medium: { label: 'Moyen', tokens: 6000, hint: 'Bon équilibre (recommandé)' },
  large: { label: 'Grand', tokens: 12000, hint: 'Plus complet, consomme plus de quota' },
};

export function buildIndex(chunks) {
  return new BM25(chunks.map((c) => ({ id: c.id, text: c.text })));
}

function totalChars(chunks) {
  let n = 0;
  for (const c of chunks) n += c.text.length;
  return n;
}

/** Choisit des extraits répartis régulièrement sur l'ensemble du texte, dans la limite du budget. */
function evenly(chunks, budgetChars, taken = new Set()) {
  const pool = chunks.filter((c) => !taken.has(c.id));
  if (!pool.length) return [];
  const avg = totalChars(pool) / pool.length;
  const k = Math.max(1, Math.min(pool.length, Math.floor(budgetChars / Math.max(avg, 1))));
  if (k >= pool.length) return pool;
  const picked = [];
  let used = 0;
  for (let i = 0; i < k; i++) {
    const idx = k === 1 ? Math.floor(pool.length / 2) : Math.round((i * (pool.length - 1)) / (k - 1));
    const c = pool[idx];
    if (picked.includes(c)) continue;
    if (used + c.text.length > budgetChars && picked.length) break;
    picked.push(c);
    used += c.text.length;
  }
  return picked;
}

/**
 * @param {{id: string, sourceId: string, idx: number, label: string|null, text: string}[]} chunks
 *        extraits des sources actives, DANS L'ORDRE DE LECTURE
 * @param {{query?: string, budgetTokens?: number, index?: BM25}} [opts]
 * @returns {{n: number, chunk: object}[]} extraits numérotés à partir de 1, dans l'ordre de lecture
 */
export function selectContext(chunks, opts = {}) {
  if (!chunks.length) return [];
  const budgetChars = Math.floor((opts.budgetTokens ?? BUDGETS.medium.tokens) * CHARS_PER_TOKEN);
  const order = new Map(chunks.map((c, i) => [c.id, i]));
  let chosen;

  if (totalChars(chunks) <= budgetChars) {
    chosen = chunks.slice(); // tout tient : on envoie tout, le modèle voit le cours entier
  } else {
    const q = (opts.query || '').trim();
    const hits = q ? (opts.index || buildIndex(chunks)).search(q, { limit: 60 }) : [];
    chosen = [];
    const taken = new Set();
    let used = 0;
    const byId = new Map(chunks.map((c) => [c.id, c]));
    for (const h of hits) {
      const c = byId.get(h.id);
      if (!c) continue;
      if (used + c.text.length > budgetChars && chosen.length >= 3) break;
      chosen.push(c);
      taken.add(c.id);
      used += c.text.length;
    }
    // Peu de résultats utiles : on complète avec une couverture régulière du cours.
    if (hits.length < 3 || used < budgetChars * 0.35) {
      const rest = evenly(chunks, budgetChars - used, taken);
      for (const c of rest) {
        if (used + c.text.length > budgetChars && chosen.length) break;
        chosen.push(c);
        used += c.text.length;
      }
    }
  }
  chosen.sort((a, b) => order.get(a.id) - order.get(b.id));
  return chosen.map((chunk, i) => ({ n: i + 1, chunk }));
}

/** Mise en forme des extraits pour le prompt : « [2] « Titre » — p. 3 » puis le texte. */
export function formatContext(items, sourceTitleById) {
  return items
    .map(({ n, chunk }) => {
      const title = sourceTitleById.get(chunk.sourceId) || 'Source';
      const where = chunk.label ? ` — ${chunk.label}` : '';
      return `[${n}] « ${title} »${where}\n${chunk.text}`;
    })
    .join('\n\n---\n\n');
}

const CITE_RE = /\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\](?!\()/g;

/**
 * Normalise les citations d'une réponse : « [1, 3] » → « [1][3] », « 【2】 » → « [2] »,
 * et retire les numéros qui ne correspondent à aucun extrait envoyé.
 * @returns {{text: string, cited: number[]}}
 */
export function parseCitations(raw, maxN) {
  const cited = new Set();
  let text = String(raw ?? '').replace(/【\s*(\d{1,3})\s*】/g, '[$1]');
  text = text.replace(CITE_RE, (_m, list) => {
    const ok = list
      .split(/[,;]/)
      .map((s) => parseInt(s, 10))
      .filter((n) => n >= 1 && n <= maxN);
    ok.forEach((n) => cited.add(n));
    return ok.map((n) => `[${n}]`).join('');
  });
  // espace parasite avant la ponctuation laissé par un numéro supprimé
  text = text.replace(/ +([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ');
  return { text: text.trim(), cited: [...cited].sort((a, b) => a - b) };
}

/** Requête de recherche pour une question de suivi courte (« et pour le cas 2 ? »). */
export function searchQueryFor(question, history = []) {
  const q = String(question || '').trim();
  if (q.split(/\s+/).length >= 6) return q;
  const prevUser = [...history].reverse().find((m) => m.role === 'user');
  return prevUser ? `${prevUser.content} ${q}` : q;
}
