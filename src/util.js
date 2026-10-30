// Petits utilitaires sans dépendance.

export function uid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && c.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Mélange de Fisher–Yates (copie). `rand` est injectable pour les tests. */
export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(new DOMException('Annulé', 'AbortError'));
        },
        { once: true }
      );
    }
  });

/** Durée lisible en français : 90 000 → « 2 min », 3 jours → « 3 j ». */
export function formatDuration(ms) {
  const min = ms / 60000;
  if (min < 1) return '< 1 min';
  if (min < 60) return `${Math.round(min)} min`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)} h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)} j`;
  if (d < 365) return `${Math.round(d / 30)} mois`;
  return `${(d / 365).toFixed(1).replace('.', ',')} an`;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} o`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / 1048576).toFixed(1).replace('.', ',')} Mo`;
}

/** Date locale courte : « 25 oct. 2026 ». */
export function formatDate(ts) {
  try {
    return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

export function pluralize(n, one, many) {
  return `${n} ${n > 1 ? many ?? one + 's' : one}`;
}

/** Nom de fichier sûr (sans accents ni caractères spéciaux). */
export function safeFilename(name) {
  return (
    String(name)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'fichier'
  );
}

export function download(filename, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Échappe une chaîne pour l'insérer dans une RegExp. */
export const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
