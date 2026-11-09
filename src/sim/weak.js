// Where the jelly's already broken - a line of bullet holes shot through it,
// a part cut, a scoop, a bite - it tears. The hand's tearing (tools/basic.js
// HandTool) asks for the weakest way through a piece between two holds:
// the plane the least of its jelly crosses, as a share of what would cross
// it were the cube whole - then tears there, and the sooner.

import { TAG_FRESH, REST_STEP } from './softbody.js';
import { roundBoxSDF } from './mesh.js';

// (under this share of the jelly crossing it, a tear goes that way)
export const WEAK = 0.92;
// (the ways looked through: square to the line between the holds, and
// tilted off it up to 25°, all round)
const DIRS = [[0, 0]];
for (const th of [12.5, 25]) for (let k = 0; k < 6; k++) DIRS.push([(th * Math.PI) / 180, (k + (th > 20 ? 0.5 : 0)) * (Math.PI / 3)]);

// A piece's jelly in its rest shape, on a grid half a cell apart: each
// cell's middle and what's there - its jelly (1), or nothing where its cube
// was whole (2: a hole, a scoop, a bite, a pit melted or eaten out - or a
// bit that's come away, the ball a scoop took). (Another big piece's jelly,
// or outside the cube, isn't counted either way: that's where it ends, not
// where it's weak.) And its slits, cut faces with its own jelly just the
// other side (a part cut, a tear let go of part way): each face's middle,
// outward normal, area and index. Good till the jelly's cut again (topo).
export function weakMap(sb, k) {
  const pc = sb.pieces[k], X = sb.X, T = sb.T, g = 0.5 * sb.hCell, hit = {};
  // (the whole cube it's of, in the rest shape)
  const cb = sb.vCube[pc.verts[0]], half = sb.cSize[cb] / 2, bevel = sb.cBevel[cb], ox = cb * REST_STEP, bit = 0.15 * sb.cSize[cb] ** 3;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const i of pc.verts)
    for (let c = 0; c < 3; c++) {
      const v = X[i * 3 + c];
      if (v < lo[c]) lo[c] = v;
      if (v > hi[c]) hi[c] = v;
    }
  const n0 = Math.max(1, Math.ceil((hi[0] - lo[0]) / g)), n1 = Math.max(1, Math.ceil((hi[1] - lo[1]) / g)), n2 = Math.max(1, Math.ceil((hi[2] - lo[2]) / g));
  const cells = [];
  for (let a = 0; a < n0; a++)
    for (let b = 0; b < n1; b++)
      for (let c = 0; c < n2; c++) {
        const px = lo[0] + (a + 0.5) * g, py = lo[1] + (b + 0.5) * g, pz = lo[2] + (c + 0.5) * g;
        if (sb.locateRestFast(px, py, pz, hit)) {
          const q = sb.tPiece[hit.tet];
          if (q === k) cells.push(px, py, pz, 1);
          else if (sb.pieces[q].volume < bit && roundBoxSDF(px - ox, py, pz, half, bevel) < -0.25 * g) cells.push(px, py, pz, 2);
        } else if (roundBoxSDF(px - ox, py, pz, half, bevel) < -0.25 * g) cells.push(px, py, pz, 2);
      }
  const slits = [], { sTri, sTag, sTet, tPiece } = sb, e = 0.25 * g;
  for (let f = 0; f < sb.nF; f++) {
    const t = sTet[f];
    if (sTag[f] !== TAG_FRESH || tPiece[t] !== k) continue;
    const a = sTri[f * 3], b = sTri[f * 3 + 1], c = sTri[f * 3 + 2];
    const ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2];
    const vx = X[c * 3] - X[a * 3], vy = X[c * 3 + 1] - X[a * 3 + 1], vz = X[c * 3 + 2] - X[a * 3 + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const a2 = Math.hypot(nx, ny, nz);
    if (!(a2 > 1e-12)) continue;
    nx /= a2; ny /= a2; nz /= a2;
    const cx = (X[a * 3] + X[b * 3] + X[c * 3]) / 3, cy = (X[a * 3 + 1] + X[b * 3 + 1] + X[c * 3 + 1]) / 3, cz = (X[a * 3 + 2] + X[b * 3 + 2] + X[c * 3 + 2]) / 3;
    // (outward: away from its tet's fourth corner)
    for (let j = 0; j < 4; j++) {
      const v = T[t * 4 + j];
      if (v === a || v === b || v === c) continue;
      if ((X[v * 3] - cx) * nx + (X[v * 3 + 1] - cy) * ny + (X[v * 3 + 2] - cz) * nz > 0) {
        nx = -nx; ny = -ny; nz = -nz;
      }
    }
    if (!sb.locateRestFast(cx + nx * e, cy + ny * e, cz + nz * e, hit) || tPiece[hit.tet] !== k) continue;
    slits.push(cx, cy, cz, nx, ny, nz, a2 / 2, f);
  }
  return { topo: sb.topoVersion, k, g, cells: Float64Array.from(cells), slits: Float64Array.from(slits) };
}

// The weakest way through a piece (its weakMap, W) between holds at rest
// points A and B: of the planes square to the line between them or tilted
// off it (DIRS), through the middle three-fifths of the way, the one the
// least of its jelly crosses - its cells there, less any slit lying in it -
// as a share of what would cross it were the cube there whole (its cells
// and the gaps in it). { share, n, d: the plane in the rest shape (n.x = d);
// slit, faces: a slit it runs along, if that's most of what's missing there }
export function weakest(W, A, B) {
  const g = W.g, C = W.cells, S = W.slits, none = { share: 1 };
  const ax = B[0] - A[0], ay = B[1] - A[1], az = B[2] - A[2], L = Math.hypot(ax, ay, az);
  if (!(L > 4 * g)) return none;
  const n0 = [ax / L, ay / L, az / L];
  // (two ways square to it)
  const r = Math.abs(n0[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = [n0[1] * r[2] - n0[2] * r[1], n0[2] * r[0] - n0[0] * r[2], n0[0] * r[1] - n0[1] * r[0]];
  const ul = Math.hypot(u[0], u[1], u[2]);
  u[0] /= ul; u[1] /= ul; u[2] /= ul;
  const v = [n0[1] * u[2] - n0[2] * u[1], n0[2] * u[0] - n0[0] * u[2], n0[0] * u[1] - n0[1] * u[0]];
  const g3 = g * g * g, NB = 64, jel = new Float64Array(NB), gap = new Float64Array(NB), sl = new Float64Array(NB);
  let big = 0, best = null;
  for (const [th, ph] of DIRS) {
    const ct = Math.cos(th), st = Math.sin(th), cp = Math.cos(ph), sp = Math.sin(ph);
    const nx = ct * n0[0] + st * (cp * u[0] + sp * v[0]), ny = ct * n0[1] + st * (cp * u[1] + sp * v[1]), nz = ct * n0[2] + st * (cp * u[2] + sp * v[2]);
    const a = nx * A[0] + ny * A[1] + nz * A[2], b = nx * B[0] + ny * B[1] + nz * B[2];
    const lo = a + 0.2 * (b - a), hi = b - 0.2 * (b - a);
    const nb = Math.min(NB, Math.max(1, Math.round((hi - lo) / g))), w = (hi - lo) / nb;
    if (!(w > 0)) continue;
    jel.fill(0, 0, nb);
    gap.fill(0, 0, nb);
    sl.fill(0, 0, nb);
    for (let i = 0; i < C.length; i += 4) {
      const p = nx * C[i] + ny * C[i + 1] + nz * C[i + 2];
      if (p < lo || p >= hi) continue;
      const j = Math.min(nb - 1, Math.floor((p - lo) / w));
      if (C[i + 3] === 1) jel[j]++;
      else gap[j]++;
    }
    // (a slit counts once: its two faces, a side each)
    for (let i = 0; i < S.length; i += 8) {
      const c = Math.abs(nx * S[i + 3] + ny * S[i + 4] + nz * S[i + 5]);
      if (c < 0.85) continue;
      const p = nx * S[i] + ny * S[i + 1] + nz * S[i + 2];
      if (p >= lo && p < hi) sl[Math.min(nb - 1, Math.floor((p - lo) / w))] += (S[i + 6] * c) / 2;
    }
    // (what crosses each - a slab of cells w thick holds its area times w -
    // and what would, whole; only those across most of it: one clipping a
    // corner of the cube is thin anyway, not weak)
    if (th === 0) for (let j = 0; j < nb; j++) big = Math.max(big, ((jel[j] + gap[j]) * g3) / w);
    for (let j = 0; j < nb; j++) {
      const whole = ((jel[j] + gap[j]) * g3) / w;
      if (!(whole > 0.5 * big)) continue;
      // (tilted only where it's clearly weaker: square on by a little)
      const share = Math.max(0, (jel[j] * g3) / w - sl[j]) / whole + 0.04 * (th / 0.4363);
      if (best && share >= best.share) continue;
      best = { share, n: [nx, ny, nz], d: lo + (j + 0.5) * w, w, slit: sl[j] > (gap[j] * g3) / w };
    }
  }
  if (!best) return none;
  best.share = Math.max(0, best.share);
  // (a slit: the plane it's on - its faces in that slab, their middle and way)
  if (best.slit) {
    const n = best.n, faces = [], m = [0, 0, 0], nn = [0, 0, 0];
    let wsum = 0;
    for (let i = 0; i < S.length; i += 8) {
      const c = n[0] * S[i + 3] + n[1] * S[i + 4] + n[2] * S[i + 5];
      const p = n[0] * S[i] + n[1] * S[i + 1] + n[2] * S[i + 2];
      if (Math.abs(c) < 0.85 || Math.abs(p - best.d) > best.w) continue;
      const wa = S[i + 6], sg = Math.sign(c);
      for (let q = 0; q < 3; q++) {
        m[q] += S[i + q] * wa;
        nn[q] += S[i + 3 + q] * sg * wa;
      }
      wsum += wa;
      faces.push(S[i + 7]);
    }
    if (wsum > 0) {
      const nl = Math.hypot(nn[0], nn[1], nn[2]) || 1;
      best.n = nn.map((q) => q / nl);
      best.d = (m[0] * best.n[0] + m[1] * best.n[1] + m[2] * best.n[2]) / wsum;
      best.faces = faces;
    } else best.slit = false;
  }
  return best;
}

// ...that way through it as it is now, in the world: the rest shape's plane
// carried through how the jelly near it is stretched (its tets'
// deformation, on average) - { n, o: a point on it, calm(x, y, z): how
// ragged a torn face is let be there, 0 right by a slit it carries on }
export function worldPlane(sb, W, k, wk) {
  const T = sb.T, X = sb.X, x = sb.x, Bm = sb.B, pc = sb.pieces[k];
  if (!pc) return null;
  const [rx, ry, rz] = wk.n, g = W.g, F = new Float64Array(9), Ft = new Float64Array(9), o = [0, 0, 0];
  let wsum = 0;
  const tets = wk.slit ? new Set(wk.faces.map((f) => sb.sTet[f])) : null;
  for (const t of tets || pc.tets) {
    if (sb.vol0[t] <= 0 || sb.tPiece[t] !== k) continue;
    const a = T[t * 4], b = T[t * 4 + 1], c = T[t * 4 + 2], d = T[t * 4 + 3];
    const off = (rx * (X[a * 3] + X[b * 3] + X[c * 3] + X[d * 3]) + ry * (X[a * 3 + 1] + X[b * 3 + 1] + X[c * 3 + 1] + X[d * 3 + 1]) + rz * (X[a * 3 + 2] + X[b * 3 + 2] + X[c * 3 + 2] + X[d * 3 + 2])) / 4 - wk.d;
    if (!tets && Math.abs(off) > 1.5 * g) continue;
    // (its deformation: world edges times the inverse of its rest ones)
    const bo = t * 9;
    for (let i = 0; i < 3; i++) {
      const e0 = x[b * 3 + i] - x[a * 3 + i], e1 = x[c * 3 + i] - x[a * 3 + i], e2 = x[d * 3 + i] - x[a * 3 + i];
      for (let j = 0; j < 3; j++) Ft[i * 3 + j] = e0 * Bm[bo + j] + e1 * Bm[bo + 3 + j] + e2 * Bm[bo + 6 + j];
    }
    const wt = sb.vol0[t];
    for (let q = 0; q < 9; q++) F[q] += Ft[q] * wt;
    // (the plane, near it: its middle, moved back onto it the way it's stretched)
    for (let i = 0; i < 3; i++) {
      const xc = (x[a * 3 + i] + x[b * 3 + i] + x[c * 3 + i] + x[d * 3 + i]) / 4;
      o[i] += (xc - off * (Ft[i * 3] * rx + Ft[i * 3 + 1] * ry + Ft[i * 3 + 2] * rz)) * wt;
    }
    wsum += wt;
  }
  if (!(wsum > 0)) return null;
  for (let q = 0; q < 9; q++) F[q] /= wsum;
  for (let i = 0; i < 3; i++) o[i] /= wsum;
  // (a plane's normal goes the inverse transpose way: n = F^-T r = cof(F) r / det)
  const [a0, a1, a2, b0, b1, b2, c0, c1, c2] = F;
  const det = a0 * (b1 * c2 - b2 * c1) - a1 * (b0 * c2 - b2 * c0) + a2 * (b0 * c1 - b1 * c0);
  if (!(Math.abs(det) > 1e-9)) return null;
  const n = [
    ((b1 * c2 - b2 * c1) * rx - (b0 * c2 - b2 * c0) * ry + (b0 * c1 - b1 * c0) * rz) / det,
    (-(a1 * c2 - a2 * c1) * rx + (a0 * c2 - a2 * c0) * ry - (a0 * c1 - a1 * c0) * rz) / det,
    ((a1 * b2 - a2 * b1) * rx - (a0 * b2 - a2 * b0) * ry + (a0 * b1 - a1 * b0) * rz) / det,
  ];
  const nl = Math.hypot(n[0], n[1], n[2]);
  if (!(nl > 0)) return null;
  for (let q = 0; q < 3; q++) n[q] /= nl;
  let calm = null;
  if (wk.slit) {
    // (by a slit, flat: its faces' middles, now, on a grid a cell across)
    const h = sb.hCell, cells = new Map(), sTri = sb.sTri, key = (p, q, r) => (p + 4096) * 67108864 + (q + 4096) * 8192 + (r + 4096);
    for (const f of wk.faces) {
      const c = [0, 1, 2].map((q) => (x[sTri[f * 3] * 3 + q] + x[sTri[f * 3 + 1] * 3 + q] + x[sTri[f * 3 + 2] * 3 + q]) / 3);
      const kk = key(Math.floor(c[0] / h), Math.floor(c[1] / h), Math.floor(c[2] / h));
      if (!cells.has(kk)) cells.set(kk, []);
      cells.get(kk).push(c);
    }
    calm = (px, py, pz) => {
      let d2 = Infinity;
      const i0 = Math.floor(px / h), j0 = Math.floor(py / h), k0 = Math.floor(pz / h);
      for (let i = i0 - 2; i <= i0 + 2; i++)
        for (let j = j0 - 2; j <= j0 + 2; j++)
          for (let q = k0 - 2; q <= k0 + 2; q++) {
            const l = cells.get(key(i, j, q));
            if (l) for (const c of l) d2 = Math.min(d2, (c[0] - px) ** 2 + (c[1] - py) ** 2 + (c[2] - pz) ** 2);
          }
      const s = (Math.sqrt(d2) / h - 0.75) / 1.25;
      return s <= 0 ? 0 : s >= 1 ? 1 : s * s * (3 - 2 * s);
    };
  }
  return { n, o, calm };
}
