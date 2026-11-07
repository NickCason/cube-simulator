// The stack: the cubes in the room as bars, bottom to top - the order they
// stack in. Drag a bar up or down to move that cube in the stack (the way the
// layers of a flavour stack), tap one to pick it (the panels edit it), x to
// take it out. Add a plain jelly cube, and stack them: a tower of up to four,
// a 2x2 base with the rest on top, eight make one big cube.

import { resolveFlavor, flavorSwatchCSS, TEXTURES, FLAVORS } from '../styles.js';

const svg = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const STACK_ICON = svg('<rect x="7" y="3.6" width="10" height="5.2" rx="1.4"/><rect x="4" y="9.4" width="16" height="5.2" rx="1.4"/><rect x="5.5" y="15.2" width="13" height="5.2" rx="1.4"/>');

// "Cherry jello", "Sunset gummy", or its Cubby name
export function cubeLabel(cb) {
  if (cb.name) return cb.name;
  const st = cb.style, mat = (TEXTURES[st.texture]?.name || st.texture).toLowerCase();
  if (st.flavor === 'layers') return `Layered ${mat}`;
  if (st.flavor.startsWith('#')) return `Custom ${mat}`;
  const f = FLAVORS.find((x) => x.id === st.flavor);
  return `${f ? f.name : 'Jelly'} ${mat}`;
}

export function formationText(n) {
  if (n <= 1) return 'One cube';
  if (n <= 4) return `A tower of ${n}`;
  if (n < 8) return `A 2×2 base, ${n - 4} on top`;
  return 'One big cube, 2×2×2';
}

export class StackPanel {
  constructor(ui, app, root) {
    this.ui = ui;
    this.app = app;
    root.insertAdjacentHTML(
      'beforeend',
      `<div class="palette stackp" hidden role="dialog" aria-label="Stack">
        <div class="stack-head">
          <div><b>Stack</b><span class="stack-form"></span></div>
          <button class="stack-add" aria-label="Add a jelly cube" title="Add a jelly cube">+ Jelly cube</button>
        </div>
        <div class="stack-hint">Top of the stack first · drag to reorder · tap to pick</div>
        <div class="stack-list" role="list"></div>
        <button class="stack-go">${STACK_ICON}<span>Stack them</span></button>
      </div>`,
    );
    this.el = root.querySelector('.palette.stackp');
    this.list = this.el.querySelector('.stack-list');
    this.formEl = this.el.querySelector('.stack-form');
    this.el.querySelector('.stack-add').addEventListener('click', () => {
      app.audio.ui();
      app.addCube();
    });
    this.el.querySelector('.stack-go').addEventListener('click', () => {
      app.audio.ui();
      if (app.stack()) {
        this.ui.hint(formationText(app.cubes.length), 1800);
        if (window.innerWidth <= 720) this.close();
      }
    });
    document.addEventListener('pointerdown', (e) => {
      if (this.el.hidden || this.el.contains(e.target) || e.target.closest('.stack-btn')) return;
      this.close();
    });
  }

  open() {
    this.ui.closePalette();
    this.ui.closeTune();
    this.ui.cubby?.close();
    this.el.hidden = false;
    this.ui.stackBtn.classList.add('open');
    this.render();
  }

  close() {
    this.el.hidden = true;
    this.ui.stackBtn?.classList.remove('open');
  }

  toggle() {
    if (this.el.hidden) this.open();
    else this.close();
  }

  render() {
    if (this.el.hidden) return;
    const app = this.app, order = app.stackOrder;
    this.formEl.textContent = formationText(order.length);
    this.list.textContent = '';
    // (top of the stack at the top of the list)
    for (let i = order.length - 1; i >= 0; i--) {
      const slot = order[i], cb = app.cubes.find((c) => c.slot === slot);
      if (!cb) continue;
      const row = document.createElement('div');
      row.className = cb === app.cube ? 'stack-row on' : 'stack-row';
      row.setAttribute('role', 'listitem');
      row.dataset.slot = slot;
      row.innerHTML = `<span class="grip" aria-hidden="true">⋮⋮</span><span class="bar"></span><span class="lab"><b></b><i></i></span><button class="out" aria-label="Take it out">×</button>`;
      row.querySelector('.bar').style.background = flavorSwatchCSS(resolveFlavor(cb.style));
      row.querySelector('.lab b').textContent = cubeLabel(cb);
      row.querySelector('.lab i').textContent = i === 0 ? 'bottom' : i === order.length - 1 ? 'top' : `level ${i + 1}`;
      const out = row.querySelector('.out');
      out.hidden = app.cubes.length <= 1;
      out.addEventListener('click', (e) => {
        e.stopPropagation();
        app.audio.ui();
        app.removeCube(slot);
      });
      this._drag(row, slot);
      this.list.appendChild(row);
    }
  }

  // tap: pick it; drag: move it up or down the stack
  _drag(row, slot) {
    const app = this.app;
    row.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.out')) return;
      const startY = e.clientY, rows = [...this.list.children], h = row.getBoundingClientRect().height + 6;
      const from = rows.indexOf(row);
      let moved = false, to = from;
      row.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const dy = ev.clientY - startY;
        if (!moved && Math.abs(dy) < 6) return;
        moved = true;
        row.classList.add('lift');
        row.style.transform = `translateY(${dy}px)`;
        to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / h)));
        rows.forEach((r, j) => {
          if (r === row) return;
          const shift = from < to && j > from && j <= to ? -h : from > to && j < from && j >= to ? h : 0;
          r.style.transform = shift ? `translateY(${shift}px)` : '';
        });
      };
      const up = () => {
        row.removeEventListener('pointermove', move);
        row.removeEventListener('pointerup', up);
        row.removeEventListener('pointercancel', up);
        if (!moved) {
          app.audio.ui();
          app.selectCube(slot);
          this.render();
          return;
        }
        // (the list runs top to bottom; the order bottom to top)
        const list = rows.map((r) => +r.dataset.slot);
        list.splice(to, 0, list.splice(from, 1)[0]);
        app.audio.ui();
        app.setStackOrder(list.reverse());
        this.render();
      };
      row.addEventListener('pointermove', move);
      row.addEventListener('pointerup', up);
      row.addEventListener('pointercancel', up);
    });
  }
}
