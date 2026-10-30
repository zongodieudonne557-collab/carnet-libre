// Répétition espacée (inspirée de SM-2 / Anki) : revoir une carte juste avant de l'oublier.
// Notes : 0 = Encore, 1 = Difficile, 2 = Bien, 3 = Facile.
import { formatDuration } from '../util.js';

export const GRADES = [
  { id: 0, label: 'Encore', hint: "Je ne m'en souvenais pas" },
  { id: 1, label: 'Difficile', hint: 'Trouvé avec effort' },
  { id: 2, label: 'Bien', hint: 'Trouvé' },
  { id: 3, label: 'Facile', hint: 'Immédiat' },
];

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
export const LEARNING_STEPS = [1 * MIN, 10 * MIN];
const MIN_EASE = 1.3;
const MAX_INTERVAL = 365; // jours
const EASY_BONUS = 1.3;

export function newSrs() {
  return { state: 'new', due: 0, interval: 0, ease: 2.5, reps: 0, lapses: 0, step: 0 };
}

export function endOfLocalDay(now) {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** La carte est-elle à revoir maintenant ? (les cartes « new » sont limitées par l'appelant) */
export function isDue(srs, now = Date.now()) {
  if (!srs || srs.state === 'new') return true;
  if (srs.state === 'learning') return srs.due <= now;
  return srs.due <= endOfLocalDay(now);
}

/** Calcule le nouvel état après une note. Fonction pure : ne modifie pas `srs`. */
export function schedule(srs, grade, now = Date.now()) {
  const s = { ...(srs || newSrs()) };
  const g = Math.max(0, Math.min(3, grade | 0));
  s.reps += 1;

  if (s.state === 'new' || s.state === 'learning') {
    if (s.state === 'new') {
      s.state = 'learning';
      s.step = 0;
    }
    if (g === 0) {
      s.step = 0;
      s.due = now + LEARNING_STEPS[0];
    } else if (g === 1) {
      s.due = now + LEARNING_STEPS[Math.min(s.step, LEARNING_STEPS.length - 1)];
    } else if (g === 2) {
      s.step += 1;
      if (s.step >= LEARNING_STEPS.length) {
        s.state = 'review';
        s.interval = 1;
        s.due = now + DAY;
      } else {
        s.due = now + LEARNING_STEPS[s.step];
      }
    } else {
      s.state = 'review';
      s.interval = 4;
      s.due = now + 4 * DAY;
    }
    return s;
  }

  // état « review »
  if (g === 0) {
    s.lapses += 1;
    s.ease = Math.max(MIN_EASE, s.ease - 0.2);
    s.state = 'learning';
    s.step = 0;
    s.interval = 1;
    s.due = now + LEARNING_STEPS[1];
    return s;
  }
  const base = s.interval || 1;
  let next;
  if (g === 1) {
    next = Math.max(base + 1, Math.round(base * 1.2));
    s.ease = Math.max(MIN_EASE, s.ease - 0.15);
  } else if (g === 2) {
    next = Math.max(base + 1, Math.round(base * s.ease));
  } else {
    next = Math.max(base + 1, Math.round(base * s.ease * EASY_BONUS));
    s.ease += 0.15;
  }
  s.interval = Math.min(MAX_INTERVAL, next);
  s.due = now + s.interval * DAY;
  return s;
}

/** Texte affiché sous chaque bouton : « 10 min », « 1 j »… */
export function previewLabels(srs, now = Date.now()) {
  return [0, 1, 2, 3].map((g) => formatDuration(schedule(srs, g, now).due - now));
}

/**
 * Construit la file du jour : cartes à revoir d'abord (les plus en retard en premier),
 * puis un nombre limité de nouvelles cartes.
 */
export function buildQueue(cards, { now = Date.now(), newLimit = 15, reviewLimit = 100 } = {}) {
  const learning = [];
  const review = [];
  const fresh = [];
  for (const c of cards) {
    const s = c.srs || newSrs();
    if (s.state === 'new') fresh.push(c);
    else if (!isDue(s, now)) continue;
    else if (s.state === 'learning') learning.push(c);
    else review.push(c);
  }
  learning.sort((a, b) => a.srs.due - b.srs.due);
  review.sort((a, b) => a.srs.due - b.srs.due);
  fresh.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return [...learning, ...review.slice(0, reviewLimit), ...fresh.slice(0, newLimit)];
}

/** Statistiques simples pour l'écran d'accueil. */
export function countDue(cards, now = Date.now(), newLimit = 15) {
  let due = 0;
  let fresh = 0;
  for (const c of cards) {
    const s = c.srs || newSrs();
    if (s.state === 'new') fresh++;
    else if (isDue(s, now)) due++;
  }
  return { due, fresh: Math.min(fresh, newLimit), total: cards.length };
}
