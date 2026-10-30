// Orchestration : choisit les extraits, interroge le modèle, contrôle sa réponse,
// et rend des objets prêts à être enregistrés (avec la source de chaque élément).
import { getSettings } from '../settings.js';
import { newSrs } from '../study/srs.js';
import { chat, AIError } from './client.js';
import { parseModelJSON, JSONError } from './json.js';
import { BUDGETS, buildIndex, formatContext, parseCitations, searchQueryFor, selectContext } from './rag.js';
import { CAST_LENGTHS, NOTE_KINDS, castMessages, cardsMessages, chatMessages, noteMessages, quizMessages, slidesMessages } from './prompts.js';
import { normalizeCards, normalizeCast, normalizeQuiz, normalizeSlides } from './validate.js';

/** Extraits choisis + texte du prompt. `index` (BM25) peut être réutilisé d'un appel à l'autre. */
export function prepareContext({ chunks, sources, query, budget, index }) {
  const titles = new Map(sources.map((s) => [s.id, s.title]));
  const tokens = (BUDGETS[budget] || BUDGETS.medium).tokens;
  const items = selectContext(chunks, { query, budgetTokens: tokens, index });
  return { items, titles, text: formatContext(items, titles) };
}

export const makeIndex = buildIndex;

const refOf = (chunk, titles) => ({
  chunkId: chunk.id,
  sourceId: chunk.sourceId,
  sourceTitle: titles.get(chunk.sourceId) || 'Source',
  label: chunk.label,
});

/** Références des extraits cités dans un texte (numéro → passage). */
export function refsFor(items, cited, titles) {
  const byN = new Map(items.map((i) => [i.n, i.chunk]));
  return cited.filter((n) => byN.has(n)).map((n) => ({ n, ...refOf(byN.get(n), titles) }));
}

function requireChunks(items) {
  if (!items.length) throw new AIError('config', 'Ajoute (et active) au moins une source avant de générer quoi que ce soit.');
}

// ---------------------------------------------------------------- discussion
/**
 * @returns {Promise<{text: string, refs: object[], truncated: boolean, usedChunks: number}>}
 */
export async function askQuestion({ notebook, chunks, sources, question, history = [], index, signal, onToken, onStatus, config, retryDelayMs }) {
  const { items, titles, text } = prepareContext({ chunks, sources, query: searchQueryFor(question, history), budget: getSettings().ai.budget, index });
  requireChunks(items);
  const messages = chatMessages({ question, history, context: text, level: notebook.level });
  const res = await chat({
    config,
    retryDelayMs,
    messages,
    stream: true,
    maxTokens: 1800,
    signal,
    onStatus,
    onToken: onToken ? (t) => onToken(parseCitations(t, items.length).text) : undefined,
  });
  const parsed = parseCitations(res.text, items.length);
  return { text: parsed.text, refs: refsFor(items, parsed.cited, titles), truncated: res.truncated, usedChunks: items.length };
}

// ---------------------------------------------------------------- tâches en JSON
const RETRY_NOTE =
  'Ta réponse précédente n’était pas exploitable (JSON invalide, incomplet ou vide). Recommence en respectant EXACTEMENT la forme JSON demandée, sans aucun texte autour.';

async function runJSON({ messages, normalize, count, maxTokens, signal, onProgress, onStatus, config, retryDelayMs }) {
  let lastTruncated = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    // La consigne de correction est ajoutée AU dernier message (deux messages « user » de suite
    // sont refusés par certains serveurs, et le modèle doit garder les extraits sous les yeux).
    const msgs = attempt === 0 ? messages : messages.map((m, i) => (i === messages.length - 1 ? { ...m, content: `${m.content}\n\n${RETRY_NOTE}` } : m));
    const res = await chat({
      config,
      retryDelayMs,
      messages: msgs,
      stream: true,
      json: true,
      maxTokens,
      temperature: attempt === 0 ? undefined : 0.2,
      signal,
      onStatus,
      onToken: (t) => onProgress?.(t.length),
    });
    lastTruncated = res.truncated;
    try {
      const { value, truncated } = parseModelJSON(res.text);
      const out = normalize(value);
      if (count(out) > 0) return { ...out, truncated: truncated || lastTruncated };
    } catch (e) {
      if (!(e instanceof JSONError)) throw e;
    }
  }
  throw new AIError('bad', 'Le modèle n’a pas produit de résultat exploitable. Essaie un autre modèle, ou demande moins d’éléments à la fois.');
}

function prepare(args, query) {
  const { chunks, sources, index } = args;
  const ctx = prepareContext({ chunks, sources, query, budget: getSettings().ai.budget, index });
  requireChunks(ctx.items);
  return ctx;
}

export async function generateCards(args) {
  const { notebook, count = 12, focus, signal, onProgress, onStatus, config, retryDelayMs } = args;
  const ctx = prepare(args, focus);
  const { cards, dropped, truncated } = await runJSON({
    messages: cardsMessages({ context: ctx.text, count, focus, level: notebook.level }),
    normalize: (v) => normalizeCards(v, ctx.items),
    count: (o) => o.cards.length,
    maxTokens: Math.min(4000, 220 * count + 400),
    signal,
    onProgress,
    onStatus,
    config,
    retryDelayMs,
  });
  const chunkById = new Map(ctx.items.map((i) => [i.chunk.id, i.chunk]));
  return {
    dropped,
    truncated,
    cards: cards.map((c) => {
      const chunk = chunkById.get(c.chunkId);
      return { ...c, sourceTitle: chunk ? ctx.titles.get(chunk.sourceId) : null, label: chunk?.label ?? null, srs: newSrs() };
    }),
  };
}

export async function generateQuiz(args) {
  const { notebook, count = 8, focus, signal, onProgress, onStatus, config, retryDelayMs } = args;
  const ctx = prepare(args, focus);
  const { questions, dropped, truncated } = await runJSON({
    messages: quizMessages({ context: ctx.text, count, focus, level: notebook.level }),
    normalize: (v) => normalizeQuiz(v, ctx.items),
    count: (o) => o.questions.length,
    maxTokens: Math.min(4000, 260 * count + 400),
    signal,
    onProgress,
    onStatus,
    config,
    retryDelayMs,
  });
  const chunkById = new Map(ctx.items.map((i) => [i.chunk.id, i.chunk]));
  return {
    dropped,
    truncated,
    quiz: {
      title: focus?.trim() ? `Quiz : ${focus.trim().slice(0, 50)}` : 'Quiz',
      questions: questions.map((q) => {
        const chunk = chunkById.get(q.chunkId);
        return { ...q, sourceTitle: chunk ? ctx.titles.get(chunk.sourceId) : null, label: chunk?.label ?? null };
      }),
      attempts: [],
    },
  };
}

export async function generateCast(args) {
  const { notebook, length = 'moyen', focus, signal, onProgress, onStatus, config, retryDelayMs } = args;
  const ctx = prepare(args, focus);
  const turns = (CAST_LENGTHS[length] || CAST_LENGTHS.moyen).turns;
  const out = await runJSON({
    messages: castMessages({ context: ctx.text, turns, focus, level: notebook.level }),
    normalize: (v) => normalizeCast(v, ctx.items),
    count: (o) => (o.turns.length >= 4 ? o.turns.length : 0),
    maxTokens: Math.min(5000, 130 * turns + 500),
    signal,
    onProgress,
    onStatus,
    config,
    retryDelayMs,
  });
  return { cast: { title: out.title, turns: out.turns, length }, truncated: out.truncated, dropped: out.dropped };
}

export async function generateSlides(args) {
  const { notebook, count = 8, focus, signal, onProgress, onStatus, config, retryDelayMs } = args;
  const ctx = prepare(args, focus);
  const out = await runJSON({
    messages: slidesMessages({ context: ctx.text, count, focus, level: notebook.level }),
    normalize: (v) => normalizeSlides(v, ctx.items),
    count: (o) => o.slides.length,
    maxTokens: Math.min(5000, 330 * count + 500),
    signal,
    onProgress,
    onStatus,
    config,
    retryDelayMs,
  });
  return { deck: { title: out.title, slides: out.slides }, truncated: out.truncated, dropped: out.dropped };
}

// ---------------------------------------------------------------- documents de révision
export async function generateNote(args) {
  const { notebook, kind = 'resume', focus, signal, onToken, onStatus, config, retryDelayMs } = args;
  const ctx = prepare(args, focus);
  const res = await chat({
    config,
    retryDelayMs,
    messages: noteMessages({ kind, context: ctx.text, focus, level: notebook.level }),
    stream: true,
    maxTokens: 2200,
    signal,
    onStatus,
    onToken: onToken ? (t) => onToken(parseCitations(t, ctx.items.length).text) : undefined,
  });
  const parsed = parseCitations(res.text, ctx.items.length);
  if (!parsed.text.trim()) throw new AIError('bad', 'Le modèle n’a rien écrit. Réessaie ou change de modèle.');
  const spec = NOTE_KINDS[kind] || NOTE_KINDS.resume;
  return {
    note: {
      kind,
      title: focus?.trim() ? `${spec.title} : ${focus.trim().slice(0, 50)}` : spec.title,
      markdown: parsed.text,
      refs: refsFor(ctx.items, parsed.cited, ctx.titles),
    },
    truncated: res.truncated,
  };
}
