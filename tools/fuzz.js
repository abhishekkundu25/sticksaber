// Headless soak and balance test. Runs the real simulation at 120 Hz with (a) random input, to prove
// nothing throws or goes non-finite, and (b) scripted players of different skill, to check that every
// floor can be cleared and how long it takes. Slow by design; the fast checks live in `npm test`.
//   node tools/fuzz.js [quick]
import { World } from '../src/game/world.js';
import { Director } from '../src/game/encounters.js';
import { BotInput } from '../src/game/bot.js';
import { rng } from '../src/core/math.js';

const ACTIONS = ['left', 'right', 'down', 'jump', 'light', 'heavy', 'guard', 'dash', 'special'];
class RandomInput {
  constructor() { this.now = 0; this.down = {}; this.pressedAt = {}; for (const a of ACTIONS) { this.down[a] = false; this.pressedAt[a] = -9; } }
  tick(dt) {
    this.now += dt;
    for (const a of ACTIONS) if (rng() < dt * (this.down[a] ? 5 : 2.2)) { this.down[a] = !this.down[a]; if (this.down[a]) this.pressedAt[a] = this.now; }
  }
  held(a) { return this.down[a]; }
  axisX() { return (this.down.right ? 1 : 0) - (this.down.left ? 1 : 0); }
  consume(a, w = 0.14) { if (this.now - this.pressedAt[a] <= w) { this.pressedAt[a] = -9; return true; } return false; }
  peek(a, w = 0.14) { return this.now - this.pressedAt[a] <= w; }
  sincePress(a) { return this.now - this.pressedAt[a]; }
}

const dt = 1 / 120, quick = process.argv[2] === 'quick';
const seen = {};
let steps = 0;
function check(world, label) {
  for (const f of world.fighters) {
    for (const v of [f.x, f.y, f.vx, f.vy, f.hp, f.posture, f.tx, f.ty, ...f.j, ...f.p]) {
      if (!Number.isFinite(v)) throw new Error(`${label}: non-finite state on ${f.def.kind} in state ${f.state} move ${f.move?.id}`);
    }
    seen[`${f.def.kind}:${f.state}${f.move ? ':' + f.move.id : ''}`] = 1;
  }
}

function make(mkInput) {
  const world = new World();
  world.input = mkInput(world);
  const sounds = new Set();
  world.sfxOut = (n) => sounds.add(n);
  const dir = new Director(world, { setArena: (id) => (id === 'hall' ? 1900 : 2200) });
  return { world, dir, sounds };
}

function soak(label, secs, setup, god) {
  const { world, dir, sounds } = make(() => new RandomInput());
  setup(dir, world);
  for (let t = 0; t < secs; t += dt) {
    world.input.tick(dt); world.step(dt); dir.update(dt);
    if (god && world.player.hp < 40 && !world.player.dead) world.player.hp = 100;
    if (dir.state === 'dead' && dir.t > 1.5) dir.retry();
    check(world, label); steps++;
  }
  console.log(`soak ${label}: ok (${sounds.size} distinct sounds)`);
}

// Plays the whole ascent with a scripted player; returns per-floor clear times and deaths.
function playthrough(skill, repeat, seed, limit = 2400) {
  const { world, dir } = make((w) => new BotInput(w, skill));
  world.input.repeat = repeat;
  dir.startRun(0, seed);
  const floors = []; let mark = 0, deathsAt = 0, stage = 0;
  for (let t = 0; t < limit; t += dt) {
    world.input.tick(dt); world.step(dt); dir.update(dt);
    if (dir.state === 'dead' && dir.t > 1.5) dir.retry();
    check(world, `bot${skill}`); steps++;
    if (dir.stage !== stage || dir.state === 'victory') {
      floors.push(`${stage + 1}:${(t - mark).toFixed(0)}s/${dir.deaths - deathsAt}`);
      mark = t; deathsAt = dir.deaths; stage = dir.stage;
    }
    if (dir.state === 'victory') return { won: true, time: t.toFixed(0), falls: dir.deaths, floors: floors.join(' '), ...world.stats, bestCombo: world.style.best };
  }
  return { won: false, at: `floor ${dir.stage + 1} wave ${dir.wave + 1}`, falls: dir.deaths, floors: floors.join(' '), ...world.stats, bossHp: world.boss ? Math.round(world.boss.hp) : null };
}

for (const f of quick ? [0, 5, 8] : [0, 2, 3, 5, 6, 7, 8]) soak(`random input, floor ${f + 1}`, quick ? 15 : 45, (d) => d.startRun(f, 1000 + f), f > 0);
soak('random input, forgemaster', quick ? 20 : 90, (d) => d.startRun(4, 5), true);
soak('random input, proctor', quick ? 20 : 120, (d) => d.startRun(9, 6), true);
soak('training, full roster', quick ? 15 : 60, (d) => { d.startTraining(); for (const k of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0']) d.trainingKey(k); }, true);

const runs = quick ? 1 : 3;
for (const [name, skill, repeat] of [['skilled', 0.9, null], ['average', 0.55, null], ['no defence', 0, null], ['masher (light string only)', 0.55, ['light', 'light', 'light', 'light']]]) {
  for (let i = 0; i < runs; i++) console.log(`bot ${name}:`, JSON.stringify(playthrough(skill, repeat, 7000 + i)));
}
console.log(`ok: ${steps} steps, ${Object.keys(seen).length} distinct fighter states visited`);
const want = ['player:attack:RIPOSTE', 'player:attack:PLUNGE_LAND', 'player:attack:COMET', 'player:attack:THROW', 'proctor:custom', 'proctor:attack:p_slam', 'proctor:attack:p_cyclone', 'proctor:stagger', 'echo:attack:p_verdict',
  'brute:attack:br_charge', 'brute:attack:br_land', 'brute:attack:br_sweep', 'brute:stagger', 'duelist:attack:d_counter', 'duelist:attack:d_dive', 'duelist:attack:d_throw', 'bulwark:stagger', 'bulwark:attack:b_charge',
  'initiate:attack:i_feint', 'initiate:attack:i_lunge', 'marksman:attack:m_burst', 'marksman:attack:m_lob', 'lancer:attack:ln_thrust', 'lancer:attack:ln_skewer', 'wraith:custom', 'wraith:attack:w_slash', 'drone:custom', 'drone:attack:dr_shot', 'drone:ragdoll',
  'forgemaster:attack:fm_string', 'forgemaster:attack:fm_quake', 'forgemaster:attack:fm_ember', 'forgemaster:attack:fm_erupt', 'forgemaster:custom'];
for (const k of want) if (!seen[k]) console.log('  NOT REACHED:', k);
