// Import PowerPoint (.pptx) : une « page » par diapositive, avec les notes de l'intervenant.
import { unzipSync, strFromU8 } from '../../vendor/fflate/fflate.js';
import { cleanText } from '../text/normalize.js';
import { child, kids, isNode, parseXML, find, findAll } from './xml.js';

const WANTED = /^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/(_rels\/)?slide\d+\.xml(\.rels)?|notesSlides\/notesSlide\d+\.xml)$/;

function relMap(xml) {
  const map = new Map();
  if (!xml) return map;
  for (const r of findAll(parseXML(strFromU8(xml)), 'Relationship')) map.set(r.attrs.Id, r.attrs.Target);
  return map;
}

/** Texte d'un paragraphe DrawingML (a:p). */
function paraText(p) {
  let s = '';
  for (const c of p.children) {
    if (!isNode(c)) continue;
    if (c.name === 'a:r') s += kids(c, 'a:t').map((t) => t.children.join('')).join('');
    else if (c.name === 'a:br') s += '\n';
    else if (c.name === 'a:fld') {
      const type = c.attrs.type || '';
      if (!/slidenum|datetime/i.test(type)) s += kids(c, 'a:t').map((t) => t.children.join('')).join('');
    }
  }
  return s.trim();
}

function isBulleted(p, phType) {
  const ppr = child(p, 'a:pPr');
  if (child(ppr, 'a:buNone')) return false;
  if (child(ppr, 'a:buChar') || child(ppr, 'a:buAutoNum')) return true;
  return phType === 'body' || phType === 'obj';
}

function shapeLines(sp) {
  const ph = find(child(child(sp, 'p:nvSpPr'), 'p:nvPr') || { children: [] }, 'p:ph');
  const phType = ph ? ph.attrs.type || 'obj' : null;
  const tx = child(sp, 'p:txBody');
  if (!tx) return { phType, title: false, lines: [] };
  const lines = [];
  for (const p of kids(tx, 'a:p')) {
    const t = paraText(p);
    if (!t) continue;
    const lvl = Number(child(p, 'a:pPr')?.attrs?.lvl || 0);
    lines.push(isBulleted(p, phType) ? `${'  '.repeat(Math.min(lvl, 4))}- ${t.replace(/\n/g, ' ')}` : t);
  }
  return { phType, title: phType === 'title' || phType === 'ctrTitle', lines };
}

function tableLines(tbl) {
  const rows = [];
  for (const tr of kids(tbl, 'a:tr')) {
    const cells = kids(tr, 'a:tc').map((tc) => kids(child(tc, 'a:txBody'), 'a:p').map(paraText).filter(Boolean).join(' ').replace(/\|/g, '/'));
    if (cells.some(Boolean)) rows.push(`| ${cells.join(' | ')} |`);
  }
  return rows;
}

/** Parcourt les formes d'une diapositive dans l'ordre du document (groupes et tableaux compris). */
function collect(node, out) {
  for (const c of node.children) {
    if (!isNode(c)) continue;
    if (c.name === 'p:sp') out.shapes.push(shapeLines(c));
    else if (c.name === 'p:graphicFrame') {
      const tbl = find(c, 'a:tbl');
      if (tbl) out.shapes.push({ phType: null, title: false, lines: tableLines(tbl), table: true });
    } else if (c.name === 'p:grpSp') collect(c, out);
  }
}

function slideNotes(xml) {
  if (!xml) return '';
  const tree = parseXML(strFromU8(xml));
  const out = [];
  for (const sp of findAll(tree, 'p:sp')) {
    const s = shapeLines(sp);
    if (s.phType === 'body') out.push(...s.lines.map((l) => l.replace(/^\s*- /, '')));
  }
  return out.join(' ').trim();
}

/**
 * @param {Uint8Array} bytes
 * @returns {{pages: {label: string, text: string}[], meta: {kind: string, slides: number, notes: number}}}
 */
export function extractPptx(bytes) {
  let files;
  try {
    files = unzipSync(bytes, { filter: (f) => WANTED.test(f.name) });
  } catch {
    throw new Error('Ce fichier .pptx est illisible ou abîmé.');
  }
  const slidePaths = Object.keys(files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  if (!slidePaths.length) throw new Error('Ce fichier n’est pas une présentation PowerPoint (.pptx) valide.');

  // ordre réel des diapositives (présentation.xml), sinon ordre numérique
  let ordered = [];
  const pres = files['ppt/presentation.xml'];
  if (pres) {
    const rels = relMap(files['ppt/_rels/presentation.xml.rels']);
    for (const id of findAll(parseXML(strFromU8(pres)), 'p:sldId')) {
      const target = rels.get(id.attrs['r:id']);
      if (target) ordered.push(`ppt/${target.replace(/^\/?(ppt\/)?/, '')}`);
    }
  }
  ordered = ordered.filter((p) => files[p]);
  if (ordered.length !== slidePaths.length) ordered = slidePaths.sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]));

  const pages = [];
  let notesCount = 0;
  ordered.forEach((path, i) => {
    const tree = parseXML(strFromU8(files[path]));
    const acc = { shapes: [] };
    const spTree = find(tree, 'p:spTree');
    if (spTree) collect(spTree, acc);

    const title = acc.shapes.filter((s) => s.title).flatMap((s) => s.lines).join(' ').trim();
    const body = acc.shapes.filter((s) => !s.title && s.lines.length && s.phType !== 'sldNum' && s.phType !== 'dt' && s.phType !== 'ftr').flatMap((s) => s.lines);

    const relsPath = path.replace('slides/', 'slides/_rels/') + '.rels';
    let notes = '';
    const target = [...relMap(files[relsPath]).values()].find((t) => /notesSlides\/notesSlide\d+\.xml$/.test(t));
    if (target) {
      const np = `ppt/${target.replace(/^(\.\.\/)?/, '')}`;
      notes = slideNotes(files[np]);
    }
    if (notes) notesCount++;
    const text = [title ? `# ${title}` : '', body.join('\n'), notes ? `Notes de l’intervenant : ${notes}` : ''].filter(Boolean).join('\n\n');
    if (!text.trim()) return;
    pages.push({ label: `Diapo ${i + 1}${title ? ` — ${title.slice(0, 50)}` : ''}`, text: cleanText(text, { keepIndent: true }) });
  });
  if (!pages.length) throw new Error('Cette présentation ne contient pas de texte (images seulement ?).');
  return { pages, meta: { kind: 'pptx', slides: ordered.length, notes: notesCount } };
}
