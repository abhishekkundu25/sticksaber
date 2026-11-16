// Surprises: the things a floor does that the player could not have planned for. The generator puts
// one in each sector (gen.js: SURPRISES); this file is what each one does once it breaks in.
// The director owns the timing. It calls `start` once, `tick` every step while the floor is being
// fought, `event` for each world event, and `end` when the floor is over.
import { rand, rng, clamp } from '../core/math.js';
import { applyHit } from './combat.js';
import { ENEMIES, initAi } from './enemies.js';
import { SURPRISES } from './gen.js';

const HERD_HIT = { dmg: 15, post: 30, kx: 520, ky: -420, kind: 'knock', stop: 0.07, shake: 0.4, stun: 0.5, unblockable: true, hazard: true };

// One of the herd: it runs from wall to wall and through anything in the way. It cannot be stopped,
// only jumped.
function herdCtrl(f, world) {
  const ai = f.ai;
  if (!ai.init) { initAi(f); ai.seen = new Set(); }
  const dir = f.herd;
  f.facing = dir; f.moveX = 1 * dir; f.invuln = 0.3; f.barT = 0;
  if (rng() < 0.3) world.fx.dust(f.x - dir * 30, 0, 1, -dir, 200);
  for (const e of world.fighters) {
    if (e === f || e.herd || e.dead || e.phantom || e.def.prop || ai.seen.has(e) || e.invuln > 0) continue;
    const low = e.rag ? e.rag.y[2] > -70 : e.y > -70 * f.scale;
    if (!low || Math.abs(e.x - f.x) > 50 * f.scale) continue;
    ai.seen.add(e);
    applyHit(world, null, e, { ...HERD_HIT, dir }, e.cx, e.cy);
  }
  if (dir > 0 ? f.x > world.maxX - 90 : f.x < world.minX + 90) { f.remove = true; world.fx.dust(f.x, 0, 8, dir, 320); }
}

// The courier runs from the player, vaults over them when cornered, and leaves after a quarter of a minute.
function courierCtrl(f, world, dt) {
  const ai = f.ai, pl = world.player;
  if (!ai.init) { initAi(f); ai.life = 15; ai.hop = 0; }
  ai.life -= dt; ai.hop -= dt;
  f.barT = 3;
  if (ai.life <= 0 && !f.rag) {
    f.remove = true; world.fx.beam(f.x, 0.8, f.color); world.fx.text(f.x, f.j[1] - 50, 'ESCAPED', '#8fa3b8', 16, 1.2); world.sfx('courierGone', f.x);
    world.events.push({ type: 'escape' });
    return;
  }
  if (f.state !== 'free' || !f.onGround || !pl || pl.dead) return;
  const dx = f.x - pl.x, dist = Math.abs(dx), away = dx >= 0 ? 1 : -1;
  const room = away > 0 ? world.maxX - f.x : f.x - world.minX;
  f.facing = away;
  if (room < 170 && dist < 300 && ai.hop <= 0) {
    // Cornered: over the player's head and away the other side.
    ai.hop = 1.4; f.vy = -880; f.vx = -away * 760; f.onGround = false; f.y -= 1; f.facing = -away;
    world.sfx('jump', f.x, 0.7, 1.3); world.fx.dust(f.x, 0, 4, 0, 200);
    return;
  }
  f.moveX = dist < 560 ? (room < 120 ? 0 : away) : 0;
  if (rng() < dt * 14) world.fx.ember(f.cx + rand(-8, 8), f.cy + rand(-20, 20), 1, f.color);
}
const COURIER = { ...ENEMIES.initiate, kind: 'courier', name: 'Courier', hp: 64, posture: 60, runSpeed: 470, accel: 4200, scale: 0.92, color: '#ffd36b', outline: '#fff0c0', deco: 'hood',
  blade: { len: 1, gun: true }, ctrl: courierCtrl, chainBreak: 0, ribbons: [{ n: 9, seg: 6, color: '#ffd36b', width: 4, oy: 3 }] };

const spot = (w, far = 420) => { const p = w.player, side = p.x > (w.minX + w.maxX) / 2 ? -1 : 1; return clamp(p.x + side * far, w.minX + 160, w.maxX - 160); };

const RUN = {
  // The Shade is run by the director itself (it is a whole extra fight), so there is nothing to do here.
  shade: { start() {} },
  blackout: {
    start(S, d, w) { w.dark = 0.9; w.sfx('lightsOut', w.player.x); },
    end(S, d, w) { w.dark = 0; },
  },
  // Two kinds in the room turn on each other. Their blades now cut their own side too.
  feud: {
    start(S, d, w) {
      const kinds = [...new Set([...w.fighters.filter((f) => f.team === 1 && !f.dead && !f.def.boss).map((f) => f.def.kind), ...d.pending.map((p) => p.kind)])];
      if (kinds.length < 2) return false;
      S.side = Object.fromEntries(kinds.map((k, i) => [k, 1 + (i % 2)]));
      for (const f of w.fighters) if (f.team === 1 && !f.dead) RUN.feud.join(S, d, w, f);
    },
    join(S, d, w, f) {
      const side = S.side[f.def.kind];
      if (!side || f.riding || f.def.prop) return;
      f.feud = side; f.hunts = 'feud'; if (!f.tag) f.tag = 'FEUD';
    },
  },
  captive: {
    start(S, d, w) { S.cell = w.spawnProp('cell', spot(w, 520)); S.cell.tag = 'PRISONER'; S.cell.barT = 1e9; },
    event(S, d, w, e) {
      if (e.type !== 'prop' || e.kind !== 'cell') return;
      const f = w.spawnClimber(true, e.x, false);
      f.invuln = 1; f.barT = 1e9;
      w.banner('FREED', `${f.def.name} fights beside you`, 2.2); w.sfx('allyFreed', e.x);
      w.fx.ring(e.x, -60, 20, 260, 0.5, f.color, 1, 6);
    },
  },
  stampede: {
    start(S, d, w) {
      const R = d.run.roster, ids = R.beasts.filter((id) => id && !R.defs[id].flying && !R.defs[id].ranged);
      if (!ids.length) return false;
      const own = R.beasts[d.sector.q], src = R.defs[ids.includes(own) ? own : ids[0]];
      w.roster.herd = { ...src, kind: 'herd', ctrl: herdCtrl, hitWall: undefined, rideable: false, runSpeed: 660, accel: 5200, traits: {}, noRagdoll: true, armor: 2 };
      S.pass = 0; S.next = 0.2; S.warn = 0;
    },
    tick(S, d, w, dt) {
      if (S.pass >= 3 && !w.herd) return;
      if (w.herd) {
        if ((w.herd.t -= dt) > 0) return;
        const dir = w.herd.dir, n = 3 + S.pass;
        for (let i = 0; i < n; i++) {
          const f = w.spawnEnemy('herd', dir > 0 ? w.minX + 70 : w.maxX - 70, false);
          f.team = 2; f.herd = dir; f.x -= dir * 0; f.ai.cd = 0; f.hp = f.maxHp = 9999; f.rate = 1 - i * 0.06; f.facing = dir;
        }
        w.sfx('stampede', w.player.x); w.shake(0.7);
        w.herd = null; S.next = 4.2;
        return;
      }
      if ((S.next -= dt) <= 0) { S.pass++; w.herd = { dir: rng() < 0.5 ? 1 : -1, t: 1.5, max: 1.5 }; w.sfx('stampedeWarn', w.player.x); }
    },
    end(S, d, w) { w.herd = null; for (const f of w.fighters) if (f.herd) f.remove = true; },
  },
  bounty: {
    start(S, d, w) {
      w.roster.courier = COURIER;
      const f = w.spawnEnemy('courier', spot(w, 380), true);
      f.team = 2; f.hp = f.maxHp = Math.round(COURIER.hp * (1 + (w.hpMul - 1) * 0.7)); f.tag = 'COURIER'; f.armed = false;
    },
    event(S, d, w, e) {
      if (e.type !== 'kill' || e.kind !== 'courier') return;
      w.dropShards(e.x ?? w.player.x, -60, 50); d.bonus.push('rare');
      w.banner('COURIER DOWN', 'It was carrying a card', 2); w.sfx('bountyWon', w.player.x);
    },
  },
  rival: {
    start(S, d, w) { S.f = w.spawnClimber(false, spot(w, 460), true); w.banner(S.f.def.name, 'Another climber, and not here to help', 2.4); },
    event(S, d, w, e) {
      if (e.type === 'kill' && e.kind === 'rival') { w.dropShards(w.player.x, -60, 45); w.banner('RIVAL BEATEN', 'One fewer on the stair', 2); w.sfx('bountyWon', w.player.x); }
    },
    end(S, d, w) {
      const f = S.f;
      if (f && !f.dead && !f.remove) { f.remove = true; w.fx.beam(f.x, 0.8, f.color); w.fx.text(f.x, f.j[1] - 50, 'UNTIL NEXT TIME', f.color, 15, 1.4); }
    },
  },
  quake: {
    start(S, d, w) {
      w.shake(1); w.sfx('quake', w.player.x); w.flashScreen('#ffffff', 0.2);
      w.platforms.forEach((p, i) => { p.life = 0.4 + i * 0.35; });
      const half = w.maxX - 150;
      for (const k of [-0.6, -0.05, 0.55]) w.hazards.push({ x: (k + rand(-0.08, 0.08)) * half, w: 56, period: rand(4, 5.5), t: rand(1.4, 2.6), armed: false });
      w.walls = true;
      for (let i = 0; i < 26; i++) w.fx.dust(rand(w.minX, w.maxX), 0, 2, 0, 260);
      for (const f of w.fighters) if (f.onGround && !f.rag && !f.def.prop && !f.def.noRagdoll && f.state === 'free') { f.vy = -340; f.onGround = false; f.y -= 1; }
      S.t = 0;
    },
    tick(S, d, w, dt) { if ((S.t += dt) < 6 && rng() < dt * 5) { w.shake(0.25); w.fx.dust(rand(w.minX, w.maxX), 0, 2, 0, 200); } },
  },
  storm: {
    start(S, d, w) { S.t = 0; S.next = 0.6; S.n = 0; w.sfx('thunder', w.player.x); },
    tick(S, d, w, dt) {
      if ((S.t += dt) > 20) return;
      if ((S.next -= dt) > 0) return;
      S.next = rand(0.7, 1.1); S.n++;
      // Every third bolt is aimed at the player, so standing still is the one wrong answer.
      const x = S.n % 3 === 0 ? w.player.x + w.player.vx * 0.4 : rand(w.minX + 80, w.maxX - 80);
      w.hazardPillar(clamp(x, w.minX + 60, w.maxX - 60), 0.9, { dmg: 16, w: 62, color: '#bfe6ff' });
    },
  },
  cache: {
    start(S, d, w) { const f = w.spawnProp('cache', spot(w, 400), -640); f.vy = 600; w.fx.beam(f.x, 1, f.color); w.sfx('cacheDrop', f.x); },
    event(S, d, w, e) {
      if (e.type !== 'prop' || e.kind !== 'cache') return;
      w.dropShards(e.x, -50, 55 + d.stageDef.n);
      for (let i = 0; i < 3; i++) w.orbs.push({ kind: i ? 'hp' : 'focus', x: e.x, y: -50, vx: rand(-260, 260), vy: -rand(260, 520), t: 0 });
    },
  },
};

// Break in: the banner, the noise, and whatever the surprise does first. A surprise that cannot
// happen on this floor (a feud with one kind of enemy in the room) falls back to a supply drop.
export function startSurprise(d, w, sur) {
  let type = sur.type, S = { type, on: true };
  if (RUN[type].start(S, d, w) === false) { type = 'cache'; S = { type, on: true }; RUN.cache.start(S, d, w); }
  const info = SURPRISES[type];
  if (type !== 'rival') w.banner(info.name, info.text, 2.8);
  w.bannerMsg.alarm = true;
  w.sfx('surprise', w.player.x); w.flashScreen('#ff2e6e', 0.22); w.shake(0.45); w.slow(0.35, 0.5);
  w.events.push({ type: 'surprise', kind: type });
  return S;
}
export const tickSurprise = (d, w, S, dt) => RUN[S.type].tick?.(S, d, w, dt);
export const surpriseEvent = (d, w, S, e) => RUN[S.type].event?.(S, d, w, e);
export const joinSurprise = (d, w, S, f) => RUN[S.type].join?.(S, d, w, f);
export function endSurprise(d, w, S) { if (S.on) { S.on = false; RUN[S.type].end?.(S, d, w); } }
