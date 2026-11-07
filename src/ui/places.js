// Places: the picker - a card a place, each a little picture of it (its sky
// over its floor, in the look you're in), the one you're in ringed.

import { PLACES } from '../places.js';

const svg = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const PLACE_ICON = svg('<path d="M3 19.5h18"/><path d="m3.5 19.5 5.6-8.2 3.6 5 2.4-3.1 4.9 6.3"/><circle cx="16.5" cy="6.5" r="2.4"/>');

// a linear colour as CSS (sRGB)
const enc = (v) => {
  const x = Math.max(0, Math.min(1, v));
  return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
};
const css = (c, a = 1) => `rgba(${enc(c[0])}, ${enc(c[1])}, ${enc(c[2])}, ${a})`;

// the studio's own, as it looks
const STUDIO = {
  light: { sky: { zen: [0.55, 0.55, 0.56], hor: [0.86, 0.85, 0.83] }, floor: { pat: 0, A: [0.8, 0.79, 0.77], B: [0.8, 0.79, 0.77] } },
  dark: { sky: { zen: [0.004, 0.004, 0.007], hor: [0.03, 0.03, 0.045] }, floor: { pat: 0, A: [0.03, 0.03, 0.035], B: [0.03, 0.03, 0.035] } },
};

// a little picture of a place: its sky (a sun or moon in it), its floor
function preview(V) {
  const S = V.sky, F = V.floor || { pat: 0, A: S.hor, B: S.hor };
  const A = css(F.A), B = css(F.B);
  const floors = {
    0: `linear-gradient(${B}, ${B})`,
    1: `repeating-conic-gradient(${A} 0 25%, ${B} 0 50%) 0 0 / 14px 14px`,
    2: `linear-gradient(90deg, ${css(F.A, 0.55)} 50%, transparent 0) 0 0 / 9px 9px, linear-gradient(${css(F.A, 0.55)} 50%, transparent 0) 0 0 / 9px 9px, ${B}`,
    3: `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 40' preserveAspectRatio='none'><g fill='none' stroke='${A}' stroke-linecap='round'><path d='M-2 31C10 27 14 35 24 25S40 19 62 9' stroke-width='1.7'/><path d='M6 42C18 33 29 37 36 28S50 31 62 23' stroke-width='0.9' opacity='0.65'/><path d='M24 25C28 17 33 15 39 3' stroke-width='0.7' opacity='0.55'/></g></svg>`)}") 0 0 / 100% 100%, ${B}`,
    4: `repeating-linear-gradient(90deg, ${B} 0 1.5px, transparent 1.5px 13px), repeating-linear-gradient(${B} 0 1.5px, transparent 1.5px 10px), ${A}`,
    5: `repeating-linear-gradient(170deg, ${css(F.B, 0.6)} 0 3px, transparent 3px 8px), ${A}`,
    6: `radial-gradient(circle at 28% 45%, rgba(0,0,0,0.3) 0 5px, transparent 6px), radial-gradient(circle at 70% 70%, rgba(0,0,0,0.25) 0 7px, transparent 8px), radial-gradient(circle at 55% 25%, rgba(0,0,0,0.2) 0 3px, transparent 4px), ${B}`,
  };
  let sun = '';
  if (S.sun) {
    // (where it sits in the picture: low and ahead for a setting sun, else up and off to one side)
    const d = S.sun.dir === 'key' ? [-0.45, 0.8, 0.4] : S.sun.dir;
    const x = 50 + Math.max(-35, Math.min(35, d[0] * 60)), y = Math.max(12, 88 - Math.max(0, d[1]) * 140);
    const r = Math.max(4, Math.min(16, S.sun.size * 70));
    const col = css(S.sun.col.map((v) => v / Math.max(...S.sun.col)));
    sun = S.sun.stripes
      ? `repeating-linear-gradient(transparent 0 ${r * 0.28}px, ${css(S.hor)} ${r * 0.28}px ${r * 0.4}px) ${x - r}% ${y + r * 0.2}% / ${r * 2}px ${r}px no-repeat, radial-gradient(circle at ${x}% ${y}%, ${col} 0 ${r}px, transparent ${r + 1}px), `
      : `radial-gradient(circle at ${x}% ${y}%, ${col} 0 ${r}px, ${css(S.sun.col.map((v) => v / Math.max(...S.sun.col)), 0.25)} ${r + 3}px, transparent ${r * 3}px), `;
  }
  const stars = S.stars ? 'radial-gradient(1px 1px at 20% 30%, #fff, transparent), radial-gradient(1px 1px at 70% 20%, #fff, transparent), radial-gradient(1px 1px at 45% 60%, #fff, transparent), radial-gradient(1px 1px at 85% 55%, #fff, transparent), ' : '';
  const clouds = S.clouds ? `radial-gradient(ellipse 22% 9% at 30% 55%, ${css(S.cloudCol || [1, 1, 1], 0.85)}, transparent), radial-gradient(ellipse 16% 7% at 72% 38%, ${css(S.cloudCol || [1, 1, 1], 0.75)}, transparent), ` : '';
  return {
    sky: `${sun}${clouds}${stars}linear-gradient(${css(S.zen)}, ${css(S.hor)})`,
    floor: floors[F.pat] || floors[0],
  };
}

export class PlacesPanel {
  constructor(ui, app, root) {
    this.ui = ui;
    this.app = app;
    root.insertAdjacentHTML(
      'beforeend',
      `<div class="palette placesp" hidden role="dialog" aria-label="Places">
        <div class="places-head"><b>Places</b><span>Where your cube lives</span></div>
        <div class="places-grid" role="list"></div>
      </div>`,
    );
    this.el = root.querySelector('.palette.placesp');
    this.grid = this.el.querySelector('.places-grid');
    document.addEventListener('pointerdown', (e) => {
      if (this.el.hidden || this.el.contains(e.target) || e.target.closest('.place-btn')) return;
      this.close();
    });
  }

  open() {
    this.ui.closePalette();
    this.ui.closeTune();
    this.ui.cubby?.close();
    this.ui.stack?.close();
    this.el.hidden = false;
    this.ui.placeBtn.classList.add('open');
    this.render();
  }

  close() {
    this.el.hidden = true;
    this.ui.placeBtn?.classList.remove('open');
  }

  toggle() {
    if (this.el.hidden) this.open();
    else this.close();
  }

  render() {
    if (this.el.hidden) return;
    const app = this.app, mode = app.theme === 'dark' ? 'dark' : 'light';
    this.grid.textContent = '';
    for (const P of PLACES) {
      const V = P.id === 'studio' ? STUDIO[mode] : P[mode];
      const pv = preview(V);
      const b = document.createElement('button');
      b.className = 'place-card' + (P.id === app.place ? ' on' : '');
      b.setAttribute('role', 'listitem');
      b.setAttribute('aria-label', `${P.name}${P.id === app.place ? ' (here now)' : ''}`);
      b.innerHTML = `<span class="pv"><span class="pv-sky"></span><span class="pv-floor"></span><span class="pv-cube"></span></span><span class="pname"></span>`;
      b.querySelector('.pv-sky').style.background = pv.sky;
      b.querySelector('.pv-floor').style.background = pv.floor;
      b.querySelector('.pv-cube').style.background = app.color;
      b.querySelector('.pname').textContent = P.name;
      b.addEventListener('click', () => {
        app.audio.ui();
        app.setPlace(P.id);
        this.render();
      });
      this.grid.appendChild(b);
    }
  }
}
