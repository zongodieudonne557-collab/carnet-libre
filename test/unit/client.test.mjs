import 'fake-indexeddb/auto';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMockServer } from '../../scripts/mock-llm.mjs';
import { chat, listModels, testConnection, resolveConfig, AIError, stripThink } from '../../src/ai/client.js';
import { PROVIDERS, connectOrigins } from '../../src/ai/providers.js';
import { loadSettings, giveConsent, revokeConsent } from '../../src/settings.js';

let mock;
before(async () => {
  mock = await createMockServer();
  await loadSettings();
  await giveConsent('gemini'); // les tests de protocole simulent un service en ligne dont l'envoi a été accepté
  await giveConsent('groq');
});
after(async () => {
  await mock.close();
});

const cfgOpenAI = (model = 'mock-small', extra = {}) => ({
  provider: { ...PROVIDERS.custom, short: 'Mock' },
  baseUrl: mock.openaiBase,
  key: '',
  model,
  temperature: 0.4,
  ...extra,
});
const cfgGemini = (model = 'gemini-mock-flash') => ({ provider: { ...PROVIDERS.gemini, short: 'Gemini' }, baseUrl: mock.geminiBase, key: 'cle-gemini', model, temperature: 0.4 });
const ask = [{ role: 'system', content: 'Tâche : test.' }, { role: 'user', content: 'Bonjour' }];

test('stripThink retire la réflexion, même non refermée', () => {
  assert.equal(stripThink('<think>a { b</think>\nBonjour'), 'Bonjour');
  assert.equal(stripThink('Début <think>réflexion en cours'), 'Début ');
  assert.equal(stripThink(null), '');
});

test('OpenAI : réponse complète et en direct donnent le même texte', async () => {
  const full = await chat({ config: cfgOpenAI(), messages: ask });
  assert.equal(full.text, 'ok');
  assert.equal(full.truncated, false);
  const seen = [];
  const live = await chat({ config: cfgOpenAI(), messages: ask, stream: true, onToken: (t) => seen.push(t) });
  assert.equal(live.text, 'ok');
  assert.equal(seen.at(-1), 'ok');
});

test('OpenAI : le flux en direct est assemblé morceau par morceau, même coupé en plein milieu', async () => {
  const msgs = [
    { role: 'system', content: 'Tâche : répondre à une question de l’élève.' },
    { role: 'user', content: '<extraits>\n[1] « Cours » — p. 1\nLa photosynthèse se déroule dans les chloroplastes des cellules végétales vertes.\n</extraits>\n\nQUESTION : photosynthèse chloroplastes ?' },
  ];
  const plain = await chat({ config: cfgOpenAI('mock-small'), messages: msgs });
  const seen = [];
  const split = await chat({ config: cfgOpenAI('mock-split'), messages: msgs, stream: true, onToken: (t) => seen.push(t) });
  assert.equal(split.text, plain.text);
  assert.ok(seen.length > 3, 'plusieurs mises à jour progressives');
  assert.ok(seen.every((t, i) => i === 0 || t.length >= seen[i - 1].length), 'le texte ne fait que grandir');
});

test('OpenAI : clé envoyée en Bearer seulement si elle existe', async () => {
  mock.reset();
  await chat({ config: cfgOpenAI('mock-small', { key: 'secret-1' }), messages: ask });
  assert.equal(mock.requests.at(-1).headers.authorization, 'Bearer secret-1');
  await chat({ config: cfgOpenAI(), messages: ask });
  assert.equal(mock.requests.at(-1).headers.authorization, undefined);
});

test('OpenAI : mode JSON refusé par le serveur → nouvelle tentative sans ce mode', async () => {
  mock.reset();
  const r = await chat({ config: cfgOpenAI('mock-nojson'), messages: ask, json: true, retryDelayMs: 1 });
  assert.equal(r.text, 'ok');
  const posts = mock.requests.filter((q) => q.method === 'POST');
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0].body.response_format, { type: 'json_object' });
  assert.equal(posts[1].body.response_format, undefined);
});

test('OpenAI : blocs de réflexion masqués', async () => {
  const r = await chat({ config: cfgOpenAI('mock-think'), messages: ask, stream: true });
  assert.equal(r.text, 'ok');
});

test('Gemini : en-tête de clé, rôles et consigne système, flux et réponse complète', async () => {
  mock.reset();
  const msgs = [
    { role: 'system', content: 'Tâche : test.' },
    { role: 'user', content: 'Question 1' },
    { role: 'assistant', content: 'Réponse 1' },
    { role: 'user', content: 'Question 2' },
  ];
  const full = await chat({ config: cfgGemini(), messages: msgs, json: true, maxTokens: 500 });
  assert.equal(full.text, 'ok');
  const req = mock.requests.at(-1);
  assert.equal(req.headers['x-goog-api-key'], 'cle-gemini');
  assert.equal(req.headers.authorization, undefined);
  assert.equal(req.path, '/v1beta/models/gemini-mock-flash:generateContent');
  assert.deepEqual(req.body.contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.equal(req.body.systemInstruction.parts[0].text, 'Tâche : test.');
  assert.equal(req.body.generationConfig.responseMimeType, 'application/json');
  assert.ok(req.body.generationConfig.maxOutputTokens >= 1000, 'marge pour les modèles à réflexion');

  const seen = [];
  const live = await chat({ config: cfgGemini(), messages: msgs, stream: true, onToken: (t) => seen.push(t) });
  assert.equal(live.text, 'ok');
  assert.match(mock.requests.at(-1).path + mock.requests.at(-1).query, /:streamGenerateContent\?alt=sse/);
});

test('erreurs : clé refusée', async () => {
  await assert.rejects(chat({ config: cfgOpenAI('mock-401'), messages: ask }), (e) => {
    assert.ok(e instanceof AIError);
    assert.equal(e.kind, 'auth');
    assert.match(e.message, /refusé la clé/);
    return true;
  });
});

test('erreurs : modèle introuvable', async () => {
  await assert.rejects(chat({ config: cfgOpenAI('modele-inconnu'), messages: ask }), (e) => e.kind === 'model' && /modele-inconnu/.test(e.message));
});

test('erreurs : limite de débit longue → message clair, sans attendre', async () => {
  const t0 = Date.now();
  await assert.rejects(chat({ config: cfgOpenAI('mock-429-always'), messages: ask }), (e) => e.kind === 'rate' && /Limite gratuite/.test(e.message) && e.retryAfter === 60000);
  assert.ok(Date.now() - t0 < 1500);
});

test('limite de débit courte et panne serveur : nouvelle tentative automatique', async () => {
  mock.reset();
  const status = [];
  const a = await chat({ config: cfgOpenAI('mock-429-once'), messages: ask, retryDelayMs: 5, onStatus: (m) => status.push(m) });
  assert.equal(a.text, 'ok');
  assert.equal(status.length, 1);
  assert.match(status[0], /nouvelle tentative/);
  const b = await chat({ config: cfgOpenAI('mock-500-once'), messages: ask, retryDelayMs: 5 });
  assert.equal(b.text, 'ok');
});

test('erreurs : serveur injoignable (local et distant)', async () => {
  const dead = 'http://127.0.0.1:9/v1';
  await assert.rejects(chat({ config: { ...cfgOpenAI(), baseUrl: dead, provider: { ...PROVIDERS.ollama, short: 'Ollama' } }, messages: ask }), (e) => e.kind === 'network' && /OLLAMA_ORIGINS/.test(e.message));
  await assert.rejects(chat({ config: { ...cfgOpenAI(), baseUrl: dead, provider: { ...PROVIDERS.groq, short: 'Groq' } }, messages: ask }), (e) => e.kind === 'network' && /connexion Internet/.test(e.message));
});

test('erreurs : délai dépassé et annulation par l’utilisateur', async () => {
  await assert.rejects(chat({ config: cfgOpenAI('mock-slow'), messages: ask, timeoutMs: 150 }), (e) => e.kind === 'timeout');
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 100);
  await assert.rejects(chat({ config: cfgOpenAI('mock-slow'), messages: ask, signal: ctrl.signal }), (e) => e.kind === 'abort');
  const already = new AbortController();
  already.abort();
  await assert.rejects(chat({ config: cfgOpenAI(), messages: ask, signal: already.signal }), (e) => e.kind === 'abort');
});

test('modèles : filtre des modèles non textuels et des modèles payants OpenRouter', async () => {
  const generic = await listModels(cfgOpenAI('', { provider: { ...PROVIDERS.groq, short: 'Groq' } }));
  assert.ok(generic.some((m) => m.id === 'mock-small'));
  assert.ok(!generic.some((m) => /whisper/.test(m.id)), 'les modèles de transcription sont exclus');
  const free = await listModels(cfgOpenAI('', { provider: { ...PROVIDERS.openrouter, short: 'OpenRouter' }, onlyFree: true }));
  assert.ok(free.some((m) => m.id === 'vendor/free-one:free'));
  assert.ok(!free.some((m) => m.id === 'vendor/paid-one'));
  assert.ok(!free.some((m) => m.id === 'mock-small'), 'sans prix gratuit annoncé, un modèle n’est pas listé');
  const all = await listModels(cfgOpenAI('', { provider: { ...PROVIDERS.openrouter, short: 'OpenRouter' }, onlyFree: false }));
  assert.ok(all.some((m) => m.id === 'vendor/paid-one'));
});

test('modèles Gemini : seulement ceux qui savent générer du texte, sans préfixe « models/ »', async () => {
  const list = await listModels(cfgGemini(''));
  assert.deepEqual(list.map((m) => m.id), ['gemini-mock-flash']);
});

test('test de connexion', async () => {
  const r = await testConnection(cfgOpenAI('mock-small'));
  assert.equal(r.ok, true);
  assert.equal(r.reply, 'ok');
  assert.ok(r.models.length >= 5);
  await assert.rejects(testConnection({ ...cfgOpenAI('mock-401') }), (e) => e.kind === 'auth');
});

test('configuration : messages clairs', () => {
  const S = (ai) => ({ ai: { provider: 'none', baseUrl: '', model: '', temperature: 0.4, ...ai } });
  assert.throws(() => resolveConfig(S({}), ''), (e) => e.kind === 'config' && /Aucune IA/.test(e.message));
  assert.throws(() => resolveConfig(S({ provider: 'groq', model: 'x' }), ''), (e) => /clé Groq/.test(e.message));
  assert.throws(() => resolveConfig(S({ provider: 'custom', model: 'x' }), ''), (e) => /adresse du serveur/.test(e.message));
  assert.throws(() => resolveConfig(S({ provider: 'custom', baseUrl: 'localhost:1234', model: 'x' }), ''), (e) => /http/.test(e.message));
  const ok = resolveConfig(S({ provider: 'custom', baseUrl: 'http://localhost:1234/v1/', model: 'models/m' }), '');
  assert.equal(ok.baseUrl, 'http://localhost:1234/v1');
  assert.equal(ok.model, 'm');
  // le serveur « perso » est classé « reste sur l'appareil » : il ne peut pas être distant (sinon aucun accord ne serait demandé)
  assert.throws(() => resolveConfig(S({ provider: 'custom', baseUrl: 'https://exemple.org/v1', model: 'x' }), ''), (e) => e.kind === 'config' && /ordinateur/.test(e.message));
  assert.throws(() => resolveConfig(S({ provider: 'custom', baseUrl: 'http://192.168.1.20:1234/v1', model: 'x' }), ''), (e) => e.kind === 'config');
  assert.equal(resolveConfig(S({ provider: 'custom', baseUrl: 'http://127.0.0.1:8080/v1', model: 'x' }), '').baseUrl, 'http://127.0.0.1:8080/v1');
  assert.equal(resolveConfig(S({ provider: 'ollama', model: 'llama' }), '').baseUrl, 'http://localhost:11434/v1');
  assert.equal(resolveConfig(S({ provider: 'gemini', model: 'g' }), 'k').key, 'k');
});

test('aucun modèle choisi → erreur de configuration avant tout appel réseau', async () => {
  mock.reset();
  await assert.rejects(chat({ config: cfgOpenAI(''), messages: ask }), (e) => e.kind === 'config' && /modèle/.test(e.message));
  assert.equal(mock.requests.length, 0);
});

test('fournisseurs : faits de confidentialité présents et cohérents avec la règle de sécurité', () => {
  for (const p of Object.values(PROVIDERS).filter((x) => x.kind === 'cloud')) {
    assert.ok(p.privacy.headline && p.privacy.points.length >= 1, p.id);
    assert.ok(p.privacy.links.length >= 1, `${p.id} : lien vers les conditions`);
    assert.match(p.keyUrl, /^https:\/\//);
    assert.match(p.baseUrl, /^https:\/\//);
  }
  assert.equal(PROVIDERS.gemini.privacy.trains, 'yes');
  assert.equal(PROVIDERS.gemini.privacy.minAge, 18);
  assert.equal(PROVIDERS.mistral.privacy.trains, 'yes');
  assert.equal(PROVIDERS.ollama.privacy.trains, 'no');
  assert.deepEqual(connectOrigins().sort(), ['https://api.groq.com', 'https://api.mistral.ai', 'https://generativelanguage.googleapis.com', 'https://openrouter.ai']);
});

test('service en ligne : aucun envoi tant que le consentement n’est pas donné', async () => {
  await revokeConsent('gemini');
  mock.reset();
  await assert.rejects(chat({ config: cfgGemini(), messages: ask }), (e) => e instanceof AIError && e.kind === 'consent' && e.providerId === 'gemini' && /Gemini/.test(e.message));
  await assert.rejects(chat({ config: cfgGemini(), messages: ask, stream: true, onToken() {} }), (e) => e.kind === 'consent');
  assert.equal(mock.requests.length, 0, 'aucune requête ne doit partir');
  // un test de connexion n'envoie aucun cours : il reste possible
  const probe = await chat({ config: cfgGemini(), messages: ask, probe: true });
  assert.ok(probe.text);
  await giveConsent('gemini');
  assert.ok((await chat({ config: cfgGemini(), messages: ask })).text);
});

test('un serveur local ou personnel n’exige aucun consentement', async () => {
  await revokeConsent('ollama');
  assert.equal((await chat({ config: cfgOpenAI(), messages: ask })).text, 'ok');
});
