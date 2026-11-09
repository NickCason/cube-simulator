import { shapeSDF, shapeNormal, lobeOut, lobeFlat } from '../sim/mesh.js';
import * as THREE from 'three';
import { biasExp, RUBIK_COLORS, gradAt, gradSequence, GRAD_SHAPE_INDEX, rubikPack, rubikStateOf, TRIM } from '../styles.js';
import { FREE_N, bakeFree } from '../freeform.js';
import { MAX_CUBES, REST_STEP } from '../sim/softbody.js';
import {
  createBackMaterial,
  createCoverMaterial,
  createJellyMaterial,
  createCausticMaterial,
  createLightViewMaterial,
  createMaskMaterial,
  createTintMaterial,
  createHeightMaterial,
  createReflectMaterial,
  createGlowMaterial,
  createLayerUniforms,
  absorptionFromColor,
  jellyDefines,
  JELLY_ALL,
  JELLY_DEBUG,
  MAX_PULSES,
  GRAD_N,
  GRAD_ROWS,
} from './jellyMaterials.js';
import { SURFACES, surfaceBakeGLSL, surfaceOf, surfaceFit, surfaceSites } from '../surfaces.js';

const FLOOR_SPAN = 6.4;
const CAUS_GAIN = 1.5; // (how bright the caustic light lands)
// (how milky jelly of that opacity looks: see setStyle)
// a row of the cube-look texture: 7 texels of looks, 10 + 10 of layers, the
// colour of its light, a freeform gradient's depth
// (a smooth cube with a trim: a surface kind of its own, past the surfaces'; its map's depth)
export const TRIM_KIND = SURFACES.length, TRIM_DEPTH = 0.024;
export const CUBE_TEX_W = 35; // (30: the powder on it - Flour writes it; 31: its surface map; 32, 33: a Rubik's stickers; 34: a die's ink)

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const hazeMinOf = (o) => 0.92 * Math.min(1, Math.max(0, (Math.min(1, Math.max(0, o)) - 0.45) / 0.55)) ** 2;

// One level of subdivision over an indexed triangle mesh: a midpoint per
// edge. geo[v] says where v is (split vertices along a crease share it). An
// edge whose two sides use the same vertices is smooth: one shared midpoint,
// Phong-tessellated. Otherwise each side gets its own, on the straight edge,
// so the surface stays watertight. Midpoints are numbered from `first`.
function splitEdges(index, geo, first, refine = null) {
  // pair up the half-edges by where their ends are: an open-addressing
  // table keyed on the (geo, geo) pair, chaining the half-edges per edge
  const nH = index.length;
  let cap = 16;
  while (cap < nH * 2) cap <<= 1;
  const ka = new Int32Array(cap).fill(-1), kb = new Int32Array(cap), head = new Int32Array(cap);
  const next = new Int32Array(nH);
  for (let h = 0; h < nH; h++) {
    const t3 = h - (h % 3);
    let ga = geo[index[h]], gb = geo[index[t3 + ((h - t3 + 1) % 3)]];
    if (ga > gb) {
      const tmp = ga;
      ga = gb;
      gb = tmp;
    }
    let slot = (Math.imul(ga, 0x9e3779b1) ^ Math.imul(gb, 0x85ebca6b)) & (cap - 1);
    while (ka[slot] !== -1 && (ka[slot] !== ga || kb[slot] !== gb)) slot = (slot + 1) & (cap - 1);
    if (ka[slot] === -1) {
      ka[slot] = ga;
      kb[slot] = gb;
      next[h] = -1;
    } else next[h] = head[slot];
    head[slot] = h;
  }
  // (the other end of half-edge h)
  const endB = (h) => index[h - (h % 3) + ((h % 3) + 1) % 3];
  const mids = new Int32Array(nH * 3), midGeo = new Int32Array(nH);
  let nm = 0;
  const triMid = new Int32Array(nH);
  let g = 0;
  // (with a refine mask, only edges of triangles being refined are split:
  // a smooth edge if either side is, a crease side if its own is)
  const wants = (h) => !refine || refine[(h - (h % 3)) / 3] === 1;
  triMid.fill(-1);
  for (let slot = 0; slot < cap; slot++) {
    if (ka[slot] === -1) continue;
    const h0 = head[slot], h1 = next[h0];
    const n = h1 === -1 ? 1 : next[h1] === -1 ? 2 : 3;
    let smooth = n === 1;
    if (n === 2) {
      const a0 = index[h0], b0 = endB(h0), a1 = index[h1], b1 = endB(h1);
      smooth = (a0 === a1 && b0 === b1) || (a0 === b1 && b0 === a1);
    }
    if (smooth) {
      if (wants(h0) || (n === 2 && wants(h1))) {
        const id = first + nm;
        mids[nm * 3] = index[h0]; mids[nm * 3 + 1] = endB(h0); mids[nm * 3 + 2] = 0;
        midGeo[nm++] = g;
        triMid[h0] = id;
        if (n === 2) triMid[h1] = id;
      }
    } else {
      for (let h = h0; h !== -1; h = next[h]) {
        if (!wants(h)) continue;
        mids[nm * 3] = index[h]; mids[nm * 3 + 1] = endB(h); mids[nm * 3 + 2] = 1;
        triMid[h] = first + nm;
        midGeo[nm++] = g;
      }
    }
    g++;
  }
  // each triangle split by how many of its edges were: 4 ways, 3, 2 or not
  // at all (so a refined patch meets the rest without cracks)
  const nTri = nH / 3;
  const out = new Uint32Array(nTri * 12);
  const start = new Int32Array(nTri + 1);
  let o = 0;
  const tri = (p, q, r) => {
    out[o] = p; out[o + 1] = q; out[o + 2] = r;
    o += 3;
  };
  for (let t = 0; t < nTri; t++) {
    start[t] = o;
    const a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2];
    const ab = triMid[t * 3], bc = triMid[t * 3 + 1], ca = triMid[t * 3 + 2];
    const k = (ab >= 0) + (bc >= 0) + (ca >= 0);
    if (k === 3) {
      tri(a, ab, ca); tri(ab, b, bc); tri(ca, bc, c); tri(ab, bc, ca);
    } else if (k === 0) tri(a, b, c);
    else if (k === 1) {
      if (ab >= 0) (tri(a, ab, c), tri(ab, b, c));
      else if (bc >= 0) (tri(a, b, bc), tri(a, bc, c));
      else (tri(a, b, ca), tri(ca, b, c));
    } else if (ca < 0) (tri(ab, b, bc), tri(a, ab, bc), tri(a, bc, c));
    else if (ab < 0) (tri(bc, c, ca), tri(b, bc, ca), tri(b, ca, a));
    else (tri(ca, a, ab), tri(c, ca, ab), tri(c, ab, b));
  }
  start[nTri] = o;
  return { mids: mids.slice(0, nm * 3), midGeo: midGeo.subarray(0, nm), nEdges: g, index: out.slice(0, o), start };
}

// Area-weighted vertex normals of the first n vertices.
function vertexNormals(index, pos, nrm, n) {
  nrm.fill(0, 0, n * 3);
  for (let k = 0; k < index.length; k += 3) {
    const a = index[k] * 3, b = index[k + 1] * 3, c = index[k + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz;
    nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz;
    nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
  }
  for (let o = 0; o < n * 3; o += 3) {
    const l = Math.hypot(nrm[o], nrm[o + 1], nrm[o + 2]) || 1;
    nrm[o] /= l; nrm[o + 1] /= l; nrm[o + 2] /= l;
  }
}

// The edge midpoints (see splitEdges), from their ends: Phong-tessellated
// on smooth edges, straight on creases, then pushed out along the normal by
// disp (to the true shape - see snapToShape). data (per-vertex extras) may
// be null.
const PHONG = 0.75;
function tessellate(pos, nrm, data, mids, first, disp, coat = null, coatM = null, disp3 = null, twin = null) {
  for (let m = 0, k = first, j = 0; m < mids.length; m += 3, k++, j++) {
    const a = mids[m] * 3, b = mids[m + 1] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
    let qx = (ax + bx) * 0.5, qy = (ay + by) * 0.5, qz = (az + bz) * 0.5;
    const nax = nrm[a], nay = nrm[a + 1], naz = nrm[a + 2];
    const nbx = nrm[b], nby = nrm[b + 1], nbz = nrm[b + 2];
    if (!mids[m + 2]) {
      const da = (qx - ax) * nax + (qy - ay) * nay + (qz - az) * naz;
      const db = (qx - bx) * nbx + (qy - by) * nby + (qz - bz) * nbz;
      qx -= 0.5 * (da * nax + db * nbx) * PHONG;
      qy -= 0.5 * (da * nay + db * nby) * PHONG;
      qz -= 0.5 * (da * naz + db * nbz) * PHONG;
    }
    let nx = nax + nbx, ny = nay + nby, nz = naz + nbz;
    let l2 = nx * nx + ny * ny + nz * nz;
    // (ends facing opposite ways - an edge across a thin sliver - sum to
    // nothing: a zero normal turns every shader's normalize() into NaN, and
    // the mipmapped buffers spread that into black blocks. Take an end's.)
    if (!(l2 > 1e-12)) {
      nx = nax; ny = nay; nz = naz;
      l2 = nx * nx + ny * ny + nz * nz;
      if (!(l2 > 1e-12)) {
        nx = 0; ny = 1; nz = 0;
        l2 = 1;
      }
    }
    const il = 1 / Math.sqrt(l2); // (Math.hypot is slow in a loop this hot)
    nx *= il; ny *= il; nz *= il;
    const d = disp[j];
    const o = k * 3;
    // (a scalloped cube's: onto its lobes by an offset along its edge, out,
    // and across - each as the edge and its normal are now: see snapToLobes)
    if (twin && twin[j] >= 0) {
      // (a crease's other side's: just where that one is)
      const t = twin[j] * 3;
      pos[o] = pos[t]; pos[o + 1] = pos[t + 1]; pos[o + 2] = pos[t + 2];
    } else if (disp3 && (disp3[j * 3] !== 0 || disp3[j * 3 + 1] !== 0 || disp3[j * 3 + 2] !== 0)) {
      const ex = bx - ax, ey = by - ay, ez = bz - az, el = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1e-9;
      let sx = ny * ez - nz * ey, sy = nz * ex - nx * ez, sz = nx * ey - ny * ex;
      const sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1e-9;
      sx /= sl; sy /= sl; sz /= sl;
      const ae = disp3[j * 3], bn = disp3[j * 3 + 1], gs = disp3[j * 3 + 2];
      pos[o] = qx + ex * ae + nx * bn + sx * gs;
      pos[o + 1] = qy + ey * ae + ny * bn + sy * gs;
      pos[o + 2] = qz + ez * ae + nz * bn + sz * gs;
    } else {
      pos[o] = qx + nx * d; pos[o + 1] = qy + ny * d; pos[o + 2] = qz + nz * d;
    }
    nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz;
    if (data) {
      const da4 = mids[m] * 4, db4 = mids[m + 1] * 4, o4 = k * 4;
      data[o4] = (data[da4] + data[db4]) * 0.5;
      data[o4 + 1] = (data[da4 + 1] + data[db4 + 1]) * 0.5;
      data[o4 + 2] = Math.max(data[da4 + 2], data[db4 + 2]);
      data[o4 + 3] = (data[da4 + 3] + data[db4 + 3]) * 0.5; // (powder)
    }
    if (coat) {
      const ca = mids[m] * 4, cb = mids[m + 1] * 4, o4 = k * 4;
      coat[o4] = (coat[ca] + coat[cb]) * 0.5;
      coat[o4 + 1] = (coat[ca + 1] + coat[cb + 1]) * 0.5;
      coat[o4 + 2] = (coat[ca + 2] + coat[cb + 2]) * 0.5;
      coat[o4 + 3] = (coat[ca + 3] + coat[cb + 3]) * 0.5;
      coatM[k] = (coatM[mids[m]] + coatM[mids[m + 1]]) * 0.5;
    }
  }
}

// At rest (pos/nrm the rest shape, the midpoints just tessellated with no
// push): how far each midpoint on the cube's original outside must move
// along its normal to sit on the true rounded box (half-size a + r, edge
// radius r), and moves it there. Only smooth edges whose ends are both on
// that surface and whose normal agrees with it - not cut faces, not seams.
const _cp = new Float64Array(6);
function roundedBox(px, py, pz, a, r) {
  const qx = Math.max(-a, Math.min(a, px)), qy = Math.max(-a, Math.min(a, py)), qz = Math.max(-a, Math.min(a, pz));
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len > 1e-9) {
    _cp[3] = dx / len; _cp[4] = dy / len; _cp[5] = dz / len;
    _cp[0] = qx + _cp[3] * r; _cp[1] = qy + _cp[4] * r; _cp[2] = qz + _cp[5] * r;
    return len - r;
  }
  // inside the core box: the nearest face
  _cp[0] = px; _cp[1] = py; _cp[2] = pz; _cp[3] = _cp[4] = _cp[5] = 0;
  let ax = 0, gap = Infinity;
  for (let c = 0; c < 3; c++) {
    const g = a + r - Math.abs(_cp[c]);
    if (g < gap) (gap = g), (ax = c);
  }
  const sg = _cp[ax] < 0 ? -1 : 1;
  _cp[ax] = sg * (a + r);
  _cp[3 + ax] = sg;
  return -gap;
}
// (a cube's own shape - a scalloped one's lobes too (mesh.js shapeSDF):
// its distance, and the nearest point on it and the way out there in _cp)
const _n3 = [0, 0, 0];
function shapeAt(px, py, pz, s) {
  if (!s.lobe) return roundedBox(px, py, pz, s.a, s.r);
  const d = shapeSDF(px, py, pz, s.a + s.r, s.r, s.lobe);
  shapeNormal(px, py, pz, s.a + s.r, s.r, s.lobe, _n3);
  _cp[3] = _n3[0]; _cp[4] = _n3[1]; _cp[5] = _n3[2];
  _cp[0] = px - _n3[0] * d; _cp[1] = py - _n3[1] * d; _cp[2] = pz - _n3[2] * d;
  return d;
}
// A scalloped cube's new points exactly onto its lobes (at rest): each one's
// way there kept as so much of its edge, of its normal and of across - so
// it lands on them however the jelly bends (see tessellate). Only on its
// outside: both its edge's ends on the shape. A crease's too (a sharp edge's
// crest): both its sides', together (see twins).
function snapToLobes(pos, nrm, mids, first, disp3, shapes, cube, onLobe = null) {
  let any = false;
  const on = new Int8Array(first);
  const onShape = (v) => {
    const s = shapes[cube[v]];
    if (!on[v]) on[v] = !s.lobe || Math.abs(shapeSDF(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], s.a + s.r, s.r, s.lobe)) > 4e-3 ? -1 : 1;
    return on[v] > 0;
  };
  for (let m = 0, k = first, j = 0; m < mids.length; m += 3, k++, j++) {
    if (!onShape(mids[m]) || !onShape(mids[m + 1])) continue;
    if (onLobe) onLobe[k] = 1;
    const S = shapes[cube[mids[m]]], o = k * 3;
    const ia = mids[m] * 3, ib = mids[m + 1] * 3;
    // (where it belongs: the plain box's nearest point, straight out from
    // there to the scalloped skin)
    roundedBox(pos[o], pos[o + 1], pos[o + 2], S.a, S.r);
    const bx = _cp[0], by = _cp[1], bz = _cp[2], bnx = _cp[3], bny = _cp[4], bnz = _cp[5];
    const D = lobeOut(bx, by, bz, bnx, bny, bnz, S.a + S.r, S.r, S.lobe);
    const x = bx + bnx * D, y = by + bny * D, z = bz + bnz * D;
    const ex = pos[ib] - pos[ia], ey = pos[ib + 1] - pos[ia + 1], ez = pos[ib + 2] - pos[ia + 2], el2 = ex * ex + ey * ey + ez * ez || 1e-18;
    const nx = nrm[o], ny = nrm[o + 1], nz = nrm[o + 2];
    let sx = ny * ez - nz * ey, sy = nz * ex - nx * ez, sz = nx * ey - ny * ex;
    const sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1e-9;
    sx /= sl; sy /= sl; sz /= sl;
    const ox = x - pos[o], oy = y - pos[o + 1], oz = z - pos[o + 2];
    disp3[j * 3] = (ox * ex + oy * ey + oz * ez) / el2;
    disp3[j * 3 + 1] = ox * nx + oy * ny + oz * nz;
    disp3[j * 3 + 2] = ox * sx + oy * sy + oz * sz;
    pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
    any = true;
  }
  return any;
}

// (a crease's new points - one each side of it, at one place - the later
// ones' first one: where a scalloped cube's are moved to, they move together)
function twins(mids, midGeo, first) {
  const n = mids.length / 3, tw = new Int32Array(n).fill(-1);
  for (let j = 1, f = 0; j < n; j++) {
    if (!mids[j * 3 + 2] || midGeo[j] !== midGeo[j - 1]) f = j;
    else tw[j] = first + f;
  }
  return tw;
}

// (shapes: each cube's { a, r, lobe }; cube: each render vertex's cube)
function snapToShape(pos, nrm, mids, first, disp, shapes, cube) {
  // (whether each vertex below `first` is on its cube's shape, worked out once)
  const on = new Int8Array(first);
  const onShape = (v) => {
    const s = shapes[cube[v]];
    if (!on[v]) on[v] = !(s.a > 0) || Math.abs(shapeAt(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], s)) > 4e-3 ? -1 : 1;
    return on[v] > 0;
  };
  for (let m = 0, k = first, j = 0; m < mids.length; m += 3, k++, j++) {
    if (mids[m + 2]) continue;
    if (!onShape(mids[m]) || !onShape(mids[m + 1])) continue;
    const S = shapes[cube[mids[m]]];
    const ia = mids[m] * 3, ib = mids[m + 1] * 3, o = k * 3;
    const ex = pos[ia] - pos[ib], ey = pos[ia + 1] - pos[ib + 1], ez = pos[ia + 2] - pos[ib + 2];
    const len = Math.sqrt(ex * ex + ey * ey + ez * ez);
    const sd = shapeAt(pos[o], pos[o + 1], pos[o + 2], S);
    const nx = nrm[o], ny = nrm[o + 1], nz = nrm[o + 2];
    // (a scalloped one's lobes turn faster than its mesh: let it reach further)
    const L = !!S.lobe;
    if (sd < (L ? -0.6 : -0.35) * len || nx * _cp[3] + ny * _cp[4] + nz * _cp[5] < (L ? 0.45 : 0.9)) continue;
    const d = (_cp[0] - pos[o]) * nx + (_cp[1] - pos[o + 1]) * ny + (_cp[2] - pos[o + 2]) * nz;
    if (Math.abs(d) > (L ? 0.6 : 0.25) * len) continue;
    disp[j] = d;
    pos[o] += nx * d; pos[o + 1] += ny * d; pos[o + 2] += nz * d;
  }
}

// (screen outlines, for the refraction layers: see renderPieces)
const SURF_N = 128, HULL_STEP = 2; // (a piece's surface points sampled; its outline from every HULL_STEP-th)
function convexHull(pts) {
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
    up.push(p);
  }
  up.pop();
  lo.pop();
  return lo.concat(up);
}
function polyArea(P) {
  let s = 0;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(s) / 2;
}
// (convex S clipped to convex C, both anticlockwise)
function clipConvex(S, C) {
  let out = S;
  for (let i = 0; i < C.length && out.length; i++) {
    const A = C[i], B = C[(i + 1) % C.length], inp = out;
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const P = inp[j], Q = inp[(j + 1) % inp.length];
      const sp = (B[0] - A[0]) * (P[1] - A[1]) - (B[1] - A[1]) * (P[0] - A[0]);
      const sq = (B[0] - A[0]) * (Q[1] - A[1]) - (B[1] - A[1]) * (Q[0] - A[0]);
      if (sp >= 0) out.push(P);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]);
      }
    }
  }
  return out;
}

// Owns the jelly GPU geometry and the multi-pass jelly rendering. The
// pieces share their vertex attributes and are drawn together: one mesh of
// them all (for the passes that draw every piece - the light's view, the
// floor's masks, the mirror) and one per refraction layer (see
// renderPieces), each a single draw call. (A mesh per piece cost ~8 draw
// calls per piece per frame: past a hundred pieces, 200 ms a frame.)
export class JellyView {
  constructor(renderer, env, lightDir) {
    this.maxLayers = 5; // (phones: fewer; see App)
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.allMesh = null; // every piece
    this.layerMeshes = []; // the pieces of each refraction layer
    this.pieceIdx = new Int32Array(0); // per piece: its run [start, end) of the index buffer
    this.fullIndex = null;
    this.layerOf = new Int8Array(0); // per piece: its layer last frame (-1: none)
    this.layerCount = new Int32Array(0); // per layer: indices in its mesh
    this.topoVersion = -1;
    this._vp = new THREE.Matrix4();
    this.layerUniforms = createLayerUniforms();
    this.backMat = createBackMaterial();
    // (a gradient across, corner to corner or out from the middle wants the
    // whole rest point where the line of sight leaves, in a second target:
    // only drawn while there's one - see needRest, setSize, renderPieces)
    this.backMatRest = createBackMaterial(true);
    this.needRest = false;
    this.rtBackRest = null;
    this.frontMat = createJellyMaterial(env, this.layerUniforms);
    // (Mesa - Linux's GL - hung the GPU or crashed compiling a shader while
    // another was still compiling aside: there a set's compiled all at once,
    // while it's quiet - see setFeatures)
    const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this._serialCompile = /mesa/i.test(String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER)));
    // each cube's look, a row each (see setCubeLook; the front shader reads it)
    this.cubeData = new Float32Array(CUBE_TEX_W * MAX_CUBES * 4);
    this.cubeTex = new THREE.DataTexture(this.cubeData, CUBE_TEX_W, MAX_CUBES, THREE.RGBAFormat, THREE.FloatType);
    this.cubeTex.minFilter = this.cubeTex.magFilter = THREE.NearestFilter;
    this.cubeTex.generateMipmaps = false;
    this.cubeTex.needsUpdate = true;
    this.frontMat.uniforms.uCubeTex.value = this.cubeTex;
    // (the back faces read it too: what coat the line of sight leaves through)
    this.backMat.uniforms.uCubeTex.value = this.cubeTex;
    this.backMatRest.uniforms.uCubeTex.value = this.cubeTex;
    // each cube's gradient (layered), as a strip: its absorption and the
    // colour inside along it, two rows a cube (see setCubeLook, CUBE_GLSL)
    this.gradData = new Uint16Array(GRAD_N * GRAD_ROWS * 4);
    this.gradTex = new THREE.DataTexture(this.gradData, GRAD_N, GRAD_ROWS, THREE.RGBAFormat, THREE.HalfFloatType);
    this.gradTex.minFilter = this.gradTex.magFilter = THREE.LinearFilter;
    this.gradTex.generateMipmaps = false;
    this.gradTex.needsUpdate = true;
    this.frontMat.uniforms.uGradTex.value = this.gradTex;
    // ...and a freeform one's, as a grid of colours (sRGB): a slab FREE_N a
    // side for each cube (see setCubeLook, freeform.js bakeFree)
    this.freeSlab = FREE_N * FREE_N * FREE_N * 4;
    this.freeData = new Uint8Array(this.freeSlab * MAX_CUBES);
    this.freeTex = new THREE.Data3DTexture(this.freeData, FREE_N, FREE_N, FREE_N * MAX_CUBES);
    this.freeTex.colorSpace = THREE.SRGBColorSpace;
    this.freeTex.minFilter = this.freeTex.magFilter = THREE.LinearFilter;
    this.freeTex.unpackAlignment = 1;
    this.freeTex.needsUpdate = true;
    this.frontMat.uniforms.uFreeTex.value = this.freeTex;
    // (depth first, so the front shader - the heavy one - runs once a pixel:
    // a stepped, folded or many-sided piece seen low drew over itself 2-4x)
    this.depthMat = new THREE.ShaderMaterial({ vertexShader: this.frontMat.vertexShader, fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }', colorWrite: false });
    // (the nearest skin's coat, a pixel at a time, at half size: what the
    // glitter and bubbles inside are seen through - see renderCover)
    this.coverMat = createCoverMaterial();
    this.coverMat.uniforms.uCubeTex.value = this.cubeTex;
    this.coverU = { tCover: { value: null }, uCoverOn: { value: 0 }, uCoverInv: { value: new THREE.Vector2(1, 1) } };
    this.prepass = true;
    this.causticMat = createCausticMaterial();
    // the caustics' view from the key light (entry, normal, exit) and their
    // grid of rays (see createCausticMaterial); the grid's density
    const coarse = !!window.matchMedia?.('(pointer: coarse)').matches;
    const lvRes = coarse ? 384 : 512, gridN = coarse ? 192 : 256;
    const lvType = renderer.extensions.has('EXT_color_buffer_float') ? THREE.FloatType : THREE.HalfFloatType;
    const lvOpts = { type: lvType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true };
    // (entry and exit: a second target each, the rest point there - for
    // gradients out from the middle, the way through)
    this.lightView = [0, 1, 2].map((kind) => ({
      rt: new THREE.WebGLRenderTarget(lvRes, lvRes, kind === 1 ? { ...lvOpts, type: THREE.HalfFloatType } : { ...lvOpts, count: kind === 2 ? 3 : 2 }),
      mat: createLightViewMaterial(kind),
    }));
    // (the light's view of the surface maps: each cube's own)
    this._makeSurfaceAtlas();
    for (const { mat } of this.lightView) {
      mat.uniforms.uCubeTex.value = this.cubeTex;
      mat.uniforms.uGradTex.value = this.gradTex;
      mat.uniforms.uFreeTex.value = this.freeTex;
      mat.uniforms.uSurfAtlas.value = this.surfAtlas;
    }
    this.frontMat.uniforms.uSurfAtlas.value = this.surfAtlas;
    this.causticMat.uniforms.tEntry.value = this.lightView[0].rt.texture;
    this.causticMat.uniforms.tNormal.value = this.lightView[1].rt.texture;
    this.causticMat.uniforms.tExit.value = this.lightView[2].rt.texture;
    this.causticMat.uniforms.tEntryRest.value = this.lightView[0].rt.textures[1];
    this.causticMat.uniforms.tExitRest.value = this.lightView[2].rt.textures[1];
    // (and the exit's a third: its normal, for the light bent again going out)
    this.causticMat.uniforms.tExitN.value = this.lightView[2].rt.textures[2];
    // (on a desktop, the caustics drawn a colour at a time, each bent its own
    // amount: their edges split into rainbows)
    this.disperse = !coarse;
    // (a surface map's depth: fewer steps down into it on a phone)
    this.frontMat.uniforms.uSurfSteps.value = coarse ? 6 : 10;
    this.causticLevel = 1; // (0..1: faded out while a lot of bits re-cube - see App)
    this.skipCaustics = false; // (?stats' bench: see App.skip)
    this.forceMoving = null; // (true/false: the floor's effects drawn as though it's moving or at rest - App._warmGPU)
    this.bakesReady = false;
    this.layerCap = Infinity; // (and fewer refraction layers meanwhile)
    this.causticMat.uniforms.uDisperse.value = 1.5;
    // (and the jelly, for one cube's shadow on another - see cubeShadowAt)
    this.frontMat.uniforms.tLightEntry.value = this.lightView[0].rt.texture;
    this.frontMat.uniforms.tLightExit.value = this.lightView[2].rt.texture;
    this.multiCube = false; // (set by the app: several cubes)
    this.causticMat.uniforms.uGridN.value = gridN;
    this.lightCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40);
    this.lightOrigin = new THREE.Vector3();
    this.lightDir = new THREE.Vector3(0, 1, 0);
    this.gridScene = new THREE.Scene();
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, gridN - 1, gridN - 1), this.causticMat);
    grid.frustumCulled = false;
    this.gridScene.add(grid);
    this._corner = new THREE.Vector3();
    this.maskMat = createMaskMaterial();
    this.tintMat = createTintMaterial();
    this.heightMat = createHeightMaterial();
    this.reflectMat = createReflectMaterial();
    this.glowMat = createGlowMaterial();
    // (each cube's own colour in all of them)
    for (const m of [this.causticMat, this.tintMat, this.reflectMat, this.glowMat]) {
      m.uniforms.uCubeTex.value = this.cubeTex;
      m.uniforms.uGradTex.value = this.gradTex;
      m.uniforms.uFreeTex.value = this.freeTex;
    }
    // the pieces again, upside down below the floor (its reflection)
    this.reflScene = new THREE.Scene();
    this.mirror = null;
    this.fxCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // the floor's maps: glow mode's light pool over a fixed span (its blur is
    // its mip levels: their size must not change); the jelly's shadow and
    // contact fitted round it each frame (see _fitFloorFx) - over the whole
    // span a texel was 1.25 cm, and the shadow's edge showed it
    this.floorRect = new THREE.Vector4(-FLOOR_SPAN / 2, -FLOOR_SPAN / 2, 1 / FLOOR_SPAN, 1 / FLOOR_SPAN);
    this.fxRect = this.floorRect.clone();
    for (const m of [this.causticMat, this.glowMat]) {
      if (m.uniforms.uFloorRect) m.uniforms.uFloorRect.value = this.floorRect;
    }
    for (const m of [this.maskMat, this.heightMat, this.tintMat]) m.uniforms.uFloorRect.value = this.fxRect;
    this.setLightDir(lightDir);
    this.rtCaustic = new THREE.WebGLRenderTarget(768, 768, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      samples: 4,
      count: 2,
    });
    // (its second: how far the light that landed there fell from the jelly,
    // by its light - mipmapped, read round about: see floor.js)
    this.rtCaustic.textures[0].generateMipmaps = false;
    this.rtCaustic.textures[1].generateMipmaps = true;
    this.rtCaustic.textures[1].minFilter = THREE.LinearMipmapLinearFilter;
    // (and the same without the multisampling, for while it moves: see
    // renderFloorFx)
    this.rtCausticMoving = new THREE.WebGLRenderTarget(768, 768, { type: THREE.HalfFloatType, depthBuffer: false, count: 2 });
    this.rtCausticMoving.textures[0].generateMipmaps = false;
    this.rtCausticMoving.textures[1].generateMipmaps = true;
    this.rtCausticMoving.textures[1].minFilter = THREE.LinearMipmapLinearFilter;
    // (and at half the size, for when it's heavy going - frames held up by
    // the GPU while it moves: see App._adaptResolution. A cube shot full of
    // holes bends the light into a thousand stretched cells, each drawn over
    // the floor: its caustics alone were 20 ms of the GPU's a frame)
    this.rtCausticMovingLow = new THREE.WebGLRenderTarget(384, 384, { type: THREE.HalfFloatType, depthBuffer: false, count: 2 });
    this.rtCausticMovingLow.textures[0].generateMipmaps = false;
    this.rtCausticMovingLow.textures[1].generateMipmaps = true;
    this.rtCausticMovingLow.textures[1].minFilter = THREE.LinearMipmapLinearFilter;
    this.causticLow = false;
    // ...blurred, as the shadow's map is (a Gaussian ~3 mm, both ways), for
    // the floor and the jelly's view of it to read: read sharp with taps
    // centimetres apart, every caustic line was stamped over in copies - a
    // plaid. Mipmapped: blurred wider by mip level (the shadow's fill takes
    // its colour from it, wide; light through jelly up in the air lands soft)
    this.rtCausticT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtCausticB = new THREE.WebGLRenderTarget(512, 512, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    // (mipmapped: glow mode's light pool is its footprint, blurred wide)
    this.rtFloorFx = new THREE.WebGLRenderTarget(512, 512, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      samples: 4,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    // ...blurred (a Gaussian a couple of cm wide, both ways): the floor reads
    // its shadow edge from this - five taps on the raw map stamped the edge
    // four times over, in streaks
    this.rtFloorFxT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtFloorFxB = new THREE.WebGLRenderTarget(512, 512, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    this.blurMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: { tSrc: { value: null }, uStep: { value: new THREE.Vector2() } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc;
        uniform vec2 uStep;
        varying vec2 vUv;
        void main() {
          // 9 taps, sigma 2 steps
          vec4 c = textureLod(tSrc, vUv, 0.0) * 0.2042;
          c += (textureLod(tSrc, vUv + uStep, 0.0) + textureLod(tSrc, vUv - uStep, 0.0)) * 0.1802;
          c += (textureLod(tSrc, vUv + 2.0 * uStep, 0.0) + textureLod(tSrc, vUv - 2.0 * uStep, 0.0)) * 0.1238;
          c += (textureLod(tSrc, vUv + 3.0 * uStep, 0.0) + textureLod(tSrc, vUv - 3.0 * uStep, 0.0)) * 0.0663;
          c += (textureLod(tSrc, vUv + 4.0 * uStep, 0.0) + textureLod(tSrc, vUv - 4.0 * uStep, 0.0)) * 0.0276;
          gl_FragColor = c;
        }`,
    });
    this.blurScene = new THREE.Scene();
    const bq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMat);
    bq.frustumCulled = false;
    this.blurScene.add(bq);
    // each cube's shadow its own colour: the colour it gives the light, laid
    // where its shadow falls (see createTintMaterial; mipmapped, for the
    // wide fill round the shadow)
    this.rtFloorTint = new THREE.WebGLRenderTarget(256, 256, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    // glow mode: the light it casts on the floor, from above (see createGlowMaterial)
    this.rtGlow = new THREE.WebGLRenderTarget(256, 256, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    this.fxUniforms = {
      caustic: { value: this.rtCausticB.texture },
      causThrow: { value: this.rtCaustic.textures[1] }, // (how far its light fell: see floor.js)
      floorFx: { value: this.rtFloorFxB.texture },
      floorTint: { value: this.rtFloorTint.texture },
      floorRect: { value: this.fxRect }, // (shadow and contact: fitted, see _fitFloorFx)
      glowRect: { value: this.floorRect },
      fxLodBias: { value: 0 }, // (log2 of how much finer than the whole span: keeps blurs by mip level the same size)
      bg: { value: new THREE.Color(0.86, 0.85, 0.83) },
      texel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
      causRect: { value: new THREE.Vector4(-3.2, -3.2, 1 / 6.4, 1 / 6.4) }, // (the caustics' texture: fitted round the jelly)
      causGain: { value: CAUS_GAIN }, // (how bright the caustic light lands)
      penumbra: { value: 0.06 }, // (the key light's softness: its shadow's edge widens this much a metre from what casts it)
      tint: { value: new THREE.Color(1, 0.2, 0.2) },
      refl: { value: null }, // the jelly mirrored in the floor (App's rtRefl)
      res: { value: new THREE.Vector2(1, 1) },
      reflAmount: { value: 0.22 },
      reflLod: { value: 1 }, // (how blurred: the floor's gloss)
      glowFloor: { value: 0 }, // glow mode: how brightly it lights the floor
      glowTex: { value: this.rtGlow.texture },
      pulseCol: { value: Array.from({ length: MAX_PULSES }, () => new THREE.Vector3(1, 0.2, 0.2)) }, // (each ring's colour)
      // (glow mode's rings of light, shared with the jelly)
      pulse: this.frontMat.uniforms.uPulse,
      pulseAmp: this.frontMat.uniforms.uPulseAmp,
      time: this.frontMat.uniforms.uTime,
      floorAlbedo: { value: new THREE.Color(0.8, 0.79, 0.77) }, // (set with the look)
      floorEnv: { value: 0.75 },
      tintLocal: { value: 0 }, // layered jelly: the shadow's fill takes each band's colour
      // (several cubes) the one the panels edit, ringed on the floor: centre
      // x, z, half its side, its turn; its colour and how much the ring
      // shows; seconds since it was picked (a ping goes out)
      // the place's floor pattern (see floorpattern.js)
      pat: { value: 0 },
      patA: { value: new THREE.Vector3(0.1, 0.1, 0.1) },
      patB: { value: new THREE.Vector3(0.9, 0.9, 0.9) },
      patScale: { value: 1 },
      patGlow: { value: 0 },
      patSun: { value: new THREE.Vector2(lightDir.x, lightDir.z).normalize() }, // (toward the key light)
      sel: { value: new THREE.Vector4(0, 0, 0.5, 0) },
      selCol: { value: new THREE.Vector4(1, 1, 1, 0) },
      selPing: { value: 9 },
      // powder on the floor (see Flour), over a square of it: (colour times
      // the amount, the amount) and (sparkle, multi times it); and the key
      // light, for its glints
      flour: { value: null },
      flour2: { value: null },
      flourRect: { value: new THREE.Vector4(-3.2, -3.2, 1 / 6.4, 1 / 6.4) },
      flourSun: { value: lightDir },
    };
    // (the jelly mirrors the floor: it reads the same textures)
    const fx = this.fxUniforms;
    Object.assign(this.frontMat.uniforms, {
      tCaustic: fx.caustic, tFloorFx: fx.floorFx, tFloorTint: fx.floorTint, tGlowMap: fx.glowTex, uFloorRect: fx.floorRect, uGlowRect: fx.glowRect, uFxLodBias: fx.fxLodBias, uCausRect: fx.causRect, uCausGain: fx.causGain, uTint: fx.tint,
      uGlowFloor: fx.glowFloor, uBg: fx.bg, uFloorAlbedo: fx.floorAlbedo, uFloorEnv: fx.floorEnv,
      uPat: fx.pat, uPatA: fx.patA, uPatB: fx.patB, uPatScale: fx.patScale, uPatGlow: fx.patGlow, uPatSun: fx.patSun,
    });
    this.rtBack = null;
    this._v = new THREE.Vector3();
    // the weld's seam textures (and the placeholders they replace)
    this._weldTex = null;
    this._weldEmpty = [this.frontMat.uniforms.uWeldSegs.value, this.frontMat.uniforms.uWeldCells.value];
  }

  setLightDir(d) {
    this.lightDir.copy(d).normalize();
    this.frontMat.uniforms.uLightDir.value.copy(d);
    this.causticMat.uniforms.uLightDir.value.copy(d);
    this.maskMat.uniforms.uLightDir.value.copy(d);
    this.tintMat.uniforms.uLightDir.value.copy(d);
  }

  // flavor: { hex } or { layers: [hex bottom..top] }
  // m: resolved material {depth, opacity, glow, rough, ior, sugar, milk}
  setStyle(flavor, m, size = 1) {
    this.lookVersion = (this.lookVersion || 0) + 1;
    const ref = 0.55 / m.depth;
    const colors = (flavor.layers || [flavor.hex]).map((h) => new THREE.Color(h));
    const abs = colors.map((c) => absorptionFromColor(c, ref));
    const scs = colors.map((c) => {
      const s = c.clone();
      return s.multiplyScalar(1 / Math.max(s.r, s.g, s.b, 1e-3));
    });
    const avgAbs = abs.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / abs.length);
    const avgSc = scs.reduce((a, b) => a.add(b), new THREE.Color(0, 0, 0)).multiplyScalar(1 / scs.length);
    const L = this.layerUniforms;
    if (flavor.layers) {
      L.uLayers.value = flavor.layers.length;
      L.uLayerY0.value = -size / 2;
      L.uLayerSpan.value = size;
      L.uLayerRep.value = Math.max(1, Math.round(flavor.repeat || 1));
      L.uLayerExp.value = biasExp(flavor.bias);
      L.uLayerBlur.value = flavor.blur || 0;
      abs.forEach((a, k) => L.uLayerAbs.value[k].copy(a));
      scs.forEach((c, k) => L.uLayerSc.value[k].set(c.r, c.g, c.b));
    } else L.uLayers.value = 0;
    const F = this.frontMat.uniforms;
    F.uAbsorb.value.copy(avgAbs);
    F.uScatterColor.value.copy(flavor.layers ? avgSc : scs[0]);
    // opacity -> cloudiness; near the top end even thin parts go solid
    const o = Math.min(1, Math.max(0, m.opacity));
    const scatter = 9 * o * o;
    const hazeMin = 0.92 * Math.min(1, Math.max(0, (o - 0.45) / 0.55)) ** 2;
    // colour of light that has crossed ~0.35 units of jelly (tints the shadow)
    const tint = new THREE.Color(0, 0, 0);
    for (const a of abs) tint.r += Math.exp(-a.x * 0.35), tint.g += Math.exp(-a.y * 0.35), tint.b += Math.exp(-a.z * 0.35);
    tint.multiplyScalar(1 / abs.length);
    const cloud = Math.max(m.milk, hazeMin);
    if (cloud) tint.lerp(new THREE.Color(1, 1, 1), 0.35 * cloud).multiplyScalar(1 - 0.35 * cloud);
    this.fxUniforms.tint.value.copy(tint);
    this.fxUniforms.tintLocal.value = flavor.layers ? 1 : 0;
    // healing light: a luminous, lighter version of the jelly colour
    F.uGlowColor.value.copy(avgSc).lerp(new THREE.Color(1, 1, 1), 0.55).multiplyScalar(0.9);
    F.uScatter.value = scatter + (flavor.layers ? 1.6 * (1 - o) : 0);
    F.uHazeMin.value = hazeMin;
    F.uGlow.value = m.glow;
    F.uRoughness.value = m.rough;
    F.uSugar.value = m.sugar;
    F.uMilk.value = m.milk;
    F.uIrid.value = m.irid || 0;
    F.uMetal.value = m.metal || 0;
    F.uOpal.value = m.opal || 0;
    F.uIor.value = m.ior;
    F.uDispersion.value = 0.018 * Math.max(0, m.ior - 1) / 0.36;
  }

  // One cube's look (its slot k: flavour, material m) into its row of the
  // cube-look texture, as setStyle works it out for the whole jelly.
  setCubeLook(k, flavor, m, size = 1) {
    const ref = 0.55 / m.depth;
    // (Rubik: its six colours where layers keep theirs, and a flag)
    const rubik = flavor.id === 'rubik';
    const colors = (rubik ? RUBIK_COLORS : flavor.layers || [flavor.hex]).map((h) => new THREE.Color(h));
    const abs = colors.map((c) => absorptionFromColor(c, ref));
    const scs = colors.map((c) => c.clone().multiplyScalar(1 / Math.max(c.r, c.g, c.b, 1e-3)));
    const avgAbs = abs.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / abs.length);
    const avgSc = scs.reduce((a, b) => a.add(b), new THREE.Color(0, 0, 0)).multiplyScalar(1 / scs.length);
    const many = rubik || !!flavor.layers;
    const sc = many ? avgSc : scs[0];
    const o = Math.min(1, Math.max(0, m.opacity));
    const glowC = avgSc.clone().lerp(new THREE.Color(1, 1, 1), 0.55).multiplyScalar(0.9);
    const D = this.cubeData, r = k * CUBE_TEX_W * 4;
    const put = (x, a, b, c, d) => {
      const i = r + x * 4;
      D[i] = a; D[i + 1] = b; D[i + 2] = c; D[i + 3] = d;
    };
    put(0, avgAbs.x, avgAbs.y, avgAbs.z, 9 * o * o + (many ? 1.6 * (1 - o) : 0));
    put(1, sc.r, sc.g, sc.b, hazeMinOf(o));
    put(2, m.glow, m.rough, m.ior, (0.018 * Math.max(0, m.ior - 1)) / 0.36);
    put(3, m.sugar || 0, m.milk || 0, m.irid || 0, m.metal || 0);
    put(4, m.opal || 0, rubik ? -1 : flavor.layers ? flavor.layers.length : 0, -size / 2, size);
    put(5, Math.max(1, Math.round(flavor.repeat || 1)), biasExp(flavor.bias), flavor.blur || 0, rubik ? flavor.rubik : 0);
    put(6, glowC.r, glowC.g, glowC.b, flavor.layers ? GRAD_SHAPE_INDEX[flavor.shape] || 0 : 0);
    for (let j = 0; j < 10; j++) {
      const a = abs[Math.min(j, abs.length - 1)], c = scs[Math.min(j, scs.length - 1)];
      // (alpha: a Rubik's white sticker is milky, not clear)
      put(7 + j, a.x, a.y, a.z, rubik && j === 0 ? 0.7 : 0);
      put(17 + j, c.r, c.g, c.b, 0);
    }
    // the colour of light that's crossed ~0.35 units of it (its shadow's -
    // see createTintMaterial), and how much its caustics scatter
    const tint = new THREE.Color(0, 0, 0);
    for (const a of abs) tint.r += Math.exp(-a.x * 0.35), tint.g += Math.exp(-a.y * 0.35), tint.b += Math.exp(-a.z * 0.35);
    tint.multiplyScalar(1 / abs.length);
    const cloud = Math.max(m.milk || 0, hazeMinOf(o));
    if (cloud) tint.lerp(new THREE.Color(1, 1, 1), 0.35 * cloud).multiplyScalar(1 - 0.35 * cloud);
    put(27, tint.r, tint.g, tint.b, 9 * o * o + (m.milk || 0) * 3);
    // (how much light gets through it at all, for its shadow and caustics:
    // none through metal - a chrome cube's shadow was pink - and through
    // something milky or opaque little - a sugar cube cast a pink glow)
    // (kept in row 16's alpha: the last layer colour's - free; 30 is the powder's)
    D[r + 16 * 4 + 3] = (1 - Math.min(1, m.metal || 0)) * Math.pow(1 - smoothstep(0.3, 1, o), 1.2);
    put(28, 1 / ref, Math.max(1, Math.round(flavor.tiles || 1)), surfaceOf(m.surface).rough || 0, Math.min(0.45, m.bevelRatio ?? 0.13));
    // its coats and skins: a dusting on the outside, iridescence and metal only
    // on the outside (a film, a foil), sugar all through
    // ...and its surface map (surfaces.js): its kind, how deep (m), its cells
    // across a face and up it (whole repeats: see surfaceFit) - its hollows'
    // shade, how much it scatters, and the cube's rounding (row 28)
    // (cells across a face: as many as the Scale slider asks - a honeycomb's
    // no fewer than three: two big cells to a face can't be hexagons, and
    // its sides came out a jumble of odd shapes)
    const sf = surfaceOf(m.surface), dens = Math.max(sf.relax ? 3 : 0, (sf.density || 1) / (m.surfScale ?? 1)), [nu, nv] = surfaceFit(sf, dens);
    // ...and its edges' trim, baked into the same map (not through holes:
    // those aren't a map) - the map then as deep as the deeper of the two;
    // a smooth one with a trim, its own kind past the surfaces' (TRIM_KIND)
    // (a shape trim - scalloped - is the mesh's own shape, nothing baked)
    const ti = sf.fam === 'holes' || TRIM[m.trim]?.shape ? 0 : TRIM[m.trim]?.index || 0;
    // (its relief: the Depth slider's share of the map's own, zoomed with its
    // scale - finer, shallower, as a pattern zoomed out is - and never much
    // steeper than a quarter of a cell deep: drawn by parallax on the flat of
    // each face, a relief steeper than that fell apart - each face sunk in a
    // rim of its rounded edges, the pattern smeared round them, the finest
    // a noise. Smoothly: the sliders' ordinary range is as it was.)
    // (and none much deeper than 4.5% of the cube: the rounded edges aren't
    // drawn sunk, so deeper still, the faces looked inset however big the cells)
    const want = (sf.depth || 0) * (m.surfDepth ?? 1) * size * Math.pow((sf.density || 1) / dens, 0.7), cap = Math.min((0.25 * size) / dens, 0.045 * size);
    const sfD = sf.fam === 'holes' || !(want > 0) ? want : want / Math.pow(1 + Math.pow(want / cap, 6), 1 / 6);
    const trD = ti ? TRIM_DEPTH * size * (m.trimDepth ?? 1) : 0, depth = Math.max(sfD, trD);
    this._bakeCube(k, sf, size, m.bevelRatio ?? 0.13, dens, false, ti, depth > 0 ? sfD / depth : 1, depth > 0 ? trD / depth : 1, m.trimSize ?? 1);
    put(29, m.dust || 0, m.skin || 0, m.through ? 1 : 0, ti ? Math.max(sf.ao || 0, 0.55) : sf.ao || 0);
    (this._ownCoat ||= [])[k] = (m.dust || 0) > 0 || (m.sugar || 0) > 0;
    const plain = ti && !(sf.kind > 0);
    put(31, plain ? TRIM_KIND : sf.kind, depth, plain ? 1 : nu, plain ? 1 : nv);
    // (a die's pips inked: white in a dark jelly, black in a pale or milky one)
    const lum = colors.reduce((a, c) => a + 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, 0) / colors.length, pale = lum > 0.26 || (lum > 0.1 && (m.milk || 0) > 0.6);
    put(34, pale ? 0.03 : 0.93, pale ? 0.03 : 0.92, pale ? 0.035 : 0.9, sf.ink ? 1 : 0);
    // (a Rubik's stickers as they are: see styles.js rubikPack, CUBE_GLSL rubikAt)
    const rp = rubik ? rubikPack(flavor.state || rubikStateOf({ rubik: flavor.rubik })) : [0, 0, 0, 0, 0, 0, 0];
    put(32, rp[0], rp[1], rp[2], rp[3]);
    put(33, rp[4], rp[5], rp[6], ti);
    this.cubeTex.needsUpdate = true;
    if (flavor.layers && flavor.shape === 'free') {
      // (baked - 32 cubed colours, and the whole grid sent to the GPU, a
      // megabyte - only when its colours or points have changed: every
      // slider dragged and every cube picked re-baked them all)
      const key = JSON.stringify([flavor.layers, flavor.nodes, flavor.blur, flavor.repeat, flavor.bias, flavor.tiles, flavor.k]);
      const baked = this._freeBaked || (this._freeBaked = []);
      if (baked[k] !== key) {
        baked[k] = key;
        bakeFree(flavor, this.freeData.subarray(k * this.freeSlab, (k + 1) * this.freeSlab));
        this.freeTex.needsUpdate = true;
      }
    } else if (flavor.layers) this._gradStrip(k, flavor, abs, scs);
    this.lookVersion = (this.lookVersion || 0) + 1;
  }

  // Every cube's surface map, baked onto it (see surfaces.js SURF_BAKE_GLSL):
  // six layers a cube - a face each, bevel middle to bevel middle - its
  // height at each point, worked out where that point really is on the
  // rounded cube. Baked again only when the cube's map, size, rounding or
  // scale change.
  _makeSurfaceAtlas() {
    const R = 512;
    this.surfRT = new THREE.WebGLArrayRenderTarget(R, R, MAX_CUBES * 6, { format: THREE.RedFormat, type: THREE.HalfFloatType, depthBuffer: false });
    const tex = (this.surfAtlas = this.surfRT.texture);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    const blank = () => {
      const t = new THREE.DataTexture(new Float32Array([-1, -1, -1, -1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
      t.minFilter = t.magFilter = THREE.NearestFilter;
      t.needsUpdate = true;
      return t;
    };
    // (one set of numbers for every pattern's bake)
    this.bakeU = {
      uFace: { value: 0 }, uKind: { value: 0 }, uHS: { value: 0.5 }, uB: { value: 0.1 }, uL: { value: 1 }, uSp: { value: 0.1 },
      uTrim: { value: 0 }, uTrimN: { value: 7 }, uTrimW: { value: 0.07 }, uSfScale: { value: 1 }, uTrimScale: { value: 1 },
      uNN: { value: new THREE.Vector2(4, 4) }, uSites: { value: blank() }, uGrid: { value: blank() }, uSitesW: { value: 1 }, uGridW: { value: 1 },
      // (an ivec3: three takes it as a plain array)
      uGridMin: { value: new THREE.Vector3() }, uGridCell: { value: 1 }, uGridDim: { value: [1, 1, 1] },
    };
    this.bakeMats = [];
    this.bakeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.bakeScene = new THREE.Scene();
    this.bakeScene.add(this.bakeQuad);
    this.bakeCam = new THREE.Camera();
    this._surfKey = new Array(MAX_CUBES).fill('');
    this._surfArgs = [];
    this._surfLater = new Map();
    // (each pattern's bake made ready a while after the start, out of the
    // way - so the first cube with one doesn't stop to build it; behind the
    // splash, if there is one: see App._warmGPU)
    setTimeout(() => this.readyBakes(), 2500);
  }

  // (a pattern's bake: a shader with only its own pattern in it)
  _bakeMat(kind) {
    return (this.bakeMats[kind] ||= new THREE.ShaderMaterial({
      uniforms: this.bakeU,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform int uFace; varying vec2 vUv;
        ${surfaceBakeGLSL(kind)}
        void main() {
          vec2 uv = (vUv - 0.5) * uL;
          vec3 P, n;
          sfUnfoldInv(uFace, uv, P, n);
          // (its pattern, held to its own depth, and its edges' trim)
          float h = 1.0 - (1.0 - sfBake(uKind, uFace, uv)) * uSfScale;
          gl_FragColor = vec4(min(h, 1.0 - (1.0 - sfTrim(uFace, uv, P)) * uTrimScale), 0.0, 0.0, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    }));
  }
  // (all of them: once - a promise, and bakesReady once it's kept)
  readyBakes() {
    return (this._bakesP ||= (async () => {
      const r = this.renderer;
      if (r.compileAsync)
        for (const sf of SURFACES) {
          if (!sf.fam || sf.fam === 'holes' || this.bakeMats[SURFACES.indexOf(sf)]) continue;
          this.bakeQuad.material = this._bakeMat(SURFACES.indexOf(sf));
          try {
            await r.compileAsync(this.bakeScene, this.bakeCam);
          } catch {
            break;
          }
        }
      this.bakesReady = true;
    })());
  }


  // (what slot k's map was baked from, and baked back from that - for a
  // portrait, which borrows a slot and then puts its look back)
  surfaceOfSlot(k) {
    return this._surfArgs?.[k];
  }
  restoreSurface(k, args) {
    if (args) this._bakeCube(k, ...args.slice(0, 4), true);
  }

  // (cube k's map baked onto it: sf its surface, size its size, br its
  // rounding a share of that, dens its cells a face. A new pattern's baked
  // at once; the same one rescaled or rounded off - a slider dragged -
  // when it's been still a moment: see bakeLater)
  _bakeCube(k, sf, size, br, dens, now = false, trim = 0, sfScale = 1, trScale = 1, trSize = 1) {
    if (!this.surfRT) return;
    this._surfArgs[k] = [sf, size, br, dens, now, trim, sfScale, trScale, trSize];
    this._surfLater.delete(k);
    if (!sf || sf.fam === 'holes' || (!sf.fam && !trim)) return;
    const hs = size / 2, b = Math.min(0.45, br) * size, L = size - b * (2 - Math.PI / 2);
    const [nu, nv] = surfaceFit(sf, dens);
    const key = [sf.kind, size.toFixed(4), b.toFixed(5), nu.toFixed(4), nv.toFixed(4), trim, sfScale.toFixed(3), trScale.toFixed(3), trSize.toFixed(3)].join('|');
    const was = this._surfKey[k];
    if (was === key) return;
    if (!now && was.split('|')[0] === String(sf.kind)) {
      this._surfLater.set(k, performance.now());
      return;
    }
    this._surfKey[k] = key;
    const U = this.bakeU;
    U.uKind.value = sf.kind;
    U.uHS.value = hs;
    U.uB.value = Math.max(b, 1e-5);
    U.uL.value = L;
    U.uNN.value.set(nu, nv);
    // (its trim: a whole number of repeats to an edge, about 14 cm each; its
    // band 7.5% of it - both at the trim's Size; its depth a share of the map's)
    U.uTrim.value = trim;
    U.uTrimN.value = Math.max(3, Math.round(size / (0.14 * trSize)));
    U.uTrimW.value = 0.075 * size * Math.sqrt(trSize);
    U.uSfScale.value = sfScale;
    U.uTrimScale.value = trScale;
    if (sf.fam === 'sites') {
      // the sites, spread over its surface - and a grid of them, a cell the
      // spacing a side, up to 8 a cell, for the bake to find the nearest
      const sp = L / nu, S = surfaceSites(hs, b, sp, { relax: !!sf.relax, minD: sf.minD ?? 0.5, seed: sf.kind * 7 + 3 });
      const n = S.length / 4, SW = 128, SH = Math.max(1, Math.ceil(n / SW));
      const sd = new Float32Array(SW * SH * 4);
      sd.set(S);
      const cell = sp, g0 = -hs - sp, G = Math.max(1, Math.ceil((2 * hs + 2 * sp) / cell));
      const GW = 512, cells = G * G * G, GH = Math.max(1, Math.ceil((cells * 2) / GW));
      const gd = new Float32Array(GW * GH * 4).fill(-1), fill = new Uint8Array(cells);
      for (let i = 0; i < n; i++) {
        const cx = Math.min(G - 1, Math.max(0, Math.floor((S[i * 4] - g0) / cell)));
        const cy = Math.min(G - 1, Math.max(0, Math.floor((S[i * 4 + 1] - g0) / cell)));
        const cz = Math.min(G - 1, Math.max(0, Math.floor((S[i * 4 + 2] - g0) / cell)));
        const c = (cz * G + cy) * G + cx;
        if (fill[c] >= 8) continue;
        gd[c * 8 + fill[c]++] = i;
      }
      const put = (u, data, w, h) => {
        if (u.value && u.value.image && u.value.image.width === w && u.value.image.height === h) {
          u.value.image.data.set(data);
          u.value.needsUpdate = true;
          return;
        }
        u.value?.dispose?.();
        const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
        t.minFilter = t.magFilter = THREE.NearestFilter;
        t.needsUpdate = true;
        u.value = t;
      };
      put(U.uSites, sd, SW, SH);
      put(U.uGrid, gd, GW, GH);
      U.uSitesW.value = SW;
      U.uGridW.value = GW;
      U.uGridMin.value.set(g0, g0, g0);
      U.uGridCell.value = cell;
      U.uGridDim.value = [G, G, G];
      U.uSp.value = sp;
    }
    this.bakeQuad.material = this._bakeMat(sf.kind);
    const r = this.renderer, prev = r.getRenderTarget();
    for (let f = 0; f < 6; f++) {
      U.uFace.value = f;
      r.setRenderTarget(this.surfRT, k * 6 + f);
      r.render(this.bakeScene, this.bakeCam);
    }
    r.setRenderTarget(prev);
  }
  // (the ones put off: baked once they've been still a moment - each frame)
  bakeLater() {
    if (!this._surfLater?.size) return;
    const t = performance.now();
    for (const [k, t0] of this._surfLater) {
      if (t - t0 <= 140) continue;
      const [sf, size, br, dens, , ...tr] = this._surfArgs[k];
      this._bakeCube(k, sf, size, br, dens, true, ...tr);
    }
  }

  // A layered cube's gradient as its strip: absorption (its first row) and
  // the colour of the light inside (its second) at GRAD_N steps along its
  // shape - the stops, blend, repeat and bias worked in (styles.js gradAt).
  _gradStrip(k, flavor, abs, scs) {
    const D = this.gradData, N = GRAD_N, seq = gradSequence(flavor), h = THREE.DataUtils.toHalfFloat;
    const r0 = k * 2 * N * 4, r1 = r0 + N * 4;
    for (let j = 0; j < N; j++) {
      const { a, b, s } = gradAt(flavor, j / (N - 1), seq), t = 1 - s, i = j * 4;
      const A = abs[a], B = abs[b], P = scs[a], Q = scs[b];
      D[r0 + i] = h(Math.min(6e4, A.x * t + B.x * s));
      D[r0 + i + 1] = h(Math.min(6e4, A.y * t + B.y * s));
      D[r0 + i + 2] = h(Math.min(6e4, A.z * t + B.z * s));
      D[r0 + i + 3] = h(1);
      D[r1 + i] = h(P.r * t + Q.r * s);
      D[r1 + i + 1] = h(P.g * t + Q.g * s);
      D[r1 + i + 2] = h(P.b * t + Q.b * s);
      D[r1 + i + 3] = h(1);
    }
    this.gradTex.needsUpdate = true;
  }

  _setWeldSeams(near) {
    const U = this.frontMat.uniforms;
    if (this._weldTex) for (const t of this._weldTex) t.dispose();
    this._weldTex = null;
    if (!near) {
      [U.uWeldSegs.value, U.uWeldCells.value] = this._weldEmpty;
      U.uWeldGridN.value = 0;
      return;
    }
    const tex = (data, h) => {
      const t = new THREE.DataTexture(data, 1024, h, THREE.RGBAFormat, THREE.FloatType);
      t.minFilter = t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      return t;
    };
    this._weldTex = [tex(near.segs, near.segH), tex(near.cells, near.cellH)];
    [U.uWeldSegs.value, U.uWeldCells.value] = this._weldTex;
    U.uWeldGrid.value.set(near.origin, near.origin, near.origin, near.invC);
    U.uWeldGridN.value = near.n;
    U.uWeldUnit.value = near.unit;
  }

  setSize(w, h) {
    this.rtCover?.dispose();
    this.rtCover = new THREE.WebGLRenderTarget(Math.max(1, w >> 1), Math.max(1, h >> 1), { depthBuffer: true });
    this.coverU.tCover.value = this.rtCover.texture;
    this.coverU.uCoverInv.value.set(1 / w, 1 / h);
    if (this.rtBack) this.rtBack.dispose();
    this.rtBack = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true });
    this.rtBackRest?.dispose();
    this.rtBackRest = null;
    this.frontMat.uniforms.resolution.value.set(w, h);
  }

  syncTopology(sb) {
    if (sb.topoVersion === this.topoVersion && sb.restVersion === this._restVersion) return false;
    this.topoVersion = sb.topoVersion;
    this._restVersion = sb.restVersion;
    for (const m of [this.allMesh, ...this.layerMeshes]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.allMesh = null;
    this.layerMeshes = [];
    if (this.mirror) this.reflScene.remove(this.mirror);
    this.mirror = null;
    const nB = sb.rCount;
    const rIndex = sb.rIndex, rSim = sb.rSim;
    const nTri = rIndex.length / 3;
    // --- two levels of subdivision (16 triangles per simulated one). The
    // new points are Phong-tessellated from the moving surface; on the
    // cube's original outside each is also pushed out along its normal by
    // a fixed amount, measured at rest, that puts it exactly on the true
    // rounded-box shape there (the simulation's grid only gets ~2 segments
    // round a bevel).
    const L1 = splitEdges(rIndex, rSim, nB);
    const nL1 = nB + L1.mids.length / 3;
    const geo1 = new Int32Array(nL1);
    for (let r = 0; r < nB; r++) geo1[r] = rSim[r];
    for (let j = 0; j < L1.midGeo.length; j++) geo1[nB + j] = sb.nV + L1.midGeo[j];
    // the first level at rest, against the true shape
    const maxN = nL1 + L1.index.length; // (at most one more vertex per level-1 edge side)
    const rest = new Float32Array(maxN * 3);
    const restN = new Float32Array(maxN * 3);
    // (each cube's rest shape in its own frame: the offset that keeps them
    // apart in rest space taken off)
    for (let r = 0; r < nB; r++) {
      const i = rSim[r] * 3;
      rest[r * 3] = sb.X[i] - sb.vCube[rSim[r]] * REST_STEP; rest[r * 3 + 1] = sb.X[i + 1]; rest[r * 3 + 2] = sb.X[i + 2];
    }
    vertexNormals(rIndex, rest, restN, nB);
    // (each cube its own rounding; each render vertex knows its cube - the
    // new points their edge's)
    const shapes = Array.from(sb.cBevel, (b, k) => ({ a: sb.cSize[k] / 2 - b, r: b, lobe: sb.lobeOf(k) }));
    const cube = new Float32Array(maxN);
    for (let r = 0; r < nB; r++) cube[r] = sb.vCube[rSim[r]];
    for (let m = 0, k = nB; m < L1.mids.length; m += 3, k++) cube[k] = cube[L1.mids[m]];
    this.disp1 = new Float32Array(L1.mids.length / 3);
    this.disp31 = new Float32Array(L1.mids.length);
    const lobed = shapes.some((S) => S.lobe);
    this.twin1 = lobed ? twins(L1.mids, L1.midGeo, nB) : null;
    tessellate(rest, restN, null, L1.mids, nB, this.disp1);
    // (which render points are on a scalloped cube's skin: the new ones put there)
    const onLobe = lobed ? new Uint8Array(maxN) : null;
    if (lobed) snapToLobes(rest, restN, L1.mids, nB, this.disp31, shapes, cube, onLobe);
    snapToShape(rest, restN, L1.mids, nB, this.disp1, shapes.map((S) => (S.lobe ? { a: 0, r: 0 } : S)), cube);
    // the second level only where the surface curves (bevels, corners): flat
    // faces - and the cut faces a burst leaves - gain nothing from it
    const t1 = L1.index.length / 3;
    const refine = new Uint8Array(t1);
    for (let t = 0; t < t1; t++) {
      const a = L1.index[t * 3] * 3, b = L1.index[t * 3 + 1] * 3, c = L1.index[t * 3 + 2] * 3;
      const ab = restN[a] * restN[b] + restN[a + 1] * restN[b + 1] + restN[a + 2] * restN[b + 2];
      const bc = restN[b] * restN[c] + restN[b + 1] * restN[c + 1] + restN[b + 2] * restN[c + 2];
      const ca = restN[c] * restN[a] + restN[c + 1] * restN[a + 1] + restN[c + 2] * restN[a + 2];
      refine[t] = Math.min(ab, bc, ca) < 0.996 ? 1 : 0; // (> ~5 degrees between normals)
      // (a scalloped cube's, all: its lobes curve however its mesh lies)
      if (lobed && (shapes[cube[L1.index[t * 3]]]?.lobe || shapes[cube[L1.index[t * 3 + 1]]]?.lobe || shapes[cube[L1.index[t * 3 + 2]]]?.lobe)) refine[t] = 1;
    }
    const L2 = splitEdges(L1.index, geo1, nL1, refine);
    this.twin2 = lobed ? twins(L2.mids, L2.midGeo, nL1) : null;
    const n = nL1 + L2.mids.length / 3;
    this.mids1 = L1.mids;
    this.mids2 = L2.mids;
    this.nBase = nB;
    this.nL1 = nL1;
    this.nRender = n;
    this.pos = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    this.data = new Float32Array(n * 4);
    this.coat = new Float32Array(n * 4); // (the powder on it: see SoftBody.coat)
    this.coatM = new Float32Array(n);
    this.disp2 = new Float32Array(L2.mids.length / 3);
    this.disp32 = new Float32Array(L2.mids.length);
    for (let m = 0, k = nL1; m < L2.mids.length; m += 3, k++) cube[k] = cube[L2.mids[m]];
    tessellate(rest, restN, null, L2.mids, nL1, this.disp2);
    if (lobed) snapToLobes(rest, restN, L2.mids, nL1, this.disp32, shapes, cube, onLobe);
    snapToShape(rest, restN, L2.mids, nL1, this.disp2, shapes.map((S) => (S.lobe ? { a: 0, r: 0 } : S)), cube);
    const index = L2.index;
    // (a scalloped cube's light off its own fine surface, not its coarse
    // mesh's: the render vertices of such cubes, and the triangles at them -
    // see _lobeNormals)
    this._lobeTri = null;
    if (lobed) {
      const isL = (r) => !!shapes[cube[r]]?.lobe, tris = [];
      for (let t = 0; t < index.length; t += 3) if (isL(index[t]) || isL(index[t + 1]) || isL(index[t + 2])) tris.push(t);
      const vs = [];
      for (let r = 0; r < n; r++) if (isL(r)) vs.push(r);
      this._lobeTri = Int32Array.from(tris);
      this._lobeV = Int32Array.from(vs);
      this._lobeIndex = index;
      // (and its skin's true way out at rest - the shape's own: mesh.js
      // shapeNormal - beside its smooth normal there, carried down from its
      // coarse mesh: each frame the one turned just as the other has. Off its
      // skin - a cut face - or where the two are far apart - a cut's rim,
      // seen from the cut - its fine triangles' alone)
      this._lobeAcc = new Float32Array(n * 3);
      const F = (this._lobeTrue = new Float32Array(vs.length * 6)), nt = [0, 0, 0];
      for (let j = 0; j < vs.length; j++) {
        const r = vs[j], o = r * 3, S = shapes[cube[r]], hf = S.a + S.r;
        // (a face's flat middle: its fine triangles' are true already)
        if (lobeFlat(rest[o], rest[o + 1], rest[o + 2], hf, S.r)) continue;
        if (!onLobe[r] && Math.abs(shapeSDF(rest[o], rest[o + 1], rest[o + 2], hf, S.r, S.lobe)) > 2e-3 * hf) continue;
        shapeNormal(rest[o], rest[o + 1], rest[o + 2], hf, S.r, S.lobe, nt);
        const ax = restN[o], ay = restN[o + 1], az = restN[o + 2];
        if (ax * nt[0] + ay * nt[1] + az * nt[2] < 0.3) continue;
        F[j * 6] = ax; F[j * 6 + 1] = ay; F[j * 6 + 2] = az;
        F[j * 6 + 3] = nt[0]; F[j * 6 + 4] = nt[1]; F[j * 6 + 5] = nt[2];
      }
    }
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aNrm = new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.BufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage);
    this.aCoat = new THREE.BufferAttribute(this.coat, 4).setUsage(THREE.DynamicDrawUsage);
    this.aCoatM = new THREE.BufferAttribute(this.coatM, 1).setUsage(THREE.DynamicDrawUsage);
    this.aRest = new THREE.BufferAttribute(rest.slice(0, n * 3), 3);
    this.aCube = new THREE.BufferAttribute(cube.slice(0, n), 1);
    // distance from the just-healed seams (see Healer._fuse, weldFieldJob)
    const weld = new Float32Array(n).fill(99);
    if (sb.weld && sb.weld.topo === sb.topoVersion) {
      const d = sb.weld.dist;
      for (let r = 0; r < nB; r++) weld[r] = d[rSim[r]];
      // the edge midpoints measure for themselves (a seam line often runs
      // between two vertices; averaging would blur it out)
      for (const [mids, first] of [[this.mids1, nB], [this.mids2, nL1]]) {
        for (let m = 0, k = first; m < mids.length; m += 3, k++) {
          const wa = weld[mids[m]], wb = weld[mids[m + 1]];
          weld[k] = Math.min(wa, wb) < 0.12 ? sb.weld.at(rest[k * 3], rest[k * 3 + 1], rest[k * 3 + 2]) : (wa + wb) * 0.5;
        }
      }
    }
    this.aWeld = new THREE.BufferAttribute(weld, 1);
    // and the seams themselves, for exact distances close to them per pixel
    this._setWeldSeams(sb.weld && sb.weld.topo === sb.topoVersion ? sb.weld.near : null);
    const geom = (idx) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', this.aPos);
      g.setAttribute('normal', this.aNrm);
      g.setAttribute('aData', this.aData);
      g.setAttribute('aCoat', this.aCoat);
      g.setAttribute('aCoatM', this.aCoatM);
      g.setAttribute('aRest', this.aRest);
      g.setAttribute('aWeld', this.aWeld);
      g.setAttribute('aCube', this.aCube);
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      return g;
    };
    // each piece's run of the final triangles (index sorted by piece: a
    // base triangle -> its level-1 ones, 4 each -> its final ones)
    const NP = sb.pieceRanges.length;
    this.pieceIdx = new Int32Array(NP * 2);
    sb.pieceRanges.forEach((rg, k) => {
      this.pieceIdx[k * 2] = L2.start[(rg.start / 3) * 4];
      this.pieceIdx[k * 2 + 1] = L2.start[((rg.start + rg.count) / 3) * 4];
    });
    const full = index.slice(0, this.pieceIdx[NP * 2 - 1] || 0);
    this.fullIndex = full;
    const all = geom(full);
    this.allMesh = new THREE.Mesh(all, this.frontMat);
    this.allMesh.frustumCulled = false;
    this.scene.add(this.allMesh);
    for (let L = 0; L < this.maxLayers; L++) {
      const m = new THREE.Mesh(geom(new full.constructor(full.length)), this.frontMat);
      m.frustumCulled = false;
      m.visible = false;
      this.scene.add(m);
      this.layerMeshes.push(m);
    }
    this.layerOf = new Int8Array(NP).fill(-1);
    this.layerCount = new Int32Array(this.maxLayers);
    this.mirror = new THREE.Mesh(all, this.reflectMat);
    this.mirror.frustumCulled = false;
    this.mirror.scale.y = -1;
    this.reflScene.add(this.mirror);
    return true;
  }

  // The pieces' render vertices (positions, normals, temperature and glow),
  // subdivided twice, up to the GPU - only when they've changed: a jelly at
  // rest sent every frame was ~2 MB a frame, a flood set into a sheet 6 MB
  // (the GPU choked on it). Thawing alone - temperatures creeping, nothing
  // moving - goes 5 times a second, and only its temperatures.
  update(sb) {
    this.bakeLater();
    const topo = this.syncTopology(sb);
    const n = sb.nV, x = sb.x, temp = sb.temp, glow = sb.glow, dust = sb.dust, coat = sb.coat;
    let ps = 0, ts = 0, gs = 0, ds = 0, cold = 0;
    for (let i = 0; i < n; i++) {
      const w = 1 + (i & 7) * 0.37, o = i * 3;
      ps += (x[o] + x[o + 1] * 1.3 + x[o + 2] * 1.7) * w;
      ts += temp[i] * w;
      if (temp[i] < cold) cold = temp[i];
      ds += (dust[i] + coat[i * 5] * 0.71 + coat[i * 5 + 1] * 0.37 + coat[i * 5 + 2] * 0.23 + coat[i * 5 + 3] * 0.13 + coat[i * 5 + 4] * 0.07) * w;
      gs += glow[i];
    }
    // (a coat anywhere - flour, a cube's own dusting or sugar, frost: the
    // skin's coverage wanted, see renderCover)
    let own = false;
    for (const pc of sb.pieces) if (this._ownCoat?.[pc.cube]) own = true;
    this.coverWanted = ds > 0 || cold < -0.05 || own;
    const fill = sb.fill && sb.fill.topo === sb.topoVersion;
    const moved = topo || fill || ps !== this._ps;
    const now = performance.now();
    const warmed = ts !== this._ts && now - (this._dataAt || 0) > 200;
    // (flour landing on it: as soon as it's there)
    const floured = ds !== this._ds;
    if (!moved && !warmed && !floured && !(gs > 0 || this._gs > 0)) return;
    this._ps = ps;
    this._ts = ts;
    this._gs = gs;
    this._ds = ds;
    this._dataAt = now;
    const pos = this.pos, nrm = this.nrm, data = this.data;
    sb.writeRender(pos, nrm, data, this.coat, this.coatM);
    if (fill) this._fill(sb, sb.fill);
    tessellate(pos, nrm, data, this.mids1, this.nBase, this.disp1, this.coat, this.coatM, this._lobeTri ? this.disp31 : null, this._lobeTri ? this.twin1 : null);
    tessellate(pos, nrm, data, this.mids2, this.nL1, this.disp2, this.coat, this.coatM, this._lobeTri ? this.disp32 : null, this._lobeTri ? this.twin2 : null);
    if (this._lobeTri) this._lobeNormals(pos, nrm);
    if (moved) {
      this.aPos.needsUpdate = true;
      this.aNrm.needsUpdate = true;
    }
    this.aData.needsUpdate = true;
    if (floured || this._coatShown) {
      this.aCoat.needsUpdate = true;
      this.aCoatM.needsUpdate = true;
    }
    this._coatShown = ds > 0;
  }

  // The heal's liquid fill: what was missing rises from its holes' walls
  // to where it belongs, like a level rising at one speed everywhere (a
  // part twice as far from the wall takes twice as long), easing in at the
  // end. The surface's normals follow the moving shape.
  // The heal's fill (see Healer._fuse): what was missing filled like a
  // liquid poured into its holes - a level rising from their bottom to
  // their top, flat but for a ripple. Above it, each vertex is on its hole's
  // wall (the hole as it was) - lifted onto the level where the wall's under
  // it; past it, back where it belongs (a band of a few cm between).
  _fill(sb, F) {
    const pos = this.pos, nrm = this.nrm, rSim = sb.rSim, nB = this.nBase, X = sb.X;
    const u = Math.min(1, F.t / Math.max(1e-3, F.dur)), e = u * u * (3 - 2 * u);
    const lv = F.ylo + (F.yhi - F.ylo) * e, amp = 0.005 * F.size * (1 - u), band = 0.035 * F.size, tt = F.t;
    let moved = false;
    for (let r = 0; r < nB; r++) {
      const i = rSim[r];
      if (F.d[i] < 0) continue;
      const Y = X[i * 3 + 1], L = lv + amp * Math.sin(X[i * 3] * 11 + tt * 7) * Math.sin(X[i * 3 + 2] * 9 - tt * 6);
      // (how far it's still to go: 1 at its wall, 0 home)
      const q = Math.min(1, Math.max(0, (Y + band - L) / (2 * band))), k = q * q * (3 - 2 * q);
      if (k <= 0) continue;
      const o = r * 3;
      pos[o] += F.off[i * 3] * k;
      pos[o + 1] += Math.max(F.off[i * 3 + 1], L - Y) * k;
      pos[o + 2] += F.off[i * 3 + 2] * k;
      moved = true;
    }
    if (!moved) return;
    nrm.fill(0, 0, nB * 3);
    const ix = sb.rIndex;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const q of [a, b, c]) {
        nrm[q] += nx; nrm[q + 1] += ny; nrm[q + 2] += nz;
      }
    }
    for (let r = 0; r < nB; r++) {
      const o = r * 3, l = Math.hypot(nrm[o], nrm[o + 1], nrm[o + 2]) || 1;
      nrm[o] /= l; nrm[o + 1] /= l; nrm[o + 2] /= l;
    }
  }

  // A scalloped cube's normals: its coarse mesh's, carried down, lit its
  // lobes in facets - its skin's true ones (see build), turned as its smooth
  // normal's turned from how it lay at rest; elsewhere its fine triangles'
  _lobeNormals(pos, nrm) {
    const V = this._lobeV, F = this._lobeTrue, acc = this._lobeAcc;
    this._fineNormals(pos, acc);
    for (let j = 0; j < V.length; j++) {
      const o = V[j] * 3, k = j * 6, ax = F[k], ay = F[k + 1], az = F[k + 2];
      const bx = nrm[o], by = nrm[o + 1], bz = nrm[o + 2], c = ax * bx + ay * by + az * bz;
      if (!(ax || ay || az) || !(c > -0.5)) {
        const l = Math.sqrt(acc[o] * acc[o] + acc[o + 1] * acc[o + 1] + acc[o + 2] * acc[o + 2]);
        if (l > 1e-12) (nrm[o] = acc[o] / l), (nrm[o + 1] = acc[o + 1] / l), (nrm[o + 2] = acc[o + 2] / l);
        continue;
      }
      // (the turn from a to b - w = a x b - on the true one, v)
      const wx = ay * bz - az * by, wy = az * bx - ax * bz, wz = ax * by - ay * bx;
      const vx = F[k + 3], vy = F[k + 4], vz = F[k + 5];
      const ux = wy * vz - wz * vy, uy = wz * vx - wx * vz, uz = wx * vy - wy * vx;
      const g = 1 / (1 + c);
      const nx = vx + ux + (wy * uz - wz * uy) * g, ny = vy + uy + (wz * ux - wx * uz) * g, nz = vz + uz + (wx * uy - wy * ux) * g;
      const m = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nrm[o] = nx / m; nrm[o + 1] = ny / m; nrm[o + 2] = nz / m;
    }
  }
  // (the fine triangles' area-weighted normals at a scalloped cube's
  // vertices, of positions P, into acc: not normalized)
  _fineNormals(P, acc) {
    const T = this._lobeTri, I = this._lobeIndex, V = this._lobeV;
    for (const r of V) acc[r * 3] = acc[r * 3 + 1] = acc[r * 3 + 2] = 0;
    for (let q = 0; q < T.length; q++) {
      const t = T[q], a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      acc[a] += nx; acc[a + 1] += ny; acc[a + 2] += nz;
      acc[b] += nx; acc[b + 1] += ny; acc[b + 2] += nz;
      acc[c] += nx; acc[c + 1] += ny; acc[c + 2] += nz;
    }
  }

  // glow mode: how brightly it shines (0 off .. 1)
  setEmit(v) {
    this.frontMat.uniforms.uEmit.value = v;
    this.reflectMat.uniforms.uEmit.value = v;
  }

  // a ring of light racing out through it from (x, y, z), starting at time t
  // (glow mode); it takes the slot that's been running longest
  pulse(x, y, z, amp, t, col) {
    const P = this.frontMat.uniforms.uPulse.value, A = this.frontMat.uniforms.uPulseAmp.value;
    const C = this.fxUniforms.pulseCol.value;
    let k = 0;
    for (let i = 0; i < P.length; i++) {
      // (one just started close by: make that one stronger instead)
      if (t - P[i].w < 0.12 && (P[i].x - x) ** 2 + (P[i].y - y) ** 2 + (P[i].z - z) ** 2 < 0.04) {
        A[i] = Math.min(1.5, Math.max(A[i], amp) + 0.25 * amp);
        return;
      }
      if (P[i].w < P[k].w) k = i;
    }
    P[k].set(x, y, z, t);
    A[k] = amp;
    if (col) C[k].set(col.r, col.g, col.b);
  }

  // The jelly mirrored in the floor, into rt (the floor samples it).
  renderReflection(camera, rt) {
    const r = this.renderer;
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(this.reflScene, camera);
    r.setClearColor(prevClear, prevAlpha);
  }

  // The key light's view of the jelly, framed to fit the pieces.
  _fitLightView(sb) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const pc of sb.pieces) {
      let b = pc.bbox;
      if (!b) continue;
      // (not stepped yet - the warm-up's render, before the drop: from its
      // vertices, so the caustics' shaders compile then and not mid-drop)
      if (!(b[3] > b[0])) {
        b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (const i of pc.verts) {
          for (let c = 0; c < 3; c++) {
            b[c] = Math.min(b[c], sb.x[i * 3 + c]);
            b[c + 3] = Math.max(b[c + 3], sb.x[i * 3 + c]);
          }
        }
      }
      x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); z0 = Math.min(z0, b[2]);
      x1 = Math.max(x1, b[3]); y1 = Math.max(y1, b[4]); z1 = Math.max(z1, b[5]);
    }
    if (!(x1 > x0)) return false;
    const cam = this.lightCam, L = this.lightDir, c = this.lightOrigin.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    cam.position.copy(c).addScaledVector(L, 12);
    cam.up.set(0, Math.abs(L.y) > 0.98 ? 0 : 1, Math.abs(L.y) > 0.98 ? 1 : 0);
    cam.lookAt(c);
    cam.updateMatrixWorld();
    let u0 = Infinity, v0 = Infinity, w0 = Infinity, u1 = -Infinity, v1 = -Infinity, w1 = -Infinity;
    const p = this._corner;
    for (let k = 0; k < 8; k++) {
      p.set(k & 1 ? x1 : x0, k & 2 ? y1 : y0, k & 4 ? z1 : z0).applyMatrix4(cam.matrixWorldInverse);
      u0 = Math.min(u0, p.x); u1 = Math.max(u1, p.x);
      v0 = Math.min(v0, p.y); v1 = Math.max(v1, p.y);
      w0 = Math.min(w0, p.z); w1 = Math.max(w1, p.z);
    }
    const m = 0.03;
    cam.left = u0 - m; cam.right = u1 + m; cam.bottom = v0 - m; cam.top = v1 + m;
    cam.near = Math.max(0.01, -w1 - 0.5); cam.far = -w0 + 0.5;
    cam.updateProjectionMatrix();
    this.causticMat.uniforms.uLightVP.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.causticMat.uniforms.uLightInvVP.value.copy(this.causticMat.uniforms.uLightVP.value).invert();
    this.causticMat.uniforms.uOrigin.value.copy(c);
    // the caustics' texture: the pieces' footprint and their straight
    // shadow, squared up (where light bent through them can land) - ~3 mm a
    // texel for one cube, so a cell of focused light still covers a texel
    let fx0 = x0, fz0 = z0, fx1 = x1, fz1 = z1;
    const kx = -L.x / L.y, kz = -L.z / L.y;
    for (const yy of [y0, y1]) {
      fx0 = Math.min(fx0, x0 + kx * yy, x1 + kx * yy); fx1 = Math.max(fx1, x0 + kx * yy, x1 + kx * yy);
      fz0 = Math.min(fz0, z0 + kz * yy, z1 + kz * yy); fz1 = Math.max(fz1, z0 + kz * yy, z1 + kz * yy);
    }
    const size = Math.min(6.4, Math.max(1, fx1 - fx0, fz1 - fz0) + 0.4);
    const cx = (fx0 + fx1) / 2, cz = (fz0 + fz1) / 2;
    const CR = this.fxUniforms.causRect.value;
    CR.set(cx - size / 2, cz - size / 2, 1 / size, 1 / size);
    this.causticMat.uniforms.uCausRect.value.copy(CR);
    return true;
  }

  // The jelly's shadow-and-contact map, framed round the pieces, their
  // shadow along the key light and room for the floor's widest blur taps
  // (~40 cm). The floor's tap offsets and the jelly's blur levels are
  // rescaled so the blurs keep their size in the world.
  _fitFloorFx(sb) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    if (sb) {
      for (const pc of sb.pieces) {
        const b = pc.bbox;
        if (!b || !(b[3] > b[0])) continue;
        x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); z0 = Math.min(z0, b[2]);
        x1 = Math.max(x1, b[3]); y1 = Math.max(y1, b[4]); z1 = Math.max(z1, b[5]);
      }
    }
    let S = FLOOR_SPAN, cx = 0, cz = 0;
    if (x1 > x0) {
      const L = this.lightDir, kx = -L.x / L.y, kz = -L.z / L.y;
      let fx0 = x0, fz0 = z0, fx1 = x1, fz1 = z1;
      for (const yy of [Math.max(0, y0), Math.max(0, y1)]) {
        fx0 = Math.min(fx0, x0 + kx * yy, x1 + kx * yy); fx1 = Math.max(fx1, x0 + kx * yy, x1 + kx * yy);
        fz0 = Math.min(fz0, z0 + kz * yy, z1 + kz * yy); fz1 = Math.max(fz1, z0 + kz * yy, z1 + kz * yy);
      }
      // (in steps, so a moving piece doesn't make the texels crawl)
      S = Math.min(FLOOR_SPAN, Math.max(1.6, Math.ceil((Math.max(fx1 - fx0, fz1 - fz0) + 1.1) / 0.4) * 0.4));
      const g = S / 64;
      cx = Math.round((fx0 + fx1) / 2 / g) * g;
      cz = Math.round((fz0 + fz1) / 2 / g) * g;
    }
    this.fxRect.set(cx - S / 2, cz - S / 2, 1 / S, 1 / S);
    const k = FLOOR_SPAN / 512 / S;
    this.fxUniforms.texel.value.set(k, k);
    this.fxUniforms.fxLodBias.value = Math.log2(FLOOR_SPAN / S);
  }

  renderFloorFx(sb) {
    const r = this.renderer;
    this.fxUniforms.causGain.value = CAUS_GAIN * this.causticLevel;
    // (nothing changed since last time - the jelly still, the same looks,
    // the same light - and none of this changes with the camera: all of it
    // as it was; only glow mode's light pool again, which pulses. A cube at
    // rest cost the light's three views, the caustics and their blurs and
    // the shadow's maps, every frame, for nothing.)
    // (Moving, its caustics are drawn without the multisampling that
    // smooths their finest lines - half what they cost, and never still long
    // enough to see it; settled, once more with it.)
    const L = this.lightDir, moving = this.forceMoving ?? (!!sb && sb.pieces.some((p) => !p.asleep));
    const sig = sb ? `${sb.topoVersion}|${sb.nV}|${this._ps}|${this._ts}|${this._ds}|${this.lookVersion}|${L.x},${L.y},${L.z}|${Math.round(this.causticLevel * 200)}|${this.multiCube}|${this.disperse}|${sb.fill ? performance.now() : 0}|${moving}|${this.skipCaustics}|${this.causticLow}` : '';
    if (sig && sig === this._fxSig) {
      this._renderGlowMap();
      return;
    }
    this._fxSig = sig;
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    // caustics: the light's view of the jelly, then its grid of rays (the
    // light's view is the cubes' shadows on each other too - faded out,
    // only that)
    const caus = this.causticLevel > 0.01 && !this.skipCaustics;
    const lit = sb && this.allMesh && (caus || this.multiCube) && this._fitLightView(sb);
    if (lit) {
      for (const { rt, mat } of this.lightView) {
        mat.uniforms.uOrigin.value.copy(this.lightOrigin);
        r.setRenderTarget(rt);
        r.clear(true, true, false);
        this.scene.overrideMaterial = mat;
        r.render(this.scene, this.lightCam);
      }
      this.scene.overrideMaterial = null;
    }
    // (several cubes: the jelly looks up the light's view for their shadows on each other)
    const F = this.frontMat.uniforms;
    F.uCubeShadow.value = lit && this.multiCube ? 1 : 0;
    if (lit) {
      F.uLightVP.value.multiplyMatrices(this.lightCam.projectionMatrix, this.lightCam.matrixWorldInverse);
      F.uLightOrigin.value.copy(this.lightOrigin);
    }
    // (heavy going - see causticLow: settled too, the light half size, once,
    // no colours apart: its one sharp drawing of a cube shot full of holes,
    // all its stretched cells four times over and three colours each, was
    // eight seconds of the GPU's, the moment it fell asleep)
    const low = this.causticLow, rtC = low ? this.rtCausticMovingLow : moving ? this.rtCausticMoving : this.rtCaustic;
    this.fxUniforms.causThrow.value = rtC.textures[1];
    r.setRenderTarget(rtC);
    r.clear(true, false, false);
    if (lit && caus) {
      const ch = this.causticMat.uniforms.uChannel;
      if (this.disperse && !low) {
        const auto = r.autoClear;
        r.autoClear = false;
        for (let c = 0; c < 3; c++) {
          ch.value = c;
          r.render(this.gridScene, this.fxCam);
        }
        r.autoClear = auto;
      } else {
        ch.value = -1;
        r.render(this.gridScene, this.fxCam);
      }
    }
    // (blurred: ~3 mm sigma in the world, 2 steps of 1.5 mm; nothing there, nothing to blur)
    const cst = 0.0015 * this.fxUniforms.causRect.value.z;
    this.blurMat.uniforms.tSrc.value = rtC.texture;
    this.blurMat.uniforms.uStep.value.set(cst, 0);
    r.setRenderTarget(this.rtCausticT);
    if (lit && caus) r.render(this.blurScene, this.fxCam);
    else r.clear(true, false, false);
    this.blurMat.uniforms.tSrc.value = this.rtCausticT.texture;
    this.blurMat.uniforms.uStep.value.set(0, cst);
    r.setRenderTarget(this.rtCausticB);
    if (lit && caus) r.render(this.blurScene, this.fxCam);
    else r.clear(true, false, false);
    this._fitFloorFx(sb);
    r.setRenderTarget(this.rtFloorFx);
    r.clear(true, false, false);
    const auto = r.autoClear;
    r.autoClear = false;
    this.scene.overrideMaterial = this.maskMat;
    r.render(this.scene, this.fxCam);
    this.scene.overrideMaterial = this.heightMat;
    r.render(this.scene, this.fxCam);
    r.setRenderTarget(this.rtFloorTint);
    r.clear(true, false, false);
    this.scene.overrideMaterial = this.tintMat;
    r.render(this.scene, this.fxCam);
    this.scene.overrideMaterial = null;
    // blurred, ~1.2 cm sigma in the world (2 steps of 0.6 cm)
    const st = (0.006 * this.fxRect.z) || 1 / 512;
    this.blurMat.uniforms.tSrc.value = this.rtFloorFx.texture;
    this.blurMat.uniforms.uStep.value.set(st, 0);
    r.setRenderTarget(this.rtFloorFxT);
    r.render(this.blurScene, this.fxCam);
    this.blurMat.uniforms.tSrc.value = this.rtFloorFxT.texture;
    this.blurMat.uniforms.uStep.value.set(0, st);
    r.setRenderTarget(this.rtFloorFxB);
    r.render(this.blurScene, this.fxCam);
    r.autoClear = auto;
    this.scene.overrideMaterial = null;
    r.setClearColor(prevClear, prevAlpha);
    this._renderGlowMap();
  }

  // (glow mode: the light its parts cast on the floor, each its own colour)
  _renderGlowMap() {
    if (!(this.fxUniforms.glowFloor.value > 0)) return;
    const r = this.renderer, prevClear = r.getClearColor(this._prevClear || (this._prevClear = new THREE.Color())), prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rtGlow);
    r.clear(true, false, false);
    this.scene.overrideMaterial = this.glowMat;
    r.render(this.scene, this.fxCam);
    this.scene.overrideMaterial = null;
    r.setClearColor(prevClear, prevAlpha);
  }

  // Each piece's surface points (a sample, at most SURF_N), for telling which
  // of two overlapping on screen is in front - see renderPieces
  _surfacePoints(sb) {
    const c = this._surfPts;
    if (c && c.topo === sb.topoVersion && c.n === sb.pieces.length) return c.lists;
    const NP = sb.pieces.length, seen = new Uint8Array(sb.nV), per = Array.from({ length: NP }, () => []);
    for (let f = 0; f < sb.nF * 3; f++) {
      const vi = sb.sTri[f];
      if (seen[vi]) continue;
      seen[vi] = 1;
      const k = sb.vPiece[vi];
      if (k >= 0 && k < NP) per[k].push(vi);
    }
    const lists = per.map((l) => {
      if (l.length <= SURF_N) return Int32Array.from(l);
      const st = l.length / SURF_N, out = new Int32Array(SURF_N);
      for (let q = 0; q < SURF_N; q++) out[q] = l[Math.floor(q * st)];
      return out;
    });
    this._surfPts = { topo: sb.topoVersion, n: NP, lists };
    return lists;
  }

  // Render pieces back-to-front in layers: pieces that don't overlap on
  // screen share a pass; a piece that overlaps one behind it goes in a later
  // layer so it refracts that piece.
  // The skin's coat, where it's nearest the eye (see createCoverMaterial):
  // the glitter and bubbles inside fade under flour, sugar, frost. Only
  // drawn while there's a coat anywhere.
  renderCover(camera) {
    const on = !!(this.coverWanted && this.allMesh && this.rtCover);
    this.coverU.uCoverOn.value = on ? 1 : 0;
    if (!on) return;
    const r = this.renderer, prev = r.getRenderTarget(), pc = r.getClearColor(this._v2c || (this._v2c = new THREE.Color())), pa = r.getClearAlpha();
    r.setRenderTarget(this.rtCover);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    this.scene.overrideMaterial = this.coverMat;
    r.render(this.scene, camera);
    this.scene.overrideMaterial = null;
    r.setRenderTarget(prev);
    r.setClearColor(pc, pa);
  }

  // The jelly's shader with only what's here compiled in (see jellyDefines):
  // each part's code, there but unused, made every pixel of every cube
  // slower - the shader too big for the GPU to keep in its registers. A
  // plain cube drew in half the time without them, an iridescent one in a
  // third. A set not drawn with before is compiled aside - a big shader took
  // seconds, the screen frozen - and only while it's quiet (this.quiet:
  // nothing held, nothing moving), as some GPUs stop drawing while they
  // compile: one at a time, the one with everything first. Till it's ready,
  // the one it's drawn with now stands in if that has all it needs, else
  // the one with everything.
  setFeatures(sb, camera) {
    const want = this._wantFeatures(sb), all = JELLY_ALL | (want & JELLY_DEBUG);
    if (this.frontMat.fragmentShader !== this._featSrc) {
      // (its source changed - harnesses do that: none of those compiled fit)
      if (this._variants) this._finishWarms();
      for (const v of this._variants?.values() || []) v.m.dispose();
      for (const m of this._runMats?.values() || []) m.dispose();
      this._runMats = new Map();
      this._variants = new Map();
      this._featUsed = new Set();
      this._featSrc = this.frontMat.fragmentShader;
      this._featKey = undefined;
    }
    if (this._featKey === undefined) return this._useFeatures(want); // (the first: compiled now)
    if (this.quiet && !this.portraits && !this._warming()) this._warm(this._featReady(all) ? want : all, camera);
    // (several cubes: each one's own parts, compiled aside one at a time)
    if (this.quiet && !this.portraits && !this._warming() && this._featReady(all) && this._featReady(want) && this.multiCube) {
      const keys = this._cubeKeys();
      for (const pc of sb.pieces) {
        if (this._featReady(keys[pc.cube])) continue;
        this._warm(keys[pc.cube], camera);
        break;
      }
    }
    if (want === this._featKey) return;
    if (this._featReady(want)) return this._useFeatures(want);
    if ((this._featKey & want) === want) return;
    // (nothing compiled has it all: the one with everything, or this one now -
    // never while another's still compiling)
    if (this._featReady(all)) return this._useFeatures(all);
    this._finishWarms();
    this._useFeatures(want);
  }

  // what's here: the cubes' looks, any coat, glow mode, a weld or a flame
  _wantFeatures(sb) {
    const f = this._featSeen || (this._featSeen = new Uint8Array(MAX_CUBES)), keys = this._cubeKeys();
    f.fill(0);
    for (const pc of sb.pieces) f[pc.cube] = 1;
    let key = 0;
    for (let k = 0; k < MAX_CUBES; k++) if (f[k]) key |= keys[k];
    return key;
  }

  // each cube's own: what its look needs of the front shader - and what all
  // of them need (a coat, glow mode, a weld or a flame)
  _cubeKeys() {
    const D = this.cubeData, keys = this._ck || (this._ck = new Int32Array(MAX_CUBES));
    const U = this.frontMat.uniforms, pl = U.uPLColor.value;
    let g = 0;
    if (this.coverWanted) g |= 16; // (sugar, a dusting, flour, frost - see update)
    if (U.uEmit.value > 0) g |= 32;
    if (U.uWeldT.value < 5 || pl.r + pl.g + pl.b > 0.001) g |= 64;
    if (this.debugShader) g |= JELLY_DEBUG;
    for (let k = 0; k < MAX_CUBES; k++) {
      const r = k * CUBE_TEX_W * 4;
      let key = g;
      if (D[r + 14] > 0) key |= 1; // iridescent
      if (D[r + 15] > 0) key |= 2; // metal
      if (D[r + 16] > 0) key |= 4; // opal fire
      // a surface map: a face's baked one, or holes all through
      if (D[r + 31 * 4] > 0.5) key |= SURFACES[Math.round(D[r + 31 * 4])]?.through ? 256 : 8;
      keys[k] = key;
    }
    return keys;
  }

  // The front shader for one cube's run of a layer: its own parts if those
  // are compiled (else the frame's, with everything here)
  _runMat(key) {
    if (key === this._featKey || !this._featReady(key)) return this.frontMat;
    const M = this._runMats || (this._runMats = new Map());
    let m = M.get(key);
    if (!m) {
      m = this.frontMat.clone();
      m.uniforms = this.frontMat.uniforms;
      m.defines = jellyDefines(key);
      M.set(key, m);
    }
    return m;
  }

  _useFeatures(key) {
    this._featKey = key;
    this._featUsed.add(key);
    this.frontMat.defines = jellyDefines(key);
    this.frontMat.needsUpdate = true;
  }

  _featReady(key) {
    if (this._featUsed.has(key)) return true;
    const v = this._variants.get(key);
    return !!v && v.prog.isReady();
  }

  // (one still compiling)
  _warming() {
    for (const v of this._variants.values()) if (!v.prog.isReady()) return true;
    return false;
  }

  // (wait for those still compiling: asking whether one's linked waits for it)
  _finishWarms() {
    const gl = this.renderer.getContext();
    for (const v of this._variants.values()) if (!v.prog.isReady()) gl.getProgramParameter(v.prog.program, gl.LINK_STATUS);
  }

  // a set compiled in the background: a stand-in material of its own, as the
  // jelly's but for its parts - three shares one compiled program between
  // materials alike, so the jelly's picks this one up when it's switched to
  // it (compiled as it's drawn: into a target, from a mesh like its own)
  _warm(key, camera) {
    if (this._featUsed.has(key) || this._variants.has(key) || !this.rtBack) return;
    const F = this.frontMat, r = this.renderer, prev = r.getRenderTarget();
    const m = new THREE.ShaderMaterial({ side: F.side, uniforms: F.uniforms, vertexShader: F.vertexShader, fragmentShader: F.fragmentShader, defines: jellyDefines(key) });
    const mesh = this._warmMesh || (this._warmMesh = new THREE.Mesh());
    mesh.geometry = this.allMesh.geometry;
    mesh.material = m;
    const scene = this._warmScene || (this._warmScene = new THREE.Scene().add(mesh));
    r.setRenderTarget(this.rtBack);
    r.compile(scene, camera);
    r.setRenderTarget(prev);
    this._variants.set(key, { m, prog: r.properties.get(m).currentProgram });
    if (this._serialCompile) this._finishWarms();
  }

  renderPieces(camera, sb, rtScene, rtTrans, copyFn) {
    const r = this.renderer;
    const v = this._v;
    if (!this.allMesh) return;
    this.setFeatures(sb, camera);
    this.renderCover(camera);
    const NP = Math.min(sb.pieces.length, this.pieceIdx.length / 2);
    const maxL = Math.min(this.maxLayers, this.layerCap, this.layerMeshes.length);
    // (the layers as last time, if nothing's changed: the camera still, the
    // body the same and all of it asleep - or, only it moving, every other
    // frame: telling who's in front costs a little, a piece)
    const sig = this._layerSig || (this._layerSig = new Float64Array(34));
    const me = camera.matrixWorld.elements, pe = camera.projectionMatrix.elements;
    let same = sig[32] === sb.topoVersion && sig[33] === NP && this._layerMaxL === maxL;
    this._layerMaxL = maxL;
    for (let q = 0; q < 16 && same; q++) same = sig[q] === me[q] && sig[16 + q] === pe[q];
    let awake = false;
    for (let k = 0; k < NP && !awake; k++) awake = !!sb.pieces[k] && !sb.pieces[k].asleep;
    this._layerTick = (this._layerTick || 0) + 1;
    // (all at rest: one last full look - then that, until something moves)
    let items = same && this._layerItems && ((!awake && this._layerItems.complete) || (awake && this._layerTick % 2)) ? this._layerItems : null;
    const settled = same && !awake;
    if (!items) {
    for (let q = 0; q < 16; q++) { sig[q] = me[q]; sig[16 + q] = pe[q]; }
    sig[32] = sb.topoVersion;
    sig[33] = NP;
    items = [];
    for (let k = 0; k < NP; k++) {
      const pc = sb.pieces[k];
      if (!pc || this.pieceIdx[k * 2 + 1] <= this.pieceIdx[k * 2]) continue;
      const b = pc.bbox, pts = [];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, behind = false;
      for (let c = 0; c < 8; c++) {
        v.set(c & 1 ? b[3] : b[0], c & 2 ? b[4] : b[1], c & 4 ? b[5] : b[2]).project(camera);
        if (v.z > 1) behind = true;
        pts.push([v.x, v.y]);
        if (v.x < x0) x0 = v.x;
        if (v.x > x1) x1 = v.x;
        if (v.y < y0) y0 = v.y;
        if (v.y > y1) y1 = v.y;
      }
      // (its outline on screen: the hull of its surface points, below - or,
      // a corner of its box behind the camera, the box round them)
      const hull = behind ? [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] : null;
      const d = v.set(pc.com[0], pc.com[1], pc.com[2]).distanceToSquared(camera.position);
      items.push({ k, d, x0, y0, x1, y1, hull, area: 0, layer: 0 });
    }
    // Pieces overlapping on screen go into successive layers, so the nearer
    // refracts the farther. Overlap is by their outlines - by the boxes
    // round them, cubes stacked side by side chained up layer after layer
    // just touching. Which of two is nearer is told where they overlap: by
    // whose surface there is nearer the eye - by their middles' distance, a
    // shard lying on a big slice was behind it seen from some angles, and
    // the slice beneath vanished. Each layer costs two passes and a
    // full-screen copy, so there are only so many (maxLayers); past that,
    // layers are merged where the least overlaps: a nearer and a farther
    // piece sharing a layer, the nearer can't show the farther (it vanishes
    // behind it - a cube behind a cube, gone at some angles), so that's kept
    // to the least screen.
    const N = items.length, edges = [];
    const surf = this._surfacePoints(sb), VP = this._vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
    // Each piece's outline on screen: the hull of (a third of) its surface
    // points - for a shard, a convex piece, its very silhouette.
    const x = sb.x;
    const proj = (vi, out, o) => {
      const X = x[vi * 3], Y = x[vi * 3 + 1], Z = x[vi * 3 + 2];
      const w = VP[3] * X + VP[7] * Y + VP[11] * Z + VP[15];
      if (!(w > 1e-4)) return false;
      out[o] = (VP[0] * X + VP[4] * Y + VP[8] * Z + VP[12]) / w;
      out[o + 1] = (VP[1] * X + VP[5] * Y + VP[9] * Z + VP[13]) / w;
      out[o + 2] = w;
      return true;
    };
    const tmp = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      const it = items[i];
      it.pi = i;
      it.n = -1;
      if (!it.hull) {
        const list = surf[it.k] || [], pts = [];
        for (let q = 0; q < list.length; q += HULL_STEP) if (proj(list[q], tmp, 0)) pts.push([tmp[0], tmp[1]]);
        if (pts.length >= 3) {
          it.hull = convexHull(pts);
          it.x0 = Infinity; it.y0 = Infinity; it.x1 = -Infinity; it.y1 = -Infinity;
          for (const p of it.hull) {
            if (p[0] < it.x0) it.x0 = p[0];
            if (p[0] > it.x1) it.x1 = p[0];
            if (p[1] < it.y0) it.y0 = p[1];
            if (p[1] > it.y1) it.y1 = p[1];
          }
        } else it.hull = [[it.x0, it.y0], [it.x1, it.y0], [it.x1, it.y1], [it.x0, it.y1]];
      }
      it.area = polyArea(it.hull);
    }
    // (all its surface points on screen - x, y, depth - when a vote wants them)
    const scr = this._scr || (this._scr = []);
    const pointsOf = (it) => {
      if (it.n >= 0) return scr[it.pi];
      const list = surf[it.k] || [];
      const P3 = scr[it.pi] && scr[it.pi].length >= list.length * 3 ? scr[it.pi] : (scr[it.pi] = new Float32Array(Math.max(list.length, 16) * 3));
      let n = 0;
      for (let q = 0; q < list.length; q++) if (proj(list[q], P3, n * 3)) n++;
      it.n = n;
      return P3;
    };
    // Which is in front where two overlap: each one's points there vote -
    // is it nearer the eye than the other's surface right beside it on
    // screen? (Two that don't pass through each other: every point of the
    // one in front is in front of the other there.) A's share of the votes,
    // -1 if none; the other's points looked up in a little grid of cells.
    const inP = (P, qx, qy) => {
      for (let e = 0; e < P.length; e++) {
        const A = P[e], B = P[(e + 1) % P.length];
        if ((B[0] - A[0]) * (qy - A[1]) - (B[1] - A[1]) * (qx - A[0]) < 0) return false;
      }
      return true;
    };
    const selA = this._selA || (this._selA = new Int32Array(512)), selB = this._selB || (this._selB = new Int32Array(512));
    const pick = (it, P, bx0, by0, bx1, by1, out) => {
      const S = pointsOf(it);
      let m = 0;
      for (let q = 0; q < it.n && m < out.length; q++) {
        const qx = S[q * 3], qy = S[q * 3 + 1];
        if (qx >= bx0 && qx <= bx1 && qy >= by0 && qy <= by1 && inP(P, qx, qy)) out[m++] = q;
      }
      return m;
    };
    const cellHead = this._cellHead || (this._cellHead = new Int32Array(16 * 16)), cellNext = this._cellNext || (this._cellNext = new Int32Array(512));
    const vote = (a, b, P, bx0, by0, bx1, by1, rad) => {
      const na = pick(a, P, bx0, by0, bx1, by1, selA), nb = pick(b, P, bx0, by0, bx1, by1, selB);
      if (!na || !nb) return -1;
      const SA = scr[a.pi], SB = scr[b.pi], r2 = rad * rad;
      const C = Math.max(1, Math.min(16, Math.floor(Math.max(bx1 - bx0, by1 - by0) / rad))), cw = Math.max(bx1 - bx0, 1e-6) / C, ch = Math.max(by1 - by0, 1e-6) / C;
      let forA = 0, n = 0;
      // (T's points into cells, then each of S's against T's in the cells round it)
      const tally = (S, sel, ns, T, tsel, nt, mine) => {
        cellHead.fill(-1, 0, C * C);
        for (let k = 0; k < nt; k++) {
          const q = tsel[k] * 3, c = Math.min(C - 1, Math.floor((T[q] - bx0) / cw)) + C * Math.min(C - 1, Math.floor((T[q + 1] - by0) / ch));
          cellNext[k] = cellHead[c];
          cellHead[c] = k;
        }
        const rx = Math.ceil(rad / cw), ry = Math.ceil(rad / ch);
        for (let k = 0; k < ns; k++) {
          const q = sel[k] * 3, sx = S[q], sy = S[q + 1];
          const cx = Math.min(C - 1, Math.floor((sx - bx0) / cw)), cy = Math.min(C - 1, Math.floor((sy - by0) / ch));
          let near = Infinity;
          for (let yy = Math.max(0, cy - ry); yy <= Math.min(C - 1, cy + ry); yy++)
            for (let xx = Math.max(0, cx - rx); xx <= Math.min(C - 1, cx + rx); xx++)
              for (let t = cellHead[xx + C * yy]; t >= 0; t = cellNext[t]) {
                const u = tsel[t] * 3, dx = T[u] - sx, dy = T[u + 1] - sy;
                if (dx * dx + dy * dy < r2 && T[u + 2] < near) near = T[u + 2];
              }
          if (near === Infinity) continue;
          n++;
          if (S[q + 2] < near === mine) forA++;
        }
      };
      tally(SA, selA, na, SB, selB, nb, true);
      tally(SB, selB, nb, SA, selA, na, false);
      return n ? forA / n : -1;
    };
    // (decisions kept from frame to frame, a few looked at again each frame
    // in turn - a turning view changes them slowly; a pair not yet decided
    // goes by their middles meanwhile)
    if (this._pairTopo !== sb.topoVersion || !this._pairs) {
      this._pairs = new Map();
      this._pairTopo = sb.topoVersion;
    }
    const pairs = this._pairs, tick = this._layerTick;
    let budget = settled ? Infinity : 24, complete = true;
    const into = new Int32Array(N), inW = new Float64Array(N), outE = Array.from({ length: N }, () => []);
    for (let i = 0; i < N; i++) {
      const a = items[i];
      for (let j = i + 1; j < N; j++) {
        const b = items[j];
        if (a.x0 > b.x1 || b.x0 > a.x1 || a.y0 > b.y1 || b.y0 > a.y1) continue;
        const P = clipConvex(a.hull, b.hull), ov = polyArea(P);
        // (a sliver - stacked neighbours, seen a little from above - is
        // left out: it would cost a layer for next to nothing)
        if (!(ov > 0.01 * Math.min(a.area, b.area))) continue;
        const key = Math.min(a.k, b.k) * 65536 + Math.max(a.k, b.k);
        let c = pairs.get(key);
        if (budget > 0 && (!c || tick - c.tick > 6)) {
          budget--;
          let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
          for (const p of P) {
            if (p[0] < bx0) bx0 = p[0];
            if (p[0] > bx1) bx1 = p[0];
            if (p[1] < by0) by0 = p[1];
            if (p[1] > by1) by1 = p[1];
          }
          // (beside: within a little of the overlap's size)
          const share = vote(a, b, P, bx0, by0, bx1, by1, 0.25 * Math.sqrt(ov) + 0.004);
          c = { tick, front: share >= 0 ? (share > 0.5 ? a.k : b.k) : -1, sure: share >= 0 ? Math.max(0.1, Math.abs(2 * share - 1)) : 0.1 };
          pairs.set(key, c);
        }
        if (!c || c.tick !== tick) complete = false;
        // (no say either way: their middles)
        const aFront = c && c.front >= 0 ? c.front === a.k : a.d < b.d;
        const back = aFront ? j : i, front = aFront ? i : j;
        edges.push(back, front, ov);
        outE[back].push(front);
        into[front]++;
        // (how much it'd cost to get wrong, to break a loop: the overlap, as
        // sure as the vote was)
        inW[front] += ov * (c ? c.sure : 0.1);
      }
    }
    // in order, behind before in front (the farthest first where it's free
    // to choose). A loop - each in front of the next, by a vote that got a
    // small overlap wrong - is broken where it costs least: the one whose
    // remaining "behind me" overlaps are fewest and least sure goes first.
    const done = new Uint8Array(N), order = [];
    const byFar = items.map((_, i) => i).sort((p, q) => items[q].d - items[p].d);
    while (order.length < N) {
      let pick = -1;
      for (const i of byFar) if (!done[i] && into[i] === 0) { pick = i; break; }
      if (pick < 0) {
        let best = Infinity;
        for (const i of byFar) if (!done[i] && inW[i] < best) { best = inW[i]; pick = i; }
      }
      done[pick] = 1;
      order.push(pick);
      for (const f of outE[pick]) into[f]--;
    }
    // each one's layer: one past the deepest of those behind it
    let depthN = 1;
    const depth = new Int32Array(N), inEdges = Array.from({ length: N }, () => []);
    for (let e = 0; e < edges.length; e += 3) inEdges[edges[e + 1]].push(edges[e]);
    const pos = new Int32Array(N);
    order.forEach((i, r) => (pos[i] = r));
    for (const i of order) {
      let dep = 0;
      for (const b of inEdges[i]) if (pos[b] < pos[i]) dep = Math.max(dep, depth[b] + 1);
      depth[i] = dep;
      depthN = Math.max(depthN, dep + 1);
    }
    for (let i = 0; i < N; i++) items[i].layer = depth[i];
    this._depthN = depthN; // (how many it'd take: ?stats, harnesses)
    if (depthN > maxL) {
      // merge the depths into maxL runs, in order, losing the least overlap:
      // W[x][y] = overlap between depth x (farther) and y; cost of a run =
      // what's inside it (a prefix sum over the square), a small DP over runs
      const D = depthN, W = new Float64Array(D * D);
      for (let e = 0; e < edges.length; e += 3) W[items[edges[e]].layer * D + items[edges[e + 1]].layer] += edges[e + 2];
      const S = new Float64Array((D + 1) * (D + 1));
      for (let x = 0; x < D; x++) for (let y = 0; y < D; y++) S[(x + 1) * (D + 1) + y + 1] = W[x * D + y] + S[x * (D + 1) + y + 1] + S[(x + 1) * (D + 1) + y] - S[x * (D + 1) + y];
      const run = (lo, hi) => S[(hi + 1) * (D + 1) + hi + 1] - S[lo * (D + 1) + hi + 1] - S[(hi + 1) * (D + 1) + lo] + S[lo * (D + 1) + lo];
      // best[g][e]: least lost with depths 0..e-1 in g runs; cut[g][e]: where the last run starts
      const best = [new Float64Array(D + 1).fill(Infinity)], cut = [new Int32Array(D + 1)];
      best[0][0] = 0;
      for (let g = 1; g <= maxL; g++) {
        best[g] = new Float64Array(D + 1).fill(Infinity);
        cut[g] = new Int32Array(D + 1);
        for (let e = 1; e <= D; e++)
          for (let st = g - 1; st < e; st++) {
            const c = best[g - 1][st] + run(st, e - 1);
            if (c < best[g][e]) {
              best[g][e] = c;
              cut[g][e] = st;
            }
          }
      }
      const group = new Int32Array(D);
      for (let g = maxL, e = D; g > 0; g--) {
        const st = cut[g][e];
        for (let x = st; x < e; x++) group[x] = g - 1;
        e = st;
      }
      for (const it of items) it.layer = group[it.layer];
      depthN = maxL;
    }
    items.depthN = depthN;
    items.complete = complete;
    this._layerItems = items;
    }
    let nLayers = items.depthN;
    // each layer's mesh: its pieces' runs of the index (rewritten only when
    // a piece changes layer)
    let changed = false;
    const layerOf = this.layerOf;
    const seen = new Uint8Array(NP);
    for (const it of items) {
      seen[it.k] = 1;
      if (layerOf[it.k] !== it.layer) changed = true;
      layerOf[it.k] = it.layer;
    }
    for (let k = 0; k < NP; k++) {
      if (!seen[k] && layerOf[k] !== -1) {
        layerOf[k] = -1;
        changed = true;
      }
    }
    // (several cubes: a layer's pieces in runs, cube look by cube look - each
    // run drawn with just the parts of the shader its look needs)
    const ckeys = this.multiCube ? this._cubeKeys() : null;
    if (ckeys) {
      let sigK = 0;
      for (let k = 0; k < MAX_CUBES; k++) sigK = (Math.imul(sigK, 31) + ckeys[k]) | 0;
      if (sigK !== this._runSig) changed = true;
      this._runSig = sigK;
    } else if (this._runSig !== 0) {
      changed = true;
      this._runSig = 0;
    }
    if (changed) {
      const full = this.fullIndex, P = this.pieceIdx;
      const runs = this.layerRuns || (this.layerRuns = []);
      for (let L = 0; L < maxL; L++) {
        const g = this.layerMeshes[L].geometry, idx = g.index;
        let n = 0;
        const order = [];
        for (let k = 0; k < NP; k++) if (layerOf[k] === L) order.push(k);
        if (ckeys) order.sort((a, b) => ckeys[sb.pieces[a].cube] - ckeys[sb.pieces[b].cube] || a - b);
        const R = (runs[L] = []);
        for (const k of order) {
          const len = P[k * 2 + 1] - P[k * 2], key = ckeys ? ckeys[sb.pieces[k].cube] : -1;
          if (!R.length || R[R.length - 1].key !== key) R.push({ key, start: n, count: 0 });
          idx.array.set(full.subarray(P[k * 2], P[k * 2 + 1]), n);
          n += len;
          R[R.length - 1].count += len;
        }
        if (n !== this.layerCount[L] || n) {
          idx.clearUpdateRanges();
          idx.addUpdateRange(0, n);
          idx.needsUpdate = true;
        }
        this.layerCount[L] = n;
        g.setDrawRange(0, n);
      }
    }
    const perLayer = this._perLayer || (this._perLayer = new Int32Array(16));
    perLayer.fill(0);
    for (const it of items) perLayer[it.layer]++;
    const auto = r.autoClear;
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    this.frontMat.uniforms.tScene.value = rtTrans.texture;
    // (the back: depth, normal and rest height where the line of sight
    // leaves - and, for a gradient that needs it, the whole rest point)
    const rest = this.needRest;
    if (rest && !this.rtBackRest) {
      const { width, height } = this.rtBack;
      this.rtBackRest = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: true, count: 2 });
    }
    const rtBack = rest ? this.rtBackRest : this.rtBack;
    this.frontMat.uniforms.tBack.value = rtBack.texture;
    this.frontMat.uniforms.tBackRest.value = rest ? rtBack.textures[1] : rtBack.texture;
    this.frontMat.uniforms.uBackRest.value = rest ? 1 : 0;
    this.layers = nLayers;
    this.allMesh.visible = false;
    for (let L = 0; L < nLayers; L++) {
      for (let q = 0; q < this.layerMeshes.length; q++) this.layerMeshes[q].visible = q === L && this.layerCount[q] > 0;
      r.autoClear = false;
      r.setClearColor(0x000000, 0);
      r.setRenderTarget(rtBack);
      r.clear(true, true, false);
      this.scene.overrideMaterial = rest ? this.backMatRest : this.backMat;
      r.render(this.scene, camera);
      r.setRenderTarget(rtScene);
      // (a big mesh, or several pieces sharing the layer: depth first)
      if (this.prepass && (this.layerCount[L] > 60000 || perLayer[L] > 1)) {
        this.scene.overrideMaterial = this.depthMat;
        r.render(this.scene, camera);
      }
      this.scene.overrideMaterial = null;
      const R = this.layerRuns?.[L];
      if (!R || R.length < 2) r.render(this.scene, camera);
      else {
        const mesh = this.layerMeshes[L], g = mesh.geometry, n = g.drawRange.count;
        for (const run of R) {
          mesh.material = this._runMat(run.key);
          g.setDrawRange(run.start, run.count);
          r.render(this.scene, camera);
        }
        mesh.material = this.frontMat;
        g.setDrawRange(0, n);
      }
      if (L < nLayers - 1) copyFn();
    }
    for (const m of this.layerMeshes) m.visible = false;
    this.allMesh.visible = true;
    r.autoClear = auto;
    r.setClearColor(prevClear, prevAlpha);
  }

}
