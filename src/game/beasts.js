// Animal enemies. A Beast is a Fighter whose 11 joints are read as an animal:
//   0 head (where the eye is)   1 shoulder, front of the spine   2 hip, rear of the spine
//   3-4 near front limb         5-6 far front limb               7-8 near hind limb   9-10 far hind limb
// so the ragdoll, chopping, hit tests and effects work on it unchanged. Wings are the front limbs.
// Tails, extra legs, heads and wings are derived from those joints every frame and drawn by
// render/beastdraw.js. Bodies are generated per seed by makeBeast().
//
// Pose channels mean something else on a beast. Moves prefixed bt_ are only ever played by beasts,
// and every channel is relative to the body's own size, so one move fits every seed of a plan:
//   py   hip height, 1 = standing            px   body shifted forward, in spine lengths
//   lean spine pitch, + = nose down          head neck raised (+) or lowered (-) from rest
//   ha   head tipped up (+) from rest        hr   jaw open 0..1 (pincers on a scorpion)
//   bl   tail raised (+). On a scorpion, 1 = the sting struck forward over the head
//   ua   lift limb A to (f1x, f1y)           la   lift limb B to (f2x, f2y)
//   f1x f1y f2x f2y  limb targets from the limb's root, in limb lengths, x forward, y up
//   rot  flyer: wings held raised (+1) or tucked (-1). Spitter: throat and frill swell 0..1
// Limb A and B are per plan: the forelegs on most, the hind legs on a raptor or a flyer.
import { clamp, approach, ik2, rand, rng, TAU, EASE } from '../core/math.js';
import { registerMove, sampleMove, fillStance, C, N, MOVES } from './moves.js';
import { Fighter } from './fighter.js';
import { initAi, weighted, mercy } from './enemies.js';
import { breakPosture } from './combat.js';

const { PY, PX, ROT, LEAN, HEAD, HA, HR, BL, UA, LA, F1X, F1Y, F2X, F2Y } = C;
const PI = Math.PI;
const L = new Float32Array(22), IK = new Float32Array(4), GF = new Float32Array(2), HP = new Float32Array(2);
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const frac = (v) => v - Math.floor(v);

// ───────────── plans ─────────────
export const BEAST_PLANS = ['hound', 'charger', 'raptor', 'stalker', 'scorpion', 'flyer', 'ape', 'spitter'];
export const BEAST_INFO = {
  hound: { name: 'Hound', rideable: false, flying: false, ranged: false, pack: true },
  charger: { name: 'Charger', rideable: true, flying: false, ranged: false, pack: false },
  raptor: { name: 'Raptor', rideable: true, flying: false, ranged: false, pack: false },
  stalker: { name: 'Stalker', rideable: false, flying: false, ranged: false, pack: false },
  scorpion: { name: 'Scorpion', rideable: false, flying: false, ranged: false, pack: false },
  flyer: { name: 'Flyer', rideable: false, flying: true, ranged: false, pack: false },
  ape: { name: 'Ape', rideable: false, flying: false, ranged: false, pack: false },
  spitter: { name: 'Spitter', rideable: false, flying: false, ranged: true, pack: false },
};

// Gaits. Phase offsets per limb [near front, far front, near hind, far hind], walking and running.
// A walk is a lateral sequence; the run of a quadruped is a rotary gallop, an ape bounds.
const QUAD = { offW: [0.25, 0.75, 0, 0.5], offR: [0.52, 0.62, 0, 0.1], betaW: 0.62, betaR: 0.36, cw: 1.45, cr: 3.3, liftW: 0.16, liftR: 0.3 };
const BOUND = { ...QUAD, offR: [0.48, 0.56, 0, 0.06], cr: 3.0 };
const BIPED = { offW: [0, 0.5, 0, 0.5], offR: [0, 0.5, 0, 0.5], betaW: 0.6, betaR: 0.4, cw: 1.5, cr: 2.9, liftW: 0.2, liftR: 0.34 };
const CRAWL = { offW: [0.5, 0, 0, 0.5], offR: [0.5, 0, 0, 0.5], betaW: 0.6, betaR: 0.5, cw: 0.9, cr: 1.3, liftW: 0.22, liftR: 0.3 };

// ───────────── moves ─────────────
const hit = (t0, t1, dmg, o = {}) => ({ t0, t1, dmg, post: dmg, kx: 220, ky: 0, kind: 'flinch', stop: 0.05, shake: 0.18, stun: 0.3, ...o });
const circ = (h, ox, oy, r) => ({ ...h, shape: 'circle', ox, oy, r });
const REST = { py: 1, px: 0, lean: 0, head: 0, ha: 0, hr: 0, bl: 0, ua: 0, la: 0, rot: 0 };

const BT = {
  // Hound: a gathering crouch, a spring and a snap of the jaws.
  bt_hound_snap: { dur: 0.9,
    keys: [[0, {}], [0.3, { py: 0.8, px: -0.16, lean: -0.06, head: -0.3, ha: 0.1, hr: 0.2, bl: 0.4 }], [0.4, { py: 0.96, px: 0.42, lean: 0.12, head: 0.02, ha: 0.2, hr: 1 }, 'out'],
      [0.47, { px: 0.46, hr: 0, ha: -0.05 }, 'in'], [0.9, REST]],
    hits: [hit(0.38, 0.52, 7, { post: 14, kx: 240 })], step: [[0.33, 0.46, 560]],
    ev: [[0.1, 'tele', 0], [0.33, 'sfx', 'beastBite']], punish: [0.52, 0.9] },
  // Pounce: leaps onto you with the forelegs reaching. It knocks you down if it lands.
  bt_hound_pounce: { dur: 1.4,
    keys: [[0, {}], [0.38, { py: 0.68, px: -0.12, lean: -0.04, head: -0.25, bl: 0.5, hr: 0.25 }], [0.47, { py: 1.05, lean: -0.3, head: 0.3, ua: 1, la: 1, f1x: 0.8, f1y: -0.1, f2x: 0.65, f2y: -0.2, hr: 1, bl: -0.3 }, 'out'],
      [0.82, { lean: 0.18, head: -0.05, f1x: 0.6, f1y: -0.65, f2x: 0.5, f2y: -0.75, hr: 1 }], [0.95, { py: 0.82, lean: 0.12, ua: 0, la: 0, hr: 0 }, 'in'], [1.4, REST]],
    hits: [hit(0.6, 0.98, 9, { post: 18, kx: 300, ky: -200, kind: 'knock' })],
    ev: [[0.12, 'tele', 0], [0.4, 'sfx', 'beastGrowl'], [0.42, 'leapAt', [-640, 620]]], punish: [1.0, 1.4] },
  // Two snaps with a hop between: the second catches a parry made too early.
  bt_hound_harry: { dur: 1.45,
    keys: [[0, {}], [0.26, { py: 0.82, px: -0.12, head: -0.25, hr: 0.2, bl: 0.4 }], [0.36, { py: 0.96, px: 0.35, lean: 0.1, hr: 1 }, 'out'], [0.42, { hr: 0 }, 'in'],
      [0.66, { py: 0.88, px: -0.05, lean: -0.08, head: -0.1, hr: 0.3 }], [0.8, { py: 0.78, px: -0.15, head: -0.3, bl: 0.5 }], [0.92, { py: 0.98, px: 0.45, lean: 0.12, hr: 1 }, 'out'], [0.99, { hr: 0 }, 'in'], [1.45, REST]],
    hits: [hit(0.34, 0.45, 5, { post: 10, kx: 120 }), hit(0.9, 1.02, 7, { post: 14, kx: 260 })], step: [[0.3, 0.42, 440], [0.86, 0.98, 520]],
    ev: [[0.08, 'tele', 0], [0.3, 'sfx', 'beastBite'], [0.66, 'tele', 0], [0.86, 'sfx', 'beastBite']], punish: [1.02, 1.45] },

  // Charger: drops its head, then tosses you on the horns.
  bt_charger_gore: { dur: 1.5,
    keys: [[0, {}], [0.5, { head: -0.55, ha: -0.3, lean: 0.12, py: 0.9, px: -0.1, bl: 0.3 }], [0.62, { head: -0.62, ha: -0.35, px: -0.12, py: 0.88 }], [0.76, { head: 0.45, ha: 0.55, lean: -0.25, py: 1.05, px: 0.25 }, 'out'], [1.5, REST]],
    hits: [hit(0.64, 0.8, 15, { post: 34, kx: 380, ky: -560, kind: 'knock', stop: 0.1, shake: 0.4 })], step: [[0.62, 0.76, 340]],
    ev: [[0.22, 'tele', 0], [0.3, 'sfx', 'beastGrowl'], [0.64, 'sfx', 'swingHeavy']], punish: [0.8, 1.5] },
  // The charge: paws the ground twice, lowers its head and runs until it meets you or a wall.
  bt_charger_charge: { dur: 3.0, run: 0.95, line: [0.1, 0.92],
    keys: [[0, { head: -0.25, lean: 0.08, py: 0.95 }], [0.18, { ua: 1, f1x: 0.3, f1y: -0.72 }], [0.3, { ua: 1, f1x: -0.1, f1y: -0.95 }], [0.42, { f1x: 0.3, f1y: -0.72 }], [0.54, { f1x: -0.1, f1y: -0.95 }],
      [0.7, { ua: 0, head: -0.6, ha: -0.3, lean: 0.16, py: 0.88, bl: 0.5 }], [0.95, { head: -0.62, ha: -0.32, lean: 0.14 }], [2.6, { head: -0.62, ha: -0.32, lean: 0.14 }], [3.0, REST]],
    hits: [circ(hit(0.95, 2.6, 22, { post: 50, kx: 640, ky: -420, kind: 'knock', unblockable: true, stop: 0.12, shake: 0.55 }), 56, -38, 40)],
    step: [[0.95, 2.6, 760]], ev: [[0.1, 'tele', 1], [0.24, 'sfx', 'beastHoof'], [0.48, 'sfx', 'beastHoof'], [0.88, 'sfx', 'beastRoar']], punish: [2.6, 3.0] },
  // Rears up and stamps: a red shockwave both ways along the floor.
  bt_charger_stomp: { dur: 2.2,
    keys: [[0, {}], [0.7, { lean: -0.75, py: 1.08, px: -0.14, ua: 1, la: 1, f1x: 0.45, f1y: 0.12, f2x: 0.32, f2y: 0.02, head: 0.35, ha: 0.3, bl: -0.3 }],
      [0.86, { lean: -0.82, py: 1.12, f1x: 0.5, f1y: 0.2, f2x: 0.36, f2y: 0.1 }], [0.98, { lean: 0.15, py: 0.9, px: 0.12, ua: 0, la: 0, head: -0.3, ha: -0.2 }, 'in'], [1.5, { lean: 0.1, py: 0.92 }], [2.2, REST]],
    hits: [circ(hit(0.95, 1.06, 20, { post: 46, kx: 460, ky: -400, kind: 'knock', unblockable: true, stop: 0.13, shake: 0.6 }), 60, -20, 70)],
    ev: [[0.18, 'tele', 1], [0.55, 'sfx', 'beastRoar'], [0.98, 'fx', 'groundHit'], [0.99, 'spawn', 'waves'], [0.99, 'sfx', 'beastStomp']], punish: [1.06, 2.2] },

  // Raptor: chambers a hind leg and rakes forward with the sickle claw.
  bt_raptor_rake: { dur: 1.05,
    keys: [[0, {}], [0.3, { py: 0.84, lean: -0.05, ua: 1, f1x: 0.05, f1y: -0.5, bl: 0.35, head: 0.15, hr: 0.3 }], [0.44, { lean: -0.38, ua: 1, f1x: 0.88, f1y: -0.3, px: 0.15, bl: -0.25, head: 0.3 }, 'out'],
      [0.6, { ua: 1, f1x: 0.5, f1y: -0.75, lean: -0.12 }], [0.76, { ua: 0, lean: 0, hr: 0 }], [1.05, REST]],
    hits: [circ(hit(0.4, 0.56, 11, { post: 24, kx: 360 }), 48, -36, 30)], step: [[0.36, 0.5, 420]],
    ev: [[0.1, 'tele', 0], [0.2, 'sfx', 'beastHiss'], [0.4, 'sfx', 'swingLight']], punish: [0.56, 1.05] },
  // Leaps high and comes down claws first on where you stand.
  bt_raptor_leap: { dur: 1.5,
    keys: [[0, {}], [0.36, { py: 0.66, lean: 0.12, head: -0.2, bl: 0.45 }], [0.45, { py: 1.0, lean: -0.3, ua: 1, la: 1, f1x: 0.35, f1y: -0.35, f2x: 0.2, f2y: -0.4, head: 0.3, bl: -0.3 }, 'out'],
      [0.8, { lean: -0.45, f1x: 0.55, f1y: -0.85, f2x: 0.42, f2y: -0.9, hr: 1 }], [1.02, { py: 0.76, ua: 0, la: 0, lean: 0.1, hr: 0 }, 'in'], [1.5, REST]],
    hits: [circ(hit(0.62, 1.02, 12, { post: 24, kx: 300, ky: -260, kind: 'knock' }), 18, -14, 42)],
    ev: [[0.1, 'tele', 0], [0.36, 'sfx', 'beastScreech'], [0.4, 'leapAt', [-900, 720]]], punish: [1.05, 1.5] },
  // A darting bite on the long neck.
  bt_raptor_snap: { dur: 0.85,
    keys: [[0, {}], [0.26, { head: 0.3, ha: 0.15, lean: -0.12, py: 0.9, px: -0.12, bl: 0.2, hr: 0.2 }], [0.36, { head: -0.45, ha: -0.1, lean: 0.22, px: 0.3, hr: 1 }, 'out'], [0.43, { hr: 0 }, 'in'], [0.85, REST]],
    hits: [hit(0.34, 0.48, 8, { post: 16, kx: 260 })], step: [[0.3, 0.42, 520]],
    ev: [[0.08, 'tele', 0], [0.3, 'sfx', 'beastHiss']], punish: [0.48, 0.85] },

  // Stalker: rears with the forelegs high, then lunges low.
  bt_stalker_lunge: { dur: 1.0,
    keys: [[0, {}], [0.3, { lean: -0.32, py: 1.15, px: -0.1, ua: 1, la: 1, f1x: 0.55, f1y: 0.35, f2x: 0.42, f2y: 0.42, hr: 0.6, head: 0.2 }],
      [0.42, { lean: 0.22, py: 0.66, px: 0.45, f1x: 0.85, f1y: -0.62, f2x: 0.75, f2y: -0.66, hr: 1, head: -0.15 }, 'in'], [0.5, { hr: 0 }], [0.72, { ua: 0, la: 0 }], [1.0, REST]],
    hits: [hit(0.38, 0.52, 9, { post: 18, kx: 280 })], step: [[0.34, 0.5, 640]],
    ev: [[0.1, 'tele', 0], [0.3, 'sfx', 'beastHiss']], punish: [0.52, 1.0] },
  // Stabs down with one foreleg, then the other.
  bt_stalker_rake: { dur: 1.2,
    keys: [[0, {}], [0.24, { lean: -0.2, py: 1.1, ua: 1, la: 1, f1x: 0.5, f1y: 0.45, f2x: 0.4, f2y: 0.3 }], [0.36, { lean: 0.05, f1x: 0.95, f1y: -0.65 }, 'in'],
      [0.5, { f1x: 0.5, f1y: 0.3, f2x: 0.45, f2y: 0.5, lean: -0.15 }], [0.62, { f2x: 0.92, f2y: -0.66, lean: 0.08 }, 'in'], [0.86, { ua: 0, la: 0, lean: 0 }], [1.2, REST]],
    hits: [circ(hit(0.32, 0.42, 6, { post: 12, kx: 160 }), 62, -16, 30), circ(hit(0.58, 0.68, 7, { post: 14, kx: 300 }), 58, -16, 30)],
    ev: [[0.08, 'tele', 0], [0.36, 'tele', 0], [0.3, 'sfx', 'beastHiss']], punish: [0.68, 1.2] },

  // Scorpion: cocks the tail back and drives the sting down over its head.
  bt_scorp_sting: { dur: 1.2,
    keys: [[0, {}], [0.34, { bl: -0.4, lean: -0.12, py: 1.08, px: -0.1 }], [0.42, { bl: -0.45 }], [0.52, { bl: 1, lean: 0.14, py: 0.92, px: 0.12 }, 'in'], [0.76, { bl: 0.85 }], [1.2, REST]],
    hits: [hit(0.46, 0.62, 12, { post: 24, kx: 300 })],
    ev: [[0.14, 'tele', 0], [0.44, 'sfx', 'beastHiss']], punish: [0.62, 1.2] },
  // Pincers wide, then a snap.
  bt_scorp_pinch: { dur: 0.85,
    keys: [[0, {}], [0.24, { ua: 1, la: 1, f1x: 0.55, f1y: 0.1, f2x: 0.45, f2y: 0.15, px: -0.06, hr: 1 }], [0.34, { f1x: 1.0, f1y: -0.25, f2x: 0.95, f2y: -0.2, px: 0.2, hr: 0 }, 'in'], [0.6, { ua: 0, la: 0 }], [0.85, REST]],
    hits: [circ(hit(0.3, 0.42, 7, { post: 16, kx: 320 }), 72, -18, 30)], step: [[0.28, 0.4, 380]],
    ev: [[0.06, 'tele', 0], [0.28, 'sfx', 'beastBite']], punish: [0.42, 0.85] },
  // The tail rises and trembles, then the sting goes into the floor far in front. Red.
  bt_scorp_impale: { dur: 2.0,
    keys: [[0, {}], [0.4, { bl: -0.6, lean: -0.2, py: 1.12, px: -0.12 }], [0.55, { bl: -0.66 }], [0.65, { bl: -0.58 }], [0.75, { bl: -0.68 }], [0.85, { bl: -0.6 }],
      [0.96, { bl: 1.25, lean: 0.3, py: 0.9, px: 0.18 }, 'in'], [1.5, { bl: 1.15, lean: 0.25 }], [2.0, REST]],
    hits: [hit(0.92, 1.08, 20, { post: 40, kx: 420, ky: -360, kind: 'knock', unblockable: true, stop: 0.12, shake: 0.5 })],
    ev: [[0.16, 'tele', 1], [0.4, 'sfx', 'beastHiss'], [0.98, 'fx', 'groundHit']], punish: [1.1, 2.0] },

  // Flyer: brakes with the wings raised, dives at you with the talons out, climbs away. The brain
  // steers it through the phases (fractions of the move, so tempo copies keep working).
  bt_flyer_swoop: { dur: 1.6, run: 0.5,
    keys: [[0, {}], [0.4, { rot: 1, ua: 1, la: 1, f1x: 0.1, f1y: -0.6, f2x: 0.05, f2y: -0.6, head: 0.3, lean: -0.2 }], [0.52, { rot: -1, ua: 1, la: 1, f1x: 0.7, f1y: -0.5, f2x: 0.6, f2y: -0.55, head: -0.2, lean: 0.35, hr: 1 }, 'out'],
      [0.98, { rot: -1, lean: 0.3, hr: 0.6 }], [1.12, { rot: 0, ua: 0, la: 0, lean: -0.2, head: 0.2, hr: 0 }], [1.6, REST]],
    hits: [circ(hit(0.5, 1.0, 9, { post: 18, kx: 260 }), 12, -22, 40)],
    ev: [[0.08, 'tele', 0], [0.5, 'sfx', 'beastScreech']], punish: [1.0, 1.6] },
  // Drops to your head height and cuts straight through you.
  bt_flyer_strafe: { dur: 1.8, run: 0.72,
    keys: [[0, {}], [0.6, { rot: 1, head: 0.2, lean: -0.15 }], [0.72, { rot: -1, ua: 1, la: 1, f1x: 0.6, f1y: -0.4, f2x: 0.5, f2y: -0.45, lean: 0.2, hr: 1 }, 'out'],
      [1.3, { rot: -1 }], [1.42, { rot: 0, ua: 0, la: 0, lean: -0.2, hr: 0 }], [1.8, REST]],
    hits: [circ(hit(0.72, 1.3, 8, { post: 16, kx: 300 }), 10, -24, 38)],
    ev: [[0.3, 'tele', 0], [0.72, 'sfx', 'beastScreech']], punish: [1.3, 1.8] },

  // Ape: a looping hook with the near fist.
  bt_ape_swipe: { dur: 1.25,
    keys: [[0, {}], [0.4, { ua: 1, f1x: -0.3, f1y: 0.38, lean: -0.22, py: 1.04, px: -0.1, head: 0.1 }], [0.5, { f1x: -0.36, f1y: 0.42 }], [0.62, { ua: 1, f1x: 0.95, f1y: -0.2, lean: 0.15, px: 0.25, py: 0.95 }, 'in'],
      [0.9, { ua: 1, f1x: 0.7, f1y: -0.6 }], [1.0, { ua: 0 }], [1.25, REST]],
    hits: [hit(0.52, 0.66, 14, { post: 30, kx: 420, ky: -200, kind: 'knock', stop: 0.1, shake: 0.35 })], step: [[0.5, 0.62, 300]],
    ev: [[0.2, 'tele', 0], [0.5, 'sfx', 'swingHeavy']], punish: [0.66, 1.25] },
  // Rears up roaring with both fists overhead and brings them down. Red, with a shockwave.
  bt_ape_slam: { dur: 2.3, armor: [0.2, 1.1],
    keys: [[0, {}], [0.82, { ua: 1, la: 1, f1x: 0.12, f1y: 0.95, f2x: 0.02, f2y: 0.9, lean: -0.85, py: 1.12, head: 0.4, ha: 0.25, hr: 1 }], [0.92, { f1x: 0.08, f1y: 1.0, f2x: -0.02, f2y: 0.95, lean: -0.9 }],
      [1.04, { f1x: 0.82, f1y: -0.95, f2x: 0.72, f2y: -0.95, lean: 0.35, py: 0.8, px: 0.2, head: -0.2, hr: 0.3 }, 'in'], [1.6, { lean: 0.3, py: 0.82 }], [2.3, REST]],
    hits: [circ(hit(1.0, 1.1, 24, { post: 50, kx: 480, ky: -420, kind: 'knock', unblockable: true, stop: 0.14, shake: 0.7 }), 70, -20, 75)],
    ev: [[0.2, 'tele', 1], [0.45, 'sfx', 'beastRoar'], [1.04, 'fx', 'groundHit'], [1.05, 'spawn', 'waves'], [1.05, 'sfx', 'beastStomp']], punish: [1.1, 2.3] },
  // Bounds into the air and lands fists first where you were. The landing is bt_ape_land.
  bt_ape_leap: { dur: 3, landMove: 'bt_ape_land',
    keys: [[0, {}], [0.44, { py: 0.7, lean: 0.25, head: -0.2 }], [0.52, { ua: 1, la: 1, f1x: 0.2, f1y: 0.9, f2x: 0.1, f2y: 0.85, lean: -0.5, py: 1.05, head: 0.3, hr: 1 }, 'out'], [3, { ua: 1, la: 1, f1x: 0.3, f1y: 0.8, f2x: 0.2, f2y: 0.75, lean: -0.4 }]],
    hits: [], ev: [[0.08, 'tele', 0], [0.4, 'sfx', 'beastRoar'], [0.5, 'leapAt', [-950, 680]]] },
  bt_ape_land: { dur: 1.4,
    keys: [[0, { ua: 1, la: 1, f1x: 0.8, f1y: -0.95, f2x: 0.7, f2y: -0.95, lean: 0.35, py: 0.72, hr: 0.4 }], [0.9, { ua: 1, la: 1, lean: 0.3, py: 0.78 }], [1.4, REST]],
    hits: [circ(hit(0, 0.1, 18, { post: 40, kx: 420, ky: -360, kind: 'knock', stop: 0.12, shake: 0.6 }), 30, -30, 85)],
    ev: [[0, 'fx', 'groundHit'], [0.02, 'sfx', 'beastStomp']], punish: [0.15, 1.4] },

  // Spitter: swells its throat while it aims, then spits a bolt.
  bt_spit_shot: { dur: 1.35, aim: [0.05, 0.62], aimRange: [-0.7, 0.75],
    keys: [[0, {}], [0.3, { rot: 0.55, lean: -0.1, head: 0.15, py: 1.05 }], [0.66, { rot: 1, hr: 0.3, lean: -0.18 }], [0.74, { rot: 0, hr: 1, lean: 0.12, px: -0.06 }, 'out'], [1.35, REST]],
    hits: [], ev: [[0.36, 'tele', 0], [0.72, 'spawn', 'bolt'], [0.72, 'sfx', 'beastHiss']], punish: [0.78, 1.35] },
  // Throws its head back and lobs a glob that bursts where you stand. Red.
  bt_spit_lob: { dur: 1.5,
    keys: [[0, {}], [0.45, { rot: 1, head: 0.45, ha: 0.4, lean: -0.25, py: 1.08 }], [0.62, { rot: 0, head: 0.7, ha: 0.6, hr: 1, lean: -0.1 }, 'out'], [1.5, REST]],
    hits: [], ev: [[0.16, 'tele', 1], [0.6, 'spawn', 'lob'], [0.6, 'sfx', 'beastHiss']], punish: [0.65, 1.5] },
  // Up close it can only shove you off with its head.
  bt_spit_slap: { dur: 0.8,
    keys: [[0, {}], [0.26, { px: -0.14, head: 0.2, lean: -0.1, py: 0.92 }], [0.34, { px: 0.22, head: -0.2, lean: 0.12, hr: 0.6 }, 'in'], [0.8, REST]],
    hits: [circ(hit(0.3, 0.44, 5, { post: 14, kx: 560 }), 46, -20, 28)], step: [[0.28, 0.4, 300]],
    ev: [[0.08, 'tele', 0], [0.3, 'sfx', 'beastBite']], punish: [0.46, 0.8] },
};
for (const id in BT) registerMove(id, BT[id]);

// Moves each plan learns: [id, min distance, max distance, weight, tier learned]. Distances are at
// scale 1 and grow with the animal.
const KIT = {
  hound: [['bt_hound_snap', 0, 150, 3, 1], ['bt_hound_pounce', 170, 380, 2, 1], ['bt_hound_harry', 0, 140, 2, 4]],
  charger: [['bt_charger_gore', 0, 170, 3, 1], ['bt_charger_charge', 300, 1400, 3, 1], ['bt_charger_stomp', 0, 180, 1, 3]],
  raptor: [['bt_raptor_rake', 0, 140, 3, 1], ['bt_raptor_leap', 190, 420, 2, 1], ['bt_raptor_snap', 0, 150, 2, 4]],
  stalker: [['bt_stalker_lunge', 0, 190, 3, 1], ['bt_stalker_rake', 0, 110, 2, 3]],
  scorpion: [['bt_scorp_sting', 0, 160, 3, 1], ['bt_scorp_pinch', 0, 115, 2, 1], ['bt_scorp_impale', 60, 220, 1, 4]],
  flyer: [['bt_flyer_swoop', 0, 9999, 3, 1], ['bt_flyer_strafe', 0, 9999, 2, 3]],
  ape: [['bt_ape_swipe', 0, 160, 3, 1], ['bt_ape_slam', 0, 175, 2, 1], ['bt_ape_leap', 230, 600, 2, 4]],
  spitter: [['bt_spit_shot', 0, 9999, 3, 1], ['bt_spit_slap', 0, 130, 2, 1], ['bt_spit_lob', 0, 9999, 2, 3]],
};

// ───────────── the body ─────────────
export class Beast extends Fighter {
  constructor(def, x, team) {
    super(def, x, team);
    const B = this.B, s = this.scale;
    this.lens = [B.neck * s, B.spine * s, B.fl[0] * s, B.fl[1] * s, B.fl[0] * s, B.fl[1] * s, B.hl[0] * s, B.hl[1] * s, B.hl[0] * s, B.hl[1] * s];
    if (!def.blade.gun) this.bladeOn = 0.4;
  }

  // Runs from the first computeJoints, which the Fighter constructor calls before ours returns.
  setup() {
    const B = this.B = this.def.body;
    this.gph = frac(this.t * 0.37); this.gamp = 0; this.gb = 0; this.airK = 0; this.flap = this.t * 3;
    this.xm = 1; this.turnT = 0; this.lastF = this.facing; this.accS = 0; this.lastVx = 0; this.bobY = 0; this.bobA = 0;
    this.spA = B.pitch0; this.hdA = 0; this.tailK = 1; this.excite = 0;
    this.tl = new Float32Array(2 * (B.tail.n + 1));
    this.xl = new Float32Array(6 * Math.max(1, B.xn));
    this.wg = new Float32Array(16); // wing finger tips: near then far, 4 points each
    this.saddleX = this.x; this.saddleY = -B.hipH * this.scale;
    this.legLen = (B.hl[0] + B.hl[1]);
  }

  update(world, dt) {
    if (!this.dead && !this.def.blade.gun) this.bladeOn = approach(this.bladeOn, this.state === 'attack' ? 1 : 0.4, dt * 5);
    super.update(world, dt);
    // Stand-up blends the joints after computeJoints; rebuild the parts hung off them.
    if (this.state === 'getup' && !this.rag) this.derive();
  }

  // Gait, weight and reactions. The spring integration is the Fighter's.
  updatePose(dt) {
    const t = this.tgt, B = this.B, p = this.p;
    fillStance(t, this.stance);
    if (this.facing !== this.lastF) { this.lastF = this.facing; this.turnT = B.turn; }
    if (this.turnT > 0) this.turnT = Math.max(0, this.turnT - dt);
    this.xm = 1 - 0.72 * EASE.io(this.turnT / B.turn);

    const fly = !!this.def.flying, ground = this.onGround && !this.rag;
    const sp = Math.abs(this.vx), run = this.def.runSpeed;
    this.gamp = approach(this.gamp, ground && sp > 22 ? 1 : 0, dt * (sp > 22 ? 6 : 3));
    // Gallop only when actually fast: a heavy animal at its own top speed trots, and gallops in a charge.
    this.gb = approach(this.gb, smooth(0.55, 0.9, sp / Math.max(run, 330)), dt * 4);
    const G = B.gait, cyc = (G.cw + (G.cr - G.cw) * this.gb) * this.legLen;
    if (ground) this.gph = frac(this.gph + (this.vx * this.facing * dt) / (cyc * this.scale));
    this.airK = approach(this.airK, !ground && !fly ? 1 : 0, dt * (ground ? 12 : 7));
    let acc = dt > 0 ? (this.vx - this.lastVx) / dt : 0; this.lastVx = this.vx;
    acc = clamp(acc, -4000, 4000);
    this.accS += (acc * this.facing - this.accS) * Math.min(1, dt * 8);
    if (sp > run * 0.7) this.excite = Math.min(4, this.excite + dt); else this.excite = Math.max(0, this.excite - dt * 0.5);

    // Body bob from the gait: dips on the footfalls of a walk, a rocking pitch at the gallop.
    const u = this.gph * TAU, a = this.gamp, b = this.gb;
    if (B.gait === BIPED) { this.bobY = -B.hipH * a * (0.03 + 0.03 * b) * (0.5 - 0.5 * Math.cos(2 * u)); this.bobA = a * 0.04 * Math.sin(2 * u); }
    else if (B.gait === CRAWL) { this.bobY = B.hipH * a * 0.04 * Math.sin(2 * u); this.bobA = 0; }
    else { this.bobY = -B.hipH * a * (1 - b) * 0.025 * (0.5 - 0.5 * Math.cos(2 * u)) + B.hipH * a * b * 0.07 * Math.sin(u); this.bobA = a * b * B.rock * Math.sin(u + 1.3); }
    if (fly) {
      const climb = this.vy < -60 ? 1 : 0;
      this.flap += dt * TAU * B.flapHz * (this.onGround ? 0 : 1 + climb * 0.5);
      this.bobY = this.onGround ? 0 : -Math.sin(this.flap) * 2.2;
    }

    let w = 15, z = 0.75;
    this.tailK = 1;
    switch (this.state) {
      case 'free': case 'dash': case 'guard':
        if (fly) { if (this.onGround) t[ROT] = -1; else { t[LEAN] += clamp(this.vx * this.facing * 0.0006, -0.25, 0.3); t[HEAD] += Math.sin(this.t * 1.3) * 0.08; } }
        else if (!this.onGround) { t[LEAN] = this.vy < 0 ? -0.18 : 0.14; t[HEAD] += 0.12; t[BL] += this.vy < 0 ? -0.25 : 0.35; t[HR] = 0.3; w = 18; }
        else if (sp > 22) {
          // Moving: the head drops and the tail streams as it speeds up; a hound pants after running.
          t[HEAD] -= 0.14 * b; t[BL] += B.tailRun * b; t[PY] -= 0.04 * b; t[HR] = B.pant ? 0.35 * b : 0; w = 22; z = 0.85; this.tailK = 0.6;
        } else {
          t[PY] += Math.sin(this.t * 2.1) * 0.014; t[HEAD] += Math.sin(this.t * 0.63) * 0.07 + Math.sin(this.t * 1.7 + 2) * 0.025;
          t[HA] += Math.sin(this.t * 1.1 + 1) * 0.05; t[BL] += Math.sin(this.t * 0.9) * 0.06;
          if (B.pant && this.excite > 0.2) t[HR] = 0.28 + Math.sin(this.t * 15) * 0.1;
          if (this.state === 'guard') { t[PY] = 0.9; t[HEAD] = -0.25; t[HR] = 0.5; }
        }
        break;
      case 'attack':
        sampleMove(this.move, this.mt, t); w = 44; z = 0.9; this.tailK = 0.5;
        break;
      case 'hitstun': t[LEAN] = -0.32; t[HEAD] = 0.28; t[HA] = 0.32; t[HR] = 0.75; t[PY] = 0.88; t[PX] = -0.14; t[BL] = -0.4; w = 24; z = 0.55; break;
      case 'recoil': t[LEAN] = -0.45; t[HEAD] = 0.38; t[HA] = 0.35; t[HR] = 0.5; t[PY] = 1.04; t[PX] = -0.22; t[BL] = 0.45; w = 26; z = 0.6; break;
      case 'stagger':
        t[PY] = 0.6 + Math.sin(this.st * 5) * 0.03; t[LEAN] = 0.3 + Math.sin(this.st * 8) * 0.05; t[HEAD] = -0.55 + Math.sin(this.st * 3) * 0.08; t[HA] = -0.35;
        t[HR] = 0.6; t[BL] = -0.55; t[PX] = Math.sin(this.st * 3.3) * 0.05; t[ROT] = fly ? -1 : 0; w = 13; z = 0.6; this.tailK = 0.2; break;
      case 'getup': t[HEAD] = -0.1; w = 16; break;
      case 'custom': if (this.poseFn) w = this.poseFn(this, t) || 24; break;
    }
    // Weight: pitches into a stop, rocks back when it sets off, and the tail swings the other way.
    const lean = clamp(this.accS * 0.00011, -0.22, 0.22);
    if (ground && !fly) { t[LEAN] -= lean; t[BL] -= lean * 1.6; t[PY] -= Math.min(0.05, Math.abs(lean) * 0.2); }
    if (this.turnT > 0) t[PY] -= 0.06 * Math.sin(PI * this.turnT / B.turn);
    const v = this.pv, w2 = w * w, c = 2 * z * w;
    for (let i = 0; i < N; i++) { v[i] += (w2 * (t[i] - p[i]) - c * v[i]) * dt; p[i] += v[i] * dt; }
  }

  // Foot offset from the gait for a limb with phase offset `off`: planted feet slide back at exactly
  // the ground speed, swinging feet arc forward. Writes local (x, y) into GF.
  gait(off) {
    const G = this.B.gait, b = this.gb, a = this.gamp;
    const beta = G.betaW + (G.betaR - G.betaW) * b, cyc = (G.cw + (G.cr - G.cw) * b) * this.legLen;
    const S = cyc * beta * a, lift = (G.liftW + (G.liftR - G.liftW) * b) * a * this.legLen;
    const u = frac(this.gph + off);
    if (u < beta) { GF[0] = S * (0.5 - u / beta); GF[1] = 0; }
    else { const q = (u - beta) / (1 - beta); GF[0] = S * (-0.5 + q * q * (3 - 2 * q)); GF[1] = lift * Math.sin(PI * q); }
  }

  computeJoints() {
    if (!this.B) this.setup();
    const B = this.B, p = this.p, s = this.scale, f = this.facing, xm = this.xm, j = this.j;
    const th = B.pitch0 - p[LEAN] + this.bobA, ct = Math.cos(th), st = Math.sin(th);
    const hipX = p[PX] * B.spine - B.cx * B.spine * ct, hipY = p[PY] * B.hipH + this.bobY;
    const shX = hipX + B.spine * ct, shY = hipY + B.spine * st;
    const na = th + B.neck0 + p[HEAD];
    L[0] = shX + Math.cos(na) * B.neck; L[1] = shY + Math.sin(na) * B.neck;
    L[2] = shX; L[3] = shY; L[4] = hipX; L[5] = hipY;
    this.spA = th; this.hdA = na + B.head0 + p[HA];
    const aiming = this.state === 'attack' && this.move.aim && this.aimLocal !== undefined && this.mt < this.move.dur - 0.5;
    if (aiming) this.hdA += (this.aimLocal - this.hdA) * 0.75;
    for (let k = 0; k < 4; k++) this.limb(k, k < 2 ? shX : hipX, k < 2 ? shY : hipY);
    for (let i = 0; i < 22; i += 2) { j[i] = this.x + L[i] * s * f * xm; j[i + 1] = this.y - L[i + 1] * s; }
    this.derive();
  }

  // One limb: a gait leg, a folded arm, a held pincer, a dangling talon or a flapping wing.
  limb(k, rx, ry) {
    const B = this.B, p = this.p, role = B.roles[k], front = k < 2;
    const l1 = front ? B.fl[0] : B.hl[0], l2 = front ? B.fl[1] : B.hl[1], len = l1 + l2, o = 6 + k * 4;
    if (role === 'wing') {
      // Flapping: the arm sweeps from up-and-back to down-and-forward; on the upstroke the forearm
      // folds toward the tail. Held raised it spreads high (a brake, a wind-up); tucked it folds back.
      const h = p[ROT], ph = this.flap - k * 0.3, fold = Math.max(0, Math.cos(ph));
      let a1 = 0.6 + 1.15 * Math.sin(ph), a2 = a1 + Math.sign(Math.sin(a1) || 1) * (0.12 + 1.25 * fold);
      if (h > 0) { a1 += (1.7 - a1) * h; a2 += (2.05 - a2) * h; }
      else if (h < 0) { a1 += (2.75 - a1) * -h; a2 += (3.05 - a2) * -h; }
      const ex = rx + Math.cos(a1) * l1, ey = ry + Math.sin(a1) * l1;
      L[o] = ex; L[o + 1] = ey; L[o + 2] = ex + Math.cos(a2) * l2; L[o + 3] = ey + Math.sin(a2) * l2;
      if (k) this.wa1 = a2; else this.wa0 = a2;
      return;
    }
    let tx, ty;
    if (role === 'leg') {
      const off = B.gait.offW[k] + (B.gait.offR[k] - B.gait.offW[k]) * this.gb;
      this.gait(off);
      tx = B.footX[k] + GF[0]; ty = GF[1];
      if (this.airK > 0) {
        // In the air: forelegs tuck or reach, hind legs trail.
        const up = this.vy < 0 ? 1 : 0, ak = this.airK;
        const ax = B.footX[k] + (front ? 0.32 : -0.34) * len, ay = B.hipH * (front ? 0.2 + 0.25 * up : 0.3 + 0.1 * up);
        tx += (ax - tx) * ak; ty += (ay - ty) * ak;
      }
    } else if (role === 'arm') { tx = rx + 0.45 * len + Math.sin(this.t * 2.3 + k) * 0.03 * len; ty = ry - 0.5 * len; }
    else if (role === 'pincer') { tx = rx + (0.62 - k * 0.08) * len + Math.sin(this.t * 1.7 + k * 2) * 0.04 * len; ty = ry - 0.38 * len + Math.sin(this.t * 2.2 + k) * 0.03 * len; }
    else { tx = rx - 0.1 * len; ty = this.onGround ? 0 : ry - 0.92 * len; } // a talon hangs, or stands
    if (k === B.limbA) { const q = clamp(p[UA], 0, 1); tx += (rx + p[F1X] * len - tx) * q; ty += (ry + p[F1Y] * len - ty) * q; }
    else if (k === B.limbB) { const q = clamp(p[LA], 0, 1); tx += (rx + p[F2X] * len - tx) * q; ty += (ry + p[F2Y] * len - ty) * q; }
    if (ty < -2 && role !== 'talon') ty = -2;
    ik2(rx, ry, tx, ty, l1, l2, front ? B.bendF : B.bendH, IK);
    L[o] = IK[0]; L[o + 1] = IK[1]; L[o + 2] = IK[2]; L[o + 3] = IK[3];
  }

  // A point in the head's frame (along the head in head lengths, up in head radii) into HP.
  headPt(a, b) {
    const B = this.B, s = this.scale, f = this.facing * this.xm, c = Math.cos(this.hdA), sn = Math.sin(this.hdA);
    HP[0] = this.j[0] + (c * a * B.head - sn * b * B.headR) * s * f;
    HP[1] = this.j[1] - (sn * a * B.head + c * b * B.headR) * s;
  }

  // Everything hung off the joints: tail, extra legs, wing tips, the weapon and the saddle.
  derive() {
    const B = this.B, j = this.j, s = this.scale, f = this.facing, xm = this.xm, fx = f * xm, p = this.p;
    const T = B.tail;
    if (T.n) {
      const seg = (T.len / T.n) * s, tl = this.tl;
      let x = j[4] - Math.cos(this.spA) * T.off * s * fx, y = j[5] + Math.sin(this.spA) * T.off * s;
      tl[0] = x; tl[1] = y;
      const bl = p[BL];
      let a = this.spA + PI - T.rest - bl * T.blK;
      const curl = T.curl + bl * T.blC, wag = T.amp * this.tailK;
      for (let i = 1; i <= T.n; i++) {
        const k = i / T.n;
        a -= curl;
        const aa = a + wag * k * Math.sin(this.t * T.freq - i * 0.75);
        x += Math.cos(aa) * seg * fx; y -= Math.sin(aa) * seg;
        if (y > -1.5) y = -1.5;
        tl[i * 2] = x; tl[i * 2 + 1] = y;
        if (i === T.n) this.tailA = aa;
      }
    }
    if (B.xn) {
      // Extra legs, drawn but not simulated: roots along the spine, feet from the same gait.
      const hx = (j[4] - this.x) * f / xm / s, hy = (this.y - j[5]) / s, sx = (j[2] - this.x) * f / xm / s, sy = (this.y - j[3]) / s;
      const xl = this.xl, gb = this.gb;
      for (let i = 0; i < B.xn; i++) {
        const q = B.xr[i], rx = hx + (sx - hx) * q, ry = hy + (sy - hy) * q;
        this.gait(B.xo[i] + (B.xo2[i] - B.xo[i]) * gb);
        let tx = B.xf[i] + GF[0], ty = GF[1];
        if (this.airK > 0) { tx += (rx + (B.xf[i] - rx) * 0.6 - tx) * this.airK; ty += (ry * 0.6 - ty) * this.airK; }
        ik2(rx, ry, tx, Math.max(0, ty), B.xl[0], B.xl[1], B.xf[i] > rx ? 1 : -1, IK);
        const o = i * 6;
        xl[o] = this.x + rx * s * fx; xl[o + 1] = this.y - ry * s;
        xl[o + 2] = this.x + IK[0] * s * fx; xl[o + 3] = this.y - IK[1] * s;
        xl[o + 4] = this.x + IK[2] * s * fx; xl[o + 5] = this.y - IK[3] * s;
      }
    }
    if (B.wing) {
      // Wing tips spread from the wrist: three fingers or primaries.
      const wg = this.wg;
      for (let w = 0; w < 2; w++) {
        const a2 = (w ? this.wa1 : this.wa0) ?? 0;
        const wx = j[w ? 12 : 8], wy = j[w ? 13 : 9];
        for (let i = 0; i < 3; i++) {
          const ang = a2 + Math.sign(Math.sin(a2) || 1) * B.wingFan[i], ln = B.wingLen[i] * s * (w ? 0.9 : 1);
          wg[w * 8 + i * 2] = wx + Math.cos(ang) * ln * fx; wg[w * 8 + i * 2 + 1] = wy - Math.sin(ang) * ln;
        }
      }
    }
    this.placeWeapon();
    // The seat: on top of the back, a little ahead of the middle.
    const mx = j[4] + (j[2] - j[4]) * 0.55, my = j[5] + (j[3] - j[5]) * 0.55;
    this.saddleX = mx - Math.sin(this.spA) * B.backH * s * fx; this.saddleY = my - Math.cos(this.spA) * B.backH * s;
  }

  placeWeapon() {
    const B = this.B, s = this.scale, fx = this.facing * this.xm, len = B.wLen * s;
    let a;
    switch (B.weapon) {
      case 'jaw': this.headPt(0.2, -0.32); a = this.hdA - 0.12 - this.p[HR] * 0.6; break;
      case 'beak': this.headPt(0.45, -0.05); a = this.hdA - 0.18 - this.p[HR] * 0.3; break;
      case 'horn': case 'tusk': this.headPt(B.wb[0], B.wb[1]); a = this.hdA + B.wAng; break;
      case 'spit': {
        this.headPt(0.95, -0.25); a = this.hdA - 0.08;
        if (this.state === 'attack' && this.move.aim && this.aimLocal !== undefined && this.mt < this.move.dur - 0.5) a = this.aimLocal;
        break;
      }
      case 'claw': {
        const j = this.j; HP[0] = j[8]; HP[1] = j[9];
        a = Math.atan2(-(j[9] - j[7]), (j[8] - j[6]) * this.facing) + B.wAng; break;
      }
      case 'sting': {
        const n = B.tail.n, tl = this.tl; HP[0] = tl[n * 2]; HP[1] = tl[n * 2 + 1];
        a = (this.tailA ?? 0) - B.wAng - this.p[BL] * 0.3; break;
      }
    }
    this.bx = HP[0]; this.by = HP[1];
    this.tx = HP[0] + Math.cos(a) * len * fx; this.ty = Math.min(-2, HP[1] - Math.sin(a) * len);
    this.t2x = this.bx; this.t2y = this.by;
  }

  // Four hit circles: head, chest, haunch, and one more where this body is long (belly, abdomen, wing, tail).
  hurt(out) {
    const B = this.B, j = this.j, s = this.scale, fx = this.facing * this.xm;
    this.headPt(0.35, 0);
    out[0] = HP[0]; out[1] = HP[1]; out[2] = Math.max(8, B.headR * 1.25) * s;
    const dn = B.girth * 0.3 * s;
    out[3] = j[2]; out[4] = j[3] + dn; out[5] = Math.max(10, B.girth * 0.8) * s;
    out[6] = j[4]; out[7] = j[5] + dn * 0.6; out[8] = Math.max(9, B.girth * 0.7) * s;
    if (B.wing) { out[9] = j[8]; out[10] = j[9]; out[11] = 12 * s; }
    else if (B.weapon === 'sting') { const m = (B.tail.n >> 1) * 2; out[9] = this.tl[m]; out[10] = this.tl[m + 1]; out[11] = 9 * s; }
    else if (B.abdomen) { out[9] = j[4] - Math.cos(this.spA) * B.abdomen * 0.9 * s * fx; out[10] = j[5] - B.abdomen * 0.2 * s; out[11] = B.abdomen * 0.85 * s; }
    else { out[9] = (j[2] + j[4]) / 2; out[10] = (j[3] + j[5]) / 2 + dn; out[11] = Math.max(10, B.girth * 0.8) * s; }
    return out;
  }

  // Limp: keep the natural weapon on the head or the tail instead of the forearm.
  updateRagdoll(world, dt) {
    super.updateRagdoll(world, dt);
    if (!this.rag) return;
    const B = this.B, j = this.j, len = B.wLen * this.scale;
    let a = -1, b = -1, c = -1;
    if (B.weapon === 'sting') { a = 4; b = 2; } else if (B.weapon !== 'claw') { a = 0; b = 2; c = 0; }
    if (a >= 0) {
      const dx = j[a] - j[b], dy = j[a + 1] - j[b + 1], d = Math.hypot(dx, dy) || 1;
      const ox = c >= 0 ? j[0] : j[4], oy = c >= 0 ? j[1] : j[5];
      this.bx = ox; this.by = oy; this.tx = ox + (dx / d) * len; this.ty = Math.min(-2, oy + (dy / d) * len);
      this.t2x = this.bx; this.t2y = this.by;
    }
    this.saddleX = (j[2] + j[4]) / 2; this.saddleY = Math.min(j[3], j[5]) - B.backH * this.scale;
  }

  getUp(dur) {
    const rg = this.rag, mid = (rg.x[1] + rg.x[2]) / 2;
    if (Math.abs(rg.x[1] - rg.x[2]) > 4) this.facing = rg.x[1] > rg.x[2] ? 1 : -1;
    this.lastF = this.facing;
    super.getUp(dur);
    this.x = mid;
    const p = this.p;
    p[PY] = 0.42; p[LEAN] = 0.1; p[HEAD] = -0.4; p[PX] = 0; p[UA] = 0; p[LA] = 0; p[ROT] = 0; p[HR] = 0.3;
    this.gamp = 0; this.airK = 0; this.vx = 0; this.lastVx = 0; this.accS = 0;
  }

  land(world) {
    // A hard landing squashes the body by a share of its own height, not by a humanoid's.
    this.pv[PY] -= clamp(this.vy * 0.35, 80, 420) / this.B.hipH * 0.55;
    this.pv[LEAN] += clamp(this.vy * 0.0015, 0, 1.2);
    world.onLand(this, this.vy);
    if (this.move?.landMove) { this.startMove(this.move.landMove); world.sfx('slam', this.x); }
    else if (this.def.body.heavy && this.vy > 500) world.sfx('beastStomp', this.x, 0.6);
  }

  // A glob lobbed from the mouth instead of the far hand.
  fire(world, ev) {
    if (ev[1] === 'spawn' && ev[2] === 'lob') {
      const pl = world.player;
      world.projectiles.lob(this, this.tx, this.ty, clamp(pl.x + pl.vx * 0.35, world.minX + 40, world.maxX - 40), { time: 0.9, r: 90, dmg: 12 });
      world.fx.flash(this.tx, this.ty, 50, this.color, 0.1);
      return;
    }
    super.fire(world, ev);
  }
}

// ───────────── brains ─────────────
// Point the mouth at the player while an aimed move's window is open (the Marksman's rule).
function aimMove(f, pl) {
  if (f.state !== 'attack' || !f.move.aim) return false;
  if (f.mt < f.move.aim[1]) {
    f.face(pl.x);
    const ang = Math.atan2(pl.cy - f.j[1], pl.cx - f.j[0]), lim = f.move.aimRange || [-0.45, 0.8];
    f.aimLocal = clamp(Math.atan2(-Math.sin(ang), Math.cos(ang) * f.facing), lim[0], lim[1]);
  }
  return true;
}
// Generated tempo copies keep the source id in `src`; ranged is marked on the source.
const ranged = (id) => !!(MOVES[id].ranged || MOVES[MOVES[id].src]?.ranged);

function begin(f, id) {
  const ai = f.ai, P = f.def.ai;
  ai.last = id; ai.next = null; f.startMove(id);
  ai.cd = MOVES[id].dur + rand(P.cd[0], P.cd[1]) * ai.cdMul;
}

const ROAR = (f, t) => {
  const k = f.st / f.stDur, up = Math.sin(PI * Math.min(1, k * 1.4));
  t[LEAN] = -0.35 * up * f.B.rear; t[HEAD] = 0.4 * up; t[HA] = 0.35 * up; t[HR] = up; t[PY] = 1 + 0.05 * up; t[BL] = 0.3 * up;
  if (f.B.roar === 'beat') { t[UA] = up; t[LA] = up; t[F1X] = 0.35 + Math.sin(f.st * 22) * 0.12; t[F1Y] = 0.25; t[F2X] = 0.3 - Math.sin(f.st * 22) * 0.12; t[F2Y] = 0.2; }
  if (f.B.roar === 'paw') { t[UA] = Math.max(0, Math.sin(f.st * 9)); t[F1X] = 0.25; t[F1Y] = -0.8; t[HEAD] = -0.3 * up; t[LEAN] = 0.05; }
  return 20;
};
function taunt(f, world) {
  f.setState('custom', f.B.roar === 'paw' ? 1.1 : 1.0); f.poseFn = ROAR;
  world.sfx(f.B.roar === 'paw' ? 'beastHoof' : 'beastRoar', f.x, 0.7);
}
const SKIT = { id: null, min: 110, max: 340, w: 2 };

// The ground brain. When its pause runs out it chooses its next attack first, then closes in or backs
// off (turning its back to walk away) until it stands in that attack's range, and asks for a turn.
// In between it keeps a band of distance, walks near it and runs when far, and paces.
export function beastCtrl(f, world, dt) {
  const ai = f.ai, P = f.def.ai, pl = world.player;
  if (!ai.init) { initAi(f, { pace: 0, paceT: rand(0.5, 1.5), next: null, nextT: 0, tauntCd: rand(3, 7) }); if (world.floor === 1) ai.cd += 0.8; }
  ai.cd -= dt; ai.flankCd -= dt; ai.tauntCd -= dt;
  if (f.rag) { ai.busy = false; return; }
  if (f.state === 'guard') f.setState('free');
  if (f.state === 'custom') { if (ai.script) ai.script(f, world, dt); return; }
  if (f.state === 'attack') { aimMove(f, pl); return; }
  ai.busy = false; ai.script = null;
  if (f.state !== 'free' || !f.onGround || pl.dead) return;

  const dx = pl.x - f.x, dist = Math.abs(dx), want = dx >= 0 ? 1 : -1, down = mercy(pl), sc = f.scale;
  const rmin = P.range[0] * sc + ai.rangeAdd, rmax = P.range[1] * sc + ai.rangeAdd;
  let mx = 0, face = want;

  if (ai.cd <= 0 && !ai.next) { ai.next = P.skitter && rng() < 0.4 ? SKIT : weighted(P.moves, ai.last); ai.nextT = 3; }
  if (ai.next) {
    const m = ai.next, lo = (m.min ?? 0) * (m === SKIT ? sc : 1), hi = m.max * (m === SKIT ? sc : 1);
    ai.nextT -= dt;
    if (ai.nextT <= 0) ai.next = null;
    else if (dist > hi) mx = want * (dist > hi + 160 ? 1 : P.walk + 0.25);
    else if (dist < lo) { mx = -want * (lo - dist > 120 ? 1 : P.walk); face = lo > 200 ? -want : want; }
    else if (f.facing === want && !down && world.requestAttack(f)) {
      if (m === SKIT) { ai.next = null; ai.cd = rand(P.cd[0], P.cd[1]) * ai.cdMul + 1.2; skitter(f, world); }
      else begin(f, m.id);
      return;
    }
  } else if (P.pack && ai.flankCd <= 0 && dist < 260 && dist > 90 && !down) {
    // A hound with a packmate between it and the player leaps over to come from the other side.
    ai.flankCd = rand(3, 6);
    for (const e of world.fighters) {
      if (e === f || e.dead || e.rag || e.def.beast !== f.def.beast || Math.sign(e.x - pl.x) !== Math.sign(f.x - pl.x) || Math.abs(e.x - pl.x) > dist) continue;
      const land = pl.x + want * rand(130, 190);
      if (land < world.minX + 80 || land > world.maxX - 80) break;
      f.facing = want; f.vy = -720; f.vx = (land - f.x) / ((2 * 720) / 2600); f.onGround = false; f.y -= 1;
      world.sfx('beastGrowl', f.x, 0.6);
      return;
    }
  } else if (P.roar && ai.tauntCd <= 0 && ai.cd > 1 && dist > rmin && !down) { ai.tauntCd = rand(7, 12); taunt(f, world); return; }
  else if (dist > rmax + ai.spread) mx = want * (dist > rmax + 220 ? 1 : P.walk);
  else if (dist < rmin) { mx = -want * P.walk; if (P.turnAway) face = -want; }
  else if (P.pace) {
    ai.paceT -= dt;
    if (ai.paceT <= 0) { ai.pace = rng() < 0.4 ? 0 : rng() < 0.5 ? 1 : -1; ai.paceT = rand(0.6, 1.5); }
    if (ai.pace) { mx = ai.pace * want * P.walk * 0.8; if (ai.pace < 0 && P.turnAway) face = -want; }
  }
  if ((f.x < world.minX + 90 && mx < 0) || (f.x > world.maxX - 90 && mx > 0)) mx = 0;
  // Big bodies are slow to come round: that is the moment to get behind one.
  if (f.facing !== face) { ai.turn += dt; if (ai.turn >= (P.turnLag ?? 0.1)) { f.facing = face; ai.turn = 0; } } else ai.turn = 0;
  f.moveX = mx;
}

// Stalker: darts past you along the floor to strike at your back.
function skitter(f, world) {
  const ai = f.ai, pl = world.player, dir = pl.x >= f.x ? 1 : -1;
  f.setState('custom', 0); ai.busy = true; f.facing = dir;
  ai.sk = { t: 0, dir, goal: clamp(pl.x + dir * rand(110, 150) * f.scale, world.minX + 70, world.maxX - 70) };
  world.sfx('beastHiss', f.x, 0.8);
  f.poseFn = SKITTER; ai.script = skitterStep;
}
const SKITTER = (f, t) => { t[PY] = 0.72; t[LEAN] = 0.12; t[HEAD] = -0.2; t[HR] = 0.4; return 30; };
function skitterStep(f, w, dt) {
  const ai = f.ai, sk = ai.sk;
  sk.t += dt;
  // Fast enough that the crowd separation lets it through.
  f.vx = sk.dir * 760; f.stepping = true;
  if ((f.x - sk.goal) * sk.dir < 0 && sk.t < 1.2) return;
  f.vx = sk.dir * 200; ai.busy = false; ai.script = null; f.setState('free'); f.face(w.player.x);
  const m = f.def.ai.moves.find((o) => MOVES[o.id].src === 'bt_stalker_lunge');
  if (m && !mercy(w.player) && !w.player.dead) begin(f, m.id);
}

// The flyer: hovers to one side of you out of reach, then swoops or strafes. Any hit drops it.
export function flyerCtrl(f, world, dt) {
  const ai = f.ai, pl = world.player, P = f.def.ai;
  if (!ai.init) initAi(f, { cd: rand(1.2, 2.2), side: rng() < 0.5 ? -1 : 1, hover: rand(170, 260), alt: rand(190, 250), dvx: 0, dvy: 0, diving: false });
  ai.cd -= dt;
  if (f.rag) { ai.busy = false; f.gravMul = 1; return; }
  f.gravMul = f.state === 'stagger' || f.state === 'getup' ? 1 : 0;
  if (f.state === 'attack') { steer(f, world, dt); return; }
  ai.diving = false;
  if (f.state !== 'free') { f.vx *= 0.96; f.vy *= 0.96; return; }
  if (f.onGround) { f.y -= 2; f.onGround = false; f.vy = -300; }
  f.face(pl.x);
  if (rng() < dt * 0.25) ai.side = -ai.side;
  const tx = clamp(pl.x + ai.side * ai.hover, world.minX + 60, world.maxX - 60), ty = -ai.alt + Math.sin(f.t * 1.9) * 18;
  f.vx = approach(f.vx, clamp((tx - f.x) * 3, -f.def.runSpeed, f.def.runSpeed), 900 * dt);
  f.vy = approach(f.vy, clamp((ty - f.y) * 4, -300, 300), 1300 * dt);
  if (ai.cd > 0 || pl.dead || mercy(pl)) return;
  const m = weighted(P.moves, ai.last);
  if (world.requestAttack(f)) begin(f, m.id);
}

// Velocity through a flying move, by the fraction of the move played, so tempo copies still steer.
function steer(f, world, dt) {
  const ai = f.ai, pl = world.player, m = f.move, k = f.mt / m.dur, src = m.src;
  const go = (m.run ?? m.dur * 0.3) / m.dur, end = m.punish ? m.punish[0] / m.dur : 0.65;
  if (k < go) {
    f.face(pl.x);
    if (src === 'bt_flyer_strafe') {
      // Drop to head height a little way off to one side.
      const tx = pl.x - f.facing * 320, ty = -64;
      f.vx = approach(f.vx, clamp((tx - f.x) * 3, -440, 440), 1400 * dt); f.vy = approach(f.vy, clamp((ty - f.y) * 4, -420, 420), 1600 * dt);
    } else { f.vx *= 0.9; f.vy = approach(f.vy, -90, 900 * dt); }
    ai.diving = false;
  } else if (k < end) {
    if (!ai.diving) {
      ai.diving = true;
      if (src === 'bt_flyer_strafe') { ai.dvx = f.facing * 760; ai.dvy = 0; }
      else { const dx = pl.cx - f.cx, dy = pl.cy - f.cy, d = Math.hypot(dx, dy) || 1; ai.dvx = (dx / d) * 840; ai.dvy = (dy / d) * 840; }
    }
    f.vx = ai.dvx; f.vy = ai.dvy;
    if (f.y > -36 && f.vy > 0) { f.vy = 0; ai.dvy = 0; }
    if ((f.x < world.minX + 60 && f.vx < 0) || (f.x > world.maxX - 60 && f.vx > 0)) { f.vx = 0; ai.dvx = 0; }
  } else { ai.diving = false; f.vx *= 0.94; f.vy = approach(f.vy, -300, 2200 * dt); if (f.onGround) { f.y -= 2; f.onGround = false; } }
}

// The spitter: keeps 380 to 620 away and spits; shoves you off if you get close.
export function spitterCtrl(f, world, dt) {
  const ai = f.ai, pl = world.player, P = f.def.ai;
  if (!ai.init) initAi(f, { cd: rand(0.9, 1.8), slapCd: 0 });
  ai.cd -= dt; ai.slapCd -= dt;
  if (f.rag) { ai.busy = false; return; }
  if (f.state === 'guard') f.setState('free');
  if (aimMove(f, pl)) return;
  if (f.state !== 'free' || !f.onGround || pl.dead) return;
  const dx = pl.x - f.x, dist = Math.abs(dx), want = dx >= 0 ? 1 : -1, down = mercy(pl);
  const near = P.moves.filter((m) => !ranged(m.id) && dist <= m.max), far = P.moves.filter((m) => ranged(m.id));
  if (near.length && ai.slapCd <= 0 && !down && world.requestAttack(f)) { f.facing = want; begin(f, weighted(near, ai.last).id); ai.slapCd = 2.2; ai.cd = Math.max(ai.cd, 1.2); return; }
  if (ai.cd <= 0 && dist > 180 && far.length && !down && world.requestAttack(f, true)) { f.facing = want; f.aimLocal = 0; begin(f, weighted(far, ai.last).id); return; }
  // Backs away facing you when you are close, turns tail and hops off when you are a little further.
  const cornered = f.x < world.minX + 90 || f.x > world.maxX - 90;
  let mx = 0;
  if (dist < 380 + ai.rangeAdd && !cornered) { mx = -want; f.facing = dist < 220 ? want : -want; }
  else if (dist > 620 + ai.rangeAdd) { mx = want; f.facing = want; }
  else f.facing = want;
  f.moveX = mx * P.walk;
}
// Aimed and projectile moves count as ranged when the brain asks for a turn to attack.
for (const id of ['bt_spit_shot', 'bt_spit_lob']) MOVES[id].ranged = true;

// The charger stuns itself if its charge meets a wall.
function chargerWall(f, world) {
  if (f.move?.src !== 'bt_charger_charge' || f.mt < f.move.run + 0.03) return;
  world.shake(0.7); world.sfx('wallSplat', f.x); world.fx.spark(f.x + f.facing * 50 * f.scale, -60, f.facing > 0 ? PI : 0, 1.2, 24, 600, '#ffd36b');
  world.fx.text(f.x, f.j[1] - 50, 'STUNNED', '#ffd36b', 20, 1);
  breakPosture(world, f);
}

// ───────────── generation ─────────────
const ADJ = ['Ashen', 'Gilded', 'Hollow', 'Null', 'Feral', 'Silent', 'Iron', 'Pale', 'Rust', 'Void', 'Ember', 'Glass', 'Storm', 'Bone', 'Dusk', 'Thorn', 'Static', 'Frost', 'Grave', 'Vesper', 'Cinder', 'Umbral', 'Brass', 'Salt',
  'Moth', 'Tallow', 'Soot', 'Lantern', 'Mire', 'Hex'];
const pick = (r, a) => a[(r() * a.length) | 0];
const R = (r, a, b) => a + (b - a) * r();
export function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, '0');
  return `#${f(0)}${f(8)}${f(4)}`;
}
// Any hue but the band around the player's cyan (150 to 215) and the reds of a telegraph (348 to 12).
const hue = (r) => { let h = 12 + r() * 271; if (h > 150) h += 65; return h; };

const TRAITS = { swift: 'moves fast', armored: 'does not flinch during wind-ups', volatile: 'bursts when it dies', vampiric: 'heals when it hurts you', regen: 'heals if you leave it alone' };

// Each plan rolls its body and says what it is called. Lengths are in the units of the 110-unit humanoid.
const BODIES = {
  hound(r) {
    const leg = R(r, 0.92, 1.14), spine = R(r, 44, 54);
    const fl = [21 * leg, 22 * leg], hl = [23 * leg, 24 * leg];
    const ears = pick(r, ['pointed', 'tall', 'folded', 'pointed']);
    const tailRest = R(r, -0.4, 0.55);
    const b = {
      spine, fl, hl, cx: 0.5, girth: R(r, 12.5, 15.5), neck: R(r, 15, 20), neck0: R(r, 0.45, 0.8), head: R(r, 18, 24), headR: R(r, 7, 9), head0: -R(r, 0.75, 1.0),
      roles: ['leg', 'leg', 'leg', 'leg'], limbA: 0, limbB: 1, bendF: 1, bendH: -1, gait: QUAD, rock: 0.1, turn: 0.16, pant: true, tailRun: -0.25,
      tail: { n: 6, len: R(r, 32, 48), w0: R(r, 3.5, 6), w1: R(r, 0.8, 3.2), rest: tailRest, curl: R(r, -0.05, 0.22), amp: 0.22, freq: 3.4, off: 2, blK: 1, blC: 0 },
      ears, earLen: R(r, 0.9, 1.6), ruff: r() < 0.4, hackles: r() < 0.35, snout: R(r, 0.9, 1.15), weapon: 'jaw', heavy: false,
      lw: R(r, 4.2, 5.4), backH: 6, fFoot: 2, hFoot: -3,
    };
    b.wLen = b.head * 0.62;
    b.torso = [-0.16, 0.45, 0.35, 0.48, 0.88, 0.7, 1.18, 0.05, 0.96, -R(r, 1.25, 1.6), 0.55, -R(r, 0.45, 0.7), 0.06, -0.62, -0.22, -0.05];
    return [b, b.tail.w1 > 2.4 ? ['Wolf', 'Hound', 'Lurcher'] : ['Hound', 'Jackal', 'Cur', 'Hunter']];
  },
  charger(r) {
    const kind = pick(r, ['bull', 'boar', 'rhino', 'ram', 'elk']);
    const spine = R(r, 58, 70), girth = R(r, 18, 23), hump = kind === 'bull' ? R(r, 0.5, 1.0) : kind === 'boar' ? R(r, 0.3, 0.7) : R(r, 0, 0.4);
    const fl = [R(r, 20, 24), R(r, 18, 22)], hl = [R(r, 22, 26), R(r, 20, 24)];
    const b = {
      kind, spine, fl, hl, cx: 0.5, girth, neck: R(r, 14, 19), neck0: R(r, 0.05, 0.35), head: R(r, 24, 30), headR: R(r, 10, 12.5), head0: -R(r, 0.55, 0.85),
      roles: ['leg', 'leg', 'leg', 'leg'], limbA: 0, limbB: 1, bendF: 1, bendH: -1, gait: QUAD, rock: 0.05, turn: 0.32, pant: false, tailRun: 0.3,
      tail: { n: 5, len: R(r, 20, 30), w0: 3, w1: 1.6, rest: -1.0, curl: -0.05, amp: 0.3, freq: 2.2, off: 3, blK: 1, blC: 0, tuft: kind !== 'boar' },
      hump, mane: kind === 'boar' || r() < 0.3, ears: kind === 'boar' ? 'pointed' : 'side', earLen: 0.7, heavy: true, roar: 'paw', rear: 1,
      lw: R(r, 8.5, 10.5), backH: girth * (0.55 + hump * 0.25), fFoot: 0, hFoot: -2,
    };
    if (kind === 'boar') { b.weapon = 'tusk'; b.wb = [0.88, -0.4]; b.wAng = R(r, 1.1, 1.5); b.wLen = R(r, 12, 18); }
    else if (kind === 'rhino') { b.weapon = 'horn'; b.wb = [0.8, 0.45]; b.wAng = R(r, 0.9, 1.3); b.wLen = R(r, 20, 30); b.horn2 = r() < 0.6; }
    else if (kind === 'ram') { b.weapon = 'horn'; b.wb = [0.15, 0.7]; b.wAng = 0.15; b.wLen = R(r, 14, 18); b.curl = R(r, 0.8, 1.2); }
    else if (kind === 'elk') { b.weapon = 'horn'; b.wb = [0.15, 0.85]; b.wAng = R(r, 0.6, 0.9); b.wLen = R(r, 18, 24); b.antlers = R(r, 0.8, 1.3); }
    else { b.weapon = 'horn'; b.wb = [0.1, 0.8]; b.wAng = R(r, 0.6, 1.0); b.wLen = R(r, 18, 28); }
    b.torso = [-0.12, 0.5, 0.3, 0.55 + hump * 0.2, 0.85, 0.75 + hump * 0.5, 1.12, 0.1, 0.95, -R(r, 0.9, 1.15), 0.45, -R(r, 0.8, 1.0), 0.05, -0.75, -0.2, -0.05];
    const names = { bull: ['Bull', 'Aurochs', 'Ox'], boar: ['Boar', 'Hog', 'Tusker'], rhino: ['Rhino', 'Rammer'], ram: ['Ram', 'Butter'], elk: ['Elk', 'Stag'] };
    return [b, names[kind]];
  },
  raptor(r) {
    const hl = [R(r, 28, 34), R(r, 30, 36)], spine = R(r, 34, 42);
    const b = {
      spine, fl: [R(r, 9, 12), R(r, 9, 12)], hl, cx: 0.22, girth: R(r, 11, 14), neck: R(r, 24, 32), neck0: R(r, 0.6, 0.9), head: R(r, 20, 26), headR: R(r, 6.5, 8.5), head0: -R(r, 0.6, 0.9),
      roles: ['arm', 'arm', 'leg', 'leg'], limbA: 2, limbB: 3, bendF: -1, bendH: -1, gait: BIPED, rock: 0, turn: 0.14, tailRun: 0.05, pitch: R(r, -0.08, 0.06), hipK: 0.86,
      tail: { n: 7, len: R(r, 55, 75), w0: 6, w1: 1, rest: R(r, -0.05, 0.2), curl: 0.015, amp: 0.1, freq: 2.6, off: 0, blK: 1, blC: 0 },
      crest: pick(r, ['none', 'feathers', 'fin', 'horns']), quills: r() < 0.45, armFeathers: r() < 0.5, weapon: 'jaw', heavy: false,
      lw: R(r, 5, 6.5), backH: 7, fFoot: 0, hFoot: 4,
    };
    b.wLen = b.head * 0.6;
    b.torso = [-0.25, 0.45, 0.4, 0.55, 1.05, 0.45, 1.18, -0.3, 0.8, -1.0, 0.2, -0.75, -0.2, -0.35];
    return [b, b.crest === 'feathers' ? ['Strider', 'Raptor', 'Runner'] : ['Raptor', 'Talon', 'Ripper']];
  },
  stalker(r) {
    const fl = [R(r, 32, 40), R(r, 38, 46)], hl = [R(r, 30, 36), R(r, 34, 42)], spine = R(r, 30, 38), xn = r() < 0.5 ? 2 : 4;
    const b = {
      spine, fl, hl, cx: 0.5, girth: R(r, 9, 12), neck: R(r, 5, 8), neck0: 0, head: R(r, 10, 14), headR: R(r, 6, 8), head0: -0.25, hipH: R(r, 17, 23),
      roles: ['leg', 'leg', 'leg', 'leg'], limbA: 0, limbB: 1, bendF: 1, bendH: -1, gait: CRAWL, rock: 0, turn: 0.12, tailRun: 0,
      tail: { n: 0 }, abdomen: R(r, 15, 24), abdK: R(r, 1.1, 1.6), spikes: r() < 0.5, mark: pick(r, ['none', 'stripe', 'hourglass', 'chevron']),
      weapon: 'jaw', heavy: false, lw: R(r, 3, 4), backH: 6, fFoot: 0.72, hFoot: -0.7, xn,
    };
    b.wLen = b.head * 0.75;
    b.torso = [-0.1, 0.3, 0.5, 0.7, 1.12, 0.35, 1.18, -0.3, 0.6, -0.7, -0.05, -0.4];
    return [b, b.abdomen > 20 ? ['Weaver', 'Stalker', 'Broodmother'] : ['Stalker', 'Creeper', 'Skitter']];
  },
  scorpion(r) {
    const spine = R(r, 38, 48), tl = R(r, 56, 76);
    const b = {
      spine, fl: [R(r, 20, 26), R(r, 18, 24)], hl: [R(r, 16, 20), R(r, 18, 22)], cx: 0.5, girth: R(r, 10, 13), neck: R(r, 5, 7), neck0: 0, head: R(r, 10, 13), headR: R(r, 7, 9), head0: -0.1, hipH: R(r, 16, 21),
      roles: ['pincer', 'pincer', 'leg', 'leg'], limbA: 0, limbB: 1, bendF: -1, bendH: -1, gait: CRAWL, rock: 0, turn: 0.22, tailRun: 0,
      tail: { n: 6, len: tl, w0: R(r, 7, 9), w1: R(r, 3.5, 5), rest: 1.3, curl: 0.33, amp: 0.05, freq: 1.8, off: 1, blK: 0.55, blC: 0.24 },
      claw: R(r, 13, 18), plates: r() < 0.6, weapon: 'sting', wLen: R(r, 14, 20), wAng: R(r, 0.5, 0.8), heavy: false, lw: R(r, 4, 5), backH: 6, fFoot: 0.4, hFoot: -0.45, xn: 6,
    };
    b.torso = [-0.12, 0.5, 0.5, 0.65, 1.1, 0.45, 1.16, -0.35, 0.5, -0.6, -0.1, -0.45];
    return [b, ['Scorpion', 'Stinger', 'Deathstalker']];
  },
  flyer(r) {
    const kind = pick(r, ['bat', 'hawk', 'moth']);
    const b = {
      kind, spine: R(r, 18, 25), fl: [R(r, 22, 28), R(r, 26, 34)], hl: [R(r, 9, 12), R(r, 9, 12)], cx: 0.5, girth: R(r, 8, 11), neck: R(r, 6, 10), neck0: 0.4,
      head: R(r, 10, 13), headR: R(r, 6, 7.5), head0: -0.35, roles: ['wing', 'wing', 'talon', 'talon'], limbA: 2, limbB: 3, bendF: 1, bendH: -1, gait: QUAD, rock: 0, turn: 0.12, tailRun: 0,
      pitch: 0.12, wing: kind, flapHz: kind === 'bat' ? 3.3 : kind === 'hawk' ? 2.3 : 4.2,
      tail: kind === 'hawk' ? { n: 2, len: R(r, 14, 20), w0: 4, w1: 9, rest: 0.1, curl: 0, amp: 0.1, freq: 2, off: 1, blK: 1, blC: 0 }
        : kind === 'moth' ? { n: 3, len: R(r, 14, 20), w0: 7, w1: 2, rest: -0.4, curl: -0.1, amp: 0.08, freq: 2, off: 1, blK: 1, blC: 0 } : { n: 0 },
      ears: kind === 'bat' ? 'tall' : 'none', earLen: R(r, 1.0, 1.6), crest: kind === 'hawk' && r() < 0.5, antennae: kind === 'moth',
      weapon: kind === 'hawk' ? 'beak' : 'jaw', heavy: false, lw: R(r, 3, 4), backH: 4, fFoot: 0, hFoot: 0,
    };
    b.wLen = b.head * 0.55;
    const span = R(r, 0.85, 1.2);
    b.wingFan = kind === 'bat' ? [0.05, 0.8, 1.55] : kind === 'hawk' ? [0.0, 0.45, 0.95] : [0.1, 0.95, 1.8];
    b.wingLen = kind === 'bat' ? [24 * span, 25 * span, 21 * span] : kind === 'hawk' ? [30 * span, 28 * span, 24 * span] : [26 * span, 30 * span, 24 * span];
    b.torso = [-0.3, 0.5, 0.5, 0.75, 1.15, 0.2, 0.9, -0.7, 0.1, -0.75, -0.3, -0.2];
    const names = { bat: ['Bat', 'Nightwing', 'Flitter'], hawk: ['Hawk', 'Kite', 'Harrier'], moth: ['Moth', 'Dustwing', 'Lampmoth'] };
    return [b, names[kind]];
  },
  ape(r) {
    const fl = [R(r, 32, 38), R(r, 30, 36)], hl = [R(r, 20, 24), R(r, 18, 22)], spine = R(r, 38, 46);
    const b = {
      spine, fl, hl, cx: 0.5, girth: R(r, 16, 20), neck: R(r, 8, 11), neck0: -R(r, 0.45, 0.75), head: R(r, 13, 16), headR: R(r, 9, 11), head0: -R(r, 0.0, 0.2),
      roles: ['leg', 'leg', 'leg', 'leg'], limbA: 0, limbB: 1, bendF: -1, bendH: 1, gait: BOUND, rock: 0.08, turn: 0.28, tailRun: 0,
      tail: { n: 0 }, mane: r() < 0.6, crest: r() < 0.4, fangs: r() < 0.5, brow: R(r, 0.2, 0.45), weapon: 'claw', wLen: R(r, 15, 21), wAng: 1.25, heavy: true, roar: 'beat', rear: 1.6,
      lw: R(r, 7, 9), backH: 9, fFoot: 6, hFoot: 2,
    };
    b.torso = [-0.15, 0.35, 0.45, 0.6, 0.95, 0.95, 1.18, 0.35, 1.05, -0.85, 0.5, -0.75, 0.0, -0.55, -0.22, -0.05];
    return [b, b.mane ? ['Silverback', 'Ape', 'Mauler'] : ['Ape', 'Mauler', 'Knuckler']];
  },
  spitter(r) {
    const kind = pick(r, ['toad', 'lizard', 'frill']);
    const b = {
      kind, spine: R(r, 34, 42), fl: [R(r, 13, 16), R(r, 13, 16)], hl: [R(r, 15, 18), R(r, 14, 17)], cx: 0.5, girth: R(r, 13, 17), neck: R(r, 8, 11), neck0: 0.3,
      head: R(r, 18, 23), headR: R(r, 8.5, 11.5), head0: -0.4, hipH: R(r, 19, 23), roles: ['leg', 'leg', 'leg', 'leg'], limbA: 0, limbB: 1, bendF: -1, bendH: 1, gait: QUAD, rock: 0.03, turn: 0.2, tailRun: 0,
      tail: kind === 'toad' ? { n: 0 } : { n: 6, len: R(r, 34, 50), w0: 6, w1: 1, rest: -0.15, curl: -0.03, amp: 0.25, freq: 2.2, off: 1, blK: 1, blC: 0 },
      frill: kind === 'frill' ? R(r, 14, 20) : 0, sac: kind === 'toad' ? R(r, 7, 10) : R(r, 4, 6), spines: r() < 0.5, warts: kind === 'toad',
      weapon: 'spit', wLen: 16, heavy: false, lw: R(r, 5.5, 7), backH: 8, fFoot: 0.35, hFoot: -0.3,
    };
    b.torso = kind === 'toad' ? [-0.2, 0.55, 0.45, 0.95, 1.05, 0.55, 1.12, -0.4, 0.5, -0.95, -0.15, -0.55] : [-0.15, 0.45, 0.45, 0.6, 1.05, 0.45, 1.1, -0.3, 0.5, -0.75, -0.1, -0.45];
    const names = { toad: ['Toad', 'Spitter', 'Bloater'], lizard: ['Spitter', 'Gecko', 'Basilisk'], frill: ['Frillback', 'Basilisk', 'Spitter'] };
    return [b, names[kind]];
  },
};

// Size, numbers and the line for the player, per plan. [scale range, hp, posture, speed, armor, tier, cost range, cap]
const STATS = {
  hound: { scale: [0.95, 1.15], hp: 34, posture: 34, speed: 360, walk: 0.38, armor: 0, tier: 1, cost: [0.8, 1.1], cap: 4, getup: 0.45, range: [130, 230], pace: true, turnAway: true, pack: true, turnLag: 0.1, cd: [0.6, 1.4],
    hint: 'a pack hunter that dies fast. Parry its lunge and cut it down before the rest close in' },
  charger: { scale: [1.15, 1.45], hp: 320, posture: 120, speed: 170, walk: 0.55, armor: 2, tier: 3, cost: [3.6, 4.4], cap: 1, getup: 0.9, range: [220, 400], pace: true, turnLag: 0.45, cd: [0.6, 1.3], roar: true, parryRecoil: 0.85, breakDur: 3.0,
    hint: 'a charger that never flinches. Jump or dash its red rush, bait it into a wall to stun it, then punish' },
  raptor: { scale: [0.95, 1.2], hp: 95, posture: 70, speed: 380, walk: 0.4, armor: 0, tier: 2, cost: [2.2, 2.8], cap: 2, getup: 0.5, range: [150, 260], pace: true, turnAway: true, turnLag: 0.08, cd: [0.6, 1.3],
    hint: 'a fast runner that leaps on you from above. Parry the rake, and when it jumps, dash out from under it' },
  stalker: { scale: [0.95, 1.15], hp: 80, posture: 55, speed: 300, walk: 0.35, armor: 0, tier: 2, cost: [2.0, 2.6], cap: 2, getup: 0.45, range: [170, 300], pace: true, skitter: true, turnLag: 0.06, cd: [0.8, 1.6],
    hint: 'a creeper that darts past you to strike at your back. Turn with it and parry the lunge' },
  scorpion: { scale: [0.95, 1.2], hp: 130, posture: 85, speed: 180, walk: 0.5, armor: 1, tier: 2, cost: [2.4, 3.0], cap: 2, getup: 0.6, range: [100, 180], pace: false, turnLag: 0.3, cd: [0.7, 1.4],
    hint: 'a scorpion. Its sting comes down over its back: parry the white sting, dash the red one, and hit it while the tail is down' },
  flyer: { scale: [0.8, 1.05], hp: 26, posture: 30, speed: 300, walk: 1, armor: 0, tier: 1, cost: [1.2, 1.6], cap: 3, getup: 0.5, cd: [1.6, 2.8],
    hint: 'a flyer that swoops from above. Any hit knocks it out of the air: jump to meet it, or parry the swoop' },
  ape: { scale: [1.2, 1.42], hp: 360, posture: 130, speed: 210, walk: 0.5, armor: 1, tier: 3, cost: [3.5, 4.3], cap: 1, getup: 0.8, range: [140, 240], pace: true, turnLag: 0.3, cd: [0.6, 1.2], roar: true, parryRecoil: 0.85, breakDur: 2.8,
    hint: 'a great ape. Its slam shakes the floor: jump the shockwave and punish the long recovery, or parry the hook' },
  spitter: { scale: [0.9, 1.1], hp: 52, posture: 40, speed: 190, walk: 0.85, armor: 0, tier: 1, cost: [1.5, 1.9], cap: 2, getup: 0.5, cd: [1.3, 2.4],
    hint: 'a spitter that keeps its distance. Parry or cut the spit back at it, then close in: up close it can only shove' },
};

// One animal species: `id` becomes its kind, `plan` one of BEAST_PLANS, `tier` (1-9) how deep in the
// run it lives, `names` the names already taken (ours is added).
export function makeBeast(r, id, plan, tier, names) {
  const S = STATS[plan], [B, nouns] = BODIES[plan](r);
  const z = R(r, S.scale[0], S.scale[1]);
  // Derived geometry: standing heights and the spine pitch that lets every foot reach the floor.
  const legH = (B.hl[0] + B.hl[1]) * (B.hipK ?? 0.9), armH = (B.fl[0] + B.fl[1]) * 0.9;
  B.hipH ??= legH;
  if (B.pitch !== undefined) B.pitch0 = B.pitch;
  else if (B.roles[0] === 'leg' && B.hipH === legH) B.pitch0 = Math.asin(clamp((armH - B.hipH) / B.spine, -0.5, 0.9));
  else B.pitch0 = 0;
  // Where the feet stand, as local x: under the shoulder and hip, or splayed out by a share of the leg.
  const shX = B.spine * (1 - B.cx) * Math.cos(B.pitch0), hipX = -B.spine * B.cx * Math.cos(B.pitch0);
  const lenF = B.fl[0] + B.fl[1], lenH = B.hl[0] + B.hl[1];
  const splay = B.gait === CRAWL || plan === 'spitter';
  const fF = splay ? B.fFoot * lenF : B.fFoot, hF = splay ? B.hFoot * lenH : B.hFoot;
  B.footX = [shX + fF, shX + fF + 3, hipX + hF, hipX + hF - 3];
  B.xn ??= 0;
  if (B.xn) {
    // Extra legs between the joint legs, alternating sides and phases.
    const per = B.xn >> 1, xr = [], xf = [], xo = [], xo2 = [], xs = [];
    for (let i = 0; i < B.xn; i++) {
      const k = i % per, q = per === 1 ? 0.5 : 0.25 + (k / (per - 1)) * 0.5;
      xr.push(q); xs.push(i < per ? 0 : 1);
      xf.push(hipX + (shX - hipX) * q + (q - 0.5) * lenH * 0.9 + (i < per ? 0 : 3));
      xo.push(((k + (i < per ? 0 : 1)) % 2) * 0.5 + k * 0.17); xo2.push(xo[i]);
    }
    Object.assign(B, { xr, xf, xo, xo2, xs, xl: [B.hl[0] * 1.05, B.hl[1] * 1.05] });
  }
  B.plan = plan; B.cx ??= 0.5;

  let name, n = 0;
  do name = `${pick(r, ADJ)} ${pick(r, nouns)}`; while (names.has(name) && ++n < 200);
  if (names.has(name)) name = `${name} ${names.size}`;
  names.add(name);

  // Colour: a rim hue clear of the player's cyan and the telegraph reds, never white.
  const h = hue(r), color = hsl(h, R(r, 82, 96), R(r, 58, 66)), outline = hsl(h, 78, R(r, 74, 80));

  // Numbers follow size: bigger is tougher and slower.
  const bulk = (z / ((S.scale[0] + S.scale[1]) / 2)) ** 1.5, depth = (tier - 1) / 8;
  const hp = Math.round(S.hp * bulk * R(r, 0.95, 1.2) * (1 + depth * 0.25));
  const posture = Math.round(S.posture * bulk * R(r, 0.9, 1.15));
  const runSpeed = Math.round(S.speed * R(r, 0.92, 1.12) / Math.sqrt(bulk));

  // Moves: the plan's kit up to this tier.
  const moves = KIT[plan].filter((k) => k[4] <= tier).map(([mid, a, b, w]) => ({ id: mid, min: Math.round(a * z), max: Math.round(b * z), w }));
  // Traits: none early, one in the middle of the run, up to two deep in it.
  const can = ['swift', 'volatile', 'vampiric', 'regen'];
  if (!S.armor && plan !== 'flyer') can.push('armored');
  const nT = tier <= 2 ? 0 : tier <= 5 ? (r() < 0.6 ? 1 : 0) : tier <= 7 ? 1 : (r() < 0.5 ? 2 : 1);
  const traits = [];
  for (let i = 0; i < nT; i++) { let t; do t = pick(r, can); while (traits.includes(t)); traits.push(t); }

  const info = BEAST_INFO[plan];
  const def = {
    kind: id, base: plan, beast: plan, name, scale: +z.toFixed(3), hp, posture, postureRegen: 14 * (S.armor ? 1 : 1.2), accel: plan === 'charger' || plan === 'ape' ? 1800 : 2600, dashSpeed: 900,
    lineW: +(B.lw * (B.heavy ? 1 : 0.95)).toFixed(2), tier: S.tier, armor: S.armor, getup: S.getup, color, outline, runSpeed,
    blade: { len: Math.round(B.wLen), natural: B.weapon, gun: B.weapon === 'spit' || undefined, thin: B.weapon === 'jaw' || B.weapon === 'beak' || undefined, wide: B.weapon === 'claw' || undefined },
    ctrl: plan === 'flyer' ? flyerCtrl : plan === 'spitter' ? spitterCtrl : beastCtrl,
    ai: { range: S.range || [0, 0], cd: S.cd, walk: S.walk, pace: !!S.pace, turnAway: !!S.turnAway, pack: !!S.pack, skitter: !!S.skitter, roar: !!S.roar, turnLag: S.turnLag, moves },
    chainBreak: 0, traits: Object.fromEntries(traits.map((t) => [t, 1])), flying: info.flying, rideable: info.rideable, ranged: info.ranged || undefined,
    body: B, stance: { ...REST, f1x: 0.5, f1y: -0.4, f2x: 0.4, f2y: -0.5 }, depth: tier,
    // What the generic bone drawing uses for a limp body.
    prop: { torso: 1, arm: 1, leg: 1, head: (B.headR / 8) * (plan === 'charger' || plan === 'ape' ? 1.1 : 1) }, belly: B.heavy ? Math.round(B.girth * 0.55) : 0,
    deco: plan === 'charger' && (B.kind === 'bull' || B.kind === 'ram') ? 'horns' : plan === 'charger' && B.kind === 'elk' ? 'antlers' : undefined,
    parryPosture: 50, parryRecoil: S.parryRecoil ?? 0.9, breakDur: S.breakDur ?? 2.5, dmg: +R(r, 0.95, 1.1).toFixed(2),
    hitWall: plan === 'charger' ? chargerWall : undefined,
  };
  const parts = traits.map((t) => TRAITS[t]);
  const cost = R(r, S.cost[0], S.cost[1]) * (1 + 0.18 * traits.length) + (moves.length > 2 ? 0.3 : 0);
  def.gen = {
    cost: +Math.min(6.5, cost).toFixed(2), cap: S.cap, ranged: !!info.ranged || !!info.flying, flank: false,
    hint: `${name.toUpperCase()}  ·  ${S.hint}${parts.length ? `. It ${parts.join(' and ')}` : ''}`,
  };
  return def;
}
