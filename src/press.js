// Press - an exhibition mode: the cube under a hydraulic press. Its plate comes down at its speed till it's as far
// off the floor as asked (a share of the cube's side), pushing what's under it down to it and gripping it as the
// floor does (SoftBody.press - see _solveBounds): jelly squashed flat, spreading out under it and bulging out round
// its edges; brittle things - glass, candy, ice, sugar, frozen jelly - cracking under it, then crushed smaller as it
// keeps coming (see world/shatter.js). Its gauge reads how hard it's pushing, in tonnes; past STALL times the cube's
// weight it can't - stalled, held there. Then back up.

import * as THREE from 'three';
import { makePress } from './world/models.js';
import { cutBody, planeField } from './sim/cutting.js';
import { ragged } from './tools/basic.js';

const STORE = 'cube-sim-press';
export const PRESS_SPEED = [0.05, 0.8]; // (m/s: the plate coming down, slowest and fastest)
export const PRESS_DEPTH = [0.04, 0.6]; // (the gap it comes down to: a share of the cube's side)
const UP_V = 1.2; // (m/s: going back up)
const STALL = 80; // (its push, x the weight of what's under it: past this it can't - stalled)
const CRUSH = 4; // (its push, x that weight: a brittle thing under it this hard cracks - and again as it keeps coming)
// (its plate's grip on what it presses, x the floor's: slick steel - gripped as the floor grips, a jelly cube went
// down to a 4 cm pad the plate's size and no further, squeezed thin in place; let slide, it spreads out from under it)
const PLATE_GRIP = +(globalThis.__plateGrip ?? 0.1);
// (squashed under it to less than this of its own volume - as far as the jelly holds, pressed: past it, its tets
// were crushed through themselves, a cube flattened to a tenth of its height keeping a twentieth of its volume - it
// bursts: split in wedges from its middle and squirted out from under the plate. Not again for BURST_GAP s)
const BURST_AT = 0.85, BURST_GAP = 0.45;

export class PressMode {
  constructor(app) {
    this.app = app;
    this.on = false;
    this.phase = ''; // '' ready, 'down', 'hold', 'up'
    this.t = 0;
    this.speed = 0.25;
    this.depth = 0.12;
    try {
      const o = JSON.parse(localStorage.getItem(STORE) || '{}');
      if (o.speed >= PRESS_SPEED[0] && o.speed <= PRESS_SPEED[1]) this.speed = o.speed;
      if (o.depth >= PRESS_DEPTH[0] && o.depth <= PRESS_DEPTH[1]) this.depth = o.depth;
    } catch (e) {}
    this.slot = 0;
    this.s = 1; // (its cube's side)
    this.cx = 0; // (the plate's middle, over the cube)
    this.cz = 0;
    this.y0 = 1.5; // (the plate's bottom: up, as it starts - and now)
    this.y = 1.5;
    this.top = 2;
    this.turn = 0; // (which way it faces: square on to the view, the nearest way)
    this.model = null;
    this.plate = null;
    this.rod = null;
    this.force = 0; // (N: its push now, the most so far - and the weight of what's under it, for the stall)
    this.peak = 0;
    this.weight = 1;
    this.stalled = false;
    this.squash = 1; // (the gap now over the cube's height: 1 untouched)
    this.frameX = 0; // (where the camera looks - see App._updateCamera)
    this.frameY = null;
    this.frameZ = 0;
    this._goal = null;
    this._fit = { r: 6, rc: 3, y: 1 }; // (the view's distance: all of it, its plate close; and its height)
    this._burstT = -9; // (when it last burst something)
    this.massT = 1; // (t: what it presses weighs, as a cube of its size and stuff would)
    this.onChange = null; // (its bar: see ui/dropbar.js)
  }

  set(o) {
    if (o.speed !== undefined) this.speed = Math.min(PRESS_SPEED[1], Math.max(PRESS_SPEED[0], o.speed));
    if (o.depth !== undefined) this.depth = Math.min(PRESS_DEPTH[1], Math.max(PRESS_DEPTH[0], o.depth));
    try {
      localStorage.setItem(STORE, JSON.stringify({ speed: this.speed, depth: this.depth }));
    } catch (e) {}
  }

  enter() {
    if (this.on) return;
    this.on = true;
    this.phase = '';
    this.app.tool?.up?.();
    this.app.sb.endGrab();
    this._place();
    this._view(true);
    this._changed();
  }

  exit() {
    if (!this.on) return;
    this.app.sb.press = null;
    this.app.audio?.loop('press', false);
    if (this.model) {
      this.app.scene.remove(this.model);
      this.model.traverse((o) => o.geometry?.dispose?.());
    }
    this.model = this.plate = this.rod = null;
    this._view(false);
    this.on = false;
    this.phase = '';
    this.frameY = null;
    this._changed();
  }

  // (the press stood round the cube on show - turned square on to the view, the nearest way - its plate over it)
  _place() {
    const app = this.app, sb = app.sb;
    this.slot = app.cube?.slot ?? 0;
    const s = (this.s = sb.cSize[this.slot] || sb.p.size);
    let pc = null;
    for (const q of sb.pieces) if (q && q.cube === this.slot && (!pc || q.verts.length > pc.verts.length)) pc = q;
    this.cx = pc ? pc.com[0] : 0;
    this.cz = pc ? pc.com[2] : 0;
    const hi = pc ? pc.bbox[4] : s;
    this.y0 = this.y = hi + 0.45 * s;
    this.top = this.y0 + 0.32 * s;
    if (this.model) app.scene.remove(this.model);
    this.model = makePress(app.M, s, this.top);
    this.model.position.set(this.cx, 0, this.cz);
    this.turn = Math.round(app.orbitGoal.theta / (Math.PI / 2)) * (Math.PI / 2);
    this.model.rotation.y = this.turn;
    this.plate = this.model.getObjectByName('plate');
    this.rod = this.model.getObjectByName('rod');
    app.scene.add(this.model);
    // (how far back to see all of it - its height and its width, a phone held upright narrow - and to see its plate's
    // width, close)
    const vf = THREE.MathUtils.degToRad(app._fovBase || app.camera.fov), asp = app.camera.aspect || 1;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * asp), H = this.top + 1.35 * s, W = 2 * (this.model.userData.half + 0.6 * s);
    const r = Math.max((0.6 * H) / Math.tan(vf / 2), (0.55 * W) / Math.tan(hf / 2));
    this._fit = { r: Math.max(4, r), rc: Math.max(2.5 * s, (0.62 * 2 * this.model.userData.half) / Math.tan(hf / 2)), y: 0.45 * H };
    // (what's under it weighs: the whole of its cube, for the stall and the crush)
    let M = 0;
    for (let i = 0; i < sb.nV; i++) if (sb.vCube[i] === this.slot && sb.alive[i]) M += sb.m[i];
    this.weight = Math.max(1e-6, M * Math.abs(sb.p.gravity));
    // (its weight in tonnes, as a cube of its size and stuff would be: a metre of jelly, a tonne - for the gauge)
    this.massT = s * s * s * (sb.cDens?.[this.slot] || 1);
    this._plate();
  }

  // (the plate where it is - in the jelly's world, and drawn)
  _plate() {
    const sb = this.app.sb, h = this.model.userData.half, s = this.s;
    if (!sb.press) sb.press = { y: this.y, x0: 0, x1: 0, z0: 0, z1: 0, grip: PLATE_GRIP, _f: 0, _n: 0 };
    const P = sb.press;
    P.y = this.y;
    P.x0 = this.cx - h; P.x1 = this.cx + h;
    P.z0 = this.cz - h; P.z1 = this.cz + h;
    this.plate.position.y = this.y;
    const foot = this.y + 0.24 * s, len = Math.max(0.01, this.top - foot);
    this.rod.position.y = foot + len / 2;
    this.rod.scale.y = len;
  }

  // Press: down it comes
  start() {
    if (!this.on || (this.phase && this.phase !== 'hold')) return;
    if (this.phase === 'hold') return this.release();
    this._place();
    this.phase = 'down';
    this.t = 0;
    this.peak = 0;
    this.stalled = false;
    this.app.audio?.thud(0.5);
    this.app.audio?.loop('press', true, { type: 'lowpass', freq: 380, q: 0.9, gain: 0.22, lfo: 50, flicker: 0.35 });
    this.app.sb.wakeAll();
    this._changed();
  }

  // ...and back up
  release() {
    if (this.phase !== 'down' && this.phase !== 'hold') return;
    this.phase = 'up';
    this.t = 0;
    this.app.audio?.loop('press', false);
    this.app.audio?.whoosh(0.35);
    this.app.sb.wakeAll();
    this._changed();
  }

  update(dt) {
    if (!this.on || !this.model) return;
    const app = this.app, sb = app.sb, s = this.s, P = sb.press;
    this.t += dt;
    // (its push this frame: the plate's hold on what's under it, over its substeps)
    if (P) {
      this.force = P._n ? P._f / P._n : 0;
      P._f = P._n = 0;
      this.peak = Math.max(this.peak, this.force);
    }
    const low = this.depth * s;
    // (what's under it kept awake while it moves or holds: asleep - a cube at rest is - the plate went straight
    // through it)
    if (this.phase && P) for (let i = 0; i < sb.pieces.length; i++) {
      const pc = sb.pieces[i];
      if (pc && pc.asleep && pc.bbox[4] > this.y - 0.15 * s && pc.bbox[3] > P.x0 && pc.bbox[0] < P.x1 && pc.bbox[5] > P.z0 && pc.bbox[2] < P.z1) sb.wake(i);
    }
    if (this.phase === 'down') {
      if (this.force > STALL * this.weight) {
        this.stalled = true;
        this.phase = 'hold';
        this.t = 0;
        app.audio?.crack(0.3);
        this._changed();
      } else {
        this.y = Math.max(low, this.y - this.speed * dt);
        if (this.y <= low + 1e-4) {
          this.phase = 'hold';
          this.t = 0;
          this._changed();
        }
      }
      app.audio?.loopLevel('press', 0.55 + 0.45 * Math.min(1, this.force / (0.3 * STALL * this.weight)));
    } else if (this.phase === 'up') {
      this.y = Math.min(this.y0, this.y + UP_V * dt);
      if (this.y >= this.y0 - 1e-4) {
        this.phase = '';
        this._changed();
      }
    }
    // (pressing jelly past what it holds: it bursts)
    if ((this.phase === 'down' || this.phase === 'hold') && this.t - this._burstT > BURST_GAP) this._squeezed();
    // (pressing hard on something brittle: it cracks - and cracks again, smaller, as it keeps coming)
    if ((this.phase === 'down' || this.phase === 'hold') && this.force > CRUSH * this.weight && app.shatter) {
      const h = this.model.userData.half;
      sb.pieces.forEach((pc, i) => {
        if (!pc || pc.bbox[4] < this.y - 0.03 * s) return;
        if (pc.com[0] < this.cx - h || pc.com[0] > this.cx + h || pc.com[2] < this.cz - h || pc.com[2] > this.cz + h) return;
        if (!app.shatter.brittleOf(pc)) return;
        app.shatter.blow(i, new THREE.Vector3(pc.com[0], this.y, pc.com[2]), new THREE.Vector3(0, -1, 0), Math.min(3, 1 + this.force / (12 * this.weight)), null, 'blow');
      });
    }
    this._plate();
    // (the gap over the cube's height - for the gauge)
    this.squash = Math.min(1, this.y / Math.max(1e-6, s));
    // (the view: all of it as it starts; coming down, closer and lower - on the gap, the jelly squashed in it)
    const u = Math.min(1, Math.max(0, (this.y0 - this.y) / Math.max(1e-6, this.y0 - 0.5 * s))), e = u * u * (3 - 2 * u);
    this.frameX = this.cx;
    this.frameZ = this.cz;
    this.frameY = this._fit.y + (Math.max(0.06 * s, 0.5 * this.y) - this._fit.y) * e;
    if (this.phase === 'down') {
      const g = app.orbitGoal;
      g.radius = this._fit.r + (this._fit.rc - this._fit.r) * e;
      g.phi = 0.2 + (0.02 - 0.2) * e;
    }
  }

  // (each piece under the plate - not brittle: those crack - squashed how far: its tets' volume now over as made.
  // The worst one past BURST_AT bursts)
  _squeezed() {
    const app = this.app, sb = app.sb, x = sb.x, T = sb.T, s = this.s, P = sb.press;
    let worst = null, wi = -1, wr = BURST_AT;
    sb.pieces.forEach((pc, i) => {
      if (!pc || pc.bbox[4] < this.y - 0.03 * s || pc.bbox[3] < P.x0 || pc.bbox[0] > P.x1 || pc.bbox[5] < P.z0 || pc.bbox[2] > P.z1) return;
      if (pc.volume < 0.08 * s * s * s || app.shatter?.brittleOf(pc)) return;
      let V = 0, V0 = 0;
      for (const t of pc.tets) {
        const o = t * 4, a = T[o] * 3, b = T[o + 1] * 3, c = T[o + 2] * 3, d = T[o + 3] * 3;
        const ax = x[b] - x[a], ay = x[b + 1] - x[a + 1], az = x[b + 2] - x[a + 2], bx = x[c] - x[a], by = x[c + 1] - x[a + 1], bz = x[c + 2] - x[a + 2];
        const cx = x[d] - x[a], cy = x[d + 1] - x[a + 1], cz = x[d + 2] - x[a + 2];
        V += Math.abs(ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
        V0 += sb.vol0[t];
      }
      const r = V0 > 0 ? V / V0 : 1;
      if (r < wr) (wr = r), (worst = pc), (wi = i);
    });
    if (worst) this._burst(worst, wi);
  }

  // A piece pressed past what it holds bursts: split in ragged wedges out from its middle - more, the bigger it is -
  // and squirted out from under the plate, its liquid (a cube full of it) out through the splits
  _burst(pc, i) {
    const app = this.app, sb = app.sb, s = this.s, b = pc.bbox.slice(), m = 0.03;
    const c = new THREE.Vector3(pc.com[0], 0.5 * (b[1] + b[4]), pc.com[2]);
    const inIt = (x, y, z) => x > b[0] - m && x < b[3] + m && y > b[1] - m && y < b[4] + m && z > b[2] - m && z < b[5] + m;
    const n = pc.volume > 0.4 * s * s * s ? 3 : 2, a0 = Math.random() * Math.PI, anchors = app.allAnchors();
    for (let k = 0; k < n; k++) {
      const th = a0 + (k + (Math.random() - 0.5) * 0.5) * (Math.PI / n), nx = Math.cos(th), nz = Math.sin(th);
      const f = ragged(planeField(nx, 0, nz, nx * c.x + nz * c.z + (Math.random() - 0.5) * 0.06 * s, inIt), 0.03 * s);
      f.inRegion = inIt;
      cutBody(sb, f, { separate: 0.01, anchors, pieces: [i], light: k < n - 1 });
    }
    if (sb.topoStale) sb.rebuild();
    app.onTopologyChanged();
    app.markDamaged();
    this._burstT = this.t;
    // (out from under it, along the floor)
    sb.radialImpulse(c.x, c.y, c.z, 2.6 * s, 4.5, 0.4);
    app.hitStop?.(0.06);
    app.shake(0.02);
    app.audio?.splat(0.9);
    app.audio?.thud(0.7);
    const col = app.flavorColorAtRest?.(0, 0, 0, pc.cube) ?? '#ff4fa3';
    for (let k = 0; k < 18; k++) {
      const th = Math.random() * Math.PI * 2, v = new THREE.Vector3(Math.cos(th) * (2 + Math.random() * 3), 0.6 + Math.random() * 1.6, Math.sin(th) * (2 + Math.random() * 3));
      app.droplets?.spawn(c.clone().add(new THREE.Vector3(Math.cos(th) * 0.4 * s, 0, Math.sin(th) * 0.4 * s)), v, 0.01 + Math.random() * 0.016, col);
    }
    app.tally?.('smashed');
  }

  // (tonnes, by the gauge: its push - as so many times its weight - and the most)
  get tonnes() {
    return (this.force / this.weight) * this.massT;
  }

  get peakTonnes() {
    return (this.peak / this.weight) * this.massT;
  }

  // (the view square on to it, back far enough to see all of it, a little above - and as it was, after)
  _view(on) {
    const app = this.app, g = app.orbitGoal;
    if (on && !this._goal) {
      this._goal = { theta: g.theta, phi: g.phi, radius: g.radius };
      g.theta = this.turn;
      g.phi = 0.2;
      g.radius = this._fit.r;
    } else if (!on && this._goal) {
      Object.assign(g, this._goal);
      this._goal = null;
    }
  }

  track() {
    if (!this.on) this.frameY = null;
  }

  _changed() {
    this.onChange?.(this.phase);
  }
}
