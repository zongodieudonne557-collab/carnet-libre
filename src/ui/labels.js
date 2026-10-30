// Libellés partagés entre les écrans.
export const KIND_LABELS = {
  pdf: 'PDF',
  docx: 'Word',
  pptx: 'PowerPoint',
  image: 'Photo',
  html: 'Page web',
  text: 'Texte',
  markdown: 'Markdown',
  md: 'Markdown',
  latex: 'LaTeX',
  subtitles: 'Sous-titres',
  paste: 'Texte collé',
};

export const kindLabel = (kind) => KIND_LABELS[kind] || 'Document';

export function kindIcon(kind) {
  if (kind === 'image') return 'image';
  if (kind === 'paste') return 'clipboard-paste';
  if (kind === 'subtitles') return 'scroll-text';
  return 'file-text';
}

/** Nombre de mots approximatif à partir du nombre de caractères. */
export const wordsOf = (chars) => Math.max(1, Math.round((chars || 0) / 6));

export const formatCount = (n) => new Intl.NumberFormat('fr-FR').format(n);
