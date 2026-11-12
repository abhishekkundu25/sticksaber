// Frame composition. Static scenery comes pre-baked from the arena; the only dynamic light is a
// half-resolution additive glow layer (blades, trails, sparks) that is bloomed by a downsample chain
// and mirrored into the floor. No shadowBlur or per-frame filters anywhere.
//
// Fill rate is what costs on weak machines, so three things keep it down: the bloom levels are summed
// at quarter resolution and composited once; the glow is only composited over the screen rectangle
// that actually contains light this frame; and a lower tier draws the backdrop at half resolution.
import { TAU, clamp } from '../core/math.js';
import { glowSprite } from './fx.js';
import { TRAIL_STRIDE } from '../game/fighter.js';
import { BONES } from '../game/ragdoll.js';

const BODY = '#06080c';
const AURA = { swift: '#ffe45c', armored: '#6fb6ff', volatile: '#ff7a2e' };
const FAR = [4, 5, 8, 9], TORSO = [1, 6, 7], ARM = [2, 3];
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.view = { w: 1280, h: 720 };
    this.k = 1;                 // device pixels per logical unit
    this.quality = 1;           // dynamic resolution scale
    this.tier = 2;              // 2: everything at full resolution. 1: backdrop at half resolution.
    this.mode = 'auto';         // 'auto' adapts tier and quality to frame time; 'high' and 'low' pin them
    this.glow = mk(2, 2); this.g = this.glow.getContext('2d');
    this.b = [mk(2, 2), mk(2, 2), mk(2, 2)]; this.bc = this.b.map((c) => c.getContext('2d'));
    this.sum = mk(2, 2); this.sc = this.sum.getContext('2d');
    this.back = mk(2, 2); this.backc = this.back.getContext('2d', { alpha: false });
    this.arena = null;
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.rect = { x: 0, y: 0, w: 0, h: 0 };   // device-pixel rectangle that holds glow this frame
    this.bounds = [0, 0, 0, 0];
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
    this.sum.width = this.b[0].width; this.sum.height = this.b[0].height;
    this.back.width = gw; this.back.height = gh;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'high') { this.tier = 2; this.quality = 1; }
    if (mode === 'low') { this.tier = 1; this.quality = 0.7; }
    this.slowFrames = this.fastFrames = 0;
    this.resize();
  }

  // Step down when the machine cannot hold frame rate: first the backdrop resolution, then the whole
  // canvas. Creep back up when frames are fast.
  autoQuality(ms) {
    if (this.mode !== 'auto') return;
    this.frameMs += (ms - this.frameMs) * 0.05;
    if (this.frameMs > 21) this.slowFrames++; else this.slowFrames = 0;
    if (this.frameMs < 14) this.fastFrames++; else this.fastFrames = 0;
    if (this.slowFrames > 90) {
      this.slowFrames = 0;
      if (this.tier > 1) this.tier = 1;
      else if (this.quality > 0.55) { this.quality = Math.max(0.55, this.quality - 0.15); this.resize(); }
    }
    if (this.fastFrames > 900) {
      this.fastFrames = 0;
      if (this.quality < 1) { this.quality = Math.min(1, this.quality + 0.15); this.resize(); }
      else if (this.tier < 2) this.tier = 2;
    }
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
    // Bloom: three downsamples, summed at quarter resolution and folded back into the glow layer, so
    // the main canvas takes a single additive blend for the sharp glow and all of its bloom.
    const bc = this.bc, b = this.b, sc = this.sc, sw = this.sum.width, sh = this.sum.height;
    for (let i = 0; i < 3; i++) { bc[i].clearRect(0, 0, b[i].width, b[i].height); bc[i].drawImage(i ? b[i - 1] : this.glow, 0, 0, b[i].width, b[i].height); }
    sc.globalCompositeOperation = 'copy'; sc.globalAlpha = 0.55; sc.drawImage(b[0], 0, 0);
    sc.globalCompositeOperation = 'lighter';
    sc.globalAlpha = 0.42; sc.drawImage(b[1], 0, 0, sw, sh);
    sc.globalAlpha = 0.32; sc.drawImage(b[2], 0, 0, sw, sh);
    const R = this.glowRect(world, cam, W, H);
    if (R.w > 0) {
      const hx = this.glow.width / W, hy = this.glow.height / H, qx = sw / W, qy = sh / H;
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
      g.drawImage(this.sum, R.x * qx, R.y * qy, R.w * qx, R.h * qy, R.x * hx, R.y * hy, R.w * hx, R.h * hy);
    }

    // ── 2. baked scenery ──
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (!arena) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0a0d14'; ctx.fillRect(0, 0, W, H); }
    else if (this.tier >= 2) { ctx.setTransform(k, 0, 0, k, 0, 0); arena.drawBack(ctx, cam, view, time); }
    else {
      const bk = this.backc;
      bk.setTransform(gs, 0, 0, gs, 0, 0); bk.globalAlpha = 1; bk.globalCompositeOperation = 'source-over';
      arena.drawBack(bk, cam, view, time);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'copy'; ctx.drawImage(this.back, 0, 0, W, H); ctx.globalCompositeOperation = 'source-over';
    }

    // ── 3. floor: light pools and mirrored glow ──
    const wt = () => ctx.setTransform(k * z, 0, 0, k * z, k * (view.w / 2 - cam.x * z), k * (view.h / 2 - cam.y * z));
    wt();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of fs) {
      if (!f.armed || f.bladeOn < 0.05 || f.def.blade.gun) continue;
      const mx = (f.bx + f.tx) / 2, hgt = Math.max(0, -(f.by + f.ty) / 2);
      const Rr = 190 * f.scale, a = 0.34 * f.bladeOn * f.fade / (1 + hgt / 160);
      ctx.globalAlpha = a;
      ctx.drawImage(glowSprite(f.color), mx - Rr, -Rr * 0.11, Rr * 2, Rr * 0.3);
    }
    for (const fl of world.fx.flashes) {
      if (fl.y < -220) continue;
      const kf = fl.life / fl.max, Rr = fl.r * 2.2;
      ctx.globalAlpha = kf * 0.32 / (1 + -fl.y / 120);
      ctx.drawImage(glowSprite(fl.color), fl.x - Rr, -Rr * 0.1, Rr * 2, Rr * 0.28);
    }
    const refl = arena ? arena.reflect : 0.3;
    const gy = Math.round(k * ((0 - cam.y) * z + view.h / 2));
    if (R.w > 0 && gy < H) {
      // Mirror only the part of the glow rectangle that lands on the floor.
      const top = Math.max(gy, 2 * gy - (R.y + R.h)), bot = Math.min(H, 2 * gy - R.y);
      if (bot > top) {
        const fx = this.glow.width / W, fy = this.glow.height / H;
        ctx.globalAlpha = Math.min(1, refl * 0.85);
        // Source rows run bottom-up: destination y maps to source 2*gy - y.
        ctx.setTransform(1, 0, 0, -1, 0, 2 * gy);
        ctx.drawImage(this.glow, R.x * fx, (2 * gy - bot) * fy, R.w * fx, (bot - top) * fy, R.x, 2 * gy - bot, R.w, bot - top);
      }
    }

    // ── 4. bodies ──
    wt();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    for (const f of fs) {
      const hgt = f.rag ? Math.max(0, -f.j[5] - 20) : -f.y;
      if (hgt > 500 || f.phantom) continue;
      const sw2 = 36 * f.scale * (1 - Math.min(0.6, hgt / 500));
      ctx.globalAlpha = 0.34 * f.fade * (1 - Math.min(0.7, hgt / 400));
      ctx.beginPath(); ctx.ellipse(f.rag ? (f.j[2] + f.j[4]) / 2 : f.x, 1, sw2, sw2 * 0.16, 0, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    world.fx.drawSolid(ctx, arena ? arena.palette.fog : '#8a93a8');
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const f of fs) if (f.dead) this.bodyFighter(ctx, f, world);
    for (const f of fs) if (!f.dead && f !== world.player) this.bodyFighter(ctx, f, world);
    if (world.player && !world.player.dead) this.bodyFighter(ctx, world.player, world);

    // ── 5. bloom composite, restricted to where there is light ──
    if (R.w > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1;
      const gx = this.glow.width / W, gyk = this.glow.height / H;
      ctx.drawImage(this.glow, R.x * gx, R.y * gyk, R.w * gx, R.h * gyk, R.x, R.y, R.w, R.h);
    }

    // ── 6. crisp blade cores, bars, labels ──
    wt();
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    for (const f of fs) this.coreFighter(ctx, f);
    for (const p of world.projectiles.list) if (p.type === 'saber') this.saberCore(ctx, p);
    ctx.globalAlpha = 1;
    for (const f of fs) if (f.team === 1 && !f.dead && !f.def.boss && !f.phantom && f.barT > 0) this.enemyBar(ctx, f);
    world.fx.drawText(ctx);

    // ── 7. foreground ──
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (arena) arena.drawFront(ctx, cam, view, time);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  // Screen rectangle (device pixels, snapped to a 16 px grid) that contains every emissive thing this frame.
  glowRect(world, cam, W, H) {
    const B = this.bounds, R = this.rect, { k, view } = this, z = cam.zoom;
    B[0] = 1e9; B[1] = 1e9; B[2] = -1e9; B[3] = -1e9;
    const add = (x, y, r) => { if (x - r < B[0]) B[0] = x - r; if (y - r < B[1]) B[1] = y - r; if (x + r > B[2]) B[2] = x + r; if (y + r > B[3]) B[3] = y + r; };
    for (const f of world.fighters) {
      if (f.fade <= 0) continue;
      add(f.cx, f.cy, f.bladeLen + 150 * f.scale);
      const m = f.move;
      if (f.state === 'attack' && m.line) { add(f.facing > 0 ? world.maxX : world.minX, f.by, 12); add(f.x, 0, 12); }
      if (f.state === 'attack' && m.aim) {
        // Sight line: from the muzzle to wherever it leaves the arena.
        const dx = f.tx - f.bx, dy = f.ty - f.by, d = Math.hypot(dx, dy) || 1;
        add(f.tx + (dx / d) * 1100, Math.min(0, f.ty + (dy / d) * 1100), 12);
      }
      if (f.elite) add(f.x, 0, 60);
    }
    for (const p of world.projectiles.list) {
      if (p.type === 'pillar') { add(p.x, -20, 90); add(p.x, -560, 90); }
      else if (p.type === 'lob') add(p.x, p.y, p.landed ? p.r + 30 : 50);
      else if (p.type === 'bolt' || p.type === 'saber') add(p.x, p.y, 90);
      else add(p.x, -p.h * 0.5, p.h + 90);
    }
    if (world.marker) { add(world.marker.x, 0, 150); add(world.marker.x, -900, 20); }
    const fx = world.fx;
    for (const s of fx.sparks) add(s.x, s.y, 14);
    for (const s of fx.embers) add(s.x, s.y, 6);
    for (const s of fx.flashes) add(s.x, s.y, s.r * 1.3);
    for (const s of fx.rings) add(s.x, s.y, Math.max(s.r0, s.r1) + 8);
    for (const s of fx.slashes) add(s.x, s.y, s.len * 0.62);
    for (const s of fx.ghosts) add(s.j[4], s.j[5], 170);
    for (const s of fx.beams) { add(s.x, 0, 40); add(s.x, -900, 40); }
    if (B[2] < B[0]) { R.w = 0; R.h = 0; return R; }
    // World → device pixels, padded by the bloom spread, snapped outward so the edge never shimmers.
    const pad = 64 * k;
    let x0 = ((B[0] - cam.x) * z + view.w / 2) * k - pad, x1 = ((B[2] - cam.x) * z + view.w / 2) * k + pad;
    let y0 = ((B[1] - cam.y) * z + view.h / 2) * k - pad, y1 = ((B[3] - cam.y) * z + view.h / 2) * k + pad;
    x0 = Math.max(0, Math.floor(x0 / 16) * 16); y0 = Math.max(0, Math.floor(y0 / 16) * 16);
    x1 = Math.min(W, Math.ceil(x1 / 16) * 16); y1 = Math.min(H, Math.ceil(y1 / 16) * 16);
    R.x = x0; R.y = y0; R.w = Math.max(0, x1 - x0); R.h = Math.max(0, y1 - y0);
    return R;
  }

  // ───────────── glow pass ─────────────
  glowFighter(g, f, world) {
    if (f.def.deco === 'drone') return this.glowDrone(g, f, world);
    const s = f.scale, j = f.j, t = world.time, bd = f.def.blade;
    const lit = f.armed && f.bladeOn > 0.02 && !bd.gun;
    if (lit) {
      const on = f.bladeOn * f.fade, wide = bd.wide ? 1.7 : bd.thin ? 0.72 : 1;
      let x0 = f.double ? f.t2x : f.bx, y0 = f.double ? f.t2y : f.by;
      if (bd.hammer) { x0 = f.bx + (f.tx - f.bx) * 0.74; y0 = f.by + (f.ty - f.by) * 0.74; } // only the head glows
      this.trail(g, f, t);
      const fl = 1 + Math.sin(t * 47 + f.t) * 0.06, hw = bd.hammer ? 3.2 : 1;
      if (bd.hammer) g.lineCap = 'butt';
      g.strokeStyle = f.color;
      g.globalAlpha = 0.16 * on; g.lineWidth = 15 * wide * fl * (bd.hammer ? 2.2 : 1); line(g, x0, y0, f.tx, f.ty);
      g.globalAlpha = 0.42 * on; g.lineWidth = 7.5 * wide * fl * hw; line(g, x0, y0, f.tx, f.ty);
      g.globalAlpha = 0.95 * on; g.lineWidth = 3.8 * wide * hw; line(g, x0, y0, f.tx, f.ty);
      g.lineCap = 'round';
      const mx = (x0 + f.tx) / 2, my = (y0 + f.ty) / 2, R = 78 * s * (bd.wide ? 1.7 : 1) * (1 + f.heat * 0.18);
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

    if (f.tele > 0) this.glint(g, f, bd.gun || f.def.shield ? j[0] : (f.bx + f.tx) / 2, bd.gun || f.def.shield ? j[1] : (f.by + f.ty) / 2, t);
    if (f.elite) {
      const col = AURA[f.elite];
      g.strokeStyle = col; g.globalAlpha = (0.5 + Math.sin(t * 6 + f.t) * 0.2) * f.fade; g.lineWidth = 2.5;
      g.beginPath(); g.ellipse(f.x, -2, 34 * s, 6 * s, 0, 0, TAU); g.stroke();
      g.globalAlpha *= 0.5; g.drawImage(glowSprite(col), f.x - 46 * s, -14 * s, 92 * s, 24 * s);
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
    if (bd.gun) this.glowGun(g, f, t);
    if (f.def.deco === 'halo') {
      const hx = j[0], hy = j[1] - 20 * s, p2 = f.double;
      g.globalAlpha = 0.9 * f.fade; g.strokeStyle = f.color; g.lineWidth = 2.4;
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
    if (f.vent > 0) {
      // Venting hammer: a cold blue-white bloom marks the opening.
      const kq = Math.min(1, f.vent) * (0.6 + Math.sin(t * 14) * 0.2);
      g.globalAlpha = kq * 0.5; g.drawImage(glowSprite('#bfe6ff'), f.tx - 60, f.ty - 70, 120, 120);
    }
    if (f.isPlayer && world.overdrive > 0) {
      // Overdrive aura: a pulsing halo and a ring on the floor that shrinks as the time runs out.
      const kq = world.overdrive / 6, pulse = 0.7 + Math.sin(t * 16) * 0.3;
      g.globalAlpha = 0.3 * pulse; g.drawImage(glowSprite('#56e9ff'), f.cx - 90, f.cy - 100, 180, 200);
      g.strokeStyle = '#56e9ff'; g.lineWidth = 3; g.globalAlpha = 0.8 * pulse;
      g.beginPath(); g.ellipse(f.x, f.y - 2, 26 + 46 * kq, (26 + 46 * kq) * 0.18, 0, 0, TAU); g.stroke();
    }
    if (f.broken) {
      const kq = 0.5 + Math.sin(t * 12) * 0.3;
      g.globalAlpha = kq * 0.5; g.drawImage(glowSprite('#ffd36b'), j[0] - 34, j[1] - 34, 68, 68);
    }
    if (f.ribbons.length && !f.def.boss && f.def.deco !== 'wraith') this.ribbon(g, f, 0.5, true);
    g.globalAlpha = 1;
  }

  glint(g, f, px, py, t) {
    const kq = Math.min(1, f.tele / 0.42), col = f.teleRed ? '#ff2038' : '#ffffff';
    const Lr = (f.teleRed ? 54 : 38) * (0.4 + kq), a = t * 3;
    g.globalAlpha = Math.min(1, kq * 2); g.strokeStyle = col; g.lineWidth = f.teleRed ? 3.4 : 2.4;
    line(g, px - Math.cos(a) * Lr, py - Math.sin(a) * Lr, px + Math.cos(a) * Lr, py + Math.sin(a) * Lr);
    line(g, px + Math.sin(a) * Lr * 0.6, py - Math.cos(a) * Lr * 0.6, px - Math.sin(a) * Lr * 0.6, py + Math.cos(a) * Lr * 0.6);
    const R = (f.teleRed ? 70 : 46) * (0.5 + kq);
    g.drawImage(glowSprite(col), px - R, py - R, R * 2, R * 2);
    if (f.teleRed) { g.globalAlpha = kq; g.beginPath(); g.arc(px, py, 60 * (1 - kq) + 10, 0, TAU); g.stroke(); }
    g.globalAlpha = 1;
  }

  glowGun(g, f, t) {
    g.globalAlpha = 0.9 * f.fade; g.fillStyle = f.color; g.beginPath(); g.arc(f.tx, f.ty, 2.6, 0, TAU); g.fill();
    const m = f.move;
    if (f.state !== 'attack' || !m.aim) return;
    const until = m.dur - 0.5;
    if (f.mt >= until) return;
    const dx = f.tx - f.bx, dy = f.ty - f.by, d = Math.hypot(dx, dy) || 1, kq = Math.min(1, f.mt / m.aim[1]);
    g.strokeStyle = '#ff3048'; g.lineWidth = 1 + kq * 1.6; g.globalAlpha = (0.2 + kq * 0.7) * (0.75 + Math.sin(t * 60) * 0.25);
    line(g, f.tx, f.ty, f.tx + dx / d * 1100, f.ty + dy / d * 1100);
  }

  glowDrone(g, f, world) {
    const t = world.time, cx = f.cx, cy = f.cy;
    if (f.dead) { if (f.deadT < 0.5) { g.globalAlpha = (1 - f.deadT * 2) * f.fade; g.drawImage(glowSprite(f.color), cx - 30, cy - 30, 60, 60); g.globalAlpha = 1; } return; }
    const eye = f.tele > 0 ? '#ffffff' : f.color;
    g.globalAlpha = f.fade; g.fillStyle = eye; g.beginPath(); g.arc(cx + f.facing * 5, cy, 3.4, 0, TAU); g.fill();
    g.globalAlpha = 0.45 * f.fade; g.drawImage(glowSprite(f.color), cx - 34, cy - 34, 68, 68);
    if (!f.rag) {
      // Twin thrusters under the hull.
      g.strokeStyle = f.color; g.lineWidth = 3; g.globalAlpha = (0.5 + Math.sin(t * 40 + f.t) * 0.2) * f.fade;
      line(g, cx - 12, cy + 9, cx - 13, cy + 17); line(g, cx + 12, cy + 9, cx + 13, cy + 17);
      if (f.activeHit) { g.globalAlpha = 0.8; g.lineWidth = 5; line(g, cx, cy, cx - f.vx * 0.05, cy - f.vy * 0.05); }
    }
    if (f.tele > 0) this.glint(g, f, cx, cy, t);
    this.glowGun(g, f, t);
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
    const t = world.time;
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
      } else if (p.type === 'lob') {
        g.globalAlpha = 1; g.beginPath(); g.arc(p.x, p.y - 3, 5, 0, TAU); g.fill();
        g.globalAlpha = 0.6; g.drawImage(glowSprite(p.color), p.x - 26, p.y - 29, 52, 52);
        if (p.landed) {
          // The blast radius is drawn on the floor and fills in as the fuse burns.
          const kq = 1 - Math.max(0, p.fuse) / p.max, pulse = 0.55 + Math.sin(t * (18 + kq * 40)) * 0.3;
          g.strokeStyle = '#ff2038'; g.lineWidth = 3; g.globalAlpha = pulse;
          g.beginPath(); g.ellipse(p.x, -2, p.r, p.r * 0.16, 0, 0, TAU); g.stroke();
          g.globalAlpha = pulse * 0.6; g.lineWidth = 2;
          g.beginPath(); g.ellipse(p.x, -2, p.r * kq, p.r * 0.16 * kq, 0, 0, TAU); g.stroke();
        }
      } else if (p.type === 'pillar') {
        if (!p.fired) {
          const kq = 1 - p.delay / p.max, pulse = 0.5 + Math.sin(t * 30) * 0.25;
          g.strokeStyle = '#ff2038'; g.lineWidth = 3 + kq * 3; g.globalAlpha = pulse * (0.4 + kq * 0.6);
          line(g, p.x - p.w, -2, p.x + p.w, -2);
          g.globalAlpha = kq * 0.5; g.drawImage(glowSprite(p.color), p.x - p.w * 1.5, -30, p.w * 3, 44);
        } else {
          const a = Math.max(0, p.life / 0.4);
          g.globalAlpha = a; g.drawImage(glowSprite(p.color), p.x - p.w * 2.2, -640, p.w * 4.4, 700);
          g.globalAlpha = a * 0.9; g.drawImage(glowSprite('#ffffff'), p.x - p.w * 0.9, -600, p.w * 1.8, 640);
        }
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
        g.strokeStyle = '#ff2038'; g.globalAlpha = (0.25 + kq * 0.6) * (0.8 + Math.sin(t * 50) * 0.2) * f.fade;
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
    if (f.fade <= 0.01) return;
    if (f.def.deco === 'drone') return this.bodyDrone(ctx, f, world);
    const j = f.j, s = f.scale, lw = f.def.lineW * s, d = f.def;
    let ox = 0, oy = 0;
    if (f.vib > 0 && world.hitstop > 0) { ox = (Math.random() - 0.5) * 5; oy = (Math.random() - 0.5) * 3; }
    let alpha = f.fade;
    if (f.isPlayer && f.invuln > 0 && f.state !== 'dash' && f.state !== 'attack' && !f.rag) alpha *= 0.55 + Math.sin(world.time * 40) * 0.25;
    ctx.save();
    if (ox || oy) ctx.translate(ox, oy);
    ctx.globalAlpha = alpha;
    const body = f.flash > 0 ? '#ffffff' : BODY;
    const rim = f.tele > 0.2 ? (f.teleRed ? '#ff5060' : '#ffffff') : f.broken ? '#ffd36b' : f.elite ? AURA[f.elite] : f.phantom ? f.color : d.outline;

    if (f.ribbons.length) this.ribbon(ctx, f, 1, false);

    // A limp body draws whatever bones its ragdoll currently has, so chopped pieces stay visible.
    const rg = f.rag;
    const seg = (i) => { const a = BONES[i][0] * 2, b = BONES[i][1] * 2; ctx.moveTo(j[a], j[a + 1]); ctx.lineTo(j[b], j[b + 1]); };
    const group = (ids, rimA) => {
      ctx.beginPath();
      if (rg) { if (ids === TORSO) for (const [a, b] of rg.bones) { ctx.moveTo(rg.x[a], rg.y[a]); ctx.lineTo(rg.x[b], rg.y[b]); } }
      else for (const i of ids) seg(i);
      ctx.globalAlpha = alpha * rimA; ctx.strokeStyle = rim; ctx.lineWidth = lw + 2.6; ctx.stroke();
      ctx.globalAlpha = alpha; ctx.strokeStyle = body; ctx.lineWidth = lw; ctx.stroke();
    };
    group(FAR, 0.5);                     // far arm and leg, dimmer rim for depth
    if (d.deco === 'bulwark' || d.deco === 'horns' || d.deco === 'forge') {
      const r = (d.deco === 'bulwark' ? 10 : d.deco === 'forge' ? 15 : 13) * s;
      ctx.beginPath(); ctx.arc(j[2], j[3] + 2 * s, r, 0, TAU);
      ctx.fillStyle = body; ctx.fill(); ctx.strokeStyle = rim; ctx.lineWidth = 1.4; ctx.stroke();
    }
    group(TORSO, 1);                     // spine and near leg (or the whole ragdoll)
    const hr = 9 * s * (d.deco === 'horns' || d.deco === 'forge' ? 0.8 : 1);
    ctx.beginPath(); ctx.arc(j[0], j[1], hr, 0, TAU);
    ctx.fillStyle = body; ctx.fill(); ctx.strokeStyle = rim; ctx.lineWidth = 1.5; ctx.stroke();
    this.deco(ctx, f, hr, rim, body);
    // Hilt, shaft or rifle, then the weapon arm on top.
    if (f.armed) {
      const dx = f.tx - f.bx, dy = f.ty - f.by, dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl;
      if (d.blade.gun) {
        ctx.beginPath(); ctx.moveTo(f.bx - ux * 12, f.by - uy * 12); ctx.lineTo(f.tx, f.ty);
        ctx.strokeStyle = rim; ctx.lineWidth = 7; ctx.stroke(); ctx.strokeStyle = body; ctx.lineWidth = 4.6; ctx.stroke();
      } else if (d.blade.hammer) {
        ctx.beginPath(); ctx.moveTo(f.bx - ux * 16, f.by - uy * 16); ctx.lineTo(f.bx + dx * 0.76, f.by + dy * 0.76);
        ctx.strokeStyle = rim; ctx.lineWidth = 8; ctx.stroke(); ctx.strokeStyle = body; ctx.lineWidth = 5.4; ctx.stroke();
      } else {
        const hl = f.double ? 9 : d.blade.thin ? 16 : 7;
        ctx.beginPath(); ctx.moveTo(f.bx - ux * hl, f.by - uy * hl); ctx.lineTo(f.bx + ux * hl * (d.blade.thin ? 0.4 : 1), f.by + uy * hl * (d.blade.thin ? 0.4 : 1));
        ctx.strokeStyle = '#aeb9c8'; ctx.lineWidth = 4.2 * (d.blade.wide ? 1.5 : 1); ctx.stroke();
      }
    }
    group(ARM, 1);
    ctx.restore();
  }

  bodyDrone(ctx, f, world) {
    const cx = f.cx, cy = f.cy;
    let ang = clamp(f.vx * 0.0012, -0.5, 0.5);
    if (f.rag) ang = Math.atan2(f.j[5] - f.j[3], f.j[4] - f.j[2]) - Math.PI / 2;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(ang);
    ctx.globalAlpha = f.fade;
    const body = f.flash > 0 ? '#ffffff' : BODY, rim = f.tele > 0.2 ? '#ffffff' : f.def.outline;
    ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(-8, -9); ctx.lineTo(8, -9); ctx.lineTo(22, 0); ctx.lineTo(9, 9); ctx.lineTo(-9, 9); ctx.closePath();
    ctx.fillStyle = body; ctx.fill(); ctx.strokeStyle = rim; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(-33, -5); ctx.moveTo(22, 0); ctx.lineTo(33, -5); ctx.lineWidth = 2.4; ctx.stroke();
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
      case 'cone': // wide conical hat
        ctx.beginPath(); ctx.moveTo(hx - hr * 1.9, hy - hr * 0.25); ctx.lineTo(hx, hy - hr * 1.9); ctx.lineTo(hx + hr * 1.9, hy - hr * 0.25); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
      case 'wraith': // tall cowl sweeping back
        ctx.beginPath(); ctx.moveTo(hx + fc * hr * 0.9, hy - hr * 0.5); ctx.lineTo(hx - fc * hr * 0.2, hy - hr * 1.6); ctx.lineTo(hx - fc * hr * 2.4, hy - hr * 0.9); ctx.lineTo(hx - fc * hr * 1.0, hy + hr * 0.7); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
      case 'forge': // flat mask with two stacks
        ctx.beginPath(); ctx.rect(hx - hr * 1.15, hy - hr * 1.05, hr * 2.3, hr * 1.5); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.rect(hx - hr * 1.0, hy - hr * 1.9, hr * 0.55, hr * 0.85); ctx.rect(hx + hr * 0.45, hy - hr * 1.9, hr * 0.55, hr * 0.85); ctx.fill(); ctx.stroke(); break;
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
    const bd = f.def.blade;
    if (!f.armed || f.bladeOn < 0.05 || bd.gun) return;
    let x0 = f.double ? f.t2x : f.bx, y0 = f.double ? f.t2y : f.by;
    if (bd.hammer) { x0 = f.bx + (f.tx - f.bx) * 0.8; y0 = f.by + (f.ty - f.by) * 0.8; ctx.lineCap = 'butt'; }
    ctx.globalAlpha = Math.min(1, f.bladeOn * 1.2) * f.fade * (bd.hammer ? 0.35 + f.heat * 0.2 : 1);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.2 * (bd.hammer ? 5 : bd.wide ? 1.7 : bd.thin ? 0.8 : 1);
    line(ctx, x0, y0, f.tx, f.ty);
    ctx.lineCap = 'round';
  }

  saberCore(ctx, p) {
    const dx = Math.cos(p.ang) * p.len, dy = Math.sin(p.ang) * p.len;
    ctx.globalAlpha = 1; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5;
    line(ctx, p.x - dx, p.y - dy, p.x + dx, p.y + dy);
  }

  enemyBar(ctx, f) {
    const w = Math.max(30, 48 * f.scale), x = f.x - w / 2, y = Math.min(f.j[1], f.j[3]) - Math.max(22, 30 * f.scale);
    const a = Math.min(1, f.barT * 2) * f.fade;
    ctx.globalAlpha = a * 0.7; ctx.fillStyle = '#000'; ctx.fillRect(x - 1, y - 1, w + 2, 6);
    ctx.globalAlpha = a; ctx.fillStyle = f.color; ctx.fillRect(x, y, w * clamp(f.hp / f.maxHp, 0, 1), 4);
    if (f.posture > 1) { ctx.fillStyle = '#ffd36b'; ctx.fillRect(x, y + 6, w * clamp(f.posture / f.maxPosture, 0, 1), 2); }
    const tag = f.reads ? 'READS ' + f.reads.toUpperCase() : f.elite ? f.elite.toUpperCase() : null;
    if (tag) { ctx.fillStyle = f.reads ? f.color : AURA[f.elite]; ctx.font = '700 10px ui-sans-serif, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(tag, f.x, y - 8); }
    ctx.globalAlpha = 1;
  }
}

function line(c, x0, y0, x1, y1) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
