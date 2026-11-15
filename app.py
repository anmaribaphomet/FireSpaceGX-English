import json
import math
import os
import re
import time
from collections import Counter

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from openai import OpenAI

import biblioteca

load_dotenv(override=True)
# the .env file always wins, even if the terminal has old values


def setting(name, legacy_name, default):
    """Reads a setting from .env. The Spanish names of the original project are still accepted."""
    return os.getenv(name) or os.getenv(legacy_name) or default


app = Flask(__name__)

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY"),
    timeout=45,       # maximum seconds to wait for each request
    max_retries=0,    # no hidden retries: if it fails, the user is told right away
)

# ---------- ASSISTANT SETTINGS ----------

# AI model: can be changed in the .env file with the line AI_MODEL=...
MODELO = setting("AI_MODEL", "MODELO_IA", "openrouter/free")
MAX_CARACTERES_PREGUNTA = 800
FRAGMENTOS_POR_PREGUNTA = 6
MAX_TOKENS_CLASIFICAR = 300     # enough room even for models that "think" before answering
MAX_TOKENS_RESPUESTA = 2200     # includes the dashboard design

# Conversation memory: the browser only sends the previous exchange
# (the previous question and its answer), to understand questions like "and why is that?".
MAX_MENSAJES_HISTORIAL = 2        # 1 question + 1 answer
MAX_CARACTERES_POR_MENSAJE = 700
PALABRAS_PREGUNTA_CORTA = 4       # questions this short usually depend on the previous one ("and why?")

# Words that show the question refers to something said before
PATRON_SEGUIMIENTO = re.compile(
    r"^(and|so|but|then)\b|\b(that|this|those|these|it|its|there|also|the same|same experiment|"
    r"that experiment|this experiment|the previous|mentioned)\b"
)


def depende_de_la_anterior(pregunta):
    """True if the question seems to continue the previous one ("and why is that?", "what materials did that experiment use?")."""
    texto = biblioteca.sin_acentos(pregunta.lower()).strip(" ¿?¡!.,")
    return len(texto.split()) <= PALABRAS_PREGUNTA_CORTA or bool(PATRON_SEGUIMIENTO.search(texto))

# Internal reasoning of the model ("thinking" before answering). "none" turns it off:
# faster answers and no risk of the model spending all its tokens thinking.
# Can be changed in .env with AI_REASONING=low (or medium). With "model" the setting is not sent.
RAZONAMIENTO = setting("AI_REASONING", "RAZONAMIENTO_IA", "none").strip().lower()
enviar_ajuste_razonamiento = RAZONAMIENTO not in ("", "model", "modelo")

# Saving mode: with CLASSIFY_WITH_AI=no in .env, each question uses 1 AI request instead of 2.
# Greetings are detected with patterns and the search only uses the glossary in biblioteca.py.
CLASIFICAR_CON_IA = setting("CLASSIFY_WITH_AI", "CLASIFICAR_CON_IA", "yes").strip().lower() not in ("no", "false", "0")

PATRON_CONVERSACION = re.compile(
    r"^(hi|hello|hey|hiya|howdy|greetings|good (morning|afternoon|evening)|thanks|thank you|many thanks|"
    r"whats up|what's up|how are you)\b"
    r"|who are you|what are you|tell me about yourself|introduce yourself"
    r"|what (can|do) you (do|know)|what (topics )?can you (talk|help) (about|with)|what do you talk about"
    r"|where do you get|your sources|how do you work"
    r"|are you (from |made by |an official product of |a product of )?nasa|can you (search|browse) (the )?(internet|web)"
    r"|what can i ask|can i ask you|help me|how can you help"
    r"|who (created|made|built|developed|programmed) you|who are your|your creators"
    r"|chatgpt|gemini|other ais?\b|other assistants?|difference between you"
    r"|your topic|what is (this|firespace|this page|this site) about|what is firespace"
)

PERSONALIDAD = """Personality of the FireSpace assistant:
- You are warm, friendly and enthusiastic, like a friend who loves space and enjoys sharing that curiosity. You are always respectful and never make fun of anyone.
- By default you speak simply, so anyone can understand you without a science background: short sentences, everyday words, comparisons with everyday things, and you explain every technical term in a few words the first time you use it.
- You only get technical if the person writes in technical language or says they are a student, researcher or engineer in the field.
- Match the person's tone: if they write casually, with laughter or slang, answer in the same relaxed tone; if they write formally, answer formally.
- You may use an emoji now and then (for example 🔥, 🚀, 😮), without overdoing it and never in technical answers.
- Your topic is combustion in space and fire safety in space exploration; you always bring the conversation back to it naturally."""

PROMPT_CLASIFICAR = (
    "Analyze the user's message.\n"
    "- If it is small talk (greetings, thanks, how are you), a reaction or expression "
    "(surprise, laughter, amazement, such as \"wow\", \"lol\", \"no way\", \"omg\") or a question about "
    "the assistant, FireSpace or its sources (who are you, what can you do, what topics you cover, "
    "how you work, where your information comes from), answer exactly: META\n"
    "- Otherwise, turn it into 5 to 10 English keywords to search "
    "NASA technical documents about combustion. Include technical synonyms and experiment "
    "names if they are mentioned. If the question is broad (for example, fun facts), "
    "choose general and varied terms from the field. If a previous question is included, use it only to "
    "understand what the current message refers to (for example, \"that\" or \"that experiment\"). "
    "Answer ONLY with the words separated by spaces."
)

PROMPT_RESPUESTA = PERSONALIDAD + """

You answer based on the numbered fragments from official NASA sources that you are given.
Mandatory rules:
1. Every concrete fact (figures, results, test conditions, names and goals of experiments, dates, historical facts and NASA conclusions) must come from the fragments and carry its citation in square brackets, for example [2] or [1][3].
2. You may use general scientific knowledge to explain basic concepts, connect ideas, compare, reason or suggest, as a good teacher would. Those parts carry no citation and must be presented as explanation or reasoning, never as a NASA result.
3. Never make up data, figures, results, dates, authors, publications or links. If the question asks for something that is not in the fragments, say so naturally, for example: "I don't have information about...".
4. If the question starts from a wrong idea, correct it based on the sources.
5. Follow the personality described above: by default, explain in a friendly and simple way for anyone; if the question is technical, answer with the precision a researcher or aerospace engineer would expect. Get to the point: the length must match the question, and a simple question deserves a short answer.
6. Answer in English.
7. Write as if you were explaining directly, in your own words. Never mention where the information comes from with phrases like "the sources", "the fragments", "the documents", "the text" or "the information provided": the citations in brackets already show the origin and the user does not know which documents you received. Write in plain text, without Markdown (no asterisks or hash signs); use hyphens for lists.
8. There may be previous messages in the conversation. Use them only to understand what the current question refers to (for example, "that" or "that experiment"). Data and citations must come only from the fragments of this question.
9. When you finish your answer, write a line that says exactly ###PANEL### and below it a JSON (no extra text and no backticks) that designs a visual dashboard ABOUT THE TOPIC of the question (not about the sources), so it can be understood at a glance. Choose 3 to 5 blocks that best fit the information and vary the types and order depending on the topic; include a "grafica" whenever there are comparable figures or categories. The JSON keys and block type names below are fixed identifiers and must be used exactly as written, but ALL the text values you write (titles, labels, descriptions) must be in English. Available block types:
- "kpis": main indicators. items: [{"icono": "💧", "valor": "1–5 mm", "titulo": "Droplet diameter", "detalle": "Hardware range"}]
- "grafica": "subtipo" = "barras" (bars), "barras_horizontales" (horizontal bars), "lineas" (lines), "dona" (doughnut) or "radar"; "unidad" (unit); "etiquetas" (labels): ["A", "B"]; "series": [{"nombre": "...", "valores": [1, 5]}] (values are numbers, one per label)
- "pasos": how a process works, step by step. items: [{"titulo": "Ignition", "detalle": "..."}]
- "comparacion": experiments or elements to compare. items: [{"nombre": "FLEX", "resumen": "Flammability and extinction", "detalles": [{"campo": "Goal", "valor": "..."}]}]
- "lista": points with an icon (for example, importance or applications). items: [{"icono": "🚀", "titulo": "...", "texto": "..."}]
- "linea_tiempo": timeline. items: [{"fecha": "2010", "titulo": "...", "texto": "..."}]
- "tabla": table. "columnas": ["..."], "filas": [["...", "..."]]
- "dato": a highlighted fun fact. "icono", "texto"
Format: {"titulo": "short title of the topic", "bloques": [{"tipo": "kpis", "titulo": "...", "citas": [2], "items": [...]}, ...]}
Every block must include "citas" with the numbers of the fragments its information comes from. Everything you put on the dashboard must be backed by the fragments; never make up values. Short texts in plain language."""

PROMPT_META = PERSONALIDAD + """

You are now chatting. Answer naturally and briefly, exactly to what the person says or asks.
Rules:
1. To talk about yourself, FireSpace or your sources, use ONLY the information in the FACT SHEET. Do not make up capabilities, sources or data.
2. If it is a greeting, thanks or small talk, answer briefly and kindly, and invite the person to ask about combustion in space with an example.
2b. If it is a reaction or expression (surprise, laughter, amazement, such as "wow", "no way", "omg" or "lol"), react with the same energy and connect it with the last thing you talked about: you may recall in your own words something from your previous answer or invite them to continue with a related question. If there is no previous conversation, react warmly and ask what surprised them. Never treat an expression as if it were a name or an unknown word.
3. If you are asked to explain your topic simply (for example, to a child), describe it in simple words using only what the FACT SHEET says, without adding scientific data.
4. If they ask about something unrelated to FireSpace and combustion in space, kindly explain that it is not your topic and suggest two or three questions you can answer.
5. Do not add new scientific data here (you may only recall what you already said in the conversation). If you are asked a scientific question, invite the person to ask it directly so you can answer with sources. If the message seems to continue the previous conversation but you have no information to answer it, kindly ask them to explain a bit more.
6. Answer in English, in plain text, without Markdown formatting.

FACT SHEET:
{ficha}"""

DESCRIPCION_FUENTES = {
    "PSI": "investigations from NASA's PSI (Physical Sciences Informatics) repository, which publishes "
           "the data of combustion experiments carried out on the International Space Station and on the ground",
    "NASA Combustion Science": "documents (experiment fact sheets and pages) linked from the "
                               "NASA Combustion Science page of the Glenn Research Center",
}

FUENTE_OFICIAL = "Official challenge list"

MENSAJE_LIMITE = (
    "The free AI request limit for today has been reached. "
    "Try again later or let the FireSpace team know."
)

MENSAJE_SIN_INFORMACION = (
    "I couldn't find information about this in the FireSpace library, which only contains "
    "official NASA sources from the challenge. Try asking about combustion in microgravity, "
    "ISS experiments or fire safety in spacecraft."
)

NOTA_SIN_CITAS = (
    "\n\nNote: this answer does not cite any source from the FireSpace library; "
    "take it as a general explanation."
)


# ---------- ASSISTANT FUNCTIONS ----------

def generar(mensajes, temperatura, max_tokens):
    """Calls the AI model and returns (text, model_name)."""
    global enviar_ajuste_razonamiento
    parametros = dict(model=MODELO, messages=mensajes, temperature=temperatura, max_tokens=max_tokens)
    inicio = time.perf_counter()

    if enviar_ajuste_razonamiento:
        ajuste = {"effort": RAZONAMIENTO}
        if RAZONAMIENTO != "none":
            ajuste["exclude"] = True  # let it think, but without returning its reasoning
        try:
            r = client.chat.completions.create(**parametros, extra_body={"reasoning": ajuste})
        except Exception as e:
            if "BadRequest" not in type(e).__name__:
                raise
            # This model does not accept the setting: retry without it and never send it again.
            print(f"[AI] The model does not accept the reasoning setting ({e}); retrying without it", flush=True)
            enviar_ajuste_razonamiento = False
            r = client.chat.completions.create(**parametros)
    else:
        r = client.chat.completions.create(**parametros)

    eleccion = r.choices[0]
    texto = (eleccion.message.content or "").strip()
    print(f"[AI] {r.model} answered in {time.perf_counter() - inicio:.1f} s "
          f"({len(texto)} characters, finish reason: {eleccion.finish_reason})", flush=True)
    return texto, r.model


def limpiar_historial(crudo):
    """Turns the history sent by the browser into safe messages for the AI.
    Only accepts the expected roles, trims the text and removes old citations [n],
    because those numbers referred to the sources of previous questions."""
    if not isinstance(crudo, list):
        return []
    mensajes = []
    for item in crudo[-MAX_MENSAJES_HISTORIAL:]:
        if not isinstance(item, dict):
            continue
        rol = item.get("rol")
        texto = str(item.get("texto", "")).strip()
        if rol not in ("usuario", "asistente") or not texto:
            continue
        texto = re.sub(r"\[\d+(?:\s*,\s*\d+)*\]", "", texto)
        texto = texto.replace(NOTA_SIN_CITAS.strip(), "").strip()
        mensajes.append({
            "role": "user" if rol == "usuario" else "assistant",
            "content": texto[:MAX_CARACTERES_POR_MENSAJE],
        })
    return mensajes


def ultima_pregunta(historial):
    for mensaje in reversed(historial):
        if mensaje["role"] == "user":
            return mensaje["content"]
    return ""


class LimiteDeUso(Exception):
    """The requests allowed by the AI provider have run out."""


def avisar_limite(error):
    """Shows in the terminal the exact reason given by OpenRouter."""
    print(f"[FireSpace] AI usage limit reached. Details: {error}", flush=True)


def es_limite_de_uso(error):
    return "RateLimit" in type(error).__name__ or "429" in str(error)


# Short reactions and expressions: they go straight to the conversation, without searching the library.
PATRON_REACCION = re.compile(
    r"^(ha(ha)*|he(he)*|lol+|lmao|rofl|xd+|wow+|whoa+|omg|no way|cool|awesome|amazing|incredible|"
    r"impressive|nice|great|crazy|insane|seriously|really|for real|ok|okay|got it|i see|interesting|"
    r"neat|sweet|damn|oh+|ah+|huh)\b"
)


def clasificar_sin_ia(pregunta):
    """Saving mode: detects small talk with patterns; the search will use the glossary."""
    texto = biblioteca.sin_acentos(pregunta.lower()).strip(" ¿?¡!.,")
    if PATRON_CONVERSACION.search(texto):
        return "META", ""
    if len(texto.split()) <= 4 and PATRON_REACCION.search(texto):
        return "META", ""
    return "BIBLIOTECA", ""


def clasificar(pregunta, anterior=""):
    """Returns ("META", "") if the message is about the assistant,
    or ("BIBLIOTECA", english_keywords) if it is a question to search in the sources."""
    try:
        texto, _ = generar(
            [{"role": "system", "content": PROMPT_CLASIFICAR},
             {"role": "user", "content": (f"Previous question (context only): {anterior}\n"
                                          f"Current message: {pregunta}") if anterior else pregunta}],
            temperatura=0,
            max_tokens=MAX_TOKENS_CLASIFICAR,
        )
    except Exception as e:
        if es_limite_de_uso(e):
            avisar_limite(e)
            raise LimiteDeUso() from e
        app.logger.exception("Could not classify the question")
        return "BIBLIOTECA", ""  # if it fails, search only with the original question
    if texto.strip().upper().startswith("META"):
        return "META", ""
    if not texto.strip():
        print("[FireSpace] The AI returned no keywords; the backup glossary is used", flush=True)
    return "BIBLIOTECA", texto


def siglas_de_experimentos(documentos):
    """Acronyms that appear in parentheses in the titles, e.g. "(FLEX)" -> FLEX."""
    siglas = set()
    for _, titulo in documentos:
        for sigla in re.findall(r"\(([A-Z][^)]*)\)", titulo):
            base = re.split(r"[-/ ]", sigla.strip())[0].upper()
            if len(base) >= 3:
                siglas.add(base)
    return sorted(siglas)


def ficha_del_asistente():
    """Real facts about the assistant and its library, so the AI can talk about itself without making things up."""
    documentos = biblioteca.catalogo()
    por_fuente = Counter(via or FUENTE_OFICIAL for via, _ in documentos)

    lineas_fuentes = []
    for fuente, n in por_fuente.most_common():
        if fuente in DESCRIPCION_FUENTES:
            lineas_fuentes.append(f"- {n} {DESCRIPCION_FUENTES[fuente]}.")
    for via, titulo in documentos:
        if via not in DESCRIPCION_FUENTES:
            origen = via or FUENTE_OFICIAL
            lineas_fuentes.append(f"- {titulo} ({origen}).")

    return "\n".join([
        "- Name: FireSpace assistant (ApiGx).",
        "- FireSpace is a web platform for outreach and scientific consultation about combustion in "
        "microgravity and fire safety in space exploration.",
        "- It is a project by university students for the NASA Space Apps Challenge 2026. "
        "It is not an official NASA product and is not affiliated with NASA.",
        "- It is designed for teachers, students, researchers and aerospace engineers, "
        "but anyone can use it.",
        "- How it works: for each question it searches its library for the most relevant texts, answers "
        "only with them and marks each fact with a number that links to the original document so the "
        "user can verify it. If the library does not have the information, it says so instead of making it up.",
        "- The sources are in English and the assistant answers in English.",
        "- It does not browse the internet or use information outside its library.",
        "- Difference from general AI assistants (like ChatGPT): FireSpace specializes in a single "
        "topic, answers based on official NASA sources and shows the links to verify "
        f"each fact. To write, it uses a language model ({MODELO}) through OpenRouter.",
        f"- Its library has {len(documentos)} documents, all from official NASA sources "
        "listed by the challenge:",
        *lineas_fuentes,
        f"- Experiments it covers: {', '.join(siglas_de_experimentos(documentos))}.",
        "- Topics: how flames behave without gravity, cool flames, fire extinction and suppression, "
        "flammability of materials, combustion of droplets, solids and gases, smoke and "
        "fire detection in spacecraft.",
    ])


AVISO_PRIMER_MENSAJE = (
    "\n\nIMPORTANT: this is the FIRST message of the conversation. There were no previous messages: "
    "do not say or imply that you already talked about something, and do not bring up topics \"from before\"."
)


def responder_conversacion(pregunta, historial=()):
    """Natural answer to greetings or questions about the assistant, based on the fact sheet."""
    sistema = PROMPT_META.format(ficha=ficha_del_asistente())
    if not historial:
        sistema += AVISO_PRIMER_MENSAJE  # keeps the AI from inventing a previous conversation
    try:
        texto, modelo = generar(
            [{"role": "system", "content": sistema},
             *historial,
             {"role": "user", "content": pregunta}],
            temperatura=0.4,
            max_tokens=600,
        )
        if texto:
            return texto, modelo
    except Exception as e:
        if es_limite_de_uso(e):
            avisar_limite(e)
        else:
            app.logger.exception("Could not generate the conversational answer")
    return respuesta_sobre_el_asistente(), None  # backup if the AI fails


def respuesta_sobre_el_asistente():
    """Describes what the assistant knows from the real library (not made up by the AI)."""
    documentos = biblioteca.catalogo()
    por_fuente = Counter(via or FUENTE_OFICIAL for via, _ in documentos)
    detalle = ", ".join(f"{n} from {fuente}" for fuente, n in por_fuente.most_common())

    experimentos = ", ".join(siglas_de_experimentos(documentos))

    return (
        "I'm the FireSpace assistant. I answer questions about combustion in space using "
        f"only a library of official NASA sources: {len(documentos)} documents "
        f"({detalle}).\n\n"
        "I can help you with topics like:\n"
        "- How flames behave without gravity (shape, cool flames, extinction).\n"
        "- Fire safety in spacecraft.\n"
        "- Combustion of fuel droplets, solid materials and gases on the Space Station.\n"
        "- Smoke and fire detection in space.\n"
        + (f"- NASA experiments: {experimentos}.\n" if experimentos else "")
        + "\nTry questions like \"What is the Saffire experiment?\" or "
        "\"Why are flames spherical in microgravity?\". "
        "If something is not in my sources, I'll tell you instead of making it up."
    )


def validar_citas(texto, total):
    """Removes citations that do not match any fragment and returns (text, cited)."""
    citados = set()

    def reemplazar(coincidencia):
        numeros = [int(n) for n in re.findall(r"\d+", coincidencia.group(1))]
        validos = [n for n in numeros if 1 <= n <= total]
        citados.update(validos)
        return "".join(f"[{n}]" for n in validos)

    # Accepts [2], [1][3] and also [1, 3]
    texto = re.sub(r"\[(\d+(?:\s*,\s*\d+)*)\]", reemplazar, texto)
    return texto, sorted(citados)


def limpiar_redaccion(texto):
    """Backup in case the AI mentions its internal sources ("according to the sources...").
    Removes those filler phrases at the start of sentences; the citations [n] already show the origin."""
    referencia = (r"(?:the sources|the fragments|the documents|the texts|the (?:provided|available) information|"
                  r"the information (?:provided|available))(?: (?:from NASA|provided|consulted|available))?")
    muletilla = re.compile(r"(^|(?<=[.!?]\s)|(?<=\n))(?:According to|Based on|As stated in|As shown in) "
                           + referencia + r",?\s+(\w)", re.IGNORECASE)
    return muletilla.sub(lambda m: m.group(1) + m.group(2).upper(), texto)


def agrupar_fuentes(fragmentos, citados):
    """Joins into a single line the citations that point to the same document and the same page."""
    grupos = {}
    for n in citados:
        f = fragmentos[n - 1]
        clave = (f["url"], f["pagina"])
        if clave not in grupos:
            grupos[clave] = {"numeros": [], "fragmento": f}
        grupos[clave]["numeros"].append(n)
    return [
        {
            "id": ", ".join(str(n) for n in g["numeros"]),
            "titulo": g["fragmento"]["titulo"],
            "url": g["fragmento"]["url"],
            "fuente": describir_fuente(g["fragmento"]),
        }
        for g in grupos.values()
    ]


MARCA_PANEL = "###PANEL###"


def separar_panel(texto):
    """Splits the answer from the dashboard JSON. Returns (answer, dashboard_data)."""
    if MARCA_PANEL not in texto:
        return texto, {}
    respuesta, _, resto = texto.partition(MARCA_PANEL)
    inicio, fin = resto.find("{"), resto.rfind("}")
    datos = {}
    if inicio != -1 and fin > inicio:
        try:
            datos = json.loads(resto[inicio:fin + 1])
        except ValueError:
            print("[FireSpace] The AI returned an invalid dashboard JSON; it is ignored", flush=True)
    return respuesta.strip(), datos if isinstance(datos, dict) else {}


def numero_de_cita(valor, total):
    try:
        n = int(valor)
    except (TypeError, ValueError):
        return None
    return n if 1 <= n <= total else None


def corto(valor, maximo):
    """Clean, trimmed text (data from the AI is never used without cleaning)."""
    return " ".join(str(valor if valor is not None else "").split())[:maximo]


def lista_de(valor, maximo):
    return [x for x in valor[:maximo] if isinstance(x, dict)] if isinstance(valor, list) else []


def numero(valor):
    try:
        n = float(valor)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


SUBTIPOS_GRAFICA = {"barras", "barras_horizontales", "lineas", "dona", "radar"}


def validar_bloque(bloque, total):
    """Checks a dashboard block. Returns the clean block, or None if it is not usable.
    A block without valid citations is dropped: that way unsupported data never gets through."""
    if not isinstance(bloque, dict):
        return None
    citas = [n for n in (numero_de_cita(c, total) for c in (bloque.get("citas") or [])) if n]
    if not citas:
        return None
    tipo = bloque.get("tipo")
    limpio = {"tipo": tipo, "titulo": corto(bloque.get("titulo"), 80), "citas": citas}

    if tipo == "kpis":
        limpio["items"] = [
            {"icono": corto(i.get("icono"), 8), "valor": corto(i.get("valor"), 24),
             "titulo": corto(i.get("titulo"), 50), "detalle": corto(i.get("detalle"), 90)}
            for i in lista_de(bloque.get("items"), 6) if i.get("valor") and i.get("titulo")
        ]
    elif tipo == "pasos":
        limpio["items"] = [
            {"titulo": corto(i.get("titulo"), 60), "detalle": corto(i.get("detalle"), 180)}
            for i in lista_de(bloque.get("items"), 7) if i.get("titulo")
        ]
    elif tipo == "comparacion":
        limpio["items"] = [
            {"nombre": corto(i.get("nombre"), 40), "resumen": corto(i.get("resumen"), 80),
             "detalles": [{"campo": corto(d.get("campo"), 30), "valor": corto(d.get("valor"), 180)}
                          for d in lista_de(i.get("detalles"), 6) if d.get("campo") and d.get("valor")]}
            for i in lista_de(bloque.get("items"), 6) if i.get("nombre")
        ]
    elif tipo == "lista":
        limpio["items"] = [
            {"icono": corto(i.get("icono"), 8), "titulo": corto(i.get("titulo"), 60), "texto": corto(i.get("texto"), 200)}
            for i in lista_de(bloque.get("items"), 6) if i.get("titulo") or i.get("texto")
        ]
    elif tipo == "linea_tiempo":
        limpio["items"] = [
            {"fecha": corto(i.get("fecha"), 20), "titulo": corto(i.get("titulo"), 60), "texto": corto(i.get("texto"), 180)}
            for i in lista_de(bloque.get("items"), 8) if i.get("fecha") and i.get("titulo")
        ]
    elif tipo == "dato":
        texto = corto(bloque.get("texto"), 260)
        if not texto:
            return None
        limpio.update({"icono": corto(bloque.get("icono"), 8), "texto": texto})
        return limpio
    elif tipo == "tabla":
        columnas = [corto(c, 30) for c in (bloque.get("columnas") or [])[:5]] if isinstance(bloque.get("columnas"), list) else []
        filas = [[corto(celda, 70) for celda in fila] for fila in (bloque.get("filas") or [])[:8]
                 if isinstance(fila, list) and len(fila) == len(columnas)]
        if len(columnas) < 2 or not filas:
            return None
        limpio.update({"columnas": columnas, "filas": filas})
        return limpio
    elif tipo == "grafica":
        subtipo = bloque.get("subtipo") if bloque.get("subtipo") in SUBTIPOS_GRAFICA else "barras"
        etiquetas = [corto(e, 40) for e in (bloque.get("etiquetas") or [])[:12]] if isinstance(bloque.get("etiquetas"), list) else []
        series = []
        for serie in lista_de(bloque.get("series"), 3):
            valores = serie.get("valores")
            if isinstance(valores, list) and len(valores) == len(etiquetas):
                numeros = [numero(v) for v in valores]
                if all(n is not None for n in numeros):
                    series.append({"nombre": corto(serie.get("nombre"), 40), "valores": numeros})
        if len(etiquetas) < 2 or not series:
            return None
        limpio.update({"subtipo": subtipo, "unidad": corto(bloque.get("unidad"), 20),
                       "etiquetas": etiquetas, "series": series})
        return limpio
    else:
        return None

    return limpio if limpio["items"] else None


def construir_panel(pregunta, fragmentos, datos_ia):
    """Visual dashboard about the topic, designed by the AI and validated block by block."""
    bloques = [b for b in (validar_bloque(b, len(fragmentos)) for b in (datos_ia.get("bloques") or [])[:6]) if b]
    return {
        "consulta": pregunta,
        "titulo": corto(datos_ia.get("titulo"), 80) or pregunta[:80],
        "bloques": bloques,
    }


def describir_fuente(fragmento):
    texto = fragmento["via"] or FUENTE_OFICIAL
    if fragmento["pagina"]:
        texto += f", PDF page {fragmento['pagina']}"
    return texto


# ---------- PAGES ----------

@app.route("/")
def inicio():
    return render_template("inicio.html")


@app.route("/assistant")
def asistente():
    return render_template("asistente.html")


@app.route("/simulation")
def simulacion():
    return render_template("simulacion.html")


# ---------- API ----------

@app.route("/api/preguntar", methods=["POST"])
def preguntar():
    datos = request.get_json(silent=True) or {}
    pregunta = str(datos.get("pregunta", "")).strip()

    if not pregunta:
        return jsonify({"ok": False, "error": "Type a question."}), 400
    if len(pregunta) > MAX_CARACTERES_PREGUNTA:
        return jsonify({"ok": False, "error": f"The question cannot be longer than {MAX_CARACTERES_PREGUNTA} characters."}), 400
    if not biblioteca.disponible():
        return jsonify({"ok": False, "error": "The library is not ready yet."}), 503

    inicio = time.perf_counter()
    historial = limpiar_historial(datos.get("historial"))
    anterior = ultima_pregunta(historial)
    print(f"[FireSpace] Previous messages received: {len(historial)}"
          + (f" (previous question: {anterior[:60]!r})" if anterior else " (first message)"), flush=True)

    # 1. Is it a question about the assistant or a question for the sources?
    try:
        tipo, claves = clasificar(pregunta, anterior) if CLASIFICAR_CON_IA else clasificar_sin_ia(pregunta)
    except LimiteDeUso:
        return jsonify({"ok": False, "error": MENSAJE_LIMITE}), 429
    if tipo == "META":
        texto, modelo = responder_conversacion(pregunta, historial)
        return jsonify({"ok": True, "modelo": modelo, "respuesta": texto, "fuentes": []})

    # 2. Search the library (keywords + the original question)
    print(f"[FireSpace] Search keywords: {claves or '(none)'}", flush=True)
    texto_busqueda = f"{claves} {pregunta}"
    if anterior and depende_de_la_anterior(pregunta):
        texto_busqueda += f" {anterior}"  # "and why is that?" is searched together with the previous question
    fragmentos = biblioteca.buscar(texto_busqueda, FRAGMENTOS_POR_PREGUNTA)
    print(f"[FireSpace] Fragments found: {len(fragmentos)}", flush=True)

    # 3. Without documents there is no scientific answer: the question goes to chat mode,
    #    which answers about the assistant or kindly explains that the topic is not its own.
    if not fragmentos:
        texto, modelo = responder_conversacion(pregunta, historial)
        return jsonify({"ok": True, "modelo": modelo, "respuesta": texto, "fuentes": []})

    # 4. Ask for the answer using only the fragments found
    contexto = "\n\n".join(
        f"[{i}] (Document: {f['titulo']})\n{f['texto']}" for i, f in enumerate(fragmentos, start=1)
    )
    try:
        texto, modelo = generar(
            [{"role": "system", "content": PROMPT_RESPUESTA + ("" if historial else AVISO_PRIMER_MENSAJE)},
             *historial,
             {"role": "user", "content": f"Fragments:\n\n{contexto}\n\nQuestion: {pregunta}"}],
            temperatura=0.3,
            max_tokens=MAX_TOKENS_RESPUESTA,
        )
    except Exception as e:
        if es_limite_de_uso(e):
            avisar_limite(e)
            return jsonify({"ok": False, "error": MENSAJE_LIMITE}), 429
        app.logger.exception("Error while querying the model")
        if "Timeout" in type(e).__name__:
            return jsonify({"ok": False, "error": "The AI took too long to answer. Try again in a moment."}), 504
        return jsonify({"ok": False, "error": "Could not get an answer from the AI."}), 502

    if not texto:
        return jsonify({"ok": False, "error": "The AI returned an empty answer. "
                        "Try again; if it happens again, try another model."}), 502

    # 5. Validate the citations: only sources that were really given to the model are shown
    texto, datos_panel = separar_panel(texto)
    panel = construir_panel(pregunta, fragmentos, datos_panel)
    texto, citados = validar_citas(limpiar_redaccion(texto), len(fragmentos))
    if not citados:
        return jsonify({"ok": True, "modelo": modelo, "respuesta": texto + NOTA_SIN_CITAS,
                        "fuentes": [], "panel": panel})

    print(f"[FireSpace] Question answered in {time.perf_counter() - inicio:.1f} s", flush=True)
    # The sources the dashboard is based on are also listed, even if the text does not cite them
    citados = sorted(set(citados) | {n for b in panel["bloques"] for n in b["citas"]})
    fuentes = agrupar_fuentes(fragmentos, citados)
    return jsonify({"ok": True, "modelo": modelo, "respuesta": texto, "fuentes": fuentes, "panel": panel})


# ---------- INTERPRETATION OF THE 3D SIMULATION ----------

PROMPT_INTERPRETAR = """You are the FireSpace assistant and you analyze a simulated flame in the 3GX section.
You receive the conditions chosen by the user and numbered fragments from official NASA sources.

Mandatory rules:
1. Every concrete fact (figures, test ranges, results, observed behavior, experiment names) must come from the fragments and carry its citation in square brackets, for example [2] or [1][3]. Never make up data, figures or experiments.
2. The simulation values (size, temperature, shape, color) come from an illustrative model of the page, not from an experiment: say so if relevant and compare them with what the fragments report (for example, whether the chosen oxygen level is inside or outside the tested ranges).
3. If the fragments do not let you know something, say so naturally ("I don't have data about..."). You may use general scientific knowledge to explain concepts, without a citation and presented as explanation, never as a NASA result.
4. Answer in English, in plain text without Markdown (no asterisks or hash signs). Do not mention "the fragments" or "the sources": the citations already show the origin.
5. EXACT format:
LEVEL: low | moderate | high | no data
What it means: 2 to 4 sentences about how a flame like this would behave according to the research.
Is it dangerous?: 2 to 4 sentences, explaining why according to the research.
What to do: 2 to 4 hyphen bullets with safety or control actions (detection, ventilation, oxygen, suppression), each one backed by a citation when it comes from the research.
Be brief and concrete."""

COMBUSTIBLES_EN = {
    "n-decane": "decane", "ethanol": "ethanol", "n-heptane": "heptane",
    "n-hexanol": "hexanol", "methanol": "methanol",
}


def _numero_entre(valor, minimo, maximo, defecto):
    n = numero(valor)
    return defecto if n is None else max(minimo, min(maximo, n))


@app.route("/api/interpretar-llama", methods=["POST"])
def interpretar_llama():
    datos = request.get_json(silent=True) or {}
    if not biblioteca.disponible():
        return jsonify({"ok": False, "error": "The library is not ready yet."}), 503

    gravedad = _numero_entre(datos.get("gravedad"), 0, 1, 1)
    oxigeno = _numero_entre(datos.get("oxigeno"), 10, 40, 21)
    temperatura = _numero_entre(datos.get("temperatura"), 0, 3000, 0)
    tamano = _numero_entre(datos.get("tamano"), 1, 10, 5)
    diametro = _numero_entre(datos.get("diametro"), 0.1, 5, 0.6)
    forma = corto(datos.get("forma"), 80)
    color = corto(datos.get("color"), 80)
    compuestos = [
        {"nombre": corto(c.get("nombre"), 30), "fraccion": _numero_entre(c.get("fraccion"), 0, 1, 0)}
        for c in lista_de(datos.get("compuestos"), 6)
    ]
    compuestos = [c for c in compuestos if c["nombre"] and c["fraccion"] > 0]

    # Library search (in English, like the documents)
    terminos = ["flame", "fire", "microgravity" if gravedad < 0.5 else "buoyancy gravity",
                "oxygen concentration", "flammability limits", "extinction", "spacecraft fire safety"]
    if compuestos:
        terminos += ["FLEX-2", "droplet", "soot"]
        terminos += [COMBUSTIBLES_EN.get(c["nombre"].lower(), c["nombre"]) for c in compuestos]
    if oxigeno >= 28:
        terminos.append("elevated oxygen enriched atmosphere")
    fragmentos = biblioteca.buscar(" ".join(terminos), FRAGMENTOS_POR_PREGUNTA)
    if not fragmentos:
        return jsonify({"ok": False, "error": "I couldn't find research in the library for these conditions."}), 404

    condiciones = (
        f"- Gravity: {gravedad:.2f} g (0 = microgravity, 1 = Earth)\n"
        f"- Ambient oxygen: {oxigeno:.0f} %\n"
        f"- Flame size (1-10 scale): {tamano:.0f}; burner diameter: {diametro:.1f} cm\n"
        f"- Result of the illustrative model: shape {forma or 'no data'}, maximum temperature ~{temperatura:.0f} °C, color {color or 'no data'}\n"
        + ("- Fuel (PSI-68 / FLEX-2 compounds): "
           + ", ".join(f"{c['nombre']} {c['fraccion'] * 100:.0f} %" for c in compuestos)
           if compuestos else "- Fuel: generic hydrocarbon (no compound chosen)")
    )
    contexto = "\n\n".join(
        f"[{i}] (Document: {f['titulo']})\n{f['texto']}" for i, f in enumerate(fragmentos, start=1)
    )
    try:
        texto, modelo = generar(
            [{"role": "system", "content": PROMPT_INTERPRETAR},
             {"role": "user", "content": f"Chosen conditions:\n{condiciones}\n\nFragments:\n\n{contexto}"}],
            temperatura=0.2,
            max_tokens=MAX_TOKENS_RESPUESTA,
        )
    except Exception as e:
        if es_limite_de_uso(e):
            avisar_limite(e)
            return jsonify({"ok": False, "error": MENSAJE_LIMITE}), 429
        app.logger.exception("Error while interpreting the simulation")
        return jsonify({"ok": False, "error": "Could not get the AI interpretation."}), 502
    if not texto:
        return jsonify({"ok": False, "error": "The AI returned an empty answer. Try again."}), 502

    nivel = "no data"
    coincidencia = re.match(r"\s*LEVEL:\s*([^\n]+)", texto, re.IGNORECASE)
    if coincidencia:
        valor = coincidencia.group(1).lower()
        nivel = next((n for n in ("high", "moderate", "low") if n in valor), "no data")
        texto = texto[coincidencia.end():].strip()

    texto, citados = validar_citas(limpiar_redaccion(texto), len(fragmentos))
    return jsonify({
        "ok": True, "modelo": modelo, "nivel": nivel, "interpretacion": texto,
        "fuentes": agrupar_fuentes(fragmentos, citados) if citados else [],
        "sin_citas": not citados,
    })


if __name__ == "__main__":
    clave = os.getenv("OPENROUTER_API_KEY") or ""
    print(f"[FireSpace] Model: {MODELO} | Key ending in: ...{clave[-4:]} | "
          f"Classify with AI: {'yes' if CLASIFICAR_CON_IA else 'no (saving mode)'} | "
          f"Reasoning: {RAZONAMIENTO}", flush=True)
    app.run(port=5000, debug=False)
