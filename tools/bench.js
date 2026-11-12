// Performance benchmark, run as part of `npm test`. It finishes in a few seconds and fails if the
// game gets slower than its budgets.
//
// Two parts:
//   1. Simulation, in Node: microseconds per 120 Hz step on a crowded late floor.
//   2. Rendering, in headless Chrome with GPU acceleration turned OFF. Software raster stands in for
//      a weak machine, where fill rate is the cost. It reports milliseconds per frame, and also draw
//      calls and megapixels drawn per frame. Those two counts are deterministic, so they catch a
//      regression even on a machine fast enough to hide it.
//
//   node tools/bench.js            run and assert
//   node tools/bench.js --report   run and print, never fail
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { World } from '../src/game/world.js';
import { Director } from '../src/game/encounters.js';
import { BotInput } from '../src/game/bot.js';

// Budgets. Times have generous headroom over what a 2020s laptop measures, because they depend on
// the machine. The counts do not depend on the machine, but they do move a little whenever gameplay
// changes how the scripted fight unfolds, so they carry about 25% headroom.
export const BUDGET = {
  simMicrosPerStep: 150,
  crowdMicrosPerStep: 1500, // 120 enemies at once in the training room
  high: { ms: 24, drawImage: 88, megapixels: 5.2 },
  low: { ms: 22, drawImage: 34, megapixels: 3.2 },
};
const FRAMES = 90, W = 1280, H = 720;
const report = process.argv.includes('--report');
const t00 = performance.now();
const fails = [];
const check = (label, value, limit, unit) => {
  const ok = value <= limit;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(34)} ${String(value).padStart(8)} ${unit.padEnd(6)} (budget ${limit})`);
  if (!ok) fails.push(label);
};

// ── 1. simulation ──
{
  const world = new World();
  world.input = new BotInput(world, 0.9);
  const dir = new Director(world, { setArena: (id) => (id === 'hall' ? 1900 : 2200), auto: true });
  dir.startRun(76, 31337);
  const dt = 1 / 120, steps = 7200;
  for (let i = 0; i < 600; i++) { world.input.tick(dt); world.step(dt); dir.update(dt); }
  const t0 = performance.now();
  let peak = 0;
  for (let i = 0; i < steps; i++) {
    world.input.tick(dt); world.step(dt); dir.update(dt);
    if (world.player.hp < world.player.maxHp * 0.5 && !world.player.dead) world.player.hp = world.player.maxHp;
    if (dir.state === 'dead' && dir.t > 1.5) dir.retry();
    if (world.fighters.length > peak) peak = world.fighters.length;
  }
  const us = ((performance.now() - t0) * 1000) / steps;
  console.log(`simulation: floors 77 to ${dir.stage + 1}, full build, ${steps} steps, up to ${peak} fighters`);
  check('microseconds per step', +us.toFixed(1), BUDGET.simMicrosPerStep, 'µs');
}

{
  const world = new World();
  world.input = new BotInput(world, 0.9);
  const dir = new Director(world, { setArena: () => 2200 });
  dir.startTraining(); world.clearEnemies();
  const keys = ['Digit1', 'Digit1', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit6', 'Digit7', 'Digit8', 'Digit5'];
  for (let i = 0; i < 120; i++) dir.trainingKey(keys[i % keys.length]);
  const dt = 1 / 120, steps = 1800;
  for (let i = 0; i < 240; i++) { world.input.tick(dt); world.step(dt); dir.update(dt); }
  const t0 = performance.now(), g0 = world.time;
  for (let i = 0; i < steps; i++) { world.input.tick(dt); world.step(dt); dir.update(dt); if (world.player.hp < 60) world.player.hp = 100; }
  const us = ((performance.now() - t0) * 1000) / steps;
  console.log(`simulation: crowd of 120 enemies, ${steps} steps`);
  check('microseconds per step', +us.toFixed(1), BUDGET.crowdMicrosPerStep, 'µs');
  // Hit-stop must not stack up until the fight crawls: the game clock should keep close to real time.
  check('percent of real time lost to freezes', +(100 - ((world.time - g0) / (steps * dt)) * 100).toFixed(0), 25, '%');
}

// ── 2. rendering ──
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let puppeteer = null;
try { puppeteer = (await import('puppeteer-core')).default; } catch { /* optional dev dependency */ }
if (!puppeteer || !existsSync(chrome)) {
  console.log('rendering: skipped (needs `npm install` and Chrome; set CHROME to its path)');
} else {
  const PORT = 5196;
  const server = spawn('node', [new URL('./serve.js', import.meta.url).pathname, PORT], { stdio: 'ignore' });
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--disable-gpu', '--disable-gpu-rasterization', '--disable-accelerated-2d-canvas'], defaultViewport: { width: W, height: H, deviceScaleFactor: 1 } });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    for (let i = 0; i < 40; i++) { try { await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' }); break; } catch { await new Promise((r) => setTimeout(r, 50)); } }
    await page.waitForFunction('window.__game', { timeout: 8000 }).catch(() => { throw new Error('the game did not boot: ' + (errors.join('; ') || 'no page error reported')); });
    const res = await page.evaluate(async (frames) => {
      const { BotInput } = await import('/src/game/bot.js');
      const { seedRng } = await import('/src/core/math.js');
      const g = window.__game, w = g.world, R = g.renderer, ctx = R.ctx;
      g.app.manual = true;
      const out = {};
      for (const mode of ['high', 'low']) {
        // The same crowded fight for both modes: every enemy type, scripted player, fixed seed.
        seedRng(4242);
        g.startTraining(); R.setMode(mode); R.quality = 1; R.resize();
        for (const k of ['Digit1', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8']) g.director.trainingKey(k);
        w.input = new BotInput(w, 0.9);
        const step = () => { w.input.tick(1 / 60); if (w.player.hp < 50) w.player.hp = 100; g.tick(1 / 60); };
        for (let i = 0; i < 70; i++) step();
        let calls = 0, px = 0;
        const od = ctx.drawImage;
        ctx.drawImage = function (...a) {
          calls++;
          const dw = a.length >= 9 ? a[7] : a.length >= 5 ? a[3] : a[0].width, dh = a.length >= 9 ? a[8] : a.length >= 5 ? a[4] : a[0].height;
          const t = ctx.getTransform();
          px += Math.abs(dw * dh * (t.a * t.d - t.b * t.c));
          return od.apply(ctx, a);
        };
        for (let i = 0; i < 20; i++) step();
        const perFrame = { calls: calls / 20, mp: px / 20 / 1e6 };
        ctx.drawImage = od;
        ctx.getImageData(0, 0, 1, 1);
        const t0 = performance.now();
        // Read one pixel back after each frame so the raster cost lands inside the timing.
        for (let i = 0; i < frames; i++) { step(); ctx.getImageData(0, 0, 1, 1); }
        out[mode] = { ms: (performance.now() - t0) / frames, drawImage: perFrame.calls, megapixels: perFrame.mp, canvas: [R.canvas.width, R.canvas.height], fighters: w.fighters.length };
      }
      return out;
    }, FRAMES);
    for (const mode of ['high', 'low']) {
      const r = res[mode];
      console.log(`rendering, ${mode} quality: ${r.canvas.join('x')}, software raster, ${FRAMES} frames, ${r.fighters} fighters`);
      check('milliseconds per frame', +r.ms.toFixed(2), BUDGET[mode].ms, 'ms');
      check('drawImage calls per frame', +r.drawImage.toFixed(1), BUDGET[mode].drawImage, 'calls');
      check('megapixels drawn per frame', +r.megapixels.toFixed(2), BUDGET[mode].megapixels, 'MP');
    }
    if (errors.length) { console.log('  FAIL  page errors:\n    ' + errors.join('\n    ')); fails.push('page errors'); }
  } finally {
    await browser.close();
    server.kill();
  }
}

console.log(`bench finished in ${((performance.now() - t00) / 1000).toFixed(1)} s`);
if (fails.length && !report) { console.log(`over budget: ${fails.join(', ')}`); process.exit(1); }
