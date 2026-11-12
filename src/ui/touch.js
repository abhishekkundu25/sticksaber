// Touch controls for phones and tablets. Nothing here runs until the first real touch, so keyboard,
// mouse and gamepad play on a desktop is untouched. The controls are plain DOM elements laid over
// the canvas: a floating stick on the left, action buttons on the right. They feed the same Input
// actions the keyboard does.
const BUTTONS = [
  // [action, label, right vh, bottom vh, size vh]
  ['light', 'LIGHT', 20, 6, 21],
  ['heavy', 'HEAVY', 3, 23, 18],
  ['jump', 'JUMP', 43, 5, 17],
  ['dash', 'DASH', 25, 30, 16],
  ['guard', 'GUARD', 5, 44, 16],
  ['special', 'THROW', 45, 25, 13],
  ['overdrive', 'OVER\nDRIVE', 26, 49, 13],
];
const HELD = ['left', 'right', 'down', 'light', 'heavy', 'jump', 'dash', 'guard', 'special', 'overdrive'];

export class Touch {
  // hooks: { tap(x, y) in logical canvas units, cmd(name) for pause / resume / quit / spawn }
  constructor(input, canvas, view, hooks) {
    this.input = input; this.canvas = canvas; this.view = view; this.hooks = hooks;
    this.enabled = false; this.mode = 'off'; this.root = null;
    this.stick = null; // { id, x, y } while a finger is on the left pad
    this.owned = new Map(); // touch identifier -> action it is holding
    addEventListener('touchstart', (e) => { input.lastTouch = performance.now(); if (!this.enabled) this.enable(); this.canvasTap(e); }, { passive: false });
  }

  enable() {
    this.enabled = true;
    const root = this.root = document.createElement('div');
    root.id = 'touch'; root.dataset.mode = this.mode;
    root.innerHTML = '<div class="pad"></div><div class="base"><div class="knob"></div></div>'
      + BUTTONS.map(([a, label, r, b, s]) => `<button class="act" data-a="${a}" style="right:${r}vh;bottom:${b}vh;width:${s}vh;height:${s}vh">${label.replace('\n', '<br>')}</button>`).join('')
      + '<button class="sys pause" data-cmd="pause">II</button><button class="sys spawn" data-cmd="spawn">SPAWN</button>'
      + '<button class="sys resume" data-cmd="resume">RESUME</button><button class="sys quit" data-cmd="quit">QUIT</button>';
    document.body.appendChild(root);
    this.base = root.querySelector('.base'); this.knob = root.querySelector('.knob'); this.od = root.querySelector('[data-a="overdrive"]');
    const opts = { passive: false };
    root.addEventListener('touchstart', (e) => this.onStart(e), opts);
    root.addEventListener('touchmove', (e) => this.onMove(e), opts);
    root.addEventListener('touchend', (e) => this.onEnd(e), opts);
    root.addEventListener('touchcancel', (e) => this.onEnd(e), opts);
  }

  // Menus have no on-screen buttons: a tap on the canvas is passed on in the game's own coordinates.
  canvasTap(e) {
    if (e.target !== this.canvas) return;
    e.preventDefault();
    const t = e.changedTouches[0], r = this.canvas.getBoundingClientRect();
    this.hooks.tap(((t.clientX - r.left) / r.width) * this.view.w, ((t.clientY - r.top) / r.height) * this.view.h);
  }

  setMode(mode) {
    if (!this.enabled || mode === this.mode) return;
    this.mode = mode; this.root.dataset.mode = mode;
    this.releaseAll();
  }
  setReady(on) { if (this.enabled) this.od.classList.toggle('ready', on); }

  releaseAll() {
    for (const a of HELD) this.input.set(a, 'touch', false);
    for (const [id, a] of this.owned) this.input.set(a, 't' + id, false);
    this.owned.clear(); this.stick = null;
    if (this.root) { for (const b of this.root.querySelectorAll('.on')) b.classList.remove('on'); this.base.classList.remove('live'); }
  }

  onStart(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const el = t.target;
      if (el.dataset.cmd) { this.hooks.cmd(el.dataset.cmd); continue; }
      if (el.dataset.a) {
        this.owned.set(t.identifier, el.dataset.a); el.classList.add('on');
        this.input.set(el.dataset.a, 't' + t.identifier, true);
      } else if (el.classList.contains('pad') && !this.stick) {
        // The stick appears wherever the thumb lands.
        this.stick = { id: t.identifier, x: t.clientX, y: t.clientY };
        this.base.style.left = `${t.clientX}px`; this.base.style.top = `${t.clientY}px`; this.base.classList.add('live');
        this.knob.style.transform = 'translate(0px, 0px)';
      }
    }
  }

  onMove(e) {
    e.preventDefault();
    const s = this.stick;
    if (!s) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== s.id) continue;
      const max = innerHeight * 0.11;
      let dx = t.clientX - s.x, dy = t.clientY - s.y;
      const d = Math.hypot(dx, dy);
      if (d > max) { dx *= max / d; dy *= max / d; }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const dead = max * 0.32;
      this.input.set('left', 'touch', dx < -dead);
      this.input.set('right', 'touch', dx > dead);
      // Pulling down is the same modifier as S: launcher on the ground, plunge in the air.
      this.input.set('down', 'touch', dy > max * 0.55);
    }
  }

  onEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const a = this.owned.get(t.identifier);
      if (a) {
        this.owned.delete(t.identifier);
        this.input.set(a, 't' + t.identifier, false);
        this.root.querySelector(`[data-a="${a}"]`)?.classList.remove('on');
      }
      if (this.stick && t.identifier === this.stick.id) {
        this.stick = null;
        for (const d of ['left', 'right', 'down']) this.input.set(d, 'touch', false);
        this.base.classList.remove('live'); this.knob.style.transform = 'translate(0px, 0px)';
      }
    }
  }
}
