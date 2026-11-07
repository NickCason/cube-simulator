// The gradient editor, for a layered flavour: its shape, and a strip of it
// - one round of it, unbiased, blended as the Blend slider has it - with its
// stops on it. Drag a stop along to move it (past another, they swap); off
// the strip, up or down, to take it away; tap it for its colour. Tap the
// strip for a stop more there (and pick its colour).

import { GRAD_SHAPES, gradientCSS, gradStops, MIN_LAYERS, MAX_LAYERS } from '../styles.js';

const svg = (inner) => `<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">${inner}</svg>`;
// (each shape as it looks cut through the middle)
const SHAPE_ICONS = {
  up: svg('<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M3 7.7h14M3 12.3h14"/>'),
  across: svg('<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M7.7 3v14M12.3 3v14"/>'),
  corner: svg('<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M3 10 10 3M3 17 17 3M10 17l7-7"/>'),
  core: svg('<rect x="3" y="3" width="14" height="14" rx="2"/><circle cx="10" cy="10" r="4.2"/><circle cx="10" cy="10" r="1.3" fill="currentColor" stroke="none"/>'),
  shell: svg('<rect x="3" y="3" width="14" height="14" rx="2"/><rect x="6.5" y="6.5" width="7" height="7" rx="1"/><rect x="9" y="9" width="2" height="2" fill="currentColor" stroke="none"/>'),
  rings: svg('<ellipse cx="10" cy="5.5" rx="6.5" ry="2.5"/><ellipse cx="10" cy="5.5" rx="3.3" ry="1.2"/><path d="M3.5 5.5v9c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-9"/>'),
};
const OFF = 34; // (px off the strip a stop must be dragged to come away)

export class GradEditor {
  constructor(app, sec) {
    this.app = app;
    this.sec = sec;
    this.shapeEl = sec.querySelector('.gshape');
    this.el = sec.querySelector('.grad');
    this.strip = this.el.querySelector('.grad-strip');
    this.stopsEl = this.el.querySelector('.grad-stops');
    this.endA = sec.querySelector('.grad-ends .a');
    this.endB = sec.querySelector('.grad-ends .b');
    this.evenBtn = sec.querySelector('.grad-ends .even');
    for (const g of GRAD_SHAPES) {
      const b = document.createElement('button');
      b.className = 'opt';
      b.dataset.shape = g.id;
      b.title = g.name;
      b.innerHTML = `${SHAPE_ICONS[g.id]}<span>${g.name}</span>`;
      b.addEventListener('click', () => {
        app.audio.ui();
        app.setLayerShape(g.id);
      });
      this.shapeEl.appendChild(b);
    }
    this.evenBtn.addEventListener('click', () => {
      app.audio.ui();
      app.setLayerStops(null);
    });
    this.drag = null;
    this._tap = -1; // (a stop just tapped, or just added with a tap: its colour, on the click that follows)
    this.el.addEventListener('pointerdown', (e) => this._down(e));
    this.el.addEventListener('pointermove', (e) => this._move(e));
    this.el.addEventListener('pointerup', (e) => this._up(e));
    this.el.addEventListener('pointercancel', () => this._cancel());
    this.el.addEventListener('click', (e) => {
      // (the colour picker opens on the click a tap makes - it needs one)
      const i = this._tap;
      this._tap = -1;
      if (i < 0) return;
      e.preventDefault();
      this._pick(i);
    });
  }

  // where a pointer is along the strip, 0..1
  _at(e) {
    const r = this.strip.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)));
  }

  _down(e) {
    if (e.button > 0 || this.drag) return;
    const h = e.target.closest('.gstop');
    let i;
    if (h) i = +h.dataset.i;
    else {
      // (on the strip: a stop more, right there)
      i = this.app.addLayerStop(this._at(e));
      if (i < 0) {
        this.app.ui?.hint(`That's as many colours as there can be: ${MAX_LAYERS}`, 1600);
        return;
      }
      this.app.audio.ui();
    }
    e.preventDefault();
    this.el.setPointerCapture?.(e.pointerId);
    this.drag = { id: e.pointerId, i, x0: e.clientX, y0: e.clientY, moved: false, added: !h, off: false };
    this._mark();
  }

  _move(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
    d.moved = true;
    const r = this.strip.getBoundingClientRect();
    const off = Math.abs(e.clientY - (r.top + r.height / 2)) > OFF + r.height / 2;
    d.off = off && this.app.style.layers.colors.length > MIN_LAYERS;
    d.i = this.app.moveLayerStop(d.i, this._at(e));
    this._mark();
  }

  _up(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    if (d.off) {
      this.app.removeLayerStop(d.i);
      this.app.audio.ui();
    } else if (!d.moved) this._tap = d.i;
    this._mark();
  }

  _cancel() {
    this.drag = null;
    this._mark();
  }

  // a stop's colour picker
  _pick(i) {
    const input = this.stopsEl.children[i]?.querySelector('input');
    if (!input) return;
    try {
      if (input.showPicker) input.showPicker();
      else input.click();
    } catch (err) {
      input.click();
    }
  }

  // (the stop being dragged, and whether it's coming away)
  _mark() {
    const d = this.drag;
    [...this.stopsEl.children].forEach((h, k) => {
      h.classList.toggle('held', !!d && d.i === k);
      h.classList.toggle('off', !!d && d.i === k && d.off);
    });
  }

  render(L) {
    const n = L.colors.length, shape = L.shape || 'up';
    for (const b of this.shapeEl.children) b.classList.toggle('active', b.dataset.shape === shape);
    const g = GRAD_SHAPES.find((s) => s.id === shape) || GRAD_SHAPES[0];
    this.endA.textContent = g.ends[0];
    this.endB.textContent = g.ends[1];
    this.evenBtn.hidden = !L.stops;
    this.strip.style.background = gradientCSS({ layers: L.colors, blur: L.blur, stops: L.stops, repeat: 1, bias: 0 }, 90);
    if (this.stopsEl.children.length !== n) {
      this.stopsEl.textContent = '';
      for (let k = 0; k < n; k++) {
        const h = document.createElement('span');
        h.className = 'gstop';
        h.innerHTML = '<i></i><input type="color" tabindex="-1" aria-hidden="true">';
        const input = h.querySelector('input');
        input.addEventListener('input', () => this.app.setLayerColor(+h.dataset.i, input.value));
        // (keys: along with the arrows, away with Delete, its colour with Enter)
        h.tabIndex = 0;
        h.setAttribute('role', 'slider');
        h.addEventListener('keydown', (e) => {
          const i = +h.dataset.i, s = gradStops({ layers: this.app.style.layers.colors, stops: this.app.style.layers.stops });
          const step = e.shiftKey ? 0.1 : 0.01;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') this._keyMove(i, s[i] - step);
          else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') this._keyMove(i, s[i] + step);
          else if (e.key === 'Delete' || e.key === 'Backspace') this.app.removeLayerStop(i);
          else if (e.key === 'Enter' || e.key === ' ') this._pick(i);
          else return;
          e.preventDefault();
        });
        this.stopsEl.appendChild(h);
      }
    }
    const s = gradStops({ layers: L.colors, stops: L.stops });
    for (let k = 0; k < n; k++) {
      const h = this.stopsEl.children[k], c = L.colors[k];
      h.dataset.i = k;
      h.style.left = `${(s[k] * 100).toFixed(2)}%`;
      h.querySelector('i').style.background = c;
      const input = h.querySelector('input');
      if (input.value.toLowerCase() !== c.toLowerCase()) input.value = c;
      h.setAttribute('aria-label', `Colour ${k + 1} of ${n}`);
      h.setAttribute('aria-valuenow', Math.round(s[k] * 100));
      h.setAttribute('aria-valuemin', 0);
      h.setAttribute('aria-valuemax', 100);
    }
    this._mark();
  }

  // (a stop moved by the keys: the focus goes with it)
  _keyMove(i, p) {
    const j = this.app.moveLayerStop(i, p);
    this.stopsEl.children[j]?.focus();
  }
}
