// Character select: the cube on show is slurped up out of the picture (pulled
// from the top, so it stretches after itself), the chosen one drops in from
// above and lands the way its material does - rubber bounces, slime splats,
// glass knocks - and its card goes up (see ui/fighter.js).

import * as THREE from 'three';
import { EDGES } from './styles.js';

const EXIT_MAX = 0.62; // s: the old cube's longest way out
const DROP_V = -3; // m/s: the new one comes in already falling
const LAND_HOLD = 0.75; // s: the landing plays out before the swap is over

export class Swapper {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.phase = '';
    this.t = 0;
    this.cube = null;
    this.onLand = null;
    this.landedAt = 0;
    this.slot = 0; // (which cube: with several, only that one goes and comes)
    this.watch = []; // cubes dropped in, waiting to land (see watchLanding)
    this.bounce = -1; // (its own bounce, held back for the landing)
    this._v = new THREE.Vector3();
  }

  // Swap to cube c (a decoded CubeR cube); onLand(c) once it's down.
  start(c, onLand = null) {
    const app = this.app, sb = app.sb;
    this.cube = c;
    this.onLand = onLand;
    if (this.active && this.phase === 'exit') return; // (already on its way out: the new pick drops instead)
    // whatever was going on stops: a heal, a grab, a shape change
    const H = app.healer;
    if (H.active || H.settling) {
      H.active = false;
      H.settling = false;
      H.weldJob = H.fillJob = H.weldField = H.fillField = null;
      H.weldT = undefined;
      app.jelly.frontMat.uniforms.uWeldT.value = 99;
      app.healZoom = 0;
    }
    sb.attract = null;
    sb.fill = null;
    sb.collisionsEnabled = true;
    sb.dampBoost = 1;
    app._edgeMorph = null;
    app.tool?.up?.();
    sb.endGrab();
    for (const f of app.onHealStart) f(); // (puddles drain, strings of goo go, bombs fizzle)
    this.active = true;
    this.phase = 'exit';
    this.t = 0;
    this.slot = app.cube ? app.cube.slot : 0;
    this.multi = app.cubes ? app.cubes.length > 1 : false;
    // (alone, gravity off; with others about, they keep theirs - see update)
    if (!this.multi) sb.gravityScale = 0;
    sb.wakeAll();
    app.audio?.swapOut();
    // a streak of sparkles up where it goes
    const col = this._rgb(), half = sb.p.size / 2;
    for (let k = 0; k < 26; k++) {
      app.particles.add.spawn((Math.random() - 0.5) * half * 1.6, Math.random() * sb.p.size, (Math.random() - 0.5) * half * 1.6, 0, 3 + Math.random() * 5, 0,
        0.3 + Math.random() * 0.4, 0.025, 0.004, [col[0] * 5, col[1] * 5, col[2] * 5, 1], [col[0] * 2, col[1] * 2, col[2] * 2, 0], 0.4, 0);
    }
  }

  // (cut short: a cube put on straight away, e.g. by Undo)
  stop() {
    if (!this.active) return;
    this.active = false;
    this.phase = '';
    this.onLand = null;
    this.app.sb.gravityScale = 1;
    this._unholdBounce();
  }

  // a super ball dropped from out of the picture would bounce right back out
  // of it: the first landing keeps it in view (then it's itself again)
  _unholdBounce() {
    if (this.bounce >= 0) {
      const sb = this.app.sb;
      if (this.multi) sb.cBounce[this.slot] = this.bounce;
      else sb.p.bounce = sb.cBounce[0] = this.bounce;
    }
    this.bounce = -1;
  }

  // the lowest point of cube slot (or of everything: -1)
  _lowest(slot) {
    const sb = this.app.sb;
    let y0 = Infinity;
    for (let i = 0; i < sb.nV; i++) if (sb.alive[i] && (slot < 0 || sb.vCube[i] === slot) && sb.x[i * 3 + 1] < y0) y0 = sb.x[i * 3 + 1];
    return y0;
  }

  // A cube dropped into the room (App.addCube): its landing, when it comes.
  watchLanding(slot) {
    this.watch.push({ slot, t: 0 });
    this.app.audio?.swapIn();
  }

  _watch(dt) {
    for (let k = this.watch.length - 1; k >= 0; k--) {
      const w = this.watch[k];
      w.t += dt;
      if (this._lowest(w.slot) < 0.02 || w.t > 3) {
        this.watch.splice(k, 1);
        this._landFx(w.slot);
      }
    }
  }

  update(dt) {
    if (dt > 0 && this.watch.length) this._watch(dt);
    if (!this.active || dt <= 0) return;
    const app = this.app, sb = app.sb;
    this.t += dt;
    if (this.phase === 'exit') {
      let y0 = Infinity, y1 = -Infinity, cx = 0, cz = 0, n = 0;
      const mine = (i) => !this.multi || sb.vCube[i] === this.slot;
      for (let i = 0; i < sb.nV; i++) {
        if (!sb.alive[i] || !mine(i)) continue;
        const y = sb.x[i * 3 + 1];
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        cx += sb.x[i * 3];
        cz += sb.x[i * 3 + 2];
        n++;
      }
      if (!n) return this._swap();
      cx /= n;
      cz /= n;
      // pulled from the top: the top goes first and the rest stretches after it
      const span = Math.max(0.05, y1 - y0), a = 95 * Math.min(1, this.t / 0.1);
      const g = this.multi ? -sb.p.gravity * dt : 0;
      for (let i = 0; i < sb.nV; i++) {
        if (!sb.alive[i] || sb.w[i] === 0 || !mine(i)) continue;
        const o = i * 3, k = 0.3 + 0.7 * ((sb.x[o + 1] - y0) / span);
        sb.v[o + 1] += a * k * dt + g;
        // (and in toward the middle, a slurp up a straw)
        sb.v[o] -= (sb.x[o] - cx) * 3 * dt;
        sb.v[o + 2] -= (sb.x[o + 2] - cz) * 3 * dt;
      }
      sb.wakeAll();
      // gone once its lowest point is above the top of the picture
      const gone = this._v.set(cx, y0, cz).project(app.camera).y > 1.04;
      if (gone || this.t > EXIT_MAX) {
        this.exitXZ = [cx, cz];
        this._swap();
      }
      return;
    }
    if (this.phase === 'drop') {
      const y0 = this._lowest(this.multi ? this.slot : -1);
      if (y0 < 0.02 || this.t > 2.5) this._land();
      return;
    }
    if (this.phase === 'land' && this.t - this.landedAt > LAND_HOLD) {
      this.active = false;
      this.phase = '';
      this._unholdBounce();
    }
  }

  // Out of sight: the new cube's look and feel, a fresh body high above.
  // (With others in the room only the selected cube goes: the room's size
  // and edges stay as they are, and it comes down where it was.)
  _swap() {
    const app = this.app, sb = app.sb, c = this.cube;
    app.nails.clearAll();
    app.droplets.clear();
    app._wearStyle(c);
    if (this.multi) {
      app.applyStyle();
      this._unholdBounce();
      this.bounce = sb.cBounce[this.slot];
      sb.cBounce[this.slot] = Math.min(this.bounce, 0.42);
      const [x, z] = this.exitXZ || [0, 0];
      sb.removeCube(this.slot);
      sb.addCube(this.slot, x, this._dropHeight(sb.p.size), z, (Math.random() - 0.5) * 0.7);
      sb.rebuild();
      for (let i = 0; i < sb.nV; i++) if (sb.vCube[i] === this.slot) sb.v[i * 3 + 1] = DROP_V;
      sb.weld = null;
      for (const f of app.onHealEnd) f();
      app.onTopologyChanged();
      app.flash = Math.max(app.flash, 0.28);
      this.phase = 'drop';
      this.t = 0;
      app.audio?.swapIn();
      return;
    }
    const size = app.settings.size;
    sb.p.size = size;
    app.style.edges = c.edges;
    sb.p.bevel = EDGES[c.edges].bevel * size;
    app.applyStyle();
    this._unholdBounce();
    this.bounce = sb.p.bounce;
    sb.p.bounce = Math.min(sb.p.bounce, 0.42);
    sb.cBounce[0] = sb.p.bounce;
    sb.loadCube(0, this._dropHeight(size), 0, (Math.random() - 0.5) * 0.7);
    for (let i = 0; i < sb.nV; i++) sb.v[i * 3 + 1] = DROP_V;
    sb.gravityScale = 1;
    sb.weld = null;
    sb.glow.fill(0, 0, sb.nV);
    for (const f of app.onHealEnd) f();
    app.onTopologyChanged();
    app.markHealed();
    app.flash = Math.max(app.flash, 0.28);
    this.phase = 'drop';
    this.t = 0;
    app.audio?.swapIn();
  }

  _land() {
    this.phase = 'land';
    this.landedAt = this.t;
    this._landFx(this.multi ? this.slot : -1);
    this.onLand?.(this.cube);
    this.onLand = null;
  }

  // the thud of a cube landing (slot; -1: the whole body)
  _landFx(slot) {
    const app = this.app, sb = app.sb, half = sb.p.size / 2;
    app.shake(0.04);
    app.hitStop(0.045);
    app.audio?.thud(1.15);
    let cx = 0, cz = 0, n = 0;
    for (let i = 0; i < sb.nV; i++) {
      if (!sb.alive[i] || (slot >= 0 && sb.vCube[i] !== slot)) continue;
      cx += sb.x[i * 3];
      cz += sb.x[i * 3 + 2];
      n++;
    }
    cx /= n || 1;
    cz /= n || 1;
    // a ring of dust kicked out from under it, and a burst in its colour
    const dark = app.theme === 'dark', d = dark ? 0.3 : 0.92;
    for (let k = 0; k < 30; k++) {
      const th = (k / 30) * Math.PI * 2 + Math.random() * 0.2, s = 1.3 + Math.random() * 1.2;
      app.particles.alpha.spawn(cx + Math.cos(th) * half * 1.05, 0.03, cz + Math.sin(th) * half * 1.05, Math.cos(th) * s, 0.2 + Math.random() * 0.35, Math.sin(th) * s,
        0.55 + Math.random() * 0.45, 0.05, 0.22 + Math.random() * 0.14, [d, d * 0.97, d * 0.94, dark ? 0.35 : 0.5], [d, d, d, 0], 3.2, 0.2);
    }
    const col = this._rgb(), top = new THREE.Vector3(cx, sb.p.size * 0.6, cz);
    app.particles.flash(new THREE.Vector3(cx, 0.05, cz), sb.p.size * 1.3, [col[0] * 3, col[1] * 3, col[2] * 3]);
    for (let k = 0; k < 22; k++) app.particles.glitter(top, 1, col, 1.3);
  }

  // the bottom of a cube this size just out of sight above the picture
  _dropHeight(size) {
    const cam = this.app.camera;
    for (let y = 1.2; y < 9; y += 0.2) if (this._v.set(0, y, 0).project(cam).y > 1.08) return y + 0.15;
    return 9;
  }

  _rgb() {
    const n = parseInt((this.app.color || '#ffffff').slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
}
