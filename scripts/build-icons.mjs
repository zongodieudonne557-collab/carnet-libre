#!/usr/bin/env node
// Génère src/ui/icons.js à partir des icônes Lucide (licence ISC) : seules les icônes
// listées ci-dessous sont embarquées. Les icônes sont construites avec l'API DOM
// (createElementNS) : aucun innerHTML, donc compatible avec une politique de sécurité stricte.
// Usage : npm install && npm run icons
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nodes = JSON.parse(readFileSync(join(root, 'node_modules/lucide-static/icon-nodes.json'), 'utf8'));
const version = JSON.parse(readFileSync(join(root, 'node_modules/lucide-static/package.json'), 'utf8')).version;

const WANTED = `
arrow-left book-open bookmark camera check chevron-down chevron-left chevron-right chevron-up circle-check circle-question-mark circle-x
clipboard-paste cloud copy download ellipsis external-link eye eye-off file-pen file-text file-up files flag folder-open
graduation-cap hard-drive headphones heart image info key-round languages layers lightbulb list-checks lock menu message-circle mic
monitor moon notebook notebook-pen pause pencil play plus presentation quote refresh-cw repeat rotate-ccw scroll-text search send
server settings shield-check shuffle skip-back skip-forward sparkles square square-check-big square-pen sun trash triangle-alert
upload volume-2 wifi-off x
`
  .trim()
  .split(/\s+/);

const missing = WANTED.filter((n) => !nodes[n]);
if (missing.length) {
  console.error(`Icônes introuvables dans Lucide ${version} : ${missing.join(', ')}`);
  process.exit(1);
}

const data = Object.fromEntries(WANTED.sort().map((n) => [n, nodes[n]]));

const out = `// Généré par scripts/build-icons.mjs (Lucide ${version}, licence ISC) : ne pas modifier à la main.
// Pour changer la liste des icônes : modifier WANTED dans le script, puis « npm run icons ».

const NODES = ${JSON.stringify(data)};

const NS = 'http://www.w3.org/2000/svg';

/** Noms disponibles (pour les tests). */
export const ICON_NAMES = Object.keys(NODES);

/**
 * Crée une icône SVG (trait, couleur du texte courant).
 * @param {string} name
 * @param {{size?: number, label?: string, className?: string}} [opts]  \`label\` : texte lu par les lecteurs d'écran ; sans label l'icône est décorative.
 */
export function icon(name, { size = 20, label = '', className = '' } = {}) {
  const parts = NODES[name];
  if (!parts) throw new Error(\`Icône inconnue : \${name}\`);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', \`icon\${className ? \` \${className}\` : ''}\`);
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
  }
  for (const [tag, attrs] of parts) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
}
`;

writeFileSync(join(root, 'src/ui/icons.js'), out);
console.log(`src/ui/icons.js écrit : ${WANTED.length} icônes (Lucide ${version}).`);
