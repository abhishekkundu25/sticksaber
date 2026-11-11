// A scripted player used by the soak test. It reads enemy wind-ups the way a person would (parry
// white tells, dodge red ones, jump shockwaves) and mixes its combos. `skill` (0..1) is the chance
// it reacts to any given threat, so balance can be checked for weak and strong players.
const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'light', 'heavy', 'guard', 'dash', 'special'];
const COMBOS = [
  ['light', 'light', 'light', 'light'], ['light', 'light', 'heavy'], ['heavy'], ['light', 'heavy'],
  ['down+heavy', 'light', 'light', 'heavy'], ['light', 'light', 'light', 'heavy'], ['dash', 'light', 'light'], ['jump', 'down+heavy'],
];

export class BotInput {
  constructor(world, skill = 0.8) {
    this.world = world; this.skill = skill; this.now = 0;
    this.down = {}; this.pressedAt = {}; this.hold = {};
    for (const a of ACTIONS) { this.down[a] = false; this.pressedAt[a] = -9; this.hold[a] = 0; }
    this.script = []; this.wait = 0; this.seen = new Map(); this.repeat = null;
  }
  held(a) { return this.down[a]; }
  axisX() { return (this.down.right ? 1 : 0) - (this.down.left ? 1 : 0); }
  consume(a, w = 0.14) { if (this.now - this.pressedAt[a] <= w) { this.pressedAt[a] = -9; return true; } return false; }
  peek(a, w = 0.14) { return this.now - this.pressedAt[a] <= w; }
  sincePress(a) { return this.now - this.pressedAt[a]; }
  press(a, hold = 0.06) { if (!this.down[a]) this.pressedAt[a] = this.now; this.down[a] = true; this.hold[a] = Math.max(this.hold[a], hold); }

  tick(dt) {
    this.now += dt;
    for (const a of ACTIONS) if (this.hold[a] > 0 && (this.hold[a] -= dt) <= 0) this.down[a] = false;
    const w = this.world, p = w.player;
    if (!p || p.dead) return;
    this.down.left = this.down.right = false;

    let tgt = null, td = 1e9;
    for (const e of w.fighters) { if (e.team !== 1 || e.dead) continue; const d = Math.abs(e.x - p.x); if (d < td) { td = d; tgt = e; } }

    // Defence first.
    for (const e of w.fighters) {
      if (e.team !== 1 || e.dead || e.state !== 'attack') continue;
      const dist = Math.abs(e.x - p.x);
      for (let i = 0; i < e.move.hits.length; i++) {
        const h = e.move.hits[i], lead = h.t0 - e.mt, key = e.atkSerial * 10 + i;
        const reach = h.sweepBody || e.move.id === 'br_charge' ? 900 : 190 * e.scale;
        if (lead > 0.11 || lead < -0.02 || dist > reach) continue;
        if (this.seen.get(e) === key) continue;
        this.seen.set(e, key);
        if (Math.random() > this.skill) continue;
        if (h.unblockable) { if (e.move.id === 'br_charge' || h.sweepBody) this.press('jump', 0.25); else { this.press(e.x > p.x ? 'left' : 'right', 0.25); this.press('dash'); } }
        else { this.down[e.x > p.x ? 'right' : 'left'] = false; p.facing = e.x > p.x ? 1 : -1; this.press('guard', 0.22); }
        this.script.length = 0; this.wait = 0.2;
      }
    }
    for (const q of w.projectiles.list) {
      if (q.team === 0) continue;
      const d = Math.abs(q.x - p.x);
      if (this.seen.get(q)) continue;
      if (q.type === 'bolt' && d < 110 && Math.abs(q.y - p.cy) < 90) { this.seen.set(q, 1); if (Math.random() < this.skill) { p.facing = q.x > p.x ? 1 : -1; this.press('guard', 0.2); this.wait = 0.2; } }
      if ((q.type === 'wave' || q.type === 'crescent') && d < 120 && (q.x - p.x) * q.dir < 0) { this.seen.set(q, 1); if (Math.random() < this.skill) { this.press('jump', 0.3); this.wait = 0.25; } }
    }
    if (w.marker?.lock && Math.abs(w.marker.x - p.x) < 150 && !this.seen.get(w.marker)) { this.seen.set(w.marker, 1); if (Math.random() < this.skill) { this.press('right', 0.3); this.press('dash'); } }

    if (p.state === 'ragdoll' && p.rag.y[2] > -50 && Math.random() < this.skill * dt * 20) this.press('dash');
    if (p.riposteT > 0 && Math.random() < this.skill) { this.press('light'); return; }
    if (this.down.guard || !tgt) return;
    if ((this.wait -= dt) > 0) return;

    const dx = tgt.x - p.x, dir = dx > 0 ? 'right' : 'left';
    const channel = tgt.ai.channel;
    if (channel && td > 260 && w.focus >= 100 && p.armed) { this.press('special'); this.wait = 0.5; return; }
    if (tgt.y < -400) { this.down[p.x > 0 ? 'left' : 'right'] = true; return; } // boss is airborne: keep moving
    const reach = 96 + 34 * (tgt.scale - 1);
    if (td > reach) { this.down[dir] = true; if (td > 420 && p.dashCd <= 0 && Math.random() < dt * 3) this.press('dash'); return; }
    if (!this.script.length) {
      // `repeat` forces the same string every time, to check that the game punishes it.
      this.script = [...(this.repeat || COMBOS[(Math.random() * COMBOS.length) | 0])];
      if (Math.abs(dx) > 8) p.facing = dx > 0 ? 1 : -1;
    }
    const step = this.script.shift();
    for (const a of step.split('+')) this.press(a, a === 'down' ? 0.2 : 0.07);
    this.wait = step.includes('jump') ? 0.28 : this.script.length ? 0.2 : 0.42;
  }
}
