// XPBD tetrahedral soft body with stable Neo-Hookean constraints
// (Macklin & Müller 2021), rigid-motion-preserving damping, ground/arena
// contact with friction, inter-piece contact, grabbing, embedded rigid
// segments (nails) and a per-vertex temperature field.

import { buildCubeMesh, roundBoxSDF, roundBoxNormal } from './mesh.js';

export const FACES = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
export const TAG_FRESH = 0;
export const TAG_EXTERIOR = 1;

const DEFAULTS = {
  size: 1,
  res: 11,
  bevel: 0.13,
  density: 1,
  mu: 170, // shear modulus (sets wobble frequency)
  lambdaRatio: 24, // lambda / mu (near-incompressible)
  gravity: -22,
  substeps: 12,
  damping: 1.7, // decay rate of non-rigid velocity (1/s)
  airDrag: 0.05,
  friction: 0.85,
  bounce: -1, // rebound/impact speed ratio for floor & wall hits (-1 = natural)
  arenaRadius: 2.35,
  ceiling: 4.2,
  maxSpeed: 45,
  collide: true,
};

function growArr(a, n, C) {
  const b = new C(n);
  if (a) b.set(a.length > n ? a.subarray(0, n) : a);
  return b;
}

export class SoftBody {
  constructor(opts = {}) {
    this.p = Object.assign({}, DEFAULTS, opts);
    this.nV = 0;
    this.nT = 0;
    this.vCap = 0;
    this.tCap = 0;
    this._allocV(4096);
    this._allocT(16384);
    this.grab = null;
    this.embeds = [];
    this.attract = null;
    this.gravityScale = 1;
    this.collisionsEnabled = true;
    this.topoVersion = 0;
    this.pieces = [];
    this.time = 0;
    this.hCell = this.p.size / this.p.res;
    this.impacts = []; // [{x,y,z,speed}] floor/wall impacts this frame (for audio)
  }

  // ---------------------------------------------------------------- storage
  _allocV(cap) {
    this.x = growArr(this.x, cap * 3, Float64Array);
    this.px = growArr(this.px, cap * 3, Float64Array);
    this.v = growArr(this.v, cap * 3, Float64Array);
    this.X = growArr(this.X, cap * 3, Float64Array);
    this.w = growArr(this.w, cap, Float64Array);
    this.m = growArr(this.m, cap, Float64Array);
    this.temp = growArr(this.temp, cap, Float32Array);
    this.glow = growArr(this.glow, cap, Float32Array);
    this.vPiece = growArr(this.vPiece, cap, Int32Array);
    this.alive = growArr(this.alive, cap, Uint8Array);
    this.vCap = cap;
  }

  _allocT(cap) {
    this.T = growArr(this.T, cap * 4, Int32Array);
    this.B = growArr(this.B, cap * 9, Float64Array);
    this.vol0 = growArr(this.vol0, cap, Float64Array);
    this.tPiece = growArr(this.tPiece, cap, Int32Array);
    this.tVS = growArr(this.tVS, cap, Float32Array);
    this.tMu = growArr(this.tMu, cap, Float32Array);
    this.tCap = cap;
  }

  ensureV(n) {
    if (n > this.vCap) this._allocV(Math.max(n, this.vCap * 2));
  }

  ensureT(n) {
    if (n > this.tCap) this._allocT(Math.max(n, this.tCap * 2));
  }

  addVertex(x, y, z, X, Y, Z, vx = 0, vy = 0, vz = 0, temp = 0) {
    const i = this.nV++;
    this.ensureV(this.nV);
    const o = i * 3;
    this.x[o] = x; this.x[o + 1] = y; this.x[o + 2] = z;
    this.px[o] = x; this.px[o + 1] = y; this.px[o + 2] = z;
    this.v[o] = vx; this.v[o + 1] = vy; this.v[o + 2] = vz;
    this.X[o] = X; this.X[o + 1] = Y; this.X[o + 2] = Z;
    this.temp[i] = temp;
    this.glow[i] = 0;
    this.alive[i] = 1;
    return i;
  }

  // ---------------------------------------------------------------- setup
  loadCube(ox = 0, oy = 0, oz = 0, yaw = 0) {
    const mesh = buildCubeMesh(this.p.res, this.p.size, this.p.bevel);
    this.hCell = mesh.h;
    this.nV = 0;
    this.ensureV(mesh.nV);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const half = this.p.size / 2;
    for (let i = 0; i < mesh.nV; i++) {
      const X = mesh.pos[i * 3], Y = mesh.pos[i * 3 + 1], Z = mesh.pos[i * 3 + 2];
      this.addVertex(ox + c * X + s * Z, oy + Y + half, oz - s * X + c * Z, X, Y, Z);
    }
    this.nT = mesh.nT;
    this.ensureT(this.nT);
    this.T.set(mesh.tets);
    this.tVS.fill(1, 0, this.nT);
    this.tMu.fill(1, 0, this.nT);
    this.embeds.length = 0;
    this.grab = null;
    this.rebuild();
  }

  // Recompute everything derived from topology.
  // Change material density live (re-lumps vertex masses).
  setDensity(d) {
    if (d === this.p.density) return;
    this.p.density = d;
    this._computeMass();
    for (const pc of this.pieces) {
      let m = 0;
      for (const i of pc.verts) m += this.m[i];
      pc.mass = m;
    }
    this.wakeAll();
  }

  wakeAll() {
    for (const pc of this.pieces) {
      pc.sleepT = 0;
      pc.asleep = false;
    }
  }

  wake(k) {
    const pc = this.pieces[k];
    if (pc) {
      pc.sleepT = 0;
      pc.asleep = false;
    }
  }

  rebuild() {
    this._computeRest();
    this._computeMass();
    this._buildAdjacency();
    this._buildPieces();
    this._extractSurface();
    this._buildRenderClusters();
    this.topoVersion++;
  }

  _computeRest(from = 0) {
    const { T, X, B, vol0 } = this;
    for (let t = from; t < this.nT; t++) {
      const o = t * 4;
      const a = T[o] * 3, b = T[o + 1] * 3, c = T[o + 2] * 3, d = T[o + 3] * 3;
      const m00 = X[b] - X[a], m10 = X[b + 1] - X[a + 1], m20 = X[b + 2] - X[a + 2];
      const m01 = X[c] - X[a], m11 = X[c + 1] - X[a + 1], m21 = X[c + 2] - X[a + 2];
      const m02 = X[d] - X[a], m12 = X[d + 1] - X[a + 1], m22 = X[d + 2] - X[a + 2];
      const det = m00 * (m11 * m22 - m12 * m21) - m01 * (m10 * m22 - m12 * m20) + m02 * (m10 * m21 - m11 * m20);
      const bo = t * 9;
      if (det <= 1e-14) {
        vol0[t] = 0;
        for (let k = 0; k < 9; k++) B[bo + k] = 0;
        continue;
      }
      const id = 1 / det;
      vol0[t] = det / 6;
      B[bo] = (m11 * m22 - m12 * m21) * id;
      B[bo + 1] = (m02 * m21 - m01 * m22) * id;
      B[bo + 2] = (m01 * m12 - m02 * m11) * id;
      B[bo + 3] = (m12 * m20 - m10 * m22) * id;
      B[bo + 4] = (m00 * m22 - m02 * m20) * id;
      B[bo + 5] = (m02 * m10 - m00 * m12) * id;
      B[bo + 6] = (m10 * m21 - m11 * m20) * id;
      B[bo + 7] = (m01 * m20 - m00 * m21) * id;
      B[bo + 8] = (m00 * m11 - m01 * m10) * id;
    }
  }

  _computeMass() {
    const { m, w, T, vol0, tVS } = this;
    const rho = this.p.density;
    m.fill(0, 0, this.nV);
    for (let t = 0; t < this.nT; t++) {
      const q = (rho * vol0[t] * tVS[t]) / 4;
      const o = t * 4;
      m[T[o]] += q; m[T[o + 1]] += q; m[T[o + 2]] += q; m[T[o + 3]] += q;
    }
    // floor tiny lumped masses (corner vertices of single tets jitter otherwise)
    let tot = 0, cnt = 0;
    for (let i = 0; i < this.nV; i++) if (m[i] > 0) { tot += m[i]; cnt++; }
    const mMin = cnt ? (0.3 * tot) / cnt : 0;
    for (let i = 0; i < this.nV; i++) {
      if (m[i] > 0) {
        if (m[i] < mMin) m[i] = mMin;
        w[i] = 1 / m[i];
        this.alive[i] = 1;
      } else {
        w[i] = 0;
        this.alive[i] = 0;
      }
    }
  }

  _buildAdjacency() {
    const nV = this.nV, nT = this.nT, T = this.T;
    const start = new Int32Array(nV + 1);
    for (let k = 0; k < nT * 4; k++) start[T[k] + 1]++;
    for (let i = 0; i < nV; i++) start[i + 1] += start[i];
    const fill = start.slice(0, nV);
    const list = new Int32Array(nT * 4);
    for (let t = 0; t < nT; t++) for (let k = 0; k < 4; k++) list[fill[T[t * 4 + k]]++] = t;
    this.vtStart = start;
    this.vtList = list;

    // vertex-vertex neighbours (for heat diffusion)
    const seen = new Int32Array(nV).fill(-1);
    const nbStart = new Int32Array(nV + 1);
    const tmp = [];
    for (let i = 0; i < nV; i++) {
      nbStart[i] = tmp.length;
      for (let k = start[i]; k < start[i + 1]; k++) {
        const t = list[k];
        for (let j = 0; j < 4; j++) {
          const u = T[t * 4 + j];
          if (u !== i && seen[u] !== i) {
            seen[u] = i;
            tmp.push(u);
          }
        }
      }
    }
    nbStart[nV] = tmp.length;
    this.nbStart = nbStart;
    this.nbList = Int32Array.from(tmp);
  }

  _buildPieces() {
    const nV = this.nV, nT = this.nT, T = this.T;
    const parent = new Int32Array(nV);
    for (let i = 0; i < nV; i++) parent[i] = i;
    const find = (a) => {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
      }
      return a;
    };
    for (let t = 0; t < nT; t++) {
      const r0 = find(T[t * 4]);
      for (let k = 1; k < 4; k++) {
        const r = find(T[t * 4 + k]);
        if (r !== r0) parent[r] = r0;
      }
    }
    const label = new Int32Array(nV).fill(-1);
    let K = 0;
    const pieceVerts = [];
    const pieceTets = [];
    for (let i = 0; i < nV; i++) {
      if (!this.alive[i]) {
        this.vPiece[i] = -1;
        continue;
      }
      const r = find(i);
      if (label[r] < 0) {
        label[r] = K++;
        pieceVerts.push([]);
        pieceTets.push([]);
      }
      this.vPiece[i] = label[r];
      pieceVerts[label[r]].push(i);
    }
    for (let t = 0; t < nT; t++) {
      const k = this.vPiece[T[t * 4]];
      this.tPiece[t] = k;
      pieceTets[k].push(t);
    }
    const old = this.pieces || [];
    this.pieces = pieceVerts.map((vs, k) => {
      let mass = 0, vol = 0;
      for (const i of vs) mass += this.m[i];
      for (const t of pieceTets[k]) vol += this.vol0[t] * this.tVS[t];
      return {
        id: k,
        verts: Int32Array.from(vs),
        tets: Int32Array.from(pieceTets[k]),
        mass,
        volume: vol,
        com: [0, 0, 0],
        vel: [0, 0, 0],
        bbox: [0, 0, 0, 0, 0, 0],
        sleepT: 0,
        asleep: false,
      };
    });
    // keep largest piece first for stable "main piece" semantics
    void old;
  }

  _extractSurface() {
    const { T, X } = this;
    const nT = this.nT;
    const K = this.nV + 1;
    const map = new Map();
    for (let t = 0; t < nT; t++) {
      if (this.vol0[t] <= 0) continue;
      for (let f = 0; f < 4; f++) {
        const a = T[t * 4 + FACES[f][0]], b = T[t * 4 + FACES[f][1]], c = T[t * 4 + FACES[f][2]];
        let lo = a, mid = b, hi = c, tt;
        if (lo > mid) { tt = lo; lo = mid; mid = tt; }
        if (mid > hi) { tt = mid; mid = hi; hi = tt; }
        if (lo > mid) { tt = lo; lo = mid; mid = tt; }
        const key = (lo * K + mid) * K + hi;
        if (map.has(key)) map.delete(key);
        else map.set(key, t * 4 + f);
      }
    }
    const nF = map.size;
    const sTri = new Int32Array(nF * 3);
    const sTet = new Int32Array(nF);
    const sTag = new Uint8Array(nF);
    const sRestN = new Float32Array(nF * 3);
    const half = this.p.size / 2, bevel = this.p.bevel;
    const nrm = [0, 0, 0];
    let f = 0;
    const tetBoundary = new Int32Array(nT).fill(-1); // first boundary face of tet (linked)
    const nextBoundary = new Int32Array(nF).fill(-1);
    for (const code of map.values()) {
      const t = code >> 2, lf = code & 3;
      const a = T[t * 4 + FACES[lf][0]], b = T[t * 4 + FACES[lf][1]], c = T[t * 4 + FACES[lf][2]];
      sTri[f * 3] = a; sTri[f * 3 + 1] = b; sTri[f * 3 + 2] = c;
      sTet[f] = t;
      nextBoundary[f] = tetBoundary[t];
      tetBoundary[t] = f;
      // rest normal & exterior classification
      const ax = X[a * 3], ay = X[a * 3 + 1], az = X[a * 3 + 2];
      const ux = X[b * 3] - ax, uy = X[b * 3 + 1] - ay, uz = X[b * 3 + 2] - az;
      const vx = X[c * 3] - ax, vy = X[c * 3 + 1] - ay, vz = X[c * 3 + 2] - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      sRestN[f * 3] = nx; sRestN[f * 3 + 1] = ny; sRestN[f * 3 + 2] = nz;
      const cx = (ax + X[b * 3] + X[c * 3]) / 3, cy = (ay + X[b * 3 + 1] + X[c * 3 + 1]) / 3, cz = (az + X[b * 3 + 2] + X[c * 3 + 2]) / 3;
      const sd = roundBoxSDF(cx, cy, cz, half, bevel);
      let tag = TAG_FRESH;
      if (Math.abs(sd) < 0.03 * this.p.size) {
        roundBoxNormal(cx, cy, cz, half, bevel, nrm);
        if (nx * nrm[0] + ny * nrm[1] + nz * nrm[2] > 0.55) tag = TAG_EXTERIOR;
      }
      sTag[f] = tag;
      f++;
    }
    this.nF = nF;
    this.sTri = sTri;
    this.sTet = sTet;
    this.sTag = sTag;
    this.sRestN = sRestN;
    this.tetBoundary = tetBoundary;
    this.nextBoundary = nextBoundary;
  }

  // Split surface vertices into render vertices by smoothing group: faces
  // around a vertex are smoothed together only if they share an edge, have
  // the same tag and their rest normals are within a crease angle.
  _buildRenderClusters() {
    const nF = this.nF, sTri = this.sTri, sTag = this.sTag, N = this.sRestN;
    const nV = this.nV;
    // vertex -> incident faces
    const start = new Int32Array(nV + 1);
    for (let k = 0; k < nF * 3; k++) start[sTri[k] + 1]++;
    for (let i = 0; i < nV; i++) start[i + 1] += start[i];
    const fill = start.slice(0, nV);
    const inc = new Int32Array(nF * 3); // encoded face*3+corner
    for (let f = 0; f < nF; f++) for (let c = 0; c < 3; c++) inc[fill[sTri[f * 3 + c]]++] = f * 3 + c;

    const cornerR = new Int32Array(nF * 3);
    const rSim = [];
    const rTag = [];
    const par = new Int32Array(64);
    const find = (a) => {
      while (par[a] !== a) {
        par[a] = par[par[a]];
        a = par[a];
      }
      return a;
    };
    for (let v = 0; v < nV; v++) {
      const s = start[v], e = start[v + 1], n = e - s;
      if (n === 0) continue;
      if (n > 64) {
        // pathological: one cluster
        const r = rSim.length;
        rSim.push(v);
        rTag.push(sTag[(inc[s] / 3) | 0]);
        for (let k = s; k < e; k++) cornerR[inc[k]] = r;
        continue;
      }
      for (let a = 0; a < n; a++) par[a] = a;
      for (let a = 0; a < n; a++) {
        const fa = (inc[s + a] / 3) | 0;
        const ca = inc[s + a] % 3;
        const a1 = sTri[fa * 3 + ((ca + 1) % 3)], a2 = sTri[fa * 3 + ((ca + 2) % 3)];
        for (let b = a + 1; b < n; b++) {
          const fb = (inc[s + b] / 3) | 0;
          if (sTag[fa] !== sTag[fb]) continue;
          const cb = inc[s + b] % 3;
          const b1 = sTri[fb * 3 + ((cb + 1) % 3)], b2 = sTri[fb * 3 + ((cb + 2) % 3)];
          if (!(a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2)) continue;
          const d = N[fa * 3] * N[fb * 3] + N[fa * 3 + 1] * N[fb * 3 + 1] + N[fa * 3 + 2] * N[fb * 3 + 2];
          const thr = sTag[fa] === TAG_EXTERIOR ? 0.45 : 0.82;
          if (d < thr) continue;
          const ra = find(a), rb = find(b);
          if (ra !== rb) par[rb] = ra;
        }
      }
      const rid = new Int32Array(n).fill(-1);
      for (let a = 0; a < n; a++) {
        const r = find(a);
        if (rid[r] < 0) {
          rid[r] = rSim.length;
          rSim.push(v);
          rTag.push(sTag[(inc[s + a] / 3) | 0]);
        }
        cornerR[inc[s + a]] = rid[r];
      }
    }
    // index buffer sorted by piece
    const order = Array.from({ length: nF }, (_, f) => f);
    const tp = this.tPiece, sTet = this.sTet;
    order.sort((a, b) => tp[sTet[a]] - tp[sTet[b]]);
    const rIndex = new Uint32Array(nF * 3);
    const ranges = this.pieces.map(() => ({ start: 0, count: 0 }));
    for (let k = 0; k < nF; k++) {
      const f = order[k];
      rIndex[k * 3] = cornerR[f * 3];
      rIndex[k * 3 + 1] = cornerR[f * 3 + 1];
      rIndex[k * 3 + 2] = cornerR[f * 3 + 2];
      const pc = tp[sTet[f]];
      if (ranges[pc].count === 0) ranges[pc].start = k * 3;
      ranges[pc].count += 3;
    }
    this.rCount = rSim.length;
    this.rSim = Int32Array.from(rSim);
    this.rTag = Uint8Array.from(rTag);
    this.rIndex = rIndex;
    this.rFaceOrder = Int32Array.from(order);
    this.pieceRanges = ranges;
  }

  // Fill render buffers (positions + smooth normals per render vertex).
  writeRender(pos, nrm, extra) {
    const x = this.x, rSim = this.rSim, rIndex = this.rIndex, n = this.rCount;
    for (let r = 0; r < n; r++) {
      const i = rSim[r] * 3;
      pos[r * 3] = x[i]; pos[r * 3 + 1] = x[i + 1]; pos[r * 3 + 2] = x[i + 2];
    }
    nrm.fill(0, 0, n * 3);
    const nI = this.nF * 3;
    for (let k = 0; k < nI; k += 3) {
      const a = rIndex[k], b = rIndex[k + 1], c = rIndex[k + 2];
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
      const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      nrm[a * 3] += nx; nrm[a * 3 + 1] += ny; nrm[a * 3 + 2] += nz;
      nrm[b * 3] += nx; nrm[b * 3 + 1] += ny; nrm[b * 3 + 2] += nz;
      nrm[c * 3] += nx; nrm[c * 3 + 1] += ny; nrm[c * 3 + 2] += nz;
    }
    for (let r = 0; r < n; r++) {
      const o = r * 3;
      const l = Math.hypot(nrm[o], nrm[o + 1], nrm[o + 2]);
      if (l > 0) {
        nrm[o] /= l; nrm[o + 1] /= l; nrm[o + 2] /= l;
      } else nrm[o + 1] = 1;
    }
    if (extra) {
      // extra: [temp, glow, fresh, piece] per render vertex
      const temp = this.temp, glow = this.glow, rTag = this.rTag;
      for (let r = 0; r < n; r++) {
        const i = rSim[r];
        extra[r * 4] = temp[i];
        extra[r * 4 + 1] = glow[i];
        extra[r * 4 + 2] = rTag[r] === TAG_EXTERIOR ? 0 : 1;
        extra[r * 4 + 3] = this.X[i * 3 + 1];
      }
    }
  }

  // ---------------------------------------------------------------- dynamics
  step(dt) {
    const P = this.p;
    const nS = P.substeps;
    const h = dt / nS;
    this.time += dt;
    this.impacts.length = 0;
    this._updateMaterial(dt);
    if (this.grab) this.wake(this.grab.piece);
    if (this.attract || this.gravityScale !== 1 || this.embeds.length) this.wakeAll();
    const NP = this.pieces.length;
    const aw = this._awake && this._awake.length >= NP ? this._awake : (this._awake = new Uint8Array(Math.max(NP, 64)));
    let anyAwake = false;
    for (let k = 0; k < NP; k++) {
      aw[k] = this.pieces[k].asleep ? 0 : 1;
      if (aw[k]) anyAwake = true;
    }
    this.anyAwake = anyAwake;
    if (!anyAwake) {
      this._dampPieces(dt);
      return;
    }
    this._frameDt = dt;
    const multi = this.pieces.length > 1 && P.collide && this.collisionsEnabled;
    if (multi) this._buildCollisionHash();
    for (let s = 0; s < nS; s++) {
      this._integrate(h);
      this._solveTets(h);
      if (this.embeds.length) this._solveEmbeds(h);
      if (this.grab) this._solveGrab(h);
      if (this.attract) this._solveAttract(h);
      if (multi && this._anyContact) this._solvePieceCollisions();
      this._solveBounds(h, s === nS - 1);
      this._updateVelocities(h);
    }
    this._dampPieces(dt);
  }

  _integrate(h) {
    const { x, px, v, w } = this;
    const g = this.p.gravity * this.gravityScale * h;
    const n = this.nV;
    const aw = this._awake, vp = this.vPiece;
    for (let i = 0; i < n; i++) {
      if (w[i] === 0 || !aw[vp[i]]) continue;
      const o = i * 3;
      v[o + 1] += g;
      px[o] = x[o]; px[o + 1] = x[o + 1]; px[o + 2] = x[o + 2];
      x[o] += v[o] * h; x[o + 1] += v[o + 1] * h; x[o + 2] += v[o + 2] * h;
    }
  }

  _solveTets(h) {
    const { T, B, vol0, x, w, tMu, tVS } = this;
    const mu0 = this.p.mu;
    const lam = mu0 * this.p.lambdaRatio;
    const ih2 = 1 / (h * h);
    const nT = this.nT;
    const aw = this._awake, tp = this.tPiece;
    for (let t = 0; t < nT; t++) {
      const V0 = vol0[t];
      if (V0 <= 0 || !aw[tp[t]]) continue;
      const t4 = t * 4;
      const a = T[t4], b = T[t4 + 1], c = T[t4 + 2], d = T[t4 + 3];
      const i0 = a * 3, i1 = b * 3, i2 = c * 3, i3 = d * 3;
      const w0 = w[a], w1 = w[b], w2 = w[c], w3 = w[d];
      const vs = tVS[t];
      const sc = vs === 1 ? 1 : 1 / Math.cbrt(vs);
      const bo = t * 9;
      const b00 = B[bo] * sc, b01 = B[bo + 1] * sc, b02 = B[bo + 2] * sc;
      const b10 = B[bo + 3] * sc, b11 = B[bo + 4] * sc, b12 = B[bo + 5] * sc;
      const b20 = B[bo + 6] * sc, b21 = B[bo + 7] * sc, b22 = B[bo + 8] * sc;
      const V = V0 * vs;
      const mu = mu0 * tMu[t];

      // ---- deviatoric: C = sqrt(tr(F^T F))
      let e1x = x[i1] - x[i0], e1y = x[i1 + 1] - x[i0 + 1], e1z = x[i1 + 2] - x[i0 + 2];
      let e2x = x[i2] - x[i0], e2y = x[i2 + 1] - x[i0 + 1], e2z = x[i2 + 2] - x[i0 + 2];
      let e3x = x[i3] - x[i0], e3y = x[i3 + 1] - x[i0 + 1], e3z = x[i3 + 2] - x[i0 + 2];
      let f00 = e1x * b00 + e2x * b10 + e3x * b20, f01 = e1x * b01 + e2x * b11 + e3x * b21, f02 = e1x * b02 + e2x * b12 + e3x * b22;
      let f10 = e1y * b00 + e2y * b10 + e3y * b20, f11 = e1y * b01 + e2y * b11 + e3y * b21, f12 = e1y * b02 + e2y * b12 + e3y * b22;
      let f20 = e1z * b00 + e2z * b10 + e3z * b20, f21 = e1z * b01 + e2z * b11 + e3z * b21, f22 = e1z * b02 + e2z * b12 + e3z * b22;
      let C = Math.sqrt(f00 * f00 + f01 * f01 + f02 * f02 + f10 * f10 + f11 * f11 + f12 * f12 + f20 * f20 + f21 * f21 + f22 * f22);
      if (C > 1e-9 && mu > 0) {
        const ic = 1 / C;
        const g1x = (f00 * b00 + f01 * b01 + f02 * b02) * ic, g1y = (f10 * b00 + f11 * b01 + f12 * b02) * ic, g1z = (f20 * b00 + f21 * b01 + f22 * b02) * ic;
        const g2x = (f00 * b10 + f01 * b11 + f02 * b12) * ic, g2y = (f10 * b10 + f11 * b11 + f12 * b12) * ic, g2z = (f20 * b10 + f21 * b11 + f22 * b12) * ic;
        const g3x = (f00 * b20 + f01 * b21 + f02 * b22) * ic, g3y = (f10 * b20 + f11 * b21 + f12 * b22) * ic, g3z = (f20 * b20 + f21 * b21 + f22 * b22) * ic;
        const g0x = -g1x - g2x - g3x, g0y = -g1y - g2y - g3y, g0z = -g1z - g2z - g3z;
        const alpha = ih2 / (mu * V);
        const den = w0 * (g0x * g0x + g0y * g0y + g0z * g0z) + w1 * (g1x * g1x + g1y * g1y + g1z * g1z) +
          w2 * (g2x * g2x + g2y * g2y + g2z * g2z) + w3 * (g3x * g3x + g3y * g3y + g3z * g3z) + alpha;
        const dl = -C / den;
        let s = w0 * dl; x[i0] += g0x * s; x[i0 + 1] += g0y * s; x[i0 + 2] += g0z * s;
        s = w1 * dl; x[i1] += g1x * s; x[i1 + 1] += g1y * s; x[i1 + 2] += g1z * s;
        s = w2 * dl; x[i2] += g2x * s; x[i2 + 1] += g2y * s; x[i2 + 2] += g2z * s;
        s = w3 * dl; x[i3] += g3x * s; x[i3 + 1] += g3y * s; x[i3 + 2] += g3z * s;
      }

      // ---- hydrostatic: C = det(F) - gamma
      e1x = x[i1] - x[i0]; e1y = x[i1 + 1] - x[i0 + 1]; e1z = x[i1 + 2] - x[i0 + 2];
      e2x = x[i2] - x[i0]; e2y = x[i2 + 1] - x[i0 + 1]; e2z = x[i2 + 2] - x[i0 + 2];
      e3x = x[i3] - x[i0]; e3y = x[i3 + 1] - x[i0 + 1]; e3z = x[i3 + 2] - x[i0 + 2];
      f00 = e1x * b00 + e2x * b10 + e3x * b20; f01 = e1x * b01 + e2x * b11 + e3x * b21; f02 = e1x * b02 + e2x * b12 + e3x * b22;
      f10 = e1y * b00 + e2y * b10 + e3y * b20; f11 = e1y * b01 + e2y * b11 + e3y * b21; f12 = e1y * b02 + e2y * b12 + e3y * b22;
      f20 = e1z * b00 + e2z * b10 + e3z * b20; f21 = e1z * b01 + e2z * b11 + e3z * b21; f22 = e1z * b02 + e2z * b12 + e3z * b22;
      // columns of F: c0=(f00,f10,f20) c1=(f01,f11,f21) c2=(f02,f12,f22)
      // cofactor columns: k0 = c1 x c2, k1 = c2 x c0, k2 = c0 x c1
      const k0x = f11 * f22 - f21 * f12, k0y = f21 * f02 - f01 * f22, k0z = f01 * f12 - f11 * f02;
      const k1x = f12 * f20 - f22 * f10, k1y = f22 * f00 - f02 * f20, k1z = f02 * f10 - f12 * f00;
      const k2x = f10 * f21 - f20 * f11, k2y = f20 * f01 - f00 * f21, k2z = f00 * f11 - f10 * f01;
      const J = f00 * k0x + f10 * k0y + f20 * k0z;
      const gamma = 1 + mu / lam;
      C = J - gamma;
      {
        const g1x = k0x * b00 + k1x * b01 + k2x * b02, g1y = k0y * b00 + k1y * b01 + k2y * b02, g1z = k0z * b00 + k1z * b01 + k2z * b02;
        const g2x = k0x * b10 + k1x * b11 + k2x * b12, g2y = k0y * b10 + k1y * b11 + k2y * b12, g2z = k0z * b10 + k1z * b11 + k2z * b12;
        const g3x = k0x * b20 + k1x * b21 + k2x * b22, g3y = k0y * b20 + k1y * b21 + k2y * b22, g3z = k0z * b20 + k1z * b21 + k2z * b22;
        const g0x = -g1x - g2x - g3x, g0y = -g1y - g2y - g3y, g0z = -g1z - g2z - g3z;
        // compression barrier: below ~1/3 volume the tet resists ever harder
        let alpha = ih2 / (lam * V);
        if (J < 0.35) {
          const q = Math.max(J / 0.35, 0.25);
          alpha *= q * q;
        }
        const den = w0 * (g0x * g0x + g0y * g0y + g0z * g0z) + w1 * (g1x * g1x + g1y * g1y + g1z * g1z) +
          w2 * (g2x * g2x + g2y * g2y + g2z * g2z) + w3 * (g3x * g3x + g3y * g3y + g3z * g3z) + alpha;
        if (den > 1e-12) {
          const dl = -C / den;
          let s = w0 * dl; x[i0] += g0x * s; x[i0 + 1] += g0y * s; x[i0 + 2] += g0z * s;
          s = w1 * dl; x[i1] += g1x * s; x[i1 + 1] += g1y * s; x[i1 + 2] += g1z * s;
          s = w2 * dl; x[i2] += g2x * s; x[i2 + 1] += g2y * s; x[i2 + 2] += g2z * s;
          s = w3 * dl; x[i3] += g3x * s; x[i3 + 1] += g3y * s; x[i3 + 2] += g3z * s;
        }
      }
    }
  }

  _solveGrab(h) {
    const g = this.grab;
    const { x, w } = this;
    const ih2 = 1 / (h * h);
    for (let j = 0; j < g.n; j++) {
      const i = g.idx[j];
      const wi = w[i];
      if (wi === 0) continue;
      const o = i * 3;
      const tx = g.tx + g.off[j * 3], ty = g.ty + g.off[j * 3 + 1], tz = g.tz + g.off[j * 3 + 2];
      const alpha = (g.compliance / g.wt[j]) * ih2;
      const k = wi / (wi + alpha);
      x[o] += (tx - x[o]) * k;
      x[o + 1] += (ty - x[o + 1]) * k;
      x[o + 2] += (tz - x[o + 2]) * k;
    }
  }

  _solveAttract(h) {
    const at = this.attract;
    const { x, w } = this;
    const k = 1 - Math.exp(-at.rate * h);
    const tg = at.targets;
    const n = Math.min(this.nV, at.n);
    for (let i = 0; i < n; i++) {
      if (w[i] === 0) continue;
      const o = i * 3;
      x[o] += (tg[o] - x[o]) * k;
      x[o + 1] += (tg[o + 1] - x[o + 1]) * k;
      x[o + 2] += (tg[o + 2] - x[o + 2]) * k;
    }
  }

  // Embedded rigid segments (nails): keep the distance between two anchors
  // (barycentric points inside tets) fixed.
  _solveEmbeds(h) {
    const { x, w, T } = this;
    for (const e of this.embeds) {
      const A = e.a, Bn = e.b;
      if (A.tet < 0 || Bn.tet < 0 || A.tet >= this.nT || Bn.tet >= this.nT) continue;
      const ta = A.tet * 4, tb = Bn.tet * 4;
      let ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0;
      let wa = 0, wb = 0;
      for (let k = 0; k < 4; k++) {
        const ia = T[ta + k], ib = T[tb + k];
        const ba = A.b[k], bb = Bn.b[k];
        ax += x[ia * 3] * ba; ay += x[ia * 3 + 1] * ba; az += x[ia * 3 + 2] * ba;
        bx += x[ib * 3] * bb; by += x[ib * 3 + 1] * bb; bz += x[ib * 3 + 2] * bb;
        wa += ba * ba * w[ia];
        wb += bb * bb * w[ib];
      }
      let dx = bx - ax, dy = by - ay, dz = bz - az;
      const L = Math.hypot(dx, dy, dz);
      if (L < 1e-9) continue;
      dx /= L; dy /= L; dz /= L;
      const C = L - e.len;
      const den = wa + wb + (e.compliance || 0) / (h * h);
      if (den <= 0) continue;
      const dl = -C / den;
      for (let k = 0; k < 4; k++) {
        const ia = T[ta + k], ib = T[tb + k];
        const sa = -dl * A.b[k] * w[ia];
        const sb = dl * Bn.b[k] * w[ib];
        x[ia * 3] += dx * sa; x[ia * 3 + 1] += dy * sa; x[ia * 3 + 2] += dz * sa;
        x[ib * 3] += dx * sb; x[ib * 3 + 1] += dy * sb; x[ib * 3 + 2] += dz * sb;
      }
    }
  }

  // External point force on an anchor (e.g. magnet pulling a nail).
  pushAnchor(a, fx, fy, fz, dt) {
    if (!a || a.tet < 0 || a.tet >= this.nT) return;
    this.wake(this.tPiece[a.tet]);
    const { v, T } = this;
    for (let k = 0; k < 4; k++) {
      const i = T[a.tet * 4 + k];
      const s = a.b[k] * this.w[i] * dt;
      v[i * 3] += fx * s; v[i * 3 + 1] += fy * s; v[i * 3 + 2] += fz * s;
    }
  }

  _solveBounds(h, last) {
    const { x, px, w } = this;
    const mu = this.p.friction;

    const R = this.p.arenaRadius, R2 = R * R;
    const top = this.p.ceiling;
    const n = this.nV;
    const aw = this._awake, vp = this.vPiece;
    for (let i = 0; i < n; i++) {
      if (w[i] === 0 || !aw[vp[i]]) continue;
      const o = i * 3;
      let y = x[o + 1];
      if (y < 0) {
        const pen = -y;
        x[o + 1] = 0;
        const dx = x[o] - px[o], dz = x[o + 2] - px[o + 2];
        const d = Math.hypot(dx, dz);
        if (d < mu * pen * 1.4) {
          x[o] = px[o];
          x[o + 2] = px[o + 2];
        } else if (d > 0) {
          const k = Math.min((mu * pen) / d, 1);
          x[o] -= dx * k;
          x[o + 2] -= dz * k;
        }
        if (last) {
          const vy = (px[o + 1] - y) / h;
          if (vy > 2.5) this.impacts.push(x[o], 0, x[o + 2], vy, this.vPiece[i]);
        }
      } else if (y > top) x[o + 1] = top;
      const r2 = x[o] * x[o] + x[o + 2] * x[o + 2];
      if (r2 > R2) {
        const r = Math.sqrt(r2);
        const s = R / r;
        const nx = x[o] / r, nz = x[o + 2] / r;
        x[o] *= s;
        x[o + 2] *= s;
        // tangential friction against the wall
        const dx = x[o] - px[o], dy = x[o + 1] - px[o + 1], dz = x[o + 2] - px[o + 2];
        const dn = dx * nx + dz * nz;
        const tx = dx - dn * nx, tz = dz - dn * nz;
        const pen = r - R;
        const tl = Math.hypot(tx, dy, tz);
        if (tl > 0) {
          const k = Math.min((0.4 * pen) / tl, 1);
          x[o] -= tx * k;
          x[o + 1] -= dy * k;
          x[o + 2] -= tz * k;
        }
        if (last && pen / h > 3) this.impacts.push(x[o], x[o + 1], x[o + 2], pen / h, this.vPiece[i]);
      }
    }
  }

  _updateVelocities(h) {
    const { x, px, v, w } = this;
    const ih = 1 / h;
    const n = this.nV;
    const vmax = this.p.maxSpeed, vmax2 = vmax * vmax;
    const aw = this._awake, vp = this.vPiece;
    for (let i = 0; i < n; i++) {
      if (w[i] === 0 || !aw[vp[i]]) continue;
      const o = i * 3;
      let vx = (x[o] - px[o]) * ih, vy = (x[o + 1] - px[o + 1]) * ih, vz = (x[o + 2] - px[o + 2]) * ih;
      const s2 = vx * vx + vy * vy + vz * vz;
      if (s2 > vmax2) {
        const k = vmax / Math.sqrt(s2);
        vx *= k; vy *= k; vz *= k;
      }
      v[o] = vx; v[o + 1] = vy; v[o + 2] = vz;
    }
  }

  // Damp deviation from rigid motion per piece (keeps throws ballistic).
  _dampPieces(dt) {
    const { x, v, m } = this;
    const kd = 1 - Math.exp(-this.p.damping * dt * (this.dampBoost || 1));
    const air = Math.exp(-this.p.airDrag * dt);
    for (const pc of this.pieces) {
      const vs = pc.verts;
      let M = 0, cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < vs.length; k++) {
        const i = vs[k], o = i * 3, mi = m[i];
        M += mi;
        cx += x[o] * mi; cy += x[o + 1] * mi; cz += x[o + 2] * mi;
        vx += v[o] * mi; vy += v[o + 1] * mi; vz += v[o + 2] * mi;
        if (x[o] < x0) x0 = x[o];
        if (x[o] > x1) x1 = x[o];
        if (x[o + 1] < y0) y0 = x[o + 1];
        if (x[o + 1] > y1) y1 = x[o + 1];
        if (x[o + 2] < z0) z0 = x[o + 2];
        if (x[o + 2] > z1) z1 = x[o + 2];
      }
      if (M <= 0) continue;
      cx /= M; cy /= M; cz /= M; vx /= M; vy /= M; vz /= M;
      pc.com[0] = cx; pc.com[1] = cy; pc.com[2] = cz;
      pc.vel[0] = vx; pc.vel[1] = vy; pc.vel[2] = vz;
      pc.bbox[0] = x0; pc.bbox[1] = y0; pc.bbox[2] = z0; pc.bbox[3] = x1; pc.bbox[4] = y1; pc.bbox[5] = z1;
      // Bounciness: remember the impact speed while a piece squashes against
      // the floor/wall; for a short window after the squash, set its rebound
      // to exactly e x the impact speed (0 = splat, 0.95 = super ball).
      const e = this.p.bounce;
      if (e >= 0 && !pc.asleep) {
        if (y0 < 0.02 && vy < -1.2 && !pc.rebT) pc.impY = Math.min(pc.impY || 0, vy);
        if (pc.impY && !pc.rebT && vy > -0.25) pc.rebT = 0.22;
        if (pc.rebT) {
          const want = -pc.impY * e;
          const dv = want - vy;
          if ((dv > 0 && !pc.boosted) || dv < 0) {
            for (let k = 0; k < vs.length; k++) v[vs[k] * 3 + 1] += dv;
            vy = want;
            if (dv > 0) pc.boosted = true;
          }
          pc.rebT -= dt;
          if (pc.rebT <= 0) {
            pc.rebT = 0;
            pc.impY = 0;
            pc.boosted = false;
          }
        }
        const rc = Math.hypot(cx, cz) || 1;
        const ux = cx / rc, uz = cz / rc;
        const rmax = Math.max(Math.hypot(x0, z0), Math.hypot(x1, z0), Math.hypot(x0, z1), Math.hypot(x1, z1));
        const vr = vx * ux + vz * uz;
        if (rmax > this.p.arenaRadius - 0.03 && vr > 1.2 && !pc.rebR) {
          pc.impR = Math.max(pc.impR || 0, vr);
          pc.impUx = ux;
          pc.impUz = uz;
        }
        if (pc.impR && !pc.rebR && vr < 0.25) pc.rebR = 0.22;
        if (pc.rebR) {
          const want = -pc.impR * e;
          const cur = vx * pc.impUx + vz * pc.impUz;
          const dv = want - cur;
          if ((dv < 0 && !pc.boostedR) || dv > 0) {
            for (let k = 0; k < vs.length; k++) {
              v[vs[k] * 3] += pc.impUx * dv;
              v[vs[k] * 3 + 2] += pc.impUz * dv;
            }
            vx += pc.impUx * dv;
            vz += pc.impUz * dv;
            if (dv < 0) pc.boostedR = true;
          }
          pc.rebR -= dt;
          if (pc.rebR <= 0) {
            pc.rebR = 0;
            pc.impR = 0;
            pc.boostedR = false;
          }
        }
      }
      // angular momentum and inertia
      let Lx = 0, Ly = 0, Lz = 0;
      let Ixx = 0, Iyy = 0, Izz = 0, Ixy = 0, Ixz = 0, Iyz = 0;
      for (let k = 0; k < vs.length; k++) {
        const i = vs[k], o = i * 3, mi = m[i];
        const rx = x[o] - cx, ry = x[o + 1] - cy, rz = x[o + 2] - cz;
        const ux = v[o] - vx, uy = v[o + 1] - vy, uz = v[o + 2] - vz;
        Lx += (ry * uz - rz * uy) * mi;
        Ly += (rz * ux - rx * uz) * mi;
        Lz += (rx * uy - ry * ux) * mi;
        Ixx += (ry * ry + rz * rz) * mi;
        Iyy += (rx * rx + rz * rz) * mi;
        Izz += (rx * rx + ry * ry) * mi;
        Ixy -= rx * ry * mi;
        Ixz -= rx * rz * mi;
        Iyz -= ry * rz * mi;
      }
      // invert inertia (symmetric 3x3)
      const A = Iyy * Izz - Iyz * Iyz, Bc = Ixz * Iyz - Ixy * Izz, Cc = Ixy * Iyz - Ixz * Iyy;
      const det = Ixx * A + Ixy * Bc + Ixz * Cc;
      let wx = 0, wy = 0, wz = 0;
      if (Math.abs(det) > 1e-14) {
        const id = 1 / det;
        const i00 = A * id, i01 = Bc * id, i02 = Cc * id;
        const i11 = (Ixx * Izz - Ixz * Ixz) * id, i12 = (Ixy * Ixz - Ixx * Iyz) * id, i22 = (Ixx * Iyy - Ixy * Ixy) * id;
        wx = i00 * Lx + i01 * Ly + i02 * Lz;
        wy = i01 * Lx + i11 * Ly + i12 * Lz;
        wz = i02 * Lx + i12 * Ly + i22 * Lz;
      }
      pc.omega = [wx, wy, wz];
      if (pc.asleep) continue;
      let vmax2 = 0, e2 = 0;
      for (let k = 0; k < vs.length; k++) {
        const o = vs[k] * 3;
        const s2 = v[o] * v[o] + v[o + 1] * v[o + 1] + v[o + 2] * v[o + 2];
        if (s2 > vmax2) vmax2 = s2;
        e2 += s2 * m[vs[k]];
      }
      const vrms2 = e2 / M;
      if (vrms2 < 0.035 * 0.035 && vmax2 < 0.3 * 0.3) {
        pc.sleepT += dt;
        if (pc.sleepT > 0.6) {
          pc.asleep = true;
          for (let k = 0; k < vs.length; k++) {
            const o = vs[k] * 3;
            v[o] = v[o + 1] = v[o + 2] = 0;
          }
          continue;
        }
      } else pc.sleepT = 0;
      for (let k = 0; k < vs.length; k++) {
        const i = vs[k], o = i * 3;
        const rx = x[o] - cx, ry = x[o + 1] - cy, rz = x[o + 2] - cz;
        const rvx = vx + wy * rz - wz * ry, rvy = vy + wz * rx - wx * rz, rvz = vz + wx * ry - wy * rx;
        v[o] = (rvx + (v[o] - rvx) * (1 - kd)) * air;
        v[o + 1] = (rvy + (v[o + 1] - rvy) * (1 - kd)) * air;
        v[o + 2] = (rvz + (v[o + 2] - rvz) * (1 - kd)) * air;
      }
    }
  }

  // Temperature -> material: hot softens, cold stiffens. Heat diffuses.
  _updateMaterial(dt) {
    const { temp, T, tMu } = this;
    const nV = this.nV;
    if (this.heatActive || this._heatResidual > 0) {
      // diffusion (Jacobi, one sweep)
      const nbS = this.nbStart, nbL = this.nbList;
      const k = Math.min(1, 1.6 * dt);
      const relax = Math.exp(-dt / 22);
      let maxAbs = 0;
      const nt = this._tmpTemp && this._tmpTemp.length >= nV ? this._tmpTemp : (this._tmpTemp = new Float32Array(this.vCap));
      for (let i = 0; i < nV; i++) {
        const s = nbS[i], e = nbS[i + 1];
        let sum = 0;
        for (let j = s; j < e; j++) sum += temp[nbL[j]];
        const avg = e > s ? sum / (e - s) : temp[i];
        nt[i] = (temp[i] + (avg - temp[i]) * k) * relax;
      }
      for (let i = 0; i < nV; i++) {
        temp[i] = Math.abs(nt[i]) < 1e-3 ? 0 : nt[i];
        const a = Math.abs(temp[i]);
        if (a > maxAbs) maxAbs = a;
      }
      this._heatResidual = maxAbs;
      this.heatActive = false;
      if (maxAbs > 0.05) this.wakeAll();
      for (let t = 0; t < this.nT; t++) {
        const o = t * 4;
        const tt = (temp[T[o]] + temp[T[o + 1]] + temp[T[o + 2]] + temp[T[o + 3]]) * 0.25;
        tMu[t] = tt >= 0 ? Math.max(0.035, Math.exp(-3.2 * tt)) : 1 + 14 * Math.min(1, -tt) * Math.min(1, -tt);
      }
    }
    // glow decays
    const gd = Math.exp(-dt * 1.6);
    for (let i = 0; i < nV; i++) if (this.glow[i] > 0.001) this.glow[i] *= gd;
    else this.glow[i] = 0;
  }

  // ---------------------------------------------------------------- piece contact
  _buildCollisionHash() {
    const cs = this.hCell * 1.25;
    this._cs = cs;
    const { x, T } = this;
    const nT = this.nT;
    // which pieces could touch another piece this frame (AABB overlap)
    const P = this.pieces.length;
    const bb = new Float64Array(P * 6);
    for (let k = 0; k < P; k++) {
      bb[k * 6] = bb[k * 6 + 1] = bb[k * 6 + 2] = Infinity;
      bb[k * 6 + 3] = bb[k * 6 + 4] = bb[k * 6 + 5] = -Infinity;
    }
    for (let i = 0; i < this.nV; i++) {
      const k = this.vPiece[i];
      if (k < 0) continue;
      const o = i * 3, b = k * 6;
      if (x[o] < bb[b]) bb[b] = x[o];
      if (x[o + 1] < bb[b + 1]) bb[b + 1] = x[o + 1];
      if (x[o + 2] < bb[b + 2]) bb[b + 2] = x[o + 2];
      if (x[o] > bb[b + 3]) bb[b + 3] = x[o];
      if (x[o + 1] > bb[b + 4]) bb[b + 4] = x[o + 1];
      if (x[o + 2] > bb[b + 5]) bb[b + 5] = x[o + 2];
    }
    const act = this._pieceActive && this._pieceActive.length >= P ? this._pieceActive : (this._pieceActive = new Uint8Array(Math.max(P, 64)));
    act.fill(0);
    // margin covers this frame's travel, so fast pieces start colliding before they overlap
    let vmax2 = 0;
    const v = this.v;
    for (let i = 0; i < this.nV; i++) {
      const o = i * 3;
      const s2 = v[o] * v[o] + v[o + 1] * v[o + 1] + v[o + 2] * v[o + 2];
      if (s2 > vmax2) vmax2 = s2;
    }
    const m = 0.03 + 2.2 * Math.sqrt(vmax2) * (this._frameDt || 1 / 60);
    let anyAct = false;
    for (let a = 0; a < P; a++)
      for (let b = a + 1; b < P; b++) {
        const A = a * 6, B = b * 6;
        if (bb[A] - m > bb[B + 3] || bb[B] - m > bb[A + 3] || bb[A + 1] - m > bb[B + 4] || bb[B + 1] - m > bb[A + 4] || bb[A + 2] - m > bb[B + 5] || bb[B + 2] - m > bb[A + 5]) continue;
        act[a] = act[b] = 1;
        anyAct = true;
      }
    this._anyContact = anyAct;
    const size = 1 << 15;
    const mask = size - 1;
    const counts = this._hCount && this._hCount.length === size + 1 ? this._hCount : (this._hCount = new Int32Array(size + 1));
    counts.fill(0);
    const ranges = this._hRanges && this._hRanges.length >= nT * 6 ? this._hRanges : (this._hRanges = new Int32Array(this.tCap * 6));
    const inv = 1 / cs;
    let total = 0;
    for (let t = 0; t < nT; t++) {
      const o = t * 4;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < 4; k++) {
        const i = T[o + k] * 3;
        const a = x[i], b = x[i + 1], c = x[i + 2];
        if (a < x0) x0 = a;
        if (a > x1) x1 = a;
        if (b < y0) y0 = b;
        if (b > y1) y1 = b;
        if (c < z0) z0 = c;
        if (c > z1) z1 = c;
      }
      const ix0 = Math.floor(x0 * inv), ix1 = Math.floor(x1 * inv);
      const iy0 = Math.floor(y0 * inv), iy1 = Math.floor(y1 * inv);
      const iz0 = Math.floor(z0 * inv), iz1 = Math.floor(z1 * inv);
      const r = t * 6;
      ranges[r] = ix0; ranges[r + 1] = ix1; ranges[r + 2] = iy0; ranges[r + 3] = iy1; ranges[r + 4] = iz0; ranges[r + 5] = iz1;
      if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) * (iz1 - iz0 + 1) > 64 || this.tetBoundary[t] < 0 || !act[this.tPiece[t]]) {
        ranges[r] = 1; ranges[r + 1] = 0; // skip huge or interior tets
        continue;
      }
      for (let ix = ix0; ix <= ix1; ix++)
        for (let iy = iy0; iy <= iy1; iy++)
          for (let iz = iz0; iz <= iz1; iz++) {
            counts[(((ix * 92837111) ^ (iy * 689287499) ^ (iz * 283923481)) & mask) + 1]++;
            total++;
          }
    }
    for (let k = 0; k < size; k++) counts[k + 1] += counts[k];
    const entries = this._hEntries && this._hEntries.length >= total ? this._hEntries : (this._hEntries = new Int32Array(Math.max(total, 1024) * 2));
    const fill = this._hFill && this._hFill.length === size ? this._hFill : (this._hFill = new Int32Array(size));
    fill.set(counts.subarray(0, size));
    for (let t = 0; t < nT; t++) {
      const r = t * 6;
      if (ranges[r] > ranges[r + 1]) continue;
      for (let ix = ranges[r]; ix <= ranges[r + 1]; ix++)
        for (let iy = ranges[r + 2]; iy <= ranges[r + 3]; iy++)
          for (let iz = ranges[r + 4]; iz <= ranges[r + 5]; iz++) {
            const hsh = ((ix * 92837111) ^ (iy * 689287499) ^ (iz * 283923481)) & mask;
            entries[fill[hsh]++] = t;
          }
    }
    this._hMask = mask;
    // candidate vertices: surface vertices whose piece bbox overlaps another piece
    if (!this._surfVerts || this._surfVertsVersion !== this.topoVersion) {
      const seen = new Uint8Array(this.nV);
      const list = [];
      for (let k = 0; k < this.nF * 3; k++) {
        const i = this.sTri[k];
        if (!seen[i]) {
          seen[i] = 1;
          list.push(i);
        }
      }
      this._surfVerts = Int32Array.from(list);
      this._surfVertsVersion = this.topoVersion;
    }
  }

  _solvePieceCollisions() {
    const { x, w, T, vPiece, tPiece } = this;
    const inv = 1 / this._cs, mask = this._hMask;
    const counts = this._hCount, entries = this._hEntries;
    const sv = this._surfVerts;
    const sTri = this.sTri;
    const margin = this.contactMargin ?? 0;
    const act = this._pieceActive;
    for (let q = 0; q < sv.length; q++) {
      const i = sv[q];
      if (!act[vPiece[i]]) continue;
      const o = i * 3;
      const px = x[o], py = x[o + 1], pz = x[o + 2];
      const ix = Math.floor(px * inv), iy = Math.floor(py * inv), iz = Math.floor(pz * inv);
      const hsh = ((ix * 92837111) ^ (iy * 689287499) ^ (iz * 283923481)) & mask;
      const pi = vPiece[i];
      for (let e = counts[hsh]; e < counts[hsh + 1]; e++) {
        const t = entries[e];
        if (tPiece[t] === pi) continue;
        const t4 = t * 4;
        const a = T[t4] * 3, b = T[t4 + 1] * 3, c = T[t4 + 2] * 3, d = T[t4 + 3] * 3;
        // barycentric test
        const e1x = x[b] - x[a], e1y = x[b + 1] - x[a + 1], e1z = x[b + 2] - x[a + 2];
        const e2x = x[c] - x[a], e2y = x[c + 1] - x[a + 1], e2z = x[c + 2] - x[a + 2];
        const e3x = x[d] - x[a], e3y = x[d + 1] - x[a + 1], e3z = x[d + 2] - x[a + 2];
        const det = e1x * (e2y * e3z - e2z * e3y) - e2x * (e1y * e3z - e1z * e3y) + e3x * (e1y * e2z - e1z * e2y);
        if (det <= 1e-15) continue;
        const rx = px - x[a], ry = py - x[a + 1], rz = pz - x[a + 2];
        const id = 1 / det;
        const l1 = (rx * (e2y * e3z - e2z * e3y) - e2x * (ry * e3z - rz * e3y) + e3x * (ry * e2z - rz * e2y)) * id;
        if (l1 < 0) continue;
        const l2 = (e1x * (ry * e3z - rz * e3y) - rx * (e1y * e3z - e1z * e3y) + e3x * (e1y * rz - e1z * ry)) * id;
        if (l2 < 0) continue;
        const l3 = (e1x * (e2y * rz - e2z * ry) - e2x * (e1y * rz - e1z * ry) + rx * (e1y * e2z - e1z * e2y)) * id;
        if (l3 < 0 || l1 + l2 + l3 > 1) continue;
        // inside: push out through the boundary face the vertex came in
        // through this substep (falls back to the closest boundary face)
        let best = -1, bestD = Infinity, bnx = 0, bny = 0, bnz = 0;
        let cross = -1, crossD = Infinity, cnx = 0, cny = 0, cnz = 0;
        const qx = this.px[o], qy = this.px[o + 1], qz = this.px[o + 2];
        for (let f = this.tetBoundary[t]; f >= 0; f = this.nextBoundary[f]) {
          const fa = sTri[f * 3] * 3, fb = sTri[f * 3 + 1] * 3, fc = sTri[f * 3 + 2] * 3;
          const ux = x[fb] - x[fa], uy = x[fb + 1] - x[fa + 1], uz = x[fb + 2] - x[fa + 2];
          const vx = x[fc] - x[fa], vy = x[fc + 1] - x[fa + 1], vz = x[fc + 2] - x[fa + 2];
          let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const l = Math.hypot(nx, ny, nz);
          if (l < 1e-14) continue;
          nx /= l; ny /= l; nz /= l;
          const dist = -((px - x[fa]) * nx + (py - x[fa + 1]) * ny + (pz - x[fa + 2]) * nz);
          const prev = -((qx - x[fa]) * nx + (qy - x[fa + 1]) * ny + (qz - x[fa + 2]) * nz);
          if (prev <= 1e-4 && dist < crossD) {
            crossD = dist;
            cross = f;
            cnx = nx; cny = ny; cnz = nz;
          }
          if (dist < bestD) {
            bestD = dist;
            best = f;
            bnx = nx; bny = ny; bnz = nz;
          }
        }
        if (cross >= 0) {
          best = cross;
          bestD = crossD;
          bnx = cnx; bny = cny; bnz = cnz;
        }
        if (best < 0 || bestD < 0) continue;
        // a real impact wakes both sides; steady resting contact treats a
        // sleeping piece as immovable (and leaves it asleep and undisturbed)
        const tpc = this.pieces[tPiece[t]];
        const ppc = this.pieces[pi];
        if (bestD > 0.003) {
          if (tpc.asleep) {
            tpc.asleep = false;
            tpc.sleepT = 0;
            this._awake[tPiece[t]] = 1;
          }
          if (ppc.asleep) {
            ppc.asleep = false;
            ppc.sleepT = 0;
            this._awake[pi] = 1;
          }
        }
        const depth = (bestD + margin) * (this.contactRelax ?? 0.42);
        const f3 = best * 3;
        const ia = sTri[f3], ib = sTri[f3 + 1], ic = sTri[f3 + 2];
        const wv = ppc.asleep ? 0 : w[i];
        const wfa = tpc.asleep ? 0 : w[ia], wfb = tpc.asleep ? 0 : w[ib], wfc = tpc.asleep ? 0 : w[ic];
        const wf = (wfa + wfb + wfc) / 9;
        const den = wv + wf;
        if (den <= 0) continue;
        const sv1 = (depth * wv) / den;
        const sf = (depth * (wfa / 3)) / den, sg = (depth * (wfb / 3)) / den, sh = (depth * (wfc / 3)) / den;
        x[o] += bnx * sv1; x[o + 1] += bny * sv1; x[o + 2] += bnz * sv1;
        x[ia * 3] -= bnx * sf; x[ia * 3 + 1] -= bny * sf; x[ia * 3 + 2] -= bnz * sf;
        x[ib * 3] -= bnx * sg; x[ib * 3 + 1] -= bny * sg; x[ib * 3 + 2] -= bnz * sg;
        x[ic * 3] -= bnx * sh; x[ic * 3 + 1] -= bny * sh; x[ic * 3 + 2] -= bnz * sh;
        // friction: gelatin on gelatin is grippy; cancel relative sliding
        const q = this.px;
        let sx = x[o] - q[o], sy = x[o + 1] - q[o + 1], sz = x[o + 2] - q[o + 2];
        sx -= ((x[ia * 3] - q[ia * 3]) + (x[ib * 3] - q[ib * 3]) + (x[ic * 3] - q[ic * 3])) / 3;
        sy -= ((x[ia * 3 + 1] - q[ia * 3 + 1]) + (x[ib * 3 + 1] - q[ib * 3 + 1]) + (x[ic * 3 + 1] - q[ic * 3 + 1])) / 3;
        sz -= ((x[ia * 3 + 2] - q[ia * 3 + 2]) + (x[ib * 3 + 2] - q[ib * 3 + 2]) + (x[ic * 3 + 2] - q[ic * 3 + 2])) / 3;
        const sn = sx * bnx + sy * bny + sz * bnz;
        sx -= sn * bnx; sy -= sn * bny; sz -= sn * bnz;
        const sl = Math.hypot(sx, sy, sz);
        if (sl > 1e-9) {
          const k = Math.min(1, (1.6 * depth) / sl) * 0.9;
          const cv = (k * wv) / den;
          if (ppc.asleep && tpc.asleep) continue;
          x[o] -= sx * cv; x[o + 1] -= sy * cv; x[o + 2] -= sz * cv;
          const fs = ((1 - wv / den) * k) / 3;
          for (const fi of [ia, ib, ic]) {
            if (w[fi] === 0 || tpc.asleep) continue;
            x[fi * 3] += sx * fs; x[fi * 3 + 1] += sy * fs; x[fi * 3 + 2] += sz * fs;
          }
        }
        break;
      }
    }
  }

  // ---------------------------------------------------------------- queries
  raycast(ox, oy, oz, dx, dy, dz, maxT = Infinity) {
    const { x, sTri } = this;
    let best = maxT, bf = -1, bu = 0, bv = 0;
    for (let f = 0; f < this.nF; f++) {
      const a = sTri[f * 3] * 3, b = sTri[f * 3 + 1] * 3, c = sTri[f * 3 + 2] * 3;
      const e1x = x[b] - x[a], e1y = x[b + 1] - x[a + 1], e1z = x[b + 2] - x[a + 2];
      const e2x = x[c] - x[a], e2y = x[c + 1] - x[a + 1], e2z = x[c + 2] - x[a + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-12 && det < 1e-12) continue;
      if (det < 0) continue; // only front faces (outward normals face the ray)
      const id = 1 / det;
      const tx = ox - x[a], ty = oy - x[a + 1], tz = oz - x[a + 2];
      const u = (tx * px + ty * py + tz * pz) * id;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * id;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * id;
      if (t > 1e-6 && t < best) {
        best = t;
        bf = f;
        bu = u;
        bv = v;
      }
    }
    if (bf < 0) return null;
    const a = sTri[bf * 3] * 3, b = sTri[bf * 3 + 1] * 3, c = sTri[bf * 3 + 2] * 3;
    const ux = x[b] - x[a], uy = x[b + 1] - x[a + 1], uz = x[b + 2] - x[a + 2];
    const vx = x[c] - x[a], vy = x[c + 1] - x[a + 1], vz = x[c + 2] - x[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return {
      t: best,
      point: [ox + dx * best, oy + dy * best, oz + dz * best],
      normal: [nx / l, ny / l, nz / l],
      face: bf,
      piece: this.tPiece[this.sTet[bf]],
      tet: this.sTet[bf],
      bary: [1 - bu - bv, bu, bv],
    };
  }

  // Barycentric coordinates of p in tet t (current config). out[0..3]
  bary(t, px, py, pz, out) {
    const { x, T } = this;
    const a = T[t * 4] * 3, b = T[t * 4 + 1] * 3, c = T[t * 4 + 2] * 3, d = T[t * 4 + 3] * 3;
    const e1x = x[b] - x[a], e1y = x[b + 1] - x[a + 1], e1z = x[b + 2] - x[a + 2];
    const e2x = x[c] - x[a], e2y = x[c + 1] - x[a + 1], e2z = x[c + 2] - x[a + 2];
    const e3x = x[d] - x[a], e3y = x[d + 1] - x[a + 1], e3z = x[d + 2] - x[a + 2];
    const det = e1x * (e2y * e3z - e2z * e3y) - e2x * (e1y * e3z - e1z * e3y) + e3x * (e1y * e2z - e1z * e2y);
    if (Math.abs(det) < 1e-18) {
      out[0] = 1; out[1] = out[2] = out[3] = 0;
      return false;
    }
    const rx = px - x[a], ry = py - x[a + 1], rz = pz - x[a + 2];
    const id = 1 / det;
    const l1 = (rx * (e2y * e3z - e2z * e3y) - e2x * (ry * e3z - rz * e3y) + e3x * (ry * e2z - rz * e2y)) * id;
    const l2 = (e1x * (ry * e3z - rz * e3y) - rx * (e1y * e3z - e1z * e3y) + e3x * (e1y * rz - e1z * ry)) * id;
    const l3 = (e1x * (e2y * rz - e2z * ry) - e2x * (e1y * rz - e1z * ry) + rx * (e1y * e2z - e1z * e2y)) * id;
    out[0] = 1 - l1 - l2 - l3; out[1] = l1; out[2] = l2; out[3] = l3;
    return true;
  }

  // Locate the tet containing p (or the closest one). Returns {tet, bary, inside}.
  locate(px, py, pz, piece = -1) {
    const out = [0, 0, 0, 0];
    let bestT = -1, bestScore = -Infinity;
    const best = [0, 0, 0, 0];
    const list = piece >= 0 && this.pieces[piece] ? this.pieces[piece].tets : null;
    const n = list ? list.length : this.nT;
    for (let k = 0; k < n; k++) {
      const t = list ? list[k] : k;
      if (this.vol0[t] <= 0) continue;
      // quick reject by distance to first vertex
      const a = this.T[t * 4] * 3;
      const dx = this.x[a] - px, dy = this.x[a + 1] - py, dz = this.x[a + 2] - pz;
      if (dx * dx + dy * dy + dz * dz > 0.09) continue;
      this.bary(t, px, py, pz, out);
      const score = Math.min(out[0], out[1], out[2], out[3]);
      if (score > bestScore) {
        bestScore = score;
        bestT = t;
        best[0] = out[0]; best[1] = out[1]; best[2] = out[2]; best[3] = out[3];
        if (score >= 0) break;
      }
    }
    if (bestT < 0) return null;
    return { tet: bestT, bary: best, inside: bestScore >= -1e-6, score: bestScore };
  }

  // Rest-space grid of tets, for fast rest-coordinate lookups of many points
  // (glitter). Rebuilt lazily after topology changes.
  _restGrid() {
    if (this._rg && this._rg.v === this.topoVersion) return this._rg;
    const cs = this.hCell * 1.5, inv = 1 / cs;
    const T = this.T, X = this.X;
    const map = new Map();
    for (let t = 0; t < this.nT; t++) {
      if (this.vol0[t] <= 0) continue;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < 4; k++) {
        const i = T[t * 4 + k] * 3;
        x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]);
        y0 = Math.min(y0, X[i + 1]); y1 = Math.max(y1, X[i + 1]);
        z0 = Math.min(z0, X[i + 2]); z1 = Math.max(z1, X[i + 2]);
      }
      for (let a = Math.floor(x0 * inv); a <= Math.floor(x1 * inv); a++)
        for (let b = Math.floor(y0 * inv); b <= Math.floor(y1 * inv); b++)
          for (let c = Math.floor(z0 * inv); c <= Math.floor(z1 * inv); c++) {
            const key = (a + 512) * 1048576 + (b + 512) * 1024 + (c + 512);
            let l = map.get(key);
            if (!l) map.set(key, (l = []));
            l.push(t);
          }
    }
    this._rg = { v: this.topoVersion, map, inv };
    return this._rg;
  }

  // Fast rest-space point location: {tet, bary} or null.
  locateRestFast(X, Y, Z, out) {
    const g = this._restGrid();
    const key = (Math.floor(X * g.inv) + 512) * 1048576 + (Math.floor(Y * g.inv) + 512) * 1024 + (Math.floor(Z * g.inv) + 512);
    const list = g.map.get(key);
    if (!list) return null;
    const R = this.X, T = this.T, B = this.B;
    for (const t of list) {
      const a = T[t * 4] * 3, bo = t * 9;
      const rx = X - R[a], ry = Y - R[a + 1], rz = Z - R[a + 2];
      const l1 = B[bo] * rx + B[bo + 1] * ry + B[bo + 2] * rz;
      const l2 = B[bo + 3] * rx + B[bo + 4] * ry + B[bo + 5] * rz;
      const l3 = B[bo + 6] * rx + B[bo + 7] * ry + B[bo + 8] * rz;
      const l0 = 1 - l1 - l2 - l3;
      if (l0 >= -1e-7 && l1 >= -1e-7 && l2 >= -1e-7 && l3 >= -1e-7) {
        out.tet = t;
        out.b0 = l0; out.b1 = l1; out.b2 = l2; out.b3 = l3;
        return out;
      }
    }
    return null;
  }

  // Locate a point given in rest coordinates (used to re-seed embedded
  // features after the mesh is rebuilt).
  locateRest(X, Y, Z) {
    const R = this.X, T = this.T;
    for (let t = 0; t < this.nT; t++) {
      if (this.vol0[t] <= 0) continue;
      const a = T[t * 4] * 3, b = T[t * 4 + 1] * 3, c = T[t * 4 + 2] * 3, d = T[t * 4 + 3] * 3;
      const dx = R[a] - X, dy = R[a + 1] - Y, dz = R[a + 2] - Z;
      if (dx * dx + dy * dy + dz * dz > 0.06) continue;
      const bo = t * 9, B = this.B;
      const rx = X - R[a], ry = Y - R[a + 1], rz = Z - R[a + 2];
      const l1 = B[bo] * rx + B[bo + 1] * ry + B[bo + 2] * rz;
      const l2 = B[bo + 3] * rx + B[bo + 4] * ry + B[bo + 5] * rz;
      const l3 = B[bo + 6] * rx + B[bo + 7] * ry + B[bo + 8] * rz;
      const l0 = 1 - l1 - l2 - l3;
      if (l0 >= -1e-6 && l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) return { tet: t, bary: [l0, l1, l2, l3] };
      void b; void c; void d;
    }
    return null;
  }

  embedPoint(t, b, out) {
    const { x, T } = this;
    let px = 0, py = 0, pz = 0;
    for (let k = 0; k < 4; k++) {
      const i = T[t * 4 + k] * 3;
      px += x[i] * b[k]; py += x[i + 1] * b[k]; pz += x[i + 2] * b[k];
    }
    out[0] = px; out[1] = py; out[2] = pz;
    return out;
  }

  embedVelocity(t, b, out) {
    const { v, T } = this;
    let px = 0, py = 0, pz = 0;
    for (let k = 0; k < 4; k++) {
      const i = T[t * 4 + k] * 3;
      px += v[i] * b[k]; py += v[i + 1] * b[k]; pz += v[i + 2] * b[k];
    }
    out[0] = px; out[1] = py; out[2] = pz;
    return out;
  }

  // Add velocity to vertices near p, falling off with distance.
  impulse(px, py, pz, dx, dy, dz, radius, strength, piece = -1) {
    const { x, v, w } = this;
    const r2 = radius * radius;
    let hit = 0;
    for (let i = 0; i < this.nV; i++) {
      if (w[i] === 0) continue;
      if (piece >= 0 && this.vPiece[i] !== piece) continue;
      const o = i * 3;
      const ex = x[o] - px, ey = x[o + 1] - py, ez = x[o + 2] - pz;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 > r2) continue;
      const f = 1 - Math.sqrt(d2) / radius;
      const s = strength * f * f;
      v[o] += dx * s; v[o + 1] += dy * s; v[o + 2] += dz * s;
      if (this.pieces[this.vPiece[i]].asleep) this.wake(this.vPiece[i]);
      hit++;
    }
    return hit;
  }

  radialImpulse(px, py, pz, radius, strength, up = 0) {
    const { x, v, w } = this;
    for (let i = 0; i < this.nV; i++) {
      if (w[i] === 0) continue;
      const o = i * 3;
      const ex = x[o] - px, ey = x[o + 1] - py, ez = x[o + 2] - pz;
      const d = Math.hypot(ex, ey, ez);
      if (d > radius || d < 1e-6) continue;
      const f = 1 - d / radius;
      const s = (strength * f * f) / d;
      v[o] += ex * s; v[o + 1] += ey * s + up * f; v[o + 2] += ez * s;
      if (this.pieces[this.vPiece[i]].asleep) this.wake(this.vPiece[i]);
    }
  }

  addHeat(px, py, pz, radius, amount, limitHi = 1.4, limitLo = -1.2) {
    const { x, temp } = this;
    const r2 = radius * radius;
    for (let i = 0; i < this.nV; i++) {
      if (!this.alive[i]) continue;
      const o = i * 3;
      const ex = x[o] - px, ey = x[o + 1] - py, ez = x[o + 2] - pz;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 > r2) continue;
      const f = 1 - Math.sqrt(d2) / radius;
      temp[i] = Math.max(limitLo, Math.min(limitHi, temp[i] + amount * f));
      if (this.pieces[this.vPiece[i]]?.asleep) this.wake(this.vPiece[i]);
    }
    this.heatActive = true;
    this._heatResidual = 1;
  }

  startGrab(hit, tx, ty, tz, radius = 0.2) {
    const { x } = this;
    const idx = [], wt = [], off = [];
    const [hx, hy, hz] = hit.point;
    for (const i of this.pieces[hit.piece].verts) {
      const o = i * 3;
      const ex = x[o] - hx, ey = x[o + 1] - hy, ez = x[o + 2] - hz;
      const d = Math.hypot(ex, ey, ez);
      if (d > radius) continue;
      const f = 1 - d / radius;
      idx.push(i);
      wt.push(Math.max(0.02, f * f));
      off.push(ex, ey, ez);
    }
    if (!idx.length) return null;
    this.wake(hit.piece);
    this.grab = {
      n: idx.length,
      idx: Int32Array.from(idx),
      wt: Float64Array.from(wt),
      off: Float64Array.from(off),
      tx, ty, tz,
      compliance: 2e-6,
      piece: hit.piece,
    };
    return this.grab;
  }

  endGrab() {
    this.grab = null;
  }

  totalVolume() {
    let s = 0;
    for (let t = 0; t < this.nT; t++) s += this.vol0[t];
    return s;
  }

  currentVolume() {
    const { x, T } = this;
    let s = 0;
    for (let t = 0; t < this.nT; t++) {
      if (this.vol0[t] <= 0) continue;
      const a = T[t * 4] * 3, b = T[t * 4 + 1] * 3, c = T[t * 4 + 2] * 3, d = T[t * 4 + 3] * 3;
      const e1x = x[b] - x[a], e1y = x[b + 1] - x[a + 1], e1z = x[b + 2] - x[a + 2];
      const e2x = x[c] - x[a], e2y = x[c + 1] - x[a + 1], e2z = x[c + 2] - x[a + 2];
      const e3x = x[d] - x[a], e3y = x[d + 1] - x[a + 1], e3z = x[d + 2] - x[a + 2];
      s += (e1x * (e2y * e3z - e2z * e3y) - e2x * (e1y * e3z - e1z * e3y) + e3x * (e1y * e2z - e1z * e2y)) / 6;
    }
    return s;
  }

  kineticEnergy() {
    let e = 0;
    for (let i = 0; i < this.nV; i++) {
      const o = i * 3;
      e += 0.5 * this.m[i] * (this.v[o] ** 2 + this.v[o + 1] ** 2 + this.v[o + 2] ** 2);
    }
    return e;
  }
}
