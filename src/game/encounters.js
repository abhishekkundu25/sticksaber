// Encounter director: runs the generated floors wave by wave, and handles pacing, surprises,
// objectives, the cards and doors between floors, retries and the training room.
import { clamp, seedRng, hash32, makeRng, rand, rng } from '../core/math.js';
import { generateRun, PER, roman, ANOMALIES, MODES, DIFFS, SURPRISES, OBJECTIVES, CHALLENGES, DOORS, CURSES, doorsFor } from './gen.js';
import { newStats } from './world.js';
import { draftAugments, draftPacts, AUG } from './augments.js';
import { draftPowers, POWER_IDS, POWERS } from './powers.js';
import { FORMS, FORM_IDS } from './forms.js';
import { BOONS } from './boons.js';
import { startSurprise, tickSurprise, surpriseEvent, joinSurprise, endSurprise } from './surprises.js';

const TRAIN_KEYS = { Digit1: 'initiate', Digit2: 'bulwark', Digit3: 'duelist', Digit4: 'marksman', Digit5: 'brute', Digit6: 'lancer', Digit7: 'wraith', Digit8: 'drone', Digit9: 'forgemaster', Digit0: 'proctor', Equal: 'dummy' };
const TRAIN_HINT = '1-8 enemies   9 Forgemaster   0 Proctor   [ strain   ] champion   \\ sector boss   B beast   H your Shade   - clear   = target   U power   Y weapon';
const ELITES = ['swift', 'armored', 'volatile'];
// What a card costs at the quartermaster, by rarity (common, rare, legendary, technique).
const PRICE = [45, 80, 150, 110];
const SCORE_K = { easy: 0.7, normal: 1, hard: 1.5 };
const newTally = () => ({ bosses: 0, feats: 0, shades: 0 });

export class Director {
  // hooks.setArena(id, seed, hue) must return the arena's playable width. hooks.onFloor(state) is told
  // each floor reached, with everything needed to resume the run there. hooks.auto makes the director
  // settle every card, door and room by itself (tests and scripted players); hooks.pickDoor(doors, dir)
  // may choose the door for it.
  constructor(world, hooks) {
    this.world = world; this.hooks = hooks;
    this.state = 'idle'; this.t = 0;
    this.seed = 1; this.diff = 'normal'; this.mode = 'climb'; this.run = generateRun(1); this.floors = this.run.floors;
    this.stage = 0; this.wave = 0; this.pending = [];
    this.hint = ''; this.hintT = 0; this.fade = 0; this.fadeDir = 0;
    this.training = false; this.runTime = 0; this.deaths = 0;
    this.draft = null; this.build = {}; this.queue = []; this.bonus = [];
    this.route = null; this.mod = {}; this.sur = null; this.obj = null; this.chal = null; this.tally = newTally();
    this.music = 'menu';
  }

  get stageDef() { return this.floors[this.stage]; }
  get sector() { return this.run.sectors[this.stageDef.sector]; }
  get waveCount() { return this.stageDef.waves.length; }
  get count() { return this.run.count; }
  get lastFloor() { return this.stage === this.run.count - 1; }
  // The Shade arrives after the floor's own waves, as one more that the floor does not admit to.
  get shadeDue() { return this.stageDef.surprise?.type === 'shade'; }
  get score() {
    const w = this.world, T = this.tally;
    return Math.max(0, Math.round((this.stage * 100 + T.bosses * 300 + T.shades * 400 + T.feats * 60 + w.stats.shards - this.deaths * 120) * (SCORE_K[this.diff] || 1)));
  }

  // Start a run at floor index `stage` (0-based). The same seed, difficulty and mode always produce the
  // same run. `saved` restores a build; without it, a run that starts above the first floor is given
  // the picks it would have made on the way up.
  startRun(stage = 0, seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0, diff = 'normal', saved = null, mode = 'climb') {
    const w = this.world;
    this.seed = seed >>> 0 || 1; this.diff = diff; this.mode = MODES[saved?.mode || mode] ? saved?.mode || mode : 'climb';
    this.run = generateRun(this.seed, diff, this.mode); this.floors = this.run.floors;
    stage = clamp(stage, 0, this.run.count - 1);
    seedRng(hash32(this.seed, 0x51ed));
    this.training = false; w.training = false;
    w.roster = this.run.roster.defs;
    w.style.reset(); w.focus = 100; w.stats = newStats();
    this.runTime = saved?.time || 0; this.deaths = saved?.deaths || 0; this.draft = null; this.queue = []; this.bonus = [];
    this.tally = { ...newTally(), ...(saved?.tally || {}) }; this.route = saved?.route || null;
    this.daily = saved?.daily || null; this.won = false;
    w.shards = saved?.shards || 0; w.stats.shards = saved?.earned || 0; w.form2 = null;
    if (saved?.build) { this.build = { ...saved.build }; w.powers = saved.powers.filter((id) => POWERS[id]); if (!w.powers.length) w.powers = ['throw']; }
    else {
      this.build = {}; w.powers = ['throw'];
      for (let n = 1; n <= stage; n++) this.takeFirst(this.offer(n));
    }
    w.powerIdx = clamp(saved?.powerIdx || 0, 0, w.powers.length - 1);
    w.setBuild(this.build);
    // A saved run keeps its weapons. A new run played by a person chooses one before the first floor.
    if (saved?.form) w.setForm(saved.form);
    if (saved?.form2 && FORMS[saved.form2] && this.build.sheath) w.form2 = saved.form2;
    this.enterStage(stage, 0, true);
    if (!saved && !this.hooks.auto && FORM_IDS.length > 1) {
      this.draft = { type: 'form', title: 'CHOOSE YOUR BLADE', sub: 'You can trade it at an armoury on the way up', options: [...FORM_IDS], idx: Math.max(0, FORM_IDS.indexOf(w.formId)), first: true };
      this.state = 'draft'; this.t = 0; w.bannerMsg = null;
      // Then one boon, if any have been earned in earlier runs.
      const r = makeRng(hash32(this.seed, 0xb00a)), have = (this.hooks.boons?.() || []).filter((id) => BOONS[id]);
      for (let i = have.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [have[i], have[j]] = [have[j], have[i]]; }
      if (have.length) this.queue = [{ type: 'boon', title: 'CHOOSE A BOON', sub: 'Earned on earlier climbs', options: have.slice(0, 3), kinds: have.slice(0, 3).map(() => 'boon'), idx: 0, first: true }];
    }
  }

  startTraining() {
    const w = this.world;
    this.training = true; w.training = true; this.draft = null; this.queue = []; this.bonus = [];
    w.fighters.length = 0; w.projectiles.clear(); w.fx.clear();
    w.setArena(this.hooks.setArena('causeway', 0, 0));
    w.bonds.length = 0; w.finisher = null; w.lessonOn = false; this.lesson = null;
    this.sur = null; this.obj = null; this.chal = null; this.mod = {}; this.route = null; w.dark = 0; w.zone = null; w.herd = null; w.frail = 1;
    w.setTerrain({ plats: [{ fx: 0.45, y: -150, w: 260 }], vents: [], walls: false });
    this.run = generateRun((Math.random() * 0xffffffff) >>> 0 || 1); this.floors = this.run.floors;
    w.roster = this.run.roster.defs;
    w.hpMul = 1; w.rateMul = 1; w.cdMul = 1; w.gravK = 1; w.anom = null; w.freeCast = false; w.windUsed = false;
    this.build = {}; w.bonusHp = 0; w.setBuild(this.build); w.powers = [...POWER_IDS]; w.powerIdx = 0; w.form2 = null;
    if (!FORMS[w.formId]) w.setForm('saber');
    w.spawnPlayer(-200); w.enemyDmg = 1; w.maxAttackers = 2; w.focus = w.maxFocus; w.floor = 100;
    w.spawnEnemy('dummy', 160, false);
    this.state = 'fight'; this.pending.length = 0; this.music = 'combat';
    this.hint = TRAIN_HINT; this.hintT = 1e9;
    w.banner('TRAINING ROOM', 'Nothing here can end your run', 2.4);
  }

  trainingKey(code) {
    if (!this.training) return;
    const w = this.world, R = this.run.roster, p = w.player;
    if (code === 'Minus') { w.clearEnemies(); return; }
    // Y tries the next weapon form.
    if (code === 'KeyY') { w.setForm(FORM_IDS[(FORM_IDS.indexOf(w.formId) + 1) % FORM_IDS.length]); w.banner(w.form.name, w.form.text, 1.6); return; }
    if (code === 'KeyH') { if (!w.boss || w.boss.dead) w.spawnShade(2, p.x + (p.x > 0 ? -1 : 1) * 420); return; }
    const any = (list) => list[(Math.random() * list.length) | 0];
    const beasts = R.beasts.filter(Boolean);
    const kind = code === 'BracketLeft' ? any(R.strains.flat()) : code === 'BracketRight' ? any(R.champions) : code === 'Backslash' ? any(R.wardens) : code === 'KeyB' && beasts.length ? any(beasts) : TRAIN_KEYS[code];
    if (!kind) return;
    if (w.def(kind).boss && w.boss && !w.boss.dead) return;
    w.spawnEnemy(kind, p.x + (p.x > 0 ? -1 : 1) * 420, kind !== 'dummy');
  }

  enterStage(stage, wave, fresh) {
    const w = this.world, def = this.floors[stage];
    this.stage = stage; this.wave = wave;
    w.fighters.length = 0; w.projectiles.clear(); w.fx.clear(); w.boss = null; w.marker = null; w.bossChannel = 0;
    w.bonds.length = 0; w.finisher = null; w.lessonOn = false; this.lesson = null; this.groups = {};
    w.setArena(this.hooks.setArena(def.arena, def.arenaSeed, def.hue));
    w.setTerrain(def.terrain);
    const hp = fresh || !this.keepHp ? null : this.keepHp;
    // Every keeper beaten is worth ten points of health for the rest of the run.
    w.bonusHp = def.sector * 10;
    const p = w.spawnPlayer(-320);
    if (hp) p.hp = Math.min(p.maxHp, hp);
    // Arrive by drop beam, like everything else on the Spire.
    p.y = -520; p.vy = 500; p.onGround = false; w.fx.beam(p.x, 0.8, p.color);
    w.cam.x = -200; w.rally = 0;
    // The door taken to get here bends the floor: an elite guard, or a curse.
    const R = this.route, M = w.mods, curse = R?.type === 'cursed' ? R.curse : null;
    this.mod = { elite: R?.type === 'elite', curse, drought: curse === 'drought', swarm: curse === 'swarm', twoCards: !!curse };
    w.enemyDmg = def.dmg; w.hpMul = def.hp * M.enemyHp * (this.mod.elite ? 1.1 : 1); w.rateMul = def.rate * M.enemyRate * (curse === 'haste' ? 1.14 : 1); w.cdMul = def.cd; w.floor = def.n;
    w.frail = curse === 'frail' ? 1.3 : 1; w.dark = curse === 'dusk' ? 0.88 : 0; w.zone = null; w.herd = null;
    w.anom = def.anomaly; w.gravK = def.anomaly === 'lowgrav' ? 0.62 : 1; w.windUsed = false;
    this.sur = null; this.surArm = null; this.obj = null; this.bonus = []; this.queue = []; this.floorT = 0;
    const st = w.stats;
    this.chal = def.challenge ? { ...def.challenge, hits: st.hitsTaken, powers: st.powers, parries: st.parries, air: st.airKills, room: st.hazardKills, fell: !fresh ? false : this.chal?.fell && this.chal.n === def.n, n: def.n } : null;
    this.state = 'intro'; this.t = 0; this.pending.length = 0;
    this.fade = 1; this.fadeDir = -1;
    this.music = def.music;
    if (def.pos === 1 && wave === 0) { w.banner(`SECTOR ${roman(def.sector + 1)}`, `${this.sector.name}  ·  ${def.title}`, 3.2); w.bannerMsg.sector = def.sector; w.bannerMsg.sectors = this.run.sectors.length; if (def.sector > 0) w.sfx('sectorUp', p.x); }
    else w.banner(def.title, curse ? `${def.sub}  ·  CURSED: ${CURSES[curse].name}` : this.mod.elite ? `${def.sub}  ·  ELITE GUARD` : def.sub, 2.6);
    if (def.anomaly || curse) w.sfx('anomaly', p.x);
    this.save();
  }
  save() {
    const w = this.world;
    this.hooks.onFloor?.({ v: 2, seed: this.seed, diff: this.diff, mode: this.mode, daily: this.daily || null, floor: this.stageDef.n, build: { ...this.build }, powers: [...w.powers], powerIdx: w.powerIdx, form: w.formId, form2: w.form2,
      shards: w.shards, earned: w.stats.shards, route: this.route, tally: { ...this.tally }, time: this.runTime, deaths: this.deaths });
  }

  spawnWave() {
    const w = this.world, def = this.stageDef;
    this.groups = {}; this.lesson = null; w.lessonOn = false;
    this.state = 'fight'; this.t = 0;
    if (this.wave >= this.waveCount) return this.shadeArrives();
    const wave = def.waves[this.wave], last = this.wave === this.waveCount - 1;
    this.pending = wave.spawns.map((s) => ({ ...s }));
    this.dress(this.pending);
    this.hint = wave.hint || ''; this.hintT = wave.hint ? 11 : 0;
    // The parry lesson, for a player who has not passed it: one instructor that cannot be hurt until it is parried.
    if (wave.lesson && this.hooks.lesson?.()) {
      this.lesson = { t: 0, base: w.stats.parries };
      w.lessonOn = true; this.hintT = 1e9;
      this.pending.forEach((s, i) => { if (i) s.t += 1000; else s.lesson = true; });
    }
    w.maxAttackers = wave.attackers; w.freeCast = !!w.mods.freeCast;
    if (this.wave > 0) w.banner(`WAVE ${this.wave + 1} / ${this.waveCount}`, '', 1.4);
    if (def.objective && (this.wave === 0 || def.objective.type === 'hunt')) this.startObjective(def.objective, last);
    // A surprise waits for the floor's last wave, so the first one can be read in peace.
    const sur = def.surprise;
    if (sur && last && !this.sur && SURPRISES[sur.type].when !== 'end') this.surArm = SURPRISES[sur.type].when === 'start' ? 0.9 : rand(3, 5.5);
  }
  // What the door that led here adds to a wave.
  dress(list) {
    const w = this.world;
    if (this.mod.swarm && list.length) {
      const free = list.filter((s) => s.g === undefined && !w.def(s.kind).boss);
      if (free.length) { const s = free[(rng() * free.length) | 0]; list.push({ ...s, dx: -s.dx, t: s.t + 0.9, elite: null }); }
    }
    if (this.mod.elite) for (const s of list) {
      const D = w.def(s.kind), b = D.base || D.kind;
      if (!s.elite && !D.boss && b !== 'initiate' && b !== 'drone') s.elite = ELITES[(rng() * 3) | 0];
    }
  }
  shadeArrives() {
    const w = this.world, sur = this.stageDef.surprise, p = w.player;
    this.pending = [];
    this.sur = { type: 'shade', on: true };
    w.dark = 0.55; this.music = 'boss';
    w.banner(SURPRISES.shade.name, SURPRISES.shade.text, 3); w.bannerMsg.alarm = true;
    w.sfx('surprise', p.x); w.flashScreen('#ff2e6e', 0.3); w.shake(0.5); w.slow(0.3, 0.7);
    w.events.push({ type: 'surprise', kind: 'shade' });
    w.spawnShade(sur.tier, clamp(p.x + (p.x > 0 ? -1 : 1) * 480, w.minX + 140, w.maxX - 140));
    w.maxAttackers = 1;
    this.hint = 'YOUR SHADE  ·  It fights with your weapon and your powers. Every cut it makes can be parried'; this.hintT = 9;
  }

  retry() {
    const w = this.world;
    this.deaths++;
    this.keepHp = null;
    if (this.chal) this.chal.fell = true;
    // On the hardest setting a fall costs the whole floor, not just the wave.
    this.enterStage(this.stage, this.stageDef.restart ? 0 : this.wave, true);
    w.focus = Math.max(w.focus, 100); w.style.reset();
    this.state = 'intro'; this.t = 1.4; // shorter intro on a retry
    w.bannerMsg = null;
  }

  // ───────────── objectives ─────────────
  startObjective(o, last) {
    const w = this.world;
    if (o.type === 'hunt') { if (last) this.obj = { type: 'hunt', t: 0, mark: null }; return; }
    this.obj = { type: o.type, t: 0, cycle: 0, gap: 4, done: false };
    if (o.type === 'survive') this.obj.time = o.time;
    else if (o.type === 'hold') { this.obj.need = o.need; w.zone = { x: o.fx * (w.maxX - 220), r: 200, k: 0, on: false, color: '#56e9ff' }; }
    else if (o.type === 'cores') {
      this.obj.cores = o.at.map((fx, i) => {
        const f = w.spawnProp('core', fx * (w.maxX - 200), -560 - i * 60);
        f.vy = 500; f.tag = 'CORE'; f.barT = 1e9; w.fx.beam(f.x, 0.8, f.color);
        return f;
      });
    }
  }
  // Text and progress (0 to 1) of the objective, for the HUD.
  get objective() {
    const o = this.obj;
    if (!o || this.state !== 'fight') return null;
    if (o.type === 'survive') return { name: OBJECTIVES.survive.name, text: `${Math.max(0, Math.ceil(o.time - o.t))} s`, k: clamp(o.t / o.time, 0, 1) };
    if (o.type === 'hold') return { name: OBJECTIVES.hold.name, text: this.world.zone?.on ? 'CHARGING' : 'STAND IN THE RING', k: this.world.zone?.k || 0 };
    if (o.type === 'cores') { const n = o.cores.filter((c) => !c.dead).length; return { name: OBJECTIVES.cores.name, text: `${n} LEFT`, k: 1 - n / o.cores.length }; }
    if (o.type === 'hunt') return o.mark && !o.mark.dead ? { name: OBJECTIVES.hunt.name, text: o.mark.def.name.toUpperCase(), k: 1 - o.mark.hp / o.mark.maxHp } : null;
    return null;
  }
  get challenge() {
    const c = this.chal;
    if (!c) return null;
    const st = this.world.stats, C = CHALLENGES[c.type];
    const ok = c.fell ? false : c.type === 'untouched' ? st.hitsTaken === c.hits : c.type === 'swift' ? this.floorT <= c.time : c.type === 'pure' ? st.powers === c.powers
      : c.type === 'parry' ? st.parries - c.parries >= 3 : c.type === 'aerial' ? st.airKills - c.air >= 2 : st.hazardKills - c.room >= 1;
    // `open` is true while the outcome can still change.
    const open = !c.fell && (c.type === 'parry' || c.type === 'aerial' || c.type === 'room' ? !ok : ok);
    const count = c.type === 'parry' ? `${Math.min(3, st.parries - c.parries)}/3` : c.type === 'aerial' ? `${Math.min(2, st.airKills - c.air)}/2` : c.type === 'swift' ? `${Math.max(0, Math.ceil(c.time - this.floorT))} s` : '';
    return { name: C.name, text: typeof C.text === 'function' ? C.text(c) : C.text, pay: C.pay, ok, open, count };
  }
  // The floor's enemies leave: the objective is met and they have no reason to stay.
  rout(kill) {
    const w = this.world;
    for (const f of w.fighters) {
      if (f.team !== 1 || f.dead || f.phantom || f.def.boss) continue;
      if (kill && !f.def.prop) { f.die((f.x >= w.player.x ? 1 : -1) * 420, -480, rand(-6, 6)); w.fx.zap(f.cx, -700, f.cx, f.cy, '#56e9ff', 0.3); w.fx.spark(f.cx, f.cy, 0, 3.14, 14, 600, f.color); }
      else { f.remove = true; w.fx.beam(f.x, 0.6, f.color); }
    }
    this.pending.length = 0;
  }
  tickObjective(dt) {
    const w = this.world, o = this.obj, def = this.stageDef, p = w.player;
    if (!o || o.done || p.dead) return;
    o.t += dt;
    if (o.type === 'hunt') {
      if (!o.mark && !this.pending.length) {
        // The toughest thing in the room carries the mark.
        let best = null;
        for (const f of w.fighters) if (f.team === 1 && !f.dead && !f.phantom && !f.def.boss && !f.def.prop && !f.riding && (!best || f.maxHp > best.maxHp)) best = f;
        if (!best) return;
        o.mark = best; best.mark = true; best.tag = 'MARK'; best.barT = 1e9; best.hp = best.maxHp = Math.round(best.maxHp * 1.6);
        w.fx.ring(best.cx, best.cy, 160, 20, 0.5, '#ffd36b', 1, 5); w.sfx('markSet', best.x);
      } else if (o.mark?.dead) {
        o.done = true; this.rout(false);
        w.banner('THE MARK FALLS', 'The rest lose their nerve', 2); w.sfx('objectiveDone', p.x); w.dropShards(p.x, -80, 30);
      }
      return;
    }
    // Reinforcements: the floor's own waves, over and over, each time the room thins out.
    let foes = 0;
    for (const f of w.fighters) if (f.team === 1 && !f.dead && !f.phantom && !f.def.prop) foes++;
    if ((o.gap -= dt) <= 0 && !this.pending.length && foes <= 1) {
      o.cycle++; o.gap = 5;
      this.pending = def.waves[o.cycle % def.waves.length].spawns.map((s) => ({ ...s, t: s.t + 0.6 }));
      this.dress(this.pending); this.groups = {}; this.cycleWave = o.cycle % def.waves.length;
    }
    let won = false;
    if (o.type === 'survive') won = o.t >= o.time;
    else if (o.type === 'hold') {
      const z = w.zone;
      z.on = Math.abs(p.x - z.x) < z.r && !p.rag;
      z.k = clamp(z.k + (z.on ? dt / o.need : -dt / (o.need * 3)), 0, 1);
      won = z.k >= 1;
    } else if (o.type === 'cores') won = o.cores.every((c) => c.dead);
    if (!won) return;
    o.done = true;
    if (o.type === 'hold') {
      const z = w.zone;
      w.fx.ring(z.x, -4, 30, 1400, 0.8, z.color, 0.25, 10); w.fx.ring(z.x, -80, 20, 700, 0.6, '#ffffff', 1, 8); w.fx.flash(z.x, -80, 420, z.color, 0.4);
      w.flashScreen(z.color, 0.35); w.shake(0.9); w.stop(0.14, true); w.sfx('beaconFire', z.x);
    }
    this.rout(o.type !== 'survive');
    w.banner(o.type === 'survive' ? 'THEY BREAK OFF' : o.type === 'hold' ? 'THE RING FIRES' : 'SIGNAL CUT', '', 1.8);
    w.sfx('objectiveDone', p.x); w.dropShards(p.x, -80, 35);
    this.wave = this.waveCount - 1;
  }

  // ───────────── cards, doors and rooms ─────────────
  // What floor `n` pays out when it is cleared: three augments, or three powers after a champion.
  // `lift` raises the tier by one (the reward for taking an elite door).
  offer(n, lift = false) {
    const def = this.floors[n - 1], w = this.world;
    if (!def.reward) return null;
    const r = makeRng(hash32(this.seed, 0xd4af + n * 131));
    if (def.reward === 'power') {
      const options = draftPowers(w.powers, r);
      if (options.length) return { type: 'power', title: 'CHOOSE A POWER', sub: 'The champion falls. Take what it guarded', options, idx: 0 };
    }
    const tier = Math.min(2, (def.reward === 'legend' ? 2 : def.reward === 'augment' ? 0 : 1) + (lift && def.reward !== 'legend' ? 1 : 0));
    const d = this.cards(r, tier === 2 && def.reward !== 'legend' ? 1 : tier, n, tier === 2 ? 'The keeper falls' : lift ? 'The elite guard falls' : `Floor ${n} cleared`);
    if (!d) return null;
    // Now and then a weapon lies among the cards: taking it trades the blade in hand.
    const rw = makeRng(hash32(this.seed, 0x3ea9 + n * 17));
    if (def.reward !== 'legend' && n > 2 && rw() < 0.16 && d.options.length === 3) {
      const others = FORM_IDS.filter((id) => id !== w.formId && id !== w.form2);
      if (others.length) { d.options[2] = others[(rw() * others.length) | 0]; d.kinds[2] = 'form'; }
    }
    return d;
  }
  cards(r, tier, n, sub) {
    const options = draftAugments(this.build, r, tier, n);
    if (!options.length) return null;
    return { type: 'augment', title: tier === 2 ? 'CHOOSE A LEGEND' : 'CHOOSE AN AUGMENT', sub, options, kinds: options.map(() => 'aug'), idx: Math.min(1, options.length - 1) };
  }
  shop(n) {
    const w = this.world, r = makeRng(hash32(this.seed, 0x540b + n * 71)), K = w.mods.shopK;
    const ids = [...draftAugments(this.build, r, 1, n), ...draftAugments(this.build, r, 2, n).slice(0, 1)].filter((id, i, a) => a.indexOf(id) === i).slice(0, 4);
    const d = { type: 'shop', title: 'QUARTERMASTER', sub: 'Spend what the fallen left behind', options: ids, kinds: ids.map(() => 'aug'), prices: ids.map((id) => Math.round(PRICE[Math.min(3, AUG[id].r)] * K)), sold: [], idx: 0, skip: 'LEAVE' };
    const others = FORM_IDS.filter((id) => id !== w.formId && id !== w.form2);
    if (others.length) { d.options.push(others[(r() * others.length) | 0]); d.kinds.push('form'); d.prices.push(Math.round(60 * K)); }
    d.options.push('heal'); d.kinds.push('item'); d.prices.push(Math.round(35 * K));
    return d;
  }
  shrine(n) {
    const options = draftPacts(this.build, makeRng(hash32(this.seed, 0x9ac7 + n * 37)));
    return options.length ? { type: 'pact', title: 'THE SHRINE OFFERS A PACT', sub: 'Each gives much and takes something back. It cannot be undone', options, kinds: options.map(() => 'aug'), idx: 1, skip: 'REFUSE' } : null;
  }
  armory(n) {
    const w = this.world, r = makeRng(hash32(this.seed, 0xa4a0 + n * 29)), others = FORM_IDS.filter((id) => id !== w.formId && id !== w.form2);
    for (let i = others.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [others[i], others[j]] = [others[j], others[i]]; }
    const options = others.slice(0, 3);
    return options.length ? { type: 'armory', title: 'ARMOURY', sub: this.build.sheath ? 'The blade you hold goes to your second sheath' : 'Trade the blade you hold. Your build comes with you', options, kinds: options.map(() => 'form'), idx: 0, skip: 'KEEP YOUR BLADE' } : null;
  }
  doors(n) {
    const list = doorsFor(this.run, n);
    return list ? { type: 'doors', title: 'CHOOSE YOUR WAY', sub: this.floors[n].kind === 'boss' ? 'A keeper waits above' : this.floors[n].kind === 'champion' ? 'A champion waits above' : `Floor ${n + 1} is next`, doors: list,
      options: list.map((d) => d.type), kinds: list.map(() => 'door'), idx: 0 } : null;
  }
  takeFirst(d) { if (d) this.take(d, 0, true); }
  take(d, i, quiet = false) {
    const w = this.world, id = d.options[i], kind = d.kinds?.[i] || (d.type === 'power' ? 'power' : d.type === 'form' ? 'form' : 'aug');
    if (kind === 'power') { w.powers.push(id); if (!quiet) w.powerIdx = w.powers.length - 1; }
    else if (kind === 'form') {
      // With a second sheath the old blade is kept; without one it is traded away.
      if (!d.first && this.build.sheath && id !== w.formId) w.form2 = w.formId;
      w.setForm(id);
    } else if (kind === 'item') { const p = w.player; p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.4); }
    else if (kind === 'boon') { BOONS[id].apply(w, this, makeRng(hash32(this.seed, 0xb00b))); w.setBuild(this.build); w.player.hp = w.player.maxHp; }
    else {
      this.build[id] = (this.build[id] || 0) + 1; w.setBuild(this.build);
      AUG[id].once?.(w, this);
    }
    return id;
  }
  // Called by the shell when the player confirms a card. `i` of -1 leaves a room that allows it.
  choose(i) {
    const d = this.draft, w = this.world;
    if (!d || this.state !== 'draft') return;
    if (i < 0) { if (d.skip) { w.sfx('uiBack', w.player.x); this.draft = null; this.next(); } return; }
    if (i >= d.options.length) return;
    if (d.type === 'doors') { w.sfx('doorPick', w.player.x); this.draft = null; this.through(d.doors[i]); return this.next(); }
    if (d.type === 'shop') {
      if (d.sold[i]) return;
      if (w.shards < d.prices[i]) { w.sfx('uiDeny', w.player.x); d.deny = 0.4; return; }
      w.shards -= d.prices[i]; d.sold[i] = true; this.take(d, i);
      w.sfx('buy', w.player.x); this.save();
      return;
    }
    const id = this.take(d, i), kind = d.kinds?.[i] || d.type;
    w.sfx(d.type === 'pact' ? 'pactTake' : 'draftPick', w.player.x);
    this.draft = null;
    if (d.first) {
      // The blade, then a boon if one has been earned, are chosen before the first wave. After them
      // the floor's introduction carries on.
      const more = this.queue.shift();
      if (more) { this.draft = more; this.t = 0; return; }
      const def = this.stageDef;
      this.state = 'intro'; this.t = 0; this.save();
      w.banner(def.pos === 1 ? `SECTOR ${roman(def.sector + 1)}` : def.title, def.pos === 1 ? `${this.sector.name}  ·  ${def.title}` : def.sub, 3); if (def.pos === 1) w.bannerMsg.sector = def.sector; w.bannerMsg.sectors = this.run.sectors.length;
      return;
    }
    this.picked = { name: kind === 'power' ? POWERS[id].name : kind === 'form' ? FORMS[id].name : AUG[id].name.toUpperCase(), t: 1.6 };
    this.next();
  }
  // Go through a door: it either bends the next floor or leads to a room first.
  through(door) {
    const w = this.world, p = w.player, n = this.stageDef.n;
    let type = door.type;
    if (type === 'unknown') { type = door.hidden; this.picked = { name: type === 'gift' ? 'A GIFT' : DOORS[type].name, t: 1.8 }; }
    this.route = type === 'elite' || type === 'cursed' ? { type, curse: door.curse } : null;
    if (type === 'rest') { p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.45 * w.mods.healK); w.sfx('rest', p.x); this.picked = { name: 'RESTED', t: 1.6 }; }
    else if (type === 'gift') { w.shards += 60; w.stats.shards += 60; w.sfx('buy', p.x); }
    else if (type === 'shop') this.queue.unshift(this.shop(n));
    else if (type === 'shrine') this.queue.unshift(this.shrine(n));
    else if (type === 'armory') this.queue.unshift(this.armory(n));
  }
  // The floor is over: settle what it pays, then offer the doors.
  finishFloor() {
    const n = this.stageDef.n, r2 = makeRng(hash32(this.seed, 0x2c4d + n * 97));
    this.queue = [this.offer(n, this.mod.elite)];
    for (const b of this.bonus) this.queue.push(this.cards(makeRng(hash32(this.seed, 0x7b0b + n * 61 + this.queue.length)), b === 'legend' ? 2 : 1, n, b === 'legend' ? 'Your Shade leaves this behind' : 'A card from the fallen'));
    if (this.mod.twoCards) this.queue.push(this.cards(r2, 0, n, 'The curse lifts. Take a second card'));
    if (this.mod.elite) { this.world.shards += 40; this.world.stats.shards += 40; }
    this.queue.push(this.doors(n));
    this.bonus = []; this.route = null;
    this.next();
  }
  next() {
    const w = this.world;
    for (;;) {
      const d = this.queue.shift();
      if (d === undefined) return this.advance();
      if (!d) continue;
      if (!this.hooks.auto) { this.draft = d; this.state = 'draft'; this.t = 0; w.sfx(d.type === 'doors' ? 'doorsOpen' : 'draftOpen', w.player.x); w.bannerMsg = null; return; }
      this.settle(d);
    }
  }
  // A scripted player's answer to a card screen: the first card, the safe door unless it is hurt,
  // whatever it can afford at the quartermaster, and no pacts.
  settle(d) {
    const w = this.world;
    if (d.type === 'doors') {
      const p = w.player;
      let i = this.hooks.pickDoor ? this.hooks.pickDoor(d.doors, this) : -1;
      if (i < 0 || i >= d.doors.length) {
        const want = p.hp < p.maxHp * 0.55 ? ['rest', 'shop', 'stair'] : ['shop', 'stair', 'rest', 'armory'];
        i = Math.max(0, want.map((t) => d.options.indexOf(t)).find((k) => k >= 0) ?? 0);
      }
      this.through(d.doors[i]);
    } else if (d.type === 'shop') {
      for (let i = 0; i < d.options.length; i++) {
        if (d.kinds[i] === 'form' || w.shards < d.prices[i]) continue;
        if (d.kinds[i] === 'item' && w.player.hp > w.player.maxHp * 0.6) continue;
        w.shards -= d.prices[i]; this.take(d, i, true);
      }
    } else if (d.type !== 'pact' && d.type !== 'armory') this.take(d, 0, true);
  }
  advance() {
    const p = this.world.player;
    this.state = 'transition'; this.fadeDir = 1; this.keepHp = Math.max(p.hp, p.maxHp * 0.4);
    this.afterFade = () => this.enterStage(this.stage + 1, 0, false);
  }

  update(dt) {
    const w = this.world;
    this.t += dt;
    if (this.fadeDir) { this.fade = clamp(this.fade + this.fadeDir * dt * 1.8, 0, 1); if (this.fade === 0 || this.fade === 1) { const d = this.fadeDir; this.fadeDir = 0; if (d > 0) this.afterFade?.(); } }
    if (this.hintT > 0) this.hintT -= dt;
    if (this.picked && (this.picked.t -= dt) <= 0) this.picked = null;
    if (this.draft?.deny > 0) this.draft.deny -= dt;
    for (const e of w.events) {
      if (e.type === 'playerDead') { this.state = this.training ? 'trainDead' : 'dead'; this.t = 0; }
      if (this.training) continue;
      if (e.type === 'kill' && e.boss) {
        if (e.kind === 'shade') { this.tally.shades++; this.bonus.push('legend'); w.dark = 0; this.music = this.stageDef.music; }
        else this.tally.bosses++;
        if (this.lastFloor && e.kind !== 'shade') { this.state = 'bossDown'; this.t = 0; this.music = 'none'; }
      }
      if (this.sur?.on) surpriseEvent(this, w, this.sur, e);
      this.hooks.onEvent?.(e);
    }
    w.events.length = 0;

    if (this.training) return this.updateTraining(dt);
    if (this.state !== 'dead' && this.state !== 'victory' && this.state !== 'idle' && this.state !== 'draft') this.runTime += dt;

    switch (this.state) {
      case 'intro': if (this.t > 2.0) this.spawnWave(); break;
      case 'fight': {
        this.floorT += dt;
        for (let i = this.pending.length - 1; i >= 0; i--) {
          const s = this.pending[i];
          if ((s.t -= dt) > 0) continue;
          const f = w.spawnEnemy(s.kind, w.player.x + s.dx, true, s);
          this.pending.splice(i, 1);
          if (this.sur?.on) joinSurprise(this, w, this.sur, f);
          // Members of a bonded group arrive together; the bond is made when the last one lands in the list.
          if (s.g !== undefined) {
            const G = this.stageDef.waves[this.obj?.cycle ? this.cycleWave : this.wave]?.groups?.[s.g], list = (this.groups[s.g] ||= []);
            list[s.role] = f;
            if (G && list.filter(Boolean).length === G.n) w.bind(G.type, list);
          }
        }
        if (this.lesson) {
          const L = this.lesson;
          L.t += dt;
          if (w.stats.parries > L.base || L.t > 45) {
            const passed = w.stats.parries > L.base;
            this.lesson = null; w.lessonOn = false; this.hintT = 3;
            for (const s of this.pending) s.t = Math.max(0.8, s.t - 1000);
            if (passed) { w.banner('LESSON PASSED', 'Now strike: a hit after a parry is a riposte', 2.4); w.sfx('tutorialDone', w.player.x); this.hooks.lessonDone?.(); }
          }
        }
        if (this.surArm !== null && (this.surArm -= dt) <= 0 && !w.player.dead) { this.surArm = null; this.sur = startSurprise(this, w, this.stageDef.surprise); }
        if (this.sur?.on) tickSurprise(this, w, this.sur, dt);
        this.tickObjective(dt);
        const held = this.obj && !this.obj.done && this.obj.type !== 'hunt';
        if (!held && !this.pending.length && w.countEnemies() === 0 && this.t > 0.5) this.waveCleared();
        break;
      }
      case 'cleared': {
        const p = w.player;
        if (this.healPool > 0 && !p.dead) { const h = Math.min(this.healPool, 40 * dt); this.healPool -= h; p.hp = Math.min(p.maxHp, p.hp + h); }
        if (this.t > 2.2) {
          if (this.wave + 1 < this.waveCount || (this.shadeDue && this.wave < this.waveCount)) { this.wave++; this.spawnWave(); }
          else if (this.stage + 1 < this.run.count) this.finishFloor();
        }
        break;
      }
      case 'bossDown': if (this.t > 3.4) { this.state = 'victory'; this.t = 0; this.stage = this.run.count - 1; this.won = true; w.sfx('victory', 0); this.music = 'menu'; this.hooks.onEnd?.(true); } break;
    }
  }
  waveCleared() {
    const w = this.world, def = this.stageDef;
    const fake = this.shadeDue && this.wave < this.waveCount;   // the floor only looks finished
    const last = this.wave + 1 >= this.waveCount;
    this.state = 'cleared'; this.t = 0; this.hintT = 0;
    w.sfx('waveClear', w.player.x);
    let sub = !last ? '' : def.kind === 'boss' && !this.lastFloor ? 'The keeper falls  ·  Maximum health +10' : 'The way up opens';
    if (last && !fake) {
      if (this.sur) endSurprise(this, w, this.sur);
      w.dark = 0; w.zone = null;
      const c = this.challenge;
      if (c?.ok) { w.shards += c.pay; w.stats.shards += c.pay; this.tally.feats++; sub = `${c.name}  ·  +${c.pay} shards`; w.sfx('challengeMet', w.player.x); this.hooks.onEvent?.({ type: 'feat', kind: this.chal.type }); }
      this.chal = null;
      this.hooks.onEvent?.({ type: 'floor', n: def.n, kind: def.kind, objective: def.objective?.type });
    }
    w.banner(last ? 'FLOOR CLEARED' : 'WAVE CLEARED', sub, last && def.kind === 'boss' ? 2.4 : 1.8);
    const skip = (def.waves[this.wave]?.noHeal && !last) || this.mod.drought || w.mods.noWaveHeal;
    this.healPool = skip ? 0 : (w.player.maxHp * (def.boss ? 0.6 : def.heal) + w.mods.waveHeal) * w.mods.healK;
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

export { ANOMALIES, PER, DIFFS };
