// The build. After every floor the player drafts one augment out of three. Augments stack, and all
// of them together reduce to one flat table of modifiers (`world.mods`) that combat reads.
// Three rarities: common ones are plain numbers, rare ones add a mechanic, and legendary ones (one
// copy each, offered after sector bosses) change how a run is played.

export const baseMods = () => ({
  dmg: 1, light: 1, heavy: 1, air: 1, post: 1, taken: 1,
  maxHp: 0, speed: 1, blade: 1, dashCd: 1,
  focus: 1, pips: 0, focusRegen: 0,
  leech: 0, killHeal: 0, waveHeal: 0, orbs: 1,
  crit: 0, burn: 0, arc: 0, execute: 0, fresh: 0, rankDmg: 0,
  parryHeal: 0, riposte: 1, block: 1, dodgeTime: 0, dodgeFocus: 0,
  odTime: 0, odShield: 0, burstDmg: 0, throwDmg: 1, throwRange: 1,
  secondWind: 0, storm: 0, freeCast: 0, reap: 0,
});

const pct = (v) => `${Math.round(v * 100)}%`;
// id, name, rarity (0 common, 1 rare, 2 legendary), max stacks, text(n) for a stack count, apply(mods, n)
export const AUGMENTS = [
  { id: 'edge', name: 'Keen Edge', r: 0, max: 5, text: (n) => `All damage +${pct(0.06 * n)}`, apply: (m, n) => { m.dmg *= 1 + 0.06 * n; } },
  { id: 'vigor', name: 'Vigor', r: 0, max: 6, text: (n) => `Maximum health +${12 * n}`, apply: (m, n) => { m.maxHp += 12 * n; } },
  { id: 'flow', name: 'Flow', r: 0, max: 4, text: (n) => `Focus gained +${pct(0.15 * n)}`, apply: (m, n) => { m.focus *= 1 + 0.15 * n; } },
  { id: 'reach', name: 'Long Blade', r: 0, max: 3, text: (n) => `Blade length +${pct(0.07 * n)}`, apply: (m, n) => { m.blade *= 1 + 0.07 * n; } },
  { id: 'stride', name: 'Fleet', r: 0, max: 3, text: (n) => `Run speed +${pct(0.06 * n)}, dash recovers ${pct(0.1 * n)} sooner`, apply: (m, n) => { m.speed *= 1 + 0.06 * n; m.dashCd *= 1 - 0.1 * n; } },
  { id: 'weight', name: 'Heavy Hand', r: 0, max: 4, text: (n) => `Heavy damage +${pct(0.1 * n)}, posture damage +${pct(0.12 * n)}`, apply: (m, n) => { m.heavy *= 1 + 0.1 * n; m.post *= 1 + 0.12 * n; } },
  { id: 'tempo', name: 'Quick Cuts', r: 0, max: 4, text: (n) => `Light damage +${pct(0.08 * n)}`, apply: (m, n) => { m.light *= 1 + 0.08 * n; } },
  { id: 'skyward', name: 'Skyward', r: 0, max: 3, text: (n) => `Damage in the air +${pct(0.12 * n)}`, apply: (m, n) => { m.air *= 1 + 0.12 * n; } },
  { id: 'salve', name: 'Field Salve', r: 0, max: 3, text: (n) => `Recover ${6 * n} more health after each wave`, apply: (m, n) => { m.waveHeal += 6 * n; } },
  { id: 'leech', name: 'Leech', r: 0, max: 3, text: (n) => `Each hit returns ${(0.25 * n).toFixed(2)} health`, apply: (m, n) => { m.leech += 0.25 * n; } },
  { id: 'harvest', name: 'Harvest', r: 0, max: 3, text: (n) => `Kills return ${n} more health and drop orbs ${pct(0.3 * n)} more often`, apply: (m, n) => { m.killHeal += n; m.orbs *= 1 + 0.3 * n; } },

  { id: 'crit', name: 'Fault Line', r: 1, max: 3, text: (n) => `${pct(0.08 * n)} of hits strike twice as hard`, apply: (m, n) => { m.crit += 0.08 * n; } },
  { id: 'burn', name: 'Cinder Edge', r: 1, max: 3, text: (n) => `Hits set enemies alight: ${4 * n} damage a second for two seconds`, apply: (m, n) => { m.burn += 4 * n; } },
  { id: 'arc', name: 'Live Wire', r: 1, max: 3, text: (n) => `Every fourth hit arcs to another enemy for ${10 * n}`, apply: (m, n) => { m.arc += 10 * n; } },
  { id: 'counter', name: 'Counterweight', r: 1, max: 3, text: (n) => `A parry heals ${2 * n}. Ripostes deal +${pct(0.25 * n)}`, apply: (m, n) => { m.parryHeal += 2 * n; m.riposte *= 1 + 0.25 * n; } },
  { id: 'well', name: 'Deep Well', r: 1, max: 2, text: (n) => `${n} more focus pip${n > 1 ? 's' : ''}`, apply: (m, n) => { m.pips += n; } },
  { id: 'grace', name: 'Coup de Grace', r: 1, max: 2, text: (n) => `Enemies under ${pct(0.06 + 0.06 * n)} health die to any hit. Bosses are exempt`, apply: (m, n) => { m.execute = 0.06 + 0.06 * n; } },
  { id: 'after', name: 'Afterimage', r: 1, max: 2, text: (n) => `Perfect dodges slow time ${(0.6 * n).toFixed(1)} s longer and give ${20 * n} more focus`, apply: (m, n) => { m.dodgeTime += 0.6 * n; m.dodgeFocus += 20 * n; } },
  { id: 'guard', name: 'Iron Guard', r: 1, max: 2, text: (n) => `Blocking builds ${pct(0.25 * n)} less posture, and you take ${pct(0.05 * n)} less damage`, apply: (m, n) => { m.block *= 1 - 0.25 * n; m.taken *= 1 - 0.05 * n; } },
  { id: 'sustain', name: 'Sustained', r: 1, max: 2, text: (n) => `Overdrive lasts ${(1.5 * n).toFixed(1)} s longer`, apply: (m, n) => { m.odTime += 1.5 * n; } },
  { id: 'shock', name: 'Aftershock', r: 1, max: 2, text: (n) => `Burst deals ${18 * n} damage`, apply: (m, n) => { m.burstDmg += 18 * n; } },
  { id: 'return', name: 'Returning Edge', r: 1, max: 2, text: (n) => `The thrown saber deals +${pct(0.8 * n)} and flies ${pct(0.25 * n)} farther`, apply: (m, n) => { m.throwDmg *= 1 + 0.8 * n; m.throwRange *= 1 + 0.25 * n; } },
  { id: 'poise', name: 'Poise', r: 1, max: 2, text: (n) => `Each style rank adds +${pct(0.04 * n)} damage`, apply: (m, n) => { m.rankDmg += 0.04 * n; } },
  { id: 'improv', name: 'Improviser', r: 1, max: 2, text: (n) => `Fresh moves deal +${pct(0.12 * n)} more`, apply: (m, n) => { m.fresh += 0.12 * n; } },

  { id: 'wind', name: 'Second Wind', r: 2, max: 1, text: () => 'Once per floor, a killing blow leaves you at 30% health and bursts everything back', apply: (m) => { m.secondWind = 1; } },
  { id: 'unbroken', name: 'Unbroken', r: 2, max: 1, text: () => 'Overdrive survives the first hit you take', apply: (m) => { m.odShield = 1; } },
  { id: 'storm', name: 'Stormcaller', r: 2, max: 1, text: () => 'Every kill calls lightning down on the nearest enemy for 28', apply: (m) => { m.storm = 28; } },
  { id: 'spring', name: 'Wellspring', r: 2, max: 1, text: () => 'Focus refills by itself, slowly', apply: (m) => { m.focusRegen = 5; } },
  { id: 'conduit', name: 'Conduit', r: 2, max: 1, text: () => 'The first power you use in each wave is free', apply: (m) => { m.freeCast = 1; } },
  { id: 'colossus', name: 'Colossus', r: 2, max: 1, text: () => 'Maximum health +40. You take 12% less damage', apply: (m) => { m.maxHp += 40; m.taken *= 0.88; } },
  { id: 'whet', name: 'Whetstone', r: 2, max: 1, text: () => 'All damage +20%', apply: (m) => { m.dmg *= 1.2; } },
  { id: 'reaper', name: 'Reaper', r: 2, max: 1, text: () => 'Kills heal 3 more and refill a fifth of a focus pip', apply: (m) => { m.killHeal += 3; m.reap = 20; } },
];
export const AUG = Object.fromEntries(AUGMENTS.map((a) => [a.id, a]));
export const RARITY = ['COMMON', 'RARE', 'LEGENDARY'];
export const RARITY_COL = ['#9fb4c8', '#56e9ff', '#ffd36b'];

// Reduce a build ({ id: stacks }) to the modifier table.
export function buildMods(build) {
  const m = baseMods();
  for (const a of AUGMENTS) { const n = build[a.id] || 0; if (n) a.apply(m, n); }
  return m;
}

// Three distinct augments the build can still take. `tier` 2 offers legendaries first; otherwise
// rares turn up more often the higher the floor. `r` is a random function returning [0, 1).
export function draftAugments(build, r, tier = 0, floor = 1) {
  const open = AUGMENTS.filter((a) => (build[a.id] || 0) < a.max);
  const out = [];
  const take = (pool) => {
    const left = pool.filter((a) => !out.includes(a));
    if (!left.length) return false;
    out.push(left[(r() * left.length) | 0]);
    return true;
  };
  if (tier >= 2) for (let i = 0; i < 3; i++) take(open.filter((a) => a.r === 2));
  const rareChance = Math.min(0.55, 0.22 + floor * 0.004) + (tier === 1 ? 0.3 : 0);
  while (out.length < 3) {
    const want = r() < rareChance ? 1 : 0;
    if (!take(open.filter((a) => a.r === want)) && !take(open.filter((a) => a.r < 2)) && !take(open)) break;
  }
  return out.map((a) => a.id);
}

export const augmentText = (id, build) => AUG[id].text((build[id] || 0) + 1);
