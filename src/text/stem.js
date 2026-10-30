// Racinisation « légère » du français, sur des mots déjà minuscules et sans accents.
// Objectif : que « dérivée », « dérivées », « dérivation », « dériver » se retrouvent
// entre eux dans la recherche. Ce n'est pas un analyseur linguistique complet.

const SUFFIXES = [
  'issements', 'issement', 'atrices', 'atrice', 'ateurs', 'ateur', 'ations', 'ation',
  'ements', 'ement', 'euses', 'euse', 'ences', 'ence', 'ances', 'ance', 'ables', 'able',
  'ibles', 'ible', 'ismes', 'isme', 'istes', 'iste', 'ives', 'ive', 'eurs', 'eur',
  'aires', 'aire', 'ions', 'ion', 'ites', 'ite', 'iques', 'ique', 'ers', 'er', 'ees', 'ee', 'ant',
];
SUFFIXES.sort((a, b) => b.length - a.length);

const MIN_STEM = 3;

export function stem(word) {
  let w = word;
  if (w.length <= 3 || /^\d+$/.test(w)) return w;

  // 1. pluriels
  if (w.length > 5 && w.endsWith('eaux')) w = w.slice(0, -1); // bateaux → bateau
  else if (w.length > 5 && w.endsWith('aux')) w = w.slice(0, -3) + 'al'; // animaux → animal
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  else if (w.length > 3 && w.endsWith('x')) w = w.slice(0, -1);

  // 2. suffixes de dérivation (le plus long d'abord)
  for (const suf of SUFFIXES) {
    if (w.length - suf.length >= MIN_STEM + (suf.length <= 2 ? 1 : 0) && w.endsWith(suf)) {
      w = w.slice(0, -suf.length);
      break;
    }
  }

  // 3. e muet final et féminins
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);

  return w;
}
