import * as THREE from 'three';
import { buildCubeMesh } from './sim/mesh.js';
import { TAG_EXTERIOR, REST_STEP } from './sim/softbody.js';
import { closestOnTriangle } from './sim/geom.js';

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
export function fitRotation(a0, a1, a2, q) {
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

// Distance (rest space) to the healed seams - the lines where the cut faces
// the body was put back together along meet its outside - for the weld's
// light and scorch. Two parts:
// - far: per vertex (and `at` for any point), from samples every few mm
//   along the seams, a 5 cm grid of them and each cell's nearest sample;
// - near: for the shader, exact per pixel within reach of a seam - the space
//   round the cube cut into small cells, each listing the (up to) 8 seam
//   segments nearest to it, packed into float textures (see jellyView).
// segs: 6 floats per segment.
export function* weldFieldJob(segs, size = 1, template = null) {
  const half = (size / 2) * 1.1;
  const G = 0.05 * size, lo = -half - 0.1 * size, N = Math.ceil((2 * half + 0.2 * size) / G) + 1, NN = N * N, N3 = NN * N;
  const cell = (v) => Math.min(N - 1, Math.max(0, Math.floor((v - lo) / G)));
  const nS = segs.length / 6;
  const px = [], py = [], pz = [];
  const STEP = 0.006 * size;
  for (let s = 0; s < nS; s++) {
    const o = s * 6;
    const ax = segs[o], ay = segs[o + 1], az = segs[o + 2], bx = segs[o + 3], by = segs[o + 4], bz = segs[o + 5];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay, bz - az) / STEP));
    for (let q = 0; q < n; q++) {
      const u = q / n;
      px.push(ax + (bx - ax) * u); py.push(ay + (by - ay) * u); pz.push(az + (bz - az) * u);
    }
    px.push(bx); py.push(by); pz.push(bz);
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
  // near field: cells of C reaching R past the cube; a segment is listed in
  // a cell if it passes within R of somewhere in it
  const R = 0.065 * size, C = 0.0275 * size, ext = size / 2 + R + C;
  const NC = Math.ceil((2 * ext) / C), NC3 = NC * NC * NC;
  const reach = R + C * 0.87, SL = 8;
  // (the lists go straight into the texture's data: 2 texels a cell, 1024
  // texels a row; -1 = no segment)
  const W = 1024;
  const cellH = Math.ceil((NC3 * 2) / W);
  yield;
  const slotS = new Float32Array(cellH * W * 4).fill(-1);
  yield;
  const slotD = new Float32Array(NC3 * SL).fill(Infinity);
  yield;
  for (let s = 0; s < nS; s++) {
    if (s % 24 === 23) yield;
    const o = s * 6;
    const ax = segs[o], ay = segs[o + 1], az = segs[o + 2];
    const ux = segs[o + 3] - ax, uy = segs[o + 4] - ay, uz = segs[o + 5] - az;
    const uu = Math.max(ux * ux + uy * uy + uz * uz, 1e-12);
    const r0 = (v) => Math.max(0, Math.floor((v - reach + ext) / C)), r1 = (v) => Math.min(NC - 1, Math.floor((v + reach + ext) / C));
    const i0 = r0(Math.min(ax, ax + ux)), i1 = r1(Math.max(ax, ax + ux));
    const j0 = r0(Math.min(ay, ay + uy)), j1 = r1(Math.max(ay, ay + uy));
    const k0 = r0(Math.min(az, az + uz)), k1 = r1(Math.max(az, az + uz));
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++)
        for (let k = k0; k <= k1; k++) {
          const cx = -ext + (i + 0.5) * C - ax, cy = -ext + (j + 0.5) * C - ay, cz = -ext + (k + 0.5) * C - az;
          const h = Math.min(1, Math.max(0, (cx * ux + cy * uy + cz * uz) / uu));
          const d = Math.hypot(cx - ux * h, cy - uy * h, cz - uz * h);
          if (d > reach) continue;
          // into the cell's list, nearest first
          const b = ((i * NC + j) * NC + k) * SL;
          if (d >= slotD[b + SL - 1]) continue;
          let q = SL - 1;
          while (q > 0 && slotD[b + q - 1] > d) {
            slotD[b + q] = slotD[b + q - 1];
            slotS[b + q] = slotS[b + q - 1];
            q--;
          }
          slotD[b + q] = d;
          slotS[b + q] = s;
        }
  }
  // the segments' ends, 2 texels each
  yield;
  const segH = Math.max(1, Math.ceil((nS * 2) / W));
  const segTex = new Float32Array(segH * W * 4);
  for (let s = 0; s < nS; s++) {
    for (let e = 0; e < 2; e++) {
      const o = (s * 2 + e) * 4;
      segTex[o] = segs[s * 6 + e * 3]; segTex[o + 1] = segs[s * 6 + e * 3 + 1]; segTex[o + 2] = segs[s * 6 + e * 3 + 2];
    }
  }
  return { at, dist, near: { cells: slotS, cellH, segs: segTex, segH, origin: -ext, invC: 1 / C, n: NC, unit: size } };
}

// What's gone - scooped out, blasted off, burnt away: vertices of the cube
// the heal will grow (rest space; the pieces' rest positions x k) that lie
// in no piece left, each with the nearest point of what is left, the wall
// of its hole, and how far that is. The heal fills the holes from their
// walls like a liquid (see Healer._fuse, JellyView). d: -1 = not missing.
export function* fillFieldJob(sb, template, k = 1) {
  const n = template.length / 3;
  const d = new Float32Array(n).fill(-1);
  const wall = new Float32Array(n * 3);
  const loc = { tet: -1, b0: 0, b1: 0, b2: 0, b3: 0 };
  const gone = [];
  for (let i = 0; i < n; i++) {
    if (i % 300 === 299) yield;
    if (!sb.locateRestFast(template[i * 3] / k, template[i * 3 + 1] / k, template[i * 3 + 2] / k, loc)) gone.push(i);
  }
  if (!gone.length) return { d, wall, n: 0 };
  // what's left: its surface in a grid (cells about a template cell across)
  const h = sb.p.size / sb.p.res, C = h, iC = 1 / C;
  const X = sb.X, sTri = sb.sTri, nF = sb.nF;
  const cells = new Map();
  const key = (i, j, l) => (i + 512) * 1048576 + (j + 512) * 1024 + (l + 512);
  for (let f = 0; f < nF; f++) {
    if (f % 600 === 599) yield;
    const a = sTri[f * 3] * 3, b = sTri[f * 3 + 1] * 3, c = sTri[f * 3 + 2] * 3;
    const lo = [0, 1, 2].map((e) => Math.floor(Math.min(X[a + e], X[b + e], X[c + e]) * k * iC));
    const hi = [0, 1, 2].map((e) => Math.floor(Math.max(X[a + e], X[b + e], X[c + e]) * k * iC));
    for (let i = lo[0]; i <= hi[0]; i++)
      for (let j = lo[1]; j <= hi[1]; j++)
        for (let l = lo[2]; l <= hi[2]; l++) {
          const kk = key(i, j, l), list = cells.get(kk);
          if (list) list.push(f);
          else cells.set(kk, [f]);
        }
  }
  // the nearest point on it for each missing vertex: rings of cells out
  // until nothing nearer can be further out
  const q = [0, 0, 0], best = [0, 0, 0];
  const tol = 0.2 * h, maxR = sb.p.res + 2;
  let count = 0;
  for (let g = 0; g < gone.length; g++) {
    if (g % 40 === 39) yield;
    const v = gone[g], px = template[v * 3], py = template[v * 3 + 1], pz = template[v * 3 + 2];
    const ci = Math.floor(px * iC), cj = Math.floor(py * iC), cl = Math.floor(pz * iC);
    let bd = Infinity;
    const seen = new Set();
    for (let r = 0; r <= maxR; r++) {
      if (bd <= ((r - 1) * C) ** 2) break;
      for (let i = ci - r; i <= ci + r; i++)
        for (let j = cj - r; j <= cj + r; j++)
          for (let l = cl - r; l <= cl + r; l++) {
            if (Math.max(Math.abs(i - ci), Math.abs(j - cj), Math.abs(l - cl)) !== r) continue;
            const list = cells.get(key(i, j, l));
            if (!list) continue;
            for (const f of list) {
              if (seen.has(f)) continue;
              seen.add(f);
              const a = sTri[f * 3] * 3, b = sTri[f * 3 + 1] * 3, c = sTri[f * 3 + 2] * 3;
              const dd = closestOnTriangle(px, py, pz, X[a] * k, X[a + 1] * k, X[a + 2] * k, X[b] * k, X[b + 1] * k, X[b + 2] * k, X[c] * k, X[c + 1] * k, X[c + 2] * k, q);
              if (dd < bd) {
                bd = dd;
                best[0] = q[0]; best[1] = q[1]; best[2] = q[2];
              }
            }
          }
    }
    const dist = Math.sqrt(bd);
    // (a hair from what's left: it just snaps in)
    if (!(dist > tol)) continue;
    d[v] = dist;
    wall[v * 3] = best[0]; wall[v * 3 + 1] = best[1]; wall[v * 3 + 2] = best[2];
    count++;
  }
  return { d, wall, n: count };
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
    this.fillJob = null; // what's gone, and where to fill it from (see fillFieldJob)
    this.fillField = null;
    this.fillTemplate = null;
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
    // several cubes (or a stack): each its own home - see _startMulti
    this.multi = app.cubes.length > 1 || !!opts.layout;
    if (this.multi) return this._startMulti(opts);
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

  // Several cubes: each re-forms at its own home - where its pieces mostly
  // are, turned as its biggest piece, kept apart from the others - or, given
  // a layout (a stack), in its place in that. No seams to weld or holes to
  // fill here: the cubes come back fresh.
  _startMulti(opts) {
    const app = this.app, sb = app.sb;
    this.homes = this._homes(opts.layout);
    this.plan = [];
    this.weldJob = this.fillJob = this.weldField = this.fillField = null;
    const h0 = this.homes.values().next().value;
    this.cW = h0 ? h0.cW.clone() : new THREE.Vector3(0, sb.p.size / 2, 0);
    if (!sb.pieces.length || sb.nT === 0) {
      this._fuse();
      return;
    }
    this._plan();
    sb.attract = { targets: this.targets, n: sb.nV, rate: 0 };
    sb.collisionsEnabled = false;
    for (let r = 0; r < sb.rCount; r++) {
      const i = sb.rSim[r];
      sb.glow[i] = Math.max(sb.glow[i], sb.rTag[r] === 0 ? 0.45 : 0.22);
    }
    app.droplets.heal(this.cW.clone(), TL.flyStart - 0.35, 1.15);
    app.audio?.healStart();
  }

  // the yaw of a piece (its rest shape fitted to how it lies, about up)
  _yawOf(main) {
    const sb = this.app.sb;
    let sxx = 0, sxz = 0, rx = 0, rz = 0, mm = 0, cx = 0, cz = 0;
    for (const i of main.verts) {
      rx += sb.X[i * 3] * sb.m[i];
      rz += sb.X[i * 3 + 2] * sb.m[i];
      cx += sb.x[i * 3] * sb.m[i];
      cz += sb.x[i * 3 + 2] * sb.m[i];
      mm += sb.m[i];
    }
    rx /= mm;
    rz /= mm;
    cx /= mm;
    cz /= mm;
    for (const i of main.verts) {
      const px = sb.x[i * 3] - cx, pz = sb.x[i * 3 + 2] - cz;
      const X = sb.X[i * 3] - rx, Z = sb.X[i * 3 + 2] - rz;
      sxx += sb.m[i] * (px * X + pz * Z);
      sxz += sb.m[i] * (px * Z - pz * X);
    }
    return Math.atan2(sxz, sxx);
  }

  // slot -> { cx, cy (its bottom), cz, yaw, cW (centre, as it re-forms), qF }
  _homes(layout) {
    const app = this.app, sb = app.sb, size = sb.p.size, half = size / 2;
    const homes = new Map();
    if (layout) {
      for (const L of layout) homes.set(L.slot, { cx: L.x, cy: L.y, cz: L.z, yaw: L.yaw || 0 });
    } else {
      for (const cb of app.cubes) {
        let M = 0, cx = 0, cz = 0, main = null;
        for (const pc of sb.pieces) {
          if (pc.cube !== cb.slot) continue;
          M += pc.mass;
          cx += pc.com[0] * pc.mass;
          cz += pc.com[2] * pc.mass;
          if (!main || pc.mass > main.mass) main = pc;
        }
        if (M > 0) {
          cx /= M;
          cz /= M;
        }
        homes.set(cb.slot, { cx, cy: 0, cz, yaw: main ? this._yawOf(main) : 0 });
      }
      // apart from each other, and inside the wall
      const H = [...homes.values()], R = Math.max(0, sb.p.arenaRadius - size * 0.8), gap = size * 1.18;
      for (let it = 0; it < 60; it++) {
        let moved = false;
        for (let i = 0; i < H.length; i++) {
          for (let j = i + 1; j < H.length; j++) {
            const a = H[i], b = H[j];
            let dx = b.cx - a.cx, dz = b.cz - a.cz;
            const d = Math.hypot(dx, dz);
            if (d >= gap) continue;
            if (d < 1e-4) {
              const an = Math.random() * Math.PI * 2;
              dx = Math.cos(an);
              dz = Math.sin(an);
            } else {
              dx /= d;
              dz /= d;
            }
            const push = (gap - d) / 2 + 1e-3;
            a.cx -= dx * push;
            a.cz -= dz * push;
            b.cx += dx * push;
            b.cz += dz * push;
            moved = true;
          }
        }
        for (const h of H) {
          const r = Math.hypot(h.cx, h.cz);
          if (r > R) {
            h.cx *= R / r;
            h.cz *= R / r;
          }
        }
        if (!moved) break;
      }
      // (too crowded for the floor: they stack instead)
      for (let i = 0; i < H.length; i++) for (let j = i + 1; j < H.length; j++) if (Math.hypot(H[i].cx - H[j].cx, H[i].cz - H[j].cz) < size * 1.02) return this._homes(app.stackLayout());
    }
    for (const h of homes.values()) {
      h.cW = new THREE.Vector3(h.cx, h.cy + half + LIFT_FUSE, h.cz);
      h.qF = new THREE.Quaternion().setFromAxisAngle(UP, h.yaw);
    }
    return homes;
  }

  // Per-piece keyframes: where it is now (fitted rigid transform), where it
  // hovers in the exploded view, where it belongs in the cube.
  _plan() {
    const sb = this.app.sb;
    const half = sb.p.size / 2;
    const k = this.scaleK;
    if (!this.multi) this.cW = new THREE.Vector3(this.cx, half + LIFT_FUSE, this.cz);
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
      // (its cube's home: several cubes, each its own)
      const home = this.multi ? this.homes.get(pc.cube) : null;
      if (this.multi && !home) continue;
      const qF = home ? home.qF : this.qF, cW = home ? home.cW : this.cW;
      const Cl = home ? new THREE.Vector3(C.x - pc.cube * REST_STEP, C.y, C.z) : C;
      const q0 = fitRotation(a[0], a[1], a[2], qF.clone());
      // final place in the cube, and an exploded hover spot just outside it
      const off = Cl.clone().multiplyScalar(k).applyQuaternion(qF);
      const cF = cW.clone().add(off);
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
        qF,
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
      q.slerpQuaternions(p.q0, p.qF, uB);
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
    if (sb.fill) {
      sb.fill.t += dt;
      if (sb.fill.t > sb.fill.dur || sb.fill.topo !== sb.topoVersion) sb.fill = null;
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
    // what's missing is worked out first (the droplets need it before they
    // set off), then the weld's light field, a little at a time
    if (this.fillJob) {
      const t0 = performance.now();
      let r;
      do r = this.fillJob.next();
      while (!r.done && performance.now() - t0 < 3);
      if (r.done) {
        this.fillField = r.value;
        this.fillJob = null;
        this._sendDroplets();
      }
    } else if (this.weldJob) {
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

  // The seams the pieces will be welded along - where a cut face meets the
  // outside: edges shared by a cut face and an outer one (rest space, as the
  // new cube will have them) - and a job building the weld's distance field.
  _startWeld() {
    const sb = this.app.sb;
    if (this.multi) {
      this.weldJob = this.fillJob = null;
      return;
    }
    const k = this.scaleK, X = sb.X, sTri = sb.sTri, sTag = sb.sTag, nF = sb.nF, K = sb.nV + 1;
    const outer = new Set();
    for (let f = 0; f < nF; f++) {
      if (sTag[f] !== TAG_EXTERIOR) continue;
      for (let e = 0; e < 3; e++) {
        const a = sTri[f * 3 + e], b = sTri[f * 3 + ((e + 1) % 3)];
        outer.add(a < b ? a * K + b : b * K + a);
      }
    }
    // (each seam runs along both of the pieces it parted: keep one copy)
    const segs = [], seen = new Set();
    const key = (i) => `${Math.round(X[i * 3] * 1e4)},${Math.round(X[i * 3 + 1] * 1e4)},${Math.round(X[i * 3 + 2] * 1e4)}`;
    for (let f = 0; f < nF; f++) {
      if (sTag[f] === TAG_EXTERIOR) continue;
      for (let e = 0; e < 3; e++) {
        const a = sTri[f * 3 + e], b = sTri[f * 3 + ((e + 1) % 3)];
        if (!outer.has(a < b ? a * K + b : b * K + a)) continue;
        const ka = key(a), kb = key(b), kk = ka < kb ? ka + '|' + kb : kb + '|' + ka;
        if (seen.has(kk)) continue;
        seen.add(kk);
        segs.push(X[a * 3] * k, X[a * 3 + 1] * k, X[a * 3 + 2] * k, X[b * 3] * k, X[b * 3 + 1] * k, X[b * 3 + 2] * k);
      }
    }
    this.weldField = null;
    const p = sb.p;
    const template = buildCubeMesh(p.res, p.size, p.bevel).pos;
    this.fillTemplate = template;
    this.weldJob = segs.length ? weldFieldJob(segs, p.size, template) : null;
    // and what's missing, for the liquid fill (first: the droplets want it)
    this.fillField = null;
    this.fillJob = fillFieldJob(sb, template, k);
  }

  // Blasted-off drops head for the holes they came out of (where the cube
  // will be: the template's missing vertices, placed as _fuse will).
  _sendDroplets() {
    const f = this.fillField;
    if (!f || !f.n) return;
    const pts = [];
    for (let i = 0; i < f.d.length; i++) if (f.d[i] >= 0) pts.push(i);
    const half = this.app.sb.p.size / 2, c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const tpl = this.fillTemplate;
    this.app.droplets.retarget((out) => {
      const i = pts[Math.floor(Math.random() * pts.length)];
      const X = tpl[i * 3], Y = tpl[i * 3 + 1], Z = tpl[i * 3 + 2];
      out.set(this.cx + c * X + s * Z, LIFT_FUSE + Y + half, this.cz - s * X + c * Z);
    });
  }


  // every cube fresh at its home (its bottom LIFT_FUSE up), let down gently
  _fuseMulti() {
    const app = this.app, sb = app.sb, size = sb.p.size;
    sb.attract = null;
    sb.nV = 0;
    sb.nT = 0;
    sb.embeds.length = 0;
    sb.grabs.length = 0;
    for (const [slot, h] of this.homes) {
      const cb = app.cubes.find((c) => c.slot === slot);
      sb.addCube(slot, h.cx, h.cy + LIFT_FUSE, h.cz, h.yaw, cb ? app.bevelOf(cb) : sb.cBevel[slot]);
    }
    sb.rebuild();
    sb.fill = null;
    sb.weld = null;
    sb.collisionsEnabled = true;
    sb.dampBoost = 1;
    sb.gravityScale = 0;
    sb.glow.fill(0.25, 0, sb.nV);
    this.weldT = undefined;
    app.jelly.frontMat.uniforms.uWeldT.value = 99;
    this.fused = true;
    this.active = false;
    this.settling = true;
    this.settleT = 0;
    for (const f of app.onHealEnd) f();
    app.onTopologyChanged();
    app.markHealed();
    app.audio?.healFuse();
    for (const h of this.homes.values()) {
      app.particles?.flash(h.cW, 0.9 * size, [2.4, 2.1, 1.7]);
      for (let k = 0; k < 10; k++) app.particles?.glitter(h.cW, 1, [1, 0.92, 0.75], 1.2);
    }
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
    if (this.multi) return this._fuseMulti();
    // the seams' light field (usually built during the flight already)
    if (!this.weldField && !this.weldJob && this.plan?.length) this._startWeld();
    const field = this.weldField || (this.weldJob ? finish(this.weldJob) : null);
    this.weldJob = null;
    this.weldField = null;
    const fill = this.fillField || (this.fillJob ? finish(this.fillJob) : null);
    this.fillJob = null;
    this.fillField = null;
    sb.attract = null;
    sb.loadCube(this.cx, LIFT_FUSE, this.cz, this.yaw);
    // what was missing starts where its holes' walls were and rises to fill
    // them, glowing, as the seams weld (JellyView moves it, from sb.fill)
    sb.fill = null;
    if (fill && fill.n && fill.d.length === sb.nV) {
      const off = new Float32Array(sb.nV * 3), c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      let dmax = 0;
      for (let i = 0; i < sb.nV; i++) {
        if (fill.d[i] < 0) continue;
        dmax = Math.max(dmax, fill.d[i]);
        // (rest -> world: turned by the yaw, as loadCube places it)
        const ox = fill.wall[i * 3] - sb.X[i * 3], oy = fill.wall[i * 3 + 1] - sb.X[i * 3 + 1], oz = fill.wall[i * 3 + 2] - sb.X[i * 3 + 2];
        off[i * 3] = c * ox + s * oz; off[i * 3 + 1] = oy; off[i * 3 + 2] = -s * ox + c * oz;
      }
      sb.fill = { d: fill.d, off, dmax, t: 0, dur: Math.min(1.25, Math.max(0.7, 0.55 + dmax * 2.2)), topo: sb.topoVersion };
    }
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
      sb.weld = { dist, at: field.at, near: field.near, topo: sb.topoVersion };
      sb.glow.fill(0.1, 0, sb.nV);
    } else {
      sb.weld = null;
      sb.glow.fill(0.25, 0, sb.nV);
    }
    // (the new jelly comes in glowing like liquid light, the rest of the cube a little)
    if (sb.fill) for (let i = 0; i < sb.nV; i++) if (sb.fill.d[i] >= 0) sb.glow[i] = 2.4;
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
