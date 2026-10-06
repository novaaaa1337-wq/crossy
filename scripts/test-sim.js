// Plays many bot runs live (the way the browser does), then replays each one the way the
// server does, and checks the scores match. Also checks that edited inputs are caught.
const Sim = require('../public/sim.js');
const assert = require('assert');

function botRun(seed) {
  const g = Sim.createGame(seed);
  const R = Sim.mulberry32(seed ^ 0xabcdef);
  while (g.step()) {
    if (g.tick % 9 === 0) {
      const r = R();
      g.input(r < 0.7 ? 0 : r < 0.8 ? 2 : r < 0.9 ? 3 : 1);
    }
    g.events.length = 0;
  }
  return { score: g.p.maxRow, ticks: g.tick, kind: g.p.kind, inputs: g.inputs };
}

let total = 0, best = 0, mismatches = 0;
const t0 = Date.now();
for (let i = 0; i < 300; i++) {
  const seed = (Math.random() * 2 ** 32) >>> 0;
  const live = botRun(seed);
  const rep = Sim.replay(seed, live.inputs);
  if (!rep.ok || rep.score !== live.score || rep.ticks !== live.ticks) mismatches++;
  total += live.score; best = Math.max(best, live.score);
}
console.log(`300 runs replayed in ${Date.now() - t0} ms, mismatches: ${mismatches}, avg score ${(total / 300).toFixed(1)}, best ${best}`);
assert.strictEqual(mismatches, 0);

// A forged score must not survive replay.
const seed = 12345;
const live = botRun(seed);
const forged = live.inputs.concat(Array.from({ length: 200 }, (_, i) => [live.ticks + 10 + i * 9, 0]));
const rep = Sim.replay(seed, forged);
assert.strictEqual(rep.score, live.score, 'inputs after death must not add score');
assert.strictEqual(Sim.replay(seed, [[5, 0], [3, 0]]).ok, false, 'out-of-order inputs are rejected');
assert.strictEqual(Sim.replay(seed, [[5, 9]]).ok, false, 'unknown directions are rejected');

// Idle player is taken by the eagle in a few seconds.
const idle = Sim.replay(1, []);
assert.strictEqual(idle.kind, 'eagle');
console.log(`idle run ends by eagle after ${(idle.ticks / 60).toFixed(1)} s`);
console.log('sim tests passed');
