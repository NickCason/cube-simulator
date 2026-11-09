// Alive: a cube with googly eyes on is a little bit alive. Left be a while,
// now and then it hops round to look at you (its eyes' side turned your
// way), has a shimmy, a stretch, a bounce or two. Hold a weapon over it
// (hovering, with a mouse) and it shivers - keep it there and it hops out of
// the way. Never while it's held, moving, cut up, frozen solid, or coming
// back together. How lively: the Cubicle's Googly eyes > Liveliness (none:
// as still as any jelly).

import * as THREE from 'three';
import { frameOf } from './tools/cubey.js';

// (the tools it's afraid of)
const SCARY = new Set(['knife', 'dicer', 'nailgun', 'holegun', 'autogun', 'mallet', 'torch', 'freeze', 'acid', 'baller', 'cuber', 'bomb', 'syringe']);
const ACTS = [
  ['look', 0.5],
  ['shimmy', 0.22],
  ['stretch', 0.16],
  ['bounce', 0.12],
];

export class Alive {
  constructor(app) {
    this.app = app;
    this.st = new Map(); // slot: { wait, fear, act }
    this.ray = null;
    this.rayT = 0;
    this._under = -1;
    this._at = null;
    this._n = 0;
    this._v = new THREE.Vector3();
  }

  // (where a mouse is over the scene)
  hover(ray) {
    this.ray = ray ? ray.clone() : null;
    this.rayT = performance.now();
  }

  update(dt) {
    const app = this.app, sb = app.sb, lv = app.st?.lively ?? 0.5;
    if (lv <= 0.01 || !app.intro.done || app.healer.active || app.healer.settling || app.swapper.active) return;
    // (a weapon held over one: which, every few frames)
    const armed = SCARY.has(app.tool?.id) && this.ray && performance.now() - this.rayT < 500;
    if (!armed) this._under = -1;
    else if (++this._n % 4 === 0) {
      const h = app.pickJelly(this.ray);
      this._under = h ? sb.pieces[h.piece]?.cube ?? -1 : -1;
      this._at = h ? [h.point[0], h.point[1], h.point[2]] : null;
    }
    for (const cb of app.cubes) {
      if (!cb.style.eyes?.length) {
        this.st.delete(cb.slot);
        continue;
      }
      let pc = null, k = -1, np = 0;
      for (let i = 0; i < sb.pieces.length; i++) if (sb.pieces[i].cube === cb.slot && ++np === 1) (pc = sb.pieces[i]), (k = i);
      if (np !== 1 || this._frozen(pc)) continue;
      let s = this.st.get(cb.slot);
      if (!s) this.st.set(cb.slot, (s = { wait: 3 + Math.random() * 5, fear: 0, act: null }));
      // a weapon over it: it shivers; there a while, off out of the way
      if (this._under === cb.slot) {
        s.fear += dt;
        s.act = null;
        if (s.fear > 0) this._shiver(pc, k, Math.min(1, s.fear * 1.6) * (0.5 + lv));
        if (s.fear > 1.6 / (0.5 + lv)) {
          this._flee(pc, k);
          s.fear = -1.4;
        }
        continue;
      }
      s.fear = s.fear > 0 ? 0 : Math.min(0, s.fear + dt);
      if (s.act) {
        this._act(s, cb, pc, k, dt, lv);
        continue;
      }
      // left be - still, not held - now and then, something
      const still = pc.asleep || Math.hypot(pc.vel[0], pc.vel[1], pc.vel[2]) < 0.05;
      if (!still || (sb.grabs.length && sb._grabbedP?.[k])) {
        s.wait = Math.max(s.wait, 2);
        continue;
      }
      s.wait -= dt * (0.3 + 1.4 * lv);
      if (s.wait > 0) continue;
      s.wait = 4 + Math.random() * 7;
      let r = Math.random(), kind = ACTS[0][0];
      for (const [a, p] of ACTS) if ((r -= p) < 0) {
        kind = a;
        break;
      }
      s.act = { kind, t: 0, n: 0 };
    }
  }

  // (frozen solid: it can't)
  _frozen(pc) {
    const sb = this.app.sb, vs = pc.verts;
    let t = 0, n = 0;
    for (let i = 0; i < vs.length; i += 17) (t += sb.temp[vs[i]]), n++;
    return n && t / n < -0.35;
  }

  // one thing it does, over a moment
  _act(s, cb, pc, k, dt, lv) {
    const a = s.act, sb = this.app.sb, up = Math.sqrt(sb.cSize[cb.slot]);
    const step = (times, fn) => {
      while (a.n < times.length && a.t >= times[a.n]) fn(a.n++);
      return a.n >= times.length;
    };
    a.t += dt;
    let done = false;
    if (a.kind === 'look') {
      // a hop, turning as it goes: its eyes' side round to face you
      // (turning the whole way while it's in the air: up and down again)
      done = step([0], () => {
        const turn = this._toCamera(cb, pc), vy = (1.9 + 1.1 * lv) * up, air = (2 * vy) / Math.max(1, Math.abs(sb.p.gravity * (sb.gravityScale ?? 1)));
        this._move(pc, k, { vy, wy: Math.max(-10, Math.min(10, (0.95 * turn) / air)) });
        this.app.audio?.squish?.(0.18);
      });
    } else if (a.kind === 'shimmy') {
      // a wiggle, side to side
      done = step([0, 0.14, 0.28, 0.42, 0.56], (i) => this._move(pc, k, { wy: (i % 2 ? -1 : 1) * (i === 0 || i === 4 ? 2.2 : 4.2) }));
    } else if (a.kind === 'stretch') {
      // a squat, then a stretch up tall
      done = step([0, 0.3], (i) => this._move(pc, k, i ? { top: 2.6 * up, vy: 0.6 } : { top: -2.2 * up }));
    } else {
      // a few bounces where it is
      done = step([0, 0.42, 0.84], (i) => {
        this._move(pc, k, { vy: (1.25 - 0.2 * i) * up * (0.8 + 0.4 * lv) });
        if (i === 0) this.app.audio?.squish?.(0.14);
      });
    }
    if (done && a.t > 0.9) s.act = null;
  }

  // (how far it'd turn - about the up - to face the camera with its eyes' side)
  _toCamera(cb, pc) {
    const sb = this.app.sb, E = cb.style.eyes;
    let x = 0, y = 0, z = 0;
    for (const e of E) (x += e.x), (y += e.y), (z += e.z);
    const F = frameOf(sb, pc.verts), ax = F.ax;
    // (its eyes' way out, in the world, flat)
    const fx = ax[0].x * x + ax[1].x * y + ax[2].x * z, fz = ax[0].z * x + ax[1].z * y + ax[2].z * z;
    const cam = this.app.camera.position, tx = cam.x - pc.com[0], tz = cam.z - pc.com[2];
    if (Math.hypot(fx, fz) < 1e-3) return (Math.random() - 0.5) * 2;
    const da = Math.atan2(tx, tz) - Math.atan2(fx, fz);
    return Math.atan2(Math.sin(da), Math.cos(da));
  }

  // a push on it: up (vy), turning about the up (wy), its top up or down (top), across (vx, vz)
  _move(pc, k, { vy = 0, wy = 0, top = 0, vx = 0, vz = 0 }) {
    if (![vy, wy, top, vx, vz].every(Number.isFinite)) return;
    const sb = this.app.sb, x = sb.x, v = sb.v, c = pc.com, h = Math.max(1e-3, pc.bbox[4] - pc.bbox[1]);
    for (const i of pc.verts) {
      const o = i * 3, rx = x[o] - c[0], rz = x[o + 2] - c[2], ry = (x[o + 1] - pc.bbox[1]) / h;
      // (turning about the up: w x r)
      v[o] += vx + wy * rz;
      v[o + 1] += vy + top * Math.max(0, ry - 0.35);
      v[o + 2] += vz - wy * rx;
    }
    sb.wake(k);
  }

  // a shiver: its top, quickly side to side
  // (one way and back, each frame: going nowhere - a new way now and then)
  _shiver(pc, k, a) {
    const sb = this.app.sb, x = sb.x, v = sb.v, c = pc.com;
    this._sh = -(this._sh || 1);
    if (!this._shd || Math.random() < 0.04) {
      const d = Math.random() * Math.PI * 2;
      this._shd = [Math.cos(d), Math.sin(d)];
    }
    const s = this._sh * (this._sh > 0 ? 0.32 : 0.16) * a, [dx, dz] = this._shd;
    for (const i of pc.verts) {
      const o = i * 3;
      if (x[o + 1] < c[1]) continue;
      v[o] += s * dx;
      v[o + 2] += s * dz;
    }
    sb.wake(k);
  }

  // off out of the way: a hop away from where it's threatened
  _flee(pc, k) {
    const c = pc.com, cam = this.app.camera.position, p = this._at || [cam.x, cam.y, cam.z];
    let dx = c[0] - p[0], dz = c[2] - p[2];
    const l = Math.hypot(dx, dz) || 1;
    // (away, and a little to one side)
    const sd = Math.random() < 0.5 ? -0.5 : 0.5;
    dx /= l;
    dz /= l;
    this._move(pc, k, { vx: (dx - dz * sd) * 1.5, vz: (dz + dx * sd) * 1.5, vy: 2.6, wy: (Math.random() - 0.5) * 4 });
    this.app.audio?.squeak?.(0.5);
  }
}
