"""
psi_a_txt.py - Downloads the combustion investigations from NASA's PSI repository
and saves them as sources for the FireSpace library.

It uses the same public address the PSI page uses to show its results.
It creates a file data/fuentes/psi_<number>.txt for each investigation in the
"Combustion Science" area, and saves the original response in data/psi/investigaciones.json.

Usage (from the project root folder, with the virtual environment active):
    python scripts/psi_a_txt.py
Then:
    python scripts/ingestar_fuentes.py
"""

import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CARPETA_FUENTES = RAIZ / "data" / "fuentes"
CARPETA_PSI = RAIZ / "data" / "psi"

URL_API = "https://psi.nasa.gov/geode-py/ws/repo/search"
PARAMETROS = {
    "term": "combustion",
    "source": "psi",
    "type": "investigation",
    "sort": "Public Release Date",
    "order": "desc",
}

# Link shown as the source of each investigation.
# If you find the direct address of a study page in PSI,
# change this template ({acc} is replaced by the number, e.g. PSI-69).
URL_ESTUDIO = "https://psi.nasa.gov/physci/repo/data/investigations/{acc}"
AREA_BUSCADA = "Combustion Science"

CABECERAS = {
    "User-Agent": "FireSpace/0.1 (student prototype, NASA Space Apps Challenge)",
    "Accept": "application/json",
}

# Text fields that are saved, with the title each section will have.
SECCIONES = [
    ("Objectives", "Objectives"),
    ("Approach", "Approach"),
    ("Hypothesis", "Hypothesis"),
    ("Research Impacts/Earth Benefits", "Research impacts and Earth benefits"),
]


def descargar(parametros_extra=None):
    parametros = dict(PARAMETROS, **(parametros_extra or {}))
    url = f"{URL_API}?{urllib.parse.urlencode(parametros)}"
    peticion = urllib.request.Request(url, headers=CABECERAS)
    with urllib.request.urlopen(peticion, timeout=60) as respuesta:
        return json.loads(respuesta.read().decode("utf-8"))


def obtener_investigaciones():
    """Downloads the results; if they are incomplete, it tries to request more per page."""
    datos = descargar()
    total = datos["hits"]["total"]
    if len(datos["hits"]["hits"]) < total:
        try:
            mas = descargar({"size": 100})
            if len(mas["hits"]["hits"]) > len(datos["hits"]["hits"]):
                datos = mas
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError):
            pass
    return datos, total


def texto(valor):
    return str(valor or "").strip()


def construir_txt(inv):
    """Builds the content of the .txt (header + body) of an investigation."""
    acc = texto(inv.get("Accession"))
    titulo = texto(inv.get("Title"))
    sigla = texto(inv.get("Acronym"))
    titulo_completo = f"{titulo} ({sigla})" if sigla else titulo

    datos_generales = [
        f"PSI investigation {acc}: {titulo_completo}.",
        f"Research area: {texto(inv.get('Research Area'))}"
        + (f", {texto(inv.get('SubResearch Area'))}." if texto(inv.get("SubResearch Area")) else "."),
    ]
    for campo, etiqueta in [
        ("Project Type", "Project type"),
        ("Flight Platform", "Flight platform"),
        ("Monitoring Center", "Monitoring center"),
        ("Investigation Start Date", "Start date"),
        ("Investigation End Date", "End date"),
    ]:
        if texto(inv.get(campo)):
            datos_generales.append(f"{etiqueta}: {texto(inv.get(campo))}.")
    palabras = " ".join(texto(inv.get("Keywords")).split())
    if palabras:
        datos_generales.append(f"Keywords: {palabras}.")
    equipo = texto((inv.get("Experiment Hardware") or {}).get("Name"))
    if equipo:
        datos_generales.append(f"Experiment hardware: {' '.join(equipo.split())}.")

    lineas = [
        f"TITULO: {titulo_completo} [{acc}]",
        f"URL: {URL_ESTUDIO.format(acc=urllib.parse.quote(acc))}",
        "VIA: PSI",
        "---",
        " ".join(datos_generales),
        "",
    ]
    for campo, etiqueta in SECCIONES:
        contenido = texto(inv.get(campo))
        if contenido:
            lineas.append(f"{etiqueta}: {contenido}")
            lineas.append("")
    return acc, "\n".join(lineas)


def main():
    CARPETA_FUENTES.mkdir(parents=True, exist_ok=True)
    CARPETA_PSI.mkdir(parents=True, exist_ok=True)

    try:
        datos, total = obtener_investigaciones()
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"Could not connect to PSI: {e}")
        return
    except (json.JSONDecodeError, KeyError):
        print("PSI returned something unexpected (not the usual format).")
        return

    (CARPETA_PSI / "investigaciones.json").write_text(
        json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    resultados = [h.get("_source", {}) for h in datos["hits"]["hits"]]
    guardadas = 0
    otras_areas = []
    for inv in resultados:
        if texto(inv.get("Research Area")) != AREA_BUSCADA:
            otras_areas.append(texto(inv.get("Accession")))
            continue
        acc, contenido = construir_txt(inv)
        nombre = "psi_" + acc.lower().replace("psi-", "")
        (CARPETA_FUENTES / f"{nombre}.txt").write_text(contenido, encoding="utf-8")
        guardadas += 1
        print(f"  {nombre}.txt  ->  {inv.get('Title')}")

    print("-" * 60)
    print(f"PSI reports {total} results; {len(resultados)} were received.")
    if len(resultados) < total:
        print(f"  Careful: {total - len(resultados)} were missing. Let the team know to find how to request them.")
    if otras_areas:
        print(f"  Skipped because they are not from {AREA_BUSCADA}: {', '.join(otras_areas)}")
    print(f"Combustion investigations saved: {guardadas}")
    print("\nNow run: python scripts/ingestar_fuentes.py")


if __name__ == "__main__":
    main()
