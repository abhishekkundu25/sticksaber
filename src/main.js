// Boot, main loop and the thin app shell (menu / play / pause) around the simulation.
import { Input } from './core/input.js';
import { World } from './game/world.js';
import { Director } from './game/encounters.js';
import { Renderer } from './render/renderer.js';
import { buildArena, ARENA_IDS } from './render/arenas.js';
import { Hud, draftCard, menuLayout, pauseButton, skipButton } from './ui/hud.js';
import { Touch } from './ui/touch.js';
import { audio } from './audio/audio.js';
import { BotInput } from './game/bot.js';
import { clamp, pick } from './core/math.js';
import { DIFFS, DIFF_IDS, MODES, MODE_IDS, parseSeed, seedLabel } from './game/gen.js';
import { hash32 } from './core/math.js';
import { Meta } from './core/meta.js';
import { BOON_IDS } from './game/boons.js';

const canvas = document.getElementById('game');
const input = new Input();
input.attach(window);
const renderer = new Renderer(canvas);
const hud = new Hud();
const world = new World();
world.input = input;
const meta = new Meta();

// The run in progress (seed, difficulty, floor, build) is saved at every floor, so a hundred floors
// do not have to be climbed in one sitting. Storage can be unavailable (private windows), so every
// access is guarded.
const RUN_KEY = 'sticksaber.run', PREF_KEY = 'sticksaber.diff', TAUGHT_KEY = 'sticksaber.taught', MODE_KEY = 'sticksaber.mode', DAILY_KEY = 'sticksaber.daily';
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, v) { try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch { /* play on without saving */ } },
};
// A save from before runs had doors and shards (no `v`) cannot be continued, so it is ignored.
const loadRun = () => { const s = store.get(RUN_KEY); if (!(s && s.v === 2 && s.seed && MODES[s.mode] && s.floor >= 1 && s.floor <= MODES[s.mode].floors && DIFFS[s.diff] && Array.isArray(s.powers) && s.build)) return null; s.form ||= 'saber'; return s; };
// The daily run: one seed for everyone, from the date. Always a sprint on the middle difficulty, so scores compare.
const today = () => new Date().toISOString().slice(0, 10);
const dailySeed = (date) => hash32(parseInt(date.replace(/-/g, ''), 10), 0xda11) || 1;
// `?seed=ABC123` pins the run so it can be replayed or shared, `?diff=easy|normal|hard` its
// difficulty, and `?floor=40` starts there with the picks the run would have made on the way up.
const query = new URLSearchParams(location.search);
const fixedSeed = parseSeed(query.get('seed') || '');
const fixedFloor = clamp(parseInt(query.get('floor'), 10) || 0, 0, 100);

const app = { state: 'menu', idx: 0, muted: false, menu: [], toast: null, manual: false, touch: false, hover: '', diff: DIFFS[query.get('diff')] ? query.get('diff') : DIFFS[store.get(PREF_KEY)] ? store.get(PREF_KEY) : 'normal',
  mode: MODES[query.get('mode')] ? query.get('mode') : MODES[store.get(MODE_KEY)] ? store.get(MODE_KEY) : 'sprint' };

// Phones and tablets: taps drive the menus, an on-screen stick and buttons drive the fight.
const taps = [], cmds = [];
const touch = new Touch(input, canvas, renderer.view, { tap: (x, y) => taps.push({ x, y }), cmd: (name) => cmds.push(name) });
const BURST_STATES = { hitstun: 1, stagger: 1, ragdoll: 1, getup: 1, recoil: 1 };
const SPAWNS = ['Digit1', 'Digit2', 'Digit3', 'BracketLeft', 'Digit4', 'Digit6', 'Digit7', 'BracketLeft', 'Digit8', 'Digit5', 'BracketRight'];
const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];
let spawnIdx = 0;
const live = () => app.state === 'play' || app.state === 'pause';
const fighting = () => app.state === 'play' && director.state !== 'draft' && director.state !== 'dead' && director.state !== 'victory';

// Mouse: menus, cards, pause buttons and the power chips are all clickable, the wheel switches power,
// and in a fight the left, right and middle buttons are light, heavy and power.
const mouse = { x: -1, y: -1, on: false, moved: false };
const clicks = [];
const inRect = (r, p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const toView = (e) => { const r = canvas.getBoundingClientRect(); mouse.x = ((e.clientX - r.left) / r.width) * renderer.view.w; mouse.y = ((e.clientY - r.top) / r.height) * renderer.view.h; mouse.on = true; };
const fromTouch = () => performance.now() - input.lastTouch < 900;
addEventListener('mousemove', (e) => { if (fromTouch()) return; toView(e); mouse.moved = true; });
addEventListener('mousedown', (e) => { if (fromTouch()) return; toView(e); clicks.push({ x: mouse.x, y: mouse.y, button: e.button }); });
addEventListener('mouseleave', () => { mouse.on = false; });
addEventListener('wheel', (e) => { if (fighting() && Math.abs(e.deltaY) > 2) world.cyclePower(e.deltaY > 0 ? 1 : -1); }, { passive: true });
input.mouseGuard = () => !fighting() || hud.chips.some((c) => inRect(c, mouse));

// One arena is baked at a time: each floor is its own seeded variant, so the previous one is released.
let arenaKey = '';
const director = new Director(world, {
  setArena(id, seed = 0, hue = 0) {
    if (!ARENA_IDS.includes(id)) id = 'causeway';
    const key = `${id}:${seed}:${hue}`;
    if (key !== arenaKey) {
      renderer.arena?.dispose?.();
      renderer.arena = buildArena(id, { seed, hue });
      arenaKey = key;
    }
    return renderer.arena.width;
  },
  onFloor(state) { if (live()) store.set(RUN_KEY, state); },
  onEvent(e) { if (live()) meta.note(e, world, director); },
  onEnd() { if (live()) finish(true); },
  // Boons are earned between runs. `?boons=all` offers every one, for trying them out.
  boons: () => (query.get('boons') === 'all' ? BOON_IDS : meta.boons()),
  // The parry lesson on floor 1 is given once per browser.
  lesson: () => live() && !store.get(TAUGHT_KEY),
  lessonDone: () => store.set(TAUGHT_KEY, 1),
});

// Controller rumble: the heavier the event, the harder the shake.
const RUMBLE = { hitLight: [0.15, 0.3, 50], hitHeavy: [0.5, 0.5, 90], hitSpike: [0.6, 0.5, 110], hitLaunch: [0.4, 0.5, 90], parry: [0.3, 0.9, 110], hurt: [0.9, 0.6, 160], kill: [0.5, 0.7, 120],
  slam: [0.8, 0.4, 140], explode: [0.8, 0.5, 160], guardBreak: [0.9, 0.7, 200], stagger: [0.6, 0.8, 160], finisher: [1, 1, 600], bossPhase: [0.9, 0.7, 400], powerNova: [0.9, 0.7, 220], pillar: [0.6, 0.4, 140] };
function rumble(name) {
  const r = RUMBLE[name];
  if (!r || !input.usedPad || !navigator.getGamepads) return;
  for (const pad of navigator.getGamepads()) pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: r[2], strongMagnitude: r[0], weakMagnitude: r[1] }).catch(() => {});
}

// The fight behind the title screen is silent.
world.sfxOut = (name, x, vol, pitch) => { if (live()) { audio.play(name, { vol, pitch, pan: clamp((x - world.cam.x) / 720, -1, 1) }); rumble(name); } };
world.loopOut = (name, on) => audio.loop(name, on && live());

function buildMenu(keep) {
  const saved = loadRun(), M = MODES[app.mode], best = store.get(DAILY_KEY), date = today();
  app.menu = [{ id: 'run', label: 'ASCEND', sub: `${M.name}  ·  ${M.floors} FLOORS`, note: M.blurb }];
  if (saved) app.menu.push({ id: 'continue', label: 'CONTINUE', sub: `${saved.daily ? 'DAILY' : MODES[saved.mode].name}  ·  FLOOR ${saved.floor}`, saved });
  app.menu.push({ id: 'daily', label: 'DAILY CLIMB', sub: best?.date === date ? `TODAY'S BEST  ${best.score.toLocaleString('en-US')}` : date, note: 'One seed for everyone today. Thirty floors, and a score to share' },
    { id: 'mode', row: 1, label: `LENGTH  ·  ${M.name}`, note: M.blurb }, { id: 'diff', row: 1, label: `DIFFICULTY  ·  ${DIFFS[app.diff].name}`, note: DIFFS[app.diff].blurb },
    { id: 'train', row: 1, label: 'TRAINING ROOM', note: 'Every weapon, power and enemy, and nothing at stake' }, { id: 'codex', row: 1, label: 'CODEX', note: 'What you have met, beaten and earned' }, { id: 'controls', row: 1, label: 'CONTROLS' });
  if (!keep) app.idx = saved ? 1 : 0;
}
// A run ended, in victory or by quitting after a fall: keep the day's best and the record of it.
function finish(won) {
  const d = director;
  if (d.training) return;
  const result = { score: d.score, floor: d.stageDef.n, won, date: d.daily, mode: d.mode, diff: d.diff, seed: d.seed };
  if (d.daily) { const best = store.get(DAILY_KEY); if (!(best?.date === d.daily && best.score >= result.score)) store.set(DAILY_KEY, result); }
  meta.note({ type: 'run', ...result }, world, d);
}
// What a player pastes to show a run: the score and a link that replays the same tower.
function resultText() {
  const d = director, url = `${location.origin}${location.pathname}?${d.daily ? `daily=${d.daily}` : `seed=${seedLabel(d.seed)}&mode=${d.mode}&diff=${d.diff}`}`;
  return `STICKSABER ${d.daily ? `daily ${d.daily}` : MODES[d.mode].name.toLowerCase()}: ${d.won ? 'cleared' : `floor ${d.stageDef.n} of ${d.count}`}, score ${d.score.toLocaleString('en-US')}, ${d.deaths} fall${d.deaths === 1 ? '' : 's'}\n${url}`;
}

// Title screen: a scripted player spars in the background.
function toMenu() {
  app.state = 'menu';
  director.startTraining();
  director.hintT = 0; world.bannerMsg = null;
  world.clearEnemies();
  world.input = new BotInput(world, 0.78);
  world.input.show = true;
  demoQueue.length = 0; demoGap = 0; demoAlive = 0;
  buildMenu();
}
// The title-screen fight is a showcase: a scripted player with a fast-filling Focus meter and every
// power takes on one small group after another. Some of each group are strains generated for the occasion.
const DEMO_WAVES = [
  ['initiate', 'initiate', 'initiate'], ['initiate', '*', 'marksman'], ['duelist', '*'], ['bulwark', 'initiate', '*'],
  ['lancer', '*', 'initiate'], ['wraith', 'drone', '*'], ['initiate', 'initiate', '*', 'initiate'],
  ['drone', 'drone', '*'], ['duelist', 'lancer'], ['*', '*', 'initiate'],
];
const demoQueue = [];
let demoGap = 0, demoAlive = 0;
function demo(dt) {
  const p = world.player;
  world.input.tick(dt);
  if (!p.dead) {
    p.hp = Math.min(p.maxHp, p.hp + 30 * dt);
    if (world.overdrive <= 0) world.focus = Math.min(world.maxFocus, world.focus + 30 * dt);
  }
  for (let i = demoQueue.length - 1; i >= 0; i--) {
    const s = demoQueue[i];
    if ((s.t -= dt) > 0) continue;
    world.spawnEnemy(s.kind, p.x + s.dx, true, s.elite ? { elite: s.elite } : null);
    demoQueue.splice(i, 1);
  }
  const alive = world.countEnemies();
  // A beat of slow motion as each group's last fighter falls.
  if (demoAlive > 0 && alive === 0 && !demoQueue.length) world.slow(0.3, 0.55);
  demoAlive = alive;
  if (alive || demoQueue.length) { demoGap = 0.7; return; }
  if ((demoGap -= dt) > 0) return;
  let side = p.x > 0 ? -1 : 1;
  // Strains and animals generated for the occasion, the heaviest ones left out.
  const R = director.run.roster;
  const strains = [...R.strains.flat(), ...R.beasts.filter(Boolean), ...R.beasts.filter(Boolean)].filter((id) => world.def(id).base !== 'brute' && world.def(id).gen.cost < 4);
  pick(DEMO_WAVES).forEach((kind, i) => {
    if (kind === '*') kind = strains[(Math.random() * strains.length) | 0];
    const base = world.def(kind).base || kind;
    demoQueue.push({ kind, dx: side * (380 + Math.random() * 160), t: i * 0.45, elite: base !== 'initiate' && base !== 'drone' && Math.random() < 0.25 ? pick(['swift', 'armored', 'volatile']) : null });
    side = -side;
  });
}
function startRun(floor = 1, seed = fixedSeed || undefined, diff = app.diff, saved = null, mode = app.mode, daily = null) {
  world.input = input; app.state = 'play';
  director.startRun(floor - 1, seed, diff, saved, mode);
  if (daily) { director.daily = daily; director.save(); }
}
const startDaily = (date = today()) => startRun(1, dailySeed(date), 'normal', null, 'sprint', date);
function startTraining() { world.input = input; app.state = 'play'; director.startTraining(); }
const toast = (text) => { app.toast = { text, t: 1.8 }; };
function copyResult() { const text = resultText(); (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => toast('RESULT COPIED'), () => toast('COULD NOT COPY')); }

addEventListener('resize', () => renderer.resize());
// Browsers only let sound start from a user gesture; phones count the end of a touch, not its start.
for (const ev of ['keydown', 'mousedown', 'touchstart', 'touchend', 'click']) addEventListener(ev, () => audio.init(), { passive: true });

const GFX = ['auto', 'high', 'low'];
function shell() {
  const hit = (...codes) => input.keysHit.some((c) => codes.includes(c));
  if (hit('KeyF')) { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}); }
  if (hit('KeyM')) { app.muted = !app.muted; audio.setVolumes({ master: app.muted ? 0 : 1 }); toast(app.muted ? 'SOUND OFF' : 'SOUND ON'); }
  if (hit('KeyG')) { const m = GFX[(GFX.indexOf(renderer.mode) + 1) % GFX.length]; renderer.setMode(m); toast(`GRAPHICS  ${m.toUpperCase()}`); }
  let confirm = hit('Enter', 'NumpadEnter', 'Space') || (input.usedPad && app.state !== 'play' && input.consume('jump', 0.1));
  let back = hit('Escape'), skip = false;
  const drafting = app.state === 'play' && director.state === 'draft';
  if (touch.enabled && !app.touch) { app.touch = true; renderer.touch = true; renderer.resize(); }
  // Touch: a tap on a menu item or a draft card picks it; a tap anywhere dismisses a screen that only needs acknowledging.
  for (const t of taps) {
    if (app.state === 'menu') {
      const i = menuLayout(renderer.view.w, renderer.view.h, app.menu).findIndex((r) => inRect(r, t));
      if (i >= 0) {
        app.idx = i; confirm = true;
        // Phones: take the whole screen and hold landscape where the browser allows it.
        document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
      }
    } else if (drafting) {
      const n = director.draft.options.length;
      for (let i = 0; i < n; i++) if (inRect(draftCard(renderer.view.w, n, i), t)) { director.draft.idx = i; confirm = true; }
      if (director.draft.skip && inRect(skipButton(renderer.view.w), t)) skip = true;
    } else if (app.state !== 'codex') confirm = true;
    else back = true;
  }
  taps.length = 0;
  // Mouse: what is under the pointer, then what was clicked.
  let hover = '';
  if (mouse.on && !app.touch) {
    const W = renderer.view.w, H = renderer.view.h;
    if (app.state === 'menu') { menuLayout(W, H, app.menu).forEach((r, i) => { if (inRect(r, mouse)) { hover = `m${i}`; if (mouse.moved) app.idx = i; } }); }
    else if (drafting) {
      const n = director.draft.options.length;
      for (let i = 0; i < n; i++) if (inRect(draftCard(W, n, i), mouse)) { hover = `d${i}`; if (mouse.moved) director.draft.idx = i; }
      if (director.draft.skip && inRect(skipButton(W), mouse)) hover = 'skip';
    }
    else if (app.state === 'pause') { for (let i = 0; i < 2; i++) if (inRect(pauseButton(W, H, i), mouse)) hover = `p${i}`; }
    else if (app.state === 'play') { for (const c of hud.chips) if (inRect(c, mouse)) hover = `c${c.i}`; }
    for (const c of clicks) {
      if (c.button !== 0) continue;
      if (hover[0] === 'm') { app.idx = +hover.slice(1); confirm = true; }
      else if (hover[0] === 'd') { director.draft.idx = +hover.slice(1); confirm = true; }
      else if (hover === 'skip') skip = true;
      else if (hover === 'p0') back = true;
      else if (hover === 'p1') { clicks.length = 0; mouse.moved = false; toMenu(); return; }
      else if (hover[0] === 'c') world.selectPower(+hover.slice(1));
      else if (app.state === 'controls' || app.state === 'codex' || (app.state === 'play' && (director.state === 'dead' || director.state === 'victory'))) confirm = true;
    }
  }
  if (hover !== app.hover) { if (hover) audio.play('uiHover', { vol: 0.6 }); app.hover = hover; }
  const cursor = hover ? 'pointer' : fighting() ? 'crosshair' : 'default';
  if (cursor !== app.cursor) { app.cursor = cursor; canvas.style.cursor = cursor; }
  clicks.length = 0; mouse.moved = false;
  for (const c of cmds) {
    if (c === 'pause' && app.state === 'play') back = true;
    else if (c === 'resume' && app.state === 'pause') back = true;
    else if (c === 'quit' && app.state === 'pause') { cmds.length = 0; toMenu(); return; }
    else if (c === 'spawn') director.trainingKey(SPAWNS[spawnIdx++ % SPAWNS.length]);
  }
  cmds.length = 0;
  switch (app.state) {
    case 'menu': {
      const n = app.menu.length, row = (i) => (app.menu[i].row ? 1 : 0);
      if (hit('ArrowLeft', 'KeyA')) { app.idx = (app.idx + n - 1) % n; audio.play('uiMove'); }
      if (hit('ArrowRight', 'KeyD')) { app.idx = (app.idx + 1) % n; audio.play('uiMove'); }
      if (hit('ArrowUp', 'KeyW', 'ArrowDown', 'KeyS')) {
        // Up and down move between the two rows, to the item nearest across.
        const L = menuLayout(renderer.view.w, renderer.view.h, app.menu), from = L[app.idx].cx, other = 1 - row(app.idx);
        let best = -1;
        for (let i = 0; i < n; i++) if (row(i) === other && (best < 0 || Math.abs(L[i].cx - from) < Math.abs(L[best].cx - from))) best = i;
        if (best >= 0) { app.idx = best; audio.play('uiMove'); }
      }
      if (confirm) {
        audio.play('uiSelect');
        const item = app.menu[app.idx];
        if (item.id === 'run') startRun(fixedFloor || 1);
        else if (item.id === 'continue') startRun(item.saved.floor, item.saved.seed, item.saved.diff, item.saved, item.saved.mode);
        else if (item.id === 'daily') startDaily();
        else if (item.id === 'mode') { app.mode = MODE_IDS[(MODE_IDS.indexOf(app.mode) + 1) % MODE_IDS.length]; store.set(MODE_KEY, app.mode); buildMenu(true); }
        else if (item.id === 'diff') { app.diff = DIFF_IDS[(DIFF_IDS.indexOf(app.diff) + 1) % DIFF_IDS.length]; store.set(PREF_KEY, app.diff); buildMenu(true); }
        else if (item.id === 'train') startTraining();
        else if (item.id === 'codex') app.state = 'codex';
        else app.state = 'controls';
      }
      break;
    }
    case 'controls': case 'codex': if (confirm || back) { app.state = 'menu'; audio.play('uiMove'); } break;
    case 'pause':
      if (back || hit('KeyP')) app.state = 'play';
      else if (hit('KeyQ')) toMenu();
      break;
    case 'play':
      if (drafting) {
        // Choosing an augment or a power: left and right move, a number or confirm takes it.
        const d = director.draft, n = d.options.length;
        if (hit('ArrowLeft', 'KeyA')) { d.idx = (d.idx + n - 1) % n; audio.play('uiMove'); }
        if (hit('ArrowRight', 'KeyD')) { d.idx = (d.idx + 1) % n; audio.play('uiMove'); }
        const num = DIGITS.findIndex((c) => hit(c));
        if (num >= 0 && num < n) { d.idx = num; confirm = true; }
        // A room that can be left is left with Escape; anywhere else Escape pauses.
        if (director.t > 0.45 && (skip || (back && d.skip))) director.choose(-1);
        else if (director.t > 0.45 && (confirm || hit('KeyJ'))) director.choose(d.idx);
        else if (hit('KeyP') || (back && !d.skip)) { app.state = 'pause'; audio.play('uiMove'); }
      } else if (director.state === 'dead') {
        if (hit('KeyC')) copyResult();
        else if (director.t > 1 && confirm) director.retry();
        else if (back) { finish(false); toMenu(); }
      } else if (director.state === 'victory') {
        if (hit('KeyC')) copyResult();
        else if (director.t > 1.2 && (confirm || back)) { store.set(RUN_KEY, null); toMenu(); }
      } else if (back || hit('KeyP')) { app.state = 'pause'; audio.play('uiMove'); }
      else if (hit('KeyT') && !director.training) world.swapForm();
      if (director.training) for (const c of input.keysHit) director.trainingKey(c);
      else if (!drafting) { const num = DIGITS.findIndex((c) => hit(c)); if (num >= 0) world.selectPower(num); }
      break;
  }
}

let rainT = 0, theme = -1;
function sound(dt) {
  const p = world.player, cam = world.cam, playing = app.state === 'play';
  if (app.state === 'menu' || app.state === 'controls' || app.state === 'codex') { audio.loop('heal', false); audio.loop('throw', false); }
  const pan = (x) => clamp((x - cam.x) / 720, -1, 1);
  const speed = (f) => clamp(Math.hypot(f.tx - f.ptx, f.ty - f.pty) / 22, 0, 1);
  audio.hum('player', playing && p && !p.dead && p.armed ? { pan: pan(p.x), speed: speed(p), pitch: world.overdrive > 0 ? 1.3 : 1, vol: 1 } : null);
  let n = 0;
  if (playing) {
    for (const f of world.fighters) {
      if (n >= 3 || f.team !== 1 || f.dead || f.phantom || !f.armed || f.blade.gun || f.bladeOn < 0.5 || f.fade < 0.5) continue;
      audio.hum('e' + n++, { pan: pan(f.x), speed: speed(f), pitch: f.def.boss ? 0.7 : f.scale > 1.3 ? 0.6 : 0.85, vol: 0.55 });
    }
  }
  for (; n < 3; n++) audio.hum('e' + n, null);
  const boss = world.boss && !world.boss.dead ? world.boss : null;
  const drafting = director.state === 'draft';
  const heat = drafting ? 0 : clamp(0.25 + world.countEnemies() * 0.12 + world.style.rank * 0.08 + (boss && boss.ai.phase >= 2 ? 0.35 : 0) + (world.overdrive > 0 ? 0.4 : 0), 0, 1);
  // Each sector has its own musical theme.
  const want = director.training ? 0 : director.stageDef.sector;
  if (want !== theme && live()) { theme = want; audio.setTheme?.(theme); }
  audio.music(app.state === 'menu' || app.state === 'controls' || app.state === 'codex' ? 'menu' : director.music, heat);
  // Re-assert the ambience once a second: the first request can arrive before the audio context exists.
  if ((rainT -= dt) <= 0) { rainT = 1; audio.loop('rain', renderer.arena?.id === 'causeway'); }
  audio.setSlowmo(playing ? clamp(1 - world.timeScale, 0, 1) : 0);
  audio.update(dt);
}

// One frame of the whole app. The rAF loop calls it with wall-clock time; tools can call it with a
// fixed step (see `manual`) to render deterministic sequences.
function advance(dt, now) {
  input.poll(dt);
  shell();
  world.view = renderer.view;
  if (app.toast && (app.toast.t -= dt) <= 0) app.toast = null;
  if (app.state === 'menu') demo(dt);
  if (app.state === 'play' || app.state === 'menu') {
    // The fight holds still while a draft is open. Otherwise sub-step so no sim step exceeds 1/120 s
    // whatever the display refresh rate.
    if (director.state !== 'draft' || app.state === 'menu') {
      const n = Math.max(1, Math.ceil(dt * 120 - 0.01));
      for (let i = 0; i < n; i++) world.step(dt / n);
    }
    director.update(dt);
  }
  if (touch.enabled) {
    const fighting = app.state === 'play' && director.state !== 'dead' && director.state !== 'victory' && director.state !== 'draft';
    touch.setMode(fighting ? (director.training ? 'train' : 'play') : app.state === 'pause' ? 'pause' : 'off');
    touch.setReady(world.focus >= world.maxFocus && world.overdrive <= 0);
    const pl = world.player;
    touch.setPower(world.power.short, world.powers.length > 1);
    touch.setBurst(fighting && pl && !pl.dead && BURST_STATES[pl.state] === 1 && world.focus >= 100 && world.time - world.lastBurst >= 1.5);
  }
  sound(dt);
  const t0 = performance.now();
  renderer.draw(world, now);
  hud.draw(renderer.ctx, renderer.view, world, director, app, dt);
  if (app.state === 'play' && !app.manual) renderer.autoQuality(Math.max(dt * 1000, performance.now() - t0));
  input.endFrame();
}

let last = performance.now(), clock = 0;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (!app.manual) advance(dt, now / 1000);
  requestAnimationFrame(frame);
}

toMenu();
// `?daily` (today) or `?daily=2026-11-16` goes straight into that day's run.
if (query.has('daily')) startDaily(/^\d{4}-\d\d-\d\d$/.test(query.get('daily')) ? query.get('daily') : today());
window.__game = { world, director, app, input, renderer, hud, audio, meta, startRun, startDaily, startTraining, toMenu, tick(dt) { clock += dt; advance(dt, clock); } };
requestAnimationFrame(frame);
