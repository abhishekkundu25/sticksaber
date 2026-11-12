// Audio checks and soundboard for src/audio/audio.js.
//
//   node tools/audio-test.js     serves the repo on :5181, drives tools/audio-test.html?auto in
//                                headless Chrome, prints per-sound measurements, exits 1 on failure.
//   open /tools/audio-test.html  soundboard; "Run automated checks" runs the same checks in-page.
//
// Per-sound measurements come from OfflineAudioContext renders (exact, faster than real time).
// A real-time pass then plays everything through the live AudioContext with an AnalyserNode.

const PORT = 5181;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const GROUPS = {
  Blades: ['swingLight', 'swingHeavy', 'swingSpin', 'ignite', 'extinguish', 'throw', 'catch'],
  Impacts: ['hitLight', 'hitHeavy', 'hitLaunch', 'hitSpike', 'kill', 'sever'],
  Defense: ['block', 'parry', 'clash', 'guardBreak', 'deflected'],
  Movement: ['jump', 'doubleJump', 'dash', 'land', 'landHeavy', 'footstep', 'thud', 'bounce', 'wallSplat'],
  Warnings: ['telegraph', 'telegraphRed'],
  'Enemies & boss': ['bolt', 'boltReflect', 'shockwave', 'slam', 'bossRoar', 'bossPhase', 'healDone', 'healInterrupt', 'adapt', 'stagger'],
  'Floors 4-10': ['thrust', 'blink', 'droneDive', 'lob', 'beep', 'explode', 'pillar', 'elite'],
  'Forge master': ['hammer', 'heatUp', 'vent', 'echo'],
  'Player & UI': ['hurt', 'death', 'perfectDodge', 'focus', 'rankUp', 'waveClear', 'victory', 'uiMove', 'uiSelect', 'heal'],
  'Pickups & draft': ['pickupHealth', 'pickupFocus', 'draftOpen', 'draftPick', 'powerSwap'],
  'Focus powers': ['powerNova', 'powerStasis', 'powerMend', 'powerArc', 'powerFlash', 'powerFlashEnd', 'powerMirror', 'powerJudgment', 'powerCrescent'],
  'Run events': ['crit', 'burn', 'summon', 'championIntro', 'sectorUp', 'secondWind', 'anomaly'],
};
const LOOP_NAMES = ['heal', 'throw', 'rain'];
const TRACK_NAMES = ['menu', 'combat', 'boss', 'boss2'];
const THEMED = ['combat', 'boss', 'boss2'];
const THEME_COUNT = 10;

// Longest acceptable dry length (to -60 dBFS) per sound; anything unlisted gets DEFAULT_LIMIT.
const DEFAULT_LIMIT = 1.2;
const LIMIT = {
  footstep: 0.15, uiMove: 0.12, uiSelect: 0.35, focus: 0.4, jump: 0.35, land: 0.3, bounce: 0.3,
  telegraph: 0.8, telegraphRed: 0.6, swingLight: 0.4, swingHeavy: 0.5, swingSpin: 0.9,
  kill: 1.6, sever: 1.3, parry: 1.6, guardBreak: 1.2, shockwave: 1.6, slam: 1.2,
  bossRoar: 2.0, bossPhase: 2.8, healDone: 1.6, adapt: 1.4, death: 2.4, perfectDodge: 1.2,
  rankUp: 1.0, waveClear: 2.2, victory: 3.2, heal: 1.2,
  thrust: 0.5, blink: 0.5, droneDive: 0.65, lob: 0.4, beep: 0.08, explode: 0.8, pillar: 1.0, elite: 1.7,
  hammer: 1.4, heatUp: 0.7, vent: 1.5, echo: 0.7,
  pickupHealth: 0.4, pickupFocus: 0.35, draftOpen: 0.9, draftPick: 0.7, powerSwap: 0.08,
  powerNova: 0.9, powerStasis: 1.2, powerMend: 0.9, powerArc: 0.25, powerFlash: 0.15, powerFlashEnd: 0.7,
  powerMirror: 0.7, powerJudgment: 0.6, powerCrescent: 0.5, crit: 0.4, burn: 0.35, summon: 1.0,
  championIntro: 1.3, sectorUp: 1.9, secondWind: 1.1, anomaly: 0.7,
};
// Sequences the game plays; the soundboard has a button for each.
const SEQUENCES = {
  'heatUp x3': [[0, 'heatUp', { pitch: 1 }], [0.6, 'heatUp', { pitch: 1.15 }], [1.2, 'heatUp', { pitch: 1.3 }]],
  grenade: [[0, 'lob'], [0.45, 'beep'], [0.7, 'beep'], [0.9, 'beep'], [1.05, 'beep'], [1.15, 'beep'], [1.25, 'explode']],
  'hammer + vent': [[0, 'hammer'], [0.9, 'vent']],
  'blink out/in': [[0, 'blink'], [0.7, 'blink'], [0.9, 'thrust']],
  'powerArc x4': [0, 1, 2, 3].map((i) => [i * 0.075, 'powerArc', { pitch: 1 + i * 0.12 }]),
  'powerFlash x6 + end': [...[0, 1, 2, 3, 4, 5].map((i) => [i * 0.08, 'powerFlash', { pitch: 1 + i * 0.06 }]), [0.55, 'powerFlashEnd']],
  'judgment + pillar': [[0, 'powerJudgment'], [0.5, 'pillar'], [0.56, 'pillar', { pan: 0.6 }]],
  'hit + crit': [[0, 'hitHeavy'], [0, 'crit']],
  'powerSwap slots': [1, 1.125, 1.25, 1.375, 1.5].map((p, i) => [i * 0.25, 'powerSwap', { pitch: p }]),
};
const SILENCE = 0.001; // -60 dBFS
const WARM = 0.5;
const MIN_PEAK = 0.01;

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const fmtDb = (x) => (x > 0 ? db(x).toFixed(1) : '-inf');

if (typeof window === 'undefined') await runNode();
else await runPage();

// =============================================================================================
// Node: serve, drive Chrome, report.

async function runNode() {
  const { spawn } = await import('node:child_process');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const path = await import('node:path');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let failed = 0;

  // The game logic is fuzzed headless, so the module must import and no-op in Node.
  try {
    const m = await import(pathToFileURL(path.join(root, 'src/audio/audio.js')).href);
    m.audio.play('parry');
    m.audio.update(0.016);
    m.audio.init();
    m.audio.hum(1, { speed: 1 });
    m.audio.hum(1, null);
    m.audio.loop('rain', true);
    m.audio.music('combat', 0.5);
    m.audio.setSlowmo(0.5);
    m.audio.setVolumes({ master: 0.5 });
    m.audio.play('hitHeavy', { vol: 1, pitch: 1, pan: 0 });
    m.audio.play('vent');
    m.audio.music('boss2', 0.5);
    m.audio.setTheme(3);
    m.audio.setTheme(-7);
    m.audio.setTheme('x');
    m.audio.play('sectorUp');
    m.audio.update(0.016);
    console.log('PASS  node import: every method is a silent no-op');
  } catch (err) {
    failed++;
    console.log('FAIL  node import:', err);
  }

  const server = spawn(process.execPath, [path.join(root, 'tools/serve.js'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((resolve, reject) => {
      server.stdout.on('data', (d) => String(d).includes('http') && resolve());
      server.on('exit', (code) => reject(new Error(`serve.js exited with ${code}`)));
    });
    const { default: puppeteer } = await import('puppeteer-core');
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    try {
      const page = await browser.newPage();
      const consoleErrors = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
        else if (msg.type() === 'warning') console.log('  [page warning]', msg.text());
        else if (msg.text().startsWith('[test]')) console.log('  ' + msg.text().slice(7));
      });
      page.on('pageerror', (err) => consoleErrors.push(`uncaught: ${err.message}`));
      await page.goto(`http://localhost:${PORT}/tools/audio-test.html?auto`);
      await page.waitForFunction('window.__audioTest && window.__audioTest.done', { timeout: 300000, polling: 500 });
      const r = await page.evaluate(() => window.__audioTest);

      console.log('\nOne-shots (dry = no reverb/dynamics; full = master chain incl. reverb tail)');
      console.log('name             dry pk dBFS  loud dB  dry len s  full pk dBFS  full len s  result');
      for (const s of r.sounds) {
        console.log(`${s.name.padEnd(16)} ${fmtDb(s.dryPeak).padStart(11)} ${fmtDb(s.loud).padStart(8)} ${s.dryDur.toFixed(2).padStart(10)} ${fmtDb(s.fullPeak).padStart(13)} ${s.fullDur.toFixed(2).padStart(11)}  ${s.ok ? 'ok' : 'FAIL ' + s.why}`);
        if (!s.ok) failed++;
      }
      console.log('\nMusic (full chain, 12 s render, from 2 s)');
      for (const m of r.music) console.log(`${m.track.padEnd(7)} I=${m.I.toFixed(1)}  rms ${fmtDb(m.rms).padStart(6)} dBFS  peak ${fmtDb(m.peak).padStart(6)} dBFS`);
      console.log('\nThemes (full chain, 10 s render at I=0.7, from 2 s; theme 0 is the tracks as written)');
      console.log('track  theme  root  bpm    mode      arp       pad       rms dBFS  peak dBFS');
      for (const m of r.themes) console.log(`${m.track.padEnd(7)}${String(m.theme).padStart(4)}  ${String(m.root).padStart(5)}  ${m.bpm.toFixed(0).padStart(4)}   ${(m.mode || '-').padEnd(9)} ${m.arp.padEnd(9)} ${m.pad.padEnd(9)} ${fmtDb(m.rms).padStart(7)}  ${fmtDb(m.peak).padStart(8)}`);
      console.log('\nChecks');
      for (const c of r.checks) {
        console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  ' + c.detail : ''}`);
        if (!c.ok) failed++;
      }
      if (consoleErrors.length) {
        failed++;
        console.log('FAIL  console errors / uncaught exceptions:\n  ' + consoleErrors.join('\n  '));
      } else console.log('PASS  no console errors or uncaught exceptions');
    } finally {
      await browser.close();
    }
  } catch (err) {
    failed++;
    console.log('FAIL ', err);
  } finally {
    server.kill();
  }
  console.log(failed ? `\n${failed} failure(s)` : '\nall audio checks passed');
  process.exit(failed ? 1 : 0);
}

// =============================================================================================
// Browser: soundboard + checks.

async function runPage() {
  const { audio, audioDev } = await import('../src/audio/audio.js');
  const $ = (id) => document.getElementById(id);
  const logEl = $('log');
  const log = (...a) => {
    const line = a.join(' ');
    console.log('[test] ' + line);
    logEl.textContent += line + '\n';
    logEl.scrollTop = logEl.scrollHeight;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const val = (id) => Number($(id).value);

  // ---- Soundboard -------------------------------------------------------------------------
  const ui = { lit: false, swing: false, track: 'none', testing: false };
  const start = () => audio.init();
  document.addEventListener('pointerdown', start, { capture: true });

  const sfx = $('sfx');
  for (const [group, names] of Object.entries(GROUPS)) {
    const h = document.createElement('h2');
    h.textContent = group;
    const row = document.createElement('div');
    row.className = 'row';
    for (const name of names) {
      const b = document.createElement('button');
      b.textContent = name;
      b.onclick = async (ev) => {
        start();
        const opts = () => ({ pitch: val('pitch'), pan: val('pan') });
        if (!ev.shiftKey) return audio.play(name, opts());
        for (let i = 0; i < 8; i++) {
          audio.play(name, opts());
          await sleep(110);
        }
      };
      row.append(b);
    }
    sfx.append(h, row);
  }
  for (const [label, seq] of Object.entries(SEQUENCES)) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => {
      start();
      for (const [at, name, o] of seq) setTimeout(() => audio.play(name, { pan: val('pan'), ...o }), at * 1000);
    };
    $('seq').append(b);
  }
  for (const name of LOOP_NAMES) {
    const b = document.createElement('button');
    b.textContent = name;
    b.onclick = () => {
      start();
      b.classList.toggle('on');
      audio.loop(name, b.classList.contains('on'), { pan: val('pan') });
    };
    $('loops').append(b);
  }
  for (const name of ['none', ...TRACK_NAMES]) {
    const b = document.createElement('button');
    b.textContent = name;
    b.dataset.track = name;
    b.onclick = () => {
      start();
      ui.track = name;
      for (const x of $('music').children) x.classList.toggle('on', x.dataset.track === name);
    };
    $('music').append(b);
  }
  for (let n = 0; n < audioDev.themes; n++) $('theme').append(new Option(n ? `sector ${n}` : 'sector 0 (as written)', n));
  $('theme').onchange = () => audio.setTheme(Number($('theme').value));
  $('humToggle').onclick = () => { start(); ui.lit = !ui.lit; $('humToggle').classList.toggle('on', ui.lit); };
  $('humSwing').onclick = () => { ui.swing = !ui.swing; $('humSwing').classList.toggle('on', ui.swing); };
  for (const id of ['vMaster', 'vSfx', 'vMusic']) {
    $(id).oninput = () => audio.setVolumes({ master: val('vMaster'), sfx: val('vSfx'), music: val('vMusic') });
  }

  // The game calls hum/music/setSlowmo/update every frame; so does the board.
  const hooks = new Set();
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000), t = now / 1000;
    last = now;
    if (!ui.testing) {
      if (ui.lit) {
        const sp = ui.swing ? Math.max(0, Math.sin(t * 5)) ** 2 : val('humSpeed');
        audio.hum('board', { speed: sp, pan: val('pan') });
      }
      audio.music(ui.track, val('intensity'));
      audio.setSlowmo(val('slowmo'));
    }
    for (const h of hooks) h(t, dt);
    audio.update(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // ---- Checks -----------------------------------------------------------------------------
  function analyze(buf, from = 0, to = buf.duration) {
    const sr = buf.sampleRate, i0 = Math.floor(from * sr), i1 = Math.min(buf.length, Math.floor(to * sr));
    const win = Math.floor(sr * 0.05);
    let peak = 0, lastLoud = -1, sum = 0, loud = 0, hf = 0;
    const chans = [];
    for (let ch = 0; ch < buf.numberOfChannels; ch++) chans.push(buf.getChannelData(ch));
    for (const d of chans) {
      let wsum = 0;
      for (let i = i0; i < i1; i++) {
        const x = d[i], a = Math.abs(x);
        if (a > peak) peak = a;
        if (a > SILENCE && i > lastLoud) lastLoud = i;
        sum += x * x;
        if (i > i0) hf += (x - d[i - 1]) ** 2;
        wsum += x * x;
        if (i - i0 >= win) wsum -= d[i - win] * d[i - win];
        if (i - i0 >= win - 1) loud = Math.max(loud, Math.sqrt(Math.max(0, wsum) / win));
      }
    }
    const n = (i1 - i0) * chans.length;
    return { peak, dur: lastLoud < 0 ? 0 : (lastLoud + 1) / sr, rms: Math.sqrt(sum / n), loud, hf: Math.sqrt(hf / sum) };
  }

  async function runChecks() {
    ui.testing = true;
    const R = { checks: [], sounds: [], music: [], themes: [], done: false };
    const check = (name, ok, detail = '') => {
      R.checks.push({ name, ok: !!ok, detail });
      log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
    };
    const names = audioDev.names, expected = Object.values(GROUPS).flat();
    const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

    // Contract.
    check('contract: one-shot names match the spec', same(names, expected),
      `missing [${expected.filter((n) => !names.includes(n))}] extra [${names.filter((n) => !expected.includes(n))}]`);
    check('contract: loops and tracks', same(audioDev.loops, LOOP_NAMES) && same(audioDev.tracks, TRACK_NAMES));
    check('contract: api methods', ['init', 'play', 'hum', 'loop', 'music', 'setTheme', 'setSlowmo', 'setVolumes', 'update'].every((k) => typeof audio[k] === 'function'));

    // Every one-shot, rendered offline.
    log('rendering one-shots offline...');
    for (const name of names) {
      const lim = LIMIT[name] ?? DEFAULT_LIMIT;
      const dry = await audioDev.render({ seconds: lim + 1, dry: true, script: (a) => a.play(name) });
      // The master compressor starts each context gain-reduced, so full-chain renders let it
      // settle for WARM seconds before playing.
      const full = await audioDev.render({ seconds: WARM + lim + 3.5, fps: 20, script: (a, t, i) => i === WARM * 20 && a.play(name) });
      const d = analyze(dry.buffer), f = analyze(full.buffer, WARM);
      f.dur -= WARM;
      const why = [];
      if (dry.errors.length || full.errors.length) why.push('threw: ' + [...dry.errors, ...full.errors][0]);
      if (d.peak < MIN_PEAK) why.push('silent');
      if (d.peak >= 1) why.push('dry clips');
      if (f.peak >= 1) why.push('master clips');
      if (d.dur > lim) why.push(`too long (> ${lim}s)`);
      if (f.dur > full.buffer.duration - WARM - 0.2) why.push('tail never decays');
      R.sounds.push({ name, dryPeak: d.peak, loud: d.loud, dryDur: d.dur, fullPeak: f.peak, fullDur: f.dur, ok: !why.length, why: why.join(', ') });
    }
    const bad = R.sounds.filter((s) => !s.ok);
    check(`one-shots: ${names.length} rendered, audible, unclipped, decaying`, !bad.length, bad.map((s) => `${s.name}: ${s.why}`).join('; '));

    // Per-play variation.
    for (const name of ['hitLight', 'hitHeavy', 'clash', 'parry']) {
      const a = await audioDev.render({ seconds: 0.5, dry: true, script: (x) => x.play(name) });
      const b = await audioDev.render({ seconds: 0.5, dry: true, script: (x) => x.play(name) });
      const da = a.buffer.getChannelData(0), dbb = b.buffer.getChannelData(0);
      let diff = 0, energy = 0;
      for (let i = 0; i < da.length; i++) { diff += (da[i] - dbb[i]) ** 2; energy += da[i] ** 2; }
      const rel = Math.sqrt(diff / energy);
      check(`variation: two ${name} plays differ`, rel > 0.05, `relative difference ${rel.toFixed(2)}`);
    }

    // Options and warning legibility.
    {
      // Derivative-to-signal energy ratio: equals 2*pi*f/sr for a sine, so it tracks brightness.
      const zcr = (buf) => (analyze(buf).hf * buf.sampleRate) / (2 * Math.PI);
      const glint = await audioDev.render({ seconds: 1, dry: true, script: (a) => a.play('telegraph') });
      const red = await audioDev.render({ seconds: 1, dry: true, script: (a) => a.play('telegraphRed') });
      const g = zcr(glint.buffer), r = zcr(red.buffer);
      check('telegraph vs telegraphRed: clearly different registers', g > r * 2, `brightness ~${g.toFixed(0)} Hz vs ~${r.toFixed(0)} Hz`);
      const left = await audioDev.render({ seconds: 0.5, dry: true, script: (a) => a.play('hitHeavy', { pan: -1 }) });
      const L = analyze({ ...left.buffer, numberOfChannels: 1, getChannelData: () => left.buffer.getChannelData(0), sampleRate: left.buffer.sampleRate, length: left.buffer.length, duration: left.buffer.duration });
      const Rt = analyze({ numberOfChannels: 1, getChannelData: () => left.buffer.getChannelData(1), sampleRate: left.buffer.sampleRate, length: left.buffer.length, duration: left.buffer.duration });
      check('play opts: pan -1 lands left', L.rms > Rt.rms * 10, `L ${fmtDb(L.rms)} vs R ${fmtDb(Rt.rms)} dBFS`);
      const quiet = await audioDev.render({ seconds: 0.5, dry: true, script: (a) => a.play('hitHeavy', { vol: 0.25 }) });
      const loud = await audioDev.render({ seconds: 0.5, dry: true, script: (a) => a.play('hitHeavy', { vol: 1 }) });
      const ratio = analyze(loud.buffer).rms / analyze(quiet.buffer).rms;
      check('play opts: vol scales output', ratio > 3 && ratio < 5, `vol 1 / vol 0.25 rms ratio ${ratio.toFixed(2)}`);
      const muted = await audioDev.render({ seconds: 0.6, fps: 30, script: (a, t, i) => { a.setVolumes({ sfx: 0 }); if (i === 6) a.play('hitHeavy'); } });
      check('setVolumes: sfx 0 silences one-shots', analyze(muted.buffer).peak < SILENCE, `peak ${fmtDb(analyze(muted.buffer).peak)} dBFS`);
    }

    // New sounds: what the game relies on beyond the per-sound checks.
    {
      const by = Object.fromEntries(R.sounds.map((s) => [s.name, s]));
      const zcr = (buf) => (analyze(buf).hf * buf.sampleRate) / (2 * Math.PI);
      // Spectral centroid from 200 Hz to 2.5 kHz, where heatUp's climbing tones sit (Goertzel
      // scan, 10 Hz steps).
      const centroid = (buf, from, to) => {
        const sr = buf.sampleRate, d = buf.getChannelData(0).subarray(Math.floor(from * sr), Math.floor(to * sr));
        let sum = 0, wsum = 0;
        for (let f = 200; f <= 2500; f += 10) {
          const k = 2 * Math.cos((2 * Math.PI * f) / sr);
          let s1 = 0, s2 = 0;
          for (let i = 0; i < d.length; i++) { const s0 = d[i] + k * s1 - s2; s2 = s1; s1 = s0; }
          const m = s1 * s1 + s2 * s2 - k * s1 * s2;
          sum += m;
          wsum += m * f;
        }
        return wsum / sum;
      };
      const heat = [];
      for (const pitch of [1, 1.15, 1.3]) {
        const r = await audioDev.render({ seconds: 1, dry: true, script: (a) => a.play('heatUp', { pitch }) });
        heat.push({ hz: centroid(r.buffer, 0.2, 0.45), ...analyze(r.buffer) });
      }
      check('heatUp: pitch 1 / 1.15 / 1.3 climb in spectrum, keep length, stay unclipped',
        heat[1].hz > heat[0].hz * 1.07 && heat[2].hz > heat[1].hz * 1.07 && heat.every((h) => Math.abs(h.dur - heat[0].dur) < 0.05 && h.peak < 1),
        heat.map((h) => `~${h.hz.toFixed(0)} Hz ${h.dur.toFixed(2)} s ${fmtDb(h.peak)} dBFS`).join(' | '));
      // When the loudest 20 ms is centred, in seconds after the trigger.
      const peakAt = (buf) => {
        const d = buf.getChannelData(0), win = Math.floor(buf.sampleRate * 0.02);
        let best = 0, at = 0, e = 0;
        for (let i = 0; i < d.length; i++) {
          e += d[i] * d[i];
          if (i >= win) e -= d[i - win] * d[i - win];
          if (e > best) { best = e; at = i; }
        }
        return at / buf.sampleRate - 0.01;
      };
      const bl = await audioDev.render({ seconds: 1, dry: true, script: (a) => a.play('blink') });
      const da = await audioDev.render({ seconds: 1, dry: true, script: (a) => a.play('dash') });
      const pb = peakAt(bl.buffer), pd = peakAt(da.buffer);
      check('blink vs dash: blink swells to a late cut, dash peaks early and is darker', pb > 0.11 && pd < 0.11 && zcr(bl.buffer) > zcr(da.buffer) * 1.1,
        `loudest at ${(pb * 1000).toFixed(0)} ms vs ${(pd * 1000).toFixed(0)} ms, brightness ~${zcr(bl.buffer).toFixed(0)} vs ~${zcr(da.buffer).toFixed(0)} Hz`);
      const beeps = await audioDev.render({ seconds: 1.2, dry: true, fps: 60, script: (a, t, i) => i < 48 && i % 6 === 0 && a.play('beep') });
      const bp = analyze(beeps.buffer);
      check('beep: 8 ticks 100 ms apart all play, none limited or dropped', beeps.engine.stats.played === 8 && !beeps.engine.stats.limited && !beeps.engine.stats.dropped && bp.peak < 1,
        `${JSON.stringify(beeps.engine.stats)} peak ${fmtDb(bp.peak)} dBFS`);
      check('impact scale: explode is shorter and quieter than slam; hammer is louder than slam',
        by.explode.loud < by.slam.loud && by.explode.dryDur < by.slam.dryDur && by.hammer.loud > by.slam.loud,
        `loudest 50 ms: explode ${fmtDb(by.explode.loud)}, slam ${fmtDb(by.slam.loud)}, hammer ${fmtDb(by.hammer.loud)} dB`);
      check('vent: long enough to mark the punish window', by.vent.dryDur > 1 && by.vent.dryDur < 1.5, `${by.vent.dryDur.toFixed(2)} s`);
    }

    // Sounds for the 100-floor run: the properties the game relies on.
    {
      const by = Object.fromEntries(R.sounds.map((s) => [s.name, s]));
      const bright = async (name, o) => {
        const r = await audioDev.render({ seconds: 0.6, dry: true, script: (a) => a.play(name, o) });
        return (analyze(r.buffer).hf * r.buffer.sampleRate) / (2 * Math.PI);
      };
      const bh = await bright('pickupHealth'), bf = await bright('pickupFocus');
      check('pickups: focus orb is clearly brighter than health orb', bf > bh * 1.5, `brightness ~${bh.toFixed(0)} vs ~${bf.toFixed(0)} Hz`);
      const quietest = Math.max(by.pickupHealth.loud, by.pickupFocus.loud, by.burn.loud, by.powerSwap.loud);
      check('frequent sounds (pickups, burn, powerSwap) sit well under a light hit', db(quietest) < db(by.hitLight.loud) - 8,
        `loudest 50 ms: pickupHealth ${fmtDb(by.pickupHealth.loud)}, pickupFocus ${fmtDb(by.pickupFocus.loud)}, burn ${fmtDb(by.burn.loud)}, powerSwap ${fmtDb(by.powerSwap.loud)}, hitLight ${fmtDb(by.hitLight.loud)} dB`);
      const s1 = await bright('powerSwap', { pitch: 1 }), s2 = await bright('powerSwap', { pitch: 1.5 });
      check('powerSwap: pitch 1.5 is audibly higher than pitch 1', s2 > s1 * 1.3, `~${s1.toFixed(0)} -> ~${s2.toFixed(0)} Hz`);
      const flash = await audioDev.render({ seconds: 1.4, dry: true, fps: 100, script: (a, t, i) => {
        if (i < 48 && i % 8 === 0) a.play('powerFlash', { pitch: 1 + i / 80 });
        if (i === 55) a.play('powerFlashEnd');
      } });
      check('powerFlash: 6 cuts 80 ms apart and the end hit all play', flash.engine.stats.played === 7 && !flash.engine.stats.limited && !flash.engine.stats.dropped && analyze(flash.buffer).peak < 1,
        `${JSON.stringify(flash.engine.stats)} peak ${fmtDb(analyze(flash.buffer).peak)} dBFS`);
      const arc = await audioDev.render({ seconds: 0.8, dry: true, fps: 100, script: (a, t, i) => i < 28 && i % 7 === 0 && a.play('powerArc', { pitch: 1 + i / 50 }) });
      check('powerArc: 4 zaps within 0.3 s all play', arc.engine.stats.played === 4 && !arc.engine.stats.limited && analyze(arc.buffer).peak < 1,
        `${JSON.stringify(arc.engine.stats)} peak ${fmtDb(analyze(arc.buffer).peak)} dBFS`);
      const burns = await audioDev.render({ seconds: 2.4, fps: 20, script: (a, t, i) => i >= 10 && i % 4 === 0 && a.play('burn', { pan: Math.random() * 2 - 1 }) });
      check('burn: five a second for two seconds stays quiet and unclipped', analyze(burns.buffer, WARM).peak < 0.25 && !burns.engine.stats.dropped,
        `played ${burns.engine.stats.played}, peak ${fmtDb(analyze(burns.buffer, WARM).peak)} dBFS`);
      // Fill all voices with ordinary sounds, then fire important and frequent ones.
      const filler = names.filter((n) => !['footstep', 'uiMove', 'pickupHealth', 'pickupFocus', 'burn', 'powerSwap'].includes(n) && !/^power|^(kill|sever|parry|guardBreak|telegraph|telegraphRed|shockwave|slam|bossRoar|bossPhase|healInterrupt|adapt|stagger|blink|explode|pillar|hammer|heatUp|vent|elite|death|perfectDodge|waveClear|victory|summon|championIntro|sectorUp|secondWind)$/.test(n)).slice(0, 24);
      let res = null;
      await audioDev.render({ seconds: 0.5, dry: true, script: (a, t, i, e) => {
        filler.forEach((n) => a.play(n));
        const s0 = { ...e.stats };
        for (const n of ['secondWind', 'sectorUp', 'powerNova']) a.play(n);
        const s1 = { ...e.stats };
        for (const n of ['burn', 'pickupHealth', 'pickupFocus', 'powerSwap']) a.play(n);
        res = { filled: filler.length, important: s1.played - s0.played, frequent: e.stats.played - s1.played, dropped: e.stats.dropped - s1.dropped };
      } });
      check('priorities: under a full voice cap, secondWind/sectorUp/powerNova steal; pickups, burn, powerSwap yield',
        res.filled === 24 && res.important === 3 && res.frequent === 0 && res.dropped === 4, JSON.stringify(res));
      check('impact scale: powerFlashEnd lands harder than one powerFlash cut', by.powerFlashEnd.loud > by.powerFlash.loud,
        `loudest 50 ms: ${fmtDb(by.powerFlash.loud)} vs ${fmtDb(by.powerFlashEnd.loud)} dB`);
    }

    // Rate limit and polyphony.
    {
      const r = await audioDev.render({ seconds: 0.2, dry: true, script: (a) => { for (let i = 0; i < 10; i++) a.play('hitLight'); } });
      check('rate limit: 10 same-name triggers in one instant play once', r.engine.stats.played === 1 && r.engine.stats.limited === 9, JSON.stringify(r.engine.stats));
      const r2 = await audioDev.render({ seconds: 1, dry: true, fps: 60, script: (a, t) => t < 0.5 && a.play('clash') });
      check('rate limit: a trigger every frame for 0.5 s plays at most every 30 ms', r2.engine.stats.played <= 17, `played ${r2.engine.stats.played}`);
      let maxVoices = 0;
      const r3 = await audioDev.render({ seconds: 4, fps: 30, script: (a, t, i, e) => {
        if (i >= 15 && i < 19) for (const n of names) a.play(n, { pan: Math.random() * 2 - 1 });
        maxVoices = Math.max(maxVoices, e.activeVoices());
      } });
      const p3 = analyze(r3.buffer).peak;
      check(`polyphony: all ${names.length} sounds x4 at once stays <= ${audioDev.limits.VOICE_CAP} voices, no clip`, maxVoices <= audioDev.limits.VOICE_CAP && p3 < 1,
        `max voices ${maxVoices}, stolen ${r3.engine.stats.stolen}, dropped ${r3.engine.stats.dropped}, peak ${fmtDb(p3)} dBFS`);
      const heavy = ['hitHeavy', 'hitSpike', 'slam', 'kill', 'shockwave', 'guardBreak', 'landHeavy', 'wallSplat'];
      const sd = await audioDev.render({ seconds: 1.5, dry: true, script: (a) => heavy.forEach((n) => a.play(n)) });
      const sf = await audioDev.render({ seconds: 2, fps: 20, script: (a, t, i) => i === WARM * 20 && heavy.forEach((n) => a.play(n)) });
      const pd = analyze(sd.buffer).peak, pf = analyze(sf.buffer).peak;
      check('stacking: 8 heavy impacts at once are held below clipping by the master chain', pf < 1, `summed dry ${fmtDb(pd)} dBFS -> master ${fmtDb(pf)} dBFS`);
    }

    // Hum: idle, swinging, then left un-updated.
    {
      const r = await audioDev.render({ seconds: 3.2, dry: true, fps: 60, script: (a, t) => {
        if (t < 1) a.hum(7, { speed: 0 });
        else if (t < 2) a.hum(7, { speed: 0.5 + 0.5 * Math.sin((t - 1) * Math.PI * 4), pan: 0.5 });
      } });
      const idle = analyze(r.buffer, 0.3, 0.95), swing = analyze(r.buffer, 1.05, 1.95), after = analyze(r.buffer, 2.5, 3.1);
      check('hum: audible when idle', idle.rms > 0.003 && idle.peak < 1, `idle rms ${fmtDb(idle.rms)} dBFS`);
      check('hum: swinging is louder', swing.rms > idle.rms * 1.5, `swing rms ${fmtDb(swing.rms)} dBFS`);
      check('hum: fades by itself once updates stop', after.peak < SILENCE && r.engine.hums.size === 0, `peak after ${fmtDb(after.peak)} dBFS, voices left ${r.engine.hums.size}`);
      let capped = 0;
      await audioDev.render({ seconds: 0.5, fps: 60, script: (a, t, i, e) => {
        for (let id = 0; id < 9; id++) a.hum(id, { speed: 0.3 });
        capped = Math.max(capped, e.hums.size);
      } });
      const r3 = await audioDev.render({ seconds: 1.6, dry: true, fps: 60, script: (a, t) => (t < 1 ? a.hum(0, { speed: 0.6 }) : a.hum(0, null)) });
      check('hum: at most 6 voices; extra ids ignored', capped === 6, `voices with 9 ids: ${capped}`);
      check('hum: null stops it', analyze(r3.buffer, 1.25, 1.6).peak < SILENCE);
      // Pitch follows speed: read the motor oscillator's frequency after a steady second.
      const humHz = async (speed) => {
        const r = await audioDev.render({ seconds: 1, dry: true, fps: 60, script: (a) => a.hum(1, { speed }) });
        return r.engine.hums.get(1).o[0].frequency.value;
      };
      const fs = await humHz(0), ff = await humHz(1);
      check('hum: speed raises pitch', ff > fs * 1.15, `${fs.toFixed(0)} Hz -> ${ff.toFixed(0)} Hz`);
    }

    // Loops.
    for (const name of LOOP_NAMES) {
      const r = await audioDev.render({ seconds: 3.6, dry: true, fps: 30, script: (a, t) => a.loop(name, t < 2, { vol: 1 }) });
      const on = analyze(r.buffer, 0.6, 1.95), off = analyze(r.buffer, 2.9, 3.5);
      check(`loop ${name}: sustains while on, silent after off`, on.rms > 0.003 && on.peak < 1 && off.peak < SILENCE && !r.errors.length,
        `on rms ${fmtDb(on.rms)} peak ${fmtDb(on.peak)} dBFS, after off ${fmtDb(off.peak)} dBFS ${r.errors[0] || ''}`);
    }

    // Music.
    log('rendering music offline...');
    const musicRms = {};
    for (const track of TRACK_NAMES) {
      for (const I of [0, 0.5, 1]) {
        const r = await audioDev.render({ seconds: 12, fps: 30, script: (a) => a.music(track, I) });
        const m = analyze(r.buffer, 2, 12);
        musicRms[track + I] = m.rms;
        R.music.push({ track, I, rms: m.rms, peak: m.peak });
        check(`music ${track} I=${I}: plays under the sfx`, m.rms > 0.004 && m.peak < 0.6 && r.engine.stats.tracks === 1 && !r.errors.length,
          `rms ${fmtDb(m.rms)} peak ${fmtDb(m.peak)} dBFS, tracks started ${r.engine.stats.tracks} ${r.errors[0] || ''}`);
      }
    }
    check('music: combat intensity adds layers', musicRms.combat1 > musicRms.combat0 * 1.4, `${fmtDb(musicRms.combat0)} -> ${fmtDb(musicRms.combat1)} dBFS`);
    check('music: boss intensity adds layers', musicRms.boss1 > musicRms.boss0 * 1.4, `${fmtDb(musicRms.boss0)} -> ${fmtDb(musicRms.boss1)} dBFS`);
    check('music: boss2 intensity adds layers', musicRms.boss21 > musicRms.boss20 * 1.4, `${fmtDb(musicRms.boss20)} -> ${fmtDb(musicRms.boss21)} dBFS`);
    {
      for (const [from, to] of [['combat', 'boss'], ['boss', 'boss2']]) {
        const r = await audioDev.render({ seconds: 8, fps: 30, script: (a, t) => a.music(t < 3 ? from : to, 0.7) });
        const mid = analyze(r.buffer, 3, 4.5), before = analyze(r.buffer, 1.5, 3);
        check(`music: ${from} -> ${to} crossfades without a gap and frees the old track`, mid.rms > before.rms * 0.4 && r.engine.oldTracks.length === 0 && r.engine.stats.tracks === 2,
          `rms before ${fmtDb(before.rms)}, during ${fmtDb(mid.rms)} dBFS, old tracks left ${r.engine.oldTracks.length}`);
      }
      const r2 = await audioDev.render({ seconds: 7, fps: 30, script: (a, t) => a.music(t < 2 ? 'combat' : 'none', 0.8) });
      check("music: 'none' fades to silence", analyze(r2.buffer, 5.5, 7).peak < SILENCE, `peak ${fmtDb(analyze(r2.buffer, 5.5, 7).peak)} dBFS`);
    }

    // Sector themes.
    log('rendering themes offline...');
    {
      check('themes: audioDev reports the theme count', audioDev.themes === THEME_COUNT, `${audioDev.themes}`);
      // A seeded Math.random makes two renders of the same graph sample-identical.
      const seeded = async (fn) => {
        const orig = Math.random;
        let x = 0x2545f491;
        Math.random = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
        try { return await fn(); } finally { Math.random = orig; }
      };
      const maxDiff = (a, b) => {
        let m = 0;
        for (let ch = 0; ch < 2; ch++) {
          const x = a.getChannelData(ch), y = b.getChannelData(ch);
          for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - y[i]));
        }
        return m;
      };
      for (const track of THEMED) {
        const go = (pre) => seeded(() => audioDev.render({ seconds: 6, fps: 30, dry: true, script: (a, t, i) => { if (i === 0) pre(a); a.music(track, 0.8); } }));
        const base = await go(() => {});
        const again = await go(() => {});
        const t0 = await go((a) => a.setTheme(0));
        const t10 = await go((a) => { a.setTheme(4); a.setTheme(10); });
        const tm = await go((a) => a.setTheme(-10));
        const t1 = await go((a) => a.setTheme(1));
        check(`themes: ${track} theme 1 renders differently from theme 0 under the same seed`, maxDiff(base.buffer, t1.buffer) > 0.01, `max sample difference ${fmtDb(maxDiff(base.buffer, t1.buffer))} dBFS`);
        // Chrome's renderer is not bit-exact run to run (about -140 dBFS of float noise), so
        // "identical" means within -100 dBFS; any changed note would differ by -40 dBFS or more.
        const d = Math.max(maxDiff(base.buffer, t0.buffer), maxDiff(base.buffer, t10.buffer), maxDiff(base.buffer, tm.buffer));
        const ctl = maxDiff(base.buffer, again.buffer);
        check(`themes: ${track} theme 0 (and 10, -10) renders the same as no theme`, d < 1e-5 && analyze(base.buffer).rms > 0.004,
          `max sample difference ${fmtDb(d)} dBFS (two renders with no theme: ${fmtDb(ctl)} dBFS)`);
      }
      const rms0 = {};
      const seen = {};
      for (const track of THEMED) {
        for (let n = 0; n < THEME_COUNT; n++) {
          const r = await audioDev.render({ seconds: 10, fps: 30, script: (a, t, i) => { if (i === 0) a.setTheme(n); a.music(track, 0.7); } });
          const m = analyze(r.buffer, 2, 10), tr = r.engine.track;
          if (n === 0) rms0[track] = m.rms;
          const rel = db(m.rms) - db(rms0[track]);
          const row = { track, theme: n, root: tr.root, bpm: 60 / tr.step / 4, mode: tr.modeName, arp: tr.arpType, pad: tr.padType, rms: m.rms, peak: m.peak };
          R.themes.push(row);
          (seen[track] ||= []).push(`${tr.root}|${tr.step.toFixed(5)}|${tr.arpType}|${tr.padType}|${tr.swing}|${tr.progs.length}`);
          check(`themes: ${track} theme ${n} plays at a level close to theme 0`,
            tr.themeN === n && m.rms > 0.004 && m.peak < 0.6 && Math.abs(rel) < 4 && !r.errors.length && r.engine.stats.tracks === 1,
            `root ${tr.root} ${row.bpm.toFixed(0)} bpm ${tr.modeName || 'as written'}, rms ${fmtDb(m.rms)} (${rel >= 0 ? '+' : ''}${rel.toFixed(1)} dB) peak ${fmtDb(m.peak)} dBFS ${r.errors[0] || ''}`);
        }
        check(`themes: ${track} has ${THEME_COUNT} distinct key/tempo/timbre combinations`, new Set(seen[track]).size === THEME_COUNT && new Set(R.themes.filter((x) => x.track === track).map((x) => x.root)).size >= 8);
      }
      const bpms = R.themes.map((x) => x.bpm / R.themes.find((y) => y.track === x.track && y.theme === 0).bpm);
      check('themes: tempo stays within 10% of the written tempo', bpms.every((k) => k >= 0.899 && k <= 1.101), `range ${Math.min(...bpms).toFixed(3)} to ${Math.max(...bpms).toFixed(3)}`);

      // Mid-track changes land on a downbeat without a gap, a restart or a click.
      for (const track of THEMED) {
        const marks = [];
        const r = await audioDev.render({ seconds: 14, fps: 30, script: (a, t, i, e) => {
          a.music(track, 0.8);
          if (i === 90) a.setTheme(4);
          if (i === 240) a.setTheme(7);
          const tr = e.track;
          if (tr && tr.themedAt !== undefined && marks[marks.length - 1]?.at !== tr.themedAt) marks.push({ at: tr.themedAt, n: tr.themeN, step: tr.themedStep });
        } });
        const tr = r.engine.track, d0 = r.buffer.getChannelData(0), sr = r.buffer.sampleRate;
        const jump = (from, to) => {
          let m = 0;
          for (let i = Math.max(1, Math.floor(from * sr)); i < Math.min(d0.length, Math.floor(to * sr)); i++) m = Math.max(m, Math.abs(d0[i] - d0[i - 1]));
          return m;
        };
        const ok = marks.length === 2 && marks[0].n === 4 && marks[1].n === 7 && tr.themeN === 7 && r.engine.stats.tracks === 1 && !r.errors.length;
        const det = [];
        let smooth = ok;
        for (const mk of marks) {
          const before = analyze(r.buffer, mk.at - 1.5, mk.at), after = analyze(r.buffer, mk.at, mk.at + 1.5);
          const jb = jump(mk.at - 0.03, mk.at + 0.03), jr = jump(1, mk.at - 0.1);
          if (!(after.rms > before.rms * 0.5 && jb <= jr * 1.5 && mk.step % 16 === 0)) smooth = false;
          det.push(`at ${mk.at.toFixed(2)} s (step ${mk.step}): rms ${fmtDb(before.rms)} -> ${fmtDb(after.rms)} dBFS, sample jump at the change ${jb.toFixed(3)} vs ${jr.toFixed(3)} max before`);
        }
        check(`themes: ${track} changes theme mid-track on a downbeat, no gap, click or restart`, ok && smooth, det.join('; ') || JSON.stringify(marks));
      }

      // A theme set while the menu plays waits for the next themed track.
      let menuTheme = -1;
      const mr = await audioDev.render({ seconds: 5, fps: 30, script: (a, t, i, e) => {
        if (i === 0) a.music('menu', 0.5);
        if (i === 30) a.setTheme(6);
        if (i === 60) menuTheme = e.track.themeN;
        if (i >= 75) a.music('combat', 0.5);
      } });
      check('themes: menu ignores the theme, the next combat track picks it up', menuTheme === 0 && mr.engine.track.themeN === 6 && mr.engine.track.root === 47,
        `menu theme ${menuTheme}, combat theme ${mr.engine.track.themeN}, combat root ${mr.engine.track.root}`);
    }

    // Slow-mo darkens.
    {
      const go = (k) => audioDev.render({ seconds: 1, dry: true, fps: 60, script: (a, t, i) => { a.setSlowmo(k); if (i === 15) a.play('hitHeavy'); } });
      const n = analyze((await go(0)).buffer), s = analyze((await go(1)).buffer);
      check('slow-mo: master lowpass removes the top end', s.hf < n.hf * 0.6, `hf index ${n.hf.toFixed(3)} -> ${s.hf.toFixed(3)}`);
    }

    // Real time, through the live context.
    log('real-time pass...');
    // Set before init() on purpose: the engine must pick it up when it is created. (On the
    // soundboard the engine may already exist, so this only proves something under ?auto.)
    const hadEngine = !!audioDev.live();
    audio.setTheme(13);
    audio.init();
    for (let i = 0; i < 40 && audioDev.stats()?.state !== 'running'; i++) await sleep(50);
    // Headless Chrome reports 'running' before its output clock settles; let it run a moment.
    for (let i = 0; i < 60 && audioDev.live() && audioDev.live().ctx.currentTime < 0.5; i++) await sleep(50);
    await sleep(300);
    const st = audioDev.stats();
    check('live: AudioContext running after init()', st && st.state === 'running', st ? st.state : 'no engine');
    check('live: setTheme before init() is remembered (13 wraps to 3)', audioDev.live() && audioDev.live().theme === 3, `engine theme ${audioDev.live()?.theme}${hadEngine ? ' (engine existed before)' : ''}`);
    audio.setTheme(Number($('theme').value));
    if (st && st.state === 'running') {
      const ctx = audioDev.live().ctx, an = ctx.createAnalyser();
      an.fftSize = 2048;
      audioDev.live().out.connect(an);
      const buf = new Float32Array(an.fftSize);
      let peak = 0;
      const poll = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        for (const x of buf) peak = Math.max(peak, Math.abs(x));
      }, 10);
      const measure = async (ms) => { peak = 0; await sleep(ms); return peak; };
      const quiet = [];
      let maxPeak = 0;
      for (const name of names) {
        peak = 0;
        audio.play(name, { pan: Math.random() * 2 - 1, pitch: 0.9 + Math.random() * 0.2 });
        const p = await measure(140);
        maxPeak = Math.max(maxPeak, p);
        if (p < 0.002) quiet.push(name);
      }
      check('live: every one-shot reaches the output', !quiet.length, quiet.length ? `quiet: ${quiet}` : `max peak ${fmtDb(maxPeak)} dBFS`);
      await sleep(1500);
      const hum = (t) => {
        audio.hum('a', { speed: Math.max(0, Math.sin(t * 6)) ** 2, pan: -0.5 });
        audio.hum('b', { speed: Math.max(0, Math.cos(t * 4)) ** 2, pan: 0.5, pitch: 1.1 });
      };
      hooks.add(hum);
      const ph = await measure(1500);
      hooks.delete(hum);
      await sleep(800);
      const after = await measure(300);
      check('live: hums play and time out', ph > 0.01 && after < 0.002 && audioDev.stats().hums === 0, `peak ${fmtDb(ph)}, after ${fmtDb(after)} dBFS, voices ${audioDev.stats().hums}`);
      for (const name of LOOP_NAMES) {
        audio.loop(name, true, { vol: 1 });
        const p = await measure(1200);
        audio.loop(name, false);
        await sleep(700);
        check(`live: loop ${name}`, p > 0.005, `peak ${fmtDb(p)} dBFS`);
      }
      const tracksBefore = audioDev.stats().tracks;
      for (const track of TRACK_NAMES) {
        const tick = (t) => {
          audio.music(track, 0.5 + 0.5 * Math.sin(t));
          audio.setSlowmo(Math.max(0, Math.sin(t * 2)) * 0.8);
        };
        hooks.add(tick);
        const p = await measure(2500);
        hooks.delete(tick);
        check(`live: music ${track} (called every frame)`, p > 0.005, `peak ${fmtDb(p)} dBFS`);
      }
      check('live: per-frame music() calls start each track once', audioDev.stats().tracks - tracksBefore === TRACK_NAMES.length, `tracks started ${audioDev.stats().tracks - tracksBefore}`);
      audio.setVolumes({ music: 0.5, sfx: 0.8 });
      audio.play('parry');
      audio.music('none');
      audio.setSlowmo(0);
      audio.setVolumes({ master: 1, sfx: 1, music: 1 });
      await sleep(400);
      clearInterval(poll);
      const fin = audioDev.stats();
      check('live: no errors swallowed by the API guard', fin.errors === 0, JSON.stringify(fin));
    }

    const failed = R.checks.filter((c) => !c.ok).length;
    $('summary').innerHTML = failed ? `<span class="bad">${failed} failed</span>` : '<span class="good">all checks passed</span>';
    renderTable(R);
    ui.testing = false;
    R.done = true;
    window.__audioTest = R;
    return R;
  }

  function renderTable(R) {
    const rows = R.sounds.map((s) => `<tr><td>${s.name}</td><td>${fmtDb(s.dryPeak)}</td><td>${fmtDb(s.loud)}</td><td>${s.dryDur.toFixed(2)}</td><td>${fmtDb(s.fullPeak)}</td><td>${s.fullDur.toFixed(2)}</td><td class="${s.ok ? 'good' : 'bad'}">${s.ok ? 'ok' : s.why}</td></tr>`);
    $('results').innerHTML = `<table><tr><th>sound</th><th>dry peak dBFS</th><th>loudest 50 ms dB</th><th>dry length s</th><th>master peak dBFS</th><th>with reverb s</th><th></th></tr>${rows.join('')}</table>`;
  }

  $('run').onclick = () => { $('log').textContent = ''; runChecks(); };
  if (new URLSearchParams(location.search).has('auto')) runChecks().catch((err) => {
    console.error(err);
    window.__audioTest = { done: true, checks: [{ name: 'test harness', ok: false, detail: String(err) }], sounds: [], music: [], themes: [] };
  });
}
