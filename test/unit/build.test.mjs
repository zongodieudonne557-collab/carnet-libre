import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoNote,
  cardCounts,
  cardsToAnki,
  cardsToCSV,
  castToText,
  deckFromHeadings,
  freshCards,
  matchesFilter,
  mistakesToCards,
  noteToFile,
  normKey,
  quizFromCards,
  quizHistory,
  slideTitle,
  toStoredCard,
} from '../../src/study/build.js';
import { createSession } from '../../src/study/session.js';
import { newSrs, schedule } from '../../src/study/srs.js';
import { SAMPLE } from '../../src/sample.js';
import { splitByHeadings, chunkPages } from '../../src/text/chunk.js';

const MIN = 60000;
const DAY = 86400000;

// ---------------------------------------------------------------- aides
function sampleChunks() {
  const sources = [];
  const chunks = [];
  SAMPLE.sources.forEach((s, si) => {
    const id = `s${si}`;
    sources.push({ id, title: s.title, enabled: true });
    chunkPages(splitByHeadings(s.text)).forEach((c) => chunks.push({ id: `${id}:${c.idx}`, sourceId: id, idx: c.idx, label: c.label, text: c.text }));
  });
  return { sources, chunks };
}

const card = (front, back, extra = {}) => ({ id: `c-${front}`, front, back, origin: 'own', srs: newSrs(), ...extra });

// ---------------------------------------------------------------- cartes
test('normKey ignore accents, casse et ponctuation', () => {
  assert.equal(normKey('  Qu’est-ce que la CHLOROPHYLLE ? '), normKey('qu est ce que la chlorophylle'));
  assert.equal(normKey(null), '');
});

test('freshCards retire les doublons avec l’existant et entre elles', () => {
  const existing = [card('Qu’est-ce qu’un stomate ?', 'x')];
  const out = freshCards([{ front: 'Qu’est-ce qu’un STOMATE' }, { front: 'Autre ?' }, { front: 'autre' }, { front: '' }], existing);
  assert.deepEqual(out.map((c) => c.front), ['Autre ?']);
});

test('toStoredCard rattache la carte à son extrait et à sa source', () => {
  const chunkById = new Map([['c1', { id: 'c1', sourceId: 's1', label: '§ Titre' }]]);
  const titleById = new Map([['s1', 'Mon cours']]);
  const c = toStoredCard({ front: 'Q', back: 'R', quote: 'q', kind: 'def', chunkId: 'c1' }, { chunkById, titleById });
  assert.equal(c.sourceId, 's1');
  assert.equal(c.sourceTitle, 'Mon cours');
  assert.equal(c.label, '§ Titre');
  assert.equal(c.origin, 'auto');
  assert.equal(c.verified, true);
  assert.equal(c.srs.state, 'new');
  const own = toStoredCard({ front: 'Q', back: 'R' }, { origin: 'own' });
  assert.equal(own.verified, null);
  assert.equal(own.chunkId, null);
});

test('filtres de cartes', () => {
  const now = Date.parse('2026-10-25T10:00:00Z');
  const due = card('a', 'b', { srs: { ...schedule(newSrs(), 3, now - 5 * DAY), } });
  const later = card('c', 'd', { srs: schedule(schedule(newSrs(), 3, now), 2, now) });
  const fresh = card('e', 'f');
  const check = card('g', 'h', { verified: false, origin: 'ai' });
  assert.ok(matchesFilter(due, 'due', now));
  assert.ok(!matchesFilter(later, 'due', now));
  assert.ok(matchesFilter(fresh, 'new', now));
  assert.ok(!matchesFilter(due, 'new', now));
  assert.ok(matchesFilter(check, 'check', now));
  assert.ok(matchesFilter(check, 'ai', now));
  assert.ok(matchesFilter(fresh, 'own', now));
  assert.ok(matchesFilter(card('q', 'r', { origin: 'quiz' }), 'own', now));
  assert.ok(matchesFilter(fresh, 'all', now));
  assert.ok(!matchesFilter(fresh, 'auto', now));
});

test('cardCounts : à revoir, nouvelles du jour, apprises, à vérifier', () => {
  const now = Date.parse('2026-10-25T10:00:00Z');
  const cards = [
    ...Array.from({ length: 20 }, (_, i) => card(`n${i}`, 'x')),
    card('d', 'x', { srs: { state: 'review', due: now - DAY, interval: 3, ease: 2.5, reps: 2, lapses: 0, step: 0 } }),
    card('l', 'x', { srs: { state: 'review', due: now + 30 * DAY, interval: 30, ease: 2.5, reps: 6, lapses: 0, step: 0 }, verified: false }),
  ];
  const c = cardCounts(cards, now);
  assert.equal(c.total, 22);
  assert.equal(c.fresh, 20);
  assert.equal(c.todayNew, 15);
  assert.equal(c.due, 1);
  assert.equal(c.learned, 1);
  assert.equal(c.toCheck, 1);
});

test('export Anki : tabulations, HTML échappé, sauts de ligne en <br>, étiquettes', () => {
  const out = cardsToAnki([card('2 < 3 & 4 ?', 'Oui\nvoilà\tici', { origin: 'ai', verified: false })]);
  const lines = out.trim().split('\n');
  assert.equal(lines[0], '#separator:tab');
  assert.equal(lines[1], '#html:true');
  assert.equal(lines[2], '#tags column:3');
  const f = lines[3].split('\t');
  assert.equal(f.length, 3);
  assert.equal(f[0], '2 &lt; 3 &amp; 4 ?');
  assert.equal(f[1], 'Oui<br>voilà ici');
  assert.equal(f[2], 'carnet-libre ia a-verifier');
});

test('export CSV : BOM, guillemets doublés, formule neutralisée', () => {
  const out = cardsToCSV([card('=SOMME(A1)', 'Il dit "oui"\nligne 2', { sourceTitle: 'Cours' })]);
  assert.ok(out.startsWith('﻿"Recto";"Verso"'));
  const row = out.split('\r\n')[1];
  assert.ok(row.startsWith(`"'=SOMME(A1)";"Il dit ""oui"" ⏎ ligne 2";"Cours";"perso";""`));
});

// ---------------------------------------------------------------- quiz depuis les cartes
const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

test('quizFromCards : une bonne réponse, trois mauvaises, toutes différentes', () => {
  const cards = ['mitochondrie', 'chloroplaste', 'noyau', 'ribosome', 'vacuole', 'membrane'].map((w, i) => card(`Que fait la ${w} ?`, `Réponse numéro ${i} à propos de ${w}`));
  const quiz = quizFromCards(cards, { count: 4, rand: seeded() });
  assert.equal(quiz.questions.length, 4);
  assert.equal(quiz.origin, 'cards');
  for (const q of quiz.questions) {
    assert.equal(q.choices.length, 4);
    assert.equal(new Set(q.choices.map(normKey)).size, 4);
    const src = cards.find((c) => c.front === q.question);
    assert.equal(q.choices[q.answer], src.back);
  }
});

test('quizFromCards : refuse quand il y a moins de 4 réponses distinctes', () => {
  assert.equal(quizFromCards([card('a ?', 'x'), card('b ?', 'x'), card('c ?', 'x'), card('d ?', 'y')]), null);
  assert.equal(quizFromCards([card('a ?', 'x'), card('b ?', 'y')]), null);
});

test('quizFromCards : un texte à trous a pour réponse le mot masqué (1re ligne du verso)', () => {
  const words = ['chlorophylle', 'stomates', 'glucose', 'amidon', 'thylakoïdes'];
  const cards = words.map((w) => card(`Complète : La plante contient de la _____ (${w.length})`, `${w}\n\nLa plante contient de la ${w}.`, { kind: 'cloze' }));
  const quiz = quizFromCards(cards, { count: 3, rand: seeded(3) });
  assert.equal(quiz.questions.length, 3);
  for (const q of quiz.questions) {
    assert.ok(words.includes(q.choices[q.answer]));
    assert.ok(q.choices.every((c) => words.includes(c)));
    assert.match(q.explanation, /La plante contient de la/);
  }
});

test('mistakesToCards et quizHistory', () => {
  const quiz = {
    questions: [
      { question: 'Q1 ?', choices: ['a', 'b'], answer: 1, explanation: 'Parce que.', quote: 'p', verified: true, chunkId: 'c', sourceId: 's' },
      { question: 'Q2 ?', choices: ['a', 'b'], answer: 0, explanation: '' },
    ],
    attempts: [
      { at: 1, score: 1, total: 2 },
      { at: 2, score: 2, total: 2 },
      { at: 3, score: 0, total: 2 },
    ],
  };
  const cards = mistakesToCards(quiz, [0, 1, 7]);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].back, 'b\n\nParce que.');
  assert.equal(cards[1].back, 'a');
  assert.equal(cards[0].origin, 'quiz');
  assert.equal(cards[0].srs.state, 'new');
  assert.deepEqual(quizHistory(quiz), { tries: 3, best: 100, last: 0 });
  assert.deepEqual(quizHistory({ attempts: [] }), { tries: 0, best: null, last: null });
});

// ---------------------------------------------------------------- fiche et diapos sans IA
test('autoNote : mots-clés, définitions citées, plan', () => {
  const { sources, chunks } = sampleChunks();
  const note = autoNote(chunks, sources);
  assert.equal(note.kind, 'auto');
  assert.match(note.markdown, /## Mots-clés/);
  assert.match(note.markdown, /## Définitions repérées/);
  assert.match(note.markdown, /## Plan de tes sources/);
  assert.match(note.markdown, /### SVT — La photosynthèse/);
  // chaque citation [n] a sa référence, vers un extrait qui existe
  const cited = [...note.markdown.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  assert.ok(cited.length > 0);
  for (const n of cited) {
    const ref = note.refs.find((r) => r.n === n);
    assert.ok(ref, `référence ${n}`);
    assert.ok(chunks.some((c) => c.id === ref.chunkId));
  }
});

test('autoNote : rien à tirer d’un texte sans structure', () => {
  const chunks = [{ id: 'a:0', sourceId: 'a', idx: 0, label: null, text: 'ok' }];
  assert.equal(autoNote(chunks, [{ id: 'a', title: 'A' }]), null);
});

test('slideTitle', () => {
  assert.equal(slideTitle('§ Les stomates'), 'Les stomates');
  assert.equal(slideTitle('p. 12'), 'Page 12');
  assert.equal(slideTitle(''), 'Diapositive');
});

test('deckFromHeadings : une diapo par titre, avec ses premières phrases et son extrait', () => {
  const { sources, chunks } = sampleChunks();
  const deck = deckFromHeadings(chunks, sources, { max: 8 });
  assert.ok(deck.slides.length >= 2 && deck.slides.length <= 8);
  assert.equal(deck.origin, 'headings');
  for (const s of deck.slides) {
    assert.ok(s.title);
    assert.ok(s.bullets.length >= 1 && s.bullets.length <= 4);
    assert.ok(s.bullets.every((b) => b.length <= 151));
    assert.ok(s.narration.length > 10 && s.narration.length <= 901);
    assert.ok(chunks.some((c) => c.id === s.chunkId));
  }
});

test('deckFromHeadings : null sans titres, et répartition quand il y en a trop', () => {
  assert.equal(deckFromHeadings([{ id: 'a', sourceId: 's', label: null, text: 'Une phrase assez longue pour compter.' }], [{ id: 's', title: 'S' }]), null);
  const chunks = Array.from({ length: 30 }, (_, i) => ({ id: `s:${i}`, sourceId: 's', idx: i, label: `§ Partie ${i}`, text: `La partie numéro ${i} explique une idée importante du cours.` }));
  const deck = deckFromHeadings(chunks, [{ id: 's', title: 'Cours' }], { max: 10 });
  assert.equal(deck.slides.length, 10);
  assert.equal(deck.slides[0].title, 'Partie 0');
  assert.equal(deck.title, 'Diaporama : Cours');
});

test('noteToFile et castToText', () => {
  const f = noteToFile({ title: 'Résumé', markdown: 'Texte [1]', refs: [{ n: 1, sourceTitle: 'Cours', label: '§ Intro' }] });
  assert.match(f, /^# Résumé\n\nTexte \[1\]/);
  assert.match(f, /- \[1\] Cours — Intro/);
  assert.equal(noteToFile({ title: 'T', markdown: 'x', refs: [] }), '# T\n\nx\n');
  const t = castToText({ title: 'Causerie', turns: [{ who: 'A', text: 'Salut' }, { who: 'B', text: 'Bonjour' }] });
  assert.equal(t, 'Causerie\n\nAwa : Salut\n\nIssa : Bonjour\n');
});

// ---------------------------------------------------------------- séance
test('séance : file du jour, notes, carte ratée qui revient, annulation', () => {
  let t = Date.parse('2026-10-25T08:00:00Z');
  const now = () => t;
  const cards = ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => card(x, x.toUpperCase()));
  const s = createSession(cards, { now });
  assert.equal(s.total, 6);
  assert.equal(s.current.front, 'a');

  const a1 = s.answer(0); // « Encore » : revient après quelques cartes
  assert.equal(a1.srs.state, 'learning');
  assert.equal(s.remaining, 6); // 5 restantes + la ratée
  assert.equal(s.answered, 1);
  assert.equal(s.current.front, 'b');
  assert.equal(s.stats[0], 1);

  s.answer(3); // b facile
  s.answer(2); // c bien (étape 10 min : revient en fin de séance)
  assert.equal(s.remaining, 5); // d, e, f, a (la ratée) et c (étape de 10 min, remise en fin de file)
  assert.ok(s.cards.length === 3);

  // annuler la dernière note : c redevient neuve et repasse devant
  const restored = s.undo();
  assert.equal(restored.srs.state, 'new');
  assert.equal(s.current.front, 'c');
  assert.equal(s.stats[2], 0);
  assert.equal(s.cards.length, 2);

  // tout terminer en notant « Facile »
  let guard = 0;
  while (!s.done && guard++ < 50) s.answer(3);
  assert.ok(s.done);
  assert.equal(s.current, null);
  assert.equal(s.answer(2), null);
  assert.ok(s.nextDue() > t);
  assert.ok(s.canUndo);
});

test('séance : « Encore » 3 fois de suite ne bloque pas et la dernière carte revient', () => {
  const t = 1_000_000;
  const s = createSession([card('seule', 'x')], { now: () => t });
  for (let i = 0; i < 3; i++) {
    assert.equal(s.current.front, 'seule');
    s.answer(0);
    assert.equal(s.remaining, 1);
  }
  s.answer(3);
  assert.ok(s.done);
});

test('séance : respecte la limite de nouvelles cartes et ne remet pas les cartes pas encore dues', () => {
  const t = Date.parse('2026-10-25T08:00:00Z');
  const future = card('futur', 'x', { srs: { state: 'review', due: t + 3 * DAY, interval: 3, ease: 2.5, reps: 2, lapses: 0, step: 0 } });
  const cards = [future, ...Array.from({ length: 30 }, (_, i) => card(`n${i}`, 'x'))];
  const s = createSession(cards, { now: () => t, newLimit: 5 });
  assert.equal(s.total, 5);
  assert.ok(!s.cards.some((c) => c.front === 'futur'));
  s.answer(2);
  // une carte « Bien » en apprentissage à 10 min revient dans la séance
  assert.equal(s.remaining, 5);
  assert.ok(MIN > 0);
});
