#!/usr/bin/env python3
"""Génère les fichiers de test avec de vrais logiciels (python-docx, python-pptx, reportlab, Pillow).
Usage : python3 test/fixtures/make-fixtures.py
Les fichiers produits sont versionnés : inutile de relancer ce script pour lancer les tests."""
import copy, os, random
from pathlib import Path

OUT = Path(__file__).parent
random.seed(7)

# ------------------------------------------------------------------ DOCX
from docx import Document
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls

d = Document()
d.add_heading('La cellule, unité du vivant', 0)
d.add_heading('Définition', 1)
d.add_paragraph('La cellule est l’unité de base de tous les êtres vivants. Elle possède une membrane, un cytoplasme et, le plus souvent, un noyau.')
d.add_heading('Les organites', 1)
for t in ['Les mitochondries produisent l’énergie de la cellule.', 'Les chloroplastes réalisent la photosynthèse.', 'Le noyau contient l’ADN.']:
    d.add_paragraph(t, style='List Bullet')
d.add_heading('Comparaison', 2)
tbl = d.add_table(rows=3, cols=2)
for r, (a, b) in enumerate([('Organite', 'Rôle'), ('Mitochondrie', 'Respiration'), ('Chloroplaste', 'Photosynthèse')]):
    tbl.rows[r].cells[0].text = a
    tbl.rows[r].cells[1].text = b
d.add_heading('Un peu de calcul', 1)
p = d.add_paragraph('Le coefficient directeur vaut ')
omml = parse_xml(
    '<m:oMath %s><m:f><m:num><m:sSub><m:e><m:r><m:t>y</m:t></m:r></m:e><m:sub><m:r><m:t>2</m:t></m:r></m:sub></m:sSub>'
    '<m:r><m:t>−</m:t></m:r><m:sSub><m:e><m:r><m:t>y</m:t></m:r></m:e><m:sub><m:r><m:t>1</m:t></m:r></m:sub></m:sSub></m:num>'
    '<m:den><m:sSub><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sub><m:r><m:t>2</m:t></m:r></m:sub></m:sSub>'
    '<m:r><m:t>−</m:t></m:r><m:sSub><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sub><m:r><m:t>1</m:t></m:r></m:sub></m:sSub></m:den></m:f></m:oMath>'
    % nsdecls('m')
)
p._p.append(omml)
p.add_run(' et l’aire d’un cercle ')
p._p.append(parse_xml('<m:oMath %s><m:r><m:t>A=π</m:t></m:r><m:sSup><m:e><m:r><m:t>r</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>' % nsdecls('m')))
p.add_run('.')
d.save(OUT / 'cours-svt.docx')

# ------------------------------------------------------------------ PPTX
from pptx import Presentation
from pptx.util import Inches

prs = Presentation()
s = prs.slides.add_slide(prs.slide_layouts[0])
s.shapes.title.text = 'Les fonctions affines'
s.placeholders[1].text = 'Cours de mathématiques — Seconde'
s = prs.slides.add_slide(prs.slide_layouts[1])
s.shapes.title.text = 'Définition'
tf = s.placeholders[1].text_frame
tf.text = 'f(x) = ax + b'
q = tf.add_paragraph(); q.text = 'a est le coefficient directeur'; q.level = 1
q = tf.add_paragraph(); q.text = 'b est l’ordonnée à l’origine'
s.notes_slide.notes_text_frame.text = 'Insister sur le fait que la représentation graphique est une droite.'
s = prs.slides.add_slide(prs.slide_layouts[5])
s.shapes.title.text = 'Tableau de valeurs'
rows = s.shapes.add_table(3, 3, Inches(1), Inches(2), Inches(6), Inches(2)).table
for r, row in enumerate([['x', '0', '1'], ['f(x)', '1', '3'], ['Variation', 'croissante', 'croissante']]):
    for c, v in enumerate(row):
        rows.cell(r, c).text = v
s = prs.slides.add_slide(prs.slide_layouts[6])
tb = s.shapes.add_textbox(Inches(1), Inches(1), Inches(6), Inches(1))
tb.text_frame.text = 'Zéro de la fonction : x = −b/a'
prs.save(OUT / 'cours-maths.pptx')

# ------------------------------------------------------------------ PDF (texte)
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, ListFlowable, ListItem

st = getSampleStyleSheet()
doc = SimpleDocTemplate(str(OUT / 'cours-numerique.pdf'), pagesize=A4, title='Les réseaux informatiques')
long1 = ('Un réseau informatique est un ensemble d’ordinateurs et d’appareils reliés entre eux afin d’échanger des données. '
         'Chaque appareil possède une adresse IP qui permet de l’identifier sur le réseau. Les données circulent sous forme de paquets, '
         'acheminés par des routeurs jusqu’à leur destination. Cette organisation rend Internet très robuste.')
long2 = ('Le protocole HTTP définit la façon dont un navigateur demande une page à un serveur. Le protocole HTTPS ajoute le chiffrement, '
         'ce qui protège les mots de passe et les paiements. L’œuvre d’un ingénieur réseau consiste à garantir la disponibilité du service.')
doc.build([
    Paragraph('Les réseaux informatiques', st['Heading1']),
    Paragraph(long1, st['BodyText']),
    Spacer(1, 12),
    Paragraph('Les protocoles', st['Heading2']),
    Paragraph(long2, st['BodyText']),
    ListFlowable([ListItem(Paragraph(t, st['BodyText'])) for t in ['TCP assure la fiabilité des échanges.', 'UDP privilégie la rapidité.', 'DNS traduit un nom en adresse IP.']], bulletType='bullet'),
    PageBreak(),
    Paragraph('Sécurité', st['Heading2']),
    Paragraph('Utiliser un mot de passe long, unique et difficile à deviner reste la meilleure défense. « Ne jamais partager son code » est une règle d’or ; l’authentification à deux facteurs la renforce.', st['BodyText']),
    Paragraph('Formule du débit : d = (taille des données) / (durée du transfert).', st['BodyText']),
])

# ------------------------------------------------------------------ images (scan + photo)
from PIL import Image, ImageDraw, ImageFont, ImageFilter

LINES = [
    'La photosynthèse se déroule dans les chloroplastes.',
    'Les plantes vertes fabriquent de la matière organique.',
    'La chlorophylle absorbe la lumière rouge et bleue.',
    'Le dioxygène est libéré par les stomates des feuilles.',
]
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 34)
img = Image.new('L', (1500, 120 + 80 * len(LINES)), 245)
dr = ImageDraw.Draw(img)
for i, line in enumerate(LINES):
    dr.text((60, 60 + 80 * i), line, font=font, fill=25)
# « photo » : léger flou, bruit, rotation de 1°, éclairage inégal
img = img.rotate(1.0, resample=Image.BICUBIC, expand=True, fillcolor=240).filter(ImageFilter.GaussianBlur(0.6))
px = img.load()
for y in range(img.height):
    for x in range(img.width):
        v = px[x, y] + random.randint(-6, 6) - int(18 * x / img.width)
        px[x, y] = max(0, min(255, v))
img.convert('RGB').save(OUT / 'photo.png')
img.convert('RGB').save(OUT / 'photo.jpg', quality=85)
import img2pdf
(OUT / 'scan.pdf').write_bytes(img2pdf.convert(str(OUT / 'photo.jpg')))
(OUT / 'photo.jpg').unlink()

# ------------------------------------------------------------------ texte, HTML
(OUT / 'latin1.txt').write_bytes('Élève : l’été à Ouagadougou — œuvre d’art.\nLe café coûte 500 F.\n'.encode('cp1252'))
(OUT / 'utf8-bom.txt').write_bytes(b'\xef\xbb\xbf' + 'Texte avec BOM : été, île, cœur.\n'.encode('utf-8'))
(OUT / 'page.html').write_text('''<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Page de cours</title>
<style>body{color:red}</style><script>alert("x")</script></head><body>
<nav><a href="/">Accueil</a> <a href="/contact">Contact</a></nav>
<h1>Le volcanisme</h1><p>Un volcan est un relief formé par l’accumulation de matériaux issus du manteau.</p>
<h2>Les types d’éruption</h2><ul><li>Éruption effusive</li><li>Éruption explosive</li></ul>
<table><tr><th>Type</th><th>Lave</th></tr><tr><td>Effusive</td><td>Fluide</td></tr></table>
<footer>© Site de test</footer><script>track()</script></body></html>''', encoding='utf-8')
print('Fixtures écrites dans', OUT)
