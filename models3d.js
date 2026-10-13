'use strict';
/* models3d.js — 3B modeller (metre cinsinden), yer tesisleri ve yordamsal dokular.
   Modeller +Y yönüne bakar; kök grubun ölçeği görünümde ayarlanır. */
const Models3D = (() => {
  let mat = null, glowTex = null, smokeTex = null, latticeMat = null, arrayMat = null, glassMat = null;

  function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function radialTex(n, stops) {
    const c = canvas(n), g = c.getContext('2d'), gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    stops.forEach(([o, col]) => gr.addColorStop(o, col));
    g.fillStyle = gr; g.fillRect(0, 0, n, n);
    return new THREE.CanvasTexture(c);
  }
  function makeSmokeTex() {
    const c = canvas(128), g = c.getContext('2d');
    for (let i = 0; i < 14; i++) {
      const x = 64 + (Math.random() - 0.5) * 50, y = 64 + (Math.random() - 0.5) * 50, r = 22 + Math.random() * 26;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }
    return new THREE.CanvasTexture(c);
  }
  function makeLattice() {
    const c = canvas(64), g = c.getContext('2d');
    g.strokeStyle = '#c7ccd1'; g.lineWidth = 4; g.strokeRect(2, 2, 60, 60);
    g.lineWidth = 2; g.beginPath(); g.moveTo(2, 2); g.lineTo(62, 62); g.moveTo(62, 2); g.lineTo(2, 62); g.stroke();
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 11);
    return t;
  }
  function makeArray() {
    const c = canvas(256), g = c.getContext('2d');
    g.fillStyle = '#262c31'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#3a444d'; g.lineWidth = 1;
    for (let i = 0; i <= 256; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
    g.strokeStyle = '#59636b'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 250);
    return new THREE.CanvasTexture(c);
  }

  function init() {
    const P = (c, o = {}) => new THREE.MeshPhongMaterial({ color: c, shininess: 30, specular: 0x222222, ...o });
    mat = {
      white: P(0xe6e9ec, { shininess: 55, specular: 0x444444 }), band: P(0x2b2f35), dark: P(0x1c1f23),
      steel: P(0x8a9198, { shininess: 90, specular: 0x777777 }), ablative: P(0x3a2f28, { shininess: 10 }),
      decoy: P(0x4c4742, { shininess: 14 }), foil: P(0xc49c45, { shininess: 100, specular: 0x8a6a28 }),
      silver: P(0xd6dce3, { shininess: 150, specular: 0xffffff }), olive: P(0x5a6440, { shininess: 6 }),
      oliveDk: P(0x3f4731, { shininess: 6 }), tire: P(0x18191a, { shininess: 4 }), unknown: P(0x6d5e82, { shininess: 40 }),
      debris: P(0x8b8882, { shininess: 18 }), black: P(0x0d0e10, { shininess: 6 }), cap: P(0xd9d5c9, { shininess: 20 }),
      earth: new THREE.MeshLambertMaterial({ color: 0x75684f }),
      concrete: new THREE.MeshLambertMaterial({ color: 0xb9b3a6 }), building: new THREE.MeshLambertMaterial({ color: 0xd8d3c7 }),
    };
    mat.whiteDS = mat.white.clone(); mat.whiteDS.side = THREE.DoubleSide;
    glassMat = P(0x1b2730, { shininess: 140, specular: 0x9fb2c4 });
    // test füzelerindeki siyah-beyaz dönüş deseni: dönüşü ve kademeleri görünür kılar
    const rc = canvas(256, 64), rg = rc.getContext('2d');
    for (let i = 0; i < 4; i++) { rg.fillStyle = i % 2 ? '#1d2024' : '#e9ecee'; rg.fillRect(i * 64, 0, 64, 64); }
    mat.roll = new THREE.MeshPhongMaterial({ map: new THREE.CanvasTexture(rc), shininess: 45, specular: 0x333333 });
    glowTex = radialTex(64, [[0, 'rgba(255,255,255,1)'], [0.22, 'rgba(255,255,255,0.75)'], [1, 'rgba(255,255,255,0)']]);
    smokeTex = makeSmokeTex();
    latticeMat = new THREE.MeshLambertMaterial({ map: makeLattice(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide });
    const at = makeArray();
    arrayMat = new THREE.MeshPhongMaterial({ map: at, emissive: 0x0c1a1f, shininess: 60, specular: 0x334455 });
  }

  /* ---------- yardımcılar ---------- */
  function cyl(rb, h, y0, m, seg = 24, rt = rb) { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); o.position.y = y0 + h / 2; return o; }
  function box(w, h, d, x, y, z, m) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; }
  function lathe(pts, m, seg = 24, p0 = 0, pl = Math.PI * 2) { return new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg, p0, pl), m); }
  function fins(g, n, r, y, span, h, thick, m) {
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + Math.PI / 4, f = box(span, h, thick, 0, 0, 0, m);
      f.position.set(Math.cos(a) * (r + span / 2), y, Math.sin(a) * (r + span / 2)); f.rotation.y = -a; g.add(f);
    }
  }
  function sprite(color, blending = THREE.AdditiveBlending, tex = glowTex) {
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, blending, transparent: true, depthWrite: false, fog: false }));
  }

  /* ---------- egzoz alevi: kamera yönüne dönen parlak katmanlar ---------- */
  function plume(scale) {
    const g = new THREE.Group(); g.userData.spr = []; g.userData.scale = scale;
    [0xfff2c4, 0xffbf55, 0xff8f2e, 0xf06a22, 0xc04a1e, 0x7a2e1a].forEach(c => { const s = sprite(c); g.add(s); g.userData.spr.push(s); });
    return g;
  }
  function updPlume(p, h, on) {
    p.visible = on;
    if (!on) return;
    const sc = p.userData.scale, vac = Math.min(1, Math.max(0, h / 60));
    const L = (16 + 34 * vac) * sc, w0 = (2.4 + 12 * vac) * sc;
    p.userData.spr.forEach((s, i) => {
      const f = i / 5, fl = 0.92 + Math.random() * 0.16;
      s.position.set(0, -L * (0.06 + f * 0.94), 0);
      const w = w0 * (0.55 + f * (1.2 + vac)) * fl;
      s.scale.set(w, w, 1);
      s.material.opacity = (1 - f * 0.78) * fl * (1 - vac * 0.35);
    });
  }

  /* ---------- araçlar ---------- */
  function missile() {
    const g = new THREE.Group(), s1 = new THREE.Group(), s2 = new THREE.Group(), nose = new THREE.Group();
    s1.add(cyl(0.95, 11, 0, mat.roll), cyl(0.965, 0.5, 2.0, mat.band), cyl(0.965, 0.25, 9.6, mat.band), cyl(0.62, 1.1, -1.1, mat.steel, 18, 0.42));
    fins(s1, 4, 0.95, 1.4, 1.1, 2.6, 0.1, mat.dark);
    s2.add(cyl(0.95, 0.9, 11, mat.dark), cyl(0.95, 6, 11.9, mat.white), cyl(0.965, 0.3, 16.2, mat.band), cyl(0.5, 0.8, 10.2, mat.steel, 16, 0.35));
    nose.add(lathe([[0.95, 0], [0.94, 1.2], [0.82, 2.5], [0.58, 3.6], [0.28, 4.4], [0, 4.8]], mat.white));
    nose.position.y = 17.9;
    g.add(s1, s2, nose);
    const pl = plume(1); pl.position.y = -1.1; g.add(pl);
    return { g, s1, s2, nose, plume: pl, len: 23.8, anchors: { s1: [0, 5.5, 0], s2: [0, 14.5, 0], nose: [0, 20, 0] } };
  }
  function stage1From(m) { const g = new THREE.Group(); g.add(m.s1.clone()); return { g, len: 12 }; }
  function stage2() { const g = new THREE.Group(); g.add(cyl(0.95, 6.9, 0, mat.white), cyl(0.5, 0.8, -0.8, mat.steel, 16, 0.35), cyl(0.965, 0.3, 5.2, mat.band)); return { g, len: 7.7 }; }
  function rvShape(m) {
    const g = new THREE.Group();
    g.add(lathe([[0.7, 0], [0.64, 0.5], [0.42, 1.5], [0.16, 2.15], [0.05, 2.3], [0, 2.32]], m, 20), cyl(0.7, 0.12, -0.12, mat.dark, 20));
    return g;
  }
  function rv() { const g = new THREE.Group(); g.add(rvShape(mat.ablative)); return { g, len: 2.4 }; }
  function heavy() { const g = new THREE.Group(), r = rvShape(mat.decoy); r.scale.setScalar(0.96); g.add(r); return { g, len: 2.3 }; }
  function balloon() {
    const g = new THREE.Group(), inner = new THREE.Group();
    const b = new THREE.Mesh(new THREE.SphereGeometry(1.0, 22, 16), mat.silver); b.position.y = 1; inner.add(b);
    g.add(inner); return { g, inner, len: 2.0 };
  }
  function debris() {
    const g = new THREE.Group(), inner = new THREE.Group();
    inner.add(box(2.4, 0.9, 1.3, 0, 0, 0, mat.debris));
    const b = box(1.2, 0.5, 1.6, 0.6, 0.5, 0.3, mat.dark); b.rotation.set(0.4, 0.8, 0.2); inner.add(b);
    g.add(inner); return { g, inner, len: 2.6 };
  }
  function unknownObj() {
    const g = new THREE.Group();
    const n = lathe([[0.35, 0], [0.2, 0.5], [0, 0.7]], mat.unknown, 16); n.position.y = 2.4;
    g.add(cyl(0.35, 2.4, 0, mat.unknown, 16), n);
    fins(g, 3, 0.35, 0.3, 0.4, 0.6, 0.05, mat.dark);
    return { g, len: 3.1 };
  }
  function bus() {
    const g = new THREE.Group();
    g.add(cyl(1.15, 1.3, 0, mat.foil, 24), cyl(1.18, 0.12, 1.3, mat.dark, 24), cyl(0.4, 0.6, -0.6, mat.steel, 14, 0.25));
    const rvs = [];
    for (let i = 0; i < 6; i++) {
      const r = rvShape(mat.ablative), a = i / 6 * Math.PI * 2;
      r.position.set(Math.cos(a) * 0.72, 1.42, Math.sin(a) * 0.72); r.scale.setScalar(0.5);
      g.add(r); rvs.push(r);
    }
    const jets = [];
    for (let i = 0; i < 4; i++) {
      const s = sprite(0xd6ecff), a = i / 4 * Math.PI * 2 + Math.PI / 4;
      s.position.set(Math.cos(a) * 1.3, 0.5, Math.sin(a) * 1.3); s.scale.set(1.4, 1.4, 1); g.add(s); jets.push(s);
    }
    const pl = plume(0.16); pl.position.y = -0.9; g.add(pl);
    return { g, rvs, jets, plume: pl, len: 3.4 };
  }
  function fairingHalf(p0) {
    const g = new THREE.Group();
    const m = lathe([[1.28, 0], [1.27, 1.6], [1.1, 3.0], [0.78, 4.2], [0.36, 5.0], [0, 5.4]], mat.whiteDS, 16, p0, Math.PI);
    m.position.y = -0.7; g.add(m);
    return g;
  }
  function interceptor() {
    const g = new THREE.Group();
    const n = lathe([[0.19, 0], [0.16, 0.5], [0.09, 0.95], [0, 1.2]], mat.white, 16); n.position.y = 5;
    g.add(cyl(0.19, 5.0, 0, mat.white, 16), cyl(0.2, 0.25, 1.2, mat.band, 16), n);
    fins(g, 4, 0.19, 0.35, 0.32, 0.6, 0.03, mat.dark);
    const pl = plume(0.3); pl.position.y = -0.1; g.add(pl);
    return { g, plume: pl, len: 6.2 };
  }

  /* ---------- yer tesisleri ---------- */
  function terrainTex(kind) {
    const N = 512, c = canvas(N), g = c.getContext('2d');
    const pal = kind === 'desert' ? ['#a39478', '#b3a385', '#8f8167', '#c1b292', '#7d7259', '#9c8d6f'] : ['#6f7a52', '#7d8a5c', '#5f6b45', '#8a9466', '#6a7550', '#9a9a70'];
    g.fillStyle = pal[0]; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 2600; i++) {
      g.globalAlpha = 0.18 + Math.random() * 0.2; g.fillStyle = pal[1 + (i % 5)];
      g.beginPath(); g.ellipse(Math.random() * N, Math.random() * N, 2 + Math.random() * 26, 2 + Math.random() * 14, Math.random() * 3, 0, 7); g.fill();
    }
    if (kind !== 'desert') for (let i = 0; i < 160; i++) {
      g.globalAlpha = 0.25; g.fillStyle = pal[1 + (i % 5)];
      g.save(); g.translate(Math.random() * N, Math.random() * N); g.rotate(Math.random() * 0.4); g.fillRect(0, 0, 6 + Math.random() * 20, 4 + Math.random() * 14); g.restore();
    }
    g.globalAlpha = 1; fade(g, N, 0.62);
    return new THREE.CanvasTexture(c);
  }
  function detailTex(kind) {
    const N = 512, c = canvas(N), g = c.getContext('2d');
    g.fillStyle = kind === 'pad' ? '#b0a183' : '#717d55'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 1800; i++) {
      g.globalAlpha = 0.2; g.fillStyle = i % 2 ? '#9b8d70' : (kind === 'pad' ? '#c2b494' : '#83905f');
      g.beginPath(); g.arc(Math.random() * N, Math.random() * N, 1 + Math.random() * 6, 0, 7); g.fill();
    }
    g.globalAlpha = 1; g.strokeStyle = '#6d6a62'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(N / 2, N / 2); g.lineTo(N * 0.12, N * 0.82); g.moveTo(N / 2, N / 2); g.lineTo(N * 0.86, N * 0.18); g.stroke();
    if (kind === 'pad') { g.fillStyle = '#cfc9bb'; g.beginPath(); g.arc(N / 2, N / 2, 14, 0, 7); g.fill(); }
    fade(g, N, 0.5);
    return new THREE.CanvasTexture(c);
  }
  function fade(g, N, inner) {
    g.globalCompositeOperation = 'destination-in';
    const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(inner, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, N, N);
    g.globalCompositeOperation = 'source-over';
  }
  function patch(radius, tex, y) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 72), new THREE.MeshLambertMaterial({ map: tex, transparent: true }));
    m.rotation.x = -Math.PI / 2; m.position.y = y; return m;
  }
  function padSite() {
    const g = new THREE.Group();
    g.add(patch(60000, terrainTex('desert'), 0), patch(2500, detailTex('pad'), 0.5));
    g.add(cyl(48, 1.6, 0, mat.concrete, 40), box(9, 0.2, 42, 0, 1.65, 26, mat.dark));
    g.add(box(5, 56, 5, -7.4, 28, 0, latticeMat), box(5.6, 1, 5.6, -7.4, 56.5, 0, mat.steel));
    for (const y of [8, 15, 21]) g.add(box(4.6, 0.6, 1.2, -3.9, y, 0, mat.steel));
    for (const [x, z] of [[70, 70], [-70, 70], [70, -70], [-70, -70]]) { const m = cyl(0.35, 78, 0, mat.steel, 8); m.position.x = x; m.position.z = z; g.add(m); }
    g.add(box(42, 15, 26, -430, 7.5, 380, mat.building), box(26, 9, 18, -380, 4.5, -260, mat.building), box(64, 50, 42, 960, 25, -720, mat.building));
    for (const x of [-150, -175]) { const t = cyl(6, 14, 0, mat.building, 20); t.position.x = x; t.position.z = -120; g.add(t); }
    return g;
  }
  function wheels(g, zs, half, r = 0.6) {
    for (const z of zs) for (const x of [-half, half]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.5, 14), mat.tire); w.rotation.z = Math.PI / 2; w.position.set(x, r, z); g.add(w);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, 0.52, 10), mat.oliveDk); hub.rotation.z = Math.PI / 2; hub.position.set(x, r, z); g.add(hub);
    }
  }
  // 8x8 fırlatıcı araç: arka tarafı tehdide dönük, 2x4 kanister paketi yükseltilmiş
  function launcher() {
    const g = new THREE.Group();
    g.add(box(2.6, 1.1, 12, 0, 1.6, -0.4, mat.olive));                        // şasi
    g.add(box(2.7, 2.5, 2.8, 0, 2.6, 5.3, mat.oliveDk));                      // kabin
    g.add(box(2.5, 0.9, 0.08, 0, 3.2, 6.72, glassMat));                       // ön cam
    for (const x of [-1.36, 1.36]) g.add(box(0.06, 0.8, 1.8, x, 3.1, 5.4, glassMat));
    g.add(box(2.8, 0.25, 12.4, 0, 1.0, -0.4, mat.dark));                      // çamurluk hattı
    wheels(g, [-4.6, -3.2, 2.0, 3.4], 1.3);
    for (const x of [-1.55, 1.55]) for (const z of [-6.1, 2.6]) g.add(box(0.35, 1.6, 0.35, x, 0.8, z, mat.oliveDk));  // destek ayakları
    const pack = new THREE.Group(); pack.position.set(0, 2.3, 3.0);
    pack.add(box(2.5, 2.5, 7.8, 0, 1.25, -3.9, mat.oliveDk));
    const caps = [];
    for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) {
      const x = -0.87 + col * 0.58, y = 0.66 + row * 1.18;
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.12, 16), mat.black); tube.rotation.x = Math.PI / 2; tube.position.set(x, y, -7.84); pack.add(tube);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.06, 16), mat.cap); cap.rotation.x = Math.PI / 2; cap.position.set(x, y, -7.92); pack.add(cap);
      caps.push(cap);
    }
    pack.rotation.x = 0.95;
    g.add(pack);
    // toprak set: üç yanı kapalı, tehdit yönü açık
    g.add(box(10, 1.6, 2.2, 0, 0.8, 9.2, mat.earth), box(2.2, 1.6, 16, -6.2, 0.8, 1.2, mat.earth), box(2.2, 1.6, 16, 6.2, 0.8, 1.2, mat.earth));
    return { g, caps };
  }
  function shelter(g, x, z, w = 6, d = 3, mast = false) {
    g.add(box(w, 2.8, d, x, 1.4, z, mat.olive), box(w + 0.1, 0.15, d + 0.1, x, 2.85, z, mat.oliveDk));
    if (mast) { const m = cyl(0.12, 12, 2.8, mat.steel, 8); m.position.x = x + w / 2 - 0.4; m.position.z = z; g.add(m);
      const dish = lathe([[0, 0], [0.5, 0.15], [0.9, 0.45]], mat.white, 16); dish.position.set(x + w / 2 - 0.4, 14.6, z); dish.rotation.x = -1.1; g.add(dish); }
  }
  function batterySite(offsMeters) {
    const g = new THREE.Group();
    g.add(patch(60000, terrainTex('green'), 0), patch(1500, detailTex('bat'), 0.5));
    // X-bant faz dizili radar: römork + dizi yüzü + destek üniteleri
    const r = new THREE.Group(); r.position.set(-40, 0, 320);
    r.add(box(3.2, 1.6, 13, 0, 1.7, 0, mat.olive), box(3.4, 0.25, 13.2, 0, 1.0, 0, mat.dark));
    wheels(r, [3.6, 5.0], 1.35, 0.55);
    const arr = new THREE.Mesh(new THREE.BoxGeometry(9.5, 6.5, 0.8), [mat.oliveDk, mat.oliveDk, mat.oliveDk, mat.oliveDk, mat.oliveDk, arrayMat]);
    arr.position.set(0, 6.4, -3.2); arr.rotation.x = 0.35; r.add(arr);
    r.add(box(1.0, 4.5, 1.0, -3.8, 4.4, -1.6, mat.oliveDk), box(1.0, 4.5, 1.0, 3.8, 4.4, -1.6, mat.oliveDk));
    g.add(r);
    shelter(g, -55, 360, 6, 3);                    // elektronik ünitesi
    shelter(g, -25, 362, 5, 2.6);                  // soğutma ünitesi
    shelter(g, 20, 380, 7, 2.8);                   // güç ünitesi (jeneratör)
    // atış kontrol merkezi
    shelter(g, -250, 150, 6.5, 3, true); shelter(g, -262, 158, 6.5, 3, true);
    const launchers = offsMeters.map(x => { const L = launcher(); L.g.position.x = x; g.add(L.g); return L; });
    g.add(box(4, 2.4, 7, 180, 1.2, 220, mat.oliveDk), box(4, 2.4, 7, 186, 1.2, 230, mat.oliveDk));   // ikmal araçları
    return { g, radarAt: [-40, 9, 317], fcAt: [-255, 3, 154], launchers };
  }

  /* ---------- Dünya dokusu (yordamsal, gerçek coğrafya içermez) ---------- */
  function noise3(seed) {
    let a = seed;
    const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const perm = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    const p = new Uint8Array(512); for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    const val = new Float32Array(256); for (let i = 0; i < 256; i++) val[i] = rnd();
    const fd = t => t * t * (3 - 2 * t), lp = (a, b, t) => a + (b - a) * t;
    return (x, y, z) => {
      const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
      const fx = fd(x - X), fy = fd(y - Y), fz = fd(z - Z), xi = X & 255, yi = Y & 255, zi = Z & 255;
      const h = (i, j, k) => val[p[p[p[(xi + i) & 255] + ((yi + j) & 255)] + ((zi + k) & 255)]];
      return lp(lp(lp(h(0, 0, 0), h(1, 0, 0), fx), lp(h(0, 1, 0), h(1, 1, 0), fx), fy),
        lp(lp(h(0, 0, 1), h(1, 0, 1), fx), lp(h(0, 1, 1), h(1, 1, 1), fx), fy), fz);
    };
  }
  function fbm(n, x, y, z, oct) { let a = 0.5, f = 1, s = 0, t = 0; for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f, z * f); t += a; a *= 0.5; f *= 2.03; } return s / t; }

  function earthTextures(blobs, done) {
    const n1 = noise3(7), n2 = noise3(19), n3 = noise3(31);
    const TW = 1536, TH = 768, cv = canvas(TW, TH), sp = canvas(TW, TH);
    const ctx = cv.getContext('2d'), sctx = sp.getContext('2d');
    const img = ctx.createImageData(TW, TH), spec = sctx.createImageData(TW, TH);
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const cl = (v, a, b) => v < a ? a : v > b ? b : v;
    let row = 0;
    const chunk = () => {
      const end = Math.min(TH, row + 32);
      for (; row < end; row++) {
        const th = row / TH * Math.PI, st = Math.sin(th), ct = Math.cos(th);
        for (let px = 0; px < TW; px++) {
          const ph = px / TW * Math.PI * 2, dx = -Math.cos(ph) * st, dy = ct, dz = Math.sin(ph) * st;
          const base = fbm(n1, dx * 1.9 + 11, dy * 1.9 + 3, dz * 1.9 + 5, 6);
          let e = base;
          for (const b of blobs) e += 0.16 * Math.exp(-(1 - (dx * b.x + dy * b.y + dz * b.z)) * 60);
          const lat = Math.abs(dy), i = (row * TW + px) * 4;
          let c, sv;
          if (e > 0.53) {
            const hgt = cl((base - 0.55) / 0.2, 0, 1), dry = n2(dx * 3 + 1, dy * 3, dz * 3) * (1 - Math.abs(lat - 0.4) * 1.6);
            c = mix([46, 78, 40], [134, 118, 76], cl(dry * 1.4, 0, 1));
            c = mix(c, [104, 96, 84], hgt * 0.6);
            const fine = n2(dx * 40, dy * 40, dz * 40) - 0.5; c = mix(c, [c[0] * 1.15, c[1] * 1.12, c[2] * 1.1], fine);
            if (lat > 0.84) c = [226, 234, 240];
            sv = 16;
          } else {
            const dep = cl((0.53 - e) / 0.2, 0, 1);
            c = mix([30, 96, 136], [8, 30, 58], dep);
            if (lat > 0.9) c = [214, 226, 236];
            sv = 120;
          }
          img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
          spec.data[i] = spec.data[i + 1] = spec.data[i + 2] = sv; spec.data[i + 3] = 255;
        }
      }
      if (row < TH) return setTimeout(chunk, 0);
      ctx.putImageData(img, 0, 0); sctx.putImageData(spec, 0, 0);
      const CW = 768, CH = 384, cc = canvas(CW, CH), cx = cc.getContext('2d'), ci = cx.createImageData(CW, CH);
      for (let y = 0; y < CH; y++) {
        const th = y / CH * Math.PI, st = Math.sin(th), ct = Math.cos(th);
        for (let x = 0; x < CW; x++) {
          const ph = x / CW * Math.PI * 2, v = fbm(n3, -Math.cos(ph) * st * 2.6, ct * 2.6, Math.sin(ph) * st * 2.6, 5);
          const j = (y * CW + x) * 4;
          ci.data[j] = ci.data[j + 1] = ci.data[j + 2] = 255; ci.data[j + 3] = cl((v - 0.53) / 0.18, 0, 1) * 210;
        }
      }
      cx.putImageData(ci, 0, 0);
      done(new THREE.CanvasTexture(cv), new THREE.CanvasTexture(sp), new THREE.CanvasTexture(cc));
    };
    chunk();
  }

  return {
    init, sprite, updPlume, missile, stage1From, stage2, rv, heavy, balloon, debris, unknownObj, bus, fairingHalf, interceptor,
    padSite, batterySite, earthTextures,
    get glowTex() { return glowTex; }, get smokeTex() { return smokeTex; },
  };
})();
