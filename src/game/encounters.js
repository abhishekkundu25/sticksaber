// Encounter director: runs the hundred generated floors wave by wave, and handles pacing, the draft
// between floors, retries and the training room.
import { clamp, seedRng, hash32, makeRng } from '../core/math.js';
import { generateRun, FLOORS, PER, roman, ANOMALIES } from './gen.js';
import { newStats } from './world.js';
import { draftAugments, AUG } from './augments.js';
import { draftPowers, POWER_IDS, POWERS } from './powers.js';

const TRAIN_KEYS = { Digit1: 'initiate', Digit2: 'bulwark', Digit3: 'duelist', Digit4: 'marksman', Digit5: 'brute', Digit6: 'lancer', Digit7: 'wraith', Digit8: 'drone', Digit9: 'forgemaster', Digit0: 'proctor', Equal: 'dummy' };
const TRAIN_HINT = '1-8 enemies   9 Forgemaster   0 Proctor   [ strain   ] champion   \\ sector boss   - clear   = target   U switch power';

export class Director {
  // hooks.setArena(id, seed, hue) must return the arena's playable width. hooks.onFloor(state) is told
  // each floor reached, with everything needed to resume the run there. hooks.auto makes the director
  // take the first option of every draft by itself (tests and scripted players).
  constructor(world, hooks) {
    this.world = world; this.hooks = hooks;
    this.state = 'idle'; this.t = 0;
    this.seed = 1; this.diff = 'normal'; this.run = generateRun(1); this.floors = this.run.floors;
    this.stage = 0; this.wave = 0; this.pending = [];
    this.hint = ''; this.hintT = 0; this.fade = 0; this.fadeDir = 0;
    this.training = false; this.runTime = 0; this.deaths = 0;
    this.draft = null; this.build = {};
    this.music = 'menu';
  }

  get stageDef() { return this.floors[this.stage]; }
  get sector() { return this.run.sectors[this.stageDef.sector]; }
  get waveCount() { return this.stageDef.waves.length; }
  get lastFloor() { return this.stage === FLOORS - 1; }

  // Start a run at floor index `stage` (0-based). The same seed and difficulty always produce the same
  // run. `saved` restores a build; without it, a run that starts above the first floor is given the
  // picks it would have made on the way up.
  startRun(stage = 0, seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0, diff = 'normal', saved = null) {
    const w = this.world;
    this.seed = seed >>> 0 || 1; this.diff = diff;
    this.run = generateRun(this.seed, diff); this.floors = this.run.floors;
    seedRng(hash32(this.seed, 0x51ed));
    this.training = false; w.training = false;
    w.roster = this.run.roster.defs;
    w.style.reset(); w.focus = 100; w.stats = newStats();
    this.runTime = saved?.time || 0; this.deaths = saved?.deaths || 0; this.draft = null;
    if (saved?.build) { this.build = { ...saved.build }; w.powers = saved.powers.filter((id) => POWERS[id]); if (!w.powers.length) w.powers = ['throw']; }
    else {
      this.build = {}; w.powers = ['throw'];
      for (let n = 1; n <= stage; n++) this.takeFirst(this.offer(n));
    }
    w.powerIdx = clamp(saved?.powerIdx || 0, 0, w.powers.length - 1);
    w.setBuild(this.build);
    this.enterStage(stage, 0, true);
  }

  startTraining() {
    const w = this.world;
    this.training = true; w.training = true; this.draft = null;
    w.fighters.length = 0; w.projectiles.clear(); w.fx.clear();
    w.setArena(this.hooks.setArena('causeway', 0, 0));
    this.run = generateRun((Math.random() * 0xffffffff) >>> 0 || 1); this.floors = this.run.floors;
    w.roster = this.run.roster.defs;
    w.hpMul = 1; w.rateMul = 1; w.cdMul = 1; w.gravK = 1; w.anom = null; w.freeCast = false; w.windUsed = false;
    this.build = {}; w.bonusHp = 0; w.setBuild(this.build); w.powers = [...POWER_IDS]; w.powerIdx = 0;
    w.spawnPlayer(-200); w.enemyDmg = 1; w.maxAttackers = 2; w.focus = w.maxFocus; w.floor = FLOORS;
    w.spawnEnemy('dummy', 160, false);
    this.state = 'fight'; this.pending.length = 0; this.music = 'combat';
    this.hint = TRAIN_HINT; this.hintT = 1e9;
    w.banner('TRAINING ROOM', 'Nothing here can end your run', 2.4);
  }

  trainingKey(code) {
    if (!this.training) return;
    const w = this.world, R = this.run.roster;
    if (code === 'Minus') { w.clearEnemies(); return; }
    const any = (list) => list[(Math.random() * list.length) | 0];
    const kind = code === 'BracketLeft' ? any(R.strains.flat()) : code === 'BracketRight' ? any(R.champions) : code === 'Backslash' ? any(R.wardens) : TRAIN_KEYS[code];
    if (!kind) return;
    if (w.def(kind).boss && w.boss && !w.boss.dead) return;
    const p = w.player;
    w.spawnEnemy(kind, p.x + (p.x > 0 ? -1 : 1) * 420, kind !== 'dummy');
  }

  enterStage(stage, wave, fresh) {
    const w = this.world, def = this.floors[stage];
    this.stage = stage; this.wave = wave;
    w.fighters.length = 0; w.projectiles.clear(); w.fx.clear(); w.boss = null; w.marker = null; w.bossChannel = 0;
    w.setArena(this.hooks.setArena(def.arena, def.arenaSeed, def.hue));
    const hp = fresh || !this.keepHp ? null : this.keepHp;
    // Every keeper beaten is worth ten points of health for the rest of the run.
    w.bonusHp = def.sector * 10;
    const p = w.spawnPlayer(-320);
    if (hp) p.hp = Math.min(p.maxHp, hp);
    // Arrive by drop beam, like everything else on the Spire.
    p.y = -520; p.vy = 500; p.onGround = false; w.fx.beam(p.x, 0.8, p.color);
    w.cam.x = -200; w.rally = 0;
    w.enemyDmg = def.dmg; w.hpMul = def.hp; w.rateMul = def.rate; w.cdMul = def.cd; w.floor = def.n;
    w.anom = def.anomaly; w.gravK = def.anomaly === 'lowgrav' ? 0.62 : 1; w.windUsed = false;
    this.state = 'intro'; this.t = 0; this.pending.length = 0;
    this.fade = 1; this.fadeDir = -1;
    this.music = def.music;
    if (def.pos === 1 && wave === 0) { w.banner(`SECTOR ${roman(def.sector + 1)}`, `${this.sector.name}  ·  ${def.title}`, 3.2); w.bannerMsg.sector = def.sector; if (def.sector > 0) w.sfx('sectorUp', p.x); }
    else w.banner(def.title, def.sub, 2.6);
    if (def.anomaly) w.sfx('anomaly', p.x);
    this.hooks.onFloor?.({ seed: this.seed, diff: this.diff, floor: def.n, build: { ...this.build }, powers: [...w.powers], powerIdx: w.powerIdx, time: this.runTime, deaths: this.deaths });
  }

  spawnWave() {
    const w = this.world, wave = this.stageDef.waves[this.wave];
    this.pending = wave.spawns.map((s) => ({ ...s }));
    this.hint = wave.hint || ''; this.hintT = wave.hint ? 11 : 0;
    w.maxAttackers = wave.attackers; w.freeCast = !!w.mods.freeCast;
    this.state = 'fight'; this.t = 0;
    if (this.wave > 0) w.banner(`WAVE ${this.wave + 1} / ${this.waveCount}`, '', 1.4);
  }

  retry() {
    const w = this.world;
    this.deaths++;
    this.keepHp = null;
    // On the hardest setting a fall costs the whole floor, not just the wave.
    this.enterStage(this.stage, this.stageDef.restart ? 0 : this.wave, true);
    w.focus = Math.max(w.focus, 100); w.style.reset();
    this.state = 'intro'; this.t = 1.4; // shorter intro on a retry
    w.bannerMsg = null;
  }

  // ───────────── the draft ─────────────
  // What floor `n` pays out when it is cleared: three augments, or three powers after a champion.
  offer(n) {
    const def = this.floors[n - 1], w = this.world;
    if (!def.reward) return null;
    const r = makeRng(hash32(this.seed, 0xd4af + n * 131));
    if (def.reward === 'power') {
      const options = draftPowers(w.powers, r);
      if (options.length) return { type: 'power', title: 'CHOOSE A POWER', sub: 'The champion falls. Take what it guarded', options, idx: 0 };
    }
    const tier = def.reward === 'legend' ? 2 : def.reward === 'augment' ? 0 : 1;
    const options = draftAugments(this.build, r, tier, n);
    if (!options.length) return null;
    return { type: 'augment', title: tier === 2 ? 'CHOOSE A LEGEND' : 'CHOOSE AN AUGMENT', sub: tier === 2 ? 'The keeper falls' : `Floor ${n} cleared`, options, idx: Math.min(1, options.length - 1) };
  }
  takeFirst(d) { if (d) this.take(d, 0, true); }
  take(d, i, quiet = false) {
    const w = this.world, id = d.options[i];
    if (d.type === 'power') { w.powers.push(id); if (!quiet) w.powerIdx = w.powers.length - 1; }
    else { this.build[id] = (this.build[id] || 0) + 1; w.setBuild(this.build); }
    return id;
  }
  // Called by the shell when the player confirms a card.
  choose(i) {
    const d = this.draft;
    if (!d || this.state !== 'draft' || i < 0 || i >= d.options.length) return;
    const id = this.take(d, i);
    this.world.sfx('draftPick', this.world.player.x);
    this.picked = { name: d.type === 'power' ? POWERS[id].name : AUG[id].name.toUpperCase(), t: 1.6 };
    this.draft = null;
    this.advance();
  }
  advance() {
    const p = this.world.player;
    this.state = 'transition'; this.fadeDir = 1; this.keepHp = Math.max(p.hp, p.maxHp * 0.6);
    this.afterFade = () => this.enterStage(this.stage + 1, 0, false);
  }

  update(dt) {
    const w = this.world;
    this.t += dt;
    if (this.fadeDir) { this.fade = clamp(this.fade + this.fadeDir * dt * 1.8, 0, 1); if (this.fade === 0 || this.fade === 1) { const d = this.fadeDir; this.fadeDir = 0; if (d > 0) this.afterFade?.(); } }
    if (this.hintT > 0) this.hintT -= dt;
    if (this.picked && (this.picked.t -= dt) <= 0) this.picked = null;
    for (const e of w.events) {
      if (e.type === 'playerDead') { this.state = this.training ? 'trainDead' : 'dead'; this.t = 0; }
      if (e.type === 'kill' && e.boss && !this.training && this.lastFloor) { this.state = 'bossDown'; this.t = 0; this.music = 'none'; }
    }
    w.events.length = 0;

    if (this.training) return this.updateTraining(dt);
    if (this.state !== 'dead' && this.state !== 'victory' && this.state !== 'idle' && this.state !== 'draft') this.runTime += dt;

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
          const last = this.wave + 1 >= this.waveCount, def = this.stageDef;
          this.state = 'cleared'; this.t = 0; this.hintT = 0;
          w.sfx('waveClear', w.player.x);
          w.banner(last ? 'FLOOR CLEARED' : 'WAVE CLEARED', !last ? '' : def.kind === 'boss' && !this.lastFloor ? 'The keeper falls  ·  Maximum health +10' : 'The way up opens', last && def.kind === 'boss' ? 2.4 : 1.8);
          const skip = def.waves[this.wave].noHeal && !last;
          this.healPool = skip ? 0 : w.player.maxHp * (def.boss ? 0.6 : def.heal) + w.mods.waveHeal;
        }
        break;
      }
      case 'cleared': {
        const p = w.player;
        if (this.healPool > 0 && !p.dead) { const h = Math.min(this.healPool, 40 * dt); this.healPool -= h; p.hp = Math.min(p.maxHp, p.hp + h); }
        if (this.t > 2.2) {
          if (this.wave + 1 < this.waveCount) { this.wave++; this.spawnWave(); }
          else if (this.stage + 1 < FLOORS) {
            const d = this.offer(this.stageDef.n);
            if (!d) this.advance();
            else if (this.hooks.auto) { this.take(d, 0); this.advance(); }
            else { this.draft = d; this.state = 'draft'; this.t = 0; w.sfx('draftOpen', p.x); w.bannerMsg = null; }
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
    if (!p.dead) { p.hp = Math.min(p.maxHp, p.hp + 12 * dt); if (w.overdrive <= 0) w.focus = Math.min(w.maxFocus, w.focus + 25 * dt); }
    if (!w.fighters.some((f) => f.team === 1)) w.spawnEnemy('dummy', clamp(p.x + p.facing * 260, w.minX + 100, w.maxX - 100), true);
  }
}

export { ANOMALIES, PER };
