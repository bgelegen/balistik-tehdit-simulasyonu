'use strict';
/* panels.js — sağ sütunda adıma özel bilgi panelleri */
const Panels = (() => {
  const fmt = (x, d = 0) => Number(x).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sw = c => `<span class="sw" style="background:${c}"></span>`;
  const PER = { low: [1, 0], mid: [2, 1], high: [3, 1] };

  function scenario() {
    const c = Sim.cfg, per = PER[c.density];
    return `<h2>Taşıyıcıdaki yük</h2>
      <div class="cargo">
        <span>${sw(TRUTH_COL.rv)}<b>${c.nRv}</b>harp başlığı</span>
        <span>${sw(TRUTH_COL.light)}<b>${per[0] * c.nRv}</b>balon</span>
        ${per[1] ? `<span>${sw(TRUTH_COL.heavy)}<b>${per[1] * c.nRv}</b>ağır sahte</span>` : ''}
        ${c.unknown ? `<span>${sw(TRUTH_COL.unknown)}<b>1</b>bilinmeyen tip</span>` : ''}
        <span>${sw(TRUTH_COL.debris)}<b>+</b>roket enkazı</span>
      </div>
      <p class="hint">${c.mode === 'MIRV' ? `MIRV: ${c.nRv} başlık ${Math.min(c.nRv, 6)} farklı hedefe.` : `MRV: ${c.nRv} başlık tek hedef bölgesine.`} Menzil ${fmt(c.range)} km, savunmada ${c.interceptors} önleyici.</p>
      <h2>Nesneler nasıl ayırt edilir?</h2>
      <table class="types"><tbody>
        <tr><td>${sw(TRUTH_COL.rv)}Harp başlığı</td><td>Ağır koni. Düzenli dönme, yavaş soğuma. Atmosferde <b>az yavaşlar</b> (yüksek β).</td></tr>
        <tr><td>${sw(TRUTH_COL.heavy)}Ağır sahte</td><td>Başlığa benzer koni ama daha hafif. Uzayda neredeyse aynı görünür; atmosferde <b>daha çok yavaşlar</b>.</td></tr>
        <tr><td>${sw(TRUTH_COL.light)}Balon</td><td>Şişirilmiş metal kaplı küre. Düzensiz yalpalar, hızlı soğur. Atmosfere girince <b>hemen yavaşlar ve parçalanır</b>.</td></tr>
        <tr><td>${sw(TRUTH_COL.debris)}Enkaz</td><td>Kademe ve tank parçaları. Takla atar, radar yansıması büyük ve düzensizdir.</td></tr>
        <tr><td>${sw(TRUTH_COL.unknown)}Bilinmeyen</td><td>Eğitimde görülmemiş imza (çok hızlı dönme). Sınıflandırıcı bunu “bilinmeyen” diye işaretlemeli.</td></tr>
      </tbody></table>`;
  }

  function gauge(h) {
    const top = 200, pos = v => `${Math.min(v, top) / top * 100}%`;
    const marks = [[12, 'Troposfer', ''], [50, 'Stratosfer', ''], [85, 'Mezosfer', ''], [100, 'Kármán 100', 'k'], [120, 'Giriş 120', 'e'], [180, 'Yanma sonu', '']];
    return `<div class="gauge" aria-label="İrtifa göstergesi">
      <div class="band" style="bottom:0;height:${pos(12)};background:rgba(120,180,240,0.22)"></div>
      <div class="band" style="bottom:${pos(12)};height:${pos(38)};background:rgba(90,140,220,0.14)"></div>
      <div class="band" style="bottom:${pos(50)};height:${pos(50)};background:rgba(60,90,180,0.08)"></div>
      ${marks.map(([v, t, k]) => `<div class="mk ${k}" style="bottom:${pos(v)}"><span>${t}</span></div>`).join('')}
      <div class="me" style="bottom:${pos(Math.max(0, h))}"><span>${h > top ? '↑ ' : ''}${fmt(Math.max(0, h), 1)} km</span></div>
    </div>`;
  }

  function tele() {
    const M = Sim.missile, f = M || Sim.bus;
    if (!f) return '<h2>Telemetri</h2><p class="hint">Füze rampada.</p>';
    const stage = M ? `${M.stage}. kademe` : 'Taşıyıcı';
    const burn = M ? Math.max(0, TB - Sim.t) : 0;
    return `<h2>Telemetri <span class="sub">${stage}</span></h2>
      <dl class="big">
        <div><dt>İrtifa</dt><dd>${fmt(Math.max(0, f.h), 1)} <small>km</small></dd></div>
        <div><dt>Hız</dt><dd>${fmt(f.v, 2)} <small>km/s</small></dd></div>
        <div><dt>Yer menzili</dt><dd>${fmt(Math.max(0, rangeOf(f)))} <small>km</small></dd></div>
        <div><dt>${M ? 'Kalan yanma' : 'Yüklü başlık'}</dt><dd>${M ? fmt(burn) + ' <small>s</small>' : (f.loaded || 0)}</dd></div>
      </dl>
      ${gauge(f.h)}`;
  }

  function releases() {
    const rel = Sim.events.filter(e => e.type === 'release');
    const nextT = (Sim.plan.find(e => e.kind === 'release') || {}).t;
    const rows = Sim.planAll.map((p, i) => {
      const done = rel[i], now = !done && p.t === nextT;
      const what = `${p.nRv} başlık${p.light ? ` · ${p.light} balon` : ''}${p.heavy ? ` · ${p.heavy} ağır sahte` : ''}${p.unknown ? ' · 1 bilinmeyen' : ''}`;
      return `<li class="${done ? 'done' : now ? 'now' : ''}"><b>${i + 1}</b><span>${p.aim.name}<small>${what}</small></span>
        <span class="st">${done ? '✓ ' + fmtT(done.t) : now ? fmtT(p.t) : 'bekliyor'}</span></li>`;
    }).join('');
    const b = Sim.bus;
    return `<h2>Bırakma sırası <span class="sub">${Sim.cfg.mode}</span></h2><ol class="rel">${rows}</ol>
      ${b ? `<p class="hint">Taşıyıcı: ${fmt(b.h)} km irtifa, ${fmt(b.v, 2)} km/s. ${b.burnUntil > Sim.t ? '<b style="color:var(--accent)">Manevra motorları çalışıyor.</b>' : ''}</p>` : ''}`;
  }

  function cloud() {
    const live = Sim.objs.filter(o => o.alive && o.type !== 'stage1');
    const n = t => live.filter(o => o.type === t).length;
    const b = Sim.bus || live[0];
    const rows = [['rv', 'Harp başlığı'], ['heavy', 'Ağır sahte'], ['light', 'Balon'], ['unknown', 'Bilinmeyen'], ['debris', 'Enkaz'], ['bus', 'Taşıyıcı gövdesi']]
      .filter(([t]) => n(t)).map(([t, name]) => `<span>${sw(TRUTH_COL[t])}<b>${n(t)}</b>${name}</span>`).join('');
    return `<h2>Tehdit kümesi <span class="sub">${live.length} nesne</span></h2>
      <div class="cargo">${rows}</div>
      ${b ? `<dl class="big" style="margin-top:14px"><div><dt>İrtifa</dt><dd>${fmt(b.h)} <small>km</small></dd></div><div><dt>Hız</dt><dd>${fmt(b.v, 2)} <small>km/s</small></dd></div></dl>` : ''}
      <p class="hint">Uzayda tüm nesneler aynı hızla ve aynı yolda ilerler. Radar menzile girene kadar savunma bu kümeyi göremez.</p>`;
  }

  function trackRows(rows, sel, truth, withRank, ranks) {
    return rows.map(o => {
      const lab = o.alive ? (o.cls ? o.cls.label : 'IZLENIYOR') : (o.finalLabel || 'IZLENIYOR');
      const p = o.cls ? Math.round(o.cls.p.rv * 100) : 0, rk = ranks.get(o);
      return `<tr data-i="${Sim.objs.indexOf(o)}" class="${o === sel ? 'sel' : ''} ${o.alive ? '' : 'dead'}">
        ${withRank ? `<td>${rk ? `<span class="rank">${rk}</span>` : ''}</td>` : ''}
        <td>${o.tid}</td>
        <td><span class="chip c-${lab}">${LABEL_TR[lab]}</span>${truth ? `<span class="truth">${TYPE_INFO[o.type].name}</span>` : ''}</td>
        <td><span class="pbar"><i style="width:${p}%"></i></span>${p}%</td>
        ${withRank ? `<td>${o.alive ? Math.round(o.score) : '—'}</td>` : ''}
        <td>${status(o)}</td></tr>`;
    }).join('');
  }
  function status(o) {
    if (o.alive) return o.assigned ? `Ö-${o.assigned.id} yolda` : o.h < ENTRY ? 'Atmosferde' : 'Uzayda';
    return { imha: 'İmha', yer: o.type === 'rv' || o.type === 'unknown' ? 'Yere ulaştı' : 'Yere düştü', ayiklandi: 'Parçalandı', parcalandi: 'Parçalandı' }[o.status] || o.status;
  }

  // temsilî uzun menzilli hava ve füze savunma bataryasının bileşenleri
  function hss() {
    const tracked = Sim.objs.filter(o => o.alive && o.tracked).length;
    const tubes = L => Array.from({ length: L.rounds + L.fired }, (_, i) => `<i class="${i < L.fired ? 'used' : ''}"></i>`).join('') || '<em>boş</em>';
    return `<h2>HSS bataryası <span class="sub">temsilî, uzun menzilli</span></h2>
      <ul class="hss">
        <li><b>Radar</b><span>X-bant faz dizili · ${tracked} iz izleniyor</span></li>
        <li><b>Atış kontrol</b><span>Tehdit değerlendirme ve silah atama · ${Sim.icpts.length} önleyici yolda</span></li>
        ${Sim.launchers.map(L => `<li><b>Fırlatıcı ${L.no}</b><span class="tubes" title="${L.rounds} dolu, ${L.fired} atıldı">${tubes(L)}</span></li>`).join('')}
      </ul>`;
  }

  function tracks(opt) {
    const rows = Sim.objs.filter(o => o.tid).sort((a, b) => (b.alive - a.alive) || ((b.cls ? b.cls.p.rv : 0) - (a.cls ? a.cls.p.rv : 0)));
    if (!rows.length) return hss() + `<h2>Radar izleri</h2><p class="hint">Tehdit kümesi henüz HSS radarının menzilinde değil (menzil ${fmt(RADAR_RANGE)} km, ufuk çizgisinin üstü). Radar yakaladığında izler burada listelenir.</p>`;
    const c = { GERCEK: 0, SAHTE: 0, BILINMEYEN: 0, IZLENIYOR: 0 };
    rows.forEach(o => { if (o.alive) c[o.cls ? o.cls.label : 'IZLENIYOR']++; });
    return hss() + `<h2>Radar izleri <span class="sub">${rows.length} iz</span></h2>
      <div class="cargo" style="margin-bottom:10px">
        <span class="c-GERCEK"><b>${c.GERCEK}</b>gerçek</span><span class="c-SAHTE"><b>${c.SAHTE}</b>sahte</span>
        <span class="c-BILINMEYEN"><b>${c.BILINMEYEN}</b>bilinmeyen</span>${c.IZLENIYOR ? `<span class="c-IZLENIYOR"><b>${c.IZLENIYOR}</b>izleniyor</span>` : ''}
      </div>
      <div class="tbl-wrap"><table class="trk"><thead><tr><th>İz</th><th>Karar</th><th>P(gerçek)</th><th>Durum</th></tr></thead>
      <tbody>${trackRows(rows, opt.selected, opt.truth, false, opt.ranks)}</tbody></table></div>
      <p class="hint">Bir satıra tıklayarak izin ölçümlerini görün.</p>`;
  }

  function engage(opt) {
    const rows = Sim.objs.filter(o => o.tid && (o.alive ? o.h < ENTRY + 60 : o.tEnd >= (Sim.T.entry || 0)))
      .sort((a, b) => (b.alive - a.alive) || (b.score - a.score));
    const tot = Sim.cfg.interceptors, used = tot - Sim.inventory, s = Sim.stats, R = Sim.rounds, rule = Sim.cfg.model === 'rule';
    const rt = R.n ? `Tur süresi ort. ${fmt(R.sum / R.n, 1)} ms, en çok ${fmt(R.max, 1)} ms · radar aralığı ${fmt(RADAR_DT * 1000)} ms` : 'Önceliklendirme turları atmosfere girişte başlar';
    return hss() + `<h2>Atış öncelik sırası <span class="sub">${rule ? 'kural tabanlı · kalan süreye göre' : 'tehdit skoruna göre'}</span></h2>
      <p class="hint" style="margin:0 0 6px">${used} önleyici atıldı · ${Sim.inventory} önleyici kaldı · ${s.rvKilled}/${s.rv} başlık imha · ${s.filtered} balon atmosferde ayıklandı</p>
      <p class="hint" style="margin:0 0 10px">${rt} · ${R.n} tur</p>
      <div class="tbl-wrap"><table class="trk"><thead><tr><th>#</th><th>İz</th><th>Karar</th><th>P</th><th>Skor</th><th>Durum</th></tr></thead>
      <tbody>${trackRows(rows, opt.selected, opt.truth, true, opt.ranks)}</tbody></table></div>
      ${rule ? '<p class="formula">Kıyas yöntemi: kural tabanlı modelin <b>GERÇEK</b> dediği izler yalnızca çarpmaya kalan süreye göre sıralanır (Skor = 100 × <b>U</b>).</p>'
        : '<p class="formula">Skor = 100 × <b>P</b> (kalibre gerçek başlık olasılığı) × <b>K</b> (hedef kritikliği) × <b>U</b> (aciliyet) · her radar turunda yeniden hesaplanır</p>'}`;
  }

  function result() {
    const s = Sim.stats, conf = s.conf;
    if (!conf) return '<h2>Sonuç</h2>';
    const cols = ['GERCEK', 'SAHTE', 'BILINMEYEN', 'IZLENIYOR'], rn = { GERCEK: 'Harp başlığı', SAHTE: 'Sahte / enkaz', BILINMEYEN: 'Bilinmeyen' };
    const notes = [];
    notes.push(s.rvLeaked === 0 ? `${s.rv} harp başlığının tamamı önlendi.` : `${s.rv} harp başlığından ${s.rvLeaked} tanesi savunmayı aştı.`);
    if (s.filtered) notes.push(`${s.filtered} balon atmosfere girişte kendiliğinden parçalandı; bunlara hiç önleyici harcanmadı.`);
    if (s.hitDecoy) notes.push(`${s.hitDecoy} önleyici sahte hedefe ya da enkaza harcandı. Ağır sahte hedefler, yavaşlama verisi gelene kadar başlıktan en zor ayrılan nesnelerdir.`);
    if (s.unk) notes.push(s.unkKilled ? 'Bilinmeyen tip nesne temkinli politikayla önceliklendirildi ve imha edildi.' : 'Bilinmeyen tip nesne önlenemedi.');
    return `<h2>Sonuç</h2>
      <div class="kpis">
        <div class="kpi good"><b>${s.rvKilled}/${s.rv}</b><span>Başlık imha</span></div>
        <div class="kpi ${s.rvLeaked ? 'bad' : ''}"><b>${s.rvLeaked}</b><span>Savunmayı aşan</span></div>
        <div class="kpi"><b>${s.shots}/${Sim.cfg.interceptors}</b><span>Kullanılan önleyici</span></div>
        <div class="kpi ${s.hitDecoy ? 'bad' : ''}"><b>${s.hitDecoy}</b><span>Sahteye harcanan</span></div>
      </div>
      ${cmpTable(s.cmp)}
      <h2>Karışıklık matrisi <span class="sub">gerçek tür × son karar · ${Sim.cfg.model === 'rule' ? 'kural tabanlı' : 'yapay zekâ'}</span></h2>
      <table class="conf"><thead><tr><th></th>${cols.map(c => `<th>${LABEL_TR[c]}</th>`).join('')}</tr></thead>
      <tbody>${Object.keys(rn).map(r => `<tr><td>${rn[r]}</td>${cols.map(c => `<td class="${c === r && conf[r][c] ? 'diag' : ''}">${conf[r][c]}</td>`).join('')}</tr>`).join('')}</tbody></table>
      ${notes.map(t => `<p class="note">${t}</p>`).join('')}`;
  }

  function cmpTable(c) {
    if (!c) return '';
    const pct = (a, b) => b ? '%' + Math.round(100 * a / b) : '—';
    const row = (name, k) => `<tr><td>${name}</td><td>${pct(c[k].rvHit, c[k].rv)}</td><td>${c[k].fa}</td><td>${c[k].unk ? (c[k].unkHit + '/' + c[k].unk) : '—'}</td></tr>`;
    return `<h2>Model karşılaştırması <span class="sub">aynı izler, son kararlar</span></h2>
      <table class="conf"><thead><tr><th>Model</th><th>Gerçek başlık duyarlılığı</th><th>Gerçek denilen sahte</th><th>Bilinmeyen yakalama</th></tr></thead>
      <tbody>${row('Yapay zekâ (GBDT)', 'ml')}${row('Kural tabanlı', 'rule')}</tbody></table>
      <p class="hint">Önceliklendirme ${Sim.cfg.model === 'rule' ? 'kural tabanlı' : 'yapay zekâ'} modelinin kararlarıyla yapıldı. Diğer modeli denemek için ayarlardan “Karar modeli”ni değiştirip senaryoyu yeniden oynatın.</p>`;
  }

  function detail(o, truth) {
    if (!o || !o.tid) return null;
    const c = o.cls || classify(o), tr = o.tr, n = Math.max(tr.n, 1), m = f => tr.sum[f] / n, e = betaEst(tr);
    const bt = !e ? '—' : e.sig ? `${fmt(1 / e.bh)} ± ${fmt(e.sb / (e.bh * e.bh))}` : (e.bh + 3 * e.sb > 0 ? '>' + fmt(1 / (e.bh + 3 * e.sb)) : '—');
    const lab = o.alive ? c.label : (o.finalLabel || c.label);
    const cls = [['rv', 'Harp başlığı', COL.GERCEK], ['heavy', 'Ağır sahte', COL.SAHTE], ['light', 'Balon', '#8fd3ff'], ['debris', 'Enkaz', '#a3adb7']];
    const k = o.kInfo;
    return `<h2>${o.tid} <span class="chip c-${lab}">${LABEL_TR[lab]}</span><span class="sub">${tr.n} ölçüm</span></h2>
      ${truth ? `<p class="hint" style="margin:-4px 0 10px">Gerçek kimlik: <b style="color:${TRUTH_COL[o.type]}">${TYPE_INFO[o.type].name}</b></p>` : ''}
      <div class="probs">${cls.map(([key, name, col]) => `<span>${name}</span><span class="bar"><i style="width:${(c.p[key] * 100).toFixed(1)}%;background:${col}"></i></span><span class="pv">%${Math.round(c.p[key] * 100)}</span>`).join('')}</div>
      ${tr.n ? `<table class="feat"><thead><tr><th>Ölçüm</th><th>Bu iz</th><th>Başlık tipik</th></tr></thead><tbody>
        <tr><td>Radar kesit alanı</td><td>${fmt(m('rcs'), 1)} dBsm</td><td>−18 dBsm</td></tr>
        <tr><td>Dönme periyodu</td><td>${fmt(Math.pow(10, m('lper')), 2)} s</td><td>3,0 s</td></tr>
        <tr><td>Hareket düzenliliği</td><td>${fmt(m('reg'), 2)}</td><td>0,90</td></tr>
        <tr><td>Soğuma hızı</td><td>${fmt(Math.pow(10, m('lcool')), 3)} K/s</td><td>0,020 K/s</td></tr>
        <tr><td>Balistik katsayı β (Kalman)</td><td>${bt}</td><td>15.000</td></tr>
        ${c.iso !== undefined ? `<tr><td>Isolation Forest skoru</td><td>${fmt(c.iso, 2)}</td><td>eşik ${fmt(ML.info.isoThr, 2)}</td></tr>` : ''}
      </tbody></table>
      ${c.ruleLabel && c.ruleLabel !== 'IZLENIYOR' ? `<p class="hint">Yapay zekâ: <b>${LABEL_TR[c.mlLabel]}</b> (kalibre P=%${Math.round(c.mlP * 100)}, eşik %${Math.round(ML.info.tau * 100)}) · Kural tabanlı: <b>${LABEL_TR[c.ruleLabel]}</b> (${c.why})</p>` : ''}` : ''}
      <canvas class="spark" id="spark"></canvas>
      ${k && o.pred ? `<p class="formula">${k.rule ? `Kural tabanlı skor = 100 × U <b>${k.U.toFixed(2)}</b>${k.P ? '' : ' (SAHTE: atanmaz)'} = <b>${Math.round(o.score)}</b>` : `Skor = 100 × P <b>${k.P.toFixed(2)}</b> × K <b>${k.K.toFixed(2)}</b> × U <b>${k.U.toFixed(2)}</b> = <b>${Math.round(o.score)}</b>`}<br>Kestirilen düşme: ${k.near ? k.near.name : '—'} yakını, ${fmt(o.pred.t)} s sonra</p>` : ''}`;
  }
  function spark(cv, hist, col) {
    if (!cv) return;
    const r = cv.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
    cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
    const g = cv.getContext('2d'); g.scale(d, d);
    const W = r.width, H = r.height;
    g.font = '10px "JetBrains Mono", monospace'; g.fillStyle = '#7d8f9d'; g.fillText('Radar yansıması (dBsm) · son 40 s', 6, 12);
    if (hist.length < 2) return;
    let lo = Math.min(...hist), hi = Math.max(...hist); const pad = (hi - lo) * 0.15 + 0.5; lo -= pad; hi += pad;
    g.strokeStyle = col; g.lineWidth = 1.3; g.beginPath();
    hist.forEach((v, i) => { const x = i / 159 * W, y = H - 4 - (v - lo) / (hi - lo) * (H - 18); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  }

  return { scenario, tele, releases, cloud, tracks, engage, result, detail, spark };
})();
