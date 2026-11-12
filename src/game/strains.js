// Enemies generated for one run. The eight hand-made chassis in enemies.js supply the brains; this
// file grows new fighters on top of them from the run's seed:
//   strains    two per sector from sector II on: a chassis with its own body, colour, traits and a
//              move list that mixes its own attacks, attacks borrowed from other chassis, faster or
//              slower copies, and two moves joined into a new string
//   champions  one per sector (floor x5): a strain grown to boss size that calls for help once
//   wardens    the sector bosses: a fighting school, borrowed moves, set pieces and phases
// Pure functions of the seed. Nothing here touches the simulation's random stream.
import { makeRng, hash32, clamp, lerp } from '../core/math.js';
import { ENEMIES, championCtrl, wardenCtrl } from './enemies.js';
import { MOVES, tempoMove, chainMove, stripEvents } from './moves.js';

const MELEE = ['initiate', 'bulwark', 'duelist', 'brute', 'lancer'];
const CHASSIS = ['initiate', 'bulwark', 'duelist', 'marksman', 'brute', 'lancer', 'wraith', 'drone'];
export const BASE_COST = { initiate: 1, drone: 1.3, marksman: 1.6, bulwark: 2.6, lancer: 2.6, wraith: 2.8, duelist: 3.6, brute: 5 };
export const BASE_CAP = { brute: 1, duelist: 2, wraith: 2, bulwark: 2, lancer: 2, marksman: 2, drone: 3 };

const ADJ = ['Ashen', 'Gilded', 'Hollow', 'Null', 'Feral', 'Silent', 'Iron', 'Pale', 'Rust', 'Void', 'Ember', 'Glass', 'Storm', 'Bone', 'Dusk', 'Thorn', 'Static', 'Frost', 'Grave', 'Vesper', 'Cinder', 'Umbral', 'Brass', 'Salt'];
const NOUN = {
  initiate: ['Acolyte', 'Zealot', 'Cutter', 'Neophyte'], bulwark: ['Aegis', 'Rampart', 'Bastion', 'Palisade'], duelist: ['Fencer', 'Dervish', 'Blademaster', 'Duelist'],
  marksman: ['Sniper', 'Deadeye', 'Lookout', 'Marksman'], brute: ['Colossus', 'Juggernaut', 'Ogre', 'Brute'], lancer: ['Pikeman', 'Halberdier', 'Impaler', 'Lancer'],
  wraith: ['Shade', 'Revenant', 'Phantom', 'Wraith'], drone: ['Wisp', 'Hornet', 'Seeker', 'Drone'],
};
const SYL1 = ['Vor', 'Kae', 'Thal', 'Mor', 'Zeph', 'Ix', 'Dra', 'Sel', 'Ny', 'Gar', 'Ul', 'Rhe', 'Ash', 'Bel', 'Cor', 'Hex', 'Oth', 'Quil'];
const SYL2 = ['rak', 'lis', 'dor', 'ven', 'thos', 'mir', 'gul', 'zar', 'ka', 'neth', 'ric', 'os', 'ara', 'un'];
const EPITHET = ['Unbroken', 'Patient', 'Thrice-Sworn', 'Hollow', 'Last', 'Tireless', 'Unseen', 'Ninth', 'Merciless', 'Quiet', 'Flayed', 'Bright'];
const BOSS_NOUN = ['ARCHIVIST', 'CASTELLAN', 'HOLLOW KING', 'CARTOGRAPHER', 'LAMPLIGHTER', 'MAGISTRATE', 'UNDERTAKER', 'CHOIRMASTER', 'SENTINEL', 'GARDENER', 'ASTRONOMER', 'QUARTERMASTER',
  'CONFESSOR', 'HERALD', 'ORACLE', 'TALLYMAN', 'HIEROPHANT', 'PILGRIM', 'TOLLKEEPER', 'VIGIL'];
const BOSS_ROLE = ['Keeper', 'Regent', 'Voice', 'Hand', 'Eye', 'Last Guard', 'Judge'];
const MOVE_NAME = { i_slash: 'slash', i_combo: 'two-cut string', i_leap: 'leaping cut', i_feint: 'feint', i_lunge: 'lunge', b_bash: 'shield bash', b_over: 'overhead', b_charge: 'ram',
  d_flurry: 'flurry', d_spin: 'spinning cut', d_dive: 'dive', d_throw: 'thrown blade', br_swing: 'wide swing', br_smash: 'ground smash', br_charge: 'charge', br_sweep: 'low sweep', br_leap: 'leap slam',
  ln_thrust: 'thrust', ln_double: 'double thrust', ln_shove: 'shove', w_slash: 'rising cut', w_cross: 'cross cut' };
const TRAIT_TEXT = { swift: 'moves fast', armored: 'does not flinch during wind-ups', volatile: 'bursts when it dies', vampiric: 'heals when it hits you', splitter: 'splits in two when it dies',
  regen: 'heals if you leave it alone', shielded: 'carries a shield, so use heavies or get behind it', reader: 'reads repeated attacks' };
const HEADS = ['hood', 'visor', 'horns', 'crest', 'cone', 'wraith', 'bulwark', 'mohawk', 'antlers', 'crown', 'plume', 'mask', 'fin'];
// Body shapes: [torso, arm, leg, head]
const SHAPES = [[1, 1, 1, 1], [0.88, 1.22, 1.2, 0.9], [1.18, 1.0, 0.86, 1.1], [0.95, 1.36, 0.92, 1], [1.2, 1.1, 1.14, 0.88], [0.9, 0.9, 1.0, 1.25], [1.08, 1.25, 1.05, 0.95]];

const pick = (r, a) => a[(r() * a.length) | 0];
const shuffle = (r, a) => { const o = [...a]; for (let i = o.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [o[i], o[j]] = [o[j], o[i]]; } return o; };
const reach = (d) => (d.blade.len + 40) * d.scale;
export function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, '0');
  return `#${f(0)}${f(8)}${f(4)}`;
}
// Enemy hues keep clear of the player's cyan so the player always reads as the odd one out.
const hue = (r) => { let h = r() * 295; if (h > 150) h += 65; return h; };

// Every hand-made melee attack that can be borrowed, with the range it was tuned for.
const GRAFTS = [];
for (const k of MELEE) for (const m of ENEMIES[k].ai.moves) GRAFTS.push({ id: m.id, min: m.min, max: m.max, w: m.w, from: k });
GRAFTS.push({ id: 'w_slash', max: 150, w: 2, from: 'wraith' }, { id: 'w_cross', max: 150, w: 2, from: 'wraith' });

function look(r, def, B, size) {
  const h = hue(r);
  def.color = hsl(h, 88 + r() * 12, 60 + r() * 6); def.outline = hsl(h, 80, 80);
  def.scale = +(B.scale * size).toFixed(3);
  def.lineW = +(B.lineW * lerp(0.85, 1.2, r())).toFixed(2);
  const sh = pick(r, SHAPES);
  def.prop = { torso: sh[0], arm: sh[1], leg: sh[2], head: sh[3] };
  if (B.deco !== 'drone') { do def.deco = pick(r, HEADS); while (def.deco === B.deco); } else def.shape = 1 + ((r() * 3) | 0);
  def.belly = B.deco === 'bulwark' || B.deco === 'horns' ? (B.deco === 'bulwark' ? 10 : 13) : r() < 0.2 ? 9 : 0;
  // A scarf from the head, a dark cloak, or nothing.
  const cloth = r();
  def.ribbonJoint = undefined;
  if (B.deco === 'drone') def.ribbons = [];
  else if (cloth < 0.28) { def.ribbons = [{ n: 8, seg: 6, color: def.color, width: 3 }]; def.ribbonJoint = 'head'; }
  else if (cloth < 0.5) def.ribbons = [{ n: 9, seg: 7, color: '#150f22', width: 8, oy: 2, grav: 600 }];
  else def.ribbons = [];
  return h;
}

// One strain: `id` is its kind, `chassis` the hand-made type it grows from, `tier` (1-9) how far it has drifted.
function makeStrain(r, id, chassis, tier, names) {
  const B = ENEMIES[chassis], melee = MELEE.includes(chassis);
  const def = { ...B, kind: id, base: chassis, strain: true };
  const size = chassis === 'brute' ? lerp(0.86, 1.1, r()) : chassis === 'drone' ? lerp(0.9, 1.5, r()) : lerp(0.88, 1.2, r());
  look(r, def, B, size);
  let name;
  do name = `${pick(r, ADJ)} ${pick(r, NOUN[chassis])}`; while (names.has(name));
  names.add(name); def.name = name;

  const bulk = size ** 1.5;
  def.hp = Math.round(B.hp * bulk * lerp(1.0, 1.35, r()));
  def.posture = Math.round(B.posture * bulk * lerp(0.9, 1.2, r()));
  def.runSpeed = Math.round(B.runSpeed * lerp(0.92, 1.25, r()) / Math.sqrt(size));
  def.dmg = +lerp(0.92, 1.12, r()).toFixed(2);
  const bl = { ...B.blade, len: Math.round(B.blade.len * lerp(0.86, 1.28, r())) };
  if (!bl.gun && !bl.hammer && !bl.double && !bl.wide && !bl.thin) {
    const style = r();
    if (style < 0.2 && def.scale >= 1.05) bl.wide = true;
    else if (style < 0.4) { bl.thin = true; bl.len = Math.round(bl.len * 1.15); }
    else if (style < 0.52) { bl.double = true; bl.len = Math.round(bl.len * 0.72); }
  }
  def.blade = bl;

  // Traits.
  const can = ['swift', 'volatile', 'vampiric', 'regen'];
  if (chassis !== 'marksman' && chassis !== 'drone') can.push('armored');
  if (def.hp >= 90 && !B.flying) can.push('splitter');
  if (melee && chassis !== 'bulwark') can.push('shielded');
  if (melee && !B.adaptAt) can.push('reader');
  const traits = shuffle(r, can).slice(0, tier <= 3 ? 1 : 2);
  def.traits = Object.fromEntries(traits.map((t) => [t, 1]));
  if (def.traits.shielded) { def.shield = true; def.shieldColor = def.outline; def.blockMul = 0.6; def.heavyBlockMul = 2.2; def.armor = Math.max(def.armor, 1); }
  if (def.traits.reader) { def.adaptAt = 4; def.counter = 'd_counter'; }

  // Moves.
  const borrowed = [];
  let extra = 0;
  if (melee) {
    const k = reach(def) / reach(B);
    const sc = (m, q) => ({ id: m.id, min: m.min === undefined ? undefined : Math.round(m.min * q), max: Math.round(m.max * q), w: m.w });
    const moves = B.ai.moves.map((m) => sc(m, k));
    for (const m of moves) if (r() < 0.35) m.id = tempoMove(m.id, pick(r, [0.82, 0.9, 1.18]));
    const pool = shuffle(r, GRAFTS.filter((g) => g.from !== chassis && !(g.id === 'd_throw' && bl.gun)));
    const n = 1 + (tier >= 5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const g = pool[i], q = reach(def) / reach(ENEMIES[g.from]);
      const m = sc(g, clamp(q, 0.7, 1.5));
      m.w = 2;
      if (r() < 0.3) m.id = tempoMove(m.id, pick(r, [0.9, 1.18]));
      moves.push(m); borrowed.push(g);
    }
    if (r() < 0.55) {
      const simple = shuffle(r, moves);
      for (let i = 0; i + 1 < simple.length; i++) {
        const c = chainMove(MOVES[simple[i].id].src, MOVES[simple[i + 1].id].src);
        if (c) { moves.push({ id: c, min: simple[i].min, max: simple[i].max, w: 2 }); extra++; break; }
      }
    }
    def.ai = { ...B.ai, moves, range: [Math.round(B.ai.range[0] * k), Math.round(B.ai.range[1] * k)], cd: B.ai.cd.map((v) => +(v * lerp(0.8, 1.15, r())).toFixed(2)) };
    if (!def.shield && !B.ai.guard && r() < 0.4) def.ai.guard = +lerp(0.15, 0.4, r()).toFixed(2);
    if (def.traits.reader) def.ai.counterAfter = 2;
    if (moves.some((m) => MOVES[m.id].src === 'br_charge')) def.hitWall = ENEMIES.brute.hitWall;
  } else if (chassis === 'wraith') {
    const strikes = ['w_slash', 'w_cross', tempoMove('w_cross', 0.9)];
    if (r() < 0.6) strikes.push(pick(r, ['d_counter', 'p_counter', 'ln_thrust']));
    const c = r() < 0.5 ? chainMove('w_slash', pick(r, ['w_cross', 'i_slash', 'd_counter'])) : null;
    if (c) { strikes.push(c); extra++; }
    def.ai = { strikes };
  } else if (chassis === 'marksman') {
    const shots = [{ id: 'm_shot', w: 3 }, { id: 'm_lob', w: 2 }, { id: 'm_burst', w: 2 }];
    if (r() < 0.6) shots[0].id = tempoMove('m_shot', 0.82);
    if (r() < 0.4) shots[2].w = 4;
    def.ai = { shots };
  } else def.ai = { dive: +lerp(0.25, 0.85, r()).toFixed(2) };

  // What the generator needs to know to place it, and what the player is told when it first appears.
  const parts = traits.map((t) => TRAIT_TEXT[t]);
  if (borrowed.length) parts.push(`has learned the ${ENEMIES[borrowed[0].from].name}'s ${MOVE_NAME[borrowed[0].id]}`);
  def.gen = {
    cost: +(BASE_COST[chassis] * (1 + 0.18 * traits.length) + 0.3 * borrowed.length + 0.3 * extra).toFixed(2),
    cap: BASE_CAP[chassis] ?? 9, ranged: chassis === 'marksman' || chassis === 'drone', flank: !!B.ai?.flank,
    hint: `${name.toUpperCase()}  ·  ${/^[AEIOU]/.test(B.name) ? 'an' : 'a'} ${B.name} strain. It ${parts.join('. It ')}`,
  };
  return def;
}

function makeChampion(r, id, sector, place, names) {
  const chassis = pick(r, ['duelist', 'brute', 'lancer', 'initiate', 'bulwark', 'duelist']);
  const def = makeStrain(r, id, chassis, Math.min(9, sector + 3), names);
  delete def.traits.splitter;
  let first;
  do first = `${pick(r, SYL1)}${pick(r, SYL2)}`; while (names.has(first));
  names.add(first);
  def.name = `${first} THE ${pick(r, EPITHET)}`.toUpperCase();
  def.title = `Champion of ${place}`;
  Object.assign(def, { boss: true, champion: true, strain: false, noRagdoll: true, armor: 2, tier: Math.max(2, def.tier), chainBreak: 0, marks: [0.5], ctrl: championCtrl,
    scale: +clamp(def.scale * 1.24, 1.22, 1.7).toFixed(3), hp: 520 + sector * 30, posture: 170, postureTaken: 0.55, breakDur: 2.6, parryPosture: 40, parryRecoil: 0.75, getup: 0.9 });
  def.lineW = +Math.max(def.lineW, 5).toFixed(2);
  if (!def.ribbons.length) def.ribbons = [{ n: 10, seg: 8, color: '#1a1420', width: 9, oy: 2, grav: 700 }];
  def.ribbonJoint = undefined;
  def.ai = { ...def.ai, cd: [0.45, 1.0] };
  return def;
}

// Fighting schools for the sector bosses. Moves are [id, min, max, weight, phase, dash-in].
const SCHOOLS = {
  executioner: { like: 'brute', blade: { len: 84, wide: true }, scale: [1.4, 1.55], heads: ['horns', 'antlers', 'crown'], lineW: 7.6, speed: 165, tier: 3, belly: 13,
    moves: [['br_swing', 0, 210, 3], ['br_smash', 0, 190, 2], ['br_sweep', 0, 220, 2], ['br_leap', 240, 640, 3], ['br_charge', 380, 1200, 2]], specials: ['summon', 'skyfall'] },
  blademaster: { like: 'proctor', blade: { len: 78 }, scale: [1.2, 1.32], heads: ['crest', 'halo', 'plume', 'mask'], lineW: 5.2, speed: 260, tier: 2, guard: 0.32, reads: true,
    moves: [['p_verdict', 0, 200, 4, 1, 1], ['d_flurry', 110, 360, 3], ['d_spin', 0, 160, 2], ['p_lunge', 220, 900, 3], ['p_crescent', 240, 900, 2], ['d_dive', 200, 420, 2]], specials: ['blink'], echo: true },
  pikelord: { like: 'lancer', blade: { len: 116, thin: true }, scale: [1.25, 1.4], heads: ['cone', 'fin', 'crown'], lineW: 5, speed: 230, tier: 2, hold: [200, 300],
    moves: [['ln_thrust', 135, 310, 3], ['ln_double', 135, 300, 3], ['ln_shove', 0, 130, 4], ['p_lunge', 320, 900, 2], ['br_sweep', 0, 240, 2], ['fm_erupt~', 280, 900, 2]], specials: ['skyfall', 'summon'] },
  phantom: { like: 'wraith', blade: { len: 62 }, scale: [1.15, 1.28], heads: ['wraith', 'mask', 'halo'], lineW: 4.8, speed: 240, tier: 2, cloak: true,
    moves: [['w_cross', 0, 170, 3], ['w_slash', 0, 160, 2], ['p_cyclone', 0, 230, 2], ['p_crescent', 240, 900, 3], ['d_dive', 200, 430, 2]], specials: ['blink', 'blink'], echo: true, heal: true },
  warlock: { like: 'proctor', blade: { len: 56 }, scale: [1.2, 1.3], heads: ['halo', 'crown', 'antlers'], lineW: 5, speed: 215, tier: 2, hold: [330, 520],
    moves: [['fm_ember~', 220, 900, 3], ['fm_erupt~', 200, 900, 3], ['p_crescent', 200, 900, 3], ['ln_shove', 0, 140, 5], ['d_spin', 0, 170, 2]], specials: ['summon', 'skyfall'], heal: true },
};
const PHASE_TEXT = [['It stops holding back', 'The room turns against you', 'It is done being patient', 'Its blade remembers you'], ['Nothing left to lose', 'It will not fall alone', 'The last of its strength']];

function makeWarden(r, id, sector, place, names) {
  stripEvents('fm_erupt', ['heat', 'vent']); stripEvents('fm_ember', ['heat', 'vent']);
  const key = pick(r, Object.keys(SCHOOLS)), S = SCHOOLS[key], B = ENEMIES[S.like];
  const h = hue(r), h2 = h + 40 + r() * 60;
  let noun;
  do noun = pick(r, BOSS_NOUN); while (names.has(noun));
  names.add(noun);
  const def = { ...ENEMIES.proctor, kind: id, base: key, name: `THE ${noun}`, title: `${pick(r, BOSS_ROLE)} of ${place}`, boss: true, warden: true, noRagdoll: true, ctrl: wardenCtrl,
    scale: +lerp(S.scale[0], S.scale[1], r()).toFixed(3), hp: 720 + sector * 50, posture: 200, postureTaken: 0.45, armor: 2, tier: S.tier,
    color: hsl(h, 92, 64), color2: hsl(h2, 95, 68), color3: hsl(h2 + 30, 100, 80), outline: hsl(h, 80, 84), lineW: S.lineW, runSpeed: S.speed,
    blade: { ...S.blade, len: Math.round(S.blade.len * lerp(0.94, 1.12, r())) }, deco: pick(r, S.heads), belly: S.belly || 0, stance: B.stance, guard: undefined,
    adaptAt: S.reads ? 5 : 0, counter: S.reads ? 'p_counter' : undefined, parryPosture: 34, parryRecoil: 0.65, breakDur: 2.8, getup: 0.9,
    prop: { torso: lerp(0.95, 1.15, r()), arm: lerp(1, 1.2, r()), leg: lerp(0.95, 1.12, r()), head: lerp(0.9, 1.1, r()) },
    ribbons: S.cloak || r() < 0.6 ? [{ n: 10, seg: 8, color: '#1a1420', width: 9, oy: 2, grav: 700 }, { n: 8, seg: 8, color: '#1a1420', width: 7, oy: 6, grav: 800 }] : [], ribbonJoint: undefined };
  const row = ([mid, min, max, w, phase, dash]) => ({ id: mid, min, max, w, phase, dash: !!dash });
  const moves = S.moves.map(row);
  // One or two attacks from another school, held back for a later phase.
  const others = shuffle(r, Object.keys(SCHOOLS).filter((k) => k !== key).flatMap((k) => SCHOOLS[k].moves)).filter((m) => !moves.some((x) => x.id === m[0]));
  const borrow = 1 + (sector >= 3 ? 1 : 0);
  for (let i = 0; i < borrow && i < others.length; i++) moves.push({ ...row(others[i]), phase: 2, w: 2 });
  for (const m of moves) if (r() < 0.3) m.id = tempoMove(m.id, pick(r, [0.9, 1.15]));
  if (sector <= 1) for (const m of moves) if (m.phase === undefined && r() < 0.25 && moves.filter((x) => !x.phase).length > 3) m.phase = 2;
  const two = sector >= 2;
  const specials = [...S.specials];
  const extra = pick(r, ['summon', 'skyfall', 'blink']);
  if (!specials.includes(extra) && r() < 0.6) specials.push(extra);
  def.kit = { school: key, moves, specials, hold: S.hold, guard: S.guard || 0, phases: two ? [0.66, 0.33] : [0.5], echo: S.echo ? (two ? 3 : 2) : 0,
    heals: S.heal || r() < 0.25 ? (two ? [0.45, 0.2] : [0.3]) : [], strikes: moves.filter((m) => MOVES[m.id].hits.length && (m.min ?? 0) < 60 && !MOVES[m.id].run).map((m) => m.id),
    doubleAt: !S.blade.wide && !S.blade.thin && r() < 0.5 ? 2 : 0, phaseText: [pick(r, PHASE_TEXT[0]), pick(r, PHASE_TEXT[1])] };
  def.marks = def.kit.phases;
  if (!def.kit.strikes.length) def.kit.specials = def.kit.specials.filter((sp) => sp !== 'blink');
  if (moves.some((m) => MOVES[m.id].src === 'br_charge')) def.hitWall = ENEMIES.brute.hitWall;
  return def;
}

// Everything generated for a run. `places[s]` is the name of sector s, used in titles.
export function buildRoster(seed, places) {
  const r = makeRng(hash32(seed, 0xa11ce));
  const defs = {}, strains = [[]], champions = [], wardens = [], names = new Set();
  // Sixteen chassis slots spread over sectors II to IX, then two more for sector X.
  const order = [...shuffle(r, CHASSIS), ...shuffle(r, CHASSIS), ...shuffle(r, CHASSIS).slice(0, 2)];
  for (let s = 1; s < 10; s++) {
    const pair = [];
    for (let i = 0; i < 2; i++) {
      const id = `s${s}${i ? 'b' : 'a'}`;
      let chassis = order[(s - 1) * 2 + i];
      if (i === 1 && chassis === order[(s - 1) * 2]) chassis = CHASSIS[(CHASSIS.indexOf(chassis) + 3) % CHASSIS.length];
      defs[id] = makeStrain(r, id, chassis, s, names);
      pair.push(id);
    }
    strains.push(pair);
  }
  for (let s = 0; s < 10; s++) { const id = `c${s}`; defs[id] = makeChampion(r, id, s, places[s], names); champions.push(id); }
  for (let s = 0; s < 9; s++) { const id = `w${s}`; defs[id] = makeWarden(r, id, s, places[s], names); wardens.push(id); }
  return { defs, strains, champions, wardens };
}
