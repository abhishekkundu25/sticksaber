// Checks of the weapon forms: their move data, their damage against the saber's, and that each one
// can carry the scripted player through floor 1.
//   node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORMS, FORM_IDS, equipForm, formMove, DRAW_LEVELS, PERFECT_DRAW } from '../src/game/forms.js';
import { MOVES } from '../src/game/moves.js';
import { World } from '../src/game/world.js';
import { Fighter } from '../src/game/fighter.js';
import { PLAYER } from '../src/game/player.js';
import { seedRng } from '../src/core/math.js';
import { Director } from '../src/game/encounters.js';
import { BotInput } from '../src/game/bot.js';
import { measure, STRINGS } from '../tools/form-dps.js';

const SLOTS = ['L1', 'DA', 'H1', 'LAUNCH', 'A1', 'AH', 'PLUNGE', 'RIPOSTE'];
const FAMS = new Set(['light', 'heavy', 'launch', 'air', 'spike', 'riposte']);
const NEW = FORM_IDS.filter((id) => id !== 'saber');
const PREFIX = { twin: 'TW_', great: 'GS_', staff: 'ST_', lash: 'LA_', gauntlets: 'GA_', drawblade: 'DB_' };

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
test('damage against one target stays near the saber: most forms level, staff below', () => {
  const rate = (id) => {
    const r = Object.values(STRINGS[id]).map((s) => measure(id, s.split(' '), { reps: 3 }).dps);
    return { each: r, mean: r.reduce((a, b) => a + b) / r.length };
  };
  const saber = rate('saber');
  const want = { twin: [-0.12, 0.12], great: [-0.12, 0.12], staff: [-0.22, -0.06], lash: [-0.15, 0.15], gauntlets: [-0.15, 0.15], drawblade: [-0.15, 0.15] };
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

// ───────────── lash, gauntlets, drawblade ─────────────
const DT = 1 / 120;
class Pad {
  constructor() { this.now = 0; this.down = {}; this.pressedAt = {}; this.hold = {}; }
  held(a) { return !!this.down[a]; }
  axisX() { return (this.down.right ? 1 : 0) - (this.down.left ? 1 : 0); }
  consume(a, w = 0.14) { if (this.now - (this.pressedAt[a] ?? -9) <= w) { this.pressedAt[a] = -9; return true; } return false; }
  peek(a, w = 0.14) { return this.now - (this.pressedAt[a] ?? -9) <= w; }
  sincePress(a) { return this.now - (this.pressedAt[a] ?? -9); }
  press(a, hold = 0.06) { this.pressedAt[a] = this.now; this.down[a] = true; this.hold[a] = Math.max(this.hold[a] || 0, hold); }
  tick(dt) { this.now += dt; for (const a in this.hold) if (this.hold[a] > 0 && (this.hold[a] -= dt) <= 0) this.down[a] = false; }
}
// A world with the player at 0 holding `form` and a still target `gap` ahead.
function room(form, gap = 120, over = null) {
  seedRng(7);
  const world = new World();
  world.input = new Pad(); world.setArena(2200); world.setForm(form);
  const p = world.spawnPlayer(0);
  const e = world.spawnEnemy('dummy', gap, false);
  e.def = { ...e.def, ctrl: null, ...over }; e.hp = e.maxHp = 1e5;
  for (let i = 0; i < 30; i++) world.step(DT);
  p.facing = 1; e.face(p.x);
  return { world, p, e };
}
const run = (world, secs, each) => { for (let t = 0; t < secs; t += DT) { world.input?.tick?.(DT); world.step(DT); each?.(t); } };
const strike = (form, move, gap) => { const { world, p, e } = room(form, gap); p.startMove(move); run(world, 0.5); return 1e5 - e.hp; };

test('lash: the tip bites hardest, and nothing in close is hit at all', () => {
  const near = strike('lash', 'LA_L1', 45), mid = strike('lash', 'LA_L1', 95), tip = strike('lash', 'LA_L1', 140);
  assert.equal(near, 0, `a target against the hand took ${near}`);
  assert.ok(mid > 0 && tip > mid * 1.15, `mid ${mid.toFixed(1)}, tip ${tip.toFixed(1)}`);
  // The lash reaches about twice as far as the saber.
  assert.ok(FORMS.lash.blade.len >= FORMS.saber.blade.len * 1.9);
});

test('lash: the heavy drags a target in, or drags you to one too heavy to move', () => {
  let { world, p, e } = room('lash', 200);
  p.startMove('LA_H1'); run(world, 0.7);
  assert.ok(1e5 - e.hp > 0, 'the heavy did not connect at 200');
  assert.ok(e.x - p.x < 150, `the target is still ${(e.x - p.x).toFixed(0)} away`);
  ({ world, p, e } = room('lash', 200, { armor: 2 }));
  const x0 = e.x;
  p.startMove('LA_H1'); run(world, 0.7);
  assert.ok(Math.abs(e.x - x0) < 10 && p.x > 60, `anchored target moved ${(e.x - x0).toFixed(0)}, the player ${p.x.toFixed(0)}`);
});

test('gauntlets: landed punches build charge and the heavy spends it on a shockwave', () => {
  let { world, p, e } = room('gauntlets', 60);
  for (const id of ['GA_L1', 'GA_L2', 'GA_L3']) { p.startMove(id); run(world, 0.24); }
  assert.ok(Math.abs(p.fistCharge - 0.375) < 1e-6, `charge ${p.fistCharge} after three punches`);
  const blast = (c) => { const r = room('gauntlets', 70); r.p.fistCharge = c; r.p.startMove('GA_H1'); run(r.world, 0.5); return { dmg: 1e5 - r.e.hp, ...r }; };
  const empty = blast(0), full = blast(1);
  assert.equal(full.p.fistCharge, 0, 'the heavy did not spend the charge');
  assert.ok(full.dmg > empty.dmg * 2.5, `empty ${empty.dmg.toFixed(1)}, full ${full.dmg.toFixed(1)}`);
  assert.ok(full.e.rag, 'a full charge should launch');
  // A full charge breaks a guard.
  ({ world, p, e } = room('gauntlets', 70));
  e.maxPosture = 100; // the training dummy's posture is bottomless
  e.setState('guard'); e.stDur = 9; p.fistCharge = 1; p.startMove('GA_H1');
  run(world, 0.4);
  assert.ok(e.broken, 'the guard held against a full charge');
});

test('drawblade: three charge levels, a perfect release pays, and the cut lands a beat after the pass', () => {
  // Hold heavy through the player's own input for `hold` seconds, then record when damage lands.
  const draw = (hold) => {
    const { world, p, e } = room('drawblade', 110);
    world.input.press('heavy', hold);
    let passT = -1, cutT = -1, hp = e.hp, levels = 0;
    run(world, hold + 1.2, (t) => {
      if (p.drawLevel > levels) levels = p.drawLevel;
      if (e.hp < hp) { if (passT < 0) passT = t; else if (cutT < 0) cutT = t; }
      hp = e.hp;
    });
    return { dmg: 1e5 - e.hp, passT, cutT, levels, past: p.x > e.x };
  };
  const at = (lv, late) => 0.1 + DRAW_LEVELS[lv - 1] + (late ? PERFECT_DRAW + 0.08 : 0.04);
  const one = draw(at(1, true)), two = draw(at(2, true)), perfect = draw(at(2, false)), three = draw(at(3, true));
  assert.deepEqual([one.levels, two.levels, three.levels], [1, 2, 3], 'levels reached');
  assert.ok(one.dmg < two.dmg && two.dmg < three.dmg, `level damage ${one.dmg} ${two.dmg} ${three.dmg}`);
  assert.ok(perfect.dmg > two.dmg * 1.25, `perfect ${perfect.dmg.toFixed(1)} against ${two.dmg.toFixed(1)}`);
  assert.ok(two.past, 'the draw should carry the player through the target');
  assert.ok(two.cutT - two.passT >= 0.2, `the cut landed ${(two.cutT - two.passT).toFixed(2)} s after the pass`);
});

test("new forms carry no enemy tells, and a delayed cut is marked on its target before it lands", () => {
  for (const id of ['lash', 'gauntlets', 'drawblade']) for (const mid of Object.keys(MOVES).filter((m) => m.startsWith(PREFIX[id]))) {
    assert.ok(!MOVES[mid].ev.some((e) => e[1] === 'tele'), `${mid}: a tell would flash the player's own eye and play the enemy cue`);
  }
  // A delayed cut must not come out of nowhere: the target wears a visible mark for a while first.
  const { world, p, e } = room('drawblade', 70);
  p.startMove('DB_L4');
  let markedT = -1, cutT = -1, hp = e.hp;
  run(world, 0.8, (t) => {
    if (markedT < 0 && (p.marks?.some((m) => m.B === e) || p.cuts?.some((c) => c.B === e))) markedT = t;
    if (markedT >= 0 && t > markedT && e.hp < hp && cutT < 0) cutT = t;
    hp = e.hp;
  });
  assert.ok(markedT >= 0 && cutT > markedT + 0.2, `marked at ${markedT}, cut at ${cutT}`);
});

// A fighter that is not the player, on the enemy side, with no controller: the copy the owner is building.
function foe(form, world, x) {
  const f = new Fighter({ ...PLAYER, kind: 'foe', ctrl: null }, x, 1);
  equipForm(f, form); f.hp = f.maxHp = 1e4;
  world.fighters.push(f);
  f.face(world.player.x);
  return f;
}
test('a fighter that is not the player can use each signature move against the player', () => {
  const setup = (form, gap) => {
    seedRng(9);
    const world = new World(); world.setArena(2200); world.setForm('saber');
    const p = world.spawnPlayer(0); p.hp = p.maxHp = 1e4;
    const f = foe(form, world, gap);
    for (let i = 0; i < 20; i++) world.step(DT);
    p.invuln = 0;
    return { world, p, f };
  };
  // Lash: the pull drags the player in.
  let { world, p, f } = setup('lash', 200);
  f.startMove(formMove(f, 'H1')); run(world, 0.7);
  assert.ok(p.hp < 1e4 && f.x - p.x < 150, `lash: player hp ${p.hp}, gap ${(f.x - p.x).toFixed(0)}`);
  // Gauntlets: punches charge the copy's own fists, and the heavy spends them.
  ({ world, p, f } = setup('gauntlets', 60));
  for (const s of ['L1', 'DA']) { p.invuln = 0; f.startMove(formMove(f, s)); run(world, 0.42); }
  assert.ok(f.fistCharge > 0, 'gauntlets: the copy built no charge');
  p.invuln = 0; f.startMove(formMove(f, 'H1')); run(world, 0.4);
  assert.equal(f.fistCharge, 0, 'gauntlets: the heavy did not spend the charge');
  // Drawblade: held through `holdCharge`, then released; the cut lands on the player.
  ({ world, p, f } = setup('drawblade', 110));
  f.startMove(formMove(f, 'H1')); f.holdCharge = true;
  run(world, 0.1 + DRAW_LEVELS[1] + 0.05);
  assert.equal(f.drawLevel, 2, 'drawblade: the copy did not reach level 2');
  f.holdCharge = false;
  const hp = p.hp;
  run(world, 1.0);
  assert.ok(hp - p.hp > 15, `drawblade: the cut dealt ${hp - p.hp}`);
});

test('techniques work with the new forms: undertow, meteor, razor step, aerialist and the mirror image', () => {
  for (const id of ['lash', 'gauntlets', 'drawblade']) {
    // Undertow: the launcher slot drags the crowd in first.
    let { world, p, e } = room(id, 240);
    world.setBuild({ undertow: 1, meteor: 1, razor: 1, aerial: 1 });
    const d0 = e.x - p.x;
    world.input.press('down', 0.2); world.input.press('heavy', 0.1); run(world, 0.15);
    assert.equal(p.move?.id, formMove(p, 'LAUNCH'), `${id}: the launcher did not start`);
    assert.ok(e.x - p.x < d0 - 40, `${id}: undertow did not drag`);
    // Meteor: the plunge calls a pillar where it lands.
    ({ world, p, e } = room(id, 600));
    world.setBuild({ meteor: 1, aerial: 1 });
    world.input.press('jump', 0.2); run(world, 0.3);
    assert.equal(p.airJumps, 2, `${id}: Aerialist`);
    world.input.press('down', 0.2); world.input.press('heavy', 0.1); run(world, 0.8);
    assert.ok(world.projectiles.list.some((q) => q.type === 'pillar' && q.owner === p), `${id}: no meteor pillar`);
    // Razor Step: a dash through cuts.
    ({ world, p, e } = room(id, 60));
    world.setBuild({ razor: 1 });
    world.input.press('right', 0.2); world.input.press('dash'); run(world, 0.3);
    assert.ok(e.hp < 1e5, `${id}: razor step did not cut`);
    // The mirror image carries the form and repeats its moves.
    ({ world, p, e } = room(id, 120));
    const m = world.spawnMirror(p, 3);
    assert.equal(m.form, p.form);
    p.startMove(formMove(p, 'L1')); run(world, 0.3);
    assert.equal(m.move?.id, formMove(p, 'L1'), `${id}: the mirror image did not repeat the move`);
  }
});

test('a drawblade cut still lands when the draw is cancelled before the blade is sheathed', () => {
  const { world, p, e } = room('drawblade', 110);
  world.input.press('heavy', 0.1 + DRAW_LEVELS[1] + 0.05);
  let pressed = false, released = -1;
  run(world, 2.0, (t) => {
    if (released < 0 && p.chargeDone) released = t;
    // Cancel into a light as soon as the recovery allows, before the sheathe at 0.58.
    if (!pressed && released >= 0 && p.state === 'attack' && p.move.id === 'DB_H1' && p.mt >= p.move.cancel * 0.75 && p.mt < 0.55) { world.input.press('light'); pressed = true; }
  });
  assert.ok(pressed, 'the cancel was never pressed');
  assert.ok(1e5 - e.hp > 20, `only ${(1e5 - e.hp).toFixed(1)} landed`);
  assert.ok(!p.marks?.length && !p.cuts?.length, 'marks were left behind');
});

test('changing form on a live fighter clears what the last form left behind', () => {
  const { world, p } = room('drawblade', 400);
  run(world, 0.2);
  assert.ok(p.sheathed, 'the drawblade should rest in its sheath');
  world.setForm('saber'); run(world, 0.1);
  assert.ok(!p.sheathed && p.blade === FORMS.saber.blade, 'the saber is hidden as if sheathed');
  world.setForm('lash'); run(world, 0.1);
  assert.ok(p.lash, 'the whip did not start');
  world.setForm('twin'); run(world, 0.1);
  assert.ok(!p.lash, 'whip points left on a twin-blade fighter would turn its hit test into a whip');
});
