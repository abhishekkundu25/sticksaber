// Hit detection and resolution: swept blade vs. body circles, then guard / parry / clash / read /
// damage / reaction in that order.
import { distPointSeg, rand } from '../core/math.js';

const hc = new Float32Array(12);
export function hurtCircles(f, out = hc) {
  const j = f.j, s = f.scale;
  out[0] = j[0]; out[1] = j[1]; out[2] = 11 * s;
  out[3] = (j[2] + j[4]) / 2; out[4] = (j[3] + j[5]) / 2; out[5] = 15 * s;
  out[6] = j[4]; out[7] = j[5]; out[8] = 13 * s;
  out[9] = (j[14] + j[18]) / 2; out[10] = (j[15] + j[19]) / 2; out[11] = 11 * s;
  return out;
}

// Does attacker A's current weapon sweep touch any of B's circles? Returns the index of the circle hit or -1.
function weaponTouches(A, h, c) {
  if (h.shape === 'circle') {
    const ox = A.x + h.ox * A.scale * A.facing, oy = A.y + h.oy * A.scale, r = h.r * A.scale;
    for (let i = 0; i < 12; i += 3) if (Math.hypot(c[i] - ox, c[i + 1] - oy) < r + c[i + 2]) return i;
    return -1;
  }
  const pad = 7, sx = A.j[2], sy = A.j[3];
  const mx = (A.bx + A.tx) / 2, my = (A.by + A.ty) / 2, pmx = (A.pbx + A.ptx) / 2, pmy = (A.pby + A.pty) / 2;
  for (let i = 0; i < 12; i += 3) {
    const x = c[i], y = c[i + 1], r = c[i + 2] + pad;
    if (distPointSeg(x, y, sx, sy, A.tx, A.ty) < r) return i;
    if (distPointSeg(x, y, A.ptx, A.pty, A.tx, A.ty) < r) return i;
    if (distPointSeg(x, y, pmx, pmy, mx, my) < r) return i;
    if (A.double && (distPointSeg(x, y, sx, sy, A.t2x, A.t2y) < r || distPointSeg(x, y, A.pt2x, A.pt2y, A.t2x, A.t2y) < r)) return i;
    if (h.sweepBody && distPointSeg(x, y, A.pcx, A.pcy, A.cx, A.cy) < r + 16) return i;
  }
  return -1;
}

export function resolveCombat(world) {
  const fs = world.fighters;
  for (let a = 0; a < fs.length; a++) {
    const A = fs[a];
    if (!A.activeHit || A.state !== 'attack') continue;
    for (let b = 0; b < fs.length; b++) {
      const B = fs[b];
      const h = A.activeHit;
      if (!h) break; // a clash or parry earlier in this loop ended the attack
      if (B.team === A.team || B.remove || A.hitSet.has(B)) continue;
      const c = hurtCircles(B);
      const i = weaponTouches(A, h, c);
      if (i >= 0) applyHit(world, A, B, h, c[i], c[i + 1]);
    }
  }
}

export function applyHit(world, A, B, h, cx, cy) {
  A?.hitSet.add(B);
  // `dir` points from the attacker toward the target; projectiles carry their own.
  const dir = !A ? (h.dir || 1) : B.x === A.x ? A.facing : B.x > A.x ? 1 : -1;
  const fx = world.fx;

  if (B.dead) {
    // Corpses stay physical for a moment: a follow-up swing bats them around.
    if (B.deadT < 2.2 && A?.isPlayer) { B.rag.kick(dir * 380, -360, rand(-6, 6)); fx.spark(cx, cy, 0, 3.14, 6, 380, B.color); }
    return 'corpse';
  }
  if (B.invuln > 0) {
    if (B.isPlayer && B.state === 'dash' && !B.dodged && A) world.perfectDodge(B, A);
    return 'whiff';
  }
  const frontal = B.facing === -dir;

  if (world.guarding(B) && frontal && !h.unblockable) {
    if (B.parryT > 0) return parry(world, B, A, h, cx, cy, dir);
    return block(world, B, A, h, cx, cy, dir);
  }

  if (A && B.state === 'attack' && B.activeHit && frontal && A.facing === dir && !h.unblockable && !B.activeHit.unblockable && !h.shape && !B.activeHit.shape) {
    const ta = A.move?.tier ?? A.def.tier, tb = B.move?.tier ?? B.def.tier;
    if (ta === tb) return clash(world, A, B, cx, cy, dir);
  }

  // An enemy that has read this move family turns it aside when it is free to, and merely shrugs it
  // off (a glancing hit) when it is busy attacking.
  const fam = A?.move?.fam ?? h.fam;
  const read = !B.isPlayer && B.def.adaptAt && fam !== 'riposte' && (B.adapt[fam] || 0) >= B.def.adaptAt && !B.rag && B.state !== 'stagger';
  if (read && A?.isPlayer && frontal && canDeflect(B)) return deflect(world, B, A, fam, cx, cy, dir);

  // ── damage ──
  let dmg = h.dmg, post = h.post, fresh = false, punished = false;
  if (read) { dmg *= 0.4; post = 0; }
  if (A?.isPlayer || h.fromPlayer) {
    const id = A?.move?.id ?? h.id ?? 'x';
    const r = world.style.land(id);
    dmg *= r.mul; fresh = r.fresh;
    if (A?.charged) { dmg *= 1.6; post *= 1.8; }
    world.gainFocus(6 * r.mul * (fresh ? 1.5 : 1) * (1 + world.style.rank * 0.12));
    if (A) A.hitLanded = true;
  } else dmg *= world.enemyDmg;
  if (B.broken) dmg *= 1.5;
  const pm = B.move?.punish;
  if (pm && B.state === 'attack' && B.mt >= pm[0] && B.mt <= pm[1]) { post *= 1.8; dmg *= 1.25; punished = true; }
  if (B.state === 'custom' && B.ai.channel) { dmg *= 1.25; }

  B.hp -= dmg; B.flash = 0.1; B.barT = 3.5; B.vib = h.stop + 0.06;
  world.onDamage(A, B, dmg, h, cx, cy, dir, { fresh, punished, glance: read });

  if (!B.isPlayer) {
    if (fam && B.def.adaptAt) {
      for (const k in B.adapt) if (k !== fam) B.adapt[k] = Math.max(0, B.adapt[k] - 0.6);
      B.adapt[fam] = (B.adapt[fam] || 0) + 1;
      if (B.adapt[fam] >= B.def.adaptAt && B.reads !== fam) { B.reads = fam; world.onAdapt(B, fam); }
    }
    if (B.state !== 'stagger') { B.posture += post; B.postureDelay = 2.4; }
    B.ai.hurt?.(B, world, A, h);
  }

  if (B.hp <= 0) return kill(world, A, B, h, cx, cy, dir);

  if (!B.isPlayer && B.posture >= B.maxPosture && !B.broken && !B.rag) {
    breakPosture(world, B);
    return 'break';
  }
  react(world, A, B, h, dir);
  return 'hit';
}

const canDeflect = (B) => !B.rag && (B.state === 'free' || B.state === 'guard' || B.state === 'hitstun' || (B.state === 'custom' && !B.ai.channel && !B.ai.busy));

function react(world, A, B, h, dir) {
  const kx = h.kx * dir, ky = h.ky;
  if (B.rag) {
    B.juggle++;
    if (h.kind === 'spike') { B.rag.kick(kx * 0.6, Math.abs(ky), rand(-3, 3)); B.rag.bounce = 0.6; }
    else if (h.kind === 'launch' || h.kind === 'knock') B.rag.kick(kx, Math.min(ky, -380), rand(-5, 5));
    else B.rag.kick(kx * 0.35, h.kind === 'pop' ? ky : -310, rand(-3, 3));
    return;
  }
  const armor = B.def.armor, staggered = B.state === 'stagger';
  const heavy = h.kind !== 'flinch';
  const liftable = B.isPlayer || (!B.def.noRagdoll && (armor < 2 || staggered) && (!B.armorNow || staggered));
  if (!B.isPlayer && !B.onGround && armor < 2) {
    // Anything that connects with an airborne enemy turns it into a juggle.
    B.toRagdoll(heavy ? kx : kx * 0.4, heavy ? (h.kind === 'spike' ? Math.abs(ky) : Math.min(ky, -300)) : -300, rand(-4, 4));
    if (h.kind === 'spike') B.rag.bounce = 0.6;
    return;
  }
  if (heavy && liftable) {
    if (h.kind === 'spike' && B.onGround) {
      B.toRagdoll(kx * 0.5, -Math.abs(ky) * 0.6, rand(-3, 3));
      world.fx.ring(B.x, -2, 20, 150, 0.35, '#ffffff', 0.22, 5); world.fx.dust(B.x, 0, 8, 0, 240);
    } else B.toRagdoll(kx, ky, rand(-5, 5) + dir * 2);
    if (B.isPlayer) B.invuln = 9;
    return;
  }
  if (staggered) { B.pv[3] -= 3; B.vx = kx * 0.3; return; }
  const flinches = B.isPlayer ? !(B.armorNow && !heavy) : armor === 0 || (armor === 1 && !B.armorNow);
  if (!flinches) { B.pv[3] -= 2.5 * B.facing * dir; return; }
  if (!B.isPlayer && B.def.chainBreak) {
    // Being flinch-locked only works for so long: after a few hits in a row the enemy snaps its guard up.
    // Launching it or breaking the guard with a heavy keeps the pressure on.
    B.chain = world.time - (B.lastStunT ?? -9) < 0.9 ? (B.chain || 0) + 1 : 1;
    B.lastStunT = world.time;
    if (B.chain >= B.def.chainBreak) {
      B.chain = 0; if (A) B.face(A.x);
      B.setState('guard'); B.ai.guardT = 0.9; B.ai.blocks = 0; B.vx = kx * 0.5;
      world.fx.ring(B.cx, B.cy, 8, 60, 0.2, B.color, 1, 3);
      return;
    }
  }
  B.setState('hitstun', heavy ? 0.5 : h.stun);
  B.vx = kx; if (!B.onGround) B.vy = -220;
  B.pv[3] -= 7; B.pv[4] -= 9;
  if (B.isPlayer) B.invuln = h.stun + 0.25;
}

function kill(world, A, B, h, cx, cy, dir) {
  const spike = h.kind === 'spike';
  const kvx = dir * Math.max(Math.abs(h.kx), 280) * 1.2;
  const kvy = spike ? Math.abs(h.ky) * 0.8 : Math.min(h.ky, -260) - 140;
  B.die(kvx, kvy, rand(-7, 7));
  if (spike) B.rag.bounce = 0.6;
  let cut = -1;
  if (!B.isPlayer && !h.shape && (h.dmg >= 9 || Math.random() < 0.5)) cut = B.severNear(cx, cy);
  world.onKill(A, B, h, cx, cy, dir, cut);
  return 'kill';
}

export function breakPosture(world, B) {
  B.broken = true; B.posture = B.maxPosture;
  B.setState('stagger', B.def.breakDur ?? 2.4);
  B.ai.onBreak?.(B, world);
  world.fx.text(B.x, B.j[1] - 34 * B.scale, 'BROKEN', '#ffd36b', 22, 1.1);
  world.fx.ring(B.cx, B.cy, 10, 120 * B.scale, 0.4, '#ffd36b', 1, 5);
  world.fx.spark(B.cx, B.cy, 0, 3.14, 18, 520, '#ffd36b');
  world.sfx('stagger', B.x); world.stop(0.12); world.shake(0.45);
}

function parry(world, D, A, h, cx, cy, dir) {
  const fx = world.fx;
  const px = (cx + (A ? A.tx : cx)) / 2, py = cy - 6;
  fx.spark(px, py, dir > 0 ? 0 : Math.PI, 1.3, 26, 760, D.color, { white: 0.6 });
  fx.flash(px, py, 70, '#ffffff', 0.12); fx.ring(px, py, 8, 110, 0.3, '#ffffff', 1, 4);
  fx.text(D.x, D.j[1] - 40, 'PARRY', '#ffffff', 22, 0.8);
  world.sfx('parry', D.x); world.stop(0.12); world.slow(0.4, 0.28); world.shake(0.4); world.punch(0.035);
  D.parryT = 0.2; D.posture = Math.max(0, D.posture - 20); D.blockT = 0.1; D.pv[7] += 9; D.pv[3] -= 3;
  if (D.isPlayer) { D.riposteT = 0.85; world.gainFocus(22); world.style.bonus(14); world.stats.parries++; }
  if (!A || A.dead) return 'parry';
  world.lastParried = A;
  A.posture += A.def.parryPosture ?? 50; A.postureDelay = 3; A.barT = 3.5;
  if (A.posture >= A.maxPosture && !A.broken) breakPosture(world, A);
  else { A.setState('recoil', A.def.parryRecoil ?? 0.95); A.vx = -dir * 180; A.ai.onParried?.(A, world); }
  return 'parry';
}

function block(world, D, A, h, cx, cy, dir) {
  const fx = world.fx;
  fx.spark(cx - dir * 14, cy, dir > 0 ? Math.PI : 0, 1.0, 9, 420, D.def.shieldColor || D.color);
  fx.flash(cx - dir * 14, cy, 44, D.def.shieldColor || D.color, 0.1);
  world.sfx('block', D.x); world.stop(0.045); world.shake(0.12);
  let post = h.post * (D.def.blockMul ?? 1);
  if (A?.charged) post *= 2.2;
  if (h.guardBreak && !D.isPlayer) post *= D.def.heavyBlockMul ?? 2;
  D.posture += post; D.postureDelay = 1.9; D.barT = 3.5;
  D.blockT = 0.2; D.vx = dir * Math.min(h.kx, 320) * 0.7; D.pv[3] -= 4; D.shieldHit = 0.2;
  if (A) { A.hitLanded = true; if (A.isPlayer) world.style.blocked(); }
  const fam = A?.move?.fam;
  if (A?.isPlayer && D.def.adaptAt && fam) D.adapt[fam] = (D.adapt[fam] || 0) + 0.5;
  D.ai.blocked?.(D, world, A);
  if (D.posture >= D.maxPosture) {
    world.sfx('guardBreak', D.x); world.stop(0.1); world.shake(0.4);
    fx.ring(cx, cy, 10, 130, 0.35, D.def.shieldColor || D.color, 1, 5);
    fx.spark(cx, cy, 0, 3.14, 22, 600, D.def.shieldColor || D.color);
    if (D.isPlayer) { D.setState('stagger', 1.0); D.posture = 0; fx.text(D.x, D.j[1] - 40, 'GUARD BROKEN', '#ff6b6b', 18, 1); }
    else breakPosture(world, D);
    return 'break';
  }
  return 'block';
}

function clash(world, A, B, cx, cy, dir) {
  B.hitSet.add(A);
  const x = (A.tx + B.tx) / 2, y = (A.ty + B.ty) / 2;
  world.fx.spark(x, y, 0, 3.14, 30, 700, '#ffffff', { white: 0.5 });
  world.fx.spark(x, y, 0, 3.14, 10, 500, A.color); world.fx.spark(x, y, 0, 3.14, 10, 500, B.color);
  world.fx.flash(x, y, 110, '#ffffff', 0.18); world.fx.ring(x, y, 10, 100, 0.3, '#ffffff', 1, 3);
  world.sfx('clash', x); world.stop(0.11); world.shake(0.4);
  A.setState('recoil', 0.3); B.setState('recoil', 0.36);
  A.vx = -dir * 300; B.vx = dir * 300;
  if (A.isPlayer || B.isPlayer) world.gainFocus(8);
  return 'clash';
}

// An enemy that has read a repeated move turns it aside and answers.
function deflect(world, D, A, fam, cx, cy, dir) {
  const x = (cx + A.tx) / 2;
  world.fx.spark(x, cy, dir > 0 ? Math.PI : 0, 1.2, 20, 620, D.color, { white: 0.5 });
  world.fx.flash(x, cy, 80, D.color, 0.16);
  world.fx.text(D.x, D.j[1] - 44 * D.scale, 'READ', D.color, 22, 1.0);
  world.sfx('deflected', A.x); world.sfx('adapt', D.x); world.stop(0.1); world.shake(0.3);
  A.setState('recoil', 0.42); A.vx = -dir * 320;
  D.adapt[fam] = Math.max(0, D.def.adaptAt - 2.5); D.reads = null;
  world.style.blocked(); world.stats.reads++;
  D.face(A.x);
  if (D.def.counter) D.startMove(D.def.counter);
  return 'deflect';
}
