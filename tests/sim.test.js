// Fast, deterministic checks of the simulation and the run generator. No browser needed.
//   node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/game/world.js';
import { Director } from '../src/game/encounters.js';
import { BotInput } from '../src/game/bot.js';
import { MOVES } from '../src/game/moves.js';
import { ENEMIES } from '../src/game/enemies.js';
import { generateRun, generateFloor, waveBudget, UNLOCK, COST, MAX_PER_WAVE, FLOORS, seedLabel, parseSeed } from '../src/game/gen.js';

const DT = 1 / 120;
function boot(floor, seed, skill = 0.9) {
  const world = new World();
  world.input = new BotInput(world, skill);
  const dir = new Director(world, { setArena: (id) => (id === 'hall' ? 1900 : 2200) });
  dir.startRun(floor - 1, seed);
  return { world, dir };
}
function run({ world, dir }, seconds, { god = false, until } = {}) {
  for (let t = 0; t < seconds; t += DT) {
    world.input.tick(DT); world.step(DT); dir.update(DT);
    if (god && world.player.hp < 50 && !world.player.dead) world.player.hp = 100;
    if (dir.state === 'dead' && dir.t > 1.5) dir.retry();
    if (until && until()) return t;
  }
  return seconds;
}
const digest = (world) => world.fighters.map((f) => `${f.def.kind}:${f.state}:${f.x.toFixed(3)}:${f.y.toFixed(3)}:${f.hp.toFixed(3)}`).join('|') + `#${world.stats.kills}:${world.time.toFixed(4)}`;
const finite = (world) => world.fighters.every((f) => [f.x, f.y, f.vx, f.vy, f.hp, f.posture, f.tx, f.ty, ...f.j, ...f.p].every(Number.isFinite));

test('the same seed replays the same fight exactly', () => {
  // One after the other: the simulation's random stream is global and re-seeded by each run.
  const a = boot(6, 1234); run(a, 20, { god: true });
  const first = digest(a.world);
  const b = boot(6, 1234); run(b, 20, { god: true });
  assert.equal(digest(b.world), first);
  const c = boot(6, 1235); run(c, 20, { god: true });
  assert.notEqual(digest(c.world), first);
});

test('different seeds give different runs', () => {
  const key = (seed) => JSON.stringify(generateRun(seed).map((f) => [f.arenaSeed, f.waves.map((w) => w.spawns.map((s) => [s.kind, s.dx, s.elite, s.temper]))]));
  assert.notEqual(key(1), key(2));
  assert.equal(key(77), key(77));
});

test('every generated wave obeys the rules, across 300 seeds', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const floors = generateRun(seed);
    assert.equal(floors.length, FLOORS);
    for (const fl of floors) {
      assert.ok(fl.waves.length >= 1 && fl.waves.length <= 4);
      for (const w of fl.waves) {
        const kinds = w.spawns.map((s) => s.kind);
        assert.ok(kinds.length >= 1 && kinds.length <= MAX_PER_WAVE, `floor ${fl.n}: ${kinds.length} spawns`);
        for (const s of w.spawns) {
          assert.ok(ENEMIES[s.kind], `unknown enemy ${s.kind}`);
          if (!ENEMIES[s.kind].boss) assert.ok(UNLOCK[s.kind] <= fl.n, `${s.kind} on floor ${fl.n}`);
          assert.ok(Math.abs(s.dx) >= 300 && Math.abs(s.dx) <= 760, `spawn offset ${s.dx}`);
          assert.ok(s.t >= 0 && s.t < 8);
          if (s.elite) assert.ok(fl.n >= 8, `elite on floor ${fl.n}`);
        }
        assert.ok(kinds.filter((k) => k === 'brute').length <= 1);
        assert.ok(kinds.filter((k) => k === 'marksman' || k === 'drone').length <= 3);
        assert.ok(w.attackers >= 1 && w.attackers <= 3);
      }
      if (fl.boss) assert.deepEqual(fl.waves.map((w) => w.spawns.map((s) => s.kind)), [[fl.boss]]);
    }
    assert.equal(floors[4].boss, 'forgemaster');
    assert.equal(floors[9].boss, 'proctor');
  }
});

test('threat grows with the floor', () => {
  const threat = (n) => { let sum = 0, count = 0; for (let seed = 1; seed <= 60; seed++) for (const w of generateFloor(n, seed).waves) { sum += w.spawns.reduce((a, s) => a + COST[s.kind] + (s.elite ? 1 : 0), 0); count++; } return sum / count; };
  const t = [1, 2, 3, 4, 6, 7, 8, 9].map(threat);
  for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1] - 0.4, `floor threat fell: ${t.map((v) => v.toFixed(1))}`);
  assert.ok(t[t.length - 1] > t[0] * 2);
  assert.ok(waveBudget(9, 3) > waveBudget(1, 0));
});

test('move data is well formed', () => {
  for (const [id, m] of Object.entries(MOVES)) {
    for (let i = 1; i < m.k.length; i++) assert.ok(m.k[i].t >= m.k[i - 1].t, `${id}: keys out of order`);
    for (const h of m.hits) { assert.ok(h.t0 < h.t1 && h.t1 <= m.dur, `${id}: hit window`); assert.ok(h.dmg > 0); }
    for (const [t] of m.ev) assert.ok(t >= 0 && t <= m.dur, `${id}: event at ${t}`);
    for (const nx of Object.values(m.next || {})) assert.ok(MOVES[nx], `${id}: next -> ${nx}`);
    if (m.landMove) assert.ok(MOVES[m.landMove]);
    // Every enemy attack that can hurt the player announces itself first.
    if (m.fam === 'enemy' && m.hits.length && !/_land$|_slam$/.test(id)) assert.ok(m.ev.some((e) => e[1] === 'tele' && e[0] < m.hits[0].t0), `${id}: no telegraph before its first hit`);
  }
  for (const def of Object.values(ENEMIES)) {
    for (const mv of def.ai?.moves || []) assert.ok(MOVES[mv.id], `${def.kind}: unknown move ${mv.id}`);
    if (def.counter) assert.ok(MOVES[def.counter]);
  }
});

test('the whole roster fights for 12 seconds without errors', () => {
  const world = new World();
  world.input = new BotInput(world, 0.8);
  const dir = new Director(world, { setArena: () => 2200 });
  dir.startTraining();
  for (const k of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0']) dir.trainingKey(k);
  for (let t = 0; t < 12; t += DT) { world.input.tick(DT); world.step(DT); dir.update(DT); if (world.player.hp < 50) world.player.hp = 100; assert.ok(finite(world), `non-finite state at t=${t.toFixed(2)}`); }
});

test('a competent player clears floor 1 in under two minutes of game time', () => {
  const g = boot(1, 99);
  const t = run(g, 120, { until: () => g.dir.stage > 0 });
  assert.ok(t < 120, 'floor 1 was not cleared');
});

test('both bosses can be beaten', () => {
  const forge = boot(5, 7);
  assert.ok(run(forge, 240, { god: true, until: () => forge.dir.stage > 4 }) < 240, 'Forgemaster not beaten');
  const proctor = boot(10, 7);
  assert.ok(run(proctor, 360, { god: true, until: () => proctor.dir.state === 'victory' }) < 360, 'Proctor not beaten');
});

test('seed labels round-trip', () => {
  for (const s of [1, 42, 123456, 2176782335]) assert.equal(parseSeed(seedLabel(s)), s);
  assert.equal(parseSeed(''), 0);
});
