/* =====================================================================
   FireSpace GX · AI Assistant (ApiGx)
   Conversation logic:
     - POST /api/preguntar with {pregunta, historial}
     - memory of the last exchange in sessionStorage
     - cited sources with a link to the original document
   Also:
     - the "panel" dashboard designed by the AI on the server (`panel` field
       of /api/preguntar: {titulo, bloques}) is drawn at the top of the dashboard
       and remembered in sessionStorage (firespace_panel)
     - below it, charts of the sources, experiments and fuels of the conversation.
   ===================================================================== */
(function () {
  "use strict";

  // ---------- Memory: only the previous exchange ----------
  // Stored in sessionStorage: it lasts while the tab is open
  // (even if you switch to Home or Simulation) and is cleared when the tab is closed.
  const CLAVE_MEMORIA = "firespace_ultimo_turno";
  const CLAVE_DASHBOARD = "firespace_dashboard";
  const CLAVE_PANEL = "firespace_panel";

  const raiz = document.getElementById("asistente");
  const mensajes = document.getElementById("mensajes");
  const botonNueva = document.getElementById("nueva");
  const mascotaSrc = document.querySelector(".bienvenida .mascota").getAttribute("src");
  let enviando = false;

  function cargarUltimoTurno() {
    try {
      const turno = JSON.parse(sessionStorage.getItem(CLAVE_MEMORIA));
      return turno && typeof turno.pregunta === "string" ? turno : null;
    } catch (e) {
      return null;
    }
  }

  function guardarUltimoTurno(turno) {
    try {
      if (turno) sessionStorage.setItem(CLAVE_MEMORIA, JSON.stringify(turno));
      else sessionStorage.removeItem(CLAVE_MEMORIA);
    } catch (e) {
      // If the browser does not allow saving, the follow-up only lasts on this page.
    }
  }

  let ultimoTurno = cargarUltimoTurno(); // {pregunta, respuesta, fuentes} or null
  let ultimoPanel = leerPanel();          // {titulo, bloques} or null

  function leerPanel() {
    try {
      const p = JSON.parse(sessionStorage.getItem(CLAVE_PANEL));
      // A dashboard saved with the old format (without "bloques") is discarded.
      return p && Array.isArray(p.bloques) ? p : null;
    } catch (e) {
      return null;
    }
  }

  function guardarPanel(panel) {
    try {
      if (panel) sessionStorage.setItem(CLAVE_PANEL, JSON.stringify(panel));
      else sessionStorage.removeItem(CLAVE_PANEL);
    } catch (e) { /* no browser memory: it only lasts on this page */ }
  }

  function historialParaServidor() {
    if (!ultimoTurno) return [];
    return [
      { rol: "usuario", texto: ultimoTurno.pregunta },
      { rol: "asistente", texto: ultimoTurno.respuesta }
    ];
  }

  // ---------- Suggestions by question type ----------
  const SUGERENCIAS = {
    consultar: [
      "Why are flames spherical in microgravity?",
      "Tell me how methanol flames behave",
      "What is a cool flame?"
    ],
    investigaciones: [
      "What is the Saffire experiment?",
      "Which gaseous fuels were tested in ACME?",
      "What did the FLEX experiment study?"
    ],
    resultados: [
      "What was observed with heptane droplets in FLEX?",
      "How does fire spread over solids in microgravity?",
      "How does oxygen concentration affect a fire in a spacecraft?"
    ]
  };

  function fijarModo(modo) {
    document.querySelectorAll("[data-modo]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.modo === modo));
    document.querySelectorAll("[data-ejemplos]").forEach((cont) => {
      cont.replaceChildren(...SUGERENCIAS[modo].map(crearChip));
    });
  }

  function crearChip(texto) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.dataset.ejemplo = "";
    b.textContent = texto;
    return b;
  }

  document.addEventListener("click", (e) => {
    const modo = e.target.closest("[data-modo]");
    if (modo) return fijarModo(modo.dataset.modo);

    const abrir = e.target.closest("[data-abrir-modos]");
    if (abrir) {
      const menu = abrir.closest("form").querySelector(".menu-modos");
      if (menu) menu.hidden = !menu.hidden;
      return;
    }

    const ejemplo = e.target.closest("[data-ejemplo]");
    if (ejemplo) {
      document.querySelectorAll(".menu-modos").forEach((m) => (m.hidden = true));
      return enviar(ejemplo.textContent);
    }

    if (!e.target.closest(".menu-modos")) document.querySelectorAll(".menu-modos").forEach((m) => (m.hidden = true));
  });

  // ---------- Display ----------

  function escapar(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function urlSegura(url) {
    return typeof url === "string" && url.startsWith("https://") ? url : null;
  }

  // Citation number -> source (the server groups citations of the same document: id "1, 3")
  function mapaDeCitas(fuentes) {
    const mapa = {};
    for (const f of fuentes) {
      String(f.id).split(",").forEach((n) => (mapa[n.trim()] = f));
    }
    return mapa;
  }

  // Plain text with hyphens -> paragraphs and lists; [n] -> link to the source
  function formatearRespuesta(texto, fuentes) {
    const mapa = mapaDeCitas(fuentes);
    const enlazarCitas = (html) =>
      html.replace(/\[(\d+)\]/g, (m, n) => {
        const f = mapa[n];
        const url = f && urlSegura(f.url);
        return url
          ? `<a class="cita" href="${escapar(url)}" target="_blank" rel="noopener noreferrer" title="${escapar(f.titulo)}">${n}</a>`
          : `<span class="cita">${n}</span>`;
      });

    return texto.split(/\n{2,}/).map((bloque) => {
      const lineas = bloque.split("\n");
      const html = [];
      let lista = [];
      const cerrarLista = () => {
        if (lista.length) html.push("<ul>" + lista.map((l) => `<li>${l}</li>`).join("") + "</ul>");
        lista = [];
      };
      for (const linea of lineas) {
        const t = linea.trim();
        if (!t) continue;
        if (/^[-•]\s+/.test(t)) lista.push(enlazarCitas(escapar(t.replace(/^[-•]\s+/, ""))));
        else { cerrarLista(); html.push(`<p>${enlazarCitas(escapar(t))}</p>`); }
      }
      cerrarLista();
      return html.join("");
    }).join("");
  }

  function crearListaFuentes(fuentes) {
    if (!fuentes.length) return null;
    const cont = document.createElement("div");
    cont.className = "fuentes-msg";
    const titulo = document.createElement("p");
    titulo.className = "fuentes-msg__titulo";
    titulo.textContent = "Sources:";
    const lista = document.createElement("ul");
    for (const f of fuentes) {
      const li = document.createElement("li");
      li.appendChild(document.createTextNode("[" + f.id + "] " + f.fuente + " — "));
      const url = urlSegura(f.url);
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = f.titulo;
        li.appendChild(a);
      } else {
        li.appendChild(document.createTextNode(f.titulo));
      }
      lista.appendChild(li);
    }
    cont.append(titulo, lista);
    return cont;
  }

  function entrarAlChat(pregunta) {
    if (!raiz.classList.contains("con-chat")) {
      raiz.classList.add("con-chat");
      document.getElementById("tituloChat").textContent =
        pregunta.length > 48 ? pregunta.slice(0, 48) + "…" : pregunta;
      setTimeout(redimensionarGraficas, 50);
    }
  }

  function agregarPregunta(pregunta) {
    const d = document.createElement("div");
    d.className = "msg msg--usuario";
    d.textContent = pregunta;
    mensajes.appendChild(d);
  }

  function agregarRespuestaVacia() {
    const d = document.createElement("div");
    d.className = "msg msg--apigx";
    d.innerHTML = `<img class="mascota" src="${escapar(mascotaSrc)}" alt="">
      <div class="msg__cuerpo"><div class="escribiendo" aria-label="Thinking"><span></span><span></span><span></span> Thinking…</div></div>`;
    mensajes.appendChild(d);
    mensajes.scrollTop = mensajes.scrollHeight;
    return d.querySelector(".msg__cuerpo");
  }

  function mostrarRespuesta(cuerpo, respuesta, fuentes) {
    cuerpo.innerHTML = formatearRespuesta(respuesta, fuentes);
    const lista = crearListaFuentes(fuentes);
    if (lista) cuerpo.appendChild(lista);
  }

  function mostrarError(cuerpo, error) {
    cuerpo.innerHTML = "";
    const p = document.createElement("p");
    p.className = "msg__error";
    p.textContent = "Error: " + error;
    cuerpo.appendChild(p);
  }

  // ---------- Sending questions ----------

  async function enviar(texto) {
    const pregunta = String(texto || "").trim();
    if (!pregunta || enviando) return;

    enviando = true;
    document.querySelectorAll("[data-form-consulta] .pill__enviar").forEach((b) => (b.disabled = true));
    entrarAlChat(pregunta);
    agregarPregunta(pregunta);
    const cuerpo = agregarRespuestaVacia();

    try {
      const r = await fetch("/api/preguntar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pregunta, historial: historialParaServidor() })
      });

      let datos;
      try {
        datos = await r.json();
      } catch (e) {
        datos = { ok: false, error: "the server returned something unexpected (code " + r.status + ")." };
      }

      if (datos.ok) {
        const fuentes = datos.fuentes || [];
        mostrarRespuesta(cuerpo, datos.respuesta, fuentes);
        ultimoTurno = { pregunta, respuesta: datos.respuesta, fuentes };
        guardarUltimoTurno(ultimoTurno);

        // Only information searches bring a dashboard; if none comes, the previous one stays.
        if (datos.panel) {
          ultimoPanel = datos.panel;
          guardarPanel(ultimoPanel);
          mostrarPanel(ultimoPanel);
        }
        registrarEnDashboard(pregunta, datos.respuesta, fuentes);
      } else {
        // Errors are shown, but they do not replace the previous question in memory.
        mostrarError(cuerpo, datos.error);
      }
    } catch (e) {
      mostrarError(cuerpo, "could not connect to the server.");
    } finally {
      enviando = false;
      document.querySelectorAll("[data-form-consulta] .pill__enviar").forEach((b) => (b.disabled = false));
      mensajes.scrollTop = mensajes.scrollHeight;
      document.querySelector(".chat__entrada input").focus();
    }
  }

  function nuevaConversacion() {
    ultimoTurno = null;
    guardarUltimoTurno(null);
    ultimoPanel = null;
    guardarPanel(null);
    mostrarPanel(null);
    reiniciarDashboard();
    mensajes.replaceChildren();
    raiz.classList.remove("con-chat", "dash-abierto");
    document.querySelector(".bienvenida input").focus();
  }

  document.querySelectorAll("[data-form-consulta]").forEach((form) =>
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = form.querySelector('input[name="pregunta"]');
      const texto = input.value;
      input.value = "";
      enviar(texto);
    })
  );
  botonNueva.addEventListener("click", nuevaConversacion);

  // ---------- Expand / collapse the dashboard ----------
  document.querySelectorAll("[data-toggle-dash]").forEach((b) =>
    b.addEventListener("click", () => {
      const abierto = raiz.classList.toggle("dash-abierto");
      document.querySelector(".dash__toggle").setAttribute("aria-label", abierto ? "Back to the conversation" : "Expand dashboard");
      setTimeout(redimensionarGraficas, 60);
    })
  );

  /* =====================================================================
     CONVERSATION DASHBOARD
     ===================================================================== */
  const PALETA = ["#22d3ee", "#ff7a1a", "#a78bfa", "#3ddc97", "#ff4d5e", "#ffc93c", "#3b82f6", "#f472b6"];
  const EXPERIMENTOS = ["ACME", "FLEX", "SAFFIRE", "BASS", "SOFIE", "FLARE", "DAFT", "SPICE", "SAME", "CFI", "CIR", "MDCA"];

  // Approximate reference properties (open literature) for the illustrative index.
  const COMBUSTIBLES = {
    metano:  { nombre: "Methane",   palabras: /\b(metano|methane)\b/i,           lfl: 5.0,  ufl: 15.0, flash: null, dhc: 50.0, color: "#22d3ee" },
    etileno: { nombre: "Ethylene",  palabras: /\b(etileno|ethylene)\b/i,         lfl: 2.7,  ufl: 36.0, flash: null, dhc: 47.2, color: "#ff7a1a" },
    propano: { nombre: "Propane",   palabras: /\b(propano|propane)\b/i,          lfl: 2.1,  ufl: 9.5,  flash: null, dhc: 46.4, color: "#a78bfa" },
    metanol: { nombre: "Methanol",  palabras: /\b(metanol|methanol)\b/i,         lfl: 6.0,  ufl: 36.0, flash: 11,   dhc: 19.9, color: "#3b82f6" },
    etanol:  { nombre: "Ethanol",   palabras: /\b(etanol|ethanol)\b/i,           lfl: 3.3,  ufl: 19.0, flash: 13,   dhc: 26.8, color: "#3ddc97" },
    heptano: { nombre: "n-Heptane", palabras: /\b(n-)?(heptano|heptane)\b/i,     lfl: 1.05, ufl: 6.7,  flash: -4,   dhc: 44.6, color: "#ff4d5e" },
    decano:  { nombre: "n-Decane",  palabras: /\b(n-)?(decano|decane)\b/i,       lfl: 0.8,  ufl: 5.4,  flash: 46,   dhc: 44.2, color: "#ffc93c" },
  };
  const UMBRAL = 70;

  const vacio = () => ({ citas: {}, origen: {}, experimentos: {}, combustibles: [] });
  let dash = cargarDashboard();
  const ajustes = { activos: new Set(), cantidad: 0.5, oxigeno: 21 };
  const graficas = {};

  function cargarDashboard() {
    try {
      const d = JSON.parse(sessionStorage.getItem(CLAVE_DASHBOARD));
      return d && d.citas ? d : vacio();
    } catch (e) {
      return vacio();
    }
  }
  function guardarDashboard() {
    try { sessionStorage.setItem(CLAVE_DASHBOARD, JSON.stringify(dash)); } catch (e) {}
  }
  function reiniciarDashboard() {
    dash = vacio();
    ajustes.activos.clear();
    guardarDashboard();
    pintarDashboard();
  }

  function registrarEnDashboard(pregunta, respuesta, fuentes) {
    // Citations per document (how many times each [n] appears in the answer)
    const veces = {};
    (respuesta.match(/\[(\d+)\]/g) || []).forEach((m) => (veces[m.slice(1, -1)] = (veces[m.slice(1, -1)] || 0) + 1));
    for (const f of fuentes) {
      const total = String(f.id).split(",").reduce((a, n) => a + (veces[n.trim()] || 1), 0);
      dash.citas[f.titulo] = (dash.citas[f.titulo] || 0) + total;
      const via = String(f.fuente || "").split(",")[0].trim() || "Official challenge list";
      dash.origen[via] = (dash.origen[via] || 0) + total;
    }
    // Experiments and fuels mentioned
    const texto = pregunta + "\n" + respuesta;
    for (const sigla of EXPERIMENTOS) {
      const re = new RegExp("\\b" + sigla + "\\b", sigla === "SAFFIRE" ? "gi" : "g");
      const n = (texto.match(re) || []).length;
      if (n) dash.experimentos[sigla] = (dash.experimentos[sigla] || 0) + n;
    }
    for (const [id, c] of Object.entries(COMBUSTIBLES)) {
      if (c.palabras.test(texto) && !dash.combustibles.includes(id)) {
        dash.combustibles.push(id);
        ajustes.activos.add(id);
      }
    }
    guardarDashboard();
    pintarDashboard();
  }

  function configurarChart() {
    Chart.defaults.color = "#8584a6";
    Chart.defaults.font.family = "Inter, system-ui, sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.borderColor = "rgba(255,255,255,.06)";
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.maintainAspectRatio = false;
  }

  function graficar(clave, canvasId, config) {
    if (graficas[clave]) graficas[clave].destroy();
    graficas[clave] = new Chart(document.getElementById(canvasId), config);
  }

  function redimensionarGraficas() {
    Object.values(graficas).forEach((g) => g && g.resize());
    graficasPanel.forEach((g) => g.resize());
  }

  const recortar = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

  function pintarDashboard() {
    if (typeof Chart === "undefined") return;
    const hayConversacion = Object.keys(dash.citas).length || Object.keys(dash.experimentos).length || dash.combustibles.length;
    const hayDatos = hayConversacion || !!ultimoPanel;
    document.getElementById("dashVacio").hidden = !!hayDatos;
    document.querySelector(".dash__grid").hidden = !hayDatos;
    // The conversation charts are only shown when they have data.
    ["dFuentes", "dOrigen", "dExperimentos"].forEach((id) => {
      const fig = document.getElementById(id).closest(".grafica");
      (fig.parentElement.classList.contains("ancha") ? fig.parentElement : fig).hidden = !hayConversacion;
    });
    if (!hayConversacion) return;

    // 1) Cited documents
    const docs = Object.entries(dash.citas).sort((a, b) => b[1] - a[1]).slice(0, 8);
    graficar("fuentes", "dFuentes", {
      type: "bar",
      data: {
        labels: docs.map(([t]) => ((t.match(/\(([^)]+)\)\s*$/) || [])[1] || recortar(t, 26))),
        datasets: [{ label: "Citations", data: docs.map(([, n]) => n), backgroundColor: docs.map((_, i) => PALETA[i % PALETA.length]), borderRadius: 4 }]
      },
      options: {
        indexAxis: "y",
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => docs[it[0].dataIndex][0] } } },
        scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });

    // 2) Origin of the sources
    const origen = Object.entries(dash.origen);
    graficar("origen", "dOrigen", {
      type: "doughnut",
      data: {
        labels: origen.map(([o]) => o),
        datasets: [{ data: origen.map(([, n]) => n), backgroundColor: ["#ff7a1a", "#22d3ee", "#a78bfa", "#3ddc97"], borderWidth: 0 }]
      },
      options: { cutout: "62%", plugins: { legend: { position: "bottom" } } }
    });

    // 3) Experiments mentioned
    const exps = Object.entries(dash.experimentos).sort((a, b) => b[1] - a[1]);
    graficar("experimentos", "dExperimentos", {
      type: "bar",
      data: {
        labels: exps.map(([e]) => e),
        datasets: [{ label: "Mentions", data: exps.map(([, n]) => n), backgroundColor: "#ff7a1a", borderRadius: 4 }]
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });

    pintarCombustibles();
  }


  /* =====================================================================
     AI DASHBOARD (dashboard about the topic designed by the server)
     Every block is drawn with textContent: what the AI sends is never
     interpreted as HTML.
     ===================================================================== */
  const panelIA = document.getElementById("panelIA");
  let graficasPanel = []; // active dashboard charts, to remove them when the dashboard changes

  function el(etiqueta, texto, clase) {
    const nodo = document.createElement(etiqueta);
    if (texto !== undefined && texto !== null) nodo.textContent = texto;
    if (clase) nodo.className = clase;
    return nodo;
  }

  function formatear(valor) {
    return Number.isInteger(valor) ? String(valor) : valor.toLocaleString("en-US", { maximumFractionDigits: 3 });
  }

  const DIBUJAR = {
    kpis(b, caja) {
      const rejilla = el("div", null, "pia-kpis");
      for (const i of b.items) {
        const kpi = el("div", null, "pia-kpi");
        if (i.icono) kpi.appendChild(el("div", i.icono, "pia-kpi__icono"));
        kpi.appendChild(el("div", i.valor, "pia-kpi__valor"));
        kpi.appendChild(el("div", i.titulo, "pia-kpi__titulo"));
        if (i.detalle) kpi.appendChild(el("div", i.detalle, "pia-kpi__detalle"));
        rejilla.appendChild(kpi);
      }
      caja.appendChild(rejilla);
    },

    pasos(b, caja) {
      const lista = el("ol", null, "pia-pasos");
      for (const i of b.items) {
        const li = el("li");
        li.appendChild(el("b", i.titulo));
        if (i.detalle) li.appendChild(el("div", i.detalle));
        lista.appendChild(li);
      }
      caja.appendChild(lista);
    },

    comparacion(b, caja) {
      const opciones = el("div", null, "pia-comparacion__opciones");
      const detalle = el("div", null, "pia-comparacion__detalle");
      const botones = [];
      const seleccionar = (indice) => {
        botones.forEach((bt, k) => bt.setAttribute("aria-pressed", k === indice));
        const item = b.items[indice];
        detalle.replaceChildren(el("h4", item.nombre));
        for (const d of item.detalles) {
          const p = el("p");
          p.appendChild(el("b", d.campo + ": "));
          p.appendChild(document.createTextNode(d.valor));
          detalle.appendChild(p);
        }
      };
      b.items.forEach((item, indice) => {
        const bt = el("button", null, "pia-comparacion__opcion");
        bt.type = "button";
        bt.appendChild(el("b", item.nombre));
        if (item.resumen) bt.appendChild(el("span", item.resumen));
        bt.addEventListener("click", () => seleccionar(indice));
        botones.push(bt);
        opciones.appendChild(bt);
      });
      caja.append(opciones, detalle);
      seleccionar(0);
    },

    lista(b, caja) {
      for (const i of b.items) {
        const fila = el("div", null, "pia-lista");
        fila.appendChild(el("span", i.icono || "•", "pia-lista__icono"));
        const texto = el("div");
        if (i.titulo) texto.appendChild(el("b", i.titulo));
        if (i.texto) texto.appendChild(el("div", i.texto));
        fila.appendChild(texto);
        caja.appendChild(fila);
      }
    },

    linea_tiempo(b, caja) {
      const linea = el("div", null, "pia-tiempo");
      for (const i of b.items) {
        const evento = el("div");
        evento.appendChild(el("b", i.fecha + " · " + i.titulo));
        if (i.texto) evento.appendChild(el("div", i.texto));
        linea.appendChild(evento);
      }
      caja.appendChild(linea);
    },

    dato(b, caja) {
      caja.classList.add("pia-dato");
      caja.appendChild(el("div", (b.icono ? b.icono + " " : "✨ ") + b.texto));
    },

    tabla(b, caja) {
      const contenedor = el("div", null, "pia-tabla");
      const tabla = el("table");
      const encabezado = el("tr");
      b.columnas.forEach((c) => encabezado.appendChild(el("th", c)));
      tabla.appendChild(encabezado);
      for (const fila of b.filas) {
        const tr = el("tr");
        fila.forEach((celda) => tr.appendChild(el("td", celda)));
        tabla.appendChild(tr);
      }
      contenedor.appendChild(tabla);
      caja.appendChild(contenedor);
    },

    grafica(b, caja) {
      if (typeof Chart === "undefined") {
        // Fallback without Chart.js: simple bars with the first series
        const serie = b.series[0];
        const maximo = Math.max(...serie.valores.map(Math.abs)) || 1;
        b.etiquetas.forEach((etiqueta, k) => {
          const fila = el("div", null, "pia-barra");
          fila.appendChild(el("div", etiqueta + ": " + formatear(serie.valores[k]) + " " + (b.unidad || "")));
          const fondo = el("div", null, "pia-barra__fondo");
          const relleno = el("div", null, "pia-barra__relleno");
          relleno.style.width = Math.max(2, (100 * Math.abs(serie.valores[k])) / maximo) + "%";
          fondo.appendChild(relleno);
          fila.appendChild(fondo);
          caja.appendChild(fila);
        });
        return;
      }
      const contenedor = el("div", null, "grafica__lienzo");
      const lienzo = el("canvas");
      contenedor.appendChild(lienzo);
      caja.appendChild(contenedor);

      const circular = b.subtipo === "dona";
      const tipo = { barras: "bar", barras_horizontales: "bar", lineas: "line", dona: "doughnut", radar: "radar" }[b.subtipo] || "bar";
      const series = circular ? b.series.slice(0, 1) : b.series;
      const datasets = series.map((s, k) => ({
        label: s.nombre || b.unidad || "",
        data: s.valores,
        backgroundColor: circular ? PALETA : PALETA[k % PALETA.length] + (tipo === "radar" || tipo === "line" ? "44" : ""),
        borderColor: circular ? "#0b1030" : PALETA[k % PALETA.length],
        borderWidth: 2,
        borderRadius: tipo === "bar" ? 4 : 0,
        fill: tipo === "line",
        tension: 0.35
      }));
      const opciones = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: circular || series.length > 1, position: circular ? "bottom" : "top" } }
      };
      if (b.subtipo === "barras_horizontales") opciones.indexAxis = "y";
      if (tipo === "radar") {
        opciones.scales = { r: { angleLines: { color: "rgba(255,255,255,.08)" }, grid: { color: "rgba(255,255,255,.08)" }, pointLabels: { color: "#b9b8d3" }, ticks: { backdropColor: "transparent" } } };
      } else if (!circular && b.unidad) {
        const eje = b.subtipo === "barras_horizontales" ? "x" : "y";
        opciones.scales = { [eje]: { title: { display: true, text: b.unidad } } };
      }
      graficasPanel.push(new Chart(lienzo, { type: tipo, data: { labels: b.etiquetas, datasets }, options: opciones }));
    }
  };

  function mostrarPanel(datos) {
    graficasPanel.forEach((g) => g.destroy());
    graficasPanel = [];
    panelIA.replaceChildren();
    if (!datos) {
      panelIA.hidden = true;
      return;
    }
    panelIA.hidden = false;
    document.getElementById("dashVacio").hidden = true;
    document.querySelector(".dash__grid").hidden = false;
    panelIA.appendChild(el("h3", datos.titulo, "panel-ia__titulo"));

    if (!datos.bloques || !datos.bloques.length) {
      panelIA.appendChild(el("p", "The dashboard could not be generated for this query. Try asking in a different way.", "aviso-demo"));
      return;
    }
    const rejilla = el("div", null, "panel-ia__bloques");
    panelIA.appendChild(rejilla);
    for (const bloque of datos.bloques) {
      const dibujar = DIBUJAR[bloque.tipo];
      if (!dibujar) continue;
      const caja = el("div", null, "grafica pia-bloque pia-bloque--" + bloque.tipo);
      if (bloque.titulo) caja.appendChild(el("div", bloque.titulo, "grafica__titulo"));
      try {
        rejilla.appendChild(caja); // in the DOM first: Chart.js needs the real size
        dibujar(bloque, caja);
        if (Array.isArray(bloque.citas) && bloque.citas.length) {
          caja.appendChild(el("p", "Sources: " + bloque.citas.map((n) => "[" + n + "]").join(" "), "pia-citas"));
        }
      } catch (e) {
        caja.remove(); // if a block is malformed, it is skipped without breaking the rest of the dashboard
      }
    }
    panelIA.appendChild(el("p", "Dashboard generated by AI from the sources of the answer.", "aviso-demo"));
  }

  /* ---------- illustrative index for fuels ---------- */
  function peligrosidad(c) {
    const cl = (v) => Math.max(0, Math.min(1, v));
    const vol = c.flash == null ? 1 : cl((60 - c.flash) / 80);
    return 0.32 * vol + 0.28 * cl(1.2 / c.lfl) + 0.15 * cl((c.ufl - c.lfl) / 35) + 0.25 * cl(c.dhc / 50);
  }
  function riesgo(c, cantidad, oxigeno) {
    return Math.min(100, Math.round(peligrosidad(c) * (0.45 + 0.55 * cantidad) * Math.pow(oxigeno / 21, 1.6) * 100));
  }

  const pluginUmbral = {
    id: "umbral",
    afterDraw(chart, _a, opts) {
      if (!opts || opts.valor == null || !chart.scales.y) return;
      const { ctx, chartArea: a } = chart;
      const y = chart.scales.y.getPixelForValue(opts.valor);
      ctx.save();
      ctx.fillStyle = "rgba(255,77,94,.07)";
      ctx.fillRect(a.left, a.top, a.right - a.left, y - a.top);
      ctx.strokeStyle = "#ff4d5e"; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(a.left, y); ctx.lineTo(a.right, y); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = "#ff8a95"; ctx.font = "600 10px Inter, sans-serif";
      ctx.fillText("Danger", a.left + 6, y - 5);
      if (opts.x != null && chart.scales.x) {
        const x = chart.scales.x.getPixelForValue(opts.x);
        ctx.strokeStyle = "#fff"; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke();
      }
      ctx.restore();
    }
  };

  function pintarCombustibles() {
    const hay = dash.combustibles.length > 0;
    document.getElementById("panelCombustibles").hidden = !hay;
    document.querySelectorAll("[data-solo-combustibles]").forEach((el) => (el.hidden = !hay));
    if (!hay) return;

    if (!ajustes.activos.size) dash.combustibles.forEach((id) => ajustes.activos.add(id));
    const chips = document.getElementById("chipsCombustibles");
    chips.replaceChildren(...dash.combustibles.map((id) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.comb = id;
      b.setAttribute("aria-pressed", ajustes.activos.has(id));
      b.textContent = COMBUSTIBLES[id].nombre;
      return b;
    }));

    const ids = dash.combustibles.filter((id) => ajustes.activos.has(id));
    const xs = Array.from({ length: 21 }, (_, i) => i * 5);
    graficar("curva", "dCurva", {
      type: "line",
      data: {
        labels: xs.map((x) => x + "%"),
        datasets: ids.map((id) => ({
          label: COMBUSTIBLES[id].nombre,
          data: xs.map((x) => riesgo(COMBUSTIBLES[id], x / 100, ajustes.oxigeno)),
          borderColor: COMBUSTIBLES[id].color, backgroundColor: COMBUSTIBLES[id].color + "22",
          fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2.5
        }))
      },
      options: {
        animation: false,
        interaction: { mode: "index", intersect: false },
        scales: { y: { min: 0, max: 100 }, x: { ticks: { maxTicksLimit: 6 } } },
        plugins: { umbral: { valor: UMBRAL, x: Math.round(ajustes.cantidad * 20) } }
      },
      plugins: [pluginUmbral]
    });

    // Text status
    let peor = null;
    ids.forEach((id) => {
      const v = riesgo(COMBUSTIBLES[id], ajustes.cantidad, ajustes.oxigeno);
      if (!peor || v > peor.v) peor = { id, v };
    });
    const est = document.getElementById("estadoRiesgo");
    if (!peor) { est.className = "estado-riesgo"; est.textContent = "Select at least one fuel."; }
    else {
      const nombre = COMBUSTIBLES[peor.id].nombre;
      const cruce = xs.find((x) => riesgo(COMBUSTIBLES[peor.id], x / 100, ajustes.oxigeno) >= UMBRAL);
      est.className = "estado-riesgo " + (peor.v >= UMBRAL ? "peligro" : peor.v >= 40 ? "precaucion" : "");
      est.textContent = peor.v >= UMBRAL
        ? `⚠ ${nombre}: index ${peor.v}/100 with ${Math.round(ajustes.cantidad * 100)}% amount and ${ajustes.oxigeno}% O₂.`
        : cruce != null
          ? `${nombre} (index ${peor.v}) would cross the threshold from ${cruce}% amount.`
          : `No fuel reaches the threshold with ${ajustes.oxigeno}% O₂.`;
    }

    document.getElementById("dRangos").innerHTML = ids.map((id) => {
      const c = COMBUSTIBLES[id];
      return `<div class="rango"><div class="rango__cab"><span>${c.nombre}</span><span>${c.lfl}–${c.ufl}%</span></div>
        <div class="rango__pista"><div class="rango__barra" style="left:${(c.lfl / 40) * 100}%;width:${((c.ufl - c.lfl) / 40) * 100}%"></div></div></div>`;
    }).join("");
  }

  document.getElementById("chipsCombustibles").addEventListener("click", (e) => {
    const b = e.target.closest("[data-comb]");
    if (!b) return;
    const id = b.dataset.comb;
    ajustes.activos.has(id) ? ajustes.activos.delete(id) : ajustes.activos.add(id);
    pintarCombustibles();
  });
  const rC = document.getElementById("rCantidad");
  const rO = document.getElementById("rOxigeno");
  rC.addEventListener("input", () => { ajustes.cantidad = rC.value / 100; document.getElementById("oCantidad").textContent = rC.value + "%"; pintarCombustibles(); });
  rO.addEventListener("input", () => { ajustes.oxigeno = +rO.value; document.getElementById("oOxigeno").textContent = rO.value + "%"; pintarCombustibles(); });

  // ---------- Start ----------
  if (typeof Chart !== "undefined") configurarChart();
  fijarModo("consultar");

  // When coming back to this page, the last answer of this tab is shown.
  if (ultimoTurno) {
    entrarAlChat(ultimoTurno.pregunta);
    agregarPregunta(ultimoTurno.pregunta);
    mostrarRespuesta(agregarRespuestaVacia(), ultimoTurno.respuesta, ultimoTurno.fuentes || []);
  }
  if (ultimoPanel) mostrarPanel(ultimoPanel);
  pintarDashboard();
})();
