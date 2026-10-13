'use strict';
/* app.js — arayüz bağlantıları, adım kartı ve ana döngü */
(() => {
  const $ = id => document.getElementById(id);
  const MULT = [0.25, 0.5, 1, 2, 4];
  const ATTACK = new Set(['hazir', 'kalkis', 'kademe', 'cikis', 'yanma', 'tasiyici', 'orta']);
  const opt = { truth: false, selected: null, ranks: new Map(), col: o => TRUTH_COL[o.type], step: 'hazir', attacker: true, focus: null, cam: 'pad' };
  const fmtN = (x, d = 0) => Number(x).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
  let last = performance.now(), lastUi = 0;

  /* ---------- model bilgisi (ayrı test kümesinde ölçülen) ---------- */
  { const I = ML.info, pc = v => '%' + Math.round(v * 100);
    $('mlInfo').innerHTML = `<b>Test kümesi (${I.n.test} iz):</b> gerçek başlık duyarlılığı yapay zekâda ${pc(I.recall)}, kural tabanlıda ${pc(I.recallRule)}; ECE (0 = kusursuz kalibrasyon) kalibrasyon öncesi ${I.eceRaw.toFixed(3)}, sonrası ${I.eceCal.toFixed(3)}; bilinmeyen ayrımında AUROC ${I.aurocUnk.toFixed(2)}. Eğitim ${Math.round(I.ms)} ms sürdü.`; }

  /* ---------- adım çubuğu ---------- */
  $('stepper').innerHTML = STEPS.map((s, k) => `<li><b>${String(k + 1).padStart(2, '0')}</b>${s.short}</li>`).join('');
  const stepLis = [...$('stepper').children];

  function readCfg() {
    const q = s => document.querySelector(s);
    const c = {
      mode: q('input[name=mode]:checked').value, density: q('input[name=density]:checked').value,
      nRv: +$('nrv').value, interceptors: +$('icpt').value, range: +$('range').value, unknown: $('unk').checked,
      model: q('input[name=model]:checked').value,
    };
    $('nrvO').textContent = c.nRv; $('icptO').textContent = c.interceptors;
    return c;
  }
  function reset() {
    Sim.reset(readCfg());
    View3D.reset(Sim);
    Guide.reset();
    opt.selected = null;
    $('log').innerHTML = ''; $('captions').innerHTML = '';
    Sim.say(`Senaryo hazır: ${Sim.cfg.mode}, ${Sim.cfg.nRv} harp başlığı, ${fmtN(Sim.cfg.range)} km menzil · karar modeli: ${Sim.cfg.model === 'rule' ? 'kural tabanlı (kıyas)' : 'yapay zekâ (GBDT)'}.`, 'phase');
    render();
  }

  function speedNow() {
    const s = Guide.step();
    return (s.idle && !Sim.hot ? s.idle : s.speed) * Guide.mult;
  }

  function stepCard() {
    const s = Guide.step(), c = Sim.cfg, i = Guide.i;
    $('stepNo').textContent = `Adım ${i + 1} / ${STEPS.length}`;
    $('stepTitle').textContent = s.title(c);
    $('stepLead').textContent = s.lead(c);
    $('stepLook').innerHTML = s.look.map(t => `<li>${t}</li>`).join('');
    $('stepWhy').textContent = s.why;
    const btn = $('btnPlay');
    btn.textContent = i === 0 ? '▶ Fırlat' : !s.end ? '↺ Yeniden' : Guide.playing ? '❚❚ Duraklat' : '▶ Oynat';
    $('btnSkip').disabled = !s.end && i !== 0;
    $('scen').disabled = Sim.phase !== 'ready';
    $('setupHint').hidden = Sim.phase === 'ready';
    stepLis.forEach((li, k) => { li.classList.toggle('past', k < i); li.classList.toggle('now', k === i); });
    const cue = !Guide.playing && !!(s.end || i === 0);
    $('cue').hidden = !cue;
    if (cue) {
      $('cueK').textContent = i === 0 ? 'Adım 1 · hazır' : `Adım ${i + 1} · sıradaki`;
      $('cueT').textContent = s.title(c);
      $('cueBtn').textContent = i === 0 ? '▶ Fırlat' : '▶ Oynat';
    }
  }

  function render() {
    const s = Guide.step();
    $('clock').textContent = fmtT(Sim.t);
    $('speedLbl').textContent = Guide.i === 0 ? 'hazır' : !s.end ? 'tamamlandı' : Guide.playing ? `${fmtN(speedNow(), 2)}× hız` : 'duraklatıldı';
    stepCard();
    const hssOn = s.id === 'radar' || s.id === 'angajman' || s.id === 'sonuc';
    $('hssCard').hidden = !hssOn;
    if (hssOn) $('hssSub').textContent = `${Sim.inventory} önleyici hazır`;
    const main = $('ctxMain'), wrap = main.querySelector('.tbl-wrap'), keep = wrap ? wrap.scrollTop : 0;
    main.innerHTML = Panels[s.panel](opt);
    const w2 = main.querySelector('.tbl-wrap'); if (w2) w2.scrollTop = keep;
    const det = ['radar', 'angajman', 'sonuc'].includes(s.id) && opt.selected && opt.selected.tid;
    $('ctxDetail').hidden = !det;
    if (det) { $('ctxDetail').innerHTML = Panels.detail(opt.selected, opt.truth); Panels.spark($('spark'), opt.selected.tr.hist, opt.col(opt.selected)); }
  }

  /* ---------- olaylar ---------- */
  Sim.onEvent = e => Guide.event(e);
  Sim.onLog = e => {
    if (e.kind === 'muted' || e.kind === 'info' && /yeni iz başlattı/.test(e.msg)) return;
    const li = document.createElement('li');
    li.className = 'k-' + e.kind;
    li.innerHTML = '<time></time><span></span>';
    li.firstChild.textContent = fmtT(e.t); li.lastChild.textContent = e.msg;
    const log = $('log'); log.prepend(li);
    while (log.children.length > 80) log.lastChild.remove();
  };
  Guide.onChange = render;
  Guide.onCaption = (text, kind) => {
    const box = $('captions'), el = document.createElement('div');
    el.className = 'caption ' + kind; el.textContent = text;
    box.append(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => el.remove(), 4900);
  };

  /* ---------- kontroller ---------- */
  function playToggle() {
    const s = Guide.step();
    if (Guide.i === 0) Guide.launch();
    else if (!s.end) reset();
    else if (Guide.playing) Guide.pause(); else Guide.play();
  }
  $('btnPlay').addEventListener('click', playToggle);
  $('cueBtn').addEventListener('click', playToggle);
  $('btnSkip').addEventListener('click', () => Guide.skip());
  $('btnReset').addEventListener('click', reset);
  $('stepwise').addEventListener('input', e => { Guide.stepwise = e.target.checked; });
  Guide.stepwise = $('stepwise').checked;   // tarayıcı kutunun önceki durumunu geri yüklerse onunla eşleşsin
  $('mult').addEventListener('input', e => { Guide.mult = MULT[+e.target.value]; $('multO').textContent = fmtN(Guide.mult, 2).replace(/,?0+$/, '') + '×'; render(); });
  $('truth').addEventListener('input', e => { opt.truth = e.target.checked; render(); });
  document.querySelectorAll('#scen input, #scen select').forEach(el => el.addEventListener('input', () => { if (Sim.phase === 'ready') reset(); }));
  document.querySelectorAll('.vbtns').forEach(box => box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    (box.dataset.view === '2d' ? View2D : View3D).setMode(b.dataset.m);
  }));
  $('c2d').addEventListener('pointerdown', e => {
    const r = e.currentTarget.getBoundingClientRect(), o = View2D.pick(e.clientX - r.left, e.clientY - r.top, Sim);
    if (o) select(o);
  });
  $('ctxMain').addEventListener('pointerdown', e => {
    const tr = e.target.closest('tr[data-i]'); if (tr) select(Sim.objs[+tr.dataset.i]);
  });
  function select(o) { opt.selected = opt.selected === o ? null : o; render(); }
  document.addEventListener('keydown', e => {
    if (/INPUT|SELECT|BUTTON|TEXTAREA/.test(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); playToggle(); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); Guide.skip(); }
  });

  /* ---------- ana döngü ---------- */
  function computeRanks() {
    const m = new Map(), id = Guide.step().id;
    if (id !== 'angajman' && id !== 'sonuc') return m;
    Sim.objs.filter(o => o.alive && o.tracked && o.h < ENTRY && o.score >= ENG_MIN)
      .sort((a, b) => b.score - a.score).slice(0, 9).forEach((o, i) => m.set(o, i + 1));
    return m;
  }
  function focusObj() {
    if (opt.step === 'angajman' || opt.step === 'sonuc') {
      let best = null;
      for (const o of Sim.objs) if (o.alive && o.tracked && (!best || o.score > best.score)) best = o;
      return best;
    }
    return Sim.focus();
  }
  function frame(now) {
    const dtR = Math.min(0.1, (now - last) / 1000); last = now;
    Guide.frame(dtR);
    if (Sim.fx.length > 80) Sim.fx = Sim.fx.filter(f => now - f.rt < 4000);
    const s = Guide.step();
    opt.step = s.id; opt.attacker = ATTACK.has(s.id);
    opt.col = o => (opt.attacker || opt.truth) ? TRUTH_COL[o.type] : colorOf(o, false);
    opt.ranks = computeRanks();
    opt.focus = focusObj();
    opt.cam = s.cam;
    opt.pip = opt.beams = s.id === 'radar' || s.id === 'angajman' || s.id === 'sonuc';
    View2D.setAuto(s.cam2);
    View3D.render(Sim, opt, dtR);
    View2D.draw(Sim, opt, dtR);
    if (now - lastUi > 300) { lastUi = now; render(); }
    requestAnimationFrame(frame);
  }

  View2D.init($('c2d'));
  View3D.init($('v3d'));
  View3D.setPipCanvas($('hssCv'));
  reset();
  requestAnimationFrame(frame);
})();
