// Formats « texte » : fichiers .txt / .md, HTML, sous-titres (.srt / .vtt) et LaTeX (.tex).
import { cleanText } from '../text/normalize.js';

// ------------------------------------------------------------------ encodage
/** Décode des octets en texte : BOM UTF-8/UTF-16, UTF-8 strict, sinon Windows-1252 (vieux fichiers Windows). */
export function decodeText(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(b.subarray(3)), encoding: 'utf-8' };
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'utf-16le' };
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'utf-16be' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(b), encoding: 'windows-1252' };
  }
}

/** Retire l'en-tête YAML d'un fichier Markdown (--- … ---) et en tire le titre. */
export function stripFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { text, title: '' };
  const t = /^title\s*:\s*["']?(.+?)["']?\s*$/im.exec(m[1]);
  return { text: text.slice(m[0].length), title: t ? t[1] : '' };
}

// ------------------------------------------------------------------ sous-titres (.srt / .vtt)
const CUE_TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
const toSeconds = (h, m, s, ms) => Number(h || 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'", '&apos;': "'" };

/**
 * Transforme des sous-titres (transcription d'une vidéo de cours) en texte suivi :
 * horodatages et balises retirés, répétitions des sous-titres « défilants » supprimées,
 * paragraphes coupés aux pauses.
 */
export function subtitlesToText(raw) {
  const text = String(raw ?? '').replace(/\r/g, '').replace(/^\uFEFF/, '');
  const cues = [];
  let prevLines = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const ti = lines.findIndex((l) => CUE_TIME.test(l));
    if (ti < 0) continue; // en-tête WEBVTT, NOTE, STYLE, numéro seul…
    const m = CUE_TIME.exec(lines[ti]);
    const start = toSeconds(m[1], m[2], m[3], m[4]);
    const end = toSeconds(m[5], m[6], m[7], m[8]);
    const body = lines
      .slice(ti + 1)
      .map((l) =>
        l
          .replace(/<[^>]*>/g, '')
          .replace(/\{\\an?\d+\}/g, '')
          .replace(/&(?:amp|lt|gt|nbsp|quot|#39|apos);/g, (e) => ENTITIES[e])
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(Boolean);
    const fresh = body.filter((l) => !prevLines.includes(l));
    prevLines = body;
    if (fresh.length) cues.push({ start, end, text: fresh.join(' ') });
  }
  const paragraphs = [];
  let cur = '';
  let lastEnd = 0;
  for (const c of cues) {
    const pause = c.start - lastEnd > 3.5;
    if (cur && (pause || (cur.length > 700 && /[.!?…]$/.test(cur)))) {
      paragraphs.push(cur);
      cur = '';
    }
    cur = cur ? `${cur} ${c.text}` : c.text;
    lastEnd = c.end;
  }
  if (cur) paragraphs.push(cur);
  return paragraphs.join('\n\n');
}

// ------------------------------------------------------------------ LaTeX (.tex) → Markdown
const ACCENT = {
  "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' },
  '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' },
  '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' },
  '"': { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü' },
};
const ENV_LABEL = {
  definition: 'Définition', defi: 'Définition', theorem: 'Théorème', theoreme: 'Théorème', thm: 'Théorème', proposition: 'Proposition', prop: 'Proposition',
  lemma: 'Lemme', lemme: 'Lemme', corollary: 'Corollaire', corollaire: 'Corollaire', proof: 'Preuve', preuve: 'Preuve', demonstration: 'Démonstration',
  remark: 'Remarque', remarque: 'Remarque', example: 'Exemple', exemple: 'Exemple', exercise: 'Exercice', exercice: 'Exercice', propriete: 'Propriété', property: 'Propriété',
};

function latexText(s) {
  return s
    .replace(/\\(['`^"])\{?([aeiouAEIOU])\}?/g, (m, acc, ch) => ACCENT[acc][ch] ?? ch)
    .replace(/\\c\s*\{?([cC])\}?/g, (m, ch) => (ch === 'c' ? 'ç' : 'Ç'))
    .replace(/\\oe\b\s*/g, 'œ')
    .replace(/\\OE\b\s*/g, 'Œ')
    .replace(/\\ae\b\s*/g, 'æ')
    .replace(/\\og\b\s*/g, '« ')
    .replace(/\\fg\b\s*/g, ' »')
    .replace(/\\(?:ldots|dots)\b\s*/g, '… ')
    .replace(/\\textbf\{([^{}]*)\}/g, '**$1**')
    .replace(/\\(?:emph|textit|textsl)\{([^{}]*)\}/g, '*$1*')
    .replace(/\\(?:texttt|underline|textsc|textrm|textsf|mbox|text)\{([^{}]*)\}/g, '$1')
    .replace(/\\\\(?:\[[^\]]*\])?/g, '\n')
    .replace(/\\([%&_#$])/g, '$1')
    .replace(/\\(?:,|;|:|!|\s)/g, ' ')
    .replace(/(^|[^\\])~/g, '$1 ')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/``/g, '“')
    .replace(/''/g, '”');
}

/** Conversion simple et sûre d'un cours LaTeX : titres, listes, théorèmes, accents, formules conservées. */
export function latexToMarkdown(src) {
  let s = String(src ?? '').replace(/\r/g, '');
  const title = /\\title\{([^{}]*)\}/.exec(s)?.[1]?.trim() || '';
  const begin = s.indexOf('\\begin{document}');
  if (begin >= 0) s = s.slice(begin + '\\begin{document}'.length);
  s = s.replace(/\\end\{document\}[\s\S]*$/, '');
  s = s.replace(/(^|[^\\])%.*$/gm, '$1'); // commentaires
  s = s.replace(/\\(?:label|cite[tp]?|ref|eqref|index|vspace\*?|hspace\*?|newpage|clearpage|pagebreak|noindent|centering|maketitle|tableofcontents|bigskip|medskip|smallskip)\b(?:\[[^\]]*\])?(?:\{[^{}]*\})?/g, '');

  const hasChapter = /\\chapter\b/.test(s);
  const lvl = (n) => '#'.repeat(Math.min(3, Math.max(1, n - (hasChapter ? 0 : 1))));
  s = s
    .replace(/\\chapter\*?\{([^{}]*)\}/g, '\n\n# $1\n\n')
    .replace(/\\section\*?\{([^{}]*)\}/g, (m, t) => `\n\n${lvl(2)} ${t}\n\n`)
    .replace(/\\subsection\*?\{([^{}]*)\}/g, (m, t) => `\n\n${lvl(3)} ${t}\n\n`)
    .replace(/\\(?:subsubsection|paragraph)\*?\{([^{}]*)\}/g, '\n\n**$1**\n\n');

  // environnements de cours : « Définition (Nom). »
  s = s.replace(/\\begin\{([A-Za-zéÉ]+)\*?\}(?:\[([^\]]*)\])?[ \t]*\n?[ \t]*/g, (m, env, opt) => {
    const key = env.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (ENV_LABEL[key]) return `\n\n**${ENV_LABEL[key]}${opt ? ` (${opt})` : ''}.** `;
    if (/^(itemize|enumerate|description)$/.test(key)) return '\n';
    if (/^(equation|displaymath)$/.test(key)) return '\n$$';
    if (/^(align|gather|multline|eqnarray)$/.test(key)) return '\n$$\\begin{aligned}';
    if (/^(center|flushleft|flushright|quote|quotation|figure|table|tabular|minipage)$/.test(key)) return '\n';
    return m;
  });
  s = s.replace(/\\end\{([A-Za-zéÉ]+)\*?\}/g, (m, env) => {
    const key = env.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (ENV_LABEL[key]) return '\n\n';
    if (/^(equation|displaymath)$/.test(key)) return '$$\n';
    if (/^(align|gather|multline|eqnarray)$/.test(key)) return '\\end{aligned}$$\n';
    if (/^(itemize|enumerate|description|center|flushleft|flushright|quote|quotation|figure|table|tabular|minipage)$/.test(key)) return '\n';
    return m;
  });
  // (fonctions de remplacement : dans une chaîne de remplacement, « $$ » signifierait un seul « $ »)
  s = s.replace(/\\\[/g, () => '\n$$').replace(/\\\]/g, () => '$$\n').replace(/\\\(/g, () => '$').replace(/\\\)/g, () => '$');
  s = s.replace(/\s*\\item\s*(?:\[([^\]]*)\])?\s*/g, (m, lab) => `\n- ${lab ? `**${lab}** ` : ''}`);

  // le texte courant est converti, les formules ($…$ et $$…$$) sont laissées intactes
  const parts = s.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g);
  s = parts.map((p, i) => (i % 2 ? p : latexText(p))).join('');
  return { title: latexText(title).trim(), text: cleanText(s, { keepIndent: true }) };
}

// ------------------------------------------------------------------ HTML → texte structuré (navigateur)
const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'main', 'header', 'blockquote', 'figure', 'figcaption', 'dl', 'details', 'summary', 'fieldset', 'address', 'center', 'hr', 'caption']);
const DROP = 'script,style,noscript,template,iframe,object,embed,svg,canvas,audio,video,nav,footer,aside,form,button,select,input,textarea,[hidden],.katex-html,.sr-only';

class Out {
  parts = [];
  last = '\n';
  raw(s) {
    if (!s) return;
    this.parts.push(s);
    this.last = s;
  }
  text(s) {
    if (/\s$/.test(this.last) && s.startsWith(' ')) s = s.slice(1);
    if (/\n$/.test(this.last)) s = s.trimStart();
    this.raw(s);
  }
  block() {
    this.raw('\n\n');
  }
  line() {
    this.raw('\n');
  }
}

function walk(node, out, depth) {
  if (node.nodeType === 3) return out.text(node.nodeValue.replace(/\s+/g, ' '));
  if (node.nodeType !== 1) return;
  const tag = node.localName;
  const kids = () => {
    for (const c of node.childNodes) walk(c, out, depth);
  };
  if (/^h[1-6]$/.test(tag)) {
    out.block();
    out.raw(`${'#'.repeat(Math.min(Number(tag[1]), 3))} `);
    kids();
    return out.block();
  }
  switch (tag) {
    case 'br':
      return out.line();
    case 'ul':
    case 'ol': {
      out.line();
      let n = 0;
      for (const c of node.children) {
        if (c.localName !== 'li') {
          walk(c, out, depth + 1);
          continue;
        }
        out.line();
        n++;
        out.raw(`${'  '.repeat(Math.min(depth, 4))}${tag === 'ol' ? `${n}. ` : '- '}`);
        for (const g of c.childNodes) walk(g, out, depth + 1);
      }
      return out.line();
    }
    case 'li':
      out.line();
      out.raw(`${'  '.repeat(Math.min(depth, 4))}- `);
      return kids();
    case 'table': {
      out.block();
      for (const tr of node.querySelectorAll('tr')) {
        const cells = [...tr.children].filter((c) => c.localName === 'td' || c.localName === 'th').map((c) => c.textContent.replace(/\s+/g, ' ').replace(/\|/g, '/').trim());
        if (cells.some(Boolean)) {
          out.raw(`| ${cells.join(' | ')} |`);
          out.line();
        }
      }
      return out.block();
    }
    case 'pre':
      out.block();
      out.raw(node.textContent.replace(/\n+$/, ''));
      return out.block();
    case 'math': {
      const tex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
      return out.text(tex ? ` $${tex}$ ` : node.textContent.replace(/\s+/g, ' '));
    }
    case 'dt':
      out.line();
      kids();
      return out.line();
    case 'dd':
      out.line();
      out.raw('  ');
      kids();
      return out.line();
    default:
      if (BLOCK_TAGS.has(tag)) {
        out.block();
        kids();
        return out.block();
      }
      return kids();
  }
}

/**
 * Retire les feuilles de style et les attributs `style` AVANT l'analyse : le navigateur applique la règle de
 * sécurité de l'appli (pas de style en ligne) aussi aux pages analysées, et signalerait une erreur inutile.
 * Ce n'est pas une mesure de sécurité (l'analyseur n'exécute rien) : seulement du confort.
 */
export function withoutStyles(html) {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<[a-z][^>]*>/gi, (tag) => (/\sstyle\s*=/i.test(tag) ? tag.replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*')/gi, '') : tag));
}

/**
 * Convertit une page HTML en texte structuré (titres #, listes -, tableaux |, formules $…$).
 * Utilise l'analyseur HTML du navigateur : les scripts ne sont jamais exécutés.
 * @returns {{title: string, text: string}}
 */
export function htmlToMarkdown(html, DOMParserCtor = globalThis.DOMParser) {
  if (!DOMParserCtor) throw new Error('La lecture des pages web n’est pas disponible dans cet environnement.');
  const doc = new DOMParserCtor().parseFromString(withoutStyles(String(html ?? '')), 'text/html');
  // formules MathJax v2 : <script type="math/tex"> → $…$ avant le nettoyage des scripts
  for (const s of doc.querySelectorAll('script[type^="math/tex"]')) {
    const tex = s.textContent.trim();
    s.replaceWith(doc.createTextNode(s.type.includes('display') ? `\n$$${tex}$$\n` : ` $${tex}$ `));
  }
  const title = (doc.querySelector('title')?.textContent || doc.querySelector('h1')?.textContent || '').replace(/\s+/g, ' ').trim();
  for (const n of doc.querySelectorAll(DROP)) n.remove();
  const root = doc.querySelector('main, article, [role="main"]') || doc.body || doc.documentElement;
  const out = new Out();
  walk(root, out, 0);
  return { title, text: cleanText(out.parts.join(''), { keepIndent: true }) };
}
