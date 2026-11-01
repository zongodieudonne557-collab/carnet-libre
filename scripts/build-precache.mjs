#!/usr/bin/env node
// Génère precache.js : la liste des fichiers que le service worker (sw.js) garde pour le mode hors ligne.
//   - « shell »  : l'appli elle-même (page, styles, code, icônes, polices, KaTeX). Mis en cache à l'installation.
//   - « lazy »   : les gros fichiers (lecteur de PDF, OCR). Mis en cache au premier usage, ou à la demande
//                  depuis Réglages → Hors ligne, pour ne pas faire télécharger 15 Mo à qui n'en a pas besoin.
// La version est l'empreinte du contenu : dès qu'un fichier change, precache.js change, donc le navigateur
// voit que sw.js a changé et propose la mise à jour. Aucun numéro à penser à augmenter à la main.
//
// Usage : npm run precache            (écrit precache.js)
//         node scripts/build-precache.mjs --check   (échoue si precache.js n'est plus à jour : sert aux tests)
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');

function walk(dir, root) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, root));
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

const notLicense = (p) => !/(^|\/)(LICENSE[^/]*|VERSIONS\.json|README[^/]*)$/i.test(p);

// Ce qui fait partie de l'appli (précharge) et ce qui est chargé à la demande.
const SHELL = [
  (p) => p === 'index.html' || p === 'manifest.webmanifest',
  (p) => p.startsWith('css/') && p.endsWith('.css'),
  (p) => p.startsWith('src/') && p.endsWith('.js'),
  (p) => p.startsWith('icons/') && /\.(png|svg)$/.test(p),
  (p) => p.startsWith('vendor/fonts/') && p.endsWith('.woff2'),
  (p) => p === 'vendor/katex/katex.min.css' || p === 'vendor/katex/katex.min.js',
  (p) => p.startsWith('vendor/katex/fonts/') && p.endsWith('.woff2'),
  (p) => p === 'vendor/fflate/fflate.js',
];
const LAZY = [(p) => p.startsWith('vendor/pdfjs/') && notLicense(p), (p) => p.startsWith('vendor/tesseract/') && notLicense(p)];

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** Calcule le contenu de precache.js pour le dossier `root`. */
export function buildPrecache(root = ROOT) {
  const all = walk(root, root).filter((p) => !p.startsWith('node_modules/') && !p.startsWith('test/') && !p.startsWith('docs/') && !p.startsWith('scripts/'));
  const pick = (rules) => all.filter((p) => rules.some((r) => r(p)));
  const shell = pick(SHELL);
  const lazy = pick(LAZY).filter((p) => !shell.includes(p));
  const fingerprint = (files) => {
    const h = createHash('sha256');
    for (const f of files) h.update(`${f}\0${sha(readFileSync(join(root, f)))}\n`);
    return h.digest('hex').slice(0, 12);
  };
  const size = (files) => files.reduce((n, f) => n + statSync(join(root, f)).size, 0);
  return { version: fingerprint(shell), lazyVersion: fingerprint(lazy), shell, lazy, shellBytes: size(shell), lazyBytes: size(lazy) };
}

export function renderPrecacheJs(data) {
  const json = (v) => JSON.stringify(v, null, 1);
  return `// Fichier généré par « npm run precache » : ne pas modifier à la main.
// Il change dès qu'un fichier de l'appli change, ce qui déclenche la mise à jour du mode hors ligne.
self.PRECACHE = ${json({ version: data.version, lazyVersion: data.lazyVersion, shellBytes: data.shellBytes, lazyBytes: data.lazyBytes, shell: data.shell, lazy: data.lazy })};
`;
}

export function writePrecache(root = ROOT) {
  const data = buildPrecache(root);
  writeFileSync(join(root, 'precache.js'), renderPrecacheJs(data));
  return data;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) {
    const want = renderPrecacheJs(buildPrecache());
    const have = existsSync(join(ROOT, 'precache.js')) ? readFileSync(join(ROOT, 'precache.js'), 'utf8') : '';
    if (want !== have) {
      console.error('precache.js n’est plus à jour : lance « npm run precache » puis ajoute-le au commit.');
      process.exit(1);
    }
    console.log('precache.js est à jour.');
  } else {
    const d = writePrecache();
    const mo = (n) => `${(n / 1048576).toFixed(1).replace('.', ',')} Mo`;
    console.log(`precache.js écrit : ${d.shell.length} fichiers préchargés (${mo(d.shellBytes)}), ${d.lazy.length} à la demande (${mo(d.lazyBytes)}) — version ${d.version}.`);
  }
}
