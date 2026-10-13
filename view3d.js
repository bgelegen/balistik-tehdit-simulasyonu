'use strict';
/* view3d.js — sinematik 3B görünüm (Three.js r128).
   1 sahne birimi = 1000 km; modeller metre cinsindendir (×1e-6). Uzak görünümlerde modeller
   görünürlük için büyütülür ve HUD bunu belirtir. Dünya, tesisler ve hedefler kurgusaldır. */
const View3D = (() => {
  const K = 1e-3, MS = 1e-6, MINPX = 14, MAXP = 3600;
  let pipR = null, pipGl = null; const pipSz = new THREE.Vector2();
  let ok = false, host, renderer, composer = null, bloom = null, scene, camera, pipCam, hudCv, hud, W = 1, H = 1, dpr = 1;
  let U, Wd, Nn, sunDir, earthMat, clouds, halo, rim, stars, sunSpr, dome, padF, batF, padG = null, bat = null;
  let envelope = null, beams = null, fcBeams = null, radarW = null;
  let missileM = null, busM = null, busEntry = null, fair = null, lastNoz = null, lastSimT = 0, maxExag = 1, mTrail = null;
  let userMode = 'auto', curKey = 'pad', tA, tB, tC, Yax;
  const models = new Map(), lines = new Map(), smoke = [], glow = [], flashes = [], seenFx = new WeakSet();
  let smokeIdx = 0, glowIdx = 0, scaled = [], smokeB = null, glowB = null;
  const ctl = { az: 0, el: 0, zoom: 1, drag: null };
  const cs = { key: '', blend: 1, fromTR: null, fromPR: null, curT: null, tgtS: null, dS: 0, fov: 45, init: false };
  const pip = { on: false, w: 1, h: 1 };
  let pipCv = null, pctx = null;
  const CLOSE = new Set(['pad', 'track', 'chase', 'bus', 'busWide']);
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  /* ---------- kurulum ---------- */
  function init(el) {
    host = el;
    if (!window.THREE) { host.insertAdjacentHTML('beforeend', '<p class="v3d-fail">3B görünüm için Three.js yüklenemedi. İnternet bağlantısını kontrol edin.</p>'); return; }
    ok = true;
    tA = new THREE.Vector3(); tB = new THREE.Vector3(); tC = new THREE.Vector3(); Yax = new THREE.Vector3(0, 1, 0);
    Models3D.init();
    renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    host.prepend(renderer.domElement);
    hudCv = document.createElement('canvas'); hudCv.className = 'hud';
    renderer.domElement.after(hudCv); hud = hudCv.getContext('2d');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02040a);
    scene.fog = new THREE.Fog(0xbcd8f2, 0.003, 0.12);
    camera = new THREE.PerspectiveCamera(45, 1, 1e-7, 4000);
    pipCam = new THREE.PerspectiveCamera(55, 1.6, 1e-7, 4000);
    basis();
    sunDir = U.clone().multiplyScalar(0.75).addScaledVector(Wd, 0.45).addScaledVector(Nn, 0.55).normalize();

    earthMat = new THREE.MeshPhongMaterial({ color: 0x24557a, shininess: 16, specular: new THREE.Color(0x223344) });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(R_E * K, 256, 192), earthMat));
    clouds = new THREE.Mesh(new THREE.SphereGeometry((R_E + 9) * K, 128, 96), new THREE.MeshLambertMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    scene.add(clouds);
    halo = glowShell((R_E + 160) * K, THREE.BackSide, 0.7, 4.0, 0x4f9dff);
    rim = glowShell((R_E + KARMAN) * K, THREE.FrontSide, 1.0, 5.0, 0x7fc4ff);
    dome = makeDome();
    scene.add(halo, rim, dome);

    const sun = new THREE.DirectionalLight(0xfff3e2, 1.25); sun.position.copy(sunDir).multiplyScalar(100);
    const hemi = new THREE.HemisphereLight(0xa9c4e6, 0x4a4030, 0.3); hemi.position.copy(U);
    scene.add(sun, hemi, new THREE.AmbientLight(0x1c2838, 0.3));
    sunSpr = Models3D.sprite(0xfff1d6); sunSpr.position.copy(sunDir).multiplyScalar(600); sunSpr.scale.set(30, 30, 1); scene.add(sunSpr);
    stars = makeStars(); scene.add(stars);

    // duman ve kıvılcımlar: her biri ayrı sprite yerine tek çizim çağrısıyla çizilen toplu parçacık katmanları
    for (let i = 0; i < 1800; i++) smoke.push({ s: particleState(0xe9e5dd), vel: new THREE.Vector3(), age: 0, life: 1, s0: 1, s1: 1, a: 1, drag: 0, alive: false });
    for (let i = 0; i < 700; i++) glow.push({ s: particleState(0xffb070), vel: new THREE.Vector3(), age: 0, life: 1, px0: 4, px1: 1, alive: false });
    smokeB = particleBatch(smoke.length, Models3D.smokeTex, THREE.NormalBlending, true, true); scene.add(smokeB.mesh);
    glowB = particleBatch(glow.length, Models3D.glowTex, THREE.AdditiveBlending, false, false); scene.add(glowB.mesh);
    // radar ışınları: izleme (camgöbeği) ve atış kontrol (kehribar)
    const segs = (col, op) => {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(80 * 6), 3)); g.setDrawRange(0, 0);
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      l.frustumCulled = false; scene.add(l); return l;
    };
    beams = segs(0x46c8d8, 0.22); fcBeams = segs(0xffb44a, 0.75);

    if (THREE.EffectComposer && THREE.RenderPass && THREE.UnrealBloomPass) {
      try {
        composer = new THREE.EffectComposer(renderer);
        composer.addPass(new THREE.RenderPass(scene, camera));
        bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.45, 0.84);
        composer.addPass(bloom);
      } catch (e) { composer = null; bloom = null; }
    }

    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', e => { ctl.drag = { x: e.clientX, y: e.clientY }; dom.setPointerCapture(e.pointerId); });
    dom.addEventListener('pointermove', e => {
      if (!ctl.drag) return;
      ctl.az -= (e.clientX - ctl.drag.x) * 0.006; ctl.el = clamp(ctl.el + (e.clientY - ctl.drag.y) * 0.005, -1.3, 1.3);
      ctl.drag = { x: e.clientX, y: e.clientY };
    });
    dom.addEventListener('pointerup', () => { ctl.drag = null; });
    dom.addEventListener('dblclick', () => { ctl.az = ctl.el = 0; ctl.zoom = 1; });
    dom.addEventListener('wheel', e => { e.preventDefault(); ctl.zoom = clamp(ctl.zoom * Math.exp(e.deltaY * 0.0012), 0.08, 12); }, { passive: false });
    new ResizeObserver(resize).observe(host); resize();

    const blobs = [U.clone()];
    for (const S of [3000, 5500, 8000]) { const th = S / R_E; blobs.push(U.clone().multiplyScalar(Math.cos(th)).addScaledVector(Wd, Math.sin(th))); }
    setTimeout(() => Models3D.earthTextures(blobs, (m, s, c) => {
      earthMat.map = m; earthMat.specularMap = s; earthMat.color.set(0xffffff); earthMat.specular.set(0x556677); earthMat.needsUpdate = true;
      clouds.material.map = c; clouds.material.opacity = 0.8; clouds.material.needsUpdate = true;
      host.classList.add('ready');
    }), 60);
  }

  function resize() {
    if (!ok) return;
    const r = host.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height); dpr = Math.min(devicePixelRatio || 1, 2);
    renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix();
    if (composer) { composer.setPixelRatio(Math.min(dpr, 1.5)); composer.setSize(W, H); }
    hudCv.width = Math.round(W * dpr); hudCv.height = Math.round(H * dpr);
  }

  function basis() {
    const lat = 0.42, lon = 0.9;
    U = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
    const north = new THREE.Vector3(0, 1, 0).addScaledVector(U, -U.y).normalize();
    const east = new THREE.Vector3().crossVectors(north, U).normalize();
    Wd = north.clone().multiplyScalar(Math.cos(0.95)).addScaledVector(east, Math.sin(0.95)).normalize();
    Nn = new THREE.Vector3().crossVectors(U, Wd).normalize();
  }
  function toV(x, y, z, out) { return out.set(0, 0, 0).addScaledVector(U, x * K).addScaledVector(Wd, y * K).addScaledVector(Nn, (z || 0) * K); }
  function dirV(o, out) {
    out.set(0, 0, 0).addScaledVector(U, o.vx).addScaledVector(Wd, o.vy).addScaledVector(Nn, o.vz || 0);
    return out.lengthSq() > 1e-12 ? out.normalize() : toV(o.x, o.y, o.z, out).normalize();
  }
  function frameAt(s, c) {
    const th = s / R_E;
    const up = U.clone().multiplyScalar(Math.cos(th)).addScaledVector(Wd, Math.sin(th));
    const fwd = U.clone().multiplyScalar(-Math.sin(th)).addScaledVector(Wd, Math.cos(th));
    return { o: up.clone().multiplyScalar(R_E * K).addScaledVector(Nn, c * K), up, fwd, side: Nn.clone() };
  }
  function placeSite(g, F) {
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(F.side, F.up, F.fwd));
    g.position.copy(F.o); g.scale.setScalar(MS); scene.add(g); g.updateMatrixWorld(true);
  }

  function glowShell(r, side, base, pow, color) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { c: { value: new THREE.Color(color) }, b: { value: base }, p: { value: pow }, f: { value: 1 } },
      vertexShader: '#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv;\n#include <logdepthbuf_vertex>\n}',
      fragmentShader: '#include <logdepthbuf_pars_fragment>\nuniform vec3 c; uniform float b; uniform float p; uniform float f; varying vec3 vN; varying vec3 vV; void main(){\n#include <logdepthbuf_fragment>\n' + (side === THREE.BackSide
        ? 'float i = pow(clamp(b - dot(vN, vec3(0.0,0.0,1.0)), 0.0, 1.0), p) * f; gl_FragColor = vec4(c, 1.0) * i; }'
        : 'float k = pow(1.0 - abs(dot(vN, vV)), p) * b * f; gl_FragColor = vec4(c * k, k); }'),
      side, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, extensions: { fragDepth: true },
    });
    return new THREE.Mesh(new THREE.SphereGeometry(r, 96, 64), mat);
  }
  // gökyüzü kubbesi: ufukta pus, tepede koyu mavi, güneş çevresinde parlama; irtifa arttıkça kaybolur
  function makeDome() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { up: { value: new THREE.Vector3(0, 1, 0) }, sun: { value: sunDir.clone() }, alt: { value: 0 }, op: { value: 1 } },
      vertexShader: '#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec3 vD; void main(){ vD = position; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv;\n#include <logdepthbuf_vertex>\n}',
      fragmentShader: `#include <logdepthbuf_pars_fragment>
uniform vec3 up; uniform vec3 sun; uniform float alt; uniform float op; varying vec3 vD;
void main(){
#include <logdepthbuf_fragment>
  vec3 d = normalize(vD); float e = dot(d, up);
  vec3 zen = mix(vec3(0.16,0.37,0.74), vec3(0.01,0.02,0.07), alt);
  vec3 hor = mix(vec3(0.76,0.86,0.95), vec3(0.22,0.38,0.66), alt);
  vec3 col = e > 0.0 ? mix(hor, zen, pow(e, 0.42)) : mix(hor, vec3(0.64,0.67,0.66), clamp(-e * 4.0, 0.0, 1.0));
  float s = max(dot(d, sun), 0.0);
  col += vec3(1.0, 0.93, 0.8) * (pow(s, 1200.0) * 3.0 + pow(s, 16.0) * 0.25 * (1.0 - alt));
  gl_FragColor = vec4(col, op);
}`,
      side: THREE.BackSide, transparent: true, depthWrite: false, extensions: { fragDepth: true },
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), mat);
    m.renderOrder = -10; m.frustumCulled = false;
    return m;
  }
  function makeStars() {
    const n = 2600, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pos[i * 3] = r * Math.cos(t) * 1500; pos[i * 3 + 1] = u * 1500; pos[i * 3 + 2] = r * Math.sin(t) * 1500;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd6e4ff, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.85, fog: false }));
  }

  /* ---------- senaryo nesneleri ---------- */
  function dispose(o3) { scene.remove(o3); }
  function reset(sim) {
    if (!ok) return;
    for (const m of models.values()) { dispose(m.g); if (m.heat) dispose(m.heat); }
    for (const l of lines.values()) { dispose(l.line); l.line.geometry.dispose(); }
    models.clear(); lines.clear();
    for (const f of flashes) dispose(f.s);
    flashes.length = 0;
    for (const p of smoke) { p.alive = false; p.s.visible = false; }
    for (const p of glow) { p.alive = false; p.s.visible = false; }
    [padG, bat && bat.g, envelope, missileM && missileM.g, fair && fair.a, fair && fair.b].forEach(o => o && dispose(o));
    missileM = busM = busEntry = fair = null; lastNoz = null; lastSimT = 0; mTrail = null;
    padF = frameAt(0, 0); batF = frameAt(sim.bat.s, sim.bat.c);
    padG = Models3D.padSite(); placeSite(padG, padF);
    bat = Models3D.batterySite(sim.launchers.map(L => L.off * 1000)); placeSite(bat.g, batF);
    radarW = bat.g.localToWorld(new THREE.Vector3(...bat.radarAt));
    // korunan bölge kubbesi (yarıçap ~150 km)
    envelope = new THREE.Mesh(new THREE.SphereGeometry(150 * K, 24, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x46c8d8, wireframe: true, transparent: true, opacity: 0.035, depthWrite: false, fog: false }));
    envelope.quaternion.copy(bat.g.quaternion); envelope.position.copy(batF.o); envelope.visible = false; scene.add(envelope);
    missileM = Models3D.missile(); scene.add(missileM.g);
    cs.init = false; cs.key = ''; cs.blend = 1; cs.fromTR = cs.fromPR = null;
    // HSS görüntüsünün ayrı çizicisi sahne kurulurken bir kez çizdirilir: gölgelendirici derleme ve doku yükleme
    // radar adımında ilk açılışta takılmaya yol açmaz
    if (pipR) { try { placePip(); pipR.setSize(320, 200, false); pipR.render(scene, pipCam); } catch (e) { /* yalnızca ön ısıtma */ } }
  }

  function orient(g, dir) { g.quaternion.setFromUnitVectors(Yax, dir); }
  function reg(g, lenM, heat, heatK, back) { const e = { g, lenM, heat, heatK, back, f: 1 }; scaled.push(e); return e; }
  function makeModel(o) {
    const B = { rv: Models3D.rv, heavy: Models3D.heavy, light: Models3D.balloon, unknown: Models3D.unknownObj, bus: Models3D.bus };
    let m;
    if (o.type === 'debris') m = o.stage2 ? Models3D.stage2() : Models3D.debris();
    else if (o.type === 'stage1') m = Models3D.stage1From(missileM);
    else m = B[o.type]();
    if (o.type === 'bus') busM = m;
    m.heat = Models3D.sprite(0xffb070); m.heat.visible = false; m.back = new THREE.Vector3();
    scene.add(m.g, m.heat); models.set(o, m);
    return m;
  }
  function heatOf(o) {
    if (!o.alive || o.v < 0.8 || o.h > 95) return 0;
    const hf = rho(o.h) * o.v * o.v * o.v;
    return clamp((Math.log10(Math.max(hf, 1e-9)) + 2.5) / 3, 0, 1);
  }

  function syncObj(o, m, t, dtSim) {
    if (!o.alive) { m.g.visible = false; m.heat.visible = false; return; }
    m.g.visible = true;
    toV(o.x, o.y, o.z, m.g.position); dirV(o, m.back);
    const age = t - (o.born || 0);
    if (o.type === 'light') { m.inner.scale.setScalar(clamp(age / 5, 0.08, 1)); m.g.quaternion.identity(); }
    else {
      orient(m.g, m.back);
      if (o.type === 'heavy') m.g.rotateX(Math.sin(t * 1.7 + o.seed * 9) * 0.12);
      if (o.type === 'debris' || o.type === 'stage1') { m.g.rotateX(t * (0.5 + o.seed)); m.g.rotateZ(t * 0.37 * (o.seed + 0.3)); }
    }
    if (o.type === 'bus') {
      m.rvs.forEach((r, i) => { r.visible = i < (o.loaded || 0); });
      const burn = o.burnUntil > t;
      m.jets.forEach(j => { j.visible = burn; if (burn) j.scale.setScalar(1 + Math.random() * 0.9); });
      Models3D.updPlume(m.plume, o.h, burn);
    }
    const h = heatOf(o);
    m.heat.visible = h > 0.03;
    if (m.heat.visible) { m.heat.material.opacity = 0.3 + 0.65 * h; m.heat.material.color.setHex(h > 0.6 ? 0xffe2b8 : 0xffa860); }
    const e = reg(m.g, m.len, m.heat, 5 + 26 * h, m.back);
    if (o.type === 'bus') busEntry = e;
    // yeniden giriş izi: akkor plazma kuyruğu
    if (h > 0.12 && dtSim > 0) {
      const from = m.lastP || m.g.position, n = Math.min(6, Math.max(1, Math.ceil(dtSim / 0.05)));
      for (let k = 1; k <= n; k++) spark(from.clone().lerp(m.g.position, k / n), null, 4 + 9 * h, 1.2, 1.3 + h, h > 0.6 ? 0xffd8a8 : 0xff9a4a);
    }
    m.lastP = m.g.position.clone();
  }

  function fNow(pos, lenM) {
    const d = camera.position.distanceTo(pos), px = lenM * MS / (2 * d * Math.tan(camera.fov * Math.PI / 360)) * H;
    return px < MINPX ? Math.min(MINPX / Math.max(px, 1e-12), 3e5) : 1;
  }
  // füzenin sahnedeki konumu (kamera ve model aynı kareyi kullanır; rampadaki yükseklik payı kalkışta yumuşakça sönümlenir)
  function missilePos(sim, out) {
    const M = sim.missile;
    if (!M) return out.copy(padF.o).addScaledVector(padF.up, 2.7 * MS);
    toV(M.x, M.y, M.z, out);
    return out.addScaledVector(padF.up, 2.7 * MS * clamp(1 - M.h / 0.3, 0, 1));
  }
  function syncMissile(sim, dtSim) {
    const M = sim.missile, onPad = sim.phase === 'ready';
    if (!missileM) return;
    if (!M && !onPad) { missileM.g.visible = false; return; }
    missileM.g.visible = true;
    missilePos(sim, missileM.g.position);
    if (onPad) { orient(missileM.g, padF.up); tB.copy(padF.up); }
    else {
      if (M.v > 0.02) dirV(M, tB); else tB.copy(padF.up);
      orient(missileM.g, tB);
    }
    missileM.s1.visible = !M || M.stage === 1;
    missileM.plume.position.y = (!M || M.stage === 1) ? -1.1 : 10.2;
    Models3D.updPlume(missileM.plume, M ? M.h : 0, !!M);
    reg(missileM.g, missileM.len, null, 0, null);
    if (!M || dtSim <= 0) return;
    const f = fNow(missileM.g.position, missileM.len);
    const noz = missileM.g.position.clone().addScaledVector(tB, (M.stage === 1 ? -3 : 8) * MS * f);
    if (M.h < 45) {
      const from = lastNoz && lastNoz.distanceTo(noz) < 0.02 ? lastNoz : noz;
      const seg = from.distanceTo(noz) / MS, n = Math.min(60, Math.max(1, Math.ceil(seg / (6 + M.h * 2))));
      for (let k = 1; k <= n; k++) puff(from.clone().lerp(noz, k / n), rnd3(3 * MS), (9 + M.h * 0.8) * MS, (70 + M.h * 6) * MS, 60, 0.42 * (1 - M.h / 50), 0.15);
    }
    if (sim.t < 9) {
      const n = Math.min(14, Math.ceil(dtSim / 0.04));
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2, sp = (40 + Math.random() * 60) * MS;
        const v = padF.side.clone().multiplyScalar(Math.cos(a) * sp).addScaledVector(padF.fwd, Math.sin(a) * sp).addScaledVector(padF.up, (4 + Math.random() * 10) * MS);
        puff(padF.o.clone().addScaledVector(padF.up, 4 * MS), v, 12 * MS, 150 * MS, 45, 0.7, 0.22);
      }
    }
    lastNoz = noz;
  }

  function syncFairing(sim) {
    const b = sim.bus;
    if (!busM || !b || !b.alive) { if (fair) fair.a.visible = fair.b.visible = false; return; }
    if (!fair) { fair = { a: Models3D.fairingHalf(0), b: Models3D.fairingHalf(Math.PI) }; scene.add(fair.a, fair.b); }
    const t0 = sim.T.fairing;
    fair.dt = t0 === null || t0 === undefined ? 0 : sim.t - t0;
    fair.a.visible = fair.b.visible = fair.dt < 120;
  }
  // burun koruyucusu yarıları taşıyıcının ölçeğine bağlı: her kamera için yeniden yerleştirilir
  function placeFairing() {
    if (!fair || !fair.a.visible || !busEntry) return;
    const f = busEntry.f, dt = fair.dt;
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(busM.g.quaternion);
    const sep = busM.g.position.clone().normalize(); sep.addScaledVector(dir, -sep.dot(dir)).normalize();
    const lx = new THREE.Vector3(1, 0, 0).applyQuaternion(busM.g.quaternion);
    const ang = Math.atan2(new THREE.Vector3().crossVectors(lx, sep).dot(dir), lx.dot(sep));
    [[fair.a, 1], [fair.b, -1]].forEach(([h, sgn]) => {
      h.quaternion.copy(busM.g.quaternion); h.rotateY(ang);
      h.position.copy(busM.g.position).addScaledVector(sep, sgn * dt * 2.2 * MS * f).addScaledVector(dir, -dt * 0.6 * MS * f);
      h.rotateZ(-sgn * Math.min(dt * 0.2, 2.2));
      h.scale.setScalar(MS * f);
    });
  }

  /* ---------- kameraya göre ölçekleme ---------- */
  function scaleAll(cam, h, track) {
    const tan = Math.tan(cam.fov * Math.PI / 360);
    for (const e of scaled) {
      if (!e.g.visible) continue;
      const d = cam.position.distanceTo(e.g.position), px = e.lenM * MS / (2 * d * tan) * h;
      const f = px < MINPX ? Math.min(MINPX / Math.max(px, 1e-12), 3e5) : 1;
      if (track && f > maxExag) maxExag = f;
      e.f = f; e.g.scale.setScalar(MS * f);
      if (e.heat && e.heat.visible) {
        e.heat.position.copy(e.g.position).addScaledVector(e.back, -e.lenM * 0.3 * MS * f);
        const hs = e.heatK * MS * f; e.heat.scale.set(hs, hs, 1);
      }
    }
    placeFairing();
    for (const p of glow) if (p.alive) {
      const u = 2 * cam.position.distanceTo(p.s.position) * tan / h, k = p.age / p.life, sz = (p.px0 + (p.px1 - p.px0) * k) * u;
      p.s.scale.set(sz, sz, 1);
    }
    for (const f of flashes) {
      const u = 2 * cam.position.distanceTo(f.s.position) * tan / h, sz = f.px * u * (0.4 + f.k * 1.6);
      f.s.scale.set(sz, sz, 1);
    }
  }

  /* ---------- parçacıklar ---------- */
  // parçacık durumu: eski sprite alanlarıyla aynı (konum, ölçek, görünürlük, renk, dönme, opaklık)
  function particleState(hex) {
    return { position: new THREE.Vector3(), scale: new THREE.Vector3(1, 1, 1), visible: false, material: { color: new THREE.Color(hex), rotation: 0, opacity: 0 } };
  }
  const PV = `attribute vec3 iOff; attribute vec2 iSR; attribute vec4 iCol;
    varying vec2 vUv; varying vec4 vCol;
    #include <common>
    #include <fog_pars_vertex>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = uv; vCol = iCol;
      vec4 mvPosition = modelViewMatrix * vec4(iOff, 1.0);
      float c = cos(iSR.y), sn = sin(iSR.y); vec2 q = position.xy * iSR.x;
      mvPosition.xy += vec2(c * q.x - sn * q.y, sn * q.x + c * q.y);
      gl_Position = projectionMatrix * mvPosition;
      #include <logdepthbuf_vertex>
      #include <fog_vertex>
    }`;
  const PF = `uniform sampler2D map; varying vec2 vUv; varying vec4 vCol;
    #include <common>
    #include <fog_pars_fragment>
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec4 t = texture2D(map, vUv);
      gl_FragColor = vec4(vCol.rgb * t.rgb, vCol.a * t.a);
      #include <fog_fragment>
    }`;
  // konumlar kameraya göreli yazılır (mesh kameranın konumunda): büyük dünya koordinatlarında float32 hassasiyet kaybı olmaz
  function particleBatch(max, tex, blending, fog, sort) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = n => new THREE.InstancedBufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
    const off = mk(3), sr = mk(2), col = mk(4);
    g.setAttribute('iOff', off); g.setAttribute('iSR', sr); g.setAttribute('iCol', col); g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]),
      vertexShader: PV, fragmentShader: PF, transparent: true, depthWrite: false, blending, fog });
    mat.uniforms.map.value = tex;
    const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.visible = false;
    const list = [];
    return {
      mesh,
      prepare(ps, cam) {
        const o = cam.position; list.length = 0;
        for (const p of ps) if (p.alive && p.s.visible && p.s.material.opacity > 0.002) list.push(p);
        if (sort) { for (const p of list) p.d = p.s.position.distanceToSquared(o); list.sort((a, b) => b.d - a.d); }
        const A = off.array, B = sr.array, C = col.array;
        for (let n = 0; n < list.length; n++) {
          const s = list[n].s, P = s.position, c = s.material.color;
          A[n * 3] = P.x - o.x; A[n * 3 + 1] = P.y - o.y; A[n * 3 + 2] = P.z - o.z;
          B[n * 2] = s.scale.x; B[n * 2 + 1] = s.material.rotation;
          C[n * 4] = c.r; C[n * 4 + 1] = c.g; C[n * 4 + 2] = c.b; C[n * 4 + 3] = s.material.opacity;
        }
        const n = list.length; g.instanceCount = n; mesh.visible = n > 0; mesh.position.copy(o);
        off.updateRange.count = n * 3; sr.updateRange.count = n * 2; col.updateRange.count = n * 4;
        off.needsUpdate = sr.needsUpdate = col.needsUpdate = true;
      },
    };
  }
  function prepParticles(cam) { if (smokeB) { smokeB.prepare(smoke, cam); glowB.prepare(glow, cam); } }
  function rnd3(s) { return new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s); }
  function puff(pos, vel, s0, s1, life, a, drag = 0.2, color = 0xe9e5dd) {
    const p = smoke[smokeIdx]; smokeIdx = (smokeIdx + 1) % smoke.length;
    p.s.position.copy(pos); p.vel.copy(vel); p.age = 0; p.life = life; p.s0 = s0; p.s1 = s1; p.a = a; p.drag = drag;
    p.alive = true; p.s.visible = true; p.s.material.color.setHex(color); p.s.material.rotation = Math.random() * 6.28;
    p.s.scale.set(s0, s0, 1); p.s.material.opacity = 0;
  }
  // ekran pikseli cinsinden boyutlanan parlak parçacık (plazma izi, kıvılcım)
  function spark(pos, vel, px0, px1, life, color) {
    const p = glow[glowIdx]; glowIdx = (glowIdx + 1) % glow.length;
    p.s.position.copy(pos); if (vel) p.vel.copy(vel); else p.vel.set(0, 0, 0);
    p.age = 0; p.life = life; p.px0 = px0; p.px1 = px1; p.alive = true; p.s.visible = true;
    p.s.material.color.setHex(color); p.s.material.opacity = 1;
  }
  function stepParticles(dt) {
    for (const p of smoke) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) { p.alive = false; p.s.visible = false; continue; }
      p.s.position.addScaledVector(p.vel, dt); p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      const f = p.age / p.life, sz = p.s0 + (p.s1 - p.s0) * (1 - (1 - f) * (1 - f));
      p.s.scale.set(sz, sz, 1);
      p.s.material.opacity = p.a * Math.min(1, p.age * 2 + 0.15) * (1 - f);
    }
    for (const p of glow) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) { p.alive = false; p.s.visible = false; continue; }
      p.s.position.addScaledVector(p.vel, dt);
      p.s.material.opacity = Math.pow(1 - p.age / p.life, 1.5);
    }
  }
  function flash(pos, color, px, life, now) {
    const s = Models3D.sprite(color); s.position.copy(pos); scene.add(s);
    flashes.push({ s, rt: now, px, life, k: 0 });
  }
  function stepFlashes(now) {
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i], age = (now - f.rt) / 1000;
      if (age > f.life) { dispose(f.s); flashes.splice(i, 1); continue; }
      f.k = age / f.life; f.s.material.opacity = (1 - f.k) * (1 - f.k);
    }
  }
  function launchFx(pos, now) {
    flash(pos, 0xfff0d0, 40, 0.9, now);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, sp = (15 + Math.random() * 45) * MS;
      const v = batF.side.clone().multiplyScalar(Math.cos(a) * sp).addScaledVector(batF.fwd, Math.sin(a) * sp).addScaledVector(batF.up, (2 + Math.random() * 8) * MS);
      puff(pos.clone().addScaledVector(batF.up, -5 * MS), v, 6 * MS, 70 * MS, 30, 0.65, 0.25, 0xe6e1d8);
    }
  }

  /* ---------- izler ve radar ışınları ---------- */
  function syncLine(key, o, color, opacity, visible) {
    let l = lines.get(key);
    if (!l) {
      const g = new THREE.BufferGeometry(), a = new THREE.BufferAttribute(new Float32Array((MAXP + 1) * 3), 3);
      a.setUsage(THREE.DynamicDrawUsage); g.setAttribute('position', a); g.setDrawRange(0, 0);
      l = { line: new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false })), n: 0 };
      scene.add(l.line); lines.set(key, l);
    }
    l.line.visible = visible;
    l.line.material.color.set(color); l.line.material.opacity = opacity;
    const pa = l.line.geometry.attributes.position, arr = pa.array, tr = o.trail, n = Math.min(tr.length, MAXP);
    const start = Math.max(0, l.n - 1);
    for (let i = l.n; i < n; i++) { toV(tr[i].x, tr[i].y, tr[i].z, tC); arr[i * 3] = tC.x; arr[i * 3 + 1] = tC.y; arr[i * 3 + 2] = tC.z; }
    l.n = n;
    const alive = o.alive !== false;
    if (alive) { toV(o.x, o.y, o.z, tC); arr[n * 3] = tC.x; arr[n * 3 + 1] = tC.y; arr[n * 3 + 2] = tC.z; }
    l.line.geometry.setDrawRange(0, alive ? n + 1 : n);
    pa.updateRange.offset = start * 3; pa.updateRange.count = (n + 1 - start) * 3; pa.needsUpdate = true;
  }
  function syncBeams(sim, on, now) {
    const fill = (L, list) => {
      const a = L.geometry.attributes.position.array; let n = 0;
      for (const p of list) { if (n >= 80) break; a.set([radarW.x, radarW.y, radarW.z, p.x, p.y, p.z], n * 6); n++; }
      L.geometry.setDrawRange(0, n * 2); L.geometry.attributes.position.needsUpdate = true; L.visible = on && n > 0;
    };
    const track = [], fire = [];
    if (on) for (const o of sim.objs) {
      if (!o.alive || !o.tracked || o.h > 400) continue;
      const m = models.get(o); if (!m) continue;
      (o.assigned ? fire : track).push(m.g.position);
    }
    fill(beams, track); fill(fcBeams, fire);
    beams.material.opacity = 0.08 + 0.05 * Math.sin(now / 300);
  }

  /* ---------- kamera ---------- */
  function centroid(sim, filter, out) {
    let n = 0; out.set(0, 0, 0);
    for (const o of sim.objs) if (o.alive && filter(o)) { toV(o.x, o.y, o.z, tC); out.add(tC); n++; }
    return n ? out.multiplyScalar(1 / n) : null;
  }
  const THREAT = o => o.type === 'rv' || o.type === 'heavy' || o.type === 'light' || o.type === 'unknown';
  function localAxes(pos, dir) {
    const upL = pos.clone().normalize();
    const side = new THREE.Vector3().crossVectors(dir, upL);
    if (side.lengthSq() < 0.01) side.copy(Nn).negate(); else side.normalize();
    return { upL, side };
  }
  function preset(sim, key) {
    const P = { key, tgt: new THREE.Vector3(), off: new THREE.Vector3(), up: new THREE.Vector3(), fov: 45, smooth: false, smoothDist: false, anchor: null, vel: new THREE.Vector3() };
    const velOf = o => P.vel.set(0, 0, 0).addScaledVector(U, o.vx * K).addScaledVector(Wd, o.vy * K).addScaledVector(Nn, (o.vz || 0) * K);
    const km = v => v * K, m = v => v * MS;
    switch (key) {
      case 'pad':
        P.tgt.copy(padF.o).addScaledVector(padF.up, m(13));
        P.off.copy(padF.side).multiplyScalar(m(66)).addScaledVector(padF.fwd, m(52)).addScaledVector(padF.up, m(-6));
        P.up.copy(padF.up); P.fov = 44; break;
      case 'track': {
        const cam = padF.o.clone().addScaledVector(padF.side, m(1700)).addScaledVector(padF.fwd, m(-900)).addScaledVector(padF.up, m(12));
        if (sim.missile || sim.phase === 'ready') missilePos(sim, P.tgt); else P.tgt.copy(padF.o);
        P.off.subVectors(cam, P.tgt); P.up.copy(padF.up);
        P.fov = clamp(2 * Math.atan(48 / (P.off.length() / MS)) * 180 / Math.PI, 0.8, 40); break;
      }
      case 'chase': case 'chaseWide': {
        const o = sim.missile || sim.bus;
        if (!o) return preset(sim, 'pad');
        toV(o.x, o.y, o.z, P.tgt); velOf(o); const dir = dirV(o, new THREE.Vector3()), { upL, side } = localAxes(P.tgt, dir);
        const k = key === 'chase' ? [-55, 52, 6] : [-48, 78, 24];
        P.off.copy(dir).multiplyScalar(m(k[0])).addScaledVector(side, m(k[1])).addScaledVector(upL, m(k[2]));
        P.up.copy(upL); P.fov = key === 'chase' ? 48 : 52; break;
      }
      case 'bus': case 'busWide': {
        const b = sim.bus;
        if (!b) return preset(sim, 'chaseWide');
        toV(b.x, b.y, b.z, P.tgt); velOf(b); const dir = dirV(b, new THREE.Vector3()), { upL, side } = localAxes(P.tgt, dir);
        if (key === 'bus') P.off.copy(dir).multiplyScalar(m(-7)).addScaledVector(side, m(12)).addScaledVector(upL, m(5));
        else {
          // yalnızca taşıyıcı ve en son bırakılan grup kadraja alınır; mesafe yumuşak değişir
          const rel = sim.events.filter(e => e.type === 'release').pop();
          P.anchor = P.tgt.clone();
          const c = P.tgt.clone(); let n = 1, r = 4;
          if (rel) for (const o of rel.objs) if (o.alive) { toV(o.x, o.y, o.z, tC); c.add(tC); n++; r = Math.max(r, tC.distanceTo(P.tgt) / MS); }
          P.tgt.copy(c.multiplyScalar(1 / n));
          const d = clamp(r * 2.4 + 12, 18, 4000);
          P.off.copy(dir).multiplyScalar(-0.45).addScaledVector(side, 1).addScaledVector(upL, 0.35).normalize().multiplyScalar(m(d));
          P.smooth = true; P.smoothDist = true;
        }
        P.up.copy(upL); P.fov = 46; break;
      }
      case 'cloud': {
        if (!centroid(sim, THREAT, P.tgt)) return preset(sim, 'globe');
        let r = 0; for (const o of sim.objs) if (o.alive && THREAT(o)) { toV(o.x, o.y, o.z, tC); r = Math.max(r, tC.distanceTo(P.tgt) / K); }
        const ref = sim.bus || sim.objs.find(o => o.alive && THREAT(o)), dir = dirV(ref, new THREE.Vector3()), { upL, side } = localAxes(P.tgt, dir);
        P.off.copy(side).addScaledVector(upL, 0.55).addScaledVector(dir, -0.25).normalize().multiplyScalar(km(Math.max(650, r * 2.6)));
        P.anchor = toV(ref.x, ref.y, ref.z, new THREE.Vector3()); velOf(ref);
        P.up.copy(upL); P.smooth = true; P.smoothDist = true; break;
      }
      case 'radar': {
        const c = centroid(sim, THREAT, new THREE.Vector3()) || batF.o.clone().addScaledVector(batF.up, km(300));
        P.tgt.copy(batF.o).lerp(c, 0.5);
        const pos = batF.o.clone().addScaledVector(batF.fwd, km(520)).addScaledVector(batF.side, km(300)).addScaledVector(batF.up, km(240));
        P.off.subVectors(pos, P.tgt); P.up.copy(batF.up); P.fov = 48; P.smoothDist = true; break;
      }
      case 'defense': {
        const base = batF.o.clone().addScaledVector(batF.up, km(15));
        const c = centroid(sim, o => o.tracked && o.h < 170 && o.type !== 'debris' && o.type !== 'bus', new THREE.Vector3());
        P.tgt.copy(c ? base.clone().lerp(c, 0.5) : batF.o.clone().addScaledVector(batF.fwd, km(-40)).addScaledVector(batF.up, km(38)));
        const span = c ? c.distanceTo(base) / K : 120;
        P.off.copy(batF.fwd).multiplyScalar(0.72).addScaledVector(batF.side, 0.66).addScaledVector(batF.up, 0.12).normalize().multiplyScalar(km(clamp(span * 1.25, 90, 420)));
        P.anchor = batF.o.clone(); P.up.copy(batF.up); P.fov = 50; P.smooth = true; P.smoothDist = true; break;
      }
      default: {   // küre
        const th = sim.S / R_E / 2;
        P.tgt.set(0, 0, 0);
        P.off.copy(U).multiplyScalar(Math.cos(th)).addScaledVector(Wd, Math.sin(th)).addScaledVector(Nn, 0.45).normalize().multiplyScalar(21);
        P.up.copy(Nn).cross(P.off).normalize().cross(P.off).negate().normalize(); P.fov = 42;
      }
    }
    return P;
  }
  // geçişler hareket eden hedefe göre yapılır: kamera hedefin gerisinde kalmaz
  function applyCam(P, dtR, dtSim) {
    const off = P.off.clone();
    if (ctl.az) off.applyAxisAngle(P.up, ctl.az);
    if (ctl.el) { const ax = new THREE.Vector3().crossVectors(off, P.up); if (ax.lengthSq() > 1e-20) off.applyAxisAngle(ax.normalize(), -ctl.el); }
    off.multiplyScalar(ctl.zoom);
    if (cs.key !== P.key) {
      if (cs.init) {
        // önceki hedefin bu kareye kadarki hareketi hesaba katılır (hızlı nesnelerde sahte "uzak hedef" algısını önler)
        const drift = cs.curVel ? cs.curVel.clone().multiplyScalar(dtSim) : new THREE.Vector3();
        cs.fromTR = cs.curT.clone().add(drift).sub(P.tgt); cs.fromPR = camera.position.clone().add(drift).sub(P.tgt);
        // eski hedef çok uzaktaysa (ör. adım atlandığında) yumuşak geçiş yerine doğrudan kesme
        cs.blend = cs.fromTR.length() > 20 * off.length() + 50 * MS ? 1 : 0;
      }
      else { cs.blend = 1; cs.fov = P.fov; }
      cs.key = P.key; cs.init = true; cs.relS = P.tgt.clone().sub(P.anchor || P.tgt); cs.dS = off.length();
    }
    let tgt = P.tgt;
    // yumuşatma hareket eden çapaya göreli: hızlı giden taşıyıcının gerisinde kalınmaz
    if (P.smooth && P.anchor) { cs.relS.lerp(P.tgt.clone().sub(P.anchor), 1 - Math.exp(-dtR * 2.5)); tgt = P.anchor.clone().add(cs.relS); }
    if (P.smoothDist) { cs.dS += (off.length() - cs.dS) * (1 - Math.exp(-dtR * 1.5)); off.setLength(cs.dS); }
    cs.blend = Math.min(1, cs.blend + dtR / 1.8);
    let T = tgt, Pp;
    if (cs.blend < 1 && (!cs.fromTR || !cs.fromPR)) cs.blend = 1;   // geçiş başlangıç durumu yoksa doğrudan kesme
    if (cs.blend < 1) {
      const e = cs.blend * cs.blend * (3 - 2 * cs.blend);
      // bakış noktası yeni hedefe konumdan daha hızlı döner: geçiş boyunca hedef kadrajda kalır
      const ba = Math.min(1, cs.blend * 2.5), ea = ba * ba * (3 - 2 * ba);
      T = tgt.clone().addScaledVector(cs.fromTR, 1 - ea);
      const l0 = Math.max(cs.fromPR.length(), 1e-9), l1 = Math.max(off.length(), 1e-9);
      const dir = cs.fromPR.clone().divideScalar(l0).lerp(off.clone().divideScalar(l1), e).normalize();
      Pp = tgt.clone().addScaledVector(dir, Math.exp(Math.log(l0) + (Math.log(l1) - Math.log(l0)) * e));
    } else Pp = tgt.clone().add(off);
    camera.position.copy(Pp); camera.up.copy(P.up); camera.lookAt(T); cs.curT = T.clone(); cs.curVel = P.vel.clone();
    cs.fov += (P.fov - cs.fov) * (1 - Math.exp(-dtR * 3));
    camera.fov = cs.fov; camera.near = Math.max(0.3 * MS, Pp.distanceTo(T) * 0.002);
    camera.updateProjectionMatrix();
  }
  // köşe penceresi: HSS bataryası yakın plan (fırlatıcıların arkasından tehdit yönüne bakar)
  function placePip() {
    const p = v => v * MS;
    // fırlatıcı sırasının ucundan: dört araç yan profilden, önleyiciler yükselirken gökyüzü üst yarıda
    pipCam.position.copy(batF.o).addScaledVector(batF.side, p(200)).addScaledVector(batF.fwd, p(-70)).addScaledVector(batF.up, p(5));
    const tgt = batF.o.clone().addScaledVector(batF.side, p(40)).addScaledVector(batF.fwd, p(0)).addScaledVector(batF.up, p(30));
    pipCam.up.copy(batF.up); pipCam.lookAt(tgt);
    pipCam.fov = 50; pipCam.aspect = pip.w / pip.h; pipCam.near = 0.5 * MS; pipCam.updateProjectionMatrix();
  }
  function updateSky(cam) {
    const hc = cam.position.length() / K - R_E, alt = clamp(hc / 90, 0, 1);
    dome.position.copy(cam.position);
    const u = dome.material.uniforms;
    u.up.value.copy(cam.position).normalize(); u.alt.value = alt;
    u.op.value = 1 - smoothstep(55, 110, hc); dome.visible = u.op.value > 0.01;
    scene.fog.color.setRGB(0.76, 0.86, 0.95).lerp(new THREE.Color(0.22, 0.38, 0.66), alt);
    scene.fog.near = 0.003 + hc * K * 0.5; scene.fog.far = hc > 70 ? 1e6 : 0.12 + hc * K * 20;
    stars.material.opacity = clamp((hc - 25) / 50, 0, 1) * 0.85;
    sunSpr.visible = hc > 40;
    const f = clamp((hc - 60) / 120, 0, 1);
    halo.material.uniforms.f.value = f; rim.material.uniforms.f.value = f;
    if (bloom) { bloom.strength = 0.35 + 0.5 * alt; bloom.threshold = 0.9 - 0.08 * alt; }
  }

  /* ---------- HUD ---------- */
  function proj(v, cam = camera, R = null) {
    tA.copy(v).project(cam);
    if (tA.z > 1 || tA.z < -1 || Math.abs(tA.x) > 1.3 || Math.abs(tA.y) > 1.3) return null;
    if (R) return [R.x + (tA.x + 1) / 2 * R.w, R.y + (1 - tA.y) / 2 * R.h];
    return [(tA.x + 1) / 2 * W, (1 - tA.y) / 2 * H];
  }
  function bracket(x, y, r, col, w = 1.5) {
    const L = Math.max(4, r * 0.45);
    hud.strokeStyle = col; hud.lineWidth = w; hud.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      hud.moveTo(x + sx * r, y + sy * (r - L)); hud.lineTo(x + sx * r, y + sy * r); hud.lineTo(x + sx * (r - L), y + sy * r);
    }
    hud.stroke();
  }
  function pill(x, y, text, col, placed, strong, bounds) {
    hud.font = `${strong ? 700 : 600} 12px Barlow, system-ui, sans-serif`;
    const w = hud.measureText(text).width + 12, h = 19, B = bounds || { x: 0, y: 0, w: W, h: H };
    for (const [dx, dy] of [[0, 0], [0, 24], [0, -24], [-w - 28, 0]]) {
      const rx = x + dx, ry = y + dy;
      if (rx < B.x + 2 || ry < B.y + 2 || rx + w > B.x + B.w - 2 || ry + h > B.y + B.h - 2) continue;
      if (placed.some(p => rx < p[0] + p[2] && rx + w > p[0] && ry < p[1] + p[3] && ry + h > p[1])) continue;
      placed.push([rx, ry, w, h]);
      hud.fillStyle = 'rgba(4,9,15,0.78)'; hud.strokeStyle = col; hud.lineWidth = 1;
      hud.beginPath(); hud.roundRect ? hud.roundRect(rx, ry, w, h, 4) : hud.rect(rx, ry, w, h); hud.fill(); hud.stroke();
      hud.fillStyle = strong ? '#fff' : col; hud.textBaseline = 'middle'; hud.fillText(text, rx + 6, ry + h / 2 + 0.5);
      return [rx, ry + h / 2];
    }
    return null;
  }
  function callout(anchor, text, col, placed, side = 1) {
    const p = proj(anchor); if (!p) return;
    const lx = p[0] + side * 70, ly = p[1] - 18;
    hud.strokeStyle = col; hud.lineWidth = 1.2; hud.beginPath(); hud.moveTo(p[0], p[1]); hud.lineTo(lx, ly + 9); hud.stroke();
    hud.fillStyle = col; hud.beginPath(); hud.arc(p[0], p[1], 2.5, 0, 7); hud.fill();
    hud.font = '700 12px Barlow, system-ui, sans-serif';
    pill(side > 0 ? lx : lx - hud.measureText(text).width - 14, ly, text, col, placed, true);
  }
  function screenSize(pos, lenM, f) {
    const d = camera.position.distanceTo(pos);
    return lenM * MS * f / (2 * d * Math.tan(camera.fov * Math.PI / 360)) * H;
  }

  function drawHUD(sim, opt, now) {
    hud.setTransform(dpr, 0, 0, dpr, 0, 0); hud.clearRect(0, 0, W, H);
    const placed = [];
    const step = opt.step, attacker = opt.attacker, ann = [];
    if (missileM && missileM.g.visible) {
      const f = missileM.g.scale.x / MS, px = screenSize(missileM.g.position, missileM.len, f);
      if (px > 120) {
        const A = missileM.anchors, w = a => missileM.g.localToWorld(new THREE.Vector3(...a));
        callout(w(A.nose), 'Burun koruyucusu · içinde taşıyıcı ve harp başlıkları', '#f3d79c', placed, 1);
        callout(w(A.s2), '2. kademe', '#cfe3ef', placed, -1);
        if (missileM.s1.visible) callout(w(A.s1), '1. kademe', '#cfe3ef', placed, -1);
      } else ann.push({ pos: missileM.g.position.clone(), r: 12, col: '#ffd08a', text: 'Füze', prio: 9 });
    }
    if (busM && busM.g.visible && attacker) ann.push({ pos: busM.g.position.clone(), r: 14, col: '#f3d79c', text: `Taşıyıcı (bus) · ${sim.bus.loaded || 0} başlık yüklü`, prio: 8 });
    if (fair && fair.a.visible && sim.T.fairing !== null && sim.t - sim.T.fairing < 25) ann.push({ pos: fair.a.position.clone(), r: 10, col: '#cfd6dc', text: 'Burun koruyucusu atıldı', prio: 4 });
    for (const o of sim.objs) {
      if (!o.alive || o.type === 'bus') continue;
      const m = models.get(o); if (!m) continue;
      const pos = m.g.position, col = opt.col(o);
      if (attacker) {
        let text = null, prio = 2;
        if (o.type === 'stage1') { if (sim.t - o.born < 60) { text = 'Ayrılan 1. kademe'; prio = 6; } else continue; }
        else if (o.type === 'rv') { text = `Harp başlığı ${o.rvNo || ''}${o.aimName ? ' → ' + o.aimName : ''}`; prio = 7; }
        else if (o.type === 'unknown') { text = 'Bilinmeyen tip nesne'; prio = 6; }
        else if (o.type === 'heavy') { text = 'Ağır sahte hedef'; prio = 4; }
        else if (o.type === 'light') { text = 'Balon (hafif sahte)'; prio = 3; }
        else if (o.stage2) { if (sim.t - o.born < 40) { text = 'Ayrılan 2. kademe'; prio = 5; } else continue; }
        else { text = 'Enkaz'; prio = 1; }
        ann.push({ pos, r: 9, col, text, prio, o });
      } else {
        if (o.type === 'stage1') continue;
        if (!o.tracked) { ann.push({ pos, r: 6, col: '#7f909d', text: null, prio: 0, o }); continue; }
        const lab = o.cls ? o.cls.label : 'IZLENIYOR', rank = opt.ranks.get(o);
        const big = lab === 'GERCEK' || lab === 'BILINMEYEN' || rank || o === opt.selected;
        const text = big ? `${o.tid} · ${LABEL_TR[lab]}${lab !== 'IZLENIYOR' && o.cls.model !== 'rule' ? ' %' + Math.round(o.cls.p.rv * 100) : ''}` : o.tid;
        ann.push({ pos, r: big ? 11 : 7, col, text, prio: rank ? 20 - rank : big ? 6 : 1, o, rank });
      }
    }
    for (const mI of sim.icpts) {
      const it = models.get(mI); if (!it) continue;
      ann.push({ pos: it.g.position.clone(), r: 7, col: '#ffffff', text: `Ö-${mI.id} → ${mI.tgt.tid}`, prio: 12, icpt: mI });
    }
    if (step === 'hazir') ann.push({ pos: padF.o.clone().addScaledVector(padF.up, 30 * MS), r: 0, col: '#ffb08a', text: 'Fırlatma rampası', prio: 3 });
    // HSS konumu: yerde nabız gibi atan halka
    let batP = null;
    if (!attacker) {
      batP = proj(batF.o);
      if (batP) {
        const pr = 6 + 2 * Math.sin(now / 260);
        hud.strokeStyle = 'rgba(70,200,216,0.85)'; hud.lineWidth = 1.2; hud.beginPath(); hud.arc(batP[0], batP[1], pr, 0, 7); hud.stroke();
        hud.beginPath(); hud.arc(batP[0], batP[1], 2, 0, 7); hud.fillStyle = '#46c8d8'; hud.fill();
        ann.push({ pos: batF.o.clone(), r: 0, col: '#46c8d8', text: 'HSS', prio: 5 });
      }
    }
    hud.setLineDash([4, 4]); hud.lineWidth = 1;
    for (const a of ann) if (a.icpt && a.icpt.tgt.alive) {
      const tm = models.get(a.icpt.tgt), p1 = proj(a.pos), p2 = tm && proj(tm.g.position);
      if (p1 && p2) { hud.strokeStyle = 'rgba(255,255,255,0.45)'; hud.beginPath(); hud.moveTo(p1[0], p1[1]); hud.lineTo(p2[0], p2[1]); hud.stroke(); }
    }
    hud.setLineDash([]);
    ann.sort((a, b) => b.prio - a.prio);
    let labels = 0;
    for (const a of ann) {
      const p = proj(a.pos); if (!p) continue;
      if (a.r > 0) bracket(p[0], p[1], a.r, a.col, a.o === opt.selected ? 2.5 : 1.5);
      if (a.o === opt.selected) { hud.strokeStyle = '#fff'; hud.lineWidth = 1; hud.beginPath(); hud.arc(p[0], p[1], a.r + 7, 0, 7); hud.stroke(); }
      if (a.rank) {
        hud.fillStyle = '#e9a23b'; hud.beginPath(); hud.arc(p[0] - a.r - 9, p[1] - a.r - 9, 9, 0, 7); hud.fill();
        hud.fillStyle = '#1a1206'; hud.font = '700 11px "JetBrains Mono", monospace'; hud.textAlign = 'center'; hud.textBaseline = 'middle';
        hud.fillText(a.rank, p[0] - a.r - 9, p[1] - a.r - 8.5); hud.textAlign = 'left';
      }
      if (a.text && (labels < 16 || a.prio >= 6)) { if (pill(p[0] + a.r + 6, p[1] - a.r - 10, a.text, a.col, placed, a.prio >= 7)) labels++; }
    }
    const f = opt.focus;
    if (f) {
      const name = f.type === 'missile' ? `FÜZE · ${f.stage}. kademe` : f.type === 'bus' ? 'TAŞIYICI (BUS)' : (f.tid || TYPE_INFO[f.type].name).toUpperCase();
      const rows = [name, `İRTİFA   ${fmtNum(Math.max(0, f.h), 1)} km`, `HIZ      ${fmtNum(f.v, 2)} km/s`, `MENZİL   ${fmtNum(Math.max(0, rangeOf(f)), 0)} km`];
      hud.font = '600 12px "JetBrains Mono", monospace'; hud.textBaseline = 'top';
      hud.fillStyle = 'rgba(4,9,15,0.7)'; hud.fillRect(10, 34, 200, rows.length * 17 + 10);
      rows.forEach((r, i) => { hud.fillStyle = i ? '#d9e3ea' : '#e9a23b'; hud.fillText(r, 18, 40 + i * 17); });
    }
    if (maxExag > 1.5) {
      hud.font = '500 11px Barlow, system-ui, sans-serif'; hud.textBaseline = 'bottom'; hud.textAlign = 'right';
      hud.fillStyle = 'rgba(217,227,234,0.75)'; hud.fillText('Nesneler görünürlük için büyütülmüştür', W - 10, H - 46);
      hud.textAlign = 'left';
    }
  }
  // yan paneldeki HSS canlı görüntüsünün etiketleri
  function drawPipLabels(sim) {
    const g = pctx, R = { x: 0, y: 0, w: pip.w, h: pip.h }, placed = [];
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const tag = (p, text, col) => {
      g.font = '600 11px Barlow, system-ui, sans-serif';
      const w = g.measureText(text).width + 10, x = clamp(p[0] - w / 2, 2, R.w - w - 2), y = clamp(p[1] - 24, 2, R.h - 18);
      if (placed.some(q => x < q[0] + q[2] && x + w > q[0] && y < q[1] + 16 && y + 16 > q[1])) return;
      placed.push([x, y, w]);
      g.fillStyle = 'rgba(4,9,15,0.78)'; g.fillRect(x, y, w, 16);
      g.fillStyle = col; g.textBaseline = 'middle'; g.fillText(text, x + 5, y + 8.5);
    };
    for (const mI of sim.icpts) {
      const it = models.get(mI); if (!it) continue;
      const p = proj(it.g.position, pipCam, R); if (p) tag([p[0] + 22, p[1] + 16], `Ö-${mI.id}`, '#ffffff');
    }
    sim.launchers.forEach((L, i) => {
      const p = proj(bat.launchers[i].g.localToWorld(new THREE.Vector3(0, 9, 0)), pipCam, R);
      if (p) tag(p, `F${L.no} · ${L.rounds}`, L.rounds ? '#e3edf3' : '#8a99a6');
    });
  }
  function fmtNum(x, d) { return Number(x).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }); }

  /* ---------- kare ---------- */
  function render(sim, opt, dtR) {
    if (!ok) return;
    const now = performance.now(), dtSim = Math.max(0, sim.t - lastSimT);
    lastSimT = sim.t; maxExag = 1; scaled = [];
    clouds.rotation.y += dtR * 0.002;
    let key = opt.cam;
    if (userMode === 'focus') key = sim.missile ? 'chase' : (sim.phase === 'bus' ? 'busWide' : 'cloud');
    else if (userMode === 'defense') key = 'defense';
    else if (userMode === 'globe') key = 'globe';
    curKey = key;
    applyCam(preset(sim, key), dtR, dtSim);
    pip.on = !!opt.pip && !!pipCv && pipCv.offsetParent !== null;
    if (pip.on) {
      const r = pipCv.getBoundingClientRect();
      pip.w = Math.max(1, Math.min(Math.round(r.width), Math.floor(W))); pip.h = Math.max(1, Math.min(Math.round(r.height), Math.floor(H)));
      placePip();
    }

    syncMissile(sim, dtSim);
    for (const o of sim.objs) { const m = models.get(o) || (o.alive ? makeModel(o) : null); if (m) syncObj(o, m, sim.t, dtSim); }
    syncFairing(sim);
    for (const mI of sim.icpts) {
      let it = models.get(mI);
      const fresh = !it;
      if (fresh) { it = Models3D.interceptor(); scene.add(it.g); models.set(mI, it); it.last = null; }
      toV(mI.x, mI.y, mI.z, it.g.position); dirV(mI, tB); orient(it.g, tB);
      if (fresh && mI.age < 1.5) launchFx(it.g.position.clone(), now);
      const h = altOf(mI);
      Models3D.updPlume(it.plume, h, mI.age < 22);
      reg(it.g, it.len, null, 0, null);
      if (h < 70 && dtSim > 0 && mI.age < 22) {
        const noz = it.g.position.clone().addScaledVector(tB, -0.5 * MS), from = it.last || noz;
        const n = Math.min(14, Math.max(1, Math.ceil(from.distanceTo(noz) / MS / (5 + h * 2))));
        for (let k = 1; k <= n; k++) puff(from.clone().lerp(noz, k / n), rnd3(1 * MS), 2.5 * MS, (18 + h * 0.8) * MS, 24, 0.5 * (1 - h / 80), 0.2);
        it.last = noz;
      }
    }
    for (const [k, it] of models) if (k.age !== undefined && !k.alive) it.g.visible = false;
    if (bat) bat.launchers.forEach((L, i) => L.caps.forEach((c, j) => { c.visible = j < sim.launchers[i].rounds; }));

    for (const fx of sim.fx) {
      if (seenFx.has(fx)) continue;
      seenFx.add(fx);
      const p = toV(fx.x, fx.y, fx.z, new THREE.Vector3());
      if (fx.kind === 'kill') {
        flash(p, 0xfff0c8, 90, 1.6, now); flash(p, 0xff9a40, 50, 2.6, now);
        for (let i = 0; i < 18; i++) spark(p, rnd3(1.2 * K), 5, 1, 1.4 + Math.random(), i % 2 ? 0xffd090 : 0xffffff);
        for (let i = 0; i < 8; i++) puff(p, rnd3(60 * MS), 20 * MS, 260 * MS, 30, 0.6, 0.3, 0x9b958c);
      } else if (fx.kind === 'impact') { flash(p, 0xff7040, 120, 3, now); for (let i = 0; i < 12; i++) puff(p, rnd3(80 * MS).addScaledVector(p.clone().normalize(), 60 * MS), 40 * MS, 900 * MS, 90, 0.7, 0.05, 0x6e655b); }
      else if (fx.kind === 'filter' || fx.kind === 'breakup') { flash(p, 0xffb070, 26, 1.4, now); for (let i = 0; i < 6; i++) spark(p, rnd3(0.4 * K), 4, 1, 1.2, 0xffc080); }
      else if (fx.kind === 'miss' || fx.kind === 'selfd') flash(p, 0xdfe6ee, 22, 1.2, now);
    }
    stepParticles(dtSim);
    stepFlashes(now);

    const far = !CLOSE.has(key);
    if (sim.missile || sim.T.burnout !== null) syncLine('missile', sim.missile || { trail: missileTrail(sim), alive: false }, '#f5efe4', 0.55, far || key === 'chaseWide');
    for (const o of sim.objs) {
      if (o.type === 'stage1' || (o.type === 'debris' && !far)) continue;
      const lab = o.cls ? o.cls.label : 'IZLENIYOR';
      const imp = opt.attacker ? (o.type === 'rv' || o.type === 'unknown') : (lab === 'GERCEK' || lab === 'BILINMEYEN');
      syncLine(o, o, opt.col(o), o.alive ? (imp ? 0.75 : 0.32) : 0.15, far && (key !== 'defense' || imp));
    }
    for (const mI of sim.icpts) syncLine(mI, mI, '#ffffff', 0.7, true);
    syncBeams(sim, !!opt.beams, now);
    envelope.visible = !!opt.beams && far;

    // HSS canlı görüntüsü: tuvalin köşesine çizilip yan paneldeki kanvasa kopyalanır, ardından ana görünüm üstüne çizilir
    if (pip.on) {
      updateSky(pipCam);
      scaleAll(pipCam, pip.h, false);
      prepParticles(pipCam);
      const dw = Math.round(pip.w * dpr), dh = Math.round(pip.h * dpr);
      if (pipCv.width !== dw || pipCv.height !== dh) { pipCv.width = dw; pipCv.height = dh; }
      pctx.setTransform(1, 0, 0, 1, 0, 0);
      if (pipR) {
        if (pipR.getPixelRatio() !== dpr) pipR.setPixelRatio(dpr);
        const sz = pipR.getSize(pipSz); if (sz.x !== pip.w || sz.y !== pip.h) pipR.setSize(pip.w, pip.h, false);
        pipR.render(scene, pipCam);
        pctx.clearRect(0, 0, dw, dh);
      } else {
        renderer.setScissorTest(true); renderer.setViewport(0, 0, pip.w, pip.h); renderer.setScissor(0, 0, pip.w, pip.h);
        renderer.render(scene, pipCam);
        renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H);
        const src = renderer.domElement, pr = renderer.getPixelRatio();
        pctx.drawImage(src, 0, src.height - Math.round(pip.h * pr), Math.round(pip.w * pr), Math.round(pip.h * pr), 0, 0, dw, dh);
      }
      drawPipLabels(sim);
    }
    // ana görünüm
    updateSky(camera);
    scaleAll(camera, H, true);
    prepParticles(camera);
    if (composer) composer.render(); else renderer.render(scene, camera);
    drawHUD(sim, opt, now);
  }
  function missileTrail(sim) { if (sim.missile) mTrail = sim.missile.trail; return mTrail || []; }

  function setMode(m) { userMode = m; ctl.az = ctl.el = 0; ctl.zoom = 1; }
  // HSS canlı görüntüsü kendi küçük WebGL tuvaline çizilir; ana tuvalden kopyalama (GPU'yu bekleten okuma) gerekmez.
  // Etiketler üstteki 2B tuvale çizilir.
  function setPipCanvas(cv) {
    pipCv = cv; pctx = cv.getContext('2d');
    if (!ok || pipR) return;
    try {
      const wrap = document.createElement('div'); wrap.className = 'pipwrap';
      cv.parentNode.insertBefore(wrap, cv); wrap.appendChild(cv);
      pipGl = document.createElement('canvas'); pipGl.className = 'pipgl'; wrap.prepend(pipGl);
      pipR = new THREE.WebGLRenderer({ canvas: pipGl, antialias: true, logarithmicDepthBuffer: true });
      pipR.setPixelRatio(dpr); cv.classList.add('pipover');
    } catch (e) { pipR = null; if (pipGl) pipGl.remove(); pipGl = null; }
  }
  function camKey() { return curKey; }

  return { init, reset, render, setMode, setPipCanvas, camKey };
})();
