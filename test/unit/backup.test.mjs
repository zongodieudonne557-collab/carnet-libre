import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { addSource, closeDB, createNotebook, db, listNotebooks, listSources, saveItem, wipeAll } from '../../src/db.js';
import { getApiKey, getSettings, loadSettings, setApiKey, updateSettings } from '../../src/settings.js';
import { backupFilename, createBackup, eraseEverything, readBackup, restoreBackup, summarizeBackup } from '../../src/ui/backup.js';

beforeEach(async () => {
  await wipeAll();
  await loadSettings();
});

const pages = [{ label: 'p. 1', text: 'La photosynthèse a lieu dans les chloroplastes. '.repeat(20) }];

async function seed() {
  const nb = await createNotebook({ title: 'SVT' });
  const src = await addSource(nb.id, { title: 'Cours', kind: 'text', pages });
  await saveItem('cards', nb.id, { front: 'Où ?', back: 'Chloroplastes', sourceId: src.id });
  return { nb, src };
}

test('nom du fichier de sauvegarde : daté, sans caractère spécial', () => {
  assert.equal(backupFilename(new Date('2026-10-30T20:00:00Z')), 'carnet-libre-sauvegarde-2026-10-30.json');
});

test('résumé d’une sauvegarde', () => {
  assert.deepEqual(summarizeBackup({ notebooks: [{}, {}], cards: [{}], sources: 'pas une liste' }), { notebooks: 2, sources: 0, cards: 1, quizzes: 0, notes: 0, casts: 0, decks: 0 });
  assert.equal(summarizeBackup(null).notebooks, 0);
});

test('aller-retour : sauvegarde, effacement, restauration', async () => {
  await seed();
  await updateSettings({ ai: { provider: 'groq' } });
  await setApiKey('cle-secrete', true);

  const { text, name, summary } = await createBackup();
  assert.match(name, /^carnet-libre-sauvegarde-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(summary.notebooks, 1);
  assert.equal(summary.cards, 1);
  assert.doesNotMatch(text, /cle-secrete/, 'jamais de clé d’API dans une sauvegarde');
  assert.equal(JSON.parse(text).settings, undefined, 'ni les réglages');

  await wipeAll();
  assert.deepEqual(await listNotebooks(), []);

  const data = await readBackup(new Blob([text], { type: 'application/json' }));
  const counts = await restoreBackup(data);
  assert.equal(counts.notebooks, 1);
  const [nb] = await listNotebooks();
  assert.equal(nb.title, 'SVT');
  assert.equal((await listSources(nb.id)).length, 1);
});

test('restaurer deux fois ne crée pas de doublons', async () => {
  await seed();
  const { text } = await createBackup();
  const data = await readBackup(new Blob([text]));
  await restoreBackup(data);
  await restoreBackup(data);
  assert.equal((await listNotebooks()).length, 1);
});

test('fichier invalide : message clair', async () => {
  await assert.rejects(readBackup(null), /Aucun fichier/);
  await assert.rejects(readBackup(new Blob(['pas du json {'])), /n’est pas une sauvegarde de Carnet Libre/);
  await assert.rejects(readBackup(new Blob([JSON.stringify({ app: 'autre', version: 1 })])), /n’est pas une sauvegarde de Carnet Libre/);
  await assert.rejects(readBackup(new Blob([JSON.stringify({ app: 'carnet-libre', version: 99 })])), /version plus récente/);
  await assert.rejects(readBackup({ size: 500 * 1024 * 1024, text: async () => '' }), /trop gros/);
});

test('effacement total : carnets, réglages et clés disparaissent', async () => {
  await seed();
  await updateSettings({ ai: { provider: 'gemini' }, ui: { theme: 'dark' } });
  await setApiKey('cle', true);
  await eraseEverything();
  assert.deepEqual(await listNotebooks(), []);
  assert.equal(await db.get('settings', 'secret'), undefined);
  assert.equal(getSettings().ai.provider, 'none');
  assert.equal(getApiKey('gemini'), '');
  await closeDB();
  await loadSettings();
  assert.equal(getSettings().ui.theme, 'auto', 'rien n’a été remis en base');
});
