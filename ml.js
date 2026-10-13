'use strict';
/* =================================================================
   ml.js — Raporun sınıflandırma katmanı (eğitim amaçlı, basitleştirilmiş)
   · Gradyan artırmalı karar ağaçları (LightGBM ile aynı yöntem ailesi), çok sınıflı
   · İzotonik regresyonla olasılık kalibrasyonu (gerçek başlık olasılığı)
   · Isolation Forest ile eğitimde görülmemiş nesnelerin tespiti
   · Karar eşiği: doğrulamadaki gerçek başlıkların %95'ini yakalayacak şekilde
   · Kural tabanlı kıyas modeli: β ve RKA eşikleri
   Model, sayfa açılışında sim.js'teki sınıf imzalarından üretilen sentetik izlerle
   tarayıcıda eğitilir (eğitim / doğrulama / test ayrı kümeler).
   ================================================================= */
const ML = (() => {
  let seed = 20261113;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const gn = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  const SIGF = ['rcs', 'lper', 'amp', 'reg', 'lcool'];
  const NF = 9, K = CLASSES.length;

  // öznitelikler: 5 imza ortalaması, log(ölçüm sayısı), β verisi var mı, log(1/β kestirimi), log(belirsizlik)
  function feat(m, n, e) {
    return [m.rcs, m.lper, m.amp, m.reg, m.lcool, Math.log10(n),
      e ? 1 : 0, e ? Math.log10(clamp(e.bh, 1e-6, 10)) : -7, e ? Math.log10(e.sb) : 1];
  }

  // simülatörle aynı imza dağılımından sentetik iz
  function sample(c) {
    const sig = c === 'unknown' ? UNKNOWN_SIG : SIG[c], t = {};
    for (const k in sig) t[k] = sig[k][0] + sig[k][1] * gn();
    t.reg = clamp(t.reg, 0.05, 0.99); t.amp = Math.max(0.4, t.amp);
    const n = 4 + Math.floor(rnd() * 60), m = {};
    for (const f of SIGF) m[f] = t[f] + MEAS[f] * gn() / Math.sqrt(n);
    let e = null;
    if (rnd() < 0.55) { const sb = Math.pow(10, -6.5 + 6.5 * rnd()); e = { bh: Math.pow(10, -t.lbeta) + sb * gn(), sb }; e.sig = e.bh > 3 * e.sb; }
    return { x: feat(m, n, e), c, m, n, e };
  }
  function dataset(N) {
    const out = [], pr = CLASSES.map(c => PRIOR[c]);
    for (let i = 0; i < N; i++) {
      let u = rnd(), k = 0; while (k < K - 1 && u > pr[k]) { u -= pr[k]; k++; }
      out.push(sample(CLASSES[k]));
    }
    return out;
  }

  /* ---------- gradyan artırmalı karar ağaçları (histogram tabanlı, softmax) ---------- */
  const GB = { rounds: 40, depth: 3, lr: 0.25, lambda: 1, minH: 2, bins: 32 };
  let cuts, trees, base;
  function binOf(f, v) { const c = cuts[f]; let lo = 0, hi = c.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (v > c[mid]) lo = mid + 1; else hi = mid; } return lo; }
  function buildTree(B, g, h, idx, depth) {
    let G = 0, H = 0; for (const i of idx) { G += g[i]; H += h[i]; }
    const leaf = { v: -G / (H + GB.lambda) * GB.lr };
    if (depth >= GB.depth || idx.length < 8) return leaf;
    let best = null;
    for (let f = 0; f < NF; f++) {
      const nb = cuts[f].length + 1, hg = new Float64Array(nb), hh = new Float64Array(nb);
      for (const i of idx) { const b = B[i * NF + f]; hg[b] += g[i]; hh[b] += h[i]; }
      let gl = 0, hl = 0;
      for (let b = 0; b < nb - 1; b++) {
        gl += hg[b]; hl += hh[b];
        const gr = G - gl, hr = H - hl;
        if (hl < GB.minH || hr < GB.minH) continue;
        const gain = gl * gl / (hl + GB.lambda) + gr * gr / (hr + GB.lambda) - G * G / (H + GB.lambda);
        if (!best || gain > best.gain) best = { gain, f, b };
      }
    }
    if (!best || best.gain <= 1e-6) return leaf;
    const L = [], R = [];
    for (const i of idx) (B[i * NF + best.f] <= best.b ? L : R).push(i);
    return { f: best.f, thr: cuts[best.f][best.b], l: buildTree(B, g, h, L, depth + 1), r: buildTree(B, g, h, R, depth + 1) };
  }
  const evalTree = (t, x) => { while (t.l) t = x[t.f] <= t.thr ? t.l : t.r; return t.v; };
  function raw(x) {
    const s = base.slice();
    for (const round of trees) for (let k = 0; k < K; k++) s[k] += evalTree(round[k], x);
    return s;
  }
  function softmax(s) { const mx = Math.max(...s), e = s.map(v => Math.exp(v - mx)), z = e.reduce((a, b) => a + b, 0); return e.map(v => v / z); }
  function trainGB(D) {
    const N = D.length;
    cuts = [];
    for (let f = 0; f < NF; f++) {
      const v = D.map(d => d.x[f]).sort((a, b) => a - b), c = [];
      for (let q = 1; q < GB.bins; q++) { const t = v[Math.floor(q * N / GB.bins)]; if (!c.length || t > c[c.length - 1]) c.push(t); }
      cuts.push(c);
    }
    const B = new Uint8Array(N * NF);
    D.forEach((d, i) => { for (let f = 0; f < NF; f++) B[i * NF + f] = binOf(f, d.x[f]); });
    base = CLASSES.map(c => Math.log(PRIOR[c]));
    const F = D.map(() => base.slice()), y = D.map(d => CLASSES.indexOf(d.c)), idx = D.map((_, i) => i);
    trees = [];
    for (let m = 0; m < GB.rounds; m++) {
      const P = F.map(softmax), round = [];
      for (let k = 0; k < K; k++) {
        const g = new Float64Array(N), h = new Float64Array(N);
        for (let i = 0; i < N; i++) { const p = P[i][k]; g[i] = p - (y[i] === k ? 1 : 0); h[i] = Math.max(p * (1 - p), 1e-6); }
        const t = buildTree(B, g, h, idx, 0); round.push(t);
        for (let i = 0; i < N; i++) F[i][k] += evalTree(t, D[i].x);
      }
      trees.push(round);
    }
  }

  /* ---------- izotonik regresyon (PAV) ---------- */
  let iso;
  function fitIso(ps, ys) {
    const o = ps.map((p, i) => [p, ys[i]]).sort((a, b) => a[0] - b[0]), blk = [];
    for (const [p, y] of o) {
      blk.push({ x: p, s: y, w: 1 });
      while (blk.length > 1 && blk[blk.length - 2].s / blk[blk.length - 2].w > blk[blk.length - 1].s / blk[blk.length - 1].w) {
        const b = blk.pop(), a = blk[blk.length - 1]; a.x = (a.x * a.w + b.x * b.w) / (a.w + b.w); a.s += b.s; a.w += b.w;
      }
    }
    iso = { x: blk.map(b => b.x), y: blk.map(b => b.s / b.w) };
  }
  function calib(p) {
    const X = iso.x, Y = iso.y;
    if (p <= X[0]) return Y[0];
    if (p >= X[X.length - 1]) return Y[Y.length - 1];
    let lo = 0, hi = X.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (X[mid] <= p) lo = mid; else hi = mid; }
    const u = (p - X[lo]) / (X[hi] - X[lo] || 1);
    return Y[lo] + u * (Y[hi] - Y[lo]);
  }

  /* ---------- Isolation Forest (imza öznitelikleri) ---------- */
  const IF = { trees: 100, psi: 256 };
  let forest, cpsi;
  const cOf = n => n <= 1 ? 0 : 2 * (Math.log(n - 1) + 0.5772156649) - 2 * (n - 1) / n;
  function iTree(X, d, lim) {
    if (d >= lim || X.length <= 1) return { size: X.length };
    const f = Math.floor(rnd() * 5);
    let lo = Infinity, hi = -Infinity; for (const x of X) { if (x[f] < lo) lo = x[f]; if (x[f] > hi) hi = x[f]; }
    if (hi - lo < 1e-9) return { size: X.length };
    const s = lo + rnd() * (hi - lo);
    return { f, s, l: iTree(X.filter(x => x[f] < s), d + 1, lim), r: iTree(X.filter(x => x[f] >= s), d + 1, lim) };
  }
  function pathLen(t, x, d) { while (t.l) { t = x[t.f] < t.s ? t.l : t.r; d++; } return d + cOf(t.size); }
  function isoScore(x) { let s = 0; for (const t of forest) s += pathLen(t, x, 0); return Math.pow(2, -(s / forest.length) / cpsi); }
  function trainIF(D) {
    const X = D.map(d => d.x.slice(0, 5)), lim = Math.ceil(Math.log2(IF.psi));
    forest = []; cpsi = cOf(IF.psi);
    for (let t = 0; t < IF.trees; t++) { const sub = []; for (let i = 0; i < IF.psi; i++) sub.push(X[Math.floor(rnd() * X.length)]); forest.push(iTree(sub, 0, lim)); }
  }

  /* ---------- eğitim, kalibrasyon, eşikler ve doğrulama ---------- */
  const info = {};
  const quant = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[clamp(Math.floor(q * s.length), 0, s.length - 1)]; };
  const pRv = x => softmax(raw(x))[0];
  function ece(ps, ys) {
    let e = 0; const nb = 10;
    for (let b = 0; b < nb; b++) {
      const ii = ps.map((p, i) => i).filter(i => ps[i] >= b / nb && (ps[i] < (b + 1) / nb || b === nb - 1));
      if (!ii.length) continue;
      const conf = ii.reduce((a, i) => a + ps[i], 0) / ii.length, acc = ii.reduce((a, i) => a + ys[i], 0) / ii.length;
      e += ii.length / ps.length * Math.abs(conf - acc);
    }
    return e;
  }
  function auroc(neg, pos) { let s = 0; for (const p of pos) for (const q of neg) s += p > q ? 1 : p === q ? 0.5 : 0; return s / (pos.length * neg.length); }
  function train() {
    const t0 = performance.now();
    const tr = dataset(3000), va = dataset(4000), te = dataset(3000);
    trainGB(tr);
    const pv = va.map(d => pRv(d.x)), yv = va.map(d => d.c === 'rv' ? 1 : 0);
    fitIso(pv, yv);
    info.tau = quant(va.filter(d => d.c === 'rv').map((d, i) => calib(pRv(d.x))), 0.05);
    trainIF(tr);
    info.isoThr = quant(va.filter(d => d.n >= 6).map(d => isoScore(d.x.slice(0, 5))), 0.98);
    // kural tabanlı kıyas: eşikler eğitim verisinden, gerçek başlıkların %95'ini kapsayacak şekilde
    info.thrB = quant(tr.filter(d => d.c === 'rv' && d.e && d.e.sig).map(d => -Math.log10(d.e.bh)), 0.05);
    info.thrR = quant(tr.filter(d => d.c === 'rv').map(d => d.m.rcs), 0.95);
    // ayrı test kümesinde ölçütler
    const pt = te.map(d => pRv(d.x)), yt = te.map(d => d.c === 'rv' ? 1 : 0), ct = pt.map(calib);
    const rvIdx = yt.map((y, i) => i).filter(i => yt[i]);
    info.recall = rvIdx.filter(i => ct[i] >= info.tau).length / rvIdx.length;
    info.recallRule = rvIdx.filter(i => rule(te[i].m, te[i].e).label === 'GERCEK').length / rvIdx.length;
    info.eceRaw = ece(pt, yt); info.eceCal = ece(ct, yt);
    const unk = []; for (let i = 0; i < 300; i++) { const d = sample('unknown'); if (d.n >= 6) unk.push(isoScore(d.x.slice(0, 5))); }
    info.aurocUnk = auroc(te.filter(d => d.n >= 6).slice(0, 400).map(d => isoScore(d.x.slice(0, 5))), unk);
    info.ms = performance.now() - t0;
    info.n = { train: tr.length, val: va.length, test: te.length };
  }

  /* ---------- tahmin ---------- */
  function means(tr) { const n = Math.max(tr.n, 1), m = {}; for (const f of SIGF) m[f] = tr.sum[f] / n; return m; }
  function rule(m, e) {
    let label, why;
    if (e && e.sig) { const lb = -Math.log10(e.bh); label = lb >= info.thrB ? 'GERCEK' : 'SAHTE'; why = `β ${label === 'GERCEK' ? '≥' : '<'} ${fmtB(info.thrB)}`; }
    else { label = m.rcs <= info.thrR ? 'GERCEK' : 'SAHTE'; why = `RKA ${label === 'GERCEK' ? '≤' : '>'} ${info.thrR.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} dBsm`; }
    return { label, why };
  }
  const fmtB = lb => Math.round(Math.pow(10, lb)).toLocaleString('tr-TR');
  function predict(tr, e) {
    const m = means(tr), x = feat(m, tr.n, e), p0 = softmax(raw(x)), cr = calib(p0[0]);
    const rest = 1 - p0[0], p = { rv: cr };
    CLASSES.slice(1).forEach((c, k) => { p[c] = rest > 1e-9 ? p0[k + 1] / rest * (1 - cr) : (1 - cr) / 3; });
    let best = 'rv'; for (const c of CLASSES) if (p[c] > p[best]) best = c;
    const s = isoScore(x.slice(0, 5));
    const unknown = tr.n >= 6 && s > info.isoThr;
    return { p, best, iso: s, label: unknown ? 'BILINMEYEN' : cr >= info.tau ? 'GERCEK' : 'SAHTE', rule: rule(m, e) };
  }

  train();
  return { predict, rule, means, info, GB, IF };
})();
