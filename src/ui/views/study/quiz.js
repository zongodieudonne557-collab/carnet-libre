// Quiz : à choix multiples, corrigé avec la phrase du cours. Construit à partir des cartes (sans IA) ou écrit par une IA.
import { deleteItem, listItems, saveItem, saveItems } from '../../../db.js';
import { generateQuiz } from '../../../ai/generate.js';
import { freshCards, mistakesToCards, quizFromCards, quizHistory } from '../../../study/build.js';
import { formatDate, shuffle } from '../../../util.js';
import { announce, confirmDialog, h, icon, mount, plural, toast } from '../../dom.js';
import { href } from '../../router.js';
import { aiLine, field, genPanel, isRunning, jobStatus, launchJob, noSources, onJobChange, rich, selectOf, sourceChip, verifyChip } from './common.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const verdict = (pct) => (pct >= 90 ? 'Excellent !' : pct >= 70 ? 'Très bien.' : pct >= 50 ? 'Pas mal, continue.' : 'À retravailler : relis les corrections ci-dessous.');

export default async function quizView({ root, onCleanup, shell }) {
  const nbId = shell.id;
  const data = await shell.getData();
  let quizzes = await listItems('quizzes', nbId);
  let cards = await listItems('cards', nbId);
  const JOB = `quiz:${nbId}`;

  let play = null; // { quiz, order, pos, answers: Map(questionIndex → {picked, right}), practice, picked }
  let createEl = null;

  const body = h('div.quiz-body');
  mount(root, h('div.quiz-view', h('div.view-head', h('h2', { 'data-focus': '', tabindex: '-1' }, 'Quiz')), body));

  async function reload() {
    [quizzes, cards] = await Promise.all([listItems('quizzes', nbId), listItems('cards', nbId)]);
    if (!play) paint();
  }
  onJobChange(JOB, onCleanup, (job) => {
    if (job?.status === 'done') reload();
  });

  // ---------------------------------------------------------------- accueil : liste et création
  function history(q) {
    const hs = quizHistory(q);
    return hs.tries ? h('span.chip.chip-ok', `Meilleur score : ${hs.best} %`) : h('span.chip', 'Pas encore tenté');
  }

  function quizCard(q) {
    const hs = quizHistory(q);
    return h(
      'li.quiz-card',
      h(
        'div.quiz-card-text',
        h('h3', q.title),
        h('div.card-row-meta', h('span.chip', plural(q.questions.length, 'question')), q.origin === 'cards' ? h('span.chip', 'Sans IA') : h('span.chip', 'Par l’IA'), history(q), hs.tries ? h('span.small.muted', plural(hs.tries, 'essai')) : null)
      ),
      h(
        'div.quiz-card-actions',
        h('button.btn.btn-primary', { type: 'button', onclick: () => start(q) }, icon('play', { size: 18 }), 'Commencer'),
        h('button.btn.btn-quiet.btn-icon', { type: 'button', 'aria-label': `Supprimer le quiz : ${q.title}`, title: 'Supprimer', onclick: () => remove(q) }, icon('trash', { size: 18 }))
      )
    );
  }

  async function remove(q) {
    if (!(await confirmDialog({ title: 'Supprimer ce quiz ?', message: `« ${q.title} » et son historique de scores seront effacés de cet appareil.`, confirmLabel: 'Supprimer', danger: true }))) return;
    await deleteItem('quizzes', q.id);
    await reload();
    toast('Quiz supprimé.', { timeout: 2500 });
  }

  function home() {
    return h(
      'div.quiz-home',
      quizzes.length
        ? [h('ul.quiz-list', quizzes.map(quizCard))]
        : h('div.empty', icon('list-checks', { size: 40 }), h('h3', 'Aucun quiz pour l’instant'), h('p', 'Un quiz te pose des questions à choix multiples et te corrige avec la phrase de ton cours. Crée le premier ci-dessous.')),
      data.chunks.length ? createPanels() : noSources(nbId, data)
    );
  }

  function createPanels() {
    createEl ??= h('div.create', fromCardsPanel(), aiPanel());
    return createEl;
  }

  function fromCardsPanel() {
    const count = selectOf('qc-n', [[5, '5 questions'], [10, '10 questions'], [15, '15 questions']], 10);
    const go = h('button.btn.btn-primary', { type: 'button' }, icon('list-checks', { size: 18 }), 'Créer le quiz');
    const note = h('p.hint');
    const paint = () => {
      const enough = cards.length >= 4;
      go.disabled = !enough;
      mount(note, enough ? `Tu as ${plural(cards.length, 'carte')} : le quiz utilisera le verso de tes cartes comme bonne réponse.` : ['Il faut au moins 4 cartes pour fabriquer un quiz. ', h('a', { href: href(`/n/${nbId}/cartes`) }, 'Crée des cartes d’abord'), '.']);
    };
    paintLater.push(paint);
    paint();
    go.addEventListener('click', async () => {
      const quiz = quizFromCards(cards, { count: Number(count.value) });
      if (!quiz) {
        toast('Pas assez de cartes différentes pour fabriquer un quiz. Ajoute-en quelques-unes.', { kind: 'error' });
        return;
      }
      const saved = await saveItem('quizzes', nbId, { ...quiz, title: `Quiz de tes cartes · ${formatDate(Date.now())}` });
      quizzes = [...quizzes, saved];
      start(saved);
    });
    return genPanel({
      id: 'quiz-cards',
      ic: 'layers',
      title: 'Sans IA : à partir de mes cartes',
      lead: 'Carnet Libre pose le recto de tes cartes et propose, comme mauvaises réponses, le verso d’autres cartes. Tout se passe sur ton appareil.',
      children: [field('qc-n', 'Combien de questions ?', count)],
      actions: [go],
      extra: [note],
    });
  }
  const paintLater = [];

  function aiPanel() {
    const count = selectOf('qa-n', [[5, '5 questions'], [8, '8 questions'], [12, '12 questions']], 8);
    const focus = h('input', { id: 'qa-focus', type: 'text', maxlength: 120, placeholder: 'Un chapitre ou une notion (facultatif)', autocomplete: 'off', spellcheck: false });
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
        kind: 'quiz',
        label: 'Création du quiz',
        purpose: 'créer un quiz',
        run: async ({ signal, setNote, setChars, config }) => {
          const res = await generateQuiz({ notebook: data.notebook, chunks: data.chunks, sources: data.sources, index: data.index, count: n, focus: topic, signal, config, onProgress: setChars, onStatus: setNote });
          await saveItem('quizzes', nbId, { ...res.quiz, origin: 'ai' });
          const check = res.quiz.questions.filter((q) => q.verified === false).length;
          const cut = res.truncated ? ' La réponse de l’IA a été coupée : demande moins de questions à la fois.' : '';
          return { message: `Quiz prêt : ${plural(res.quiz.questions.length, 'question')}${check ? `, dont ${check} à vérifier` : ''}.${cut}`, href: `/n/${nbId}/quiz` };
        },
      });
      if (job) paintGo();
    });
    onJobChange(JOB, onCleanup, paintGo);
    paintGo();
    return genPanel({
      id: 'quiz-ai',
      ic: 'sparkles',
      title: 'Avec une IA',
      lead: 'L’IA écrit des questions à partir de tes sources actives, avec trois mauvaises réponses plausibles et une explication. Chaque question garde la phrase de ton cours qui la justifie.',
      children: [field('qa-n', 'Combien de questions ?', count), field('qa-focus', 'Sur quoi ?', focus)],
      actions: [go],
      extra: [jobStatus(JOB, onCleanup), aiLine(onCleanup)],
    });
  }

  // ---------------------------------------------------------------- passer un quiz
  function start(quiz, { only = null } = {}) {
    const idx = only ?? quiz.questions.map((_, i) => i);
    play = { quiz, order: shuffle(idx), pos: 0, answers: new Map(), practice: !!only, picked: null, saved: false, added: false };
    paint();
    root.querySelector('[data-focus]')?.scrollIntoView({ block: 'start' });
  }

  function leave() {
    play = null;
    paint();
  }

  function choose(i) {
    if (!play || play.picked !== null) return;
    const q = play.quiz.questions[play.order[play.pos]];
    const right = i === q.answer;
    play.picked = i;
    play.answers.set(play.order[play.pos], { picked: i, right });
    announce(right ? 'Bonne réponse !' : `Mauvaise réponse. La bonne réponse était : ${q.choices[q.answer]}`);
    paint();
    root.querySelector('.quiz-next')?.focus({ preventScroll: true });
  }

  async function next() {
    if (!play || play.picked === null) return;
    if (play.pos + 1 < play.order.length) {
      play.pos++;
      play.picked = null;
      paint();
      root.querySelector('.quiz-q')?.scrollIntoView({ block: 'nearest' });
      return;
    }
    play.pos = play.order.length; // écran de résultat
    await saveAttempt();
    paint();
    root.querySelector('[data-focus]')?.focus({ preventScroll: true });
  }

  async function saveAttempt() {
    if (play.saved || play.practice) return;
    play.saved = true;
    const wrong = play.order.filter((qi) => !play.answers.get(qi)?.right);
    const attempt = { at: Date.now(), score: play.order.length - wrong.length, total: play.order.length, wrong };
    const quiz = { ...play.quiz, attempts: [...(play.quiz.attempts || []), attempt].slice(-20) };
    play.quiz = quiz;
    quizzes = quizzes.map((x) => (x.id === quiz.id ? quiz : x));
    try {
      await saveItem('quizzes', nbId, quiz);
    } catch (e) {
      console.error(e);
      toast('Impossible d’enregistrer ton score sur l’appareil.', { kind: 'error' });
    }
  }

  function choiceButton(q, i) {
    const answered = play.picked !== null;
    const state = !answered ? '' : i === q.answer ? 'is-right' : i === play.picked ? 'is-wrong' : 'is-idle';
    return h(
      'li',
      h(
        `button.choice${state ? `.${state}` : ''}`,
        { type: 'button', 'aria-disabled': answered ? 'true' : null, onclick: () => choose(i) },
        h('span.choice-letter', { 'aria-hidden': 'true' }, LETTERS[i] || String(i + 1)),
        h('span.choice-text', rich(q.choices[i], { headingOffset: 3 })),
        answered && i === q.answer ? h('span.choice-flag', icon('circle-check', { size: 18 }), 'Bonne réponse') : null,
        answered && i === play.picked && i !== q.answer ? h('span.choice-flag', icon('circle-x', { size: 18 }), 'Ta réponse') : null
      )
    );
  }

  function questionView() {
    const qi = play.order[play.pos];
    const q = play.quiz.questions[qi];
    const answered = play.picked !== null;
    const right = answered && play.picked === q.answer;
    const last = play.pos + 1 === play.order.length;
    const pct = Math.round((100 * play.pos) / play.order.length);
    return h(
      'div.quiz-play',
      h(
        'div.rev-top',
        h('div.progress', { role: 'progressbar', 'aria-label': 'Avancement du quiz', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, h('span', { style: { '--p': pct } })),
        h('span.small', `Question ${play.pos + 1} sur ${play.order.length}`),
        h('button.btn.btn-quiet.btn-sm', { type: 'button', onclick: leave }, icon('x', { size: 16 }), 'Quitter')
      ),
      h(
        'section.quiz-q',
        { 'aria-label': `Question ${play.pos + 1}` },
        verifyChip(q) ? h('div.flash-meta', verifyChip(q)) : null,
        h('div.quiz-question', rich(q.question, { headingOffset: 3 })),
        h('ul.choices', q.choices.map((_, i) => choiceButton(q, i)))
      ),
      answered
        ? h(
            'div.quiz-feedback',
            { role: 'status', class: right ? 'is-right' : 'is-wrong' },
            h('p.quiz-verdict', right ? icon('circle-check', { size: 22 }) : icon('circle-x', { size: 22 }), right ? 'Bonne réponse !' : 'Pas tout à fait.'),
            q.explanation ? rich(q.explanation, { headingOffset: 3 }) : null,
            !right ? h('p', 'La bonne réponse : ', h('strong', q.choices[q.answer])) : null,
            sourceChip(q)
          )
        : null,
      answered ? h('button.btn.btn-primary.btn-lg.quiz-next', { type: 'button', onclick: next }, last ? 'Voir mon résultat' : 'Question suivante', icon('chevron-right', { size: 20 })) : null
    );
  }

  function resultView() {
    const total = play.order.length;
    const wrongIdx = play.order.filter((qi) => !play.answers.get(qi)?.right);
    const score = total - wrongIdx.length;
    const pct = Math.round((100 * score) / total);
    const q = play.quiz;
    return h(
      'div.rev-done.quiz-result',
      icon(pct >= 70 ? 'circle-check' : 'info', { size: 44 }),
      h('h3', { 'data-focus': '', tabindex: '-1' }, `${score} sur ${total}`),
      h('p.quiz-pct', `${pct} %`),
      h('p', verdict(pct)),
      !play.practice ? h('p.small.muted', quizHistory(q).tries > 1 ? `Meilleur score : ${quizHistory(q).best} % · ${plural(quizHistory(q).tries, 'essai')}` : 'Score enregistré sur cet appareil.') : h('p.small.muted', 'Entraînement : ce score n’est pas enregistré.'),
      h(
        'div.btn-row',
        wrongIdx.length ? h('button.btn.btn-primary', { type: 'button', onclick: () => start(q, { only: wrongIdx }) }, icon('refresh-cw', { size: 18 }), `Refaire mes ${plural(wrongIdx.length, 'erreur')}`) : null,
        h('button.btn', { type: 'button', onclick: () => start(q) }, icon('rotate-ccw', { size: 18 }), 'Recommencer'),
        h('button.btn.btn-quiet', { type: 'button', onclick: leave }, 'Retour aux quiz')
      ),
      wrongIdx.length ? mistakes(q, wrongIdx) : null
    );
  }

  function mistakes(q, wrongIdx) {
    const add = h('button.btn.btn-sm', { type: 'button', disabled: play.added }, icon('layers', { size: 16 }), play.added ? 'Cartes ajoutées' : 'Ajouter mes erreurs aux cartes');
    add.addEventListener('click', async () => {
      add.disabled = true;
      const fresh = freshCards(mistakesToCards(q, wrongIdx), cards);
      if (fresh.length) await saveItems('cards', nbId, fresh);
      play.added = true;
      cards = await listItems('cards', nbId);
      shell.refresh();
      mount(add, icon('layers', { size: 16 }), 'Cartes ajoutées');
      toast(fresh.length ? `${plural(fresh.length, 'carte ajoutée', 'cartes ajoutées')} : tu les reverras au bon moment.` : 'Ces erreurs sont déjà dans tes cartes.', { kind: 'ok', action: fresh.length ? { label: 'Voir', onClick: () => (location.hash = `#/n/${nbId}/cartes`) } : undefined });
    });
    return h(
      'section.quiz-mistakes',
      { 'aria-labelledby': 'mistakes-h' },
      h('h3', { id: 'mistakes-h' }, 'À revoir'),
      h(
        'ul.mistakes',
        wrongIdx.map((qi) => {
          const x = q.questions[qi];
          const mine = play.answers.get(qi);
          return h(
            'li',
            h('div.quiz-question', rich(x.question, { headingOffset: 4 })),
            h('p.mistake-mine', icon('circle-x', { size: 18 }), h('span', 'Ta réponse : ', h('strong', x.choices[mine.picked]))),
            h('p.mistake-good', icon('circle-check', { size: 18 }), h('span', 'La bonne réponse : ', h('strong', x.choices[x.answer]))),
            x.explanation ? h('div.mistake-why', rich(x.explanation, { headingOffset: 4 })) : null,
            h('div.card-row-meta', verifyChip(x), sourceChip(x))
          );
        })
      ),
      h('div.btn-row', add)
    );
  }

  function paint() {
    if (!play) {
      for (const f of paintLater) f();
      return mount(body, home());
    }
    mount(body, play.pos >= play.order.length ? resultView() : questionView());
  }

  // clavier : 1 à 4 pour répondre, Entrée pour la suite
  function onKey(e) {
    if (!play || play.pos >= play.order.length || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (document.querySelector('dialog[open]') || e.target?.closest?.('input, textarea, select')) return;
    const q = play.quiz.questions[play.order[play.pos]];
    const k = ['1', '2', '3', '4', '5', '6'].indexOf(e.key);
    if (play.picked === null && k >= 0 && k < q.choices.length) {
      e.preventDefault();
      choose(k);
    } else if (play.picked !== null && e.key === 'Enter' && !e.target?.closest?.('button, a')) {
      e.preventDefault();
      next();
    }
  }
  document.addEventListener('keydown', onKey);
  onCleanup(() => document.removeEventListener('keydown', onKey));

  paint();
}
