// Import Word (.docx) : texte, titres, listes, tableaux et équations (converties en LaTeX).
import { unzipSync, strFromU8 } from '../../vendor/fflate/fflate.js';
import { splitByHeadings } from '../text/chunk.js';
import { cleanText } from '../text/normalize.js';
import { child, kids, isNode, parseXML, find, findAll, textOf, descendants } from './xml.js';
import { ommlToLatex } from './omml.js';

const WANTED = /^word\/(document|styles)\.xml$/;
const HEADING_ID = /^(?:heading|titre)\s*([1-9])$/i;

/** styleId → { level (1-9 si titre), list } , en suivant les styles « basés sur ». */
function readStyles(xml) {
  const raw = new Map();
  if (xml) {
    for (const st of findAll(parseXML(xml), 'w:style')) {
      const id = st.attrs['w:styleId'];
      if (!id) continue;
      const name = child(st, 'w:name')?.attrs?.['w:val'] || '';
      const ppr = child(st, 'w:pPr');
      const outline = child(ppr, 'w:outlineLvl')?.attrs?.['w:val'];
      raw.set(id, { id, name, basedOn: child(st, 'w:basedOn')?.attrs?.['w:val'], outline: outline === undefined ? null : Number(outline), list: !!child(ppr, 'w:numPr') });
    }
  }
  const resolved = new Map();
  for (const [id, s] of raw) {
    let level = null;
    let list = false;
    for (let cur = s, depth = 0; cur && depth < 6; cur = raw.get(cur.basedOn), depth++) {
      const h = HEADING_ID.exec(cur.name.replace(/\s+/g, ' ')) || HEADING_ID.exec(cur.id.replace(/\s+/g, ' '));
      if (level === null && h) level = Number(h[1]);
      else if (level === null && cur.name.toLowerCase() === 'title') level = 1;
      else if (level === null && cur.outline !== null && cur.outline < 9) level = cur.outline + 1;
      if (/^(list|liste)\b/i.test(cur.name) && !/continue|paragraph|paragraphe/i.test(cur.name)) list = true;
      if (cur.list) list = true;
    }
    resolved.set(id, { level, list });
  }
  return resolved;
}

function runText(node) {
  let s = '';
  for (const c of node.children) {
    if (!isNode(c)) continue;
    switch (c.name) {
      case 'w:t':
        s += textOf(c);
        break;
      case 'w:tab':
      case 'w:ptab':
        s += ' ';
        break;
      case 'w:br':
      case 'w:cr':
        s += c.attrs['w:type'] === 'page' ? '' : '\n';
        break;
      case 'w:noBreakHyphen':
        s += '-';
        break;
      case 'w:sym': {
        const code = parseInt(c.attrs['w:char'] || '', 16);
        if (code) s += String.fromCodePoint(code >= 0xf000 ? code - 0xf000 : code);
        break;
      }
      case 'w:drawing':
      case 'w:pict':
      case 'w:object':
        break;
      case 'm:oMath': {
        const tex = ommlToLatex(c);
        if (tex) s += ` $${tex}$ `;
        break;
      }
      default:
        break;
    }
  }
  return s;
}

/** Texte d'un paragraphe : runs, liens, suivi des modifications (insertions gardées, suppressions ignorées). */
function paragraphText(p) {
  let s = '';
  const walk = (node) => {
    for (const c of node.children) {
      if (!isNode(c)) continue;
      if (c.name === 'w:r') s += runText(c);
      else if (c.name === 'm:oMath') {
        const tex = ommlToLatex(c);
        if (tex) s += ` $${tex}$ `;
      } else if (c.name === 'm:oMathPara') {
        const tex = ommlToLatex(c);
        if (tex) s += `\n$$${tex}$$\n`;
      } else if (/^w:(hyperlink|smartTag|ins|sdt|sdtContent|fldSimple|customXml)$/.test(c.name)) walk(c);
      else if (c.name === 'mc:AlternateContent') walk(child(c, 'mc:Choice') || c);
    }
  };
  walk(p);
  return s.replace(/ {2,}/g, ' ').replace(/ ?\n ?/g, '\n').trim();
}

function convertTable(tbl, ctx) {
  const rows = [];
  for (const tr of kids(tbl, 'w:tr')) {
    const cells = kids(tr, 'w:tc').map((tc) =>
      kids(tc, 'w:p').map((p) => paragraphText(p)).filter(Boolean).join(' ').replace(/\|/g, '/')
    );
    if (cells.some(Boolean)) rows.push(`| ${cells.join(' | ')} |`);
  }
  ctx.tables++;
  return rows.join('\n');
}

/**
 * @param {Uint8Array} bytes
 * @returns {{pages: {label: string|null, text: string}[], meta: {kind: string, images: number, tables: number, words: number}}}
 */
export function extractDocx(bytes) {
  let files;
  try {
    files = unzipSync(bytes, { filter: (f) => WANTED.test(f.name) });
  } catch {
    throw new Error('Ce fichier .docx est illisible ou abîmé.');
  }
  if (!files['word/document.xml']) throw new Error('Ce fichier n’est pas un document Word (.docx) valide.');
  const styles = readStyles(files['word/styles.xml'] ? strFromU8(files['word/styles.xml']) : '');
  const doc = parseXML(strFromU8(files['word/document.xml']));
  const body = find(doc, 'w:body');
  if (!body) throw new Error('Le document Word est vide.');
  const ctx = { tables: 0 };
  const lines = [];

  for (const node of kids(body)) {
    if (node.name === 'w:tbl') {
      lines.push('', convertTable(node, ctx), '');
    } else if (node.name === 'w:p') {
      const ppr = child(node, 'w:pPr');
      const sid = child(ppr, 'w:pStyle')?.attrs?.['w:val'];
      const style = styles.get(sid) || { level: null, list: false };
      const direct = child(ppr, 'w:outlineLvl');
      const level = style.level ?? (direct ? Number(direct.attrs['w:val']) + 1 : null);
      const text = paragraphText(node);
      if (!text) {
        lines.push('');
        continue;
      }
      if (level && level <= 6) lines.push('', `${'#'.repeat(level)} ${text.replace(/\n/g, ' ')}`, '');
      else if (child(ppr, 'w:numPr') || style.list) {
        const ilvl = Number(child(child(ppr, 'w:numPr'), 'w:ilvl')?.attrs?.['w:val'] || 0);
        lines.push(`${'  '.repeat(Math.min(ilvl, 4))}- ${text.replace(/\n/g, ' ')}`);
      } else lines.push(text);
    } else if (node.name === 'w:sdt') {
      for (const p of findAll(node, 'w:p')) {
        const t = paragraphText(p);
        if (t) lines.push(t);
      }
    }
  }

  const images = (() => {
    let n = 0;
    for (const d of descendants(doc)) if (d.name === 'w:drawing' || d.name === 'w:pict') n++;
    return n;
  })();
  const markdown = cleanText(lines.join('\n'), { keepIndent: true });
  if (!markdown) {
    throw new Error(
      images
        ? 'Ce document ne contient que des images. Enregistre-le en PDF ou photographie-le, puis ajoute-le comme image (lecture par OCR).'
        : 'Ce document Word ne contient pas de texte.'
    );
  }
  return {
    pages: splitByHeadings(markdown),
    meta: { kind: 'docx', images, tables: ctx.tables, words: markdown.split(/\s+/).length },
  };
}
