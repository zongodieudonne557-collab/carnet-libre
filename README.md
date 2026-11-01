# Carnet Libre

**Réviser tes cours avec une IA, librement et gratuitement.**
Dépose tes cours (PDF, Word, PowerPoint, photos de cahier…), pose-leur des questions avec des réponses qui citent leurs sources, puis révise avec des cartes mémoire, des quiz, des fiches, un podcast et des diapos narrées.

Carnet Libre est une alternative **libre** (licence MIT) inspirée des « carnets » de type NotebookLM, pensée pour les élèves et étudiants qui n'ont pas les moyens de payer un abonnement. Elle n'est affiliée ni à Google ni à NotebookLM.

> **État : en construction.** Le moteur (import, recherche, IA, cartes) et l'interface (carnets, discussion, Réglages, cartes, quiz, fiches, causerie, diapos) sont faits et testés ; restent le mode hors ligne (PWA) et la documentation complète. Voir [État d'avancement](#état-davancement) : rien n'est promis qui ne soit pas écrit ici.

## Principes

- **Aucun serveur, aucun compte.** Tout tourne dans ton navigateur ; tes carnets sont enregistrés sur ton appareil (IndexedDB). Pas de publicité, pas de suivi, pas de cookies.
- **Utile même sans IA.** Recherche dans tes cours, cartes créées automatiquement, révision espacée, lecture à voix haute : rien de tout cela n'envoie quoi que ce soit.
- **L'IA est facultative et c'est toi qui la choisis** : Ollama (sur ton ordinateur, 100 % privé) ou un service gratuit avec **ta propre clé** (Groq, Google Gemini, OpenRouter, Mistral). Avant le premier envoi vers un service en ligne, l'appli t'affiche ce que le fournisseur dit faire de tes textes (certaines offres gratuites s'entraînent sur ce que tu envoies) et te demande ton accord.
- **Des réponses vérifiables.** Les réponses citent des extraits numérotés ; chaque citation est contrôlée par rapport au cours (« à vérifier » sinon).
- **Sécurité par construction.** Une politique CSP stricte (`index.html`) interdit les scripts et styles en ligne et limite les connexions réseau à l'appli elle-même, à ton ordinateur et aux quatre services d'IA listés.
- **Accessible.** Texte lisible (Atkinson Hyperlegible), thème clair « papier » et sombre « tableau », taille du texte réglable, navigation au clavier, respect de `prefers-reduced-motion`.

## Essayer en local

Il faut [Node.js](https://nodejs.org) 20 ou plus (uniquement pour servir les fichiers et lancer les tests ; l'appli elle-même n'a **pas d'étape de build**).

```bash
npm install        # outils de développement (le dossier vendor/ est déjà versionné)
npm start          # sert l'appli sur http://localhost:8080
```

L'appli est un site statique : n'importe quel hébergeur de fichiers convient (GitHub Pages, Netlify, un dossier sur un réseau local…).

## Tests

```bash
npm test                 # tests unitaires (Node) — moteur d'import, recherche, IA, base de données
npm run test:browser     # tests dans un vrai Chromium (nécessite : npx playwright install chromium)
```

Les appels aux services d'IA sont testés contre un faux serveur (`scripts/mock-llm.mjs`). **Les vrais fournisseurs n'ont pas pu être testés** depuis l'environnement de développement : c'est pourquoi les Réglages proposent un bouton « Tester la connexion ».

## État d'avancement

| | Fonction | État |
|---|---|---|
| ✅ | Import PDF, Word, PowerPoint, texte, Markdown, LaTeX, page web enregistrée, sous-titres | fait, testé |
| ✅ | OCR hors ligne pour les photos et PDF scannés (français) | fait, testé — l'écriture manuscrite reste peu fiable |
| ✅ | Découpage en extraits, recherche en français (BM25), vérification des citations | fait, testé |
| ✅ | Client d'IA (Ollama, Groq, Gemini, OpenRouter, Mistral, serveur compatible OpenAI) avec consentement par fournisseur | fait, testé contre un faux serveur |
| ✅ | Cartes automatiques et répétition espacée | fait, testé |
| ✅ | Accueil, carnets, sources (import, caméra, OCR), discussion avec citations (avec ou sans IA) | fait |
| ✅ | Réglages (choix de l'IA, clés, consentement, sauvegarde) et page Confidentialité | fait, testé |
| ✅ | Modes d'étude : cartes, quiz, fiches, causerie (podcast), diapos narrées — avec ou sans IA | fait, testé dans un vrai navigateur (voix de synthèse non vérifiables sans voix installée) |
| ⏳ | Mode hors ligne (PWA), installation sur téléphone | à faire |
| 🔨 | Tests de bout en bout (réglages, modes d'étude : faits), documentation complète, guide « obtenir une clé gratuite » | en cours |

**Limites connues** : pas d'import par lien web ni YouTube (la politique CSP l'interdit volontairement) ; pas de modèle d'IA qui tourne dans le navigateur ; les PDF très mathématiques peuvent donner du texte désordonné ; les voix de lecture dépendent de l'appareil.

## Organisation du code

```
index.html        page unique + politique de sécurité (CSP)
css/              thème (jetons, base, composants, écrans)
src/
  import/         lecture des fichiers : PDF, docx, pptx, images (OCR), texte…
  text/           découpage, recherche BM25, vérification des citations
  ai/             fournisseurs, client, extraits envoyés, génération, validation
  study/          cartes automatiques, répétition espacée, séance, quiz et fiches locaux
  tts/            lecture à voix haute
  ui/             écrans (accueil, carnet, sources, discussion, réviser…) et composants
  db.js           stockage local (IndexedDB), export / import / effacement
  settings.js     réglages et consentements (les clés d'API restent en mémoire sauf accord)
vendor/           bibliothèques tierces (versionnées : pas de build)
scripts/          serveur local, faux serveur d'IA, génération des icônes
test/             tests unitaires, de navigateur et de bout en bout
```

## Bibliothèques tierces

PDF.js (Apache-2.0), Tesseract.js et son moteur WebAssembly (Apache-2.0), KaTeX (MIT), fflate (MIT), polices Atkinson Hyperlegible et Playwrite FR Trad (SIL OFL), icônes Lucide (ISC). Chaque dossier de `vendor/` contient sa licence.

## Licence

[MIT](LICENSE) — fais-en ce que tu veux, y compris l'améliorer et le partager.
