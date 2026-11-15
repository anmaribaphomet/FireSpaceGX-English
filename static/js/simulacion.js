/* 3GX · 3D simulation of a flame driven by combustion properties (unused Three.js prototype) */
(async function () {
  const cont = document.getElementById('escena');
  const cat = await fetch('/api/catalogo').then((r) => r.json());
  const porId = Object.fromEntries(cat.combustibles.map((c) => [c.id, c]));

  const estado = {
    mezcla: Object.fromEntries(cat.combustibles.map((c) => [c.id, 0])),
    oxigeno: 21, gravedad: 0, flujo: 5, presion: 101.3, entorno: 'iss',
  };
  estado.mezcla.metano = 0.5; // base flame

  /* ======================= scene ======================= */
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x3b3b3b);
  cont.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x3b3b3b, 18, 40);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(4.8, 3.4, 6.2);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.3, 0);
  controls.enableDamping = true;
  controls.minDistance = 2.5; controls.maxDistance = 18;
  controls.maxPolarAngle = Math.PI * 0.495;

  // Floor with a 3D-viewer grid (shader: sharp lines at any distance)
  const suelo = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    extensions: { derivatives: true },
    vertexShader: `varying vec2 vP; void main(){ vP = (modelMatrix*vec4(position,1.)).xz; gl_Position = projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.); }`,
    fragmentShader: `
      varying vec2 vP;
      float linea(vec2 p, float paso){ vec2 g = abs(fract(p/paso - .5) - .5) / fwidth(p/paso); return 1. - min(min(g.x, g.y), 1.); }
      void main(){
        float fina = linea(vP, 1.0) * .35, gruesa = linea(vP, 5.0) * .6;
        float ex = 1. - min(abs(vP.y)/fwidth(vP.y)/1.5, 1.), ez = 1. - min(abs(vP.x)/fwidth(vP.x)/1.5, 1.);
        vec3 c = vec3(.62); float a = max(fina, gruesa);
        if (ex > .01) { c = mix(c, vec3(.5,.78,.16), ex); a = max(a, ex); }
        if (ez > .01) { c = mix(c, vec3(.78,.3,.3), ez); a = max(a, ez*.8); }
        a *= 1. - smoothstep(14., 38., length(vP));
        gl_FragColor = vec4(c, a);
      }`,
  }));
  suelo.rotation.x = -Math.PI / 2;
  scene.add(suelo);

  // Burner / droplet
  const quemador = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.2, 0.5, 24),
    new THREE.MeshStandardMaterial({ color: 0x555a66, metalness: 0.7, roughness: 0.35 }));
  quemador.position.y = 0.25; scene.add(quemador);
  const gota = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0x9fd3ff, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85 }));
  gota.position.y = 1.2; scene.add(gota);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const luzLlama = new THREE.PointLight(0xffa040, 1.5, 9);
  luzLlama.position.set(0, 1.4, 0); scene.add(luzLlama);

  /* ---------- volumetric flame (raymarching) ---------- */
  const uniforms = {
    uTime: { value: 0 },
    uGravedad: { value: 0 },     // 0 = microgravity (sphere), 1 = Earth (teardrop)
    uFlujo: { value: 0.15 },     // sideways drag from the ventilation flow
    uTamano: { value: 0.6 },     // overall size
    uHollin: { value: 0.2 },     // 0 = blue/clean, 1 = yellow/sooty
    uBrillo: { value: 1.0 },     // luminosity
    uTurb: { value: 0.3 },       // turbulence / flicker
    uFrio: { value: 0.0 },       // "cool flame" component
    uInvModel: { value: new THREE.Matrix4() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform mat4 uInvModel;
      varying vec3 vOrigen; varying vec3 vDir;
      void main() {
        vOrigen = (uInvModel * vec4(cameraPosition, 1.0)).xyz;
        vDir = position - vOrigen;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vOrigen; varying vec3 vDir;
      uniform float uTime, uGravedad, uFlujo, uTamano, uHollin, uBrillo, uTurb, uFrio;

      float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 x){
        vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x), mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x), mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y), f.z);
      }
      float fbm(vec3 p){ float a=.5, s=0.; for(int i=0;i<4;i++){ s+=a*noise(p); p*=2.03; a*=.5; } return s; }

      vec2 caja(vec3 o, vec3 d){
        vec3 inv = 1.0/d; vec3 t0 = (vec3(-.5)-o)*inv; vec3 t1 = (vec3(.5)-o)*inv;
        vec3 mn = min(t0,t1), mx = max(t0,t1);
        return vec2(max(max(mn.x,mn.y),mn.z), min(min(mx.x,mx.y),mx.z));
      }

      // Returns (density, temperature)
      vec2 llama(vec3 p){
        // local space: unit box; flame center
        vec3 q = p; q.y += 0.12;
        float g = uGravedad;
        // flow: pushes the flame downstream (x), more at the top
        q.x -= uFlujo * (q.y + 0.35) * (0.6 + 0.6*(1.0-g));
        float rx = 0.17 * uTamano + 0.05;
        float ry = rx * mix(1.0, 3.2, g);
        q.y -= mix(0.0, ry*0.4, g);
        // teardrop taper with buoyancy
        float h = clamp((q.y + ry*0.3)/ry, 0.0, 1.0);
        float r = rx * (1.0 - g*0.75*h*h);
        float t = uTime * (0.5 + 2.2*g);
        float n = fbm(q*vec3(6.0, 4.0, 6.0) + vec3(0.0, -t, 0.0));
        float d = length(q / vec3(r, ry, r));
        d += (n - 0.5) * (0.35 + 1.1*uTurb) ;
        // microgravity: spherical shell (diffusion), Earth: filled core
        float cascaron = exp(-pow((d - 0.78)/0.22, 2.0));
        float lleno = smoothstep(1.0, 0.25, d);
        float dens = mix(cascaron, lleno, g*0.8 + 0.1);
        float temp = clamp(1.15 - d, 0.0, 1.0);
        return vec2(max(dens, 0.0), temp);
      }

      vec3 colorLlama(float temp, float y){
        vec3 azul = vec3(0.15, 0.35, 1.0);
        vec3 naranja = vec3(1.0, 0.32, 0.02);
        vec3 amarillo = vec3(1.0, 0.68, 0.18);
        vec3 hollin = mix(naranja, amarillo, smoothstep(0.2, 0.8, temp));
        // blue base (reaction zone) stronger when there is little soot
        float base = smoothstep(0.05, -0.3, y) * (1.0 - uHollin*0.5) + pow(1.0 - uHollin, 2.0) * 0.55;
        vec3 c = mix(hollin, azul, clamp(base, 0.0, 1.0));
        // cool flame: very faint blue hue
        c = mix(c, vec3(0.35, 0.55, 1.0), uFrio*0.6);
        return c;
      }

      void main(){
        vec3 dir = normalize(vDir);
        vec2 b = caja(vOrigen, dir);
        if (b.x > b.y) discard;
        b.x = max(b.x, 0.0);
        const int PASOS = 72;
        float dt = (b.y - b.x) / float(PASOS);
        vec3 p = vOrigen + dir * (b.x + dt * hash(gl_FragCoord.xyz));
        vec3 acc = vec3(0.0); float alfa = 0.0;
        for (int i = 0; i < PASOS; i++) {
          vec2 dt2 = llama(p);
          float a = dt2.x * dt * 12.0;
          acc += (1.0 - alfa) * colorLlama(dt2.y, p.y) * a * (0.6 + 1.6*dt2.y);
          alfa += (1.0 - alfa) * a * 0.55;
          if (alfa > 0.97) break;
          p += dir * dt;
        }
        vec3 col = 1.0 - exp(-acc * uBrillo * 1.1);
        gl_FragColor = vec4(col, alfa);
      }`,
  });
  const volumen = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  volumen.scale.set(3, 3.6, 3);
  volumen.position.y = 1.6;
  scene.add(volumen);
  volumen.updateMatrixWorld();
  uniforms.uInvModel.value.copy(volumen.matrixWorld).invert();

  function redimensionar() {
    const w = cont.clientWidth, h = cont.clientHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(redimensionar).observe(cont);
  redimensionar();

  /* ======================= properties → flame mapping ======================= */
  const objetivo = {};
  function calcularObjetivo() {
    const m = estado.mezcla;
    const total = Object.values(m).reduce((a, b) => a + b, 0);
    const pond = (f) => (total ? Object.entries(m).reduce((a, [id, v]) => a + f(porId[id]) * v, 0) / total : 0);
    const energia = pond((c) => c.dhc / 50);
    const hollin = pond((c) => c.hollin);
    const o2 = estado.oxigeno / 21;
    const presion = estado.presion / 101.3;
    objetivo.uTamano = total ? Math.min(1.6, 0.35 + 0.55 * Math.sqrt(total) * Math.pow(o2, 0.6) * (0.6 + 0.4 * energia)) : 0;
    // in microgravity there is less visible soot (cooler flame); more O2 → brighter
    objetivo.uHollin = Math.min(1, hollin * (0.6 + 0.6 * estado.gravedad + 0.25 * (o2 - 1)) * Math.sqrt(presion));
    objetivo.uBrillo = total ? (0.35 + 0.65 * energia) * Math.pow(o2, 0.8) * (0.55 + 0.45 * hollin + 0.2) : 0;
    objetivo.uGravedad = estado.gravedad;
    objetivo.uFlujo = estado.flujo / 40;
    objetivo.uTurb = 0.1 + 0.7 * estado.gravedad + estado.flujo / 80;
    objetivo.uFrio = estado.gravedad < 0.1 ? Math.min(1, (m.heptano + m.decano) * 0.8) * 0.5 : 0;
    gota.visible = Object.entries(m).some(([id, v]) => v > 0.01 && porId[id].estado === 'líquido');
    document.getElementById('leyendaEstado').textContent =
      `${estado.gravedad.toFixed(2)} g · ${estado.oxigeno}% O₂ · ${estado.flujo} cm/s · ${estado.presion} kPa`;
  }

  const reloj = new THREE.Clock();
  (function animar() {
    requestAnimationFrame(animar);
    const dt = Math.min(reloj.getDelta(), 0.05);
    uniforms.uTime.value += dt;
    for (const k in objetivo) uniforms[k].value += (objetivo[k] - uniforms[k].value) * Math.min(1, dt * 4);
    const parpadeo = 1 + Math.sin(uniforms.uTime.value * 13) * 0.08 * uniforms.uGravedad.value;
    luzLlama.intensity = uniforms.uBrillo.value * 1.6 * parpadeo;
    luzLlama.color.setRGB(1, 0.55 + 0.2 * (1 - uniforms.uHollin.value), 0.25 + 0.6 * (1 - uniforms.uHollin.value));
    controls.update();
    renderer.render(scene, camera);
  })();

  /* ======================= sliders panel ======================= */
  const panel = document.getElementById('panelSliders');
  const deslizador = (clave, etiqueta, min, max, paso, valor, sufijo, nota = '') => `
    <label class="deslizador">${etiqueta} <output data-out="${clave}">${valor}${sufijo}</output>
      <input type="range" data-clave="${clave}" data-sufijo="${sufijo}" min="${min}" max="${max}" step="${paso}" value="${valor}">
      ${nota ? `<span class="mini">${nota}</span>` : ''}
    </label>`;

  const vistas = {
    combustibles: () => cat.combustibles.map((c) =>
      deslizador('mezcla.' + c.id, c.nombre, 0, 1, 0.05, estado.mezcla[c.id], '', `${c.estado} · ${c.programa}`)).join(''),
    condiciones: () =>
      deslizador('oxigeno', 'Oxygen', 15, 40, 1, estado.oxigeno, '%', 'ISS 21% · exploration 34%') +
      deslizador('gravedad', 'Gravity', 0, 1, 0.01, estado.gravedad, ' g', 'Moon 0.17 · Mars 0.38') +
      deslizador('flujo', 'Air flow', 0, 40, 1, estado.flujo, ' cm/s', 'cabin ventilation') +
      deslizador('presion', 'Pressure', 30, 110, 0.5, estado.presion, ' kPa'),
    entorno: () => `<div class="entornos">${Object.entries(cat.entornos).map(([k, e]) =>
      `<button class="chip" type="button" data-entorno="${k}" aria-pressed="${estado.entorno === k}">${e.nombre}</button>`).join('')}</div>
      <p style="font-size:11px;color:#bbb;margin:10px 0 0">Applies the typical gravity, O₂ and pressure of each habitable zone.</p>`,
  };
  const filtro = document.getElementById('filtro');
  const pintarPanel = () => { panel.innerHTML = vistas[filtro.value](); };
  filtro.addEventListener('change', pintarPanel);

  panel.addEventListener('input', (e) => {
    const inp = e.target.closest('[data-clave]');
    if (!inp) return;
    const v = parseFloat(inp.value);
    const [a, b] = inp.dataset.clave.split('.');
    if (b) estado.mezcla[b] = v; else estado[a] = v;
    estado.entorno = null;
    panel.querySelector(`[data-out="${inp.dataset.clave}"]`).textContent = v + inp.dataset.sufijo;
    cambio();
  });
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-entorno]');
    if (!b) return;
    const en = cat.entornos[b.dataset.entorno];
    Object.assign(estado, { gravedad: en.gravedad, oxigeno: en.oxigeno, presion: en.presion, entorno: b.dataset.entorno });
    pintarPanel(); cambio();
  });

  /* ======================= analysis (models) ======================= */
  let temporizador, peticion = 0;
  function cambio() {
    calcularObjetivo();
    clearTimeout(temporizador);
    temporizador = setTimeout(analizar, 250);
  }
  async function analizar() {
    const id = ++peticion;
    const r = await fetch('/api/simulacion/analizar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(estado),
    }).then((x) => x.json()).catch(() => null);
    if (!r || id !== peticion) return;
    document.getElementById('medBarra').style.width = r.riesgo + '%';
    document.getElementById('medBarra').style.background = r.nivel === 'peligro' ? '#ff4d5e' : r.nivel === 'precaución' ? '#ffc93c' : '#3ddc97';
    const val = document.getElementById('medValor');
    val.textContent = `${r.riesgo} / 100`;
    val.style.color = r.nivel === 'peligro' ? '#ff4d5e' : r.nivel === 'precaución' ? '#ffc93c' : '#3ddc97';
    document.getElementById('anTexto').textContent = r.texto;
    const ul = document.getElementById('anAlertas'); ul.innerHTML = '';
    r.alertas.forEach((a) => { const li = document.createElement('li'); li.textContent = a; ul.appendChild(li); });
    document.getElementById('anBases').innerHTML = r.bases.length
      ? '<strong>Based on:</strong> ' + r.bases.map((b) => `<span title="${b.descripcion.replace(/"/g, '&quot;')}">${b.programa}</span>`).join(' · ')
        + '<br>Demo heuristic model: connect to the ApiGx predictive models.'
      : '';
  }

  document.getElementById('btnPlegar').addEventListener('click', (e) => {
    const p = document.getElementById('panelAnalisis').classList.toggle('plegado');
    e.currentTarget.textContent = p ? '+' : '–';
  });
  addEventListener('fsgx:layout', () => setTimeout(redimensionar, 300));

  pintarPanel();
  cambio();
})();