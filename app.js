/* 吉備路マラソン コースナビ (PWA) */
(() => {
'use strict';
const C = window.COURSE;
const PTS = C.pts;                 // [lat, lon, officialKm]
const TOTAL = 42.195;
const $ = id => document.getElementById(id);
const LS_KEY = 'kibiji-run-v1', LS_OPT = 'kibiji-opt-v1';

// ---------- geometry ----------
const LAT0 = PTS[0][0], LON0 = PTS[0][1];
const KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 110574;
const XY = PTS.map(p => [(p[1] - LON0) * KX, (p[0] - LAT0) * KY]);
const toXY = (lat, lon) => [(lon - LON0) * KX, (lat - LAT0) * KY];
const hav = (a, b) => { const t = Math.PI / 180, dl = (b[0] - a[0]) * t, dn = (b[1] - a[1]) * t;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dn / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x)); };

// nearest point on course whose km is within [lo, hi]
function nearest(lat, lon, lo = -1, hi = 99) {
  const [px, py] = toXY(lat, lon);
  let best = { d: Infinity, km: 0, i: 0 };
  for (let i = 0; i < PTS.length - 1; i++) {
    if (PTS[i + 1][2] < lo || PTS[i][2] > hi) continue;
    const [ax, ay] = XY[i], [bx, by] = XY[i + 1];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
    if (d < best.d - 0.01) best = { d, km: PTS[i][2] + t * (PTS[i + 1][2] - PTS[i][2]), i };
  }
  return best;
}
function posAtKm(km) {
  km = Math.max(0, Math.min(TOTAL, km));
  let i = 0; while (i < PTS.length - 2 && PTS[i + 1][2] < km) i++;
  const a = PTS[i], b = PTS[i + 1], t = (km - a[2]) / ((b[2] - a[2]) || 1);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// ---------- formatting ----------
const pad = n => String(n).padStart(2, '0');
const fmtHMS = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
const fmtPace = s => (!isFinite(s) || s <= 0 || s > 1800) ? `--'--"` : `${Math.floor(s / 60)}'${pad(Math.round(s % 60) % 60)}"`;
const fmtClock = ms => { const d = new Date(ms); return `${d.getHours()}:${pad(d.getMinutes())}`; };
const sayDur = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60;
  return (h ? `${h}時間` : '') + (m || h ? `${m}分` : '') + (h ? '' : `${ss}秒`); };
const circled = n => '①②③④⑤⑥⑦⑧⑨⑩'[n - 1] || n;
function parseHMS(str) { const p = (str || '').trim().split(':').map(Number); if (p.some(isNaN) || !p.length) return null;
  while (p.length < 3) p.push(0); return p[0] * 3600 + p[1] * 60 + p[2]; }

// ---------- options ----------
const opt = Object.assign({ target: '', voice: true, every: 1, offAlert: true, offDist: 50, follow: true },
  JSON.parse(localStorage.getItem(LS_OPT) || '{}'));
const saveOpt = () => localStorage.setItem(LS_OPT, JSON.stringify(opt));

// ---------- state ----------
const fresh = () => ({ running: false, finished: false, startedAt: null, pausedTotal: 0, pauseAt: null,
  km: null, samples: [], laps: [], track: [], cutPass: {}, aidDone: {}, lastLapKm: 0, lastLapT: 0, sim: false });
let S = Object.assign(fresh(), JSON.parse(localStorage.getItem(LS_KEY) || '{}'));
let simMult = 0, simReal0 = 0, simVirt0 = 0;
const now = () => simMult ? simVirt0 + (Date.now() - simReal0) * simMult : Date.now();
const elapsed = () => !S.startedAt ? 0 : (((S.pauseAt || now()) - S.startedAt - S.pausedTotal) / 1000);
const save = () => { if (!simMult) localStorage.setItem(LS_KEY, JSON.stringify(S)); };

// ---------- map ----------
const map = L.map('map', { zoomControl: false, attributionControl: true }).setView(posAtKm(0), 14);
L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
  maxZoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>' }).addTo(map);
const latlngs = PTS.map(p => [p[0], p[1]]);
L.polyline(latlngs, { color: '#fff', weight: 9, opacity: .9 }).addTo(map);
const courseLine = L.polyline(latlngs, { color: '#e0313f', weight: 5, opacity: .95 }).addTo(map);
const doneLine = L.polyline([], { color: '#7a7f87', weight: 5, opacity: .95 }).addTo(map);
const label = (ll, html, cls, z = 0) => L.marker(ll, { icon: L.divIcon({ className: '', html: `<span class="${cls}">${html}</span>`, iconSize: null, iconAnchor: [10, 10] }), zIndexOffset: z, interactive: false }).addTo(map);
for (let k = 1; k <= 42; k++) {
  const ll = posAtKm(k);
  if (k % 5 === 0) label(ll, `${k}km`, 'kmlabel', 200);
  else L.circleMarker(ll, { radius: 3, color: '#c8102e', fillColor: '#fff', fillOpacity: 1, weight: 2, interactive: false }).addTo(map);
}
label(posAtKm(21.0975), '中間点', 'kmlabel', 200);
C.cutoffs.forEach(c => label(posAtKm(c.km), `関門${circled(c.no)} ${c.km}km ${c.time}`, 'cutlabel', 300));
C.aids.forEach(a => label(posAtKm(a.km), a.name.replace('給水所', '給水').replace('給食所', '給食'), 'aidlabel', 100));
label(posAtKm(0), 'START', 'sglabel', 400);
label(PTS[PTS.length - 1], 'GOAL', 'sglabel', 400);
const me = L.marker(posAtKm(0), { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 1000 });
const accCircle = L.circle(posAtKm(0), { radius: 10, color: '#2f8cff', weight: 1, fillOpacity: .12, interactive: false });
map.fitBounds(courseLine.getBounds(), { padding: [10, 10] });
let follow = opt.follow;
map.on('dragstart', () => { follow = false; });
const zoomCls = () => map.getContainer().classList.toggle('lowzoom', map.getZoom() < 15);
map.on('zoomend', zoomCls); zoomCls();
$('btnCenter').onclick = () => { follow = true; if (lastFix) map.setView([lastFix.lat, lastFix.lon], Math.max(map.getZoom(), 16)); else map.fitBounds(courseLine.getBounds()); };

// ---------- audio / voice ----------
let audioCtx = null;
function unlockAudio() {
  try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (e) {}
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) {}
}
let jaVoice = null;
const pickVoice = () => { const vs = speechSynthesis.getVoices(); jaVoice = vs.find(v => v.lang === 'ja-JP' && /Kyoko|O-ren|Otoya|Hattori/.test(v.name)) || vs.find(v => v.lang && v.lang.startsWith('ja')) || null; };
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function say(text, urgent = false) {
  if (!opt.voice || !('speechSynthesis' in window)) return;
  if (urgent || simMult) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = 'ja-JP'; u.rate = 1.05; if (jaVoice) u.voice = jaVoice;
  speechSynthesis.speak(u);
}
function beep(times = 3) {
  try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch (e) {}
  if (!audioCtx) return;
  for (let i = 0; i < times; i++) {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime + i * 0.35;
    o.type = 'square'; o.frequency.value = 1320; g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 0.26);
  }
}
function toast(msg, ms = 2200) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), ms); }

// ---------- wake lock ----------
let wakeLock = null;
async function keepAwake() { try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.running) keepAwake(); });

// ---------- GPS ----------
let lastFix = null, offSince = null, offWarned = 0, isOff = false, offDistNow = 0, watchId = null;
function startGps() {
  if (watchId !== null || !navigator.geolocation) return;
  watchId = navigator.geolocation.watchPosition(p => onFix(p.coords.latitude, p.coords.longitude, p.coords.accuracy, now()),
    e => { $('gpsBadge').textContent = e.code === 1 ? '位置情報が許可されていません' : 'GPS取得エラー'; },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
}
function stopGps() { if (watchId !== null) navigator.geolocation.clearWatch(watchId); watchId = null; }

function onFix(lat, lon, acc, t) {
  const prev = lastFix;
  lastFix = { lat, lon, acc, t };
  if (!map.hasLayer(me)) { me.addTo(map); accCircle.addTo(map); }
  me.setLatLng([lat, lon]); accCircle.setLatLng([lat, lon]).setRadius(acc);
  $('gpsBadge').textContent = `GPS 精度 ±${Math.round(acc)}m` + (acc > 40 ? '（低）' : '');
  if (follow) { if (!prev) map.setView([lat, lon], 16); else map.panTo([lat, lon], { animate: !simMult }); }

  const tol = opt.offDist + Math.min(acc, 30);
  if (!S.running || S.km === null) {
    if (!S.startedAt) {
      const ds = hav([lat, lon], posAtKm(0));
      $('nextAid').innerHTML = ds > 150 ? `スタート地点まで <b>${ds > 1000 ? (ds / 1000).toFixed(1) + 'km' : Math.round(ds) + 'm'}</b>` : '<b>スタート地点です</b>';
    }
    return;
  }
  if (S.pauseAt) return;
  // track log
  if (!prev || hav([prev.lat, prev.lon], [lat, lon]) > 8) { S.track.push([+lat.toFixed(6), +lon.toFixed(6), Math.round(t / 1000)]); }

  // snap to course with a progress window (handles the overlapping 2-lap sections)
  const cur = S.km;
  let n = nearest(lat, lon, cur - 0.3, cur + 1.5);
  if (n.d > tol) { const g = nearest(lat, lon, cur - 0.3, cur + 6); if (g.d < n.d) n = g; }
  offDistNow = n.d;
  if (n.d <= tol && acc < 80) {
    const dtS = prev ? Math.max(1, (t - prev.t) / 1000) : 5;
    const maxAdv = (dtS * 9 + 80) / 1000;               // plausibility: ≤ ~9 m/s
    let nk = n.km;
    if (nk < cur) nk = cur;
    nk = Math.min(nk, cur + maxAdv);
    setKm(nk, t);
    if (isOff) { isOff = false; offSince = null; $('warn').classList.add('hidden'); if (opt.offAlert) say('コースに戻りました'); }
  } else {
    if (!offSince) offSince = t;
    if (t - offSince > 8000 && opt.offAlert) {
      if (!isOff) { isOff = true; offWarned = 0; }
      $('warn').classList.remove('hidden'); $('warnDist').textContent = `（コースまで約${Math.round(n.d)}m）`;
      if (t - offWarned > 30000 * (simMult ? simMult / 10 : 1)) { offWarned = t; beep(); say(`コースから外れています。コースまで約${Math.round(n.d / 10) * 10}メートルです`, true); }
    }
  }
}

function setKm(nk, t) {
  const old = S.km; S.km = nk;
  S.samples.push([t, nk]); while (S.samples.length > 2 && t - S.samples[0][0] > 120000) S.samples.shift();
  // km splits
  for (let k = Math.floor(old) + 1; k <= Math.floor(nk) && k <= 42; k++) {
    const frac = (k - old) / ((nk - old) || 1);
    const tk = (S.samples.length > 1 ? S.samples[S.samples.length - 2][0] : t);
    const tc = tk + (t - tk) * frac;
    const el = (tc - S.startedAt - S.pausedTotal) / 1000;
    const lap = el - S.lastLapT; S.lastLapT = el; S.lastLapKm = k;
    S.laps.push({ km: k, lap, el, clock: tc });
    if (opt.voice && k % opt.every === 0) {
      say(`${k}キロ通過。ラップ ${sayDur(opt.every === 1 ? lap : el / k * opt.every)}。経過 ${sayDur(el)}。平均ペース ${sayDur(el / k)}。`);
    }
  }
  if (old < 21.0975 && nk >= 21.0975) say(`中間点です。経過 ${sayDur(elapsed())}`);
  // cutoffs
  C.cutoffs.forEach((c, i) => { if (!S.cutPass[i] && old < c.km && nk >= c.km) {
    S.cutPass[i] = t; const m = Math.round((cutMs(c) - t) / 60000);
    say(`第${c.no}関門 通過。閉鎖まで ${m}分 の余裕です。`);
  }});
  // aid stations ahead
  C.aids.forEach((a, i) => { if (!S.aidDone[i] && a.km - nk <= 0.3 && a.km - nk > -0.05) { S.aidDone[i] = 1;
    say(`まもなく${a.name.replace('・給食', 'と給食')}です。${a.food.replace(/・/g, '、')}`); } });
  // finish
  if (nk >= TOTAL - 0.03 && !S.finished) finishRun(true);
  render(); if (S.track.length % 10 === 0) save();
}

function cutMs(c) { const [h, m] = c.time.split(':').map(Number); const d = new Date(now()); d.setHours(h, m, 0, 0); return d.getTime(); }

function curPace() {
  const sm = S.samples; if (sm.length < 2) return NaN;
  const last = sm[sm.length - 1]; let j = sm.length - 2;
  while (j > 0 && last[0] - sm[j][0] < 60000) j--;
  const dk = last[1] - sm[j][1], dt = (last[0] - sm[j][0]) / 1000;
  return dk > 0.03 ? dt / dk : NaN;
}

// ---------- render ----------
function render() {
  const el = elapsed(), km = S.km || 0;
  $('sKm').textContent = km.toFixed(2);
  $('sTime').textContent = fmtHMS(el);
  $('sPace').textContent = fmtPace(curPace());
  const avg = km > 0.2 ? el / km : NaN;
  $('sAvg').textContent = fmtPace(avg);
  $('sRemain').textContent = Math.max(0, TOTAL - km).toFixed(2);
  const tgt = parseHMS(opt.target);
  const pace = km > 1 ? avg : (tgt ? tgt / TOTAL : NaN);
  $('sPred').textContent = isFinite(pace) && S.startedAt ? fmtHMS(el + (TOTAL - km) * pace).slice(0, -3) : '--:--';
  // done line
  if (S.km !== null) { const done = []; for (const p of PTS) { if (p[2] > km) break; done.push([p[0], p[1]]); } done.push(posAtKm(km)); doneLine.setLatLngs(done); }
  if (!S.running && !S.startedAt) return;
  // next cutoff
  const ci = C.cutoffs.findIndex((c, i) => !S.cutPass[i] && c.km > km);
  if (ci >= 0) {
    const c = C.cutoffs[ci], eta = now() + (c.km - km) * (isFinite(pace) ? pace : 420) * 1000, mg = Math.round((cutMs(c) - eta) / 60000);
    $('nextCut').innerHTML = `関門${circled(c.no)} ${c.km}km <b>${c.time}</b>閉鎖<br>あと${(c.km - km).toFixed(1)}km 予測${fmtClock(eta)} <span class="${mg >= 5 ? 'ok' : 'ng'}">${mg >= 0 ? '余裕' + mg + '分' : mg + '分 超過'}</span>`;
  } else $('nextCut').innerHTML = '関門 すべて通過';
  const ai = C.aids.findIndex(a => a.km > km + 0.02);
  if (ai >= 0) { const a = C.aids[ai]; $('nextAid').innerHTML = `${a.name} <b>あと${(a.km - km).toFixed(1)}km</b><br><small>${a.food}</small>`; }
  else $('nextAid').innerHTML = `ゴールまで <b>${(TOTAL - km).toFixed(2)}km</b>`;
}
setInterval(() => { if (S.running && !S.pauseAt) { $('sTime').textContent = fmtHMS(elapsed()); } }, 250);
setInterval(() => { if (S.running) { render(); save(); } }, 5000);

// ---------- controls ----------
function updateButtons() {
  const b = $('btnStart');
  if (!S.running) { b.textContent = S.finished ? '完走！' : (S.startedAt ? '再開' : 'スタート'); b.classList.remove('pause'); }
  else if (S.pauseAt) { b.textContent = '再開'; b.classList.remove('pause'); }
  else { b.textContent = '一時停止'; b.classList.add('pause'); }
  $('btnStop').classList.toggle('hidden', !S.startedAt || S.finished);
}
$('btnStart').onclick = () => {
  unlockAudio(); keepAwake(); startGps();
  if (S.finished) { openLaps(); return; }
  const t = now();
  if (!S.startedAt) {
    S.startedAt = t; S.running = true;
    let k0 = 0;
    if (lastFix) { const n = nearest(lastFix.lat, lastFix.lon, 0, 3); if (n.d < opt.offDist + 30) k0 = n.km; }
    S.km = k0; S.samples = [[t, k0]]; S.lastLapKm = 0; S.lastLapT = 0;
    say('スタート！ 吉備路マラソン、楽しんでいきましょう。', true);
  } else if (S.pauseAt) { S.pausedTotal += t - S.pauseAt; S.pauseAt = null; S.running = true; say('再開します'); }
  else if (S.running) { S.pauseAt = t; say('一時停止しました'); }
  else { S.running = true; }
  updateButtons(); render(); save();
};
$('btnStop').onclick = () => { if (confirm('ランを終了しますか？')) finishRun(false); };
function finishRun(auto) {
  if (!S.pauseAt) S.pauseAt = now();
  S.running = false; S.finished = true;
  const el = elapsed();
  say(auto ? `ゴール！ おめでとうございます。タイムは ${sayDur(el)} です。` : `終了しました。記録は ${sayDur(el)} です。`, true);
  updateButtons(); render(); save(); setTimeout(openLaps, 1500);
}

// sheets
const openSheet = id => $(id).classList.remove('hidden');
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(b.dataset.close).classList.add('hidden'));
function openLaps() {
  const tb = $('lapTable').querySelector('tbody');
  tb.innerHTML = S.laps.map(l => `<tr><td>${l.km}</td><td>${fmtPace(l.lap)}</td><td>${fmtHMS(l.el)}</td><td>${fmtClock(l.clock)}</td></tr>`).join('') || '<tr><td colspan="4">まだ記録がありません</td></tr>';
  $('cutTable').querySelector('tbody').innerHTML = C.cutoffs.map((c, i) => { const p = S.cutPass[i];
    return `<tr><td>${circled(c.no)}</td><td>${c.km.toFixed(1)}</td><td>${c.time}</td><td>${p ? fmtClock(p) + `（${Math.round((cutMs(c) - p) / 60000)}分前）` : '-'}</td></tr>`; }).join('');
  openSheet('sheetLaps');
}
$('btnLaps').onclick = openLaps;
$('btnMenu').onclick = () => openSheet('sheetMenu');

// options
$('optTarget').value = opt.target; $('optVoice').checked = opt.voice; $('optVoiceEvery').value = opt.every;
$('optOffAlert').checked = opt.offAlert; $('optOffDist').value = opt.offDist; $('optFollow').checked = opt.follow;
$('optTarget').onchange = e => { opt.target = e.target.value; saveOpt(); render(); };
$('optVoice').onchange = e => { opt.voice = e.target.checked; saveOpt(); };
$('optVoiceEvery').onchange = e => { opt.every = +e.target.value; saveOpt(); };
$('optOffAlert').onchange = e => { opt.offAlert = e.target.checked; saveOpt(); };
$('optOffDist').onchange = e => { opt.offDist = +e.target.value; saveOpt(); };
$('optFollow').onchange = e => { opt.follow = follow = e.target.checked; saveOpt(); };
$('btnTestVoice').onclick = () => { unlockAudio(); say('5キロ通過。ラップ 5分30秒。音声案内は正常です。', true); setTimeout(() => beep(2), 100); };
$('btnReset').onclick = () => { if (!confirm('記録をリセットしますか？')) return; if (simMult) stopSim(); S = fresh(); localStorage.removeItem(LS_KEY); doneLine.setLatLngs([]); updateButtons(); render(); $('nextCut').textContent = '関門 --'; $('nextAid').textContent = '給水 --'; $('warn').classList.add('hidden'); toast('リセットしました'); };

// GPX export
$('btnGpx').onclick = async () => {
  if (!S.track.length) { toast('走行ログがありません'); return; }
  const pts = S.track.map(p => `<trkpt lat="${p[0]}" lon="${p[1]}"><time>${new Date(p[2] * 1000).toISOString()}</time></trkpt>`).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Kibiji Run Navi" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>吉備路マラソン</name><trkseg>\n${pts}\n</trkseg></trk></gpx>`;
  const file = new File([gpx], 'kibiji-run.gpx', { type: 'application/gpx+xml' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: '吉備路マラソン走行ログ' }); return; } catch (e) {} }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = 'kibiji-run.gpx'; a.click();
};

// ---------- offline tiles ----------
$('btnTiles').onclick = async () => {
  const tiles = new Set();
  const tileOf = (lat, lon, z) => { const n = 2 ** z, x = Math.floor((lon + 180) / 360 * n), r = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); return `${z}/${x}/${y}`; };
  for (let km = 0; km <= TOTAL; km += 0.1) {
    const [la, lo] = posAtKm(km);
    for (const z of [12, 13, 14, 15, 16, 17]) {
      const off = z >= 16 ? [-0.002, 0, 0.002] : [0];
      for (const a of off) for (const b of off) tiles.add(tileOf(la + a, lo + b * 1.2, z));
    }
  }
  const list = [...tiles]; let done = 0, fail = 0; const prog = $('tileProg');
  $('btnTiles').disabled = true;
  const worker = async () => { while (list.length) { const t = list.pop();
    try { await fetch(`https://cyberjapandata.gsi.go.jp/xyz/std/${t}.png`, { mode: 'no-cors' }); } catch (e) { fail++; }
    done++; if (done % 10 === 0) prog.textContent = `保存中… ${done}/${tiles.size}`; } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  prog.textContent = `保存完了：${done - fail}枚（失敗${fail}）。電波が弱くても地図が表示されます。`;
  $('btnTiles').disabled = false;
};

// ---------- simulation ----------
let simTimer = null;
$('btnSim').onclick = () => {
  if (simMult) { stopSim(); return; }
  if (S.startedAt && !S.sim && !confirm('現在の記録はシミュレーション終了後も残りますが、デモ中は表示が切り替わります。開始しますか？')) return;
  unlockAudio();
  simMult = +$('optSimSpeed').value; simReal0 = Date.now();
  const d = new Date(); d.setHours(9, 20, 0, 0); simVirt0 = d.getTime();
  S = fresh(); S.sim = true; stopGps(); lastFix = null; follow = true;
  $('sheetMenu').classList.add('hidden'); $('btnSim').textContent = 'シミュレーション停止';
  const paceS = 330; // 5'30"/km
  onFix(...posAtKm(0), 5, now());
  $('btnStart').click();
  simTimer = setInterval(() => {
    const el = elapsed(); let km = el / paceS; if (km > TOTAL) km = TOTAL;
    let [la, lo] = posAtKm(km);
    if (km > 2.6 && km < 2.95) { lo += 0.0012; }                 // わざとコースを外れて警告をテスト
    la += (Math.random() - .5) * 0.00008; lo += (Math.random() - .5) * 0.0001;
    onFix(la, lo, 6 + Math.random() * 6, now());
  }, 1000);
  toast(`デモ開始：${simMult}倍速・5分30秒/kmで走行します`);
};
function stopSim() {
  clearInterval(simTimer); simTimer = null; simMult = 0; $('btnSim').textContent = 'シミュレーション走行（デモ）';
  S = Object.assign(fresh(), JSON.parse(localStorage.getItem(LS_KEY) || '{}')); lastFix = null;
  updateButtons(); render(); startGps();
}

// ---------- boot ----------
if (S.startedAt && S.running && !S.pauseAt) toast('前回の記録から再開しています');
updateButtons(); render(); startGps();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
window.__kibiji = { nearest, posAtKm, onFix, get S() { return S; } };
})();
