// Player controller: turns buffered input into moves, cancels and movement.
import { MOVES } from './moves.js';

export const PLAYER = {
  kind: 'player', name: 'Initiate Zero', scale: 1, hp: 100, posture: 100, postureRegen: 45,
  color: '#56e9ff', outline: '#a8f4ff', lineW: 5.5, runSpeed: 390, accel: 5200, dashSpeed: 980,
  blade: { len: 74 }, armor: 0, tier: 1, ninja: true,
  ribbons: [{ n: 11, seg: 6.5, color: '#56e9ff', width: 5, oy: 3 }],
  ctrl: playerCtrl,
};

const BURSTABLE = { hitstun: 1, stagger: 1, ragdoll: 1, getup: 1, recoil: 1 };

export function playerCtrl(f, world, dt) {
  const inp = world.input;
  if (!inp || world.lockInput) return;
  const ax = inp.axisX();
  f.riposteT = (f.riposteT || 0) - dt;
  f.sinceDash = (f.sinceDash ?? 9) + dt;
  if (f.onGround) { f.airJumps = 1; f.airDash = 1; f.coyote = 0.09; f.refunded = false; } else f.coyote -= dt;

  // Focus spends that are not attacks. Burst answers being hit; Overdrive is started on your own terms.
  if (BURSTABLE[f.state] && !f.dead) {
    if (inp.peek('special', 0.2)) { inp.consume('special'); if (world.burst(f)) return; }
  } else if (!f.dead && inp.peek('overdrive', 0.15)) { inp.consume('overdrive'); world.startOverdrive(f); }
  // The selected power can be changed at any moment, even mid-swing.
  if (inp.peek('cycle', 0.2)) { inp.consume('cycle', 0.2); world.cyclePower(1); }

  switch (f.state) {
    case 'free':
      f.moveX = ax; if (ax) f.facing = ax;
      if (tryDash(f, world, inp, ax) || tryAttack(f, world, inp, ax, null) || trySpecial(f, world, inp, ax)) return;
      if (inp.held('guard')) { enterGuard(f, world, inp); return; }
      tryJump(f, world, inp, ax);
      if (!f.onGround) {
        if (f.jumping && !inp.held('jump') && f.vy < -360) f.vy = -360;
        if (f.vy >= 0) f.jumping = false;
        if (inp.held('down') && f.vy > -200) f.vy += 2600 * dt;
      }
      break;

    case 'attack': {
      const m = f.move, mt = f.mt;
      if (m.charge && !f.chargeDone && mt >= m.charge) {
        if (inp.held('heavy') && f.chargeT < 0.6) { f.charging = true; f.chargeT += dt; world.chargeFx(f, dt); }
        else { f.charging = false; f.chargeDone = true; f.charged = f.chargeT >= 0.3; }
      }
      if (m.rise && !f.rose && mt >= m.rise && f.hitLanded && (inp.held('heavy') || inp.held('jump'))) {
        f.rose = true; f.vy = -840; f.onGround = false; f.y -= 1; f.jumping = false;
      }
      if (!(mt >= m.cancel || (f.hitLanded && mt >= m.cancel * 0.75))) break;
      if (tryDash(f, world, inp, ax) || tryAttack(f, world, inp, ax, m) || trySpecial(f, world, inp, ax)) return;
      if (f.hitLanded && tryJump(f, world, inp, ax)) { f.setState('free'); return; }
      if (mt >= m.cancel + 0.05 && inp.held('guard') && !m.plunge) { enterGuard(f, world, inp); return; }
      if (mt >= m.cancel + 0.1 && ax && !m.plunge && !m.air) f.setState('free');
      break;
    }

    case 'guard':
      if (f.riposteT > 0 && (inp.peek('light', 0.2) || inp.peek('heavy', 0.2))) { tryAttack(f, world, inp, ax, null); return; }
      if (tryDash(f, world, inp, ax)) return;
      if (f.blockT <= 0) {
        if (ax) f.facing = ax;
        if (tryJump(f, world, inp, ax)) { f.setState('free'); return; }
        if (!inp.held('guard') && f.st > 0.1) f.setState('free');
      }
      break;

    case 'dash':
      f.ghostT = (f.ghostT || 0) - dt;
      if (f.ghostT <= 0) { f.ghostT = 0.035; world.fx.ghost(f, f.color, 0.26); }
      if (f.st > 0.08 && (inp.peek('light', 0.2) || inp.peek('heavy', 0.2))) tryAttack(f, world, inp, 0, null);
      break;

    case 'custom': f.script?.(f, world, dt); break; // a power that takes over the body (Flash Step)

    case 'ragdoll':
      // Tech: dash as you hit the floor to roll straight back to your feet.
      if (!f.dead && f.rag && f.rag.y[2] > -60 && f.st > 0.25 && inp.consume('dash', 0.22)) {
        f.getUp(0.2); f.invuln = 0.65;
        world.fx.ring(f.x, -4, 10, 70, 0.25, f.color, 0.25, 3); world.sfx('dash', f.x); world.fx.text(f.x, -120, 'RECOVER', f.color, 15, 0.6);
      }
      break;
  }
}

function tryJump(f, world, inp, ax) {
  if (!inp.peek('jump', 0.12)) return false;
  if (f.onGround || f.coyote > 0) {
    inp.consume('jump');
    f.vy = -930; f.onGround = false; f.y -= 1; f.coyote = 0; f.jumping = true;
    world.sfx('jump', f.x); world.fx.dust(f.x, 0, 4, 0, 120);
    return true;
  }
  if (f.airJumps > 0) {
    inp.consume('jump');
    f.airJumps--; f.vy = -850; f.flipT = 0.36; f.jumping = true;
    if (ax) f.vx = ax * f.def.runSpeed;
    world.sfx('doubleJump', f.x); world.fx.ring(f.x, f.y, 6, 46, 0.22, f.color, 0.3, 3);
    return true;
  }
  return false;
}

function tryDash(f, world, inp, ax) {
  if (f.dashCd > 0 || !inp.peek('dash', 0.12)) return false;
  if (!f.onGround) { if (f.airDash <= 0) return false; f.airDash--; }
  inp.consume('dash');
  const dir = ax || f.facing;
  f.setState('dash', 0.17);
  f.dashDir = dir; f.facing = dir; f.invuln = Math.max(f.invuln, 0.15); f.dashCd = 0.46 * world.mods.dashCd; f.dodged = false; f.sinceDash = 0; f.ghostT = 0;
  world.sfx('dash', f.x);
  if (f.onGround) world.fx.dust(f.x, 0, 5, -dir, 220);
  return true;
}

function enterGuard(f, world, inp) {
  const press = inp.pressedAt.guard, since = inp.sincePress('guard');
  // Mashing guard shrinks the parry window so timing still matters.
  const spam = press !== f.guardPress && press - (f.guardPress ?? -9) < 0.45;
  f.guardPress = press;
  f.setState('guard');
  f.parryT = Math.max(0, (spam ? 0.1 : 0.2) - since);
}

function trySpecial(f, world, inp, ax) {
  if (!inp.peek('special', 0.12)) return false;
  inp.consume('special');
  autoFace(f, world, ax);
  return world.usePower(f);
}

function tryAttack(f, world, inp, ax, cur) {
  const air = !f.onGround;
  const light = inp.peek('light'), heavy = !light && inp.peek('heavy');
  if (!light && !heavy) return false;
  inp.consume(light ? 'light' : 'heavy');
  if (!f.armed) return false;
  let id;
  if (f.riposteT > 0 && !air) id = 'RIPOSTE';
  else if (light) {
    const nx = cur?.next.light;
    id = nx && !!MOVES[nx].air === air ? nx : air ? 'A1' : f.sinceDash < 0.32 ? 'DA' : 'L1';
  } else if (inp.held('down')) id = air ? 'PLUNGE' : 'LAUNCH';
  else {
    const nx = cur?.next.heavy;
    id = nx && !!MOVES[nx].air === air ? nx : air ? 'AH' : 'H1';
  }
  if (id === 'RIPOSTE') {
    f.riposteT = 0;
    const t = world.lastParried;
    if (t && !t.dead) f.face(t.x); else autoFace(f, world, ax);
    world.slow(0.45, 0.22);
  } else autoFace(f, world, ax);
  f.startMove(id);
  if (air && MOVES[id].air && !MOVES[id].plunge && f.vy > 0) f.vy *= 0.3;
  return true;
}

// With no direction held, turn toward the nearest threat so strings do not sail past it.
function autoFace(f, world, ax) {
  if (ax) { f.facing = ax; return; }
  let best = null, bd = 340;
  for (const e of world.fighters) {
    if (e.team === f.team || e.dead) continue;
    const d = Math.abs(e.x - f.x);
    if (d < bd) { bd = d; best = e; }
  }
  if (best && Math.abs(best.x - f.x) > 8) f.face(best.x);
}
