// Aides communes aux écrans d'étude : état de l'IA, tâches de fond, puces de source, panneaux de création.
import { PROVIDERS } from '../../../ai/providers.js';
import { getSettings, subscribe } from '../../../settings.js';
import { ensureAI, kindChip } from '../../ai-gate.js';
import { h, icon, mount } from '../../dom.js';
import { renderMarkdown } from '../../markdown.js';
import { openPassage } from '../../passage.js';
import { href } from '../../router.js';
import { clearJob, getJob, startJob, subscribeJobs, cancelJob } from '../../store.js';

/** N'appelle `fn` qu'une fois par intervalle (les générations envoient le texte par petits bouts). */
export function throttle(fn, ms = 200) {
  let last = 0;
  let timer = 0;
  let lastArgs;
  return (...args) => {
    lastArgs = args;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) {
      last = Date.now();
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = 0;
        last = Date.now();
        fn(...lastArgs);
      }, wait);
    }
  };
}

/** Texte riche (Markdown léger, formules) : cartes, quiz, fiches. */
export const rich = (text, opts = {}) => h('div.prose', renderMarkdown(text ?? '', { breaks: true, math: true, headingOffset: 2, ...opts }));

// ------------------------------------------------------------------ pas de source
export function noSources(nbId, data) {
  return h(
    'div.empty',
    icon('files', { size: 40 }),
    h('h3', data.sources.length ? 'Toutes tes sources sont désactivées' : 'Ajoute d’abord un cours'),
    h('p', data.sources.length ? 'Active au moins une source pour pouvoir créer des contenus de révision.' : 'Sans source, il n’y a rien à réviser. Dépose un PDF, une photo de ton cahier ou du texte.'),
    h('div.btn-row', h('a.btn.btn-primary', { href: href(`/n/${nbId}/sources`) }, icon('files'), 'Ouvrir mes sources'))
  );
}

// ------------------------------------------------------------------ état de l'IA
/** Ligne « IA : Groq · modèle · Envoi sur Internet » (ou « pas d'IA »). Se met à jour quand les réglages changent. */
export function aiLine(onCleanup) {
  const el = h('p.ai-line.small');
  const paint = () => {
    const s = getSettings().ai;
    const p = PROVIDERS[s.provider] || PROVIDERS.none;
    if (p.kind === 'none') {
      mount(el, icon('sparkles', { size: 16 }), 'Pas d’IA branchée. ', h('a', { href: href('/reglages') }, 'En brancher une (gratuite)'), '.');
    } else {
      mount(el, icon('sparkles', { size: 16 }), h('span', `${p.short}${s.model ? ` · ${s.model}` : ''}`), kindChip(p), h('a', { href: href('/confidentialite') }, 'Ce que ça implique'));
    }
  };
  paint();
  onCleanup(subscribe(paint));
  return el;
}

// ------------------------------------------------------------------ tâches de fond
/**
 * Demande l'accord (ensureAI) puis lance la tâche. Renvoie la tâche, ou null si la personne a renoncé.
 * `run` reçoit { signal, setNote, setChars, config }.
 */
export async function launchJob({ nbId, key, kind, label, purpose, run }) {
  const config = await ensureAI(purpose);
  if (!config) return null;
  clearJob(key);
  return startJob({ key, notebookId: nbId, kind, label, run: (api) => run({ ...api, config }) });
}

/** Appelle `fn` quand l'état de la tâche change (démarrage, fin, erreur, annulation). */
export function onJobChange(key, onCleanup, fn) {
  let last = getJob(key)?.status ?? 'none';
  onCleanup(
    subscribeJobs(() => {
      const st = getJob(key)?.status ?? 'none';
      if (st === last) return;
      last = st;
      fn(getJob(key));
    })
  );
}

/** Zone qui montre la tâche `key` : progression avec « Annuler », ou l'erreur de la dernière tentative. */
export function jobStatus(key, onCleanup) {
  const el = h('div.job-status', { 'aria-live': 'polite' });
  const paint = () => {
    const j = getJob(key);
    if (j?.status === 'running') {
      mount(
        el,
        h(
          'div.job-line',
          h('span.spinner', { 'aria-hidden': 'true' }),
          h('span', `${j.label}…${j.note ? ` ${j.note}` : ''}`),
          h('button.link-btn', { type: 'button', onclick: () => cancelJob(key) }, 'Annuler')
        )
      );
    } else if (j?.status === 'error') {
      mount(
        el,
        h(
          'div.callout.callout-bad',
          { role: 'alert' },
          icon('triangle-alert'),
          h('div', h('p', j.error?.message || 'La création a échoué.'), h('button.link-btn', { type: 'button', onclick: () => clearJob(key) }, 'Fermer'))
        )
      );
    } else mount(el);
  };
  paint();
  onCleanup(subscribeJobs(paint));
  return el;
}

export const isRunning = (key) => getJob(key)?.status === 'running';

// ------------------------------------------------------------------ puces
/** Où se trouve la preuve : ouvre l'extrait avec la phrase surlignée. */
export function sourceChip(item) {
  if (!item?.chunkId) return null;
  const where = [item.sourceTitle, item.label?.replace(/^§ /, '')].filter(Boolean).join(' — ') || 'Voir l’extrait';
  return h(
    'button.chip.chip-hl.chip-wrap',
    { type: 'button', title: 'Voir l’extrait dans ta source', onclick: () => openPassage({ chunkId: item.chunkId, quote: item.quote, verified: item.verified }) },
    icon('quote', { size: 14 }),
    where
  );
}

export const verifyChip = (item) =>
  item?.verified === false
    ? h('span.chip.chip-warn', { title: 'La phrase de preuve donnée par l’IA n’a pas été retrouvée mot pour mot dans ton cours : vérifie avant de retenir.' }, icon('triangle-alert', { size: 14 }), 'À vérifier')
    : null;

const ORIGINS = { auto: 'Automatique', ai: 'IA', quiz: 'Venue d’un quiz', cards: 'Sans IA' };
export const originChip = (item) => (ORIGINS[item?.origin] ? h('span.chip', ORIGINS[item.origin]) : null);

// ------------------------------------------------------------------ mise en page
/** Panneau de création : titre, explication, champs, boutons. */
export function genPanel({ id, ic, title, lead, children = [], actions = [], extra = [] }) {
  return h(
    'section.gen',
    { 'aria-labelledby': `${id}-h` },
    h('h3', { id: `${id}-h` }, icon(ic, { size: 24 }), title),
    lead ? h('p.gen-lead', lead) : null,
    children.length ? h('div.gen-fields', children) : null,
    actions.length ? h('div.btn-row', actions) : null,
    extra
  );
}

/** Un champ de formulaire avec son libellé et une aide. */
export function field(id, label, control, hint) {
  return h('div.field', h('label', { for: id }, label), control, hint ? h('span.hint', hint) : null);
}

export function selectOf(id, options, value, onchange) {
  return h('select', { id, value: String(value), onchange: (e) => onchange?.(e.target.value) }, options.map(([v, text]) => h('option', { value: String(v) }, text)));
}

/** Mot-clé du nombre d'éléments : « 12 cartes ». */
export const count = (n, one, many) => `${n} ${n > 1 ? many ?? `${one}s` : one}`;
