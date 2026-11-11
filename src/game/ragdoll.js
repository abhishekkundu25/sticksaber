// Position-based ragdoll over the same 11 joints the animated skeleton uses, so a fighter can drop
// into physics from any pose and be blended back out of it joint-for-joint.
import { rand } from '../core/math.js';

export const G = 2600;
// [a, b] joint pairs; lengths are filled per fighter.
export const BONES = [[0, 1], [1, 2], [1, 3], [3, 4], [1, 5], [5, 6], [2, 7], [7, 8], [2, 9], [9, 10]];
// Soft minimum distances that stop the stick figure folding flat: [a, b, fraction of straight length].
const MINS = [[0, 2, 0.9], [1, 7, 0.55], [1, 9, 0.55], [2, 8, 0.45], [2, 10, 0.45], [1, 4, 0.35], [1, 6, 0.35], [7, 9, 0.2], [4, 6, 0.2]];
const NJ = 11;

export class Ragdoll {
  constructor(joints, lens, scale) {
    this.x = new Float32Array(NJ); this.y = new Float32Array(NJ);
    this.vx = new Float32Array(NJ); this.vy = new Float32Array(NJ);
    this.r = new Float32Array(NJ).fill(4 * scale);
    this.r[0] = 9 * scale; this.r[1] = 6 * scale; this.r[2] = 6 * scale;
    for (let i = 0; i < NJ; i++) { this.x[i] = joints[i * 2]; this.y[i] = joints[i * 2 + 1]; }
    this.len = lens;                         // per-bone rest length
    this.alive = BONES.map(() => true);      // false once severed
    this.mins = MINS.map(([a, b, k]) => [a, b, k * this.chain(a, b)]);
    this.rest = 0;          // seconds spent settled
    this.grounded = 0;      // seconds with the torso on the floor
    this.air = true;
    this.bounce = 0.32;
    this.gravScale = 1;
    this.cuts = [];         // [{joint, t}] glowing cut ends
  }

  chain(a, b) {
    // Straight-line length of the bone path between two joints (via the torso).
    const path = { '0,2': [0, 1], '1,7': [1, 6], '1,9': [1, 8], '2,8': [6, 7], '2,10': [8, 9], '1,4': [2, 3], '1,6': [4, 5] }[`${a},${b}`];
    if (!path) return this.len[6] * 2;
    return path.reduce((s, i) => s + this.len[i], 0);
  }

  // Set the whole body moving with one velocity (keeps juggles predictable), with per-joint scatter
  // and a spin about the centre so limbs flail.
  kick(vx, vy, spin = 0, scatter = 90) {
    let cx = 0, cy = 0;
    for (let i = 0; i < NJ; i++) { cx += this.x[i]; cy += this.y[i]; }
    cx /= NJ; cy /= NJ;
    for (let i = 0; i < NJ; i++) {
      this.vx[i] = vx + rand(-scatter, scatter) - (this.y[i] - cy) * spin;
      this.vy[i] = vy + rand(-scatter, scatter) + (this.x[i] - cx) * spin;
    }
    this.rest = 0; this.grounded = 0; this.air = true; this.age = 0;
  }

  sever(bone) {
    if (!this.alive[bone]) return;
    this.alive[bone] = false;
    const [a, b] = BONES[bone];
    this.cuts.push({ joint: a, bone, t: 0 }, { joint: b, bone, t: 0 });
    // Without the spine the two halves need no anti-fold constraints across the cut.
    this.mins = this.mins.filter(([p, q]) => this.connected(p, q));
  }

  connected(a, b) {
    const seen = new Set([a]); const stack = [a];
    while (stack.length) {
      const n = stack.pop();
      if (n === b) return true;
      for (let i = 0; i < BONES.length; i++) {
        if (!this.alive[i]) continue;
        const [p, q] = BONES[i];
        const o = p === n ? q : q === n ? p : -1;
        if (o >= 0 && !seen.has(o)) { seen.add(o); stack.push(o); }
      }
    }
    return false;
  }

  // Returns the hardest floor impact speed this step (0 if none) so the world can add dust and sound;
  // `wallImpact` holds the same for the arena walls.
  step(dt, minX, maxX) {
    if (dt <= 0) return 0;
    const { x, y, vx, vy, r } = this;
    const px = Ragdoll.px, py = Ragdoll.py, pvy = Ragdoll.pvy, pvx = Ragdoll.pvx;
    const g = G * this.gravScale;
    for (let i = 0; i < NJ; i++) {
      vy[i] += g * dt;
      px[i] = x[i]; py[i] = y[i]; pvy[i] = vy[i]; pvx[i] = vx[i];
      x[i] += vx[i] * dt; y[i] += vy[i] * dt;
    }
    let impact = 0, wall = 0;
    const hitG = Ragdoll.hitG; hitG.fill(0);
    for (let it = 0; it < 5; it++) {
      for (let b = 0; b < BONES.length; b++) {
        if (!this.alive[b]) continue;
        const i = BONES[b][0], j = BONES[b][1];
        const dx = x[j] - x[i], dy = y[j] - y[i];
        const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const k = (d - this.len[b]) / d * 0.5;
        x[i] += dx * k; y[i] += dy * k; x[j] -= dx * k; y[j] -= dy * k;
      }
      for (let m = 0; m < this.mins.length; m++) {
        const i = this.mins[m][0], j = this.mins[m][1], min = this.mins[m][2];
        const dx = x[j] - x[i], dy = y[j] - y[i];
        const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
        if (d >= min) continue;
        const k = (d - min) / d * 0.25;
        x[i] += dx * k; y[i] += dy * k; x[j] -= dx * k; y[j] -= dy * k;
      }
      for (let i = 0; i < NJ; i++) {
        if (y[i] > -r[i]) { y[i] = -r[i]; hitG[i] = 1; }
        if (x[i] < minX + r[i]) { x[i] = minX + r[i]; hitG[i] |= 2; }
        else if (x[i] > maxX - r[i]) { x[i] = maxX - r[i]; hitG[i] |= 2; }
      }
    }
    let speed = 0, torsoDown = false;
    const fr = Math.max(0, 1 - 9 * dt);
    for (let i = 0; i < NJ; i++) {
      let nvx = (x[i] - px[i]) / dt, nvy = (y[i] - py[i]) / dt;
      if (hitG[i] & 1) {
        if (pvy[i] > 160) { nvy = -pvy[i] * this.bounce; if (i < 3 && pvy[i] > impact) impact = pvy[i]; }
        else if (nvy > 0) nvy = 0;
        nvx *= fr;
        if (i === 1 || i === 2) torsoDown = true;
      }
      if (hitG[i] & 2) {
        if (Math.abs(pvx[i]) > 200) { nvx = -pvx[i] * 0.45; if (i < 3) wall = Math.max(wall, Math.abs(pvx[i])); }
      }
      vx[i] = nvx * 0.999; vy[i] = nvy;
      speed += Math.abs(nvx) + Math.abs(nvy);
    }
    this.wallImpact = wall;
    // "Down" also covers kneeling or propped-up poses where the torso never quite touches the floor.
    const low = -34 * (r[0] / 9);
    if (y[1] > low || y[2] > low) torsoDown = true;
    this.age += dt;
    this.air = !torsoDown;
    this.grounded = torsoDown ? this.grounded + dt : 0;
    this.rest = (torsoDown || this.age > 3) && speed / NJ < 70 ? this.rest + dt : 0;
    for (const c of this.cuts) c.t += dt;
    return impact;
  }
}
Ragdoll.px = new Float32Array(NJ); Ragdoll.py = new Float32Array(NJ);
Ragdoll.pvx = new Float32Array(NJ); Ragdoll.pvy = new Float32Array(NJ);
Ragdoll.hitG = new Uint8Array(NJ);
