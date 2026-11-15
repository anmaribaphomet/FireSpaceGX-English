"""
biblioteca.py - Search in the FireSpace library (data/firespace.db).

Used by app.py to find the fragments of the challenge sources
that are related to the user's question.
"""

import re
import sqlite3
import unicodedata
from pathlib import Path

RUTA_BD = Path(__file__).resolve().parent / "data" / "firespace.db"


def disponible():
    """True if the database was already created with scripts/ingestar_fuentes.py."""
    return RUTA_BD.exists()


# Backup glossary of the most common terms of the field: it adds the technical terms used by the
# NASA documents, so the search works even if the AI keyword step fails.
# The key is the beginning of the word: "flame" also covers "flames".
GLOSARIO = {
    "microgravit": "microgravity weightlessness", "weightless": "microgravity weightlessness",
    "zero g": "microgravity", "gravit": "gravity buoyancy", "flame": "flame", "fire": "fire flame",
    "combust": "combustion fuel", "burn": "burning combustion", "oxygen": "oxygen", "smoke": "smoke",
    "soot": "soot", "droplet": "droplet", "drop": "droplet", "extingui": "extinction extinguishment",
    "extinct": "extinction extinguishment", "suppress": "suppression suppressant",
    "flammab": "flammability flammable", "ignit": "ignition", "spread": "spread propagation",
    "spacecraft": "spacecraft", "ship": "spacecraft", "station": "station", "space": "space",
    "astronaut": "astronaut crew", "crew": "crew", "moon": "moon lunar", "lunar": "lunar moon",
    "mars": "mars", "detect": "detection detector", "sensor": "sensor", "temperatur": "temperature",
    "pressur": "pressure", "buoyan": "buoyancy", "convect": "convection", "ventilat": "ventilation",
    "flow": "flow", "air": "air", "safety": "safety", "risk": "hazard risk", "hazard": "hazard risk",
    "danger": "hazard risk", "material": "material", "solid": "solid", "fabric": "fabric",
    "plastic": "plastic", "firefight": "firefighter", "suit": "suit", "tank": "tank",
    "experiment": "experiment investigation", "hypothes": "hypothesis", "benefit": "benefits",
    "earth": "earth", "engine": "engine",
}


def sin_acentos(texto):
    return "".join(c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn")


def terminos_en_ingles(texto):
    """Adds the technical terms of the glossary words that appear in the text."""
    extra = []
    for palabra in re.findall(r"\w+", sin_acentos(texto.lower())):
        for inicio, traduccion in GLOSARIO.items():
            if palabra.startswith(inicio):
                extra.append(traduccion)
    return " ".join(extra)


# Common English words that add nothing to the search and would match almost every fragment.
PALABRAS_VACIAS = set("""
a about after all also am an and any are as at be because been but by can could did do does
explain for from give had has have how i if in into is it its me more most my no not of on or
our please show so some such tell than that the their them then there these they this those to
up us was we were what when where which while who why will with would you your
""".split())


def construir_consulta(texto):
    """Turns free text into a safe query: "word1" OR "word2" ..."""
    palabras = [
        p for p in re.findall(r"\w+", texto.lower())
        if len(p) > 1 and sin_acentos(p) not in PALABRAS_VACIAS
    ]
    return " OR ".join(f'"{p}"' for p in dict.fromkeys(palabras))  # no repeats


def buscar(texto, limite=6, por_documento=2):
    """Returns the most relevant fragments as a list of dictionaries.
    Takes at most `por_documento` fragments from the same document,
    so that the answers combine several sources."""
    consulta = construir_consulta(f"{texto} {terminos_en_ingles(texto)}")
    if not consulta or not disponible():
        return []

    con = sqlite3.connect(RUTA_BD)
    try:
        filas = con.execute(
            """SELECT d.id, d.titulo, d.url, d.via, fragmentos.pagina, fragmentos.texto,
                      bm25(fragmentos)
               FROM fragmentos
               JOIN documentos AS d ON d.id = fragmentos.documento_id
               WHERE fragmentos MATCH ?
               ORDER BY bm25(fragmentos)
               LIMIT ?""",
            (consulta, limite * 5),  # ask for more, to be able to spread them among documents
        ).fetchall()
    finally:
        con.close()

    elegidos = []
    usados = {}
    for id_doc, titulo, url, via, pagina, texto, puntaje in filas:
        if usados.get(id_doc, 0) >= por_documento:
            continue
        usados[id_doc] = usados.get(id_doc, 0) + 1
        elegidos.append({
            "id_documento": id_doc, "titulo": titulo, "url": url, "via": via,
            "pagina": pagina, "texto": texto,
            "puntaje": puntaje,  # SQLite relevance: more negative = more relevant
        })
        if len(elegidos) == limite:
            break
    return elegidos


def catalogo():
    """Returns [(via, title), ...] for every document in the library."""
    if not disponible():
        return []
    con = sqlite3.connect(RUTA_BD)
    try:
        return con.execute("SELECT via, titulo FROM documentos ORDER BY titulo").fetchall()
    finally:
        con.close()


# Fields of a PSI investigation fact sheet, as written by scripts/psi_a_txt.py
CAMPOS_PSI = {
    "plataforma": r"Flight platform: ([^\n]+?)\.(?:\s|$)",
    "tipo_proyecto": r"Project type: ([^\n]+?)\.(?:\s|$)",
    "area": r"Research area: ([^\n]+?)\.(?:\s|$)",
    "inicio": r"Start date: ([\d-]+)",
    "fin": r"End date: ([\d-]+)",
    "equipo": r"Experiment hardware: ([^\n]+?)\.(?:\s|$)",
}


def detalles_psi(id_documento):
    """Reads the fact sheet (platform, dates, hardware...) of a PSI investigation.
    Returns {} if the document is not from PSI or does not have that data."""
    if not str(id_documento).startswith("psi_") or not disponible():
        return {}
    con = sqlite3.connect(RUTA_BD)
    try:
        filas = con.execute(
            "SELECT texto FROM fragmentos WHERE documento_id = ? ORDER BY orden", (id_documento,)
        ).fetchall()
    finally:
        con.close()
    texto = " ".join(fila[0] for fila in filas)
    detalles = {}
    for campo, patron in CAMPOS_PSI.items():
        encontrado = re.search(patron, texto)
        if encontrado:
            detalles[campo] = " ".join(encontrado.group(1).split())[:150]
    return detalles
