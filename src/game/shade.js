// Fighters that use the player's own moves.
//   The Shade   a dark copy of the player: the weapon they hold now and the powers they have taken,
//               turned against them. It runs on the sector bosses' brain with a kit built on the spot,
//               so it is a different fight every time it appears.
//   Climbers    other people on the way up, with a blade of their own. A rival fights everyone in the
//               room; a freed captive fights for the player.
// The player's moves are far too quick to read from the other side, so a foe never uses them as they
// are. It uses copies: the same poses played slower, behind a held wind-up and a flash.
import { MOVES, registerMove, fairTells, chainMove, stripEvents } from './moves.js';
import { ENEMIES, wardenCtrl, initAi, weighted, mercy } from './enemies.js';
import { FORMS, FORM_IDS } from './forms.js';
import { rand, rng, clamp } from '../core/math.js';

const R4 = (v) => Math.round(v * 1e4) / 1e4;

// An enemy's copy of one of the player's ground moves. `red` makes it a blow that cannot be blocked.
export function foeCopy(sid, o = {}) {
  const s = MOVES[sid];
  if (!s || s.air || s.plunge || !s.hits.length) return null;
  // `first` is when the first cut may land at the earliest: quick moves get a longer wind-up to reach it.
  const k = o.k ?? 1.22, red = !!o.red, first = o.first ?? 0.34, lead = R4(Math.max(o.lead ?? 0.26, first - s.hits[0].t0 * k));
  const id = `sh${red ? '!' : ':'}${sid}:${Math.round(first * 100)}`;
  if (MOVES[id]) return id;
  const T = (t) => R4(lead + t * k), end = R4(T(s.dur) + 0.18), last = s.hits[s.hits.length - 1];
  const m = {
    dur: end, tier: s.tier, src: sid,
    // The first pose is held through the lead, which is the wind-up the player reads.
    keys: [[0, s.keys[0][1]], ...s.keys.map(([t, p, e]) => [T(t), p, e])],
    hits: s.hits.map((h) => {
      const c = { ...h, t0: T(h.t0), t1: T(h.t1), dmg: Math.max(2, Math.round(h.dmg * (o.dmg ?? 1))), post: Math.round((h.post ?? h.dmg) * 0.8) };
      delete c.unblockable; delete c.guardBreak;
      if (red) c.unblockable = true;
      return c;
    }),
    step: s.step.map(([a, b, v]) => [T(a), T(b), v / k]),
    ev: [[R4(Math.max(0.02, T(s.hits[0].t0) - 0.26)), 'tele', red ? 1 : 0],
      // A weapon's own mechanic rides on `form` events (the gauntlets' blast), so those are kept too.
      ...s.ev.filter((e) => e[1] === 'sfx' || e[1] === 'form' || (e[1] === 'fx' && e[2] !== 'riposteLine')).map(([t, type, arg]) => [T(t), type, arg])],
    punish: [T(last.t1), end],
  };
  for (let i = 1; i < m.hits.length; i++) if (m.hits[i].t0 - m.hits[i - 1].t1 > 0.16) m.ev.push([R4(m.hits[i].t0 - 0.15), 'tele', red ? 1 : 0]);
  return fairTells(m) ? registerMove(id, m) : null;
}

// Several copies joined into one string. Falls back to the longest prefix that can be joined.
function chain(ids) {
  let cur = ids[0];
  for (let i = 1; i < ids.length && cur; i++) { const nx = ids[i] && chainMove(cur, ids[i]); if (!nx) break; cur = nx; }
  return cur;
}

// What each of the player's powers becomes in a foe's hands. Stasis has no entry: freezing the player
// is never fair.
const POWER_KIT = {
  throw: (K) => K.add('d_throw', 280, 720, 2),
  crescent: (K) => K.add('p_crescent', 240, 900, 3),
  arc: (K) => K.add(stripEvents('fm_erupt', ['heat', 'vent']), 220, 900, 2),
  nova: (K) => K.add('p_cyclone', 0, 230, 2),
  flash: (K) => K.specials.push('blink'),
  judgment: (K) => K.specials.push('skyfall'),
  mirror: (K) => { K.echo = 1; },
  mend: (K) => K.heals.push(0.35),
};

// A boss kit (see wardenCtrl) from a weapon form and a list of powers. `tier` is how many times the
// player has met this foe: it adds a longer string, a blow that cannot be blocked, and more powers.
export function climberKit(form, powers, tier) {
  const slot = (id) => form.moves[id] || id;
  const L = [slot('L1')];
  while (L.length < (tier >= 2 ? 4 : 3)) { const nx = MOVES[L[L.length - 1]]?.next?.light; if (!nx || L.includes(nx)) break; L.push(nx); }
  const first = foeCopy(L[0]), tail = L.slice(1).map((id) => foeCopy(id, { lead: 0.12, first: 0.24 }));
  // How far away it starts a string: the weapon's own working distance where it names one.
  const reach = Math.round(clamp(form.bot?.reach ? form.bot.reach + 70 : form.blade.len * (form.blade.double ? 2.6 : 2.3), 130, 330));
  const K = { school: 'shade', moves: [], specials: [], heals: [], echo: 0, doubleAt: 0, hold: [Math.round(reach * 0.55), Math.round(reach * 1.1)], guard: 0.2 + 0.06 * tier,
    phases: tier >= 2 ? [0.6, 0.3] : [0.5], phaseText: ['It stops copying you and starts thinking', 'Only one of you leaves'] };
  K.add = (id, min, max, w, o) => { if (id && !K.moves.some((m) => m.id === id)) K.moves.push({ id, min, max, w, ...o }); };
  K.add(chain([first, tail[0]]), 0, reach, 3);
  K.add(chain([first, ...tail]), 0, reach, 3, { dash: true });
  K.add(foeCopy(slot('H1'), { red: tier >= 2 }), 0, reach + 30, 2);
  K.add(foeCopy(slot('DA'), { lead: 0.2, first: 0.3 }), reach, 560, 3, { dash: true });
  K.add(chain([first, foeCopy(slot('LAUNCH'), { lead: 0.12, first: 0.24 })]), 0, reach - 20, 2, { phase: 2 });
  if (!K.moves.length) K.add('p_verdict', 0, 200, 3);
  let n = 0;
  for (const id of powers) { if (n >= 1 + tier) break; if (POWER_KIT[id]) { POWER_KIT[id](K); n++; } }
  if (tier >= 2 && !K.specials.includes('blink')) K.specials.push('blink');
  K.strikes = [first, foeCopy(slot('H1'))].filter(Boolean);
  if (!K.strikes.length) K.specials = K.specials.filter((sp) => sp !== 'blink');
  delete K.add;
  return K;
}

const BODY = { ...ENEMIES.proctor, noRagdoll: true, guard: undefined, adaptAt: 0, counter: undefined, armor: 2, tier: 2, posture: 150, postureTaken: 0.6, parryPosture: 40, parryRecoil: 0.75,
  breakDur: 2.6, getup: 0.9, deco: undefined, ninja: true, lineW: 5.5, stance: undefined, ribbonJoint: undefined, scale: 1.06, runSpeed: 300 };

// The brain of the Shade: the sector bosses', except that it keeps its distance while its blade is in the air.
function shadeCtrl(f, world, dt) {
  if (!f.armed && f.state === 'free' && f.onGround) {
    const pl = world.player, want = pl.x >= f.x ? 1 : -1;
    world.boss = f; f.facing = want;
    if (f.x > world.minX + 90 && f.x < world.maxX - 90) f.moveX = -want * 0.8;
    return;
  }
  wardenCtrl(f, world, dt);
}

const SHADE_TITLE = ['It has your blade', 'It has been watching', 'It knows everything you know'];
// Definition of the Shade for the player as they are right now.
export function makeShade(world, tier = 1) {
  const F = world.form, kit = climberKit(F, world.powers, tier);
  return { ...BODY, kind: 'shade', name: 'YOUR SHADE', title: SHADE_TITLE[Math.min(2, tier - 1)], boss: true, shade: tier, ctrl: shadeCtrl,
    hp: 380 + 70 * tier, dmg: 0.9 + 0.05 * tier, color: '#ff2e6e', color2: '#c84cff', color3: '#ffffff', outline: '#ff9ab8', blade: F.blade,
    ribbons: [{ n: 11, seg: 6.5, color: '#ff2e6e', width: 5, oy: 3 }], kit, marks: kit.phases, form: F.id };
}

const NAMES = ['KESTREL', 'ASH', 'NINE', 'MARROW', 'VESPER', 'TALLOW', 'ORRIN', 'SABLE', 'WREN', 'IONE', 'CASK', 'THRUSH'];
const HUES = ['#ffd36b', '#7dffb0', '#c69bff', '#ff9a4a', '#9fd0ff', '#ff8fd0'];
// Another climber, with a weapon form of their own. `friend` is a freed captive: tougher blows, fewer hits taken.
export function makeClimber(world, friend = false) {
  const others = FORM_IDS.filter((id) => id !== world.formId), F = FORMS[others[(rng() * others.length) | 0] || 'saber'];
  const color = friend ? '#b9f6ff' : HUES[(rng() * HUES.length) | 0], kit = climberKit(F, [], 1);
  return { ...BODY, kind: friend ? 'ally' : 'rival', name: NAMES[(rng() * NAMES.length) | 0], boss: false, climber: true, ctrl: duelCtrl, armor: 1, noRagdoll: false,
    hp: friend ? 220 : 240, dmg: friend ? 2.6 : 0.8, color, outline: '#ffffff', blade: F.blade, scale: 1, runSpeed: 330,
    ribbons: [{ n: 9, seg: 6.5, color, width: 5, oy: 3 }], kit, form: F.id };
}

// A plain brain for climbers. The world hands it its target in `world.player` (see World.foeOf), so
// the same code fights the player, an enemy, or whoever is nearest.
export function duelCtrl(f, world, dt) {
  const ai = f.ai, pl = world.player, K = f.def.kit;
  if (!ai.init) initAi(f, { cd: 0.9 });
  ai.cd -= dt; ai.guardT -= dt;
  if (f.state === 'guard') { if (ai.guardT <= 0) f.setState('free'); return; }
  if (f.state !== 'free' || !f.onGround || !pl || pl.dead || pl === f) return;
  const dx = pl.x - f.x, dist = Math.abs(dx), want = dx >= 0 ? 1 : -1;
  f.facing = want;
  if (pl.state === 'attack' && pl.atkSerial !== ai.seenAtk && dist < 200) {
    ai.seenAtk = pl.atkSerial;
    if (rng() < K.guard) { f.setState('guard'); ai.guardT = rand(0.4, 0.8); return; }
  }
  if (ai.cd > 0 || mercy(pl)) {
    if (dist > K.hold[1]) f.moveX = want * 0.9; else if (dist < K.hold[0] && f.x > world.minX + 90 && f.x < world.maxX - 90) f.moveX = -want * 0.5;
    return;
  }
  const opts = K.moves.filter((m) => dist >= (m.min ?? 0) && dist <= m.max);
  if (!opts.length) { f.moveX = want; return; }
  const pick = weighted(opts, ai.last);
  ai.last = pick.id;
  if (pick.dash && dist > 170) { f.vx = want * clamp((dist - 120) * 5.5, 0, 1100); world.fx.ghost(f, f.color, 0.3); world.sfx('dash', f.x); }
  f.startMove(pick.id);
  ai.cd = MOVES[pick.id].dur + rand(0.5, 1.1) * (ai.cdMul || 1);
}
