// Cartes mémoire : séance de révision espacée, gestion du paquet, création (sans IA, avec IA, à la main), export.
import { deleteItem, listItems, saveItem, saveItems } from '../../../db.js';
import { generateCards } from '../../../ai/generate.js';
import { CARD_FILTERS, cardCounts, cardsToAnki, cardsToCSV, freshCards, matchesFilter, normKey, toStoredCard } from '../../../study/build.js';
import { autoCards } from '../../../study/heuristics.js';
import { createSession } from '../../../study/session.js';
import { GRADES, newSrs, previewLabels } from '../../../study/srs.js';
import { download, formatDuration, safeFilename } from '../../../util.js';
import { segmented } from '../../controls.js';
import { announce, confirmDialog, h, icon, mount, openDialog, plural, toast } from '../../dom.js';
import { markdownToText } from '../../markdown.js';
import { aiLine, field, genPanel, isRunning, jobStatus, launchJob, noSources, onJobChange, originChip, rich, selectOf, sourceChip, verifyChip } from './common.js';

const PAGE = 50;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Où en est une carte, en quelques mots. */
function stateLabel(srs, now = Date.now()) {
  if (!srs || srs.state === 'new') return ['Nouvelle', 'chip-info'];
  if (srs.state === 'learning') return ['En apprentissage', 'chip-warn'];
  if (srs.due <= now) return ['À revoir', 'chip-bad'];
  return [`Revue dans ${formatDuration(srs.due - now)}`, 'chip-ok'];
}

export default async function cardsView({ root, onCleanup, shell }) {
  const nbId = shell.id;
  const data = await shell.getData();
  let cards = await listItems('cards', nbId);
  const titleById = new Map(data.sources.map((s) => [s.id, s.title]));
  const chunkById = new Map(data.chunks.map((c) => [c.id, c]));
  const JOB = `cards:${nbId}`;

  let section = cards.length ? 'review' : 'create'; // review | manage | create
  let session = null;
  let revealed = false;
  let saving = Promise.resolve();
  let filter = 'all';
  let query = '';
  let shown = PAGE;
  let manageEl = null;
  let createEl = null;

  const navHolder = h('div.view-nav');
  const body = h('div.cards-body');
  mount(root, h('div.cards-view', h('div.view-head', h('h2', { 'data-focus': '', tabindex: '-1' }, 'Cartes mémoire'), navHolder), body));

  // ---------------------------------------------------------------- données
  const persist = (card) => {
    cards = cards.map((c) => (c.id === card.id ? card : c));
    saving = saving.then(() => saveItem('cards', nbId, card)).catch((e) => {
      console.error(e);
      toast('Impossible d’enregistrer cette carte sur l’appareil.', { kind: 'error' });
    });
    return saving;
  };

  async function reload() {
    cards = await listItems('cards', nbId);
    shell.refresh();
    paint();
  }

  onJobChange(JOB, onCleanup, (job) => {
    if (job?.status === 'done') reload();
    else paintNav();
  });

  // ---------------------------------------------------------------- navigation
  let navEl = null;
  let navCount = -1;
  function paintNav() {
    if (navEl && navCount === cards.length) return navEl.setValue(section);
    const hadFocus = navHolder.contains(document.activeElement);
    navCount = cards.length;
    navEl = segmented({
      label: 'Section des cartes',
      value: section,
      options: [
        { value: 'review', label: 'Réviser' },
        { value: 'manage', label: `Mes cartes (${cards.length})` },
        { value: 'create', label: 'Créer' },
      ],
      onChange: (v) => {
        if (session && !session.done && session.answered) toast('Séance interrompue : tes réponses sont enregistrées.', { timeout: 2500 });
        section = v;
        session = null;
        paint();
      },
    });
    mount(navHolder, navEl);
    if (hadFocus) navEl.querySelector('[aria-checked="true"]')?.focus();
  }

  function paint() {
    paintNav();
    if (section === 'review') mount(body, session ? sessionView() : reviewStart());
    else if (section === 'manage') {
      manageEl ??= buildManage();
      paintList();
      mount(body, manageEl);
    } else {
      createEl ??= buildCreate();
      mount(body, createEl);
    }
  }

  // ---------------------------------------------------------------- réviser : accueil
  const stat = (n, label) => h('div.stat', h('strong.stat-n', String(n)), h('span.stat-l', label));

  function reviewStart() {
    if (!cards.length) {
      return h(
        'div.empty',
        icon('layers', { size: 40 }),
        h('h3', 'Aucune carte pour l’instant'),
        h('p', 'Les cartes mémoire te font réviser au bon moment : tu retournes la carte, tu te notes, et l’appli te la repose juste avant que tu l’oublies. Crée tes premières cartes en un clic, sans IA.'),
        h('div.btn-row', h('button.btn.btn-primary', { type: 'button', onclick: () => ((section = 'create'), paint()) }, icon('plus'), 'Créer des cartes'))
      );
    }
    const c = cardCounts(cards);
    const todo = c.due + c.todayNew;
    return h(
      'div.rev-start',
      h('div.stats', stat(c.due, 'à revoir'), stat(c.todayNew, c.todayNew > 1 ? 'nouvelles aujourd’hui' : 'nouvelle aujourd’hui'), stat(c.total, c.total > 1 ? 'cartes en tout' : 'carte en tout'), stat(c.learned, c.learned > 1 ? 'bien apprises' : 'bien apprise')),
      todo
        ? h(
            'div.btn-row',
            h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: () => startSession() }, icon('play'), `Commencer la séance (${plural(todo, 'carte')})`)
          )
        : h(
            'div.callout.callout-ok',
            icon('circle-check'),
            h('div', h('p', h('strong', 'Tout est à jour. '), 'Aucune carte à revoir pour le moment : reviens plus tard, ou ajoute de nouvelles cartes.'), h('button.btn.btn-sm', { type: 'button', onclick: () => ((section = 'create'), paint()) }, icon('plus', { size: 16 }), 'Créer des cartes'))
          ),
      c.toCheck
        ? h(
            'div.callout.callout-warn',
            icon('triangle-alert'),
            h('div', h('p', `${plural(c.toCheck, 'carte')} ${c.toCheck > 1 ? 'sont marquées' : 'est marquée'} « à vérifier » : l’IA n’a pas pu prouver sa réponse avec ton cours. Relis-les avant de les apprendre.`), h('button.btn.btn-sm', { type: 'button', onclick: () => ((filter = 'check'), (section = 'manage'), paint()) }, 'Voir ces cartes'))
          )
        : null,
      matchMedia('(hover: hover)').matches
        ? h('p.small.muted', h('kbd.kbd', 'Espace'), ' montre la réponse · ', h('kbd.kbd', '1'), ' à ', h('kbd.kbd', '4'), ' pour te noter · ', h('kbd.kbd', 'Z'), ' annule la dernière note.')
        : null
    );
  }

  // ---------------------------------------------------------------- réviser : séance
  function startSession({ newLimit = 15 } = {}) {
    session = createSession(cards, { newLimit });
    revealed = false;
    paint();
    if (session.done) toast('Aucune carte à revoir pour le moment.', { timeout: 2500 });
  }

  function reveal() {
    revealed = true;
    paint();
    root.querySelector('.grade-2')?.focus({ preventScroll: true });
    announce('Réponse affichée.');
  }

  function grade(g) {
    const updated = session.answer(g);
    if (!updated) return;
    persist(updated);
    revealed = false;
    paint();
    root.querySelector('.flash-reveal')?.focus({ preventScroll: true });
  }

  function undo() {
    const prev = session?.undo();
    if (!prev) return;
    persist(prev);
    revealed = false;
    paint();
    toast('Dernière note annulée.', { timeout: 1800 });
  }

  function quit() {
    session = null;
    revealed = false;
    shell.refresh();
    paint();
  }

  function sessionView() {
    const card = session.current;
    if (!card) return summaryView();
    const total = session.answered + session.remaining;
    const pct = total ? Math.round((100 * session.answered) / total) : 0;
    const labels = previewLabels(card.srs);
    return h(
      'div.rev',
      h(
        'div.rev-top',
        h('div.progress', { role: 'progressbar', 'aria-label': 'Avancement de la séance', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, h('span', { style: { '--p': pct } })),
        h('span.small', plural(session.remaining, 'carte restante', 'cartes restantes')),
        h('button.btn.btn-quiet.btn-sm', { type: 'button', disabled: !session.canUndo, onclick: undo, title: 'Annuler la dernière note (Z)' }, icon('rotate-ccw', { size: 16 }), 'Annuler'),
        h('button.btn.btn-quiet.btn-sm', { type: 'button', onclick: quit }, icon('x', { size: 16 }), 'Quitter')
      ),
      h(
        'article.flash',
        { 'aria-label': 'Carte à réviser' },
        h('div.flash-meta', originChip(card), verifyChip(card)),
        h('div.flash-front', rich(card.front, { headingOffset: 3 })),
        revealed ? h('div.flash-back', { 'aria-live': 'polite' }, rich(card.back, { headingOffset: 3 }), sourceChip(card)) : null
      ),
      revealed
        ? h(
            'div.grades',
            { role: 'group', 'aria-label': 'Comment as-tu trouvé cette carte ?' },
            GRADES.map((g, i) =>
              h(
                `button.grade.grade-${g.id}`,
                { type: 'button', onclick: () => grade(g.id), title: `${g.hint} (touche ${i + 1})` },
                h('span.grade-name', g.label),
                h('span.grade-next', labels[i]),
                h('kbd.kbd.grade-key', { 'aria-hidden': 'true' }, String(i + 1))
              )
            )
          )
        : h('button.btn.btn-primary.btn-lg.btn-block.flash-reveal', { type: 'button', onclick: reveal }, icon('eye'), 'Montrer la réponse')
    );
  }

  function summaryView() {
    const stats = session.stats;
    const c = cardCounts(cards);
    const next = session.nextDue();
    const total = session.answered;
    return h(
      'div.rev-done',
      icon('circle-check', { size: 44 }),
      h('h3', { 'data-focus': '', tabindex: '-1' }, total ? 'Séance terminée, bravo !' : 'Rien à revoir pour le moment'),
      total
        ? h(
            'div.stats',
            GRADES.map((g) => h('div.stat', h('strong.stat-n', String(stats[g.id])), h('span.stat-l', g.label)))
          )
        : null,
      total ? h('p', `${plural(session.cards.length, 'carte révisée', 'cartes révisées')}.${next ? ` La prochaine reviendra dans ${formatDuration(next - Date.now())}.` : ''}`) : h('p', 'Reviens plus tard : l’appli te reposera les cartes au bon moment.'),
      h(
        'div.btn-row',
        c.fresh > 0 ? h('button.btn.btn-primary', { type: 'button', onclick: () => startSession({ newLimit: 10 }) }, icon('plus'), `Continuer avec ${Math.min(c.fresh, 10)} nouvelles cartes`) : null,
        h('button.btn', { type: 'button', onclick: quit }, 'Terminer')
      )
    );
  }

  function onKey(e) {
    if (section !== 'review' || !session || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (document.querySelector('dialog[open]')) return;
    const t = e.target;
    if (t?.closest?.('input, textarea, select')) return;
    if (!session.current) return;
    if (e.key === 'z' || e.key === 'Z') {
      if (session.canUndo) {
        e.preventDefault();
        undo();
      }
      return;
    }
    const onButton = !!t?.closest?.('button, a');
    if (!revealed) {
      if ((e.key === ' ' || e.key === 'Enter') && !onButton) {
        e.preventDefault();
        reveal();
      }
      return;
    }
    const k = ['1', '2', '3', '4'].indexOf(e.key);
    if (k >= 0) {
      e.preventDefault();
      grade(k);
    } else if ((e.key === ' ' || e.key === 'Enter') && !onButton) {
      e.preventDefault();
      grade(2);
    }
  }
  document.addEventListener('keydown', onKey);
  onCleanup(() => document.removeEventListener('keydown', onKey));

  // ---------------------------------------------------------------- mes cartes
  function cardForm(card = { front: '', back: '' }) {
    const front = h('textarea', { id: 'cf-front', rows: 3, maxlength: 500, placeholder: 'Une question, ou un terme à définir', value: card.front });
    const back = h('textarea', { id: 'cf-back', rows: 4, maxlength: 900, placeholder: 'La réponse, courte', value: card.back });
    const el = h('div', field('cf-front', 'Recto (la question)', front), field('cf-back', 'Verso (la réponse)', back), h('p.hint', 'Tu peux écrire une formule entre $ $ (par exemple $x^2 + 1$) et du gras avec **deux étoiles**.'));
    return { el, values: () => ({ front: front.value.trim(), back: back.value.trim() }) };
  }

  async function editCard(card) {
    const form = cardForm(card);
    const ok = await openDialog({
      title: 'Modifier la carte',
      body: form.el,
      actions: [
        { label: 'Annuler', value: false, kind: 'quiet' },
        {
          label: 'Enregistrer',
          value: true,
          kind: 'primary',
          onClick: () => {
            const v = form.values();
            if (!v.front || !v.back) {
              toast('Le recto et le verso ne peuvent pas être vides.', { kind: 'error', timeout: 3000 });
              return false;
            }
          },
        },
      ],
    });
    if (ok !== true) return;
    const v = form.values();
    await persist({ ...card, ...v });
    paintList();
  }

  async function addCard() {
    const form = cardForm();
    const ok = await openDialog({
      title: 'Ajouter une carte',
      body: form.el,
      actions: [
        { label: 'Annuler', value: false, kind: 'quiet' },
        {
          label: 'Ajouter',
          value: true,
          kind: 'primary',
          onClick: () => {
            const v = form.values();
            if (!v.front || !v.back) {
              toast('Écris le recto et le verso.', { kind: 'error', timeout: 3000 });
              return false;
            }
          },
        },
      ],
    });
    if (ok !== true) return;
    await saveItem('cards', nbId, ownCard(form.values()));
    toast('Carte ajoutée.', { kind: 'ok', timeout: 2000 });
    await reload();
  }

  const ownCard = ({ front, back }) => ({ front, back, quote: '', verified: null, origin: 'own', chunkId: null, sourceId: null, srs: newSrs() });

  async function removeCard(card) {
    await deleteItem('cards', card.id);
    cards = cards.filter((c) => c.id !== card.id);
    shell.refresh();
    paintNav();
    paintList();
    toast('Carte supprimée.', {
      timeout: 6000,
      action: {
        label: 'Annuler',
        onClick: async () => {
          await saveItem('cards', nbId, card);
          await reload();
        },
      },
    });
  }

  function visibleCards() {
    const q = normKey(query);
    return cards.filter((c) => matchesFilter(c, filter) && (!q || normKey(`${c.front} ${c.back}`).includes(q)));
  }

  function cardRow(c) {
    const [label, cls] = stateLabel(c.srs);
    return h(
      'li.card-row',
      h(
        'div.card-row-text',
        h('p.card-row-front', clip(markdownToText(c.front), 220)),
        h('p.card-row-back', clip(markdownToText(c.back).replace(/\n+/g, ' · '), 220)),
        h('div.card-row-meta', h(`span.chip.${cls}`, label), originChip(c), verifyChip(c), sourceChip(c))
      ),
      h(
        'div.card-row-actions',
        h('button.btn.btn-quiet.btn-sm.btn-icon', { type: 'button', 'aria-label': `Modifier la carte : ${clip(markdownToText(c.front), 60)}`, title: 'Modifier', onclick: () => editCard(c) }, icon('pencil', { size: 18 })),
        h('button.btn.btn-quiet.btn-sm.btn-icon', { type: 'button', 'aria-label': `Supprimer la carte : ${clip(markdownToText(c.front), 60)}`, title: 'Supprimer', onclick: () => removeCard(c) }, icon('trash', { size: 18 }))
      )
    );
  }

  let listEl;
  let countEl;
  function paintList() {
    if (!listEl) return;
    const list = visibleCards();
    countEl.textContent = list.length === cards.length ? plural(cards.length, 'carte') : `${list.length} sur ${cards.length}`;
    const page = list.slice(0, shown);
    mount(
      listEl,
      page.length
        ? [
            h('ul.card-list', page.map(cardRow)),
            list.length > shown ? h('div.btn-row', h('button.btn', { type: 'button', onclick: () => ((shown += PAGE), paintList()) }, `Afficher ${Math.min(PAGE, list.length - shown)} cartes de plus`)) : null,
          ]
        : h('div.empty', icon('search', { size: 32 }), h('h3', cards.length ? 'Aucune carte ne correspond' : 'Aucune carte'), h('p', cards.length ? 'Change le filtre ou les mots cherchés.' : 'Crée des cartes dans l’onglet « Créer ».'))
    );
  }

  function buildManage() {
    countEl = h('output.small.muted', { 'aria-live': 'polite' });
    listEl = h('div.card-list-wrap');
    const search = h('input', {
      type: 'search',
      id: 'card-search',
      placeholder: 'Chercher dans mes cartes…',
      'aria-label': 'Chercher dans mes cartes',
      value: query,
      oninput: (e) => {
        query = e.target.value;
        shown = PAGE;
        paintList();
      },
    });
    const sel = selectOf(
      'card-filter',
      CARD_FILTERS.map((f) => [f.id, f.label]),
      filter,
      (v) => {
        filter = v;
        shown = PAGE;
        paintList();
      }
    );
    sel.setAttribute('aria-label', 'Filtrer les cartes');
    const exportAnki = () => download(`cartes-${safeFilename(data.notebook.title)}.txt`, cardsToAnki(cards), 'text/plain;charset=utf-8');
    const exportCsv = () => download(`cartes-${safeFilename(data.notebook.title)}.csv`, cardsToCSV(cards, titleById), 'text/csv;charset=utf-8');
    return h(
      'div.manage',
      h(
        'div.toolbar',
        search,
        sel,
        countEl,
        h('button.btn.btn-sm', { type: 'button', onclick: addCard }, icon('plus', { size: 16 }), 'Ajouter')
      ),
      listEl,
      h(
        'details.help',
        h('summary', icon('download', { size: 18 }), 'Emporter mes cartes ailleurs'),
        h(
          'div.help-body',
          h('p', 'Tes cartes t’appartiennent. Exporte-les pour les utiliser dans Anki (gratuit) ou dans un tableur.'),
          h(
            'div.btn-row',
            h('button.btn.btn-sm', { type: 'button', disabled: !cards.length, onclick: exportAnki }, icon('download', { size: 16 }), 'Pour Anki (.txt)'),
            h('button.btn.btn-sm', { type: 'button', disabled: !cards.length, onclick: exportCsv }, icon('download', { size: 16 }), 'Tableur (.csv)')
          ),
          h('p.hint', 'Dans Anki : Fichier, Importer, choisis le fichier .txt ; les champs sont déjà reconnus.')
        )
      ),
      h(
        'div.btn-row.danger-zone',
        h(
          'button.btn.btn-danger.btn-sm',
          {
            type: 'button',
            disabled: !cards.length,
            onclick: async () => {
              if (!(await confirmDialog({ title: 'Supprimer toutes les cartes ?', message: `Les ${plural(cards.length, 'carte')} de ce carnet seront effacées de cet appareil, avec leur progression. Pense à les exporter avant si tu veux les garder.`, confirmLabel: 'Tout supprimer', danger: true }))) return;
              await Promise.all(cards.map((c) => deleteItem('cards', c.id)));
              await reload();
              toast('Toutes les cartes ont été supprimées.', { timeout: 3000 });
            },
          },
          icon('trash', { size: 16 }),
          'Supprimer toutes les cartes'
        )
      )
    );
  }

  // ---------------------------------------------------------------- créer
  function buildCreate() {
    if (!data.chunks.length) return noSources(nbId, data);
    return h('div.create', autoPanel(), aiPanel(), manualPanel());
  }

  function autoPanel() {
    const out = h('div.auto-out', { 'aria-live': 'polite' });
    const amount = selectOf('auto-n', [[10, '10 cartes'], [20, '20 cartes'], [40, '40 cartes']], 20);
    const go = h('button.btn.btn-primary', { type: 'button', onclick: search }, icon('search', { size: 18 }), 'Chercher des cartes');

    function search() {
      go.disabled = true;
      mount(out, h('p.muted', h('span.spinner', { 'aria-hidden': 'true' }), ' Lecture de tes sources…'));
      // on laisse le navigateur afficher l'attente avant le calcul
      setTimeout(() => {
        try {
          const want = Number(amount.value);
          const found = autoCards(data.chunks, { max: Math.min(160, want + cards.length) });
          const fresh = freshCards(found, cards).slice(0, want);
          preview(fresh, found.length - freshCards(found, cards).length);
        } catch (e) {
          console.error(e);
          mount(out, h('div.callout.callout-bad', icon('triangle-alert'), h('div', h('p', 'La recherche a échoué. Essaie avec moins de sources actives.'))));
        } finally {
          go.disabled = false;
        }
      }, 30);
    }

    function preview(list, already) {
      if (!list.length) {
        mount(
          out,
          h(
            'div.callout',
            icon('info'),
            h('div', h('p', already ? 'Toutes les cartes trouvées sont déjà dans ton paquet.' : 'Je n’ai trouvé aucune définition claire dans tes sources. Ce n’est pas grave : une IA ou la saisie à la main font très bien le travail.'))
          )
        );
        return;
      }
      const checks = list.map(() => h('input', { type: 'checkbox', checked: true }));
      const addBtn = h('button.btn.btn-primary', { type: 'button' });
      const paintBtn = () => {
        const n = checks.filter((c) => c.checked).length;
        addBtn.disabled = n === 0;
        mount(addBtn, icon('plus', { size: 18 }), n ? `Ajouter ${plural(n, 'carte')}` : 'Aucune carte cochée');
      };
      for (const c of checks) c.addEventListener('change', paintBtn);
      addBtn.addEventListener('click', async () => {
        const picked = list.filter((_, i) => checks[i].checked).map((c) => toStoredCard(c, { chunkById, titleById, origin: 'auto' }));
        addBtn.disabled = true;
        await saveItems('cards', nbId, picked);
        toast(`${plural(picked.length, 'carte ajoutée', 'cartes ajoutées')}.`, { kind: 'ok' });
        mount(out);
        section = 'review';
        await reload();
      });
      paintBtn();
      const toggle = (on) => {
        checks.forEach((c) => (c.checked = on));
        paintBtn();
      };
      mount(
        out,
        h('p', h('strong', `${plural(list.length, 'carte trouvée', 'cartes trouvées')}`), already ? ` (${already} déjà dans ton paquet)` : '', '. Décoche celles qui ne te servent pas : elles se relisent avant d’apprendre.'),
        h('div.btn-row', h('button.btn.btn-quiet.btn-sm', { type: 'button', onclick: () => toggle(true) }, 'Tout cocher'), h('button.btn.btn-quiet.btn-sm', { type: 'button', onclick: () => toggle(false) }, 'Tout décocher')),
        h(
          'ul.auto-list',
          list.map((c, i) =>
            h(
              'li.auto-item',
              h('label', { for: `auto-${i}` }, checks[i], h('span', h('span.auto-front', c.front), h('span.auto-back', clip(c.back.replace(/\n+/g, ' · '), 260)))),
              h('div.card-row-meta', h('span.chip', c.kind === 'cloze' ? 'Texte à trous' : 'Définition'), sourceChip(toStoredCard(c, { chunkById, titleById })))
            )
          )
        ),
        h('div.btn-row', addBtn)
      );
      list.forEach((_, i) => (checks[i].id = `auto-${i}`));
    }

    return genPanel({
      id: 'gen-auto',
      ic: 'search',
      title: 'Sans IA : chercher dans mes sources',
      lead: 'Carnet Libre repère les définitions (« X est… », « on appelle… », les termes en gras) et fabrique des textes à trous avec les mots importants du cours. Tout se passe sur ton appareil.',
      children: [field('auto-n', 'Combien ?', amount)],
      actions: [go],
      extra: [out],
    });
  }

  function aiPanel() {
    const count = selectOf('ai-n', [[8, '8 cartes'], [12, '12 cartes'], [20, '20 cartes']], 12);
    const focus = h('input', { id: 'ai-focus', type: 'text', maxlength: 120, placeholder: 'Un chapitre ou une notion (facultatif)', autocomplete: 'off', spellcheck: false });
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
        kind: 'cards',
        label: 'Création des cartes',
        purpose: 'créer des cartes',
        run: async ({ signal, setNote, setChars, config }) => {
          const res = await generateCards({ notebook: data.notebook, chunks: data.chunks, sources: data.sources, index: data.index, count: n, focus: topic, signal, config, onProgress: setChars, onStatus: setNote });
          const fresh = freshCards(res.cards, await listItems('cards', nbId));
          const cut = res.truncated ? ' La réponse de l’IA a été coupée : demande moins de cartes à la fois.' : '';
          if (!fresh.length) return { message: `Toutes les cartes proposées étaient déjà dans ton paquet.${cut}`, href: `/n/${nbId}/cartes` };
          await saveItems('cards', nbId, fresh);
          const check = fresh.filter((c) => c.verified === false).length;
          return { message: `${plural(fresh.length, 'carte ajoutée', 'cartes ajoutées')}${check ? `, dont ${check} à vérifier` : ''}.${cut}`, href: `/n/${nbId}/cartes` };
        },
      });
      if (job) paintGo();
    });
    onJobChange(JOB, onCleanup, paintGo);
    paintGo();
    return genPanel({
      id: 'gen-ai',
      ic: 'sparkles',
      title: 'Avec une IA',
      lead: 'L’IA lit tes sources actives et écrit des cartes plus variées (questions, comparaisons, exemples). Chaque carte garde la phrase de ton cours qui la justifie ; si elle ne se retrouve pas, la carte est marquée « à vérifier ».',
      children: [field('ai-n', 'Combien ?', count), field('ai-focus', 'Sur quoi ?', focus)],
      actions: [go],
      extra: [jobStatus(JOB, onCleanup), aiLine(onCleanup)],
    });
  }

  function manualPanel() {
    const form = cardForm();
    const go = h('button.btn', { type: 'submit' }, icon('plus', { size: 18 }), 'Ajouter la carte');
    const el = h('form', { onsubmit: onSubmit }, form.el, h('div.btn-row', go));
    async function onSubmit(e) {
      e.preventDefault();
      const v = form.values();
      if (!v.front || !v.back) return toast('Écris le recto et le verso.', { kind: 'error', timeout: 3000 });
      await saveItem('cards', nbId, ownCard(v));
      el.reset();
      toast('Carte ajoutée.', { kind: 'ok', timeout: 2000 });
      await reload();
      section = 'create';
      paint();
    }
    return genPanel({ id: 'gen-own', ic: 'pencil', title: 'À la main', lead: 'Pour tes propres cartes : une formule à retenir, un mot de vocabulaire, une date…', extra: [el] });
  }

  paint();
}
