/* FireSpace GX · 3D simulation controls.
   - Filter: shows one group of sliders at a time.
   - Mission environments and PSI-68 mixtures: they move the same sliders
     read by simulacion3d.js (with an "input" event), so it redraws just like by hand.
   - ApiGx interpretation: asks /api/interpretar-llama for a reading of the
     conditions based on the NASA research in the library. */
(function () {
  "use strict";

  var filtro = document.getElementById("filtro");
  var grupos = document.querySelectorAll("[data-grupo]");
  var ultimaLlama = window.__ultimaLlama || null; // parameters of the last drawing (fsgx:llama event)

  function mostrarGrupo() {
    grupos.forEach(function (g) { g.hidden = g.dataset.grupo !== filtro.value; });
  }
  filtro.addEventListener("change", mostrarGrupo);
  mostrarGrupo();

  function fijar(el, valor) {
    el.value = valor;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // ---------- Mission environments ----------
  function marcarEntorno() {
    var g = parseFloat(document.getElementById("gravedad").value);
    var o = parseFloat(document.getElementById("oxigeno").value);
    document.querySelectorAll("[data-gravedad]").forEach(function (b) {
      b.setAttribute("aria-pressed", parseFloat(b.dataset.gravedad) === g && parseFloat(b.dataset.oxigeno) === o);
    });
  }
  document.querySelectorAll("[data-gravedad]").forEach(function (b) {
    b.addEventListener("click", function () {
      fijar(document.getElementById("gravedad"), b.dataset.gravedad);
      fijar(document.getElementById("oxigeno"), b.dataset.oxigeno);
      marcarEntorno();
    });
  });
  ["gravedad", "oxigeno"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", marcarEntorno);
  });
  marcarEntorno();

  // ---------- PSI-68 compounds ----------
  var compuestos = document.querySelectorAll("input[data-compuesto]");
  function actualizarSalidas() {
    compuestos.forEach(function (el) {
      document.querySelector('[data-salida="' + el.dataset.compuesto + '"]').textContent =
        Math.round(parseFloat(el.value) * 100) + " %";
    });
  }
  compuestos.forEach(function (el) { el.addEventListener("input", actualizarSalidas); });
  document.querySelectorAll("[data-mezcla]").forEach(function (b) {
    b.addEventListener("click", function () {
      var mezcla = JSON.parse(b.dataset.mezcla);
      compuestos.forEach(function (el) { el.value = mezcla[el.dataset.compuesto] || 0; });
      actualizarSalidas();
      fijar(compuestos[0], compuestos[0].value); // a single redraw
    });
  });

  // ---------- Collapse cards ----------
  document.querySelectorAll("[data-plegar]").forEach(function (b) {
    b.addEventListener("click", function () {
      var plegado = b.closest(".sim-tarjeta").classList.toggle("plegado");
      b.textContent = plegado ? "+" : "–";
    });
  });

  // When the side menu is collapsed/expanded, Plotly adjusts to the new width.
  window.addEventListener("fsgx:layout", function () {
    setTimeout(function () {
      if (window.Plotly) Plotly.Plots.resize("grafica-llama");
    }, 320);
  });

  /* =====================================================================
     APIGX INTERPRETATION
     ===================================================================== */
  var boton = document.getElementById("btnInterpretar");
  var estado = document.getElementById("iaEstado");
  var resultado = document.getElementById("iaResultado");
  var firmaInterpretada = null;

  function condiciones() {
    var p = ultimaLlama || window.__ultimaLlama || {};
    return {
      gravedad: p.gravedad,
      oxigeno: p.oxigeno,
      tamano: p.tamano,
      diametro: p.diametroQuemador,
      temperatura: p.temperatura,
      forma: p.forma,
      color: p.colorDominante,
      compuestos: Array.prototype.map.call(compuestos, function (el) {
        return { nombre: el.dataset.nombre, fraccion: parseFloat(el.value) };
      }).filter(function (c) { return c.fraccion > 0; }),
    };
  }
  function firma(c) { return JSON.stringify(c); }

  window.addEventListener("fsgx:llama", function (e) {
    ultimaLlama = e.detail;
    if (firmaInterpretada && firmaInterpretada !== firma(condiciones())) {
      mostrarEstado("You changed the conditions: interpret again to update the analysis.");
      boton.textContent = "Interpret again";
    }
  });

  function mostrarEstado(texto, error) {
    estado.hidden = !texto;
    estado.textContent = texto || "";
    estado.classList.toggle("error", !!error);
  }

  function escapar(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Plain text -> paragraphs/lists; "What it means:" etc. in bold; [n] -> link to the source
  function formatear(texto, fuentes) {
    var mapa = {};
    fuentes.forEach(function (f) { String(f.id).split(",").forEach(function (n) { mapa[n.trim()] = f; }); });
    function citas(html) {
      return html.replace(/\[(\d+)\]/g, function (m, n) {
        var f = mapa[n];
        var url = f && typeof f.url === "string" && f.url.indexOf("https://") === 0 ? f.url : null;
        return url
          ? '<a class="cita" href="' + escapar(url) + '" target="_blank" rel="noopener noreferrer" title="' + escapar(f.titulo) + '">' + n + "</a>"
          : '<span class="cita">' + n + "</span>";
      });
    }
    var html = [], lista = [];
    function cerrar() { if (lista.length) html.push("<ul>" + lista.join("") + "</ul>"); lista = []; }
    texto.split("\n").forEach(function (linea) {
      var t = linea.trim();
      if (!t) return;
      if (/^[-•]\s+/.test(t)) { lista.push("<li>" + citas(escapar(t.replace(/^[-•]\s+/, ""))) + "</li>"); return; }
      cerrar();
      var e = citas(escapar(t)).replace(/^(What it means:|Is it dangerous\?:|What to do:)/, "<b>$1</b>");
      html.push("<p>" + e + "</p>");
    });
    cerrar();
    return html.join("");
  }

  function pintarFuentes(fuentes) {
    var cont = document.getElementById("iaFuentes");
    cont.replaceChildren();
    if (!fuentes.length) return;
    var caja = document.createElement("div");
    caja.className = "fuentes-msg";
    var t = document.createElement("p");
    t.className = "fuentes-msg__titulo";
    t.textContent = "Where it comes from:";
    var ul = document.createElement("ul");
    fuentes.forEach(function (f) {
      var li = document.createElement("li");
      li.appendChild(document.createTextNode("[" + f.id + "] " + f.fuente + " — "));
      if (typeof f.url === "string" && f.url.indexOf("https://") === 0) {
        var a = document.createElement("a");
        a.href = f.url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = f.titulo;
        li.appendChild(a);
      } else {
        li.appendChild(document.createTextNode(f.titulo));
      }
      ul.appendChild(li);
    });
    caja.append(t, ul);
    cont.appendChild(caja);
  }

  var NIVELES = {
    high: "High danger", moderate: "Moderate danger", low: "Low danger", "no data": "Not enough data",
  };

  boton.addEventListener("click", async function () {
    if (boton.disabled) return;
    var c = condiciones();
    boton.disabled = true;
    boton.textContent = "Checking the research…";
    mostrarEstado("");
    try {
      var r = await fetch("/api/interpretar-llama", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c),
      });
      var d;
      try { d = await r.json(); } catch (e) { d = { ok: false, error: "the server returned something unexpected (code " + r.status + ")." }; }
      if (!d.ok) throw new Error(d.error || "Error");

      var nivel = document.getElementById("iaNivel");
      nivel.textContent = NIVELES[d.nivel] || NIVELES["no data"];
      nivel.className = "nivel nivel--" + d.nivel.replace(" ", "-");
      document.getElementById("iaTexto").innerHTML =
        formatear(d.interpretacion, d.fuentes || []) +
        (d.sin_citas ? '<p class="aviso-sim">This interpretation does not cite any research from the library; take it as a general explanation.</p>' : "");
      pintarFuentes(d.fuentes || []);
      resultado.hidden = false;
      firmaInterpretada = firma(c);
      boton.textContent = "Interpret again";
    } catch (err) {
      mostrarEstado("Could not interpret: " + err.message, true);
      boton.textContent = "Interpret these conditions";
    } finally {
      boton.disabled = false;
    }
  });
})();
