// Fabrication des contenus d'étude SANS IA, et petites fonctions de tri / d'export.
// Tout est pur (pas de DOM, pas de réseau) : ce fichier est testé directement avec node:test.
import { foldAccents } from '../text/normalize.js';
import { shuffle } from '../util.js';
import { autoCards, keyTerms, sentenceUnits } from './heuristics.js';
import { isDue, newSrs } from './srs.js';

/** Clé de comparaison de deux textes : sans accents, sans ponctuation, en minuscules. */
export const normKey = (s) =>
  foldAccents(String(s ?? ''))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:]+$/, '')}…`;
};

// ------------------------------------------------------------------ cartes

/** Retire les candidates dont le recto existe déjà (ou qui font doublon entre elles). */
export function freshCards(candidates, existing = []) {
  const seen = new Set(existing.map((c) => normKey(c.front)));
  const out = [];
  for (const c of candidates) {
    const k = normKey(c.front);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/** Carte prête à enregistrer, à partir d'un résultat de `autoCards` (ou d'une saisie). */
export function toStoredCard(c, { chunkById = new Map(), titleById = new Map(), origin = 'auto' } = {}) {
  const chunk = c.chunkId ? chunkById.get(c.chunkId) : null;
  return {
    front: c.front,
    back: c.back,
    quote: c.quote || '',
    verified: c.verified ?? (origin === 'own' ? null : true),
    origin,
    ...(c.kind ? { kind: c.kind } : {}),
    chunkId: chunk?.id ?? c.chunkId ?? null,
    sourceId: chunk?.sourceId ?? c.sourceId ?? null,
    sourceTitle: chunk ? titleById.get(chunk.sourceId) || null : c.sourceTitle ?? null,
    label: chunk?.label ?? c.label ?? null,
    srs: newSrs(),
  };
}

export const CARD_FILTERS = [
  { id: 'all', label: 'Toutes' },
  { id: 'due', label: 'À revoir' },
  { id: 'new', label: 'Nouvelles' },
  { id: 'check', label: 'À vérifier' },
  { id: 'auto', label: 'Automatiques' },
  { id: 'ai', label: 'Par l’IA' },
  { id: 'own', label: 'Les miennes' },
];

export function matchesFilter(card, id, now = Date.now()) {
  switch (id) {
    case 'due':
      return !!card.srs && card.srs.state !== 'new' && isDue(card.srs, now);
    case 'new':
      return !card.srs || card.srs.state === 'new';
    case 'check':
      return card.verified === false;
    case 'auto':
      return card.origin === 'auto';
    case 'ai':
      return card.origin === 'ai';
    case 'own':
      return card.origin === 'own' || card.origin === 'quiz';
    default:
      return true;
  }
}

/** Compte pour la page « Réviser ». */
export function cardCounts(cards, now = Date.now(), newLimit = 15) {
  let due = 0;
  let fresh = 0;
  let learned = 0;
  let toCheck = 0;
  for (const c of cards) {
    const s = c.srs || newSrs();
    if (c.verified === false) toCheck++;
    if (s.state === 'new') fresh++;
    else if (isDue(s, now)) due++;
    if (s.state === 'review' && s.interval >= 21) learned++;
  }
  return { total: cards.length, due, fresh, todayNew: Math.min(fresh, newLimit), learned, toCheck };
}

// ------------------------------------------------------------------ exports de cartes

const htmlEscape = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const originTag = { auto: 'automatique', ai: 'ia', own: 'perso', quiz: 'quiz' };

/** Fichier texte à importer dans Anki (champs séparés par des tabulations). */
export function cardsToAnki(cards) {
  const field = (s) => htmlEscape(s).replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
  const lines = cards.map((c) => {
    const tags = ['carnet-libre', originTag[c.origin] || 'perso', c.verified === false ? 'a-verifier' : ''].filter(Boolean).join(' ');
    return `${field(c.front)}\t${field(c.back)}\t${tags}`;
  });
  return `#separator:tab\n#html:true\n#tags column:3\n${lines.join('\n')}\n`;
}

/** Tableur (séparateur « ; » pour Excel en français), avec BOM UTF-8. */
export function cardsToCSV(cards, titleById = new Map()) {
  const cell = (s) => {
    let t = String(s ?? '').replace(/\r?\n/g, ' ⏎ ');
    // une cellule qui commence par = + - @ serait prise pour une formule par le tableur
    if (/^[=+\-@]/.test(t)) t = `'${t}`;
    return `"${t.replace(/"/g, '""')}"`;
  };
  const head = ['Recto', 'Verso', 'Source', 'Origine', 'À vérifier'].map(cell).join(';');
  const rows = cards.map((c) =>
    [c.front, c.back, c.sourceTitle || titleById.get(c.sourceId) || '', originTag[c.origin] || 'perso', c.verified === false ? 'oui' : ''].map(cell).join(';')
  );
  return `﻿${[head, ...rows].join('\r\n')}\r\n`;
}

// ------------------------------------------------------------------ quiz construit à partir des cartes

const shortAnswer = (c) => clip(String(c.back ?? '').split('\n')[0], 160);
const groupOf = (c) => (c.kind === 'cloze' ? 'cloze' : 'other');

/**
 * Quiz à choix multiple fabriqué à partir des cartes (sans IA) : la bonne réponse est le verso,
 * les mauvaises sont les versos d'autres cartes de même nature, de longueur voisine.
 * @returns {{title: string, origin: 'cards', questions: object[], attempts: []}|null}  null s'il faut plus de cartes
 */
export function quizFromCards(cards, { count = 10, rand = Math.random } = {}) {
  const usable = cards.filter((c) => c.front && shortAnswer(c));
  const answers = new Map(); // normKey → texte (réponses distinctes)
  for (const c of usable) if (!answers.has(normKey(shortAnswer(c)))) answers.set(normKey(shortAnswer(c)), shortAnswer(c));
  if (usable.length < 4 || answers.size < 4) return null;

  const questions = [];
  for (const c of shuffle(usable, rand)) {
    if (questions.length >= count) break;
    const good = shortAnswer(c);
    const gk = normKey(good);
    const sameGroup = usable.filter((o) => o !== c && groupOf(o) === groupOf(c));
    const pool = (list) => {
      const seen = new Set([gk]);
      const out = [];
      for (const o of list) {
        const a = shortAnswer(o);
        const k = normKey(a);
        if (!k || seen.has(k) || k.includes(gk) || gk.includes(k)) continue;
        seen.add(k);
        out.push(a);
      }
      return out;
    };
    let candidates = pool(sameGroup);
    if (candidates.length < 3) candidates = pool(usable.filter((o) => o !== c));
    if (candidates.length < 3) continue;
    const near = candidates.map((a) => ({ a, d: Math.abs(a.length - good.length) + rand() * 6 })).sort((x, y) => x.d - y.d).slice(0, 6).map((x) => x.a);
    const wrong = shuffle(near, rand).slice(0, 3);
    const choices = shuffle([good, ...wrong], rand);
    const rest = String(c.back).split('\n\n').slice(1).join(' ').trim();
    questions.push({
      question: c.front,
      choices,
      answer: choices.indexOf(good),
      explanation: rest,
      quote: c.quote || '',
      verified: c.verified ?? null,
      chunkId: c.chunkId ?? null,
      sourceId: c.sourceId ?? null,
      sourceTitle: c.sourceTitle ?? null,
      label: c.label ?? null,
    });
  }
  if (!questions.length) return null;
  return { title: 'Quiz de tes cartes', origin: 'cards', questions, attempts: [] };
}

/** Cartes à créer à partir des questions ratées d'un quiz. */
export function mistakesToCards(quiz, wrongIdx) {
  return wrongIdx
    .map((i) => quiz.questions[i])
    .filter(Boolean)
    .map((q) => ({
      front: q.question,
      back: [q.choices[q.answer], q.explanation].filter(Boolean).join('\n\n'),
      quote: q.quote || '',
      verified: q.verified ?? null,
      origin: 'quiz',
      chunkId: q.chunkId ?? null,
      sourceId: q.sourceId ?? null,
      sourceTitle: q.sourceTitle ?? null,
      label: q.label ?? null,
      srs: newSrs(),
    }));
}

/** Meilleur score (en %) et dernier score d'un quiz. */
export function quizHistory(quiz) {
  const a = (quiz.attempts || []).filter((x) => x && x.total > 0);
  if (!a.length) return { tries: 0, best: null, last: null };
  const pct = (x) => Math.round((100 * x.score) / x.total);
  return { tries: a.length, best: Math.max(...a.map(pct)), last: pct(a[a.length - 1]) };
}

// ------------------------------------------------------------------ fiche et diapos sans IA

/** Cite un extrait dans un texte : renvoie « [n] » et mémorise la référence. */
function makeCiter(sources) {
  const titles = new Map(sources.map((s) => [s.id, s.title]));
  const refs = [];
  const numbers = new Map();
  const cite = (chunk) => {
    if (!chunk) return '';
    if (!numbers.has(chunk.id)) {
      if (numbers.size >= 99) return '';
      numbers.set(chunk.id, numbers.size + 1);
      refs.push({ n: numbers.size, chunkId: chunk.id, sourceId: chunk.sourceId, sourceTitle: titles.get(chunk.sourceId) || 'Source', label: chunk.label ?? null });
    }
    return ` [${numbers.get(chunk.id)}]`;
  };
  return { cite, refs };
}

const headingOf = (label) => (label && label.startsWith('§ ') ? label.slice(2).trim() : null);

/**
 * Fiche automatique : mots-clés, définitions repérées et plan, avec renvoi à l'extrait de chaque définition.
 * @returns {{kind: 'auto', title: string, markdown: string, refs: object[]}|null}  null s'il n'y a rien à en tirer
 */
export function autoNote(chunks, sources) {
  const { cite, refs } = makeCiter(sources);
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const parts = [];

  const terms = keyTerms(chunks, 12);
  if (terms.length) parts.push(`## Mots-clés\n\n${terms.map((t) => `- **${t.term}** (${t.count} fois)`).join('\n')}`);

  const defs = autoCards(chunks, { max: 40 }).filter((c) => c.kind === 'def');
  if (defs.length) {
    const lines = defs.map((d) => {
      const m = /^Définis : (.+)$/.exec(d.front);
      const text = d.back.replace(/\s+/g, ' ').trim();
      return `- ${m ? `**${m[1]}** : ${text}` : `**${d.front}** ${text}`}${cite(byId.get(d.chunkId))}`;
    });
    parts.push(`## Définitions repérées\n\n${lines.join('\n')}`);
  }

  const plan = [];
  for (const s of sources) {
    const heads = [];
    for (const c of chunks) {
      if (c.sourceId !== s.id) continue;
      const hd = headingOf(c.label);
      if (hd && !heads.includes(hd)) heads.push(hd);
    }
    if (heads.length) plan.push(`### ${s.title}\n\n${heads.map((x, i) => `${i + 1}. ${x}`).join('\n')}`);
  }
  if (plan.length) parts.push(`## Plan de tes sources\n\n${plan.join('\n\n')}`);

  if (!parts.length) return null;
  return { kind: 'auto', title: 'Fiche automatique', markdown: parts.join('\n\n'), refs };
}

/** « § Les stomates » → « Les stomates » ; « p. 3 » → « Page 3 ». */
export function slideTitle(label) {
  const t = String(label ?? '').trim();
  const page = /^p\.?\s*(\d+)/i.exec(t);
  if (page) return `Page ${page[1]}`;
  return clip(headingOf(t) ?? t, 80) || 'Diapositive';
}

/**
 * Diaporama sans IA : une diapositive par titre (ou par page) de tes sources, avec les premières phrases.
 * @returns {{title: string, origin: 'headings', slides: object[]}|null}  null si les sources n'ont ni titres ni pages
 */
export function deckFromHeadings(chunks, sources, { max = 12 } = {}) {
  const groups = [];
  const index = new Map();
  for (const c of chunks) {
    if (!c.label) continue;
    const key = `${c.sourceId}|${c.label}`;
    let g = index.get(key);
    if (!g) {
      g = { label: c.label, chunks: [] };
      index.set(key, g);
      groups.push(g);
    }
    g.chunks.push(c);
  }
  const slides = [];
  for (const g of groups) {
    const units = sentenceUnits(g.chunks.map((c) => c.text).join('\n')).filter((u) => u.text.length >= 12);
    if (!units.length) continue;
    slides.push({
      title: slideTitle(g.label),
      bullets: units.slice(0, 4).map((u) => clip(u.text, 150)),
      formula: '',
      narration: clip(units.slice(0, 6).map((u) => u.text).join(' '), 900),
      chunkId: g.chunks[0].id,
    });
  }
  if (slides.length < 2) return null;
  let picked = slides;
  if (slides.length > max) {
    picked = Array.from({ length: max }, (_, i) => slides[Math.floor((i * slides.length) / max)]);
  }
  const first = sources[0]?.title;
  return { title: first && sources.length === 1 ? `Diaporama : ${clip(first, 60)}` : 'Diaporama de tes sources', origin: 'headings', slides: picked };
}

// ------------------------------------------------------------------ exports de textes

/** Fichier Markdown d'une fiche, avec la liste des extraits cités. */
export function noteToFile(note) {
  const refs = (note.refs || []).map((r) => `- [${r.n}] ${r.sourceTitle}${r.label ? ` — ${r.label.replace(/^§ /, '')}` : ''}`);
  return `# ${note.title}\n\n${note.markdown.trim()}\n${refs.length ? `\n---\n\nSources citées :\n\n${refs.join('\n')}\n` : ''}`;
}

/** Transcription d'une causerie. */
export function castToText(cast, hosts = { A: 'Awa', B: 'Issa' }) {
  return `${cast.title}\n\n${cast.turns.map((t) => `${hosts[t.who] || t.who} : ${t.text}`).join('\n\n')}\n`;
}

/** Texte de lecture à voix haute d'un diaporama (pour l'impression et la copie). */
export function deckToText(deck) {
  return `${deck.title}\n\n${deck.slides.map((s, i) => `${i + 1}. ${s.title}\n${s.bullets.map((b) => `   - ${b}`).join('\n')}\n   ${s.narration}`).join('\n\n')}\n`;
}
