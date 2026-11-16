// What carries over between runs: a record of everything met and beaten, kept in the browser, and the
// feats read from it that earn boons. The simulation knows nothing of it. The shell passes it the
// director's events (`note`), and the codex screen reads `data`.
import { UNLOCK, SURPRISES, OBJECTIVES, CHALLENGES } from '../game/gen.js';
import { BEAST_PLANS } from '../game/beasts.js';
import { FORM_IDS } from '../game/forms.js';

const KEY = 'sticksaber.meta', V = 2;
const TABLES = ['kills', 'bosses', 'surprises', 'feats', 'objectives', 'forms', 'best', 'seen', 'clears', 'done'];
const COUNTS = ['runs', 'wins', 'floors', 'shades'];
// `feats` counts floor challenges met, by challenge type. `done` latches finished meta feats (FEATS
// below), so one stays finished even if what it counts is later reshaped. `seen` files what was met
// but not beaten, under the same keys as `kills` and `bosses`. `clears` counts wins per `mode:diff`,
// because `best` keeps only the highest-scoring run and a later loss can outscore a win.
const blank = () => ({ v: V, kills: {}, bosses: {}, surprises: {}, feats: {}, objectives: {}, forms: {}, best: {}, seen: {}, clears: {}, done: {}, runs: 0, wins: 0, floors: 0, shades: 0 });

// The base enemy types and the keepers, in the order the codex shows them. Generated keepers are
// filed by their school; strains.js keeps the schools to itself, so they are listed here and a test
// checks the list against generated runs.
export const BASES = Object.keys(UNLOCK);
export const SCHOOLS = ['executioner', 'blademaster', 'pikelord', 'phantom', 'warlock'];
export const KEEPERS = ['forgemaster', 'twin', 'cartographer', ...SCHOOLS.map((s) => `warden:${s}`), 'proctor'];

// Where a boss is filed: what the player would call it, not the id of this run's generated copy.
export const bossKey = (def) => (!def ? '' : def.kind === 'shade' ? 'shade' : def.champion ? 'champion' : def.warden ? `warden:${def.base}` : def.kind.replace(/[AB]$/, ''));
const keyOf = (def) => (def.boss ? bossKey(def) : def.beast || def.base || def.kind);

const count = (table, ids) => ids.reduce((n, id) => n + (table[id] > 0 ? 1 : 0), 0);
const sum = (table) => Object.values(table).reduce((n, v) => n + v, 0);
const winsIn = (D, mode, diff) => Object.entries(D.clears).reduce((n, [k, v]) => { const [m, d] = k.split(':'); return n + ((!mode || m === mode) && (!diff || d === diff) ? v : 0); }, 0);

// Feats: what the codex asks of the player. `goal` and `have` read `data`; a boon is earned when every
// feat naming it is done. The first few fall within an evening's play, the last ones take real work.
// Goals read the game's own lists, so a new weapon or surprise raises the bar by itself.
export const FEATS = [
  { id: 'keeper', name: 'KEEPER DOWN', text: 'Beat a keeper', boon: 'hardened', goal: () => 1, have: (D) => count(D.bosses, KEEPERS) },
  { id: 'rollcall', name: 'ROLL CALL', text: 'Cut down every kind of enemy', boon: 'honed', goal: () => BASES.length, have: (D) => count(D.kills, BASES) },
  { id: 'challenger', name: 'CHALLENGER', text: 'Meet five floor challenges', boon: 'purse', goal: () => 5, have: (D) => sum(D.feats) },
  { id: 'sprinter', name: 'SPRINTER', text: 'Finish a sprint', boon: 'fleet', goal: () => 1, have: (D) => winsIn(D, 'sprint') },
  { id: 'arms', name: 'MANY HANDS', text: 'Clear floors with four different weapons', boon: 'twoblades', goal: () => Math.min(4, FORM_IDS.length), have: (D) => count(D.forms, FORM_IDS) },
  { id: 'shade', name: 'LAID TO REST', text: 'Banish your Shade', boon: 'breath', goal: () => 1, have: (D) => D.shades },
  { id: 'strange', name: 'STRANGE DAYS', text: 'Live through five kinds of surprise', boon: 'breath', goal: () => Math.min(5, Object.keys(SURPRISES).length), have: (D) => count(D.surprises, Object.keys(SURPRISES)) },
  { id: 'tasks', name: 'TASKMASTER', text: 'Clear a floor of every objective', boon: 'gift', goal: () => Object.keys(OBJECTIVES).length, have: (D) => count(D.objectives, Object.keys(OBJECTIVES)) },
  { id: 'bestiary', name: 'BESTIARY', text: 'Kill an animal of every kind', boon: 'gift', goal: () => BEAST_PLANS.length, have: (D) => count(D.kills, BEAST_PLANS) },
  { id: 'keepers', name: 'KEEPER OF KEEPERS', text: 'Beat six different keepers', boon: 'phoenix', goal: () => 6, have: (D) => count(D.bosses, KEEPERS) },
  { id: 'master', name: 'MASTER CLASS', text: 'Win a run on MASTER', boon: 'phoenix', goal: () => 1, have: (D) => winsIn(D, null, 'hard') },
];
export const FEAT = Object.fromEntries(FEATS.map((f) => [f.id, f]));
// Progress toward a feat, as [have, goal]. A latched feat reads as full.
export function progress(f, D) {
  const goal = f.goal(), have = D.done[f.id] ? goal : Math.min(goal, f.have(D) || 0);
  return [have, goal];
}

// Keep only what has the right shape: an old or hand-edited save must not make `bump` throw.
function clean(s) {
  const D = blank();
  if (!s || typeof s !== 'object' || (s.v !== 1 && s.v !== V)) return D;
  for (const t of TABLES) if (s[t] && typeof s[t] === 'object' && !Array.isArray(s[t])) for (const [k, v] of Object.entries(s[t])) if (t === 'best' ? v && typeof v === 'object' && Number.isFinite(v.score) : Number.isFinite(v) || v === true) D[t][k] = v;
  for (const c of COUNTS) if (Number.isFinite(s[c]) && s[c] >= 0) D[c] = s[c];
  // Version 1 had no win table; a best run that was won is the one win it can vouch for.
  if (s.v === 1) for (const [k, b] of Object.entries(D.best)) if (b.won) D.clears[k] = 1;
  return D;
}

export class Meta {
  // `storage` is anything with getItem and setItem. Under Node there is none, and nothing is kept.
  constructor(storage = typeof window !== 'undefined' ? window.localStorage : null) {
    this.store = storage;
    let s = null;
    try { s = JSON.parse(storage?.getItem(KEY) ?? 'null'); } catch { /* corrupt: start again */ }
    this.data = clean(s);
    this.dirty = false;
    // Feats finished during play, oldest first, for the shell to announce. `rev` changes whenever
    // `data` does, so a screen can tell when what it built from it is stale.
    this.fresh = []; this.rev = 0;
    // Feats an older save already earned are latched quietly: there is nothing new to announce.
    this.check(false);
  }
  save() { if (!this.dirty) return; this.dirty = false; try { this.store?.setItem(KEY, JSON.stringify(this.data)); } catch { /* play on */ } }
  // Ids of the boons earned so far (see src/game/boons.js).
  boons() {
    const out = [];
    for (const f of FEATS) if (!out.includes(f.boon) && FEATS.every((g) => g.boon !== f.boon || this.data.done[g.id])) out.push(f.boon);
    return out;
  }
  // Latch every feat that is now met. Returns whether any was new.
  check(announce = true) {
    let any = false;
    for (const f of FEATS) {
      if (this.data.done[f.id]) continue;
      const [have, goal] = progress(f, this.data);
      if (have < goal) continue;
      this.data.done[f.id] = true; this.dirty = true; any = true;
      if (announce) this.fresh.push(f.id);
    }
    return any;
  }
  bump(table, key, n = 1) { if (!key) return; this.data[table][key] = (this.data[table][key] || 0) + n; this.dirty = true; }
  // Mark everything on the floor as met. Cheap: events are rare and a floor holds a handful of fighters.
  look(world) {
    const S = this.data.seen;
    for (const f of world?.fighters || []) {
      if (f.team !== 1 || !f.def || f.def.phantom) continue;
      const k = keyOf(f.def);
      if (k && !S[k]) { S[k] = 1; this.dirty = true; }
    }
  }
  // `e` is a world or director event. Kills are filed under what the thing is underneath: the base
  // type of a strain, the body plan of an animal.
  note(e, world, dir) {
    const D = this.data, was = this.dirty;
    this.dirty = false;
    this.look(world);
    if (e.type === 'kill') {
      if (e.boss) this.bump('bosses', bossKey(world.def(e.kind) || { kind: e.kind }));
      else this.bump('kills', e.beast || e.base || e.kind);
      if (e.kind === 'shade') { D.shades++; }
    } else if (e.type === 'surprise') this.bump('surprises', e.kind);
    else if (e.type === 'feat') this.bump('feats', e.kind);
    else if (e.type === 'floor') { D.floors++; this.dirty = true; if (e.objective) this.bump('objectives', e.objective); this.bump('forms', world.formId); }
    else if (e.type === 'run') {
      D.runs++; this.dirty = true;
      const k = `${e.mode}:${e.diff}`;
      if (e.won) { D.wins++; this.bump('clears', k); }
      if (!D.best[k] || e.score > D.best[k].score) D.best[k] = { score: e.score, floor: e.floor, won: e.won };
    }
    const changed = this.dirty;
    if (changed) this.rev++;
    const earned = changed && this.check();
    // Floors, runs and new feats are worth a write at once; a kill can wait for the next of those.
    if (earned || e.type === 'floor' || e.type === 'run') this.save();
    else this.dirty ||= was;
  }
}
