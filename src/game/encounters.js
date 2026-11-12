// Encounter director: runs the ten generated floors wave by wave, and handles pacing, retries and
// the training room.
import { clamp, seedRng, hash32 } from '../core/math.js';
import { generateRun, FLOORS } from './gen.js';
import { newStats } from './world.js';

const TRAIN_KEYS = { Digit1: 'initiate', Digit2: 'bulwark', Digit3: 'duelist', Digit4: 'marksman', Digit5: 'brute', Digit6: 'lancer', Digit7: 'wraith', Digit8: 'drone', Digit9: 'forgemaster', Digit0: 'proctor', Equal: 'dummy' };
const TRAIN_HINT = '1 Initiate  2 Bulwark  3 Duelist  4 Marksman  5 Brute  6 Lancer  7 Wraith  8 Drone  9 Forgemaster  0 Proctor   - Clear   = Target';

export class Director {
  // hooks.setArena(id, seed) must return the arena's playable width. hooks.onFloor(n) is told each floor reached.
  constructor(world, hooks) {
    this.world = world; this.hooks = hooks;
    this.state = 'idle'; this.t = 0;
    this.seed = 1; this.floors = generateRun(1);
    this.stage = 0; this.wave = 0; this.pending = [];
    this.hint = ''; this.hintT = 0; this.fade = 0; this.fadeDir = 0;
    this.training = false; this.runTime = 0; this.deaths = 0;
    this.music = 'menu';
  }

  get stageDef() { return this.floors[this.stage]; }
  get waveCount() { return this.stageDef.waves.length; }
  get lastFloor() { return this.stage === FLOORS - 1; }

  // Start a run at floor index `stage` (0-based). The same seed always produces the same run.
  startRun(stage = 0, seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) {
    const w = this.world;
    this.seed = seed >>> 0 || 1;
    this.floors = generateRun(this.seed);
    seedRng(hash32(this.seed, 0x51ed));
    this.training = false; w.training = false;
    w.style.reset(); w.focus = 100; w.stats = newStats();
    this.runTime = 0; this.deaths = 0;
    this.enterStage(stage, 0, true);
  }

  startTraining() {
    const w = this.world;
    this.training = true; w.training = true;
    w.fighters.length = 0; w.projectiles.clear(); w.fx.clear();
    w.setArena(this.hooks.setArena('causeway', 0));
    w.spawnPlayer(-200); w.enemyDmg = 1; w.maxAttackers = 2; w.focus = 300; w.floor = FLOORS;
    w.spawnEnemy('dummy', 160, false);
    this.state = 'fight'; this.pending.length = 0; this.music = 'combat';
    this.hint = TRAIN_HINT; this.hintT = 1e9;
    w.banner('TRAINING ROOM', 'Nothing here can end your run', 2.4);
  }

  trainingKey(code) {
    if (!this.training) return;
    const w = this.world;
    if (code === 'Minus') { w.clearEnemies(); return; }
    const kind = TRAIN_KEYS[code];
    if (!kind) return;
    if ((kind === 'proctor' || kind === 'forgemaster') && w.boss && !w.boss.dead) return;
    const p = w.player;
    w.spawnEnemy(kind, p.x + (p.x > 0 ? -1 : 1) * 420, kind !== 'dummy');
  }

  enterStage(stage, wave, fresh) {
    const w = this.world, def = this.floors[stage];
    this.stage = stage; this.wave = wave;
    w.fighters.length = 0; w.projectiles.clear(); w.fx.clear(); w.boss = null; w.marker = null; w.bossChannel = 0;
    w.setArena(this.hooks.setArena(def.arena, def.arenaSeed));
    const hp = fresh || !this.keepHp ? null : this.keepHp;
    const p = w.spawnPlayer(-320);
    if (hp) p.hp = hp;
    // Arrive by drop beam, like everything else on the Spire.
    p.y = -520; p.vy = 500; p.onGround = false; w.fx.beam(p.x, 0.8, p.color);
    w.cam.x = -200; w.rally = 0;
    w.enemyDmg = def.dmg; w.floor = def.n;
    this.state = 'intro'; this.t = 0; this.pending.length = 0;
    this.fade = 1; this.fadeDir = -1;
    this.music = def.music;
    w.banner(def.title, def.sub, 2.6);
    this.hooks.onFloor?.(def.n);
  }

  spawnWave() {
    const w = this.world, wave = this.stageDef.waves[this.wave];
    this.pending = wave.spawns.map((s) => ({ ...s }));
    this.hint = wave.hint || ''; this.hintT = wave.hint ? 11 : 0;
    w.maxAttackers = wave.attackers;
    this.state = 'fight'; this.t = 0;
    if (this.wave > 0) w.banner(`WAVE ${this.wave + 1} / ${this.waveCount}`, '', 1.4);
  }

  retry() {
    const w = this.world;
    this.deaths++;
    this.keepHp = null;
    this.enterStage(this.stage, this.wave, true);
    w.focus = Math.max(w.focus, 100); w.style.reset();
    this.state = 'intro'; this.t = 1.4; // shorter intro on a retry
    w.bannerMsg = null;
  }

  update(dt) {
    const w = this.world;
    this.t += dt;
    if (this.fadeDir) { this.fade = clamp(this.fade + this.fadeDir * dt * 1.8, 0, 1); if (this.fade === 0 || this.fade === 1) { const d = this.fadeDir; this.fadeDir = 0; if (d > 0) this.afterFade?.(); } }
    if (this.hintT > 0) this.hintT -= dt;
    for (const e of w.events) {
      if (e.type === 'playerDead') { this.state = this.training ? 'trainDead' : 'dead'; this.t = 0; }
      if (e.type === 'kill' && e.boss && !this.training && this.lastFloor) { this.state = 'bossDown'; this.t = 0; this.music = 'none'; }
    }
    w.events.length = 0;

    if (this.training) return this.updateTraining(dt);
    if (this.state !== 'dead' && this.state !== 'victory' && this.state !== 'idle') this.runTime += dt;

    switch (this.state) {
      case 'intro': if (this.t > 2.0) this.spawnWave(); break;
      case 'fight': {
        for (let i = this.pending.length - 1; i >= 0; i--) {
          const s = this.pending[i];
          if ((s.t -= dt) > 0) continue;
          w.spawnEnemy(s.kind, w.player.x + s.dx, true, s);
          this.pending.splice(i, 1);
        }
        if (!this.pending.length && w.countEnemies() === 0 && this.t > 0.5) {
          const last = this.wave + 1 >= this.waveCount;
          this.state = 'cleared'; this.t = 0; this.hintT = 0;
          w.sfx('waveClear', w.player.x);
          w.banner(last ? 'FLOOR CLEARED' : 'WAVE CLEARED', last ? 'The way up opens' : '', 1.8);
          this.healPool = w.player.maxHp * (this.stageDef.boss ? 0.6 : 0.3);
        }
        break;
      }
      case 'cleared': {
        const p = w.player;
        if (this.healPool > 0 && !p.dead) { const h = Math.min(this.healPool, 40 * dt); this.healPool -= h; p.hp = Math.min(p.maxHp, p.hp + h); }
        if (this.t > 2.2) {
          if (this.wave + 1 < this.waveCount) { this.wave++; this.spawnWave(); }
          else if (this.stage + 1 < FLOORS) {
            this.state = 'transition'; this.fadeDir = 1; this.keepHp = Math.max(p.hp, p.maxHp * 0.6);
            this.afterFade = () => this.enterStage(this.stage + 1, 0, false);
          }
        }
        break;
      }
      case 'bossDown': if (this.t > 3.4) { this.state = 'victory'; this.t = 0; w.sfx('victory', 0); this.music = 'menu'; } break;
    }
  }

  updateTraining(dt) {
    const w = this.world, p = w.player;
    if (this.state === 'trainDead') {
      if (this.t > 1.2) { const x = p.x; w.fighters = w.fighters.filter((f) => f !== p); w.spawnPlayer(x); this.state = 'fight'; }
      return;
    }
    if (!p.dead) { p.hp = Math.min(p.maxHp, p.hp + 12 * dt); w.focus = Math.min(w.maxFocus, w.focus + 25 * dt); }
    if (!w.fighters.some((f) => f.team === 1)) w.spawnEnemy('dummy', clamp(p.x + p.facing * 260, w.minX + 100, w.maxX - 100), true);
  }
}
