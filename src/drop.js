// Drop - the first of the exhibition modes: the cube made in the lab put to use. Taken up into the sky on a hook
// (the camera with it), let go at a touch, and followed down to wherever it lands - a splat, a bounce, as it's made.
// Gravity on it all the way: hung from the hook it dangles and sways; falling fast the air presses on it - at its
// critical speed as hard as its weight - squashing and spreading it (SoftBody.setWind).

const STORE = 'cube-sim-drop-h';
export const DROP_MIN = 3, DROP_MAX = 45; // (m: the height its bottom is taken up to - the sky dome's 48 m round the eye)
const LIFT_V = 12; // (m/s: the hook at its fastest)
const VT = 22; // (m/s: its critical speed - the air on its leading face as hard as its weight)

export class DropMode {
  constructor(app) {
    this.app = app;
    this.on = false;
    this.phase = ''; // '' ready, 'lift', 'hang', 'fall', 'land'
    this.t = 0;
    this.height = 15;
    try {
      const h = +localStorage.getItem(STORE);
      if (h >= DROP_MIN && h <= DROP_MAX) this.height = h;
    } catch (e) {}
    this.slot = 0;
    this.grab = null;
    this.y0 = 0; // (the hook: where it started, and its top)
    this.yTop = 0;
    this.dur = 1;
    this.frameY = null; // (where the camera's to look - see App._updateCamera; null, as it does)
    this.frameX = 0;
    this.frameZ = 0;
    this.speed = 0; // (m/s down, now - and the fastest, and as it hit)
    this.peak = 0;
    this.hitV = 0;
    this.landT = -1;
    this.calmT = 0;
    this.alt = 0; // (its bottom's height, now)
    this.onChange = null; // (the bar: see ui/dropbar.js)
  }

  setHeight(h) {
    this.height = Math.min(DROP_MAX, Math.max(DROP_MIN, Math.round(h)));
    try {
      localStorage.setItem(STORE, String(this.height));
    } catch (e) {}
  }

  enter() {
    if (this.on) return;
    this.on = true;
    this.phase = '';
    this.app.tool?.up?.();
    this.app.sb.endGrab();
    this._changed();
  }

  exit() {
    if (!this.on) return;
    this._release();
    this.app.sb.setWind(this.slot, 0);
    this.on = false;
    this.phase = '';
    this.frameY = null;
    this.app._arena(); // (its ceiling back as the room has it)
    this._changed();
  }

  // (its biggest piece, and that piece's number)
  _piece() {
    const sb = this.app.sb;
    let best = null, bi = -1;
    sb.pieces.forEach((pc, i) => {
      if (pc && pc.cube === this.slot && (!best || pc.verts.length > best.verts.length)) (best = pc), (bi = i);
    });
    return best ? { pc: best, i: bi } : null;
  }

  // Up: hooked by the middle of its top, and taken up till its bottom's at the height
  start() {
    if (!this.on || (this.phase && this.phase !== 'land')) return;
    const app = this.app, sb = app.sb;
    this.slot = app.cube?.slot ?? 0;
    sb.setWind(this.slot, 0);
    const P = this._piece();
    if (!P) return;
    const { pc, i } = P, size = sb.cSize[this.slot], top = pc.bbox[4], bot = pc.bbox[1];
    // (out of the room's reach above: its ceiling over the hook - see SoftBody._solveBounds)
    sb.p.ceiling = Math.max(sb.p.ceiling, this.height + 3 * size + 2);
    this.grab = sb.startGrab({ point: [pc.com[0], top, pc.com[2]], piece: i }, pc.com[0], top, pc.com[2], 0.3 * size);
    if (!this.grab) return;
    // (a hook, not a hand: as fast as it's taken up - see SoftBody._solveGrab)
    this.grab.boost = 3;
    this.y0 = top;
    this.yTop = this.height + (top - bot);
    this.dur = Math.max(1.2, (1.5 * (this.yTop - this.y0)) / LIFT_V);
    this.phase = 'lift';
    this.t = 0;
    this.landT = -1;
    this.peak = this.hitV = 0;
    sb.wakeAll();
    this._changed();
  }

  // Let go: it falls - and the air's on it
  letGo() {
    if (this.phase !== 'lift' && this.phase !== 'hang') return;
    this._release();
    this.app.sb.setWind(this.slot, VT);
    this.app.sb.wakeAll();
    this.phase = 'fall';
    this.t = 0;
    this._changed();
  }

  _release() {
    if (this.grab) this.app.sb.endGrab(this.grab);
    this.grab = null;
  }

  update(dt) {
    if (!this.on || !this.phase) return;
    this.t += dt;
    const sb = this.app.sb, P = this._piece();
    // (re-cubed, swapped, gone from under it: back to the start)
    if (!P || (this.grab && !sb.grabs.includes(this.grab))) {
      this._release();
      sb.setWind(this.slot, 0);
      this.phase = '';
      this.frameY = null;
      this._changed();
      return;
    }
    const pc = P.pc;
    this.alt = Math.max(0, pc.bbox[1]);
    this.speed = Math.max(0, -pc.vel[1]);
    if (this.phase === 'lift') {
      const u = Math.min(1, this.t / this.dur), e = u * u * (3 - 2 * u);
      this.grab.ty = this.y0 + (this.yTop - this.y0) * e;
      if (u >= 1) {
        this.phase = 'hang';
        this._changed();
      }
    }
    if (this.phase === 'fall') {
      this.peak = Math.max(this.peak, this.speed);
      // (down: as it first touches - then still a while, or 3 s on)
      if (this.landT < 0 && pc.bbox[1] < 0.03) (this.landT = this.t), (this.hitV = this.peak);
      if (this.landT >= 0) {
        const v2 = pc.vel[0] * pc.vel[0] + pc.vel[1] * pc.vel[1] + pc.vel[2] * pc.vel[2];
        this.calmT = v2 < 0.16 ? this.calmT + dt : 0;
        if (this.calmT > 0.6 || this.t - this.landT > 3) {
          sb.setWind(this.slot, 0);
          this.phase = 'land';
          this.t = 0;
          this._changed();
        }
      }
    }
    this.track();
  }

  // (the camera on it - where it is now, the frame's step taken: read before it, a cube falling at 16 m/s sat half a
  // metre low in the picture - till a moment after it's down. See App._updateCamera)
  track() {
    if (!this.on || !this.phase || (this.phase === 'land' && this.t > 0.8)) {
      this.frameY = null;
      return;
    }
    const pc = this._piece()?.pc;
    if (!pc) return;
    this.frameY = pc.com[1];
    this.frameX = pc.com[0];
    this.frameZ = pc.com[2];
  }

  _changed() {
    this.onChange?.(this.phase);
  }
}
