// Weapon forms: the blade the player commits to for a run. Each has its own blade, its own damage
// and run speed, and its own move for each of the player's entry slots. Everything after an entry
// move is reached through that move's own `next`.
//
// Pose channels are the ones in moves.js: `ha/hr/bl` aim the weapon hand and its blade, `ua/la` aim
// the off arm. A twin form's second blade runs on from the off forearm (`la` plus `twinAngle`), so
// its off-hand cuts are animated with `ua/la`.
import { registerMove } from './moves.js';
import { applyHit, hurtCircles } from './combat.js';
import { rng } from '../core/math.js';

const hit = (t0, t1, dmg, o = {}) => ({ t0, t1, dmg, post: dmg, kx: 220, ky: 0, kind: 'flinch', stop: 0.05, shake: 0.18, stun: 0.3, ...o });
const AIRLEGS = { f1x: 8, f1y: 20, f2x: -12, f2y: 14 };
const TUCK = { f1x: 6, f1y: 26, f2x: -8, f2y: 30 };
const sfx = (t, name) => [t, 'sfx', name];

// ───────────── Twin blades ─────────────
// Two short blades. The weapon hand cuts with `ha/hr/bl`; the off hand cuts with `ua/la`, and its
// blade points `la + 0.3`. While one hand cuts, the other is drawn back out of the way.
const TW_ANG = 0.3;
const MAIN_BACK = { ha: -2.2, hr: 0.62, bl: -2.7 };       // weapon hand pulled back to the hip
const OFF_BACK = { ua: -2.5, la: -2.1 };                   // off hand pulled back, blade pointing down and back
const OFF_GUARD = { ua: -1.2, la: 0.4 };                   // off blade held up in front of the chest
// Weapon hand: high wind-up, downward cut; low wind-up, rising cut.
const MW = { ha: 1.9, hr: 0.8, bl: 2.6 }, MS = { ha: -0.55, hr: 1, bl: -0.7 };
const MU = { ha: -1.0, hr: 0.85, bl: -1.4 }, MR = { ha: 1.1, hr: 1, bl: 1.8 };
// Off hand: the same two cuts.
const OW = { ua: 1.9, la: 2.6 }, OS = { ua: -0.35, la: -0.6 };
const OU = { ua: -2.0, la: -1.9 }, OR = { ua: 0.8, la: 1.2 };
// In the air the target is usually level with your hips or below, so the downward cuts finish lower.
const MSA = { ha: -0.8, hr: 1, bl: -1.0 }, OSA = { ua: -0.6, la: -1.0 };

const tw = {
  // Light string: the hands take turns, then both together.
  TW_L1: { fam: 'light', dur: 0.28, cancel: 0.15, next: { light: 'TW_L2', heavy: 'TW_BRK' },
    keys: [[0, { ...MW, ...OFF_GUARD, lean: -0.1, py: 48 }], [0.045, { ...MW, bl: 2.75, ...OFF_GUARD }], [0.11, { ...MS, ...OFF_BACK, lean: 0.35, py: 44, f1x: 24 }, 'in'], [0.28, { ...MS, bl: -0.85, ...OFF_BACK, lean: 0.3 }]],
    hits: [hit(0.045, 0.14, 6, { kx: 110, stop: 0.035, shake: 0.12 })], step: [[0.02, 0.11, 260]], ev: [sfx(0.04, 'swingTwin')] },
  TW_L2: { fam: 'light', dur: 0.28, cancel: 0.15, next: { light: 'TW_L3', heavy: 'TW_LAUNCH' },
    keys: [[0, { ...OW, ...MAIN_BACK, lean: -0.1, py: 48 }], [0.045, { ua: 2.0, la: 2.75, ...MAIN_BACK }], [0.11, { ...OS, ...MAIN_BACK, lean: 0.38, py: 44, f1x: 26 }, 'in'], [0.28, { ...OS, la: -0.8, ...MAIN_BACK, lean: 0.3 }]],
    hits: [hit(0.045, 0.14, 6, { kx: 110, stop: 0.035, shake: 0.12 })], step: [[0.02, 0.11, 260]], ev: [sfx(0.04, 'swingTwin')] },
  TW_L3: { fam: 'light', dur: 0.28, cancel: 0.15, next: { light: 'TW_L4', heavy: 'TW_FIN' },
    keys: [[0, { ...MU, ...OFF_GUARD, lean: 0.3, py: 42 }], [0.045, { ...MU, bl: -1.55, ...OFF_GUARD }], [0.11, { ...MR, ...OFF_BACK, lean: -0.05, py: 49, f1x: 22 }, 'in'], [0.28, { ...MR, bl: 2.0, ...OFF_BACK }]],
    hits: [hit(0.045, 0.14, 6, { kx: 110, stop: 0.035, shake: 0.12 })], step: [[0.02, 0.11, 240]], ev: [sfx(0.04, 'swingTwin')] },
  TW_L4: { fam: 'light', dur: 0.28, cancel: 0.15, next: { light: 'TW_L5', heavy: 'TW_FIN' },
    keys: [[0, { ...OU, ...MAIN_BACK, lean: 0.3, py: 42 }], [0.045, { ua: -2.1, la: -2.05, ...MAIN_BACK }], [0.11, { ...OR, ...MAIN_BACK, lean: -0.05, py: 49, f1x: 22 }, 'in'], [0.28, { ...OR, la: 1.4, ...MAIN_BACK }]],
    hits: [hit(0.045, 0.14, 6, { kx: 110, stop: 0.035, shake: 0.12 })], step: [[0.02, 0.11, 240]], ev: [sfx(0.04, 'swingTwin')] },
  // Both blades come down one after the other: a scissor.
  TW_L5: { fam: 'light', dur: 0.38, cancel: 0.23, next: { light: 'TW_L6', heavy: 'TW_FIN' },
    keys: [[0, { ...MW, ...OW, lean: -0.15, py: 49 }], [0.05, { ...MW, bl: 2.8, ua: 2.0, la: 2.8 }], [0.11, { ...MS, ua: 1.2, la: 2.0, lean: 0.2, py: 46, f1x: 22 }, 'in'], [0.19, { ...MS, bl: -0.9, ...OS, lean: 0.4, py: 43, f1x: 28 }, 'in'], [0.38, { ...MS, bl: -1.0, ...OS, la: -0.8, lean: 0.3 }]],
    hits: [hit(0.05, 0.135, 4, { kx: 90, stop: 0.03, shake: 0.1 }), hit(0.14, 0.22, 4, { kx: 120, stop: 0.035, shake: 0.12 })],
    step: [[0.02, 0.16, 230]], ev: [sfx(0.04, 'swingTwin'), sfx(0.13, 'swingTwin')] },
  // Finisher: a crossing pair of rising cuts, then both blades thrown out to the sides of the target.
  TW_L6: { fam: 'light', dur: 0.56, cancel: 0.38, next: {},
    keys: [[0, { ...MU, ...OU, lean: 0.4, py: 38 }], [0.06, { ...MU, bl: -1.6, ua: -2.1, la: -2.1, py: 36 }], [0.13, { ...MR, ...OU, lean: 0.05, py: 48 }, 'in'], [0.2, { ...MR, ...OR, py: 52 }, 'in'],
      [0.27, { ha: 2.1, hr: 0.9, bl: 2.4, ua: 1.8, la: 2.4, lean: -0.2, py: 50 }], [0.36, { ...MS, ...OS, lean: 0.5, py: 40, f1x: 32 }, 'in'], [0.56, { ...MS, bl: -0.9, ...OS, lean: 0.35, py: 42 }]],
    hits: [hit(0.06, 0.14, 4, { kx: 60, ky: -120, stop: 0.03, shake: 0.1 }), hit(0.14, 0.21, 4, { kx: 60, ky: -160, stop: 0.03, shake: 0.12 }),
      hit(0.28, 0.38, 10, { kx: 560, ky: -340, kind: 'knock', stop: 0.09, shake: 0.36, post: 14 })],
    step: [[0.02, 0.12, 200], [0.27, 0.36, 380]], ev: [sfx(0.05, 'swingTwin'), sfx(0.13, 'swingTwin'), sfx(0.27, 'swingSpin')] },

  // Breaker: both blades raised and brought down crossed. Breaks a guard, but leaves little posture.
  TW_BRK: { fam: 'heavy', dur: 0.48, cancel: 0.3, next: { light: 'TW_L3' }, tier: 2,
    keys: [[0, { ...MW, ...OW, lean: -0.25, py: 52 }], [0.1, { ...MW, bl: 2.9, ua: 2.1, la: 2.9, lean: -0.3, py: 54 }], [0.19, { ...MS, ...OS, lean: 0.5, py: 40, f1x: 30 }, 'in'], [0.48, { ...MS, bl: -1.0, ...OS, la: -0.85, lean: 0.4, py: 41 }]],
    hits: [hit(0.1, 0.22, 11, { kx: 200, ky: 420, kind: 'spike', stop: 0.08, shake: 0.32, post: 18, guardBreak: true, stun: 0.4 })],
    step: [[0.09, 0.19, 240]], ev: [sfx(0.09, 'swingHeavy')] },
  // Heavy: a charged cross-slash. The blades are pulled apart, one high and one low, and cross in front.
  TW_H1: { fam: 'heavy', dur: 0.56, cancel: 0.34, next: { light: 'TW_L3' }, charge: 0.16, tier: 2,
    keys: [[0, { ...MW, ...OU, lean: -0.1, py: 46 }], [0.16, { ...MW, bl: 2.9, ua: -2.2, la: -2.1, lean: -0.15, py: 45, f2x: -24 }], [0.24, { ...MS, ...OR, lean: 0.45, py: 42, f1x: 30 }, 'in'],
      [0.33, { ...MS, bl: -1.0, ...OR, la: 1.5, lean: 0.4, py: 42 }], [0.56, { ...MS, bl: -1.0, ...OR, la: 1.5, lean: 0.3, py: 44 }]],
    hits: [hit(0.18, 0.24, 8, { kx: 140, stop: 0.06, shake: 0.22, post: 14 }), hit(0.24, 0.31, 9, { kx: 380, ky: -220, kind: 'knock', stop: 0.09, shake: 0.38, post: 16, guardBreak: true })],
    step: [[0.16, 0.26, 300]], ev: [sfx(0.15, 'swingTwin'), sfx(0.22, 'swingHeavy')] },
  // Launcher: a spinning rising cut that carries you up with the target.
  TW_LAUNCH: { fam: 'launch', dur: 0.42, cancel: 0.22, next: {}, rise: 0.2,
    keys: [[0, { ...MU, ...OU, lean: 0.45, py: 34, f1x: 22 }], [0.07, { ...MU, bl: -2.0, ua: -2.2, la: -2.2, lean: 0.5, py: 32 }], [0.14, { ...MR, ...OU, lean: 0, py: 50 }, 'in'],
      [0.2, { ...MR, bl: 1.9, ...OR, lean: -0.2, py: 55 }, 'in'], [0.42, { ...MR, bl: 2.0, ...OR, la: 1.4, lean: -0.15 }]],
    hits: [hit(0.07, 0.15, 5, { kx: 20, stop: 0.04, shake: 0.14, post: 8 }), hit(0.15, 0.23, 7, { kx: 30, ky: -980, kind: 'launch', stop: 0.08, shake: 0.3, post: 12 })],
    step: [[0.03, 0.12, 220]], ev: [sfx(0.07, 'swingTwin'), sfx(0.14, 'swingSpin')] },
  // Finisher branch: a flurry of alternating stabs, then an X-cut that sends the target away.
  TW_FIN: { fam: 'heavy', dur: 0.78, cancel: 0.56, next: {}, tier: 2,
    keys: [[0, { ha: 0.1, hr: 0.45, bl: 0, ua: -0.7, la: -0.1, lean: 0.4, py: 42, f1x: 26, f2x: -24 }],
      [0.06, { ha: 0, hr: 1, bl: 0, ua: -0.7, la: -0.1, lean: 0.5 }, 'in'], [0.12, { ha: 0.1, hr: 0.45, bl: 0.1, ua: -0.15, la: 0, lean: 0.5 }, 'in'],
      [0.18, { ha: -0.1, hr: 1, bl: -0.1, ua: -0.7, la: -0.1 }, 'in'], [0.24, { ha: 0.1, hr: 0.45, bl: 0.1, ua: -0.1, la: 0.05 }, 'in'],
      [0.36, { ...MW, ...OW, lean: -0.2, py: 50, f1x: 18 }], [0.46, { ...MS, ...OS, lean: 0.55, py: 38, f1x: 32, f2x: -26 }, 'in'], [0.78, { ...MS, bl: -1.0, ...OS, la: -0.85, lean: 0.4, py: 40 }]],
    hits: [hit(0.03, 0.08, 4, { kx: 60, stop: 0.025, shake: 0.08, post: 4 }), hit(0.09, 0.14, 4, { kx: 60, stop: 0.025, shake: 0.08, post: 4 }),
      hit(0.15, 0.2, 4, { kx: 60, stop: 0.025, shake: 0.08, post: 4 }), hit(0.21, 0.26, 4, { kx: 60, stop: 0.025, shake: 0.08, post: 4 }),
      hit(0.37, 0.48, 14, { kx: 640, ky: -300, kind: 'knock', stop: 0.11, shake: 0.45, post: 16 })],
    step: [[0.0, 0.24, 150], [0.36, 0.46, 360]], ev: [sfx(0.03, 'swingTwin'), sfx(0.15, 'swingTwin'), sfx(0.36, 'swingSpin')] },
  // Dash attack: two cuts on the way through, one per hand.
  TW_DA: { fam: 'light', dur: 0.36, cancel: 0.2, next: { light: 'TW_L3', heavy: 'TW_LAUNCH' },
    keys: [[0, { ha: 2.6, hr: 0.7, bl: 3.0, ua: 2.4, la: 3.0, lean: 0.65, py: 38 }], [0.04, { ha: 2.6, hr: 0.7, bl: 3.1, ua: 2.5, la: 3.1, lean: 0.65, py: 37 }],
      [0.1, { ha: -0.3, hr: 1, bl: -0.4, ua: 2.4, la: 3.0, lean: 0.7, py: 36, f1x: 30 }, 'in'], [0.17, { ha: -0.4, hr: 0.9, bl: -0.6, ua: -0.4, la: -0.5, lean: 0.65, py: 37 }, 'in'], [0.36, { ...MS, ...OS, lean: 0.4 }]],
    hits: [hit(0.03, 0.11, 6, { kx: 140, stop: 0.04, shake: 0.14 }), hit(0.11, 0.19, 6, { kx: 240, stop: 0.05, shake: 0.18 })],
    step: [[0, 0.15, 620]], ev: [sfx(0.03, 'swingTwin'), sfx(0.11, 'swingTwin')] },

  // Air string: five cuts, hands taking turns, then both. From the second cut on, each one checks
  // your climb (a small 'leap' that replaces the rise) so you hang level with the target.
  TW_A1: { fam: 'air', air: true, dur: 0.26, cancel: 0.13, next: { light: 'TW_A2', heavy: 'TW_AH' },
    keys: [[0, { ...MW, ...OFF_GUARD, ...AIRLEGS }], [0.04, { ...MW, bl: 2.75 }], [0.1, { ...MSA, ...OFF_BACK, ...AIRLEGS, lean: 0.3 }, 'in'], [0.26, { ...MSA, ...OFF_BACK }]],
    hits: [hit(0.04, 0.14, 5, { kx: 50, ky: -300, kind: 'pop', stop: 0.035, shake: 0.12 })], ev: [sfx(0.04, 'swingTwin')] },
  TW_A2: { fam: 'air', air: true, dur: 0.26, cancel: 0.13, next: { light: 'TW_A3', heavy: 'TW_AH' },
    keys: [[0, { ...OW, ...MAIN_BACK, ...AIRLEGS }], [0.04, { ua: 2.0, la: 2.75 }], [0.1, { ...OSA, ...MAIN_BACK, ...AIRLEGS, lean: 0.3 }, 'in'], [0.26, { ...OSA, ...MAIN_BACK }]],
    hits: [hit(0.04, 0.14, 5, { kx: 50, ky: -300, kind: 'pop', stop: 0.035, shake: 0.12 })], ev: [[0, 'leap', [90, -80]], sfx(0.04, 'swingTwin')] },
  TW_A3: { fam: 'air', air: true, dur: 0.26, cancel: 0.13, next: { light: 'TW_A4', heavy: 'TW_AH' },
    keys: [[0, { ...MU, ...OFF_GUARD, ...AIRLEGS, lean: 0.3 }], [0.04, { ...MU, bl: -1.55 }], [0.1, { ...MR, ...OFF_BACK, f1x: 10, f1y: 22, f2x: -10, f2y: 12, lean: 0 }, 'in'], [0.26, { ...MR, ...OFF_BACK }]],
    hits: [hit(0.04, 0.12, 5, { kx: 50, ky: -320, kind: 'pop', stop: 0.035, shake: 0.12 })], ev: [[0, 'leap', [90, -80]], sfx(0.04, 'swingTwin')] },
  TW_A4: { fam: 'air', air: true, dur: 0.26, cancel: 0.13, next: { light: 'TW_A5', heavy: 'TW_AH' },
    keys: [[0, { ...OU, ...MAIN_BACK, ...AIRLEGS, lean: 0.3 }], [0.04, { ua: -2.1, la: -2.05 }], [0.1, { ...OR, ...MAIN_BACK, f1x: 10, f1y: 22, f2x: -10, f2y: 12, lean: 0 }, 'in'], [0.26, { ...OR, ...MAIN_BACK }]],
    hits: [hit(0.04, 0.12, 5, { kx: 50, ky: -320, kind: 'pop', stop: 0.035, shake: 0.12 })], ev: [[0, 'leap', [90, -80]], sfx(0.04, 'swingTwin')] },
  // Air finisher: both blades wind back over the head and cut down together, knocking the target off.
  TW_A5: { fam: 'air', air: true, dur: 0.4, cancel: 0.26, next: {},
    keys: [[0, { ...MW, ...OW, ...TUCK, lean: -0.2 }], [0.07, { ...MW, bl: 2.9, ua: 2.1, la: 2.9, lean: -0.3 }], [0.14, { ha: -1.1, hr: 1, bl: -1.4, ua: -0.9, la: -1.3, ...AIRLEGS, lean: 0.45 }, 'in'], [0.4, { ha: -1.1, hr: 1, bl: -1.4, ua: -0.9, la: -1.3, lean: 0.3 }]],
    hits: [hit(0.07, 0.18, 10, { kx: 460, ky: -420, kind: 'launch', stop: 0.09, shake: 0.34, post: 14 })], ev: [[0, 'leap', [90, -80]], sfx(0.06, 'swingSpin')] },
  // Air spike: both blades driven straight down.
  TW_AH: { fam: 'spike', air: true, dur: 0.42, cancel: 0.3, next: {}, tier: 2,
    keys: [[0, { ...MW, ...OW, ...AIRLEGS }], [0.11, { ...MW, bl: 2.9, ua: 2.1, la: 2.9, ...TUCK }], [0.19, { ha: -1.0, hr: 1, bl: -1.3, ua: -0.9, la: -1.2, lean: 0.45, f1x: 18, f1y: 8, f2x: -12, f2y: 20 }, 'in'], [0.42, { ha: -1.0, hr: 1, bl: -1.3, ua: -0.9, la: -1.2, lean: 0.4 }]],
    hits: [hit(0.11, 0.23, 12, { kx: 140, ky: 1200, kind: 'spike', stop: 0.1, shake: 0.42, post: 20, guardBreak: true })], ev: [sfx(0.1, 'swingHeavy')] },
  // Dive: both blades point down past the feet; the landing stabs both into the floor.
  TW_PLUNGE: { fam: 'spike', air: true, dur: 9, cancel: 9, next: {}, tier: 2, plunge: true, land: 'TW_LAND',
    keys: [[0, { ha: 1.6, hr: 0.6, bl: 1.57, ua: 1.5, la: 1.6, lean: 0.05, f1x: -4, f1y: 30, f2x: -14, f2y: 36 }], [0.14, { ha: -1.45, hr: 0.8, bl: -1.57, ua: -1.75, la: -1.9, lean: 0.1, f1x: -6, f1y: 34, f2x: -16, f2y: 40 }]],
    hits: [hit(0.14, 9, 8, { kx: 60, ky: 1300, kind: 'spike', stop: 0.06, post: 16, guardBreak: true })], ev: [sfx(0.02, 'swingTwin')] },
  TW_LAND: { fam: 'spike', dur: 0.36, cancel: 0.22, next: {}, tier: 2,
    keys: [[0, { ha: -1.25, hr: 0.75, bl: -1.4, ua: -1.6, la: -1.85, lean: 0.55, py: 24, f1x: 26, f2x: -24 }], [0.2, { ha: -1.25, hr: 0.75, bl: -1.4, ua: -1.6, la: -1.85, lean: 0.5, py: 27 }], [0.36, { py: 44 }]],
    hits: [{ ...hit(0, 0.06, 6, { kx: 120, ky: -620, kind: 'launch', stop: 0.08, shake: 0.4, post: 14 }), shape: 'circle', ox: 10, oy: -20, r: 100 },
      { ...hit(0.1, 0.16, 5, { kx: 80, ky: -420, kind: 'pop', stop: 0.05, shake: 0.2, post: 8 }), shape: 'circle', ox: 30, oy: -30, r: 70 }],
    ev: [sfx(0.09, 'swingTwin')] },
  // Riposte: four cuts at once, hands alternating, invulnerable throughout, the last one throws.
  TW_RIP: { fam: 'riposte', dur: 0.62, cancel: 0.4, next: {}, tier: 3, invuln: [0, 0.5],
    keys: [[0, { ...MW, ...OW, lean: 0.5, py: 36 }], [0.05, { ...MS, ...OW, lean: 0.6, py: 35, f1x: 34, f2x: -30 }, 'in'], [0.11, { ...MU, ...OS, lean: 0.6 }, 'in'],
      [0.17, { ...MR, ...OU, lean: 0.4, py: 42 }, 'in'], [0.23, { ...MW, ...OR, lean: 0.2, py: 48 }, 'in'], [0.34, { ...MS, ...OS, lean: 0.65, py: 36, f1x: 34 }, 'in'], [0.62, { ...MS, bl: -1.0, ...OS, la: -0.8, lean: 0.4, py: 40 }]],
    hits: [hit(0.02, 0.08, 10, { kx: 30, stop: 0.05, shake: 0.2, post: 10, unblockable: true }), hit(0.08, 0.14, 10, { kx: 30, stop: 0.05, shake: 0.2, post: 10, unblockable: true }),
      hit(0.14, 0.2, 10, { kx: 30, stop: 0.05, shake: 0.2, post: 10, unblockable: true }), hit(0.2, 0.26, 10, { kx: 30, stop: 0.05, shake: 0.2, post: 10, unblockable: true }),
      hit(0.27, 0.37, 26, { kx: 520, ky: -300, kind: 'knock', stop: 0.15, shake: 0.6, post: 25, unblockable: true, sweepBody: true })],
    step: [[0.0, 0.08, 600], [0.27, 0.36, 1200]], ev: [sfx(0.02, 'swingTwin'), sfx(0.14, 'swingTwin'), sfx(0.27, 'swingSpin'), [0.28, 'fx', 'riposteLine']] },
};

// ───────────── Greatsword ─────────────
// One long, wide blade held in both hands. `grip` puts the off hand on the hilt beside the weapon
// hand, so every pose is two-handed.
const grip = (ha, hr, bl, o = {}) => { const k = Math.acos(Math.min(1, hr)); return { ha, hr, bl, ua: ha - k, la: ha + k, ...o }; };
const GS_ARMOR = (a, b) => [a, b];

const gs = {
  // Light string: three sweeping cuts. The first starts low behind you and comes over the top, so it
  // also clears anything at your back.
  GS_L1: { fam: 'light', dur: 0.6, cancel: 0.38, next: { light: 'GS_L2', heavy: 'GS_BRK' }, tier: 2, armor: GS_ARMOR(0.03, 0.26),
    keys: [[0, grip(2.7, 0.75, 3.5, { lean: -0.2, py: 47, f1x: 12, f2x: -20 })], [0.12, grip(2.8, 0.78, 3.6, { lean: -0.25, py: 48 })],
      [0.27, grip(-0.5, 1, -0.55, { lean: 0.45, py: 41, f1x: 30, f2x: -22 }), 'in'], [0.6, grip(-0.9, 0.95, -1.15, { lean: 0.35, py: 42 })]],
    hits: [hit(0.13, 0.3, 11, { kx: 300, stop: 0.07, shake: 0.26, post: 28, stun: 0.42 })], step: [[0.14, 0.27, 280]], ev: [sfx(0.12, 'swingGreat')] },
  // A rising backhand that carries the blade up behind your shoulder.
  GS_L2: { fam: 'light', dur: 0.6, cancel: 0.38, next: { light: 'GS_L3', heavy: 'GS_LAUNCH' }, tier: 2, armor: GS_ARMOR(0.03, 0.26),
    keys: [[0, grip(-1.1, 0.85, -1.6, { lean: 0.4, py: 40, f1x: 26, f2x: -20 })], [0.1, grip(-1.15, 0.85, -1.75, { lean: 0.45, py: 39 })],
      [0.26, grip(1.6, 0.95, 2.3, { lean: -0.15, py: 50, f1x: 24 }), 'in'], [0.6, grip(1.9, 0.85, 2.7, { lean: -0.2, py: 50 })]],
    hits: [hit(0.11, 0.28, 11, { kx: 260, ky: -120, stop: 0.07, shake: 0.26, post: 28, stun: 0.42 })], step: [[0.1, 0.24, 260]], ev: [sfx(0.1, 'swingGreat')] },
  // Finisher: a windmill. Over the top and down in front, under and up behind you, then over the top
  // again and down through the target.
  GS_L3: { fam: 'light', dur: 0.78, cancel: 0.52, next: { heavy: 'GS_FIN' }, tier: 2, armor: GS_ARMOR(0.0, 0.42),
    keys: [[0, grip(2.0, 0.85, 2.7, { lean: -0.2, py: 50 })], [0.08, grip(2.1, 0.85, 2.9, { lean: -0.25, py: 51 })],
      [0.2, grip(-0.4, 1, -0.4, { lean: 0.35, py: 42, f1x: 28 }), 'lin'], [0.32, grip(-2.6, 0.9, -3.2, { lean: 0.1, py: 40, f2x: -26 }), 'lin'],
      [0.38, grip(-4.6, 0.95, -5.0, { lean: 0.0, py: 48, f1x: 24 }), 'lin'], [0.44, grip(-6.75, 1, -7.05, { lean: 0.55, py: 38, f1x: 32 }), 'in'], [0.78, grip(-6.85, 0.95, -7.3, { lean: 0.4, py: 41 })]],
    hits: [hit(0.09, 0.22, 8, { kx: 200, stop: 0.06, shake: 0.22, post: 22, stun: 0.42 }), hit(0.23, 0.43, 13, { kx: 170, ky: -440, kind: 'knock', stop: 0.12, shake: 0.5, post: 36 })],
    step: [[0.08, 0.2, 220], [0.3, 0.42, 300]], ev: [sfx(0.08, 'swingGreat'), sfx(0.3, 'swingSpin')] },

  // Breaker: a short chop from the shoulder.
  GS_BRK: { fam: 'heavy', dur: 0.62, cancel: 0.4, next: {}, tier: 2, armor: GS_ARMOR(0.02, 0.24),
    keys: [[0, grip(2.1, 0.75, 2.9, { lean: -0.25, py: 52 })], [0.12, grip(2.2, 0.8, 3.1, { lean: -0.3, py: 53 })], [0.22, grip(-0.75, 1, -1.05, { lean: 0.6, py: 37, f1x: 30 }), 'in'], [0.62, grip(-0.8, 1, -1.15, { lean: 0.45, py: 38 })]],
    hits: [hit(0.13, 0.26, 18, { kx: 240, ky: 600, kind: 'spike', stop: 0.12, shake: 0.5, post: 60, guardBreak: true, stun: 0.5 })],
    step: [[0.12, 0.22, 240]], ev: [sfx(0.12, 'swingGreat'), [0.22, 'fx', 'groundHit']] },
  // Heavy: a chargeable overhead that cracks the floor.
  GS_H1: { fam: 'heavy', dur: 0.82, cancel: 0.54, next: {}, charge: 0.22, tier: 2, armor: GS_ARMOR(0.0, 0.44),
    keys: [[0, grip(2.2, 0.8, 3.0, { lean: -0.25, py: 52 })], [0.22, grip(2.35, 0.85, 3.3, { lean: -0.35, py: 54, f1x: 10 })], [0.36, grip(-0.75, 1, -1.1, { lean: 0.65, py: 34, f1x: 32, f2x: -26 }), 'in'], [0.82, grip(-0.8, 1, -1.2, { lean: 0.5, py: 35 })]],
    hits: [hit(0.25, 0.4, 28, { kx: 280, ky: 680, kind: 'spike', stop: 0.15, shake: 0.62, post: 80, guardBreak: true, stun: 0.6 })],
    step: [[0.24, 0.36, 280]], ev: [sfx(0.24, 'swingGreat'), [0.36, 'fx', 'groundHit']] },
  // Launcher: the blade is dragged along the floor and heaved straight up. Real lift.
  GS_LAUNCH: { fam: 'launch', dur: 0.56, cancel: 0.32, next: {}, rise: 0.26, tier: 2, armor: GS_ARMOR(0.0, 0.26),
    keys: [[0, grip(-1.4, 0.8, -2.2, { lean: 0.5, py: 32, f1x: 26 })], [0.14, grip(-1.45, 0.85, -2.4, { lean: 0.55, py: 30 })], [0.27, grip(1.5, 1, 1.65, { lean: -0.25, py: 56 }), 'in'], [0.56, grip(1.65, 0.9, 2.0, { lean: -0.2 })]],
    hits: [hit(0.14, 0.3, 13, { kx: 50, ky: -1000, kind: 'launch', stop: 0.11, shake: 0.4, post: 36 })], step: [[0.06, 0.16, 240]], ev: [sfx(0.14, 'swingGreat')] },
  // Finisher branch: a leaping overhead that drives the target into the floor.
  GS_FIN: { fam: 'heavy', dur: 0.86, cancel: 0.6, next: {}, tier: 2, armor: GS_ARMOR(0.0, 0.48),
    keys: [[0, grip(2.2, 0.85, 3.0, { lean: -0.2, py: 52 })], [0.14, grip(2.4, 0.9, 3.3, { lean: -0.3, py: 76, ...AIRLEGS })], [0.42, grip(-0.8, 1, -1.2, { lean: 0.65, py: 32, f1x: 34, f1y: 0, f2x: -26, f2y: 0 }), 'in'], [0.86, grip(-0.8, 1, -1.25, { lean: 0.5, py: 34 })]],
    hits: [hit(0.28, 0.46, 30, { kx: 260, ky: 820, kind: 'spike', stop: 0.15, shake: 0.7, post: 70, guardBreak: true })],
    step: [[0.06, 0.4, 300]], ev: [sfx(0.26, 'swingGreat'), [0.42, 'fx', 'groundHit']] },
  // Dash attack: a running thrust, the whole body behind the point.
  GS_DA: { fam: 'light', dur: 0.52, cancel: 0.32, next: { light: 'GS_L2', heavy: 'GS_LAUNCH' }, tier: 2, armor: GS_ARMOR(0.0, 0.2),
    keys: [[0, grip(0.25, 0.4, 0.1, { lean: 0.2, py: 44, f1x: 10, f2x: -22 })], [0.08, grip(0.2, 0.35, 0.05, { lean: 0.15, py: 45 })], [0.16, grip(-0.05, 1, 0, { lean: 0.7, py: 36, f1x: 36, f2x: -30 }), 'in'], [0.52, grip(-0.05, 0.9, -0.1, { lean: 0.45, py: 40 })]],
    hits: [hit(0.08, 0.2, 14, { kx: 420, stop: 0.08, shake: 0.3, post: 30 })], step: [[0, 0.16, 680]], ev: [sfx(0.08, 'swingGreat')] },

  // Air string: two cleaves.
  GS_A1: { fam: 'air', air: true, dur: 0.44, cancel: 0.26, next: { light: 'GS_A2', heavy: 'GS_AH' }, tier: 2,
    keys: [[0, grip(2.0, 0.8, 2.8, { ...AIRLEGS, lean: -0.2 })], [0.08, grip(2.1, 0.8, 3.0, AIRLEGS)], [0.19, grip(-0.6, 1, -0.75, { ...AIRLEGS, lean: 0.4 }), 'in'], [0.44, grip(-0.8, 0.95, -1.0, { lean: 0.3 })]],
    hits: [hit(0.08, 0.21, 10, { kx: 80, ky: -380, kind: 'pop', stop: 0.07, shake: 0.24, post: 24 })], ev: [sfx(0.08, 'swingGreat')] },
  GS_A2: { fam: 'air', air: true, dur: 0.5, cancel: 0.34, next: { heavy: 'GS_AH' }, tier: 2,
    keys: [[0, grip(-1.1, 0.85, -1.6, { ...AIRLEGS, lean: 0.35 })], [0.08, grip(-1.15, 0.85, -1.8, AIRLEGS)], [0.2, grip(1.5, 1, 2.0, { ...TUCK, lean: -0.15 }), 'in'], [0.5, grip(1.8, 0.9, 2.5, { lean: -0.2 })]],
    hits: [hit(0.08, 0.22, 11, { kx: 420, ky: -460, kind: 'launch', stop: 0.1, shake: 0.38, post: 30 })], ev: [sfx(0.08, 'swingGreat')] },
  // Air spike: a heavy cleave that hurls the target into the floor.
  GS_AH: { fam: 'spike', air: true, dur: 0.56, cancel: 0.4, next: {}, tier: 2,
    keys: [[0, grip(2.2, 0.8, 3.0, AIRLEGS)], [0.16, grip(2.35, 0.85, 3.3, { ...TUCK, lean: -0.3 })], [0.27, grip(-0.85, 1, -1.2, { lean: 0.55, f1x: 18, f1y: 8, f2x: -12, f2y: 20 }), 'in'], [0.56, grip(-0.85, 1, -1.25, { lean: 0.45 })]],
    hits: [hit(0.16, 0.3, 20, { kx: 160, ky: 1300, kind: 'spike', stop: 0.13, shake: 0.55, post: 50, guardBreak: true })], ev: [sfx(0.15, 'swingGreat')] },
  // Plunge: point down, both hands on the hilt; the landing throws a wide ring.
  GS_PLUNGE: { fam: 'spike', air: true, dur: 9, cancel: 9, next: {}, tier: 2, plunge: true, land: 'GS_LAND',
    keys: [[0, grip(1.57, 0.6, 1.57, { lean: 0.05, f1x: -4, f1y: 30, f2x: -14, f2y: 36 })], [0.16, grip(-1.5, 0.75, -1.57, { lean: 0.1, f1x: -6, f1y: 34, f2x: -16, f2y: 40 })]],
    hits: [hit(0.16, 9, 10, { kx: 60, ky: 1300, kind: 'spike', stop: 0.08, post: 30, guardBreak: true })], ev: [sfx(0.02, 'swingGreat')] },
  GS_LAND: { fam: 'spike', dur: 0.56, cancel: 0.38, next: {}, tier: 2, armor: GS_ARMOR(0, 0.3),
    keys: [[0, grip(-1.35, 0.7, -1.57, { lean: 0.55, py: 24, f1x: 26, f2x: -26 })], [0.34, grip(-1.35, 0.7, -1.5, { lean: 0.5, py: 26 })], [0.56, grip(-0.8, 0.9, -0.9, { py: 44 })]],
    hits: [{ ...hit(0, 0.08, 16, { kx: 220, ky: -620, kind: 'launch', stop: 0.14, shake: 0.7, post: 46 }), shape: 'circle', ox: 0, oy: -20, r: 180 }], ev: [[0, 'fx', 'groundHit']] },
  // Riposte: one executioner's stroke from high behind, through the target and into the floor.
  GS_RIP: { fam: 'riposte', dur: 0.64, cancel: 0.42, next: {}, tier: 3, invuln: [0, 0.5],
    keys: [[0, grip(2.4, 0.85, 3.3, { lean: -0.3, py: 54 })], [0.07, grip(2.45, 0.9, 3.4, { lean: -0.35, py: 55 })], [0.17, grip(-0.75, 1, -1.1, { lean: 0.7, py: 33, f1x: 34, f2x: -28 }), 'in'], [0.64, grip(-0.8, 1, -1.2, { lean: 0.5, py: 36 })]],
    hits: [hit(0.07, 0.22, 40, { kx: 460, ky: -320, kind: 'knock', stop: 0.18, shake: 0.75, post: 80, unblockable: true })],
    step: [[0.04, 0.16, 900]], ev: [sfx(0.06, 'swingGreat'), [0.17, 'fx', 'groundHit']] },
};

// ───────────── Staff ─────────────
// Double-ended: both ends hit. Held near the middle of the body the ends cover front and back at
// once; pushed out in front the near end becomes a long reach. Spins are written as `bl` turning
// through whole circles with linear easing.
const T = Math.PI * 2;
const SPIN = (o = {}) => ({ ha: -1.15, hr: 0.5, ...o });  // hands at the belly, ends reach both ways
const HIGH = (o = {}) => ({ ha: 1.5, hr: 0.95, ...o });   // above the head
const HELI = (o = {}) => ({ ha: -0.35, hr: 0.75, ua: -0.5, la: 0.1, ...o }); // out in front of the chest

const st = {
  // Light string: two twirls, a thrust and a butt-strike behind, then a spin over the head.
  ST_L1: { fam: 'light', dur: 0.4, cancel: 0.22, next: { light: 'ST_L2', heavy: 'ST_BRK' },
    keys: [[0, SPIN({ bl: 1.7, lean: 0.05, py: 46, ua: -1.0, la: -0.6 })], [0.04, SPIN({ bl: 1.65 })], [0.24, SPIN({ bl: 1.65 - T, lean: 0.25, py: 43, f1x: 24 }), 'lin'], [0.4, SPIN({ bl: 1.35 - T, lean: 0.15 })]],
    hits: [hit(0.04, 0.14, 5, { kx: 140, stop: 0.035, shake: 0.12 }), hit(0.14, 0.24, 5, { kx: 160, stop: 0.035, shake: 0.12 })],
    step: [[0.04, 0.2, 160]], ev: [sfx(0.04, 'swingStaff'), sfx(0.14, 'swingStaff')] },
  ST_L2: { fam: 'light', dur: 0.4, cancel: 0.22, next: { light: 'ST_L3', heavy: 'ST_LAUNCH' },
    keys: [[0, SPIN({ bl: -1.5, lean: 0.2, py: 44 })], [0.04, SPIN({ bl: -1.45 })], [0.24, SPIN({ bl: -1.45 + T, lean: 0.05, py: 47, f1x: 22 }), 'lin'], [0.4, SPIN({ bl: -1.2 + T, lean: 0.1 })]],
    hits: [hit(0.04, 0.14, 5, { kx: 140, stop: 0.035, shake: 0.12 }), hit(0.14, 0.24, 5, { kx: 160, stop: 0.035, shake: 0.12 })],
    step: [[0.04, 0.2, 160]], ev: [sfx(0.04, 'swingStaff'), sfx(0.14, 'swingStaff')] },
  // A long thrust ahead, then the butt driven back past your hip.
  ST_L3: { fam: 'light', dur: 0.46, cancel: 0.26, next: { light: 'ST_L4', heavy: 'ST_FIN' },
    keys: [[0, { ha: -0.2, hr: 0.35, bl: 0.05, lean: -0.05, py: 46, ua: -0.4, la: 0.1 }], [0.05, { ha: -0.2, hr: 0.3, bl: 0.05 }], [0.11, { ha: -0.05, hr: 1, bl: 0, lean: 0.45, py: 41, f1x: 32, f2x: -24, ua: -0.1, la: 0 }, 'in'],
      [0.18, { ha: -0.6, hr: 0.4, bl: 0.1, lean: 0.2, py: 44 }], [0.25, { ha: -2.7, hr: 0.75, bl: 0.15, lean: -0.15, py: 45, f1x: 18, f2x: -26, ua: -2.6, la: -2.9 }, 'in'], [0.46, { ha: -2.6, hr: 0.7, bl: 0.2, lean: -0.05 }]],
    hits: [hit(0.05, 0.14, 8, { kx: 260, stop: 0.04, shake: 0.14 }), hit(0.18, 0.27, 7, { kx: 300, stop: 0.04, shake: 0.14 })],
    step: [[0.04, 0.11, 320]], ev: [sfx(0.05, 'thrust'), sfx(0.18, 'swingStaff')] },
  // Finisher: two turns over the head, then brought down flat; the target is thrown away.
  ST_L4: { fam: 'light', dur: 0.74, cancel: 0.5, next: {},
    keys: [[0, HIGH({ bl: 0.2, lean: 0, py: 48, ua: 1.2, la: 1.6 })], [0.04, HIGH({ bl: 0.25 })], [0.36, HIGH({ bl: 0.25 - 2 * T, py: 50, f1x: 20 }), 'lin'],
      [0.46, { ha: -0.4, hr: 1, bl: -0.15 - 2 * T, lean: 0.5, py: 38, f1x: 32, f2x: -26, ua: -0.5, la: -0.2 }, 'in'], [0.74, { ha: -0.45, hr: 0.95, bl: -0.2 - 2 * T, lean: 0.35, py: 41 }]],
    hits: [hit(0.04, 0.13, 4, { kx: 80, stop: 0.03, shake: 0.1 }), hit(0.13, 0.22, 4, { kx: 80, stop: 0.03, shake: 0.1 }),
      hit(0.22, 0.31, 4, { kx: 80, stop: 0.03, shake: 0.1 }), hit(0.36, 0.48, 13, { kx: 560, ky: -360, kind: 'knock', stop: 0.1, shake: 0.42, post: 18 })],
    step: [[0.04, 0.34, 120], [0.36, 0.46, 320]], ev: [sfx(0.04, 'swingStaff'), sfx(0.2, 'swingStaff'), sfx(0.36, 'swingHeavy')] },

  // Breaker: a quick overhead with the near end; the far end swings up behind you.
  ST_BRK: { fam: 'heavy', dur: 0.54, cancel: 0.34, next: { light: 'ST_L3' }, tier: 2,
    keys: [[0, { ha: 1.9, hr: 0.75, bl: 2.4, lean: -0.2, py: 50, ua: 1.6, la: 2.0 }], [0.1, { ha: 2.0, hr: 0.8, bl: 2.6, lean: -0.25, py: 52 }], [0.2, { ha: -0.55, hr: 1, bl: -0.7, lean: 0.55, py: 38, f1x: 30, ua: -0.6, la: -0.4 }, 'in'], [0.54, { ha: -0.6, hr: 0.95, bl: -0.8, lean: 0.4, py: 40 }]],
    hits: [hit(0.1, 0.23, 12, { kx: 240, ky: 520, kind: 'spike', stop: 0.1, shake: 0.4, post: 30, guardBreak: true, stun: 0.45 })],
    step: [[0.1, 0.2, 240]], ev: [sfx(0.1, 'swingHeavy'), [0.2, 'fx', 'groundHit']] },
  // Heavy: a chargeable full circle over the top that slams the near end into the floor in front and
  // whips the far end through whatever stands behind.
  ST_H1: { fam: 'heavy', dur: 0.74, cancel: 0.46, next: {}, charge: 0.2, tier: 2,
    keys: [[0, { ha: -1.9, hr: 0.6, bl: -2.4, lean: 0.3, py: 42, ua: -2.2, la: -2.0 }], [0.2, { ha: -2.0, hr: 0.65, bl: -2.6, lean: 0.35, py: 40 }],
      [0.27, { ha: 1.7, hr: 0.9, bl: 1.57, lean: -0.15, py: 52, ua: 1.4, la: 1.7 }, 'out'], [0.36, { ha: -0.6, hr: 1, bl: -0.85, lean: 0.6, py: 36, f1x: 32, f2x: -26, ua: -0.7, la: -0.5 }, 'in'], [0.74, { ha: -0.65, hr: 0.95, bl: -0.9, lean: 0.45, py: 38 }]],
    hits: [hit(0.21, 0.29, 9, { kx: 420, ky: -380, kind: 'knock', stop: 0.07, shake: 0.26, post: 20 }), hit(0.29, 0.39, 15, { kx: 300, ky: -520, kind: 'knock', stop: 0.12, shake: 0.5, post: 34, guardBreak: true })],
    step: [[0.24, 0.36, 220]], ev: [sfx(0.2, 'swingStaff'), sfx(0.28, 'swingHeavy'), [0.36, 'fx', 'groundHit']] },
  // Launcher: the near end scoops off the floor and vaults the target up.
  ST_LAUNCH: { fam: 'launch', dur: 0.44, cancel: 0.24, next: {}, rise: 0.2,
    keys: [[0, { ha: -0.9, hr: 0.9, bl: -0.45, lean: 0.45, py: 34, f1x: 24, ua: -0.9, la: -0.6 }], [0.1, { ha: -1.0, hr: 0.9, bl: -0.55, lean: 0.5, py: 32 }], [0.2, { ha: 1.2, hr: 1, bl: 1.25, lean: -0.2, py: 54, ua: 1.1, la: 1.4 }, 'in'], [0.44, { ha: 1.3, hr: 0.9, bl: 1.5, lean: -0.15 }]],
    hits: [hit(0.1, 0.23, 12, { kx: 50, ky: -900, kind: 'launch', stop: 0.09, shake: 0.32, post: 20 })], step: [[0.04, 0.12, 240]], ev: [sfx(0.1, 'swingStaff')] },
  // Finisher branch: a whirlwind. Three turns while walking forward; everything on either side is
  // struck again and again and the last turn throws it.
  ST_FIN: { fam: 'heavy', dur: 0.86, cancel: 0.62, next: {}, tier: 2, armor: [0.04, 0.5],
    keys: [[0, SPIN({ bl: 1.57, lean: 0.1, py: 44, ua: -1.0, la: -0.6 })], [0.04, SPIN({ bl: 1.57 })], [0.52, SPIN({ bl: 1.57 - 3 * T, lean: 0.3, py: 42, f1x: 26 }), 'lin'], [0.86, SPIN({ bl: 1.2 - 3 * T, lean: 0.2, py: 44 })]],
    hits: [0.04, 0.12, 0.2, 0.28, 0.36].map((t) => hit(t, t + 0.075, 3, { kx: 120, stop: 0.025, shake: 0.1, post: 6 })).concat([hit(0.44, 0.53, 9, { kx: 560, ky: -360, kind: 'knock', stop: 0.1, shake: 0.42, post: 20 })]),
    step: [[0.04, 0.5, 220]], ev: [sfx(0.04, 'swingStaff'), sfx(0.2, 'swingStaff'), sfx(0.36, 'swingStaff'), sfx(0.44, 'swingSpin')] },
  // Dash attack: a running thrust, then one turn as you stop.
  ST_DA: { fam: 'light', dur: 0.46, cancel: 0.26, next: { light: 'ST_L2', heavy: 'ST_LAUNCH' },
    keys: [[0, { ha: -0.3, hr: 0.35, bl: 0, lean: 0.55, py: 38, ua: -0.3, la: 0 }], [0.04, { ha: -0.2, hr: 0.35, bl: 0 }], [0.1, { ha: -0.05, hr: 1, bl: 0, lean: 0.7, py: 36, f1x: 34, f2x: -30 }, 'in'],
      [0.16, SPIN({ bl: 0, lean: 0.4, py: 42 })], [0.32, SPIN({ bl: -T, lean: 0.2, py: 45 }), 'lin'], [0.46, SPIN({ bl: -T - 0.3 })]],
    hits: [hit(0.03, 0.12, 7, { kx: 220, stop: 0.05, shake: 0.18 }), hit(0.18, 0.3, 4, { kx: 260, stop: 0.04, shake: 0.14 })],
    step: [[0, 0.12, 640]], ev: [sfx(0.03, 'thrust'), sfx(0.18, 'swingStaff')] },

  // Air string: two twirls, then a helicopter spin in front of you. Each of the last two checks your
  // fall or your climb (small 'leap' events) so you hang level with the target.
  ST_A1: { fam: 'air', air: true, dur: 0.36, cancel: 0.2, next: { light: 'ST_A2', heavy: 'ST_AH' },
    keys: [[0, SPIN({ bl: 1.7, ...AIRLEGS })], [0.03, SPIN({ bl: 1.65 })], [0.21, SPIN({ bl: 1.65 - T, ...AIRLEGS, lean: 0.25 }), 'lin'], [0.36, SPIN({ bl: 1.35 - T })]],
    hits: [hit(0.03, 0.12, 4, { kx: 50, ky: -300, kind: 'pop', stop: 0.035, shake: 0.12 }), hit(0.12, 0.21, 3, { kx: 50, ky: -320, kind: 'pop', stop: 0.035, shake: 0.12 })],
    ev: [sfx(0.03, 'swingStaff'), sfx(0.12, 'swingStaff')] },
  ST_A2: { fam: 'air', air: true, dur: 0.36, cancel: 0.2, next: { light: 'ST_A3', heavy: 'ST_AH' },
    keys: [[0, SPIN({ bl: -1.5, ...AIRLEGS, lean: 0.2 })], [0.03, SPIN({ bl: -1.45 })], [0.21, SPIN({ bl: -1.45 + T, f1x: 10, f1y: 22, f2x: -10, f2y: 12, lean: 0 }), 'lin'], [0.36, SPIN({ bl: -1.2 + T })]],
    hits: [hit(0.03, 0.12, 4, { kx: 50, ky: -300, kind: 'pop', stop: 0.035, shake: 0.12 }), hit(0.12, 0.21, 3, { kx: 50, ky: -320, kind: 'pop', stop: 0.035, shake: 0.12 })],
    ev: [[0, 'leap', [60, -90]], sfx(0.03, 'swingStaff'), sfx(0.12, 'swingStaff')] },
  ST_A3: { fam: 'air', air: true, dur: 0.66, cancel: 0.5, next: {},
    keys: [[0, HELI({ bl: 0.2, ...TUCK, lean: 0.1 })], [0.03, HELI({ bl: 0.25 })], [0.45, HELI({ bl: 0.25 - 3 * T, ...TUCK, lean: 0.2 }), 'lin'], [0.66, HELI({ bl: -0.1 - 3 * T, ...AIRLEGS })]],
    hits: [0.03, 0.12, 0.21, 0.3].map((t) => hit(t, t + 0.085, 3, { kx: 40, ky: -280, kind: 'pop', stop: 0.03, shake: 0.1, post: 5 })).concat([hit(0.39, 0.47, 6, { kx: 460, ky: -420, kind: 'launch', stop: 0.09, shake: 0.34, post: 14 })]),
    ev: [[0.02, 'leap', [70, -150]], [0.22, 'leap', [70, -110]], sfx(0.03, 'swingStaff'), sfx(0.18, 'swingStaff'), sfx(0.33, 'swingSpin')] },
  // Air spike: an overhead slam with the near end.
  ST_AH: { fam: 'spike', air: true, dur: 0.46, cancel: 0.34, next: {}, tier: 2,
    keys: [[0, { ha: 1.9, hr: 0.75, bl: 2.4, ua: 1.6, la: 2.0, ...AIRLEGS }], [0.13, { ha: 2.0, hr: 0.8, bl: 2.7, ...TUCK, lean: -0.25 }], [0.22, { ha: -0.75, hr: 1, bl: -1.0, ua: -0.7, la: -0.5, lean: 0.5, f1x: 18, f1y: 8, f2x: -12, f2y: 20 }, 'in'], [0.46, { ha: -0.75, hr: 1, bl: -1.05, lean: 0.4 }]],
    hits: [hit(0.13, 0.26, 13, { kx: 140, ky: 1200, kind: 'spike', stop: 0.11, shake: 0.45, post: 26, guardBreak: true })], ev: [sfx(0.12, 'swingHeavy')] },
  // Plunge: the staff held upright below you; you land on it and the ring goes out both ways.
  ST_PLUNGE: { fam: 'spike', air: true, dur: 9, cancel: 9, next: {}, tier: 2, plunge: true, land: 'ST_LAND',
    keys: [[0, { ha: 1.5, hr: 0.6, bl: 1.57, lean: 0.05, ua: 1.4, la: 1.6, f1x: -4, f1y: 30, f2x: -14, f2y: 36 }], [0.14, { ha: -1.3, hr: 0.55, bl: -1.57, lean: 0.05, ua: -1.2, la: -1.6, f1x: -6, f1y: 34, f2x: -16, f2y: 40 }]],
    hits: [hit(0.14, 9, 8, { kx: 60, ky: 1300, kind: 'spike', stop: 0.07, post: 18, guardBreak: true })], ev: [sfx(0.02, 'swingStaff')] },
  ST_LAND: { fam: 'spike', dur: 0.5, cancel: 0.32, next: {}, tier: 2,
    keys: [[0, { ha: -1.4, hr: 0.5, bl: -1.57, lean: 0.25, py: 30, f1x: 26, f2x: -26, ua: -1.3, la: -1.6 }], [0.12, { ha: -1.4, hr: 0.5, bl: -1.57, lean: 0.2, py: 32 }],
      [0.3, SPIN({ bl: -1.57 - T * 0.75, lean: 0.1, py: 42 }), 'out'], [0.5, SPIN({ bl: -1.57 - T * 0.75, py: 46 })]],
    hits: [{ ...hit(0, 0.07, 9, { kx: 220, ky: -560, kind: 'launch', stop: 0.1, shake: 0.55, post: 24 }), shape: 'circle', ox: 0, oy: -20, r: 150 },
      hit(0.13, 0.28, 4, { kx: 300, ky: -260, kind: 'knock', stop: 0.04, shake: 0.14, post: 8 })],
    ev: [sfx(0.13, 'swingStaff')] },
  // Riposte: thrust, a full turn that clears both sides, then a vaulting strike that sends the target up.
  ST_RIP: { fam: 'riposte', dur: 0.66, cancel: 0.42, next: {}, tier: 3, invuln: [0, 0.52],
    keys: [[0, { ha: -0.2, hr: 0.35, bl: 0.05, lean: 0.5, py: 38, ua: -0.4, la: 0.1 }], [0.05, { ha: -0.05, hr: 1, bl: 0, lean: 0.7, py: 35, f1x: 34, f2x: -30 }, 'in'],
      [0.1, SPIN({ bl: 0, lean: 0.4, py: 42 })], [0.26, SPIN({ bl: -T, lean: 0.2, py: 44 }), 'lin'],
      [0.32, { ha: -0.9, hr: 0.9, bl: -0.5 - T, lean: 0.45, py: 34 }], [0.4, { ha: 1.2, hr: 1, bl: 1.3 - T, lean: -0.2, py: 54 }, 'in'], [0.66, { ha: 1.3, hr: 0.9, bl: 1.5 - T, lean: -0.15 }]],
    hits: [hit(0.01, 0.08, 18, { kx: 60, stop: 0.08, shake: 0.3, post: 20, unblockable: true }), hit(0.1, 0.27, 14, { kx: 60, stop: 0.06, shake: 0.24, post: 14, unblockable: true }),
      hit(0.3, 0.42, 26, { kx: 80, ky: -950, kind: 'launch', stop: 0.15, shake: 0.6, post: 30, unblockable: true })],
    step: [[0, 0.08, 600]], ev: [sfx(0.01, 'thrust'), sfx(0.1, 'swingStaff'), sfx(0.3, 'swingSpin'), [0.02, 'fx', 'riposteLine']] },
};

// ───────────── Shared by the three forms below ─────────────
// Everything a form does beyond its poses lives on the fighter that holds it (`f.lash`, `f.fistCharge`,
// `f.sheathed`, `f.cuts`), so any fighter can use a form: the player, its mirror image, or a foe that
// copies the player. Nothing here reads `world.player`. Mechanics hang off three hooks: `blade.tick`
// runs every frame, a hit's `onHit` runs after the hit resolves, and a `[t, 'form', fn]` event runs fn.
const landed = (r) => r === 'hit' || r === 'break' || r === 'kill';
const foes = (f, e) => e !== f && !e.dead && !e.phantom && !e.remove && e.team !== f.team;

// ───────────── Lash ─────────────
// A whip of light about twice the saber's reach. The pose aims a straight line from the hand (`bl`), and
// the whip is a chain of points that chases that line, stiff near the hand and loose at the tip, so a
// swing unrolls and the tip snaps last. When it is not attacking it hangs from the hand and drags on
// the floor. The hit test uses the chain itself (combat.js), the inner part never connects, and the
// tip deals the most.
const WN = 12;            // points along the whip, the hand included
const CRACK_V = 3000;     // tip speed, in units a second, past which the tip cracks
function whipTick(f, world, dt) {
  let q = f.lash, o = f.lashO;
  const hx = f.bx, hy = f.by, last = WN * 2 - 2;
  let tx = f.tx, ty = f.ty; // where the pose aims the tip
  if (!q) {
    q = f.lash = new Float32Array(WN * 2); o = f.lashO = new Float32Array(WN * 2);
    for (let i = 0; i < WN; i++) { const u = i / (WN - 1); q[i * 2] = o[i * 2] = hx + (tx - hx) * u; q[i * 2 + 1] = o[i * 2 + 1] = hy + (ty - hy) * u; }
    f.lashDt = dt; f.lashV = 0; f.crackT = 0;
  }
  const H = f.lashHold;
  if (H) { if ((f.lashHoldT -= dt) <= 0 || H.dead || H.remove) f.lashHold = null; else { tx = H.cx; ty = H.cy; } }
  const taut = !f.rag && !f.dead && (f.state === 'attack' || !!f.lashHold); // a guard lets it hang
  const seg = f.bladeLen / (WN - 1), floor = (f.rag || !f.onGround ? 0 : f.y) - 2;
  // Time-corrected verlet, the same as the ribbons, so the whip slows with the rest of the world.
  const keep = Math.exp(-(taut ? 8 : 3.5) * dt) * (dt / (f.lashDt || dt)), g = (taut ? 500 : 2400) * dt * dt; // a little droop even when swung
  q[0] = o[0] = hx; q[1] = o[1] = hy;
  for (let i = 1; i < WN; i++) {
    const a = i * 2, u = i / (WN - 1);
    const vx = (q[a] - o[a]) * keep, vy = (q[a + 1] - o[a + 1]) * keep;
    o[a] = q[a]; o[a + 1] = q[a + 1];
    q[a] += vx; q[a + 1] += vy + g;
    if (taut) {
      // Stiff near the hand, loose toward the tip: the lag is what makes the swing unroll.
      const k = 1 - Math.exp(-(f.lashHold ? 40 : 72 * (1 - 0.76 * u)) * dt);
      q[a] += (hx + (tx - hx) * u - q[a]) * k; q[a + 1] += (hy + (ty - hy) * u - q[a + 1]) * k;
    }
  }
  for (let it = 0; it < 3; it++) {
    for (let i = 1; i < WN; i++) {
      const a = i * 2, dx = q[a] - q[a - 2], dy = q[a + 1] - q[a - 1], d = Math.sqrt(dx * dx + dy * dy) || 1e-3;
      if (d > seg) { const k = seg / d; q[a] = q[a - 2] + dx * k; q[a + 1] = q[a - 1] + dy * k; }
      if (q[a + 1] > floor) { q[a + 1] = floor; o[a] += (q[a] - o[a]) * 0.4; } // drags on the floor
    }
  }
  f.lashDt = dt;
  // The crack: when the tip's speed peaks above the threshold, it snaps.
  const v = Math.hypot(q[last] - o[last], q[last + 1] - o[last + 1]) / dt;
  if (f.crackT > 0) f.crackT -= dt;
  if (f.state === 'attack' && f.lashV > CRACK_V && v < f.lashV && f.crackT <= 0 && f.armed) {
    f.crackT = 0.14;
    const x = q[last], y = q[last + 1], fx = world.fx;
    fx.spark(x, y, 0, 3.14, 7, 460, '#ffffff', { white: 0.8, life: 0.2 }); fx.flash(x, y, 34, f.color, 0.08); fx.ring(x, y, 4, 34, 0.12, '#ffffff', 1, 2);
    world.sfx('lashCrack', x, f.isPlayer ? 0.9 : 0.7);
  }
  f.lashV = v;
  f.tx = q[last]; f.ty = q[last + 1];
}

// Every lash hit: a guard turns the whip back on its owner, and a tip strike rings out.
function lashHit(world, A, B, r) {
  if (r === 'block') {
    world.fx.spark(A.tx, A.ty, 0, 3.14, 8, 380, '#ffffff', { white: 0.6 }); world.sfx('lashDeflect', A.tx);
    if (A.state === 'attack' && A.move.fam !== 'riposte') { A.setState('recoil', 0.24); A.vx = -A.facing * 140; }
    return;
  }
  if (landed(r) && A.tipK >= 0.75) { world.fx.ring(B.cx, B.cy, 6, 56, 0.16, '#ffffff', 1, 3); world.sfx('lashTip', B.x, 0.8); }
}
// Holds the target at the tip for a moment, so the whip is seen to wrap it.
function lashWrap(world, A, B, r) {
  lashHit(world, A, B, r);
  if (r !== 'hit' && r !== 'break') return;
  A.lashHold = B; A.lashHoldT = 0.42;
  world.sfx('lashWrap', B.x);
}
// Bodies too big to move: the lash pulls its owner to them instead.
const anchored = (B) => !!(B.def.boss || B.def.armor >= 2 || B.def.noRagdoll || B.def.prop || B.riding || B.scale > 1.3 || (B.def.beast && B.scale > 1.1));
// The heavy: wrap the target and bring it to where the whip bites hardest (dragged in from afar,
// shoved out from too close), or, if it will not move, drag yourself to it.
function lashPull(world, A, B, r) {
  lashHit(world, A, B, r);
  if (r !== 'hit' && r !== 'break') return;
  A.lashHold = B; A.lashHoldT = 0.3;
  const dir = B.x >= A.x ? 1 : -1, go = Math.abs(B.x - A.x) - A.bladeLen * 0.72, fx = world.fx; // < 0: too close
  if (anchored(B)) {
    A.vx = dir * Math.min(1500, Math.sqrt(2 * 2400 * Math.max(0, Math.abs(B.x - A.x) - 80))); A.invuln = Math.max(A.invuln, 0.2);
    fx.ghost(A, A.color, 0.25);
  } else if (B.rag) B.rag.kick(-dir * Math.max(-600, Math.min(900, go * 4)), -240, 0);
  else {
    const fr = B.state === 'stagger' ? 2200 : 1500;
    if (B.state !== 'stagger') B.setState('hitstun', 0.55);
    B.vx = -dir * Math.sign(go) * Math.sqrt(2 * fr * Math.abs(go));
  }
  fx.slash((A.x + B.x) / 2, B.cy, 0, Math.abs(B.x - A.x), A.color, 0.18, 3);
  world.sfx('lashPull', B.x);
}
// In the air: wrap and drive the target down.
function lashSlam(world, A, B, r) {
  lashWrap(world, A, B, r);
  if (landed(r)) world.sfx('lashSlam', B.x);
}

const LW = { ha: 2.0, hr: 0.75, bl: 2.3, lean: -0.2, py: 48, ua: -0.9, la: -0.3 };   // overhand wind-up: the whip trails up behind
const LS = { ha: -0.12, hr: 1, bl: -0.06, lean: 0.28, py: 45, f1x: 24, ua: -2.4, la: -2.0 }; // the crack: arm and whip straight ahead
const LWU = { ha: -1.5, hr: 0.8, bl: -2.6, lean: 0.3, py: 43, ua: -0.6, la: 0.1 };  // low wind-up: the whip trails behind along the floor
const LSU = { ha: 0.3, hr: 1, bl: 0.16, lean: -0.05, py: 48, f1x: 20, ua: -2.3, la: -2.2 }; // rising crack
const LHI = { ha: 1.45, hr: 0.9, ua: -0.6, la: 0.4 };                              // hand above the head, for the whirl
const LYANK = { ha: -2.6, hr: 0.75, bl: 0.05, lean: -0.3, py: 47, f1x: 12, f2x: -28, ua: -2.0, la: -1.3 }; // hand torn back to the hip
const lx = (t, d, o = {}) => hit(t, t + d, o.dmg ?? 8, { kx: 90, stop: 0.05, shake: 0.16, onHit: lashHit, ...o });

const la = {
  // Light string: an overhand crack, a rising crack, a figure of eight, then a whirl overhead that
  // ends in a crack that throws. Each crack gives a little ground, so the tip stays on the target.
  LA_L1: { fam: 'light', dur: 0.42, cancel: 0.24, next: { light: 'LA_L2', heavy: 'LA_H1' },
    keys: [[0, LW], [0.07, { ...LW, bl: 2.5 }], [0.15, LS, 'in'], [0.42, { ...LS, ha: -0.35, hr: 0.85, bl: -0.45, lean: 0.15 }]],
    hits: [lx(0.11, 0.13)], step: [[0, 0.07, -150]], ev: [sfx(0.06, 'swingLash')] },
  LA_L2: { fam: 'light', dur: 0.42, cancel: 0.24, next: { light: 'LA_L3', heavy: 'LA_LAUNCH' },
    keys: [[0, LWU], [0.06, { ...LWU, bl: -2.8 }], [0.14, LSU, 'in'], [0.42, { ...LSU, ha: 0.5, hr: 0.9, bl: 0.6 }]],
    hits: [lx(0.1, 0.13, { kx: 80 })], step: [[0, 0.06, -150]], ev: [sfx(0.05, 'swingLash')] },
  LA_L3: { fam: 'light', dur: 0.5, cancel: 0.3, next: { light: 'LA_L4', heavy: 'LA_FIN' },
    keys: [[0, LW], [0.05, { ...LW, bl: 2.5 }], [0.12, LS, 'in'], [0.2, { ha: 1.0, hr: 0.85, bl: 1.2, lean: 0, py: 47, ua: -1.6, la: -0.8 }], [0.28, { ...LS, ha: 0.05, bl: 0.12 }, 'in'], [0.5, { ...LS, bl: -0.3 }]],
    hits: [lx(0.09, 0.1, { dmg: 6, kx: 40 }), lx(0.24, 0.11, { dmg: 7 })], ev: [sfx(0.05, 'swingLash'), sfx(0.2, 'swingLash')] },
  LA_L4: { fam: 'light', dur: 0.72, cancel: 0.48, next: {},
    keys: [[0, { ...LHI, bl: 3.0, lean: 0, py: 48 }], [0.04, { ...LHI, bl: 3.0 }], [0.34, { ...LHI, bl: 3.0 - 2 * T, py: 50, f1x: 18 }, 'lin'],
      [0.44, { ...LS, bl: -0.1 - 2 * T, lean: 0.4, f1x: 30 }, 'in'], [0.72, { ...LS, bl: -0.4 - 2 * T }]],
    hits: [lx(0.06, 0.09, { dmg: 3, kx: 60, stop: 0.03, shake: 0.1 }), lx(0.15, 0.09, { dmg: 3, kx: 60, stop: 0.03, shake: 0.1 }), lx(0.24, 0.09, { dmg: 3, kx: 60, stop: 0.03, shake: 0.1 }),
      lx(0.38, 0.12, { dmg: 13, kx: 520, ky: -380, kind: 'knock', stop: 0.1, shake: 0.42, post: 18 })],
    step: [[0.04, 0.3, 90]], ev: [sfx(0.05, 'swingLash'), sfx(0.2, 'swingLash'), sfx(0.36, 'swingSpin')] },

  // Heavy: the whip is thrown out straight, wraps what it meets and is torn back, dragging the target
  // in. Something too heavy to move drags you to it instead. Armoured through the throw.
  LA_H1: { fam: 'heavy', dur: 0.66, cancel: 0.42, next: { light: 'LA_L2' }, tier: 2, armor: [0.02, 0.22],
    keys: [[0, { ha: 2.3, hr: 0.8, bl: 2.9, lean: -0.3, py: 50, ua: -0.4, la: 0.3, f2x: -26 }], [0.16, { ha: 2.4, hr: 0.85, bl: 3.1, lean: -0.35, py: 51 }],
      [0.24, { ha: -0.05, hr: 1, bl: 0, lean: 0.4, py: 43, f1x: 30, ua: -2.4, la: -2.2 }, 'in'], [0.36, { ha: -0.05, hr: 1, bl: 0, lean: 0.35 }], [0.46, LYANK, 'out'], [0.66, { ...LYANK, ha: -2.0, hr: 0.7, bl: 0.6, lean: -0.1 }]],
    hits: [lx(0.2, 0.16, { dmg: 8, kx: 0, stun: 0.55, stop: 0.06, shake: 0.22, post: 12, onHit: lashPull })], ev: [sfx(0.04, 'lashWind'), sfx(0.16, 'swingLash')] },
  // Launcher: the whip snakes along the floor and is yanked straight up, the target with it.
  LA_LAUNCH: { fam: 'launch', dur: 0.46, cancel: 0.26, next: {}, rise: 0.22,
    keys: [[0, LWU], [0.08, { ...LWU, ha: -1.6, bl: -2.8 }], [0.16, LSU, 'in'], [0.24, { ha: 1.5, hr: 1, bl: 1.35, lean: -0.25, py: 54, ua: 1.2, la: 1.6 }, 'out'], [0.46, { ha: 1.6, hr: 0.9, bl: 1.6, lean: -0.15 }]],
    hits: [lx(0.12, 0.14, { dmg: 11, kx: -60, ky: -980, kind: 'launch', stop: 0.09, shake: 0.32, post: 18 })], ev: [sfx(0.07, 'swingLash'), sfx(0.2, 'lashPull')] },
  // Finisher branch: a crack that wraps, then the target is heaved over your head and thrown behind you.
  LA_FIN: { fam: 'heavy', dur: 0.8, cancel: 0.56, next: {}, tier: 2,
    keys: [[0, LW], [0.06, { ...LW, bl: 2.5 }], [0.13, LS, 'in'], [0.22, { ...LS, bl: 0.05 }], [0.42, { ha: 2.4, hr: 0.9, bl: 2.2, lean: -0.4, py: 52, f1x: 8, f2x: -30, ua: 1.6, la: 2.2 }, 'out'], [0.8, { ha: 2.2, hr: 0.85, bl: 2.6, lean: -0.25 }]],
    hits: [lx(0.09, 0.12, { dmg: 6, kx: 0, stun: 0.7, onHit: lashWrap }), lx(0.26, 0.16, { dmg: 15, kx: -700, ky: -640, kind: 'knock', stop: 0.11, shake: 0.45, post: 24 })],
    ev: [sfx(0.06, 'swingLash'), sfx(0.24, 'swingHeavy')] },
  // Dash attack: a running crack.
  LA_DA: { fam: 'light', dur: 0.42, cancel: 0.24, next: { light: 'LA_L2', heavy: 'LA_LAUNCH' },
    keys: [[0, { ...LW, lean: 0.5, py: 40 }], [0.05, { ...LW, bl: 2.6, lean: 0.55, py: 39 }], [0.13, { ...LS, lean: 0.55, py: 40, f1x: 32 }, 'in'], [0.42, { ...LS, bl: -0.4, lean: 0.3 }]],
    hits: [lx(0.09, 0.13, { dmg: 10, kx: 160, stop: 0.06, shake: 0.2 })], step: [[0, 0.12, 560]], ev: [sfx(0.05, 'swingLash')] },

  // Air string: a downward crack, a rising one, then the whip whirls round the body and throws.
  LA_A1: { fam: 'air', air: true, dur: 0.34, cancel: 0.18, next: { light: 'LA_A2', heavy: 'LA_AH' },
    keys: [[0, { ...LW, ...AIRLEGS }], [0.05, { ...LW, bl: 2.5 }], [0.12, { ...LS, ha: -0.35, bl: -0.35, ...AIRLEGS, lean: 0.3 }, 'in'], [0.34, { ...LS, ha: -0.45, bl: -0.5 }]],
    hits: [lx(0.08, 0.12, { dmg: 7, kx: 60, ky: -320, kind: 'pop', stop: 0.04 })], ev: [sfx(0.05, 'swingLash')] },
  LA_A2: { fam: 'air', air: true, dur: 0.34, cancel: 0.18, next: { light: 'LA_A3', heavy: 'LA_AH' },
    keys: [[0, { ...LWU, ...AIRLEGS, py: 47 }], [0.05, { ...LWU, bl: -2.7 }], [0.12, { ...LSU, f1x: 10, f1y: 22, f2x: -10, f2y: 12 }, 'in'], [0.34, { ...LSU, bl: 0.5 }]],
    hits: [lx(0.08, 0.12, { dmg: 7, kx: 60, ky: -340, kind: 'pop', stop: 0.04 })], ev: [[0, 'leap', [70, -90]], sfx(0.05, 'swingLash')] },
  LA_A3: { fam: 'air', air: true, dur: 0.5, cancel: 0.34, next: {},
    keys: [[0, { ha: -0.3, hr: 0.8, bl: 1.6, ...TUCK, lean: 0.1, ua: -0.6, la: 0 }], [0.03, { ha: -0.3, hr: 0.8, bl: 1.6 }], [0.3, { ha: -0.3, hr: 0.9, bl: 1.6 - 2 * T, ...TUCK, lean: 0.2 }, 'lin'], [0.5, { ha: -0.3, hr: 0.9, bl: 1.2 - 2 * T, ...AIRLEGS }]],
    hits: [lx(0.04, 0.09, { dmg: 4, kx: 40, ky: -280, kind: 'pop', stop: 0.03, shake: 0.1, post: 5 }), lx(0.14, 0.09, { dmg: 4, kx: 40, ky: -280, kind: 'pop', stop: 0.03, shake: 0.1, post: 5 }),
      lx(0.24, 0.1, { dmg: 9, kx: 460, ky: -420, kind: 'launch', stop: 0.09, shake: 0.34, post: 14 })],
    ev: [[0.02, 'leap', [60, -140]], sfx(0.03, 'swingLash'), sfx(0.2, 'swingSpin')] },
  // Air heavy: the whip wraps the target and slams it into the floor.
  LA_AH: { fam: 'spike', air: true, dur: 0.5, cancel: 0.36, next: {}, tier: 2,
    keys: [[0, { ...LW, ...AIRLEGS, bl: 2.4 }], [0.12, { ...LW, bl: 2.8, ...TUCK, lean: -0.3 }], [0.2, { ha: -0.6, hr: 1, bl: -0.7, lean: 0.4, ...AIRLEGS, ua: -2.2, la: -1.8 }, 'in'],
      [0.3, { ha: -1.5, hr: 0.9, bl: -1.2, lean: 0.55 }], [0.5, { ha: -1.4, hr: 0.85, bl: -1.3, lean: 0.4 }]],
    hits: [lx(0.15, 0.15, { dmg: 14, kx: -120, ky: 1300, kind: 'spike', stop: 0.11, shake: 0.45, post: 26, guardBreak: true, onHit: lashSlam })], ev: [sfx(0.11, 'swingLash')] },
  // Plunge: the whip trails straight down below you; the landing whirls it flat around you.
  LA_PLUNGE: { fam: 'spike', air: true, dur: 9, cancel: 9, next: {}, tier: 2, plunge: true, land: 'LA_LAND',
    keys: [[0, { ha: 1.6, hr: 0.7, bl: 1.57, lean: 0.05, ua: 1.4, la: 1.2, f1x: -4, f1y: 30, f2x: -14, f2y: 36 }], [0.14, { ha: -1.4, hr: 0.8, bl: -1.57, lean: 0.12, f1x: -6, f1y: 34, f2x: -16, f2y: 40 }]],
    hits: [hit(0.14, 9, 7, { kx: 60, ky: 1300, kind: 'spike', stop: 0.06, shake: 0.18, post: 16, guardBreak: true, onHit: lashHit })], ev: [sfx(0.02, 'swingLash')] },
  LA_LAND: { fam: 'spike', dur: 0.5, cancel: 0.32, next: {}, tier: 2,
    keys: [[0, { ha: -0.3, hr: 0.9, bl: -0.2, lean: 0.4, py: 28, f1x: 26, f2x: -26 }], [0.3, { ha: -0.3, hr: 0.9, bl: -0.2 - T, lean: 0.3, py: 32 }, 'lin'], [0.5, { py: 44, bl: -0.5 - T }]],
    hits: [{ ...hit(0, 0.08, 8, { kx: 200, ky: -560, kind: 'launch', stop: 0.1, shake: 0.5, post: 20 }), shape: 'circle', ox: 0, oy: -20, r: 170 }, lx(0.1, 0.18, { dmg: 4, kx: 260, ky: -240, kind: 'knock' })],
    ev: [sfx(0.02, 'lashCrack'), sfx(0.1, 'swingLash')] },
  // Riposte: the whip wraps the attacker and tears it in, then a full crack throws it away.
  LA_RIP: { fam: 'riposte', dur: 0.7, cancel: 0.46, next: {}, tier: 3, invuln: [0, 0.55],
    keys: [[0, { ha: 2.2, hr: 0.8, bl: 2.6, lean: 0.2, py: 44 }], [0.04, { ha: -0.05, hr: 1, bl: 0, lean: 0.45, py: 42, f1x: 30, ua: -2.4, la: -2.2 }, 'in'], [0.2, LYANK, 'out'],
      [0.3, { ...LW, bl: 2.6, lean: -0.2 }], [0.38, { ...LS, lean: 0.5, f1x: 34 }, 'in'], [0.7, { ...LS, bl: -0.4, lean: 0.35 }]],
    hits: [lx(0.02, 0.12, { dmg: 10, kx: 0, stun: 0.7, stop: 0.06, shake: 0.24, post: 14, unblockable: true, onHit: lashPull }),
      lx(0.34, 0.12, { dmg: 30, kx: 560, ky: -320, kind: 'knock', stop: 0.15, shake: 0.6, post: 28, unblockable: true })],
    ev: [sfx(0.02, 'swingLash'), sfx(0.3, 'swingSpin'), [0.36, 'fx', 'riposteLine']] },
};

// ───────────── Gauntlets ─────────────
// Two fists with short blades of light on the knuckles, one per hand (a twin blade along each forearm).
// The quickest strings and the shortest reach; every punch steps in. Each punch that lands adds to
// `f.fistCharge` (0 to 1), shown as the fists glowing brighter. The heavy spends all of it on a
// shockwave that grows with it, and at full charge launches everything near and breaks guards.
const FIST_GAIN = 0.125;  // eight landed punches fill the charge
function fistTick(f, world, dt) {
  if (f.fistCharge > 0 && world.time - (f.fistT ?? 0) > 4) f.fistCharge = Math.max(0, f.fistCharge - dt * 0.25); // idle fists cool off
  if (f.fistCharge >= 1 && f.armed && !f.rag && rng() < dt * 14) world.fx.spark(f.bx, f.by, 0, 3.14, 1, 220, f.color, { white: 0.5, life: 0.18, grav: 0 });
}
function fistGain(world, A, B, r) {
  if (!landed(r) || A.fistCharge >= 1) return;
  A.fistCharge = Math.min(1, A.fistCharge + FIST_GAIN); A.fistT = world.time;
  if (A.fistCharge >= 1) {
    world.fx.ring(A.bx, A.by, 4, 46, 0.25, A.color, 1, 3); world.fx.flash(A.bx, A.by, 50, A.color, 0.12);
    world.fx.text(A.x, A.j[1] - 40, 'CHARGED', A.color, 14, 0.7); world.sfx('gaFull', A.x);
  } else world.sfx('gaCharge', A.x, 0.45, 0.8 + A.fistCharge * 0.6);
}
// The charged punch: a ring of force in front of the fist, sized and weighted by the charge it spends.
function gaBlast(world, f) {
  const c = f.fistCharge, full = c >= 1, fx = world.fx;
  f.fistCharge = 0;
  const s = f.scale, r = (70 + 110 * c) * s, ox = f.x + f.facing * (34 + 26 * c) * s, oy = f.y - 60 * s;
  const h = { dmg: 4 + 26 * c, post: full ? 200 : 10 + 60 * c, kx: full ? 260 : 220 + 320 * c, ky: full ? -920 : -260 * c, kind: full ? 'launch' : c >= 0.5 ? 'knock' : 'flinch',
    stop: 0.04 + 0.08 * c, shake: 0.15 + 0.4 * c, stun: 0.45, guardBreak: full, id: 'GA_BLAST', fam: 'heavy' };
  for (const e of world.fighters) {
    if (!foes(f, e)) continue;
    const C = hurtCircles(e);
    for (let i = 0; i < 12; i += 3) if (Math.hypot(C[i] - ox, C[i + 1] - oy) < r + C[i + 2]) { applyHit(world, f, e, h, C[i], C[i + 1]); break; }
  }
  fx.ring(ox, oy, 10, r, 0.3, f.color, 1, 4 + 4 * c); fx.ring(ox, oy, 6, r * 0.6, 0.22, '#ffffff', 1, 3);
  fx.flash(ox, oy, 60 + 120 * c, f.color, 0.12 + 0.08 * c); fx.spark(ox, oy, f.facing > 0 ? 0 : Math.PI, 0.5 + 0.6 * c, 8 + 26 * c, 500 + 400 * c, f.color, { white: 0.5 });
  if (c > 0.3) fx.dust(ox, f.y, 3 + 6 * c, f.facing, 200 + 200 * c);
  world.sfx(full ? 'gaBlastFull' : 'gaBlast', ox, 0.6 + 0.4 * c, 1.2 - 0.4 * c);
  world.shake(0.15 + 0.45 * c); world.stop(0.03 + 0.08 * c, full);
  if (full) { world.punch(0.035); fx.ring(f.x, f.y - 2, 20, r * 1.4, 0.4, f.color, 0.22, 6); fx.text(ox, oy - r * 0.5, 'BREAKER', f.color, 18, 0.8); }
}

const GJC = { ha: -0.25, hr: 0.35, bl: 0.35 };   // weapon fist chambered at the chest
const GJX = { ha: -0.05, hr: 1, bl: -0.05 };     // weapon fist thrown straight out
const GOC = { ua: -1.9, la: 0.6 };               // off fist up by the chin
const GOX = { ua: -0.08, la: -0.08 };            // off fist thrown straight out
const GBACK = { ha: -2.5, hr: 0.6, bl: -2.4, ua: -2.4, la: -2.2 }; // both fists drawn back past the hip
const px = (t, d, dmg, o = {}) => hit(t, t + d, dmg, { kx: 70, stop: 0.035, shake: 0.1, stun: 0.28, onHit: fistGain, ...o });
const GSTEP = [[0, 0.07, 320]];

const ga = {
  // Light string: jab, cross, overhand, body blow, then an uppercut and both fists together.
  GA_L1: { fam: 'light', dur: 0.22, cancel: 0.11, next: { light: 'GA_L2', heavy: 'GA_H1' },
    keys: [[0, { ...GJC, ...GOC, lean: 0.15, py: 44, f1x: 18, f2x: -20 }], [0.03, { ...GJC, ha: -0.2 }], [0.075, { ...GJX, ...GOC, lean: 0.35, py: 42, f1x: 26 }, 'in'], [0.22, { ...GJC, ha: -0.15, hr: 0.5, ...GOC, lean: 0.2, py: 44 }]],
    hits: [px(0.035, 0.065, 5)], step: GSTEP, ev: [sfx(0.03, 'swingFist')] },
  GA_L2: { fam: 'light', dur: 0.22, cancel: 0.11, next: { light: 'GA_L3', heavy: 'GA_LAUNCH' },
    keys: [[0, { ...GJC, ...GOC, lean: 0.2, py: 44 }], [0.03, { ...GOC, ua: -2.1, la: 0.3 }], [0.075, { ...GOX, ...GJC, ha: -0.4, lean: 0.4, py: 42, f1x: 26 }, 'in'], [0.22, { ...GOC, ...GJC, lean: 0.2, py: 44 }]],
    hits: [px(0.035, 0.065, 5)], step: GSTEP, ev: [sfx(0.03, 'swingFist')] },
  GA_L3: { fam: 'light', dur: 0.24, cancel: 0.12, next: { light: 'GA_L4', heavy: 'GA_FIN' },
    keys: [[0, { ha: 1.2, hr: 0.7, bl: 1.4, ...GOC, lean: -0.05, py: 47 }], [0.03, { ha: 1.3, hr: 0.75, bl: 1.5 }], [0.08, { ha: -0.15, hr: 1, bl: -0.25, ...GOC, lean: 0.4, py: 42, f1x: 26 }, 'in'], [0.24, { ...GJC, ...GOC, lean: 0.2, py: 44 }]],
    hits: [px(0.04, 0.07, 5.5, { kx: 90 })], step: GSTEP, ev: [sfx(0.035, 'swingFist')] },
  GA_L4: { fam: 'light', dur: 0.24, cancel: 0.12, next: { light: 'GA_L5', heavy: 'GA_FIN' },
    keys: [[0, { ...GJC, ...GOC, lean: 0.3, py: 40 }], [0.03, { ...GOC, ua: -2.4, la: -0.6, py: 38 }], [0.08, { ua: -0.45, la: -0.35, ...GJC, lean: 0.5, py: 37, f1x: 28 }, 'in'], [0.24, { ...GJC, ...GOC, lean: 0.25, py: 43 }]],
    hits: [px(0.04, 0.07, 5.5, { kx: 90 })], step: GSTEP, ev: [sfx(0.035, 'swingFist')] },
  GA_L5: { fam: 'light', dur: 0.5, cancel: 0.32, next: {},
    keys: [[0, { ...GJC, ...GOC, lean: 0.1, py: 44 }], [0.03, { ha: -1.3, hr: 0.6, bl: -0.9, py: 40 }], [0.08, { ha: 1.1, hr: 1, bl: 1.3, lean: -0.1, py: 50 }, 'in'],
      [0.16, { ...GBACK, lean: -0.2, py: 46 }], [0.22, { ...GJX, ...GOX, lean: 0.6, py: 38, f1x: 34, f2x: -28 }, 'in'], [0.5, { ...GJX, hr: 0.8, ...GOX, lean: 0.4, py: 41 }]],
    hits: [px(0.04, 0.07, 5, { kx: 40, ky: -280, kind: 'pop' }), px(0.19, 0.1, 11, { kx: 560, ky: -260, kind: 'knock', stop: 0.09, shake: 0.38, post: 16 })],
    step: [[0, 0.07, 260], [0.17, 0.24, 420]], ev: [sfx(0.035, 'swingFist'), sfx(0.18, 'swingHeavy')] },

  // Heavy: the fist is drawn all the way back and driven out with everything the hits have built up.
  // Armoured through the wind-up.
  GA_H1: { fam: 'heavy', dur: 0.62, cancel: 0.4, next: { light: 'GA_L2' }, tier: 2, armor: [0.03, 0.3],
    keys: [[0, { ...GOC, ha: -2.5, hr: 0.6, bl: -2.3, lean: -0.2, py: 46, f1x: 22, f2x: -26 }], [0.2, { ha: -2.7, hr: 0.65, bl: -2.5, lean: -0.3, py: 44, ua: -1.6, la: 0.9 }],
      [0.27, { ...GJX, lean: 0.65, py: 37, f1x: 36, f2x: -30, ua: -2.6, la: -2.4 }, 'in'], [0.62, { ...GJX, hr: 0.85, lean: 0.4, py: 41, ua: -2.4, la: -2.0 }]],
    hits: [hit(0.23, 0.31, 6, { kx: 260, stop: 0.06, shake: 0.2, post: 14 })], step: [[0.2, 0.27, 360]], ev: [sfx(0.03, 'gaWind'), sfx(0.21, 'swingFist'), [0.27, 'form', gaBlast]] },
  // Launcher: a rising uppercut.
  GA_LAUNCH: { fam: 'launch', dur: 0.42, cancel: 0.22, next: {}, rise: 0.18,
    keys: [[0, { ha: -1.4, hr: 0.6, bl: -1.0, lean: 0.45, py: 34, f1x: 24, ...GOC }], [0.08, { ha: -1.45, hr: 0.6, bl: -1.1, py: 32 }], [0.16, { ha: 1.35, hr: 1, bl: 1.45, lean: -0.15, py: 56, ...GOC }, 'in'], [0.42, { ha: 1.4, hr: 0.9, bl: 1.5, lean: -0.1 }]],
    hits: [px(0.09, 0.11, 10, { kx: 40, ky: -980, kind: 'launch', stop: 0.09, shake: 0.32, post: 18 })], step: [[0.04, 0.12, 260]], ev: [sfx(0.08, 'swingFist')] },
  // Finisher branch: a rush of six straights, hands alternating, then both fists together.
  GA_FIN: { fam: 'heavy', dur: 0.78, cancel: 0.54, next: {}, tier: 2,
    keys: [[0, { ...GJC, ...GOC, lean: 0.4, py: 42, f1x: 26, f2x: -26 }], [0.04, { ...GJX, ...GOC }, 'in'], [0.08, { ...GJC, ...GOX }, 'in'], [0.12, { ...GJX, ...GOC }, 'in'],
      [0.16, { ...GJC, ...GOX }, 'in'], [0.2, { ...GJX, ...GOC }, 'in'], [0.24, { ...GJC, ...GOX }, 'in'], [0.34, { ...GBACK, lean: -0.2, py: 46 }], [0.42, { ...GJX, ...GOX, lean: 0.65, py: 37, f1x: 36, f2x: -30 }, 'in'], [0.78, { ...GJX, hr: 0.85, ...GOX, lean: 0.4, py: 41 }]],
    hits: [0, 1, 2, 3, 4, 5].map((i) => px(0.02 + i * 0.04, 0.035, 2.5, { kx: 50, stop: 0.025, shake: 0.08, post: 4 })).concat([px(0.4, 0.1, 12, { kx: 600, ky: -300, kind: 'knock', stop: 0.1, shake: 0.42, post: 20 })]),
    step: [[0, 0.26, 140], [0.36, 0.42, 420]], ev: [sfx(0.02, 'swingFist'), sfx(0.1, 'swingFist'), sfx(0.18, 'swingFist'), sfx(0.38, 'swingHeavy')] },
  // Dash attack: a flying straight.
  GA_DA: { fam: 'light', dur: 0.4, cancel: 0.22, next: { light: 'GA_L2', heavy: 'GA_LAUNCH' },
    keys: [[0, { ...GOC, ha: -2.4, hr: 0.6, bl: -2.2, lean: 0.6, py: 40 }], [0.05, { ha: -2.4, hr: 0.6, bl: -2.2, lean: 0.6, py: 40 }],
      [0.12, { ...GJX, lean: 0.75, py: 50, f1x: 10, f1y: 16, f2x: -34, f2y: 10, ua: -2.6, la: -2.4 }, 'in'], [0.4, { ...GJX, hr: 0.85, lean: 0.4, py: 44, f1y: 0, f2y: 0 }]],
    hits: [px(0.07, 0.13, 9, { kx: 300, stop: 0.07, shake: 0.24 })], step: [[0, 0.14, 640]], ev: [sfx(0.06, 'swingFist')] },

  // Air string: jab, cross, overhand, then a double hammer that knocks the target away.
  GA_A1: { fam: 'air', air: true, dur: 0.22, cancel: 0.11, next: { light: 'GA_A2', heavy: 'GA_AH' },
    keys: [[0, { ...GJC, ...GOC, ...AIRLEGS }], [0.03, { ...GJC }], [0.075, { ...GJX, ha: -0.3, bl: -0.3, ...GOC, ...AIRLEGS, lean: 0.3 }, 'in'], [0.22, { ...GJC, ...GOC }]],
    hits: [px(0.035, 0.065, 4.5, { kx: 40, ky: -300, kind: 'pop' })], ev: [sfx(0.03, 'swingFist')] },
  GA_A2: { fam: 'air', air: true, dur: 0.22, cancel: 0.11, next: { light: 'GA_A3', heavy: 'GA_AH' },
    keys: [[0, { ...GJC, ...GOC, ...AIRLEGS }], [0.03, { ...GOC, ua: -2.1, la: 0.3 }], [0.075, { ua: -0.35, la: -0.35, ...GJC, ...AIRLEGS, lean: 0.3 }, 'in'], [0.22, { ...GJC, ...GOC }]],
    hits: [px(0.035, 0.065, 4.5, { kx: 40, ky: -300, kind: 'pop' })], ev: [[0, 'leap', [80, -80]], sfx(0.03, 'swingFist')] },
  GA_A3: { fam: 'air', air: true, dur: 0.24, cancel: 0.12, next: { light: 'GA_A4', heavy: 'GA_AH' },
    keys: [[0, { ha: 1.2, hr: 0.7, bl: 1.4, ...GOC, ...AIRLEGS }], [0.03, { ha: 1.3, hr: 0.75, bl: 1.5 }], [0.08, { ha: -0.4, hr: 1, bl: -0.5, ...GOC, lean: 0.35, f1x: 10, f1y: 22, f2x: -10, f2y: 12 }, 'in'], [0.24, { ...GJC, ...GOC }]],
    hits: [px(0.04, 0.07, 5, { kx: 40, ky: -320, kind: 'pop' })], ev: [[0, 'leap', [80, -80]], sfx(0.035, 'swingFist')] },
  GA_A4: { fam: 'air', air: true, dur: 0.42, cancel: 0.28, next: {},
    keys: [[0, { ha: 1.9, hr: 0.8, bl: 1.9, ua: 1.9, la: 2.1, ...TUCK, lean: -0.2 }], [0.07, { ha: 2.0, hr: 0.85, bl: 2.0, ua: 2.0, la: 2.2 }], [0.14, { ...GJX, ha: -0.5, bl: -0.5, ua: -0.5, la: -0.5, ...AIRLEGS, lean: 0.45 }, 'in'], [0.42, { ...GJX, ha: -0.6, bl: -0.6, ua: -0.6, la: -0.6, lean: 0.3 }]],
    hits: [px(0.07, 0.1, 9, { kx: 460, ky: -420, kind: 'launch', stop: 0.09, shake: 0.34, post: 14 })], ev: [[0, 'leap', [80, -80]], sfx(0.06, 'swingHeavy')] },
  // Air heavy: a hammer fist straight down.
  GA_AH: { fam: 'spike', air: true, dur: 0.44, cancel: 0.32, next: {}, tier: 2,
    keys: [[0, { ha: 2.0, hr: 0.8, bl: 2.0, ...GOC, ...AIRLEGS }], [0.11, { ha: 2.1, hr: 0.85, bl: 2.1, ...TUCK, lean: -0.25 }], [0.18, { ha: -1.0, hr: 1, bl: -1.1, ...GOC, lean: 0.5, f1x: 18, f1y: 8, f2x: -12, f2y: 20 }, 'in'], [0.44, { ha: -1.0, hr: 1, bl: -1.1, lean: 0.4 }]],
    hits: [px(0.12, 0.12, 12, { kx: 120, ky: 1250, kind: 'spike', stop: 0.11, shake: 0.42, post: 24, guardBreak: true })], ev: [sfx(0.11, 'swingHeavy')] },
  // Plunge: fist first; the landing is a ground pound.
  GA_PLUNGE: { fam: 'spike', air: true, dur: 9, cancel: 9, next: {}, tier: 2, plunge: true, land: 'GA_LAND',
    keys: [[0, { ha: 1.6, hr: 0.7, bl: 1.6, ua: 1.4, la: 1.6, lean: 0.05, f1x: -4, f1y: 30, f2x: -14, f2y: 36 }], [0.14, { ha: -1.5, hr: 1, bl: -1.57, ua: 1.6, la: 1.9, lean: 0.12, f1x: -6, f1y: 34, f2x: -16, f2y: 40 }]],
    hits: [hit(0.14, 9, 8, { kx: 60, ky: 1300, kind: 'spike', stop: 0.07, shake: 0.18, post: 18, guardBreak: true, onHit: fistGain })], ev: [sfx(0.02, 'swingFist')] },
  GA_LAND: { fam: 'spike', dur: 0.42, cancel: 0.26, next: {}, tier: 2,
    keys: [[0, { ha: -1.4, hr: 1, bl: -1.57, ...GOC, lean: 0.6, py: 24, f1x: 26, f2x: -24 }], [0.24, { ha: -1.4, hr: 1, bl: -1.5, lean: 0.55, py: 27 }], [0.42, { ...GJC, ...GOC, py: 44 }]],
    hits: [{ ...hit(0, 0.07, 10, { kx: 160, ky: -600, kind: 'launch', stop: 0.12, shake: 0.6, post: 28, onHit: fistGain }), shape: 'circle', ox: 10, oy: -20, r: 125 }], ev: [[0, 'fx', 'groundHit']] },
  // Riposte: a counter-flurry of six blows, then an uppercut.
  GA_RIP: { fam: 'riposte', dur: 0.66, cancel: 0.42, next: {}, tier: 3, invuln: [0, 0.52],
    keys: [[0, { ...GJC, ...GOC, lean: 0.5, py: 38 }], [0.03, { ...GJX, ...GOC, f1x: 34, f2x: -30 }, 'in'], [0.08, { ...GJC, ...GOX }, 'in'], [0.13, { ...GJX, ...GOC }, 'in'], [0.18, { ...GJC, ...GOX }, 'in'],
      [0.23, { ...GJX, ...GOC }, 'in'], [0.28, { ...GJC, ...GOX }, 'in'], [0.32, { ha: -1.4, hr: 0.6, bl: -1.0, ...GOC, py: 34 }], [0.38, { ha: 1.35, hr: 1, bl: 1.45, lean: -0.15, py: 56 }, 'in'], [0.66, { ha: 1.4, hr: 0.9, bl: 1.5, lean: -0.1 }]],
    hits: [0, 1, 2, 3, 4, 5].map((i) => px(0.02 + i * 0.05, 0.04, 5, { kx: 30, stop: 0.04, shake: 0.14, post: 8, unblockable: true })).concat([px(0.34, 0.1, 18, { kx: 60, ky: -950, kind: 'launch', stop: 0.15, shake: 0.6, post: 26, unblockable: true })]),
    step: [[0, 0.06, 700], [0.06, 0.3, 120]], ev: [sfx(0.02, 'swingFist'), sfx(0.12, 'swingFist'), sfx(0.22, 'swingFist'), sfx(0.33, 'swingHeavy'), [0.02, 'fx', 'riposteLine']] },
};

// ───────────── Drawblade ─────────────
// One long thin blade kept in a sheath at the hip. `f.sheathed` says whether it is put away: lights
// draw, cut and sheathe again, each with a click. Some cuts only mark what they pass (`dbMark`), and
// the marks are cut when the blade goes back into the sheath, a beat later. The heavy holds in the
// sheath through three charge levels (`DRAW_LEVELS`, measured on `f.chargeT`), each with a flash and a
// tick; releasing dashes through everything on the line. Releasing within `PERFECT_DRAW` of a level's
// tick is a perfect draw and cuts harder. The holder is open to punishment while charging.
export const DRAW_LEVELS = [0.3, 0.7, 1.1];
const DB_CHARGE = 0.1; // when DB_H1 reaches its charge point
export const PERFECT_DRAW = 0.14;
const DRAW_DMG = [8, 16, 26, 38], DRAW_POST = [10, 24, 40, 70];
function drawTick(f, world, dt) {
  const m = f.state === 'attack' ? f.move : null;
  // Drawn while guarding, and through an attack until its sheathe event; a charge waits in the sheath.
  f.sheathed = !!f.rag || (f.state !== 'guard' && (!m || f.sheathAt === f.atkSerial || (!!m.levels && !f.chargeDone)));
  if (m?.levels && f.charging) {
    let lv = 0;
    while (lv < DRAW_LEVELS.length && f.chargeT >= DRAW_LEVELS[lv]) lv++;
    if (lv > f.drawLevel) {
      f.drawLevel = lv;
      const x = f.j[4] + f.facing * 10 * f.scale, y = f.j[5] - 4 * f.scale, fx = world.fx;
      fx.flash(x, y, 50 + lv * 25, lv === 3 ? '#ffffff' : f.color, 0.14); fx.ring(x, y, 6, 30 + lv * 18, 0.2, f.color, 1, 2 + lv);
      fx.spark(x, y, -Math.PI / 2, 1.2, 4 + lv * 4, 300 + lv * 80, f.color, { white: 0.6, life: 0.25 });
      world.sfx('dbLevel', f.x, 0.8 + lv * 0.1, 0.9 + lv * 0.2);
    }
  } else if (!m?.levels) f.drawLevel = 0;
  // Marks whose attack ended without a sheathe (cancelled, interrupted) are cut now, never lost.
  if (f.marks?.length && (f.state !== 'attack' || f.atkSerial !== f.markSerial)) cutMarks(world, f);
  const C = f.cuts;
  if (C?.length) {
    if (f.dead) C.length = 0;
    for (let i = C.length - 1; i >= 0; i--) if (world.time >= C[i].at) { const c = C[i]; C.splice(i, 1); landCut(world, f, c); }
  }
}
// The heavy's release: read the level and timing, and set what the cuts will deal.
function dbRelease(world, f) {
  const t = f.chargeT;
  let lv = 0;
  while (lv < DRAW_LEVELS.length && t >= DRAW_LEVELS[lv]) lv++;
  const perfect = lv > 0 && t - DRAW_LEVELS[lv - 1] <= PERFECT_DRAW, k = perfect ? 1.4 : 1;
  f.charged = false; f.drawLevel = 0; // the levels pay through the cut, not the plain charge bonus
  f.drawCut = { dmg: DRAW_DMG[lv] * k, post: DRAW_POST[lv] * k, kx: 200 + 120 * lv, ky: lv >= 2 ? -380 : 0, kind: lv >= 2 ? 'knock' : 'flinch', stop: 0.05 + 0.03 * lv + (perfect ? 0.04 : 0),
    shake: 0.2 + 0.12 * lv, stun: 0.5, unblockable: true, id: 'DB_H1', fam: 'heavy' };
  const fx = world.fx;
  fx.slash(f.x + f.facing * 140, f.cy, 0, 300, f.color, 0.2, 3 + lv);
  world.sfx('dbDash', f.x, 0.8 + lv * 0.1, 1 + lv * 0.08);
  if (perfect) {
    fx.text(f.x, f.j[1] - 50, 'PERFECT DRAW', '#ffffff', 18, 0.9); fx.flash(f.bx, f.by, 120, '#ffffff', 0.16);
    world.sfx('dbPerfect', f.x); world.slow(0.4, 0.16);
  }
}
// A cut that passes: the target is marked, and is cut for real when the blade is sheathed. The cut
// rides on the passing hit (`h.cut`), or, for the charged draw, is what its release set.
function dbMark(world, A, B, r, h) {
  if (r !== 'hit' && r !== 'break') return;
  if (A.marks?.length && A.markSerial !== A.atkSerial) cutMarks(world, A);
  A.markSerial = A.atkSerial; A.marks ||= [];
  // `safe` is when the grace this very pass gave the target runs out (a struck player is untouchable
  // for a moment). The cut ignores that grace, or a draw could never cut the player.
  const cut = h.cut || A.drawCut;
  if (cut && !A.marks.some((m) => m.B === B)) A.marks.push({ B, safe: world.time + B.invuln, h: cut });
}
// Turn every mark into a cut, one after another.
function cutMarks(world, f) {
  const M = f.marks, C = (f.cuts ||= []), ang = f.facing > 0 ? -0.35 : Math.PI + 0.35;
  for (let i = 0; i < M.length; i++) C.push({ B: M[i].B, safe: M[i].safe, at: world.time + 0.06 + i * 0.07, h: M[i].h, ang, n: i });
  M.length = 0;
}
// The sheathe: a click, and every mark of this attack is cut.
function dbSheathe(world, f) {
  f.sheathAt = f.atkSerial;
  const x = f.j[4] + f.facing * 10 * f.scale, y = f.j[5] - 4 * f.scale;
  world.fx.spark(x, y, -Math.PI / 2, 0.8, 4, 200, '#ffffff', { white: 0.8, life: 0.15 });
  const M = f.marks;
  world.sfx('dbSheathe', f.x, M?.length ? 1 : 0.6);
  if (M?.length) cutMarks(world, f);
}
function landCut(world, f, c) {
  const B = c.B;
  if (B.remove) return;
  const x = B.cx, y = B.cy, fx = world.fx;
  if (B.invuln > 0 && world.time + B.invuln <= c.safe + 1e-6) B.invuln = 0; // only the pass's own grace
  applyHit(world, f, B, c.h, x, y);
  fx.slash(x, y, c.ang, 280, '#ffffff', 0.22, 8); fx.slash(x, y, c.ang, 200, f.color, 0.3, 4);
  fx.spark(x, y, c.ang, 0.4, 14, 700, f.color, { white: 0.6 }); fx.flash(x, y, 90, f.color, 0.14);
  world.sfx('dbCut', x, 1, 1 + c.n * 0.08);
}

const DH = { ha: -1.75, hr: 0.5, bl: -2.75, ua: -1.3, la: -0.5 };    // hand on the hilt at the hip, the blade in its sheath
const DOUT = { ha: 0.1, hr: 1, bl: 0.3, ua: -2.6, la: -2.3 };        // drawn level, straight ahead
const DCROUCH = { ...DH, lean: 0.45, py: 36, f1x: 28, f2x: -30 };     // the draw stance
const DPASS = { ha: 0.05, hr: 1, bl: 0.1, lean: 0.75, py: 32, f1x: 36, f2x: -34, ua: -2.8, la: -2.6 }; // through the line, blade out ahead
const FLASH_CUT = { dmg: 12, post: 20, kx: 380, ky: -300, kind: 'knock', stop: 0.1, shake: 0.4, stun: 0.4, unblockable: true, id: 'DB_L4', fam: 'light' };
const CROSS_CUT = { dmg: 22, post: 40, kx: 320, ky: -520, kind: 'knock', stop: 0.13, shake: 0.5, stun: 0.4, unblockable: true, id: 'DB_FIN', fam: 'heavy' };
const RIP_CUT = { dmg: 36, post: 45, kx: 420, ky: -320, kind: 'knock', stop: 0.16, shake: 0.6, stun: 0.5, unblockable: true, id: 'DB_RIP', fam: 'riposte' };
const pass = (t0, t1, dmg, o = {}) => hit(t0, t1, dmg, { kx: 0, stun: 0.9, stop: 0.03, shake: 0.12, post: 6, sweepBody: true, onHit: dbMark, ...o });

const db = {
  // Light string: a level draw, a rising draw, a draw and a downward cut, then a step through the
  // target whose cut lands as the blade clicks home.
  DB_L1: { fam: 'light', dur: 0.4, cancel: 0.2, next: { light: 'DB_L2', heavy: 'DB_H1' },
    keys: [[0, { ...DH, lean: 0.3, py: 42, f1x: 22, f2x: -22 }], [0.03, { ...DH, lean: 0.35, py: 41 }], [0.1, { ...DOUT, lean: 0.35, py: 42, f1x: 30 }, 'in'], [0.18, { ha: 0.7, hr: 0.9, bl: 1.1, lean: 0.2, py: 44 }],
      [0.28, { ...DH, lean: 0.2, py: 44 }], [0.4, { ...DH, lean: 0.12, py: 46 }]],
    hits: [hit(0.05, 0.14, 8, { kx: 150 })], step: [[0.02, 0.1, 340]], ev: [sfx(0.04, 'swingDraw'), [0.28, 'form', dbSheathe]] },
  DB_L2: { fam: 'light', dur: 0.42, cancel: 0.2, next: { light: 'DB_L3', heavy: 'DB_LAUNCH' },
    keys: [[0, { ...DH, lean: 0.35, py: 40, f1x: 22, f2x: -22 }], [0.03, { ...DH, lean: 0.4, py: 39 }], [0.1, { ha: 1.1, hr: 1, bl: 1.5, lean: -0.05, py: 49, f1x: 26, ua: -2.4, la: -2.2 }, 'in'],
      [0.2, { ha: 1.3, hr: 0.9, bl: 1.9 }], [0.3, { ...DH, lean: 0.2, py: 44 }], [0.42, { ...DH, lean: 0.12, py: 46 }]],
    hits: [hit(0.05, 0.14, 8, { kx: 120, ky: -120 })], step: [[0.02, 0.1, 320]], ev: [sfx(0.04, 'swingDraw'), [0.3, 'form', dbSheathe]] },
  DB_L3: { fam: 'light', dur: 0.5, cancel: 0.28, next: { light: 'DB_L4', heavy: 'DB_FIN' },
    keys: [[0, { ...DH, lean: 0.3, py: 42 }], [0.03, { ...DH }], [0.09, { ...DOUT, lean: 0.3, f1x: 28 }, 'in'], [0.17, { ha: 1.9, hr: 0.85, bl: 2.6, lean: -0.15, py: 48 }],
      [0.24, { ha: -0.6, hr: 1, bl: -0.8, lean: 0.45, py: 41, f1x: 30 }, 'in'], [0.38, { ...DH, lean: 0.2, py: 44 }], [0.5, { ...DH, lean: 0.12, py: 46 }]],
    hits: [hit(0.05, 0.12, 6, { kx: 60 }), hit(0.19, 0.28, 8, { kx: 220, stop: 0.06 })], step: [[0.02, 0.09, 300], [0.17, 0.24, 240]],
    ev: [sfx(0.04, 'swingDraw'), sfx(0.18, 'swingLight'), [0.38, 'form', dbSheathe]] },
  DB_L4: { fam: 'light', dur: 0.66, cancel: 0.44, next: {},
    keys: [[0, DCROUCH], [0.08, { ...DCROUCH, py: 34 }], [0.16, DPASS, 'in'], [0.32, { ...DPASS, ha: -0.3, bl: -0.2, lean: 0.6, py: 34 }], [0.4, { ha: -0.6, hr: 0.9, bl: -1.0, lean: 0.4, py: 40 }],
      [0.46, { ...DH, lean: 0.3, py: 42 }], [0.66, { ...DH, lean: 0.12, py: 46 }]],
    hits: [pass(0.1, 0.24, 6, { stun: 0.6, cut: FLASH_CUT })], step: [[0.08, 0.2, 900], [0.2, 0.24, 80]], ev: [sfx(0.08, 'swingDraw'), [0.46, 'form', dbSheathe]] },

  // Heavy: the charged draw (see DRAW_LEVELS). Crouched with a hand on the hilt; on release, through
  // the line in one stroke. Everything passed is marked, and cut as the blade clicks home.
  DB_H1: { fam: 'heavy', dur: 0.95, cancel: 0.66, next: {}, tier: 2, charge: DB_CHARGE, chargeMax: 1.6, levels: true, invuln: [0.12, 0.31], punish: [0, 0.12],
    keys: [[0, { ...DCROUCH, lean: 0.35, py: 40 }], [0.1, DCROUCH], [0.125, DCROUCH], [0.16, DPASS, 'in'], [0.31, { ...DPASS, ha: -0.3, bl: -0.2, lean: 0.6, py: 34 }], [0.5, { ha: -0.6, hr: 0.9, bl: -1.0, lean: 0.4, py: 40 }],
      [0.58, { ...DH, lean: 0.3, py: 42 }], [0.95, { ...DH, lean: 0.12, py: 46 }]],
    // The release runs a moment after the charge point, so it always comes after the hold.
    hits: [pass(0.125, 0.31, 2)], step: [[0.125, 0.3, 1500], [0.3, 0.34, 100]], ev: [sfx(0.02, 'dbStance'), [0.12, 'form', dbRelease], [0.58, 'form', dbSheathe]] },
  // Launcher: a rising draw that lifts.
  DB_LAUNCH: { fam: 'launch', dur: 0.48, cancel: 0.26, next: {}, rise: 0.2,
    keys: [[0, { ...DH, lean: 0.45, py: 34, f1x: 24 }], [0.08, { ...DH, lean: 0.5, py: 32 }], [0.16, { ha: 1.4, hr: 1, bl: 1.6, lean: -0.2, py: 55, ua: -2.4, la: -2.2 }, 'in'], [0.34, { ha: 1.5, hr: 0.9, bl: 1.8 }],
      [0.42, { ...DH, py: 50 }], [0.48, DH]],
    hits: [hit(0.09, 0.22, 11, { kx: 40, ky: -960, kind: 'launch', stop: 0.09, shake: 0.32, post: 18 })], step: [[0.04, 0.12, 240]], ev: [sfx(0.08, 'swingDraw'), [0.42, 'form', dbSheathe]] },
  // Finisher branch: a quick draw through the target without charging; its cut lands on the sheathe.
  DB_FIN: { fam: 'heavy', dur: 0.82, cancel: 0.56, next: {}, tier: 2,
    keys: [[0, DCROUCH], [0.12, { ...DCROUCH, py: 34 }], [0.2, DPASS, 'in'], [0.36, { ...DPASS, ha: -0.3, bl: -0.2, lean: 0.6, py: 34 }], [0.44, { ha: -0.6, hr: 0.9, bl: -1.0, lean: 0.4, py: 40 }],
      [0.5, { ...DH, lean: 0.3, py: 42 }], [0.82, { ...DH, lean: 0.12, py: 46 }]],
    hits: [pass(0.13, 0.3, 4, { stun: 0.7, cut: CROSS_CUT })], step: [[0.12, 0.26, 1300], [0.26, 0.3, 100]], ev: [sfx(0.1, 'swingDraw'), sfx(0.12, 'dbDash'), [0.5, 'form', dbSheathe]] },
  // Dash attack: a running draw.
  DB_DA: { fam: 'light', dur: 0.42, cancel: 0.22, next: { light: 'DB_L2', heavy: 'DB_LAUNCH' },
    keys: [[0, { ...DH, lean: 0.6, py: 38 }], [0.04, { ...DH, lean: 0.62, py: 37 }], [0.12, { ...DOUT, lean: 0.7, py: 36, f1x: 30 }, 'in'], [0.22, { ha: 0.6, hr: 0.9, bl: 1.0, lean: 0.45 }],
      [0.32, { ...DH, lean: 0.3, py: 42 }], [0.42, DH]],
    hits: [hit(0.04, 0.15, 10, { kx: 260, stop: 0.07, shake: 0.24 })], step: [[0, 0.14, 640]], ev: [sfx(0.03, 'swingDraw'), [0.32, 'form', dbSheathe]] },

  // Air string: two draws, each sheathed again, then a somersault draw that throws.
  DB_A1: { fam: 'air', air: true, dur: 0.34, cancel: 0.16, next: { light: 'DB_A2', heavy: 'DB_AH' },
    keys: [[0, { ...DH, ...AIRLEGS }], [0.03, DH], [0.1, { ...DOUT, bl: 0.0, ...AIRLEGS, lean: 0.3 }, 'in'], [0.18, { ha: 0.7, hr: 0.9, bl: 1.0 }], [0.26, { ...DH, ...AIRLEGS }], [0.34, DH]],
    hits: [hit(0.05, 0.14, 6, { kx: 60, ky: -320, kind: 'pop' })], ev: [sfx(0.04, 'swingDraw'), [0.26, 'form', dbSheathe]] },
  DB_A2: { fam: 'air', air: true, dur: 0.34, cancel: 0.16, next: { light: 'DB_A3', heavy: 'DB_AH' },
    keys: [[0, { ...DH, ...AIRLEGS }], [0.03, DH], [0.1, { ha: 1.0, hr: 1, bl: 1.3, ua: -2.4, la: -2.2, f1x: 10, f1y: 22, f2x: -10, f2y: 12 }, 'in'], [0.18, { ha: 1.2, hr: 0.9, bl: 1.7 }], [0.26, DH], [0.34, DH]],
    hits: [hit(0.05, 0.14, 6, { kx: 60, ky: -340, kind: 'pop' })], ev: [[0, 'leap', [80, -80]], sfx(0.04, 'swingDraw'), [0.26, 'form', dbSheathe]] },
  DB_A3: { fam: 'air', air: true, dur: 0.44, cancel: 0.3, next: {},
    keys: [[0, { rot: 0, ...DH, f1x: 6, f1y: 24, f2x: -8, f2y: 28, lean: 0.3 }], [0.04, { rot: 0, ha: 0.9, hr: 1, bl: 1.2 }], [0.3, { rot: 6.283, ha: 0.7, hr: 1, bl: 1.0, f1x: 6, f1y: 24, f2x: -8, f2y: 28 }, 'io'],
      [0.36, { rot: 6.283, ...DH }], [0.44, { rot: 6.283, ...DH, ...AIRLEGS }]],
    hits: [hit(0.04, 0.29, 10, { kx: 420, ky: -500, kind: 'launch', stop: 0.1, shake: 0.35, post: 18 })], ev: [[0, 'leap', [70, -90]], sfx(0.04, 'swingSpin'), [0.36, 'form', dbSheathe]] },
  // Air heavy: a downward draw that drives the target into the floor.
  DB_AH: { fam: 'spike', air: true, dur: 0.46, cancel: 0.34, next: {}, tier: 2,
    keys: [[0, { ...DH, ...AIRLEGS }], [0.1, { ha: 2.0, hr: 0.85, bl: 2.7, ...TUCK, lean: -0.25, ua: 1.4, la: 1.8 }], [0.18, { ha: -0.75, hr: 1, bl: -1.05, lean: 0.55, f1x: 18, f1y: 8, f2x: -12, f2y: 20, ua: -2.4, la: -1.6 }, 'in'],
      [0.34, { ha: -0.8, hr: 1, bl: -1.1, lean: 0.45 }], [0.4, DH], [0.46, DH]],
    hits: [hit(0.1, 0.22, 15, { kx: 140, ky: 1250, kind: 'spike', stop: 0.12, shake: 0.48, post: 28, guardBreak: true })], ev: [sfx(0.09, 'swingDraw'), [0.4, 'form', dbSheathe]] },
  // Plunge: drawn point down; the landing throws a ring and the blade goes home.
  DB_PLUNGE: { fam: 'spike', air: true, dur: 9, cancel: 9, next: {}, tier: 2, plunge: true, land: 'DB_LAND',
    keys: [[0, { ha: 1.6, hr: 0.6, bl: -1.57, lean: 0.05, f1x: -4, f1y: 30, f2x: -14, f2y: 36, ua: 1.4, la: 1.2 }], [0.14, { ha: -1.5, hr: 0.75, bl: -1.57, lean: 0.12, f1x: -6, f1y: 34, f2x: -16, f2y: 40 }]],
    hits: [hit(0.14, 9, 9, { kx: 60, ky: 1300, kind: 'spike', stop: 0.07, post: 20, guardBreak: true })], ev: [sfx(0.02, 'swingDraw')] },
  DB_LAND: { fam: 'spike', dur: 0.44, cancel: 0.28, next: {}, tier: 2,
    keys: [[0, { ha: -1.3, hr: 0.7, bl: -1.57, lean: 0.5, py: 26, f1x: 24, f2x: -24 }], [0.22, { ha: -1.3, hr: 0.7, bl: -1.5, lean: 0.5, py: 28 }], [0.3, { ...DH, py: 40 }], [0.44, { ...DH, py: 46 }]],
    hits: [{ ...hit(0, 0.07, 10, { kx: 160, ky: -560, kind: 'launch', stop: 0.12, shake: 0.6, post: 30 }), shape: 'circle', ox: 0, oy: -20, r: 135 }], ev: [[0.3, 'form', dbSheathe]] },
  // Riposte: through the attacker in a blink; the cut lands when the blade clicks home.
  DB_RIP: { fam: 'riposte', dur: 0.62, cancel: 0.4, next: {}, tier: 3, invuln: [0, 0.5],
    keys: [[0, { ...DCROUCH, py: 34 }], [0.07, { ...DPASS, lean: 0.8 }, 'in'], [0.28, { ...DPASS, ha: -0.3, bl: -0.2, lean: 0.6, py: 34 }], [0.36, { ...DH, lean: 0.3, py: 42 }], [0.62, { ...DH, lean: 0.15, py: 46 }]],
    hits: [pass(0.03, 0.18, 8, { stun: 0.8, stop: 0.04, shake: 0.2, post: 10, unblockable: true, cut: RIP_CUT })], step: [[0.03, 0.16, 1700], [0.16, 0.2, 100]],
    ev: [sfx(0.02, 'dbDash'), [0.04, 'fx', 'riposteLine'], [0.36, 'form', dbSheathe]] },
};

// What the scripted player (bot.js) needs to fight with a form: the distance it closes to, and
// strings of its own that show off the form's signature move. `H@s` holds heavy for `s` seconds.
const R3 = (v) => Math.round(v * 1000) / 1000;
const perfectHold = (lv) => R3(DB_CHARGE + DRAW_LEVELS[lv - 1] + 0.05);

for (const set of [tw, gs, st, la, ga, db]) for (const id in set) registerMove(id, set[id]);

const slots = (p) => ({ L1: `${p}_L1`, DA: `${p}_DA`, H1: `${p}_H1`, LAUNCH: `${p}_LAUNCH`, A1: `${p}_A1`, AH: `${p}_AH`, PLUNGE: `${p}_PLUNGE`, RIPOSTE: `${p}_RIP` });

export const FORMS = {
  saber: { id: 'saber', name: 'SABER', text: 'The balanced blade', color: '#56e9ff', traits: ['Balanced', 'Four-hit string', 'Comet finisher'],
    blade: { len: 74 }, dmg: 1, speed: 1, moves: {} },
  twin: { id: 'twin', name: 'TWIN BLADES', text: 'Two short blades: a storm of light cuts that keeps one target in the air', color: '#7dffb0',
    traits: ['Fast', 'Short reach', 'Many light hits', 'Weak against guards'],
    blade: { len: 50, thin: true, twin: true, twinAngle: TW_ANG, twinLen: 1 }, dmg: 0.9, speed: 1.1, moves: slots('TW') },
  great: { id: 'great', name: 'GREATSWORD', text: 'One long blade: slow, wide cuts that shrug off blows and break guards', color: '#ffb347',
    traits: ['Slow', 'Wide arcs', 'Armoured swings', 'Breaks posture'],
    blade: { len: 104, wide: true }, dmg: 1.2, speed: 0.88, moves: slots('GS') },
  staff: { id: 'staff', name: 'STAFF', text: 'A blade at each end: spins that strike in front and behind at once', color: '#c69bff',
    traits: ['Long reach', 'Hits both sides', 'Crowd control', 'Light single hits'],
    blade: { len: 62, double: true }, dmg: 0.9, speed: 1, moves: slots('ST') },
  lash: { id: 'lash', name: 'LASH', text: 'A whip of light: twice the reach, a tip that cracks, and a heavy that drags the target to you', color: '#ff6fd8',
    traits: ['Twice the reach', 'Tip hits hardest', 'Pulls targets in', 'Weak up close'],
    blade: { len: 150, whip: true, thin: true, tick: whipTick }, dmg: 1, speed: 1, moves: slots('LA'),
    bot: { reach: 128, combos: [['heavy', 'light', 'light'], ['light', 'heavy', 'light', 'light']] } },
  gauntlets: { id: 'gauntlets', name: 'GAUNTLETS', text: 'Fists with blades on the knuckles: every punch that lands charges the heavy shockwave', color: '#ffe45c',
    traits: ['Fastest strings', 'Shortest reach', 'Hits build charge', 'Charged shockwave'],
    blade: { len: 20, fist: true, twin: true, twinAngle: 0, twinLen: 1, tick: fistTick }, dmg: 1, speed: 1.08, moves: slots('GA'),
    bot: { reach: 62, combos: [['light', 'light', 'light', 'light', 'light'], ['light', 'light', 'light', 'light', 'light', 'heavy']] } },
  drawblade: { id: 'drawblade', name: 'DRAWBLADE', text: 'A long blade kept in the sheath: hold heavy to charge a draw that cuts through the line', color: '#a0b4ff',
    traits: ['Draw cuts', 'Charged draw', 'Cuts land late', 'Open while charging'],
    blade: { len: 96, thin: true, sheath: true, tick: drawTick }, dmg: 1, speed: 1.04, moves: slots('DB'),
    bot: { reach: 90, combos: [[`heavy@${perfectHold(2)}`, 'light', 'light'], [`heavy@${perfectHold(1)}`], ['light', 'light', 'light', 'light']] } },
};
export const FORM_IDS = Object.keys(FORMS);

// Give any fighter a form: its blade, its move list, and fresh form state. The player gets one
// through World.applyForm; a foe that copies the player can call this directly.
export function equipForm(f, id) {
  const F = FORMS[id] || FORMS.saber;
  f.form = F; f.blade = F.blade; f.double = !!F.blade.double; f.twin = !!F.blade.twin; f.bladeLen = F.blade.len * f.scale;
  resetFormState(f);
  return F;
}
// Clear what one form left on a fighter, so the next form starts clean (a sheathed flag left behind
// would hide a saber).
export function resetFormState(f) {
  f.lash = null; f.lashO = null; f.lashHold = null; f.fistCharge = 0; f.sheathed = false; f.drawLevel = 0;
  if (f.marks) f.marks.length = 0;
}
// The move a fighter's form plays for one of the player's slots ('L1', 'H1', 'LAUNCH' and so on).
export const formMove = (f, slot) => f.form?.moves[slot] || slot;
