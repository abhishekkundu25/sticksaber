// Checks of the generated animals (src/game/beasts.js). No browser needed.
//   node --test tests/beasts.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/game/world.js';
import { BotInput } from '../src/game/bot.js';
import { Beast, BEAST_PLANS, BEAST_INFO, makeBeast } from '../src/game/beasts.js';
import { MOVES, fairTells } from '../src/game/moves.js';
import { applyHit } from '../src/game/combat.js';
import { makeRng, seedRng } from '../src/core/math.js';

const DT = 1 / 120;
const finite = (f) => [f.x, f.y, f.vx, f.vy, f.hp, f.posture, f.bx, f.by, f.tx, f.ty, f.saddleX, f.saddleY, ...f.j, ...f.p].every(Number.isFinite);
function hueOf(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return { h: 0, s: 0, l: mx };
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: d, l: (mx + mn) / 2 };
}
function arena(def, seed = 4) {
  seedRng(seed);
  const world = new World();
  world.input = new BotInput(world, 0.8);
  world.setArena(2200);
  world.spawnPlayer(0);
  world.roster = { [def.kind]: def };
  return world;
}
const FIELDS = ['kind', 'base', 'beast', 'name', 'scale', 'hp', 'posture', 'postureRegen', 'accel', 'dashSpeed', 'lineW', 'tier', 'armor', 'getup', 'color', 'outline', 'runSpeed', 'blade', 'ctrl', 'ai', 'chainBreak', 'traits', 'flying', 'rideable', 'gen'];

test('every plan generates for 50 seeds with sane numbers, legal colours and unique names', () => {
  assert.ok(BEAST_PLANS.length >= 7);
  const names = new Set();
  for (const plan of BEAST_PLANS) {
    assert.ok(BEAST_INFO[plan]);
    for (let seed = 1; seed <= 50; seed++) {
      const def = makeBeast(makeRng(seed * 131 + plan.length), `t_${plan}_${seed}`, plan, 1 + (seed % 9), names);
      for (const k of FIELDS) assert.ok(def[k] !== undefined, `${plan} ${seed}: no ${k}`);
      assert.equal(def.beast, plan); assert.equal(def.chainBreak, 0);
      for (const v of [def.scale, def.hp, def.posture, def.runSpeed, def.lineW, def.gen.cost, def.gen.cap, def.blade.len]) assert.ok(Number.isFinite(v) && v > 0, `${plan} ${seed}: ${v}`);
      assert.ok(def.scale > 0.6 && def.scale < 1.6 && def.hp >= 15 && def.hp < 700 && def.gen.cost <= 7, `${plan} ${seed}: out of range`);
      assert.ok(Object.keys(def.traits).length <= 2);
      assert.equal(typeof def.gen.hint, 'string');
      for (const m of def.ai.moves) { assert.ok(MOVES[m.id], `${plan}: unknown move ${m.id}`); assert.ok(m.max >= (m.min ?? 0)); }
      for (const c of [def.color, def.outline]) {
        const { h, s, l } = hueOf(c);
        assert.ok(h < 150 || h > 215, `${def.name}: ${c} is too close to the player's cyan`);
        assert.ok(h > 10 && h < 350, `${def.name}: ${c} is too close to telegraph red`);
        assert.ok(s > 0.2 && l < 0.85, `${def.name}: ${c} is too close to white`);
      }
    }
  }
  assert.equal(names.size, BEAST_PLANS.length * 50, 'names repeat');
});

test('every bt_ move is well formed and telegraphs at least 0.2 s before its first hit', () => {
  const ids = Object.keys(MOVES).filter((id) => id.startsWith('bt_'));
  assert.ok(ids.length >= 20);
  for (const id of ids) {
    const m = MOVES[id];
    for (let i = 1; i < m.k.length; i++) assert.ok(m.k[i].t >= m.k[i - 1].t, `${id}: keys out of order`);
    for (const h of m.hits) assert.ok(h.t0 < h.t1 && h.t1 <= m.dur && h.dmg > 0, `${id}: hit window`);
    for (const [t] of m.ev) assert.ok(t >= 0 && t <= m.dur, `${id}: event at ${t}`);
    if (m.landMove) assert.ok(MOVES[m.landMove]);
    if (id.endsWith('_land')) continue;
    const marks = [...m.hits.map((h) => h.t0), ...m.ev.filter((e) => e[1] === 'spawn').map((e) => e[0])];
    if (marks.length) {
      const first = Math.min(...marks), tells = m.ev.filter((e) => e[1] === 'tele' && e[0] < first).map((e) => e[0]);
      assert.ok(tells.length, `${id}: no telegraph`);
      assert.ok(first - Math.max(...tells) >= 0.2, `${id}: telegraph only ${(first - Math.max(...tells)).toFixed(2)} s ahead`);
      assert.ok(m.punish, `${id}: no punish window`);
      assert.ok(fairTells(JSON.parse(JSON.stringify(m))), `${id}: unfair tells`);
    }
    // Unblockable attacks are slow: a long red tell.
    if (m.hits.some((h) => h.unblockable)) {
      const red = m.ev.find((e) => e[1] === 'tele' && e[2] === 1);
      assert.ok(red && m.hits[0].t0 - red[0] >= 0.7, `${id}: unblockable without a long red tell`);
    }
  }
});

test('each plan fights the scripted player for 10 seconds with every number finite', () => {
  for (const plan of BEAST_PLANS) {
    const def = makeBeast(makeRng(99 + plan.length), `f_${plan}`, plan, 9, new Set());
    const world = arena(def);
    const es = [world.spawnEnemy(def.kind, 320, true), world.spawnEnemy(def.kind, -360, true)];
    const seen = new Set();
    for (let t = 0; t < 10; t += DT) {
      world.input.tick(DT); world.step(DT);
      if (world.player.hp < 40) world.player.hp = 100;
      for (const e of es) {
        assert.ok(finite(e), `${plan}: non-finite at ${t.toFixed(2)} in ${e.state}`);
        if (e.state === 'attack') seen.add(e.move.src);
      }
      for (const e of es) if (e.dead && e.deadT > 2) { e.remove = true; }
    }
    assert.ok(es.every((e) => e instanceof Beast));
    assert.ok(seen.size >= 1 || es.every((e) => e.dead), `${plan}: never attacked`);
  }
});

test('a beast can be hit, ragdolled, killed and chopped', () => {
  for (const plan of BEAST_PLANS) {
    const def = makeBeast(makeRng(7 + plan.length), `k_${plan}`, plan, 1, new Set());
    const world = arena(def);
    world.lockInput = true;
    const e = world.spawnEnemy(def.kind, 90, false);
    e.def = { ...e.def, ctrl: null };
    if (def.flying) { e.y = -60; e.onGround = false; }
    for (let i = 0; i < 20; i++) world.step(DT);
    const p = world.player, hp = e.hp;
    applyHit(world, p, e, { dmg: 5, post: 5, kx: 200, ky: 0, kind: 'flinch', stop: 0, shake: 0, stun: 0.3 }, e.cx, e.cy);
    assert.ok(e.hp < hp, `${plan}: not hurt`);
    applyHit(world, p, e, { dmg: 5, post: 0, kx: 400, ky: -700, kind: 'launch', stop: 0, shake: 0, stun: 0.3 }, e.cx, e.cy);
    if (def.armor < 2) assert.ok(e.rag, `${plan}: not launched`);
    for (let i = 0; i < 60; i++) { world.step(DT); assert.ok(finite(e), `${plan}: limp body not finite`); }
    applyHit(world, p, e, { dmg: 9999, post: 0, kx: 300, ky: -300, kind: 'knock', stop: 0, shake: 0, stun: 0.3 }, e.cx, e.cy);
    assert.ok(e.dead && e.rag, `${plan}: not killed`);
    p.hitSet?.clear?.();
    const cuts = e.rag.cuts.length;
    applyHit(world, p, e, { dmg: 5, post: 0, kx: 200, ky: 0, kind: 'flinch', stop: 0, shake: 0, stun: 0.3 }, e.j[2], e.j[3]);
    assert.ok(e.rag.cuts.length > cuts, `${plan}: corpse not chopped`);
    for (let i = 0; i < 120; i++) { world.step(DT); assert.ok(finite(e)); }
  }
});

test('a beast that goes limp and stands up again keeps a consistent body', () => {
  const def = makeBeast(makeRng(5), 'g_hound', 'hound', 3, new Set());
  const world = arena(def);
  const e = world.spawnEnemy(def.kind, 200, false);
  e.toRagdoll(300, -500, 2);
  let stood = false;
  for (let t = 0; t < 4; t += DT) { world.step(DT); if (e.state === 'getup') stood = true; assert.ok(finite(e)); }
  assert.ok(stood && !e.rag);
});

test('the flyer falls when hit', () => {
  const def = makeBeast(makeRng(3), 'fl', 'flyer', 1, new Set());
  const world = arena(def);
  const e = world.spawnEnemy(def.kind, 150, false);
  for (let i = 0; i < 240; i++) { world.step(DT); }
  assert.ok(!e.onGround && e.y < -100, 'the flyer should be up');
  applyHit(world, world.player, e, { dmg: 3, post: 3, kx: 200, ky: 0, kind: 'flinch', stop: 0, shake: 0, stun: 0.3 }, e.cx, e.cy);
  assert.ok(e.rag, 'a hit drops it');
  let low = 0;
  for (let i = 0; i < 180; i++) { world.step(DT); low = Math.max(low, e.j[5]); }
  assert.ok(low > -30, 'it reached the floor');
});

test('mounts expose a saddle on their back', () => {
  for (const plan of BEAST_PLANS.filter((p) => BEAST_INFO[p].rideable)) {
    const def = makeBeast(makeRng(11), `m_${plan}`, plan, 3, new Set());
    assert.ok(def.rideable);
    const world = arena(def);
    const e = world.spawnEnemy(def.kind, 200, false);
    for (let i = 0; i < 30; i++) world.step(DT);
    assert.ok(Math.abs(e.saddleX - e.cx) < 40 * e.scale && e.saddleY < Math.min(e.j[3], e.j[5]), `${plan}: saddle at ${e.saddleX},${e.saddleY}`);
  }
});
