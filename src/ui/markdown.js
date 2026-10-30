// Rendu d'un Markdown léger (réponses de l'IA, fiches, sources) en éléments DOM.
// Aucun HTML n'est interprété : le texte devient du texte, les liens sont limités à http(s),
// les images sont ignorées. Les formules LaTeX ($…$, $$…$$) sont affichées par KaTeX (chargé à la demande).
import { h } from './dom.js';

// ------------------------------------------------------------------ KaTeX (chargé seulement si une formule apparaît)
let katexPromise;
export function ensureKatex() {
  katexPromise ??= (async () => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = new URL('../../vendor/katex/katex.min.css', import.meta.url).href;
    document.head.append(css);
    await import(new URL('../../vendor/katex/katex.min.js', import.meta.url).href);
    if (!globalThis.katex) throw new Error('KaTeX introuvable');
    return globalThis.katex;
  })().catch(() => {
    katexPromise = undefined;
    return null;
  });
  return katexPromise;
}

function renderMathInto(katex, el) {
  const tex = el.dataset.tex;
  try {
    katex.render(tex, el, { displayMode: el.dataset.display === '1', throwOnError: false, strict: 'ignore', trust: false, maxExpand: 500, output: 'htmlAndMathml' });
    el.classList.remove('math-raw');
    el.dataset.done = '1';
  } catch {
    /* on garde le texte brut */
  }
}

/** Remplace le texte brut des formules d'un élément par leur rendu mathématique. */
export async function upgradeMath(root) {
  const todo = [...root.querySelectorAll('.math:not([data-done])')];
  if (!todo.length) return;
  const katex = await ensureKatex();
  if (katex) for (const el of todo) renderMathInto(katex, el);
}

// ------------------------------------------------------------------ inline
const INLINE_PARTS = [
  /`(?<code>[^`\n]+)`/,
  /\$\$(?<dmath>[^$]+?)\$\$/,
  /\\\((?<pmath>.+?)\\\)/,
  /\\\[(?<bmath>.+?)\\\]/,
  /\$(?!\s)(?<math>[^$\n]+?)(?<!\s)\$(?!\d)/,
  /\[(?<ltext>[^\]\n]+)\]\((?<lurl>[^\s)]+)\)/,
  /\*\*(?<b1>.+?)\*\*/,
  /__(?<b2>.+?)__/,
  /(?<!\*)\*(?![\s*])(?<i1>.+?)(?<![\s*])\*(?!\*)/,
  /(?<![\p{L}\p{N}_])_(?![\s_])(?<i2>.+?)(?<![\s_])_(?![\p{L}\p{N}_])/,
  /~~(?<s>.+?)~~/,
  /\[(?<cite>\d{1,3})\](?!\()/,
  /(?<br>\n)/,
];
const INLINE_RE = new RegExp(INLINE_PARTS.map((p) => p.source).join('|'), 'gu');

function mathNode(tex, display, ctx) {
  const el = h('span.math.math-raw', { dataset: { tex: tex.trim(), display: display ? '1' : '0' } }, display ? tex.trim() : `$${tex.trim()}$`);
  if (ctx.math) ctx.maths.push(el);
  return display ? h('span.math-display', el) : el;
}

function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function inline(text, ctx) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const g = m.groups;
    if (g.code !== undefined) out.push(h('code', g.code));
    else if (g.dmath !== undefined) out.push(mathNode(g.dmath, true, ctx));
    else if (g.bmath !== undefined) out.push(mathNode(g.bmath, true, ctx));
    else if (g.pmath !== undefined) out.push(mathNode(g.pmath, false, ctx));
    else if (g.math !== undefined) out.push(mathNode(g.math, false, ctx));
    else if (g.ltext !== undefined) {
      const url = safeUrl(g.lurl);
      out.push(url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, inline(g.ltext, ctx)) : m[0]);
    } else if (g.b1 !== undefined || g.b2 !== undefined) out.push(h('strong', inline(g.b1 ?? g.b2, ctx)));
    else if (g.i1 !== undefined || g.i2 !== undefined) out.push(h('em', inline(g.i1 ?? g.i2, ctx)));
    else if (g.s !== undefined) out.push(h('del', inline(g.s, ctx)));
    else if (g.cite !== undefined) {
      const n = Number(g.cite);
      const ref = ctx.cite?.refs?.get(n);
      if (ref) {
        const where = [ref.sourceTitle, ref.label].filter(Boolean).join(' — ');
        out.push(
          h(
            'button.cite',
            { type: 'button', 'aria-label': `Voir l’extrait ${n}${where ? ` : ${where}` : ''}`, title: where || `Extrait ${n}`, onclick: () => ctx.cite.onOpen?.(ref, n) },
            String(n)
          )
        );
      } else out.push(m[0]);
    } else if (g.br !== undefined) out.push(ctx.breaks ? h('br') : ' ');
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ------------------------------------------------------------------ blocs
const FENCE = /^\s*(```|~~~)\s*[\w+-]*\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const LIST = /^(\s*)([-*•+]|\d{1,3}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/;
const isTableRow = (l) => (l.match(/\|/g) || []).length >= 2 && /^\s*\|/.test(l);

const indentOf = (s) => s.replace(/\t/g, '    ').length;

function startsBlock(lines, i) {
  const l = lines[i];
  return FENCE.test(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l) || LIST.test(l) || isTableRow(l) || /^\s*(\$\$|\\\[)/.test(l);
}

function splitCells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function buildList(items, from, to, ctx) {
  const base = items[from].indent;
  const ordered = items[from].ordered;
  const list = h(ordered ? 'ol' : 'ul');
  if (ordered && items[from].num > 1) list.start = items[from].num;
  let i = from;
  while (i < to) {
    const it = items[i];
    if (it.indent <= base && it.ordered !== ordered) break; // autre type de liste au même niveau
    let j = i + 1;
    while (j < to && items[j].indent > it.indent) j++;
    const li = h('li', inline(it.text, ctx));
    if (j > i + 1) li.append(buildList(items, i + 1, j, ctx).list);
    list.append(li);
    i = j;
  }
  return { list, next: i };
}

function blocks(lines, ctx, out, opts) {
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    // bloc de code
    if (FENCE.test(line)) {
      const code = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) code.push(lines[i++]);
      i++;
      out.append(h('pre', h('code', code.join('\n'))));
      continue;
    }

    // formule seule : $$ … $$ ou \[ … \]
    let m = /^\s*(\$\$|\\\[)(.*)$/.exec(line);
    if (m) {
      const close = m[1] === '$$' ? '$$' : '\\]';
      let rest = m[2];
      const buf = [];
      let done = false;
      if (rest.includes(close)) {
        buf.push(rest.slice(0, rest.indexOf(close)));
        done = true;
        i++;
      } else {
        if (rest.trim()) buf.push(rest);
        i++;
        while (i < lines.length) {
          const l = lines[i++];
          if (l.includes(close)) {
            buf.push(l.slice(0, l.indexOf(close)));
            done = true;
            break;
          }
          buf.push(l);
        }
      }
      if (done && buf.join(' ').trim()) {
        out.append(mathNode(buf.join('\n'), true, ctx));
        continue;
      }
      out.append(h('p', buf.join('\n'))); // formule jamais refermée : on garde le texte
      continue;
    }

    // titre
    m = HEADING.exec(line);
    if (m) {
      const level = Math.min(6, m[1].length + (opts.headingOffset ?? 2));
      out.append(h(`h${level}`, inline(m[2], ctx)));
      i++;
      continue;
    }

    if (HR.test(line)) {
      out.append(h('hr'));
      i++;
      continue;
    }

    // citation
    if (QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length && QUOTE.test(lines[i])) inner.push(lines[i++].replace(QUOTE, ''));
      const bq = h('blockquote');
      blocks(inner, ctx, bq, opts);
      out.append(bq);
      continue;
    }

    // tableau
    if (isTableRow(line) || (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]))) {
      const rows = [];
      let header = null;
      if (i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
        header = splitCells(line);
        i += 2;
      }
      while (i < lines.length && lines[i].trim() && (isTableRow(lines[i]) || lines[i].includes('|')) && !TABLE_SEP.test(lines[i])) rows.push(splitCells(lines[i++]));
      const table = h('table');
      if (header) table.append(h('thead', h('tr', header.map((c) => h('th', inline(c, ctx))))));
      table.append(h('tbody', rows.map((r) => h('tr', r.map((c) => h('td', inline(c, ctx)))))));
      out.append(table);
      continue;
    }

    // liste (avec sous-listes par indentation)
    if (LIST.test(line)) {
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          let k = i + 1;
          while (k < lines.length && !lines[k].trim()) k++;
          if (k < lines.length && LIST.test(lines[k])) {
            i = k;
            continue;
          }
          break;
        }
        const lm = LIST.exec(l);
        if (lm) {
          items.push({ indent: indentOf(lm[1]), ordered: /\d/.test(lm[2]), num: parseInt(lm[2], 10) || 1, text: lm[3] });
          i++;
        } else if (items.length && indentOf(l.match(/^\s*/)[0]) > items[items.length - 1].indent && !startsBlock(lines, i)) {
          items[items.length - 1].text += `\n${l.trim()}`; // suite d'un élément
          i++;
        } else break;
      }
      let at = 0;
      while (at < items.length) {
        const { list, next } = buildList(items, at, items.length, ctx);
        out.append(list);
        at = next > at ? next : at + 1;
      }
      continue;
    }

    // paragraphe
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) para.push(lines[i++]);
    out.append(h('p', inline(para.map((l) => l.trim()).join('\n'), ctx)));
  }
}

/**
 * @param {string} md
 * @param {{
 *   breaks?: boolean,                 retour à la ligne = saut de ligne (réponses de l'IA)
 *   math?: boolean,                   afficher les formules avec KaTeX (false pendant l'écriture en direct)
 *   headingOffset?: number,           « # » devient <h(1+offset)>  (défaut : h3)
 *   cite?: {refs: Map<number, {sourceTitle?: string, label?: string|null}>, onOpen?: (ref: object, n: number) => void}
 * }} [opts]
 * @returns {DocumentFragment}
 */
export function renderMarkdown(md, opts = {}) {
  const ctx = { breaks: !!opts.breaks, math: opts.math !== false, cite: opts.cite, maths: [] };
  const frag = document.createDocumentFragment();
  blocks(String(md ?? '').replace(/\r\n?/g, '\n').split('\n'), ctx, frag, opts);
  if (ctx.maths.length) {
    ensureKatex().then((katex) => {
      if (katex) for (const el of ctx.maths) renderMathInto(katex, el);
    });
  }
  return frag;
}

/** Texte brut d'un Markdown (copie, export, lecture à voix haute) : sans symboles ni numéros de citation. */
export function markdownToText(md) {
  return String(md ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\d{1,3}\](?!\()/g, '')
    .replace(/\[([^\]]+)\]\((?:https?:[^)]+)\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•+]\s+/gm, '• ')
    .replace(/(\*\*|__|~~)/g, '')
    .replace(/(?<![\w*])[*_](?=\S)([^*_\n]+?)(?<=\S)[*_](?![\w*])/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
