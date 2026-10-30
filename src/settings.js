// Réglages de l'appli. Les clés d'API ne sont enregistrées sur l'appareil que si la personne
// coche « Mémoriser » ; sinon elles restent en mémoire et disparaissent à la fermeture de l'onglet.
// Une clé est TOUJOURS rattachée à son fournisseur : la clé de Groq ne peut jamais partir vers
// Gemini ni vers une adresse perso saisie plus tard.
import { db } from './db.js';

export const CONSENT_VERSION = 1;

const DEFAULTS = {
  ai: {
    provider: 'none', // none | ollama | groq | gemini | openrouter | mistral | custom
    baseUrl: '', // pour « custom »
    model: '',
    models: {}, // dernier modèle choisi pour chaque fournisseur (providerId → modèle)
    remember: false,
    budget: 'medium',
    temperature: 0.4,
    onlyFree: true, // OpenRouter : ne lister que les modèles gratuits
  },
  tts: { rate: 1, voiceA: '', voiceB: '' },
  ui: { theme: 'auto', fontScale: 1, welcomed: false },
  consent: {}, // providerId → { version, at }
};

let state = structuredClone(DEFAULTS);
let keys = {}; // providerId → clé d'API
const listeners = new Set();

function merge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
  }
  return out;
}

export async function loadSettings() {
  keys = {};
  try {
    const row = await db.get('settings', 'app');
    state = merge(DEFAULTS, row?.value || {});
    if (state.ai.remember) {
      const secret = (await db.get('settings', 'secret'))?.value;
      if (secret && typeof secret === 'object') keys = { ...secret };
      else if (typeof secret === 'string' && secret) keys = { [state.ai.provider]: secret }; // ancien format : une seule clé
    }
  } catch {
    state = structuredClone(DEFAULTS);
  }
  return state;
}

export const getSettings = () => state;

/** Clé d'API d'un fournisseur (par défaut, celui qui est choisi). */
export const getApiKey = (providerId = state.ai.provider) => keys[providerId] || '';

function emit() {
  for (const fn of listeners) {
    try {
      fn(state);
    } catch (e) {
      console.error(e);
    }
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function persistKeys() {
  if (state.ai.remember && Object.keys(keys).length) await db.put('settings', { key: 'secret', value: { ...keys } });
  else await db.delete('settings', 'secret');
}

export async function updateSettings(patch) {
  state = merge(state, patch);
  await db.put('settings', { key: 'app', value: state });
  if (!state.ai.remember) await db.delete('settings', 'secret');
  emit();
  return state;
}

/**
 * Enregistre la clé d'API d'un fournisseur (sur l'appareil seulement si `remember`).
 * Une clé vide l'oublie.
 */
export async function setApiKey(key, remember, providerId = state.ai.provider) {
  const k = String(key || '').trim();
  if (k) keys[providerId] = k;
  else delete keys[providerId];
  state = merge(state, { ai: { remember: !!remember } });
  await db.put('settings', { key: 'app', value: state });
  await persistKeys();
  emit();
}

export function hasConsent(providerId) {
  const c = state.consent[providerId];
  return !!c && c.version === CONSENT_VERSION;
}

export const giveConsent = (providerId) => updateSettings({ consent: { [providerId]: { version: CONSENT_VERSION, at: Date.now() } } });

export async function revokeConsent(providerId) {
  const consent = { ...state.consent };
  delete consent[providerId];
  state = { ...state, consent };
  await db.put('settings', { key: 'app', value: state });
  emit();
}

/** Remet les réglages à zéro (utilisé après l'effacement total). */
export function resetSettingsInMemory() {
  state = structuredClone(DEFAULTS);
  keys = {};
  emit();
}
