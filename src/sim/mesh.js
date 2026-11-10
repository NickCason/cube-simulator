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
  // (its own shape: dished or bulged, every point out or in from the middle
  // in proportion - the plain box's skin lands on its skin, and the jelly
  // inside follows, squeezed or stretched no more than the shape is)
  if (shape && shape.bow) {
    for (let v = 0; v < n1 * n1 * n1; v++) {
      const o = v * 3, x = pos[o], y = pos[o + 1], z = pos[o + 2], l = Math.sqrt(x * x + y * y + z * z);
      if (l < 1e-9) continue;
      const dx = x / l, dy = y / l, dz = z / l;
      const k = shapeRadius(dx, dy, dz, half, bevel, shape) / shapeRadius(dx, dy, dz, half, bevel, null);
      pos[o] = x * k; pos[o + 1] = y * k; pos[o + 2] = z * k;
    }
  }
  // (its edges' trim - see crimp)
  if (shape && shape.A > 0) crimp(pos, res, half, bevel, shape);

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

// A cube's own shape, past its rounding (app.js shapeOf): { bow, A, m, kind } - or
// null, the plain rounded box.
// - bow: its faces dished in (< 0) or bulged out (> 0): a face's middle that
//   far, its edges' middles half that, its corners where they were - so,
//   dished, a face seen square on is pinched in at every side, its corners
//   standing out (the Faces slider). As a shape (shapeSDF): the rounded box,
//   its inner box's extent along each axis moved by where a point is across
//   the other two.
// - A, m, kind: its edges' trim - not a shape of its own but the mesh's own
//   points moved: see crimp.
const bell = (t) => (t >= 1 ? 0 : (1 - t * t) * (1 - t * t));
export function shapeSDF(x, y, z, half, bevel, shape) {
  if (!shape || !shape.bow) return roundBoxSDF(x, y, z, half, bevel);
  const b = half - bevel, X = Math.abs(x), Y = Math.abs(y), Z = Math.abs(z);
  // (no deeper than most of the way to the middle)
  const B = Math.max(-0.6 * b, shape.bow) / 2, cx = bell(X / b), cy = bell(Y / b), cz = bell(Z / b);
  const qx = X - b - B * (cy + cz), qy = Y - b - B * (cx + cz), qz = Z - b - B * (cx + cy);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - bevel;
}
// (where its skin is just the plain box's: anywhere, its faces not bowed)
export function shapeFlat(x, y, z, half, bevel, shape) {
  return !(shape && shape.bow);
}
// The shape trims (styles.js TRIMS with a `shape`): the mesh's own points
// along every edge moved, as a bug once moved them on light, stiff jelly's
// edges (Airy and Rubber: its tets crushed, see softbody _solveTets) - kept
// on purpose. Along each edge every m-th cell's crest point is a "tip"; the
// crest's other points, and the points a cell beside it on each face, are
// moved after it, each kind its own way. Drawn as any edge is (smoothed
// between the points, creased where it's sharp) - but a sawtooth's teeth
// creased all round: crisp facets (SoftBody._buildRenderClusters). m 2
// (every other cell) was the bug's own: its tets alternate. A corner's
// rounding, and a cell short of it, left as it is: its points are
// close-packed there, and moved they'd fold. Nothing on a crest moved in:
// on a rounded edge that's a groove its cells fold into.
// Each kind: [tip out, tip leant along the edge, the crest's others out, a
// tip's neighbours beside the crest out, the others beside it out] - x A,
// out along the plain box's normal.
export const CRIMPS = ['', 'scallop', 'saw'];
const CRIMP_MOVES = {
  scallop: [1, 0.4, 0.25, 0.25, 0.25], // soft ripples (what the bug left once half fixed)
  saw: [1, 0.9, 0, 0.3, 0], // leant teeth, notched between - creased
};
// (how far each stands out at Moulded, of the cube's size; and how much
// deeper than that it can go - a sawtooth's leant teeth further tip their
// faces past what reads as its skin)
export const CRIMP_AMP = { scallop: 0.02, saw: 0.05 };
export const CRIMP_DEEPEST = { saw: 1.15 };
export const crimpSharp = (kind) => kind === 'saw';
function crimp(pos, res, half, bevel, shape) {
  const n1 = res + 1, A = shape.A, m = Math.max(2, shape.m | 0), nb = [0, 0, 0], lim = half - bevel - (half * 2) / res + 1e-9;
  const kind = CRIMP_MOVES[shape.kind] ? shape.kind : 'scallop', M = CRIMP_MOVES[kind];
  const at = (i) => (i === 0 ? -1 : i === res ? 1 : 0), near = (i) => i === 1 || i === res - 1;
  for (let i = 0; i < n1; i++) {
    for (let j = 0; j < n1; j++) {
      for (let k = 0; k < n1; k++) {
        const I = [i, j, k], S = [at(i), at(j), at(k)], ends = (S[0] !== 0) + (S[1] !== 0) + (S[2] !== 0);
        if (ends === 3 || ends === 0) continue;
        // (which edge: the axis it runs along - the one not at an end - and
        // whether this is its crest or a point just beside it)
        let ax = -1, crest = false;
        if (ends === 2) (ax = S.indexOf(0)), (crest = true);
        else {
          // (on a face, a cell in from an edge: along the edge it's beside)
          const f = S.findIndex((v) => v !== 0), others = [0, 1, 2].filter((q) => q !== f);
          const beside = others.filter((q) => near(I[q]));
          if (beside.length !== 1) continue;
          ax = others.find((q) => q !== beside[0]);
        }
        const along = I[ax];
        if (along === 0 || along === res) continue;
        const o = ((i * n1 + j) * n1 + k) * 3, x = pos[o], y = pos[o + 1], z = pos[o + 2];
        if (Math.abs(pos[o + ax]) >= lim) continue;
        // (a tip's column: the bug's odd points - every other cell along every
        // edge (a crest point's own parity; one beside it, one off) - else
        // every m-th)
        const tipCol = m === 2 ? (i + j + k + (crest ? 0 : 1)) % 2 === 1 : (along + 1) % m === 0;
        const t = (crest ? (tipCol ? M[0] : M[2]) : tipCol ? M[3] : M[4]) * A;
        roundBoxNormal(x, y, z, half, bevel, nb);
        pos[o] = x + nb[0] * t; pos[o + 1] = y + nb[1] * t; pos[o + 2] = z + nb[2] * t;
        if (crest && tipCol && M[1]) {
          // (leant along the edge: the same way all along it)
          const q = [0, 1, 2].filter((c) => c !== ax), sg = -(S[q[0]] || 1) * (S[q[1]] || 1);
          pos[o + ax] += sg * M[1] * A;
        }
      }
    }
  }
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
