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
import { ENEMIES } from './enemies.js';
import { BONDS } from './bonds.js';

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
  twins: 'They share one life, and only the lit one can be hurt. The other still cuts. Watch for the swap',
  cartographer: 'It redraws the floor. Red strips erupt, so stand between them. When the whole floor lights, get onto a bridge',
  plats: 'LIGHT BRIDGES  ·  Jump onto them for a breather or a plunge. They overload if you stay. S + SPACE drops through',
  vents: 'VENTS  ·  The marked strips erupt on a timer and burn anyone standing there. Knock enemies into them',
  walls: 'CHARGED WALLS  ·  The walls are live. Knock or throw an enemy into one and it takes a shock',
};

// [kind, x offset from the player, delay]
const T = (hint, attackers, ...spawns) => ({ hint, attackers, spawns: spawns.map(([kind, dx, t = 0]) => ({ kind, dx, t })) });
// Sector I is the school: each floor's first wave is hand-made and teaches one thing.
const SCHOOL = [
  { title: 'SPIRE CAUSEWAY', sub: 'The Approach', teach: [T('basics', 1, ['initiate', 380], ['initiate', -420, 1.6]), { ...T('parry', 2, ['initiate', 300], ['initiate', -360, 0.8], ['initiate', 520, 2.4]), lesson: 'parry' }] },
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
    // The sector's animal arrives on its third floor.
    const b = roster.beasts[q];
    if (b && !(q === s && pos < 3)) { const d = roster.defs[b]; out.push({ kind: b, cost: d.gen.cost, cap: d.gen.cap, ranged: !!d.gen.ranged, flank: false, w: q === s ? 3 : 1.1, base: d.base, beast: true }); }
  }
  return out;
}

const nameOf = (roster, k) => (roster.defs[k] || ENEMIES[k]).name;
// The two bonds a sector's enemies form (see bonds.js). Each names the kinds it joins, so the same
// pairing turns up through the sector and the player can learn it.
function buildRules(s, roster, r) {
  const all = poolFor(s * PER + 9, roster), def = (p) => roster.defs[p.kind] || ENEMIES[p.kind];
  const own = (p) => p.w >= 3; // introduced in this sector
  const from = (list) => { if (!list.length) return null; const mine = list.filter(own); return pick(r, mine.length && r() < 0.75 ? mine : list); };
  const riders = all.filter((p) => !p.beast && ['initiate', 'duelist', 'lancer'].includes(p.base));
  const mounts = all.filter((p) => p.beast && def(p).rideable);
  const packs = all.filter((p) => (p.beast && def(p).info?.pack) || p.kind === 'initiate');
  const shots = all.filter((p) => p.base === 'marksman' || (p.beast && p.ranged && !def(p).flying));
  const heavy = all.filter((p) => p.cost >= 3.4 && !p.ranged);
  const mid = all.filter((p) => p.cost >= 2.2 && p.cost <= 4.4 && !p.ranged && !def(p).flying);
  const shields = all.filter((p) => p.base === 'bulwark' || def(p).traits?.shielded);
  const leaders = all.filter((p) => p.cost >= 2.4 && p.cost <= 4 && !p.ranged && !(p.beast && def(p).info?.pack));
  const make = {
    rider: () => { const a = from(riders), b = from(mounts); return a && b ? [a, b] : null; },
    pack: () => { const b = from(packs.filter((p) => p.beast)) || from(packs), a = from(leaders.filter((p) => p !== b)); return a && b ? [a, b] : null; },
    ward: () => { const a = from(shots) || from(all.filter((p) => p.cost <= 1.7)), b = from(heavy.filter((p) => p !== a)); return a && b ? [a, b] : null; },
    avenger: () => { const a = from(mid), b = from(mid.filter((p) => p !== a)); return a && b ? [a, b] : null; },
    cover: () => { const a = from(shields), b = from(shots.filter((p) => p !== a)); return a && b ? [a, b] : null; },
    combo: () => { const a = from(heavy), b = from(mid.filter((p) => p !== a && p.cost < (a ? a.cost : 9))); return a && b ? [a, b] : null; },
  };
  // The sector's own animal decides the first bond when it can: something to ride, or something that hunts in packs.
  const beast = all.find((p) => p.beast && own(p));
  const order = [];
  if (beast && def(beast).rideable) order.push('rider'); else if (beast && def(beast).info?.pack) order.push('pack');
  for (const t of ['ward', 'avenger', 'cover', 'combo', 'pack', 'rider'].sort(() => r() - 0.5)) if (!order.includes(t)) order.push(t);
  const rules = [];
  for (const type of order) {
    if (rules.length >= 2) break;
    const m = make[type]();
    if (!m) continue;
    const [a, b] = m, n = type === 'pack' ? 2 + (s >= 4 ? 1 : 0) : 1, B = nameOf(roster, b.kind);
    rules.push({ type, kinds: [a.kind, b.kind], n, sector: s, hint: `${BONDS[type].name}  ·  ${BONDS[type].hint(nameOf(roster, a.kind), type === 'pack' ? `${B}s` : B)}` });
  }
  return rules;
}

// Spend `budget` on enemies from `pool`. opts: { max, eliteChance, allElite, attackers, close, quick, floor,
// rules (bonds that may form), bondChance, force (a bond that must) }
function generateWave(pool, budget, r, o) {
  const count = {}, picks = [], groups = [], by = Object.fromEntries(pool.map((p) => [p.kind, p]));
  let ranged = 0;
  // A bonded group arrives as one unit and is paid for as one.
  const group = (rule, must) => {
    const [a, b] = rule.kinds.map((k) => by[k]);
    if (!a || !b) return false;
    const list = rule.type === 'pack' ? [a, ...Array(rule.n).fill(b)] : [a, b];
    const cost = list.reduce((x, m) => x + m.cost, 0) + 0.5;
    if (!must && (cost > budget || list.length > o.max)) return false;
    const g = groups.length;
    groups.push({ type: rule.type, n: list.length });
    list.forEach((m, role) => { picks.push({ p: m, elite: null, g, role }); count[m.kind] = (count[m.kind] || 0) + 1; if (m.ranged) ranged++; });
    budget -= cost;
    return true;
  };
  if (o.force) group(o.force, true);
  else if (o.rules?.length && r() < o.bondChance) {
    let total = 0;
    for (const q of o.rules) total += q.w;
    let x = r() * total, rule = o.rules[0];
    for (const q of o.rules) { x -= q.w; if (x <= 0) { rule = q; break; } }
    group(rule, false);
  }
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
  // Units, heaviest first, so the player sees the main threat arrive, then its support.
  const units = groups.map((_, g) => picks.filter((q) => q.g === g)).concat(picks.filter((q) => q.g === undefined).map((q) => [q]));
  const weight = (u) => Math.max(...u.map((q) => q.p.cost)) + (u.length > 1 ? 1 : 0);
  units.sort((a, b) => weight(b) - weight(a));
  let side = r() < 0.5 ? 1 : -1, t = 0;
  const spawns = [];
  units.forEach((u, i) => {
    const lead = u[0], type = lead.g === undefined ? null : groups[lead.g].type;
    const far = o.close ? 300 + r() * 80 : lead.p.ranged && !type ? 560 + r() * 160 : 340 + r() * 190;
    for (const q of u) {
      const roll = r();
      let dx = side * far, temper = roll < 0.3 ? 'aggressive' : roll < 0.55 ? 'cautious' : roll < 0.8 && q.p.flank && o.floor >= 3 ? 'flank' : null;
      if (type) {
        temper = type === 'pack' && q.role ? 'aggressive' : null;
        if (type === 'pack') dx = side * (far + q.role * 70);
        else if (type === 'ward') dx = side * (q.role ? far : far + 230);          // the warder hangs back behind its charge
        else if (type === 'avenger') dx = (q.role ? -side : side) * far;
        else if (type === 'cover') dx = side * (q.role ? far + 210 : far);
        else if (type === 'combo') dx = side * (far + q.role * 90);
      }
      dx = Math.max(-760, Math.min(760, Math.round(dx)));
      const sp = { kind: q.p.kind, dx, t: +t.toFixed(2), elite: q.elite, temper };
      if (type) { sp.g = q.g; sp.role = q.role; }
      spawns.push(sp);
    }
    side = -side; t += o.close ? 0.12 : o.quick ? 0.3 + r() * 0.25 : 0.7 + r() * 0.8 + (i === 0 ? 0.3 : 0);
  });
  const wave = { spawns, attackers: o.attackers, hint: null };
  if (groups.length) wave.groups = groups;
  return wave;
}

function buildSectors(seed, r) {
  const forge = 1 + ((r() * 4) | 0); // the Forgemaster keeps one of sectors II to V
  const twins = 5 + ((r() * 2) | 0), carto = 7 + ((r() * 2) | 0); // the Twins one of VI and VII, the Cartographer one of VIII and IX
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
    sectors.push({ i: s, name, wings, hue: s === 0 ? 0 : hues.splice((r() * hues.length) | 0, 1)[0], forge: s === forge, twins: s === twins, carto: s === carto });
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
  // Bonds this floor's enemies may form: the sector's own once introduced, and older ones now and then.
  const rules = [];
  for (let q = 1; q <= s; q++) roster.rules[q].forEach((rule, i) => { if (!(q === s && pos < (i ? 6 : 4))) rules.push({ ...rule, w: q === s ? 3 : 1 }); });
  const opts = { max: maxPerWave(s), eliteChance, attackers, floor: n, rules, bondChance: s === 0 ? 0 : Math.min(0.75, 0.3 + 0.05 * s) };
  const budget = (w) => Math.max(2, waveBudget(n, w) + D.budget);
  const family = S.wings[pos <= 5 ? 0 : 1];
  // By the last three sectors a build is nearly complete, so the tower pushes back harder there.
  const late = 1 + Math.max(0, n - 70) * 0.015;
  const fl = { n, sector: s, pos, kind, arena: family, arenaSeed: hash32(seed, n) || 1, hue: S.hue, music: 'combat', boss: null, anomaly: null, terrain: null, reward: 'augment', waves: [],
    dmg: +(D.dmg * (1 + 0.014 * (n - 1) + 0.0002 * (n - 1) ** 2) * late).toFixed(3), hp: +(D.hp * (1 + 0.028 * (n - 1) + 0.00035 * (n - 1) ** 2) * (1 + (late - 1) * 0.6)).toFixed(3), rate: +(1 + 0.014 * s).toFixed(3), cd: +(D.cd * Math.max(0.68, 1 - 0.035 * s)).toFixed(3),
    heal: D.heal, restart: D.restart };
  const places = PLACES[family];
  fl.title = school ? school.title : places[(hash32(seed, s * 31 + (pos <= 5 ? 0 : 7)) + pos) % places.length];
  let tag = school ? school.sub : S.name;

  if (kind === 'boss') {
    const boss = n === FLOORS ? 'proctor' : S.forge ? 'forgemaster' : S.twins ? 'twins' : S.carto ? 'cartographer' : roster.wardens[s];
    const def = roster.defs[boss];
    fl.boss = boss; fl.music = boss === 'forgemaster' || (def && r() < 0.4) ? 'boss2' : 'boss'; fl.reward = n === FLOORS ? null : 'legend';
    fl.waves.push({ spawns: [{ kind: boss, dx: 560, t: 0 }], attackers: 1, hint: HINTS[boss] || (s === 0 ? HINTS.warden : null) });
    if (boss === 'forgemaster') { fl.title = 'THE ANVIL'; tag = 'Keeper of the Forge'; fl.arenaSeed = 0; fl.hue = 0; }
    else if (boss === 'proctor') { fl.title = 'EXAMINATION HALL'; tag = 'The Proctor'; fl.arenaSeed = 0; fl.hue = 0; }
    else if (boss === 'twins') {
      // Two bodies, one life: they arrive on either side.
      fl.title = 'THE MIRRORED COURT'; tag = 'The Twins'; fl.boss = 'twinA';
      fl.waves[0] = { spawns: [{ kind: 'twinA', dx: 520, t: 0, g: 0, role: 0 }, { kind: 'twinB', dx: -520, t: 0, g: 0, role: 1 }], groups: [{ type: 'twins', n: 2 }], attackers: 1, hint: HINTS.twins };
    } else if (boss === 'cartographer') { fl.title = 'THE DRAWING ROOM'; tag = 'The Cartographer'; fl.terrain = { plats: [], vents: [], walls: true }; }
    else tag = def.title;
  } else if (kind === 'champion') {
    fl.boss = roster.champions[s]; fl.music = 'boss2'; fl.reward = 'power';
    fl.waves.push({ spawns: [{ kind: fl.boss, dx: 540, t: 0 }], attackers: 2, hint: s === 0 ? HINTS.champion : null });
    if (!school) tag = roster.defs[fl.boss].title;
  } else if (school) {
    for (const t of school.teach) fl.waves.push({ spawns: t.spawns.map((sp) => ({ ...sp })), attackers: t.attackers, hint: HINTS[t.hint], lesson: t.lesson });
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
  } else if (kind === 'beast') {
    // The sector's animal, with a line that says what it is and how to answer it.
    const id = roster.beasts[s], g = roster.defs[id].gen, pack = roster.defs[id].info?.pack;
    const side = r() < 0.5 ? 1 : -1, far = g.ranged ? 600 : 440;
    const first = [{ kind: id, dx: far * side, t: 0, elite: null, temper: null }];
    if (pack || g.cost < 2) first.push({ kind: id, dx: -far * side, t: 1.2, elite: null, temper: null });
    const support = generateWave(pool.filter((p) => p.cost <= 1.7 && p.kind !== id), Math.max(1, budget(0) * 0.35), r, { ...opts, rules: null, max: 2, eliteChance: 0 });
    fl.waves.push({ spawns: [...first, ...support.spawns.slice(0, 1).map((sp) => ({ ...sp, t: +(sp.t + 2).toFixed(2) }))], attackers: 2, hint: g.hint });
    fl.waves.push(generateWave(pool, budget(1), r, opts));
    tag = 'New Beast';
  } else if (kind === 'bond') {
    // The sector's first bond, alone enough to be read, with a line that says how to break it.
    const rule = roster.rules[s][0];
    const w0 = generateWave(pool, Math.max(1, budget(0) * 0.3), r, { ...opts, rules: null, force: rule, max: rule.n + 2, eliteChance: 0, single: true });
    w0.hint = rule.hint;
    fl.waves.push(w0, generateWave(pool, budget(1), r, opts));
    tag = `Bond: ${BONDS[rule.type].name[0]}${BONDS[rule.type].name.slice(1).toLowerCase()}`;
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
    // The sector's second bond gets the same introduction on its sixth floor.
    const second = pos === 6 ? roster.rules[s]?.[1] : null;
    for (let w = 0; w < 2; w++) fl.waves.push(generateWave(pool, budget(w), r, w === 0 && second ? { ...opts, force: second } : opts));
    if (second) fl.waves[0].hint = second.hint;
    if (n === 17 && !fl.waves[0].hint) fl.waves[0].hint = HINTS.elite;
  }
  if (EVENT_NAME[kind]) tag = EVENT_NAME[kind];

  // Now and then a floor bends a rule.
  const teaching = kind === 'intro' || kind === 'beast' || kind === 'bond';
  if (s > 0 && !fl.boss && !teaching && r() < 0.17) {
    fl.anomaly = pick(r, Object.keys(ANOMALIES));
    const first = fl.waves[0];
    if (!first.hint) first.hint = `ANOMALY: ${ANOMALIES[fl.anomaly].name}. ${ANOMALIES[fl.anomaly].text}`;
  }
  // Terrain: light bridges to stand on, vents that erupt on a timer, walls that shock. Positions are
  // fractions of the arena's half width, because arenas differ in size.
  if (s > 0 && !fl.terrain && n !== FLOORS && fl.boss !== 'forgemaster' && r() < (fl.boss ? 0.3 : teaching ? 0.2 : 0.5)) {
    const T = { plats: [], vents: [], walls: false };
    const what = fl.boss ? pick(r, ['vents', 'walls']) : pick(r, ['plats', 'vents', 'walls', 'plats+vents', 'vents+walls', 'plats']);
    if (what.includes('plats')) for (const fx of [[-0.45, 0.45], [0], [-0.55, 0, 0.55], [-0.3, 0.4]][(r() * 4) | 0]) T.plats.push({ fx: +(fx + (r() - 0.5) * 0.1).toFixed(3), y: -(132 + Math.round(r() * 36)), w: 230 + Math.round(r() * 80) });
    if (what.includes('vents')) { const k = 2 + ((r() * 2) | 0); for (let i = 0; i < k; i++) T.vents.push({ fx: +(-0.7 + (1.4 * (i + 0.5)) / k + (r() - 0.5) * 0.12).toFixed(3), w: 52, period: +(5 + r() * 2.5).toFixed(2), phase: +(r() * 4).toFixed(2) }); }
    if (what.includes('walls')) T.walls = true;
    fl.terrain = T;
    const first = fl.waves[0], word = T.plats.length ? 'plats' : T.vents.length ? 'vents' : 'walls';
    if (!first.hint && s <= 3) first.hint = HINTS[word];
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
  roster.rules = [[]];
  for (let s = 1; s < SECTORS; s++) roster.rules.push(buildRules(s, roster, makeRng(hash32(seed, 0xb07d + s))));
  // The plan: which kind of floor sits at each position of each sector.
  const plan = [];
  for (let s = 0; s < SECTORS; s++) {
    const p = s === 0 ? ['intro', 'intro', 'intro', 'intro', 'champion', 'intro', 'intro', 'intro', 'intro', 'boss']
      : ['intro', 'intro', roster.beasts[s] ? 'beast' : 'skirmish', roster.rules[s].length ? 'bond' : 'skirmish', 'champion', 'skirmish', 'skirmish', 'skirmish', 'skirmish', 'boss'];
    // One event floor per sector, on the seventh to ninth floor (the sixth introduces the second bond).
    if (s > 0) p[6 + ((r() * 3) | 0)] = pick(r, EVENTS);
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
