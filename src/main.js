// Boot, main loop and the thin app shell (menu / play / pause) around the simulation.
import { Input } from './core/input.js';
import { World } from './game/world.js';
import { Director } from './game/encounters.js';
import { Renderer } from './render/renderer.js';
import { buildArena } from './render/arenas.js';
import { Hud } from './ui/hud.js';
import { audio } from './audio/audio.js';
import { BotInput } from './game/bot.js';
import { clamp, pick } from './core/math.js';
import { FLOORS, roman, parseSeed } from './game/gen.js';

const canvas = document.getElementById('game');
const input = new Input();
input.attach(window);
const renderer = new Renderer(canvas);
const hud = new Hud();
const world = new World();
world.input = input;

// Progress is the highest floor reached. Storage can be unavailable (private windows), so every access is guarded.
const SAVE_KEY = 'sticksaber.floor';
const loadFloor = () => { try { return clamp(parseInt(localStorage.getItem(SAVE_KEY), 10) || 1, 1, FLOORS); } catch { return 1; } };
const saveFloor = (n) => { try { if (n > loadFloor()) localStorage.setItem(SAVE_KEY, String(n)); } catch { /* play on without saving */ } };
// `?seed=ABC123` pins the run so it can be replayed or shared; otherwise every run is new.
const fixedSeed = parseSeed(new URLSearchParams(location.search).get('seed') || '');

const app = { state: 'menu', idx: 0, muted: false, menu: [], toast: null, manual: false };
const live = () => app.state === 'play' || app.state === 'pause';

// One arena is baked at a time: each floor is its own seeded variant, so the previous one is released.
let arenaKey = '';
const director = new Director(world, {
  setArena(id, seed = 0) {
    const key = `${id}:${seed}`;
    if (key !== arenaKey) {
      renderer.arena?.dispose?.();
      renderer.arena = buildArena(id, { seed });
      arenaKey = key;
    }
    return renderer.arena.width;
  },
  onFloor(n) { if (live()) saveFloor(n); },
});

// The fight behind the title screen is silent.
world.sfxOut = (name, x, vol, pitch) => { if (live()) audio.play(name, { vol, pitch, pan: clamp((x - world.cam.x) / 720, -1, 1) }); };
world.loopOut = (name, on) => audio.loop(name, on && live());

function buildMenu() {
  const saved = loadFloor();
  app.menu = [{ id: 'run', label: 'ASCEND' }];
  if (saved > 1) app.menu.push({ id: 'continue', label: `CONTINUE  ·  FLOOR ${roman(saved)}`, floor: saved });
  app.menu.push({ id: 'train', label: 'TRAINING ROOM' }, { id: 'controls', label: 'CONTROLS' });
  app.idx = saved > 1 ? 1 : 0;
}

// Title screen: a scripted player spars in the background.
function toMenu() {
  app.state = 'menu';
  director.startTraining();
  director.hintT = 0; world.bannerMsg = null;
  world.clearEnemies();
  world.input = new BotInput(world, 0.9);
  buildMenu();
}
function demo(dt) {
  world.input.tick(dt);
  if (!world.fighters.some((f) => f.team === 1)) {
    const p = world.player, side = p.x > 0 ? -1 : 1;
    world.spawnEnemy(pick(['initiate', 'initiate', 'duelist', 'bulwark', 'lancer', 'wraith']), p.x + side * 420);
    if (Math.random() < 0.5) world.spawnEnemy(pick(['initiate', 'drone']), p.x - side * 380);
  }
}
function startRun(floor = 1, seed = fixedSeed || undefined) { world.input = input; app.state = 'play'; director.startRun(floor - 1, seed); }
function startTraining() { world.input = input; app.state = 'play'; director.startTraining(); }
const toast = (text) => { app.toast = { text, t: 1.8 }; };

addEventListener('resize', () => renderer.resize());
for (const ev of ['keydown', 'mousedown', 'touchstart']) addEventListener(ev, () => audio.init(), { passive: true });

const MODES = ['auto', 'high', 'low'];
function shell() {
  const hit = (...codes) => input.keysHit.some((c) => codes.includes(c));
  if (hit('KeyF')) { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}); }
  if (hit('KeyM')) { app.muted = !app.muted; audio.setVolumes({ master: app.muted ? 0 : 1 }); toast(app.muted ? 'SOUND OFF' : 'SOUND ON'); }
  if (hit('KeyG')) { const m = MODES[(MODES.indexOf(renderer.mode) + 1) % MODES.length]; renderer.setMode(m); toast(`GRAPHICS  ${m.toUpperCase()}`); }
  const confirm = hit('Enter', 'NumpadEnter', 'Space') || (input.usedPad && app.state !== 'play' && input.consume('jump', 0.1));
  const back = hit('Escape');
  switch (app.state) {
    case 'menu': {
      const n = app.menu.length;
      if (hit('ArrowUp', 'KeyW', 'ArrowLeft', 'KeyA')) { app.idx = (app.idx + n - 1) % n; audio.play('uiMove'); }
      if (hit('ArrowDown', 'KeyS', 'ArrowRight', 'KeyD')) { app.idx = (app.idx + 1) % n; audio.play('uiMove'); }
      if (confirm) {
        audio.play('uiSelect');
        const item = app.menu[app.idx];
        if (item.id === 'run') startRun(1);
        else if (item.id === 'continue') startRun(item.floor);
        else if (item.id === 'train') startTraining();
        else app.state = 'controls';
      }
      break;
    }
    case 'controls': if (confirm || back) { app.state = 'menu'; audio.play('uiMove'); } break;
    case 'pause':
      if (back || hit('KeyP')) app.state = 'play';
      else if (hit('KeyQ')) toMenu();
      break;
    case 'play':
      if (director.state === 'dead') {
        if (director.t > 1 && confirm) director.retry();
        else if (back) toMenu();
      } else if (director.state === 'victory') {
        if (director.t > 1.2 && (confirm || back)) toMenu();
      } else if (back || hit('KeyP')) { app.state = 'pause'; audio.play('uiMove'); }
      for (const c of input.keysHit) director.trainingKey(c);
      break;
  }
}

let rainT = 0;
function sound(dt) {
  const p = world.player, cam = world.cam, playing = app.state === 'play';
  if (app.state === 'menu' || app.state === 'controls') { audio.loop('heal', false); audio.loop('throw', false); }
  const pan = (x) => clamp((x - cam.x) / 720, -1, 1);
  const speed = (f) => clamp(Math.hypot(f.tx - f.ptx, f.ty - f.pty) / 22, 0, 1);
  audio.hum('player', playing && p && !p.dead && p.armed ? { pan: pan(p.x), speed: speed(p), pitch: world.overdrive > 0 ? 1.3 : 1, vol: 1 } : null);
  let n = 0;
  if (playing) {
    for (const f of world.fighters) {
      if (n >= 3 || f.team !== 1 || f.dead || f.phantom || !f.armed || f.def.blade.gun || f.bladeOn < 0.5 || f.fade < 0.5) continue;
      audio.hum('e' + n++, { pan: pan(f.x), speed: speed(f), pitch: f.def.boss ? 0.7 : f.scale > 1.3 ? 0.6 : 0.85, vol: 0.55 });
    }
  }
  for (; n < 3; n++) audio.hum('e' + n, null);
  const boss = world.boss && !world.boss.dead ? world.boss : null;
  const heat = clamp(0.25 + world.countEnemies() * 0.12 + world.style.rank * 0.08 + (boss && boss.ai.phase >= 2 ? 0.35 : 0) + (world.overdrive > 0 ? 0.4 : 0), 0, 1);
  audio.music(app.state === 'menu' || app.state === 'controls' ? 'menu' : director.music, heat);
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
    // Sub-step so no sim step exceeds 1/120 s whatever the display refresh rate.
    const n = Math.max(1, Math.ceil(dt * 120 - 0.01));
    for (let i = 0; i < n; i++) world.step(dt / n);
    director.update(dt);
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
window.__game = { world, director, app, input, renderer, hud, audio, startRun, startTraining, tick(dt) { clock += dt; advance(dt, clock); } };
requestAnimationFrame(frame);
