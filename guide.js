'use strict';
/* guide.js — adım adım anlatım: her adımın hızı, kamerası, bitiş koşulu ve açıklaması */
const STEPS = [
  {
    id: 'hazir', short: 'Hazırlık', cam: 'pad', cam2: 'full', speed: 0, panel: 'scenario',
    title: () => 'Fırlatmaya hazır',
    lead: c => `Rampada iki kademeli bir balistik füze duruyor. Burun koruyucusunun içinde ${c.nRv} harp başlığı, sahte hedefler ve bunları taşıyan platform (bus) var. ${c.mode === 'MIRV' ? 'MIRV seçili: her başlık ayrı bir hedefe yöneltilecek.' : 'MRV seçili: tüm başlıklar aynı hedef bölgesine birlikte bırakılacak.'}`,
    look: ['3B: rampadaki füze ve fırlatma tesisi.', '2B harita: füzenin izleyeceği yörünge ve evreleri.', 'Sağ panel: taşıyıcıdaki nesneler ve fiziksel farkları.'],
    why: 'Taşıyıcıdaki sahte nesnelerin hepsi gerçek başlığa benzemek üzere tasarlanır. Projenin sorusu: bu nesne fiziksel olarak hangi özellikte başlıktan farklı?',
  },
  {
    id: 'kalkis', short: 'Kalkış', cam: 'track', cam2: 'launch', speed: 1.5, panel: 'tele',
    title: () => 'Ateşleme ve kalkış',
    lead: () => '1. kademe motoru ateşlendi. Füze rampadan dikey olarak yükseliyor, yaklaşık 1,8 g ivmeyle hızlanıyor ve arkasında yoğun bir egzoz dumanı bırakıyor.',
    look: ['Yerdeki takip kamerası füzeyi izliyor.', 'Sağ panelde irtifa ve hız hızla artıyor.'],
    why: 'İtki evresinde füze tek parçadır ve motoru çok parlaktır. Sahte hedefler henüz burun koruyucusunun içinde olduğu için ayırt etme sorunu yoktur.',
    end: S => S.t >= 30,
  },
  {
    id: 'kademe', short: 'Kademe ayrılması', cam: 'chase', cam2: 'launch', speed: 3, panel: 'tele',
    title: () => '1. kademe ayrılması',
    lead: () => 'Yaklaşık 71. saniyede 1. kademenin yakıtı biter. Boş kademe ayrılıp düşer, 2. kademe motoru ateşlenir ve füze yörüngesini giderek yatırır.',
    look: ['Kamera füzeyi yakından takip ediyor.', 'Ayrılan 1. kademe geride kalıp düşüyor.'],
    why: 'Ayrılan kademeler, ileride tehdit kümesine karışan “enkaz” nesnelerinin ilk örneğidir.',
    end: S => S.T.stage1 !== null && S.t >= S.T.stage1 + 9,
  },
  {
    id: 'cikis', short: 'Atmosfer dışı', cam: 'chaseWide', cam2: 'launch', speed: 4, panel: 'tele',
    title: () => 'Atmosfer dışına çıkış',
    lead: () => 'Füze 100 km’deki Kármán hattını geçerek uzaya çıkıyor. Hava neredeyse yok: gökyüzü kararıyor, egzoz alevi vakumda genişliyor ve duman izi kesiliyor.',
    look: ['Arka planda Dünya’nın eğriliği ve kararan gökyüzü.', '2B haritada füze Kármán çizgisinin üstüne geçiyor.'],
    why: 'Uzayda hava sürtünmesi yoktur. Birazdan bırakılacak hafif bir balon ile ağır bir harp başlığı bu yüzden aynı yolu izleyecek.',
    end: S => S.T.karman !== null && S.t >= S.T.karman + 5,
  },
  {
    id: 'yanma', short: 'Yanma sonu', cam: 'bus', cam2: 'full', speed: 2.5, panel: 'tele',
    title: () => 'Yanma sonu ve burun koruyucusu',
    lead: () => '170. saniyede 2. kademenin yakıtı biter ve kademe ayrılır. Ardından burun koruyucusu iki parçaya ayrılıp atılır; taşıyıcı (bus) ve üzerindeki harp başlıkları açığa çıkar.',
    look: ['Altın renkli silindir: taşıyıcı (bus).', 'Üstündeki koyu konik nesneler: harp başlıkları.', 'Açılıp uzaklaşan iki beyaz kabuk: burun koruyucusu.'],
    why: 'Bu andan sonra savunmanın karşısında tek bir füze değil, bir nesne kümesi olacak.',
    end: S => S.T.burnout !== null && S.t >= TB + 16,
  },
  {
    id: 'tasiyici', short: 'Taşıyıcı manevraları', cam: 'busWide', cam2: 'full', speed: 4, panel: 'releases',
    title: c => c.mode === 'MIRV' ? 'Taşıyıcı manevraları (MIRV)' : 'Başlıkların bırakılması (MRV)',
    lead: c => c.mode === 'MIRV'
      ? 'Taşıyıcı küçük itiş motorlarıyla hızını ve yönünü değiştirir, bir harp başlığını bırakır. Sonra yeniden manevra yapıp sıradaki başlığı başka bir hedefe yöneltir. Her başlığın yanına balonlar ve ağır sahte hedefler bırakılır.'
      : 'MRV’de taşıyıcı tek bir yönelme manevrası yapar ve tüm harp başlıklarını aynı anda, aynı hedef bölgesine doğru bırakır. Balonlar ve ağır sahte hedefler de aynı anda serbest kalır.',
    look: ['Parlamalar: taşıyıcının itiş motorları.', 'Şişen gümüş küreler: hafif sahte hedefler (balon).', 'Etiketler nesnelerin gerçek kimliğini gösteriyor; savunma bunu bilmiyor.'],
    why: 'Bırakılan her nesne taşıyıcının hızını alır. Uzayda hepsi birlikte uçar; radar onları yalnızca imzalarından ayırt edebilir.',
    end: S => S.T.busDone !== null,
  },
  {
    id: 'orta', short: 'Orta evre', cam: 'cloud', cam2: 'full', speed: 25, panel: 'cloud',
    title: () => 'Orta evre: uzayda tehdit kümesi',
    lead: () => 'Nesneler uzayda yalnızca yerçekiminin etkisiyle, 10–20 dakika boyunca süzülür. Küme yörüngenin en yüksek noktasına (apoje) çıkıp alçalmaya başlıyor.',
    look: ['Renkli çizgiler: her nesnenin yörüngesi.', '2B haritada kümenin konumu ve apoje.'],
    why: 'Vakumda balon da harp başlığı da aynı hızla, aynı yolda ilerler. Hareketlerinden ayırt edilemezler; elde yalnızca radar ve kızılötesi imzalar kalır.',
    end: S => S.T.apogee !== null && S.t >= S.T.apogee + 10,
  },
  {
    id: 'radar', short: 'Radar', cam: 'radar', cam2: 'full', speed: 20, panel: 'tracks',
    title: () => 'Radar izleme ve sınıflandırma',
    lead: () => 'Hava savunma sisteminin (HSS) radarı tehdit kümesini menziline aldığında her nesne için bir iz (H-01, H-02, …) başlatır. Radar kesit alanı, dönme hareketi ve kızılötesi soğuma hızı ölçülür. Gradyan artırmalı karar ağaçları her iz için kalibre edilmiş gerçek başlık olasılığını hesaplar; Isolation Forest eğitimde görülmemiş imzaları BİLİNMEYEN olarak işaretler.',
    look: ['Sağ paneldeki “HSS bataryası · canlı görüntü”: fırlatıcılar ve dolu kanisterleri.', 'Bataryadan çıkan camgöbeği çizgiler: radarın izlediği nesneler.', 'Etiketler artık radarın kararını gösteriyor: kırmızı gerçek, mavi sahte, mor bilinmeyen.'],
    why: 'Uzayda sınıflandırma yalnızca dış görünüş imzalarına dayanır. Ağır sahte hedefler bu aşamada başlığa çok benzeyebilir.',
    end: S => S.T.entry !== null,
  },
  {
    id: 'angajman', short: 'Giriş ve angajman', cam: 'defense', cam2: 'defense', speed: 1.5, idle: 8, panel: 'engage',
    title: () => 'Atmosfere giriş ve HSS angajmanı',
    lead: () => 'Tehdit kümesi 120 km’de atmosfere giriyor. Hafif balonlar hava direnciyle hızla yavaşlayıp parçalanıyor. Kalman filtresi her nesnenin yavaşlamasından balistik katsayısını (kütle / alan) kestiriyor. Atış kontrol merkezi her radar turunda tehdit skorlarını yeniden hesaplıyor ve önleyicileri en yüksek skordan başlayarak atıyor; ıskalanan hedef bir sonraki turda yeniden sıraya giriyor (ateşle-gözle-ateşle).',
    look: ['Sağ paneldeki HSS canlı görüntüsü: önleyiciler kanisterlerden duman bırakarak kalkıyor; boşalan tüplerin kapağı açılıyor.', 'Kehribar çizgi: atış kontrol radarının kilitlendiği hedef. Turuncu numaralar: öncelik sırası.', 'Akkor kuyruklar: atmosfere giren ve ısınan nesneler.'],
    why: 'Kütleyi taklit etmek zordur. Atmosferde yavaşlama verisi geldiğinde ağır sahte hedefler de ayrışır; projenin temel fikri budur.',
    end: S => S.phase === 'done',
  },
  {
    id: 'sonuc', short: 'Sonuç', cam: 'defense', cam2: 'defense', speed: 0, panel: 'result',
    title: () => 'Sonuç',
    lead: () => 'Senaryo tamamlandı. Sağ panelde kaç harp başlığının önlendiği, sahte hedeflere kaç önleyici harcandığı, sınıflandırıcının karışıklık matrisi ve yapay zekâ modeliyle kural tabanlı modelin karşılaştırması var.',
    look: ['“Baştan” ile aynı senaryoyu yeniden oynatabilir, ayarları değiştirerek sonuçları karşılaştırabilirsiniz.'],
    why: 'Sahte hedefe harcanan her önleyici, gerçek bir başlığa kalmayan bir önleyicidir. İyi ayırt etme, savunmanın kapasitesini doğrudan artırır.',
  },
];

const CAPTION = {
  launch: () => ['Ateşleme! Füze rampadan kalkıyor', 'info'],
  stage1: () => ['1. kademe ayrıldı · 2. kademe ateşlendi', 'info'],
  karman: () => ['100 km Kármán hattı geçildi · füze artık uzayda', 'info'],
  burnout: () => ['Yanma sonu · 2. kademe ayrıldı', 'info'],
  fairing: () => ['Burun koruyucusu atıldı · harp başlıkları açığa çıktı', 'info'],
  release: e => [Sim.cfg.mode === 'MIRV'
    ? `${e.no}. harp başlığı bırakıldı → ${e.aim.name} · yanında ${e.light} balon, ${e.heavy} ağır sahte${e.unknown ? ', 1 bilinmeyen' : ''}`
    : `${Sim.cfg.nRv} harp başlığı birlikte bırakıldı → ${e.aim.name}`, 'info'],
  busDone: e => [`Konuşlanma tamamlandı · tehdit kümesi: ${e.n} nesne`, 'info'],
  apogee: () => [`Apoje · yaklaşık ${Math.round(Sim.apogee)} km · alçalma başladı`, 'info'],
  radar: (e, first) => first ? ['HSS radarı tehdit kümesini yakaladı', 'info'] : null,
  classified: e => [`İlk sınıflandırma: ${e.GERCEK} gerçek · ${e.SAHTE} sahte · ${e.BILINMEYEN} bilinmeyen`, 'info'],
  entry: () => ['120 km · atmosfere giriş · HSS angajman modunda', 'warn'],
  fire: e => [`Önleyici-${e.m.id} ateşlendi → ${e.T.tid} · skor ${Math.round(e.T.score)}`, 'fire'],
  kill: e => [`${e.T.tid} imha edildi · gerçek kimlik: ${TYPE_INFO[e.T.type].name}`, e.T.type === 'rv' ? 'good' : 'warn'],
  miss: e => [`Önleyici-${e.m.id} ıskaladı · yeniden angajman`, 'warn'],
  filter: (e, first) => first ? ['Balonlar atmosferde yavaşlayıp parçalanıyor: atmosferik filtreleme', 'info'] : null,
  leak: e => [`${e.o.tid} savunmayı aştı!`, 'bad'],
  done: () => ['Senaryo tamamlandı', 'info'],
};

const Guide = {
  i: 0, playing: false, stepwise: false, mult: 1, onChange: null, onCaption: null, seen: {},
  step() { return STEPS[this.i]; },
  reset() { this.i = 0; this.playing = false; this.seen = {}; this.notify(); },
  launch() { Sim.launch(); this.i = 1; this.playing = true; this.notify(); },
  play() {
    if (this.i === 0) return this.launch();
    if (!this.step().end) return;
    this.playing = true; this.notify();
  },
  pause() { this.playing = false; this.notify(); },
  // geçerli adımı hızla sonuna kadar oynatır
  skip() {
    if (this.i === 0) { Sim.launch(); this.i = 1; }
    const s = this.step();
    if (!s.end) return;
    let g = 0;
    while (!s.end(Sim) && g++ < 600) Sim.update(30, () => s.end(Sim));
    this.advance();
  },
  advance() {
    this.i = Math.min(STEPS.length - 1, this.i + 1);
    if (!this.step().end || this.stepwise) this.playing = false;
    this.notify();
  },
  frame(dtR) {
    const s = this.step();
    if (!this.playing || !s.end) return;
    let sp = s.speed * this.mult;
    if (s.idle && !Sim.hot) sp = s.idle * this.mult;
    const hit = Sim.update(dtR * sp, () => s.end(Sim));
    if (hit || s.end(Sim)) this.advance();
  },
  event(e) {
    const f = CAPTION[e.type];
    if (!f) return;
    const first = !this.seen[e.type]; this.seen[e.type] = true;
    const c = f(e, first);
    if (c && this.onCaption) this.onCaption(c[0], c[1]);
  },
  notify() { this.onChange && this.onChange(); },
};
