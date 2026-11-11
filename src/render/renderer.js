// Frame composition. Static scenery comes pre-baked from the arena; the only dynamic light is a
// half-resolution additive glow layer (blades, trails, sparks) that is bloomed by a downsample chain
// and mirrored into the floor. No shadowBlur or per-frame filters anywhere.
import { TAU, clamp } from '../core/math.js';
import { glowSprite } from './fx.js';
import { TRAIL_STRIDE } from '../game/fighter.js';
import { BONES } from '../game/ragdoll.js';

const BODY = '#06080c';
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.view = { w: 1280, h: 720 };
    this.k = 1;                 // device pixels per logical unit
    this.quality = 1;           // dynamic resolution scale
    this.glow = mk(2, 2); this.g = this.glow.getContext('2d');
    this.b = [mk(2, 2), mk(2, 2), mk(2, 2)]; this.bc = this.b.map((c) => c.getContext('2d'));
    this.arena = null;
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.frameMs = 16; this.slowFrames = 0; this.fastFrames = 0;
    this.resize();
  }

  resize() {
    const cw = window.innerWidth, ch = window.innerHeight;
    const aspect = clamp(cw / ch, 960 / 720, 1680 / 720);
    let w = cw, h = cw / aspect;
    if (h > ch) { h = ch; w = ch * aspect; }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.k = Math.min((h * dpr) / 720, 1.5) * this.quality;
    this.view.w = Math.round(720 * aspect); this.view.h = 720;
    const c = this.canvas;
    c.width = Math.round(this.view.w * this.k); c.height = Math.round(720 * this.k);
    c.style.width = `${Math.round(w)}px`; c.style.height = `${Math.round(h)}px`;
    const gw = Math.ceil(c.width / 2), gh = Math.ceil(c.height / 2);
    this.glow.width = gw; this.glow.height = gh;
    this.b.forEach((b, i) => { b.width = Math.ceil(gw / 2 ** (i + 1)); b.height = Math.ceil(gh / 2 ** (i + 1)); });
  }

  // Drop internal resolution if the machine cannot hold frame rate; creep back up when it can.
  autoQuality(ms) {
    this.frameMs += (ms - this.frameMs) * 0.05;
    if (this.frameMs > 21) this.slowFrames++; else this.slowFrames = 0;
    if (this.frameMs < 14) this.fastFrames++; else this.fastFrames = 0;
    if (this.slowFrames > 90 && this.quality > 0.55) { this.quality = Math.max(0.55, this.quality - 0.15); this.slowFrames = 0; this.resize(); }
    if (this.fastFrames > 900 && this.quality < 1) { this.quality = Math.min(1, this.quality + 0.15); this.fastFrames = 0; this.resize(); }
  }

  draw(world, time) {
    const { ctx, g, k, view } = this, c = world.cam, arena = this.arena;
    const z = c.zoom * (1 + c.punchK);
    const cam = this.cam; cam.x = c.x + c.sx / z; cam.y = c.y + c.sy / z; cam.zoom = z;
    const W = this.canvas.width, H = this.canvas.height;
    const fs = world.fighters;

    // ── 1. glow layer ──
    const gs = k / 2;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, this.glow.width, this.glow.height);
    g.globalCompositeOperation = 'lighter';
    g.setTransform(gs * z, 0, 0, gs * z, gs * (view.w / 2 - cam.x * z), gs * (view.h / 2 - cam.y * z));
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const f of fs) this.glowFighter(g, f, world);
    this.glowProjectiles(g, world);
    this.glowTelegraphs(g, world);
    world.fx.drawGlow(g);
    const bc = this.bc, b = this.b;
    for (let i = 0; i < 3; i++) { bc[i].clearRect(0, 0, b[i].width, b[i].height); bc[i].drawImage(i ? b[i - 1] : this.glow, 0, 0, b[i].width, b[i].height); }

    // ── 2. baked scenery ──
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (arena) arena.drawBack(ctx, cam, view, time);
    else { ctx.fillStyle = '#0a0d14'; ctx.fillRect(0, 0, view.w, view.h); }

    // ── 3. floor: light pools and mirrored glow ──
    const wt = () => ctx.setTransform(k * z, 0, 0, k * z, k * (view.w / 2 - cam.x * z), k * (view.h / 2 - cam.y * z));
    wt();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of fs) {
      if (!f.armed || f.bladeOn < 0.05 || f.def.blade.gun) continue;
      const mx = (f.bx + f.tx) / 2, hgt = Math.max(0, -(f.by + f.ty) / 2);
      const R = 190 * f.scale, a = 0.34 * f.bladeOn * f.fade / (1 + hgt / 160);
      ctx.globalAlpha = a;
      ctx.drawImage(glowSprite(f.color), mx - R, -R * 0.11, R * 2, R * 0.3);
    }
    for (const fl of world.fx.flashes) {
      if (fl.y < -220) continue;
      const kf = fl.life / fl.max, R = fl.r * 2.2;
      ctx.globalAlpha = kf * 0.32 / (1 + -fl.y / 120);
      ctx.drawImage(glowSprite(fl.color), fl.x - R, -R * 0.1, R * 2, R * 0.28);
    }
    const refl = arena ? arena.reflect : 0.3;
    const gy = k * ((0 - cam.y) * z + view.h / 2);
    if (gy < H) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, gy, W, H - gy); ctx.clip();
      ctx.translate(0, 2 * gy); ctx.scale(1, -1);
      ctx.globalAlpha = refl * 0.75; ctx.drawImage(b[0], 0, 0, W, H);
      ctx.globalAlpha = refl * 0.3; ctx.drawImage(this.glow, 0, 0, W, H);
      ctx.restore();
    }

    // ── 4. bodies ──
    wt();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    for (const f of fs) {
      const hgt = f.rag ? Math.max(0, -f.j[5] - 20) : -f.y;
      if (hgt > 500) continue;
      const sw = 36 * f.scale * (1 - Math.min(0.6, hgt / 500));
      ctx.globalAlpha = 0.34 * f.fade * (1 - Math.min(0.7, hgt / 400));
      ctx.beginPath(); ctx.ellipse(f.rag ? (f.j[2] + f.j[4]) / 2 : f.x, 1, sw, sw * 0.16, 0, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    world.fx.drawSolid(ctx, arena ? arena.palette.fog : '#8a93a8');
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const f of fs) if (f.dead) this.bodyFighter(ctx, f, world);
    for (const f of fs) if (!f.dead && f !== world.player) this.bodyFighter(ctx, f, world);
    if (world.player && !world.player.dead) this.bodyFighter(ctx, world.player, world);

    // ── 5. bloom composite ──
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1; ctx.drawImage(this.glow, 0, 0, W, H);
    ctx.globalAlpha = 0.55; ctx.drawImage(b[0], 0, 0, W, H);
    ctx.globalAlpha = 0.42; ctx.drawImage(b[1], 0, 0, W, H);
    ctx.globalAlpha = 0.32; ctx.drawImage(b[2], 0, 0, W, H);

    // ── 6. crisp blade cores, bars, labels ──
    wt();
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    for (const f of fs) this.coreFighter(ctx, f);
    for (const p of world.projectiles.list) if (p.type === 'saber') this.saberCore(ctx, p);
    ctx.globalAlpha = 1;
    for (const f of fs) if (f.team === 1 && !f.dead && !f.def.boss && f.barT > 0) this.enemyBar(ctx, f);
    world.fx.drawText(ctx);

    // ── 7. foreground ──
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (arena) arena.drawFront(ctx, cam, view, time);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  // ───────────── glow pass ─────────────
  glowFighter(g, f, world) {
    const s = f.scale, j = f.j, t = world.time;
    const lit = f.armed && f.bladeOn > 0.02 && !f.def.blade.gun;
    if (lit) {
      const on = f.bladeOn * f.fade, wide = f.def.blade.wide ? 1.7 : 1;
      const x0 = f.double ? f.t2x : f.bx, y0 = f.double ? f.t2y : f.by;
      this.trail(g, f, t);
      const fl = 1 + Math.sin(t * 47 + f.t) * 0.06;
      g.strokeStyle = f.color;
      g.globalAlpha = 0.16 * on; g.lineWidth = 15 * wide * fl; line(g, x0, y0, f.tx, f.ty);
      g.globalAlpha = 0.42 * on; g.lineWidth = 7.5 * wide * fl; line(g, x0, y0, f.tx, f.ty);
      g.globalAlpha = 0.95 * on; g.lineWidth = 3.8 * wide; line(g, x0, y0, f.tx, f.ty);
      const mx = (x0 + f.tx) / 2, my = (y0 + f.ty) / 2, R = 78 * s * wide;
      g.globalAlpha = 0.2 * on; g.drawImage(glowSprite(f.color), mx - R, my - R, R * 2, R * 2);
      if (f.charging || f.charged && f.state === 'attack') {
        const cr = 30 + f.chargeT * 60;
        g.globalAlpha = 0.5; g.drawImage(glowSprite('#ffffff'), f.tx - cr, f.ty - cr, cr * 2, cr * 2);
      }
    }
    g.globalAlpha = f.fade;
    // Eye slit: gives every head a facing and a place for tells to flare.
    const ex = j[0] + f.facing * 2.5 * s, ey = j[1] - 1 * s;
    const eyeCol = f.tele > 0 ? (f.teleRed ? '#ff2038' : '#ffffff') : f.broken ? '#ffd36b' : f.color;
    g.strokeStyle = eyeCol; g.lineWidth = (f.def.deco === 'visor' ? 3 : 2.3) * s;
    if (!f.dead || f.deadT < 0.6) line(g, ex, ey, ex + f.facing * (f.def.deco === 'visor' ? 7 : 4.5) * s, ey);
    if (f.dead) { this.glowCuts(g, f); return; }

    if (f.tele > 0) {
      const kq = Math.min(1, f.tele / 0.42), col = f.teleRed ? '#ff2038' : '#ffffff';
      const px = f.def.blade.gun || f.def.shield ? j[0] : (f.bx + f.tx) / 2, py = f.def.blade.gun || f.def.shield ? j[1] : (f.by + f.ty) / 2;
      const Lr = (f.teleRed ? 54 : 38) * (0.4 + kq), a = t * 3;
      g.globalAlpha = Math.min(1, kq * 2); g.strokeStyle = col; g.lineWidth = f.teleRed ? 3.4 : 2.4;
      line(g, px - Math.cos(a) * Lr, py - Math.sin(a) * Lr, px + Math.cos(a) * Lr, py + Math.sin(a) * Lr);
      line(g, px + Math.sin(a) * Lr * 0.6, py - Math.cos(a) * Lr * 0.6, px - Math.sin(a) * Lr * 0.6, py + Math.cos(a) * Lr * 0.6);
      const R = (f.teleRed ? 70 : 46) * (0.5 + kq);
      g.drawImage(glowSprite(col), px - R, py - R, R * 2, R * 2);
      if (f.teleRed) { g.globalAlpha = kq; g.beginPath(); g.arc(px, py, 60 * (1 - kq) + 10, 0, TAU); g.stroke(); }
      g.globalAlpha = 1;
    }
    if (f.def.shield && !f.rag) {
      const up = world.guarding(f), hit = f.shieldHit > 0 ? 1 : 0;
      if (up || hit) {
        const cx = (j[2] + j[4]) / 2 + f.facing * 14 * s, cy = (j[3] + j[5]) / 2 - 4 * s, r = 48 * s, a0 = f.facing > 0 ? 0 : Math.PI;
        const wob = 1 - f.posture / f.maxPosture;
        g.strokeStyle = f.def.shieldColor; g.globalAlpha = (0.35 + 0.4 * wob + hit * 0.4) * (0.9 + Math.sin(t * 30) * 0.1 * (1 - wob));
        g.lineWidth = 5 + hit * 4; g.beginPath(); g.arc(cx, cy, r, a0 - 1.05, a0 + 1.05); g.stroke();
        g.globalAlpha *= 0.4; g.lineWidth = 14; g.beginPath(); g.arc(cx, cy, r, a0 - 1.0, a0 + 1.0); g.stroke();
      }
    }
    if (f.def.blade.gun) {
      g.globalAlpha = 0.9; g.fillStyle = f.color; g.beginPath(); g.arc(f.tx, f.ty, 2.6, 0, TAU); g.fill();
      const m = f.move;
      if (f.state === 'attack' && m.aim && f.mt < 0.74) {
        const dx = f.tx - f.bx, dy = f.ty - f.by, d = Math.hypot(dx, dy) || 1, kq = f.mt / 0.72;
        g.strokeStyle = '#ff3048'; g.lineWidth = 1 + kq * 1.6; g.globalAlpha = (0.2 + kq * 0.7) * (0.75 + Math.sin(t * 60) * 0.25);
        line(g, f.tx, f.ty, f.tx + dx / d * 1100, f.ty + dy / d * 1100);
      }
    }
    if (f.def.deco === 'halo') {
      const hx = j[0], hy = j[1] - 20 * s, p2 = f.double;
      g.globalAlpha = 0.9; g.strokeStyle = f.color; g.lineWidth = 2.4;
      g.beginPath(); g.ellipse(hx, hy + Math.sin(t * 2) * 1.5, 14 * s, 4.2 * s, 0, 0, TAU); g.stroke();
      if (p2) {
        g.lineWidth = 1.6;
        for (let i = 0; i < 6; i++) { const a = t * 1.4 + i * TAU / 6, r0 = 16 * s, r1 = 26 * s; line(g, hx + Math.cos(a) * r0, hy + Math.sin(a) * r0 * 0.3, hx + Math.cos(a) * r1, hy + Math.sin(a) * r1 * 0.3 - 4); }
      }
      if (world.bossChannel > 0 && f.ai.channel) {
        const cx = f.cx, cy = f.cy, r = 86 * s;
        g.strokeStyle = '#7dffb0'; g.globalAlpha = 0.25; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
        g.globalAlpha = 0.95; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + world.bossChannel * TAU); g.stroke();
        g.globalAlpha = 0.25 + Math.sin(t * 10) * 0.1; g.drawImage(glowSprite('#7dffb0'), cx - 150, cy - 150, 300, 300);
      }
    }
    if (f.broken) {
      const kq = 0.5 + Math.sin(t * 12) * 0.3;
      g.globalAlpha = kq * 0.5; g.drawImage(glowSprite('#ffd36b'), j[0] - 34, j[1] - 34, 68, 68);
    }
    if (f.ribbons.length && !f.def.boss) this.ribbon(g, f, 0.5, true);
    g.globalAlpha = 1;
  }

  glowCuts(g, f) {
    if (!f.rag) return;
    for (const c of f.rag.cuts) {
      const a = Math.max(0, 1 - c.t / 2.2);
      if (a <= 0) continue;
      const x = f.rag.x[c.joint], y = f.rag.y[c.joint];
      g.globalAlpha = a * f.fade; g.drawImage(glowSprite('#ff9838'), x - 13, y - 13, 26, 26);
    }
    g.globalAlpha = 1;
  }

  trail(g, f, time) {
    const tr = f.trail, n = tr.length / TRAIL_STRIDE, head = f.trailHead;
    g.fillStyle = f.color;
    let pi = -1;
    for (let q = 0; q < n; q++) {
      const i = ((head + q) % n) * TRAIL_STRIDE; // oldest → newest
      if (!tr[i + 5] || time - tr[i + 4] > 0.14) { pi = -1; continue; }
      if (pi >= 0 && tr[i + 4] - tr[pi + 4] < 0.05) {
        const age = (time - tr[i + 4]) / 0.14, a = (1 - age) * (1 - age);
        // Outer part of the blade only, so the swoosh thins toward the hilt.
        const m0x = tr[pi] + (tr[pi + 2] - tr[pi]) * 0.35, m0y = tr[pi + 1] + (tr[pi + 3] - tr[pi + 1]) * 0.35;
        const m1x = tr[i] + (tr[i + 2] - tr[i]) * 0.35, m1y = tr[i + 1] + (tr[i + 3] - tr[i + 1]) * 0.35;
        g.globalAlpha = a * 0.2 * f.fade;
        g.beginPath(); g.moveTo(m0x, m0y); g.lineTo(tr[pi + 2], tr[pi + 3]); g.lineTo(tr[i + 2], tr[i + 3]); g.lineTo(m1x, m1y); g.closePath(); g.fill();
        const n0x = tr[pi] + (tr[pi + 2] - tr[pi]) * 0.78, n0y = tr[pi + 1] + (tr[pi + 3] - tr[pi + 1]) * 0.78;
        const n1x = tr[i] + (tr[i + 2] - tr[i]) * 0.78, n1y = tr[i + 1] + (tr[i + 3] - tr[i + 1]) * 0.78;
        g.globalAlpha = a * 0.32 * f.fade;
        g.beginPath(); g.moveTo(n0x, n0y); g.lineTo(tr[pi + 2], tr[pi + 3]); g.lineTo(tr[i + 2], tr[i + 3]); g.lineTo(n1x, n1y); g.closePath(); g.fill();
      }
      pi = i;
    }
  }

  glowProjectiles(g, world) {
    for (const p of world.projectiles.list) {
      g.strokeStyle = p.color; g.fillStyle = p.color;
      if (p.type === 'bolt') {
        const d = Math.hypot(p.vx, p.vy) || 1, dx = p.vx / d * 30, dy = p.vy / d * 30;
        g.globalAlpha = 0.4; g.lineWidth = 9; line(g, p.x - dx, p.y - dy, p.x, p.y);
        g.globalAlpha = 1; g.lineWidth = 3.6; line(g, p.x - dx * 0.8, p.y - dy * 0.8, p.x, p.y);
        g.globalAlpha = 0.5; g.drawImage(glowSprite(p.color), p.x - 32, p.y - 32, 64, 64);
      } else if (p.type === 'wave' || p.type === 'crescent') {
        const a = Math.min(1, p.life / p.max * 3), h = p.h, d = p.dir;
        if (p.type === 'crescent') {
          const cx = p.x - d * h * 0.55, cy = -h * 0.52, r = h * 0.62, a0 = d > 0 ? 0 : Math.PI;
          g.globalAlpha = 0.35 * a; g.lineWidth = 16; g.beginPath(); g.arc(cx, cy, r, a0 - 1.0, a0 + 1.0); g.stroke();
          g.globalAlpha = 0.95 * a; g.lineWidth = 5; g.beginPath(); g.arc(cx, cy, r, a0 - 1.0, a0 + 1.0); g.stroke();
          g.globalAlpha = 0.4 * a; g.drawImage(glowSprite(p.color), p.x - 80, cy - 80, 160, 160);
        } else {
          g.globalAlpha = 0.8 * a;
          g.beginPath(); g.moveTo(p.x - d * 34, 0); g.quadraticCurveTo(p.x + d * 4, -h * 0.5, p.x + d * 16, -h); g.quadraticCurveTo(p.x + d * 14, -h * 0.4, p.x + d * 10, 0); g.closePath(); g.fill();
          g.globalAlpha = 0.5 * a; g.drawImage(glowSprite(p.color), p.x - 70, -50, 140, 70);
        }
      } else if (p.type === 'saber') {
        for (let i = 0; i < 4; i++) {
          const a = p.ang - i * 0.5, dx = Math.cos(a) * p.len, dy = Math.sin(a) * p.len;
          g.globalAlpha = (i ? 0.28 : 0.9) / (1 + i * 0.6); g.lineWidth = i ? 7 : 5;
          line(g, p.x - dx, p.y - dy, p.x + dx, p.y + dy);
        }
        g.globalAlpha = 0.45; g.drawImage(glowSprite(p.color), p.x - 70, p.y - 70, 140, 140);
      }
    }
    g.globalAlpha = 1;
  }

  glowTelegraphs(g, world) {
    const t = world.time;
    for (const f of world.fighters) {
      const m = f.move;
      if (f.state === 'attack' && m.line && f.mt >= m.line[0] && f.mt <= m.line[1]) {
        const kq = (f.mt - m.line[0]) / (m.line[1] - m.line[0]), x1 = f.facing > 0 ? world.maxX : world.minX;
        g.strokeStyle = '#ff2038'; g.globalAlpha = (0.25 + kq * 0.6) * (0.8 + Math.sin(t * 50) * 0.2);
        g.lineWidth = 2 + kq * 3; line(g, f.x, -3, x1, -3);
        g.globalAlpha *= 0.5; g.lineWidth = 1.5; line(g, f.bx, f.by, x1, f.by);
      }
    }
    const mk2 = world.marker;
    if (mk2) {
      const pulse = mk2.lock ? 0.75 + Math.sin(t * 40) * 0.25 : 0.45 + Math.sin(t * 9) * 0.12;
      g.strokeStyle = '#ff2038'; g.globalAlpha = pulse; g.lineWidth = mk2.lock ? 5 : 3;
      g.beginPath(); g.ellipse(mk2.x, -2, 105, 15, 0, 0, TAU); g.stroke();
      g.globalAlpha = pulse * 0.4; g.lineWidth = mk2.lock ? 3 : 1.5; line(g, mk2.x, -2, mk2.x, -900);
      g.globalAlpha = pulse * 0.5; g.drawImage(glowSprite('#ff2038'), mk2.x - 130, -24, 260, 48);
    }
    g.globalAlpha = 1;
  }

  // ───────────── solid pass ─────────────
  bodyFighter(ctx, f, world) {
    const j = f.j, s = f.scale, lw = f.def.lineW * s, d = f.def;
    let ox = 0, oy = 0;
    if (f.vib > 0 && world.hitstop > 0) { ox = (Math.random() - 0.5) * 5; oy = (Math.random() - 0.5) * 3; }
    let alpha = f.fade;
    if (f.isPlayer && f.invuln > 0 && f.state !== 'dash' && f.state !== 'attack' && !f.rag) alpha *= 0.55 + Math.sin(world.time * 40) * 0.25;
    ctx.save();
    if (ox || oy) ctx.translate(ox, oy);
    ctx.globalAlpha = alpha;
    const body = f.flash > 0 ? '#ffffff' : BODY;
    const rim = f.tele > 0.2 ? (f.teleRed ? '#ff5060' : '#ffffff') : f.broken ? '#ffd36b' : d.outline;

    if (f.ribbons.length) this.ribbon(ctx, f, 1, false);

    const alive = f.rag ? f.rag.alive : null;
    const bone = (i) => !alive || alive[i];
    const seg = (i) => { const a = BONES[i][0] * 2, b = BONES[i][1] * 2; ctx.moveTo(j[a], j[a + 1]); ctx.lineTo(j[b], j[b + 1]); };
    const group = (ids, rimA) => {
      ctx.beginPath(); for (const i of ids) if (bone(i)) seg(i);
      ctx.globalAlpha = alpha * rimA; ctx.strokeStyle = rim; ctx.lineWidth = lw + 2.6; ctx.stroke();
      ctx.globalAlpha = alpha; ctx.strokeStyle = body; ctx.lineWidth = lw; ctx.stroke();
    };
    group([4, 5, 8, 9], 0.5);            // far arm and leg, dimmer rim for depth
    if (d.deco === 'bulwark' || d.deco === 'horns') {
      const r = (d.deco === 'horns' ? 13 : 10) * s;
      ctx.beginPath(); ctx.arc(j[2], j[3] + 2 * s, r, 0, TAU);
      ctx.fillStyle = body; ctx.fill(); ctx.strokeStyle = rim; ctx.lineWidth = 1.4; ctx.stroke();
    }
    group([1, 6, 7], 1);                 // spine and near leg
    // Head
    const hr = 9 * s * (d.deco === 'horns' ? 0.8 : 1);
    ctx.beginPath(); ctx.arc(j[0], j[1], hr, 0, TAU);
    ctx.fillStyle = body; ctx.fill(); ctx.strokeStyle = rim; ctx.lineWidth = 1.5; ctx.stroke();
    this.deco(ctx, f, hr, rim, body);
    // Hilt or rifle, then the weapon arm on top.
    if (f.armed) {
      const dx = f.tx - f.bx, dy = f.ty - f.by, dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl;
      if (d.blade.gun) {
        ctx.beginPath(); ctx.moveTo(f.bx - ux * 12, f.by - uy * 12); ctx.lineTo(f.tx, f.ty);
        ctx.strokeStyle = rim; ctx.lineWidth = 7; ctx.stroke(); ctx.strokeStyle = body; ctx.lineWidth = 4.6; ctx.stroke();
      } else {
        const hl = f.double ? 9 : 7;
        ctx.beginPath(); ctx.moveTo(f.bx - ux * hl, f.by - uy * hl); ctx.lineTo(f.bx + ux * hl, f.by + uy * hl);
        ctx.strokeStyle = '#aeb9c8'; ctx.lineWidth = 4.2 * (d.blade.wide ? 1.5 : 1); ctx.stroke();
      }
    }
    group([2, 3], 1);
    ctx.restore();
  }

  deco(ctx, f, hr, rim, body) {
    const j = f.j, s = f.scale, fc = f.facing, hx = j[0], hy = j[1];
    ctx.strokeStyle = rim; ctx.fillStyle = body; ctx.lineWidth = 1.5;
    switch (f.def.deco) {
      case 'hood':
        ctx.beginPath(); ctx.moveTo(hx - fc * hr * 0.5, hy - hr * 0.85); ctx.lineTo(hx - fc * hr * 1.9, hy - hr * 0.2); ctx.lineTo(hx - fc * hr * 0.9, hy + hr * 0.45); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
      case 'bulwark':
        ctx.beginPath(); ctx.rect(hx - hr * 1.05, hy - hr * 1.25, hr * 2.1, hr * 0.7); ctx.fill(); ctx.stroke(); break;
      case 'visor':
        ctx.beginPath(); ctx.moveTo(hx - fc * hr * 0.4, hy - hr); ctx.lineTo(hx - fc * hr * 1.0, hy - hr * 2.3); ctx.lineWidth = 1.8; ctx.stroke(); break;
      case 'horns':
        ctx.lineWidth = 3 * s; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(hx + hr * 0.5, hy - hr * 0.7); ctx.lineTo(hx + hr * 1.5, hy - hr * 1.9); ctx.moveTo(hx - hr * 0.5, hy - hr * 0.7); ctx.lineTo(hx - hr * 1.5, hy - hr * 1.9);
        ctx.strokeStyle = rim; ctx.stroke(); break;
      case 'crest':
        ctx.beginPath(); ctx.moveTo(hx + fc * hr * 0.2, hy - hr); ctx.lineTo(hx - fc * hr * 0.3, hy - hr * 1.9); ctx.lineTo(hx - fc * hr * 0.9, hy - hr * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
      case 'halo':
        ctx.beginPath(); ctx.moveTo(hx - hr * 0.9, hy - hr * 0.5); ctx.lineTo(hx, hy - hr * 1.7); ctx.lineTo(hx + hr * 0.9, hy - hr * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
    }
  }

  ribbon(ctx, f, alphaK, glow) {
    for (const rb of f.ribbons) {
      const q = rb.pts;
      if (!q) continue;
      const n = rb.n;
      ctx.strokeStyle = rb.color;
      for (let i = 1; i < n; i++) {
        const kq = 1 - i / n;
        ctx.globalAlpha = f.fade * alphaK * (glow ? 0.5 * kq : 0.35 + 0.65 * kq);
        ctx.lineWidth = rb.width * f.scale * (0.35 + 0.65 * kq) * (glow ? 1.3 : 1);
        ctx.beginPath(); ctx.moveTo(q[i * 4 - 4], q[i * 4 - 3]); ctx.lineTo(q[i * 4], q[i * 4 + 1]); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  coreFighter(ctx, f) {
    if (!f.armed || f.bladeOn < 0.05 || f.def.blade.gun) return;
    const x0 = f.double ? f.t2x : f.bx, y0 = f.double ? f.t2y : f.by;
    ctx.globalAlpha = Math.min(1, f.bladeOn * 1.2) * f.fade;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.2 * (f.def.blade.wide ? 1.7 : 1);
    line(ctx, x0, y0, f.tx, f.ty);
  }

  saberCore(ctx, p) {
    const dx = Math.cos(p.ang) * p.len, dy = Math.sin(p.ang) * p.len;
    ctx.globalAlpha = 1; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5;
    line(ctx, p.x - dx, p.y - dy, p.x + dx, p.y + dy);
  }

  enemyBar(ctx, f) {
    const w = 48 * f.scale, x = f.x - w / 2, y = Math.min(f.j[1], f.j[3]) - 30 * f.scale;
    const a = Math.min(1, f.barT * 2);
    ctx.globalAlpha = a * 0.7; ctx.fillStyle = '#000'; ctx.fillRect(x - 1, y - 1, w + 2, 6);
    ctx.globalAlpha = a; ctx.fillStyle = f.color; ctx.fillRect(x, y, w * clamp(f.hp / f.maxHp, 0, 1), 4);
    if (f.posture > 1) { ctx.fillStyle = '#ffd36b'; ctx.fillRect(x, y + 6, w * clamp(f.posture / f.maxPosture, 0, 1), 2); }
    if (f.reads) { ctx.fillStyle = f.color; ctx.font = '700 10px ui-sans-serif, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('READS ' + f.reads.toUpperCase(), f.x, y - 8); }
    ctx.globalAlpha = 1;
  }
}

function line(c, x0, y0, x1, y1) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
