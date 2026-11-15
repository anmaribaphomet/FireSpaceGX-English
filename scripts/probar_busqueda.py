"""
probar_busqueda.py - Tests the search inside the FireSpace library.

Searches data/firespace.db (created by ingestar_fuentes.py) and shows the
5 most relevant documents. This checks that retrieval works
before connecting it to the assistant.

Usage:
    python scripts/probar_busqueda.py "flame spread"
"""

import re
import sqlite3
import sys
from pathlib import Path

RUTA_BD = Path(__file__).resolve().parent.parent / "data" / "firespace.db"


def construir_consulta(texto):
    """Turns free text into a safe FTS5 query: "word1" OR "word2" ..."""
    palabras = [p for p in re.findall(r"\w+", texto.lower()) if len(p) > 1]
    return " OR ".join(f'"{p}"' for p in palabras)


def main():
    if len(sys.argv) < 2:
        print('Usage: python scripts/probar_busqueda.py "flame spread"')
        return
    if not RUTA_BD.exists():
        print("The library does not exist. First run: python scripts/ingestar_fuentes.py")
        return

    consulta = construir_consulta(" ".join(sys.argv[1:]))
    if not consulta:
        print("Type at least one search word.")
        return

    con = sqlite3.connect(RUTA_BD)
    try:
        filas = con.execute(
            """SELECT d.titulo, d.anio, d.url, fragmentos.pagina,
                      snippet(fragmentos, 3, '[', ']', '...', 20),
                      bm25(fragmentos) AS puntaje
               FROM fragmentos
               JOIN documentos AS d ON d.id = fragmentos.documento_id
               WHERE fragmentos MATCH ?
               ORDER BY puntaje
               LIMIT 5""",
            (consulta,),
        ).fetchall()
    finally:
        con.close()

    print(f"Query sent to SQLite: {consulta}\n")
    if not filas:
        print("No results in the library.")
        return

    for numero, (titulo, anio, url, pagina, fragmento, puntaje) in enumerate(filas, start=1):
        donde = f", PDF page {pagina}" if pagina else ""
        print(f"[{numero}] {titulo} ({anio or 'n.d.'}{donde})")
        print(f"    Relevance (more negative = more relevant): {puntaje:.3f}")
        print(f"    Excerpt: {fragmento}")
        print(f"    Fact sheet: {url}\n")


if __name__ == "__main__":
    main()
