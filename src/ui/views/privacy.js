// Confidentialité : ce qui reste sur l'appareil, ce qui peut partir, comment garder le contrôle.
// Les faits sur les fournisseurs viennent de src/ai/providers.js : ils ne peuvent pas se contredire.
import { CHECKED_ON, PROVIDERS, PROVIDER_ORDER } from '../../ai/providers.js';
import { kindChip, privacyBlock } from '../ai-gate.js';
import { h, icon, mount } from '../dom.js';
import { href } from '../router.js';

const UPDATED_ON = '1er novembre 2026';

const section = (id, ic, title, ...content) =>
  h('section.set', { 'aria-labelledby': `p-${id}` }, h('h2', { id: `p-${id}` }, icon(ic, { size: 26 }), title), content);

const link = (path, text) => h('a', { href: href(path) }, text);

export default async function privacyView({ root, setTitle }) {
  setTitle('Confidentialité');
  const providers = PROVIDER_ORDER.map((id) => PROVIDERS[id]).filter((p) => p.kind !== 'none');
  const reuse = providers.filter((p) => p.privacy?.trains === 'yes').map((p) => p.short);
  const listed = reuse.length > 1 ? `${reuse.slice(0, -1).join(', ')} et ${reuse.at(-1)}` : reuse[0] || '';

  mount(
    root,
    h(
      'div.page.privacy-page',
      h(
        'header.page-head',
        h('h1', { 'data-focus': '', tabindex: '-1' }, 'Confidentialité'),
        h('p.lead', 'En deux phrases : tes cours restent sur ton appareil. Ils ne partent sur Internet que si tu choisis une IA en ligne et que tu l’acceptes, et seulement les extraits utiles à ta question.')
      ),

      section(
        'local',
        'hard-drive',
        'Ce qui reste sur ton appareil',
        h(
          'ul',
          h('li', 'Tes carnets, sources (le texte tiré de tes fichiers), cartes, quiz, fiches, podcasts, diapos et l’historique de tes discussions sont enregistrés dans le navigateur de cet appareil. Carnet Libre n’a pas de serveur : il n’en existe aucune copie ailleurs.'),
          h('li', 'Tes fichiers ne sont pas envoyés pour être lus : les PDF, Word, PowerPoint et les photos (reconnaissance du texte, ou OCR) sont traités directement dans ton navigateur.'),
          h('li', 'Tes clés d’API ne sont enregistrées sur l’appareil que si tu coches « Mémoriser ». Sinon elles restent en mémoire et disparaissent à la fermeture de l’onglet. La clé d’un service n’est jamais envoyée à un autre.'),
          h('li', 'Le mode hors ligne garde seulement les fichiers de l’appli, pour qu’elle s’ouvre sans Internet. Il ne voit ni ne garde jamais tes données, ni les demandes envoyées à une IA.'),
          h('li', 'Pas de compte, pas de cookie, pas de publicité, pas de statistiques, pas de pisteur. Aucune police ni bibliothèque n’est chargée depuis un autre site : tout vient du même endroit que l’appli, et la règle de sécurité du navigateur l’impose.')
        )
      ),

      section(
        'cloud',
        'cloud',
        'Ce qui peut partir sur Internet, avec ton accord',
        h('p', 'Seulement si tu choisis un service d’IA en ligne dans les ', link('/reglages', 'Réglages'), '. Quand tu poses une question ou lances une génération, l’appli envoie ta demande et quelques extraits de tes sources actives (pas tout le carnet, jamais les autres carnets) à ce service, directement depuis ton appareil. La quantité envoyée se règle dans les Réglages.'),
        h('p', 'Avant le premier envoi, l’appli t’affiche ce que le fournisseur dit faire de tes textes et te demande ton accord. Tu peux le retirer à tout moment.'),
        listed
          ? h(
              'div.callout.callout-warn',
              icon('triangle-alert'),
              h('div', h('p', h('strong', 'Gratuit ne veut pas dire sans contrepartie. '), `Avec l’offre gratuite de ${listed}, ce que tu envoies peut être lu et réutilisé par le fournisseur. N’y mets ni données personnelles ni documents confidentiels. Avec Ollama, ou sans IA, rien ne sort de ton appareil.`))
            )
          : null,
        h('p.label', 'Ce que dit chaque fournisseur'),
        providers.map((p) => h('details.help', h('summary', h('span', p.name), kindChip(p)), h('div.help-body', privacyBlock(p))))
      ),

      section(
        'voice',
        'volume-2',
        'Lecture à voix haute',
        h('p', 'La lecture utilise les voix de ton navigateur. Les voix marquées « sur l’appareil » ne sortent jamais. Certaines voix « en ligne » (par exemple celles de Google dans Chrome) envoient le texte lu à leur fournisseur. Les Réglages indiquent laquelle est laquelle et te laissent choisir.')
      ),

      section(
        'host',
        'server',
        'Ce que voit l’hébergeur du site',
        h('p', 'Comme pour tout site web, le service qui héberge Carnet Libre (par exemple GitHub Pages) sait que ton navigateur télécharge les fichiers de l’appli : adresse IP, date, pages demandées. Il ne voit ni tes cours ni tes questions. Pour ne dépendre d’aucun hébergeur, tu peux aussi lancer Carnet Libre toi-même sur ton ordinateur (voir le README du projet).')
      ),

      section(
        'control',
        'shield-check',
        'Garder le contrôle',
        h(
          'ul',
          h('li', h('strong', 'Sauvegarder : '), 'Réglages, « Mes données », « Télécharger une sauvegarde ». Le fichier ne contient jamais tes clés d’API.'),
          h('li', h('strong', 'Retirer ton accord d’envoi : '), 'Réglages, « Intelligence artificielle », « Retirer mon accord ».'),
          h('li', h('strong', 'Tout effacer : '), 'Réglages, « Mes données », « Tout effacer ». Carnets, réglages, clés et mode hors ligne disparaissent de l’appareil.'),
          h('li', h('strong', 'Ordinateur partagé : '), 'cybercafé, salle informatique… tes carnets restent dans le navigateur après ton départ. Télécharge une sauvegarde puis « Tout effacer » avant de partir, et ne mémorise pas ta clé.')
        ),
        h('p', h('a.btn', { href: href('/reglages') }, icon('settings', { size: 18 }), 'Ouvrir les Réglages'))
      ),

      section(
        'limits',
        'info',
        'Les limites de ces garanties',
        h(
          'ul',
          h('li', `Carnet Libre ne contrôle pas ce que fait un fournisseur d’IA d’un texte une fois qu’il l’a reçu. Les informations ci-dessus ont été relevées le ${CHECKED_ON} sur leurs pages officielles ; leurs conditions changent : relis-les (liens ci-dessus).`),
          h('li', 'Quelqu’un qui a accès à ton appareil, un virus ou une extension de navigateur malveillante peut lire ce que le navigateur garde.'),
          h('li', 'Ne mets dans tes carnets que des documents que tu as le droit de partager. L’appli n’envoie rien sans ton accord, mais envoyer un document protégé à un service tiers n’est pas toujours permis.'),
          h('li', 'Carnet Libre est fourni tel quel, sans garantie (licence MIT) : c’est un projet libre, pas un service commercial.')
        )
      ),

      section(
        'libs',
        'files',
        'Bibliothèques embarquées',
        h('p', 'PDF.js, Tesseract.js, KaTeX, fflate, les polices Atkinson Hyperlegible et Playwrite FR Trad et les icônes Lucide sont livrées avec l’appli (dossier vendor/). Aucune n’est chargée depuis un autre site. Leurs licences sont dans le projet.')
      ),

      h('p.small.muted', `Texte mis à jour le ${UPDATED_ON}.`)
    )
  );
}
