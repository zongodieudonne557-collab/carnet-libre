// Accueil : l'étagère de cahiers.
import { db, listNotebooks, notebookStats } from '../../db.js';
import { LEVELS } from '../../ai/prompts.js';
import { countDue } from '../../study/srs.js';
import { h, icon, mount, plural, toast } from '../dom.js';
import { href, navigate } from '../router.js';
import { editNotebook } from '../notebook-form.js';
import { createSampleNotebook } from '../sample-notebook.js';

function cover({ nb, stats, due }, refresh) {
  const level = LEVELS[nb.level]?.label || '';
  const meta = [level, plural(stats.sources, 'source')].filter(Boolean).join(' · ');
  return h(
    'li.shelf-item',
    h(
      'a.cover',
      { href: href(`/n/${nb.id}`), dataset: { color: nb.color ?? 0 }, 'aria-label': `${nb.title}. ${meta}${due ? `. ${plural(due, 'carte')} à revoir` : ''}` },
      h('span.cover-spine', { 'aria-hidden': 'true' }),
      h('span.cover-label', h('span.cover-title', nb.title), h('span.cover-meta', meta)),
      due ? h('span.cover-due', { 'aria-hidden': 'true' }, icon('layers', { size: 14 }), `${due} à revoir`) : null
    ),
    h(
      'button.cover-edit',
      {
        type: 'button',
        'aria-label': `Modifier le carnet « ${nb.title} »`,
        title: 'Modifier',
        onclick: async () => {
          if (await editNotebook(nb)) refresh();
        },
      },
      icon('pencil', { size: 18 })
    )
  );
}

export default async function home({ root, setTitle }) {
  setTitle('Mes carnets');

  async function newNotebook() {
    const r = await editNotebook();
    if (r?.kind === 'created') navigate(`/n/${r.notebook.id}/sources`);
  }

  async function trySample(btn) {
    btn.disabled = true;
    try {
      const nb = await createSampleNotebook();
      toast('Cours d’exemple ajouté : pose-lui une question, ou révise ses cartes.', { kind: 'ok' });
      navigate(`/n/${nb.id}/discuter`);
    } catch (e) {
      btn.disabled = false;
      toast(e.message || 'Impossible de créer le cours d’exemple.', { kind: 'error' });
    }
  }

  async function render() {
    const notebooks = await listNotebooks();
    const infos = await Promise.all(
      notebooks.map(async (nb) => {
        const [stats, cards] = await Promise.all([notebookStats(nb.id), db.where('cards', 'notebookId', nb.id)]);
        const c = countDue(cards);
        return { nb, stats, due: c.due + c.fresh };
      })
    );

    if (!infos.length) {
      mount(
        root,
        h(
          'div.home.welcome',
          h(
            'section.hero.seyes',
            h('img.hero-logo', { src: 'icons/logo.svg', alt: '', width: 72, height: 72 }),
            h('h1', { 'data-focus': '' }, 'Bienvenue sur Carnet Libre'),
            h('p.lead', 'Ton espace de révision gratuit : dépose tes cours, pose-leur des questions, puis révise avec des cartes, des quiz et même un podcast.'),
            h(
              'div.btn-row',
              h('button.btn.btn-primary', { type: 'button', onclick: newNotebook }, icon('plus'), 'Créer mon premier carnet'),
              h('button.btn', { type: 'button', onclick: (e) => trySample(e.currentTarget) }, icon('sparkles'), 'Essayer avec un cours d’exemple')
            )
          ),
          h(
            'ul.promises',
            h('li', icon('lock', { size: 26 }), h('div', h('h2', 'Tout reste chez toi'), h('p', 'Pas de compte, pas de publicité, pas de suivi. Tes cours sont gardés sur cet appareil et ne partent nulle part sans ton accord.'))),
            h('li', icon('wifi-off', { size: 26 }), h('div', h('h2', 'Utile même sans IA'), h('p', 'Recherche dans tes cours, cartes créées automatiquement, lecture à voix haute. Ça marche aussi sans connexion, une fois l’appli chargée.'))),
            h('li', icon('sparkles', { size: 26 }), h('div', h('h2', 'Une IA gratuite, si tu veux'), h('p', 'Groq, Gemini, OpenRouter, Mistral ou Ollama : tu choisis, avec ta propre clé. Quiz, fiches, podcast et diapos narrées deviennent alors possibles.')))
          ),
          h('p.small.center', h('a', { href: href('/confidentialite') }, 'Lire comment ça protège tes données'))
        )
      );
      return;
    }

    mount(
      root,
      h(
        'div.home',
        h(
          'section.hero.seyes.hero-compact',
          h('h1', { 'data-focus': '' }, 'Mes carnets'),
          h('p.lead', 'Choisis un cahier pour continuer, ou range-en un nouveau sur l’étagère.')
        ),
        h(
          'ul.shelf',
          infos.map((i) => cover(i, render)),
          h(
            'li.shelf-item',
            h('button.cover.cover-new', { type: 'button', onclick: newNotebook }, icon('plus', { size: 36 }), h('span', 'Nouveau carnet'))
          )
        ),
        h(
          'p.small.center.muted',
          'Tes carnets sont enregistrés sur cet appareil seulement. ',
          h('button.link-btn', { type: 'button', onclick: (e) => trySample(e.currentTarget) }, 'Ajouter le cours d’exemple'),
          ' · ',
          h('a', { href: href('/reglages') }, 'Sauvegarde et réglages')
        )
      )
    );
  }

  await render();
}
