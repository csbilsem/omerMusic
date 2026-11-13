'use strict';

/* =========================================================
   Çokgensel Silindir — çokgensel sayılarla müzik kutusu
   Bağımlılık yok: Canvas 2D + Web Audio API
   ========================================================= */

// ---------- Sabitler ----------
const LAYER_INFO = {
  3:  { ad: 'Üçgensel',    renk: '#ff6b6b' },
  4:  { ad: 'Karesel',     renk: '#ffd166' },
  5:  { ad: 'Beşgensel',   renk: '#06d6a0' },
  6:  { ad: 'Altıgensel',  renk: '#4cc9f0' },
  7:  { ad: 'Yedigensel',  renk: '#b388ff' },
  8:  { ad: 'Sekizgensel', renk: '#ff9f1c' },
  9:  { ad: 'Dokuzgensel', renk: '#f15bb5' },
  10: { ad: 'Ongensel',    renk: '#9ef01a' },
};
const MANUAL_COLOR = '#f3ece2';

const SCALES = {
  pentaMaj: { ad: 'Majör pentatonik', iv: [0, 2, 4, 7, 9] },
  pentaMin: { ad: 'Minör pentatonik', iv: [0, 3, 5, 7, 10] },
  major:    { ad: 'Majör',            iv: [0, 2, 4, 5, 7, 9, 11] },
  minor:    { ad: 'Doğal minör',      iv: [0, 2, 3, 5, 7, 8, 10] },
  hicaz:    { ad: 'Hicaz (12-TET yaklaşık)', iv: [0, 1, 4, 5, 7, 8, 10] },
  wholeTone:{ ad: 'Tam ton',          iv: [0, 2, 4, 6, 8, 10] },
  chromatic:{ ad: 'Kromatik',         iv: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};
const NOTE_NAMES = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const BASE_MIDI = 72; // Do5 — müzik kutusu tınısı için tiz bölge

const MODE_HELP = {
  residue: 'Her adımda n bir artar; çivi P(s,n) mod nota_sayısı satırına düşer.',
  helix: 'Sayılar silindire sarmal sarılır; P(s,n) değeri çevre ve satıra göre yer bulur.',
};

/** s kenarlı n. çokgensel sayı */
const P = (s, n) => ((s - 2) * n * n - (s - 4) * n) / 2;

// ---------- Durum ----------
const state = {
  layers: [3, 4, 5],
  mode: 'residue',
  steps: 32,
  scale: 'pentaMaj',
  root: 0,
  octaves: 2,
  start: 1,
  tempo: 96,
  edits: new Set(), // "t,r" — hesaplanan desene göre elle değiştirilen hücreler (XOR)
};

let rows = 11;
let rowMidi = [];
let cols = [];   // cols[t] = [{ t, r, items:[{s,n,p}] }]

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const drum = $('drum');
const dctx = drum.getContext('2d');
const poly = $('poly');
const pctx = poly.getContext('2d');

// =========================================================
// Desen hesabı
// =========================================================
function rebuild() {
  const iv = SCALES[state.scale].iv;
  rows = iv.length * state.octaves + 1;
  rowMidi = [];
  for (let i = 0; i < rows; i++) {
    rowMidi.push(BASE_MIDI + state.root + iv[i % iv.length] + 12 * Math.floor(i / iv.length));
  }

  const grid = new Map();
  const add = (t, r, item) => {
    const k = t + ',' + r;
    if (!grid.has(k)) grid.set(k, { t, r, items: [] });
    if (item) grid.get(k).items.push(item);
  };

  const cap = state.steps * rows;
  for (const s of state.layers) {
    for (let i = 0; i < state.steps; i++) {
      const n = state.start + i;
      const p = P(s, n);
      if (state.mode === 'residue') {
        add(i, p % rows, { s, n, p });
      } else {
        const v = p % cap;
        add(v % state.steps, Math.floor(v / state.steps), { s, n, p });
      }
    }
  }

  // Elle yapılan değişiklikler: varsa kaldır, yoksa ekle
  for (const k of state.edits) {
    const [t, r] = k.split(',').map(Number);
    if (t >= state.steps || r >= rows) continue;
    if (grid.has(k)) grid.delete(k);
    else add(t, r, null);
  }

  cols = Array.from({ length: state.steps }, () => []);
  for (const cell of grid.values()) cols[cell.t].push(cell);

  renderSeqTable();
  saveHash();
}

// =========================================================
// Ses (Web Audio)
// =========================================================
let actx = null, master = null;

function ensureAudio() {
  if (actx) return actx;
  actx = new (window.AudioContext || window.webkitAudioContext)();
  const comp = actx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master = actx.createGain();
  master.gain.value = 0.9;

  // Hafif yankı için geri beslemeli gecikme
  const delay = actx.createDelay(1);
  delay.delayTime.value = 0.23;
  const fb = actx.createGain(); fb.gain.value = 0.28;
  const wet = actx.createGain(); wet.gain.value = 0.22;
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3500;
  master.connect(comp);
  master.connect(delay);
  delay.connect(lp); lp.connect(fb); fb.connect(delay);
  lp.connect(wet); wet.connect(comp);
  comp.connect(actx.destination);
  return actx;
}

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Müzik kutusu dişi: temel + inharmonik üst kısmi + kısa "tık" */
function pluck(midi, time, vel = 0.2) {
  const f = midiToFreq(midi);
  const out = actx.createGain();
  out.connect(master);

  const partials = [
    [1, vel, 2.4],
    [2.76, vel * 0.35, 0.6],
    [5.4, vel * 0.18, 0.18],
  ];
  for (const [ratio, amp, dec] of partials) {
    const o = actx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * ratio;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(amp, time + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dec);
    o.connect(g); g.connect(out);
    o.start(time);
    o.stop(time + dec + 0.05);
  }
}

// =========================================================
// Çalma / zamanlama
// =========================================================
let playing = false;
let startTime = 0;   // pos = (now - startTime) / stepDur
let nextK = 0;       // sıradaki planlanacak adım (sürekli artar)
let pausedPos = 0;   // dururken silindirin konumu (adım cinsinden)
let timer = null;
const events = [];   // görsel tetikler {time, k}
const flash = [];    // satır başına parlama değeri

const stepDur = () => 60 / state.tempo / 2; // sekizlik nota

function currentPos() {
  if (!playing) return pausedPos;
  return (actx.currentTime - startTime) / stepDur();
}

function play() {
  ensureAudio();
  if (actx.state === 'suspended') actx.resume();
  playing = true;
  startTime = actx.currentTime + 0.05 - pausedPos * stepDur();
  nextK = Math.ceil(pausedPos - 1e-6);
  timer = setInterval(schedule, 25);
  schedule();
  $('play').textContent = '■ Durdur';
}

function stop() {
  pausedPos = currentPos();
  playing = false;
  clearInterval(timer);
  events.length = 0;
  $('play').textContent = '▶ Çal';
}

function schedule() {
  const ahead = actx.currentTime + 0.12;
  while (startTime + nextK * stepDur() < ahead) {
    const time = startTime + nextK * stepDur();
    const t = ((nextK % state.steps) + state.steps) % state.steps;
    const cells = cols[t];
    if (cells.length) {
      const uniq = [...new Set(cells.map((c) => c.r))];
      const vel = 0.22 / Math.sqrt(uniq.length);
      for (const r of uniq) pluck(rowMidi[r], Math.max(time, actx.currentTime), vel);
      events.push({ time, t });
    }
    nextK++;
  }
}

function setTempo(v) {
  if (playing) {
    const pos = currentPos();
    state.tempo = v;
    startTime = actx.currentTime - pos * stepDur();
  } else {
    state.tempo = v;
  }
  $('tempoOut').textContent = v;
  saveHash();
}

// =========================================================
// Silindir çizimi
// =========================================================
let geo = null;

function resizeDrum() {
  const dpr = window.devicePixelRatio || 1;
  const w = drum.clientWidth, h = drum.clientHeight;
  if (drum.width !== Math.round(w * dpr) || drum.height !== Math.round(h * dpr)) {
    drum.width = Math.round(w * dpr);
    drum.height = Math.round(h * dpr);
  }
  dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const R = Math.min(h * 0.33, 230);
  const capRx = R * 0.16;
  geo = {
    w, h, R, capRx,
    x0: 28 + capRx, x1: w - 28 - capRx,
    cy: h * 0.44,
  };
}

const rowX = (r) => geo.x0 + (r + 0.5) * (geo.x1 - geo.x0) / rows;

function drawDrum(now) {
  resizeDrum();
  const { w, h, R, capRx, x0, x1, cy } = geo;
  const ctx = dctx;
  ctx.clearRect(0, 0, w, h);
  const pos = now;

  // Gölge
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath();
  ctx.ellipse((x0 + x1) / 2, cy + R + 52, (x1 - x0) / 2 + 30, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  // Sol uç kapağı (arka)
  drawCap(x0, cy, capRx, R, false);

  // Gövde (pirinç)
  const g = ctx.createLinearGradient(0, cy - R, 0, cy + R);
  g.addColorStop(0, '#3b2a12');
  g.addColorStop(0.22, '#a07a32');
  g.addColorStop(0.42, '#f1d189');
  g.addColorStop(0.58, '#c99a45');
  g.addColorStop(1, '#2a1d0b');
  ctx.fillStyle = g;
  ctx.fillRect(x0, cy - R, x1 - x0, 2 * R);

  // Satır halkaları
  ctx.strokeStyle = 'rgba(40,25,5,.22)';
  ctx.lineWidth = 1;
  for (let r = 0; r <= rows; r++) {
    const x = x0 + r * (x1 - x0) / rows;
    ctx.beginPath(); ctx.moveTo(x, cy - R); ctx.lineTo(x, cy + R); ctx.stroke();
  }

  // Sütun çizgileri + çiviler (derinliğe göre sırala)
  const pins = [];
  for (let t = 0; t < state.steps; t++) {
    let d = t - pos;
    d = ((d % state.steps) + state.steps) % state.steps;
    if (d > state.steps / 2) d -= state.steps;
    const th = (2 * Math.PI * d) / state.steps;
    const z = Math.cos(th);
    if (z <= 0.02) continue;
    const y = cy - R * Math.sin(th);
    ctx.strokeStyle = `rgba(50,30,5,${0.08 + 0.18 * z})`;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    for (const c of cols[t]) pins.push({ c, y, z });
  }
  pins.sort((a, b) => a.z - b.z);
  const cell = (x1 - x0) / rows;
  const base = Math.max(3, Math.min(9, cell * 0.28, (Math.PI * R / state.steps) * 0.42));
  for (const { c, y, z } of pins) {
    const x = rowX(c.r);
    const rad = base * (0.45 + 0.55 * z);
    const cols2 = c.items.length ? [...new Set(c.items.map((i) => LAYER_INFO[i.s].renk))] : [MANUAL_COLOR];
    // gölge
    ctx.fillStyle = `rgba(20,10,0,${0.35 * z})`;
    ctx.beginPath(); ctx.arc(x + 1.5, y + 2, rad, 0, Math.PI * 2); ctx.fill();
    // renk dilimleri
    if (cols2.length === 1) {
      ctx.fillStyle = cols2[0];
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    } else {
      const step = (Math.PI * 2) / cols2.length;
      cols2.forEach((col, i) => {
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(x, y);
        ctx.arc(x, y, rad, -Math.PI / 2 + i * step, -Math.PI / 2 + (i + 1) * step);
        ctx.closePath(); ctx.fill();
      });
    }
    if (!c.items.length) {
      ctx.strokeStyle = '#1b140c'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, rad * 0.45, 0, Math.PI * 2); ctx.stroke();
    }
    // parlama
    ctx.fillStyle = `rgba(255,255,255,${0.35 * z})`;
    ctx.beginPath(); ctx.arc(x - rad * 0.3, y - rad * 0.35, rad * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Ön/arka kararma (silindir hissi)
  const shade = ctx.createLinearGradient(0, cy - R, 0, cy + R);
  shade.addColorStop(0, 'rgba(10,6,2,.55)');
  shade.addColorStop(0.25, 'rgba(10,6,2,0)');
  shade.addColorStop(0.75, 'rgba(10,6,2,0)');
  shade.addColorStop(1, 'rgba(10,6,2,.6)');
  ctx.fillStyle = shade;
  ctx.fillRect(x0, cy - R, x1 - x0, 2 * R);

  // Sağ uç kapağı (ön)
  drawCap(x1, cy, capRx, R, true);

  // Tarak: taban + dişler
  const combY = cy + R + 26;
  const steel = ctx.createLinearGradient(0, combY - 6, 0, combY + 12);
  steel.addColorStop(0, '#d9dde2'); steel.addColorStop(1, '#6d737a');
  ctx.fillStyle = steel;
  ctx.fillRect(x0 - 6, combY, x1 - x0 + 12, 12);
  for (let r = 0; r < rows; r++) {
    const x = rowX(r);
    const f = flash[r] || 0;
    ctx.strokeStyle = f > 0.02 ? `rgba(255,${200 + 55 * f},${120 + 80 * f},${0.55 + 0.45 * f})` : 'rgba(200,205,212,.55)';
    ctx.lineWidth = 2 + 2 * f;
    ctx.beginPath(); ctx.moveTo(x, combY); ctx.lineTo(x, cy + 1); ctx.stroke();
    if (f > 0.02) {
      ctx.fillStyle = `rgba(255,230,160,${0.6 * f})`;
      ctx.beginPath(); ctx.arc(x, cy, 6 + 10 * f, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Çalma çizgisi
  ctx.strokeStyle = 'rgba(255,235,190,.35)';
  ctx.setLineDash([4, 5]);
  ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x1, cy); ctx.stroke();
  ctx.setLineDash([]);

  // Nota adları
  ctx.fillStyle = '#b2a493';
  ctx.font = `${Math.max(9, Math.min(12, cell * 0.36))}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'center';
  for (let r = 0; r < rows; r++) {
    const m = rowMidi[r];
    ctx.fillText(NOTE_NAMES[m % 12], rowX(r), combY + 28);
    ctx.fillStyle = 'rgba(178,164,147,.55)';
    ctx.fillText(String(Math.floor(m / 12) - 1), rowX(r), combY + 42);
    ctx.fillStyle = '#b2a493';
  }

  // Adım göstergesi
  const tNow = ((Math.round(pos) % state.steps) + state.steps) % state.steps;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(243,236,226,.7)';
  ctx.font = '12px "JetBrains Mono", monospace';
  ctx.fillText(`adım ${String(tNow + 1).padStart(2, '0')}/${state.steps}`, 14, 22);
}

function drawCap(x, cy, rx, R, front) {
  const ctx = dctx;
  const g = ctx.createRadialGradient(x - rx * 0.3, cy - R * 0.3, 2, x, cy, R);
  g.addColorStop(0, front ? '#e7c47a' : '#7a5a22');
  g.addColorStop(1, front ? '#5a3f15' : '#2a1c08');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(x, cy, rx, R, 0, 0, Math.PI * 2); ctx.fill();
  if (front) {
    ctx.fillStyle = '#2a1d0b';
    ctx.beginPath(); ctx.ellipse(x, cy, rx * 0.25, R * 0.08, 0, 0, Math.PI * 2); ctx.fill();
  }
}

// =========================================================
// Çokgen nokta çizimi (son vurulan sayı)
// =========================================================
function polyDots(s, n) {
  const pts = new Map();
  const put = (x, y, k) => {
    const key = Math.round(x * 1000) + ',' + Math.round(y * 1000);
    if (!pts.has(key)) pts.set(key, { x, y, k });
  };
  const ext = (2 * Math.PI) / s;
  for (let k = 1; k <= n; k++) {
    const L = k - 1;
    if (L === 0) { put(0, 0, k); continue; }
    let x = 0, y = 0;
    for (let j = 0; j < s; j++) {
      const a = j * ext;
      for (let i = 0; i < L; i++) {
        put(x, y, k);
        x += Math.cos(a); y += Math.sin(a);
      }
    }
  }
  return [...pts.values()];
}

let lastShown = null;

function showNumber(item) {
  lastShown = item;
  const W = poly.width, H = poly.height;
  pctx.clearRect(0, 0, W, H);
  const label = $('polyLabel');
  if (!item) {
    label.textContent = 'Elle eklenmiş çivi';
    return;
  }
  const { s, n, p } = item;
  const info = LAYER_INFO[s];
  label.innerHTML = `<span style="color:${info.renk}">${info.ad}</span> · P(${s}, ${n}) = <b>${p}</b>`;
  if (n > 40) {
    pctx.fillStyle = info.renk;
    pctx.font = 'bold 42px "Fraunces", serif';
    pctx.textAlign = 'center';
    pctx.fillText(p.toLocaleString('tr-TR'), W / 2, H / 2 + 14);
    return;
  }
  const pts = polyDots(s, n);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const q of pts) {
    minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
    minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
  }
  const pad = 22;
  const spanX = Math.max(maxX - minX, 1), spanY = Math.max(maxY - minY, 1);
  const sc = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY, 40);
  const ox = W / 2 - ((minX + maxX) / 2) * sc;
  const oy = H / 2 + ((minY + maxY) / 2) * sc;
  const rad = Math.max(1.5, Math.min(7, sc * 0.3));
  for (const q of pts) {
    const X = ox + q.x * sc, Y = oy - q.y * sc;
    pctx.fillStyle = q.k === n ? info.renk : 'rgba(243,236,226,.35)';
    pctx.beginPath(); pctx.arc(X, Y, rad, 0, Math.PI * 2); pctx.fill();
  }
}

// =========================================================
// Dizi tablosu
// =========================================================
function residuePeriod(s, m) {
  // P(s,n) mod m periyodiktir; periyot 2m'yi böler
  const seq = [];
  for (let n = 1; n <= 4 * m; n++) seq.push(P(s, n) % m);
  for (let per = 1; per <= 2 * m; per++) {
    let ok = true;
    for (let i = 0; i + per < seq.length; i++) if (seq[i] !== seq[i + per]) { ok = false; break; }
    if (ok) return per;
  }
  return 2 * m;
}

function renderSeqTable() {
  const el = $('seqTable');
  if (!state.layers.length) { el.innerHTML = '<p class="small">Bir katman seç.</p>'; return; }
  let html = `<table><thead><tr><th>Katman</th><th>İlk terimler (n = ${state.start}…)</th><th>mod ${rows} periyodu</th></tr></thead><tbody>`;
  for (const s of state.layers) {
    const info = LAYER_INFO[s];
    const vals = [];
    for (let i = 0; i < 10; i++) vals.push(P(s, state.start + i));
    html += `<tr><td><span class="sw" style="background:${info.renk}"></span>${info.ad} (s=${s})</td>` +
      `<td>${vals.join(', ')}…</td><td>${residuePeriod(s, rows)}</td></tr>`;
  }
  el.innerHTML = html + '</tbody></table>';
}

// =========================================================
// Etkileşim: tıkla / sürükle
// =========================================================
let drag = null;

drum.addEventListener('pointerdown', (e) => {
  drum.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, startPos: pausedPos, moved: false };
});

drum.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dy = e.clientY - drag.y;
  if (Math.abs(dy) + Math.abs(e.clientX - drag.x) > 5) drag.moved = true;
  if (drag.moved && !playing) {
    pausedPos = drag.startPos + (dy / geo.R) * (state.steps / (2 * Math.PI));
  }
});

drum.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const wasClick = !drag.moved;
  drag = null;
  if (!wasClick) return;
  const rect = drum.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const { x0, x1, cy, R } = geo;
  if (x < x0 || x > x1 || y < cy - R || y > cy + R) return;
  const r = Math.floor(((x - x0) / (x1 - x0)) * rows);
  const th = Math.asin(Math.max(-1, Math.min(1, (cy - y) / R)));
  const t = ((Math.round(currentPos() + (th * state.steps) / (2 * Math.PI)) % state.steps) + state.steps) % state.steps;
  const key = t + ',' + r;
  if (state.edits.has(key)) state.edits.delete(key); else state.edits.add(key);
  const nowHas = cols[t].some((c) => c.r === r);
  rebuild();
  if (!nowHas) {
    ensureAudio();
    if (actx.state === 'suspended') actx.resume();
    pluck(rowMidi[r], actx.currentTime + 0.01, 0.2);
  }
});

// =========================================================
// MIDI dışa aktarma
// =========================================================
function exportMidi(loops = 2) {
  const tpq = 480, stepT = 240;
  const ev = [];
  for (let L = 0; L < loops; L++) {
    for (let t = 0; t < state.steps; t++) {
      const uniq = [...new Set(cols[t].map((c) => c.r))];
      for (const r of uniq) {
        const m = rowMidi[r];
        const at = (L * state.steps + t) * stepT;
        ev.push([at, 0x90, m, 90, 0]);          // nota aç
        ev.push([at + stepT, 0x80, m, 0, 1]);   // nota kapat
      }
    }
  }
  ev.sort((a, b) => a[0] - b[0] || b[4] - a[4]); // aynı anda önce kapat

  const trk = [];
  const vlq = (v) => {
    const b = [v & 0x7f];
    while ((v >>= 7)) b.unshift((v & 0x7f) | 0x80);
    trk.push(...b);
  };
  const uspq = Math.round(60000000 / state.tempo);
  vlq(0); trk.push(0xff, 0x51, 0x03, (uspq >> 16) & 255, (uspq >> 8) & 255, uspq & 255);
  vlq(0); trk.push(0xc0, 10); // GM 11: Music Box
  let last = 0;
  for (const [at, st, m, v] of ev) {
    vlq(at - last); last = at;
    trk.push(st, m, v);
  }
  vlq(0); trk.push(0xff, 0x2f, 0x00);

  const str = (s) => [...s].map((c) => c.charCodeAt(0));
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const bytes = [
    ...str('MThd'), ...u32(6), 0, 0, 0, 1, (tpq >> 8) & 255, tpq & 255,
    ...str('MTrk'), ...u32(trk.length), ...trk,
  ];
  const blob = new Blob([new Uint8Array(bytes)], { type: 'audio/midi' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cokgensel-silindir-${state.layers.join('-')}-${state.mode}.mid`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// =========================================================
// URL'de durum saklama (paylaşılabilir bağlantı)
// =========================================================
function saveHash() {
  const q = new URLSearchParams({
    l: state.layers.join('.'),
    m: state.mode,
    st: state.steps,
    sc: state.scale,
    ro: state.root,
    oc: state.octaves,
    n: state.start,
    t: state.tempo,
  });
  if (state.edits.size) q.set('e', [...state.edits].map((k) => k.replace(',', '-')).join('.'));
  history.replaceState(null, '', '#' + q.toString());
}

function loadHash() {
  if (!location.hash) return;
  const q = new URLSearchParams(location.hash.slice(1));
  const int = (k, lo, hi, def) => {
    const v = parseInt(q.get(k), 10);
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;
  };
  if (q.has('l')) state.layers = q.get('l').split('.').map(Number).filter((s) => LAYER_INFO[s]);
  if (['residue', 'helix'].includes(q.get('m'))) state.mode = q.get('m');
  state.steps = [16, 24, 32, 48, 64].includes(int('st', 1, 999, 32)) ? int('st', 1, 999, 32) : 32;
  if (SCALES[q.get('sc')]) state.scale = q.get('sc');
  state.root = int('ro', 0, 11, 0);
  state.octaves = int('oc', 1, 3, 2);
  state.start = int('n', 1, 999, 1);
  state.tempo = int('t', 40, 200, 96);
  if (q.get('e')) {
    state.edits = new Set(q.get('e').split('.').filter((x) => /^\d+-\d+$/.test(x)).map((x) => x.replace('-', ',')));
  }
}

// =========================================================
// Arayüz kurulumu
// =========================================================
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1800);
}

function buildUI() {
  // Katmanlar
  const lw = $('layers');
  lw.innerHTML = '';
  for (const s of Object.keys(LAYER_INFO).map(Number)) {
    const info = LAYER_INFO[s];
    const lab = document.createElement('label');
    lab.className = 'layer' + (state.layers.includes(s) ? ' on' : '');
    lab.innerHTML = `<input type="checkbox" ${state.layers.includes(s) ? 'checked' : ''}><span class="dot" style="background:${info.renk}"></span>${info.ad}`;
    lab.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) state.layers = [...state.layers, s].sort((a, b) => a - b);
      else state.layers = state.layers.filter((x) => x !== s);
      lab.classList.toggle('on', e.target.checked);
      rebuild();
    });
    lw.appendChild(lab);
  }

  // Gam ve kök
  const sc = $('scale');
  sc.innerHTML = Object.entries(SCALES).map(([k, v]) => `<option value="${k}">${v.ad}</option>`).join('');
  const ro = $('root');
  ro.innerHTML = NOTE_NAMES.map((nm, i) => `<option value="${i}">${nm}</option>`).join('');

  // Değerleri yerleştir
  $('mode').value = state.mode;
  $('steps').value = String(state.steps);
  sc.value = state.scale;
  ro.value = String(state.root);
  $('octaves').value = String(state.octaves);
  $('start').value = state.start;
  $('tempo').value = state.tempo;
  $('tempoOut').textContent = state.tempo;
  $('modeHelp').textContent = MODE_HELP[state.mode];

  const bind = (id, key, conv = Number) => $(id).addEventListener('change', (e) => {
    state[key] = conv(e.target.value);
    if (key === 'mode') $('modeHelp').textContent = MODE_HELP[state.mode];
    if (key === 'start') state.start = Math.max(1, Math.min(999, state.start || 1));
    rebuild();
  });
  bind('mode', 'mode', String);
  bind('steps', 'steps');
  bind('scale', 'scale', String);
  bind('root', 'root');
  bind('octaves', 'octaves');
  bind('start', 'start');

  $('tempo').addEventListener('input', (e) => setTempo(Number(e.target.value)));
  $('play').addEventListener('click', () => (playing ? stop() : play()));
  $('midi').addEventListener('click', () => exportMidi(2));
  $('clearEdits').addEventListener('click', () => { state.edits.clear(); rebuild(); toast('Elle eklenen çiviler silindi'); });
  $('share').addEventListener('click', async () => {
    saveHash();
    try { await navigator.clipboard.writeText(location.href); toast('Bağlantı panoya kopyalandı'); }
    catch { prompt('Bağlantıyı kopyala:', location.href); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !['INPUT', 'SELECT', 'BUTTON'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      playing ? stop() : play();
    }
  });
}

// =========================================================
// Ana döngü
// =========================================================
function frame() {
  const pos = currentPos();

  if (playing) {
    const now = actx.currentTime;
    while (events.length && events[0].time <= now) {
      const ev = events.shift();
      const cells = cols[ev.t] || [];
      for (const c of cells) flash[c.r] = 1;
      const withItem = cells.find((c) => c.items.length);
      if (withItem) showNumber(withItem.items[0]);
      else if (cells.length) showNumber(null);
    }
  }
  for (let r = 0; r < rows; r++) flash[r] = (flash[r] || 0) * 0.9;

  drawDrum(pos);
  requestAnimationFrame(frame);
}

loadHash();
buildUI();
rebuild();
showNumber({ s: state.layers[0] || 3, n: state.start + 3, p: P(state.layers[0] || 3, state.start + 3) });
requestAnimationFrame(frame);
