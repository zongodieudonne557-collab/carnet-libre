// Réglages et confidentialité, dans un vrai navigateur et sous la vraie politique de sécurité.
//   node --test test/e2e/settings.e2e.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cspViolations, dbGet, fakeCloud, launch, openApp } from './helpers.mjs';

let env;
before(async () => {
  env = await launch();
});
after(async () => {
  await env.close();
});

const GROQ = 'https://api.groq.com/**';
const GROQ_MODELS = { data: [{ id: 'whisper-large-v3' }, { id: 'llama-3.1-8b-instant' }, { id: 'llama-3.3-70b-versatile' }] };

async function settings(opts) {
  const app = await openApp(env, { hash: '#/reglages', ...opts });
  await app.page.waitForSelector('.settings h1');
  return app;
}

const pickProvider = (page, name) => page.locator('label.prov', { hasText: name }).first().click();

test('réglages : ouverture propre, sans requête externe ni violation de CSP', async () => {
  const { page, log, context } = await settings();
  assert.equal(await page.locator('.settings h1').innerText(), 'Réglages');
  assert.equal(await page.locator('.set > h2').count(), 6);
  assert.equal(await page.locator('input[name="ai-provider"]').count(), 7);
  assert.equal(await page.locator('input[name="ai-provider"]:checked').getAttribute('value'), 'none');
  assert.match(await page.locator('.ai-panel').innerText(), /Sans IA, Carnet Libre reste utile/);
  assert.deepEqual(log.errors, []);
  assert.deepEqual(log.external, []);
  assert.deepEqual(await cspViolations(page), []);
  await context.close();
});

test('réglages : choisir un service ne contacte personne ; la clé ne suit pas d’un service à l’autre', async () => {
  const { page, log, context } = await settings();
  const groq = await fakeCloud(page, GROQ, () => ({ json: GROQ_MODELS }));

  await pickProvider(page, 'Groq');
  await page.waitForSelector('.panel h3');
  assert.match(await page.locator('.panel h3').innerText(), /Groq/);
  assert.ok(await page.locator('.panel .privacy').isVisible(), 'les faits de confidentialité sont affichés avant tout envoi');
  assert.equal(groq.length, 0, 'rien n’est envoyé au simple choix du service');

  await page.fill('#ai-key', 'cle-groq-123');
  await page.getByRole('button', { name: 'Actualiser la liste' }).click();
  await page.waitForSelector('.status .callout-ok');
  assert.equal(groq.length, 1);
  assert.equal(groq[0].headers.authorization, 'Bearer cle-groq-123');
  assert.match(groq[0].url, /api\.groq\.com\/openai\/v1\/models$/);
  const options = await page.locator('#ai-model option').allInnerTexts();
  assert.ok(options.some((o) => o.includes('llama-3.3-70b-versatile')));
  assert.ok(!options.some((o) => o.includes('whisper')), 'les modèles de transcription audio sont écartés');
  assert.equal(await page.locator('#ai-model').inputValue(), 'llama-3.3-70b-versatile', 'un modèle conseillé est choisi');

  // autre service : champ de clé vide, pas de modèle, et aucune requête avec la clé de Groq
  await pickProvider(page, 'Google Gemini');
  await page.waitForSelector('.panel h3:has-text("Gemini")');
  assert.equal(await page.inputValue('#ai-key'), '');
  assert.equal(await page.locator('#ai-model').inputValue(), '');

  // retour : la clé (en mémoire) et le modèle de Groq sont retrouvés
  await pickProvider(page, 'Groq');
  await page.waitForSelector('.panel h3:has-text("Groq")');
  assert.equal(await page.inputValue('#ai-key'), 'cle-groq-123');
  assert.equal(await page.locator('#ai-model').inputValue(), 'llama-3.3-70b-versatile');
  assert.equal(groq.length, 1);
  assert.deepEqual(log.external.filter((x) => !x.includes('api.groq.com')), []);
  assert.deepEqual(log.errors, []);
  assert.deepEqual(await cspViolations(page), []);
  await context.close();
});

test('clé d’API : en mémoire seulement par défaut, mémorisée sur demande', async () => {
  const { page, context } = await settings();
  await pickProvider(page, 'Groq');
  await page.fill('#ai-key', 'cle-secrete-xyz');
  await page.press('#ai-key', 'Tab'); // déclenche « change »
  assert.equal(await dbGet(page, 'settings', 'secret'), null, 'rien d’écrit sur l’appareil');
  const stored = JSON.stringify(await dbGet(page, 'settings', 'app'));
  assert.ok(!stored.includes('cle-secrete-xyz'), 'jamais dans les réglages non plus');

  await page.getByLabel('Mémoriser sur cet appareil').check();
  await page.waitForFunction(async () => !!(await (await import('/src/db.js')).db.get('settings', 'secret')));
  assert.deepEqual((await dbGet(page, 'settings', 'secret')).value, { groq: 'cle-secrete-xyz' });

  await page.reload();
  await page.waitForSelector('.settings h1');
  assert.equal(await page.locator('input[name="ai-provider"]:checked').getAttribute('value'), 'groq');
  assert.equal(await page.inputValue('#ai-key'), 'cle-secrete-xyz', 'retrouvée après rechargement');

  await page.getByLabel('Mémoriser sur cet appareil').uncheck();
  await page.waitForFunction(async () => !(await (await import('/src/db.js')).db.get('settings', 'secret')));
  assert.equal(await dbGet(page, 'settings', 'secret'), null);
  await page.reload();
  await page.waitForSelector('.settings h1');
  assert.equal(await page.inputValue('#ai-key'), '', 'oubliée : elle ne survit pas au rechargement');
  await context.close();
});

test('clé d’API : le bouton « œil » affiche et masque', async () => {
  const { page, context } = await settings();
  await pickProvider(page, 'Groq');
  assert.equal(await page.getAttribute('#ai-key', 'type'), 'password');
  const eye = page.getByRole('button', { name: /Afficher la clé Groq/ });
  await eye.click();
  assert.equal(await page.getAttribute('#ai-key', 'type'), 'text');
  assert.equal(await eye.getAttribute('aria-pressed'), 'true');
  await eye.click();
  assert.equal(await page.getAttribute('#ai-key', 'type'), 'password');
  await context.close();
});

test('accord d’envoi : donné, retiré, et exigé deux fois pour Gemini (18 ans)', async () => {
  const { page, context } = await settings();
  await pickProvider(page, 'Groq');
  assert.match(await page.locator('.consent').innerText(), /Accord pas encore donné/);

  await page.getByRole('button', { name: 'Lire et accepter…' }).click();
  const dlg = page.locator('dialog.modal[open]');
  await dlg.waitFor();
  const accept = dlg.getByRole('button', { name: 'J’accepte' });
  assert.ok(await accept.isDisabled());
  assert.equal(await dlg.locator('input[type=checkbox]').count(), 1);
  await dlg.locator('input[type=checkbox]').first().check();
  assert.ok(await accept.isEnabled());
  await accept.click();
  await page.waitForSelector('.consent .chip-ok');
  assert.match(await page.locator('.consent').innerText(), /Accord donné le/);
  assert.equal((await dbGet(page, 'settings', 'app')).value.consent.groq.version, 1);

  await page.getByRole('button', { name: 'Retirer mon accord' }).click();
  await page.waitForSelector('.consent .chip-warn');
  assert.equal((await dbGet(page, 'settings', 'app')).value.consent.groq, undefined);

  await pickProvider(page, 'Google Gemini');
  await page.getByRole('button', { name: 'Lire et accepter…' }).click();
  const dlg2 = page.locator('dialog.modal[open]');
  await dlg2.waitFor();
  assert.equal(await dlg2.locator('input[type=checkbox]').count(), 2, 'compréhension + âge');
  await dlg2.locator('input[type=checkbox]').nth(0).check();
  assert.ok(await dlg2.getByRole('button', { name: 'J’accepte' }).isDisabled(), 'une seule case ne suffit pas');
  await dlg2.getByRole('button', { name: 'Annuler' }).click();
  assert.match(await page.locator('.consent').innerText(), /pas encore donné/);
  await context.close();
});

test('test de connexion : n’envoie que le mot « ok », sans accord ni texte de cours ; erreurs claires', async () => {
  const { page, context } = await settings();
  let mode = 'ok';
  const seen = await fakeCloud(page, GROQ, (req) => {
    if (mode === 'refuse') return { status: 401, json: { error: { message: 'Invalid API Key' } } };
    if (req.method === 'POST') return { json: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] } };
    return { json: GROQ_MODELS };
  });
  await pickProvider(page, 'Groq');

  // sans clé : message de configuration, rien d'envoyé
  await page.getByRole('button', { name: 'Tester la connexion' }).click();
  await page.waitForSelector('.status .callout-bad');
  assert.match(await page.locator('.status').innerText(), /Colle ta clé Groq/);
  assert.equal(seen.length, 0);

  await page.fill('#ai-key', 'cle-test');
  await page.getByRole('button', { name: 'Actualiser la liste' }).click();
  await page.waitForSelector('.status .callout-ok');
  seen.length = 0;

  await page.getByRole('button', { name: 'Tester la connexion' }).click();
  await page.waitForFunction(() => /Ça marche/.test(document.querySelector('.status')?.innerText || ''));
  const post = seen.find((r) => r.method === 'POST');
  assert.ok(post, 'une demande de test a été envoyée');
  const body = JSON.parse(post.body);
  assert.equal(body.messages.length, 1);
  assert.match(body.messages[0].content, /Réponds uniquement par le mot : ok/);
  assert.ok(body.max_tokens <= 16);
  assert.match(await page.locator('.status').innerText(), /« ok »/);

  mode = 'refuse';
  await page.getByRole('button', { name: 'Tester la connexion' }).click();
  await page.waitForSelector('.status .callout-bad');
  assert.match(await page.locator('.status').innerText(), /refusé la clé/);
  await context.close();
});

test('serveur perso : avertissement pour une adresse distante, pas pour localhost', async () => {
  const { page, context } = await settings();
  await pickProvider(page, 'Autre serveur');
  const url = page.locator('#ai-url');
  await url.fill('https://exemple.org/v1');
  assert.match(await page.locator('.panel').innerText(), /doit tourner sur ton ordinateur/);
  await url.fill('http://localhost:1234/v1');
  await url.press('Tab');
  assert.doesNotMatch(await page.locator('.panel').innerText(), /doit tourner sur ton ordinateur/);
  assert.equal((await dbGet(page, 'settings', 'app')).value.ai.baseUrl, 'http://localhost:1234/v1');

  // une adresse distante est refusée au test, avec un message clair
  await url.fill('https://exemple.org/v1');
  await url.press('Tab');
  await page.getByRole('button', { name: 'Tester la connexion' }).click();
  await page.waitForSelector('.status .callout-bad');
  assert.match(await page.locator('.status').innerText(), /ordinateur/);
  await context.close();
});

test('apparence : thème et taille du texte, synchronisés avec le bouton de l’en-tête', async () => {
  const { page, context } = await settings();
  const radio = (name) => page.getByRole('radio', { name, exact: true });
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  await radio('Sombre').click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(await page.evaluate(() => localStorage.getItem('cl-theme')), 'dark');
  await radio('Énorme').click();
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--font-scale') === '1.5');
  assert.equal(await page.evaluate(() => localStorage.getItem('cl-font-scale')), '1.5');

  // le bouton de l'en-tête fait tourner le thème : sombre → automatique
  await page.click('#theme-btn');
  assert.equal(await radio('Automatique').getAttribute('aria-checked'), 'true');
  assert.equal(await radio('Sombre').getAttribute('aria-checked'), 'false');

  // clavier : flèche droite sur le groupe passe au suivant
  await radio('Automatique').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await radio('Clair').getAttribute('aria-checked'), 'true');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  // le thème s'applique tout de suite ; l'écriture sur l'appareil suit de quelques millisecondes
  await page.waitForFunction(async () => (await (await import('/src/db.js')).db.get('settings', 'app'))?.value.ui.theme === 'light');

  await page.reload();
  await page.waitForSelector('.settings h1');
  assert.equal(await theme(), 'light', 'préférence retrouvée');
  assert.equal(await radio('Énorme').getAttribute('aria-checked'), 'true');
  await context.close();
});

test('données : sauvegarde sans clé, effacement confirmé par écrit, restauration', async () => {
  const { page, context } = await openApp(env, { hash: '#/' });
  await page.getByRole('button', { name: 'Essayer avec un cours d’exemple' }).click();
  await page.waitForURL(/\/discuter$/);
  await page.evaluate(async () => {
    const { updateSettings, setApiKey } = await import('/src/settings.js');
    await updateSettings({ ai: { provider: 'groq' } });
    await setApiKey('cle-a-ne-jamais-sauvegarder', true);
  });
  await page.goto(`${env.server.url}/index.html?nosw#/reglages`);
  await page.waitForSelector('.settings h1');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Télécharger', exact: true }).click()]);
  assert.match(download.suggestedFilename(), /^carnet-libre-sauvegarde-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();
  const text = await readFile(path, 'utf8');
  const data = JSON.parse(text);
  assert.equal(data.app, 'carnet-libre');
  assert.equal(data.notebooks.length, 1);
  assert.ok(data.cards.length > 5);
  assert.ok(!text.includes('cle-a-ne-jamais-sauvegarder'), 'jamais de clé dans une sauvegarde');
  assert.equal(data.settings, undefined);

  // effacer : le bouton reste bloqué tant que le mot n'est pas écrit
  await page.getByRole('button', { name: 'Tout effacer…' }).click();
  const dlg = page.locator('dialog.modal[open]');
  const wipe = dlg.getByRole('button', { name: 'Tout effacer', exact: true });
  assert.ok(await wipe.isDisabled());
  await dlg.locator('#erase-confirm').fill('efface');
  assert.ok(await wipe.isDisabled());
  await dlg.locator('#erase-confirm').fill(' effacer ');
  assert.ok(await wipe.isEnabled());
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), wipe.click()]);
  await page.waitForSelector('.welcome');
  assert.equal(await dbGet(page, 'settings', 'secret'), null);
  assert.deepEqual(await page.evaluate(async () => (await (await import('/src/db.js')).listNotebooks()).length), 0);

  // restaurer
  await page.goto(`${env.server.url}/index.html?nosw#/reglages`);
  await page.waitForSelector('.settings h1');
  await page.setInputFiles('input[type=file][accept*="json"]', path);
  const confirm = page.locator('dialog.modal[open]');
  await confirm.waitFor();
  assert.match(await confirm.innerText(), /1 carnet/);
  await confirm.getByRole('button', { name: 'Restaurer' }).click();
  await page.waitForSelector('.shelf');
  assert.equal(await page.locator('.shelf .cover-title').count(), 1);

  // un mauvais fichier est refusé avec un message clair
  await page.goto(`${env.server.url}/index.html?nosw#/reglages`);
  await page.waitForSelector('.settings h1');
  await page.setInputFiles('input[type=file][accept*="json"]', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"pas":"une sauvegarde"}') });
  await page.waitForSelector('.toast-error');
  assert.match(await page.locator('.toast-error').innerText(), /n’est pas une sauvegarde de Carnet Libre/);
  await context.close();
});

test('confidentialité : page complète, faits des fournisseurs, rien d’externe', async () => {
  const { page, log, context } = await openApp(env, { hash: '#/confidentialite' });
  await page.waitForSelector('.privacy-page h1');
  assert.equal(await page.locator('.privacy-page h1').innerText(), 'Confidentialité');
  assert.equal(await page.locator('.privacy-page details.help').count(), 6, 'un bloc par fournisseur (hors « sans IA »)');
  const text = await page.locator('.privacy-page').innerText();
  assert.match(text, /Gemini et Mistral/, 'les offres qui réutilisent les textes sont nommées');
  assert.match(text, /25 octobre 2026/, 'date de relevé des conditions');
  assert.match(text, /pas de compte, pas de cookie/i);
  await page.locator('details.help', { hasText: 'Gemini' }).locator('summary').click();
  assert.match(await page.locator('details.help[open]').innerText(), /18 ans/);
  assert.deepEqual(log.errors, []);
  assert.deepEqual(log.external, []);
  assert.deepEqual(await cspViolations(page), []);
  await context.close();
});

test('mobile : pas de défilement horizontal sur Réglages et Confidentialité', async () => {
  for (const hash of ['#/reglages', '#/confidentialite']) {
    const { page, context } = await openApp(env, { hash, viewport: { width: 360, height: 740 } });
    await page.waitForSelector('.page h1');
    await page.waitForTimeout(500);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, `${hash} déborde de ${over}px`);
    await context.close();
  }
});
