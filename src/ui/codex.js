// The codex: what carries over between runs, in three pages. Feats and the boons they earn, the
// bestiary of everything met and beaten, and the records. Also the notice shown when a feat is done.
// Drawn on the game canvas in logical (720-high) units by the HUD, which lends its text and glyphs.
import { clamp } from '../core/math.js';
import { FEATS, FEAT, BASES, SCHOOLS, KEEPERS, progress } from '../core/meta.js';
import { BOONS, BOON_IDS } from '../game/boons.js';
import { ENEMIES } from '../game/enemies.js';
import { BEAST_PLANS, BEAST_INFO } from '../game/beasts.js';
import { SURPRISES, OBJECTIVES, CHALLENGES, MODES, MODE_IDS, DIFFS, DIFF_IDS } from '../game/gen.js';
import { FORMS, FORM_IDS } from '../game/forms.js';
import { FORM_GLYPH } from './hud.js';

const CYAN = '#56e9ff', GOLD = '#ffd36b', DIM = '#ffffff55', INK = '#0a0f18f2';
export const CODEX_PAGES = ['FEATS', 'BESTIARY', 'RECORDS'];

// Tab `i` and the back control. The shell hit-tests taps and clicks against the same rectangles.
// On a phone the logical canvas shrinks to about half a CSS pixel per unit, so targets grow.
export function codexTab(W, i, touch) {
  const w = touch ? 250 : 190, h = touch ? 60 : 38, gap = touch ? 16 : 12, n = CODEX_PAGES.length;
  return { x: W / 2 - (n * w + (n - 1) * gap) / 2 + i * (w + gap), y: touch ? 92 : 96, w, h };
}
export function codexBack(W, touch) { return touch ? { x: 24, y: 20, w: 200, h: 64 } : { x: 32, y: 32, w: 136, h: 40 }; }

const ANIMAL_COL = { hound: '#ff9a5c', charger: '#ff6b5c', raptor: '#7dffb0', stalker: '#c69bff', scorpion: '#ffd24a', flyer: '#9fe8ff', ape: '#ffb347', spitter: '#b6ff5c' };
const SCHOOL_COL = { executioner: '#ff5c5c', blademaster: '#56e9ff', pikelord: '#5b8cff', phantom: '#9d5cff', warlock: '#ff6bd6' };
const SCHOOL_GLYPH = { executioner: 'skull', blademaster: 'slash', pikelord: 'long', phantom: 'ghost', warlock: 'star' };
const KEEPER_INFO = {
  forgemaster: { name: 'FORGEMASTER', col: ENEMIES.forgemaster?.color || '#ff8a3a', glyph: 'hammer' },
  twin: { name: 'THE TWINS', col: ENEMIES.twinA?.color || '#ffb060', glyph: 'twin' },
  cartographer: { name: 'CARTOGRAPHER', col: ENEMIES.cartographer?.color || GOLD, glyph: 'gate' },
  proctor: { name: 'THE PROCTOR', col: ENEMIES.proctor?.color || '#e6fdff', glyph: 'clock' },
  champion: { name: 'CHAMPIONS', col: GOLD, glyph: 'shield' },
  shade: { name: 'YOUR SHADE', col: '#b8c4d6', glyph: 'ghost' },
};
for (const s of SCHOOLS) KEEPER_INFO[`warden:${s}`] = { name: s.toUpperCase(), col: SCHOOL_COL[s], glyph: SCHOOL_GLYPH[s] };
const SURPRISE_GLYPH = { shade: 'ghost', blackout: 'orb', feud: 'cross', captive: 'gate', stampede: 'chev', bounty: 'drop', rival: 'twin', quake: 'bars', storm: 'bolt', cache: 'dice' };
const SURPRISE_COL = { shade: '#b8c4d6', blackout: '#8fa3b8', feud: '#ff6b5c', captive: '#7dffb0', stampede: '#ffb347', bounty: GOLD, rival: '#ff6bd6', quake: '#c8a27a', storm: '#9fe8ff', cache: '#ffe45c' };
const OBJ_COL = { survive: '#ff8a5c', hunt: GOLD, hold: CYAN, cores: '#c69bff' };

const n2s = (n) => n.toLocaleString('en-US');
const times = (n) => `× ${n2s(n)}`;
function readDaily() {
  try {
    const d = JSON.parse(localStorage.getItem('sticksaber.daily'));
    return d && d.date === new Date().toISOString().slice(0, 10) && Number.isFinite(d.score) ? d : null;
  } catch { return null; }
}

// Everything the pages show, built once from `meta.data` when the codex opens or the record changes,
// so a frame of the codex only draws.
function build(meta) {
  const D = meta.data, boons = meta.boons();
  const feats = FEATS.map((f) => {
    const [have, goal] = progress(f, D), done = !!D.done[f.id], B = BOONS[f.boon];
    const mates = FEATS.filter((g) => g.boon === f.boon);
    return { f, have, goal, done, k: have / goal, count: `${have} / ${goal}`, B, col: B?.color || CYAN,
      // A boon shared by two feats says so: each is half of it.
      unlock: `${mates.length > 1 ? 'HALF OF' : done ? 'EARNED' : 'UNLOCKS'}  ${(B?.name || f.boon).toUpperCase()}` };
  });
  const tile = (key, name, col, kind, art, beaten, seen) => ({ key, name, col, kind, art, n: beaten, state: beaten > 0 ? 2 : seen ? 1 : 0, sub: beaten > 0 ? times(beaten) : seen ? 'MET' : 'NOT YET MET' });
  const groups = [
    { label: 'ENEMIES', verb: 'BEATEN', tiles: BASES.map((b) => tile(b, (ENEMIES[b]?.name || b).toUpperCase(), ENEMIES[b]?.color || '#ff6b5c', 'fig', b, D.kills[b] || 0, D.seen[b])) },
    { label: 'ANIMALS', verb: 'BEATEN', tiles: BEAST_PLANS.map((p) => tile(p, (BEAST_INFO[p]?.name || p).toUpperCase(), ANIMAL_COL[p] || '#ff9a5c', 'beast', p, D.kills[p] || 0, D.seen[p])) },
    { label: 'KEEPERS', verb: 'BEATEN', tiles: [...KEEPERS, 'champion', 'shade'].map((k) => { const I = KEEPER_INFO[k]; return tile(k, I.name, I.col, 'glyph', I.glyph, D.bosses[k] || 0, D.seen[k]); }) },
    { label: 'SURPRISES', verb: 'LIVED THROUGH', tiles: Object.keys(SURPRISES).map((s) => tile(s, SURPRISES[s].name, SURPRISE_COL[s] || CYAN, 'glyph', SURPRISE_GLYPH[s] || 'star', D.surprises[s] || 0, false)) },
  ];
  for (const g of groups) g.tally = `${g.tiles.filter((t) => t.state === 2).length} / ${g.tiles.length}  ${g.verb}`;
  const kills = Object.values(D.kills).reduce((a, b) => a + b, 0), keepers = KEEPERS.reduce((a, k) => a + (D.bosses[k] || 0), 0);
  const stats = [['RUNS', D.runs], ['WINS', D.wins], ['FLOORS CLEARED', D.floors], ['ENEMIES CUT DOWN', kills], ['KEEPERS BEATEN', keepers], ['SHADES BANISHED', D.shades]].map(([l, v]) => ({ label: l, value: n2s(v) }));
  const best = MODE_IDS.map((m) => ({ mode: MODES[m].name, cells: DIFF_IDS.map((d) => {
    const b = D.best[`${m}:${d}`], wins = D.clears[`${m}:${d}`] || 0;
    return { diff: DIFFS[d].name, has: !!b, score: b ? n2s(b.score) : '', line: b ? `FLOOR ${b.floor}${b.won ? '  ·  CLEARED' : ''}` : 'NO RUN YET', wins: wins ? `${wins} WIN${wins > 1 ? 'S' : ''}` : '', won: !!b?.won, hard: d === 'hard' };
  }) }));
  const dl = readDaily();
  const daily = dl ? { score: n2s(dl.score), line: `FLOOR ${dl.floor}${dl.won ? '  ·  CLEARED' : ''}` } : null;
  const forms = FORM_IDS.map((id) => ({ id, name: FORMS[id].name, col: FORMS[id].color || CYAN, glyph: FORM_GLYPH[id] || 'slash', n: D.forms[id] || 0, sub: D.forms[id] ? `${n2s(D.forms[id])} FLOOR${D.forms[id] > 1 ? 'S' : ''}` : 'NOT YET USED' }));
  const tasks = [
    ...Object.keys(OBJECTIVES).map((o) => ({ name: OBJECTIVES[o].name, n: D.objectives[o] || 0, col: OBJ_COL[o] || CYAN })),
    ...Object.keys(CHALLENGES).map((c) => ({ name: CHALLENGES[c].name, n: D.feats[c] || 0, col: GOLD })),
  ].map((t) => ({ ...t, label: t.n ? `${t.name}  ${times(t.n)}` : t.name }));
  const earned = boons.length;
  return { rev: meta.rev, feats, boons: BOON_IDS.map((id) => ({ id, B: BOONS[id], on: boons.includes(id) })), earned, earnedText: `${earned} / ${BOON_IDS.length}  BOONS EARNED`,
    featText: `${feats.filter((f) => f.done).length} / ${feats.length}  FEATS DONE`, groups, stats, best, daily, forms, tasks };
}

const S = { snap: null, open: false, t: 0, page: -1 };

export function drawCodex(hud, ctx, W, H, app, dt) {
  const meta = hud.meta;
  if (app.state === 'codex' && meta) {
    if (!S.open || !S.snap || S.snap.rev !== meta.rev) S.snap = build(meta);
    if (!S.open || S.page !== (app.codexPage | 0)) { S.t = 0; S.page = app.codexPage | 0; }
    S.open = true; S.t += dt;
    page(hud, ctx, W, H, app, S.snap);
  } else S.open = false;
  if (app.feat && FEAT[app.feat.id]) notice(hud, ctx, W, app.feat, meta);
}

// Ease a card in: `i` staggers it after the ones before.
const ease = (i) => { const v = clamp(S.t * 4 - i * 0.12, 0, 1); return 1 - (1 - v) ** 3; };

function page(hud, ctx, W, H, app, snap) {
  const touch = app.touch, hover = hud.hover, u = touch ? 1.3 : 1;
  ctx.globalAlpha = 1; ctx.fillStyle = '#04060bf2'; ctx.fillRect(0, 0, W, H);
  // A faint grid behind, like a page of a ledger.
  ctx.fillStyle = '#56e9ff08';
  for (let x = (W / 2) % 64; x < W; x += 64) ctx.fillRect(x, 0, 1, H);
  for (let y = 0; y < H; y += 64) ctx.fillRect(0, y, W, 1);
  hud.text(ctx, 'CODEX', W / 2, touch ? 46 : 50, touch ? 36 : 34, '#ffffff', 'center', 700, 14);
  ctx.fillStyle = CYAN; ctx.fillRect(W / 2 - 90, touch ? 72 : 76, 180, 1.5);
  // The record's headline, top right: boons earned, as a row of pips.
  const pr = W - (touch ? 30 : 40);
  hud.text(ctx, snap.earnedText, pr, touch ? 40 : 44, 11 * u, GOLD, 'right', 700, 3);
  for (let i = 0; i < snap.boons.length; i++) {
    const b = snap.boons[i], x = pr - (snap.boons.length - 1 - i) * 16 * u - 4 * u, y = touch ? 64 : 64;
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = b.on ? b.B.color : '#ffffff1c'; ctx.fillRect(-4 * u, -4 * u, 8 * u, 8 * u); ctx.restore();
  }
  // Back control and tabs.
  const bk = codexBack(W, touch), bo = hover === 'kb';
  ctx.fillStyle = bo ? '#163240' : '#0a0f18'; ctx.fillRect(bk.x, bk.y, bk.w, bk.h);
  ctx.strokeStyle = bo ? CYAN : '#ffffff33'; ctx.lineWidth = bo ? 2 : 1; ctx.strokeRect(bk.x + 0.5, bk.y + 0.5, bk.w - 1, bk.h - 1);
  ctx.strokeStyle = bo ? CYAN : '#ffffffcc'; ctx.lineWidth = 2; ctx.beginPath();
  const ax = bk.x + 22 * u, ay = bk.y + bk.h / 2; ctx.moveTo(ax + 6 * u, ay - 7 * u); ctx.lineTo(ax - 1 * u, ay); ctx.lineTo(ax + 6 * u, ay + 7 * u); ctx.stroke();
  hud.text(ctx, 'BACK', bk.x + bk.w / 2 + 10 * u, ay + 1, 14 * u, bo ? CYAN : '#ffffffcc', 'center', 700, 4);
  for (let i = 0; i < CODEX_PAGES.length; i++) {
    const r = codexTab(W, i, touch), on = i === S.page, over = hover === `k${i}`;
    ctx.fillStyle = on ? '#56e9ff1f' : over ? '#ffffff12' : '#ffffff08'; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = on ? CYAN : over ? '#ffffff66' : '#ffffff22'; ctx.fillRect(r.x, r.y + r.h - (on ? 3 : 1), r.w, on ? 3 : 1);
    hud.text(ctx, CODEX_PAGES[i], r.x + r.w / 2, r.y + r.h / 2 + 1, (on ? 15 : 14) * u, on ? '#ffffff' : over ? '#ffffffcc' : '#ffffff88', 'center', 700, 5);
  }
  const top = touch ? 172 : 156, foot = touch ? 18 : 48;
  if (S.page === 0) feats(hud, ctx, W, H, top, H - foot, snap, u);
  else if (S.page === 1) bestiary(hud, ctx, W, H, top, H - foot, snap, u);
  else records(hud, ctx, W, H, top, H - foot, snap, u);
  if (!touch) hud.text(ctx, 'CLICK a tab   or   A / D  to turn the page        ENTER  or  ESC  to return', W / 2, H - 24, 11, '#ffffff77', 'center', 600, 3);
  ctx.globalAlpha = 1;
}

// A card's frame in the draft's language: dark, washed with its colour from the top, a bright cap.
function card(ctx, x, y, w, h, col, a, lit) {
  ctx.globalAlpha = a; ctx.fillStyle = INK; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = col;
  const bands = 5, bh = h / bands;
  for (let b = 0; b < bands; b++) { ctx.globalAlpha = a * (lit ? 0.16 : 0.06) * (1 - b / bands) ** 1.5; ctx.fillRect(x, y + b * bh, w, bh + 0.5); }
  ctx.globalAlpha = a; ctx.fillRect(x, y, w, lit ? 3 : 1.5);
  ctx.strokeStyle = lit ? `${col}aa` : '#ffffff1a'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}
function check(ctx, x, y, k, col) {
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, k * 0.22); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(x - k * 0.55, y); ctx.lineTo(x - k * 0.15, y + k * 0.4); ctx.lineTo(x + k * 0.6, y - k * 0.45); ctx.stroke();
}

function feats(hud, ctx, W, H, top, bot, snap, u) {
  const L = snap.feats, cols = 4, gap = 14, mx = W > 1400 ? 60 : 40, cw = (W - mx * 2 - gap * (cols - 1)) / cols;
  hud.text(ctx, snap.featText, mx, top + 2, 11 * u, '#ffffffaa', 'left', 700, 4);
  hud.text(ctx, 'EVERY FEAT A BOON NAMES EARNS THAT BOON  ·  BOONS ARE OFFERED BEFORE THE FIRST FLOOR', W - mx, top + 2, 10 * u, DIM, 'right', 600, 2);
  const rows = Math.ceil(L.length / cols), y0 = top + 18, ch = (bot - y0 - gap * (rows - 1)) / rows;
  for (let i = 0; i < L.length; i++) {
    const F = L[i], row = (i / cols) | 0, inRow = Math.min(cols, L.length - row * cols), c = i % cols;
    const x = W / 2 - (inRow * cw + (inRow - 1) * gap) / 2 + c * (cw + gap), a = ease(i), y = y0 + row * (ch + gap) + (1 - a) * 30;
    const col = F.col, lit = F.done;
    card(ctx, x, y, cw, ch, lit ? col : '#8fa3b8', a, lit);
    // The boon's glyph in a ring; dim until the feat is done.
    const gx = x + 40 * u, gy = y + ch * 0.42, r = 25 * u;
    ctx.globalAlpha = a * (lit ? 0.9 : 0.25); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(gx, gy, r, 0, 6.283); ctx.stroke();
    if (lit) { ctx.globalAlpha = a * 0.14; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(gx, gy, r, 0, 6.283); ctx.fill(); }
    // A ring of progress around it.
    if (!lit && F.k > 0) { ctx.globalAlpha = a; ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(gx, gy, r, -Math.PI / 2, -Math.PI / 2 + 6.283 * F.k * a); ctx.stroke(); }
    ctx.globalAlpha = a * (lit ? 1 : 0.5);
    hud.glyph(ctx, F.B?.glyph || 'star', gx, gy, 13 * u, lit ? col : '#c8d4e4');
    const tx = x + 80 * u, tw = cw - 80 * u - 14;
    ctx.globalAlpha = a;
    hud.text(ctx, F.f.name, tx, y + ch * 0.2, 17 * u, lit ? '#ffffff' : '#e3edf8', 'left', 700, 2);
    const lines = hud.wrap(ctx, F.f.text, tw, 12.5 * u, 600, 0.5);
    for (let k = 0; k < Math.min(2, lines.length); k++) hud.text(ctx, lines[k], tx, y + ch * 0.2 + 22 * u + k * 15 * u, 12.5 * u, '#ffffffaa', 'left', 600, 0.5);
    // The bar and the count.
    const by = y + ch * 0.7, bw = tw - 56 * u;
    ctx.fillStyle = '#ffffff1a'; ctx.fillRect(tx, by, bw, 4 * u);
    ctx.fillStyle = lit ? col : CYAN; ctx.fillRect(tx, by, bw * F.k * a, 4 * u);
    if (lit) check(ctx, tx + tw - 18 * u, by + 1, 10 * u, col);
    else hud.text(ctx, F.count, tx + tw, by + 2 * u, 13 * u, '#ffffffdd', 'right', 700, 1);
    hud.text(ctx, F.unlock, tx, y + ch * 0.86, 9.5 * u, lit ? col : `${col}aa`, 'left', 700, 2);
    if (lit) {
      // A done feat shimmers now and then, like a legendary card.
      const sx = ((hud.t * 0.35 + i * 0.13) % 1.6) * (cw + 60) - 30;
      if (sx < cw) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.07; ctx.fillStyle = '#ffffff'; ctx.fillRect(x + clamp(sx, 0, cw - 20), y, 20, ch); ctx.globalCompositeOperation = 'source-over'; }
    }
  }
  ctx.globalAlpha = 1;
}

function bestiary(hud, ctx, W, H, top, bot, snap, u) {
  const G = snap.groups, mx = W > 1400 ? 60 : 40, rowH = (bot - top) / G.length, gap = 8;
  let idx = 0;
  for (let g = 0; g < G.length; g++) {
    const grp = G[g], y = top + g * rowH, T = grp.tiles, n = T.length;
    hud.text(ctx, grp.label, mx, y + 4, 12 * u, '#ffffffcc', 'left', 700, 5);
    hud.text(ctx, grp.tally, W - mx, y + 4, 10.5 * u, GOLD, 'right', 700, 3);
    ctx.fillStyle = '#ffffff14'; ctx.fillRect(mx + hud.width(ctx, grp.label, 12 * u, 5) + 16, y + 4, W - mx * 2 - hud.width(ctx, grp.label, 12 * u, 5) - hud.width(ctx, grp.tally, 10.5 * u, 3) - 32, 1);
    const ty = y + 16, th = rowH - 26, tw = Math.min(150, (W - mx * 2 - gap * (n - 1)) / n), x0 = W / 2 - (n * tw + (n - 1) * gap) / 2;
    for (let i = 0; i < n; i++) {
      const t = T[i], x = x0 + i * (tw + gap), a = ease(idx++ * 0.35), cx = x + tw / 2, pic = th - 36 * u, iy = ty + pic / 2 + 2;
      card(ctx, x, ty + (1 - a) * 16, tw, th, t.state ? t.col : '#8fa3b8', a, t.state === 2);
      const yy = (1 - a) * 16;
      if (!t.state) {
        // Never met: a question mark where the picture would be, so the gap shows.
        ctx.globalAlpha = a * 0.5;
        hud.text(ctx, '?', cx, iy + yy, 30 * u, '#8fa3b8', 'center', 700, 0);
        hud.text(ctx, '? ? ?', cx, ty + th - 30 * u + yy, 11 * u, '#8fa3b8', 'center', 700, 2);
        hud.text(ctx, t.sub, cx, ty + th - 13 * u + yy, 8.5 * u, '#8fa3b888', 'center', 600, 1.5);
        continue;
      }
      const col = t.state === 2 ? t.col : '#8fa3b8';
      ctx.globalAlpha = a * (t.state === 2 ? 1 : 0.65);
      const k = Math.min(pic * 0.4, tw * 0.3);
      if (t.kind === 'fig') figure(ctx, t.art, cx, iy + yy, k, col);
      else if (t.kind === 'beast') beast(ctx, t.art, cx, iy + yy, k, col);
      else hud.glyph(ctx, t.art, cx, iy + yy, k * 0.85, col);
      ctx.globalAlpha = a;
      const nm = hud.width(ctx, t.name, 11 * u, 1) > tw - 8 ? 9.5 * u : 11 * u;
      hud.text(ctx, t.name, cx, ty + th - 30 * u + yy, nm, t.state === 2 ? '#ffffff' : '#c8d4e4', 'center', 700, 1);
      hud.text(ctx, t.sub, cx, ty + th - 13 * u + yy, 10 * u, t.state === 2 ? col : '#8fa3b8', 'center', 700, 1.5);
    }
  }
  ctx.globalAlpha = 1;
}

function records(hud, ctx, W, H, top, bot, snap, u) {
  const mx = W > 1400 ? 60 : 40, span = W - mx * 2;
  // Headline numbers.
  const st = snap.stats, sw = span / st.length;
  for (let i = 0; i < st.length; i++) {
    const s = st[i], cx = mx + sw * (i + 0.5), a = ease(i * 0.5);
    ctx.globalAlpha = a;
    hud.text(ctx, s.value, cx, top + 26 * u + (1 - a) * 12, 40 * u, i === 1 ? GOLD : '#ffffff', 'center', 700, 2);
    hud.text(ctx, s.label, cx, top + 56 * u, 10 * u, '#ffffff88', 'center', 600, 3);
    if (i) { ctx.globalAlpha = a * 0.15; ctx.fillStyle = '#ffffff'; ctx.fillRect(mx + sw * i, top + 6, 1, 60 * u); }
  }
  // Best scores: one card per length and difficulty, and today's daily at the end.
  let y = top + 84 * u;
  ctx.globalAlpha = 1;
  hud.text(ctx, 'BEST SCORES', mx, y, 12 * u, '#ffffffcc', 'left', 700, 5);
  const gap = 10, cols = 4, cw = (span - gap * (cols - 1)) / cols, rh = 66 * u;
  y += 14;
  for (let r = 0; r < snap.best.length; r++) {
    const row = snap.best[r];
    for (let c = 0; c < row.cells.length; c++) {
      const B = row.cells[c], x = mx + c * (cw + gap), yy = y + r * (rh + gap), a = ease(2 + r * 3 + c), col = B.won ? GOLD : B.hard ? '#ff6b5c' : CYAN;
      card(ctx, x, yy, cw, rh, B.has ? col : '#8fa3b8', a, B.won);
      hud.text(ctx, `${row.mode}  ·  ${B.diff}`, x + 14, yy + 16 * u, 10 * u, B.has ? col : '#8fa3b8', 'left', 700, 3);
      if (B.wins) hud.text(ctx, B.wins, x + cw - 14, yy + 16 * u, 10 * u, GOLD, 'right', 700, 2);
      if (B.has) hud.text(ctx, B.score, x + 14, yy + 40 * u, 24 * u, '#ffffff', 'left', 700, 2);
      hud.text(ctx, B.line, B.has ? x + cw - 14 : x + 14, yy + (B.has ? 42 : 40) * u, 10 * u, B.has ? '#ffffffaa' : '#8fa3b888', B.has ? 'right' : 'left', 600, 2);
    }
  }
  {
    const x = mx + 3 * (cw + gap), h = rh * 2 + gap, a = ease(9), D = snap.daily, col = '#ff9ae8';
    card(ctx, x, y, cw, h, D ? col : '#8fa3b8', a, !!D);
    ctx.globalAlpha = a;
    hud.text(ctx, "TODAY'S DAILY CLIMB", x + cw / 2, y + 18 * u, 10 * u, D ? col : '#8fa3b8', 'center', 700, 3);
    hud.glyph(ctx, 'clock', x + cw / 2, y + h * 0.45, 16 * u, D ? col : '#8fa3b866');
    if (D) {
      hud.text(ctx, D.score, x + cw / 2, y + h - 40 * u, 26 * u, '#ffffff', 'center', 700, 2);
      hud.text(ctx, D.line, x + cw / 2, y + h - 16 * u, 10 * u, '#ffffffaa', 'center', 600, 2);
    } else hud.text(ctx, 'NOT CLIMBED TODAY', x + cw / 2, y + h - 20 * u, 10 * u, '#8fa3b8aa', 'center', 600, 2);
  }
  // The weapons used, and floors of each kind cleared.
  y += rh * 2 + gap + 26 * u;
  hud.text(ctx, 'WEAPONS', mx, y, 12 * u, '#ffffffcc', 'left', 700, 5);
  hud.text(ctx, 'FLOORS CLEARED WITH EACH', mx + hud.width(ctx, 'WEAPONS', 12 * u, 5) + 16, y, 10 * u, DIM, 'left', 600, 2);
  y += 12;
  const F = snap.forms, fw = Math.min(170, (span - gap * (F.length - 1)) / F.length), fh = clamp(bot - y - 44 * u, 44 * u, 118 * u);
  const fx0 = W / 2 - (F.length * fw + (F.length - 1) * gap) / 2;
  for (let i = 0; i < F.length; i++) {
    const f = F[i], x = fx0 + i * (fw + gap), a = ease(10 + i * 0.5), on = f.n > 0;
    card(ctx, x, y, fw, fh, on ? f.col : '#8fa3b8', a, on);
    ctx.globalAlpha = a * (on ? 1 : 0.45);
    const small = fh < 80;
    hud.glyph(ctx, f.glyph, small ? x + 24 * u : x + fw / 2, small ? y + fh / 2 : y + fh * 0.34, (small ? 11 : 16) * u, on ? f.col : '#8fa3b8');
    ctx.globalAlpha = a;
    const tx = small ? x + 44 * u : x + fw / 2, al = small ? 'left' : 'center';
    hud.text(ctx, f.name, tx, small ? y + fh / 2 - 7 * u : y + fh * 0.7, 11 * u, on ? '#ffffff' : '#8fa3b8', al, 700, 1.5);
    hud.text(ctx, f.sub, tx, small ? y + fh / 2 + 9 * u : y + fh * 0.7 + 16 * u, 9 * u, on ? f.col : '#8fa3b888', al, 600, 1.5);
  }
  // Objectives and challenges met, as a line of chips.
  y += fh + 20 * u;
  let x = mx;
  const T = snap.tasks, size = 10 * u;
  let total = 0;
  for (const t of T) total += hud.width(ctx, t.label, size, 2) + 26;
  x = W / 2 - (total - 8) / 2;
  ctx.globalAlpha = ease(14);
  for (const t of T) {
    const w = hud.width(ctx, t.label, size, 2) + 18;
    ctx.fillStyle = t.n ? `${t.col}22` : '#ffffff08'; ctx.fillRect(x, y - 10 * u, w, 20 * u);
    ctx.fillStyle = t.n ? t.col : '#ffffff22'; ctx.fillRect(x, y - 10 * u, 2, 20 * u);
    hud.text(ctx, t.label, x + 10, y + 1, size, t.n ? '#ffffffdd' : '#8fa3b8aa', 'left', 700, 2);
    x += w + 8;
  }
  ctx.globalAlpha = 1;
}

// A base enemy as a small stick figure, each with the thing it is known by.
function figure(ctx, kind, x, y, k, col) {
  ctx.save(); ctx.translate(x, y); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, k * 0.1);
  const L = (...p) => { ctx.beginPath(); ctx.moveTo(p[0] * k, p[1] * k); for (let q = 2; q < p.length; q += 2) ctx.lineTo(p[q] * k, p[q + 1] * k); ctx.stroke(); };
  const O = (cx, cy, r, fill) => { ctx.beginPath(); ctx.arc(cx * k, cy * k, r * k, 0, 6.283); if (fill) ctx.fill(); else ctx.stroke(); };
  if (kind === 'drone') {
    O(0, 0, 0.36); O(0, 0, 0.12, true); L(-0.9, -0.55, 0.9, -0.55); L(0, -0.36, 0, -0.55); L(-0.25, 0.36, -0.4, 0.7); L(0.25, 0.36, 0.4, 0.7);
    ctx.restore(); return;
  }
  const big = kind === 'brute' ? 1.18 : 1;
  ctx.scale(big, big);
  if (kind === 'initiate') L(-0.24, -0.62, 0, -1.02, 0.24, -0.62); // the hood
  O(0, -0.68, 0.2);
  if (kind === 'wraith') {
    // No legs: the body trails off.
    L(0, -0.48, 0, 0.15); ctx.globalAlpha *= 0.5; L(0, 0.15, -0.2, 0.55); L(0, 0.15, 0.25, 0.7); ctx.globalAlpha *= 2;
  } else { L(0, -0.48, 0, 0.2); L(-0.32, 0.92, 0, 0.2, 0.3, 0.92); }
  switch (kind) {
    case 'marksman': L(0, -0.3, 0.45, -0.2); ctx.lineWidth *= 1.8; L(0.35, -0.24, 0.85, -0.24); break;
    case 'bulwark': L(0, -0.3, 0.3, -0.1); ctx.lineWidth *= 1.2; L(0.42, -0.6, 0.42, 0.3); L(0.42, -0.6, 0.55, -0.45, 0.55, 0.15, 0.42, 0.3); break;
    case 'duelist': L(0, -0.3, 0.32, -0.25); L(-0.4, 0.25, 0.9, -0.75); break;
    case 'brute': L(0, -0.3, 0.35, -0.15); ctx.lineWidth *= 2.4; L(0.35, -0.2, 0.75, -0.95); break;
    case 'lancer': L(0, -0.3, 0.3, -0.2); L(-0.5, 0.0, 1.0, -0.42); L(0.9, -0.5, 1.08, -0.45, 0.94, -0.33); break;
    case 'wraith': L(0, -0.3, 0.3, -0.35); L(0.3, -0.35, 0.65, -0.95); L(0, -0.3, -0.35, -0.1); break;
    default: L(0, -0.3, 0.3, -0.2); L(0.3, -0.2, 0.8, -0.85); L(0, -0.3, -0.3, -0.05);
  }
  ctx.restore();
}

// An animal by its body plan, in a few strokes.
function beast(ctx, plan, x, y, k, col) {
  ctx.save(); ctx.translate(x, y); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, k * 0.1);
  const L = (...p) => { ctx.beginPath(); ctx.moveTo(p[0] * k, p[1] * k); for (let q = 2; q < p.length; q += 2) ctx.lineTo(p[q] * k, p[q + 1] * k); ctx.stroke(); };
  const O = (cx, cy, r, fill) => { ctx.beginPath(); ctx.arc(cx * k, cy * k, r * k, 0, 6.283); if (fill) ctx.fill(); else ctx.stroke(); };
  const E = (cx, cy, rx, ry) => { ctx.beginPath(); ctx.ellipse(cx * k, cy * k, rx * k, ry * k, 0, 0, 6.283); ctx.stroke(); };
  switch (plan) {
    case 'hound': E(-0.1, 0, 0.5, 0.2); L(0.35, -0.1, 0.7, -0.35, 0.95, -0.25); L(0.6, -0.33, 0.62, -0.6); L(-0.45, 0.1, -0.55, 0.6); L(-0.25, 0.15, -0.2, 0.6); L(0.1, 0.15, 0.05, 0.6); L(0.3, 0.1, 0.4, 0.6); L(-0.6, -0.05, -0.9, -0.3); break;
    case 'charger': E(-0.1, -0.05, 0.6, 0.3); O(0.65, 0.05, 0.18); L(0.75, -0.1, 0.95, -0.4); L(0.55, -0.12, 0.45, -0.45); for (const lx of [-0.5, -0.25, 0.1, 0.35]) L(lx, 0.2, lx, 0.65); break;
    case 'raptor': E(0, -0.15, 0.35, 0.18); L(0.3, -0.25, 0.55, -0.55, 0.85, -0.5); L(-0.1, 0, -0.05, 0.35, -0.2, 0.7); L(0.1, 0, 0.2, 0.35, 0.1, 0.7); L(-0.33, -0.15, -0.95, -0.3); L(0.3, -0.15, 0.45, 0.05); break;
    case 'stalker': E(-0.05, 0.05, 0.6, 0.15); O(0.68, -0.05, 0.13); L(0.62, -0.15, 0.6, -0.3); L(0.74, -0.15, 0.78, -0.3); L(-0.45, 0.15, -0.6, 0.55); L(-0.2, 0.18, -0.2, 0.55); L(0.15, 0.18, 0.2, 0.55); L(0.4, 0.15, 0.5, 0.55); ctx.beginPath(); ctx.moveTo(-0.65 * k, 0); ctx.quadraticCurveTo(-1.0 * k, 0.1 * k, -0.9 * k, -0.4 * k); ctx.stroke(); break;
    case 'scorpion': E(0, 0.25, 0.45, 0.16); ctx.beginPath(); ctx.moveTo(-0.4 * k, 0.2 * k); ctx.bezierCurveTo(-0.95 * k, 0, -0.85 * k, -0.75 * k, -0.25 * k, -0.6 * k); ctx.stroke(); L(-0.25, -0.6, -0.1, -0.45); L(0.4, 0.2, 0.75, 0, 0.9, 0.1); L(0.75, 0, 0.85, -0.15); for (const lx of [-0.2, 0, 0.2]) L(lx, 0.35, lx - 0.15, 0.6); break;
    case 'flyer': O(0, 0, 0.18); L(-0.15, -0.05, -0.55, -0.45, -0.95, -0.2); L(0.15, -0.05, 0.55, -0.45, 0.95, -0.2); L(-0.95, -0.2, -0.6, -0.1, -0.15, 0.05); L(0.95, -0.2, 0.6, -0.1, 0.15, 0.05); L(0, 0.18, -0.1, 0.45); L(0, 0.18, 0.1, 0.45); break;
    case 'ape': O(0.1, -0.65, 0.2); E(0, -0.15, 0.32, 0.36); L(-0.25, -0.35, -0.6, 0.1, -0.55, 0.65); L(0.3, -0.35, 0.65, 0.1, 0.6, 0.65); L(-0.15, 0.2, -0.25, 0.7); L(0.15, 0.2, 0.25, 0.7); break;
    case 'spitter': E(-0.05, 0.1, 0.45, 0.3); O(0.45, -0.25, 0.17); O(0.78, -0.4, 0.07, true); O(0.95, -0.5, 0.05, true); L(-0.35, 0.35, -0.55, 0.65); L(0.2, 0.38, 0.35, 0.65); L(-0.45, 0, -0.75, -0.2); break;
    default: E(0, 0, 0.5, 0.25); for (const lx of [-0.3, 0.3]) L(lx, 0.2, lx, 0.6);
  }
  ctx.restore();
}

// A feat done during play: a card that drops in from the top for a few seconds.
function notice(hud, ctx, W, F, meta) {
  const f = FEAT[F.id], B = BOONS[f.boon], col = B?.color || GOLD, t = F.t, a = clamp(Math.min(t * 3, (F.max - t) * 4), 0, 1);
  const w = 470, h = 76, x = W / 2 - w / 2, y = 112 - (1 - a) * 24;
  ctx.globalAlpha = a; ctx.fillStyle = '#070b12'; ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = a * 0.16; ctx.fillStyle = col; ctx.fillRect(x, y, w, h * 0.5);
  ctx.globalAlpha = a; ctx.fillStyle = col; ctx.fillRect(x, y, w, 3);
  ctx.strokeStyle = `${col}aa`; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.globalAlpha = a * 0.3; ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x + 40, y + h / 2, 24, 0, 6.283); ctx.stroke();
  ctx.globalAlpha = a;
  hud.glyph(ctx, B?.glyph || 'star', x + 40, y + h / 2, 13, col);
  hud.text(ctx, 'FEAT DONE', x + 80, y + 18, 10, GOLD, 'left', 700, 5);
  hud.text(ctx, f.name, x + 80, y + 40, 21, '#ffffff', 'left', 700, 3);
  const earned = meta ? FEATS.every((g) => g.boon !== f.boon || meta.data.done[g.id]) : false;
  hud.text(ctx, earned ? `BOON EARNED  ·  ${(B?.name || '').toUpperCase()}` : `ONE STEP TO  ${(B?.name || '').toUpperCase()}`, x + 80, y + 61, 10, col, 'left', 700, 3);
  ctx.globalAlpha = 1;
}
