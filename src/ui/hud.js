// HUD, banners and menus, drawn on the game canvas in logical (720-high) units.
import { clamp } from '../core/math.js';
import { RANK_NAMES, famLabel } from '../game/world.js';
import { FLOORS, DIFFS, ANOMALIES, roman, seedLabel } from '../game/gen.js';
import { AUG, AUGMENTS, RARITY, RARITY_COL } from '../game/augments.js';
import { POWERS } from '../game/powers.js';

const FONT = '"Avenir Next Condensed", "Bahnschrift", "DIN Condensed", "Roboto Condensed", "Arial Narrow", sans-serif';
const RANK_COL = ['#8fa3b8', '#8fa3b8', '#9fe8ff', '#7dffb0', '#ffd36b', '#ff6bd6'];

const MOVELIST = [
  ['MOVE', 'A / D  or  ← / →'], ['JUMP  ·  DOUBLE JUMP', 'SPACE / W'], ['DASH  (brief invulnerability)', 'SHIFT'],
  ['LIGHT STRING', 'J  J  J  J'], ['HEAVY  ·  hold to charge', 'K'], ['GUARD  ·  tap on impact to PARRY', 'L'],
  ['RIPOSTE  (after a parry)', 'J or K'], ['LAUNCHER', 'S + K   or   J J K'], ['BREAKER  ·  COMET', 'J K   ·   J J J K'],
  ['AIR STRING  ·  SPIKE', 'J J J   ·   K'], ['PLUNGE  (in the air)', 'S + K'], ['DASH CUT', 'SHIFT then J'],
  ['FOCUS POWER  (the one shown)', 'I'], ['SWITCH POWER', 'U   or   1 - 9'], ['BURST  (1 focus, while hit or down)', 'I'], ['OVERDRIVE  (full focus)', 'O'],
  ['RECOVER  (as you hit the floor)', 'SHIFT'], ['PAUSE  ·  GRAPHICS QUALITY', 'ESC   ·   G'],
];

// Rewrites a keyboard prompt in terms of the on-screen buttons.
const TOUCH_WORDS = [[/^J light.*?dash\s+/, ''], [/Chain lights, then finish with a heavy/, 'Chain LIGHT hits, then finish with HEAVY'], [/Hold L to guard/, 'Hold GUARD'], [/Tap it just/, 'Tap it just'],
  [/Hold K to charge/, 'Hold HEAVY to charge'], [/S \+ K launches/, 'Stick down + HEAVY launches'], [/then K to spike/, 'then HEAVY to spike'],
  [/I throws your saber/, 'THROW sends your saber'], [/\. I while you are being hit/, '. THROW while you are being hit'], [/O with a full meter/, 'the glowing button with a full meter'],
  [/U switches between your Focus powers, and the number keys pick one directly\. I uses the one shown/, 'SWAP switches between your Focus powers. The power button uses the one it names']];
function touchHint(s, training) {
  if (training) return 'SPAWN adds an enemy. SWAP changes power. Nothing here can end your run';
  for (const [re, to] of TOUCH_WORDS) s = s.replace(re, to);
  return s;
}

const TOUCH_MOVES = [
  ['LIGHT STRING', 'LIGHT  ×4'], ['LAUNCHER', 'stick down + HEAVY'], ['CHARGED HEAVY', 'hold HEAVY'], ['PARRY', 'tap GUARD on impact'],
  ['RIPOSTE', 'LIGHT after a parry'], ['BURST', 'power button while being hit'], ['OVERDRIVE', 'when the meter is full'],
];

// Where draft card `i` of `n` sits. The shell uses the same rectangles to hit-test taps.
export function draftCard(W, n, i) {
  const w = Math.min(300, (W - 120) / 3 - 24), gap = 30, total = n * w + (n - 1) * gap;
  return { x: W / 2 - total / 2 + i * (w + gap), y: 204, w, h: 318 };
}

export class Hud {
  constructor() {
    this.hpLag = 1; this.comboShown = 0; this.comboPop = 0; this.bossLag = 1; this.t = 0;
    this.vig = null; this.bars = 0; this.hpGrad = null; this.menuGrad = null; this.menuH = 0;
    this.wrapped = new Map(); this.widths = new Map();
  }
  // Width of a short label, measured once.
  width(ctx, s, size, spacing) {
    const key = `${size}|${spacing}|${s}`;
    let w = this.widths.get(key);
    if (w === undefined) { ctx.font = `700 ${size}px ${FONT}`; if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`; w = ctx.measureText(s).width; this.widths.set(key, w); }
    return w;
  }

  text(ctx, s, x, y, size, color, align = 'left', weight = 600, spacing = 0) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
    ctx.fillStyle = color; ctx.fillText(s, x, y);
  }
  // Break `s` into lines no wider than `max` at the given size. Results are kept, because the same
  // hint is drawn every frame and measuring text is not free.
  wrap(ctx, s, max, size, weight = 600, spacing = 0) {
    const key = `${size}|${weight}|${spacing}|${Math.round(max)}|${s}`, hit = this.wrapped.get(key);
    if (hit) return hit;
    if (this.wrapped.size > 300) this.wrapped.clear();
    ctx.font = `${weight} ${size}px ${FONT}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
    const lines = [];
    this.wrapped.set(key, lines);
    let cur = '';
    for (const word of s.split(' ')) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && ctx.measureText(next).width > max) { lines.push(cur); cur = word; } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  draw(ctx, view, world, dir, app, dt) {
    this.t += dt;
    const W = view.w, H = view.h;
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    const p = world.player;

    // Cinematic bars ease in while time is slowed.
    const slow = world.timeScale < 0.75 && app.state === 'play';
    this.bars += ((slow ? 1 : 0) - this.bars) * Math.min(1, dt * 8);
    if (this.bars > 0.01) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, 26 * this.bars); ctx.fillRect(0, H - 26 * this.bars, W, 26 * this.bars); }
    if (world.overdrive > 0 && app.state === 'play') { ctx.globalAlpha = 0.05 + Math.sin(this.t * 16) * 0.015; ctx.fillStyle = '#56e9ff'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    if (world.witch > 0 && app.state === 'play') { ctx.globalAlpha = (world.stasis > 0 ? 0.16 : 0.1) * Math.min(1, world.witch * 3); ctx.fillStyle = world.stasis > 0 ? '#8fb4ff' : '#56e9ff'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }

    if (app.state === 'play' || app.state === 'pause') {
      if (p) this.player(ctx, world, p, dt, app.touch);
      this.combo(ctx, W, world, dt);
      if (world.boss && !world.boss.remove && world.boss.y > -2000) this.boss(ctx, W, H, world, world.boss, dt, app.touch);
      if (!dir.training) {
        const s = dir.stageDef;
        this.text(ctx, `FLOOR ${s.n} / ${FLOORS}`, W - 36, 30, 17, '#ffffffdd', 'right', 700, 3);
        const where = s.kind === 'boss' ? 'KEEPER' : s.kind === 'champion' ? 'CHAMPION' : `WAVE ${dir.wave + 1} / ${dir.waveCount}`;
        this.text(ctx, `SECTOR ${roman(s.sector + 1)}  ·  ${dir.sector.name.toUpperCase()}  ·  ${where}`, W - 36, 51, 11, '#ffffff88', 'right', 600, 2);
        let y = 69;
        if (s.anomaly) { this.text(ctx, `ANOMALY  ·  ${ANOMALIES[s.anomaly].name}`, W - 36, y, 11, '#ff8fe0', 'right', 700, 2); y += 16; }
        if (dir.diff !== 'normal') this.text(ctx, DIFFS[dir.diff].name, W - 36, y, 10, '#ffffff55', 'right', 600, 3);
      } else this.text(ctx, 'TRAINING ROOM', W - 36, 34, 14, '#ffffffaa', 'right', 600, 3);
      if (dir.hint && dir.hintT > 0 && app.state === 'play' && dir.state !== 'draft') {
        const a = Math.min(1, dir.hintT, dir.training ? 1 : (11 - dir.hintT) * 2);
        const bossUp = world.boss && !world.boss.dead;
        // On a phone the bottom of the screen belongs to the thumbs, so prompts move to the top.
        const hint = app.touch ? touchHint(dir.hint, dir.training) : dir.hint;
        const lines = this.wrap(ctx, hint, W - 200, 15, 600, 1);
        const y = app.touch ? (bossUp ? 186 : 112) : (bossUp ? H - 122 : H - 46) - (lines.length - 1) * 22;
        let tw = 0;
        for (const l of lines) tw = Math.max(tw, this.width(ctx, l, 15, 1));
        ctx.globalAlpha = a * 0.55; ctx.fillStyle = '#000';
        ctx.fillRect(W / 2 - tw / 2 - 22, y - 15, tw + 44, 8 + lines.length * 22);
        ctx.globalAlpha = a;
        lines.forEach((l, i) => this.text(ctx, l, W / 2, y + 1 + i * 22, 15, '#dff6ff', 'center', 600, 1));
        ctx.globalAlpha = 1;
      }
      // Low health pulse.
      if (p && !p.dead && p.hp < p.maxHp * 0.32) this.vignette(ctx, W, H, 0.35 + Math.sin(this.t * 5) * 0.15);
    }

    const fl = world.screenFlash;
    if (fl && app.state === 'play') { ctx.globalAlpha = (fl.t / fl.max) ** 2 * 0.24; ctx.fillStyle = fl.color; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    const b = world.bannerMsg;
    if (b && app.state === 'play') this.banner(ctx, W, b);

    if (app.state === 'play' && dir.state === 'dead') this.dead(ctx, W, H, dir, app.touch);
    if (app.state === 'play' && dir.state === 'victory') this.victory(ctx, W, H, world, dir, app.touch);
    if ((app.state === 'play' || app.state === 'pause') && dir.state === 'draft' && dir.draft) this.draft(ctx, W, H, world, dir, app.touch);
    if (dir.fade > 0) { ctx.globalAlpha = dir.fade; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    if (dir.picked && app.state === 'play') {
      ctx.globalAlpha = Math.min(1, dir.picked.t * 2);
      this.text(ctx, dir.picked.name, W / 2, H / 2 - 8, 40, '#ffffff', 'center', 700, 12);
      this.text(ctx, 'ADDED TO YOUR BUILD', W / 2, H / 2 + 30, 13, '#56e9ff', 'center', 600, 5);
      ctx.globalAlpha = 1;
    }
    if (app.state === 'menu') this.menu(ctx, W, H, app);
    if (app.state === 'controls') this.controls(ctx, W, H, app.touch ? 'TAP to return' : 'ENTER or ESC to return');
    if (app.state === 'pause') this.pause(ctx, W, H, world, dir, app.touch);
    if (app.toast) { ctx.globalAlpha = Math.min(1, app.toast.t * 3); this.text(ctx, app.toast.text, W / 2, 96, 16, '#56e9ff', 'center', 700, 5); ctx.globalAlpha = 1; }
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  vignette(ctx, W, H, a) {
    if (!this.vig) {
      this.vig = document.createElement('canvas'); this.vig.width = 256; this.vig.height = 144;
      const g = this.vig.getContext('2d'), gr = g.createRadialGradient(128, 72, 50, 128, 72, 150);
      gr.addColorStop(0, '#ff203000'); gr.addColorStop(1, '#ff2030cc');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 144);
    }
    ctx.globalAlpha = a; ctx.drawImage(this.vig, 0, 0, W, H); ctx.globalAlpha = 1;
  }

  player(ctx, world, p, dt, touch) {
    const x = 36, y = 34, w = Math.min(420, 320 * Math.sqrt(p.maxHp / 100));
    const hp = Math.max(0, p.hp) / p.maxHp;
    this.hpLag += (hp - this.hpLag) * Math.min(1, dt * (hp < this.hpLag ? 2.5 : 20));
    this.text(ctx, 'INITIATE ZERO', x, y - 12, 12, '#ffffff99', 'left', 600, 3);
    this.text(ctx, `${Math.ceil(Math.max(0, p.hp))} / ${p.maxHp}`, x + w, y - 12, 11, '#ffffff66', 'right', 600, 1);
    ctx.fillStyle = '#00000088'; ctx.fillRect(x - 2, y - 2, w + 4, 14);
    ctx.fillStyle = '#ffffff1c'; ctx.fillRect(x, y, w, 10);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, w * this.hpLag, 10);
    const rally = Math.min(world.rally / p.maxHp, 1 - hp);
    if (rally > 0) { ctx.fillStyle = '#ff9a2e'; ctx.globalAlpha = 0.6 + Math.sin(this.t * 10) * 0.2; ctx.fillRect(x + w * hp, y, w * rally, 10); ctx.globalAlpha = 1; }
    if (!this.hpGrad) { this.hpGrad = ctx.createLinearGradient(x, 0, x + 320, 0); this.hpGrad.addColorStop(0, '#2bb8e0'); this.hpGrad.addColorStop(1, '#a8f4ff'); }
    ctx.fillStyle = hp < 0.32 ? '#ff5060' : this.hpGrad; ctx.fillRect(x, y, w * hp, 10);
    // Guard posture: fills as you block.
    const po = p.posture / p.maxPosture;
    if (po > 0.01) { ctx.fillStyle = '#00000088'; ctx.fillRect(x, y + 13, w * 0.6, 4); ctx.fillStyle = po > 0.75 ? '#ff6b4a' : '#ffd36b'; ctx.fillRect(x, y + 13, w * 0.6 * po, 4); }
    // Focus pips.
    const fy = y + 24, pips = Math.round(world.maxFocus / 100), pw = pips * 46;
    if (world.overdrive > 0) {
      // The meter becomes the Overdrive clock.
      const k = clamp(world.overdrive / world.odMax, 0, 1), pulse = 0.75 + Math.sin(this.t * 16) * 0.25;
      ctx.fillStyle = '#00000088'; ctx.fillRect(x - 1, fy - 1, pw - 4, 8);
      ctx.globalAlpha = pulse; ctx.fillStyle = '#e6fdff'; ctx.fillRect(x, fy, (pw - 6) * k, 6); ctx.globalAlpha = 1;
      this.text(ctx, 'OVERDRIVE', x + pw + 8, fy + 4, 11, '#e6fdff', 'left', 700, 3);
    } else {
      for (let i = 0; i < pips; i++) {
        const fx = x + i * 46, k = clamp(world.focus / 100 - i, 0, 1);
        ctx.fillStyle = '#00000088'; ctx.fillRect(fx - 1, fy - 1, 42, 8);
        ctx.fillStyle = '#ffffff1c'; ctx.fillRect(fx, fy, 40, 6);
        ctx.fillStyle = k >= 1 ? '#56e9ff' : '#2b7f96'; ctx.fillRect(fx, fy, 40 * k, 6);
      }
      const full = world.focus >= world.maxFocus;
      this.text(ctx, !p.armed ? 'SABER OUT' : full ? (touch ? 'FOCUS FULL' : 'FOCUS FULL  ·  O') : 'FOCUS', x + pw + 8, fy + 4, 11, !p.armed || full ? '#56e9ff' : '#ffffff77', 'left', full ? 700 : 600, 2);
    }
    this.powers(ctx, world, x, fy + 26, touch);
  }

  // The powers the player owns, in slot order. The selected one is lit and shows its key and cost.
  powers(ctx, world, x, y, touch) {
    const list = world.powers, pips = world.focus / 100;
    let cx = x;
    for (let i = 0; i < list.length; i++) {
      const P = POWERS[list[i]], sel = i === world.powerIdx, can = pips >= P.cost && world.overdrive <= 0;
      const label = sel ? P.name : P.short;
      const tw = this.width(ctx, label, sel ? 13 : 10, sel ? 2 : 1);
      if (sel) {
        const kw = touch ? 0 : 20, w = kw + tw + 16 + P.cost * 9, pop = world.powerT > 1.1 ? (world.powerT - 1.1) * 14 : 0;
        ctx.fillStyle = '#000000aa'; ctx.fillRect(cx - 1, y - 11 - pop, w + 2, 22 + pop * 2);
        ctx.fillStyle = can ? P.color : '#5a6878'; ctx.fillRect(cx, y + 9 + pop, w, 2);
        if (!touch) {
          ctx.strokeStyle = can ? '#ffffff' : '#8fa3b8'; ctx.lineWidth = 1.2; ctx.strokeRect(cx + 3.5, y - 7.5, 14, 15);
          this.text(ctx, 'I', cx + 10.5, y + 0.5, 11, can ? '#ffffff' : '#8fa3b8', 'center', 700, 0);
        }
        this.text(ctx, label, cx + kw + 4, y + 0.5, 13, can ? P.color : '#8fa3b8', 'left', 700, 2);
        for (let k = 0; k < P.cost; k++) { ctx.fillStyle = can ? '#56e9ff' : '#3d4a58'; ctx.fillRect(cx + kw + tw + 10 + k * 9, y - 3, 6, 6); }
        cx += w + 8;
      } else {
        const w = tw + 20;
        ctx.fillStyle = '#00000077'; ctx.fillRect(cx, y - 8, w, 16);
        if (!touch) this.text(ctx, String(i + 1), cx + 4, y + 0.5, 9, '#ffffff66', 'left', 600, 0);
        this.text(ctx, label, cx + (touch ? 6 : 13), y + 0.5, 10, can ? '#ffffffaa' : '#ffffff44', 'left', 700, 1);
        cx += w + 4;
      }
    }
    if (list.length > 1 && !touch) this.text(ctx, 'U  switch', cx + 6, y + 0.5, 10, '#ffffff66', 'left', 600, 2);
  }

  combo(ctx, W, world, dt) {
    const st = world.style;
    if (st.combo !== this.comboShown) { if (st.combo > this.comboShown) this.comboPop = 1; this.comboShown = st.combo; }
    this.comboPop = Math.max(0, this.comboPop - dt * 6);
    const x = W - 44, y = 164;
    if (st.rank > 0) {
      const col = RANK_COL[st.rank], pop = 1 + Math.max(0, st.rankT) * 0.8;
      this.text(ctx, RANK_NAMES[st.rank], x, y, 64 * pop, col, 'right', 800, 0);
      const lo = [0, 18, 42, 72, 108, 150][st.rank], hi = [18, 42, 72, 108, 150, 180][st.rank];
      const k = clamp((st.points - lo) / (hi - lo), 0, 1);
      ctx.fillStyle = '#ffffff22'; ctx.fillRect(x - 70, y + 38, 70, 3);
      ctx.fillStyle = col; ctx.fillRect(x - 70 * k, y + 38, 70 * k, 3);
      this.text(ctx, 'STYLE', x - 76, y + 39, 10, '#ffffff77', 'right', 600, 2);
    }
    if (st.combo >= 2) {
      const a = Math.min(1, st.comboT * 2);
      ctx.globalAlpha = a;
      this.text(ctx, String(st.combo), x, y + 82, 46 * (1 + this.comboPop * 0.25), '#ffffff', 'right', 800, 0);
      this.text(ctx, 'HITS', x, y + 112, 12, '#ffffffaa', 'right', 600, 4);
      // Variety read-out: tells the player when a string is going stale.
      const last = st.recent[st.recent.length - 1]; let rep = 0;
      for (const r of st.recent) if (r === last) rep++;
      if (rep >= 3) this.text(ctx, 'STALE', x, y + 138, 12, '#ff8a6b', 'right', 700, 4);
      else if (st.lastFresh > 0) this.text(ctx, 'FRESH', x, y + 138, 12, '#9ff3ff', 'right', 700, 4);
      ctx.fillStyle = '#ffffff55'; ctx.fillRect(x - 60 * clamp(st.comboT / 2.8, 0, 1), y + 122, 60 * clamp(st.comboT / 2.8, 0, 1), 2);
      ctx.globalAlpha = 1;
    }
  }

  boss(ctx, W, H, world, b, dt, touch) {
    const w = Math.min(680, W - 240), x = W / 2 - w / 2, y = touch ? 122 : H - 64;
    const hp = clamp(b.hp / b.maxHp, 0, 1);
    this.bossLag += (hp - this.bossLag) * Math.min(1, dt * (hp < this.bossLag ? 1.8 : 20));
    this.text(ctx, b.def.name, x, y - 16, 18, '#ffffff', 'left', 700, 5);
    const phase = b.ai.p3 ? 'PHASE III' : b.ai.phase >= 2 ? 'PHASE II' : null;
    this.text(ctx, phase || b.def.title.toUpperCase(), x + w, y - 15, 11, phase ? b.color : '#ffffff88', 'right', 600, 3);
    ctx.fillStyle = '#000000aa'; ctx.fillRect(x - 2, y - 2, w + 4, 14);
    ctx.fillStyle = '#ffffff18'; ctx.fillRect(x, y, w, 10);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, w * this.bossLag, 10);
    ctx.fillStyle = b.color; ctx.fillRect(x, y, w * hp, 10);
    if (world.bossChannel > 0) {
      // Preview of what the heal will restore if it is not interrupted.
      ctx.globalAlpha = 0.45 + Math.sin(this.t * 12) * 0.25; ctx.fillStyle = '#7dffb0';
      ctx.fillRect(x + w * hp, y, w * Math.min(0.2, 1 - hp), 10); ctx.globalAlpha = 1;
      ctx.fillStyle = '#7dffb0'; ctx.fillRect(x, y - 6, w * world.bossChannel, 2);
      this.text(ctx, 'RECALIBRATING   ·   INTERRUPT IT', W / 2, y - 16, 13, '#7dffb0', 'center', 700, 3);
    }
    // Tick marks where the fight changes.
    ctx.fillStyle = '#ffffff55';
    for (const m of b.def.marks || (b.def.kind === 'proctor' ? [0.6, 0.25] : [0.5])) ctx.fillRect(x + w * m, y - 2, 1.5, 14);
    const po = clamp(b.posture / b.maxPosture, 0, 1);
    ctx.fillStyle = '#ffffff18'; ctx.fillRect(x + w * 0.2, y + 15, w * 0.6, 3);
    ctx.fillStyle = b.broken ? '#ffffff' : '#ffd36b'; ctx.fillRect(W / 2 - w * 0.3 * po, y + 15, w * 0.6 * po, 3);
    if (b.reads) {
      const a = 0.75 + Math.sin(this.t * 9) * 0.25;
      ctx.globalAlpha = a; this.text(ctx, `IT HAS READ YOUR ${famLabel(b.reads)}   ·   CHANGE ATTACK`, W / 2, y + 32, 12, '#ff6b6b', 'center', 700, 2); ctx.globalAlpha = 1;
    } else if (b.broken) this.text(ctx, 'POSTURE BROKEN', W / 2, y + 32, 12, '#ffd36b', 'center', 700, 3);
    else if (b.vent > 0) { ctx.globalAlpha = 0.7 + Math.sin(this.t * 14) * 0.3; this.text(ctx, 'VENTING   ·   STRIKE NOW', W / 2, y + 32, 12, '#bfe6ff', 'center', 700, 3); ctx.globalAlpha = 1; }
    else if (b.heat >= 3) this.text(ctx, 'WHITE HOT   ·   CANNOT BE PARRIED', W / 2, y + 32, 12, '#ff6b6b', 'center', 700, 2);
  }

  banner(ctx, W, b) {
    const a = Math.min(1, (b.max - b.t) * 3, b.t * 2), y = 214;
    const slide = (1 - Math.min(1, (b.max - b.t) * 3)) * 30;
    ctx.globalAlpha = a;
    this.text(ctx, b.title, W / 2 + slide, y, 46, '#ffffff', 'center', 700, 14);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(W / 2 - 150 * a, y + 34, 300 * a, 1.5);
    if (b.sub) this.text(ctx, b.sub.toUpperCase(), W / 2 - slide, y + 56, 14, '#ffffffbb', 'center', 600, 5);
    if (b.sector !== undefined) {
      // The tower at a glance: ten sectors, the ones below you filled in.
      for (let i = 0; i < 10; i++) {
        const x = W / 2 + (i - 4.5) * 30, yy = y + 92, done = i < b.sector, here = i === b.sector;
        ctx.globalAlpha = a * (here ? 1 : done ? 0.75 : 0.3);
        ctx.fillStyle = here ? '#56e9ff' : '#ffffff';
        ctx.save(); ctx.translate(x, yy); ctx.rotate(Math.PI / 4); const r = here ? 6.5 : 4.5;
        if (done || here) ctx.fillRect(-r, -r, r * 2, r * 2); else { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.strokeRect(-r, -r, r * 2, r * 2); }
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  dead(ctx, W, H, dir, touch) {
    const a = clamp(dir.t - 0.6, 0, 1), what = dir.stageDef.restart ? 'floor' : 'wave';
    ctx.globalAlpha = a * 0.6; ctx.fillStyle = '#12020a'; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = a;
    this.text(ctx, 'YOU FELL', W / 2, H / 2 - 30, 70, '#ff5060', 'center', 800, 18);
    this.text(ctx, touch ? `TAP  to retry this ${what}` : `ENTER  retry this ${what}        ESC  menu`, W / 2, H / 2 + 40, 16, '#ffffffcc', 'center', 600, 3);
    this.text(ctx, `FLOOR ${dir.stageDef.n}  ·  your build is kept`, W / 2, H / 2 + 72, 12, '#ffffff77', 'center', 600, 3);
    ctx.globalAlpha = 1;
  }

  victory(ctx, W, H, world, dir, touch) {
    const a = clamp(dir.t, 0, 1);
    ctx.globalAlpha = a * 0.72; ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = a;
    this.text(ctx, 'EXAMINATION PASSED', W / 2, 150, 58, '#ffe2a0', 'center', 800, 14);
    this.text(ctx, `${DIFFS[dir.diff].name}   ·   RUN SEED  ${seedLabel(dir.seed)}`, W / 2, H - 56, 12, '#ffffff77', 'center', 600, 4);
    ctx.fillStyle = '#ffe2a0'; ctx.fillRect(W / 2 - 220, 192, 440, 1.5);
    const hrs = Math.floor(dir.runTime / 3600), m = Math.floor((dir.runTime % 3600) / 60), s = Math.floor(dir.runTime % 60);
    const augs = Object.values(dir.build).reduce((x, n) => x + n, 0);
    const rows = [['TIME', `${hrs ? `${hrs}:${String(m).padStart(2, '0')}` : m}:${String(s).padStart(2, '0')}`], ['FALLS', dir.deaths], ['KILLS', world.stats.kills], ['BEST COMBO', world.style.best], ['PARRIES', world.stats.parries],
      ['PERFECT DODGES', world.stats.dodges], ['POWERS USED', world.stats.powers], ['AUGMENTS', augs], ['HEALS INTERRUPTED', world.stats.interrupts], ['HITS TAKEN', world.stats.hitsTaken], ['CUTS', world.stats.cuts]];
    rows.forEach(([k, v], i) => {
      const y = 226 + i * 30;
      this.text(ctx, k, W / 2 - 20, y, 15, '#ffffff99', 'right', 600, 4);
      this.text(ctx, String(v), W / 2 + 20, y, 21, '#ffffff', 'left', 700, 2);
    });
    this.text(ctx, touch ? 'TAP  to return to the menu' : 'ENTER  return to menu', W / 2, H - 90, 15, '#ffffffcc', 'center', 600, 3);
    ctx.globalAlpha = 1;
  }

  // The choice between floors: three cards, one pick.
  draft(ctx, W, H, world, dir, touch) {
    const d = dir.draft, n = d.options.length, a = clamp(dir.t * 2.4, 0, 1);
    ctx.globalAlpha = a * 0.82; ctx.fillStyle = '#04060b'; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = a;
    this.text(ctx, d.title, W / 2, 104, 42, '#ffffff', 'center', 700, 14);
    ctx.fillStyle = '#56e9ff'; ctx.fillRect(W / 2 - 140 * a, 136, 280 * a, 1.5);
    this.text(ctx, d.sub.toUpperCase(), W / 2, 158, 13, '#ffffffaa', 'center', 600, 5);
    for (let i = 0; i < n; i++) {
      const c = draftCard(W, n, i), sel = i === d.idx, id = d.options[i];
      const rise = (1 - clamp(dir.t * 3.2 - i * 0.35, 0, 1)) ** 2 * 60 - (sel ? 10 : 0);
      const x = c.x, y = c.y + rise, w = c.w, h = c.h;
      const isP = d.type === 'power', A = isP ? POWERS[id] : AUG[id];
      const col = isP ? A.color : RARITY_COL[A.r], have = isP ? 0 : dir.build[id] || 0;
      ctx.globalAlpha = a * clamp(dir.t * 3.2 - i * 0.35, 0, 1);
      ctx.fillStyle = sel ? '#101826f2' : '#0a0f18e6'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = col; ctx.fillRect(x, y, w, sel ? 4 : 2);
      ctx.strokeStyle = sel ? col : '#ffffff22'; ctx.lineWidth = sel ? 2 : 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      if (sel) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= 0.1 + Math.sin(this.t * 4) * 0.03; ctx.fillStyle = col; ctx.fillRect(x, y, w, h); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = a; }
      this.text(ctx, isP ? 'FOCUS POWER' : RARITY[A.r], x + w / 2, y + 30, 11, col, 'center', 700, 5);
      if (!touch) this.text(ctx, String(i + 1), x + 16, y + 30, 12, '#ffffff55', 'left', 600, 0);
      const name = this.wrap(ctx, A.name.toUpperCase(), w - 36, 27, 700, 4);
      name.forEach((l, k) => this.text(ctx, l, x + w / 2, y + 74 + k * 30, 27, '#ffffff', 'center', 700, 4));
      const ty = y + 74 + name.length * 30 + 6;
      ctx.fillStyle = '#ffffff22'; ctx.fillRect(x + w / 2 - 40, ty - 8, 80, 1);
      const body = this.wrap(ctx, isP ? A.text : A.text(have + 1), w - 44, 16, 600, 0.5);
      body.forEach((l, k) => this.text(ctx, l, x + w / 2, ty + 18 + k * 23, 16, '#dfe9f5', 'center', 600, 0.5));
      if (isP) {
        const px = x + w / 2 - (A.cost * 22 - 6) / 2;
        for (let k = 0; k < A.cost; k++) { ctx.fillStyle = '#56e9ff'; ctx.fillRect(px + k * 22, y + h - 62, 16, 6); }
        this.text(ctx, `COSTS ${A.cost} FOCUS`, x + w / 2, y + h - 36, 11, '#ffffff88', 'center', 600, 3);
      } else {
        const px = x + w / 2 - (A.max * 14 - 4) / 2;
        for (let k = 0; k < A.max; k++) { ctx.fillStyle = k < have ? '#ffffffaa' : k === have ? col : '#ffffff22'; ctx.fillRect(px + k * 14, y + h - 60, 10, 4); }
        this.text(ctx, A.max === 1 ? 'ONE OF A KIND' : have ? `LEVEL ${have + 1} OF ${A.max}` : 'NEW', x + w / 2, y + h - 36, 11, '#ffffff88', 'center', 600, 3);
      }
    }
    ctx.globalAlpha = a;
    this.text(ctx, touch ? 'TAP a card to take it' : 'A / D  choose        ENTER  take        or press  1  2  3', W / 2, H - 112, 14, '#ffffffcc', 'center', 600, 3);
    // What the build already holds.
    const own = AUGMENTS.filter((g) => dir.build[g.id]).map((g) => `${g.name}${dir.build[g.id] > 1 ? ` ${roman(dir.build[g.id])}` : ''}`);
    const lines = this.wrap(ctx, own.length ? own.join('   ·   ') : 'Your build is empty', W - 220, 12, 600, 1).slice(0, 3);
    lines.forEach((l, k) => this.text(ctx, l.toUpperCase(), W / 2, H - 78 + k * 17, 12, '#ffffff66', 'center', 600, 1));
    ctx.globalAlpha = 1;
  }

  menu(ctx, W, H, app) {
    if (!this.menuGrad || this.menuH !== H) {
      const gr = this.menuGrad = ctx.createLinearGradient(0, 0, 0, H); this.menuH = H;
      // Dark behind the title and the menu row, clear across the band where the fight happens.
      gr.addColorStop(0, '#04060bd0'); gr.addColorStop(0.3, '#04060b50'); gr.addColorStop(0.46, '#04060b10'); gr.addColorStop(0.8, '#04060b10'); gr.addColorStop(0.9, '#04060ba8'); gr.addColorStop(1, '#04060bf0');
    }
    ctx.fillStyle = this.menuGrad; ctx.fillRect(0, 0, W, H);
    const cx = W / 2, ty = 150;
    this.text(ctx, 'STICKSABER', cx, ty, 112, '#ffffff', 'center', 800, 18);
    // A lit blade under the title.
    const bw = 520, pulse = 0.85 + Math.sin(this.t * 3) * 0.15;
    ctx.globalCompositeOperation = 'lighter';
    for (const [h, al] of [[26, 0.08], [12, 0.18], [5, 0.5]]) { ctx.globalAlpha = al * pulse; ctx.fillStyle = '#56e9ff'; ctx.fillRect(cx - bw / 2, ty + 70 - h / 2, bw, h); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - bw / 2, ty + 69, bw, 2);
    ctx.fillStyle = '#aeb9c8'; ctx.fillRect(cx - bw / 2 - 46, ty + 67, 46, 6);
    this.text(ctx, 'A S C E N D   T H E   S P I R E', cx, ty + 104, 14, '#ffffff99', 'center', 600, 4);
    // Menu runs along the bottom so the sparring match behind it stays visible.
    const n = app.menu.length, gap = Math.min(300, (W - 80) / n);
    app.menu.forEach((m, i) => {
      const x = cx + (i - (n - 1) / 2) * gap, y = H - 96, sel = i === app.idx;
      this.text(ctx, m.label, x, y, sel ? 21 : 16, sel ? '#56e9ff' : '#ffffffaa', 'center', sel ? 700 : 600, sel ? 3 : 2.5);
      if (sel) { ctx.fillStyle = '#56e9ff'; ctx.fillRect(x - 100, y + 19, 200, 1.5); }
      if (sel && m.note) this.text(ctx, m.note.toUpperCase(), x, y - 28, 11, '#ffffffaa', 'center', 600, 2);
    });
    this.text(ctx, app.touch ? 'TAP  to choose' : 'A / D  select      ENTER  confirm      F  fullscreen      M  mute      G  graphics', cx, H - 36, 13, '#ffffff77', 'center', 600, 3);
    this.text(ctx, `${FLOORS} FLOORS  ·  TEN SECTORS  ·  EVERY RUN DIFFERENT`, cx, ty + 128, 11, '#ffffff55', 'center', 600, 4);
  }

  controls(ctx, W, H, foot, title = 'CONTROLS') {
    ctx.fillStyle = '#04060be0'; ctx.fillRect(0, 0, W, H);
    this.text(ctx, title, W / 2, 70, 40, '#ffffff', 'center', 700, 14);
    ctx.fillStyle = '#56e9ff'; ctx.fillRect(W / 2 - 120, 100, 240, 1.5);
    MOVELIST.forEach(([k, v], i) => {
      const y = 134 + i * 27;
      this.text(ctx, k, W / 2 - 24, y, 14, '#ffffffaa', 'right', 600, 3);
      this.text(ctx, v, W / 2 + 24, y, 16, '#56e9ff', 'left', 700, 3);
    });
    this.text(ctx, 'Gamepad:  A jump   X light   Y heavy   B dash   RB guard   LB power / burst   LT switch power   stick click overdrive', W / 2, H - 74, 13, '#ffffff77', 'center', 600, 2);
    this.text(ctx, foot, W / 2, H - 44, 14, '#ffffffcc', 'center', 600, 3);
  }

  // Pause: the move list on the left, the build on the right.
  pause(ctx, W, H, world, dir, touch) {
    ctx.fillStyle = '#04060be6'; ctx.fillRect(0, 0, W, H);
    this.text(ctx, 'PAUSED', W / 2, 62, 38, '#ffffff', 'center', 700, 14);
    ctx.fillStyle = '#56e9ff'; ctx.fillRect(W / 2 - 110, 90, 220, 1.5);
    const lx = W * 0.3, rx = W * 0.58;
    (touch ? TOUCH_MOVES : MOVELIST).forEach(([k, v], i) => {
      const y = 126 + i * (touch ? 26 : 24);
      this.text(ctx, k, lx - 14, y, 12, '#ffffffaa', 'right', 600, 2);
      this.text(ctx, v, lx + 14, y, 13, '#56e9ff', 'left', 700, 2);
    });
    let y = 126;
    this.text(ctx, 'POWERS', rx, y, 12, '#ffffff77', 'left', 700, 5); y += 24;
    world.powers.forEach((id, i) => {
      const P = POWERS[id];
      this.text(ctx, `${touch ? '' : `${i + 1}   `}${P.name}`, rx, y, 14, i === world.powerIdx ? P.color : '#ffffffcc', 'left', 700, 2);
      this.text(ctx, `${P.cost} focus`, rx + 190, y, 11, '#ffffff66', 'left', 600, 1);
      y += 21;
    });
    y += 14;
    this.text(ctx, 'AUGMENTS', rx, y, 12, '#ffffff77', 'left', 700, 5); y += 24;
    const own = AUGMENTS.filter((g) => dir.build[g.id]);
    if (!own.length) this.text(ctx, dir.training ? 'None in the training room' : 'None yet. One is offered after every floor', rx, y, 13, '#ffffff77', 'left', 600, 1);
    const rows = Math.max(1, Math.floor((H - 150 - y) / 19));
    own.forEach((g, i) => {
      const col = Math.floor(i / rows), yy = y + (i % rows) * 19;
      this.text(ctx, `${g.name.toUpperCase()}${g.max > 1 ? `   ${roman(dir.build[g.id])}` : ''}`, rx + col * 200, yy, 12, RARITY_COL[g.r], 'left', 600, 1.5);
    });
    const tail = dir.training ? '' : `FLOOR ${dir.stageDef.n}      ·      ${DIFFS[dir.diff].name}      ·      SEED ${seedLabel(dir.seed)}`;
    this.text(ctx, `${touch ? '' : 'ESC resume      ·      Q quit to menu      ·      '}${tail}`, W / 2, H - 44, 13, '#ffffffcc', 'center', 600, 3);
    if (!dir.training && !touch) this.text(ctx, 'Your run is saved at the start of every floor', W / 2, H - 70, 11, '#ffffff66', 'center', 600, 2);
  }
}
