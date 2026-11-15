/* =====================================================================
   FireSpace GX · Home
   Sample dashboard (PSI-68). Self-contained: it only needs Chart.js
   (it does not use any app.py route).
   ===================================================================== */
(function () {
  'use strict';

  /* ---------- sample dashboard data ----------
     Fuel properties: approximate reference values from open literature.
     Series per test (heat, oxygen): DEMO DATA. When ApiGx builds dashboards
     from data/firespace.db, replace this data with that response using the same format. */
  const COMBUSTIBLES = {
    metano:  { nombre: 'Methane',    programa: 'ACME', lfl: 5.0,  ufl: 15.0, flash: null, dhc: 50.0, color: '#22d3ee' },
    etileno: { nombre: 'Ethylene',  programa: 'ACME', lfl: 2.7,  ufl: 36.0, flash: null, dhc: 47.2, color: '#ff7a1a' },
    heptano: { nombre: 'n-Heptane', programa: 'FLEX', lfl: 1.05, ufl: 6.7,  flash: -4,   dhc: 44.6, color: '#ff4d5e' },
    metanol: { nombre: 'Methanol',  programa: 'FLEX', lfl: 6.0,  ufl: 36.0, flash: 11,   dhc: 19.9, color: '#3b82f6' },
  };
  const EJEMPLO = {
    aviso: 'Demo data generated to show the kind of dashboard ApiGx creates.',
    ensayos: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'],
    oxigeno: [17, 19, 21, 21, 25, 27, 30, 34],
    umbral: 70,
    calor: {
      metano:  [22, 30, 41, 38, 52, 47, 58, 61],
      etileno: [35, 44, 50, 63, 71, 66, 78, 82],
      heptano: [28, 39, 55, 49, 60, 74, 69, 77],
      metanol: [12, 15, 19, 18, 24, 22, 27, 29],
    },
  };

  const clamp = (v) => Math.max(0, Math.min(1, v));
  const r1 = (v) => Math.round(v * 10) / 10;
  function componentesRiesgo(c) {
    return {
      volatilidad: r1(32 * (c.flash == null ? 1 : clamp((60 - c.flash) / 80))),
      reactividad: r1(28 * clamp(1.2 / c.lfl)),
      rango: r1(15 * clamp((c.ufl - c.lfl) / 35)),
      energia: r1(25 * clamp(c.dhc / 50)),
    };
  }
  function construirDatos() {
    return {
      aviso: EJEMPLO.aviso, ensayos: EJEMPLO.ensayos, oxigeno: EJEMPLO.oxigeno, umbral: EJEMPLO.umbral,
      compuestos: Object.entries(EJEMPLO.calor).map(([id, serie]) => {
        const c = COMBUSTIBLES[id];
        const cruce = serie.findIndex((v) => v >= EJEMPLO.umbral);
        return {
          id, nombre: c.nombre, programa: c.programa, color: c.color, lfl: c.lfl, ufl: c.ufl,
          calor: serie, pico: Math.max(...serie),
          oxigeno_cruce: cruce >= 0 ? EJEMPLO.oxigeno[cruce] : null,
          componentes: componentesRiesgo(c),
        };
      }),
    };
  }

  /* ---------- global Chart.js style ---------- */
  function configurarChart() {
    Chart.defaults.color = '#8584a6';
    Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
    Chart.defaults.font.size = 11;
    Chart.defaults.borderColor = 'rgba(255,255,255,.06)';
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.maintainAspectRatio = false;
  }

  /* Red band + dashed line for the risk threshold */
  const pluginUmbral = {
    id: 'umbral',
    afterDraw(chart, _args, opts) {
      if (!opts || opts.valor == null || !chart.scales.y) return;
      const { ctx, chartArea: a } = chart;
      const y = chart.scales.y.getPixelForValue(opts.valor);
      ctx.save();
      ctx.fillStyle = 'rgba(255,77,94,.07)';
      ctx.fillRect(a.left, a.top, a.right - a.left, y - a.top);
      ctx.strokeStyle = '#ff4d5e';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(a.left, y); ctx.lineTo(a.right, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff8a95';
      ctx.font = '600 10px Inter, sans-serif';
      ctx.fillText(opts.texto || 'Risk threshold', a.left + 6, y - 5);
      ctx.restore();
    },
  };

  function degradado(chart, color) {
    const a = chart.chartArea;
    if (!a) return 'transparent';
    const g = chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
    g.addColorStop(0, color + '55');
    g.addColorStop(1, color + '00');
    return g;
  }

  /* ---------- 1) Heat release per test ---------- */
  function graficaCalor(d) {
    new Chart(document.getElementById('gCalor'), {
      type: 'line',
      data: {
        labels: d.ensayos.map((e, i) => `${e} · ${d.oxigeno[i]}%`),
        datasets: d.compuestos.map((c) => ({
          label: c.nombre,
          data: c.calor,
          borderColor: c.color,
          backgroundColor: (ctx) => degradado(ctx.chart, c.color),
          fill: true, tension: 0.42, pointRadius: 3, borderWidth: 2.5,
        })),
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: { y: { min: 0, max: 100, title: { display: true, text: 'Relative heat (0-100)' } } },
        plugins: { umbral: { valor: d.umbral, texto: `Risk threshold (${d.umbral})` } },
      },
      plugins: [pluginUmbral],
    });
  }

  /* ---------- 2) Peak value per compound (rings) ---------- */
  function kpis(d) {
    const cont = document.getElementById('kpisEjemplo');
    cont.innerHTML = '';
    d.compuestos.forEach((c) => {
      const peligro = c.pico >= d.umbral;
      const color = peligro ? '#ff7a1a' : '#22d3ee';
      const el = document.createElement('div');
      el.className = 'kpi';
      el.innerHTML =
        `<div class="kpi__anillo"><canvas></canvas>
           <div class="kpi__valor" style="color:${peligro ? '#ffa24d' : '#22d3ee'}"><div>${c.pico}<small>/ 100</small></div></div>
         </div>
         <span class="kpi__nombre">${c.nombre}</span>`;
      cont.appendChild(el);
      new Chart(el.querySelector('canvas'), {
        type: 'doughnut',
        data: { datasets: [{ data: [c.pico, 100 - c.pico], backgroundColor: [color, '#141b4a'], borderWidth: 0 }] },
        options: { cutout: '78%', plugins: { legend: { display: false }, tooltip: { enabled: false } } },
      });
    });
  }

  /* ---------- 3) Breakdown of the risk index ---------- */
  function graficaComponentes(d) {
    const capas = [
      ['volatilidad', 'Volatility', '#ff4d5e'],
      ['reactividad', 'Reactivity', '#ff7a1a'],
      ['rango', 'Flammable range', '#ffc93c'],
      ['energia', 'Energy', '#22d3ee'],
    ];
    new Chart(document.getElementById('gComponentes'), {
      type: 'bar',
      data: {
        labels: d.compuestos.map((c) => c.nombre),
        datasets: capas.map(([k, nombre, color]) => ({
          label: nombre,
          data: d.compuestos.map((c) => c.componentes[k]),
          backgroundColor: color, borderRadius: 3, barPercentage: 0.6,
        })),
      },
      options: {
        scales: { x: { stacked: true }, y: { stacked: true, max: 100, title: { display: true, text: 'Index (0-100)' } } },
      },
    });
  }

  /* ---------- 4) Sensitivity to oxygen ---------- */
  function graficaOxigeno(d) {
    new Chart(document.getElementById('gOxigeno'), {
      type: 'bubble',
      data: {
        datasets: d.compuestos.map((c) => ({
          label: c.nombre,
          data: c.calor.map((v, i) => ({ x: d.oxigeno[i], y: v, r: 3 + v / 12 })),
          backgroundColor: c.color + '99',
          borderColor: c.color,
        })),
      },
      options: {
        scales: {
          x: { min: 15, max: 36, title: { display: true, text: 'O₂ (%)' } },
          y: { min: 0, max: 100, title: { display: true, text: 'Relative heat' } },
        },
        plugins: { umbral: { valor: d.umbral, texto: 'Risk peak' } },
      },
      plugins: [pluginUmbral],
    });
  }

  /* ---------- 5) Flammability ranges ---------- */
  function rangos(d) {
    const escala = 40; // % vol covered by the full width
    document.getElementById('rangosEjemplo').innerHTML = d.compuestos.map((c) => `
      <div class="rango">
        <div class="rango__cab"><span>${c.nombre} · ${c.programa}</span><span>${c.lfl}% – ${c.ufl}%</span></div>
        <div class="rango__pista">
          <div class="rango__barra" style="left:${(c.lfl / escala) * 100}%;width:${((c.ufl - c.lfl) / escala) * 100}%"></div>
        </div>
      </div>`).join('');
  }

  /* ---------- Summary: what amount is a risk peak? ---------- */
  function resumen(d) {
    const cruzan = d.compuestos.filter((c) => c.oxigeno_cruce != null);
    const seguros = d.compuestos.filter((c) => c.oxigeno_cruce == null);
    let html = cruzan.length
      ? `<strong style="color:#ffa24d">Risk peak:</strong> exceeded the threshold: ` +
        cruzan.map((c) => `${c.nombre} from ${c.oxigeno_cruce}% O₂`).join(', ') + '.'
      : 'No compound exceeded the risk threshold in this series.';
    if (seguros.some((c) => c.id === 'metanol')) {
      html += ' Methanol never exceeded it, but its almost invisible flame makes it hard to detect.';
    }
    document.getElementById('resumenPico').innerHTML = html;
  }

  /* ---------- start ---------- */
  function iniciar() {
    const resumenEl = document.getElementById('resumenPico');
    if (!resumenEl) return; // we are not on the home page

    if (typeof Chart === 'undefined') {
      resumenEl.textContent = 'Chart.js could not be loaded. Check your connection or the Chart.js <script> tag.';
      return;
    }
    configurarChart();

    try {
      const d = construirDatos();

      document.getElementById('avisoDemo').textContent = d.aviso;
      graficaCalor(d);
      kpis(d);
      graficaComponentes(d);
      graficaOxigeno(d);
      rangos(d);
      resumen(d);
    } catch (err) {
      console.error('Home dashboard:', err);
      resumenEl.textContent = 'The dashboard data could not be loaded (' + err.message + ').';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
