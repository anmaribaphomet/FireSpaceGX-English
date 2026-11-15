/* Shared behavior: side menu + chart utilities */
(function () {
  const app = document.getElementById('app');
  const CLAVE = 'fsgx-sidebar';
  const leer = () => { try { return localStorage.getItem(CLAVE); } catch (e) { return null; } };
  const guardar = (v) => { try { localStorage.setItem(CLAVE, v); } catch (e) {} };

  // On the simulation page and on small screens the menu starts collapsed
  const inicial = leer() ?? (document.body.classList.contains('pagina-simulacion') || innerWidth < 760 ? 'min' : 'max');
  if (inicial === 'min' || innerWidth < 760) app.classList.add('sb-contraida');

  function alternar(forzar) {
    const min = app.classList.toggle('sb-contraida', forzar);
    guardar(min ? 'min' : 'max');
    document.getElementById('btnSidebar').setAttribute('aria-label', min ? 'Expand side menu' : 'Collapse side menu');
    window.dispatchEvent(new Event('fsgx:layout'));
    setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
  }
  document.getElementById('btnSidebar').addEventListener('click', () => alternar());
  document.getElementById('btnMenu').addEventListener('click', () => alternar(false));

  // "?" buttons on each chart: show/hide the caption
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ayuda]');
    if (b) b.closest('.grafica').classList.toggle('leyenda-oculta');
  });
})();

/* ---------- chart utilities (Chart.js) ---------- */
window.FSGX = window.FSGX || {};
FSGX.colores = {
  metano: '#22d3ee', etileno: '#ff7a1a', propano: '#a78bfa', metanol: '#3b82f6',
  etanol: '#3ddc97', heptano: '#ff4d5e', decano: '#ffc93c', pmma: '#f472b6',
};
FSGX.color = (id, i = 0) => FSGX.colores[id] || ['#22d3ee', '#ff7a1a', '#a78bfa', '#3ddc97'][i % 4];

FSGX.configurarChart = function () {
  if (!window.Chart) return;
  Chart.defaults.color = '#8584a6';
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.font.size = 11;
  Chart.defaults.borderColor = 'rgba(255,255,255,.06)';
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.legend.labels.boxHeight = 10;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.animation.duration = 450;
};

/* Horizontal threshold line (danger zone) */
FSGX.pluginUmbral = {
  id: 'umbral',
  afterDraw(chart, _a, opts) {
    if (opts == null || opts.valor == null) return;
    const y = chart.scales.y; const x = chart.scales.x || chart.chartArea;
    if (!y) return;
    const py = y.getPixelForValue(opts.valor);
    const { ctx, chartArea: a } = chart;
    ctx.save();
    ctx.fillStyle = 'rgba(255,77,94,.07)';
    ctx.fillRect(a.left, a.top, a.right - a.left, py - a.top);
    ctx.strokeStyle = '#ff4d5e'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = '#ff8a95'; ctx.font = '600 10px Inter, sans-serif';
    ctx.fillText(opts.texto || 'Risk threshold', a.left + 6, py - 5);
    ctx.restore();
  },
};

/* Gauge-style ring */
FSGX.anillo = function (canvas, valor, max, colores) {
  return new Chart(canvas, {
    type: 'doughnut',
    data: { datasets: [{ data: [valor, Math.max(0, max - valor)], backgroundColor: [colores, '#141b4a'], borderWidth: 0 }] },
    options: { cutout: '78%', plugins: { legend: { display: false }, tooltip: { enabled: false } }, animation: { duration: 500 } },
  });
};

FSGX.degradado = function (ctx, area, c1, c2) {
  const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, c1); g.addColorStop(1, c2); return g;
};

/* Client-side risk index */
FSGX.peligrosidad = function (c) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const vol = c.flash == null ? 1 : cl((60 - c.flash) / 80);
  const rea = c.lfl ? cl(1.2 / c.lfl) : 0.25;
  const ran = c.lfl ? cl((c.ufl - c.lfl) / 35) : 0.1;
  return 0.32 * vol + 0.28 * rea + 0.15 * ran + 0.25 * cl(c.dhc / 50);
};
