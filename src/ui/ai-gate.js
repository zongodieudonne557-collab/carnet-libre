// Porte d'entrée de toute fonction qui utilise une IA : vérifie qu'une IA est branchée,
// que ses réglages sont complets et — pour un service en ligne — que la personne a accepté,
// en connaissance de cause, que des extraits de ses cours quittent son appareil.
import { h, icon, openDialog, toast } from './dom.js';
import { navigate } from './router.js';
import { getSettings, giveConsent, hasConsent } from '../settings.js';
import { AIError, resolveConfig } from '../ai/client.js';
import { CHECKED_ON, PROVIDERS } from '../ai/providers.js';

/** Étiquette qui dit d'un coup d'œil où partent les textes. */
export function kindChip(p) {
  if (p.kind === 'none') return h('span.chip', icon('hard-drive', { size: 14 }), 'Aucun envoi');
  if (p.kind === 'local') return h('span.chip.chip-ok', icon('hard-drive', { size: 14 }), p.id === 'custom' ? 'Dépend du serveur' : 'Reste sur ton appareil');
  return h('span.chip.chip-warn', icon('cloud', { size: 14 }), 'Envoi sur Internet');
}

const TRAINS = {
  yes: ['chip-bad', 'Peut s’entraîner sur tes textes'],
  no: ['chip-ok', 'N’entraîne pas ses modèles sur tes textes'],
  depends: ['chip-warn', 'Dépend du modèle choisi'],
  unknown: ['chip-warn', 'Entraînement : non précisé'],
};

/** Ce que le fournisseur dit faire des textes envoyés (faits relevés sur ses pages officielles). */
export function privacyBlock(p) {
  const pr = p.privacy;
  const [cls, text] = TRAINS[pr.trains] || TRAINS.unknown;
  return h(
    'div.privacy',
    h('p.privacy-head', h('strong', pr.headline)),
    h('p', h(`span.chip.${cls}`, text), pr.minAge ? h('span.chip.chip-warn', ` Réservé aux ${pr.minAge} ans et plus`) : null),
    h('ul', pr.points.map((t) => h('li', t))),
    h(
      'p.small',
      `Relevé le ${CHECKED_ON} sur les pages officielles : ces conditions changent, relis-les. `,
      pr.links.map((l, i) => [i ? ' · ' : '', h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.label, icon('external-link', { size: 14 }))])
    )
  );
}

/** Demande l'accord explicite avant le premier envoi vers ce service. Renvoie true si accepté. */
export async function askConsent(p) {
  const checks = [];
  const needs = [`Je comprends que des extraits de mes cours quitteront mon appareil et seront traités par ${p.short}.`];
  if (p.privacy.minAge) needs.push(`J’ai ${p.privacy.minAge} ans ou plus.`);
  const answer = await openDialog({
    title: `Envoyer tes cours à ${p.short} ?`,
    body: (api) => {
      const update = () => {
        const btn = api.button(1);
        if (btn) btn.disabled = !checks.every((c) => c.checked);
      };
      return h(
        'div',
        h(
          'p',
          `Pour répondre, Carnet Libre envoie ta demande et des extraits de tes sources à ${p.short}. L’envoi part directement de ton appareil : Carnet Libre n’a pas de serveur et ne voit rien passer.`
        ),
        privacyBlock(p),
        h(
          'div.field',
          needs.map((t) => {
            const input = h('input', { type: 'checkbox', onchange: update });
            checks.push(input);
            return h('label.check', input, h('span', t));
          })
        ),
        h('p.small', 'Tu peux retirer ton accord à tout moment dans les Réglages. Ne mets dans tes carnets que des documents que tu as le droit de partager.')
      );
    },
    actions: [
      { label: 'Annuler', value: false, kind: 'quiet' },
      { label: 'J’accepte', value: true, kind: 'primary', disabled: true },
    ],
  });
  if (answer !== true) return false;
  await giveConsent(p.id);
  return true;
}

async function explainNoAI(purpose) {
  const go = await openDialog({
    title: 'Cette fonction a besoin d’une IA',
    size: 'narrow',
    body: h(
      'div',
      h('p', `Pour ${purpose}, Carnet Libre utilise une IA que tu choisis : gratuite en ligne (Groq, Gemini, OpenRouter, Mistral) ou 100 % privée sur ton ordinateur (Ollama).`),
      h('p', 'Sans IA, tu peux déjà chercher dans tes cours, réviser des cartes créées automatiquement et écouter tes cours à voix haute.')
    ),
    actions: [
      { label: 'Plus tard', value: false, kind: 'quiet' },
      { label: 'Choisir une IA', value: true, kind: 'primary' },
    ],
  });
  if (go === true) navigate('/reglages');
}

/**
 * @param {string} purpose  complète « Pour … » : « générer des cartes », « discuter avec tes cours »…
 * @returns {Promise<object|null>} configuration prête à l'emploi, ou null (la personne a été guidée)
 */
export async function ensureAI(purpose) {
  const s = getSettings().ai;
  const p = PROVIDERS[s.provider];
  if (!p || p.kind === 'none') {
    await explainNoAI(purpose);
    return null;
  }
  if (p.kind === 'cloud' && !hasConsent(p.id)) {
    if (!(await askConsent(p))) return null;
  }
  try {
    return resolveConfig();
  } catch (e) {
    if (e instanceof AIError && e.kind === 'config') {
      const go = await openDialog({
        title: 'Réglage de l’IA incomplet',
        size: 'narrow',
        body: h('p', e.message),
        actions: [
          { label: 'Fermer', value: false, kind: 'quiet' },
          { label: 'Ouvrir les réglages', value: true, kind: 'primary' },
        ],
      });
      if (go === true) navigate('/reglages');
      return null;
    }
    throw e;
  }
}

/** Affiche une erreur d'IA de façon utile (le texte des erreurs est déjà en français et dit quoi faire). */
export function reportAIError(e) {
  if (e?.kind === 'abort' || e?.name === 'AbortError') return;
  const action = ['config', 'auth', 'model', 'consent'].includes(e?.kind) ? { label: 'Réglages', onClick: () => navigate('/reglages') } : undefined;
  toast(e?.message || 'Une erreur inattendue est survenue.', { kind: 'error', action });
}
