// Fournisseurs d'IA proposés. Aucun n'est obligatoire : l'appli fonctionne sans IA.
// Les faits de confidentialité viennent des pages officielles des fournisseurs (voir `links`),
// relevées à la date CHECKED_ON. Ces conditions changent : le texte invite toujours à les relire.

export const CHECKED_ON = '25 octobre 2026';

/**
 * kind : 'none' | 'local' (rien ne quitte l'appareil) | 'cloud'
 * protocol : 'openai' (POST /chat/completions) | 'gemini' (API native Google)
 * trains : le fournisseur peut-il entraîner ses modèles avec tes textes ? 'yes' | 'no' | 'depends' | 'unknown'
 */
export const PROVIDERS = {
  none: {
    id: 'none',
    name: 'Sans IA',
    short: 'Sans IA',
    kind: 'none',
    tagline: 'Recherche dans tes cours, cartes automatiques, lecture à voix haute. Rien n’est envoyé nulle part.',
  },

  ollama: {
    id: 'ollama',
    name: 'Ollama — sur ton ordinateur',
    short: 'Ollama',
    kind: 'local',
    protocol: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    jsonMode: true,
    tagline: 'L’IA tourne sur ton ordinateur : tes cours ne quittent jamais l’appareil. Gratuit et sans limite, mais il faut un ordinateur assez récent.',
    steps: [
      'Installe Ollama depuis ollama.com (Windows, macOS ou Linux).',
      'Télécharge un petit modèle, par exemple dans un terminal : ollama pull llama3.2:3b (les noms évoluent : cherche un modèle « small » sur ollama.com/library).',
      'Si tu utilises Carnet Libre depuis un site (https://…), autorise ce site : définis la variable OLLAMA_ORIGINS avec l’adresse du site, puis relance Ollama. Si tu lances Carnet Libre toi-même (npm start), rien à faire.',
      'Reviens ici, appuie sur « Actualiser la liste » puis choisis ton modèle.',
    ],
    privacy: {
      trains: 'no',
      headline: 'Tout reste sur ton ordinateur.',
      points: ['Aucun envoi vers Internet : le modèle tourne chez toi.', 'Aucun compte, aucune clé.'],
      minAge: null,
      links: [{ label: 'Réglage OLLAMA_ORIGINS', url: 'https://objectgraph.com/blog/ollama-cors/' }],
    },
  },

  groq: {
    id: 'groq',
    name: 'Groq (gratuit, très rapide)',
    short: 'Groq',
    kind: 'cloud',
    protocol: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    connectOrigin: 'https://api.groq.com',
    needsKey: true,
    jsonMode: true,
    keyUrl: 'https://console.groq.com/keys',
    tagline: 'Offre gratuite sans carte bancaire, limitée par minute et par jour. Réponses très rapides.',
    steps: [
      'Crée un compte sur console.groq.com (sans carte bancaire).',
      'Ouvre « API Keys », crée une clé et copie-la.',
      'Colle la clé ci-dessous puis choisis un modèle dans la liste.',
    ],
    privacy: {
      trains: 'unknown',
      headline: 'Par défaut, Groq ne conserve pas le contenu de tes requêtes.',
      points: [
        'Selon sa page « Your Data », Groq ne conserve pas les données des requêtes d’inférence par défaut ; des journaux liés à la fiabilité ou aux abus peuvent être gardés jusqu’à 30 jours.',
        'Les données qui sont conservées sont stockées aux États-Unis.',
        'Cette page ne dit rien sur l’entraînement de modèles : lis leurs conditions.',
      ],
      minAge: null,
      links: [{ label: 'Groq — Your Data', url: 'https://console.groq.com/docs/your-data' }],
    },
  },

  gemini: {
    id: 'gemini',
    name: 'Google Gemini (gratuit)',
    short: 'Gemini',
    kind: 'cloud',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    connectOrigin: 'https://generativelanguage.googleapis.com',
    needsKey: true,
    jsonMode: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    tagline: 'Offre gratuite de Google AI Studio, limitée. Réservée aux personnes de 18 ans et plus.',
    steps: [
      'Va sur aistudio.google.com/apikey avec un compte Google (adulte).',
      'Crée une clé API et copie-la. Si Google la refuse, vérifie que le service est disponible dans ton pays.',
      'Colle la clé ci-dessous puis choisis un modèle « flash » (les modèles « pro » sont souvent payants).',
    ],
    privacy: {
      trains: 'yes',
      headline: 'Avec le quota gratuit, Google réutilise ce que tu envoies.',
      points: [
        'Selon les conditions de l’API Gemini, pour le quota gratuit Google utilise le contenu envoyé et les réponses pour améliorer ses produits et ses technologies d’apprentissage automatique.',
        'Des relecteurs humains peuvent lire, annoter et traiter ces échanges.',
        'Google demande de ne pas envoyer d’informations sensibles, confidentielles ou personnelles.',
        'Il faut avoir 18 ans ou plus pour utiliser l’API.',
      ],
      minAge: 18,
      links: [{ label: 'Conditions de l’API Gemini', url: 'https://ai.google.dev/gemini-api/terms' }],
    },
  },

  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter (modèles gratuits)',
    short: 'OpenRouter',
    kind: 'cloud',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    connectOrigin: 'https://openrouter.ai',
    needsKey: true,
    jsonMode: false,
    keyUrl: 'https://openrouter.ai/keys',
    tagline: 'Un intermédiaire qui donne accès à plusieurs modèles, dont certains gratuits (nom terminé par « :free »). Quota gratuit faible.',
    steps: [
      'Crée un compte sur openrouter.ai puis une clé sur openrouter.ai/keys.',
      'Colle la clé ci-dessous : la liste ne montre que les modèles gratuits.',
      'Dans ton compte OpenRouter, ouvre les réglages de confidentialité et refuse les fournisseurs qui entraînent leurs modèles sur tes données.',
    ],
    privacy: {
      trains: 'depends',
      headline: 'Ton texte passe par OpenRouter, puis par le fournisseur du modèle choisi.',
      points: [
        'OpenRouter précise que, partout où c’est possible, il s’arrange pour que les prompts ne servent pas à entraîner des modèles, « mais il y a des exceptions ».',
        'Tu peux refuser, dans les réglages de ton compte, le routage vers des fournisseurs qui entraînent sur tes données (réglage séparé pour les modèles gratuits).',
        'Limites gratuites : 20 requêtes par minute, et 50 requêtes par jour tant que tu n’as pas acheté de crédits.',
      ],
      minAge: null,
      links: [
        { label: 'OpenRouter — confidentialité', url: 'https://openrouter.ai/docs/guides/privacy/logging' },
        { label: 'OpenRouter — limites', url: 'https://openrouter.ai/docs/api-reference/limits' },
      ],
    },
  },

  mistral: {
    id: 'mistral',
    name: 'Mistral (plan Expérimentation)',
    short: 'Mistral',
    kind: 'cloud',
    protocol: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    connectOrigin: 'https://api.mistral.ai',
    needsKey: true,
    jsonMode: true,
    keyUrl: 'https://console.mistral.ai/api-keys',
    tagline: 'Entreprise française. Plan gratuit sans carte bancaire, mais avec vérification d’un numéro de téléphone.',
    steps: [
      'Crée un compte sur console.mistral.ai et active le plan « Expérimentation » (gratuit, un numéro de téléphone par plan).',
      'Crée une clé dans « API Keys » et copie-la.',
      'Colle la clé ci-dessous puis choisis un modèle dans la liste.',
    ],
    privacy: {
      trains: 'yes',
      headline: 'Avec le plan gratuit, Mistral peut s’entraîner sur tes requêtes.',
      points: [
        'Selon le centre d’aide de Mistral, les requêtes faites avec le plan Expérimentation peuvent être utilisées pour entraîner ses modèles.',
        'Un numéro de téléphone vérifié est demandé pour activer le plan.',
      ],
      minAge: null,
      links: [{ label: 'Mistral — plan Expérimentation', url: 'https://help.mistral.ai/en/articles/455206-how-can-i-try-the-api-for-free-with-the-experiment-plan' }],
    },
  },

  custom: {
    id: 'custom',
    name: 'Autre serveur compatible OpenAI',
    short: 'Serveur perso',
    kind: 'local',
    protocol: 'openai',
    baseUrl: '',
    needsKey: false,
    jsonMode: true,
    tagline: 'LM Studio, llama.cpp, Jan… ou tout service qui comprend l’API « /v1/chat/completions ». Adresse locale uniquement par défaut.',
    steps: [
      'Lance ton serveur (par exemple LM Studio : http://localhost:1234/v1).',
      'Indique son adresse ci-dessous, puis appuie sur « Actualiser la liste ».',
      'Pour une adresse qui n’est pas sur ton ordinateur, il faut aussi l’ajouter à la règle « connect-src » de index.html (voir la documentation).',
    ],
    privacy: {
      trains: 'unknown',
      headline: 'Dépend du serveur que tu as choisi.',
      points: ['Si le serveur tourne sur ton ordinateur, rien ne quitte l’appareil.', 'Pour un serveur distant, lis ses conditions.'],
      minAge: null,
      links: [],
    },
  },
};

export const PROVIDER_ORDER = ['none', 'ollama', 'groq', 'gemini', 'openrouter', 'mistral', 'custom'];

export const isCloud = (id) => PROVIDERS[id]?.kind === 'cloud';

/** Origines autorisées par la règle de sécurité (CSP) de index.html pour joindre une IA. */
export function connectOrigins() {
  return [...new Set(Object.values(PROVIDERS).map((p) => p.connectOrigin).filter(Boolean))];
}

/** L'adresse désigne-t-elle ton propre ordinateur ? (seule forme que la règle de sécurité autorise sans service déclaré) */
export function isLocalUrl(url) {
  try {
    const u = new URL(String(url));
    return (u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/**
 * Cette adresse peut-elle être jointe par l'appli ? La règle de sécurité (CSP) de index.html n'autorise
 * que ton ordinateur (localhost, 127.0.0.1) et les services listés ci-dessus. Toute autre adresse
 * serait bloquée par le navigateur : mieux vaut le dire avant le test que laisser croire à une panne réseau.
 */
export function allowedByCsp(url) {
  if (isLocalUrl(url)) return true;
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && connectOrigins().includes(u.origin);
  } catch {
    return false;
  }
}
