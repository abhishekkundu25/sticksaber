// Weapon forms: the blade the player commits to for a run. Each has its own blade, its own damage
// and run speed, and its own move for each of the player's entry slots. Everything after an entry
// move is reached through that move's own `next`.
//
// Pose channels are the ones in moves.js: `ha/hr/bl` aim the weapon hand and its blade, `ua/la` aim
// the off arm. A twin form's second blade runs on from the off forearm (`la` plus `twinAngle`), so
// its off-hand cuts are animated with `ua/la`.
import { registerMove } from './moves.js';

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

for (const set of [tw, gs, st]) for (const id in set) registerMove(id, set[id]);

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
};
export const FORM_IDS = Object.keys(FORMS);
