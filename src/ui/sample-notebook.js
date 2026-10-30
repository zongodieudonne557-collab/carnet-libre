// Carnet d'exemple : permet d'essayer toute l'appli en un clic, sans rien importer ni brancher d'IA.
import { SAMPLE } from '../sample.js';
import { splitByHeadings } from '../text/chunk.js';
import { addSource, createNotebook, getChunks, saveItems, updateNotebook } from '../db.js';
import { autoCards } from '../study/heuristics.js';
import { newSrs } from '../study/srs.js';

export async function createSampleNotebook() {
  const created = await createNotebook({ title: SAMPLE.title, level: SAMPLE.level });
  const nb = await updateNotebook(created.id, { color: 2 });
  for (const s of SAMPLE.sources) {
    await addSource(nb.id, { title: s.title, kind: s.kind, pages: splitByHeadings(s.text), meta: { kind: s.kind, sample: true } });
  }
  const chunks = await getChunks(nb.id);
  const bySource = new Map(chunks.map((c) => [c.id, c.sourceId]));
  const cards = autoCards(chunks, { max: 14 }).map((c) => ({
    front: c.front,
    back: c.back,
    quote: c.quote,
    verified: true,
    origin: 'auto',
    kind: c.kind,
    chunkId: c.chunkId,
    sourceId: bySource.get(c.chunkId),
    srs: newSrs(),
  }));
  if (cards.length) await saveItems('cards', nb.id, cards);
  return nb;
}
