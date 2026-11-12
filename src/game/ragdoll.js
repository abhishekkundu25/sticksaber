// Position-based ragdoll over the same 11 joints the animated skeleton uses, so a fighter can drop
// into physics from any pose and be blended back out of it joint-for-joint.
//
// A dead body can be chopped: a cut splits one bone into two shorter bones with fresh end points, so
// both halves stay visible and fly apart. The first 11 particles are always the original joints.
import { rand } from '../core/math.js';

export const G = 2600;
// [a, b] joint pairs of the intact skeleton; lengths are filled per fighter.
export const BONES = [[0, 1], [1, 2], [1, 3], [3, 4], [1, 5], [5, 6], [2, 7], [7, 8], [2, 9], [9, 10]];
// Soft minimum distances that stop the stick figure folding flat: [a, b, fraction of straight length].
const MINS = [[0, 2, 0.9], [1, 7, 0.55], [1, 9, 0.55], [2, 8, 0.45], [2, 10, 0.45], [1, 4, 0.35], [1, 6, 0.35], [7, 9, 0.2], [4, 6, 0.2]];
const NJ = 11;
export const MAX_CUTS = 8;
const CAP = NJ + MAX_CUTS * 2;

export class Ragdoll {
  constructor(joints, lens, scale) {
    this.n = NJ; // live particle count; grows by two with every cut
    this.x = new Float32Array(CAP); this.y = new Float32Array(CAP);
    this.vx = new Float32Array(CAP); this.vy = new Float32Array(CAP);
    this.r = new Float32Array(CAP).fill(4 * scale);
    this.r[0] = 9 * scale; this.r[1] = 6 * scale; this.r[2] = 6 * scale;
    for (let i = 0; i < NJ; i++) { this.x[i] = joints[i * 2]; this.y[i] = joints[i * 2 + 1]; }
    this.bones = BONES.map(([a, b]) => [a, b]);
    this.len = Array.from(lens);
    this.mins = MINS.map(([a, b, k]) => [a, b, k * this.chain(a, b)]);
    this.rest = 0;          // seconds spent settled
    this.grounded = 0;      // seconds with the torso on the floor
    this.air = true;
    this.bounce = 0.32;
    this.gravScale = 1;
    this.cuts = [];         // [{joint, t}] glowing cut ends
    this.handRoot = 3;      // particle the weapon hand hangs from (the elbow, until that forearm is cut)
    this.age = 0; this.wallImpact = 0;
  }

  get pieces() { return this.cuts.length / 2 + 1; }

  chain(a, b) {
    // Straight-line length of the bone path between two joints (via the torso).
    const path = { '0,2': [0, 1], '1,7': [1, 6], '1,9': [1, 8], '2,8': [6, 7], '2,10': [8, 9], '1,4': [2, 3], '1,6': [4, 5] }[`${a},${b}`];
    if (!path) return this.len[6] * 2;
    return path.reduce((s, i) => s + this.len[i], 0);
  }

  // Set the whole body moving with one velocity (keeps juggles predictable), with per-joint scatter
  // and a spin about the centre so limbs flail.
  kick(vx, vy, spin = 0, scatter = 90) {
    const n = this.n;
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { cx += this.x[i]; cy += this.y[i]; }
    cx /= n; cy /= n;
    for (let i = 0; i < n; i++) {
      this.vx[i] = vx + rand(-scatter, scatter) - (this.y[i] - cy) * spin;
      this.vy[i] = vy + rand(-scatter, scatter) + (this.x[i] - cx) * spin;
    }
    this.rest = 0; this.grounded = 0; this.air = true; this.age = 0;
  }

  // Every particle joined to `start` by bones.
  component(start) {
    const seen = [start];
    for (let k = 0; k < seen.length; k++) {
      const p = seen[k];
      for (const [a, b] of this.bones) {
        const o = a === p ? b : b === p ? a : -1;
        if (o >= 0 && !seen.includes(o)) seen.push(o);
      }
    }
    return seen;
  }

  // Slice the bone nearest to (px, py). The two halves are pushed apart along (ix, iy).
  // Returns the cut point as [x, y], or null if nothing is left worth cutting.
  chop(px, py, ix = 0, iy = 0) {
    if (this.cuts.length >= MAX_CUTS * 2) return null;
    const { x, y, bones, len } = this;
    let best = -1, bd = 1e9, bt = 0.5;
    for (let b = 0; b < bones.length; b++) {
      if (len[b] < 9) continue; // stubs are not cut again
      const i = bones[b][0], j = bones[b][1];
      const dx = x[j] - x[i], dy = y[j] - y[i], l2 = dx * dx + dy * dy || 1;
      let t = ((px - x[i]) * dx + (py - y[i]) * dy) / l2;
      t = t < 0.3 ? 0.3 : t > 0.7 ? 0.7 : t;
      const d = (x[i] + dx * t - px) ** 2 + (y[i] + dy * t - py) ** 2;
      if (d < bd) { bd = d; best = b; bt = t; }
    }
    if (best < 0) return null;
    const i = bones[best][0], j = bones[best][1];
    const cx = x[i] + (x[j] - x[i]) * bt, cy = y[i] + (y[j] - y[i]) * bt;
    const c1 = this.n, c2 = this.n + 1;
    this.n += 2;
    for (const c of [c1, c2]) { x[c] = cx; y[c] = cy; this.vx[c] = this.vx[i] + (this.vx[j] - this.vx[i]) * bt; this.vy[c] = this.vy[i] + (this.vy[j] - this.vy[i]) * bt; this.r[c] = this.r[3]; }
    const L = len[best];
    bones[best][1] = c1; len[best] = L * bt;
    bones.push([c2, j]); len.push(L * (1 - bt));
    if (j === 4 && this.handRoot === i) this.handRoot = c2;
    this.cuts.push({ joint: c1, t: 0 }, { joint: c2, t: 0 });
    // Anti-fold constraints only make sense inside one piece.
    const far = this.component(c2);
    this.mins = this.mins.filter(([p, q]) => far.includes(p) === far.includes(q));
    // Throw the severed piece away from the rest, tumbling.
    const spin = rand(-9, 9);
    for (const p of far) { this.vx[p] += ix - (y[p] - cy) * spin; this.vy[p] += iy + (x[p] - cx) * spin; }
    for (const p of this.component(c1)) { this.vx[p] -= ix * 0.35; this.vy[p] -= iy * 0.2; }
    this.rest = 0; this.age = 0;
    return [cx, cy];
  }

  // Returns the hardest floor impact speed this step (0 if none) so the world can add dust and sound;
  // `wallImpact` holds the same for the arena walls.
  step(dt, minX, maxX) {
    if (dt <= 0) return 0;
    const { x, y, vx, vy, r, bones, len, n } = this;
    const px = Ragdoll.px, py = Ragdoll.py, pvy = Ragdoll.pvy, pvx = Ragdoll.pvx;
    const g = G * this.gravScale;
    for (let i = 0; i < n; i++) {
      vy[i] += g * dt;
      px[i] = x[i]; py[i] = y[i]; pvy[i] = vy[i]; pvx[i] = vx[i];
      x[i] += vx[i] * dt; y[i] += vy[i] * dt;
    }
    let impact = 0, wall = 0;
    const hitG = Ragdoll.hitG; hitG.fill(0);
    for (let it = 0; it < 5; it++) {
      for (let b = 0; b < bones.length; b++) {
        const i = bones[b][0], j = bones[b][1];
        const dx = x[j] - x[i], dy = y[j] - y[i];
        const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const k = (d - len[b]) / d * 0.5;
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
      for (let i = 0; i < n; i++) {
        if (y[i] > -r[i]) { y[i] = -r[i]; hitG[i] = 1; }
        if (x[i] < minX + r[i]) { x[i] = minX + r[i]; hitG[i] |= 2; }
        else if (x[i] > maxX - r[i]) { x[i] = maxX - r[i]; hitG[i] |= 2; }
      }
    }
    let speed = 0, torsoDown = false;
    const fr = Math.max(0, 1 - 9 * dt);
    for (let i = 0; i < n; i++) {
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
    this.rest = (torsoDown || this.age > 3) && speed / n < 70 ? this.rest + dt : 0;
    for (const c of this.cuts) c.t += dt;
    return impact;
  }
}
Ragdoll.px = new Float32Array(CAP); Ragdoll.py = new Float32Array(CAP);
Ragdoll.pvx = new Float32Array(CAP); Ragdoll.pvy = new Float32Array(CAP);
Ragdoll.hitG = new Uint8Array(CAP);
