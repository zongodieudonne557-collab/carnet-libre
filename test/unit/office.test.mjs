import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from '../../vendor/fflate/fflate.js';
import { parseXML, decodeEntities, findAll, find, textOf } from '../../src/import/xml.js';
import { ommlToLatex } from '../../src/import/omml.js';
import { extractDocx } from '../../src/import/docx.js';
import { extractPptx } from '../../src/import/pptx.js';

const fx = (name) => new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));

// ---------------------------------------------------------------- XML
test('XML : éléments, attributs, texte, entités, CDATA, commentaires', () => {
  const t = parseXML('<?xml version="1.0"?><!-- c --><a x="1 &gt; 0" y=\'z\'><b>R&amp;D &#233; &#x41;</b><c/><![CDATA[<brut>]]></a>');
  const a = find(t, 'a');
  assert.deepEqual(a.attrs, { x: '1 > 0', y: 'z' });
  assert.equal(textOf(find(t, 'b')), 'R&D é A');
  assert.equal(textOf(a), 'R&D é A<brut>');
  assert.equal(findAll(t, 'c').length, 1);
});

test('XML : une balise avec « > » dans un attribut, et un document mal fermé, ne cassent rien', () => {
  const t = parseXML('<a title="x>y"><b>texte<c>fin');
  assert.equal(find(t, 'a').attrs.title, 'x>y');
  assert.equal(textOf(find(t, 'b')), 'textefin');
});

test('XML : entités inconnues ou hostiles laissées telles quelles (pas d’expansion)', () => {
  assert.equal(decodeEntities('&bomb;&#0;&#x110000;'), '&bomb;&#0;&#x110000;');
  const bomb = '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><a>&lol2;</a>';
  assert.equal(textOf(parseXML(bomb)), '&lol2;');
});

test('XML : imbrication excessive refusée proprement', () => {
  assert.throws(() => parseXML('<a>'.repeat(400)), /trop imbriqué/);
});

// ---------------------------------------------------------------- OMML
const m = (xml) => ommlToLatex(parseXML(`<m:oMath xmlns:m="x">${xml}</m:oMath>`).children[0]);
const r = (t) => `<m:r><m:t>${t}</m:t></m:r>`;

test('OMML : fraction, exposant, indice, racine', () => {
  assert.equal(m(`<m:f><m:num>${r('a')}</m:num><m:den>${r('b')}</m:den></m:f>`), '\\frac{a}{b}');
  assert.equal(m(`<m:sSup><m:e>${r('x')}</m:e><m:sup>${r('2')}</m:sup></m:sSup>`), '{x}^{2}');
  assert.equal(m(`<m:sSub><m:e>${r('x')}</m:e><m:sub>${r('1')}</m:sub></m:sSub>`), '{x}_{1}');
  assert.equal(m(`<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${r('x')}</m:e></m:rad>`), '\\sqrt{x}');
  assert.equal(m(`<m:rad><m:deg>${r('3')}</m:deg><m:e>${r('x')}</m:e></m:rad>`), '\\sqrt[3]{x}');
});

test('OMML : parenthèses, somme, fonction, matrice, caractères spéciaux', () => {
  assert.equal(m(`<m:d><m:e>${r('a')}</m:e></m:d>`), '\\left( a \\right)');
  assert.equal(m(`<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub>${r('i=1')}</m:sub><m:sup>${r('n')}</m:sup><m:e>${r('i')}</m:e></m:nary>`), '\\sum_{i=1}^{n} i');
  assert.equal(m(`<m:func><m:fName>${r('sin')}</m:fName><m:e>${r('x')}</m:e></m:func>`), '\\operatorname{sin} x');
  assert.equal(m(`<m:m><m:mr><m:e>${r('1')}</m:e><m:e>${r('0')}</m:e></m:mr><m:mr><m:e>${r('0')}</m:e><m:e>${r('1')}</m:e></m:mr></m:m>`), '\\begin{matrix} 1 & 0 \\\\ 0 & 1 \\end{matrix}');
  assert.equal(m(r('50% {x}')), '50\\% \\{x\\}');
});

test('OMML : accents, barres, indice+exposant, structures inconnues sans perte de texte', () => {
  assert.equal(m(`<m:acc><m:accPr><m:chr m:val="⃗"/></m:accPr><m:e>${r('v')}</m:e></m:acc>`), '\\vec{v}');
  assert.equal(m(`<m:acc><m:e>${r('x')}</m:e></m:acc>`), '\\hat{x}');
  assert.equal(m(`<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${r('x')}</m:e></m:bar>`), '\\overline{x}');
  assert.equal(m(`<m:sSubSup><m:e>${r('x')}</m:e><m:sub>${r('i')}</m:sub><m:sup>${r('2')}</m:sup></m:sSubSup>`), '{x}_{i}^{2}');
  assert.equal(m(`<m:truc><m:e>${r('abc')}</m:e></m:truc>`), 'abc');
});

// ---------------------------------------------------------------- DOCX (fichier réel fait avec python-docx)
test('DOCX réel : titres, listes, tableau, équations', () => {
  const { pages, meta } = extractDocx(fx('cours-svt.docx'));
  const all = pages.map((p) => p.text).join('\n\n');
  assert.match(all, /^# La cellule, unité du vivant/m);
  assert.match(all, /^## Définition|^# Définition/m);
  assert.match(all, /La cellule est l’unité de base de tous les êtres vivants\./);
  assert.match(all, /^- Les mitochondries produisent l’énergie de la cellule\.$/m);
  assert.match(all, /^- Le noyau contient l’ADN\.$/m);
  assert.match(all, /^\| Organite \| Rôle \|$/m);
  assert.match(all, /^\| Chloroplaste \| Photosynthèse \|$/m);
  assert.match(all, /\$\\frac\{\{y\}_\{2\}−\{y\}_\{1\}\}\{\{x\}_\{2\}−\{x\}_\{1\}\}\$/);
  assert.match(all, /\$A=π\{r\}\^\{2\}\$/);
  assert.equal(meta.tables, 1);
  assert.ok(pages.length >= 4, 'découpé par titres');
  assert.ok(pages.some((p) => p.label === '§ Les organites'));
});

test('DOCX : fichier invalide, ZIP sans document, document vide', () => {
  assert.throws(() => extractDocx(new Uint8Array([1, 2, 3])), /illisible/);
  assert.throws(() => extractDocx(zipSync({ 'hello.txt': strToU8('x') })), /pas un document Word/);
  const empty = zipSync({ 'word/document.xml': strToU8('<w:document xmlns:w="x"><w:body><w:p/></w:body></w:document>') });
  assert.throws(() => extractDocx(empty), /ne contient pas de texte/);
  const imgOnly = zipSync({ 'word/document.xml': strToU8('<w:document xmlns:w="x"><w:body><w:p><w:r><w:drawing/></w:r></w:p></w:body></w:document>') });
  assert.throws(() => extractDocx(imgOnly), /que des images/);
});

test('DOCX : suppressions suivies ignorées, insertions gardées, titres « Titre1 » en français', () => {
  const doc = `<w:document xmlns:w="w"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Titre1"/></w:pPr><w:r><w:t>Chapitre un</w:t></w:r></w:p>
    <w:p><w:r><w:t>Gardé</w:t></w:r><w:del><w:r><w:delText>supprimé</w:delText></w:r></w:del><w:ins><w:r><w:t> ajouté</w:t></w:r></w:ins></w:p>
  </w:body></w:document>`;
  const styles = `<w:styles xmlns:w="w"><w:style w:styleId="Titre1"><w:name w:val="heading 1"/></w:style></w:styles>`;
  const { pages } = extractDocx(zipSync({ 'word/document.xml': strToU8(doc), 'word/styles.xml': strToU8(styles) }));
  const txt = pages.map((p) => p.text).join('\n');
  assert.match(txt, /^# Chapitre un$/m);
  assert.match(txt, /Gardé ajouté/);
  assert.ok(!/supprimé/.test(txt));
});

// ---------------------------------------------------------------- PPTX (fichier réel fait avec python-pptx)
test('PPTX réel : une page par diapositive, puces, tableau, notes', () => {
  const { pages, meta } = extractPptx(fx('cours-maths.pptx'));
  assert.equal(pages.length, 4);
  assert.equal(meta.notes, 1);
  assert.equal(pages[0].label, 'Diapo 1 — Les fonctions affines');
  assert.match(pages[0].text, /Cours de mathématiques — Seconde/);
  assert.match(pages[1].text, /^# Définition/);
  assert.match(pages[1].text, /^- f\(x\) = ax \+ b$/m);
  assert.match(pages[1].text, /^ {2}- a est le coefficient directeur$/m);
  assert.match(pages[1].text, /Notes de l’intervenant : Insister sur le fait que la représentation graphique est une droite\./);
  assert.match(pages[2].text, /^\| x \| 0 \| 1 \|$/m);
  assert.match(pages[2].text, /^\| Variation \| croissante \| croissante \|$/m);
  assert.match(pages[3].text, /Zéro de la fonction : x = −b\/a/);
});

test('PPTX : fichier invalide', () => {
  assert.throws(() => extractPptx(new Uint8Array([9, 9])), /illisible/);
  assert.throws(() => extractPptx(zipSync({ 'a.txt': strToU8('x') })), /pas une présentation/);
});
