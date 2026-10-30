import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSrs, schedule, isDue, buildQueue, previewLabels, countDue, LEARNING_STEPS } from '../../src/study/srs.js';
import { quoteScore, isGrounded, findQuoteRange } from '../../src/text/verify.js';
import { parseModelJSON, JSONError } from '../../src/ai/json.js';
import { selectContext, formatContext, parseCitations, searchQueryFor, buildIndex } from '../../src/ai/rag.js';
import { shuffle, formatDuration } from '../../src/util.js';

const MIN = 60000;
const DAY = 86400000;

// ---------------------------------------------------------------- SRS
test('SRS : nouvelle carte « Bien » → étape de 10 min, puis 1 jour', () => {
  const t0 = Date.parse('2026-10-25T08:00:00Z');
  let s = schedule(newSrs(), 2, t0);
  assert.equal(s.state, 'learning');
  assert.equal(s.due - t0, LEARNING_STEPS[1]);
  s = schedule(s, 2, t0 + 10 * MIN);
  assert.equal(s.state, 'review');
  assert.equal(s.interval, 1);
  assert.equal(s.due - (t0 + 10 * MIN), DAY);
});

test('SRS : « Facile » sur une carte neuve → 4 jours', () => {
  const t0 = 1_000_000;
  const s = schedule(newSrs(), 3, t0);
  assert.equal(s.state, 'review');
  assert.equal(s.interval, 4);
  assert.equal(s.due, t0 + 4 * DAY);
});

test('SRS : « Encore » en révision = oubli (lapse), facilité réduite, retour en apprentissage', () => {
  const t0 = 5_000_000;
  const review = { state: 'review', due: t0, interval: 10, ease: 2.5, reps: 5, lapses: 0, step: 0 };
  const s = schedule(review, 0, t0);
  assert.equal(s.lapses, 1);
  assert.equal(s.state, 'learning');
  assert.ok(Math.abs(s.ease - 2.3) < 1e-9);
  assert.equal(s.due - t0, 10 * MIN);
});

test('SRS : les intervalles grandissent avec Bien, plus vite avec Facile', () => {
  const t0 = 0;
  const base = { state: 'review', due: t0, interval: 10, ease: 2.5, reps: 3, lapses: 0, step: 0 };
  const hard = schedule(base, 1, t0).interval;
  const good = schedule(base, 2, t0).interval;
  const easy = schedule(base, 3, t0).interval;
  assert.ok(hard < good && good < easy, `${hard} < ${good} < ${easy}`);
  assert.equal(good, 25);
  assert.ok(hard >= 11, 'toujours au moins +1 jour');
});

test('SRS : la facilité ne descend jamais sous 1,3 et l’intervalle est plafonné', () => {
  let s = { state: 'review', due: 0, interval: 5, ease: 1.35, reps: 1, lapses: 0, step: 0 };
  for (let i = 0; i < 5; i++) s = schedule({ ...s, state: 'review' }, 0, 0);
  assert.ok(s.ease >= 1.3);
  const big = schedule({ state: 'review', due: 0, interval: 300, ease: 3, reps: 9, lapses: 0, step: 0 }, 3, 0);
  assert.ok(big.interval <= 365);
});

test('SRS : schedule est pure (ne modifie pas la carte d’origine)', () => {
  const orig = newSrs();
  const copy = JSON.stringify(orig);
  schedule(orig, 2, 123);
  assert.equal(JSON.stringify(orig), copy);
});

test('SRS : isDue et file du jour', () => {
  const now = new Date('2026-10-25T10:00:00').getTime();
  const mk = (id, srs, createdAt = 0) => ({ id, srs, createdAt });
  const cards = [
    mk('new1', newSrs(), 2),
    mk('new2', newSrs(), 1),
    mk('later', { state: 'review', due: now + 3 * DAY, interval: 3, ease: 2.5, reps: 2, lapses: 0, step: 0 }),
    mk('today', { state: 'review', due: new Date('2026-10-25T18:00:00').getTime(), interval: 3, ease: 2.5, reps: 2, lapses: 0, step: 0 }),
    mk('overdue', { state: 'review', due: now - 5 * DAY, interval: 3, ease: 2.5, reps: 2, lapses: 0, step: 0 }),
    mk('learnNow', { state: 'learning', due: now - MIN, interval: 0, ease: 2.5, reps: 1, lapses: 0, step: 0 }),
    mk('learnSoon', { state: 'learning', due: now + 5 * MIN, interval: 0, ease: 2.5, reps: 1, lapses: 0, step: 0 }),
  ];
  assert.equal(isDue(cards[2].srs, now), false);
  assert.equal(isDue(cards[3].srs, now), true, 'dû plus tard dans la journée = à faire aujourd’hui');
  assert.equal(isDue(cards[6].srs, now), false);
  const q = buildQueue(cards, { now, newLimit: 1 }).map((c) => c.id);
  assert.deepEqual(q, ['learnNow', 'overdue', 'today', 'new2']);
  assert.deepEqual(countDue(cards, now, 15), { due: 3, fresh: 2, total: 7 });
});

test('SRS : étiquettes de prévision', () => {
  const labels = previewLabels(newSrs(), 0);
  assert.equal(labels.length, 4);
  assert.equal(labels[0], '1 min');
  assert.equal(labels[3], '4 j');
});

test('formatDuration', () => {
  assert.equal(formatDuration(30_000), '< 1 min');
  assert.equal(formatDuration(10 * MIN), '10 min');
  assert.equal(formatDuration(2 * 3600_000), '2 h');
  assert.equal(formatDuration(3 * DAY), '3 j');
  assert.equal(formatDuration(60 * DAY), '2 mois');
});

// ---------------------------------------------------------------- Vérification des preuves
const PASSAGE =
  'La phase claire se déroule dans les thylakoïdes. La lumière est captée par la chlorophylle et l’eau est décomposée : c’est la photolyse de l’eau.';

test('quoteScore : citation exacte (accents, casse, ponctuation ignorés)', () => {
  assert.equal(quoteScore('LA PHASE CLAIRE se déroule dans les thylakoides', PASSAGE), 1);
  assert.equal(quoteScore("c'est la photolyse de l'eau", PASSAGE), 1);
});

test('quoteScore : paraphrase partielle vs invention', () => {
  const partial = quoteScore('la lumière est captée par la chlorophylle et le CO2 est fixé', PASSAGE);
  assert.ok(partial > 0.3 && partial < 1, String(partial));
  assert.ok(quoteScore('Napoléon a perdu la bataille de Waterloo en 1815', PASSAGE) < 0.1);
  assert.equal(quoteScore('', PASSAGE), 0);
});

test('isGrounded', () => {
  assert.equal(isGrounded('la photolyse de l’eau', PASSAGE), true);
  assert.equal(isGrounded('les mitochondries produisent de l’ATP par la respiration', PASSAGE), false);
});

test('findQuoteRange retrouve la position pour surligner', () => {
  const r = findQuoteRange('la photolyse de l’eau', PASSAGE);
  assert.ok(r);
  assert.equal(PASSAGE.slice(r[0], r[1]).toLowerCase(), 'la photolyse de l’eau');
  assert.equal(findQuoteRange('rien à voir', PASSAGE), null);
});

// ---------------------------------------------------------------- JSON robuste
test('JSON : propre', () => {
  const r = parseModelJSON('{"a":1,"b":[1,2]}');
  assert.deepEqual(r.value, { a: 1, b: [1, 2] });
  assert.equal(r.repaired, false);
});

test('JSON : clôtures de code, texte autour, balises de réflexion', () => {
  const raw = '<think>je réfléchis { pas du json }</think>\nVoici :\n```json\n{"cartes":[{"recto":"a","verso":"b"}]}\n```\nBonne révision !';
  const r = parseModelJSON(raw, { expect: 'object' });
  assert.deepEqual(r.value, { cartes: [{ recto: 'a', verso: 'b' }] });
});

test('JSON : virgules finales, commentaires, retours à la ligne dans une chaîne', () => {
  const raw = '{"a": "ligne 1\nligne 2", // commentaire\n "b": [1, 2, ], }';
  const r = parseModelJSON(raw);
  assert.equal(r.value.a, 'ligne 1\nligne 2');
  assert.deepEqual(r.value.b, [1, 2]);
  assert.equal(r.repaired, true);
});

test('JSON : sortie tronquée → on garde les éléments complets', () => {
  const raw = '{"questions":[{"q":"Un","r":1},{"q":"Deux","r":2},{"q":"Trois","r":3,"expl":"coupé en plei';
  const r = parseModelJSON(raw);
  assert.equal(r.truncated, true);
  assert.equal(r.value.questions.length >= 2, true);
  assert.deepEqual(r.value.questions.slice(0, 2), [{ q: 'Un', r: 1 }, { q: 'Deux', r: 2 }]);
});

test('JSON : tableau racine et préférence', () => {
  assert.deepEqual(parseModelJSON('Résultat : [1,2,3] fin', { expect: 'array' }).value, [1, 2, 3]);
  assert.deepEqual(parseModelJSON('{"x":[1]}', { expect: 'array' }).value, { x: [1] }); // object only
});

test('JSON : accolades dans les chaînes ne perturbent pas', () => {
  const r = parseModelJSON('{"f":"f(x) = {ax + b} et ] ou }","n":2}');
  assert.equal(r.value.f, 'f(x) = {ax + b} et ] ou }');
  assert.equal(r.value.n, 2);
});

test('JSON : erreur claire si rien d’exploitable', () => {
  assert.throws(() => parseModelJSON('Désolé, je ne peux pas.'), JSONError);
  assert.throws(() => parseModelJSON(''), JSONError);
});

// ---------------------------------------------------------------- RAG
const mkChunks = (n, len = 800) =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    sourceId: i < n / 2 ? 's1' : 's2',
    idx: i,
    label: `p. ${i + 1}`,
    text: (i === 7 ? 'La mitochondrie est la centrale énergétique de la cellule. ' : `Texte générique numéro ${i}. `).padEnd(len, 'x '),
  }));

test('selectContext : tout le cours si ça tient dans le budget', () => {
  const chunks = mkChunks(4, 500);
  const items = selectContext(chunks, { budgetTokens: 6000, query: 'peu importe' });
  assert.equal(items.length, 4);
  assert.deepEqual(items.map((i) => i.n), [1, 2, 3, 4]);
});

test('selectContext : respecte le budget et garde l’ordre de lecture', () => {
  const chunks = mkChunks(40, 800);
  const items = selectContext(chunks, { budgetTokens: 1500, query: 'mitochondrie énergétique cellule' });
  const chars = items.reduce((n, i) => n + i.chunk.text.length, 0);
  assert.ok(chars <= 1500 * 3.6 + 800, `chars=${chars}`);
  assert.ok(items.some((i) => i.chunk.id === 'c7'), 'le passage pertinent est retenu');
  const ids = items.map((i) => Number(i.chunk.id.slice(1)));
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  assert.deepEqual(items.map((i) => i.n), items.map((_, i) => i + 1));
});

test('selectContext : sans requête → couverture régulière du cours', () => {
  const chunks = mkChunks(40, 800);
  const items = selectContext(chunks, { budgetTokens: 2000 });
  const ids = items.map((i) => Number(i.chunk.id.slice(1)));
  assert.ok(ids.length >= 3);
  assert.ok(ids[0] <= 3 && ids.at(-1) >= 36, `couvre début et fin : ${ids}`);
});

test('selectContext : liste vide', () => {
  assert.deepEqual(selectContext([], { query: 'x' }), []);
});

test('formatContext numérote et nomme les sources', () => {
  const items = selectContext(mkChunks(2, 50));
  const txt = formatContext(items, new Map([['s1', 'Mon cours']]));
  assert.match(txt, /^\[1\] « Mon cours » — p\. 1/);
  assert.match(txt, /\[2\] « Source » — p\. 2/);
});

test('parseCitations : normalise et retire les numéros inexistants', () => {
  const r = parseCitations('La lumière est captée [1, 3] puis [2]. Faux [9] et 【3】.', 3);
  assert.equal(r.text, 'La lumière est captée [1][3] puis [2]. Faux et [3].');
  assert.deepEqual(r.cited, [1, 2, 3]);
});

test('parseCitations : ne touche pas aux liens Markdown ni aux autres crochets', () => {
  const r = parseCitations('Voir [la page](https://exemple.org) et [a-b] et [2](x)', 5);
  assert.equal(r.text, 'Voir [la page](https://exemple.org) et [a-b] et [2](x)');
  assert.deepEqual(r.cited, []);
});

test('searchQueryFor complète une question de suivi courte', () => {
  const hist = [{ role: 'user', content: 'Explique la phase claire de la photosynthèse' }, { role: 'assistant', content: '…' }];
  assert.match(searchQueryFor('et la sombre ?', hist), /phase claire.*et la sombre/);
  assert.equal(searchQueryFor('Peux-tu détailler le rôle exact de la chlorophylle ?', hist), 'Peux-tu détailler le rôle exact de la chlorophylle ?');
});

test('buildIndex trouve un extrait', () => {
  const chunks = mkChunks(10, 100);
  assert.equal(buildIndex(chunks).search('mitochondrie')[0].id, 'c7');
});

test('shuffle : même contenu, source intacte, déterministe avec rand injecté', () => {
  const src = [1, 2, 3, 4, 5];
  const out = shuffle(src, () => 0);
  assert.deepEqual(src, [1, 2, 3, 4, 5]);
  assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5]);
  assert.notDeepEqual(out, src);
});
