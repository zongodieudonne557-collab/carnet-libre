// Routeur minimal par « # » : fonctionne sur n'importe quel hébergement de fichiers statiques
// (GitHub Pages, dossier partagé…) sans configuration de serveur.
//   #/                    accueil
//   #/n/<id>/sources      un carnet, onglet « sources »
//   #/reglages            réglages

const routes = [];
let handler = null;

/** @param {string} pattern ex. '/n/:id/sources' ; `:nom` capture un segment. */
export function route(pattern, meta) {
  const keys = [];
  const re = new RegExp(
    `^${pattern
      .split('/')
      .map((seg) => (seg.startsWith(':') ? (keys.push(seg.slice(1)), '([^/]+)') : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('/')}/?$`
  );
  routes.push({ pattern, keys, re, ...meta });
}

export function currentPath() {
  const raw = location.hash.replace(/^#/, '') || '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

export function match(path) {
  const clean = path.split('?')[0];
  for (const r of routes) {
    const m = r.re.exec(clean);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => {
        try {
          params[k] = decodeURIComponent(m[i + 1]);
        } catch {
          params[k] = m[i + 1];
        }
      });
      return { route: r, params, path: clean };
    }
  }
  return null;
}

/** Lien à mettre dans un attribut href : href('/n/abc/sources') → '#/n/abc/sources'. */
export const href = (path) => `#${path}`;

export function navigate(path, { replace = false } = {}) {
  if (replace) {
    history.replaceState(null, '', `#${path}`);
    run();
  } else if (currentPath() === path) {
    run();
  } else {
    location.hash = path;
  }
}

function run() {
  if (!handler) return;
  const m = match(currentPath());
  handler(m);
}

export function start(onRoute) {
  handler = onRoute;
  window.addEventListener('hashchange', run);
  run();
}
