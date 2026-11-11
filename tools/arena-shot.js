// Screenshot arena-preview.html for a set of camera positions.
// Usage: node tools/arena-shot.js [arena[,arena]] [--bench] [--port 5182] [--only name]
// Needs the dev server: node tools/serve.js 5182
import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt('--port', 5182));
const only = opt('--only', null);
const arenas = (args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--port' && args[args.indexOf(a) - 1] !== '--only') || 'causeway,foundry,hall').split(',');
const outDir = fileURLToPath(new URL('./out/', import.meta.url));

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

await mkdir(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('console', m.text()); });

for (const arena of arenas) {
  const half = arena === 'hall' ? 950 : 1100;
  for (const s of SHOTS) {
    if (only && s.name !== only) continue;
    const x = Math.abs(s.x) >= 1 && Math.abs(s.x) < 2 ? Math.sign(s.x) * (half + 200 + (Math.abs(s.x) - 1) * 1000) : s.x;
    await page.setViewport({ width: s.w, height: 720, deviceScaleFactor: 1 });
    const q = new URLSearchParams({ arena, x, y: s.y, zoom: s.zoom, w: s.w, t: s.t ?? 0.7, q: s.q ?? 1, bench: flag('--bench') && s.name === 'typical' ? 1 : 0 });
    await page.goto(`http://localhost:${port}/tools/arena-preview.html?${q}`);
    await page.waitForFunction(() => window.__result, { timeout: 60000 });
    const r = await page.evaluate(() => window.__result);
    const file = `${outDir}${arena}-${s.name}.png`;
    await page.screenshot({ path: file });
    console.log(`${arena}-${s.name}`, JSON.stringify(r));
  }
}
await browser.close();
