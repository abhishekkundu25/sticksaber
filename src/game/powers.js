// Focus powers. The player owns a list of them, picks the active one at any time (U cycles, the
// number keys choose directly) and spends pips on it with the power key. The saber throw is the
// first; the rest are won from champions. Burst and Overdrive are separate and always available.
import { rand, clamp } from '../core/math.js';
import { applyHit } from './combat.js';

const ARC_HIT = { dmg: 16, post: 20, kx: 120, ky: 0, kind: 'flinch', stop: 0.03, shake: 0.14, stun: 0.6, fromPlayer: true, id: 'ARC', fam: 'power', unblockable: true };
const NOVA_HIT = { dmg: 24, post: 40, kx: 540, ky: -400, kind: 'knock', stop: 0.1, shake: 0.5, stun: 0.5, fromPlayer: true, id: 'NOVA', fam: 'power', unblockable: true };
const FLASH_HIT = { dmg: 15, post: 16, kx: 40, ky: 0, kind: 'flinch', stop: 0.04, shake: 0.2, stun: 0.9, fromPlayer: true, id: 'FLASH', fam: 'power', unblockable: true };
const FLASH_END = { dmg: 14, post: 30, kx: 380, ky: -420, kind: 'knock', stop: 0.12, shake: 0.5, stun: 0.5, fromPlayer: true, id: 'FLASHEND', fam: 'power', unblockable: true };

const foes = (world, f, range, max = 99) => {
  const out = [];
  for (const e of world.fighters) {
    if (e.team === f.team || e.dead || e.phantom || e.remove || e.y < -700) continue;
    const d = Math.abs(e.x - f.x);
    if (d <= range) out.push(e);
  }
  out.sort((a, b) => Math.abs(a.x - f.x) - Math.abs(b.x - f.x));
  if (out.length > max) out.length = max;
  return out;
};
const none = (world, f, msg = 'NO TARGET') => { world.sfx('uiMove', f.x); world.fx.text(f.x, f.j[1] - 36, msg, '#8fa3b8', 14, 0.6); return false; };
const cast = (f) => { if (f.state !== 'attack' || f.move.fam === 'power') f.startMove('CAST'); };

export const POWERS = {
  throw: {
    name: 'SABER THROW', short: 'THROW', cost: 1, color: '#56e9ff', text: 'The blade flies out, cuts everything in its path and returns',
    ready: (world, f) => f.armed,
    use(world, f) { f.startMove('THROW'); if (!f.onGround) f.vy = Math.min(f.vy, -180); return true; },
  },
  crescent: {
    name: 'CRESCENT', short: 'CRESCENT', cost: 1, color: '#9ff3ff', text: 'A wave of light runs along the floor and launches whatever it meets',
    ready: (world, f) => f.armed,
    use(world, f) { f.startMove('CRESCENT'); if (!f.onGround) f.vy = Math.min(f.vy, -160); return true; },
  },
  arc: {
    name: 'ARC', short: 'ARC', cost: 1, color: '#c9a0ff', text: 'Lightning jumps between up to four enemies and stuns them',
    use(world, f) {
      const first = foes(world, f, 480, 1)[0];
      if (!first) return none(world, f);
      cast(f);
      let from = f, x0 = f.tx, y0 = f.ty;
      const hit = new Set();
      for (let i = 0; i < 4; i++) {
        let best = null, bd = i ? 340 : 9999;
        for (const e of world.fighters) {
          if (e.team === f.team || e.dead || e.phantom || hit.has(e) || e.y < -700) continue;
          const d = Math.hypot(e.cx - x0, e.cy - y0);
          if (d < bd) { bd = d; best = e; }
        }
        if (i === 0) best = first;
        if (!best) break;
        hit.add(best);
        world.fx.zap(x0, y0, best.cx, best.cy, this.color, 0.22 + i * 0.03);
        world.fx.flash(best.cx, best.cy, 70, this.color, 0.16);
        world.sfx('powerArc', best.x, 0.9, 1 + i * 0.12);
        applyHit(world, null, best, { ...ARC_HIT, dir: best.x >= from.x ? 1 : -1 }, best.cx, best.cy);
        from = best; x0 = best.cx; y0 = best.cy;
      }
      world.shake(0.3);
      return true;
    },
  },
  mend: {
    name: 'MEND', short: 'MEND', cost: 1, color: '#7dffb0', text: 'Restore a quarter of your health',
    use(world, f) {
      if (f.hp >= f.maxHp - 1) return none(world, f, 'FULL HEALTH');
      cast(f);
      const v = 12 + f.maxHp * 0.2;
      f.hp = Math.min(f.maxHp, f.hp + v); world.rally = 0;
      world.fx.ring(f.cx, f.cy, 130, 16, 0.4, this.color, 1, 4); world.fx.ring(f.x, f.y - 2, 20, 150, 0.5, this.color, 0.2, 5);
      world.fx.ember(f.cx, f.cy + 30, 22, this.color); world.fx.flash(f.cx, f.cy, 150, this.color, 0.25);
      world.fx.text(f.x, f.j[1] - 44, `+${Math.round(v)}`, this.color, 22, 0.9);
      world.sfx('powerMend', f.x);
      return true;
    },
  },
  nova: {
    name: 'NOVA', short: 'NOVA', cost: 2, color: '#ffd36b', text: 'A ring of blades bursts outward: heavy damage to everything near you',
    use(world, f) {
      cast(f);
      const cx = f.cx, cy = f.cy, fx = world.fx;
      f.invuln = Math.max(f.invuln, 0.45);
      for (const e of foes(world, f, 350)) {
        if (e.y < -460) continue;
        applyHit(world, null, e, { ...NOVA_HIT, dir: e.x >= f.x ? 1 : -1 }, e.cx, e.cy);
      }
      for (const p of world.projectiles.list) if (p.team !== f.team && Math.abs(p.x - cx) < 380) p.life = 0;
      for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283 + 0.2; fx.slash(cx + Math.cos(a) * 190, cy + Math.sin(a) * 120, a, 210, this.color, 0.3, 6); }
      fx.ring(cx, cy, 30, 370, 0.5, this.color, 1, 10); fx.ring(cx, cy, 10, 260, 0.35, '#ffffff', 1, 5); fx.ring(f.x, f.y - 2, 30, 420, 0.55, this.color, 0.2, 7);
      fx.flash(cx, cy, 190, this.color, 0.22); fx.spark(cx, cy, 0, 3.14, 40, 1100, this.color, { white: 0.4, grav: 300 });
      fx.dust(f.x - 30, f.y, 7, -1, 360); fx.dust(f.x + 30, f.y, 7, 1, 360);
      fx.text(cx, cy - 90, 'NOVA', this.color, 26, 0.9);
      world.sfx('powerNova', cx); world.sfx('shockwave', cx, 0.8, 1.2);
      world.stop(0.14, true); world.slow(0.35, 0.3); world.shake(0.75); world.punch(0.04); world.flashScreen(this.color, 0.22);
      return true;
    },
  },
  stasis: {
    name: 'STILLPOINT', short: 'STILL', cost: 2, color: '#8fb4ff', text: 'Time all but stops for your enemies for three and a half seconds',
    use(world, f) {
      cast(f);
      world.witch = Math.max(world.witch, 3.6); world.stasis = 3.6;
      const fx = world.fx;
      fx.ring(f.cx, f.cy, 700, 20, 0.5, this.color, 1, 6); fx.ring(f.cx, f.cy, 20, 760, 0.7, '#ffffff', 1, 3);
      fx.flash(f.cx, f.cy, 380, this.color, 0.35);
      for (let i = 0; i < 4; i++) fx.ghost(f, this.color, 0.4 + i * 0.1);
      fx.text(f.x, f.j[1] - 50, 'STILLPOINT', this.color, 24, 1.0);
      world.sfx('powerStasis', f.x); world.stop(0.12, true); world.flashScreen(this.color, 0.3); world.punch(0.03);
      return true;
    },
  },
  mirror: {
    name: 'MIRROR', short: 'MIRROR', cost: 2, color: '#b9f6ff', text: 'An image of you fights at your back for ten seconds, repeating every attack',
    ready: (world) => !world.mirror,
    use(world, f) {
      cast(f);
      world.spawnMirror(f, 10);
      world.fx.ring(f.cx, f.cy, 20, 200, 0.4, this.color, 1, 5); world.fx.flash(f.cx, f.cy, 200, this.color, 0.25);
      world.fx.text(f.x, f.j[1] - 50, 'MIRROR', this.color, 22, 0.9);
      world.sfx('powerMirror', f.x); world.stop(0.08, true);
      return true;
    },
  },
  judgment: {
    name: 'JUDGMENT', short: 'JUDGE', cost: 2, color: '#ffe2a0', text: 'Pillars of light erupt under up to six enemies',
    use(world, f) {
      const list = foes(world, f, 900, 6);
      if (!list.length) return none(world, f);
      cast(f);
      list.forEach((e, i) => {
        world.projectiles.pillar(f, e.x + e.vx * 0.2, 0.5 + i * 0.07, { dmg: 34, w: 54, color: this.color });
        world.fx.ring(e.x, -2, 90, 10, 0.45, this.color, 0.2, 3);
      });
      world.fx.flash(f.tx, f.ty, 120, this.color, 0.2); world.fx.text(f.x, f.j[1] - 50, 'JUDGMENT', this.color, 22, 0.9);
      world.sfx('powerJudgment', f.x); world.shake(0.25);
      return true;
    },
  },
  flash: {
    name: 'FLASH STEP', short: 'FLASH', cost: 2, color: '#ff8fe0', text: 'Vanish and cut through up to six enemies, one after another',
    ready: (world, f) => f.armed,
    use(world, f) {
      const list = foes(world, f, 620, 6);
      if (!list.length) return none(world, f);
      const col = this.color, st = { i: 0, t: 0, done: false, x0: f.x };
      f.setState('custom', 0); f.invuln = 3; f.vx = 0; f.vy = 0;
      f.poseFn = (g, t) => { t[5] = -0.2; t[6] = 1; t[7] = 0.1; t[3] = 0.7; t[0] = 36; t[10] = 32; t[12] = -30; return 60; };
      world.slow(0.5, 0.2 + list.length * 0.075);
      world.fx.ghost(f, col, 0.5);
      f.script = (g, w, dt) => {
        g.vx = 0; g.vy = 0;
        if (st.done) {
          // The pause before the cuts land.
          if ((st.t += dt) < 0.3) return;
          for (const e of list) {
            if (e.dead || e.remove) continue;
            w.fx.slash(e.cx, e.cy, rand(-0.7, 0.7), 300, '#ffffff', 0.3, 9); w.fx.slash(e.cx, e.cy, rand(2, 2.6), 240, col, 0.34, 7);
            applyHit(w, null, e, { ...FLASH_END, dir: e.x >= g.x ? 1 : -1 }, e.cx, e.cy);
          }
          w.sfx('powerFlashEnd', g.x); w.stop(0.16, true); w.shake(0.7); w.punch(0.04); w.flashScreen(col, 0.25);
          g.script = null; g.fade = 1; g.invuln = 0.5; g.gravMul = 1; g.setState('free');
          return;
        }
        if ((st.t -= dt) > 0) return;
        const e = list[st.i++];
        if (!e) { st.done = true; st.t = 0; g.fade = 1; g.y = 0; g.onGround = true; g.x = clamp(g.x, w.minX + 40, w.maxX - 40); w.fx.ghost(g, col, 0.4); return; }
        if (e.dead || e.remove) return;
        const dir = e.x >= g.x ? 1 : -1, x1 = clamp(e.x + dir * 70, w.minX + 40, w.maxX - 40);
        w.fx.slash((g.x + x1) / 2, e.cy, Math.atan2(e.cy - g.cy, x1 - g.x), Math.abs(x1 - g.x) + 120, col, 0.3, 6);
        w.fx.ghost(g, col, 0.45);
        g.x = x1; g.facing = -dir; g.y = Math.min(0, e.y); g.onGround = g.y >= 0; g.gravMul = 0; g.fade = 0.25;
        w.fx.flash(e.cx, e.cy, 90, col, 0.14); w.fx.spark(e.cx, e.cy, dir > 0 ? 0 : Math.PI, 0.6, 12, 700, col, { white: 0.6 });
        w.sfx('powerFlash', e.x, 0.9, 1 + st.i * 0.07);
        applyHit(w, null, e, { ...FLASH_HIT, dir }, e.cx, e.cy);
        st.t = 0.075;
      };
      return true;
    },
  },
};
export const POWER_IDS = Object.keys(POWERS);

// Three powers the player does not own yet (fewer when few are left).
export function draftPowers(owned, r) {
  const left = POWER_IDS.filter((id) => !owned.includes(id));
  const out = [];
  while (out.length < 3 && left.length) out.push(left.splice((r() * left.length) | 0, 1)[0]);
  return out;
}
