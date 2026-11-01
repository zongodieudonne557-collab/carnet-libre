# Licences des composants tiers

Carnet Libre est publié sous licence MIT (voir [LICENSE](LICENSE)). Il embarque les composants ci-dessous dans le dossier `vendor/` (ou, pour les icônes, dans `src/ui/icons.js`). Aucun n'est chargé depuis un autre site. Chaque dossier garde le texte de sa licence.

| Composant | Version | Licence | Usage | Texte de la licence |
|---|---|---|---|---|
| [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) | 6.4.299 | Apache-2.0 | lire le texte des PDF | `vendor/pdfjs/LICENSE` |
| [Tesseract.js](https://github.com/naptha/tesseract.js) | 7.0.0 | Apache-2.0 | reconnaissance de texte (OCR), partie JavaScript | `vendor/tesseract/LICENSE` |
| [Tesseract.js Core](https://github.com/naptha/tesseract.js-core) | 7.0.0 | Apache-2.0 | moteur d'OCR compilé en WebAssembly | `vendor/tesseract/LICENSE` |
| Modèle français « best_int » (version allégée de « tessdata_best ») du projet [Tesseract OCR](https://github.com/tesseract-ocr/tessdata_best), empaqueté par `@tesseract.js-data/fra` | 1.0.0 (paquet) | Apache-2.0 (modèle) ; MIT (paquet) | données de langue pour l'OCR | `vendor/tesseract/LICENSE` |
| [fflate](https://101arrowz.github.io/fflate) | 0.8.3 | MIT | lire les fichiers Word et PowerPoint (zip) | `vendor/fflate/LICENSE` |
| [KaTeX](https://katex.org) | 0.19.1 | MIT | afficher les formules | `vendor/katex/LICENSE` |
| [Atkinson Hyperlegible](https://fontsource.org/fonts/atkinson-hyperlegible) (Braille Institute) | 5.3.0 | SIL OFL 1.1 | police de lecture | `vendor/fonts/LICENSE-atkinson-hyperlegible` |
| [Playwrite FR Trad](https://fontsource.org/fonts/playwrite-fr-trad) | 5.3.0 | SIL OFL 1.1 | police des titres (écriture scolaire) | `vendor/fonts/LICENSE-playwrite-fr-trad` |
| [Lucide](https://lucide.dev) | 1.61.0 | ISC (et MIT pour les icônes issues de Feather) | icônes | ci-dessous |

Les versions exactes sont dans `vendor/VERSIONS.json` ; le script `npm run vendor` recopie ces fichiers depuis les paquets npm.

Les outils de test (Playwright, fake-indexeddb…) ne sont pas livrés avec l'appli.

## Lucide

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

Certaines icônes de Lucide sont dérivées du projet Feather (par exemple `check`, `chevron-*`, `download`, `external-link`, `headphones`, `info`, `lock`, `maximize`, `monitor`, `moon`, `plus`, `search`, `server`, `square`, `trash`, `upload`, `x`) :

```
The MIT License (MIT)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
