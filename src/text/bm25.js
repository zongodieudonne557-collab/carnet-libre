// Recherche plein texte BM25, 100 % locale, adaptée au français.
import { words } from './normalize.js';
import { STOPWORDS } from './stopwords.js';
import { stem } from './stem.js';

/** Transforme un texte en « termes » de recherche (mots utiles, racinisés). */
export function terms(text) {
  const out = [];
  for (const w of words(text)) {
    if (STOPWORDS.has(w)) continue;
    if (w.length < 2 && !/^\d$/.test(w)) continue;
    out.push(stem(w));
  }
  return out;
}

export class BM25 {
  /**
   * @param {{id: string, text: string}[]} docs
   * @param {{k1?: number, b?: number}} [opts]
   */
  constructor(docs, opts = {}) {
    this.k1 = opts.k1 ?? 1.4;
    this.b = opts.b ?? 0.75;
    this.ids = [];
    this.len = [];
    this.postings = new Map(); // terme → [[indexDoc, tf], …]
    let total = 0;
    docs.forEach((d, i) => {
      this.ids.push(d.id);
      const tf = new Map();
      const ts = terms(d.text);
      for (const t of ts) tf.set(t, (tf.get(t) || 0) + 1);
      this.len.push(ts.length);
      total += ts.length;
      for (const [t, n] of tf) {
        let list = this.postings.get(t);
        if (!list) this.postings.set(t, (list = []));
        list.push([i, n]);
      }
    });
    this.N = docs.length;
    this.avgLen = this.N ? total / this.N : 0;
  }

  idf(term) {
    const n = this.postings.get(term)?.length || 0;
    return Math.log(1 + (this.N - n + 0.5) / (n + 0.5));
  }

  /**
   * @param {string} query
   * @param {{limit?: number, allow?: (id: string) => boolean}} [opts]
   * @returns {{id: string, score: number}[]}
   */
  search(query, opts = {}) {
    const limit = opts.limit ?? 10;
    const qTerms = [...new Set(terms(query))];
    if (!qTerms.length || !this.N) return [];
    const scores = new Map();
    for (const t of qTerms) {
      const list = this.postings.get(t);
      if (!list) continue;
      const idf = this.idf(t);
      for (const [i, tf] of list) {
        const norm = 1 - this.b + (this.b * this.len[i]) / (this.avgLen || 1);
        const s = idf * ((tf * (this.k1 + 1)) / (tf + this.k1 * norm));
        scores.set(i, (scores.get(i) || 0) + s);
      }
    }
    const res = [];
    for (const [i, score] of scores) {
      const id = this.ids[i];
      if (opts.allow && !opts.allow(id)) continue;
      res.push({ id, score });
    }
    res.sort((a, b) => b.score - a.score);
    return res.slice(0, limit);
  }
}
