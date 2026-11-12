// Contact sheets of the generated animals (src/game/beasts.js), stepped at a fixed 60 Hz in headless
// Chrome so silhouettes and motion can be reviewed. Output: tools/out/beast-*.png
//   node tools/beast-shot.js                 everything
//   node tools/beast-shot.js lineup seeds    only those sheets
//   node tools/beast-shot.js gait:hound atk:charger
// Sheets: lineup (every plan beside a humanoid), seeds (six seeds of each plan), gait:<plan> (walk,
// run, stop and turn), atk:<plan> (every attack of that plan, frame by frame), all-gaits, all-attacks.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { BEAST_PLANS } from '../src/game/beasts.js';

const PORT = 5199, OUT = new URL('./out/', import.meta.url).pathname;
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
await page.waitForFunction('window.__game');
await new Promise((r) => setTimeout(r, 400));

// Shared page-side helpers: a quiet room with a pinned camera, a beast built from a seed, and a sheet
// that crops the canvas around a world point.
await page.evaluate(async () => {
  const B = await import('/src/game/beasts.js');
  const { makeRng } = await import('/src/core/math.js');
  const { MOVES } = await import('/src/game/moves.js');
  const g = window.__game, w = g.world;
  g.app.manual = true;
  window.__bs = {
    B, MOVES,
    room(px = -900) {
      g.startTraining(); w.clearEnemies(); w.fx.clear(); w.bannerMsg = null; g.director.hintT = 0; w.setTerrain?.({ plats: [], vents: [], walls: false });
      w.player.x = px; w.player.facing = 1; w.focus = 300;
      w.updateCamera = () => {};
      w.cam.trauma = 0; w.cam.sx = 0; w.cam.sy = 0;
      if (g.hud) g.hud.draw = g.hud.draw && (() => {});
    },
    cam(x, y, z) { w.cam.x = x; w.cam.y = y; w.cam.zoom = z; w.cam.trauma = 0; w.cam.punchK = 0; },
    beast(plan, seed, tier = 5, x = 0, ctrl = null) {
      const def = B.makeBeast(makeRng(seed * 7919 + plan.length), `bs_${plan}_${seed}_${tier}`, plan, tier, new Set());
      w.roster[def.kind] = def;
      const e = w.spawnEnemy(def.kind, x, false);
      e.def = { ...def, ctrl };
      e.face(x + 100);
      return e;
    },
    tick(n) { for (let i = 0; i < n; i++) g.tick(1 / 60); },
    sheet(cols, rows, cw, ch, z = 1) {
      const c = document.createElement('canvas'); c.width = cols * cw * z; c.height = rows * ch * z;
      const x = c.getContext('2d'); x.scale(z, z); x.fillStyle = '#000'; x.fillRect(0, 0, cols * cw, rows * ch);
      return { c, x, cw, ch, cols };
    },
    // Copy the canvas around world point (wx, wy) into cell i of a sheet, with a label.
    grab(S, i, wx, wy, label) {
      const cv = document.getElementById('game'), R = g.renderer, c = R.cam, k = R.k, v = R.view;
      const px = ((wx - c.x) * c.zoom + v.w / 2) * k, py = ((wy - c.y) * c.zoom + v.h / 2) * k;
      const x = (i % S.cols) * S.cw, y = Math.floor(i / S.cols) * S.ch;
      S.x.drawImage(cv, px - S.cw / 2, py - S.ch / 2, S.cw, S.ch, x, y, S.cw, S.ch);
      S.x.fillStyle = '#fff'; S.x.font = '12px monospace'; S.x.fillText(label, x + 6, y + 14);
      S.x.strokeStyle = '#ffffff22'; S.x.strokeRect(x + 0.5, y + 0.5, S.cw - 1, S.ch - 1);
    },
  };
});

async function save(name, url) { writeFileSync(`${OUT}beast-${name}.png`, Buffer.from(url.split(',')[1], 'base64')); console.log('beast', name); }

// Every plan beside a humanoid, at game scale, in two rows of four.
async function lineup() {
  const url = await page.evaluate((plans) => {
    const S = window.__bs, g = window.__game, w = g.world;
    const sheet = S.sheet(1, 2, 1280, 330);
    for (let row = 0; row < 2; row++) {
      S.room(-560);
      const ini = w.spawnEnemy('initiate', -430, false); ini.def = { ...ini.def, ctrl: null }; ini.face(0);
      const list = plans.slice(row * 4, row * 4 + 4);
      list.forEach((p, i) => { const e = S.beast(p, 1, 5, -230 + i * 250); if (p === 'flyer') { e.y = -150; e.onGround = false; e.gravMul = 0; } });
      S.cam(0, -150, 1); S.tick(50);
      S.grab(sheet, row, 0, -110, list.join('   '));
    }
    return sheet.c.toDataURL('image/png');
  }, BEAST_PLANS);
  await save('lineup', url);
}

// Six seeds of every plan, standing.
async function seeds() {
  const url = await page.evaluate((plans) => {
    const S = window.__bs, g = window.__game, w = g.world;
    const sheet = S.sheet(6, plans.length, 300, 220, 0.8);
    plans.forEach((p, r) => {
      S.room(-1000);
      const es = [];
      for (let i = 0; i < 6; i++) { const e = S.beast(p, i + 2, 2 + i, -650 + i * 260); if (p === 'flyer') { e.y = -120; e.onGround = false; e.gravMul = 0; } es.push(e); }
      S.cam(0, -120, 0.82); S.tick(40);
      es.forEach((e, i) => S.grab(sheet, r * 6 + i, e.x, p === 'flyer' ? -160 : -70, `${e.def.name}  s${e.scale.toFixed(2)}`));
    });
    return sheet.c.toDataURL('image/png');
  }, BEAST_PLANS);
  await save('seeds', url);
}

// Three seeds of every plan, close up, for detail.
async function closeup() {
  const url = await page.evaluate((plans) => {
    const S = window.__bs, g = window.__game, w = g.world;
    const sheet = S.sheet(6, Math.ceil(plans.length * 3 / 6), 420, 300, 0.75);
    plans.forEach((p, r) => {
      for (let i = 0; i < 3; i++) {
        S.room(-1000);
        const e = S.beast(p, 11 + i * 5, 3 + i * 3, 0);
        if (p === 'flyer') { e.y = -120; e.onGround = false; e.gravMul = 0; }
        S.cam(0, -60, 2.0); S.tick(30 + i * 7);
        S.grab(sheet, r * 3 + i, 0, p === 'flyer' ? -150 : -45, `${e.def.name}  ${e.B.kind || ''}`);
      }
    });
    return sheet.c.toDataURL('image/png');
  }, BEAST_PLANS);
  await save('closeup', url);
}

// Walk, run, brake and turn. The beast is driven by a script instead of its brain.
async function gait(plan) {
  const url = await page.evaluate((plan) => {
    const S = window.__bs, g = window.__game, w = g.world;
    S.room(-1000);
    let fr = 0;
    const drive = (f) => {
      // 0-80 walk right, 80-170 run, 170-200 stop, 200-260 walk left (turned round), then idle.
      f.moveX = fr < 80 ? 0.4 : fr < 170 ? 1 : fr < 200 ? 0 : fr < 260 ? -0.4 : 0;
      if (fr >= 200 && fr < 260) f.facing = -1; else if (fr < 200) f.facing = 1;
      if (plan === 'flyer') { f.gravMul = 0; f.vy = (-150 - f.y) * 3; f.vx = f.moveX * f.def.runSpeed; }
    };
    const e = S.beast(plan, 3, 6, -500, drive);
    if (plan === 'flyer') { e.y = -150; e.onGround = false; }
    S.tick(10);
    const sheet = S.sheet(8, 6, 300, 220, 0.8);
    let shot = 0;
    for (fr = 0; fr < 320; fr++) {
      S.cam(e.x, -110, 1); S.tick(1);
      if (fr % 7 === 0 && shot < 48) S.grab(sheet, shot++, e.x, plan === 'flyer' ? -150 : -60, `f${fr} vx${Math.round(e.vx)} ${e.state}`);
    }
    return sheet.c.toDataURL('image/png');
  }, plan);
  await save(`gait-${plan}`, url);
}

// Every attack of a plan, forced, against a standing player.
async function attacks(plan) {
  const url = await page.evaluate((plan) => {
    const S = window.__bs, g = window.__game, w = g.world;
    const ids = Object.keys(S.MOVES).filter((id) => S.MOVES[id].src === id && id.startsWith('bt_') && S.B.makeBeast && id.includes({ hound: 'hound', charger: 'charger', raptor: 'raptor', stalker: 'stalker', scorpion: 'scorp', flyer: 'flyer', ape: 'ape', spitter: 'spit' }[plan]) && !id.endsWith('_land'));
    const every = 4, cols = 10;
    const rows = ids.reduce((n, id) => n + Math.ceil((S.MOVES[id].dur * 60 + 20) / every / cols), 0);
    const sheet = S.sheet(cols, rows, 300, 240, 0.7);
    let shot = 0;
    for (const id of ids) {
      S.room(-200);
      const fly = plan === 'flyer';
      const e = S.beast(plan, 3, 9, fly ? 60 : 30 + (id.includes('charge') ? 200 : 0), null);
      if (fly) { e.y = -200; e.onGround = false; e.gravMul = 0; e.def = { ...e.def, ctrl: e.def.ctrl }; }
      const spec = w.def(e.def.kind);
      if (fly) e.def = { ...e.def, ctrl: spec.ctrl }; // the flyer's brain steers its moves
      S.tick(20);
      e.face(w.player.x);
      if (fly) { e.ai.cd = 99; }
      e.aimLocal = 0;
      e.startMove(id);
      const n = Math.ceil((S.MOVES[id].dur * 60 + 20) / every) * every;
      const x0 = (e.x + w.player.x) / 2;
      for (let fr = 0; fr < n; fr++) {
        w.player.hp = 100;
        S.cam(x0, -140, 1); S.tick(1);
        if (fr % every === 0) S.grab(sheet, shot++, x0 + (fly ? 0 : 40), fly ? -150 : -80, `${id.replace('bt_', '')} ${(fr / 60).toFixed(2)} ${e.state}${e.tele > 0 ? (e.teleRed ? ' RED' : ' TELE') : ''}${e.activeHit ? ' HIT' : ''}`);
      }
      shot = Math.ceil(shot / cols) * cols;
    }
    return sheet.c.toDataURL('image/png');
  }, plan);
  await save(`atk-${plan}`, url);
}

// Draw cost: canvas calls and time for ten beasts against ten humanoids in the same room.
async function bench() {
  const res = await page.evaluate((plans) => {
    const S = window.__bs, g = window.__game, w = g.world, R = g.renderer, ctx = R.ctx, gl = R.g;
    const out = {};
    for (const set of ['humanoids', 'beasts', 'humanoids', 'beasts']) {
      S.room(-1000);
      for (let i = 0; i < 10; i++) {
        const x = -800 + i * 170;
        if (set === 'beasts') { const e = S.beast(plans[i % plans.length], i + 1, 5, x); e.def = { ...e.def, ctrl: (f) => { f.moveX = Math.sin(w.time + i) > 0 ? 0.6 : -0.6; } }; if (e.def.flying) { e.y = -150; e.onGround = false; } }
        else { const e = w.spawnEnemy(['initiate', 'bulwark', 'duelist', 'lancer', 'brute'][i % 5], x, false); e.def = { ...e.def, ctrl: (f) => { f.moveX = Math.sin(w.time + i) > 0 ? 0.6 : -0.6; } }; }
      }
      S.cam(0, -150, 0.6); S.tick(20);
      const foes = w.fighters.filter((f) => f.team === 1);
      let calls = 0;
      const wrap = (c) => { const o = {}; for (const k of ['stroke', 'fill', 'drawImage']) { o[k] = c[k]; c[k] = function (...a) { calls++; return o[k].apply(this, a); }; } return () => { for (const k in o) c[k] = o[k]; }; };
      const u1 = wrap(ctx), u2 = wrap(gl);
      for (const f of foes) { R.bodyFighter(ctx, f, w); R.glowFighter(gl, f, w); }
      u1(); u2();
      const t0 = performance.now();
      for (let n = 0; n < 200; n++) for (const f of foes) { R.bodyFighter(ctx, f, w); R.glowFighter(gl, f, w); }
      ctx.getImageData(0, 0, 1, 1);
      out[set] = { calls: calls / 10, usPerFighter: +((performance.now() - t0) * 1000 / 2000).toFixed(1) };
    }
    for (const p of plans) {
      S.room(-1000);
      for (let i = 0; i < 10; i++) S.beast(p, i + 1, 5, -800 + i * 170);
      S.cam(0, -150, 0.6); S.tick(20);
      const foes = w.fighters.filter((f) => f.team === 1), t0 = performance.now();
      for (let n = 0; n < 200; n++) for (const f of foes) { R.bodyFighter(ctx, f, w); R.glowFighter(gl, f, w); }
      ctx.getImageData(0, 0, 1, 1);
      out[p] = +((performance.now() - t0) * 1000 / 2000).toFixed(1);
    }
    return out;
  }, BEAST_PLANS);
  console.log('draw cost per fighter (solid and glow passes):', JSON.stringify(res));
}

const want = process.argv.slice(2);
const jobs = want.length ? want : ['lineup', 'seeds', ...BEAST_PLANS.map((p) => `gait:${p}`), ...BEAST_PLANS.map((p) => `atk:${p}`)];
for (const j of jobs) {
  if (j === 'lineup') await lineup();
  else if (j === 'seeds') await seeds();
  else if (j === 'closeup') await closeup();
  else if (j === 'bench') await bench();
  else if (j === 'all-gaits') for (const p of BEAST_PLANS) await gait(p);
  else if (j === 'all-attacks') for (const p of BEAST_PLANS) await attacks(p);
  else if (j.startsWith('gait:')) await gait(j.slice(5));
  else if (j.startsWith('atk:')) await attacks(j.slice(4));
}
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no runtime errors');
await browser.close();
server.kill();
