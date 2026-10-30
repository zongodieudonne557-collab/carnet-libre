// Outils d'interface sans bibliothèque : création d'éléments, messages, boîtes de dialogue.
// Le texte est toujours ajouté comme TEXTE (jamais en HTML) : rien de ce qui vient d'un fichier
// ou d'une IA ne peut injecter du code dans la page.
import { icon } from './icons.js';

export { icon };

const TAG = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/;
const BOOL_PROPS = new Set(['hidden', 'disabled', 'checked', 'selected', 'required', 'multiple', 'readOnly', 'autofocus', 'open', 'draggable', 'spellcheck']);
const SVG_NS = 'http://www.w3.org/2000/svg';

const isChild = (v) => v === null || v === undefined || typeof v !== 'object' || v instanceof Node || Array.isArray(v);

/**
 * h('button.btn.btn-primary', { onclick: fn, 'aria-label': 'Ok' }, 'Texte', icon('check'))
 * Les propriétés `class`, `style` (objet), `dataset` (objet) et `on…` (fonctions) sont gérées ;
 * `ref: (el) => …` reçoit l'élément créé.
 */
export function h(tag, props, ...children) {
  if (isChild(props)) {
    children.unshift(props);
    props = null;
  }
  const m = TAG.exec(tag);
  if (!m) throw new Error(`Balise invalide : ${tag}`);
  const el = document.createElement(m[1] || 'div');
  for (const part of m[2].match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  let value;
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class' || k === 'className') {
        const list = Array.isArray(v) ? v : typeof v === 'object' ? Object.keys(v).filter((x) => v[x]) : String(v).split(/\s+/);
        for (const c of list.flat()) if (c) el.classList.add(c);
      } else if (k === 'style') {
        for (const [p, x] of Object.entries(v)) {
          if (x === null || x === undefined) continue;
          if (p.startsWith('--')) el.style.setProperty(p, String(x));
          else el.style[p] = x;
        }
      } else if (k === 'dataset') {
        Object.assign(el.dataset, v);
      } else if (k === 'ref') {
        v(el);
      } else if (k === 'value') {
        value = v; // appliqué après les enfants (utile pour <select>)
      } else if (k === 'text') {
        el.textContent = String(v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (BOOL_PROPS.has(k)) {
        el[k] = !!v;
      } else if (k === 'for') {
        el.htmlFor = v;
      } else {
        el.setAttribute(k, v === true ? '' : String(v));
      }
    }
  }
  append(el, children);
  if (value !== undefined) el.value = value;
  return el;
}

/** Ajoute des enfants (textes, éléments, listes imbriquées) ; ignore null / false / undefined. */
export function append(parent, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === true) continue;
    if (Array.isArray(c)) append(parent, c);
    else parent.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return parent;
}

/** Remplace le contenu d'un élément. */
export function mount(parent, ...children) {
  parent.replaceChildren();
  append(parent, children);
  return parent;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Écouteur qui se retire tout seul : `const off = on(el, 'click', fn)`. */
export function on(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  return () => target.removeEventListener(type, fn, opts);
}

// ------------------------------------------------------------------ annonces et messages

let liveEl;
/** Annonce un texte aux lecteurs d'écran (sans l'afficher). */
export function announce(text) {
  liveEl ??= document.getElementById('live');
  if (!liveEl) return;
  liveEl.textContent = '';
  setTimeout(() => {
    liveEl.textContent = text;
  }, 30);
}

let toastsEl;
/**
 * Message éphémère en bas de l'écran.
 * @param {string} message
 * @param {{kind?: 'info'|'ok'|'error', timeout?: number, action?: {label: string, onClick: () => void}}} [o]
 */
export function toast(message, { kind = 'info', timeout, action } = {}) {
  toastsEl ??= document.getElementById('toasts');
  if (!toastsEl) return () => {};
  const t = h(
    `div.toast${kind === 'error' ? '.toast-error' : ''}`,
    { role: kind === 'error' ? 'alert' : 'status' },
    icon(kind === 'error' ? 'triangle-alert' : kind === 'ok' ? 'circle-check' : 'info'),
    h('span', message),
    action &&
      h(
        'button.link-btn',
        {
          type: 'button',
          onclick: () => {
            dismiss();
            action.onClick();
          },
        },
        action.label
      )
  );
  const dismiss = () => t.remove();
  toastsEl.append(t);
  while (toastsEl.children.length > 3) toastsEl.firstChild.remove();
  const ms = timeout ?? (kind === 'error' ? 9000 : action ? 8000 : 4500);
  if (ms > 0) setTimeout(dismiss, ms);
  return dismiss;
}

// ------------------------------------------------------------------ boîtes de dialogue (élément <dialog> natif)

let dialogSeq = 0;

/**
 * @param {object} o
 * @param {string} o.title
 * @param {Node|Node[]|((api: DialogApi) => Node|Node[])} o.body
 * @param {{label: string, value?: any, kind?: 'primary'|'danger'|'quiet'|'', onClick?: (api: DialogApi) => any, disabled?: boolean, close?: boolean}[]} [o.actions]
 * @param {''|'narrow'|'wide'} [o.size]
 * @param {boolean} [o.dismissible]  Échap / clic à côté / croix ferment la boîte
 * @returns {Promise<any>} valeur de l'action choisie, ou undefined si la boîte est simplement fermée
 *
 * @typedef {{dialog: HTMLDialogElement, close: (value?: any) => void, button: (i: number) => HTMLButtonElement|undefined}} DialogApi
 */
export function openDialog({ title, body, actions = [], size = '', dismissible = true, onOpen }) {
  return new Promise((resolve) => {
    const id = `dlg-${++dialogSeq}`;
    let result;
    const buttons = [];
    const dlg = h('dialog.modal', { class: size, 'aria-labelledby': `${id}-t` });
    const api = {
      dialog: dlg,
      close(value) {
        result = value;
        dlg.close();
      },
      button: (i) => buttons[i],
    };
    const content = typeof body === 'function' ? body(api) : body;
    append(dlg, [
      h(
        'div.modal-head',
        h('h2', { id: `${id}-t` }, title),
        dismissible && h('button.btn.btn-quiet.btn-icon', { type: 'button', 'aria-label': 'Fermer', title: 'Fermer', onclick: () => api.close(undefined) }, icon('x'))
      ),
      h('div.modal-body', content),
      actions.length
        ? h(
            'div.modal-foot',
            actions.map((a, i) => {
              const btn = h(
                `button.btn${a.kind === 'primary' ? '.btn-primary' : a.kind === 'danger' ? '.btn-danger' : a.kind === 'quiet' ? '.btn-quiet' : ''}`,
                {
                  type: 'button',
                  disabled: a.disabled,
                  onclick: async () => {
                    if (a.onClick) {
                      const r = await a.onClick(api);
                      if (r === false) return;
                    }
                    if (a.close !== false) api.close(a.value);
                  },
                },
                a.label
              );
              buttons[i] = btn;
              return btn;
            })
          )
        : null,
    ]);
    dlg.addEventListener('cancel', (e) => {
      if (!dismissible) e.preventDefault();
    });
    dlg.addEventListener('click', (e) => {
      if (dismissible && e.target === dlg) api.close(undefined);
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    document.body.append(dlg);
    dlg.showModal();
    const first = dlg.querySelector('[data-autofocus]') || dlg.querySelector('.modal-foot .btn-primary:not(:disabled), .modal-body input, .modal-body textarea, .modal-body select, .modal-body button, .modal-body a[href]');
    (first || dlg.querySelector('.modal-head .btn') || dlg).focus?.();
    onOpen?.(api);
  });
}

/** Demande de confirmation. Renvoie true / false. */
export async function confirmDialog({ title, message, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false }) {
  const body = typeof message === 'string' ? h('p', message) : message;
  return (
    (await openDialog({
      title,
      size: 'narrow',
      body,
      actions: [
        { label: cancelLabel, value: false, kind: 'quiet' },
        { label: confirmLabel, value: true, kind: danger ? 'danger' : 'primary' },
      ],
    })) === true
  );
}

// ------------------------------------------------------------------ divers

/** Désactive un bouton pendant une tâche asynchrone. */
export async function busy(button, task) {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

/** Copie du texte dans le presse-papiers (avec un repli pour les vieux navigateurs). */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { 'aria-hidden': 'true', style: { position: 'fixed', top: '0', left: '-9999px' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** Marque d'application (cahier bleu, étiquette, surligneur) — même dessin que icons/logo.svg. */
export function logo(size = 32) {
  const el = (tag, attrs) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };
  const svg = el('svg', { viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': 'true', focusable: 'false', class: 'logo' });
  svg.append(
    el('rect', { width: 64, height: 64, rx: 14, fill: '#2149c1' }),
    el('rect', { width: 9, height: 64, fill: '#1a3a9e' }),
    el('rect', { x: 20, y: 14, width: 30, height: 24, rx: 3, fill: '#fcfdff' }),
    el('path', { d: 'M26 14v24', stroke: '#e0607a', 'stroke-width': 2 }),
    el('path', { d: 'M31 22h14M31 29h10', stroke: '#a3b5dc', 'stroke-width': 2, 'stroke-linecap': 'round' }),
    el('rect', { x: 18, y: 44, width: 32, height: 8, rx: 4, fill: '#ffe45e', transform: 'rotate(-4 34 48)' })
  );
  return svg;
}

/** Déplace le focus sur le titre principal de la vue (après un changement de page). */
export function focusMain() {
  const target = document.querySelector('#main [data-focus]') || document.querySelector('#main h1') || document.getElementById('main');
  if (!target) return;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

/** Pluriel français : plural(2, 'carte') → « 2 cartes ». */
export const plural = (n, one, many) => `${n} ${n > 1 ? many ?? `${one}s` : one}`;
