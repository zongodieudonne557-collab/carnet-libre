// Point d'entrée : stockage, réglages, en-tête, routes. Les écrans sont chargés à la demande.
import { openDB } from './db.js';
import { getSettings, loadSettings, subscribe, updateSettings } from './settings.js';
import { applyFontScale, applyTheme } from './ui/theme.js';
import { focusMain, h, icon, mount, toast } from './ui/dom.js';
import { currentPath, href, navigate, route, start } from './ui/router.js';
import { loadData, subscribeJobs } from './ui/store.js';

const main = document.getElementById('main');
const header = document.getElementById('app-header');

// ------------------------------------------------------------------ en-tête
const THEMES = [
  { id: 'auto', icon: 'monitor', label: 'Thème : automatique' },
  { id: 'light', icon: 'sun', label: 'Thème : clair (papier)' },
  { id: 'dark', icon: 'moon', label: 'Thème : sombre (tableau)' },
];

function buildHeader() {
  const themeBtn = h('button.btn.btn-quiet.btn-icon', { type: 'button', id: 'theme-btn' });
  const paintTheme = () => {
    const t = THEMES.find((x) => x.id === getSettings().ui.theme) || THEMES[0];
    themeBtn.setAttribute('aria-label', `${t.label} (appuie pour changer)`);
    themeBtn.title = t.label;
    mount(themeBtn, icon(t.icon, { size: 22 }));
  };
  themeBtn.addEventListener('click', async () => {
    const i = THEMES.findIndex((x) => x.id === getSettings().ui.theme);
    const next = THEMES[(i + 1) % THEMES.length];
    await updateSettings({ ui: { theme: next.id } });
    toast(next.label, { timeout: 1800 });
  });
  const navLink = (path, ic, label) => h('a.hdr-link', { href: href(path), dataset: { path } }, icon(ic, { size: 22 }), h('span.hdr-label', label));
  mount(
    header,
    h(
      'div.app-header-inner',
      h('a.brand', { href: href('/'), 'aria-label': 'Carnet Libre — accueil' }, h('img', { src: 'icons/logo.svg', alt: '', width: 34, height: 34 }), h('span.brand-name', 'Carnet Libre')),
      h('nav.hdr-nav', { 'aria-label': 'Principal' }, navLink('/', 'notebook', 'Carnets'), navLink('/confidentialite', 'shield-check', 'Confidentialité'), navLink('/reglages', 'settings', 'Réglages'), themeBtn)
    )
  );
  paintTheme();
  subscribe(paintTheme);
}

function markHeader(path) {
  for (const a of header.querySelectorAll('.hdr-link')) {
    const p = a.dataset.path;
    const on = p === '/' ? path === '/' || path.startsWith('/n/') : path === p;
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

// ------------------------------------------------------------------ routes
const V = './ui/views';
route('/', { load: () => import(`${V}/home.js`), title: 'Mes carnets' });
route('/n/:id', { redirect: true });
route('/n/:id/sources', { load: () => import(`${V}/sources.js`), tab: 'sources', title: 'Sources' });
route('/n/:id/discuter', { load: () => import(`${V}/chat.js`), tab: 'discuter', title: 'Discuter' });
route('/n/:id/reviser', { load: () => import(`${V}/study/hub.js`), tab: 'reviser', title: 'Réviser' });
route('/n/:id/cartes', { load: () => import(`${V}/study/cards.js`), tab: 'cartes', title: 'Cartes' });
route('/n/:id/quiz', { load: () => import(`${V}/study/quiz.js`), tab: 'quiz', title: 'Quiz' });
route('/n/:id/fiches', { load: () => import(`${V}/study/notes.js`), tab: 'fiches', title: 'Fiches' });
route('/n/:id/causerie', { load: () => import(`${V}/study/cast.js`), tab: 'causerie', title: 'Causerie' });
route('/n/:id/diapos', { load: () => import(`${V}/study/deck.js`), tab: 'diapos', title: 'Diapos' });
route('/reglages', { load: () => import(`${V}/settings.js`), title: 'Réglages' });
route('/confidentialite', { load: () => import(`${V}/privacy.js`), title: 'Confidentialité' });

let token = 0;
let current = null;
let shell = null;

const setTitle = (t) => {
  document.title = t ? `${t} — Carnet Libre` : 'Carnet Libre — réviser tes cours, librement';
};

function panel(title, text, withHome = true) {
  return h(
    'div.empty.page-error',
    icon('circle-question-mark', { size: 40 }),
    h('h1', { 'data-focus': '', tabindex: '-1' }, title),
    h('p', text),
    withHome ? h('div.btn-row', h('a.btn.btn-primary', { href: href('/') }, 'Retour à l’accueil')) : null
  );
}

async function onRoute(m) {
  const my = ++token;
  if (current) {
    current.controller.abort();
    for (const fn of current.cleanups) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
  }
  const controller = new AbortController();
  const cleanups = [];
  current = { controller, cleanups };
  const path = currentPath();
  markHeader(path);

  if (!m) {
    shell?.destroy();
    shell = null;
    setTitle('Page introuvable');
    mount(main, panel('Page introuvable', 'Cette adresse ne correspond à aucune page de Carnet Libre.'));
    focusMain();
    return;
  }

  const { route: r, params } = m;

  if (r.redirect) {
    try {
      const data = await loadData(params.id);
      if (my !== token) return;
      navigate(`/n/${params.id}/${data?.sources.length ? 'discuter' : 'sources'}`, { replace: true });
    } catch {
      navigate('/', { replace: true });
    }
    return;
  }

  let mod;
  try {
    mod = await r.load();
  } catch (e) {
    console.error(e);
    if (my !== token) return;
    mount(main, panel('Cette page n’a pas pu être chargée', 'Vérifie ta connexion : la page demandée n’est pas encore enregistrée sur cet appareil. Une fois chargée, elle fonctionne hors ligne.'));
    focusMain();
    return;
  }
  if (my !== token) return;

  let container = main;
  try {
    if (r.tab) {
      if (!shell || shell.id !== params.id) {
        shell?.destroy();
        shell = await (await import(`${V}/notebook.js`)).createShell(params.id);
        if (my !== token) {
          shell?.destroy();
          shell = null;
          return;
        }
        if (!shell) {
          setTitle('Carnet introuvable');
          mount(main, panel('Carnet introuvable', 'Ce carnet n’existe plus sur cet appareil. Il a peut-être été supprimé.'));
          focusMain();
          return;
        }
        mount(main, shell.el);
      }
      shell.setActive(r.tab);
      container = shell.content;
      const nb = (await shell.getData())?.notebook;
      setTitle(`${r.title} · ${nb?.title ?? ''}`);
    } else {
      shell?.destroy();
      shell = null;
      setTitle(r.title);
    }
    mount(container);
    window.scrollTo(0, 0);
    await mod.default({ params, root: container, signal: controller.signal, setTitle, onCleanup: (fn) => cleanups.push(fn), shell });
  } catch (e) {
    if (controller.signal.aborted) return;
    console.error(e);
    mount(container, panel('Quelque chose a coincé', `${e?.message || 'Erreur inattendue.'} Recharge la page ; tes données ne sont pas perdues.`));
  }
  if (my === token) focusMain();
}

// ------------------------------------------------------------------ démarrage
function fatal(title, text) {
  mount(main, h('div.empty.page-error', icon('triangle-alert', { size: 40 }), h('h1', title), h('p', text)));
}

async function boot() {
  try {
    await openDB();
    await loadSettings();
  } catch (e) {
    console.error(e);
    fatal('Le stockage du navigateur est inaccessible', `${e?.message || ''} Carnet Libre garde tes carnets dans le navigateur : si tu es en navigation privée, ouvre-le dans une fenêtre normale.`);
    return;
  }
  const apply = () => {
    const ui = getSettings().ui;
    applyTheme(ui.theme);
    applyFontScale(ui.fontScale);
  };
  apply();
  subscribe(apply);
  buildHeader();
  document.getElementById('skip-link').addEventListener('click', (e) => {
    e.preventDefault(); // le « # » sert au routeur : on déplace le focus à la main
    focusMain();
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    if (r?.name === 'AbortError' || r?.kind === 'abort') return;
    console.error(r);
  });
  subscribeJobs(() => {}); // initialise le gestionnaire de tâches
  start(onRoute);
  registerWorker();
}

function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (new URLSearchParams(location.search).has('nosw')) return;
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Mode hors ligne indisponible :', e?.message));
}

boot();
