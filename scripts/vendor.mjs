// Copie les bibliothèques tierces depuis node_modules vers vendor/.
// Le dossier vendor/ est versionné : l'appli se déploie sans étape de build.
// Usage : npm install && npm run vendor
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => join(root, 'node_modules', p);
const out = (p) => join(root, 'vendor', p);
const require = createRequire(import.meta.url);

function copy(from, to) {
  if (!existsSync(from)) throw new Error(`Introuvable : ${from} (as-tu lancé "npm install" ?)`);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log('  +', to.replace(root + '/', ''));
}

rmSync(join(root, 'vendor'), { recursive: true, force: true });

// --- PDF.js (build "legacy" : compatible avec les vieux navigateurs Android)
console.log('pdf.js');
const pdf = nm('pdfjs-dist/legacy/build');
copy(join(pdf, 'pdf.min.mjs'), out('pdfjs/pdf.min.mjs'));
copy(join(pdf, 'pdf.worker.min.mjs'), out('pdfjs/pdf.worker.min.mjs'));
for (const f of ['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm', 'LICENSE_JBIG2', 'LICENSE_OPENJPEG', 'LICENSE_QCMS', 'LICENSE_PDFJS_JBIG2', 'LICENSE_PDFJS_OPENJPEG', 'LICENSE_PDFJS_QCMS']) {
  copy(nm('pdfjs-dist/wasm/' + f), out('pdfjs/wasm/' + f));
}
copy(nm('pdfjs-dist/LICENSE'), out('pdfjs/LICENSE'));

// --- fflate (lecture des .docx / .pptx qui sont des archives zip)
console.log('fflate');
copy(nm('fflate/esm/browser.js'), out('fflate/fflate.js'));
copy(nm('fflate/LICENSE'), out('fflate/LICENSE'));

// --- KaTeX (formules mathématiques) : JS, CSS et polices woff2 uniquement
console.log('katex');
copy(nm('katex/dist/katex.min.js'), out('katex/katex.min.js'));
let css = readFileSync(nm('katex/dist/katex.min.css'), 'utf8');
// on ne garde que woff2 (tous les navigateurs actuels le gèrent)
css = css.replace(/,url\(fonts\/[^)]+\.woff\) format\("woff"\)/g, '').replace(/,url\(fonts\/[^)]+\.ttf\) format\("truetype"\)/g, '');
mkdirSync(out('katex'), { recursive: true });
writeFileSync(out('katex/katex.min.css'), css);
console.log('  +', 'vendor/katex/katex.min.css (simplifié)');
for (const f of readdirSync(nm('katex/dist/fonts'))) {
  if (f.endsWith('.woff2')) copy(nm('katex/dist/fonts/' + f), out('katex/fonts/' + f));
}
copy(nm('katex/LICENSE'), out('katex/LICENSE'));

// --- Tesseract.js (OCR hors-ligne) : worker + moteur LSTM + données françaises
console.log('tesseract');
copy(nm('tesseract.js/dist/tesseract.esm.min.js'), out('tesseract/tesseract.esm.min.js'));
copy(nm('tesseract.js/dist/worker.min.js'), out('tesseract/worker.min.js'));
const coreDir = nm('tesseract.js-core');
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
  copy(join(coreDir, f), out('tesseract/core/' + f));
}
copy(join(coreDir, 'LICENSE'), out('tesseract/LICENSE'));
// Modèle "best_int" : ~0,7 Mo, LSTM seul (au lieu de 6 Mo pour la version standard)
copy(nm('@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz'), out('tesseract/lang/fra.traineddata.gz'));

// --- Polices (OFL-1.1) : lecture très lisible + écriture cursive scolaire pour les titres
console.log('polices');
const af = nm('@fontsource/atkinson-hyperlegible/files');
for (const f of ['atkinson-hyperlegible-latin-400-normal.woff2', 'atkinson-hyperlegible-latin-700-normal.woff2', 'atkinson-hyperlegible-latin-400-italic.woff2']) {
  copy(join(af, f), out('fonts/' + f));
}
copy(nm('@fontsource/atkinson-hyperlegible/LICENSE'), out('fonts/LICENSE-atkinson-hyperlegible'));
copy(nm('@fontsource/playwrite-fr-trad/files/playwrite-fr-trad-latin-400-normal.woff2'), out('fonts/playwrite-fr-trad-latin-400-normal.woff2'));
copy(nm('@fontsource/playwrite-fr-trad/LICENSE'), out('fonts/LICENSE-playwrite-fr-trad'));

// --- Récapitulatif des tailles
function size(dir) {
  let n = 0;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    n += statSync(p).isDirectory() ? size(p) : statSync(p).size;
  }
  return n;
}
console.log('\nTaille de vendor/ :', (size(out('')) / 1048576).toFixed(1), 'Mo');
const versions = {};
for (const p of ['pdfjs-dist', 'fflate', 'katex', 'tesseract.js', 'tesseract.js-core', '@tesseract.js-data/fra', '@fontsource/atkinson-hyperlegible', '@fontsource/playwrite-fr-trad']) {
  try { versions[p] = JSON.parse(readFileSync(nm(p + '/package.json'), 'utf8')).version; } catch { versions[p] = '?'; }
}
writeFileSync(out('VERSIONS.json'), JSON.stringify(versions, null, 2) + '\n');
console.log(versions);
