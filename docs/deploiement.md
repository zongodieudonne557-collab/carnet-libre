# Déployer Carnet Libre

Carnet Libre est un ensemble de fichiers statiques : **pas de serveur à faire tourner, pas de compilation**. N'importe quel hébergement de fichiers convient.

## 1. Sur ton ordinateur (le plus privé)

Il faut [Node.js](https://nodejs.org) 20 ou plus.

```bash
git clone https://github.com/zongodieudonne557-collab/carnet-libre.git
cd carnet-libre
npm start            # puis ouvre http://127.0.0.1:8080
```

Les bibliothèques sont déjà dans `vendor/` : pas d'`npm install` nécessaire pour utiliser l'appli. Avec Ollama, cette façon de faire évite toute configuration de sécurité supplémentaire (voir [ajouter un fournisseur](ajouter-un-fournisseur.md)).

## 2. Sur GitHub Pages (gratuit)

1. Pousse le dépôt sur GitHub (déjà fait si tu as forké celui-ci).
2. **Settings → Pages → Build and deployment → Source : « Deploy from a branch »**, branche `main`, dossier `/ (root)`, puis *Save*.
3. Après une minute, l'appli est à `https://<ton-compte>.github.io/<nom-du-dépôt>/`.

Le fichier `.nojekyll` (déjà présent) dit à GitHub de servir les fichiers tels quels.

**À savoir sur GitHub Pages**

- **Origine partagée.** Tous les sites « projet » d'un même compte (`<compte>.github.io/…`) partagent la même origine web, donc le même stockage navigateur. Si tu publies d'autres sites sur ce compte, ils pourraient lire les données de Carnet Libre. Pour une vraie séparation, utilise un **nom de domaine personnalisé** (Settings → Pages → Custom domain) ou un compte/organisation dédié.
- **En-têtes HTTP.** GitHub Pages ne permet pas de choisir les en-têtes : la politique de sécurité (CSP) est donc fournie par la balise `<meta>` de `index.html`. C'est suffisant pour ce projet ; sur un hébergement qui le permet, tu peux aussi l'envoyer en en-tête.
- **HTTPS** est actif par défaut : indispensable pour le mode hors ligne et l'installation sur téléphone.
- **Ollama depuis un site https://** : le navigateur n'autorise l'appli à parler à `http://localhost` que si Ollama l'accepte. Définis la variable `OLLAMA_ORIGINS` avec l'adresse de ton site, puis relance Ollama. En lançant l'appli toi-même (`npm start`), rien à faire.

## 3. Autres hébergements

Netlify, Cloudflare Pages, un serveur web classique… : publie le dossier tel quel, sans commande de compilation. Vérifie seulement que `sw.js` est servi avec le type `text/javascript` et **sans cache long** (ou avec `Cache-Control: no-cache`), pour que les mises à jour arrivent.

## Publier une nouvelle version

Chaque fois que tu modifies un fichier de l'appli :

```bash
npm run precache     # recalcule precache.js (liste et empreinte des fichiers du mode hors ligne)
npm test             # un test échoue si precache.js n'est pas à jour
```

Puis commit et push. Les personnes qui ont déjà installé l'appli voient « Une nouvelle version de Carnet Libre est prête » et choisissent quand mettre à jour : la page ne se recharge jamais toute seule.

## Mises à jour des bibliothèques

`npm install` puis `npm run vendor` recopie les bibliothèques dans `vendor/` (versions épinglées dans `package.json`). Relance `npm run precache` et les tests, et mets à jour [THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md) si une licence change.

## Vérifier avant de publier

```bash
npm test               # logique (unitaire)
npm run test:browser   # import de fichiers dans un vrai navigateur
npm run test:e2e       # parcours complets : Playwright + Chromium (npx playwright install chromium)
```
