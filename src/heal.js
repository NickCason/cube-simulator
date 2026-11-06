import * as THREE from 'three';
import { buildCubeMesh } from './sim/mesh.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
// C2-continuous ease in/out: gentle starts and landings
const smoother = (u) => {
  u = clamp01(u);
  return u * u * u * (u * (u * 6 - 15) + 10);
};

// Choreography (seconds): loosen & lift, expand into an exploded view while
// every fragment turns to its final orientation, hover, fly together, fuse,
// then lower gently onto the table.
const TL = {
  expandStart: 0.12,
  expandDur: 1.05,
  flyStart: 1.38,
  flyDur: 0.92,
  stagger: 0.16,
  settle: 0.75,
};
const LIFT_HOVER = 0.24; // how high the exploded view floats
const LIFT_FUSE = 0.12; // the reformed cube is lowered from here
const UP = new THREE.Vector3(0, 1, 0);

// Rotation that best maps rest offsets onto current offsets
// (Müller et al. 2016, "A robust method to extract the rotational part of
// deformations"). Columns: a_j = sum m (x - c) (X - C)_j.
function fitRotation(a0, a1, a2, q) {
  const m = new THREE.Matrix4();
  const r = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const om = new THREE.Vector3(), t = new THREE.Vector3(), dq = new THREE.Quaternion();
  for (let it = 0; it < 40; it++) {
    m.makeRotationFromQuaternion(q);
    m.extractBasis(r[0], r[1], r[2]);
    om.set(0, 0, 0);
    om.add(t.crossVectors(r[0], a0)).add(t.crossVectors(r[1], a1)).add(t.crossVectors(r[2], a2));
    const den = Math.abs(r[0].dot(a0) + r[1].dot(a1) + r[2].dot(a2)) + 1e-9;
    om.multiplyScalar(1 / den);
    const w = om.length();
    if (w < 1e-9) break;
    dq.setFromAxisAngle(om.multiplyScalar(1 / w), w);
    q.premultiply(dq).normalize();
  }
  return q;
}

// Distance (rest space) to the nearest healed seam - the cut faces the body
// was put back together along, inside it as well as on its skin - so the
// weld's light can travel out from them through the material and show where
// it crosses each face. Seams come as triangles (9 floats each); they are
// sampled densely so a seam line stays a clean line, with a coarse copy for
// points further away.
export function* weldFieldJob(tris, half = 0.5, template = null) {
  // one grid over the body (5 cm cells): the seam samples in each cell (for
  // exact distances close in), and each cell's nearest sample (for further)
  const G = 0.05, lo = -half - 0.1, N = Math.ceil((2 * half + 0.2) / G) + 1, NN = N * N, N3 = NN * N;
  const cell = (v) => Math.min(N - 1, Math.max(0, Math.floor((v - lo) / G)));
  // samples: densely (1.2 cm) on seam triangles near the skin, where seam
  // lines show; just the corners for ones deep inside
  const px = [], py = [], pz = [];
  const fine = new Set();
  const FINE = 0.012, skin = 0.07;
  const add = (x, y, z) => {
    const kf = ((Math.floor(x / FINE) + 512) * 1024 + (Math.floor(y / FINE) + 512)) * 1024 + (Math.floor(z / FINE) + 512);
    if (fine.has(kf)) return;
    fine.add(kf);
    px.push(x); py.push(y); pz.push(z);
  };
  const depth = (x, y, z) => half - Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
  for (let t = 0; t < tris.length; t += 9) {
    if (t && t % 900 === 0) yield;
    const ax = tris[t], ay = tris[t + 1], az = tris[t + 2];
    const bx = tris[t + 3], by = tris[t + 4], bz = tris[t + 5];
    const cx = tris[t + 6], cy = tris[t + 7], cz = tris[t + 8];
    const deep = Math.min(depth(ax, ay, az), depth(bx, by, bz), depth(cx, cy, cz)) > skin;
    const L = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - bx, cy - by, cz - bz), Math.hypot(ax - cx, ay - cy, az - cz));
    const n = deep ? Math.min(3, Math.max(1, Math.ceil(L / 0.04))) : Math.min(24, Math.max(1, Math.ceil(L / FINE)));
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n - i; j++) {
        const u = i / n, v = j / n, w = 1 - u - v;
        add(ax * w + bx * u + cx * v, ay * w + by * u + cy * v, az * w + bz * u + cz * v);
      }
  }
  const M = px.length;
  // bucket the samples by cell (CSR)
  const start = new Int32Array(N3 + 1), idx = new Int32Array(M), cof = new Int32Array(M);
  yield;
  for (let k = 0; k < M; k++) {
    cof[k] = (cell(px[k]) * N + cell(py[k])) * N + cell(pz[k]);
    start[cof[k] + 1]++;
  }
  for (let c = 0; c < N3; c++) start[c + 1] += start[c];
  const fill = start.slice(0, N3);
  for (let k = 0; k < M; k++) idx[fill[cof[k]]++] = k;
  // nearest sample per cell: seed from its own samples, then sweep
  const near = new Int32Array(N3).fill(-1), d2 = new Float32Array(N3).fill(Infinity);
  yield;
  for (let i = 0, c = 0; i < N; i++) {
    if (i % 6 === 5) yield;
    for (let j = 0; j < N; j++)
      for (let k = 0; k < N; k++, c++) {
        const ox = lo + (i + 0.5) * G, oy = lo + (j + 0.5) * G, oz = lo + (k + 0.5) * G;
        for (let e = start[c]; e < start[c + 1]; e++) {
          const s = idx[e];
          const dd = (px[s] - ox) ** 2 + (py[s] - oy) ** 2 + (pz[s] - oz) ** 2;
          if (dd < d2[c]) {
            d2[c] = dd;
            near[c] = s;
          }
        }
      }
  }
  const offs = [];
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let e = -1; e <= 1; e++) if (a || b || e) offs.push(a, b, e);
  for (let pass = 0; pass < 2; pass++) {
    for (let q = 0; q < N3; q++) {
      if (q % 4096 === 4095) yield;
      const c = pass ? N3 - 1 - q : q;
      const i = (c / NN) | 0, j = ((c / N) | 0) % N, k = c % N;
      const ox = lo + (i + 0.5) * G, oy = lo + (j + 0.5) * G, oz = lo + (k + 0.5) * G;
      for (let o = 0; o < offs.length; o += 3) {
        const ii = i + offs[o], jj = j + offs[o + 1], kk = k + offs[o + 2];
        if (ii < 0 || jj < 0 || kk < 0 || ii >= N || jj >= N || kk >= N) continue;
        const s = near[(ii * N + jj) * N + kk];
        if (s < 0) continue;
        const dd = (px[s] - ox) ** 2 + (py[s] - oy) ** 2 + (pz[s] - oz) ** 2;
        if (dd < d2[c]) {
          d2[c] = dd;
          near[c] = s;
        }
      }
    }
  }
  const at = (x, y, z) => {
    if (!M) return 99;
    const i = cell(x), j = cell(y), k = cell(z);
    let best = Infinity;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let e = -1; e <= 1; e++) {
          const ii = i + a, jj = j + b, kk = k + e;
          if (ii < 0 || jj < 0 || kk < 0 || ii >= N || jj >= N || kk >= N) continue;
          const c = (ii * N + jj) * N + kk;
          // every sample in the neighbouring cells, and their nearest ones
          for (let q = start[c]; q < start[c + 1]; q++) {
            const s = idx[q];
            const dd = (px[s] - x) ** 2 + (py[s] - y) ** 2 + (pz[s] - z) ** 2;
            if (dd < best) best = dd;
          }
          const s = near[c];
          if (s >= 0) {
            const dd = (px[s] - x) ** 2 + (py[s] - y) ** 2 + (pz[s] - z) ** 2;
            if (dd < best) best = dd;
          }
        }
    return Math.sqrt(best);
  };
  // the cube it will become is known already: measure its vertices now too
  let dist = null;
  if (template) {
    const n = template.length / 3;
    dist = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (i % 300 === 299) yield;
      dist[i] = at(template[i * 3], template[i * 3 + 1], template[i * 3 + 2]);
    }
  }
  return { at, dist };
}

// Run a job to the end (now).
function finish(job) {
  let r;
  do r = job.next();
  while (!r.done);
  return r.value;
}

// The heal sequence: eject foreign objects, cool/thaw, choreograph every
// fragment back into a levitating cube, then fuse the topology back into one
// pristine mesh with glowing seams.
export class Healer {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.t = 0;
    // (every field up front: a stable object shape keeps Safari's JIT happy)
    this.settling = false;
    this.settleT = 0;
    this.fused = false;
    this.gathered = false;
    this.ejected = 0;
    this.scaleK = 1;
    this.cx = 0;
    this.cz = 0;
    this.yaw = 0;
    this.qF = new THREE.Quaternion();
    this.cW = new THREE.Vector3();
    this.plan = [];
    this.planTopo = -1;
    this.targets = null;
    this.weldJob = null;
    this.weldField = null;
    this.weldT = undefined;
  }

  start(opts = {}) {
    if (this.active) return;
    const app = this.app;
    const sb = app.sb;
    this.active = true;
    this.settling = false;
    this.t = 0;
    this.fused = false;
    this.gathered = false;
    this.ejected = app.nails.ejectAll();
    for (const f of app.onHealStart) f();
    sb.endGrab();
    this.scaleK = opts.scale || 1;
    if (!sb.pieces.length || sb.nT === 0) {
      // everything was blasted away: grow a fresh cube
      this.cx = 0;
      this.cz = 0;
      this.yaw = 0;
      this.plan = [];
      this._fuse();
      return;
    }
    // destination: upright cube under the centre of mass, yaw of the biggest piece
    let M = 0, cx = 0, cz = 0;
    for (const pc of sb.pieces) {
      M += pc.mass;
      cx += pc.com[0] * pc.mass;
      cz += pc.com[2] * pc.mass;
    }
    cx /= M || 1;
    cz /= M || 1;
    const R = sb.p.arenaRadius - 1.05;
    const r = Math.hypot(cx, cz);
    if (r > R) {
      cx *= Math.max(R, 0) / r;
      cz *= Math.max(R, 0) / r;
    }
    const main = sb.pieces.reduce((a, b) => (b.mass > a.mass ? b : a), sb.pieces[0]);
    let sxx = 0, sxz = 0, rx = 0, rz = 0, mm = 0;
    for (const i of main.verts) {
      rx += sb.X[i * 3] * sb.m[i];
      rz += sb.X[i * 3 + 2] * sb.m[i];
      mm += sb.m[i];
    }
    rx /= mm;
    rz /= mm;
    for (const i of main.verts) {
      const px = sb.x[i * 3] - main.com[0], pz = sb.x[i * 3 + 2] - main.com[2];
      const X = sb.X[i * 3] - rx, Z = sb.X[i * 3 + 2] - rz;
      sxx += sb.m[i] * (px * X + pz * Z);
      sxz += sb.m[i] * (px * Z - pz * X);
    }
    this.yaw = Math.atan2(sxz, sxx);
    this.cx = cx;
    this.cz = cz;
    this.qF = new THREE.Quaternion().setFromAxisAngle(UP, this.yaw);
    this._plan();
    this._startWeld();
    sb.attract = { targets: this.targets, n: sb.nV, rate: 0 };
    sb.collisionsEnabled = false;
    // an immediate soft shimmer so the heal is felt the moment it starts
    for (let r = 0; r < sb.rCount; r++) {
      const i = sb.rSim[r];
      sb.glow[i] = Math.max(sb.glow[i], sb.rTag[r] === 0 ? 0.45 : 0.22);
    }
    // blasted-off blobs stream home to arrive as the pieces meet
    app.droplets.heal(this.cW.clone(), TL.flyStart - 0.35, 1.15);
    app.audio?.healStart();
  }

  // Per-piece keyframes: where it is now (fitted rigid transform), where it
  // hovers in the exploded view, where it belongs in the cube.
  _plan() {
    const sb = this.app.sb;
    const half = sb.p.size / 2;
    const k = this.scaleK;
    this.cW = new THREE.Vector3(this.cx, half + LIFT_FUSE, this.cz);
    const plan = [];
    let seed = 99991;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const a = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (const pc of sb.pieces) {
      const vs = pc.verts;
      let m = 0;
      const C = new THREE.Vector3(), c = new THREE.Vector3();
      for (const i of vs) {
        const w = sb.m[i];
        m += w;
        C.x += sb.X[i * 3] * w; C.y += sb.X[i * 3 + 1] * w; C.z += sb.X[i * 3 + 2] * w;
        c.x += sb.x[i * 3] * w; c.y += sb.x[i * 3 + 1] * w; c.z += sb.x[i * 3 + 2] * w;
      }
      if (m <= 0) continue;
      C.multiplyScalar(1 / m);
      c.multiplyScalar(1 / m);
      a[0].set(0, 0, 0); a[1].set(0, 0, 0); a[2].set(0, 0, 0);
      for (const i of vs) {
        const w = sb.m[i];
        const dx = (sb.x[i * 3] - c.x) * w, dy = (sb.x[i * 3 + 1] - c.y) * w, dz = (sb.x[i * 3 + 2] - c.z) * w;
        const X = sb.X[i * 3] - C.x, Y = sb.X[i * 3 + 1] - C.y, Z = sb.X[i * 3 + 2] - C.z;
        a[0].x += dx * X; a[0].y += dy * X; a[0].z += dz * X;
        a[1].x += dx * Y; a[1].y += dy * Y; a[1].z += dz * Y;
        a[2].x += dx * Z; a[2].y += dy * Z; a[2].z += dz * Z;
      }
      const q0 = fitRotation(a[0], a[1], a[2], this.qF.clone());
      // final place in the cube, and an exploded hover spot just outside it
      const off = C.clone().multiplyScalar(k).applyQuaternion(this.qF);
      const cF = this.cW.clone().add(off);
      const dist = off.length();
      // spread mostly sideways so the exploded view stays in frame
      const dir = dist > 1e-4 ? new THREE.Vector3(off.x, off.y * 0.45, off.z).normalize() : new THREE.Vector3();
      const spread = 0.38 * smooth(0.02, 0.32, dist / Math.max(k, 0.3));
      const cE = cF.clone().addScaledVector(dir, spread).addScaledVector(UP, LIFT_HOVER - LIFT_FUSE);
      plan.push({
        verts: vs,
        C,
        c0: c,
        q0,
        cE,
        cF,
        // a little ripple: pieces nearer the middle lead, the rest follow
        delay: TL.stagger * (0.35 * rnd() + 0.65 * Math.min(1, dist / 0.6)),
      });
    }
    this.plan = plan;
    this.planTopo = sb.topoVersion;
    if (!this.targets || this.targets.length < sb.nV * 3) this.targets = new Float64Array(sb.vCap * 3);
    // targets start where the vertices are (no jump on the first frame)
    this.targets.set(sb.x.subarray(0, sb.nV * 3));
  }

  // Animate the targets every frame along the keyframed paths.
  _updateTargets(t) {
    const sb = this.app.sb;
    const tg = this.targets, X = sb.X;
    const k = this.scaleK;
    const q = new THREE.Quaternion(), ctr = new THREE.Vector3(), v = new THREE.Vector3();
    for (const p of this.plan) {
      const uB = smoother((t - TL.expandStart - p.delay) / TL.expandDur);
      const uC = smoother((t - TL.flyStart - p.delay * 0.6) / TL.flyDur);
      // drift out on a gentle arc while turning to the final orientation
      ctr.lerpVectors(p.c0, p.cE, uB).addScaledVector(UP, 0.08 * Math.sin(Math.PI * uB));
      ctr.lerp(p.cF, uC);
      q.slerpQuaternions(p.q0, this.qF, uB);
      const s = 1 + (k - 1) * uB;
      for (const i of p.verts) {
        v.set((X[i * 3] - p.C.x) * s, (X[i * 3 + 1] - p.C.y) * s, (X[i * 3 + 2] - p.C.z) * s).applyQuaternion(q).add(ctr);
        tg[i * 3] = v.x;
        tg[i * 3 + 1] = v.y;
        tg[i * 3 + 2] = v.z;
      }
    }
  }

  update(dt) {
    const app = this.app;
    const sb = app.sb;
    const U = app.jelly.frontMat.uniforms;
    if (this.weldT !== undefined) {
      this.weldT += dt;
      U.uWeldT.value = this.weldT;
      if (this.weldT > 5 || !sb.weld || sb.weld.topo !== sb.topoVersion) {
        this.weldT = undefined;
        U.uWeldT.value = 99;
      }
    }
    if (this.settling) {
      // lower the reformed cube gently onto the table
      this.settleT += dt;
      const u = smooth(0, TL.settle, this.settleT);
      sb.gravityScale = u * u;
      app.healZoom = 0.1 * (1 - u);
      if (this.settleT >= TL.settle) {
        this.settling = false;
        sb.gravityScale = 1;
        app.healZoom = 0;
      }
    }
    if (!this.active) return;
    this.t += dt;
    const t = this.t;
    // thaw / cool / deflate
    const kk = Math.exp(-dt * 2.4);
    for (let i = 0; i < sb.nV; i++) sb.temp[i] *= kk;
    for (let t2 = 0; t2 < sb.nT; t2++) sb.tVS[t2] = 1 + (sb.tVS[t2] - 1) * kk;
    sb.heatActive = true;
    sb._heatResidual = 1;
    if (this.fused) return;
    // a tool effect landing mid-heal (e.g. a mallet strike) changes the
    // pieces: re-plan from wherever things are now and keep the timeline
    if (sb.topoVersion !== this.planTopo) {
      this._plan();
      this._startWeld();
      sb.attract = { targets: this.targets, n: sb.nV, rate: sb.attract ? sb.attract.rate : 0 };
    }
    // the weld's light field is built a little at a time while the pieces fly
    if (this.weldJob) {
      const t0 = performance.now();
      let r;
      do r = this.weldJob.next();
      while (!r.done && performance.now() - t0 < 2.5);
      if (r.done) {
        this.weldField = r.value;
        this.weldJob = null;
      }
    }
    this._updateTargets(t);
    sb.attract.n = sb.nV;
    sb.attract.rate = 16 * smooth(0, 0.5, t);
    sb.gravityScale = 1 - smooth(0, 0.4, t);
    sb.dampBoost = 1 + 1.6 * smooth(0, 0.5, t);
    app.healZoom = 0.1 * smooth(0.1, 0.9, t);
    // seams light up as the pieces close in
    const g = smooth(TL.flyStart - 0.2, TL.flyStart + TL.flyDur, t);
    if (g > 0) {
      for (let r = 0; r < sb.rCount; r++) {
        if (sb.rTag[r] === 0) {
          const i = sb.rSim[r];
          sb.glow[i] = Math.max(sb.glow[i], 0.15 + 0.85 * g);
        }
      }
    }
    if (!this.gathered && t > TL.flyStart) {
      this.gathered = true;
      app.audio?.healGather?.();
    }
    if (Math.random() < 0.45 + 0.4 * g) {
      const p = this.plan[Math.floor(Math.random() * this.plan.length)];
      if (p) app.particles?.glitter(p.c0.clone().lerp(p.cF, g), 1);
    }
    const end = TL.flyStart + TL.flyDur + TL.stagger;
    if ((t > end && this._maxError() < 0.025) || t > end + 0.45) this._fuse();
  }

  // The cut faces (rest space, triangles) the pieces will be welded along,
  // and a job building the distance field the weld's light travels by.
  _startWeld() {
    const sb = this.app.sb;
    const seams = [];
    const k = this.scaleK, rI = sb.rIndex, rS = sb.rSim, X = sb.X;
    for (let t = 0; t < rI.length; t += 3) {
      const a = rI[t], b = rI[t + 1], c = rI[t + 2];
      if (sb.rTag[a] !== 0 || sb.rTag[b] !== 0 || sb.rTag[c] !== 0) continue;
      for (const r of [a, b, c]) {
        const i = rS[r] * 3;
        seams.push(X[i] * k, X[i + 1] * k, X[i + 2] * k);
      }
    }
    this.weldField = null;
    const p = sb.p;
    this.weldJob = seams.length ? weldFieldJob(seams, (p.size / 2) * 1.1, buildCubeMesh(p.res, p.size, p.bevel).pos) : null;
  }

  _maxError() {
    const sb = this.app.sb;
    const tg = this.targets;
    let m = 0;
    for (let i = 0; i < sb.nV; i++) {
      if (!sb.alive[i]) continue;
      const dx = sb.x[i * 3] - tg[i * 3], dy = sb.x[i * 3 + 1] - tg[i * 3 + 1], dz = sb.x[i * 3 + 2] - tg[i * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d > m) m = d;
    }
    return Math.sqrt(m);
  }

  _fuse() {
    const app = this.app;
    const sb = app.sb;
    // the seams' light field (usually built during the flight already)
    if (!this.weldField && !this.weldJob && this.plan?.length) this._startWeld();
    const field = this.weldField || (this.weldJob ? finish(this.weldJob) : null);
    this.weldJob = null;
    this.weldField = null;
    sb.attract = null;
    sb.loadCube(this.cx, LIFT_FUSE, this.cz, this.yaw);
    sb.collisionsEnabled = true;
    sb.dampBoost = 1;
    sb.gravityScale = 0;
    // the weld's light spreads from where the seams met the outside (the
    // jelly shader animates it from these distances; see uWeldT)
    if (field) {
      let dist = field.dist;
      if (!dist || dist.length !== sb.nV) {
        dist = new Float32Array(sb.nV);
        for (let i = 0; i < sb.nV; i++) dist[i] = field.at(sb.X[i * 3], sb.X[i * 3 + 1], sb.X[i * 3 + 2]);
      }
      sb.weld = { dist, at: field.at, topo: sb.topoVersion };
      sb.glow.fill(0.1, 0, sb.nV);
    } else {
      sb.weld = null;
      sb.glow.fill(0.25, 0, sb.nV);
    }
    this.weldT = field ? 0 : undefined;
    app.jelly.frontMat.uniforms.uWeldT.value = field ? 0 : 99;
    this.fused = true;
    this.active = false;
    this.settling = true;
    this.settleT = 0;
    for (const f of app.onHealEnd) f();
    app.onTopologyChanged();
    app.markHealed();
    app.audio?.healFuse();
    const ctr = new THREE.Vector3(this.cx, sb.p.size / 2 + LIFT_FUSE, this.cz);
    app.particles?.flash(ctr, 0.9 * sb.p.size, [2.4, 2.1, 1.7]);
    for (let k = 0; k < 28; k++) app.particles?.glitter(ctr, 1, [1, 0.92, 0.75], 1.2);
  }
}
