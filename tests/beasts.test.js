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
import { Ragdoll } from '../src/game/ragdoll.js';
import { bind } from '../src/game/bonds.js';

const DT = 1 / 120;
const finite = (f) => [f.x, f.y, f.vx, f.vy, f.hp, f.posture, f.bx, f.by, f.tx, f.ty, f.saddleX ?? 0, f.saddleY ?? 0, f.hdA ?? 0, f.spA ?? 0, f.roll ?? 1, ...f.j, ...f.p,
  ...(f.tl ?? []), ...(f.xl ?? []), ...(f.wg ?? [])].every(Number.isFinite);
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

test('a beast can be hit, ragdolled and killed, and its corpse is knocked about but not cut up', () => {
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
    assert.equal(e.rag.cuts.length, cuts, `${plan}: an animal was dismembered`);
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

// Every point the beast draw functions pose a body from, in world space. Head and spine frames
// include the roll, so a body that flips its drawn side shows up as a jump here.
function drawn(f) {
  const out = [...f.j, ...f.tl, ...f.xl];
  if (f.B.wing) out.push(...f.wg);
  const B = f.B, s = f.scale, FX = f.facing * f.xm, c = Math.cos(f.hdA), sn = Math.sin(f.hdA);
  for (const [a, b] of [[1, 0], [-0.3, 0.8], [0.6, -0.6]]) {
    out.push(f.j[0] + (c * a * B.head * s - sn * b * B.headR * s * f.roll) * FX, f.j[1] - (sn * a * B.head * s + c * b * B.headR * s * f.roll));
  }
  const dx = f.j[2] - f.j[4], dy = f.j[3] - f.j[5], d = Math.hypot(dx, dy) || 1, g = B.girth * s * f.roll;
  out.push((f.j[2] + f.j[4]) / 2 + (dy / d) * f.facing * g, (f.j[3] + f.j[5]) / 2 - (dx / d) * f.facing * g);
  return out;
}
const jump = (a, b) => { let m = 0; for (let i = 0; i < a.length; i += 2) m = Math.max(m, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1])); return m; };

test('each plan goes limp as itself, comes to rest in the arena and stands up without a visible swap', () => {
  for (const plan of BEAST_PLANS) {
    for (const [seed, kx, ky, spin] of [[1, 520, -760, 3], [2, -420, -900, -4], [3, 300, -500, 6]]) {
      const def = makeBeast(makeRng(seed * 31 + plan.length), `l_${plan}_${seed}`, plan, 6, new Set());
      const world = arena(def, seed);
      world.lockInput = true;
      const e = world.spawnEnemy(def.kind, 200, false);
      e.def = { ...e.def, ctrl: null };
      if (def.flying) { e.y = -160; e.onGround = false; e.gravMul = 0; }
      for (let i = 0; i < 30; i++) world.step(DT);
      const live = drawn(e);
      e.toRagdoll(kx, ky, spin);
      assert.ok(e.rag && !(e.rag instanceof Ragdoll && e.rag.constructor === Ragdoll), `${plan}: a humanoid ragdoll`);
      assert.ok(e.rag.n > 11, `${plan}: the limp body has no animal parts`);
      assert.ok(jump(live, drawn(e)) < 1e-3, `${plan}: the body changes shape as it goes limp`);
      let prev = drawn(e), up = false, landed = false;
      for (let t = 0; t < 6 && !up; t += DT) {
        const wasLimp = !!e.rag;
        world.step(DT);
        assert.ok(finite(e), `${plan} ${seed}: not finite at ${t.toFixed(2)}`);
        const now = drawn(e);
        // Thrown hard, a point travels up to ~25 px a step; a swap of shape moves far more.
        assert.ok(jump(prev, now) < 40, `${plan} ${seed}: a point jumped ${jump(prev, now).toFixed(0)} px at ${t.toFixed(2)} (${wasLimp ? 'limp' : e.state})`);
        prev = now;
        if (e.rag) {
          if (!e.rag.air) landed = true;
          for (let i = 0; i < e.rag.n; i++) {
            assert.ok(e.rag.y[i] <= 0.01, `${plan}: point ${i} under the floor`);
            assert.ok(e.rag.x[i] >= world.minX - 0.01 && e.rag.x[i] <= world.maxX + 0.01, `${plan}: point ${i} outside the arena`);
          }
        }
        if (wasLimp && !e.rag) {
          up = true;
          assert.equal(e.state, 'getup');
          assert.ok(Math.abs(e.facing) === 1);
          // It faces the way its head lay, so it stands up without turning on the spot.
          assert.ok((e.j[2] - e.j[4]) * e.facing >= -4, `${plan}: stands up facing away from its own head`);
        }
      }
      assert.ok(landed && up, `${plan} ${seed}: landed ${landed}, got up ${up}`);
      for (let i = 0; i < 120; i++) {
        world.step(DT);
        const now = drawn(e);
        // Only the blend up from the floor is checked; after it the live animation takes over.
        if (e.state === 'getup') assert.ok(jump(prev, now) < 40, `${plan}: a point jumped ${jump(prev, now).toFixed(0)} px while standing up`);
        prev = now;
      }
      assert.equal(e.state === 'getup' || e.state === 'ragdoll', false, `${plan}: still ${e.state}`);
      assert.ok(Math.abs(e.roll - 1) < 1e-6);
    }
  }
});

test('heavy animals travel less when launched, and juggles still carry every plan', () => {
  const travel = {};
  for (const plan of BEAST_PLANS) {
    const def = makeBeast(makeRng(17 + plan.length), `w_${plan}`, plan, 3, new Set());
    const world = arena(def, 9);
    world.lockInput = true;
    const e = world.spawnEnemy(def.kind, 0, false);
    e.def = { ...e.def, ctrl: null };
    for (let i = 0; i < 20; i++) world.step(DT);
    // Centre of mass: the limp body's own weights, the live body's joints.
    const mid = () => { if (!e.rag) return (e.j[2] + e.j[4]) / 2; let m = 0, x = 0; for (let i = 0; i < e.rag.n; i++) if (e.rag.w[i]) { m += 1 / e.rag.w[i]; x += e.rag.x[i] / e.rag.w[i]; } return x / m; };
    e.toRagdoll(0, 0, 0); const x0 = mid(); e.rag = null; e.setState('free');
    e.toRagdoll(500, -700, 0);
    let air = 0;
    for (let i = 0; i < 40; i++) {
      world.step(DT);
      if (i === 11) travel[plan] = mid() - x0;
      if (e.rag.air || i < 6) air++; // a low body counts as down until it clears the floor
      // Hits in the air: each keeps it up there.
      if (i % 12 === 11) { e.rag.kick(120, -520, 0); e.juggle++; }
    }
    assert.ok(e.rag && air >= 38, `${plan}: fell out of the juggle (${air} of 40 steps in the air)`);
    assert.ok(e.juggle === 3);
  }
  assert.ok(travel.charger < travel.hound * 0.75 && travel.ape < travel.hound * 0.85, JSON.stringify(travel));
});

test('a rider thrown from a dying mount falls as its own body', () => {
  const def = makeBeast(makeRng(11), 'r_charger', 'charger', 3, new Set());
  const world = arena(def, 5);
  world.lockInput = true;
  const mount = world.spawnEnemy(def.kind, 300, false);
  const rider = world.spawnEnemy('initiate', 300, false);
  mount.def = { ...mount.def, ctrl: null }; rider.def = { ...rider.def, ctrl: null };
  bind(world, 'rider', [rider, mount]);
  for (let i = 0; i < 30; i++) world.step(DT);
  assert.equal(rider.riding, mount);
  applyHit(world, world.player, mount, { dmg: 9999, post: 0, kx: 400, ky: -500, kind: 'knock', stop: 0, shake: 0, stun: 0.3 }, mount.cx, mount.cy);
  assert.ok(mount.dead && mount.rag);
  let apart = 0;
  for (let i = 0; i < 120; i++) {
    world.step(DT);
    assert.ok(finite(rider) && finite(mount));
    apart = Math.max(apart, Math.hypot(rider.x - mount.saddleX, rider.y - mount.saddleY - 24 * rider.scale));
  }
  assert.equal(rider.riding, null);
  assert.equal(mount.rider, null);
  assert.ok(rider.rag !== mount.rag);
  assert.ok(apart > 40, 'the rider stayed glued to the saddle');
});

test('the humanoid ragdoll behaves exactly as before', () => {
  // A fingerprint of a fixed humanoid fall, a cut and a platform landing, recorded before animals got
  // their own ragdoll. If this moves, the humanoid ragdoll changed.
  seedRng(1234);
  const j = [0, -150, 0, -120, 0, -82, 12, -104, 24, -92, -10, -104, -20, -90, 8, -56, 10, -4, -8, -56, -10, -4];
  const r = new Ragdoll(j, [14, 38, 20, 20, 20, 20, 26, 26, 26, 26], 1);
  r.kick(300, -700, 3);
  let h = 0;
  for (let i = 0; i < 400; i++) {
    r.step(1 / 120, -1000, 1000, i > 200 ? [{ solid: true, x: 500, w: 300, y: -120 }] : null);
    if (i === 150) r.chop(r.x[1], r.y[1], 200, -100);
    for (let k = 0; k < r.n; k++) h = (h * 31 + Math.round(r.x[k] * 100) + Math.round(r.y[k] * 100)) | 0;
  }
  assert.deepEqual([h, r.rest.toFixed(4), r.n], [-1601036175, '1.6500', 13]);
});
