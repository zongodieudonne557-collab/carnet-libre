import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION } from '../../src/version.js';
import { allowedByCsp, connectOrigins, PROVIDERS } from '../../src/ai/providers.js';

test('la version de l’appli est la même que dans package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(APP_VERSION, pkg.version);
});

test('allowedByCsp : ton ordinateur et les services connus, rien d’autre', () => {
  assert.equal(allowedByCsp('http://localhost:11434/v1'), true);
  assert.equal(allowedByCsp('http://127.0.0.1:1234/v1'), true);
  assert.equal(allowedByCsp('https://api.groq.com/openai/v1'), true);
  assert.equal(allowedByCsp('http://api.groq.com/openai/v1'), false, 'jamais en clair vers un service en ligne');
  assert.equal(allowedByCsp('https://exemple.org/v1'), false);
  assert.equal(allowedByCsp('http://192.168.1.20:1234/v1'), false, 'un autre appareil du réseau local est bloqué aussi');
  assert.equal(allowedByCsp('ftp://localhost/'), false);
  assert.equal(allowedByCsp('pas une adresse'), false);
  assert.equal(allowedByCsp(''), false);
});

test('la règle de sécurité de index.html autorise exactement les services déclarés', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  const connect = /connect-src ([^;]+)/.exec(csp)[1].split(/\s+/);
  for (const origin of connectOrigins()) assert.ok(connect.includes(origin), `${origin} manque dans connect-src`);
  const declared = new Set(Object.values(PROVIDERS).map((p) => p.connectOrigin).filter(Boolean));
  for (const src of connect.filter((x) => x.startsWith('https://'))) assert.ok(declared.has(src), `${src} est autorisé sans fournisseur déclaré`);
});
