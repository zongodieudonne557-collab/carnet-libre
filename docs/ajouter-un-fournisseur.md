# Ajouter un service d'IA

Carnet Libre parle à un service d'IA **directement depuis le navigateur**. Pour que ça reste sûr, la politique de sécurité de la page (CSP, dans `index.html`) n'autorise que :

- ton propre ordinateur (`http://localhost:*` et `http://127.0.0.1:*`) : Ollama, LM Studio, llama.cpp, Jan…
- les quatre services déclarés : Groq, Google Gemini, OpenRouter, Mistral.

Toute autre adresse est bloquée par le navigateur. C'est voulu : une page ne peut pas être détournée pour envoyer tes cours ailleurs.

## Cas 1 : un serveur sur ton ordinateur

Rien à modifier. Dans Réglages → Intelligence artificielle, choisis **« Autre serveur compatible OpenAI »**, saisis l'adresse (par exemple `http://localhost:1234/v1`), puis « Actualiser la liste ». Le serveur doit comprendre `POST /chat/completions` (format OpenAI) et, si possible, `GET /models`.

## Cas 2 : un service en ligne compatible avec l'API OpenAI

Il faut modifier deux fichiers, puis relancer les tests.

**1. `index.html` : autoriser l'adresse.** Ajoute l'origine du service (schéma + domaine, sans chemin) à `connect-src` :

```html
connect-src 'self' http://localhost:* http://127.0.0.1:* https://api.groq.com … https://api.exemple.com;
```

**2. `src/ai/providers.js` : décrire le service.** Copie une entrée existante (par exemple `mistral`) et adapte-la :

```js
exemple: {
  id: 'exemple',
  name: 'Exemple (offre gratuite)',   // nom complet affiché dans la liste
  short: 'Exemple',                   // nom court, utilisé dans les messages
  kind: 'cloud',                      // 'cloud' : demande l'accord avant tout envoi
  protocol: 'openai',                 // 'openai' (/chat/completions) ou 'gemini' (API native Google)
  baseUrl: 'https://api.exemple.com/v1',
  connectOrigin: 'https://api.exemple.com', // exactement ce qui est dans connect-src
  needsKey: true,
  jsonMode: true,                     // le service accepte response_format: { type: 'json_object' } ?
  keyUrl: 'https://console.exemple.com/keys',
  tagline: 'Une phrase honnête sur l’offre gratuite et ses limites.',
  steps: ['Crée un compte…', 'Crée une clé…', 'Colle la clé ci-dessous…'],
  privacy: {
    trains: 'unknown',                // 'yes' | 'no' | 'depends' | 'unknown' : ce que dit le fournisseur de tes textes
    headline: 'Une phrase qui résume.',
    points: ['Fait 1, relevé sur la page officielle…', 'Fait 2…'],
    minAge: null,                     // âge minimum exigé, ou null
    links: [{ label: 'Conditions du service', url: 'https://…' }],
  },
},
```

Ajoute ensuite `'exemple'` à `PROVIDER_ORDER` (même fichier) et mets à jour `CHECKED_ON` avec la date à laquelle tu as relevé les conditions.

**Règles à respecter**

- Les faits de confidentialité doivent venir de la **page officielle** du service, avec le lien. N'écris pas « ne garde rien » sans source. Si la page ne dit rien, mets `trains: 'unknown'` et dis-le.
- Reste en `kind: 'cloud'` pour tout service qui n'est pas ton ordinateur : c'est ce qui déclenche la demande d'accord.
- Une clé n'est jamais envoyée qu'au service auquel elle appartient : ne contourne pas ce mécanisme.

## Cas 3 : un service avec une API différente

Les deux protocoles gérés sont `openai` et `gemini` (voir `src/ai/client.js`). Pour un troisième, ajoute un adaptateur dans `client.js` (construction de la requête, lecture de la réponse en flux, messages d'erreur en français) et des tests contre `scripts/mock-llm.mjs`.

## Tester

```bash
npm test                       # cohérence des fournisseurs et de la CSP (test/unit/meta.test.mjs)
npm run precache               # index.html a changé : recalcule la liste hors ligne
npm run test:e2e               # parcours complets
```

Le faux serveur `scripts/mock-llm.mjs` imite les réponses OpenAI et Gemini (pannes, limites de débit, JSON cassé…) pour vérifier ton adaptation sans clé réelle. Il ne remplace pas un essai avec le vrai service : utilise « Tester la connexion » dans les Réglages.
