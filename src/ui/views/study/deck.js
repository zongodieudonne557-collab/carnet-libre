// Diapos : ton cours en diapositives sur fond de tableau noir, avec une voix qui lit la narration.
// Écrites par une IA à partir de tes sources, ou — sans IA — une diapositive par titre de tes sources.
import { deleteItem, listItems, saveItem } from '../../../db.js';
import { generateSlides } from '../../../ai/generate.js';
import { deckFromHeadings, deckToText } from '../../../study/build.js';
import { copyText, h, icon, mount, plural, toast } from '../../dom.js';
import { download, formatDate, safeFilename } from '../../../util.js';
import { createAudioPlayer } from '../../audio-player.js';
import { renderMarkdown, upgradeMath } from '../../markdown.js';
import { aiLine, field, genPanel, isRunning, jobStatus, launchJob, noSources, onJobChange, selectOf, sourceChip } from './common.js';

/** Contenu d'une diapositive (titre, puces, formule) : sert au tableau et à l'impression. */
function slideBody(s, level = 3) {
  const el = h(
    'div.slide',
    h(`h${level}.slide-title`, s.title),
    s.bullets.length ? h('div.slide-bullets', renderMarkdown(s.bullets.map((b) => `- ${b}`).join('\n'), { math: true, headingOffset: 3 })) : null,
    s.formula ? h('div.slide-formula', h('span.math.math-raw', { dataset: { tex: s.formula, display: '1' } }, s.formula)) : null
  );
  upgradeMath(el);
  return el;
}

export default async function deckView({ root, onCleanup, shell }) {
  const nbId = shell.id;
  const data = await shell.getData();
  let decks = await listItems('decks', nbId);
  const JOB = `deck:${nbId}`;
  let deck = null;
  let pos = 0;
  let showText = false;
  let player = null;
  let createEl = null;
  let stage = null;
  let boardEl = null;
  let narrationEl = null;
  let counterEl = null;

  const body = h('div.deck-body');
  mount(root, h('div.deck-view', body));

  async function reload() {
    decks = await listItems('decks', nbId);
    if (!deck) paint();
  }
  onJobChange(JOB, onCleanup, (job) => {
    if (job?.status === 'done') reload();
  });

  // ---------------------------------------------------------------- liste et création
  async function remove(d) {
    await deleteItem('decks', d.id);
    await reload();
    toast('Diaporama supprimé.', {
      timeout: 6000,
      action: {
        label: 'Annuler',
        onClick: async () => {
          await saveItem('decks', nbId, d);
          await reload();
        },
      },
    });
  }

  function deckCard(d) {
    return h(
      'li.note-card',
      h(
        'div.note-card-text',
        h('h3', icon('presentation', { size: 22 }), d.title),
        h('div.card-row-meta', h('span.chip', plural(d.slides.length, 'diapositive')), h('span.chip', d.origin === 'headings' ? 'Sans IA' : 'Par l’IA'), h('span.small.muted', formatDate(d.createdAt)))
      ),
      h(
        'div.quiz-card-actions',
        h('button.btn.btn-primary', { type: 'button', onclick: () => open(d) }, icon('play', { size: 18 }), 'Voir'),
        h('button.btn.btn-quiet.btn-icon', { type: 'button', 'aria-label': `Supprimer le diaporama : ${d.title}`, title: 'Supprimer', onclick: () => remove(d) }, icon('trash', { size: 18 }))
      )
    );
  }

  function headingsPanel() {
    const go = h('button.btn.btn-primary', { type: 'button' }, icon('presentation', { size: 18 }), 'Créer le diaporama');
    go.addEventListener('click', async () => {
      const made = deckFromHeadings(data.chunks, data.sources, { max: 12 });
      if (!made) {
        toast('Tes sources n’ont pas assez de titres ni de pages pour être découpées. Essaie avec une IA.', { kind: 'error', timeout: 7000 });
        return;
      }
      const saved = await saveItem('decks', nbId, made);
      decks = [...decks, saved];
      open(saved);
    });
    return genPanel({
      id: 'deck-local',
      ic: 'presentation',
      title: 'Sans IA : une diapositive par titre',
      lead: 'Chaque titre (ou page) de tes sources devient une diapositive avec ses premières phrases, lues à voix haute. Tout se passe sur ton appareil.',
      actions: [go],
    });
  }

  function aiPanel() {
    const count = selectOf('deck-n', [[6, '6 diapositives'], [8, '8 diapositives'], [12, '12 diapositives']], 8);
    const focus = h('input', { id: 'deck-focus', type: 'text', maxlength: 120, placeholder: 'Un chapitre ou une notion (facultatif)', autocomplete: 'off', spellcheck: false });
    const go = h('button.btn.btn-primary', { type: 'button' }, icon('sparkles', { size: 18 }), 'Créer avec l’IA');
    const paintGo = () => {
      go.disabled = isRunning(JOB);
    };
    go.addEventListener('click', async () => {
      const n = Number(count.value);
      const topic = focus.value.trim();
      const job = await launchJob({
        nbId,
        key: JOB,
        kind: 'deck',
        label: 'Création des diapositives',
        purpose: 'créer des diapositives',
        run: async ({ signal, setNote, setChars, config }) => {
          const res = await generateSlides({ notebook: data.notebook, chunks: data.chunks, sources: data.sources, index: data.index, count: n, focus: topic, signal, config, onProgress: setChars, onStatus: setNote });
          await saveItem('decks', nbId, { ...res.deck, origin: 'ai' });
          const cut = res.truncated ? ' Le texte a été coupé : demande moins de diapositives.' : '';
          return { message: `« ${res.deck.title} » est prêt : ${plural(res.deck.slides.length, 'diapositive')}.${cut}`, href: `/n/${nbId}/diapos` };
        },
      });
      if (job) paintGo();
    });
    onJobChange(JOB, onCleanup, paintGo);
    paintGo();
    return genPanel({
      id: 'deck-ai',
      ic: 'sparkles',
      title: 'Avec une IA',
      lead: 'L’IA écrit un cours en diapositives (titre, quelques puces, une formule si besoin) avec un texte de narration pour chacune. Les voix de ton navigateur le lisent.',
      children: [field('deck-n', 'Combien ?', count), field('deck-focus', 'Sur quoi ?', focus)],
      actions: [go],
      extra: [jobStatus(JOB, onCleanup), aiLine(onCleanup)],
    });
  }

  // ---------------------------------------------------------------- tableau
  async function open(d) {
    mount(body, h('p.muted', h('span.spinner', { 'aria-hidden': 'true' }), ' Recherche des voix de cet appareil…'));
    player ??= await createAudioPlayer({
      onCleanup,
      compact: true,
      onSegment: (i) => {
        if (i !== pos) goto(i, { fromAudio: true });
      },
    });
    deck = d;
    pos = 0;
    player.load(d.slides.map((s) => player.single(`${s.title}. ${s.narration}`)));
    paint();
    window.scrollTo(0, 0);
    root.querySelector('[data-focus]')?.focus({ preventScroll: true });
  }

  function paintBoard() {
    const s = deck.slides[pos];
    mount(boardEl, slideBody(s), h('div.board-foot', s.chunkId ? sourceChip({ chunkId: s.chunkId }) : h('span'), h('span.board-count', `${pos + 1} / ${deck.slides.length}`)));
    counterEl.textContent = `Diapositive ${pos + 1} sur ${deck.slides.length}`;
    mount(narrationEl, h('summary', icon('scroll-text', { size: 18 }), 'Texte de la narration'), h('p', s.narration));
    narrationEl.open = showText;
    prevBtn.disabled = pos === 0;
    nextBtn.disabled = pos === deck.slides.length - 1;
  }

  let prevBtn;
  let nextBtn;
  function goto(i, { fromAudio = false } = {}) {
    const n = Math.max(0, Math.min(deck.slides.length - 1, i));
    if (n === pos && !fromAudio) return;
    pos = n;
    paintBoard();
    if (!fromAudio) {
      if (player.state === 'playing') player.playFrom(pos);
      else player.setStart(pos);
    }
  }

  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else stage.requestFullscreen?.().catch(() => toast('Le plein écran n’est pas disponible ici.', { timeout: 2500 }));
  }

  function viewer() {
    prevBtn = h('button.btn.btn-icon', { type: 'button', 'aria-label': 'Diapositive précédente', title: 'Précédente (←)', onclick: () => goto(pos - 1) }, icon('chevron-left', { size: 22 }));
    nextBtn = h('button.btn.btn-icon', { type: 'button', 'aria-label': 'Diapositive suivante', title: 'Suivante (→)', onclick: () => goto(pos + 1) }, icon('chevron-right', { size: 22 }));
    boardEl = h('div.board', { role: 'group', 'aria-roledescription': 'diapositive', 'aria-label': 'Diapositive' });
    counterEl = h('span.visually-hidden', { 'aria-live': 'polite' });
    narrationEl = h('details.help.deck-narration', { ontoggle: (e) => (showText = e.target.open) });
    stage = h('div.deck-stage', boardEl, counterEl, h('div.deck-controls.no-print', prevBtn, player.el, nextBtn, h('button.btn.btn-icon', { type: 'button', 'aria-label': 'Plein écran', title: 'Plein écran (F)', onclick: fullscreen }, icon('maximize', { size: 20 }))));
    const text = () => deckToText(deck);
    const el = h(
      'div.deck-open',
      h(
        'div.note-view-head.no-print',
        h(
          'button.btn.btn-quiet.btn-sm',
          {
            type: 'button',
            onclick: () => {
              player.stop();
              if (document.fullscreenElement) document.exitFullscreen?.();
              deck = null;
              paint();
            },
          },
          icon('arrow-left', { size: 16 }),
          'Mes diapos'
        ),
        h(
          'div.btn-row',
          h('button.btn.btn-sm', { type: 'button', onclick: async () => toast((await copyText(text())) ? 'Texte copié.' : 'Copie impossible : sélectionne le texte à la main.', { kind: 'ok', timeout: 2000 }) }, icon('copy', { size: 16 }), 'Copier le texte'),
          h('button.btn.btn-sm', { type: 'button', onclick: () => download(`${safeFilename(deck.title)}.txt`, text(), 'text/plain;charset=utf-8') }, icon('download', { size: 16 }), 'Télécharger'),
          h('button.btn.btn-sm', { type: 'button', onclick: () => window.print() }, icon('printer', { size: 16 }), 'Imprimer')
        )
      ),
      h('h2', { 'data-focus': '', tabindex: '-1' }, deck.title),
      player.notice(),
      player.onlineWarning(deck.slides.map(() => player.single(''))),
      stage,
      narrationEl,
      deck.origin === 'headings' ? null : h('p.small.muted.no-print', 'Diapositives écrites par une IA d’après tes sources : relis-les avec ton cours. Clique sur « Voir l’extrait » pour vérifier une idée.'),
      h('div.deck-all', deck.slides.map((s) => h('section.print-slide', slideBody(s, 3), h('p.print-narration', s.narration))))
    );
    queueMicrotask(paintBoard);
    return el;
  }

  function paint() {
    if (deck && player) return mount(body, viewer());
    deck = null;
    mount(
      body,
      h('div.view-head', h('h2', { 'data-focus': '', tabindex: '-1' }, 'Diapos')),
      decks.length
        ? h('ul.quiz-list', decks.slice().reverse().map(deckCard))
        : h('div.empty', icon('presentation', { size: 40 }), h('h3', 'Aucun diaporama pour l’instant'), h('p', 'Un diaporama présente ton cours sur un tableau noir, une idée par diapositive, avec une voix qui explique.')),
      data.chunks.length ? (createEl ??= h('div.create', headingsPanel(), aiPanel())) : noSources(nbId, data)
    );
  }

  // clavier : flèches pour changer de diapositive, F pour le plein écran
  function onKey(e) {
    if (!deck || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]') || e.target?.closest?.('input, textarea, select')) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown') goto(pos + 1);
    else if (k === 'ArrowLeft' || k === 'PageUp') goto(pos - 1);
    else if (k === 'Home') goto(0);
    else if (k === 'End') goto(deck.slides.length - 1);
    else if (k === 'f' || k === 'F') fullscreen();
    else return;
    e.preventDefault();
  }
  document.addEventListener('keydown', onKey);
  onCleanup(() => {
    document.removeEventListener('keydown', onKey);
    if (document.fullscreenElement) document.exitFullscreen?.();
  });

  paint();
}
