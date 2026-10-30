import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE } from '../../src/sample.js';
import { splitByHeadings, chunkPages } from '../../src/text/chunk.js';
import { autoCards, suggestQuestions, keyTerms, matchDefinitions, stripMarkdown } from '../../src/study/heuristics.js';
import { isGrounded } from '../../src/text/verify.js';

function sampleChunks() {
  const out = [];
  SAMPLE.sources.forEach((s, si) => {
    for (const c of chunkPages(splitByHeadings(s.text))) out.push({ ...c, id: `s${si}c${c.idx}`, sourceId: `s${si}` });
  });
  return out;
}

test('splitByHeadings : un titre sans texte est rattaché à la section suivante', () => {
  const pages = splitByHeadings('# Titre du cours\n## Partie A\nContenu A\n\n## Partie B\nContenu B');
  assert.equal(pages.length, 2);
  assert.equal(pages[0].label, '§ Partie A');
  assert.match(pages[0].text, /^# Titre du cours\n## Partie A\nContenu A/);
  assert.ok(pages.every((p) => p.text.replace(/#+ .*/g, '').trim().length > 0), 'aucun extrait sans contenu');
});

test('splitByHeadings : texte avant le premier titre et document sans titre', () => {
  assert.equal(splitByHeadings('Juste du texte.').length, 1);
  assert.equal(splitByHeadings('Juste du texte.')[0].label, null);
  const p = splitByHeadings('Intro libre\n\n# A\nTexte');
  assert.equal(p.length, 2);
  assert.equal(p[0].label, null);
  assert.deepEqual(splitByHeadings(''), []);
  assert.equal(splitByHeadings('# Seul titre').length, 1);
});

test('le cours d’exemple n’a aucun extrait minuscule', () => {
  const chunks = sampleChunks();
  assert.ok(chunks.length >= 10);
  assert.ok(chunks.every((c) => c.text.length >= 100), chunks.map((c) => c.text.length).join(','));
});

test('stripMarkdown', () => {
  assert.equal(stripMarkdown('- **Gras** et `code` et [lien](https://a.org)'), 'Gras et code et lien');
});

test('définitions : « est appelé » à deux propositions → deux cartes distinctes', () => {
  const defs = matchDefinitions(
    "Le nombre a est appelé coefficient directeur (ou pente) et le nombre b est appelé ordonnée à l'origine."
  );
  assert.deepEqual(
    defs.map((d) => [d.front, d.back]),
    [
      ['Comment appelle-t-on le nombre a ?', 'Coefficient directeur (ou pente)'],
      ['Comment appelle-t-on le nombre b ?', "Ordonnée à l'origine"],
    ]
  );
});

test('définitions : « X est un Y », pluriel, élision', () => {
  assert.equal(matchDefinitions("L'amidon est la forme de réserve du glucose chez les végétaux.")[0].front, "Qu'est-ce que l'amidon ?");
  assert.equal(matchDefinitions('Une dérivée est un nombre qui mesure la variation instantanée.')[0].front, "Qu'est-ce qu'une dérivée ?");
  assert.equal(matchDefinitions('Les mammifères sont des animaux qui allaitent leurs petits.')[0].front, 'Que sont les mammifères ?');
});

test('définitions : pas de fausse définition (pronoms, formules, phrases courtes)', () => {
  assert.deepEqual(matchDefinitions('Elle est une très bonne élève de la classe.'), []);
  assert.deepEqual(matchDefinitions('f(x) = 2x + 1 est une fonction affine définie partout.'), []);
  assert.deepEqual(matchDefinitions('C’est un test.'), []);
});

test('cartes automatiques : définitions attendues, rien d’absurde', () => {
  const cards = autoCards(sampleChunks(), { max: 30 });
  const fronts = cards.map((c) => c.front);
  assert.ok(fronts.includes("Qu'est-ce que la photosynthèse ?"));
  assert.ok(fronts.includes("Qu'est-ce qu'une fonction affine ?"));
  assert.ok(fronts.includes('Comment appelle-t-on le nombre a ?'));
  assert.ok(!fronts.some((f) => /est appelé/.test(f)), 'plus de carte mal découpée');
  assert.equal(new Set(fronts).size, fronts.length, 'pas de doublon');
});

test('cartes automatiques : chaque carte est ancrée dans son extrait', () => {
  const chunks = sampleChunks();
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const cards = autoCards(chunks, { max: 30 });
  assert.ok(cards.length >= 10);
  for (const c of cards) {
    assert.ok(byId.has(c.chunkId), 'extrait connu');
    assert.ok(isGrounded(c.quote, byId.get(c.chunkId).text, 0.9), `preuve introuvable : ${c.quote}`);
  }
});

test('cartes à trous : le trou est un terme du cours, jamais une formule ni une phrase sans contexte', () => {
  const cards = autoCards(sampleChunks(), { max: 40 }).filter((c) => c.kind === 'cloze');
  assert.ok(cards.length >= 5);
  for (const c of cards) {
    assert.match(c.front, /_____/);
    assert.ok(!/→/.test(c.front), `formule : ${c.front}`);
    assert.ok(!/^Complète : (Elle|Il|Ce|Cette|On)\b/.test(c.front), `phrase sans contexte : ${c.front}`);
    const answer = c.back.split('\n')[0];
    assert.ok(answer.length >= 5);
    assert.ok(c.back.includes(answer));
  }
  assert.ok(cards.some((c) => c.back.startsWith('chloroplastes')));
});

test('cartes automatiques : respectent la limite', () => {
  assert.equal(autoCards(sampleChunks(), { max: 7 }).length, 7);
  assert.deepEqual(autoCards([], { max: 5 }), []);
});

test('mots-clés : termes du cours, pas du bruit', () => {
  const terms = keyTerms(sampleChunks(), 10).map((t) => t.term);
  assert.ok(terms.includes('photosynthèse'));
  assert.ok(terms.includes('fonction'));
  for (const bad of ['utilisant', 'strictement', 'exemple', 'définition']) assert.ok(!terms.includes(bad), bad);
});

test('questions suggérées : utiles, sans titres génériques ni doublons', () => {
  const qs = suggestQuestions(sampleChunks(), 6);
  assert.ok(qs.length >= 4);
  assert.ok(!qs.some((q) => /« Définition »/.test(q)));
  assert.ok(qs.includes('Où a lieu la photosynthèse ?'), 'un titre en forme de question est repris tel quel');
  assert.equal(new Set(qs.map((q) => q.toLowerCase())).size, qs.length);
  assert.ok(qs.some((q) => /résumé/i.test(q)));
});
