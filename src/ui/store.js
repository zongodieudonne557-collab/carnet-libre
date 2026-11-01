// État partagé entre les écrans : données d'un carnet (mises en cache) et tâches longues
// (générations par l'IA) qui continuent même si on change d'onglet.
import { getNotebook, getChunks, listSources } from '../db.js';
import { makeIndex } from '../ai/generate.js';

// ------------------------------------------------------------------ données d'un carnet
const cache = new Map();
const changeListeners = new Set();

/**
 * @returns {Promise<{notebook: object, sources: object[], chunks: object[], index: object}|null>}
 *   `chunks` = extraits des sources ACTIVES ; `index` (BM25) n'est construit qu'à la première utilisation.
 */
export function loadData(notebookId) {
  let entry = cache.get(notebookId);
  if (!entry) {
    entry = (async () => {
      const [notebook, sources, chunks] = await Promise.all([getNotebook(notebookId), listSources(notebookId), getChunks(notebookId)]);
      if (!notebook) return null;
      let index;
      return {
        notebook,
        sources,
        chunks,
        get index() {
          index ??= makeIndex(chunks);
          return index;
        },
      };
    })();
    entry.catch(() => cache.delete(notebookId));
    cache.set(notebookId, entry);
  }
  return entry;
}

/** À appeler après tout changement de sources ou de titre : les écrans se rafraîchissent. */
export function invalidate(notebookId) {
  cache.delete(notebookId);
  for (const fn of changeListeners) fn(notebookId);
}

export function onDataChange(fn) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

// ------------------------------------------------------------------ tâches longues
const jobs = new Map();
const jobListeners = new Set();
const emit = () => {
  for (const fn of jobListeners) fn();
};
// Pendant une génération, le texte arrive par petits bouts : on ne prévient les écrans que 4 fois par seconde au plus.
let softTimer = 0;
const emitSoon = () => {
  if (softTimer) return;
  softTimer = setTimeout(() => {
    softTimer = 0;
    emit();
  }, 250);
};

/**
 * Lance une tâche (génération par l'IA…) qui enregistre elle-même son résultat.
 * @param {{key: string, notebookId: string, kind: string, label: string, run: (api: {signal: AbortSignal, setNote: (s: string) => void, setChars: (n: number) => void}) => Promise<{message?: string, href?: string}|void>}} o
 */
export function startJob({ key, notebookId, kind, label, run }) {
  const existing = jobs.get(key);
  if (existing?.status === 'running') return existing;
  const ctl = new AbortController();
  const job = { key, notebookId, kind, label, status: 'running', note: '', chars: 0, controller: ctl, startedAt: Date.now(), result: null, error: null };
  jobs.set(key, job);
  job.promise = (async () => {
    try {
      job.result = (await run({ signal: ctl.signal, setNote: (s) => ((job.note = s), emitSoon()), setChars: (n) => ((job.chars = n), emitSoon()) })) || null;
      job.status = 'done';
    } catch (e) {
      job.status = ctl.signal.aborted ? 'cancelled' : 'error';
      job.error = e;
    }
    job.finishedAt = Date.now();
    emit();
    return job;
  })();
  emit();
  return job;
}

export const getJob = (key) => jobs.get(key);
export const listJobs = () => [...jobs.values()];
export const runningJobs = (notebookId) => [...jobs.values()].filter((j) => j.status === 'running' && (!notebookId || j.notebookId === notebookId));
export function cancelJob(key) {
  jobs.get(key)?.controller.abort();
}
export function clearJob(key) {
  if (jobs.get(key)?.status !== 'running') jobs.delete(key);
  emit();
}
export function subscribeJobs(fn) {
  jobListeners.add(fn);
  return () => jobListeners.delete(fn);
}
