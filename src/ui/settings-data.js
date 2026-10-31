// Réglages : stockage, sauvegarde, restauration, effacement.
import { download, formatBytes } from '../util.js';
import { createBackup, eraseEverything, readBackup, restoreBackup, summarizeBackup } from './backup.js';
import { confirmDialog, h, icon, mount, openDialog, plural, toast } from './dom.js';
import { navigate } from './router.js';
import { invalidate } from './store.js';

async function downloadBackup(btn) {
  btn.disabled = true;
  try {
    const { text, name, summary } = await createBackup();
    if (!summary.notebooks) {
      toast('Il n’y a encore aucun carnet à sauvegarder.');
      return;
    }
    download(name, text, 'application/json');
    toast(`Sauvegarde téléchargée (${formatBytes(new Blob([text]).size)}) : ${plural(summary.notebooks, 'carnet')}, ${plural(summary.cards, 'carte')}.`, { kind: 'ok' });
  } catch (e) {
    toast(e?.message || 'La sauvegarde a échoué.', { kind: 'error' });
  } finally {
    btn.disabled = false;
  }
}

async function restoreFrom(file) {
  let data;
  try {
    data = await readBackup(file);
  } catch (e) {
    toast(e.message, { kind: 'error' });
    return;
  }
  const s = summarizeBackup(data);
  const ok = await confirmDialog({
    title: 'Restaurer cette sauvegarde ?',
    message: h(
      'div',
      h('p', `Elle contient ${plural(s.notebooks, 'carnet')}, ${plural(s.sources, 'source')} et ${plural(s.cards, 'carte')}.`),
      h('p', 'Les carnets déjà présents sur cet appareil qui sont aussi dans la sauvegarde seront remplacés par la version de la sauvegarde. Les autres ne sont pas touchés.')
    ),
    confirmLabel: 'Restaurer',
  });
  if (!ok) return;
  try {
    await restoreBackup(data);
    for (const nb of data.notebooks || []) invalidate(nb.id);
    toast(`Sauvegarde restaurée : ${plural(s.notebooks, 'carnet')}.`, { kind: 'ok' });
    navigate('/');
  } catch (e) {
    toast(e?.message || 'La restauration a échoué.', { kind: 'error' });
  }
}

async function eraseFlow() {
  let input;
  const confirmed = await openDialog({
    title: 'Tout effacer ?',
    size: 'narrow',
    body: (api) =>
      h(
        'div',
        h('p', 'Cela supprime de cet appareil tous tes carnets, cartes, réglages et clés d’API. On ne peut pas revenir en arrière.'),
        h('p', 'Pour garder tes cours, télécharge d’abord une sauvegarde.'),
        h('p', h('button.btn.btn-sm', { type: 'button', onclick: (e) => downloadBackup(e.currentTarget) }, icon('download', { size: 16 }), 'Télécharger une sauvegarde')),
        h(
          'div.field',
          h('label', { for: 'erase-confirm' }, 'Pour confirmer, écris EFFACER'),
          (input = h('input', {
            id: 'erase-confirm',
            type: 'text',
            autocomplete: 'off',
            autocapitalize: 'characters',
            spellcheck: false,
            oninput: () => {
              api.button(1).disabled = input.value.trim().toUpperCase() !== 'EFFACER';
            },
          }))
        )
      ),
    actions: [
      { label: 'Annuler', value: false, kind: 'quiet' },
      { label: 'Tout effacer', value: true, kind: 'danger', disabled: true },
    ],
  });
  if (confirmed !== true) return;
  try {
    await eraseEverything();
  } catch (e) {
    toast(e?.message || 'L’effacement a échoué.', { kind: 'error' });
    return;
  }
  location.hash = '#/';
  location.reload();
}

export function dataSection() {
  const storage = h('div.storage', h('p.muted', 'Calcul de l’espace utilisé…'));

  async function paintStorage() {
    const nav = globalThis.navigator;
    const est = await nav?.storage?.estimate?.().catch(() => null);
    const persisted = await nav?.storage?.persisted?.().catch(() => false);
    const canPersist = typeof nav?.storage?.persist === 'function';
    mount(
      storage,
      est?.quota
        ? h(
            'div',
            h('p', `${formatBytes(est.usage || 0)} utilisés sur environ ${formatBytes(est.quota)} disponibles pour Carnet Libre sur cet appareil.`),
            h('div.progress', { role: 'presentation' }, h('span', { style: { '--p': Math.max(1, Math.min(100, Math.round(((est.usage || 0) / est.quota) * 100))) } }))
          )
        : h('p.muted', 'Ton navigateur ne dit pas combien de place reste.'),
      persisted
        ? h('p', h('span.chip.chip-ok', icon('shield-check', { size: 14 }), 'Données protégées'), ' Le navigateur ne les effacera pas pour faire de la place.')
        : canPersist
          ? h(
              'div.callout',
              icon('info'),
              h(
                'div',
                h('p', 'Si l’appareil manque de place, le navigateur peut effacer les données d’un site sans prévenir. Demande-lui de protéger les tiens.'),
                h(
                  'p',
                  h(
                    'button.btn.btn-sm',
                    {
                      type: 'button',
                      onclick: async () => {
                        const ok = await nav.storage.persist().catch(() => false);
                        toast(ok ? 'Tes données sont protégées.' : 'Le navigateur n’a pas accepté pour l’instant : il décide lui-même, selon l’usage. Fais une sauvegarde de temps en temps.', { kind: ok ? 'ok' : 'info', timeout: 8000 });
                        paintStorage();
                      },
                    },
                    icon('shield-check', { size: 16 }),
                    'Protéger mes données'
                  )
                )
              )
            )
          : null
    );
  }
  paintStorage();

  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    hidden: true,
    'aria-label': 'Choisir une sauvegarde à restaurer',
    onchange: async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) await restoreFrom(file);
    },
  });

  const row = (ic, title, text, button, extraClass = '') =>
    h('li.act' + extraClass, icon(ic, { size: 24 }), h('div.act-text', h('p.act-title', title), h('p.hint', text)), button);

  return h(
    'div.data',
    storage,
    h(
      'ul.acts',
      row(
        'download',
        'Télécharger une sauvegarde',
        'Un seul fichier avec tes carnets, sources, cartes, quiz et fiches. Il ne contient ni tes clés d’API ni tes réglages. À ranger sur une clé USB ou dans ton courrier.',
        h('button.btn', { type: 'button', onclick: (e) => downloadBackup(e.currentTarget) }, 'Télécharger')
      ),
      row('upload', 'Restaurer une sauvegarde', 'Pour retrouver tes carnets sur un autre appareil, ou après un effacement.', h('button.btn', { type: 'button', onclick: () => fileInput.click() }, 'Choisir un fichier')),
      row('trash', 'Tout effacer', 'Supprime de cet appareil tes carnets, réglages et clés. Utile sur un ordinateur partagé avant de partir.', h('button.btn.btn-danger', { type: 'button', onclick: eraseFlow }, 'Tout effacer…'), '.act-danger')
    ),
    h('p.hint', h('strong', 'Sur un ordinateur partagé '), '(cybercafé, salle informatique) : tes carnets restent dans ce navigateur après ton départ, et la personne suivante pourrait les ouvrir. Télécharge une sauvegarde, puis « Tout effacer » avant de partir.'),
    fileInput
  );
}
