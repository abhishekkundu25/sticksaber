// Renders contact sheets of moves and scripted moments, stepping the real game at a fixed 60 Hz in
// headless Chrome, so animation and effects can be reviewed frame by frame. Output: tools/out/strip-*.png
//   node tools/strip.js [name ...]
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = 5198, OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const server = spawn('node', [new URL('./serve.js', import.meta.url).pathname, PORT], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 600));

// Each script: enemy to spawn (or null), its distance, timed key events [frame, action, down], and capture settings.
const J = (f) => [[f, 'light', 1], [f + 3, 'light', 0]];
const K = (f) => [[f, 'heavy', 1], [f + 3, 'heavy', 0]];
const SCRIPTS = {
  lights: { enemy: 'dummy', dist: 120, keys: [...J(4), ...J(22), ...J(40), ...J(60)], from: 4, frames: 96, every: 4, crop: [520, 330] },
  heavy: { enemy: 'dummy', dist: 110, keys: [[4, 'heavy', 1], [40, 'heavy', 0]], from: 4, frames: 72, every: 4, crop: [480, 330] },
  launch: { enemy: 'dummy', dist: 100, keys: [[4, 'down', 1], [4, 'heavy', 1], [40, 'heavy', 0], [20, 'down', 0], ...J(34), ...J(52), ...J(70), ...K(98)], from: 4, frames: 150, every: 6, crop: [460, 520], dy: -150 },
  comet: { enemy: 'dummy', dist: 120, keys: [...J(4), ...J(22), ...J(40), ...K(60)], from: 56, frames: 60, every: 3, crop: [520, 380], dy: -40 },
  run: { enemy: null, keys: [[2, 'right', 1], [50, 'jump', 1], [53, 'jump', 0], [70, 'jump', 1], [73, 'jump', 0], [90, 'dash', 1], [92, 'dash', 0]], from: 10, frames: 110, every: 5, crop: [420, 420], dy: -90 },
  kill: { enemy: 'initiate', dist: 120, hp: 30, passive: true, keys: [...J(4), ...J(22), ...J(40), ...J(60)], from: 60, frames: 84, every: 4, crop: [640, 400], dx: 120, dy: -60 },
  parry: { enemy: 'initiate', dist: 105, force: 'i_slash', keys: [[26, 'guard', 1], [44, 'guard', 0], ...J(42)], from: 30, frames: 48, every: 3, crop: [760, 340], dx: 120 },
  throw: { enemy: 'dummy', dist: 380, keys: [[4, 'special', 1], [8, 'special', 0]], from: 6, frames: 96, every: 4, crop: [760, 300], dx: 220 },
  forge: { enemy: 'forgemaster', dist: 250, force: 'fm_string', keys: [], from: 20, frames: 130, every: 10, crop: [760, 440], dx: 130, dy: -50 },
  erupt: { enemy: 'forgemaster', dist: 300, force: 'fm_erupt', keys: [], from: 20, frames: 110, every: 10, crop: [1100, 560], dx: 300, dy: -160 },
  wraith: { enemy: 'wraith', dist: 380, live: true, keys: [], from: 60, frames: 150, every: 10, crop: [900, 360], dx: 60 },
  drone: { enemy: 'drone', dist: 300, live: true, keys: [], from: 150, frames: 220, every: 11, crop: [900, 520], dy: -150 },
  lancer: { enemy: 'lancer', dist: 300, live: true, keys: [], from: 40, frames: 150, every: 10, crop: [820, 360], dx: 130 },
  echo: { enemy: 'proctor', dist: 300, live: true, p3: true, keys: [], from: 150, frames: 160, every: 10, crop: [1000, 420], dx: 150, dy: -40 },
  plunge: { enemy: 'dummy', dist: 90, keys: [[2, 'jump', 1], [20, 'jump', 0], [24, 'down', 1], [24, 'heavy', 1], [30, 'heavy', 0], [60, 'down', 0]], from: 20, frames: 72, every: 3, crop: [560, 520], dy: -130 },
};

async function run(name) {
  const sc = { z: Number(process.env.Z || 0.62), ...SCRIPTS[name] };
  const url = await page.evaluate(async (sc) => {
    const g = window.__game, w = g.world;
    g.app.manual = true;
    g.startTraining(); w.clearEnemies(); w.fx.clear(); w.bannerMsg = null; g.director.hintT = 0; w.focus = 300;
    const p = w.player; p.x = -100; w.cam.x = -60;
    let e = null;
    if (sc.enemy) {
      e = w.spawnEnemy(sc.enemy, p.x + sc.dist, false);
      if (sc.hp) e.hp = sc.hp;
      if (sc.passive || sc.force) e.def = { ...e.def, ctrl: null };
    }
    for (let i = 0; i < 40; i++) g.tick(1 / 60);
    if (sc.force) { e.face(p.x); e.startMove(sc.force); }
    if (sc.p3) { e.ai.phase = 2; e.double = true; e.color = e.def.color2; e.hp = e.maxHp * 0.24; e.ai.heals = []; }
    const cv = document.getElementById('game'), [cw, ch] = sc.crop;
    const n = Math.ceil(sc.frames / sc.every), cols = Math.min(n, Math.max(4, Math.floor(2400 / cw))), rows = Math.ceil(n / cols);
    const sheet = document.createElement('canvas'); sheet.width = cols * cw * sc.z; sheet.height = rows * ch * sc.z;
    const sx = sheet.getContext('2d'); sx.scale(sc.z, sc.z);
    let shot = 0;
    for (let f = 0; f < sc.from + sc.frames; f++) {
      for (const [kf, action, down] of sc.keys) if (kf === f) g.input.set(action, 'strip', !!down);
      if (sc.live) p.hp = 100;
      g.tick(1 / 60);
      if (f >= sc.from && (f - sc.from) % sc.every === 0) {
        const c = g.renderer.cam, k = g.renderer.k, v = g.renderer.view;
        const px = ((p.x + (sc.dx || 0) - c.x) * c.zoom + v.w / 2) * k, py = ((-60 + (sc.dy || 0) - c.y) * c.zoom + v.h / 2) * k;
        const x = (shot % cols) * cw, y = Math.floor(shot / cols) * ch;
        sx.drawImage(cv, px - cw / 2, py - ch / 2, cw, ch, x, y, cw, ch);
        sx.fillStyle = '#fff'; sx.font = '12px monospace'; sx.fillText(`f${f} ${p.state}${p.move ? ':' + p.move.id : ''}`, x + 6, y + 14);
        sx.strokeStyle = '#ffffff22'; sx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
        shot++;
      }
    }
    for (const a of ['light', 'heavy', 'guard', 'dash', 'jump', 'down', 'right', 'left', 'special']) g.input.set(a, 'strip', false);
    return sheet.toDataURL('image/png');
  }, sc);
  writeFileSync(`${OUT}strip-${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log('strip', name);
}

const names = process.argv.slice(2);
for (const n of names.length ? names : Object.keys(SCRIPTS)) await run(n);
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no runtime errors');
await browser.close();
server.kill();
