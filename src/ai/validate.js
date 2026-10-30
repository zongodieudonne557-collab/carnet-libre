// Contrôle et nettoyage de ce que renvoie le modèle. On ne fait jamais confiance à sa forme :
// clés alternatives, types inattendus, doublons, numéros d'extraits faux, « preuves » inventées.
import { foldAccents } from '../text/normalize.js';
import { quoteScore, isGrounded } from '../text/verify.js';
import { shuffle } from '../util.js';
import { HOSTS } from './prompts.js';

const pick = (o, keys) => {
  if (!o || typeof o !== 'object') return undefined;
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  return undefined;
};
const str = (v, max) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').replace(/\s+\n/g, '\n').trim().slice(0, max);
const listOf = (raw, keys) => {
  if (Array.isArray(raw)) return raw;
  const v = pick(raw, keys);
  return Array.isArray(v) ? v : [];
};
const keyOf = (s) => foldAccents(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Retrouve l'extrait qui contient la « preuve ». On regarde d'abord l'extrait annoncé par le modèle,
 * puis tous les autres (les petits modèles se trompent souvent de numéro).
 * @returns {{chunk: object|null, verified: boolean|null}}
 */
export function locate(quote, hintN, items) {
  const byN = new Map(items.map((i) => [i.n, i.chunk]));
  const hinted = byN.get(parseInt(hintN, 10)) || null;
  if (!quote) return { chunk: hinted, verified: null };
  if (hinted && isGrounded(quote, hinted.text)) return { chunk: hinted, verified: true };
  let best = null;
  let bestScore = 0;
  for (const { chunk } of items) {
    const s = quoteScore(quote, chunk.text);
    if (s > bestScore) {
      bestScore = s;
      best = chunk;
    }
  }
  if (best && bestScore >= 0.5) return { chunk: best, verified: true };
  return { chunk: hinted, verified: false };
}

const refFields = (chunk) => (chunk ? { chunkId: chunk.id, sourceId: chunk.sourceId } : { chunkId: null, sourceId: null });

// ---------------------------------------------------------------- cartes
export function normalizeCards(raw, items) {
  const list = listOf(raw, ['cartes', 'cards', 'flashcards', 'items', 'data']);
  const seen = new Set();
  const cards = [];
  let dropped = 0;
  for (const it of list) {
    const front = str(pick(it, ['recto', 'front', 'question', 'q', 'terme', 'prompt']), 500);
    const back = str(pick(it, ['verso', 'back', 'reponse', 'réponse', 'answer', 'r', 'definition', 'définition']), 900);
    const k = keyOf(front);
    if (front.length < 3 || back.length < 1 || seen.has(k)) {
      dropped++;
      continue;
    }
    seen.add(k);
    const quote = str(pick(it, ['preuve', 'quote', 'citation', 'evidence']), 400);
    const { chunk, verified } = locate(quote, pick(it, ['extrait', 'source', 'ref', 'n']), items);
    cards.push({ front, back, quote, verified, origin: 'ai', ...refFields(chunk) });
  }
  return { cards, dropped };
}

// ---------------------------------------------------------------- quiz
function choiceText(c) {
  return typeof c === 'string' ? c : str(pick(c, ['texte', 'text', 'choix', 'label', 'reponse']), 300);
}

export function normalizeQuiz(raw, items, rand = Math.random) {
  const list = listOf(raw, ['questions', 'quiz', 'qcm', 'items', 'data']);
  const seen = new Set();
  const questions = [];
  let dropped = 0;
  for (const it of list) {
    const q = str(pick(it, ['question', 'q', 'enonce', 'énoncé']), 500);
    let good = str(pick(it, ['bonne_reponse', 'bonne_réponse', 'bonne', 'correct', 'reponse_correcte']), 300);
    let wrong = listOf(pick(it, ['mauvaises_reponses', 'mauvaises_réponses', 'fausses', 'distracteurs', 'wrong']), []).map(choiceText);
    // forme alternative : « choix » + « reponse » (indice, lettre ou texte)
    if (!good) {
      const choices = listOf(it, ['choix', 'choices', 'options', 'reponses', 'réponses']).map(choiceText);
      const ans = pick(it, ['reponse', 'réponse', 'answer', 'bonne_reponse_index', 'correct_index']);
      let idx = -1;
      if (typeof ans === 'number') idx = ans >= 0 && ans < choices.length ? ans : ans === choices.length ? ans - 1 : -1;
      else if (typeof ans === 'string') {
        const letter = /^\s*([A-Da-d])\s*[).:]?\s*$/.exec(ans);
        if (letter) idx = letter[1].toUpperCase().charCodeAt(0) - 65;
        else idx = choices.findIndex((c) => keyOf(c) === keyOf(ans));
      }
      if (idx >= 0 && idx < choices.length) {
        good = choices[idx];
        wrong = choices.filter((_, i) => i !== idx);
      }
    }
    wrong = [...new Set(wrong.map((w) => w.trim()).filter((w) => w && keyOf(w) !== keyOf(good)))].slice(0, 3);
    const k = keyOf(q);
    if (q.length < 5 || !good || wrong.length < 2 || seen.has(k)) {
      dropped++;
      continue;
    }
    seen.add(k);
    const choices = shuffle([good, ...wrong], rand);
    const quote = str(pick(it, ['preuve', 'quote', 'citation']), 400);
    const { chunk, verified } = locate(quote, pick(it, ['extrait', 'source', 'ref', 'n']), items);
    questions.push({
      question: q,
      choices,
      answer: choices.indexOf(good),
      explanation: str(pick(it, ['explication', 'explanation', 'justification']), 600),
      quote,
      verified,
      ...refFields(chunk),
    });
  }
  return { questions, dropped };
}

// ---------------------------------------------------------------- causerie
const SPEAKER_B = /^(b|2|issa|host ?2|animateur ?2|speaker ?2|voix ?2)$/i;

export function normalizeCast(raw, items) {
  const list = listOf(raw, ['tours', 'turns', 'dialogue', 'repliques', 'répliques', 'script']);
  const turns = [];
  let prev = null;
  let dropped = 0;
  for (const it of list) {
    const text = str(pick(it, ['texte', 'text', 'replique', 'réplique', 'contenu']), 900).replace(/[*_#`]+/g, '');
    if (text.length < 3) {
      dropped++;
      continue;
    }
    const who0 = String(pick(it, ['qui', 'who', 'speaker', 'locuteur', 'voix', 'animateur']) ?? '').trim();
    let who = who0 ? (SPEAKER_B.test(who0) ? 'B' : 'A') : prev === 'A' ? 'B' : 'A';
    prev = who;
    const { chunk } = locate('', pick(it, ['extrait', 'source', 'ref', 'n']), items);
    turns.push({ who, text, chunkId: chunk?.id ?? null });
  }
  const title = str(pick(raw, ['titre', 'title']), 120) || 'Causerie';
  return { title, turns, dropped, hosts: HOSTS };
}

// ---------------------------------------------------------------- diapositives
export function normalizeSlides(raw, items) {
  const list = listOf(raw, ['diapos', 'diapositives', 'slides', 'items']);
  const slides = [];
  let dropped = 0;
  for (const it of list) {
    const title = str(pick(it, ['titre', 'title']), 120);
    let bullets = listOf(it, ['points', 'puces', 'bullets', 'contenu']).map((b) => str(typeof b === 'string' ? b : pick(b, ['texte', 'text']), 160)).filter(Boolean).slice(0, 5);
    let narration = str(pick(it, ['narration', 'texte', 'script', 'voix']), 1200).replace(/[*_#`]+/g, '');
    if (!title || (!bullets.length && !narration)) {
      dropped++;
      continue;
    }
    if (!narration) narration = bullets.join('. ') + '.';
    if (!bullets.length) bullets = [];
    const formula = str(pick(it, ['formule', 'formula', 'latex']), 200).replace(/^\$+|\$+$/g, '');
    const { chunk } = locate('', pick(it, ['extrait', 'source', 'ref', 'n']), items);
    slides.push({ title, bullets, formula, narration, chunkId: chunk?.id ?? null });
  }
  const title = str(pick(raw, ['titre', 'title']), 120) || 'Cours en diapositives';
  return { title, slides, dropped };
}
