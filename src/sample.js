// Cours d'exemple, écrits pour ce projet (aucun droit d'auteur tiers) :
// permet d'essayer l'appli en un clic, sans rien importer.

export const SAMPLE = {
  title: 'Cours d’exemple (SVT et Maths)',
  level: 'lycee',
  sources: [
    {
      title: 'SVT — La photosynthèse',
      kind: 'md',
      text: `# La photosynthèse

## Définition
La photosynthèse est le processus par lequel les plantes vertes, les algues et certaines bactéries fabriquent de la matière organique à partir de matière minérale, en utilisant l'énergie de la lumière. Elle se déroule dans les chloroplastes, des organites présents dans les cellules chlorophylliennes.

## Où a lieu la photosynthèse ?
Les chloroplastes contiennent de la chlorophylle, un pigment vert qui absorbe surtout la lumière rouge et la lumière bleue. Les feuilles sont les organes les plus riches en chloroplastes. Les échanges gazeux se font par les stomates, de petits orifices situés surtout sur la face inférieure des feuilles.

## Le bilan de la photosynthèse
Le dioxyde de carbone (CO₂) est absorbé par la plante et l'eau (H₂O) est prélevée dans le sol par les racines. En présence de lumière, la plante produit du glucose (C₆H₁₂O₆) et libère du dioxygène (O₂). L'équation bilan s'écrit :

6 CO₂ + 6 H₂O + énergie lumineuse → C₆H₁₂O₆ + 6 O₂

## Les deux grandes étapes
La phase claire se déroule dans les thylakoïdes. La lumière est captée par la chlorophylle et l'eau est décomposée : c'est la photolyse de l'eau. Du dioxygène est libéré, et de l'énergie chimique est stockée sous forme d'ATP et de NADPH.

La phase sombre, appelée cycle de Calvin, se déroule dans le stroma du chloroplaste. Elle n'a pas besoin de lumière directement : elle utilise l'ATP et le NADPH produits pendant la phase claire pour fixer le dioxyde de carbone et fabriquer des glucides.

## Les facteurs qui influencent la photosynthèse
L'intensité lumineuse, la concentration en dioxyde de carbone et la température font varier l'intensité de la photosynthèse. Quand la lumière augmente, l'intensité photosynthétique augmente d'abord, puis atteint un palier : on dit qu'elle est saturée.

## Ce qu'il faut retenir
- Les plantes vertes sont autotrophes : elles fabriquent leur propre matière organique.
- La photosynthèse produit du dioxygène, utilisé par les êtres vivants pour la respiration.
- L'amidon est la forme de réserve du glucose chez les végétaux.
`,
    },
    {
      title: 'Maths — Les fonctions affines',
      kind: 'md',
      text: `# Les fonctions affines

## Définition
Une fonction affine est une fonction f définie sur ℝ par f(x) = ax + b, où a et b sont deux nombres réels. Le nombre a est appelé coefficient directeur (ou pente) et le nombre b est appelé ordonnée à l'origine.

Cas particuliers : si b = 0, la fonction est linéaire ; si a = 0, la fonction est constante.

## Représentation graphique
La représentation graphique d'une fonction affine est une droite. Elle passe par le point de coordonnées (0 ; b). Pour la tracer, il suffit de connaître deux de ses points.

## Calcul du coefficient directeur
Si A(x₁ ; y₁) et B(x₂ ; y₂) sont deux points de la droite avec x₁ ≠ x₂, alors

$$a = \\frac{y_2 - y_1}{x_2 - x_1}$$

Exemple : la droite passe par A(1 ; 3) et B(3 ; 7). On a a = (7 − 3) / (3 − 1) = 2. Comme f(1) = 3, on obtient 2 × 1 + b = 3, donc b = 1 et f(x) = 2x + 1.

## Sens de variation
- Si a > 0, la fonction est strictement croissante sur ℝ.
- Si a < 0, la fonction est strictement décroissante sur ℝ.
- Si a = 0, la fonction est constante.

## Signe de ax + b
Si a ≠ 0, la fonction s'annule pour $x = -\\frac{b}{a}$. Pour a > 0, ax + b est négatif avant cette valeur puis positif après ; pour a < 0, c'est l'inverse.

## Résolution d'une équation
Pour résoudre ax + b = 0 avec a ≠ 0, on isole x : x = −b / a. Par exemple, 3x − 6 = 0 donne x = 2.
`,
    },
  ],
};
