// Move data. Every attack is a short keyframed pose track plus hit windows; the hit test uses the
// blade that is actually drawn, so what you see is what connects.
//
// Pose channels are in facing-local space (x forward, y up), angles in radians with 0 = forward and
// +PI/2 = straight up. `ha/hr` aim the weapon hand from the shoulder, `bl` is the blade angle.
import { EASE } from '../core/math.js';

export const NAMES = ['py', 'px', 'rot', 'lean', 'head', 'ha', 'hr', 'bl', 'ua', 'la', 'f1x', 'f1y', 'f2x', 'f2y'];
export const N = NAMES.length;
export const C = Object.fromEntries(NAMES.map((n, i) => [n.toUpperCase(), i]));
const IDX = Object.fromEntries(NAMES.map((n, i) => [n, i]));

export const STANCE = { py: 47, px: 0, rot: 0, lean: 0.1, head: 0, ha: -0.55, hr: 0.72, bl: 0.9, ua: -1.95, la: -1.15, f1x: 15, f1y: 0, f2x: -17, f2y: 0 };

// Shared wind-up / strike poses.
const WD = { ha: 1.9, hr: 0.8, bl: 2.6, lean: -0.15, py: 49, ua: -0.6, la: 0.2 };
const SD = { ha: -0.6, hr: 1, bl: -0.75, lean: 0.38, py: 43, f1x: 26, ua: -2.7, la: -2.3 };
const WU = { ha: -1.0, hr: 0.85, bl: -1.4, lean: 0.32, py: 42, ua: -2.4, la: -1.8 };
const SU = { ha: 1.2, hr: 1, bl: 1.9, lean: -0.1, py: 50, f1x: 22, ua: -2.2, la: -2.6 };
const WT = { ha: 0.2, hr: 0.28, bl: 0, lean: -0.05, py: 45, f1x: 8, ua: -0.4, la: 0.3 };
const ST = { ha: -0.05, hr: 1, bl: 0, lean: 0.5, py: 40, f1x: 34, f2x: -26, ua: -2.9, la: -2.9 };
const WO = { ha: 2.1, hr: 0.95, bl: 3.2, lean: -0.32, py: 53, f1x: 10, ua: 1.2, la: 1.9 };
const SO = { ha: -0.75, hr: 1, bl: -1.05, lean: 0.6, py: 36, f1x: 30, ua: -2.4, la: -1.6 };
const AIRLEGS = { f1x: 8, f1y: 20, f2x: -12, f2y: 14 };

// Key-track builders: wind up from `a`, hold, strike lands at `h` after a `sw`-second swing.
const cutDown = (a, h, sw = 0.1) => [[a, WD], [h - sw, { ...WD, bl: 2.75 }], [h, SD, 'in']];
const cutUp = (a, h, sw = 0.1) => [[a, WU], [h - sw, { ...WU, bl: -1.55 }], [h, SU, 'in']];
const thrust = (a, h, sw = 0.09) => [[a, WT], [h - sw, WT], [h, ST, 'in']];
const overhead = (a, h, sw = 0.1) => [[a, WO], [h - sw, { ...WO, bl: 3.35 }], [h, SO, 'in']];

const hit = (t0, t1, dmg, o = {}) => ({ t0, t1, dmg, post: dmg, kx: 220, ky: 0, kind: 'flinch', stop: 0.05, shake: 0.18, stun: 0.3, ...o });

export const MOVES = {
  // ───────────── Player: ground ─────────────
  L1: { fam: 'light', dur: 0.34, cancel: 0.16, next: { light: 'L2', heavy: 'H1F' },
    keys: [...cutDown(0, 0.15, 0.08), [0.34, { ...SD, bl: -0.9 }]],
    hits: [hit(0.07, 0.18, 7, { kx: 150 })], step: [[0.03, 0.14, 300]], ev: [[0.06, 'sfx', 'swingLight']] },
  L2: { fam: 'light', dur: 0.34, cancel: 0.16, next: { light: 'L3', heavy: 'LAUNCH' },
    keys: [...cutUp(0, 0.14, 0.08), [0.34, { ...SU, bl: 2.1 }]],
    hits: [hit(0.06, 0.17, 7, { kx: 150 })], step: [[0.03, 0.13, 280]], ev: [[0.05, 'sfx', 'swingLight']] },
  L3: { fam: 'light', dur: 0.38, cancel: 0.19, next: { light: 'L4', heavy: 'COMET' },
    keys: [...thrust(0, 0.16, 0.08), [0.38, { ...ST, hr: 0.9 }]],
    hits: [hit(0.08, 0.2, 9, { kx: 300, stop: 0.06 })], step: [[0.06, 0.16, 520]], ev: [[0.07, 'sfx', 'swingLight']] },
  L4: { fam: 'light', dur: 0.56, cancel: 0.36, next: {},
    keys: [[0, { ha: 2.2, hr: 0.8, bl: 2.7, lean: -0.2, py: 50 }], [0.1, { ha: 2.3, hr: 0.85, bl: 2.9, lean: -0.25, py: 53 }],
      [0.3, { ha: -3.6, hr: 1, bl: -3.9, lean: 0.45, py: 42, f1x: 28 }, 'in'], [0.56, { ha: -3.8, hr: 0.9, bl: -4.1, lean: 0.3 }]],
    hits: [hit(0.11, 0.33, 15, { kx: 620, ky: -400, kind: 'knock', stop: 0.11, shake: 0.42, post: 22 })],
    step: [[0.08, 0.26, 340]], ev: [[0.1, 'sfx', 'swingSpin']] },

  H1: { fam: 'heavy', dur: 0.64, cancel: 0.4, next: {}, charge: 0.2, tier: 2, armor: [0.05, 0.34],
    keys: [...overhead(0, 0.31, 0.09), [0.64, { ...SO, bl: -1.1, py: 38 }]],
    hits: [hit(0.22, 0.35, 21, { kx: 260, ky: 620, kind: 'spike', stop: 0.12, shake: 0.5, post: 45, guardBreak: true, stun: 0.5 })],
    step: [[0.2, 0.31, 260]], ev: [[0.21, 'sfx', 'swingHeavy'], [0.31, 'fx', 'groundHit']] },
  H1F: { fam: 'heavy', dur: 0.56, cancel: 0.34, next: {}, tier: 2,
    keys: [...overhead(0, 0.2, 0.08), [0.56, { ...SO, bl: -1.1, py: 38 }]],
    hits: [hit(0.11, 0.24, 15, { kx: 240, ky: 560, kind: 'spike', stop: 0.1, shake: 0.42, post: 36, guardBreak: true, stun: 0.45 })],
    step: [[0.1, 0.2, 260]], ev: [[0.1, 'sfx', 'swingHeavy'], [0.2, 'fx', 'groundHit']] },
  LAUNCH: { fam: 'launch', dur: 0.44, cancel: 0.24, next: {}, rise: 0.2,
    keys: [[0, { ha: -1.3, hr: 0.8, bl: -1.9, lean: 0.4, py: 34, f1x: 22 }], [0.1, { ha: -1.4, hr: 0.85, bl: -2.1, lean: 0.45, py: 32 }],
      [0.2, { ha: 1.5, hr: 1, bl: 1.75, lean: -0.2, py: 54 }, 'in'], [0.44, { ha: 1.7, hr: 0.9, bl: 2.1, lean: -0.15 }]],
    hits: [hit(0.1, 0.24, 11, { kx: 50, ky: -900, kind: 'launch', stop: 0.09, shake: 0.32, post: 20 })],
    step: [[0.06, 0.18, 240]], ev: [[0.1, 'sfx', 'swingHeavy']] },
  // Flip-smash finisher: a forward somersault that slams the target into the floor for a bounce.
  COMET: { fam: 'heavy', dur: 0.66, cancel: 0.48, next: {}, tier: 2, armor: [0.05, 0.4],
    keys: [[0, { rot: 0, ha: 2.0, hr: 0.9, bl: 2.6, py: 52, lean: -0.1 }], [0.12, { rot: 1.2, ha: 2.2, hr: 1, bl: 2.4, py: 78, ...AIRLEGS }],
      [0.36, { rot: 6.283, ha: -0.7, hr: 1, bl: -1.0, py: 40, lean: 0.5, f1x: 30, f1y: 0, f2x: -17, f2y: 0 }, 'in'], [0.66, { rot: 6.283, ...SO, py: 38 }]],
    hits: [hit(0.2, 0.4, 20, { kx: 200, ky: 760, kind: 'spike', stop: 0.14, shake: 0.6, post: 40, guardBreak: true })],
    step: [[0.05, 0.34, 330]], ev: [[0.14, 'sfx', 'swingSpin'], [0.36, 'fx', 'groundHit']] },
  DA: { fam: 'light', dur: 0.36, cancel: 0.2, next: { light: 'L2', heavy: 'LAUNCH' },
    keys: [[0, { ha: 2.6, hr: 0.7, bl: 3.0, lean: 0.6, py: 38 }], [0.05, { ha: 2.6, hr: 0.7, bl: 3.1, lean: 0.62, py: 37 }],
      [0.14, { ha: -0.3, hr: 1, bl: -0.4, lean: 0.7, py: 36, f1x: 30 }, 'in'], [0.36, { ha: -0.4, hr: 0.9, bl: -0.6, lean: 0.4 }]],
    hits: [hit(0.05, 0.18, 10, { kx: 260, stop: 0.07, shake: 0.25 })], step: [[0, 0.15, 640]], ev: [[0.04, 'sfx', 'swingLight']] },

  // ───────────── Player: air ─────────────
  A1: { fam: 'air', air: true, dur: 0.3, cancel: 0.15, next: { light: 'A2', heavy: 'AH' },
    keys: [[0, { ...WD, ...AIRLEGS }], [0.06, { ...WD, bl: 2.75 }], [0.13, { ...SD, ...AIRLEGS, py: 47 }, 'in'], [0.3, { ...SD, ...AIRLEGS }]],
    hits: [hit(0.06, 0.17, 7, { kx: 60, ky: -330, kind: 'pop' })], ev: [[0.05, 'sfx', 'swingLight']] },
  A2: { fam: 'air', air: true, dur: 0.3, cancel: 0.15, next: { light: 'A3', heavy: 'AH' },
    keys: [[0, { ...WU, ...AIRLEGS, py: 47 }], [0.06, { ...WU, bl: -1.55 }], [0.13, { ...SU, f1x: 10, f1y: 22, f2x: -10, f2y: 12 }, 'in'], [0.3, { ...SU }]],
    hits: [hit(0.06, 0.17, 7, { kx: 60, ky: -360, kind: 'pop' })], ev: [[0.05, 'sfx', 'swingLight']] },
  A3: { fam: 'air', air: true, dur: 0.42, cancel: 0.3, next: {},
    keys: [[0, { rot: 0, ha: 0.9, hr: 1, bl: 1.2, f1x: 6, f1y: 24, f2x: -8, f2y: 28, py: 47, lean: 0.3 }],
      [0.3, { rot: 6.283, ha: 0.7, hr: 1, bl: 1.0, f1x: 6, f1y: 24, f2x: -8, f2y: 28 }, 'io'], [0.42, { rot: 6.283, ha: -0.4, bl: 0.2 }]],
    hits: [hit(0.04, 0.3, 13, { kx: 420, ky: -520, kind: 'launch', stop: 0.1, shake: 0.35, post: 18 })], ev: [[0.04, 'sfx', 'swingSpin']] },
  AH: { fam: 'spike', air: true, dur: 0.46, cancel: 0.34, next: {}, tier: 2,
    keys: [[0, { ...WO, ...AIRLEGS }], [0.14, { ...WO, bl: 3.35, f1x: 2, f1y: 26, f2x: -14, f2y: 22 }], [0.23, { ...SO, py: 47, f1x: 18, f1y: 8, f2x: -12, f2y: 20 }, 'in'], [0.46, { ...SO, py: 47 }]],
    hits: [hit(0.14, 0.27, 16, { kx: 140, ky: 1250, kind: 'spike', stop: 0.12, shake: 0.5, post: 30, guardBreak: true })], ev: [[0.13, 'sfx', 'swingHeavy']] },
  PLUNGE: { fam: 'spike', air: true, dur: 9, cancel: 9, next: {}, tier: 2, plunge: true,
    keys: [[0, { ha: 1.6, hr: 0.6, bl: -1.57, lean: 0.05, f1x: -4, f1y: 30, f2x: -14, f2y: 36, ua: 1.4, la: 1.2 }], [0.14, { ha: -1.5, hr: 0.75, bl: -1.57, lean: 0.12, f1x: -6, f1y: 34, f2x: -16, f2y: 40 }]],
    hits: [hit(0.14, 9, 9, { kx: 60, ky: 1300, kind: 'spike', stop: 0.07, post: 20, guardBreak: true })], ev: [[0.02, 'sfx', 'swingHeavy']] },
  PLUNGE_LAND: { fam: 'spike', dur: 0.4, cancel: 0.26, next: {}, tier: 2,
    keys: [[0, { ha: -1.3, hr: 0.7, bl: -1.57, lean: 0.5, py: 26, f1x: 24, f2x: -24 }], [0.24, { ha: -1.3, hr: 0.7, bl: -1.5, lean: 0.5, py: 28 }], [0.4, { py: 44 }]],
    hits: [{ ...hit(0, 0.07, 10, { kx: 160, ky: -560, kind: 'launch', stop: 0.12, shake: 0.6, post: 30 }), shape: 'circle', ox: 0, oy: -20, r: 135 }] },

  THROW: { fam: 'throw', dur: 0.32, cancel: 0.2, next: {},
    keys: [[0, { ha: 2.4, hr: 0.8, bl: 2.8, lean: -0.2 }], [0.09, { ha: 2.5, hr: 0.85, bl: 3.0, lean: -0.25 }], [0.16, { ha: -0.2, hr: 1, bl: 0.2, lean: 0.4 }, 'in'], [0.32, { ha: -0.3, hr: 0.9 }]],
    hits: [], ev: [[0.13, 'spawn', 'saber'], [0.12, 'sfx', 'throw']] },
  // Counter after a parry: a pass-through draw cut. Invulnerable throughout.
  RIPOSTE: { fam: 'riposte', dur: 0.5, cancel: 0.3, next: {}, tier: 3, invuln: [0, 0.4],
    keys: [[0, { ha: -2.6, hr: 0.6, bl: 3.3, lean: 0.5, py: 36 }], [0.06, { ha: -2.6, hr: 0.6, bl: 3.35, lean: 0.55, py: 35 }],
      [0.13, { ha: 0.1, hr: 1, bl: 0.15, lean: 0.75, py: 34, f1x: 34, f2x: -30 }, 'in'], [0.5, { ha: 0.3, hr: 1, bl: 0.5, lean: 0.4, py: 40 }]],
    hits: [hit(0.06, 0.22, 45, { kx: 420, ky: -260, kind: 'knock', stop: 0.16, shake: 0.6, post: 45, sweepBody: true, unblockable: true })],
    step: [[0.06, 0.19, 1700]], ev: [[0.05, 'sfx', 'swingSpin'], [0.06, 'fx', 'riposteLine']] },

  // ───────────── Initiate ─────────────
  i_slash: { dur: 1.0, keys: [...cutDown(0, 0.56), [1.0, SD]], hits: [hit(0.45, 0.6, 9, { post: 22, kx: 260 })],
    step: [[0.4, 0.55, 260]], ev: [[0.24, 'tele', 0], [0.44, 'sfx', 'swingLight']], punish: [0.6, 1.0] },
  i_combo: { dur: 1.45, keys: [...cutDown(0, 0.52), ...cutUp(0.6, 0.92), [1.45, SU]],
    hits: [hit(0.42, 0.56, 8, { post: 18 }), hit(0.82, 0.96, 8, { post: 18, kx: 300 })],
    step: [[0.38, 0.52, 240], [0.78, 0.92, 240]], ev: [[0.2, 'tele', 0], [0.66, 'tele', 0], [0.41, 'sfx', 'swingLight'], [0.81, 'sfx', 'swingLight']], punish: [0.96, 1.45] },
  i_leap: { dur: 1.25, keys: [[0, { py: 32, lean: 0.35, ...WO }], [0.34, { py: 30, ...WO }], [0.4, { ...WO, ...AIRLEGS, py: 47 }], [0.74, { ...WO, bl: 3.3, ...AIRLEGS }], [0.84, { ...SO, f1y: 0, f2y: 0 }, 'in'], [1.25, SO]],
    hits: [hit(0.73, 0.9, 12, { post: 28, kx: 320, kind: 'knock', ky: -220 })], ev: [[0.36, 'leap', [330, -700]], [0.3, 'tele', 0], [0.72, 'sfx', 'swingHeavy']], punish: [0.9, 1.25] },

  // ───────────── Bulwark ─────────────
  b_bash: { dur: 1.05, armor: [0.1, 0.6], keys: [[0, { lean: -0.1, px: -6, ua: 0.2, la: 0.9 }], [0.42, { lean: -0.15, px: -10, ua: 0.3, la: 1.0 }], [0.52, { lean: 0.45, px: 12, ua: -0.1, la: 0.1, f1x: 30 }, 'in'], [1.05, { lean: 0.2 }]],
    hits: [{ ...hit(0.44, 0.6, 8, { post: 30, kx: 620, stun: 0.4, shake: 0.3 }), shape: 'circle', ox: 44, oy: -62, r: 40 }],
    step: [[0.42, 0.56, 480]], ev: [[0.2, 'tele', 0], [0.43, 'sfx', 'dash']], punish: [0.6, 1.05] },
  b_over: { dur: 1.5, armor: [0.2, 0.9], keys: [...overhead(0, 0.82, 0.11), [1.5, SO]],
    hits: [hit(0.7, 0.86, 16, { post: 38, kx: 360, ky: -260, kind: 'knock', stop: 0.1, shake: 0.4 })],
    step: [[0.66, 0.8, 280]], ev: [[0.45, 'tele', 0], [0.7, 'sfx', 'swingHeavy'], [0.82, 'fx', 'groundHit']], punish: [0.86, 1.5] },

  // ───────────── Duelist (double-bladed staff) ─────────────
  d_flurry: { dur: 1.5, armor: [0, 0.8], keys: [[0, { lean: 0.5, py: 38, ha: -2.4, hr: 0.7, bl: 2.9 }], [0.18, { lean: 0.55, py: 38, ha: -2.4, hr: 0.7, bl: 2.9 }],
      [0.3, { ...SD, bl: -0.5 }, 'in'], [0.42, { ...WU }], [0.52, { ...SU, bl: 2.2 }, 'in'], [0.64, { ha: 1.0, hr: 0.8, bl: 2.4 }], [0.76, { ha: -0.4, hr: 1, bl: -3.6, lean: 0.4 }, 'in'], [1.5, { ha: -0.5, hr: 0.8, bl: -3.9, lean: 0.25 }]],
    hits: [hit(0.22, 0.33, 6, { post: 14, kx: 120 }), hit(0.44, 0.55, 6, { post: 14, kx: 120 }), hit(0.66, 0.8, 9, { post: 20, kx: 380 })],
    step: [[0.02, 0.2, 620], [0.42, 0.52, 200], [0.64, 0.76, 240]], ev: [[0.02, 'tele', 0], [0.02, 'sfx', 'dash'], [0.22, 'sfx', 'swingLight'], [0.44, 'sfx', 'swingLight'], [0.66, 'sfx', 'swingSpin']], punish: [0.8, 1.5] },
  d_spin: { dur: 1.7, armor: [0.3, 1.0], keys: [[0, { ha: 0.3, hr: 0.5, bl: 1.57, py: 44, lean: -0.1 }], [0.55, { ha: 0.2, hr: 0.6, bl: 1.2, py: 40 }],
      [1.0, { ha: 0, hr: 0.8, bl: -17.6, py: 42, lean: 0.15 }, 'lin'], [1.7, { ha: -0.4, hr: 0.7, bl: -18.0, lean: 0.3 }]],
    hits: [hit(0.58, 1.02, 15, { post: 30, kx: 460, ky: -320, kind: 'knock', unblockable: true, stop: 0.1, shake: 0.4 })],
    step: [[0.58, 1.0, 330]], ev: [[0.08, 'tele', 1], [0.56, 'sfx', 'swingSpin'], [0.78, 'sfx', 'swingSpin']], punish: [1.02, 1.7] },
  d_counter: { dur: 0.95, armor: [0, 0.45], keys: [...cutUp(0, 0.4, 0.09), [0.95, SU]], hits: [hit(0.3, 0.44, 11, { post: 24, kx: 380, ky: -240, kind: 'knock' })],
    step: [[0.26, 0.4, 420]], ev: [[0.08, 'tele', 0], [0.3, 'sfx', 'swingLight']], punish: [0.44, 0.95] },

  // ───────────── Marksman ─────────────
  m_shot: { dur: 1.3, aim: [0.05, 0.62], keys: [[0, { ha: 0, hr: 0.9, bl: 0, lean: 0.08, py: 42, ua: -0.2, la: 0.1, f1x: 22, f2x: -22 }], [0.72, { ha: 0, hr: 0.9, bl: 0, py: 41 }], [0.78, { ha: 0.15, hr: 0.7, bl: 0.2, lean: -0.1 }], [1.3, { ha: 0, hr: 0.85, bl: 0 }]],
    hits: [], ev: [[0.72, 'spawn', 'bolt'], [0.4, 'tele', 0]], punish: [0.78, 1.3] },
  m_kick: { dur: 0.8, keys: [[0, { lean: -0.25, f1x: 6, f1y: 22, py: 46 }], [0.3, { lean: -0.3, f1x: 4, f1y: 26 }], [0.38, { lean: -0.4, f1x: 44, f1y: 34, px: 4 }, 'in'], [0.8, {}]],
    hits: [{ ...hit(0.31, 0.44, 5, { post: 18, kx: 560 }), shape: 'circle', ox: 40, oy: -40, r: 30 }], ev: [[0.14, 'tele', 0], [0.3, 'sfx', 'dash']], punish: [0.44, 0.8] },

  // ───────────── Brute ─────────────
  br_swing: { dur: 1.75, keys: [[0, { ha: 2.6, hr: 0.9, bl: 3.0, lean: -0.1, py: 46 }], [0.72, { ha: 2.7, hr: 1, bl: 3.3, lean: -0.2, py: 47 }], [0.88, { ha: -0.5, hr: 1, bl: -0.7, lean: 0.5, py: 40, f1x: 30 }, 'in'], [1.75, { ha: -0.6, hr: 0.9, bl: -0.9, lean: 0.4 }]],
    hits: [hit(0.72, 0.93, 20, { post: 55, kx: 520, ky: -300, kind: 'knock', stop: 0.12, shake: 0.5 })],
    step: [[0.66, 0.86, 300]], ev: [[0.36, 'tele', 0], [0.7, 'sfx', 'swingHeavy']], punish: [0.93, 1.75] },
  br_smash: { dur: 2.3, keys: [...overhead(0, 1.02, 0.1), [2.3, { ...SO, py: 34 }]],
    hits: [hit(0.9, 1.06, 28, { post: 60, kx: 480, ky: -420, kind: 'knock', unblockable: true, stop: 0.14, shake: 0.7 })],
    step: [[0.88, 1.0, 200]], ev: [[0.3, 'tele', 1], [0.9, 'sfx', 'swingHeavy'], [1.02, 'fx', 'groundHit'], [1.03, 'spawn', 'waves']], punish: [1.06, 2.3] },

  // Shoulder charge: runs until it meets the player or a wall. Hitting a wall stuns it.
  br_charge: { dur: 2.3, run: 0.72, keys: [[0, { lean: 0.5, py: 36, ha: -2.4, hr: 0.8, bl: 3.1, ua: 0.2, la: 1.2 }], [0.7, { lean: 0.6, py: 34, ha: -2.5, hr: 0.8, bl: 3.2, ua: 0.3, la: 1.3 }], [2.0, { lean: 0.6, py: 38, ha: -2.5, hr: 0.8, bl: 3.2, ua: 0.3, la: 1.3 }], [2.3, { lean: 0.2 }]],
    hits: [{ ...hit(0.72, 2.0, 22, { post: 50, kx: 620, ky: -380, kind: 'knock', unblockable: true, stop: 0.13, shake: 0.6 }), shape: 'circle', ox: 26, oy: -62, r: 34 }],
    step: [[0.72, 2.0, 720]], ev: [[0.1, 'tele', 1], [0.7, 'sfx', 'dash']], punish: [2.0, 2.3] },

  // ───────────── Second attacks for the first five ─────────────
  // Feint: twitches as if to strike, holds, then strikes late. Punishes parrying on the first tell.
  i_feint: { dur: 1.55, keys: [[0, WD], [0.36, { ...WD, bl: 2.75 }], [0.44, { ...WD, bl: 2.0, lean: 0.05, ha: 1.5 }], [0.56, { ...WD, bl: 2.7 }], [0.9, { ...WD, bl: 2.8 }], [1.0, SD, 'in'], [1.55, SD]],
    hits: [hit(0.88, 1.04, 11, { post: 26, kx: 280 })], step: [[0.84, 0.98, 280]], ev: [[0.66, 'tele', 0], [0.88, 'sfx', 'swingLight']], punish: [1.04, 1.55] },
  i_lunge: { dur: 1.2, keys: [...thrust(0, 0.62), [1.2, ST]], hits: [hit(0.52, 0.66, 10, { post: 22, kx: 300 })],
    step: [[0.5, 0.62, 620]], ev: [[0.26, 'tele', 0], [0.5, 'sfx', 'thrust']], punish: [0.66, 1.2] },
  // Shield ram: walks you down behind the shield. Parry it, jump it, or get out of the way.
  b_charge: { dur: 1.8, run: 0.5, armor: [0.25, 1.3], keys: [[0, { lean: -0.1, px: -8, ua: 0.1, la: 0.8, py: 42 }], [0.46, { lean: -0.12, px: -10, ua: 0.15, la: 0.9, py: 40 }], [0.56, { lean: 0.4, px: 10, ua: -0.05, la: 0.3 }], [1.3, { lean: 0.4, px: 10, ua: -0.05, la: 0.3 }], [1.8, { lean: 0.15 }]],
    hits: [{ ...hit(0.5, 1.28, 10, { post: 34, kx: 640, stun: 0.45, shake: 0.35 }), shape: 'circle', ox: 44, oy: -62, r: 42 }],
    step: [[0.5, 1.28, 350]], ev: [[0.14, 'tele', 0], [0.5, 'sfx', 'dash']], punish: [1.28, 1.8] },
  d_dive: { dur: 1.3, armor: [0, 0.6], keys: [[0, { py: 32, lean: 0.3, ...WO }], [0.22, { py: 30, ...WO }], [0.3, { ...WO, ...AIRLEGS, py: 47 }], [0.62, { ...WO, bl: 3.3, ...AIRLEGS }], [0.74, { ...SO, f1y: 0, f2y: 0 }, 'in'], [1.3, SO]],
    hits: [hit(0.6, 0.82, 12, { post: 26, kx: 360, ky: -240, kind: 'knock' })], ev: [[0.24, 'leapAt', [-780, 620]], [0.1, 'tele', 0], [0.6, 'sfx', 'swingSpin']], punish: [0.82, 1.3] },
  // Staff throw: a spinning disc that goes out and comes back. The Duelist is unarmed until it returns.
  d_throw: { dur: 0.9, keys: [[0, { ha: 2.4, hr: 0.8, bl: 2.8, lean: -0.2 }], [0.26, { ha: 2.5, hr: 0.85, bl: 3.0, lean: -0.25 }], [0.34, { ha: -0.2, hr: 1, bl: 0.2, lean: 0.4 }, 'in'], [0.9, { ha: -0.3, hr: 0.9 }]],
    hits: [], ev: [[0.06, 'tele', 0], [0.3, 'spawn', 'disc'], [0.3, 'sfx', 'throw']], punish: [0.34, 0.9] },
  m_burst: { dur: 1.8, aim: [0.05, 0.7], keys: [[0, { ha: 0, hr: 0.9, bl: 0, lean: 0.08, py: 42, ua: -0.2, la: 0.1, f1x: 22, f2x: -22 }], [1.12, { ha: 0, hr: 0.9, bl: 0, py: 41 }], [1.2, { ha: 0.15, hr: 0.7, bl: 0.2, lean: -0.1 }], [1.8, { ha: 0, hr: 0.85, bl: 0 }]],
    hits: [], ev: [[0.8, 'spawn', 'bolt'], [0.95, 'spawn', 'bolt'], [1.1, 'spawn', 'bolt'], [0.45, 'tele', 0]], punish: [1.15, 1.8] },
  m_lob: { dur: 1.35, keys: [[0, { ua: -2.6, la: -2.9, lean: -0.15, py: 44 }], [0.45, { ua: -2.9, la: -3.0, lean: -0.25, py: 43 }], [0.56, { ua: 0.9, la: 0.6, lean: 0.3 }, 'in'], [1.35, { ua: -0.4, la: 0 }]],
    hits: [], ev: [[0.14, 'tele', 1], [0.54, 'spawn', 'lob'], [0.54, 'sfx', 'lob']], punish: [0.6, 1.35] },
  // Leap slam: jumps to where you are standing. The landing is `br_land`.
  br_leap: { dur: 3, landMove: 'br_land', keys: [[0, { py: 30, lean: 0.4, ...WO }], [0.5, { py: 28, ...WO }], [0.58, { ...WO, ...AIRLEGS, py: 47 }], [3, { ...WO, bl: 3.3, ...AIRLEGS }]],
    hits: [], ev: [[0.08, 'tele', 1], [0.52, 'leapAt', [-1000, 700]], [0.5, 'sfx', 'jump']] },
  br_land: { dur: 1.5, keys: [[0, { ...SO, py: 28, bl: -1.3 }], [1.0, { ...SO, py: 30, bl: -1.3 }], [1.5, {}]],
    hits: [{ ...hit(0, 0.1, 22, { post: 50, kx: 500, ky: -420, kind: 'knock', unblockable: true, stop: 0.14, shake: 0.7 }), shape: 'circle', ox: 20, oy: -30, r: 92 }],
    ev: [[0, 'fx', 'groundHit'], [0.02, 'spawn', 'waves']], punish: [0.15, 1.5] },
  // Low sweep along the floor: jump it, block it or parry it.
  br_sweep: { dur: 1.6, keys: [[0, { py: 36, lean: 0.4, ha: -2.2, hr: 0.9, bl: -2.8 }], [0.58, { py: 33, lean: 0.45, ha: -2.3, hr: 1, bl: -2.9 }], [0.76, { py: 32, lean: 0.55, ha: -0.9, hr: 1, bl: -0.35, f1x: 30 }, 'in'], [1.6, { py: 36, lean: 0.4, ha: -0.9, bl: -0.4 }]],
    hits: [{ ...hit(0.6, 0.8, 16, { post: 42, kx: 420, ky: -340, kind: 'knock', stop: 0.1, shake: 0.4 }), shape: 'low', ox: 75, r: 125 }],
    step: [[0.56, 0.74, 200]], ev: [[0.26, 'tele', 0], [0.6, 'sfx', 'swingHeavy']], punish: [0.8, 1.6] },

  // ───────────── Lancer ─────────────
  ln_thrust: { dur: 1.3, keys: [...thrust(0, 0.6), [1.3, ST]], hits: [hit(0.5, 0.65, 13, { post: 28, kx: 380 })],
    step: [[0.5, 0.6, 320]], ev: [[0.24, 'tele', 0], [0.5, 'sfx', 'thrust']], punish: [0.65, 1.3] },
  ln_double: { dur: 1.75, keys: [...thrust(0, 0.56), [0.7, WT], [0.94, WT], [1.02, ST, 'in'], [1.75, ST]],
    hits: [hit(0.46, 0.6, 10, { post: 22, kx: 240 }), hit(0.94, 1.07, 12, { post: 26, kx: 400 })],
    step: [[0.46, 0.56, 300], [0.94, 1.02, 340]], ev: [[0.22, 'tele', 0], [0.76, 'tele', 0], [0.46, 'sfx', 'thrust'], [0.94, 'sfx', 'thrust']], punish: [1.07, 1.75] },
  // Anti-air: skewers a jump-in. The answer is to come in along the floor.
  ln_skewer: { dur: 1.05, keys: [[0, { ha: -0.9, hr: 0.35, bl: 0.95, lean: -0.1, py: 42 }], [0.24, { ha: -0.9, hr: 0.32, bl: 0.95, lean: -0.12, py: 41 }], [0.32, { ha: 0.95, hr: 1, bl: 0.95, lean: -0.3, py: 52 }, 'in'], [1.05, { ha: 0.9, hr: 0.9, bl: 0.9 }]],
    hits: [hit(0.24, 0.4, 12, { post: 20, kx: 320, ky: -280, kind: 'knock' })], ev: [[0.02, 'tele', 0], [0.24, 'sfx', 'thrust']], punish: [0.4, 1.05] },
  ln_shove: { dur: 0.85, keys: [[0, { lean: -0.2, ua: -0.3, la: 0.6 }], [0.32, { lean: -0.25, ua: -0.4, la: 0.7 }], [0.4, { lean: 0.35, ua: 0.1, la: 0.1, px: 8 }, 'in'], [0.85, {}]],
    hits: [{ ...hit(0.33, 0.46, 5, { post: 18, kx: 620 }), shape: 'circle', ox: 40, oy: -66, r: 34 }], ev: [[0.12, 'tele', 0], [0.32, 'sfx', 'dash']], punish: [0.46, 0.85] },

  // ───────────── Wraith ─────────────
  w_slash: { dur: 0.95, keys: [...cutUp(0, 0.38, 0.09), [0.95, SU]], hits: [hit(0.28, 0.43, 13, { post: 26, kx: 300 })],
    step: [[0.26, 0.38, 300]], ev: [[0.02, 'tele', 0], [0.28, 'sfx', 'swingLight']], punish: [0.43, 0.95] },
  w_cross: { dur: 1.3, keys: [...cutDown(0, 0.38, 0.09), ...cutUp(0.46, 0.7, 0.09), [1.3, SU]],
    hits: [hit(0.28, 0.42, 9, { post: 20, kx: 160 }), hit(0.6, 0.74, 11, { post: 24, kx: 340 })],
    step: [[0.26, 0.38, 280], [0.58, 0.7, 240]], ev: [[0.02, 'tele', 0], [0.46, 'tele', 0], [0.28, 'sfx', 'swingLight'], [0.6, 'sfx', 'swingLight']], punish: [0.74, 1.3] },

  // ───────────── Drone ─────────────
  dr_shot: { dur: 1.2, aim: [0.05, 0.6], aimRange: [-1.35, 0.3], keys: [[0, { ha: -0.6, hr: 0.6, bl: -0.6 }], [1.2, { ha: -0.6, hr: 0.6, bl: -0.6 }]],
    hits: [], ev: [[0.7, 'spawn', 'bolt'], [0.35, 'tele', 0]], punish: [0.75, 1.2] },

  // ───────────── The Forgemaster (mid-boss) ─────────────
  // Its hammer heats through the string: cool and warm swings can be parried, the white-hot third
  // cannot, and after it the hammer vents. The vent is the opening.
  fm_string: { dur: 3.7, keys: [...cutDown(0, 0.64, 0.11), ...cutUp(0.74, 1.2, 0.11), ...overhead(1.3, 2.0, 0.11), [3.7, { ...SO, py: 32 }]],
    hits: [hit(0.52, 0.68, 14, { post: 30, kx: 300, stop: 0.09, shake: 0.35 }), hit(1.08, 1.24, 14, { post: 30, kx: 300, stop: 0.09, shake: 0.35 }),
      hit(1.88, 2.05, 26, { post: 60, kx: 520, ky: -400, kind: 'knock', unblockable: true, stop: 0.15, shake: 0.8 })],
    step: [[0.46, 0.64, 320], [1.02, 1.2, 300], [1.82, 2.0, 360]],
    ev: [[0.05, 'heat', 1], [0.26, 'tele', 0], [0.52, 'sfx', 'swingHeavy'], [0.72, 'heat', 2], [0.84, 'tele', 0], [1.08, 'sfx', 'swingHeavy'], [1.28, 'heat', 3], [1.5, 'tele', 1], [1.88, 'sfx', 'swingHeavy'],
      [2.0, 'fx', 'hammer'], [2.02, 'spawn', 'waveFwd'], [2.06, 'vent', 0]], punish: [2.06, 3.7] },
  fm_quake: { dur: 2.7, keys: [...overhead(0, 1.02, 0.11), [2.7, { ...SO, py: 32 }]],
    hits: [hit(0.9, 1.07, 24, { post: 60, kx: 500, ky: -420, kind: 'knock', unblockable: true, stop: 0.15, shake: 0.8 })],
    step: [[0.86, 1.0, 220]], ev: [[0.1, 'heat', 3], [0.3, 'tele', 1], [0.9, 'sfx', 'swingHeavy'], [1.02, 'fx', 'hammer'], [1.03, 'spawn', 'waves'], [1.08, 'vent', 0]], punish: [1.08, 2.7] },
  fm_ember: { dur: 1.4, keys: [...cutUp(0, 0.56, 0.1), [1.4, SU]], hits: [], ev: [[0.05, 'heat', 2], [0.2, 'tele', 1], [0.5, 'sfx', 'lob'], [0.52, 'spawn', 'embers'], [0.9, 'heat', 0]], punish: [0.6, 1.4] },
  fm_erupt: { dur: 1.9, keys: [[0, WO], [0.4, { ...WO, bl: 3.35 }], [0.5, { ...SO, py: 30, bl: -1.4 }, 'in'], [1.9, { ...SO, py: 32, bl: -1.4 }]],
    hits: [], ev: [[0.05, 'heat', 3], [0.1, 'tele', 1], [0.5, 'fx', 'hammer'], [0.52, 'spawn', 'pillars'], [0.6, 'vent', 0]], punish: [0.6, 1.9] },

  // ───────────── The Proctor (boss) ─────────────
  p_verdict: { dur: 2.2, keys: [...cutDown(0, 0.5), ...cutUp(0.58, 0.86), ...overhead(0.96, 1.56, 0.1), [2.2, SO]],
    hits: [hit(0.4, 0.54, 10, { post: 20, kx: 240 }), hit(0.76, 0.9, 10, { post: 20, kx: 240 }), hit(1.44, 1.6, 18, { post: 38, kx: 520, ky: -320, kind: 'knock', stop: 0.12, shake: 0.5 })],
    step: [[0.34, 0.5, 380], [0.72, 0.86, 320], [1.4, 1.56, 440]],
    ev: [[0.18, 'tele', 0], [0.6, 'tele', 0], [1.22, 'tele', 0], [0.4, 'sfx', 'swingLight'], [0.76, 'sfx', 'swingLight'], [1.44, 'sfx', 'swingHeavy'], [1.56, 'fx', 'groundHit']], punish: [1.6, 2.2] },
  p_lunge: { dur: 1.85, line: [0.1, 0.72], keys: [[0, { ...WT, py: 40, lean: 0.2 }], [0.7, { ...WT, py: 38, lean: 0.25 }], [0.78, ST, 'in'], [1.85, { ...ST, hr: 0.85 }]],
    hits: [hit(0.7, 0.92, 22, { post: 50, kx: 560, ky: -360, kind: 'knock', unblockable: true, stop: 0.13, shake: 0.6, sweepBody: true })],
    step: [[0.7, 0.88, 1500]], ev: [[0.1, 'tele', 1], [0.69, 'sfx', 'dash'], [0.7, 'sfx', 'swingHeavy']], punish: [0.92, 1.85] },
  p_crescent: { dur: 1.15, keys: [...cutUp(0, 0.56, 0.1), [1.15, SU]], hits: [],
    ev: [[0.22, 'tele', 0], [0.5, 'sfx', 'swingHeavy'], [0.54, 'spawn', 'crescent']], punish: [0.6, 1.15] },
  p_cyclone: { dur: 2.0, armor: [0.2, 1.3], keys: [[0, { ha: 0.3, hr: 0.5, bl: 1.57, py: 44, lean: -0.1 }], [0.28, { ha: 0.2, hr: 0.6, bl: 1.3, py: 42 }],
      [1.28, { ha: 0, hr: 0.85, bl: -30, py: 43, lean: 0.2 }, 'lin'], [2.0, { ha: -0.4, hr: 0.7, bl: -30.4, lean: 0.3 }]],
    hits: [0.3, 0.5, 0.7, 0.9, 1.1].map((t, i) => hit(t, t + 0.16, i === 4 ? 12 : 6, { post: 16, kx: i === 4 ? 480 : 140, ky: i === 4 ? -300 : 0, kind: i === 4 ? 'knock' : 'flinch' })),
    step: [[0.28, 1.26, 300]], ev: [[0.04, 'tele', 0], [0.3, 'sfx', 'swingSpin'], [0.62, 'sfx', 'swingSpin'], [0.94, 'sfx', 'swingSpin']], punish: [1.3, 2.0] },
  p_counter: { dur: 1.0, armor: [0, 0.5], keys: [...cutDown(0, 0.46, 0.09), [1.0, SD]], hits: [hit(0.36, 0.5, 14, { post: 30, kx: 440, ky: -260, kind: 'knock', stop: 0.1 })],
    step: [[0.3, 0.46, 460]], ev: [[0.1, 'tele', 0], [0.36, 'sfx', 'swingHeavy']], punish: [0.5, 1.0] },
  p_slam: { dur: 1.5, keys: [[0, { ...SO, py: 26, bl: -1.4 }], [1.1, { ...SO, py: 28, bl: -1.4 }], [1.5, {}]],
    hits: [{ ...hit(0, 0.1, 26, { post: 60, kx: 520, ky: -460, kind: 'knock', unblockable: true, stop: 0.15, shake: 0.8 }), shape: 'circle', ox: 0, oy: -30, r: 105 }],
    ev: [[0.0, 'fx', 'groundHit'], [0.02, 'spawn', 'waves']], punish: [0.15, 1.5] },
};

for (const id in MOVES) {
  const m = MOVES[id];
  m.id = id;
  m.fam ??= 'enemy';
  m.hits ??= []; m.ev ??= []; m.step ??= [];
  m.k = m.keys.map(([t, o, e]) => {
    const a = new Float32Array(N).fill(NaN);
    for (const key in o) a[IDX[key]] = o[key];
    return { t, a, e: EASE[e || 'io'] };
  });
  for (let i = 1; i < m.k.length; i++) {
    for (let c = 0; c < N; c++) if (Number.isNaN(m.k[i].a[c])) m.k[i].a[c] = m.k[i - 1].a[c];
  }
}

// Write the move's pose at time t over `tgt`, which the caller pre-fills with the fighter's stance.
export function sampleMove(m, t, tgt) {
  const k = m.k;
  let i = 0;
  while (i < k.length - 2 && t >= k[i + 1].t) i++;
  const a = k[i], b = k[i + 1] || a;
  let u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  u = b.e(u);
  for (let c = 0; c < N; c++) {
    const vb = b.a[c];
    if (Number.isNaN(vb)) continue;
    const va = Number.isNaN(a.a[c]) ? tgt[c] : a.a[c];
    tgt[c] = va + (vb - va) * u;
  }
}

export function fillStance(tgt, stance) {
  for (let c = 0; c < N; c++) tgt[c] = stance[c];
}
export function makeStance(over = {}) {
  const s = new Float32Array(N);
  for (let c = 0; c < N; c++) s[c] = over[NAMES[c]] ?? STANCE[NAMES[c]];
  return s;
}
