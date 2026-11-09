// Dice: a cube with the Dice surface (surfaces.js DIE_FACES) says what it
// rolled. Tumbled - thrown, tossed, knocked rolling - then come to rest: the
// face on top, by the cube's own axes as they lie now (frameOf), shown over
// it a moment as a little die. A few rolled together: their total too, and
// the rolls with names (snake eyes, boxcars, five of a kind). One left
// leaning on something, no face up: cocked - roll again. Cut up, it's not a
// die any more: nothing said.

import * as THREE from 'three';
import { DIE_FACES } from './surfaces.js';
import { frameOf } from './tools/cubey.js';

const TUMBLE = 4; // (rad/s) turning this fast at some point: it was rolled (slid along isn't)
const MOVING = 1.4; // (m/s) or going this fast
const REST = 0.3; // (s) still this long: come to rest
const SHOW = 2.6; // (s) its number shown
const PIPS = [[], [[0, 0]], [[-1, -1], [1, 1]], [[-1, -1], [0, 0], [1, 1]], [[-1, -1], [1, -1], [-1, 1], [1, 1]], [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]]];

// a die face's picture: its pips on a rounded square
export const dieFaceSVG = (n) =>
  `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1.5" y="1.5" width="29" height="29" rx="7" fill="#fff"/>${PIPS[n].map(([x, y]) => `<circle cx="${16 + x * 8.2}" cy="${16 - y * 8.2}" r="3.1" fill="#16151a"/>`).join('')}</svg>`;

export class DiceWatch {
  constructor(app) {
    this.app = app;
    this.st = new Map(); // slot: { rolling, maxW, still }
    this.shown = []; // { slot, el, t }
    this.batch = []; // this roll's results so far
    this._v = new THREE.Vector3();
  }

  update(dt) {
    const app = this.app, sb = app.sb;
    let any = false, rolling = false;
    for (const cb of app.cubes) {
      if (cb.style.surface !== 'dice') {
        this.st.delete(cb.slot);
        continue;
      }
      // (one piece of it, or it's been cut)
      let pc = null, n = 0;
      for (const p of sb.pieces) if (p.cube === cb.slot && ++n === 1) pc = p;
      if (n !== 1) {
        this.st.delete(cb.slot);
        continue;
      }
      any = true;
      const s = this.st.get(cb.slot) || { rolling: false, maxW: 0, still: 0 };
      this.st.set(cb.slot, s);
      const v = Math.hypot(pc.vel[0], pc.vel[1], pc.vel[2]), w = Math.hypot(pc.omega[0], pc.omega[1], pc.omega[2]);
      if (!pc.asleep && (v > MOVING || w > TUMBLE)) {
        s.rolling = true;
        s.still = 0;
        s.maxW = Math.max(s.maxW, w);
      } else if (s.rolling) {
        s.still = pc.asleep || (v < 0.06 && w < 0.3) ? s.still + dt : 0;
        if (s.still > REST) {
          s.rolling = false;
          if (s.maxW > TUMBLE) this._rolled(cb, pc);
          s.maxW = 0;
        }
      }
      if (s.rolling) rolling = true;
    }
    // (the roll's over - every die at rest: a few of them, the total)
    if (!rolling && this.batch.length) {
      if (this.batch.length > 1) this._total(this.batch);
      this.batch = [];
    }
    if (any || this.shown.length) this._place(dt);
  }

  _rolled(cb, pc) {
    const app = this.app, sb = app.sb, F = frameOf(sb, pc.verts);
    let a = 0;
    for (let k = 1; k < 3; k++) if (Math.abs(F.ax[k].y) > Math.abs(F.ax[a].y)) a = k;
    const up = F.ax[a].y, n = Math.abs(up) < 0.86 ? 0 : DIE_FACES[a * 2 + (up > 0 ? 0 : 1)];
    if (n) this.batch.push(n);
    this._show(cb.slot, n);
    const at = new THREE.Vector3(pc.com[0], pc.com[1], pc.com[2]);
    app.audio?.clink?.(0.45 + 0.08 * n, at);
    if (n === 6) app.particles?.glitter?.(at.setY(at.y + 0.3), 10, [1, 0.92, 0.55], 1.1);
  }

  _show(slot, n) {
    // (one over each die: a newer one takes the old one's place)
    for (const s of this.shown) if (s.slot === slot) s.t = Math.max(s.t, SHOW - 0.2);
    const el = document.createElement('div');
    el.className = 'die-roll' + (n ? '' : ' cocked');
    el.innerHTML = `<div class="die-in">${n ? `${dieFaceSVG(n)}<b>${n}</b>` : '<b>Cocked!</b><span>roll again</span>'}</div>`;
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
    this.shown.push({ slot, el, t: 0 });
  }

  _total(rolls) {
    const app = this.app, sum = rolls.reduce((a, b) => a + b, 0), same = rolls.every((r) => r === rolls[0]);
    const name =
      rolls.length >= 5 && same ? 'Five of a kind!' : rolls.length === 2 && sum === 2 ? 'Snake eyes!' : rolls.length === 2 && sum === 12 ? 'Boxcars!' : same ? (rolls.length === 3 ? 'Three of a kind!' : rolls.length === 4 ? 'Four of a kind!' : 'Doubles!') : '';
    app.ui?.hint(`${name ? name + ' · ' : ''}${rolls.join(' + ')} = ${sum}`, 3200);
    if (name) app.audio?.fanfare?.(rolls.length >= 5 && same ? 3 : same && rolls.length > 2 ? 2 : 1);
  }

  // each one shown over its die (as it is now), a while, then gone
  _place(dt) {
    const app = this.app, sb = app.sb, cam = app.camera, cv = app.renderer.domElement, r = cv.getBoundingClientRect();
    this.shown = this.shown.filter((s) => {
      s.t += dt;
      const pc = sb.pieces.find((p) => p.cube === s.slot);
      if (s.t > SHOW || !pc) {
        s.el.remove();
        return false;
      }
      // (just above it as it looks from here - its box's corners on the screen
      // - so seen from straight above it doesn't hide the face it's telling)
      const B = pc.bbox;
      let top = Infinity, x0 = Infinity, x1 = -Infinity;
      for (let c = 0; c < 8; c++) {
        const v = this._v.set(B[c & 1 ? 3 : 0], B[c & 2 ? 4 : 1], B[c & 4 ? 5 : 2]).project(cam);
        top = Math.min(top, (1 - v.y) / 2);
        x0 = Math.min(x0, v.x);
        x1 = Math.max(x1, v.x);
      }
      s.el.style.transform = `translate(${r.left + ((x0 + x1) / 2 + 1) / 2 * r.width}px, ${r.top + top * r.height - 6}px) translate(-50%, -100%)`;
      s.el.style.opacity = String(Math.min(1, (SHOW - s.t) / 0.35));
      return true;
    });
  }

  clear() {
    for (const s of this.shown) s.el.remove();
    this.shown = [];
    this.batch = [];
    this.st.clear();
  }
}
