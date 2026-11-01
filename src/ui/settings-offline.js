// Réglages : mode hors ligne (ce qui est déjà gardé sur l'appareil, et préparation à l'avance de l'OCR et des PDF).
import { lazySize, offlineStatus, offlineSupported, prepareOffline } from '../offline.js';
import { h, icon, mount, toast } from './dom.js';

export function offlineSection(onCleanup) {
  const root = h('div.offline');
  const list = h('ul.offline-list');
  const action = h('div.offline-action', { 'aria-live': 'polite' });
  let busy = null; // AbortController de la préparation en cours
  let size = '15 Mo';

  const row = (label, ok, yes, no) =>
    h('li', h('span', label), ok ? h('span.chip.chip-ok', icon('circle-check', { size: 14 }), yes) : h('span.chip.chip-warn', no));

  async function paint() {
    const st = await offlineStatus();
    if (!st.supported) {
      mount(list, h('li', h('div.callout.callout-warn', icon('triangle-alert'), h('div', h('p', 'Ce navigateur ne sait pas garder l’appli hors ligne (ou la page n’est pas ouverte en https:// ou sur localhost). Tout le reste fonctionne, avec Internet.')))));
      mount(action);
      return;
    }
    mount(
      list,
      row('L’appli', st.app, 'Prête : elle s’ouvre sans Internet', st.active ? 'Pas encore prête' : 'Pas encore active : recharge la page une fois'),
      row('Lecteur de PDF', st.pdf, 'Prêt hors ligne', 'Téléchargé au premier PDF'),
      row('Lecture de texte sur images (OCR)', st.ocr, 'Prête hors ligne', 'Téléchargée à la première photo')
    );
    const todo = !(st.pdf && st.ocr);
    if (busy) return;
    mount(
      action,
      todo && st.active
        ? h('button.btn.btn-primary', { type: 'button', onclick: run }, icon('download', { size: 18 }), `Tout préparer pour travailler sans Internet (≈ ${size})`)
        : st.app && !todo
          ? h('p.small', icon('circle-check', { size: 16 }), ' Tout est prêt : tu peux couper Internet.')
          : null
    );
  }

  async function run() {
    busy = new AbortController();
    const status = h('span');
    mount(
      action,
      h('div.job-line', h('span.spinner', { 'aria-hidden': 'true' }), status, h('button.link-btn', { type: 'button', onclick: () => busy?.abort() }, 'Annuler'))
    );
    try {
      await prepareOffline({ signal: busy.signal, onStep: (t) => (status.textContent = t) });
      toast('Prêt : l’OCR et la lecture des PDF marchent maintenant sans Internet.', { kind: 'ok' });
    } catch (e) {
      if (e?.name !== 'AbortError') toast(`La préparation a échoué : ${e?.message || 'vérifie ta connexion puis réessaie.'}`, { kind: 'error' });
    } finally {
      busy = null;
      paint();
    }
  }

  onCleanup?.(() => busy?.abort());
  mount(
    root,
    h(
      'p',
      'Après un premier chargement, Carnet Libre s’ouvre même sans Internet : tes carnets, tes cartes, tes quiz et tes fiches sont déjà sur ton appareil. Sans Internet, la recherche, la révision des cartes, les quiz et fiches automatiques et la lecture à voix haute marchent ; une IA en ligne (Groq, Gemini…) ne peut pas répondre. Ollama, sur ton ordinateur, oui.'
    ),
    list,
    action,
    h('p.small.muted', 'Le lecteur de PDF et l’OCR pèsent environ 15 Mo : conseil, prépare-les avec du Wi-Fi plutôt qu’avec tes données mobiles. Aucun de tes textes n’est envoyé pour ça : ce sont des fichiers de l’appli.')
  );
  if (offlineSupported()) lazySize().then((s) => ((size = s), paint()));
  else paint();
  return root;
}
