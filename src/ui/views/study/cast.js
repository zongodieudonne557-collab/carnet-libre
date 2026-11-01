// Causerie : un podcast à deux voix (Awa et Issa) écrit par une IA à partir de tes sources, et — sans IA —
// la lecture à voix haute de tes sources. Les voix sont celles de ton navigateur.
import { deleteItem, listItems, saveItem } from '../../../db.js';
import { generateCast } from '../../../ai/generate.js';
import { CAST_LENGTHS, HOSTS } from '../../../ai/prompts.js';
import { castToText } from '../../../study/build.js';
import { copyText, h, icon, mount, plural, toast } from '../../dom.js';
import { download, formatDate, safeFilename } from '../../../util.js';
import { createAudioPlayer } from '../../audio-player.js';
import { markdownToText } from '../../markdown.js';
import { openPassage } from '../../passage.js';
import { aiLine, field, genPanel, isRunning, jobStatus, launchJob, noSources, onJobChange, rich, selectOf } from './common.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export default async function castView({ root, onCleanup, shell }) {
  const nbId = shell.id;
  const data = await shell.getData();
  let casts = await listItems('casts', nbId);
  const JOB = `cast:${nbId}`;
  let item = null; // ce qu'on écoute : { title, kind: 'cast'|'sources', lines: [{ who?, text, node?, chunkId? }] }
  let player = null;
  let playerPromise = null;
  let createEl = null;

  const body = h('div.cast-body');
  mount(root, h('div.cast-view', body));

  const ensurePlayer = () =>
    (playerPromise ??= createAudioPlayer({
      onCleanup,
      onSegment: (i) => highlight(i),
    }).then((p) => (player = p)));

  async function reload() {
    casts = await listItems('casts', nbId);
    if (!item) paint();
  }
  onJobChange(JOB, onCleanup, (job) => {
    if (job?.status === 'done') reload();
  });

  // ---------------------------------------------------------------- liste et création
  async function remove(c) {
    await deleteItem('casts', c.id);
    await reload();
    toast('Causerie supprimée.', {
      timeout: 6000,
      action: {
        label: 'Annuler',
        onClick: async () => {
          await saveItem('casts', nbId, c);
          await reload();
        },
      },
    });
  }

  function castCard(c) {
    return h(
      'li.note-card',
      h(
        'div.note-card-text',
        h('h3', icon('headphones', { size: 22 }), c.title),
        h('div.card-row-meta', h('span.chip', CAST_LENGTHS[c.length]?.label || 'Causerie'), h('span.small.muted', plural(c.turns.length, 'réplique')), h('span.small.muted', formatDate(c.createdAt)))
      ),
      h(
        'div.quiz-card-actions',
        h('button.btn.btn-primary', { type: 'button', onclick: () => openCast(c) }, icon('headphones', { size: 18 }), 'Écouter'),
        h('button.btn.btn-quiet.btn-icon', { type: 'button', 'aria-label': `Supprimer la causerie : ${c.title}`, title: 'Supprimer', onclick: () => remove(c) }, icon('trash', { size: 18 }))
      )
    );
  }

  function sourcesPanel() {
    const usable = data.sources.filter((s) => data.chunks.some((c) => c.sourceId === s.id));
    const sel = selectOf('read-src', usable.map((s) => [s.id, s.title]), usable[0]?.id ?? '');
    const go = h('button.btn.btn-primary', { type: 'button' }, icon('volume-2', { size: 18 }), 'Lire à voix haute');
    go.addEventListener('click', () => {
      const src = usable.find((s) => s.id === sel.value);
      const chunks = data.chunks.filter((c) => c.sourceId === sel.value);
      if (!src || !chunks.length) return;
      openReading(src, chunks);
    });
    return genPanel({
      id: 'cast-read',
      ic: 'volume-2',
      title: 'Sans IA : écouter mes sources',
      lead: 'Ton navigateur lit tes sources à voix haute, passage après passage, avec les formules dites en français. Pratique dans les transports ou pour reposer les yeux.',
      children: [field('read-src', 'Quelle source ?', sel)],
      actions: [go],
    });
  }

  function aiPanel() {
    const length = selectOf('cast-len', Object.entries(CAST_LENGTHS).map(([k, v]) => [k, v.label]), 'moyen');
    const focus = h('input', { id: 'cast-focus', type: 'text', maxlength: 120, placeholder: 'Un chapitre ou une notion (facultatif)', autocomplete: 'off', spellcheck: false });
    const go = h('button.btn.btn-primary', { type: 'button' }, icon('sparkles', { size: 18 }), 'Écrire la causerie');
    const paintGo = () => {
      go.disabled = isRunning(JOB);
    };
    go.addEventListener('click', async () => {
      const len = length.value;
      const topic = focus.value.trim();
      const job = await launchJob({
        nbId,
        key: JOB,
        kind: 'cast',
        label: 'Écriture de la causerie',
        purpose: 'écrire une causerie',
        run: async ({ signal, setNote, setChars, config }) => {
          const res = await generateCast({ notebook: data.notebook, chunks: data.chunks, sources: data.sources, index: data.index, length: len, focus: topic, signal, config, onProgress: setChars, onStatus: setNote });
          await saveItem('casts', nbId, res.cast);
          const cut = res.truncated ? ' Le texte a été coupé : essaie une causerie plus courte.' : '';
          return { message: `« ${res.cast.title} » est prête : ${plural(res.cast.turns.length, 'réplique')}.${cut}`, href: `/n/${nbId}/causerie` };
        },
      });
      if (job) paintGo();
    });
    onJobChange(JOB, onCleanup, paintGo);
    paintGo();
    return genPanel({
      id: 'cast-ai',
      ic: 'sparkles',
      title: 'Avec une IA : une causerie à deux voix',
      lead: `Awa et Issa discutent de ton cours comme dans un podcast : l’IA écrit le dialogue à partir de tes sources actives, puis les voix de ton navigateur le lisent. Le dialogue peut contenir des erreurs : garde ton cours sous la main.`,
      children: [field('cast-len', 'Durée', length), field('cast-focus', 'Sur quoi ?', focus)],
      actions: [go],
      extra: [jobStatus(JOB, onCleanup), aiLine(onCleanup)],
    });
  }

  // ---------------------------------------------------------------- écoute
  async function openCast(c) {
    item = {
      title: c.title,
      kind: 'cast',
      cast: c,
      lines: c.turns.map((t) => ({ who: t.who, text: t.text, chunkId: t.chunkId, node: h('p', t.text) })),
    };
    await openItem();
  }

  async function openReading(src, chunks) {
    item = {
      title: `Lecture : ${src.title}`,
      kind: 'sources',
      lines: chunks.map((c) => ({ who: null, text: c.text, chunkId: c.id, label: c.label, node: rich(c.text, { headingOffset: 3 }) })),
    };
    await openItem();
  }

  async function openItem() {
    mount(body, h('p.muted', h('span.spinner', { 'aria-hidden': 'true' }), ' Recherche des voix de cet appareil…'));
    const p = await ensurePlayer();
    p.load(item.lines.map((l) => (l.who ? p.host(l.who, l.text) : p.single(l.text))));
    paint();
    window.scrollTo(0, 0);
    root.querySelector('[data-focus]')?.focus({ preventScroll: true });
  }

  function highlight(i) {
    const prev = root.querySelector('.line.is-current');
    prev?.classList.remove('is-current');
    const li = root.querySelector(`.line[data-i="${i}"]`);
    if (!li) return;
    li.classList.add('is-current');
    li.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
  }

  function lineEl(l, i) {
    const name = l.who ? HOSTS[l.who] || l.who : null;
    return h(
      `li.line${l.who === 'B' ? '.line-b' : l.who === 'A' ? '.line-a' : ''}`,
      { dataset: { i } },
      h('button.btn.btn-quiet.btn-sm.btn-icon.line-go', { type: 'button', 'aria-label': `Écouter à partir d’ici${name ? ` (${name})` : ''}`, title: 'Écouter à partir d’ici', onclick: () => player.playFrom(i) }, icon('play', { size: 16 })),
      h(
        'div.line-body',
        name ? h('strong.line-who', name) : l.label ? h('span.chip', l.label.replace(/^§ /, '')) : null,
        l.node,
        l.chunkId && item.kind === 'cast' ? h('button.link-btn.small.no-print', { type: 'button', onclick: () => openPassage({ chunkId: l.chunkId }) }, 'Voir l’extrait') : null
      )
    );
  }

  function viewer() {
    const text = () => (item.kind === 'cast' ? castToText(item.cast) : item.lines.map((l) => markdownToText(l.text)).join('\n\n'));
    return h(
      'div.cast-open',
      h(
        'div.note-view-head.no-print',
        h(
          'button.btn.btn-quiet.btn-sm',
          {
            type: 'button',
            onclick: () => {
              player?.stop();
              item = null;
              paint();
            },
          },
          icon('arrow-left', { size: 16 }),
          item.kind === 'cast' ? 'Mes causeries' : 'Retour'
        ),
        h(
          'div.btn-row',
          h('button.btn.btn-sm', { type: 'button', onclick: async () => toast((await copyText(text())) ? 'Texte copié.' : 'Copie impossible : sélectionne le texte à la main.', { kind: 'ok', timeout: 2000 }) }, icon('copy', { size: 16 }), 'Copier'),
          h('button.btn.btn-sm', { type: 'button', onclick: () => download(`${safeFilename(item.title)}.txt`, text(), 'text/plain;charset=utf-8') }, icon('download', { size: 16 }), 'Télécharger le texte')
        )
      ),
      h('h2', { 'data-focus': '', tabindex: '-1' }, item.title),
      player.notice(),
      player.onlineWarning(item.lines.map((l) => (l.who ? player.host(l.who, '') : player.single('')))),
      item.kind === 'cast' ? h('p.small.muted', 'Dialogue écrit par une IA d’après tes sources : les voix sont des voix de synthèse. Clique sur ▶ à côté d’une réplique pour écouter à partir de là.') : null,
      h('ol.transcript', item.lines.map(lineEl)),
      h('div.player-bar.no-print', player.el)
    );
  }

  function paint() {
    if (item && player) return mount(body, viewer());
    item = null;
    mount(
      body,
      h('div.view-head', h('h2', { 'data-focus': '', tabindex: '-1' }, 'Causerie')),
      casts.length
        ? h('ul.quiz-list', casts.slice().reverse().map(castCard))
        : h('div.empty', icon('headphones', { size: 40 }), h('h3', 'Aucune causerie pour l’instant'), h('p', 'Écoute ton cours comme un podcast à deux voix (avec une IA), ou fais lire tes sources à voix haute (sans IA).')),
      data.chunks.length ? (createEl ??= h('div.create', sourcesPanel(), aiPanel())) : noSources(nbId, data)
    );
  }

  paint();
}
