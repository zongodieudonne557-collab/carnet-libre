// Accessibilité des écrans, en clair et en sombre : axe-core (WCAG 2.0 / 2.1 / 2.2, niveaux A et AA)
// + un contrôle des contrastes sur le rendu réel, car axe ne sait pas juger les fonds en dégradé (papier à carreaux),
// les pastilles partiellement recouvertes ni les contenus ajoutés par CSS.
//   node --test test/e2e/a11y.e2e.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { launch, openApp } from './helpers.mjs';

const require = createRequire(import.meta.url);
let env;
let AXE;
before(async () => {
  env = await launch();
  AXE = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
});
after(async () => {
  await env.close();
});

/** Violations axe de la page affichée (le script est exécuté par le navigateur de test : la CSP de l'appli n'est pas touchée). */
async function axeViolations(page) {
  await page.evaluate(AXE);
  return page.evaluate(() =>
    axe
      .run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] })
      .then((r) => r.violations.map((v) => `${v.id} (${v.impact}) : ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' ; ')}`))
  );
}

/** Contraste du texte visible, calculé sur les couleurs réellement affichées (WCAG : 4,5 ; 3 pour le grand texte). */
function lowContrast(page) {
  return page.evaluate(() => {
    const parse = (c) => {
      const m = /^(?:rgba?|color)\(([^)]+)\)/.exec(c);
      if (!m) return null;
      const p = m[1].replace('srgb', '').split(/[\s,/]+/).filter(Boolean).map(Number);
      const scale = /^color\(/.test(c) ? 255 : 1;
      return { r: p[0] * scale, g: p[1] * scale, b: p[2] * scale, a: p.length > 3 ? p[3] : 1 };
    };
    const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
    const lum = ({ r, g, b }) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const canvas = parse(getComputedStyle(document.documentElement).backgroundColor);
    const base = canvas && canvas.a > 0 ? canvas : { r: 255, g: 255, b: 255, a: 1 };
    // Fond : couleurs unies empilées. Pour un fond en dégradé employé comme aplat (tableau noir des diapos, surlignage « mark »),
    // on prend la pire teinte du dégradé ; les parties transparentes sont ignorées.
    const stops = (cs) => [...cs.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map((m) => parse(m[0])).filter((c) => c && c.a > 0);
    const backdrops = (el) => {
      const layers = [];
      let gradient = null;
      for (let n = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const c = parse(cs.backgroundColor);
        if (!gradient && n.matches('.board, mark') && /gradient/.test(cs.backgroundImage)) gradient = stops(cs);
        if (c && c.a > 0) layers.push(c);
        if (gradient || (c && c.a >= 1)) break;
      }
      const solid = layers.reduceRight((under, layer) => over(layer, under), base);
      return gradient?.length ? gradient.map((g) => over(g, solid)) : [solid];
    };
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('body *')) {
      if (!el.isConnected || ['SCRIPT', 'STYLE', 'SVG', 'svg', 'PATH'].includes(el.tagName)) continue;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (cs.display === 'none' || cs.visibility === 'hidden' || rect.width < 2 || rect.height < 2) continue;
      if (el.closest('dialog:not([open]), [hidden], .visually-hidden, :disabled, [aria-disabled="true"], [inert]')) continue;
      let opacity = 1;
      for (let n = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
      if (opacity < 0.05) continue;
      const fg0 = parse(cs.color);
      if (!fg0) continue;
      const size = parseFloat(cs.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
      const need = large ? 3 : 4.5;
      const r = Math.min(...backdrops(el).map((bg) => ratio(over({ ...fg0, a: fg0.a * opacity }, bg), bg)));
      if (r + 0.005 < need) {
        const id = `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`;
        const key = `${id}|${r.toFixed(2)}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(`${id} « ${el.textContent.trim().slice(0, 30)} » : ${r.toFixed(2)} (minimum ${need})`);
        }
      }
    }
    return out;
  });
}

const SCREENS = [
  { name: 'accueil', go: async () => {} },
  { name: 'carnet', path: (id) => `n/${id}` },
  { name: 'sources', path: (id) => `n/${id}/sources` },
  { name: 'discussion', path: (id) => `n/${id}/discuter` },
  { name: 'discussion (réponse sans IA)', path: (id) => `n/${id}/discuter`, then: async (page) => { await page.fill('#chat-input', 'photosynthèse'); await page.keyboard.press('Enter'); await page.waitForSelector('.msg, .chat-msg, .answer, .passage-text'); } },
  { name: 'réviser', path: (id) => `n/${id}/reviser` },
  { name: 'cartes', path: (id) => `n/${id}/cartes` },
  { name: 'cartes (séance, recto)', path: (id) => `n/${id}/cartes`, then: async (page) => { await page.getByRole('button', { name: /Commencer la séance/ }).click(); await page.waitForSelector('.flash-reveal'); } },
  { name: 'cartes (séance, verso)', path: (id) => `n/${id}/cartes`, then: async (page) => { await page.getByRole('button', { name: /Commencer la séance/ }).click(); await page.waitForSelector('.flash-reveal'); await page.keyboard.press('Space'); await page.waitForSelector('.grade-key'); } },
  { name: 'cartes (liste)', path: (id) => `n/${id}/cartes`, then: async (page) => { await page.getByRole('radio', { name: /Mes cartes/ }).click(); await page.waitForSelector('.card-row, .cards-list li'); } },
  { name: 'cartes (création)', path: (id) => `n/${id}/cartes`, then: async (page) => { await page.getByRole('radio', { name: 'Créer' }).click(); await page.getByRole('button', { name: /Chercher des cartes/ }).click(); await page.waitForSelector('.auto-list, .auto-out .callout'); } },
  { name: 'quiz', path: (id) => `n/${id}/quiz` },
  { name: 'quiz (question)', path: (id) => `n/${id}/quiz`, then: async (page) => { await page.getByRole('button', { name: 'Créer le quiz' }).click(); await page.waitForSelector('.quiz-question'); } },
  { name: 'quiz (corrigé)', path: (id) => `n/${id}/quiz`, then: async (page) => { await page.getByRole('button', { name: 'Créer le quiz' }).click(); await page.waitForSelector('.quiz-question'); await page.keyboard.press('1'); await page.waitForSelector('.quiz-next'); } },
  { name: 'fiche', path: (id) => `n/${id}/fiches`, then: async (page) => { await page.getByRole('button', { name: /Créer la fiche automatique/ }).click(); await page.waitForSelector('.note-view'); } },
  { name: 'causerie', path: (id) => `n/${id}/causerie` },
  { name: 'causerie (lecture)', path: (id) => `n/${id}/causerie`, then: async (page) => { await page.getByRole('button', { name: /Lire à voix haute/ }).click(); await page.waitForSelector('.transcript'); } },
  { name: 'diapos', path: (id) => `n/${id}/diapos`, then: async (page) => { await page.getByRole('button', { name: /Créer le diaporama/ }).click(); await page.waitForSelector('.deck-stage'); } },
  { name: 'réglages', path: () => 'reglages' },
  { name: 'confidentialité', path: () => 'confidentialite' },
];

for (const colorScheme of ['light', 'dark']) {
  test(`accessibilité (${colorScheme === 'light' ? 'thème clair' : 'thème sombre'}) : axe-core et contrastes sur tous les écrans`, async () => {
    const { page, context } = await openApp(env, { colorScheme });
    await page.waitForSelector('#main');
    const id = await page.evaluate(async () => (await import('/src/ui/sample-notebook.js')).createSampleNotebook().then((n) => n.id));
    const problems = [];
    for (const s of SCREENS) {
      await page.evaluate(() => (location.hash = '#/confidentialite')); // on repart d'un écran neuf à chaque fois
      await page.waitForSelector('.privacy-page');
      await page.evaluate((h) => (location.hash = h), `#/${s.path ? s.path(id) : ''}`);
      await page.waitForSelector('#main :is(h1, h2, h3, p, ul)');
      await page.waitForTimeout(400);
      await s.then?.(page);
      await page.waitForTimeout(250);
      for (const v of await axeViolations(page)) problems.push(`[${s.name}] ${v}`);
      for (const v of await lowContrast(page)) problems.push(`[${s.name}] contraste : ${v}`);
    }
    await context.close();
    assert.deepEqual(problems, []);
  });
}

test('le contrôle lui-même : il repère bien un texte illisible et laisse passer un texte lisible', async () => {
  const { page, context } = await openApp(env);
  await page.waitForSelector('#main :is(h1, h2, h3, p, ul)');
  await page.evaluate(() => {
    const bad = document.createElement('p');
    bad.id = 'planted-bad';
    bad.textContent = 'gris clair sur blanc';
    bad.style.cssText = 'color:#bbbbbb;background:#ffffff';
    const ok = document.createElement('p');
    ok.id = 'planted-ok';
    ok.textContent = 'noir sur blanc';
    ok.style.cssText = 'color:#000000;background:#ffffff';
    document.body.append(bad, ok); // hors de #main : l'affichage d'un écran ne les efface pas
  });
  const found = await lowContrast(page);
  assert.ok(found.some((f) => f.includes('gris clair sur blanc')), 'le texte gris clair est signalé');
  assert.ok(!found.some((f) => f.includes('noir sur blanc')));
  const axe = await axeViolations(page);
  assert.ok(axe.some((v) => v.startsWith('color-contrast')), 'axe le signale aussi');
  await context.close();
});
