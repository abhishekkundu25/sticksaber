// Fast, deterministic checks of the simulation and the run generator. No browser needed.
//   node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/game/world.js';
import { Director } from '../src/game/encounters.js';
import { BotInput } from '../src/game/bot.js';
import { MOVES, tempoMove, chainMove, fairTells } from '../src/game/moves.js';
import { ENEMIES } from '../src/game/enemies.js';
import { applyHit } from '../src/game/combat.js';
import { MAX_CUTS } from '../src/game/ragdoll.js';
import { seedRng } from '../src/core/math.js';
import { generateRun, waveBudget, maxPerWave, UNLOCK, FLOORS, DIFFS, FAMILIES, ANOMALIES, seedLabel, parseSeed } from '../src/game/gen.js';
import { AUGMENTS, AUG, buildMods, baseMods, draftAugments } from '../src/game/augments.js';
import { POWERS, POWER_IDS, draftPowers } from '../src/game/powers.js';

const DT = 1 / 120;
function boot(floor, seed, skill = 0.9, diff = 'normal', auto = true) {
  const world = new World();
  world.input = new BotInput(world, skill);
  const dir = new Director(world, { setArena: (id) => (id === 'hall' ? 1900 : 2200), auto });
  dir.startRun(floor - 1, seed, diff);
  return { world, dir };
}
function run({ world, dir }, seconds, { god = false, until } = {}) {
  for (let t = 0; t < seconds; t += DT) {
    world.input.tick(DT); world.step(DT); dir.update(DT);
    if (god && world.player.hp < world.player.maxHp * 0.5 && !world.player.dead) world.player.hp = world.player.maxHp;
    if (dir.state === 'dead' && dir.t > 1.5) dir.retry();
    if (until && until()) return t;
  }
  return seconds;
}
const digest = (world) => world.fighters.map((f) => `${f.def.kind}:${f.state}:${f.x.toFixed(3)}:${f.y.toFixed(3)}:${f.hp.toFixed(3)}`).join('|') + `#${world.stats.kills}:${world.time.toFixed(4)}`;
const finite = (world) => world.fighters.every((f) => [f.x, f.y, f.vx, f.vy, f.hp, f.posture, f.tx, f.ty, ...f.j, ...f.p].every(Number.isFinite));

test('the same seed replays the same fight exactly', () => {
  // One after the other: the simulation's random stream is global and re-seeded by each run.
  const a = boot(16, 1234); run(a, 20, { god: true });
  const first = digest(a.world);
  const b = boot(16, 1234); run(b, 20, { god: true });
  assert.equal(digest(b.world), first);
  const c = boot(16, 1235); run(c, 20, { god: true });
  assert.notEqual(digest(c.world), first);
});

const runKey = (run) => JSON.stringify([run.sectors.map((s) => [s.name, s.wings, s.hue, s.boss]), Object.values(run.roster.defs).map((d) => [d.name, d.color, d.scale, d.hp]),
  run.floors.map((f) => [f.kind, f.arenaSeed, f.anomaly, f.waves.map((w) => w.spawns.map((s) => [s.kind, s.dx, s.elite, s.temper]))])]);

test('a run is a pure function of its seed and difficulty', () => {
  assert.notEqual(runKey(generateRun(1)), runKey(generateRun(2)));
  assert.equal(runKey(generateRun(77)), runKey(generateRun(77)));
  assert.notEqual(runKey(generateRun(77, 'hard')), runKey(generateRun(77, 'normal')));
});

test('every generated run obeys the rules, across 60 seeds', () => {
  const families = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const run = generateRun(seed), { floors, roster } = run;
    const def = (k) => roster.defs[k] || ENEMIES[k];
    assert.equal(floors.length, FLOORS);
    assert.equal(run.sectors.length, 10);
    assert.equal(new Set(run.sectors.map((s) => s.name)).size, 10, 'sector names repeat');
    assert.equal(new Set(Object.values(roster.defs).map((d) => d.name)).size, Object.keys(roster.defs).length, 'generated names repeat');
    let forges = 0;
    for (const fl of floors) {
      const s = fl.sector;
      families.add(fl.arena);
      assert.ok(FAMILIES.includes(fl.arena));
      assert.equal(fl.kind === 'boss', fl.n % 10 === 0, `floor ${fl.n} is ${fl.kind}`);
      assert.equal(fl.kind === 'champion', fl.n % 10 === 5);
      assert.ok(fl.waves.length >= 1 && fl.waves.length <= 3);
      if (fl.anomaly) { assert.ok(ANOMALIES[fl.anomaly]); assert.ok(s > 0 && !fl.boss); }
      for (const w of fl.waves) {
        const kinds = w.spawns.map((sp) => sp.kind);
        assert.ok(kinds.length >= 1 && kinds.length <= (fl.kind === 'horde' ? 12 : maxPerWave(s)), `floor ${fl.n}: ${kinds.length} spawns`);
        for (const sp of w.spawns) {
          const d = def(sp.kind);
          assert.ok(d, `unknown enemy ${sp.kind}`);
          if (s === 0 && UNLOCK[sp.kind]) assert.ok(UNLOCK[sp.kind] <= fl.n, `${sp.kind} on floor ${fl.n}`);
          // A strain never turns up before the floor that introduces it.
          if (d.strain) { const q = +sp.kind[1], i = sp.kind[2] === 'a' ? 1 : 2; assert.ok(fl.n >= q * 10 + i, `${sp.kind} on floor ${fl.n}`); }
          assert.ok(Math.abs(sp.dx) >= 300 && Math.abs(sp.dx) <= 760, `spawn offset ${sp.dx}`);
          assert.ok(sp.t >= 0 && sp.t < 12);
          if (sp.elite) assert.ok(fl.n > 10, `elite on floor ${fl.n}`);
        }
        assert.ok(kinds.filter((k) => def(k).base === 'brute' || k === 'brute').length <= 2);
        assert.ok(w.attackers >= 1 && w.attackers <= 4);
      }
      if (fl.boss) { assert.deepEqual(fl.waves.map((w) => w.spawns.map((sp) => sp.kind)), [[fl.boss]]); assert.ok(def(fl.boss).boss); }
      if (fl.boss === 'forgemaster') { forges++; assert.ok(fl.n >= 20 && fl.n <= 50); }
      assert.equal(fl.reward, fl.n === FLOORS ? null : fl.kind === 'boss' ? 'legend' : fl.kind === 'champion' ? 'power' : fl.reward);
    }
    assert.equal(forges, 1, 'the Forgemaster appears exactly once');
    assert.equal(floors[99].boss, 'proctor');
    // Enemy colours keep clear of the player's cyan.
    for (const d of Object.values(roster.defs)) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(d.color.slice(i, i + 2), 16));
      assert.ok(!(b > 200 && g > 200 && r < 140), `${d.name} is too close to the player's colour: ${d.color}`);
    }
  }
  assert.equal(families.size, FAMILIES.length, 'every arena family is used');
});

test('the climb gets harder: budget, health and damage rise with the floor, and difficulty orders them', () => {
  for (let n = 2; n <= FLOORS; n++) assert.ok(waveBudget(n, 0) > waveBudget(n - 1, 0));
  const fl = generateRun(5).floors;
  for (let n = 1; n < FLOORS; n++) { assert.ok(fl[n].hp > fl[n - 1].hp); assert.ok(fl[n].dmg > fl[n - 1].dmg); assert.ok(fl[n].cd <= fl[n - 1].cd); }
  const threat = (diff) => { let sum = 0; for (let seed = 1; seed <= 12; seed++) for (const f of generateRun(seed, diff).floors) for (const w of f.waves) sum += w.spawns.length + w.spawns.filter((s) => s.elite).length; return sum; };
  assert.ok(threat('easy') < threat('normal') && threat('normal') < threat('hard'));
  assert.ok(DIFFS.easy.dmg < DIFFS.normal.dmg && DIFFS.normal.dmg < DIFFS.hard.dmg);
});

test('move data is well formed, generated moves included', () => {
  for (let seed = 1; seed <= 40; seed++) generateRun(seed);
  assert.ok(Object.keys(MOVES).length > 120, 'runs should have generated move variants');
  for (const [id, m] of Object.entries(MOVES)) {
    for (let i = 1; i < m.k.length; i++) assert.ok(m.k[i].t >= m.k[i - 1].t, `${id}: keys out of order`);
    for (const h of m.hits) { assert.ok(h.t0 < h.t1 && h.t1 <= m.dur, `${id}: hit window`); assert.ok(h.dmg > 0); }
    for (const [t] of m.ev) assert.ok(t >= 0 && t <= m.dur, `${id}: event at ${t}`);
    for (const nx of Object.values(m.next || {})) assert.ok(MOVES[nx], `${id}: next -> ${nx}`);
    if (m.landMove) assert.ok(MOVES[m.landMove]);
    // Every enemy attack that can hurt the player announces itself first, with time to react.
    if (m.fam === 'enemy' && m.hits.length && !/_land$|_slam$/.test(m.src)) {
      const tell = m.ev.filter((e) => e[1] === 'tele' && e[0] < m.hits[0].t0).map((e) => e[0]);
      assert.ok(tell.length, `${id}: no telegraph before its first hit`);
      assert.ok(m.hits[0].t0 - Math.max(...tell) >= 0.16, `${id}: telegraph too late`);
    }
  }
  const check = (def) => {
    for (const mv of [...(def.ai?.moves || []), ...(def.ai?.shots || []), ...(def.kit?.moves || [])]) assert.ok(MOVES[mv.id], `${def.kind}: unknown move ${mv.id}`);
    for (const id of [...(def.ai?.strikes || []), ...(def.kit?.strikes || [])]) assert.ok(MOVES[id], `${def.kind}: unknown strike ${id}`);
    if (def.counter) assert.ok(MOVES[def.counter]);
  };
  for (const def of Object.values(ENEMIES)) check(def);
  for (let seed = 1; seed <= 40; seed++) for (const def of Object.values(generateRun(seed).roster.defs)) check(def);
});

test('generated move variants keep their tells', () => {
  const quick = MOVES[tempoMove('br_swing', 0.82)], slow = MOVES[tempoMove('br_swing', 1.18)];
  assert.ok(quick.dur < MOVES.br_swing.dur && slow.dur > MOVES.br_swing.dur);
  assert.ok(quick.hits[0].dmg < MOVES.br_swing.hits[0].dmg && slow.hits[0].dmg > MOVES.br_swing.hits[0].dmg);
  assert.equal(tempoMove('br_leap', 0.82), 'br_leap', 'moves that jump are left alone');
  assert.equal(tempoMove('L1', 0.82), 'L1', 'player moves are left alone');
  const c = MOVES[chainMove('i_slash', 'ln_thrust')];
  assert.equal(c.hits.length, 2);
  assert.ok(c.ev.filter((e) => e[1] === 'tele').length >= 2, 'each half of a chain keeps its tell');
  assert.ok(fairTells(c));
  assert.equal(chainMove('i_slash', 'br_leap'), null);
});

test('the whole roster, hand-made and generated, fights for 12 seconds without errors', () => {
  for (const seed of [3, 11]) {
    const world = new World();
    world.input = new BotInput(world, 0.8);
    const dir = new Director(world, { setArena: () => 2200 });
    dir.startTraining();
    const R = generateRun(seed).roster;
    world.roster = R.defs;
    for (const k of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0']) dir.trainingKey(k);
    R.strains.flat().forEach((id, i) => world.spawnEnemy(id, -900 + i * 100, true));
    world.spawnEnemy(R.champions[seed % 10], 300, true); world.spawnEnemy(R.wardens[seed % 9], -300, true);
    for (let t = 0; t < 12; t += DT) { world.input.tick(DT); world.step(DT); dir.update(DT); if (world.player.hp < 50) world.player.hp = 100; assert.ok(finite(world), `non-finite state at t=${t.toFixed(2)}`); }
  }
});

test('a competent player clears floor 1 in under two minutes of game time', () => {
  const g = boot(1, 99);
  const t = run(g, 120, { until: () => g.dir.stage > 0 });
  assert.ok(t < 120, 'floor 1 was not cleared');
});

test('bosses can be beaten: a generated champion and warden, the Forgemaster and the Proctor', () => {
  const beat = (floor, seed, secs) => { const g = boot(floor, seed); return run(g, secs, { god: true, until: () => g.dir.stage >= floor || g.dir.state === 'victory' }) < secs; };
  for (const seed of [7, 19]) {
    assert.ok(beat(5, seed, 200), `champion of seed ${seed} not beaten`);
    assert.ok(beat(10, seed, 300), `first warden of seed ${seed} not beaten`);
    assert.ok(beat(60, seed, 400), `warden on floor 60 of seed ${seed} not beaten`);
  }
  const forge = generateRun(7).floors.find((f) => f.boss === 'forgemaster').n;
  assert.ok(beat(forge, 7, 300), 'Forgemaster not beaten');
  assert.ok(beat(100, 7, 500), 'Proctor not beaten');
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

// ───────────── the build, the powers, the draft ─────────────
test('augments reduce to one modifier table and respect their caps', () => {
  assert.deepEqual(buildMods({}), baseMods());
  assert.equal(new Set(AUGMENTS.map((a) => a.id)).size, AUGMENTS.length);
  const all = Object.fromEntries(AUGMENTS.map((a) => [a.id, a.max]));
  const m = buildMods(all);
  for (const [k, v] of Object.entries(m)) assert.ok(Number.isFinite(v), `${k} is ${v}`);
  assert.ok(m.dmg > 1.4 && m.dmg < 2, `full damage stack is ${m.dmg}`);
  assert.ok(m.taken > 0.6 && m.taken < 1);
  for (const a of AUGMENTS) for (let n = 1; n <= a.max; n++) assert.ok(a.text(n).length > 8);
  // A draft offers three different augments, never one that is already full, and legendaries after a boss.
  const r = () => 0.37;
  const offer = draftAugments({}, r, 0, 1);
  assert.equal(new Set(offer).size, 3);
  assert.ok(draftAugments({}, r, 2, 10).every((id) => AUG[id].r === 2));
  const full = { ...all }; delete full.edge;
  assert.deepEqual(draftAugments(full, r, 0, 50), ['edge']);
  assert.deepEqual(draftAugments(all, r, 0, 50), []);
});

test('the build changes the fight: damage, health, focus pips and Second Wind', () => {
  const { world, p, foes: [a] } = room(['brute']);
  p.startMove('L1');
  let hp = a.hp; applyHit(world, p, a, LIGHT, a.cx, a.cy);
  const plain = hp - a.hp;
  world.setBuild({ edge: 5, whet: 1, vigor: 2, well: 1, wind: 1 });
  assert.equal(p.maxHp, 124); assert.equal(world.maxFocus, 400);
  world.style.reset(); p.hitSet.clear(); p.startMove('L1');
  hp = a.hp; applyHit(world, p, a, LIGHT, a.cx, a.cy);
  assert.ok(hp - a.hp > plain * 1.5, `damage with a build: ${hp - a.hp} against ${plain}`);
  // A killing blow is refused once, then it is final.
  p.invuln = 0; p.hp = 5;
  applyHit(world, null, p, { ...HEAVY, dir: -1 }, p.cx, p.cy);
  assert.ok(!p.dead && p.hp > 30, 'Second Wind should save the player');
  p.invuln = 0; if (p.rag) p.getUp(0.1); p.invuln = 0;
  applyHit(world, null, p, { ...HEAVY, dir: -1 }, p.cx, p.cy);
  assert.ok(p.dead, 'it only works once a floor');
});

test('every focus power fires, costs what it says and does its job', () => {
  for (const id of POWER_IDS) {
    const { world, p, foes } = room(['initiate', 'initiate', 'initiate'], 130);
    world.powers = [id]; world.powerIdx = 0; world.lockInput = false; // the player's own brain runs Flash Step
    const P = POWERS[id];
    world.focus = P.cost * 100 - 1;
    assert.equal(world.usePower(p), false, `${id} should need ${P.cost} pips`);
    world.focus = 300; p.hp = 40; p.facing = 1;
    assert.ok(world.usePower(p), `${id} did not fire`);
    assert.equal(world.focus, 300 - P.cost * 100, `${id} cost`);
    const hp0 = foes.reduce((s, f) => s + f.maxHp, 0);
    for (let i = 0; i < 300; i++) world.step(DT);
    const hp1 = foes.reduce((s, f) => s + Math.max(0, f.hp), 0);
    if (id === 'mend') assert.ok(p.hp > 55, 'mend heals');
    else if (id === 'stasis') assert.ok(world.witch > 0, 'stasis slows the enemies');
    else if (id === 'mirror') assert.ok(world.mirror && world.mirror.phantom && world.mirror.team === 0, 'mirror spawns an image');
    else assert.ok(hp1 < hp0, `${id} did no damage`);
    assert.ok(finite(world), `${id} left a non-finite state`);
    assert.equal(p.state === 'custom', false, `${id} left the player stuck`);
  }
});

test('the selected power can be changed at any time', () => {
  const { world, p } = room([]);
  world.powers = ['throw', 'arc', 'nova'];
  assert.equal(world.power.name, 'SABER THROW');
  world.cyclePower(1); assert.equal(world.power.name, 'ARC');
  world.cyclePower(1); world.cyclePower(1); assert.equal(world.powerIdx, 0);
  assert.ok(world.selectPower('nova')); assert.equal(world.powerIdx, 2);
  assert.ok(world.selectPower(1)); assert.equal(world.power.name, 'ARC');
  assert.equal(world.selectPower(7), false);
  // The mirror image repeats the player's attack and disappears on time.
  world.powers = ['mirror']; world.powerIdx = 0; world.focus = 300;
  assert.ok(world.usePower(p));
  for (let i = 0; i < 60; i++) world.step(DT);
  p.startMove('L1');
  let copied = false;
  for (let i = 0; i < 60; i++) { world.step(DT); if (world.mirror?.move?.id === 'L1') copied = true; }
  assert.ok(copied, 'the image should repeat L1');
  for (let i = 0; i < 120 * 11; i++) world.step(DT);
  assert.equal(world.mirror, null);
});

test('clearing a floor opens a draft, and the pick carries into the next floor and into a saved run', () => {
  const saves = [];
  const world = new World(); world.input = new BotInput(world, 0.9);
  const dir = new Director(world, { setArena: () => 2200, onFloor: (s) => saves.push(s) });
  dir.startRun(0, 99);
  let t = 0;
  for (; t < 200 && dir.state !== 'draft'; t += DT) { world.input.tick(DT); world.step(DT); dir.update(DT); if (world.player.hp < 50) world.player.hp = 100; }
  assert.equal(dir.state, 'draft', 'no draft after floor 1');
  assert.equal(dir.draft.options.length, 3);
  const id = dir.draft.options[2];
  dir.choose(2);
  assert.equal(dir.build[id], 1);
  for (let i = 0; i < 240 && dir.stage === 0; i++) { world.step(DT); dir.update(DT); }
  assert.equal(dir.stage, 1);
  assert.deepEqual(saves[saves.length - 1].build, { [id]: 1 });
  assert.equal(saves[saves.length - 1].floor, 2);
  // Resume from the save: same seed, same floor, same build.
  const w2 = new World(); w2.input = new BotInput(w2, 0.9);
  const d2 = new Director(w2, { setArena: () => 2200, auto: true });
  const sv = saves[saves.length - 1];
  d2.startRun(sv.floor - 1, sv.seed, sv.diff, sv);
  assert.deepEqual(d2.build, dir.build);
  assert.deepEqual(d2.floors[1].waves, dir.floors[1].waves);
  // A champion pays out a power, a keeper a legendary.
  const g = boot(6, 99);
  assert.equal(g.world.powers.length, 2, 'starting above floor 5 should come with the champion\'s power');
  assert.ok(draftPowers(g.world.powers, () => 0.5).every((p) => !g.world.powers.includes(p)));
  const h = boot(11, 99);
  assert.ok(Object.keys(h.dir.build).some((k) => AUG[k].r === 2), 'starting above floor 10 should come with a legendary');
});

test('strain traits work: splitters split, vampires feed, shards and orbs appear', () => {
  const { world, p, foes: [a] } = room(['initiate']);
  a.tr = { splitter: 1 };
  applyHit(world, p, a, HEAVY, a.cx, a.cy);
  assert.equal(world.fighters.filter((f) => f.def.kind === 'shard').length, 2);
  const v = world.spawnEnemy('duelist', 200, false); v.tr = { vampiric: 1 }; v.hp = 50;
  p.invuln = 0; applyHit(world, v, p, LIGHT, p.cx, p.cy);
  assert.ok(v.hp > 50, 'a vampiric strain heals when it hits');
  const r = world.spawnEnemy('duelist', 400, false); r.tr = { regen: 1 }; r.hp = 50; r.def = { ...r.def, ctrl: null };
  for (let i = 0; i < 120 * 5; i++) world.step(DT);
  assert.ok(r.hp > 55, 'a regenerating strain heals when left alone');
  world.orbs.push({ kind: 'hp', x: p.x + 40, y: -40, vx: 0, vy: 0, t: 1 });
  p.hp = 50; world.clearEnemies();
  for (let i = 0; i < 120; i++) world.step(DT);
  assert.equal(world.orbs.length, 0); assert.ok(p.hp >= 54);
});

