/* FireSpace — 3D simulation of a flame with Plotly
 *
 * Illustrative model (not a rigorous physical calculation):
 *  - Gravity:  at 1 g the flame is elongated, teardrop-shaped.
 *              at 0 g (microgravity) it tends to be spherical, as
 *              observed in the combustion experiments on the ISS.
 *  - Oxygen:   more O2 -> bigger and hotter flame.
 *              Less O2 -> smaller and cooler.
 *  - Size:     overall scale of the flame (1 to 10).
 *
 * SCALE — 1 unit = 1 cm (approx.)
 *   The scale is relative because the project does not define a real
 *   burner. It is anchored like this: 0.6 cm burner diameter by default
 *   (configurable on the page); with size 5, 1 g and 21 % O2 the
 *   flame is ~8 cm tall and ~3 cm wide, like a small lab flame.
 *   If the user enters the real diameter of their burner, every
 *   measurement in cm is recalculated in the same proportion
 *   (factor = diameter / 0.6): a burner twice as wide gives a flame
 *   twice as tall and wide. The shape and the estimated temperature
 *   do not change with the diameter in this illustrative model:
 *   they depend on gravity and oxygen.
 *
 * COLOR AND TEMPERATURE — yes, in real experiments the flame
 * changes color with temperature, but not only because of
 * black-body radiation:
 *   - Yellow/orange: incandescence of soot. Hot soot glows like an
 *     ember (~1000-1400 °C). It is the typical luminous, smoky flame
 *     of incomplete combustion.
 *   - Blue: chemiluminescence of the CH* and C2* radicals (~430 and
 *     516 nm). It dominates when the fuel forms little soot
 *     (for example, the methanol in FLEX: "very dim blue flame").
 *   That is why the color here does NOT come from a list of states: the soot
 *   color is calculated with Planck's law (black body) and the CIE 1931
 *   color matching functions for the temperature of each point, and the blue
 *   is the CH* (431 nm) + C2* emission, weighted by how little or how much soot
 *   the fuel forms (see "Physical color of the flame" below).
 *
 * The flame is drawn with 3 nested Mesh3d layers (outer, middle
 * and inner) + a Scatter3d point cloud that represents the hot
 * volume. The flame starts ABOVE the burner, joined to it only by
 * a thin wick, so the cylinder does not hide it.
 */

(function () {
  "use strict";

  var GRAFICA_ID = "grafica-llama";
  var BASE_Z = 0.4; // the base of the flame sits 0.4 cm above the burner
  var TEMP_MIN = 600; // °C, cold edge of the flame
  var TEMP_MAX = 1600; // °C, upper limit of the local temperature
  var QUEMADOR_REF_CM = 0.6; // reference burner diameter of the scale (cm)
  var HOLLIN_GENERICO = 0.6; // generic hydrocarbon (no compound chosen): sooty flame
  var QUEMADOR_MIN_CM = 0.2;
  var QUEMADOR_MAX_CM = 2.0;

  // ---------- Physical parameters (illustrative) ----------

  function calcularParametros(gravedad, oxigeno, tamano, diametroQuemador, mezcla) {
    // Burner diameter (cm): set by the user; if it is missing or
    // invalid, the 0.6 cm reference is used.
    var diametro = parseFloat(diametroQuemador);
    if (!isFinite(diametro) || diametro <= 0) diametro = QUEMADOR_REF_CM;
    diametro = clamp(diametro, QUEMADOR_MIN_CM, QUEMADOR_MAX_CM);

    // Scale factor: every measurement in cm is proportional
    // to the burner diameter relative to the 0.6 cm reference.
    var factorEscala = diametro / QUEMADOR_REF_CM;

    // Oxygen factor: 15% -> 0.75, 21% -> 0.90, 35% -> 1.25
    var fO2 = 0.75 + ((oxigeno - 15) / 20) * 0.5;

    // Width (maximum diameter) and height in cm (1 unit = 1 cm).
    // Size 5, g=1, 0.6 cm burner: ~8 cm tall, ~3.2 cm wide (teardrop)
    // Size 5, g=0, 0.6 cm burner: ~4 cm tall, ~4 cm wide (sphere)
    // With another burner, height and width are multiplied by factorEscala.
    var ancho = tamano * (0.9 - 0.18 * gravedad) * fO2 * factorEscala;
    var altura = tamano * (0.9 + 0.9 * gravedad) * fO2 * factorEscala;

    // Estimated maximum temperature (°C, illustrative).
    // Model range: 950 °C (15 % O2, 0 g) to 1540 °C (35 % O2, 1 g).
    var temperatura = Math.round(
      950 + (oxigeno - 15) * 22 + gravedad * 150
    );

    var forma;
    if (gravedad < 0.15) {
      forma = "Spherical — typical of microgravity";
    } else if (gravedad < 0.6) {
      forma = "Rounded / intermediate";
    } else {
      forma = "Elongated teardrop — Earth gravity";
    }

    // Fuel: if the user chose PSI-68 (FLEX-2) compounds, their relative
    // tendency to form soot is used; otherwise, a generic hydrocarbon.
    mezcla = mezcla || { hollin: HOLLIN_GENERICO, nombre: "Generic hydrocarbon" };

    // Color: it is CALCULATED (Planck's law + CIE 1931), not picked from a list of states.
    var color = describirColor(temperatura, mezcla.hollin);

    return {
      gravedad: gravedad,
      oxigeno: oxigeno,
      tamano: tamano,
      diametroQuemador: diametro,
      factorEscala: factorEscala,
      radioQuemador: diametro / 2, // cm; the burner cylinder does not depend on the flame size
      ancho: ancho, // cm
      altura: altura, // cm
      radioMax: ancho / 2,
      temperatura: temperatura,
      forma: forma,
      colorDominante: color.nombre,
      colorExplicacion: color.explicacion,
      hollin: mezcla.hollin,
      combustible: mezcla.nombre,
      baseZ: BASE_Z,
      // Profile exponent: moves the maximum thickness toward
      // the base in Earth gravity and toward the center at 0 g.
      perfilExp: 0.75 + 0.45 * (1 - gravedad),
    };
  }

  // ---------- Utilities ----------

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  // Pseudo-random generator with a fixed seed: the point cloud
  // does not "jump" every time a slider moves.
  function mulberry32(semilla) {
    return function () {
      semilla |= 0;
      semilla = (semilla + 0x6d2b79f5) | 0;
      var t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Flame radius at a normalized height u (0 = base, 1 = tip)
  function radioPerfil(u, p) {
    if (u <= 0 || u >= 1) return 0;
    var s = Math.sin(Math.PI * Math.pow(u, p.parametros.perfilExp));
    if (s <= 0) return 0;
    return p.parametros.radioMax * Math.pow(s, 0.65);
  }

  // ---------- Physical color of the flame ----------
  //
  // What you see in a flame has two origins (see exp_flex.txt: methanol
  // "burns with a very dim blue flame (not much soot production)"):
  //  1. Incandescent soot: it emits like a black body. Its color is calculated
  //     with Planck's law integrated with the CIE 1931 color matching functions
  //     (analytic fit by Wyman, Sloan and Shirley, 2013) and converted to
  //     sRGB. There is no made-up color table: each temperature gives its own color.
  //  2. Chemiluminescence of CH* (~431 nm) and C2* (~516 nm): the blue of the
  //     reaction zone, visible when there is little soot. Its color comes from those wavelengths.
  // The brightness of a black body grows enormously with T; to be able to show it,
  // an "auto exposure" (like a camera) relative to the hottest zone and a
  // brightness compression are used. That changes the on-screen brightness, not the hue.
  var C2 = 1.4388e-2; // second radiation constant (m·K)
  var PUNTO_DRAPER_C = 525; // °C: below it, a hot solid emits almost no visible light (Draper point)

  function lobulo(l, mu, s1, s2) {
    var t = (l - mu) / (l < mu ? s1 : s2);
    return Math.exp(-0.5 * t * t);
  }
  function cmf(l) { // CIE 1931 2°, fit by Wyman et al. (2013)
    return [
      1.056 * lobulo(l, 599.8, 37.9, 31.0) + 0.362 * lobulo(l, 442.0, 16.0, 26.7) - 0.065 * lobulo(l, 501.1, 20.4, 26.2),
      0.821 * lobulo(l, 568.8, 46.9, 40.5) + 0.286 * lobulo(l, 530.9, 16.3, 31.1),
      1.217 * lobulo(l, 437.0, 11.8, 36.0) + 0.681 * lobulo(l, 459.0, 26.0, 13.8),
    ];
  }
  function xyzALineal(X, Y, Z) { // XYZ -> linear sRGB (D65)
    return [
      Math.max(0, 3.2406 * X - 1.5372 * Y - 0.4986 * Z),
      Math.max(0, -0.9689 * X + 1.8758 * Y + 0.0415 * Z),
      Math.max(0, 0.0557 * X - 0.204 * Y + 1.057 * Z),
    ];
  }
  function gammaSRGB(v) {
    v = clamp(v, 0, 1);
    return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }

  // Black body at T (°C): linear hue and relative luminance.
  var cacheCuerpoNegro = {};
  function cuerpoNegro(tC) {
    var clave = Math.round(tC / 5) * 5;
    if (cacheCuerpoNegro[clave]) return cacheCuerpoNegro[clave];
    var T = clave + 273.15, X = 0, Y = 0, Z = 0;
    for (var l = 380; l <= 780; l += 5) {
      var lm = l * 1e-9;
      var B = 1 / (Math.pow(lm, 5) * (Math.exp(C2 / (lm * T)) - 1)); // Planck (without constants)
      var c = cmf(l);
      X += B * c[0]; Y += B * c[1]; Z += B * c[2];
    }
    return (cacheCuerpoNegro[clave] = { rgb: cromaticidad(xyzALineal(X, Y, Z)), Y: Y });
  }

  // Normalizes a linear color so its largest channel is 1 (hue only).
  function cromaticidad(rgb) {
    var m = Math.max(rgb[0], rgb[1], rgb[2]) || 1;
    return [rgb[0] / m, rgb[1] / m, rgb[2] / m];
  }

  // Hue of the reaction zone: emission of CH* (431 nm) + C2* (Swan band,
  // 516 nm). The real ratio varies with the fuel; here C2* weighs half as much
  // as CH* (approximation), which gives the typical blue of a soot-free flame.
  var AZUL_CH = (function () {
    var ch = cmf(431), c2 = cmf(516);
    return cromaticidad(xyzALineal(ch[0] + 0.5 * c2[0], ch[1] + 0.5 * c2[1], ch[2] + 0.5 * c2[2]));
  })();

  // On-screen color of a point of the flame.
  //  tC: local temperature; hollinLocal: 0 (no soot) to 1; tRef: temperature of the hottest zone.
  function colorLlama(tC, hollinLocal, tRef) {
    var rgb = [0, 0, 0];
    // Soot opacity: with a little soot, its brightness already dominates over CH*/C2*.
    var hollinVisible = 1 - Math.exp(-4 * hollinLocal);
    if (tC > PUNTO_DRAPER_C) {
      var cn = cuerpoNegro(tC);
      var brillo = Math.pow(cn.Y / cuerpoNegro(tRef).Y, 0.22); // auto exposure + compression
      for (var k = 0; k < 3; k++) rgb[k] += hollinVisible * cn.rgb[k] * brillo * 2.2;
    }
    // CH*/C2*: faint, only visible where there is no soot (that is why sooty flames look yellow)
    var azul = (1 - hollinVisible) * 0.9 * clamp((tC - PUNTO_DRAPER_C) / 500, 0, 1);
    for (var j = 0; j < 3; j++) rgb[j] += AZUL_CH[j] * azul;
    var r = Math.round(255 * gammaSRGB(1 - Math.exp(-rgb[0])));
    var g = Math.round(255 * gammaSRGB(1 - Math.exp(-rgb[1])));
    var b = Math.round(255 * gammaSRGB(1 - Math.exp(-rgb[2])));
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  // Soot along the flame: the base (reaction zone) has almost no soot and is
  // blue; soot appears further up the flame. hollin = value of the fuel.
  function hollinLocal(p, u, frac) {
    var h = p.parametros.hollin * clamp((u - 0.08) / 0.35, 0, 1);
    return clamp(h * (0.7 + 0.3 * (1 - frac)), 0, 1);
  }

  // Name of the dominant color, read from the calculated color of the hottest zone.
  function describirColor(tMax, hollin) {
    var cn = cuerpoNegro(tMax);
    var rel = cn.rgb[1] / cn.rgb[0]; // green/red of the black-body hue: higher = more yellow
    var tono = rel < 0.12 ? "red" : rel < 0.22 ? "reddish orange" : rel < 0.32 ? "orange" : "orange-yellow";
    if (hollin < 0.2) {
      return {
        nombre: "Faint blue",
        explicacion: "Almost no soot: the blue CH* emission of the reaction zone dominates, like the methanol flame described in FLEX. The little soot there is would glow " + tono + " at " + tMax + " °C.",
      };
    }
    return {
      nombre: (hollin < 0.5 ? "Blue base and " + tono + " body" : "Luminous " + tono + " with a blue base"),
      explicacion: "Black-body color of the soot at " + tMax + " °C (Planck's law, CIE 1931). The base looks blue because of the CH* emission where there is no soot yet.",
    };
  }

  // Side bar scale: the same soot colors, over the range of the current flame.
  function escalaTemperatura(tMin, tMax, tRef) {
    var pasos = 12, escala = [];
    for (var i = 0; i <= pasos; i++) {
      var t = tMin + ((tMax - tMin) * i) / pasos;
      escala.push([i / pasos, colorLlama(t, 1, tRef)]);
    }
    return escala;
  }

  // Local temperature in °C at a point of the flame:
  // highest in the center and at the base, lower at the edge and the tip.
  function tempLocal(p, u, frac, factorCapa) {
    var t =
      TEMP_MIN +
      (p.parametros.temperatura - TEMP_MIN) *
        (0.45 + 0.55 * (1 - frac * frac)) *
        (1 - 0.3 * u) *
        factorCapa;
    return clamp(t, TEMP_MIN, TEMP_MAX);
  }

  // ---------- Geometry ----------

  // Generic cylinder (burner and wick) between z0 and z1.
  function crearCilindro(r, z0, z1, color, opacidad, nombre) {
    var NT = 24;
    var x = [];
    var y = [];
    var z = [];
    for (var j = 0; j <= NT; j++) {
      var th = (j / NT) * 2 * Math.PI;
      x.push(r * Math.cos(th), r * Math.cos(th));
      y.push(r * Math.sin(th), r * Math.sin(th));
      z.push(z1, z0);
    }
    x.push(0, 0);
    y.push(0, 0);
    z.push(z1, z0);
    var centroSup = x.length - 2;
    var centroInf = x.length - 1;

    var ii = [];
    var jj = [];
    var kk = [];
    for (var k = 0; k < NT; k++) {
      var sup0 = 2 * k;
      var inf0 = 2 * k + 1;
      var sup1 = 2 * k + 2;
      var inf1 = 2 * k + 3;
      ii.push(sup0, inf0, centroSup, centroInf);
      jj.push(inf0, inf1, sup0, inf1);
      kk.push(sup1, sup1, sup1, inf0);
    }

    return {
      type: "mesh3d",
      x: x,
      y: y,
      z: z,
      i: ii,
      j: jj,
      k: kk,
      color: color,
      opacity: opacidad,
      flatshading: true,
      hoverinfo: "skip",
      showscale: false,
      name: nombre,
    };
  }

  // One layer (surface) of the flame, scaled relative to the outer one.
  // factorCapa: 0.75 (outer) / 0.9 (middle) / 1.0 (inner):
  // the inner layer is hotter, so it reaches higher temperatures.
  function crearCapa(escala, opacidad, factorCapa, p) {
    var NU = 42; // divisions along the height
    var NT = 32; // divisions around
    var x = [];
    var y = [];
    var z = [];
    var tempC = [];

    for (var i = 0; i <= NU; i++) {
      var u = i / NU;
      var zz = p.parametros.baseZ + u * p.parametros.altura;
      var rBase = radioPerfil(u, { parametros: p.parametros });
      for (var j = 0; j <= NT; j++) {
        var theta = (j / NT) * 2 * Math.PI;
        var turb =
          1 +
          0.05 * Math.sin(3 * theta + 8 * u) * (0.3 + 0.7 * p.parametros.gravedad) +
          0.03 * Math.sin(7 * theta - 5 * u);
        var r = rBase * escala * turb;
        var dx = 0.1 * p.parametros.radioMax * u * u * p.parametros.gravedad;
        x.push(r * Math.cos(theta) + dx);
        y.push(r * Math.sin(theta));
        z.push(zz);
        // On the surface frac ~ 1 (edge), so it is the coolest
        // zone of the flame at that height.
        tempC.push(colorLlama(tempLocal(p, u, 1, factorCapa), hollinLocal(p, u, 1), p.parametros.temperatura));
      }
    }

    var ii = [];
    var jj = [];
    var kk = [];
    for (var a = 0; a < NU; a++) {
      for (var b = 0; b < NT; b++) {
        var v0 = a * (NT + 1) + b;
        var v1 = v0 + NT + 1;
        var v2 = v1 + 1;
        var v3 = v0 + 1;
        ii.push(v0, v1);
        jj.push(v1, v2);
        kk.push(v3, v3);
      }
    }

    return {
      type: "mesh3d",
      x: x,
      y: y,
      z: z,
      i: ii,
      j: jj,
      k: kk,
      vertexcolor: tempC, // color calculated at each vertex (Planck + CH*)
      opacity: opacidad,
      flatshading: false,
      lighting: { ambient: 0.7, diffuse: 0.6, specular: 0.4, roughness: 0.6 },
      lightposition: { x: 100, y: 200, z: 1000 },
      hoverinfo: "skip",
      showscale: false,
      name: "Flame",
    };
  }

  // Point cloud inside the volume of the flame.
  function crearVolumen(p) {
    var rand = mulberry32(20261114);
    var N = 2200;
    var x = [];
    var y = [];
    var z = [];
    var temp = [];

    for (var n = 0; n < N; n++) {
      var u = Math.pow(rand(), 1.3);
      var theta = rand() * 2 * Math.PI;
      var frac = Math.sqrt(rand()); // 0 = center, 1 = edge
      var rBase = radioPerfil(u, { parametros: p.parametros });
      var r = rBase * frac;
      var dx = 0.1 * p.parametros.radioMax * u * u * p.parametros.gravedad;
      x.push(r * Math.cos(theta) + dx);
      y.push(r * Math.sin(theta));
      z.push(p.parametros.baseZ + u * p.parametros.altura);
      temp.push(colorLlama(tempLocal(p, u, frac, 1), hollinLocal(p, u, frac), p.parametros.temperatura));
    }

    return {
      type: "scatter3d",
      mode: "markers",
      x: x,
      y: y,
      z: z,
      marker: {
        size: 3,
        color: temp,
        opacity: 0.8,
        line: { width: 0 },
      },
      hoverinfo: "skip",
      name: "Hot volume",
    };
  }

  // Temperature bar: real range of the drawn flame (edge min. - max.)
  // with the same soot colors. It changes with every slider.
  function crearBarraTemperatura(p) {
    var tMin = Math.round(tempLocal({ parametros: p }, 1, 1, 0.75));
    var tMax = p.temperatura;
    return {
      type: "scatter3d",
      mode: "markers",
      x: [0], y: [0], z: [p.baseZ],
      marker: {
        size: 0.1,
        opacity: 0,
        color: [tMax],
        cmin: tMin,
        cmax: tMax,
        colorscale: escalaTemperatura(tMin, tMax, tMax),
        showscale: true,
        colorbar: {
          title: { text: "Temperature (°C)<br><sub>max. " + tMax + " °C</sub>", side: "right" },
          thickness: 12, len: 0.45, x: 0.98, xanchor: "right", y: 0.04, yanchor: "bottom",
          tickfont: { color: "#e5e5e5" },
        },
      },
      hoverinfo: "skip",
      name: "Scale",
    };
  }

  // ---------- Drawing ----------

  // PSI-68 (FLEX-2) compounds: sliders with data-hollin and data-nombre.
  // Returns null if none is active (the generic hydrocarbon is used).
  function leerMezcla() {
    var total = 0, hollin = 0, nombres = [];
    document.querySelectorAll("input[data-compuesto]").forEach(function (el) {
      var v = parseFloat(el.value) || 0;
      if (v <= 0) return;
      total += v;
      hollin += v * parseFloat(el.dataset.hollin);
      nombres.push(el.dataset.nombre + " " + Math.round(v * 100) + " %");
    });
    if (total <= 0) return null;
    return { hollin: hollin / total, nombre: nombres.join(" + ") };
  }

  function leerParametros() {
    var elQuemador = document.getElementById("diametro-quemador");
    return calcularParametros(
      parseFloat(document.getElementById("gravedad").value),
      parseFloat(document.getElementById("oxigeno").value),
      parseFloat(document.getElementById("tamano").value),
      elQuemador ? parseFloat(elQuemador.value) : QUEMADOR_REF_CM,
      leerMezcla()
    );
  }

  function actualizarInfo(p) {
    var set = function (id, texto) {
      var el = document.getElementById(id);
      if (el) el.textContent = texto;
    };
    set("gravedad-valor", p.gravedad.toFixed(2) + " g");
    set("oxigeno-valor", p.oxigeno + " %");
    set("tamano-valor", String(p.tamano));
    set("diametro-valor", p.diametroQuemador.toFixed(1) + " cm");
    set(
      "info-quemador",
      "Ø " + p.diametroQuemador.toFixed(1) + " cm — measurements in cm are scaled ×" +
        p.factorEscala.toFixed(2) + " relative to the 0.6 cm reference"
    );
    set("info-altura", p.altura.toFixed(1) + " cm (approx.)");
    set("info-ancho", p.ancho.toFixed(1) + " cm (approx.)");
    set("info-temperatura", "approx. " + p.temperatura + " °C");
    set("info-forma", p.forma);
    set("info-color", p.colorDominante);
    set("info-color-explicacion", p.colorExplicacion);
    set("info-combustible", p.combustible + " (relative soot " + p.hollin.toFixed(2) + ")");
    set(
      "info-oxigeno",
      p.oxigeno < 18
        ? "Low oxygen: in this model the flame is smaller and cooler."
        : p.oxigeno > 28
          ? "High oxygen: in this model the flame is bigger and hotter."
          : "Oxygen close to that of air (21 %)."
    );
  }

  function dibujar() {
    var p = leerParametros();
    actualizarInfo(p);

    // Burner with the diameter set by the user and a thin wick proportional to it.
    // The flame starts 0.4 cm above it: the cylinder does not hide it.
    var radioQuemador = p.radioQuemador;
    var radioMecha = Math.max(0.03, radioQuemador * 0.2);
    var datos = [
      crearCapa(1.0, 0.28, 0.75, { parametros: p }),
      crearCapa(0.68, 0.4, 0.9, { parametros: p }),
      crearCapa(0.4, 0.55, 1.0, { parametros: p }),
      crearVolumen({ parametros: p }),
      crearBarraTemperatura(p),
      crearCilindro(radioMecha, 0, p.baseZ, "#1e293b", 0.95, "Wick"),
      crearCilindro(radioQuemador, -0.4, 0, "#475569", 0.95, "Burner"),
    ];

    var rango = Math.max(p.altura, p.ancho) * 0.65 + 0.5;
    // FireSpace GX visual style (grey viewer like a 3D editor). Colors and margins only.
    var ejeVisor = {
      color: "#b5b5b5",
      gridcolor: "#565656",
      zerolinecolor: "#7fbf2a",
      backgroundcolor: "#3b3b3b",
      showbackground: true,
      showspikes: false, // no white guide lines on mouse hover
    };
    var layout = {
      paper_bgcolor: "#3b3b3b",
      font: { color: "#e5e5e5", family: "Inter, system-ui, sans-serif" },
      margin: { l: 0, r: 0, t: 0, b: 0 },
      showlegend: false,
      hovermode: false,
      uirevision: "llama", // keeps the user's rotation/zoom when sliders move
      scene: {
        hovermode: false,
        bgcolor: "#3b3b3b",
        xaxis: Object.assign({ title: "X (cm)", range: [-rango, rango] }, ejeVisor),
        yaxis: Object.assign({ title: "Y (cm)", range: [-rango, rango] }, ejeVisor),
        zaxis: Object.assign({ title: "Height (cm)", range: [-1.0, p.baseZ + p.altura + 1.2] }, ejeVisor),
        aspectmode: "manual",
        aspectratio: { x: 1, y: 1, z: 1.3 },
        camera: { eye: { x: 1.7, y: 1.7, z: 0.9 } },
      },
    };

    var config = { responsive: true, displaylogo: false };

    if (window.__llamaDibujada) {
      Plotly.react(GRAFICA_ID, datos, layout, config);
    } else {
      Plotly.newPlot(GRAFICA_ID, datos, layout, config);
      window.__llamaDibujada = true;
    }
    window.__ultimaLlama = p;
    window.dispatchEvent(new CustomEvent("fsgx:llama", { detail: p }));
  }

  function init() {
    var ids = ["gravedad", "oxigeno", "tamano", "diametro-quemador"];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("input", dibujar);
    });
    document.querySelectorAll("input[data-compuesto]").forEach(function (el) {
      el.addEventListener("input", dibujar);
    });
    dibujar();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
