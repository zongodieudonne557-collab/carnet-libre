#!/usr/bin/env node
// Fabrique les icônes PNG de l'appli (écran d'accueil du téléphone, installation PWA) à partir de icons/logo.svg.
// Les PNG générés sont versionnés : ce script ne sert que si tu changes le logo.
// Usage : npm i -D playwright && npx playwright install chromium && npm run app-icons
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(import.meta.url)('playwright');

const svg = readFileSync(join(root, 'icons/logo.svg'), 'utf8');
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>[\s\S]*?<\/title>/, '');

// Icône « adaptative » : fond plein bord à bord, dessin réduit pour rester dans la zone sûre (≈ 70 %).
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#2149c1"/><g transform="translate(9.6 9.6) scale(0.7)">${inner.replace(/<rect width="64" height="64" rx="14" fill="#2149c1"\/>/, '')}</g></svg>`;

const jobs = [
  { file: 'icon-192.png', size: 192, svg },
  { file: 'icon-512.png', size: 512, svg },
  { file: 'icon-maskable-512.png', size: 512, svg: maskable },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const j of jobs) {
  await page.setViewportSize({ width: j.size, height: j.size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${j.size}px;height:${j.size}px}</style>${j.svg}`);
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: j.size, height: j.size } });
  writeFileSync(join(root, 'icons', j.file), png);
  console.log(`icons/${j.file}  ${png.length} octets`);
}
await browser.close();
