// Affiche un extrait de source (là d'où vient une citation), avec la preuve surlignée.
import { db } from '../db.js';
import { findQuoteRange } from '../text/verify.js';
import { h, icon, openDialog, toast } from './dom.js';
import { navigate } from './router.js';

/** Texte d'un extrait avec une phrase surlignée (texte brut conservant les retours à la ligne). */
function highlighted(text, quote) {
  const range = quote ? findQuoteRange(quote, text) : null;
  if (!range) return [text];
  return [text.slice(0, range[0]), h('mark', text.slice(range[0], range[1])), text.slice(range[1])];
}

/**
 * @param {{chunkId: string, quote?: string, verified?: boolean}} o
 */
export async function openPassage({ chunkId, quote, verified }) {
  const chunk = await db.get('chunks', chunkId);
  if (!chunk) {
    toast('Cet extrait n’existe plus : la source a peut-être été supprimée.', { kind: 'error' });
    return;
  }
  const source = await db.get('sources', chunk.sourceId);
  const where = [source?.title, chunk.label?.replace(/^§ /, '')].filter(Boolean).join(' — ');
  await openDialog({
    title: where || 'Extrait',
    size: 'wide',
    body: h(
      'div',
      quote && verified === false
        ? h('div.callout.callout-warn', icon('triangle-alert'), h('div', h('p', 'La phrase de preuve donnée par l’IA n’a pas été retrouvée mot pour mot dans cet extrait : vérifie-la avant de la retenir.')))
        : null,
      h('div.passage', highlighted(chunk.text, quote))
    ),
    actions: [
      { label: 'Fermer', value: false, kind: 'quiet' },
      source ? { label: 'Voir la source', value: true, kind: 'primary' } : null,
    ].filter(Boolean),
  }).then((go) => {
    if (go === true && source) navigate(`/n/${source.notebookId}/sources`);
  });
}
