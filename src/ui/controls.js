// Contrôles de formulaire réutilisables.
import { h, icon } from './dom.js';

/**
 * Choix exclusif entre 2 à 4 positions (thème, taille du texte, quantité de texte envoyée…).
 * C'est un vrai groupe « radio » pour les lecteurs d'écran, avec les flèches du clavier.
 *
 * @param {object} o
 * @param {string} o.label  nom du groupe, lu par les lecteurs d'écran
 * @param {{value: any, label: string, icon?: string, title?: string}[]} o.options
 * @param {any} o.value
 * @param {(value: any) => void} [o.onChange]
 * @returns {HTMLElement & {setValue: (value: any) => void}}
 */
export function segmented({ label, options, value, onChange }) {
  let current = value;
  const buttons = options.map((o, i) =>
    h(
      'button',
      {
        type: 'button',
        role: 'radio',
        title: o.title,
        onclick: () => choose(i),
      },
      o.icon ? icon(o.icon, { size: 16 }) : null,
      o.label
    )
  );

  function paint() {
    options.forEach((o, i) => {
      const on = o.value === current;
      buttons[i].setAttribute('aria-checked', String(on));
      buttons[i].tabIndex = on || (!options.some((x) => x.value === current) && i === 0) ? 0 : -1;
    });
  }

  function choose(i, { focus = false } = {}) {
    const v = options[i].value;
    if (focus) buttons[i].focus();
    if (v === current) return;
    current = v;
    paint();
    onChange?.(v);
  }

  const el = h('div.seg', { role: 'radiogroup', 'aria-label': label }, buttons);
  el.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    const n = options.length;
    let to = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i - 1 + n) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    if (to < 0) return;
    e.preventDefault();
    choose(to, { focus: true });
  });
  el.setValue = (v) => {
    current = v;
    paint();
  };
  paint();
  return el;
}

/** Champ de saisie d'un secret (clé d'API) avec un bouton « afficher / masquer ». */
export function secretInput({ id, value = '', placeholder = '', label = 'Clé', onInput, onChange }) {
  const input = h('input', {
    id,
    type: 'password',
    name: id,
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: false,
    placeholder,
    value,
    oninput: (e) => onInput?.(e.target.value),
    onchange: (e) => onChange?.(e.target.value),
  });
  const toggle = h('button.btn.btn-quiet.btn-icon', { type: 'button', 'aria-label': `Afficher ${label}`, 'aria-pressed': 'false' }, icon('eye'));
  toggle.addEventListener('click', () => {
    const shown = input.type === 'password';
    input.type = shown ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(shown)); // le nom du bouton reste le même : c'est son état qui change
    toggle.replaceChildren(icon(shown ? 'eye-off' : 'eye'));
  });
  return { el: h('div.secret', input, toggle), input };
}
