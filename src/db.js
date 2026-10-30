// Stockage local (IndexedDB). Tout reste sur l'appareil : aucune donnée n'est envoyée ailleurs.
import { chunkPages } from './text/chunk.js';
import { uid } from './util.js';

const DB_NAME = 'carnet-libre';
const DB_VERSION = 1;
export const EXPORT_VERSION = 1;

const SCHEMA = {
  notebooks: { keyPath: 'id' },
  sources: { keyPath: 'id', indexes: ['notebookId'] },
  chunks: { keyPath: 'id', indexes: ['notebookId', 'sourceId'] },
  cards: { keyPath: 'id', indexes: ['notebookId'] },
  quizzes: { keyPath: 'id', indexes: ['notebookId'] },
  notes: { keyPath: 'id', indexes: ['notebookId'] },
  casts: { keyPath: 'id', indexes: ['notebookId'] },
  decks: { keyPath: 'id', indexes: ['notebookId'] },
  chats: { keyPath: 'notebookId' },
  settings: { keyPath: 'key' },
};
const CHILD_STORES = ['sources', 'chunks', 'cards', 'quizzes', 'notes', 'casts', 'decks'];
const EXPORT_STORES = ['notebooks', ...CHILD_STORES, 'chats'];

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const factory = globalThis.indexedDB;
    if (!factory) return reject(new Error('IndexedDB indisponible : le navigateur bloque peut-être le stockage (navigation privée ?).'));
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const [name, def] of Object.entries(SCHEMA)) {
        if (d.objectStoreNames.contains(name)) continue;
        const st = d.createObjectStore(name, { keyPath: def.keyPath });
        for (const ix of def.indexes || []) st.createIndex(ix, ix);
      }
    };
    req.onsuccess = () => {
      const d = req.result;
      d.onversionchange = () => d.close();
      resolve(d);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Base de données bloquée par un autre onglet de Carnet Libre : ferme-le puis réessaie.'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

/** Ferme la connexion (tests, effacement complet). */
export async function closeDB() {
  if (!dbPromise) return;
  try {
    (await dbPromise).close();
  } catch {
    /* déjà fermée */
  }
  dbPromise = null;
}

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** Exécute `fn(stores)` dans une transaction ; résout quand la transaction est validée. */
async function run(names, mode, fn) {
  const d = await openDB();
  const list = Array.isArray(names) ? names : [names];
  return new Promise((resolve, reject) => {
    const tx = d.transaction(list, mode);
    const stores = Object.fromEntries(list.map((n) => [n, tx.objectStore(n)]));
    let result;
    let failed = false;
    tx.oncomplete = () => (failed ? undefined : resolve(result));
    tx.onerror = () => {
      failed = true;
      reject(tx.error);
    };
    tx.onabort = () => {
      failed = true;
      reject(tx.error || new DOMException('Transaction annulée', 'AbortError'));
    };
    Promise.resolve(fn(Array.isArray(names) ? stores : stores[names])).then(
      (r) => {
        result = r;
      },
      (e) => {
        failed = true;
        try {
          tx.abort();
        } catch {
          /* déjà terminée */
        }
        reject(e);
      }
    );
  });
}

function deleteWhere(store, index, value) {
  return new Promise((resolve, reject) => {
    const req = store.index(index).openKeyCursor(IDBKeyRange.only(value));
    let n = 0;
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) {
        store.delete(cur.primaryKey);
        n++;
        cur.continue();
      } else resolve(n);
    };
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------- accès générique
export const db = {
  get: (store, key) => run(store, 'readonly', (st) => wrap(st.get(key))),
  put: (store, value) => run(store, 'readwrite', (st) => wrap(st.put(value))),
  putMany: (store, values) =>
    run(store, 'readwrite', async (st) => {
      for (const v of values) st.put(v);
    }),
  delete: (store, key) => run(store, 'readwrite', (st) => wrap(st.delete(key))),
  all: (store) => run(store, 'readonly', (st) => wrap(st.getAll())),
  where: (store, index, value) => run(store, 'readonly', (st) => wrap(st.index(index).getAll(IDBKeyRange.only(value)))),
  count: (store) => run(store, 'readonly', (st) => wrap(st.count())),
  clear: (store) => run(store, 'readwrite', (st) => wrap(st.clear())),
};

// ---------------------------------------------------------------- carnets
export async function createNotebook({ title, level = 'lycee' } = {}) {
  const now = Date.now();
  const nb = { id: uid(), title: (title || 'Nouveau carnet').trim().slice(0, 80), level, color: Math.floor(Math.random() * 6), createdAt: now, updatedAt: now };
  await db.put('notebooks', nb);
  return nb;
}

export async function listNotebooks() {
  const all = await db.all('notebooks');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export const getNotebook = (id) => db.get('notebooks', id);

export async function updateNotebook(id, patch) {
  const nb = await db.get('notebooks', id);
  if (!nb) throw new Error('Carnet introuvable.');
  const next = { ...nb, ...patch, id, updatedAt: Date.now() };
  if (typeof next.title === 'string') next.title = next.title.trim().slice(0, 80) || nb.title;
  await db.put('notebooks', next);
  return next;
}

export async function touchNotebook(id) {
  const nb = await db.get('notebooks', id);
  if (nb) await db.put('notebooks', { ...nb, updatedAt: Date.now() });
}

export async function deleteNotebook(id) {
  await run(['notebooks', 'chats', ...CHILD_STORES], 'readwrite', async (s) => {
    s.notebooks.delete(id);
    s.chats.delete(id);
    await Promise.all(CHILD_STORES.map((n) => deleteWhere(s[n], 'notebookId', id)));
  });
}

// ---------------------------------------------------------------- sources
/**
 * Ajoute une source : découpe son texte en extraits et enregistre le tout d'un bloc.
 * @param {string} notebookId
 * @param {{title: string, kind: string, pages: {label?: string|null, text: string}[], meta?: object}} src
 */
export async function addSource(notebookId, src) {
  const chunks = chunkPages(src.pages);
  if (!chunks.length) throw new Error('Aucun texte exploitable dans cette source.');
  const id = uid();
  const charCount = chunks.reduce((n, c) => n + c.text.length, 0);
  const source = {
    id,
    notebookId,
    title: (src.title || 'Sans titre').trim().slice(0, 120),
    kind: src.kind || 'text',
    enabled: true,
    charCount,
    chunkCount: chunks.length,
    pageCount: src.pages.length,
    meta: src.meta || {},
    createdAt: Date.now(),
  };
  const rows = chunks.map((c) => ({ id: `${id}:${c.idx}`, notebookId, sourceId: id, idx: c.idx, label: c.label, text: c.text }));
  await run(['sources', 'chunks', 'notebooks'], 'readwrite', async (s) => {
    s.sources.put(source);
    for (const r of rows) s.chunks.put(r);
    const nb = await wrap(s.notebooks.get(notebookId));
    if (nb) s.notebooks.put({ ...nb, updatedAt: Date.now() });
  });
  return source;
}

export async function listSources(notebookId) {
  return (await db.where('sources', 'notebookId', notebookId)).sort((a, b) => a.createdAt - b.createdAt);
}

export async function updateSource(id, patch) {
  const s = await db.get('sources', id);
  if (!s) throw new Error('Source introuvable.');
  const next = { ...s, ...patch, id, notebookId: s.notebookId };
  if (typeof next.title === 'string') next.title = next.title.trim().slice(0, 120) || s.title;
  await db.put('sources', next);
  return next;
}

export async function deleteSource(id) {
  await run(['sources', 'chunks'], 'readwrite', async (s) => {
    s.sources.delete(id);
    await deleteWhere(s.chunks, 'sourceId', id);
  });
}

/** Extraits d'un carnet dans l'ordre de lecture (sources par date d'ajout, puis position). */
export async function getChunks(notebookId, { onlyEnabled = true, sourceIds = null } = {}) {
  const [sources, chunks] = await Promise.all([listSources(notebookId), db.where('chunks', 'notebookId', notebookId)]);
  const rank = new Map();
  sources.forEach((s, i) => {
    if ((!onlyEnabled || s.enabled) && (!sourceIds || sourceIds.includes(s.id))) rank.set(s.id, i);
  });
  return chunks
    .filter((c) => rank.has(c.sourceId))
    .sort((a, b) => rank.get(a.sourceId) - rank.get(b.sourceId) || a.idx - b.idx);
}

// ---------------------------------------------------------------- contenus générés
const ITEM_STORES = ['cards', 'quizzes', 'notes', 'casts', 'decks'];

export async function listItems(store, notebookId) {
  if (!ITEM_STORES.includes(store)) throw new Error(`Magasin inconnu : ${store}`);
  return (await db.where(store, 'notebookId', notebookId)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export async function saveItems(store, notebookId, items) {
  if (!ITEM_STORES.includes(store)) throw new Error(`Magasin inconnu : ${store}`);
  const now = Date.now();
  const rows = items.map((it, i) => ({ ...it, id: it.id || uid(), notebookId, createdAt: it.createdAt || now + i }));
  await run([store, 'notebooks'], 'readwrite', async (s) => {
    for (const r of rows) s[store].put(r);
    const nb = await wrap(s.notebooks.get(notebookId));
    if (nb) s.notebooks.put({ ...nb, updatedAt: Date.now() });
  });
  return rows;
}

export const saveItem = async (store, notebookId, item) => (await saveItems(store, notebookId, [item]))[0];
export const deleteItem = (store, id) => db.delete(store, id);

export async function getChat(notebookId) {
  return (await db.get('chats', notebookId)) || { notebookId, messages: [] };
}
export const saveChat = (notebookId, messages) => db.put('chats', { notebookId, messages, updatedAt: Date.now() });

export async function notebookStats(notebookId) {
  const [sources, cards] = await Promise.all([db.where('sources', 'notebookId', notebookId), db.where('cards', 'notebookId', notebookId)]);
  return { sources: sources.length, cards: cards.length, chars: sources.reduce((n, s) => n + (s.charCount || 0), 0) };
}

// ---------------------------------------------------------------- sauvegarde / restauration / effacement
/** Toutes les données utilisateur (jamais les réglages ni les clés d'API). */
export async function exportAll() {
  const out = { app: 'carnet-libre', version: EXPORT_VERSION, exportedAt: new Date().toISOString() };
  await run(EXPORT_STORES, 'readonly', async (s) => {
    for (const name of EXPORT_STORES) out[name] = await wrap(s[name].getAll());
  });
  return out;
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Vérifie une sauvegarde avant de l'importer. Lève une erreur claire si elle est invalide. */
export function validateExport(data) {
  if (!isObj(data) || data.app !== 'carnet-libre') throw new Error('Ce fichier n’est pas une sauvegarde de Carnet Libre.');
  if (typeof data.version !== 'number' || data.version > EXPORT_VERSION) throw new Error('Cette sauvegarde vient d’une version plus récente de Carnet Libre.');
  const ids = new Set();
  for (const name of EXPORT_STORES) {
    const rows = data[name];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) throw new Error(`Sauvegarde invalide : « ${name} » doit être une liste.`);
    for (const r of rows) {
      if (!isObj(r)) throw new Error(`Sauvegarde invalide : un élément de « ${name} » est mal formé.`);
      const key = name === 'chats' ? r.notebookId : r.id;
      if (typeof key !== 'string' || !key) throw new Error(`Sauvegarde invalide : identifiant manquant dans « ${name} ».`);
      if (name === 'notebooks') ids.add(r.id);
      else if (typeof r.notebookId !== 'string') throw new Error(`Sauvegarde invalide : « ${name} » sans carnet.`);
    }
  }
  for (const name of [...CHILD_STORES, 'chats']) {
    for (const r of data[name] || []) if (!ids.has(r.notebookId)) throw new Error(`Sauvegarde invalide : « ${name} » référence un carnet absent.`);
  }
  return true;
}

/** Restaure une sauvegarde (les éléments de même identifiant sont remplacés). */
export async function importAll(data) {
  validateExport(data);
  const counts = {};
  await run(EXPORT_STORES, 'readwrite', async (s) => {
    for (const name of EXPORT_STORES) {
      const rows = data[name] || [];
      counts[name] = rows.length;
      for (const r of rows) s[name].put(r);
    }
  });
  return counts;
}

/** Efface toutes les données de l'appareil (carnets, réglages, clés). */
export async function wipeAll() {
  await closeDB();
  await new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // se terminera à la fermeture des autres onglets
  });
  try {
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
  } catch {
    /* stockage web indisponible */
  }
}
