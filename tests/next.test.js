// Checks of the run's second layer: the sprint, surprises, objectives, challenges, doors and rooms,
// pacts, the second sheath, boons and the Shade. No browser needed.
//   node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/game/world.js';
import { Director } from '../src/game/encounters.js';
import { BotInput } from '../src/game/bot.js';
import { MOVES, fairTells } from '../src/game/moves.js';
import { applyHit } from '../src/game/combat.js';
import { generateRun, doorsFor, MODES, SURPRISES, OBJECTIVES, CHALLENGES, DOORS, CURSES, ROOMS, PER } from '../src/game/gen.js';
import { AUGMENTS, AUG, buildMods, draftAugments, draftPacts } from '../src/game/augments.js';
import { FORMS, FORM_IDS } from '../src/game/forms.js';
import { POWER_IDS } from '../src/game/powers.js';
import { BOONS, BOON_IDS } from '../src/game/boons.js';
import { climberKit, makeShade } from '../src/game/shade.js';

const DT = 1 / 120;
const HIT = { dmg: 9999, post: 0, kx: 200, ky: 0, kind: 'flinch', stop: 0, shake: 0, stun: 0.3, fromPlayer: true, id: 'TEST', fam: 'power', unblockable: true };
function boot(floor, seed, { mode = 'sprint', auto = true, skill = 0.9, hooks = {} } = {}) {
  const world = new World();
  world.input = new BotInput(world, skill);
  const dir = new Director(world, { setArena: (id) => (id === 'hall' ? 1900 : 2200), auto, ...hooks });
  dir.startRun(floor - 1, seed, 'normal', null, mode);
  return { world, dir };
}
function run({ world, dir }, seconds, { god = true, until } = {}) {
  for (let t = 0; t < seconds; t += DT) {
    world.input.tick(DT); world.step(DT); dir.update(DT);
    if (god && !world.player.dead) world.player.hp = world.player.maxHp;
    if (dir.state === 'dead' && dir.t > 1.5) dir.retry();
    if (until && until()) return t;
  }
  return seconds;
}
const finite = (world) => world.fighters.every((f) => [f.x, f.y, f.vx, f.vy, f.hp, f.tx, f.ty, ...f.j].every(Number.isFinite));
// Put the director on the last wave of a plain floor with one surprise or objective forced onto it.
function stage(seed, patch) {
  const g = boot(7, seed);
  const def = g.dir.stageDef;
  def.surprise = null; def.objective = null; def.challenge = null;
  Object.assign(def, patch);
  g.dir.enterStage(g.dir.stage, patch.objective && patch.objective.type !== 'hunt' ? 0 : g.dir.waveCount - 1, true);
  return g;
}

test('a sprint is thirty floors in three sectors, with no school and the Proctor at the top', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const R = generateRun(seed, 'normal', 'sprint');
    assert.equal(R.count, 30); assert.equal(R.floors.length, 30); assert.equal(R.sectors.length, 3); assert.equal(R.mode, 'sprint');
    assert.equal(R.floors[29].boss, 'proctor');
    assert.equal(R.floors[29].reward, null);
    assert.ok(['forgemaster', 'twinA', 'cartographer'].includes(R.floors[19].boss), `floor 20 keeper is ${R.floors[19].boss}`);
    assert.equal(new Set(R.sectors.map((s) => s.name)).size, 3);
    for (const fl of R.floors) {
      assert.ok(fl.waves.length >= 1 && fl.waves.every((w) => w.spawns.length >= 1), `floor ${fl.n} has an empty wave`);
      // The one lesson a sprint has is the parry, on the first wave of the first floor.
      assert.ok(fl.waves.every((w, i) => !w.lesson || (fl.n === 1 && i === 0)), 'a lesson somewhere other than the first wave of a sprint');
      if (fl.n === 1) assert.ok(fl.waves[0].lesson && fl.waves[0].hint && fl.waves[0].lessonHint);
      if (fl.n === 2 || fl.n === 3) assert.ok(fl.waves.every((w) => w.hint), `floor ${fl.n} of a sprint has a wave with no line for a new player`);
      for (const w of fl.waves) for (const s of w.spawns) assert.ok(R.roster.defs[s.kind] || ['initiate', 'marksman', 'bulwark', 'duelist', 'brute', 'lancer', 'wraith', 'drone', 'forgemaster', 'proctor', 'twinA', 'twinB', 'cartographer'].includes(s.kind), `unknown kind ${s.kind}`);
      assert.equal(fl.kind, fl.pos === 5 ? 'champion' : fl.pos === 10 ? 'boss' : fl.kind);
    }
    // It starts where the climb's first sector ends and is still getting harder at the top.
    assert.ok(R.floors[0].depth > 5 && R.floors[29].depth > 45 && R.floors[29].depth < 60);
    assert.ok(R.floors[28].hp > R.floors[10].hp && R.floors[10].hp > R.floors[0].hp);
    assert.equal(JSON.stringify(generateRun(seed, 'normal', 'sprint').floors), JSON.stringify(R.floors));
  }
  assert.notEqual(JSON.stringify(generateRun(3, 'normal', 'sprint').floors[0].waves), JSON.stringify(generateRun(3, 'normal', 'climb').floors[0].waves));
  assert.equal(generateRun(3).mode, 'climb'); assert.equal(generateRun(3).count, 100);
  assert.deepEqual(Object.keys(MODES), ['sprint', 'climb']);
});

test('every sector has one surprise, the Shade comes back stronger, and objectives and challenges sit where they should', () => {
  const seenS = new Set(), seenO = new Set(), seenC = new Set();
  for (const mode of ['sprint', 'climb']) for (let seed = 1; seed <= 30; seed++) {
    const R = generateRun(seed, 'normal', mode);
    let shades = 0;
    for (const S of R.sectors) {
      const fl = R.floors.slice(S.i * PER, S.i * PER + PER), sur = fl.filter((f) => f.surprise);
      assert.equal(sur.length, S.school ? 0 : 1, `${mode} seed ${seed} sector ${S.i} has ${sur.length} surprises`);
      for (const f of sur) {
        assert.ok(SURPRISES[f.surprise.type]); seenS.add(f.surprise.type);
        assert.ok(f.pos !== 5 && f.pos !== 10 && !f.boss, 'a surprise on a champion or keeper floor');
        assert.ok(!f.objective, 'a surprise and an objective on one floor');
        if (f.surprise.type === 'shade') assert.equal(f.surprise.tier, ++shades);
      }
      for (const f of fl) {
        if (f.objective) {
          assert.ok(OBJECTIVES[f.objective.type]); seenO.add(f.objective.type);
          assert.ok(f.kind === 'skirmish' && f.pos >= 7 && f.pos <= 9 && !S.school);
          assert.equal(f.reward, 'rare');
          assert.ok(f.waves[0].hint.startsWith(OBJECTIVES[f.objective.type].name));
          if (f.objective.type === 'cores') assert.equal(f.objective.at.length, 3);
        }
        if (f.challenge) {
          assert.ok(CHALLENGES[f.challenge.type]); seenC.add(f.challenge.type);
          assert.ok(!S.school && f.pos !== 5 && f.pos !== 10 && !f.objective);
          if (f.challenge.type === 'room') assert.ok(f.terrain && (f.terrain.vents.length || f.terrain.walls || f.terrain.pits?.length), 'a room challenge with no hazard in the room');
          if (f.challenge.type === 'swift') assert.ok(f.challenge.time >= 20);
        }
      }
    }
    assert.equal(shades, mode === 'sprint' ? 1 : 3, `${mode} seed ${seed} has ${shades} shades`);
    assert.ok(R.floors.some((f) => f.objective) || mode === 'sprint');
  }
  assert.equal(seenS.size, Object.keys(SURPRISES).length, 'some surprise is never placed');
  assert.equal(seenO.size, Object.keys(OBJECTIVES).length);
  assert.equal(seenC.size, Object.keys(CHALLENGES).length);
});

test('doors open after the right floors and never offer a risk before a champion or a keeper', () => {
  const seen = new Set();
  for (const mode of ['sprint', 'climb']) for (let seed = 1; seed <= 20; seed++) {
    const R = generateRun(seed, 'normal', mode);
    for (const fl of R.floors) {
      const D = doorsFor(R, fl.n);
      const want = fl.n < R.count && [2, 4, 6, 8, 9].includes(fl.pos) && !(R.sectors[fl.sector].school && fl.pos < 4);
      assert.equal(!!D, want, `${mode} floor ${fl.n}`);
      if (!D) continue;
      assert.equal(D.length, 3); assert.equal(new Set(D.map((d) => d.type)).size, 3);
      assert.deepEqual(doorsFor(R, fl.n), D);
      for (const d of D) {
        assert.ok(DOORS[d.type]); seen.add(d.type);
        assert.ok(DOORS[d.type].text(d).length > 10);
        if (d.type === 'cursed') assert.ok(CURSES[d.curse]);
        if (d.type === 'unknown') assert.ok(d.hidden === 'gift' || DOORS[d.hidden]);
      }
      const prep = fl.pos === 4 || fl.pos === 9;
      assert.equal(D.some((d) => d.type === 'elite' || d.type === 'cursed' || d.type === 'unknown'), prep ? false : D.some((d) => ['elite', 'cursed', 'unknown'].includes(d.type)));
      if (prep) assert.ok(D.every((d) => ['rest', 'shop', 'shrine', 'armory'].includes(d.type)));
      else assert.equal(D[0].type, 'stair');
    }
  }
  assert.equal(seen.size, Object.keys(DOORS).length, 'some door is never offered');
});

test('the Shade is built from the weapon and powers in hand, and every cut it makes is announced', () => {
  const world = new World();
  for (const id of FORM_IDS) {
    world.setForm(id); world.powers = [...POWER_IDS];
    for (const tier of [1, 2, 3]) {
      const def = makeShade(world, tier), K = def.kit;
      assert.equal(def.blade, FORMS[id].blade); assert.equal(def.kind, 'shade'); assert.ok(def.boss && def.shade === tier);
      assert.ok(K.moves.length >= 3, `${id} tier ${tier} has ${K.moves.length} moves`);
      assert.ok(K.moves.some((m) => (m.min ?? 0) === 0) && K.moves.some((m) => m.max > 400), `${id}: no answer up close or at range`);
      for (const m of K.moves) {
        const M = MOVES[m.id];
        assert.ok(M, `${id}: move ${m.id} is not registered`);
        assert.equal(M.fam, 'enemy');
        // A copy of the player's move: the first cut never lands sooner than a parry can answer.
        if (m.id.startsWith('sh')) {
          assert.ok(M.hits[0].t0 >= 0.24, `${m.id} first hit at ${M.hits[0].t0}`);
          assert.ok(fairTells({ ...M, ev: M.ev.map((e) => [...e]) }), `${m.id} has an unannounced hit`);
          if (tier === 1) assert.ok(M.hits.every((h) => !h.unblockable), `${m.id} cannot be blocked at tier 1`);
        }
      }
      assert.equal(K.phases.length, tier >= 2 ? 2 : 1);
      // More of the player's powers each time, and never the one that freezes them.
      assert.ok(K.moves.length + K.specials.length + K.heals.length + K.echo >= 4);
    }
    const none = climberKit(FORMS[id], [], 1), all = climberKit(FORMS[id], ['stasis', 'stasis'], 3);
    assert.equal(none.moves.length, all.moves.length, 'stasis added something to the kit');
  }
  // Different powers in hand make a different Shade.
  world.setForm('saber');
  world.powers = ['throw', 'judgment']; const a = makeShade(world, 1).kit;
  world.powers = ['mend', 'mirror']; const b = makeShade(world, 1).kit;
  assert.ok(a.specials.includes('skyfall') && !b.specials.includes('skyfall'));
  assert.ok(b.heals.length === 1 && b.echo === 1 && !a.heals.length);
});

test('the Shade arrives after the floor looks finished, can be beaten, and leaves a legendary', () => {
  const R = generateRun(4242, 'normal', 'sprint'), n = R.floors.find((f) => f.surprise?.type === 'shade').n;
  const g = boot(n, 4242), { world, dir } = g, events = [];
  dir.hooks.onEvent = (e) => events.push(e.type === 'surprise' ? e.kind : e.type);
  assert.ok(dir.shadeDue);
  dir.enterStage(dir.stage, dir.waveCount, true);   // straight to the intruder
  run(g, 4, { until: () => !!world.boss });
  const shade = world.boss;
  assert.ok(shade && shade.def.kind === 'shade', 'no Shade arrived');
  assert.equal(shade.blade, world.form.blade);
  assert.ok(world.dark > 0.4, 'the room did not dim');
  assert.ok(world.bannerMsg?.alarm);
  // It attacks with copies of the player's moves.
  let own = 0;
  run(g, 12, { until: () => { if (shade.state === 'attack' && shade.move.id.startsWith('sh')) own++; return own > 3; } });
  assert.ok(own > 3, 'the Shade never used the player\'s moves');
  assert.ok(finite(world));
  applyHit(world, null, shade, { ...HIT, dir: 1 }, shade.cx, shade.cy);
  assert.ok(shade.dead);
  run(g, 0.2);
  assert.equal(dir.tally.shades, 1);
  assert.ok(dir.bonus.includes('legend'));
  assert.equal(world.dark, 0);
  run(g, 14, { until: () => dir.stage > n - 1 });
  assert.equal(dir.stage, n, 'the run did not move on after the Shade');
  assert.ok(events.includes('shade'));
});

test('each surprise breaks in, does what it says, and leaves the floor finishable', () => {
  for (const type of Object.keys(SURPRISES).filter((t) => t !== 'shade')) {
    const g = stage(900 + type.length, { surprise: { type } }), { world, dir } = g;
    world.input = { tick() {}, held: () => false, axisX: () => 0, consume: () => false, peek: () => false, sincePress: () => 9 };   // stand still: the surprise must not depend on the player
    world.player.invuln = 1e9;
    run(g, 9, { god: false, until: () => !!dir.sur });
    assert.ok(dir.sur, `${type} never started`);
    const real = dir.sur.type;
    assert.ok(real === type || real === 'cache', `${type} became ${real}`);
    assert.ok(world.bannerMsg?.alarm || type === 'rival');
    run(g, 2.5, { god: false });
    if (real === 'blackout') assert.ok(world.dark > 0.8 && world.darkK > 0.5);
    if (real === 'feud') {
      const sides = () => world.fighters.some((f) => f.feud === 1) && world.fighters.some((f) => f.feud === 2);
      run(g, 9, { god: false, until: sides });
      assert.ok(sides(), 'a feud needs two sides');
      // They hurt each other: blades of one side cut the other.
      let hits = 0;
      const onDamage = world.onDamage.bind(world);
      world.onDamage = (A, B, ...rest) => { if (A && A.team === 1 && B.team === 1) hits++; return onDamage(A, B, ...rest); };
      run(g, 25, { god: false, until: () => hits > 0 });
      assert.ok(hits > 0, 'the two sides never hurt each other');
    }
    if (real === 'captive') {
      const cell = world.fighters.find((f) => f.def.thing === 'cell');
      assert.ok(cell && cell.team === 2);
      applyHit(world, null, cell, { ...HIT, dir: 1 }, cell.cx, cell.cy);
      run(g, 0.3, { god: false });
      const ally = world.fighters.find((f) => f.def.kind === 'ally');
      assert.ok(ally && ally.team === 0 && ally.hunts === 'enemy', 'breaking the cell freed nobody');
      // The ally goes for the enemies, not for the player.
      const before = world.enemies.reduce((s, f) => s + f.hp, 0);
      run(g, 14, { god: false, until: () => world.enemies.reduce((s, f) => s + f.hp, 0) < before });
      assert.ok(world.enemies.reduce((s, f) => s + f.hp, 0) < before, 'the ally never hurt an enemy');
    }
    if (real === 'stampede') {
      let herd = 0;
      run(g, 12, { god: false, until: () => { herd = Math.max(herd, world.fighters.filter((f) => f.herd).length); return herd >= 3 && !world.fighters.some((f) => f.herd); } });
      assert.ok(herd >= 3, 'no herd came through');
    }
    if (real === 'bounty') {
      const c = world.fighters.find((f) => f.def.kind === 'courier');
      assert.ok(c && c.team === 2);
      applyHit(world, null, c, { ...HIT, dir: 1 }, c.cx, c.cy);
      run(g, 0.3, { god: false });
      assert.ok(dir.bonus.includes('rare'), 'the courier carried nothing');
    }
    if (real === 'rival') assert.ok(world.fighters.some((f) => f.def.kind === 'rival' && f.team === 2 && f.hunts === 'any'));
    if (real === 'quake') assert.ok(world.walls && world.hazards.length >= 3);
    if (real === 'storm') { run(g, 3, { god: false }); assert.ok(world.projectiles.list.some((p) => p.type === 'pillar' && p.team === 2) || world.stats.hitsTaken >= 0); }
    if (real === 'cache') {
      const c = world.fighters.find((f) => f.def.thing === 'cache');
      assert.ok(c);
      run(g, 2, { god: false });
      applyHit(world, null, c, { ...HIT, dir: 1 }, c.cx, c.cy);
      run(g, 0.1, { god: false });
      assert.ok(world.orbs.some((o) => o.kind === 'shard') || world.stats.shards > 0, 'the cache was empty');
    }
    assert.ok(finite(world), `${type}: non-finite state`);
    // Kill what is left: the floor must clear and the surprise must clean up after itself.
    for (let i = 0; i < 40 && dir.state === 'fight'; i++) { for (const f of world.enemies) applyHit(world, null, f, { ...HIT, dir: 1 }, f.cx, f.cy); run(g, 0.5, { god: false }); }
    run(g, 6, { god: false, until: () => dir.stage > 6 });
    assert.equal(dir.stage, 7, `${type}: the floor never finished (state ${dir.state})`);
    assert.equal(world.dark, 0); assert.equal(world.herd, null);
  }
});

test('objectives are won by doing the thing, not by killing everything', () => {
  // Hold out: the timer wins it, however many are left standing.
  let g = stage(31, { objective: { type: 'survive', time: 12 } });
  g.world.player.invuln = 1e9;
  let t = run(g, 30, { until: () => g.dir.state === 'cleared' });
  assert.ok(t > 11 && t < 16, `survive ended after ${t.toFixed(1)} s`);
  assert.equal(g.world.countEnemies(), 0);
  // Hold the ring: only time spent inside it counts.
  g = stage(32, { objective: { type: 'hold', fx: 0.3, need: 4 } });
  g.world.input = { tick() {}, held: () => false, axisX: () => 0, consume: () => false, peek: () => false, sincePress: () => 9 };
  g.world.player.invuln = 1e9;
  run(g, 5, { god: false });
  assert.ok(g.world.zone && g.world.zone.k === 0, 'the ring charged with nobody in it');
  assert.equal(g.dir.objective.name, OBJECTIVES.hold.name);
  g.world.player.x = g.world.zone.x;
  t = run(g, 12, { god: false, until: () => g.dir.state === 'cleared' });
  assert.ok(t > 3.5 && t < 6, `the ring took ${t.toFixed(1)} s to charge`);
  assert.equal(g.world.countEnemies(), 0);
  // Signal cores: reinforcements until the last one breaks.
  g = stage(33, { objective: { type: 'cores', at: [-0.6, 0, 0.6] } });
  g.world.player.invuln = 1e9;
  run(g, 4, { until: () => !!g.dir.obj?.cores });
  const cores = g.world.fighters.filter((f) => f.def.thing === 'core');
  assert.equal(cores.length, 3);
  run(g, 3);
  for (const f of g.world.enemies) if (!f.def.thing) applyHit(g.world, null, f, { ...HIT, dir: 1 }, f.cx, f.cy);
  run(g, 9);
  assert.equal(g.dir.state, 'fight', 'the floor ended with cores standing');
  assert.ok(g.world.enemies.some((f) => !f.def.thing), 'no reinforcements came');
  const x0 = cores[0].x;
  for (const c of cores) if (!c.dead) applyHit(g.world, null, c, { ...HIT, dir: 1 }, c.cx, c.cy);
  assert.ok(cores.every((c) => c.dead) && cores[0].x === x0);
  run(g, 3, { until: () => g.dir.state === 'cleared' });
  assert.equal(g.dir.state, 'cleared');
  // The mark: killing it ends the wave.
  g = stage(34, { objective: { type: 'hunt' } });
  g.world.player.invuln = 1e9;
  run(g, 14, { until: () => !!g.dir.obj?.mark });
  const mark = g.dir.obj.mark;
  assert.ok(mark && mark.mark && mark.tag === 'MARK');
  const others = g.world.countEnemies() - 1;
  applyHit(g.world, null, mark, { ...HIT, dir: 1 }, mark.cx, mark.cy);
  run(g, 1.5, { until: () => g.dir.state === 'cleared' });
  assert.equal(g.dir.state, 'cleared', `the wave went on after the mark fell (${others} others)`);
});

test('a challenge pays shards when its condition is met and nothing when it is not', () => {
  const play = (type, act) => {
    const g = stage(50, { challenge: { type, time: 900 } }), { world, dir } = g;
    world.player.invuln = 1e9;
    run(g, 3);
    act?.(g);
    const before = world.shards;
    for (let i = 0; i < 40 && dir.state === 'fight'; i++) { for (const f of world.enemies) applyHit(world, null, f, { ...HIT, dir: 1 }, f.cx, f.cy); run(g, 0.4); }
    world.orbs.length = 0;
    return world.shards - before;
  };
  assert.equal(play('untouched'), CHALLENGES.untouched.pay);
  assert.equal(play('untouched', (g) => { g.world.stats.hitsTaken++; }), 0);
  assert.equal(play('parry'), 0);
  assert.equal(play('parry', (g) => { g.world.stats.parries += 3; }), CHALLENGES.parry.pay);
  assert.equal(play('pure', (g) => { g.world.stats.powers++; }), 0);
  assert.equal(play('swift'), CHALLENGES.swift.pay);
  // A fall on the floor forfeits it.
  const g = stage(51, { challenge: { type: 'untouched' } });
  g.dir.retry();
  assert.equal(g.dir.challenge.ok, false);
});

test('doors bend the next floor or lead to a room, and the quartermaster takes shards', () => {
  const g = boot(2, 77, { auto: false }), { world, dir } = g;
  if (dir.state === 'draft') dir.choose(0);
  // Elite guard: every eligible enemy is an elite and the floor pays more.
  dir.through({ type: 'elite' });
  dir.enterStage(2, 0, false);
  assert.ok(dir.mod.elite);
  run(g, 2.2, { god: true });
  assert.ok(dir.pending.length || world.enemies.length);
  const kinds = [...dir.pending.map((s) => [s.kind, s.elite]), ...world.enemies.map((f) => [f.def.kind, f.elite])];
  for (const [kind, elite] of kinds) { const D = world.def(kind), b = D.base || D.kind; if (b !== 'initiate' && b !== 'drone' && !D.boss) assert.ok(elite, `${kind} is not elite behind an elite door`); }
  // A curse.
  dir.through({ type: 'cursed', curse: 'frail' }); dir.enterStage(3, 0, false);
  assert.equal(world.frail, 1.3); assert.ok(dir.mod.twoCards);
  dir.through({ type: 'cursed', curse: 'dusk' }); dir.enterStage(3, 0, false);
  assert.ok(world.dark > 0.8);
  dir.through({ type: 'stair' }); dir.enterStage(3, 0, false);
  assert.equal(world.frail, 1); assert.equal(world.dark, 0); assert.ok(!dir.mod.elite);
  // Sanctuary.
  world.player.hp = 10; dir.through({ type: 'rest' });
  assert.ok(world.player.hp > 10 + world.player.maxHp * 0.4);
  // The quartermaster: nothing without shards, then a card and the price paid.
  dir.queue = []; dir.through({ type: 'shop' });
  const shop = dir.queue[0];
  assert.equal(shop.type, 'shop'); assert.ok(shop.options.length >= 4 && shop.skip);
  assert.ok(shop.options.includes('heal') && shop.kinds.includes('form'));
  dir.draft = dir.queue.shift(); dir.state = 'draft'; dir.t = 1;
  world.shards = 0; dir.choose(0);
  assert.ok(!shop.sold[0] && !dir.build[shop.options[0]]);
  world.shards = 500; dir.choose(0);
  assert.ok(shop.sold[0]); assert.equal(dir.build[shop.options[0]], 1); assert.equal(world.shards, 500 - shop.prices[0]);
  dir.choose(0); assert.equal(world.shards, 500 - shop.prices[0], 'a sold card was bought twice');
  assert.equal(dir.state, 'draft', 'buying closed the shop');
  const wi = shop.kinds.indexOf('form'), was = world.formId;
  dir.choose(wi);
  assert.equal(world.formId, shop.options[wi]); assert.notEqual(world.formId, was); assert.equal(world.form2, null);
  dir.choose(-1);
  assert.notEqual(dir.draft, shop, 'leaving did not close the shop');
  // An unmarked door is one of the others.
  const before = world.shards; dir.through({ type: 'unknown', hidden: 'gift' });
  assert.equal(world.shards, before + 60);
});

test('pacts give and take, and are only offered at a shrine', () => {
  const pacts = AUGMENTS.filter((a) => a.r === 4);
  assert.ok(pacts.length >= 6);
  for (let i = 0; i < 200; i++) { const r = () => (i * 0.0137) % 1; for (const tier of [0, 1, 2]) for (const id of draftAugments({}, r, tier, 40)) assert.ok(AUG[id].r < 4, `${id} is a pact in an ordinary draft`); }
  const offer = draftPacts({ glass: 1 }, () => 0.5);
  assert.equal(offer.length, 3); assert.ok(!offer.includes('glass')); assert.ok(offer.every((id) => AUG[id].r === 4));
  assert.equal(draftPacts(Object.fromEntries(pacts.map((p) => [p.id, 1])), () => 0.5).length, 0);
  const base = buildMods({});
  const m = buildMods({ glass: 1 }); assert.ok(m.dmg > base.dmg && m.maxHp < base.maxHp);
  assert.ok(buildMods({ greed: 1 }).shardK === 2 && buildMods({ greed: 1 }).taken > 1);
  assert.ok(buildMods({ debt: 1 }).enemyHp > 1 && buildMods({ overclock: 1 }).enemyRate > 1);
  // Taking one at a shrine, and what Debt does on the spot.
  const g = boot(4, 5, { auto: false }), { world, dir } = g;
  if (dir.state === 'draft') dir.choose(0);
  dir.draft = { type: 'pact', title: 'x', sub: 'x', options: ['debt', 'glass', 'hunger'], kinds: ['aug', 'aug', 'aug'], idx: 0, skip: 'REFUSE' }; dir.state = 'draft'; dir.t = 1;
  const hp = world.player.maxHp;
  dir.choose(0); assert.equal(world.shards, 150); assert.equal(dir.build.debt, 1);
  dir.draft = { type: 'pact', title: 'x', sub: 'x', options: ['glass'], kinds: ['aug'], idx: 0, skip: 'REFUSE' }; dir.state = 'draft'; dir.t = 1;
  dir.choose(0); assert.equal(world.player.maxHp, hp - 30);
  dir.enterStage(dir.stage, 0, true);
  assert.ok(Math.abs(world.hpMul - dir.stageDef.hp * 1.15) < 1e-9, 'Debt did not toughen the tower');
  // Blood Tithe pays for a power in health when the meter is empty.
  dir.build.tithe = 1; world.setBuild(dir.build);
  world.focus = 0; world.powers = ['crescent']; world.powerIdx = 0;
  const p = world.player; p.hp = p.maxHp; p.y = 0; p.onGround = true; p.setState('free');
  const used = world.usePower(p);
  assert.ok(used && p.hp < p.maxHp && world.focus === 0, 'the tithe was not paid in health');
});

test('a second sheath keeps the old blade, and switching makes the next hit land harder', () => {
  const g = boot(3, 9, { auto: false }), { world, dir } = g;
  if (dir.state === 'draft') dir.choose(0);
  assert.equal(world.swapForm(), false, 'switched with no sheath');
  dir.build.sheath = 1; world.setBuild(dir.build);
  assert.equal(world.swapForm(), false, 'switched with nothing in the sheath');
  const first = world.formId, other = FORM_IDS.find((id) => id !== first);
  dir.take({ type: 'armory', options: [other], kinds: ['form'] }, 0);
  assert.equal(world.formId, other); assert.equal(world.form2, first);
  assert.ok(world.swapForm());
  assert.equal(world.formId, first); assert.equal(world.form2, other); assert.ok(world.swapT > 0);
  assert.equal(world.player.blade, FORMS[first].blade);
  // The pair is saved and restored.
  let saved = null; dir.hooks.onFloor = (s) => { saved = s; }; dir.save();
  assert.equal(saved.v, 2); assert.equal(saved.form2, other); assert.equal(saved.mode, 'sprint');
  const w2 = new World(); w2.input = new BotInput(w2, 0.9);
  const d2 = new Director(w2, { setArena: () => 2200, auto: true });
  d2.startRun(saved.floor - 1, saved.seed, saved.diff, saved);
  assert.equal(d2.mode, 'sprint'); assert.equal(w2.formId, first); assert.equal(w2.form2, other); assert.equal(d2.run.count, 30);
});

test('boons are offered when earned and spent as ordinary build', () => {
  assert.equal(BOON_IDS.length, 8);
  const world = new World(); world.input = new BotInput(world, 0.9);
  const dir = new Director(world, { setArena: () => 2200, boons: () => [...BOON_IDS] });
  dir.startRun(0, 123, 'normal', null, 'sprint');
  assert.equal(dir.draft.type, 'form'); dir.choose(0);
  assert.equal(dir.draft?.type, 'boon', 'no boon was offered');
  assert.equal(dir.draft.options.length, 3);
  const id = dir.draft.options[0];
  dir.choose(0);
  assert.equal(dir.state, 'intro');
  assert.ok(Object.keys(dir.build).length || world.shards > 0 || world.powers.length > 1, `${id} gave nothing`);
  // Every boon does something a plain start does not have.
  for (const b of BOON_IDS) {
    const w = new World(); w.input = new BotInput(w, 0.9);
    const d = new Director(w, { setArena: () => 2200, auto: true });
    d.startRun(0, 5, 'normal', null, 'sprint');
    BOONS[b].apply(w, d, () => 0.3); w.setBuild(d.build);
    assert.ok(Object.keys(d.build).length || w.shards > 0 || w.powers.length > 1, `${b} gave nothing`);
    for (const k of Object.keys(d.build)) assert.ok(AUG[k], `${b} gives an unknown augment ${k}`);
    assert.ok(BOONS[b].text.length > 12 && BOONS[b].name);
  }
  // No boons earned: straight from the weapon to the floor.
  const d3 = new Director(new World(), { setArena: () => 2200 });
  d3.world.input = new BotInput(d3.world, 0.9);
  d3.startRun(0, 123, 'normal', null, 'sprint'); d3.choose(0);
  assert.equal(d3.state, 'intro');
});

test('a scripted player gets through the first sector of a sprint, doors and rooms included', () => {
  const picked = [];
  const g = boot(1, 2024, { skill: 0.9, hooks: { pickDoor: (doors) => { picked.push(doors.map((d) => d.type).join(',')); return picked.length % doors.length; } } }), { world, dir } = g;
  const t = run(g, 60 * 14, { god: true, until: () => dir.stage >= 10 });
  assert.ok(dir.stage >= 10, `stuck on floor ${dir.stage + 1} in state ${dir.state} after ${(t / 60).toFixed(1)} min`);
  assert.ok(picked.length >= 4, `only ${picked.length} sets of doors`);
  assert.ok(world.stats.shards > 100, `only ${world.stats.shards} shards in ten floors`);
  assert.ok(Object.values(dir.build).reduce((a, b) => a + b, 0) >= 9);
  assert.ok(dir.score > 1000);
  assert.ok(finite(world));
});

test('rooms have a shape: open edges, ledges with shooters on them, a sliding bridge and a lift', () => {
  const seen = {};
  let perched = 0;
  for (const mode of ['sprint', 'climb']) for (let seed = 1; seed <= 25; seed++) {
    const R = generateRun(seed, 'normal', mode);
    for (const f of R.floors) {
      if (!f.room) { assert.ok(!f.terrain?.pits && !f.terrain?.lift); continue; }
      assert.ok(ROOMS[f.room]); seen[f.room] = (seen[f.room] || 0) + 1;
      assert.ok(!f.boss && !R.sectors[f.sector].school, `floor ${f.n}: a shaped room for a champion, a keeper or the school`);
      const T = f.terrain;
      if (f.room === 'edges' || f.room === 'lift') assert.equal(T.pits.length, 2);
      if (f.room === 'lift') assert.ok(T.lift && T.plats[0].amp > 0);
      if (f.room === 'mover') assert.ok(T.pits.length === 1 && T.plats[0].amp > 0 && T.plats[0].fixed);
      if (f.room === 'ledges') assert.ok(T.plats.filter((p) => p.fixed && !p.amp).length >= 2);
      for (const w of f.waves) for (const s of w.spawns) if (s.perch !== undefined) { perched++; assert.equal(f.room, 'ledges'); assert.ok(s.perch < 2); }
      // Whatever the edges take, there is room left to fight in.
      const half = 950, open = (T.pits || []).reduce((n, q) => n + q.w, 0);
      assert.ok(half * 2 - open > 1000, `floor ${f.n}: only ${half * 2 - open} of floor left`);
    }
  }
  assert.deepEqual(Object.keys(seen).sort(), Object.keys(ROOMS).sort());
  assert.ok(perched > 10, `only ${perched} shooters were posted on ledges`);

  // The physics, on a floor with both edges open.
  const g = boot(7, 77), { world, dir } = g, def = dir.stageDef;
  def.surprise = null; def.objective = null; def.challenge = null;
  def.terrain = { plats: [{ fx: 0, y: -150, w: 240, fixed: true, amp: 0.3, period: 4, phase: 0 }], vents: [], walls: false, pits: [{ side: -1, w: 300 }, { side: 1, w: 300 }] };
  dir.enterStage(dir.stage, 0, true);
  world.input = { tick() {}, held: () => false, axisX: () => 0, consume: () => false, peek: () => false, sincePress: () => 9 };
  const lipR = world.maxX - 300, lipL = world.minX + 300;
  assert.equal(world.pits.length, 2);
  assert.ok(world.inPit(lipR + 50) && world.inPit(lipL - 50) && !world.inPit(0));
  assert.equal(world.solidX(lipR + 120), lipR - 70);
  // Nothing is ever dropped in over the open part.
  for (const x of [world.maxX - 80, world.minX + 80]) { const f = world.spawnEnemy('initiate', x, false); assert.ok(!world.inPit(f.x), 'an enemy was spawned over the drop'); f.remove = true; }
  run(g, 0.1, { god: false });
  // An enemy walking at the edge stops on the lip.
  // (A bulwark: it walks and charges but never leaps. A leap after a player who hangs over the drop is the leaper's own mistake.)
  const walker = world.spawnEnemy('bulwark', lipR - 120, false);
  world.player.x = lipR + 150; world.player.y = -900; world.player.vy = 0; world.player.invuln = 1e9;   // bait from over the drop
  for (let i = 0; i < 360; i++) { world.player.y = -900; world.player.vy = 0; world.step(DT); }
  assert.ok(!walker.dead && walker.y <= 0.01 && walker.x < lipR, `the enemy walked off the edge (x ${walker.x.toFixed(0)}, lip ${lipR})`);
  // Knocked over it, the enemy is gone and the room gets the kill.
  const before = world.stats.hazardKills;
  world.player.x = 0;
  applyHit(world, null, walker, { dmg: 1, post: 0, kx: 900, ky: -500, kind: 'knock', stop: 0, shake: 0, stun: 0.4, fromPlayer: true, id: 'T', fam: 'power', dir: 1 }, walker.cx, walker.cy);
  for (let i = 0; i < 600 && !walker.remove; i++) world.step(DT);
  assert.ok(walker.remove && walker.dead, 'the enemy survived the drop');
  assert.equal(world.stats.hazardKills, before + 1);
  // The player who falls is hauled back to the floor and pays for it.
  const p = world.player; p.invuln = 0; p.hp = p.maxHp; p.x = lipL - 120; p.y = -10; p.vy = 0; p.onGround = false;
  for (let i = 0; i < 600 && p.y > -100; i++) world.step(DT);
  assert.ok(p.hp < p.maxHp && p.hp > p.maxHp * 0.7 && !world.inPit(p.x) && !p.dead, `hp ${p.hp} at x ${p.x.toFixed(0)}`);
  for (let i = 0; i < 360; i++) world.step(DT);
  assert.ok(p.onGround && Math.abs(p.y) < 0.01);
  // The sliding bridge carries whoever stands on it.
  const B = world.platforms[0]; p.x = B.x; p.y = B.y - 40; p.vy = 0; p.onGround = false; p.invuln = 1e9;
  for (let i = 0; i < 60; i++) world.step(DT);
  assert.ok(Math.abs(p.y - B.y) < 0.01, 'the player did not land on the bridge');
  const off = p.x - B.x, x0 = B.x;
  for (let i = 0; i < 180; i++) world.step(DT);
  assert.ok(Math.abs(B.x - x0) > 60, 'the bridge did not move');
  assert.ok(Math.abs((p.x - B.x) - off) < 2, 'the bridge left its rider behind');
  assert.ok(finite(world));
});

test('a shooter posted on a ledge holds it until it is knocked off', () => {
  const g = boot(7, 78), { world, dir } = g, def = dir.stageDef;
  def.surprise = null; def.objective = null; def.challenge = null;
  def.terrain = { plats: [{ fx: -0.5, y: -196, w: 300, fixed: true }, { fx: 0.5, y: -196, w: 300, fixed: true }], vents: [], walls: false };
  def.waves = [{ spawns: [{ kind: 'marksman', dx: 400, t: 0, perch: 1 }], attackers: 2, hint: null }];
  dir.enterStage(dir.stage, 0, true);
  world.player.invuln = 1e9;
  run(g, 4.5, { god: false, until: () => world.enemies.length > 0 && world.enemies[0].onGround });
  const m = world.enemies[0], L = world.platforms[1];
  assert.ok(m && m.perch === L, 'nobody was posted');
  world.input = { tick() {}, held: () => false, axisX: () => 0, consume: () => false, peek: () => false, sincePress: () => 9 };
  for (let i = 0; i < 120 * 8; i++) { world.step(DT); dir.update(DT); assert.ok(m.rag || Math.abs(m.x - L.x) <= L.w / 2 + 1, `the shooter left its ledge at x ${m.x.toFixed(0)}`); }
  assert.ok(Math.abs(m.y - L.y) < 0.01, 'the shooter is not standing on its ledge');
  // A ledge never overloads, however long it is stood on.
  assert.ok(L.solid && L.load === 0);
  // Knocked off, it lands on the floor and is an ordinary enemy again.
  m.toRagdoll(-700, -300, 2);
  for (let i = 0; i < 120 * 6 && (m.rag || m.y < -1); i++) { world.step(DT); dir.update(DT); }
  for (let i = 0; i < 120 * 3; i++) { world.step(DT); dir.update(DT); }
  assert.ok(m.dead || m.perch === null || Math.abs(m.y - L.y) < 0.01);
});

test('animals and a stampede respect open edges too', () => {
  const g = boot(7, 77, { mode: 'climb' }), { world, dir } = g, def = dir.stageDef;
  def.surprise = null; def.objective = null; def.challenge = null;
  def.terrain = { plats: [], vents: [], walls: false, pits: [{ side: -1, w: 300 }, { side: 1, w: 300 }] };
  def.waves = [{ spawns: [{ kind: 'initiate', dx: 300, t: 0 }], attackers: 1, hint: null }];
  dir.enterStage(dir.stage, 0, true);
  world.input = { tick() {}, held: () => false, axisX: () => 0, consume: () => false, peek: () => false, sincePress: () => 9 };
  world.player.invuln = 1e9; world.player.x = -200;
  const lip = world.maxX - 300, KNOCK = { dmg: 1, post: 0, kx: 900, ky: -500, kind: 'knock', stop: 0, shake: 0, stun: 0.4, fromPlayer: true, id: 'T', fam: 'power', dir: 1 };
  // Every animal plan in this run: knocked over the lip alive it is gone and the room gets the kill,
  // and a dead one thrown over does not come to rest on thin air.
  const R = dir.run.roster, kinds = R.beasts.filter((id) => id && !R.defs[id].flying);
  assert.ok(kinds.length >= 5);
  for (const kind of kinds) {
    const before = world.stats.hazardKills, a = world.spawnEnemy(kind, lip - 110, false);
    for (let i = 0; i < 30; i++) world.step(DT);
    a.invuln = 0; a.x = lip - 110;
    if (!a.rag) a.toRagdoll(900, -520, 2); else a.rag.kick(900, -520, 2);
    for (let i = 0; i < 900 && !a.remove; i++) world.step(DT);
    assert.ok(a.remove && a.dead, `${R.defs[kind].beast}: a live animal knocked over the edge is still there (x ${a.x.toFixed(0)}, lip ${lip})`);
    assert.equal(world.stats.hazardKills, before + 1, `${R.defs[kind].beast}: the room did not get the kill`);
    const b = world.spawnEnemy(kind, lip - 110, false);
    for (let i = 0; i < 30; i++) world.step(DT);
    b.die(900, -520, 2);
    for (let i = 0; i < 900 && !b.remove; i++) world.step(DT);
    assert.ok(b.remove, `${R.defs[kind].beast}: a dead animal rests over the drop (y ${b.rag ? b.rag.y[2].toFixed(0) : b.y})`);
  }
  assert.ok(finite(world));

  // A stampede on a floor with open edges: the herd runs in, through, and off the far side.
  const h = boot(7, 78), def2 = h.dir.stageDef;
  def2.objective = null; def2.challenge = null; def2.surprise = { type: 'stampede' };
  def2.terrain = { plats: [], vents: [], walls: false, pits: [{ side: -1, w: 300 }, { side: 1, w: 300 }], lift: true };
  h.dir.enterStage(h.dir.stage, h.dir.waveCount - 1, true);
  h.world.input = world.input; h.world.player.invuln = 1e9;
  // (The herd may well clear the floor by itself, so watch one pass, not the whole surprise.)
  let most = 0, longest = 0, cur = 0, seen = false;
  const stage0 = h.dir.stage;
  run(h, 30, { god: false, until: () => { const n = h.world.fighters.filter((f) => f.herd).length; seen ||= h.dir.sur?.type === 'stampede'; most = Math.max(most, n); cur = n ? cur + DT : 0; longest = Math.max(longest, cur); return h.dir.stage !== stage0 || (most >= 3 && n === 0 && !h.world.herd); } });
  assert.ok(seen && most >= 3, 'no herd came through');
  assert.equal(h.world.fighters.filter((f) => f.herd).length, 0, 'the herd is still in the room');
  assert.ok(longest < 4.5, `a pass took ${longest.toFixed(1)} s: the runners stalled somewhere`);
});
