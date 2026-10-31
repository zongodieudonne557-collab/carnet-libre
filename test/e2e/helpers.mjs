// Aides communes aux tests de bout en bout (Chromium réel, vraie politique de sécurité).
//   Nécessite Playwright : npm install && npx playwright install chromium
import { createRequire } from 'node:module';
import { startServer } from '../../scripts/serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');

export async function launch() {
  const server = await startServer();
  const browser = await chromium.launch();
  return {
    server,
    browser,
    async close() {
      await browser.close();
      await server.close();
    },
  };
}

/**
 * Ouvre l'appli dans un contexte neuf (stockage vide) et surveille :
 *  - log.errors   : erreurs de console et exceptions de la page
 *  - log.external : requêtes vers autre chose que le serveur de l'appli (audit réseau)
 *  - violations de CSP : page.evaluate(() => window.__csp)
 */
export async function openApp(env, { hash = '', viewport = { width: 1280, height: 900 }, colorScheme = 'light', query = '?nosw' } = {}) {
  const context = await env.browser.newContext({ viewport, colorScheme, acceptDownloads: true, locale: 'fr-FR' });
  const page = await context.newPage();
  const log = { errors: [], external: [] };
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} → ${e.blockedURI}`));
  });
  page.on('console', (m) => {
    if (m.type() === 'error') log.errors.push(m.text());
  });
  page.on('pageerror', (e) => log.errors.push(`exception : ${e.message}`));
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(env.server.url) && !/^(blob|data|about):/.test(u)) log.external.push(`${r.method()} ${u}`);
  });
  await page.goto(`${env.server.url}/index.html${query}${hash}`);
  return { page, context, log, url: env.server.url };
}

export const cspViolations = (page) => page.evaluate(() => window.__csp || []);

/** Lit une valeur dans la base de l'appli (la même que celle que voit le code de l'appli). */
export const dbGet = (page, store, key) =>
  page.evaluate(async ([s, k]) => {
    const { db } = await import('/src/db.js');
    return (await db.get(s, k)) ?? null;
  }, [store, key]);

export const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

/** Simule un service d'IA en ligne (réponse de la forme OpenAI) et enregistre ce qu'il reçoit. */
export async function fakeCloud(page, pattern, handler) {
  const seen = [];
  await page.route(pattern, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const entry = { method: req.method(), url: req.url(), headers: req.headers(), body: req.postData() };
    seen.push(entry);
    const r = (await handler(entry)) || { status: 200, json: {} };
    return route.fulfill({ status: r.status ?? 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(r.json ?? {}) });
  });
  return seen;
}
