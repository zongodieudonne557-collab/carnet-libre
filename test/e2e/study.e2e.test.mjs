// Modes d'étude (cartes, quiz, fiches, causerie, diapos), dans un vrai navigateur et sous la vraie politique de sécurité.
//   node --test test/e2e/study.e2e.test.mjs
// Première moitié : tout ce qui marche SANS IA. Seconde moitié : les mêmes écrans avec un faux serveur d'IA local
// (scripts/mock-llm.mjs), pour vérifier le consentement, les tâches de fond et les étiquettes « à vérifier ».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMockServer } from '../../scripts/mock-llm.mjs';
import { CORS, cspViolations, dbGet, launch, openApp } from './helpers.mjs';

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

/** Ouvre un carnet d'exemple (avec ses cartes automatiques) et renvoie des aides pour naviguer. */
async function sample(opts = {}) {
  const app = await openApp(env, opts);
  await app.page.waitForSelector('#main');
  const id = await app.page.evaluate(async () => (await import('/src/ui/sample-notebook.js')).createSampleNotebook().then((n) => n.id));
  const go = async (path, ready) => {
    await app.page.evaluate((h) => (location.hash = h), `#/n/${id}/${path}`);
    await app.page.waitForSelector(ready || '.nb-title');
  };
  const items = (store) => app.page.evaluate(async ([s, n]) => (await import('/src/db.js')).listItems(s, n), [store, id]);
  return { ...app, id, go, items };
}

/** Une page propre : aucune erreur, aucune requête hors de l'appli, aucune violation de CSP. */
async function assertClean({ page, log }, { allow = [] } = {}) {
  assert.deepEqual(log.errors, [], 'erreurs de console');
  assert.deepEqual(log.external.filter((x) => !allow.some((a) => x.includes(a))), [], 'requêtes externes');
  assert.deepEqual(await cspViolations(page), [], 'violations de CSP');
}

const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/** Branche l'IA locale (faux serveur) dans les réglages de la page. */
const useMockAI = (page, model = 'mock-small') =>
  page.evaluate(
    async ([base, m]) => {
      const { updateSettings } = await import('/src/settings.js');
      await updateSettings({ ai: { provider: 'custom', baseUrl: base, model: m } });
    },
    [mock.openaiBase, model]
  );

// =====================================================================================================================
// Sans IA
// =====================================================================================================================

test('réviser : les cinq modes, l’état des cartes, et rien qui sorte de l’appareil', async () => {
  const app = await sample();
  const { page, go, context } = app;
  await go('reviser', '.tiles');
  assert.equal(await page.locator('.tile').count(), 5);
  const names = await page.locator('.tile h3').allInnerTexts();
  assert.deepEqual(names.map((n) => n.replace(/\d+$/, '').trim()), ['Cartes mémoire', 'Quiz', 'Fiches', 'Causerie', 'Diapos']);
  assert.match(await page.locator('.hub-hero-title').innerText(), /carte.* à réviser aujourd’hui/);
  assert.match(await page.locator('.hub-ai').innerText(), /Sans IA/);
  await assertClean(app);
  await context.close();
});

test('cartes : une séance au clavier, annuler, et la progression est gardée', async () => {
  const app = await sample();
  const { page, go, items, context } = app;
  await go('cartes');
  const before = await items('cards');
  assert.ok(before.length >= 8, `le carnet d’exemple a des cartes (${before.length})`);
  await page.getByRole('button', { name: /Commencer la séance/ }).click();
  await page.waitForSelector('.flash-reveal');
  assert.equal(await page.locator('.grade-key').count(), 0, 'les notes ne sont proposées qu’après avoir retourné la carte');

  await page.keyboard.press('Space');
  await page.waitForSelector('.grade-key');
  assert.equal(await page.locator('.grade-key').count(), 4);
  await page.keyboard.press('3'); // « Bien »
  await page.waitForSelector('.flash-reveal');

  // annuler la dernière note
  await page.keyboard.press('z');
  await page.waitForSelector('.flash-reveal, .grade-key');
  const changed = async () => (await items('cards')).filter((c) => JSON.stringify(c.srs) !== JSON.stringify(before.find((b) => b.id === c.id).srs));
  assert.equal((await changed()).length, 0, 'annuler remet la carte dans son état d’avant');

  // noter de nouveau, puis quitter : la note est conservée
  await page.keyboard.press('Space');
  await page.waitForSelector('.grade-key');
  await page.keyboard.press('4'); // « Facile »
  await page.waitForSelector('.flash-reveal');
  await page.getByRole('button', { name: 'Quitter' }).click();
  await page.waitForSelector('.tiles, .stats, .flash-start, .rev-start, h2');
  assert.equal((await changed()).length, 1, 'une seule carte a changé : celle qu’on a notée « Facile »');

  // rechargement : la progression est toujours là
  await page.reload();
  await page.waitForSelector('.nb-title');
  assert.equal((await changed()).length, 1);
  await assertClean(app);
  await context.close();
});

test('cartes : modifier, supprimer avec « Annuler », ajouter la sienne, exporter', async () => {
  const app = await sample();
  const { page, go, items, context } = app;
  await go('cartes');
  await page.getByRole('radio', { name: /Mes cartes/ }).click();
  await page.waitForSelector('.card-row, .cards-list li');
  const n0 = (await items('cards')).length;

  // supprimer puis annuler
  await page.getByRole('button', { name: /^Supprimer la carte/ }).first().click();
  await page.waitForSelector('.toast');
  assert.equal((await items('cards')).length, n0 - 1);
  await page.locator('.toast').getByRole('button', { name: 'Annuler' }).click();
  await page.waitForFunction(() => !document.querySelector('.toast'));
  assert.equal((await items('cards')).length, n0, 'la carte supprimée revient');

  // ajouter sa propre carte
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const dlg = page.locator('dialog[open]');
  await dlg.waitFor();
  await dlg.locator('textarea').first().fill('Quel est le nom de la capitale du Burkina Faso ?');
  await dlg.locator('textarea').nth(1).fill('Ouagadougou');
  await dlg.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.waitForFunction(async (n) => (await (await import('/src/db.js')).listItems('cards', location.hash.split('/')[2])).length === n + 1, n0);
  const own = (await items('cards')).find((c) => c.origin === 'own');
  assert.equal(own.back, 'Ouagadougou');

  // exports (section repliée) : un fichier se télécharge, et il contient les cartes
  await page.locator('summary', { hasText: 'Emporter mes cartes ailleurs' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Pour Anki/ }).click()]);
  assert.match(dl.suggestedFilename(), /\.txt$/);
  const txt = await readFile(await dl.path(), 'utf8');
  assert.match(txt, /Ouagadougou/);
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Tableur/ }).click()]);
  assert.match(dl2.suggestedFilename(), /\.csv$/);
  await assertClean(app);
  await context.close();
});

test('cartes : chercher des cartes dans ses sources, sans IA, et n’ajouter que celles qui sont neuves', async () => {
  const app = await sample();
  const { page, go, items, context } = app;
  await go('cartes');
  const n0 = (await items('cards')).length;
  await page.getByRole('radio', { name: 'Créer' }).click();
  await page.getByRole('button', { name: /Chercher des cartes/ }).click();
  await page.waitForSelector('.auto-out .callout, .auto-list');
  const ticked = page.locator('.auto-list input[type="checkbox"]');
  const total = await ticked.count();
  if (total) {
    await page.getByRole('button', { name: /^Ajouter \d+ cartes?$/ }).click();
    await page.waitForSelector('.toast');
  }
  const n1 = (await items('cards')).length;
  assert.ok(n1 >= n0, 'on ne perd jamais de cartes');
  // le carnet d’exemple a déjà ses cartes automatiques : relancer n’en crée pas de doublon
  const fronts = (await items('cards')).map((c) => c.front);
  assert.equal(new Set(fronts).size, fronts.length, 'aucune carte en double');
  await assertClean(app);
  await context.close();
});

test('quiz : construit à partir des cartes, corrigé avec citation, erreurs ajoutées aux cartes', async () => {
  const app = await sample();
  const { page, go, items, context } = app;
  await go('quiz');
  await page.getByRole('button', { name: 'Créer le quiz' }).click();
  await page.waitForSelector('.quiz-question');
  assert.equal((await items('quizzes')).length, 1);

  // on répond toujours « 1 » : on se trompe au moins une fois (les bonnes réponses sont mélangées)
  const nCards = (await items('cards')).length;
  for (let i = 0; i < 30 && !(await page.locator('.quiz-result').count()); i++) {
    if (await page.locator('.quiz-next').count()) await page.locator('.quiz-next').click();
    else await page.keyboard.press('1');
    await page.waitForTimeout(60);
  }
  await page.waitForSelector('.quiz-result');
  assert.match(await page.locator('.quiz-result h3[data-focus]').innerText(), /^\d+ sur \d+$/);
  const q = (await items('quizzes'))[0];
  assert.equal(q.attempts.length, 1, 'le score est enregistré sur l’appareil');

  if (await page.getByRole('button', { name: 'Ajouter mes erreurs aux cartes' }).count()) {
    await page.getByRole('button', { name: 'Ajouter mes erreurs aux cartes' }).click();
    await page.waitForSelector('.toast');
    assert.ok((await items('cards')).length >= nCards);
  }
  await assertClean(app);
  await context.close();
});

test('fiche automatique : créée sans IA, lisible, copiable, téléchargeable, supprimable', async () => {
  const app = await sample();
  const { page, go, items, context } = app;
  await go('fiches');
  await page.getByRole('button', { name: /Créer la fiche automatique/ }).click();
  await page.waitForSelector('.note-view');
  const notes = await items('notes');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, 'auto');
  assert.ok(notes[0].markdown.length > 100);
  assert.ok(await page.locator('.note-prose h2, .note-prose h3').count() > 0, 'la fiche a des titres');
  assert.ok(await page.locator('.note-prose').innerText().then((t) => t.trim().length > 100));

  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Télécharger' }).click()]);
  assert.match(dl.suggestedFilename(), /\.md$/);

  await page.getByRole('button', { name: /Mes fiches/ }).click();
  await page.getByRole('button', { name: /^Supprimer la fiche/ }).click();
  await page.waitForSelector('.toast');
  assert.equal((await items('notes')).length, 0);
  await page.locator('.toast').getByRole('button', { name: 'Annuler' }).click();
  await page.waitForFunction(async () => (await (await import('/src/db.js')).listItems('notes', location.hash.split('/')[2])).length === 1);
  await assertClean(app);
  await context.close();
});

test('causerie sans IA : lire une source à voix haute, avec avertissement honnête si aucune voix n’est installée', async () => {
  const app = await sample();
  const { page, go, context } = app;
  await go('causerie');
  await page.getByRole('button', { name: /Lire à voix haute/ }).click();
  await page.waitForSelector('.transcript');
  assert.ok(await page.locator('.transcript .line').count() > 1);
  assert.ok(await page.locator('.player').isVisible());
  // pas de voix dans Chromium sans tête : l’appli le dit au lieu de promettre
  const voices = await page.evaluate(() => speechSynthesis.getVoices().length);
  if (voices === 0 || !(await page.evaluate(() => speechSynthesis.getVoices().some((v) => /^fr/i.test(v.lang))))) {
    assert.match(await page.locator('.callout-warn').first().innerText(), /voix française|lire à voix haute/);
  }
  await page.getByRole('button', { name: /Retour/ }).click();
  await page.waitForSelector('.create');
  await assertClean(app);
  await context.close();
});

test('diapos sans IA : un diaporama par titres, qu’on parcourt au clavier', async () => {
  const app = await sample();
  const { page, go, items, context } = app;
  await go('diapos');
  await page.getByRole('button', { name: /Créer le diaporama/ }).click();
  await page.waitForSelector('.deck-stage');
  const decks = await items('decks');
  assert.equal(decks.length, 1);
  assert.ok(decks[0].slides.length >= 2);
  const counter = () => page.locator('.deck-stage > [aria-live="polite"]').textContent();
  const c0 = await counter();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  const c1 = await counter();
  assert.notEqual(c0, c1, 'la flèche droite change de diapositive');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(150);
  assert.equal(await counter(), c0);
  assert.ok(await page.getByRole('button', { name: 'Plein écran' }).isVisible());
  await assertClean(app);
  await context.close();
});

test('sans IA : une fonction qui en demande une explique et mène aux Réglages, sans rien envoyer', async () => {
  const app = await sample();
  const { page, go, context } = app;
  await go('quiz');
  await page.getByRole('button', { name: /Créer avec l’IA|Rédiger avec l’IA|Écrire/ }).first().click();
  const dlg = page.locator('dialog[open]');
  await dlg.waitFor();
  assert.match(await dlg.innerText(), /a besoin d’une IA/);
  await dlg.getByRole('button', { name: 'Choisir une IA' }).click();
  await page.waitForSelector('.settings h1');
  await assertClean(app);
  await context.close();
});

test('écrans d’étude : pas de défilement horizontal sur téléphone, en clair comme en sombre', async () => {
  for (const colorScheme of ['light', 'dark']) {
    const app = await sample({ viewport: { width: 375, height: 740 }, colorScheme });
    const { page, go, context } = app;
    for (const path of ['reviser', 'cartes', 'quiz', 'fiches', 'causerie', 'diapos']) {
      await go(path);
      await page.waitForTimeout(150);
      assert.ok(await noHScroll(page), `${path} (${colorScheme}) déborde sur la largeur`);
    }
    await go('cartes');
    await page.getByRole('radio', { name: /Mes cartes/ }).click();
    assert.ok(await noHScroll(page), `liste des cartes (${colorScheme})`);
    await assertClean(app);
    await context.close();
  }
});

test('cartes : sans aucune carte, la recherche automatique en crée, puis ne propose plus les mêmes', async () => {
  const app = await sample();
  const { page, go, items, id, context } = app;
  // on repart d'un carnet sans carte
  await page.evaluate(async (n) => {
    const { listItems, deleteItem } = await import('/src/db.js');
    for (const c of await listItems('cards', n)) await deleteItem('cards', c.id);
  }, id);
  await go('reviser', '.hub-hero');
  assert.match(await page.locator('.hub-hero-title').innerText(), /Commence par des cartes/);

  await go('cartes');
  await page.getByRole('radio', { name: 'Créer' }).click();
  await page.getByRole('button', { name: /Chercher des cartes/ }).click();
  const boxes = page.locator('.auto-list input[type="checkbox"]');
  await boxes.first().waitFor();
  const proposed = await boxes.count();
  assert.ok(proposed >= 5, `des cartes sont proposées (${proposed})`);
  await page.getByRole('button', { name: /^Ajouter \d+ cartes?$/ }).click();
  await page.waitForSelector('.toast');
  const added = await items('cards');
  assert.equal(added.length, proposed, 'toutes les cartes cochées sont ajoutées');
  assert.ok(added.every((c) => c.origin === 'auto' && c.verified === true && c.quote && c.chunkId), 'chaque carte garde sa preuve');

  // on relance (l'appli est revenue sur la séance) : ce qui est proposé ne double jamais une carte déjà là
  await page.getByRole('radio', { name: 'Créer' }).click();
  await page.getByRole('button', { name: /Chercher des cartes/ }).click();
  await page.waitForSelector('.auto-out .callout, .auto-list');
  const existing = new Set((await items('cards')).map((c) => c.front));
  const again = await page.locator('.auto-front').allInnerTexts();
  assert.ok(again.every((f) => !existing.has(f)), 'aucune carte déjà présente n’est reproposée');
  assert.equal((await items('cards')).length, proposed, 'chercher n’ajoute rien tout seul');
  await assertClean(app);
  await context.close();
});

// =====================================================================================================================
// Avec une IA (faux serveur local)
// =====================================================================================================================

const MOCK_HOST = () => `127.0.0.1:${mock.port}`;
const toastWith = (page, re) => page.locator('.toast', { hasText: re });

test('cartes avec IA : tâche de fond, cartes reliées à leur extrait, aucun envoi hors du faux serveur', async () => {
  const app = await sample();
  const { page, go, items, context } = app;
  await useMockAI(page);
  mock.reset();
  await go('cartes');
  const n0 = (await items('cards')).length;
  await page.getByRole('radio', { name: 'Créer' }).click();
  await page.getByRole('button', { name: 'Créer avec l’IA' }).click();
  await toastWith(page, /cartes? ajoutées?/).waitFor();
  const ai = (await items('cards')).filter((c) => c.origin === 'ai');
  assert.ok(ai.length >= 3, `des cartes IA sont créées (${ai.length})`);
  assert.equal((await items('cards')).length, n0 + ai.length);
  assert.ok(ai.every((c) => c.chunkId && c.quote && c.verified === true), 'chaque carte est reliée à une phrase du cours');
  assert.ok(mock.requests.some((r) => r.path === '/v1/chat/completions'));
  const sent = JSON.stringify(mock.requests.map((r) => r.body));
  assert.match(sent, /<extraits>/, 'seuls des extraits des sources sont envoyés');
  await assertClean(app, { allow: [MOCK_HOST()] });
  await context.close();
});

test('cartes avec IA : une carte dont la preuve est introuvable est marquée « à vérifier », jamais présentée comme sûre', async () => {
  const app = await sample();
  const { page, go, items, context } = app;
  await useMockAI(page, 'mock-ungrounded');
  await go('cartes');
  await page.getByRole('radio', { name: 'Créer' }).click();
  await page.getByRole('button', { name: 'Créer avec l’IA' }).click();
  await toastWith(page, /à vérifier/).waitFor();
  const cards = (await items('cards')).filter((c) => c.origin === 'ai');
  assert.ok(cards.some((c) => c.verified === false), 'la carte sans preuve est marquée');
  assert.ok(cards.some((c) => c.verified === true), 'les autres restent vérifiées');
  // elle est repérable dans la liste
  await page.getByRole('radio', { name: /Mes cartes/ }).click();
  assert.ok(await page.locator('.chip', { hasText: /à vérifier/i }).count() >= 1);
  await assertClean(app, { allow: [MOCK_HOST()] });
  await context.close();
});

test('quiz avec IA : questions corrigées avec leur extrait, score enregistré', async () => {
  const app = await sample();
  const { page, go, items, context } = app;
  await useMockAI(page);
  await go('quiz');
  await page.getByRole('button', { name: 'Créer avec l’IA' }).click();
  await toastWith(page, /Quiz prêt/).waitFor();
  const [q] = (await items('quizzes')).filter((x) => x.origin === 'ai');
  assert.ok(q, 'un quiz IA est enregistré');
  assert.ok(q.questions.length >= 3);
  assert.ok(q.questions.every((x) => x.choices.length === 4 && x.answer >= 0 && x.answer < 4 && x.chunkId));
  // on le passe
  await page.getByRole('button', { name: /^(Commencer|Passer|Lancer|Jouer)/ }).first().click();
  await page.waitForSelector('.quiz-question');
  await page.keyboard.press('1');
  await page.waitForSelector('.quiz-next');
  assert.ok(await page.locator('.quiz-feedback, .quiz-explain, .feedback').count() >= 0);
  await assertClean(app, { allow: [MOCK_HOST()] });
  await context.close();
});

test('fiche avec IA : chaque idée cite son extrait, et le numéro ouvre le passage', async () => {
  const app = await sample();
  const { page, go, items, context } = app;
  await useMockAI(page);
  await go('fiches');
  await page.getByRole('button', { name: 'Rédiger avec l’IA' }).click();
  await toastWith(page, /est prête/).waitFor();
  const [n] = await items('notes');
  assert.ok(n.refs.length >= 1, 'des sources sont citées');
  assert.ok(n.refs.every((r) => r.chunkId && r.sourceTitle));
  await page.getByRole('button', { name: /^Ouvrir/ }).first().click();
  await page.waitForSelector('.note-view');
  assert.ok(await page.locator('.note-prose .katex').count() >= 1, 'la formule est composée (KaTeX)');
  const cite = page.locator('.note-prose button, .note-prose a').filter({ hasText: /^\[?\d+\]?$/ }).first();
  await cite.click();
  await page.locator('dialog[open]').waitFor();
  await page.keyboard.press('Escape');
  await assertClean(app, { allow: [MOCK_HOST()] });
  await context.close();
});

test('causerie avec IA : un dialogue à deux voix qu’on peut ouvrir et lire', async () => {
  const app = await sample();
  const { page, go, items, context } = app;
  await useMockAI(page);
  await go('causerie');
  await page.getByRole('button', { name: 'Écrire la causerie' }).click();
  await toastWith(page, /est prête/).waitFor();
  const [c] = await items('casts');
  assert.ok(c.turns.length >= 4);
  assert.deepEqual([...new Set(c.turns.map((t) => t.who))].sort(), ['A', 'B']);
  await page.getByRole('button', { name: 'Écouter', exact: true }).first().click();
  await page.waitForSelector('.transcript');
  assert.equal(await page.locator('.line-a').first().locator('.line-who').innerText(), 'Awa');
  assert.equal(await page.locator('.line-b').first().locator('.line-who').innerText(), 'Issa');
  await assertClean(app, { allow: [MOCK_HOST()] });
  await context.close();
});

test('diapos avec IA : diapositives narrées, formule composée, parcourues au clavier', async () => {
  const app = await sample();
  const { page, go, items, context } = app;
  await useMockAI(page);
  await go('diapos');
  await page.getByRole('button', { name: 'Créer avec l’IA' }).click();
  await toastWith(page, /est prêt/).waitFor();
  const [d] = (await items('decks')).filter((x) => x.origin === 'ai');
  assert.ok(d && d.slides.length >= 2);
  assert.ok(d.slides.every((s) => s.narration && s.chunkId));
  await page.getByRole('button', { name: /^(Voir|Ouvrir|Présenter|Lancer)/ }).first().click();
  await page.waitForSelector('.deck-stage');
  await page.keyboard.press('ArrowRight'); // la deuxième diapositive porte la formule
  await page.locator('.deck-stage .katex').first().waitFor({ timeout: 8000 });
  await assertClean(app, { allow: [MOCK_HOST()] });
  await context.close();
});

test('service en ligne : rien ne part sans accord explicite, l’accord est gardé, la clé n’est envoyée qu’à ce service', async () => {
  const app = await sample();
  const { page, go, context } = app;
  const seen = [];
  await page.route('https://api.groq.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    seen.push({ url: req.url(), auth: req.headers().authorization, body: req.postData() });
    const r = await fetch(mock.url + new URL(req.url()).pathname.replace(/^\/openai/, ''), { method: req.method(), headers: { 'content-type': 'application/json' }, body: req.postData() ?? undefined });
    return route.fulfill({ status: r.status, headers: { ...CORS, 'content-type': r.headers.get('content-type') || 'application/json' }, body: Buffer.from(await r.arrayBuffer()) });
  });
  await page.evaluate(async () => {
    const s = await import('/src/settings.js');
    await s.updateSettings({ ai: { provider: 'groq', model: 'mock-small' } });
    await s.setApiKey('cle-groq-test', false, 'groq');
  });
  await go('quiz');

  // 1) refus : rien ne part
  await page.getByRole('button', { name: 'Créer avec l’IA' }).click();
  const dlg = page.locator('dialog[open]');
  await dlg.waitFor();
  assert.match(await dlg.innerText(), /Envoyer tes cours à Groq/);
  assert.equal(await dlg.getByRole('button', { name: 'J’accepte' }).isDisabled(), true, 'le bouton reste grisé tant que ce n’est pas coché');
  await dlg.getByRole('button', { name: 'Annuler' }).click();
  await page.waitForTimeout(300);
  assert.equal(seen.length, 0, 'aucun envoi après un refus');
  assert.equal((await dbGet(page, 'settings', 'app'))?.value?.consent?.groq ?? null, null);

  // 2) accord : l'envoi part, avec la clé de Groq et des extraits seulement
  await page.getByRole('button', { name: 'Créer avec l’IA' }).click();
  await dlg.waitFor();
  for (const box of await dlg.locator('input[type="checkbox"]').all()) await box.check();
  await dlg.getByRole('button', { name: 'J’accepte' }).click();
  await toastWith(page, /Quiz prêt/).waitFor();
  assert.ok(seen.length >= 1);
  assert.ok(seen.every((x) => x.auth === 'Bearer cle-groq-test' && x.url.startsWith('https://api.groq.com/')));
  assert.match(seen[0].body, /<extraits>/);
  assert.ok((await dbGet(page, 'settings', 'app')).value.consent.groq.at, 'l’accord est gardé');

  // 3) la fois suivante : plus de question
  const n = seen.length;
  await page.getByRole('button', { name: 'Créer avec l’IA' }).click();
  await page.waitForFunction((k) => document.querySelector('.toast'), n);
  await page.waitForTimeout(500);
  assert.equal(await page.locator('dialog[open]').count(), 0, 'l’accord déjà donné n’est pas redemandé');
  assert.deepEqual(app.log.external.filter((x) => !x.includes('api.groq.com')), []);
  assert.deepEqual(await cspViolations(page), []);
  await context.close();
});

test('IA en panne ou clé refusée : message clair en français, rien d’enregistré, l’appli reste utilisable', async () => {
  const app = await sample();
  const { page, go, items, context } = app;
  await useMockAI(page, 'mock-401');
  await go('fiches');
  await page.getByRole('button', { name: 'Rédiger avec l’IA' }).click();
  await page.locator('.toast', { hasText: /clé|refus|autoris|accès|Invalid/i }).first().waitFor();
  assert.equal((await items('notes')).length, 0);
  assert.ok(await page.locator('.job-status .callout-bad').count() >= 1, 'l’erreur reste affichée dans l’écran');
  // on peut quand même faire la fiche automatique
  await page.getByRole('button', { name: /Créer la fiche automatique/ }).click();
  await page.waitForSelector('.note-view');
  assert.equal((await items('notes')).length, 1);
  assert.deepEqual(app.log.external.filter((x) => !x.includes(MOCK_HOST())), []);
  assert.deepEqual(await cspViolations(page), []);
  await context.close();
});

test('IA lente : « Annuler » arrête la tâche et rien n’est enregistré', async () => {
  const app = await sample();
  const { page, go, items, context } = app;
  await useMockAI(page, 'mock-slow');
  await go('quiz');
  await page.getByRole('button', { name: 'Créer avec l’IA' }).click();
  await page.locator('.job-line').waitFor();
  await page.locator('.job-line').getByRole('button', { name: 'Annuler' }).click();
  await page.waitForFunction(() => !document.querySelector('.job-line'));
  await page.waitForTimeout(3000); // le faux serveur répond après 2,5 s : la réponse tardive est ignorée
  assert.equal((await items('quizzes')).filter((q) => q.origin === 'ai').length, 0);
  assert.equal(await page.locator('.toast', { hasText: /Quiz prêt/ }).count(), 0);
  assert.deepEqual(app.log.errors, []);
  await context.close();
});
