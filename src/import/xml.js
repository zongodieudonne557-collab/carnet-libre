// Lecteur XML minimal, sûr et sans dépendance, pour les fichiers Word et PowerPoint (OOXML).
// - fonctionne dans le navigateur ET dans Node (tests) ;
// - ne traite ni DTD ni entités personnalisées (donc ni XXE ni « bombe XML ») ;
// - itératif : un document très imbriqué ne peut pas faire exploser la pile.

const MAX_DEPTH = 300;
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e[0] !== '#') return NAMED[e];
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try {
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    } catch {
      return m;
    }
  });
}

const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Fin d'une balise ouvrante, en ignorant les « > » dans les valeurs entre guillemets. */
function tagEnd(src, from) {
  let quote = '';
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return -1;
}

/** Fin d'une déclaration `<!…>` (DOCTYPE compris, avec son sous-ensemble interne `[ … ]`). */
function declEnd(src, from) {
  let quote = '';
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '[') depth++;
    else if (c === ']') depth = Math.max(0, depth - 1);
    else if (c === '>' && depth === 0) return i;
  }
  return -1;
}

/**
 * @typedef {{name: string, attrs: Record<string,string>, children: (XmlNode|string)[]}} XmlNode
 * @param {string} src
 * @returns {XmlNode} nœud racine fictif ; l'élément du document est dans `.children`
 */
export function parseXML(src) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      top().children.push(decodeEntities(src.slice(i)));
      break;
    }
    if (lt > i) top().children.push(decodeEntities(src.slice(i, lt)));
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9);
      top().children.push(src.slice(lt + 9, e < 0 ? n : e));
      i = e < 0 ? n : e + 3;
    } else if (src.startsWith('<?', lt)) {
      const e = src.indexOf('?>', lt + 2);
      i = e < 0 ? n : e + 2;
    } else if (src.startsWith('<!', lt)) {
      // <!DOCTYPE …> : ignoré en entier, jamais interprété (aucune entité personnalisée n'est définie)
      const e = declEnd(src, lt + 2);
      i = e < 0 ? n : e + 1;
    } else {
      const gt = tagEnd(src, lt + 1);
      if (gt < 0) break;
      const inner = src.slice(lt + 1, gt);
      i = gt + 1;
      if (inner[0] === '/') {
        const name = inner.slice(1).trim();
        for (let k = stack.length - 1; k > 0; k--) {
          if (stack[k].name === name) {
            stack.length = k;
            break;
          }
        }
        continue;
      }
      const selfClose = inner.endsWith('/');
      const body = selfClose ? inner.slice(0, -1) : inner;
      const sp = body.search(/\s/);
      const name = sp < 0 ? body : body.slice(0, sp);
      const attrs = {};
      if (sp >= 0) {
        ATTR.lastIndex = 0;
        for (let m = ATTR.exec(body); m; m = ATTR.exec(body)) attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? '');
      }
      const node = { name, attrs, children: [] };
      top().children.push(node);
      if (!selfClose) {
        if (stack.length >= MAX_DEPTH) throw new Error('Fichier XML trop imbriqué.');
        stack.push(node);
      }
    }
  }
  return root;
}

// ---------------------------------------------------------------- aides de lecture
export const isNode = (x) => typeof x === 'object' && x !== null;

/** Premier enfant direct de ce nom. */
export function child(node, name) {
  if (!node) return undefined;
  for (const c of node.children) if (isNode(c) && c.name === name) return c;
  return undefined;
}

/** Tous les enfants directs (éléments) ; filtrés par nom si fourni. */
export function kids(node, name) {
  if (!node) return [];
  return node.children.filter((c) => isNode(c) && (!name || c.name === name));
}

/** Parcours en profondeur (ordre du document) de tous les descendants éléments. */
export function* descendants(node) {
  const stack = [];
  for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  while (stack.length) {
    const c = stack.pop();
    if (!isNode(c)) continue;
    yield c;
    for (let i = c.children.length - 1; i >= 0; i--) stack.push(c.children[i]);
  }
}

export function findAll(node, name) {
  const out = [];
  for (const d of descendants(node)) if (d.name === name) out.push(d);
  return out;
}

export function find(node, name) {
  for (const d of descendants(node)) if (d.name === name) return d;
  return undefined;
}

/** Texte brut de tout le sous-arbre. */
export function textOf(node) {
  if (!isNode(node)) return String(node ?? '');
  let s = '';
  for (const c of node.children) s += isNode(c) ? textOf(c) : c;
  return s;
}
