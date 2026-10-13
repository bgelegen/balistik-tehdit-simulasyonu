'use strict';
/* =================================================================
   sim.js — Fizik, sensör ve karar modeli (eğitim amaçlı, basitleştirilmiş)
   Raporun yöntemiyle uyumlu: iki cisim yerçekimi + US76 atmosfer sürüklemesi, Swerling türü RKA
   dalgalanması, Kalman filtresiyle β kestirimi, ml.js sınıflandırıcısı, T = 100·P·K·U ve radar
   turlarına bağlı yeniden önceliklendirme (ateşle-gözle-ateşle).
   Koordinatlar: Dünya merkezli uçuş düzlemi (x, y) [km], z = yan menzil [km]
   Tüm imza değerleri temsilîdir; gerçek bir sisteme ait değildir.
   ================================================================= */

const R_E = 6371, MU = 398600.4418, KARMAN = 100;
const ENTRY = 120;          // yeniden giriş arayüzü [km]: angajman burada başlar
const TB = 170;             // itki evresi süresi [s]
const PK = 0.85;            // tek atış vuruş olasılığı
const ENG_MIN = 10;         // angajman eşiği (tehdit skoru)
const KILL_R = 0.3;         // önleme yarıçapı [km]
const ICPT_V = 4.5;         // önleyici hızı [km/s]
const RADAR_RANGE = 2600;   // radar menzili [km]
const RADAR_DT = 1;         // radar güncelleme aralığı [s]: her önceliklendirme turu bundan kısa sürmeli
const A_NOISE = 0.4;        // ivme ölçüm gürültüsü [m/s²]

const TYPE_INFO = {
  rv:      { name: 'Harp başlığı (RV)',         group: 'GERCEK' },
  heavy:   { name: 'Ağır sahte hedef',          group: 'SAHTE' },
  light:   { name: 'Hafif sahte hedef (balon)', group: 'SAHTE' },
  debris:  { name: 'Roket enkazı',              group: 'SAHTE' },
  bus:     { name: 'Taşıyıcı (bus) gövdesi',    group: 'SAHTE' },
  unknown: { name: 'Bilinmeyen tip nesne',      group: 'BILINMEYEN' },
  stage1:  { name: '1. kademe gövdesi',         group: 'SAHTE' },
};
const LABEL_TR = { IZLENIYOR: 'İZLENİYOR', GERCEK: 'GERÇEK', SAHTE: 'SAHTE', BILINMEYEN: 'BİLİNMEYEN' };
const SUB_TR = { rv: 'harp başlığı', heavy: 'ağır sahte', light: 'hafif sahte', debris: 'enkaz' };
const COL = { GERCEK: '#ff5a4e', SAHTE: '#5fb4ff', BILINMEYEN: '#d38cff', IZLENIYOR: '#c9d3db', untracked: '#7f909d' };
const TRUTH_COL = { rv: '#ff5a4e', heavy: '#5fb4ff', light: '#8fd3ff', debris: '#a3adb7', bus: '#a3adb7', unknown: '#d38cff', stage1: '#6b7783' };

/* Sınıf imzaları: [ortalama, sınıf içi yayılım]
   rcs: ortalama radar kesit alanı [dBsm] · lper: log10 presesyon periyodu [s]
   amp: RKA modülasyon genliği [dB] · reg: hareket düzenliliği [0–1]
   lcool: log10 soğuma hızı [K/s] · lbeta: log10 balistik katsayı [kg/m²] */
const SIG = {
  rv:     { rcs: [-18, 2.0],   lper: [0.48, 0.08], amp: [2.0, 0.6], reg: [0.90, 0.04], lcool: [-1.70, 0.15], lbeta: [4.18, 0.10] },
  heavy:  { rcs: [-16.5, 2.5], lper: [0.56, 0.12], amp: [3.0, 1.0], reg: [0.82, 0.08], lcool: [-1.45, 0.20], lbeta: [3.40, 0.15] },
  light:  { rcs: [-14, 3.0],   lper: [0.78, 0.25], amp: [4.5, 1.5], reg: [0.55, 0.15], lcool: [-0.52, 0.35], lbeta: [0.48, 0.30] },
  debris: { rcs: [-3, 3.0],    lper: [0.26, 0.15], amp: [9.0, 2.5], reg: [0.30, 0.10], lcool: [-0.60, 0.25], lbeta: [2.48, 0.30] },
};
const UNKNOWN_SIG = { rcs: [-17, 1.0], lper: [-0.46, 0.03], amp: [1.5, 0.3], reg: [0.95, 0.02], lcool: [-1.60, 0.10], lbeta: [3.78, 0.05] };
const CLASSES = ['rv', 'heavy', 'light', 'debris'];
const PRIOR = { rv: 0.20, heavy: 0.20, light: 0.35, debris: 0.25 };
const FEATS = ['rcs', 'lper', 'amp', 'reg', 'lcool'];
const MEAS = { rcs: 3.0, lper: 0.20, amp: 1.5, reg: 0.12, lcool: 0.30 };

const ASSET_DEF = [
  { name: 'Kent-A', ds: 0, c: 0, val: 1.0, kind: 'kent' },
  { name: 'Hava Üssü-B', ds: -35, c: 45, val: 0.85, kind: 'us' },
  { name: 'Enerji Santrali-D', ds: 30, c: 55, val: 0.9, kind: 'enerji' },
  { name: 'Liman-C', ds: 60, c: -40, val: 0.75, kind: 'liman' },
];
const BAT_DEF = { name: 'HS Bataryası', ds: -80, c: -5, val: 0.8, kind: 'bat' };
const MIRV_AIMS = [
  { ds: 0, c: 0, name: 'Kent-A' }, { ds: -35, c: 45, name: 'Hava Üssü-B' },
  { ds: 30, c: 55, name: 'Enerji Santrali-D' }, { ds: 60, c: -40, name: 'Liman-C' },
  { ds: -80, c: -5, name: 'HS Bataryası' }, { ds: 10, c: -14, name: 'Kent-A (doğu)' },
];

/* ---------- yardımcılar ---------- */
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function gauss() { let u = 0; while (u === 0) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); }
/* US Standard Atmosphere 1976: 86 km'ye kadar katmanlı sıcaklık modeli, üstünde tablo değerleri arasında üstel ara değer */
const US76 = [[0, 288.15, -6.5, 101325], [11, 216.65, 0, 22632.06], [20, 216.65, 1.0, 5474.889], [32, 228.65, 2.8, 868.0187],
  [47, 270.65, 0, 110.9063], [51, 270.65, -2.8, 66.93887], [71, 214.65, -2.0, 3.956420]];
const US76_HI = [[86, 6.958e-6], [100, 5.604e-7], [120, 2.222e-8], [150, 2.076e-9], [200, 2.541e-10]];
function rho(h) {
  if (h > 200) return 0;
  if (h >= 86) {
    let i = 0; while (h > US76_HI[i + 1][0]) i++;
    const [h0, r0] = US76_HI[i], [h1, r1] = US76_HI[i + 1];
    return r0 * Math.pow(r1 / r0, (h - h0) / (h1 - h0));
  }
  const z = Math.max(h, 0), hg = 6356.766 * z / (6356.766 + z);       // jeopotansiyel irtifa
  let L = US76[0]; for (const l of US76) if (hg >= l[0]) L = l;
  const [hb, Tb, lap, Pb] = L, T = Tb + lap * (hg - hb);
  const P = lap === 0 ? Pb * Math.exp(-34.1632 * (hg - hb) / Tb) : Pb * Math.pow(Tb / T, 34.1632 / lap);
  return P / (287.053 * T);
}
function altOf(o) { return Math.hypot(o.x, o.y) - R_E; }
function rangeOf(o) { return R_E * Math.atan2(o.y, o.x); }
function speedOf(o) { return Math.hypot(o.vx, o.vy, o.vz); }
function fmtT(t) { const s = Math.max(0, Math.floor(t)); return 'T+' + String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
function colorOf(o, truth) {
  if (truth) return TRUTH_COL[o.type] || '#fff';
  if (!o.tracked) return COL.untracked;
  return COL[o.cls ? o.cls.label : 'IZLENIYOR'];
}
function addAlong(o, dv) { const v = Math.hypot(o.vx, o.vy) || 1; o.vx += o.vx / v * dv; o.vy += o.vy / v * dv; }

/* ---------- dinamik: iki cisim yerçekimi + üstel atmosfer sürüklemesi ---------- */
function step(o, dt) {
  const r = Math.hypot(o.x, o.y), g = -MU / (r * r * r);
  let ax = g * o.x, ay = g * o.y, az = 0, ad = 0;
  const d = rho(r - R_E);
  if (d > 0) {
    const v = Math.hypot(o.vx, o.vy, o.vz);
    if (v > 1e-6) {
      ad = Math.min(500 * d * v * v / o.beta, 0.5 * v / dt);   // km/s²
      ax -= ad * o.vx / v; ay -= ad * o.vy / v; az -= ad * o.vz / v;
    }
  }
  o.vx += ax * dt; o.vy += ay * dt; o.vz += az * dt;
  o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
  o.ad = ad;
}

function predictImpact(o, beta) {
  const p = { x: o.x, y: o.y, z: o.z || 0, vx: o.vx, vy: o.vy, vz: o.vz || 0, beta };
  let t = 0;
  for (let i = 0; i < 5000; i++) {
    const h = Math.hypot(p.x, p.y) - R_E;
    if (h <= 0) break;
    const dt = h > 160 ? 1 : h > 40 ? 0.25 : 0.1;
    step(p, dt); t += dt;
  }
  return { s: R_E * Math.atan2(p.y, p.x), c: p.z, t };
}

function solveBurnout(S) {
  const psi = S / R_E;
  const gam = Math.max(0.42, (Math.PI - psi) / 4);          // en düşük enerjili yörüngeye yakın
  const hb = 180, sb = clamp(1.3 * hb / Math.tan(gam), 200, 520);
  const th = sb / R_E, r = R_E + hb;
  const mk = v => ({
    x: r * Math.cos(th), y: r * Math.sin(th), z: 0, vz: 0,
    vx: v * (Math.sin(gam) * Math.cos(th) - Math.cos(gam) * Math.sin(th)),
    vy: v * (Math.sin(gam) * Math.sin(th) + Math.cos(gam) * Math.cos(th)),
  });
  let lo = 1, hi = 7.6;
  for (let i = 0; i < 32; i++) { const m = (lo + hi) / 2; if (predictImpact(mk(m), 800).s < S) lo = m; else hi = m; }
  const v = (lo + hi) / 2;
  return { v, gam, hb, sb, state: mk(v) };
}

// İtki evresi: dikey kalkıştan yanma sonu durumuna Hermite eğrisi
function boostAt(B, t) {
  const u = Math.pow(clamp(t / TB, 0, 1), 2), u2 = u * u, u3 = u2 * u;   // ~1,8 g sabit ivmeli kalkış
  const h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  const L1 = B.v * TB / 2;
  const s = h01 * B.sb + h11 * L1 * Math.cos(B.gam);
  const h = h10 * 260 + h01 * B.hb + h11 * L1 * Math.sin(B.gam);
  const th = s / R_E, r = R_E + h;
  return { x: r * Math.cos(th), y: r * Math.sin(th), z: 0 };
}

// MIRV taşıyıcısının hedefe yönelme manevrası: hız yönünde gereken Δv
function aimDv(o, sTarget) {
  const v = Math.hypot(o.vx, o.vy), ux = o.vx / v, uy = o.vy / v;
  const tryDv = d => predictImpact({ x: o.x, y: o.y, vx: o.vx + ux * d, vy: o.vy + uy * d }, 15000);
  let lo = -0.8, hi = 0.8;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (tryDv(m).s < sTarget) lo = m; else hi = m; }
  const dv = (lo + hi) / 2;
  return { dv, t: tryDv(dv).t };
}

/* ---------- iz verisi ve Kalman filtresiyle balistik katsayı kestirimi ----------
   Durum: θ = 1/β. Ölçüm: sürükleme ivmesi a = q·θ + gürültü (q: dinamik basınç).
   Her ölçümde öngörü-düzeltme adımı uygulanır; P kestirimin belirsizliğidir. */
function newTrack() { return { n: 0, sum: { rcs: 0, lper: 0, amp: 0, reg: 0, lcool: 0 }, kf: { th: 0, P: 1, nb: 0 }, hist: [] }; }

function kfUpdate(kf, q, a) {
  const R = A_NOISE * A_NOISE, Q = 1e-14;          // ölçüm ve süreç gürültüsü
  kf.P += Q;                                         // öngörü (β sabit kabul edilir)
  const S = q * q * kf.P + R, Kg = kf.P * q / S;     // Kalman kazancı
  kf.th += Kg * (a - q * kf.th);                     // düzeltme
  kf.P *= (1 - Kg * q);
  kf.nb++;
}

function betaEst(tr) {
  if (!tr.kf.nb) return null;
  const bh = tr.kf.th, sb = Math.sqrt(tr.kf.P);
  return { bh, sb, sig: bh > 3 * sb };
}

/* ---------- sınıflandırma: ml.js (gradyan artırmalı ağaçlar + kalibrasyon + Isolation Forest) ----------
   Kural tabanlı kıyas modelinin kararı her iz için ayrıca hesaplanır. */
function classify(o) {
  const tr = o.tr, n = tr.n, model = Sim.cfg ? Sim.cfg.model : 'ml';
  if (n < 4) return { p: { ...PRIOR }, best: 'rv', label: 'IZLENIYOR', n, ruleLabel: 'IZLENIYOR', mlLabel: 'IZLENIYOR', model };
  const r = ML.predict(tr, betaEst(tr));
  if (model === 'rule') {
    const g = r.rule.label === 'GERCEK';
    return { p: { rv: g ? 1 : 0, heavy: g ? 0 : 1, light: 0, debris: 0 }, best: g ? 'rv' : 'heavy', label: r.rule.label, n,
      ruleLabel: r.rule.label, why: r.rule.why, mlLabel: r.label, mlP: r.p.rv, iso: r.iso, model };
  }
  return { p: r.p, best: r.best, label: r.label, n, ruleLabel: r.rule.label, why: r.rule.why, mlLabel: r.label, mlP: r.p.rv, iso: r.iso, model };
}

function betaGuess(o) {
  const e = betaEst(o.tr);
  return e && e.sig ? clamp(1 / e.bh, 0.5, 1e5) : 15000;
}

function threatScore(o, assets) {
  const c = o.cls;
  if (!c || !o.pred) return 0;
  const P = c.label === 'BILINMEYEN' ? Math.max(c.p.rv, 0.65) : c.label === 'IZLENIYOR' ? 0.5 : c.p.rv;
  let K = 0.08, near = null, nd = Infinity;
  for (const a of assets) {
    const d = Math.hypot(o.pred.s - a.s, o.pred.c - a.c);
    const k = a.val * Math.exp(-((d / 30) ** 2));
    if (d < nd) { nd = d; near = a; }
    if (k > K) K = k;
  }
  const U = clamp(80 / (Math.max(o.pred.t, 0) + 20), 0.15, 1);
  if (c.model === 'rule') {          // kıyas: GERÇEK etiketli izler yalnızca çarpmaya kalan süreye göre sıralanır
    o.kInfo = { P: c.label === 'GERCEK' ? 1 : 0, K: 1, U, near, nd, rule: true };
    return c.label === 'GERCEK' ? 100 * U : 0;
  }
  o.kInfo = { P, K, U, near, nd };
  return 100 * P * K * U;
}

/* ---------- senaryo ---------- */
const Sim = {
  phase: 'ready', t: 0, objs: [], icpts: [], fx: [], log: [], events: [], onLog: null, onPhase: null, onEvent: null, hot: false,

  reset(cfg) {
    Object.assign(this, {
      cfg, t: 0, phase: 'ready', objs: [], icpts: [], fx: [], log: [], events: [], plan: [],
      nextTrack: 1, nextIcpt: 1, missile: null, bus: null, stage1Done: false, exoLogged: false,
      acc: { meas: 0, fast: 0 }, hot: false, rounds: { n: 0, sum: 0, max: 0 },
      relNo: 0, T: { stage1: null, fairing: null, karman: null, burnout: null, busDone: null, apogee: null, radar: null, entry: null, fire: null, done: null },
    });
    const S = cfg.range; this.S = S;
    this.assets = ASSET_DEF.map(a => ({ ...a, s: S + a.ds }));
    const bat = { ...BAT_DEF, s: S + BAT_DEF.ds }, th = bat.s / R_E;
    bat.pos = { x: R_E * Math.cos(th), y: R_E * Math.sin(th), z: bat.c };
    bat.up = { x: Math.cos(th), y: Math.sin(th), z: 0 };
    this.bat = bat; this.assets.push(bat);
    // önleyiciler dört fırlatıcıya sırayla paylaştırılır (fırlatıcı başına en çok 8 tüp)
    this.launchers = [-0.15, -0.05, 0.05, 0.15].map((off, i) => ({ ready: 0, off, no: i + 1, fired: 0,
      rounds: Math.min(8, Math.floor(cfg.interceptors / 4) + (i < cfg.interceptors % 4 ? 1 : 0)) }));
    this.inventory = this.launchers.reduce((a, L) => a + L.rounds, 0);
    this.B = solveBurnout(S);
    this.nominal = this.buildNominal();
    this.stats = { rv: 0, rvKilled: 0, rvLeaked: 0, decoys: 0, filtered: 0, shots: 0, hitRv: 0, hitDecoy: 0, hitUnknown: 0, miss: 0, unk: 0, unkKilled: 0, unkLeaked: 0 };
    this.buildPlan();
  },

  buildNominal() {
    const pts = [];
    for (let t = 0; t <= TB; t += 5) pts.push(boostAt(this.B, t));
    const p = { ...this.B.state, beta: 800 };
    let apo = 0;
    for (let i = 0; i < 20000; i++) {
      const h = altOf(p);
      if (h <= 0) break;
      apo = Math.max(apo, h);
      step(p, h > 40 ? 1 : 0.25);
      if (i % 10 === 0) pts.push({ x: p.x, y: p.y, z: 0 });
    }
    pts.push({ x: p.x, y: p.y, z: 0 });
    this.apogee = apo;
    return pts;
  },

  buildPlan() {
    const c = this.cfg, per = { low: [1, 0], mid: [2, 1], high: [3, 1] }[c.density], plan = [{ t: TB + 4, kind: 'fairing' }];
    if (c.mode === 'MIRV') {
      for (let i = 0; i < c.nRv; i++) {
        const tr = TB + 30 + i * 32;
        plan.push({ t: tr - 8, kind: 'burn', dur: 8 });
        plan.push({ t: tr, kind: 'release', aim: MIRV_AIMS[i % MIRV_AIMS.length], nRv: 1, light: per[0], heavy: per[1], unknown: c.unknown && i === Math.min(1, c.nRv - 1), jitRv: 0 });
      }
    } else {
      plan.push({ t: TB + 22, kind: 'burn', dur: 8 });
      plan.push({ t: TB + 30, kind: 'release', aim: MIRV_AIMS[0], nRv: c.nRv, light: per[0] * c.nRv, heavy: per[1] * c.nRv, unknown: c.unknown, jitRv: 0.008 });
    }
    plan.push({ t: plan[plan.length - 1].t + 10, kind: 'busDone' });
    this.plan = plan;
    this.planAll = plan.filter(e => e.kind === 'release').map(e => ({ ...e }));
  },

  say(msg, kind = 'info') { const e = { t: this.t, msg, kind }; this.log.push(e); this.onLog && this.onLog(e); },
  setPhase(p) { this.phase = p; this.onPhase && this.onPhase(p); },
  emit(type, data = {}) {
    if (type in this.T && this.T[type] === null) this.T[type] = this.t;
    const e = { type, t: this.t, ...data }; this.events.push(e); this.onEvent && this.onEvent(e);
  },
  fxAdd(o, kind) { this.fx.push({ x: o.x, y: o.y, z: o.z, kind, rt: performance.now() }); },

  launch() {
    if (this.phase !== 'ready') return;
    this.missile = { type: 'missile', stage: 1, x: R_E, y: 0, z: 0, vx: 0, vy: 0, vz: 0, trail: [], tTrail: -1, h: 0, v: 0 };
    this.say('Ateşleme. Balistik füze rampadan kalktı.', 'phase');
    this.setPhase('boost');
    this.emit('launch');
  },

  spawn(type, src, jit) {
    const sig = type === 'unknown' ? UNKNOWN_SIG : SIG[type === 'bus' || type === 'stage1' ? 'debris' : type];
    const truth = {};
    for (const k in sig) truth[k] = sig[k][0] + sig[k][1] * gauss();
    if (type === 'bus') truth.lbeta = 2.9 + 0.1 * gauss();
    if (type === 'stage1') truth.lbeta = 3.0;
    truth.reg = clamp(truth.reg, 0.05, 0.99);
    truth.amp = Math.max(0.4, truth.amp);
    const v = Math.hypot(src.vx, src.vy) || 1, ux = src.vx / v, uy = src.vy / v;
    const da = jit * gauss(), dr = 0.6 * jit * gauss(), dz = 0.5 * jit * gauss();
    const o = {
      type, truth, beta: Math.pow(10, truth.lbeta),
      x: src.x, y: src.y, z: src.z || 0,
      vx: src.vx + ux * da - uy * dr, vy: src.vy + uy * da + ux * dr, vz: (src.vz || 0) + dz,
      alive: true, status: 'ucus', tracked: false, tid: null, tr: newTrack(), cls: null, score: 0, pred: null, predT: -9,
      assigned: null, trail: [], tTrail: -1, phase0: Math.random() * 6.283, nlp: 0, h: altOf(src), v: v, ad: 0, q: 0,
      born: this.t, seed: Math.random(),
    };
    this.objs.push(o);
    if (type === 'rv') this.stats.rv++;
    else if (type === 'unknown') this.stats.unk++;
    else if (type !== 'stage1') this.stats.decoys++;
    return o;
  },

  burnout() {
    const st = this.B.state;
    this.bus = this.spawn('bus', st, 0);
    this.bus.burnUntil = -1;
    this.bus.loaded = this.cfg.nRv;
    this.missile = null;
    const s2 = this.spawn('debris', st, 0.004);
    addAlong(s2, -0.015); s2.stage2 = true;
    const nf = { low: 1, mid: 2, high: 3 }[this.cfg.density];
    for (let i = 0; i < nf; i++) this.spawn('debris', st, 0.012);
    this.say(`Yanma sonu: ${this.B.hb} km irtifa, ${this.B.v.toFixed(2)} km/s. 2. kademe ayrıldı.`, 'phase');
    this.setPhase('bus');
    this.emit('burnout', { bus: this.bus, stage2: s2 });
  },

  runEvent(ev) {
    if (ev.kind === 'burn') this.bus.burnUntil = this.t + ev.dur;
    else if (ev.kind === 'fairing') { this.say('Burun koruyucusu atıldı: taşıyıcı ve harp başlıkları açığa çıktı.', 'info'); this.emit('fairing'); }
    else if (ev.kind === 'release') this.releaseGroup(ev);
    else if (ev.kind === 'busDone') {
      const n = this.objs.filter(o => o.alive && o.type !== 'stage1').length;
      this.say(`Konuşlanma tamamlandı. Orta evrede ${n} nesnelik tehdit kümesi.`, 'phase');
      this.setPhase('mid');
      this.emit('busDone', { n });
    }
  },

  releaseGroup(ev) {
    const bus = this.bus, sol = aimDv(bus, this.S + ev.aim.ds);
    addAlong(bus, sol.dv);
    bus.vz = (ev.aim.c - bus.z) / sol.t;
    const made = [];
    for (let i = 0; i < ev.nRv; i++) { const r = this.spawn('rv', bus, ev.jitRv); r.rvNo = this.stats.rv; r.aimName = ev.aim.name; made.push(r); }
    for (let i = 0; i < ev.light; i++) made.push(this.spawn('light', bus, 0.006));
    for (let i = 0; i < ev.heavy; i++) made.push(this.spawn('heavy', bus, 0.004));
    if (ev.unknown) made.push(this.spawn('unknown', bus, 0.004));
    const nd = ev.light + ev.heavy + (ev.unknown ? 1 : 0);
    this.relNo = (this.relNo || 0) + 1;
    if (this.cfg.mode === 'MIRV') this.say(`Taşıyıcı manevrası Δv ${Math.round(sol.dv * 1000)} m/s → ${this.relNo}. harp başlığı ${ev.aim.name} hedefine bırakıldı, yanında ${nd} sahte nesne.`, 'event');
    else this.say(`${ev.nRv} harp başlığı aynı hedef bölgesine (${ev.aim.name}) birlikte bırakıldı, yanında ${nd} sahte nesne.`, 'event');
    addAlong(bus, -0.003);
    bus.loaded = Math.max(0, bus.loaded - ev.nRv);
    this.emit('release', { aim: ev.aim, objs: made, no: this.relNo, dv: sol.dv, light: ev.light, heavy: ev.heavy, unknown: !!ev.unknown });
  },

  propagate(o, dt) {
    step(o, dt);
    o.h = altOf(o); o.v = speedOf(o);
    o.q = 0.5 * rho(o.h) * (o.v * 1000) ** 2;
    if (o.h <= 0) return this.endObj(o, 'yer');
    if (o.type === 'light' && o.q > 120) return this.endObj(o, 'ayiklandi');
    if ((o.type === 'debris' || o.type === 'bus') && o.q > 30000) return this.endObj(o, 'parcalandi');
  },

  nearestAsset(s, c) {
    let best = null, bd = Infinity;
    for (const a of this.assets) { const d = Math.hypot(s - a.s, c - a.c); if (d < bd) { bd = d; best = a; } }
    return { a: best, d: bd };
  },

  endObj(o, why) {
    o.alive = false; o.status = why; o.tEnd = this.t;
    o.finalLabel = o.cls ? o.cls.label : null; o.finalCls = o.cls;
    o.assigned = null;
    if (why === 'yer') {
      o.impact = { s: rangeOf(o), c: o.z };
      const na = this.nearestAsset(o.impact.s, o.impact.c);
      this.fxAdd(o, o.type === 'rv' || o.type === 'unknown' ? 'impact' : 'dust');
      if (o.type === 'rv') { this.stats.rvLeaked++; this.say(`${o.tid || 'Harp başlığı'} savunmayı aştı: ${na.a.name} bölgesine ${na.d.toFixed(1)} km mesafede yere ulaştı.`, 'bad'); this.emit('leak', { o }); }
      else if (o.type === 'unknown') { this.stats.unkLeaked++; this.say(`${o.tid} (bilinmeyen tip) ${na.a.name} yakınında yere ulaştı.`, 'warn'); this.emit('leak', { o }); }
      else if (o.tracked && o.type === 'heavy') this.say(`${o.tid} yere düştü (ağır sahte hedef, zararsız).`, 'muted');
    } else if (why === 'ayiklandi') {
      this.stats.filtered++; this.fxAdd(o, 'filter');
      if (o.tracked) this.say(`${o.tid} atmosferde parçalandı: hafif sahte hedef, atmosferik filtreleme.`, 'muted');
      this.emit('filter', { o });
    } else if (why === 'parcalandi') this.fxAdd(o, 'breakup');
  },

  visible(o) {
    const b = this.bat.pos, u = this.bat.up;
    const rx = o.x - b.x, ry = o.y - b.y, rz = o.z - b.z, d = Math.hypot(rx, ry, rz);
    return d < RADAR_RANGE && (rx * u.x + ry * u.y) / d > 0.017;
  },

  // 1 Hz: iz başlatma, öznitelik ölçümü, sınıflandırma, düşme noktası ve tehdit skoru
  sense() {
    let fresh = 0, first = { GERCEK: 0, SAHTE: 0, BILINMEYEN: 0 }, nFirst = 0;
    for (const o of this.objs) {
      if (!o.alive || o.type === 'stage1') continue;
      if (!o.tracked) {
        if (!this.visible(o)) continue;
        o.tracked = true; o.tid = 'H-' + String(this.nextTrack++).padStart(2, '0'); fresh++;
      }
      const tr = o.tr; tr.n++;
      for (const f of FEATS) tr.sum[f] += o.truth[f] + MEAS[f] * gauss();
      const prev = o.cls ? o.cls.label : 'IZLENIYOR';
      o.cls = classify(o);
      const lab = o.cls.label;
      if (prev === 'IZLENIYOR' && lab !== 'IZLENIYOR') { first[lab]++; nFirst++; }
      else if (prev !== lab && lab !== 'IZLENIYOR') {
        const c = o.cls, why = o.h < KARMAN ? ' (yavaşlama verisiyle)' : '';
        const txt = c.model === 'rule' ? `${LABEL_TR[lab]}, kural: ${c.why}` : lab === 'SAHTE' ? `SAHTE, ${SUB_TR[c.best]}` : lab === 'GERCEK' ? `GERÇEK, P=%${Math.round(c.p.rv * 100)}` : 'BİLİNMEYEN, Isolation Forest aykırı buldu';
        this.say(`${o.tid} yeniden sınıflandı → ${txt}${why}.`, lab === 'GERCEK' ? 'warn' : lab === 'BILINMEYEN' ? 'event' : 'info');
      }
      // düşme noktası 2 s'de bir yenilenir; izler iki gruba ayrılarak yük radar turlarına eşit dağıtılır (karelerde ani yük birikmez)
      if (!o.pred || this.t - o.predT >= 2) {
        const first = !o.pred;
        o.pred = predictImpact(o, betaGuess(o));
        o.predT = first ? this.t - (parseInt(o.tid.slice(2), 10) % 2) : this.t;
      }
      else o.pred.t = Math.max(0, o.pred.t - 1);
      o.score = threatScore(o, this.assets);
    }
    if (fresh) { this.say(`Radar ${fresh} yeni iz başlattı (toplam ${this.nextTrack - 1}).`, 'info'); this.emit('radar', { n: fresh }); }
    if (nFirst) { this.say(`İlk sınıflandırma: ${first.GERCEK} gerçek, ${first.SAHTE} sahte, ${first.BILINMEYEN} bilinmeyen.`, 'event'); this.emit('classified', first); }
  },

  // 4 Hz: RKA sinyali ve sürükleme ivmesi ölçümü
  fastSense() {
    for (const o of this.objs) {
      if (!o.alive || !o.tracked) continue;
      const tr = o.tr, T = o.truth, per = Math.pow(10, T.lper);
      o.nlp = 0.85 * o.nlp + 0.5 * gauss();
      // dönme/presesyon modülasyonu + Swerling türü istatistiksel dalgalanma
      // (kararlı nesneler 4, düzensiz nesneler 2 serbestlik dereceli ki-kare dağılımı)
      const dof = T.reg > 0.75 ? 4 : 2;
      let chi = 0; for (let k = 0; k < dof; k++) { const z = gauss(); chi += z * z; }
      const sig = T.rcs + T.amp * (T.reg * Math.sin(2 * Math.PI * this.t / per + o.phase0) + (1 - T.reg) * o.nlp)
        + 10 * Math.log10(Math.max(chi / dof, 1e-3));
      tr.hist.push(sig);
      if (tr.hist.length > 160) tr.hist.shift();
      if (o.q > 0.5) kfUpdate(tr.kf, o.q, o.q / o.beta * (1 + 0.05 * gauss()) + A_NOISE * gauss());
    }
  },

  engage() {
    const cands = this.objs
      .filter(o => o.alive && o.tracked && o.h < ENTRY && o.h > 6 && !o.assigned && o.score >= ENG_MIN)
      .sort((a, b) => b.score - a.score);
    for (const m of this.icpts) {
      const T = m.tgt;
      const dist = Math.hypot(T.x - m.x, T.y - m.y, T.z - m.z), tLeft = T.pred ? T.pred.t : 30;
      if (T.alive && m.age > 4 && (m.close < 0.3 || dist / m.close > tLeft + 3)) {   // yetişemez: hedefi bırak
        m.alive = false; T.assigned = null; this.fxAdd(m, 'selfd');
        this.say(`Önleyici-${m.id} ${T.tid} hedefine yetişemedi, kendini imha etti. Hedef yeniden kuyrukta.`, 'warn');
        continue;
      }
      if (T.alive && T.score >= ENG_MIN * 0.5) continue;
      const ni = m.age < 20 ? cands.findIndex(c => this.canTurnTo(m, c)) : -1;
      if (ni >= 0) {
        const nb = cands.splice(ni, 1)[0];
        if (T.alive) T.assigned = null;
        m.tgt = nb; nb.assigned = m;
        this.say(`Önleyici-${m.id} yeniden hedeflendi: ${T.tid} → ${nb.tid} (${T.alive ? 'tehdit skoru düştü' : 'hedef ortadan kalktı'}).`, 'event');
      } else if (!T.alive) {
        m.alive = false; this.fxAdd(m, 'selfd');
        this.say(`Önleyici-${m.id} hedefi kalmadığı için kendini imha etti.`, 'muted');
      }
    }
    this.icpts = this.icpts.filter(m => m.alive);
    for (const L of this.launchers) {
      if (!cands.length || this.inventory <= 0) break;
      if (L.ready > this.t || L.rounds <= 0) continue;
      this.fire(L, cands.shift());
      L.ready = this.t + 1.5;
    }
  },

  // yeniden hedefleme: burun ~70° içinde, yaklaşma hızı yeterli ve hedef yere inmeden yetişebiliyor
  canTurnTo(m, c) {
    const lx = c.x - m.x, ly = c.y - m.y, lz = c.z - m.z, l = Math.hypot(lx, ly, lz), v = Math.hypot(m.vx, m.vy, m.vz);
    const close = ICPT_V - (c.vx * lx + c.vy * ly + c.vz * lz) / l;
    return (lx * m.vx + ly * m.vy + lz * m.vz) / (l * v) > 0.34 && close > 2 && l / close < (c.pred ? c.pred.t : 30);
  },

  fire(L, T) {
    const b = this.bat, up = b.up;
    // fırlatma yönü: kaba öngörülen önleme noktası, en az ~40° yükselişle
    const d0 = Math.hypot(T.x - b.pos.x, T.y - b.pos.y, T.z - b.pos.z), tg = d0 / (ICPT_V + (T.v || 5));
    let dx = T.x + T.vx * tg - b.pos.x, dy = T.y + T.vy * tg - b.pos.y, dz = T.z + T.vz * tg - b.pos.z;
    let dn = Math.hypot(dx, dy, dz); dx /= dn; dy /= dn; dz /= dn;
    const el = dx * up.x + dy * up.y;
    if (el < 0.64) { const k = 0.64 - el; dx += up.x * k * 1.6; dy += up.y * k * 1.6; }
    dn = Math.hypot(dx, dy, dz); dx /= dn; dy /= dn; dz /= dn;
    const m = {
      id: this.nextIcpt++, x: b.pos.x + up.x * 0.009, y: b.pos.y + up.y * 0.009, z: b.pos.z + L.off,
      vx: dx * 0.3, vy: dy * 0.3, vz: dz * 0.3, age: 0, tgt: T, alive: true, trail: [], tTrail: -1, born: this.t, off: L.off,
    };
    T.assigned = m; this.icpts.push(m); this.inventory--; this.stats.shots++;
    L.rounds--; L.fired++; m.launcher = L.no;
    this.say(`Önleyici-${m.id} ${L.no}. fırlatıcıdan ateşlendi → ${T.tid} · skor ${T.score.toFixed(0)} · ${LABEL_TR[T.cls.label]} (P=%${Math.round(T.cls.p.rv * 100)}).`, 'fire');
    this.emit('fire', { m, T });
  },

  // Öncü takip güdümü, dönüş hızı sınırlı
  flyIcpt(m, dt) {
    const T = m.tgt; m.age += dt;
    const spd = m.age < 2 ? 0.3 + (ICPT_V - 0.3) * m.age / 2 : ICPT_V;
    const rx = T.x - m.x, ry = T.y - m.y, rz = T.z - m.z, d = Math.hypot(rx, ry, rz);
    const wx = T.vx - m.vx, wy = T.vy - m.vy, wz = T.vz - m.vz;
    const close = -(rx * wx + ry * wy + rz * wz) / d;
    m.close = close;
    const tgo = clamp(d / Math.max(close, 0.5), 0, 40);
    const tv = T.v || 1, ka = -0.5 * (T.ad || 0) / tv * tgo * tgo;
    let ax = rx + T.vx * tgo + T.vx * ka, ay = ry + T.vy * tgo + T.vy * ka, az = rz + T.vz * tgo + T.vz * ka;
    // hedef noktası yerin altına düşmesin
    const px = m.x + ax, py = m.y + ay, pr = Math.hypot(px, py);
    if (pr < R_E + 1) { const f = (R_E + 1) / pr; ax = px * f - m.x; ay = py * f - m.y; }
    const an = Math.hypot(ax, ay, az); ax /= an; ay /= an; az /= an;
    const v = Math.hypot(m.vx, m.vy, m.vz);
    let cx = m.vx / v, cy = m.vy / v, cz = m.vz / v;
    const ang = Math.acos(clamp(cx * ax + cy * ay + cz * az, -1, 1));
    const maxT = (m.age < 0.8 ? 0.25 : 0.7 / Math.max(spd, 0.7)) * dt;
    const s = Math.sin(ang);
    if (ang <= maxT || s < 1e-6) { cx = ax; cy = ay; cz = az; }
    else {
      const k = maxT / ang, wa = Math.sin((1 - k) * ang) / s, wb = Math.sin(k * ang) / s;
      cx = cx * wa + ax * wb; cy = cy * wa + ay * wb; cz = cz * wa + az * wb;
      const cn = Math.hypot(cx, cy, cz); cx /= cn; cy /= cn; cz /= cn;
    }
    m.vx = cx * spd; m.vy = cy * spd; m.vz = cz * spd;
    // adım boyunca en yakın geçiş (hedefin adım başındaki konumuna göre)
    const r0x = T.x - T.vx * dt - m.x, r0y = T.y - T.vy * dt - m.y, r0z = T.z - T.vz * dt - m.z;
    const dvx = T.vx - m.vx, dvy = T.vy - m.vy, dvz = T.vz - m.vz, dv2 = dvx * dvx + dvy * dvy + dvz * dvz;
    const tau = dv2 > 0 ? clamp(-(r0x * dvx + r0y * dvy + r0z * dvz) / dv2, 0, dt) : 0;
    const dmin = Math.hypot(r0x + dvx * tau, r0y + dvy * tau, r0z + dvz * tau);
    m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
    if (T.alive && dmin < KILL_R) return this.intercept(m, T);
    if (m.age > 50 || altOf(m) < -1) {
      m.alive = false; this.fxAdd(m, 'selfd');
      if (T.assigned === m) T.assigned = null;
      this.say(`Önleyici-${m.id} hedefe ulaşamadı, kendini imha etti.`, 'muted');
    }
  },

  intercept(m, T) {
    m.alive = false; T.assigned = null;
    if (Math.random() < PK) {
      this.fxAdd(T, 'kill');
      this.endObj(T, 'imha');
      if (T.type === 'rv') { this.stats.hitRv++; this.stats.rvKilled++; }
      else if (T.type === 'unknown') { this.stats.hitUnknown++; this.stats.unkKilled++; }
      else this.stats.hitDecoy++;
      this.say(`Önleyici-${m.id} ${T.tid} hedefini imha etti. Gerçek kimlik: ${TYPE_INFO[T.type].name}.`, T.type === 'rv' ? 'good' : T.type === 'unknown' ? 'event' : 'warn');
      this.emit('kill', { m, T });
    } else {
      this.stats.miss++; this.fxAdd(m, 'miss');
      this.say(`Önleyici-${m.id} ${T.tid} hedefini ıskaladı. Yeniden angajman bekleniyor.`, 'warn');
      this.emit('miss', { m, T });
    }
  },

  addTrail(o, every) {
    if (this.t - o.tTrail >= every && o.trail.length < 3500) { o.trail.push({ x: o.x, y: o.y, z: o.z }); o.tTrail = this.t; }
  },

  tick(dt) {
    this.t += dt;
    const t = this.t;
    if (this.phase === 'boost') {
      const M = this.missile, tt = Math.min(t, TB), t0 = Math.max(tt - 0.5, 0);
      const p = boostAt(this.B, tt), q = boostAt(this.B, t0), span = Math.max(tt - t0, 1e-3);
      M.vx = (p.x - q.x) / span; M.vy = (p.y - q.y) / span; M.vz = 0;
      M.x = p.x; M.y = p.y; M.h = altOf(M); M.v = speedOf(M);
      this.addTrail(M, 0.5);
      if (!this.exoLogged && M.h > KARMAN) { this.exoLogged = true; this.say('Füze 100 km Kármán hattını geçti: atmosfer dışına çıktı.', 'phase'); this.emit('karman'); }
      if (!this.stage1Done && t >= 0.42 * TB) {
        this.stage1Done = true;
        const s1 = this.spawn('stage1', M, 0.01); addAlong(s1, -0.05);
        M.stage = 2;
        this.say('1. kademe ayrıldı, 2. kademe ateşlendi.', 'info');
        this.emit('stage1', { o: s1 });
      }
      if (t >= TB) this.burnout();
    }
    while (this.plan.length && this.bus && this.plan[0].t <= t) this.runEvent(this.plan.shift());
    if (this.bus && this.T.apogee === null && this.T.burnout !== null && (this.bus.x * this.bus.vx + this.bus.y * this.bus.vy) < 0) {
      this.say(`Apoje: tehdit kümesi en yüksek noktada (~${Math.round(this.bus.h)} km) ve alçalmaya başladı.`, 'phase');
      this.emit('apogee');
    }
    for (const o of this.objs) if (o.alive) { this.propagate(o, dt); if (o.alive) this.addTrail(o, o.h < 140 ? 0.25 : 1); }
    for (const m of this.icpts) if (m.alive) { this.flyIcpt(m, dt); if (m.alive) this.addTrail(m, 0.1); }
    this.icpts = this.icpts.filter(m => m.alive);
    this.acc.fast += dt;
    if (this.acc.fast >= 0.25) { this.acc.fast -= 0.25; this.fastSense(); this.updateHot(); }
    this.acc.meas += dt;
    if (this.acc.meas >= RADAR_DT) {        // radar turu: ölçüm, sınıflandırma, tehdit skoru ve yeniden önceliklendirme
      this.acc.meas -= RADAR_DT;
      const t0 = performance.now();
      this.sense(); this.engage();
      if (this.phase === 'terminal') { const ms = performance.now() - t0, R = this.rounds; R.n++; R.sum += ms; R.max = Math.max(R.max, ms); }
    }
    this.checkPhase();
  },

  updateHot() {
    this.hot = this.icpts.length > 0 || this.objs.some(o => o.alive && o.tracked && o.h < 150 && o.h > 1 &&
      (o.x * o.vx + o.y * o.vy) < 0 && o.score >= ENG_MIN * 0.6);
  },

  checkPhase() {
    if ((this.phase === 'mid' || this.phase === 'bus') &&
        this.objs.some(o => o.alive && o.type !== 'stage1' && o.h < ENTRY && (o.x * o.vx + o.y * o.vy) < 0)) {
      this.say('Tehdit kümesi atmosfere giriş arayüzünü (120 km) geçti. Hava savunma sistemi angajman modunda.', 'phase');
      this.setPhase('terminal');
      this.emit('entry');
    }
    if (this.phase === 'terminal' && !this.icpts.length && !this.objs.some(o => o.alive && o.type !== 'stage1')) this.finish();
  },

  finish() {
    const row = () => ({ GERCEK: 0, SAHTE: 0, BILINMEYEN: 0, IZLENIYOR: 0 });
    const conf = { GERCEK: row(), SAHTE: row(), BILINMEYEN: row() };
    const cmp = { ml: { rv: 0, rvHit: 0, fa: 0, unk: 0, unkHit: 0 }, rule: { rv: 0, rvHit: 0, fa: 0, unk: 0, unkHit: 0 } };
    for (const o of this.objs) {
      if (!o.tid) continue;
      conf[TYPE_INFO[o.type].group][o.finalLabel || 'IZLENIYOR']++;
      const c = o.finalCls || o.cls; if (!c || c.label === 'IZLENIYOR') continue;
      for (const [k, lab] of [['ml', c.mlLabel], ['rule', c.ruleLabel]]) {
        const st = cmp[k];
        if (o.type === 'rv') { st.rv++; if (lab === 'GERCEK') st.rvHit++; }
        else if (o.type === 'unknown') { st.unk++; if (lab === 'BILINMEYEN' || lab === 'GERCEK') st.unkHit++; }
        else if (lab === 'GERCEK') st.fa++;
      }
    }
    this.stats.conf = conf; this.stats.cmp = cmp;
    this.say('Senaryo tamamlandı.', 'phase');
    this.setPhase('done');
    this.emit('done');
  },

  // stop() true dönerse adım sınırında durur ve true döndürür
  update(dtSim, stop) {
    if (this.phase === 'ready' || this.phase === 'done') return false;
    let left = Math.min(dtSim, 30), guard = 0;
    while (left > 1e-9 && guard++ < 800) {
      const fine = this.phase === 'boost' || this.icpts.length > 0 || this.objs.some(o => o.alive && o.type !== 'stage1' && o.h < 130);
      const dt = Math.min(left, fine ? 0.05 : 0.25);
      this.tick(dt); left -= dt;
      if (this.phase === 'done') return true;
      if (stop && stop()) return true;
    }
    return false;
  },

  focus() {
    if (this.missile) return this.missile;
    if (this.phase === 'terminal' || this.phase === 'done') {
      let best = null;
      for (const o of this.objs) if (o.alive && o.tracked && (!best || o.score > best.score)) best = o;
      if (best) return best;
    }
    if (this.bus && this.bus.alive) return this.bus;
    return this.objs.find(o => o.alive && o.type !== 'stage1') || null;
  },
};
