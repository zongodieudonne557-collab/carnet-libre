# Obtenir une clé d'IA gratuite (et ce que ça implique)

**Tu n'en as pas besoin pour commencer.** Sans IA, Carnet Libre cherche dans tes cours, crée des cartes automatiquement, construit des quiz à partir de tes cartes, fait une fiche automatique, un diaporama par titres et lit tes cours à voix haute. Une IA sert à *rédiger* (cartes plus variées, quiz, fiches, causeries, diapos, réponses en discussion), toujours à partir de tes sources.

Une « clé d'API » est un mot de passe long que le fournisseur te donne : il permet à l'appli de lui parler **de ta part**. Garde-la secrète, comme un mot de passe.

## Choisir

| Option | Coût | Ce qui part sur Internet | À savoir |
|---|---|---|---|
| **Sans IA** | 0 | rien | déjà très utile |
| **Ollama** (sur ton ordinateur) | 0, sans limite | rien | il faut un ordinateur assez récent (surtout de la mémoire), et installer Ollama |
| **Groq** | offre gratuite, sans carte bancaire | extraits de tes cours | très rapide ; limites par minute et par jour |
| **Google Gemini** | offre gratuite | extraits de tes cours | réservée aux 18 ans et plus ; avec le quota gratuit, Google peut réutiliser ce qui est envoyé |
| **OpenRouter** | modèles gratuits (nom terminé par `:free`) | extraits de tes cours | quota gratuit faible ; dépend du modèle choisi |
| **Mistral** | plan gratuit « Expérimentation » | extraits de tes cours | numéro de téléphone demandé ; le plan gratuit peut servir à entraîner leurs modèles |

Les chiffres et conditions exacts changent souvent : ils sont affichés **dans l'appli** (Réglages → Intelligence artificielle : choisis un service, le bloc de confidentialité apparaît juste dessous ; la page « Confidentialité » les reprend tous), avec la date à laquelle ils ont été relevés et un lien vers la page officielle. Relis-les : ce guide ne les recopie pas pour ne pas devenir faux.

> ⚠️ **Gratuit n'est pas sans contrepartie.** N'envoie à une IA gratuite en ligne ni données personnelles, ni document confidentiel, ni document que tu n'as pas le droit de partager.

## Pas à pas

1. Ouvre **Réglages → Intelligence artificielle** et choisis un service. Rien n'est envoyé à ce moment-là.
2. Suis les trois étapes affichées sous le service choisi (créer un compte, créer une clé, la copier). Les adresses des pages officielles y sont.
3. Colle la clé dans le champ, puis appuie sur **« Actualiser la liste »** : l'appli demande au service la liste de ses modèles (c'est le seul envoi de cette étape, et il ne contient pas tes cours).
4. Choisis un modèle (l'appli en conseille un). Les modèles « flash », « instant » ou « small » sont plus rapides et suffisent pour réviser.
5. Appuie sur **« Tester la connexion »**.
6. Au premier usage réel (par exemple « Créer avec l'IA » dans les quiz), l'appli te montre ce que le service dit faire de tes textes et te demande ton accord. Rien ne part avant.

## Garder ta clé en sécurité

- Par défaut, la clé reste **en mémoire** : elle disparaît quand tu fermes l'onglet. Il faudra la recoller la prochaine fois.
- Coche « Mémoriser » seulement sur **ton** appareil. Sur un ordinateur partagé, ne le fais jamais.
- Une clé ne doit jamais être publiée (GitHub, captures d'écran, messages). Si elle fuit : supprime-la sur le site du fournisseur et crées-en une autre.
- La sauvegarde de Carnet Libre ne contient jamais tes clés.

## Si ça ne marche pas

| Message | Que faire |
|---|---|
| « … a refusé la clé » | Recopie la clé en entier (sans espace). Vérifie qu'elle correspond bien au service choisi. |
| « Limite gratuite atteinte » | L'offre gratuite a des limites par minute et par jour : attends, ou essaie un autre service. |
| « Impossible de joindre … » | Vérifie ta connexion. Certains réseaux (écoles, entreprises) bloquent ces services ; certains services refusent aussi les appels faits depuis un navigateur : essaie-en un autre. |
| Réponses vides ou coupées | Choisis un autre modèle, ou demande plus court (moins de cartes, un chapitre précis). |
| Une carte ou une question est « à vérifier » | L'IA n'a pas pu prouver sa réponse avec une phrase de ton cours : relis ton cours avant de la retenir. |

## Limite à connaître

Les vrais services d'IA n'ont pas pu être testés depuis l'environnement où Carnet Libre a été écrit : les appels sont vérifiés contre un faux serveur qui imite leurs réponses. C'est pourquoi le bouton « Tester la connexion » existe. Si un service se comporte autrement que prévu, ouvre une « issue » sur le dépôt (sans y mettre ta clé).
