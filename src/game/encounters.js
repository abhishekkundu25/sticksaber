// Encounter director: stages, waves, pacing, retries and the training room.
import { clamp } from '../core/math.js';

// Spawn entries are [kind, x offset from the player, delay in seconds].
export const STAGES = [
  { arena: 'causeway', title: 'SPIRE CAUSEWAY', sub: 'Floor I  ·  The Approach', dmg: 1, attackers: 1, music: 'combat',
    waves: [
      { spawns: [['initiate', 380], ['initiate', -420, 1.6]], hint: 'J light  ·  K heavy  ·  SPACE jump  ·  SHIFT dash      Chain lights, then finish with a heavy' },
      { attackers: 2, spawns: [['initiate', 360], ['initiate', -360, 0.6], ['marksman', 640, 1.4]], hint: 'Hold L to guard. Tap it just before a hit lands to PARRY, then strike to riposte. Parried bolts fly back' },
      { attackers: 2, spawns: [['bulwark', 380], ['initiate', -400, 1.2], ['initiate', 540, 2.6]], hint: 'Shields shrug off light attacks. Hold K to charge a heavy, or dash through and hit the back' },
    ] },
  { arena: 'foundry', title: 'FOUNDRY NINE', sub: 'Floor II  ·  The Crucible', dmg: 1.15, attackers: 2, music: 'combat',
    waves: [
      { spawns: [['duelist', 420], ['initiate', -440, 1.8]], hint: 'Duelists read repetition. When you see ADAPTED, change your attack or it will be turned aside' },
      { spawns: [['brute', 500], ['marksman', -620, 2.4]], hint: 'A red flash cannot be blocked. Dash through it, then punish the long recovery' },
      { spawns: [['duelist', -420], ['bulwark', 440, 0.8], ['marksman', 700, 1.8], ['initiate', -580, 3]], hint: 'S + K launches. Follow them up: air lights, then K to spike them back down' },
    ] },
  { arena: 'hall', title: 'EXAMINATION HALL', sub: 'Floor III  ·  The Proctor', dmg: 1.25, attackers: 1, music: 'boss', boss: true,
    waves: [{ spawns: [['proctor', 560]], hint: 'It learns your habits. When it kneels to heal, hit it. I throws your saber across the room' }] },
];

const TRAIN_KEYS = { Digit1: 'initiate', Digit2: 'bulwark', Digit3: 'duelist', Digit4: 'marksman', Digit5: 'brute', Digit6: 'proctor', Digit7: 'dummy' };

export class Director {
  // hooks.setArena(id) must return the arena's playable width.
  constructor(world, hooks) {
    this.world = world; this.hooks = hooks;
    this.state = 'idle'; this.t = 0;
    this.stage = 0; this.wave = 0; this.pending = [];
    this.hint = ''; this.hintT = 0; this.fade = 0; this.fadeDir = 0;
    this.training = false; this.runTime = 0; this.deaths = 0;
    this.music = 'menu';
  }

  get stageDef() { return STAGES[this.stage]; }
  get waveCount() { return this.stageDef.waves.length; }

  startRun(stage = 0) {
    const w = this.world;
    this.training = false; w.training = false;
    w.style.reset(); w.focus = 100; w.stats = { parries: 0, reads: 0, interrupts: 0, kills: 0, dodges: 0, hitsTaken: 0 };
    this.runTime = 0; this.deaths = 0;
    this.enterStage(stage, 0, true);
  }

  startTraining() {
    const w = this.world;
    this.training = true; w.training = true;
    w.fighters.length = 0; w.projectiles.clear(); w.fx.clear();
    w.setArena(this.hooks.setArena('causeway'));
    w.spawnPlayer(-200); w.enemyDmg = 1; w.maxAttackers = 2; w.focus = 300;
    w.spawnEnemy('dummy', 160, false);
    this.state = 'fight'; this.pending.length = 0; this.music = 'combat';
    this.hint = '1 Initiate   2 Bulwark   3 Duelist   4 Marksman   5 Brute   6 Proctor   7 Drone   0 Clear'; this.hintT = 1e9;
    w.banner('TRAINING ROOM', 'Nothing here can end your run', 2.4);
  }

  trainingKey(code) {
    if (!this.training) return;
    const w = this.world;
    if (code === 'Digit0') { w.clearEnemies(); return; }
    const kind = TRAIN_KEYS[code];
    if (!kind) return;
    if (kind === 'proctor' && w.boss && !w.boss.dead) return;
    const p = w.player;
    w.spawnEnemy(kind, p.x + (p.x > 0 ? -1 : 1) * 420, kind !== 'dummy');
  }

  enterStage(stage, wave, fresh) {
    const w = this.world, def = STAGES[stage];
    this.stage = stage; this.wave = wave;
    w.fighters.length = 0; w.projectiles.clear(); w.fx.clear(); w.boss = null; w.marker = null; w.bossChannel = 0;
    w.setArena(this.hooks.setArena(def.arena));
    const hp = fresh || !this.keepHp ? null : this.keepHp;
    const p = w.spawnPlayer(-320);
    if (hp) p.hp = hp;
    // Arrive by drop beam, like everything else on the Spire.
    p.y = -520; p.vy = 500; p.onGround = false; w.fx.beam(p.x, 0.8, p.color);
    w.cam.x = -200; w.rally = 0;
    w.enemyDmg = def.dmg; w.maxAttackers = def.attackers;
    this.state = 'intro'; this.t = 0; this.pending.length = 0;
    this.fade = 1; this.fadeDir = -1;
    this.music = def.music;
    w.banner(def.title, def.sub, 2.6);
  }

  spawnWave() {
    const w = this.world, wave = this.stageDef.waves[this.wave];
    this.pending = wave.spawns.map(([kind, dx, delay = 0]) => ({ kind, dx, t: delay }));
    this.hint = wave.hint; this.hintT = 11;
    w.maxAttackers = wave.attackers ?? this.stageDef.attackers;
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
    this.world.bannerMsg = null;
  }

  update(dt) {
    const w = this.world;
    this.t += dt;
    if (this.fadeDir) { this.fade = clamp(this.fade + this.fadeDir * dt * 1.8, 0, 1); if (this.fade === 0 || this.fade === 1) { const d = this.fadeDir; this.fadeDir = 0; if (d > 0) this.afterFade?.(); } }
    if (this.hintT > 0) this.hintT -= dt;
    for (const e of w.events) {
      if (e.type === 'playerDead' && !this.training) { this.state = 'dead'; this.t = 0; }
      if (e.type === 'playerDead' && this.training) { this.state = 'trainDead'; this.t = 0; }
      if (e.type === 'kill' && e.boss && !this.training) { this.state = 'bossDown'; this.t = 0; this.music = 'none'; }
      if (e.type === 'adapt') this.adaptSeen = true;
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
          w.spawnEnemy(s.kind, w.player.x + s.dx);
          this.pending.splice(i, 1);
        }
        if (!this.pending.length && w.enemies.length === 0 && this.t > 0.5) {
          const last = this.wave + 1 >= this.waveCount;
          this.state = 'cleared'; this.t = 0; this.hintT = 0;
          w.sfx('waveClear', w.player.x);
          w.banner(last ? 'FLOOR CLEARED' : 'WAVE CLEARED', last ? 'The way up opens' : '', 1.8);
          this.healPool = w.player.maxHp * 0.3;
        }
        break;
      }
      case 'cleared': {
        const p = w.player;
        if (this.healPool > 0 && !p.dead) { const h = Math.min(this.healPool, 40 * dt); this.healPool -= h; p.hp = Math.min(p.maxHp, p.hp + h); }
        if (this.t > 2.2) {
          if (this.wave + 1 < this.waveCount) { this.wave++; this.spawnWave(); }
          else if (this.stage + 1 < STAGES.length) {
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
    if (w.enemies.length === 0 && !w.fighters.some((f) => f.team === 1)) w.spawnEnemy('dummy', clamp(p.x + p.facing * 260, w.minX + 100, w.maxX - 100), true);
  }
}
