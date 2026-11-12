// Bolts, ground shockwaves, thrown blades, lobbed charges and floor eruptions.
import { distPointSeg, clamp, rng } from '../core/math.js';
import { applyHit, hurtCircles } from './combat.js';

const BOLT_HIT = { dmg: 9, post: 14, kx: 200, ky: 0, kind: 'flinch', stop: 0.05, shake: 0.15, stun: 0.28 };
const REFLECT_HIT = { dmg: 46, post: 70, kx: 440, ky: -320, kind: 'knock', stop: 0.12, shake: 0.4, stun: 0.5, fromPlayer: true, id: 'REFLECT', fam: 'reflect' };
const SABER_HIT = { dmg: 5, post: 8, kx: 70, ky: -250, kind: 'flinch', stop: 0.03, shake: 0.1, stun: 0.34, fromPlayer: true, id: 'THROW', fam: 'throw' };
const DISC_HIT = { dmg: 7, post: 16, kx: 170, ky: 0, kind: 'flinch', stop: 0.05, shake: 0.2, stun: 0.3 };
const BLAST_HIT = { dmg: 14, post: 30, kx: 420, ky: -400, kind: 'knock', stop: 0.1, shake: 0.5, stun: 0.4, unblockable: true };
const LOB_G = 1500;

export class Projectiles {
  constructor() { this.list = []; }
  clear() { this.list.length = 0; }

  bolt(owner, x, y, ang, speed = 760) {
    this.list.push({ type: 'bolt', team: owner.team, owner, x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, life: 3.2, color: owner.color, hit: BOLT_HIT });
  }
  wave(owner, x, dir, o = {}) {
    const speed = o.speed ?? 520, life = (o.range ?? 560) / speed;
    const hit = { dmg: o.dmg ?? 14, post: 30, kx: 380, ky: -430, kind: 'knock', stop: 0.09, shake: 0.4, stun: 0.4, unblockable: !o.crescent };
    // The player's own wave (the Crescent power) scores like any other attack and cannot be stopped by a shield.
    if (owner.team === 0) Object.assign(hit, { fromPlayer: true, id: 'CRESCENT', fam: 'power', unblockable: true, post: 40 });
    this.list.push({ type: o.crescent ? 'crescent' : 'wave', team: owner.team, owner, x, dir, speed, h: o.h ?? 46, w: 24, life, max: life, color: owner.color,
      parryable: !!o.crescent && owner.team !== 0, seen: new Set(), hit });
  }
  // A thrown blade that flies out and homes back to its owner. The player's saber and the Duelist's staff both use it.
  saber(owner, range = 480, dmgK = 1) {
    this.list.push({ type: 'saber', team: owner.team, owner, x: owner.cx + owner.facing * 30, y: owner.cy - 4, x0: owner.cx + owner.facing * 30, dir: owner.facing, range, t: 0, phase: 'out', ang: 0, life: 9,
      color: owner.color, len: owner.double ? owner.bladeLen * 0.9 : owner.bladeLen * 0.5, cd: new Map(), hit: owner.isPlayer ? (dmgK === 1 ? SABER_HIT : { ...SABER_HIT, dmg: SABER_HIT.dmg * dmgK }) : DISC_HIT });
  }
  // A charge thrown in an arc. It lands, arms with a visible ring, then bursts.
  lob(owner, x, y, tx, o = {}) {
    const T = o.time ?? 0.85;
    this.list.push({ type: 'lob', team: owner.team, owner, x, y, vx: (tx - x) / T, vy: (-2 - y) / T - 0.5 * LOB_G * T, life: 6, color: o.color ?? owner.color, fuse: o.fuse ?? 0.65, r: o.r ?? 105, dmg: o.dmg ?? 14, landed: false, beep: 0, max: o.fuse ?? 0.65 });
  }
  mine(owner, x, o = {}) {
    this.list.push({ type: 'lob', team: owner.team, owner, x, y: -2, vx: 0, vy: 0, life: 6, color: o.color ?? owner.color, fuse: o.fuse ?? 0.7, r: o.r ?? 120, dmg: o.dmg ?? 14, landed: true, beep: 0, max: o.fuse ?? 0.7 });
  }
  // A marked strip of floor that erupts after `delay`.
  pillar(owner, x, delay, o = {}) {
    this.list.push({ type: 'pillar', team: owner.team, owner, x, delay, max: delay, life: delay + 0.4, color: o.color ?? owner.color, w: o.w ?? 46, dmg: o.dmg ?? 16, fired: false, seen: new Set() });
  }

  update(world, dt, ets) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      const d = p.team === 0 ? dt : dt * ets;
      p.life -= d;
      let dead = p.life <= 0;
      if (!dead) {
        switch (p.type) {
          case 'bolt': dead = this.tickBolt(world, p, d); break;
          case 'saber': dead = this.tickSaber(world, p, d); break;
          case 'lob': dead = this.tickLob(world, p, d); break;
          case 'pillar': dead = this.tickPillar(world, p, d); break;
          default: dead = this.tickWave(world, p, d);
        }
      } else if (p.type === 'saber') p.owner.armed = true;
      if (dead) L.splice(i, 1);
    }
  }

  tickBolt(world, p, dt) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    const fx = world.fx;
    if (p.y > -2 || p.x < world.minX || p.x > world.maxX) { fx.spark(p.x, Math.min(p.y, -2), -Math.PI / 2, 1.4, 8, 300, p.color); return true; }
    // A swinging blade bats a bolt back.
    const pl = world.player;
    if (p.team !== 0 && pl.state === 'attack' && pl.activeHit && pl.armed && distPointSeg(p.x, p.y, pl.j[2], pl.j[3], pl.tx, pl.ty) < 24) { this.reflect(world, p, pl); return false; }
    for (const f of world.fighters) {
      if (f.team === p.team || f.dead || f.remove || f.phantom) continue;
      const c = hurtCircles(f);
      for (let k = 0; k < 12; k += 3) {
        if (Math.hypot(c[k] - p.x, c[k + 1] - p.y) > c[k + 2] + 8) continue;
        if (f.invuln > 0) return false;
        const dir = p.vx >= 0 ? 1 : -1;
        if (world.guarding(f) && f.facing === -dir) {
          if (f.parryT > 0) { this.reflect(world, p, f); f.parryT = 0.2; if (f.isPlayer) { f.riposteT = 0; world.stats.parries++; } return false; }
          f.posture += 12; f.postureDelay = 1.6; f.blockT = 0.15; f.shieldHit = 0.2;
          fx.spark(p.x, p.y, dir > 0 ? Math.PI : 0, 1, 8, 360, p.color); fx.flash(p.x, p.y, 40, p.color, 0.1);
          world.sfx('block', p.x);
          return true;
        }
        applyHit(world, null, f, { ...p.hit, dir }, p.x, p.y);
        fx.spark(p.x, p.y, dir > 0 ? 0 : Math.PI, 1.2, 10, 420, p.color);
        return true;
      }
    }
    return false;
  }

  reflect(world, p, by) {
    const o = p.owner, sp = Math.hypot(p.vx, p.vy) * 1.7;
    let ang = Math.atan2(-p.vy, -p.vx);
    if (o && !o.dead) ang = Math.atan2(o.cy - p.y, o.cx - p.x);
    p.vx = Math.cos(ang) * sp; p.vy = Math.sin(ang) * sp;
    p.team = by.team; p.owner = by; p.color = by.color; p.hit = REFLECT_HIT; p.life = 2.5;
    world.fx.spark(p.x, p.y, ang, 0.9, 16, 620, by.color, { white: 0.6 }); world.fx.flash(p.x, p.y, 70, '#ffffff', 0.14);
    world.fx.ring(p.x, p.y, 6, 70, 0.25, '#ffffff', 1, 3);
    world.sfx('boltReflect', p.x); world.stop(0.07); world.shake(0.25);
    if (by.isPlayer) { world.gainFocus(20); world.style.bonus(8); }
  }

  tickWave(world, p, dt) {
    p.x += p.dir * p.speed * dt;
    if (p.x < world.minX || p.x > world.maxX) return true;
    if (rng() < dt * 30) world.fx.spark(p.x, -4, -Math.PI / 2, 0.9, 1, 260, p.color, { life: 0.3 });
    for (const f of world.fighters) {
      if (f.team === p.team || f.dead || f.rag || f.phantom || p.seen.has(f)) continue;
      if (Math.abs(f.x - p.x) > p.w + 16 * f.scale || f.y < -p.h) continue;
      p.seen.add(f);
      if (f.invuln > 0) continue;
      if (p.parryable && world.guarding(f) && f.facing === -p.dir) {
        if (f.parryT > 0) { this.parried(world, f, p.x, -40); return true; }
        f.posture += 26; f.postureDelay = 1.8; f.blockT = 0.2; f.vx = p.dir * 260;
        world.fx.spark(p.x, -40, 0, 3.14, 12, 420, p.color); world.sfx('block', f.x);
        if (f.posture >= f.maxPosture && f.isPlayer) { f.setState('stagger', 1.0); f.posture = 0; world.sfx('guardBreak', f.x); }
        return true;
      }
      applyHit(world, null, f, { ...p.hit, dir: p.dir }, f.x, -30);
    }
    return false;
  }

  // Shared feedback for parrying something that is not a held weapon.
  parried(world, f, x, y) {
    world.fx.spark(x, y, 0, 3.14, 24, 640, f.color, { white: 0.6 }); world.fx.flash(x, y, 70, '#ffffff', 0.13);
    world.fx.text(f.x, f.j[1] - 40, 'PARRY', '#ffffff', 22, 0.8);
    world.sfx('parry', f.x); world.stop(0.1); world.shake(0.3);
    f.parryT = 0.2;
    if (f.isPlayer) { world.gainFocus(34); world.style.bonus(12); f.riposteT = 0; world.stats.parries++; }
  }

  tickSaber(world, p, dt) {
    const o = p.owner;
    p.t += dt; p.ang += dt * 34;
    if (p.phase === 'out') {
      const u = clamp(p.t / 0.42, 0, 1);
      p.x = clamp(p.x0 + p.dir * p.range * (1 - (1 - u) ** 2), world.minX + 20, world.maxX - 20);
      if (p.t > 0.56) { p.phase = 'back'; p.t = 0; }
    } else {
      const tx = o.cx, ty = o.cy - 6;
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
      const sp = Math.min(2200, 700 + p.t * 2600);
      if (d < 34 || d < sp * dt || o.dead) {
        o.armed = true;
        if (!o.dead) { world.fx.flash(o.bx, o.by, 60, p.color, 0.14); world.fx.spark(o.bx, o.by, 0, 3.14, 8, 300, p.color); world.sfx('catch', o.x); }
        if (o.isPlayer) world.audioLoop('throw', false);
        return true;
      }
      p.x += (dx / d) * sp * dt; p.y += (dy / d) * sp * dt;
    }
    for (const [f, t] of p.cd) if (t - dt <= 0) p.cd.delete(f); else p.cd.set(f, t - dt);
    for (const f of world.fighters) {
      // The player's thrown saber keeps cutting bodies it passes through.
      if (f.team === p.team || (f.dead && (p.team !== 0 || f.deadT > 3.4)) || f.remove || f.phantom || p.cd.has(f)) continue;
      const c = hurtCircles(f);
      for (let k = 0; k < 12; k += 3) {
        if (Math.hypot(c[k] - p.x, c[k + 1] - p.y) > c[k + 2] + p.len) continue;
        p.cd.set(f, 0.13);
        const dir = p.phase === 'out' ? p.dir : (o.x > p.x ? 1 : -1);
        if (p.team !== 0 && f.invuln <= 0 && world.guarding(f) && f.facing === -dir) {
          // An enemy's thrown blade can be guarded; a parry sends it straight home and rattles its owner.
          if (f.parryT > 0) { this.parried(world, f, p.x, p.y); p.phase = 'back'; p.t = 0.2; o.posture += 35; o.postureDelay = 3; o.barT = 3.5; }
          else { f.posture += 14; f.postureDelay = 1.8; f.blockT = 0.15; world.fx.spark(p.x, p.y, 0, 3.14, 8, 360, p.color); world.sfx('block', f.x); }
          p.cd.set(f, 0.4);
          break;
        }
        const res = applyHit(world, null, f, { ...p.hit, dir, kind: f.rag ? 'pop' : 'flinch' }, c[k], c[k + 1]);
        if (res !== 'whiff') world.fx.slash(c[k], c[k + 1], p.ang, 60, p.color, 0.12, 3);
        break;
      }
    }
    // The spinning blade eats bolts.
    for (const q of this.list) if (q.type === 'bolt' && q.team !== p.team && Math.hypot(q.x - p.x, q.y - p.y) < p.len + 8) q.life = 0;
    return false;
  }

  tickLob(world, p, dt) {
    const fx = world.fx;
    if (!p.landed) {
      p.vy += LOB_G * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.x = clamp(p.x, world.minX + 10, world.maxX - 10);
      if (rng() < dt * 40) fx.ember(p.x, p.y, 1, p.color);
      if (p.y >= -2) { p.y = -2; p.landed = true; fx.spark(p.x, -3, -Math.PI / 2, 1.2, 6, 260, p.color); world.sfx('thud', p.x, 0.5); }
      return false;
    }
    p.fuse -= dt; p.beep -= dt;
    if (p.beep <= 0) { p.beep = 0.07 + p.fuse * 0.22; world.sfx('beep', p.x, 0.6); }
    if (p.fuse > 0) return false;
    fx.ring(p.x, -4, 10, p.r, 0.3, p.color, 0.3, 6); fx.ring(p.x, -40, 10, p.r * 0.8, 0.28, '#ffffff', 1, 3);
    fx.flash(p.x, -30, p.r * 1.2, p.color, 0.2); fx.spark(p.x, -20, -Math.PI / 2, 1.6, 26, 700, p.color, { white: 0.4 }); fx.dust(p.x, 0, 8, 0, 260);
    world.sfx('explode', p.x); world.shake(0.4);
    for (const f of world.fighters) {
      if (f.team === p.team || f.dead || f.phantom || f.invuln > 0) continue;
      if (Math.hypot(f.cx - p.x, f.cy + 20) > p.r + 14 * f.scale) continue;
      applyHit(world, null, f, { ...BLAST_HIT, dmg: p.dmg, dir: f.x >= p.x ? 1 : -1 }, f.cx, f.cy);
    }
    return true;
  }

  tickPillar(world, p, dt) {
    p.delay -= dt;
    if (p.delay > 0) return false;
    if (!p.fired) {
      p.fired = true;
      world.fx.spark(p.x, -4, -Math.PI / 2, 0.5, 22, 1100, p.color, { white: 0.4, grav: 600 }); world.fx.flash(p.x, -60, 120, p.color, 0.2);
      world.sfx('pillar', p.x); world.shake(0.3);
    }
    for (const f of world.fighters) {
      if (f.team === p.team || f.dead || f.phantom || p.seen.has(f) || f.invuln > 0) continue;
      if (Math.abs(f.x - p.x) > p.w + 12 * f.scale || f.y < -380) continue;
      p.seen.add(f);
      const hit = { ...BLAST_HIT, dmg: p.dmg, ky: -520, dir: f.x >= p.x ? 1 : -1 };
      if (p.team === 0) { hit.fromPlayer = true; hit.id = 'JUDGMENT'; hit.fam = 'power'; }
      applyHit(world, null, f, hit, f.x, f.cy);
    }
    return false;
  }
}
