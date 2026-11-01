// Mode hors ligne (service worker), dans un vrai navigateur.
//   node --test test/e2e/offline.e2e.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockServer } from '../../scripts/mock-llm.mjs';
import { ROOT, writePrecache } from '../../scripts/build-precache.mjs';
import { startServer } from '../../scripts/serve.mjs';
import { cspViolations, launch, openApp } from './helpers.mjs';

let env;
let mock;
before(async () => {
  env = await launch();
  mock = await createMockServer();
});
after(async () => {
  await env.close();
  await mock.close();
});

/** Ouvre l'appli AVEC le service worker, attend qu'il contrôle la page, et note les requêtes qui échouent. */
async function withWorker(e = env, opts = {}) {
  const app = await openApp(e, { query: '', ...opts });
  const failed = [];
  app.page.on('requestfailed', (r) => failed.push(r.url()));
  await app.page.evaluate(() => navigator.serviceWorker.ready);
  await app.page.reload(); // la première visite n'est pas contrôlée : on recharge une fois
  await app.page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await app.page.waitForFunction(() => document.querySelector('#main')?.innerText.trim().length > 0);
  return { ...app, failed };
}


/** Attend (en relisant) que le texte d'un élément corresponde, puis le renvoie : évite de lire pendant qu'un écran se redessine. */
async function textOf(page, selector, re, timeout = 15000) {
  const handle = await page.waitForFunction(
    ([sel, src, flags]) => {
      const t = document.querySelector(sel)?.innerText || '';
      return new RegExp(src, flags).test(t) ? t : null;
    },
    [selector, re.source, re.flags],
    { timeout }
  );
  return handle.jsonValue();
}

const cacheKeys = (page) =>
  page.evaluate(async () => {
    const out = {};
    for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).map((r) => r.url);
    return out;
  });

test('hors ligne : l’appli s’ouvre et marche sans Internet, avec les données déjà là', async () => {
  const app = await withWorker();
  const { page, context, failed, url } = app;
  const caches = await cacheKeys(page);
  const names = Object.keys(caches);
  assert.equal(names.length, 1, 'un seul cache (celui de l’appli) avant tout usage de l’OCR ou des PDF');
  assert.match(names[0], /^carnet-app-/);
  assert.ok(caches[names[0]].includes(`${url}/index.html`));
  assert.ok(caches[names[0]].every((u) => u.startsWith(url)), 'rien d’autre que des fichiers de l’appli');
  assert.ok(!caches[names[0]].some((u) => u.includes('/vendor/tesseract/') || u.includes('/vendor/pdfjs/')), 'les gros fichiers ne sont pas préchargés');

  const id = await page.evaluate(async () => (await import('/src/ui/sample-notebook.js')).createSampleNotebook().then((n) => n.id));

  await context.setOffline(true);
  await page.goto(`${url}/index.html#/`);
  await page.reload();
  assert.match(await textOf(page, '#main', /Carnet|cahier|étagère/i), /Carnet|cahier|étagère/i);
  await page.evaluate((h) => (location.hash = h), `#/n/${id}/cartes`);
  await page.getByRole('button', { name: /Commencer la séance/ }).click();
  await page.waitForSelector('.flash-reveal');
  await page.keyboard.press('Space');
  await page.waitForSelector('.grade-key');
  await page.evaluate((h) => (location.hash = h), `#/n/${id}/quiz`);
  await page.getByRole('button', { name: 'Créer le quiz' }).click();
  await page.waitForSelector('.quiz-question');
  // les formules (KaTeX) et les polices viennent aussi du cache
  await page.evaluate((h) => (location.hash = h), `#/n/${id}/fiches`);
  await page.getByRole('button', { name: /Créer la fiche automatique/ }).click();
  await page.waitForSelector('.note-view');

  const bad = failed.filter((u) => !/\/(sw|precache)\.js$/.test(u));
  assert.deepEqual(bad, [], 'aucun fichier de l’appli n’a manqué hors ligne');
  assert.deepEqual(app.log.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e)), []);
  assert.deepEqual(await cspViolations(page), []);
  await context.close();
});

test('le service worker ne voit, ne garde et ne modifie jamais les requêtes vers une IA', async () => {
  const app = await withWorker();
  const { page, context, url } = app;
  const id = await page.evaluate(async () => (await import('/src/ui/sample-notebook.js')).createSampleNotebook().then((n) => n.id));
  await page.evaluate(async (base) => {
    const { updateSettings } = await import('/src/settings.js');
    await updateSettings({ ai: { provider: 'custom', baseUrl: base, model: 'mock-small' } });
  }, mock.openaiBase);
  mock.reset();
  await page.evaluate((h) => (location.hash = h), `#/n/${id}/quiz`);
  await page.getByRole('button', { name: 'Créer avec l’IA' }).click();
  await page.locator('.toast', { hasText: /Quiz prêt/ }).waitFor();
  assert.ok(mock.requests.some((r) => r.path === '/v1/chat/completions'), 'la demande est bien partie');
  const all = Object.values(await cacheKeys(page)).flat();
  assert.ok(all.every((u) => u.startsWith(url)), 'aucune adresse extérieure dans les caches');
  assert.ok(!all.some((u) => /completions|\/v1\//.test(u)));
  await context.close();
});

test('« tout préparer » : OCR et lecteur de PDF gardés, puis ils marchent sans Internet', async () => {
  const app = await withWorker(env, { hash: '#/reglages' });
  const { page, context, url } = app;
  await textOf(page, '.offline-list', /Prête : elle s’ouvre sans Internet/);
  await textOf(page, '.offline-list', /Téléchargé au premier PDF/);
  await page.getByRole('button', { name: /Tout préparer/ }).click();
  await page.locator('.toast', { hasText: /Prêt : l’OCR/ }).waitFor({ timeout: 90000 });
  await textOf(page, '.offline-list', /Prêt hors ligne/);
  await textOf(page, '.offline-action', /Tout est prêt/);
  const names = Object.keys(await cacheKeys(page));
  assert.ok(names.some((n) => n.startsWith('carnet-vendor-')));

  // sans Internet : le moteur d'OCR démarre et lit du texte ; le lecteur de PDF se charge
  await context.setOffline(true);
  const result = await page.evaluate(async () => {
    const { createOcr } = await import('/src/import/ocr.js');
    const { loadPdfjs } = await import('/src/import/pdf.js');
    const lib = await loadPdfjs();
    const c = document.createElement('canvas');
    c.width = 900;
    c.height = 220;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000';
    g.font = 'bold 72px sans-serif';
    g.fillText('Bonjour le monde', 40, 130);
    const ocr = await createOcr();
    const out = await ocr.recognize(c, { prepare: false });
    await ocr.close();
    return { text: out.text, hasPdf: typeof lib.getDocument === 'function' };
  });
  assert.ok(result.hasPdf, 'PDF.js se charge hors ligne');
  assert.match(result.text, /bonjour/i, `l’OCR lit le texte hors ligne (lu : « ${result.text.trim()} »)`);
  assert.ok(Object.values(await cacheKeys(page)).flat().every((u) => u.startsWith(url)));
  await context.close();
});

test('mise à jour : une nouvelle version est proposée, jamais imposée, puis remplace l’ancienne', async () => {
  // une copie de l'appli qu'on peut modifier sans toucher au dépôt
  const dir = await mkdtemp(join(tmpdir(), 'carnet-maj-'));
  const server = await startServer({ root: dir });
  try {
    for (const p of ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'src', 'icons', 'vendor/fonts', 'vendor/katex', 'vendor/fflate']) {
      await cp(join(ROOT, p), join(dir, p), { recursive: true });
    }
    writePrecache(dir);
    const e2 = { browser: env.browser, server };
    const app = await withWorker(e2);
    const { page, context } = app;
    const before = Object.keys(await cacheKeys(page));
    assert.equal(before.length, 1);
    assert.equal(await page.locator('.toast', { hasText: /nouvelle version/ }).count(), 0, 'rien à proposer tant que rien n’a changé');

    // la « nouvelle version » : un fichier change, la liste est recalculée
    await appendFile(join(dir, 'css/base.css'), '\n/* version-2-marqueur */\n');
    writePrecache(dir);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    const toast = page.locator('.toast', { hasText: /nouvelle version/ });
    await toast.waitFor({ timeout: 15000 });
    assert.equal((await page.evaluate(() => fetch('css/base.css').then((r) => r.text()))).includes('version-2-marqueur'), false, 'la page en cours reste sur l’ancienne version tant qu’on n’a pas accepté');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.v ?? null), null);

    // on accepte : la page se recharge et sert la nouvelle version, l'ancien cache disparaît
    await Promise.all([page.waitForEvent('load'), toast.getByRole('button', { name: 'Mettre à jour' }).click()]);
    await page.waitForSelector('#main');
    await page.waitForFunction(async () => (await caches.keys()).length === 1);
    const after = Object.keys(await cacheKeys(page));
    assert.notEqual(after[0], before[0], 'le cache de la nouvelle version a remplacé l’ancien');
    assert.equal((await page.evaluate(() => fetch('css/base.css').then((r) => r.text()))).includes('version-2-marqueur'), true);
    assert.equal(await page.locator('.toast', { hasText: /nouvelle version/ }).count(), 0);
    await context.close();
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
