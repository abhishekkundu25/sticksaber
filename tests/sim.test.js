// Fast, deterministic checks of the simulation and the run generator. No browser needed.
//   node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/game/world.js';
import { Director } from '../src/game/encounters.js';
import { BotInput } from '../src/game/bot.js';
import { MOVES } from '../src/game/moves.js';
import { ENEMIES } from '../src/game/enemies.js';
import { applyHit } from '../src/game/combat.js';
import { MAX_CUTS } from '../src/game/ragdoll.js';
import { seedRng } from '../src/core/math.js';
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

// A quiet room with the player and passive targets, for testing one mechanic at a time.
function room(kinds = ['initiate'], gap = 120) {
  seedRng(5);
  const world = new World();
  world.input = new BotInput(world, 0); world.lockInput = true;
  world.setArena(2200);
  const p = world.spawnPlayer(0);
  const foes = kinds.map((k, i) => { const e = world.spawnEnemy(k, gap * (i + 1), false); e.def = { ...e.def, ctrl: null }; return e; });
  for (let i = 0; i < 30; i++) world.step(DT);
  return { world, p, foes };
}
const HEAVY = { dmg: 999, post: 10, kx: 300, ky: -300, kind: 'knock', stop: 0, shake: 0, stun: 0.3 };
const LIGHT = { dmg: 5, post: 10, kx: 200, ky: 0, kind: 'flinch', stop: 0, shake: 0, stun: 0.3 };

test('killing blows cut the body, and further hits cut it into more pieces', () => {
  const { world, p, foes: [a, b] } = room(['initiate', 'initiate']);
  a.hp = 1; applyHit(world, p, a, LIGHT, a.cx, a.cy);
  assert.ok(a.dead);
  assert.equal(a.rag.pieces, 2, 'a light kill cuts once');
  applyHit(world, p, b, HEAVY, b.cx, b.cy);
  assert.equal(b.rag.pieces, 3, 'a heavy kill cuts twice');
  p.hitSet.clear(); applyHit(world, p, b, LIGHT, b.rag.x[2], b.rag.y[2]);
  assert.equal(b.rag.pieces, 4, 'hitting the corpse cuts again');
  for (let i = 0; i < 30; i++) { p.hitSet.clear(); applyHit(world, p, b, LIGHT, b.rag.x[1], b.rag.y[1]); }
  assert.ok(b.rag.pieces <= MAX_CUTS + 1, 'the number of cuts is capped');
  for (let i = 0; i < 240; i++) world.step(DT);
  assert.ok(Array.from(b.rag.x.subarray(0, b.rag.n)).every(Number.isFinite) && Array.from(b.rag.y.subarray(0, b.rag.n)).every(Number.isFinite));
  assert.ok(world.stats.cuts >= 4);
});

test('burst costs one pip, frees the player and throws enemies back', () => {
  const { world, p, foes: [a, big] } = room(['initiate', 'brute']);
  world.focus = 100;
  p.setState('hitstun', 2);
  assert.ok(world.burst(p));
  assert.equal(world.focus, 0);
  assert.equal(p.state, 'free');
  assert.ok(p.invuln > 0.5);
  assert.ok(a.rag && a.hp === a.maxHp, 'a light enemy is thrown, undamaged');
  assert.equal(big.state, 'recoil', 'a heavy enemy is interrupted, not thrown');
  world.focus = 300; p.setState('hitstun', 2);
  assert.equal(world.burst(p), false, 'it has a cooldown');
  assert.equal(world.focus, 300);
});

test('overdrive needs a full meter, stops staleness and reads, and ends when the player is hit', () => {
  const { world, p, foes: [d] } = room(['duelist']);
  world.focus = 200;
  assert.equal(world.startOverdrive(p), false);
  world.focus = 300;
  assert.ok(world.startOverdrive(p));
  assert.equal(world.focus, 0);
  assert.ok(p.bladeLen > p.def.blade.len && p.rate > 1);
  for (let i = 0; i < 6; i++) assert.equal(world.style.land('L1', true).mul, 1.12);
  // A Duelist that has read light attacks cannot turn them aside during Overdrive.
  d.adapt.light = 99; d.facing = -1; p.facing = 1;
  p.startMove('L1'); const hp = d.hp;
  assert.equal(applyHit(world, p, d, LIGHT, d.cx, d.cy), 'hit');
  assert.ok(d.hp < hp - 5, 'full damage, not a glancing 40%');
  world.gainFocus(50); assert.equal(world.focus, 0, 'no focus is earned while it runs');
  p.invuln = 0; applyHit(world, null, p, { ...LIGHT, dir: -1 }, p.cx, p.cy);
  assert.equal(world.overdrive, 0);
  assert.equal(p.bladeLen, p.def.blade.len); assert.equal(p.rate, 1); assert.equal(p.color, p.def.color);
});

test('overdrive runs out after six seconds', () => {
  const { world, p } = room([]);
  world.focus = 300; world.startOverdrive(p);
  for (let t = 0; t < 5.5; t += DT) world.step(DT);
  assert.ok(world.overdrive > 0);
  for (let t = 0; t < 1.2; t += DT) world.step(DT);
  assert.equal(world.overdrive, 0);
  assert.equal(p.rate, 1);
});

test('hit-stop is rationed: a crowd fight still runs at close to full speed', () => {
  const speed = (n) => {
    seedRng(7);
    const world = new World(); world.input = new BotInput(world, 0.9);
    const dir = new Director(world, { setArena: () => 2200 });
    dir.startTraining(); world.clearEnemies();
    const keys = ['Digit1', 'Digit1', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit6', 'Digit7', 'Digit8'];
    for (let i = 0; i < n; i++) dir.trainingKey(keys[i % keys.length]);
    for (let i = 0; i < 240; i++) { world.input.tick(DT); world.step(DT); dir.update(DT); }
    const t0 = world.time; let real = 0, lowest = 1;
    for (let i = 0; i < 120 * 20; i++) {
      world.input.tick(DT); world.step(DT); dir.update(DT); real += DT;
      if (world.player.hp < 60) world.player.hp = 100;
      if (world.countEnemies() < n && i % 30 === 0) dir.trainingKey(keys[i % keys.length]);
      lowest = Math.min(lowest, world.stopBank);
    }
    assert.ok(lowest > -0.1, `hit-stop bank overdrawn to ${lowest}`);
    return (world.time - t0) / real;
  };
  const duel = speed(3), crowd = speed(60);
  assert.ok(crowd > 0.8, `a 60-enemy fight ran at ${(crowd * 100).toFixed(0)}% speed`);
  // A small fight keeps its full freezes: it is frozen a good fifth of the time, as designed.
  assert.ok(duel > 0.65 && duel < 0.85, `a 3-enemy fight ran at ${(duel * 100).toFixed(0)}% speed`);
});
