// Headless soak and balance test. Runs the real simulation at 120 Hz with (a) random input, to prove
// nothing throws or goes non-finite, and (b) scripted players of different skill on each difficulty,
// to check that the hundred floors can be climbed and where the falls happen. Slow by design; the
// fast checks live in `npm test`.
//   node tools/fuzz.js [quick]
import { World } from '../src/game/world.js';
import { Director } from '../src/game/encounters.js';
import { BotInput } from '../src/game/bot.js';
import { rng } from '../src/core/math.js';
import { generateRun } from '../src/game/gen.js';
import { FORM_IDS } from '../src/game/forms.js';

// The floor the Forgemaster keeps in the run with this seed.
const generateForge = (seed) => generateRun(seed).floors.find((f) => f.boss === 'forgemaster').n;

const ACTIONS = ['left', 'right', 'down', 'jump', 'light', 'heavy', 'guard', 'dash', 'special', 'cycle', 'overdrive'];
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
    // Generated fighters are filed under what they are (strain, champion, warden) and the hand-made move behind the one they use.
    const who = f.def.beast ? 'beast' : f.def.strain ? 'strain' : f.def.champion ? 'champion' : f.def.warden ? 'warden' : f.def.kind;
    if (f.riding) seen.rider = 1;
    if (f.enraged) seen.enraged = 1;
    seen[`${who}:${f.state}${f.move ? ':' + f.move.src : ''}`] = 1;
    if (f.move && f.move.id !== f.move.src) seen[f.move.id.includes('+') ? 'generated:chain' : 'generated:tempo'] = 1;
  }
}

function make(mkInput) {
  const world = new World();
  world.input = mkInput(world);
  const sounds = new Set();
  world.sfxOut = (n) => sounds.add(n);
  const dir = new Director(world, { setArena: (id) => (id === 'hall' ? 1900 : 2200), auto: true });
  return { world, dir, sounds };
}

function soak(label, secs, setup, god) {
  const { world, dir, sounds } = make(() => new RandomInput());
  setup(dir, world);
  for (let t = 0; t < secs; t += dt) {
    world.input.tick(dt); world.step(dt); dir.update(dt);
    if (god && world.player.hp < 40 && !world.player.dead) world.player.hp = world.player.maxHp;
    if (dir.state === 'dead' && dir.t > 1.5) dir.retry();
    check(world, label); steps++;
  }
  console.log(`soak ${label}: ok (${sounds.size} distinct sounds)`);
}

// Plays the whole ascent with a scripted player. Gives up after `maxFalls`, which is a wall, not a bug.
function playthrough(skill, repeat, seed, diff, maxFalls = 80, form = 'saber') {
  const { world, dir } = make((w) => new BotInput(w, skill));
  world.input.repeat = repeat; world.setForm(form);
  dir.startRun(0, seed, diff);
  const sec = Array.from({ length: 10 }, () => ({ falls: 0, t: 0 }));
  let mark = 0, deathsAt = 0, stage = 0, t = 0;
  for (; t < 3600 * 6 && dir.deaths < maxFalls; t += dt) {
    world.input.tick(dt); world.step(dt); dir.update(dt);
    if (dir.state === 'dead' && dir.t > 1.5) dir.retry();
    check(world, `bot${skill}`); steps++;
    if (dir.stage !== stage || dir.state === 'victory') {
      const S = sec[dir.floors[stage].sector];
      S.falls += dir.deaths - deathsAt; S.t += t - mark;
      mark = t; deathsAt = dir.deaths; stage = dir.stage;
    }
    if (dir.state === 'victory') break;
  }
  const st = world.stats;
  return `${dir.state === 'victory' ? 'WON ' : `floor ${String(dir.stage + 1).padStart(3)}`}  ${(t / 60).toFixed(0).padStart(3)} min  falls ${String(dir.deaths).padStart(2)}  by sector [${sec.map((x) => x.falls).join(' ')}]`
    + `  parries ${st.parries} powers ${st.powers} overdrives ${st.overdrives} bursts ${st.bursts} orbs ${st.orbs}`;
}

for (const f of quick ? [1, 23, 78] : [1, 6, 9, 13, 27, 38, 54, 66, 78, 93]) soak(`random input, floor ${f}`, quick ? 15 : 40, (d) => d.startRun(f - 1, 1000 + f), f > 1);
for (const f of quick ? [10, 45] : [5, 10, 20, 30, 45, 60, 80, 90]) soak(`random input, ${f % 10 ? 'champion' : 'keeper'} of floor ${f}`, quick ? 20 : 60, (d) => d.startRun(f - 1, 5 + f), true);
soak('random input, forgemaster', quick ? 20 : 90, (d) => d.startRun(generateForge(5) - 1, 5), true);
soak('random input, proctor', quick ? 20 : 120, (d) => d.startRun(99, 6), true);
soak('training, full roster', quick ? 15 : 60, (d, w) => {
  d.startTraining();
  for (const k of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'BracketLeft', 'BracketLeft', 'BracketLeft', 'BracketRight']) d.trainingKey(k);
  w.spawnEnemy(d.run.roster.wardens[2], 300, true);
}, true);

const seeds = quick ? [7000] : [7000, 7001, 7002];
for (const diff of ['easy', 'normal', 'hard']) {
  for (const [name, skill] of [['skilled', 0.9], ['average', 0.55], ['weak', 0.3]]) {
    for (const seed of seeds) console.log(`${diff.padEnd(6)} ${name.padEnd(8)} seed ${seed}: ${playthrough(skill, null, seed, diff)}`);
  }
}
console.log(`normal masher (light string only): ${playthrough(0.55, ['light', 'light', 'light', 'light'], 7000, 'normal')}`);
for (const form of FORM_IDS) if (form !== 'saber') console.log(`normal skilled  ${form.padEnd(6)}: ${playthrough(0.9, null, 7000, 'normal', 80, form)}`);
console.log(`ok: ${steps} steps, ${Object.keys(seen).length} distinct fighter states visited`);
const want = ['player:attack:RIPOSTE', 'player:attack:PLUNGE_LAND', 'player:attack:COMET', 'player:attack:THROW', 'player:attack:CAST', 'player:attack:CRESCENT', 'player:custom', 'proctor:custom', 'proctor:attack:p_slam', 'proctor:attack:p_cyclone', 'proctor:stagger', 'echo:attack:p_verdict',
  'brute:attack:br_charge', 'brute:attack:br_land', 'brute:attack:br_sweep', 'brute:stagger', 'duelist:attack:d_counter', 'duelist:attack:d_dive', 'duelist:attack:d_throw', 'bulwark:stagger', 'bulwark:attack:b_charge',
  'initiate:attack:i_feint', 'initiate:attack:i_lunge', 'marksman:attack:m_burst', 'marksman:attack:m_lob', 'lancer:attack:ln_thrust', 'lancer:attack:ln_skewer', 'wraith:custom', 'wraith:attack:w_slash', 'drone:custom', 'drone:attack:dr_shot', 'drone:ragdoll',
  'forgemaster:attack:fm_string', 'forgemaster:attack:fm_quake', 'forgemaster:attack:fm_ember', 'forgemaster:attack:fm_erupt', 'forgemaster:custom',
  'strain:attack:br_charge', 'strain:attack:d_throw', 'strain:stagger', 'strain:custom', 'champion:custom', 'champion:stagger', 'warden:custom', 'warden:stagger', 'warden:attack:p_slam', 'warden:attack:fm_erupt~', 'warden:guard',
  'generated:tempo', 'generated:chain', 'beast:attack:bt_hound_snap', 'beast:attack:bt_charger_charge', 'beast:attack:bt_raptor_leap', 'beast:attack:bt_ape_slam', 'beast:attack:bt_spit_shot', 'beast:custom', 'beast:ragdoll', 'beast:stagger',
  'rider', 'enraged', 'twinA:attack:p_verdict', 'twinB:attack:ln_thrust', 'cartographer:custom', 'player:attack:TW_L1', 'player:attack:GS_H1', 'player:attack:ST_L1'];
for (const k of want) if (!seen[k]) console.log('  NOT REACHED:', k);
