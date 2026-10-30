// Tests de l'import dans un vrai navigateur (Chromium) : ce que Node ne peut pas vérifier.
//   node --test test/browser/import.browser.test.mjs
// Nécessite Playwright (npm i -D playwright && npx playwright install chromium).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer } from '../../scripts/serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');

let server;
let browser;
let page;
const external = [];
const pageErrors = [];
const violations = [];

before(async () => {
  server = await startServer();
  browser = await chromium.launch();
  page = await browser.newPage();
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(server.url) && !u.startsWith('blob:') && !u.startsWith('data:') && u !== 'about:blank') external.push(u);
  });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) violations.push(m.text().slice(0, 200));
  });
  await page.goto(`${server.url}/test/browser/blank.html`);
});

after(async () => {
  await browser?.close();
  await server?.close();
});

/** Distance de Levenshtein normalisée (0 = identique) entre deux textes, espaces et casse ignorés. */
const cer = (a, b) => {
  const x = a.toLowerCase().replace(/\s+/g, ' ').trim();
  const y = b.toLowerCase().replace(/\s+/g, ' ').trim();
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  return d[x.length][y.length] / Math.max(1, y.length);
};

const EXPECTED_PHOTO = [
  'La photosynthèse se déroule dans les chloroplastes.',
  'Les plantes vertes fabriquent de la matière organique.',
  'La chlorophylle absorbe la lumière rouge et bleue.',
  'Le dioxygène est libéré par les stomates des feuilles.',
].join(' ');

/** Charge un fichier de test dans la page sous forme de File. */
const loadFile = `async (name) => new File([await (await fetch('/test/fixtures/' + name)).blob()], name)`;

test('HTML → texte structuré : titres, liste, tableau ; navigation, scripts et styles retirés', async () => {
  const r = await page.evaluate(async () => {
    const { htmlToMarkdown } = await import('/src/import/plain.js');
    return htmlToMarkdown(await (await fetch('/test/fixtures/page.html')).text());
  });
  assert.equal(r.title, 'Page de cours');
  assert.equal(
    r.text,
    '# Le volcanisme\n\nUn volcan est un relief formé par l’accumulation de matériaux issus du manteau.\n\n## Les types d’éruption\n\n- Éruption effusive\n- Éruption explosive\n\n| Type | Lave |\n| Effusive | Fluide |'
  );
});

test('HTML avec <style> et style="…" : lu sans violer la règle de sécurité, texte conservé', async () => {
  const r = await page.evaluate(async () => {
    const { htmlToMarkdown } = await import('/src/import/plain.js');
    return htmlToMarkdown(`<html><head><title>Cours CSS</title><style>p { color: red }</style></head><body>
      <h1 style="color:blue">Les styles</h1>
      <p style='margin:0'>On écrit style="color:red" dans la balise, comme dans l'exemple.</p></body></html>`);
  });
  await new Promise((res) => setTimeout(res, 150));
  assert.match(r.text, /^# Les styles/);
  assert.match(r.text, /On écrit style="color:red" dans la balise/, 'le texte qui parle de style="…" reste intact');
  assert.doesNotMatch(r.text, /color: red \}/);
});

test('HTML hostile : rien ne s’exécute, rien n’est chargé', async () => {
  const before = external.length;
  const r = await page.evaluate(async () => {
    const { htmlToMarkdown } = await import('/src/import/plain.js');
    window.__pwned = false;
    const html = `<html><body>
      <img src="https://tracker.example/pixel.gif" onerror="window.__pwned=true">
      <script>window.__pwned = true</script>
      <iframe src="https://evil.example/"></iframe>
      <a href="javascript:window.__pwned=true">lien piégé</a>
      <p onclick="window.__pwned=true">Texte du cours</p>
      <math><semantics><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow><annotation encoding="application/x-tex">x+1</annotation></semantics></math>
      <script type="math/tex">a^2+b^2=c^2</script>
      </body></html>`;
    const out = htmlToMarkdown(html);
    await new Promise((res) => setTimeout(res, 300));
    return { out, pwned: window.__pwned };
  });
  assert.equal(r.pwned, false);
  assert.match(r.out.text, /Texte du cours/);
  assert.match(r.out.text, /lien piégé/);
  assert.match(r.out.text, /\$x\+1\$/);
  assert.match(r.out.text, /\$a\^2\+b\^2=c\^2\$/);
  assert.equal(external.length, before, `requêtes externes inattendues : ${external.slice(before)}`);
});

test('PDF dans le navigateur (worker PDF.js réel) : même résultat que sous Node', async () => {
  const r = await page.evaluate(`(async () => {
    const { createImporter } = await import('/src/import/index.js');
    const imp = createImporter({ ocr: 'never' });
    const res = await imp.importFile(await (${loadFile})('cours-numerique.pdf'));
    await imp.close();
    return { labels: res.pages.map((p) => p.label), first: res.pages[0].text, list: res.pages[1].text, warnings: res.warnings };
  })()`);
  assert.deepEqual(r.labels, ['p. 1 · Les réseaux informatiques', 'p. 1 · Les protocoles', 'p. 2 · Sécurité']);
  assert.match(r.first, /^# Les réseaux informatiques/);
  assert.match(r.list, /\n- TCP assure la fiabilité des échanges\.\n- UDP privilégie la rapidité\./);
  assert.deepEqual(r.warnings, []);
});

test('OCR d’une photo de cours (modèle français embarqué) avec et sans suppression des ombres', { timeout: 240000 }, async () => {
  const out = await page.evaluate(`(async () => {
    const { createOcr, prepareForOcr } = await import('/src/import/ocr.js');
    const file = await (${loadFile})('photo.png');
    const t0 = performance.now();
    const ocr = await createOcr({});
    const tReady = performance.now() - t0;
    const t1 = performance.now();
    const a = await ocr.recognize(file); // avec prétraitement
    const tA = performance.now() - t1;
    const rawCanvas = await prepareForOcr(file, { flatten: false });
    const b = await ocr.recognize(rawCanvas, { prepare: false });
    await ocr.close();
    return { a: { text: a.text, conf: a.confidence, ms: Math.round(tA) }, b: { text: b.text, conf: b.confidence }, readyMs: Math.round(tReady) };
  })()`);
  const ea = cer(out.a.text, EXPECTED_PHOTO);
  const eb = cer(out.b.text, EXPECTED_PHOTO);
  console.log(`  OCR photo : démarrage ${out.readyMs} ms, lecture ${out.a.ms} ms ; erreur avec prétraitement ${(ea * 100).toFixed(1)} % (confiance ${out.a.conf}), sans ${(eb * 100).toFixed(1)} % (confiance ${out.b.conf})`);
  console.log(`  texte lu : ${JSON.stringify(out.a.text)}`);
  assert.ok(ea < 0.05, `trop d'erreurs de lecture : ${(ea * 100).toFixed(1)} %`);
  assert.ok(ea <= eb + 0.01, 'le prétraitement ne doit pas dégrader la lecture');
});

const EXPECTED_HARD = [
  'Les fonctions affines',
  'Une fonction affine est de la forme f(x) = ax + b.',
  'Le coefficient directeur a donne la pente de la droite.',
  'Si a est positif, la fonction est croissante.',
  'L’ordonnée à l’origine b est la valeur de f(0).',
  'Sa représentation graphique est toujours une droite.',
].join(' ');

test('OCR d’une photo difficile (cahier quadrillé, ombre, JPEG médiocre) : la suppression des ombres est indispensable', { timeout: 240000 }, async () => {
  const out = await page.evaluate(`(async () => {
    const { createOcr, prepareForOcr } = await import('/src/import/ocr.js');
    const file = await (${loadFile})('photo-ombre.jpg');
    const ocr = await createOcr({});
    const flat = await ocr.recognize(file); // prétraitement complet
    const plain = await ocr.recognize(await prepareForOcr(file, { flatten: false }), { prepare: false });
    await ocr.close();
    return { flat: flat.text, flatConf: flat.confidence, plain: plain.text };
  })()`);
  const withFlat = cer(out.flat, EXPECTED_HARD);
  const without = cer(out.plain, EXPECTED_HARD);
  console.log(`  photo difficile : erreur ${(withFlat * 100).toFixed(1)} % avec suppression des ombres (confiance ${out.flatConf}), ${(without * 100).toFixed(1)} % sans`);
  assert.ok(withFlat < 0.15, `trop d'erreurs : ${(withFlat * 100).toFixed(1)} % — ${out.flat}`);
  assert.ok(withFlat < without - 0.2, 'la suppression des ombres doit améliorer nettement la lecture');
});

test('import d’une image par l’importateur : texte, confiance, titre', { timeout: 240000 }, async () => {
  const r = await page.evaluate(`(async () => {
    const { createImporter } = await import('/src/import/index.js');
    const imp = createImporter();
    const res = await imp.importFile(await (${loadFile})('photo.png'));
    await imp.close();
    return { title: res.title, kind: res.kind, pages: res.pages, meta: res.meta, warnings: res.warnings };
  })()`);
  assert.equal(r.kind, 'image');
  assert.equal(r.title, 'photo');
  assert.ok(cer(r.pages[0].text, EXPECTED_PHOTO) < 0.05, r.pages[0].text);
  assert.ok(r.meta.ocrConfidence >= 70, `confiance ${r.meta.ocrConfidence}`);
});

test('PDF scanné lu par OCR (rendu de page PDF.js → Tesseract)', { timeout: 300000 }, async () => {
  const r = await page.evaluate(`(async () => {
    const { createImporter } = await import('/src/import/index.js');
    const imp = createImporter({ ocr: 'auto', confirmOcr: ({ pages }) => pages === 1 });
    const events = [];
    const t0 = performance.now();
    const res = await imp.importFile(await (${loadFile})('scan.pdf'), { onProgress: (p) => events.push(p.phase + ':' + p.done + '/' + p.total) });
    await imp.close();
    return { pages: res.pages, meta: res.meta, warnings: res.warnings, events, ms: Math.round(performance.now() - t0) };
  })()`);
  console.log(`  PDF scanné : ${r.ms} ms, confiance ${r.meta.ocrConfidence}, événements ${r.events.join(' ')}`);
  assert.deepEqual(r.meta.ocrPages, [1]);
  assert.equal(r.pages[0].label, 'p. 1');
  assert.ok(cer(r.pages[0].text, EXPECTED_PHOTO) < 0.06, r.pages[0].text);
  assert.ok(r.events.some((e) => e.startsWith('ocr:')));
});

test('PDF scanné : l’utilisateur refuse l’OCR → erreur claire, rien n’est lu', { timeout: 120000 }, async () => {
  const msg = await page.evaluate(`(async () => {
    const { createImporter } = await import('/src/import/index.js');
    const imp = createImporter({ ocr: 'auto', confirmOcr: () => false });
    try { await imp.importFile(await (${loadFile})('scan.pdf')); return 'AUCUNE ERREUR'; } catch (e) { return e.code + ' | ' + e.message; } finally { await imp.close(); }
  })()`);
  assert.match(msg, /^empty \| .*scan.*OCR/);
});

test('audit : aucune requête vers un site tiers, aucune erreur de page, aucune violation de la règle de sécurité', () => {
  assert.deepEqual(external, []);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(violations, []);
});
