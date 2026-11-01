// Fiches : résumés, fiches de révision, questions fréquentes, plans (par une IA), fiche automatique (sans IA),
// et réponses gardées depuis la discussion. Chaque fiche cite les extraits de tes sources.
import { deleteItem, listItems, saveItem } from '../../../db.js';
import { generateNote } from '../../../ai/generate.js';
import { NOTE_KINDS } from '../../../ai/prompts.js';
import { autoNote, noteToFile } from '../../../study/build.js';
import { download, formatDate, safeFilename } from '../../../util.js';
import { copyText, h, icon, mount, plural, toast } from '../../dom.js';
import { markdownToText, renderMarkdown } from '../../markdown.js';
import { openPassage } from '../../passage.js';
import { aiLine, field, genPanel, isRunning, jobStatus, launchJob, noSources, onJobChange, selectOf } from './common.js';

const KIND_LABEL = { ...Object.fromEntries(Object.entries(NOTE_KINDS).map(([k, v]) => [k, v.label])), auto: 'Fiche automatique', reponse: 'Réponse gardée' };
const KIND_ICON = { resume: 'scroll-text', fiche: 'file-pen', faq: 'circle-question-mark', plan: 'list-checks', auto: 'search', reponse: 'bookmark' };

export default async function notesView({ root, onCleanup, shell }) {
  const nbId = shell.id;
  const data = await shell.getData();
  let notes = await listItems('notes', nbId);
  const JOB = `note:${nbId}`;
  let openId = null;
  let createEl = null;

  const body = h('div.notes-body');
  mount(root, h('div.notes-view', body));

  async function reload() {
    notes = await listItems('notes', nbId);
    paint();
  }
  onJobChange(JOB, onCleanup, (job) => {
    if (job?.status === 'done') reload();
  });

  // ---------------------------------------------------------------- liste
  function noteCard(n) {
    return h(
      'li.note-card',
      h(
        'div.note-card-text',
        h('h3', icon(KIND_ICON[n.kind] || 'file-text', { size: 22 }), n.title),
        h('div.card-row-meta', h('span.chip.chip-info', KIND_LABEL[n.kind] || 'Fiche'), h('span.small.muted', formatDate(n.createdAt)), n.refs?.length ? h('span.small.muted', plural(n.refs.length, 'source citée', 'sources citées')) : null)
      ),
      h(
        'div.quiz-card-actions',
        h('button.btn.btn-primary', { type: 'button', onclick: () => open(n.id) }, icon('book-open', { size: 18 }), 'Ouvrir'),
        h('button.btn.btn-quiet.btn-icon', { type: 'button', 'aria-label': `Supprimer la fiche : ${n.title}`, title: 'Supprimer', onclick: () => remove(n) }, icon('trash', { size: 18 }))
      )
    );
  }

  async function remove(n) {
    await deleteItem('notes', n.id);
    if (openId === n.id) openId = null;
    await reload();
    toast('Fiche supprimée.', {
      timeout: 6000,
      action: {
        label: 'Annuler',
        onClick: async () => {
          await saveItem('notes', nbId, n);
          await reload();
        },
      },
    });
  }

  function open(id) {
    openId = id;
    paint();
    root.querySelector('[data-focus]')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- création
  function createPanels() {
    createEl ??= h('div.create', autoPanel(), aiPanel());
    return createEl;
  }

  function autoPanel() {
    const go = h('button.btn.btn-primary', { type: 'button' }, icon('search', { size: 18 }), 'Créer la fiche automatique');
    go.addEventListener('click', async () => {
      const note = autoNote(data.chunks, data.sources);
      if (!note) {
        toast('Je n’ai rien trouvé à résumer dans tes sources : pas de titres ni de définitions claires. Essaie avec une IA.', { kind: 'error', timeout: 7000 });
        return;
      }
      const saved = await saveItem('notes', nbId, note);
      notes = [...notes, saved];
      open(saved.id);
    });
    return genPanel({
      id: 'note-auto',
      ic: 'search',
      title: 'Sans IA : fiche automatique',
      lead: 'Carnet Libre rassemble les mots-clés, les définitions repérées (avec leur extrait) et le plan de tes sources. Tout se passe sur ton appareil.',
      actions: [go],
    });
  }

  function aiPanel() {
    const kind = selectOf('note-kind', Object.entries(NOTE_KINDS).map(([k, v]) => [k, v.label]), 'fiche');
    const focus = h('input', { id: 'note-focus', type: 'text', maxlength: 120, placeholder: 'Un chapitre ou une notion (facultatif)', autocomplete: 'off', spellcheck: false });
    const go = h('button.btn.btn-primary', { type: 'button' }, icon('sparkles', { size: 18 }), 'Rédiger avec l’IA');
    const paintGo = () => {
      go.disabled = isRunning(JOB);
    };
    go.addEventListener('click', async () => {
      const k = kind.value;
      const topic = focus.value.trim();
      const job = await launchJob({
        nbId,
        key: JOB,
        kind: 'note',
        label: `Rédaction : ${NOTE_KINDS[k]?.label.toLowerCase() || 'fiche'}`,
        purpose: 'rédiger une fiche',
        run: async ({ signal, setNote, config }) => {
          const res = await generateNote({ notebook: data.notebook, chunks: data.chunks, sources: data.sources, index: data.index, kind: k, focus: topic, signal, config, onStatus: setNote });
          await saveItem('notes', nbId, res.note);
          const cut = res.truncated ? ' Le texte a été coupé : demande une fiche plus ciblée.' : '';
          const uncited = res.note.refs.length ? '' : ' Aucune source n’est citée : vérifie-la dans ton cours.';
          return { message: `« ${res.note.title} » est prête.${uncited}${cut}`, href: `/n/${nbId}/fiches` };
        },
      });
      if (job) paintGo();
    });
    onJobChange(JOB, onCleanup, paintGo);
    paintGo();
    return genPanel({
      id: 'note-ai',
      ic: 'sparkles',
      title: 'Avec une IA',
      lead: 'L’IA rédige à partir de tes sources actives. Chaque idée porte un petit numéro qui renvoie à l’extrait d’où elle vient.',
      children: [field('note-kind', 'Quel type ?', kind), field('note-focus', 'Sur quoi ?', focus)],
      actions: [go],
      extra: [jobStatus(JOB, onCleanup), aiLine(onCleanup)],
    });
  }

  // ---------------------------------------------------------------- lecture d'une fiche
  function viewer(n) {
    const refs = new Map((n.refs || []).map((r) => [r.n, r]));
    const text = () => markdownToText(n.markdown);
    return h(
      'article.note-view',
      h(
        'div.note-view-head.no-print',
        h('button.btn.btn-quiet.btn-sm', { type: 'button', onclick: () => ((openId = null), paint()) }, icon('arrow-left', { size: 16 }), 'Mes fiches'),
        h(
          'div.btn-row',
          h('button.btn.btn-sm', { type: 'button', onclick: async () => toast((await copyText(text())) ? 'Fiche copiée.' : 'Copie impossible : sélectionne le texte à la main.', { kind: 'ok', timeout: 2000 }) }, icon('copy', { size: 16 }), 'Copier'),
          h('button.btn.btn-sm', { type: 'button', onclick: () => download(`${safeFilename(n.title)}.md`, noteToFile(n), 'text/markdown;charset=utf-8') }, icon('download', { size: 16 }), 'Télécharger'),
          h('button.btn.btn-sm', { type: 'button', onclick: () => window.print() }, icon('printer', { size: 16 }), 'Imprimer')
        )
      ),
      h('h2', { 'data-focus': '', tabindex: '-1' }, n.title),
      h('div.card-row-meta', h('span.chip.chip-info', KIND_LABEL[n.kind] || 'Fiche'), h('span.small.muted', formatDate(n.createdAt))),
      n.question ? h('p.note-question', h('strong', 'Question : '), n.question) : null,
      h('div.prose.note-prose', renderMarkdown(n.markdown, { breaks: n.kind === 'reponse', math: true, headingOffset: 1, cite: { refs, onOpen: (ref) => openPassage({ chunkId: ref.chunkId }) } })),
      n.refs?.length
        ? h(
            'section.msg-sources',
            { 'aria-label': 'Sources citées' },
            h('span.small.muted', 'Sources citées :'),
            n.refs.map((r) => h('button.chip.chip-hl.chip-wrap', { type: 'button', title: 'Voir l’extrait', onclick: () => openPassage({ chunkId: r.chunkId }) }, `[${r.n}] ${r.sourceTitle}${r.label ? ` — ${r.label.replace(/^§ /, '')}` : ''}`))
          )
        : h('p.small.muted', icon('info', { size: 14 }), ' Cette fiche ne cite aucune source : vérifie-la dans ton cours avant de la retenir.')
    );
  }

  function paint() {
    const n = openId && notes.find((x) => x.id === openId);
    if (n) return mount(body, viewer(n));
    openId = null;
    mount(
      body,
      h('div.view-head', h('h2', { 'data-focus': '', tabindex: '-1' }, 'Fiches')),
      notes.length
        ? h('ul.quiz-list', notes.slice().reverse().map(noteCard))
        : h('div.empty', icon('file-pen', { size: 40 }), h('h3', 'Aucune fiche pour l’instant'), h('p', 'Une fiche résume ton cours et cite ses sources. Tu peux aussi garder une réponse de la discussion : bouton « Garder en fiche ».')),
      data.chunks.length ? createPanels() : noSources(nbId, data)
    );
  }

  paint();
}
