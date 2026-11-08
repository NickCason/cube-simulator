// Tools that make cubes out of the cube: the cube cuber (a melon baller with
// a square cup: scoops out a cube) and the dicer (a frame of blades slammed
// down through the jelly and then across it: 27 little cubes).

import * as THREE from 'three';
import { cutBody, planeField, boxField } from '../sim/cutting.js';
import { REST_STEP } from '../sim/softbody.js';
import { makeCuber, makeDicer } from '../world/models.js';
import { fitRotation } from '../heal.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const AX = ['x', 'y', 'z'];

// A body of vertices' frame: where it is (c, centre of mass), how it's
// turned (q, fitted from its rest shape - Müller et al. 2016), its own axes
// in the world (ax), and its extent along them about the centre (lo, hi).
export function frameOf(sb, verts) {
  const c = new THREE.Vector3(), C = new THREE.Vector3();
  let m = 0;
  for (const i of verts) {
    const w = sb.m[i];
    m += w;
    c.x += sb.x[i * 3] * w; c.y += sb.x[i * 3 + 1] * w; c.z += sb.x[i * 3 + 2] * w;
    C.x += sb.X[i * 3] * w; C.y += sb.X[i * 3 + 1] * w; C.z += sb.X[i * 3 + 2] * w;
  }
  c.multiplyScalar(1 / m);
  C.multiplyScalar(1 / m);
  const a = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const i of verts) {
    const w = sb.m[i];
    const dx = (sb.x[i * 3] - c.x) * w, dy = (sb.x[i * 3 + 1] - c.y) * w, dz = (sb.x[i * 3 + 2] - c.z) * w;
    const r = [sb.X[i * 3] - C.x, sb.X[i * 3 + 1] - C.y, sb.X[i * 3 + 2] - C.z];
    for (let k = 0; k < 3; k++) {
      a[k].x += dx * r[k]; a[k].y += dy * r[k]; a[k].z += dz * r[k];
      if (r[k] < lo[k]) lo[k] = r[k];
      if (r[k] > hi[k]) hi[k] = r[k];
    }
  }
  const q = fitRotation(a[0], a[1], a[2], new THREE.Quaternion());
  const ax = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  new THREE.Matrix4().makeRotationFromQuaternion(q).extractBasis(ax[0], ax[1], ax[2]);
  return { c, C, q, ax, lo, hi };
}

// a turn that puts a model's +Y along `up` and its +X along `side` (made square to up)
function basis(up, side, out = new THREE.Quaternion()) {
  const Y = up.clone().normalize();
  const X = side.clone().addScaledVector(Y, -side.dot(Y));
  if (X.lengthSq() < 1e-8) X.set(1, 0, 0).addScaledVector(Y, -Y.x);
  X.normalize();
  const Z = new THREE.Vector3().crossVectors(X, Y);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
}

const ease = (u) => u * u * (3 - 2 * u);

// ------------------------------------------------------------------ cube cuber
// Click: a square cup pushes in and pops a cube of jelly out, turned square to
// the jelly's own faces, and flicks it away tumbling.
export class CuberTool {
  constructor(app) {
    this.app = app;
    this.id = 'cuber';
    this.cursor = 'pointer';
    this.background = true;
    this.model = makeCuber(app.M);
    this.model.visible = false;
    app.scene.add(this.model);
    this.anim = null;
  }

  down(e, ray, hit) {
    if (!hit) return false;
    if (this.anim) return true;
    const sb = this.app.sb;
    const F = frameOf(sb, sb.pieces[hit.piece].verts);
    const n = V(hit.normal), p = V(hit.point);
    // The scoop, worked out in the jelly's rest shape: square to its own
    // faces, 2.5 cells of its mesh a side, every face of it half way between
    // two rows of the mesh's vertices - so the cut never runs along a row
    // (a face snapped onto one left the cube welded in). (Its cube's rows:
    // each cube's rest shape sits apart along x - see REST_STEP.)
    const cube = sb.pieces[hit.piece].cube || 0, g = sb.cH[cube], half = sb.cSize[cube] / 2, R = cube * REST_STEP;
    const mid = (v, o) => o - half + (Math.round((v - o + half) / g - 0.5) + 0.5) * g;
    const d = p.clone().sub(F.c);
    const X = [0, 1, 2].map((k) => F.C.getComponent(k) + d.dot(F.ax[k]));
    let kd = 0;
    for (let k = 1; k < 3; k++) if (Math.abs(F.ax[k].dot(n)) > Math.abs(F.ax[kd].dot(n))) kd = k;
    const sg = Math.sign(F.ax[kd].dot(n)) || 1;
    const ctr = [0, 0, 0], hs = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      if (k === kd) {
        const inner = mid(X[k] - sg * 2.5 * g, k ? 0 : R), outer = X[k] + sg * 0.6 * g;
        ctr[k] = (inner + outer) / 2;
        hs[k] = Math.abs(outer - inner) / 2;
      } else {
        ctr[k] = mid(X[k], k ? 0 : R);
        hs[k] = 1.25 * g;
      }
    }
    // (back into the world)
    const c = F.c.clone();
    for (let k = 0; k < 3; k++) c.addScaledVector(F.ax[k], ctr[k] - F.C.getComponent(k));
    const side = F.ax[(kd + 1) % 3];
    const w = 2.5 * g;
    this.anim = { t: 0, p, n, hs, q: F.q, c, w, cut: false, chunk: -1 };
    this.model.scale.setScalar(w / 0.26);
    basis(n, side, this.model.quaternion);
    this.model.visible = true;
    return true;
  }

  update(dt) {
    const a = this.anim;
    if (!a) return;
    const sb = this.app.sb;
    a.t += dt;
    const T1 = 0.14, T2 = 0.55;
    let pos;
    if (a.t < T1) {
      const u = a.t / T1;
      pos = a.c.clone().addScaledVector(a.n, 0.45 * (1 - u * u) - a.w * 0.25);
    } else {
      if (!a.cut) {
        a.cut = true;
        this.scoop(a);
      }
      const pc = a.chunk >= 0 ? sb.pieces[a.chunk] : null;
      const u = Math.min(1, (a.t - T1) / (T2 - T1));
      pos = pc && u < 0.55 ? V(pc.com) : a.c.clone().addScaledVector(a.n, 0.45 * u - a.w * 0.25);
    }
    this.model.position.copy(pos);
    if (a.t > T2) {
      this.model.visible = false;
      this.anim = null;
    }
  }

  scoop(a) {
    const app = this.app, sb = app.sb;
    if (sb.nT > 30000) {
      app.ui?.hint('That is a lot of jelly bits — hit Re-cube first');
      return;
    }
    app.tally?.('scooped');
    const { c, hs, q, w } = a;
    const res = cutBody(sb, boxField(c.x, c.y, c.z, [q.x, q.y, q.z, q.w], hs[0], hs[1], hs[2], sb.hCell * 0.15), { separate: 0, snap: 0.15, anchors: app.allAnchors() });
    if (!res.changed) return;
    app.onTopologyChanged();
    // the cube is the piece whose centre of mass sits inside the scoop
    let best = -1, bd = Infinity;
    for (const pc of sb.pieces) {
      const d = Math.hypot(pc.com[0] - c.x, pc.com[1] - c.y, pc.com[2] - c.z);
      if (d < w && pc.volume < w ** 3 * 1.6 && d < bd) {
        bd = d;
        best = pc.id;
      }
    }
    if (best >= 0) {
      a.chunk = best;
      const pc = sb.pieces[best];
      // (up and off to one side, where it's seen to land, not at the camera)
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(app.camera.quaternion);
      const v = a.n.clone().multiplyScalar(1.1).addScaledVector(right, (Math.random() < 0.5 ? -1 : 1) * 1.3);
      v.y += 3.1;
      // (and a tumble)
      const w = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(7);
      for (const i of pc.verts) {
        const rx = sb.x[i * 3] - pc.com[0], ry = sb.x[i * 3 + 1] - pc.com[1], rz = sb.x[i * 3 + 2] - pc.com[2];
        sb.v[i * 3] += v.x + w.y * rz - w.z * ry;
        sb.v[i * 3 + 1] += v.y + w.z * rx - w.x * rz;
        sb.v[i * 3 + 2] += v.z + w.x * ry - w.y * rx;
      }
    }
    app.audio.cubePop(1);
    app.markDamaged();
  }
}

// ------------------------------------------------------------------ dicer
// Click the jelly (or a piece of it): a frame of blades the size of it slams
// down through it - shing shing shing shing - swings round and slams through
// it sideways - shing shing - and it falls apart into 27 little cubes, each
// square to the jelly's own faces. Small pieces dice 2 x 2 x 2.
const T = {
  down: 0.22, // the first pass, top to bottom: shing x4, then the slam (and the cuts)
  hold: 0.32,
  swing: 0.5, // round to the side
  across: 0.64, // the second pass: shing x2, thunk (and its cuts)
  pop: 0.72, // ...and apart
  gone: 1.05,
};

export class DicerTool {
  constructor(app) {
    this.app = app;
    this.id = 'dicer';
    this.cursor = 'pointer';
    this.background = true;
    this.model = makeDicer(app.M);
    this.model.visible = false;
    app.scene.add(this.model);
    this.job = null;
    this._q = new THREE.Quaternion();
  }

  down(e, ray, hit) {
    if (!hit) return false;
    if (this.job) return true;
    const app = this.app, sb = app.sb;
    if (sb.nT > 30000) {
      app.ui?.hint('That is a lot of jelly bits — hit Re-cube first');
      return true;
    }
    const verts = sb.pieces[hit.piece].verts.slice();
    const F = frameOf(sb, verts);
    const ext = [0, 1, 2].map((k) => F.hi[k] - F.lo[k]);
    const n = Math.min(...ext) >= 5.5 * sb.hCell ? 3 : Math.min(...ext) >= 3 * sb.hCell ? 2 : 0;
    if (!n) {
      app.ui?.hint('Too small to dice', 1400);
      app.audio.clink(0.5);
      return true;
    }
    // its axis nearest straight up is "up"; of the other two, the one
    // across the screen is the second pass's (seen side on)
    let iu = 0;
    for (let k = 1; k < 3; k++) if (Math.abs(F.ax[k].y) > Math.abs(F.ax[iu].y)) iu = k;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(app.camera.quaternion);
    let [i1, i2] = [0, 1, 2].filter((k) => k !== iu);
    if (Math.abs(F.ax[i2].dot(right)) > Math.abs(F.ax[i1].dot(right))) [i1, i2] = [i2, i1];
    this.job = { t: 0, verts, n, iu, i1, i2, stage: 0, F, ext };
    this._pose(0);
    this.model.visible = true;
    app.audio.diceWhoosh(0);
    return true;
  }

  // the cuts square to axis k of frame F, at thirds (halves) of its extent,
  // only inside its box (the pieces next to it are left alone)
  _cuts(F, k, n) {
    const ax = F.ax[k], m = 0.08;
    const region = (x, y, z) => {
      const dx = x - F.c.x, dy = y - F.c.y, dz = z - F.c.z;
      for (let j = 0; j < 3; j++) {
        const u = dx * F.ax[j].x + dy * F.ax[j].y + dz * F.ax[j].z;
        if (u < F.lo[j] - m || u > F.hi[j] + m) return false;
      }
      return true;
    };
    const out = [];
    for (let i = 1; i < n; i++) {
      const s = F.lo[k] + ((F.hi[k] - F.lo[k]) * i) / n;
      out.push(planeField(ax.x, ax.y, ax.z, ax.dot(F.c) + s, region));
    }
    return out;
  }

  // a run of blades through it: each a shing, a semitone above the last
  _shink(n, k0) {
    const au = this.app.audio, t0 = au.ctx ? au.ctx.currentTime : 0;
    for (let i = 0; i < n; i++) au.diceShink(k0 + i, t0 + i * 0.028);
  }

  _slice(fields) {
    const app = this.app, sb = app.sb, anchors = app.allAnchors();
    fields.forEach((f, i) => cutBody(sb, f, { separate: 0.01, anchors, light: i < fields.length - 1 }));
    if (sb.topoStale) sb.rebuild();
    app.onTopologyChanged();
    app.markDamaged();
    app.hitStop(0.05);
  }

  // where the frame of blades is at time t
  _pose(t) {
    const j = this.job, F = j.F, m = this.model;
    const up = F.ax[j.iu].clone().multiplyScalar(Math.sign(F.ax[j.iu].y) || 1);
    const ctr = F.c.clone();
    for (let k = 0; k < 3; k++) ctr.addScaledVector(F.ax[k], (F.lo[k] + F.hi[k]) / 2);
    const hu = j.ext[j.iu] / 2, h1 = j.ext[j.i1] / 2;
    const side = F.ax[j.i1].clone();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.app.camera.quaternion);
    if (side.dot(right) < 0) side.negate(); // (the second pass comes in from the left)
    // pass 1: flat, coming down; pass 2: on its side, coming across
    const q1 = basis(up, F.ax[j.i1], new THREE.Quaternion());
    const q2 = basis(side.clone().negate(), up, new THREE.Quaternion());
    const p1a = ctr.clone().addScaledVector(up, hu + 0.55), p1b = ctr.clone().addScaledVector(up, -hu - 0.01);
    const p2a = ctr.clone().addScaledVector(side, -h1 - 0.5), p2b = ctr.clone().addScaledVector(side, h1 + 0.03);
    // (x, z: the frame's width and depth; y: the blades' height, as deep as the pass)
    const s1 = new THREE.Vector3(j.ext[j.i1] * 1.14, j.ext[j.iu] * 1.06, j.ext[j.i2] * 1.14);
    const s2 = new THREE.Vector3(j.ext[j.iu] * 1.14, j.ext[j.i1] * 1.06, j.ext[j.i2] * 1.14);
    let p, q, s;
    if (t < T.down) {
      const u = t / T.down;
      p = p1a.clone().lerp(p1b, u * u);
      q = q1;
      s = s1;
    } else if (t < T.hold) {
      p = p1b;
      q = q1;
      s = s1;
    } else if (t < T.swing) {
      // lifted and swung round onto its side, off to the left
      const u = ease((t - T.hold) / (T.swing - T.hold));
      p = p1b.clone().lerp(p2a, u).addScaledVector(up, Math.sin(u * Math.PI) * 0.45);
      q = this._q.slerpQuaternions(q1, q2, u);
      s = s1.clone().lerp(s2, u);
    } else if (t < T.across) {
      const u = (t - T.swing) / (T.across - T.swing);
      p = p2a.clone().lerp(p2b, u * u);
      q = q2;
      s = s2;
    } else {
      // up and away
      const u = Math.min(1, (t - T.across) / (T.gone - T.across));
      p = p2b.clone().addScaledVector(new THREE.Vector3(0, 1, 0), ease(u) * 1.6).addScaledVector(side, ease(u) * 0.6);
      q = q2;
      s = s2.clone().multiplyScalar(1 - 0.85 * ease(u));
    }
    m.position.copy(p);
    m.quaternion.copy(q);
    const { blades, frame } = m.userData;
    blades.scale.copy(s);
    frame.scale.set(s.x, 1, s.z);
    frame.position.y = s.y;
  }

  update(dt) {
    const j = this.job;
    if (!j) return;
    const app = this.app, sb = app.sb;
    j.t += dt;
    const t = j.t;
    // (held first: the second pass cuts what's gripped where it was, not
    // where this frame's physics shoved it)
    if (j.grip) this._hold(j);
    // first pass: shing as the blades go down through it, and as they
    // bottom out - slam - it's in columns
    if (j.stage === 0 && t >= T.down * 0.58) {
      j.stage = 1;
      this._shink(2 * (j.n - 1), 0);
    }
    if (j.stage === 1 && t >= T.down) {
      j.stage = 2;
      j.F = frameOf(sb, j.verts.filter((i) => sb.alive[i]));
      this._slice([...this._cuts(j.F, j.i1, j.n), ...this._cuts(j.F, j.i2, j.n)]);
      this._grip(j);
      app.audio.diceSlam(0);
      app.shake(0.025);
      const top = j.F.c.clone().addScaledVector(F_up(j.F, j.iu), j.ext[j.iu] / 2);
      for (const sgn of [-1, 1]) app.particles.sparks(top.clone().addScaledVector(j.F.ax[j.i1], (sgn * j.ext[j.i1]) / 6), 6, 2.2, [0.85, 0.92, 1]);
    }
    if (j.stage === 2 && t >= T.hold) {
      j.stage = 3;
      app.audio.diceWhoosh(0);
    }
    // second pass, across: shing shing, thunk - it's in cubes
    if (j.stage === 3 && t >= (T.swing + T.across) / 2) {
      j.stage = 4;
      this._shink(j.n - 1, 2 * (j.n - 1));
    }
    if (j.stage === 4 && t >= T.across) {
      j.stage = 5;
      // (square to the same axes as the first pass)
      this._slice(this._cuts(frameOf(sb, j.verts.filter((i) => sb.alive[i])), j.iu, j.n));
      this._grip(j);
      app.audio.thud(0.7);
    }
    if (j.stage === 5 && t >= T.pop) {
      j.stage = 6;
      j.grip = null;
      this._pop(j);
    }
    // (between the passes the columns would topple out of the frame's reach:
    // the dicer holds what it's dicing still until it lets it all go)
    if (j.stage >= 2 && j.stage < 6) this._hold(j);
    this._pose(t);
    if (t >= T.gone) {
      this.model.visible = false;
      this.job = null;
    }
  }

  // From the first pass to the pop the dicer grips what it's dicing just
  // where its blades left it: damped, columns of soft jelly still shoved
  // each other about - now and then they'd bounce clean apart - and the
  // second pass cut them wherever they'd got to. (Held after the physics,
  // before the frame's drawn: still, not jittering.)
  _grip(j) {
    const sb = this.app.sb, seen = new Set(), idx = [];
    for (const i of j.verts) {
      const k = sb.vPiece[i];
      if (!sb.alive[i] || k < 0 || seen.has(k)) continue;
      seen.add(k);
      for (const v of sb.pieces[k].verts) idx.push(v);
    }
    const X = new Float32Array(idx.length * 3);
    idx.forEach((v, n) => X.set([sb.x[v * 3], sb.x[v * 3 + 1], sb.x[v * 3 + 2]], n * 3));
    j.grip = { idx: Int32Array.from(idx), X };
  }

  _hold(j) {
    const sb = this.app.sb, G = j.grip;
    if (G) {
      for (let n = 0; n < G.idx.length; n++) {
        const v = G.idx[n];
        if (!sb.alive[v]) continue;
        sb.x[v * 3] = G.X[n * 3];
        sb.x[v * 3 + 1] = G.X[n * 3 + 1];
        sb.x[v * 3 + 2] = G.X[n * 3 + 2];
        sb.v[v * 3] = sb.v[v * 3 + 1] = sb.v[v * 3 + 2] = 0;
      }
      return;
    }
    const seen = new Set();
    for (const i of j.verts) {
      const k = sb.vPiece[i];
      if (!sb.alive[i] || k < 0 || seen.has(k)) continue;
      seen.add(k);
      for (const v of sb.pieces[k].verts) {
        sb.v[v * 3] *= 0.15;
        sb.v[v * 3 + 1] *= 0.15;
        sb.v[v * 3 + 2] *= 0.15;
      }
    }
  }

  // ...and it falls apart: every die hops away from the middle
  _pop(j) {
    const app = this.app, sb = app.sb;
    const live = j.verts.filter((i) => sb.alive[i]);
    if (!live.length) return;
    const F = frameOf(sb, live);
    sb.radialImpulse(F.c.x, F.c.y, F.c.z, Math.max(...j.ext) * 1.3, 1.6, 1.4, 1);
    app.audio.diceDrop(0);
    app.shake(0.03);
    app.flash = Math.max(app.flash, 0.18);
    const n = parseInt((app.color || '#ffffff').slice(1), 16);
    const col = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    for (let k = 0; k < 30; k++) app.particles.glitter(F.c, 1, col, 1.4);
    app.tally?.('diced');
  }
}

const F_up = (F, iu) => F.ax[iu].clone().multiplyScalar(Math.sign(F.ax[iu].y) || 1);
