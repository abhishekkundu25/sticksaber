// Screenshot and measure arena-preview.html for a set of camera positions.
// Usage: node tools/arena-shot.js [arena[,arena]] [options]
//   --seeds 0,7,42     seeds to render (default 0)
//   --hues 0,120       hue rotations to render (default: none, the option is left out)
//   --only a,b         only these shot names (see SHOTS)
//   --stress 30        build, draw and dispose that many arenas once and report leaks
//   --soft             launch Chrome with GPU acceleration off (software raster)
//   --bench            time drawBack+drawFront per frame on the 'typical' shot (use with --soft)
//   --count            count drawImage calls / destination megapixels over the camera range on 'typical'
//   --before           render tools/out/arenas-before.js instead of src/render/arenas.js
//   --tag name         suffix for the output file names (default: none)
//   --port 5182        dev server port (needs: node tools/serve.js 5182)
// Screenshots go to tools/out/<arena>[-s<seed>][-h<hue>]-<shot>[-<tag>].png
import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const VALUED = ['--seeds', '--hues', '--only', '--tag', '--port', '--stress'];
const flag = (k) => args.includes(k);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt('--port', 5182));
const only = opt('--only', null)?.split(',');
const seeds = opt('--seeds', '0').split(',').map(Number);
const hues = opt('--hues', null)?.split(',').map(Number) ?? [null];
const tag = opt('--tag', '');
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
const arenas = (positional[0] || 'causeway,foundry,hall,garden,vault,apex').split(',');
const outDir = fileURLToPath(new URL('./out/', import.meta.url));

// x of ±1 means the camera's contract limit (±(width/2 + 200)); ±1.02 pushes a further 20 units for screen shake.
const SHOTS = [
  { name: 'typical', x: 0, y: -200, zoom: 1, w: 1280 },
  { name: 'wide', x: 300, y: -220, zoom: 0.9, w: 1680, t: 2.3 },
  { name: 'left-hi-out', x: -1, y: -460, zoom: 0.8, w: 1280 },
  { name: 'right-lo-in', x: 1, y: -100, zoom: 1.45, w: 1280 },
  { name: 'right-lo-out', x: 1, y: -100, zoom: 0.8, w: 1680 },
  { name: 'left-hi-in', x: -1, y: -460, zoom: 1.45, w: 960 },
  { name: 'shake-edge', x: -1.02, y: -472, zoom: 0.8, w: 1680 },
  { name: 'shake-edge-r', x: 1.02, y: -88, zoom: 0.8, w: 1680 },
  { name: 'q50', x: 150, y: -200, zoom: 1, w: 1280, q: 0.5 },
];

const SOFT = ['--disable-gpu', '--disable-gpu-rasterization', '--disable-accelerated-2d-canvas'];
const GPU = ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];

await mkdir(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: [...(flag('--soft') ? SOFT : GPU), '--js-flags=--expose-gc', '--enable-precise-memory-info'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('console', m.text()); });

const WIDTH = { causeway: 2200, foundry: 2200, hall: 1900, garden: 2100, vault: 2000, apex: 2300 };
if (opt('--stress', null)) {
  await page.goto(`http://localhost:${port}/tools/arena-preview.html?arena=${arenas[0]}&figs=0&stress=${opt('--stress')}`);
  await page.waitForFunction(() => window.__result, { timeout: 300000 });
  console.log('stress', JSON.stringify((await page.evaluate(() => window.__result)).stress));
  await browser.close();
  process.exit(0);
}
for (const arena of arenas) {
  const half = (WIDTH[arena] ?? 2200) / 2;
  for (const seed of seeds) for (const hue of hues) {
    for (const s of SHOTS) {
      if (only && !only.includes(s.name)) continue;
      const x = Math.abs(s.x) >= 1 && Math.abs(s.x) < 2 ? Math.sign(s.x) * (half + 200 + (Math.abs(s.x) - 1) * 1000) : s.x;
      const measure = s.name === 'typical';
      await page.setViewport({ width: s.w, height: 720, deviceScaleFactor: 1 });
      const q = new URLSearchParams({ arena, seed, x, y: s.y, zoom: s.zoom, w: s.w, t: s.t ?? 0.7, q: s.q ?? 1,
        bench: flag('--bench') && measure ? 1 : 0, count: flag('--count') && measure ? 1 : 0 });
      if (hue !== null) q.set('hue', hue);
      if (flag('--before')) q.set('src', 'before');
      await page.goto(`http://localhost:${port}/tools/arena-preview.html?${q}`);
      await page.waitForFunction(() => window.__result, { timeout: 120000 });
      const r = await page.evaluate(() => window.__result);
      const name = `${arena}${seed ? `-s${seed}` : ''}${hue !== null ? `-h${hue}` : ''}-${s.name}${tag ? `-${tag}` : ''}`;
      await page.screenshot({ path: `${outDir}${name}.png` });
      delete r.palette;
      console.log(name, JSON.stringify(r));
    }
  }
}
await browser.close();
