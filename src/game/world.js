// The simulation: owns fighters, projectiles, effects, time control and the camera. No DOM access, so
// it runs headless for fuzz tests; sound and input are injected.
import { clamp, lerp, rand, noise1, rng } from '../core/math.js';
import { Fighter } from './fighter.js';
import { resolveCombat, applyHit } from './combat.js';
import { Projectiles } from './projectiles.js';
import { Fx } from '../render/fx.js';
import { PLAYER } from './player.js';
import { ENEMIES, echoDef } from './enemies.js';
import { baseMods, buildMods } from './augments.js';
import { POWERS } from './powers.js';
import { Beast } from './beasts.js';
import { FORMS } from './forms.js';

const RANKS = [0, 18, 42, 72, 108, 150];
export const RANK_NAMES = ['', 'D', 'C', 'B', 'A', 'S'];
const FAM_LABEL = { light: 'LIGHT STRINGS', heavy: 'HEAVY STRIKES', launch: 'LAUNCHERS', air: 'AIR COMBOS', spike: 'PLUNGES', throw: 'SABER THROWS', reflect: 'REFLECTS' };
export const famLabel = (f) => FAM_LABEL[f] || f.toUpperCase();

// Variety tracker: fresh moves hit harder and score more, repeats go stale.
class Style {
  constructor() { this.reset(); }
  reset() { this.recent = []; this.points = 0; this.rank = 0; this.combo = 0; this.comboT = 0; this.best = 0; this.lastFresh = 0; this.rankT = 0; }
  // `free` (Overdrive): the hit counts as fresh and leaves no trace in the history.
  land(id, free = false) {
    if (free) {
      this.combo++; this.comboT = 2.8; if (this.combo > this.best) this.best = this.combo;
      this.points = Math.min(RANKS[5] + 30, this.points + 7); this.lastFresh = 0.6;
      return { mul: 1.12, fresh: true, stale: false };
    }
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

export const OVERDRIVE_TIME = 6;
const STOP_BANK = 0.3; // seconds of hit-stop that can be held in reserve
const OD_COLOR = '#e6fdff';
const AURA_TRAITS = ['swift', 'armored', 'volatile'];
const STORM_HIT = { dmg: 28, post: 30, kx: 200, ky: -300, kind: 'knock', stop: 0.05, shake: 0.3, stun: 0.4, fromPlayer: true, id: 'STORM', fam: 'power', unblockable: true };
const WIRE_HIT = { dmg: 10, post: 10, kx: 120, ky: 0, kind: 'flinch', stop: 0.02, shake: 0.1, stun: 0.3, fromPlayer: true, id: 'WIRE', fam: 'power', unblockable: true };
const BURST_HIT = { dmg: 18, post: 30, kx: 640, ky: -440, kind: 'knock', stop: 0, shake: 0, stun: 0.4, fromPlayer: true, id: 'BURST', fam: 'power', unblockable: true };
// The mirror image: the player's body with a brain that only copies.
const MIRROR = { ...PLAYER, name: 'Mirror', ribbons: [], ctrl: mirrorCtrl };
export const newStats = () => ({ parries: 0, reads: 0, interrupts: 0, kills: 0, dodges: 0, hitsTaken: 0, cuts: 0, bursts: 0, overdrives: 0, powers: 0, orbs: 0, crits: 0 });

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
    this.time = 0; this.hitstop = 0; this.stopBank = STOP_BANK; this.slowK = 1; this.slowT = 0; this.witch = 0; this.timeScale = 1;
    this.focus = 100; this.maxFocus = 300; this.rally = 0; this.rallyT = 0;
    this.enemyDmg = 1; this.maxAttackers = 1; this.lastAtkT = -9; this.atkGap = 0.32;
    this.stats = newStats();
    this.overdrive = 0; this.lastBurst = -9; this.odGhost = 0;
    this.boss = null; this.bossChannel = 0; this.marker = null;
    this.bannerMsg = null; this.screenFlash = null; this.lockInput = false;
    this.events = []; // drained by the director / main loop: {type, ...}
    this.training = false;
    this.floor = 1; // 1-based floor number; enemies unlock extra attacks as it rises
    // Per-run state the director fills in.
    this.roster = null;                    // generated enemy definitions for this run, by kind
    this.hpMul = 1; this.rateMul = 1; this.cdMul = 1; this.gravK = 1; this.anom = null;
    this.build = {}; this.mods = baseMods(); // drafted augments and the modifiers they add up to
    this.powers = ['throw']; this.powerIdx = 0; this.powerT = 0;
    this.bonusHp = 0;                      // health earned by beating sector keepers
    this.formId = 'saber'; this.form = FORMS.saber;
    this.platforms = []; this.hazards = []; // terrain of the current floor
    this.bonds = [];                       // links between enemies: packs, tethers, riders
    this.orbs = []; this.mirror = null; this.stasis = 0;
    this.windUsed = false; this.freeCast = false; this.odShield = 0; this.odMax = OVERDRIVE_TIME; this.hitCount = 0;
  }

  // ───────────── setup ─────────────
  setArena(width) { this.minX = -width / 2; this.maxX = width / 2; }
  setBuild(build) {
    this.build = build; this.mods = buildMods(build);
    this.maxFocus = 300 + this.mods.pips * 100;
    const p = this.player;
    if (p && !p.dead) {
      const up = PLAYER.hp + this.mods.maxHp + this.bonusHp - p.maxHp;
      p.maxHp += up; p.hp = Math.min(p.maxHp, p.hp + Math.max(0, up));
      this.applyForm(p);
    }
  }
  baseBlade(f) { return f.blade.len * f.scale * (f.isPlayer ? this.mods.blade : 1); }
  // The weapon form chosen for the run: its own blade and its own move list.
  setForm(id) {
    this.formId = FORMS[id] ? id : 'saber'; this.form = FORMS[this.formId];
    const p = this.player;
    if (p && !p.dead) this.applyForm(p);
  }
  applyForm(p) {
    const F = this.form;
    p.blade = F.blade; p.double = !!F.blade.double; p.twin = !!F.blade.twin; p.dmgMul = F.dmg ?? 1;
    p.speedMul = this.mods.speed * (F.speed ?? 1);
    if (this.overdrive <= 0) p.bladeLen = this.baseBlade(p);
  }
  // A form names its own move for each of the player's slots (L1, H1, LAUNCH and so on).
  moveId(id) { return this.form.moves[id] || id; }
  // Height of the ground under a falling body: the floor, or a platform it is landing on.
  groundAt(x, y, vy, dt, f) {
    const P = this.platforms;
    if (!P.length || vy < 0 || f.dropT > 0) return 0;
    for (const p of P) {
      if (!p.solid || x < p.x - p.w / 2 || x > p.x + p.w / 2) continue;
      // One-way: only a body that was above the top a moment ago lands on it.
      if (y >= p.y - 1 && y - vy * dt <= p.y + 6) return p.y;
    }
    return 0;
  }
  spawnPlayer(x = 0) {
    const p = new Fighter(PLAYER, x, 0);
    this.player = p; this.fighters.push(p);
    this.cam.x = x; this.overdrive = 0; this.mirror = null; this.stasis = 0; this.orbs.length = 0;
    p.hp = p.maxHp = PLAYER.hp + this.mods.maxHp + this.bonusHp; this.applyForm(p);
    return p;
  }
  def(kind) { return this.roster?.[kind] || ENEMIES[kind]; }
  // opts: { elite: 'swift' | 'armored' | 'volatile', temper: 'aggressive' | 'cautious' | 'flank' }
  spawnEnemy(kind, x, drop = true, opts = null) {
    const def = this.def(kind);
    const f = new (def.beast ? Beast : Fighter)(def, clamp(x, this.minX + 60, this.maxX - 60), 1);
    if (def.hitWall) f.hitWall = (w) => def.hitWall(f, w);
    f.face(this.player ? this.player.x : 0);
    if (opts?.temper) f.temper = opts.temper;
    if (opts?.color) f.color = opts.color;
    const frenzy = this.anom === 'frenzy';
    let hp = def.hp * this.hpMul * (frenzy ? 0.75 : 1);
    f.rate = this.rateMul * (frenzy ? 1.15 : 1); f.ai.cdK = this.cdMul; f.dmgMul = def.dmg ?? 1;
    if (opts?.elite) {
      f.elite = opts.elite; f.tr = { ...f.tr, [opts.elite]: 1 };
      hp *= 1.35;
    }
    if (f.tr.swift) f.rate *= 1.2;
    f.hp = f.maxHp = Math.round(hp);
    if (drop) {
      f.y = def.flying ? -520 : -620; f.vy = 500; f.onGround = false;
      this.fx.beam(f.x, def.boss ? 1.1 : 0.7, def.color);
      this.sfx(def.champion ? 'championIntro' : f.elite ? 'elite' : 'ignite', f.x, f.elite || def.boss ? 0.9 : 0.5);
    }
    this.fighters.push(f);
    return f;
  }
  // An afterimage that repeats one of the boss's moves a beat later. It cannot be hit.
  spawnEcho(src, move, delay) {
    const f = new Fighter(echoDef(src.def), src.x, 1);
    f.facing = src.facing; f.phantom = true; f.double = src.double; f.color = src.color; f.fade = 0.5; f.dmgMul = 0.6;
    f.p.set(src.p); f.ai.wait = delay; f.ai.move = move; f.rate = src.rate;
    f.computeJoints();
    this.fighters.push(f);
    return f;
  }
  // The Mirror power: an image of the player that stands at their back and repeats their attacks.
  spawnMirror(src, life) {
    const f = new Fighter(MIRROR, src.x - src.facing * 64, 0);
    f.phantom = true; f.fade = 0.6; f.color = '#b9f6ff'; f.dmgMul = 0.5 * src.dmgMul; f.facing = src.facing; f.gravMul = 0;
    f.blade = src.blade; f.double = src.double; f.twin = src.twin;
    f.bladeLen = src.bladeLen; f.ai.life = life; f.ai.serial = src.atkSerial || 0; f.ai.queue = null;
    f.computeJoints();
    this.fighters.push(f); this.mirror = f;
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
  // Hit-stop freezes the whole world, so it is rationed: freezes draw on a small bank of time that
  // refills while the game runs. In a duel the bank never empties and every hit lands with its full
  // freeze. In a crowd, where something is hit every few frames, the freezes shrink instead of
  // stacking up until the game crawls. `strong` moments (parry, burst, phase changes) may overdraw a little.
  stop(t, strong = false) {
    t = Math.min(t, this.stopBank + (strong ? 0.08 : 0));
    if (t > this.hitstop) this.hitstop = t;
  }
  slow(k, t) { if (this.slowT <= 0 || k <= this.slowK) { this.slowK = k; this.slowT = Math.max(this.slowT, t); } }
  shake(a) { this.cam.trauma = Math.min(1, Math.max(this.cam.trauma, a * 0.6) + a * 0.25); }
  punch(k) { this.cam.punchK = Math.max(this.cam.punchK, k); }
  flashScreen(color, t) { this.screenFlash = { color, t, max: t }; }
  banner(title, sub, t = 2.4) { this.bannerMsg = { title, sub, t, max: t }; }
  gainFocus(v) {
    if (this.overdrive > 0) return; // the meter is the Overdrive clock while it runs
    const before = Math.floor(this.focus / 100);
    this.focus = Math.min(this.maxFocus, this.focus + v * this.mods.focus * (this.anom === 'surge' ? 2 : 1));
    if (Math.floor(this.focus / 100) > before) this.sfx('focus', this.player.x, 0.7);
  }
  // Slice a dead body up to `n` times near (x, y), throwing each piece along (ix, iy). Returns the cuts made.
  chop(B, x, y, ix, iy, n = 1) {
    const fx = this.fx, ang = Math.atan2(iy, ix);
    let made = 0;
    for (let i = 0; i < n; i++) {
      const c = B.rag.chop(x + rand(-16, 16) * i, y + rand(-26, 26) * i, ix * rand(0.7, 1.25), iy * rand(0.7, 1.2) - rand(140, 320));
      if (!c) break;
      made++;
      fx.ember(c[0], c[1], 9, '#ffb060'); fx.spark(c[0], c[1], ang, 0.9, 9, 560, '#ffd9a0', { white: 0.5 });
      fx.slash(c[0], c[1], ang, 80, '#ffffff', 0.14, 3); fx.flash(c[0], c[1], 34, '#ffb060', 0.1);
    }
    if (!made) return 0;
    this.stats.cuts += made;
    this.sfx('sever', x, 0.9, 1 + B.rag.pieces * 0.04);
    if (B.rag.pieces >= 5 && !B.diced) {
      B.diced = true;
      fx.text(B.rag.x[1], B.rag.y[1] - 60, 'DICED', '#ffb060', 18, 0.9);
      this.gainFocus(8); this.style.bonus(6);
    }
    return made;
  }

  // Burst: spend one pip while being hit or knocked down to blow everything back and stand up.
  burst(f, free = false) {
    if (!free && (this.focus < 100 || this.time - this.lastBurst < 1.5)) {
      this.sfx('uiMove', f.x); this.fx.text(f.x, f.j[1] - 36, this.focus < 100 ? 'NO FOCUS' : 'NOT YET', '#8fa3b8', 14, 0.6);
      return false;
    }
    if (!free) { this.focus -= 100; this.stats.bursts++; }
    this.lastBurst = this.time;
    if (f.rag) f.getUp(0.14); else f.setState('free');
    f.invuln = Math.max(f.invuln, 0.75); f.vx = 0; f.posture = 0;
    const cx = f.x, cy = f.y - 60, fx = this.fx;
    for (const e of this.fighters) {
      if (e.team === f.team || e.dead || e.phantom) continue;
      const dx = e.x - cx;
      if (Math.abs(dx) > 310 || e.y < -420) continue;
      const dir = dx >= 0 ? 1 : -1;
      if (e.rag) e.rag.kick(dir * 640, -430, rand(-5, 5));
      else if (e.def.armor >= 2 || e.def.noRagdoll) {
        // Heavies and bosses are not thrown, but the blast stops whatever they were doing.
        const scripted = e.state === 'custom' && e.ai.busy && !e.ai.channel;
        if (e.invuln <= 0 && !scripted) { e.setState('recoil', 0.55); e.vx = dir * 620; e.posture += 20; e.barT = 3; }
      } else e.toRagdoll(dir * 640, -440, rand(-5, 5));
      fx.spark(e.cx, e.cy, dir > 0 ? 0 : Math.PI, 0.8, 8, 620, f.color, { white: 0.5 });
      // Aftershock: the blast also hurts.
      if (this.mods.burstDmg && e.invuln <= 0) applyHit(this, null, e, { ...BURST_HIT, dmg: this.mods.burstDmg, dir }, e.cx, e.cy);
    }
    for (const p of this.projectiles.list) if (p.team !== f.team && Math.abs(p.x - cx) < 340) p.life = 0;
    fx.ring(cx, cy, 20, 330, 0.45, f.color, 1, 9); fx.ring(cx, cy, 10, 220, 0.3, '#ffffff', 1, 4); fx.ring(cx, f.y - 2, 30, 380, 0.5, f.color, 0.2, 6);
    fx.flash(cx, cy, 240, f.color, 0.22); fx.spark(cx, cy, 0, 3.14, 44, 980, f.color, { white: 0.5, grav: 300 });
    fx.dust(cx - 30, f.y, 7, -1, 340); fx.dust(cx + 30, f.y, 7, 1, 340);
    for (let i = 0; i < 3; i++) fx.ghost(f, '#ffffff', 0.3 + i * 0.07);
    fx.text(cx, cy - 80, 'BURST', f.color, 24, 0.9);
    this.sfx('shockwave', cx, 1, 1.3); this.sfx('parry', cx, 0.7, 0.7);
    this.stop(0.13, true); this.slow(0.4, 0.26); this.shake(0.65); this.punch(0.035); this.flashScreen(f.color, 0.18);
    return true;
  }

  // Overdrive: spend the whole meter. For six seconds the blade is longer and faster, nothing goes
  // stale or gets read, and each hit returns a little health. Taking a hit ends it.
  startOverdrive(f) {
    if (this.overdrive > 0) return false;
    if (this.focus < this.maxFocus) {
      this.sfx('uiMove', f.x); this.fx.text(f.x, f.j[1] - 36, 'NEED FULL FOCUS', '#8fa3b8', 14, 0.7);
      return false;
    }
    this.focus = 0; this.overdrive = this.odMax = OVERDRIVE_TIME + this.mods.odTime; this.odGhost = 0; this.stats.overdrives++;
    this.odShield = this.mods.odShield;
    f.rate = 1.15; f.bladeLen = this.baseBlade(f) * 1.22; f.color = OD_COLOR;
    f.invuln = Math.max(f.invuln, 0.5);
    const cx = f.cx, cy = f.cy, fx = this.fx;
    for (const e of this.fighters) {
      if (e.team === f.team || e.dead || e.phantom || e.rag || Math.abs(e.x - f.x) > 230 || e.def.armor >= 2) continue;
      e.setState('hitstun', 0.4); e.vx = (e.x >= f.x ? 1 : -1) * 420;
    }
    fx.ring(cx, cy, 240, 14, 0.3, '#56e9ff', 1, 5); fx.ring(cx, cy, 20, 300, 0.5, OD_COLOR, 1, 8); fx.ring(f.x, f.y - 2, 20, 340, 0.5, '#56e9ff', 0.2, 5);
    fx.flash(cx, cy, 260, '#56e9ff', 0.3); fx.spark(cx, cy, -Math.PI / 2, 1.2, 46, 900, '#56e9ff', { white: 0.6, grav: 200 });
    for (let i = 0; i < 5; i++) fx.ghost(f, '#56e9ff', 0.3 + i * 0.08);
    fx.text(f.x, f.j[1] - 60, 'OVERDRIVE', OD_COLOR, 28, 1.2);
    this.sfx('bossPhase', f.x, 0.8, 1.7); this.sfx('ignite', f.x, 1, 1.3); this.sfx('rankUp', f.x, 0.8);
    this.stop(0.16, true); this.slow(0.35, 0.4); this.shake(0.5); this.punch(0.04); this.flashScreen('#56e9ff', 0.3);
    return true;
  }
  endOverdrive(broken) {
    const f = this.player;
    this.overdrive = 0;
    if (!f) return;
    f.rate = 1; f.bladeLen = this.baseBlade(f); f.color = f.def.color;
    this.fx.ring(f.cx, f.cy, 14, 120, 0.3, f.color, 1, 3);
    this.sfx('extinguish', f.x, 0.8, 1.2);
    if (broken) { this.fx.text(f.x, f.j[1] - 40, 'OVERDRIVE BROKEN', '#ff6b6b', 16, 0.9); this.fx.spark(f.cx, f.cy, 0, 3.14, 20, 600, OD_COLOR); this.sfx('guardBreak', f.x, 0.6); }
  }

  // ───────────── focus powers ─────────────
  get power() { return POWERS[this.powers[this.powerIdx]] || POWERS.throw; }
  cyclePower(dir = 1) {
    const n = this.powers.length;
    if (n < 2) return;
    this.powerIdx = (this.powerIdx + dir + n) % n; this.powerT = 1.4;
    this.sfx('powerSwap', this.player ? this.player.x : 0, 0.8, 1 + this.powerIdx * 0.1);
  }
  // By slot number or by id.
  selectPower(which) {
    const i = typeof which === 'number' ? which : this.powers.indexOf(which);
    if (i < 0 || i >= this.powers.length || i === this.powerIdx) return i === this.powerIdx;
    this.powerIdx = i; this.powerT = 1.4;
    this.sfx('powerSwap', this.player ? this.player.x : 0, 0.8, 1 + i * 0.1);
    return true;
  }
  // Spend pips on the selected power. Returns true if it went off.
  usePower(f) {
    const P = this.power, cost = this.freeCast ? 0 : P.cost * 100;
    if (P.ready && !P.ready(this, f)) return false;
    if (this.focus < cost) { this.sfx('uiMove', f.x); this.fx.text(f.x, f.j[1] - 36, this.overdrive > 0 ? 'OVERDRIVE' : 'NO FOCUS', '#8fa3b8', 14, 0.6); return false; }
    if (!P.use(this, f)) return false;
    if (this.freeCast) { this.freeCast = false; this.fx.text(f.x, f.j[1] - 70, 'FREE', '#ffd36b', 14, 0.8); }
    this.focus -= cost; this.stats.powers++;
    return true;
  }
  // A bolt from the player's build (Stormcaller, Live Wire) onto the nearest enemy other than `from`.
  strike(from, hit, dmg, range, color, fromSky) {
    let best = null, bd = range;
    for (const e of this.fighters) {
      if (e.team !== 1 || e.dead || e.phantom || e === from || e.remove || e.y < -700) continue;
      const d = Math.abs(e.x - from.x);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) return;
    if (fromSky) { this.fx.zap(best.x + rand(-60, 60), -760, best.cx, best.cy, color, 0.3); this.fx.flash(best.cx, best.cy, 120, color, 0.2); this.sfx('powerArc', best.x, 0.9, 0.8); this.shake(0.3); }
    else { this.fx.zap(from.cx, from.cy, best.cx, best.cy, color, 0.2); this.sfx('powerArc', best.x, 0.5, 1.3); }
    applyHit(this, null, best, { ...hit, dmg, dir: best.x >= from.x ? 1 : -1 }, best.cx, best.cy);
  }
  // Killed enemies sometimes leave motes of health and focus that fly to the player.
  dropOrbs(B, x, y) {
    if (this.training || B.def.kind === 'shard') return;
    const pl = this.player, k = this.mods.orbs * (this.anom === 'bounty' ? 3 : 1);
    let hp = rng() < (pl && pl.hp < pl.maxHp * 0.4 ? 0.18 : 0.06) * k ? 1 : 0, fo = rng() < 0.12 * k ? 1 : 0;
    if (B.elite) fo += rng() < 0.5 ? 1 : 0;
    if (B.def.boss) { hp += 4; fo += 4; }
    for (let i = 0; i < hp + fo && this.orbs.length < 40; i++) {
      this.orbs.push({ kind: i < hp ? 'hp' : 'focus', x, y, vx: rand(-260, 260), vy: -rand(240, 520), t: 0 });
    }
  }
  tickOrbs(dt) {
    const pl = this.player, L = this.orbs, pull = this.countEnemies() === 0;
    for (let i = L.length - 1; i >= 0; i--) {
      const o = L[i];
      o.t += dt;
      const dx = pl.cx - o.x, dy = pl.cy - o.y, d = Math.hypot(dx, dy) || 1;
      if (o.t > 0.45 && !pl.dead && (d < 210 || pull)) {
        const sp = Math.min(1500, 500 + o.t * 900);
        o.vx = (dx / d) * sp; o.vy = (dy / d) * sp;
      } else { o.vy += 1500 * dt; o.vx *= 1 - 1.5 * dt; }
      o.x = clamp(o.x + o.vx * dt, this.minX + 10, this.maxX - 10); o.y += o.vy * dt;
      if (o.y > -10 && o.vy > 0) { o.y = -10; o.vy *= -0.45; }
      if (d < 30 && o.t > 0.3 && !pl.dead) {
        if (o.kind === 'hp') { pl.hp = Math.min(pl.maxHp, pl.hp + 4); this.fx.text(pl.x, pl.j[1] - 30, '+4', '#7dffb0', 13, 0.6); this.sfx('pickupHealth', pl.x, 0.7); }
        else { this.gainFocus(18); this.sfx('pickupFocus', pl.x, 0.6); }
        this.fx.flash(o.x, o.y, 40, o.kind === 'hp' ? '#7dffb0' : '#56e9ff', 0.12);
        this.stats.orbs++;
        L.splice(i, 1);
      } else if (o.t > 14) L.splice(i, 1);
    }
  }
  // Burning, regenerating strains, the Wellspring trickle.
  tickStatus(dt) {
    for (const f of this.fighters) {
      if (f.dead || f.team !== 1) continue;
      if (f.burnT > 0) {
        f.burnT -= dt;
        if (f.hp > 1) { f.hp = Math.max(1, f.hp - f.burnDps * dt); f.barT = Math.max(f.barT, 0.5); }
        if (rng() < dt * 22) this.fx.ember(f.cx + rand(-10, 10), f.cy + rand(-30, 20), 1, '#ff8a30');
      }
      if (f.tr.regen && f.sinceHurt > 3 && f.hp < f.maxHp) {
        f.hp = Math.min(f.maxHp, f.hp + f.maxHp * 0.05 * dt); f.barT = Math.max(f.barT, 0.5);
        if (rng() < dt * 10) this.fx.ember(f.cx + rand(-14, 14), f.cy + rand(-20, 30), 1, '#7dffb0');
      }
    }
    if (this.mods.focusRegen && this.overdrive <= 0 && this.focus < this.maxFocus) this.focus = Math.min(this.maxFocus, this.focus + this.mods.focusRegen * dt);
    if (this.stasis > 0) this.stasis -= dt;
    if (this.powerT > 0) this.powerT -= dt;
  }
  // Second Wind: the killing blow is refused once per floor.
  secondWind(f) {
    this.windUsed = true;
    f.hp = f.maxHp * 0.3; this.rally = 0;
    this.burst(f, true);
    this.fx.text(f.x, f.j[1] - 110, 'SECOND WIND', '#ffd36b', 26, 1.4);
    this.sfx('secondWind', f.x); this.slow(0.25, 0.8); this.flashScreen('#ffd36b', 0.4);
    f.invuln = Math.max(f.invuln, 1.6);
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
    if (what === 'saber') { f.armed = false; this.projectiles.saber(f, 480 * this.mods.throwRange, this.mods.throwDmg); this.audioLoop('throw', true); }
    else if (what === 'pcrescent') {
      this.projectiles.wave(f, f.x + f.facing * 50, f.facing, { crescent: true, speed: 980, h: 96, range: 1150, dmg: 20 });
      this.fx.flash(f.tx, f.ty, 90, f.color, 0.16); this.sfx('powerCrescent', f.x);
    }
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
      if (this.overdrive > 0) {
        if (this.odShield) { this.odShield = 0; fx.text(B.x, B.j[1] - 40, 'UNBROKEN', OD_COLOR, 16, 0.9); fx.ring(B.cx, B.cy, 20, 140, 0.3, OD_COLOR, 1, 4); }
        else this.endOverdrive(true);
      }
      // A vampiric strain feeds on what it takes.
      if (A && A.tr.vampiric && !A.dead) {
        A.hp = Math.min(A.maxHp, A.hp + dmg * 1.5 + A.maxHp * 0.04); A.barT = 3;
        fx.ember(B.cx, B.cy, 8, '#ff3b5e'); fx.text(A.x, A.j[1] - 40 * A.scale, 'FEEDS', '#ff3b5e', 13, 0.7);
      }
    } else {
      if (info.punished) fx.text(cx, cy - 62, 'PUNISH', '#ffd36b', 16, 0.8);
      if (info.glance) fx.text(cx, cy - 46, 'GLANCED', '#8fa3b8', 13, 0.6);
      const pl = this.player;
      if (A === pl) {
        // Rally: striking back wins a slice of recent damage back.
        if (this.rally > 0) { const r = Math.min(this.rally, dmg * 0.5); this.rally -= r; pl.hp = Math.min(pl.maxHp, pl.hp + r); }
        if (this.overdrive > 0) pl.hp = Math.min(pl.maxHp, pl.hp + 1.5);
        if (this.mods.leech) pl.hp = Math.min(pl.maxHp, pl.hp + this.mods.leech);
        // Live Wire: every fourth blade hit jumps to someone else.
        if (this.mods.arc && ++this.hitCount % 4 === 0) this.strike(B, WIRE_HIT, this.mods.arc, 320, '#c9a0ff', false);
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

  onKill(A, B, h, cx, cy, dir, cuts) {
    const fx = this.fx;
    if (B.isPlayer) {
      this.stop(0.2, true); this.slow(0.25, 1.6); this.shake(0.7); this.sfx('death', B.x);
      this.events.push({ type: 'playerDead' });
      return;
    }
    this.stats.kills++;
    fx.spark(cx, cy, dir > 0 ? 0 : Math.PI, 1.5, 30, 900, B.color, { white: 0.3 });
    fx.flash(cx, cy, 100, '#ffffff', 0.16);
    this.sfx('kill', cx); this.stop(0.14); this.shake(0.5); this.punch(0.03);
    if (B.tr.volatile || this.anom === 'volatile') this.projectiles.mine(B, B.x, { color: '#ff7a2e', fuse: 0.8, r: 125, dmg: 16 });
    if (B.tr.splitter && this.countEnemies() < 9) {
      fx.text(cx, cy - 50, 'SPLITS', B.color, 15, 0.8);
      for (const side of [-1, 1]) {
        const sh = this.spawnEnemy('shard', B.x + side * 30, false, { color: B.color });
        sh.y = -60; sh.vy = -420; sh.vx = side * 260; sh.onGround = false; sh.invuln = 0.3;
      }
    }
    this.gainFocus(12); this.style.bonus(6);
    const pl = this.player, M = this.mods;
    if (pl && !pl.dead) pl.hp = Math.min(pl.maxHp, pl.hp + 2 + M.killHeal + Math.min(this.rally, 6));
    if (M.reap) this.gainFocus(M.reap);
    this.dropOrbs(B, cx, cy);
    if (B.def.boss) {
      // Whatever it called in falls with it.
      for (const e of this.fighters) if (e.team === 1 && !e.dead && e !== B && !e.def.boss && !e.phantom) { e.die((e.x >= cx ? 1 : -1) * 300, -420, rand(-6, 6)); fx.spark(e.cx, e.cy, 0, 3.14, 14, 600, e.color); }
    } else if (M.storm) this.strike(B, STORM_HIT, M.storm, 720, '#bfe6ff', true);
    const left = this.countEnemies();
    if (left === 0 && !this.training) this.slow(0.2, 0.9);
    this.events.push({ type: 'kill', kind: B.def.kind, left, boss: !!B.def.boss });
    if (B.def.boss) { this.flashScreen('#ffffff', 0.6); this.slow(0.12, 2.2); fx.ring(cx, cy, 20, 700, 0.9, '#ffffff', 1, 8); }
  }

  perfectDodge(pl, by) {
    pl.dodged = true;
    this.witch = Math.max(this.witch, 1.25 + this.mods.dodgeTime); this.stats.dodges++;
    this.gainFocus(34 + this.mods.dodgeFocus); this.style.bonus(10);
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
    if (this.hitstop > 0) { this.hitstop -= dtReal; this.stopBank -= dtReal; this.fx.update(dtReal * 0.12); return; }
    // The bank refills faster in small fights (up to a quarter of the time frozen) than in crowds (about a tenth).
    this.stopBank = Math.min(STOP_BANK, this.stopBank + clamp(0.36 - 0.012 * this.countEnemies(), 0.1, 0.33) * dtReal);
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
    if (this.orbs.length) this.tickOrbs(dt);
    this.tickStatus(dt);
    this.fx.update(dt);
    if (this.style.update(dt)) this.sfx('rankUp', this.player.x, 0.6);
    if (this.rallyT > 0) this.rallyT -= dt; else if (this.rally > 0) this.rally = Math.max(0, this.rally - 18 * dt);
    if (this.overdrive > 0) {
      const pl = this.player;
      this.overdrive -= dt;
      // A trail of afterimages while the blade is moving.
      if ((this.odGhost -= dt) <= 0 && pl && !pl.rag && (pl.state === 'attack' || pl.state === 'dash' || Math.abs(pl.vx) > 200)) { this.odGhost = 0.05; this.fx.ghost(pl, '#56e9ff', 0.22); }
      if (this.overdrive <= 0 || !pl || pl.dead) this.endOverdrive(false);
    }
    if (this.mirror && (this.mirror.remove || !fs.includes(this.mirror))) this.mirror = null;
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

// Brain of the mirror image: keep station behind the player and repeat each attack a beat later.
function mirrorCtrl(f, world, dt) {
  const ai = f.ai, pl = world.player;
  if ((ai.life -= dt) <= 0 || !pl || pl.dead) {
    f.remove = true; world.fx.ghost(f, f.color, 0.4); world.fx.ring(f.cx, f.cy, 10, 90, 0.3, f.color, 1, 3);
    return;
  }
  f.fade = ai.life < 1 ? 0.25 + 0.35 * ai.life : 0.6;
  f.bladeLen = pl.bladeLen; f.rate = pl.rate;
  if (pl.atkSerial !== ai.serial) {
    ai.serial = pl.atkSerial;
    const m = pl.move;
    if (m && pl.state === 'attack' && m.hits.length && !m.plunge && m.fam !== 'power' && m.fam !== 'throw') ai.queue = { id: m.id, t: 0.14 };
  }
  if (f.state === 'attack') return;
  f.y = pl.rag ? 0 : pl.y; f.vy = 0; f.onGround = f.y >= 0;
  if (ai.queue && (ai.queue.t -= dt) <= 0) {
    f.facing = pl.facing; f.startMove(ai.queue.id); ai.queue = null;
    return;
  }
  const tx = clamp(pl.x - pl.facing * 64, world.minX + 40, world.maxX - 40);
  f.x += (tx - f.x) * Math.min(1, dt * 9); f.vx = 0; f.facing = pl.facing;
}
