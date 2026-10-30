// Sources : importer, activer / désactiver, lire, renommer, supprimer.
import { addSource, db, deleteSource, listSources, updateSource } from '../../db.js';
import { createImporter, ACCEPT, ImportError } from '../../import/index.js';
import { BUDGETS } from '../../ai/rag.js';
import { getSettings } from '../../settings.js';
import { estimateTokens } from '../../text/normalize.js';
import { formatBytes, formatDate } from '../../util.js';
import { confirmDialog, h, icon, mount, openDialog, plural, toast, announce } from '../dom.js';
import { formatCount, kindIcon, kindLabel, wordsOf } from '../labels.js';
import { renderMarkdown } from '../markdown.js';
import { invalidate } from '../store.js';

const PREVIEW_STEP = 25;

export default async function sourcesView({ root, shell, signal, onCleanup }) {
  const nbId = shell.id;
  let sources = await listSources(nbId);
  const queue = []; // éléments en cours d'import
  let running = false;
  let seq = 0;

  const fileInput = h('input', { type: 'file', multiple: true, accept: ACCEPT, hidden: true, 'aria-label': 'Choisir des fichiers', onchange: (e) => addFiles([...e.target.files]).then(() => (e.target.value = '')) });
  const cameraInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, 'aria-label': 'Prendre une photo', onchange: (e) => addFiles([...e.target.files]).then(() => (e.target.value = '')) });
  const drop = h(
    'div.dropzone',
    h('div.dropzone-icon', icon('file-up', { size: 40 })),
    h('p.dropzone-title', 'Dépose tes fichiers ici'),
    h('p.dropzone-sub', 'PDF, Word, PowerPoint, photos de cahier, texte, page web, sous-titres…'),
    h(
      'div.btn-row',
      h('button.btn.btn-primary', { type: 'button', onclick: () => fileInput.click() }, icon('folder-open'), 'Choisir des fichiers'),
      h('button.btn', { type: 'button', onclick: () => cameraInput.click() }, icon('camera'), 'Prendre une photo'),
      h('button.btn', { type: 'button', onclick: pasteText }, icon('clipboard-paste'), 'Coller du texte')
    ),
    fileInput,
    cameraInput
  );

  const queueEl = h('ul.queue', { 'aria-label': 'Fichiers en cours d’ajout' });
  const listEl = h('ul.ruled.source-list');
  const summaryEl = h('div.source-summary');
  const titleEl = h('h3.list-title');
  const listSection = h('section.source-section', titleEl, listEl, summaryEl);
  const emptyEl = h(
    'div.empty',
    icon('files', { size: 40 }),
    h('h3', 'Ce carnet est vide'),
    h('p', 'Ajoute au moins un cours ci-dessus : tout le reste (questions, cartes, quiz…) s’appuie sur tes sources.')
  );

  mount(
    root,
    h(
      'div.sources',
      h('h2', { 'data-focus': '', tabindex: '-1' }, 'Sources'),
      h('p.lead', 'Ce sont les cours sur lesquels tu veux travailler. Ils restent sur cet appareil.'),
      drop,
      queueEl,
      emptyEl,
      listSection,
      help()
    )
  );

  // ---------------------------------------------------------------- glisser-déposer
  let depth = 0;
  const isFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const over = (e) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    drop.classList.add('is-over');
  };
  const enter = (e) => {
    if (isFiles(e)) depth++;
  };
  const leave = (e) => {
    if (isFiles(e) && --depth <= 0) {
      depth = 0;
      drop.classList.remove('is-over');
    }
  };
  const dropped = (e) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    depth = 0;
    drop.classList.remove('is-over');
    addFiles([...e.dataTransfer.files]);
  };
  // l'écran entier accepte le dépôt (un fichier lâché à côté de la zone ne doit pas ouvrir le fichier dans l'onglet)
  for (const [t, fn] of [['dragenter', enter], ['dragover', over], ['dragleave', leave], ['drop', dropped]]) {
    document.addEventListener(t, fn);
    onCleanup(() => document.removeEventListener(t, fn));
  }

  // ---------------------------------------------------------------- liste des sources
  function paintList() {
    emptyEl.hidden = sources.length > 0 || queue.length > 0;
    listSection.hidden = sources.length === 0;
    titleEl.textContent = `Mes sources (${sources.length})`;
    mount(listEl, sources.map(sourceRow));

    const active = sources.filter((s) => s.enabled);
    const chars = active.reduce((n, s) => n + (s.charCount || 0), 0);
    const budget = BUDGETS[getSettings().ai.budget] || BUDGETS.medium;
    const fits = estimateTokens(chars) <= budget.tokens;
    mount(
      summaryEl,
      h('p', h('strong', `${plural(active.length, 'source')} active${active.length > 1 ? 's' : ''}`), ` · environ ${formatCount(wordsOf(chars))} mots`),
      active.length
        ? h('p.small.muted', fits ? 'Quand tu utilises une IA, tout ton cours tient dans une seule demande.' : 'Quand tu utilises une IA, elle reçoit à chaque demande les extraits les plus utiles à ta question (réglage « quantité de texte envoyée » dans les Réglages).')
        : h('p.small.muted', 'Aucune source active : active-en une avec l’interrupteur pour pouvoir discuter ou réviser.')
    );
  }

  function sourceRow(s) {
    const ocr = s.meta?.ocrConfidence;
    const warn = s.meta?.warnings?.length;
    const unit = s.kind === 'pdf' || s.kind === 'image' ? 'page' : 'section';
    return h(
      'li.source',
      { dataset: { id: s.id }, class: { 'is-off': !s.enabled } },
      h(
        'label.switch',
        { title: s.enabled ? 'Source utilisée : décoche pour l’ignorer' : 'Source ignorée : coche pour l’utiliser' },
        h('input', { type: 'checkbox', role: 'switch', checked: s.enabled, 'aria-label': `Utiliser « ${s.title} »`, onchange: (e) => toggle(s, e.target.checked) })
      ),
      h(
        'button.source-main',
        { type: 'button', onclick: () => preview(s), 'aria-label': `Lire « ${s.title} »` },
        h('span.source-icon', icon(kindIcon(s.kind), { size: 22 })),
        h(
          'span.source-text',
          h('span.source-title', s.title),
          h(
            'span.source-meta',
            [kindLabel(s.kind), plural(s.pageCount || 1, unit), `${formatCount(wordsOf(s.charCount))} mots`, `ajouté le ${formatDate(s.createdAt)}`].join(' · ')
          ),
          ocr != null || warn
            ? h(
                'span.chips',
                ocr != null ? h(`span.chip${ocr < 75 ? '.chip-warn' : ''}`, `Lu par OCR · confiance ${ocr} %`) : null,
                warn ? h('span.chip.chip-warn', icon('triangle-alert', { size: 14 }), plural(s.meta.warnings.length, 'remarque')) : null
              )
            : null
        )
      ),
      h(
        'div.source-actions',
        h('button.btn.btn-quiet.btn-sm.btn-icon', { type: 'button', 'aria-label': `Renommer « ${s.title} »`, title: 'Renommer', onclick: () => rename(s) }, icon('pencil', { size: 18 })),
        h('button.btn.btn-quiet.btn-sm.btn-icon', { type: 'button', 'aria-label': `Supprimer « ${s.title} »`, title: 'Supprimer', onclick: () => remove(s) }, icon('trash', { size: 18 }))
      )
    );
  }

  async function toggle(s, enabled) {
    try {
      await updateSource(s.id, { enabled });
      s.enabled = enabled;
      invalidate(nbId);
      paintList();
    } catch (e) {
      toast(e.message, { kind: 'error' });
    }
  }

  async function rename(s) {
    const input = h('input', { type: 'text', value: s.title, maxlength: 120, 'aria-label': 'Nouveau titre', 'data-autofocus': '' });
    const ok = await openDialog({
      title: 'Renommer la source',
      size: 'narrow',
      body: (api) => h('form', { onsubmit: (e) => (e.preventDefault(), api.button(1).click()) }, h('div.field', h('label', 'Titre'), input)),
      actions: [
        { label: 'Annuler', value: false, kind: 'quiet' },
        { label: 'Enregistrer', value: true, kind: 'primary' },
      ],
    });
    if (ok !== true || !input.value.trim()) return;
    const next = await updateSource(s.id, { title: input.value });
    s.title = next.title;
    invalidate(nbId);
    paintList();
  }

  async function remove(s) {
    const cards = (await db.where('cards', 'notebookId', nbId)).filter((c) => c.sourceId === s.id).length;
    const ok = await confirmDialog({
      title: `Supprimer « ${s.title} » ?`,
      message: cards
        ? `La source sera effacée de cet appareil. Les ${plural(cards, 'carte')} créées à partir d’elle restent, mais leur extrait d’origine ne pourra plus être consulté.`
        : 'La source sera effacée de cet appareil. Tu pourras la rajouter en important de nouveau le fichier.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    await deleteSource(s.id);
    sources = sources.filter((x) => x.id !== s.id);
    invalidate(nbId);
    paintList();
    announce('Source supprimée.');
  }

  async function preview(s) {
    const chunks = (await db.where('chunks', 'sourceId', s.id)).sort((a, b) => a.idx - b.idx);
    let shown = 0;
    const holder = h('div.prose.preview');
    const more = h('button.btn.btn-sm', { type: 'button', onclick: () => next() }, 'Afficher la suite');
    const next = () => {
      const slice = chunks.slice(shown, shown + PREVIEW_STEP);
      shown += slice.length;
      for (const c of slice) {
        holder.append(h('section.preview-chunk', c.label ? h('p.preview-label', c.label.replace(/^§ /, '')) : null, renderMarkdown(c.text, { headingOffset: 2 })));
      }
      more.hidden = shown >= chunks.length;
    };
    next();
    await openDialog({
      title: s.title,
      size: 'wide',
      body: h(
        'div',
        ...(s.meta?.warnings || []).map((w) => h('div.callout.callout-warn', icon('triangle-alert'), h('div', h('p', w)))),
        h('p.small.muted', `${kindLabel(s.kind)} · ${plural(chunks.length, 'extrait')} · ${formatCount(wordsOf(s.charCount))} mots. Voici le texte tel que Carnet Libre l’a lu : si quelque chose est faux ici, ce sera faux dans les réponses.`),
        holder,
        more
      ),
      actions: [{ label: 'Fermer', value: true, kind: 'primary' }],
    });
  }

  // ---------------------------------------------------------------- ajout de fichiers
  const importer = createImporter({ ocr: 'auto', confirmOcr });

  async function confirmOcr({ pages, scanned, garbled }) {
    const why = [];
    if (scanned) why.push(`${plural(scanned, 'page')} ${scanned > 1 ? 'sont des images' : 'est une image'} (document scanné)`);
    if (garbled) why.push(`${plural(garbled, 'page')} ${garbled > 1 ? 'ont' : 'a'} un texte illisible (police ou formules spéciales)`);
    const long = pages > 15;
    const go = await openDialog({
      title: 'Lire ces pages par reconnaissance de texte ?',
      size: 'narrow',
      dismissible: false,
      body: h(
        'div',
        h('p', `Dans ce PDF, ${why.join(' ; ')}.`),
        h('p', 'Carnet Libre peut les lire grâce à l’OCR (reconnaissance de texte). Tout se passe sur ton appareil : rien n’est envoyé sur Internet.'),
        h('p', `Compte quelques secondes par page${long ? `, donc plusieurs minutes pour ${pages} pages : garde l’écran allumé et branche ton téléphone si possible` : ''}.`)
      ),
      actions: [
        { label: 'Ignorer ces pages', value: false, kind: 'quiet' },
        { label: `Lire ${plural(pages, 'page')}`, value: true, kind: 'primary' },
      ],
    });
    return go === true;
  }

  async function addFiles(files) {
    if (!files.length) return;
    for (const file of files) queue.push({ id: ++seq, file, name: file.name || 'fichier', status: 'wait', done: 0, total: 0, note: 'En attente…', warnings: [], controller: new AbortController() });
    paintQueue();
    run();
  }

  async function pasteText() {
    const title = h('input', { type: 'text', maxlength: 120, placeholder: 'Titre (facultatif)', 'aria-label': 'Titre' });
    const text = h('textarea', { rows: 10, placeholder: 'Colle ici le texte de ton cours…', 'aria-label': 'Texte à ajouter', 'data-autofocus': '' });
    const ok = await openDialog({
      title: 'Coller du texte',
      body: h('div', h('div.field', h('label', 'Titre'), title), h('div.field', h('label', 'Texte'), text, h('span.hint', 'Tu peux coller le texte d’une page web, d’un message, d’une transcription de vidéo…'))),
      actions: [
        { label: 'Annuler', value: false, kind: 'quiet' },
        { label: 'Ajouter au carnet', value: true, kind: 'primary' },
      ],
    });
    if (ok !== true) return;
    try {
      const res = importer.importText(text.value, { title: title.value.trim() || undefined });
      await save(res);
      toast('Texte ajouté.', { kind: 'ok' });
    } catch (e) {
      toast(e instanceof ImportError ? e.message : `Ajout impossible : ${e.message}`, { kind: 'error' });
    }
  }

  async function save(res) {
    const source = await addSource(nbId, { title: res.title, kind: res.kind, pages: res.pages, meta: { ...res.meta, warnings: res.warnings } });
    sources = await listSources(nbId);
    invalidate(nbId);
    paintList();
    return source;
  }

  async function run() {
    if (running) return;
    running = true;
    try {
      for (const item of queue) {
        if (item.status !== 'wait') continue;
        item.status = 'run';
        item.note = 'Lecture du fichier…';
        paintQueue();
        try {
          const res = await importer.importFile(item.file, {
            signal: item.controller.signal,
            onProgress: (p) => {
              item.phase = p.phase;
              item.done = p.done;
              item.total = p.total;
              item.note = progressNote(p);
              paintQueueItem(item);
            },
          });
          item.note = 'Enregistrement…';
          paintQueueItem(item);
          const source = await save(res);
          item.status = 'done';
          item.warnings = res.warnings;
          item.note = `Ajouté : ${plural(source.chunkCount, 'extrait')}.`;
          announce(`${item.name} ajouté.`);
          if (!item.warnings.length) {
            // les imports sans remarque disparaissent d'eux-mêmes ; les autres restent jusqu'à ce qu'on les retire
            const t = setTimeout(() => {
              const i = queue.indexOf(item);
              if (i >= 0 && item.status === 'done') {
                queue.splice(i, 1);
                paintQueue();
                paintList();
              }
            }, 6000);
            onCleanup(() => clearTimeout(t));
          }
        } catch (e) {
          if (item.controller.signal.aborted || e?.name === 'AbortError') {
            item.status = 'cancelled';
            item.note = 'Annulé.';
          } else {
            item.status = 'error';
            item.note = e instanceof ImportError ? e.message : `Lecture impossible : ${e?.message || 'erreur inconnue'}`;
            console.error(e);
          }
        }
        paintQueue();
        if (signal.aborted) break;
      }
    } finally {
      running = false;
      if (!queue.some((q) => q.status === 'wait' || q.status === 'run')) await importer.close();
    }
  }

  function paintQueueItem(item) {
    const li = queueEl.querySelector(`[data-q="${item.id}"]`);
    if (!li) return paintQueue();
    li.replaceWith(queueRow(item));
  }

  function queueRow(item) {
    const pct = item.total ? Math.round((Math.min(item.done, item.total) / item.total) * 100) : item.status === 'done' ? 100 : 0;
    const working = item.status === 'run' || item.status === 'wait';
    return h(
      'li.q-item',
      { dataset: { q: item.id, status: item.status } },
      h(
        'div.q-head',
        icon(item.status === 'done' ? 'circle-check' : item.status === 'error' ? 'circle-x' : kindIcon(item.file.type?.startsWith('image/') ? 'image' : 'pdf'), { size: 22 }),
        h('span.q-name', item.name),
        h('span.q-size', formatBytes(item.file.size)),
        working
          ? h('button.btn.btn-quiet.btn-sm', { type: 'button', onclick: () => (item.controller.abort(), item.status === 'wait' && ((item.status = 'cancelled'), (item.note = 'Annulé.'), paintQueue())) }, 'Annuler')
          : h(
              'button.btn.btn-quiet.btn-sm.btn-icon',
              {
                type: 'button',
                'aria-label': `Retirer « ${item.name} » de la liste`,
                title: 'Retirer de la liste',
                onclick: () => {
                  queue.splice(queue.indexOf(item), 1);
                  paintQueue();
                  paintList();
                },
              },
              icon('x', { size: 18 })
            )
      ),
      working ? h('div.progress', { role: 'progressbar', 'aria-label': item.name, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': item.total ? pct : undefined, dataset: item.total ? {} : { indeterminate: '' } }, h('span', { style: { '--p': pct } })) : null,
      h('p.q-note', { class: { 'is-error': item.status === 'error' }, role: item.status === 'error' ? 'alert' : undefined }, item.note),
      item.warnings?.length ? h('ul.q-warn', item.warnings.map((w) => h('li', icon('triangle-alert', { size: 16 }), w))) : null,
      item.status === 'error'
        ? h(
            'button.btn.btn-sm',
            {
              type: 'button',
              onclick: () => {
                Object.assign(item, { status: 'wait', note: 'En attente…', controller: new AbortController(), done: 0, total: 0 });
                paintQueue();
                run();
              },
            },
            icon('refresh-cw', { size: 16 }),
            'Réessayer'
          )
        : null
    );
  }

  function paintQueue() {
    queueEl.hidden = queue.length === 0;
    mount(queueEl, queue.map(queueRow));
    emptyEl.hidden = sources.length > 0 || queue.length > 0;
  }

  onCleanup(() => {
    for (const q of queue) q.controller.abort();
    importer.close();
  });

  paintQueue();
  paintList();
}

/** Phrase d'avancement affichée sous la barre de progression. */
function progressNote(p) {
  if (p.phase === 'read') return `Lecture de la page ${p.done} sur ${p.total}…`;
  if (p.page) return `Lecture par OCR : page ${p.page} (${p.done + 1} sur ${p.total})…`;
  if (p.done <= 0) return 'Préparation de la lecture du texte (OCR)…';
  if (p.total === 1 && p.done < 1) return `Lecture du texte de l’image… ${Math.round(p.done * 100)} %`;
  return 'Lecture par OCR terminée…';
}

function help() {
  return h(
    'details.help',
    h('summary', icon('circle-question-mark', { size: 18 }), 'Formats, limites et astuces'),
    h(
      'div.help-body',
      h('ul', [
        h('li', h('strong', 'Formats lus : '), 'PDF, Word (.docx), PowerPoint (.pptx), texte (.txt), Markdown (.md), pages web enregistrées (.html), LaTeX (.tex), sous-titres (.srt, .vtt) et images (photo de cahier, capture d’écran).'),
        h('li', h('strong', 'Photos et PDF scannés : '), 'ils sont lus par reconnaissance de texte (OCR), directement sur ton appareil. Cadre bien le texte imprimé, avec une bonne lumière. L’écriture manuscrite est mal lue.'),
        h('li', h('strong', 'Formules : '), 'les équations Word sont conservées. Dans un PDF, les formules sont souvent abîmées : vérifie le texte lu en touchant la source.'),
        h('li', h('strong', 'Pas d’import par lien : '), 'pour des raisons de sécurité, un navigateur ne peut pas lire d’autres sites. Enregistre la page (Ctrl+S, « Page web, HTML seulement ») puis ajoute le fichier, ou copie-colle le texte. Pour une vidéo, colle sa transcription ou son fichier de sous-titres.'),
        h('li', h('strong', 'Limites : '), '80 Mo par fichier et environ 3 millions de caractères par source. Découpe un très gros document.')
      ])
    )
  );
}
