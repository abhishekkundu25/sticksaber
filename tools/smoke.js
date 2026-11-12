// Drives the real game in headless Chrome: checks for runtime errors, takes screenshots of key
// moments into tools/out/, and reports frame timing. `node tools/smoke.js [scenario]`
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 5199, OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const server = spawn('node', [new URL('./serve.js', import.meta.url).pathname, PORT], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--window-size=1280,720', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
  defaultViewport: { width: Number(process.env.W || 1280), height: Number(process.env.H || 720), deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { await page.screenshot({ path: `${OUT}${name}.png` }); console.log('shot', name); };
const tap = async (code, hold = 40) => { await page.keyboard.down(code); await sleep(hold); await page.keyboard.up(code); };
const ev = (fn, ...a) => page.evaluate(fn, ...a);

const scenario = process.argv[2] || 'all';
try {
  await sleep(900);
  await shot('01-menu');
  if (scenario === 'menu') { await sleep(5000); await shot('01-menu-live'); }
  if (scenario === 'all' || scenario === 'train') {
    await ev(() => window.__game.startTraining());
    await sleep(700);
    await shot('02-training-idle');
    // Walk in and throw a light string, capturing mid-swing frames.
    await page.keyboard.down('KeyD'); await sleep(260); await page.keyboard.up('KeyD');
    await tap('KeyJ'); await sleep(110); await shot('03-L1');
    await tap('KeyJ'); await sleep(240); await tap('KeyJ'); await sleep(240); await tap('KeyJ'); await sleep(190); await shot('04-L4-spin');
    await sleep(700);
    // Launcher into air string.
    await page.keyboard.down('KeyS'); await page.keyboard.down('KeyK'); await sleep(260); await shot('05-launch');
    await sleep(120); await page.keyboard.up('KeyS');
    await tap('KeyJ'); await sleep(150); await shot('06-air'); await tap('KeyJ'); await sleep(200); await page.keyboard.up('KeyK');
    await tap('KeyK'); await sleep(260); await shot('07-spike');
    await sleep(900);
    // Spawn the whole roster for a silhouette line-up.
    await ev(() => { const g = window.__game; g.world.clearEnemies(); g.world.lockInput = true; const p = g.world.player; p.x = -520; g.world.cam.zoom = 0.9; ['initiate', 'bulwark', 'duelist', 'marksman', 'lancer', 'wraith', 'drone', 'brute', 'forgemaster', 'proctor'].forEach((k, i) => { const f = g.world.spawnEnemy(k, -380 + i * 130, false); f.def = { ...f.def, ctrl: null }; f.facing = -1; }); });
    await sleep(900);
    await shot('08-roster');
    await ev(() => { const g = window.__game; g.world.clearEnemies(); g.world.lockInput = false; });
  }
  if (scenario === 'all' || scenario === 'run') {
    // One screenshot a few seconds into each of the ten floors.
    for (let f = 1; f <= 10; f++) {
      await ev((n) => window.__game.startRun(n, 4242), f);
      await sleep(f === 5 || f === 10 ? 4600 : 5200);
      await shot(`floor-${String(f).padStart(2, '0')}`);
    }
  }
  if (scenario === 'all' || scenario === 'boss') {
    // Let the scripted player fight the boss at a fixed timestep and grab each signature moment once.
    const shots = await ev(async () => {
      const { BotInput } = await import('/src/game/bot.js');
      const g = window.__game, w = g.world;
      g.app.manual = true; g.startRun(10, 99);
      const real = w.input; w.input = new BotInput(w, 0.85);
      const cv = document.getElementById('game'), out = {}, pending = {};
      const want = {
        lunge: (b) => b.move?.id === 'p_lunge' && b.mt > 0.55 && b.mt < 0.7, crescent: () => w.projectiles.list.some((q) => q.type === 'crescent' && q.life < q.max - 0.25),
        phase: (b) => b.double && b.state === 'custom' && b.st > 1.05, heal: () => w.bossChannel > 0.1, marker: () => w.marker?.lock,
        slam: (b) => b.move?.id === 'p_slam' && b.mt > 0.05, cyclone: (b) => b.move?.id === 'p_cyclone' && b.mt > 0.36, read: (b) => !!b.reads, broken: (b) => b.broken && b.st > 0.3,
        echo: (b) => w.fighters.some((f) => f.phantom && f.state === 'attack' && f.mt > 0.3),
        dead: (b) => b.dead && b.deadT > 0.5, victory: () => g.director.state === 'victory' && g.director.t > 1.2,
      };
      for (let i = 0; i < 60 * 240 && Object.keys(out).length < Object.keys(want).length; i++) {
        w.input.tick(1 / 60); g.tick(1 / 60);
        const p = w.player, b = w.boss;
        if (p.hp < 50 && !p.dead) p.hp = 100;
        if (g.director.state === 'victory' && out.victory) break;
        if (!b) continue;
        if (out.phase && !pending.sky && b.state === 'free') { pending.sky = 1; b.ai.force = 'sky'; b.ai.cd = 0; }
        if (out.slam && !pending.cy && b.state === 'free') { pending.cy = 1; b.ai.force = 'p_cyclone'; b.ai.cd = 0; }
        for (const k in want) if (!out[k] && want[k](b)) out[k] = cv.toDataURL('image/jpeg', 0.85);
      }
      w.input = real; g.app.manual = false;
      return out;
    });
    const { writeFileSync } = await import('node:fs');
    for (const k in shots) { writeFileSync(`${OUT}boss-${k}.jpg`, Buffer.from(shots[k].split(',')[1], 'base64')); }
    console.log('boss moments:', Object.keys(shots).join(', '));
  }
  if (scenario === 'all' || scenario === 'perf') {
    // Busy scene: every enemy type fighting, measure rAF cadence and render cost.
    await ev(() => { const g = window.__game; g.startTraining(); ['Digit1', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'].forEach((k) => g.director.trainingKey(k)); });
    await tap('KeyL'); // a real key press, so the page is allowed to start audio
    await sleep(1500);
    const perf = await ev(() => new Promise((res) => {
      const ts = []; let n = 0;
      const tick = (t) => { ts.push(t); if (++n < 240) requestAnimationFrame(tick); else { const d = ts.slice(1).map((v, i) => v - ts[i]).sort((a, b) => a - b); res({ frames: n, medianMs: d[d.length >> 1], p95Ms: d[Math.floor(d.length * 0.95)], maxMs: d[d.length - 1], canvas: [document.getElementById('game').width, document.getElementById('game').height], quality: window.__game.renderer.quality }); } };
      requestAnimationFrame(tick);
    }));
    console.log('perf', JSON.stringify(perf));
    // Confirms the game is really driving the sound engine (context running, sounds played, no swallowed errors).
    console.log('audio', JSON.stringify(await ev(async () => (await import('/src/audio/audio.js')).audioDev.stats())));
    await shot('20-busy');
  }
} finally {
  console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no runtime errors');
  await browser.close();
  server.kill();
}
