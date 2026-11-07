// XPBD tetrahedral soft body with stable Neo-Hookean constraints
// (Macklin & Müller 2021), rigid-motion-preserving damping, ground/arena
// contact with friction, inter-piece contact, grabbing, embedded rigid
// segments (nails) and a per-vertex temperature field.

import { buildCubeMesh, roundBoxSDF, roundBoxNormal } from './mesh.js';

export const FACES = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
export const TAG_FRESH = 0;
export const TAG_EXTERIOR = 1;
export const TAG_MELT = 2; // (a surface the torch melted: smooth, glossy - like the skin)

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
  selfCollide: true, // a piece's surface against the rest of its own body (folds, hinged flaps)
  rigidity: 0, // 0..1: pulled toward its rest shape as a whole (see _solveRigidity) - 0 none, 1 near rigid
  grabK: 1, // how hard a hand pulls (reach and stiffness; Settings > Lab > Hand strength)
  contactGrip: 1, // friction between pieces, x the base 0.5 (Settings > Lab > Jelly on jelly)
};

function growArr(a, n, C) {
  const b = new C(n);
  if (a) b.set(a.length > n ? a.subarray(0, n) : a);
  return b;
}

// V8 keeps a field that has only ever held whole numbers as a small integer;
// the first fraction stored in it then changes the hidden class of every
// object of that kind, throwing away all the code optimised for them (a
// stutter the first time, say, the mallet sets a fractional damping). Fields
// that will hold fractions get one straight away.
function asFloat(o, keys) {
  for (const k of keys) {
    const v = o[k];
    o[k] = 0.5;
    o[k] = v;
  }
  return o;
}
// The rotation part of A (3x3, A[i*3+j]): Muller et al. 2016 - q (a unit
// quaternion, x y z w) iterated toward it from where it was; R (A's layout)
// out. Robust through flips and flat shapes, and a few rounds from a warm q.
export function polarRot(q, A, R, iters) {
  for (let it = 0; ; it++) {
    const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    R[0] = 1 - 2 * (qy * qy + qz * qz); R[1] = 2 * (qx * qy - qz * qw); R[2] = 2 * (qx * qz + qy * qw);
    R[3] = 2 * (qx * qy + qz * qw); R[4] = 1 - 2 * (qx * qx + qz * qz); R[5] = 2 * (qy * qz - qx * qw);
    R[6] = 2 * (qx * qz - qy * qw); R[7] = 2 * (qy * qz + qx * qw); R[8] = 1 - 2 * (qx * qx + qy * qy);
    if (it === iters) return;
    // omega = sum_j col_j(R) x col_j(A) / |sum_j col_j(R) . col_j(A)|
    let ox = 0, oy = 0, oz = 0, dd = 0;
    for (let j = 0; j < 3; j++) {
      const r0 = R[j], r1 = R[3 + j], r2 = R[6 + j], a0 = A[j], a1 = A[3 + j], a2 = A[6 + j];
      ox += r1 * a2 - r2 * a1; oy += r2 * a0 - r0 * a2; oz += r0 * a1 - r1 * a0;
      dd += r0 * a0 + r1 * a1 + r2 * a2;
    }
    dd = Math.abs(dd) + 1e-12;
    ox /= dd; oy /= dd; oz /= dd;
    const wl = Math.sqrt(ox * ox + oy * oy + oz * oz);
    if (wl < 1e-9) {
      iters = it + 1; // (converged: R is already q's)
      continue;
    }
    const sh = Math.sin(wl / 2) / wl, ch = Math.cos(wl / 2);
    const px = ox * sh, py = oy * sh, pz = oz * sh, pw = ch;
    const nx = pw * qx + px * qw + py * qz - pz * qy, ny = pw * qy - px * qz + py * qw + pz * qx;
    const nz = pw * qz + px * qy - py * qx + pz * qw, nw = pw * qw - px * qx - py * qy - pz * qz;
    const ql = Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw) || 1;
    q[0] = nx / ql; q[1] = ny / ql; q[2] = nz / ql; q[3] = nw / ql;
  }
}

const PIECE_FLOATS = ['sleepT', 'rebT', 'impY', 'rebR', 'impR', 'impUx', 'impUz', 'impT', 'impDv', 'foldUntil', 'buzzT', 'buzzA', 'buzzB', 'untangle', 'tangleTouch', 'touchT', 'vib'];
// (piece state a rebuild carries over to an untouched piece: see _buildPieces)
const CARRY = ['sleepT', 'asleep', 'rebT', 'impY', 'boosted', 'rebR', 'impR', 'impUx', 'impUz', 'boostedR', 'impPend', 'impT', 'impDv', 'sleepLogMu', 'foldUntil', 'foldAsk', 'buzzT', 'buzzA', 'buzzB', 'tangleN', 'untangle', 'tangleTries', 'tangleTouch', 'touchT', 'hinge'];

export class SoftBody {
  constructor(opts = {}) {
    this.p = asFloat(Object.assign({}, DEFAULTS, opts), ['rigidity', 'grabK', 'contactGrip', 'airDrag']);
    this.nV = 0;
    this.nT = 0;
    this.vCap = 0;
    this.tCap = 0;
    this.tKs = null; // per tet: stiffness scale, see _computeMass
    this._bpNV = 0; // vertex count at the last _buildPieces (0: nothing carries over)
    this._carried = null; // per piece: carried over unchanged by the last rebuild (see _buildPieces)
    this._allocV(4096);
    this._allocT(16384);
    this.grabs = []; // hands holding the jelly (two fingers: two) - see startGrab
    this.embeds = [];
    this.pushers = []; // moving flat faces pressing into the jelly (mallet head)
    this.attract = null;
    this.gravityScale = 1;
    this.tilt = new Float64Array(2); // (m/s²) sideways pull along x, z: the table tipped (see Tilt)
    this.collisionsEnabled = true;
    this.selfQuietUntil = 0; // (sim time) no self-contact before this: see radialImpulse
    this.topoVersion = 0;
    this.pieces = [];
    this.time = 0;
    this.hCell = this.p.size / this.p.res;
    this.impacts = []; // impacts this frame, one per piece: {x, y, z, dv, piece, kind, mass, partner} (for audio)
    this._ct = asFloat({ t: -1, f: -1, b0: 0, b1: 0, b2: 0, b3: 0, nx: 0, ny: 0, nz: 0, depth: 0 }, ['b0', 'b1', 'b2', 'b3', 'nx', 'ny', 'nz', 'depth']);
    // Every field this object will ever carry is created here, so its shape
    // never changes later: Safari's JIT throws its optimised code away (and
    // takes seconds to rebuild it) whenever a hot object gains a property.
    this.rebuildMs = 0;
    this.rebuilds = 0;
    this.dampBoost = 1;
    this.dmgHeal = 0; // (s) left of torn ends firming up (tDmg decaying)
    this.calmT = 0; // (s) left of the jiggle damped hard (just torn: the halves settle, not flail)
    this.heatActive = false;
    this._heatResidual = 0;
    this.weld = null; // set by the heal: distances to the healed seams
    this.fill = null; // set by the heal: what was missing, rising to fill its holes (see JellyView)
    this.anyAwake = true;
    // the piece-contact candidates cover _hashSpan seconds of motion from
    // when they were found (_hashAge ago); short frames reuse them
    this._hashSpan = 1 / 60;
    this._hashAge = 0;
    this._hashTopo = -1;
    this._hashDirty = true;
    this._hMask = 0;
    this._grabPress = 0;
    this._anyContact = false;
    this._gap = 0;
    this._fSelf = false;
    this.topoStale = false; // a light rebuild done, the full one still owed (see rebuildLight)
    this._tgVersion = -1; // (surface edges for _tangleCount, per topology)
    this._tgEdges = null;
    this._tgBox = null;
    this._tgStamp = null;
    this._tgSt = 0;
    this._pass = 0;
    this._fStamp = 0;
    this._nHTets = 0;
    this._nProbeV = 0;
    this._nProbeF = 0;
    this._warmVersion = -1;
    // derived from the topology (see rebuild)
    this.nF = 0;
    this.esc = null;
    this.vtStart = null;
    this.vtList = null;
    this.nbStart = null;
    this.nbList = null;
    this.sTri = null;
    this.sTet = null;
    this.sTag = null;
    this.sRestN = null;
    this.tetBoundary = null;
    this.nextBoundary = null;
    this.vfStart = null;
    this.vfList = null;
    this._fSeen = null;
    this._fGeo = null;
    this._fGeoStamp = null;
    this.rCount = 0;
    this.rSim = null;
    this.rTag = null;
    this.rIndex = null;
    this.rFaceOrder = null;
    this.pieceRanges = null;
    this._rg = null;
    // solver scratch (allocated on first use)
    this._awake = null;
    this._imp = null;
    this._impPartner = null;
    this._pmu = null;
    this._tmpTemp = null;
    this._pbb = null;
    this._pVel = null;
    this._pMass = null;
    this._pcs = null;
    this._sweep = null;
    this._disp = null;
    this._tStat = null;
    this._sfKey = null;
    this._sfVal = null;
    this._selfOK = null;
    this._hood = null;
    this._tSurf = null;
    this._surfV = null;
    this._nSurfV = 0;
    this._selfFlag = null;
    this._svStart = null;
    this._svFill = null;
    this._svList = null;
    this._hoodStamp = 0;
    this._foldClock = 0; // (s) since the last look for folds
    this._tangleClock = 0; // (s) since the last look for surfaces passed through themselves
    this._tangleNext = 0; // (the next piece to look at)
    this._foldNext = 0; // (the next piece to look at)
    this._foldUntil = null; // per vertex: sim time till which it is held as folded in
    this._foldLook = null;
    this._fgCount = null;
    this._fgEnt = null;
    this._fgBox = null;
    this._pieceActive = null;
    this._ptS = null;
    this._hCount = null;
    this._hEntries = null;
    this._hFill = null;
    this._hRanges = null;
    this._hTets = null;
    this._tBox0 = null;
    this._tBoxNow = null;
    this._tBoxStamp = null;
    this._tStamp = null;
    this._cList = null;
    this._skip = null;
    this._probeV = null;
    this._probeF = null;
    this._probeSeen = null;
    this._pcStart = null;
    this._pcEnd = null;
    this._pRel = null;
    this._vcS = null;
    this._vcE = null;
    this._vcR = null;
    this._fcS = null;
    this._fcE = null;
    this._fcR = null;
    this._wtV = null;
    this._wfV = null;
    this._wtF = null;
    this._wfF = null;
    this._pi3 = new Int32Array(3);
    this._pw3 = new Float64Array(3);
    this._ti4 = new Int32Array(4);
    this._tb4 = new Float64Array(4);
    this._fq = asFloat({ ok: false, dist: 0, prev: 0, nx: 0, ny: 0, nz: 0, on: false, crossS: Infinity }, ['dist', 'prev', 'nx', 'ny', 'nz']);
    asFloat(this, ['time', 'gravityScale', 'rebuildMs', 'dampBoost', 'dmgHeal', 'calmT', '_heatResidual', '_hashAge', '_grabPress', '_gap', '_foldClock', '_tangleClock']);
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
    this.melt = growArr(this.melt, cap, Uint8Array); // (on a surface the torch melted)
    this.fpen = growArr(this.fpen, cap, Float32Array); // floor push-out this substep
    this.wpen = growArr(this.wpen, cap, Float32Array); // wall push-out this substep
    this.vCap = cap;
  }

  _allocT(cap) {
    this.T = growArr(this.T, cap * 4, Int32Array);
    this.B = growArr(this.B, cap * 9, Float64Array);
    this.vol0 = growArr(this.vol0, cap, Float64Array);
    this.tPiece = growArr(this.tPiece, cap, Int32Array);
    this.tVS = growArr(this.tVS, cap, Float32Array);
    this.tMu = growArr(this.tMu, cap, Float32Array);
    this.tKs = growArr(this.tKs, cap, Float32Array);
    this.tDmg = growArr(this.tDmg, cap, Float32Array); // (0..1: torn that far - softer, see _solveTets; cleared on a rebuild)
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
    this.melt[i] = 0;
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
    this.grabs.length = 0;
    this._bpNV = 0;
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
    this._hashDirty = true;
  }

  wake(k) {
    const pc = this.pieces[k];
    if (pc) {
      if (pc.asleep) this._hashDirty = true;
      pc.sleepT = 0;
      pc.asleep = false;
    }
  }

  // Just what the next cut needs (rest shapes, masses, adjacency, pieces):
  // for a run of cuts in one go, ending with a full rebuild() before the
  // body is stepped or drawn again.
  rebuildLight() {
    this.topoStale = true;
    this.tDmg.fill(0, 0, this.nT);
    this._computeRest();
    this._computeMass();
    this._buildAdjacency();
    this._buildPieces();
  }

  rebuild() {
    const t0 = performance.now();
    this.topoStale = false;
    this.tDmg.fill(0, 0, this.nT);
    this.dmgHeal = 0;
    this._computeRest();
    this._computeMass();
    this._buildAdjacency();
    this._buildPieces();
    this._extractSurface();
    this._computeEscape();
    this._buildRenderClusters();
    this._findHinges();
    this._sizeContactScratch();
    this.topoVersion++;
    this.rebuildMs += performance.now() - t0; // (read and cleared by ?stats)
    this.rebuilds++;
  }

  // A piece still joined to itself across a cut - a flap on a hinge - has
  // the two sides of that cut facing each other, a blade's width apart: it
  // needs self-contact, or the flap drops straight through the rest.
  _findHinges() {
    const { sTri, sTag, sTet, X, tPiece, sRestN } = this;
    // (a piece the change didn't touch keeps what it had: see _buildPieces)
    const carried = this._carried && this._carried.length === this.pieces.length ? this._carried : null;
    for (const pc of this.pieces) if (!carried || !carried[pc.id]) pc.hinge = false;
    const C = 0.02 * this.p.size, iC = 1 / C, near2 = (0.6 * C) ** 2;
    const cells = new Map();
    const cen = new Float64Array(this.nF * 3);
    const key = (i, j, k) => (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512);
    for (let f = 0; f < this.nF; f++) {
      if (sTag[f] === TAG_EXTERIOR || (carried && carried[tPiece[sTet[f]]])) continue;
      const a = sTri[f * 3] * 3, b = sTri[f * 3 + 1] * 3, c = sTri[f * 3 + 2] * 3;
      for (let e = 0; e < 3; e++) cen[f * 3 + e] = (X[a + e] + X[b + e] + X[c + e]) / 3;
      const k = key(Math.floor(cen[f * 3] * iC), Math.floor(cen[f * 3 + 1] * iC), Math.floor(cen[f * 3 + 2] * iC));
      const l = cells.get(k);
      if (l) l.push(f);
      else cells.set(k, [f]);
    }
    for (const [k, list] of cells) {
      const ci = Math.floor(k / 1048576) - 512, cj = (Math.floor(k / 1024) % 1024) - 512, ck = (k % 1024) - 512;
      for (const f of list) {
        const pf = tPiece[sTet[f]];
        if (this.pieces[pf].hinge) continue;
        for (let di = -1; di <= 1 && !this.pieces[pf].hinge; di++)
          for (let dj = -1; dj <= 1 && !this.pieces[pf].hinge; dj++)
            for (let dk = -1; dk <= 1; dk++) {
              const other = cells.get(key(ci + di, cj + dj, ck + dk));
              if (!other) continue;
              for (const g of other) {
                if (g === f || tPiece[sTet[g]] !== pf) continue;
                const dn = sRestN[f * 3] * sRestN[g * 3] + sRestN[f * 3 + 1] * sRestN[g * 3 + 1] + sRestN[f * 3 + 2] * sRestN[g * 3 + 2];
                if (dn > -0.8) continue;
                const dx = cen[f * 3] - cen[g * 3], dy = cen[f * 3 + 1] - cen[g * 3 + 1], dz = cen[f * 3 + 2] - cen[g * 3 + 2];
                if (dx * dx + dy * dy + dz * dz < near2) {
                  this.pieces[pf].hinge = true;
                  break;
                }
              }
              if (this.pieces[pf].hinge) break;
            }
      }
    }
  }

  // The contact pass's scratch arrays, sized for the new topology here
  // (rebuilds are rare) so the per-frame code never takes a growth branch
  // for the first time - that throws its optimised code away mid-frame.
  _sizeContactScratch() {
    const NP = Math.max(this.pieces.length, 64), V = this.vCap, Tc = this.tCap;
    const F = Math.max(this.nF * 2, 1024), Pr = (V + Math.max(this.nF, 1024)) * 2;
    const f64 = (a, n) => (a && a.length >= n ? a : new Float64Array(n));
    const f32 = (a, n) => (a && a.length >= n ? a : new Float32Array(n));
    const i32 = (a, n) => (a && a.length >= n ? a : new Int32Array(n));
    const u8 = (a, n) => (a && a.length >= n ? a : new Uint8Array(n));
    this._pbb = f64(this._pbb, NP * 6);
    this._pcs = f64(this._pcs, NP);
    this._pVel = f64(this._pVel, NP * 3);
    this._pMass = f64(this._pMass, NP);
    this._pieceActive = u8(this._pieceActive, NP);
    this._ptS = i32(this._ptS, NP + 1);
    this._sweep = f32(this._sweep, V * 6);
    this._disp = f32(this._disp, V * 3);
    this._hCount = this._hCount || new Int32Array((1 << 15) + 1);
    this._hFill = this._hFill || new Int32Array(1 << 15);
    this._tBox0 = f32(this._tBox0, Tc * 6);
    this._hRanges = i32(this._hRanges, Tc * 6);
    this._hTets = i32(this._hTets, Tc);
    this._tStat = f32(this._tStat, Tc * 8);
    this._hEntries = i32(this._hEntries, Tc * 16);
    this._probeV = i32(this._probeV, V);
    this._probeF = i32(this._probeF, F);
    this._pcStart = i32(this._pcStart, Pr);
    this._pcEnd = i32(this._pcEnd, Pr);
    this._pRel = f32(this._pRel, Pr);
    this._probeSeen = u8(this._probeSeen, V);
    this._tStamp = i32(this._tStamp, Tc);
    this._cList = i32(this._cList, 1 << 17);
    this._vcS = i32(this._vcS, V);
    this._vcE = i32(this._vcE, V);
    this._vcR = f32(this._vcR, V);
    this._fcS = i32(this._fcS, F);
    this._fcE = i32(this._fcE, F);
    this._fcR = f32(this._fcR, F);
    this._skip = f32(this._skip, Pr);
    this._tBoxNow = f32(this._tBoxNow, Tc * 6);
    this._tBoxStamp = i32(this._tBoxStamp, Tc);
    this._selfOK = u8(this._selfOK, NP);
    this._hood = i32(this._hood, V);
    // tets touching the surface (a piece against itself only meets those:
    // whatever folds into it comes in through them - the ones right on a
    // cut can be slivers, so the whole layer)
    const ts = (this._tSurf = u8(this._tSurf, Tc));
    const onS = new Uint8Array(this.nV);
    for (let k = 0; k < this.nF * 3; k++) onS[this.sTri[k]] = 1;
    for (let t = 0; t < this.nT; t++) {
      const o = t * 4;
      ts[t] = onS[this.T[o]] | onS[this.T[o + 1]] | onS[this.T[o + 2]] | onS[this.T[o + 3]];
    }
    // the surface vertices, and scratch for finding the ones near another
    // part of their own body (see _buildCollisionHash)
    const sv = (this._surfV = i32(this._surfV, V));
    let n = 0;
    for (let i = 0; i < this.nV; i++) if (onS[i]) sv[n++] = i;
    this._nSurfV = n;
    this._selfFlag = u8(this._selfFlag, V);
    this._svStart = i32(this._svStart, 4097);
    this._svFill = i32(this._svFill, 4096);
    // the look for folds: per-vertex hold times (vertex numbers changed:
    // start over), and its own grid of tets
    this._foldUntil = f64(this._foldUntil, V);
    this._foldUntil.fill(0);
    this._foldLook = u8(this._foldLook, NP);
    this._fgCount = this._fgCount || new Int32Array((1 << 14) + 1);
    this._fgEnt = i32(this._fgEnt, Tc * 8);
    this._fgBox = f32(this._fgBox, Tc * 6);
    this._svList = i32(this._svList, V);
  }

  // For every vertex: rest-space vector to the nearest boundary vertex of its
  // own piece (multi-source Dijkstra carrying the nearest source, i.e. a
  // graph approximation of the Euclidean distance transform). Lets contact
  // push a deeply-penetrated point out the right way.
  _computeEscape() {
    const nV = this.nV, X = this.X;
    // (pieces the change didn't touch keep theirs - their vertices, rest
    // shape and skin are as they were: see _buildPieces)
    const keep = this.esc && this.esc.length >= nV * 3 && this._carried && this._carried.length === this.pieces.length;
    const carried = keep ? this._carried : null, vp = this.vPiece;
    const near = new Int32Array(nV).fill(-1);
    const dist = new Float64Array(nV).fill(Infinity);
    let cap = Math.max(1024, nV * 6);
    let hI = new Int32Array(cap), hK = new Float64Array(cap), n = 0;
    const push = (i, k) => {
      if (n >= cap) {
        cap *= 2;
        const a = new Int32Array(cap); a.set(hI); hI = a;
        const b = new Float64Array(cap); b.set(hK); hK = b;
      }
      let c = n++;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (hK[p] <= k) break;
        hI[c] = hI[p]; hK[c] = hK[p]; c = p;
      }
      hI[c] = i; hK[c] = k;
    };
    const pop = () => {
      const top = hI[0];
      const li = hI[--n], lk = hK[n];
      let c = 0;
      for (;;) {
        let ch = c * 2 + 1;
        if (ch >= n) break;
        if (ch + 1 < n && hK[ch + 1] < hK[ch]) ch++;
        if (hK[ch] >= lk) break;
        hI[c] = hI[ch]; hK[c] = hK[ch]; c = ch;
      }
      hI[c] = li; hK[c] = lk;
      return top;
    };
    for (let k = 0; k < this.nF * 3; k++) {
      const i = this.sTri[k];
      if (dist[i] !== 0 && !(carried && carried[vp[i]])) {
        dist[i] = 0;
        near[i] = i;
        push(i, 0);
      }
    }
    const nbS = this.nbStart, nbL = this.nbList;
    while (n > 0) {
      const d0 = hK[0];
      const i = pop();
      if (d0 > dist[i]) continue;
      const c = near[i], cx = X[c * 3], cy = X[c * 3 + 1], cz = X[c * 3 + 2];
      for (let e = nbS[i]; e < nbS[i + 1]; e++) {
        const j = nbL[e];
        const d = Math.hypot(X[j * 3] - cx, X[j * 3 + 1] - cy, X[j * 3 + 2] - cz);
        if (d < dist[j]) {
          dist[j] = d;
          near[j] = c;
          push(j, d);
        }
      }
    }
    const esc = this.esc && this.esc.length >= nV * 3 ? this.esc : (this.esc = new Float32Array(this.vCap * 3));
    for (let i = 0; i < nV; i++) {
      if (carried && vp[i] >= 0 && carried[vp[i]]) continue;
      const c = near[i];
      if (c < 0) {
        esc[i * 3] = esc[i * 3 + 1] = esc[i * 3 + 2] = 0;
        continue;
      }
      esc[i * 3] = X[c * 3] - X[i * 3];
      esc[i * 3 + 1] = X[c * 3 + 1] - X[i * 3 + 1];
      esc[i * 3 + 2] = X[c * 3 + 2] - X[i * 3 + 2];
    }
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
    // How stiff each tet is for the corners it moves: V * sum(w_i |b_i|^2)
    // (b_i = how its corner i moves F; per unit density). Cuts leave small
    // tets on light corners up to 60x stiffer for their mass than any tet of
    // the whole cube; a piece made of them never comes to rest - its two
    // elastic terms overshoot each other every substep and it buzzes at
    // metres a second, skating over the floor like a bristlebot. Those tets
    // are softened to a set level (per unit cell size^-2): every tet of a
    // whole sharp or soft-edged cube is below it, a round one's most
    // squashed bevel tets touch it; frozen boosts scale on top as before.
    const { B, tKs } = this;
    for (let t = 0; t < this.nT; t++) {
      if (vol0[t] <= 0) {
        tKs[t] = 1;
        continue;
      }
      const o = t * 9, q = t * 4;
      const b1 = B[o] * B[o] + B[o + 1] * B[o + 1] + B[o + 2] * B[o + 2];
      const b2 = B[o + 3] * B[o + 3] + B[o + 4] * B[o + 4] + B[o + 5] * B[o + 5];
      const b3 = B[o + 6] * B[o + 6] + B[o + 7] * B[o + 7] + B[o + 8] * B[o + 8];
      const s0 = B[o] + B[o + 3] + B[o + 6], s1 = B[o + 1] + B[o + 4] + B[o + 7], s2 = B[o + 2] + B[o + 5] + B[o + 8];
      const k = vol0[t] * Math.cbrt(tVS[t]) * rho * (w[T[q]] * (s0 * s0 + s1 * s1 + s2 * s2) + w[T[q + 1]] * b1 + w[T[q + 2]] * b2 + w[T[q + 3]] * b3);
      tKs[t] = k;
    }
    const kRef = 4.5 / (this.hCell * this.hCell);
    for (let t = 0; t < this.nT; t++) if (vol0[t] > 0) tKs[t] = tKs[t] > kRef ? kRef / tKs[t] : 1;
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
    // (each vertex's piece before this rebuild: see the end)
    const oldNV = Math.min(this._bpNV, nV), oldVP = this.vPiece.slice(0, oldNV);
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
      // (a tet squeezed flat has no volume, so its corners can have no mass
      // and be dead - it belongs to no piece; it used to throw here)
      if (k < 0) continue;
      pieceTets[k].push(t);
    }
    const old = this.pieces || [];
    this.pieces = pieceVerts.map((vs, k) => {
      let mass = 0, vol = 0;
      for (const i of vs) mass += this.m[i];
      for (const t of pieceTets[k]) vol += this.vol0[t] * this.tVS[t];
      return asFloat({
        id: k,
        verts: Int32Array.from(vs),
        tets: Int32Array.from(pieceTets[k]),
        mass,
        volume: vol,
        com: new Float64Array(3),
        vel: new Float64Array(3),
        bbox: new Float64Array(6),
        omega: new Float64Array(3),
        sleepT: 0,
        asleep: false,
        // (all fields up front - see the constructor)
        rebT: 0,
        impY: 0,
        boosted: false,
        rebR: 0,
        impR: 0,
        impUx: 0,
        impUz: 0,
        boostedR: false,
        impPrev: new Float64Array(3),
        impPend: null,
        impT: -1,
        impDv: 0,
        sleepLogMu: undefined,
        hinge: false, // still joined to itself across a cut (see _findHinges)
        foldUntil: 0, // (sim time) has vertices folded into itself till then (see _foldCheck)
        foldAsk: false, // look for folds next frame (it has just fallen asleep)
        buzzT: 0, // (s) still, but buzzing, for this long (see _dampPieces)
        buzzA: 0, // (its buzz over the first and the second half of that)
        buzzB: 0,
        tangleN: 0, // looks in a row that found it passed through itself (see _tangleCheck)
        touchT: -1e9, // (sim time) last held or blasted - what tangles a piece
        vib: 0, // (m/s) how fast it jiggles: its vertices' rms speed apart from moving as a whole (the jelly's voice follows it)
        untangle: 0, // (s) left of springing back out of that
        tangleTries: 0, // springings back since it was last touched (see _tangleCheck)
        tangleTouch: -1e9, // (that touch)
        fitQ: new Float64Array([0, 0, 0, 1]), // its last fitted rotation (rest -> now)
        rigQ: new Float64Array([0, 0, 0, 1]), // (the same, for _solveRigidity: warm from the last substep)
      }, PIECE_FLOATS);
    });
    // A piece the change didn't touch - the very same vertices as one piece
    // before it - carries on as it was: asleep if it was asleep. (Every
    // piece used to come out of a rebuild awake: one knife swipe through a
    // settled pile of a hundred pieces woke them all, to buzz and settle
    // again at full cost for seconds.)
    // But a sleeper touching anything that did change wakes (what it rested
    // on may have been cut away or removed): any of its vertices within 2 cm
    // of a vertex of a changed piece, as it was or as it is now.
    const kept = new Uint8Array(old.length), carried = (this._carried = new Uint8Array(this.pieces.length));
    let anyAsleep = false;
    for (const pc of this.pieces) {
      const vs = pc.verts, i0 = vs[0];
      if (i0 >= oldNV) continue;
      const op = oldVP[i0], o = old[op];
      if (!o || o.verts.length !== vs.length) continue;
      let same = true;
      for (let k = 1; k < vs.length && same; k++) same = vs[k] < oldNV && oldVP[vs[k]] === op;
      if (!same) continue;
      for (const f of CARRY) pc[f] = o[f];
      pc.com.set(o.com); pc.vel.set(o.vel); pc.bbox.set(o.bbox); pc.omega.set(o.omega); pc.impPrev.set(o.impPrev); pc.fitQ.set(o.fitQ); pc.rigQ.set(o.rigQ);
      kept[op] = 1;
      carried[pc.id] = 1;
      if (pc.asleep) anyAsleep = true;
    }
    if (anyAsleep) {
      const x = this.x, r = 0.02 * this.p.size, ir = 1 / r;
      const cells = new Map();
      const key = (i) => (Math.floor(x[i * 3] * ir) + 512) * 1048576 + (Math.floor(x[i * 3 + 1] * ir) + 512) * 1024 + (Math.floor(x[i * 3 + 2] * ir) + 512);
      const add = (vs) => {
        for (const i of vs) {
          const k = key(i), l = cells.get(k);
          if (l) l.push(i);
          else cells.set(k, [i]);
        }
      };
      for (let k = 0; k < old.length; k++) if (!kept[k]) add(old[k].verts);
      for (const pc of this.pieces) if (!carried[pc.id]) add(pc.verts);
      for (const pc of this.pieces) {
        if (!carried[pc.id] || !pc.asleep) continue;
        let near = false;
        for (let n = 0; n < pc.verts.length && !near; n++) {
          const i = pc.verts[n], ox = x[i * 3], oy = x[i * 3 + 1], oz = x[i * 3 + 2];
          const cx = Math.floor(ox * ir), cy = Math.floor(oy * ir), cz = Math.floor(oz * ir);
          for (let a = -1; a <= 1 && !near; a++)
            for (let b = -1; b <= 1 && !near; b++)
              for (let c = -1; c <= 1 && !near; c++) {
                const l = cells.get((cx + a + 512) * 1048576 + (cy + b + 512) * 1024 + (cz + c + 512));
                if (!l) continue;
                for (const j of l) {
                  const dx = x[j * 3] - ox, dy = x[j * 3 + 1] - oy, dz = x[j * 3 + 2] - oz;
                  if (dx * dx + dy * dy + dz * dz < r * r) {
                    near = true;
                    break;
                  }
                }
              }
        }
        if (near) {
          pc.asleep = false;
          pc.sleepT = 0;
        }
      }
    }
    this._bpNV = nV;
  }

  _extractSurface() {
    const { T, X } = this;
    const nT = this.nT;
    // Tet faces met once are on the boundary; ones met twice are shared.
    // Open-addressing table on the sorted corner triple (a Map with big
    // numeric keys costs several ms per cut); the boundary faces come out in
    // tet order.
    let cap = 1024;
    while (cap < nT * 8) cap <<= 1;
    if (!this._sfKey || this._sfKey.length < cap * 3) {
      this._sfKey = new Int32Array(cap * 3);
      this._sfVal = new Int32Array(cap);
    }
    const hk = this._sfKey, hv = this._sfVal, mask = cap - 1;
    hv.fill(-1, 0, cap); // -1 empty, -2 shared (keep probing past it), else the face code t*4+f
    let nF = 0;
    for (let t = 0; t < nT; t++) {
      if (this.vol0[t] <= 0) continue;
      for (let f = 0; f < 4; f++) {
        const a = T[t * 4 + FACES[f][0]], b = T[t * 4 + FACES[f][1]], c = T[t * 4 + FACES[f][2]];
        let lo = a, mid = b, hi = c, tt;
        if (lo > mid) { tt = lo; lo = mid; mid = tt; }
        if (mid > hi) { tt = mid; mid = hi; hi = tt; }
        if (lo > mid) { tt = lo; lo = mid; mid = tt; }
        let h = (Math.imul(lo, 0x9e3779b1) ^ Math.imul(mid, 0x85ebca77) ^ Math.imul(hi, 0xc2b2ae3d)) & mask;
        for (;;) {
          const e = hv[h];
          if (e === -1) {
            hk[h * 3] = lo; hk[h * 3 + 1] = mid; hk[h * 3 + 2] = hi;
            hv[h] = t * 4 + f;
            nF++;
            break;
          }
          if (e >= 0 && hk[h * 3] === lo && hk[h * 3 + 1] === mid && hk[h * 3 + 2] === hi) {
            hv[h] = -2;
            nF--;
            break;
          }
          h = (h + 1) & mask;
        }
      }
    }
    const codes = new Int32Array(nF);
    for (let h = 0, n = 0; h < cap; h++) if (hv[h] >= 0) codes[n++] = hv[h];
    codes.sort();
    const sTri = new Int32Array(nF * 3);
    const sTet = new Int32Array(nF);
    const sTag = new Uint8Array(nF);
    const sRestN = new Float32Array(nF * 3);
    const half = this.p.size / 2, bevel = this.p.bevel;
    const nrm = [0, 0, 0];
    let f = 0;
    const tetBoundary = new Int32Array(nT).fill(-1); // first boundary face of tet (linked)
    const nextBoundary = new Int32Array(nF).fill(-1);
    for (let k = 0; k < nF; k++) {
      const code = codes[k];
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
      if (tag === TAG_FRESH && this.melt[a] && this.melt[b] && this.melt[c]) tag = TAG_MELT;
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
    // boundary faces around each vertex (contact looks at the faces near a tet)
    const vfStart = new Int32Array(this.nV + 1);
    for (let k = 0; k < nF * 3; k++) vfStart[sTri[k] + 1]++;
    for (let i = 0; i < this.nV; i++) vfStart[i + 1] += vfStart[i];
    const vfFill = vfStart.slice(0, this.nV);
    const vfList = new Int32Array(nF * 3);
    for (let k = 0; k < nF * 3; k++) vfList[vfFill[sTri[k]]++] = (k / 3) | 0;
    this.vfStart = vfStart;
    this.vfList = vfList;
    this._fSeen = new Int32Array(nF);
    this._fStamp = 0;
    // per-substep cache of face geometry for contact (anchor, edges, unit
    // normal, projection terms), valid while _fGeoStamp[f] === _pass
    this._fGeo = new Float64Array(nF * 16);
    this._fGeoStamp = new Int32Array(nF);
    this._pass = (this._pass || 0) + 1;
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
    const par = new Int32Array(64), rid = new Int32Array(64);
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
          const thr = sTag[fa] === TAG_EXTERIOR ? 0.45 : sTag[fa] === TAG_MELT ? 0.15 : 0.82;
          if (d < thr) continue;
          const ra = find(a), rb = find(b);
          if (ra !== rb) par[rb] = ra;
        }
      }
      rid.fill(-1, 0, n);
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
    // index buffer sorted by piece (counting sort; in face order within one)
    const tp = this.tPiece, sTet = this.sTet, NPc = this.pieces.length;
    const pStart = new Int32Array(NPc + 1);
    for (let f = 0; f < nF; f++) pStart[tp[sTet[f]] + 1]++;
    for (let k = 0; k < NPc; k++) pStart[k + 1] += pStart[k];
    const order = new Int32Array(nF);
    for (let f = 0; f < nF; f++) order[pStart[tp[sTet[f]]]++] = f;
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
        extra[r * 4 + 2] = rTag[r] === TAG_FRESH ? 1 : 0;
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
    const NP0 = this.pieces.length;
    if (!this._imp || this._imp.length < NP0 * 12) {
      this._imp = new Float64Array(Math.max(NP0, 64) * 12);
      this._impPartner = new Int32Array(Math.max(NP0, 64));
    }
    this._imp.fill(0, 0, NP0 * 12);
    this._impPartner.fill(-1, 0, NP0);
    this._updateMaterial(dt);
    if (this.calmT > 0) this.calmT -= dt;
    if (this.dmgHeal > 0) {
      // (torn ends firming up again: see HandTool)
      this.dmgHeal -= dt;
      const D = this.tDmg, f = this.dmgHeal > 0 ? Math.exp(-dt * 3.5) : 0;
      for (let t = 0; t < this.nT; t++) if (D[t] > 0) D[t] *= f;
    }
    this._foldCheck(dt);
    if (this.grabs.length) {
      const G = this._markGrabbed();
      for (let k = 0; k < this.pieces.length; k++) {
        if (!G[k]) continue;
        this.wake(k);
        this.pieces[k].touchT = this.time;
      }
    } else if (this._grabbedP) this._grabbedP.fill(0);
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
    const multi = (this.pieces.length > 1 || P.selfCollide) && P.collide && this.collisionsEnabled;
    this._grabPress = 0;
    const NPp = this.pieces.length;
    if (!this._pressP || this._pressP.length < NPp) this._pressP = new Float64Array(Math.max(NPp, 64));
    this._pressP.fill(0, 0, NPp);
    if (multi) {
      // A frame's worth (or more) of motion: short frames (slow motion)
      // keep using the candidates until it is used up - unless something
      // moved the pieces some other way meanwhile.
      const age = this._hashAge + dt;
      if (this._hashDirty || age > this._hashSpan * 1.0001 || this.grabs.length || this.pushers.length || this.attract || this._hashTopo !== this.topoVersion) {
        this._hashSpan = Math.max(dt, 1 / 60);
        this._hashAge = dt;
        this._hashTopo = this.topoVersion;
        this._hashDirty = false;
        this._buildCollisionHash();
      } else this._hashAge = age;
    } else this._hashDirty = true;
    for (let s = 0; s < nS; s++) {
      this._integrate(h);
      // (the hand pulls first, then the jelly answers: pulled after its
      // elasticity had its say, a held patch pressed against something was
      // crushed flat each substep - a thin slice turned inside out and blew
      // up like a balloon - and a corner could be dragged straight through
      // the body, leaving it passed through itself)
      for (let n = 0; n < this.grabs.length; n++) this._solveGrab(this.grabs[n], h);
      this._solveTets(h);
      if (this.p.rigidity > 0) this._solveRigidity(h);
      if (this.embeds.length) this._solveEmbeds(h);
      if (this.attract) this._solveAttract(h);
      if (this.pushers.length) this._solvePushers((s + 1) / nS);
      if (multi && this._anyContact) this._solvePieceCollisions(h);
      this._solveBounds(h);
      this._updateVelocities(h);
    }
    this._dampPieces(dt);
    this._tangleCheck(dt);
    this._untangle(dt);
    this._emitImpacts(dt, h);
  }

  // Impacts for sound, from the impulse floor, walls and other pieces gave
  // each piece this frame (as a speed change; holding a piece up against
  // gravity doesn't count). _imp per piece, 3 slots (floor, wall, pieces) of
  // [J, Jx, Jy, Jz]: J = sum of m*dx, then the J-weighted contact position.
  // A sudden rise starts an impact; it is reported a frame or two later at
  // its peak (soft jelly takes a few frames to stop).
  _emitImpacts(dt, h) {
    const I = this._imp, g = Math.abs(this.p.gravity * this.gravityScale);
    const dvs = [0, 0, 0];
    for (let k = 0; k < this.pieces.length; k++) {
      const pc = this.pieces[k];
      if (!(pc.mass > 0)) continue;
      const o = k * 12;
      const prev = pc.impPrev;
      let best = 0, kind = -1;
      for (let c = 0; c < 3; c++) {
        let dv = I[o + c * 4] / h / pc.mass;
        if (c === 0) dv -= g * dt;
        if (c === 2) {
          // between pieces it's the change in their closing speed that counts
          const q = this._impPartner[k], pq = this.pieces[q];
          if (q >= 0 && pq && pq.mass > 0 && !pq.asleep) dv += I[q * 12 + 8] / h / pq.mass;
        }
        dvs[c] = dv;
        // only a sudden rise counts (steady pressing/supporting is silent)
        const rise = dv - 1.8 * prev[c];
        prev[c] = Math.max(0, dv);
        if (rise > 0 && dv > 0.8 && dv > best) {
          best = dv;
          kind = c;
        }
      }
      const pend = pc.impPend;
      if (pend) {
        const dv = dvs[pend.c];
        if (dv > pend.dv) {
          const J = I[o + pend.c * 4] || 1;
          pend.dv = dv;
          pend.x = I[o + pend.c * 4 + 1] / J; pend.y = I[o + pend.c * 4 + 2] / J; pend.z = I[o + pend.c * 4 + 3] / J;
        }
        if (++pend.n >= 2 || dv < pend.dv * 0.7) {
          pc.impPend = null;
          if (pend.dv >= 1) {
            pc.impT = this.time;
            pc.impDv = pend.dv;
            this.impacts.push({
              x: pend.x, y: pend.y, z: pend.z, dv: pend.dv, piece: k, kind: pend.c === 0 ? 'floor' : pend.c === 1 ? 'wall' : 'piece',
              mass: pc.mass, partner: pend.c === 2 ? this._impPartner[k] : -1,
            });
          }
        }
        continue;
      }
      if (kind < 0 || pc.asleep) continue;
      // one per contact, not a rattle: a fresh hit needs a pause or to be harder
      if (this.time - (pc.impT ?? -1) < 0.1 && best < (pc.impDv || 0) * 1.6) continue;
      const J = I[o + kind * 4] || 1;
      pc.impPend = { c: kind, dv: best, n: 0, x: I[o + kind * 4 + 1] / J, y: I[o + kind * 4 + 2] / J, z: I[o + kind * 4 + 3] / J };
    }
  }

  _integrate(h) {
    const { x, px, v, w } = this;
    const g = this.p.gravity * this.gravityScale * h;
    const gx = this.tilt[0] * this.gravityScale * h, gz = this.tilt[1] * this.gravityScale * h;
    const n = this.nV;
    const aw = this._awake, vp = this.vPiece;
    for (let i = 0; i < n; i++) {
      if (w[i] === 0 || !aw[vp[i]]) continue;
      const o = i * 3;
      v[o] += gx;
      v[o + 1] += g;
      v[o + 2] += gz;
      px[o] = x[o]; px[o + 1] = x[o + 1]; px[o + 2] = x[o + 2];
      x[o] += v[o] * h; x[o + 1] += v[o + 1] * h; x[o + 2] += v[o + 2] * h;
    }
  }

  _solveTets(h) {
    const { T, B, vol0, x, w, tMu, tVS, tKs, tDmg } = this;
    const mu0 = this.p.mu;
    const lam = mu0 * this.p.lambdaRatio;
    // frozen tets stiffen, but only up to what these substeps can hold
    // (beyond it jagged shards ring at the speed limit)
    const sr = 1 / (h * 720), foam = Math.min(1, this.p.lambdaRatio / 6);
    const muHi = Math.max(mu0, 850 * this.p.density * this.p.size * this.p.size * (0.35 + 0.65 * foam) * Math.min(1, sr * sr));
    const boostHi = muHi / mu0;
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
      // frozen (stiffer) tets stiffen in volume too, keeping lambda/mu: a stiff
      // shear term against a soft volume term rings violently
      const boost = tMu[t] > 1 ? Math.min(tMu[t], boostHi) : tMu[t];
      // (a tear on its way through: it gives - see HandTool)
      const ks = tDmg[t] > 0 ? tKs[t] * (1 - 0.85 * tDmg[t]) : tKs[t];
      const mu = mu0 * boost * ks;
      const lamT = (boost > 1 ? lam * boost : lam) * ks;

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
      const gamma = 1 + mu / lamT;
      C = J - gamma;
      {
        const g1x = k0x * b00 + k1x * b01 + k2x * b02, g1y = k0y * b00 + k1y * b01 + k2y * b02, g1z = k0z * b00 + k1z * b01 + k2z * b02;
        const g2x = k0x * b10 + k1x * b11 + k2x * b12, g2y = k0y * b10 + k1y * b11 + k2y * b12, g2z = k0z * b10 + k1z * b11 + k2z * b12;
        const g3x = k0x * b20 + k1x * b21 + k2x * b22, g3y = k0y * b20 + k1y * b21 + k2y * b22, g3z = k0z * b20 + k1z * b21 + k2z * b22;
        const g0x = -g1x - g2x - g3x, g0y = -g1y - g2y - g3y, g0z = -g1z - g2z - g3z;
        // compression barrier: below ~1/3 volume the tet resists ever harder
        let alpha = ih2 / (lamT * V);
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

  _solveGrab(g, h) {
    const { x, px, w } = this;
    const ih2 = 1 / (h * h);
    // pressing hard into another piece: slow the pull down so contact can
    // shove that piece along instead of the grabbed core ploughing into it
    const press = (this._pressP && this._pressP[g.piece]) || 0;
    const ease = Math.max(0.08, 1 - Math.max(0, press - 0.006) / 0.02);
    // (firmer jelly pulls the held patch back harder before the next pull:
    // a longer reach keeps it with the hand)
    const gk = this.p.grabK;
    const maxStep = 0.012 * gk * this.p.size * ease * (1 + Math.min(2, Math.max(0, (this.p.mu - 100) / 70)));
    for (let j = 0; j < g.n; j++) {
      const i = g.idx[j];
      const wi = w[i];
      if (wi === 0) continue;
      const o = i * 3;
      const tx = g.tx + g.off[j * 3], ty = g.ty + g.off[j * 3 + 1], tz = g.tz + g.off[j * 3 + 2];
      const alpha = (g.compliance / (g.wt[j] * gk)) * ih2;
      const k = (wi / (wi + alpha)) * ease;
      x[o] += (tx - x[o]) * k;
      x[o + 1] += (ty - x[o + 1]) * k;
      x[o + 2] += (tz - x[o + 2]) * k;
      // drags can't outrun contact: cap how far a held vertex moves per substep
      const dx = x[o] - px[o], dy = x[o + 1] - px[o + 1], dz = x[o + 2] - px[o + 2];
      const dl = Math.hypot(dx, dy, dz);
      if (dl > maxStep) {
        const s = maxStep / dl;
        x[o] = px[o] + dx * s;
        x[o + 1] = px[o + 1] + dy * s;
        x[o + 2] = px[o + 2] + dz * s;
      }
    }
  }

  // A round flat face (the mallet head) travelling along d from s0 to s1
  // over this frame: jelly it passes is carried along on the face, a softer
  // rim around it drags the surface down into a bowl. Pusher:
  // { c: [x,y,z] contact point, d: unit direction, r, len, s0, s1 }
  _solvePushers(frac) {
    const { x, w } = this;
    const aw = this._awake, vp = this.vPiece;
    for (const P of this.pushers) {
      const s = P.s0 + (P.s1 - P.s0) * frac;
      if (s <= 0) continue;
      const cx = P.c[0], cy = P.c[1], cz = P.c[2], dx = P.d[0], dy = P.d[1], dz = P.d[2];
      const r = P.r, R = r * 1.9, R2 = R * R, back = s - P.len;
      for (let i = 0; i < this.nV; i++) {
        if (w[i] === 0 || !aw[vp[i]]) continue;
        const o = i * 3;
        const ex = x[o] - cx, ey = x[o + 1] - cy, ez = x[o + 2] - cz;
        const al = ex * dx + ey * dy + ez * dz;
        if (al >= s || al < back) continue;
        const qx = ex - al * dx, qy = ey - al * dy, qz = ez - al * dz;
        const q2 = qx * qx + qy * qy + qz * qz;
        if (q2 > R2) continue;
        let k = s - al;
        if (q2 > r * r) {
          // rim: pressed in less the further out
          const u = 1 - (Math.sqrt(q2) - r) / (R - r);
          k *= u * u * 0.6;
        }
        x[o] += dx * k; x[o + 1] += dy * k; x[o + 2] += dz * k;
      }
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

  // Floor, ceiling and arena wall. Contacts are projected here; their
  // friction is applied to the velocities (see _updateVelocities) - doing it
  // on positions after the elastic solve fed energy into resting pieces and
  // kept them rocking forever.
  _solveBounds(h) {
    const { x, w, m, fpen, wpen } = this;
    const R = this.p.arenaRadius, R2 = R * R;
    const top = this.p.ceiling;
    const n = this.nV;
    const aw = this._awake, vp = this.vPiece, I = this._imp;
    for (let i = 0; i < n; i++) {
      if (w[i] === 0 || !aw[vp[i]]) continue;
      const o = i * 3;
      const y = x[o + 1];
      fpen[i] = 0;
      wpen[i] = 0;
      if (y < 0) {
        x[o + 1] = 0;
        fpen[i] = -y;
        const q = vp[i] * 12, J = -y * m[i];
        I[q] += J; I[q + 1] += J * x[o]; I[q + 3] += J * x[o + 2];
      } else if (y > top) x[o + 1] = top;
      const r2 = x[o] * x[o] + x[o + 2] * x[o + 2];
      if (r2 > R2) {
        const r = Math.sqrt(r2);
        const s = R / r;
        x[o] *= s;
        x[o + 2] *= s;
        wpen[i] = r - R;
        const q = vp[i] * 12 + 4, J = (r - R) * m[i];
        I[q] += J; I[q + 1] += J * x[o]; I[q + 2] += J * x[o + 1]; I[q + 3] += J * x[o + 2];
      }
    }
  }

  _updateVelocities(h) {
    const { x, px, v, w, fpen, wpen } = this;
    const ih = 1 / h;
    const n = this.nV;
    const vmax = this.p.maxSpeed, vmax2 = vmax * vmax;
    const mu = this.p.friction;
    const aw = this._awake, vp = this.vPiece;
    for (let i = 0; i < n; i++) {
      if (w[i] === 0 || !aw[vp[i]]) continue;
      const o = i * 3;
      let vx = (x[o] - px[o]) * ih, vy = (x[o + 1] - px[o + 1]) * ih, vz = (x[o + 2] - px[o + 2]) * ih;
      // Coulomb friction: tangential speed drops by mu x the normal speed
      // the contact took away (sticks when that is enough to stop it)
      if (fpen[i] > 0) {
        const vt = Math.sqrt(vx * vx + vz * vz);
        if (vt > 0) {
          const k = Math.max(0, 1 - (mu * fpen[i] * ih) / vt);
          vx *= k;
          vz *= k;
        }
      }
      if (wpen[i] > 0) {
        const r = Math.sqrt(x[o] * x[o] + x[o + 2] * x[o + 2]) || 1;
        const nx = x[o] / r, nz = x[o + 2] / r;
        const vn = vx * nx + vz * nz;
        const tx = vx - vn * nx, tz = vz - vn * nz;
        const tl = Math.sqrt(tx * tx + vy * vy + tz * tz);
        if (tl > 0) {
          const k = Math.max(0, 1 - (0.47 * this.p.friction * wpen[i] * ih) / tl); // (the wall grips as the floor does: 0.4 at the default Grip)
          vx = vn * nx + tx * k;
          vy *= k;
          vz = vn * nz + tz * k;
        }
      }
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
    const kd = 1 - Math.exp(-this.p.damping * dt * (this.dampBoost || 1) * (this.calmT > 0 ? 10 : 1));
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
      pc.omega[0] = wx;
      pc.omega[1] = wy;
      pc.omega[2] = wz;
      if (pc.asleep) {
        pc.vib = 0;
        continue;
      }
      let vmax2 = 0, e2 = 0;
      for (let k = 0; k < vs.length; k++) {
        const o = vs[k] * 3;
        const s2 = v[o] * v[o] + v[o + 1] * v[o + 1] + v[o + 2] * v[o + 2];
        if (s2 > vmax2) vmax2 = s2;
        e2 += s2 * m[vs[k]];
      }
      const vrms2 = e2 / M;
      // A piece that isn't going anywhere but won't go quiet - a few of its
      // vertices buzzing against a neighbour it rests on - sleeps anyway: its
      // middle still and not turning for 1.5 s while the buzz doesn't die
      // down (its second half as strong as the first; a wobble decays, even
      // a water balloon's, and is left to settle the usual way).
      let buzzing = false;
      const vrms = Math.sqrt(vrms2);
      if (vx * vx + vy * vy + vz * vz < 0.03 * 0.03 && wx * wx + wy * wy + wz * wz < 0.3 * 0.3 && vrms < 0.15) {
        if (pc.buzzT < 0.75) pc.buzzA += vrms * dt;
        else pc.buzzB += vrms * dt;
        pc.buzzT += dt;
        if (pc.buzzT > 1.5) {
          buzzing = pc.buzzB > 0.85 * pc.buzzA;
          pc.buzzT = pc.buzzA = pc.buzzB = 0;
        }
      } else pc.buzzT = pc.buzzA = pc.buzzB = 0;
      if (buzzing || (vrms2 < 0.035 * 0.035 && vmax2 < 0.3 * 0.3)) {
        pc.sleepT += buzzing ? 1 : dt;
        if (pc.sleepT > 0.6) {
          pc.asleep = true;
          pc.vib = 0;
          pc.foldAsk = true; // (not to be left asleep folded into itself)
          for (let k = 0; k < vs.length; k++) {
            const o = vs[k] * 3;
            v[o] = v[o + 1] = v[o + 2] = 0;
          }
          continue;
        }
      } else pc.sleepT = 0;
      let dev2 = 0;
      for (let k = 0; k < vs.length; k++) {
        const i = vs[k], o = i * 3;
        const rx = x[o] - cx, ry = x[o + 1] - cy, rz = x[o + 2] - cz;
        const rvx = vx + wy * rz - wz * ry, rvy = vy + wz * rx - wx * rz, rvz = vz + wx * ry - wy * rx;
        const ux = v[o] - rvx, uy = v[o + 1] - rvy, uz = v[o + 2] - rvz;
        dev2 += m[i] * (ux * ux + uy * uy + uz * uz);
        v[o] = (rvx + (v[o] - rvx) * (1 - kd)) * air;
        v[o + 1] = (rvy + (v[o + 1] - rvy) * (1 - kd)) * air;
        v[o + 2] = (rvz + (v[o + 2] - rvz) * (1 - kd)) * air;
      }
      pc.vib = Math.sqrt(dev2 / M);
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
      if (this.heatActive) this.wakeAll();
      this.heatActive = false;
      const NP = this.pieces.length, tp = this.tPiece;
      const pmu = this._pmu && this._pmu.length >= NP ? this._pmu : (this._pmu = new Float64Array(Math.max(NP, 64)));
      pmu.fill(0, 0, NP);
      for (let t = 0; t < this.nT; t++) {
        const o = t * 4;
        const tt = (temp[T[o]] + temp[T[o + 1]] + temp[T[o + 2]] + temp[T[o + 3]]) * 0.25;
        tMu[t] = tt >= 0 ? Math.max(0.035, Math.exp(-3.2 * tt)) : 1 + 14 * Math.min(1, -tt) * Math.min(1, -tt);
        if (tp[t] >= 0) pmu[tp[t]] += Math.log(tMu[t]);
      }
      // a sleeping piece wakes once it has warmed/cooled enough to change
      // its firmness noticeably (thawing alone shouldn't keep it awake)
      for (let k = 0; k < NP; k++) {
        const pc = this.pieces[k];
        const lm = pmu[k] / Math.max(1, pc.tets.length);
        if (!pc.asleep || pc.sleepLogMu === undefined) pc.sleepLogMu = lm;
        else if (Math.abs(lm - pc.sleepLogMu) > 0.2) this.wake(k);
      }
    }
    // glow decays
    const gd = Math.exp(-dt * 1.6);
    for (let i = 0; i < nV; i++) if (this.glow[i] > 0.001) this.glow[i] *= gd;
    else this.glow[i] = 0;
  }

  // ---------------------------------------------------------------- piece contact
  // Broad phase for piece-vs-piece contact, once per frame. Everything is
  // swept over the frame (from x to x + v dt) so fast pieces are caught:
  // pairs of pieces whose swept boxes meet, a spatial hash of their tets'
  // swept boxes (keyed by cell and piece), and per probe (surface vertex or
  // face centre) the other-piece tets its own swept box overlaps.
  _buildCollisionHash() {
    const { x, v, T } = this;
    const nT = this.nT, NP = this.pieces.length, nV = this.nV;
    const fdt = this._hashSpan;
    const NP64 = Math.max(NP, 64);
    const bb = this._pbb && this._pbb.length >= NP * 6 ? this._pbb : (this._pbb = new Float64Array(NP64 * 6));
    const pcs = this._pcs && this._pcs.length >= NP ? this._pcs : (this._pcs = new Float64Array(NP64));
    for (let k = 0; k < NP; k++) {
      bb[k * 6] = bb[k * 6 + 1] = bb[k * 6 + 2] = Infinity;
      bb[k * 6 + 3] = bb[k * 6 + 4] = bb[k * 6 + 5] = -Infinity;
      pcs[k] = 0;
    }
    // Sweeps are relative: each vertex box is swept by how the vertex moves
    // *within its piece* (its velocity minus the piece's mean velocity), and
    // pieces add their velocity difference pair by pair - chunks flying
    // apart together barely sweep at all. D: each vertex's whole move this
    // frame, for the per-candidate test below.
    const sw = this._sweep && this._sweep.length >= nV * 6 ? this._sweep : (this._sweep = new Float32Array(this.vCap * 6));
    const D = this._disp && this._disp.length >= nV * 3 ? this._disp : (this._disp = new Float32Array(this.vCap * 3));
    const P = this.pieces;
    const pV = this._pVel && this._pVel.length >= NP * 3 ? this._pVel : (this._pVel = new Float64Array(NP64 * 3));
    const pM = this._pMass && this._pMass.length >= NP ? this._pMass : (this._pMass = new Float64Array(NP64));
    pV.fill(0, 0, NP * 3);
    pM.fill(0, 0, NP);
    // (fresh: pieces a cut just made have no velocity history)
    for (let i = 0; i < nV; i++) {
      const k = this.vPiece[i];
      if (k < 0 || !this.w[i]) continue;
      const o = i * 3, mi = this.m[i];
      pV[k * 3] += v[o] * mi; pV[k * 3 + 1] += v[o + 1] * mi; pV[k * 3 + 2] += v[o + 2] * mi;
      pM[k] += mi;
    }
    for (let k = 0; k < NP; k++) {
      const im = pM[k] > 0 ? 1 / pM[k] : 0;
      pV[k * 3] *= im; pV[k * 3 + 1] *= im; pV[k * 3 + 2] *= im;
    }
    // a held piece goes where the hand pulls it (up to the per-substep
    // cap); two hands on one piece: the stronger pull for the piece, the
    // other's on its own held vertices
    const lead = this._leadP && this._leadP.length >= NP * 4 ? this._leadP : (this._leadP = new Float64Array(NP64 * 4));
    const vLead = this.grabs.length > 1 ? (this._leadV && this._leadV.length >= nV * 3 ? this._leadV : (this._leadV = new Float32Array(this.vCap * 3))) : null;
    if (vLead) vLead.fill(0, 0, nV * 3);
    lead.fill(0, 0, NP * 4);
    for (const g of this.grabs) {
      let lx = 0, ly = 0, lz = 0;
      for (let j = 0; j < g.n; j++) {
        const o = g.idx[j] * 3;
        lx += g.tx + g.off[j * 3] - x[o];
        ly += g.ty + g.off[j * 3 + 1] - x[o + 1];
        lz += g.tz + g.off[j * 3 + 2] - x[o + 2];
      }
      const l = Math.hypot(lx, ly, lz) / g.n, lm = 0.012 * this.p.size * this.p.substeps;
      const s = l > lm ? lm / l / g.n : 1 / g.n;
      lx *= s; ly *= s; lz *= s;
      const q = g.piece * 4, m = Math.hypot(lx, ly, lz);
      if (g.piece < 0 || g.piece >= NP) continue;
      if (m >= lead[q + 3]) {
        // (the weaker one, if any, goes onto its own vertices)
        if (vLead && lead[q + 3] > 0) {
          for (const g2 of this.grabs) if (g2 !== g && g2.piece === g.piece) for (let j = 0; j < g2.n; j++) { const o = g2.idx[j] * 3; vLead[o] = lead[q] ; vLead[o + 1] = lead[q + 1]; vLead[o + 2] = lead[q + 2]; }
        }
        lead[q] = lx; lead[q + 1] = ly; lead[q + 2] = lz; lead[q + 3] = m;
      } else if (vLead) {
        for (let j = 0; j < g.n; j++) { const o = g.idx[j] * 3; vLead[o] = lx; vLead[o + 1] = ly; vLead[o + 2] = lz; }
      }
    }
    const anyGrab = this.grabs.length > 0;
    for (let i = 0; i < nV; i++) {
      const o = i * 3, r = i * 6;
      const ax = x[o], ay = x[o + 1], az = x[o + 2];
      const kp = Math.max(0, this.vPiece[i]) * 3;
      let ex = v[o] * fdt, ey = v[o + 1] * fdt, ez = v[o + 2] * fdt;
      if (anyGrab && this.vPiece[i] >= 0) {
        const q = this.vPiece[i] * 4;
        if (lead[q + 3] > 0) {
          if (vLead && (vLead[o] || vLead[o + 1] || vLead[o + 2])) {
            ex += vLead[o]; ey += vLead[o + 1]; ez += vLead[o + 2];
          } else {
            ex += lead[q]; ey += lead[q + 1]; ez += lead[q + 2];
          }
        }
      }
      D[o] = ex; D[o + 1] = ey; D[o + 2] = ez;
      const dx = ex - pV[kp] * fdt, dy = ey - pV[kp + 1] * fdt, dz = ez - pV[kp + 2] * fdt;
      const gr = 0.003 + 0.12 * (Math.abs(dx) + Math.abs(dy) + Math.abs(dz));
      sw[r] = (dx < 0 ? ax + dx : ax) - gr;
      sw[r + 1] = (dy < 0 ? ay + dy : ay) - gr;
      sw[r + 2] = (dz < 0 ? az + dz : az) - gr;
      sw[r + 3] = (dx > 0 ? ax + dx : ax) + gr;
      sw[r + 4] = (dy > 0 ? ay + dy : ay) + gr;
      sw[r + 5] = (dz > 0 ? az + dz : az) + gr;
      const k = this.vPiece[i];
      if (k < 0 || !this.w[i]) continue;
      const sl = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) + gr;
      if (sl > pcs[k]) pcs[k] = sl;
      const b = k * 6;
      if (sw[r] < bb[b]) bb[b] = sw[r];
      if (sw[r + 1] < bb[b + 1]) bb[b + 1] = sw[r + 1];
      if (sw[r + 2] < bb[b + 2]) bb[b + 2] = sw[r + 2];
      if (sw[r + 3] > bb[b + 3]) bb[b + 3] = sw[r + 3];
      if (sw[r + 4] > bb[b + 4]) bb[b + 4] = sw[r + 4];
      if (sw[r + 5] > bb[b + 5]) bb[b + 5] = sw[r + 5];
    }
    // hash cells per piece: fine for slow pieces, as coarse as the sweep for
    // fast ones (so a fast tet still lands in only a few cells)
    for (let k = 0; k < NP; k++) pcs[k] = 1 / (this.hCell * 0.75 + pcs[k]);
    // pairs whose swept boxes overlap (and aren't both asleep): partner lists
    const act = this._pieceActive && this._pieceActive.length >= NP ? this._pieceActive : (this._pieceActive = new Uint8Array(NP64));
    act.fill(0);
    const ptS = this._ptS && this._ptS.length >= NP + 1 ? this._ptS : (this._ptS = new Int32Array(NP64 + 1));
    const pairs = [];
    const m = 0.006;
    for (let a = 0; a < NP; a++)
      for (let b = a + 1; b < NP; b++) {
        if (P[a].asleep && P[b].asleep) continue;
        const A = a * 6, B = b * 6;
        // a's box swept by how it moves relative to b this frame
        const rx = (pV[a * 3] - pV[b * 3]) * fdt, ry = (pV[a * 3 + 1] - pV[b * 3 + 1]) * fdt, rz = (pV[a * 3 + 2] - pV[b * 3 + 2]) * fdt;
        const rm = m + 0.12 * (Math.abs(rx) + Math.abs(ry) + Math.abs(rz));
        const ax0 = bb[A] + Math.min(0, rx), ay0 = bb[A + 1] + Math.min(0, ry), az0 = bb[A + 2] + Math.min(0, rz);
        const ax1 = bb[A + 3] + Math.max(0, rx), ay1 = bb[A + 4] + Math.max(0, ry), az1 = bb[A + 5] + Math.max(0, rz);
        if (ax0 - rm > bb[B + 3] || bb[B] - rm > ax1 || ay0 - rm > bb[B + 4] || bb[B + 1] - rm > ay1 || az0 - rm > bb[B + 5] || bb[B + 2] - rm > az1) continue;
        act[a] = act[b] = 1;
        pairs.push(a, b);
      }
    // and each awake piece against itself (see gather): 2 = only that, so
    // only the tets touching its surface need hashing (see _sizeContactScratch)
    const selfOK = this._selfOK && this._selfOK.length >= NP ? this._selfOK : (this._selfOK = new Uint8Array(NP64));
    let anySelf = false;
    // (where it can fold onto itself: a flap on a hinge, or soft jelly -
    // firmer jelly doesn't fold far enough, even dragged by a corner)
    const soft = this.p.mu < 110, quiet = this.time < this.selfQuietUntil;
    for (let a = 0; a < NP; a++) {
      // (or anything with a fold in it to pop out - all its tets, as the
      // fold can reach past the layer at the surface)
      const folded = P[a].foldUntil > this.time;
      const can = this.p.selfCollide && !quiet && !P[a].asleep && !(P[a].untangle > 0) && (P[a].hinge || soft || folded), ac = act[a];
      selfOK[a] = can ? (ac || folded ? 1 : 2) : 0;
      anySelf = anySelf || selfOK[a] > 0;
    }
    // (only the surface vertices near another part of their own body - see _selfCheck)
    if (anySelf) anySelf = this._selfCheck(NP);
    this._anyContact = pairs.length > 0 || anySelf;
    if (!this._anyContact) return;
    ptS.fill(0, 0, NP + 1);
    for (let k = 0; k < pairs.length; k++) ptS[pairs[k] + 1]++;
    for (let k = 0; k < NP; k++) ptS[k + 1] += ptS[k];
    const ptL = new Int32Array(pairs.length);
    const ptF = ptS.slice(0, NP);
    for (let k = 0; k < pairs.length; k += 2) {
      ptL[ptF[pairs[k]]++] = pairs[k + 1];
      ptL[ptF[pairs[k + 1]]++] = pairs[k];
    }
    // contact found last substep, per probe (tet, face): usually still right
    if (this._warmVersion !== this.topoVersion || !this._wtV || this._wtV.length < nV) {
      this._wtV = new Int32Array(this.vCap).fill(-1);
      this._wfV = new Int32Array(this.vCap).fill(-1);
      this._wtF = new Int32Array(Math.max(this.nF, 1)).fill(-1);
      this._wfF = new Int32Array(Math.max(this.nF, 1)).fill(-1);
      this._warmVersion = this.topoVersion;
    }
    this._hashTets();
    this._gatherProbes(ptL);
  }

  // Folds: every so often (and when a piece falls asleep) look for surface
  // vertices that have ended up inside their own body - in a tet more than
  // 2 steps from them in the mesh, so not just pressed into a crease. A
  // drag can push a fold through faster than contact holds it, and firm
  // jelly isn't watched for self-contact at all; anything found is held as
  // folded for a moment: its piece runs self-contact on all its tets, those
  // vertices probe, and they pop back out (see _selfCheck, _contact).
  _foldCheck(dt) {
    const P = this.pieces, NP = P.length;
    if (!this.p.selfCollide || !NP) return;
    this._foldClock += dt;
    let ask = false;
    for (let k = 0; k < NP; k++) if (P[k].foldAsk) ask = true;
    if (this._foldClock < 0.12 && !ask) return;
    this._foldClock = 0;
    // which pieces: any that just fell asleep, then awake ones in turn, up
    // to a budget of tets a look (lots of pieces: a few per look)
    const look = this._foldLook;
    look.fill(0, 0, NP);
    let nLook = 0, budget = 3500;
    for (let k = 0; k < NP; k++) {
      if (!P[k].foldAsk) continue;
      P[k].foldAsk = false;
      look[k] = 1;
      nLook++;
      budget -= P[k].tets.length;
    }
    for (let n = 0; n < NP && budget > 0; n++) {
      const k = (this._foldNext + n) % NP;
      if (look[k] || P[k].asleep || P[k].tets.length <= 8) continue;
      look[k] = 1;
      nLook++;
      budget -= P[k].tets.length;
      this._foldNext = k + 1;
    }
    if (!nLook) return;
    const x = this.x, T = this.T, tp = this.tPiece, nT = this.nT;
    // the looked-at pieces' tets in a grid about a tet across (box and cell
    // range per tet)
    const C = 0.9 * this.hCell, iC = 1 / C;
    const box = this._fgBox, cnt = this._fgCount, rng = this._hRanges;
    let total = 0;
    for (let t = 0; t < nT; t++) {
      const r = t * 6;
      if (!look[tp[t]] || this.vol0[t] <= 0) {
        rng[r] = 1; rng[r + 1] = 0; // (none)
        continue;
      }
      const o = t * 4;
      const a = T[o] * 3, b = T[o + 1] * 3, c = T[o + 2] * 3, d = T[o + 3] * 3;
      let v0 = x[a], v1 = x[b], v2 = x[c], v3 = x[d];
      box[r] = Math.min(v0, v1, v2, v3); box[r + 3] = Math.max(v0, v1, v2, v3);
      v0 = x[a + 1]; v1 = x[b + 1]; v2 = x[c + 1]; v3 = x[d + 1];
      box[r + 1] = Math.min(v0, v1, v2, v3); box[r + 4] = Math.max(v0, v1, v2, v3);
      v0 = x[a + 2]; v1 = x[b + 2]; v2 = x[c + 2]; v3 = x[d + 2];
      box[r + 2] = Math.min(v0, v1, v2, v3); box[r + 5] = Math.max(v0, v1, v2, v3);
      rng[r] = Math.floor(box[r] * iC); rng[r + 1] = Math.floor(box[r + 3] * iC);
      rng[r + 2] = Math.floor(box[r + 1] * iC); rng[r + 3] = Math.floor(box[r + 4] * iC);
      rng[r + 4] = Math.floor(box[r + 2] * iC); rng[r + 5] = Math.floor(box[r + 5] * iC);
      total += (rng[r + 1] - rng[r] + 1) * (rng[r + 3] - rng[r + 2] + 1) * (rng[r + 5] - rng[r + 4] + 1);
    }
    let size = 1024;
    while (size < total * 2 && size < 1 << 14) size <<= 1;
    const mask = size - 1;
    cnt.fill(0, 0, size + 1);
    for (let t = 0; t < nT; t++) {
      const r = t * 6;
      for (let ix = rng[r]; ix <= rng[r + 1]; ix++)
        for (let iy = rng[r + 2]; iy <= rng[r + 3]; iy++)
          for (let iz = rng[r + 4]; iz <= rng[r + 5]; iz++) cnt[((Math.imul(ix, 92837111) ^ Math.imul(iy, 689287499) ^ Math.imul(iz, 283923481)) & mask) + 1]++;
    }
    for (let k = 0; k < size; k++) cnt[k + 1] += cnt[k];
    const ent = this._fgEnt.length >= total ? this._fgEnt : (this._fgEnt = new Int32Array(total * 2));
    const fill = this._svFill.length >= size ? this._svFill : (this._svFill = new Int32Array(size));
    fill.set(cnt.subarray(0, size));
    for (let t = 0; t < nT; t++) {
      const r = t * 6;
      for (let ix = rng[r]; ix <= rng[r + 1]; ix++)
        for (let iy = rng[r + 2]; iy <= rng[r + 3]; iy++)
          for (let iz = rng[r + 4]; iz <= rng[r + 5]; iz++) ent[fill[(Math.imul(ix, 92837111) ^ Math.imul(iy, 689287499) ^ Math.imul(iz, 283923481)) & mask]++] = t;
    }
    // every surface vertex of those pieces against its own tets: well inside
    // one (not on its skin) that isn't within 2 steps of it in the mesh
    const sv = this._surfV, nSV = this._nSurfV, vp = this.vPiece, hood = this._hood;
    const nbS = this.nbStart, nbL = this.nbList, foldU = this._foldUntil, ct = this._ct;
    const hold = this.time + 0.6, X = this.X, near2 = (1.1 * this.hCell) ** 2;
    let hs = this._hoodStamp;
    for (let q = 0; q < nSV; q++) {
      const i = sv[q], k = vp[i];
      if (k < 0 || !look[k]) continue;
      const px = x[i * 3], py = x[i * 3 + 1], pz = x[i * 3 + 2];
      const h = (Math.imul(Math.floor(px * iC), 92837111) ^ Math.imul(Math.floor(py * iC), 689287499) ^ Math.imul(Math.floor(pz * iC), 283923481)) & mask;
      let stamped = false;
      for (let e = cnt[h]; e < cnt[h + 1]; e++) {
        const t = ent[e];
        if (tp[t] !== k) continue;
        const r = t * 6;
        if (px < box[r] || px > box[r + 3] || py < box[r + 1] || py > box[r + 4] || pz < box[r + 2] || pz > box[r + 5]) continue;
        const o = t * 4;
        if (T[o] === i || T[o + 1] === i || T[o + 2] === i || T[o + 3] === i) continue;
        if (!(this._tetGap(t, px, py, pz) < 0) || Math.min(ct.b0, ct.b1, ct.b2, ct.b3) <= 0.02) continue;
        // (inside one: is it a neighbour's? its 2 steps, stamped the first time)
        if (!stamped) {
          stamped = true;
          hs++;
          hood[i] = hs;
          for (let e1 = nbS[i]; e1 < nbS[i + 1]; e1++) {
            const u = nbL[e1];
            hood[u] = hs;
            for (let e2 = nbS[u]; e2 < nbS[u + 1]; e2++) hood[nbL[e2]] = hs;
          }
        }
        if (hood[T[o]] === hs || hood[T[o + 1]] === hs || hood[T[o + 2]] === hs || hood[T[o + 3]] === hs) continue;
        // (nor one from just across a cut - the face it was cut from, where it
        // lay at rest: the cut's two faces pressed together read as folded, and
        // pushing them apart against the body pulling them back rocked a
        // part-cut firm cube for ever)
        let across = false;
        for (let j = 0; j < 4 && !across; j++) {
          const u = T[o + j] * 3, dx = X[u] - X[i * 3], dy = X[u + 1] - X[i * 3 + 1], dz = X[u + 2] - X[i * 3 + 2];
          across = dx * dx + dy * dy + dz * dz < near2;
        }
        if (across) continue;
        foldU[i] = hold;
        P[k].foldUntil = hold;
        if (P[k].asleep) this.wake(k);
        break;
      }
    }
    this._hoodStamp = hs;
  }

  // Every 0.25 s, a look at awake pieces held or blasted in the last 4 s but
  // not held now (round-robin, a budget of tets a look) for surfaces passed
  // through themselves; found
  // twice in a row - not just a moment of a fold coming undone - the piece
  // springs back out of it (see _untangle).
  _tangleCheck(dt) {
    const P = this.pieces, NP = P.length;
    if (!this.p.selfCollide || !NP) return;
    this._tangleClock += dt;
    if (this._tangleClock < 0.25) return;
    this._tangleClock = 0;
    const look = this._tgLook && this._tgLook.length >= NP ? this._tgLook : (this._tgLook = new Uint8Array(Math.max(NP, 64)));
    const out = this._tgOut && this._tgOut.length >= NP ? this._tgOut : (this._tgOut = new Int32Array(Math.max(NP, 64)));
    look.fill(0, 0, NP);
    out.fill(0, 0, NP);
    const GP = this.grabs.length ? this._grabbedP : null;
    let budget = 9000, any = false;
    for (let n = 0; n < NP && budget > 0; n++) {
      const k = (this._tangleNext + n) % NP, pc = P[k];
      // (not a piece still joined across a cut - a flap on its hinge: the cut's
      // two faces lie against each other and read as passing through, and its
      // rest shape is the whole cube - springing back closed the cut, the
      // halves fell open again, and round it went: the "twerk")
      if (pc.asleep || pc.hinge || (GP && GP[k]) || pc.untangle > 0 || pc.verts.length < 30 || this.time - pc.touchT > 4) continue;
      // (a tangle three springings back haven't undone - a fold stuck fast -
      // is left be till the piece is next touched: trying for ever kept it
      // awake, pulled about, for ever)
      if (pc.tangleTouch !== pc.touchT) {
        pc.tangleTouch = pc.touchT;
        pc.tangleTries = 0;
      }
      if (pc.tangleTries >= 3) continue;
      look[k] = 1;
      any = true;
      budget -= pc.tets.length;
      this._tangleNext = k + 1;
    }
    if (!any) return;
    this._tangleCount(look, out);
    for (let k = 0; k < NP; k++) {
      if (!look[k]) continue;
      const pc = P[k];
      if (!out[k]) pc.tangleN = 0;
      else if (++pc.tangleN >= 2) {
        pc.tangleN = 0;
        pc.untangle = 0.7;
        pc.tangleTries++;
      }
    }
  }

  // Rigidity (p.rigidity, 0..1): each moving piece pulled toward its rest
  // shape, turned and placed as the piece is now (shape matching, Muller et
  // al. 2005; the turn by polarRot, warm from the last substep). What the
  // tets alone can't be made to hold at a stable time step: stiff, dead,
  // near-rigid bodies. A time constant, not a per-substep share, so it feels
  // the same at any substep count: 0.5 s at 0 (off) down to 0.5 ms at 1.
  // Vertices a hand holds aren't pulled back (else a stiff piece fought the
  // hand every substep) - nor ones with no mass (w = 0).
  _solveRigidity(h) {
    const r = this.p.rigidity;
    const amt = 1 - Math.exp(-h / (0.5 * Math.pow(10, -3 * r)));
    if (!(amt > 1e-4)) return;
    const P = this.pieces, x = this.x, X = this.X, m = this.m, w = this.w, aw = this._awake;
    const A = this._rgA || (this._rgA = new Float64Array(9)), R = this._rgR || (this._rgR = new Float64Array(9));
    let held = null;
    if (this.grabs.length) {
      held = this._rgHeld && this._rgHeld.length >= this.nV ? this._rgHeld : (this._rgHeld = new Uint8Array(this.vCap));
      held.fill(0, 0, this.nV);
      for (const g of this.grabs) for (let j = 0; j < g.n; j++) held[g.idx[j]] = 1;
    }
    for (let k = 0; k < P.length; k++) {
      const pc = P[k];
      if (!aw[k] || pc.untangle > 0) continue;
      const vs = pc.verts;
      let M = 0, Cx = 0, Cy = 0, Cz = 0, cx = 0, cy = 0, cz = 0;
      for (let n = 0; n < vs.length; n++) {
        const i = vs[n], o = i * 3, mi = m[i];
        M += mi;
        Cx += X[o] * mi; Cy += X[o + 1] * mi; Cz += X[o + 2] * mi;
        cx += x[o] * mi; cy += x[o + 1] * mi; cz += x[o + 2] * mi;
      }
      if (!(M > 0)) continue;
      Cx /= M; Cy /= M; Cz /= M; cx /= M; cy /= M; cz /= M;
      A.fill(0);
      for (let n = 0; n < vs.length; n++) {
        const i = vs[n], o = i * 3, mi = m[i];
        const dx = (x[o] - cx) * mi, dy = (x[o + 1] - cy) * mi, dz = (x[o + 2] - cz) * mi;
        const rx = X[o] - Cx, ry = X[o + 1] - Cy, rz = X[o + 2] - Cz;
        A[0] += dx * rx; A[1] += dx * ry; A[2] += dx * rz;
        A[3] += dy * rx; A[4] += dy * ry; A[5] += dy * rz;
        A[6] += dz * rx; A[7] += dz * ry; A[8] += dz * rz;
      }
      polarRot(pc.rigQ, A, R, 4);
      for (let n = 0; n < vs.length; n++) {
        const i = vs[n];
        if (w[i] === 0 || (held && held[i])) continue;
        const o = i * 3, rx = X[o] - Cx, ry = X[o + 1] - Cy, rz = X[o + 2] - Cz;
        x[o] += amt * (cx + R[0] * rx + R[1] * ry + R[2] * rz - x[o]);
        x[o + 1] += amt * (cy + R[3] * rx + R[4] * ry + R[5] * rz - x[o + 1]);
        x[o + 2] += amt * (cz + R[6] * rx + R[7] * ry + R[8] * rz - x[o + 2]);
      }
    }
  }

  // A piece passed through itself springs back to its rest shape - turned
  // and sized to fit how it lies now, on the floor - a share each frame for
  // 0.7 s, its self-contact off meanwhile so the surfaces can slip back
  // through each other. (Its rest shape has nothing passed through; self-
  // contact would only hold the tangle in place, and pulling it apart from
  // the inside made it worse.)
  _untangle(dt) {
    const P = this.pieces, x = this.x, X = this.X, v = this.v, m = this.m;
    for (let k = 0; k < P.length; k++) {
      const pc = P[k];
      if (!(pc.untangle > 0)) continue;
      if (this.grabs.length && this._grabbedP && this._grabbedP[k]) {
        pc.untangle = 0;
        continue;
      }
      pc.untangle -= dt;
      if (pc.asleep) this.wake(k);
      const vs = pc.verts;
      let M = 0, Cx = 0, Cy = 0, Cz = 0, cx = 0, cy = 0, cz = 0, ux = 0, uy = 0, uz = 0;
      for (let n = 0; n < vs.length; n++) {
        const i = vs[n], o = i * 3, w = m[i];
        M += w;
        Cx += X[o] * w; Cy += X[o + 1] * w; Cz += X[o + 2] * w;
        cx += x[o] * w; cy += x[o + 1] * w; cz += x[o + 2] * w;
        ux += v[o] * w; uy += v[o + 1] * w; uz += v[o + 2] * w;
      }
      if (M <= 0) continue;
      Cx /= M; Cy /= M; Cz /= M; cx /= M; cy /= M; cz /= M; ux /= M; uy /= M; uz /= M;
      // A = sum m (x - c)(X - C)^T, columns a0 a1 a2
      let a00 = 0, a01 = 0, a02 = 0, a10 = 0, a11 = 0, a12 = 0, a20 = 0, a21 = 0, a22 = 0, den = 0;
      for (let n = 0; n < vs.length; n++) {
        const i = vs[n], o = i * 3, w = m[i];
        const dx = (x[o] - cx) * w, dy = (x[o + 1] - cy) * w, dz = (x[o + 2] - cz) * w;
        const rx = X[o] - Cx, ry = X[o + 1] - Cy, rz = X[o + 2] - Cz;
        a00 += dx * rx; a10 += dy * rx; a20 += dz * rx;
        a01 += dx * ry; a11 += dy * ry; a21 += dz * ry;
        a02 += dx * rz; a12 += dy * rz; a22 += dz * rz;
        den += w * (rx * rx + ry * ry + rz * rz);
      }
      if (den <= 0) continue;
      // its rotation (Muller et al. 2016: iterate q toward the polar part of A)
      const q = pc.fitQ;
      let r00 = 1, r01 = 0, r02 = 0, r10 = 0, r11 = 1, r12 = 0, r20 = 0, r21 = 0, r22 = 1;
      for (let it = 0; it < 20; it++) {
        const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
        r00 = 1 - 2 * (qy * qy + qz * qz); r01 = 2 * (qx * qy - qz * qw); r02 = 2 * (qx * qz + qy * qw);
        r10 = 2 * (qx * qy + qz * qw); r11 = 1 - 2 * (qx * qx + qz * qz); r12 = 2 * (qy * qz - qx * qw);
        r20 = 2 * (qx * qz - qy * qw); r21 = 2 * (qy * qz + qx * qw); r22 = 1 - 2 * (qx * qx + qy * qy);
        // omega = sum_j col_j(R) x col_j(A) / |sum_j col_j(R) . col_j(A)|
        let ox = (r10 * a20 - r20 * a10) + (r11 * a21 - r21 * a11) + (r12 * a22 - r22 * a12);
        let oy = (r20 * a00 - r00 * a20) + (r21 * a01 - r01 * a21) + (r22 * a02 - r02 * a22);
        let oz = (r00 * a10 - r10 * a00) + (r01 * a11 - r11 * a01) + (r02 * a12 - r12 * a02);
        const dd = Math.abs(r00 * a00 + r10 * a10 + r20 * a20 + r01 * a01 + r11 * a11 + r21 * a21 + r02 * a02 + r12 * a12 + r22 * a22) + 1e-12;
        ox /= dd; oy /= dd; oz /= dd;
        const wl = Math.hypot(ox, oy, oz);
        if (wl < 1e-9) break;
        const sh = Math.sin(wl / 2) / wl, ch = Math.cos(wl / 2);
        const px = ox * sh, py = oy * sh, pz = oz * sh, pw = ch;
        // q = dq * q
        const nx = pw * qx + px * qw + py * qz - pz * qy, ny = pw * qy - px * qz + py * qw + pz * qx;
        const nz = pw * qz + px * qy - py * qx + pz * qw, nw = pw * qw - px * qx - py * qy - pz * qz;
        const ql = Math.hypot(nx, ny, nz, nw) || 1;
        q[0] = nx / ql; q[1] = ny / ql; q[2] = nz / ql; q[3] = nw / ql;
      }
      const sc = (r00 * a00 + r10 * a10 + r20 * a20 + r01 * a01 + r11 * a11 + r21 * a21 + r02 * a02 + r12 * a12 + r22 * a22) / den;
      // the share this frame (most of the way back in 0.2 s), on the floor
      const amt = 1 - Math.exp(-dt * 15);
      let low = Infinity;
      for (let n = 0; n < vs.length; n++) {
        const o = vs[n] * 3, rx = X[o] - Cx, ry = X[o + 1] - Cy, rz = X[o + 2] - Cz;
        const ty = cy + sc * (r10 * rx + r11 * ry + r12 * rz);
        if (ty < low) low = ty;
      }
      const lift = Math.max(0, -low);
      for (let n = 0; n < vs.length; n++) {
        const o = vs[n] * 3, rx = X[o] - Cx, ry = X[o + 1] - Cy, rz = X[o + 2] - Cz;
        x[o] += amt * (cx + sc * (r00 * rx + r01 * ry + r02 * rz) - x[o]);
        x[o + 1] += amt * (cy + lift + sc * (r10 * rx + r11 * ry + r12 * rz) - x[o + 1]);
        x[o + 2] += amt * (cz + sc * (r20 * rx + r21 * ry + r22 * rz) - x[o + 2]);
        v[o] = ux + (1 - amt) * (v[o] - ux);
        v[o + 1] = uy + (1 - amt) * (v[o + 1] - uy);
        v[o + 2] = uz + (1 - amt) * (v[o + 2] - uz);
      }
      this._hashDirty = true;
    }
  }

  // Surfaces passed through themselves - what a corner dragged right through
  // the body leaves, and the fold check (buried vertices) can't see once it
  // is through: surface edges of a piece piercing a surface triangle of the
  // same piece they don't touch. Counts per piece into out (for the pieces
  // with look[k]), through a grid of the triangles.
  _tangleCount(look, out) {
    const x = this.x, F = this.sTri, nF = this.nF, tp = this.tPiece, sTet = this.sTet;
    if (this._tgVersion !== this.topoVersion) {
      // the surface edges, each once: the surface is closed and turned one
      // way, so every edge runs a->b in one of its triangles and b->a in
      // the other - keep the a < b one
      const E = new Int32Array(nF * 3);
      let n = 0;
      for (let f = 0; f < nF; f++)
        for (let e = 0; e < 3; e++) {
          const a = F[f * 3 + e], b = F[f * 3 + ((e + 1) % 3)];
          if (a < b) {
            E[n++] = a;
            E[n++] = b;
          }
        }
      this._tgEdges = E.subarray(0, n);
      this._tgBox = new Float32Array(nF * 6);
      this._tgVersion = this.topoVersion;
    }
    const E = this._tgEdges, box = this._tgBox;
    const C = 0.7 * this.hCell, iC = 1 / C;
    const cells = new Map();
    for (let f = 0; f < nF; f++) {
      const k = tp[sTet[f]];
      if (!look[k]) continue;
      const a = F[f * 3] * 3, b = F[f * 3 + 1] * 3, c = F[f * 3 + 2] * 3, r = f * 6;
      for (let d = 0; d < 3; d++) {
        box[r + d] = Math.min(x[a + d], x[b + d], x[c + d]);
        box[r + 3 + d] = Math.max(x[a + d], x[b + d], x[c + d]);
      }
      for (let ix = Math.floor(box[r] * iC); ix <= Math.floor(box[r + 3] * iC); ix++)
        for (let iy = Math.floor(box[r + 1] * iC); iy <= Math.floor(box[r + 4] * iC); iy++)
          for (let iz = Math.floor(box[r + 2] * iC); iz <= Math.floor(box[r + 5] * iC); iz++) {
            const key = (ix + 512) * 1048576 + (iy + 512) * 1024 + (iz + 512), l = cells.get(key);
            if (l) l.push(f);
            else cells.set(key, [f]);
          }
    }
    const stamp = this._tgStamp && this._tgStamp.length >= nF ? this._tgStamp : (this._tgStamp = new Int32Array(Math.max(nF, 1024)));
    let st = this._tgSt || 0;
    for (let e = 0; e < E.length; e += 2) {
      const a = E[e], b = E[e + 1], k = this.vPiece[a];
      if (k < 0 || !look[k]) continue;
      const ax = x[a * 3], ay = x[a * 3 + 1], az = x[a * 3 + 2];
      const dx = x[b * 3] - ax, dy = x[b * 3 + 1] - ay, dz = x[b * 3 + 2] - az;
      const x0 = Math.min(ax, ax + dx), x1 = Math.max(ax, ax + dx), y0 = Math.min(ay, ay + dy), y1 = Math.max(ay, ay + dy), z0 = Math.min(az, az + dz), z1 = Math.max(az, az + dz);
      st++;
      for (let ix = Math.floor(x0 * iC); ix <= Math.floor(x1 * iC); ix++)
        for (let iy = Math.floor(y0 * iC); iy <= Math.floor(y1 * iC); iy++)
          for (let iz = Math.floor(z0 * iC); iz <= Math.floor(z1 * iC); iz++) {
            const l = cells.get((ix + 512) * 1048576 + (iy + 512) * 1024 + (iz + 512));
            if (!l) continue;
            for (const f of l) {
              if (stamp[f] === st) continue;
              stamp[f] = st;
              const i0 = F[f * 3], i1 = F[f * 3 + 1], i2 = F[f * 3 + 2];
              if (i0 === a || i1 === a || i2 === a || i0 === b || i1 === b || i2 === b || tp[sTet[f]] !== k) continue;
              const r = f * 6;
              if (x1 < box[r] || x0 > box[r + 3] || y1 < box[r + 1] || y0 > box[r + 4] || z1 < box[r + 2] || z0 > box[r + 5]) continue;
              // Moller-Trumbore, segment a->b against the triangle
              const p0 = i0 * 3, p1 = i1 * 3, p2 = i2 * 3;
              const e1x = x[p1] - x[p0], e1y = x[p1 + 1] - x[p0 + 1], e1z = x[p1 + 2] - x[p0 + 2];
              const e2x = x[p2] - x[p0], e2y = x[p2 + 1] - x[p0 + 1], e2z = x[p2 + 2] - x[p0 + 2];
              const qx = dy * e2z - dz * e2y, qy = dz * e2x - dx * e2z, qz = dx * e2y - dy * e2x, det = e1x * qx + e1y * qy + e1z * qz;
              if (Math.abs(det) < 1e-12) continue;
              const inv = 1 / det, tx = ax - x[p0], ty = ay - x[p0 + 1], tz = az - x[p0 + 2];
              // (clean through only, by a margin: an edge whose end just
              // touches a triangle, or that grazes its rim - as a cut's
              // snapped vertices lying on their neighbours' faces do - isn't
              // a tangle; counting those kept a tunnelled piece "untangling"
              // and awake for ever)
              const u = (tx * qx + ty * qy + tz * qz) * inv;
              if (u < 0.01 || u > 0.99) continue;
              const rx = ty * e1z - tz * e1y, ry = tz * e1x - tx * e1z, rz = tx * e1y - ty * e1x;
              const v = (dx * rx + dy * ry + dz * rz) * inv;
              if (v < 0.01 || u + v > 0.99) continue;
              const t = (e2x * rx + e2y * ry + e2z * rz) * inv;
              if (t < 0.01 || t > 0.99) continue;
              out[k]++;
            }
          }
    }
    this._tgSt = st;
  }

  // Of the pieces that may meet themselves, the surface vertices with some
  // other part of their own body close by - not within 2 steps of them in
  // the mesh - are flagged for probing against it; a calm body has none and
  // skips the pass. Returns whether any piece still needs it.
  _selfCheck(NP) {
    const x = this.x, D = this._disp, act = this._pieceActive, selfOK = this._selfOK, selfFlag = this._selfFlag;
    const sv = this._surfV, nSV = this._nSurfV, vp = this.vPiece, hoodA = this._hood;
    const nbS0 = this.nbStart, nbL0 = this.nbList;
    // "Close": near enough to reach the middle of the other part's nearest
    // surface triangle this frame - r0 plus how far the two move apart or
    // together (at most twice the most any of them moves within its piece);
    // cells one such reach across, so only the 27 round a vertex need looking at
    const pV = this._pVel, fdt = this._hashSpan, foldU = this._foldUntil, now = this.time;
    let mr2 = 0;
    for (let q = 0; q < nSV; q++) {
      const i = sv[q], k = vp[i];
      // (found folded in: probed till it has popped out, see _foldCheck)
      selfFlag[i] = foldU[i] > now ? 1 : 0;
      if (!selfOK[k]) continue;
      const ux = D[i * 3] - pV[k * 3] * fdt, uy = D[i * 3 + 1] - pV[k * 3 + 1] * fdt, uz = D[i * 3 + 2] - pV[k * 3 + 2] * fdt;
      const u2 = ux * ux + uy * uy + uz * uz;
      if (u2 > mr2) mr2 = u2;
    }
    const r0 = 0.72 * this.hCell + 0.01, rc = Math.min(1.3 * this.hCell, r0 + 2 * Math.sqrt(mr2)), irc = 1 / rc;
    const HM = 4095, hSt = this._svStart, hLi = this._svList;
    const key = (ix, iy, iz, k) => (Math.imul(ix, 92837111) ^ Math.imul(iy, 689287499) ^ Math.imul(iz, 283923481) ^ Math.imul(k, 1640531513)) & HM;
    hSt.fill(0);
    for (let q = 0; q < nSV; q++) {
      const i = sv[q];
      if (!selfOK[vp[i]]) continue;
      hSt[key(Math.floor(x[i * 3] * irc), Math.floor(x[i * 3 + 1] * irc), Math.floor(x[i * 3 + 2] * irc), vp[i]) + 1]++;
    }
    for (let k = 0; k < 4096; k++) hSt[k + 1] += hSt[k];
    const hF = this._svFill;
    hF.set(hSt.subarray(0, 4096));
    for (let q = 0; q < nSV; q++) {
      const i = sv[q];
      if (selfOK[vp[i]]) hLi[hF[key(Math.floor(x[i * 3] * irc), Math.floor(x[i * 3 + 1] * irc), Math.floor(x[i * 3 + 2] * irc), vp[i])]++] = i;
    }
    let hs2 = this._hoodStamp;
    for (let q = 0; q < nSV; q++) {
      const i = sv[q], k = vp[i];
      if (!selfOK[k]) continue;
      // its immediate neighbours first; the wider neighbourhood (2 steps
      // out) only if something else turns up close by
      hs2++;
      const h1 = hs2;
      hoodA[i] = h1;
      for (let e = nbS0[i]; e < nbS0[i + 1]; e++) hoodA[nbL0[e]] = h1;
      let h2 = 0;
      const ox = x[i * 3], oy = x[i * 3 + 1], oz = x[i * 3 + 2];
      const cx = Math.floor(ox * irc), cy = Math.floor(oy * irc), cz = Math.floor(oz * irc);
      for (let a1 = -1; a1 <= 1; a1++)
        for (let b1 = -1; b1 <= 1; b1++)
          for (let c1 = -1; c1 <= 1; c1++) {
            const h = key(cx + a1, cy + b1, cz + c1, k);
            for (let e = hSt[h]; e < hSt[h + 1]; e++) {
              const j = hLi[e];
              if (j <= i || vp[j] !== k) continue; // (each pair once: both get flagged)
              const dx = x[j * 3] - ox, dy = x[j * 3 + 1] - oy, dz = x[j * 3 + 2] - oz;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 > rc * rc) continue;
              const hj = hoodA[j];
              if (hj === h1 || (h2 && hj === h2)) continue;
              const r = Math.min(rc, r0 + Math.hypot(D[j * 3] - D[i * 3], D[j * 3 + 1] - D[i * 3 + 1], D[j * 3 + 2] - D[i * 3 + 2]));
              if (d2 >= r * r) continue;
              if (!h2) {
                // (now the wider neighbourhood - its immediate ring keeps
                // its stamp, so mark 2 steps out with a new one)
                h2 = ++hs2;
                for (let e1 = nbS0[i]; e1 < nbS0[i + 1]; e1++) {
                  const u = nbL0[e1];
                  for (let e2 = nbS0[u]; e2 < nbS0[u + 1]; e2++) if (hoodA[nbL0[e2]] !== h1) hoodA[nbL0[e2]] = h2;
                }
                if (hoodA[j] === h2) continue;
              }
              selfFlag[i] = 1;
              selfFlag[j] = 1;
            }
          }
    }
    this._hoodStamp = hs2;
    // pieces with nobody near themselves after all: no self pass
    for (let a = 0; a < NP; a++) if (selfOK[a]) selfOK[a] = 3; // (3 = none found yet)
    for (let q = 0; q < nSV; q++) {
      const i = sv[q], k = vp[i];
      if (selfOK[k] === 3 && selfFlag[i]) selfOK[k] = act[k] || this.pieces[k].foldUntil > now ? 1 : 2;
    }
    let anySelf = false;
    for (let a = 0; a < NP; a++) {
      if (selfOK[a] === 3) selfOK[a] = 0;
      if (selfOK[a]) {
        act[a] = 1;
        anySelf = true;
      }
    }
    return anySelf;
  }

  // Hash the swept boxes of the active pieces' tets, keyed by cell + piece
  // (a table sized to the entries: clearing and summing a big one costs).
  _hashTets() {
    const { x, T } = this;
    const nT = this.nT, D = this._disp, sw = this._sweep, pcs = this._pcs, act = this._pieceActive, selfOK = this._selfOK;
    const counts = this._hCount && this._hCount.length === (1 << 15) + 1 ? this._hCount : (this._hCount = new Int32Array((1 << 15) + 1));
    const tbox = this._tBox0 && this._tBox0.length >= nT * 6 ? this._tBox0 : (this._tBox0 = new Float32Array(this.tCap * 6));
    const ranges = this._hRanges && this._hRanges.length >= nT * 6 ? this._hRanges : (this._hRanges = new Int32Array(this.tCap * 6));
    const list = this._hTets && this._hTets.length >= nT ? this._hTets : (this._hTets = new Int32Array(this.tCap));
    // per tet: centre, radius, the centre's move this frame and how far its
    // corners stray from that (a cheap sphere test before the exact one)
    const tS = this._tStat && this._tStat.length >= nT * 8 ? this._tStat : (this._tStat = new Float32Array(this.tCap * 8));
    let nList = 0, total = 0;
    const tp = this.tPiece;
    const tSurf = this._tSurf;
    for (let t = 0; t < nT; t++) {
      if (!act[tp[t]] || this.vol0[t] <= 0) continue;
      if (selfOK[tp[t]] === 2 && !tSurf[t]) continue;
      const o = t * 4, r = t * 6;
      const a = T[o] * 6, b = T[o + 1] * 6, c = T[o + 2] * 6, d = T[o + 3] * 6;
      {
        const a3 = T[o] * 3, b3 = T[o + 1] * 3, c3 = T[o + 2] * 3, d3 = T[o + 3] * 3, s8 = t * 8;
        const cx = (x[a3] + x[b3] + x[c3] + x[d3]) * 0.25, cy = (x[a3 + 1] + x[b3 + 1] + x[c3 + 1] + x[d3 + 1]) * 0.25, cz = (x[a3 + 2] + x[b3 + 2] + x[c3 + 2] + x[d3 + 2]) * 0.25;
        const mx = (D[a3] + D[b3] + D[c3] + D[d3]) * 0.25, my = (D[a3 + 1] + D[b3 + 1] + D[c3 + 1] + D[d3 + 1]) * 0.25, mz = (D[a3 + 2] + D[b3 + 2] + D[c3 + 2] + D[d3 + 2]) * 0.25;
        let r2 = 0, m2 = 0;
        for (let j = 0; j < 4; j++) {
          const q = T[o + j] * 3;
          const ux = x[q] - cx, uy = x[q + 1] - cy, uz = x[q + 2] - cz;
          const u2 = ux * ux + uy * uy + uz * uz;
          if (u2 > r2) r2 = u2;
          const wx = D[q] - mx, wy = D[q + 1] - my, wz = D[q + 2] - mz;
          const w2 = wx * wx + wy * wy + wz * wz;
          if (w2 > m2) m2 = w2;
        }
        tS[s8] = cx; tS[s8 + 1] = cy; tS[s8 + 2] = cz; tS[s8 + 3] = Math.sqrt(r2);
        tS[s8 + 4] = mx; tS[s8 + 5] = my; tS[s8 + 6] = mz; tS[s8 + 7] = Math.sqrt(m2);
      }
      const inv = pcs[tp[t]];
      const x0 = Math.min(sw[a], sw[b], sw[c], sw[d]), y0 = Math.min(sw[a + 1], sw[b + 1], sw[c + 1], sw[d + 1]), z0 = Math.min(sw[a + 2], sw[b + 2], sw[c + 2], sw[d + 2]);
      const x1 = Math.max(sw[a + 3], sw[b + 3], sw[c + 3], sw[d + 3]), y1 = Math.max(sw[a + 4], sw[b + 4], sw[c + 4], sw[d + 4]), z1 = Math.max(sw[a + 5], sw[b + 5], sw[c + 5], sw[d + 5]);
      tbox[r] = x0; tbox[r + 1] = y0; tbox[r + 2] = z0; tbox[r + 3] = x1; tbox[r + 4] = y1; tbox[r + 5] = z1;
      const ix0 = Math.floor(x0 * inv), ix1 = Math.floor(x1 * inv);
      const iy0 = Math.floor(y0 * inv), iy1 = Math.floor(y1 * inv);
      const iz0 = Math.floor(z0 * inv), iz1 = Math.floor(z1 * inv);
      if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) * (iz1 - iz0 + 1) > 4096) continue; // torn to bits
      const rr = nList * 6;
      ranges[rr] = ix0; ranges[rr + 1] = ix1; ranges[rr + 2] = iy0; ranges[rr + 3] = iy1; ranges[rr + 4] = iz0; ranges[rr + 5] = iz1;
      list[nList++] = t;
      total += (ix1 - ix0 + 1) * (iy1 - iy0 + 1) * (iz1 - iz0 + 1);
    }
    this._nHTets = nList;
    let size = 1024;
    while (size < total * 2 && size < 1 << 15) size <<= 1;
    const mask = size - 1;
    counts.fill(0, 0, size + 1);
    for (let n = 0; n < nList; n++) {
      const r = n * 6, pk = Math.imul(tp[list[n]], 1640531513);
      for (let ix = ranges[r]; ix <= ranges[r + 1]; ix++)
        for (let iy = ranges[r + 2]; iy <= ranges[r + 3]; iy++)
          for (let iz = ranges[r + 4]; iz <= ranges[r + 5]; iz++)
            counts[((Math.imul(ix, 92837111) ^ Math.imul(iy, 689287499) ^ Math.imul(iz, 283923481) ^ pk) & mask) + 1]++;
    }
    for (let k = 0; k < size; k++) counts[k + 1] += counts[k];
    const entries = this._hEntries && this._hEntries.length >= total ? this._hEntries : (this._hEntries = new Int32Array(Math.max(total, 1024) * 2));
    const fill = this._hFill && this._hFill.length === 1 << 15 ? this._hFill : (this._hFill = new Int32Array(1 << 15));
    fill.set(counts.subarray(0, size));
    for (let n = 0; n < nList; n++) {
      const r = n * 6, t = list[n], pk = Math.imul(tp[t], 1640531513);
      for (let ix = ranges[r]; ix <= ranges[r + 1]; ix++)
        for (let iy = ranges[r + 2]; iy <= ranges[r + 3]; iy++)
          for (let iz = ranges[r + 4]; iz <= ranges[r + 5]; iz++)
            entries[fill[(Math.imul(ix, 92837111) ^ Math.imul(iy, 689287499) ^ Math.imul(iz, 283923481) ^ pk) & mask]++] = t;
    }
    this._hMask = mask;
  }

  // Probes (surface vertices, face centres) and their candidate tets for
  // this frame's contact passes.
  _gatherProbes(ptL) {
    const { x, T } = this;
    const nT = this.nT, nV = this.nV, NP = this.pieces.length, tp = this.tPiece;
    const fdt = this._hashSpan, GP = this.grabs.length ? this._grabbedP : null;
    const D = this._disp, pV = this._pVel, sw = this._sweep, bb = this._pbb, pcs = this._pcs;
    const act = this._pieceActive, ptS = this._ptS, selfOK = this._selfOK, selfFlag = this._selfFlag;
    const counts = this._hCount, entries = this._hEntries, tbox = this._tBox0, tS = this._tStat, mask = this._hMask;
    // probes and their candidate tets
    const sTri = this.sTri, nF = this.nF;
    const pvv = this._probeV && this._probeV.length >= nV ? this._probeV : (this._probeV = new Int32Array(Math.max(this.vCap, 1024)));
    const pff = this._probeF && this._probeF.length >= nF ? this._probeF : (this._probeF = new Int32Array(Math.max(nF * 2, 1024)));
    const nPmax = nV + nF;
    const nS = this._pcStart && this._pcStart.length >= nPmax ? this._pcStart : (this._pcStart = new Int32Array((this.vCap + Math.max(nF, 1024)) * 2));
    const nE = this._pcEnd && this._pcEnd.length >= nPmax ? this._pcEnd : (this._pcEnd = new Int32Array((this.vCap + Math.max(nF, 1024)) * 2));
    const rel = this._pRel && this._pRel.length >= nPmax ? this._pRel : (this._pRel = new Float32Array((this.vCap + Math.max(nF, 1024)) * 2));
    const seen = this._probeSeen && this._probeSeen.length >= nV ? this._probeSeen : (this._probeSeen = new Uint8Array(this.vCap));
    seen.fill(0, 0, nV);
    const tStamp = this._tStamp && this._tStamp.length >= nT ? this._tStamp : (this._tStamp = new Int32Array(this.tCap));
    tStamp.fill(0, 0, nT);
    let stamp = 0;
    let cList = this._cList || (this._cList = new Int32Array(1 << 16));
    let nc = 0, gRel = 0, gGrab = false;
    // Other-piece tets the probe at p (moving dp this frame, box x0..z1) could
    // reach this frame: swept boxes that meet, minus tets it stays clear of -
    // seen along the line from the tet's centre to p, the gap can only close
    // as fast as the tet's corners move toward p relative to it (+ 12% and
    // 3 mm for changes of course). gRel = the fastest any kept tet's corner
    // moves relative to p (a closing speed bound, per frame).
    // A probe flagged by _selfCheck (vertex vi >= 0, face -2 - vi) also
    // meets its own piece's tets - all but those touching it (a face: its
    // corners) or their neighbours: reaching any of those means the body has
    // folded onto itself (or a part hanging by a hinge has swung into the
    // rest; across a cut the neighbours are only those on its side).
    const nbS = this.nbStart, nbL = this.nbList, hood = this._hood;
    if (this._hoodStamp > 2e9) {
      hood.fill(0);
      this._hoodStamp = 0;
    }
    let hs = this._hoodStamp;
    // (face centres too only for watery jelly, whose folds slide edge over
    // face; a firm piece on a hinge is held well enough by its vertices)
    const selfFaces = this.p.mu < 110;
    const gather = (qx0, qy0, qz0, qx1, qy1, qz1, own, px, py, pz, dpx, dpy, dpz, vi) => {
      const st = ++stamp;
      const c0 = nc;
      gRel = 0;
      gGrab = !!(GP && GP[own]);
      const self = selfOK[own] > 0 && (vi >= 0 ? selfFlag[vi] === 1 : selfFaces && vi < -1 && (selfFlag[sTri[(-2 - vi) * 3]] | selfFlag[sTri[(-2 - vi) * 3 + 1]] | selfFlag[sTri[(-2 - vi) * 3 + 2]]) === 1);
      if (self) {
        hs++;
        if (vi >= 0) {
          hood[vi] = hs;
          for (let k = nbS[vi]; k < nbS[vi + 1]; k++) hood[nbL[k]] = hs;
        } else {
          const ff = -2 - vi;
          for (let c = 0; c < 3; c++) {
            const u = sTri[ff * 3 + c];
            hood[u] = hs;
            for (let k = nbS[u]; k < nbS[u + 1]; k++) hood[nbL[k]] = hs;
          }
        }
      }
      const e0 = ptS[own], e1 = ptS[own + 1] + (self ? 1 : 0);
      for (let e = e0; e < e1; e++) {
        const mine = e === ptS[own + 1];
        const pb = mine ? own : ptL[e], B = pb * 6;
        // the probe's box, swept by how its piece moves relative to pb
        const rx = (pV[own * 3] - pV[pb * 3]) * fdt, ry = (pV[own * 3 + 1] - pV[pb * 3 + 1]) * fdt, rz = (pV[own * 3 + 2] - pV[pb * 3 + 2]) * fdt;
        const rm = 0.12 * (Math.abs(rx) + Math.abs(ry) + Math.abs(rz));
        const x0 = qx0 + Math.min(0, rx) - rm, y0 = qy0 + Math.min(0, ry) - rm, z0 = qz0 + Math.min(0, rz) - rm;
        const x1 = qx1 + Math.max(0, rx) + rm, y1 = qy1 + Math.max(0, ry) + rm, z1 = qz1 + Math.max(0, rz) + rm;
        if (x1 < bb[B] || x0 > bb[B + 3] || y1 < bb[B + 1] || y0 > bb[B + 4] || z1 < bb[B + 2] || z0 > bb[B + 5]) continue;
        const pk = Math.imul(pb, 1640531513), inv = pcs[pb];
        const ix0 = Math.floor(x0 * inv), ix1 = Math.floor(x1 * inv);
        const iy0 = Math.floor(y0 * inv), iy1 = Math.floor(y1 * inv);
        const iz0 = Math.floor(z0 * inv), iz1 = Math.floor(z1 * inv);
        const n0 = nc;
        for (let ix = ix0; ix <= ix1; ix++)
          for (let iy = iy0; iy <= iy1; iy++)
            for (let iz = iz0; iz <= iz1; iz++) {
              const hsh = (Math.imul(ix, 92837111) ^ Math.imul(iy, 689287499) ^ Math.imul(iz, 283923481) ^ pk) & mask;
              for (let q = counts[hsh]; q < counts[hsh + 1]; q++) {
                const t = entries[q];
                if (tStamp[t] === st || tp[t] !== pb) continue;
                tStamp[t] = st;
                if (mine && (hood[T[t * 4]] === hs || hood[T[t * 4 + 1]] === hs || hood[T[t * 4 + 2]] === hs || hood[T[t * 4 + 3]] === hs)) continue;
                const r = t * 6;
                if (x1 < tbox[r] || x0 > tbox[r + 3] || y1 < tbox[r + 1] || y0 > tbox[r + 4] || z1 < tbox[r + 2] || z0 > tbox[r + 5]) continue;
                const s8 = t * 8;
                let nx = px - tS[s8], ny = py - tS[s8 + 1], nz = pz - tS[s8 + 2];
                const L = Math.sqrt(nx * nx + ny * ny + nz * nz);
                if (L > 1e-7) {
                  const il = 1 / L;
                  nx *= il; ny *= il; nz *= il;
                  // sphere round the tet first
                  const ux = tS[s8 + 4] - dpx, uy = tS[s8 + 5] - dpy, uz = tS[s8 + 6] - dpz, sd = tS[s8 + 7];
                  const cs = ux * nx + uy * ny + uz * nz + sd;
                  if (L - tS[s8 + 3] - (cs > 0 ? cs : 0) > 0.003 + 0.12 * (Math.sqrt(ux * ux + uy * uy + uz * uz) + sd)) continue;
                }
                // its corners
                let ext = -Infinity, cr = -Infinity, m2 = 0;
                for (let j = 0; j < 4; j++) {
                  const q = T[t * 4 + j] * 3;
                  const ex = (x[q] - tS[s8]) * nx + (x[q + 1] - tS[s8 + 1]) * ny + (x[q + 2] - tS[s8 + 2]) * nz;
                  if (ex > ext) ext = ex;
                  const ux = D[q] - dpx, uy = D[q + 1] - dpy, uz = D[q + 2] - dpz;
                  const c = ux * nx + uy * ny + uz * nz;
                  if (c > cr) cr = c;
                  const u2 = ux * ux + uy * uy + uz * uz;
                  if (u2 > m2) m2 = u2;
                }
                const mr = Math.sqrt(m2);
                if (L > 1e-7 && L - ext - (cr > 0 ? cr : 0) > 0.003 + 0.12 * mr) continue;
                if (mr > gRel) gRel = mr;
                if (GP && GP[pb]) gGrab = true;
                if (nc >= cList.length) {
                  const grown = new Int32Array(cList.length * 2);
                  grown.set(cList);
                  cList = this._cList = grown;
                }
                cList[nc++] = t;
              }
            }
      }
      return nc > c0;
    };
    // Closing speed a probe's clearance is spent at (see _solvePieceCollisions):
    // the frame's speeds can double (a bounce off something else), and a
    // grabbed piece can be hauled at the grab's per-substep cap on top.
    const ifdt = 1 / fdt, capV = (0.012 * this.p.size * this.p.substeps) / fdt;
    const closing = () => 2 * gRel * ifdt + 1 + (gGrab ? capV : 0);
    let nv = 0, nf = 0;
    const vStart = this._vcS && this._vcS.length >= nV ? this._vcS : (this._vcS = new Int32Array(this.vCap));
    const vEnd = this._vcE && this._vcE.length >= nV ? this._vcE : (this._vcE = new Int32Array(this.vCap));
    const vRel = this._vcR && this._vcR.length >= nV ? this._vcR : (this._vcR = new Float32Array(this.vCap));
    const fS = this._fcS && this._fcS.length >= nF ? this._fcS : (this._fcS = new Int32Array(Math.max(nF * 2, 1024)));
    const fE = this._fcE && this._fcE.length >= nF ? this._fcE : (this._fcE = new Int32Array(Math.max(nF * 2, 1024)));
    const fR = this._fcR && this._fcR.length >= nF ? this._fcR : (this._fcR = new Float32Array(Math.max(nF * 2, 1024)));
    const faces = this.faceProbes !== false;
    for (let f = 0; f < nF; f++) {
      const own = tp[this.sTet[f]];
      if (!act[own]) continue;
      for (let j = 0; j < 3; j++) {
        const i = sTri[f * 3 + j];
        if (seen[i]) continue;
        seen[i] = 1;
        const r = i * 6, o = i * 3;
        const c0 = nc;
        if (gather(sw[r], sw[r + 1], sw[r + 2], sw[r + 3], sw[r + 4], sw[r + 5], own, x[o], x[o + 1], x[o + 2], D[o], D[o + 1], D[o + 2], i)) {
          vStart[nv] = c0;
          vEnd[nv] = nc;
          vRel[nv] = closing();
          pvv[nv++] = i;
        }
      }
      if (!faces) continue;
      // the face centre's swept box (mean of its corners' boxes)
      const a = sTri[f * 3] * 6, b = sTri[f * 3 + 1] * 6, c = sTri[f * 3 + 2] * 6;
      const a3 = sTri[f * 3] * 3, b3 = sTri[f * 3 + 1] * 3, c3 = sTri[f * 3 + 2] * 3;
      const c0 = nc;
      if (gather((sw[a] + sw[b] + sw[c]) / 3, (sw[a + 1] + sw[b + 1] + sw[c + 1]) / 3, (sw[a + 2] + sw[b + 2] + sw[c + 2]) / 3,
        (sw[a + 3] + sw[b + 3] + sw[c + 3]) / 3, (sw[a + 4] + sw[b + 4] + sw[c + 4]) / 3, (sw[a + 5] + sw[b + 5] + sw[c + 5]) / 3, own,
        (x[a3] + x[b3] + x[c3]) / 3, (x[a3 + 1] + x[b3 + 1] + x[c3 + 1]) / 3, (x[a3 + 2] + x[b3 + 2] + x[c3 + 2]) / 3,
        (D[a3] + D[b3] + D[c3]) / 3, (D[a3 + 1] + D[b3 + 1] + D[c3 + 1]) / 3, (D[a3 + 2] + D[b3 + 2] + D[c3 + 2]) / 3, -2 - f)) {
        fS[nf] = c0;
        fE[nf] = nc;
        fR[nf] = closing();
        pff[nf++] = f;
      }
    }
    // one candidate range per probe: vertex probes first, then faces
    for (let k = 0; k < nv; k++) {
      nS[k] = vStart[k];
      nE[k] = vEnd[k];
      rel[k] = vRel[k];
    }
    for (let k = 0; k < nf; k++) {
      nS[nv + k] = fS[k];
      nE[nv + k] = fE[k];
      rel[nv + k] = fR[k];
    }
    this._nProbeV = nv;
    this._nProbeF = nf;
    this._hoodStamp = hs;
    // clearance left per probe: a probe that missed by a margin skips the
    // following substeps until the pieces could have closed that gap
    const nPr = nv + nf;
    if (!this._skip || this._skip.length < nPr) this._skip = new Float32Array(Math.max(nPr * 2, 4096));
    this._skip.fill(0, 0, nPr);
    if (!this._tBoxNow || this._tBoxNow.length < nT * 6) {
      this._tBoxNow = new Float32Array(this.tCap * 6);
      this._tBoxStamp = new Int32Array(this.tCap);
    }
  }


  // Is p inside tet t? Returns -1 if so (barycentric coordinates into
  // this._ct), else a lower bound on its distance to the tet: how far it is
  // outside the first face plane found that separates them.
  _tetGap(t, px, py, pz) {
    const x = this.x, T = this.T, t4 = t * 4;
    const a = T[t4] * 3, b = T[t4 + 1] * 3, c = T[t4 + 2] * 3, d = T[t4 + 3] * 3;
    const ax = x[a], ay = x[a + 1], az = x[a + 2];
    const e1x = x[b] - ax, e1y = x[b + 1] - ay, e1z = x[b + 2] - az;
    const e2x = x[c] - ax, e2y = x[c + 1] - ay, e2z = x[c + 2] - az;
    const e3x = x[d] - ax, e3y = x[d + 1] - ay, e3z = x[d + 2] - az;
    const c0x = e2y * e3z - e2z * e3y, c0y = e2z * e3x - e2x * e3z, c0z = e2x * e3y - e2y * e3x;
    const det = e1x * c0x + e1y * c0y + e1z * c0z;
    if (det <= 1e-15) return Infinity;
    const rx = px - ax, ry = py - ay, rz = pz - az;
    // s_k = det x barycentric k = det x (distance to the face opposite k) / height
    const s1 = rx * c0x + ry * c0y + rz * c0z;
    if (s1 < 0) return -s1 / Math.sqrt(c0x * c0x + c0y * c0y + c0z * c0z);
    const qx = ry * e1z - rz * e1y, qy = rz * e1x - rx * e1z, qz = rx * e1y - ry * e1x; // r x e1
    const s2 = -(e3x * qx + e3y * qy + e3z * qz);
    if (s2 < 0) {
      const nx = e1y * e3z - e1z * e3y, ny = e1z * e3x - e1x * e3z, nz = e1x * e3y - e1y * e3x;
      return -s2 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    }
    const s3 = e2x * qx + e2y * qy + e2z * qz;
    if (s3 < 0) {
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      return -s3 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    }
    const s0 = det - s1 - s2 - s3;
    if (s0 < 0) {
      const fx = e2x - e1x, fy = e2y - e1y, fz = e2z - e1z, gx = e3x - e1x, gy = e3y - e1y, gz = e3z - e1z;
      const nx = fy * gz - fz * gy, ny = fz * gx - fx * gz, nz = fx * gy - fy * gx;
      return -s0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    }
    const ct = this._ct, id = 1 / det;
    ct.b0 = s0 * id; ct.b1 = s1 * id; ct.b2 = s2 * id; ct.b3 = s3 * id;
    return -1;
  }

  // Geometry of boundary face f this contact pass (cached): anchor a, edges
  // u v, unit outward normal, Gram terms for projecting onto it. False for
  // degenerate faces.
  _faceGeo(f) {
    const G = this._fGeo, o = f * 16;
    if (this._fGeoStamp[f] === this._pass) return G[o + 15] !== 0;
    this._fGeoStamp[f] = this._pass;
    const x = this.x, sTri = this.sTri;
    const fa = sTri[f * 3] * 3, fb = sTri[f * 3 + 1] * 3, fc = sTri[f * 3 + 2] * 3;
    const ax = x[fa], ay = x[fa + 1], az = x[fa + 2];
    const ux = x[fb] - ax, uy = x[fb + 1] - ay, uz = x[fb + 2] - az;
    const vx = x[fc] - ax, vy = x[fc + 1] - ay, vz = x[fc + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const d00 = ux * ux + uy * uy + uz * uz, d01 = ux * vx + uy * vy + uz * vz, d11 = vx * vx + vy * vy + vz * vz;
    const den = d00 * d11 - d01 * d01;
    if (l < 1e-14 || den < 1e-20) {
      G[o + 15] = 0;
      return false;
    }
    G[o] = ax; G[o + 1] = ay; G[o + 2] = az;
    G[o + 3] = ux; G[o + 4] = uy; G[o + 5] = uz;
    G[o + 6] = vx; G[o + 7] = vy; G[o + 8] = vz;
    G[o + 9] = nx / l; G[o + 10] = ny / l; G[o + 11] = nz / l;
    G[o + 12] = d00; G[o + 13] = d01; G[o + 14] = d11;
    G[o + 15] = 1 / den;
    return true;
  }

  // Is the point (wx, wy, wz) relative to face f's anchor within the face's
  // outline grown by tol (in barycentric units)?
  _onFace(o, wx, wy, wz, tol) {
    const G = this._fGeo;
    const d20 = wx * G[o + 3] + wy * G[o + 4] + wz * G[o + 5], d21 = wx * G[o + 6] + wy * G[o + 7] + wz * G[o + 8];
    const id = G[o + 15];
    const be = (G[o + 14] * d20 - G[o + 13] * d21) * id, ga = (G[o + 12] * d21 - G[o + 13] * d20) * id;
    return be >= -tol && ga >= -tol && be + ga <= 1 + tol;
  }

  // Boundary face f against point p (previous q): depth behind its plane now
  // and before (> 0 = inside), whether p's projection lies on the face, and
  // where the path crossed the plane (crossS, if it came in through it).
  // `need` = 1: only the depth/on test, 2: also the crossing.
  _faceProbe(f, px, py, pz, qx, qy, qz) {
    const fq = this._fq;
    fq.ok = false;
    if (!this._faceGeo(f)) return;
    const G = this._fGeo, o = f * 16;
    const ax = G[o], ay = G[o + 1], az = G[o + 2], nx = G[o + 9], ny = G[o + 10], nz = G[o + 11];
    let dist = -((px - ax) * nx + (py - ay) * ny + (pz - az) * nz);
    // in front of it: not a way out. (Right on it is one, at depth 0: the
    // two sides of a fresh cut lie exactly on each other's faces, and with
    // the near face ruled out a thin slice's far face - a few cm away -
    // was the way out: every vertex of a sliced loaf was shoved through its
    // neighbour, and the slices blew apart at the speed limit.)
    if (dist < -1e-7) return;
    if (dist < 0) dist = 0;
    // pushing out this way would land under the floor / in the arena wall:
    // useless (it just gets pushed back in), so don't. (Against another piece
    // a face only tilted a little down is fine: the floor lifts the last
    // millimetres. Ruling those out left a piece lying on the floor that had
    // sunk into another one only the far faces, up through its top: it was
    // hauled up and dropped back every substep - two pieces kicking each
    // other for good. A fold of its own body is the other way round: out
    // through its underside is how a fold gets pushed through itself.)
    const ex = px + nx * dist, ey = py + ny * dist, ez = pz + nz * dist;
    const R = this.p.arenaRadius;
    if (ex * ex + ez * ez > R * R) return;
    if (this._fSelf ? ny < 0 && ey < 0.002 : (ny < -0.5 && ey < 0.002) || ey < -0.015) return;
    const prev = -((qx - ax) * nx + (qy - ay) * ny + (qz - az) * nz);
    fq.ok = true;
    fq.dist = dist; fq.prev = prev; fq.nx = nx; fq.ny = ny; fq.nz = nz;
    fq.on = this._onFace(o, ex - ax, ey - ay, ez - az, 0.15);
    fq.crossS = Infinity;
    if (prev <= 0) {
      // where the path met the plane
      const s = prev / (prev - dist);
      if (this._onFace(o, qx + (px - qx) * s - ax, qy + (py - qy) * s - ay, qz + (pz - qz) * s - az, 0.08)) fq.crossS = s;
    }
  }

  // Is point p (previous position q) of piece `own` inside another piece?
  // Tries the tet it was in last substep (wt), then the frame's candidate
  // tets cList[c0..c1). Push-out direction: the boundary face the path
  // entered through this substep, else the nearest face it lies behind
  // (last substep's face wf first), else - deep inside - the interpolated
  // escape field. Result in this._ct: tet t, face f (-1 = escape field),
  // bary b0..b3, unit normal n, depth.
  _contact(px, py, pz, qx, qy, qz, c0, c1, own, wt, wf) {
    const { T, tPiece } = this;
    const ct = this._ct, fq = this._fq;
    let t = -1;
    // (a warm tet of its own piece is fine: it came from a self-contact
    // candidate list, which leaves out the probe's own neighbourhood)
    const gw = wt >= 0 && wt < this.nT && this.vol0[wt] > 0 ? this._tetGap(wt, px, py, pz) : Infinity;
    if (gw < 0) t = wt;
    else {
      // scan the candidates; on a miss, remember how far the nearest was
      const cl = this._cList, tb = this._tBoxNow, tbs = this._tBoxStamp, pass = this._pass;
      const x = this.x;
      let gap = gw;
      for (let e = c0; e < c1; e++) {
        const u = cl[e];
        if (u === wt) continue;
        const r = u * 6;
        if (tbs[u] !== pass) {
          // this pass's box of the tet: a cheap reject, and a lower bound on
          // the distance when it does reject
          tbs[u] = pass;
          const o = u * 4;
          const a = T[o] * 3, b = T[o + 1] * 3, c = T[o + 2] * 3, d = T[o + 3] * 3;
          let v0 = x[a], v1 = x[b], v2 = x[c], v3 = x[d];
          tb[r] = Math.min(v0, v1, v2, v3); tb[r + 3] = Math.max(v0, v1, v2, v3);
          v0 = x[a + 1]; v1 = x[b + 1]; v2 = x[c + 1]; v3 = x[d + 1];
          tb[r + 1] = Math.min(v0, v1, v2, v3); tb[r + 4] = Math.max(v0, v1, v2, v3);
          v0 = x[a + 2]; v1 = x[b + 2]; v2 = x[c + 2]; v3 = x[d + 2];
          tb[r + 2] = Math.min(v0, v1, v2, v3); tb[r + 5] = Math.max(v0, v1, v2, v3);
        }
        const ox = Math.max(tb[r] - px, px - tb[r + 3]), oy = Math.max(tb[r + 1] - py, py - tb[r + 4]), oz = Math.max(tb[r + 2] - pz, pz - tb[r + 5]);
        const out = Math.max(ox, oy, oz);
        if (out > 0) {
          if (out < gap) gap = out;
          continue;
        }
        const g = this._tetGap(u, px, py, pz);
        if (g < 0) {
          t = u;
          break;
        }
        if (g < gap) gap = g;
      }
      if (t < 0) {
        this._gap = gap;
        return false;
      }
    }
    ct.t = t;
    const pt = tPiece[t];
    this._fSelf = pt === own;
    // still behind last substep's face?
    if (wf >= 0 && wf < this.nF && tPiece[this.sTet[wf]] === pt) {
      this._faceProbe(wf, px, py, pz, qx, qy, qz);
      // (only while shallow: deep in - a thin slice folded over another -
      // the face it came in by can be the far side of everything, 12 cm off)
      if (fq.ok && fq.on && (fq.prev > 0 || fq.dist < 0.004) && fq.dist < 0.02) {
        ct.f = wf; ct.nx = fq.nx; ct.ny = fq.ny; ct.nz = fq.nz; ct.depth = fq.dist;
        return true;
      }
    }
    // the boundary faces around this tet's vertices
    const t4 = t * 4;
    const vfS = this.vfStart, vfL = this.vfList, seen = this._fSeen;
    const stamp = ++this._fStamp;
    let cross = -1, crossS = Infinity, crossD = 0, cnx = 0, cny = 0, cnz = 0;
    let best = -1, bestD = Infinity, bnx = 0, bny = 0, bnz = 0;
    for (let k = 0; k < 4; k++) {
      const vi = T[t4 + k];
      for (let ef = vfS[vi]; ef < vfS[vi + 1]; ef++) {
        const f = vfL[ef];
        if (seen[f] === stamp) continue;
        seen[f] = stamp;
        this._faceProbe(f, px, py, pz, qx, qy, qz);
        if (!fq.ok) continue; // (only faces it lies behind)
        if (fq.crossS < crossS) {
          crossS = fq.crossS; cross = f; crossD = fq.dist; cnx = fq.nx; cny = fq.ny; cnz = fq.nz;
        }
        // (a face it's barely behind is a way out even if it lies just
        // beside the triangle: only the triangles round this tet's corners
        // are asked, and a thin slice's near face can be the next triangle
        // over - with only the far face "on", a whole slice's thickness away,
        // a sliced loaf shoved every vertex through its neighbour)
        if (fq.dist < bestD && (fq.on || fq.dist < 0.004)) {
          bestD = fq.dist; best = f; bnx = fq.nx; bny = fq.ny; bnz = fq.nz;
        }
      }
    }
    // the face it came in through - unless that is much deeper than the
    // nearest one, i.e. it merely slid over an edge (or the face came to it)
    const mx = px - qx, my = py - qy, mz = pz - qz;
    if (cross >= 0 && (best < 0 || crossD <= bestD + Math.sqrt(mx * mx + my * my + mz * mz))) {
      ct.f = cross; ct.nx = cnx; ct.ny = cny; ct.nz = cnz; ct.depth = crossD;
      return true;
    }
    if (best >= 0) {
      ct.f = best; ct.nx = bnx; ct.ny = bny; ct.nz = bnz; ct.depth = bestD;
      return true;
    }
    // deep: follow the escape field (rest space), mapped through F = Ds Dm^-1
    ct.f = -1;
    const x = this.x, E = this.esc;
    const ia = T[t4], ib = T[t4 + 1], ic = T[t4 + 2], idd = T[t4 + 3];
    const b0 = ct.b0, b1 = ct.b1, b2 = ct.b2, b3 = ct.b3;
    let ex = E[ia * 3] * b0 + E[ib * 3] * b1 + E[ic * 3] * b2 + E[idd * 3] * b3;
    let ey = E[ia * 3 + 1] * b0 + E[ib * 3 + 1] * b1 + E[ic * 3 + 1] * b2 + E[idd * 3 + 1] * b3;
    let ez = E[ia * 3 + 2] * b0 + E[ib * 3 + 2] * b1 + E[ic * 3 + 2] * b2 + E[idd * 3 + 2] * b3;
    if (ex * ex + ey * ey + ez * ez < 1e-8) {
      // on a medial line the field cancels: use the strongest vertex's
      const bs = [b0, b1, b2, b3], vs = [ia, ib, ic, idd];
      let km = 0;
      for (let k = 1; k < 4; k++) if (bs[k] > bs[km]) km = k;
      ex = E[vs[km] * 3]; ey = E[vs[km] * 3 + 1]; ez = E[vs[km] * 3 + 2];
    }
    const a = ia * 3, b = ib * 3, c = ic * 3, d = idd * 3;
    const e1x = x[b] - x[a], e1y = x[b + 1] - x[a + 1], e1z = x[b + 2] - x[a + 2];
    const e2x = x[c] - x[a], e2y = x[c + 1] - x[a + 1], e2z = x[c + 2] - x[a + 2];
    const e3x = x[d] - x[a], e3y = x[d + 1] - x[a + 1], e3z = x[d + 2] - x[a + 2];
    const B = this.B, bo = t * 9;
    const y0 = B[bo] * ex + B[bo + 1] * ey + B[bo + 2] * ez;
    const y1 = B[bo + 3] * ex + B[bo + 4] * ey + B[bo + 5] * ez;
    const y2 = B[bo + 6] * ex + B[bo + 7] * ey + B[bo + 8] * ez;
    const wx = e1x * y0 + e2x * y1 + e3x * y2, wy = e1y * y0 + e2y * y1 + e3y * y2, wz = e1z * y0 + e2z * y1 + e3z * y2;
    const wl = Math.sqrt(wx * wx + wy * wy + wz * wz);
    if (wl < 1e-9) return false;
    ct.nx = wx / wl; ct.ny = wy / wl; ct.nz = wz / wl;
    // (a badly squashed tet maps the escape vector to nonsense lengths)
    ct.depth = Math.min(wl, 1.5 * Math.sqrt(ex * ex + ey * ey + ez * ez)) + 0.002;
    return true;
  }

  _solvePieceCollisions(h) {
    const { x, px: q, w, T, tPiece, sTri } = this;
    const skip = this._skip, rel = this._pRel;
    this._pass++;
    const ct = this._ct;
    const pv = this._probeV, pf = this._probeF;
    const P = this.pieces, aw = this._awake;
    // probe = 1 vertex, or a face centre spread over 3 vertices
    const pi3 = this._pi3, pw3 = this._pw3, ti4 = this._ti4, tb4 = this._tb4;
    const cS = this._pcStart, cE = this._pcEnd;
    const wtV = this._wtV, wfV = this._wfV, wtF = this._wtF, wfF = this._wfF;
    const GP = this.grabs.length ? this._grabbedP : null, PP = this._pressP;
    let press = 0;
    const nProbes = this._nProbeV + this._nProbeF;
    for (let k = 0; k < nProbes; k++) {
      let n, own, cx, cy, cz, qx, qy, qz;
      if (k < this._nProbeV) {
        const i = pv[k], o = i * 3;
        n = 1;
        pi3[0] = i; pw3[0] = 1;
        own = this.vPiece[i];
        cx = x[o]; cy = x[o + 1]; cz = x[o + 2];
        qx = q[o]; qy = q[o + 1]; qz = q[o + 2];
      } else {
        const f = pf[k - this._nProbeV];
        n = 3;
        const a = sTri[f * 3], b = sTri[f * 3 + 1], c = sTri[f * 3 + 2];
        pi3[0] = a; pi3[1] = b; pi3[2] = c;
        pw3[0] = pw3[1] = pw3[2] = 1 / 3;
        own = tPiece[this.sTet[f]];
        cx = (x[a * 3] + x[b * 3] + x[c * 3]) / 3; cy = (x[a * 3 + 1] + x[b * 3 + 1] + x[c * 3 + 1]) / 3; cz = (x[a * 3 + 2] + x[b * 3 + 2] + x[c * 3 + 2]) / 3;
        qx = (q[a * 3] + q[b * 3] + q[c * 3]) / 3; qy = (q[a * 3 + 1] + q[b * 3 + 1] + q[c * 3 + 1]) / 3; qz = (q[a * 3 + 2] + q[b * 3 + 2] + q[c * 3 + 2]) / 3;
      }
      const isV = k < this._nProbeV;
      const key = isV ? pi3[0] : pf[k - this._nProbeV];
      const WT = isV ? wtV : wtF, WF = isV ? wfV : wfF;
      // closing speed bound (+ headroom for this frame's changes)
      const room = skip[k] - (rel[k] + 0.5) * h * 1.25;
      if (room > 0) {
        skip[k] = room;
        continue;
      }
      if (!this._contact(cx, cy, cz, qx, qy, qz, cS[k], cE[k], own, WT[key], WF[key])) {
        skip[k] = this._gap;
        continue;
      }
      skip[k] = 0;
      WT[key] = ct.t;
      WF[key] = ct.f;
      if (GP && (GP[own] || GP[tPiece[ct.t]])) {
        if (ct.depth > press) press = ct.depth;
        // (per held piece: each hand eases off on its own)
        if (GP[own] && ct.depth > PP[own]) PP[own] = ct.depth;
        if (GP[tPiece[ct.t]] && ct.depth > PP[tPiece[ct.t]]) PP[tPiece[ct.t]] = ct.depth;
      }
      const t = ct.t, t4 = t * 4, d = ct.depth, pt = tPiece[t];
      // a real impact wakes sleepers - something moving into it, or pushed
      // well in - and otherwise a sleeping side is immovable (a neighbour
      // buzzing against it mustn't keep waking it)
      const po = P[own], pp = P[pt];
      if (d > 0.003 && (po.asleep || pp.asleep)) {
        const q = po.asleep ? pp.vel : po.vel;
        if (d > 0.012 || q[0] * q[0] + q[1] * q[1] + q[2] * q[2] > 0.08 * 0.08) {
          if (po.asleep) { po.asleep = false; po.sleepT = 0; aw[own] = 1; }
          if (pp.asleep) { pp.asleep = false; pp.sleepT = 0; aw[pt] = 1; }
        }
      }
      const mOwn = po.asleep ? 0 : 1, mTet = pp.asleep ? 0 : 1;
      ti4[0] = T[t4]; ti4[1] = T[t4 + 1]; ti4[2] = T[t4 + 2]; ti4[3] = T[t4 + 3];
      tb4[0] = ct.b0; tb4[1] = ct.b1; tb4[2] = ct.b2; tb4[3] = ct.b3;
      let wP = 0, wT = 0;
      for (let j = 0; j < n; j++) wP += pw3[j] * pw3[j] * w[pi3[j]];
      wP *= mOwn;
      for (let j = 0; j < 4; j++) wT += tb4[j] * tb4[j] * w[ti4[j]];
      wT *= mTet;
      const W = wP + wT;
      if (W <= 0) continue;
      const nx = ct.nx, ny = ct.ny, nz = ct.nz;
      // relative motion this substep (probe vs the point of the tet under it)
      let sx = cx - qx, sy = cy - qy, sz = cz - qz;
      for (let j = 0; j < 4; j++) {
        const i = ti4[j] * 3;
        sx -= tb4[j] * (x[i] - q[i]); sy -= tb4[j] * (x[i + 1] - q[i + 1]); sz -= tb4[j] * (x[i + 2] - q[i + 2]);
      }
      const sn = sx * nx + sy * ny + sz * nz;
      // gentle for resting contact, full strength when really penetrating
      const relax = d < 0.004 ? 0.5 : d > 0.02 ? 1 : 0.5 + ((d - 0.004) / 0.016) * 0.5;
      // (deep ones come out over a few substeps, not in one violent jump)
      const corr = Math.min(d * relax, 0.035 * this.p.size);
      // split: the part that cancels the approach may change velocity, the
      // rest is a pure position fix (contact must not inject bounce/jitter)
      const cv = Math.min(Math.max(-sn, 0), corr), cp = corr - cv;
      const lam = corr / W, lamP = cp / W;
      if (cv > 0) {
        // impulse (as m*dx) each side took from stopping the approach
        const J = cv / W, I = this._imp, pr = this._impPartner;
        if (mOwn) {
          const q = own * 12 + 8;
          I[q] += J; I[q + 1] += J * cx; I[q + 2] += J * cy; I[q + 3] += J * cz;
        }
        if (mTet) {
          const q = pt * 12 + 8;
          I[q] += J; I[q + 1] += J * cx; I[q + 2] += J * cy; I[q + 3] += J * cz;
        }
        pr[own] = pt;
        pr[pt] = own;
      }
      for (let j = 0; j < n; j++) {
        const i = pi3[j], s = w[i] * pw3[j] * mOwn;
        x[i * 3] += nx * s * lam; x[i * 3 + 1] += ny * s * lam; x[i * 3 + 2] += nz * s * lam;
        q[i * 3] += nx * s * lamP; q[i * 3 + 1] += ny * s * lamP; q[i * 3 + 2] += nz * s * lamP;
      }
      if (mTet) for (let j = 0; j < 4; j++) {
        const i = ti4[j], s = w[i] * tb4[j];
        x[i * 3] -= nx * s * lam; x[i * 3 + 1] -= ny * s * lam; x[i * 3 + 2] -= nz * s * lam;
        q[i * 3] -= nx * s * lamP; q[i * 3 + 1] -= ny * s * lamP; q[i * 3 + 2] -= nz * s * lamP;
      }
      // light friction on the sliding part of the relative motion
      sx -= sn * nx; sy -= sn * ny; sz -= sn * nz;
      const sl = Math.hypot(sx, sy, sz);
      if (sl > 1e-9) {
        const kf = (Math.min(1, (0.5 * this.p.contactGrip * d) / sl) * 0.7) / W;
        for (let j = 0; j < n; j++) {
          const i = pi3[j], s = w[i] * pw3[j] * mOwn * kf;
          x[i * 3] -= sx * s; x[i * 3 + 1] -= sy * s; x[i * 3 + 2] -= sz * s;
        }
        if (mTet) for (let j = 0; j < 4; j++) {
          const i = ti4[j], s = w[i] * tb4[j] * kf;
          x[i * 3] += sx * s; x[i * 3 + 1] += sy * s; x[i * 3 + 2] += sz * s;
        }
      }
    }
    this._grabPress = press;
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
    if (hit) this._hashDirty = true;
    return hit;
  }

  // A blast out from p (strongest at the centre, gone at radius) plus a
  // lift. rigid (0..1): how much each piece flies off as a whole instead of
  // being stretched by the blast's spread over it.
  radialImpulse(px, py, pz, radius, strength, up = 0, rigid = 0) {
    const { x, v, w } = this;
    this._hashDirty = true;
    // the chunks of a blast skip self-contact while they fly: tumbling and
    // torn about, every self probe would sweep through a lot of its own body
    // (the heaviest moments get heavier still), for nothing anyone could see
    this.selfQuietUntil = Math.max(this.selfQuietUntil, this.time + 0.5);
    const dv = rigid > 0 ? new Float64Array(this.nV * 3) : null;
    for (let i = 0; i < this.nV; i++) {
      if (w[i] === 0) continue;
      const o = i * 3;
      const ex = x[o] - px, ey = x[o + 1] - py, ez = x[o + 2] - pz;
      const d = Math.hypot(ex, ey, ez);
      if (d > radius || d < 1e-6) continue;
      const f = 1 - d / radius;
      const s = (strength * f * f) / d;
      const ux = ex * s, uy = ey * s + up * f, uz = ez * s;
      v[o] += ux; v[o + 1] += uy; v[o + 2] += uz;
      if (dv) { dv[o] = ux; dv[o + 1] = uy; dv[o + 2] = uz; }
      if (this.pieces[this.vPiece[i]].asleep) this.wake(this.vPiece[i]);
      this.pieces[this.vPiece[i]].touchT = this.time;
    }
    if (!dv) return;
    for (const pc of this.pieces) {
      let mx = 0, my = 0, mz = 0, M = 0;
      for (const i of pc.verts) {
        const mi = this.m[i];
        mx += dv[i * 3] * mi; my += dv[i * 3 + 1] * mi; mz += dv[i * 3 + 2] * mi;
        M += mi;
      }
      if (M <= 0) continue;
      mx /= M; my /= M; mz /= M;
      for (const i of pc.verts) {
        const o = i * 3;
        v[o] += rigid * (mx - dv[o]); v[o + 1] += rigid * (my - dv[o + 1]); v[o + 2] += rigid * (mz - dv[o + 2]);
      }
    }
  }

  // A bullet's temporary cavity (ballistic gel): along the segment a -> b,
  // the jelly round the path flung outward from it - strongest at the path,
  // gone at radius, fading along it as the bullet slows (strength at a, fade
  // x that at b) - and dragged a little along with it (along, m/s). The
  // jelly balloons round the wound and, its elasticity pulling it back,
  // collapses and wobbles.
  cavity(ax, ay, az, bx, by, bz, radius, strength, fade = 0.4, along = 0) {
    const { x, v, w } = this;
    this._hashDirty = true;
    this.selfQuietUntil = Math.max(this.selfQuietUntil, this.time + 0.4);
    const dx = bx - ax, dy = by - ay, dz = bz - az, L2 = dx * dx + dy * dy + dz * dz;
    if (L2 < 1e-12) return;
    const L = Math.sqrt(L2), ux = dx / L, uy = dy / L, uz = dz / L;
    for (let i = 0; i < this.nV; i++) {
      if (w[i] === 0) continue;
      const o = i * 3;
      const rx = x[o] - ax, ry = x[o + 1] - ay, rz = x[o + 2] - az;
      const s = Math.max(0, Math.min(1, (rx * dx + ry * dy + rz * dz) / L2));
      const px = rx - dx * s, py = ry - dy * s, pz = rz - dz * s;
      const d = Math.sqrt(px * px + py * py + pz * pz);
      if (d > radius) continue;
      const f = 1 - d / radius, k = strength * (1 - (1 - fade) * s) * f * f;
      const q = d > 1e-6 ? k / d : 0;
      v[o] += px * q + ux * along * f; v[o + 1] += py * q + uy * along * f; v[o + 2] += pz * q + uz * along * f;
      const pc = this.pieces[this.vPiece[i]];
      if (!pc) continue;
      if (pc.asleep) this.wake(this.vPiece[i]);
      pc.touchT = this.time;
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

  // the first hand (most callers only ever have one)
  get grab() {
    return this.grabs.length ? this.grabs[0] : null;
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
    this._hashDirty = true;
    const g = {
      n: idx.length,
      idx: Int32Array.from(idx),
      wt: Float64Array.from(wt),
      off: Float64Array.from(off),
      tx, ty, tz,
      compliance: 2e-6,
      piece: hit.piece,
    };
    this.grabs.push(g);
    return g;
  }

  // Let go of one hand's grab (none given: all of them).
  endGrab(g) {
    if (g) {
      const k = this.grabs.indexOf(g);
      if (k >= 0) this.grabs.splice(k, 1);
    } else this.grabs.length = 0;
    this._hashDirty = true;
  }

  // Which pieces hands are holding (any piece with a held vertex: a tear can
  // leave one hand holding two), into _grabbedP; each grab's piece follows
  // its first live vertex.
  _markGrabbed() {
    const NP = this.pieces.length;
    const G = this._grabbedP && this._grabbedP.length >= NP ? this._grabbedP : (this._grabbedP = new Uint8Array(Math.max(NP, 64)));
    G.fill(0, 0, NP);
    for (let n = this.grabs.length - 1; n >= 0; n--) {
      const g = this.grabs[n];
      let first = -1;
      for (let j = 0; j < g.n; j++) {
        const k = this.vPiece[g.idx[j]];
        if (k < 0) continue;
        if (first < 0) first = k;
        G[k] = 1;
      }
      if (first < 0) this.grabs.splice(n, 1); // (all it held is gone)
      else g.piece = first;
    }
    return G;
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
