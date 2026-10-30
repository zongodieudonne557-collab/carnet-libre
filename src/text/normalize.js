// Normalisation de texte : accents, espaces, césures, découpage en mots.

/** Retire les accents et ligatures : « Électricité » → « Electricite ». */
export function foldAccents(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'AE');
}

/**
 * Nettoie un texte extrait d'un fichier (PDF, Word, photo…) :
 * espaces insécables, césures de fin de ligne, caractères invisibles.
 * Les sauts de ligne sont conservés.
 */
export function cleanText(input, { keepIndent = false } = {}) {
  if (!input) return '';
  let s = String(input);
  s = s.replace(/\r\n?/g, '\n');
  s = s.replace(/[      ]/g, ' ');
  s = s.replace(/[­​‌‍⁠﻿]/g, '');
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  // mot coupé en fin de ligne : « mathé-\nmatiques » → « mathématiques »
  s = s.replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2');
  if (keepIndent) {
    // true : on garde l'imbrication des listes (Word, PowerPoint : « ··- sous-point »)
    // 'all' : on garde toute l'indentation (texte brut, code, pseudo-code), plafonnée à 8 espaces
    const all = keepIndent === 'all';
    s = s
      .split('\n')
      .map((line) => {
        if (all) line = line.replace(/^\t+/, (t) => '  '.repeat(t.length));
        const indent = (all ? /^ +/ : /^ +(?=[-*+] )/).exec(line)?.[0].slice(0, 8) ?? '';
        return indent + line.replace(/^ +/, '').replace(/[ \t]+/g, ' ').trim();
      })
      .join('\n');
    s = s.replace(/\n{3,}/g, '\n\n');
    return s.replace(/^\n+/, '').trimEnd();
  }
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/ ?\n ?/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

const WORD_RE = /[\p{L}\p{N}]+/gu;

/** Découpe en mots minuscules sans accents (pas de filtrage, pas de racinisation). */
export function words(text) {
  if (!text) return [];
  const out = [];
  const folded = foldAccents(String(text)).toLowerCase();
  let m;
  WORD_RE.lastIndex = 0;
  while ((m = WORD_RE.exec(folded))) out.push(m[0]);
  return out;
}

/** Compte approximatif de « jetons » (≈ 1 jeton pour 3,6 caractères en français). */
export function estimateTokens(chars) {
  return Math.ceil((chars || 0) / 3.6);
}

/** Coupe proprement un texte à `max` caractères en s'arrêtant sur une fin de phrase ou un espace. */
export function truncateNicely(text, max) {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const cut = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('\n'), slice.lastIndexOf('? '), slice.lastIndexOf('! '));
  if (cut + 1 >= max * 0.6) return slice.slice(0, cut + 1).trim() + ' […]';
  const sp = slice.lastIndexOf(' ');
  return (sp > max * 0.6 ? slice.slice(0, sp) : slice).trim() + ' […]';
}
