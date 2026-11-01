# Confidentialité

*Dernière mise à jour : 1er novembre 2026. La même information est dans l'appli (menu « Confidentialité »), où elle est tirée du même code que les écrans : les deux ne peuvent pas se contredire.*

**En deux phrases :** tes cours restent sur ton appareil. Ils ne partent sur Internet que si tu choisis toi-même une IA en ligne et que tu l'acceptes, et seulement les extraits utiles à ta demande.

## Ce qui reste sur ton appareil

- Carnets, sources (le texte tiré de tes fichiers), cartes, quiz, fiches, causeries, diapos et discussions sont enregistrés dans le navigateur (IndexedDB). Carnet Libre n'a **pas de serveur** : il n'en existe aucune copie ailleurs.
- Tes fichiers ne sont pas envoyés pour être lus : PDF, Word, PowerPoint et photos (reconnaissance du texte, ou OCR) sont traités **dans ton navigateur**.
- Tes clés d'API ne sont gardées sur l'appareil que si tu coches « Mémoriser ». Sinon elles restent en mémoire et disparaissent à la fermeture de l'onglet. La clé d'un service n'est jamais envoyée à un autre.
- Pas de compte, pas de cookie, pas de publicité, pas de statistiques, pas de pisteur.
- Aucune police ni bibliothèque n'est chargée depuis un autre site. La politique de sécurité de la page (CSP, dans `index.html`) l'impose : le navigateur bloquerait toute tentative.

## Ce qui peut partir sur Internet, avec ton accord

Seulement si tu choisis un service d'IA en ligne (Groq, Google Gemini, OpenRouter, Mistral) dans les Réglages. Quand tu poses une question ou lances une génération, l'appli envoie ta demande et **quelques extraits de tes sources actives** (pas tout le carnet, jamais les autres carnets) à ce service, directement depuis ton appareil.

- Avant le premier envoi, l'appli te montre ce que le fournisseur dit faire de tes textes et te demande ton accord, service par service. Tu peux le retirer à tout moment.
- **Gratuit ne veut pas dire sans contrepartie.** Avec certaines offres gratuites, le fournisseur peut lire et réutiliser ce que tu envoies (par exemple pour entraîner ses modèles). N'y mets ni données personnelles ni documents confidentiels.
- Avec **Ollama** (sur ton ordinateur) ou **sans IA**, rien ne sort de ton appareil.

Les conditions des fournisseurs sont relevées sur leurs pages officielles à la date indiquée dans l'appli (`CHECKED_ON` dans `src/ai/providers.js`). Elles changent : relis-les avant d'envoyer quoi que ce soit.

## Mode hors ligne

Un service worker (`sw.js`) garde les **fichiers de l'appli** pour qu'elle s'ouvre sans Internet. Il ne voit ni ne garde jamais tes données ni les requêtes vers une IA : celles-ci partent directement du navigateur vers le service choisi. « Tout effacer » (Réglages) retire aussi ce cache.

## Lecture à voix haute

La lecture utilise les voix de ton navigateur. Les voix « sur l'appareil » ne sortent jamais. Certaines voix « en ligne » (par exemple celles de Google dans Chrome) envoient le texte lu à leur fournisseur ; les Réglages indiquent laquelle est laquelle.

## Ce que voit l'hébergeur du site

Comme pour tout site web, le service qui héberge Carnet Libre (par exemple GitHub Pages) sait que ton navigateur télécharge les fichiers de l'appli : adresse IP, date, pages demandées. Il ne voit ni tes cours ni tes questions. Pour ne dépendre d'aucun hébergeur, tu peux lancer Carnet Libre toi-même : `npm start` (voir [le déploiement](docs/deploiement.md)).

## Garder le contrôle

- **Sauvegarder** : Réglages → « Mes données » → « Télécharger une sauvegarde ». Le fichier ne contient jamais tes clés d'API.
- **Retirer ton accord d'envoi** : Réglages → « Intelligence artificielle ».
- **Tout effacer** : Réglages → « Mes données » → « Tout effacer ».
- **Ordinateur partagé** (cybercafé, salle informatique) : tes carnets restent dans le navigateur après ton départ. Télécharge une sauvegarde, puis « Tout effacer » avant de partir, et ne mémorise pas ta clé.

## Les limites de ces garanties

- Carnet Libre ne contrôle pas ce qu'un fournisseur d'IA fait d'un texte une fois reçu.
- Quelqu'un qui a accès à ton appareil, un virus ou une extension de navigateur malveillante peut lire ce que le navigateur garde.
- Ne mets dans tes carnets que des documents que tu as le droit de partager : envoyer un document protégé à un service tiers n'est pas toujours permis.
- Carnet Libre est fourni tel quel, sans garantie (licence MIT). C'est un projet libre, pas un service commercial. Il n'est affilié ni à Google ni à NotebookLM.

## Signaler un problème

Ouvre une « issue » sur le dépôt : <https://github.com/zongodieudonne557-collab/carnet-libre/issues>. N'y colle jamais de clé d'API ni de contenu de cours privé.
