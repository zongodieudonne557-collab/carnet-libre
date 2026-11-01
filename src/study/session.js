// Séance de révision : file d'attente du jour, notes, retour des cartes ratées, annulation.
// Pure (le temps est injecté) : l'écran ne fait que l'afficher et enregistrer chaque carte modifiée.
import { buildQueue, schedule } from './srs.js';

const MIN = 60 * 1000;
const SOON = 20 * MIN; // une carte encore « en apprentissage » qui revient dans moins de 20 min reste dans la séance

/**
 * @param {object[]} cards  toutes les cartes du carnet
 * @param {{now?: () => number, newLimit?: number, reviewLimit?: number}} [o]
 */
export function createSession(cards, { now = Date.now, newLimit = 15, reviewLimit = 100 } = {}) {
  const queue = buildQueue(cards, { now: now(), newLimit, reviewLimit });
  const total = queue.length;
  const history = [];
  const stats = [0, 0, 0, 0]; // Encore, Difficile, Bien, Facile
  const touched = new Map(); // id → dernière version de la carte (pour le récapitulatif)

  return {
    total,
    get current() {
      return queue[0] ?? null;
    },
    get remaining() {
      return queue.length;
    },
    get done() {
      return queue.length === 0;
    },
    get answered() {
      return history.length;
    },
    get canUndo() {
      return history.length > 0;
    },
    /** Notes données : [Encore, Difficile, Bien, Facile]. */
    get stats() {
      return stats.slice();
    },
    /** Cartes distinctes révisées dans la séance. */
    get cards() {
      return [...touched.values()];
    },

    /**
     * Note la carte courante. Renvoie la carte mise à jour (à enregistrer par l'appelant).
     * @param {0|1|2|3} grade
     */
    answer(grade) {
      const card = queue.shift();
      if (!card) return null;
      const t = now();
      const updated = { ...card, srs: schedule(card.srs, grade, t) };
      const requeued = updated.srs.state === 'learning' && updated.srs.due - t <= SOON;
      if (requeued) {
        // « Encore » revient après quelques cartes ; une étape plus longue, en fin de séance
        const gap = updated.srs.due - t <= 2 * MIN ? 4 : 10;
        queue.splice(Math.min(gap, queue.length), 0, updated);
      }
      stats[grade]++;
      touched.set(card.id, updated);
      history.push({ before: card, after: updated, grade, requeued });
      return updated;
    },

    /** Annule la dernière note. Renvoie la carte telle qu'elle était (à enregistrer), ou null. */
    undo() {
      const last = history.pop();
      if (!last) return null;
      if (last.requeued) {
        const i = queue.indexOf(last.after);
        if (i >= 0) queue.splice(i, 1);
      }
      queue.unshift(last.before);
      stats[last.grade]--;
      // la carte garde son dernier état connu si elle a été notée plus tôt dans la séance
      const earlier = [...history].reverse().find((h) => h.after.id === last.before.id);
      if (earlier) touched.set(last.before.id, earlier.after);
      else touched.delete(last.before.id);
      return last.before;
    },

    /** Prochaine échéance parmi les cartes de la séance (pour dire « à demain », « dans 10 min »…). */
    nextDue() {
      const dues = [...touched.values()].map((c) => c.srs.due).filter((d) => d > now());
      return dues.length ? Math.min(...dues) : null;
    },
  };
}
