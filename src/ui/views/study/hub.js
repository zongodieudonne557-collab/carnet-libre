// Page « Réviser » : les cinq façons d'étudier un carnet, avec ce qu'il y a déjà dedans.
import { listItems } from '../../../db.js';
import { cardCounts } from '../../../study/build.js';
import { h, icon, mount, plural } from '../../dom.js';
import { href } from '../../router.js';
import { runningJobs, subscribeJobs } from '../../store.js';
import { aiLine, noSources } from './common.js';

export default async function hubView({ root, onCleanup, shell }) {
  const nbId = shell.id;
  const data = await shell.getData();
  const body = h('div.hub-body');

  mount(
    root,
    h(
      'div.hub',
      h('h2', { 'data-focus': '', tabindex: '-1' }, 'Réviser'),
      h('p.lead', 'Choisis comment étudier. Tout fonctionne sans IA ; une IA, si tu en branches une, crée des contenus plus riches à partir de tes sources.'),
      body
    )
  );

  async function load() {
    const [cards, quizzes, notes, casts, decks] = await Promise.all(['cards', 'quizzes', 'notes', 'casts', 'decks'].map((s) => listItems(s, nbId)));
    return { cards, quizzes, notes, casts, decks };
  }

  function tile({ to, ic, title, status, text, cta, badge }) {
    return h(
      'a.tile',
      { href: href(`/n/${nbId}/${to}`) },
      h('span.tile-ic', icon(ic, { size: 30 })),
      h('h3', title, badge ? h('span.nb-badge.tile-badge', { 'aria-label': badge.label }, String(badge.n)) : null),
      h('p.tile-status', status),
      h('p.tile-text', text),
      h('span.tile-cta', cta, icon('chevron-right', { size: 18 }))
    );
  }

  function paint(all) {
    const c = cardCounts(all.cards);
    const todo = c.due + c.todayNew;
    const hero = !all.cards.length
      ? h(
          'div.hub-hero',
          h('p.hub-hero-title', 'Commence par des cartes mémoire'),
          h('p', 'En un clic, sans IA, l’appli repère les définitions de tes sources et en fait des cartes.'),
          h('a.btn.btn-primary', { href: href(`/n/${nbId}/cartes`) }, icon('layers'), 'Créer mes premières cartes')
        )
      : todo
        ? h(
            'div.hub-hero',
            h('p.hub-hero-title', `${plural(todo, 'carte')} à réviser aujourd’hui`),
            h('p', c.due ? `Dont ${plural(c.due, 'carte')} à revoir avant de les oublier.` : 'Des nouvelles cartes t’attendent.'),
            h('a.btn.btn-primary', { href: href(`/n/${nbId}/cartes`) }, icon('play'), 'Commencer la séance')
          )
        : h('div.hub-hero.hub-hero-done', icon('circle-check', { size: 28 }), h('p.hub-hero-title', 'Tes cartes sont à jour'), h('p', 'Rien à revoir pour le moment. Tu peux t’entraîner avec un quiz ou écouter ton cours.'));

    mount(
      body,
      !data.chunks.length ? noSources(nbId, data) : hero,
      h(
        'div.tiles',
        tile({
          to: 'cartes',
          ic: 'layers',
          title: 'Cartes mémoire',
          badge: todo ? { n: todo, label: `${plural(todo, 'carte')} à réviser` } : null,
          status: all.cards.length ? `${plural(all.cards.length, 'carte')} · ${plural(c.due, 'à revoir', 'à revoir')}` : 'Aucune carte',
          text: 'Retourne la carte, note-toi, et l’appli te la repose juste avant que tu l’oublies.',
          cta: all.cards.length ? 'Réviser' : 'Créer des cartes',
        }),
        tile({
          to: 'quiz',
          ic: 'list-checks',
          title: 'Quiz',
          status: all.quizzes.length ? plural(all.quizzes.length, 'quiz') : 'Aucun quiz',
          text: 'Teste-toi avec des questions à choix multiples ; chaque correction cite la phrase de ton cours.',
          cta: all.quizzes.length ? 'Passer un quiz' : 'Créer un quiz',
        }),
        tile({
          to: 'fiches',
          ic: 'file-pen',
          title: 'Fiches',
          status: all.notes.length ? plural(all.notes.length, 'fiche') : 'Aucune fiche',
          text: 'Résumés, fiches de révision, plans et questions fréquentes, avec les sources citées.',
          cta: all.notes.length ? 'Ouvrir mes fiches' : 'Créer une fiche',
        }),
        tile({
          to: 'causerie',
          ic: 'headphones',
          title: 'Causerie',
          status: all.casts.length ? plural(all.casts.length, 'causerie') : 'Aucune causerie',
          text: 'Écoute ton cours comme un podcast à deux voix, ou fais-le lire à voix haute.',
          cta: 'Écouter',
        }),
        tile({
          to: 'diapos',
          ic: 'presentation',
          title: 'Diapos',
          status: all.decks.length ? plural(all.decks.length, 'diaporama') : 'Aucun diaporama',
          text: 'Ton cours en diapositives sur fond de tableau noir, avec une voix qui explique.',
          cta: all.decks.length ? 'Voir mes diapos' : 'Créer des diapos',
        })
      ),
      h(
        'div.hub-ai',
        h('h3', icon('sparkles', { size: 22 }), 'Avec ou sans IA'),
        h('ul', h('li', h('strong', 'Sans IA : '), 'cartes automatiques et révision espacée, quiz construit avec tes cartes, fiche automatique, diaporama par titres, lecture à voix haute de tes sources.'), h('li', h('strong', 'Avec une IA : '), 'cartes, quiz, fiches, podcast et diapos rédigés pour toi, chacun relié aux phrases de ton cours.')),
        aiLine(onCleanup)
      )
    );
  }

  let running = runningJobs(nbId).length;
  async function refresh() {
    paint(await load());
  }
  onCleanup(
    subscribeJobs(() => {
      const n = runningJobs(nbId).length;
      if (n < running) refresh();
      running = n;
    })
  );

  paint(await load());
}
