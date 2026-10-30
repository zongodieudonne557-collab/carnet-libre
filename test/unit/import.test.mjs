import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createImporter, detectKind, titleFromName, ImportError, LIMITS } from '../../src/import/index.js';
import { decodeText, stripFrontMatter, subtitlesToText, latexToMarkdown } from '../../src/import/plain.js';
import { reflowOcr, acceptOcr, confidenceWarning } from '../../src/import/ocrtext.js';

const bytesOf = (name) => new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
const fileOf = (name, as = name) => new File([bytesOf(name)], as);
const textFile = (name, text) => new File([text], name);

// ---------------------------------------------------------------- reconnaissance du type
test('type de fichier : le contenu l’emporte sur l’extension', () => {
  assert.equal(detectKind('cours.pdf', bytesOf('cours-numerique.pdf')), 'pdf');
  assert.equal(detectKind('renomme.txt', bytesOf('cours-svt.docx')), 'docx');
  assert.equal(detectKind('renomme.bin', bytesOf('cours-maths.pptx')), 'pptx');
  assert.equal(detectKind('photo.png', bytesOf('photo.png')), 'image');
  assert.equal(detectKind('trompeur.pdf', bytesOf('photo.png')), 'image');
  assert.equal(detectKind('vieux.doc', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0])), 'legacy-office');
  assert.equal(detectKind('notes', new TextEncoder().encode('du texte sans extension')), 'text');
  assert.equal(detectKind('binaire', new Uint8Array([1, 2, 0, 3])), 'unknown');
  // un texte qui parle de PDF n'est pas un PDF
  assert.equal(detectKind('notes.txt', new TextEncoder().encode('Un PDF commence par %PDF-1.4 puis des objets.')), 'text');
  // un faux .docx qui n'est pas une archive
  assert.equal(detectKind('faux.docx', new TextEncoder().encode('bonjour')), 'unknown');
});

test('titre tiré du nom de fichier', () => {
  assert.equal(titleFromName('Cours_de_SVT__chapitre 1.docx'), 'Cours de SVT chapitre 1');
  assert.equal(titleFromName('C:\\Users\\moi\\Maths.pdf'), 'Maths');
  assert.equal(titleFromName('.pdf'), 'Sans titre');
});

// ---------------------------------------------------------------- importateur : vrais fichiers
test('import PDF réel : titres, paragraphes, liste, étiquettes « p. N · titre »', async () => {
  const imp = createImporter({ ocr: 'never' });
  const events = [];
  const r = await imp.importFile(fileOf('cours-numerique.pdf'), { onProgress: (p) => events.push(p) });
  assert.equal(r.kind, 'pdf');
  assert.equal(r.title, 'cours-numerique');
  assert.deepEqual(r.pages.map((p) => p.label), ['p. 1 · Les réseaux informatiques', 'p. 1 · Les protocoles', 'p. 2 · Sécurité']);
  assert.match(r.pages[0].text, /^# Les réseaux informatiques\n\nUn réseau informatique est un ensemble d’ordinateurs/);
  assert.match(r.pages[0].text, /robuste\.$/);
  assert.match(r.pages[1].text, /\n\n- TCP assure la fiabilité des échanges\.\n- UDP privilégie la rapidité\.\n- DNS traduit un nom en adresse IP\.$/);
  assert.match(r.pages[2].text, /^## Sécurité\n\nUtiliser un mot de passe long/);
  assert.ok(!r.pages.some((p) => /\^\(|undefined|NaN/.test(p.text)));
  assert.equal(r.meta.pages, 2);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(events.filter((e) => e.phase === 'read').map((e) => e.done), [1, 2]);
});

test('import PDF scanné sans OCR : erreur claire qui propose l’OCR', async () => {
  const imp = createImporter({ ocr: 'never' });
  await assert.rejects(imp.importFile(fileOf('scan.pdf')), (e) => e instanceof ImportError && e.code === 'empty' && /scan/.test(e.message) && /OCR/.test(e.message));
});

test('import PDF : annulation avant lecture', async () => {
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(createImporter().importFile(fileOf('cours-numerique.pdf'), { signal: ctl.signal }), (e) => e.name === 'AbortError');
});

test('import PDF : fichier abîmé ou faux PDF', async () => {
  const bad = new Uint8Array([...new TextEncoder().encode('%PDF-1.4\n'), ...new Uint8Array(200).fill(7)]);
  await assert.rejects(createImporter().importFile(new File([bad], 'abime.pdf')), (e) => e instanceof ImportError && /illisible|impossible/.test(e.message));
});

test('import Word et PowerPoint : titre du fichier, sections', async () => {
  const imp = createImporter();
  const d = await imp.importFile(fileOf('cours-svt.docx'));
  assert.equal(d.kind, 'docx');
  assert.equal(d.title, 'cours-svt');
  assert.ok(d.pages.some((p) => p.label === '§ Les organites'));
  const p = await imp.importFile(fileOf('cours-maths.pptx'), { title: 'Fonctions affines' });
  assert.equal(p.kind, 'pptx');
  assert.equal(p.title, 'Fonctions affines');
  assert.equal(p.pages.length, 4);
});

test('import texte : Windows-1252, BOM, front matter Markdown, sections', async () => {
  const imp = createImporter();
  const a = await imp.importFile(fileOf('latin1.txt'));
  assert.match(a.pages[0].text, /^Élève : l’été à Ouagadougou — œuvre d’art\.\nLe café coûte 500 F\.$/);
  const b = await imp.importFile(fileOf('utf8-bom.txt'));
  assert.equal(b.pages[0].text, 'Texte avec BOM : été, île, cœur.');
  const md = await imp.importFile(textFile('cours.md', '---\ntitle: "Les volcans"\ntags: [svt]\n---\n# Magma\n\nLe magma est une roche en fusion.\n\n## Types\n\nEffusif ou explosif.\n'));
  assert.equal(md.title, 'Les volcans');
  assert.deepEqual(md.pages.map((p) => p.label), ['§ Magma', '§ Types']);
  assert.ok(!md.pages[0].text.includes('tags'));
});

test('import texte : l’indentation du code est conservée', async () => {
  const code = 'Algorithme :\n\npour i de 1 à n faire\n    si t[i] > max alors\n        max <- t[i]\n    fin si\nfin pour\n';
  const r = await createImporter().importFile(textFile('algo.txt', code));
  assert.ok(r.pages[0].text.includes('\n    si t[i] > max alors\n        max <- t[i]\n    fin si\n'), r.pages[0].text);
});

test('import : texte long sans titre découpé en « partie N »', async () => {
  const long = Array.from({ length: 12 }, (_, i) => `Paragraphe ${i + 1}. ${'Le texte du cours continue avec des phrases utiles. '.repeat(20)}`.trim()).join('\n\n');
  const r = await createImporter().importFile(textFile('long.txt', long));
  assert.ok(r.pages.length >= 3);
  assert.equal(r.pages[0].label, 'partie 1');
  assert.equal(r.pages.at(-1).label, `partie ${r.pages.length}`);
  assert.equal(r.pages.map((p) => p.text).join('\n\n'), long.trim());
});

test('import : formats non pris en charge → messages qui disent quoi faire', async () => {
  const imp = createImporter();
  const ole = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4])], 'vieux.doc');
  await assert.rejects(imp.importFile(ole), (e) => e.code === 'unsupported' && /docx/.test(e.message));
  await assert.rejects(imp.importFile(textFile('notes.xlsx', 'a;b')), (e) => e.code === 'unsupported' && /tableur/i.test(e.message));
  await assert.rejects(imp.importFile(textFile('tout.rtf', '{\\rtf1 bonjour}')), (e) => e.code === 'unsupported' && /docx/.test(e.message));
  await assert.rejects(imp.importFile(new File([new Uint8Array([1, 2, 0, 4])], 'data.bin')), (e) => e.code === 'unsupported' && /Formats acceptés/.test(e.message));
});

test('import : fichier vide, trop gros (jamais lu), image sans OCR autorisé', async () => {
  const imp = createImporter({ ocr: 'never' });
  await assert.rejects(imp.importFile(new File([], 'vide.txt')), (e) => e.code === 'empty');
  const huge = { name: 'gros.pdf', size: LIMITS.maxBytes + 1, arrayBuffer: async () => assert.fail('ne doit pas être lu') };
  await assert.rejects(imp.importFile(huge), (e) => e.code === 'too_big' && /Mo/.test(e.message));
  await assert.rejects(imp.importFile(fileOf('photo.png')), (e) => e.code === 'ocr_off');
});

test('texte collé', () => {
  const imp = createImporter();
  const r = imp.importText('# Photosynthèse\n\nElle se déroule dans les chloroplastes des cellules végétales.', { title: 'Mes notes' });
  assert.equal(r.title, 'Mes notes');
  assert.equal(r.kind, 'paste');
  assert.equal(r.pages[0].label, '§ Photosynthèse');
  assert.throws(() => imp.importText('trop court'), (e) => e.code === 'empty');
});

// ---------------------------------------------------------------- lecteurs de texte
test('decodeText : UTF-8, BOM, UTF-16, Windows-1252', () => {
  assert.deepEqual(decodeText(new TextEncoder().encode('é')), { text: 'é', encoding: 'utf-8' });
  assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0xe9, 0x00])).text, 'Hé');
  assert.equal(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x48, 0x00, 0xe9])).text, 'Hé');
  assert.deepEqual(decodeText(new Uint8Array([0xe9, 0x74, 0xe9, 0x80])), { text: 'été€', encoding: 'windows-1252' });
});

test('front matter Markdown', () => {
  assert.deepEqual(stripFrontMatter('---\ntitle: Test\n---\nCorps'), { text: 'Corps', title: 'Test' });
  assert.deepEqual(stripFrontMatter('Pas d’en-tête\n---\nsuite'), { text: 'Pas d’en-tête\n---\nsuite', title: '' });
});

test('sous-titres SRT : horodatages, balises et pauses', () => {
  const srt = `1
00:00:01,000 --> 00:00:03,500
Bonjour à tous,

2
00:00:03,600 --> 00:00:06,000
aujourd’hui nous parlons de la <i>photosynthèse</i>.

3
00:00:12,000 --> 00:00:15,000
{\\an8}Elle se déroule dans les chloroplastes.
`;
  assert.equal(subtitlesToText(srt), 'Bonjour à tous, aujourd’hui nous parlons de la photosynthèse.\n\nElle se déroule dans les chloroplastes.');
});

test('sous-titres VTT « défilants » (YouTube) : répétitions supprimées', () => {
  const vtt = `WEBVTT
Kind: captions
Language: fr

00:00:00.000 --> 00:00:02.000 align:start position:0%
La cellule est l’unité

00:00:02.000 --> 00:00:04.000 align:start position:0%
La cellule est l’unité
de base du vivant

00:00:04.000 --> 00:00:06.000 align:start position:0%
de base du vivant
Elle possède une membrane &amp; un noyau.
`;
  assert.equal(subtitlesToText(vtt), 'La cellule est l’unité de base du vivant Elle possède une membrane & un noyau.');
});

test('LaTeX : titres, accents, théorèmes, listes, formules conservées', () => {
  const tex = String.raw`\documentclass{article}
\usepackage[utf8]{inputenc}
\title{Les suites num\'eriques}
\begin{document}
\maketitle
\section{D\'efinitions}
% commentaire ignoré
Une suite est une fonction de $\mathbb{N}$ dans $\mathbb{R}$. Elle est \textbf{croissante} si $u_{n+1} \ge u_n$.
\begin{definition}[Suite arithm\'etique]
Une suite est arithm\'etique si $u_{n+1}=u_n+r$.\label{def:ar}
\end{definition}
\begin{itemize}
\item Premier point
\item Second point avec \emph{emphase}
\end{itemize}
\[ S_n = \frac{n(u_0+u_n)}{2} \]
\subsection{Remarque}
Voir~\ref{def:ar}. 50\% des cas.
\end{document}
ignoré après la fin`;
  const r = latexToMarkdown(tex);
  assert.equal(r.title, 'Les suites numériques');
  assert.match(r.text, /^# Définitions$/m);
  assert.match(r.text, /^## Remarque$/m);
  assert.ok(r.text.includes('Une suite est une fonction de $\\mathbb{N}$ dans $\\mathbb{R}$. Elle est **croissante** si $u_{n+1} \\ge u_n$.'));
  assert.ok(r.text.includes('**Définition (Suite arithmétique).** Une suite est arithmétique si $u_{n+1}=u_n+r$.'));
  assert.match(r.text, /^- Premier point\n- Second point avec \*emphase\*$/m);
  assert.ok(r.text.includes('$$ S_n = \\frac{n(u_0+u_n)}{2} $$'));
  assert.ok(r.text.includes('50% des cas.'));
  assert.ok(!/commentaire|ignoré après|\\label|\\maketitle|documentclass/.test(r.text));
});

// ---------------------------------------------------------------- OCR (mise en forme, décision)
test('OCR : lignes recollées, mots coupés réparés, puces gardées', () => {
  const raw = 'La photosynthèse se déroule dans\nles chloroplastes.\n\nLes plantes vertes fabri-\nquent de la matière.\n\n- point un\n- point deux\nsuite du point deux\n1. première étape\n2. seconde étape\n';
  assert.equal(
    reflowOcr(raw),
    'La photosynthèse se déroule dans les chloroplastes.\n\nLes plantes vertes fabriquent de la matière.\n\n- point un\n- point deux suite du point deux\n1. première étape\n2. seconde étape'
  );
  assert.equal(reflowOcr(''), '');
  assert.equal(reflowOcr(null), '');
});

test('OCR : accepter seulement un texte lisible qui améliore l’existant', () => {
  const good = 'La photosynthèse se déroule dans les chloroplastes des cellules végétales et produit du dioxygène.';
  assert.equal(acceptOcr({ text: good, confidence: 88 }), true);
  assert.equal(acceptOcr({ text: 'ab c', confidence: 90 }), false, 'trop court');
  assert.equal(acceptOcr({ text: good, confidence: 20 }), false, 'confiance trop basse');
  assert.equal(acceptOcr({ text: '\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD', confidence: 90 }), false);
  // la couche texte du PDF est déjà bonne : on ne la remplace pas
  assert.equal(acceptOcr({ text: good, confidence: 88 }, 'La photosynthèse se déroule dans les chloroplastes des cellules végétales et produit du dioxygène.'), false);
  // couche texte illisible : l'OCR la remplace
  assert.equal(acceptOcr({ text: good, confidence: 88 }, '\uE001\uE002\uE003\uE004 \uE005\uE006\uE007\uE008\uE009\uE00A\uE00B\uE00C\uE00D\uE00E'), true);
  // page presque vide : l'OCR complète
  assert.equal(acceptOcr({ text: good, confidence: 70 }, 'Diapo 3'), true);
});

test('OCR : avertissements de confiance', () => {
  assert.match(confidenceWarning(40), /peu sûre/);
  assert.match(confidenceWarning(65), /moyennement/);
  assert.equal(confidenceWarning(90), '');
  assert.equal(confidenceWarning(undefined), '');
});
