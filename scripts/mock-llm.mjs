#!/usr/bin/env node
// Faux serveur d'IA pour les tests et les démonstrations hors-ligne.
// Il comprend l'API « OpenAI » (/v1/chat/completions, comme Ollama ou Groq) et l'API native Gemini,
// et fabrique ses réponses à partir des extraits reçus : les citations et les « preuves » sont donc
// vérifiables. Le nom du modèle choisit un comportement (panne, JSON cassé, limite de débit…).
//
// Usage : node scripts/mock-llm.mjs [port]
import http from 'node:http';
import { pathToFileURL } from 'node:url';

export const MOCK_MODELS = [
  'mock-small', 'mock-bad-json', 'mock-garbage-once', 'mock-429-once', 'mock-429-always', 'mock-401', 'mock-500-once',
  'mock-truncated', 'mock-think', 'mock-slow', 'mock-nojson', 'mock-split', 'mock-ungrounded',
];

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const wordsOf = (s) => fold(s).match(/[a-z0-9]{4,}/g) || [];
const sentencesOf = (t) =>
  t.replace(/^#{1,6}\s.*$/gm, ' ').replace(/\$\$[\s\S]*?\$\$/g, ' ').split(/(?<=[.!?])\s+|\n+/).map((s) => s.replace(/^[-*•]\s+/, '').trim()).filter((s) => s.length > 25);

function parseExtracts(user) {
  const m = /<extraits>\n([\s\S]*?)\n<\/extraits>/.exec(user);
  if (!m) return [];
  return m[1].split('\n\n---\n\n').map((block) => {
    const h = /^\[(\d+)\] « (.*?) »(?: — (.*))?\n([\s\S]*)$/.exec(block);
    return h ? { n: Number(h[1]), title: h[2], label: h[3] || '', text: h[4] } : null;
  }).filter(Boolean);
}

function taskOf(system) {
  const t = /Tâche : (.+)/.exec(system)?.[1] || '';
  if (/répondre à une question/.test(t)) return 'chat';
  if (/cartes mémoire/.test(t)) return 'cards';
  if (/quiz/.test(t)) return 'quiz';
  if (/document de révision/.test(t)) return 'note';
  if (/causerie/.test(t)) return 'cast';
  if (/diapositives/.test(t)) return 'slides';
  return 'other';
}

function firstWords(s, n) {
  return s.split(/\s+/).slice(0, n).join(' ');
}

function buildAnswer({ system, user }, model) {
  const task = taskOf(system);
  const ex = parseExtracts(user);
  const pool = ex.flatMap((e) => sentencesOf(e.text).map((s) => ({ s, n: e.n, title: e.title })));
  const count = (re) => Number(re.exec(user)?.[1] ?? re.exec(system)?.[1] ?? 6);

  if (task === 'chat') {
    const q = /QUESTION : ([\s\S]*)$/.exec(user)?.[1] || '';
    const qw = new Set(wordsOf(q));
    const ranked = ex.map((e) => ({ e, score: wordsOf(e.text).filter((w) => qw.has(w)).length })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
    if (!ranked.length) return 'Je ne trouve pas la réponse dans tes sources.\n\nHors de tes sources : pose ta question avec les mots du cours.';
    const parts = ranked.map(({ e }) => `${sentencesOf(e.text)[0] || firstWords(e.text, 25)} [${e.n}]`);
    const bogus = /citation bidon/i.test(q) ? ' [99]' : '';
    return `D’après tes sources :\n\n- ${parts[0]}\n${parts[1] ? `- ${parts[1]}\n` : ''}\n**À retenir** : relis bien ces passages${bogus}. Par exemple $f(x) = ax + b$.`;
  }

  if (task === 'cards') {
    const n = count(/Crée (\d+) cartes/);
    const cards = [];
    for (let i = 0; i < Math.min(n, pool.length); i++) {
      const { s, n: ref } = pool[i];
      const longest = s.match(/[\p{L}]{6,}/gu)?.sort((a, b) => b.length - a.length)[0] || firstWords(s, 1);
      const bad = model === 'mock-ungrounded' && i === 0;
      cards.push({
        recto: `Complète : ${s.replace(longest, '_____')}`,
        verso: longest,
        extrait: ref,
        preuve: bad ? 'Napoléon a perdu la bataille de Waterloo en mille huit cent quinze' : firstWords(s, 9),
      });
    }
    return JSON.stringify({ cartes: cards });
  }

  if (task === 'quiz') {
    const n = count(/Crée (\d+) questions/);
    const qs = [];
    for (let i = 0; i < Math.min(n, pool.length); i++) {
      const { s, n: ref, title } = pool[i];
      qs.push({
        question: `Quelle affirmation est tirée de « ${title} » (question ${i + 1}) ?`,
        bonne_reponse: s.slice(0, 140),
        mauvaises_reponses: [`${firstWords(s, 6)} : c’est tout le contraire.`, `Le texte ne dit rien sur « ${firstWords(s, 3)} ».`, `${firstWords(s, 4)} n’a aucun rapport avec le cours.`],
        explication: `C’est écrit dans l’extrait ${ref}.`,
        extrait: ref,
        preuve: firstWords(s, 9),
      });
    }
    return JSON.stringify({ questions: qs });
  }

  if (task === 'note') {
    const kind = /\((résumé|fiche de révision|questions fréquentes|plan détaillé)\)/.exec(system)?.[1] || 'résumé';
    const a = pool[0], b = pool[1] || pool[0];
    if (kind === 'questions fréquentes') return `### Que dit le cours ?\n${a.s} [${a.n}]\n\n### Et ensuite ?\n${b.s} [${b.n}]`;
    if (kind === 'plan détaillé') return `## 1. Les bases\n- ${firstWords(a.s, 12)} [${a.n}]\n  - ${firstWords(b.s, 8)} [${b.n}]\n\n## 2. Pour aller plus loin\n- ${firstWords(b.s, 12)} [${b.n}]`;
    return `## ${kind === 'fiche de révision' ? 'Définitions' : 'Résumé'}\n\n${a.s} [${a.n}]\n\n- ${b.s} [${b.n}]\n\nFormule : $$a = \\frac{y_2 - y_1}{x_2 - x_1}$$ [${b.n}]\n\n## À retenir\n\n- ${firstWords(a.s, 10)} [${a.n}][${b.n}]`;
  }

  if (task === 'cast') {
    const n = count(/(\d+) répliques/);
    const turns = [{ qui: 'A', texte: 'Bonjour et bienvenue ! Aujourd’hui, on révise ensemble un cours important.', extrait: 1 }];
    for (let i = 0; i < n - 2; i++) {
      const p = pool[i % pool.length];
      turns.push({ qui: i % 2 === 0 ? 'B' : 'A', texte: i % 2 === 0 ? p.s : `Si je comprends bien, ${firstWords(p.s, 14)} ?`, extrait: p.n });
    }
    turns.push({ qui: 'B', texte: 'Trois points à retenir : relis le cours, entraîne-toi, et reviens demain.', extrait: 1 });
    return JSON.stringify({ titre: 'Causerie de révision', tours: turns });
  }

  if (task === 'slides') {
    const n = count(/Écris (\d+) diapositives/);
    const slides = [];
    for (let i = 0; i < Math.min(n, Math.max(pool.length, 2)); i++) {
      const p = pool[i % pool.length];
      slides.push({
        titre: i === 0 ? 'Introduction' : `Idée ${i}`,
        points: [firstWords(p.s, 8), firstWords(p.s.split(' ').slice(8).join(' ') || p.s, 6)],
        formule: i === 1 ? 'f(x) = ax + b' : '',
        narration: `${p.s} Retiens bien cette idée avant de passer à la suite.`,
        extrait: p.n,
      });
    }
    return JSON.stringify({ titre: 'Cours en diapositives', diapos: slides });
  }
  return 'ok';
}

function splitChunks(text, size = 14) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [''];
}

export function createMockServer({ port = 0, requireKey = null, log = false } = {}) {
  const requests = [];
  const counters = {};
  const hit = (k) => (counters[k] = (counters[k] || 0) + 1);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type, x-goog-api-key',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Expose-Headers': 'retry-after',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end();
      return;
    }
    let raw = '';
    for await (const c of req) raw += c;
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      /* corps non JSON */
    }
    requests.push({ method: req.method, path: url.pathname, query: url.search, headers: req.headers, body });
    if (log) console.log(req.method, url.pathname);

    const send = (status, obj, extra = {}) => res.writeHead(status, { 'Content-Type': 'application/json', ...cors, ...extra }).end(JSON.stringify(obj));
    const isGemini = url.pathname.startsWith('/v1beta/');
    const keyOk = !requireKey || (isGemini ? req.headers['x-goog-api-key'] === requireKey : req.headers.authorization === `Bearer ${requireKey}`);
    if (!keyOk) return send(401, { error: { message: 'Invalid API key' } });

    // ---------------------------------------------------------------- listes de modèles
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      return send(200, { object: 'list', data: [...MOCK_MODELS.map((id) => ({ id })), { id: 'whisper-large-v3' }, { id: 'vendor/free-one:free', pricing: { prompt: '0', completion: '0' } }, { id: 'vendor/paid-one', pricing: { prompt: '0.001', completion: '0.002' } }] });
    }
    if (req.method === 'GET' && url.pathname === '/v1beta/models') {
      return send(200, { models: [
        { name: 'models/gemini-mock-flash', displayName: 'Gemini Mock Flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-mock-embedding', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
      ] });
    }

    // ---------------------------------------------------------------- génération
    const gm = /^\/v1beta\/models\/([^:]+):(generateContent|streamGenerateContent)$/.exec(url.pathname);
    const isChat = req.method === 'POST' && url.pathname === '/v1/chat/completions';
    if (!isChat && !gm) return send(404, { error: { message: 'not found' } });

    const model = isChat ? body?.model : decodeURIComponent(gm[1]);
    const stream = isChat ? !!body?.stream : gm[2] === 'streamGenerateContent';
    let system = '';
    let user = '';
    if (isChat) {
      system = (body.messages || []).filter((m) => m.role === 'system').map((m) => m.content).join('\n');
      user = (body.messages || []).filter((m) => m.role === 'user').map((m) => m.content).join('\n---\n');
    } else {
      system = body?.systemInstruction?.parts?.map((p) => p.text).join('\n') || '';
      user = (body?.contents || []).filter((c) => c.role === 'user').map((c) => c.parts.map((p) => p.text).join('')).join('\n---\n');
    }
    // le dernier message utilisateur contient les extraits
    const lastUser = isChat ? [...(body.messages || [])].reverse().find((m) => m.role === 'user')?.content || '' : (body?.contents || []).filter((c) => c.role === 'user').pop()?.parts.map((p) => p.text).join('') || '';
    const task = taskOf(system);
    const wantsJson = ['cards', 'quiz', 'cast', 'slides'].includes(task);

    // pannes simulées
    if (model === 'mock-401') return send(401, { error: { message: 'Invalid API Key' } });
    if (model === 'mock-429-always') return send(429, { error: { message: 'Rate limit reached' } }, { 'Retry-After': '60' });
    if (model === 'mock-429-once' && hit('429') === 1) return send(429, { error: { message: 'Rate limit reached' } }, { 'Retry-After': '1' });
    if (model === 'mock-500-once' && hit('500') === 1) return send(500, { error: { message: 'Internal error' } });
    if (model === 'mock-nojson' && isChat && body?.response_format) return send(400, { error: { message: 'response_format is not supported by this model' } });
    if (!MOCK_MODELS.includes(model) && !/gemini-mock/.test(model)) return send(404, { error: { message: `The model \`${model}\` does not exist` } });
    if (model === 'mock-slow') await new Promise((r) => setTimeout(r, 2500));

    let text = buildAnswer({ system, user: lastUser }, model);
    let finish = 'stop';
    if (model === 'mock-garbage-once' && wantsJson && hit('garbage') === 1) text = 'Désolé, je ne peux pas faire cela.';
    if (model === 'mock-bad-json' && wantsJson) text = `Voici ton résultat :\n\`\`\`json\n${text.replace(/\}(?=\s*$)/, ',}').replace(/\](?=\s*[,}])/, ',]')}\n\`\`\`\nBonne révision !`;
    if (model === 'mock-truncated' && wantsJson) {
      text = text.slice(0, Math.floor(text.length * 0.72));
      finish = 'length';
    }
    if (model === 'mock-think') text = `<think>Je dois réfléchir à { quelque chose } avant de répondre.</think>\n${text}`;

    const gem = (t, fin) => ({ candidates: [{ content: { role: 'model', parts: [{ text: t }] }, ...(fin ? { finishReason: fin === 'length' ? 'MAX_TOKENS' : 'STOP' } : {}) }] });
    const oa = (t, fin) => ({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: t ? { content: t } : {}, finish_reason: fin || null }] });

    if (!stream) {
      if (isChat) return send(200, { id: 'mock', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: finish }] });
      return send(200, gem(text, finish));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...cors });
    if (isChat) res.write(': keep-alive\n\n');
    const parts = splitChunks(text);
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1;
      const ev = `data: ${JSON.stringify(isChat ? oa(parts[i]) : gem(parts[i], last ? finish : null))}\n\n`;
      if (model === 'mock-split') {
        const cut = Math.floor(ev.length / 2);
        res.write(ev.slice(0, cut));
        await new Promise((r) => setTimeout(r, 1));
        res.write(ev.slice(cut));
      } else res.write(ev);
      if (i % 25 === 24) await new Promise((r) => setTimeout(r, 1));
    }
    if (isChat) res.write(`data: ${JSON.stringify(oa('', finish))}\n\ndata: [DONE]\n\n`);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: p } = server.address();
      resolve({
        server,
        port: p,
        url: `http://127.0.0.1:${p}`,
        openaiBase: `http://127.0.0.1:${p}/v1`,
        geminiBase: `http://127.0.0.1:${p}/v1beta`,
        requests,
        reset: () => { requests.length = 0; for (const k of Object.keys(counters)) delete counters[k]; },
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
      });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const port = Number(process.argv[2] || 11500);
  const m = await createMockServer({ port, log: true });
  console.log(`Faux serveur d’IA prêt : ${m.openaiBase}  (Gemini : ${m.geminiBase})`);
  console.log('Modèles :', MOCK_MODELS.join(', '));
}
