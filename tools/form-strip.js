// Contact sheets of every weapon form's strings, stepping the real game at a fixed 60 Hz in headless
// Chrome, so each form's motion can be reviewed frame by frame. Output: tools/out/form-<form>-<string>.png
//   node tools/form-strip.js                    every form, every string
//   node tools/form-strip.js twin               one form
//   node tools/form-strip.js twin lights crowd  some strings of one form
//
// Buttons are pressed the way a player would: each one just before the move in progress can be
// cancelled. Tokens: L light, H heavy, J jump, D dash, a `d` prefix holds down, `!` holds the button
// long enough to rise with a launcher, `!!` charges it, `wN` waits N frames.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { FORM_IDS } from '../src/game/forms.js';
import { STRINGS } from './form-dps.js';

const PORT = 5199, OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// Per string: tokens (or a function of the form's strings), target placement, capture window.
const SCRIPTS = {
  lights: { tokens: (s) => s.L, dist: 'reach', frames: 96, every: 3, crop: [460, 320] },
  finisher: { tokens: (s) => s.LF, dist: 'reach', frames: 96, every: 3, crop: [500, 340] },
  breaker: { tokens: () => 'L H', dist: 'reach', frames: 60, every: 3, crop: [460, 340] },
  heavy: { tokens: () => 'H!!', dist: 'reach', frames: 78, every: 3, crop: [480, 360] },
  air: { tokens: (s) => s.AIR, dist: 'reach', frames: 120, every: 4, crop: [460, 560], dy: -170 },
  spike: { tokens: () => 'dH! L L H', dist: 'reach', frames: 120, every: 4, crop: [460, 560], dy: -170 },
  dash: { tokens: () => 'D L', dist: 220, frames: 48, every: 3, crop: [560, 320], dx: 90 },
  plunge: { tokens: () => 'J! w16 dH', dist: 70, frames: 84, every: 3, crop: [520, 520], dy: -140 },
  crowd: { tokens: (s) => s.L, dist: 'reach', behind: -76, frames: 96, every: 3, crop: [560, 320] },
  riposte: { riposte: true, dist: 105, frames: 48, every: 2, from: 34, crop: [620, 340], dx: 80 },
};

async function main() {
  const args = process.argv.slice(2);
  const forms = args.length && FORM_IDS.includes(args[0]) ? [args.shift()] : FORM_IDS.filter((f) => f !== 'saber');
  const names = args.length ? args : Object.keys(SCRIPTS);

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

  try {
    for (const form of forms) for (const name of names) {
      const sc = { z: Number(process.env.Z || 0.62), form, ...SCRIPTS[name] };
      if (process.env.EVERY) sc.every = +process.env.EVERY;
      if (process.env.FRAMES) sc.frames = +process.env.FRAMES;
      if (sc.tokens) sc.tokens = sc.tokens(STRINGS[form]).split(' ');
      const url = await page.evaluate(shoot, sc);
      writeFileSync(`${OUT}form-${form}-${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
      console.log('strip', form, name);
    }
  } finally {
    console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no runtime errors');
    await browser.close();
    server.kill();
  }
}

// Runs in the page.
function shoot(sc) {
  const g = window.__game, w = g.world, I = g.input;
  g.app.manual = true;
  g.startTraining(); w.setForm(sc.form); w.clearEnemies(); w.fx.clear();
  w.bannerMsg = null; g.director.hintT = 0; w.focus = 0;
  w.platforms = []; w.hazards = []; // a bare floor, so nothing lands on a ledge mid-string
  const p = w.player; p.x = -100; p.facing = 1; w.cam.x = -60;
  const gap = sc.dist === 'reach' ? Math.max(60, p.bladeLen * 0.85) : sc.dist;
  const e = w.spawnEnemy(sc.riposte ? 'initiate' : 'dummy', p.x + gap, false);
  e.def = { ...e.def, ctrl: null }; e.hp = e.maxHp = 1e5;
  if (sc.behind) { const b = w.spawnEnemy('dummy', p.x + sc.behind, false); b.hp = b.maxHp = 1e5; }
  for (let i = 0; i < 40; i++) g.tick(1 / 60);
  p.facing = 1;

  const holds = {};
  const down = (a, frames) => { I.set(a, 'strip', true); holds[a] = Math.max(holds[a] || 0, frames); };
  const tokens = sc.tokens || [];
  let idx = 0, pend = -1, pendSerial = 0, waitF = 0;
  const press = () => {
    const tok = tokens[idx++];
    if (tok[0] === 'w') { waitF = +tok.slice(1); return; }
    const bang = tok.match(/!*$/)[0].length, t = tok.replace(/!+$/, '');
    const hold = bang === 2 ? 37 : bang === 1 ? 24 : 4;
    if (t[0] === 'd') down('down', 12);
    const b = t.slice(-1);
    down(b === 'L' ? 'light' : b === 'H' ? 'heavy' : b === 'J' ? 'jump' : 'dash', b === 'J' && bang ? 20 : hold);
    pend = 0; pendSerial = p.atkSerial || 0;
  };
  // Riposte: the Initiate slashes, the guard goes up just before the blade lands, then light.
  if (sc.riposte) { e.face(p.x); e.startMove('i_slash'); }
  const rkeys = sc.riposte ? [[26, 'guard', 1], [44, 'guard', 0], [42, 'light', 1], [46, 'light', 0]] : [];

  const cv = document.getElementById('game'), [cw, ch] = sc.crop, from = sc.from || 0;
  const n = Math.ceil(sc.frames / sc.every), cols = Math.min(n, Math.max(4, Math.floor(2400 / cw))), rows = Math.ceil(n / cols);
  const sheet = document.createElement('canvas'); sheet.width = cols * cw * sc.z; sheet.height = rows * ch * sc.z;
  const sx = sheet.getContext('2d'); sx.scale(sc.z, sc.z);
  let shot = 0;
  for (let f = 0; f < from + sc.frames; f++) {
    for (const [kf, a, on] of rkeys) if (kf === f) I.set(a, 'strip', !!on);
    if (tokens.length) {
      if (pend >= 0) { pend++; if ((p.atkSerial || 0) > pendSerial || p.state === 'dash' || pend > 9 || tokens[idx - 1] === 'J!' || tokens[idx - 1] === 'J') pend = -1; }
      if (waitF > 0) waitF--;
      else if (pend < 0 && idx < tokens.length) {
        const m = p.state === 'attack' ? p.move : null;
        if (m) { if (!m.plunge && p.mt >= Math.max(m.cancel * (p.hitLanded ? 0.75 : 1) - 0.06, m.rise ? m.rise + 0.03 : 0)) press(); }
        else if (p.state === 'dash') { if (p.st > 0.07) press(); }
        else if (p.state === 'free' && (idx === 0 || !p.onGround || tokens[idx][0] === 'w')) press();
      }
    }
    g.tick(1 / 60);
    for (const a in holds) if (holds[a] > 0 && --holds[a] === 0) I.set(a, 'strip', false);
    if (f >= from && (f - from) % sc.every === 0) {
      const c = g.renderer.cam, k = g.renderer.k, v = g.renderer.view;
      const px = ((p.x + (sc.dx || 0) - c.x) * c.zoom + v.w / 2) * k, py = ((-60 + (sc.dy || 0) - c.y) * c.zoom + v.h / 2) * k;
      const x = (shot % cols) * cw, y = Math.floor(shot / cols) * ch;
      sx.drawImage(cv, px - cw / 2, py - ch / 2, cw, ch, x, y, cw, ch);
      sx.fillStyle = '#fff'; sx.font = '12px monospace';
      sx.fillText(`f${f} ${p.state}${p.move ? ':' + p.move.id + ' ' + p.mt.toFixed(2) : ''}${p.activeHit ? ' HIT' : ''}`, x + 6, y + 14);
      sx.strokeStyle = '#ffffff22'; sx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
      shot++;
    }
  }
  for (const a of ['light', 'heavy', 'guard', 'dash', 'jump', 'down', 'right', 'left']) I.set(a, 'strip', false);
  return sheet.toDataURL('image/png');
}

await main();
