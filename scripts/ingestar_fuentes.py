"""
ingestar_fuentes.py - Fills the FireSpace library ONLY with the challenge sources.

Reads every .txt file in data/fuentes/. Each file must start like this
(the header keys TITULO/URL/VIA/ANIO are fixed identifiers):

    TITULO: Title of the page or document
    URL: https://official-link-of-the-source
    VIA: NASA Combustion Science   (which challenge source it was reached from; optional)
    ANIO: 2015                     (year; optional)
    ---
    The text copied from the source goes here...

The text is split into fragments of ~1000 characters and saved in data/firespace.db.
Every time it runs, it REBUILDS the library from scratch.

Usage (from the project root folder, with the virtual environment active):
    python scripts/ingestar_fuentes.py
"""

import re
import sqlite3
import textwrap
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CARPETA_FUENTES = RAIZ / "data" / "fuentes"
RUTA_BD = RAIZ / "data" / "firespace.db"

TAM_FRAGMENTO = 1000   # approximate characters per fragment
MIN_FRAGMENTO = 40     # shorter fragments (e.g. a lone page number) are ignored

# Page marker written by pdf_a_txt.py, for example: === PAGINA 12 ===
MARCA_PAGINA = re.compile(r"^=== PAGINA (\d+) ===\s*$", re.MULTILINE)
SEPARADOR = re.compile(r"^\s*---\s*$", re.MULTILINE)


# ---------- READING FILES ----------

def leer_fuente(ruta):
    """Splits the header (TITULO, URL, ANIO) from the text. Raises ValueError if something is missing."""
    contenido = ruta.read_text(encoding="utf-8-sig")
    partes = SEPARADOR.split(contenido, maxsplit=1)
    if len(partes) < 2:
        raise ValueError("the --- line that separates the header from the text is missing")
    cabecera, cuerpo = partes

    datos = {}
    for linea in cabecera.splitlines():
        if ":" in linea:
            clave, valor = linea.split(":", 1)
            datos[clave.strip().upper()] = valor.strip()

    if not datos.get("TITULO") or not datos.get("URL"):
        raise ValueError("the header needs TITULO and URL")
    if not datos["URL"].startswith("https://"):
        raise ValueError("the URL must start with https://")
    return datos, cuerpo


# ---------- SPLITTING INTO FRAGMENTS ----------

def secciones_por_pagina(cuerpo):
    """Returns [(page, text), ...]. If the text has no page markers, page is None."""
    partes = MARCA_PAGINA.split(cuerpo)
    secciones = [(None, partes[0])]
    for i in range(1, len(partes), 2):
        secciones.append((int(partes[i]), partes[i + 1]))
    return secciones


def dividir_en_fragmentos(cuerpo):
    """Groups sentences up to ~TAM_FRAGMENTO characters, without mixing different pages."""
    fragmentos = []
    for pagina, texto in secciones_por_pagina(cuerpo):
        texto = re.sub(r"-\n(?=\w)", "", texto)    # joins split words: "combus-\ntion"
        texto = re.sub(r"\s+", " ", texto).strip()  # removes line breaks and extra spaces
        if not texto:
            continue

        actual = ""
        for oracion in re.split(r"(?<=[.!?])\s+", texto):
            # A huge "sentence" (without periods) is cut into pieces.
            for trozo in textwrap.wrap(oracion, TAM_FRAGMENTO) or [""]:
                if actual and len(actual) + len(trozo) + 1 > TAM_FRAGMENTO:
                    fragmentos.append((pagina, actual))
                    actual = trozo
                else:
                    actual = f"{actual} {trozo}".strip()
        if actual:
            fragmentos.append((pagina, actual))

    return [(p, t) for p, t in fragmentos if len(t) >= MIN_FRAGMENTO]


# ---------- DATABASE ----------

def fts5_disponible(con):
    try:
        con.execute("CREATE VIRTUAL TABLE temp.prueba_fts USING fts5(x)")
        con.execute("DROP TABLE temp.prueba_fts")
        return True
    except sqlite3.OperationalError:
        return False


def crear_tablas(con):
    con.executescript("""
        DROP TABLE IF EXISTS fragmentos;
        DROP TABLE IF EXISTS documentos;

        CREATE TABLE documentos (
            id            TEXT PRIMARY KEY,   -- file name, e.g. "apollo_1"
            titulo        TEXT NOT NULL,
            url           TEXT NOT NULL,
            anio          TEXT,
            via           TEXT,               -- challenge source it was reached from
            archivo       TEXT NOT NULL,
            fecha_ingesta TEXT
        );

        CREATE VIRTUAL TABLE fragmentos USING fts5(
            documento_id UNINDEXED,
            orden UNINDEXED,
            pagina UNINDEXED,
            texto,
            tokenize = 'porter unicode61'
        );
    """)


# ---------- MAIN PROGRAM ----------

def main():
    if not CARPETA_FUENTES.exists():
        CARPETA_FUENTES.mkdir(parents=True)
        print(f"Created the folder {CARPETA_FUENTES}. Put the source .txt files there and run again.")
        return

    archivos = sorted(CARPETA_FUENTES.glob("*.txt"))
    if not archivos:
        print(f"There are no .txt files in {CARPETA_FUENTES}.")
        return

    con = sqlite3.connect(RUTA_BD)
    try:
        if not fts5_disponible(con):
            print("Your SQLite version does not have FTS5. Let the team know so we can find another option.")
            return

        crear_tablas(con)
        print(f"Library reset at: {RUTA_BD}\n")

        documentos = 0
        total_fragmentos = 0
        for ruta in archivos:
            try:
                datos, cuerpo = leer_fuente(ruta)
            except ValueError as e:
                print(f"  {ruta.name}: SKIPPED ({e})")
                continue
            except UnicodeDecodeError:
                print(f"  {ruta.name}: SKIPPED (save it with UTF-8 encoding)")
                continue

            fragmentos = dividir_en_fragmentos(cuerpo)
            if not fragmentos:
                print(f"  {ruta.name}: SKIPPED (it has no text)")
                continue

            id_doc = ruta.stem
            con.execute(
                "INSERT INTO documentos (id, titulo, url, anio, via, archivo, fecha_ingesta) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (id_doc, datos["TITULO"], datos["URL"], datos.get("ANIO"),
                 datos.get("VIA", "Official challenge list"), ruta.name,
                 datetime.now(timezone.utc).isoformat(timespec="seconds")),
            )
            for orden, (pagina, texto) in enumerate(fragmentos):
                if orden == 0:
                    texto = f"{datos['TITULO']}\n\n{texto}"  # the title helps to find it
                con.execute(
                    "INSERT INTO fragmentos (documento_id, orden, pagina, texto) VALUES (?, ?, ?, ?)",
                    (id_doc, orden, pagina, texto),
                )

            documentos += 1
            total_fragmentos += len(fragmentos)
            print(f"  {ruta.name}: {len(fragmentos)} fragments  ->  {datos['TITULO']}")

        con.commit()
        print("-" * 60)
        print(f"Library ready: {documentos} documents, {total_fragmentos} fragments.")
    finally:
        con.close()


if __name__ == "__main__":
    main()
