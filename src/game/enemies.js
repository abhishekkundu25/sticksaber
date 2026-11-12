// Enemy roster and brains. Each type is built to have one silhouette, one rhythm and one clear answer.
// These eight are the hand-made chassis. A run also generates its own strains, champions and sector
// bosses from them (strains.js): same brains, new bodies, traits and move lists.
// Variation comes from three places: later floors unlock extra attacks (`floor` on a move option),
// each spawn rolls a temperament, and some spawns are elites.
import { rand, clamp, rng, approach } from '../core/math.js';
import { MOVES, C } from './moves.js';
import { breakPosture } from './combat.js';

const { PY, LEAN, HEAD, HA, HR, BL, UA, LA, F1X, F1Y, F2X, F2Y } = C;
const base = { postureRegen: 14, accel: 2600, dashSpeed: 900, lineW: 5.5, tier: 1, armor: 0, getup: 0.6, scale: 1, ctrl: meleeCtrl };

export const ENEMIES = {
  // Fodder. Slow, loud wind-ups; folds to anything. Teaches spacing and the parry.
  initiate: { ...base, kind: 'initiate', name: 'Initiate', hp: 50, posture: 55, chainBreak: 6, heavyBlockMul: 2, color: '#ff3b4e', outline: '#ff9a9a', runSpeed: 230, blade: { len: 66 }, deco: 'hood',
    ai: { range: [75, 115], cd: [0.45, 1.2], guard: 0.25, flank: true,
      moves: [{ id: 'i_slash', max: 135, w: 3 }, { id: 'i_combo', max: 135, w: 2 }, { id: 'i_leap', min: 170, max: 330, w: 2 }, { id: 'i_feint', max: 135, w: 2, floor: 2 }, { id: 'i_lunge', min: 140, max: 250, w: 2, floor: 3 }] } },
  // Walking wall. Frontal shield eats light attacks; slow to turn. Answer: heavies, charged heavies, or get behind.
  bulwark: { ...base, kind: 'bulwark', name: 'Bulwark', scale: 1.14, hp: 140, chainBreak: 3, posture: 100, armor: 1, tier: 2, color: '#ff9a2e', outline: '#ffc98a', shieldColor: '#ffb14a', lineW: 7.2, runSpeed: 140,
    blade: { len: 40 }, shield: true, blockMul: 0.45, heavyBlockMul: 2.4, parryPosture: 55, deco: 'bulwark',
    stance: { ua: -0.15, la: 0.55, ha: -1.15, hr: 0.7, bl: -0.5, lean: 0.14, py: 45 },
    ai: { range: [70, 105], cd: [1.0, 2.0], turnLag: 0.55, moves: [{ id: 'b_bash', max: 125, w: 3 }, { id: 'b_over', max: 140, w: 2 }, { id: 'b_charge', min: 160, max: 520, w: 3, floor: 5 }] } },
  // Fencer with a double-ended staff. Darts in and out, blocks, and reads repeated moves. Answer: parry the flurry, vary your strings.
  duelist: { ...base, kind: 'duelist', name: 'Duelist', scale: 1.1, hp: 180, chainBreak: 3, posture: 90, armor: 1, color: '#ff4fd8', outline: '#ffa6ee', lineW: 4.2, runSpeed: 300,
    blade: { len: 46, double: true }, adaptAt: 4, counter: 'd_counter', parryPosture: 50, deco: 'crest',
    ribbons: [{ n: 8, seg: 6, color: '#ff4fd8', width: 3 }], ribbonJoint: 'head',
    stance: { ha: -0.3, hr: 0.55, bl: 1.2, lean: 0.06 },
    ai: { range: [170, 250], cd: [0.35, 0.9], guard: 0.55, counterAfter: 2, retreat: 0.45, flank: true,
      moves: [{ id: 'd_flurry', min: 110, max: 340, w: 3 }, { id: 'd_spin', max: 150, w: 2 }, { id: 'd_dive', min: 200, max: 400, w: 2, floor: 6 }, { id: 'd_throw', min: 260, max: 520, w: 2, floor: 6 }] } },
  // Ranged pest. Keeps distance, telegraphs with a sight line. Answer: parry or cut the bolt back, or close in.
  marksman: { ...base, kind: 'marksman', name: 'Marksman', scale: 0.96, hp: 40, posture: 40, color: '#c8ff3a', outline: '#e4ff9c', runSpeed: 240, blade: { len: 44, gun: true }, ranged: true, deco: 'visor',
    stance: { ha: -0.25, hr: 0.7, bl: -0.1, ua: -0.5, la: -0.1, py: 44 }, ctrl: marksmanCtrl },
  // Siege engine. Never flinches until its posture breaks. Answer: parry the wide swing, dodge the red smash and punish, bait the charge into a wall.
  brute: { ...base, kind: 'brute', name: 'Brute', scale: 1.5, hp: 440, posture: 130, armor: 2, tier: 3, color: '#ff2a2a', outline: '#ff8a70', lineW: 8, runSpeed: 150,
    blade: { len: 80, wide: true }, parryPosture: 45, parryRecoil: 0.85, breakDur: 3.2, getup: 0.9, deco: 'horns',
    stance: { lean: 0.26, ha: -0.9, hr: 0.8, bl: -0.3, py: 44, f1x: 20, f2x: -22 },
    ai: { range: [110, 165], cd: [0.5, 1.2],
      moves: [{ id: 'br_swing', max: 200, w: 3 }, { id: 'br_smash', max: 180, w: 2 }, { id: 'br_charge', min: 380, max: 1200, w: 3 }, { id: 'br_sweep', max: 210, w: 2, floor: 6 }, { id: 'br_leap', min: 240, max: 620, w: 3, floor: 6 }] },
    hitWall(f, world) {
      if (f.move?.src !== 'br_charge' || f.mt < f.move.run + 0.03) return;
      world.shake(0.7); world.sfx('wallSplat', f.x); world.fx.spark(f.x + f.facing * 30, -80, f.facing > 0 ? Math.PI : 0, 1.2, 24, 600, '#ffd36b');
      world.fx.text(f.x, f.j[1] - 50, 'STUNNED', '#ffd36b', 20, 1);
      breakPosture(world, f);
    } },
  // Pikeman. Out-reaches you and skewers jump-ins, but is helpless once you are inside the point. Answer: parry or sidestep a thrust, then dash in along the floor.
  lancer: { ...base, kind: 'lancer', name: 'Lancer', scale: 1.15, hp: 120, posture: 80, chainBreak: 4, color: '#5b8cff', outline: '#a9c2ff', lineW: 4.6, runSpeed: 250,
    blade: { len: 108, thin: true }, parryPosture: 55, deco: 'cone',
    stance: { ha: -0.35, hr: 0.6, bl: 0.12, lean: 0.12, py: 45, f1x: 20, f2x: -20, ua: -0.6, la: 0.1 },
    ai: { range: [205, 275], cd: [0.55, 1.2], backpedal: true, react: lancerReact,
      moves: [{ id: 'ln_thrust', min: 135, max: 290, w: 3 }, { id: 'ln_double', min: 135, max: 275, w: 2, floor: 7 }, { id: 'ln_shove', max: 115, w: 5 }] } },
  // Assassin. Vanishes, reappears beside you and strikes. Answer: listen for the blink, turn, and parry; it lingers after it swings.
  wraith: { ...base, kind: 'wraith', name: 'Wraith', scale: 1.02, hp: 95, posture: 60, chainBreak: 3, color: '#9d5cff', outline: '#cdb0ff', lineW: 4.4, runSpeed: 200,
    blade: { len: 58 }, parryPosture: 60, deco: 'wraith',
    ribbons: [{ n: 9, seg: 7, color: '#150f22', width: 8, oy: 2, grav: 600 }, { n: 7, seg: 7, color: '#150f22', width: 6, oy: 8, grav: 700 }],
    stance: { ha: -2.2, hr: 0.7, bl: 3.4, lean: 0.2, py: 43 }, ctrl: wraithCtrl },
  // Flyer. Hovers out of reach, dives or shoots. Any hit knocks it out of the air. Answer: jump attacks, the launcher, or parry the dive.
  drone: { ...base, kind: 'drone', name: 'Drone', flying: true, scale: 0.55, hp: 26, posture: 30, color: '#ffd24a', outline: '#ffe9a0', runSpeed: 280, getup: 0.5,
    blade: { len: 34, gun: true }, deco: 'drone', stance: { f1x: 8, f1y: 26, f2x: -8, f2y: 26, ha: -0.6, hr: 0.6, bl: -0.6 }, ctrl: droneCtrl },
  // Mid-boss. Its hammer heats through each string; the white-hot swing cannot be parried, and the vent after it is the opening.
  forgemaster: { ...base, kind: 'forgemaster', name: 'THE FORGEMASTER', title: 'Keeper of Foundry Nine', boss: true, scale: 1.42, hp: 1000, posture: 200, postureTaken: 0.4, armor: 2, tier: 3, noRagdoll: true,
    color: '#ff5a1e', heatColors: ['#ff5a1e', '#ff8a30', '#ffc070', '#ffffff'], outline: '#ffb080', lineW: 7.4, runSpeed: 170,
    blade: { len: 72, hammer: true, wide: true }, parryPosture: 38, parryRecoil: 0.7, breakDur: 3.0, deco: 'forge',
    stance: { lean: 0.2, ha: -1.0, hr: 0.85, bl: -0.9, py: 45, f1x: 20, f2x: -22 }, ctrl: forgeCtrl },
  // Final boss. Reads repetition, shifts phase at 60%, kneels to heal twice unless interrupted, and below 25% fights alongside its own afterimages.
  proctor: { ...base, kind: 'proctor', name: 'THE PROCTOR', title: 'Final Examiner of the Spire', boss: true, scale: 1.28, hp: 900, posture: 220, armor: 2, tier: 2, noRagdoll: true,
    color: '#ffe2a0', color2: '#c9a0ff', outline: '#fff3d0', lineW: 5.2, runSpeed: 250, blade: { len: 80 }, adaptAt: 5, counter: 'p_counter', parryPosture: 32, parryRecoil: 0.6, breakDur: 2.6, deco: 'halo',
    ribbons: [{ n: 10, seg: 8, color: '#1a1420', width: 9, oy: 2, grav: 700 }, { n: 8, seg: 8, color: '#1a1420', width: 7, oy: 6, grav: 800 }],
    stance: { ha: -0.9, hr: 0.75, bl: -1.2, lean: 0.02, py: 48, ua: -1.75, la: -1.45 }, guard: [0.35, 0.5], ctrl: proctorCtrl },
  // Training target.
  dummy: { ...base, kind: 'dummy', name: 'Training Drone', hp: 160, posture: 9999, color: '#8fb4ff', outline: '#c4d8ff', runSpeed: 0, blade: { len: 50 }, deco: 'hood', ctrl: null, getup: 0.5 },
};
// The Proctor's afterimage: same body, no cape, runs one move and disappears.
ENEMIES.echo = { ...ENEMIES.proctor, kind: 'echo', name: 'Echo', boss: false, ribbons: [], adaptAt: 0, ctrl: echoCtrl };
// What a "splitter" strain leaves behind when it dies.
ENEMIES.shard = { ...ENEMIES.initiate, kind: 'shard', name: 'Shard', scale: 0.72, hp: 22, posture: 30, runSpeed: 280, blade: { len: 52 }, chainBreak: 0,
  ai: { ...ENEMIES.initiate.ai, cd: [0.3, 0.9], guard: 0, moves: [{ id: 'i_slash', max: 135, w: 3 }, { id: 'i_lunge', min: 140, max: 250, w: 2 }] } };
// An afterimage of any boss: the same definition with the brain swapped for the echo's.
const echoDefs = new Map();
export function echoDef(def) {
  if (def.kind === 'proctor') return ENEMIES.echo;
  let d = echoDefs.get(def);
  if (!d) echoDefs.set(def, d = { ...def, kind: 'echo', name: 'Echo', boss: false, ribbons: [], adaptAt: 0, ctrl: echoCtrl, traits: undefined });
  return d;
}

const TEMPER = { aggressive: { cd: 0.6, guard: 0.5, range: -10 }, cautious: { cd: 1.35, guard: 1.6, range: 40 }, flank: { cd: 0.9, guard: 1, range: 0 } };
export const mercy = (pl) => pl.rag || pl.state === 'getup';

function tickAdapt(f, dt) {
  const at = f.def.adaptAt;
  if (!at) return;
  for (const k in f.adapt) f.adapt[k] = Math.max(0, f.adapt[k] - 0.14 * dt);
  if (f.reads && f.adapt[f.reads] < at) f.reads = null;
}

export function weighted(opts, last) {
  const pool = opts.length > 1 ? opts.filter((o) => o.id !== last) : opts;
  let total = 0;
  for (const o of pool) total += o.w;
  let r = rng() * total;
  for (const o of pool) { r -= o.w; if (r <= 0) return o; }
  return pool[0];
}

// Shared block-and-counter handling. Returns true while the fighter is busy guarding.
function tickGuard(f, world, counterAfter) {
  const ai = f.ai;
  if (f.state !== 'guard') return false;
  if (ai.blocks >= counterAfter && f.blockT <= 0.06 && f.def.counter && f.armed) {
    ai.blocks = 0; f.face(world.player.x); f.startMove(f.def.counter);
    return true;
  }
  if (ai.guardT <= 0 && f.blockT <= 0) f.setState('free');
  return true;
}

export function initAi(f, extra) {
  const t = TEMPER[f.temper] || { cd: 1, guard: 1, range: 0 };
  // `cdK` is the floor's pace: deeper floors and higher difficulties leave shorter gaps between attacks.
  Object.assign(f.ai, { cd: rand(0.9, 1.6), spread: rand(0, 110), turn: 0, seenAtk: 0, guardT: 0, blocks: 0, retreat: 0, last: null, init: true, flankCd: rand(1.5, 4),
    cdMul: t.cd * (f.ai.cdK ?? 1), guardMul: t.guard, rangeAdd: t.range, blocked(self) { self.ai.blocks++; } }, extra);
}

// Point the weapon at the player while a move's aim window is open. Returns true if the move is an aiming one.
function aimMove(f, pl) {
  if (f.state !== 'attack' || !f.move.aim) return false;
  if (f.mt < f.move.aim[1]) {
    f.face(pl.x);
    const ang = Math.atan2(pl.cy - f.j[3], pl.cx - f.j[2]), lim = f.move.aimRange || [-0.45, 0.8];
    f.aimLocal = clamp(Math.atan2(-Math.sin(ang), Math.cos(ang) * f.facing), lim[0], lim[1]);
  }
  return true;
}

export function meleeCtrl(f, world, dt) {
  const ai = f.ai, P = f.def.ai, pl = world.player;
  // New arrivals take a moment before their first swing, longer on the first floor.
  if (!ai.init) { initAi(f); if (world.floor === 1) ai.cd += 0.8; }
  tickAdapt(f, dt);
  ai.cd -= dt; ai.retreat -= dt; ai.guardT -= dt; ai.flankCd -= dt;
  if (tickGuard(f, world, P.counterAfter ?? 99)) return;
  if (f.state !== 'free' || !f.onGround || pl.dead) return;

  const dx = pl.x - f.x, dist = Math.abs(dx), want = dx >= 0 ? 1 : -1;
  if (want !== f.facing) { ai.turn += dt; if (ai.turn >= (P.turnLag ?? 0.08)) { f.facing = want; ai.turn = 0; } } else ai.turn = 0;

  // Weapon thrown and not yet back: keep away until it returns.
  if (!f.armed) { if (f.x > world.minX + 90 && f.x < world.maxX - 90) f.moveX = -want * 0.9; return; }

  if (P.guard && pl.state === 'attack' && pl.atkSerial !== ai.seenAtk && dist < 190 && f.facing === want) {
    ai.seenAtk = pl.atkSerial;
    if (rng() < P.guard * ai.guardMul) { f.setState('guard'); ai.guardT = rand(0.45, 0.9); ai.blocks = 0; return; }
  }

  // Never start a swing on a player who is down: that is their window to recover.
  const down = mercy(pl);
  if (!down && P.react && P.react(f, world, dist, want, dt)) return;
  if (ai.cd <= 0 && f.facing === want && !down) {
    const opts = P.moves.filter((m) => dist >= (m.min ?? 0) && dist <= m.max && (m.floor ?? 1) <= world.floor);
    if (opts.length && world.requestAttack(f)) {
      const m = weighted(opts, ai.last);
      ai.last = m.id; f.startMove(m.id);
      ai.cd = MOVES[m.id].dur + rand(P.cd[0], P.cd[1]) * ai.cdMul;
      if (P.retreat) ai.retreat = MOVES[m.id].dur + P.retreat;
      return;
    }
  }

  // Flankers vault over you while they wait, to come at your back.
  if (f.temper === 'flank' && P.flank && ai.flankCd <= 0 && ai.cd > 0.25 && dist < 250 && dist > 80 && pl.onGround && pl.facing === -want && !down) {
    ai.flankCd = rand(3.5, 6);
    f.vy = -770; f.vx = (want * (dist + 150)) / 0.59; f.onGround = false; f.y -= 1;
    world.sfx('jump', f.x, 0.6);
    return;
  }

  const rmin = P.range[0] + ai.rangeAdd, rmax = P.range[1] + ai.rangeAdd;
  let mx = 0;
  if (P.retreat && ai.retreat > 0 && ai.retreat <= P.retreat) mx = -want;
  // Fighters waiting for their turn hang back at staggered distances instead of piling up.
  else if (dist > rmax + (ai.cd > 0 ? ai.spread : 20)) mx = want;
  else if (dist < rmin) mx = P.backpedal && f.x > world.minX + 80 && f.x < world.maxX - 80 ? -want : -want * 0.7;
  f.moveX = mx;
}

// Lancer: answer a jump-in with an upward thrust.
function lancerReact(f, world, dist, want, dt) {
  const ai = f.ai, pl = world.player;
  ai.aaCd = (ai.aaCd ?? 0) - dt;
  if (ai.aaCd > 0 || pl.onGround || pl.y > -70 || dist > 240 || f.facing !== want) return false;
  if (pl.vx * want > -60) return false; // only if the player is actually coming in
  if (!world.requestAttack(f)) return false;
  ai.aaCd = 2.2; f.startMove('ln_skewer'); ai.cd = Math.max(ai.cd, MOVES.ln_skewer.dur + 0.4);
  return true;
}

function marksmanCtrl(f, world, dt) {
  const ai = f.ai, pl = world.player;
  if (!ai.init) initAi(f, { cd: rand(0.8, 1.8), kickCd: 0 });
  ai.cd -= dt; ai.kickCd -= dt;
  if (aimMove(f, pl)) return;
  if (f.state !== 'free' || !f.onGround || pl.dead) return;
  const dx = pl.x - f.x, dist = Math.abs(dx), want = dx >= 0 ? 1 : -1;
  f.facing = want;
  const down = mercy(pl);
  if (dist < 140 && ai.kickCd <= 0 && !down && world.requestAttack(f)) { f.startMove('m_kick'); ai.kickCd = 2.2; ai.cd = Math.max(ai.cd, 1.2); return; }
  if (ai.cd <= 0 && dist > 190 && !down && world.requestAttack(f, true)) {
    let o = f.def.ai?.shots;
    if (!o) {
      o = [{ id: 'm_shot', w: 3 }];
      if (world.floor >= 3 && dist < 620) o.push({ id: 'm_lob', w: 2 });
      if (world.floor >= 5) o.push({ id: 'm_burst', w: 2 });
    }
    const m = weighted(o, ai.last);
    ai.last = m.id; f.aimLocal = 0; f.startMove(m.id);
    ai.cd = MOVES[m.id].dur + rand(1.2, 2.4) * ai.cdMul;
    return;
  }
  const cornered = f.x < world.minX + 90 || f.x > world.maxX - 90;
  if (dist < 380 + ai.rangeAdd && !cornered) f.moveX = -want;
  else if (dist > 640 + ai.rangeAdd) f.moveX = want;
}

// ───────────── Wraith ─────────────
function wraithCtrl(f, world, dt) {
  const ai = f.ai, pl = world.player;
  if (!ai.init) initAi(f, { cd: rand(1.0, 2.0), script: null, struck: false, linger: 0 });
  ai.cd -= dt;
  if (f.rag) { f.fade = Math.max(f.fade, 1); ai.busy = false; return; }
  if (f.state === 'custom') { ai.script?.(f, world, dt); return; }
  if (ai.busy) { ai.busy = false; ai.script = null; f.fade = 1; } // knocked out of a blink
  if (f.state === 'guard') { blink(f, world, 'away'); return; }   // pressed too hard: it escapes
  if (f.state !== 'free' || !f.onGround || pl.dead) return;
  f.face(pl.x);
  if (ai.struck) {
    // It stays a moment after swinging. That is the opening.
    if ((ai.linger -= dt) <= 0) { ai.struck = false; blink(f, world, 'away'); }
    return;
  }
  if (ai.cd <= 0 && !mercy(pl) && world.requestAttack(f)) { blink(f, world, rng() < 0.7 ? 'behind' : 'front'); return; }
  const dist = Math.abs(pl.x - f.x), want = pl.x >= f.x ? 1 : -1;
  if (dist < 300 && f.x > world.minX + 90 && f.x < world.maxX - 90) f.moveX = -want * 0.8;
  else if (dist > 460) f.moveX = want * 0.8;
}

function blink(f, world, mode) {
  const ai = f.ai, pl = world.player;
  f.setState('custom', 0); ai.busy = true;
  const bk = { t: 0, moved: false };
  world.sfx('blink', f.x); world.fx.ghost(f, f.color, 0.45);
  f.poseFn = (g, t) => { t[PY] = 40; t[LEAN] = 0.3; t[HA] = -2.4; t[BL] = 3.0; return 22; };
  ai.script = (g, w, dt) => {
    bk.t += dt;
    if (!bk.moved) {
      g.fade = Math.max(0, 1 - bk.t / 0.28); g.invuln = 0.1;
      if (bk.t < 0.36) return;
      bk.moved = true;
      let x;
      if (mode === 'away') x = pl.x + (pl.x > (w.minX + w.maxX) / 2 ? -1 : 1) * rand(340, 440);
      else { const s = mode === 'behind' ? -pl.facing : pl.facing; x = pl.x + s * 100; if (x < w.minX + 70 || x > w.maxX - 70) x = pl.x - s * 100; }
      g.x = clamp(x, w.minX + 60, w.maxX - 60); g.vx = 0; g.face(pl.x);
      // The arrival is announced: a second, higher blink and a ring that closes on the spot.
      w.sfx('blink', g.x, 1, 1.25); w.fx.ring(g.x, -62, 70, 8, 0.3, g.color, 1, 3);
      if (mode !== 'away') { g.tele = 0.42; g.teleRed = false; w.sfx('telegraph', g.x); }
      return;
    }
    const k = (bk.t - 0.36) / 0.3;
    g.fade = Math.min(1, k); g.face(pl.x);
    if (k < 0.5) g.invuln = 0.05;
    if (k < 1) return;
    g.fade = 1; ai.busy = false; ai.script = null;
    if (mode === 'away') { g.setState('free'); ai.cd = rand(1.4, 2.6) * ai.cdMul; }
    else {
      const S = g.def.ai?.strikes ?? g.def.kit?.strikes;
      g.startMove(S ? S[(rng() * S.length) | 0] : w.floor >= 8 && rng() < 0.5 ? 'w_cross' : 'w_slash');
      ai.struck = true; ai.linger = 0.5; ai.cd = g.def.boss ? MOVES[g.move.id].dur + rand(0.3, 0.7) : rand(2, 3.2) * ai.cdMul;
    }
  };
}

// ───────────── Drone ─────────────
const DIVE_HIT = { t0: 0, t1: 9, dmg: 9, post: 18, kx: 260, ky: 0, kind: 'flinch', stop: 0.06, shake: 0.22, stun: 0.3, shape: 'circle', ox: 0, oy: -65, r: 44 };

export function droneCtrl(f, world, dt) {
  const ai = f.ai, pl = world.player;
  if (!ai.init) initAi(f, { cd: rand(1.2, 2.4), script: null, side: rng() < 0.5 ? -1 : 1, hover: rand(180, 280), alt: rand(200, 265) });
  f.gravMul = 0;
  ai.cd -= dt;
  if (f.rag) { ai.busy = false; return; }
  if (aimMove(f, pl)) { f.vx *= 0.9; f.vy *= 0.9; return; }
  if (f.state === 'custom') { ai.script?.(f, world, dt); return; }
  ai.busy = false;
  if (f.state !== 'free') return;
  if (f.onGround) { f.y -= 2; f.onGround = false; f.vy = -240; }
  f.face(pl.x);
  // Hover to one side of the player, bobbing; swap sides now and then.
  if (rng() < dt * 0.25) ai.side = -ai.side;
  const tx = clamp(pl.x + ai.side * ai.hover, world.minX + 60, world.maxX - 60), ty = -ai.alt + Math.sin(f.t * 2.2) * 16;
  f.vx = approach(f.vx, clamp((tx - f.x) * 3, -f.def.runSpeed, f.def.runSpeed), 900 * dt);
  f.vy = approach(f.vy, clamp((ty - f.y) * 4, -300, 300), 1300 * dt);
  if (ai.cd > 0 || pl.dead || mercy(pl)) return;
  if (rng() < (f.def.ai?.dive ?? 0.55)) { if (world.requestAttack(f)) droneDive(f, world); return; }
  if (world.requestAttack(f, true)) { f.aimLocal = -0.6; f.vx = 0; f.vy = 0; f.startMove('dr_shot'); ai.cd = MOVES.dr_shot.dur + rand(1.6, 3) * ai.cdMul; }
}

function droneDive(f, world) {
  const ai = f.ai, pl = world.player;
  f.setState('custom', 0); ai.busy = true;
  const dv = { t: 0, stage: 'aim', vx: 0, vy: 0 };
  f.tele = 0.42; f.teleRed = false; world.sfx('telegraph', f.x);
  ai.script = (g, w, dt) => {
    dv.t += dt;
    if (dv.stage === 'aim') {
      g.vx *= 0.9; g.vy *= 0.9; g.face(pl.x);
      if (dv.t < 0.5) return;
      const dx = pl.cx - g.cx, dy = pl.cy - g.cy, d = Math.hypot(dx, dy) || 1;
      dv.vx = (dx / d) * 880; dv.vy = (dy / d) * 880; dv.stage = 'dive'; dv.t = 0;
      g.hitSet.clear(); g.activeHit = DIVE_HIT; w.sfx('droneDive', g.x);
    } else if (dv.stage === 'dive') {
      g.vx = dv.vx; g.vy = dv.vy;
      if (dv.t > 0.5 || g.y > -34 || g.onGround) { dv.stage = 'rise'; dv.t = 0; g.activeHit = null; }
    } else {
      g.vx *= 0.92; g.vy = approach(g.vy, -260, 2400 * dt);
      if (g.onGround) { g.y -= 2; g.onGround = false; }
      if (dv.t > 0.6) { ai.busy = false; ai.script = null; g.setState('free'); ai.cd = rand(1.8, 3.2) * ai.cdMul; }
    }
  };
}

// ───────────── The Forgemaster ─────────────
function forgeCtrl(f, world, dt) {
  const ai = f.ai, pl = world.player;
  if (!ai.init) initAi(f, { cd: 1.6, phase: 1, script: null });
  ai.cd -= dt;
  world.boss = f;
  if (f.vent > 0 && rng() < dt * 45) world.fx.dust(f.tx + rand(-12, 12), f.ty - rand(0, 20), 1, 0, 50);
  if (f.state === 'custom') { ai.script?.(f, world, dt); return; }
  ai.busy = false;
  if ((f.state === 'stagger' || f.state === 'recoil') && f.heat) { f.heat = 0; f.color = f.def.heatColors[0]; }
  if (f.state !== 'free' || !f.onGround || pl.dead) return;
  const dx = pl.x - f.x, dist = Math.abs(dx), want = dx >= 0 ? 1 : -1;
  f.facing = want;
  if (ai.phase === 1 && f.hp / f.maxHp <= 0.5) return forgePhase(f, world);
  if (ai.cd > 0 || mercy(pl)) { if (dist > 190) f.moveX = want; return; }

  const p2 = ai.phase === 2, o = [];
  if (dist < 250) { o.push({ id: 'fm_string', w: 4 }, { id: 'fm_quake', w: 2 }); if (p2) o.push({ id: 'fm_erupt', w: 2 }); }
  else { o.push({ id: 'fm_ember', w: 3 }, { id: 'close', w: 2.5 }); if (dist < 380) o.push({ id: 'fm_quake', w: 1 }); if (p2) o.push({ id: 'fm_erupt', w: 3 }); }
  const pick = weighted(o, ai.last);
  ai.last = pick.id;
  if (pick.id === 'close') { ai.cd = 0.7; return; }
  f.startMove(pick.id);
  ai.cd = MOVES[pick.id].dur + (p2 ? rand(0.25, 0.7) : rand(0.6, 1.2));
}

function forgePhase(f, world) {
  const ai = f.ai, pl = world.player;
  f.setState('custom', 1.9); ai.busy = true; f.invuln = 2.1; ai.burst = false;
  f.tele = 0.5; f.teleRed = true; world.sfx('bossRoar', f.x);
  f.poseFn = (g, t) => {
    if (g.st < 0.9) { t[PY] = 34; t[LEAN] = 0.45; t[HEAD] = 0.4; t[HA] = -1.3; t[BL] = -1.4; return 12; }
    t[PY] = 50; t[LEAN] = -0.25; t[HEAD] = -0.3; t[HA] = 1.5; t[HR] = 1; t[BL] = 1.57; t[UA] = 2.2; t[LA] = 2.4; return 28;
  };
  ai.script = (g, w) => {
    if (g.st < 0.9) { if (rng() < 0.6) w.fx.ember(g.cx + rand(-140, 140), -rand(0, 40), 1, '#ffb060'); return; }
    if (ai.burst) return;
    ai.burst = true; ai.phase = 2;
    g.heat = 3; g.color = g.def.heatColors[3];
    w.fx.ring(g.cx, g.cy, 20, 520, 0.6, '#ff8a30', 1, 8); w.fx.ring(g.x, -2, 20, 620, 0.6, '#ffffff', 0.2, 5);
    w.fx.flash(g.cx, g.cy, 320, '#ff8a30', 0.4); w.fx.spark(g.cx, g.cy, 0, 3.14, 50, 900, '#ffb060', { white: 0.4 });
    w.sfx('bossPhase', g.x); w.sfx('hammer', g.x); w.shake(0.8); w.stop(0.16); w.flashScreen('#ff8a30', 0.35);
    w.banner('PHASE II', 'The floor itself turns on you', 2.4);
    const dx = pl.x - g.x;
    if (Math.abs(dx) < 460 && !pl.rag && !pl.dead) { pl.setState('hitstun', 0.45); pl.vx = (dx >= 0 ? 1 : -1) * 760; pl.invuln = 0.6; }
    for (let i = 0; i < 4; i++) w.projectiles.pillar(g, clamp(pl.x + (i - 1.5) * 260, w.minX + 30, w.maxX - 30), 1.3 + i * 0.12);
  };
}

// ───────────── The Proctor ─────────────
const ECHOED = { p_verdict: 1, p_lunge: 1, p_crescent: 1 };

function proctorCtrl(f, world, dt) {
  const ai = f.ai, pl = world.player, d = f.def;
  if (!ai.init) initAi(f, { cd: 1.4, phase: 1, heals: [0.45, 0.2], script: null, hurt: proctorHurt, onBreak: proctorReset, force: null, p3: false });
  tickAdapt(f, dt);
  ai.cd -= dt; ai.guardT -= dt;
  world.boss = f;
  if (f.state === 'custom') { ai.script?.(f, world, dt); return; }
  if (ai.busy) proctorReset(f, world);
  if (tickGuard(f, world, 2)) return;
  if (f.state !== 'free' || !f.onGround || pl.dead) return;

  const dx = pl.x - f.x, dist = Math.abs(dx), want = dx >= 0 ? 1 : -1;
  f.facing = want;
  const hpk = f.hp / f.maxHp;
  if (ai.phase === 1 && hpk <= 0.6) return phaseShift(f, world);
  if (ai.phase === 2 && !ai.p3 && hpk <= 0.25) return phaseThree(f, world);
  if (ai.phase === 2 && ai.heals.length && hpk <= ai.heals[0]) { ai.heals.shift(); return startHeal(f, world); }

  const gChance = d.guard[ai.phase - 1];
  if (pl.state === 'attack' && pl.atkSerial !== ai.seenAtk && dist < 210) {
    ai.seenAtk = pl.atkSerial;
    if (rng() < gChance) { f.setState('guard'); ai.guardT = rand(0.5, 0.9); ai.blocks = 0; return; }
  }

  if (ai.cd > 0 || mercy(pl)) {
    if (dist > 230) f.moveX = want * 0.8; else if (dist < 110) f.moveX = -want * 0.6;
    return;
  }

  const p2 = ai.phase === 2, o = [];
  if (ai.force) { o.push({ id: ai.force, w: 1 }); ai.force = null; }
  else if (dist < 190) { o.push({ id: 'p_verdict', w: 4 }, { id: 'hop', w: 1.5 }); if (p2) o.push({ id: 'p_cyclone', w: 3 }); }
  else if (dist < 480) { o.push({ id: 'p_lunge', w: 3 }, { id: 'p_crescent', w: 2 }, { id: 'dashin', w: 3 }); if (p2) o.push({ id: 'p_cyclone', w: 2 }, { id: 'sky', w: 2.5 }); }
  else { o.push({ id: 'p_lunge', w: 3 }, { id: 'p_crescent', w: 3 }, { id: 'dashin', w: 2 }); if (p2) o.push({ id: 'sky', w: 3 }); }
  const pick = weighted(o, ai.last);
  ai.last = pick.id;
  const gap = p2 ? rand(0.2, 0.6) : rand(0.5, 1.0);
  if (pick.id === 'hop') { f.vx = -want * 720; f.vy = -430; f.onGround = false; f.y -= 1; ai.force = 'p_crescent'; ai.cd = 0.45; world.sfx('dash', f.x); return; }
  if (pick.id === 'sky') return skyfall(f, world);
  const id = pick.id === 'dashin' ? 'p_verdict' : pick.id;
  // Below a quarter health an afterimage stays behind and repeats the attack half a second later.
  if (ai.p3 && ECHOED[id]) { world.spawnEcho(f, id, 0.55); world.sfx('echo', f.x); }
  if (pick.id === 'dashin') { f.vx = want * clamp((dist - 120) * 5.5, 0, 1150); world.fx.ghost(f, f.color, 0.3); world.sfx('dash', f.x); }
  f.startMove(id);
  ai.cd = MOVES[id].dur + gap;
}

function echoCtrl(f, world, dt) {
  const ai = f.ai;
  if (!ai.started) {
    if ((ai.wait -= dt) > 0) return;
    ai.started = true; f.startMove(ai.move);
    return;
  }
  if (f.state !== 'attack') {
    f.remove = true;
    world.fx.ghost(f, f.color, 0.35);
  }
}

function proctorReset(f, world) {
  const ai = f.ai;
  ai.busy = false; ai.script = null; f.gravMul = 1;
  if (ai.channel) { ai.channel = false; world.audioLoop('heal', false); }
  world.marker = null; world.bossChannel = 0;
}

function proctorHurt(f, world) {
  const ai = f.ai;
  if (!ai.channel) return;
  proctorReset(f, world);
  world.sfx('healInterrupt', f.x);
  world.fx.text(f.x, f.j[1] - 70, 'INTERRUPTED', '#7dffb0', 22, 1.2);
  world.fx.ring(f.cx, f.cy, 20, 220, 0.5, '#7dffb0', 1, 6);
  world.stats.interrupts++;
  breakPosture(world, f);
}

function phaseShift(f, world) {
  const ai = f.ai, pl = world.player;
  f.setState('custom', 2.1); ai.busy = true; f.invuln = 2.3; ai.burst = false;
  f.tele = 0.5; f.teleRed = false; world.sfx('bossRoar', f.x);
  f.poseFn = (g, t) => {
    if (g.st < 0.95) { t[PY] = 32; t[LEAN] = 0.45; t[HEAD] = 0.4; t[HA] = -1.4; t[BL] = -1.5; t[UA] = -1.4; t[LA] = -1.0; return 12; }
    t[PY] = 52; t[LEAN] = -0.28; t[HEAD] = -0.3; t[HA] = 0.9; t[HR] = 1; t[BL] = 1.57; t[UA] = 2.3; t[LA] = 2.5; return 30;
  };
  ai.script = (g, w) => {
    if (g.st < 0.95) { if (rng() < 0.6) w.fx.ember(g.cx + rand(-130, 130), g.cy + rand(-110, 60), 1, g.def.color2); return; }
    if (ai.burst) return;
    ai.burst = true; ai.phase = 2;
    g.double = true; g.color = g.def.color2;
    w.fx.ring(g.cx, g.cy, 20, 520, 0.6, g.color, 1, 8); w.fx.ring(g.x, -2, 20, 600, 0.6, '#ffffff', 0.2, 5);
    w.fx.flash(g.cx, g.cy, 320, g.color, 0.4); w.fx.spark(g.cx, g.cy, 0, 3.14, 50, 900, g.color, { white: 0.5 });
    w.sfx('bossPhase', g.x); w.shake(0.8); w.stop(0.16); w.flashScreen(g.color, 0.35);
    w.banner('PHASE II', 'It stops holding back', 2.4);
    const dx = pl.x - g.x;
    if (Math.abs(dx) < 460 && !pl.rag && !pl.dead) { pl.setState('hitstun', 0.45); pl.vx = (dx >= 0 ? 1 : -1) * 760; pl.invuln = 0.6; }
  };
}

function phaseThree(f, world) {
  const ai = f.ai;
  f.setState('custom', 1.1); ai.busy = true; ai.p3 = true; f.invuln = 1.2;
  f.poseFn = (g, t) => { t[PY] = 50; t[LEAN] = -0.2; t[HA] = 1.57; t[HR] = 0.9; t[BL] = 1.57; t[UA] = 1.57; t[LA] = 1.57; return 26; };
  world.fx.ring(f.cx, f.cy, 20, 420, 0.5, '#ffffff', 1, 6); world.fx.flash(f.cx, f.cy, 260, f.color, 0.35);
  for (let i = 0; i < 4; i++) world.fx.ghost(f, f.color, 0.5 + i * 0.12);
  world.sfx('bossPhase', f.x, 1, 1.2); world.sfx('echo', f.x); world.shake(0.6); world.flashScreen('#ffffff', 0.3);
  world.banner('PHASE III', 'It is no longer alone', 2.4);
  ai.script = null;
}

function startHeal(f, world) {
  const ai = f.ai, pl = world.player;
  f.setState('custom', 0); ai.busy = true; ai.channel = false; ai.ht = 0; ai.pulse = 0.5;
  const mid = (world.minX + world.maxX) / 2;
  const goal = pl.x > mid ? world.minX + 170 : world.maxX - 170;
  world.sfx('dash', f.x);
  f.poseFn = (g, t) => {
    if (!ai.channel) { t[LEAN] = 0.9; t[PY] = 36; t[HA] = -2.7; t[BL] = 3.2; return 40; }
    t[PY] = 28 + Math.sin(g.t * 5) * 0.8; t[LEAN] = 0.3; t[HEAD] = 0.45; t[HA] = -1.25; t[HR] = 0.8; t[BL] = -1.5; t[UA] = -1.2; t[LA] = -0.3; t[F1X] = 20; t[F2X] = -24;
    return 16;
  };
  ai.script = (g, w, dt) => {
    if (!ai.channel) {
      const dx = goal - g.x;
      g.invuln = 0.1;
      if (Math.abs(dx) > 30 && g.st < 0.7) { g.vx = (dx > 0 ? 1 : -1) * 1250; g.facing = dx > 0 ? 1 : -1; if (rng() < 0.5) w.fx.ghost(g, g.color, 0.3); return; }
      g.vx = 0; g.face(pl.x); ai.channel = true; ai.ht = 0;
      w.audioLoop('heal', true); w.sfx('telegraph', g.x);
      w.banner('RECALIBRATING', 'Strike it before the ring closes', 2.2);
      return;
    }
    ai.ht += dt; ai.pulse -= dt;
    w.bossChannel = ai.ht / 4.4;
    g.face(pl.x);
    if (rng() < dt * 40) w.fx.ember(g.x + rand(-60, 60), -rand(0, 30), 1, '#7dffb0');
    if (ai.pulse <= 0) {
      ai.pulse = 1.1;
      w.projectiles.wave(g, g.x + g.facing * 30, g.facing, { speed: 470, range: 1500, dmg: 10 });
      w.fx.ring(g.x, -2, 10, 120, 0.35, '#7dffb0', 0.22, 4); w.sfx('shockwave', g.x);
    }
    if (ai.ht >= 4.4) {
      g.hp = Math.min(g.maxHp, g.hp + g.maxHp * 0.2);
      w.sfx('healDone', g.x); w.fx.ring(g.cx, g.cy, 20, 260, 0.6, '#7dffb0', 1, 7); w.fx.text(g.x, g.j[1] - 70, 'RESTORED', '#7dffb0', 22, 1.2);
      proctorReset(g, w); g.setState('free'); ai.cd = 0.5;
    }
  };
}

function skyfall(f, world) {
  const ai = f.ai, pl = world.player;
  f.setState('custom', 0); ai.busy = true;
  const sk = { stage: 'crouch', t: 0 };
  f.tele = 0.5; f.teleRed = true; world.sfx('telegraphRed', f.x);
  f.poseFn = (g, t) => {
    if (sk.stage === 'crouch') { t[PY] = 28; t[LEAN] = 0.4; t[HA] = -1.4; t[BL] = -1.3; return 26; }
    t[HA] = -1.5; t[HR] = 0.8; t[BL] = -1.57; t[LEAN] = 0.1; t[F1X] = -4; t[F1Y] = 30; t[F2X] = -14; t[F2Y] = 38; t[UA] = 1.6; t[LA] = 1.4;
    return 30;
  };
  ai.script = (g, w, dt) => {
    sk.t += dt;
    if (sk.stage === 'crouch') {
      if (sk.t < 0.45) return;
      sk.stage = 'up'; g.vy = -2600; g.onGround = false; g.y -= 2; g.gravMul = 0; g.invuln = 4;
      w.sfx('jump', g.x); w.fx.dust(g.x, 0, 10, 0, 260); w.fx.ring(g.x, -2, 10, 120, 0.3, '#ffffff', 0.22, 4);
    } else if (sk.stage === 'up') {
      if (g.y > -1100) return;
      sk.stage = 'track'; sk.t = 0; g.vy = 0; g.vx = 0;
      w.marker = { x: pl.x, lock: false, t: 0 };
    } else if (sk.stage === 'track') {
      w.marker.x += (pl.x - w.marker.x) * Math.min(1, dt * 7); w.marker.t += dt; g.x = w.marker.x; g.y = -1100; g.vy = 0;
      if (sk.t > 1.0) { sk.stage = 'lock'; sk.t = 0; w.marker.lock = true; w.sfx('telegraphRed', w.marker.x); }
    } else if (sk.stage === 'lock') {
      g.x = w.marker.x; g.y = -1100; g.vy = 0; w.marker.t += dt;
      if (sk.t > 0.4) { sk.stage = 'fall'; g.vy = 3800; g.gravMul = 1; g.invuln = 0; g.face(pl.x); }
    } else if (g.onGround) {
      proctorReset(g, w);
      g.startMove('p_slam'); w.sfx('slam', g.x);
      ai.cd = MOVES.p_slam.dur + 0.3;
    }
  };
}

// ───────────── Generated champions and sector bosses ─────────────
// Reinforcements: the caller kneels, beams come down, `n` of its sector's fighters arrive.
function summon(f, world, n) {
  const ai = f.ai, pl = world.player, kinds = f.def.adds || ['initiate'];
  f.setState('custom', 1.3); ai.busy = true; ai.called = (ai.called || 0) + 1; f.invuln = Math.max(f.invuln, 0.5);
  f.tele = 0.5; f.teleRed = false; world.sfx('summon', f.x); world.sfx('bossRoar', f.x, 0.6, 1.2);
  world.fx.ring(f.cx, f.cy, 20, 260, 0.5, f.color, 1, 5); world.fx.text(f.x, f.j[1] - 60 * f.scale, 'REINFORCEMENTS', f.color, 18, 1.2);
  f.poseFn = (g, t) => { t[PY] = 34; t[LEAN] = 0.2; t[HA] = 1.57; t[HR] = 1; t[BL] = 1.57; t[UA] = 1.9; t[LA] = 1.7; return 22; };
  let sent = false;
  ai.script = (g, w) => {
    if (sent || g.st < 0.55) return;
    sent = true;
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? -1 : 1;
      w.spawnEnemy(kinds[(rng() * kinds.length) | 0], pl.x + side * rand(380, 520), true, { add: true });
    }
  };
}

// A champion is a strain grown to boss size: the ordinary melee brain, a health bar across the
// screen, and one call for help at half health.
export function championCtrl(f, world, dt) {
  const ai = f.ai;
  world.boss = f;
  if (f.state === 'custom') { ai.script?.(f, world, dt); return; }
  if (ai.busy) { ai.busy = false; ai.script = null; }
  if (ai.init && !ai.called && f.hp / f.maxHp <= 0.5 && f.state === 'free' && f.onGround && !world.player.dead) return summon(f, world, 2);
  meleeCtrl(f, world, dt);
}

const PHASE_NAMES = ['', 'PHASE II', 'PHASE III'];
function wardenShift(f, world) {
  const ai = f.ai, pl = world.player, K = f.def.kit, next = ai.phase + 1;
  f.setState('custom', 2.0); ai.busy = true; f.invuln = 2.2; ai.burst = false;
  f.tele = 0.5; f.teleRed = next > 2; world.sfx('bossRoar', f.x, 1, next > 2 ? 0.85 : 1);
  f.poseFn = (g, t) => {
    if (g.st < 0.9) { t[PY] = 32; t[LEAN] = 0.45; t[HEAD] = 0.4; t[HA] = -1.4; t[BL] = -1.5; t[UA] = -1.4; t[LA] = -1.0; return 12; }
    t[PY] = 52; t[LEAN] = -0.28; t[HEAD] = -0.3; t[HA] = 0.9; t[HR] = 1; t[BL] = 1.57; t[UA] = 2.3; t[LA] = 2.5; return 30;
  };
  const col = next > 2 ? f.def.color3 : f.def.color2;
  ai.script = (g, w) => {
    if (g.st < 0.9) { if (rng() < 0.6) w.fx.ember(g.cx + rand(-130, 130), g.cy + rand(-110, 60), 1, col); return; }
    if (ai.burst) return;
    ai.burst = true; ai.phase = next; ai.p3 = next > 2; ai.sp = 1.2;
    g.color = next > 2 ? g.def.color3 : g.def.color2; g.rate += 0.07;
    if (K.doubleAt === next) g.double = true;
    w.fx.ring(g.cx, g.cy, 20, 520, 0.6, g.color, 1, 8); w.fx.ring(g.x, -2, 20, 600, 0.6, '#ffffff', 0.2, 5);
    w.fx.flash(g.cx, g.cy, 320, g.color, 0.4); w.fx.spark(g.cx, g.cy, 0, 3.14, 50, 900, g.color, { white: 0.5 });
    w.sfx('bossPhase', g.x, 1, next > 2 ? 1.2 : 1); w.shake(0.8); w.stop(0.16, true); w.flashScreen(g.color, 0.35);
    w.banner(PHASE_NAMES[next - 1], K.phaseText[next - 2], 2.4);
    const dx = pl.x - g.x;
    if (Math.abs(dx) < 460 && !pl.rag && !pl.dead) { pl.setState('hitstun', 0.45); pl.vx = (dx >= 0 ? 1 : -1) * 760; pl.invuln = 0.6; }
  };
}

// A sector boss. Everything it does comes from `def.kit`, which strains.js generates:
//   moves:    [{ id, min, max, w, phase }]   attacks by distance, some held back for later phases
//   specials: skyfall, summon, blink         bigger set pieces on their own cooldown
//   phases:   health fractions at which it shifts (one or two), heals: fractions at which it kneels
//   echo:     the phase from which an afterimage repeats its attacks
export function wardenCtrl(f, world, dt) {
  const ai = f.ai, pl = world.player, K = f.def.kit;
  if (!ai.init) initAi(f, { cd: 1.4, phase: 1, heals: [...(K.heals || [])], script: null, hurt: proctorHurt, onBreak: proctorReset, sp: 3, called: 0, p3: false });
  tickAdapt(f, dt);
  ai.cd -= dt; ai.guardT -= dt; ai.sp -= dt;
  world.boss = f;
  if (f.state === 'custom') { ai.script?.(f, world, dt); return; }
  if (ai.busy) { proctorReset(f, world); f.fade = 1; } // knocked out of a set piece, a blink included
  if (tickGuard(f, world, 2)) return;
  if (f.state !== 'free' || !f.onGround || pl.dead) return;

  const dx = pl.x - f.x, dist = Math.abs(dx), want = dx >= 0 ? 1 : -1;
  f.facing = want;
  const hpk = f.hp / f.maxHp;
  if (ai.phase <= K.phases.length && hpk <= K.phases[ai.phase - 1]) return wardenShift(f, world);
  if (ai.heals.length && hpk <= ai.heals[0]) { ai.heals.shift(); return startHeal(f, world); }

  if (K.guard && pl.state === 'attack' && pl.atkSerial !== ai.seenAtk && dist < 210) {
    ai.seenAtk = pl.atkSerial;
    if (rng() < K.guard + (ai.phase - 1) * 0.1) { f.setState('guard'); ai.guardT = rand(0.5, 0.9); ai.blocks = 0; return; }
  }

  const hold = K.hold || [110, 230];
  if (ai.cd > 0 || mercy(pl)) {
    if (dist > hold[1]) f.moveX = want * 0.8; else if (dist < hold[0] && f.x > world.minX + 90 && f.x < world.maxX - 90) f.moveX = -want * 0.6;
    return;
  }

  if (ai.sp <= 0) {
    const list = K.specials.filter((sp) => sp !== 'summon' || (ai.phase >= 2 && ai.called < 2 && world.countEnemies() <= 2));
    if (list.length) {
      const sp = list[(rng() * list.length) | 0];
      ai.sp = rand(6, 9) - ai.phase;
      if (sp === 'skyfall') return skyfall(f, world);
      if (sp === 'blink') return blink(f, world, rng() < 0.7 ? 'behind' : 'front');
      return summon(f, world, 2);
    }
  }

  const opts = K.moves.filter((m) => dist >= (m.min ?? 0) && dist <= m.max && (m.phase ?? 1) <= ai.phase);
  if (!opts.length) { f.moveX = dist > hold[1] ? want : -want * 0.6; return; }
  const pick = weighted(opts, ai.last), m = MOVES[pick.id];
  ai.last = pick.id;
  // From its echo phase on, an afterimage stays behind and repeats the attack half a second later.
  if (K.echo && ai.phase >= K.echo && !m.landMove && !m.run && rng() < 0.65) { world.spawnEcho(f, pick.id, 0.55); world.sfx('echo', f.x); }
  if (pick.dash && dist > 170) { f.vx = want * clamp((dist - 120) * 5.5, 0, 1150); world.fx.ghost(f, f.color, 0.3); world.sfx('dash', f.x); }
  f.startMove(pick.id);
  ai.cd = m.dur + rand(0.5, 1.0) / (0.75 + ai.phase * 0.35);
}
