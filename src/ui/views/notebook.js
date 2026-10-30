// Coque d'un carnet : titre, navigation (Sources · Discuter · Réviser…) et zone de contenu.
// Elle reste en place quand on change d'onglet ; seule la zone de contenu est remplacée.
import { db } from '../../db.js';
import { LEVELS } from '../../ai/prompts.js';
import { countDue } from '../../study/srs.js';
import { h, icon, mount, plural } from '../dom.js';
import { href, navigate } from '../router.js';
import { cancelJob, loadData, onDataChange, runningJobs, subscribeJobs } from '../store.js';
import { editNotebook } from '../notebook-form.js';

export const STUDY_TABS = ['cartes', 'quiz', 'fiches', 'causerie', 'diapos'];

const TABS = [
  { id: 'sources', label: 'Sources', icon: 'files', level: 1 },
  { id: 'discuter', label: 'Discuter', icon: 'message-circle', level: 1 },
  { id: 'reviser', label: 'Réviser', icon: 'graduation-cap', level: 1 },
  { id: 'cartes', label: 'Cartes', icon: 'layers', level: 2 },
  { id: 'quiz', label: 'Quiz', icon: 'list-checks', level: 2 },
  { id: 'fiches', label: 'Fiches', icon: 'file-pen', level: 2 },
  { id: 'causerie', label: 'Causerie', icon: 'headphones', level: 2 },
  { id: 'diapos', label: 'Diapos', icon: 'presentation', level: 2 },
];

/** @returns {Promise<{id: string, el: HTMLElement, content: HTMLElement, setActive: (tab: string) => void, refresh: () => Promise<void>, destroy: () => void}|null>} */
export async function createShell(id) {
  let data = await loadData(id);
  if (!data) return null;

  const title = h('h1.nb-title');
  const levelChip = h('span.chip.chip-info');
  const jobBox = h('div.nb-job', { role: 'status', hidden: true });
  const content = h('div.nb-content', { id: 'nb-content' });
  const badges = {};

  const links = TABS.map((t) => {
    const badge = h('span.nb-badge', { hidden: true });
    badges[t.id] = badge;
    return h(
      'a.nb-link',
      { href: href(`/n/${id}/${t.id}`), dataset: { tab: t.id, level: t.level } },
      icon(t.icon, { size: 22 }),
      h('span.nb-link-label', t.label),
      badge
    );
  });

  const head = h(
    'header.nb-head',
    h('a.nb-back', { href: href('/') }, icon('arrow-left', { size: 18 }), 'Mes carnets'),
    h(
      'div.nb-heading',
      title,
      levelChip,
      h(
        'button.btn.btn-quiet.btn-sm.btn-icon',
        {
          type: 'button',
          'aria-label': 'Modifier ce carnet',
          title: 'Modifier ce carnet',
          onclick: async () => {
            const r = await editNotebook(data.notebook);
            if (r?.kind === 'deleted') navigate('/');
          },
        },
        icon('pencil', { size: 18 })
      )
    ),
    jobBox
  );
  const nav = h('nav.nb-nav', { 'aria-label': 'Dans ce carnet' }, links);
  const el = h('div.nb', head, nav, content);

  function paintHead() {
    const nb = data.notebook;
    title.textContent = nb.title;
    levelChip.textContent = LEVELS[nb.level]?.label || '';
    el.dataset.color = nb.color ?? 0;
  }

  async function paintBadges() {
    const enabled = data.sources.filter((s) => s.enabled).length;
    const src = badges.sources;
    src.hidden = !data.sources.length;
    src.textContent = enabled === data.sources.length ? String(enabled) : `${enabled}/${data.sources.length}`;
    src.title = enabled === data.sources.length ? plural(enabled, 'source') : `${enabled} source(s) active(s) sur ${data.sources.length}`;
    const cards = await db.where('cards', 'notebookId', id);
    const c = countDue(cards);
    const due = c.due + c.fresh;
    for (const k of ['cartes', 'reviser']) {
      badges[k].hidden = due === 0;
      badges[k].textContent = String(due);
      badges[k].title = `${plural(due, 'carte')} à revoir`;
    }
  }

  function paintJobs() {
    const jobs = runningJobs(id);
    jobBox.hidden = !jobs.length;
    if (!jobs.length) return mount(jobBox);
    const j = jobs[0];
    mount(
      jobBox,
      h('span.spinner', { 'aria-hidden': 'true' }),
      h('span', `${j.label}…${j.note ? ` ${j.note}` : ''}${jobs.length > 1 ? ` (+${jobs.length - 1})` : ''}`),
      h('button.link-btn', { type: 'button', onclick: () => cancelJob(j.key) }, 'Annuler')
    );
  }

  async function refresh() {
    data = await loadData(id);
    if (!data) return navigate('/');
    paintHead();
    await paintBadges();
  }

  const offData = onDataChange((changed) => {
    if (changed === id) refresh();
  });
  const offJobs = subscribeJobs(() => {
    paintJobs();
    paintBadges();
  });

  paintHead();
  paintJobs();
  paintBadges();

  return {
    id,
    el,
    content,
    getData: () => loadData(id),
    refresh,
    setActive(tab) {
      for (const a of links) {
        const on = a.dataset.tab === tab;
        if (on) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
        a.classList.toggle('is-parent', a.dataset.tab === 'reviser' && STUDY_TABS.includes(tab));
      }
      el.dataset.tab = tab;
      paintBadges();
    },
    destroy() {
      offData();
      offJobs();
    },
  };
}
