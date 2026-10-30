// Boîte de dialogue « nouveau carnet » / « modifier ce carnet ».
import { createNotebook, deleteNotebook, updateNotebook } from '../db.js';
import { LEVELS } from '../ai/prompts.js';
import { confirmDialog, h, openDialog, toast } from './dom.js';
import { invalidate } from './store.js';

export const COVER_NAMES = ['Bleu', 'Rouge', 'Vert', 'Orange', 'Violet', 'Turquoise'];

/**
 * @param {object} [nb]  carnet à modifier ; absent = création
 * @returns {Promise<{kind: 'created'|'updated'|'deleted', notebook?: object}|null>}
 */
export async function editNotebook(nb) {
  const editing = !!nb;
  let color = editing ? nb.color : Math.floor(Math.random() * COVER_NAMES.length);
  const title = h('input', { type: 'text', id: 'nb-title', maxlength: 80, value: editing ? nb.title : '', placeholder: 'Ex. : SVT — Terminale D', autocomplete: 'off', 'data-autofocus': '' });
  const level = h(
    'select',
    { id: 'nb-level', value: editing ? nb.level : 'lycee' },
    Object.entries(LEVELS).map(([id, l]) => h('option', { value: id }, l.label))
  );
  const swatches = COVER_NAMES.map((name, i) =>
    h(
      'label.swatch',
      { style: { '--c': `var(--cover-${i})` }, title: name },
      h('input', { type: 'radio', name: 'cover-color', value: i, checked: i === color, onchange: () => (color = i) }),
      h('span.visually-hidden', name)
    )
  );

  const result = await openDialog({
    title: editing ? 'Modifier ce carnet' : 'Nouveau carnet',
    size: 'narrow',
    body: (api) =>
      h(
        'form',
        {
          onsubmit: (e) => {
            e.preventDefault();
            api.button(editing ? 2 : 1)?.click();
          },
        },
        h('div.field', h('label', { for: 'nb-title' }, 'Nom du carnet'), title, h('span.hint', 'Une matière, un chapitre, un examen…')),
        h('div.field', h('label', { for: 'nb-level' }, 'Ton niveau'), level, h('span.hint', 'L’IA adapte ses explications à ton niveau.')),
        h('fieldset.field.colors', h('legend.label', 'Couleur de la couverture'), h('div.swatches', swatches))
      ),
    actions: [
      editing ? { label: 'Supprimer…', value: 'delete', kind: 'danger' } : null,
      { label: 'Annuler', value: null, kind: 'quiet' },
      { label: editing ? 'Enregistrer' : 'Créer le carnet', value: 'save', kind: 'primary' },
    ].filter(Boolean),
  });

  if (result === 'delete') {
    const ok = await confirmDialog({
      title: `Supprimer « ${nb.title} » ?`,
      message: 'Les sources, cartes, quiz et notes de ce carnet seront effacés de cet appareil. C’est définitif : pense à exporter une sauvegarde dans les Réglages si tu veux pouvoir les retrouver.',
      confirmLabel: 'Supprimer le carnet',
      danger: true,
    });
    if (!ok) return null;
    await deleteNotebook(nb.id);
    invalidate(nb.id);
    toast('Carnet supprimé.', { kind: 'ok' });
    return { kind: 'deleted' };
  }
  if (result !== 'save') return null;

  const name = title.value.trim() || (editing ? nb.title : 'Nouveau carnet');
  if (editing) {
    const notebook = await updateNotebook(nb.id, { title: name, level: level.value, color });
    invalidate(nb.id);
    return { kind: 'updated', notebook };
  }
  const created = await createNotebook({ title: name, level: level.value });
  const notebook = await updateNotebook(created.id, { color });
  return { kind: 'created', notebook };
}

