// Appliqué avant le premier affichage pour éviter un flash clair → sombre.
// Seules deux préférences d'affichage (thème, taille du texte) sont recopiées dans le stockage du
// navigateur ; tout le reste est dans la base locale.
try {
  const root = document.documentElement;
  const theme = localStorage.getItem('cl-theme');
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  const scale = parseFloat(localStorage.getItem('cl-font-scale'));
  if (scale >= 1 && scale <= 1.5) root.style.setProperty('--font-scale', String(scale));
} catch {
  /* stockage indisponible (navigation privée) : thème automatique */
}
