// Thème (clair « papier », sombre « tableau », ou automatique) et taille du texte.
// Les deux préférences sont aussi recopiées dans localStorage pour être appliquées avant l'affichage (src/boot.js).

const COLORS = { light: '#fcfdff', dark: '#1a2926' };

function remember(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch {
    /* stockage indisponible */
  }
}

export function systemPrefersDark() {
  return !!globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

/** @param {'auto'|'light'|'dark'} theme */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.dataset.theme = theme;
    remember('cl-theme', theme);
  } else {
    delete root.dataset.theme;
    remember('cl-theme', null);
  }
  const dark = theme === 'dark' || (theme !== 'light' && systemPrefersDark());
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute('content', dark ? COLORS.dark : COLORS.light);
}

/** Taille du texte : 1 = normale, jusqu'à 1,5. */
export function applyFontScale(scale) {
  const s = Math.min(1.5, Math.max(1, Number(scale) || 1));
  document.documentElement.style.setProperty('--font-scale', String(s));
  remember('cl-font-scale', s === 1 ? null : s);
}
