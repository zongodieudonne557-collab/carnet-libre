// Aides « sans IA » : questions suggérées, mots-clés et cartes automatiques
// construites à partir de motifs de phrases (définitions, termes en gras, textes à trous).
// Les cartes obtenues sont marquées « auto » dans l'interface : elles se relisent avant d'étudier.
import { foldAccents } from '../text/normalize.js';
import { splitSentences } from '../text/chunk.js';
import { STOPWORDS } from '../text/stopwords.js';
import { stem } from '../text/stem.js';
import { escapeRegExp } from '../util.js';

export function stripMarkdown(s) {
  return String(s)
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)[^)]+\)/g, '$1')
    .trim();
}

const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const upperFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Unités de texte : lignes de listes entières, ou phrases des paragraphes. */
export function sentenceUnits(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const raw = line.trim();
    if (!raw || /^#{1,6}\s/.test(raw) || /^\$\$/.test(raw)) continue;
    const isBullet = /^(?:[-*•]|\d+[.)])\s+/.test(raw);
    const clean = stripMarkdown(raw);
    if (!clean) continue;
    if (isBullet) out.push({ raw, text: clean });
    else for (const s of splitSentences(clean)) out.push({ raw, text: s });
  }
  return out;
}

// ------------------------------------------------------------------ définitions

const PRONOUN = /^(il|elle|ils|elles|ce|cet|cette|ces|cela|ça|on|nous|vous|je|tu|ceci|celui|celle|ceux|dans|pour|si|quand|lorsque|ainsi|par|avec|sans|chez)\b/i;
// Phrases qui renvoient à une phrase précédente : sans elle, la carte n'a pas de sens.
const ANAPHORA = /^(il|elle|ils|elles|ce|cet|cette|ces|cela|ça|ceci|celui|celle|ceux|on|ainsi|alors|puis|ensuite|donc|mais|or|cependant)\b/i;
const NAMED = '(?:appelé|appelée|appelés|appelées|nommé|nommée|nommés|nommées|noté|notée|notés|notées|désigné|désignée|désignés|désignées)';
const ART = '(?:le|la|les|l[\'’]|un|une|des)';

function questionFor(term, plural) {
  const t = lowerFirst(term.trim());
  if (plural) return `Que sont ${t} ?`;
  if (/^(un|une)\b/i.test(t) || /^[aeiouyhàâéèêëîïôûù]/i.test(t)) return `Qu'est-ce qu'${t} ?`;
  return `Qu'est-ce que ${t} ?`;
}

/** « Le nombre a est appelé X et le nombre b est appelé Y » → deux propositions. */
function splitClauses(sentence) {
  const re = new RegExp(`\\s+(?:et|ou|;)\\s+(?=${ART}\\s?[^,;]{1,50}\\s(?:est|sont)\\s+${NAMED})`, 'i');
  return sentence.split(re).map((c, i) => (i ? upperFirst(c) : c));
}

function matchOneDefinition(s) {
  // « X est appelé Y » → « Comment appelle-t-on X ? »
  let m = new RegExp(`^(.{3,90}?)\\s+(?:est|sont)\\s+${NAMED}\\s+(?:${ART}\\s?)?(.{2,70}?)\\s*[.;]?$`, 'i').exec(s);
  if (m && !/\b(?:est|sont)\b/i.test(m[1]) && !/\b(?:est|sont)\b/i.test(m[2]) && !PRONOUN.test(m[1])) {
    return { kind: 'def', front: `Comment appelle-t-on ${lowerFirst(m[1])} ?`, back: upperFirst(m[2].replace(/[.;]$/, '')) };
  }
  // « On appelle X le/la Y » → « Que désigne Y ? »
  m = new RegExp(`^On (?:appelle|nomme|note)\\s+(.{3,70}?)\\s+${ART}\\s?(.{3,120}?)\\s*[.;]?$`, 'i').exec(s);
  if (m && !/\b(?:est|sont)\b/i.test(m[1])) {
    return { kind: 'def', front: `Que désigne « ${m[2].replace(/[.;]$/, '')} » ?`, back: upperFirst(m[1]) };
  }
  // « Le/La/Les X est/sont un/une/le … » → « Qu'est-ce que X ? »
  m = new RegExp(
    `^(${ART}\\s?[^,;:()=]{2,60}?)\\s+(est|sont)\\s+((?:un|une|le|la|les|l['’]|des|du|de la|de l['’]|défini|définie|définis|définies|caractérisé|caractérisée|formé|formée|constitué|constituée|composé|composée)\\b.{10,260})$`,
    'i'
  ).exec(s);
  if (m && !PRONOUN.test(m[1]) && m[1].split(/\s+/).length <= 7) {
    return { kind: 'def', front: questionFor(m[1], m[2].toLowerCase() === 'sont'), back: s };
  }
  return null;
}

/** Cherche des définitions dans une phrase. Renvoie une liste (souvent vide ou d'un seul élément). */
export function matchDefinitions(sentence) {
  const s = sentence.trim().replace(/\s+/g, ' ');
  if (s.length < 25 || s.length > 320) return [];
  if (/[=$\\]/.test(s.slice(0, 40))) return [];
  const out = [];
  for (const clause of splitClauses(s)) {
    const d = matchOneDefinition(clause);
    if (d) out.push(d);
  }
  return out;
}

/** Première définition trouvée (compatibilité) ou null. */
export function matchDefinition(sentence) {
  return matchDefinitions(sentence)[0] ?? null;
}

/** Termes en gras suivis d'une définition : « **Chlorophylle** : pigment vert… » */
function matchBoldTerm(rawLine) {
  const m = /^\W*\*\*(.{2,60}?)\*\*\s*[:–—-]\s*(.{12,260})$/.exec(rawLine.trim());
  if (!m) return null;
  return { kind: 'def', front: `Définis : ${m[1].replace(/[:.]$/, '')}`, back: upperFirst(stripMarkdown(m[2])) };
}

// ------------------------------------------------------------------ mots-clés

// Mots trop généraux pour être un « terme du cours » (comparés sans accents).
const STUDY_NOISE = new Set(
  `exemple exemples definition definitions propriete proprietes cours chapitre partie parties notion notions point points
   facon maniere fois lorsque afin permet permettent utilisant utilise utilises utilisee appele appelee appeles appelle note notee
   soient selon pendant durant plusieurs different differents differente differentes premier premiere deuxieme second seconde
   strictement directement seulement notamment uniquement simplement generalement toujours souvent parfois egalement
   particulierement principalement rapidement lentement facilement ensuite ainsi alors produisant permettant etant ayant sachant
   considerant appelant beaucoup autres autre aussi donc chaque comme entre apres avant depuis dessus dessous
   suffit faut falloir peut peuvent pouvoir doit doivent devoir vaut valent obtient obtenir donne donner`
    .split(/\s+/)
    .filter(Boolean)
);

const TOKEN = /[\p{L}][\p{L}-]*/gu;

function isTopicalWord(surface) {
  const w = foldAccents(surface).toLowerCase();
  return w.length >= 5 && !STOPWORDS.has(w) && !STUDY_NOISE.has(w) && !/^\d/.test(w);
}

/** Mots-clés du carnet (forme la plus fréquente de chaque racine, au moins 2 occurrences). */
export function keyTerms(chunks, n = 8) {
  const count = new Map(); // racine → {n, forms}
  for (const c of chunks) {
    for (const surface of c.text.match(TOKEN) || []) {
      if (!isTopicalWord(surface)) continue;
      const k = stem(foldAccents(surface).toLowerCase());
      let e = count.get(k);
      if (!e) count.set(k, (e = { n: 0, forms: new Map() }));
      e.n++;
      const f = surface.toLowerCase();
      e.forms.set(f, (e.forms.get(f) || 0) + 1);
    }
  }
  return [...count.entries()]
    .filter(([, e]) => e.n >= 2)
    .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([k, e]) => ({ stem: k, count: e.n, term: [...e.forms.entries()].sort((a, b) => b[1] - a[1])[0][0] }));
}

// ------------------------------------------------------------------ questions suggérées

const GENERIC_HEADING = /^(introduction|conclusion|sommaire|plan|résumé|resume|rappels?|d[ée]finitions?|propri[ée]t[ée]s?|th[ée]or[èe]mes?|exemples?|exercices?|remarques?|m[ée]thodes?|[àa] retenir|ce qu['’]il faut retenir)$/i;

/** Questions à poser à ses sources, calculées sans IA. */
export function suggestQuestions(chunks, n = 5) {
  const out = [];
  const seen = new Set();
  const add = (q) => {
    const k = foldAccents(q).toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(q);
    }
  };
  const headings = [];
  for (const c of chunks) {
    const m = /^§ (.+)$/.exec(c.label || '');
    const h = m && m[1].trim();
    if (h && h.length >= 6 && !GENERIC_HEADING.test(h) && !headings.includes(h)) headings.push(h);
  }
  // quelques titres répartis sur l'ensemble des sources
  const picks = [];
  const k = Math.min(3, headings.length);
  for (let i = 0; i < k; i++) picks.push(headings[Math.floor((i * headings.length) / k)]);
  picks.forEach((h) => add(/\?$/.test(h) ? h : `Explique-moi « ${h} » simplement.`));
  keyTerms(chunks, 6)
    .slice(0, 2)
    .forEach((t) => add(`Quelle est la définition de « ${t.term} » ?`));
  add('Fais un résumé de mes sources.');
  add('Quels sont les points les plus importants à retenir pour l’examen ?');
  add('Pose-moi trois questions pour vérifier que j’ai compris.');
  return out.slice(0, n);
}

// ------------------------------------------------------------------ cartes automatiques

const FORMULA_SYMBOLS = /[=+→×÷<>≠≤≥∑∫√∞±]/g;

function looksLikeFormula(text) {
  const syms = (text.match(FORMULA_SYMBOLS) || []).length;
  return syms >= 3 || /[$\\]/.test(text) || /https?:/.test(text);
}

/**
 * Cartes automatiques (sans IA).
 * @param {{id: string, text: string}[]} chunks
 * @param {{max?: number}} [opts]
 * @returns {{front: string, back: string, kind: 'def'|'cloze', chunkId: string, quote: string}[]}
 */
export function autoCards(chunks, opts = {}) {
  const max = opts.max ?? 20;
  const defs = [];
  const clozes = [];
  const seenFront = new Set();
  const topical = new Set(keyTerms(chunks, 40).map((t) => t.stem));

  for (const c of chunks) {
    for (const line of c.text.split('\n')) {
      const bold = matchBoldTerm(line);
      if (bold && !seenFront.has(bold.front)) {
        seenFront.add(bold.front);
        defs.push({ ...bold, chunkId: c.id, quote: bold.back.slice(0, 160) });
      }
    }
    for (const u of sentenceUnits(c.text)) {
      const found = matchDefinitions(u.text);
      for (const def of found) {
        if (!seenFront.has(def.front)) {
          seenFront.add(def.front);
          defs.push({ ...def, chunkId: c.id, quote: u.text.slice(0, 200) });
        }
      }
      if (found.length) continue;

      // texte à trous : on masque un terme du cours (mot important du carnet), jamais un mot au hasard
      const nWords = u.text.split(/\s+/).length;
      if (nWords < 8 || nWords > 40 || looksLikeFormula(u.text)) continue;
      if (/^(exemple|remarque|attention)\b/i.test(u.text) || ANAPHORA.test(u.text)) continue;
      let best = null;
      let bestScore = 0;
      for (const sf of u.text.match(TOKEN) || []) {
        if (!isTopicalWord(sf)) continue;
        if (!topical.has(stem(foldAccents(sf).toLowerCase()))) continue;
        const score = Math.min(sf.length, 14);
        if (score > bestScore) {
          bestScore = score;
          best = sf;
        }
      }
      if (!best) continue;
      const re = new RegExp(`(?<![\\p{L}])${escapeRegExp(best)}(?![\\p{L}-])`, 'giu');
      const front = u.text.replace(re, '_____');
      const blanks = (front.match(/_____/g) || []).length;
      if (blanks === 0 || blanks > 2) continue;
      if (!seenFront.has(front)) {
        seenFront.add(front);
        clozes.push({ kind: 'cloze', front: `Complète : ${front}`, back: `${best}\n\n${u.text}`, chunkId: c.id, quote: u.text.slice(0, 200) });
      }
    }
  }

  // Les définitions d'abord ; puis des textes à trous répartis sur l'ensemble du cours.
  const take = defs.slice(0, max);
  const room = max - take.length;
  if (room > 0 && clozes.length) {
    const k = Math.min(room, clozes.length);
    const step = clozes.length / k;
    for (let i = 0; i < k; i++) take.push(clozes[Math.floor(i * step)]);
  }
  return take;
}
