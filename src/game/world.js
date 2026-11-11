// The simulation: owns fighters, projectiles, effects, time control and the camera. No DOM access, so
// it runs headless for fuzz tests; sound and input are injected.
import { clamp, lerp, rand, noise1, rng } from '../core/math.js';
import { Fighter } from './fighter.js';
import { resolveCombat } from './combat.js';
import { Projectiles } from './projectiles.js';
import { Fx } from '../render/fx.js';
import { PLAYER } from './player.js';
import { ENEMIES } from './enemies.js';

const RANKS = [0, 18, 42, 72, 108, 150];
export const RANK_NAMES = ['', 'D', 'C', 'B', 'A', 'S'];
const FAM_LABEL = { light: 'LIGHT STRINGS', heavy: 'HEAVY STRIKES', launch: 'LAUNCHERS', air: 'AIR COMBOS', spike: 'PLUNGES', throw: 'SABER THROWS', reflect: 'REFLECTS' };
export const famLabel = (f) => FAM_LABEL[f] || f.toUpperCase();

// Variety tracker: fresh moves hit harder and score more, repeats go stale.
class Style {
  constructor() { this.reset(); }
  reset() { this.recent = []; this.points = 0; this.rank = 0; this.combo = 0; this.comboT = 0; this.best = 0; this.lastFresh = 0; this.rankT = 0; }
  land(id) {
    let n = 0;
    for (const r of this.recent) if (r === id) n++;
    const mul = n === 0 ? 1.12 : n === 1 ? 1 : n === 2 ? 0.8 : 0.6;
    this.recent.push(id); if (this.recent.length > 10) this.recent.shift();
    this.combo++; this.comboT = 2.8; if (this.combo > this.best) this.best = this.combo;
    this.points = Math.min(RANKS[5] + 30, this.points + (n === 0 ? 7 : n === 1 ? 4 : n === 2 ? 2 : 0.6));
    if (n === 0) this.lastFresh = 0.6;
    return { mul, fresh: n === 0, stale: n >= 2 };
  }
  bonus(p) { this.points = Math.min(RANKS[5] + 30, this.points + p); this.comboT = Math.max(this.comboT, 2); }
  blocked() { this.comboT = Math.max(this.comboT, 1.2); }
  hurt() { this.points *= 0.45; this.combo = 0; this.comboT = 0; }
  update(dt) {
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
    this.points = Math.max(0, this.points - (this.combo > 0 ? 3.5 : 12) * dt);
    if (this.lastFresh > 0) this.lastFresh -= dt;
    if (this.rankT > 0) this.rankT -= dt;
    let r = 0;
    while (r < 5 && this.points >= RANKS[r + 1]) r++;
    if (r > this.rank) this.rankT = 0.5;
    const up = r > this.rank;
    this.rank = r;
    return up;
  }
}

export class World {
  constructor() {
    this.fx = new Fx();
    this.projectiles = new Projectiles();
    this.style = new Style();
    this.cam = { x: 0, y: -165, zoom: 1, trauma: 0, punchK: 0, sx: 0, sy: 0, t: 0 };
    this.view = { w: 1280, h: 720 };
    this.input = null;
    this.sfxOut = null; this.loopOut = null;
    this.fighters = []; this.player = null;
    this.minX = -1100; this.maxX = 1100;
    this.time = 0; this.hitstop = 0; this.slowK = 1; this.slowT = 0; this.witch = 0; this.timeScale = 1;
    this.focus = 100; this.maxFocus = 300; this.rally = 0; this.rallyT = 0;
    this.enemyDmg = 1; this.maxAttackers = 1; this.lastAtkT = -9; this.atkGap = 0.32;
    this.stats = { parries: 0, reads: 0, interrupts: 0, kills: 0, dodges: 0, hitsTaken: 0 };
    this.boss = null; this.bossChannel = 0; this.marker = null;
    this.bannerMsg = null; this.screenFlash = null; this.lockInput = false;
    this.events = []; // drained by the director / main loop: {type, ...}
    this.training = false;
    this.floor = 1; // 1-based floor number; enemies unlock extra attacks as it rises
  }

  // ───────────── setup ─────────────
  setArena(width) { this.minX = -width / 2; this.maxX = width / 2; }
  spawnPlayer(x = 0) {
    const p = new Fighter(PLAYER, x, 0);
    this.player = p; this.fighters.push(p);
    this.cam.x = x;
    return p;
  }
  // opts: { elite: 'swift' | 'armored' | 'volatile', temper: 'aggressive' | 'cautious' | 'flank' }
  spawnEnemy(kind, x, drop = true, opts = null) {
    const def = ENEMIES[kind];
    const f = new Fighter(def, clamp(x, this.minX + 60, this.maxX - 60), 1);
    if (def.hitWall) f.hitWall = (w) => def.hitWall(f, w);
    f.face(this.player ? this.player.x : 0);
    if (opts?.temper) f.temper = opts.temper;
    if (opts?.elite) {
      f.elite = opts.elite;
      f.hp = f.maxHp = Math.round(def.hp * 1.35);
      if (opts.elite === 'swift') f.rate = 1.25;
    }
    if (drop) {
      f.y = def.flying ? -520 : -620; f.vy = 500; f.onGround = false;
      this.fx.beam(f.x, 0.7, def.color); this.sfx(f.elite ? 'elite' : 'ignite', f.x, f.elite ? 0.9 : 0.5);
    }
    this.fighters.push(f);
    return f;
  }
  // An afterimage that repeats one of the boss's moves a beat later. It cannot be hit.
  spawnEcho(src, move, delay) {
    const f = new Fighter(ENEMIES.echo, src.x, 1);
    f.facing = src.facing; f.phantom = true; f.double = src.double; f.color = src.color; f.fade = 0.5; f.dmgMul = 0.6;
    f.p.set(src.p); f.ai.wait = delay; f.ai.move = move;
    f.computeJoints();
    this.fighters.push(f);
    return f;
  }
  clearEnemies() {
    this.fighters = this.fighters.filter((f) => f.team === 0);
    this.projectiles.clear(); this.boss = null; this.marker = null; this.bossChannel = 0;
    if (this.player) this.player.armed = true;
  }
  get enemies() { return this.fighters.filter((f) => f.team === 1 && !f.dead && !f.phantom); }
  // Allocation-free count for per-frame callers.
  countEnemies() { let n = 0; for (const f of this.fighters) if (f.team === 1 && !f.dead && !f.phantom) n++; return n; }

  // ───────────── services used by fighters / combat ─────────────
  sfx(name, x, vol = 1, pitch = 1) { this.sfxOut?.(name, x, vol, pitch); }
  audioLoop(name, on) { this.loopOut?.(name, on); }
  stop(t) { if (t > this.hitstop) this.hitstop = t; }
  slow(k, t) { if (this.slowT <= 0 || k <= this.slowK) { this.slowK = k; this.slowT = Math.max(this.slowT, t); } }
  shake(a) { this.cam.trauma = Math.min(1, Math.max(this.cam.trauma, a * 0.6) + a * 0.25); }
  punch(k) { this.cam.punchK = Math.max(this.cam.punchK, k); }
  flashScreen(color, t) { this.screenFlash = { color, t, max: t }; }
  banner(title, sub, t = 2.4) { this.bannerMsg = { title, sub, t, max: t }; }
  gainFocus(v) {
    const before = Math.floor(this.focus / 100);
    this.focus = Math.min(this.maxFocus, this.focus + v);
    if (Math.floor(this.focus / 100) > before) this.sfx('focus', this.player.x, 0.7);
  }
  guarding(f) { return f.state === 'guard' || (f.def.shield && f.state === 'free' && f.onGround && !f.broken); }

  requestAttack(f, ranged = false) {
    if (this.time - this.lastAtkT < this.atkGap) return false;
    let n = 0;
    for (const e of this.fighters) if (e !== f && e.team === 1 && !e.dead && !e.phantom && (e.state === 'attack' || e.ai.busy) && !!e.def.ranged === ranged) n++;
    if (n >= (ranged ? 1 : this.maxAttackers)) return false;
    this.lastAtkT = this.time;
    return true;
  }

  // Root-motion speed for a move's step window: stop short of a target instead of shoving through it.
  stepSpeed(f, v) {
    if (v > 700) return v;
    for (const e of this.fighters) {
      if (e.team === f.team || e.dead || e.rag || e.phantom || e.def.flying) continue;
      const d = (e.x - f.x) * f.facing;
      if (d > 0 && d < 54 * (f.scale + e.scale) / 2 + 6 && Math.abs(e.y - f.y) < 90) return 0;
    }
    return v;
  }

  moveFx(f, name) {
    const fx = this.fx;
    if (name === 'groundHit') {
      const x = f.tx, big = f.charged || f.scale > 1.2;
      fx.spark(x, -3, -Math.PI / 2, 1.2, big ? 22 : 12, big ? 620 : 440, f.color);
      fx.dust(x, 0, big ? 9 : 5, 0, 220); fx.flash(x, -6, big ? 110 : 60, f.color, 0.14);
      if (big) { fx.ring(x, -2, 10, 170, 0.35, f.color, 0.22, 5); this.sfx('slam', x); }
      this.shake(big ? 0.4 : 0.16);
    } else if (name === 'plunge') {
      fx.ring(f.x, -2, 14, 200, 0.4, f.color, 0.22, 6); fx.ring(f.x, -2, 10, 120, 0.3, '#ffffff', 0.22, 3);
      fx.spark(f.x, -3, -Math.PI / 2, 1.4, 26, 640, f.color); fx.dust(f.x - 20, 0, 6, -1, 300); fx.dust(f.x + 20, 0, 6, 1, 300);
      fx.flash(f.x, -10, 130, f.color, 0.16);
      this.sfx('slam', f.x); this.shake(0.5);
    } else if (name === 'hammer') {
      const x = f.tx;
      fx.spark(x, -3, -Math.PI / 2, 1.3, 30, 760, f.color, { white: 0.4 }); fx.dust(x - 20, 0, 7, -1, 300); fx.dust(x + 20, 0, 7, 1, 300);
      fx.flash(x, -10, 150, f.color, 0.18); fx.ring(x, -2, 14, 230, 0.4, f.color, 0.22, 7);
      this.sfx('hammer', x); this.shake(0.6);
    } else if (name === 'riposteLine') {
      fx.slash(f.x + f.facing * 150, f.cy, 0, 520, f.color, 0.3, 7);
      for (let i = 0; i < 3; i++) fx.ghost(f, f.color, 0.3 + i * 0.06);
    }
  }

  spawnFrom(f, what) {
    const pl = this.player;
    if (what === 'saber') { f.armed = false; this.projectiles.saber(f); this.audioLoop('throw', true); }
    else if (what === 'disc') { f.armed = false; this.projectiles.saber(f, 430); }
    else if (what === 'lob') { this.projectiles.lob(f, f.j[12], f.j[13], clamp(pl.x + pl.vx * 0.35, this.minX + 40, this.maxX - 40)); }
    else if (what === 'embers') {
      for (let i = -1; i <= 1; i++) this.projectiles.lob(f, f.tx, f.ty, clamp(pl.x + i * 190 + pl.vx * 0.3, this.minX + 40, this.maxX - 40), { time: 0.8 + (i + 1) * 0.12, fuse: 0.55, r: 90, dmg: 13 });
    } else if (what === 'pillars') {
      // A line of eruptions walking out from the hammer toward and past the player.
      const dir = pl.x >= f.x ? 1 : -1;
      for (let i = 0; i < 5; i++) this.projectiles.pillar(f, clamp(f.x + dir * (150 + i * 150), this.minX + 30, this.maxX - 30), 0.75 + i * 0.16);
    } else if (what === 'waveFwd') {
      this.projectiles.wave(f, f.tx, f.facing, { dmg: 13 }); this.sfx('shockwave', f.tx);
    }
    else if (what === 'bolt') {
      const ang = Math.atan2(f.ty - f.by, f.tx - f.bx);
      this.projectiles.bolt(f, f.tx, f.ty, ang);
      this.fx.flash(f.tx, f.ty, 50, f.color, 0.1); this.fx.spark(f.tx, f.ty, ang, 0.5, 6, 420, f.color);
      this.sfx('bolt', f.x);
    } else if (what === 'waves') {
      const x = f.move?.hits[0]?.shape === 'circle' ? f.x : f.tx;
      this.projectiles.wave(f, x, 1, { dmg: 13 }); this.projectiles.wave(f, x, -1, { dmg: 13 });
      this.fx.ring(x, -2, 14, 220, 0.4, f.color, 0.22, 6);
      this.sfx('shockwave', x); this.sfx('slam', x);
    } else if (what === 'crescent') {
      this.projectiles.wave(f, f.x + f.facing * 50, f.facing, { crescent: true, speed: 660, h: 84, range: 1300, dmg: 14 });
      this.sfx('shockwave', f.x, 0.7);
    }
  }

  chargeFx(f, dt) {
    if (rng() < dt * 60) {
      const a = rand(0, 6.28), r = rand(40, 80);
      this.fx.spark(f.tx + Math.cos(a) * r, f.ty + Math.sin(a) * r, a + Math.PI, 0.1, 1, 260, f.color, { grav: 0, life: 0.22, drag: 0 });
    }
    if (f.chargeT >= 0.3 && f.chargeT - dt < 0.3) { this.fx.flash(f.tx, f.ty, 90, '#ffffff', 0.18); this.fx.ring(f.tx, f.ty, 50, 6, 0.2, f.color, 1, 3); this.sfx('focus', f.x); }
  }

  onLand(f, vy) {
    if (vy > 500) { this.fx.dust(f.x, 0, vy > 1100 ? 8 : 3, 0, 160); this.sfx(vy > 1100 || f.scale > 1.3 ? 'landHeavy' : 'land', f.x, f.isPlayer ? 0.8 : 0.5); }
    if (f.scale > 1.3 && vy > 500) this.shake(0.25);
  }
  onBodyImpact(f, speed) {
    const big = speed > 820;
    this.fx.dust(f.x, 0, big ? 9 : 4, 0, big ? 260 : 140);
    this.sfx(big ? 'bounce' : 'thud', f.x, clamp(speed / 900, 0.3, 1));
    if (big) { this.fx.ring(f.x, -2, 10, 130, 0.3, '#ffffff', 0.22, 4); this.shake(0.3); this.fx.spark(f.x, -3, -Math.PI / 2, 1.3, 8, 380, '#ffffff'); }
  }
  onWallImpact(f, speed) {
    const x = f.x < 0 ? this.minX : this.maxX;
    this.fx.spark(x, f.j[5], f.x < 0 ? 0 : Math.PI, 1.3, 14, 520, '#ffffff'); this.fx.flash(x, f.j[5], 90, '#ffffff', 0.14);
    this.sfx('wallSplat', x, clamp(speed / 900, 0.4, 1)); this.shake(0.3);
  }

  onDamage(A, B, dmg, h, cx, cy, dir, info) {
    const fx = this.fx, col = A ? A.color : this.player.color;
    const heavy = h.kind !== 'flinch' || h.dmg >= 15;
    // Sparks fly along the direction the blade was travelling.
    const ang = A && !h.shape ? Math.atan2(A.ty - A.pty, A.tx - A.ptx) : dir > 0 ? 0 : Math.PI;
    fx.spark(cx, cy, ang, 0.7, heavy ? 22 : 11, heavy ? 760 : 520, col, { white: 0.45 });
    fx.flash(cx, cy, heavy ? 80 : 46, col, heavy ? 0.15 : 0.1);
    fx.slash(cx, cy, ang, heavy ? 190 : 120, col, heavy ? 0.2 : 0.14, heavy ? 6 : 4);
    this.stop(h.stop * (A?.charged ? 1.4 : 1)); this.shake(h.shake * (A?.charged ? 1.3 : 1));
    if (heavy) this.punch(0.022);
    const name = h.kind === 'launch' || h.kind === 'pop' ? 'hitLaunch' : h.kind === 'spike' ? 'hitSpike' : heavy ? 'hitHeavy' : 'hitLight';
    this.sfx(name, cx);
    if (B.isPlayer) {
      this.style.hurt(); this.stats.hitsTaken++;
      this.rally = Math.min(B.maxHp - Math.max(0, B.hp), this.rally + dmg * 0.6); this.rallyT = 3.2;
      this.sfx('hurt', B.x); this.flashScreen('#ff2a3a', 0.25);
    } else {
      if (info.punished) fx.text(cx, cy - 62, 'PUNISH', '#ffd36b', 16, 0.8);
      if (info.glance) fx.text(cx, cy - 46, 'GLANCED', '#8fa3b8', 13, 0.6);
      const pl = this.player;
      if (A === pl) {
        // Rally: striking back wins a slice of recent damage back.
        if (this.rally > 0) { const r = Math.min(this.rally, dmg * 0.5); this.rally -= r; pl.hp = Math.min(pl.maxHp, pl.hp + r); }
        if (!pl.onGround && pl.state === 'attack' && pl.move.air && !pl.move.plunge) {
          pl.vy = Math.min(pl.vy, -175);
          if (!pl.refunded) { pl.refunded = true; pl.airJumps = 1; pl.airDash = 1; }
        }
      }
    }
  }

  onAdapt(B, fam) {
    this.fx.text(B.x, B.j[1] - 44 * B.scale, 'ADAPTED', B.color, 17, 1.3);
    this.fx.ring(B.j[0], B.j[1], 6, 44, 0.4, B.color, 1, 3);
    this.sfx('adapt', B.x);
    this.events.push({ type: 'adapt', fam });
  }

  onKill(A, B, h, cx, cy, dir, cut) {
    const fx = this.fx;
    if (B.isPlayer) {
      this.stop(0.2); this.slow(0.25, 1.6); this.shake(0.7); this.sfx('death', B.x);
      this.events.push({ type: 'playerDead' });
      return;
    }
    this.stats.kills++;
    fx.spark(cx, cy, dir > 0 ? 0 : Math.PI, 1.5, 30, 900, B.color, { white: 0.3 });
    fx.flash(cx, cy, 100, '#ffffff', 0.16);
    if (cut >= 0) { fx.ember(cx, cy, 14, '#ffb060'); this.sfx('sever', cx); }
    this.sfx('kill', cx); this.stop(0.14); this.shake(0.5); this.punch(0.03);
    if (B.elite === 'volatile') this.projectiles.mine(B, B.x, { color: '#ff7a2e', fuse: 0.8, r: 125, dmg: 16 });
    this.gainFocus(12); this.style.bonus(6);
    const pl = this.player;
    if (pl && !pl.dead) pl.hp = Math.min(pl.maxHp, pl.hp + 2 + Math.min(this.rally, 6));
    const left = this.countEnemies();
    if (left === 0 && !this.training) this.slow(0.2, 0.9);
    this.events.push({ type: 'kill', kind: B.def.kind, left, boss: !!B.def.boss });
    if (B.def.boss) { this.flashScreen('#ffffff', 0.6); this.slow(0.12, 2.2); fx.ring(cx, cy, 20, 700, 0.9, '#ffffff', 1, 8); }
  }

  perfectDodge(pl, by) {
    pl.dodged = true;
    this.witch = 1.25; this.stats.dodges++;
    this.gainFocus(22); this.style.bonus(10);
    for (let i = 0; i < 3; i++) this.fx.ghost(pl, '#ffffff', 0.35 + i * 0.08);
    this.fx.ring(pl.cx, pl.cy, 14, 150, 0.4, pl.color, 1, 3);
    this.fx.text(pl.x, pl.j[1] - 40, 'FLOW', pl.color, 20, 0.8);
    this.sfx('perfectDodge', pl.x);
  }

  // ───────────── step ─────────────
  step(dtReal) {
    this.updateCamera(dtReal);
    if (this.screenFlash && (this.screenFlash.t -= dtReal) <= 0) this.screenFlash = null;
    if (this.bannerMsg && (this.bannerMsg.t -= dtReal) <= 0) this.bannerMsg = null;
    if (this.hitstop > 0) { this.hitstop -= dtReal; this.fx.update(dtReal * 0.12); return; }
    let ts = 1;
    if (this.slowT > 0) { this.slowT -= dtReal; ts = this.slowT < 0.15 ? lerp(1, this.slowK, Math.max(0, this.slowT) / 0.15) : this.slowK; if (this.slowT <= 0) this.slowK = 1; }
    let ets = 1;
    if (this.witch > 0) { this.witch -= dtReal; ets = this.witch < 0.3 ? lerp(1, 0.22, Math.max(0, this.witch) / 0.3) : 0.22; }
    this.timeScale = ts * (this.witch > 0 ? 0.6 + 0.4 * ets : 1);
    const dt = dtReal * ts;
    this.time += dt;

    const fs = this.fighters;
    for (let i = 0; i < fs.length; i++) fs[i].update(this, fs[i].team === 0 ? dt : dt * ets);
    this.separate(dt);
    resolveCombat(this);
    this.projectiles.update(this, dt, ets);
    this.fx.update(dt);
    if (this.style.update(dt)) this.sfx('rankUp', this.player.x, 0.6);
    if (this.rallyT > 0) this.rallyT -= dt; else if (this.rally > 0) this.rally = Math.max(0, this.rally - 18 * dt);
    for (let i = fs.length - 1; i >= 0; i--) if (fs[i].remove) fs.splice(i, 1);
  }

  separate(dt) {
    const fs = this.fighters, k = Math.min(1, dt * 14);
    for (let a = 0; a < fs.length; a++) {
      const A = fs[a];
      if (A.rag || A.phantom || !A.onGround || A.state === 'dash' || A.stepping && Math.abs(A.vx) > 700) continue;
      for (let b = a + 1; b < fs.length; b++) {
        const B = fs[b];
        if (B.rag || B.phantom || !B.onGround || B.state === 'dash' || B.stepping && Math.abs(B.vx) > 700) continue;
        const min = 38 * (A.scale + B.scale) / 2, dx = B.x - A.x;
        if (Math.abs(dx) >= min) continue;
        const push = (min - Math.abs(dx)) * 0.5 * k * (dx >= 0 ? 1 : -1);
        // Heavier bodies give less ground.
        const wa = B.scale / (A.scale + B.scale), wb = 1 - wa;
        A.x -= push * 2 * wa; B.x += push * 2 * wb;
      }
    }
  }

  updateCamera(dt) {
    const c = this.cam, p = this.player;
    if (!p) return;
    c.t += dt;
    let tx = p.x + p.facing * 40, spread = 0, n = 0, ex = 0;
    for (const e of this.fighters) {
      if (e.team !== 1 || e.dead || e.phantom || e.y < -700) continue;
      const d = Math.abs(e.x - p.x);
      if (d < 760) { ex += e.x; n++; if (d > spread) spread = d; }
    }
    if (n) tx = lerp(p.x, ex / n, 0.38);
    const zt = clamp(1.3 - spread / 1500, 0.9, 1.22);
    const ty = -168 + Math.min(0, (p.rag ? p.j[5] + 50 : p.y)) * 0.5;
    const k = 1 - Math.exp(-dt * 5.5);
    c.x += (tx - c.x) * k; c.y += (ty - c.y) * (1 - Math.exp(-dt * 7)); c.zoom += (zt - c.zoom) * (1 - Math.exp(-dt * 2.2));
    const hw = this.view.w / (2 * c.zoom), lo = this.minX - 140 + hw, hi = this.maxX + 140 - hw;
    c.x = lo < hi ? clamp(c.x, lo, hi) : (this.minX + this.maxX) / 2;
    c.trauma = Math.max(0, c.trauma - dt * 1.9);
    c.punchK = Math.max(0, c.punchK - dt * 0.16);
    const s = c.trauma * c.trauma * 10;
    c.sx = noise1(c.t * 34) * s; c.sy = noise1(c.t * 34 + 50) * s;
  }
}
