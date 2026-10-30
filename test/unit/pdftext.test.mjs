import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLines, reconstruct, stripRepeated, textQuality, toSections } from '../../src/import/pdftext.js';

// Fabrique un fragment : largeur ≈ 0,5 × corps × nombre de caractères (comme une police ordinaire).
const T = (str, x, y, size = 10, w = str.length * size * 0.5) => ({ str, x, y, size, w });

/** Page de texte courant : chaque ligne commence à x = 50, interligne 14. */
function para(lines, y0, { x = 50, size = 10, lead = 14 } = {}) {
  return lines.map((s, i) => T(s, x, y0 + i * lead, size, 400));
}

test('lignes : fragments d’un même mot recollés, mots séparés par une espace', () => {
  const l = buildLines([T('fonc', 50, 100), T('tion', 70, 100), T('affine', 95, 100)]);
  assert.equal(l.length, 1);
  assert.equal(l[0].text, 'fonction affine');
});

test('lignes : espace explicite et ligatures', () => {
  const l = buildLines([T('Le ', 50, 100), T('ﬁnal', 65, 100, 10, 20), T(' ', 85, 100, 10, 2.5), T('ﬂux', 88, 100, 10, 15)]);
  assert.equal(l[0].text, 'Le final flux');
});

test('lignes : exposants et indices convertis en Unicode', () => {
  const sup = buildLines([T('Aire = π r', 50, 100, 10, 50), T('2', 100, 96.5, 6.5, 3.3)]);
  assert.equal(sup[0].text, 'Aire = π r²');
  const sub = buildLines([T('H', 50, 100, 10, 5), T('2', 55, 102, 6.5, 3.3), T('O', 58.5, 100, 10, 5)]);
  assert.equal(sub[0].text, 'H₂O');
  const sup2 = buildLines([T('x', 50, 100, 10, 5), T('2k+1', 55, 96.5, 6.5, 13)]);
  assert.equal(sup2[0].text, 'x^(2k+1)');
});

test('lignes : grand vide = colonnes de tableau séparées par « | »', () => {
  const l = buildLines([T('Organite', 50, 100, 10, 40), T('Rôle', 200, 100, 10, 20), T('Mitochondrie', 50, 114, 10, 60), T('Énergie', 200, 114, 10, 35)]);
  assert.deepEqual(
    l.map((x) => x.text),
    ['Organite | Rôle', 'Mitochondrie | Énergie']
  );
});

test('lignes : deux colonnes en ordre de flux ne sont jamais mélangées', () => {
  // colonne gauche entière, puis colonne droite : mêmes y
  const col = (x, words) => words.map((w, i) => T(w, x, 100 + i * 14, 10, 150));
  const l = buildLines([...col(50, ['Gauche 1', 'Gauche 2', 'Gauche 3']), ...col(320, ['Droite 1', 'Droite 2', 'Droite 3'])]);
  assert.deepEqual(
    l.map((x) => x.text),
    ['Gauche 1', 'Gauche 2', 'Gauche 3', 'Droite 1', 'Droite 2', 'Droite 3']
  );
});

test('lignes : texte vertical et valeurs absurdes ignorés, largeur inconnue estimée', () => {
  const l = buildLines([{ ...T('Axe', 10, 300), dx: 0, dy: -1 }, T('Texte', NaN, 10), T('mot', 50, 100, 10, 0), T('suivant', 60, 100, 10, 0)]);
  assert.equal(l.length, 1);
  assert.match(l[0].text, /^mot ?suivant$|^mot suivant$/);
});

test('orientation : page dessinée à la verticale redressée dans les deux sens, texte mixte conservé tel quel', () => {
  const W = 600;
  const H = 800;
  // texte qui descend (page tournée dans le sens horaire) : 1re ligne à droite, la suivante à sa gauche
  const down = (str, x, y) => ({ ...T(str, x, y, 10, str.length * 5), dx: 0, dy: 1 });
  const cw = reconstruct([{ pageNumber: 1, width: W, height: H, frags: [down('Première ligne du cours', 500, 100), down('Deuxième ligne du cours', 486, 100)] }]);
  // (deux lignes de même corps sans ponctuation finale = un seul paragraphe, dans le bon ordre)
  assert.equal(cw.pages[0].text, 'Première ligne du cours Deuxième ligne du cours');
  // texte qui monte : 1re ligne à gauche, la suivante à sa droite
  const up = (str, x, y) => ({ ...T(str, x, y, 10, str.length * 5), dx: 0, dy: -1 });
  const ccw = reconstruct([{ pageNumber: 1, width: W, height: H, frags: [up('Première ligne du cours', 100, 600), up('Deuxième ligne du cours', 114, 600)] }]);
  assert.match(ccw.pages[0].text, /^Première ligne du cours\s+Deuxième ligne du cours$/);
  // une page normale avec une étiquette verticale : l'étiquette est ignorée, le reste est intact
  const mixed = reconstruct([{ pageNumber: 1, width: W, height: H, frags: [T('Texte normal de la page', 50, 100, 10, 110), { ...T('Axe des y', 20, 400), dx: 0, dy: -1 }] }]);
  assert.equal(mixed.pages[0].text, 'Texte normal de la page');
});

test('paragraphes : lignes recollées, mot coupé réparé, interligne large = nouveau paragraphe', () => {
  const frags = [
    ...para(['La cellule est l’unité de base de tous les êtres vivants et elle se', 'divise par mitose pour former de nouvelles cellules, notam-', 'ment lors de la croissance.'], 100),
    ...para(['Les mitochondries produisent l’énergie.'], 100 + 3 * 14 + 14),
  ];
  const { pages } = reconstruct([{ pageNumber: 1, height: 800, frags }]);
  assert.equal(
    pages[0].text,
    'La cellule est l’unité de base de tous les êtres vivants et elle se divise par mitose pour former de nouvelles cellules, notamment lors de la croissance.\n\nLes mitochondries produisent l’énergie.'
  );
});

test('paragraphes : dernière ligne courte puis ligne pleine = nouveau paragraphe', () => {
  const full = 'Une longue ligne de texte qui occupe toute la largeur de la page ici.';
  const frags = [T(full, 50, 100, 10, 430), T('Fin du premier paragraphe.', 50, 114, 10, 130), T(full, 50, 128, 10, 430), T(full, 50, 142, 10, 430)];
  const { pages } = reconstruct([{ pageNumber: 1, height: 800, frags }]);
  assert.equal(pages[0].text.split('\n\n').length, 2);
  assert.ok(pages[0].text.startsWith(`${full} Fin du premier paragraphe.\n\n${full}`));
});

test('listes : disposition réelle d’un PDF (puce en corps 12, espace isolé large, texte en corps 10 un peu plus haut)', () => {
  // relevé tel quel dans un PDF produit par reportlab : le texte NE doit PAS devenir un exposant
  const F = (str, x, y, size, w) => ({ str, x, y, size, w, dx: 1, dy: 0 });
  const body = F('Le protocole HTTP définit la façon dont un navigateur demande une page à un serveur. Le', 78, 212, 10, 400.8);
  const frags = [
    body,
    F('d’un ingénieur réseau consiste à garantir la disponibilité du service.', 78, 236, 10, 297.4),
    F('•', 78, 256, 12, 4.2), F(' ', 82.2, 256, 12, 13.8), F('TCP assure la fiabilité des échanges.', 96, 254, 10, 165.1),
    F('•', 78, 274, 12, 4.2), F(' ', 82.2, 274, 12, 13.8), F('UDP privilégie la rapidité.', 96, 272, 10, 112.3),
  ];
  const lines = buildLines(frags);
  assert.deepEqual(lines.slice(2).map((l) => l.text), ['• TCP assure la fiabilité des échanges.', '• UDP privilégie la rapidité.']);
  const { pages } = reconstruct([{ pageNumber: 1, height: 800, frags }]);
  assert.ok(pages[0].text.endsWith('\n\n- TCP assure la fiabilité des échanges.\n- UDP privilégie la rapidité.'), pages[0].text);
  assert.ok(!pages[0].text.includes('^('));
  assert.ok(!/^#/m.test(pages[0].text), 'une liste n’est pas un titre');
});

test('listes : puce restée seule sur sa ligne rattachée au texte voisin', () => {
  const F = (str, x, y, size, w) => ({ str, x, y, size, w, dx: 1, dy: 0 });
  // puce plus basse de 4 pt que le texte : hors tolérance de « même ligne », mais clairement la même ligne visuelle
  const lines = buildLines([F('•', 78, 258, 12, 4.2), F('Premier point à retenir sur la page.', 96, 254, 10, 170)]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, '• Premier point à retenir sur la page.');
});

test('exposants : seulement courts et collés au caractère précédent', () => {
  const F = (str, x, y, size, w) => ({ str, x, y, size, w, dx: 1, dy: 0 });
  // « 10 » puis une phrase plus petite et surélevée après une espace : texte normal, pas un exposant
  const l = buildLines([F('Note :', 50, 100, 10, 30), F(' ', 80, 100, 10, 3), F('texte explicatif plus petit', 83, 98.5, 8, 100)]);
  assert.equal(l[0].text, 'Note : texte explicatif plus petit');
  const m = buildLines([F('E = mc', 50, 100, 10, 30), F('2', 80, 96.5, 6.5, 3.3)]);
  assert.equal(m[0].text, 'E = mc²');
});

test('listes : puces normalisées, continuation rattachée, numérotation conservée', () => {
  const frags = [
    T('• Le noyau contient l’ADN et dirige la vie de la cellule, avec', 50, 100, 10, 380),
    T('plusieurs chromosomes.', 62, 114, 10, 120),
    T(' La membrane protège la cellule.', 50, 128, 10, 190),
    T('1. Première étape', 50, 142, 10, 90),
    T('2. Deuxième étape', 50, 156, 10, 90),
    T('– Tiret de liste', 50, 170, 10, 80),
  ];
  const { pages } = reconstruct([{ pageNumber: 1, height: 800, frags }]);
  assert.equal(
    pages[0].text,
    '- Le noyau contient l’ADN et dirige la vie de la cellule, avec plusieurs chromosomes.\n- La membrane protège la cellule.\n1. Première étape\n2. Deuxième étape\n- Tiret de liste'
  );
});

test('titres : détectés par la taille, niveaux, titre sur deux lignes, tout-en-majuscules isolé', () => {
  const body = (y, s) => T(s, 50, y, 10, 400);
  const frags = [
    T('Les fonctions', 50, 60, 24, 170),
    T('affines', 50, 88, 24, 90),
    body(120, 'Texte du cours qui explique les notions de base avec assez de mots.'),
    body(134, 'Suite du texte qui continue de bien remplir cette ligne de cours.'),
    T('Définition', 50, 170, 16, 90),
    body(194, 'Une fonction affine est de la forme f(x) = ax + b avec a et b réels.'),
    body(208, 'On la représente par une droite dans un repère du plan.'),
    T('REMARQUE IMPORTANTE', 50, 250, 10, 120),
    body(290, 'Le coefficient directeur est noté a et il se lit sur le graphique.'),
    body(304, 'Il indique la pente de la droite et donc le sens de variation.'),
    body(318, 'Et ainsi de suite jusqu’à la fin de cette page de cours.'),
  ];
  const { pages } = reconstruct([{ pageNumber: 1, height: 800, frags }]);
  const lines = pages[0].text.split('\n\n');
  assert.equal(lines[0], '# Les fonctions affines');
  assert.equal(lines[2], '## Définition');
  assert.ok(lines.includes('### REMARQUE IMPORTANTE'));
  assert.ok(lines[1].startsWith('Texte du cours'));
});

test('en-têtes, pieds de page et numéros retirés ; le contenu reste', () => {
  const mk = (n) => ({
    pageNumber: n,
    width: 595,
    height: 800,
    frags: [
      T('Lycée de Ouagadougou — SVT 2de', 50, 30, 9, 150),
      ...para([`Contenu unique de la page ${n} : ${'mot '.repeat(10)}`.trim()], 300, { size: 10 }).map((f) => ({ ...f, w: 380 })),
      T(`Page ${n}`, 280, 780, 9, 30),
    ],
  });
  const { pages, stats } = reconstruct([1, 2, 3, 4].map(mk));
  assert.equal(stats.removed, 8);
  for (const p of pages) {
    assert.ok(!/Lycée|Page \d/.test(p.text), p.text);
    assert.match(p.text, /^Contenu unique de la page \d/);
  }
  // sur un document de 2 pages, seuls les numéros partent (pas assez de répétitions pour juger)
  const two = [1, 2].map(mk);
  const r = reconstruct(two);
  assert.equal(r.stats.removed, 2);
  assert.match(r.pages[0].text, /Lycée/);
});

test('stripRepeated : une ligne du corps de page n’est jamais retirée, même si elle se répète', () => {
  const pages = [1, 2, 3, 4].map(() => ({ height: 800, lines: [{ text: 'Exemple', x0: 50, x1: 100, y: 400, size: 10, chars: 7 }] }));
  assert.equal(stripRepeated(pages), 0);
});

test('qualité : texte français correct, texte illisible, caractères de remplacement', () => {
  const good = textQuality('La cellule est l’unité de base de tous les êtres vivants. Elle se divise pour former de nouvelles cellules dans le corps.');
  assert.equal(good.garbled, false);
  assert.ok(good.score > 0.5, String(good.score));
  assert.equal(textQuality('����abc���������').garbled, true);
  assert.equal(textQuality(' ').garbled, true);
  const shifted = 'Qb dfmmvmf'.repeat(30); // décalage de glyphes : lettres valides mais mots absurdes
  assert.equal(textQuality(shifted).garbled, true);
  assert.equal(textQuality('').garbled, false);
  assert.equal(textQuality('3 + 4 = 7 ; 12 × 5 = 60').garbled, false, 'un calcul n’est pas illisible');
});

test('sections : étiquettes « p. N · titre », titre reporté d’une page à l’autre', () => {
  const pages = [
    { pageNumber: 1, text: '# Cours\n\nIntro de la page un.\n\n## Les organites\n\nLe noyau.' },
    { pageNumber: 2, text: 'Suite sur les organites.\n\n## Photosynthèse\n\nLes chloroplastes.' },
    { pageNumber: 3, text: '## Titre en bas de page' },
    { pageNumber: 4, text: 'Texte rattaché au titre précédent.' },
    { pageNumber: 5, text: '' },
  ];
  const s = toSections(pages);
  assert.deepEqual(
    s.map((x) => x.label),
    ['p. 1 · Cours', 'p. 1 · Les organites', 'p. 2 · Les organites', 'p. 2 · Photosynthèse', 'p. 3 · Titre en bas de page', 'p. 4 · Titre en bas de page']
  );
  assert.equal(s[1].text, '## Les organites\n\nLe noyau.');
  assert.equal(s[2].text, 'Suite sur les organites.');
});
