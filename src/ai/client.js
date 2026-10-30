// Client d'IA : dialogue avec un serveur compatible OpenAI (Ollama, Groq, OpenRouter, Mistral…)
// ou avec l'API native de Google Gemini. Streaming, nouvelles tentatives et messages d'erreur
// en français qui disent quoi faire.
import { getSettings, getApiKey, hasConsent } from '../settings.js';
import { PROVIDERS } from './providers.js';
import { sleep } from '../util.js';

export class AIError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'AIError';
    this.kind = kind; // config | consent | network | timeout | auth | rate | model | bad | server | blocked | abort
    Object.assign(this, extra);
  }
}

/** Retire les blocs de réflexion « <think>…</think> » de certains modèles. */
export function stripThink(text) {
  return String(text ?? '')
    .replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
    .replace(/<think>[\s\S]*$/i, '');
}

export function resolveConfig(settings = getSettings(), key = getApiKey(settings.ai.provider)) {
  const a = settings.ai;
  const p = PROVIDERS[a.provider];
  if (!p || p.kind === 'none') throw new AIError('config', 'Aucune IA n’est branchée. Ouvre les Réglages pour en choisir une.');
  const baseUrl = String(p.id === 'custom' ? a.baseUrl : p.baseUrl || '').trim().replace(/\/+$/, '');
  if (!baseUrl) throw new AIError('config', 'Indique l’adresse du serveur dans les Réglages.');
  if (!/^https?:\/\//i.test(baseUrl)) throw new AIError('config', 'L’adresse du serveur doit commencer par http:// ou https://.');
  if (p.needsKey && !key) throw new AIError('config', `Colle ta clé ${p.short} dans les Réglages.`);
  return { provider: p, baseUrl, key, model: String(a.model || '').replace(/^models\//, ''), temperature: a.temperature ?? 0.4, onlyFree: a.onlyFree };
}

function needModel(cfg) {
  if (!cfg.model) throw new AIError('config', 'Choisis un modèle dans les Réglages (bouton « Actualiser la liste »).');
}

/**
 * Dernier garde-fou : un service en ligne ne reçoit RIEN tant que la personne n'a pas accepté ses
 * conditions d'envoi. Vérifié ici, au moment d'envoyer, quel que soit le chemin qui a mené jusque-là.
 */
function requireConsent(cfg) {
  const p = cfg.provider;
  if (p?.kind === 'cloud' && !hasConsent(p.id)) {
    throw new AIError('consent', `Avant d’envoyer tes cours à ${p.short}, accepte ses conditions d’envoi (une seule fois).`, { providerId: p.id });
  }
}

// ------------------------------------------------------------------ requêtes

function openaiRequest(cfg, { messages, stream, json, maxTokens, temperature }, noJson) {
  const body = { model: cfg.model, messages, stream: !!stream, temperature, max_tokens: maxTokens };
  if (json && cfg.provider.jsonMode && !noJson) body.response_format = { type: 'json_object' };
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.key) headers.Authorization = `Bearer ${cfg.key}`;
  return { url: `${cfg.baseUrl}/chat/completions`, init: { method: 'POST', headers, body: JSON.stringify(body) } };
}

function geminiRequest(cfg, { messages, stream, json, maxTokens, temperature }) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const role = m.role === 'assistant' ? 'model' : 'user';
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push({ text: m.content });
    else contents.push({ role, parts: [{ text: m.content }] });
  }
  // Les modèles « à réflexion » comptent leurs jetons de réflexion dans la limite : on garde de la marge.
  const body = { contents, generationConfig: { temperature, maxOutputTokens: Math.max(maxTokens * 2, 4096) } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (json) body.generationConfig.responseMimeType = 'application/json';
  const path = stream ? `models/${encodeURIComponent(cfg.model)}:streamGenerateContent?alt=sse` : `models/${encodeURIComponent(cfg.model)}:generateContent`;
  return {
    url: `${cfg.baseUrl}/${path}`,
    init: { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key }, body: JSON.stringify(body) },
  };
}

// ------------------------------------------------------------------ erreurs

async function readErrorDetail(res) {
  try {
    const raw = await res.text();
    try {
      const j = JSON.parse(raw);
      const msg = j?.error?.message ?? j?.message ?? j?.detail ?? (typeof j?.error === 'string' ? j.error : '');
      return String(msg || raw).slice(0, 300);
    } catch {
      return raw.slice(0, 300);
    }
  } catch {
    return '';
  }
}

function retryAfterMs(res) {
  const h = res.headers.get('retry-after');
  if (!h) return 0;
  const n = Number(h);
  return Number.isFinite(n) ? n * 1000 : Math.max(0, Date.parse(h) - Date.now()) || 0;
}

function httpError(status, detail, cfg, waitMs) {
  const name = cfg.provider.short;
  if (status === 401 || status === 403)
    return new AIError('auth', `${name} a refusé la clé (erreur ${status}). Vérifie qu’elle est copiée en entier et encore valable, et que le service est disponible dans ton pays.${detail ? ` Détail : ${detail}` : ''}`, { status });
  if (status === 429)
    return new AIError('rate', `Limite gratuite atteinte chez ${name}. Attends ${waitMs ? `environ ${Math.ceil(waitMs / 1000)} secondes` : 'un peu (les limites se remettent à zéro chaque minute ou chaque jour)'} puis réessaie. Tu peux aussi réduire « la quantité de texte envoyée » dans les Réglages.`, { status, retryAfter: waitMs });
  if (status === 404 || (status === 400 && /model/i.test(detail) && /(not found|does not exist|not supported|unknown|invalid)/i.test(detail)))
    return new AIError('model', `Le modèle « ${cfg.model} » n’existe pas chez ${name} ou n’est pas accessible avec ta clé. Choisis-en un autre dans la liste (bouton « Actualiser »).`, { status });
  if (status === 402) return new AIError('rate', `${name} demande des crédits pour ce modèle. Choisis un modèle gratuit.`, { status });
  if (status >= 500) return new AIError('server', `${name} rencontre un problème (erreur ${status}). Réessaie dans un instant.`, { status });
  return new AIError('bad', `${name} a refusé la requête (erreur ${status})${detail ? ` : ${detail}` : '.'}`, { status });
}

function networkError(cfg) {
  const name = cfg.provider.short;
  if (cfg.provider.kind === 'local')
    return new AIError('network', `Impossible de joindre ${name} (${cfg.baseUrl}). Vérifie qu’il est lancé. Si tu utilises Carnet Libre depuis un site, autorise ce site avec la variable OLLAMA_ORIGINS (voir les Réglages).`);
  return new AIError('network', `Impossible de joindre ${name}. Vérifie ta connexion Internet. Si elle fonctionne, ce service refuse peut-être les appels faits depuis un navigateur : essaie un autre fournisseur.`);
}

// ------------------------------------------------------------------ lecture de la réponse

async function* sseData(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const NL = /\r?\n/;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      for (let m = NL.exec(buf); m; m = NL.exec(buf)) {
        const line = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
    }
    buf += dec.decode();
    if (buf.startsWith('data:')) yield buf.slice(5).trim();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* déjà libéré */
    }
  }
}

const isTruncated = (reason) => /^(length|max_tokens)$/i.test(String(reason || ''));

function openaiText(json) {
  const choice = json?.choices?.[0];
  return { text: choice?.message?.content ?? choice?.text ?? '', finishReason: choice?.finish_reason ?? null };
}

function geminiParts(json) {
  const cand = json?.candidates?.[0];
  const text = (cand?.content?.parts || []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  return { text, finishReason: cand?.finishReason ?? null, blocked: json?.promptFeedback?.blockReason || (cand?.finishReason === 'SAFETY' ? 'SAFETY' : null) };
}

/**
 * Envoie une conversation au modèle choisi.
 * @param {object} o
 * @param {{role: 'system'|'user'|'assistant', content: string}[]} o.messages
 * @param {boolean} [o.stream]            lecture en direct
 * @param {boolean} [o.json]              demande une réponse JSON
 * @param {number}  [o.maxTokens]
 * @param {number}  [o.temperature]
 * @param {AbortSignal} [o.signal]
 * @param {(visibleText: string) => void} [o.onToken]   texte cumulé, sans les blocs de réflexion
 * @param {(msg: string) => void} [o.onStatus]
 * @param {object} [o.config]             configuration déjà résolue (tests)
 * @param {number} [o.timeoutMs]
 * @param {number} [o.retryDelayMs]       délai fixe avant une nouvelle tentative (tests) ; sinon Retry-After ou 2 s
 * @param {boolean} [o.probe]             test de connexion : aucun extrait de cours n'est envoyé, le consentement n'est pas exigé
 * @returns {Promise<{text: string, finishReason: string|null, truncated: boolean}>}
 */
export async function chat(o) {
  const cfg = o.config || resolveConfig();
  needModel(cfg);
  if (!o.probe) requireConsent(cfg); // `probe` : simple test de connexion, sans aucun extrait de cours
  const { messages, stream = false, json = false, signal, onToken, onStatus } = o;
  const maxTokens = o.maxTokens ?? 2048;
  const temperature = o.temperature ?? cfg.temperature;
  const idleMs = o.timeoutMs ?? (stream ? 60_000 : 120_000);
  let noJson = false;
  let attempts = 0;

  for (;;) {
    attempts++;
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort(signal.reason);
    if (signal) {
      if (signal.aborted) throw new AIError('abort', 'Annulé.');
      signal.addEventListener('abort', onAbort, { once: true });
    }
    let timedOut = false;
    let timer;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, idleMs);
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const fail = (e) => {
      cleanup();
      if (signal?.aborted) return new AIError('abort', 'Annulé.');
      if (timedOut) return new AIError('timeout', `${cfg.provider.short} met trop de temps à répondre. Réessaie, ou choisis un modèle plus petit.`);
      if (e instanceof AIError) return e;
      return networkError(cfg);
    };

    const req = (cfg.provider.protocol === 'gemini' ? geminiRequest : openaiRequest)(cfg, { messages, stream, json, maxTokens, temperature }, noJson);
    arm();
    let res;
    try {
      res = await fetch(req.url, { ...req.init, signal: ctrl.signal });
    } catch (e) {
      throw fail(e);
    }

    if (!res.ok) {
      const detail = await readErrorDetail(res);
      cleanup();
      if (res.status === 400 && json && !noJson && cfg.provider.protocol === 'openai' && /response_format|json/i.test(detail)) {
        noJson = true; // ce serveur ne gère pas le mode JSON : on réessaie sans
        continue;
      }
      const wait = retryAfterMs(res);
      if (res.status === 429 && attempts <= 2 && wait <= 25_000) {
        const ms = o.retryDelayMs ?? Math.max(wait, 2000);
        onStatus?.(`Limite atteinte chez ${cfg.provider.short} : nouvelle tentative dans ${Math.ceil(ms / 1000)} s…`);
        await sleep(ms, signal).catch(() => {
          throw new AIError('abort', 'Annulé.');
        });
        continue;
      }
      if (res.status >= 500 && attempts <= 2) {
        await sleep(o.retryDelayMs ?? 1500, signal).catch(() => {
          throw new AIError('abort', 'Annulé.');
        });
        continue;
      }
      throw httpError(res.status, detail, cfg, wait);
    }

    try {
      let text = '';
      let finishReason = null;
      let blocked = null;
      if (stream && res.body) {
        for await (const data of sseData(res)) {
          arm();
          if (!data || data === '[DONE]') continue;
          let j;
          try {
            j = JSON.parse(data);
          } catch {
            continue;
          }
          if (j?.error) throw new AIError('bad', `${cfg.provider.short} : ${String(j.error.message || j.error).slice(0, 200)}`);
          if (cfg.provider.protocol === 'gemini') {
            const g = geminiParts(j);
            text += g.text;
            if (g.finishReason) finishReason = g.finishReason;
            if (g.blocked) blocked = g.blocked;
          } else {
            const ch = j?.choices?.[0];
            if (ch?.delta?.content) text += ch.delta.content;
            else if (typeof ch?.text === 'string') text += ch.text;
            if (ch?.finish_reason) finishReason = ch.finish_reason;
          }
          onToken?.(stripThink(text));
        }
      } else {
        const j = await res.json();
        if (cfg.provider.protocol === 'gemini') {
          const g = geminiParts(j);
          ({ text, finishReason, blocked } = g);
        } else ({ text, finishReason } = openaiText(j));
        onToken?.(stripThink(text));
      }
      cleanup();
      if (blocked && !text) throw new AIError('blocked', 'Le modèle a refusé de répondre (filtre de sécurité). Reformule ta demande.');
      const visible = stripThink(text);
      if (!visible.trim() && isTruncated(finishReason))
        throw new AIError('bad', 'Le modèle a utilisé toute sa limite de longueur à « réfléchir » sans répondre. Choisis un modèle sans réflexion (ou plus petit).');
      return { text: visible, finishReason, truncated: isTruncated(finishReason) };
    } catch (e) {
      throw fail(e);
    }
  }
}

// ------------------------------------------------------------------ liste des modèles

const EXCLUDE_GENERIC = /(whisper|tts|guard|embed|moderation|rerank|transcri|speech|orpheus|dall-e|image|veo|imagen|aqa|ocr)/i;

/** @returns {Promise<{id: string, label: string}[]>} */
export async function listModels(config) {
  const cfg = config || resolveConfig();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    let res;
    try {
      if (cfg.provider.protocol === 'gemini') res = await fetch(`${cfg.baseUrl}/models?pageSize=200`, { headers: { 'x-goog-api-key': cfg.key }, signal: ctrl.signal });
      else res = await fetch(`${cfg.baseUrl}/models`, { headers: cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}, signal: ctrl.signal });
    } catch {
      throw networkError(cfg);
    }
    if (!res.ok) throw httpError(res.status, await readErrorDetail(res), { ...cfg, model: '(liste)' }, retryAfterMs(res));
    const j = await res.json();
    let out;
    if (cfg.provider.protocol === 'gemini') {
      out = (j.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && !EXCLUDE_GENERIC.test(m.name))
        .map((m) => ({ id: String(m.name).replace(/^models\//, ''), label: m.displayName || m.name }));
    } else {
      const rows = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : [];
      out = rows.map((m) => ({ id: m.id || m.name || m.model, label: m.name || m.id, pricing: m.pricing })).filter((m) => m.id);
      if (cfg.provider.id === 'openrouter') {
        if (cfg.onlyFree !== false) out = out.filter((m) => /:free$/.test(m.id) || m.id === 'openrouter/free' || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0));
        out.sort((a, b) => (a.id === 'openrouter/free' ? -1 : b.id === 'openrouter/free' ? 1 : 0));
      }
      if (cfg.provider.kind === 'cloud') out = out.filter((m) => !EXCLUDE_GENERIC.test(m.id));
    }
    return out.map(({ id, label }) => ({ id, label: label === id ? id : `${label} (${id})` })).sort((a, b) => (a.id === 'openrouter/free' ? -1 : b.id === 'openrouter/free' ? 1 : a.id.localeCompare(b.id)));
  } catch (e) {
    if (e instanceof AIError) throw e;
    throw networkError(cfg);
  } finally {
    clearTimeout(timer);
  }
}

/** Vérifie la connexion : liste les modèles, puis demande un mot au modèle choisi. */
export async function testConnection(config) {
  const cfg = config || resolveConfig();
  const models = await listModels(cfg);
  let reply = null;
  if (cfg.model) {
    const r = await chat({ config: cfg, probe: true, messages: [{ role: 'user', content: 'Réponds uniquement par le mot : ok' }], maxTokens: 16, temperature: 0 });
    reply = r.text.trim().slice(0, 40);
  }
  return { ok: true, models, reply };
}
