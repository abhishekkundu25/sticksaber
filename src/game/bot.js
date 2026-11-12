// A scripted player. The soak test uses it to check balance, and the title screen uses it to play a
// live fight behind the menu. It reads enemy wind-ups the way a person would (parry white tells,
// dodge red ones, jump shockwaves) and mixes its combos. `skill` (0..1) is the chance it reacts to
// any given threat.
import { rng } from '../core/math.js';
import { POWERS } from './powers.js';
const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'light', 'heavy', 'guard', 'dash', 'special', 'cycle', 'overdrive'];
const COMBOS = [
  ['light', 'light', 'light', 'light'], ['light', 'light', 'heavy'], ['heavy'], ['light', 'heavy'],
  ['down+heavy', 'light', 'light', 'heavy'], ['light', 'light', 'light', 'heavy'], ['dash', 'light', 'light'], ['jump', 'down+heavy'],
];
// Showman strings for the title screen. A trailing `!` holds the button (rise with a launcher), `!!` charges it.
const SHOW = [
  ['light', 'light', 'heavy!', 'light', 'light', 'light', 'heavy'],
  ['light', 'light', 'light', 'heavy'],
  ['jump', 'down+heavy', 'light', 'light'],
  ['dash', 'light', 'light', 'heavy!', 'light', 'light', 'heavy'],
  ['light', 'light', 'light', 'light'],
  ['heavy!!', 'light', 'light'],
  ['down+heavy!', 'light', 'light', 'light', 'heavy'],
];
const BURSTABLE = { hitstun: 1, ragdoll: 1, recoil: 1, stagger: 1 };

export class BotInput {
  constructor(world, skill = 0.8) {
    this.world = world; this.skill = skill; this.now = 0;
    this.down = {}; this.pressedAt = {}; this.hold = {};
    for (const a of ACTIONS) { this.down[a] = false; this.pressedAt[a] = -9; this.hold[a] = 0; }
    this.script = []; this.wait = 0; this.seen = new Map(); this.repeat = null;
    this.show = false; // title-screen mode: flashier strings and free use of Focus
    this.odWait = 0;   // title-screen mode keeps Overdrive occasional
  }
  held(a) { return this.down[a]; }
  axisX() { return (this.down.right ? 1 : 0) - (this.down.left ? 1 : 0); }
  consume(a, w = 0.14) { if (this.now - this.pressedAt[a] <= w) { this.pressedAt[a] = -9; return true; } return false; }
  peek(a, w = 0.14) { return this.now - this.pressedAt[a] <= w; }
  sincePress(a) { return this.now - this.pressedAt[a]; }
  press(a, hold = 0.06) { if (!this.down[a]) this.pressedAt[a] = this.now; this.down[a] = true; this.hold[a] = Math.max(this.hold[a], hold); }

  // Select the first of `ids` the player owns and can pay for, and use it.
  cast(ids) {
    const w = this.world;
    for (const id of ids) {
      if (!w.powers.includes(id) || w.focus < POWERS[id].cost * 100 || (POWERS[id].ready && !POWERS[id].ready(w, w.player))) continue;
      w.selectPower(id); this.press('special');
      return true;
    }
    return false;
  }

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
        const reach = h.sweepBody || e.move.src === 'br_charge' ? 900 : 190 * e.scale;
        if (lead > 0.11 || lead < -0.02 || dist > reach) continue;
        if (this.seen.get(e) === key) continue;
        this.seen.set(e, key);
        if (rng() > this.skill) continue;
        if (h.unblockable) { if (e.move.src === 'br_charge' || h.sweepBody) this.press('jump', 0.25); else { this.press(e.x > p.x ? 'left' : 'right', 0.25); this.press('dash'); } }
        else { this.down[e.x > p.x ? 'right' : 'left'] = false; p.facing = e.x > p.x ? 1 : -1; this.press('guard', 0.22); }
        this.script.length = 0; this.wait = 0.2;
      }
    }
    for (const q of w.projectiles.list) {
      if (q.team === 0) continue;
      const d = Math.abs(q.x - p.x);
      if (this.seen.get(q)) continue;
      if (q.type === 'bolt' && d < 110 && Math.abs(q.y - p.cy) < 90) { this.seen.set(q, 1); if (rng() < this.skill) { p.facing = q.x > p.x ? 1 : -1; this.press('guard', 0.2); this.wait = 0.2; } }
      if ((q.type === 'wave' || q.type === 'crescent') && d < 120 && (q.x - p.x) * q.dir < 0) { this.seen.set(q, 1); if (rng() < this.skill) { this.press('jump', 0.3); this.wait = 0.25; } }
    }
    if (w.marker?.lock && Math.abs(w.marker.x - p.x) < 150 && !this.seen.get(w.marker)) { this.seen.set(w.marker, 1); if (rng() < this.skill) { this.press('right', 0.3); this.press('dash'); } }
    // Step out of marked ground: eruptions about to fire and charges about to burst.
    for (const q of w.projectiles.list) {
      if (q.team === 0 || this.seen.get(q)) continue;
      const hot = q.type === 'pillar' ? !q.fired && q.delay < 0.4 && Math.abs(q.x - p.x) < q.w + 34 : q.type === 'lob' && q.landed && q.fuse < 0.42 && Math.abs(q.x - p.x) < q.r + 24;
      if (!hot) continue;
      this.seen.set(q, 1);
      if (rng() < this.skill && p.state !== 'dash') {
        let away = p.x >= q.x ? 'right' : 'left';
        if (away === 'right' && p.x > w.maxX - 160) away = 'left'; else if (away === 'left' && p.x < w.minX + 160) away = 'right';
        this.down.left = this.down.right = false; this.press(away, 0.3); this.press('dash'); this.script.length = 0; this.wait = 0.25;
      }
    }

    if (p.state === 'ragdoll' && p.rag.y[2] > -50 && rng() < this.skill * dt * 20) this.press('dash');
    // Sometimes burst out of a beating, and open Overdrive when the meter is full and something is in reach.
    if ((p.state === 'hitstun' || p.state === 'ragdoll') && w.focus >= 200 && rng() < this.skill * dt * 3) this.press('special');
    this.odWait -= dt;
    if (w.focus >= w.maxFocus && tgt && td < 320 && p.state === 'free' && this.odWait <= 0 && rng() < this.skill * dt * 6) { this.press('overdrive'); if (this.show) this.odWait = 34; }
    if (this.show) {
      // Never take a beating quietly, and send the saber through anything lined up ahead, bodies included.
      if (BURSTABLE[p.state] && w.focus >= 100 && rng() < dt * 12) this.press('special');
      if (p.armed && w.focus >= 100 && w.overdrive <= 0 && p.state === 'free' && p.onGround && rng() < dt * 0.8) {
        for (const e of w.fighters) {
          const ahead = (e.x - p.x) * p.facing;
          if (e.team === 1 && !e.phantom && (!e.dead || e.deadT < 2.5) && ahead > 140 && ahead < 460) { if (this.cast(['throw'])) { this.wait = 0.4; this.script.length = 0; } return; }
        }
      }
    }
    if (p.riposteT > 0 && rng() < this.skill) { this.press('light'); return; }
    if (this.down.guard || !tgt) return;
    if ((this.wait -= dt) > 0) return;

    const dx = tgt.x - p.x, dir = dx > 0 ? 'right' : 'left';
    const channel = tgt.ai.channel;
    if (channel && td > 260 && this.cast(['throw', 'crescent', 'arc', 'judgment', 'flash'])) { this.wait = 0.5; return; }
    // Powers: heal when hurt, otherwise spend on whatever suits the crowd, keeping a pip back for a Burst.
    if (w.powers.length > 1 && w.overdrive <= 0 && p.state === 'free' && rng() < dt * (this.show ? 2.2 : 1.2 * this.skill)) {
      let near = 0, mid = 0;
      for (const e of w.fighters) if (e.team === 1 && !e.dead && !e.phantom) { const d = Math.abs(e.x - p.x); if (d < 270) near++; if (d < 540) mid++; }
      const boss = w.boss && !w.boss.dead, want = [];
      if (p.hp < p.maxHp * 0.5) want.push('mend');
      if (near >= 2 || (boss && near)) want.push('nova');
      if (mid >= 3 || boss) want.push('stasis', 'mirror');
      if (mid >= 2 || boss) want.push('flash', 'judgment');
      if (mid >= 1) want.push('arc', 'crescent');
      const reserve = this.show || want[0] === 'mend' ? 0 : 100;
      const ok = want.filter((id) => w.powers.includes(id) && w.focus >= POWERS[id].cost * 100 + reserve);
      if (ok.length && this.cast([want[0] === 'mend' && ok[0] === 'mend' ? 'mend' : ok[(rng() * ok.length) | 0]])) { this.wait = 0.35; this.script.length = 0; return; }
    }
    if (tgt.y < -400) { this.down[p.x > 0 ? 'left' : 'right'] = true; return; } // boss is airborne: keep moving
    const reach = 96 + 34 * (tgt.scale - 1);
    if (td > reach) { this.down[dir] = true; if (td > (this.show ? 260 : 420) && p.dashCd <= 0 && rng() < dt * (this.show ? 6 : 3)) this.press('dash'); return; }
    if (!this.script.length) {
      // `repeat` forces the same string every time, to check that the game punishes it.
      const pool = this.show ? SHOW : COMBOS;
      this.script = [...(this.repeat || pool[(rng() * pool.length) | 0])];
      if (this.show && tgt.def.flying && !tgt.rag) this.script = ['jump', 'light', 'light', 'heavy']; // go up after a drone
      if (Math.abs(dx) > 8) p.facing = dx > 0 ? 1 : -1;
    }
    const step = this.script.shift();
    let longest = 0;
    for (const token of step.split('+')) {
      const a = token.replace(/!+$/, ''), bangs = token.length - a.length;
      const hold = bangs === 2 ? 0.56 : bangs === 1 ? 0.34 : a === 'down' ? 0.2 : 0.07;
      this.press(a, hold); if (hold > longest) longest = hold;
    }
    this.wait = longest > 0.5 ? 0.78 : longest > 0.3 ? 0.27 : step.includes('jump') ? 0.28 : this.script.length ? 0.2 : 0.42;
  }
}
