// Équations Word (OMML) → LaTeX. Couvre les structures courantes des cours :
// fractions, indices, exposants, racines, parenthèses, sommes/intégrales, fonctions, matrices.
import { child, kids, isNode, textOf } from './xml.js';

const NARY = { '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint', '⋃': '\\bigcup', '⋂': '\\bigcap' };
const ACCENT = { '\u0302': '\\hat', '\u0303': '\\tilde', '\u0304': '\\bar', '\u0305': '\\overline', '\u20d7': '\\vec', '\u0307': '\\dot', '\u0308': '\\ddot', '^': '\\hat', '~': '\\tilde', '\u2192': '\\vec' };

const esc = (s) => s.replace(/[{}%#&$]/g, (c) => `\\${c}`);

function arg(node, name) {
  return convertChildren(child(node, name));
}

function convertChildren(node) {
  if (!node) return '';
  let out = '';
  for (const c of node.children) if (isNode(c)) out += convert(c);
  return out;
}

function convert(n) {
  switch (n.name) {
    case 'm:r': {
      let s = '';
      for (const t of kids(n, 'm:t')) s += textOf(t);
      return esc(s);
    }
    case 'm:f': {
      const type = child(child(n, 'm:fPr'), 'm:type')?.attrs?.['m:val'];
      const num = arg(n, 'm:num');
      const den = arg(n, 'm:den');
      if (type === 'lin') return `${num}/${den}`;
      if (type === 'noBar') return `\\binom{${num}}{${den}}`;
      return `\\frac{${num}}{${den}}`;
    }
    case 'm:sSup':
      return `{${arg(n, 'm:e')}}^{${arg(n, 'm:sup')}}`;
    case 'm:sSub':
      return `{${arg(n, 'm:e')}}_{${arg(n, 'm:sub')}}`;
    case 'm:sSubSup':
      return `{${arg(n, 'm:e')}}_{${arg(n, 'm:sub')}}^{${arg(n, 'm:sup')}}`;
    case 'm:rad': {
      const hide = child(child(n, 'm:radPr'), 'm:degHide')?.attrs?.['m:val'];
      const deg = arg(n, 'm:deg').trim();
      return deg && hide !== '1' && hide !== 'on' ? `\\sqrt[${deg}]{${arg(n, 'm:e')}}` : `\\sqrt{${arg(n, 'm:e')}}`;
    }
    case 'm:d': {
      const pr = child(n, 'm:dPr');
      const beg = child(pr, 'm:begChr')?.attrs?.['m:val'] ?? '(';
      const end = child(pr, 'm:endChr')?.attrs?.['m:val'] ?? ')';
      const sep = child(pr, 'm:sepChr')?.attrs?.['m:val'] ?? '|';
      const body = kids(n, 'm:e').map((e) => convertChildren(e)).join(sep === '|' && kids(n, 'm:e').length > 1 ? ', ' : sep);
      const fix = (c, side) => (c === '' ? '.' : c === '{' || c === '}' ? `\\${c}` : c === '⟨' ? '\\langle' : c === '⟩' ? '\\rangle' : c === '‖' ? '\\|' : c === '⌊' ? '\\lfloor' : c === '⌋' ? '\\rfloor' : c === '⌈' ? '\\lceil' : c === '⌉' ? '\\rceil' : side && c);
      return `\\left${fix(beg, 1)} ${body} \\right${fix(end, 1)}`;
    }
    case 'm:nary': {
      const chr = child(child(n, 'm:naryPr'), 'm:chr')?.attrs?.['m:val'] ?? '∫';
      const op = NARY[chr] || esc(chr);
      const sub = arg(n, 'm:sub').trim();
      const sup = arg(n, 'm:sup').trim();
      return `${op}${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''} ${arg(n, 'm:e')}`;
    }
    case 'm:func': {
      const name = arg(n, 'm:fName').replace(/\\([{}])/g, '$1').trim();
      return `\\operatorname{${name}} ${arg(n, 'm:e')}`;
    }
    case 'm:acc': {
      const chr = child(child(n, 'm:accPr'), 'm:chr')?.attrs?.['m:val'] ?? '\u0302';
      return `${ACCENT[chr] || '\\hat'}{${arg(n, 'm:e')}}`;
    }
    case 'm:bar': {
      const pos = child(child(n, 'm:barPr'), 'm:pos')?.attrs?.['m:val'];
      return `${pos === 'bot' ? '\\underline' : '\\overline'}{${arg(n, 'm:e')}}`;
    }
    case 'm:limLow':
      return `{${arg(n, 'm:e')}}_{${arg(n, 'm:lim')}}`;
    case 'm:limUpp':
      return `{${arg(n, 'm:e')}}^{${arg(n, 'm:lim')}}`;
    case 'm:m': {
      const rows = kids(n, 'm:mr').map((r) => kids(r, 'm:e').map((e) => convertChildren(e)).join(' & '));
      return `\\begin{matrix} ${rows.join(' \\\\ ')} \\end{matrix}`;
    }
    case 'm:eqArr': {
      const rows = kids(n, 'm:e').map((e) => convertChildren(e));
      return `\\begin{aligned} ${rows.join(' \\\\ ')} \\end{aligned}`;
    }
    case 'm:oMathPara':
    case 'm:oMath':
    case 'm:e':
    case 'm:box':
    case 'm:borderBox':
    case 'm:phant':
    case 'm:groupChr':
      return convertChildren(n);
    default:
      // propriétés (…Pr) et autres éléments sans texte : ignorés
      return /Pr$/.test(n.name) ? '' : convertChildren(n);
  }
}

/** Convertit un élément `m:oMath` (ou `m:oMathPara`) en LaTeX. */
export function ommlToLatex(node) {
  return convert(node).replace(/\s+/g, ' ').trim();
}
