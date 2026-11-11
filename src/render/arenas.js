// Procedurally painted arenas. All static lighting is baked once into offscreen
// canvases by buildArena(); per frame each arena is a few parallax drawImage calls
// plus a small amount of ambient animation (rain, embers, dust motes).
//
// Layer model: a layer with parallax p maps layer point (lx, ly) to the screen as
//   sx = (lx - cam.x * px) * zp + w/2,   sy = (ly - cam.y * p) * zp + h/2,   zp = 1 + (zoom - 1) * p
// where px defaults to p. The floor is a sheared texture so its rows slide with
// perspective-correct parallax (row y has horizontal parallax 1 + y / D).

export const ARENA_IDS = ['causeway', 'foundry', 'hall'];

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
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function rgb(c) {
  if (typeof c !== 'string') return c;
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function col(c, a = 1) {
  const [r, g, b] = rgb(c);
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
}
function mix(a, b, t) {
  const x = rgb(a), y = rgb(b);
  return [lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)];
}

function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  return { c, g };
}

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
}

let NOISE = null;
function noiseTile() {
  if (NOISE) return NOISE;
  const { c, g } = mk(256, 256);
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
function layerBounds(p, width, mode, px = p) {
  const cxMax = width / 2 + 200 + SHAKE;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  sweep((sx, cy, z) => {
    const zp = 1 + (z - 1) * p;
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

function mkLayer(p, res, b, px = p) {
  const { c, g } = mk((b.x1 - b.x0) * res, (b.y1 - b.y0) * res);
  const sx = c.width / (b.x1 - b.x0), sy = c.height / (b.y1 - b.y0);
  g.setTransform(sx, 0, 0, sy, -b.x0 * sx, -b.y0 * sy);
  return { p, px, s: sx, sx, sy, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, c, g,
    Y: (sy0) => sy0 - 360 - 200 * p }; // design helper: layer y of a screen row at the typical camera
}

function backLayer(p, res, width, opts = {}) {
  const b = layerBounds(p, width, 'back', opts.px ?? p);
  if (opts.y0 !== undefined) b.y0 = Math.max(b.y0, opts.y0);
  if (opts.y1 !== undefined) b.y1 = Math.min(b.y1, opts.y1);
  return mkLayer(p, res, b, opts.px ?? p);
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
function stamp(L, src, op = 'source-over', alpha = 1) {
  const g = L.g;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = op;
  g.globalAlpha = alpha;
  g.drawImage(src, 0, 0, L.c.width, L.c.height);
  g.restore();
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
  return { p: L.p, px: L.px, sx: m.c.width / (L.x1 - L.x0), sy: m.c.height / (L.y1 - L.y0),
    x0: L.x0, y0: L.y0, x1: L.x1, y1: L.y1, c: m.c };
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

function vignette(strength, tint = '#000000') {
  const { c, g } = mk(320, 180);
  g.setTransform(1, 0, 0, 180 / 320, 0, 0);
  const gr = g.createRadialGradient(160, 160, 60, 160, 160, 210);
  gr.addColorStop(0, col(tint, 0));
  gr.addColorStop(0.55, col(tint, strength * 0.35));
  gr.addColorStop(1, col(tint, strength));
  g.fillStyle = gr;
  g.fillRect(0, 0, 320, 320);
  return c;
}

// Ground-anchored vertical fog profile: drawn stretched from ground-top to ground+bottom.
function fogStrip(c, stops) {
  const { c: cv, g } = mk(8, 256);
  g.fillStyle = linGrad(g, 0, 0, 0, 256, stops.map(([t, a]) => [t, c, a]));
  g.fillRect(0, 0, 8, 256);
  return cv;
}

// Screen-anchored foreground strip, painted at 0.5px/unit and drawn at 2x (built-in defocus).
function fgStrip(width, height, paint) {
  const half = (width / 2 + 200 + SHAKE) * ZOOM[1] * FG_PARALLAX + VIEW_W / 2 + 60;
  const s = 0.5;
  const { c, g } = mk(half * 2 * s, height * s);
  g.setTransform(s, 0, 0, s, half * s, 0);
  paint(g, -half, half);
  blur(c, 2);
  return { c, x0: -half, w: half * 2, h: height };
}

// ---------------------------------------------------------------- per-frame draws

function drawLayer(ctx, L, cam, vw, vh, clipY) {
  const zp = 1 + (cam.zoom - 1) * L.p, cx = cam.x * L.px, cy = cam.y * L.p;
  const hw = vw / 2 / zp, hh = vh / 2 / zp;
  let x0 = cx - hw, x1 = cx + hw, y0 = cy - hh, y1 = cy + hh;
  if (clipY !== undefined) y1 = Math.min(y1, (clipY - vh / 2) / zp + cy + 3 / zp);
  if (x0 < L.x0) x0 = L.x0;
  if (x1 > L.x1) x1 = L.x1;
  if (y0 < L.y0) y0 = L.y0;
  if (y1 > L.y1) y1 = L.y1;
  if (x1 <= x0 || y1 <= y0) return;
  ctx.drawImage(L.c, (x0 - L.x0) * L.sx, (y0 - L.y0) * L.sy, (x1 - x0) * L.sx, (y1 - y0) * L.sy,
    (x0 - cx) * zp + vw / 2, (y0 - cy) * zp + vh / 2, (x1 - x0) * zp, (y1 - y0) * zp);
}

// Mirror the part of a layer above screen row `axis` into the rows below it.
function drawMirror(ctx, L, cam, vw, vh, axis) {
  if (axis >= vh) return;
  const zp = 1 + (cam.zoom - 1) * L.p, cx = cam.x * L.px, cy = cam.y * L.p;
  const hw = vw / 2 / zp;
  let x0 = cx - hw, x1 = cx + hw;
  let y0 = (2 * axis - vh - vh / 2) / zp + cy, y1 = (axis - vh / 2) / zp + cy;
  if (x0 < L.x0) x0 = L.x0;
  if (x1 > L.x1) x1 = L.x1;
  if (y0 < L.y0) y0 = L.y0;
  if (y1 > L.y1) y1 = L.y1;
  if (x1 <= x0 || y1 <= y0) return;
  ctx.setTransform(MIR.a, MIR.b, -MIR.c, -MIR.d, MIR.c * 2 * axis + MIR.e, MIR.d * 2 * axis + MIR.f);
  ctx.drawImage(L.c, (x0 - L.x0) * L.sx, (y0 - L.y0) * L.sy, (x1 - x0) * L.sx, (y1 - y0) * L.sy,
    (x0 - cx) * zp + vw / 2, (y0 - cy) * zp + vh / 2, (x1 - x0) * zp, (y1 - y0) * zp);
  ctx.setTransform(MIR.a, MIR.b, MIR.c, MIR.d, MIR.e, MIR.f);
}
const MIR = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
function saveBase(ctx) {
  const m = ctx.getTransform();
  MIR.a = m.a; MIR.b = m.b; MIR.c = m.c; MIR.d = m.d; MIR.e = m.e; MIR.f = m.f;
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
  let x0 = -off, x1 = vw - off;
  if (x0 < S.x0) x0 = S.x0;
  if (x1 > S.x0 + S.w) x1 = S.x0 + S.w;
  if (x1 <= x0) return;
  const k = S.c.width / S.w;
  ctx.drawImage(S.c, (x0 - S.x0) * k, 0, (x1 - x0) * k, S.c.height, x0 + off, top ? 0 : vh - S.h, x1 - x0, S.h);
}

function layerToScreen(L, lx, ly, cam, vw, vh, out) {
  const zp = 1 + (cam.zoom - 1) * L.p;
  out.x = (lx - cam.x * L.px) * zp + vw / 2;
  out.y = (ly - cam.y * L.p) * zp + vh / 2;
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

// Common frame skeleton shared by all arenas.
function compose(A) {
  return {
    drawBack(ctx, cam, view, t) {
      const vw = view.w, vh = view.h, sg = (0 - cam.y) * cam.zoom + vh / 2;
      ctx.save();
      saveBase(ctx);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      for (const step of A.back) {
        if (step.op) {
          ctx.globalCompositeOperation = step.op;
          ctx.globalAlpha = step.a ?? 1;
          drawLayer(ctx, step.L, cam, vw, vh, sg);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
        } else if (step.L) drawLayer(ctx, step.L, cam, vw, vh, sg);
        if (step.fx) step.fx(ctx, cam, vw, vh, t, sg);
      }
      // Floor: solid base below the ground line, mirrored background, then the sheared floor texture.
      if (sg < vh) {
        ctx.fillStyle = A.floorBase;
        ctx.fillRect(0, sg, vw, vh - sg + 2);
        for (const [R, a, axisRow] of A.mirrors) {
          ctx.globalAlpha = a;
          const axis = axisRow ? (axisRow - cam.y) * cam.zoom + vh / 2 : sg;
          drawMirror(ctx, R, cam, vw, vh, axis);
        }
        ctx.globalAlpha = 1;
      }
      drawFloor(ctx, A.floor, cam, vw, vh);
      for (const step of A.onFloor) {
        if (step.L) drawLayer(ctx, step.L, cam, vw, vh);
        if (step.fx) step.fx(ctx, cam, vw, vh, t, sg);
      }
      ctx.restore();
    },
    drawFront(ctx, cam, view, t) {
      const vw = view.w, vh = view.h, sg = (0 - cam.y) * cam.zoom + vh / 2;
      ctx.save();
      saveBase(ctx);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      for (const fx of A.front) fx(ctx, cam, vw, vh, t, sg);
      if (A.fogFront) {
        ctx.globalAlpha = A.fogFront.a;
        ctx.drawImage(A.fogFront.c, 0, sg - A.fogFront.up * cam.zoom, vw, (A.fogFront.up + A.fogFront.down) * cam.zoom);
        ctx.globalAlpha = 1;
      }
      if (A.fgTop) drawFg(ctx, A.fgTop, cam, vw, vh, true);
      if (A.fgBot) drawFg(ctx, A.fgBot, cam, vw, vh, false);
      ctx.drawImage(A.vignette, -4, -4, vw + 8, vh + 8);
      ctx.restore();
    },
  };
}

function hazeLayer(width, q, color, top, stops, wisps, R) {
  const L = backLayer(1, 0.25 * q, width, { y0: top - 10, y1: 60 });
  vfill(L, stops.map(([y, a]) => [y, color, a]));
  soft(L, 1, 2, (g) => {
    for (let i = 0; i < wisps.n; i++) {
      const x = lerp(L.x0, L.x1, R()), y = -20 - Math.pow(R(), 1.6) * wisps.h;
      blob(g, x, y, 120 + R() * 380, 10 + R() * 26, wisps.c, wisps.a * (0.4 + R() * 0.6));
    }
  });
  grain(L, 0.05);
  return L;
}

// ======================================================================
// SPIRE CAUSEWAY
// ======================================================================

function buildCauseway(q) {
  const R = rng(0xc0ffee);
  const W = 2200;
  const FOG = '#2a5562';
  const pal = { key: '#43c4d2', accent: '#ff3f9f', fog: FOG, floor: '#071017', ambient: '#8fc3d1' };
  const MAG = '#ff3f9f', TEAL = '#4fd0dc';
  const SPIRE_X = 360;

  // --- sky ---------------------------------------------------------------
  const sky = backLayer(0.02, 0.5 * q, W);
  {
    const L = sky, Y = L.Y;
    vfill(L, [[Y(-80), '#010208'], [Y(80), '#040817'], [Y(220), '#0a162b'], [Y(340), '#13293c'],
      [Y(450), '#1e4152'], [Y(560), '#285462'], [Y(700), '#285462']]);
    // city glow from below the horizon
    soft(L, 4, 8, (g) => {
      for (let i = 0; i < 14; i++) {
        const x = lerp(L.x0, L.x1, R());
        blob(g, x, Y(600 + R() * 80), 260 + R() * 420, 120 + R() * 80, R() < 0.3 ? '#7a2468' : '#3a8290', 0.3);
      }
    }, 'lighter', 0.55);
    // cloud ceiling: dark masses, undersides lit by the city (teal) and the spire (magenta)
    soft(L, 2, 2, (g) => {
      for (let i = 0; i < 170; i++) {
        const x = lerp(L.x0, L.x1, R()), y = Y(-80 + Math.pow(R(), 0.9) * 300);
        const rx = 90 + R() * 300, ry = 14 + R() * 34;
        blob(g, x, y - ry * 0.7, rx, ry * 1.5, '#010207', 0.55);
        const nearSpire = Math.abs(x - 330) < 420;
        const lit = nearSpire && R() < 0.6 ? '#7a2a6a' : R() < 0.15 ? '#5a2458' : '#2a5c6c';
        blob(g, x + rx * 0.1, y + ry * 0.45, rx * 0.85, ry * 0.55, lit, 0.42 * clamp((y - Y(-60)) / 260, 0.35, 1));
      }
    });
    soft(L, 2, 2, (g) => {
      for (let i = 0; i < 110; i++) {
        const x = lerp(L.x0, L.x1, R()), y = Y(10 + R() * 260);
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
  const beams = [
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
    g.fillStyle = b.c;
    g.fillRect(0, 0, c.width, c.height);
    b.tex = c;
  }

  // --- far: megacity + the spire ------------------------------------------
  const far = backLayer(0.08, 0.6 * q, W);
  {
    const L = far, g = L.g, Y = L.Y;
    const city = sub(L);
    const cg = city.g;
    // two sub-rows: the back row hazier, the front row darker; varied crowns
    for (const [row, n, tone] of [[0, 150, 0.22], [1, 110, 0.45]]) {
      for (let i = 0; i < n; i++) {
        const x = lerp(L.x0, L.x1, R()), w = 16 + R() * (row ? 70 : 50);
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
    // aura of haze behind the spire
    soft(L, 4, 8, (gg) => blob(gg, SPIRE_X, Y(120), 460, 560, '#2d6a78', 0.3), 'destination-over');

    // fog over the city before the spire goes in, so the spire stays the darkest, crispest shape
    vfill(L, [[Y(300), FOG, 0.2], [Y(430), FOG, 0.6], [Y(560), FOG, 0.92]], 'source-atop');

    const spire = sub(L);
    const sg = spire.g, cx = SPIRE_X;
    // stepped profile: [screen y, half width]
    const prof = [[900, 132], [330, 122], [330, 104], [236, 98], [236, 80], [150, 74], [150, 62], [60, 54], [60, 44], [-60, 34], [-200, 24], [-700, 6]];
    const pts = [];
    for (const [sy, hw] of prof) pts.push(cx - hw, Y(sy));
    for (let i = prof.length - 1; i >= 0; i--) pts.push(cx + prof[i][1], Y(prof[i][0]));
    sg.fillStyle = linGrad(sg, cx - 132, 0, cx + 132, 0, [[0, '#183846'], [0.1, '#0b1824'], [0.5, '#060d16'], [0.9, '#050911'], [1, '#2a1230']]);
    poly(sg, pts); sg.fill();
    // flanking buttress columns
    for (const side of [-1, 1]) {
      poly(sg, [cx + side * 132, Y(900), cx + side * 168, Y(900), cx + side * 150, Y(260), cx + side * 128, Y(200)], col('#08111a'));
      poly(sg, [cx + side * 100, Y(330), cx + side * 116, Y(330), cx + side * 80, Y(40), cx + side * 72, Y(60)], col('#07101a'));
    }
    sg.save();
    sg.globalCompositeOperation = 'source-atop';
    // vertical ribs, horizontal tiers and lit window bands
    for (let x = cx - 160; x < cx + 160; x += 9) rect(sg, x, Y(-700), 1, Y(900) - Y(-700), '#000000', 0.3);
    for (let sy = 420; sy > -700; sy -= 18) {
      rect(sg, cx - 170, Y(sy), 340, 1.2, '#000000', 0.4);
      if (R() < 0.45) {
        sg.fillStyle = col(R() < 0.2 ? '#ff6ab8' : '#a8eef6', 0.22 + R() * 0.2);
        for (let x = cx - 130; x < cx + 130; x += 4.5) if (R() < 0.3) sg.fillRect(x, Y(sy) + 5, 2.6, 1.4);
      }
    }
    // a vertical gradient: upper spire catches the cloud glow
    sg.fillStyle = linGrad(sg, 0, Y(-200), 0, Y(300), [[0, '#2a5c6c', 0.18], [1, '#2a5c6c', 0]]);
    sg.fillRect(cx - 170, Y(-700), 340, Y(300) - Y(-700));
    sg.restore();
    // rim strokes
    const edge = (side, c, a, w) => {
      sg.beginPath();
      for (let i = 0; i < prof.length; i++) (i ? sg.lineTo : sg.moveTo).call(sg, cx + side * (prof[i][1] - 1.2), Y(prof[i][0]));
      sg.strokeStyle = linGrad(sg, 0, Y(-500), 0, Y(420), [[0, c, a * 0.4], [0.5, c, a], [1, c, a * 0.2]]);
      sg.lineWidth = w;
      sg.stroke();
    };
    edge(-1, '#6fd6e2', 0.6, 1.6);
    edge(1, MAG, 0.45, 1.4);
    lineV(sg, cx - 6, Y(-700), Y(420), 1.6, '#9ae8f2', 0.65);
    lineV(sg, cx + 6, Y(-700), Y(420), 1.0, '#9ae8f2', 0.3);
    // ring platform
    sg.save();
    sg.translate(cx, Y(150));
    sg.scale(1, 0.11);
    sg.beginPath(); sg.arc(0, 0, 175, 0, TAU);
    sg.fillStyle = col('#04080e'); sg.fill();
    sg.beginPath(); sg.arc(0, 10, 172, 0.04, Math.PI - 0.04);
    sg.strokeStyle = col(MAG, 0.95); sg.lineWidth = 16; sg.stroke();
    sg.restore();
    rect(sg, cx - 175, Y(150) - 4, 350, 3, '#0b1520');
    stamp(L, spire.c);
    soft(L, 3, 6, (gg) => {
      cone(gg, cx, Y(158), Y(460), 330, 560, MAG, 0.14);
      blob(gg, cx, Y(158), 230, 30, MAG, 0.55);
      lineV(gg, cx - 6, Y(-700), Y(420), 12, '#5fd2e0', 0.2);
    }, 'lighter');
    grain(L, 0.04);
    vfill(L, [[Y(330), FOG, 0], [Y(470), FOG, 0.55], [Y(580), FOG, 0.9]], 'source-atop');
  }

  // --- mid: megatowers, maglev ---------------------------------------------
  const mid = backLayer(0.22, 0.75 * q, W);
  {
    const L = mid, g = L.g, Y = L.Y;
    const towers = [[-1250, 220, -100], [-900, 150, 110], [-600, 240, -170], [-300, 110, 210], [600, 150, 60], [930, 250, -170], [1260, 170, 120]];
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
    const signs = [[-600 + 102, -60, MAG], [-300 - 40, 230, TEAL], [600 - 62, 90, TEAL], [930 - 108, -40, MAG], [-1250 + 96, 20, MAG]];
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
    const ty = Y(186);
    rect(g, L.x0, ty, L.x1 - L.x0, 7, '#08121b');
    rect(g, L.x0, ty + 7, L.x1 - L.x0, 3, '#050c13');
    g.fillStyle = col('#bff4fa', 0.5);
    for (let x = L.x0; x < L.x1; x += 34) g.fillRect(x, ty + 7.5, 2, 1.4);
    // faint baked rain sheets
    soft(L, 1, 1, (gg) => {
      gg.strokeStyle = col('#9fd4e0', 0.05);
      gg.lineWidth = 0.8;
      gg.beginPath();
      for (let i = 0; i < 1400; i++) {
        const x = lerp(L.x0, L.x1, R()), y = lerp(L.y0, L.y1, R()), l = 14 + R() * 26;
        gg.moveTo(x, y); gg.lineTo(x - l * 0.18, y + l);
      }
      gg.stroke();
    });
    grain(L, 0.06);
    vfill(L, [[Y(250), FOG, 0], [Y(420), FOG, 0.5], [Y(560), FOG, 0.85]], 'source-atop');
  }

  // --- near: a parallel cable-stayed causeway, pylons and cable fans ---------
  const near = backLayer(0.5, 0.9 * q, W);
  const PYL = [-340, 1260];
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
  const haze = hazeLayer(W, q, '#3a6f7c', -420,
    [[-420, 0], [-300, 0.04], [-180, 0.2], [-80, 0.42], [0, 0.55], [60, 0.55]],
    { n: 40, h: 260, c: '#5a98a4', a: 0.14 }, R);

  // --- floor (wet deck) ---------------------------------------------------
  const D = 1100;
  const floor = mkFloor(W, D, -28, 1.25 * q);
  const lampX = [];
  {
    const L = floor, g = L.g;
    vfill(L, [[-28, '#142a33', 0.97], [-1, '#0a171e', 0.92], [0, '#050b11', 0.3], [40, '#040a0f', 0.55], [140, '#03070b', 0.8], [400, '#020407', 0.93]]);
    // puddles: punch alpha so more reflection shows
    soft(L, 2, 2, (gg) => {
      for (let i = 0; i < 60; i++) {
        const x = lerp(L.x0, L.x1, R()), y = 6 + Math.pow(R(), 1.5) * 300;
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
        const x = lerp(L.x0, L.x1, R()), y = R() * 360;
        rect(gg, x, y, 20 + R() * 120, 0.6 + y / 300, '#8fd0dc', 0.035);
      }
    });
    // light pools from the rail lamps, with long wet streak reflections
    for (let x = Math.ceil(L.x0 / 480) * 480 + 240; x < L.x1; x += 480) lampX.push(x);
    soft(L, 2, 4, (gg) => {
      for (const x of lampX) {
        const c = (Math.round(x / 480) & 1) ? MAG : TEAL;
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
        const c = (Math.round(x / 480) & 1) ? MAG : TEAL;
        blob(gg, x, top - 6, 26, 26, c, 0.85);
      }
    }, 'lighter');
    for (const x of lampX) {
      rect(g, x - 3, top - 10, 6, 7, '#04080c');
      rect(g, x - 2, top - 9, 4, 4, (Math.round(x / 480) & 1) ? '#ffc4e4' : '#d4fbff', 1);
    }
  }

  // --- reflections ---------------------------------------------------------
  const mirrors = [
    [reflection(sky, 2, 4), 0.55],
    [reflection(far, 2, 6), 0.55],
    [reflection(mid, 2, 6), 0.55],
    [reflection(near, 2, 6), 0.5],
    [reflection(haze, 1, 2), 0.6],
    [reflection(rail, 2, 3, 2), 0.5, railRow],
  ];

  // --- animated lights -----------------------------------------------------
  const sprMag = glowSprite(MAG), sprTeal = glowSprite('#9ff0f8'), sprRed = glowSprite('#ff4a6a');
  const blinks = [
    { L: far, x: SPIRE_X - 172, y: far.Y(150), r: 16, spr: sprMag, per: 2.4, ph: 0 },
    { L: far, x: SPIRE_X + 172, y: far.Y(150), r: 16, spr: sprMag, per: 2.4, ph: 0.5 },
    { L: far, x: SPIRE_X - 40, y: far.Y(60), r: 12, spr: sprRed, per: 3.1, ph: 0.2 },
    { L: far, x: SPIRE_X + 40, y: far.Y(60), r: 12, spr: sprRed, per: 3.1, ph: 0.7 },
    { L: mid, x: -600, y: mid.Y(-170) - 120, r: 14, spr: sprRed, per: 2.0, ph: 0.3 },
    { L: mid, x: 930, y: mid.Y(-170) - 120, r: 14, spr: sprRed, per: 2.0, ph: 0.8 },
    { L: mid, x: -300, y: mid.Y(210) - 120, r: 11, spr: sprMag, per: 1.6, ph: 0.1 },
    { L: mid, x: 600, y: mid.Y(60) - 120, r: 11, spr: sprMag, per: 1.7, ph: 0.6 },
    { L: near, x: -340, y: near.Y(-40), r: 16, spr: sprRed, per: 2.6, ph: 0.4 },
    { L: near, x: 1260, y: near.Y(-40), r: 16, spr: sprRed, per: 2.6, ph: 0.9 },
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
      let x = ((h1 * W2 + ox - t * sp * 0.16) % W2 + W2) % W2 - 60;
      const l = len * (0.6 + h3 * 0.7);
      ctx.moveTo(x, y);
      ctx.lineTo(x - l * 0.16, y + l);
    }
    ctx.stroke();
  };
  const splashFx = (ctx, cam, vw, vh, t, sg) => {
    if (sg > vh) return;
    ctx.strokeStyle = col('#b8e4ee', 0.28);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 14; i++) {
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
    back: [
      { L: sky }, { fx: searchFx }, { L: far }, { L: mid }, { fx: blinkFx(blinks.slice(0, 7)) }, { L: near },
      { fx: blinkFx(blinks.slice(7)) }, { fx: rainFx(56, 11, 30, 0.12, 1, 0.5) }, { L: haze },
    ],
    floorBase: '#03070b',
    mirrors,
    floor,
    onFloor: [{ L: rail }, { fx: splashFx }],
    front: [rainFx(30, 977, 46, 0.2, 1.3, 1.25)],
    fogFront: { c: fogStrip('#4d8c98', [[0, 0], [0.55, 0.9], [0.75, 1], [1, 0]]), up: 220, down: 90, a: 0.1 },
    fgTop, fgBot,
    vignette: vignette(0.7, '#01030a'),
  };
  return { id: 'causeway', name: 'SPIRE CAUSEWAY', width: W, palette: pal, reflect: 0.55, ...compose(A) };
}

// ======================================================================
// FOUNDRY NINE
// ======================================================================

function buildFoundry(q) {
  const R = rng(0xf0f9);
  const W = 2200;
  const FOG = '#5a3420';
  const pal = { key: '#ff8a32', accent: '#6fb2cc', fog: FOG, floor: '#0c0907', ambient: '#d6a882' };
  const AMB = '#ff8a32', HOT = '#ffc46a', COOL = '#6fa8c0';

  // --- back wall -----------------------------------------------------------
  const back = backLayer(0.03, 0.5 * q, W);
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
      for (let i = 0; i < 10; i++) blob(gg, lerp(L.x0, L.x1, R()), Y(640), 300 + R() * 300, 220 + R() * 80, '#b0480e', 0.28);
    }, 'lighter');
    // smoke banks lit from below
    soft(L, 3, 6, (gg) => {
      for (let i = 0; i < 70; i++) {
        const x = lerp(L.x0, L.x1, R()), y = Y(120 + R() * 260);
        blob(gg, x, y, 80 + R() * 220, 20 + R() * 40, '#050405', 0.35);
        blob(gg, x, y + 20, 70 + R() * 160, 10 + R() * 20, '#7a3a14', 0.12);
      }
    });
    grain(L, 0.07, false);
  }

  // cool skylight shafts from the clerestory, drawn additively over the whole interior
  const shaftL = backLayer(0.03, 0.25 * q, W);
  {
    const L = shaftL, Y = L.Y;
    soft(L, 1, 4, (gg) => {
      for (let x = Math.ceil(L.x0 / 460) * 460 + 115; x < L.x1; x += 460) {
        gg.fillStyle = linGrad(gg, 0, Y(100), 0, Y(470), [[0, COOL, 0], [0.12, COOL, 0.5], [0.5, COOL, 0.16], [1, COOL, 0]]);
        poly(gg, [x - 34, Y(100), x + 34, Y(100), x + 200, Y(470), x + 60, Y(470)]);
        gg.fill();
      }
    });
  }

  // --- far: blast furnaces ---------------------------------------------------
  const far = backLayer(0.12, 0.6 * q, W);
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
    furn(-760, 200, 70);
    furn(160, 160, 130);
    furn(900, 220, 40);
    // stacks & a long pipe rack
    for (const x of [-1200, -420, 520, 1300]) rect(g, x - 18, Y(-400), 36, Y(900) - Y(-400), '#110b08');
    rect(g, L.x0, Y(150), L.x1 - L.x0, 14, '#120c08');
    rect(g, L.x0, Y(172), L.x1 - L.x0, 8, '#120c08');
    // underlight from the pit
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = linGrad(g, 0, Y(0), 0, Y(560), [[0, AMB, 0], [0.6, AMB, 0.12], [1, AMB, 0.3]]);
    g.fillRect(L.x0, L.y0, L.x1 - L.x0, L.y1 - L.y0);
    g.restore();
    stamp(L, s.c);
    // tap holes glowing at the furnace bases
    soft(L, 2, 4, (gg) => {
      for (const x of [-760, 160, 900]) {
        blob(gg, x, Y(350), 60, 40, HOT, 0.55);
        blob(gg, x, Y(360), 220, 90, AMB, 0.25);
      }
    }, 'lighter');
    grain(L, 0.04);
    vfill(L, [[Y(240), FOG, 0], [Y(420), FOG, 0.55], [Y(560), FOG, 0.9]], 'source-atop');
    // tuyere rings: rows of glowing ports around each furnace, above the play band
    soft(L, 1, 1, (gg) => {
      for (const [x, w, top] of [[-760, 200, 70], [160, 160, 130], [900, 220, 40]]) {
        const y = Y(top + 50);
        rect(gg, x - w / 2 - 6, y - 3, w + 12, 10, '#0c0806');
        for (let k = 0; k < 9; k++) rect(gg, x - w / 2 + (k + 0.5) * (w / 9) - 3, y, 6, 4, k % 3 ? '#ff8a2a' : '#ffc070', 0.95);
      }
    });
    soft(L, 3, 4, (gg) => {
      for (const [x, w, top] of [[-760, 200, 70], [160, 160, 130], [900, 220, 40]]) {
        blob(gg, x, Y(top + 52), w * 0.8, 18, AMB, 0.55);
        blob(gg, x, Y(top + 40), w * 0.9, 120, '#7a3a14', 0.2);
      }
    }, 'lighter');
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
    for (const [x, len] of [[-1080, 220], [-760, 150], [160, 260], [1180, 200], [-1420, 120], [1420, 170]]) {
      chain(x, t1, Y(92 + len));
      g.strokeStyle = col('#0b0806'); g.lineWidth = 5;
      g.beginPath(); g.arc(x + 7, Y(92 + len) + 10, 9, Math.PI, Math.PI * 2.6); g.stroke();
    }
    // raised casting platform with a mold trough
    const py = Y(228);
    rect(g, L.x0, py, L.x1 - L.x0, 14, '#0d0907');
    rect(g, L.x0, py + 14, L.x1 - L.x0, 3, '#060403');
    for (let x = Math.ceil(L.x0 / 600) * 600 + 300; x < L.x1; x += 600) rect(g, x - 10, py + 14, 20, Y(900) - py, '#0d0907');
    rect(g, -300, py - 12, 330, 12, '#120b07');
    for (let x = 60; x < 700; x += 70) rect(g, x, py - 10, 50, 10, '#120b07');
    stamp(L, s.c);

    // the pouring crucible: own canvas so its rim light stays on it
    const cx = -40, cy = Y(110), ang = -0.3;
    const cr = sub(L), c = cr.g;
    rect(c, cx - 56, t1, 112, 22, '#0d0907');
    c.fillStyle = col('#0b0806');
    for (const dx of [-44, 44]) for (let y = t1 + 20; y < cy - 60; y += 7) { c.fillRect(cx + dx - 1.5, y, 3, 5); }
    c.save();
    c.translate(cx, cy);
    c.rotate(ang);
    c.fillStyle = linGrad(c, -100, 0, 100, 0, [[0, '#24150c'], [0.35, '#100a07'], [1, '#1a0f09']]);
    c.beginPath();
    c.moveTo(-100, -64); c.lineTo(100, -64); c.lineTo(84, 30);
    c.quadraticCurveTo(70, 76, 0, 78); c.quadraticCurveTo(-70, 76, -84, 30);
    c.closePath();
    c.fill();
    rect(c, -108, -74, 216, 14, '#150d08');
    for (const x of [-60, 0, 60]) rect(c, x - 3, -60, 6, 128, '#0a0605', 0.8);
    // trunnion pins
    c.beginPath(); c.arc(-96, -10, 9, 0, TAU); c.arc(96, -10, 9, 0, TAU); c.fillStyle = '#0a0605'; c.fill();
    c.restore();
    c.save();
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = linGrad(c, cx - 140, cy + 110, cx + 30, cy - 10, [[0, AMB, 0.6], [0.35, AMB, 0.15], [1, AMB, 0]]);
    c.fillRect(cx - 200, cy - 200, 400, 400);
    c.restore();
    stamp(L, cr.c);
    // molten surface and pour
    const rot = (x, y) => ({ x: cx + x * Math.cos(ang) - y * Math.sin(ang), y: cy + x * Math.sin(ang) + y * Math.cos(ang) });
    const lip = rot(-104, -70);
    const hot = sub(L), hg = hot.g;
    hg.save();
    hg.translate(cx, cy); hg.rotate(ang);
    hg.beginPath(); hg.ellipse(-4, -72, 98, 5, 0, 0, TAU);
    hg.fillStyle = linGrad(hg, -100, 0, 100, 0, [[0, '#ffe4a8'], [0.6, '#ff9a34'], [1, '#c24a10']]);
    hg.fill();
    hg.restore();
    const sx0 = lip.x, sy0 = lip.y, sy1 = py - 10;
    hg.fillStyle = linGrad(hg, 0, sy0, 0, sy1, [[0, '#fff0c8'], [0.4, '#ffc060'], [1, '#ff8a2a']]);
    hg.beginPath();
    hg.moveTo(sx0 - 2, sy0);
    hg.quadraticCurveTo(sx0 - 16, sy0 + 8, sx0 - 19, sy1);
    hg.lineTo(sx0 - 13, sy1);
    hg.quadraticCurveTo(sx0 - 10, sy0 + 10, sx0 + 5, sy0);
    hg.fill();
    rect(hg, -296, py - 10, 322, 5, '#ff8a2a', 0.95);
    rect(hg, -296, py - 10, 322, 1.6, '#ffdc98', 0.95);
    for (let x = 60, k = 0; x < 700; x += 70, k++) rect(hg, x + 4, py - 8, 42, 3, k < 3 ? '#ff7a1c' : '#7a2a08', k < 3 ? 0.9 - k * 0.2 : 0.6);
    stamp(L, hot.c);
    soft(L, 3, 6, (gg) => {
      blob(gg, sx0 - 16, (sy0 + sy1) / 2, 60, (sy1 - sy0) * 0.7, AMB, 0.5);
      blob(gg, sx0 - 16, sy1, 120, 34, HOT, 0.55);
      blob(gg, -140, py - 8, 280, 50, AMB, 0.5);
      blob(gg, 160, py - 8, 160, 26, AMB, 0.3);
      blob(gg, cx - 10, cy - 50, 130, 30, HOT, 0.35);
      for (let i = 0; i < 16; i++) blob(gg, -380 + R() * 520, py - 30 - R() * 150, 40 + R() * 80, 20 + R() * 40, '#b0683c', 0.12);
    }, 'lighter');
    // idle crucible, higher, faint residual glow
    const ix = 720, iy = Y(118);
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
    const cols = [-1560, -960, -400, 440, 1000, 1600];
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
    for (const i of [0, 4]) {
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
    for (let x = Math.ceil(L.x0 / 520) * 520 + 130; x < L.x1; x += 520) {
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

  const haze = hazeLayer(W, q, '#744424', -420,
    [[-420, 0], [-300, 0.03], [-190, 0.18], [-90, 0.42], [0, 0.58], [60, 0.58]],
    { n: 34, h: 240, c: '#9a5a2e', a: 0.12 }, R);

  // --- floor: steel plates with warm under-glow seams ------------------------
  const D = 1000;
  const floor = mkFloor(W, D, -56, 1.25 * q);
  {
    const L = floor, g = L.g;
    vfill(L, [[-56, '#4a2a18', 0], [-36, '#2c1a10', 0.85], [-1, '#1a110b', 0.94], [0, '#0d0907', 0.6], [60, '#0c0806', 0.75], [180, '#090605', 0.88], [400, '#060404', 0.95]]);
    // plate texture: scuffs
    soft(L, 1, 1, (gg) => {
      for (let i = 0; i < 900; i++) {
        const x = lerp(L.x0, L.x1, R()), y = -40 + R() * 440;
        rect(gg, x, y, 6 + R() * 50, 0.6 + y / 400, R() < 0.5 ? '#000000' : '#a07050', 0.06);
      }
    });
    soft(L, 2, 4, (gg) => {
      for (let i = 0; i < 30; i++) blob(gg, lerp(L.x0, L.x1, R()), R() * 300, 60 + R() * 140, 6 + R() * 18, '#000000', 0.35);
    });
    // seams (grating gaps) glowing from below
    const rows = [-30, -12, 8, 34, 72, 128, 210, 330];
    const gl = sub(L, 2), gg = gl.g;
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
    blur(gl.c, 4);
    stamp(L, gl.c, 'lighter');
    // hot grate slots: a few brighter vents
    soft(L, 2, 4, (g2) => {
      for (let x = Math.ceil(L.x0 / 660) * 660 + 110; x < L.x1; x += 660) {
        blob(g2, x, 52, 120, 20, '#ff7a24', 0.55);
        rect(g2, x - 60, 50, 120, 3, '#ffc070', 0.9);
      }
      // pools under the catwalk lamps (approximate positions)
      for (let x = Math.ceil(L.x0 / 520) * 520 + 130; x < L.x1; x += 520) blob(g2, x, -8, 200, 30, '#ff9a48', 0.3);
    }, 'lighter');
    grain(L, 0.08);
  }

  const mirrors = [
    [reflection(back, 4, 4), 0.35],
    [reflection(far, 4, 6), 0.35],
    [reflection(mid, 4, 6), 0.35],
    [reflection(near, 4, 6), 0.32],
    [reflection(haze, 2, 2), 0.4],
  ];

  // heat pulse: ground-anchored warm glow
  const heat = fogStrip('#ff7a24', [[0, 0], [0.6, 0.6], [0.85, 1], [1, 0.4]]);
  const heatFx = (ctx, cam, vw, vh, t, sg) => {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.07 + 0.035 * Math.sin(t * 1.1) + 0.02 * Math.sin(t * 2.9 + 1);
    ctx.drawImage(heat, 0, sg - 360 * cam.zoom, vw, 400 * cam.zoom);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };
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
    for (let x = Math.ceil(x0 / 900) * 900; x < x1; x += 900) {
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
    back: [{ L: back }, { L: far }, { L: mid }, { L: shaftL, op: 'lighter', a: 0.5 }, { L: near }, { L: haze }, { fx: heatFx }],
    floorBase: '#070504',
    mirrors,
    floor,
    onFloor: [{ fx: emberFx(60, 21, 2.4, 0.55) }],
    front: [emberFx(16, 911, 3.4, 0.7)],
    fogFront: { c: fogStrip('#a05a2c', [[0, 0], [0.55, 0.8], [0.75, 1], [1, 0]]), up: 200, down: 80, a: 0.1 },
    fgTop, fgBot,
    vignette: vignette(0.72, '#050201'),
  };
  return { id: 'foundry', name: 'FOUNDRY NINE', width: W, palette: pal, reflect: 0.3, ...compose(A) };
}

// ======================================================================
// EXAMINATION HALL
// ======================================================================

function buildHall(q) {
  const R = rng(0x4a11);
  const W = 1900;
  const FOG = '#3a2f56';
  const pal = { key: '#e6eeff', accent: '#e8c77e', fog: FOG, floor: '#07060b', ambient: '#b4a8d8' };
  const ICE = '#dfe8ff', GOLD = '#e8c77e';

  // --- back wall + oculus -------------------------------------------------------
  const back = backLayer(0.03, 0.75 * q, W);
  const OC = { x: 0, sy: 64, r: 250 };
  {
    const L = back, g = L.g, Y = L.Y;
    const oy = Y(OC.sy);
    vfill(L, [[Y(-60), '#020105'], [Y(140), '#07050f'], [Y(320), '#130f24'], [Y(460), '#221b38'], [Y(580), '#2d2548'], [Y(720), '#2c2446']]);
    // wall relief: tall recessed panels
    for (let x = Math.ceil(L.x0 / 150) * 150; x < L.x1; x += 150) {
      if (Math.abs(x) < OC.r + 80) continue;
      g.fillStyle = linGrad(g, 0, Y(-60), 0, Y(520), [[0, '#000000', 0.55], [1, '#000000', 0]]);
      g.fillRect(x - 40, Y(-60), 80, Y(520) - Y(-60));
      rect(g, x + 40, Y(-60), 1.5, Y(500) - Y(-60), '#8a80b8', 0.12);
    }
    soft(L, 4, 8, (gg) => blob(gg, 0, oy, 720, 620, '#5e5490', 0.22), 'lighter');
    // window sky
    g.save();
    g.beginPath(); g.arc(0, oy, OC.r, 0, TAU); g.clip();
    const sky = g.createRadialGradient(0, oy, 20, 0, oy, OC.r);
    sky.addColorStop(0, '#2c2a52'); sky.addColorStop(0.6, '#1c1a3a'); sky.addColorStop(1, '#2e2950');
    g.fillStyle = sky;
    g.fillRect(-OC.r, oy - OC.r, OC.r * 2, OC.r * 2);
    g.fillStyle = col('#ffffff', 0.5);
    for (let i = 0; i < 80; i++) { const a = R() * TAU, r = 90 + R() * 150; g.fillRect(Math.cos(a) * r, oy + Math.sin(a) * r, 1, 1); }
    g.restore();
    // ringed planet arc behind the eclipse
    soft(L, 1, 1, (gg) => {
      gg.save(); gg.translate(0, oy); gg.rotate(-0.22); gg.scale(1, 0.22);
      gg.beginPath(); gg.arc(0, 0, 170, 0, TAU); gg.strokeStyle = col(GOLD, 0.35); gg.lineWidth = 7; gg.stroke();
      gg.beginPath(); gg.arc(0, 0, 150, 0, TAU); gg.strokeStyle = col(GOLD, 0.15); gg.lineWidth = 12; gg.stroke();
      gg.restore();
    }, 'lighter');
    // corona
    soft(L, 2, 4, (gg) => {
      blob(gg, 0, oy, 175, 175, ICE, 0.5, 0.2);
      gg.lineCap = 'round';
      for (let i = 0; i < 70; i++) {
        const a = R() * TAU, l = 70 + R() * 130 * (0.5 + 0.5 * Math.abs(Math.cos(a)));
        gg.strokeStyle = linGrad(gg, Math.cos(a) * 60, oy + Math.sin(a) * 60, Math.cos(a) * l, oy + Math.sin(a) * l, [[0, ICE, 0.55], [1, ICE, 0]]);
        gg.lineWidth = 2 + R() * 6;
        gg.beginPath(); gg.moveTo(Math.cos(a) * 60, oy + Math.sin(a) * 60); gg.lineTo(Math.cos(a) * l, oy + Math.sin(a) * l); gg.stroke();
      }
    }, 'lighter');
    soft(L, 1, 1, (gg) => blob(gg, 0, oy, 92, 92, ICE, 0.95, 0.6), 'lighter');
    g.beginPath(); g.arc(0, oy, 60, 0, TAU); g.fillStyle = '#050309'; g.fill();
    g.beginPath(); g.arc(0, oy, 60.5, -0.9, 0.1); g.strokeStyle = col('#fff4d8', 0.95); g.lineWidth = 2.5; g.stroke();
    soft(L, 1, 2, (gg) => blob(gg, Math.cos(-0.4) * 61, oy + Math.sin(-0.4) * 61, 14, 14, '#fff6e0', 1), 'lighter');
    // the ring re-crosses in front of the disc (bottom half of the ellipse)
    g.save(); g.translate(0, oy); g.rotate(-0.22); g.scale(1, 0.22);
    g.beginPath(); g.arc(0, 0, 170, 0.15, Math.PI - 0.15); g.strokeStyle = col(GOLD, 0.4); g.lineWidth = 7; g.stroke();
    g.restore();
    // frame: annulus, inner ring, spokes
    const fr = sub(L), fg = fr.g;
    fg.fillStyle = linGrad(fg, 0, oy - OC.r - 60, 0, oy + OC.r + 60, [[0, '#08060f'], [1, '#141026']]);
    fg.beginPath(); fg.arc(0, oy, OC.r + 54, 0, TAU); fg.arc(0, oy, OC.r, 0, TAU, true); fg.fill('evenodd');
    fg.strokeStyle = col('#0a0812'); fg.lineWidth = 7;
    fg.beginPath(); fg.arc(0, oy, 124, 0, TAU); fg.stroke();
    fg.lineWidth = 3;
    fg.beginPath(); fg.arc(0, oy, 182, 0, TAU); fg.stroke();
    fg.lineWidth = 8;
    fg.beginPath();
    for (let k = 0; k < 16; k++) { const a = k / 16 * TAU + 0.1; fg.moveTo(Math.cos(a) * 124, oy + Math.sin(a) * 124); fg.lineTo(Math.cos(a) * (OC.r + 2), oy + Math.sin(a) * (OC.r + 2)); }
    fg.stroke();
    // gold inlay + ice rim
    fg.beginPath(); fg.arc(0, oy, OC.r + 30, 0, TAU); fg.strokeStyle = col(GOLD, 0.35); fg.lineWidth = 1.5; fg.stroke();
    fg.beginPath(); fg.arc(0, oy, OC.r + 1, 0.2, Math.PI - 0.2); fg.strokeStyle = col(ICE, 0.45); fg.lineWidth = 2; fg.stroke();
    fg.beginPath(); fg.arc(0, oy, 126, 0.3, Math.PI - 0.3); fg.strokeStyle = col(ICE, 0.35); fg.lineWidth = 1.5; fg.stroke();
    stamp(L, fr.c);
    grain(L, 0.06, false);
  }
  const ocScreen = (cam, vw, vh, out) => layerToScreen(back, OC.x, back.Y(OC.sy), cam, vw, vh, out);

  // --- pillar rows ----------------------------------------------------------
  const pillarRow = (p, res, spacing, w, gap, opts) => {
    const L = backLayer(p, res * q, W), Y = L.Y;
    const s = sub(L), g = s.g;
    const xs = [];
    for (let x = Math.ceil(L.x0 / spacing) * spacing + (opts.off || 0); x < L.x1; x += spacing) if (Math.abs(x) > gap) xs.push(x);
    if (opts.xs) xs.splice(0, xs.length, ...opts.xs);
    for (const x of xs) {
      const lit = x < 0 ? 1 : -1;
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
        if (Math.abs(bx) < gap + 60) continue;
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
    stamp(L, s.c);
    grain(L, 0.05);
    snapshot(L, [[Y(opts.fog[1]), FOG, 0], [Y(opts.fog[2] + 60), FOG, 0.45]]);
    vfill(L, [[Y(opts.fog[0]), FOG, 0], [Y(opts.fog[1]), FOG, 0.6], [Y(opts.fog[2]), FOG, opts.fogMax ?? 0.95]], 'source-atop');
    return L;
  };
  const far = pillarRow(0.12, 0.6, 230, 60, 330, {
    dark: '#17122a', body: '#211a3a', rim: '#4e4680', cap: 10, beam: 40, fog: [120, 360, 520], fogMax: 0.92, off: 115 });
  soft(far, 3, 4, (g) => { // a hazy wash so the far row recedes
    vfill(far, [[far.Y(-60), FOG, 0.25], [far.Y(300), FOG, 0.4]], 'source-over', g);
  }, 'source-atop');
  const mid = pillarRow(0.3, 0.75, 400, 100, 360, {
    dark: '#0b0816', body: '#130e24', rim: '#7d76b0', cap: -20, beam: 0, fog: [180, 380, 530],
    banners: { w: 70, end: 250 } });
  const near = pillarRow(0.6, 0.9, 760, 170, 380, {
    dark: '#030206', body: '#07050c', rim: '#a8a2d4', cap: -60, beam: -40, fog: [200, 360, 520], xs: [-1340, -560, 560, 1340], drape: 210 });

  const haze = hazeLayer(W, q, '#51447a', -420,
    [[-420, 0], [-280, 0.1], [-150, 0.32], [-40, 0.52], [0, 0.58], [60, 0.58]],
    { n: 30, h: 250, c: '#7a70a8', a: 0.1 }, R);

  // --- floor: polished obsidian --------------------------------------------------
  const D = 1300;
  const floor = mkFloor(W, D, -60, 1.25 * q);
  const pools = [-480, -170, 170, 480];
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

  const mirrors = [
    [reflection(back, 2, 3), 0.75],
    [reflection(far, 2, 3), 0.75],
    [reflection(mid, 2, 3), 0.75],
    [reflection(near, 2, 3), 0.7],
    [reflection(haze, 1, 2), 0.7],
  ];

  // light shafts: oculus (far) to floor pools (play plane), drawn as sheared textures
  const shaftTex = (() => {
    const { c, g } = mk(128, 512);
    g.fillStyle = linGrad(g, 0, 0, 0, 512, [[0, '#ffffff', 0], [0.1, '#ffffff', 0.9], [0.3, '#ffffff', 0.55], [0.7, '#ffffff', 0.28], [1, '#ffffff', 0.45]]);
    poly(g, [50, 0, 78, 0, 120, 512, 8, 512]);
    g.fill();
    blur(c, 8, 2);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#d8e2ff';
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
  const shafts = pools.map((x, i) => ({ fx: x, ox: [-110, -42, 42, 110][i], oy: 120 + Math.abs([-110, -42, 42, 110][i]) * -0.3, a: [0.16, 0.2, 0.2, 0.16][i] }));
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
  for (let i = 0; i < 64; i++) motes.push({ s: i % 4, u: R(), v: 0.1 + R() * 0.85, sp: 0.004 + R() * 0.01, ph: R() * TAU, sz: 1 + R() * 1.6 });
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
    back: [{ L: back }, { L: far }, { L: mid }, { L: near }, { L: haze }],
    floorBase: '#030206',
    mirrors,
    floor,
    onFloor: [{ fx: (ctx, cam, vw, vh, t, sg) => drawShafts(ctx, cam, vw, vh, sg, 1.5) }],
    front: [(ctx, cam, vw, vh, t, sg) => drawShafts(ctx, cam, vw, vh, sg, 0.22), moteFx],
    fogFront: { c: fogStrip('#6a5c98', [[0, 0], [0.55, 0.8], [0.75, 1], [1, 0]]), up: 200, down: 80, a: 0.09 },
    fgTop, fgBot,
    vignette: vignette(0.75, '#020106'),
  };
  return { id: 'hall', name: 'EXAMINATION HALL', width: W, palette: pal, reflect: 0.75, ...compose(A) };
}

// ======================================================================

const BUILDERS = { causeway: buildCauseway, foundry: buildFoundry, hall: buildHall };

export function buildArena(id, opts = {}) {
  const b = BUILDERS[id];
  if (!b) throw new Error(`unknown arena: ${id}`);
  const q = clamp(opts.quality ?? 1, 0.25, 1);
  return b(q);
}
