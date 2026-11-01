// Discuter avec ses cours : réponses de l'IA avec citations cliquables, ou — sans IA — les passages
// les plus proches de la question.
import { getChat, saveChat, saveItem } from '../../db.js';
import { askQuestion } from '../../ai/generate.js';
import { PROVIDERS } from '../../ai/providers.js';
import { getSettings, subscribe } from '../../settings.js';
import { suggestQuestions, stripMarkdown } from '../../study/heuristics.js';
import { terms } from '../../text/bm25.js';
import { buildIndex } from '../../ai/rag.js';
import { confirmDialog, copyText, h, icon, mount, toast } from '../dom.js';
import { ensureAI, kindChip } from '../ai-gate.js';
import { markdownToText, renderMarkdown } from '../markdown.js';
import { openPassage } from '../passage.js';
import { href, navigate } from '../router.js';

const WORD_RE = /\p{L}[\p{L}\p{N}'’-]*/gu;
const SEARCH_LIMIT = 6;

/** Texte découpé en morceaux, avec les mots de la question surlignés. */
function markWords(text, queryTerms) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    if (!terms(m[0]).some((t) => queryTerms.has(t))) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h('mark', m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Extrait d'un passage centré sur le premier mot trouvé. */
function excerpt(text, queryTerms, max = 380) {
  const clean = stripMarkdown(text).replace(/\s+/g, ' ').trim();
  let first = -1;
  for (const m of clean.matchAll(WORD_RE)) {
    if (terms(m[0]).some((t) => queryTerms.has(t))) {
      first = m.index;
      break;
    }
  }
  let start = 0;
  if (first > 90) {
    const sp = clean.indexOf(' ', first - 90);
    start = sp >= 0 && sp < first ? sp + 1 : first;
  }
  let end = Math.min(clean.length, start + max);
  if (end < clean.length) {
    const sp = clean.lastIndexOf(' ', end);
    if (sp > start + max * 0.6) end = sp;
  }
  return [start > 0 ? '… ' : '', ...markWords(clean.slice(start, end), queryTerms), end < clean.length ? ' …' : ''];
}

export default async function chatView({ root, shell, signal, onCleanup }) {
  const nbId = shell.id;
  let data = await shell.getData();
  const saved = await getChat(nbId);
  /** @type {{role: 'user'|'assistant', content?: string, refs?: object[], kind?: string, results?: object[], query?: string, error?: object, truncated?: boolean, interrupted?: boolean, persist?: boolean, usedChunks?: number}[]} */
  let log = saved.messages.slice();
  let ctl = null; // question en cours
  let searchOnly = false;

  const logEl = h('div.chat-log', { role: 'log', 'aria-label': 'Conversation', 'aria-live': 'polite' });
  const status = h('div.chat-status');
  const suggestEl = h('div.chat-suggest');
  const privacyEl = h('p.small.muted.chat-privacy');
  const input = h('textarea', { rows: 1, id: 'chat-input', placeholder: 'Pose une question sur tes cours…', 'aria-label': 'Ta question', maxlength: 2000, enterkeyhint: 'send' });
  const sendBtn = h('button.btn.btn-primary.btn-icon', { type: 'submit', 'aria-label': 'Envoyer la question', title: 'Envoyer' }, icon('send'));
  const stopBtn = h('button.btn.btn-icon', { type: 'button', 'aria-label': 'Arrêter la réponse', title: 'Arrêter', hidden: true, onclick: () => ctl?.abort() }, icon('square'));
  const newBtn = h('button.btn.btn-quiet.btn-sm', { type: 'button', onclick: newConversation }, icon('rotate-ccw', { size: 16 }), 'Nouvelle conversation');
  const form = h('form.chat-form', { onsubmit: submit }, h('label.visually-hidden', { for: 'chat-input' }, 'Ta question'), input, sendBtn, stopBtn);

  mount(
    root,
    h(
      'div.chat',
      h('div.chat-head', h('h2', { 'data-focus': '', tabindex: '-1' }, 'Discuter avec tes cours'), newBtn),
      status,
      logEl,
      suggestEl,
      form,
      privacyEl
    )
  );

  // ---------------------------------------------------------------- état de l'IA
  function aiMode() {
    return !searchOnly && getSettings().ai.provider !== 'none';
  }

  function paintStatus() {
    const s = getSettings().ai;
    const p = PROVIDERS[s.provider] || PROVIDERS.none;
    const hasAI = p.kind !== 'none';
    mount(
      status,
      hasAI
        ? h(
            'div.chat-mode',
            h('div.seg', { role: 'group', 'aria-label': 'Type de réponse' }, [
              h('button', { type: 'button', 'aria-pressed': String(!searchOnly), onclick: () => setSearchOnly(false) }, icon('sparkles', { size: 16 }), 'Réponse de l’IA'),
              h('button', { type: 'button', 'aria-pressed': String(searchOnly), onclick: () => setSearchOnly(true) }, icon('search', { size: 16 }), 'Passages seulement'),
            ]),
            h('span.small.muted', `${p.short}${s.model ? ` · ${s.model}` : ''}`),
            kindChip(p)
          )
        : h(
            'div.callout',
            icon('info'),
            h(
              'div',
              h('p', h('strong', 'Pas d’IA branchée : '), 'je te montre les passages de tes cours les plus proches de ta question, avec les mots trouvés surlignés. Rien ne quitte ton appareil.'),
              h('p', h('a', { href: href('/reglages') }, 'Brancher une IA gratuite'), ' pour obtenir des réponses rédigées, avec leurs sources.')
            )
          )
    );
    const where = !hasAI || searchOnly ? 'Recherche locale : ta question reste sur cet appareil.' : p.kind === 'local' ? `${p.short} : rien ne quitte ton appareil (ou ton serveur).` : `Ta question et des extraits de tes sources sont envoyés à ${p.short}. `;
    mount(privacyEl, where, hasAI && p.kind === 'cloud' && !searchOnly ? h('a', { href: href('/confidentialite') }, 'Ce que ça implique') : null);
  }

  function setSearchOnly(v) {
    searchOnly = v;
    paintStatus();
  }

  const offSettings = subscribe(() => paintStatus());
  onCleanup(offSettings);

  // Les messages de confirmation (en bas de l'écran) se placent au-dessus de la zone de saisie, jamais dessus.
  if (typeof ResizeObserver === 'function') {
    const root$ = document.documentElement;
    const observer = new ResizeObserver(() => root$.style.setProperty('--compose-h', `${form.offsetHeight + 12}px`));
    observer.observe(form);
    onCleanup(() => {
      observer.disconnect();
      root$.style.removeProperty('--compose-h');
    });
  }

  // ---------------------------------------------------------------- affichage du fil
  function citeFor(refs) {
    return { refs: new Map((refs || []).map((r) => [r.n, r])), onOpen: (ref) => openPassage({ chunkId: ref.chunkId }) };
  }

  function answerBody(m, { streaming = false } = {}) {
    const body = h('div.prose', renderMarkdown(m.content || '', { breaks: true, math: !streaming, cite: citeFor(m.refs), headingOffset: 2 }));
    for (const p of body.querySelectorAll('p')) if (/^Hors de tes sources/i.test(p.textContent)) p.classList.add('outside');
    return body;
  }

  function actions(m, index) {
    const q = [...log.slice(0, index)].reverse().find((x) => x.role === 'user')?.content || '';
    return h(
      'div.msg-actions.no-print',
      h(
        'button.btn.btn-quiet.btn-sm',
        {
          type: 'button',
          onclick: async () => toast((await copyText(markdownToText(m.content))) ? 'Réponse copiée.' : 'Copie impossible : sélectionne le texte à la main.', { kind: 'ok', timeout: 2000 }),
        },
        icon('copy', { size: 16 }),
        'Copier'
      ),
      h(
        'button.btn.btn-quiet.btn-sm',
        {
          type: 'button',
          onclick: async () => {
            await saveItem('notes', nbId, { kind: 'reponse', title: q.slice(0, 70) || 'Réponse', question: q, markdown: m.content, refs: m.refs || [] });
            toast('Enregistré dans tes fiches.', { kind: 'ok', action: { label: 'Voir', onClick: () => navigate(`/n/${nbId}/fiches`) } });
          },
        },
        icon('bookmark', { size: 16 }),
        'Garder en fiche'
      )
    );
  }

  function message(m, i) {
    if (m.role === 'user') return h('div.msg.msg-user', h('p', m.content));
    if (m.kind === 'passages') return passagesMessage(m);
    if (m.kind === 'error') {
      return h(
        'div.msg.msg-bot.msg-error',
        { role: 'alert' },
        icon('triangle-alert'),
        h(
          'div',
          h('p', m.error.message),
          h(
            'div.btn-row',
            ['config', 'auth', 'model', 'consent'].includes(m.error.kind) ? h('a.btn.btn-sm', { href: href('/reglages') }, icon('settings', { size: 16 }), 'Ouvrir les réglages') : null,
            m.error.question ? h('button.btn.btn-sm', { type: 'button', onclick: () => retry(i) }, icon('refresh-cw', { size: 16 }), 'Réessayer') : null
          )
        )
      );
    }
    const refs = m.refs || [];
    return h(
      'article.msg.msg-bot',
      answerBody(m),
      m.interrupted ? h('p.small.muted', 'Réponse interrompue.') : null,
      m.truncated ? h('p.small', h('span.chip.chip-warn', icon('triangle-alert', { size: 14 }), 'Réponse coupée'), ' Écris « continue » pour avoir la suite.') : null,
      refs.length
        ? h(
            'div.msg-sources',
            h('span.small.muted', 'Sources citées :'),
            refs.map((r) => h('button.chip.chip-hl', { type: 'button', onclick: () => openPassage({ chunkId: r.chunkId }), title: 'Voir l’extrait' }, `[${r.n}] ${r.sourceTitle}${r.label ? ` — ${r.label.replace(/^§ /, '')}` : ''}`))
          )
        : h('p.small.muted', icon('info', { size: 14 }), ' Cette réponse ne cite aucune source : vérifie-la dans ton cours avant de la retenir.'),
      actions(m, i)
    );
  }

  function passagesMessage(m) {
    const q = new Set(terms(m.query));
    return h(
      'div.msg.msg-bot',
      m.results.length
        ? h('p', h('strong', `Passages les plus proches de « ${m.query} »`), h('span.small.muted', ' (classés par pertinence)'))
        : h('p', 'Aucun passage ne correspond à ces mots. Essaie avec d’autres termes, ou active plus de sources.'),
      h(
        'ol.passages',
        m.results.map((r) =>
          h(
            'li',
            h('div.passage-head', h('strong', r.sourceTitle), r.label ? h('span.chip', r.label.replace(/^§ /, '')) : null),
            h('p.passage-text', excerpt(r.text, q)),
            h('button.btn.btn-quiet.btn-sm', { type: 'button', onclick: () => openPassage({ chunkId: r.chunkId }) }, icon('book-open', { size: 16 }), 'Lire l’extrait en entier')
          )
        )
      )
    );
  }

  function paintLog() {
    mount(logEl, log.map(message));
    const empty = log.length === 0;
    newBtn.hidden = empty;
    suggestEl.hidden = !empty || !data.chunks.length;
    if (!suggestEl.hidden && !suggestEl.childElementCount) {
      mount(
        suggestEl,
        h('p.small.muted', 'Pour commencer, essaie par exemple :'),
        h(
          'div.chips',
          suggestQuestions(data.chunks, 5).map((q) => h('button.suggest', { type: 'button', onclick: () => ask(q) }, icon('lightbulb', { size: 16 }), q))
        )
      );
    }
    if (!data.chunks.length) {
      mount(
        logEl,
        h(
          'div.empty',
          icon('files', { size: 40 }),
          h('h3', data.sources.length ? 'Toutes tes sources sont désactivées' : 'Ajoute d’abord un cours'),
          h('p', data.sources.length ? 'Active au moins une source pour pouvoir lui poser des questions.' : 'Sans source, il n’y a rien à interroger. Dépose un PDF, une photo de ton cahier ou du texte.'),
          h('div.btn-row', h('a.btn.btn-primary', { href: href(`/n/${nbId}/sources`) }, icon('files'), 'Ouvrir mes sources'))
        )
      );
      suggestEl.hidden = true;
      form.hidden = true;
      privacyEl.hidden = true;
    }
  }

  const persist = () => saveChat(nbId, log.filter((m) => m.persist !== false && m.kind !== 'error' && m.kind !== 'passages'));
  const scrollDown = () => requestAnimationFrame(() => logEl.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));

  async function newConversation() {
    if (log.length && !(await confirmDialog({ title: 'Commencer une nouvelle conversation ?', message: 'La conversation actuelle sera effacée de cet appareil. Les réponses gardées en fiche restent disponibles.', confirmLabel: 'Effacer', danger: true }))) return;
    log = [];
    await saveChat(nbId, []);
    suggestEl.replaceChildren();
    paintLog();
    input.focus();
  }

  // ---------------------------------------------------------------- envoi d'une question
  function submit(e) {
    e.preventDefault();
    ask(input.value);
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !matchMedia('(pointer: coarse)').matches) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  const grow = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight + 2, 220)}px`;
  };
  input.addEventListener('input', grow);

  function setBusy(on) {
    sendBtn.hidden = on;
    stopBtn.hidden = !on;
    input.disabled = false;
    form.classList.toggle('is-busy', on);
  }

  function searchPassages(question) {
    const index = buildIndex(data.chunks);
    const byId = new Map(data.chunks.map((c) => [c.id, c]));
    const titles = new Map(data.sources.map((s) => [s.id, s.title]));
    return index
      .search(question, { limit: SEARCH_LIMIT })
      .map((h2) => byId.get(h2.id))
      .filter(Boolean)
      .map((c) => ({ chunkId: c.id, sourceTitle: titles.get(c.sourceId) || 'Source', label: c.label, text: c.text }));
  }

  async function ask(question, { retryOf } = {}) {
    const text = String(question || '').trim();
    if (!text || ctl) return;
    if (!aiMode()) {
      log.push({ role: 'user', content: text, persist: false }, { role: 'assistant', kind: 'passages', query: text, results: searchPassages(text), persist: false });
      input.value = '';
      grow();
      paintLog();
      scrollDown();
      return;
    }
    const config = await ensureAI('discuter avec tes cours');
    if (!config) return;

    input.value = '';
    grow();
    if (retryOf === undefined) log.push({ role: 'user', content: text });
    suggestEl.hidden = true;
    const history = log.filter((m) => m.role && m.content && !m.kind).slice(0, -1);
    paintLog();

    const bubble = h('article.msg.msg-bot', { 'aria-busy': 'true' }, h('p.msg-wait', h('span.spinner', { 'aria-hidden': 'true' }), h('span.wait-text', 'L’IA lit tes sources…')));
    logEl.append(bubble);
    scrollDown();

    ctl = new AbortController();
    const onAbortRoute = () => ctl?.abort();
    signal.addEventListener('abort', onAbortRoute, { once: true });
    setBusy(true);
    let live = '';
    let raf = 0;
    const paintLive = () => {
      raf = 0;
      if (signal.aborted) return;
      mount(bubble, answerBody({ content: live }, { streaming: true }));
      scrollDown();
    };
    try {
      const res = await askQuestion({
        notebook: data.notebook,
        chunks: data.chunks,
        sources: data.sources,
        index: data.index,
        question: text,
        history,
        config,
        signal: ctl.signal,
        onStatus: (s) => {
          const w = bubble.querySelector('.wait-text');
          if (w) w.textContent = s;
        },
        onToken: (t) => {
          live = t;
          if (!raf) raf = requestAnimationFrame(paintLive);
        },
      });
      if (raf) cancelAnimationFrame(raf);
      if (signal.aborted) return;
      log.push({ role: 'assistant', content: res.text, refs: res.refs, truncated: res.truncated, usedChunks: res.usedChunks });
      await persist();
    } catch (e) {
      if (raf) cancelAnimationFrame(raf);
      if (signal.aborted) return;
      if (e?.kind === 'abort' || e?.name === 'AbortError') {
        if (live.trim()) {
          log.push({ role: 'assistant', content: live, refs: [], interrupted: true });
          await persist();
        } else log.pop(); // rien reçu : la question est retirée
      } else {
        console.error(e);
        log.push({ role: 'assistant', kind: 'error', error: { kind: e?.kind, message: e?.message || 'Une erreur inattendue est survenue.', question: text }, persist: false });
      }
    } finally {
      signal.removeEventListener('abort', onAbortRoute);
      ctl = null;
      if (!signal.aborted) {
        setBusy(false);
        paintLog();
        scrollDown();
        input.focus({ preventScroll: true });
      }
    }
  }

  function retry(index) {
    const m = log[index];
    const q = m?.error?.question;
    if (!q) return;
    log.splice(index, 1); // retire le message d'erreur ; la question reste dans le fil
    ask(q, { retryOf: index });
  }

  paintStatus();
  paintLog();
  if (log.length) scrollDown();
}
