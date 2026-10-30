import { foldAccents } from './normalize.js';

// Mots vides français (et quelques anglais, car les cours d'anglais existent aussi).
// Ils sont ignorés par la recherche : ils n'aident pas à retrouver un passage.
const RAW = `
a à au aux avec ce ces cet cette ceci cela celle celles celui ceux chaque chez ci comme comment
dans de des du donc dont elle elles en entre est et étaient était étant été être eux
il ils je la le les leur leurs lui là ma mais me même mes moi mon ne ni nos notre nous on ont ou où
par parce pas peu peut peuvent plus pour pourquoi qu quand que quel quelle quelles quels qui sa sans se ses si son sont sous sur
ta te tes toi ton tous tout toute toutes tu un une vos votre vous y
ai as avons avez avait avaient aura auront avoir eu eue eues eus
suis es sommes êtes sera seront serait fait faire font
ainsi alors après aussi autre autres avant bien car cependant certains certaines dès encore ensuite
jamais jusque notamment or parfois puis quelque quelques selon seulement sinon soit tel telle tels telles très trop toujours vers voici voilà
ça cet c d j l m n s t
the of and to in is that it for on with as are was by this be from at an
`;

export const STOPWORDS = new Set(
  RAW.split(/\s+/)
    .filter(Boolean)
    .map((w) => foldAccents(w).toLowerCase())
);
