// Topology surgery on the tet mesh: cutting along an implicit surface
// (plane / sphere) with vertex snapping + conforming tet splitting, partial
// cuts by re-gluing outside the stroke region, element-boundary fracture,
// and tet removal. All operations end with sb.rebuild().

import { FACES } from './softbody.js';

const TET_EDGES = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];

function det3(ax, ay, az, bx, by, bz, cx, cy, cz) {
  return ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
}

function restVolume(X, a, b, c, d) {
  const a3 = a * 3, b3 = b * 3, c3 = c * 3, d3 = d * 3;
  return det3(
    X[b3] - X[a3], X[b3 + 1] - X[a3 + 1], X[b3 + 2] - X[a3 + 2],
    X[c3] - X[a3], X[c3 + 1] - X[a3 + 1], X[c3 + 2] - X[a3 + 2],
    X[d3] - X[a3], X[d3 + 1] - X[a3 + 1], X[d3 + 2] - X[a3 + 2],
  ) / 6;
}

// Capture world positions of all anchors so they can be re-embedded after
// the topology changes.
export function captureAnchors(sb, anchors) {
  const p = [0, 0, 0];
  for (const a of anchors) {
    if (a.tet < 0 || a.tet >= sb.nT) continue;
    sb.embedPoint(a.tet, a.b, p);
    a.wx = p[0]; a.wy = p[1]; a.wz = p[2];
  }
}

export function relocateAnchors(sb, anchors) {
  for (const a of anchors) {
    if (a.wx === undefined) continue;
    const r = sb.locate(a.wx, a.wy, a.wz);
    if (r && r.score > -0.6) {
      a.tet = r.tet;
      a.b[0] = r.bary[0]; a.b[1] = r.bary[1]; a.b[2] = r.bary[2]; a.b[3] = r.bary[3];
      a.lost = false;
    } else {
      a.tet = -1;
      a.lost = true;
    }
  }
}

/**
 * Cut the body along the zero set of `field`.
 * field.value(x,y,z) -> signed distance-ish; field.normal(x,y,z,out) -> unit gradient
 * field.inRegion(x,y,z) -> bool (optional; outside the region the cut is re-glued)
 * opts.snap: snapping threshold in units of cell size
 * opts.separate: separation speed applied along the normal
 * opts.light: only the rebuild the next cut needs (the caller rebuilds fully
 *   before the body is stepped or drawn)
 * opts.glueAll: split the tets along it but glue it all back - the seam a
 *   tear will open later (see unglue); its vertices come back as .seam
 * Returns { changed, pieces: [pieceIds touched], sideOfVertex }
 */
export function cutBody(sb, field, opts = {}) {
  const tau = opts.snap ?? 0.32;
  const sep = opts.separate ?? 0;
  const anchors = opts.anchors || [];
  const nV0 = sb.nV, nT0 = sb.nT;
  const hEdge = sb.hCell;
  const region = field.inRegion || null;
  const nrm = [0, 0, 0];

  // signed values
  const s = new Float64Array(nV0);
  for (let i = 0; i < nV0; i++) {
    if (!sb.alive[i]) continue;
    const o = i * 3;
    s[i] = field.value(sb.x[o], sb.x[o + 1], sb.x[o + 2]);
  }

  // --- affected pieces: a straddling tet with its crossing in region
  const affected = new Uint8Array(sb.pieces.length);
  let anyAffected = false;
  {
    const T = sb.T, x = sb.x;
    for (let t = 0; t < nT0; t++) {
      if (sb.vol0[t] <= 0) continue;
      const pc = sb.tPiece[t];
      if (affected[pc]) continue;
      for (const [la, lb] of TET_EDGES) {
        const a = T[t * 4 + la], b = T[t * 4 + lb];
        const sa = s[a], sbv = s[b];
        if ((sa > 0 && sbv < 0) || (sa < 0 && sbv > 0) || sa === 0 || sbv === 0) {
          const tt = sa === sbv ? 0.5 : sa / (sa - sbv);
          const px = x[a * 3] + (x[b * 3] - x[a * 3]) * tt;
          const py = x[a * 3 + 1] + (x[b * 3 + 1] - x[a * 3 + 1]) * tt;
          const pz = x[a * 3 + 2] + (x[b * 3 + 2] - x[a * 3 + 2]) * tt;
          if (!region || region(px, py, pz)) {
            affected[pc] = 1;
            anyAffected = true;
            break;
          }
        }
      }
    }
  }
  if (opts.pieces) for (let k = 0; k < affected.length; k++) if (!opts.pieces.includes(k)) affected[k] = 0;
  if (!anyAffected) return { changed: false };

  captureAnchors(sb, anchors);

  // --- snapping (reduces slivers and makes cut faces flat)
  {
    const thr = tau * hEdge;
    const cand = [];
    for (let i = 0; i < nV0; i++) {
      if (!sb.alive[i] || !affected[sb.vPiece[i]]) continue;
      if (s[i] !== 0 && Math.abs(s[i]) < thr) cand.push(i);
    }
    cand.sort((a, b) => Math.abs(s[a]) - Math.abs(s[b]));
    const { x, px, X, T, vtStart, vtList } = sb;
    for (const i of cand) {
      const o = i * 3;
      field.normal(x[o], x[o + 1], x[o + 2], nrm);
      const dx = -s[i] * nrm[0], dy = -s[i] * nrm[1], dz = -s[i] * nrm[2];
      // deformation gradient of the largest incident tet: dX = Dm * Ds^-1 * dx
      let bestT = -1, bestV = 0;
      for (let k = vtStart[i]; k < vtStart[i + 1]; k++) {
        const t = vtList[k];
        if (sb.vol0[t] > bestV) {
          bestV = sb.vol0[t];
          bestT = t;
        }
      }
      if (bestT < 0) continue;
      const a = T[bestT * 4], b = T[bestT * 4 + 1], c = T[bestT * 4 + 2], d = T[bestT * 4 + 3];
      const d00 = x[b * 3] - x[a * 3], d10 = x[b * 3 + 1] - x[a * 3 + 1], d20 = x[b * 3 + 2] - x[a * 3 + 2];
      const d01 = x[c * 3] - x[a * 3], d11 = x[c * 3 + 1] - x[a * 3 + 1], d21 = x[c * 3 + 2] - x[a * 3 + 2];
      const d02 = x[d * 3] - x[a * 3], d12 = x[d * 3 + 1] - x[a * 3 + 1], d22 = x[d * 3 + 2] - x[a * 3 + 2];
      const det = d00 * (d11 * d22 - d12 * d21) - d01 * (d10 * d22 - d12 * d20) + d02 * (d10 * d21 - d11 * d20);
      if (Math.abs(det) < 1e-12) continue;
      const id = 1 / det;
      // y = Ds^-1 dx
      const y0 = ((d11 * d22 - d12 * d21) * dx + (d02 * d21 - d01 * d22) * dy + (d01 * d12 - d02 * d11) * dz) * id;
      const y1 = ((d12 * d20 - d10 * d22) * dx + (d00 * d22 - d02 * d20) * dy + (d02 * d10 - d00 * d12) * dz) * id;
      const y2 = ((d10 * d21 - d11 * d20) * dx + (d01 * d20 - d00 * d21) * dy + (d00 * d11 - d01 * d10) * dz) * id;
      const m00 = X[b * 3] - X[a * 3], m10 = X[b * 3 + 1] - X[a * 3 + 1], m20 = X[b * 3 + 2] - X[a * 3 + 2];
      const m01 = X[c * 3] - X[a * 3], m11 = X[c * 3 + 1] - X[a * 3 + 1], m21 = X[c * 3 + 2] - X[a * 3 + 2];
      const m02 = X[d * 3] - X[a * 3], m12 = X[d * 3 + 1] - X[a * 3 + 1], m22 = X[d * 3 + 2] - X[a * 3 + 2];
      const dX = m00 * y0 + m01 * y1 + m02 * y2, dY = m10 * y0 + m11 * y1 + m12 * y2, dZ = m20 * y0 + m21 * y1 + m22 * y2;
      // validate incident tets
      const oldV = [];
      for (let k = vtStart[i]; k < vtStart[i + 1]; k++) {
        const t = vtList[k];
        oldV.push(restVolume(X, T[t * 4], T[t * 4 + 1], T[t * 4 + 2], T[t * 4 + 3]));
      }
      X[o] += dX; X[o + 1] += dY; X[o + 2] += dZ;
      let ok = true;
      for (let k = vtStart[i], q = 0; k < vtStart[i + 1]; k++, q++) {
        const t = vtList[k];
        const nv = restVolume(X, T[t * 4], T[t * 4 + 1], T[t * 4 + 2], T[t * 4 + 3]);
        if (nv < 0.3 * oldV[q] || nv <= 1e-12) {
          ok = false;
          break;
        }
      }
      if (!ok) {
        X[o] -= dX; X[o + 1] -= dY; X[o + 2] -= dZ;
        continue;
      }
      x[o] += dx; x[o + 1] += dy; x[o + 2] += dz;
      px[o] += dx; px[o + 1] += dy; px[o + 2] += dz;
      s[i] = 0;
    }
  }

  // --- classify
  const eps = 1e-10;
  const sign = new Int8Array(nV0);
  for (let i = 0; i < nV0; i++) sign[i] = s[i] > eps ? 1 : s[i] < -eps ? -1 : 0;

  const T = sb.T;
  const tetSide = new Int8Array(nT0); // 1, -1, 2 = split, 0 = untouched
  const zUse = new Uint8Array(nV0); // bit0: plus side, bit1: minus side
  for (let t = 0; t < nT0; t++) {
    if (!affected[sb.tPiece[t]]) continue;
    let pos = 0, neg = 0;
    for (let k = 0; k < 4; k++) {
      const sg = sign[T[t * 4 + k]];
      if (sg > 0) pos++;
      else if (sg < 0) neg++;
    }
    const side = pos && neg ? 2 : pos ? 1 : neg ? -1 : 0;
    tetSide[t] = side;
    for (let k = 0; k < 4; k++) {
      const v = T[t * 4 + k];
      if (sign[v] !== 0) continue;
      if (side === 2) zUse[v] |= 3;
      else if (side === 1) zUse[v] |= 1;
      else if (side === -1) zUse[v] |= 2;
    }
  }

  // --- new vertices
  const newVerts = []; // [x,y,z,X,Y,Z,vx,vy,vz,temp]
  const newDust = []; // (and the powder on each)
  const newCoat = []; // (and what it is: SoftBody.coat's five)
  const newCube = []; // (and each one's cube)
  const newTag = []; // (and its tag - a gel gun's blob: see SoftBody.vTag)
  let nextId = nV0;
  const canon = new Map(); // minus copy -> plus id
  const vSide = new Map(); // new vertex -> side
  const glue = []; // [plusId, minusId, x, y, z]
  const zDup = new Int32Array(nV0).fill(-1);
  const { x, X, v } = sb;
  for (let i = 0; i < nV0; i++) {
    if (sign[i] !== 0 || zUse[i] !== 3) continue;
    const o = i * 3;
    const id = nextId++;
    newVerts.push(x[o], x[o + 1], x[o + 2], X[o], X[o + 1], X[o + 2], v[o], v[o + 1], v[o + 2], sb.temp[i]);
    newDust.push(sb.dust[i]);
    for (let c = 0; c < 5; c++) newCoat.push(sb.coat[i * 5 + c]);
    newCube.push(sb.vCube[i]);
    newTag.push(sb.vTag[i]);
    zDup[i] = id;
    canon.set(id, i);
    vSide.set(id, -1);
    glue.push(i, id, x[o], x[o + 1], x[o + 2]);
  }
  const edgeMap = new Map(); // key -> [plusId, minusId]
  const K = nV0 + 1;
  const edgeVert = (a, b, side) => {
    const lo = a < b ? a : b, hi = a < b ? b : a;
    const key = lo * K + hi;
    let e = edgeMap.get(key);
    if (!e) {
      const t = s[lo] / (s[lo] - s[hi]);
      const lo3 = lo * 3, hi3 = hi * 3;
      const ix = x[lo3] + (x[hi3] - x[lo3]) * t, iy = x[lo3 + 1] + (x[hi3 + 1] - x[lo3 + 1]) * t, iz = x[lo3 + 2] + (x[hi3 + 2] - x[lo3 + 2]) * t;
      const IX = X[lo3] + (X[hi3] - X[lo3]) * t, IY = X[lo3 + 1] + (X[hi3 + 1] - X[lo3 + 1]) * t, IZ = X[lo3 + 2] + (X[hi3 + 2] - X[lo3 + 2]) * t;
      const vx = v[lo3] + (v[hi3] - v[lo3]) * t, vy = v[lo3 + 1] + (v[hi3 + 1] - v[lo3 + 1]) * t, vz = v[lo3 + 2] + (v[hi3 + 2] - v[lo3 + 2]) * t;
      const tp = sb.temp[lo] + (sb.temp[hi] - sb.temp[lo]) * t;
      const pid = nextId++;
      const mid = nextId++;
      newVerts.push(ix, iy, iz, IX, IY, IZ, vx, vy, vz, tp);
      newVerts.push(ix, iy, iz, IX, IY, IZ, vx, vy, vz, tp);
      // (flour along a surface edge carries on; inside, there's none)
      const dp = sb.dust[lo] + (sb.dust[hi] - sb.dust[lo]) * t;
      newDust.push(dp, dp);
      for (let q = 0; q < 2; q++) for (let c = 0; c < 5; c++) newCoat.push(sb.coat[lo * 5 + c] + (sb.coat[hi * 5 + c] - sb.coat[lo * 5 + c]) * t);
      newCube.push(sb.vCube[lo], sb.vCube[lo]);
      newTag.push(sb.vTag[lo], sb.vTag[lo]);
      canon.set(mid, pid);
      vSide.set(pid, 1);
      vSide.set(mid, -1);
      glue.push(pid, mid, ix, iy, iz);
      e = [pid, mid];
      edgeMap.set(key, e);
    }
    return side > 0 ? e[0] : e[1];
  };
  const posOf = (id, out) => {
    if (id < nV0) {
      out[0] = x[id * 3]; out[1] = x[id * 3 + 1]; out[2] = x[id * 3 + 2];
    } else {
      const o = (id - nV0) * 10;
      out[0] = newVerts[o]; out[1] = newVerts[o + 1]; out[2] = newVerts[o + 2];
    }
    return out;
  };
  const restOf = (id) => {
    if (id < nV0) return [X[id * 3], X[id * 3 + 1], X[id * 3 + 2]];
    const o = (id - nV0) * 10;
    return [newVerts[o + 3], newVerts[o + 4], newVerts[o + 5]];
  };
  const canonOf = (id) => (canon.has(id) ? canon.get(id) : id);

  // --- new tet list
  const newT = [];
  const newVS = [];
  const newMu = [];
  const pushTet = (a, b, c, d, parent) => {
    const ra = restOf(a), rb = restOf(b), rc = restOf(c), rd = restOf(d);
    const vol = det3(rb[0] - ra[0], rb[1] - ra[1], rb[2] - ra[2], rc[0] - ra[0], rc[1] - ra[1], rc[2] - ra[2], rd[0] - ra[0], rd[1] - ra[1], rd[2] - ra[2]) / 6;
    if (Math.abs(vol) < 1e-11) return;
    if (vol > 0) newT.push(a, b, c, d);
    else newT.push(a, b, d, c);
    newVS.push(sb.tVS[parent]);
    newMu.push(sb.tMu[parent]);
  };

  for (let t = 0; t < nT0; t++) {
    const side = tetSide[t];
    const o = t * 4;
    if (side === 0 || side === 1) {
      newT.push(T[o], T[o + 1], T[o + 2], T[o + 3]);
      newVS.push(sb.tVS[t]);
      newMu.push(sb.tMu[t]);
      continue;
    }
    if (side === -1) {
      for (let k = 0; k < 4; k++) {
        const vtx = T[o + k];
        newT.push(sign[vtx] === 0 && zDup[vtx] >= 0 ? zDup[vtx] : vtx);
      }
      newVS.push(sb.tVS[t]);
      newMu.push(sb.tMu[t]);
      continue;
    }
    // split tet
    const tv = [T[o], T[o + 1], T[o + 2], T[o + 3]];
    const sg = [sign[tv[0]], sign[tv[1]], sign[tv[2]], sign[tv[3]]];
    for (const S of [1, -1]) {
      const mapV = (l) => (sg[l] === 0 ? (S < 0 && zDup[tv[l]] >= 0 ? zDup[tv[l]] : tv[l]) : tv[l]);
      const polys = [];
      for (const f of FACES) {
        const poly = [];
        for (let e = 0; e < 3; e++) {
          const la = f[e], lb = f[(e + 1) % 3];
          const sa = sg[la] * S, sbb = sg[lb] * S;
          if (sa >= 0) poly.push(mapV(la));
          if ((sa > 0 && sbb < 0) || (sa < 0 && sbb > 0)) poly.push(edgeVert(tv[la], tv[lb], S));
        }
        if (poly.length >= 3) polys.push(poly);
      }
      const cut = [];
      for (let l = 0; l < 4; l++) if (sg[l] === 0) cut.push(mapV(l));
      for (const [la, lb] of TET_EDGES) if (sg[la] * sg[lb] < 0) cut.push(edgeVert(tv[la], tv[lb], S));
      if (cut.length >= 3) {
        // order around centroid in the cut plane
        let cx = 0, cy = 0, cz = 0;
        const P = cut.map((id) => posOf(id, [0, 0, 0]));
        for (const p of P) { cx += p[0]; cy += p[1]; cz += p[2]; }
        cx /= P.length; cy /= P.length; cz /= P.length;
        field.normal(cx, cy, cz, nrm);
        let ux = 1, uy = 0, uz = 0;
        if (Math.abs(nrm[0]) > 0.8) { ux = 0; uy = 1; }
        // u = normalize(ref - n (n.ref)), w = n x u
        const dp = ux * nrm[0] + uy * nrm[1] + uz * nrm[2];
        ux -= nrm[0] * dp; uy -= nrm[1] * dp; uz -= nrm[2] * dp;
        const ul = Math.hypot(ux, uy, uz);
        ux /= ul; uy /= ul; uz /= ul;
        const wx = nrm[1] * uz - nrm[2] * uy, wy = nrm[2] * ux - nrm[0] * uz, wz = nrm[0] * uy - nrm[1] * ux;
        const ang = P.map((p) => Math.atan2((p[0] - cx) * wx + (p[1] - cy) * wy + (p[2] - cz) * wz, (p[0] - cx) * ux + (p[1] - cy) * uy + (p[2] - cz) * uz));
        const idx = cut.map((_, k) => k).sort((a, b) => ang[a] - ang[b]);
        polys.push(idx.map((k) => cut[k]));
      }
      // tetrahedralize the convex polyhedron from its canonical-min vertex
      let apex = -1, apexC = Infinity;
      for (const poly of polys) for (const id of poly) {
        const c = canonOf(id);
        if (c < apexC) { apexC = c; apex = id; }
      }
      for (const poly of polys) {
        if (poly.includes(apex)) continue;
        let m = 0, mc = Infinity;
        for (let k = 0; k < poly.length; k++) {
          const c = canonOf(poly[k]);
          if (c < mc) { mc = c; m = k; }
        }
        const q = [];
        for (let k = 0; k < poly.length; k++) q.push(poly[(m + k) % poly.length]);
        for (let k = 1; k + 1 < q.length; k++) pushTet(apex, q[0], q[k], q[k + 1], t);
      }
    }
  }

  // --- re-glue outside the region (partial cuts) - or everywhere (a seam)
  const remap = new Map();
  if (region || opts.glueAll) {
    for (let g = 0; g < glue.length; g += 5) {
      if (opts.glueAll || !region(glue[g + 2], glue[g + 3], glue[g + 4])) remap.set(glue[g + 1], glue[g]);
    }
    if (remap.size) for (let k = 0; k < newT.length; k++) {
      const r = remap.get(newT[k]);
      if (r !== undefined) newT[k] = r;
    }
  }

  // --- a partial cut leaves the piece joined to itself across a slit: give
  // the slit a blade's width - in the rest shape too - so its two sides
  // don't sit pressed together (in contact) for ever. (Snapping keeps the
  // nearest vertices ~0.3 cell from the cut, so this can't turn a tet over.)
  if (remap.size && !opts.glueAll) {
    const kh = (opts.kerf ?? 0.035 * hEdge) / 2;
    for (let g = 0; g < glue.length; g += 5) {
      const plus = glue[g], minus = glue[g + 1];
      if (remap.has(minus)) continue;
      field.normal(glue[g + 2], glue[g + 3], glue[g + 4], nrm);
      for (let e = 0; e < 2; e++) {
        const id = e ? minus : plus, d = e ? -kh : kh;
        if (id < nV0) {
          const o = id * 3;
          for (let c = 0; c < 3; c++) {
            x[o + c] += nrm[c] * d;
            X[o + c] += nrm[c] * d;
          }
        } else {
          const o = (id - nV0) * 10;
          for (let c = 0; c < 3; c++) {
            newVerts[o + c] += nrm[c] * d;
            newVerts[o + 3 + c] += nrm[c] * d;
          }
        }
      }
    }
  }

  // --- commit
  const oldPiece = sb.vPiece.slice(0, nV0);
  const nNew = newVerts.length / 10;
  for (let k = 0; k < nNew; k++) {
    const o = k * 10;
    const id = sb.addVertex(newVerts[o], newVerts[o + 1], newVerts[o + 2], newVerts[o + 3], newVerts[o + 4], newVerts[o + 5],
      newVerts[o + 6], newVerts[o + 7], newVerts[o + 8], newVerts[o + 9], newCube[k], newTag[k]);
    sb.dust[id] = newDust[k] || 0;
    for (let c = 0; c < 5; c++) sb.coat[id * 5 + c] = newCoat[k * 5 + c] || 0;
  }
  const nT = newT.length / 4;
  sb.ensureT(nT);
  sb.T.set(newT);
  sb.nT = nT;
  for (let t = 0; t < nT; t++) {
    sb.tVS[t] = newVS[t];
    sb.tMu[t] = newMu[t];
  }
  // (opts.light: another cut follows at once - see rebuildLight)
  if (opts.light) sb.rebuildLight();
  else sb.rebuild();
  relocateAnchors(sb, anchors);

  // --- side of every vertex, separation kick
  const side = new Int8Array(sb.nV);
  for (let i = 0; i < nV0; i++) side[i] = sign[i];
  for (const [id, sd] of vSide) side[id] = remap.has(id) ? 0 : sd;
  for (let i = 0; i < nV0; i++) if (zDup[i] >= 0 && !remap.has(zDup[i])) side[i] = 1;
  if (sep) {
    const vv = sb.v, xx = sb.x;
    for (let i = 0; i < sb.nV; i++) {
      if (!sb.alive[i]) continue;
      if (i < nV0 && !affected[oldPiece[i]]) continue;
      const sd = side[i];
      if (!sd) continue;
      const o = i * 3;
      field.normal(xx[o], xx[o + 1], xx[o + 2], nrm);
      const f = sep * sd;
      vv[o] += nrm[0] * f; vv[o + 1] += nrm[1] * f; vv[o + 2] += nrm[2] * f;
    }
  }
  const seam = [];
  if (opts.glueAll) for (let g = 0; g < glue.length; g += 5) seam.push(glue[g]);
  return { changed: true, side, newVerts: nNew, nT, seam };
}

// Planar field helper
export function planeField(nx, ny, nz, d, inRegion = null) {
  return {
    value: (x, y, z) => nx * x + ny * y + nz * z - d,
    normal: (x, y, z, out) => { out[0] = nx; out[1] = ny; out[2] = nz; return out; },
    inRegion,
  };
}

export function sphereField(cx, cy, cz, r) {
  return {
    value: (x, y, z) => Math.hypot(x - cx, y - cy, z - cz) - r,
    normal: (x, y, z, out) => {
      const dx = x - cx, dy = y - cy, dz = z - cz;
      const l = Math.hypot(dx, dy, dz) || 1;
      out[0] = dx / l; out[1] = dy / l; out[2] = dz / l;
      return out;
    },
    inRegion: null,
  };
}

// Fracture along element boundaries: tets get labels; vertices shared by
// tets with different labels are duplicated so the clusters separate.
// A box centred at (cx, cy, cz), turned by the quaternion q = [x, y, z, w],
// half-sizes hx, hy, hz, its edges rounded by r (signed distance).
export function boxField(cx, cy, cz, q, hx, hy, hz, r = 0) {
  const [x, y, z, w] = q;
  // its axes in the world (the rotation's columns)
  const ax = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
  const ay = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
  const az = [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
  const ix = hx - r, iy = hy - r, iz = hz - r;
  const value = (px, py, pz) => {
    const dx = px - cx, dy = py - cy, dz = pz - cz;
    const qx = Math.abs(dx * ax[0] + dy * ax[1] + dz * ax[2]) - ix;
    const qy = Math.abs(dx * ay[0] + dy * ay[1] + dz * ay[2]) - iy;
    const qz = Math.abs(dx * az[0] + dy * az[1] + dz * az[2]) - iz;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
  };
  return {
    value,
    normal: (px, py, pz, out) => {
      const e = 1e-4;
      const gx = value(px + e, py, pz) - value(px - e, py, pz);
      const gy = value(px, py + e, pz) - value(px, py - e, pz);
      const gz = value(px, py, pz + e) - value(px, py, pz - e);
      const l = Math.hypot(gx, gy, gz) || 1;
      out[0] = gx / l; out[1] = gy / l; out[2] = gz / l;
      return out;
    },
    inRegion: null,
  };
}

export function separateClusters(sb, labels, anchors = []) {
  captureAnchors(sb, anchors);
  const { T } = sb;
  tidyLabels(sb, labels);
  const nV0 = sb.nV;
  const copies = new Map(); // vertex*1024+label -> id
  const firstLabel = new Int32Array(nV0).fill(-2147483648);
  for (let t = 0; t < sb.nT; t++) {
    const L = labels[t];
    for (let k = 0; k < 4; k++) {
      const i = T[t * 4 + k];
      if (firstLabel[i] === -2147483648) {
        firstLabel[i] = L;
        continue;
      }
      if (firstLabel[i] === L) continue;
      const key = i * 1024 + (L & 1023);
      let id = copies.get(key);
      if (id === undefined) {
        const o = i * 3;
        id = sb.addVertex(sb.x[o], sb.x[o + 1], sb.x[o + 2], sb.X[o], sb.X[o + 1], sb.X[o + 2], sb.v[o], sb.v[o + 1], sb.v[o + 2], sb.temp[i], sb.vCube[i], sb.vTag[i]);
        sb.dust[id] = sb.dust[i];
        sb.coat.copyWithin(id * 5, i * 5, i * 5 + 5);
        copies.set(key, id);
      }
      sb.T[t * 4 + k] = id;
    }
  }
  sb.rebuild();
  relocateAnchors(sb, anchors);
  return copies.size;
}

// Smooth a tet labelling in place: a tet that hangs off its cluster by one
// face (or none) joins the cluster most of its face-neighbours belong to.
// Such fins and loose tets make shards that ring and flap.
function tidyLabels(sb, labels) {
  const { T } = sb;
  const nT = sb.nT, K = sb.nV + 1;
  const nb = new Int32Array(nT * 4).fill(-1);
  const map = new Map();
  for (let t = 0; t < nT; t++) {
    for (let f = 0; f < 4; f++) {
      let a = T[t * 4 + FACES[f][0]], b = T[t * 4 + FACES[f][1]], c = T[t * 4 + FACES[f][2]], tt;
      if (a > b) { tt = a; a = b; b = tt; }
      if (b > c) { tt = b; b = c; c = tt; }
      if (a > b) { tt = a; a = b; b = tt; }
      const key = (a * K + b) * K + c;
      const o = map.get(key);
      if (o === undefined) map.set(key, t * 4 + f);
      else {
        nb[t * 4 + f] = o >> 2;
        nb[o] = t;
        map.delete(key);
      }
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    let changed = 0;
    for (let t = 0; t < nT; t++) {
      const L = labels[t];
      let same = 0, best = L, bestN = 0;
      for (let f = 0; f < 4; f++) {
        const u = nb[t * 4 + f];
        if (u < 0) continue;
        const M = labels[u];
        if (M === L) {
          same++;
          continue;
        }
        let n = 0;
        for (let g = 0; g < 4; g++) {
          const w = nb[t * 4 + g];
          if (w >= 0 && labels[w] === M) n++;
        }
        if (n > bestN) {
          bestN = n;
          best = M;
        }
      }
      if (same <= 1 && bestN > same) {
        labels[t] = best;
        changed++;
      }
    }
    if (!changed) break;
  }
}

// Remove tets matching predicate(t, cx, cy, cz). Returns removed centroids.
// Tear along existing faces: each of verts is split in two - the tets
// marked in plus (by tet index) take the copy, the others keep it - then the
// body is rebuilt. No tet is cut, so a tear can run across a piece this way a
// few vertices at a time, the slit opening as it goes (cutting one plane over
// and over re-split its tets each time: millions). A vertex with no plus tet,
// or no other, isn't on the seam: left be. Returns how many were split.
export function unglue(sb, verts, plus, pairs = null) {
  const T = sb.T, vtS = sb.vtStart, vtL = sb.vtList;
  let n = 0;
  for (const i of verts) {
    let np = 0, nm = 0;
    for (let e = vtS[i]; e < vtS[i + 1]; e++) {
      const t = vtL[e];
      if (sb.vol0[t] <= 0) continue;
      if (plus[t]) np++;
      else nm++;
    }
    if (!np || !nm) continue;
    const o = i * 3;
    const j = sb.addVertex(sb.x[o], sb.x[o + 1], sb.x[o + 2], sb.X[o], sb.X[o + 1], sb.X[o + 2], sb.v[o], sb.v[o + 1], sb.v[o + 2], sb.temp[i], sb.vCube[i], sb.vTag[i]);
    sb.melt[j] = sb.melt[i];
    sb.glow[j] = sb.glow[i];
    sb.dust[j] = sb.dust[i];
    sb.coat.copyWithin(j * 5, i * 5, i * 5 + 5);
    for (let e = vtS[i]; e < vtS[i + 1]; e++) {
      const t = vtL[e];
      if (!plus[t]) continue;
      for (let k = 0; k < 4; k++) if (T[t * 4 + k] === i) T[t * 4 + k] = j;
    }
    if (pairs) pairs.push(i, j);
    n++;
  }
  if (n) sb.rebuild();
  return n;
}

export function removeTets(sb, pred, anchors = []) {
  captureAnchors(sb, anchors);
  const { T, x } = sb;
  const keep = [];
  const vs = [], mu = [];
  const removed = [];
  for (let t = 0; t < sb.nT; t++) {
    const o = t * 4;
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 4; k++) {
      const i = T[o + k] * 3;
      cx += x[i]; cy += x[i + 1]; cz += x[i + 2];
    }
    cx /= 4; cy /= 4; cz /= 4;
    if (pred(t, cx, cy, cz)) {
      removed.push(cx, cy, cz, sb.vol0[t]);
      continue;
    }
    keep.push(T[o], T[o + 1], T[o + 2], T[o + 3]);
    vs.push(sb.tVS[t]);
    mu.push(sb.tMu[t]);
  }
  if (!removed.length) return removed;
  sb.T.set(keep);
  sb.nT = keep.length / 4;
  for (let t = 0; t < sb.nT; t++) {
    sb.tVS[t] = vs[t];
    sb.tMu[t] = mu[t];
  }
  sb.rebuild();
  relocateAnchors(sb, anchors);
  return removed;
}

// Remove pieces smaller than minVolume (wafer-thin crumbs left by fracture).
// Returns [cx, cy, cz, volume, ...] for each removed piece.
export function removeSmallPieces(sb, minVolume, anchors = []) {
  const small = new Set();
  const out = [];
  for (const pc of sb.pieces) {
    if (pc.volume >= minVolume) continue;
    small.add(pc.id);
    let cx = 0, cy = 0, cz = 0;
    for (const i of pc.verts) {
      cx += sb.x[i * 3]; cy += sb.x[i * 3 + 1]; cz += sb.x[i * 3 + 2];
    }
    const n = pc.verts.length || 1;
    out.push(cx / n, cy / n, cz / n, pc.volume);
  }
  if (!small.size) return out;
  removeTets(sb, (t) => small.has(sb.tPiece[t]), anchors);
  return out;
}
