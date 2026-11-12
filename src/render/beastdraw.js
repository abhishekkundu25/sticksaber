// Drawing for animal bodies (src/game/beasts.js). The caller has set world space, round caps and
// joins, and the alpha. Every beast is drawn the same way as the stick figures: near-black body, a thin
// rim in its colour, the far side dimmer. To keep the calls few, each body is drawn in four passes:
//   1. far limbs and far parts, rim then body, at half rim strength
//   2. near limbs, rim only (wide strokes)
//   3. every filled shape in one path (torso, neck, head, tail, wedges of muscle, ears, horns): rim
//      stroke, then body fill, which hides every inner outline
//   4. near limbs again in body colour, then thin rim-coloured accents
// No gradients, no allocation: every point goes straight into the path.
import { TAU } from '../core/math.js';
import { glowSprite } from './fx.js';

const RIM = 2.6;
let S = 1, FX = 1, HC = 1, HS = 0, HX = 0, HY = 0, HLen = 1, HRad = 1;
let UX = 1, UY = 0, NX = 0, NY = -1, SL = 1, OX = 0, OY = 0, G = 1;
const Q = new Float32Array(64); // scratch points for smooth outlines

// ───────────── frames ─────────────
// Head frame: a along the head in head lengths, b up in head radii; origin at the eye (joint 0).
function headFrame(f) {
  const B = f.B;
  S = f.scale; FX = f.facing * f.xm; HC = Math.cos(f.hdA); HS = Math.sin(f.hdA); HX = f.j[0]; HY = f.j[1]; HLen = B.head * S; HRad = B.headR * S;
}
const hx = (a, b) => HX + (HC * a * HLen - HS * b * HRad) * FX;
const hy = (a, b) => HY - (HS * a * HLen + HC * b * HRad);
// Spine frame: a from the hip (0) to the shoulder (1), b up in girths.
function spineFrame(f) {
  const j = f.j;
  OX = j[4]; OY = j[5];
  const dx = j[2] - j[4], dy = j[3] - j[5];
  SL = Math.hypot(dx, dy) || 1; UX = dx / SL; UY = dy / SL;
  NX = UY * f.facing; NY = -UX * f.facing;
  G = f.B.girth * f.scale;
}
const sx = (a, b) => OX + UX * a * SL + NX * b * G;
const sy = (a, b) => OY + UY * a * SL + NY * b * G;

// ───────────── path helpers ─────────────
// Every filled subpath goes into one path that is filled once with the nonzero rule. Two overlapping
// subpaths wound in opposite directions would cancel and leave a hole, so every polygon is emitted
// clockwise on screen, whichever way the animal faces (arcs are clockwise already).
function emit(ctx, n, curved) {
  let area = 0;
  for (let i = 0, k = n - 1; i < n; k = i++) area += Q[k * 2] * Q[i * 2 + 1] - Q[i * 2] * Q[k * 2 + 1];
  const rev = area < 0, at = (i) => (rev ? (n - i) % n : i) * 2;
  if (!curved) {
    ctx.moveTo(Q[at(0)], Q[at(0) + 1]);
    for (let i = 1; i < n; i++) ctx.lineTo(Q[at(i)], Q[at(i) + 1]);
  } else {
    // A smooth closed outline through the points (midpoint quadratics).
    const l = at(n - 1), z = at(0);
    ctx.moveTo((Q[l] + Q[z]) / 2, (Q[l + 1] + Q[z + 1]) / 2);
    for (let i = 0; i < n; i++) {
      const a = at(i), b = at((i + 1) % n);
      ctx.quadraticCurveTo(Q[a], Q[a + 1], (Q[a] + Q[b]) / 2, (Q[a + 1] + Q[b + 1]) / 2);
    }
  }
  ctx.closePath();
}
let QN = 0;
const qp = (x, y) => { Q[QN * 2] = x; Q[QN * 2 + 1] = y; QN++; };
const tri = (ctx, x0, y0, x1, y1, x2, y2) => { QN = 0; qp(x0, y0); qp(x1, y1); qp(x2, y2); emit(ctx, 3, false); };
const htri = (ctx, a0, b0, a1, b1, a2, b2) => tri(ctx, hx(a0, b0), hy(a0, b0), hx(a1, b1), hy(a1, b1), hx(a2, b2), hy(a2, b2));
function torso(ctx, f) {
  const t = f.B.torso, n = t.length >> 1;
  QN = 0;
  for (let i = 0; i < n; i++) qp(sx(t[i * 2], t[i * 2 + 1]), sy(t[i * 2], t[i * 2 + 1]));
  emit(ctx, n, true);
}
// Head outline from [a, b] pairs. `sharp` keeps the corners (snouts and beaks).
function headPoly(ctx, pts, sharp, ka = 1) {
  const n = pts.length >> 1;
  QN = 0;
  for (let i = 0; i < n; i++) qp(hx(pts[i * 2] * ka, pts[i * 2 + 1]), hy(pts[i * 2] * ka, pts[i * 2 + 1]));
  emit(ctx, n, !sharp);
}
// The lower jaw, swung open about its hinge by `open` radians.
function jaw(ctx, pts, open, ka = 1) {
  const n = pts.length >> 1, ha = pts[0] * HLen * ka, hb = pts[1] * HRad, c = Math.cos(-open), s = Math.sin(-open);
  QN = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i * 2] * HLen * ka - ha, b = pts[i * 2 + 1] * HRad - hb;
    const ra = ha + a * c - b * s, rb = hb + a * s + b * c;
    qp(HX + (HC * ra - HS * rb) * FX, HY - (HS * ra + HC * rb));
  }
  emit(ctx, n, false);
}
// A four-sided wedge of muscle from (x0, y0) to (x1, y1), w0 wide at the start and w1 at the end.
function wedge(ctx, x0, y0, x1, y1, w0, w1) {
  const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d;
  QN = 0; qp(x0 + nx * w0, y0 + ny * w0); qp(x1 + nx * w1, y1 + ny * w1); qp(x1 - nx * w1, y1 - ny * w1); qp(x0 - nx * w0, y0 - ny * w0);
  emit(ctx, 4, false);
}
// A tapered band along n points of `p` (from index o), half-width w0 at the root and w1 at the tip.
// `bulge` adds width in the middle (a bushy tail, a fat abdomen).
function taper(ctx, p, o, n, w0, w1, bulge = 0) {
  QN = 0;
  for (let side = 0; side < 2; side++) {
    for (let q = 0; q < n; q++) {
      const i = side ? n - 1 - q : q, a = o + Math.max(0, i - 1) * 2, b = o + Math.min(n - 1, i + 1) * 2;
      const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], d = Math.hypot(dx, dy) || 1, k = i / (n - 1);
      const w = (w0 + (w1 - w0) * k + bulge * Math.sin(Math.PI * k)) * (side ? -1 : 1);
      qp(p[o + i * 2] - (dy / d) * w, p[o + i * 2 + 1] + (dx / d) * w);
    }
  }
  emit(ctx, QN, false);
}
function circle(ctx, x, y, r) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
function ellipse(ctx, x, y, rx, ry, a) { ctx.moveTo(x + Math.cos(a) * rx, y + Math.sin(a) * rx); ctx.ellipse(x, y, rx, ry, a, 0, TAU); }
function bone(ctx, j, a, b, c) { ctx.moveTo(j[a * 2], j[a * 2 + 1]); ctx.lineTo(j[b * 2], j[b * 2 + 1]); ctx.lineTo(j[c * 2], j[c * 2 + 1]); }
// A foot stub forward from a joint, along the floor.
function toe(ctx, j, k, len) { const x = j[k * 2], y = j[k * 2 + 1]; ctx.moveTo(x, y); ctx.lineTo(x + FX * len, Math.min(-1, y + len * 0.15)); }
function extraLegs(ctx, f, side) {
  const B = f.B, xl = f.xl;
  for (let i = 0; i < B.xn; i++) {
    if (B.xs[i] !== side) continue;
    const o = i * 6;
    ctx.moveTo(xl[o], xl[o + 1]); ctx.lineTo(xl[o + 2], xl[o + 3]); ctx.lineTo(xl[o + 4], xl[o + 5]);
  }
}
// Spikes along the top of the spine between a0 and a1 (hackles, bristles, quills, plates).
function spikes(ctx, a0, a1, n, base, h, lean) {
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * (i + 0.5)) / n, w = ((a1 - a0) / n) * 0.55;
    tri(ctx, sx(a - w, base), sy(a - w, base), sx(a - lean, base + h), sy(a - lean, base + h), sx(a + w, base), sy(a + w, base));
  }
}
function strokeTwice(ctx, rim, body, lw, alpha, rimA) {
  ctx.globalAlpha = alpha * rimA; ctx.strokeStyle = rim; ctx.lineWidth = lw + RIM; ctx.stroke();
  ctx.globalAlpha = alpha; ctx.strokeStyle = body; ctx.lineWidth = lw; ctx.stroke();
}
function fillRim(ctx, rim, body, alpha, rimA) {
  ctx.globalAlpha = alpha * rimA; ctx.strokeStyle = rim; ctx.lineWidth = RIM; ctx.stroke();
  ctx.globalAlpha = alpha; ctx.fillStyle = body; ctx.fill();
}

// ───────────── heads ─────────────
const H = {
  canine: [-0.35, 0.55, -0.1, 1.0, 0.3, 0.9, 0.55, 0.5, 1.0, 0.32, 1.06, -0.05, 0.96, -0.3, 0.3, -0.35, -0.2, -0.85, -0.42, -0.2],
  canineJaw: [0.1, -0.35, 0.95, -0.3, 0.85, -0.62, 0.2, -0.85],
  bovine: [-0.35, 0.7, 0.05, 1.0, 0.55, 0.8, 1.0, 0.45, 1.1, -0.1, 1.0, -0.55, 0.6, -0.75, 0.0, -0.95, -0.35, -0.4],
  boar: [-0.3, 0.8, 0.2, 0.95, 1.02, 0.38, 1.12, 0.1, 1.12, -0.32, 0.85, -0.55, 0.1, -0.9, -0.35, -0.3],
  rhino: [-0.35, 0.75, 0.1, 0.95, 0.6, 0.7, 1.05, 0.25, 1.12, -0.25, 0.8, -0.7, 0.05, -0.95, -0.35, -0.35],
  saurian: [-0.35, 0.6, 0.1, 0.85, 0.6, 0.55, 1.05, 0.2, 1.1, -0.05, 0.4, -0.3, -0.2, -0.65, -0.4, -0.1],
  saurJaw: [0.05, -0.3, 1.0, -0.1, 0.92, -0.42, 0.15, -0.7],
  spider: [-0.45, 0.4, -0.1, 0.95, 0.5, 0.85, 0.95, 0.2, 0.85, -0.55, 0.2, -0.9, -0.4, -0.5],
  scorp: [-0.6, 0.55, 0.1, 0.7, 0.9, 0.35, 1.0, -0.2, 0.6, -0.6, -0.4, -0.6],
  bat: [-0.5, 0.5, 0.0, 1.0, 0.55, 0.65, 0.95, 0.15, 0.9, -0.35, 0.3, -0.75, -0.4, -0.55],
  hawk: [-0.55, 0.45, -0.05, 1.0, 0.5, 0.75, 0.75, 0.25, 0.7, -0.45, 0.1, -0.8, -0.45, -0.5],
  beak: [0.5, 0.45, 1.25, 0.1, 1.15, -0.45, 0.85, -0.2, 0.6, -0.35],
  moth: [-0.45, 0.65, 0.1, 1.0, 0.75, 0.6, 0.9, -0.1, 0.5, -0.7, -0.3, -0.65],
  ape: [-0.55, 0.45, -0.3, 0.95, 0.2, 1.05, 0.55, 0.55, 0.65, 0.25, 0.95, 0.05, 1.0, -0.45, 0.6, -0.85, -0.05, -0.95, -0.5, -0.45],
  toad: [-0.35, 0.7, 0.2, 0.95, 0.8, 0.7, 1.05, 0.15, 0.95, -0.3, 0.2, -0.45, -0.35, -0.5],
  toadJaw: [0.1, -0.35, 0.98, -0.25, 0.85, -0.7, 0.1, -0.95],
  lizard: [-0.35, 0.6, 0.15, 0.8, 0.7, 0.5, 1.08, 0.12, 1.1, -0.15, 0.4, -0.35, -0.3, -0.55],
  lizJaw: [0.1, -0.33, 1.05, -0.15, 0.95, -0.5, 0.15, -0.75],
};
function ears(ctx, B) {
  const L = B.earLen;
  const e = (a0, b0, a1, b1, a2, b2) => tri(ctx, hx(a0, b0), hy(a0, b0), hx(a1, b1), hy(a1, b1), hx(a2, b2), hy(a2, b2));
  if (B.ears === 'pointed') e(-0.22, 0.75, -0.38, 0.9 + 1.25 * L, 0.08, 0.88);
  else if (B.ears === 'tall') e(-0.3, 0.7, -0.4, 1.0 + 1.8 * L, 0.05, 0.9);
  else if (B.ears === 'folded') e(-0.1, 0.85, -0.55, 1.15, -0.62, 0.25);
  else if (B.ears === 'side') e(-0.15, 0.55, -0.7, 0.95, -0.25, 0.25);
}
// The dark part of a horn or tusk under the glowing weapon line, and a darker twin on the far side.
function hornShape(ctx, f, w, ox, oy) {
  wedge(ctx, f.bx + ox, f.by + oy, f.tx + ox, f.ty + oy, w, w * 0.22);
}

// ───────────── plans ─────────────
function quadLegs(ctx, f, near) {
  const j = f.j, tl = f.legLen * f.scale * 0.13;
  if (near) { bone(ctx, j, 1, 3, 4); bone(ctx, j, 2, 7, 8); toe(ctx, j, 4, tl); toe(ctx, j, 8, tl); }
  else { bone(ctx, j, 1, 5, 6); bone(ctx, j, 2, 9, 10); toe(ctx, j, 6, tl); toe(ctx, j, 10, tl); }
}
function tailShape(ctx, f, bulge = 0) {
  const T = f.B.tail;
  if (T.n) taper(ctx, f.tl, 0, T.n + 1, T.w0 * f.scale, T.w1 * f.scale, bulge * f.scale);
}

function hound(ctx, f, rim, body, a) {
  const B = f.B, j = f.j, s = f.scale, lw = B.lw * s;
  spineFrame(f); headFrame(f);
  ctx.beginPath(); quadLegs(ctx, f, false); strokeTwice(ctx, rim, body, lw * 0.9, a, 0.5);
  ctx.beginPath(); quadLegs(ctx, f, true); ctx.globalAlpha = a; ctx.strokeStyle = rim; ctx.lineWidth = lw + RIM; ctx.stroke();
  ctx.beginPath();
  torso(ctx, f);
  tailShape(ctx, f, B.tail.w1 > 2.4 ? 1.5 : 0);
  wedge(ctx, j[2], j[3] + G * 0.1, j[6], j[7], G * 0.55, lw * 0.6);
  wedge(ctx, j[4], j[5], j[14], j[15], G * 0.6, lw * 0.65);
  wedge(ctx, j[2], j[3], hx(-0.2, 0), hy(-0.2, 0), G * 0.6, HRad * 0.85);
  headPoly(ctx, H.canine, true, B.snout); jaw(ctx, H.canineJaw, f.p[6] * 0.6, B.snout);
  ears(ctx, B);
  if (B.ruff) for (let i = 0; i < 4; i++) { const k = 0.15 + i * 0.2, x = j[2] + (hx(-0.3, 0) - j[2]) * k, y = j[3] + (hy(-0.3, 0) - j[3]) * k; tri(ctx, x + NX * G * 0.4 - UX * 4 * s, y + NY * G * 0.4 - UY * 4 * s, x + NX * G * 0.95 - UX * 9 * s, y + NY * G * 0.95 - UY * 9 * s, x - UX * 1 * s, y - UY * 1 * s); }
  if (B.hackles) spikes(ctx, 0.25, 0.95, 5, 0.42, 0.42, 0.06);
  fillRim(ctx, rim, body, a, 1);
  ctx.beginPath(); quadLegs(ctx, f, true); ctx.strokeStyle = body; ctx.lineWidth = lw; ctx.stroke();
}

function charger(ctx, f, rim, body, a) {
  const B = f.B, j = f.j, s = f.scale, lw = B.lw * s, tl = f.legLen * s * 0.1;
  spineFrame(f); headFrame(f);
  // Far side: legs, far horn or tusk.
  ctx.beginPath(); quadLegs(ctx, f, false); strokeTwice(ctx, rim, body, lw * 0.9, a, 0.5);
  if (B.weapon === 'horn' || B.weapon === 'tusk') { ctx.beginPath(); hornShape(ctx, f, (B.weapon === 'tusk' ? 2.4 : 3.8) * s, -FX * 4 * s, -2 * s); fillRim(ctx, rim, body, a, 0.5); }
  ctx.beginPath(); quadLegs(ctx, f, true); ctx.globalAlpha = a; ctx.strokeStyle = rim; ctx.lineWidth = lw + RIM; ctx.stroke();
  ctx.beginPath();
  torso(ctx, f);
  if (B.tail.n) { tailShape(ctx, f); if (B.tail.tuft) { const n = B.tail.n * 2; ellipse(ctx, f.tl[n], f.tl[n + 1], 3.2 * s, 6 * s, Math.atan2(f.tl[n + 1] - f.tl[n - 1], f.tl[n] - f.tl[n - 2])); } }
  wedge(ctx, j[2], j[3] + G * 0.2, j[6], j[7], G * 0.5, lw * 0.6);
  wedge(ctx, j[4], j[5], j[14], j[15], G * 0.62, lw * 0.6);
  wedge(ctx, j[2] - UX * G * 0.2, j[3] - UY * G * 0.2, hx(-0.2, 0), hy(-0.2, 0), G * 0.75, HRad * 0.95);
  headPoly(ctx, B.kind === 'boar' ? H.boar : B.kind === 'rhino' ? H.rhino : H.bovine, true);
  ears(ctx, B);
  if (B.weapon === 'horn' || B.weapon === 'tusk') hornShape(ctx, f, (B.weapon === 'tusk' ? 2.4 : 3.8) * s, 0, 0);
  if (B.kind === 'rhino' && B.horn2) wedge(ctx, hx(0.45, 0.85), hy(0.45, 0.85), hx(0.3, 1.9), hy(0.3, 1.9), 3 * s, 0.6 * s);
  if (B.mane) spikes(ctx, 0.55, 1.05, 5, 0.55 + B.hump * 0.35, 0.45, 0.08);
  // Hooves: a short dark block at each near foot.
  wedge(ctx, j[8] - FX * 2 * s, j[9] + 1, j[8] + FX * tl, j[9] + 1, lw * 0.65, lw * 0.5);
  wedge(ctx, j[16] - FX * 2 * s, j[17] + 1, j[16] + FX * tl, j[17] + 1, lw * 0.65, lw * 0.5);
  fillRim(ctx, rim, body, a, 1);
  ctx.beginPath(); quadLegs(ctx, f, true); ctx.strokeStyle = body; ctx.lineWidth = lw; ctx.stroke();
  // Rim-coloured details: a ram's curl, an elk's antlers, the nostril.
  ctx.beginPath();
  if (B.curl) { const cx = hx(-0.15, 0.35), cy = hy(-0.15, 0.35), r = HRad * 0.75 * B.curl; ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU * 0.8); ctx.moveTo(cx + r * 0.45, cy); ctx.arc(cx, cy, r * 0.45, 0, TAU * 0.6); }
  if (B.antlers) {
    const k = B.antlers;
    for (let sd = 0; sd < 2; sd++) {
      const o = sd ? -0.2 : 0;
      ctx.moveTo(hx(0.05 + o, 0.9), hy(0.05 + o, 0.9)); ctx.lineTo(hx(-0.3 + o, 2.3 * k), hy(-0.3 + o, 2.3 * k)); ctx.lineTo(hx(-0.9 + o, 3.3 * k), hy(-0.9 + o, 3.3 * k));
      ctx.moveTo(hx(-0.2 + o, 1.8 * k), hy(-0.2 + o, 1.8 * k)); ctx.lineTo(hx(0.25 + o, 2.7 * k), hy(0.25 + o, 2.7 * k));
      ctx.moveTo(hx(-0.6 + o, 2.8 * k), hy(-0.6 + o, 2.8 * k)); ctx.lineTo(hx(-0.4 + o, 3.6 * k), hy(-0.4 + o, 3.6 * k));
    }
  }
  ctx.globalAlpha = a; ctx.strokeStyle = rim; ctx.lineWidth = 2.2 * s; ctx.stroke();
}

function raptor(ctx, f, rim, body, a) {
  const B = f.B, j = f.j, s = f.scale, lw = B.lw * s, tl = 9 * s;
  spineFrame(f); headFrame(f);
  ctx.beginPath(); bone(ctx, j, 2, 9, 10); toe(ctx, j, 10, tl); ctx.moveTo(j[2], j[3]); ctx.lineTo(j[10], j[11]); ctx.lineTo(j[12], j[13]);
  strokeTwice(ctx, rim, body, lw * 0.9, a, 0.5);
  ctx.beginPath(); bone(ctx, j, 2, 7, 8); toe(ctx, j, 8, tl); bone(ctx, j, 1, 3, 4); ctx.globalAlpha = a; ctx.strokeStyle = rim; ctx.lineWidth = lw + RIM; ctx.stroke();
  ctx.beginPath();
  torso(ctx, f);
  tailShape(ctx, f);
  wedge(ctx, j[4] + UX * G * 0.3, j[5] + UY * G * 0.3, j[14], j[15], G * 0.75, lw * 0.55);
  // The S of the neck: a bend forward between the shoulder and the head.
  const mx = (j[2] + j[0]) / 2 + FX * B.neck * 0.16 * s, my = (j[3] + j[1]) / 2 + B.neck * 0.05 * s;
  wedge(ctx, j[2], j[3], mx, my, G * 0.6, G * 0.42); wedge(ctx, mx, my, hx(-0.2, 0), hy(-0.2, 0), G * 0.42, HRad * 0.8);
  circle(ctx, mx, my, G * 0.42);
  headPoly(ctx, H.saurian, true); jaw(ctx, H.saurJaw, f.p[6] * 0.7);
  if (B.crest === 'fin') htri(ctx, -0.1, 0.8, -0.65, 2.3, -0.45, 0.4);
  if (B.crest === 'horns') { htri(ctx, 0.15, 0.7, 0.0, 1.6, -0.1, 0.75); htri(ctx, -0.25, 0.6, -0.45, 1.4, -0.45, 0.5); }
  if (B.quills) spikes(ctx, -0.25, 0.85, 5, 0.38, 0.55, 0.12);
  fillRim(ctx, rim, body, a, 1);
  ctx.beginPath(); bone(ctx, j, 2, 7, 8); toe(ctx, j, 8, tl); bone(ctx, j, 1, 3, 4); ctx.strokeStyle = body; ctx.lineWidth = lw; ctx.stroke();
  // Sickle claws held up off the floor, feathers.
  ctx.beginPath();
  for (const k of [8, 10]) { const x = j[k * 2], y = j[k * 2 + 1]; ctx.moveTo(x + FX * 2 * s, y - 1); ctx.quadraticCurveTo(x + FX * 4 * s, y - 9 * s, x + FX * 9 * s, y - 7 * s); }
  if (B.crest === 'feathers') for (let i = 0; i < 4; i++) { ctx.moveTo(hx(-0.2 - i * 0.12, 0.7), hy(-0.2 - i * 0.12, 0.7)); ctx.lineTo(hx(-0.9 - i * 0.2, 1.4 + i * 0.25), hy(-0.9 - i * 0.2, 1.4 + i * 0.25)); }
  if (B.armFeathers) { const x = j[6], y = j[7]; for (let i = 0; i < 3; i++) { ctx.moveTo(x, y); ctx.lineTo(x - FX * (7 + i * 3) * s, y + (3 + i * 3) * s); } }
  ctx.globalAlpha = a; ctx.strokeStyle = rim; ctx.lineWidth = 1.8 * s; ctx.stroke();
}

function stalker(ctx, f, rim, body, a) {
  const B = f.B, j = f.j, s = f.scale, lw = B.lw * s;
  spineFrame(f); headFrame(f);
  ctx.beginPath(); bone(ctx, j, 1, 5, 6); bone(ctx, j, 2, 9, 10); extraLegs(ctx, f, 1); strokeTwice(ctx, rim, body, lw * 0.85, a, 0.5);
  ctx.beginPath(); bone(ctx, j, 1, 3, 4); bone(ctx, j, 2, 7, 8); extraLegs(ctx, f, 0); ctx.globalAlpha = a; ctx.strokeStyle = rim; ctx.lineWidth = lw + RIM; ctx.stroke();
  ctx.beginPath();
  torso(ctx, f);
  const ar = B.abdomen * s, ax = j[4] - UX * ar * 0.85, ay = j[5] - UY * ar * 0.85 - ar * 0.15, ang = Math.atan2(UY, UX) + (f.facing > 0 ? 0.25 : -0.25);
  ellipse(ctx, ax, ay, ar * B.abdK, ar * 0.82, ang);
  if (B.spikes) for (let i = 0; i < 4; i++) {
    const k = -0.6 + i * 0.4, px = ax + UX * ar * B.abdK * k + NX * ar * 0.75 * Math.sqrt(1 - k * k), py = ay + UY * ar * B.abdK * k + NY * ar * 0.75 * Math.sqrt(1 - k * k);
    tri(ctx, px - UX * 3 * s, py - UY * 3 * s, px + NX * 8 * s - UX * 2 * s, py + NY * 8 * s - UY * 2 * s, px + UX * 3 * s, py + UY * 3 * s);
  }
  headPoly(ctx, H.spider, false);
  // Fangs: two hooks under the head (the near one glows).
  htri(ctx, 0.55, -0.4, 0.95, -1.3, 0.8, -0.35);
  fillRim(ctx, rim, body, a, 1);
  ctx.beginPath(); bone(ctx, j, 1, 3, 4); bone(ctx, j, 2, 7, 8); extraLegs(ctx, f, 0); ctx.strokeStyle = body; ctx.lineWidth = lw; ctx.stroke();
  if (B.mark !== 'none') {
    ctx.beginPath();
    if (B.mark === 'stripe') for (let i = 0; i < 3; i++) { const k = -0.5 + i * 0.5; ctx.moveTo(ax + UX * ar * k - NX * ar * 0.5, ay + UY * ar * k - NY * ar * 0.5); ctx.lineTo(ax + UX * ar * k + NX * ar * 0.6, ay + UY * ar * k + NY * ar * 0.6); }
    else if (B.mark === 'hourglass') { const r = ar * 0.35; ctx.moveTo(ax - r, ay - r); ctx.lineTo(ax + r, ay + r); ctx.lineTo(ax - r, ay + r); ctx.lineTo(ax + r, ay - r); ctx.closePath(); }
    else for (let i = 0; i < 3; i++) { const k = -0.55 + i * 0.4; ctx.moveTo(ax + UX * ar * (k - 0.15) + NX * ar * 0.55, ay + UY * ar * (k - 0.15) + NY * ar * 0.55); ctx.lineTo(ax + UX * ar * k + NX * ar * 0.2, ay + UY * ar * k + NY * ar * 0.2); ctx.lineTo(ax + UX * ar * (k - 0.15) - NX * ar * 0.15, ay + UY * ar * (k - 0.15) - NY * ar * 0.15); }
    ctx.globalAlpha = a * 0.7; ctx.strokeStyle = rim; ctx.lineWidth = 1.6 * s; ctx.stroke();
  }
}

function scorpion(ctx, f, rim, body, a) {
  const B = f.B, j = f.j, s = f.scale, lw = B.lw * s, open = f.p[6];
  spineFrame(f); headFrame(f);
  ctx.beginPath(); bone(ctx, j, 2, 9, 10); extraLegs(ctx, f, 1); strokeTwice(ctx, rim, body, lw * 0.8, a, 0.5);
  ctx.beginPath(); bone(ctx, j, 1, 5, 6); strokeTwice(ctx, rim, body, lw * 1.2, a, 0.5);
  ctx.beginPath(); claw(ctx, f, 12, 10, open, 0.85); fillRim(ctx, rim, body, a, 0.5);
  ctx.beginPath(); bone(ctx, j, 2, 7, 8); extraLegs(ctx, f, 0); ctx.globalAlpha = a; ctx.strokeStyle = rim; ctx.lineWidth = lw + RIM; ctx.stroke();
  ctx.beginPath();
  torso(ctx, f);
  const T = B.tail, tl = f.tl;
  taper(ctx, tl, 0, T.n + 1, T.w0 * s, T.w1 * s);
  for (let i = 1; i < T.n; i++) circle(ctx, tl[i * 2], tl[i * 2 + 1], (T.w0 + (T.w1 - T.w0) * (i / T.n)) * s * 1.18);
  const n = T.n * 2, ba = Math.atan2(tl[n + 1] - tl[n - 1], tl[n] - tl[n - 2]);
  ellipse(ctx, tl[n], tl[n + 1], T.w1 * s * 2.0, T.w1 * s * 1.5, ba);
  wedge(ctx, j[2], j[3], j[6], j[7], lw * 1.1, lw * 0.9);
  wedge(ctx, j[6], j[7], j[8], j[9], lw * 0.9, lw * 0.8);
  claw(ctx, f, 8, 6, open, 1);
  headPoly(ctx, H.scorp, false);
  fillRim(ctx, rim, body, a, 1);
  ctx.beginPath(); bone(ctx, j, 2, 7, 8); extraLegs(ctx, f, 0); ctx.strokeStyle = body; ctx.lineWidth = lw; ctx.stroke();
  if (B.plates) {
    ctx.beginPath();
    for (let i = 0; i < 4; i++) { const k = 0.1 + i * 0.25; ctx.moveTo(sx(k, 0.15), sy(k, 0.15)); ctx.lineTo(sx(k + 0.06, 0.6), sy(k + 0.06, 0.6)); }
    ctx.globalAlpha = a * 0.75; ctx.strokeStyle = rim; ctx.lineWidth = 1.4 * s; ctx.stroke();
  }
}
// A pincer at the hand joint: a fixed lower jaw and an upper jaw that opens.
function claw(ctx, f, hi, ei, open, k) {
  const j = f.j, s = f.scale, B = f.B, x = j[hi], y = j[hi + 1];
  const dx = x - j[ei], dy = y - j[ei + 1], d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
  const nx = uy * f.facing, ny = -ux * f.facing, L = B.claw * s * k, W = L * 0.42;
  ellipse(ctx, x + ux * L * 0.15, y + uy * L * 0.15, L * 0.5, W, Math.atan2(uy, ux));
  const o = 0.25 + open * 0.55, c = Math.cos(o), sn = Math.sin(o);
  const ax = ux * c + nx * sn, ay = uy * c + ny * sn, bx = ux * c - nx * sn, by = uy * c - ny * sn;
  const ox = x + ux * L * 0.5, oy = y + uy * L * 0.5;
  QN = 0; qp(ox + nx * W * 0.8, oy + ny * W * 0.8); qp(ox + ax * L * 0.6 + nx * W * 0.9, oy + ay * L * 0.6 + ny * W * 0.9); qp(ox + ax * L * 1.1, oy + ay * L * 1.1); qp(ox + nx * W * 0.1, oy + ny * W * 0.1); emit(ctx, 4, false);
  QN = 0; qp(ox - nx * W * 0.8, oy - ny * W * 0.8); qp(ox + bx * L * 0.6 - nx * W * 0.9, oy + by * L * 0.6 - ny * W * 0.9); qp(ox + bx * L * 1.0, oy + by * L * 1.0); qp(ox - nx * W * 0.1, oy - ny * W * 0.1); emit(ctx, 4, false);
}

function flyer(ctx, f, rim, body, a) {
  const B = f.B, j = f.j, s = f.scale, lw = B.lw * s;
  spineFrame(f); headFrame(f);
  ctx.beginPath(); wing(ctx, f, 1); fillRim(ctx, rim, body, a, 0.5);
  ctx.beginPath(); bone(ctx, j, 2, 9, 10); bone(ctx, j, 2, 7, 8); strokeTwice(ctx, rim, body, lw, a, 0.8);
  ctx.beginPath();
  torso(ctx, f);
  if (B.tail.n) {
    if (B.kind === 'hawk') {
      const n = B.tail.n * 2, tx = f.tl[n], ty = f.tl[n + 1], w = B.tail.w1 * s;
      QN = 0; qp(f.tl[0] - NX * 3 * s, f.tl[1] - NY * 3 * s); qp(tx - NX * w, ty - NY * w); qp(tx + NX * w * 0.3, ty + NY * w * 0.3); qp(f.tl[0] + NX * 3 * s, f.tl[1] + NY * 3 * s); emit(ctx, 4, false);
    } else tailShape(ctx, f, 2);
  }
  wedge(ctx, j[2], j[3], hx(-0.2, 0), hy(-0.2, 0), G * 0.5, HRad * 0.8);
  headPoly(ctx, B.kind === 'bat' ? H.bat : B.kind === 'hawk' ? H.hawk : H.moth, false);
  if (B.kind === 'hawk') headPoly(ctx, H.beak, true);
  else if (B.kind === 'bat') jaw(ctx, H.canineJaw, f.p[6] * 0.5, 0.8);
  ears(ctx, B);
  if (B.crest) htri(ctx, -0.3, 0.8, -1.1, 1.5, -0.5, 0.4);
  wing(ctx, f, 0);
  fillRim(ctx, rim, body, a, 1);
  // Wing bones or feather lines, antennae.
  ctx.beginPath();
  if (B.kind !== 'moth') {
    ctx.moveTo(j[2], j[3]); ctx.lineTo(j[6], j[7]); ctx.lineTo(j[8], j[9]);
    for (let i = 0; i < 3; i++) { ctx.moveTo(j[8], j[9]); ctx.lineTo(f.wg[i * 2], f.wg[i * 2 + 1]); }
  } else {
    const wx = (j[8] + f.wg[2]) / 2, wy = (j[9] + f.wg[3]) / 2;
    circle(ctx, wx, wy, 4 * s); circle(ctx, (j[6] + f.wg[4]) / 2, (j[7] + f.wg[5]) / 2, 2.5 * s);
  }
  if (B.antennae) { ctx.moveTo(hx(0.3, 0.8), hy(0.3, 0.8)); ctx.quadraticCurveTo(hx(0.6, 2.2), hy(0.6, 2.2), hx(1.4, 2.6), hy(1.4, 2.6)); ctx.moveTo(hx(0.1, 0.8), hy(0.1, 0.8)); ctx.quadraticCurveTo(hx(0.2, 2.4), hy(0.2, 2.4), hx(0.9, 2.9), hy(0.9, 2.9)); }
  ctx.globalAlpha = a * 0.8; ctx.strokeStyle = rim; ctx.lineWidth = 1.4 * s; ctx.stroke();
}
// A wing membrane: shoulder, elbow, wrist, the three tips, then back to the flank. A bat's trailing
// edge is scalloped between the fingers, a hawk's is ragged with primaries, a moth's is a broad lobe.
function wing(ctx, f, w) {
  const B = f.B, j = f.j, g = f.wg, o = w * 8, e = w ? 10 : 6, wr = w ? 12 : 8;
  const bx = j[4] + (j[2] - j[4]) * 0.35, by = j[5] + (j[3] - j[5]) * 0.35 + 2 * f.scale, X = j[wr], Y = j[wr + 1];
  QN = 0; qp(j[2], j[3]); qp(j[e], j[e + 1]); qp(X, Y); qp(g[o], g[o + 1]);
  for (let i = 1; i < 3; i++) {
    const px = g[o + i * 2 - 2], py = g[o + i * 2 - 1], qx = g[o + i * 2], qy = g[o + i * 2 + 1], mx = (px + qx) / 2, my = (py + qy) / 2;
    if (B.kind === 'bat') qp(mx + (X - mx) * 0.3, my + (Y - my) * 0.3);
    else if (B.kind === 'hawk') qp(mx + (X - mx) * 0.15, my + (Y - my) * 0.15);
    else qp(mx + (mx - X) * 0.25, my + (my - Y) * 0.25);
    qp(qx, qy);
  }
  const lx = g[o + 4], ly = g[o + 5], mx = (lx + bx) / 2, my = (ly + by) / 2;
  if (B.kind === 'bat') qp(mx + (j[e] - mx) * 0.3, my + (j[e + 1] - my) * 0.3);
  else qp(mx, my + 6 * f.scale);
  qp(bx, by);
  emit(ctx, QN, B.kind === 'moth');
}

function ape(ctx, f, rim, body, a) {
  const B = f.B, j = f.j, s = f.scale, lw = B.lw * s;
  spineFrame(f); headFrame(f);
  ctx.beginPath(); bone(ctx, j, 1, 5, 6); bone(ctx, j, 2, 9, 10); strokeTwice(ctx, rim, body, lw, a, 0.5);
  ctx.beginPath(); circle(ctx, j[12], j[13], lw * 0.9); wedge(ctx, j[2], j[3], j[10], j[11], G * 0.42, lw * 0.75); fillRim(ctx, rim, body, a, 0.5);
  ctx.beginPath(); bone(ctx, j, 1, 3, 4); bone(ctx, j, 2, 7, 8); toe(ctx, j, 8, 6 * s); ctx.globalAlpha = a; ctx.strokeStyle = rim; ctx.lineWidth = lw + RIM; ctx.stroke();
  ctx.beginPath();
  torso(ctx, f);
  wedge(ctx, j[4], j[5], j[14], j[15], G * 0.45, lw * 0.7);
  wedge(ctx, j[2], j[3], j[6], j[7], G * 0.5, lw * 0.8);
  wedge(ctx, j[6], j[7], j[8], j[9], lw * 0.85, lw * 0.65);
  circle(ctx, j[8], j[9], lw * 1.0);
  wedge(ctx, j[2], j[3], hx(-0.3, 0), hy(-0.3, 0), G * 0.55, HRad * 0.8);
  headPoly(ctx, H.ape, false);
  // Brow ridge, crest, mane.
  QN = 0; qp(hx(-0.05, 0.75), hy(-0.05, 0.75)); qp(hx(0.55, 0.55 + B.brow), hy(0.55, 0.55 + B.brow)); qp(hx(0.7, 0.3), hy(0.7, 0.3)); qp(hx(0.05, 0.4), hy(0.05, 0.4)); emit(ctx, 4, false);
  if (B.crest) htri(ctx, 0.2, 0.8, -0.25, 1.55, -0.55, 0.5);
  if (B.mane) spikes(ctx, 0.55, 1.1, 5, 0.85, 0.42, 0.1);
  fillRim(ctx, rim, body, a, 1);
  ctx.beginPath(); bone(ctx, j, 1, 3, 4); bone(ctx, j, 2, 7, 8); toe(ctx, j, 8, 6 * s); ctx.strokeStyle = body; ctx.lineWidth = lw; ctx.stroke();
  if (B.fangs) {
    ctx.beginPath(); ctx.moveTo(hx(0.75, -0.45), hy(0.75, -0.45)); ctx.lineTo(hx(0.78, -0.95), hy(0.78, -0.95)); ctx.moveTo(hx(0.55, -0.5), hy(0.55, -0.5)); ctx.lineTo(hx(0.55, -0.9), hy(0.55, -0.9));
    ctx.globalAlpha = a; ctx.strokeStyle = rim; ctx.lineWidth = 1.6 * s; ctx.stroke();
  }
}

function spitter(ctx, f, rim, body, a) {
  const B = f.B, j = f.j, s = f.scale, lw = B.lw * s, swell = Math.max(0, f.p[2]);
  spineFrame(f); headFrame(f);
  ctx.beginPath(); quadLegs(ctx, f, false); strokeTwice(ctx, rim, body, lw * 0.9, a, 0.5);
  ctx.beginPath(); quadLegs(ctx, f, true); ctx.globalAlpha = a; ctx.strokeStyle = rim; ctx.lineWidth = lw + RIM; ctx.stroke();
  ctx.beginPath();
  if (B.frill) {
    // A collar of spines around the neck that fans open as it winds up to spit.
    const cx = hx(-0.45, 0), cy = hy(-0.45, 0), r = B.frill * s * (0.75 + swell * 0.55), a0 = f.hdA;
    for (let i = 0; i < 7; i++) {
      const t = a0 + 1.0 + i * 0.36, t0 = t - 0.16, t1 = t + 0.16, rr = r * (0.82 + (i % 2) * 0.18);
      QN = 0; qp(cx, cy); qp(cx + Math.cos(t0) * rr * 0.75 * FX, cy - Math.sin(t0) * rr * 0.75); qp(cx + Math.cos(t) * rr * FX, cy - Math.sin(t) * rr); qp(cx + Math.cos(t1) * rr * 0.75 * FX, cy - Math.sin(t1) * rr * 0.75); emit(ctx, 4, false);
    }
  }
  torso(ctx, f);
  tailShape(ctx, f);
  wedge(ctx, j[4], j[5], j[14], j[15], G * 0.42, lw * 0.6);
  wedge(ctx, j[2], j[3], j[6], j[7], G * 0.4, lw * 0.6);
  wedge(ctx, j[2], j[3], hx(-0.3, 0), hy(-0.3, 0), G * 0.6, HRad * 0.9);
  if (B.sac) circle(ctx, hx(0.25, -0.75), hy(0.25, -0.75), B.sac * s * (0.6 + swell * 0.7));
  headPoly(ctx, B.kind === 'toad' ? H.toad : H.lizard, B.kind !== 'toad');
  jaw(ctx, B.kind === 'toad' ? H.toadJaw : H.lizJaw, f.p[6] * 0.55);
  if (B.spines) spikes(ctx, 0.05, 0.9, 6, 0.5, 0.35, 0.05);
  if (B.warts) for (let i = 0; i < 3; i++) circle(ctx, sx(0.2 + i * 0.28, 0.62), sy(0.2 + i * 0.28, 0.62), 2.6 * s);
  fillRim(ctx, rim, body, a, 1);
  ctx.beginPath(); quadLegs(ctx, f, true); ctx.strokeStyle = body; ctx.lineWidth = lw; ctx.stroke();
}

const DRAW = { hound, charger, raptor, stalker, scorpion, flyer, ape, spitter };

export function drawBeastBody(ctx, f, world, rim, body, alpha) {
  if (!f.B) return;
  DRAW[f.B.plan](ctx, f, rim, body, alpha);
  ctx.globalAlpha = alpha;
}

// Additive pass, before the generic blade and eye: the spitter's throat glows as it swells, a stalker
// has a cluster of small eyes.
export function drawBeastGlow(g, f, world) {
  const B = f.B;
  if (!B || f.dead || f.rag) return;
  if (B.plan === 'spitter') {
    const sw = f.p[2];
    if (sw > 0.15) {
      headFrame(f);
      const x = B.sac ? hx(0.25, -0.75) : hx(-0.45, 0), y = B.sac ? hy(0.25, -0.75) : hy(-0.45, 0), R = (14 + sw * 26) * f.scale;
      g.globalAlpha = Math.min(1, sw) * 0.75 * f.fade; g.drawImage(glowSprite(f.color), x - R, y - R, R * 2, R * 2);
    }
  } else if (B.plan === 'stalker') {
    headFrame(f);
    g.globalAlpha = f.fade; g.fillStyle = f.tele > 0 ? (f.teleRed ? '#ff2038' : '#ffffff') : f.color;
    g.beginPath(); circle(g, hx(0.55, 0.45), hy(0.55, 0.45), 1.6 * f.scale); circle(g, hx(0.3, 0.6), hy(0.3, 0.6), 1.3 * f.scale); circle(g, hx(0.75, 0.15), hy(0.75, 0.15), 1.2 * f.scale); g.fill();
  }
  g.globalAlpha = 1;
}
