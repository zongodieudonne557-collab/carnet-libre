import 'fake-indexeddb/auto';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockServer } from '../../scripts/mock-llm.mjs';
import { SAMPLE } from '../../src/sample.js';
import { splitByHeadings } from '../../src/text/chunk.js';
import { createNotebook, addSource, getChunks, listSources, updateSource, wipeAll } from '../../src/db.js';
import { loadSettings, updateSettings, giveConsent } from '../../src/settings.js';
import { PROVIDERS } from '../../src/ai/providers.js';
import { askQuestion, generateCards, generateQuiz, generateCast, generateSlides, generateNote, makeIndex } from '../../src/ai/generate.js';
import { AIError } from '../../src/ai/client.js';

let mock;
let nb;
let sources;
let chunks;

before(async () => {
  mock = await createMockServer();
});
after(async () => {
  await mock.close();
});

beforeEach(async () => {
  mock.reset();
  await wipeAll();
  await loadSettings();
  nb = await createNotebook({ title: 'Test', level: 'lycee' });
  for (const s of SAMPLE.sources) await addSource(nb.id, { title: s.title, kind: s.kind, pages: splitByHeadings(s.text) });
  sources = await listSources(nb.id);
  chunks = await getChunks(nb.id);
});

const useModel = (model, extra = {}) => updateSettings({ ai: { provider: 'custom', baseUrl: mock.openaiBase, model, ...extra } });
const base = () => ({ notebook: nb, chunks, sources, retryDelayMs: 5 });
const posts = () => mock.requests.filter((r) => r.method === 'POST');

test('discussion : réponse citée, citations rattachées aux bons passages', async () => {
  await useModel('mock-small');
  const seen = [];
  const r = await askQuestion({ ...base(), question: 'Dans quelle partie du chloroplaste se déroule la phase claire ?', onToken: (t) => seen.push(t) });
  assert.match(r.text, /thylakoïdes/);
  assert.match(r.text, /\[\d+\]/);
  assert.ok(r.refs.length >= 1);
  for (const ref of r.refs) {
    const chunk = chunks.find((c) => c.id === ref.chunkId);
    assert.ok(chunk, 'le passage cité existe');
    assert.equal(ref.sourceTitle, sources.find((s) => s.id === chunk.sourceId).title);
  }
  const phase = r.refs.map((ref) => chunks.find((c) => c.id === ref.chunkId).text).join('\n');
  assert.match(phase, /phase claire/);
  assert.ok(seen.length > 3 && seen.at(-1) === r.text);
});

test('discussion : un numéro de citation inventé est retiré', async () => {
  await useModel('mock-small');
  const r = await askQuestion({ ...base(), question: 'Explique la phase claire (citation bidon) ?' });
  assert.ok(!/\[99\]/.test(r.text));
  assert.ok(r.refs.every((x) => x.n <= r.usedChunks));
});

test('discussion : hors sujet → le modèle avoue ne pas savoir, aucune citation', async () => {
  await useModel('mock-small');
  const r = await askQuestion({ ...base(), question: 'Qui a gagné la coupe du monde de football en 1998 ?' });
  assert.match(r.text, /Je ne trouve pas la réponse dans tes sources/);
  assert.deepEqual(r.refs, []);
});

test('discussion : question de suivi courte → le contexte reprend la question précédente', async () => {
  await useModel('mock-small');
  const history = [{ role: 'user', content: 'Explique la phase claire de la photosynthèse' }, { role: 'assistant', content: 'La phase claire a lieu dans les thylakoïdes [1].' }];
  await askQuestion({ ...base(), question: 'et la phase sombre ?', history });
  const body = posts().at(-1).body;
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages.at(-3).content, 'Explique la phase claire de la photosynthèse');
  assert.ok(!/\[1\]/.test(body.messages.at(-2).content), 'anciennes citations retirées de l’historique');
});

test('confidentialité : une source désactivée ne part jamais vers l’IA', async () => {
  await useModel('mock-small');
  const maths = sources.find((s) => /Maths/.test(s.title));
  await updateSource(maths.id, { enabled: false });
  chunks = await getChunks(nb.id); // l’appli ne charge que les sources actives
  await askQuestion({ ...base(), question: 'Que dit le cours ?' });
  await generateCards({ ...base(), count: 5 });
  for (const r of posts()) {
    const sent = JSON.stringify(r.body);
    assert.ok(!/coefficient directeur/i.test(sent), 'texte de la source désactivée absent');
    assert.ok(!/fonction affine/i.test(sent));
    assert.ok(/photosynth/i.test(sent), 'la source active est bien envoyée');
    assert.ok(!sent.includes(nb.title) || nb.title.length < 6, 'le titre du carnet n’est pas envoyé');
  }
});

test('budget : la quantité de texte envoyée respecte le réglage', async () => {
  await useModel('mock-small', { budget: 'small' });
  const big = [];
  for (let i = 0; i < 60; i++) big.push({ id: `b${i}`, sourceId: sources[0].id, idx: i, label: `p. ${i}`, text: `Passage numéro ${i} sur la photosynthèse. `.repeat(25) });
  await askQuestion({ ...base(), chunks: big, question: 'photosynthèse passage 7' });
  const sent = posts().at(-1).body.messages.at(-1).content;
  assert.ok(sent.length < 3000 * 3.6 + 1500, `taille envoyée : ${sent.length}`);
  assert.ok(sent.length > 1000);
});

test('cartes : valides, ancrées, prêtes pour la répétition espacée', async () => {
  await useModel('mock-small');
  const { cards, dropped, truncated } = await generateCards({ ...base(), count: 8 });
  assert.ok(cards.length >= 6, `cartes : ${cards.length}`);
  assert.equal(truncated, false);
  assert.equal(dropped, 0);
  for (const c of cards) {
    assert.equal(c.verified, true, c.front);
    assert.equal(c.srs.state, 'new');
    assert.equal(c.origin, 'ai');
    assert.ok(chunks.some((x) => x.id === c.chunkId));
    assert.ok(c.sourceTitle);
  }
  const body = posts().at(-1).body;
  assert.equal(body.response_format.type, 'json_object');
});

test('cartes : une « preuve » inventée est signalée', async () => {
  await useModel('mock-ungrounded');
  const { cards } = await generateCards({ ...base(), count: 5 });
  assert.equal(cards[0].verified, false);
  assert.ok(cards.slice(1).every((c) => c.verified === true));
});

test('JSON abîmé (clôtures, virgules en trop, texte autour) → réparé', async () => {
  await useModel('mock-bad-json');
  const { cards } = await generateCards({ ...base(), count: 5 });
  assert.ok(cards.length >= 4);
  assert.equal(posts().length, 1, 'aucune nouvelle demande inutile');
});

test('réponse inutilisable → une deuxième demande avec consigne de correction', async () => {
  await useModel('mock-garbage-once');
  const { cards } = await generateCards({ ...base(), count: 5 });
  assert.ok(cards.length >= 4);
  assert.equal(posts().length, 2);
  assert.match(posts()[1].body.messages.at(-1).content, /n’était pas exploitable/);
});

test('sortie coupée par la limite de longueur → on garde les éléments complets', async () => {
  await useModel('mock-truncated');
  const { cards, truncated } = await generateCards({ ...base(), count: 10 });
  assert.equal(truncated, true);
  assert.ok(cards.length >= 1 && cards.length < 10);
  assert.ok(cards.every((c) => c.front && c.back));
});

test('quiz : questions à choix mélangés, bonne réponse cohérente avec l’explication', async () => {
  await useModel('mock-small');
  const { quiz } = await generateQuiz({ ...base(), count: 6, focus: 'photosynthèse' });
  assert.ok(quiz.questions.length >= 5);
  assert.match(quiz.title, /photosynthèse/);
  for (const q of quiz.questions) {
    assert.equal(q.choices.length, 4);
    assert.ok(q.answer >= 0 && q.answer < 4);
    assert.ok(!/contraire|aucun rapport|ne dit rien/.test(q.choices[q.answer]), 'la bonne réponse n’est pas un distracteur');
    assert.equal(q.verified, true);
  }
  const positions = new Set(quiz.questions.map((q) => q.answer));
  assert.ok(positions.size >= 2, 'la bonne réponse n’est pas toujours à la même place');
});

test('causerie et diapositives', async () => {
  await useModel('mock-small');
  const { cast } = await generateCast({ ...base(), length: 'court' });
  assert.ok(cast.turns.length >= 8);
  assert.ok(cast.turns.every((t, i) => i === 0 || t.who !== cast.turns[i - 1].who), 'alternance des voix');
  assert.match(posts().at(-1).body.messages[0].content, /10 répliques/);
  const { deck } = await generateSlides({ ...base(), count: 5 });
  assert.ok(deck.slides.length >= 2);
  assert.ok(deck.slides.every((s) => s.title && s.narration.length > 20));
  assert.ok(deck.slides.some((s) => s.formula));
});

test('documents : résumé, fiche, FAQ, plan avec citations rattachées', async () => {
  await useModel('mock-small');
  for (const [kind, heading] of [['resume', /Résumé/], ['fiche', /Définitions/], ['faq', /###/], ['plan', /## 1\./]]) {
    const { note } = await generateNote({ ...base(), kind });
    assert.equal(note.kind, kind);
    assert.match(note.markdown, heading, kind);
    assert.ok(note.refs.length >= 1, kind);
    assert.ok(note.refs.every((r) => chunks.some((c) => c.id === r.chunkId)));
  }
  const { note } = await generateNote({ ...base(), kind: 'fiche' });
  assert.match(note.markdown, /\$\$a = \\frac\{y_2 - y_1\}\{x_2 - x_1\}\$\$/, 'la formule LaTeX est conservée');
});

test('Gemini (API native) : mêmes résultats par un autre protocole', async () => {
  await giveConsent('gemini'); // sans accord, rien ne peut partir vers un service en ligne
  const config = { provider: { ...PROVIDERS.gemini, short: 'Gemini' }, baseUrl: mock.geminiBase, key: 'k', model: 'gemini-mock-flash', temperature: 0.3 };
  const { cards } = await generateCards({ ...base(), count: 5, config });
  assert.ok(cards.length >= 4 && cards.every((c) => c.verified));
  const r = await askQuestion({ ...base(), config, question: 'Où a lieu la photosynthèse ? chloroplastes' });
  assert.match(r.text, /\[\d+\]/);
});

test('aucune source → erreur claire, aucun appel réseau', async () => {
  await useModel('mock-small');
  mock.reset();
  await assert.rejects(generateCards({ ...base(), chunks: [], count: 5 }), (e) => e instanceof AIError && e.kind === 'config' && /source/.test(e.message));
  await assert.rejects(askQuestion({ ...base(), chunks: [], question: 'x' }), (e) => e.kind === 'config');
  assert.equal(mock.requests.length, 0);
});

test('l’index de recherche peut être réutilisé', async () => {
  await useModel('mock-small');
  const index = makeIndex(chunks);
  const r = await askQuestion({ ...base(), index, question: 'Quel est le coefficient directeur ?' });
  assert.match(r.text, /\[\d+\]/);
});
