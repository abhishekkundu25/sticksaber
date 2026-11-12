// Run generator. A run is one hundred floors in ten sectors, all built from one seed and a difficulty.
//
// The shape of a sector is fixed, so a run has a rhythm the player can learn:
//   floors 1-2   introduce the sector's two new strains (sector I teaches the eight base types instead)
//   floors 3-4   skirmishes
//   floor 5      a champion, which pays out a new Focus power
//   floors 6-9   skirmishes, one of them an event floor (horde, elite squad, duel, gauntlet, ambush)
//   floor 10     the sector boss, which pays out a legendary augment
// What fills that shape is rolled: the strains, champions and bosses themselves (strains.js), the
// waves, temperaments, elites, the arenas and their colours, and now and then an anomaly that bends
// the rules for one floor. Three things are hand-made: the teaching waves of sector I, the
// Forgemaster (who keeps one sector of the first five) and the Proctor on floor 100.
// Pure functions, no simulation state.
import { makeRng, hash32 } from '../core/math.js';
import { buildRoster, BASE_COST, BASE_CAP } from './strains.js';

export const FLOORS = 100, SECTORS = 10, PER = 10;
export const DIFFS = {
  easy: { id: 'easy', name: 'STUDENT', blurb: 'Softer hits, longer pauses, smaller waves', dmg: 0.7, hp: 0.85, budget: -0.7, cd: 1.25, elite: 0.5, attackers: 0, heal: 0.4, restart: false },
  normal: { id: 'normal', name: 'ADEPT', blurb: 'The climb as it is meant to be', dmg: 1, hp: 1, budget: 0, cd: 1, elite: 1, attackers: 0, heal: 0.3, restart: false },
  hard: { id: 'hard', name: 'MASTER', blurb: 'Harder hits, bigger waves, and a fall restarts the floor', dmg: 1.2, hp: 1.15, budget: 1, cd: 0.85, elite: 1.5, attackers: 1, heal: 0.22, restart: true },
};
export const DIFF_IDS = ['easy', 'normal', 'hard'];
// Floor of sector I on which each base enemy first appears, and what it costs the wave budget.
export const UNLOCK = { initiate: 1, marksman: 2, bulwark: 3, duelist: 4, brute: 6, lancer: 7, wraith: 8, drone: 9 };
export const COST = BASE_COST;
const RANGED = { marksman: 1, drone: 1 };
const FLANKERS = { initiate: 1, duelist: 1 };
const ELITES = ['swift', 'armored', 'volatile'];
export const FAMILIES = ['causeway', 'foundry', 'hall', 'garden', 'vault', 'apex'];
const PLACES = {
  causeway: ['SKYBRIDGE', 'RAIN GALLERY', 'SIGNAL BRIDGE', 'THE LONG SPAN', 'TRANSIT SPINE', 'OVERLOOK', 'TOLL GATE'],
  foundry: ['FOUNDRY NINE', 'SLAG WORKS', 'CASTING FLOOR', 'SMELTER ROW', 'THE CRUCIBLE', 'QUENCH HALL', 'BELLOWS DECK'],
  hall: ['HALL OF ECHOES', 'THE LONG GALLERY', 'ANTECHAMBER', 'COLONNADE', 'CHAPTER HOUSE', 'THE NAVE', 'RELIQUARY'],
  garden: ['HANGING GARDENS', 'ARBORETUM', 'ROOT GALLERY', 'CANOPY WALK', 'POLLEN COURT', 'THE ORCHARD', 'MOSS STAIR'],
  vault: ['CRYO VAULT', 'COLD STACKS', 'STASIS ROW', 'FROST ARCHIVE', 'DEEP FREEZE', 'THE LEDGER', 'ICE WELL'],
  apex: ['STORM APEX', 'ANTENNA DECK', 'CLOUD TERRACE', 'LIGHTNING ROD', 'HIGH MAST', 'THE EYRIE', 'WIND STAIR'],
};
const SECTOR_ADJ = ['Ember', 'Silent', 'Drowned', 'Glass', 'Hollow', 'Rusted', 'Pale', 'Howling', 'Sunken', 'Gilded', 'Ashen', 'Frozen', 'Verdant', 'Shattered', 'Burning', 'Nameless'];
const SECTOR_NOUN = ['Reach', 'Tiers', 'Depths', 'Galleries', 'Works', 'Heights', 'Stacks', 'Cloisters', 'Span', 'Terraces', 'Wards', 'Steps'];
const HUES = [40, 75, 110, 150, 180, -40, -75, -110, -150];
export const ANOMALIES = {
  lowgrav: { name: 'LOW GRAVITY', text: 'Everything falls slowly. Juggles last longer' },
  frenzy: { name: 'FRENZY', text: 'Enemies are faster and frailer' },
  glass: { name: 'GLASS', text: 'Every hit lands half again as hard, yours and theirs' },
  surge: { name: 'SURGE', text: 'Focus builds twice as fast' },
  volatile: { name: 'UNSTABLE', text: 'Everything bursts when it dies' },
  bounty: { name: 'BOUNTY', text: 'The fallen leave far more orbs' },
};
const EVENTS = ['horde', 'elites', 'duel', 'gauntlet', 'ambush'];
const EVENT_NAME = { horde: 'Horde', elites: 'Elite Squad', duel: 'Duel', gauntlet: 'Gauntlet', ambush: 'Ambush' };

const HINTS = {
  basics: 'J light  ·  K heavy  ·  SPACE jump  ·  SHIFT dash      Chain lights, then finish with a heavy',
  parry: 'Hold L to guard. Tap it just before a hit lands to PARRY, then strike to riposte',
  marksman: 'Marksmen aim with a red line. Parry or cut the bolt and it flies back at them',
  bulwark: 'Shields shrug off light attacks. Hold K to charge a heavy, or dash through and hit the back',
  duelist: 'Duelists read repetition. When you see ADAPTED, change your attack or it will be turned aside',
  brute: 'A red flash cannot be blocked. Dash through it, then punish the long recovery',
  launch: 'S + K launches. Follow them up: air lights, then K to spike them back down',
  lancer: 'Lancers out-reach you and skewer jumps. Parry the thrust, then dash in close where the pike is useless',
  wraith: 'Wraiths vanish and reappear at your back. Listen for the second blink, turn, and parry',
  drone: 'Drones hover out of reach. Jump at them, launch into them, or parry the dive. Any hit drops them',
  focus: 'Focus has three uses. I throws your saber. I while you are being hit bursts you free. O with a full meter is OVERDRIVE',
  champion: 'A champion holds every fifth floor. Parries and heavies break its posture. Beating it wins a new Focus power',
  power: 'U switches between your Focus powers, and the number keys pick one directly. I uses the one shown',
  warden: 'Every tenth floor has a keeper. Watch what it changes at each phase. Beating it wins a legendary augment',
  elite: 'Elites carry an aura: gold is fast, blue will not flinch, orange bursts when it dies. Step back from orange',
  forgemaster: 'Watch the hammer. It can be parried until it glows white. When it vents steam, strike',
  proctor: 'It learns your habits. When it kneels to heal, hit it. The saber throw reaches across the room',
};

// [kind, x offset from the player, delay]
const T = (hint, attackers, ...spawns) => ({ hint, attackers, spawns: spawns.map(([kind, dx, t = 0]) => ({ kind, dx, t })) });
// Sector I is the school: each floor's first wave is hand-made and teaches one thing.
const SCHOOL = [
  { title: 'SPIRE CAUSEWAY', sub: 'The Approach', teach: [T('basics', 1, ['initiate', 380], ['initiate', -420, 1.6]), T('parry', 2, ['initiate', 360], ['initiate', -360, 0.8], ['initiate', 520, 2.4])] },
  { title: 'RAIN GALLERY', sub: 'Sight Lines', teach: [T('marksman', 2, ['initiate', 360], ['marksman', 640, 1.2], ['initiate', -380, 2.2])], hint: 'focus' },
  { title: 'SIGNAL BRIDGE', sub: 'The Wall', teach: [T('bulwark', 2, ['bulwark', 380], ['initiate', -400, 1.2], ['initiate', 540, 2.6])] },
  { title: 'THE LONG SPAN', sub: 'Crossed Blades', teach: [T('duelist', 2, ['duelist', 420], ['initiate', -440, 1.8])], hint: 'launch' },
  { title: 'TOLL GATE', sub: 'The First Champion' },
  { title: 'FOUNDRY NINE', sub: 'The Crucible', teach: [T('brute', 2, ['brute', 500], ['marksman', -620, 2.4])], hint: 'power' },
  { title: 'SLAG WORKS', sub: 'Reach', teach: [T('lancer', 2, ['lancer', 440], ['initiate', -420, 1.4], ['lancer', -560, 3])] },
  { title: 'CASTING FLOOR', sub: 'Unseen', teach: [T('wraith', 2, ['wraith', 460], ['initiate', -400, 1.2], ['initiate', 520, 2.4])] },
  { title: 'SMELTER ROW', sub: 'Overhead', teach: [T('drone', 2, ['drone', 320], ['drone', -360, 0.8], ['bulwark', 460, 1.8])] },
  { title: 'QUENCH HALL', sub: 'The First Keeper' },
];

const pick = (r, a) => a[(r() * a.length) | 0];
export const sectorOf = (n) => Math.floor((n - 1) / PER);
// Threat a wave may spend. It climbs steeply through the school, then slowly: from sector II on,
// most of the rising difficulty comes from tougher strains, health, speed and pace instead.
export const waveBudget = (n, wave) => (n <= 10 ? 2.2 + 0.85 * n : 10.7 + 0.085 * (n - 10)) + wave * 0.9;
export const maxPerWave = (s) => (s < 4 ? 5 : s < 8 ? 6 : 7);

// The enemy kinds a wave on floor `n` may draw from, with weights.
function poolFor(n, roster) {
  const s = sectorOf(n), pos = n - s * PER, out = [];
  for (const k in UNLOCK) {
    if (s === 0 && UNLOCK[k] > n) continue;
    out.push({ kind: k, cost: COST[k], cap: BASE_CAP[k] ?? 9, ranged: !!RANGED[k], flank: !!FLANKERS[k], w: s === 0 ? 1 + UNLOCK[k] * 0.22 : Math.max(0.35, 1 - 0.07 * s), base: k });
  }
  for (let q = 1; q <= s; q++) {
    roster.strains[q].forEach((id, i) => {
      if (q === s && pos <= i) return; // not introduced yet
      const g = roster.defs[id].gen;
      out.push({ kind: id, cost: g.cost, cap: g.cap, ranged: g.ranged, flank: g.flank, w: q === s ? 3 : 1.1, base: roster.defs[id].base });
    });
  }
  return out;
}

// Spend `budget` on enemies from `pool`. opts: { max, eliteChance, allElite, attackers, close, quick, floor }
function generateWave(pool, budget, r, o) {
  const count = {}, picks = [];
  let ranged = 0;
  while (picks.length < o.max) {
    const ok = pool.filter((p) => p.cost <= budget && (count[p.kind] || 0) < p.cap && !(p.ranged && ranged >= 2));
    if (!ok.length) break;
    let total = 0;
    for (const p of ok) total += p.w;
    let x = r() * total, p = ok[0];
    for (const q of ok) { x -= q.w; if (x <= 0) { p = q; break; } }
    let elite = null;
    const canElite = p.base !== 'initiate' && p.base !== 'drone';
    if (canElite && budget >= p.cost + 1 && (o.allElite || r() < o.eliteChance)) { elite = pick(r, ELITES); budget -= 1; }
    budget -= p.cost; count[p.kind] = (count[p.kind] || 0) + 1; if (p.ranged) ranged++;
    picks.push({ p, elite });
  }
  if (picks.length < 2 && !o.single) picks.push({ p: pool.find((q) => q.kind === 'initiate') || pool[0], elite: null });
  // Heaviest first, so the player sees the main threat arrive, then its support.
  picks.sort((a, b) => b.p.cost - a.p.cost);
  let side = r() < 0.5 ? 1 : -1, t = 0;
  const spawns = picks.map(({ p, elite }, i) => {
    const far = o.close ? 300 + r() * 80 : p.ranged ? 560 + r() * 160 : 340 + r() * 190;
    const roll = r();
    const temper = roll < 0.3 ? 'aggressive' : roll < 0.55 ? 'cautious' : roll < 0.8 && p.flank && o.floor >= 3 ? 'flank' : null;
    const sp = { kind: p.kind, dx: Math.round(side * far), t: +t.toFixed(2), elite, temper };
    side = -side; t += o.close ? 0.12 : o.quick ? 0.3 + r() * 0.25 : 0.7 + r() * 0.8 + (i === 0 ? 0.3 : 0);
    return sp;
  });
  return { spawns, attackers: o.attackers, hint: null };
}

function buildSectors(seed, r) {
  const forge = 1 + ((r() * 4) | 0); // the Forgemaster keeps one of sectors II to V
  const sectors = [], used = { causeway: 1, foundry: 1 }, hues = [...HUES];
  // Wings are drawn from the families used least so far, so a run visits all of them.
  const draw = (bar) => {
    const ok = FAMILIES.filter((f) => !bar.includes(f));
    const least = Math.min(...ok.map((f) => used[f] || 0));
    const f = pick(r, ok.filter((x) => (used[x] || 0) === least));
    used[f] = (used[f] || 0) + 1;
    return f;
  };
  let last = 'foundry';
  for (let s = 0; s < SECTORS; s++) {
    let wings;
    if (s === 0) wings = ['causeway', 'foundry'];
    else {
      const b = s === forge ? 'foundry' : s === 9 ? 'hall' : null;
      const a = draw([last, b]);
      wings = [a, b || draw([a])];
    }
    last = wings[1];
    const name = s === 0 ? 'The Threshold' : s === 9 ? 'The Crown' : `The ${pick(r, SECTOR_ADJ)} ${pick(r, SECTOR_NOUN)}`;
    sectors.push({ i: s, name, wings, hue: s === 0 ? 0 : hues.splice((r() * hues.length) | 0, 1)[0], forge: s === forge });
  }
  // No two sectors share a name.
  for (let s = 1; s < 9; s++) while (sectors.some((o, i) => i < s && o.name === sectors[s].name)) sectors[s].name = `The ${pick(r, SECTOR_ADJ)} ${pick(r, SECTOR_NOUN)}`;
  return sectors;
}

function buildFloor(n, seed, D, roster, sectors, plan) {
  const s = sectorOf(n), pos = n - s * PER, S = sectors[s], r = makeRng(hash32(seed, n * 7919));
  const kind = plan[s][pos - 1], school = s === 0 ? SCHOOL[pos - 1] : null;
  const pool = poolFor(n, roster);
  const attackers = Math.min(4, (s < 4 ? 2 : s < 8 ? 3 : 4) + D.attackers);
  const eliteChance = s === 0 ? 0 : Math.min(0.5, (0.1 + 0.045 * s) * D.elite);
  const opts = { max: maxPerWave(s), eliteChance, attackers, floor: n };
  const budget = (w) => Math.max(2, waveBudget(n, w) + D.budget);
  const family = S.wings[pos <= 5 ? 0 : 1];
  // By the last three sectors a build is nearly complete, so the tower pushes back harder there.
  const late = 1 + Math.max(0, n - 70) * 0.015;
  const fl = { n, sector: s, pos, kind, arena: family, arenaSeed: hash32(seed, n) || 1, hue: S.hue, music: 'combat', boss: null, anomaly: null, reward: 'augment', waves: [],
    dmg: +(D.dmg * (1 + 0.014 * (n - 1) + 0.0002 * (n - 1) ** 2) * late).toFixed(3), hp: +(D.hp * (1 + 0.028 * (n - 1) + 0.00035 * (n - 1) ** 2) * (1 + (late - 1) * 0.6)).toFixed(3), rate: +(1 + 0.014 * s).toFixed(3), cd: +(D.cd * Math.max(0.68, 1 - 0.035 * s)).toFixed(3),
    heal: D.heal, restart: D.restart };
  const places = PLACES[family];
  fl.title = school ? school.title : places[(hash32(seed, s * 31 + (pos <= 5 ? 0 : 7)) + pos) % places.length];
  let tag = school ? school.sub : S.name;

  if (kind === 'boss') {
    const boss = n === FLOORS ? 'proctor' : S.forge ? 'forgemaster' : roster.wardens[s];
    const def = roster.defs[boss];
    fl.boss = boss; fl.music = boss === 'forgemaster' || (def && r() < 0.4) ? 'boss2' : 'boss'; fl.reward = n === FLOORS ? null : 'legend';
    fl.waves.push({ spawns: [{ kind: boss, dx: 560, t: 0 }], attackers: 1, hint: HINTS[boss] || (s === 0 ? HINTS.warden : null) });
    if (boss === 'forgemaster') { fl.title = 'THE ANVIL'; tag = 'Keeper of the Forge'; fl.arenaSeed = 0; fl.hue = 0; }
    else if (boss === 'proctor') { fl.title = 'EXAMINATION HALL'; tag = 'The Proctor'; fl.arenaSeed = 0; fl.hue = 0; }
    else tag = def.title;
  } else if (kind === 'champion') {
    fl.boss = roster.champions[s]; fl.music = 'boss2'; fl.reward = 'power';
    fl.waves.push({ spawns: [{ kind: fl.boss, dx: 540, t: 0 }], attackers: 2, hint: s === 0 ? HINTS.champion : null });
    if (!school) tag = roster.defs[fl.boss].title;
  } else if (school) {
    for (const t of school.teach) fl.waves.push({ spawns: t.spawns.map((sp) => ({ ...sp })), attackers: t.attackers, hint: HINTS[t.hint] });
    const w = generateWave(pool, budget(fl.waves.length), r, opts);
    if (school.hint) w.hint = HINTS[school.hint];
    fl.waves.push(w);
  } else if (kind === 'intro') {
    // The new strain arrives with light support and a line that says what it is.
    const id = roster.strains[s][pos - 1], g = roster.defs[id].gen;
    const support = generateWave(pool.filter((p) => p.cost <= 1.7 && p.kind !== id), Math.max(1, budget(0) * 0.45 - g.cost), r, { ...opts, max: 2, eliteChance: 0 });
    const first = { kind: id, dx: (g.ranged ? 600 : 420) * (r() < 0.5 ? 1 : -1), t: 0, elite: null, temper: null };
    fl.waves.push({ spawns: [first, ...support.spawns.slice(0, 2).map((sp) => ({ ...sp, t: +(sp.t + 1.4).toFixed(2) }))], attackers: 2, hint: g.hint });
    fl.waves.push(generateWave(pool, budget(1), r, opts));
    tag = 'New Strain';
  } else if (kind === 'horde') {
    const cheap = pool.filter((p) => p.cost <= 1.7).map((p) => ({ ...p, cap: 9 }));
    fl.waves.push(generateWave(cheap, budget(1) * 1.5, r, { ...opts, max: Math.min(12, 8 + Math.floor(s / 2)), eliteChance: 0, attackers: Math.min(4, attackers + 1), quick: true }));
    fl.reward = 'rare';
  } else if (kind === 'elites') {
    fl.waves.push(generateWave(pool.filter((p) => p.base !== 'initiate' && p.base !== 'drone'), budget(1) * 1.2, r, { ...opts, max: Math.min(4, opts.max), allElite: true }));
    fl.reward = 'rare';
  } else if (kind === 'duel') {
    // Two of the sector's strongest fighters, and nothing else. Brutes are left out: two at once is a wall, not a duel.
    const top = [...pool].filter((p) => p.base !== 'brute').sort((a, b) => b.cost - a.cost).slice(0, 4).map((p) => ({ ...p, cap: 1 }));
    fl.waves.push(generateWave(top, 99, r, { ...opts, max: 2, allElite: s >= 4, attackers: 2 }));
    fl.reward = 'rare';
  } else if (kind === 'gauntlet') {
    for (let w = 0; w < 3; w++) fl.waves.push({ ...generateWave(pool, budget(w) * 0.72, r, opts), noHeal: true });
    fl.reward = 'rare';
  } else if (kind === 'ambush') {
    for (let w = 0; w < 2; w++) fl.waves.push(generateWave(pool.filter((p) => !p.ranged), budget(w) * 0.9, r, { ...opts, close: true }));
    fl.reward = 'rare';
  } else {
    for (let w = 0; w < 2; w++) fl.waves.push(generateWave(pool, budget(w), r, opts));
    if (n === 13) fl.waves[0].hint = HINTS.elite;
  }
  if (EVENT_NAME[kind]) tag = EVENT_NAME[kind];

  // Now and then a floor bends a rule.
  if (s > 0 && !fl.boss && kind !== 'intro' && r() < 0.17) {
    fl.anomaly = pick(r, Object.keys(ANOMALIES));
    const first = fl.waves[0];
    if (!first.hint) first.hint = `ANOMALY: ${ANOMALIES[fl.anomaly].name}. ${ANOMALIES[fl.anomaly].text}`;
  }
  if (n === 1) { fl.arenaSeed = 0; fl.hue = 0; }
  fl.sub = `Floor ${n}  ·  ${tag}`;
  return fl;
}

// Everything about a run: its sectors, its generated enemies and all hundred floors.
export function generateRun(seed, diff = 'normal') {
  seed = (seed >>> 0) || 1;
  const D = DIFFS[diff] || DIFFS.normal, r = makeRng(hash32(seed, 0x5ec7));
  const sectors = buildSectors(seed, r);
  const roster = buildRoster(seed, sectors.map((s) => s.name));
  // The plan: which kind of floor sits at each position of each sector.
  const plan = [];
  for (let s = 0; s < SECTORS; s++) {
    const p = s === 0 ? ['intro', 'intro', 'intro', 'intro', 'champion', 'intro', 'intro', 'intro', 'intro', 'boss']
      : ['intro', 'intro', 'skirmish', 'skirmish', 'champion', 'skirmish', 'skirmish', 'skirmish', 'skirmish', 'boss'];
    if (s > 0) {
      p[5 + ((r() * 4) | 0)] = pick(r, EVENTS);
      if (s >= 2 && r() < 0.5) p[2 + ((r() * 2) | 0)] = pick(r, EVENTS);
    }
    plan.push(p);
  }
  // Champions and wardens call on the cheaper fighters of their own sector.
  for (let s = 0; s < SECTORS; s++) {
    const cheap = (pos) => poolFor(s * PER + pos, roster).filter((p) => p.cost <= 2).map((p) => p.kind);
    roster.defs[roster.champions[s]].adds = cheap(5);
    if (roster.wardens[s]) roster.defs[roster.wardens[s]].adds = cheap(9);
  }
  const floors = [];
  for (let n = 1; n <= FLOORS; n++) floors.push(buildFloor(n, seed, D, roster, sectors, plan));
  for (const S of sectors) { S.strains = roster.strains[S.i]; S.champion = roster.champions[S.i]; S.boss = floors[S.i * PER + 9].boss; }
  return { seed, diff: D.id, roster, sectors, floors };
}

export const roman = (n) => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n - 1] || String(n);
export const seedLabel = (seed) => (seed >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(-6);
export const parseSeed = (s) => { const v = parseInt(String(s).replace(/[^0-9a-z]/gi, ''), 36); return Number.isFinite(v) && v > 0 ? v >>> 0 : 0; };
