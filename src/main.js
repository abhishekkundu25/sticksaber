// Boot, main loop and the thin app shell (menu / play / pause) around the simulation.
import { clamp } from './core/math.js';
import { Input } from './core/input.js';
import { World } from './game/world.js';
import { Director } from './game/encounters.js';
import { Renderer } from './render/renderer.js';
import { buildArena } from './render/arenas.js';
import { Hud, MENU } from './ui/hud.js';
import { audio } from './audio/audio.js';

const canvas = document.getElementById('game');
const input = new Input();
input.attach(window);
const renderer = new Renderer(canvas);
const hud = new Hud();
const world = new World();
world.input = input;

const arenas = {};
const director = new Director(world, {
  setArena(id) {
    arenas[id] ??= buildArena(id);
    renderer.arena = arenas[id];
    audio.loop('rain', id === 'causeway');
    return arenas[id].width;
  },
});

world.sfxOut = (name, x, vol) => audio.play(name, { vol, pan: clamp((x - world.cam.x) / 720, -1, 1) });
world.loopOut = (name, on) => audio.loop(name, on);

const app = { state: 'menu', idx: 0, muted: false };

function toMenu() {
  app.state = 'menu';
  director.startTraining();
  director.hintT = 0; world.bannerMsg = null; world.lockInput = true;
}
function startRun() { world.lockInput = false; app.state = 'play'; director.startRun(0); }
function startTraining() { world.lockInput = false; app.state = 'play'; director.startTraining(); }

addEventListener('resize', () => renderer.resize());
for (const ev of ['keydown', 'mousedown', 'touchstart']) addEventListener(ev, () => audio.init(), { passive: true });

function shell() {
  const hit = (...codes) => input.keysHit.some((c) => codes.includes(c));
  if (hit('KeyF')) { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}); }
  if (hit('KeyM')) { app.muted = !app.muted; audio.setVolumes({ master: app.muted ? 0 : 1 }); }
  const confirm = hit('Enter', 'NumpadEnter', 'Space') || (input.usedPad && app.state !== 'play' && input.consume('jump', 0.1));
  const back = hit('Escape');
  switch (app.state) {
    case 'menu':
      if (hit('ArrowUp', 'KeyW')) { app.idx = (app.idx + MENU.length - 1) % MENU.length; audio.play('uiMove'); }
      if (hit('ArrowDown', 'KeyS')) { app.idx = (app.idx + 1) % MENU.length; audio.play('uiMove'); }
      if (confirm) {
        audio.play('uiSelect');
        if (app.idx === 0) startRun(); else if (app.idx === 1) startTraining(); else app.state = 'controls';
      }
      break;
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

function sound(dt) {
  const p = world.player, cam = world.cam, live = app.state === 'play';
  const pan = (x) => clamp((x - cam.x) / 720, -1, 1);
  const speed = (f) => clamp(Math.hypot(f.tx - f.ptx, f.ty - f.pty) / 22, 0, 1);
  audio.hum('player', live && p && !p.dead && p.armed ? { pan: pan(p.x), speed: speed(p), pitch: 1, vol: 1 } : null);
  let n = 0;
  if (live) {
    for (const f of world.fighters) {
      if (n >= 3 || f.team !== 1 || f.dead || f.def.blade.gun || f.bladeOn < 0.5) continue;
      audio.hum('e' + n++, { pan: pan(f.x), speed: speed(f), pitch: f.def.boss ? 0.7 : f.scale > 1.3 ? 0.6 : 0.85, vol: 0.55 });
    }
  }
  for (; n < 3; n++) audio.hum('e' + n, null);
  const boss = world.boss && !world.boss.dead ? world.boss : null;
  const heat = clamp(0.25 + world.enemies.length * 0.14 + world.style.rank * 0.08 + (boss?.double ? 0.35 : 0), 0, 1);
  audio.music(app.state === 'menu' || app.state === 'controls' ? 'menu' : director.music, heat);
  audio.setSlowmo(live ? clamp(1 - world.timeScale, 0, 1) : 0);
  audio.update(dt);
}

// One frame of the whole app. The rAF loop calls it with wall-clock time; tools can call it with a
// fixed step (see `manual`) to render deterministic sequences.
function advance(dt, now) {
  input.poll(dt);
  shell();
  world.view = renderer.view;
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
window.__game = { world, director, app, input, renderer, audio, startRun, startTraining, tick(dt) { clock += dt; advance(dt, clock); } };
requestAnimationFrame(frame);
