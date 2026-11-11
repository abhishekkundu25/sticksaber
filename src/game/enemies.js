// Enemy roster and brains. Each type is built to have one silhouette, one rhythm and one clear answer.
import { rand, clamp } from '../core/math.js';
import { MOVES, C } from './moves.js';
import { breakPosture } from './combat.js';

const { PY, LEAN, HEAD, HA, HR, BL, UA, LA, F1X, F1Y, F2X, F2Y } = C;
const base = { postureRegen: 14, accel: 2600, dashSpeed: 900, lineW: 5.5, tier: 1, armor: 0, getup: 0.6, scale: 1, ctrl: meleeCtrl };

export const ENEMIES = {
  // Fodder. Slow, loud wind-ups; folds to anything. Teaches spacing and the parry.
  initiate: { ...base, kind: 'initiate', name: 'Initiate', hp: 50, posture: 55, chainBreak: 6, heavyBlockMul: 2, color: '#ff3b4e', outline: '#ff9a9a', runSpeed: 230, blade: { len: 66 }, deco: 'hood',
    ai: { range: [75, 115], cd: [0.45, 1.2], guard: 0.25, moves: [{ id: 'i_slash', max: 135, w: 3 }, { id: 'i_combo', max: 135, w: 2 }, { id: 'i_leap', min: 170, max: 330, w: 2 }] } },
  // Walking wall. Frontal shield eats light attacks; slow to turn. Answer: heavies, charged heavies, or get behind.
  bulwark: { ...base, kind: 'bulwark', name: 'Bulwark', scale: 1.14, hp: 95, chainBreak: 3, posture: 100, armor: 1, tier: 2, color: '#ff9a2e', outline: '#ffc98a', shieldColor: '#ffb14a', lineW: 7.2, runSpeed: 140,
    blade: { len: 40 }, shield: true, blockMul: 0.45, heavyBlockMul: 2.4, parryPosture: 55, deco: 'bulwark',
    stance: { ua: -0.15, la: 0.55, ha: -1.15, hr: 0.7, bl: -0.5, lean: 0.14, py: 45 },
    ai: { range: [70, 105], cd: [1.0, 2.0], turnLag: 0.55, moves: [{ id: 'b_bash', max: 125, w: 3 }, { id: 'b_over', max: 140, w: 2 }] } },
  // Fencer with a double-ended staff. Darts in and out, blocks, and reads repeated moves. Answer: parry the flurry, vary your strings.
  duelist: { ...base, kind: 'duelist', name: 'Duelist', scale: 1.1, hp: 120, posture: 90, chainBreak: 3, armor: 1, color: '#ff4fd8', outline: '#ffa6ee', lineW: 4.2, runSpeed: 300,
    blade: { len: 46, double: true }, adaptAt: 4, counter: 'd_counter', parryPosture: 50, deco: 'crest',
    ribbons: [{ n: 8, seg: 6, color: '#ff4fd8', width: 3 }], ribbonJoint: 'head',
    stance: { ha: -0.3, hr: 0.55, bl: 1.2, lean: 0.06 },
    ai: { range: [170, 250], cd: [0.35, 0.9], guard: 0.55, counterAfter: 2, retreat: 0.45, moves: [{ id: 'd_flurry', min: 110, max: 340, w: 3 }, { id: 'd_spin', max: 150, w: 2 }] } },
  // Ranged pest. Keeps distance, telegraphs with a sight line. Answer: parry or cut the bolt back, or close in.
  marksman: { ...base, kind: 'marksman', name: 'Marksman', scale: 0.96, hp: 34, posture: 40, color: '#c8ff3a', outline: '#e4ff9c', runSpeed: 240, blade: { len: 44, gun: true }, ranged: true, deco: 'visor',
    stance: { ha: -0.25, hr: 0.7, bl: -0.1, ua: -0.5, la: -0.1, py: 44 }, ctrl: marksmanCtrl },
  // Siege engine. Never flinches until its posture breaks. Answer: parry the wide swing, dodge the red smash and punish, bait the charge into a wall.
  brute: { ...base, kind: 'brute', name: 'Brute', scale: 1.5, hp: 280, posture: 130, armor: 2, tier: 3, color: '#ff2a2a', outline: '#ff8a70', lineW: 8, runSpeed: 150,
    blade: { len: 80, wide: true }, parryPosture: 45, parryRecoil: 0.85, breakDur: 3.2, getup: 0.9, deco: 'horns',
    stance: { lean: 0.26, ha: -0.9, hr: 0.8, bl: -0.3, py: 44, f1x: 20, f2x: -22 },
    ai: { range: [110, 165], cd: [0.9, 1.8], moves: [{ id: 'br_swing', max: 200, w: 3 }, { id: 'br_smash', max: 180, w: 2 }, { id: 'br_charge', min: 380, max: 1200, w: 3 }] },
    hitWall(f, world) {
      if (f.move?.id !== 'br_charge' || f.mt < 0.75) return;
      world.shake(0.7); world.sfx('wallSplat', f.x); world.fx.spark(f.x + f.facing * 30, -80, f.facing > 0 ? Math.PI : 0, 1.2, 24, 600, '#ffd36b');
      world.fx.text(f.x, f.j[1] - 50, 'STUNNED', '#ffd36b', 20, 1);
      breakPosture(world, f);
    } },
  // Boss. Reads repetition, shifts phase at 60%, and kneels to heal twice unless interrupted.
  proctor: { ...base, kind: 'proctor', name: 'THE PROCTOR', title: 'Final Examiner of the Spire', boss: true, scale: 1.28, hp: 900, posture: 220, armor: 2, tier: 2, noRagdoll: true,
    color: '#ffe2a0', color2: '#c9a0ff', outline: '#fff3d0', lineW: 5.2, runSpeed: 250, blade: { len: 80 }, adaptAt: 5, counter: 'p_counter', parryPosture: 32, parryRecoil: 0.6, breakDur: 2.6, deco: 'halo',
    ribbons: [{ n: 10, seg: 8, color: '#1a1420', width: 9, oy: 2, grav: 700 }, { n: 8, seg: 8, color: '#1a1420', width: 7, oy: 6, grav: 800 }],
    stance: { ha: -0.9, hr: 0.75, bl: -1.2, lean: 0.02, py: 48, ua: -1.75, la: -1.45 }, guard: [0.35, 0.5], ctrl: proctorCtrl },
  // Training target.
  dummy: { ...base, kind: 'dummy', name: 'Training Drone', hp: 160, posture: 9999, color: '#8fb4ff', outline: '#c4d8ff', runSpeed: 0, blade: { len: 50 }, deco: 'hood', ctrl: null, getup: 0.5 },
};

function tickAdapt(f, dt) {
  const at = f.def.adaptAt;
  if (!at) return;
  for (const k in f.adapt) f.adapt[k] = Math.max(0, f.adapt[k] - 0.14 * dt);
  if (f.reads && f.adapt[f.reads] < at) f.reads = null;
}

function weighted(opts, last) {
  const pool = opts.length > 1 ? opts.filter((o) => o.id !== last) : opts;
  let total = 0;
  for (const o of pool) total += o.w;
  let r = Math.random() * total;
  for (const o of pool) { r -= o.w; if (r <= 0) return o; }
  return pool[0];
}

// Shared block-and-counter handling. Returns true while the fighter is busy guarding.
function tickGuard(f, world, counterAfter) {
  const ai = f.ai;
  if (f.state !== 'guard') return false;
  if (ai.blocks >= counterAfter && f.blockT <= 0.06 && f.def.counter) {
    ai.blocks = 0; f.face(world.player.x); f.startMove(f.def.counter);
    return true;
  }
  if (ai.guardT <= 0 && f.blockT <= 0) f.setState('free');
  return true;
}

function initAi(f, extra) {
  Object.assign(f.ai, { cd: rand(0.5, 1.3), spread: rand(0, 110), turn: 0, seenAtk: 0, guardT: 0, blocks: 0, retreat: 0, last: null, init: true,
    blocked(self) { self.ai.blocks++; } }, extra);
}

function meleeCtrl(f, world, dt) {
  const ai = f.ai, P = f.def.ai, pl = world.player;
  if (!ai.init) initAi(f);
  tickAdapt(f, dt);
  ai.cd -= dt; ai.retreat -= dt; ai.guardT -= dt;
  if (tickGuard(f, world, P.counterAfter ?? 99)) return;
  if (f.state !== 'free' || !f.onGround || pl.dead) return;

  const dx = pl.x - f.x, dist = Math.abs(dx), want = dx >= 0 ? 1 : -1;
  if (want !== f.facing) { ai.turn += dt; if (ai.turn >= (P.turnLag ?? 0.08)) { f.facing = want; ai.turn = 0; } } else ai.turn = 0;

  if (P.guard && pl.state === 'attack' && pl.atkSerial !== ai.seenAtk && dist < 190 && f.facing === want) {
    ai.seenAtk = pl.atkSerial;
    if (Math.random() < P.guard) { f.setState('guard'); ai.guardT = rand(0.45, 0.9); ai.blocks = 0; return; }
  }

  // Never start a swing on a player who is down: that is their window to recover.
  const mercy = pl.rag || pl.state === 'getup';
  if (ai.cd <= 0 && f.facing === want && !mercy) {
    const opts = P.moves.filter((m) => dist >= (m.min ?? 0) && dist <= m.max);
    if (opts.length && world.requestAttack(f)) {
      const m = weighted(opts, ai.last);
      ai.last = m.id; f.startMove(m.id);
      ai.cd = MOVES[m.id].dur + rand(P.cd[0], P.cd[1]);
      if (P.retreat) ai.retreat = MOVES[m.id].dur + P.retreat;
      return;
    }
  }

  const [rmin, rmax] = P.range;
  let mx = 0;
  if (P.retreat && ai.retreat > 0 && ai.retreat <= P.retreat) mx = -want;
  // Fighters waiting for their turn hang back at staggered distances instead of piling up.
  else if (dist > rmax + (ai.cd > 0 ? ai.spread : 20)) mx = want;
  else if (dist < rmin) mx = -want * 0.7;
  f.moveX = mx;
}

function marksmanCtrl(f, world, dt) {
  const ai = f.ai, pl = world.player;
  if (!ai.init) initAi(f, { cd: rand(0.8, 1.8), kickCd: 0 });
  ai.cd -= dt; ai.kickCd -= dt;
  if (f.state === 'attack' && f.move.aim) {
    if (f.mt < f.move.aim[1]) {
      f.face(pl.x);
      const ang = Math.atan2(pl.cy - f.j[3], pl.cx - f.j[2]);
      f.aimLocal = clamp(Math.atan2(-Math.sin(ang), Math.cos(ang) * f.facing), -0.45, 0.8);
    }
    return;
  }
  if (f.state !== 'free' || !f.onGround || pl.dead) return;
  const dx = pl.x - f.x, dist = Math.abs(dx), want = dx >= 0 ? 1 : -1;
  f.facing = want;
  const mercy = pl.rag || pl.state === 'getup';
  if (dist < 140 && ai.kickCd <= 0 && !mercy && world.requestAttack(f)) { f.startMove('m_kick'); ai.kickCd = 2.2; ai.cd = Math.max(ai.cd, 1.2); return; }
  if (ai.cd <= 0 && dist > 190 && !mercy && world.requestAttack(f, true)) { f.aimLocal = 0; f.startMove('m_shot'); ai.cd = 1.3 + rand(1.2, 2.4); return; }
  const cornered = f.x < world.minX + 90 || f.x > world.maxX - 90;
  if (dist < 380 && !cornered) f.moveX = -want;
  else if (dist > 640) f.moveX = want;
}

// ───────────── The Proctor ─────────────
function proctorCtrl(f, world, dt) {
  const ai = f.ai, pl = world.player, d = f.def;
  if (!ai.init) initAi(f, { cd: 1.4, phase: 1, heals: [0.45, 0.2], script: null, hurt: proctorHurt, onBreak: proctorReset, force: null });
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
  if (ai.phase === 2 && ai.heals.length && hpk <= ai.heals[0]) { ai.heals.shift(); return startHeal(f, world); }

  const gChance = d.guard[ai.phase - 1];
  if (pl.state === 'attack' && pl.atkSerial !== ai.seenAtk && dist < 210) {
    ai.seenAtk = pl.atkSerial;
    if (Math.random() < gChance) { f.setState('guard'); ai.guardT = rand(0.5, 0.9); ai.blocks = 0; return; }
  }

  if (ai.cd > 0 || pl.rag || pl.state === 'getup') {
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
  if (pick.id === 'dashin') { f.vx = want * clamp((dist - 120) * 5.5, 0, 1150); world.fx.ghost(f, f.color, 0.3); world.sfx('dash', f.x); f.startMove('p_verdict'); ai.cd = MOVES.p_verdict.dur + gap; return; }
  f.startMove(pick.id);
  ai.cd = MOVES[pick.id].dur + gap;
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
    if (g.st < 0.95) { if (Math.random() < 0.6) w.fx.ember(g.cx + rand(-130, 130), g.cy + rand(-110, 60), 1, g.def.color2); return; }
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
      if (Math.abs(dx) > 30 && g.st < 0.7) { g.vx = (dx > 0 ? 1 : -1) * 1250; g.facing = dx > 0 ? 1 : -1; if (Math.random() < 0.5) w.fx.ghost(g, g.color, 0.3); return; }
      g.vx = 0; g.face(pl.x); ai.channel = true; ai.ht = 0;
      w.audioLoop('heal', true); w.sfx('telegraph', g.x);
      w.banner('RECALIBRATING', 'Strike it before the ring closes', 2.2);
      return;
    }
    ai.ht += dt; ai.pulse -= dt;
    w.bossChannel = ai.ht / 4.4;
    g.face(pl.x);
    if (Math.random() < dt * 40) w.fx.ember(g.x + rand(-60, 60), -rand(0, 30), 1, '#7dffb0');
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
