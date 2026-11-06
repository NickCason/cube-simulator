// Rounded-cube tetrahedral mesh generator.
// A cube of side `size` is split into res^3 cells, each cell into 5 tets with
// alternating parity so neighbouring cells share face diagonals. Boundary
// vertices are pushed onto a rounded box of radius `bevel`.

export function buildCubeMesh(res = 12, size = 1, bevel = 0.09) {
  const n1 = res + 1;
  const h = size / res;
  const half = size / 2;
  const a = half - bevel;
  const pos = new Float64Array(n1 * n1 * n1 * 3);
  const id = (i, j, k) => (i * n1 + j) * n1 + k;

  for (let i = 0; i < n1; i++) {
    for (let j = 0; j < n1; j++) {
      for (let k = 0; k < n1; k++) {
        let x = -half + i * h, y = -half + j * h, z = -half + k * h;
        if (bevel > 0) {
          const qx = Math.max(-a, Math.min(a, x));
          const qy = Math.max(-a, Math.min(a, y));
          const qz = Math.max(-a, Math.min(a, z));
          const dx = x - qx, dy = y - qy, dz = z - qz;
          const m = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
          const len = Math.hypot(dx, dy, dz);
          if (m > 1e-12) {
            const s = m / len;
            x = qx + dx * s; y = qy + dy * s; z = qz + dz * s;
          }
        }
        const o = id(i, j, k) * 3;
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
      }
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
  return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - bevel;
}

export function roundBoxNormal(x, y, z, half, bevel, out) {
  const e = 1e-4;
  const nx = roundBoxSDF(x + e, y, z, half, bevel) - roundBoxSDF(x - e, y, z, half, bevel);
  const ny = roundBoxSDF(x, y + e, z, half, bevel) - roundBoxSDF(x, y - e, z, half, bevel);
  const nz = roundBoxSDF(x, y, z + e, half, bevel) - roundBoxSDF(x, y, z - e, half, bevel);
  const l = Math.hypot(nx, ny, nz) || 1;
  out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
  return out;
}
