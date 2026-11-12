// Run generator. A run is ten floors built from one seed: the first appearance of each enemy is a
// hand-authored teaching wave, everything else is drawn from a threat budget under a few rules, so
// no two runs are the same but every run is fair. Pure functions, no simulation state.
import { makeRng, hash32 } from '../core/math.js';

export const FLOORS = 10;
// Floor on which each enemy first appears, and what it costs the wave budget.
export const UNLOCK = { initiate: 1, marksman: 2, bulwark: 3, duelist: 4, brute: 4, lancer: 6, wraith: 7, drone: 8 };
export const COST = { initiate: 1, drone: 1.3, marksman: 1.6, bulwark: 2.6, lancer: 2.6, wraith: 2.8, duelist: 3.6, brute: 5 };
const RANGED = { marksman: 1, drone: 1 };
const CAP = { brute: 1, duelist: 2, wraith: 2, bulwark: 2, lancer: 2, marksman: 2, drone: 3 };
export const MAX_PER_WAVE = 5;
const FLANKERS = { initiate: 1, duelist: 1 };
const ELITES = ['swift', 'armored', 'volatile'];

const HINTS = {
  basics: 'J light  ·  K heavy  ·  SPACE jump  ·  SHIFT dash      Chain lights, then finish with a heavy',
  parry: 'Hold L to guard. Tap it just before a hit lands to PARRY, then strike to riposte',
  marksman: 'Marksmen aim with a red line. Parry or cut the bolt and it flies back at them',
  bulwark: 'Shields shrug off light attacks. Hold K to charge a heavy, or dash through and hit the back',
  duelist: 'Duelists read repetition. When you see ADAPTED, change your attack or it will be turned aside',
  brute: 'A red flash cannot be blocked. Dash through it, then punish the long recovery',
  launch: 'S + K launches. Follow them up: air lights, then K to spike them back down',
  forgemaster: 'Watch the hammer. It can be parried until it glows white. When it vents steam, strike',
  lancer: 'Lancers out-reach you and skewer jumps. Parry the thrust, then dash in close where the pike is useless',
  wraith: 'Wraiths vanish and reappear at your back. Listen for the second blink, turn, and parry',
  drone: 'Drones hover out of reach. Jump at them, launch into them, or parry the dive. Any hit drops them',
  focus: 'Focus has three uses. I throws your saber. I while you are being hit bursts you free. O with a full meter is OVERDRIVE',
  elite: 'Elites carry an aura: gold is fast, blue will not flinch, orange bursts when it dies. Step back from orange',
  gauntlet: 'Everything the Spire has. Keep moving, keep changing attacks',
  proctor: 'It learns your habits. When it kneels to heal, hit it. I throws your saber across the room',
};

// [kind, x offset from the player, delay]
const T = (hint, attackers, ...spawns) => ({ hint, attackers, spawns: spawns.map(([kind, dx, t = 0]) => ({ kind, dx, t })) });
const FLOOR_DEFS = [
  { arena: 'causeway', title: 'SPIRE CAUSEWAY', sub: 'The Approach', music: 'combat', waves: 3,
    teach: [T('basics', 1, ['initiate', 380], ['initiate', -420, 1.6]), T('parry', 2, ['initiate', 360], ['initiate', -360, 0.8], ['initiate', 520, 2.4])] },
  { arena: 'causeway', title: 'RAIN GALLERY', sub: 'Sight Lines', music: 'combat', waves: 3,
    teach: [T('marksman', 2, ['initiate', 360], ['marksman', 640, 1.2], ['initiate', -380, 2.2])] },
  { arena: 'causeway', title: 'SIGNAL BRIDGE', sub: 'The Wall', music: 'combat', waves: 3,
    teach: [T('bulwark', 2, ['bulwark', 380], ['initiate', -400, 1.2], ['initiate', 540, 2.6])] },
  { arena: 'foundry', title: 'FOUNDRY NINE', sub: 'The Crucible', music: 'combat', waves: 3,
    teach: [T('duelist', 2, ['duelist', 420], ['initiate', -440, 1.8]), T('brute', 2, ['brute', 500], ['marksman', -620, 2.4])] },
  { arena: 'foundry', title: 'THE ANVIL', sub: 'Keeper of the Forge', music: 'boss2', boss: 'forgemaster', waves: 1,
    teach: [T('forgemaster', 1, ['forgemaster', 560])] },
  { arena: 'foundry', title: 'SLAG WORKS', sub: 'Reach', music: 'combat', waves: 3,
    teach: [T('lancer', 2, ['lancer', 440], ['initiate', -420, 1.4], ['lancer', -560, 3])] },
  { arena: 'hall', title: 'HALL OF ECHOES', sub: 'Unseen', music: 'combat', waves: 3,
    teach: [T('wraith', 2, ['wraith', 460], ['initiate', -400, 1.2], ['initiate', 520, 2.4])] },
  { arena: 'hall', title: 'THE LONG GALLERY', sub: 'Overhead', music: 'combat', waves: 3,
    teach: [T('drone', 2, ['drone', 320], ['drone', -360, 0.8], ['bulwark', 460, 1.8])] },
  { arena: 'hall', title: 'ANTECHAMBER', sub: 'The Last Door', music: 'combat', waves: 4, teach: [] },
  { arena: 'hall', title: 'EXAMINATION HALL', sub: 'The Proctor', music: 'boss', boss: 'proctor', waves: 1,
    teach: [T('proctor', 1, ['proctor', 560])] },
];
const HINT_FOR_GENERATED = { 2: 'focus', 4: 'launch', 8: 'elite', 9: 'gauntlet' };

export const waveBudget = (floor, wave) => 2.2 + floor * 0.85 + wave * 0.9;

function generateWave(floor, wave, r) {
  let budget = waveBudget(floor, wave);
  const pool = Object.keys(UNLOCK).filter((k) => UNLOCK[k] <= floor);
  const count = {}, picks = [];
  let ranged = 0;
  const eliteChance = floor >= 9 ? 0.4 : floor >= 8 ? 0.22 : 0;
  while (picks.length < MAX_PER_WAVE) {
    const ok = pool.filter((k) => COST[k] <= budget && (count[k] || 0) < (CAP[k] ?? 9) && !(RANGED[k] && ranged >= 2));
    if (!ok.length) break;
    // Newer enemies are a little more likely, so later floors feel like later floors.
    let total = 0;
    const w = ok.map((k) => { const v = 1 + UNLOCK[k] * 0.22; total += v; return v; });
    let x = r() * total, kind = ok[0];
    for (let i = 0; i < ok.length; i++) { x -= w[i]; if (x <= 0) { kind = ok[i]; break; } }
    let elite = null;
    if (kind !== 'initiate' && kind !== 'drone' && budget >= COST[kind] + 1 && r() < eliteChance) { elite = ELITES[(r() * ELITES.length) | 0]; budget -= 1; }
    budget -= COST[kind]; count[kind] = (count[kind] || 0) + 1; if (RANGED[kind]) ranged++;
    picks.push({ kind, elite });
  }
  if (picks.length < 2) picks.push({ kind: 'initiate', elite: null });
  // Heaviest first, so the player sees the main threat arrive, then its support.
  picks.sort((a, b) => COST[b.kind] - COST[a.kind]);
  let side = r() < 0.5 ? 1 : -1, t = 0;
  const spawns = picks.map((p, i) => {
    const far = RANGED[p.kind] ? 560 + r() * 160 : 340 + r() * 190;
    const roll = r();
    const temper = roll < 0.3 ? 'aggressive' : roll < 0.55 ? 'cautious' : roll < 0.8 && FLANKERS[p.kind] && floor >= 3 ? 'flank' : null;
    const s = { kind: p.kind, dx: Math.round(side * far), t: +t.toFixed(2), elite: p.elite, temper };
    side = -side; t += 0.7 + r() * 0.8 + (i === 0 ? 0.3 : 0);
    return s;
  });
  return { spawns, attackers: floor >= 9 ? 3 : 2, hint: null };
}

// Build floor `n` (1-based) of the run with the given seed.
export function generateFloor(n, seed) {
  const def = FLOOR_DEFS[n - 1], r = makeRng(hash32(seed, n * 7919));
  const waves = [];
  for (let w = 0; w < def.waves; w++) {
    if (w < def.teach.length) { const t = def.teach[w]; waves.push({ spawns: t.spawns.map((s) => ({ ...s })), attackers: t.attackers, hint: HINTS[t.hint] }); }
    else waves.push(generateWave(n, w, r));
  }
  const gen = waves.find((w) => !w.hint);
  if (gen && HINT_FOR_GENERATED[n]) gen.hint = HINTS[HINT_FOR_GENERATED[n]];
  // Floors 1, 4 and 10 keep the canonical look of their arena; the rest are seeded variants.
  const canonical = n === 1 || n === 4 || n === 10;
  return { n, arena: def.arena, arenaSeed: canonical ? 0 : hash32(seed, n) || 1, title: def.title, sub: `Floor ${roman(n)}  ·  ${def.sub}`, music: def.music, boss: def.boss || null,
    dmg: +(1 + (n - 1) * 0.05).toFixed(3), waves };
}

export const generateRun = (seed) => Array.from({ length: FLOORS }, (_, i) => generateFloor(i + 1, seed));
export const roman = (n) => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n - 1] || String(n);
export const seedLabel = (seed) => (seed >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(-6);
export const parseSeed = (s) => { const v = parseInt(String(s).replace(/[^0-9a-z]/gi, ''), 36); return Number.isFinite(v) && v > 0 ? v >>> 0 : 0; };
