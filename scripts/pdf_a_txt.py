"""
pdf_a_txt.py - Downloads the official challenge PDFs and converts them to text.

Includes the Researcher's Guide (official challenge list) and the PDFs of the
experiments linked from the NASA Combustion Science page.
Each PDF is saved in data/pdf/ and its text in data/fuentes/<id>.txt,
keeping the page number of each part.

Before using it:
    pip install pypdf

Usage (from the project root folder, with the virtual environment active):
    python scripts/pdf_a_txt.py
"""

import sys
import urllib.error
import urllib.request
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:
    print("The pypdf library is missing. Install it with: pip install pypdf")
    sys.exit(1)

RAIZ = Path(__file__).resolve().parent.parent
CARPETA_PDF = RAIZ / "data" / "pdf"
CARPETA_FUENTES = RAIZ / "data" / "fuentes"

CABECERAS = {"User-Agent": "FireSpace/0.1 (student prototype, NASA Space Apps Challenge)"}

COMBUSTION_SCIENCE = "NASA Combustion Science"
BASE = "https://www.nasa.gov/wp-content/uploads/2025/07/"

# id: file name | pdf: where it is downloaded from | url: link shown as the source
# via: which challenge source this document is reached from
FUENTES_PDF = [
    {
        "id": "guia_investigador",
        "titulo": "A Researcher's Guide to: Combustion Science",
        "pdf": "https://www.nasa.gov/wp-content/uploads/2016/05/np-2015-10-034-jsc_combustion_in_reduced_gravity-iss-mini-book-011116-508.pdf",
        "url": "https://www.nasa.gov/missions/station/a-researchers-guide-to-combustion-science/",
        "via": "Official challenge list",
        "anio": "2015",
    },
    {"id": "exp_acme", "titulo": "Advanced Combustion via Microgravity Experiments (ACME)",
     "pdf": BASE + "advanced-combustion-via-microgravity-experiments-acme.pdf", "via": COMBUSTION_SCIENCE},
    {"id": "exp_bass", "titulo": "Burning and Suppression of Solids (BASS)",
     "pdf": BASE + "burning-and-suppression-of-solids-bass.pdf", "via": COMBUSTION_SCIENCE},
    {"id": "exp_daft", "titulo": "Dust and Aerosol Measurement Feasibility Test (DAFT)",
     "pdf": BASE + "dust-and-aerosol-measurement-feasibility-test-daft.pdf", "via": COMBUSTION_SCIENCE},
    {"id": "exp_flex", "titulo": "Flame Extinguishment Experiment (FLEX)",
     "pdf": BASE + "flame-extinguishment-experiment-flex.pdf", "via": COMBUSTION_SCIENCE},
    {"id": "exp_saffire", "titulo": "Spacecraft Fire Safety Demonstration (Saffire)",
     "pdf": BASE + "spacecraft-fire-safety-demonstration-saffire.pdf", "via": COMBUSTION_SCIENCE},
    {"id": "exp_same", "titulo": "Smoke Aerosol Measurement Experiment (SAME)",
     "pdf": BASE + "smoke-aerosol-measurement-experiment-same.pdf", "via": COMBUSTION_SCIENCE},
    {"id": "exp_slice", "titulo": "Structure & Liftoff in Combustion Experiment (SLICE)",
     "pdf": BASE + "structure-liftoff-in-combustion-experiment-slice.pdf", "via": COMBUSTION_SCIENCE},
    {"id": "exp_spice", "titulo": "Smoke Point in Co-flow Experiment (SPICE)",
     "pdf": BASE + "smoke-point-in-co-flow-experiment-spice.pdf", "via": COMBUSTION_SCIENCE},
]


def descargar(url, destino):
    """Downloads the PDF. Raises ValueError if what was received is not a PDF."""
    peticion = urllib.request.Request(url, headers=CABECERAS)
    with urllib.request.urlopen(peticion, timeout=60) as respuesta:
        contenido = respuesta.read()
    if not contenido.startswith(b"%PDF"):
        raise ValueError("the download is not a PDF")
    destino.write_bytes(contenido)


def convertir(ruta_pdf, fuente):
    """Extracts the text page by page and writes the .txt with its header."""
    lector = PdfReader(ruta_pdf)
    lineas = [
        f"TITULO: {fuente['titulo']}",
        f"URL: {fuente.get('url', fuente['pdf'])}",
        f"VIA: {fuente['via']}",
    ]
    if fuente.get("anio"):
        lineas.append(f"ANIO: {fuente['anio']}")
    lineas.append("---")

    con_texto = 0
    for numero, pagina in enumerate(lector.pages, start=1):
        texto = (pagina.extract_text() or "").strip()
        if texto:
            con_texto += 1
        lineas.append(f"=== PAGINA {numero} ===")
        lineas.append(texto)

    (CARPETA_FUENTES / f"{fuente['id']}.txt").write_text("\n".join(lineas), encoding="utf-8")
    return len(lector.pages), con_texto


def main():
    CARPETA_PDF.mkdir(parents=True, exist_ok=True)
    CARPETA_FUENTES.mkdir(parents=True, exist_ok=True)

    for fuente in FUENTES_PDF:
        ruta_pdf = CARPETA_PDF / f"{fuente['id']}.pdf"

        if not ruta_pdf.exists():
            try:
                descargar(fuente["pdf"], ruta_pdf)
            except (urllib.error.URLError, TimeoutError, ValueError) as e:
                print(f"  {fuente['id']}: COULD NOT DOWNLOAD ({e})")
                print(f"      Download it manually from {fuente['pdf']}")
                print(f"      and save it as {ruta_pdf}")
                continue

        try:
            paginas, con_texto = convertir(ruta_pdf, fuente)
        except Exception as e:  # pypdf can raise several kinds of errors with damaged PDFs
            print(f"  {fuente['id']}: COULD NOT READ THE PDF ({e}). Delete it and run again.")
            continue

        aviso = "  <- careful: no text, it may be images only" if con_texto == 0 else ""
        print(f"  {fuente['id']}: {paginas} pages ({con_texto} with text){aviso}")

    print("\nDone. Now run: python scripts/ingestar_fuentes.py")


if __name__ == "__main__":
    main()
