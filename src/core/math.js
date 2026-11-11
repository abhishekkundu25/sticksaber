export const PI = Math.PI;
export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sign = (v) => (v < 0 ? -1 : 1);
// All simulation randomness flows through one seedable generator (mulberry32), so a run can be
// replayed from its seed and tests are deterministic.
let state = (Date.now() ^ 0x9e3779b9) >>> 0;
export function seedRng(seed) { state = (seed >>> 0) || 1; }
export function rng() {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
// An independent generator, for content generation that must not disturb the simulation stream.
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash32 = (a, b) => { let h = Math.imul(a ^ 0x85ebca6b, 0xc2b2ae35) ^ Math.imul(b + 0x27d4eb2f, 0x165667b1); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); return (h ^ (h >>> 13)) >>> 0; };
export const rand = (a = 1, b) => (b === undefined ? rng() * a : a + rng() * (b - a));
export const randSign = () => (rng() < 0.5 ? -1 : 1);
export const pick = (arr) => arr[(rng() * arr.length) | 0];
export const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));

export const EASE = {
  lin: (t) => t,
  io: (t) => t * t * (3 - 2 * t),
  in: (t) => t * t * t,
  out: (t) => 1 - (1 - t) ** 3,
  back: (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2,
};

// Shift `a` by whole turns so it lands within half a turn of `ref` (keeps springs from unwinding spins).
export const wrapNear = (a, ref) => a + TAU * Math.round((ref - a) / TAU);

export function distPointSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t - px, cy = ay + dy * t - py;
  return Math.sqrt(cx * cx + cy * cy);
}

// Two-bone IK. Writes the middle joint and the (reach-clamped) end point into `out` as [jx, jy, ex, ey].
export function ik2(ax, ay, tx, ty, l1, l2, bend, out) {
  let dx = tx - ax, dy = ty - ay;
  let d = Math.sqrt(dx * dx + dy * dy) || 0.0001;
  const max = l1 + l2 - 0.01, min = Math.abs(l1 - l2) + 0.01;
  const dc = d > max ? max : d < min ? min : d;
  dx /= d; dy /= d;
  const a = Math.atan2(dy, dx);
  const A = Math.acos(clamp((l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc), -1, 1));
  out[0] = ax + Math.cos(a + bend * A) * l1;
  out[1] = ay + Math.sin(a + bend * A) * l1;
  out[2] = ax + dx * dc;
  out[3] = ay + dy * dc;
  return out;
}

// Cheap smooth 1D value noise for camera shake.
export function noise1(x) {
  const i = Math.floor(x), f = x - i;
  const h = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  return lerp(h(i), h(i + 1), f * f * (3 - 2 * f)) * 2 - 1;
}
