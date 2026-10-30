#!/usr/bin/env python3
"""Fabrique une photo « difficile » d'une page de cahier imprimée : papier quadrillé (Seyès),
éclairage très inégal avec une bande d'ombre, bruit, flou, légère rotation et JPEG de basse qualité.
Sert à vérifier que le prétraitement de l'OCR (suppression des ombres) est utile.
Usage : python3 test/fixtures/make-hard-photo.py"""
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).parent
random.seed(11)
rng = np.random.default_rng(11)

LINES = [
    'Les fonctions affines',
    'Une fonction affine est de la forme f(x) = ax + b.',
    'Le coefficient directeur a donne la pente de la droite.',
    'Si a est positif, la fonction est croissante.',
    'L’ordonnée à l’origine b est la valeur de f(0).',
    'Sa représentation graphique est toujours une droite.',
]
W, H = 1500, 1000
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 31)
img = Image.new('RGB', (W, H), (238, 236, 228))
d = ImageDraw.Draw(img)
for y in range(40, H, 40):                       # lignes bleues du cahier
    d.line([(0, y), (W, y)], fill=(176, 196, 232), width=2)
for x in range(0, W, 40):
    d.line([(x, 0), (x, H)], fill=(205, 216, 238), width=1)
d.line([(110, 0), (110, H)], fill=(225, 120, 120), width=3)   # marge rouge
for i, line in enumerate(LINES):
    d.text((135, 80 + i * 120), line, font=font, fill=(25, 25, 55))

a = np.asarray(img, dtype=np.float32)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
light = 1.0 - 0.55 * (xx / W)                                  # dégradé : gauche claire, droite sombre
band = np.exp(-(((xx * 0.6 + yy) - 900) / 140.0) ** 2)          # bande d'ombre en diagonale (main, bord de page)
light *= 1.0 - 0.45 * band
light *= 1.0 - 0.25 * (((xx - W / 2) / W) ** 2 + ((yy - H / 2) / H) ** 2) * 4   # vignettage
a = np.clip(a * light[..., None] + rng.normal(0, 7, a.shape), 0, 255).astype(np.uint8)
img = Image.fromarray(a).filter(ImageFilter.GaussianBlur(0.9)).rotate(2.5, resample=Image.BICUBIC, expand=True, fillcolor=(60, 58, 54))
img = img.resize((1150, int(1150 * img.height / img.width)), Image.LANCZOS)
img.save(OUT / 'photo-ombre.jpg', quality=62)
print('écrit', OUT / 'photo-ombre.jpg', img.size)
