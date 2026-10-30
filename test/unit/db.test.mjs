import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  db, closeDB, wipeAll, createNotebook, listNotebooks, updateNotebook, deleteNotebook, addSource, listSources, updateSource, deleteSource,
  getChunks, saveItems, listItems, saveItem, deleteItem, getChat, saveChat, notebookStats, exportAll, importAll, validateExport,
} from '../../src/db.js';
import { loadSettings, getSettings, updateSettings, setApiKey, getApiKey, hasConsent, giveConsent, revokeConsent } from '../../src/settings.js';

beforeEach(async () => {
  await wipeAll();
});

const pages = (n, word = 'texte') => Array.from({ length: n }, (_, i) => ({ label: `p. ${i + 1}`, text: `Contenu de la page ${i + 1} : ${word} `.repeat(30) }));

test('carnets : création, tri, renommage', async () => {
  const a = await createNotebook({ title: '  SVT  ' });
  await new Promise((r) => setTimeout(r, 5));
  const b = await createNotebook({ title: 'Maths', level: 'universite' });
  assert.equal(a.title, 'SVT');
  assert.equal((await listNotebooks())[0].id, b.id, 'le plus récent d’abord');
  const r = await updateNotebook(a.id, { title: 'SVT 1ère D' });
  assert.equal(r.title, 'SVT 1ère D');
  assert.equal((await listNotebooks())[0].id, a.id, 'modifier remonte le carnet');
  await assert.rejects(updateNotebook('inconnu', { title: 'x' }), /introuvable/);
});

test('sources : ajout découpe en extraits et garde l’ordre de lecture', async () => {
  const nb = await createNotebook({ title: 'Test' });
  const s1 = await addSource(nb.id, { title: 'Cours 1', kind: 'pdf', pages: pages(3, 'alpha') });
  await new Promise((r) => setTimeout(r, 3));
  const s2 = await addSource(nb.id, { title: 'Cours 2', kind: 'text', pages: pages(2, 'beta') });
  assert.ok(s1.chunkCount >= 3 && s1.charCount > 500);
  const chunks = await getChunks(nb.id);
  assert.equal(chunks.length, s1.chunkCount + s2.chunkCount);
  assert.deepEqual(chunks.map((c) => c.sourceId).filter((v, i, a) => a.indexOf(v) === i), [s1.id, s2.id]);
  const first = chunks.filter((c) => c.sourceId === s1.id).map((c) => c.idx);
  assert.deepEqual(first, [...first].sort((a, b) => a - b));
  await assert.rejects(addSource(nb.id, { title: 'Vide', kind: 'text', pages: [{ text: '   ' }] }), /Aucun texte/);
});

test('sources : désactiver, renommer, filtrer, supprimer', async () => {
  const nb = await createNotebook({ title: 'Test' });
  const s1 = await addSource(nb.id, { title: 'A', kind: 'text', pages: pages(1) });
  const s2 = await addSource(nb.id, { title: 'B', kind: 'text', pages: pages(1) });
  await updateSource(s2.id, { enabled: false, title: '  B bis ' });
  assert.equal((await listSources(nb.id)).find((s) => s.id === s2.id).title, 'B bis');
  assert.ok((await getChunks(nb.id)).every((c) => c.sourceId === s1.id));
  assert.equal((await getChunks(nb.id, { onlyEnabled: false })).some((c) => c.sourceId === s2.id), true);
  assert.ok((await getChunks(nb.id, { onlyEnabled: false, sourceIds: [s2.id] })).every((c) => c.sourceId === s2.id));
  await deleteSource(s1.id);
  assert.equal((await db.where('chunks', 'sourceId', s1.id)).length, 0);
  assert.equal((await listSources(nb.id)).length, 1);
});

test('supprimer un carnet efface tout son contenu, et seulement le sien', async () => {
  const a = await createNotebook({ title: 'A' });
  const b = await createNotebook({ title: 'B' });
  for (const nb of [a, b]) {
    await addSource(nb.id, { title: 'S', kind: 'text', pages: pages(2) });
    await saveItems('cards', nb.id, [{ front: 'q', back: 'r' }]);
    await saveItems('quizzes', nb.id, [{ title: 'z', questions: [] }]);
    await saveItems('notes', nb.id, [{ title: 'n', markdown: 'x' }]);
    await saveItems('casts', nb.id, [{ title: 'c', turns: [] }]);
    await saveItems('decks', nb.id, [{ title: 'd', slides: [] }]);
    await saveChat(nb.id, [{ role: 'user', content: 'salut' }]);
  }
  await deleteNotebook(a.id);
  for (const store of ['sources', 'chunks', 'cards', 'quizzes', 'notes', 'casts', 'decks']) {
    assert.equal((await db.where(store, 'notebookId', a.id)).length, 0, `${store} de A`);
    assert.ok((await db.where(store, 'notebookId', b.id)).length > 0, `${store} de B conservé`);
  }
  assert.deepEqual((await getChat(a.id)).messages, []);
  assert.equal((await getChat(b.id)).messages.length, 1);
  assert.deepEqual((await listNotebooks()).map((n) => n.id), [b.id]);
});

test('contenus générés : enregistrer, lister, modifier, supprimer', async () => {
  const nb = await createNotebook({ title: 'T' });
  const [c1, c2] = await saveItems('cards', nb.id, [{ front: 'a', back: 'b' }, { front: 'c', back: 'd' }]);
  assert.ok(c1.id && c1.notebookId === nb.id && c2.createdAt >= c1.createdAt);
  await saveItem('cards', nb.id, { ...c1, back: 'modifié' });
  const list = await listItems('cards', nb.id);
  assert.equal(list.length, 2);
  assert.equal(list.find((c) => c.id === c1.id).back, 'modifié');
  await deleteItem('cards', c2.id);
  assert.equal((await listItems('cards', nb.id)).length, 1);
  await assert.rejects(listItems('inconnu', nb.id), /inconnu/);
  assert.deepEqual(await notebookStats(nb.id), { sources: 0, cards: 1, chars: 0 });
});

test('sauvegarde : export puis import dans une base vide, sans réglages ni clés', async () => {
  await loadSettings();
  await setApiKey('sk-secret-123', true);
  const nb = await createNotebook({ title: 'À sauver' });
  await addSource(nb.id, { title: 'S', kind: 'text', pages: pages(2) });
  await saveItems('cards', nb.id, [{ front: 'q', back: 'r', srs: { state: 'new' } }]);
  await saveChat(nb.id, [{ role: 'user', content: 'bonjour' }]);
  const dump = await exportAll();
  const json = JSON.stringify(dump);
  assert.ok(!json.includes('sk-secret-123'), 'la clé d’API n’est jamais exportée');
  assert.equal(dump.settings, undefined);

  await wipeAll();
  assert.deepEqual(await listNotebooks(), []);
  const counts = await importAll(JSON.parse(json));
  assert.equal(counts.notebooks, 1);
  assert.equal((await listNotebooks())[0].title, 'À sauver');
  assert.equal((await getChunks(nb.id)).length > 0, true);
  assert.equal((await listItems('cards', nb.id)).length, 1);
  assert.equal((await getChat(nb.id)).messages[0].content, 'bonjour');
});

test('sauvegarde : refuse les fichiers invalides', () => {
  assert.throws(() => validateExport(null), /pas une sauvegarde/);
  assert.throws(() => validateExport({ app: 'autre' }), /pas une sauvegarde/);
  assert.throws(() => validateExport({ app: 'carnet-libre', version: 99 }), /plus récente/);
  assert.throws(() => validateExport({ app: 'carnet-libre', version: 1, notebooks: 'x' }), /liste/);
  assert.throws(() => validateExport({ app: 'carnet-libre', version: 1, notebooks: [{ title: 'sans id' }] }), /identifiant/);
  assert.throws(
    () => validateExport({ app: 'carnet-libre', version: 1, notebooks: [{ id: 'n1' }], cards: [{ id: 'c1', notebookId: 'fantome' }] }),
    /carnet absent/
  );
  assert.equal(validateExport({ app: 'carnet-libre', version: 1, notebooks: [{ id: 'n1' }], cards: [{ id: 'c1', notebookId: 'n1' }] }), true);
});

test('réglages : persistance, fusion et clé non mémorisée par défaut', async () => {
  await loadSettings();
  assert.equal(getSettings().ai.provider, 'none');
  assert.equal(getSettings().ai.remember, false);
  await updateSettings({ ai: { provider: 'groq', model: 'm1' }, ui: { theme: 'dark' } });
  assert.equal(getSettings().ai.budget, 'medium', 'les autres valeurs sont conservées');

  await setApiKey('cle-session', false);
  assert.equal(getApiKey(), 'cle-session');
  assert.equal(await db.get('settings', 'secret'), undefined, 'non écrite sur l’appareil');

  await closeDB();
  await loadSettings(); // « redémarrage »
  assert.equal(getSettings().ai.provider, 'groq');
  assert.equal(getSettings().ui.theme, 'dark');
  assert.equal(getApiKey(), '', 'la clé non mémorisée a disparu');

  await setApiKey('cle-memorisee', true);
  await closeDB();
  await loadSettings();
  assert.equal(getApiKey(), 'cle-memorisee');
  await setApiKey('', false);
  assert.equal(await db.get('settings', 'secret'), undefined, 'décocher « mémoriser » efface la clé stockée');
});

test('clés d’API : chacune reste attachée à son fournisseur', async () => {
  await loadSettings();
  await updateSettings({ ai: { provider: 'groq' } });
  await setApiKey('cle-groq', true);
  await setApiKey('cle-gemini', true, 'gemini');
  assert.equal(getApiKey(), 'cle-groq');
  assert.equal(getApiKey('gemini'), 'cle-gemini');
  assert.equal(getApiKey('custom'), '', 'la clé de Groq ne part jamais vers un serveur perso');
  await updateSettings({ ai: { provider: 'custom' } });
  assert.equal(getApiKey(), '', 'changer de fournisseur ne transporte pas la clé');
  await updateSettings({ ai: { provider: 'gemini' } });
  assert.equal(getApiKey(), 'cle-gemini');

  await closeDB();
  await loadSettings(); // « redémarrage » : les deux clés ont été mémorisées
  assert.equal(getApiKey('groq'), 'cle-groq');
  assert.equal(getApiKey('gemini'), 'cle-gemini');

  await setApiKey('', true, 'groq'); // oublier une seule clé
  assert.equal(getApiKey('groq'), '');
  assert.equal(getApiKey('gemini'), 'cle-gemini');
  await setApiKey('', false, 'gemini');
  assert.equal(await db.get('settings', 'secret'), undefined, 'plus aucune clé mémorisée : rien n’est stocké');
});

test('modèle choisi : mémorisé par fournisseur', async () => {
  await loadSettings();
  await updateSettings({ ai: { provider: 'groq', model: 'm-groq', models: { groq: 'm-groq' } } });
  await updateSettings({ ai: { provider: 'gemini', model: '', models: { gemini: 'm-gem' } } });
  assert.deepEqual(getSettings().ai.models, { groq: 'm-groq', gemini: 'm-gem' });
});

test('consentement par fournisseur', async () => {
  await loadSettings();
  assert.equal(hasConsent('groq'), false);
  await giveConsent('groq');
  assert.equal(hasConsent('groq'), true);
  assert.equal(hasConsent('gemini'), false);
  await revokeConsent('groq');
  assert.equal(hasConsent('groq'), false);
});

test('effacement total', async () => {
  await loadSettings();
  const nb = await createNotebook({ title: 'X' });
  await addSource(nb.id, { title: 'S', kind: 'text', pages: pages(1) });
  await setApiKey('abc', true);
  await wipeAll();
  assert.deepEqual(await listNotebooks(), []);
  assert.equal(await db.get('settings', 'secret'), undefined);
});
