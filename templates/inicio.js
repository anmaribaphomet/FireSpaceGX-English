/* Sample dashboard (PSI-68) of the home page — old unused version; the active one is static/js/inicio.js */
(async function () {
  FSGX.configurarChart();
  const [ej, cat] = await Promise.all([
    fetch('/api/ejemplo').then((r) => r.json()),
    fetch('/api/catalogo').then((r) => r.json()),
  ]);
  const porId = Object.fromEntries(cat.combustibles.map((c) => [c.id, c]));
  const umbral = ej.umbral_riesgo;
  document.getElementById('avisoDemo').textContent = ej.aviso;

  // 1) Heat release per test -------------------------------------
  new Chart(document.getElementById('gCalor'), {
    type: 'line',
    data: {
      labels: ej.ensayos.map((e, i) => `${e} · ${ej.oxigeno[i]}%`),
      datasets: ej.combustibles.map((id, i) => ({
        label: porId[id].nombre,
        data: ej.calor[id],
        borderColor: FSGX.color(id, i),
        backgroundColor: (c) => c.chart.chartArea
          ? FSGX.degradado(c.chart.ctx, c.chart.chartArea, FSGX.color(id, i) + '55', FSGX.color(id, i) + '00') : 'transparent',
        fill: true, tension: 0.42, pointRadius: 3, borderWidth: 2.5,
      })),
    },
    options: {
      scales: { y: { min: 0, max: 100, title: { display: true, text: 'Relative heat (0-100)' } } },
      plugins: { umbral: { valor: umbral, texto: `Risk threshold (${umbral})` } },
      interaction: { mode: 'index', intersect: false },
    },
    plugins: [FSGX.pluginUmbral],
  });

  // 2) Peak KPIs -------------------------------------------------------
  const kpis = document.getElementById('kpisEjemplo');
  ej.combustibles.forEach((id) => {
    const max = Math.max(...ej.calor[id]);
    const el = document.createElement('div');
    el.className = 'kpi';
    el.innerHTML = `<div class="kpi__anillo"><canvas></canvas><div class="kpi__valor"><div>${max}<small>/ 100</small></div></div></div>
                    <span class="kpi__nombre">${porId[id].nombre}</span>`;
    el.querySelector('.kpi__valor').style.color = max >= umbral ? '#ffa24d' : '#22d3ee';
    kpis.appendChild(el);
    FSGX.anillo(el.querySelector('canvas'), max, 100, max >= umbral ? '#ff7a1a' : '#22d3ee');
  });

  // 3) Index components --------------------------------------------
  const cl = (v) => Math.max(0, Math.min(1, v));
  const comps = ej.combustibles.map((id) => {
    const c = porId[id];
    return {
      vol: 32 * (c.flash == null ? 1 : cl((60 - c.flash) / 80)),
      rea: 28 * (c.lfl ? cl(1.2 / c.lfl) : 0.25),
      ran: 15 * (c.lfl ? cl((c.ufl - c.lfl) / 35) : 0.1),
      ene: 25 * cl(c.dhc / 50),
    };
  });
  const capas = [['vol', 'Volatility', '#ff4d5e'], ['rea', 'Reactivity', '#ff7a1a'], ['ran', 'Flammable range', '#ffc93c'], ['ene', 'Energy', '#22d3ee']];
  new Chart(document.getElementById('gComponentes'), {
    type: 'bar',
    data: {
      labels: ej.combustibles.map((id) => porId[id].nombre),
      datasets: capas.map(([k, n, col]) => ({ label: n, data: comps.map((c) => +c[k].toFixed(1)), backgroundColor: col, borderRadius: 3, barPercentage: 0.6 })),
    },
    options: { scales: { x: { stacked: true }, y: { stacked: true, max: 100, title: { display: true, text: 'Index (0-100)' } } } },
  });

  // 4) Sensitivity to oxygen -------------------------------------------
  new Chart(document.getElementById('gOxigeno'), {
    type: 'bubble',
    data: {
      datasets: ej.combustibles.map((id, i) => ({
        label: porId[id].nombre,
        data: ej.calor[id].map((v, k) => ({ x: ej.oxigeno[k], y: v, r: 3 + v / 12 })),
        backgroundColor: FSGX.color(id, i) + '99', borderColor: FSGX.color(id, i),
      })),
    },
    options: {
      scales: { x: { min: 15, max: 36, title: { display: true, text: 'O₂ (%)' } }, y: { min: 0, max: 100, title: { display: true, text: 'Relative heat' } } },
      plugins: { umbral: { valor: umbral, texto: 'Risk peak' } },
    },
    plugins: [FSGX.pluginUmbral],
  });

  // 5) Flammability ranges ------------------------------------------
  const rangos = document.getElementById('rangosEjemplo');
  const escala = 40;
  ej.combustibles.forEach((id) => {
    const c = porId[id];
    rangos.insertAdjacentHTML('beforeend', `
      <div class="rango">
        <div class="rango__cab"><span>${c.nombre} · ${c.programa}</span><span>${c.lfl}% – ${c.ufl}%</span></div>
        <div class="rango__pista"><div class="rango__barra" style="left:${(c.lfl / escala) * 100}%;width:${((c.ufl - c.lfl) / escala) * 100}%"></div></div>
      </div>`);
  });

  // Summary: what amount is a risk peak? ------------------
  const frases = ej.combustibles.map((id) => {
    const k = ej.calor[id].findIndex((v) => v >= umbral);
    return k >= 0 ? `${porId[id].nombre} from ${ej.oxigeno[k]}% O₂` : null;
  }).filter(Boolean);
  document.getElementById('resumenPico').innerHTML = frases.length
    ? `<strong style="color:#ffa24d">Risk peak:</strong> exceeded the threshold: ${frases.join(', ')}.`
      + (ej.combustibles.includes('metanol') && Math.max(...ej.calor.metanol) < umbral ? ' Methanol never exceeded it in this series, but its almost invisible flame makes it hard to detect.' : '')
    : 'No compound exceeded the risk threshold in this series.';
})();
