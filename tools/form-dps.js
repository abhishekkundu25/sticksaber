// Damage rates of each weapon form against the training dummy, measured in the real simulation.
// A scripted hand plays one string against a fresh dummy, pressing each button just before the move
// it is in can be cancelled, and the clock runs until the player is back on its feet.
//   node tools/form-dps.js            print the table
//   node tools/form-dps.js twin L     one form, one string, with a hit log
import { World } from '../src/game/world.js';
import { FORMS, FORM_IDS } from '../src/game/forms.js';
import { seedRng } from '../src/core/math.js';

// Strings, as button tokens. `d` holds down, a trailing `!` holds the button long enough to rise
// with a launcher, `!!` charges a heavy.
export const STRINGS = {
  saber: { L: 'L L L L', LF: 'L L L H', AIR: 'dH! L L L' },
  twin: { L: 'L L L L L L', LF: 'L L L H', AIR: 'dH! L L L L L' },
  great: { L: 'L L L', LF: 'L L L H', AIR: 'dH! L L' },
  staff: { L: 'L L L L', LF: 'L L L H', AIR: 'dH! L L L' },
};

class ScriptInput {
  constructor() {
    this.now = 0; this.down = {}; this.pressedAt = {}; this.hold = {};
    for (const a of ['left', 'right', 'down', 'jump', 'light', 'heavy', 'guard', 'dash', 'special', 'cycle', 'overdrive']) { this.down[a] = false; this.pressedAt[a] = -9; this.hold[a] = 0; }
  }
  held(a) { return this.down[a]; }
  axisX() { return (this.down.right ? 1 : 0) - (this.down.left ? 1 : 0); }
  consume(a, w = 0.14) { if (this.now - this.pressedAt[a] <= w) { this.pressedAt[a] = -9; return true; } return false; }
  peek(a, w = 0.14) { return this.now - this.pressedAt[a] <= w; }
  sincePress(a) { return this.now - this.pressedAt[a]; }
  press(a, hold = 0.06) { this.pressedAt[a] = this.now; this.down[a] = true; this.hold[a] = Math.max(this.hold[a], hold); }
  tick(dt) { this.now += dt; for (const a in this.hold) if (this.hold[a] > 0 && (this.hold[a] -= dt) <= 0) this.down[a] = false; }
}

let DT = 1 / 120;

// Plays `tokens` `reps` times, each time against a fresh upright dummy standing in reach, and
// counts the time from the first press until the player is back on its feet and free to act. By
// default every hit counts at full value; `stale: true` keeps the game's repetition rule.
export function measure(formId, tokens, { reps = 8, stale = false, log = false, seed = 3, dist, hz = 120 } = {}) {
  DT = 1 / hz;
  seedRng(seed);
  const world = new World();
  const inp = new ScriptInput();
  world.input = inp;
  world.setArena(2200);
  world.setForm(formId);
  world.spawnPlayer(0);
  const p = world.player;
  if (!stale) world.style.land = () => ({ mul: 1, fresh: false, stale: false });
  let hits = 0, dealt = 0, time = 0;
  const byMove = {};
  for (let r = 0; r < reps; r++) {
    world.clearEnemies();
    p.x = 0; p.facing = 1; p.vx = 0;
    const gap = dist ?? Math.max(60, p.bladeLen * 0.85);
    const dummy = world.spawnEnemy('dummy', gap, false);
    dummy.hp = dummy.maxHp = 1e7;
    for (let i = 0; i < 60; i++) { inp.tick(DT); world.step(DT); }
    let idx = 0, pending = -1, pendSerial = 0, hp = dummy.hp, t = 0;
    const press = () => { fire(inp, tokens[idx++]); pending = inp.now; pendSerial = p.atkSerial || 0; };
    press();
    for (; t < 6; t += DT) {
      inp.tick(DT);
      if (pending >= 0) {
        if (world.hitstop > 0) pending += DT; // the press waits out the freeze, as a held buffer would
        if (p.atkSerial > pendSerial) pending = -1;
        else if (inp.now - pending > 0.16) { pending = -1; if (p.onGround) idx = tokens.length; }
      }
      if (pending < 0) {
        const m = p.state === 'attack' ? p.move : null;
        if (idx >= tokens.length) { if (p.state === 'free' && p.onGround) break; }
        else if (m) { if (!m.plunge && p.mt >= Math.max(m.cancel * (p.hitLanded ? 0.75 : 1) - 0.08, m.rise ? m.rise + 0.03 : 0)) press(); }
        else if (p.state === 'free') { if (!p.onGround) press(); else idx = tokens.length; }
      }
      world.step(DT);
      if (dummy.hp < hp) {
        const d = hp - dummy.hp; dealt += d; hits++;
        const id = p.move?.id ?? '?';
        (byMove[id] ??= [0, 0])[0]++; byMove[id][1] += d;
        if (log) console.log(r, t.toFixed(3), id, d.toFixed(1), dummy.x.toFixed(0), 'win', p.hitIdx, p.mt.toFixed(3));
      }
      hp = dummy.hp;
    }
    time += t;
  }
  return { dps: dealt / time, hps: hits / time, perHit: hits ? dealt / hits : 0, perString: dealt / reps, secs: time / reps, byMove };
}

function fire(inp, tok) {
  const bang = tok.match(/!*$/)[0].length, t = tok.replace(/!+$/, '');
  const hold = bang === 2 ? 0.62 : bang === 1 ? 0.4 : 0.06;
  if (t[0] === 'd') { inp.press('down', 0.2); }
  const b = t.slice(-1);
  inp.press(b === 'L' ? 'light' : b === 'H' ? 'heavy' : b === 'J' ? 'jump' : 'dash', hold);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [form, str] = process.argv.slice(2);
  if (form) {
    const r = measure(form, (STRINGS[form][str] || str).split(' '), { log: true });
    console.log(r);
  } else {
    const base = {};
    console.log('form    string  dps(raw)  vs saber  hits/s  dmg/hit  dps(stale)');
    for (const id of FORM_IDS) {
      for (const s of Object.keys(STRINGS[id])) {
        const tok = STRINGS[id][s].split(' '), r = measure(id, tok), q = measure(id, tok, { stale: true });
        if (id === 'saber') base[s] = r.dps;
        console.log(`${id.padEnd(7)} ${s.padEnd(6)} ${r.dps.toFixed(1).padStart(8)}  ${((r.dps / base[s] - 1) * 100).toFixed(0).padStart(6)}%  ${r.hps.toFixed(2).padStart(6)}  ${r.perHit.toFixed(1).padStart(7)}  ${q.dps.toFixed(1).padStart(9)}`);
      }
    }
  }
}
