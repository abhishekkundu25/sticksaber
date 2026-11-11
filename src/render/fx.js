// Transient effects. The sim only pushes plain records here (so it stays headless-testable);
// the draw methods are called by the renderer with the context already in world space.
import { rand, TAU } from '../core/math.js';

const MAX_SPARKS = 520;
const sprites = new Map();

// Soft radial blob in a given colour, cached. Used for flashes, floor light pools and blade bloom.
export function glowSprite(color) {
  let c = sprites.get(color);
  if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.07, color); grd.addColorStop(0.4, color + '44'); grd.addColorStop(1, color + '00');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  sprites.set(color, c);
  return c;
}

export class Fx {
  constructor() {
    this.sparks = []; this.flashes = []; this.rings = []; this.slashes = []; this.dusts = [];
    this.texts = []; this.ghosts = []; this.beams = []; this.embers = [];
  }

  clear() { for (const k of ['sparks', 'flashes', 'rings', 'slashes', 'dusts', 'texts', 'ghosts', 'beams', 'embers']) this[k].length = 0; }

  spark(x, y, ang, spread, n, speed, color, o = {}) {
    for (let i = 0; i < n && this.sparks.length < MAX_SPARKS; i++) {
      const a = ang + rand(-spread, spread), v = speed * rand(0.35, 1);
      const life = (o.life ?? 0.42) * rand(0.5, 1);
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color: Math.random() < (o.white ?? 0.3) ? '#ffffff' : color, size: (o.size ?? 2.2) * rand(0.6, 1.3), grav: o.grav ?? 1500, drag: o.drag ?? 2.2 });
    }
  }
  flash(x, y, r, color, life = 0.14) { this.flashes.push({ x, y, r, color, life, max: life }); }
  ring(x, y, r0, r1, life, color, flat = 1, width = 4) { this.rings.push({ x, y, r0, r1, life, max: life, color, flat, width }); }
  slash(x, y, ang, len, color, life = 0.16, width = 5) { this.slashes.push({ x, y, ang, len, color, life, max: life, width }); }
  dust(x, y, n, dir = 0, speed = 160) {
    for (let i = 0; i < n && this.dusts.length < 90; i++) {
      const life = rand(0.35, 0.8);
      this.dusts.push({ x: x + rand(-8, 8), y: y - rand(0, 6), vx: dir * speed * rand(0.3, 1) + rand(-40, 40), vy: -rand(10, 90), r: rand(5, 12), life, max: life });
    }
  }
  text(x, y, str, color = '#ffffff', size = 18, life = 0.9) { this.texts.push({ x, y, str, color, size, life, max: life }); }
  ghost(f, color, life = 0.28) {
    if (this.ghosts.length > 26) return;
    this.ghosts.push({ j: Float32Array.from(f.j), bx: f.bx, by: f.by, tx: f.tx, ty: f.ty, t2x: f.t2x, t2y: f.t2y, double: f.double, lit: f.armed && f.bladeOn > 0.5, color, life, max: life, w: f.def.lineW * f.scale });
  }
  beam(x, life, color) { this.beams.push({ x, life, max: life, color }); }
  ember(x, y, n, color) {
    for (let i = 0; i < n && this.embers.length < 120; i++) {
      const life = rand(0.6, 1.6);
      this.embers.push({ x: x + rand(-4, 4), y: y + rand(-4, 4), vx: rand(-50, 50), vy: -rand(20, 120), life, max: life, color });
    }
  }

  update(dt) {
    if (dt <= 0) return;
    let a = this.sparks;
    for (let i = a.length - 1; i >= 0; i--) {
      const s = a[i];
      s.life -= dt;
      if (s.life <= 0) { a[i] = a[a.length - 1]; a.pop(); continue; }
      const d = Math.max(0, 1 - s.drag * dt);
      s.vx *= d; s.vy = s.vy * d + s.grav * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.y > -1 && s.vy > 0) { s.y = -1; s.vy *= -0.42; s.vx *= 0.7; }
    }
    for (const k of ['flashes', 'rings', 'slashes', 'texts', 'ghosts', 'beams']) {
      a = this[k];
      for (let i = a.length - 1; i >= 0; i--) { a[i].life -= dt; if (a[i].life <= 0) a.splice(i, 1); }
    }
    a = this.dusts;
    for (let i = a.length - 1; i >= 0; i--) {
      const s = a[i]; s.life -= dt;
      if (s.life <= 0) { a.splice(i, 1); continue; }
      s.vx *= 1 - 2.5 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.r += 22 * dt;
    }
    a = this.embers;
    for (let i = a.length - 1; i >= 0; i--) {
      const s = a[i]; s.life -= dt;
      if (s.life <= 0) { a.splice(i, 1); continue; }
      s.vx += rand(-200, 200) * dt; s.x += s.vx * dt; s.y += s.vy * dt;
    }
    for (const t of this.texts) t.y -= 34 * dt;
  }

  // Additive layer: everything that emits light.
  drawGlow(g) {
    g.lineCap = 'round';
    for (const s of this.sparks) {
      const k = s.life / s.max;
      g.globalAlpha = k < 0.5 ? k * 2 : 1;
      g.strokeStyle = s.color; g.lineWidth = s.size * (0.5 + k * 0.6);
      g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x - s.vx * 0.028, s.y - s.vy * 0.028); g.stroke();
    }
    for (const e of this.embers) {
      g.globalAlpha = Math.min(1, e.life / e.max * 1.5);
      g.fillStyle = e.color; g.fillRect(e.x - 1.2, e.y - 1.2, 2.4, 2.4);
    }
    for (const f of this.flashes) {
      const k = f.life / f.max, r = f.r * (1.25 - k * 0.5);
      g.globalAlpha = k * k * 0.7;
      g.drawImage(glowSprite(f.color), f.x - r, f.y - r, r * 2, r * 2);
    }
    for (const r of this.rings) {
      const k = 1 - r.life / r.max, rad = r.r0 + (r.r1 - r.r0) * (1 - (1 - k) ** 3);
      g.globalAlpha = (1 - k) ** 1.5;
      g.strokeStyle = r.color; g.lineWidth = r.width * (1 - k * 0.7);
      g.beginPath(); g.ellipse(r.x, r.y, rad, rad * r.flat, 0, 0, TAU); g.stroke();
    }
    for (const s of this.slashes) {
      const k = s.life / s.max, len = s.len * (0.6 + (1 - k) * 0.5);
      const dx = Math.cos(s.ang) * len / 2, dy = Math.sin(s.ang) * len / 2;
      g.globalAlpha = k;
      g.strokeStyle = s.color; g.lineWidth = s.width * k + 0.5;
      g.beginPath(); g.moveTo(s.x - dx, s.y - dy); g.lineTo(s.x + dx, s.y + dy); g.stroke();
      g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(0.6, s.width * k * 0.35);
      g.beginPath(); g.moveTo(s.x - dx * 0.8, s.y - dy * 0.8); g.lineTo(s.x + dx * 0.8, s.y + dy * 0.8); g.stroke();
    }
    for (const gh of this.ghosts) {
      const k = gh.life / gh.max, j = gh.j;
      g.globalAlpha = k * 0.42;
      g.strokeStyle = gh.color; g.lineWidth = gh.w;
      g.beginPath();
      g.moveTo(j[2], j[3]); g.lineTo(j[4], j[5]);
      g.moveTo(j[2], j[3]); g.lineTo(j[6], j[7]); g.lineTo(j[8], j[9]);
      g.moveTo(j[2], j[3]); g.lineTo(j[10], j[11]); g.lineTo(j[12], j[13]);
      g.moveTo(j[4], j[5]); g.lineTo(j[14], j[15]); g.lineTo(j[16], j[17]);
      g.moveTo(j[4], j[5]); g.lineTo(j[18], j[19]); g.lineTo(j[20], j[21]);
      g.stroke();
      g.fillStyle = gh.color; g.beginPath(); g.arc(j[0], j[1], gh.w * 1.6, 0, TAU); g.fill();
      if (gh.lit) {
        g.globalAlpha = k * 0.7; g.lineWidth = 4;
        g.beginPath(); g.moveTo(gh.double ? gh.t2x : gh.bx, gh.double ? gh.t2y : gh.by); g.lineTo(gh.tx, gh.ty); g.stroke();
      }
    }
    for (const b of this.beams) {
      const k = b.life / b.max, w = 26 * k + 2;
      g.globalAlpha = k * 0.8;
      const grd = g.createLinearGradient(b.x - w, 0, b.x + w, 0);
      grd.addColorStop(0, b.color + '00'); grd.addColorStop(0.5, b.color); grd.addColorStop(1, b.color + '00');
      g.fillStyle = grd; g.fillRect(b.x - w, -900, w * 2, 900);
    }
    g.globalAlpha = 1;
  }

  // Non-emissive: dust puffs.
  drawSolid(ctx, tint = '#8a93a8') {
    ctx.fillStyle = tint;
    for (const d of this.dusts) {
      ctx.globalAlpha = (d.life / d.max) * 0.22;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawText(ctx) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const k = t.life / t.max, pop = k > 0.85 ? 1 + (k - 0.85) * 4 : 1;
      ctx.globalAlpha = Math.min(1, k * 2.2);
      ctx.font = `700 ${t.size * pop}px ui-sans-serif, "Avenir Next", "Helvetica Neue", Arial, sans-serif`;
      ctx.fillStyle = '#000000aa'; ctx.fillText(t.str, t.x + 1, t.y + 2);
      ctx.fillStyle = t.color; ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}
