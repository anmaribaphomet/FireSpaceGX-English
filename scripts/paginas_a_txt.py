"""
paginas_a_txt.py - Downloads the web pages of the challenge sources and saves
only the paragraphs of the article (no menus or footers) in data/fuentes/.

If a file already exists, it is NOT overwritten (in case you fixed it by hand).
To regenerate it, delete it and run the script again.

Usage (from the project root folder, with the virtual environment active):
    python scripts/paginas_a_txt.py
Then:
    python scripts/ingestar_fuentes.py
"""

import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CARPETA_FUENTES = RAIZ / "data" / "fuentes"

CABECERAS = {"User-Agent": "Mozilla/5.0 (FireSpace, student prototype NASA Space Apps Challenge)"}

CS = "https://www.nasa.gov/glenn/glenn-expertise-space-exploration/physical-sciences-program/"

# via = None means the page is directly on the official challenge list.
PAGINAS = [
    {"id": "web_combustion_science", "titulo": "NASA Combustion Science", "via": None,
     "url": CS + "combustion-science/"},
    {"id": "web_fm2", "titulo": "Flammability of Materials on the Moon (FM2)", "via": "NASA Combustion Science",
     "url": CS + "combustion-science/flammability-of-materials-on-the-moon-fm2/"},
    {"id": "web_sofie", "titulo": "Solid Fuel Ignition and Extinction (SoFIE)", "via": "NASA Combustion Science",
     "url": CS + "combustion-science/solid-fuel-ignition-and-extinction-sofie/"},
    {"id": "web_flare", "titulo": "Flammability Limits At Reduced-g Experiment (FLARE)", "via": "NASA Combustion Science",
     "url": CS + "combustion-science/flammability-limits-at-reduced-g-experiment-flare/"},
    {"id": "web_mdca", "titulo": "Multi-user Droplet Combustion Apparatus (MDCA)", "via": "NASA Combustion Science",
     "url": CS + "combustion-science/multi-user-droplet-combustion-apparatus-mdca/"},
    {"id": "web_cir", "titulo": "Fluids and Combustion Facility / Combustion Integrated Rack (CIR)",
     "via": "NASA Combustion Science", "url": CS + "fluids-combustion-facility/"},
    {"id": "web_apollo_1", "titulo": "Apollo 1", "via": None,
     "url": "https://sma.nasa.gov/sma-disciplines/accllp/apollo-1"},
    {"id": "web_apollo_13", "titulo": "Apollo 13", "via": None,
     "url": "https://sma.nasa.gov/sma-disciplines/accllp/apollo-13"},
    {"id": "web_mir", "titulo": "25 Years Ago: Fire Aboard Space Station Mir", "via": None,
     "url": "https://www.nasa.gov/history/25-years-ago-fire-aboard-space-station-mir/"},
    {"id": "web_spinoff_tanques_aire", "titulo": "Fireman's Air Tanks (NASA Spinoff)", "via": None,
     "url": "https://spinoff.nasa.gov/node/9582"},
    {"id": "web_spinoff_detector", "titulo": "Fire Detector (NASA Spinoff)", "via": None,
     "url": "https://spinoff.nasa.gov/node/9407"},
    {"id": "web_spinoff_traje", "titulo": "New Technology for the Fire Attire (NASA Spinoff)", "via": None,
     "url": "https://spinoff.nasa.gov/node/9918"},
]

MIN_PARRAFO = 60          # shorter paragraphs are usually buttons, dates or menus
MIN_ELEMENTO_LISTA = 80   # menu items are short; article bullets are long
MIN_TEXTO_PAGINA = 200    # if less is extracted, the page probably needs a manual copy

FRASES_DE_RELLENO = [
    "NASA explores the unknown",
    "Was this page helpful",
    "An official website of the United States government",
    "Official websites use .gov",
    "Secure .gov websites use HTTPS",
]
TITULOS_DE_CORTE = {"keep exploring", "discover more topics from nasa"}


class ExtractorParrafos(HTMLParser):
    """Walks the HTML and gathers the text of paragraphs, bullets and cells,
    ignoring scripts, menus, headers and footers."""

    IGNORAR = {"script", "style", "nav", "header", "footer", "aside", "form", "noscript", "svg"}
    BLOQUES = {"p", "li", "td"}
    TITULOS = {"h1", "h2", "h3", "h4"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ignorando = 0
        self.etiqueta = None
        self.actual = None
        self.bloques = []
        self.detenido = False

    def _cerrar_bloque(self):
        if self.actual is not None:
            texto = " ".join("".join(self.actual).split())
            if self.etiqueta in self.TITULOS:
                if texto.lower() in TITULOS_DE_CORTE:
                    self.detenido = True  # from here on there are only links to other news
            elif not self.detenido:
                self.bloques.append((self.etiqueta, texto))
        self.actual = None
        self.etiqueta = None

    def handle_starttag(self, tag, attrs):
        if tag in self.IGNORAR:
            self.ignorando += 1
        elif not self.ignorando and (tag in self.BLOQUES or tag in self.TITULOS):
            if self.actual is not None and tag == self.etiqueta:
                self._cerrar_bloque()  # a new <p> without closing the previous one
            if self.actual is None:
                self.etiqueta = tag
                self.actual = []

    def handle_endtag(self, tag):
        if tag in self.IGNORAR and self.ignorando:
            self.ignorando -= 1
        elif tag == self.etiqueta:
            self._cerrar_bloque()

    def handle_data(self, data):
        if self.actual is not None and not self.ignorando:
            self.actual.append(data)


def extraer_texto(html):
    extractor = ExtractorParrafos()
    extractor.feed(html)
    extractor._cerrar_bloque()

    parrafos = []
    vistos = set()
    for etiqueta, texto in extractor.bloques:
        minimo = MIN_ELEMENTO_LISTA if etiqueta == "li" else MIN_PARRAFO
        if len(texto) < minimo or texto in vistos:
            continue
        if any(frase in texto for frase in FRASES_DE_RELLENO):
            continue
        vistos.add(texto)
        parrafos.append(texto)
    return "\n\n".join(parrafos)


def descargar(url):
    peticion = urllib.request.Request(url, headers=CABECERAS)
    with urllib.request.urlopen(peticion, timeout=60) as respuesta:
        codificacion = respuesta.headers.get_content_charset() or "utf-8"
        return respuesta.read().decode(codificacion, errors="replace")


def main():
    CARPETA_FUENTES.mkdir(parents=True, exist_ok=True)
    revisar = []

    for pagina in PAGINAS:
        destino = CARPETA_FUENTES / f"{pagina['id']}.txt"
        if destino.exists():
            print(f"  {destino.name}: already exists, left as is (delete it to regenerate it)")
            continue

        try:
            texto = extraer_texto(descargar(pagina["url"]))
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"  {destino.name}: COULD NOT DOWNLOAD ({e})")
            revisar.append(pagina)
            continue

        if len(texto) < MIN_TEXTO_PAGINA:
            print(f"  {destino.name}: only {len(texto)} characters were extracted, NOT saved")
            revisar.append(pagina)
            continue

        cabecera = [f"TITULO: {pagina['titulo']}", f"URL: {pagina['url']}"]
        if pagina["via"]:
            cabecera.append(f"VIA: {pagina['via']}")
        destino.write_text("\n".join(cabecera + ["---", texto]), encoding="utf-8")
        print(f"  {destino.name}: {len(texto)} characters")

    print("-" * 60)
    if revisar:
        print("These pages must be copied by hand (open the link and paste the article text):")
        for pagina in revisar:
            print(f"  - {pagina['id']}.txt  <-  {pagina['url']}")
    print("Check the .txt files created: if any has text that is not from the article, delete it from that file.")
    print("Then run: python scripts/ingestar_fuentes.py")


if __name__ == "__main__":
    main()
