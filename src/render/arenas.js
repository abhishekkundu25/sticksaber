// Procedurally painted arenas. All static lighting is baked once into offscreen
// canvases by buildArena(); per frame each arena is a few parallax drawImage calls
// plus a small amount of ambient animation (rain, embers, dust motes).
//
// Contract:
//   buildArena(id, { quality = 1, seed = 0 }) -> { id, name, width, palette, reflect, seed, setPiece,
//     drawBack(ctx, cam, view, t), drawFront(ctx, cam, view, t), dispose() }
//   cam = { x, y, zoom } with x in [-width/2 - 200, width/2 + 200], y in [-460, -100], zoom in [0.8, 1.45]
//   (plus up to 24 units of shake); view = { w: 960..1680, h: 720 }. ctx may carry any scale+translate
//   transform (device or half-resolution scale): nothing reads the destination canvas size. Both draw
//   calls restore ctx state. seed is an unsigned 32-bit integer: 0 is the base look, any other value a
//   deterministic variant of the same family (layout, palette, weather, one set-piece). dispose()
//   releases every baked canvas at once (width and height 0); later draws do nothing.
//
// Cost model (software raster): a filtered drawImage costs ~1.5 ms per full 1280x720 screen, an
// unscaled integer-aligned copy ~0.2-0.4 ms, a solid fillRect almost nothing. So per frame:
//   - the backdrop (sky/back wall, far layer, haze wisps, merged at one parallax and zoom-free) and
//     its baked floor reflection are pixel copies from caches at the destination's scale;
//   - mid and near layers draw only the rectangles that hold pixels (cull());
//   - haze, fog, heat and the vignette are stacked solid bands;
//   - only the floor, mid/near layers and their reflections, and small effects are filtered draws.
//
// Layer model: a layer with parallax p maps layer point (lx, ly) to the screen as
//   sx = (lx - cam.x * px) * zp + w/2,   sy = (ly - cam.y * p) * zp + h/2,   zp = 1 + (zoom - 1) * zf
// where px and zf default to p (the backdrop has zf = 0). The floor is a sheared texture so its rows
// slide with perspective-correct parallax (row y has horizontal parallax 1 + y / D).

export const ARENA_IDS = ['causeway', 'foundry', 'hall'];

// Per-frame drawImage budget (drawBack + drawFront together) for every seed, measured at view
// 1280x720 on a context with scale 1: calls counted, destination area clipped to the canvas in
// megapixels, maximum over the contract's camera range (x, y and zoom grids incl. both extremes).
// Measured maxima over seeds 0-63 and a few large seeds: causeway 63 calls / 3.07 MP,
// foundry 52 / 2.89, hall 51 / 2.70 (seed 0: 52 / 2.71, 41 / 2.75, 32 / 2.29). Values below add headroom.
export const ARENA_DRAW_BUDGET = {
  causeway: { calls: 72, megapixelsAt720p: 3.4 },
  foundry: { calls: 60, megapixelsAt720p: 3.2 },
  hall: { calls: 58, megapixelsAt720p: 3.0 },
};

const TAU = Math.PI * 2;
const SHAKE = 24;
const CAM_Y = [-460, -100];
const ZOOM = [0.8, 1.45];
const VIEW_W = 1680;
const VIEW_H = 720;
const FG_PARALLAX = 1.35;

// ---------------------------------------------------------------- utilities

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const spreadR = (R, k) => (R() * 2 - 1) * k;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Colour shift for seeded variants: set while a variant bakes, null for the base look.
let TINT = null;
const TINT_CACHE = new Map();
function rgb(c) {
  if (typeof c !== 'string') return c;
  if (TINT) {
    let v = TINT_CACHE.get(c);
    if (!v) { const n = parseInt(c.slice(1), 16); v = TINT([(n >> 16) & 255, (n >> 8) & 255, n & 255]); TINT_CACHE.set(c, v); }
    return v;
  }
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hex(c) {
  const [r, g, b] = rgb(c);
  return '#' + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1);
}
const palette = (p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, hex(v)]));
// Hue rotation that moves colours near hue `hd` by `dd` degrees and colours near `ha` by `da`.
// Lightness and saturation are kept; `light` scales the lightness of colours near the fog hue `hf`.
function tintFn(hd, dd, ha, da, hf, light) {
  const dist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  return ([r, g, b]) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (d < 1e-6) return [r * 255, g * 255, b * 255];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const wd = 1 / (1 + (dist(h, hd) / 30) ** 2), wa = 1 / (1 + (dist(h, ha) / 30) ** 2);
    h = (h + (wd * dd + wa * da) / Math.max(1, wd + wa) + 360) % 360;
    const lf = 1 + (light - 1) / (1 + (dist(h, hf) / 40) ** 2) * Math.min(1, s * 2);
    const C = (1 - Math.abs(2 * l - 1)) * s, X = C * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - C / 2;
    const [R, G, B] = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
    // Keep the colour's luminance (times lf), so a hue shift never moves the readability band.
    const y0 = 0.2126 * r + 0.7152 * g + 0.0722 * b, o = [R + m, G + m, B + m];
    const y1 = 0.2126 * o[0] + 0.7152 * o[1] + 0.0722 * o[2], k = y1 > 1e-6 ? (y0 * lf) / y1 : 1;
    return o.map((v) => clamp(v * k, 0, 1) * 255);
  };
}
function col(c, a = 1) {
  const [r, g, b] = rgb(c);
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
}
function mix(a, b, t) {
  const x = rgb(a), y = rgb(b);
  return [lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)];
}

// Every canvas made while an arena builds is recorded so dispose() can release it.
let TRACK = null;
function mk(w, h, opaque = false) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext('2d', opaque ? { alpha: false } : undefined);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'medium'; // mipmapped downscale; 'high' adds bicubic upscaling at ~6x the cost
  if (TRACK) TRACK.push(c);
  return { c, g };
}
function free(...cs) { for (const c of cs) if (c) { c.width = 0; c.height = 0; } }

// Separable-ish blur by repeated 2x downscale then 2x upscale (no ctx.filter: Safari).
function blur(c, fx, fy = fx) {
  const chain = [c];
  let w = c.width, h = c.height, kx = 1, ky = 1;
  while (kx * 2 <= fx || ky * 2 <= fy) {
    if (kx * 2 <= fx) { kx *= 2; w = Math.max(1, Math.ceil(w / 2)); }
    if (ky * 2 <= fy) { ky *= 2; h = Math.max(1, Math.ceil(h / 2)); }
    const n = mk(w, h);
    n.g.drawImage(chain[chain.length - 1], 0, 0, w, h);
    chain.push(n.c);
  }
  for (let i = chain.length - 2; i >= 0; i--) {
    const d = chain[i], g = d.getContext('2d');
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'copy';
    g.globalAlpha = 1;
    g.drawImage(chain[i + 1], 0, 0, d.width, d.height);
    g.restore();
  }
  free(...chain.slice(1));
}

let NOISE = null;
function noiseTile() {
  if (NOISE) return NOISE;
  const track = TRACK;
  TRACK = null; // shared by every arena: never disposed
  const { c, g } = mk(256, 256);
  TRACK = track;
  const im = g.createImageData(256, 256);
  const r = rng(1337);
  for (let i = 0; i < im.data.length; i += 4) {
    const d = (r() + r() + r()) / 3 - 0.5;
    const v = d > 0 ? 255 : 0;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
    im.data[i + 3] = Math.min(255, Math.abs(d) * 2 * 255);
  }
  g.putImageData(im, 0, 0);
  NOISE = c;
  return c;
}

// ---------------------------------------------------------------- layer bounds

function sweep(fn) {
  const W = [], Y = [], Z = [];
  for (let i = 0; i <= 4; i++) {
    Y.push(lerp(CAM_Y[0] - SHAKE, CAM_Y[1] + SHAKE, i / 4));
    Z.push(lerp(ZOOM[0], ZOOM[1], i / 4));
  }
  W.push(-1, 1);
  for (const sx of W) for (const cy of Y) for (const z of Z) fn(sx, cy, z);
}

// mode 'back': only needs to reach a little below the play ground line (floor covers the rest).
// zf is the layer's zoom parallax (defaults to p); 0 means the layer ignores zoom.
function layerBounds(p, width, mode, px = p, zf = p) {
  const cxMax = width / 2 + 200 + SHAKE;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  sweep((sx, cy, z) => {
    const zp = 1 + (z - 1) * zf;
    const hw = (VIEW_W / 2 + SHAKE) / zp, hh = (VIEW_H / 2 + SHAKE) / zp;
    const lcx = sx * cxMax * px, lcy = cy * p;
    x0 = Math.min(x0, lcx - hw);
    x1 = Math.max(x1, lcx + hw);
    y0 = Math.min(y0, lcy - hh);
    let bot = lcy + hh;
    if (mode === 'back') bot = Math.min(bot, (-cy * z) / zp + lcy + 40 / zp);
    y1 = Math.max(y1, bot);
  });
  return { x0: Math.floor(x0 - 8), x1: Math.ceil(x1 + 8), y0: Math.floor(y0 - 8), y1: Math.ceil(y1 + 8) };
}

function mkLayer(p, res, b, px = p, zf = p) {
  const { c, g } = mk((b.x1 - b.x0) * res, (b.y1 - b.y0) * res);
  const sx = c.width / (b.x1 - b.x0), sy = c.height / (b.y1 - b.y0);
  g.setTransform(sx, 0, 0, sy, -b.x0 * sx, -b.y0 * sy);
  // ox0/ox1: the span random scatter is spread over (kept from the original layer when merged)
  return { p, px, zf, s: sx, sx, sy, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, ox0: b.x0, ox1: b.x1, c, g,
    Y: (sy0) => sy0 - 360 - 200 * p }; // design helper: layer y of a screen row at the typical camera
}

function backLayer(p, res, width, opts = {}) {
  const b = layerBounds(p, width, 'back', opts.px ?? p);
  if (opts.y0 !== undefined) b.y0 = Math.max(b.y0, opts.y0);
  if (opts.y1 !== undefined) b.y1 = Math.min(b.y1, opts.y1);
  return mkLayer(p, res, b, opts.px ?? p);
}

// The backdrop: an opaque layer that ignores zoom, so it can be drawn as an unscaled pixel copy.
// Its parts are painted as if they sat at their own parallax (their Y() matches the typical camera)
// and are flattened into it in order by flatten().
function backdrop(p, res, width) {
  const b = layerBounds(p, width, 'back', p, 0);
  const B = mkLayer(p, res, b, p, 0);
  free(B.c);
  B.parts = [];
  B.part = (pl, r = res, op = 'source-over', a = 1, z = B.parts.length) => {
    const dy = 200 * (pl - p);
    const L = mkLayer(p, r, { x0: b.x0, x1: b.x1, y0: b.y0 - dy, y1: b.y1 - dy }, p, 0);
    L.Y = (sy0) => sy0 - 360 - 200 * pl;
    L.dy = dy;
    L.op = op; L.a = a; L.z = z;
    B.parts.push(L);
    B.parts.sort((u, v) => u.z - v.z);
    return L;
  };
  return B;
}

// The floor texture: rows y in [yTop, yBot], x is "ground-line x", sheared per row.
function mkFloor(width, D, yTop, res) {
  const cxMax = width / 2 + 200 + SHAKE;
  let x0 = Infinity, x1 = -Infinity, yBot = 0;
  sweep((sx, cy, z) => {
    const hw = (VIEW_W / 2 + SHAKE) / z;
    yBot = Math.max(yBot, cy + (VIEW_H / 2 + SHAKE) / z);
    for (const y of [yTop, cy + (VIEW_H / 2 + SHAKE) / z]) {
      const q = 1 + y / D;
      x0 = Math.min(x0, sx * cxMax * q - hw);
      x1 = Math.max(x1, sx * cxMax * q + hw);
    }
  });
  const L = mkLayer(1, res, { x0: Math.floor(x0 - 8), x1: Math.ceil(x1 + 8), y0: yTop, y1: Math.ceil(yBot + 8) });
  L.D = D;
  return L;
}

// ---------------------------------------------------------------- bake helpers

function sub(L, div = 1) {
  const s = L.sx / div, t = L.sy / div;
  const m = mk(L.c.width / div, L.c.height / div);
  m.g.setTransform(s, 0, 0, t, -L.x0 * s, -L.y0 * t);
  return m;
}
// Composite a same-bounds canvas onto layer L, then release it.
function stamp(L, src, op = 'source-over', alpha = 1) {
  const g = L.g;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = op;
  g.globalAlpha = alpha;
  g.drawImage(src, 0, 0, L.c.width, L.c.height);
  g.restore();
  free(src);
}
// Paint at reduced resolution, blur, composite: cheap soft light, fog and clouds.
function soft(L, div, bl, fn, op = 'source-over', alpha = 1) {
  const m = sub(L, div);
  fn(m.g);
  if (bl > 1) blur(m.c, bl);
  stamp(L, m.c, op, alpha);
}
// Keep an unfogged copy for floor reflections (fogged lightly), so mirrors show structure.
function snapshot(L, fogStops) {
  const m = mk(L.c.width, L.c.height);
  m.g.drawImage(L.c, 0, 0);
  if (fogStops) {
    m.g.setTransform(L.sx, 0, 0, L.sy, -L.x0 * L.sx, -L.y0 * L.sy);
    vfill(L, fogStops, 'source-atop', m.g);
  }
  L.pre = m.c;
}
function grain(L, amount, atop = true) {
  const g = L.g;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = amount;
  g.globalCompositeOperation = atop ? 'source-atop' : 'source-over';
  g.fillStyle = g.createPattern(noiseTile(), 'repeat');
  g.fillRect(0, 0, L.c.width, L.c.height);
  g.restore();
}
// Vertical multi-stop fill across the whole layer. stops: [[y, color, alpha], ...]
function vfill(L, stops, op = 'source-over', g = L.g) {
  const ya = stops[0][0], yb = stops[stops.length - 1][0];
  const gr = g.createLinearGradient(0, ya, 0, yb);
  for (const [y, c, a = 1] of stops) gr.addColorStop(clamp((y - ya) / (yb - ya), 0, 1), col(c, a));
  g.save();
  g.globalCompositeOperation = op;
  g.fillStyle = gr;
  g.fillRect(L.x0, L.y0, L.x1 - L.x0, L.y1 - L.y0);
  g.restore();
}
function blob(g, x, y, rx, ry, c, a, core = 0) {
  g.save();
  g.translate(x, y);
  g.scale(rx, ry);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  gr.addColorStop(0, col(c, a));
  if (core > 0) gr.addColorStop(core, col(c, a * 0.85));
  gr.addColorStop(1, col(c, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, 1, 0, TAU);
  g.fill();
  g.restore();
}
function poly(g, pts, fill) {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
}
function rect(g, x, y, w, h, c, a = 1) { g.fillStyle = col(c, a); g.fillRect(x, y, w, h); }
function lineV(g, x, y0, y1, w, c, a) { g.fillStyle = col(c, a); g.fillRect(x - w / 2, y0, w, y1 - y0); }
function linGrad(g, x0, y0, x1, y1, stops) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  for (const [t, c, a = 1] of stops) gr.addColorStop(t, col(c, a));
  return gr;
}
// Soft light cone from (x, y) downward to y1, widening from w0 to w1.
function cone(g, x, y, y1, w0, w1, c, a, dx = 0) {
  g.fillStyle = linGrad(g, 0, y, 0, y1, [[0, c, a], [0.35, c, a * 0.45], [1, c, 0]]);
  poly(g, [x - w0 / 2, y, x + w0 / 2, y, x + dx + w1 / 2, y1, x + dx - w1 / 2, y1]);
  g.fill();
}
// Abstract glyph block: a few strokes on a 3x5 grid. Never letters.
function glyph(g, x, y, s, R) {
  const pts = [];
  for (let i = 0; i < 3; i++) {
    const a = [Math.floor(R() * 3), Math.floor(R() * 5)], b = [Math.floor(R() * 3), Math.floor(R() * 5)];
    if (a[0] !== b[0] && a[1] !== b[1]) b[1] = a[1];
    pts.push(a, b);
  }
  g.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    g.moveTo(x + pts[i][0] * s, y + pts[i][1] * s);
    g.lineTo(x + pts[i + 1][0] * s + (pts[i][0] === pts[i + 1][0] && pts[i][1] === pts[i + 1][1] ? s * 0.6 : 0), y + pts[i + 1][1] * s);
  }
  g.stroke();
}

function reflection(L, fx, fy, bl = 2) {
  const m = mk(L.c.width / fx, L.c.height / fy);
  m.g.drawImage(L.pre || L.c, 0, 0, m.c.width, m.c.height);
  if (bl > 1) blur(m.c, bl);
  const R = { p: L.p, px: L.px, zf: L.zf, sx: m.c.width / (L.x1 - L.x0), sy: m.c.height / (L.y1 - L.y0),
    x0: L.x0, y0: L.y0, x1: L.x1, y1: L.y1, c: m.c, g: m.g };
  R.rects = cull(R);
  return R;
}

function glowSprite(c, size = 64, falloff = 1) {
  const { c: cv, g } = mk(size, size);
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, col('#ffffff', 1));
  gr.addColorStop(0.08, col(c, 1));
  gr.addColorStop(0.3 * falloff, col(c, 0.35));
  gr.addColorStop(1, col(c, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return cv;
}

// Vignette: an elliptical falloff (zero inside 60/160 of the half-size, `strength` at 210/160)
// approximated as rows for the top and bottom edges composited with columns for the sides. Both
// passes are solid fills, so a darkening that used to be a full-screen image costs almost nothing.
// The 1D profile is a least-squares fit of 1-(1-g(u))(1-g(v)) to the radial original.
function vignette(strength, tint = '#000000') {
  const f = (r) => (r <= 60 ? 0 : r >= 210 ? strength : r < 60 + 0.55 * 150 ? ((r - 60) / (0.55 * 150)) * 0.35 * strength
    : (0.35 + 0.65 * (r - 60 - 0.55 * 150) / (0.45 * 150)) * strength);
  const N = 42, U = 1.025, us = [], D = [];
  for (let i = 0; i < N; i++) us.push((i / (N - 1)) * U);
  for (const u of us) D.push(us.map((v) => f(160 * Math.hypot(u, v))));
  const g = us.map((u) => f(160 * u));
  for (let it = 0; it < 60; it++) {
    for (let i = 0; i < N; i++) {
      let num = 0, den = 0;
      for (let j = 0; j < N; j++) { const a = 1 - g[j]; num += a * (D[i][j] - g[j]); den += a * a; }
      g[i] = clamp(num / den, 0, 1);
    }
  }
  const at = (t) => { const x = (t / U) * (N - 1), i = Math.min(N - 2, Math.floor(x)); return lerp(g[i], g[i + 1], x - i); };
  const steps = (step) => {
    const list = [], M = 400;
    let s0 = 0, a0 = 0;
    for (let i = 1; i <= M; i++) {
      const t = (i / M) * U, a = at(t);
      if (Math.abs(a - a0) > step || i === M) {
        const m = at((s0 + t) / 2);
        if (m > 0.002) list.push(s0, i === M ? 2 : t, m);
        s0 = t; a0 = a;
      }
    }
    return list;
  };
  // Full-height columns cost a span per row each, so the side pass uses coarser steps than the rows.
  return { fill: col(tint), rows: steps(0.005), cols: steps(0.01) };
}
function drawVignette(ctx, V, vw, vh) {
  ctx.fillStyle = V.fill;
  const snap = axisAligned();
  const k = snap ? MIR.a : 1, ox = snap ? MIR.e : 0, oy = snap ? MIR.f : 0;
  const R = snap ? Math.round : (v) => v;
  if (snap) ctx.setTransform(1, 0, 0, 1, 0, 0);
  // The old vignette image was stretched 4 units past each edge of the view.
  const cx = vw / 2, cy = vh / 2, hx = vw / 2 + 4, hy = vh / 2 + 4;
  const x0 = R(ox), x1 = R(ox + k * vw), y0 = R(oy), y1 = R(oy + k * vh);
  for (let i = 0, L = V.rows; i < L.length; i += 3) {
    ctx.globalAlpha = L[i + 2];
    const a = R(oy + k * (cy - L[i + 1] * hy)), b = R(oy + k * (cy - L[i] * hy));
    const c = R(oy + k * (cy + L[i] * hy)), d = R(oy + k * (cy + L[i + 1] * hy));
    if (b > y0 && a < y1) ctx.fillRect(x0, Math.max(a, y0), x1 - x0, Math.min(b, y1) - Math.max(a, y0));
    if (d > y0 && c < y1) ctx.fillRect(x0, Math.max(c, y0), x1 - x0, Math.min(d, y1) - Math.max(c, y0));
  }
  for (let i = 0, L = V.cols; i < L.length; i += 3) {
    ctx.globalAlpha = L[i + 2];
    const e = R(ox + k * (cx - L[i + 1] * hx)), f = R(ox + k * (cx - L[i] * hx));
    const g = R(ox + k * (cx + L[i] * hx)), h = R(ox + k * (cx + L[i + 1] * hx));
    if (f > x0 && e < x1) ctx.fillRect(Math.max(e, x0), y0, Math.min(f, x1) - Math.max(e, x0), y1 - y0);
    if (h > x0 && g < x1) ctx.fillRect(Math.max(g, x0), y0, Math.min(h, x1) - Math.max(g, x0), y1 - y0);
  }
  ctx.globalAlpha = 1;
  if (snap) ctx.setTransform(MIR.a, MIR.b, MIR.c, MIR.d, MIR.e, MIR.f);
}

// Ground-anchored vertical profiles (haze, fog, heat) are drawn as stacked solid bands: a solid
// fill costs almost nothing in a software rasteriser, a gradient or image costs as much as a layer.
// stops: [[worldY, alpha], ...] relative to the ground line (negative is up). Adjacent bands differ
// by at most `step` alpha, below the 8-bit quantisation of the colours involved.
function bands(color, stops, step = 0.008) {
  const y0 = stops[0][0], y1 = stops[stops.length - 1][0];
  const at = (y) => {
    for (let i = 1; i < stops.length; i++) {
      if (y <= stops[i][0]) { const [ya, aa] = stops[i - 1], [yb, ab] = stops[i]; return yb > ya ? lerp(aa, ab, (y - ya) / (yb - ya)) : ab; }
    }
    return stops[stops.length - 1][1];
  };
  const list = [];
  let s = y0, a = at(y0);
  for (let y = y0 + 1; y <= y1; y++) {
    const v = at(y);
    if (Math.abs(v - a) > step || y === y1) {
      const m = at((s + y) / 2);
      if (m > 0.002) list.push(s, y, m);
      s = y; a = v;
    }
  }
  return { fill: col(color), list };
}
function fogBands(color, stops, up, down, a) {
  return bands(color, stops.map(([t, v]) => [-up + t * (up + down), v * a]));
}

// Screen-anchored foreground strip, painted at 0.5px/unit and drawn at 2x (built-in defocus).
function fgStrip(width, height, paint) {
  const half = (width / 2 + 200 + SHAKE) * ZOOM[1] * FG_PARALLAX + VIEW_W / 2 + 60;
  const s = 0.5;
  const { c, g } = mk(half * 2 * s, height * s);
  g.setTransform(s, 0, 0, s, half * s, 0);
  paint(g, -half, half);
  blur(c, 2);
  // Column spans that hold anything: the strip is mostly empty between its props.
  const w = c.width, h = c.height, px = new Uint32Array(g.getImageData(0, 0, w, h).data.buffer);
  const spans = [];
  let open = -1;
  for (let x = 0; x <= w; x++) {
    let hit = false;
    if (x < w) for (let y = 0; y < h; y++) if ((px[y * w + x] >>> 24) > 1) { hit = true; break; }
    if (hit && open < 0) open = x;
    if (!hit && open >= 0) {
      const last = spans[spans.length - 1];
      if (last && open - last[1] < 8) last[1] = x; else spans.push([open, x]);
      open = -1;
    }
  }
  return { c, x0: -half, w: half * 2, h: height, spans: spans.map(([a, b]) => [-half + a / s, -half + b / s]) };
}

// ---------------------------------------------------------------- culling

// Disjoint rectangles (layer units) that cover every pixel of L with alpha above 1/255. Drawing only
// these skips the empty sky between towers and pillars. drawImage edges are not antialiased, so
// adjacent rectangles meet without seams. Cells are ~`unit` layer units; a rectangle grows down
// while at least `density` of its cells hold something, trading a little empty fill for fewer calls.
function cull(L, unit = 32, density = 0.8) {
  const w = L.c.width, h = L.c.height;
  const px = new Uint32Array(L.g.getImageData(0, 0, w, h).data.buffer);
  const cx = Math.max(4, Math.round(unit * L.sx)), cy = Math.max(4, Math.round(unit * L.sy));
  const cw = Math.ceil(w / cx), ch = Math.ceil(h / cy);
  const occ = new Uint8Array(cw * ch);
  for (let y = 0; y < h; y++) {
    const r = (y / cy) | 0, row = y * w;
    for (let c = 0; c < cw; c++) {
      if (occ[r * cw + c]) continue;
      const e = Math.min(w, (c + 1) * cx);
      for (let x = c * cx; x < e; x++) if ((px[row + x] >>> 24) > 1) { occ[r * cw + c] = 1; break; }
    }
  }
  const count = (r, a, b) => { let n = 0; for (let c = a; c < b; c++) n += occ[r * cw + c]; return n; };
  const rects = [];
  let open = [];
  const clash = (q, x0, x1, y0, y1) => rects.some((o) => o !== q && o.x0 < x1 && x0 < o.x1 && o.y0 < y1 && y0 < o.y1);
  for (let r = 0; r < ch; r++) {
    let pieces = [];
    for (let c = 0; c < cw; c++) {
      if (!occ[r * cw + c]) continue;
      const last = pieces[pieces.length - 1];
      if (last && c - last[1] <= 1) last[1] = c + 1; else pieces.push([c, c + 1]);
    }
    const next = [];
    for (const q of open) {
      const hit = pieces.filter((p) => p[0] < q.x1 && q.x0 < p[1]);
      if (!hit.length) continue;
      const x0 = Math.min(q.x0, ...hit.map((p) => p[0])), x1 = Math.max(q.x1, ...hit.map((p) => p[1]));
      const n = q.n + count(r, x0, x1);
      if (n < density * (x1 - x0) * (r + 1 - q.y0) || clash(q, x0, x1, q.y0, r + 1)) continue;
      q.x0 = x0; q.x1 = x1; q.y1 = r + 1; q.n = n;
      next.push(q);
      const rest = [];
      for (const p of pieces) {
        if (p[1] <= x0 || p[0] >= x1) rest.push(p);
        else {
          if (p[0] < x0) rest.push([p[0], x0]);
          if (p[1] > x1) rest.push([x1, p[1]]);
        }
      }
      pieces = rest;
    }
    for (const p of pieces) {
      const q = { x0: p[0], x1: p[1], y0: r, y1: r + 1, n: count(r, p[0], p[1]) };
      rects.push(q);
      next.push(q);
    }
    open = next;
  }
  return rects.map((o) => ({
    x0: L.x0 + (o.x0 * cx) / L.sx, x1: Math.min(L.x1, L.x0 + (o.x1 * cx) / L.sx),
    y0: L.y0 + (o.y0 * cy) / L.sy, y1: Math.min(L.y1, L.y0 + (o.y1 * cy) / L.sy),
  }));
}

// ---------------------------------------------------------------- per-frame draws

// Base transform of the destination context, captured at the start of drawBack/drawFront.
const MIR = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
function saveBase(ctx) {
  const m = ctx.getTransform();
  MIR.a = m.a; MIR.b = m.b; MIR.c = m.c; MIR.d = m.d; MIR.e = m.e; MIR.f = m.f;
}
const axisAligned = () => MIR.b === 0 && MIR.c === 0 && MIR.a > 0 && Math.abs(MIR.a - MIR.d) <= 1e-6 * MIR.a;

// Draw the part of layer L's [x0,x1]x[y0,y1] (layer units) visible in the view, optionally clipped below clipY.
function drawRect(ctx, L, cam, vw, vh, clipY, x0, x1, y0, y1) {
  const zp = 1 + (cam.zoom - 1) * L.zf, cx = cam.x * L.px, cy = cam.y * L.p;
  const hw = vw / 2 / zp, hh = vh / 2 / zp;
  let a0 = cx - hw, a1 = cx + hw, b0 = cy - hh, b1 = cy + hh;
  if (clipY !== undefined) b1 = Math.min(b1, (clipY - vh / 2) / zp + cy + 3 / zp);
  if (a0 < x0) a0 = x0;
  if (a1 > x1) a1 = x1;
  if (b0 < y0) b0 = y0;
  if (b1 > y1) b1 = y1;
  if (a1 <= a0 || b1 <= b0) return;
  ctx.drawImage(L.c, (a0 - L.x0) * L.sx, (b0 - L.y0) * L.sy, (a1 - a0) * L.sx, (b1 - b0) * L.sy,
    (a0 - cx) * zp + vw / 2, (b0 - cy) * zp + vh / 2, (a1 - a0) * zp, (b1 - b0) * zp);
}
function drawLayer(ctx, L, cam, vw, vh, clipY) {
  if (!L.rects) return drawRect(ctx, L, cam, vw, vh, clipY, L.x0, L.x1, L.y0, L.y1);
  for (const r of L.rects) drawRect(ctx, L, cam, vw, vh, clipY, r.x0, r.x1, r.y0, r.y1);
}

// Mirror the part of a layer above screen row `axis` into the rows below it.
function drawMirror(ctx, L, cam, vw, vh, axis) {
  if (axis >= vh) return;
  ctx.setTransform(MIR.a, MIR.b, -MIR.c, -MIR.d, MIR.c * 2 * axis + MIR.e, MIR.d * 2 * axis + MIR.f);
  const zp = 1 + (cam.zoom - 1) * L.zf, cy = cam.y * L.p;
  const y0 = (2 * axis - vh - vh / 2) / zp + cy, y1 = (axis - vh / 2) / zp + cy;
  if (!L.rects) drawRect(ctx, L, cam, vw, vh, undefined, L.x0, L.x1, Math.max(L.y0, y0), Math.min(L.y1, y1));
  else for (const r of L.rects) drawRect(ctx, L, cam, vw, vh, undefined, r.x0, r.x1, Math.max(r.y0, y0), Math.min(r.y1, y1));
  ctx.setTransform(MIR.a, MIR.b, MIR.c, MIR.d, MIR.e, MIR.f);
}

// A zoom-free layer resampled once to the destination's pixel scale, so it draws as an unscaled,
// unfiltered copy at integer offsets. Up to two scales are kept (for example a half-resolution tier).
function pixels(A, L, k) {
  const list = L.dev || (L.dev = []);
  for (const d of list) if (d.k === k) return d.c;
  const w = Math.ceil((L.x1 - L.x0) * k), h = Math.ceil((L.y1 - L.y0) * k);
  if (A.disposed || w * h > 16e6) return null;
  if (list.length >= 2) free(list.shift().c);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { alpha: false });
  g.drawImage(L.c, 0, 0, w, h);
  A.track.push(c);
  list.push({ k, c });
  return c;
}
// Draw zoom-free layer L placed at screen = layer + (offX, offY), rows [top, bot) of the view.
// Rows the layer does not reach are filled with `fill` (only possible past the contract's range).
function drawPinned(ctx, A, L, offX, offY, top, bot, vw, fill) {
  if (bot <= top) return;
  const C = axisAligned() ? pixels(A, L, MIR.a) : null;
  if (!C) {
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, top, vw, bot - top); }
    const x0 = Math.max(L.x0, -offX), x1 = Math.min(L.x1, vw - offX), y0 = Math.max(L.y0, top - offY), y1 = Math.min(L.y1, bot - offY);
    if (x1 > x0 && y1 > y0) {
      ctx.drawImage(L.c, (x0 - L.x0) * L.sx, (y0 - L.y0) * L.sy, (x1 - x0) * L.sx, (y1 - y0) * L.sy, x0 + offX, y0 + offY, x1 - x0, y1 - y0);
    }
    return;
  }
  const k = MIR.a;
  const ox = Math.round(k * (L.x0 + offX) + MIR.e), oy = Math.round(k * (L.y0 + offY) + MIR.f);
  const vx0 = Math.floor(MIR.e), vx1 = Math.ceil(MIR.e + k * vw);
  const vy0 = Math.round(k * top + MIR.f), vy1 = Math.round(k * bot + MIR.f);
  const dx0 = Math.max(vx0, ox), dx1 = Math.min(vx1, ox + C.width);
  const dy0 = Math.max(vy0, oy), dy1 = Math.min(vy1, oy + C.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (dx1 > dx0 && dy1 > dy0) ctx.drawImage(C, dx0 - ox, dy0 - oy, dx1 - dx0, dy1 - dy0, dx0, dy0, dx1 - dx0, dy1 - dy0);
  if (fill && (dy1 < vy1 || dy0 > vy0 || dx0 > vx0 || dx1 < vx1)) {
    ctx.fillStyle = fill;
    if (dy0 > vy0) ctx.fillRect(vx0, vy0, vx1 - vx0, dy0 - vy0);
    if (dy1 < vy1) ctx.fillRect(vx0, Math.max(vy0, dy1), vx1 - vx0, vy1 - Math.max(vy0, dy1));
    if (dx0 > vx0) ctx.fillRect(vx0, vy0, dx0 - vx0, vy1 - vy0);
    if (dx1 < vx1) ctx.fillRect(dx1, vy0, vx1 - dx1, vy1 - vy0);
  }
  ctx.setTransform(MIR.a, MIR.b, MIR.c, MIR.d, MIR.e, MIR.f);
}

// Stacked bands from bands(): world y relative to the ground row sg, clipped to view rows [top, bot).
function drawBands(ctx, B, sg, z, top, bot, vw, alpha = 1) {
  if (bot <= top || alpha <= 0) return;
  ctx.fillStyle = B.fill;
  const L = B.list;
  if (axisAligned()) {
    // Snap band edges to device rows: antialiased fractional edges would leave a darker seam per band.
    const k = MIR.a, x0 = Math.floor(MIR.e), x1 = Math.ceil(MIR.e + k * vw);
    const r0 = Math.round(k * top + MIR.f), r1 = Math.round(k * bot + MIR.f);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i < L.length; i += 3) {
      let a = Math.round(k * (sg + L[i] * z) + MIR.f), b = Math.round(k * (sg + L[i + 1] * z) + MIR.f);
      if (a < r0) a = r0;
      if (b > r1) b = r1;
      if (b <= a) continue;
      ctx.globalAlpha = L[i + 2] * alpha;
      ctx.fillRect(x0, a, x1 - x0, b - a);
    }
    ctx.setTransform(MIR.a, MIR.b, MIR.c, MIR.d, MIR.e, MIR.f);
  } else {
    for (let i = 0; i < L.length; i += 3) {
      const a = Math.max(top, sg + L[i] * z), b = Math.min(bot, sg + L[i + 1] * z);
      if (b <= a) continue;
      ctx.globalAlpha = L[i + 2] * alpha;
      ctx.fillRect(0, a, vw, b - a);
    }
  }
  ctx.globalAlpha = 1;
}

function drawFloor(ctx, F, cam, vw, vh) {
  const z = cam.zoom;
  let y0 = cam.y - vh / 2 / z, y1 = cam.y + vh / 2 / z;
  if (y0 < F.y0) y0 = F.y0;
  if (y1 > F.y1) y1 = F.y1;
  if (y1 <= y0) return;
  const hw = vw / 2 / z, qa = 1 + y0 / F.D, qb = 1 + y1 / F.D;
  let x0 = Math.min(cam.x * qa, cam.x * qb) - hw, x1 = Math.max(cam.x * qa, cam.x * qb) + hw;
  if (x0 < F.x0) x0 = F.x0;
  if (x1 > F.x1) x1 = F.x1;
  // sx = z*(x - cam.x*(1 + y/D)) + vw/2 ; sy = z*(y - cam.y) + vh/2
  const a = z, c = -z * cam.x / F.D, e = vw / 2 - z * cam.x, f = vh / 2 - z * cam.y;
  ctx.setTransform(MIR.a * a, MIR.b * a, MIR.a * c + MIR.c * z, MIR.b * c + MIR.d * z,
    MIR.a * e + MIR.c * f + MIR.e, MIR.b * e + MIR.d * f + MIR.f);
  ctx.drawImage(F.c, (x0 - F.x0) * F.sx, (y0 - F.y0) * F.sy, (x1 - x0) * F.sx, (y1 - y0) * F.sy, x0, y0, x1 - x0, y1 - y0);
  ctx.setTransform(MIR.a, MIR.b, MIR.c, MIR.d, MIR.e, MIR.f);
}

function drawFg(ctx, S, cam, vw, vh, top) {
  const off = -cam.x * cam.zoom * FG_PARALLAX + vw / 2;
  const k = S.c.width / S.w;
  for (const [a, b] of S.spans) {
    const x0 = Math.max(a, -off), x1 = Math.min(b, vw - off);
    if (x1 > x0) ctx.drawImage(S.c, (x0 - S.x0) * k, 0, (x1 - x0) * k, S.c.height, x0 + off, top ? 0 : vh - S.h, x1 - x0, S.h);
  }
}

function layerToScreen(L, lx, ly, cam, vw, vh, out) {
  const zp = 1 + (cam.zoom - 1) * L.zf;
  out.x = (lx - cam.x * L.px) * zp + vw / 2;
  out.y = (ly + (L.dy || 0) - cam.y * L.p) * zp + vh / 2;
  out.z = zp;
  return out;
}
const TMP = { x: 0, y: 0, z: 1 };

function hash(i) {
  let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- backdrop flattening

// Flatten a backdrop's parts into one opaque canvas, and bake its floor reflection: the floor base
// colour under blurred, mirrored copies of the parts (refl[i] = [alpha, fx, fy, blur] for part i,
// or null to leave a part out of the reflection). The reflection is stored flipped (its y is minus
// the backdrop's y) so it too draws as an unscaled copy.
function flatten(B, floorBase, refl) {
  const w = Math.round((B.x1 - B.x0) * B.sx), h = Math.round((B.y1 - B.y0) * B.sy);
  const { c, g } = mk(w, h, true);
  B.c = c; B.g = g;
  for (const L of B.parts) {
    g.globalCompositeOperation = L.op;
    g.globalAlpha = L.a;
    g.drawImage(L.c, 0, 0, w, h);
  }
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;

  // Backdrop rows that can appear mirrored below the ground line, over the whole camera range.
  let rt = Infinity, rb = -Infinity;
  sweep((sx, cy, z) => {
    const sg = -cy * z + VIEW_H / 2;
    if (sg > VIEW_H + SHAKE) return;
    const axis = sg - VIEW_H / 2 + cy * B.p;
    rt = Math.min(rt, axis - (VIEW_H + SHAKE - sg));
    rb = Math.max(rb, axis);
  });
  rt = Math.max(B.y0, Math.floor(rt - 8));
  rb = Math.min(B.y1, Math.ceil(rb + 8));
  const R = mkLayer(B.p, B.sx, { x0: B.x0, x1: B.x1, y0: -rb, y1: -rt }, B.p, 0);
  const rw = R.c.width, rh = R.c.height;
  R.g.setTransform(1, 0, 0, 1, 0, 0);
  R.g.fillStyle = col(floorBase);
  R.g.fillRect(0, 0, rw, rh);
  B.parts.forEach((L, i) => {
    const r = refl[i];
    if (!r) return;
    const [a, fx, fy, bl] = r;
    const src = L.pre || L.c, sy0 = (rt - B.y0) * L.sy, sh = (rb - rt) * L.sy;
    const m = mk(src.width / fx, sh / fy);
    m.g.drawImage(src, 0, sy0, src.width, sh, 0, 0, m.c.width, m.c.height);
    if (bl > 1) blur(m.c, bl);
    R.g.setTransform(1, 0, 0, -1, 0, rh);
    R.g.globalAlpha = a;
    R.g.globalCompositeOperation = L.op;
    R.g.drawImage(m.c, 0, 0, rw, rh);
    free(m.c);
  });
  R.g.setTransform(1, 0, 0, 1, 0, 0);
  R.g.globalAlpha = 1;
  R.g.globalCompositeOperation = 'source-over';
  B.refl = R;
  for (const L of B.parts) free(L.c, L.pre);
  B.parts = null;
}

// Common frame skeleton shared by all arenas.
//   A.backdrop          opaque zoom-free layer (flatten()ed), drawn first with nothing beneath it
//   A.back              [{ L } | { fx } | { bands, op }] drawn over it, clipped at the ground line
//   A.mirrors           [[reflection, alpha, axisRow?]] drawn over the baked backdrop reflection
//   A.hazeRefl          bands under the floor texture, A.floor, then A.onFloor
//   A.front, A.fogFront (bands), A.fgTop/fgBot, A.vignette
function compose(A) {
  A.track = TRACK || [];
  return {
    drawBack(ctx, cam, view, t) {
      if (A.disposed) return;
      const vw = view.w, vh = view.h, sg = (0 - cam.y) * cam.zoom + vh / 2;
      ctx.save();
      saveBase(ctx);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      const B = A.backdrop, offX = -cam.x * B.px + vw / 2;
      drawPinned(ctx, A, B, offX, -cam.y * B.p + vh / 2, 0, Math.min(vh, sg + 3), vw);
      for (const step of A.back) {
        if (step.bands) {
          if (step.op) ctx.globalCompositeOperation = step.op;
          drawBands(ctx, step.bands, sg, cam.zoom, 0, Math.min(vh, sg), vw, step.a ? step.a(t) : 1);
          ctx.globalCompositeOperation = 'source-over';
        } else if (step.L) drawLayer(ctx, step.L, cam, vw, vh, sg);
        if (step.fx) step.fx(ctx, cam, vw, vh, t, sg);
      }
      // Floor: baked backdrop reflection (opaque), mirrored mid layers, then the sheared floor texture.
      if (sg < vh) {
        drawPinned(ctx, A, B.refl, offX, 2 * sg + cam.y * B.p - vh / 2, sg, vh, vw, A.floorBase);
        for (const [R, a, axisRow] of A.mirrors) {
          ctx.globalAlpha = a;
          const axis = axisRow ? (axisRow - cam.y) * cam.zoom + vh / 2 : sg;
          drawMirror(ctx, R, cam, vw, vh, axis);
        }
        ctx.globalAlpha = 1;
        if (A.hazeRefl) drawBands(ctx, A.hazeRefl, sg, cam.zoom, sg, vh, vw);
      }
      drawFloor(ctx, A.floor, cam, vw, vh);
      for (const step of A.onFloor) {
        if (step.L) drawLayer(ctx, step.L, cam, vw, vh);
        if (step.fx) step.fx(ctx, cam, vw, vh, t, sg);
      }
      ctx.restore();
    },
    drawFront(ctx, cam, view, t) {
      if (A.disposed) return;
      const vw = view.w, vh = view.h, sg = (0 - cam.y) * cam.zoom + vh / 2;
      ctx.save();
      saveBase(ctx);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      for (const fx of A.front) fx(ctx, cam, vw, vh, t, sg);
      if (A.fogFront) drawBands(ctx, A.fogFront, sg, cam.zoom, 0, vh, vw);
      if (A.fgTop) drawFg(ctx, A.fgTop, cam, vw, vh, true);
      if (A.fgBot) drawFg(ctx, A.fgBot, cam, vw, vh, false);
      drawVignette(ctx, A.vignette, vw, vh);
      ctx.restore();
    },
    dispose() {
      if (A.disposed) return;
      A.disposed = true;
      free(...A.track);
      A.track.length = 0;
    },
  };
}

// Haze: a ground-anchored band (drawn as solid bands) plus faint wisps baked into the backdrop.
function haze(B, q, color, stops, wisps, R) {
  const L = B.part(1, 0.25 * q);
  soft(L, 1, 2, (g) => {
    for (let i = 0; i < wisps.n; i++) {
      const x = lerp(L.ox0, L.ox1, R()), y = -20 - Math.pow(R(), 1.6) * wisps.h;
      blob(g, x, y, 120 + R() * 380, 10 + R() * 26, wisps.c, wisps.a * (0.4 + R() * 0.6));
    }
  });
  return bands(color, stops);
}

// ======================================================================
// SEEDED VARIANTS
// ======================================================================

// Base hues per family: dominant, accent and fog (degrees), used by the palette shift.
const HUES = { causeway: [186, 330, 192], foundry: [27, 197, 22], hall: [258, 41, 258] };
// How far each family's dominant hue may turn (min, max degrees) and its accent (± degrees). The
// foundry's orange turns blood red or olive quickly, so it gets a narrower, red-leaning range.
const HUE_RANGE = { causeway: [-25, 25, 25], foundry: [-14, 8, 25], hall: [-25, 25, 22] };

// Everything a variant changes, generated deterministically from (id, seed). Seed 0 is the base look.
function variant(id, seed) {
  seed >>>= 0;
  const V = { seed, scatter: 0, tint: null, haze: 1, rain: 1, slant: 0.16, embers: 1, dust: 1, piece: null };
  if (!seed) return V;
  const P = rng(Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ (id.length * 0x27d4eb2d));
  const pick = (a, b) => lerp(a, b, P());
  const spread = (k) => (P() * 2 - 1) * k;
  const choose = (list) => list[Math.floor(P() * list.length) % list.length];
  V.scatter = (Math.imul(seed, 0x2c1b3c6d) ^ 0x632be5ab) >>> 0;
  const [hd, ha, hf] = HUES[id];
  V.hue = [pick(HUE_RANGE[id][0], HUE_RANGE[id][1]), spread(HUE_RANGE[id][2])];
  V.light = pick(0.97, 1.12);
  V.tint = tintFn(hd, V.hue[0], ha, V.hue[1], hf, V.light);
  V.haze = pick(0.9, 1.12);
  if (id === 'causeway') {
    V.piece = choose(['searchlights', 'spire', 'moon']);
    V.spireX = pick(-420, 460);
    V.spireDY = pick(-40, 50);
    // the second spire stands on the other side of the screen centre, so the typical view holds both
    const room = V.spireX > 0 ? -1 : 1, d2 = pick(460, 700);
    V.spire2 = { x: Math.round(clamp(V.spireX + room * d2, -560, 560)), k: pick(0.5, 0.64), kh: pick(0.8, 0.9) };
    const n = 5 + Math.floor(P() * 4), slot = 2800 / n;
    V.towers = [];
    for (let i = 0; i < n; i++) {
      const w = Math.round(pick(110, 250));
      let x = Math.round(-1400 + slot * (i + 0.5) + spread(slot * 0.3));
      // keep the spire's core clear (the mid layer lines up with it at the typical camera)
      for (const [sx, c] of V.piece === 'spire' ? [[V.spireX, 70], [V.spire2.x, 150]] : [[V.spireX, 70]]) {
        const clear = w / 2 + c;
        if (Math.abs(x - sx) < clear) x = Math.round(sx + Math.sign(x - sx || 1) * clear);
      }
      V.towers.push([x, w, Math.round(pick(-170, 210))]);
    }
    V.signs = [];
    for (const [x, w, top] of V.towers) {
      if (P() < 0.35) continue;
      V.signs.push([x + spread(w / 2 - 14), Math.round(Math.max(top + 30, pick(-60, 230))), P() < 0.5 ? 'MAG' : 'TEAL']);
    }
    V.maglev = pick(150, 225);
    const p0 = pick(-1150, 100), span = pick(1150, 1600);
    V.pylons = [Math.round(p0), Math.round(p0 + span)];
    // pylons stand clear of the spires (both layers line up at the typical camera)
    for (const sx of V.piece === 'spire' ? [V.spireX, V.spire2.x] : [V.spireX]) {
      for (let i = 0; i < 2; i++) {
        const d = V.pylons[i] - sx;
        if (Math.abs(d) < 220) { const shift = (Math.sign(d) || 1) * 220 - d; V.pylons[0] += shift; V.pylons[1] += shift; }
      }
    }
    V.lamp = Math.round(pick(420, 560));
    V.rain = pick(0.5, 1.7);
    V.slant = pick(0.05, 0.3);
    const nb = V.piece === 'searchlights' ? 4 + Math.floor(P() * 3) : V.piece === 'spire' ? 2 : 1;
    // Searchlights rise from behind the skyline and lean away from the spire(s), never across them.
    V.beams = [];
    const spires = V.piece === 'spire' ? [V.spireX, V.spire2.x] : [V.spireX];
    for (let i = 0, tries = 0; i < nb && tries < 40; tries++) {
      const x = Math.round(pick(-1300, 1500));
      const near = spires.reduce((a, sx) => (Math.abs(x - sx) < Math.abs(x - a) ? sx : a), spires[0]);
      if (Math.abs(x - near) < 380) continue;
      const away = Math.sign(x - near), amp = pick(0.08, 0.15), a0 = away * pick(0.06 + amp, 0.4);
      V.beams.push({ x, a0, amp, w: pick(0.06, 0.11), ph: pick(0, TAU), c: P() < 0.22 ? '#ff7ac2' : '#9fe6ef', alpha: pick(0.11, 0.16) });
      i++;
    }
    V.moon = { x: Math.round(pick(-560, 640)), sy: pick(185, 225), r: pick(58, 80) };
    if (Math.abs(V.moon.x - V.spireX) < 300) V.moon.x = Math.round(V.spireX + (V.spireX > 0 ? -1 : 1) * pick(300, 520));
  } else if (id === 'foundry') {
    V.piece = choose(['pour', 'hooks', 'mouth']);
    const nf = 2 + Math.floor(P() * 3), fs = 2600 / nf;
    V.furnaces = [];
    for (let i = 0; i < nf; i++) V.furnaces.push([Math.round(-1300 + fs * (i + 0.5) + spread(fs * 0.25)), Math.round(pick(150, 230)), Math.round(pick(25, 140))]);
    V.stacks = [];
    for (let i = 0, ns = 3 + Math.floor(P() * 3); i < ns; i++) V.stacks.push(Math.round(pick(-1400, 1400)));
    V.rack = pick(125, 185);
    V.chains = [];
    for (let i = 0, nc = 4 + Math.floor(P() * 4); i < nc; i++) V.chains.push([Math.round(pick(-1500, 1500)), Math.round(pick(110, 270))]);
    V.pour = Math.round(pick(-420, 300));
    // the second pour (one set-piece) goes toward the side with room, the idle crucible the other way
    const toward = V.pour > -60 ? -1 : 1;
    V.pour2 = Math.round(V.pour + toward * pick(400, 520));
    V.idle = Math.round(V.piece === 'pour' ? V.pour - toward * pick(600, 850) : V.pour + (P() < 0.5 ? -1 : 1) * pick(600, 850));
    if (Math.abs(V.idle) > 1250) V.idle = Math.round(V.pour - Math.sign(V.idle) * pick(600, 850));
    const gap = pick(320, 500), step = pick(520, 680);
    V.columns = [];
    for (let x = gap + spread(60); x < 1750; x += step + spread(60)) V.columns.push(Math.round(x));
    for (let x = -gap + spread(60); x > -1750; x -= step + spread(60)) V.columns.unshift(Math.round(x));
    V.lamp = Math.round(pick(440, 600));
    V.vent = Math.round(pick(520, 760));
    V.embers = pick(0.5, 1.8);
    V.shaft = pick(-120, 260);
    V.heat = pick(0.8, 1.05);
    V.light = Math.min(V.light, 1.06); // the foundry's base already sits near the top of the band at high cameras
    V.tint = tintFn(hd, V.hue[0], ha, V.hue[1], hf, V.light);
    V.haze = Math.min(V.haze, 1.04);
    V.mouth = Math.floor(P() * nf);
  } else {
    V.piece = choose(['banners', 'lamps', 'cracked']);
    V.oculus = { x: Math.round(pick(-240, 240)), sy: pick(36, 100), r: Math.round(pick(215, 268)) };
    V.farStep = Math.round(pick(200, 270));
    V.midStep = Math.round(pick(340, 470));
    V.midW = Math.round(pick(86, 114));
    const inner = pick(470, 690), outer = inner + pick(640, 840);
    V.near = [-outer + spread(40), -inner + spread(40), inner + spread(40), outer + spread(40)].map(Math.round);
    const tilt = pick(-160, 160), wide = pick(0.8, 1.2);
    V.pools = [-480, -170, 170, 480].map((x) => Math.round(x * wide + tilt + V.oculus.x * 0.4));
    V.dust = pick(0.5, 1.8);
    V.crack = { a: pick(0.35, Math.PI - 0.35), seed: (seed * 7919) >>> 0 }; // impact in the lower half, which is always in view
  }
  return V;
}

// ======================================================================
// SPIRE CAUSEWAY
// ======================================================================

function buildCauseway(q, V) {
  const R = rng(0xc0ffee ^ V.scatter);
  const W = 2200;
  const FOG = '#2a5562';
  const pal = { key: '#43c4d2', accent: '#ff3f9f', fog: FOG, floor: '#071017', ambient: '#8fc3d1' };
  const MAG = '#ff3f9f', TEAL = '#4fd0dc';
  const SPIRE_X = V.spireX ?? 360, SPIRE_DY = V.spireDY ?? 0;
  const SLANT = V.slant;

  // Sky, far city and spire, the mid layer's faint rain sheets and the haze wisps share one backdrop.
  const B = backdrop(0.08, 0.6 * q, W);

  // --- sky ---------------------------------------------------------------
  const sky = B.part(0.02, 0.5 * q);
  {
    const L = sky, Y = L.Y;
    vfill(L, [[Y(-80), '#010208'], [Y(80), '#040817'], [Y(220), '#0a162b'], [Y(340), '#13293c'],
      [Y(450), '#1e4152'], [Y(560), '#285462'], [Y(700), '#285462']]);
    // city glow from below the horizon
    soft(L, 4, 8, (g) => {
      for (let i = 0; i < 14; i++) {
        const x = lerp(L.ox0, L.ox1, R());
        blob(g, x, Y(600 + R() * 80), 260 + R() * 420, 120 + R() * 80, R() < 0.3 ? '#7a2468' : '#3a8290', 0.3);
      }
    }, 'lighter', 0.55);
    // cloud ceiling: dark masses, undersides lit by the city (teal) and the spire (magenta)
    soft(L, 2, 2, (g) => {
      for (let i = 0; i < 170; i++) {
        const x = lerp(L.ox0, L.ox1, R()), y = Y(-80 + Math.pow(R(), 0.9) * 300);
        const rx = 90 + R() * 300, ry = 14 + R() * 34;
        blob(g, x, y - ry * 0.7, rx, ry * 1.5, '#010207', 0.55);
        const nearSpire = Math.abs(x - SPIRE_X + 30) < 420;
        const lit = nearSpire && R() < 0.6 ? '#7a2a6a' : R() < 0.15 ? '#5a2458' : '#2a5c6c';
        blob(g, x + rx * 0.1, y + ry * 0.45, rx * 0.85, ry * 0.55, lit, 0.42 * clamp((y - Y(-60)) / 260, 0.35, 1));
      }
    });
    if (V.piece === 'moon') { // a low, hazy moon sitting on the skyline, under the cloud ceiling
      const m = V.moon, my = Y(m.sy);
      soft(L, 4, 8, (g) => blob(g, m.x, my, m.r * 3.2, m.r * 2.4, '#3a7a86', 0.45), 'lighter');
      soft(L, 1, 2, (g) => {
        g.beginPath(); g.arc(m.x, my, m.r, 0, TAU);
        g.fillStyle = linGrad(g, 0, my - m.r, 0, my + m.r, [[0, '#9ccfd4'], [0.6, '#6fa8b0'], [1, '#3f7782']]);
        g.fill();
        g.globalCompositeOperation = 'source-atop';
        for (let i = 0; i < 9; i++) blob(g, m.x + spreadR(R, m.r * 0.6), my + spreadR(R, m.r * 0.6), m.r * (0.12 + R() * 0.2), m.r * (0.1 + R() * 0.16), '#3f7782', 0.4);
        // haze thickens toward the horizon
        g.fillStyle = linGrad(g, 0, my - m.r, 0, my + m.r, [[0, FOG, 0.15], [1, FOG, 0.7]]);
        g.fillRect(m.x - m.r, my - m.r, m.r * 2, m.r * 2);
      });
    }
    soft(L, 2, 2, (g) => {
      for (let i = 0; i < 110; i++) {
        const x = lerp(L.ox0, L.ox1, R()), y = Y(10 + R() * 260);
        blob(g, x, y, 50 + R() * 160, 2.5 + R() * 5, R() < 0.25 ? '#8a3378' : '#3a7484', 0.2);
      }
    }, 'lighter');
    grain(L, 0.05, false);
  }
  const beamTex = (() => {
    const { c, g } = mk(64, 512);
    g.fillStyle = linGrad(g, 0, 512, 0, 0, [[0, '#ffffff', 0], [0.3, '#ffffff', 0], [0.5, '#ffffff', 0.6], [0.72, '#ffffff', 1], [1, '#ffffff', 0]]);
    poly(g, [28, 512, 36, 512, 64, 0, 0, 0]);
    g.fill();
    blur(c, 4, 2);
    g.globalCompositeOperation = 'lighter';
    poly(g, [31, 512, 33, 512, 38, 0, 26, 0]);
    g.fill();
    blur(c, 2, 1);
    return c;
  })();
  const beams = V.beams || [
    { x: -260, a0: -0.22, amp: 0.14, w: 0.11, ph: 0.0, c: '#9fe6ef', alpha: 0.16 },
    { x: 120, a0: -0.08, amp: 0.12, w: 0.07, ph: 2.1, c: '#a6e9f2', alpha: 0.12 },
    { x: -760, a0: 0.34, amp: 0.16, w: 0.09, ph: 1.0, c: '#9fe6ef', alpha: 0.14 },
    { x: 860, a0: 0.36, amp: 0.12, w: 0.08, ph: 4.0, c: '#ff7ac2', alpha: 0.13 },
    { x: 1500, a0: -0.3, amp: 0.15, w: 0.1, ph: 3.0, c: '#9fe6ef', alpha: 0.14 },
  ];
  // Tinted beam textures (no runtime tint available without filters).
  for (const b of beams) {
    const { c, g } = mk(beamTex.width, beamTex.height);
    g.drawImage(beamTex, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = col(b.c);
    g.fillRect(0, 0, c.width, c.height);
    b.tex = c;
  }

  // --- far: megacity + the spire ------------------------------------------
  const far = B.part(0.08);
  { const ob = layerBounds(0.08, W, 'back'); far.ox0 = ob.x0; far.ox1 = ob.x1; }
  {
    const L = far, g = L.g, Y = L.Y;
    const city = sub(L);
    const cg = city.g;
    // two sub-rows: the back row hazier, the front row darker; varied crowns
    for (const [row, n, tone] of [[0, 150, 0.22], [1, 110, 0.45]]) {
      for (let i = 0; i < n; i++) {
        const x = lerp(L.ox0, L.ox1, R()), w = 16 + R() * (row ? 70 : 50);
        const r = R();
        const topS = r < 0.08 ? 210 + R() * 90 : r < 0.3 ? 300 + R() * 80 : 380 + R() * 110 + row * 30;
        const top = Y(topS);
        const c = mix(FOG, '#08121c', tone + R() * 0.15);
        cg.fillStyle = col(c);
        cg.fillRect(x, top, w, Y(800) - top);
        const kind = R();
        if (kind < 0.3) { // stepped crown
          cg.fillRect(x + w * 0.15, top - 14, w * 0.7, 14);
          cg.fillRect(x + w * 0.32, top - 26, w * 0.36, 12);
        } else if (kind < 0.5) { // slanted roof
          poly(cg, [x, top, x + w, top, x + w, top - w * 0.6], col(c));
        } else if (kind < 0.62) { // needle
          poly(cg, [x + w * 0.3, top, x + w * 0.7, top, x + w * 0.5, top - 40 - R() * 40], col(c));
        } else if (kind < 0.75) {
          cg.fillRect(x + w / 2 - 1, top - 34, 2, 34);
        }
        cg.fillStyle = col(R() < 0.15 ? '#ff6ab8' : R() < 0.55 ? '#bfe9f0' : '#5fc7d4', 0.22 + row * 0.12);
        for (let yy = top + 6; yy < Y(640); yy += 7) for (let xx = x + 3; xx < x + w - 3; xx += 5) if (R() < 0.1) cg.fillRect(xx, yy, 2.4, 1.5);
        if (R() < 0.12) rect(cg, x, top + 4, w, 1.5, R() < 0.5 ? MAG : TEAL, 0.5);
      }
      if (!row) { // haze between the two rows
        cg.save();
        cg.globalCompositeOperation = 'source-atop';
        cg.fillStyle = col(FOG, 0.35);
        cg.fillRect(L.x0, L.y0, L.x1 - L.x0, L.y1 - L.y0);
        cg.restore();
      }
    }
    stamp(L, city.c);
    // The spire: a stepped profile [screen y, half width], k scales the widths, kh the height above
    // the base row, dy shifts it down. A second, smaller one stands in the city for one set-piece.
    const spire = (cx, k, kh, dy, ring, glow) => {
      const SY = (v) => Y(900 - (900 - v) * kh + dy);
      const sp = sub(L), sg = sp.g;
      const prof = [[900, 132], [330, 122], [330, 104], [236, 98], [236, 80], [150, 74], [150, 62], [60, 54], [60, 44], [-60, 34], [-200, 24], [-700, 6]];
      const pts = [];
      for (const [sy, hw] of prof) pts.push(cx - hw * k, SY(sy));
      for (let i = prof.length - 1; i >= 0; i--) pts.push(cx + prof[i][1] * k, SY(prof[i][0]));
      sg.fillStyle = linGrad(sg, cx - 132 * k, 0, cx + 132 * k, 0, [[0, '#183846'], [0.1, '#0b1824'], [0.5, '#060d16'], [0.9, '#050911'], [1, '#2a1230']]);
      poly(sg, pts); sg.fill();
      // flanking buttress columns
      for (const side of [-1, 1]) {
        poly(sg, [cx + side * 132 * k, SY(900), cx + side * 168 * k, SY(900), cx + side * 150 * k, SY(260), cx + side * 128 * k, SY(200)], col('#08111a'));
        poly(sg, [cx + side * 100 * k, SY(330), cx + side * 116 * k, SY(330), cx + side * 80 * k, SY(40), cx + side * 72 * k, SY(60)], col('#07101a'));
      }
      sg.save();
      sg.globalCompositeOperation = 'source-atop';
      // vertical ribs, horizontal tiers and lit window bands
      for (let x = cx - 160 * k; x < cx + 160 * k; x += 9 * k) rect(sg, x, SY(-700), 1, SY(900) - SY(-700), '#000000', 0.3);
      for (let sy = 420; sy > -700; sy -= 18) {
        rect(sg, cx - 170 * k, SY(sy), 340 * k, 1.2, '#000000', 0.4);
        if (R() < 0.45) {
          sg.fillStyle = col(R() < 0.2 ? '#ff6ab8' : '#a8eef6', 0.22 + R() * 0.2);
          for (let x = cx - 130 * k; x < cx + 130 * k; x += 4.5) if (R() < 0.3) sg.fillRect(x, SY(sy) + 5, 2.6, 1.4);
        }
      }
      // a vertical gradient: upper spire catches the cloud glow
      sg.fillStyle = linGrad(sg, 0, SY(-200), 0, SY(300), [[0, '#2a5c6c', 0.18], [1, '#2a5c6c', 0]]);
      sg.fillRect(cx - 170 * k, SY(-700), 340 * k, SY(300) - SY(-700));
      sg.restore();
      // rim strokes
      const edge = (side, c, a, w) => {
        sg.beginPath();
        for (let i = 0; i < prof.length; i++) (i ? sg.lineTo : sg.moveTo).call(sg, cx + side * (prof[i][1] * k - 1.2), SY(prof[i][0]));
        sg.strokeStyle = linGrad(sg, 0, SY(-500), 0, SY(420), [[0, c, a * 0.4], [0.5, c, a], [1, c, a * 0.2]]);
        sg.lineWidth = w;
        sg.stroke();
      };
      edge(-1, '#6fd6e2', 0.6, 1.6);
      edge(1, MAG, 0.45, 1.4);
      lineV(sg, cx - 6 * k, SY(-700), SY(420), 1.6, '#9ae8f2', 0.65);
      lineV(sg, cx + 6 * k, SY(-700), SY(420), 1.0, '#9ae8f2', 0.3);
      // ring platform
      sg.save();
      sg.translate(cx, SY(150));
      sg.scale(1, 0.11);
      sg.beginPath(); sg.arc(0, 0, 175 * k, 0, TAU);
      sg.fillStyle = col('#04080e'); sg.fill();
      sg.beginPath(); sg.arc(0, 10, 172 * k, 0.04, Math.PI - 0.04);
      sg.strokeStyle = col(ring, 0.95); sg.lineWidth = 16 * k; sg.stroke();
      sg.restore();
      rect(sg, cx - 175 * k, SY(150) - 4, 350 * k, 3, '#0b1520');
      stamp(L, sp.c);
      soft(L, 3, 6, (gg) => {
        cone(gg, cx, SY(158), SY(460), 330 * k, 560 * k, ring, 0.14 * glow);
        blob(gg, cx, SY(158), 230 * k, 30 * k, ring, 0.55 * glow);
        lineV(gg, cx - 6 * k, SY(-700), SY(420), 12 * k, '#5fd2e0', 0.2 * glow);
      }, 'lighter');
      return SY;
    };
    if (V.piece === 'spire') { // a second spire further out in the city, fogged like the skyline
      spire(V.spire2.x, V.spire2.k, V.spire2.kh, 0, TEAL, 0.7);
      vfill(L, [[Y(-100), FOG, 0.08], [Y(300), FOG, 0.22]], 'source-atop');
    }
    // aura of haze behind the spire
    soft(L, 4, 8, (gg) => blob(gg, SPIRE_X, Y(120 + SPIRE_DY), 460, 560, '#2d6a78', 0.3), 'destination-over');

    // fog over the city before the spire goes in, so the spire stays the darkest, crispest shape
    vfill(L, [[Y(300), FOG, 0.2], [Y(430), FOG, 0.6], [Y(560), FOG, 0.92]], 'source-atop');
    spire(SPIRE_X, 1, 1, SPIRE_DY, MAG, 1);
    grain(L, 0.04);
    vfill(L, [[Y(330), FOG, 0], [Y(470), FOG, 0.55], [Y(580), FOG, 0.9]], 'source-atop');
  }

  // --- mid: megatowers, maglev ---------------------------------------------
  const mid = backLayer(0.22, 0.75 * q, W);
  {
    const L = mid, g = L.g, Y = L.Y;
    const towers = V.towers || [[-1250, 220, -100], [-900, 150, 110], [-600, 240, -170], [-300, 110, 210], [600, 150, 60], [930, 250, -170], [1260, 170, 120]];
    const tw = sub(L);
    const t = tw.g;
    for (const [x, w, topS] of towers) {
      const top = Y(topS);
      t.fillStyle = linGrad(t, x - w / 2, 0, x + w / 2, 0, [[0, '#14303c'], [0.06, '#0a1620'], [0.7, '#070f17'], [1, '#050a11']]);
      t.fillRect(x - w / 2, top, w, Y(900) - top);
      // crown setback
      rect(t, x - w / 2 + 14, top - 26, w - 28, 26, '#081119');
      rect(t, x - 2, top - 120, 4, 94, '#081119');
      t.save();
      t.globalCompositeOperation = 'source-atop';
      for (let xx = x - w / 2 + 8; xx < x + w / 2; xx += 12) rect(t, xx, top, 1.2, Y(900) - top, '#000000', 0.35);
      for (let yy = top; yy < Y(900); yy += 36) rect(t, x - w / 2, yy, w, 1.5, '#000000', 0.4);
      t.fillStyle = col('#9fe2ec', 0.16);
      for (let yy = top + 10; yy < Y(560); yy += 9) for (let xx = x - w / 2 + 6; xx < x + w / 2 - 6; xx += 7) if (R() < 0.08) t.fillRect(xx, yy, 3, 2);
      rect(t, x - w / 2, top, 2.5, Y(900) - top, TEAL, 0.35);
      t.restore();
    }
    stamp(L, tw.c);
    // glyph signage strips (accent)
    const signs = V.signs ? V.signs.map(([x, sy, c]) => [x, sy, c === 'MAG' ? MAG : TEAL])
      : [[-600 + 102, -60, MAG], [-300 - 40, 230, TEAL], [600 - 62, 90, TEAL], [930 - 108, -40, MAG], [-1250 + 96, 20, MAG]];
    const sgn = sub(L);
    for (const [x, sy, c] of signs) {
      rect(sgn.g, x - 9, Y(sy) - 6, 18, 200, '#05080d');
      sgn.g.strokeStyle = col(c, 0.85);
      sgn.g.lineWidth = 1.6;
      sgn.g.lineCap = 'square';
      for (let k = 0; k < 9; k++) glyph(sgn.g, x - 5, Y(sy) + k * 21, 4.5, R);
    }
    stamp(L, sgn.c);
    soft(L, 3, 4, (gg) => {
      for (const [x, sy, c] of signs) {
        blob(gg, x, Y(sy) + 100, 60, 150, c, 0.35);
      }
    }, 'lighter');
    // maglev line: long horizontal girder with running lights
    const ty = Y(V.maglev ?? 186);
    rect(g, L.x0, ty, L.x1 - L.x0, 7, '#08121b');
    rect(g, L.x0, ty + 7, L.x1 - L.x0, 3, '#050c13');
    g.fillStyle = col('#bff4fa', 0.5);
    for (let x = L.x0; x < L.x1; x += 34) g.fillRect(x, ty + 7.5, 2, 1.4);
    // faint baked rain sheets (in the backdrop, so the mid layer keeps its empty sky)
    const rainL = B.part(0.22);
    soft(rainL, 1, 1, (gg) => {
      gg.strokeStyle = col('#9fd4e0', 0.05);
      gg.lineWidth = 0.8;
      gg.beginPath();
      for (let i = 0; i < 1400; i++) {
        const x = lerp(rainL.x0, rainL.x1, R()), y = lerp(rainL.y0, rainL.y1, R()), l = 14 + R() * 26;
        gg.moveTo(x, y); gg.lineTo(x - l * (SLANT + 0.02), y + l);
      }
      gg.stroke();
    });
    grain(L, 0.06);
    vfill(L, [[Y(250), FOG, 0], [Y(420), FOG, 0.5], [Y(560), FOG, 0.85]], 'source-atop');
  }

  // --- near: a parallel cable-stayed causeway, pylons and cable fans ---------
  const near = backLayer(0.5, 0.9 * q, W);
  const PYL = V.pylons || [-340, 1260];
  {
    const L = near, Y = L.Y;
    const st = sub(L);
    const t = st.g;
    const deckY = Y(452);
    // cables first (behind pylons)
    for (const x of PYL) {
      for (let k = 0; k < 11; k++) {
        const ay = Y(-40 + k * 22);
        for (const side of [-1, 1]) {
          const ex = x + side * (90 + k * 66);
          t.strokeStyle = linGrad(t, 0, ay, 0, deckY, [[0, '#0a1620', 0.95], [1, '#0f2430', 0.6]]);
          t.lineWidth = 1.6;
          t.beginPath(); t.moveTo(x + side * 20, ay); t.lineTo(ex, deckY); t.stroke();
          t.strokeStyle = col(TEAL, 0.12);
          t.lineWidth = 0.7;
          t.beginPath(); t.moveTo(x + side * 20, ay + 1.2); t.lineTo(ex, deckY + 1.2); t.stroke();
        }
      }
    }
    for (const x of PYL) {
      t.fillStyle = linGrad(t, x - 44, 0, x + 44, 0, [[0, '#1e4250'], [0.1, '#0a141c'], [0.75, '#060c12'], [1, '#2a1230']]);
      poly(t, [x - 26, Y(-420), x + 26, Y(-420), x + 44, Y(900), x - 44, Y(900)]);
      t.fill();
      for (let sy = -400; sy < 600; sy += 120) rect(t, x - 46, Y(sy), 92, 6, '#03070b');
      lineV(t, x, Y(-420), Y(300), 1.5, MAG, 0.6);
    }
    // the far deck: a long horizontal with running lights
    rect(t, L.x0, deckY - 4, L.x1 - L.x0, 16, '#0b1720');
    rect(t, L.x0, deckY - 5, L.x1 - L.x0, 1.4, TEAL, 0.4);
    t.fillStyle = col('#c8f6ff', 0.8);
    for (let x = Math.ceil(L.x0 / 40) * 40; x < L.x1; x += 40) t.fillRect(x, deckY + 4, 2, 2);
    stamp(L, st.c);
    soft(L, 3, 4, (gg) => {
      for (const x of PYL) {
        blob(gg, x, Y(-60), 30, 260, MAG, 0.18);
      }
      rect(gg, L.x0, deckY - 2, L.x1 - L.x0, 6, TEAL, 0.25);
    }, 'lighter');
    grain(L, 0.04);
    vfill(L, [[Y(250), FOG, 0], [Y(400), FOG, 0.5], [Y(520), FOG, 0.88]], 'source-atop');
  }

  // --- haze band ----------------------------------------------------------
  const hazeStops = [[-420, 0], [-300, 0.04], [-180, 0.2], [-80, 0.42], [0, 0.55]].map(([y, a]) => [y, a * V.haze]);
  const hazeB = haze(B, q, '#3a6f7c', hazeStops, { n: 40, h: 260, c: '#5a98a4', a: 0.14 }, R);

  // --- floor (wet deck) ---------------------------------------------------
  const D = 1100;
  const floor = mkFloor(W, D, -28, 1.25 * q);
  const lampX = [], LAMP = V.lamp ?? 480;
  {
    const L = floor, g = L.g;
    vfill(L, [[-28, '#142a33', 0.97], [-1, '#0a171e', 0.92], [0, '#050b11', 0.3], [40, '#040a0f', 0.55], [140, '#03070b', 0.8], [400, '#020407', 0.93]]);
    // puddles: punch alpha so more reflection shows
    soft(L, 2, 2, (gg) => {
      for (let i = 0; i < 60; i++) {
        const x = lerp(L.ox0, L.ox1, R()), y = 6 + Math.pow(R(), 1.5) * 300;
        blob(gg, x, y, 60 + R() * 220, 3 + y * 0.05 + R() * 8, '#000000', 0.55);
      }
    }, 'destination-out');
    // seams
    const rows = [10, 26, 50, 84, 132, 200, 296, 420];
    for (const y of rows) {
      rect(g, L.x0, y, L.x1 - L.x0, 1 + y / 220, '#000000', 0.5);
      rect(g, L.x0, y + 1 + y / 220, L.x1 - L.x0, 0.8 + y / 400, '#5aa7b4', 0.07);
    }
    g.strokeStyle = col('#000000', 0.32);
    g.lineWidth = 1.4;
    g.beginPath();
    for (let x = Math.ceil(L.x0 / 170) * 170; x < L.x1; x += 170) {
      g.moveTo(x * (1 - 28 / D), -28);
      g.lineTo(x * (1 + 420 / D), 420);
    }
    g.stroke();
    // deck edge catch-light
    rect(g, L.x0, -28, L.x1 - L.x0, 1.6, '#7fd8e2', 0.45);
    rect(g, L.x0, -26.4, L.x1 - L.x0, 3, '#000000', 0.35);
    // wet sheen streaks
    soft(L, 1, 1, (gg) => {
      for (let i = 0; i < 500; i++) {
        const x = lerp(L.ox0, L.ox1, R()), y = R() * 360;
        rect(gg, x, y, 20 + R() * 120, 0.6 + y / 300, '#8fd0dc', 0.035);
      }
    });
    // light pools from the rail lamps, with long wet streak reflections
    for (let x = Math.ceil(L.x0 / LAMP) * LAMP + LAMP / 2; x < L.x1; x += LAMP) lampX.push(x);
    soft(L, 4, 2, (gg) => {
      for (const x of lampX) {
        const c = (Math.round(x / LAMP) & 1) ? MAG : TEAL;
        blob(gg, x, 4, 170, 26, c, 0.34);
        gg.fillStyle = linGrad(gg, 0, -6, 0, 240, [[0, c, 0.55], [0.4, c, 0.18], [1, c, 0]]);
        gg.beginPath();
        gg.moveTo(x - 5, -6); gg.lineTo(x + 5, -6);
        gg.lineTo(x * (1 + 240 / D) + 12, 240); gg.lineTo(x * (1 + 240 / D) - 12, 240);
        gg.fill();
      }
    }, 'lighter');
    grain(L, 0.08);
  }

  // --- rail on the deck's back edge ---------------------------------------
  const railRow = -28;
  const rail = mkLayer(1, 1.25 * q, (() => {
    const b = layerBounds(1, W, 'full', 1 + railRow / D);
    return { x0: b.x0, x1: b.x1, y0: railRow - 48, y1: railRow + 4 };
  })(), 1 + railRow / D);
  {
    const L = rail, g = L.g, top = railRow - 30;
    for (let x = Math.ceil(L.x0 / 120) * 120; x < L.x1; x += 120) {
      rect(g, x - 2, top, 4, railRow - top, '#04080c');
      rect(g, x - 2, top, 1, railRow - top, '#5fb8c4', 0.25);
    }
    rect(g, L.x0, top - 3, L.x1 - L.x0, 5, '#05090d');
    rect(g, L.x0, top - 3, L.x1 - L.x0, 1, '#9fe6ef', 0.45);
    rect(g, L.x0, top + 13, L.x1 - L.x0, 2, '#05090d');
    rect(g, L.x0, top + 2, L.x1 - L.x0, 1.4, TEAL, 0.5);
    soft(L, 2, 2, (gg) => {
      rect(gg, L.x0, top + 1, L.x1 - L.x0, 3, TEAL, 0.25);
      for (const x of lampX) {
        const c = (Math.round(x / LAMP) & 1) ? MAG : TEAL;
        blob(gg, x, top - 6, 26, 26, c, 0.85);
      }
    }, 'lighter');
    for (const x of lampX) {
      rect(g, x - 3, top - 10, 6, 7, '#04080c');
      rect(g, x - 2, top - 9, 4, 4, (Math.round(x / LAMP) & 1) ? '#ffc4e4' : '#d4fbff', 1);
    }
  }

  // --- reflections ---------------------------------------------------------
  const floorBase = col('#03070b');
  flatten(B, floorBase, [[0.55, 2, 4, 2], [0.55, 2, 6, 2], null, [0.6, 1, 2, 2]]);
  const mirrors = [
    [reflection(mid, 2, 6), 0.55],
    [reflection(near, 2, 6), 0.5],
    [reflection(rail, 2, 3, 2), 0.5, railRow],
  ];
  mid.rects = cull(mid);
  near.rects = cull(near);

  // --- animated lights -----------------------------------------------------
  const sprMag = glowSprite(MAG), sprTeal = glowSprite('#9ff0f8'), sprRed = glowSprite('#ff4a6a');
  // aircraft-warning lights on the antenna tips: the two tallest towers red, two more magenta
  const tips = V.towers ? [...V.towers].sort((a, b) => a[2] - b[2]) : [[-600, 0, -170], [930, 0, -170], [-300, 0, 210], [600, 0, 60]];
  const blinks = [
    { L: far, x: SPIRE_X - 172, y: far.Y(150 + SPIRE_DY), r: 16, spr: sprMag, per: 2.4, ph: 0 },
    { L: far, x: SPIRE_X + 172, y: far.Y(150 + SPIRE_DY), r: 16, spr: sprMag, per: 2.4, ph: 0.5 },
    { L: far, x: SPIRE_X - 40, y: far.Y(60 + SPIRE_DY), r: 12, spr: sprRed, per: 3.1, ph: 0.2 },
    { L: far, x: SPIRE_X + 40, y: far.Y(60 + SPIRE_DY), r: 12, spr: sprRed, per: 3.1, ph: 0.7 },
    { L: mid, x: tips[0][0], y: mid.Y(tips[0][2]) - 120, r: 14, spr: sprRed, per: 2.0, ph: 0.3 },
    { L: mid, x: tips[1][0], y: mid.Y(tips[1][2]) - 120, r: 14, spr: sprRed, per: 2.0, ph: 0.8 },
    { L: mid, x: tips[2][0], y: mid.Y(tips[2][2]) - 120, r: 11, spr: sprMag, per: 1.6, ph: 0.1 },
    { L: mid, x: tips[3][0], y: mid.Y(tips[3][2]) - 120, r: 11, spr: sprMag, per: 1.7, ph: 0.6 },
    { L: near, x: PYL[0], y: near.Y(-40), r: 16, spr: sprRed, per: 2.6, ph: 0.4 },
    { L: near, x: PYL[1], y: near.Y(-40), r: 16, spr: sprRed, per: 2.6, ph: 0.9 },
  ];
  function blinkFx(list) {
    return (ctx, cam, vw, vh, t) => {
      ctx.globalCompositeOperation = 'lighter';
      for (const b of list) {
        const ph = ((t / b.per + b.ph) % 1);
        const a = ph < 0.18 ? Math.sin(ph / 0.18 * Math.PI) : 0.08;
        layerToScreen(b.L, b.x, b.y, cam, vw, vh, TMP);
        const r = b.r * TMP.z;
        ctx.globalAlpha = a;
        ctx.drawImage(b.spr, TMP.x - r, TMP.y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };
  }
  const searchFx = (ctx, cam, vw, vh, t) => {
    ctx.globalCompositeOperation = 'lighter';
    for (const b of beams) {
      layerToScreen(sky, b.x, sky.Y(640), cam, vw, vh, TMP);
      const ang = b.a0 + b.amp * Math.sin(t * b.w * TAU * 0.25 + b.ph);
      const c = Math.cos(ang), s = Math.sin(ang);
      ctx.setTransform(MIR.a * c + MIR.c * s, MIR.b * c + MIR.d * s, -MIR.a * s + MIR.c * c, -MIR.b * s + MIR.d * c,
        MIR.a * TMP.x + MIR.c * TMP.y + MIR.e, MIR.b * TMP.x + MIR.d * TMP.y + MIR.f);
      ctx.globalAlpha = b.alpha;
      ctx.drawImage(b.tex, -40, -780, 80, 780);
    }
    ctx.setTransform(MIR.a, MIR.b, MIR.c, MIR.d, MIR.e, MIR.f);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  // rain: precomputed seeds, drawn as two batched strokes
  const rainFx = (n, seed, len, alpha, width, par) => (ctx, cam, vw, vh, t) => {
    ctx.strokeStyle = col('#a8d8e4', alpha);
    ctx.lineWidth = width;
    ctx.beginPath();
    const W2 = vw + 120, H2 = vh + 120, ox = -cam.x * cam.zoom * par;
    for (let i = 0; i < n; i++) {
      const h1 = hash(seed + i * 3), h2 = hash(seed + i * 3 + 1), h3 = hash(seed + i * 3 + 2);
      const sp = 900 + h3 * 500;
      let y = (h2 * H2 + t * sp) % H2 - 60;
      let x = ((h1 * W2 + ox - t * sp * SLANT) % W2 + W2) % W2 - 60;
      const l = len * (0.6 + h3 * 0.7);
      ctx.moveTo(x, y);
      ctx.lineTo(x - l * SLANT, y + l);
    }
    ctx.stroke();
  };
  const SPLASH = Math.round(14 * V.rain);
  const splashFx = (ctx, cam, vw, vh, t, sg) => {
    if (sg > vh) return;
    ctx.strokeStyle = col('#b8e4ee', 0.28);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < SPLASH; i++) {
      const per = 0.5 + hash(i * 7 + 3) * 0.6;
      const k = Math.floor(t / per + hash(i * 7 + 1));
      const ph = (t / per + hash(i * 7 + 1)) % 1;
      const x = hash(i * 131 + k * 17) * vw;
      const y = sg + (4 + hash(i * 37 + k * 11) * 160) * cam.zoom;
      if (y > vh) continue;
      const r = (3 + ph * 10) * cam.zoom * (0.6 + (y - sg) / 200);
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
    }
    ctx.stroke();
  };

  // --- foreground ------------------------------------------------------------
  const fgBot = fgStrip(W, 80, (g, x0, x1) => {
    for (let s0 = Math.ceil(x0 / 1600) * 1600 - 500; s0 < x1; s0 += 1600) {
      const s1 = s0 + 760;
      rect(g, s0, 26, s1 - s0, 9, '#020407');
      rect(g, s0, 25, s1 - s0, 2, '#7fd0dc', 0.35);
      for (let x = s0; x <= s1; x += 380) rect(g, x - 7, 26, 14, 80, '#020407');
      rect(g, s0, 56, s1 - s0, 6, '#020407');
    }
  });
  const fgTop = null;

  const A = {
    backdrop: B,
    back: [
      { fx: searchFx }, { L: mid }, { fx: blinkFx(blinks.slice(0, 7)) }, { L: near },
      { fx: blinkFx(blinks.slice(7)) }, { fx: rainFx(Math.round(56 * V.rain), 11, 30, 0.12, 1, 0.5) }, { bands: hazeB },
    ],
    floorBase,
    mirrors,
    hazeRefl: bands('#3a6f7c', hazeStops.map(([y, a]) => [-y, a * 0.6]).reverse()),
    floor,
    onFloor: [{ L: rail }, { fx: splashFx }],
    front: [rainFx(Math.round(30 * V.rain), 977, 46, 0.2, 1.3, 1.25)],
    fogFront: fogBands('#4d8c98', [[0, 0], [0.55, 0.9], [0.75, 1], [1, 0]], 220, 90, 0.1),
    fgTop, fgBot,
    vignette: vignette(0.7, '#01030a'),
  };
  return { id: 'causeway', name: 'SPIRE CAUSEWAY', width: W, palette: palette(pal), reflect: 0.55, ...compose(A) };
}

// ======================================================================
// FOUNDRY NINE
// ======================================================================

function buildFoundry(q, V) {
  const R = rng(0xf0f9 ^ V.scatter);
  const FURN = V.furnaces || [[-760, 200, 70], [160, 160, 130], [900, 220, 40]];
  const POUR = V.pour ?? -40, IDLE = V.idle ?? 720, LAMP = V.lamp ?? 520, VENT = V.vent ?? 660, SHAFT = V.shaft ?? 0;
  const W = 2200;
  const FOG = '#5a3420';
  const pal = { key: '#ff8a32', accent: '#6fb2cc', fog: FOG, floor: '#0c0907', ambient: '#d6a882' };
  const AMB = '#ff8a32', HOT = '#ffc46a', COOL = '#6fa8c0';

  // Back wall, skylight shafts, blast furnaces and haze wisps share one backdrop.
  const B = backdrop(0.1, 0.6 * q, W);

  // --- back wall -----------------------------------------------------------
  const back = B.part(0.03, 0.5 * q);
  {
    const L = back, g = L.g, Y = L.Y;
    vfill(L, [[Y(-60), '#040405'], [Y(80), '#08080a'], [Y(220), '#160f0b'], [Y(360), '#352012'], [Y(470), '#562f18'], [Y(560), '#6c3a1b'], [Y(720), '#6c3a1b']]);
    // buttresses
    for (let x = Math.ceil(L.x0 / 230) * 230; x < L.x1; x += 230) {
      g.fillStyle = linGrad(g, 0, Y(-80), 0, Y(520), [[0, '#050506', 0.9], [0.6, '#1c120c', 0.6], [1, '#3a2213', 0]]);
      g.fillRect(x - 22, Y(-80), 44, Y(560) - Y(-80));
    }
    // clerestory windows (cool accent)
    const win = sub(L);
    for (let x = Math.ceil(L.x0 / 460) * 460 + 115; x < L.x1; x += 460) {
      const wg = win.g;
      wg.fillStyle = linGrad(wg, 0, Y(-40), 0, Y(110), [[0, '#24323e'], [1, '#141b22']]);
      wg.fillRect(x - 36, Y(-40), 72, 150);
      for (let k = -24; k <= 24; k += 24) rect(wg, x + k - 1.5, Y(-40), 3, 150, '#07080a');
      for (let yy = -40; yy < 110; yy += 30) rect(wg, x - 36, Y(yy), 72, 3, '#07080a');
    }
    stamp(L, win.c);
    // molten glow from the pit beyond
    soft(L, 4, 8, (gg) => {
      // variants spread the glows one per tenth of the width, so two never pile into one hot spot
      for (let i = 0; i < 10; i++) blob(gg, lerp(L.ox0, L.ox1, V.seed ? (i + R()) / 10 : R()), Y(640), 300 + R() * 300, 220 + R() * 80, '#b0480e', 0.28);
    }, 'lighter');
    // smoke banks lit from below
    soft(L, 3, 6, (gg) => {
      for (let i = 0; i < 70; i++) {
        const x = lerp(L.ox0, L.ox1, R()), y = Y(120 + R() * 260);
        blob(gg, x, y, 80 + R() * 220, 20 + R() * 40, '#050405', 0.35);
        blob(gg, x, y + 20, 70 + R() * 160, 10 + R() * 20, '#7a3a14', 0.12);
      }
    });
    grain(L, 0.07, false);
  }

  // cool skylight shafts from the clerestory, drawn additively over the whole interior
  const shaftL = B.part(0.03, 0.25 * q, 'lighter', 0.5, 10);
  {
    const L = shaftL, Y = L.Y;
    soft(L, 1, 4, (gg) => {
      for (let x = Math.ceil(L.x0 / 460) * 460 + 115; x < L.x1; x += 460) {
        gg.fillStyle = linGrad(gg, 0, Y(100), 0, Y(470), [[0, COOL, 0], [0.12, COOL, 0.5], [0.5, COOL, 0.16], [1, COOL, 0]]);
        poly(gg, [x - 34, Y(100), x + 34, Y(100), x + 200 + SHAFT, Y(470), x + 60 + SHAFT, Y(470)]);
        gg.fill();
      }
    });
  }

  // --- far: blast furnaces ---------------------------------------------------
  const far = B.part(0.12, 0.6 * q, 'source-over', 1, 2);
  {
    const L = far, Y = L.Y;
    const s = sub(L), g = s.g;
    const furn = (x, w, top) => {
      g.fillStyle = col('#140d09');
      g.fillRect(x - w / 2, Y(top), w, Y(900) - Y(top));
      poly(g, [x - w / 2 - 10, Y(top), x + w / 2 + 10, Y(top), x + w * 0.22, Y(top - 70), x - w * 0.22, Y(top - 70)], col('#140d09'));
      g.fillRect(x - w * 0.14, Y(-400), w * 0.28, Y(top - 60) - Y(-400));
      for (let k = 0; k < 5; k++) rect(g, x - w / 2 - 6, Y(top + 40 + k * 70), w + 12, 8, '#0c0806');
      // downcomer pipes
      g.strokeStyle = col('#120b08');
      g.lineWidth = 18;
      g.beginPath(); g.moveTo(x + w * 0.14, Y(top - 40)); g.lineTo(x + w * 0.9, Y(top - 10)); g.lineTo(x + w * 0.9, Y(700)); g.stroke();
      g.lineWidth = 12;
      g.beginPath(); g.moveTo(x - w * 0.14, Y(top - 30)); g.lineTo(x - w * 0.75, Y(top + 30)); g.lineTo(x - w * 0.75, Y(700)); g.stroke();
    };
    for (const [x, w, top] of FURN) furn(x, w, top);
    // stacks & a long pipe rack
    for (const x of V.stacks || [-1200, -420, 520, 1300]) rect(g, x - 18, Y(-400), 36, Y(900) - Y(-400), '#110b08');
    const rack = V.rack ?? 150;
    rect(g, L.x0, Y(rack), L.x1 - L.x0, 14, '#120c08');
    rect(g, L.x0, Y(rack + 22), L.x1 - L.x0, 8, '#120c08');
    // underlight from the pit
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = linGrad(g, 0, Y(0), 0, Y(560), [[0, AMB, 0], [0.6, AMB, 0.12], [1, AMB, 0.3]]);
    g.fillRect(L.x0, L.y0, L.x1 - L.x0, L.y1 - L.y0);
    g.restore();
    stamp(L, s.c);
    // tap holes glowing at the furnace bases
    soft(L, 2, 4, (gg) => {
      const tap = Math.min(1, 3 / FURN.length); // keep the total pit glow of the base's three furnaces
      for (const [x] of FURN) {
        blob(gg, x, Y(350), 60, 40, HOT, 0.55 * tap);
        blob(gg, x, Y(360), 220, 90, AMB, 0.25 * tap);
      }
    }, 'lighter');
    grain(L, 0.04);
    vfill(L, [[Y(240), FOG, 0], [Y(420), FOG, 0.55], [Y(560), FOG, 0.9]], 'source-atop');
    // tuyere rings: rows of glowing ports around each furnace, above the play band
    soft(L, 1, 1, (gg) => {
      for (const [x, w, top] of FURN) {
        const y = Y(top + 50);
        rect(gg, x - w / 2 - 6, y - 3, w + 12, 10, '#0c0806');
        for (let k = 0; k < 9; k++) rect(gg, x - w / 2 + (k + 0.5) * (w / 9) - 3, y, 6, 4, k % 3 ? '#ff8a2a' : '#ffc070', 0.95);
      }
    });
    soft(L, 3, 4, (gg) => {
      for (const [x, w, top] of FURN) {
        blob(gg, x, Y(top + 52), w * 0.8, 18, AMB, 0.55);
        blob(gg, x, Y(top + 40), w * 0.9, 120, '#7a3a14', 0.2);
      }
    }, 'lighter');
    if (V.piece === 'mouth') { // one furnace stands open: an arched, barred mouth glowing through the fog
      const [x, w, top] = FURN[V.mouth], mw = w * 0.46, m0 = Y(top + 95), m1 = Y(top + 180), ar = mw / 2;
      const arch = (g2, e) => {
        g2.beginPath();
        g2.moveTo(x - ar - e, m1 + e); g2.lineTo(x - ar - e, m0 + ar);
        g2.arc(x, m0 + ar, ar + e, Math.PI, 0); g2.lineTo(x + ar + e, m1 + e); g2.closePath();
      };
      soft(L, 1, 2, (gg) => {
        arch(gg, 10); gg.fillStyle = col('#0c0806'); gg.fill();
        arch(gg, 0);
        gg.fillStyle = linGrad(gg, 0, m0, 0, m1, [[0, '#6a1c06'], [0.45, '#e0601a'], [0.85, '#ffb04a'], [1, '#ffd890']]);
        gg.fill();
        for (let k = -2; k <= 2; k++) rect(gg, x + k * ar * 0.42 - 2.5, m0, 5, m1 - m0, '#0c0806');
        rect(gg, x - ar - 14, m1, mw + 28, 10, '#0c0806');
      });
      soft(L, 3, 6, (gg) => {
        blob(gg, x, m1 - (m1 - m0) * 0.3, mw * 1.4, (m1 - m0) * 1.1, AMB, 0.4);
        blob(gg, x, m1 + 24, w * 1.4, 60, '#b0480e', 0.3);
      }, 'lighter');
    }
  }

  // --- mid: gantry crane, crucibles, pour -----------------------------------
  const mid = backLayer(0.3, 0.75 * q, W);
  {
    const L = mid, Y = L.Y;
    const s = sub(L), g = s.g;
    // gantry truss
    const t0 = Y(30), t1 = Y(92);
    rect(g, L.x0, t0, L.x1 - L.x0, 9, '#0d0907');
    rect(g, L.x0, t1 - 9, L.x1 - L.x0, 9, '#0d0907');
    g.strokeStyle = col('#0d0907');
    g.lineWidth = 4;
    g.beginPath();
    for (let x = Math.floor(L.x0 / 62) * 62; x < L.x1; x += 62) { g.moveTo(x, t0); g.lineTo(x + 31, t1); g.lineTo(x + 62, t0); }
    g.stroke();
    rect(g, L.x0, t1 - 1, L.x1 - L.x0, 1.5, AMB, 0.3);
    // gantry legs
    for (const x of [-1500, 1500]) rect(g, x - 26, t0, 52, Y(900) - t0, '#0d0907');
    // chains helper
    const chain = (x, y0, y1, w = 3) => {
      g.fillStyle = col('#0b0806');
      for (let y = y0; y < y1; y += 7) { g.fillRect(x - w / 2, y, w, 5); g.fillRect(x - 0.6, y + 4, 1.2, 4); }
    };
    // hanging chains & hooks
    const hooks = [...(V.chains || [[-1080, 220], [-760, 150], [160, 260], [1180, 200], [-1420, 120], [1420, 170]])];
    if (V.piece === 'hooks') { // a row of empty hooks along the gantry, clear of the crucibles
      for (let x = Math.ceil(L.x0 / 130) * 130 + 40; x < L.x1; x += 130) {
        if (Math.abs(x - POUR) > 180 && Math.abs(x - IDLE) > 140) hooks.push([x + spreadR(R, 20), 70 + R() * 110]);
      }
    }
    for (const [x, len] of hooks) {
      chain(x, t1, Y(92 + len));
      g.strokeStyle = col('#0b0806'); g.lineWidth = 5;
      g.beginPath(); g.arc(x + 7, Y(92 + len) + 10, 9, Math.PI, Math.PI * 2.6); g.stroke();
    }
    // raised casting platform with a mold trough
    const py = Y(228);
    rect(g, L.x0, py, L.x1 - L.x0, 14, '#0d0907');
    rect(g, L.x0, py + 14, L.x1 - L.x0, 3, '#060403');
    for (let x = Math.ceil(L.x0 / 600) * 600 + 300; x < L.x1; x += 600) rect(g, x - 10, py + 14, 20, Y(900) - py, '#0d0907');
    const dx = POUR + 40; // trough and molds sit to either side of the pour
    rect(g, -300 + dx, py - 12, 330, 12, '#120b07');
    for (let x = 60; x < 700; x += 70) rect(g, x + dx, py - 10, 50, 10, '#120b07');
    stamp(L, s.c);

    // the pouring crucible: own canvas so its rim light stays on it. k scales it; the main pour
    // also lights the trough and the molds.
    const pour = (cx, k, main) => {
      const cy = Y(110 + (1 - k) * 40), ang = -0.3;
      const cr = sub(L), c = cr.g;
      rect(c, cx - 56 * k, t1, 112 * k, 22, '#0d0907');
      c.fillStyle = col('#0b0806');
      for (const dx of [-44 * k, 44 * k]) for (let y = t1 + 20; y < cy - 60 * k; y += 7) { c.fillRect(cx + dx - 1.5, y, 3, 5); }
      c.save();
      c.translate(cx, cy);
      c.rotate(ang);
      c.scale(k, k);
      c.fillStyle = linGrad(c, -100, 0, 100, 0, [[0, '#24150c'], [0.35, '#100a07'], [1, '#1a0f09']]);
      c.beginPath();
      c.moveTo(-100, -64); c.lineTo(100, -64); c.lineTo(84, 30);
      c.quadraticCurveTo(70, 76, 0, 78); c.quadraticCurveTo(-70, 76, -84, 30);
      c.closePath();
      c.fill();
      rect(c, -108, -74, 216, 14, '#150d08');
      for (const x of [-60, 0, 60]) rect(c, x - 3, -60, 6, 128, '#0a0605', 0.8);
      // trunnion pins
      c.beginPath(); c.arc(-96, -10, 9, 0, TAU); c.arc(96, -10, 9, 0, TAU); c.fillStyle = col('#0a0605'); c.fill();
      c.restore();
      c.save();
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = linGrad(c, cx - 140 * k, cy + 110 * k, cx + 30 * k, cy - 10 * k, [[0, AMB, 0.6], [0.35, AMB, 0.15], [1, AMB, 0]]);
      c.fillRect(cx - 200, cy - 200, 400, 400);
      c.restore();
      stamp(L, cr.c);
      // molten surface and pour
      const rot = (x, y) => ({ x: cx + k * (x * Math.cos(ang) - y * Math.sin(ang)), y: cy + k * (x * Math.sin(ang) + y * Math.cos(ang)) });
      const lip = rot(-104, -70);
      const hot = sub(L), hg = hot.g;
      hg.save();
      hg.translate(cx, cy); hg.rotate(ang); hg.scale(k, k);
      hg.beginPath(); hg.ellipse(-4, -72, 98, 5, 0, 0, TAU);
      hg.fillStyle = linGrad(hg, -100, 0, 100, 0, [[0, '#ffe4a8'], [0.6, '#ff9a34'], [1, '#c24a10']]);
      hg.fill();
      hg.restore();
      const sx0 = lip.x, sy0 = lip.y, sy1 = py - 10;
      hg.fillStyle = linGrad(hg, 0, sy0, 0, sy1, [[0, '#fff0c8'], [0.4, '#ffc060'], [1, '#ff8a2a']]);
      hg.beginPath();
      hg.moveTo(sx0 - 2 * k, sy0);
      hg.quadraticCurveTo(sx0 - 16 * k, sy0 + 8, sx0 - 19 * k, sy1);
      hg.lineTo(sx0 - 13 * k, sy1);
      hg.quadraticCurveTo(sx0 - 10 * k, sy0 + 10, sx0 + 5 * k, sy0);
      hg.fill();
      const dx = cx + 40;
      if (main) {
        rect(hg, -296 + dx, py - 10, 322, 5, '#ff8a2a', 0.95);
        rect(hg, -296 + dx, py - 10, 322, 1.6, '#ffdc98', 0.95);
        for (let x = 60, j = 0; x < 700; x += 70, j++) rect(hg, x + 4 + dx, py - 8, 42, 3, j < 3 ? '#ff7a1c' : '#7a2a08', j < 3 ? 0.9 - j * 0.2 : 0.6);
      } else {
        rect(hg, sx0 - 60, py - 6, 90, 3, '#ff8a2a', 0.85);
      }
      stamp(L, hot.c);
      // Glow strength: the base pour sits where the extreme cameras only half see it; a variant's pour
      // can sit right in the readability band at those cameras, so it glows a little less.
      const ga = !main ? 0.45 : V.seed ? 0.75 : 1;
      soft(L, 3, 6, (gg) => {
        blob(gg, sx0 - 16 * k, (sy0 + sy1) / 2, 60 * k, (sy1 - sy0) * 0.7, AMB, 0.5 * ga);
        blob(gg, sx0 - 16 * k, sy1, 120 * k, 34, HOT, 0.55 * ga);
        if (main) {
          blob(gg, -140 + dx, py - 8, 280, 50, AMB, 0.5 * ga);
          blob(gg, 160 + dx, py - 8, 160, 26, AMB, 0.3 * ga);
        }
        blob(gg, cx - 10 * k, cy - 50 * k, 130 * k, 30 * k, HOT, 0.35 * ga);
        for (let i = 0; i < 16 * k; i++) blob(gg, -380 + dx + R() * 520, py - 30 - R() * 150, 40 + R() * 80, 20 + R() * 40, '#b0683c', 0.12 * ga);
      }, 'lighter');
    };
    pour(POUR, 1, true);
    if (V.piece === 'pour') pour(V.pour2, 0.7, false);
    // idle crucible, higher, faint residual glow
    const ix = IDLE, iy = Y(118);
    const ic = sub(L), ig = ic.g;
    rect(ig, ix - 46, t1, 92, 20, '#0d0907');
    ig.fillStyle = col('#0b0806');
    for (const dx of [-36, 36]) for (let y = t1 + 18; y < iy - 46; y += 7) ig.fillRect(ix + dx - 1.5, y, 3, 5);
    ig.fillStyle = linGrad(ig, ix - 80, 0, ix + 80, 0, [[0, '#1a110b'], [0.5, '#0d0907'], [1, '#1f120a']]);
    poly(ig, [ix - 82, iy - 44, ix + 82, iy - 44, ix + 62, iy + 64, ix - 62, iy + 64]);
    ig.fill();
    rect(ig, ix - 88, iy - 52, 176, 12, '#130b08');
    ig.save();
    ig.globalCompositeOperation = 'source-atop';
    ig.fillStyle = linGrad(ig, 0, iy + 64, 0, iy + 20, [[0, AMB, 0.3], [1, AMB, 0]]);
    ig.fillRect(ix - 100, iy - 60, 200, 130);
    ig.restore();
    stamp(L, ic.c);
    soft(L, 2, 4, (gg) => blob(gg, ix, iy - 52, 80, 10, AMB, 0.4), 'lighter');
    grain(L, 0.06);
    vfill(L, [[Y(250), FOG, 0], [Y(400), FOG, 0.55], [Y(540), FOG, 0.9]], 'source-atop');
  }

  // --- near: columns, catwalk, roof trusses ----------------------------------
  const near = backLayer(0.6, 0.9 * q, W);
  const lamps = [];
  {
    const L = near, Y = L.Y;
    const s = sub(L), g = s.g;
    const cols = V.columns || [-1560, -960, -400, 440, 1000, 1600];
    for (const x of cols) {
      g.fillStyle = linGrad(g, x - 48, 0, x + 48, 0, [[0, '#2a170c'], [0.1, '#0c0806'], [0.5, '#060504'], [1, '#100907']]);
      g.fillRect(x - 46, Y(-300), 92, Y(900) - Y(-300));
      rect(g, x - 46, Y(-300), 14, Y(900) - Y(-300), '#000000', 0.35);
      rect(g, x + 32, Y(-300), 14, Y(900) - Y(-300), '#000000', 0.35);
      g.fillStyle = col('#2a1810', 0.8);
      for (let y = Y(-300); y < Y(900); y += 16) { g.fillRect(x - 41, y, 3, 3); g.fillRect(x + 38, y, 3, 3); }
      rect(g, x - 46, Y(-300), 1.5, Y(900) - Y(-300), AMB, 0.3);
    }
    // X-bracing between column pairs, high up
    g.strokeStyle = col('#0a0705');
    g.lineWidth = 7;
    g.beginPath();
    for (const i of [0, cols.length - 2]) {
      const a = cols[i] + 46, b = cols[i + 1] - 46;
      g.moveTo(a, Y(30)); g.lineTo(b, Y(170)); g.moveTo(b, Y(30)); g.lineTo(a, Y(170));
    }
    g.stroke();
    // roof truss
    rect(g, L.x0, Y(-300), L.x1 - L.x0, Y(-50) - Y(-300), '#050403');
    rect(g, L.x0, Y(-50), L.x1 - L.x0, 4, '#1a0f09');
    // catwalk
    const cw = Y(14);
    rect(g, L.x0, cw, L.x1 - L.x0, 12, '#080605');
    rect(g, L.x0, cw - 34, L.x1 - L.x0, 3, '#080605');
    rect(g, L.x0, cw - 17, L.x1 - L.x0, 2, '#080605');
    for (let x = Math.ceil(L.x0 / 70) * 70; x < L.x1; x += 70) rect(g, x - 1.5, cw - 34, 3, 34, '#080605');
    rect(g, L.x0, cw + 12, L.x1 - L.x0, 1.5, AMB, 0.45);
    for (let x = Math.ceil(L.x0 / LAMP) * LAMP + LAMP / 4; x < L.x1; x += LAMP) {
      rect(g, x - 9, cw + 12, 18, 7, '#0a0705');
      rect(g, x - 6, cw + 18, 12, 2.5, '#ffd9a0', 1);
      lamps.push(x);
    }
    // underlight
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = linGrad(g, 0, Y(0), 0, Y(520), [[0, AMB, 0], [0.5, AMB, 0.08], [1, AMB, 0.3]]);
    g.fillRect(L.x0, L.y0, L.x1 - L.x0, L.y1 - L.y0);
    g.restore();
    stamp(L, s.c);
    soft(L, 3, 4, (gg) => {
      for (const x of lamps) {
        cone(gg, x, cw + 20, Y(560), 20, 320, '#ffb060', 0.2);
        blob(gg, x, cw + 20, 34, 12, '#ffd9a0', 0.8);
      }
    }, 'lighter');
    grain(L, 0.06);
    vfill(L, [[Y(230), FOG, 0], [Y(370), FOG, 0.6], [Y(510), FOG, 0.96]], 'source-atop');
  }

  const hazeStops = [[-420, 0], [-300, 0.03], [-190, 0.18], [-90, 0.42], [0, 0.58]].map(([y, a]) => [y, a * V.haze]);
  const hazeB = haze(B, q, '#744424', hazeStops, { n: 34, h: 240, c: '#9a5a2e', a: 0.12 }, R);

  // --- floor: steel plates with warm under-glow seams ------------------------
  const D = 1000;
  const floor = mkFloor(W, D, -56, 1.25 * q);
  {
    const L = floor, g = L.g;
    vfill(L, [[-56, '#4a2a18', 0], [-36, '#2c1a10', 0.85], [-1, '#1a110b', 0.94], [0, '#0d0907', 0.6], [60, '#0c0806', 0.75], [180, '#090605', 0.88], [400, '#060404', 0.95]]);
    // plate texture: scuffs
    soft(L, 1, 1, (gg) => {
      for (let i = 0; i < 900; i++) {
        const x = lerp(L.ox0, L.ox1, R()), y = -40 + R() * 440;
        rect(gg, x, y, 6 + R() * 50, 0.6 + y / 400, R() < 0.5 ? '#000000' : '#a07050', 0.06);
      }
    });
    // Floor glows are painted at quarter resolution with half the blur: the same softness for a
    // quarter of the bake work on this, the largest canvas.
    soft(L, 4, 2, (gg) => {
      for (let i = 0; i < 30; i++) blob(gg, lerp(L.ox0, L.ox1, R()), R() * 300, 60 + R() * 140, 6 + R() * 18, '#000000', 0.35);
    });
    // seams (grating gaps) glowing from below
    const rows = [-30, -12, 8, 34, 72, 128, 210, 330];
    const gl = sub(L, 4), gg = gl.g;
    for (const y of rows) {
      rect(g, L.x0, y, L.x1 - L.x0, 1.2 + Math.max(0, y) / 160, '#000000', 0.7);
      rect(gg, L.x0, y, L.x1 - L.x0, 1.2 + Math.max(0, y) / 160, '#ff7a24', 0.35);
    }
    g.strokeStyle = col('#000000', 0.6);
    g.lineWidth = 1.5;
    g.beginPath();
    gg.strokeStyle = col('#ff8a30', 0.3);
    gg.lineWidth = 1.5;
    gg.beginPath();
    for (let x = Math.ceil(L.x0 / 220) * 220; x < L.x1; x += 220) {
      g.moveTo(x * (1 - 56 / D), -56); g.lineTo(x * (1 + 420 / D), 420);
      gg.moveTo(x * (1 - 56 / D), -56); gg.lineTo(x * (1 + 420 / D), 420);
    }
    g.stroke();
    gg.stroke();
    blur(gl.c, 2);
    stamp(L, gl.c, 'lighter');
    // hot grate slots: a few brighter vents
    soft(L, 4, 2, (g2) => {
      for (let x = Math.ceil(L.x0 / VENT) * VENT + VENT / 6; x < L.x1; x += VENT) {
        blob(g2, x, 52, 120, 20, '#ff7a24', 0.55);
        rect(g2, x - 60, 50, 120, 3, '#ffc070', 0.9);
      }
      // pools under the catwalk lamps (approximate positions)
      for (let x = Math.ceil(L.x0 / LAMP) * LAMP + LAMP / 4; x < L.x1; x += LAMP) blob(g2, x, -8, 200, 30, '#ff9a48', 0.3);
    }, 'lighter');
    grain(L, 0.08);
  }

  const floorBase = col('#070504');
  // parts in z order: back wall, far furnaces, haze wisps, skylight shafts
  flatten(B, floorBase, [[0.35, 4, 4, 2], [0.35, 4, 6, 2], [0.4, 2, 2, 2], null]);
  const mirrors = [
    [reflection(mid, 4, 6), 0.35],
    [reflection(near, 4, 6), 0.32],
  ];
  mid.rects = cull(mid);
  near.rects = cull(near);

  // heat pulse: ground-anchored warm glow
  const heatB = fogBands('#ff7a24', [[0, 0], [0.6, 0.6], [0.85, 1], [1, 0.4]], 360, 40, 1);
  const HEAT = V.heat ?? 1;
  const heatA = (t) => HEAT * (0.07 + 0.035 * Math.sin(t * 1.1) + 0.02 * Math.sin(t * 2.9 + 1));
  const emberFx = (n, seed, size, alpha) => (ctx, cam, vw, vh, t) => {
    ctx.globalCompositeOperation = 'lighter';
    const ox = -cam.x * cam.zoom * 0.7;
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass ? col('#ffd080', alpha) : col('#ff7a24', alpha * 0.8);
      ctx.beginPath();
      for (let i = pass; i < n; i += 2) {
        const h1 = hash(seed + i * 5), h2 = hash(seed + i * 5 + 1), h3 = hash(seed + i * 5 + 2);
        const sp = 30 + h3 * 70, H = vh + 80, Wd = vw + 80;
        const y = H - ((h2 * H + t * sp) % H) - 40;
        const x = ((h1 * Wd + ox + Math.sin(t * (0.6 + h3) + i) * 20) % Wd + Wd) % Wd - 40;
        const r = size * (0.5 + h3);
        ctx.rect(x, y, r, r * (1.5 + h2));
      }
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  const fgTop = fgStrip(W, 110, (g, x0, x1) => {
    g.fillStyle = col('#030202');
    const every = V.piece === 'hooks' ? 450 : 900;
    for (let x = Math.ceil(x0 / every) * every; x < x1; x += every) {
      for (const [dx, len] of [[0, 92], [60, 54], [-80, 70]]) {
        for (let y = -10; y < len; y += 12) { g.fillRect(x + dx - 3, y, 6, 9); g.fillRect(x + dx - 1, y + 8, 2, 6); }
      }
      g.strokeStyle = col('#030202'); g.lineWidth = 6;
      g.beginPath(); g.arc(x + 9, 98, 11, Math.PI, Math.PI * 2.6); g.stroke();
    }
    rect(g, x0, 0, x1 - x0, 12, '#030202');
  });
  const fgBot = fgStrip(W, 80, (g, x0, x1) => {
    for (let x = Math.ceil(x0 / 1400) * 1400 + 200; x < x1; x += 1400) {
      // a low ingot stack and a bollard
      for (let k = 0; k < 7; k++) poly(g, [x - 150 + k * 44, 86, x - 146 + k * 44, 56, x - 114 + k * 44, 56, x - 110 + k * 44, 86], col('#030202'));
      for (let k = 0; k < 5; k++) {
        poly(g, [x - 104 + k * 44, 58, x - 100 + k * 44, 36, x - 70 + k * 44, 36, x - 66 + k * 44, 58], col('#030202'));
        rect(g, x - 100 + k * 44, 35, 30, 1.5, '#ff8a30', 0.35);
      }
      rect(g, x + 330, 20, 30, 70, '#030202');
      rect(g, x + 326, 18, 38, 6, '#030202');
      rect(g, x + 326, 17, 38, 1.5, '#ff8a30', 0.3);
    }
  });

  const A = {
    backdrop: B,
    back: [{ L: mid }, { L: near }, { bands: hazeB }, { bands: heatB, op: 'lighter', a: heatA }],
    floorBase,
    mirrors,
    hazeRefl: bands('#744424', hazeStops.map(([y, a]) => [-y, a * 0.4]).reverse()),
    floor,
    onFloor: [{ fx: emberFx(Math.round(60 * V.embers), 21, 2.4, 0.55) }],
    front: [emberFx(Math.round(16 * V.embers), 911, 3.4, 0.7)],
    fogFront: fogBands('#a05a2c', [[0, 0], [0.55, 0.8], [0.75, 1], [1, 0]], 200, 80, 0.1),
    fgTop, fgBot,
    vignette: vignette(0.72, '#050201'),
  };
  return { id: 'foundry', name: 'FOUNDRY NINE', width: W, palette: palette(pal), reflect: 0.3, ...compose(A) };
}

// ======================================================================
// EXAMINATION HALL
// ======================================================================

function buildHall(q, V) {
  const R = rng(0x4a11 ^ V.scatter);
  const W = 1900;
  const FOG = '#3a2f56';
  const pal = { key: '#e6eeff', accent: '#e8c77e', fog: FOG, floor: '#07060b', ambient: '#b4a8d8' };
  const ICE = '#dfe8ff', GOLD = '#e8c77e';

  // Back wall with the oculus, the far pillar row and the haze wisps share one backdrop.
  const B = backdrop(0.08, 0.75 * q, W);

  // --- back wall + oculus -------------------------------------------------------
  const back = B.part(0.03);
  const OC = V.oculus || { x: 0, sy: 64, r: 250 };
  const OK = OC.r / 250; // the oculus is painted at radius 250 and scaled
  {
    const L = back, g = L.g, Y = L.Y;
    const oy = Y(OC.sy);
    // place a context at the oculus: x offset and scale about its centre
    const at = (c) => { c.translate(OC.x, oy); c.scale(OK, OK); c.translate(0, -oy); };
    vfill(L, [[Y(-60), '#020105'], [Y(140), '#07050f'], [Y(320), '#130f24'], [Y(460), '#221b38'], [Y(580), '#2d2548'], [Y(720), '#2c2446']]);
    // wall relief: tall recessed panels
    for (let x = Math.ceil(L.x0 / 150) * 150; x < L.x1; x += 150) {
      if (Math.abs(x - OC.x) < OC.r + 80) continue;
      g.fillStyle = linGrad(g, 0, Y(-60), 0, Y(520), [[0, '#000000', 0.55], [1, '#000000', 0]]);
      g.fillRect(x - 40, Y(-60), 80, Y(520) - Y(-60));
      rect(g, x + 40, Y(-60), 1.5, Y(500) - Y(-60), '#8a80b8', 0.12);
    }
    soft(L, 4, 8, (gg) => { at(gg); blob(gg, 0, oy, 720, 620, '#5e5490', 0.22); }, 'lighter');
    // window sky
    g.save();
    at(g);
    g.beginPath(); g.arc(0, oy, 250, 0, TAU); g.clip();
    const sky = g.createRadialGradient(0, oy, 20, 0, oy, 250);
    sky.addColorStop(0, col('#2c2a52')); sky.addColorStop(0.6, col('#1c1a3a')); sky.addColorStop(1, col('#2e2950'));
    g.fillStyle = sky;
    g.fillRect(-250, oy - 250, 250 * 2, 250 * 2);
    g.fillStyle = col('#ffffff', 0.5);
    for (let i = 0; i < 80; i++) { const a = R() * TAU, r = 90 + R() * 150; g.fillRect(Math.cos(a) * r, oy + Math.sin(a) * r, 1, 1); }
    g.restore();
    // ringed planet arc behind the eclipse
    soft(L, 1, 1, (gg) => {
      at(gg);
      gg.save(); gg.translate(0, oy); gg.rotate(-0.22); gg.scale(1, 0.22);
      gg.beginPath(); gg.arc(0, 0, 170, 0, TAU); gg.strokeStyle = col(GOLD, 0.35); gg.lineWidth = 7; gg.stroke();
      gg.beginPath(); gg.arc(0, 0, 150, 0, TAU); gg.strokeStyle = col(GOLD, 0.15); gg.lineWidth = 12; gg.stroke();
      gg.restore();
    }, 'lighter');
    // corona
    soft(L, 2, 4, (gg) => {
      at(gg);
      blob(gg, 0, oy, 175, 175, ICE, 0.5, 0.2);
      gg.lineCap = 'round';
      for (let i = 0; i < 70; i++) {
        const a = R() * TAU, l = 70 + R() * 130 * (0.5 + 0.5 * Math.abs(Math.cos(a)));
        gg.strokeStyle = linGrad(gg, Math.cos(a) * 60, oy + Math.sin(a) * 60, Math.cos(a) * l, oy + Math.sin(a) * l, [[0, ICE, 0.55], [1, ICE, 0]]);
        gg.lineWidth = 2 + R() * 6;
        gg.beginPath(); gg.moveTo(Math.cos(a) * 60, oy + Math.sin(a) * 60); gg.lineTo(Math.cos(a) * l, oy + Math.sin(a) * l); gg.stroke();
      }
    }, 'lighter');
    soft(L, 1, 1, (gg) => { at(gg); blob(gg, 0, oy, 92, 92, ICE, 0.95, 0.6); }, 'lighter');
    g.save();
    at(g);
    g.beginPath(); g.arc(0, oy, 60, 0, TAU); g.fillStyle = col('#050309'); g.fill();
    g.beginPath(); g.arc(0, oy, 60.5, -0.9, 0.1); g.strokeStyle = col('#fff4d8', 0.95); g.lineWidth = 2.5; g.stroke();
    g.restore();
    soft(L, 1, 2, (gg) => { at(gg); blob(gg, Math.cos(-0.4) * 61, oy + Math.sin(-0.4) * 61, 14, 14, '#fff6e0', 1); }, 'lighter');
    // the ring re-crosses in front of the disc (bottom half of the ellipse)
    g.save(); at(g); g.translate(0, oy); g.rotate(-0.22); g.scale(1, 0.22);
    g.beginPath(); g.arc(0, 0, 170, 0.15, Math.PI - 0.15); g.strokeStyle = col(GOLD, 0.4); g.lineWidth = 7; g.stroke();
    g.restore();
    // frame: annulus, inner ring, spokes
    const fr = sub(L), fg = fr.g;
    at(fg);
    fg.fillStyle = linGrad(fg, 0, oy - 250 - 60, 0, oy + 250 + 60, [[0, '#08060f'], [1, '#141026']]);
    fg.beginPath(); fg.arc(0, oy, 250 + 54, 0, TAU); fg.arc(0, oy, 250, 0, TAU, true); fg.fill('evenodd');
    fg.strokeStyle = col('#0a0812'); fg.lineWidth = 7;
    fg.beginPath(); fg.arc(0, oy, 124, 0, TAU); fg.stroke();
    fg.lineWidth = 3;
    fg.beginPath(); fg.arc(0, oy, 182, 0, TAU); fg.stroke();
    fg.lineWidth = 8;
    fg.beginPath();
    for (let k = 0; k < 16; k++) { const a = k / 16 * TAU + 0.1; fg.moveTo(Math.cos(a) * 124, oy + Math.sin(a) * 124); fg.lineTo(Math.cos(a) * (250 + 2), oy + Math.sin(a) * (250 + 2)); }
    fg.stroke();
    // gold inlay + ice rim
    fg.beginPath(); fg.arc(0, oy, 250 + 30, 0, TAU); fg.strokeStyle = col(GOLD, 0.35); fg.lineWidth = 1.5; fg.stroke();
    fg.beginPath(); fg.arc(0, oy, 250 + 1, 0.2, Math.PI - 0.2); fg.strokeStyle = col(ICE, 0.45); fg.lineWidth = 2; fg.stroke();
    fg.beginPath(); fg.arc(0, oy, 126, 0.3, Math.PI - 0.3); fg.strokeStyle = col(ICE, 0.35); fg.lineWidth = 1.5; fg.stroke();
    if (V.piece === 'cracked') { // a struck pane: cracks running out from one impact, two panes gone
      const C = rng(V.crack.seed), ia = V.crack.a, ir = 160 + C() * 60, ix = Math.cos(ia) * ir, iy = oy + Math.sin(ia) * ir;
      for (let i = 0; i < 2; i++) { // missing panes let more of the corona through
        const k = (Math.floor((ia - 0.1) / TAU * 16) + 16 + (i ? 1 : 0)) % 16, a0 = k / 16 * TAU + 0.1, a1 = a0 + TAU / 16;
        fg.beginPath(); fg.arc(0, oy, 247, a0 + 0.02, a1 - 0.02); fg.arc(0, oy, 185, a1 - 0.03, a0 + 0.03, true); fg.closePath();
        fg.fillStyle = col('#6a62a0', 0.45); fg.fill();
      }
      const paths = [];
      for (let i = 0; i < 11; i++) {
        let a = ia + Math.PI + spreadR(C, 2.2), x = ix, y = iy;
        const pts = [x, y];
        for (let j = 0, n = 3 + Math.floor(C() * 5); j < n; j++) {
          a += spreadR(C, 0.45); x += Math.cos(a) * (16 + C() * 30); y += Math.sin(a) * (16 + C() * 30);
          if (Math.hypot(x, y - oy) > 250) break;
          pts.push(x, y);
        }
        paths.push(pts);
      }
      // a ring crack around the impact
      const ring = [];
      for (let j = 0; j <= 12; j++) { const a = (j / 12) * TAU, r = 16 + C() * 9; ring.push(ix + Math.cos(a) * r, iy + Math.sin(a) * r); }
      paths.push(ring);
      fg.lineCap = 'round'; fg.lineJoin = 'round';
      for (const [c, a, w, o] of [['#e8eeff', 0.5, 1.2, 1], ['#05030a', 0.95, 2.2, 0]]) {
        fg.strokeStyle = col(c, a); fg.lineWidth = w;
        fg.beginPath();
        for (const pts of paths) { fg.moveTo(pts[0] + o, pts[1] + o); for (let j = 2; j < pts.length; j += 2) fg.lineTo(pts[j] + o, pts[j + 1] + o); }
        fg.stroke();
      }
    }
    stamp(L, fr.c);
    grain(L, 0.06, false);
  }
  const ocScreen = (cam, vw, vh, out) => layerToScreen(back, OC.x, back.Y(OC.sy), cam, vw, vh, out);

  // --- pillar rows ----------------------------------------------------------
  const pillarRow = (p, res, spacing, w, gap, opts) => {
    const L = opts.part ? B.part(p, res * q) : backLayer(p, res * q, W), Y = L.Y;
    const s = sub(L), g = s.g;
    const xs = [];
    // the gap around the oculus widens with it
    gap += OC.r - 250;
    for (let x = Math.ceil(L.x0 / spacing) * spacing + (opts.off || 0); x < L.x1; x += spacing) if (Math.abs(x - OC.x) > gap) xs.push(x);
    if (opts.xs) xs.splice(0, xs.length, ...opts.xs);
    for (const x of xs) {
      const lit = x < OC.x ? 1 : -1;
      g.fillStyle = linGrad(g, x - w / 2, 0, x + w / 2, 0, lit > 0
        ? [[0, opts.dark], [0.75, opts.body], [0.97, opts.rim], [1, opts.dark]]
        : [[0, opts.dark], [0.03, opts.rim], [0.25, opts.body], [1, opts.dark]]);
      g.fillRect(x - w / 2, Y(-400), w, Y(900) - Y(-400));
      // fluting
      for (let k = 1; k < 5; k++) rect(g, x - w / 2 + (w * k) / 5, Y(-400), 1.2, Y(900) - Y(-400), '#000000', 0.25);
      // capital and base blocks
      rect(g, x - w / 2 - w * 0.18, Y(opts.cap) - w * 0.25, w * 1.36, w * 0.25, opts.dark);
      rect(g, x - w / 2 - w * 0.18, Y(opts.cap), w * 1.36, 2, GOLD, 0.25);
    }
    if (opts.beam !== undefined) {
      rect(g, L.x0, Y(opts.beam) - 40, L.x1 - L.x0, 40, opts.dark);
      rect(g, L.x0, Y(opts.beam) - 2, L.x1 - L.x0, 2, ICE, 0.18);
      rect(g, L.x0, Y(opts.beam) - 40, L.x1 - L.x0, 1.4, GOLD, 0.25);
    }
    if (opts.banners) {
      for (let i = 0; i < xs.length - 1; i++) {
        const bx = (xs[i] + xs[i + 1]) / 2, bw = opts.banners.w;
        if (Math.abs(bx - OC.x) < gap + 60) continue;
        const y0 = Y(opts.beam), y1 = Y(opts.banners.end);
        g.fillStyle = linGrad(g, bx - bw / 2, 0, bx + bw / 2, 0, [[0, '#120c22'], [0.5, '#1d1435'], [1, '#100a1e']]);
        poly(g, [bx - bw / 2, y0, bx + bw / 2, y0, bx + bw / 2, y1, bx, y1 + bw * 0.45, bx - bw / 2, y1]);
        g.fill();
        g.strokeStyle = col(GOLD, 0.4); g.lineWidth = 1.2;
        poly(g, [bx - bw / 2 + 5, y0 + 6, bx + bw / 2 - 5, y0 + 6, bx + bw / 2 - 5, y1 - 4, bx, y1 + bw * 0.45 - 9, bx - bw / 2 + 5, y1 - 4]);
        g.stroke();
        // abstract emblem: ring, bar and chevrons
        const ey = y0 + (y1 - y0) * 0.4;
        g.strokeStyle = col(GOLD, 0.6); g.lineWidth = 2;
        g.beginPath(); g.arc(bx, ey, bw * 0.24, 0, TAU); g.stroke();
        g.beginPath(); g.moveTo(bx, ey - bw * 0.5); g.lineTo(bx, ey + bw * 0.7);
        for (let k = 0; k < 3; k++) { const cy = ey + bw * (0.9 + k * 0.28); g.moveTo(bx - bw * 0.2, cy); g.lineTo(bx, cy + bw * 0.12); g.lineTo(bx + bw * 0.2, cy); }
        g.stroke();
      }
    }
    if (opts.drape) {
      for (const x of xs) {
        const bw = w * 0.56, y0 = Y(opts.cap) + 6, y1 = Y(opts.drape);
        g.fillStyle = linGrad(g, x - bw / 2, 0, x + bw / 2, 0, [[0, '#0d0819'], [0.5, '#1a1230'], [1, '#0b0716']]);
        poly(g, [x - bw / 2, y0, x + bw / 2, y0, x + bw / 2, y1, x, y1 + bw * 0.5, x - bw / 2, y1]);
        g.fill();
        g.strokeStyle = col(GOLD, 0.45); g.lineWidth = 1.5;
        poly(g, [x - bw / 2 + 6, y0 + 4, x + bw / 2 - 6, y0 + 4, x + bw / 2 - 6, y1 - 4, x, y1 + bw * 0.5 - 10, x - bw / 2 + 6, y1 - 4]);
        g.stroke();
        const ey = y0 + (y1 - y0) * 0.3;
        g.strokeStyle = col(GOLD, 0.7); g.lineWidth = 2.4;
        g.beginPath(); g.arc(x, ey, bw * 0.22, 0, TAU); g.stroke();
        g.beginPath(); g.arc(x, ey, bw * 0.08, 0, TAU); g.stroke();
        g.beginPath(); g.moveTo(x, ey + bw * 0.3); g.lineTo(x, y1 - 20);
        for (let k = 0; k < 4; k++) { const cy = ey + bw * (0.55 + k * 0.22); g.moveTo(x - bw * 0.2, cy); g.lineTo(x, cy + bw * 0.1); g.lineTo(x + bw * 0.2, cy); }
        g.stroke();
      }
    }
    if (opts.lamps) { // lanterns on chains: between the pillars, or beside each one
      const at = opts.lamps.side ? xs.flatMap((x) => [x - w * 0.8, x + w * 0.8]) : xs.slice(1).map((x, i) => (xs[i] + x) / 2);
      const lit = [];
      for (const x of at) {
        if (Math.abs(x - OC.x) < gap + 40) continue;
        const y0 = Y(opts.beam), y1 = y0 + opts.lamps.drop + (R() - 0.5) * 30;
        g.fillStyle = col('#0a0712');
        for (let y = y0; y < y1 - 14; y += 8) { g.fillRect(x - 1.5, y, 3, 6); }
        poly(g, [x - 11, y1 - 14, x + 11, y1 - 14, x + 8, y1 + 14, x - 8, y1 + 14], col('#0a0712'));
        rect(g, x - 14, y1 - 18, 28, 5, '#0a0712');
        rect(g, x - 5, y1 - 9, 10, 17, '#ffd89a', 0.9);
        lit.push([x, y1]);
      }
      stamp(L, s.c);
      soft(L, 3, 4, (gg) => {
        for (const [x, y] of lit) {
          blob(gg, x, y, 60, 60, GOLD, 0.35);
          cone(gg, x, y + 14, y + 260, 30, 200, GOLD, 0.07);
        }
      }, 'lighter');
    } else stamp(L, s.c);
    grain(L, 0.05);
    snapshot(L, [[Y(opts.fog[1]), FOG, 0], [Y(opts.fog[2] + 60), FOG, 0.45]]);
    vfill(L, [[Y(opts.fog[0]), FOG, 0], [Y(opts.fog[1]), FOG, 0.6], [Y(opts.fog[2]), FOG, opts.fogMax ?? 0.95]], 'source-atop');
    return L;
  };
  const lamps = V.piece === 'lamps';
  const far = pillarRow(0.12, 0.6, V.farStep ?? 230, 60, 330, {
    dark: '#17122a', body: '#211a3a', rim: '#4e4680', cap: 10, beam: 40, fog: [120, 360, 520], fogMax: 0.92, off: 115, part: true });
  soft(far, 3, 4, (g) => { // a hazy wash so the far row recedes
    vfill(far, [[far.Y(-60), FOG, 0.25], [far.Y(300), FOG, 0.4]], 'source-over', g);
  }, 'source-atop');
  const mid = pillarRow(0.3, 0.75, V.midStep ?? 400, V.midW ?? 100, 360, {
    dark: '#0b0816', body: '#130e24', rim: '#7d76b0', cap: -20, beam: 0, fog: [180, 380, 530],
    banners: lamps ? null : { w: 70, end: 250 }, lamps: lamps ? { drop: 120 } : null });
  const near = pillarRow(0.6, 0.9, 760, 170, 380, {
    dark: '#030206', body: '#07050c', rim: '#a8a2d4', cap: -60, beam: -40, fog: [200, 360, 520], xs: V.near || [-1340, -560, 560, 1340],
    drape: lamps ? null : 210, lamps: lamps ? { drop: 150, side: true } : null });

  const hazeStops = [[-420, 0], [-280, 0.1], [-150, 0.32], [-40, 0.52], [0, 0.58]].map(([y, a]) => [y, a * V.haze]);
  const hazeB = haze(B, q, '#51447a', hazeStops, { n: 30, h: 250, c: '#7a70a8', a: 0.1 }, R);

  // --- floor: polished obsidian --------------------------------------------------
  const D = 1300;
  const floor = mkFloor(W, D, -60, 1.25 * q);
  const pools = V.pools || [-480, -170, 170, 480];
  {
    const L = floor, g = L.g;
    vfill(L, [[-60, '#2a2244', 0], [-40, '#1c1632', 0.8], [-1, '#100c1c', 0.9], [0, '#040307', 0.1], [60, '#040307', 0.28], [200, '#030205', 0.5], [400, '#020104', 0.7]]);
    const rows = [-36, -16, 14, 52, 120, 240, 420];
    for (const y of rows) {
      rect(g, L.x0, y, L.x1 - L.x0, 1 + Math.max(0, y) / 260, '#000000', 0.6);
      rect(g, L.x0, y + 1 + Math.max(0, y) / 260, L.x1 - L.x0, 0.7 + Math.max(0, y) / 400, '#9a90d0', 0.08);
    }
    rect(g, L.x0, 14 + 4, L.x1 - L.x0, 1.2, GOLD, 0.22);
    g.strokeStyle = col('#000000', 0.5);
    g.lineWidth = 1.3;
    g.beginPath();
    for (let x = Math.ceil(L.x0 / 300) * 300; x < L.x1; x += 300) { g.moveTo(x * (1 - 60 / D), -60); g.lineTo(x * (1 + 420 / D), 420); }
    g.stroke();
    // inlay medallion around the arena center
    g.save();
    g.translate(0, 70); g.scale(1, 0.13);
    g.beginPath(); g.arc(0, 0, 420, 0, TAU); g.strokeStyle = col(GOLD, 0.2); g.lineWidth = 9; g.stroke();
    g.beginPath(); g.arc(0, 0, 380, 0, TAU); g.strokeStyle = col(GOLD, 0.1); g.lineWidth = 5; g.stroke();
    g.restore();
    soft(L, 2, 4, (gg) => {
      for (const x of pools) blob(gg, x * 0.8, 6, 260, 30, ICE, 0.08);
    }, 'lighter');
    grain(L, 0.07);
  }

  const floorBase = col('#030206');
  flatten(B, floorBase, [[0.75, 2, 3, 2], [0.75, 2, 3, 2], [0.7, 1, 2, 2]]);
  const mirrors = [
    [reflection(mid, 2, 3), 0.75],
    [reflection(near, 2, 3), 0.7],
  ];
  mid.rects = cull(mid);
  near.rects = cull(near);

  // light shafts: oculus (far) to floor pools (play plane), drawn as sheared textures
  const shaftTex = (() => {
    const { c, g } = mk(128, 512);
    g.fillStyle = linGrad(g, 0, 0, 0, 512, [[0, '#ffffff', 0], [0.1, '#ffffff', 0.9], [0.3, '#ffffff', 0.55], [0.7, '#ffffff', 0.28], [1, '#ffffff', 0.45]]);
    poly(g, [50, 0, 78, 0, 120, 512, 8, 512]);
    g.fill();
    blur(c, 8, 2);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = col('#d8e2ff');
    g.fillRect(0, 0, 128, 512);
    return c;
  })();
  const poolTex = (() => {
    const { c, g } = mk(128, 32);
    g.setTransform(1, 0, 0, 0.25, 0, 0);
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, col('#ffffff', 1)); gr.addColorStop(0.15, col(ICE, 0.7)); gr.addColorStop(0.5, col(ICE, 0.2)); gr.addColorStop(1, col(ICE, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return c;
  })();
  const shafts = pools.map((x, i) => ({ fx: x, ox: [-110, -42, 42, 110][i] * OK, oy: (120 + Math.abs([-110, -42, 42, 110][i]) * -0.3) * OK, a: [0.16, 0.2, 0.2, 0.16][i] }));
  // Beam feet slide at 0.3 of the play plane so the shafts never flatten out at the camera extremes.
  const SHAFT_FOOT = 0.3;
  const drawShafts = (ctx, cam, vw, vh, sg, k) => {
    ocScreen(cam, vw, vh, TMP);
    ctx.globalCompositeOperation = 'lighter';
    for (const s of shafts) {
      const tx = TMP.x + s.ox * TMP.z, ty = TMP.y + s.oy * TMP.z;
      const bx = (s.fx - cam.x * SHAFT_FOOT) * cam.zoom + vw / 2, by = sg + 6 * cam.zoom;
      if (k > 1 && by < vh + 60) {
        ctx.globalAlpha = s.a * 2.6;
        ctx.drawImage(poolTex, bx - 240 * cam.zoom, by - 34 * cam.zoom, 480 * cam.zoom, 72 * cam.zoom);
      }
      const w = 240 * cam.zoom;
      ctx.setTransform(MIR.a * w, MIR.b * w, MIR.a * (bx - tx) + MIR.c * (by - ty), MIR.b * (bx - tx) + MIR.d * (by - ty),
        MIR.a * (tx - w / 2) + MIR.c * ty + MIR.e, MIR.b * (tx - w / 2) + MIR.d * ty + MIR.f);
      ctx.globalAlpha = s.a * k;
      ctx.drawImage(shaftTex, 0, 0, 1, 1);
    }
    ctx.setTransform(MIR.a, MIR.b, MIR.c, MIR.d, MIR.e, MIR.f);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };
  const motes = [];
  for (let i = 0, n = Math.round(64 * V.dust); i < n; i++) motes.push({ s: i % 4, u: R(), v: 0.1 + R() * 0.85, sp: 0.004 + R() * 0.01, ph: R() * TAU, sz: 1 + R() * 1.6 });
  const moteFx = (ctx, cam, vw, vh, t, sg) => {
    ocScreen(cam, vw, vh, TMP);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = col('#f2ecd8', 1);
    for (const m of motes) {
      const s = shafts[m.s];
      const tx = TMP.x + s.ox * TMP.z, ty = TMP.y + s.oy * TMP.z;
      const bx = (s.fx - cam.x * SHAFT_FOOT) * cam.zoom + vw / 2, by = sg;
      const v = (m.v + t * m.sp) % 1;
      const u = 0.5 + (m.u - 0.5) * (0.3 + 0.7 * v) * 0.8 + Math.sin(t * 0.3 + m.ph) * 0.03;
      const w = 240 * cam.zoom;
      const x = tx - w / 2 + u * w + (bx - tx) * v, y = ty + (by - ty) * v;
      ctx.globalAlpha = 0.5 * Math.sin(v * Math.PI) * (0.5 + 0.5 * Math.sin(t * 1.3 + m.ph));
      const r = m.sz * cam.zoom;
      ctx.fillRect(x - r / 2, y - r / 2, r, r);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  const fgTop = fgStrip(W, 110, (g, x0, x1) => {
    for (let x = Math.ceil(x0 / 1300) * 1300 + 650; x < x1; x += 1300) {
      rect(g, x - 2, -10, 4, 62, '#020104');
      poly(g, [x - 26, 52, x + 26, 52, x + 16, 90, x - 16, 90], col('#020104'));
      rect(g, x - 30, 50, 60, 5, '#020104');
      rect(g, x - 12, 66, 24, 14, GOLD, 0.25);
    }
  });
  const fgBot = fgStrip(W, 80, (g, x0, x1) => {
    for (let s0 = Math.ceil(x0 / 1700) * 1700 - 900; s0 < x1; s0 += 1700) {
      const s1 = s0 + 420;
      rect(g, s0 - 30, 22, s1 - s0 + 60, 14, '#020104');
      rect(g, s0 - 30, 21, s1 - s0 + 60, 1.5, ICE, 0.22);
      rect(g, s0 - 40, 22, 40, 70, '#020104');
      rect(g, s1, 22, 40, 70, '#020104');
      g.fillStyle = col('#020104');
      for (let x = s0 + 23; x < s1; x += 46) {
        g.beginPath(); g.ellipse(x, 56, 11, 18, 0, 0, TAU); g.fill();
        g.fillRect(x - 6, 36, 12, 44);
      }
      rect(g, s0 - 30, 72, s1 - s0 + 60, 10, '#020104');
    }
  });

  const A = {
    backdrop: B,
    back: [{ L: mid }, { L: near }, { bands: hazeB }],
    floorBase,
    mirrors,
    hazeRefl: bands('#51447a', hazeStops.map(([y, a]) => [-y, a * 0.7]).reverse()),
    floor,
    // The shafts are drawn once, behind the fighters, at the strength the old back and front passes summed to.
    onFloor: [{ fx: (ctx, cam, vw, vh, t, sg) => drawShafts(ctx, cam, vw, vh, sg, 1.72) }],
    front: [moteFx],
    fogFront: fogBands('#6a5c98', [[0, 0], [0.55, 0.8], [0.75, 1], [1, 0]], 200, 80, 0.09),
    fgTop, fgBot,
    vignette: vignette(0.75, '#020106'),
  };
  return { id: 'hall', name: 'EXAMINATION HALL', width: W, palette: palette(pal), reflect: 0.75, ...compose(A) };
}

// ======================================================================

const BUILDERS = { causeway: buildCauseway, foundry: buildFoundry, hall: buildHall };

export function buildArena(id, opts = {}) {
  const b = BUILDERS[id];
  if (!b) throw new Error(`unknown arena: ${id}`);
  const q = clamp(opts.quality ?? 1, 0.25, 1);
  const V = variant(id, opts.seed ?? 0);
  TRACK = [];
  TINT = V.tint;
  TINT_CACHE.clear();
  try {
    const arena = b(q, V);
    arena.seed = V.seed;
    if (V.piece) arena.setPiece = V.piece;
    return arena;
  } finally {
    TRACK = null;
    TINT = null;
  }
}
