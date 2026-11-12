// STICKSABER audio: every sound is synthesized live with the Web Audio API. No audio files.
//
// `audio` is the game-facing API. `audioDev` exposes offline rendering and stats for
// tools/audio-test.html. Nothing here touches browser globals until `audio.init()`, so the
// module imports cleanly in Node, where every method is a silent no-op.
//
// Signal flow:
//   one-shot voices ─┐                          ┌─ reverb send ─ convolver ─┐
//   hums, loops ─────┴─ sfx bus ─┐              │                           │
//   music tracks ─────── music bus ┴─ slow-mo lowpass ◄────────────────────┘
//                                     └─ master ─ glue comp ─ limiter ─ soft clip ─ out

const RATE_LIMIT = 0.03; // s between triggers of the same one-shot name
const VOICE_CAP = 24; // simultaneous one-shot voices
const HUM_CAP = 6;
const HUM_TIMEOUT = 0.2; // s without an update before a hum fades by itself
const HUM_REAP = 0.6; // s without an update before a hum's nodes are torn down
const HUM_F = 88; // base hum frequency in Hz
const FADE = 1.5; // music crossfade, s
const LOOKAHEAD = 0.3; // music scheduling lookahead, s
const MUSIC_LEVEL = 0.75;
// Chrome's DynamicsCompressor adds fixed makeup gain (about +5.5 dB at these settings); this
// trim cancels it so a single hit passes near unity and only stacks get squeezed.
const MASTER_TRIM = 0.53;
const REV_LEVEL = 0.32;
const SLOW_MAX = 20000;
const SLOW_MIN = 650;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const num = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const smooth = (x, a, b) => {
  const u = clamp((x - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};
const fq = (f) => clamp(f, 20, 20000);

// ---------------------------------------------------------------------------------------------
// Shared tables: waveshaper curves (context-free) and noise buffers (one set per context).

const curves = new Map();
function driveCurve(amount) {
  const key = Math.round(amount * 20) / 20;
  let c = curves.get(key);
  if (c) return c;
  const n = 1024, k = 1 + key * 6, norm = Math.tanh(k);
  c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(k * ((i / (n - 1)) * 2 - 1)) / norm;
  curves.set(key, c);
  return c;
}

let crushTable = null;
function crushCurve() {
  if (crushTable) return crushTable;
  const n = 1024;
  crushTable = new Float32Array(n);
  for (let i = 0; i < n; i++) crushTable[i] = Math.round(((i / (n - 1)) * 2 - 1) * 4) / 4;
  return crushTable;
}

// Master safety clip. Input is pre-scaled by 0.5, so the curve covers signals in [-2, 2]:
// unity below 0.8, then a tanh knee that never exceeds 0.97.
let clipTable = null;
function clipCurve() {
  if (clipTable) return clipTable;
  const n = 8192, knee = 0.8, ceil = 0.97;
  clipTable = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = 2 * ((i / (n - 1)) * 2 - 1), ax = Math.abs(x);
    const y = ax < knee ? ax : knee + (ceil - knee) * Math.tanh((ax - knee) / (ceil - knee));
    clipTable[i] = Math.sign(x) * y;
  }
  return clipTable;
}

function normalize(d, peak = 0.95) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
}

function makeNoise(ctx) {
  const sr = ctx.sampleRate, n = Math.floor(sr * 2);
  const mk = (fill) => {
    const b = ctx.createBuffer(1, n, sr);
    fill(b.getChannelData(0));
    return b;
  };
  return {
    white: mk((d) => {
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }),
    pink: mk((d) => {
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = b0 + b1 + b2 + w * 0.1848;
      }
      normalize(d);
    }),
    brown: mk((d) => {
      let last = 0;
      for (let i = 0; i < n; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last;
      }
      normalize(d);
    }),
    // Sparse electrical snaps in clumps: the raw material for every crackle.
    crackle: mk((d) => {
      let dens = 0.5;
      for (let i = 0; i < n; i++) {
        if (i % 512 === 0) dens = clamp(dens + rnd(-0.3, 0.3), 0.08, 1);
        if (Math.random() < 0.0035 * dens) {
          const amp = Math.pow(Math.random(), 1.5) * (Math.random() < 0.5 ? -1 : 1);
          const len = 2 + ((Math.random() * Math.random() * 60) | 0), tau = len / 3;
          for (let j = 0; j < len && i + j < n; j++) d[i + j] += amp * Math.exp(-j / tau) * (Math.random() * 2 - 1);
        }
      }
      normalize(d);
    }),
  };
}

// A dark plate-ish impulse response: dense noise, exponential decay, darkening over time.
function makeIR(ctx, secs = 2.3) {
  const sr = ctx.sampleRate, n = Math.floor(secs * sr);
  const b = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const a = 0.9 - 0.75 * x;
      lp += a * (Math.random() * 2 - 1 - lp);
      const fadeIn = i < sr * 0.012 ? i / (sr * 0.012) : 1;
      d[i] = lp * Math.pow(1 - x, 3.2) * fadeIn;
    }
  }
  return b;
}

// ---------------------------------------------------------------------------------------------
// Envelope and automation helpers. Points are [dtSeconds, value] relative to a start time.

function ramp(param, t0, pts, exp) {
  param.setValueAtTime(pts[0][1], t0 + pts[0][0]);
  for (let i = 1; i < pts.length; i++) {
    const t = t0 + pts[i][0], v = pts[i][1];
    if (exp) param.exponentialRampToValueAtTime(Math.max(v, 1e-4), t);
    else param.linearRampToValueAtTime(v, t);
  }
}

function envLen(o) {
  return o.gp ? o.gp[o.gp.length - 1][0] : (o.a ?? 0.002) + (o.h ?? 0) + (o.d ?? 0.2) + 0.005;
}

// `gp`: linear gain points (shape normalized to 1). Otherwise attack `a`, hold `h`, and an
// exponential decay `d` down to -60 dB.
function envelope(param, t0, o, peak) {
  param.setValueAtTime(0, t0);
  if (o.gp) {
    for (const [dt, g] of o.gp) param.linearRampToValueAtTime(g * peak, t0 + dt);
    return;
  }
  const a = o.a ?? 0.002, h = o.h ?? 0, d = o.d ?? 0.2;
  param.linearRampToValueAtTime(peak, t0 + a);
  if (h > 0) param.setValueAtTime(peak, t0 + a + h);
  param.exponentialRampToValueAtTime(Math.max(peak * 1e-3, 1e-6), t0 + a + h + d);
  param.linearRampToValueAtTime(0, t0 + a + h + d + 0.005);
}

const FILTER_TYPES = { lp: 'lowpass', hp: 'highpass', bp: 'bandpass', pk: 'peaking' };

// ---------------------------------------------------------------------------------------------
// Voice: a disposable builder for one sound. One-shots and music notes both use it.
// Every layer is: sources -> envelope -> [drive] -> [filters] -> [tremolo] -> [level] -> dest.

class Voice {
  constructor(eng, t, p, out) {
    this.eng = eng;
    this.ctx = eng.ctx;
    this.t = t;
    this.p = p;
    this.out = out;
    this.end = t;
    this.srcs = [];
  }

  r(a, b) {
    return rnd(a, b);
  }

  _track(end) {
    if (end > this.end) this.end = end;
  }

  _freq(param, t0, o, p, len) {
    if (o.fp) ramp(param, t0, o.fp.map(([dt, f]) => [dt, f * p]), true);
    else {
      param.setValueAtTime(o.f * p, t0);
      if (o.to) param.exponentialRampToValueAtTime(o.to * p, t0 + (o.ft ?? len));
    }
  }

  _filter(node, key, spec, t0, len, p) {
    const f = this.ctx.createBiquadFilter();
    f.type = FILTER_TYPES[key];
    const s = typeof spec === 'number' ? { f: spec } : spec;
    f.Q.value = s.q ?? (key === 'bp' ? 1 : 0);
    if (s.gain) f.gain.value = s.gain;
    if (s.pts) ramp(f.frequency, t0, s.pts.map(([dt, v]) => [dt, fq(v * p)]), true);
    else {
      f.frequency.setValueAtTime(fq(s.f * p), t0);
      if (s.to) f.frequency.exponentialRampToValueAtTime(fq(s.to * p), t0 + (s.ft ?? len));
    }
    node.connect(f);
    return f;
  }

  _lfo(target, { rate, depth, type = 'sine' }, t0, len) {
    const c = this.ctx, l = c.createOscillator(), g = c.createGain();
    l.type = type;
    l.frequency.value = rate;
    g.gain.value = depth;
    l.connect(g);
    g.connect(target);
    l.start(t0);
    l.stop(t0 + len + 0.03);
    this.srcs.push(l);
  }

  _chain(srcs, o, t0) {
    const c = this.ctx, g = o.g ?? 1, shaped = o.drive || o.curve;
    const len = envLen(o), p = o.abs ? 1 : this.p;
    const env = c.createGain();
    // Closed from now, not just from t0: a source started between samples renders one
    // interpolated sample before t0, which the default gain of 1 would pass as a click.
    env.gain.value = 0;
    envelope(env.gain, t0, o, shaped ? 1 : g);
    for (const s of srcs) s.connect(env);
    let node = env;
    if (shaped) {
      const sh = c.createWaveShaper();
      sh.curve = o.curve === 'crush' ? crushCurve() : driveCurve(o.drive);
      node.connect(sh);
      node = sh;
    }
    for (const key in FILTER_TYPES) if (o[key]) node = this._filter(node, key, o[key], t0, len, p);
    if (o.am) {
      const a = c.createGain();
      a.gain.value = 1 - o.am.depth;
      this._lfo(a.gain, o.am, t0, len);
      node.connect(a);
      node = a;
    }
    if (shaped) {
      const lv = c.createGain();
      lv.gain.value = g;
      node.connect(lv);
      node = lv;
    }
    node.connect(o.dest || this.out);
    const end = t0 + len;
    this._track(end + 0.03);
    return end;
  }

  // Oscillator layer. f/to/ft or fp for pitch; unison: detune list in cents.
  tone(o) {
    const c = this.ctx, t0 = this.t + (o.at || 0), p = o.abs ? 1 : this.p, len = envLen(o);
    const dets = o.unison || [o.det || 0];
    const srcs = dets.map((det) => {
      const s = c.createOscillator();
      if (o.type) s.type = o.type;
      this._freq(s.frequency, t0, o, p, len);
      if (det) s.detune.value = det;
      if (o.vib) this._lfo(s.detune, o.vib, t0, len);
      return s;
    });
    const end = this._chain(srcs, o, t0);
    for (const s of srcs) {
      s.start(t0);
      s.stop(end + 0.01);
      this.srcs.push(s);
    }
    return end;
  }

  // Looped noise buffer layer, read from a random offset so repeats never line up.
  noise(o) {
    const c = this.ctx, t0 = this.t + (o.at || 0);
    const s = c.createBufferSource(), b = this.eng.buf[o.color || 'white'];
    s.buffer = b;
    s.loop = true;
    if (o.rate) s.playbackRate.value = o.rate;
    const end = this._chain([s], o, t0);
    s.start(t0, Math.random() * (b.duration - 0.05));
    s.stop(end + 0.01);
    this.srcs.push(s);
    return end;
  }

  crackle(o) {
    return this.noise({ color: 'crackle', bp: { f: 3000, q: 0.8 }, a: 0.001, d: 0.2, ...o });
  }

  click(o) {
    return this.noise({ a: 0.0004, d: 0.008, hp: 2500, ...o });
  }

  // Two-operator FM: inharmonic ratios give metal and bell partials; index decays to `index1`.
  fm(o) {
    const c = this.ctx, t0 = this.t + (o.at || 0), p = o.abs ? 1 : this.p, len = envLen(o);
    const car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain();
    const fm = o.f * p * o.ratio;
    this._freq(car.frequency, t0, o, p, len);
    mod.frequency.setValueAtTime(fm, t0);
    mg.gain.setValueAtTime(o.index * fm, t0);
    mg.gain.exponentialRampToValueAtTime(Math.max(1e-3, (o.index1 ?? o.index * 0.1) * fm), t0 + (o.it ?? len));
    mod.connect(mg);
    mg.connect(car.frequency);
    const end = this._chain([car], o, t0);
    for (const s of [car, mod]) {
      s.start(t0);
      s.stop(end + 0.01);
      this.srcs.push(s);
    }
    return end;
  }

  // Low sine drop with saturation: the weight under every impact.
  thump(f, to, d, g, o = {}) {
    return this.tone({ f, to, ft: Math.min(d * 0.45, 0.15), a: 0.001, d, g, ...o });
  }

  // Swelling band-passed noise whose center rises then falls.
  whoosh({ d, g, lo = 450, hi = 2600, end = 700, q = 1.4, color = 'white', at = 0, peak = 0.42 }) {
    const pk = d * peak;
    return this.noise({ at, color, gp: [[0, 0], [pk, 1], [d, 0]], g, bp: { pts: [[0, lo], [pk, hi], [d, end]], q } });
  }

  // Scattered glassy pings: shatter and shard textures.
  shards(n, spread, lo, hi, g, at = 0) {
    for (let i = 0; i < n; i++) {
      const f = rnd(lo, hi);
      this.fm({ at: at + Math.random() * Math.random() * spread, f, ratio: rnd(1.3, 2.9), index: rnd(0.5, 2), a: 0.0005, d: rnd(0.05, 0.2), g: g * rnd(0.5, 1) });
    }
  }

  // Parallel band-pass formant bank; returns its input node.
  bank(specs) {
    const c = this.ctx, inp = c.createGain();
    for (const [pts, q, g] of specs) {
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = q;
      ramp(f.frequency, this.t, pts.map(([dt, x]) => [dt, fq(x * this.p)]), true);
      const gg = c.createGain();
      gg.gain.value = g;
      inp.connect(f);
      f.connect(gg);
      gg.connect(this.out);
    }
    return inp;
  }

  // Sustained chord of detuned saws through a closing lowpass.
  chord(midis, o) {
    for (const m of midis) this.tone({ type: 'sawtooth', unison: [-9, 8], f: mtof(m), ...o });
  }

  // Soft bell for UI and stings.
  bell(midi, o = {}) {
    const f = mtof(midi);
    this.fm({ f, ratio: 2.0, index: 1.4, index1: 0.05, a: 0.002, d: 0.5, g: 0.12, ...o });
    this.tone({ f: f * 3.01, a: 0.001, d: (o.d ?? 0.5) * 0.4, g: (o.g ?? 0.12) * 0.18, at: o.at });
  }
}

// ---------------------------------------------------------------------------------------------
// One-shot definitions. vary: random pitch spread per play. rev: reverb send. Gains live in MIX.
// pri: 0 may be dropped under load, 2 may steal any voice.

const SFX = {
  // ----- Blades -----
  swingLight: { vary: 0.08, fn(v) {
    const d = v.r(0.16, 0.22), pk = d * v.r(0.38, 0.48);
    v.whoosh({ d, g: 0.55, hi: v.r(2200, 3000), peak: pk / d });
    v.tone({ type: 'sawtooth', unison: [-9, 9], fp: [[0, 100], [pk, 168], [d, 104]], gp: [[0, 0], [pk, 1], [d, 0]], g: 0.09, lp: { pts: [[0, 500], [pk, 2400], [d, 500]] } });
  } },
  swingHeavy: { vary: 0.07, fn(v) {
    const d = v.r(0.3, 0.38), pk = d * 0.45;
    v.whoosh({ d, g: 0.75, color: 'pink', lo: 220, hi: v.r(1200, 1600), end: 300, q: 1.1, peak: 0.45 });
    v.tone({ fp: [[0, 58], [pk, 96], [d, 54]], gp: [[0, 0], [pk, 1], [d, 0]], g: 0.32 });
    v.tone({ type: 'sawtooth', unison: [-12, 0, 11], fp: [[0, 76], [pk, 134], [d, 70]], gp: [[0, 0], [pk, 1], [d, 0]], g: 0.16, drive: 0.5, lp: { pts: [[0, 300], [pk, 1900], [d, 300]] } });
  } },
  swingSpin: { vary: 0.06, fn(v) {
    const d = v.r(0.6, 0.72), n = 5, half = d / (2 * (n + 0.5));
    const pts = [[0, 400]], gp = [[0, 0]];
    for (let i = 1; i <= n; i++) {
      const tt = (d * i) / (n + 0.5);
      pts.push([tt - half, 2300 + i * 150], [tt, 600]);
      gp.push([tt - half, 1], [tt, 0.35]);
    }
    pts.push([d, 450]);
    gp.push([d, 0]);
    v.noise({ gp, g: 0.5, bp: { pts, q: 1.5 } });
    v.tone({ type: 'sawtooth', unison: [-10, 10], fp: pts.map(([t, f]) => [t, 82 + f * 0.035]), gp, g: 0.09, lp: { pts: pts.map(([t, f]) => [t, f * 0.8]) } });
    v.tone({ fp: [[0, 64], [d * 0.5, 98], [d, 58]], gp: [[0, 0], [d * 0.3, 1], [d, 0]], g: 0.24 });
  } },
  ignite: { vary: 0.04, rev: 0.12, fn(v) {
    v.click({ g: 0.5, hp: 3000, d: 0.012 });
    v.crackle({ d: 0.3, g: 0.45, bp: { f: 3500, q: 0.7 } });
    v.noise({ a: 0.002, d: 0.45, g: 0.1, hp: 4500 });
    v.tone({ type: 'sawtooth', unison: [-14, 0, 13], fp: [[0, 38], [0.16, 108], [0.32, 92]], gp: [[0, 0], [0.03, 0.6], [0.16, 1], [0.45, 0.55], [0.85, 0]], g: 0.2, drive: 0.5, lp: { pts: [[0, 200], [0.16, 2600], [0.5, 900]], q: 3 } });
    v.tone({ fp: [[0, 30], [0.2, 46]], gp: [[0, 0], [0.15, 1], [0.8, 0]], g: 0.3 });
  } },
  extinguish: { vary: 0.04, fn(v) {
    v.tone({ type: 'sawtooth', unison: [-12, 12], fp: [[0, 92], [0.4, 28]], gp: [[0, 1], [0.15, 0.8], [0.45, 0]], g: 0.18, drive: 0.4, lp: { pts: [[0, 1600], [0.45, 120]] } });
    v.tone({ fp: [[0, 46], [0.4, 22]], gp: [[0, 1], [0.4, 0]], g: 0.2 });
    v.noise({ a: 0.005, d: 0.25, g: 0.12, hp: { f: 2500, to: 6000 } });
    v.crackle({ d: 0.18, g: 0.25 });
  } },
  throw: { vary: 0.06, fn(v) {
    const d = 0.34;
    v.whoosh({ d, g: 0.45, lo: 600, hi: 2800, end: 1600, q: 1.3, peak: 0.35 });
    v.tone({ type: 'sawtooth', unison: [-9, 9], fp: [[0, 95], [0.15, 150], [d, 130]], gp: [[0, 0], [0.1, 1], [d, 0]], g: 0.15, lp: 1800, am: { rate: 16, depth: 0.4 } });
    v.click({ g: 0.18, d: 0.006 });
  } },
  catch: { vary: 0.05, fn(v) {
    v.click({ g: 0.4, hp: 2200, d: 0.01 });
    v.thump(280, 120, 0.09, 0.45, { drive: 0.3 });
    v.tone({ type: 'sawtooth', unison: [-9, 9], f: 95, a: 0.01, d: 0.3, g: 0.12, lp: { f: 2000, to: 500 } });
    v.crackle({ d: 0.08, g: 0.2 });
  } },

  // ----- Impacts: transient click + body thump + noise burst + tonal tail -----
  hitLight: { vary: 0.07, rev: 0.08, fn(v) {
    v.click({ g: v.r(0.45, 0.6), hp: v.r(2500, 4000), d: 0.01 });
    v.thump(v.r(190, 230), 62, v.r(0.12, 0.16), 0.75, { drive: 0.35, at: 0.003 });
    v.noise({ color: 'pink', a: 0.001, d: v.r(0.07, 0.1), g: 0.55, bp: { f: v.r(1800, 2600), to: 700, q: 0.9 } });
    v.tone({ type: 'sawtooth', unison: [-11, 10], f: v.r(150, 190), to: 95, a: 0.004, d: v.r(0.2, 0.28), g: 0.15, drive: 0.7, lp: { f: 3000, to: 400 } });
    v.crackle({ d: v.r(0.12, 0.2), g: 0.35, bp: { f: v.r(3000, 5000), q: 0.9 } });
  } },
  hitHeavy: { vary: 0.06, rev: 0.12, fn(v) {
    v.click({ g: 0.7, hp: 2000, d: 0.015 });
    v.noise({ a: 0.0005, d: 0.035, g: 0.4, bp: { f: v.r(900, 1400), q: 1.2 } });
    v.thump(v.r(150, 175), 40, v.r(0.3, 0.38), 0.95, { drive: 0.55, at: 0.004, h: 0.02 });
    v.tone({ f: 52, to: 36, a: 0.005, h: 0.04, d: 0.5, g: 0.4, at: 0.01 });
    v.noise({ color: 'pink', a: 0.001, d: v.r(0.25, 0.32), g: 0.7, lp: { f: 7000, to: 300, ft: 0.25 } });
    v.tone({ type: 'sawtooth', unison: [-12, 0, 13], f: v.r(120, 150), to: 55, ft: 0.5, a: 0.005, d: 0.6, g: 0.16, drive: 0.8, lp: { f: 2200, to: 180 } });
    v.crackle({ d: v.r(0.35, 0.45), g: 0.4, bp: { f: v.r(2200, 3500), q: 0.7 } });
  } },
  hitLaunch: { vary: 0.06, rev: 0.12, fn(v) {
    v.click({ g: 0.6, hp: 2500, d: 0.012 });
    v.thump(v.r(180, 205), 55, 0.24, 0.85, { drive: 0.45, at: 0.003 });
    v.noise({ color: 'pink', a: 0.001, d: 0.12, g: 0.55, bp: { f: 2000, to: 800, q: 0.9 } });
    v.tone({ type: 'sawtooth', unison: [-10, 10], f: 160, to: 760, ft: 0.35, a: 0.01, d: 0.42, g: 0.13, drive: 0.6, bp: { f: 600, to: 2600, ft: 0.35, q: 2 } });
    v.noise({ gp: [[0, 0], [0.05, 1], [0.38, 0]], g: 0.3, bp: { f: 400, to: 3600, ft: 0.38, q: 1.5 } });
    v.tone({ f: 330, to: 990, ft: 0.3, a: 0.02, d: 0.35, g: 0.07 });
    v.crackle({ d: 0.25, g: 0.3 });
  } },
  hitSpike: { vary: 0.06, rev: 0.14, fn(v) {
    v.click({ g: 0.7, hp: 2000, d: 0.012 });
    v.tone({ type: 'sawtooth', unison: [-10, 10], f: 1300, to: 80, ft: 0.16, a: 0.002, d: 0.2, g: 0.16, bp: { f: 2400, to: 300, q: 1.5 } });
    v.thump(v.r(125, 140), 33, 0.5, 1, { drive: 0.7, at: 0.025, h: 0.03 });
    v.tone({ f: 46, a: 0.01, h: 0.05, d: 0.55, g: 0.45, at: 0.03 });
    v.noise({ color: 'pink', at: 0.02, a: 0.001, d: 0.4, g: 0.75, lp: { f: 5000, to: 200, ft: 0.35 } });
    v.crackle({ at: 0.02, d: 0.3, g: 0.35, bp: { f: 2600, q: 0.7 } });
  } },
  kill: { vary: 0.05, pri: 2, rev: 0.25, fn(v) {
    v.click({ g: 0.8, hp: 1800, d: 0.012 });
    v.noise({ a: 0.003, d: 0.38, g: 0.6, bp: { pts: [[0, 9000], [0.28, 1600]], q: 3 } });
    v.noise({ a: 0.002, d: 0.22, g: 0.3, hp: 6000 });
    v.tone({ type: 'sawtooth', f: 2600, to: 500, ft: 0.3, a: 0.003, d: 0.32, g: 0.1, drive: 0.6, bp: { f: 3000, to: 900, q: 2 } });
    v.thump(v.r(115, 125), 32, 0.75, 1, { drive: 0.6, at: 0.05, h: 0.04 });
    v.tone({ f: 41, a: 0.02, h: 0.1, d: 0.9, g: 0.45, at: 0.06 });
    v.noise({ color: 'brown', at: 0.05, a: 0.002, d: 0.3, g: 0.6, lp: 900 });
    v.crackle({ d: 0.6, g: 0.3, bp: { f: 2800, q: 0.6 } });
    v.tone({ type: 'sawtooth', unison: [-6, 6], f: 73.4, a: 0.05, d: 1.1, g: 0.06, lp: 600, at: 0.05 });
    v.tone({ type: 'sawtooth', unison: [-6, 6], f: 77.8, a: 0.05, d: 1.1, g: 0.05, lp: 600, at: 0.05 });
  } },
  sever: { vary: 0.06, pri: 2, rev: 0.15, fn(v) {
    v.noise({ a: 0.002, d: 0.2, g: 0.6, bp: { f: 7000, to: 2400, q: 4 } });
    v.click({ g: 0.5, hp: 3000, d: 0.05 });
    v.thump(200, 80, 0.13, 0.55, { drive: 0.3, at: 0.01 });
    v.noise({ at: 0.03, a: 0.04, d: 0.9, g: 0.13, hp: 5000, am: { rate: 23, depth: 0.3 } });
    v.crackle({ at: 0.02, d: 0.85, g: 0.28, bp: { f: 6000, q: 0.7 } });
    v.tone({ type: 'sawtooth', f: 900, to: 300, ft: 0.15, a: 0.002, d: 0.16, g: 0.06, bp: { f: 1800, q: 2 } });
  } },

  // ----- Defense -----
  block: { vary: 0.05, rev: 0.06, fn(v) {
    v.click({ g: 0.32, hp: 2000, d: 0.006 });
    v.thump(v.r(145, 160), 85, 0.16, 0.85, { drive: 0.4 });
    v.noise({ color: 'brown', a: 0.001, d: 0.1, g: 0.7, lp: 1200 });
    v.tone({ type: 'square', unison: [0, 70], f: 58, a: 0.003, d: 0.22, g: 0.18, drive: 0.8, lp: { f: 900, to: 250 } });
    v.crackle({ d: 0.1, g: 0.2, bp: { f: 1800, q: 0.8 } });
  } },
  // The hero sound: a G6 FM bell crack with a beating shimmer above it.
  parry: { vary: 0.015, pri: 2, rev: 0.35, fn(v) {
    v.noise({ a: 0.0003, d: 0.006, g: 0.9, hp: 1800 });
    v.noise({ a: 0.0005, d: 0.03, g: 0.45, bp: { f: 5000, q: 1 } });
    v.thump(420, 180, 0.09, 0.5);
    v.tone({ f: 2000, to: 3136, ft: 0.04, a: 0.001, d: 0.12, g: 0.13 });
    v.fm({ f: 1568, ratio: 2.414, index: 3, index1: 0.25, it: 0.4, a: 0.001, d: 1.0, g: 0.28 });
    v.tone({ f: 2352, a: 0.001, d: 0.7, g: 0.1 });
    v.tone({ f: 4327, a: 0.001, d: 0.35, g: 0.07 });
    v.tone({ f: 3136, unison: [0, 11], a: 0.02, d: 1.25, g: 0.05, am: { rate: 17, depth: 0.45 } });
    v.tone({ f: 4704, a: 0.03, d: 1.0, g: 0.03, am: { rate: 13, depth: 0.5 } });
    v.crackle({ d: 0.12, g: 0.18, bp: { f: 6000, q: 0.8 } });
  } },
  clash: { vary: 0.07, rev: 0.15, fn(v) {
    v.click({ g: 0.7, hp: 2500, d: 0.01 });
    v.crackle({ d: v.r(0.3, 0.4), g: 0.7, bp: { f: v.r(2600, 3800), q: 0.7 } });
    v.crackle({ d: 0.2, g: 0.35, hp: 6000 });
    v.tone({ type: 'sawtooth', unison: [0, v.r(80, 110)], f: v.r(140, 160), a: 0.002, d: 0.25, g: 0.2, drive: 1, lp: { f: 3000, to: 600 } });
    v.fm({ f: v.r(900, 1100), ratio: 1.73, index: 4, index1: 1, a: 0.001, d: 0.35, g: 0.13 });
    v.noise({ a: 0.0005, d: 0.05, g: 0.45, bp: { f: 2500, q: 1 } });
    v.thump(190, 90, 0.1, 0.4);
  } },
  guardBreak: { vary: 0.04, pri: 2, rev: 0.22, fn(v) {
    v.click({ g: 0.8, hp: 1500, d: 0.015 });
    v.thump(140, 45, 0.35, 0.95, { drive: 0.6 });
    v.shards(12, 0.2, 2200, 6500, 0.12);
    v.noise({ gp: [[0, 0], [0.002, 1], [0.03, 0.4], [0.05, 0.8], [0.09, 0.3], [0.12, 0.6], [0.3, 0]], g: 0.4, hp: 4000 });
    v.tone({ type: 'sawtooth', unison: [-12, 12], f: 420, to: 55, ft: 0.55, a: 0.005, d: 0.6, g: 0.16, drive: 0.6, lp: { f: 2000, to: 200 } });
    v.crackle({ d: 0.5, g: 0.45 });
  } },
  deflected: { vary: 0.05, rev: 0.1, fn(v) {
    v.click({ g: 0.35, d: 0.008 });
    v.thump(330, 240, 0.12, 0.55);
    v.tone({ type: 'square', f: 165, a: 0.002, d: 0.1, g: 0.18, lp: 800 });
    v.tone({ f: 620, to: 400, ft: 0.3, a: 0.002, d: 0.35, g: 0.16, vib: { rate: 22, depth: 45 } });
    v.noise({ color: 'brown', a: 0.001, d: 0.06, g: 0.5, lp: 1500 });
  } },

  // ----- Movement -----
  jump: { vary: 0.08, fn(v) {
    v.noise({ color: 'pink', gp: [[0, 0], [0.04, 1], [0.18, 0]], g: 0.35, bp: { f: 300, to: 1400, ft: 0.15, q: 1.2 } });
    v.thump(160, 90, 0.06, 0.3);
  } },
  doubleJump: { vary: 0.06, fn(v) {
    v.noise({ gp: [[0, 0], [0.05, 1], [0.22, 0]], g: 0.3, bp: { f: 600, to: 2600, ft: 0.2, q: 1.3 } });
    v.tone({ f: 500, to: 1300, ft: 0.12, a: 0.005, d: 0.18, g: 0.08 });
    v.tone({ f: 750, to: 1950, ft: 0.12, a: 0.005, d: 0.15, g: 0.04 });
    v.crackle({ d: 0.1, g: 0.12 });
  } },
  dash: { vary: 0.07, fn(v) {
    v.noise({ gp: [[0, 0], [0.06, 1], [0.24, 0]], g: 0.45, bp: { pts: [[0, 1200], [0.07, 3500], [0.24, 800]], q: 1.5 } });
    v.tone({ type: 'sawtooth', f: 2400, to: 300, ft: 0.15, a: 0.003, d: 0.15, g: 0.08, bp: { f: 2000, to: 600, q: 3 } });
    v.thump(85, 50, 0.08, 0.22);
  } },
  land: { vary: 0.08, fn(v) {
    v.thump(110, 48, 0.1, 0.55);
    v.noise({ color: 'brown', a: 0.001, d: 0.07, g: 0.5, lp: 900 });
  } },
  landHeavy: { vary: 0.06, fn(v) {
    v.click({ g: 0.3, hp: 1500, d: 0.01 });
    v.thump(90, 32, 0.3, 0.9, { drive: 0.5 });
    v.noise({ color: 'brown', a: 0.001, d: 0.25, g: 0.8, lp: { f: 1800, to: 200 } });
    v.noise({ color: 'pink', a: 0.002, d: 0.15, g: 0.3, bp: { f: 600, q: 1 } });
  } },
  footstep: { vary: 0.12, pri: 0, fn(v) {
    v.noise({ color: 'brown', a: 0.001, d: 0.04, g: 0.6, lp: v.r(500, 900) });
    v.click({ g: 0.15, hp: 3000, d: 0.004 });
  } },
  thud: { vary: 0.1, fn(v) {
    v.thump(v.r(85, 105), 40, 0.18, 0.8, { drive: 0.3 });
    v.noise({ color: 'brown', a: 0.001, d: 0.1, g: 0.6, lp: v.r(600, 1200) });
    v.click({ g: 0.18, hp: 1500, d: 0.006 });
  } },
  bounce: { vary: 0.1, fn(v) {
    v.thump(140, 70, 0.1, 0.5);
    v.noise({ color: 'brown', a: 0.001, d: 0.05, g: 0.4, lp: 1000 });
  } },
  wallSplat: { vary: 0.07, fn(v) {
    v.thump(120, 45, 0.22, 0.9, { drive: 0.4 });
    v.noise({ a: 0.001, d: 0.05, g: 0.6, bp: { f: 1400, q: 1.2 } });
    v.noise({ color: 'pink', gp: [[0, 0], [0.003, 1], [0.03, 0.3], [0.05, 0.7], [0.12, 0]], g: 0.3, bp: { f: 3000, q: 1 } });
    v.noise({ color: 'brown', a: 0.001, d: 0.15, g: 0.6, lp: 1200 });
  } },

  // ----- Warnings: a clean high glint vs. a low dissonant buzz -----
  telegraph: { vary: 0.01, pri: 2, rev: 0.3, fn(v) {
    v.fm({ f: 2637, ratio: 2, index: 0.6, index1: 0.05, a: 0.001, d: 0.3, g: 0.16 });
    v.fm({ at: 0.06, f: 3951, ratio: 2, index: 0.5, index1: 0.05, a: 0.001, d: 0.45, g: 0.15 });
    v.tone({ at: 0.06, f: 7902, a: 0.001, d: 0.2, g: 0.025 });
    v.noise({ a: 0.001, d: 0.03, g: 0.08, hp: 7000 });
  } },
  telegraphRed: { vary: 0.01, pri: 2, fn(v) {
    for (const at of [0, 0.15]) {
      v.tone({ at, type: 'sawtooth', unison: [0, 100, 600], f: 196, a: 0.004, h: 0.06, d: 0.13, g: 0.22, drive: 1.3, lp: { f: 2800, to: 900 } });
    }
    v.tone({ type: 'square', f: 49, a: 0.005, h: 0.22, d: 0.15, g: 0.2, lp: 300 });
    v.noise({ color: 'pink', a: 0.002, h: 0.2, d: 0.12, g: 0.08, bp: { f: 600, q: 2 } });
  } },

  // ----- Enemies and boss -----
  bolt: { vary: 0.06, fn(v) {
    v.tone({ type: 'square', f: 1400, to: 350, ft: 0.12, a: 0.002, d: 0.16, g: 0.14, drive: 0.3, bp: { f: 1800, q: 2 } });
    v.tone({ f: 900, to: 200, ft: 0.14, a: 0.002, d: 0.15, g: 0.25 });
    v.noise({ a: 0.001, d: 0.05, g: 0.2, hp: 3000 });
    v.crackle({ d: 0.12, g: 0.22 });
  } },
  boltReflect: { vary: 0.03, rev: 0.2, fn(v) {
    v.click({ g: 0.4, d: 0.006 });
    v.fm({ f: 1760, ratio: 2.414, index: 2, index1: 0.2, a: 0.001, d: 0.3, g: 0.16 });
    v.tone({ type: 'sawtooth', f: 300, to: 1800, ft: 0.12, a: 0.002, d: 0.16, g: 0.1, lp: 3000 });
    v.crackle({ d: 0.1, g: 0.2 });
  } },
  shockwave: { vary: 0.05, pri: 2, rev: 0.2, fn(v) {
    v.click({ g: 0.6, hp: 1500, d: 0.015 });
    v.tone({ f: 72, to: 28, ft: 0.8, a: 0.003, h: 0.05, d: 1.0, g: 0.85, drive: 0.5 });
    v.noise({ color: 'pink', a: 0.004, d: 0.95, g: 0.55, lp: { f: 4000, to: 150, ft: 0.9 } });
    v.crackle({ d: 0.6, g: 0.35, bp: { f: 2000, q: 0.6 } });
  } },
  slam: { vary: 0.05, pri: 2, rev: 0.15, fn(v) {
    v.click({ g: 0.8, hp: 1500, d: 0.015 });
    v.thump(110, 34, 0.6, 1, { drive: 0.8, h: 0.03 });
    v.tone({ f: 45, a: 0.01, h: 0.05, d: 0.75, g: 0.45 });
    v.noise({ color: 'brown', a: 0.001, d: 0.5, g: 0.9, lp: { f: 2500, to: 150 } });
    v.noise({ color: 'pink', gp: [[0, 0], [0.005, 1], [0.05, 0.4], [0.09, 0.7], [0.3, 0]], g: 0.35, bp: { f: 1200, q: 1 } });
  } },
  bossRoar: { vary: 0.05, pri: 2, rev: 0.3, fn(v) {
    const D = v.r(1.6, 1.8);
    const bank = v.bank([
      [[[0, 520], [0.5, 720], [1.2, 480], [D, 400]], 6, 2.2],
      [[[0, 1000], [0.5, 1250], [1.2, 880], [D, 760]], 7, 1.5],
      [[[0, 2400], [D, 2150]], 8, 0.8],
    ]);
    const gp = [[0, 0], [0.18, 0.8], [0.45, 1], [1.1, 0.75], [D, 0]];
    v.tone({ type: 'sawtooth', unison: [-22, -7, 8, 20], fp: [[0, 60], [0.4, 74], [1.2, 66], [D, 46]], gp, g: 1, drive: 1.2, am: { rate: 31, depth: 0.35 }, vib: { rate: 5.5, depth: 25 }, dest: bank });
    v.noise({ color: 'pink', gp, g: 0.7, dest: bank });
    v.tone({ fp: [[0, 38], [0.4, 46], [D, 30]], gp, g: 0.35 });
    v.noise({ color: 'brown', gp, g: 0.3, lp: 400 });
  } },
  bossPhase: { vary: 0.02, pri: 2, rev: 0.35, fn(v) {
    v.click({ g: 0.6, hp: 1500, d: 0.02 });
    v.tone({ f: 60, to: 25, ft: 1.2, a: 0.003, h: 0.1, d: 1.5, g: 0.8, drive: 0.5 });
    v.noise({ color: 'pink', gp: [[0, 0], [1.1, 1], [1.2, 0]], g: 0.3, bp: { f: 200, to: 4000, ft: 1.15, q: 1.5 } });
    v.chord([38, 41, 45, 39], { gp: [[0, 0], [1.0, 1], [2.3, 0]], g: 0.06, lp: { pts: [[0, 300], [1.0, 2000], [2.3, 300]] } });
    v.thump(90, 30, 0.8, 0.8, { at: 1.2, drive: 0.6 });
    v.crackle({ at: 1.2, d: 0.6, g: 0.4 });
  } },
  healDone: { vary: 0.01, rev: 0.4, fn(v) {
    [74, 77, 81, 86, 87].forEach((m, i) => v.bell(m, { at: i * 0.07, d: 0.9, g: 0.08 }));
    v.chord([50, 57, 58], { a: 0.1, h: 0.3, d: 0.9, g: 0.04, lp: 1500 });
    v.tone({ f: 73.4, a: 0.05, h: 0.3, d: 0.8, g: 0.25 });
  } },
  healInterrupt: { vary: 0.04, pri: 2, rev: 0.15, fn(v) {
    v.click({ g: 0.7, d: 0.012 });
    v.tone({ type: 'sawtooth', unison: [-10, 10], fp: [[0, 300], [0.14, 700], [0.15, 140], [0.4, 60]], gp: [[0, 0], [0.02, 1], [0.15, 1], [0.4, 0]], g: 0.16, drive: 1, lp: 2000 });
    v.crackle({ d: 0.3, g: 0.5 });
    v.thump(160, 60, 0.15, 0.6, { at: 0.14 });
    v.shards(4, 0.1, 2500, 5000, 0.1, 0.14);
  } },
  // Cold digital "it has read you": crushed descending bleeps, a beating dyad, a stutter.
  adapt: { vary: 0, pri: 2, rev: 0.2, fn(v) {
    [93, 88, 84, 81, 76].forEach((m, i) => v.tone({ at: i * 0.05, type: 'square', f: mtof(m), a: 0.001, h: 0.03, d: 0.05, g: 0.08, curve: 'crush', lp: 5000 }));
    v.tone({ at: 0.25, unison: [0, 100], f: 1760, a: 0.02, h: 0.2, d: 0.45, g: 0.06, am: { rate: 10, depth: 0.45, type: 'square' } });
    v.tone({ at: 0.25, f: 55, a: 0.05, h: 0.15, d: 0.5, g: 0.35 });
    v.tone({ at: 0.25, type: 'square', f: 110, a: 0.01, h: 0.1, d: 0.3, g: 0.07, lp: 600 });
    const gate = [[0, 0]];
    for (let i = 0; i < 6; i++) gate.push([i * 0.045 + 0.001, 1 - i * 0.12], [i * 0.045 + 0.02, 1 - i * 0.12], [i * 0.045 + 0.021, 0]);
    v.noise({ at: 0.25, gp: gate, g: 0.12, hp: 3000, curve: 'crush' });
  } },
  stagger: { vary: 0.05, pri: 2, rev: 0.15, fn(v) {
    v.click({ g: 0.5, d: 0.01 });
    v.noise({ color: 'pink', a: 0.001, d: 0.08, g: 0.55, bp: { f: 1500, q: 1 } });
    v.thump(150, 55, 0.2, 0.7, { drive: 0.4 });
    v.tone({ type: 'triangle', f: 700, to: 250, ft: 0.6, a: 0.005, d: 0.7, g: 0.12, vib: { rate: 9, depth: 60 } });
    v.tone({ type: 'sawtooth', f: 300, to: 80, ft: 0.5, a: 0.005, d: 0.5, g: 0.08, lp: 1200 });
    v.crackle({ d: 0.35, g: 0.35 });
  } },

  // ----- Floors 4-10 enemies -----
  // Pike lunge: a long, narrow, rising band of air, then a faint inharmonic ring off the tip.
  thrust: { vary: 0.06, fn(v) {
    const d = v.r(0.34, 0.4), pk = d * 0.32;
    v.noise({ gp: [[0, 0], [pk, 1], [d * 0.6, 0.45], [d, 0]], g: 0.6, bp: { pts: [[0, 700], [pk, 3400], [d, 1500]], q: 3.2 } });
    v.noise({ color: 'pink', gp: [[0, 0], [pk, 1], [d, 0]], g: 0.25, bp: { pts: [[0, 300], [pk, 900], [d, 400]], q: 2 } });
    v.tone({ type: 'sawtooth', unison: [-7, 7], fp: [[0, 120], [pk, 210], [d, 150]], gp: [[0, 0], [pk, 1], [d, 0]], g: 0.07, bp: { pts: [[0, 700], [pk, 2400], [d, 900]], q: 2.5 } });
    v.fm({ at: pk * 0.8, f: v.r(1850, 2050), ratio: 2.76, index: 1.4, index1: 0.1, a: 0.004, d: 0.32, g: 0.07 });
    v.tone({ at: pk * 0.8, f: 4430, a: 0.004, d: 0.2, g: 0.02 });
  } },
  // Teleport: air sucked in and cut dead (a reversed whoosh), then a glassy shimmer. Rising and
  // late-peaking where `dash` falls and peaks early, so the two never read alike.
  blink: { vary: 0.03, pri: 2, rev: 0.3, fn(v) {
    const D = 0.16;
    v.noise({ gp: [[0, 0], [D * 0.6, 0.35], [D, 1], [D + 0.008, 0]], g: 0.5, bp: { pts: [[0, 700], [D, 5200]], q: 2.2 } });
    v.noise({ color: 'pink', gp: [[0, 0], [D, 1], [D + 0.008, 0]], g: 0.2, bp: { pts: [[0, 300], [D, 1600]], q: 1.5 } });
    v.tone({ fp: [[0, 900], [D, 2600]], gp: [[0, 0], [D, 1], [D + 0.01, 0]], g: 0.06 });
    v.tone({ at: D, f: 3520, unison: [0, 17], a: 0.004, d: 0.3, g: 0.05, am: { rate: 19, depth: 0.5 } });
    v.tone({ at: D, f: 5274, a: 0.004, d: 0.2, g: 0.025 });
    v.shards(5, 0.06, 3500, 7500, 0.05, D);
  } },
  // A drone tipping into a dive: a falling, slightly wobbling whine with a rush of air under it.
  droneDive: { vary: 0.05, fn(v) {
    const D = 0.5, gp = [[0, 0], [0.04, 0.7], [0.36, 1], [D, 0]];
    v.tone({ type: 'sawtooth', unison: [-12, 12], fp: [[0, 1700], [D, 560]], gp, g: 0.09, vib: { rate: 26, depth: 25 }, bp: { pts: [[0, 2400], [D, 900]], q: 2 } });
    v.tone({ fp: [[0, 3400], [D, 1120]], gp, g: 0.05, vib: { rate: 26, depth: 25 } });
    v.noise({ gp, g: 0.3, bp: { pts: [[0, 1500], [D, 4000]], q: 1.4 } });
  } },
  // Launcher: a hollow tube thunk, then a short rising whistle as the glob leaves.
  lob: { vary: 0.07, fn(v) {
    v.click({ g: 0.3, hp: 1500, d: 0.008 });
    v.thump(190, 85, 0.12, 0.8, { drive: 0.3 });
    v.noise({ a: 0.001, d: 0.09, g: 0.7, bp: { f: 420, q: 6 } });
    v.tone({ type: 'triangle', f: 330, to: 260, a: 0.001, d: 0.08, g: 0.2 });
    v.tone({ at: 0.04, fp: [[0, 900], [0.25, 1750]], gp: [[0, 0], [0.06, 1], [0.25, 0]], g: 0.07 });
    v.noise({ at: 0.04, gp: [[0, 0], [0.06, 1], [0.25, 0]], g: 0.18, bp: { pts: [[0, 900], [0.25, 1750]], q: 5 } });
  } },
  // Arming tick: tiny, dry and identical every time so a run of them reads as a countdown.
  beep: { vary: 0, fn(v) {
    v.tone({ type: 'square', f: 3150, a: 0.0005, h: 0.022, d: 0.015, g: 0.12, lp: 6500 });
    v.tone({ f: 3150, a: 0.0005, h: 0.022, d: 0.015, g: 0.15 });
  } },
  explode: { vary: 0.07, pri: 2, rev: 0.18, fn(v) {
    v.click({ g: 0.8, hp: 1500, d: 0.012 });
    v.thump(v.r(125, 145), 40, 0.38, 1, { drive: 0.75, h: 0.02 });
    v.noise({ color: 'brown', a: 0.001, d: 0.32, g: 0.9, lp: { f: 3500, to: 220 } });
    v.noise({ color: 'pink', a: 0.001, d: 0.2, g: 0.5, bp: { f: 1100, to: 500, q: 0.8 } });
    v.crackle({ d: v.r(0.45, 0.55), g: 0.55, bp: { f: v.r(1800, 2600), q: 0.6 } });
    v.crackle({ at: 0.03, d: 0.3, g: 0.3, hp: 5000 });
  } },
  // Flame column: a fast-attack roar of filtered noise over a driven low growl.
  pillar: { vary: 0.05, pri: 2, rev: 0.2, fn(v) {
    const gp = [[0, 0], [0.015, 1], [0.12, 0.8], [0.35, 0.5], [0.75, 0]];
    v.thump(110, 45, 0.25, 0.7, { drive: 0.5 });
    v.noise({ color: 'pink', gp, g: 0.8, lp: { pts: [[0, 7000], [0.75, 700]] }, hp: 120 });
    v.noise({ gp, g: 0.3, bp: { pts: [[0, 600], [0.1, 2800], [0.75, 1200]], q: 1.3 } });
    v.tone({ type: 'sawtooth', unison: [-18, 0, 17], fp: [[0, 70], [0.1, 85], [0.75, 52]], gp, g: 0.12, drive: 0.9, lp: { pts: [[0, 1800], [0.75, 300]] }, am: { rate: 27, depth: 0.3 } });
    v.crackle({ d: 0.7, g: 0.5, bp: { f: 2400, q: 0.6 } });
  } },
  // The heaviest hit in the game: a forge-hammer clang (inharmonic FM partials) over a deep thud.
  hammer: { vary: 0.04, pri: 2, rev: 0.25, fn(v) {
    v.click({ g: 0.5, hp: 1200, d: 0.015 });
    v.thump(98, 27, 0.85, 1, { drive: 0.9, h: 0.05 });
    v.tone({ f: 38, a: 0.01, h: 0.1, d: 1.0, g: 0.5 });
    v.noise({ color: 'brown', a: 0.001, d: 0.55, g: 1, lp: { f: 2200, to: 120 } });
    v.fm({ f: v.r(410, 440), ratio: 1.41, index: 5, index1: 0.5, it: 0.5, a: 0.001, d: 1.2, g: 0.2 });
    v.fm({ f: 1130, ratio: 2.76, index: 3, index1: 0.2, a: 0.001, d: 0.8, g: 0.1 });
    v.tone({ f: 1597, a: 0.001, d: 0.5, g: 0.04 });
    v.tone({ f: 2741, a: 0.001, d: 0.3, g: 0.025 });
    v.noise({ a: 0.0005, d: 0.06, g: 0.5, bp: { f: 2600, q: 1.2 } });
    v.crackle({ d: 0.4, g: 0.3, bp: { f: 3000, q: 0.7 } });
  } },
  // Blade heating: a sizzle and a tone that climb together. opts.pitch scales the whole thing,
  // and the level, so the boss combo's 1 / 1.15 / 1.3 steps climb audibly and keep their length.
  heatUp: { vary: 0.01, pri: 2, rev: 0.15, fn(v) {
    const D = 0.5, gp = [[0, 0], [0.38, 1], [D, 0]], k = clamp(v.p, 0.5, 1.6);
    v.noise({ gp, g: 0.4 * k, bp: { pts: [[0, 2800], [D, 6500]], q: 1.2 } });
    v.crackle({ gp: [[0, 0], [0.4, 1], [D, 0]], g: 0.45 * k, bp: { pts: [[0, 2500], [D, 5500]], q: 0.8 } });
    v.tone({ type: 'sawtooth', unison: [-8, 8], fp: [[0, 220], [D, 660]], gp, g: 0.1 * k, bp: { pts: [[0, 600], [D, 2400]], q: 3 } });
    v.tone({ fp: [[0, 440], [D, 1320]], gp, g: 0.11 * k, vib: { rate: 14, depth: 18 } });
  } },
  // Steam vent: a valve pop then a long falling hiss with a faint whistle. The boss's punish cue.
  vent: { vary: 0.03, pri: 2, rev: 0.15, fn(v) {
    const D = 1.2, gp = [[0, 0], [0.02, 1], [0.3, 0.8], [0.8, 0.35], [D, 0]];
    v.thump(150, 70, 0.08, 0.45);
    v.noise({ gp, g: 0.55, bp: { pts: [[0, 7000], [D, 1400]], q: 1 }, am: { rate: 11, depth: 0.15 } });
    v.noise({ gp, g: 0.2, hp: { f: 6000, to: 2500, ft: D } });
    v.tone({ fp: [[0, 2300], [D, 750]], gp: [[0, 0], [0.08, 1], [0.6, 0.5], [D, 0]], g: 0.025, vib: { rate: 7, depth: 30 } });
  } },
  // Afterimage: swingHeavy's shape, an octave-ish lower, narrow-band (hollow) and doubled.
  echo: { vary: 0.05, rev: 0.6, fn(v) {
    const d = v.r(0.36, 0.42), pk = d * 0.45;
    for (const [at, g] of [[0, 1], [0.09, 0.45]]) {
      v.whoosh({ at, d, g: 0.6 * g, color: 'pink', lo: 160, hi: v.r(800, 950), end: 220, q: 3.5, peak: 0.45 });
      v.tone({ at, fp: [[0, 40], [pk, 66], [d, 38]], gp: [[0, 0], [pk, 1], [d, 0]], g: 0.25 * g });
      v.tone({ at, type: 'triangle', unison: [-14, 13], fp: [[0, 110], [pk, 190], [d, 100]], gp: [[0, 0], [pk, 1], [d, 0]], g: 0.08 * g, bp: { pts: [[0, 300], [pk, 900], [d, 300]], q: 4 } });
    }
  } },
  // Elite arrival: a low hit, a dissonant swell and one cold high tone.
  elite: { vary: 0, pri: 2, rev: 0.4, fn(v) {
    v.thump(80, 32, 0.7, 0.8, { drive: 0.5 });
    v.chord([38, 39, 45], { gp: [[0, 0], [0.12, 1], [0.6, 0.6], [1.4, 0]], g: 0.05, lp: { pts: [[0, 300], [0.15, 1600], [1.4, 250]] } });
    v.tone({ f: mtof(38), a: 0.02, h: 0.2, d: 0.9, g: 0.25 });
    v.fm({ at: 0.05, f: mtof(87), ratio: 2.414, index: 1.2, index1: 0.05, a: 0.003, d: 1.1, g: 0.06 });
    v.tone({ at: 0.05, f: mtof(86), unison: [0, 9], a: 0.05, d: 1.0, g: 0.02, am: { rate: 6, depth: 0.4 } });
  } },

  // ----- Player and UI -----
  hurt: { vary: 0.06, fn(v) {
    v.click({ g: 0.4, d: 0.008 });
    v.thump(170, 70, 0.15, 0.8, { drive: 0.4 });
    v.noise({ color: 'pink', a: 0.001, d: 0.08, g: 0.5, bp: { f: 1200, q: 1 } });
    v.tone({ type: 'sawtooth', unison: [0, 90], f: 90, a: 0.003, d: 0.25, g: 0.16, drive: 1, lp: { f: 1200, to: 300 } });
  } },
  death: { vary: 0.02, pri: 2, rev: 0.4, fn(v) {
    v.click({ g: 0.8, hp: 1500, d: 0.015 });
    v.thump(130, 35, 0.8, 1, { drive: 0.6, h: 0.03 });
    v.noise({ color: 'pink', a: 0.001, d: 0.6, g: 0.6, lp: { f: 5000, to: 100 } });
    v.tone({ type: 'sawtooth', unison: [-12, 12], fp: [[0, 95], [1.6, 25]], gp: [[0, 0], [0.02, 1], [0.6, 0.6], [1.8, 0]], g: 0.2, lp: { pts: [[0, 1500], [1.8, 80]] }, am: { rate: 9, depth: 0.3 } });
    v.tone({ f: 55, unison: [0, 300], a: 0.2, h: 0.4, d: 1.4, g: 0.16 });
  } },
  perfectDodge: { vary: 0.02, pri: 2, rev: 0.4, fn(v) {
    v.noise({ gp: [[0, 0], [0.08, 1], [0.7, 0]], g: 0.45, bp: { f: 3000, to: 400, ft: 0.6, q: 1.5 } });
    v.tone({ f: 900, to: 180, ft: 0.6, a: 0.01, d: 0.7, g: 0.1 });
    v.tone({ f: 1760, unison: [0, 12], a: 0.02, d: 0.6, g: 0.04, am: { rate: 11, depth: 0.4 } });
    v.tone({ f: 2637, a: 0.02, d: 0.5, g: 0.025 });
    v.thump(120, 40, 0.5, 0.35);
  } },
  focus: { vary: 0, fn(v) {
    v.bell(88, { d: 0.18, g: 0.14 });
    v.bell(95, { at: 0.03, d: 0.2, g: 0.08 });
  } },
  rankUp: { vary: 0, rev: 0.3, fn(v) {
    [81, 84, 88, 93].forEach((m, i) => {
      v.tone({ at: i * 0.06, type: 'triangle', f: mtof(m), a: 0.003, d: 0.35, g: 0.12 });
      v.tone({ at: i * 0.06, f: mtof(m + 12), a: 0.003, d: 0.25, g: 0.04 });
    });
    v.tone({ at: 0.2, f: mtof(105), unison: [0, 12], a: 0.02, d: 0.5, g: 0.025, am: { rate: 14, depth: 0.4 } });
  } },
  waveClear: { vary: 0, pri: 2, rev: 0.4, fn(v) {
    v.chord([45, 52, 57, 60, 64], { a: 0.25, h: 0.6, d: 0.9, g: 0.035, lp: { f: 600, to: 2500, ft: 0.8 } });
    [81, 88, 93, 96].forEach((m, i) => v.bell(m, { at: 0.1 + i * 0.09, d: 0.9, g: 0.08 }));
    v.thump(80, 40, 0.6, 0.3);
  } },
  victory: { vary: 0, pri: 2, rev: 0.4, fn(v) {
    const prog = [[57, [0, 3, 7]], [53, [0, 4, 7]], [55, [0, 4, 7]], [57, [0, 4, 7, 12]]];
    const mel = [76, 77, 79, 81];
    prog.forEach(([r, iv], i) => {
      const at = i * 0.42, last = i === 3;
      v.chord(iv.map((x) => r + x), { at, a: 0.02, h: last ? 0.7 : 0.25, d: last ? 1.4 : 0.3, g: 0.04, lp: { f: 2600, to: 900 } });
      v.tone({ at, f: mtof(r - 24), a: 0.01, h: last ? 0.5 : 0.2, d: last ? 1.2 : 0.3, g: 0.22 });
      v.bell(mel[i], { at, d: last ? 1.6 : 0.5, g: 0.1 });
    });
    v.thump(90, 35, 0.9, 0.5, { at: 1.26 });
    v.tone({ at: 1.3, f: mtof(100), unison: [0, 12], a: 0.05, d: 1.2, g: 0.025, am: { rate: 12, depth: 0.4 } });
  } },
  uiMove: { vary: 0, pri: 0, fn(v) {
    v.tone({ f: 1200, a: 0.001, d: 0.03, g: 0.25 });
    v.click({ g: 0.05, hp: 5000, d: 0.003 });
  } },
  uiSelect: { vary: 0, fn(v) {
    v.tone({ type: 'triangle', f: 880, a: 0.001, d: 0.08, g: 0.25 });
    v.tone({ at: 0.05, type: 'triangle', f: 1320, a: 0.001, d: 0.14, g: 0.25 });
  } },
  heal: { vary: 0.01, rev: 0.3, fn(v) {
    v.tone({ f: 500, to: 1000, ft: 0.5, a: 0.05, d: 0.6, g: 0.08 });
    [76, 81, 85, 88].forEach((m, i) => v.bell(m, { at: 0.05 + i * 0.08, d: 0.5, g: 0.05 }));
    v.noise({ gp: [[0, 0], [0.3, 1], [0.7, 0]], g: 0.05, hp: 6000 });
  } },

  // ----- Pickups and the upgrade draft -----
  // Health orb: a soft major third in the middle register, rounded off by a lowpass.
  pickupHealth: { vary: 0.03, pri: 0, rev: 0.15, fn(v) {
    v.tone({ type: 'triangle', f: mtof(72), a: 0.006, d: 0.16, g: 0.2, lp: 1800 });
    v.tone({ at: 0.045, type: 'triangle', f: mtof(76), a: 0.006, d: 0.24, g: 0.2, lp: 1800 });
    v.tone({ at: 0.045, f: mtof(64), a: 0.02, d: 0.22, g: 0.12 });
  } },
  // Focus orb: two high FM glints a fourth apart over a quick upward sine flick.
  pickupFocus: { vary: 0.03, pri: 0, rev: 0.2, fn(v) {
    v.tone({ f: 1600, to: 3000, ft: 0.06, a: 0.003, d: 0.07, g: 0.05 });
    v.fm({ f: mtof(93), ratio: 2, index: 0.7, index1: 0.05, a: 0.001, d: 0.12, g: 0.1 });
    v.fm({ at: 0.04, f: mtof(98), ratio: 2, index: 0.6, index1: 0.05, a: 0.001, d: 0.2, g: 0.1 });
    v.noise({ at: 0.03, a: 0.002, d: 0.08, g: 0.02, hp: 8000 });
  } },
  // Draft screen: a rising air band under a climbing run of soft bells and a pad swell.
  draftOpen: { vary: 0, rev: 0.4, fn(v) {
    v.noise({ gp: [[0, 0], [0.45, 1], [0.6, 0]], g: 0.14, bp: { pts: [[0, 1200], [0.55, 7000]], q: 1.5 } });
    [69, 74, 76, 81, 86].forEach((m, i) => v.bell(m, { at: i * 0.07, d: 0.3, g: 0.06 }));
    v.chord([57, 64, 69], { gp: [[0, 0], [0.4, 1], [0.6, 0]], g: 0.02, lp: { pts: [[0, 400], [0.55, 2400]] } });
    v.tone({ at: 0.35, f: mtof(98), unison: [0, 11], a: 0.03, d: 0.25, g: 0.02, am: { rate: 13, depth: 0.4 } });
  } },
  // Upgrade chosen: a firm low knock, a bright major stab and one bell on top.
  draftPick: { vary: 0, rev: 0.3, fn(v) {
    v.click({ g: 0.3, hp: 2500, d: 0.008 });
    v.thump(170, 85, 0.12, 0.6, { drive: 0.3 });
    for (const m of [69, 73, 76, 81]) v.tone({ type: 'triangle', f: mtof(m), a: 0.004, h: 0.05, d: 0.38, g: 0.07 });
    v.chord([57, 64], { a: 0.004, h: 0.04, d: 0.3, g: 0.025, lp: { f: 2600, to: 600 } });
    v.bell(93, { at: 0.04, d: 0.42, g: 0.07 });
  } },
  // Power slot cycled: a dry tick whose pitch the game sets per slot.
  powerSwap: { vary: 0, pri: 0, fn(v) {
    v.tone({ type: 'triangle', f: 1500, a: 0.0005, d: 0.03, g: 0.3 });
    v.tone({ f: 3000, a: 0.0005, d: 0.015, g: 0.06 });
    v.click({ g: 0.06, hp: 5000, d: 0.003 });
  } },

  // ----- Focus powers -----
  // Ring of blades: a deep burst, an outward-opening noise band and ringing inharmonic steel.
  powerNova: { vary: 0.03, pri: 2, rev: 0.3, fn(v) {
    v.click({ g: 0.6, hp: 2000, d: 0.012 });
    v.thump(150, 48, 0.3, 0.8, { drive: 0.5 });
    v.noise({ gp: [[0, 0], [0.01, 1], [0.2, 0.5], [0.6, 0]], g: 0.4, bp: { pts: [[0, 800], [0.25, 6000], [0.6, 3500]], q: 1.2 } });
    v.fm({ f: 880, ratio: 1.41, index: 4, index1: 0.4, it: 0.4, a: 0.001, d: 0.7, g: 0.14 });
    v.fm({ f: 1320, ratio: 2.76, index: 2.5, index1: 0.2, a: 0.001, d: 0.5, g: 0.09 });
    v.tone({ f: 2637, unison: [0, 13], a: 0.002, d: 0.55, g: 0.04, am: { rate: 16, depth: 0.4 } });
    v.shards(10, 0.15, 3000, 8000, 0.07, 0.02);
  } },
  // Time stop: a fast downward sweep, a soft sub drop, then a held glassy beating shimmer.
  powerStasis: { vary: 0.02, pri: 2, rev: 0.4, fn(v) {
    const S = 0.18;
    v.tone({ type: 'sawtooth', unison: [-10, 10], fp: [[0, 2600], [S, 160]], gp: [[0, 0], [0.01, 1], [S, 0.6], [S + 0.03, 0]], g: 0.1, bp: { pts: [[0, 3000], [S, 300]], q: 2 } });
    v.noise({ gp: [[0, 0], [0.01, 1], [S, 0]], g: 0.3, bp: { pts: [[0, 7000], [S, 500]], q: 1.5 } });
    v.thump(110, 40, 0.3, 0.6, { at: S - 0.02 });
    v.tone({ at: S, f: 1760, unison: [0, 9], a: 0.04, h: 0.35, d: 0.42, g: 0.05, am: { rate: 7, depth: 0.35 } });
    v.tone({ at: S, f: 2637, a: 0.05, h: 0.3, d: 0.4, g: 0.025 });
    v.fm({ at: S, f: 1318.5, ratio: 3.5, index: 0.8, index1: 0.2, a: 0.03, h: 0.3, d: 0.45, g: 0.05 });
    v.noise({ at: S, gp: [[0, 0], [0.1, 1], [0.6, 0.6], [0.8, 0]], g: 0.025, hp: 7000 });
  } },
  // Player heal: a warm major swell with a breathy top, gentler than the boss's heal sounds.
  powerMend: { vary: 0.01, pri: 2, rev: 0.4, fn(v) {
    const gp = [[0, 0], [0.28, 1], [0.7, 0]];
    for (const m of [62, 66, 69, 74]) v.tone({ type: 'triangle', f: mtof(m), unison: [-5, 5], gp, g: 0.06, lp: 1600 });
    v.tone({ f: mtof(50), gp, g: 0.18 });
    v.tone({ fp: [[0, 440], [0.6, 880]], gp, g: 0.04 });
    v.noise({ gp, g: 0.04, hp: 5000 });
    v.bell(86, { at: 0.22, d: 0.45, g: 0.04 });
  } },
  // Chain lightning: a crushed falling zap with a crackle burst. Retriggers with rising pitch.
  powerArc: { vary: 0.04, pri: 2, rev: 0.12, fn(v) {
    v.crackle({ d: 0.14, g: 0.6, bp: { f: 3500, q: 0.7 } });
    v.tone({ type: 'square', f: 1900, to: 500, ft: 0.1, a: 0.001, d: 0.12, g: 0.1, curve: 'crush', bp: { f: 2200, q: 1.5 }, vib: { rate: 60, depth: 300 } });
    v.noise({ a: 0.0005, d: 0.04, g: 0.25, hp: 4000 });
    v.thump(220, 120, 0.05, 0.25);
  } },
  // One teleport cut: a narrow high noise slice and a short FM ring. Retriggers at ~80 ms.
  powerFlash: { vary: 0.03, pri: 2, fn(v) {
    v.noise({ a: 0.001, d: 0.06, g: 0.5, bp: { f: 6500, to: 3500, q: 3 } });
    v.fm({ f: 2400, ratio: 2.414, index: 2, index1: 0.2, a: 0.0008, d: 0.1, g: 0.09 });
    v.click({ g: 0.25, hp: 4000, d: 0.004 });
  } },
  // The resolving hit after the cuts: a heavy slash, a deep thump and a bright ringing tail.
  powerFlashEnd: { vary: 0.03, pri: 2, rev: 0.3, fn(v) {
    v.click({ g: 0.7, hp: 1800, d: 0.012 });
    v.noise({ a: 0.002, d: 0.3, g: 0.55, bp: { pts: [[0, 8000], [0.25, 1800]], q: 3 } });
    v.thump(140, 40, 0.35, 0.95, { drive: 0.6, at: 0.01, h: 0.02 });
    v.fm({ f: 1568, ratio: 2.414, index: 3, index1: 0.25, a: 0.001, d: 0.5, g: 0.1 });
    v.crackle({ d: 0.35, g: 0.35, bp: { f: 3000, q: 0.7 } });
  } },
  // Mirror image: a short swell into a beating glass tone, repeated a moment later.
  powerMirror: { vary: 0.02, pri: 2, rev: 0.4, fn(v) {
    v.noise({ gp: [[0, 0], [0.08, 1], [0.1, 0]], g: 0.15, bp: { pts: [[0, 2000], [0.08, 6000]], q: 2 } });
    for (const [at, g] of [[0.08, 1], [0.15, 0.6]]) {
      v.fm({ at, f: 1318.5, ratio: 3.5, index: 1, index1: 0.1, a: 0.003, d: 0.35, g: 0.07 * g });
      v.tone({ at, f: 1975.5, unison: [-14, 14], a: 0.003, d: 0.3, g: 0.04 * g });
    }
  } },
  // Floor marks: a low dissonant swell that opens up and stops short, leaving room for `pillar`.
  powerJudgment: { vary: 0.02, pri: 2, rev: 0.3, fn(v) {
    const gp = [[0, 0], [0.42, 1], [0.5, 0]];
    v.chord([38, 44, 45], { gp, g: 0.06, lp: { pts: [[0, 200], [0.45, 2200]], q: 2 } });
    v.tone({ f: mtof(38), gp, g: 0.3 });
    v.fm({ f: mtof(86), ratio: 1.5, index: 1.5, gp, g: 0.03, vib: { rate: 5, depth: 25 } });
    v.noise({ color: 'pink', gp, g: 0.12, bp: { pts: [[0, 300], [0.45, 2600]], q: 2 } });
  } },
  // Energy wave: an airy whoosh with a filtered saw riding the same arc and a thin top whistle.
  powerCrescent: { vary: 0.05, pri: 2, rev: 0.15, fn(v) {
    const d = 0.38, pk = d * 0.35, gp = [[0, 0], [pk, 1], [d, 0]];
    v.whoosh({ d, g: 0.55, lo: 700, hi: 3600, end: 1500, q: 1.3, peak: 0.35 });
    v.tone({ type: 'sawtooth', unison: [-9, 9], fp: [[0, 300], [pk, 640], [d, 420]], gp, g: 0.09, bp: { pts: [[0, 800], [pk, 2600], [d, 1200]], q: 2.5 } });
    v.tone({ fp: [[0, 1300], [pk, 2500], [d, 1900]], gp, g: 0.04 });
  } },

  // ----- Combat extras -----
  // Critical hit: a bright high ping layered on top of the normal hit.
  crit: { vary: 0.03, rev: 0.15, fn(v) {
    v.click({ g: 0.3, hp: 5000, d: 0.005 });
    v.fm({ f: 3136, ratio: 2, index: 1.2, index1: 0.05, a: 0.0008, d: 0.25, g: 0.14 });
    v.tone({ f: 4699, a: 0.0008, d: 0.12, g: 0.05 });
  } },
  // Set alight: a quiet high sizzle with a few crackles.
  burn: { vary: 0.1, pri: 0, fn(v) {
    v.noise({ gp: [[0, 0], [0.03, 1], [0.25, 0]], g: 0.3, hp: 3500, am: { rate: 30, depth: 0.4 } });
    v.crackle({ d: 0.2, g: 0.3, bp: { f: 4500, q: 0.8 } });
  } },
  // Reinforcements: a two-note low horn call through a vowel-ish formant bank.
  summon: { vary: 0.02, pri: 2, rev: 0.35, fn(v) {
    const bank = v.bank([[[[0, 600]], 5, 1.6], [[[0, 1050]], 6, 0.9], [[[0, 2400]], 8, 0.3]]);
    for (const [at, m, len] of [[0, 43, 0.3], [0.32, 50, 0.45]]) {
      const gp = [[0, 0], [0.06, 1], [len * 0.7, 0.85], [len, 0]];
      v.tone({ at, type: 'sawtooth', unison: [-8, 8], fp: [[0, mtof(m) * 0.96], [0.06, mtof(m)]], gp, g: 0.5, vib: { rate: 5, depth: 12 }, dest: bank });
      v.tone({ at, f: mtof(m - 12), gp, g: 0.2 });
    }
  } },
  // Mid-boss arrival: a two-hit low dissonant stab ("dun, DUN") with a tense high tail.
  championIntro: { vary: 0, pri: 2, rev: 0.35, fn(v) {
    for (const [at, g] of [[0, 0.6], [0.18, 1]]) {
      v.thump(85, 32, 0.4, 0.8 * g, { at, drive: 0.5 });
      v.chord([40, 46, 47], { at, a: 0.005, h: 0.05, d: at ? 0.75 : 0.15, g: 0.055 * g, drive: 0.4, lp: { f: 2400, to: 300 } });
    }
    v.tone({ at: 0.18, f: mtof(28), a: 0.01, h: 0.15, d: 0.6, g: 0.3 });
    v.fm({ at: 0.2, f: mtof(83), ratio: 2.414, index: 1.2, index1: 0.05, a: 0.02, d: 0.75, g: 0.04, vib: { rate: 6, depth: 20 } });
  } },
  // New sector: a short rising brass-ish call that lands on a held major chord with bells.
  sectorUp: { vary: 0, pri: 2, rev: 0.4, fn(v) {
    [67, 72, 76].forEach((m, i) => {
      v.tone({ at: i * 0.12, type: 'sawtooth', unison: [-7, 7], f: mtof(m), a: 0.01, h: 0.05, d: 0.15, g: 0.05, lp: { f: 2600, to: 1200 } });
      v.tone({ at: i * 0.12, f: mtof(m - 12), a: 0.01, d: 0.18, g: 0.08 });
    });
    v.chord([60, 64, 67, 72], { at: 0.36, a: 0.02, h: 0.35, d: 0.8, g: 0.035, lp: { f: 3000, to: 900 } });
    v.tone({ at: 0.36, f: mtof(48), a: 0.01, h: 0.3, d: 0.8, g: 0.22 });
    v.thump(90, 40, 0.5, 0.4, { at: 0.36 });
    [84, 88, 91].forEach((m, i) => v.bell(m, { at: 0.36 + i * 0.06, d: 0.9, g: 0.06 }));
  } },
  // Survived a killing blow: a reversed swell cut off into two heartbeat thuds.
  secondWind: { vary: 0, pri: 2, rev: 0.3, fn(v) {
    const S = 0.42, gp = [[0, 0], [S * 0.7, 0.4], [S, 1], [S + 0.01, 0]];
    v.noise({ gp, g: 0.4, bp: { pts: [[0, 300], [S, 3500]], q: 1.4 } });
    v.tone({ fp: [[0, 200], [S, 900]], gp, g: 0.1 });
    v.tone({ type: 'sawtooth', unison: [-9, 9], fp: [[0, 100], [S, 220]], gp, g: 0.06, lp: { pts: [[0, 300], [S, 2400]] } });
    v.thump(80, 36, 0.16, 1, { at: S, drive: 0.4 });
    v.thump(70, 32, 0.24, 0.75, { at: S + 0.24, drive: 0.4 });
    v.bell(88, { at: S, d: 0.4, g: 0.05 });
  } },
  // Floor modifier: crushed bleeps at random pitches, a gated noise stutter and a warbling tone.
  anomaly: { vary: 0.05, rev: 0.2, fn(v) {
    for (let i = 0; i < 5; i++) {
      v.tone({ at: i * 0.055, type: 'square', f: mtof(v.r(70, 96)), a: 0.001, h: 0.025, d: 0.03, g: 0.07, curve: 'crush', lp: 5000 });
    }
    const gate = [[0, 0]];
    for (let i = 0; i < 7; i++) {
      const t = 0.08 + i * v.r(0.03, 0.05);
      gate.push([t, 0], [t + 0.001, 1], [t + 0.015, 1], [t + 0.016, 0]);
    }
    v.noise({ gp: gate, g: 0.12, bp: { f: v.r(1500, 3500), q: 2 }, curve: 'crush' });
    v.fm({ f: v.r(300, 400), ratio: 1.37, index: 3, index1: 1, a: 0.01, h: 0.15, d: 0.3, g: 0.06, vib: { rate: 13, depth: 200 } });
  } },

  // ----- Animals: voiced sounds go through formant banks with vibrato and a rough AM flutter
  // (vocal fry), so they read as throats next to the clean synthetic blades. -----
  // Growl: a low buzzing throat on an "aw" vowel. pitch moves the voice and the formants, so a
  // big beast at 0.7 is darker as well as lower than a small one at 1.4.
  beastGrowl: { vary: 0.06, fn(v) {
    const D = v.r(0.46, 0.54), gp = [[0, 0], [0.07, 0.7], [D * 0.55, 1], [D, 0]];
    const bank = v.bank([[[[0, 420], [D * 0.5, 560], [D, 380]], 5, 2], [[[0, 820], [D * 0.5, 1000], [D, 760]], 6, 1.2], [[[0, 2300]], 7, 0.35]]);
    v.tone({ type: 'sawtooth', unison: [-18, 0, 15], fp: [[0, 68], [D * 0.5, 84], [D, 58]], gp, g: 1, drive: 0.9, am: { rate: v.r(24, 32), depth: 0.5 }, vib: { rate: 6.5, depth: 30 }, dest: bank });
    v.noise({ color: 'pink', gp, g: 0.5, am: { rate: v.r(17, 23), depth: 0.4 }, dest: bank });
    v.tone({ fp: [[0, 42], [D * 0.5, 52], [D, 36]], gp, g: 0.3 });
  } },
  // Bite: a hard tooth clack (short bright noise and a hollow knock) and a wet squelch under it.
  beastBite: { vary: 0.08, fn(v) {
    v.noise({ a: 0.0005, d: 0.018, g: 0.8, bp: { f: v.r(2400, 3200), q: 2 } });
    v.click({ g: 0.4, hp: 2500, d: 0.006 });
    v.tone({ type: 'triangle', f: v.r(520, 640), to: 300, ft: 0.04, a: 0.0008, d: 0.05, g: 0.35 });
    v.noise({ color: 'pink', at: 0.004, a: 0.002, d: 0.08, g: 0.55, bp: { f: 1700, to: 450, ft: 0.07, q: 6 } });
    v.thump(160, 80, 0.06, 0.4, { at: 0.002 });
  } },
  // Roar: bossRoar's recipe made smaller and wilder: higher voice, faster open-mouth formant
  // sweep, more breath, under a second long.
  beastRoar: { vary: 0.05, pri: 2, rev: 0.3, fn(v) {
    const D = v.r(0.85, 0.95);
    const bank = v.bank([
      [[[0, 480], [0.25, 820], [0.6, 640], [D, 450]], 5, 2.2],
      [[[0, 950], [0.25, 1400], [0.6, 1150], [D, 850]], 6, 1.4],
      [[[0, 2600], [0.3, 3000], [D, 2300]], 8, 0.6],
    ]);
    const gp = [[0, 0], [0.08, 0.75], [0.25, 1], [0.6, 0.8], [D, 0]];
    v.tone({ type: 'sawtooth', unison: [-25, -8, 9, 22], fp: [[0, 85], [0.25, 125], [0.6, 105], [D, 70]], gp, g: 1, drive: 1.3, am: { rate: v.r(32, 40), depth: 0.4 }, vib: { rate: 7, depth: 35 }, dest: bank });
    v.noise({ color: 'pink', gp, g: 0.8, dest: bank });
    v.noise({ gp, g: 0.12, hp: 4000 });
    v.tone({ fp: [[0, 45], [0.25, 62], [D, 38]], gp, g: 0.35 });
    v.noise({ color: 'brown', gp, g: 0.3, lp: 500 });
  } },
  // Screech: a high cry that rises and cracks: fast-vibrato saws and an FM rasp through two
  // narrow upper formants.
  beastScreech: { vary: 0.06, rev: 0.15, fn(v) {
    const D = v.r(0.36, 0.42), pk = D * 0.35, gp = [[0, 0], [0.03, 0.8], [pk, 1], [D * 0.7, 0.6], [D, 0]];
    const bank = v.bank([[[[0, 2200], [pk, 3200], [D, 2400]], 6, 1.6], [[[0, 3800], [pk, 4800], [D, 4000]], 7, 0.9]]);
    const fp = [[0, 1300], [pk, 2100], [D, 1500]];
    v.tone({ type: 'sawtooth', unison: [-30, 25], fp, gp, g: 0.9, drive: 1, vib: { rate: v.r(28, 36), depth: 70 }, am: { rate: 47, depth: 0.35 }, dest: bank });
    v.fm({ fp, f: 1300, ratio: 1.51, index: 2.2, index1: 1, gp, g: 0.1, vib: { rate: 31, depth: 60 } });
    v.noise({ gp, g: 0.5, dest: bank });
  } },
  // Hoof: a dry low knock with a hard edge, quiet because a gallop repeats it four or more times
  // a second. Yields its voice under load.
  beastHoof: { vary: 0.12, pri: 0, fn(v) {
    v.thump(v.r(130, 160), 60, 0.06, 0.8);
    v.noise({ color: 'brown', a: 0.001, d: 0.035, g: 0.6, lp: v.r(600, 900) });
    v.noise({ a: 0.0005, d: 0.012, g: 0.2, bp: { f: v.r(1100, 1500), q: 2 } });
  } },
  // Wing beat: a soft band of low air that swells and falls, no transient. Frequent and quiet.
  beastWing: { vary: 0.1, pri: 0, fn(v) {
    const D = v.r(0.13, 0.16), pk = D * 0.35, gp = [[0, 0], [pk, 1], [D, 0]];
    v.noise({ color: 'pink', gp, g: 0.8, bp: { pts: [[0, 220], [pk, v.r(650, 800)], [D, 260]], q: 0.8 } });
    v.tone({ fp: [[0, 55], [pk, 80], [D, 50]], gp, g: 0.25 });
  } },
  // Hiss: high breath noise with a rattle (a noise band gated by a square LFO) under it.
  beastHiss: { vary: 0.05, fn(v) {
    const D = v.r(0.46, 0.52), gp = [[0, 0], [0.05, 1], [D * 0.6, 0.75], [D, 0]];
    v.noise({ gp, g: 0.5, bp: { pts: [[0, 4500], [D, 6000]], q: 0.7 } });
    v.noise({ gp, g: 0.25, hp: 7000 });
    v.noise({ gp, g: 0.45, bp: { f: v.r(2800, 3600), q: 1.5 }, am: { rate: v.r(26, 34), depth: 0.9, type: 'square' } });
    v.noise({ color: 'pink', gp: [[0, 0], [0.04, 1], [0.15, 0]], g: 0.15, bp: { f: 1500, q: 1 } });
  } },
  // Stomp: a deep driven drop and a rumble of brown noise; lower and longer than landHeavy.
  beastStomp: { vary: 0.06, rev: 0.1, fn(v) {
    v.click({ g: 0.25, hp: 1200, d: 0.012 });
    v.thump(v.r(80, 92), 28, 0.35, 1, { drive: 0.6, h: 0.02 });
    v.tone({ f: 36, a: 0.005, h: 0.04, d: 0.35, g: 0.4 });
    v.noise({ color: 'brown', a: 0.001, d: 0.3, g: 0.9, lp: { f: 1500, to: 150 }, am: { rate: 17, depth: 0.3 } });
    v.noise({ color: 'pink', a: 0.002, d: 0.12, g: 0.25, bp: { f: 500, q: 1 } });
  } },

  // ----- Weapon forms: each owns a register and a shape the base swings do not use -----
  // Twin blades: a thin, very short, high noise slit and a faint whistle. No low end at all.
  swingTwin: { vary: 0.1, pri: 0, fn(v) {
    const D = v.r(0.09, 0.11), pk = D * 0.4, gp = [[0, 0], [pk, 1], [D, 0]];
    v.noise({ gp, g: 0.7, bp: { pts: [[0, 3000], [pk, 7500], [D, 4500]], q: 2.5 } });
    v.tone({ fp: [[0, 1100], [pk, 1900], [D, 1400]], gp, g: 0.05 });
  } },
  // Greatblade: a slow dark whoosh with a moaning low saw and sub riding the same arc.
  swingGreat: { vary: 0.05, fn(v) {
    const D = v.r(0.44, 0.48), pk = D * 0.55, gp = [[0, 0], [pk, 1], [D, 0]];
    v.whoosh({ d: D, g: 0.8, color: 'pink', lo: 140, hi: v.r(800, 950), end: 180, q: 1, peak: 0.55 });
    v.tone({ type: 'sawtooth', unison: [-14, 0, 13], fp: [[0, 48], [pk, 78], [D, 42]], gp, g: 0.18, drive: 0.4, lp: { pts: [[0, 200], [pk, 900], [D, 200]] }, vib: { rate: 4, depth: 25 } });
    v.tone({ type: 'triangle', fp: [[0, 95], [pk, 150], [D, 85]], gp, g: 0.14, bp: { pts: [[0, 300], [pk, 600], [D, 300]], q: 4 }, vib: { rate: 4, depth: 25 } });
    v.tone({ fp: [[0, 34], [pk, 56], [D, 30]], gp, g: 0.35 });
  } },
  // Staff: air chopped into an accelerating flutter (about 14 to 24 pulses a second) by the
  // gain points, so it implies rotation; swingSpin by contrast has five broad sweeps.
  swingStaff: { vary: 0.06, fn(v) {
    const D = v.r(0.33, 0.37), gp = [[0, 0]];
    for (let t = 0, rate = 14; t + 1 / rate < D; rate = 14 + 10 * (t / D)) {
      const env = Math.sin(Math.PI * Math.min(1, t / D + 0.08));
      t += 1 / rate;
      gp.push([t - 0.5 / rate, env], [t, 0.15 * env]);
    }
    gp.push([D, 0]);
    const bp = { pts: [[0, 700], [D * 0.5, 1900], [D, 900]], q: 1.8 };
    v.noise({ gp, g: 0.75, bp });
    v.noise({ color: 'pink', gp, g: 0.3, bp: { pts: [[0, 250], [D * 0.5, 500], [D, 300]], q: 1.2 } });
    v.tone({ type: 'triangle', fp: [[0, 120], [D * 0.5, 190], [D, 130]], gp, g: 0.1 });
  } },

  // ----- Terrain -----
  // Light platform on: a click and a clean sine sweeping up a fifth-plus, with a soft octave.
  platformOn: { vary: 0.02, rev: 0.2, fn(v) {
    v.click({ g: 0.3, hp: 3500, d: 0.005 });
    const gp = [[0, 0], [0.01, 1], [0.18, 0.7], [0.3, 0]];
    v.tone({ fp: [[0, 520], [0.14, 1040], [0.3, 1100]], gp, g: 0.2 });
    v.tone({ type: 'triangle', fp: [[0, 1040], [0.14, 2080], [0.3, 2200]], gp, g: 0.05 });
    v.fm({ at: 0.12, f: 2200, ratio: 2, index: 0.5, index1: 0.05, a: 0.002, d: 0.17, g: 0.04 });
  } },
  // Light platform off: the same tone falling, chopped into a slowing stutter.
  platformOff: { vary: 0.03, fn(v) {
    const gate = [[0, 0]];
    let t = 0;
    for (let i = 0; i < 6; i++) {
      const on = 0.022 + i * 0.006, off = 0.012 + i * 0.008, g = 1 - i * 0.13;
      gate.push([t + 0.001, g], [t + on, g], [t + on + 0.001, 0]);
      t += on + off;
    }
    v.tone({ fp: [[0, 1100], [t, 420]], gp: gate, g: 0.2 });
    v.tone({ type: 'square', fp: [[0, 550], [t, 210]], gp: gate, g: 0.05, lp: 2400 });
  } },
  // Floor panel arming: a mains-like buzz and a crackle that both climb toward the discharge.
  hazardArm: { vary: 0.02, pri: 2, fn(v) {
    const D = 0.8, gp = [[0, 0], [0.1, 0.25], [0.6, 0.7], [0.76, 1], [D, 0]];
    v.tone({ type: 'sawtooth', unison: [-10, 10], fp: [[0, 60], [D, 120]], gp, g: 0.2, drive: 0.6, bp: { pts: [[0, 400], [D, 2400]], q: 2 } });
    v.tone({ type: 'square', fp: [[0, 120], [D, 240]], gp, g: 0.04, lp: 1500, am: { rate: 50, depth: 0.4 } });
    v.tone({ fp: [[0, 400], [D, 1600]], gp, g: 0.05 });
    v.crackle({ gp: [[0, 0], [0.3, 0.2], [D - 0.02, 1], [D, 0]], g: 0.4, bp: { pts: [[0, 2000], [D, 5000]], q: 0.8 } });
  } },
  // Panel discharge: a hard crack, a bright crackle burst and a crushed 100 Hz buzz tail.
  hazardZap: { vary: 0.05, pri: 2, rev: 0.12, fn(v) {
    v.click({ g: 0.8, hp: 1500, d: 0.012 });
    v.crackle({ d: 0.2, g: 0.8, bp: { f: 3500, q: 0.6 } });
    v.noise({ a: 0.0005, d: 0.05, g: 0.45, hp: 3000 });
    v.thump(200, 90, 0.08, 0.5);
    v.tone({ type: 'square', unison: [0, 25], f: v.r(95, 110), a: 0.002, h: 0.05, d: 0.25, g: 0.12, curve: 'crush', lp: { f: 3500, to: 700 }, am: { rate: 50, depth: 0.5, type: 'square' } });
  } },
  // Charged wall hit: the zap's crack over wallSplat-style meat.
  wallShock: { vary: 0.06, rev: 0.1, fn(v) {
    v.click({ g: 0.6, hp: 2000, d: 0.01 });
    v.crackle({ d: 0.22, g: 0.6, bp: { f: 3200, q: 0.7 } });
    v.thump(125, 42, 0.22, 0.9, { drive: 0.45, at: 0.004 });
    v.noise({ color: 'brown', a: 0.001, d: 0.14, g: 0.6, lp: 1200 });
    v.noise({ a: 0.001, d: 0.05, g: 0.35, bp: { f: 1400, q: 1.2 } });
    v.tone({ type: 'square', f: 110, a: 0.002, d: 0.18, g: 0.06, curve: 'crush', lp: 2500 });
  } },

  // ----- Bonds between enemies -----
  // Tether break: a plucked, bent string (bright saw through a falling bandpass) and a glass tail.
  tetherSnap: { vary: 0.05, rev: 0.25, fn(v) {
    v.click({ g: 0.4, hp: 3000, d: 0.005 });
    v.tone({ type: 'sawtooth', fp: [[0, 880], [0.025, 600], [0.25, 560]], a: 0.0008, d: 0.22, g: 0.14, bp: { f: 2600, to: 900, ft: 0.18, q: 2 } });
    v.tone({ f: 1760, to: 1200, ft: 0.03, a: 0.0008, d: 0.08, g: 0.05 });
    v.fm({ at: 0.015, f: 2794, ratio: 3.5, index: 1, index1: 0.05, a: 0.002, d: 0.26, g: 0.05 });
    v.shards(3, 0.06, 3500, 6500, 0.04, 0.01);
  } },
  // Enrage: a driven snarl on a vowel that opens as it rises, peaking late.
  enrage: { vary: 0.04, pri: 2, rev: 0.2, fn(v) {
    const D = 0.5, gp = [[0, 0], [0.32, 0.8], [0.4, 1], [D, 0]];
    const bank = v.bank([[[[0, 450], [0.4, 900], [D, 700]], 5, 2], [[[0, 1000], [0.4, 1700], [D, 1300]], 6, 1.3], [[[0, 2500], [D, 3000]], 8, 0.5]]);
    v.tone({ type: 'sawtooth', unison: [-22, 0, 20], fp: [[0, 85], [0.4, 230], [D, 190]], gp, g: 1, drive: 1.6, am: { rate: 34, depth: 0.45 }, vib: { rate: 8, depth: 40 }, dest: bank });
    v.noise({ color: 'pink', gp, g: 0.6, dest: bank });
    v.crackle({ gp, g: 0.35, bp: { pts: [[0, 2000], [0.4, 4500]], q: 0.7 } });
    v.tone({ fp: [[0, 42], [0.4, 115], [D, 95]], gp, g: 0.2 });
  } },
  // Rider thrown: a body thud, a ragged scrape of gated noise, then a smaller second thud.
  dismount: { vary: 0.07, fn(v) {
    v.thump(v.r(120, 140), 50, 0.12, 0.8, { drive: 0.3 });
    v.noise({ color: 'brown', a: 0.001, d: 0.07, g: 0.5, lp: 1000 });
    const gate = [[0, 0]];
    for (let i = 0; i < 8; i++) {
      const t = 0.06 + i * 0.026 + v.r(0, 0.008), g = 1 - i * 0.1;
      gate.push([t, 0.2 * g], [t + 0.004, g], [t + 0.018, 0.3 * g]);
    }
    gate.push([0.3, 0]);
    v.noise({ gp: gate, g: 0.35, bp: { f: v.r(1300, 1800), q: 1.2 } });
    v.thump(105, 45, 0.09, 0.45, { at: 0.17 });
    v.noise({ color: 'brown', at: 0.17, a: 0.001, d: 0.05, g: 0.3, lp: 900 });
  } },
  // Pack rally: a wolf-ish howl, a voiced sine and saw climbing an "oo" to "ah" formant pair.
  packHowl: { vary: 0.03, pri: 2, rev: 0.35, fn(v) {
    const D = v.r(0.86, 0.94), gp = [[0, 0], [0.12, 0.55], [0.55, 1], [0.75, 0.8], [D, 0]];
    const fp = [[0, 330], [0.15, 470], [0.55, 640], [D, 560]];
    const bank = v.bank([[[[0, 450], [0.55, 850], [D, 750]], 6, 2], [[[0, 1100], [0.55, 1500], [D, 1350]], 7, 1]]);
    v.tone({ type: 'sawtooth', unison: [-8, 8], fp, gp, g: 0.7, vib: { rate: 5.5, depth: 30 }, dest: bank });
    v.tone({ type: 'triangle', fp, gp, g: 0.16, vib: { rate: 5.5, depth: 30 } });
    v.noise({ gp, g: 0.12, dest: bank });
  } },
  // Pack breaks: a falling, wavering whimper that loses breath as it goes.
  nerveBreak: { vary: 0.04, rev: 0.2, fn(v) {
    const D = v.r(0.56, 0.62), gp = [[0, 0], [0.04, 1], [0.2, 0.75], [D * 0.75, 0.35], [D, 0]];
    const fp = [[0, 950], [0.08, 1000], [D, 360]];
    const bank = v.bank([[[[0, 900], [D, 450]], 6, 1.8], [[[0, 2000], [D, 1100]], 7, 0.8]]);
    v.tone({ type: 'sawtooth', unison: [-10, 10], fp, gp, g: 0.6, vib: { rate: 7, depth: 60 }, am: { rate: 6, depth: 0.35 }, dest: bank });
    v.tone({ type: 'triangle', fp, gp, g: 0.12, vib: { rate: 7, depth: 60 } });
    v.noise({ gp, g: 0.25, bp: { pts: [[0, 3000], [D, 900]], q: 1 } });
  } },

  // ----- Bosses and polish -----
  // Room change: two urgent whooping pulses of a square dyad over a low square.
  alarm: { vary: 0, pri: 2, rev: 0.15, fn(v) {
    for (const at of [0, 0.3]) {
      v.tone({ at, type: 'square', unison: [0, 30], fp: [[0, 620], [0.2, 980]], a: 0.004, h: 0.18, d: 0.07, g: 0.07, lp: 3500 });
      v.tone({ at, fp: [[0, 620], [0.2, 980]], a: 0.004, h: 0.18, d: 0.07, g: 0.12 });
      v.tone({ at, type: 'square', f: 110, a: 0.004, h: 0.18, d: 0.06, g: 0.06, lp: 600 });
    }
  } },
  // Twin bosses swap: two glassy notes, high then a fourth down, with a flick of air between.
  twinSwap: { vary: 0, rev: 0.3, fn(v) {
    v.fm({ f: mtof(88), ratio: 3.5, index: 1.2, index1: 0.05, a: 0.001, d: 0.14, g: 0.09 });
    v.tone({ f: mtof(88) * 2, a: 0.001, d: 0.08, g: 0.025 });
    v.noise({ gp: [[0, 0], [0.07, 1], [0.09, 0]], g: 0.08, bp: { pts: [[0, 6000], [0.09, 2500]], q: 2 } });
    v.fm({ at: 0.09, f: mtof(83), ratio: 3.5, index: 1.2, index1: 0.05, a: 0.001, d: 0.2, g: 0.09 });
    v.tone({ at: 0.09, f: mtof(83) * 2, a: 0.001, d: 0.12, g: 0.025 });
  } },
  // Boss killing blow: a reverse swell sucked up into a huge driven boom, then a long bright
  // bell and air tail. Built for slow motion, where the master lowpass darkens it further.
  finisher: { vary: 0, pri: 2, rev: 0.45, fn(v) {
    const S = 0.36, gp = [[0, 0], [S * 0.7, 0.4], [S, 1], [S + 0.01, 0]];
    v.noise({ gp, g: 0.45, bp: { pts: [[0, 400], [S, 5000]], q: 1.3 } });
    v.tone({ type: 'sawtooth', unison: [-10, 10], fp: [[0, 80], [S, 240]], gp, g: 0.08, lp: { pts: [[0, 300], [S, 3000]] } });
    v.click({ at: S, g: 0.4, hp: 1500, d: 0.015 });
    v.thump(72, 24, 1.0, 1, { at: S, drive: 0.9, h: 0.06 });
    v.tone({ at: S, f: 32, a: 0.01, h: 0.15, d: 1.1, g: 0.5 });
    v.noise({ color: 'brown', at: S, a: 0.001, d: 0.7, g: 0.9, lp: { f: 3000, to: 100 } });
    v.fm({ at: S, f: 1568, ratio: 2.414, index: 3, index1: 0.2, it: 0.5, a: 0.002, d: 1.2, g: 0.12 });
    v.tone({ at: S, f: 3136, unison: [0, 11], a: 0.03, d: 1.15, g: 0.04, am: { rate: 9, depth: 0.4 } });
    v.noise({ at: S, gp: [[0, 0], [0.1, 1], [1.2, 0]], g: 0.08, hp: 6000 });
    v.crackle({ at: S, d: 0.8, g: 0.35, bp: { f: 2600, q: 0.6 } });
  } },
  // Menu hover: a tiny soft sine tick, no noise click, under uiMove.
  uiHover: { vary: 0, pri: 0, fn(v) {
    v.tone({ f: 1800, a: 0.002, d: 0.018, g: 0.2 });
  } },
  // Parry lesson passed: three quick rising bells, a major triad.
  tutorialDone: { vary: 0, rev: 0.3, fn(v) {
    [84, 88, 91].forEach((m, i) => v.bell(m, { at: i * 0.08, d: i === 2 ? 0.36 : 0.22, g: 0.1 }));
  } },

  // ----- Player techniques -----
  // Launcher pull: air drawn in, falling in pitch and growing louder toward a hard stop.
  pullIn: { vary: 0.05, pri: 2, fn(v) {
    const D = 0.35, gp = [[0, 0], [D * 0.5, 0.4], [D * 0.9, 1], [D, 0]];
    v.noise({ gp, g: 0.55, bp: { pts: [[0, 5000], [D, 700]], q: 1.8 } });
    v.noise({ color: 'pink', gp, g: 0.3, bp: { pts: [[0, 1200], [D, 250]], q: 1.2 } });
    v.tone({ fp: [[0, 420], [D, 110]], gp, g: 0.1 });
    v.thump(120, 60, 0.06, 0.35, { at: D - 0.02 });
  } },
  // Saber pins to a wall: a hard thunk and a quivering steel ring.
  pin: { vary: 0.05, rev: 0.2, fn(v) {
    v.click({ g: 0.6, hp: 2000, d: 0.01 });
    v.thump(210, 90, 0.1, 0.8, { drive: 0.4 });
    v.noise({ color: 'brown', a: 0.001, d: 0.06, g: 0.5, lp: 1400 });
    v.fm({ f: v.r(1180, 1300), ratio: 1.41, index: 3, index1: 0.3, a: 0.001, d: 0.3, g: 0.12, am: { rate: 18, depth: 0.5 } });
    v.tone({ f: 2730, a: 0.001, d: 0.15, g: 0.03 });
  } },
  // Reflected force: a bright clang with a fast upward sweep riding on it.
  reflect: { vary: 0.03, pri: 2, rev: 0.25, fn(v) {
    v.click({ g: 0.6, hp: 2500, d: 0.008 });
    v.fm({ f: 1760, ratio: 2.76, index: 3, index1: 0.2, a: 0.001, d: 0.3, g: 0.13 });
    v.tone({ type: 'sawtooth', unison: [-9, 9], fp: [[0, 400], [0.12, 2400]], gp: [[0, 0], [0.01, 1], [0.12, 0.8], [0.16, 0]], g: 0.08, bp: { pts: [[0, 800], [0.12, 4000]], q: 2 } });
    v.noise({ gp: [[0, 0], [0.01, 1], [0.12, 0.6], [0.16, 0]], g: 0.25, bp: { pts: [[0, 1500], [0.12, 6000]], q: 1.5 } });
    v.thump(260, 140, 0.08, 0.45);
  } },
};

// Mix: per-sound voice gain, set from measured dry peaks (node tools/audio-test.js) toward
// targets of about -3 dBFS for heavy impacts, -5 light hits, -8 to -10 swings, -11 to -14
// movement, -15 to -18 UI and -30 footsteps. Peaks are transient-dominated, so the ear may
// still want nudges here.
const MIX = {
  swingLight: .72, swingHeavy: .62, swingSpin: .79, ignite: .69, extinguish: .69, throw: .88, catch: .53,
  hitLight: .59, hitHeavy: .43, hitLaunch: .6, hitSpike: .42, kill: .46, sever: .76,
  block: .38, parry: .59, clash: .45, guardBreak: .39, deflected: .62,
  jump: .7, doubleJump: 1.5, dash: .81, land: .36, landHeavy: .37, footstep: .12, thud: .4, bounce: .49, wallSplat: .43,
  telegraph: 1.76, telegraphRed: 1,
  bolt: .69, boltReflect: .85, shockwave: .53, slam: .36, bossRoar: .39, bossPhase: .56, healDone: 1, healInterrupt: .58, adapt: 1, stagger: .56,
  thrust: 1.13, blink: 1.3, droneDive: 1.2, lob: .34, beep: .75, explode: .32, pillar: .54, hammer: .4, heatUp: .85, vent: .68, echo: .83, elite: .42,
  hurt: .47, death: .41, perfectDodge: 1.1, focus: 1.28, rankUp: 1.84, waveClear: 1.53, victory: .95, uiMove: .5, uiSelect: .74, heal: 1.76,
  pickupHealth: .47, pickupFocus: 1.38, draftOpen: 1.7, draftPick: .48, powerSwap: .48,
  powerNova: .48, powerStasis: .98, powerMend: .95, powerArc: 1, powerFlash: 1.8, powerFlashEnd: .6, powerMirror: 1.86, powerJudgment: 1.07, powerCrescent: .95,
  crit: 1.55, burn: .25, summon: 1, championIntro: .51, sectorUp: .9, secondWind: .58, anomaly: 2,
  beastGrowl: .42, beastBite: .8, beastRoar: .31, beastScreech: .48, beastHoof: .27, beastWing: .32, beastHiss: .44, beastStomp: .46,
  swingTwin: .54, swingGreat: .64, swingStaff: 1.07,
  platformOn: .71, platformOff: .78, hazardArm: 1.41, hazardZap: .46, wallShock: .5,
  tetherSnap: 1, enrage: .37, dismount: .55, packHowl: .68, nerveBreak: .54,
  alarm: 1.53, twinSwap: 2.19, finisher: .42, uiHover: .32, tutorialDone: 2.2,
  pullIn: .9, pin: .47, reflect: .65,
};

// ---------------------------------------------------------------------------------------------
// Saber hum: one persistent voice per lit blade.

function hold(param, v, now, tc) {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(v, now, tc);
  param.setTargetAtTime(0, now + HUM_TIMEOUT, 0.035); // self-fade unless the next update cancels it
}

class Hum {
  constructor(e, now) {
    const c = e.ctx;
    this.e = e;
    this.last = now;
    this.sp = 0;
    this.dop = 0;
    this.cur = {};
    this.srcs = [];
    const osc = (type, f, det) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      o.start(now);
      this.srcs.push(o);
      return o;
    };
    const gain = (v) => {
      const g = c.createGain();
      g.gain.value = v;
      return g;
    };
    // Two motors a few cents apart beat slowly; a sub octave adds body.
    this.o = [osc('sawtooth', HUM_F, -7), osc('sawtooth', HUM_F, 7), osc('sine', HUM_F / 2, 0)];
    const mix = gain(0.5), sub = gain(1.4);
    this.o[0].connect(mix);
    this.o[1].connect(mix);
    this.o[2].connect(sub);
    sub.connect(mix);
    const wob = osc('sine', rnd(0.5, 1.1), 0), wobG = gain(9);
    wob.connect(wobG);
    wobG.connect(this.o[0].detune);
    wobG.connect(this.o[1].detune);
    const sh = c.createWaveShaper();
    sh.curve = driveCurve(0.5);
    const trem = gain(0.85), flutter = osc('sine', rnd(22, 28), 0), flG = gain(0.15);
    flutter.connect(flG);
    flG.connect(trem.gain);
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 420;
    this.lp.Q.value = 2;
    this.amp = gain(0);
    mix.connect(sh);
    sh.connect(trem);
    trem.connect(this.lp);
    this.lp.connect(this.amp);
    // Swing whoosh: band-passed noise that opens with speed.
    const nz = c.createBufferSource();
    nz.buffer = e.buf.white;
    nz.loop = true;
    nz.start(now, rnd(0, 1.5));
    this.srcs.push(nz);
    this.bp = c.createBiquadFilter();
    this.bp.type = 'bandpass';
    this.bp.Q.value = 1.4;
    this.bp.frequency.value = 600;
    this.wg = gain(0);
    nz.connect(this.bp);
    this.bp.connect(this.wg);
    this.pan = c.createStereoPanner ? c.createStereoPanner() : null;
    const out = this.pan || gain(1);
    this.amp.connect(out);
    this.wg.connect(out);
    out.connect(e.sfx);
    this.nodes = [mix, sub, wobG, sh, trem, flG, this.lp, this.amp, this.bp, this.wg, out];
  }

  param(key, params, v, now, tc) {
    const old = this.cur[key];
    if (old !== undefined && Math.abs(v - old) <= Math.abs(old) * 0.002 + 1e-4) return;
    this.cur[key] = v;
    for (const pr of params) {
      pr.cancelScheduledValues(now);
      pr.setTargetAtTime(v, now, tc);
    }
  }

  set(p, now) {
    this.last = now;
    const sp = clamp(num(p.speed, 0), 0, 1), pitch = clamp(num(p.pitch, 1), 0.25, 4);
    const vol = clamp(num(p.vol, 1), 0, 2), pan = clamp(num(p.pan, 0), -1, 1);
    // Doppler-ish: acceleration kicks the pitch up, deceleration dips it, and both relax.
    this.dop = clamp(this.dop * 0.82 + (sp - this.sp) * 1.1, -0.25, 0.3);
    this.sp = sp;
    const f = HUM_F * pitch * this.e.sag * (1 + 0.3 * sp + this.dop), up = Math.max(0, this.dop);
    this.param('f', [this.o[0].frequency, this.o[1].frequency], f, now, 0.03);
    this.param('s', [this.o[2].frequency], f / 2, now, 0.03);
    this.param('lp', [this.lp.frequency], 420 + 3000 * Math.pow(sp, 1.3) + 1500 * up, now, 0.03);
    this.param('bp', [this.bp.frequency], 500 + 2800 * sp + 3000 * up, now, 0.04);
    if (this.pan) this.param('pan', [this.pan.pan], pan, now, 0.03);
    hold(this.amp.gain, vol * (0.085 + 0.2 * sp), now, 0.025);
    hold(this.wg.gain, vol * 0.3 * Math.pow(sp, 1.5), now, 0.03);
  }

  release(now) {
    this.last = Math.min(this.last, now - HUM_TIMEOUT);
    for (const g of [this.amp.gain, this.wg.gain]) {
      g.cancelScheduledValues(now);
      g.setTargetAtTime(0, now, 0.03);
    }
  }

  dispose() {
    for (const s of this.srcs) try { s.stop(); } catch { /* already stopped */ }
    for (const n of this.nodes) n.disconnect();
  }
}

// ---------------------------------------------------------------------------------------------
// Sustained loops. Each builder wires persistent sources into `L.in`.

const LOOPS = {
  // A boss channeling a heal: a minor-with-flat-sixth pad that rises a fourth over ~8 s while
  // its filter opens, high shimmer partials, a swirling noise band and a slow low pulse.
  heal(e, L, t) {
    const c = e.ctx;
    const lp = L.node(c.createBiquadFilter());
    lp.type = 'lowpass';
    lp.Q.value = 5;
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.setTargetAtTime(3200, t, 2.2);
    const pad = L.node(c.createGain());
    pad.gain.value = 0.055;
    for (const [m, det] of [[50, -8], [50, 8], [53, 0], [57, -5], [58, 6]]) {
      const o = L.osc('sawtooth', mtof(m));
      o.detune.setValueAtTime(det, t);
      o.detune.linearRampToValueAtTime(det + 500, t + 8);
      o.connect(pad);
    }
    pad.connect(lp);
    lp.connect(L.in);
    for (const m of [86, 89, 93, 98]) {
      const o = L.osc('sine', mtof(m));
      o.detune.setValueAtTime(0, t);
      o.detune.linearRampToValueAtTime(500, t + 8);
      const g = L.node(c.createGain());
      g.gain.value = 0.016;
      const lfo = L.osc('sine', rnd(3, 9)), lg = L.node(c.createGain());
      lg.gain.value = 0.016;
      lfo.connect(lg);
      lg.connect(g.gain);
      o.connect(g);
      g.connect(L.in);
    }
    const n = L.noise('pink'), bp = L.node(c.createBiquadFilter()), ng = L.node(c.createGain());
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.value = 1300;
    const sw = L.osc('sine', 0.4), swg = L.node(c.createGain());
    swg.gain.value = 800;
    sw.connect(swg);
    swg.connect(bp.frequency);
    ng.gain.value = 0.12;
    n.connect(bp);
    bp.connect(ng);
    ng.connect(L.in);
    const sub = L.osc('sine', mtof(38)), sg = L.node(c.createGain()), pulse = L.osc('sine', 1.6), pg = L.node(c.createGain());
    sg.gain.value = 0.12;
    pg.gain.value = 0.1;
    pulse.connect(pg);
    pg.connect(sg.gain);
    sub.connect(sg);
    sg.connect(L.in);
  },
  // A spinning thrown blade: the hum chopped by a ~12 Hz whirl, with a noise band riding it.
  throw(e, L) {
    const c = e.ctx;
    const am = L.node(c.createGain());
    am.gain.value = 0.55;
    const lfo = L.osc('sine', rnd(11, 13)), lg = L.node(c.createGain());
    lg.gain.value = 0.45;
    lfo.connect(lg);
    lg.connect(am.gain);
    const lp = L.node(c.createBiquadFilter());
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    lp.Q.value = 2;
    const mix = L.node(c.createGain());
    mix.gain.value = 0.12;
    for (const det of [-9, 9]) {
      const o = L.osc('sawtooth', 104);
      o.detune.value = det;
      o.connect(mix);
    }
    mix.connect(lp);
    lp.connect(am);
    const n = L.noise('white'), bp = L.node(c.createBiquadFilter()), ng = L.node(c.createGain());
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.value = 1800;
    const fg = L.node(c.createGain());
    fg.gain.value = 700;
    lfo.connect(fg);
    fg.connect(bp.frequency);
    ng.gain.value = 0.22;
    n.connect(bp);
    bp.connect(ng);
    ng.connect(am);
    am.connect(L.in);
  },
  // Rain: broadband hiss, a low rumble, crackle patter and slow gusts.
  rain(e, L) {
    const c = e.ctx;
    const gust = L.node(c.createGain());
    gust.gain.value = 0.85;
    const lfo = L.osc('sine', 0.08), lg = L.node(c.createGain());
    lg.gain.value = 0.15;
    lfo.connect(lg);
    lg.connect(gust.gain);
    const chain = (src, specs, g) => {
      let node = src;
      for (const [type, f, q] of specs) {
        const b = L.node(c.createBiquadFilter());
        b.type = type;
        b.frequency.value = f;
        b.Q.value = q;
        node.connect(b);
        node = b;
      }
      const gg = L.node(c.createGain());
      gg.gain.value = g;
      node.connect(gg);
      gg.connect(gust);
    };
    chain(L.noise('pink'), [['highpass', 450, 0], ['lowpass', 6000, 0]], 0.22);
    chain(L.noise('brown'), [['lowpass', 260, 0]], 0.3);
    chain(L.noise('crackle', 0.5), [['bandpass', 2600, 0.6]], 0.35);
    gust.connect(L.in);
  },
};

class LoopVoice {
  constructor(e, name, now) {
    const c = e.ctx;
    this.e = e;
    this.ctx = c;
    this.srcs = [];
    this.nodes = [];
    this.in = this.node(c.createGain());
    this.in.gain.setValueAtTime(0, now);
    this.pan = c.createStereoPanner ? this.node(c.createStereoPanner()) : null;
    if (this.pan) {
      this.in.connect(this.pan);
      this.pan.connect(e.sfx);
    } else this.in.connect(e.sfx);
    this.vol = -1;
    this.panV = 0;
    this.end = Infinity;
    LOOPS[name](e, this, now);
  }

  node(n) {
    this.nodes.push(n);
    return n;
  }

  osc(type, f) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.start();
    this.srcs.push(o);
    this.nodes.push(o);
    return o;
  }

  noise(color, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.e.buf[color];
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(this.ctx.currentTime, rnd(0, 1.5));
    this.srcs.push(s);
    this.nodes.push(s);
    return s;
  }

  set(o, now) {
    const vol = clamp(num(o?.vol, 1), 0, 2), pan = clamp(num(o?.pan, 0), -1, 1);
    if (Math.abs(vol - this.vol) > 0.005) {
      this.vol = vol;
      this.in.gain.cancelScheduledValues(now);
      this.in.gain.setTargetAtTime(vol, now, 0.12);
    }
    if (this.pan && Math.abs(pan - this.panV) > 0.005) {
      this.panV = pan;
      this.pan.pan.setTargetAtTime(pan, now, 0.05);
    }
  }

  stop(now) {
    this.in.gain.cancelScheduledValues(now);
    this.in.gain.setTargetAtTime(0, now, 0.1);
    this.end = now + 0.7;
  }

  dispose() {
    for (const s of this.srcs) try { s.stop(); } catch { /* already stopped */ }
    for (const n of this.nodes) n.disconnect();
  }
}

// ---------------------------------------------------------------------------------------------
// Generative music. A Track schedules 16th-note steps against AudioContext time with a
// lookahead. Chords change per bar, progressions and patterns are re-drawn per 4-bar phrase,
// every fourth phrase may become a breakdown, and notes are humanized, so it never settles
// into an audible loop. Layer gains follow a smoothed intensity.

const CH = {
  i: [0, 3, 7], III: [3, 7, 10], iv: [5, 8, 12], v: [7, 10, 14], V: [7, 11, 14],
  VI: [8, 12, 15], VII: [10, 14, 17], bII: [1, 5, 8],
  // Used only by sector themes.
  IV: [5, 9, 12], ii: [2, 5, 9], vii: [10, 13, 17], viio: [11, 14, 17],
};
const ARPS = [
  [0, 1, 2, 3, 0, 1, 2, 3], [0, 1, 2, 3, 4, 3, 2, 1], [5, 4, 3, 2, 1, 0, 1, 2],
  [0, 3, 1, 3, 2, 3, 1, 3], [0, 2, 1, 3, 2, 4, 3, 5], [0, 1, 0, 2, 0, 3, 2, 1],
];

// Sector themes restyle the combat, boss and boss2 tracks (setTheme). Theme 0 is the tracks as
// written. A theme sets the key (semitones, folded up an octave if the root would drop below
// MIDI 40), the tempo factor, a mode (chord colour plus extra progressions), and optionally
// the arp timbre, the pad oscillator, the kick and arp pattern pools and an eighth-note swing.
const MODES = {
  // Major IV and minor ii: brighter, folky.
  dorian: { chords: { iv: CH.IV }, progs: [['i', 'IV', 'i', 'IV'], ['i', 'IV', 'VII', 'i'], ['i', 'ii', 'IV', 'i'], ['i', 'VII', 'IV', 'i'], ['IV', 'i', 'VII', 'v']] },
  // Flat second everywhere, minor seventh chord: dark and tense.
  phrygian: { chords: { VII: CH.vii }, progs: [['i', 'bII', 'i', 'VII'], ['i', 'bII', 'III', 'bII'], ['i', 'iv', 'bII', 'i'], ['VI', 'bII', 'i', 'i'], ['i', 'VII', 'bII', 'i']] },
  // Raised leading tone: major V and a diminished seventh-degree chord.
  harmonic: { chords: { v: CH.V, VII: CH.viio }, progs: [['i', 'iv', 'V', 'i'], ['i', 'VI', 'V', 'i'], ['i', 'iv', 'viio', 'i'], ['VI', 'iv', 'V', 'V'], ['i', 'bII', 'V', 'i']] },
  // Same chords as written, heroic major-chord-led progressions.
  epic: { chords: {}, progs: [['VI', 'VII', 'III', 'i'], ['i', 'VI', 'III', 'VII'], ['III', 'VII', 'i', 'VI'], ['i', 'III', 'VII', 'VI'], ['VI', 'III', 'VII', 'VII']] },
};
const KICKS = {
  four: ['x...x...x...x...', 'x...x...x...x.x.', 'x...x...x..xx...'],
  broken: ['x..x..x...x.....', 'x.....x..x..x...', 'x..x...x..x...x.'],
};
const ARPS_ALT = [[0, 2, 4, 2, 0, 2, 4, 5], [0, 0, 2, 1, 3, 1, 4, 2], [2, 1, 0, 1, 3, 2, 1, 0], [0, 4, 2, 4, 1, 4, 3, 4]];
const ARP_POOLS = { alt: ARPS_ALT, mix: [...ARPS, ...ARPS_ALT] };
// Level trims that keep a swapped oscillator near the written one's loudness.
const ARP_G = { square: 1, sawtooth: 1, triangle: 1.6, glass: 1.2 };
const PAD_G = { sawtooth: 1, square: 0.7, triangle: 1.5 };
const THEMES = [
  { key: 0, tempo: 1 },
  { key: 3, tempo: 1.05, mode: 'dorian', arp: 'triangle', kicks: 'four' },
  { key: -2, tempo: 0.94, mode: 'phrygian', arp: 'glass', pad: 'square', arps: 'alt' },
  { key: 5, tempo: 1.07, mode: 'harmonic', kicks: 'broken', arps: 'mix' },
  { key: -4, tempo: 0.96, mode: 'epic', arp: 'triangle', pad: 'triangle', swing: 0.12 },
  { key: 1, tempo: 1.03, mode: 'phrygian', arp: 'sawtooth', kicks: 'four', arps: 'alt' },
  { key: -3, tempo: 0.95, mode: 'dorian', arp: 'glass', pad: 'square', swing: 0.1 },
  { key: 4, tempo: 1.09, mode: 'harmonic', arp: 'triangle', kicks: 'broken', arps: 'alt' },
  { key: 2, tempo: 1.02, mode: 'epic', arp: 'glass', kicks: 'four', arps: 'mix', swing: 0.08 },
  { key: -1, tempo: 1.1, mode: 'harmonic', arp: 'sawtooth', pad: 'square', kicks: 'broken' },
];
const wrapTheme = (n) => ((Math.floor(n) % THEMES.length) + THEMES.length) % THEMES.length;

const arpNote = (ch, i) => ch[i % 3] + 12 * Math.floor(i / 3);
const bassNote = (c, ch) => (c === 'O' ? ch[0] + 12 : c === 'F' ? ch[0] + 7 : c === 'T' ? ch[1] : ch[0]);

const INST = {
  kick(tr, t, vel = 1, heavy = false) {
    const v = tr.voice(t, tr.L.drums);
    v.tone({ f: heavy ? 120 : 140, to: heavy ? 38 : 46, ft: 0.07, a: 0.001, h: 0.01, d: heavy ? 0.42 : 0.3, g: (heavy ? 0.7 : 0.6) * vel, drive: heavy ? 0.6 : 0.3 });
    v.click({ g: 0.08 * vel, hp: 3500, d: 0.004 });
  },
  snare(tr, t, vel = 1, heavy = false, dest = tr.L.drums) {
    const v = tr.voice(t, dest);
    v.noise({ a: 0.001, d: heavy ? 0.2 : 0.14, g: 0.26 * vel, bp: { f: heavy ? 1500 : 1900, q: 0.8 } });
    v.tone({ type: 'triangle', f: heavy ? 170 : 195, to: heavy ? 130 : 150, a: 0.001, d: 0.08, g: 0.2 * vel });
  },
  hat(tr, t, vel = 1, open = false, dest = tr.L.hats) {
    tr.voice(t, dest).noise({ a: 0.0008, d: open ? 0.16 : 0.035, g: 0.09 * vel, hp: 7000 });
  },
  tom(tr, t, f, vel = 1, dest = tr.L.perc) {
    const v = tr.voice(t, dest);
    v.tone({ f, to: f * 0.6, a: 0.001, d: 0.3, g: 0.4 * vel, drive: 0.3 });
    v.noise({ color: 'brown', a: 0.001, d: 0.12, g: 0.2 * vel, lp: 800 });
  },
  boom(tr, t, dest = tr.L.perc) {
    const v = tr.voice(t, dest);
    v.tone({ f: 58, to: 30, a: 0.002, h: 0.05, d: 1.4, g: 0.5, drive: 0.4 });
    v.noise({ color: 'pink', a: 0.002, d: 0.8, g: 0.2, lp: { f: 2500, to: 120 } });
  },
  bass(tr, t, midi, dur, vel, bright, type = 'sawtooth') {
    const v = tr.voice(t, tr.bassIn), f = mtof(midi);
    v.tone({ type, f, a: 0.004, d: dur, g: 0.2 * vel, lp: { f: 160 + 900 * bright, to: 140, ft: dur * 0.8, q: 4 } });
    v.tone({ f, a: 0.004, d: dur, g: 0.22 * vel });
  },
  pad(tr, t, midis, dur, dest, g, type = 'sawtooth', unison = [-8, 7]) {
    const v = tr.voice(t, dest);
    for (const m of midis) v.tone({ type, unison, f: mtof(m), gp: [[0, 0], [dur * 0.25, 1], [dur * 0.8, 0.8], [dur * 1.15, 0]], g });
  },
  pluck(tr, t, midi, vel, dest, type = 'square') {
    if (type === 'glass') tr.voice(t, dest).fm({ f: mtof(midi), ratio: 3.5, index: 1.4, index1: 0.1, a: 0.002, d: 0.2, g: 0.055 * vel });
    else tr.voice(t, dest).tone({ type, f: mtof(midi), a: 0.002, d: 0.18, g: 0.055 * vel, lp: { f: 2600, to: 500, ft: 0.15 } });
  },
  bell(tr, t, midi, vel, dest) {
    const v = tr.voice(t, dest), f = mtof(midi);
    v.fm({ f, ratio: 3.5, index: 1.2, index1: 0.05, a: 0.003, d: 2.6, g: 0.06 * vel });
    v.tone({ f: f * 2.003, a: 0.003, d: 1.2, g: 0.02 * vel });
  },
  // Struck steel: inharmonic FM partials with a short ring, for the forge track's off-beats.
  anvil(tr, t, f, vel, dest) {
    const v = tr.voice(t, dest);
    v.fm({ f, ratio: 1.41, index: 3.5, index1: 0.3, a: 0.001, d: 0.24, g: 0.05 * vel });
    v.tone({ f: f * 2.29, a: 0.001, d: 0.12, g: 0.014 * vel });
    v.noise({ a: 0.0005, d: 0.025, g: 0.07 * vel, bp: { f: 3200, q: 1.2 } });
    v.tone({ f: 190, to: 120, a: 0.001, d: 0.06, g: 0.08 * vel });
  },
  riser(tr, t, dur, dest) {
    tr.voice(t, dest).noise({ gp: [[0, 0], [dur * 0.95, 1], [dur, 0]], g: 0.12, bp: { f: 300, to: 5000, ft: dur, q: 1.5 } });
  },
};

function gainNode(c, v) {
  const g = c.createGain();
  g.gain.value = v;
  return g;
}

function filterNode(c, type, f, q = 0) {
  const b = c.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

// Feedback delay `steps` 16ths long (3 = dotted eighth) for arps and bells. A theme's tempo
// change retimes it.
function delayLine(tr, steps, fb, wet) {
  const c = tr.e.ctx;
  const inp = tr.node(gainNode(c, 1)), d = tr.node(c.createDelay(2)), f = tr.node(gainNode(c, fb));
  const lp = tr.node(filterNode(c, 'lowpass', 2400)), w = tr.node(gainNode(c, wet));
  d.delayTime.value = steps * tr.step;
  tr.delays.push([d, steps]);
  inp.connect(d);
  d.connect(lp);
  lp.connect(f);
  f.connect(d);
  lp.connect(w);
  w.connect(tr.out);
  return inp;
}

// Shared phrase logic for the tempo tracks.
// Bars count from the last theme change (`tr.pb`), so a new theme starts a fresh phrase.
function phraseBar(tr) {
  const d = tr.def, pb = tr.pb, progs = tr.progs;
  if (pb % 4 === 0) {
    const phrase = pb / 4;
    let prog = pick(progs);
    while (prog === tr.prog && progs.length > 1) prog = pick(progs);
    if (!tr.prog || Math.random() > 0.2) tr.prog = prog;
    tr.section = phrase > 0 && phrase % 4 === 3 && Math.random() < 0.65 ? 'break' : 'main';
    tr.arpPat = pick(tr.arps);
    tr.arpOct = Math.random() < 0.3 ? 12 : 0;
    tr.kickPat = pick(tr.kicks);
    tr.basePat = pick(d.bassPats(tr.I));
  }
  tr.chord = tr.chords[tr.prog[pb % 4]];
  tr.bassPat = Math.random() < 0.25 ? pick(d.bassPats(tr.I)) : tr.basePat;
  tr.fill = pb % 4 === 3 && Math.random() < 0.55;
  tr.drop = tr.section === 'main' && pb % 8 === 7 && Math.random() < 0.2;
  if (tr.section === 'break' && pb % 4 === 3) INST.riser(tr, tr.next, tr.barDur, tr.L.pad);
}

const TRACKS = {
  menu: {
    step: 60 / 70 / 2, rev: 0.6, root: 40,
    layers: ['drone', 'pad', 'bells'],
    trim: { drone: 0.6, pad: 1.6, bells: 3 },
    progs: [['i', 'VI', 'iv', 'i'], ['i', 'VII', 'VI', 'VII'], ['i', 'iv', 'VI', 'V'], ['VI', 'iv', 'i', 'i']],
    levels: (I) => ({ drone: 1, pad: 0.8 + 0.2 * I, bells: 1 }),
    setup(tr) {
      const c = tr.e.ctx, t = c.currentTime;
      tr.droneF = tr.node(filterNode(c, 'lowpass', 380, 3));
      const lfo = tr.osc('sine', 0.05), lg = tr.node(gainNode(c, 200));
      lfo.connect(lg);
      lg.connect(tr.droneF.frequency);
      tr.drone = [];
      for (const [mul, det, g, type] of [[1, -6, 0.05, 'sawtooth'], [1, 6, 0.05, 'sawtooth'], [1.5, 0, 0.03, 'sawtooth'], [0.5, 0, 0.12, 'sine']]) {
        const o = tr.osc(type, mtof(tr.def.root) * mul);
        o.detune.value = det;
        const gg = tr.node(gainNode(c, g));
        o.connect(gg);
        gg.connect(tr.droneF);
        tr.drone.push([o, mul]);
      }
      tr.droneF.connect(tr.L.drone);
      tr.padIn = tr.node(filterNode(c, 'lowpass', 900));
      tr.padIn.connect(tr.L.pad);
      tr.bellIn = tr.L.bells;
      tr.bellDelay = delayLine(tr, 3, 0.4, 0.5);
      tr.L.bells.connect(tr.bellDelay);
      tr.lastBell = t;
      tr.queue = [];
    },
    onBar(tr, bar, t) {
      const d = tr.def;
      if (bar % 4 === 0) tr.prog = pick(d.progs);
      const ch = CH[tr.prog[bar % 4]];
      tr.chord = ch;
      const f = mtof(d.root + ch[0]) * tr.e.sag;
      for (const [o, mul] of tr.drone) o.frequency.setTargetAtTime(f * mul, t, 1.2);
      INST.pad(tr, t, [d.root + 12 + ch[0], d.root + 12 + ch[1], d.root + 12 + ch[2], d.root + 24 + ch[0]], tr.barDur, tr.padIn, 0.022);
    },
    onStep(tr, s, t) {
      const root = tr.def.root, scale = [0, 3, 5, 7, 10, 12, 14, 15];
      if (tr.queue.length) {
        INST.bell(tr, t, tr.queue.shift(), rnd(0.6, 0.9), tr.bellIn);
        tr.lastBell = t;
        return;
      }
      if (t - tr.lastBell < tr.def.step * 3 || Math.random() > (s === 0 ? 0.35 : 0.1)) return;
      const base = root + 24 + (Math.random() < 0.5 ? 12 : 0);
      const n = base + pick(scale);
      INST.bell(tr, t, n, rnd(0.7, 1), tr.bellIn);
      tr.lastBell = t;
      if (Math.random() < 0.25) {
        const i = scale.indexOf(n - base);
        tr.queue = [base + scale[Math.max(0, i - 1)], base + scale[Math.max(0, i - 2)]];
      }
    },
  },

  combat: {
    step: 60 / 112 / 4, rev: 0.2, root: 50, themed: true, arp: 'square',
    layers: ['pad', 'bass', 'hats', 'drums', 'arp', 'perc'],
    trim: { pad: 1.4, bass: 0.62, hats: 2.5, drums: 0.39, arp: 2.5, perc: 0.6 },
    progs: [['i', 'VI', 'III', 'VII'], ['i', 'VI', 'iv', 'V'], ['i', 'iv', 'VII', 'III'], ['i', 'VII', 'VI', 'V'], ['VI', 'VII', 'i', 'i'], ['i', 'i', 'VI', 'VII'], ['iv', 'VI', 'V', 'i'], ['i', 'III', 'iv', 'V']],
    kicks: ['x.......x.......', 'x.......x..x....', 'x..x....x.......', 'x.....x...x.....', 'x.......x.....x.'],
    bassPats: (I) => (I < 0.3
      ? ['R.......R.......', 'R...R...R...R...', 'R.....R.....R...']
      : I < 0.7
        ? ['R.R.R.R.R.R.R.R.', '..R...R...R...RO', 'R..R..R.R..R..F.', 'R.R.R.RO.R.R.RFO']
        : ['RRR.RRR.RRR.RROF', 'R.RRR.RRR.RRR.RR', 'RRRRRRRRRRRRRRRO', 'R.RR.RR.R.RR.RTF']),
    levels: (I) => ({
      pad: 0.9 - 0.3 * I, bass: 0.45 + 0.55 * smooth(I, 0, 0.3), hats: smooth(I, 0.2, 0.45),
      drums: smooth(I, 0.35, 0.6), arp: smooth(I, 0.5, 0.8), perc: smooth(I, 0.78, 1),
    }),
    setup(tr) {
      const c = tr.e.ctx;
      tr.padIn = tr.node(filterNode(c, 'lowpass', 700, 2));
      tr.padIn.connect(tr.L.pad);
      tr.bassIn = tr.L.bass;
      tr.arpIn = tr.L.arp;
      tr.L.arp.connect(delayLine(tr, 3, 0.3, 0.35));
    },
    onI(tr, now) {
      tr.padIn.frequency.setTargetAtTime(500 + 1600 * tr.I, now, 0.5);
    },
    onBar: phraseBar,
    onStep(tr, s, t) {
      const { root, step } = tr, lv = tr.lv, I = tr.I, ch = tr.chord, brk = tr.section === 'break';
      const ht = () => t + rnd(-0.003, 0.004);
      if (s === 0 && lv.pad > 0.01) INST.pad(tr, t, [...ch.map((x) => root + x), root + ch[0] + 12], tr.barDur * 1.02, tr.padIn, 0.03 * tr.padG, tr.padType);
      if (lv.bass > 0.01) {
        const b = brk ? (s % 8 === 0 ? 'R' : '.') : tr.bassPat[s];
        if (b !== '.') INST.bass(tr, t, root - 12 + bassNote(b, ch), step * (brk ? 6 : 1.5), s % 4 === 0 ? 1 : 0.8, 0.3 + 0.7 * I);
      }
      const drums = !brk && !(tr.drop && s >= 8) && lv.drums > 0.01;
      if (drums) {
        if (tr.kickPat[s] === 'x') INST.kick(tr, t, s === 0 ? 1 : 0.85);
        if (s === 4 || s === 12) INST.snare(tr, ht(), 1);
        else if (tr.fill && s >= 13) INST.snare(tr, t, 0.45 + (s - 12) * 0.15);
        else if (s % 2 && Math.random() < 0.04 + 0.08 * I) INST.snare(tr, ht(), 0.25);
      }
      if (lv.hats > 0.01 && s % 2 === 0) INST.hat(tr, ht(), s % 4 === 2 ? 1 : 0.6, s === 14 && Math.random() < 0.3);
      if (lv.perc > 0.01) {
        if (s % 2 === 1) INST.hat(tr, ht(), rnd(0.35, 0.55), false, tr.L.perc);
        if (tr.fill && s >= 8 && s % 2 === 0) INST.tom(tr, t, 170 - (s - 8) * 12, 0.8);
      }
      if (lv.arp > 0.01) {
        const fast = I > 0.78;
        if ((fast || s % 2 === 0) && Math.random() > 0.06) {
          const idx = tr.arpPat[(fast ? s : s / 2) % tr.arpPat.length];
          INST.pluck(tr, ht(), root + 12 + tr.arpOct + arpNote(ch, idx), (s % 4 === 0 ? 1 : 0.7) * tr.arpG, tr.arpIn, tr.arpType);
        }
      }
    },
  },

  boss: {
    step: 60 / 128 / 4, rev: 0.25, root: 48, themed: true, arp: 'sawtooth',
    layers: ['pad', 'bass', 'hats', 'drums', 'arp', 'perc'],
    trim: { pad: 1.1, bass: 0.2, hats: 2.5, drums: 0.21, arp: 4, perc: 0.38 },
    progs: [['i', 'VI', 'VII', 'i'], ['i', 'iv', 'V', 'i'], ['i', 'VI', 'iv', 'V'], ['i', 'bII', 'V', 'i'], ['VI', 'V', 'i', 'i'], ['i', 'i', 'bII', 'i']],
    kicks: ['x...x...x...x...', 'x...x...x...x.x.', 'x..xx...x...x...', 'x...x..xx...x...'],
    bassPats: (I) => (I < 0.35
      ? ['R.......R...R...', 'R.R.R.R.R.R.R.R.', 'R.O.R.O.R.O.R.O.']
      : ['R.RRR.RRR.RRR.RR', 'RORORORORORORORF', 'RR..RR..RR..RRO.', 'R.RRR.RRR.RRRTFO']),
    levels: (I) => ({
      pad: 0.85, bass: 0.5 + 0.5 * smooth(I, 0, 0.25), hats: smooth(I, 0.15, 0.4),
      drums: smooth(I, 0.25, 0.5), arp: smooth(I, 0.5, 0.75), perc: smooth(I, 0.7, 0.95),
    }),
    setup(tr) {
      const c = tr.e.ctx;
      // Choir: detuned saws through a fixed "ah" formant bank.
      tr.padIn = tr.node(gainNode(c, 1));
      const sum = tr.node(filterNode(c, 'lowpass', 3500));
      for (const [f, q, g] of [[700, 6, 2.2], [1150, 8, 1.4], [2600, 9, 0.7]]) {
        const b = tr.node(filterNode(c, 'bandpass', f, q)), gg = tr.node(gainNode(c, g));
        tr.padIn.connect(b);
        b.connect(gg);
        gg.connect(sum);
      }
      sum.connect(tr.L.pad);
      // Distorted bass.
      tr.bassIn = tr.node(gainNode(c, 1));
      const sh = tr.node(c.createWaveShaper());
      sh.curve = driveCurve(0.8);
      const lp = tr.node(filterNode(c, 'lowpass', 1400, 2)), lv = tr.node(gainNode(c, 0.7));
      tr.bassIn.connect(sh);
      sh.connect(lp);
      lp.connect(lv);
      lv.connect(tr.L.bass);
      tr.arpIn = tr.L.arp;
      tr.L.arp.connect(delayLine(tr, 3, 0.32, 0.3));
    },
    onBar: phraseBar,
    onStep(tr, s, t) {
      const { root, step } = tr, lv = tr.lv, I = tr.I, ch = tr.chord, brk = tr.section === 'break';
      const ht = () => t + rnd(-0.003, 0.004);
      if (s === 0 && lv.pad > 0.01) {
        INST.pad(tr, t, [root + ch[0], ...ch.map((x) => root + 12 + x)], tr.barDur * 1.02, tr.padIn, 0.05 * tr.padG, tr.padType, [-11, 0, 9]);
        if (tr.pb % 4 === 0 && lv.perc > 0.01 && !brk) INST.boom(tr, t);
      }
      if (lv.bass > 0.01) {
        const b = brk ? (s % 8 === 0 ? 'R' : '.') : tr.bassPat[s];
        if (b !== '.') INST.bass(tr, t, root - 12 + bassNote(b, ch), step * (brk ? 6 : 1.3), s % 4 === 0 ? 1 : 0.8, 0.4 + 0.6 * I, 'square');
      }
      const drums = !brk && !(tr.drop && s >= 8) && lv.drums > 0.01;
      if (drums) {
        const half = I < 0.45;
        if (half ? s === 0 || s === 10 : tr.kickPat[s] === 'x') INST.kick(tr, t, s === 0 ? 1 : 0.85, true);
        if (half ? s === 8 : s === 4 || s === 12) INST.snare(tr, ht(), 1, true);
        else if (tr.fill && s >= 12) INST.snare(tr, t, 0.4 + (s - 12) * 0.15, true);
      }
      if (lv.hats > 0.01 && s % 2 === 0) INST.hat(tr, ht(), s % 4 === 2 ? 1 : 0.55);
      if (lv.perc > 0.01) {
        if (s % 2 === 1 && Math.random() < 0.7) INST.hat(tr, ht(), rnd(0.3, 0.5), false, tr.L.perc);
        if ((tr.fill && s >= 8 && s % 2 === 0) || (s === 14 && Math.random() < 0.3)) INST.tom(tr, t, 150 - (s - 8) * 10, 0.9);
      }
      if (lv.arp > 0.01 && Math.random() > 0.05) {
        const idx = tr.arpPat[s % tr.arpPat.length];
        INST.pluck(tr, ht(), root + tr.arpOct + arpNote(ch, idx), (s % 4 === 0 ? 1 : 0.65) * tr.arpG, tr.arpIn, tr.arpType);
      }
    },
  },

  // Forge master: G minor (the dominant of boss's C minor), slower and heavier, with anvil
  // strikes on the off-beat eighths, a crushed bass and a bit-reduced ostinato.
  boss2: {
    step: 60 / 120 / 4, rev: 0.2, root: 43, themed: true, arp: 'square',
    layers: ['pad', 'bass', 'anvil', 'drums', 'hats', 'arp', 'perc'],
    trim: { pad: 1.1, bass: 0.22, anvil: 1, hats: 2.2, drums: 0.3, arp: 2.5, perc: 0.38 },
    progs: [['i', 'i', 'bII', 'i'], ['i', 'VI', 'v', 'i'], ['i', 'iv', 'bII', 'V'], ['i', 'VII', 'VI', 'bII'], ['VI', 'bII', 'V', 'i'], ['i', 'iv', 'i', 'V']],
    kicks: ['x.....x...x.....', 'x..x..x...x..x..', 'x.....x.x.......', 'x...x...x...x...', 'x.x...x...x...x.'],
    bassPats: (I) => (I < 0.35
      ? ['R.......R.......', 'R.....R.R.......', 'R...R...R...R...']
      : ['R.RRR.RRR.RRR.RR', 'RR.RRR.RRR.RRROF', 'R..RR..RR..RR.TF', 'RRORRRORRRORRRRF']),
    levels: (I) => ({
      pad: 0.75 - 0.15 * I, bass: 0.5 + 0.5 * smooth(I, 0, 0.25), anvil: smooth(I, 0.1, 0.35),
      drums: smooth(I, 0.2, 0.45), hats: smooth(I, 0.3, 0.55), arp: smooth(I, 0.55, 0.8), perc: smooth(I, 0.7, 0.95),
    }),
    setup(tr) {
      const c = tr.e.ctx;
      tr.padIn = tr.node(filterNode(c, 'lowpass', 650, 4));
      tr.padIn.connect(tr.L.pad);
      tr.bassIn = tr.node(gainNode(c, 1));
      const sh = tr.node(c.createWaveShaper());
      sh.curve = driveCurve(1);
      const lp = tr.node(filterNode(c, 'lowpass', 1100, 2)), lv = tr.node(gainNode(c, 0.6));
      tr.bassIn.connect(sh);
      sh.connect(lp);
      lp.connect(lv);
      lv.connect(tr.L.bass);
      tr.arpIn = tr.node(c.createWaveShaper());
      tr.arpIn.curve = crushCurve();
      const alp = tr.node(filterNode(c, 'lowpass', 3000));
      tr.arpIn.connect(alp);
      alp.connect(tr.L.arp);
      tr.L.arp.connect(delayLine(tr, 3, 0.28, 0.3));
      tr.L.anvil.connect(delayLine(tr, 2, 0.18, 0.22));
    },
    onBar: phraseBar,
    onStep(tr, s, t) {
      const { root, step } = tr, lv = tr.lv, I = tr.I, ch = tr.chord, brk = tr.section === 'break';
      const ht = () => t + rnd(-0.003, 0.004);
      if (s === 0 && lv.pad > 0.01) {
        INST.pad(tr, t, [root + ch[0], root + 12 + ch[0], root + 12 + ch[1], root + 12 + ch[2]], tr.barDur * 1.02, tr.padIn, 0.04 * tr.padG, tr.padType, [-10, 0, 9]);
        if (tr.pb % 4 === 0 && lv.perc > 0.01 && !brk) INST.boom(tr, t);
      }
      if (lv.bass > 0.01) {
        const b = brk ? (s % 8 === 0 ? 'R' : '.') : tr.bassPat[s];
        if (b !== '.') INST.bass(tr, t, root - 12 + bassNote(b, ch), step * (brk ? 6 : 1.2), s % 4 === 0 ? 1 : 0.8, 0.35 + 0.65 * I);
      }
      if (lv.anvil > 0.01 && s % 4 === 2 && (!brk || s === 14)) {
        const accent = s === 6 || s === 14;
        INST.anvil(tr, ht(), mtof(root + 36 + ch[0]) * (accent ? 1 : 1.06), accent ? 1 : rnd(0.6, 0.75), tr.L.anvil);
      }
      const drums = !brk && !(tr.drop && s >= 8) && lv.drums > 0.01;
      if (drums) {
        const half = I < 0.4;
        if (half ? s === 0 || s === 11 : tr.kickPat[s] === 'x') INST.kick(tr, t, s === 0 ? 1 : 0.85, true);
        if (half ? s === 8 : s === 4 || s === 12) INST.snare(tr, ht(), 1, true);
        else if (tr.fill && s >= 12) INST.snare(tr, t, 0.4 + (s - 12) * 0.15, true);
      }
      if (lv.hats > 0.01 && (s % 2 === 0 || I > 0.8)) INST.hat(tr, ht(), s % 4 === 2 ? 0.9 : s % 2 ? 0.35 : 0.55);
      if (lv.perc > 0.01) {
        if (tr.fill && s >= 8 && s % 2 === 0) INST.tom(tr, t, 130 - (s - 8) * 9, 0.9);
        if (s === 15 && Math.random() < 0.35) INST.hat(tr, t, 1.2, true, tr.L.perc);
      }
      if (lv.arp > 0.01 && s % 2 === 0 && Math.random() > 0.08) {
        const idx = tr.arpPat[(s / 2) % tr.arpPat.length];
        INST.pluck(tr, ht(), root + 12 + tr.arpOct + arpNote(ch, idx), (s % 4 === 0 ? 1 : 0.7) * tr.arpG, tr.arpIn, tr.arpType);
      }
    },
  },
};

class Track {
  constructor(e, name, I) {
    const c = e.ctx, now = c.currentTime;
    this.e = e;
    this.name = name;
    this.def = TRACKS[name];
    this.nodes = [];
    this.srcs = [];
    this.out = this.node(gainNode(c, 0));
    this.out.gain.setValueAtTime(0, now);
    this.out.gain.linearRampToValueAtTime(1, now + FADE);
    this.out.connect(e.mus);
    const send = this.node(gainNode(c, this.def.rev));
    this.out.connect(send);
    send.connect(e.musSend);
    this.L = {};
    this.lv = {};
    for (const k of this.def.layers) {
      this.L[k] = this.node(gainNode(c, 0));
      this.L[k].connect(this.out);
      this.lv[k] = 0;
    }
    this.I = this.tI = I;
    this.delays = [];
    this.bar0 = 0; // bar where the current theme began; phrases count from here
    this.pb = 0;
    this.pending = null;
    this.applyTheme(e.theme, now, true);
    this.next = now + 0.05;
    this.n = 0;
    this.bar = -1;
    this.dying = 0;
    this.def.setup(this);
    this.levels(now, true);
  }

  node(n) {
    this.nodes.push(n);
    return n;
  }

  osc(type, f) {
    const o = this.e.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.start();
    this.srcs.push(o);
    this.nodes.push(o);
    return o;
  }

  voice(t, out) {
    return new Voice(this.e, t, this.e.sag, out);
  }

  // Unthemed tracks (menu) always use theme 0.
  setTheme(n) {
    if (!this.def.themed) return;
    this.pending = n === this.themeN ? null : n;
  }

  applyTheme(n, t, initial) {
    const d = this.def;
    if (!d.themed) n = 0;
    const th = THEMES[n], mode = MODES[th.mode];
    this.themeN = n;
    this.modeName = th.mode || '';
    this.root = d.root + th.key + (d.root + th.key < 40 ? 12 : 0);
    this.step = d.step / th.tempo;
    this.barDur = this.step * 16;
    this.chords = mode ? { ...CH, ...mode.chords } : CH;
    // A theme keeps half of the track's own progressions (alternating halves by theme) so
    // the track stays recognisable.
    this.progs = mode ? [...mode.progs, ...(d.progs || []).filter((_, i) => i % 2 === n % 2)] : d.progs;
    this.kicks = th.kicks ? KICKS[th.kicks] : d.kicks;
    this.arps = th.arps ? ARP_POOLS[th.arps] : ARPS;
    this.arpType = th.arp || d.arp;
    this.arpG = th.arp ? ARP_G[th.arp] / ARP_G[d.arp] : 1;
    this.padType = th.pad || 'sawtooth';
    this.padG = th.pad ? PAD_G[th.pad] : 1;
    this.swing = th.swing || 0;
    if (initial) return;
    this.themedAt = t; // for tools/audio-test
    this.themedStep = this.n;
    // Mid-track: retime the echoes and start a fresh phrase with a progression from the new pool.
    for (const [dl, steps] of this.delays) dl.delayTime.setTargetAtTime(steps * this.step, t, 0.05);
    this.prog = null;
  }

  levels(now, force) {
    const lv = this.def.levels(this.I);
    for (const k in lv) {
      if (force || Math.abs(lv[k] - this.lv[k]) > 0.004) {
        this.L[k].gain.setTargetAtTime(lv[k] * (this.def.trim[k] ?? 1), now, 0.25);
        this.lv[k] = lv[k];
      }
    }
    if (this.def.onI) this.def.onI(this, now);
  }

  update(now, dt, lookahead) {
    if (Math.abs(this.tI - this.I) > 1e-3) {
      this.I += (this.tI - this.I) * Math.min(1, dt * 1.5);
      this.levels(now, false);
    }
    if (this.next < now) {
      // Fell behind (hidden tab, long frame): skip ahead instead of bursting stale notes.
      const k = Math.ceil((now - this.next) / this.step);
      this.next += k * this.step;
      this.n += k;
    }
    const until = now + lookahead;
    while (this.next < until) {
      const s = this.n % 16, bar = Math.floor(this.n / 16);
      // A theme change waits for the next downbeat, so nothing is cut mid-bar: notes already
      // scheduled ring out and the new key, tempo and patterns start together.
      if (s === 0 && this.pending !== null) {
        this.applyTheme(this.pending, this.next, false);
        this.pending = null;
        this.bar0 = bar;
      }
      if (bar !== this.bar) {
        this.bar = bar;
        this.pb = bar - this.bar0;
        this.def.onBar(this, bar, this.next);
      }
      // Swing delays the off-beat eighths.
      this.def.onStep(this, s, s % 4 === 2 && this.swing ? this.next + this.swing * this.step : this.next);
      this.next += this.step;
      this.n++;
    }
  }

  stop(now) {
    if (this.dying) return;
    this.dying = now + FADE + 0.1;
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + FADE);
  }

  dispose() {
    for (const s of this.srcs) try { s.stop(); } catch { /* already stopped */ }
    for (const n of this.nodes) n.disconnect();
  }
}

// ---------------------------------------------------------------------------------------------
// Engine: one per AudioContext (the live one, or an OfflineAudioContext in tests).

class Engine {
  constructor(ctx, { offline = false, dry = false } = {}) {
    this.ctx = ctx;
    this.offline = offline;
    this.voices = [];
    this.lastPlay = new Map();
    this.hums = new Map();
    this.loops = new Map();
    this.dyingLoops = [];
    this.track = null;
    this.trackName = 'none';
    this.theme = 0;
    this.oldTracks = [];
    this.slow = 0;
    this.sag = 1;
    this.errors = 0;
    this.stats = { played: 0, limited: 0, dropped: 0, stolen: 0, tracks: 0 };
    this.buf = makeNoise(ctx);
    const c = ctx;
    this.sfx = gainNode(c, 1);
    this.mus = gainNode(c, MUSIC_LEVEL);
    this.revIn = gainNode(c, 1);
    // Reverb sends go through per-bus gains so the sfx and music volumes cover them too.
    this.sfxSend = gainNode(c, 1);
    this.musSend = gainNode(c, MUSIC_LEVEL);
    this.sfxSend.connect(this.revIn);
    this.musSend.connect(this.revIn);
    this.slowLP = filterNode(c, 'lowpass', Math.min(SLOW_MAX, c.sampleRate * 0.45), 0);
    this.sfx.connect(this.slowLP);
    this.mus.connect(this.slowLP);
    if (!dry) {
      const conv = c.createConvolver(), ret = gainNode(c, REV_LEVEL);
      conv.buffer = makeIR(c);
      this.revIn.connect(conv);
      conv.connect(ret);
      ret.connect(this.slowLP);
    }
    this.trim = dry ? 1 : MASTER_TRIM;
    this.master = gainNode(c, this.trim);
    this.slowLP.connect(this.master);
    let out = this.master;
    if (!dry) {
      const comp = c.createDynamicsCompressor(), lim = c.createDynamicsCompressor();
      setParams(comp, { threshold: -14, knee: 10, ratio: 3, attack: 0.004, release: 0.2 });
      setParams(lim, { threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.1 });
      this.comp = comp; // read by tools/audio-test for gain reduction
      this.lim = lim;
      const pre = gainNode(c, 0.5), clip = c.createWaveShaper();
      clip.curve = clipCurve();
      out.connect(comp);
      comp.connect(lim);
      lim.connect(pre);
      pre.connect(clip);
      out = clip;
    }
    out.connect(c.destination);
    this.out = out;
  }

  live() {
    return this.offline || this.ctx.state === 'running';
  }

  play(name, o) {
    const def = SFX[name];
    if (!def || !this.live()) return;
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(name);
    if (last !== undefined && now - last < RATE_LIMIT && now >= last) {
      this.stats.limited++;
      return;
    }
    const vol = clamp(num(o?.vol, 1), 0, 4);
    if (vol <= 0) return;
    this.sweep(now);
    const pri = def.pri ?? 1;
    if (this.activeVoices() >= VOICE_CAP && !this.steal(pri, now)) {
      this.stats.dropped++;
      return;
    }
    this.lastPlay.set(name, now);
    const vary = def.vary ?? 0.04;
    const p = clamp(num(o?.pitch, 1), 0.25, 4) * this.sag * (1 + (Math.random() * 2 - 1) * vary);
    const c = this.ctx, out = gainNode(c, vol * (MIX[name] ?? 1));
    const v = new Voice(this, now, p, out);
    v.name = name;
    v.pri = pri;
    v.nodes = [out];
    const pan = clamp(num(o?.pan, 0), -1, 1);
    if (pan && c.createStereoPanner) {
      const pn = c.createStereoPanner();
      pn.pan.value = pan;
      out.connect(pn);
      pn.connect(this.sfx);
      v.nodes.push(pn);
    } else out.connect(this.sfx);
    if (def.rev) {
      const s = gainNode(c, def.rev);
      out.connect(s);
      s.connect(this.sfxSend);
      v.nodes.push(s);
    }
    def.fn(v);
    this.voices.push(v);
    this.stats.played++;
  }

  activeVoices() {
    let n = 0;
    for (const v of this.voices) if (!v.stolen) n++;
    return n;
  }

  // Free a slot by fading out the oldest voice that is not more important than the new one.
  steal(pri, now) {
    let victim = null;
    for (const v of this.voices) if (!v.stolen && v.pri <= pri && (!victim || v.t < victim.t)) victim = v;
    if (!victim) return false;
    victim.stolen = true;
    victim.out.gain.cancelScheduledValues(now);
    victim.out.gain.setTargetAtTime(0, now, 0.01);
    for (const s of victim.srcs) try { s.stop(now + 0.06); } catch { /* stop already applied */ }
    victim.end = now + 0.07;
    this.stats.stolen++;
    return true;
  }

  sweep(now) {
    let w = 0;
    for (const v of this.voices) {
      if (v.end + 0.05 < now) for (const n of v.nodes) n.disconnect();
      else this.voices[w++] = v;
    }
    this.voices.length = w;
  }

  hum(id, p) {
    if (!this.live()) return;
    const now = this.ctx.currentTime;
    let h = this.hums.get(id);
    if (p == null) {
      if (h) h.release(now);
      return;
    }
    if (!h) {
      if (this.hums.size >= HUM_CAP) this.reapHums(now);
      if (this.hums.size >= HUM_CAP) return;
      h = new Hum(this, now);
      this.hums.set(id, h);
    }
    h.set(p, now);
  }

  reapHums(now) {
    for (const [id, h] of this.hums) {
      if (now - h.last > HUM_REAP) {
        h.dispose();
        this.hums.delete(id);
      }
    }
  }

  loop(name, on, o) {
    if (!LOOPS[name] || !this.live()) return;
    const now = this.ctx.currentTime;
    let l = this.loops.get(name);
    if (on) {
      if (!l) {
        l = new LoopVoice(this, name, now);
        this.loops.set(name, l);
      }
      l.set(o, now);
    } else if (l) {
      l.stop(now);
      this.loops.delete(name);
      this.dyingLoops.push(l);
    }
  }

  music(name, I) {
    const track = this.track;
    const i = clamp(num(I, track ? track.tI : 0.5), 0, 1);
    if (name === this.trackName) {
      if (track) track.tI = i;
      return;
    }
    if (name !== 'none' && !TRACKS[name]) return;
    if (!this.live()) return;
    const now = this.ctx.currentTime;
    if (track) {
      track.stop(now);
      this.oldTracks.push(track);
    }
    this.trackName = name;
    this.track = name === 'none' ? null : new Track(this, name, i);
    if (this.track) this.stats.tracks++;
  }

  setTheme(n) {
    this.theme = n;
    if (this.track) this.track.setTheme(n);
  }

  setSlowmo(k) {
    k = clamp(num(k, 0), 0, 1);
    if (Math.abs(k - this.slow) < 0.002 && !(k === 0 && this.slow !== 0)) return;
    this.slow = k;
    this.sag = 1 - 0.1 * k;
    const now = this.ctx.currentTime, top = Math.min(SLOW_MAX, this.ctx.sampleRate * 0.45);
    this.slowLP.frequency.setTargetAtTime(top * Math.pow(SLOW_MIN / top, Math.pow(k, 0.8)), now, 0.05);
    this.slowLP.Q.setTargetAtTime(k * 4, now, 0.1);
  }

  setVolumes(v) {
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v.master * this.trim, now, 0.03);
    this.sfx.gain.setTargetAtTime(v.sfx, now, 0.03);
    this.sfxSend.gain.setTargetAtTime(v.sfx, now, 0.03);
    this.mus.gain.setTargetAtTime(v.music * MUSIC_LEVEL, now, 0.03);
    this.musSend.gain.setTargetAtTime(v.music * MUSIC_LEVEL, now, 0.03);
  }

  update(dt) {
    if (!this.live()) return;
    const now = this.ctx.currentTime;
    dt = clamp(num(dt, 1 / 60), 0, 0.25);
    if (this.voices.length) this.sweep(now);
    if (this.hums.size) this.reapHums(now);
    if (this.dyingLoops.length) {
      this.dyingLoops = this.dyingLoops.filter((l) => {
        if (now < l.end) return true;
        l.dispose();
        return false;
      });
    }
    const la = Math.max(LOOKAHEAD, dt * 2 + 0.05);
    if (this.track) this.track.update(now, dt, la);
    if (this.oldTracks.length) {
      this.oldTracks = this.oldTracks.filter((tr) => {
        if (now < tr.dying) {
          tr.update(now, dt, la);
          return true;
        }
        tr.dispose();
        return false;
      });
    }
  }
}

function setParams(node, values) {
  for (const k in values) node[k].value = values[k];
}

// ---------------------------------------------------------------------------------------------
// Public API.

let live = null;
const prefs = { master: 1, sfx: 1, music: 1 };
let themePref = 0; // remembered so a setTheme() before init() still applies
let warnings = 0;

function guard(fn) {
  try {
    fn();
  } catch (err) {
    if (live) live.errors++;
    if (warnings++ < 5) console.warn('[audio]', err);
  }
}

export const audio = {
  init() {
    guard(() => {
      if (!live) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return;
        live = new Engine(new AC({ latencyHint: 'interactive' }));
        live.setVolumes(prefs);
        live.setTheme(themePref);
      }
      if (live.ctx.state !== 'running') {
        const p = live.ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
    });
  },
  play(name, opts) {
    if (live) guard(() => live.play(name, opts));
  },
  hum(id, params) {
    if (live) guard(() => live.hum(id, params));
  },
  loop(name, on, opts) {
    if (live) guard(() => live.loop(name, on, opts));
  },
  music(track, intensity) {
    if (live) guard(() => live.music(track, intensity));
  },
  // Sector music theme: any integer, wrapped to the theme count. Applies at the next bar.
  setTheme(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return;
    themePref = wrapTheme(n);
    if (live) guard(() => live.setTheme(themePref));
  },
  setSlowmo(k) {
    if (live) guard(() => live.setSlowmo(k));
  },
  setVolumes(v) {
    if (!v) return;
    for (const k in prefs) if (typeof v[k] === 'number' && Number.isFinite(v[k])) prefs[k] = clamp(v[k], 0, 1);
    if (live) guard(() => live.setVolumes(prefs));
  },
  update(dt) {
    if (live) guard(() => live.update(dt));
  },
};

// ---------------------------------------------------------------------------------------------
// Dev hooks for tools/audio-test. Not used by the game.

function facade(e) {
  return {
    play: (n, o) => e.play(n, o),
    hum: (id, p) => e.hum(id, p),
    loop: (n, on, o) => e.loop(n, on, o),
    music: (t, i) => e.music(t, i),
    setTheme: (n) => typeof n === 'number' && Number.isFinite(n) && e.setTheme(wrapTheme(n)),
    setSlowmo: (k) => e.setSlowmo(k),
    setVolumes: (v) => e.setVolumes({ ...prefs, ...v }),
    update: (dt) => e.update(dt),
  };
}

export const audioDev = {
  names: Object.keys(SFX),
  loops: Object.keys(LOOPS),
  tracks: Object.keys(TRACKS),
  themes: THEMES.length,
  limits: { RATE_LIMIT, VOICE_CAP, HUM_CAP, HUM_TIMEOUT },
  live: () => live,
  stats() {
    if (!live) return null;
    return { ...live.stats, voices: live.activeVoices(), hums: live.hums.size, loops: live.loops.size, track: live.trackName, errors: live.errors, state: live.ctx.state };
  },
  // Render through a fresh engine on an OfflineAudioContext. `script(api, t, frame, engine)`
  // runs at t = 0 and, when fps > 0, at every frame after, followed by engine.update(1/fps).
  // dry: skip reverb and the master dynamics, to measure a sound's own peak and length.
  async render({ seconds = 3, sampleRate = 44100, dry = false, fps = 0, script }) {
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
    const eng = new Engine(ctx, { offline: true, dry });
    const api = facade(eng), errors = [];
    const step = fps ? 1 / fps : 0;
    const run = (t, i) => {
      try {
        if (script) script(api, t, i, eng);
        if (fps) eng.update(step);
      } catch (err) {
        errors.push(String(err && err.stack || err));
      }
    };
    run(0, 0);
    if (fps) {
      const q = 128 / sampleRate;
      let prev = 0;
      for (let i = 1; ; i++) {
        const t = Math.round((i * step) / q) * q;
        if (t >= seconds - q) break;
        if (t <= prev) continue;
        prev = t;
        ctx.suspend(t).then(() => {
          run(t, i);
          ctx.resume();
        });
      }
    }
    const buffer = await ctx.startRendering();
    return { buffer, errors, engine: eng };
  },
};
