// Keyboard, mouse and gamepad mapped to abstract actions. Presses are timestamped rather than
// edge-flagged so the sim can buffer them: `consume('light', 0.15)` succeeds if the press happened
// within the last 150 ms and has not been used yet.

const KEYMAP = {
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  Space: 'jump',
  KeyJ: 'light', KeyZ: 'light', KeyK: 'heavy', KeyX: 'heavy',
  KeyL: 'guard', KeyC: 'guard',
  ShiftLeft: 'dash', ShiftRight: 'dash', KeyV: 'dash', Semicolon: 'dash',
  KeyI: 'special', KeyE: 'special', KeyQ: 'special',
  KeyO: 'overdrive', KeyR: 'overdrive',
  Escape: 'pause', KeyP: 'pause', Enter: 'confirm',
};
// Standard-mapping gamepad buttons.
const PADMAP = { 0: 'jump', 2: 'light', 3: 'heavy', 1: 'dash', 5: 'guard', 7: 'guard', 4: 'special', 6: 'special', 10: 'overdrive', 11: 'overdrive', 9: 'pause', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'light', 'heavy', 'guard', 'dash', 'special', 'overdrive', 'pause', 'confirm'];

export class Input {
  constructor() {
    this.now = 0;
    this.down = {}; this.pressedAt = {}; this.releasedAt = {};
    this.src = {}; // per-action set of physical sources currently holding it
    for (const a of ACTIONS) { this.down[a] = false; this.pressedAt[a] = -9; this.releasedAt[a] = -9; this.src[a] = new Set(); }
    this.keysHit = []; // raw key codes pressed this frame (menus, training-room spawns)
    this.padX = 0;
    this.usedPad = false;
  }

  attach(target) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) { if (KEYMAP[e.code]) e.preventDefault(); return; }
      this.keysHit.push(e.code);
      const a = KEYMAP[e.code];
      if (a) { e.preventDefault(); this.set(a, 'k' + e.code, true); }
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.set('jump', 'k' + e.code, true);
      if (e.code === 'Space') this.set('confirm', 'kSpace', true);
      this.usedPad = false;
    });
    target.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.set(a, 'k' + e.code, false);
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.set('jump', 'k' + e.code, false);
      if (e.code === 'Space') this.set('confirm', 'kSpace', false);
    });
    target.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.set('light', 'm0', true);
      if (e.button === 2) this.set('heavy', 'm2', true);
    });
    target.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.set('light', 'm0', false);
      if (e.button === 2) this.set('heavy', 'm2', false);
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('blur', () => { for (const a of ACTIONS) { this.src[a].clear(); this.down[a] = false; } });
  }

  set(action, source, on) {
    const s = this.src[action];
    if (on) {
      if (!s.has(source)) { s.add(source); this.pressedAt[action] = this.now; }
    } else if (s.delete(source) && s.size === 0) this.releasedAt[action] = this.now;
    this.down[action] = s.size > 0;
  }

  // Call once per rendered frame, before stepping the sim.
  poll(realDt) {
    this.now += realDt;
    this.padX = 0;
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      for (const b in PADMAP) {
        const on = !!pad.buttons[b]?.pressed;
        if (on) this.usedPad = true;
        this.set(PADMAP[b], 'p' + pad.index + b, on);
      }
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      if (Math.abs(ax) > 0.35) { this.padX = ax; this.usedPad = true; }
      this.set('down', 'pa' + pad.index, ay > 0.6);
      this.set('up', 'pau' + pad.index, ay < -0.6);
      break;
    }
  }

  endFrame() { this.keysHit.length = 0; }

  held(a) { return this.down[a]; }
  axisX() {
    if (Math.abs(this.padX) > 0.35) return this.padX > 0 ? 1 : -1;
    return (this.down.right ? 1 : 0) - (this.down.left ? 1 : 0);
  }
  consume(a, window = 0.14) {
    if (this.now - this.pressedAt[a] <= window) { this.pressedAt[a] = -9; return true; }
    return false;
  }
  peek(a, window = 0.14) { return this.now - this.pressedAt[a] <= window; }
  sincePress(a) { return this.now - this.pressedAt[a]; }
}
