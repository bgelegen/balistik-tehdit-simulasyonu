'use strict';
/* view2d.js — 2B yan kesit görünümü (menzil–irtifa, Dünya eğriliği gerçek ölçekte) */
const View2D = (() => {
  let cv, ctx, W = 1, H = 1, dpr = 1, stars = [], mode = 'auto', autoMode = 'full', segCache = null;
  const cam = { cx: R_E, cy: 0, ang: 0, scale: 0.1, init: false };
  let rc = 0, rs = 1;   // kare başına dönüş katsayıları

  function init(canvas) {
    cv = canvas; ctx = cv.getContext('2d');
    stars = Array.from({ length: 240 }, () => [Math.random(), Math.random(), Math.random()]);
    new ResizeObserver(resize).observe(cv.parentElement);
    resize();
  }
  function resize() {
    const r = cv.parentElement.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  function setMode(m) { mode = m; }
  function setAuto(m) { autoMode = m; }

  function w2s(x, y) {
    const dx = x - cam.cx, dy = y - cam.cy;
    // x aynalanır: uçuş soldan sağa akar
    return [W / 2 - (dx * rc - dy * rs) * cam.scale, H / 2 - (dx * rs + dy * rc) * cam.scale];
  }
  function s2w(sx, sy) {
    const rx = -(sx - W / 2) / cam.scale, ry = -(sy - H / 2) / cam.scale;
    return [cam.cx + rx * rc + ry * rs, cam.cy - rx * rs + ry * rc];
  }
  function pol(s, h) { const th = s / R_E, r = R_E + h; return [r * Math.cos(th), r * Math.sin(th)]; }

  function fit(s0, s1, h0, h1) {
    const ang = (s0 + s1) / 2 / R_E, a = Math.PI / 2 - ang, ca = Math.cos(a), sa = Math.sin(a);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of [s0, (s0 + s1) / 2, s1]) for (const h of [h0, h1]) {
      const [x, y] = pol(s, h), rx = x * ca - y * sa, ry = x * sa + y * ca;
      x0 = Math.min(x0, rx); x1 = Math.max(x1, rx); y0 = Math.min(y0, ry); y1 = Math.max(y1, ry);
    }
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    return { cx: mx * ca + my * sa, cy: -mx * sa + my * ca, ang, scale: Math.min(W * 0.92 / (x1 - x0), H * 0.8 / (y1 - y0)) };
  }
  function roi(sim) {
    let m = mode;
    if (m === 'auto') m = autoMode;
    if (m === 'launch') return fit(-120, 720, 0, 360);
    if (m === 'defense') return fit(sim.S - 230, sim.S + 120, 0, 130);
    return fit(-250, sim.S + 250, 0, Math.max(300, sim.apogee * 1.12));
  }
  function updateCam(sim, dtR) {
    const g = roi(sim);
    if (!cam.init) { Object.assign(cam, g); cam.init = true; }
    else {
      const k = 1 - Math.exp(-dtR * 2.4);
      cam.cx += (g.cx - cam.cx) * k; cam.cy += (g.cy - cam.cy) * k; cam.ang += (g.ang - cam.ang) * k;
      cam.scale = Math.exp(Math.log(cam.scale) + (Math.log(g.scale) - Math.log(cam.scale)) * k);
    }
    const a = Math.PI / 2 - cam.ang; rc = Math.cos(a); rs = Math.sin(a);
  }

  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(r, 0), 0, Math.PI * 2); }
  function onScreen(x, y, m = 40) { return x > -m && x < W + m && y > -m && y < H + m; }
  function label(txt, x, y, col, align = 'left') {
    ctx.font = '500 11px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = align; ctx.fillStyle = col; ctx.fillText(txt, x, y);
  }
  function glow(x, y, r, col, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col.replace('A', a)); g.addColorStop(1, col.replace('A', 0));
    ctx.fillStyle = g; circle(x, y, r); ctx.fill();
  }
  function polyline(pts, tail, maxN) {
    const n = pts.length, i0 = Math.max(0, n - maxN);
    ctx.beginPath();
    let started = false;
    for (let i = i0; i < n; i++) { const [x, y] = w2s(pts[i].x, pts[i].y); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); }
    if (tail) { const [x, y] = w2s(tail.x, tail.y); started ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  }
  function niceStep(px) {
    const raw = px / cam.scale, p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
    return 10 * p;
  }

  function draw(sim, opt, dtR) {
    updateCam(sim, dtR);
    const now = performance.now(), sc = cam.scale;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // uzay ve yıldızlar
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#02050a'); bg.addColorStop(1, '#081626');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#d6e6ff';
    for (const [x, y, b] of stars) { ctx.globalAlpha = 0.12 + b * 0.5; const s = b > 0.85 ? 1.6 : 1; ctx.fillRect(x * W, y * H, s, s); }
    ctx.globalAlpha = 1;

    // atmosfer katmanları
    const [ex, ey] = w2s(0, 0), Rpx = R_E * sc;
    const atm = ctx.createRadialGradient(ex, ey, Rpx, ex, ey, (R_E + 140) * sc);
    atm.addColorStop(0, 'rgba(130,195,255,0.6)'); atm.addColorStop(0.09, 'rgba(75,150,240,0.34)');
    atm.addColorStop(0.36, 'rgba(45,105,210,0.14)'); atm.addColorStop(0.72, 'rgba(30,70,170,0.05)'); atm.addColorStop(1, 'rgba(20,40,120,0)');
    ctx.fillStyle = atm; circle(ex, ey, (R_E + 140) * sc); ctx.fill();

    // yer
    const gr = ctx.createRadialGradient(ex, ey, Math.max(0, Rpx - 90), ex, ey, Rpx);
    gr.addColorStop(0, '#070d0b'); gr.addColorStop(1, '#18261f');
    ctx.fillStyle = gr; circle(ex, ey, Rpx); ctx.fill();
    ctx.strokeStyle = 'rgba(160,215,255,0.6)'; ctx.lineWidth = 1.2; circle(ex, ey, Rpx); ctx.stroke();

    // katman çizgileri ve etiketleri
    const [lx, ly] = s2w(14, H * 0.5), thL = Math.atan2(ly, lx);
    let lastY = Infinity;
    for (const [h, name] of [[ENTRY, 'GİRİŞ ARAYÜZÜ · 120 km · angajman'], [KARMAN, 'KÁRMÁN HATTI · 100 km'], [85, 'Mezosfer'], [50, 'Stratosfer'], [12, 'Troposfer']]) {
      const isK = h === KARMAN, isE = h === ENTRY;
      ctx.setLineDash(isK ? [7, 6] : isE ? [2, 4] : [2, 7]);
      ctx.strokeStyle = isK ? 'rgba(233,162,59,0.75)' : isE ? 'rgba(70,200,216,0.5)' : 'rgba(150,190,230,0.22)';
      ctx.lineWidth = 1; circle(ex, ey, (R_E + h) * sc); ctx.stroke();
      const [px, py] = w2s((R_E + h) * Math.cos(thL), (R_E + h) * Math.sin(thL));
      if (py > 16 && py < H - 8 && Math.abs(py - lastY) > 14) { label(name, 14, py - 5, isK ? 'rgba(233,162,59,0.95)' : isE ? 'rgba(110,210,225,0.85)' : 'rgba(170,200,230,0.55)'); lastY = py; }
    }
    ctx.setLineDash([]);

    // irtifa cetveli (sağ kenar)
    const st = niceStep(70), [rx, ry] = s2w(W - 10, H * 0.5), thR = Math.atan2(ry, rx);
    for (let h = st; h < 5000; h += st) {
      const [px, py] = w2s((R_E + h) * Math.cos(thR), (R_E + h) * Math.sin(thR));
      if (py < 12) break;
      if (py > H) continue;
      ctx.strokeStyle = 'rgba(170,200,230,0.35)'; ctx.beginPath(); ctx.moveTo(W - 8, py); ctx.lineTo(W - 2, py); ctx.stroke();
      label(h + ' km', W - 12, py + 4, 'rgba(170,200,230,0.55)', 'right');
    }

    // nominal yörünge: evrelere göre renklenmiş yol
    drawSegments(sim);

    // fırlatma sahası ve korunan varlıklar
    const [lsx, lsy] = w2s(R_E, 0);
    if (onScreen(lsx, lsy)) {
      ctx.fillStyle = '#ff8a5c'; ctx.beginPath(); ctx.moveTo(lsx, lsy - 8); ctx.lineTo(lsx - 5, lsy); ctx.lineTo(lsx + 5, lsy); ctx.fill();
      label('FIRLATMA SAHASI', lsx, lsy + 16, 'rgba(255,170,130,0.9)', 'center');
    }
    for (const a of sim.assets) {
      const [x, y] = pol(a.s, 0), [px, py] = w2s(x, y);
      if (!onScreen(px, py)) continue;
      ctx.fillStyle = a.kind === 'bat' ? '#46c8d8' : '#e9a23b';
      ctx.beginPath(); ctx.moveTo(px, py - 6); ctx.lineTo(px + 4, py - 2); ctx.lineTo(px, py + 2); ctx.lineTo(px - 4, py - 2); ctx.fill();
      if (sc > 0.6) label(a.name, px, py + 15, a.kind === 'bat' ? 'rgba(120,220,235,0.95)' : 'rgba(240,190,110,0.9)', 'center');
    }

    // batarya: radar taraması ve önleyici zarfı
    const bp = sim.bat.pos, [bx, by] = w2s(bp.x, bp.y);
    if (sc > 0.25 && onScreen(bx, by, 400)) {
      ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(70,200,216,0.28)';
      ctx.beginPath(); ctx.arc(bx, by, 120 * sc, Math.PI, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      label('ÖNLEYİCİ ZARFI ~120 km', bx - 120 * sc * 0.72, by - 120 * sc * 0.72 - 6, 'rgba(110,210,225,0.55)', 'center');
      const sw = Math.PI + 0.12 + (0.5 + 0.5 * Math.sin(now / 900)) * 1.35, len = 260 * sc;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, len);
      g.addColorStop(0, 'rgba(70,200,216,0.22)'); g.addColorStop(1, 'rgba(70,200,216,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(bx, by); ctx.arc(bx, by, len, sw - 0.05, sw + 0.05); ctx.closePath(); ctx.fill();
    }

    // radar hatları (atmosferdeki izler)
    if (sim.phase === 'terminal') {
      ctx.strokeStyle = 'rgba(70,200,216,0.12)'; ctx.lineWidth = 1;
      for (const o of sim.objs) if (o.alive && o.tracked && o.h < KARMAN + 30) {
        const [px, py] = w2s(o.x, o.y); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(px, py); ctx.stroke();
      }
    }

    // füze (itki evresi)
    const M = sim.missile;
    if (M) {
      ctx.strokeStyle = 'rgba(230,225,215,0.28)'; ctx.lineWidth = 5; polyline(M.trail, M, 400); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,190,120,0.75)'; ctx.lineWidth = 1.6; polyline(M.trail.slice(-16), M, 400); ctx.stroke();
      flame(M, 22, 4);
    }

    // nesneler
    for (const o of sim.objs) {
      const col = opt.col(o), fade = o.alive ? 1 : Math.max(0, 1 - (sim.t - o.tEnd) / 40);
      if (o.type === 'stage1' && !o.alive) continue;
      if (fade > 0) {
        ctx.globalAlpha = (o.alive ? 0.5 : 0.25) * fade; ctx.strokeStyle = col; ctx.lineWidth = o === opt.selected ? 2 : 1;
        polyline(o.trail, o.alive ? o : null, 900); ctx.stroke(); ctx.globalAlpha = 1;
      }
      if (!o.alive) {
        if (o.status === 'yer' && (o.type === 'rv' || o.type === 'unknown')) {
          const [x, y] = pol(o.impact.s, 0), [px, py] = w2s(x, y);
          ctx.strokeStyle = COL.GERCEK; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(px - 5, py - 5); ctx.lineTo(px + 5, py + 5); ctx.moveTo(px + 5, py - 5); ctx.lineTo(px - 5, py + 5); ctx.stroke();
        }
        continue;
      }
      const [px, py] = w2s(o.x, o.y);
      if (!onScreen(px, py)) continue;
      if (o.ad > 0.01 && o.v > 1.2) {   // yeniden giriş ısınması
        const r = 4 + Math.min(14, o.ad * 300);
        glow(px, py, r * 1.8, 'rgba(255,150,60,A)', 0.55);
        const [tx, ty] = w2s(o.x - o.vx * 2.5, o.y - o.vy * 2.5);
        const lg = ctx.createLinearGradient(px, py, tx, ty);
        lg.addColorStop(0, 'rgba(255,190,110,0.85)'); lg.addColorStop(1, 'rgba(255,90,30,0)');
        ctx.strokeStyle = lg; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty); ctx.stroke();
      }
      if (o.type === 'bus' && o.burnUntil > sim.t) flame(o, 12, 2.4);
      const big = o.type === 'rv' || o.type === 'unknown' || o.type === 'bus';
      glow(px, py, big ? 9 : 6, hexA(col), 0.45);
      ctx.fillStyle = col; circle(px, py, big ? 2.6 : 1.9); ctx.fill();
      if (o === opt.selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; circle(px, py, 9); ctx.stroke(); }
      if (o.tid && (sc > 0.6 || o === opt.selected)) label(o.tid, px + 8, py - 6, col);
      const rk = opt.ranks && opt.ranks.get(o);
      if (rk && sc > 0.25) {
        ctx.fillStyle = '#e9a23b'; circle(px - 9, py - 9, 7.5); ctx.fill();
        ctx.font = '700 10px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#1a1206'; ctx.fillText(rk, px - 9, py - 5.5); ctx.textAlign = 'left';
      }
    }

    // önleyiciler
    for (const m of sim.icpts) {
      ctx.strokeStyle = 'rgba(235,245,255,0.55)'; ctx.lineWidth = 2; polyline(m.trail, m, 600); ctx.stroke();
      const [px, py] = w2s(m.x, m.y);
      glow(px, py, 8, 'rgba(255,240,210,A)', 0.8);
      ctx.fillStyle = '#ffffff'; circle(px, py, 1.8); ctx.fill();
      if (sc > 0.6) label('Ö-' + m.id, px + 7, py + 12, 'rgba(235,245,255,0.8)');
    }

    // efektler
    for (const f of sim.fx) {
      const age = (now - f.rt) / 1000;
      if (age > 2.4) continue;
      const [px, py] = w2s(f.x, f.y), k = 1 - age / 2.4;
      if (f.kind === 'kill') {
        if (age < 0.5) glow(px, py, 40 * (1 - age), 'rgba(255,240,200,A)', 0.95);
        ctx.strokeStyle = `rgba(255,205,120,${k})`; ctx.lineWidth = 2; circle(px, py, 6 + age * 38); ctx.stroke();
      } else if (f.kind === 'impact') {
        glow(px, py, 30 + age * 20, 'rgba(255,90,70,A)', 0.7 * k);
        ctx.strokeStyle = `rgba(255,90,70,${k})`; ctx.lineWidth = 2; circle(px, py, 4 + age * 30); ctx.stroke();
      } else if (f.kind === 'filter' || f.kind === 'breakup') {
        glow(px, py, 10 + age * 12, 'rgba(255,170,90,A)', 0.6 * k);
      } else {
        ctx.strokeStyle = `rgba(200,210,220,${0.7 * k})`; ctx.lineWidth = 1; circle(px, py, 3 + age * 14); ctx.stroke();
      }
    }

    // buradasınız
    const F = opt.focus;
    if (F && (F.alive !== false)) {
      const [fx, fy] = w2s(F.x, F.y), pr = 10 + 4 * Math.sin(now / 250);
      ctx.strokeStyle = 'rgba(233,162,59,0.9)'; ctx.lineWidth = 1.6; circle(fx, fy, pr); ctx.stroke();
      const name = F.type === 'missile' ? 'Füze' : F.type === 'bus' ? 'Taşıyıcı' : (F.tid || 'Nesne');
      const txt = `${name} · ${Math.max(0, F.h).toFixed(0)} km`;
      ctx.font = '600 12px Barlow, system-ui, sans-serif';
      const tw = ctx.measureText(txt).width + 12, bx = Math.min(W - tw - 6, fx + 16), by = Math.max(6, fy - 34);
      ctx.fillStyle = 'rgba(4,9,15,0.82)'; ctx.fillRect(bx, by, tw, 20);
      ctx.strokeStyle = '#e9a23b'; ctx.strokeRect(bx + 0.5, by + 0.5, tw - 1, 19);
      ctx.fillStyle = '#f3d79c'; ctx.textAlign = 'left'; ctx.fillText(txt, bx + 6, by + 14);
    }

    // ölçek çubuğu
    const sb = niceStep(110), L = sb * sc;
    ctx.strokeStyle = 'rgba(210,225,240,0.7)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(14, H - 14); ctx.lineTo(14 + L, H - 14); ctx.moveTo(14, H - 18); ctx.lineTo(14, H - 10); ctx.moveTo(14 + L, H - 18); ctx.lineTo(14 + L, H - 10); ctx.stroke();
    label(sb + ' km', 14 + L + 8, H - 10, 'rgba(210,225,240,0.75)');
  }

  function segments(sim) {
    if (segCache && segCache.src === sim.nominal) return segCache;
    const nb = Math.floor(TB / 5) + 1, out = { src: sim.nominal, boost: [], coast: [], entry: [], apo: null };
    let apoH = -1, prevR = 0;
    sim.nominal.forEach((p, i) => {
      const r = Math.hypot(p.x, p.y), h = r - R_E, desc = r < prevR; prevR = r;
      if (h > apoH) { apoH = h; out.apo = p; }
      if (i < nb) out.boost.push(p);
      else if (desc && h < ENTRY) { if (!out.entry.length && out.coast.length) out.entry.push(out.coast[out.coast.length - 1]); out.entry.push(p); }
      else { if (!out.coast.length && out.boost.length) out.coast.push(out.boost[out.boost.length - 1]); out.coast.push(p); }
    });
    out.apoH = apoH;
    return (segCache = out);
  }
  function drawSegments(sim) {
    const S = segments(sim);
    const seg = (pts, col, w, dash) => { ctx.setLineDash(dash); ctx.strokeStyle = col; ctx.lineWidth = w; polyline(pts, null, 1e9); ctx.stroke(); };
    seg(S.boost, 'rgba(255,170,90,0.75)', 2.2, []);
    seg(S.coast, 'rgba(200,215,230,0.35)', 1.4, [5, 6]);
    seg(S.entry, 'rgba(255,110,90,0.7)', 2, []);
    ctx.setLineDash([]);
    const tag = (p, txt, col, dy = -10) => { if (!p) return; const [x, y] = w2s(p.x, p.y); if (onScreen(x, y, -10)) { ctx.font = '600 11px Barlow, system-ui, sans-serif'; ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.fillText(txt, x, y + dy); ctx.textAlign = 'left'; } };
    tag(S.boost[Math.floor(S.boost.length * 0.55)], 'İTKİ', 'rgba(255,190,120,0.95)', -12);
    tag(S.apo, `ORTA EVRE (uzay) · apoje ≈ ${Math.round(S.apoH)} km`, 'rgba(210,225,240,0.85)', -12);
    tag(S.entry[Math.floor(S.entry.length * 0.3)], 'ATMOSFERE GİRİŞ', 'rgba(255,140,120,0.95)', -12);
  }
  function hexA(hex) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},A)`;
  }
  function flame(o, len, wid) {
    const [hx, hy] = w2s(o.x, o.y), [bx, by] = w2s(o.x - o.vx * 4, o.y - o.vy * 4);
    let dx = hx - bx, dy = hy - by; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const fl = len * (0.85 + 0.3 * Math.random());
    glow(hx, hy, len * 0.8, 'rgba(255,200,120,A)', 0.55);
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(Math.atan2(dy, dx));
    const g = ctx.createLinearGradient(0, 0, -fl, 0);
    g.addColorStop(0, 'rgba(255,255,235,1)'); g.addColorStop(0.3, 'rgba(255,175,70,0.85)'); g.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(-fl / 2, 0, fl / 2, wid, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function pick(sx, sy, sim) {
    let best = null, bd = 14;
    for (const o of sim.objs) {
      if (!o.alive || !o.tracked) continue;
      const [px, py] = w2s(o.x, o.y), d = Math.hypot(px - sx, py - sy);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  return { init, draw, setMode, setAuto, pick };
})();
