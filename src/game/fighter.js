// A Fighter is the shared body for the player and every enemy: kinematic root physics, a spring-driven
// pose solved to 11 joints, a move/state machine, and a ragdoll it can drop into and blend back out of.
import { clamp, approach, wrapNear, ik2, TAU, EASE } from '../core/math.js';
import { MOVES, sampleMove, fillStance, makeStance, N, C } from './moves.js';
import { Ragdoll, BONES, G } from './ragdoll.js';

const { PY, PX, ROT, LEAN, HEAD, HA, HR, BL, UA, LA, F1X, F1Y, F2X, F2Y } = C;
export const J = { HEAD: 0, NECK: 1, PELVIS: 2, ELB_F: 3, HAND_F: 4, ELB_B: 5, HAND_B: 6, KNEE_F: 7, FOOT_F: 8, KNEE_B: 9, FOOT_B: 10 };
export const NJ = 11;
const DIM = { torso: 38, neck: 14, upper: 20, fore: 20, thigh: 26, shin: 26 };
const TRAIL_N = 28;
export const TRAIL_STRIDE = 6;
const ikOut = new Float32Array(4);
const L = new Float32Array(NJ * 2 + 4); // local joints + blade tip + second tip

export class Fighter {
  constructor(def, x, team) {
    this.def = def; this.team = team; this.isPlayer = def.kind === 'player';
    this.scale = def.scale;
    this.x = x; this.y = 0; this.vx = 0; this.vy = 0;
    this.facing = team === 0 ? 1 : -1; this.onGround = true;
    this.hp = this.maxHp = def.hp;
    this.posture = 0; this.maxPosture = def.posture; this.postureDelay = 0;
    this.state = 'free'; this.st = 0; this.stDur = 0; this.t = Math.random() * 10;
    this.move = null; this.mt = 0; this.hitIdx = -1; this.hitSet = new Set(); this.activeHit = null;
    this.hitLanded = false; this.charging = false; this.chargeT = 0; this.charged = false;
    this.stance = makeStance(def.stance);
    this.guardStance = def.guardPose ? makeStance({ ...def.stance, ...def.guardPose }) : null;
    this.p = new Float32Array(N); this.pv = new Float32Array(N); this.tgt = new Float32Array(N);
    this.p.set(this.stance);
    this.j = new Float32Array(NJ * 2); this.jb = new Float32Array(NJ * 2);
    this.bx = 0; this.by = 0; this.tx = 0; this.ty = 0; this.t2x = 0; this.t2y = 0;
    this.pbx = 0; this.pby = 0; this.ptx = 0; this.pty = 0; this.pt2x = 0; this.pt2y = 0;
    this.pcx = x; this.pcy = -60; // previous chest point, for pass-through hits
    this.bladeLen = def.blade.len * def.scale;
    this.bladeOn = def.blade.gun ? 0 : 1; this.armed = true; this.double = !!def.blade.double;
    this.color = def.color;
    this.rag = null; this.juggle = 0;
    this.invuln = 0; this.flash = 0; this.tele = 0; this.teleRed = false; this.blockT = 0; this.parryT = 0;
    this.armorNow = false; this.broken = false; this.vib = 0;
    this.moveX = 0; this.runPhase = 0; this.flipT = 0; this.dashDir = 1; this.dashCd = 0;
    this.poseFn = null;
    this.trail = new Float32Array(TRAIL_N * TRAIL_STRIDE); this.trailHead = 0; this.trailOn = false;
    this.ribbons = (def.ribbons || []).map((r) => ({ ...r, pts: null }));
    this.ai = {}; this.adapt = {}; this.reads = null;
    this.dead = false; this.deadT = 0; this.remove = false; this.fade = 1;
    this.barT = 0; // seconds the floating health bar stays visible
    const s = def.scale;
    this.lens = [DIM.neck * s, DIM.torso * s, DIM.upper * s, DIM.fore * s, DIM.upper * s, DIM.fore * s, DIM.thigh * s, DIM.shin * s, DIM.thigh * s, DIM.shin * s];
    this.computeJoints();
    this.pbx = this.bx; this.pby = this.by; this.ptx = this.tx; this.pty = this.ty;
  }

  get alive() { return !this.dead; }
  get inRagdoll() { return this.state === 'ragdoll'; }
  get airborne() { return this.rag ? this.rag.air : !this.onGround; }
  // Chest point, used for targeting, camera and effects.
  get cx() { return (this.j[2] + this.j[4]) * 0.5; }
  get cy() { return (this.j[3] + this.j[5]) * 0.5; }

  setState(name, dur = 0) {
    this.state = name; this.st = 0; this.stDur = dur;
    this.move = null; this.activeHit = null; this.armorNow = false; this.charging = false; this.poseFn = null;
    this.unwind();
  }

  // Spin channels can finish a move whole turns away from rest; bring them back near it without a visible unwind.
  unwind() {
    this.p[ROT] = wrapNear(this.p[ROT], 0);
    this.p[BL] = wrapNear(this.p[BL], this.stance[BL]);
    this.p[HA] = wrapNear(this.p[HA], this.stance[HA]);
  }

  startMove(id) {
    const m = MOVES[id];
    this.setState('attack');
    this.move = m; this.mt = -1e-4;
    this.hitIdx = -1; this.hitSet.clear(); this.hitLanded = false; this.atkSerial = (this.atkSerial || 0) + 1;
    this.chargeT = 0; this.charged = false; this.chargeDone = false; this.rose = false;
    const first = m.k[0].a;
    if (!Number.isNaN(first[BL])) this.p[BL] = wrapNear(this.p[BL], first[BL]);
    if (!Number.isNaN(first[HA])) this.p[HA] = wrapNear(this.p[HA], first[HA]);
    return m;
  }

  face(x) { if (x !== this.x) this.facing = x > this.x ? 1 : -1; }

  update(world, dt) {
    if (dt <= 0) return;
    this.t += dt; this.st += dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.tele > 0) this.tele -= dt;
    if (this.blockT > 0) this.blockT -= dt;
    if (this.parryT > 0) this.parryT -= dt;
    if (this.dashCd > 0) this.dashCd -= dt;
    if (this.vib > 0) this.vib -= dt;
    if (this.barT > 0) this.barT -= dt;
    if (this.shieldHit > 0) this.shieldHit -= dt;
    if (this.postureDelay > 0) this.postureDelay -= dt;
    else if (this.posture > 0 && this.state !== 'stagger') this.posture = Math.max(0, this.posture - this.def.postureRegen * dt);

    this.pbx = this.bx; this.pby = this.by; this.ptx = this.tx; this.pty = this.ty; this.pt2x = this.t2x; this.pt2y = this.t2y;
    this.pcx = this.cx; this.pcy = this.cy;

    this.moveX = 0; this.stepping = false;
    // The controller runs even while limp so the player can tech out of a knockdown.
    if (!this.dead) this.def.ctrl?.(this, world, dt);
    if (this.rag) { this.updateRagdoll(world, dt); this.updateRibbons(dt); return; }

    let grav = 1, fric = 2600;
    switch (this.state) {
      case 'attack': grav = this.tickMove(world, dt); fric = 2400; break;
      case 'dash': {
        const k = this.st / this.stDur;
        this.vx = this.dashDir * this.def.dashSpeed * (k < 0.7 ? 1 : 1 - (k - 0.7) * 2);
        this.vy = 0; grav = 0;
        if (this.st >= this.stDur) { this.setState('free'); this.vx = this.dashDir * this.def.runSpeed; }
        break;
      }
      case 'hitstun': case 'recoil': fric = 1500; if (this.st >= this.stDur) this.setState('free'); break;
      case 'stagger': fric = 2200; if (this.st >= this.stDur) { this.setState('free'); this.broken = false; this.posture = 0; } break;
      case 'getup': if (this.st >= this.stDur) this.setState('free'); break;
      case 'guard': fric = 3200; break;
      case 'custom': fric = 2000; if (this.stDur > 0 && this.st >= this.stDur) this.setState('free'); break;
    }

    // Root physics.
    if (this.state === 'free') {
      const acc = this.onGround ? this.def.accel : this.def.accel * 0.55;
      if (this.moveX !== 0 || this.onGround) this.vx = approach(this.vx, this.moveX * this.def.runSpeed * (this.speedMul ?? 1), acc * dt);
    } else if (this.onGround && this.state !== 'dash' && !this.stepping) {
      this.vx = approach(this.vx, 0, fric * dt);
    }
    if (!this.onGround) this.vy += G * grav * (this.gravMul ?? 1) * dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    if (this.y >= 0 && this.vy >= 0) {
      if (!this.onGround) this.land(world);
      this.y = 0; this.vy = 0; this.onGround = true;
    } else if (this.y < 0) this.onGround = false;
    const pad = 26 * this.scale;
    if (this.x < world.minX + pad) { this.x = world.minX + pad; this.hitWall?.(world); }
    if (this.x > world.maxX - pad) { this.x = world.maxX - pad; this.hitWall?.(world); }
    if (this.onGround) this.runPhase += (this.vx * this.facing * dt) / 26;

    this.updatePose(dt);
    this.computeJoints();
    if (this.state === 'getup') {
      const k = EASE.io(clamp(this.st / this.stDur, 0, 1));
      for (let i = 0; i < NJ * 2; i++) this.j[i] = this.jb[i] + (this.j[i] - this.jb[i]) * k;
    }
    this.sampleTrail(world.time);
    this.updateRibbons(dt);
  }

  tickMove(world, dt) {
    const m = this.move, prev = this.mt;
    if (!this.charging) this.mt += dt;
    const mt = this.mt;
    for (const ev of m.ev) if (prev < ev[0] && mt >= ev[0]) this.fire(world, ev);
    for (const s of m.step) {
      if (mt >= s[0] && mt < s[1]) { this.vx = world.stepSpeed(this, s[2]) * this.facing; this.stepping = true; }
    }
    this.activeHit = null;
    for (let i = 0; i < m.hits.length; i++) {
      const h = m.hits[i];
      if (mt >= h.t0 && mt <= h.t1) {
        if (this.hitIdx !== i) { this.hitIdx = i; this.hitSet.clear(); }
        this.activeHit = h;
      }
    }
    this.armorNow = !!m.armor && mt >= m.armor[0] && mt <= m.armor[1];
    if (m.invuln && mt >= m.invuln[0] && mt <= m.invuln[1]) this.invuln = Math.max(this.invuln, 0.03);
    let grav = 1;
    if (m.plunge) {
      if (mt < 0.14) { this.vy = -60; this.vx *= 0.9; grav = 0; } else { this.vy = 1500; this.vx *= 0.94; grav = 0; }
    } else if (m.air && !this.onGround) {
      grav = 0.42;
      if (this.vy > 260) this.vy = 260;
    }
    if (mt >= m.dur) { this.setState('free'); this.stepping = false; }
    return grav;
  }

  fire(world, ev) {
    const [, type, arg] = ev;
    if (type === 'sfx') world.sfx(arg, this.x, this.isPlayer ? 1 : 0.8);
    else if (type === 'tele') { this.tele = 0.42; this.teleRed = !!arg; world.sfx(arg ? 'telegraphRed' : 'telegraph', this.x); }
    else if (type === 'leap') { this.vx = arg[0] * this.facing; this.vy = arg[1]; this.onGround = false; this.y -= 1; }
    else if (type === 'fx') world.moveFx(this, arg);
    else if (type === 'spawn') world.spawnFrom(this, arg);
  }

  land(world) {
    this.pv[PY] -= clamp(this.vy * 0.35, 80, 420);
    world.onLand(this, this.vy);
    if (this.move?.plunge) { this.startMove('PLUNGE_LAND'); world.moveFx(this, 'plunge'); }
  }

  updatePose(dt) {
    const t = this.tgt, d = this.def;
    fillStance(t, this.stance);
    let w = 17, z = 0.72;
    switch (this.state) {
      case 'free':
        if (!this.onGround) { this.airPose(t); w = 20; }
        else if (Math.abs(this.vx) > 40) { this.runPose(t); w = 30; z = 0.9; }
        else { t[PY] += Math.sin(this.t * 2.3) * 1.1; t[BL] += Math.sin(this.t * 1.7) * 0.04; t[HA] += Math.sin(this.t * 2.3 + 1) * 0.03; }
        break;
      case 'attack': sampleMove(this.move, this.mt, t); w = 58; z = 0.92;
        if (this.move.run && this.mt > this.move.run) { const bl = t[BL], ha = t[HA], hr = t[HR]; this.runPose(t); t[BL] = bl; t[HA] = ha; t[HR] = hr; t[LEAN] = 0.6; }
        if (this.charging) { t[BL] += Math.sin(this.t * 60) * 0.03; t[PY] -= this.chargeT * 5; }
        if (this.move.aim && this.mt < this.move.aim[1] + 0.12 && this.aimLocal !== undefined) { t[BL] = this.aimLocal; t[HA] = this.aimLocal * 0.7; }
        break;
      case 'dash': t[LEAN] = 0.95; t[PY] = 34; t[F1X] = -4; t[F1Y] = 8; t[F2X] = -36; t[F2Y] = 16; t[HA] = -2.7; t[HR] = 0.9; t[BL] = 3.25; t[UA] = -2.9; t[LA] = -2.9; w = 44; z = 0.9; break;
      case 'guard':
        if (this.guardStance) t.set(this.guardStance);
        else { t[PY] = 43; t[LEAN] = -0.05; t[HA] = 0.25; t[HR] = 0.62; t[BL] = 1.85; t[UA] = -0.2; t[LA] = 0.9; t[F1X] = 20; t[F2X] = -20; }
        if (!this.onGround) { t[F1X] = 10; t[F1Y] = 18; t[F2X] = -10; t[F2Y] = 10; }
        w = 40; z = 0.8; break;
      case 'hitstun': t[LEAN] = -0.4; t[HEAD] = -0.45; t[HA] = -2.2; t[HR] = 0.8; t[BL] = -2.0; t[UA] = 2.6; t[LA] = 2.9; t[F1X] = 4; t[F2X] = -24; t[PY] = 43; w = 24; z = 0.55; break;
      case 'recoil': t[LEAN] = -0.35; t[HA] = 2.3; t[HR] = 0.9; t[BL] = 2.3; t[PY] = 46; t[F1X] = 4; t[F2X] = -24; t[UA] = -2.8; t[LA] = -2.4; w = 26; z = 0.6; break;
      case 'stagger': t[PY] = 27; t[LEAN] = 0.55 + Math.sin(this.st * 9) * 0.04; t[HEAD] = 0.5; t[HA] = -1.35; t[HR] = 0.85; t[BL] = -1.45; t[UA] = -1.7; t[LA] = -1.5; t[F1X] = 18; t[F2X] = -22; w = 15; z = 0.6; break;
      case 'custom': if (this.poseFn) w = this.poseFn(this, t) || 24; break;
    }
    const p = this.p, v = this.pv, w2 = w * w, c = 2 * z * w;
    for (let i = 0; i < N; i++) {
      v[i] += (w2 * (t[i] - p[i]) - c * v[i]) * dt;
      p[i] += v[i] * dt;
    }
    if (this.flipT > 0) {
      this.flipT -= dt;
      p[ROT] = this.flipT > 0 ? TAU * EASE.io(1 - this.flipT / 0.36) : 0; v[ROT] = 0;
    }
  }

  runPose(t) {
    const ph = this.runPhase, k = Math.min(1, Math.abs(this.vx) / 390);
    const S = 26 * k, Lf = 18 * k;
    t[F1X] = -Math.cos(ph) * S + 2; t[F1Y] = Math.max(0, Math.sin(ph)) * Lf;
    t[F2X] = Math.cos(ph) * S + 2; t[F2Y] = Math.max(0, -Math.sin(ph)) * Lf;
    t[PY] = 44 + Math.cos(ph * 2) * 2;
    const back = this.vx * this.facing < 0;
    t[LEAN] = back ? -0.06 : 0.1 + 0.3 * k;
    t[UA] = -1.6 + Math.cos(ph) * 0.9 * k; t[LA] = t[UA] + 1.1;
    if (this.def.ninja && !back) { t[HA] = -2.3 + Math.cos(ph) * 0.12; t[HR] = 0.8; t[BL] = 3.5; }
  }

  airPose(t) {
    t[PY] = 47;
    if (this.flipT > 0) { t[F1X] = 6; t[F1Y] = 26; t[F2X] = -6; t[F2Y] = 24; t[LEAN] = 0.5; t[HA] = -1.2; t[BL] = 3.0; return; }
    if (this.vy < 0) { t[F1X] = 10; t[F1Y] = 18; t[F2X] = -8; t[F2Y] = 4; t[LEAN] = 0.16; t[UA] = -2.6; t[LA] = -2.2; if (this.def.ninja) { t[HA] = -1.9; t[HR] = 0.8; t[BL] = 3.3; } }
    else { t[F1X] = 14; t[F1Y] = 10; t[F2X] = -14; t[F2Y] = 16; t[LEAN] = 0.04; t[UA] = 2.5; t[LA] = 2.1; if (this.def.ninja) { t[HA] = 1.1; t[HR] = 0.75; t[BL] = 1.9; } }
  }

  computeJoints() {
    const p = this.p, s = this.scale, f = this.facing, j = this.j;
    const px = p[PX] * s, py = p[PY] * s;
    const ta = Math.PI / 2 - p[LEAN];
    const nx = px + Math.cos(ta) * DIM.torso * s, ny = py + Math.sin(ta) * DIM.torso * s;
    const ha = ta - p[HEAD];
    L[0] = nx + Math.cos(ha) * DIM.neck * s; L[1] = ny + Math.sin(ha) * DIM.neck * s;
    L[2] = nx; L[3] = ny; L[4] = px; L[5] = py;
    const U = DIM.upper * s, F = DIM.fore * s;
    const reach = (U + F) * clamp(p[HR], 0.2, 1);
    ik2(nx, ny, nx + Math.cos(p[HA]) * reach, ny + Math.sin(p[HA]) * reach, U, F, -1, ikOut);
    L[6] = ikOut[0]; L[7] = ikOut[1]; L[8] = ikOut[2]; L[9] = ikOut[3];
    L[10] = nx + Math.cos(p[UA]) * U; L[11] = ny + Math.sin(p[UA]) * U;
    L[12] = L[10] + Math.cos(p[LA]) * F; L[13] = L[11] + Math.sin(p[LA]) * F;
    const T = DIM.thigh * s, Sh = DIM.shin * s;
    ik2(px, py, p[F1X] * s, p[F1Y] * s, T, Sh, 1, ikOut);
    L[14] = ikOut[0]; L[15] = ikOut[1]; L[16] = ikOut[2]; L[17] = ikOut[3];
    ik2(px, py, p[F2X] * s, p[F2Y] * s, T, Sh, 1, ikOut);
    L[18] = ikOut[0]; L[19] = ikOut[1]; L[20] = ikOut[2]; L[21] = ikOut[3];
    const bl = this.bladeLen;
    L[22] = L[8] + Math.cos(p[BL]) * bl; L[23] = L[9] + Math.sin(p[BL]) * bl;
    L[24] = L[8] - Math.cos(p[BL]) * bl; L[25] = L[9] - Math.sin(p[BL]) * bl;
    const r = p[ROT];
    if (r !== 0) {
      const cs = Math.cos(r), sn = Math.sin(r), ox = px, oy = py + 14 * s;
      for (let i = 0; i < 26; i += 2) {
        const dx = L[i] - ox, dy = L[i + 1] - oy;
        L[i] = ox + dx * cs + dy * sn; L[i + 1] = oy - dx * sn + dy * cs;
      }
    }
    for (let i = 0; i < NJ * 2; i += 2) { j[i] = this.x + L[i] * f; j[i + 1] = this.y - L[i + 1]; }
    this.bx = j[8]; this.by = j[9];
    this.tx = this.x + L[22] * f; this.ty = this.y - L[23];
    this.t2x = this.x + L[24] * f; this.t2y = this.y - L[25];
  }

  sampleTrail(time) {
    const sp = Math.abs(this.tx - this.ptx) + Math.abs(this.ty - this.pty);
    const on = this.armed && this.bladeOn > 0.5 && (this.state === 'attack' || sp > 5);
    const o = this.trailHead * TRAIL_STRIDE, tr = this.trail;
    tr[o] = this.bx; tr[o + 1] = this.by; tr[o + 2] = this.tx; tr[o + 3] = this.ty; tr[o + 4] = time; tr[o + 5] = on ? 1 : 0;
    this.trailHead = (this.trailHead + 1) % TRAIL_N;
  }

  updateRibbons(dt) {
    if (!this.ribbons.length) return;
    const ax0 = this.j[this.def.ribbonJoint === 'head' ? 0 : 2], ay0 = this.j[this.def.ribbonJoint === 'head' ? 1 : 3];
    for (const rb of this.ribbons) {
      const n = rb.n;
      if (!rb.pts) {
        rb.pts = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) { rb.pts[i * 4] = rb.pts[i * 4 + 2] = ax0 - this.facing * i * rb.seg; rb.pts[i * 4 + 1] = rb.pts[i * 4 + 3] = ay0; }
      }
      const q = rb.pts, seg = rb.seg * this.scale;
      q[0] = ax0 + (rb.ox || 0) * this.facing; q[1] = ay0 + (rb.oy || 0);
      const wind = -this.facing * 260 + Math.sin(this.t * 3 + rb.n) * 120;
      // Time-corrected verlet so the cloth slows down with the rest of the world in slow motion.
      const kd = 0.965 * (dt / (rb.dt || dt)); rb.dt = dt;
      for (let i = 1; i < n; i++) {
        const o = i * 4;
        const vx = (q[o] - q[o + 2]) * kd, vy = (q[o + 1] - q[o + 3]) * kd;
        q[o + 2] = q[o]; q[o + 3] = q[o + 1];
        q[o] += vx + wind * dt * dt * 8; q[o + 1] += vy + (rb.grav ?? 500) * dt * dt * 8 + Math.sin(this.t * 7 + i) * 0.12;
        if (q[o + 1] > -2) q[o + 1] = -2;
      }
      for (let it = 0; it < 2; it++) {
        for (let i = 1; i < n; i++) {
          const o = i * 4, dx = q[o] - q[o - 4], dy = q[o + 1] - q[o - 3];
          const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
          if (d > seg) { const k = (d - seg) / d; q[o] -= dx * k; q[o + 1] -= dy * k; }
        }
      }
    }
  }

  // ───────────── ragdoll ─────────────
  toRagdoll(vx, vy, spin = 0) {
    this.rag = new Ragdoll(this.j, this.lens, this.scale);
    this.rag.kick(vx, vy, spin);
    this.setState('ragdoll');
    this.onGround = false; this.vx = 0; this.vy = 0; this.stepping = false;
  }

  updateRagdoll(world, dt) {
    const rag = this.rag, s = this.scale;
    rag.gravScale = this.dead ? 1 : 1 + this.juggle * 0.09;
    const impact = rag.step(dt, world.minX, world.maxX);
    for (let i = 0; i < NJ; i++) { this.j[i * 2] = rag.x[i]; this.j[i * 2 + 1] = rag.y[i]; }
    this.x = rag.x[J.PELVIS]; this.y = 0;
    // The blade follows the forearm while the body is limp.
    const ex = rag.x[J.ELB_F], ey = rag.y[J.ELB_F], hx = rag.x[J.HAND_F], hy = rag.y[J.HAND_F];
    const d = Math.hypot(hx - ex, hy - ey) || 1;
    this.bx = hx; this.by = hy;
    this.tx = hx + ((hx - ex) / d) * this.bladeLen; this.ty = Math.min(-2, hy + ((hy - ey) / d) * this.bladeLen);
    this.t2x = hx - ((hx - ex) / d) * this.bladeLen; this.t2y = Math.min(-2, hy - ((hy - ey) / d) * this.bladeLen);
    if (impact > 320) { world.onBodyImpact(this, impact); rag.bounce = 0.32; }
    if (rag.wallImpact > 420) world.onWallImpact(this, rag.wallImpact);
    if (this.dead) {
      this.deadT += dt;
      this.bladeOn = Math.max(0, this.bladeOn - dt * (2.5 + Math.sin(this.deadT * 50) * 2));
      if (this.deadT > 3.2) this.fade = Math.max(0, 1 - (this.deadT - 3.2) / 1.2);
      if (this.deadT > 4.4 && !this.isPlayer) this.remove = true;
      return;
    }
    const quick = this.isPlayer;
    if (rag.rest > (quick ? 0.16 : 0.4) || rag.grounded > (quick ? 0.75 : 1.25)) this.getUp(quick ? 0.36 : this.def.getup ?? 0.6, s);
  }

  getUp(dur) {
    this.jb.set(this.j);
    this.x = this.rag.x[J.PELVIS]; this.y = 0; this.vx = 0; this.vy = 0; this.onGround = true;
    this.rag = null; this.juggle = 0;
    this.setState('getup', dur);
    this.p.set(this.stance); this.pv.fill(0);
    this.p[PY] = 24; this.p[LEAN] = 0.8;
    if (this.isPlayer) this.invuln = dur + 0.7;
  }

  die(vx, vy, spin) {
    this.dead = true; this.hp = 0; this.activeHit = null; this.tele = 0;
    if (this.rag) this.rag.kick(vx, vy, spin); else this.toRagdoll(vx, vy, spin);
    this.rag.gravScale = 1;
  }

  // Cut the bone nearest a world point (used on killing blows).
  severNear(x, y) {
    if (!this.rag) return -1;
    let best = -1, bd = 1e9;
    for (let b = 1; b < BONES.length; b++) {
      const [a, c] = BONES[b];
      const mx = (this.rag.x[a] + this.rag.x[c]) / 2, my = (this.rag.y[a] + this.rag.y[c]) / 2;
      const d = (mx - x) ** 2 + (my - y) ** 2;
      if (d < bd) { bd = d; best = b; }
    }
    if (best >= 0) this.rag.sever(best);
    return best;
  }
}
