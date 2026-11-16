// Checks of what carries over between runs (src/core/meta.js): feats, boons, storage and filing.
//   node --test tests/meta.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Meta, FEATS, FEAT, KEEPERS, BASES, bossKey, progress } from '../src/core/meta.js';
import { BOON_IDS } from '../src/game/boons.js';
import { BEAST_PLANS } from '../src/game/beasts.js';
import { FORM_IDS } from '../src/game/forms.js';
import { SURPRISES, OBJECTIVES, generateRun } from '../src/game/gen.js';
import { ENEMIES } from '../src/game/enemies.js';

// A stand-in for localStorage.
const fakeStore = (init = {}) => { const m = { ...init }; return { m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };
const fresh = () => new Meta(fakeStore());
// The kill event world.js sends, and a world that knows the defs behind it.
const kill = (def) => ({ type: 'kill', kind: def.kind, left: 0, boss: !!def.boss, x: 0, beast: def.beast, base: def.base, elite: null, air: false });
const worldOf = (...defs) => ({ fighters: [], formId: 'saber', def: (k) => defs.find((d) => d.kind === k) || ENEMIES[k] });

test('every boon is earned by at least one feat, and every feat names a real boon', () => {
  for (const id of BOON_IDS) assert.ok(FEATS.some((f) => f.boon === id), `no feat earns ${id}`);
  for (const f of FEATS) assert.ok(BOON_IDS.includes(f.boon), `${f.id} names ${f.boon}`);
  assert.ok(FEATS.length >= 10 && FEATS.length <= 14);
  assert.equal(new Set(FEATS.map((f) => f.id)).size, FEATS.length);
});

test('feat tests read hand-built data', () => {
  const m = fresh(), D = m.data;
  for (const f of FEATS) assert.equal(progress(f, D)[0], 0, `${f.id} starts at zero`);
  D.kills = { initiate: 3, marksman: 1, hound: 2 };
  assert.deepEqual(progress(FEAT.rollcall, D), [2, BASES.length]);
  assert.deepEqual(progress(FEAT.bestiary, D), [1, BEAST_PLANS.length]);
  D.bosses = { forgemaster: 1, 'warden:phantom': 2, shade: 1, champion: 4 };
  assert.deepEqual(progress(FEAT.keeper, D), [1, 1]);
  assert.deepEqual(progress(FEAT.keepers, D), [2, 6], 'the Shade and champions are not keepers');
  D.feats = { untouched: 2, parry: 2 };
  assert.deepEqual(progress(FEAT.challenger, D), [4, 5]);
  D.clears = { 'climb:normal': 1 };
  assert.equal(progress(FEAT.sprinter, D)[0], 0);
  D.clears['sprint:easy'] = 2;
  assert.equal(progress(FEAT.sprinter, D)[0], 1);
  assert.equal(progress(FEAT.master, D)[0], 0);
  D.clears['climb:hard'] = 1;
  assert.equal(progress(FEAT.master, D)[0], 1);
  D.forms = Object.fromEntries(FORM_IDS.map((id) => [id, 1]));
  assert.equal(progress(FEAT.arms, D)[0], progress(FEAT.arms, D)[1]);
  D.objectives = { survive: 1, bogus: 9 };
  assert.deepEqual(progress(FEAT.tasks, D), [1, Object.keys(OBJECTIVES).length], 'unknown keys do not count');
  D.surprises = Object.fromEntries(Object.keys(SURPRISES).map((s) => [s, 1]));
  assert.equal(progress(FEAT.strange, D)[0], progress(FEAT.strange, D)[1]);
  D.shades = 1;
  assert.deepEqual(progress(FEAT.shade, D), [1, 1]);
});

test('boons() lists a boon only when every feat that names it is done', () => {
  const m = fresh();
  assert.deepEqual(m.boons(), []);
  m.data.done.keeper = true;
  assert.deepEqual(m.boons(), ['hardened']);
  const pair = FEATS.filter((f) => f.boon === 'phoenix');
  assert.ok(pair.length >= 2, 'the last boon takes more than one feat');
  m.data.done[pair[0].id] = true;
  assert.ok(!m.boons().includes('phoenix'));
  for (const f of pair) m.data.done[f.id] = true;
  assert.ok(m.boons().includes('phoenix'));
  for (const f of FEATS) m.data.done[f.id] = true;
  assert.deepEqual([...m.boons()].sort(), [...BOON_IDS].sort());
});

test('corrupt, old or missing storage never throws', () => {
  assert.doesNotThrow(() => new Meta());
  assert.doesNotThrow(() => new Meta(null));
  const bad = ['{', 'null', '42', '"x"', '[]', JSON.stringify({ v: 9, runs: 5 }),
    JSON.stringify({ v: 2, kills: null, bosses: [], runs: 'x', wins: -1, best: { 'sprint:normal': 'high' }, done: 'all', seen: { a: 'b' } })];
  for (const raw of bad) {
    const m = new Meta(fakeStore({ 'sticksaber.meta': raw }));
    assert.equal(m.data.v, 2);
    assert.equal(typeof m.data.runs, 'number');
    assert.ok(m.data.runs >= 0 && m.data.wins >= 0);
    assert.doesNotThrow(() => m.note(kill(ENEMIES.initiate), worldOf(), null));
    assert.doesNotThrow(() => m.note({ type: 'run', mode: 'sprint', diff: 'normal', score: 10, floor: 3, won: false }, worldOf(), null));
    assert.deepEqual(m.boons(), []);
  }
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
  const m = new Meta(throwing);
  assert.doesNotThrow(() => m.note({ type: 'floor', n: 1 }, worldOf(), null));
});

test('a version 1 save carries over, wins included, and earns its feats without announcing them', () => {
  const v1 = { v: 1, kills: { initiate: 4 }, bosses: { forgemaster: 1 }, surprises: {}, feats: { swift: 1 }, objectives: {}, forms: { saber: 3 }, runs: 2, wins: 1,
    best: { 'sprint:normal': { score: 900, floor: 30, won: true } }, floors: 31, shades: 0 };
  const m = new Meta(fakeStore({ 'sticksaber.meta': JSON.stringify(v1) }));
  assert.equal(m.data.v, 2);
  assert.equal(m.data.kills.initiate, 4);
  assert.equal(m.data.clears['sprint:normal'], 1);
  assert.ok(m.data.done.keeper && m.data.done.sprinter);
  assert.deepEqual(m.fresh, []);
  assert.ok(m.boons().includes('hardened') && m.boons().includes('fleet'));
});

test('note files events where the codex reads them', () => {
  const store = fakeStore(), m = new Meta(store);
  const strain = { kind: 's1a', base: 'lancer', name: 'Pike' }, animal = { kind: 'b3', base: 'raptor', beast: 'raptor' };
  const warden = { kind: 'w2', base: 'pikelord', boss: true, warden: true }, champ = { kind: 'c1', base: 'brute', boss: true, champion: true };
  const w = worldOf(strain, animal, warden, champ);
  m.note(kill(strain), w, null);
  m.note(kill(animal), w, null);
  m.note(kill(ENEMIES.drone), w, null);
  assert.deepEqual(m.data.kills, { lancer: 1, raptor: 1, drone: 1 });
  m.note(kill(warden), w, null);
  m.note(kill(champ), w, null);
  m.note(kill(ENEMIES.twinA), w, null);
  m.note({ type: 'kill', kind: 'shade', boss: true }, w, null);
  assert.deepEqual(m.data.bosses, { 'warden:pikelord': 1, champion: 1, twin: 1, shade: 1 });
  assert.equal(m.data.shades, 1);
  m.note({ type: 'surprise', kind: 'storm' }, w, null);
  m.note({ type: 'feat', kind: 'parry' }, w, null);
  assert.equal(m.data.surprises.storm, 1);
  assert.equal(m.data.feats.parry, 1);
  w.formId = 'staff';
  m.note({ type: 'floor', n: 1, kind: 'normal', objective: 'hold' }, w, null);
  assert.equal(m.data.floors, 1);
  assert.equal(m.data.objectives.hold, 1);
  assert.equal(m.data.forms.staff, 1);
  // A fighter on the floor counts as met even if it is never beaten.
  w.fighters = [{ team: 1, def: { kind: 'x', base: 'wraith' } }, { team: 0, def: { kind: 'player' } }, { team: 1, def: ENEMIES.cartographer }];
  m.note({ type: 'playerDead' }, w, null);
  assert.equal(m.data.seen.wraith, 1);
  assert.equal(m.data.seen.cartographer, 1);
  assert.equal(m.data.seen.player, undefined);
  m.note({ type: 'run', mode: 'sprint', diff: 'hard', score: 500, floor: 30, won: true }, w, null);
  m.note({ type: 'run', mode: 'sprint', diff: 'hard', score: 900, floor: 12, won: false }, w, null);
  assert.equal(m.data.runs, 2);
  assert.equal(m.data.wins, 1);
  assert.equal(m.data.clears['sprint:hard'], 1, 'a later, higher-scoring loss keeps the win');
  assert.equal(m.data.best['sprint:hard'].score, 900);
  // The record survives a reload.
  const again = new Meta(store);
  assert.deepEqual(again.data.kills, m.data.kills);
  assert.equal(again.data.clears['sprint:hard'], 1);
});

test('a feat finished during play is queued once', () => {
  const m = fresh(), w = worldOf();
  m.note(kill(ENEMIES.forgemaster), w, null);
  assert.deepEqual(m.fresh, ['keeper']);
  m.note(kill(ENEMIES.forgemaster), w, null);
  assert.deepEqual(m.fresh, ['keeper']);
  m.note({ type: 'run', mode: 'sprint', diff: 'hard', score: 1, floor: 30, won: true }, w, null);
  assert.deepEqual(m.fresh, ['keeper', 'sprinter', 'master']);
});

test('every keeper a run can field is one the codex lists', () => {
  for (const mode of ['sprint', 'climb']) for (const seed of [1, 7, 99, 1234, 55555]) {
    const run = generateRun(seed, 'normal', mode);
    for (const f of run.floors) {
      if (!f.boss) continue;
      const def = f.boss === 'twins' ? ENEMIES.twinA : run.roster.defs[f.boss] || ENEMIES[f.boss];
      const key = bossKey(def);
      assert.ok(key === 'champion' || KEEPERS.includes(key), `${mode} ${seed} floor ${f.n}: ${f.boss} files as ${key}`);
    }
  }
});
