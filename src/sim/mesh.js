// Rounded-cube tetrahedral mesh generator.
// A cube of side `size` is split into res^3 cells, each cell into 5 tets with
// alternating parity so neighbouring cells share face diagonals. Boundary
// vertices are pushed onto a rounded box of radius `bevel`.

// The cube's rounding: a grid point outside the core box (half-size
// half - bevel) is pulled in along its offset from that box until its
// largest coordinate offset is its distance - the corners and edges round
// off to radius `bevel`. Written to out[o..o+2]. unbevelPoint undoes it
// exactly (an edge style change morphs between roundings through it).
export function bevelPoint(x, y, z, half, bevel, out, o = 0) {
  const a = half - bevel;
  if (bevel > 0) {
    const qx = Math.max(-a, Math.min(a, x)), qy = Math.max(-a, Math.min(a, y)), qz = Math.max(-a, Math.min(a, z));
    const dx = x - qx, dy = y - qy, dz = z - qz;
    const m = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    if (m > 1e-12) {
      const s = m / Math.sqrt(dx * dx + dy * dy + dz * dz);
      x = qx + dx * s; y = qy + dy * s; z = qz + dz * s;
    }
  }
  out[o] = x; out[o + 1] = y; out[o + 2] = z;
}
export function unbevelPoint(x, y, z, half, bevel, out, o = 0) {
  const a = half - bevel;
  if (bevel > 0) {
    const qx = Math.max(-a, Math.min(a, x)), qy = Math.max(-a, Math.min(a, y)), qz = Math.max(-a, Math.min(a, z));
    const dx = x - qx, dy = y - qy, dz = z - qz;
    const m = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    if (m > 1e-12) {
      const s = Math.sqrt(dx * dx + dy * dy + dz * dz) / m;
      x = qx + dx * s; y = qy + dy * s; z = qz + dz * s;
    }
  }
  out[o] = x; out[o + 1] = y; out[o + 2] = z;
}

export function buildCubeMesh(res = 12, size = 1, bevel = 0.09, shape = null) {
  const n1 = res + 1;
  const h = size / res;
  const half = size / 2;
  const pos = new Float64Array(n1 * n1 * n1 * 3);
  const id = (i, j, k) => (i * n1 + j) * n1 + k;

  for (let i = 0; i < n1; i++) {
    for (let j = 0; j < n1; j++) {
      for (let k = 0; k < n1; k++) {
        bevelPoint(-half + i * h, -half + j * h, -half + k * h, half, bevel, pos, id(i, j, k) * 3);
      }
    }
  }
  // (its own shape. Dished or bulged: every point out or in from the middle
  // in proportion - the plain box's skin lands on its skin, and the jelly
  // inside follows, squeezed or stretched no more than the shape is. Only
  // scalloped: the skin straight out onto its scallops, and the layer under
  // it after it, less and less, 1.5 cells in - that keeps each point where it
  // was along its edge, so the scallops' points stay on the render's steps)
  if (shape && shape.bow) {
    for (let v = 0; v < n1 * n1 * n1; v++) {
      const o = v * 3, x = pos[o], y = pos[o + 1], z = pos[o + 2], l = Math.sqrt(x * x + y * y + z * z);
      if (l < 1e-9) continue;
      const dx = x / l, dy = y / l, dz = z / l;
      const k = shapeRadius(dx, dy, dz, half, bevel, shape) / shapeRadius(dx, dy, dz, half, bevel, null);
      pos[o] = x * k; pos[o + 1] = y * k; pos[o + 2] = z * k;
    }
  } else if (shape && shape.A > 0) {
    const nb = [0, 0, 0], reach = 1.5 * h;
    for (let v = 0; v < n1 * n1 * n1; v++) {
      const o = v * 3, x = pos[o], y = pos[o + 1], z = pos[o + 2];
      const depth = -roundBoxSDF(x, y, z, half, bevel);
      if (depth > reach) continue;
      roundBoxNormal(x, y, z, half, bevel, nb);
      const dd = Math.max(0, depth), w = 1 - dd / reach;
      const t = lobeOut(x + nb[0] * dd, y + nb[1] * dd, z + nb[2] * dd, nb[0], nb[1], nb[2], half, bevel, shape);
      pos[o] = x + nb[0] * t * w; pos[o + 1] = y + nb[1] * t * w; pos[o + 2] = z + nb[2] * t * w;
    }
  }

  const tets = [];
  const vol = (t) => {
    const [p, q, r, s] = t.map((v) => v * 3);
    const ax = pos[q] - pos[p], ay = pos[q + 1] - pos[p + 1], az = pos[q + 2] - pos[p + 2];
    const bx = pos[r] - pos[p], by = pos[r + 1] - pos[p + 1], bz = pos[r + 2] - pos[p + 2];
    const cx = pos[s] - pos[p], cy = pos[s + 1] - pos[p + 1], cz = pos[s + 2] - pos[p + 2];
    return ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  };
  const push = (t) => {
    if (vol(t) < 0) { const tmp = t[2]; t[2] = t[3]; t[3] = tmp; }
    tets.push(t[0], t[1], t[2], t[3]);
  };

  for (let i = 0; i < res; i++) {
    for (let j = 0; j < res; j++) {
      for (let k = 0; k < res; k++) {
        const p000 = id(i, j, k), p100 = id(i + 1, j, k), p010 = id(i, j + 1, k), p110 = id(i + 1, j + 1, k);
        const p001 = id(i, j, k + 1), p101 = id(i + 1, j, k + 1), p011 = id(i, j + 1, k + 1), p111 = id(i + 1, j + 1, k + 1);
        if ((i + j + k) % 2 === 0) {
          push([p000, p100, p010, p001]);
          push([p110, p100, p010, p111]);
          push([p101, p100, p001, p111]);
          push([p011, p010, p001, p111]);
          push([p100, p010, p001, p111]);
        } else {
          push([p100, p000, p110, p101]);
          push([p010, p000, p110, p011]);
          push([p001, p000, p101, p011]);
          push([p111, p110, p101, p011]);
          push([p000, p110, p101, p011]);
        }
      }
    }
  }
  return { pos, tets: Int32Array.from(tets), nV: n1 * n1 * n1, nT: tets.length / 4, h };
}

// Signed distance to the rounded box the mesh was built on (rest space).
export function roundBoxSDF(x, y, z, half, bevel) {
  const b = half - bevel;
  const qx = Math.abs(x) - b, qy = Math.abs(y) - b, qz = Math.abs(z) - b;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - bevel;
}

// A cube's own shape, past its rounding (app.js shapeOf): { bow, A, m, d } -
// or null, the plain rounded box.
// - bow: its faces dished in (< 0) or bulged out (> 0): a face's middle that
//   far, its edges' middles half that, its corners where they were - so,
//   dished, a face seen square on is pinched in at every side, its corners
//   standing out (the Faces slider).
// - A, m, d: its edges' scallops (the scalloped trim) - a crimp all along
//   every edge, a small round scallop a mesh cell or so long, standing out A,
//   a soft point between each and the next: each edge's ridge moved straight
//   out along its diagonal by them, its cross-section kept (as crisp or as
//   round as the Edges setting makes it), so each is a little rib across the
//   edge, gone half a scallop onto the faces beside it. Each is m of the
//   render's finest steps d long (a quarter of a cell: SoftBody.shapeOf),
//   its points on them - so even ones that small are drawn evenly.
// As a shape: the rounded box, its inner box's extent along each axis
// moved by where a point is across the other two.
const bell = (t) => (t >= 1 ? 0 : (1 - t * t) * (1 - t * t));
// (one edge's scallops: 0..1 at s along it (-b..b) - round bumps P long,
// soft points between, at whole multiples of P from its middle; the end ones,
// whatever's left to the corners, smoothly down to nothing into them over
// their last half, so a corner, where three edges meet, is no pit)
function scallop(s, b, P) {
  const e = b - Math.abs(s);
  if (e <= 0) return 0;
  const S = Math.abs(s), K = Math.floor((b - 0.5 * P) / P), c = Math.max(0, K) * P;
  if (K >= 1 && S <= c) {
    const f = S / P, u = 2 * (f - Math.floor(f)) - 1;
    return Math.max(0, 1 - u * u);
  }
  // (an end one: from the last point - or the middle, or across the whole
  // edge if it's shorter than one - to the corner)
  const c0 = K >= 0 ? c : -b, L = b - c0, u = (2 * ((K >= 0 ? S : s) - c0)) / L - 1;
  const p = Math.max(0, 1 - u * u), h = K >= 0 ? L / 2 : L / 4;
  if (e >= h) return p;
  const t = e / h;
  return p * t * t * (3 - 2 * t);
}
// (how much of its edge's rise a face has, t in from it: all of it at the
// edge and beyond, none a width w in)
function rise(t, w) {
  if (t <= 0) return 1;
  if (t >= w) return 0;
  const k = t / w;
  return 1 - k * k * (3 - 2 * k);
}
// (a scallop's length, and how far onto a face its rib reaches)
const scallopLen = (shape, half) => (shape.d > 0 ? shape.m * shape.d : (shape.m * half) / 22);
const ribReach = (P, half) => Math.min(0.3 * half, 0.5 * P);
export function shapeSDF(x, y, z, half, bevel, shape) {
  if (!shape) return roundBoxSDF(x, y, z, half, bevel);
  const b = half - bevel, X = Math.abs(x), Y = Math.abs(y), Z = Math.abs(z);
  let ex = b, ey = b, ez = b;
  if (shape.bow) {
    // (no deeper than most of the way to the middle)
    const B = Math.max(-0.6 * b, shape.bow) / 2, cx = bell(X / b), cy = bell(Y / b), cz = bell(Z / b);
    ex += B * (cy + cz);
    ey += B * (cx + cz);
    ez += B * (cx + cy);
  }
  if (shape.A > 0) {
    const P = scallopLen(shape, half), w = ribReach(P, half), A = shape.A;
    const rX = rise(b - X, w), rY = rise(b - Y, w), rZ = rise(b - Z, w);
    // (each way's edges' scallops, where they reach: the x edges' - by its
    // x - push the y and z extents out, ...; where two edges meet, at a
    // corner, the two shared out between them, not added up)
    const sx = rY > 0 || rZ > 0 ? A * scallop(x, b, P) : 0;
    const sy = rX > 0 || rZ > 0 ? A * scallop(y, b, P) : 0;
    const sz = rX > 0 || rY > 0 ? A * scallop(z, b, P) : 0;
    ex += (sy * rZ + sz * rY) / (1 + rZ * rY);
    ey += (sx * rZ + sz * rX) / (1 + rZ * rX);
    ez += (sx * rY + sy * rX) / (1 + rY * rX);
  }
  const qx = X - ex, qy = Y - ey, qz = Z - ez;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - bevel;
}
// (where its skin is just the plain box's: a face's middle, out of its
// edges' scallops' reach, and its faces not bowed)
export function shapeFlat(x, y, z, half, bevel, shape) {
  if (!shape) return true;
  if (shape.bow) return false;
  const b = half - bevel - ribReach(scallopLen(shape, half), half), X = Math.abs(x), Y = Math.abs(y), Z = Math.abs(z);
  if (X >= Y && X >= Z) return Y <= b && Z <= b;
  if (Y >= Z) return X <= b && Z <= b;
  return X <= b && Y <= b;
}
// lobeOut: from a point of the plain rounded box's skin, how far straight
// out (along its normal there, nx ny nz) a scalloped one's skin is (not
// dished or bulged: its skin's all on or outside the plain box's) - found
// the Illinois way, like shapeRadius.
export function lobeOut(x, y, z, nx, ny, nz, half, bevel, shape) {
  if (!shape || !(shape.A > 0)) return 0;
  let lo = 0, hi = 2.5 * shape.A, side = 0;
  let flo = shapeSDF(x, y, z, half, bevel, shape), fhi = shapeSDF(x + nx * hi, y + ny * hi, z + nz * hi, half, bevel, shape);
  if (!(flo < 0) || !(fhi > 0)) return 0;
  for (let it = 0; it < 40; it++) {
    const c = (lo * fhi - hi * flo) / (fhi - flo), fc = shapeSDF(x + nx * c, y + ny * c, z + nz * c, half, bevel, shape);
    if (Math.abs(fc) < 1e-7 || hi - lo < 1e-7) return c;
    if (fc > 0) {
      (hi = c), (fhi = fc);
      if (side === -1) flo /= 2;
      side = -1;
    } else {
      (lo = c), (flo = fc);
      if (side === 1) fhi /= 2;
      side = 1;
    }
  }
  return (lo + hi) / 2;
}
// How far from its middle, along the unit (dx, dy, dz), its skin is (found
// the Illinois way - false position, the end that's stuck halved).
export function shapeRadius(dx, dy, dz, half, bevel, shape) {
  let lo = 0, hi = 2.2 * half, side = 0;
  let flo = shapeSDF(0, 0, 0, half, bevel, shape), fhi = shapeSDF(dx * hi, dy * hi, dz * hi, half, bevel, shape);
  if (!(flo < 0) || !(fhi > 0)) return half;
  for (let it = 0; it < 60; it++) {
    const c = (lo * fhi - hi * flo) / (fhi - flo), fc = shapeSDF(dx * c, dy * c, dz * c, half, bevel, shape);
    if (Math.abs(fc) < 1e-7 || hi - lo < 1e-7) return c;
    if (fc > 0) {
      (hi = c), (fhi = fc);
      if (side === -1) flo /= 2;
      side = -1;
    } else {
      (lo = c), (flo = fc);
      if (side === 1) fhi /= 2;
      side = 1;
    }
  }
  return (lo + hi) / 2;
}

export function shapeNormal(x, y, z, half, bevel, shape, out) {
  const e = 1e-4;
  const nx = shapeSDF(x + e, y, z, half, bevel, shape) - shapeSDF(x - e, y, z, half, bevel, shape);
  const ny = shapeSDF(x, y + e, z, half, bevel, shape) - shapeSDF(x, y - e, z, half, bevel, shape);
  const nz = shapeSDF(x, y, z + e, half, bevel, shape) - shapeSDF(x, y, z - e, half, bevel, shape);
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
  return out;
}

export function roundBoxNormal(x, y, z, half, bevel, out) {
  const e = 1e-4;
  const nx = roundBoxSDF(x + e, y, z, half, bevel) - roundBoxSDF(x - e, y, z, half, bevel);
  const ny = roundBoxSDF(x, y + e, z, half, bevel) - roundBoxSDF(x, y - e, z, half, bevel);
  const nz = roundBoxSDF(x, y, z + e, half, bevel) - roundBoxSDF(x, y, z - e, half, bevel);
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
  return out;
}
