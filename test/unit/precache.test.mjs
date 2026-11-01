// Mode hors ligne : la liste des fichiers gardés (precache.js) doit être à jour et complète.
// Si ce test échoue après une modification de l'appli : « npm run precache », puis ajoute precache.js au commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { ROOT, buildPrecache, renderPrecacheJs } from '../../scripts/build-precache.mjs';

const fresh = buildPrecache();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((n) => {
    const rel = `${dir}/${n}`;
    return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

test('precache.js est à jour (sinon : npm run precache)', () => {
  assert.ok(existsSync(join(ROOT, 'precache.js')), 'precache.js manque : npm run precache');
  assert.equal(read('precache.js'), renderPrecacheJs(fresh), 'precache.js est périmé : lance « npm run precache » puis ajoute-le au commit');
});

test('l’appli complète est préchargée, les gros fichiers sont à la demande', () => {
  const shell = new Set(fresh.shell);
  for (const f of ['index.html', 'manifest.webmanifest', 'src/main.js', 'css/base.css', 'icons/icon-192.png', 'vendor/katex/katex.min.js']) {
    assert.ok(shell.has(f), `${f} devrait être préchargé`);
  }
  for (const f of walk('src').filter((p) => p.endsWith('.js'))) assert.ok(shell.has(f), `${f} manque au préchargement`);
  assert.ok(fresh.lazy.includes('vendor/tesseract/lang/fra.traineddata.gz'));
  assert.ok(fresh.lazy.includes('vendor/pdfjs/pdf.min.mjs'));
  assert.ok(fresh.lazy.every((p) => !shell.has(p)), 'un fichier ne peut pas être à la fois préchargé et à la demande');
  assert.ok(![...shell, ...fresh.lazy].some((p) => /LICENSE|test\/|docs\/|node_modules|scripts\//.test(p)), 'seuls les fichiers de l’appli sont gardés');
  assert.ok(fresh.shellBytes < 3 * 1048576, `le préchargement reste léger (${fresh.shellBytes} octets)`);
});

test('tout ce que la page d’accueil et le manifeste chargent est gardé', () => {
  const known = new Set([...fresh.shell, ...fresh.lazy]);
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:href|src)="([^"#?]+)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|data:|mailto:)/.test(u));
  for (const u of refs) assert.ok(known.has(u.replace(/^\.\//, '')), `index.html charge « ${u} » mais il n’est pas gardé hors ligne`);
  const manifest = JSON.parse(read('manifest.webmanifest'));
  for (const i of manifest.icons) assert.ok(known.has(i.src), `icône du manifeste non gardée : ${i.src}`);
});

test('chaque fichier de vendor/ cité dans le code est gardé (préchargé ou à la demande)', () => {
  const known = new Set([...fresh.shell, ...fresh.lazy]);
  const missing = [];
  for (const f of walk('src').filter((p) => p.endsWith('.js'))) {
    const dir = posix.dirname(f);
    for (const m of read(f).matchAll(/['"`]((?:\.\.?\/)+vendor\/[^'"`$]+\.[a-z0-9]+)['"`]/gi)) {
      const target = posix.normalize(posix.join(dir, m[1]));
      if (!known.has(target)) missing.push(`${f} → ${target}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('le service worker ne se mêle que des fichiers de l’appli', () => {
  const sw = read('sw.js');
  assert.match(sw, /req\.method !== 'GET'/, 'seulement les lectures');
  assert.match(sw, /if \(path === null\) return;/, 'les adresses d’un autre site (IA) sont laissées au navigateur');
  assert.doesNotMatch(sw, /clients\.openWindow|postMessage\(|indexedDB|localStorage/, 'il ne touche pas aux données de la personne');
});
