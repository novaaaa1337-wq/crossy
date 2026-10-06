(function () {
'use strict';
const T = THREE, Sim = CrossySim;
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const HALF = Sim.HALF;

/* ---------- local storage (per device conveniences) ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('crossy.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { if (v == null) localStorage.removeItem('crossy.' + k); else localStorage.setItem('crossy.' + k, JSON.stringify(v)); } catch (e) {} },
};
let muted = store.get('muted', false);
let mode = store.get('mode', 'ranked');

/* ---------- audio ---------- */
let ac = null;
function audio() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
  if (ac && ac.state === 'suspended') ac.resume();
}
function tone(f1, f2, dur, type, vol, delay) {
  if (!ac || muted) return;
  const t = ac.currentTime + (delay || 0), o = ac.createOscillator(), g = ac.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol || .06, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + dur + .02);
}
function noise(dur, vol, freq) {
  if (!ac || muted) return;
  const n = Math.floor(ac.sampleRate * dur), b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = ac.createBufferSource(); s.buffer = b;
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = ac.createGain(); g.gain.value = vol;
  s.connect(f); f.connect(g); g.connect(ac.destination); s.start();
}
const sfx = {
  hop() { tone(420, 760, .07, 'square', .035); },
  bump() { tone(180, 120, .06, 'square', .04); },
  close() { tone(523, 1046, .1, 'triangle', .08); tone(784, 1568, .14, 'triangle', .07, .08); },
  splash() { noise(.45, .35, 1400); tone(300, 90, .3, 'sine', .08); },
  crash() { noise(.3, .45, 700); tone(220, 50, .3, 'sawtooth', .06); },
  bell() { tone(1320, 1300, .09, 'triangle', .05); },
  train() { noise(1.0, .25, 420); tone(330, 320, .5, 'sawtooth', .03); },
  eagle() { tone(2200, 900, .45, 'sawtooth', .05); tone(1800, 700, .35, 'sawtooth', .04, .15); },
  cash() { [523, 659, 784, 1046].forEach((f, i) => tone(f, f, .12, 'square', .05, i * .08)); },
};

/* ---------- three setup ---------- */
const scene = new T.Scene();
scene.background = new T.Color(0x8fd8f0);
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
$('game').appendChild(renderer.domElement);
const camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 120);
const CAM_OFF = new T.Vector3(3.2, 11, 7.5);
function resize() {
  const w = innerWidth, h = innerHeight, a = w / h;
  renderer.setSize(w, h);
  let hh = 6.4, hw = hh * a;
  if (hw < 5.4) { hw = 5.4; hh = hw / a; }
  if (hw > 13) { hw = 13; hh = hw / a; }
  Object.assign(camera, { left: -hw, right: hw, top: hh, bottom: -hh });
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

const hemi = new T.HemisphereLight(0xffffff, 0x5c6b80, .62);
const sun = new T.DirectionalLight(0xfff4e0, .85);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
sun.shadow.bias = -.0008;
scene.add(hemi, sun, sun.target);

const geo = new T.BoxGeometry(1, 1, 1);
const mats = {};
const M = c => mats[c] || (mats[c] = new T.MeshLambertMaterial({ color: c }));
const G = c => mats['g' + c] || (mats['g' + c] = new T.MeshBasicMaterial({ color: c }));
function box(w, h, d, c, x, y, z, parent, shadow) {
  const m = new T.Mesh(geo, typeof c === 'number' ? M(c) : c);
  m.scale.set(w, h, d); m.position.set(x, y + h / 2, z);
  m.castShadow = shadow !== false; m.receiveShadow = true;
  parent.add(m);
  return m;
}

/* ---------- characters (front faces -z) ---------- */
const BUILD = {
  chicken() {
    const g = new T.Group();
    box(.08, .14, .08, 0xff9a1f, -.12, 0, 0, g); box(.08, .14, .08, 0xff9a1f, .12, 0, 0, g);
    box(.56, .44, .6, 0xfdfdfd, 0, .12, .02, g); box(.64, .18, .3, 0xeeeeee, 0, .28, .06, g);
    box(.3, .22, .12, 0xeeeeee, 0, .42, .34, g); box(.42, .3, .42, 0xfdfdfd, 0, .54, -.08, g);
    box(.44, .07, .07, 0x111111, 0, .68, -.18, g); box(.12, .14, .26, 0xff3b3b, 0, .84, -.06, g);
    box(.14, .1, .14, 0xffa21f, 0, .58, -.34, g); box(.08, .1, .06, 0xff3b3b, 0, .48, -.31, g);
    return g;
  },
  frog() {
    const g = new T.Group();
    box(.18, .12, .32, 0x46a83a, -.32, 0, .12, g); box(.18, .12, .32, 0x46a83a, .32, 0, .12, g);
    box(.6, .32, .6, 0x5cc94a, 0, .04, 0, g); box(.56, .18, .44, 0x6fd85a, 0, .36, -.06, g);
    [-.18, .18].forEach(x => { box(.18, .18, .18, 0xffffff, x, .48, -.14, g); box(.08, .09, .04, 0x111111, x, .54, -.24, g); });
    box(.44, .03, .02, 0x2f7a25, 0, .3, -.31, g);
    return g;
  },
  penguin() {
    const g = new T.Group();
    box(.16, .06, .24, 0xffb020, -.13, 0, -.1, g); box(.16, .06, .24, 0xffb020, .13, 0, -.1, g);
    box(.52, .64, .5, 0x22252e, 0, .06, 0, g); box(.4, .5, .04, 0xffffff, 0, .1, -.26, g);
    box(.08, .36, .24, 0x22252e, -.3, .18, 0, g); box(.08, .36, .24, 0x22252e, .3, .18, 0, g);
    [-.12, .12].forEach(x => { box(.1, .1, .04, 0xffffff, x, .52, -.26, g); box(.05, .05, .03, 0x111111, x, .54, -.285, g); });
    box(.14, .08, .14, 0xffb020, 0, .44, -.3, g);
    return g;
  },
  fox() {
    const g = new T.Group();
    [[-.14, -.18], [.14, -.18], [-.14, .22], [.14, .22]].forEach(([x, z]) => box(.1, .14, .1, 0x3a2a22, x, 0, z, g));
    box(.48, .36, .62, 0xff8a2b, 0, .12, .04, g); box(.3, .24, .06, 0xfff3e6, 0, .16, -.27, g);
    box(.46, .34, .4, 0xff8a2b, 0, .42, -.18, g); box(.22, .14, .18, 0xfff3e6, 0, .44, -.44, g);
    box(.08, .06, .04, 0x111111, 0, .54, -.54, g); box(.48, .06, .06, 0x111111, 0, .64, -.36, g);
    box(.12, .16, .08, 0xff8a2b, -.14, .76, -.16, g); box(.12, .16, .08, 0xff8a2b, .14, .76, -.16, g);
    box(.18, .18, .36, 0xff8a2b, 0, .26, .48, g); box(.18, .18, .12, 0xfff3e6, 0, .26, .72, g);
    return g;
  },
  robot() {
    const g = new T.Group();
    box(.12, .18, .14, 0x6d7583, -.13, 0, 0, g); box(.12, .18, .14, 0x6d7583, .13, 0, 0, g);
    box(.54, .36, .46, 0xb9c3d1, 0, .18, 0, g); box(.22, .14, .04, 0xff5a4e, 0, .28, -.24, g);
    box(.08, .3, .12, 0x8d96a5, -.31, .22, 0, g); box(.08, .3, .12, 0x8d96a5, .31, .22, 0, g);
    box(.44, .3, .4, 0xd6dde8, 0, .56, 0, g); box(.36, .1, .04, G(0x29e0ff), 0, .66, -.21, g);
    box(.04, .16, .04, 0x6d7583, 0, .86, 0, g); box(.1, .1, .1, G(0xff4040), 0, 1.0, 0, g);
    return g;
  },
};
const BIT = { chicken: 0xffffff, frog: 0x5cc94a, penguin: 0x22252e, fox: 0xff8a2b, robot: 0xb9c3d1 };

/* ---------- props ---------- */
const CAR_COLORS = [0xff5a4e, 0x3d8bff, 0xffc83d, 0x8f5bff, 0x2ec4a6, 0xff8fc7, 0xf2f4f7];
function vrng(seed) { return Sim.mulberry32(seed); } // visual-only randomness, never touches the sim
function buildCar(c) {
  const g = new T.Group();
  box(.32, .26, .84, 0x1f2230, -.45, 0, 0, g); box(.32, .26, .84, 0x1f2230, .45, 0, 0, g);
  box(1.5, .36, .8, c, 0, .12, 0, g); box(.82, .3, .7, c, -.1, .48, 0, g); box(.84, .15, .72, 0x24304a, -.1, .55, 0, g);
  [-.24, .24].forEach(z => { box(.04, .1, .16, G(0xfff2a8), .76, .3, z, g, false); box(.04, .1, .16, G(0xff3b3b), -.76, .3, z, g, false); });
  return g;
}
function buildTruck(c) {
  const g = new T.Group();
  [-1, -.2, .95].forEach(x => box(.32, .28, .9, 0x1f2230, x, 0, 0, g));
  box(.8, .74, .82, c, .95, .14, 0, g); box(.05, .24, .62, 0x24304a, 1.36, .54, 0, g);
  box(1.85, .95, .86, 0xf1f3f6, -.4, .14, 0, g); box(1.87, .12, .88, c, -.4, .62, 0, g);
  [-.26, .26].forEach(z => box(.04, .1, .16, G(0xfff2a8), 1.36, .26, z, g, false));
  return g;
}
function buildLog(len) {
  const g = new T.Group();
  box(len, .3, .76, 0x8b5a2b, 0, -.3, 0, g); box(len - .1, .06, .5, 0x9e6a37, 0, 0, 0, g, false);
  box(.05, .26, .68, 0xd8b07a, len / 2, -.28, 0, g, false); box(.05, .26, .68, 0xd8b07a, -len / 2, -.28, 0, g, false);
  return g;
}
function buildTrain(total) {
  const g = new T.Group(), n = 4, seg = 2.6, gap = .15;
  for (let i = 0; i < n; i++) {
    const cx = total / 2 - seg / 2 - i * (seg + gap);
    box(seg - .3, .18, .86, 0x1f2230, cx, 0, 0, g);
    box(seg, .86, .82, i === 0 ? 0x2f6fdb : 0xdfe6ee, cx, .14, 0, g);
    box(seg + .01, .12, .84, i === 0 ? 0xffc83d : 0xff5a4e, cx, .46, 0, g);
    box(seg - .5, .2, .85, 0x24304a, cx, .66, 0, g);
  }
  [-.25, .25].forEach(z => box(.04, .14, .16, G(0xfff2a8), total / 2, .34, z, g, false));
  return g;
}
function buildTree(r) {
  const t = new T.Group(), h = [.55, .85, 1.15][Math.floor(r() * 3)];
  box(.28, .28, .28, 0x8a5a36, 0, 0, 0, t);
  box(.72, h, .72, [0x3fa34d, 0x4fb45a, 0x37944a][Math.floor(r() * 3)], 0, .28, 0, t);
  box(.5, .14, .5, 0x67c46e, 0, .28 + h, 0, t);
  return t;
}
function buildRock() {
  const t = new T.Group();
  box(.62, .32, .56, 0xa3a9b4, 0, 0, 0, t); box(.36, .14, .3, 0xc3c8d0, -.06, .32, .02, t);
  return t;
}
function buildEagle() {
  const g = new T.Group();
  box(.6, .36, 1.1, 0x7a4a26, 0, -.18, 0, g); box(.42, .4, .42, 0xf4f1ea, 0, -.06, .66, g);
  box(.14, .12, .22, 0xffc83d, 0, .02, .94, g); box(.44, .06, .06, 0x111111, 0, .1, .74, g);
  box(.44, .08, .4, 0x6b4426, 0, -.12, -.72, g);
  g.userData.wings = [-1, 1].map(s => {
    const w = new T.Group(); w.position.set(s * .3, 0, 0);
    box(1.4, .08, .62, 0x6b4426, s * .7, -.04, 0, w); box(.5, .08, .5, 0x553419, s * 1.55, -.04, -.05, w);
    g.add(w); return { w, s };
  });
  g.visible = false;
  return g;
}
const eagle = buildEagle(); scene.add(eagle);

/* ---------- particles ---------- */
const parts = [];
function burst(x, y, z, color, n, spd, up) {
  for (let i = 0; i < n; i++) {
    const m = new T.Mesh(geo, M(color)), s = .06 + Math.random() * .08;
    m.scale.set(s, s, s); m.position.set(x, y, z); scene.add(m);
    parts.push({ m, s, vx: (Math.random() * 2 - 1) * spd, vy: (.4 + Math.random() * .6) * up, vz: (Math.random() * 2 - 1) * spd, life: .6 + Math.random() * .5 });
  }
}
function updateParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt; p.vy -= 14 * dt;
    p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
    p.m.rotation.x += dt * 6; p.m.rotation.y += dt * 4;
    const k = clamp(p.life * 2, 0, 1) * p.s; p.m.scale.set(k, k, k);
    if (p.life <= 0) { scene.remove(p.m); parts.splice(i, 1); }
  }
}

/* ---------- lane views (mirror the sim's lanes) ---------- */
const views = new Map();     // sim lane object -> view
const meshOf = new WeakMap(); // sim vehicle/log object -> mesh
function buildView(L) {
  const g = new T.Group(); g.position.z = -L.row; scene.add(g);
  const r = vrng(L.vis), even = L.row % 2 === 0, v = { g, L, bell: 0 };
  if (L.type === 'grass') {
    box(40, .4, 1, even ? 0x9ad86f : 0x90cf66, 0, -.4, 0, g, false);
    [-1, 1].forEach(s => box(14, .42, 1, even ? 0x7cb456 : 0x74ab4f, s * 13.5, -.4, 0, g, false));
    L.trees.forEach((kind, c) => { const t = kind === 'rock' ? buildRock() : buildTree(r); t.position.x = c; g.add(t); });
    for (let c = -10; c <= 10; c++) if (Math.abs(c) > HALF && r() < .6) { const t = buildTree(r); t.position.x = c; g.add(t); }
    for (let i = 0; i < 3; i++) box(.14, .08, .14, 0x6fae4b, (r() * 2 - 1) * HALF, 0, r() * .8 - .4, g, false);
  } else if (L.type === 'road') {
    box(40, .4, 1, 0x4a4f5c, 0, -.42, 0, g, false);
    [-1, 1].forEach(s => box(14, .405, 1, 0x3d414c, s * 13.5, -.42, 0, g, false));
    if (L.prevType === 'road') for (let x = -18; x <= 18; x += 2) box(.9, .02, .08, 0xdfe3ea, x, -.02, .5, g, false);
    else box(40, .03, .06, 0xb9bec8, 0, -.02, .47, g, false);
    L.vehicles.forEach(veh => {
      const c = CAR_COLORS[Math.floor(r() * CAR_COLORS.length)];
      const m = L.kind === 'truck' ? buildTruck(c) : buildCar(c);
      m.rotation.y = L.dir > 0 ? 0 : Math.PI; m.position.x = veh.x; g.add(m); meshOf.set(veh, m);
    });
  } else if (L.type === 'river') {
    box(40, .3, 1, 0x3db4e6, 0, -.55, 0, g, false);
    [-1, 1].forEach(s => box(14, .31, 1, 0x2f97c9, s * 13.5, -.55, 0, g, false));
    L.pads.forEach(c => {
      const p = box(.78, .06, .78, 0x46b04f, c, -.22, 0, g, false); p.rotation.y = r() * .8 - .4;
      if (r() < .3) box(.14, .1, .14, 0xff8fc7, c + .2, -.16, .18, g, false);
    });
    L.logs.forEach(lg => { const m = buildLog(lg.len); m.position.x = lg.x; g.add(m); meshOf.set(lg, m); });
  } else if (L.type === 'rail') {
    box(40, .4, 1, 0x8d7f72, 0, -.42, 0, g, false);
    for (let x = -19; x <= 19; x++) box(.2, .05, .84, 0x5e4636, x, -.02, 0, g, false);
    [-.27, .27].forEach(z => box(40, .07, .07, 0xb7c0c9, 0, .03, z, g, false));
    const px = (HALF + 1.2) * (L.dir > 0 ? -1 : 1);
    box(.1, 1.2, .1, 0x3a3f4b, px, 0, .42, g); box(.34, .34, .14, 0x22252e, px, 1.08, .42, g);
    v.lamp = box(.18, .18, .05, M(0x552222), px, 1.16, .5, g, false);
    v.train = buildTrain(L.train.total); v.train.rotation.y = L.dir > 0 ? 0 : Math.PI; v.train.visible = false; g.add(v.train);
  }
  views.set(L, v);
}
function clearViews() { views.forEach(v => scene.remove(v.g)); views.clear(); }
// The sim moves in 1/60 s steps; `alpha` (0..1) is how far we are into the next step.
// Moving things are drawn that far ahead so motion stays smooth on any refresh rate.
function syncViews(dt, alpha) {
  for (const L of game.lanes.values()) if (!views.has(L)) buildView(L);
  views.forEach((v, L) => {
    if (game.lanes.get(L.row) !== L) { scene.remove(v.g); views.delete(L); return; }
    const ahead = L.dir * L.speed * Sim.DT * alpha;
    if (L.type === 'road') L.vehicles.forEach(o => { meshOf.get(o).position.x = o.x + ahead; });
    else if (L.type === 'river') L.logs.forEach((o, i) => { const m = meshOf.get(o); m.position.x = o.x + ahead; m.position.y = Math.sin(clock * 2.2 + i * 1.7) * .025; });
    else if (L.type === 'rail') {
      const tr = L.train;
      v.train.visible = tr.state === 'go'; v.train.position.x = tr.x + (tr.state === 'go' ? L.dir * 28 * Sim.DT * alpha : 0);
      const blink = tr.state !== 'idle' && Math.floor(clock * 6) % 2 === 0;
      v.lamp.material = blink ? G(0xff3b3b) : M(0x552222);
      if (tr.state === 'warn' && state === 'play' && Math.abs(L.row - game.p.row) < 9) {
        v.bell -= dt; if (v.bell <= 0) { sfx.bell(); v.bell = .32; }
      } else v.bell = 0;
    }
  });
}

/* ---------- state ---------- */
let game = Sim.createGame(newSeed());
let state = 'menu', paused = false, clock = 0, acc = 0, camRow = 1.2, camX = 0, shake = 0;
let run = null;   // {mode, ticketId}
let death = null; // {kind, t}
const P = { g: new T.Group(), model: null, skin: null };
scene.add(P.g);
function newSeed() { return (Math.random() * 4294967296) >>> 0; }

let config = null, skins = [{ id: 'chicken', name: 'Chicken', lamports: 0 }], owned = new Set(['chicken']);
let sel = 0;
function setModel(id) {
  if (P.model) P.g.remove(P.model);
  P.skin = id; P.model = BUILD[id](); P.g.add(P.model);
}

function resetView() {
  clearViews();
  parts.forEach(p => scene.remove(p.m)); parts.length = 0;
  eagle.visible = false; death = null; acc = 0;
  camRow = 1.2; camX = 0;
  setModel(skins[sel].id);
  P.g.position.set(0, 0, 0); P.g.rotation.y = 0;
}

/* ---------- money helpers ---------- */
const fmtSol = l => { const s = (l / 1e9).toFixed(3).replace(/0$/, ''); return `${s} SOL`; };
const short = w => w ? `${w.slice(0, 4)}…${w.slice(-4)}` : '';

/* ---------- API ---------- */
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 202) { const e = new Error(j.error || `Request failed (${r.status})`); e.status = r.status; throw e; }
  j.httpStatus = r.status;
  return j;
}

/* ---------- built-in wallet ----------
 * Each player gets a Solana keypair made in their browser. The private key never leaves the
 * device: payments are signed here and only the signed transaction is sent to the server. */
const RENT_MIN = 890880; // lamports a non-empty Solana account must keep
const FEE = 5000;
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58enc(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = '1' + s; else break; }
  return s;
}
function b58dec(str) {
  let n = 0n;
  for (const c of str) { const i = B58.indexOf(c); if (i < 0) throw new Error('Not a valid key'); n = n * 58n + BigInt(i); }
  const out = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of str) { if (c === '1') out.unshift(0); else break; }
  return Uint8Array.from(out);
}
function parseSecret(text) {
  const t = text.trim();
  const bytes = t.startsWith('[') ? Uint8Array.from(JSON.parse(t)) : b58dec(t);
  if (bytes.length !== 64) throw new Error('That is not a Solana private key. Paste the full exported key.');
  return solanaWeb3.Keypair.fromSecretKey(bytes);
}

let keypair = null, wallet = null, balance = null;
function loadWallet() {
  const saved = store.get('wallet', null);
  try { if (saved) keypair = parseSecret(saved); } catch (e) { keypair = null; }
  if (!keypair) {
    keypair = solanaWeb3.Keypair.generate();
    store.set('wallet', b58enc(keypair.secretKey));
    store.set('backedUp', false);
    if (store.get('wallet', null) !== b58enc(keypair.secretKey)) {
      showMsg('This browser is blocking storage, so your wallet will be lost when you close the page. Do not deposit SOL here.');
    }
  }
  wallet = keypair.publicKey.toBase58();
}
async function refreshBalance() {
  try { balance = (await api('/api/balance?wallet=' + wallet)).lamports; } catch (e) {}
  renderWallet();
  return balance;
}
async function onWallet() {
  owned = new Set(['chicken']);
  try { (await api('/api/me?wallet=' + encodeURIComponent(wallet))).skins.forEach(s => owned.add(s)); } catch (e) {}
  await refreshBalance();
  renderMenu(); renderRound();
}
function renderWallet() {
  const bal = balance == null ? '–' : fmtSol(balance);
  $('walletBtn').textContent = `Wallet · ${bal}`;
  $('wmBal').textContent = bal;
  $('wmAddr').textContent = wallet;
  $('backupNag').hidden = !(balance > 0 && !store.get('backedUp', false));
}
function wmMsg(m, ok) { const el = $('wmMsg'); el.textContent = m || ''; el.hidden = !m; el.classList.toggle('ok', !!ok); }
function openWallet() { wmMsg(''); $('walletModal').hidden = false; refreshBalance(); $('wmClose').focus({ preventScroll: true }); }
function closeWallet() { $('walletModal').hidden = true; $('exBox').hidden = true; $('exKey').textContent = ''; }

async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = t; }, 1200); }
  catch (e) { wmMsg('Copy failed. Select the text and copy it by hand.'); }
}

const b64ToBytes = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
const bytesToB64 = u => { let s = ''; u.forEach(c => { s += String.fromCharCode(c); }); return btoa(s); };

async function pay(kind, skin) {
  busy('Preparing payment');
  const intent = await api('/api/intent', { kind, wallet, skin });
  await refreshBalance();
  const need = intent.lamports + FEE;
  if (balance == null || balance < need) {
    idle(); openWallet();
    throw new Error(`Add SOL to your wallet first. This costs ${fmtSol(need)} with the network fee, and you have ${fmtSol(balance || 0)}.`);
  }
  const rest = balance - need;
  if (rest > 0 && rest < RENT_MIN) {
    throw new Error(`Solana requires a wallet to keep at least ${fmtSol(RENT_MIN)} or be empty. Add a little more SOL and try again.`);
  }
  const tx = solanaWeb3.Transaction.from(b64ToBytes(intent.tx));
  tx.partialSign(keypair);
  busy(`Paying ${fmtSol(intent.lamports)}`);
  const { signature } = await api('/api/relay', { intentId: intent.intentId, tx: bytesToB64(tx.serialize()) });
  store.set('pending', { intentId: intent.intentId, signature, wallet });
  return confirmPending();
}
async function confirmPending() {
  const p = store.get('pending', null);
  if (!p) return null;
  busy('Confirming on Solana');
  for (let i = 0; i < 6; i++) {
    let r;
    try { r = await api('/api/confirm', { intentId: p.intentId, signature: p.signature }); }
    catch (e) { if (e.status && e.status < 500) store.set('pending', null); throw e; }
    if (r.httpStatus === 202) continue;
    store.set('pending', null);
    if (r.kind === 'entry') store.set('ticket', { ticketId: r.ticketId, wallet: p.wallet });
    if (r.kind === 'skin') owned.add(r.skin);
    refreshBalance();
    return r;
  }
  throw new Error('Your payment is still confirming. Reload in a minute and it will be checked again.');
}

async function waitForSignature(sig) {
  for (let i = 0; i < 30; i++) {
    const r = await api('/api/tx-status?sig=' + encodeURIComponent(sig));
    if (r.status === 'confirmed') return;
    if (r.status === 'failed') throw new Error('The transfer failed on chain. No SOL was sent.');
    await new Promise(res => setTimeout(res, 2000));
  }
  throw new Error('The transfer is taking longer than usual. Check your balance again in a minute.');
}
async function withdraw() {
  wmMsg('');
  const to = $('wdTo').value.trim(), amount = $('wdAmt').value.trim(), max = amount.toLowerCase() === 'max';
  if (!to) { wmMsg('Enter the Solana address to send to.'); return; }
  if (!max && !/^\d+(\.\d{1,9})?$/.test(amount)) { wmMsg('Enter an amount in SOL, like 0.25, or press Max.'); return; }
  try {
    busy('Preparing withdrawal');
    const r = await api('/api/withdraw-tx', { from: wallet, to, sol: max ? null : amount, max });
    const tx = solanaWeb3.Transaction.from(b64ToBytes(r.tx));
    tx.partialSign(keypair);
    busy(`Sending ${fmtSol(r.lamports)}`);
    const { signature } = await api('/api/send', { tx: bytesToB64(tx.serialize()) });
    await waitForSignature(signature);
    idle(); $('wdAmt').value = '';
    wmMsg(`Sent ${fmtSol(r.lamports)} to ${short(to)}.`, true);
    refreshBalance();
  } catch (e) { idle(); wmMsg(e.message); }
}
function revealKey() {
  $('exKey').textContent = b58enc(keypair.secretKey);
  $('exBox').hidden = false;
  store.set('backedUp', true);
  renderWallet();
}
let importArmed = false;
async function importKey() {
  wmMsg('');
  let kp;
  try { kp = parseSecret($('imKey').value); } catch (e) { wmMsg(e.message || 'That key could not be read.'); return; }
  if (kp.publicKey.toBase58() === wallet) { wmMsg('That is already your wallet.'); return; }
  if (balance > 0 && !store.get('backedUp', false) && !importArmed) {
    importArmed = true;
    $('imBtn').textContent = 'Replace anyway, I saved the old key';
    wmMsg(`Your current wallet holds ${fmtSol(balance)} and you have not exported its key. Export it first or that SOL is lost.`);
    return;
  }
  keypair = kp; wallet = kp.publicKey.toBase58();
  store.set('wallet', b58enc(kp.secretKey)); store.set('backedUp', true);
  importArmed = false; $('imBtn').textContent = 'Replace wallet'; $('imKey').value = '';
  await onWallet();
  wmMsg('Wallet replaced.', true);
}

/* ---------- UI ---------- */
function busy(msg) { $('busyMsg').textContent = msg; $('busy').hidden = false; }
function idle() { $('busy').hidden = true; }
function showMsg(m) { const el = $('msg'); el.textContent = m || ''; el.hidden = !m; }
function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }

function ticketReady() { const t = store.get('ticket', null); return t && t.wallet === wallet ? t : null; }

function renderMenu() {
  const s = skins[sel], has = owned.has(s.id);
  $('modeRanked').setAttribute('aria-checked', mode === 'ranked');
  $('modePractice').setAttribute('aria-checked', mode === 'practice');
  $('cname').textContent = s.name;
  const stat = $('cstat');
  stat.textContent = has ? 'Owned' : fmtSol(s.lamports);
  stat.classList.toggle('price', !has);
  $('buyBtn').hidden = has;
  if (config) $('entryPrice').textContent = fmtSol(config.entryLamports);

  const btn = $('primary'), note = $('modeNote');
  btn.disabled = false;
  if (!has) {
    btn.textContent = `Buy ${s.name} · ${fmtSol(s.lamports)}`;
    note.textContent = 'You can only play characters you own. Pick another one, or buy this one.';
  } else if (mode === 'practice') {
    btn.textContent = 'Play practice';
    note.textContent = 'Free runs to warm up. Practice scores never reach the leaderboard.';
  } else if (ticketReady()) {
    btn.textContent = 'Start ranked run';
    note.textContent = 'Your run is paid. The clock starts when you press it, and a ranked run cannot be paused.';
  } else {
    btn.textContent = `Pay ${config ? fmtSol(config.entryLamports) : '0.05 SOL'} & play`;
    note.textContent = balance != null && balance < (config ? config.entryLamports : 5e7) + FEE
      ? 'Paid from your Crossy wallet. Tap Wallet at the top to add SOL.'
      : 'Paid from your Crossy wallet. Your best score this round counts, and the top score wins the pool.';
  }
}

async function primary() {
  audio(); showMsg('');
  const s = skins[sel];
  if (!owned.has(s.id)) { await buySkin(); return; }
  if (mode === 'practice') { beginRun({ mode: 'practice' }, newSeed()); return; }
  try {
    if (!ticketReady()) {
      await pay('entry');
      idle(); sfx.cash(); renderMenu();
      return;
    }
    await startRanked();
  } catch (e) {
    idle(); showMsg(walletError(e)); renderMenu();
  }
}
async function buySkin() {
  const s = skins[sel];
  try {
    await pay('skin', s.id);
    idle(); sfx.cash(); toast(`${s.name} unlocked`);
    burst(0, .6, 0, 0xffc83d, 24, 2.5, 6);
  } catch (e) { idle(); showMsg(walletError(e)); }
  renderMenu();
}
function walletError(e) {
  const m = (e && e.message) || String(e);
  if (/insufficient|0x1\b/i.test(m)) return 'Your wallet does not have enough SOL for this payment and the network fee. Tap Wallet to add SOL.';
  return m;
}
async function startRanked() {
  const t = ticketReady();
  busy('Starting your run');
  try {
    const r = await api('/api/run/start', { ticketId: t.ticketId, skin: skins[sel].id });
    store.set('ticket', null);
    idle();
    beginRun({ mode: 'ranked', ticketId: t.ticketId, round: r.round }, r.seed);
  } catch (e) {
    if (e.status === 409 || e.status === 404) store.set('ticket', null);
    throw e;
  }
}

function beginRun(r, seed) {
  run = r;
  game = Sim.createGame(seed);
  resetView();
  state = 'play'; paused = false;
  $('menu').hidden = true; $('over').hidden = true; $('hud').hidden = false;
  const badge = $('modeBadge');
  badge.textContent = r.mode === 'ranked' ? 'Ranked' : 'Practice';
  badge.classList.toggle('ranked', r.mode === 'ranked');
  $('score').textContent = '0';
}

function toMenu() {
  state = 'menu'; run = null; paused = false; $('paused').hidden = true;
  game = Sim.createGame(newSeed());
  resetView();
  $('over').hidden = true; $('hud').hidden = true; $('menu').hidden = false;
  renderMenu();
}

const DEATH_MSG = { squash: 'Hit by traffic', drown: 'Fell in the river', train: 'Ignored the rail signal', eagle: 'The eagle caught you waiting', time: 'Time limit reached' };
async function endRun() {
  state = 'over';
  const score = game.p.maxRow;
  $('deathMsg').textContent = DEATH_MSG[game.p.kind] || 'Run over';
  $('finalScore').textContent = score;
  $('over').hidden = false;
  const res = $('result');
  if (run.mode === 'practice') {
    res.textContent = 'Practice run. Not counted on the leaderboard.';
    $('againBtn').textContent = 'Practice again';
    $('againBtn').focus({ preventScroll: true });
    return;
  }
  $('againBtn').textContent = 'Play again';
  res.textContent = 'Checking your run…';
  try {
    const r = await api('/api/run', { ticketId: run.ticketId, inputs: game.inputs, score });
    res.innerHTML = '';
    const rk = document.createElement('span'); rk.className = 'rank';
    rk.textContent = r.rank === 1 ? 'You lead this round!' : `#${r.rank} this round`;
    res.append(rk, document.createTextNode(r.best > score ? `Your best this round is still ${r.best}.` : 'Score verified and on the leaderboard.'));
    if (r.rank === 1) sfx.cash();
    pollRound();
  } catch (e) {
    res.textContent = e.message;
  }
  $('againBtn').focus({ preventScroll: true });
}

function setPaused(v) {
  if (state !== 'play' || game.p.dead || (run && run.mode === 'ranked')) v = false;
  paused = v; $('paused').hidden = !v;
}

/* ---------- round + leaderboard ---------- */
let roundInfo = null, serverOffset = 0;
function applyRound(r) { serverOffset = r.now - Date.now(); roundInfo = r; renderRound(); }
async function pollRound() {
  try { applyRound(await api('/api/round')); } catch (e) {}
}
// The server pushes the round (pool, leaderboard, timer, payouts) the moment anything changes.
// If the live stream is down, fall back to asking every 5 seconds.
let live = null;
function startLive() {
  pollRound();
  if (window.EventSource) {
    live = new EventSource('/api/stream');
    live.onmessage = e => { try { applyRound(JSON.parse(e.data)); } catch (err) {} };
  }
  setInterval(() => { if (!live || live.readyState !== 1) pollRound(); }, 5000);
}
function renderRound() {
  const r = roundInfo;
  if (!r) return;
  $('pool').textContent = fmtSol(r.poolLamports);
  $('roundNo').textContent = '#' + r.number;
  $('entries').textContent = `${r.entries} ${r.entries === 1 ? 'entry' : 'entries'}`;
  const list = $('lbList'); list.innerHTML = '';
  r.leaderboard.slice(0, 10).forEach((row, i) => {
    const li = document.createElement('li');
    if (row.wallet === wallet) li.className = 'me';
    const rk = document.createElement('span'); rk.className = 'rk'; rk.textContent = i + 1;
    const ad = document.createElement('span'); ad.className = 'addr'; ad.textContent = row.wallet === wallet ? 'You' : short(row.wallet);
    const pt = document.createElement('span'); pt.className = 'pts'; pt.textContent = row.score;
    li.append(rk, ad, pt); list.append(li);
  });
  $('lbEmpty').hidden = r.leaderboard.length > 0;
  const prev = $('prevRound'), p = r.prev; prev.innerHTML = '';
  if (p.winner) {
    const who = document.createElement('b'); who.textContent = p.winner === wallet ? 'You' : short(p.winner);
    prev.append(`Round #${p.number}: `, who, ` won ${fmtSol(p.lamports)} with ${p.score}. `);
    if (p.status === 'paid' && p.signature) {
      const a = document.createElement('a');
      a.href = `https://explorer.solana.com/tx/${p.signature}${config && config.cluster !== 'mainnet-beta' ? '?cluster=' + config.cluster : ''}`;
      a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'View payout';
      prev.append(a);
    } else prev.append(p.status === 'pending' || p.status === 'sending' ? 'Payout is being sent.' : `Paid out about ${Math.max(0, Math.ceil((p.settlesAt - Date.now() - serverOffset) / 60000))} min after the round closes.`);
  } else prev.textContent = p.number >= 1 ? `Round #${p.number} had no ranked runs.` : 'Round #1 is the first round. Good luck.';
}
function renderTimer() {
  if (!roundInfo) return;
  const left = Math.max(0, roundInfo.endsAt - (Date.now() + serverOffset));
  const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
  const el = $('timer');
  el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  el.classList.toggle('hot', left < 60000);
  if (left === 0 && !renderTimer.waiting) { renderTimer.waiting = true; setTimeout(() => { renderTimer.waiting = false; pollRound(); }, 1500); }
}

/* ---------- events from the sim ---------- */
const FACE = [0, Math.PI, Math.PI / 2, -Math.PI / 2];
function drainEvents() {
  for (const e of game.events) {
    if (e.t === 'hop') sfx.hop();
    else if (e.t === 'bump') sfx.bump();
    else if (e.t === 'score') $('score').textContent = game.p.maxRow;
    else if (e.t === 'close' && state === 'play') { toast('Close call!'); sfx.close(); }
    else if (e.t === 'whoosh' && state === 'play') { toast('Whoosh!'); sfx.close(); }
    else if (e.t === 'train' && state === 'play' && Math.abs(e.row - game.p.row) < 9) sfx.train();
    else if (e.t === 'die' && state === 'play') startDeath(e.kind);
  }
  game.events.length = 0;
}
function laneY(row) {
  const L = game.lane(row);
  if (!L) return 0;
  if (L.type === 'river') return L.kind === 'pads' ? -.16 : 0;
  return L.type === 'road' ? -.02 : 0;
}
function startDeath(kind) {
  const pos = P.g.position, bit = BIT[P.skin];
  death = { kind, t: 0 };
  if (kind === 'squash') { P.model.scale.set(1.3, .14, 1.3); pos.y = laneY(game.p.row); burst(pos.x, .3, pos.z, bit, 14, 2.2, 4); sfx.crash(); shake = .35; }
  else if (kind === 'train') { P.model.visible = false; burst(pos.x, .4, pos.z, bit, 26, 4, 7); sfx.crash(); shake = .6; }
  else if (kind === 'drown') { burst(pos.x, -.1, pos.z, 0xbfe9ff, 18, 1.5, 5); sfx.splash(); }
  else if (kind === 'eagle') { eagle.visible = true; eagle.position.set(pos.x, 1.6, pos.z - 18); eagle.userData.carry = false; sfx.eagle(); }
}

function renderPlayer(dt, alpha) {
  const p = game.p, pos = P.g.position;
  if (death) {
    death.t += dt;
    if (death.kind === 'drown') pos.y = Math.max(-1.2, pos.y - dt * 1.6);
    if (death.kind === 'eagle') {
      eagle.position.z += 24 * dt;
      eagle.userData.wings.forEach(({ w, s }) => { w.rotation.z = s * Math.sin(clock * 16) * .5; });
      if (!eagle.userData.carry && eagle.position.z >= pos.z - .2) { eagle.userData.carry = true; burst(pos.x, .6, pos.z, BIT[P.skin], 10, 2, 3); }
      if (eagle.userData.carry) pos.set(eagle.position.x, eagle.position.y - .95, eagle.position.z);
    }
    if (state === 'play' && death.t > (death.kind === 'eagle' ? 1.5 : 1.1)) endRun();
    return;
  }
  if (state === 'menu') { pos.set(0, Math.abs(Math.sin(clock * 3)) * .12, 0); P.g.rotation.y = 0; return; }
  let x = p.px, r = p.pr, y;
  P.model.scale.set(1, 1, 1);
  const cur = game.lane(p.row);
  const drift = p.log && cur ? cur.dir * cur.speed * Sim.DT * alpha : 0;
  if (p.hop) {
    const h = p.hop, k = Math.min(1, (h.t + alpha) / Sim.HOP_TICKS), a = Math.sin(k * Math.PI);
    x = h.bump && p.log ? p.x + drift : h.fx + (h.tx - h.fx) * k;
    r = h.fr + (h.tr - h.fr) * k;
    y = lerp(laneY(h.fr), laneY(h.tr), k) + a * (h.bump ? .18 : .5);
    P.model.scale.set(1 - a * .08, 1 + a * .14, 1 - a * .08);
  } else if (p.log) {
    x = p.px + drift;
    y = meshOf.get(p.log) ? meshOf.get(p.log).position.y : 0;
  } else y = laneY(p.row);
  pos.set(x, y, -r);
  P.g.rotation.y = FACE[p.face];
}

function updateCamera(dt) {
  const pos = P.g.position;
  if (!(death && death.kind === 'eagle')) {
    const focus = state === 'menu' ? 0 : Math.max(-pos.z, game.autoRow);
    camRow = lerp(camRow, focus + 1.4, 1 - Math.exp(-dt * 5));
    camX = lerp(camX, clamp(pos.x, -2.5, 2.5), 1 - Math.exp(-dt * 4));
  }
  const tgt = new T.Vector3(camX, 0, -camRow);
  camera.position.copy(tgt).add(CAM_OFF);
  if (shake > 0 && !reduceMotion) { camera.position.x += (Math.random() * 2 - 1) * shake * .4; camera.position.y += (Math.random() * 2 - 1) * shake * .4; }
  shake = Math.max(0, shake - dt * 1.5);
  camera.lookAt(tgt);
  sun.position.set(camX - 6, 16, -camRow + 7);
  sun.target.position.set(camX, 0, -camRow);
}

const DAY_SKY = new T.Color(0x8fd8f0), NIGHT_SKY = new T.Color(0x1c2440), DAY_HEMI = new T.Color(0xffffff), NIGHT_HEMI = new T.Color(0x8a98e0);
function updateDayNight() {
  const f = .5 + .5 * Math.cos(clock / 140 * Math.PI * 2);
  sun.intensity = .18 + .72 * f; hemi.intensity = .38 + .28 * f;
  hemi.color.copy(NIGHT_HEMI).lerp(DAY_HEMI, f);
  scene.background.copy(NIGHT_SKY).lerp(DAY_SKY, f);
}

/* ---------- input ---------- */
function hop(d) {
  if (state === 'play' && !paused && !game.p.dead) game.input(d);
}
function cycle(dir) {
  if (state !== 'menu') return;
  sel = (sel + dir + skins.length) % skins.length;
  store.set('sel', skins[sel].id);
  setModel(skins[sel].id); renderMenu(); sfx.bump();
}
document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; store.set('mode', mode); showMsg(''); renderMenu(); }));
$('prevC').addEventListener('click', () => { audio(); cycle(-1); });
$('nextC').addEventListener('click', () => { audio(); cycle(1); });
$('buyBtn').addEventListener('click', () => { audio(); showMsg(''); buySkin(); });
$('primary').addEventListener('click', primary);
$('againBtn').addEventListener('click', () => {
  if (run && run.mode === 'practice') { beginRun({ mode: 'practice' }, newSeed()); return; }
  toMenu(); mode = 'ranked'; renderMenu(); primary();
});
$('menuBtn').addEventListener('click', toMenu);
$('walletBtn').addEventListener('click', () => { audio(); openWallet(); });
$('wmClose').addEventListener('click', closeWallet);
$('walletModal').addEventListener('click', e => { if (e.target === $('walletModal')) closeWallet(); });
$('wmRefresh').addEventListener('click', refreshBalance);
$('wmCopy').addEventListener('click', e => copyText(wallet, e.currentTarget));
$('wdMax').addEventListener('click', () => { $('wdAmt').value = 'max'; });
$('wdSend').addEventListener('click', withdraw);
$('exReveal').addEventListener('click', revealKey);
$('exCopy').addEventListener('click', e => copyText($('exKey').textContent, e.currentTarget));
$('imBtn').addEventListener('click', importKey);
$('backupNag').addEventListener('click', () => { openWallet(); $('wmExport').open = true; });
$('lbToggle').addEventListener('click', () => {
  const open = $('lb').classList.toggle('open');
  $('lbToggle').setAttribute('aria-expanded', open);
});
$('paused').addEventListener('click', () => setPaused(false));
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });

const KEYS = { ArrowUp: 0, KeyW: 0, ArrowDown: 1, KeyS: 1, ArrowLeft: 2, KeyA: 2, ArrowRight: 3, KeyD: 3 };
addEventListener('keydown', e => {
  if (e.code === 'KeyP' || e.code === 'Escape') { setPaused(!paused); return; }
  if (e.code === 'KeyM') { muted = !muted; store.set('muted', muted); toast(muted ? 'Sound off' : 'Sound on'); return; }
  if (e.code in KEYS) {
    e.preventDefault();
    if (e.repeat) return;
    audio();
    if (state === 'menu') { if (KEYS[e.code] === 2) cycle(-1); if (KEYS[e.code] === 3) cycle(1); return; }
    hop(KEYS[e.code]);
    return;
  }
  if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
    if (document.activeElement && document.activeElement.tagName === 'BUTTON') return;
    e.preventDefault();
    if (!$('busy').hidden) return;
    if (state === 'over') $('againBtn').click();
    else if (state === 'menu') primary();
    else if (paused) setPaused(false);
    else hop(0);
  }
});
let touch = null;
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', e => { touch = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', e => {
  if (!touch) return;
  const dx = e.clientX - touch.x, dy = e.clientY - touch.y; touch = null;
  audio();
  if (state !== 'play') return;
  if (Math.hypot(dx, dy) < 24) { hop(0); return; }
  if (Math.abs(dx) > Math.abs(dy)) hop(dx > 0 ? 3 : 2);
  else hop(dy < 0 ? 0 : 1);
});

/* ---------- loop ---------- */
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000; last = now;
  // Ranked runs keep real time even if the tab stalls; practice just slows down.
  const ranked = state === 'play' && run && run.mode === 'ranked';
  const dt = Math.min(ranked ? 10 : .05, raw);
  if (!paused) {
    clock += Math.min(dt, .05);
    acc += dt;
    let n = 0;
    while (acc >= Sim.DT && n < 700) {
      if (state === 'play' && !game.p.dead) game.step(); else game.ambient();
      acc -= Sim.DT; n++;
    }
    if (n >= 700) acc = 0;
    const alpha = clamp(acc / Sim.DT, 0, 1);
    drainEvents();
    syncViews(Math.min(dt, .05), alpha);
    renderPlayer(Math.min(dt, .05), alpha);
    updateParts(Math.min(dt, .05));
    updateDayNight();
  }
  updateCamera(paused ? 0 : Math.min(dt, .05));
  renderer.render(scene, camera);
}

/* ---------- boot ---------- */
async function boot() {
  resetView();
  renderMenu();
  requestAnimationFrame(frame);
  try {
    config = await api('/api/config');
    skins = config.skins;
    const saved = store.get('sel', 'chicken');
    sel = Math.max(0, skins.findIndex(s => s.id === saved));
    setModel(skins[sel].id);
    $('netBadge').hidden = config.cluster === 'mainnet-beta';
    $('netBadge').textContent = config.cluster;
  } catch (e) { showMsg('Could not reach the Crossy server. Practice still works.'); }
  renderMenu();
  startLive(); setInterval(renderTimer, 250);
  loadWallet();
  await onWallet();
  setInterval(() => { if (state !== 'play') refreshBalance(); }, 15000);
  if (store.get('pending', null)) {
    try { const r = await confirmPending(); idle(); if (r) toast(r.kind === 'skin' ? 'Purchase confirmed' : 'Paid run ready'); }
    catch (e) { idle(); showMsg(walletError(e)); }
    renderMenu();
  }
}
boot();
})();
