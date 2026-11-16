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
// Two lengths of run. The sprint has no school: every base enemy is there from the first floor, the
// first sector already has its own strains, and the tower gets harder about half again as fast.
export const MODES = {
  sprint: { id: 'sprint', name: 'SPRINT', blurb: 'Thirty floors in three sectors. One sitting', floors: 30, sectors: 3 },
  climb: { id: 'climb', name: 'THE CLIMB', blurb: 'All hundred floors in ten sectors', floors: 100, sectors: 10 },
};
export const MODE_IDS = ['sprint', 'climb'];
// How deep into the tower floor `n` counts for scaling.
export const depthOf = (mode, n) => (mode === 'sprint' ? 6 + (n - 1) * 1.6 : n);
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
// Surprises: one per sector, on a floor nobody can predict. `when` is the moment it breaks in: as the
// floor's last wave starts, a few seconds into it, or after the floor looks finished.
export const SURPRISES = {
  shade: { name: 'YOUR SHADE', text: 'Something followed you up. It has your blade', when: 'end' },
  blackout: { name: 'BLACKOUT', text: 'The lights are gone. Watch the blades', when: 'start' },
  feud: { name: 'BAD BLOOD', text: 'They hate each other more than they hate you. Let them', when: 'start' },
  captive: { name: 'A PRISONER', text: 'Break the cell and they will fight beside you', when: 'start' },
  stampede: { name: 'STAMPEDE', text: 'Something is coming through. Jump', when: 'mid' },
  bounty: { name: 'COURIER', text: 'It carries something. Cut it down before it gets out', when: 'mid' },
  rival: { name: 'A RIVAL', text: 'Another climber, and not here to help', when: 'mid' },
  quake: { name: 'THE SPIRE SHIFTS', text: 'The room is coming apart', when: 'mid' },
  storm: { name: 'STORM FRONT', text: 'Lightning walks the floor. Keep moving', when: 'mid' },
  cache: { name: 'SUPPLY DROP', text: 'Something fell from above. Break it open', when: 'mid' },
};
// Objectives: floors that are not won by killing everything in two waves.
export const OBJECTIVES = {
  survive: { name: 'HOLD OUT', tag: 'Hold Out', text: (o) => `HOLD OUT  ·  They keep coming for ${o.time} seconds. Stay alive until the floor gives up` },
  hunt: { name: 'THE MARK', tag: 'The Mark', text: () => 'THE MARK  ·  One of them is marked in gold. Kill it and the rest lose their nerve' },
  hold: { name: 'HOLD THE RING', tag: 'Hold the Ring', text: () => 'HOLD THE RING  ·  Stand in the ring to charge it. When it is full it clears the room' },
  cores: { name: 'SIGNAL CORES', tag: 'Signal Cores', text: () => 'SIGNAL CORES  ·  Reinforcements come for as long as a core stands. Break all three' },
};
// Challenges: an extra condition on a floor that pays shards if it is met.
export const CHALLENGES = {
  untouched: { name: 'UNTOUCHED', text: 'Take no damage', pay: 45 },
  swift: { name: 'SWIFT', text: (c) => `Clear the floor in ${c.time} seconds`, pay: 30 },
  pure: { name: 'BLADE ONLY', text: 'Use no Focus powers', pay: 25 },
  parry: { name: 'DUELLIST', text: 'Parry three times', pay: 25 },
  aerial: { name: 'SKYBORN', text: 'Kill two enemies in the air', pay: 30 },
  room: { name: 'USE THE ROOM', text: 'Kill one enemy with the room itself', pay: 35 },
};
// Doors: after some floors the way up splits.
export const DOORS = {
  stair: { name: 'THE STAIR', color: '#9fb4c8', glyph: 'chev', text: () => 'Straight up. Nothing gained and nothing risked' },
  elite: { name: 'ELITE GUARD', color: '#ffd36b', glyph: 'star', text: () => 'Every enemy on the next floor is an elite. It pays a better card and 40 shards' },
  cursed: { name: 'CURSED HALL', color: '#c084ff', glyph: 'skull', text: (d) => `The next floor is cursed: ${CURSES[d.curse].text}. Take two cards after it` },
  rest: { name: 'SANCTUARY', color: '#7dffb0', glyph: 'plus', text: () => 'Recover 45% of your health before you go on' },
  shop: { name: 'QUARTERMASTER', color: '#ffb347', glyph: 'orb', text: () => 'Spend shards on cards, a weapon or repairs' },
  shrine: { name: 'SHRINE', color: '#ff5c8a', glyph: 'flame', text: () => 'A pact: great power at a real price. You may refuse it' },
  armory: { name: 'ARMOURY', color: '#56e9ff', glyph: 'slash', text: () => 'Trade your weapon for another. Your build comes with you' },
  unknown: { name: 'UNMARKED', color: '#e6fdff', glyph: 'dice', text: () => 'Nobody knows what is behind this one' },
};
export const CURSES = {
  frail: { name: 'FRAIL', text: 'you take 30% more damage' },
  haste: { name: 'HASTE', text: 'everything hunting you is faster' },
  dusk: { name: 'DUSK', text: 'the lights are out' },
  drought: { name: 'DROUGHT', text: 'nothing heals you between waves' },
  swarm: { name: 'SWARM', text: 'every wave brings one more' },
};
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
  edges: 'OPEN EDGES  ·  The floor ends before the wall. Knock them over the edge and they are gone. A fall costs you health',
  ledges: 'LEDGES  ·  Shooters hold the high ground. Jump up to them, or launch something into them',
  mover: 'SLIDING BRIDGE  ·  It crosses the room and carries whoever stands on it. One side of the floor is open',
  lift: 'THE LIFT  ·  Both sides are open all the way up. Stay in the middle and send them over',
};
// Rooms with a shape: where the floor ends, what hangs over it and what moves.
export const ROOMS = { edges: 'Open Edges', ledges: 'High Ground', mover: 'Sliding Bridge', lift: 'The Lift' };

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
const shuffle = (r, a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const sectorOf = (n) => Math.floor((n - 1) / PER);
// Threat a wave may spend. It climbs steeply through the school, then slowly: from sector II on,
// most of the rising difficulty comes from tougher strains, health, speed and pace instead.
export const waveBudget = (n, wave) => (n <= 10 ? 2.2 + 0.85 * n : 10.7 + 0.085 * (n - 10)) + wave * 0.9;
export const maxPerWave = (s) => (s < 4 ? 5 : s < 8 ? 6 : 7);

// The enemy kinds a wave on floor `n` may draw from, with weights.
// `s` is the roster sector whose strains are the newest, `pos` the floor's place in it (1 to 10), and
// `school` is true on the teaching floors of the long climb, where base enemies unlock one by one.
function poolFor(s, pos, roster, school = false) {
  const out = [];
  for (const k in UNLOCK) {
    if (school && UNLOCK[k] > pos) continue;
    out.push({ kind: k, cost: COST[k], cap: BASE_CAP[k] ?? 9, ranged: !!RANGED[k], flank: !!FLANKERS[k], w: school ? 1 + UNLOCK[k] * 0.22 : Math.max(0.35, 1 - 0.07 * s), base: k });
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
  const all = poolFor(s, 9, roster), def = (p) => roster.defs[p.kind] || ENEMIES[p.kind];
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
    mend: () => { const a = from(all.filter((p) => p.cost <= 2 && p.kind !== 'initiate')), b = from(heavy.filter((p) => p !== a)); return a && b ? [a, b] : null; },
    avenger: () => { const a = from(mid), b = from(mid.filter((p) => p !== a)); return a && b ? [a, b] : null; },
    cover: () => { const a = from(shields), b = from(shots.filter((p) => p !== a)); return a && b ? [a, b] : null; },
    combo: () => { const a = from(heavy), b = from(mid.filter((p) => p !== a && p.cost < (a ? a.cost : 9))); return a && b ? [a, b] : null; },
  };
  // The sector's own animal decides the first bond when it can: something to ride, or something that hunts in packs.
  const beast = all.find((p) => p.beast && own(p));
  const order = [];
  if (beast && def(beast).rideable) order.push('rider'); else if (beast && def(beast).info?.pack) order.push('pack');
  const rest = ['ward', 'mend', 'avenger', 'cover', 'combo', 'pack', 'rider'];
  for (let i = rest.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [rest[i], rest[j]] = [rest[j], rest[i]]; }
  for (const t of rest) if (!order.includes(t)) order.push(t);
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
        else if (type === 'ward' || type === 'mend') dx = side * (q.role ? far : far + 230); // the warder or mender hangs back behind its charge
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

function buildSectors(seed, r, M) {
  const N = M.sectors, sprint = M.id === 'sprint';
  // The Forgemaster keeps one of sectors II to V, the Twins one of VI and VII, the Cartographer one of
  // VIII and IX. A sprint has room for one of the three, in its middle sector.
  let forge = 1 + ((r() * 4) | 0), twins = 5 + ((r() * 2) | 0), carto = 7 + ((r() * 2) | 0);
  if (sprint) { const k = (forge + twins + carto) % 3; forge = k === 0 ? 1 : -1; twins = k === 1 ? 1 : -1; carto = k === 2 ? 1 : -1; }
  const sectors = [], used = sprint ? {} : { causeway: 1, foundry: 1 }, hues = [...HUES];
  // Wings are drawn from the families used least so far, so a run visits all of them.
  const draw = (bar) => {
    const ok = FAMILIES.filter((f) => !bar.includes(f));
    const least = Math.min(...ok.map((f) => used[f] || 0));
    const f = pick(r, ok.filter((x) => (used[x] || 0) === least));
    used[f] = (used[f] || 0) + 1;
    return f;
  };
  let last = sprint ? null : 'foundry';
  for (let s = 0; s < N; s++) {
    const school = s === 0 && !sprint;
    let wings;
    if (school) wings = ['causeway', 'foundry'];
    else {
      const b = s === forge ? 'foundry' : s === N - 1 ? 'hall' : null;
      const a = draw([last, b]);
      wings = [a, b || draw([a])];
    }
    last = wings[1];
    const name = school ? 'The Threshold' : s === N - 1 ? 'The Crown' : `The ${pick(r, SECTOR_ADJ)} ${pick(r, SECTOR_NOUN)}`;
    // `q` is the sector's place in the roster: which strains, animal, champion and keeper it uses.
    sectors.push({ i: s, q: sprint ? s + 1 : s, school, name, wings, hue: school ? 0 : hues.splice((r() * hues.length) | 0, 1)[0], forge: s === forge, twins: s === twins, carto: s === carto });
  }
  // No two sectors share a name.
  for (let s = 1; s < N - 1; s++) while (sectors.some((o, i) => i < s && o.name === sectors[s].name)) sectors[s].name = `The ${pick(r, SECTOR_ADJ)} ${pick(r, SECTOR_NOUN)}`;
  return sectors;
}

function buildFloor(n, seed, D, roster, sectors, plan, M) {
  const si = sectorOf(n), pos = n - si * PER, S = sectors[si], r = makeRng(hash32(seed, n * 7919));
  // `s` is the roster sector, `d` the depth that sets how hard the floor hits, and `e` the sector that
  // depth belongs to on the long climb. On the climb all three agree with the floor number.
  const s = S.q, d = depthOf(M.id, n), e = Math.max(0, Math.floor((d - 1) / PER)), last = n === M.floors;
  const kind = plan[si][pos - 1], school = S.school ? SCHOOL[pos - 1] : null;
  const pool = poolFor(s, pos, roster, S.school);
  const attackers = Math.min(4, (e < 4 ? 2 : e < 8 ? 3 : 4) + D.attackers);
  const eliteChance = S.school ? 0 : Math.min(0.5, (0.1 + 0.045 * e) * D.elite);
  // Bonds this floor's enemies may form: the sector's own once introduced, and older ones now and then.
  const rules = [];
  for (let q = 1; q <= s; q++) roster.rules[q].forEach((rule, i) => { if (!(q === s && pos < (i ? 6 : 4))) rules.push({ ...rule, w: q === s ? 3 : 1 }); });
  const opts = { max: maxPerWave(e), eliteChance, attackers, floor: n, rules, bondChance: S.school ? 0 : Math.min(0.75, 0.3 + 0.05 * e) };
  const budget = (w) => Math.max(2, waveBudget(d, w) + D.budget);
  const family = S.wings[pos <= 5 ? 0 : 1];
  // A build grows faster than the floors do once shops, rooms and bonus cards are counted, so from the
  // fifth sector the tower pushes back harder, and harder again in the last three.
  const late = 1 + Math.max(0, d - 40) * 0.004 + Math.max(0, d - 70) * 0.011;
  const fl = { n, sector: si, pos, kind, depth: +d.toFixed(2), arena: family, arenaSeed: hash32(seed, n) || 1, hue: S.hue, music: 'combat', boss: null, anomaly: null, terrain: null, reward: 'augment', waves: [],
    dmg: +(D.dmg * (1 + 0.014 * (d - 1) + 0.0002 * (d - 1) ** 2) * late).toFixed(3), hp: +(D.hp * (1 + 0.028 * (d - 1) + 0.00035 * (d - 1) ** 2) * (1 + (late - 1) * 0.6)).toFixed(3), rate: +(1 + 0.014 * e).toFixed(3), cd: +(D.cd * Math.max(0.68, 1 - 0.035 * e)).toFixed(3),
    heal: D.heal, restart: D.restart };
  const places = PLACES[family];
  fl.title = school ? school.title : places[(hash32(seed, si * 31 + (pos <= 5 ? 0 : 7)) + pos) % places.length];
  let tag = school ? school.sub : S.name;

  if (kind === 'boss') {
    const boss = last ? 'proctor' : S.forge ? 'forgemaster' : S.twins ? 'twins' : S.carto ? 'cartographer' : roster.wardens[s];
    const def = roster.defs[boss];
    fl.boss = boss; fl.music = boss === 'forgemaster' || (def && r() < 0.4) ? 'boss2' : 'boss'; fl.reward = last ? null : 'legend';
    fl.waves.push({ spawns: [{ kind: boss, dx: 560, t: 0 }], attackers: 1, hint: HINTS[boss] || (si === 0 ? HINTS.warden : null) });
    if (boss === 'forgemaster') { fl.title = 'THE ANVIL'; tag = 'Keeper of the Forge'; fl.arenaSeed = 0; fl.hue = 0; }
    else if (boss === 'proctor') { fl.title = 'EXAMINATION HALL'; tag = 'The Proctor'; fl.arenaSeed = 0; fl.hue = 0; }
    else if (boss === 'twins') {
      // Two bodies, one life: they arrive on either side.
      fl.title = 'THE MIRRORED COURT'; tag = 'The Twins'; fl.boss = 'twinA';
      fl.waves[0] = { spawns: [{ kind: 'twinA', dx: 520, t: 0, g: 0, role: 0 }, { kind: 'twinB', dx: -520, t: 0, g: 0, role: 1 }], groups: [{ type: 'twins', n: 2 }], attackers: 1, hint: HINTS.twins };
    } else if (boss === 'cartographer') {
      fl.title = 'THE DRAWING ROOM'; tag = 'The Cartographer'; fl.terrain = { plats: [], vents: [], walls: true };
      // It was made for a build of seventy cards. A sprint meets it with twenty, so it comes in lighter.
      if (M.id === 'sprint') { fl.hp = +(fl.hp * 0.62).toFixed(3); fl.dmg = +(fl.dmg * 0.75).toFixed(3); }
    }
    else tag = def.title;
  } else if (kind === 'champion') {
    fl.boss = roster.champions[s]; fl.music = 'boss2'; fl.reward = 'power';
    fl.waves.push({ spawns: [{ kind: fl.boss, dx: 540, t: 0 }], attackers: 2, hint: si === 0 ? HINTS.champion : null });
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
    fl.waves.push(generateWave(cheap, budget(1) * 1.5, r, { ...opts, max: Math.min(12, 8 + Math.floor(e / 2)), eliteChance: 0, attackers: Math.min(4, attackers + 1), quick: true }));
    fl.reward = 'rare';
  } else if (kind === 'elites') {
    fl.waves.push(generateWave(pool.filter((p) => p.base !== 'initiate' && p.base !== 'drone'), budget(1) * 1.2, r, { ...opts, max: Math.min(4, opts.max), allElite: true }));
    fl.reward = 'rare';
  } else if (kind === 'duel') {
    // Two of the sector's strongest fighters, and nothing else. Brutes are left out: two at once is a wall, not a duel.
    const top = [...pool].filter((p) => p.base !== 'brute').sort((a, b) => b.cost - a.cost).slice(0, 4).map((p) => ({ ...p, cap: 1 }));
    fl.waves.push(generateWave(top, 99, r, { ...opts, max: 2, allElite: e >= 4, attackers: 2 }));
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
    if (n === (S.school || si ? 17 : 7) && !fl.waves[0].hint) fl.waves[0].hint = HINTS.elite;
  }
  if (EVENT_NAME[kind]) tag = EVENT_NAME[kind];

  // Now and then a floor bends a rule.
  const teaching = kind === 'intro' || kind === 'beast' || kind === 'bond';
  if (!S.school && !fl.boss && !teaching && r() < 0.17) {
    fl.anomaly = pick(r, Object.keys(ANOMALIES));
    const first = fl.waves[0];
    if (!first.hint) first.hint = `ANOMALY: ${ANOMALIES[fl.anomaly].name}. ${ANOMALIES[fl.anomaly].text}`;
  }
  // Terrain: light bridges to stand on, vents that erupt on a timer, walls that shock. Positions are
  // fractions of the arena's half width, because arenas differ in size.
  if (!S.school && !fl.terrain && !last && fl.boss !== 'forgemaster' && r() < (fl.boss ? 0.3 : teaching ? 0.2 : 0.5)) {
    const T = { plats: [], vents: [], walls: false };
    const what = fl.boss ? pick(r, ['vents', 'walls']) : pick(r, ['plats', 'vents', 'walls', 'plats+vents', 'vents+walls', 'plats']);
    if (what.includes('plats')) for (const fx of [[-0.45, 0.45], [0], [-0.55, 0, 0.55], [-0.3, 0.4]][(r() * 4) | 0]) T.plats.push({ fx: +(fx + (r() - 0.5) * 0.1).toFixed(3), y: -(132 + Math.round(r() * 36)), w: 230 + Math.round(r() * 80) });
    if (what.includes('vents')) { const k = 2 + ((r() * 2) | 0); for (let i = 0; i < k; i++) T.vents.push({ fx: +(-0.7 + (1.4 * (i + 0.5)) / k + (r() - 0.5) * 0.12).toFixed(3), w: 52, period: +(5 + r() * 2.5).toFixed(2), phase: +(r() * 4).toFixed(2) }); }
    if (what.includes('walls')) T.walls = true;
    fl.terrain = T;
    const first = fl.waves[0], word = T.plats.length ? 'plats' : T.vents.length ? 'vents' : 'walls';
    if (!first.hint && e <= 3) first.hint = HINTS[word];
  }
  if (n === 1 && S.school) { fl.arenaSeed = 0; fl.hue = 0; }
  // A sprint has no school, so its first floor opens with one small wave that carries the basics, and
  // the parry lesson for a player who has not passed it. The next two floors carry two more lines on
  // their second waves, where the strain's own line is not in the way.
  if (M.id === 'sprint' && n === 1) fl.waves.unshift({ ...T('basics', 1, ['initiate', 340], ['initiate', -400, 1.4]), hint: HINTS.basics, lesson: 'parry', lessonHint: HINTS.parry });
  else if (M.id === 'sprint' && n <= 3 && fl.waves[1] && !fl.waves[1].hint) fl.waves[1].hint = HINTS[n === 2 ? 'focus' : 'launch'];
  fl.sub = `Floor ${n}  ·  ${tag}`;
  return fl;
}

// Everything about a run: its sectors, its generated enemies and every floor.
export function generateRun(seed, diff = 'normal', mode = 'climb') {
  seed = (seed >>> 0) || 1;
  const D = DIFFS[diff] || DIFFS.normal, M = MODES[mode] || MODES.climb, r = makeRng(hash32(seed, 0x5ec7));
  const sectors = buildSectors(seed, r, M);
  // Titles name the sector a champion or keeper belongs to, by its place in the roster.
  const places = Array.from({ length: SECTORS }, (_, q) => sectors.find((S) => S.q === q)?.name || 'the Spire');
  const roster = buildRoster(seed, places);
  roster.rules = [[]];
  for (let s = 1; s < SECTORS; s++) roster.rules.push(buildRules(s, roster, makeRng(hash32(seed, 0xb07d + s))));
  // The plan: which kind of floor sits at each position of each sector.
  const plan = [];
  for (const S of sectors) {
    const s = S.q;
    const p = S.school ? ['intro', 'intro', 'intro', 'intro', 'champion', 'intro', 'intro', 'intro', 'intro', 'boss']
      : ['intro', 'intro', roster.beasts[s] ? 'beast' : 'skirmish', roster.rules[s].length ? 'bond' : 'skirmish', 'champion', 'skirmish', 'skirmish', 'skirmish', 'skirmish', 'boss'];
    // One event floor per sector, on the seventh to ninth floor (the sixth introduces the second bond).
    if (!S.school) p[6 + ((r() * 3) | 0)] = pick(r, EVENTS);
    plan.push(p);
  }
  // Champions and wardens call on the cheaper fighters of their own sector.
  for (const S of sectors) {
    const cheap = (pos) => poolFor(S.q, pos, roster, S.school).filter((p) => p.cost <= 2).map((p) => p.kind);
    roster.defs[roster.champions[S.q]].adds = cheap(5);
    if (roster.wardens[S.q]) roster.defs[roster.wardens[S.q]].adds = cheap(9);
  }
  const floors = [];
  for (let n = 1; n <= M.floors; n++) floors.push(buildFloor(n, seed, D, roster, sectors, plan, M));
  for (const S of sectors) { S.strains = roster.strains[S.q]; S.champion = roster.champions[S.q]; S.boss = floors[S.i * PER + 9].boss; }
  decorate(seed, M, sectors, floors, roster);
  return { seed, diff: D.id, mode: M.id, count: M.floors, roster, sectors, floors };
}

// Surprises, objectives and challenges are laid over the finished floors, each from its own random
// stream, so adding one kind never moves the others or the waves underneath.
function decorate(seed, M, sectors, floors, roster) {
  // What can be posted on a ledge: it shoots, and it stands on something.
  const shoots = (kind) => { const d = roster.defs[kind]; return kind === 'marksman' || (!!d && (d.base === 'marksman' || (!!d.beast && !!d.ranged && !d.flying))); };
  const rs = makeRng(hash32(seed, 0x5a9e)), ro = makeRng(hash32(seed, 0x0b1e)), rc = makeRng(hash32(seed, 0xc4a1)), rt = makeRng(hash32(seed, 0x700e));
  const live = sectors.filter((S) => !S.school);
  // The Shade comes once in a sprint and three times on the climb, spread over the run. Every other
  // surprise turns up once before any repeats.
  const third = Math.ceil(live.length / 3);
  const shades = M.id === 'sprint' ? [live[1 + ((rs() * 2) | 0)].i] : [0, 1, 2].map((k) => live[Math.min(live.length - 1, k * third + ((rs() * third) | 0))].i);
  const rest = shuffle(rs, Object.keys(SURPRISES).filter((k) => k !== 'shade'));
  let k = 0, tier = 0;
  for (const S of live) {
    const at = (pos) => floors[S.i * PER + pos - 1];
    // Never on a champion's or a keeper's floor.
    const fl = at(pick(rs, [2, 3, 4, 6, 7, 8, 9]));
    fl.surprise = shades.includes(S.i) ? { type: 'shade', tier: ++tier } : { type: rest[k++ % rest.length] };
    // Objectives go on the plain skirmishes of the sector's second half.
    for (const pos of [7, 8, 9]) {
      const f = at(pos);
      if (f.kind !== 'skirmish' || f === fl || ro() > 0.7) continue;
      const type = pick(ro, ['survive', 'hunt', 'hold', 'cores']);
      const o = f.objective = { type };
      if (type === 'survive') o.time = 34 + ((ro() * 3) | 0) * 4;
      else if (type === 'hold') { o.fx = +((ro() - 0.5) * 0.7).toFixed(2); o.need = 15; }
      else if (type === 'cores') o.at = [-0.62, 0.05, 0.66].map((v) => +(v + (ro() - 0.5) * 0.12).toFixed(2));
      f.reward = 'rare'; f.sub = `Floor ${f.n}  ·  ${OBJECTIVES[type].tag}`;
      f.waves[0].hint = OBJECTIVES[type].text(o);
    }
    // About one floor in four has a shape of its own. Champions and keepers keep a plain room.
    for (let pos = 1; pos <= 9; pos++) {
      const f = at(pos);
      if (pos === 5 || rt() > 0.27) continue;
      const shape = pick(rt, ['edges', 'edges', 'edges', 'ledges', 'ledges', 'mover', 'lift', 'lift']), T = f.terrain || { plats: [], vents: [], walls: false };
      f.room = shape;
      if (shape === 'edges') f.terrain = { ...T, walls: false, pits: [{ side: -1, w: 250 + Math.round(rt() * 90) }, { side: 1, w: 250 + Math.round(rt() * 90) }] };
      else if (shape === 'ledges') {
        f.terrain = { ...T, plats: [{ fx: -0.52, y: -196, w: 300, fixed: true }, { fx: 0.52, y: -196, w: 300, fixed: true }, ...(rt() < 0.5 ? [{ fx: 0, y: -330, w: 220, fixed: true }] : [])] };
        // The floor's shooters take the high ground, one to a ledge.
        for (const w of f.waves) { let k = 0; for (const sp of w.spawns) { if (k < 2 && sp.g === undefined && shoots(sp.kind)) sp.perch = k++; } }
      } else if (shape === 'mover') f.terrain = { ...T, walls: false, plats: [{ fx: 0, y: -150, w: 260, fixed: true, amp: 0.5, period: 8, phase: +rt().toFixed(2) }], pits: [{ side: rt() < 0.5 ? -1 : 1, w: 300 }] };
      else { f.terrain = { plats: [{ fx: 0, y: -165, w: 230, fixed: true, amp: 0.28, period: 7, phase: +rt().toFixed(2) }], vents: [], walls: false, pits: [{ side: -1, w: 400 }, { side: 1, w: 400 }], lift: true }; f.title = 'FREIGHT LIFT'; }
      if (!f.waves[0].hint && S.i <= 3) f.waves[0].hint = HINTS[shape];
      if (!f.objective && !/New|Bond/.test(f.sub)) f.sub = `Floor ${f.n}  ·  ${ROOMS[shape]}`;
    }
    for (let pos = 1; pos <= 9; pos++) {
      const f = at(pos);
      if (pos === 5 || f.objective || rc() > 0.3) continue;
      const hazard = f.terrain && (f.terrain.vents.length || f.terrain.walls || f.terrain.pits?.length);
      const type = pick(rc, hazard ? ['untouched', 'swift', 'pure', 'parry', 'aerial', 'room', 'room'] : ['untouched', 'swift', 'pure', 'parry', 'aerial']);
      f.challenge = { type };
      if (type === 'swift') f.challenge.time = 16 + 5 * f.waves.reduce((n, w) => n + w.spawns.length, 0);
    }
  }
}

// The doors offered after floor `n`, or null when the way up does not split there. Before a champion
// or a keeper the choice is how to prepare; elsewhere it is how much to risk.
export function doorsFor(run, n) {
  const fl = run.floors[n - 1];
  if (!fl || n >= run.count || ![2, 4, 6, 8, 9].includes(fl.pos)) return null;
  if (run.sectors[fl.sector].school && fl.pos < 4) return null;
  const r = makeRng(hash32(run.seed, 0xd00a + n * 53));
  let types;
  if (fl.pos === 4 || fl.pos === 9) types = shuffle(r, ['rest', 'shop', 'shrine', 'armory']).slice(0, 3);
  else types = ['stair', ...shuffle(r, ['elite', 'cursed', 'unknown', r() < 0.5 ? 'shop' : 'rest']).slice(0, 2)];
  return types.map((type) => {
    const d = { type };
    if (type === 'cursed') d.curse = pick(r, Object.keys(CURSES));
    if (type === 'unknown') d.hidden = pick(r, ['gift', 'gift', 'rest', 'elite', 'shrine', 'armory']);
    return d;
  });
}

export const roman = (n) => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n - 1] || String(n);
export const seedLabel = (seed) => (seed >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(-6);
export const parseSeed = (s) => { const v = parseInt(String(s).replace(/[^0-9a-z]/gi, ''), 36); return Number.isFinite(v) && v > 0 ? v >>> 0 : 0; };
