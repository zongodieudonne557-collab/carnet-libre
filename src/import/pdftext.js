// Reconstruction du texte d'un PDF à partir des fragments fournis par PDF.js :
// lignes, paragraphes, titres, listes, exposants/indices, en-têtes et pieds de page répétés.
//
// Module pur (aucune dépendance à PDF.js) : il est testé avec des fragments synthétiques
// puis avec de vrais PDF. On garde l'ordre du flux du PDF (colonne après colonne pour
// les documents à deux colonnes) et on ne regroupe que les fragments situés sur la
// même ligne de base : on ne mélange donc jamais deux colonnes.
//
// Coordonnées : origine en haut à gauche, y vers le bas (après transformation de la page).

/**
 * @typedef {{str: string, x: number, y: number, w: number, size: number, dx?: number, dy?: number, vertical?: boolean}} Frag
 *   (dx, dy : direction de lecture du fragment ; absents = texte horizontal)
 * @typedef {{text: string, x0: number, x1: number, y: number, size: number, chars: number}} Line
 */

const LIGATURES = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st', 'Ĳ': 'IJ', 'ĳ': 'ij' };
const LIGATURE_RE = /[ﬀ-ﬆĲĳ]/g;

const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎', n: 'ₙ', i: 'ᵢ', j: 'ⱼ', x: 'ₓ' };

/** Convertit un fragment en exposant / indice Unicode ; sinon ^(…) / _(…). */
function toScript(str, map, mark) {
  const s = str.trim();
  if (!s || !/[\p{L}\p{N}]/u.test(s)) return str; // astérisque, dague… : on laisse tel quel
  let out = '';
  for (const ch of s) {
    const m = map[ch];
    if (!m) return `${mark}(${s})`;
    out += m;
  }
  return out;
}

const median = (arr) => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const h = a.length >> 1;
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
};
const percentile = (arr, p) => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
};
const round05 = (n) => Math.round(n * 2) / 2;

// ------------------------------------------------------------------ 0. orientation de la page
const horizontal = (f) => f.vertical !== true && (f.dx ?? 1) > 0 && Math.abs(f.dy ?? 0) <= 0.35 * (f.dx ?? 1);

/**
 * Redresse une page dont le texte est écrit à la verticale (paysage dessiné dans une page portrait,
 * sans attribut de rotation). Les fragments portent leur direction de lecture (dx, dy) ;
 * sans direction, le texte est supposé horizontal.
 * @param {Frag[]} frags
 * @param {number} W largeur de la page
 * @param {number} H hauteur de la page
 * @returns {{frags: Frag[], width: number, height: number}}
 */
export function orient(frags, W, H) {
  let flat = 0;
  let down = 0;
  let up = 0;
  for (const f of frags) {
    const n = (f.str || '').trim().length;
    if (!n || f.vertical === true) continue;
    const dx = f.dx ?? 1;
    const dy = f.dy ?? 0;
    if (horizontal(f)) flat += n;
    else if (Math.abs(dx) <= 0.35 * Math.abs(dy)) (dy > 0 ? (down += n) : (up += n));
  }
  const total = flat + down + up;
  if (!total || flat >= 0.4 * total || (down < 0.6 * total && up < 0.6 * total) || !(W > 0 && H > 0)) return { frags, width: W, height: H };
  const cw = down >= up; // texte qui descend = page tournée de 90° dans le sens horaire
  const out = frags.map((f) => {
    const dx = f.dx ?? 1;
    const dy = f.dy ?? 0;
    const wantsDown = cw && Math.abs(dx) <= 0.35 * Math.abs(dy) && dy > 0;
    const wantsUp = !cw && Math.abs(dx) <= 0.35 * Math.abs(dy) && dy < 0;
    if (!wantsDown && !wantsUp) return { ...f, vertical: true };
    return cw
      ? { ...f, x: f.y, y: W - f.x, dx: 1, dy: 0 } // rotation de l'écran de 90° antihoraire
      : { ...f, x: H - f.y, y: f.x, dx: 1, dy: 0 }; // rotation de 90° horaire
  });
  return { frags: out, width: H, height: W };
}

// ------------------------------------------------------------------ 1. fragments → lignes
/**
 * @param {Frag[]} frags dans l'ordre du flux PDF
 * @returns {Line[]}
 */
export function buildLines(frags) {
  const lines = [];
  let cur = null;
  const close = () => {
    if (!cur) return;
    cur.text = cur.text.replace(/­/g, '').replace(/ {2,}/g, ' ').trim();
    if (cur.text) {
      cur.size = dominantSize(cur.sizes) || cur.size;
      lines.push(cur);
    }
    cur = null;
  };

  for (const f of frags) {
    if (!horizontal(f) || !Number.isFinite(f.x) || !Number.isFinite(f.y)) continue;
    const str = f.str ?? '';
    if (!str) continue;
    const size = f.size > 0 ? f.size : 10;
    // largeur inconnue (police manquante) : estimation grossière plutôt qu'un mot coupé en lettres
    const w = f.w > 0 ? f.w : str.length * size * 0.5;

    if (!cur) {
      if (!str.trim()) continue;
      cur = { text: str, x0: f.x, x1: f.x + w, y: f.y, size, sizes: new Map(), chars: 0 };
      addSize(cur, size, str.length);
      continue;
    }

    const dy = f.y - cur.y; // > 0 : plus bas que la ligne de base
    const ref = cur.size;
    const forwards = f.x >= cur.x1 - 0.6 * ref;
    const gap = f.x - cur.x1;

    if (!str.trim()) {
      // espace isolé : simple séparateur s'il est sur la ligne
      if (Math.abs(dy) <= 0.3 * ref && forwards && !cur.text.endsWith(' ')) {
        cur.text += ' ';
        cur.x1 = Math.max(cur.x1, f.x + w);
      }
      continue;
    }

    // Un fragment plus petit, surélevé ou abaissé, collé à la fin de la ligne = exposant / indice.
    // (À tester avant « même ligne de base » : un indice n'est abaissé que de ~0,2 corps.)
    // (un exposant touche le caractère qui précède et reste court : jamais après une espace, jamais une phrase)
    const small = size <= 0.86 * ref && str.trim().length <= 6 && !cur.text.endsWith(' ') && !str.startsWith(' ');
    const near = forwards && gap <= 0.8 * ref;
    const isSup = small && near && dy < -0.12 * ref && dy > -0.8 * ref;
    const isSub = small && near && dy > 0.1 * ref && dy < 0.55 * ref;
    const sameBaseline = Math.abs(dy) <= 0.3 * ref && forwards;

    if (isSup || isSub) {
      cur.text += isSup ? toScript(str, SUP, '^') : toScript(str, SUB, '_');
      cur.x1 = Math.max(cur.x1, f.x + w);
    } else if (sameBaseline) {
      let sep = '';
      if (!(cur.text.endsWith(' ') || str.startsWith(' '))) {
        if (gap > 3 * ref) sep = ' | '; // grand vide : colonnes d'un tableau
        else if (gap > 0.16 * ref) sep = ' ';
      }
      cur.text += sep + str;
      cur.x1 = Math.max(cur.x1, f.x + w);
      addSize(cur, size, str.length);
    } else {
      close();
      cur = { text: str, x0: f.x, x1: f.x + w, y: f.y, size, sizes: new Map(), chars: 0 };
      addSize(cur, size, str.length);
    }
  }
  close();
  // une puce restée seule sur sa ligne (décalage de ligne de base) est rattachée au texte qui la suit
  for (let i = 0; i < lines.length - 1; i++) {
    const b = lines[i];
    const t = lines[i + 1];
    if (LONE_BULLET.test(b.text) && Math.abs(t.y - b.y) <= 0.7 * Math.max(b.size, t.size) && t.x0 >= b.x1 - 0.5 * b.size) {
      lines.splice(i, 2, { ...t, text: `${b.text} ${t.text}`, x0: Math.min(b.x0, t.x0), chars: 0 });
    }
  }
  for (const l of lines) {
    l.text = l.text.replace(LIGATURE_RE, (c) => LIGATURES[c] || c);
    l.chars = l.text.length;
    delete l.sizes;
  }
  return lines;
}
const LONE_BULLET = /^(?:[•▪◦‣∙·●○■□▫*]|[]|[-–—])$/u;

function addSize(line, size, n) {
  const k = round05(size);
  line.sizes.set(k, (line.sizes.get(k) || 0) + n);
}
function dominantSize(sizes) {
  let best = 0;
  let bestN = -1;
  for (const [s, n] of sizes) if (n > bestN) [best, bestN] = [s, n];
  return best;
}

// ------------------------------------------------------------------ 2. statistiques de page / document
function bodySizeOf(pages) {
  const hist = new Map();
  for (const p of pages) for (const l of p.lines) hist.set(round05(l.size), (hist.get(round05(l.size)) || 0) + l.chars);
  return dominantSize(hist) || 10;
}

/** Interligne typique de la page (médiane des écarts plausibles entre lignes de base). */
function leadOf(lines, body) {
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i].y - lines[i - 1].y;
    if (g > 0.7 * body && g < 2.4 * body) gaps.push(g);
  }
  return gaps.length >= 3 ? median(gaps) : 1.25 * body;
}

// ------------------------------------------------------------------ 3. en-têtes, pieds de page, numéros
const PAGE_NUMBER = /^(?:page\s*)?[-–—‒]?\s*\d{1,4}\s*(?:(?:\/|sur|of)\s*\d{1,4})?\s*[-–—‒]?$/i;
const repeatKey = (t) => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

/** Retire (en place) les numéros de page et les lignes répétées en haut / bas de page. Renvoie leur nombre. */
export function stripRepeated(pages) {
  const zoneOf = (l, h) => (!h ? null : l.y < h * 0.11 ? 'top' : l.y > h * 0.89 ? 'bottom' : null);
  const seen = new Map();
  pages.forEach((p, i) => {
    for (const l of p.lines) {
      if (!zoneOf(l, p.height)) continue;
      const k = repeatKey(l.text);
      if (!seen.has(k)) seen.set(k, new Set());
      seen.get(k).add(i);
    }
  });
  const need = Math.max(3, Math.ceil(pages.length * 0.4));
  let removed = 0;
  for (const p of pages) {
    p.lines = p.lines.filter((l) => {
      if (!zoneOf(l, p.height)) return true;
      const drop = PAGE_NUMBER.test(l.text) || (seen.get(repeatKey(l.text))?.size ?? 0) >= need;
      if (drop) removed++;
      return !drop;
    });
  }
  return removed;
}

// ------------------------------------------------------------------ 4. titres
const BULLET = /^(?:[•▪◦‣∙·●○■□▫*]|[]|[-–—](?=\s))\s*/u;
const NUMBERED = /^(?:\d{1,2}[.)]|[a-z][.)]|\([a-z0-9]\)|[ivx]{1,4}[.)])\s+/i;

function isUpperTitle(text) {
  const letters = text.replace(/[^\p{L}]/gu, '');
  return letters.length >= 4 && text.length <= 70 && text.split(/\s+/).length <= 8 && letters === letters.toUpperCase() && !/[.;,]$/.test(text);
}

/** Tailles de titres (du plus grand au plus petit), regroupées à 8 % près. */
function headingSizes(pages, body) {
  const sizes = new Map();
  for (const p of pages) {
    for (const l of p.lines) {
      if (l.size >= 1.18 * body && l.chars <= 160) sizes.set(round05(l.size), (sizes.get(round05(l.size)) || 0) + 1);
    }
  }
  const sorted = [...sizes.keys()].sort((a, b) => b - a);
  const groups = [];
  for (const s of sorted) {
    const g = groups[groups.length - 1];
    if (g && s >= g.min * 0.92) g.min = Math.min(g.min, s);
    else groups.push({ max: s, min: s });
  }
  return (size) => {
    const k = round05(size);
    for (let i = 0; i < groups.length; i++) if (k <= groups[i].max && k >= groups[i].min * 0.99) return Math.min(i + 1, 3);
    return 0;
  };
}

// ------------------------------------------------------------------ 5. lignes → paragraphes
const END_SENTENCE = /[.!?…:;»)"”]$/;

/** Recolle deux lignes d'un même paragraphe (répare les mots coupés : « mathé- » + « matiques »). */
export function joinLines(prev, next) {
  if (/\p{L}[-‐‑]$/u.test(prev) && /^\p{Ll}/u.test(next)) return prev.slice(0, -1) + next;
  return `${prev} ${next}`;
}
const join = joinLines;

function layoutPage(page, ctx) {
  const { lines } = page;
  if (!lines.length) return [];
  const lead = leadOf(lines, ctx.body);
  const widthLines = lines.filter((l) => l.chars >= 30);
  const left = percentile((widthLines.length ? widthLines : lines).map((l) => l.x0), 0.15);
  const right = percentile((widthLines.length ? widthLines : lines).map((l) => l.x1), 0.85);
  const span = Math.max(1, right - left);

  const blocks = [];
  let cur = null;
  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const prev = lines[i - 1];
    const next = lines[i + 1];
    const gapBefore = prev ? ln.y - prev.y : Infinity;
    const gapAfter = next ? next.y - ln.y : Infinity;

    // une ligne qui commence par une puce n'est jamais un titre (la puce peut être en plus gros corps)
    const startsWithBullet = BULLET.test(ln.text);
    let level = startsWithBullet ? 0 : ctx.levelOf(ln.size);
    if (!level && !startsWithBullet && isUpperTitle(ln.text) && gapBefore > 1.25 * lead && gapAfter > 1.25 * lead) level = 3;
    if (level && ln.chars > 160) level = 0;

    if (level) {
      // titre sur plusieurs lignes : même taille, interligne serré
      if (cur?.kind === 'h' && cur.level === level && Math.abs(ln.size - cur.size) < 0.6 && gapBefore <= 1.6 * Math.max(lead, 1.2 * ln.size)) {
        cur.text = join(cur.text, ln.text);
      } else {
        flush();
        cur = { kind: 'h', level, text: ln.text, size: ln.size };
      }
      continue;
    }

    const bullet = BULLET.exec(ln.text);
    const numbered = !bullet && NUMBERED.exec(ln.text);
    if (bullet || numbered) {
      flush();
      const body = bullet ? ln.text.slice(bullet[0].length).trim() : ln.text;
      cur = { kind: 'li', text: body, x0: ln.x0, size: ln.size, last: ln };
      continue;
    }

    const prevEnded = cur ? END_SENTENCE.test(cur.text) : true;
    const shortPrev = prev ? prev.x1 < left + span * 0.82 : false;
    const indented = ln.x0 > left + 1.3 * ln.size;
    const sizeJump = cur && Math.abs(ln.size - (cur.size || ln.size)) > 0.12 * ln.size;
    const listCont = cur?.kind === 'li' && ln.x0 > cur.x0 - 0.2 * ln.size && gapBefore <= 1.45 * lead;

    const newPara =
      !cur ||
      cur.kind === 'h' ||
      gapBefore > 1.5 * lead ||
      sizeJump ||
      (!listCont && prevEnded && (shortPrev || indented)) ||
      (cur.kind === 'li' && !listCont);

    if (newPara) {
      flush();
      cur = { kind: 'p', text: ln.text, x0: ln.x0, size: ln.size, last: ln };
    } else {
      cur.text = join(cur.text, ln.text);
      cur.last = ln;
    }
  }
  flush();
  return blocks;
}

function blocksToMarkdown(blocks) {
  let out = '';
  let prev = null;
  for (const b of blocks) {
    const t = b.text.replace(/ {2,}/g, ' ').trim();
    if (!t) continue;
    const line = b.kind === 'h' ? `${'#'.repeat(b.level)} ${t}` : b.kind === 'li' && !NUMBERED.test(t) ? `- ${t}` : t;
    // les éléments d'une même liste se suivent sans ligne vide
    out += (prev === null ? '' : prev.kind === 'li' && b.kind === 'li' ? '\n' : '\n\n') + line;
    prev = b;
  }
  return out;
}

// ------------------------------------------------------------------ 6. qualité du texte
const COMMON = new Set(
  ('le la les de des du un une et en est que qui dans pour sur au aux ce se ne pas plus par avec son sa ses ou où mais donc car si on il elle ils nous vous sont être avoir fait peut cette ces leur leurs ' +
    'the of and to in is that for it as with are by this from or an be at on not which').split(' ')
);

/** Indicateurs de qualité d'un texte extrait (pour décider s'il faut passer par l'OCR). */
export function textQuality(text) {
  const s = String(text ?? '');
  const nonSpace = s.replace(/\s/g, '');
  if (!nonSpace.length) return { chars: 0, weird: 0, common: 0, vowels: 0, score: 0, garbled: false };
  const weird = (nonSpace.match(/[�-\u0000-\u0008\u000e-\u001f\u0080-\u009f]/g) || []).length / nonSpace.length;
  const letters = s.match(/\p{L}/gu) || [];
  const vowelCount = letters.filter((c) => /[aeiouyàâäéèêëîïôöùûüœ]/i.test(c)).length;
  const vowels = letters.length ? vowelCount / letters.length : 0;
  const tokens = s.toLowerCase().match(/\p{L}{2,}/gu) || [];
  const common = tokens.length ? tokens.filter((t) => COMMON.has(t)).length / tokens.length : 0;
  let garbled = weird > 0.08;
  if (!garbled && letters.length >= 120 && common < 0.03 && (vowels < 0.22 || vowels > 0.65)) garbled = true;
  const score = Math.min(1, common * 2.5) * 0.6 + (1 - Math.min(1, weird * 5)) * 0.3 + (vowels > 0.3 && vowels < 0.55 ? 0.1 : 0);
  return { chars: nonSpace.length, weird, common, vowels, score, garbled };
}

// ------------------------------------------------------------------ 7. point d'entrée
/**
 * @param {{pageNumber: number, width?: number, height?: number, frags: Frag[]}[]} input
 * @param {{stripRepeated?: boolean}} [opts]
 * @returns {{pages: {pageNumber: number, text: string, chars: number, garbled: boolean}[], stats: {body: number, removed: number}}}
 */
export function reconstruct(input, opts = {}) {
  const pages = input.map((p) => {
    const o = orient(p.frags || [], p.width || 0, p.height || 0);
    return { pageNumber: p.pageNumber, height: o.height || 0, lines: buildLines(o.frags) };
  });
  const body = bodySizeOf(pages);
  const removed = opts.stripRepeated === false ? 0 : stripRepeated(pages);
  const levelOf = headingSizes(pages, body);
  const ctx = { body, levelOf };
  const out = pages.map((p) => {
    const text = blocksToMarkdown(layoutPage(p, ctx));
    const q = textQuality(text);
    return { pageNumber: p.pageNumber, text, chars: q.chars, garbled: q.garbled };
  });
  return { pages: out, stats: { body, removed } };
}

// ------------------------------------------------------------------ 8. sections étiquetées « p. 3 · Titre »
const HEADING_LINE = /^(#{1,3})\s+(.+?)\s*$/;
const trimLabel = (s) => (s.length > 48 ? `${s.slice(0, 47).trimEnd()}…` : s);

/**
 * Découpe le texte de chaque page selon ses titres. Le titre en cours est reporté d'une page
 * à l'autre : « p. 4 · Les organites » même si le titre figure en bas de la page précédente.
 * @param {{pageNumber: number, text: string}[]} pages
 * @returns {{label: string, text: string}[]}
 */
export function toSections(pages) {
  const out = [];
  let carry = '';
  for (const p of pages) {
    if (!p.text.trim()) continue;
    let heading = carry;
    let buf = [];
    let pendingHeading = '';
    const flush = () => {
      const body = buf.join('\n').trim();
      if (body) {
        const label = `p. ${p.pageNumber}${heading ? ` · ${trimLabel(heading)}` : ''}`;
        out.push({ label, text: pendingHeading ? `${pendingHeading}\n\n${body}` : body });
      }
      buf = [];
      pendingHeading = '';
    };
    for (const line of p.text.split('\n')) {
      const m = HEADING_LINE.exec(line);
      if (m) {
        if (buf.join('').trim()) flush();
        heading = m[2];
        pendingHeading = pendingHeading ? `${pendingHeading}\n${line}` : line;
        carry = heading;
      } else buf.push(line);
    }
    // titre seul en bas de page : son texte suit sur la page suivante
    if (buf.join('').trim()) flush();
    else if (pendingHeading) {
      carry = heading;
      out.push({ label: `p. ${p.pageNumber} · ${trimLabel(heading)}`, text: pendingHeading });
    }
  }
  return out;
}
