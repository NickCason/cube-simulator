// A sheet: the UI's one way of showing more - up from the bottom over the room, springing (see motion.js), the dock
// sinking away under it; a handle on top. Dragged down (or flicked), the room behind it tapped, or Escape: it goes.
// One open at a time - another opened, this one makes way. Closed, it's inert: not tabbed into, not read out.

let current = null, scrim = null;

export class Sheet {
  // cls: its own class; title, sub: its head; onOpen, onClose: as it does
  constructor(root, { cls = '', title = '', sub = '', onOpen = null, onClose = null } = {}) {
    if (!scrim) {
      scrim = document.createElement('div');
      scrim.className = 'sheet-scrim';
      root.appendChild(scrim);
      scrim.addEventListener('click', () => current?.close());
      window.addEventListener('keydown', (e) => e.key === 'Escape' && current?.close());
    }
    this._from = null; // (what had the focus as it opened)
    const el = (this.el = document.createElement('section'));
    el.className = `sheet ${cls}`;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', title);
    el.inert = true;
    el.innerHTML = `<div class="sh-grab" aria-hidden="true"><i></i></div><div class="sh-head"><h2></h2><span class="sh-sub"></span></div><div class="sh-body"></div>`;
    el.querySelector('h2').textContent = title;
    this.subEl = el.querySelector('.sh-sub');
    this.subEl.textContent = sub;
    this.body = el.querySelector('.sh-body');
    this.onOpen = onOpen;
    this.onClose = onClose;
    root.appendChild(el);
    this._drag();
  }

  static get current() {
    return current;
  }

  get isOpen() {
    return current === this;
  }

  open() {
    if (current === this) return;
    const swap = !!current;
    this._from = swap ? current._from : document.activeElement;
    current?.close(true);
    current = this;
    this.onOpen?.();
    this.el.inert = false;
    this.el.classList.add('open');
    scrim.classList.add('on');
    document.documentElement.classList.add('sheeted');
    if (!swap) requestAnimationFrame(() => this.el.querySelector('button:not([disabled])')?.focus({ preventScroll: true }));
  }

  // (swap: another's opening in its place - the room stays dimmed)
  close(swap = false) {
    if (current !== this) return;
    current = null;
    this.el.classList.remove('open');
    this.el.inert = true;
    if (!swap) {
      scrim.classList.remove('on');
      document.documentElement.classList.remove('sheeted');
      // (the keyboard's focus back on what opened it - it was left on nothing)
      const f = this._from;
      this._from = null;
      if (f?.isConnected && (this.el.contains(document.activeElement) || document.activeElement === document.body)) f.focus?.({ preventScroll: true });
    }
    this.onClose?.();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  // (dragged by its handle or head: followed down - up, only a little, stretched - let go far enough or fast, closed)
  _drag() {
    const el = this.el;
    let y0 = null, dy = 0, t0 = 0, id = -1;
    const start = (e) => {
      if (!this.isOpen) return;
      y0 = e.clientY;
      dy = 0;
      t0 = performance.now();
      id = e.pointerId;
      el.classList.add('drag');
      e.currentTarget.setPointerCapture?.(id);
    };
    const move = (e) => {
      if (y0 === null || e.pointerId !== id) return;
      dy = e.clientY - y0;
      el.style.transform = `translateY(${dy < 0 ? -Math.sqrt(-dy) * 2 : dy}px)`;
    };
    const end = (e) => {
      if (y0 === null || e.pointerId !== id) return;
      const v = dy / Math.max(1, performance.now() - t0);
      y0 = null;
      el.classList.remove('drag');
      el.style.transform = '';
      if (dy > 110 || (dy > 24 && v > 0.55)) this.close();
    };
    for (const h of el.querySelectorAll('.sh-grab, .sh-head')) {
      h.addEventListener('pointerdown', start);
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', end);
      h.addEventListener('pointercancel', end);
    }
  }
}

// A panel made a sheet on a phone (the Cubimizer, Settings, the Cubby, the stack, Places, Play: their own markup,
// shown and hidden by `hidden`, closed their own ways): a handle on top - dragged down or flicked, it's closed;
// dragged up, taller - most of the screen; tapped, the one height or the other. Hidden again: its first height
export function asSheet(el, close) {
  if (!el || el.querySelector(':scope > .pal-grab')) return;
  const grab = document.createElement('div');
  grab.className = 'pal-grab';
  grab.setAttribute('aria-hidden', 'true');
  grab.innerHTML = '<i></i>';
  el.prepend(grab);
  new MutationObserver(() => el.hidden && el.classList.remove('tall')).observe(el, { attributes: true, attributeFilter: ['hidden'] });
  let y0 = null, dy = 0, t0 = 0, id = -1;
  grab.addEventListener('pointerdown', (e) => {
    y0 = e.clientY;
    dy = 0;
    t0 = performance.now();
    id = e.pointerId;
    grab.setPointerCapture?.(id);
    el.classList.add('drag');
  });
  grab.addEventListener('pointermove', (e) => {
    if (y0 === null || e.pointerId !== id) return;
    dy = e.clientY - y0;
    el.style.translate = `0 ${dy > 0 ? dy : -Math.sqrt(-dy) * 2}px`;
  });
  const end = (e) => {
    if (y0 === null || e.pointerId !== id) return;
    const v = dy / Math.max(1, performance.now() - t0);
    y0 = null;
    el.classList.remove('drag');
    el.style.translate = '';
    if (dy > 90 || (dy > 20 && v > 0.5)) close();
    else if (dy < -30 || (dy < -10 && v < -0.4)) el.classList.add('tall');
    else if (Math.abs(dy) < 6) el.classList.toggle('tall');
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
}
