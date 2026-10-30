import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldAccents, cleanText, words, truncateNicely } from '../../src/text/normalize.js';
import { stem } from '../../src/text/stem.js';
import { BM25, terms } from '../../src/text/bm25.js';
import { chunkPages, splitByHeadings } from '../../src/text/chunk.js';

test('foldAccents retire accents et ligatures', () => {
  assert.equal(foldAccents('Électricité, cœur, être'), 'Electricite, coeur, etre');
});

test('cleanText { keepIndent } garde l’imbrication des listes mais nettoie le reste', () => {
  const raw = '\n\n# Titre  \n\n- un   point \n  - sous-point\n    - sous-sous\ntexte    normal \n   décalé\n\n\n\n- fin  \n';
  assert.equal(cleanText(raw, { keepIndent: true }), '# Titre\n\n- un point\n  - sous-point\n    - sous-sous\ntexte normal\ndécalé\n\n- fin');
  // sans l'option, comportement inchangé : tout est aplati
  assert.equal(cleanText('- a\n  - b'), '- a\n- b');
});

test('cleanText recolle les mots coupés et nettoie les espaces', () => {
  const raw = 'La mathé-\nmatique  est belle.\r\n\r\n\r\n\r\nFin';
  assert.equal(cleanText(raw), 'La mathématique est belle.\n\nFin');
});

test('words découpe sans accents ni ponctuation', () => {
  assert.deepEqual(words("L'élève a 3 cahiers !"), ['l', 'eleve', 'a', '3', 'cahiers']);
});

test('stem rapproche les formes liées', () => {
  const same = (a, b) => assert.equal(stem(a), stem(b), `${a} / ${b}`);
  same('derivee', 'derivees');
  same('fonction', 'fonctions');
  same('animal', 'animaux');
  same('chloroplaste', 'chloroplastes');
  same('photosynthese', 'photosyntheses');
  // ne détruit pas les mots courts ni les nombres
  assert.equal(stem('eau'), 'eau');
  assert.equal(stem('2024'), '2024');
});

test('terms ignore les mots vides', () => {
  const t = terms('Quelle est la dérivée de la fonction ?');
  assert.ok(!t.includes('est'));
  assert.ok(t.length >= 2);
});

const DOCS = [
  { id: 'a', text: 'La photosynthèse se déroule dans les chloroplastes. La chlorophylle capte la lumière.' },
  { id: 'b', text: 'Une fonction affine s’écrit f(x) = ax + b. Le coefficient directeur est a.' },
  { id: 'c', text: 'Le cycle de Calvin fixe le dioxyde de carbone dans le stroma du chloroplaste.' },
  { id: 'd', text: 'Les fonctions affines sont représentées par des droites.' },
];

test('BM25 retrouve le bon passage (accents, pluriels)', () => {
  const idx = new BM25(DOCS);
  assert.equal(idx.search('Où a lieu la photosynthese ?')[0].id, 'a');
  assert.equal(idx.search('coefficient directeur')[0].id, 'b');
  const r = idx.search('fonctions affines', { limit: 2 }).map((x) => x.id);
  assert.deepEqual(new Set(r), new Set(['b', 'd']));
  assert.equal(idx.search('chloroplaste').length, 2);
});

test('BM25 : requête vide ou inconnue', () => {
  const idx = new BM25(DOCS);
  assert.deepEqual(idx.search(''), []);
  assert.deepEqual(idx.search('zzzzqqq'), []);
  assert.deepEqual(new BM25([]).search('photosynthèse'), []);
});

test('BM25 : filtre allow', () => {
  const idx = new BM25(DOCS);
  const res = idx.search('chloroplaste', { allow: (id) => id !== 'a' });
  assert.deepEqual(res.map((r) => r.id), ['c']);
});

test('chunkPages respecte la taille et garde les étiquettes', () => {
  const para = 'Phrase numéro un. Phrase numéro deux est un peu plus longue. '.repeat(30);
  const pages = [
    { label: 'p. 1', text: para + '\n\n' + para },
    { label: 'p. 2', text: 'Court.' },
  ];
  const chunks = chunkPages(pages, { target: 900, max: 1400 });
  assert.ok(chunks.length >= 4);
  for (const c of chunks) assert.ok(c.text.length <= 1400, `trop long: ${c.text.length}`);
  assert.equal(chunks.at(-1).label, 'p. 2');
  assert.deepEqual(chunks.map((c) => c.idx), chunks.map((_, i) => i));
});

test('chunkPages ne perd aucun texte', () => {
  const text = Array.from({ length: 40 }, (_, i) => `Paragraphe ${i} avec un contenu suffisant pour compter.`).join('\n\n');
  const chunks = chunkPages([{ label: null, text }]);
  const joined = chunks.map((c) => c.text).join('\n\n');
  for (let i = 0; i < 40; i++) assert.ok(joined.includes(`Paragraphe ${i} `), `manque ${i}`);
});

test('chunkPages coupe un très long bloc sans espace', () => {
  const chunks = chunkPages([{ label: null, text: 'x'.repeat(5000) }], { max: 1400 });
  assert.ok(chunks.length >= 4);
  assert.ok(chunks.every((c) => c.text.length <= 1400));
});

test('splitByHeadings crée des sections étiquetées', () => {
  const md = '# Intro\nBonjour\n\n## Partie 1\nTexte un\n\n## Partie 2\nTexte deux';
  const pages = splitByHeadings(md);
  assert.equal(pages.length, 3);
  assert.equal(pages[1].label, '§ Partie 1');
});

test('truncateNicely coupe sur une phrase', () => {
  const t = 'Première phrase complète. Deuxième phrase qui continue encore et encore longtemps.';
  assert.equal(truncateNicely(t, 40), 'Première phrase complète. […]');
  assert.equal(truncateNicely('court', 40), 'court');
});
