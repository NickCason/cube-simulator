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

export function buildCubeMesh(res = 12, size = 1, bevel = 0.09, lobe = null) {
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
  // (scalloped: the skin out onto its lobes, and the layer under it after
  // it, less and less, 1.5 cells in - see shapeSDF)
  if (lobe && lobe.A > 0) {
    const nb = [0, 0, 0], q = [0, 0, 0], reach = 1.5 * h;
    for (let v = 0; v < n1 * n1 * n1; v++) {
      const o = v * 3, x = pos[o], y = pos[o + 1], z = pos[o + 2];
      const depth = -roundBoxSDF(x, y, z, half, bevel);
      if (depth > reach) continue;
      // (where it'd be on the skin, straight out; and where the skin is now, there)
      roundBoxNormal(x, y, z, half, bevel, nb);
      const dd = Math.max(0, depth);
      q[0] = x + nb[0] * dd; q[1] = y + nb[1] * dd; q[2] = z + nb[2] * dd;
      // (straight on out along it to the scalloped skin)
      const t = lobeOut(q[0], q[1], q[2], nb[0], nb[1], nb[2], half, bevel, lobe);
      const w = 1 - dd / reach;
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

// A scalloped cube (styles.js TRIMS 'scalloped'): along each of its twelve
// edges a row of scallops, each edge's ridge moved straight out (out along
// its diagonal, its cross-section kept: as crisp or as round as the Edges
// setting makes it) by a scallop's height, back in to meet the next at a
// point - so seen square on, a face's outline is scalloped, and the face
// rises a little way in from it to meet its ridge, with no crease.
// lobe: { A: how far a scallop stands out (square off each face beside it),
// P: about how long one is (a whole number of them to an edge), d: the
// render's finest spacing (their points on it) } - or null.
// As a shape: the rounded box, its inner box's extent along each axis
// pushed out near the edges that run along the other two.
// (one edge's scallops: 0..1 at s along it (-b..b) - each a half ellipse,
// a point between each and the next (C: where they are, see cusps) - and
// into a corner, where three edges meet, smoothly down to nothing over the
// last half of each end one, so the corner's no pit)
function scallop(s, b, C) {
  const e = b - Math.abs(s);
  if (e <= 0) return 0;
  const n = C.length - 1;
  let k = Math.floor(((s + b) / (2 * b)) * n);
  k = k < 0 ? 0 : k > n - 1 ? n - 1 : k;
  if (s < C[k] && k > 0) k--;
  else if (s >= C[k + 1] && k < n - 1) k++;
  const u = (2 * (s - C[k])) / (C[k + 1] - C[k]) - 1;
  const p = Math.sqrt(Math.max(0, 1 - u * u)), L = (C[1] + b) / 2;
  if (e >= L) return p;
  const t = e / L;
  return p * t * t * (3 - 2 * t);
}
// (an edge's scallops' ends, -b to b: a whole number of them, about P long,
// each point between two on the render's finest spacing d (lobe.d: see
// SoftBody.lobeOf) - so it's drawn as sharp as it is. Kept on the lobe.)
function cusps(lobe, b) {
  if (lobe._b === b) return lobe._C;
  const n = Math.max(2, Math.round((2 * b) / lobe.P)), q = (2 * b) / n, d = lobe.d || 0, C = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) {
    const x = -b + k * q;
    C[k] = k === 0 ? -b : k === n ? b : d > 0 ? Math.sign(x) * Math.round(Math.abs(x) / d) * d : x;
  }
  lobe._b = b;
  return (lobe._C = C);
}
// (how much of its ridge's rise a face has, t in from its edge: all of it
// at the edge and beyond, none a width w in)
function rise(t, w) {
  if (t <= 0) return 1;
  if (t >= w) return 0;
  const k = t / w;
  return 1 - k * k * (3 - 2 * k);
}
const RISE = 0.24; // (how far onto a face its ridge's rise reaches, of half the cube)
export function shapeSDF(x, y, z, half, bevel, lobe) {
  if (!lobe || !(lobe.A > 0)) return roundBoxSDF(x, y, z, half, bevel);
  const b = half - bevel, w = RISE * half, A = lobe.A, C = cusps(lobe, b);
  const X = Math.abs(x), Y = Math.abs(y), Z = Math.abs(z);
  const rX = rise(b - X, w), rY = rise(b - Y, w), rZ = rise(b - Z, w);
  // (each way's edges' scallops, where they reach: the x edges' - by its x -
  // push the y and z extents out, ...)
  let ex = b, ey = b, ez = b;
  if (rY > 0 || rZ > 0) {
    const s = A * scallop(x, b, C);
    ey += s * rZ;
    ez += s * rY;
  }
  if (rX > 0 || rZ > 0) {
    const s = A * scallop(y, b, C);
    ex += s * rZ;
    ez += s * rX;
  }
  if (rX > 0 || rY > 0) {
    const s = A * scallop(z, b, C);
    ex += s * rY;
    ey += s * rX;
  }
  const qx = X - ex, qy = Y - ey, qz = Z - ez;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - bevel;
}
// (where a scalloped cube's skin is just its plain box's: a face's middle,
// out of its edges' reach)
export function lobeFlat(x, y, z, half, bevel) {
  const b = half - bevel - RISE * half, X = Math.abs(x), Y = Math.abs(y), Z = Math.abs(z);
  if (X >= Y && X >= Z) return Y <= b && Z <= b;
  if (Y >= Z) return X <= b && Z <= b;
  return X <= b && Y <= b;
}
// lobeOut: from a point of the plain rounded box's skin, how far straight
// out (along its normal there, nx ny nz) the scalloped skin is.
// (found the Illinois way - false position, the end that's stuck halved:
// a handful of looks, not a bisection's dozen)
export function lobeOut(x, y, z, nx, ny, nz, half, bevel, lobe) {
  if (!lobe || !(lobe.A > 0)) return 0;
  let a = 0, b = 2.5 * lobe.A, side = 0;
  let fa = shapeSDF(x, y, z, half, bevel, lobe), fb = shapeSDF(x + nx * b, y + ny * b, z + nz * b, half, bevel, lobe);
  if (!(fa < 0) || !(fb > 0)) return 0;
  for (let it = 0; it < 40; it++) {
    const c = (a * fb - b * fa) / (fb - fa), fc = shapeSDF(x + nx * c, y + ny * c, z + nz * c, half, bevel, lobe);
    if (Math.abs(fc) < 1e-5 || b - a < 1e-4) return c;
    if (fc > 0) {
      (b = c), (fb = fc);
      if (side === -1) fa /= 2;
      side = -1;
    } else {
      (a = c), (fa = fc);
      if (side === 1) fb /= 2;
      side = 1;
    }
  }
  return (a + b) / 2;
}

// How far along (dx, dy, dz) from (x, y, z) - between t0 and t1 - the shape's
// skin is (0 where it doesn't cross there): halved down to a tenth of a mm.
export function shapeAlong(x, y, z, dx, dy, dz, t0, t1, half, bevel, lobe) {
  let f0 = shapeSDF(x + dx * t0, y + dy * t0, z + dz * t0, half, bevel, lobe);
  const f1 = shapeSDF(x + dx * t1, y + dy * t1, z + dz * t1, half, bevel, lobe);
  if (f0 === 0) return t0;
  if ((f0 < 0) === (f1 < 0)) return 0;
  for (let it = 0; it < 40 && t1 - t0 > 1e-4; it++) {
    const tm = (t0 + t1) / 2, fm = shapeSDF(x + dx * tm, y + dy * tm, z + dz * tm, half, bevel, lobe);
    if ((fm < 0) === (f0 < 0)) (t0 = tm), (f0 = fm);
    else t1 = tm;
  }
  return (t0 + t1) / 2;
}

export function shapeNormal(x, y, z, half, bevel, lobe, out) {
  const e = 1e-4;
  const nx = shapeSDF(x + e, y, z, half, bevel, lobe) - shapeSDF(x - e, y, z, half, bevel, lobe);
  const ny = shapeSDF(x, y + e, z, half, bevel, lobe) - shapeSDF(x, y - e, z, half, bevel, lobe);
  const nz = shapeSDF(x, y, z + e, half, bevel, lobe) - shapeSDF(x, y, z - e, half, bevel, lobe);
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
