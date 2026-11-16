// Drawing for the things in a room that are not bodies: signal cores, supply caches, holding cells,
// the ring of a hold objective and the warning before a stampede. Each has a glow pass (additive,
// half resolution) and a solid pass, like the fighters.
import { glowSprite } from './fx.js';

const TAU = Math.PI * 2, DARK = '#0a0d14';
const poly = (c, pts) => { c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); };

export function glowProp(g, f, t) {
  const x = f.x, y = f.y, k = f.def.thing, col = f.flash > 0 ? '#ffffff' : f.color;
  g.strokeStyle = col; g.fillStyle = col;
  if (k === 'core') {
    const cy = y - 78 + Math.sin(t * 2.2 + x) * 5;
    g.globalAlpha = 0.75; g.drawImage(glowSprite(f.color), x - 60, cy - 60, 120, 120);
    // The signal: a thin line into the sky that flickers.
    g.globalAlpha = 0.25 + Math.sin(t * 17 + x) * 0.1; g.lineWidth = 3; g.beginPath(); g.moveTo(x, cy - 34); g.lineTo(x, cy - 900); g.stroke();
    g.globalAlpha = 0.9; g.lineWidth = 3; poly(g, [x, cy - 34, x + 18, cy, x, cy + 34, x - 18, cy]); g.stroke();
    g.globalAlpha = 0.35; g.drawImage(glowSprite(f.color), x - 46, y - 10, 92, 18);
  } else if (k === 'cache') {
    g.globalAlpha = 0.5; g.drawImage(glowSprite(f.color), x - 60, y - 66, 120, 100);
    g.globalAlpha = 0.9; g.lineWidth = 3; g.beginPath(); g.moveTo(x - 30, y - 26); g.lineTo(x + 30, y - 26); g.stroke();
    g.globalAlpha = 0.6 + Math.sin(t * 6) * 0.3; g.fillRect(x - 3, y - 58, 6, 6);
  } else {
    const p = 0.55 + Math.sin(t * 3 + x) * 0.2;
    g.globalAlpha = 0.3 * p; g.fillRect(x - 30, y - 130, 60, 130);
    g.globalAlpha = 0.9; g.lineWidth = 2.5;
    g.beginPath(); g.ellipse(x, y - 2, 36, 7, 0, 0, TAU); g.stroke(); g.beginPath(); g.ellipse(x, y - 132, 36, 7, 0, 0, TAU); g.stroke();
    g.globalAlpha = 0.5; g.lineWidth = 2;
    for (let i = -1; i <= 1; i++) { const bx = x + i * 30; g.beginPath(); g.moveTo(bx, y - 2); g.lineTo(bx, y - 132); g.stroke(); }
  }
  g.globalAlpha = 1;
}

export function bodyProp(ctx, f, world) {
  const x = f.x, y = f.y, k = f.def.thing, t = world.time, hot = f.flash > 0, rim = hot ? '#ffffff' : f.def.outline;
  let ox = 0;
  if (f.vib > 0 && world.hitstop > 0) ox = (Math.random() - 0.5) * 6;
  ctx.save(); ctx.translate(ox, 0); ctx.globalAlpha = f.fade; ctx.lineJoin = 'round';
  if (k === 'core') {
    const cy = y - 78 + Math.sin(t * 2.2 + x) * 5, sp = Math.sin(t * 1.6 + x) * 18;
    // Plinth, then the crystal: a diamond with one turning facet.
    ctx.fillStyle = DARK; ctx.fillRect(x - 22, y - 8, 44, 8); ctx.fillStyle = rim; ctx.fillRect(x - 22, y - 9, 44, 1.5);
    ctx.fillStyle = hot ? '#ffffff' : DARK; ctx.strokeStyle = rim; ctx.lineWidth = 2;
    poly(ctx, [x, cy - 34, x + 18, cy, x, cy + 34, x - 18, cy]); ctx.fill(); ctx.stroke();
    ctx.globalAlpha = f.fade * 0.6; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, cy - 34); ctx.lineTo(x + sp, cy); ctx.lineTo(x, cy + 34); ctx.moveTo(x - 18, cy); ctx.lineTo(x + 18, cy); ctx.stroke();
  } else if (k === 'cache') {
    ctx.fillStyle = hot ? '#ffffff' : DARK; ctx.strokeStyle = rim; ctx.lineWidth = 2;
    poly(ctx, [x - 32, y, x - 32, y - 40, x - 24, y - 48, x + 24, y - 48, x + 32, y - 40, x + 32, y]); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - 32, y - 14); ctx.lineTo(x + 32, y - 14); ctx.moveTo(x - 12, y - 48); ctx.lineTo(x - 12, y); ctx.moveTo(x + 12, y - 48); ctx.lineTo(x + 12, y); ctx.moveTo(x, y - 48); ctx.lineTo(x, y - 56); ctx.stroke();
  } else {
    // A kneeling figure behind the bars.
    ctx.strokeStyle = hot ? '#ffffff' : '#0a0d14'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - 12, y - 4); ctx.lineTo(x + 4, y - 26); ctx.lineTo(x - 2, y - 62); ctx.moveTo(x + 4, y - 26); ctx.lineTo(x + 18, y - 4); ctx.moveTo(x - 2, y - 56); ctx.lineTo(x + 12, y - 36); ctx.stroke();
    ctx.fillStyle = hot ? '#ffffff' : '#0a0d14'; ctx.beginPath(); ctx.arc(x, y - 76, 10, 0, TAU); ctx.fill();
    ctx.strokeStyle = rim; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y - 76, 10, 0, TAU); ctx.stroke();
    ctx.fillStyle = DARK; ctx.fillRect(x - 38, y - 6, 76, 6); ctx.fillRect(x - 38, y - 140, 76, 6);
    ctx.fillStyle = rim; ctx.fillRect(x - 38, y - 7, 76, 1.5); ctx.fillRect(x - 38, y - 134, 76, 1.5);
  }
  ctx.restore();
}

// The ring of a hold objective, and the warning before a herd comes through. Drawn on the floor in
// world space, under the bodies.
export function drawRoom(ctx, world, cam, view) {
  const z = world.zone, t = world.time;
  if (z) {
    ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = z.color; ctx.fillStyle = z.color;
    ctx.globalAlpha = (z.on ? 0.16 : 0.07) + Math.sin(t * 4) * 0.02; ctx.beginPath(); ctx.ellipse(z.x, 0, z.r, z.r * 0.13, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.5; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(z.x, 0, z.r, z.r * 0.13, 0, 0, TAU); ctx.stroke();
    // The charge runs round the ring.
    ctx.globalAlpha = 1; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(z.x, 0, z.r, z.r * 0.13, 0, -Math.PI / 2, -Math.PI / 2 + TAU * z.k); ctx.stroke();
    // A column of light that grows with the charge.
    const h = 60 + z.k * 420;
    ctx.globalAlpha = 0.1 + z.k * 0.2 + (z.on ? 0.06 : 0); ctx.fillRect(z.x - 5, -h, 10, h);
    ctx.globalAlpha = 0.28 + z.k * 0.3; ctx.drawImage(glowSprite(z.color), z.x - 80, -40, 160, 60);
    ctx.globalCompositeOperation = 'source-over';
  }
  const hd = world.herd;
  if (hd) {
    // Chevrons at the edge the herd will come from, pointing the way it will run, and a line along the floor.
    const half = view.w / (2 * cam.zoom), ex = cam.x - hd.dir * (half - 90), k = 1 - hd.t / hd.max, blink = 0.5 + Math.sin(t * (14 + k * 30)) * 0.5;
    ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = '#ff2038'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.25 + blink * 0.3; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(world.minX, -3); ctx.lineTo(world.maxX, -3); ctx.stroke();
    ctx.lineWidth = 9;
    for (let i = 0; i < 3; i++) {
      const cx = ex + hd.dir * i * 44;
      ctx.globalAlpha = (0.35 + blink * 0.65) * (1 - i * 0.22);
      ctx.beginPath(); ctx.moveTo(cx - hd.dir * 20, -128); ctx.lineTo(cx + hd.dir * 14, -90); ctx.lineTo(cx - hd.dir * 20, -52); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = 1;
}
