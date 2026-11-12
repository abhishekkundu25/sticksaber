// Checks of the weapon forms: their move data, their damage against the saber's, and that each one
// can carry the scripted player through floor 1.
//   node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORMS, FORM_IDS } from '../src/game/forms.js';
import { MOVES } from '../src/game/moves.js';
import { World } from '../src/game/world.js';
import { Director } from '../src/game/encounters.js';
import { BotInput } from '../src/game/bot.js';
import { measure, STRINGS } from '../tools/form-dps.js';

const SLOTS = ['L1', 'DA', 'H1', 'LAUNCH', 'A1', 'AH', 'PLUNGE', 'RIPOSTE'];
const FAMS = new Set(['light', 'heavy', 'launch', 'air', 'spike', 'riposte']);
const NEW = FORM_IDS.filter((id) => id !== 'saber');
const PREFIX = { twin: 'TW_', great: 'GS_', staff: 'ST_' };

// A slot name in a `next` is mapped through the form, as the player controller does.
const resolve = (form, id) => form.moves[id] || id;

function reachable(form) {
  const seen = new Set(), todo = SLOTS.map((s) => resolve(form, s));
  while (todo.length) {
    const id = todo.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const m = MOVES[id];
    if (!m) continue;
    for (const nx of Object.values(m.next || {})) todo.push(resolve(form, nx));
    if (m.land) todo.push(m.land);
  }
  return seen;
}

test('every form is described for the selection card', () => {
  for (const id of FORM_IDS) {
    const f = FORMS[id];
    assert.equal(f.id, id);
    assert.equal(f.name, f.name.toUpperCase(), `${id}: name is not upper case`);
    assert.ok(f.text && !f.text.includes('\n'), `${id}: text`);
    assert.ok(f.traits.length >= 3 && f.traits.length <= 4, `${id}: traits`);
    assert.match(f.color, /^#[0-9a-f]{6}$/i);
    assert.ok(!/^#(f{6}|ff0000)$/i.test(f.color), `${id}: colour`);
    assert.ok(f.blade.len > 0 && f.dmg > 0 && f.speed > 0);
  }
});

test("every form's moves are well formed and every one of them can be reached", () => {
  for (const id of NEW) {
    const form = FORMS[id];
    for (const s of SLOTS) {
      assert.ok(form.moves[s], `${id}: slot ${s} is not filled`);
      assert.ok(MOVES[form.moves[s]], `${id}: slot ${s} -> ${form.moves[s]} does not exist`);
    }
    const reach = reachable(form);
    const own = Object.keys(MOVES).filter((m) => m.startsWith(PREFIX[id]));
    assert.ok(own.length >= 14, `${id}: only ${own.length} moves`);
    for (const m of own) assert.ok(reach.has(m), `${id}: ${m} cannot be reached from any slot`);
    for (const mid of reach) {
      const m = MOVES[mid];
      assert.ok(m, `${id}: ${mid} does not exist`);
      if (!mid.startsWith(PREFIX[id])) continue;
      assert.ok(FAMS.has(m.fam), `${mid}: family ${m.fam}`);
      assert.ok(m.cancel > 0 && m.cancel <= m.dur, `${mid}: cancel`);
      assert.equal(m.k[0].t, 0, `${mid}: first key is not at 0`);
      for (let i = 1; i < m.k.length; i++) assert.ok(m.k[i].t > m.k[i - 1].t, `${mid}: keys out of order`);
      if (!m.plunge) assert.ok(m.k[m.k.length - 1].t <= m.dur, `${mid}: a key after the end`);
      assert.ok(m.hits.length, `${mid}: no hits`);
      for (const h of m.hits) assert.ok(h.t0 >= 0 && h.t0 < h.t1 && h.t1 <= m.dur && h.dmg > 0, `${mid}: hit window`);
      // Overlapping windows would flip the active hit every tick and strike every frame.
      for (let i = 1; i < m.hits.length; i++) assert.ok(m.hits[i].t0 >= m.hits[i - 1].t1, `${mid}: hit windows ${i - 1} and ${i} overlap`);
      for (const [t] of m.ev) assert.ok(t >= 0 && t <= m.dur, `${mid}: event at ${t}`);
      for (const [a, b] of m.step) assert.ok(a < b && b <= m.dur, `${mid}: step`);
      if (m.armor) assert.ok(m.armor[0] < m.armor[1] && m.armor[1] <= m.dur, `${mid}: armour window`);
      if (m.rise) assert.ok(m.rise < m.dur && m.fam === 'launch', `${mid}: rise`);
      if (m.charge) assert.ok(m.charge < m.hits[0].t0, `${mid}: charge after the swing starts`);
      for (const [k, nx] of Object.entries(m.next)) assert.ok(MOVES[resolve(form, nx)], `${mid}: next.${k} -> ${nx}`);
      if (m.plunge) { assert.ok(m.land && MOVES[m.land], `${mid}: plunge without a landing`); assert.ok(m.air); }
      // A string that stays in the air goes on in the air.
      if (m.air) for (const nx of Object.values(m.next)) assert.ok(MOVES[resolve(form, nx)].air, `${mid}: air move chains to a ground move`);
    }
    // The shape the brief asks for: a launcher you can rise with, a chargeable or armoured heavy,
    // the three heavy branches off the light string, an air string with a finisher.
    const M = (s) => MOVES[form.moves[s]];
    assert.ok(M('LAUNCH').rise, `${id}: launcher has no rise`);
    assert.ok(M('H1').charge || M('H1').armor, `${id}: heavy is plain`);
    assert.ok(M('PLUNGE').plunge && M('RIPOSTE').invuln && M('RIPOSTE').fam === 'riposte');
    const string = [M('L1')];
    while (string.at(-1).next.light && string.length < 10) string.push(MOVES[resolve(form, string.at(-1).next.light)]);
    assert.ok(string.length >= 3, `${id}: light string too short`);
    const branches = new Set(string.map((m) => m.next.heavy).filter(Boolean).map((h) => resolve(form, h)));
    assert.ok(branches.size >= 3, `${id}: only ${branches.size} heavy branches off the light string`);
    assert.ok(branches.has(form.moves.LAUNCH), `${id}: no launcher branch`);
    assert.ok(MOVES[resolve(form, M('A1').next.light)]?.air, `${id}: no air string`);
  }
});

// Sustained damage per second against the dummy, raw (every hit at full value), as the mean of the
// light string, the string into the finisher and the air combo.
test('damage against one target stays near the saber: twin and greatsword level, staff below', () => {
  const rate = (id) => {
    const r = Object.values(STRINGS[id]).map((s) => measure(id, s.split(' '), { reps: 3 }).dps);
    return { each: r, mean: r.reduce((a, b) => a + b) / r.length };
  };
  const saber = rate('saber');
  const want = { twin: [-0.12, 0.12], great: [-0.12, 0.12], staff: [-0.22, -0.06] };
  for (const id of NEW) {
    const r = rate(id), d = r.mean / saber.mean - 1;
    assert.ok(d >= want[id][0] && d <= want[id][1], `${id}: ${(d * 100).toFixed(0)}% against the saber`);
    // No single string is far off either.
    r.each.forEach((v, i) => assert.ok(Math.abs(v / saber.each[i] - 1 - (want[id][0] + want[id][1]) / 2) < 0.2, `${id}: string ${i} is ${((v / saber.each[i] - 1) * 100).toFixed(0)}%`));
  }
});

test('twin blades hit more often for less, the greatsword the other way round', () => {
  const s = measure('saber', STRINGS.saber.L.split(' '), { reps: 2 }), t = measure('twin', STRINGS.twin.L.split(' '), { reps: 2 }), g = measure('great', STRINGS.great.L.split(' '), { reps: 2 });
  assert.ok(t.hps > s.hps * 1.5 && t.perHit < s.perHit * 0.7, 'twin');
  assert.ok(g.hps < s.hps * 0.85 && g.perHit > s.perHit * 1.25, 'great');
});

test("the twin form's off-hand blade lands a hit on its own", () => {
  const strike = (twin) => {
    const world = new World();
    world.input = new BotInput(world, 0); world.lockInput = true;
    world.setArena(2200); world.setForm('twin');
    const p = world.spawnPlayer(0);
    const e = world.spawnEnemy('dummy', 62, false);
    e.hp = e.maxHp = 1000;
    for (let i = 0; i < 30; i++) world.step(1 / 120);
    p.twin = twin; p.facing = 1;
    p.startMove('TW_L2'); // the off-hand cut; the weapon hand is drawn back to the hip
    for (let t = 0; t < 0.3; t += 1 / 120) world.step(1 / 120);
    return 1000 - e.hp;
  };
  assert.equal(strike(false), 0, 'the weapon hand reached the target by itself');
  assert.ok(strike(true) > 0, 'the off-hand blade did not connect');
});

test('the scripted player clears floor 1 with every form', () => {
  for (const id of NEW) {
    const world = new World();
    world.input = new BotInput(world, 0.9);
    const dir = new Director(world, { setArena: (a) => (a === 'hall' ? 1900 : 2200), auto: true });
    world.setForm(id);
    dir.startRun(0, 99);
    assert.equal(world.player.blade, FORMS[id].blade, `${id}: form not applied`);
    let cleared = false;
    for (let t = 0; t < 120 && !cleared; t += 1 / 120) {
      world.input.tick(1 / 120); world.step(1 / 120); dir.update(1 / 120);
      if (dir.state === 'dead' && dir.t > 1.5) dir.retry();
      cleared = dir.stage > 0;
    }
    assert.ok(cleared, `${id}: floor 1 was not cleared in two minutes`);
  }
});
