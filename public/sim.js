/*
 * Crossy game simulation.
 * Runs identically in the browser and on the server, so the server can replay a run's inputs
 * and compute the real score. Rules for keeping it deterministic:
 *   - fixed 60 Hz ticks, never wall-clock time
 *   - all randomness comes from the seeded PRNG, consumed in the same order on both sides
 *   - only + - * / and Math.round/floor/abs/min/max (no Math.sin, no Array.sort with random comparators)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CrossySim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TPS = 60;
  const DT = 1 / TPS;
  const HALF = 6;             // playable columns -6..6
  const WRAP = 18;            // vehicles and logs wrap beyond this x
  const HOP_TICKS = 8;
  const MAX_TICKS = TPS * 60 * 10;   // a run can last at most 10 minutes
  const MAX_INPUTS = 20000;
  const TRAIN_LEN = 4 * 2.6 + 3 * 0.15;
  const DIRS = [[0, 1], [0, -1], [-1, 0], [1, 0]]; // 0 up, 1 down, 2 left, 3 right

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createGame(seed, opts) {
    const quiet = !!(opts && opts.quiet);
    const R = mulberry32(seed);
    const rand = (a, b) => a + R() * (b - a);
    const randi = (a, b) => Math.floor(rand(a, b + 1));
    const pick = arr => arr[Math.floor(R() * arr.length)];

    const lanes = new Map();
    const gen = { row: -12, type: 'grass', left: 0 };
    const p = { x: 0, row: 0, px: 0, pr: 0, hop: null, log: null, logOff: 0, maxRow: 0, dead: false, kind: '', queue: null, face: 0 };
    const game = {
      seed: seed >>> 0, tick: 0, lanes, p, autoRow: 0,
      inputs: [], cursor: 0, events: [], escape: null,
      input, step, ambient: updateLanes, lane: r => lanes.get(r),
    };
    const emit = (t, extra) => { if (!quiet) game.events.push(Object.assign({ t }, extra)); };

    function nextType(row) {
      if (row <= 3) return 'grass';
      if (gen.left > 0) { gen.left--; return gen.type; }
      const d = Math.min(1, row / 200);
      let t;
      if (gen.type !== 'grass' && R() < 0.72) t = 'grass';
      else t = pick(['road', 'road', 'road', 'river', 'river', 'rail'].filter(o => o !== gen.type));
      if (t === 'grass') gen.left = R() < 0.3 ? 1 : 0;
      if (t === 'road') gen.left = randi(0, 1 + Math.round(d * 3));
      if (t === 'river') gen.left = randi(0, 1 + Math.round(d * 2));
      if (t === 'rail') gen.left = R() < 0.3 ? 1 : 0;
      gen.type = t;
      return t;
    }

    function makeLane(row) {
      const type = nextType(row);
      const prev = lanes.get(row - 1);
      const diff = 1 + Math.min(Math.max(row, 0), 400) / 260;
      const L = {
        row, type, kind: '', dir: R() < 0.5 ? 1 : -1, speed: 0,
        vehicles: [], logs: [], pads: new Set(), trees: new Map(), train: null,
        prevType: prev ? prev.type : '', vis: Math.floor(R() * 1e9),
      };
      if (type === 'grass') {
        let placed = 0;
        for (let c = -HALF; c <= HALF; c++) {
          let pr;
          if (row <= -3) pr = 1;
          else if (row <= 2) pr = c === 0 ? 0 : (row === 0 ? (Math.abs(c) >= 4 ? 0.35 : 0) : 0.14);
          else pr = 0.2;
          if (row > -3 && placed >= 5) pr = 0;
          if (R() < pr) { L.trees.set(c, R() < 0.2 ? 'rock' : 'tree'); placed++; }
        }
      } else if (type === 'road') {
        L.kind = R() < 0.25 ? 'truck' : 'car';
        L.speed = rand(1.4, 3.1) * diff * (L.kind === 'truck' ? 0.8 : 1);
        const len = L.kind === 'truck' ? 2.8 : 1.5;
        let x = -WRAP + rand(0, 3);
        while (x < WRAP - 1) {
          L.vehicles.push({ x: x + len / 2, len });
          x += len + rand(3, 7.5) * (L.kind === 'truck' ? 1.25 : 1);
        }
      } else if (type === 'river') {
        if (prev && prev.type === 'river' && prev.kind === 'logs') L.dir = -prev.dir;
        if (R() < 0.22 && !(prev && prev.type === 'river' && prev.kind === 'pads')) {
          L.kind = 'pads';
          const cols = [];
          for (let c = -HALF; c <= HALF; c++) cols.push(c);
          for (let i = cols.length - 1; i > 0; i--) {
            const j = Math.floor(R() * (i + 1));
            const tmp = cols[i]; cols[i] = cols[j]; cols[j] = tmp;
          }
          const n = randi(4, 6);
          for (let i = 0; i < n; i++) L.pads.add(cols[i]);
        } else {
          L.kind = 'logs';
          L.speed = rand(0.9, 1.9) * (1 + Math.min(Math.max(row, 0), 300) / 600);
          let x = -WRAP + rand(0, 2);
          while (x < WRAP - 1) {
            const len = pick([2, 3, 3, 4]);
            L.logs.push({ x: x + len / 2, len });
            x += len + rand(1.4, 3.2);
          }
        }
      } else if (type === 'rail') {
        L.train = { state: 'idle', t: rand(1.5, 6), x: 0, total: TRAIN_LEN };
      }
      lanes.set(row, L);
      return L;
    }

    function ensureLanes() {
      while (gen.row <= p.maxRow + 30) { makeLane(gen.row); gen.row++; }
      const cut = Math.floor(game.autoRow) - 16;
      for (const r of lanes.keys()) if (r < cut) lanes.delete(r);
    }

    function wrap(o, dir) {
      if (dir > 0 && o.x > WRAP + o.len / 2) o.x -= 2 * WRAP + o.len;
      if (dir < 0 && o.x < -WRAP - o.len / 2) o.x += 2 * WRAP + o.len;
    }

    function updateLanes() {
      const esc = game.escape;
      for (const L of lanes.values()) {
        if (L.type === 'road') {
          for (const v of L.vehicles) { v.x += L.dir * L.speed * DT; wrap(v, L.dir); }
          if (esc && esc.row === L.row && !p.dead && game.tick - esc.tick < 18) {
            for (const v of L.vehicles) {
              if (Math.abs(v.x - esc.x) < v.len / 2 + 0.25) { emit('close'); game.escape = null; break; }
            }
          }
        } else if (L.type === 'river' && L.kind === 'logs') {
          for (const lg of L.logs) { lg.x += L.dir * L.speed * DT; wrap(lg, L.dir); }
        } else if (L.type === 'rail') {
          const tr = L.train;
          tr.t -= DT;
          if (tr.state === 'idle' && tr.t <= 0) { tr.state = 'warn'; tr.t = 1.5; emit('warn', { row: L.row }); }
          if (tr.state === 'warn' && tr.t <= 0) {
            tr.state = 'go'; tr.x = -L.dir * (WRAP + tr.total / 2);
            emit('train', { row: L.row });
          }
          if (tr.state === 'go') {
            tr.x += L.dir * 28 * DT;
            if (Math.abs(tr.x) > WRAP + tr.total / 2 + 1) { tr.state = 'idle'; tr.t = rand(3.5, 9); }
            if (esc && esc.row === L.row && !p.dead && game.tick - esc.tick < 30 &&
                Math.abs(tr.x - esc.x) < tr.total / 2 + 0.3) { emit('whoosh'); game.escape = null; }
          }
        }
      }
    }

    function die(kind) {
      if (p.dead) return;
      p.dead = true; p.kind = kind; p.hop = null; p.queue = null;
      emit('die', { kind });
    }

    function move(d) {
      if (p.dead) return;
      if (p.hop) { p.queue = d; return; }
      const dx = DIRS[d][0], dr = DIRS[d][1];
      const cur = lanes.get(p.row), tr = p.row + dr, L = lanes.get(tr);
      if (!L) return;
      p.face = d;
      let tx;
      if (dr === 0) tx = p.log ? p.x + dx : Math.round(p.x) + dx;
      else tx = (L.type === 'river' && L.kind === 'logs' && p.log) ? p.x : Math.round(p.x);
      if (!(L.type === 'river' && p.log)) {
        const c = Math.round(tx);
        if (Math.abs(c) > HALF || (L.type === 'grass' && L.trees.has(c))) {
          p.hop = { fx: p.x, fr: p.row, tx: p.x, tr: p.row, t: 0, bump: true };
          emit('bump');
          return;
        }
        tx = c;
      }
      if (cur && dr !== 0 && (cur.type === 'road' || cur.type === 'rail')) game.escape = { row: cur.row, x: p.x, tick: game.tick };
      p.hop = { fx: p.x, fr: p.row, tx, tr, t: 0, bump: false };
      p.log = null;
      if (tr > p.maxRow) { p.maxRow = tr; emit('score'); }
      emit('hop');
    }

    function land() {
      const h = p.hop;
      p.hop = null;
      if (!h.bump) {
        p.row = h.tr; p.x = h.tx; p.px = p.x; p.pr = p.row;
        const L = lanes.get(p.row);
        if (L.type === 'river') {
          if (L.kind === 'logs') {
            let lg = null;
            for (const l of L.logs) if (Math.abs(p.x - l.x) <= l.len / 2 + 0.2) { lg = l; break; }
            if (!lg) { die('drown'); return; }
            const k = Math.max(0, Math.min(lg.len - 1, Math.round(p.x - lg.x + lg.len / 2 - 0.5)));
            p.log = lg; p.logOff = k - lg.len / 2 + 0.5;
            p.x = lg.x + p.logOff; p.px = p.x;
          } else {
            const c = Math.round(p.x);
            if (!L.pads.has(c)) { die('drown'); return; }
            p.x = c; p.px = c;
          }
        }
        emit('land');
      }
      if (p.queue !== null) { const q = p.queue; p.queue = null; move(q); }
    }

    function updatePlayer() {
      if (p.dead) return;
      if (p.hop) {
        const h = p.hop;
        h.t++;
        if (h.bump && p.log) { p.x = p.log.x + p.logOff; h.fx = p.x; h.tx = p.x; }
        const k = h.t / HOP_TICKS;
        p.px = h.fx + (h.tx - h.fx) * k;
        p.pr = h.fr + (h.tr - h.fr) * k;
        if (h.t >= HOP_TICKS) land();
      } else if (p.log) {
        p.x = p.log.x + p.logOff; p.px = p.x;
        if (Math.abs(p.x) > HALF + 1.6) { die('drown'); return; }
      }
      if (p.dead) return;
      const L = lanes.get(Math.round(p.pr));
      if (L && L.type === 'road') {
        for (const v of L.vehicles) if (Math.abs(v.x - p.px) < v.len / 2 + 0.3) { die('squash'); return; }
      }
      if (L && L.type === 'rail' && L.train.state === 'go' && Math.abs(L.train.x - p.px) < L.train.total / 2 + 0.3) { die('train'); return; }
      game.autoRow += (0.42 + Math.min(p.maxRow, 300) / 700) * DT;
      if (game.autoRow < p.pr - 4) game.autoRow = p.pr - 4;
      if (game.autoRow > p.pr + 2.5) die('eagle');
    }

    function input(d) {
      if (p.dead || game.inputs.length >= MAX_INPUTS) return;
      game.inputs.push([game.tick, d]);
    }

    function step() {
      if (p.dead) return false;
      if (game.tick >= MAX_TICKS) { die('time'); return false; }
      const inputs = game.inputs;
      while (game.cursor < inputs.length && inputs[game.cursor][0] === game.tick) {
        move(inputs[game.cursor][1]);
        game.cursor++;
      }
      updateLanes();
      updatePlayer();
      ensureLanes();
      game.tick++;
      return true;
    }

    ensureLanes();
    return game;
  }

  /* Server-side check: rebuild the run from its seed and inputs and return the real score. */
  function replay(seed, inputs) {
    if (!Array.isArray(inputs) || inputs.length > MAX_INPUTS) return { ok: false, error: 'Invalid input list' };
    let last = 0;
    for (const it of inputs) {
      if (!Array.isArray(it) || it.length !== 2 || !Number.isInteger(it[0]) || !Number.isInteger(it[1]) ||
          it[1] < 0 || it[1] > 3 || it[0] < last || it[0] >= MAX_TICKS) return { ok: false, error: 'Invalid input entry' };
      last = it[0];
    }
    const g = createGame(seed, { quiet: true });
    g.inputs = inputs.map(a => [a[0], a[1]]);
    while (g.step()) { /* run to the end */ }
    return { ok: true, score: g.p.maxRow, ticks: g.tick, kind: g.p.kind };
  }

  return { TPS, DT, HALF, WRAP, HOP_TICKS, MAX_TICKS, DIRS, createGame, replay, mulberry32 };
});
