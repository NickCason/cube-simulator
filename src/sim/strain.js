// Largest stretch in the jelly: per tet, the biggest principal stretch of F
// (sqrt of FtF's biggest eigenvalue, by a few power steps), over the tets of
// the pieces marked in `mask`. Returns { s, t, dir: [x,y,z] } - the stretch,
// the tet, and the world direction it stretches along (unit) - or null.
// filter(cx, cy, cz): only tets whose centre it accepts (optional).
export function maxStretch(sb, mask, filter = null) {
  const { T, B, x, tVS, vol0, tPiece } = sb;
  let best = 1, bt = -1;
  let bx = 0, by = 0, bz = 0;
  for (let t = 0; t < sb.nT; t++) {
    if (vol0[t] <= 0 || !mask[tPiece[t]]) continue;
    const o = t * 4, i0 = T[o] * 3, i1 = T[o + 1] * 3, i2 = T[o + 2] * 3, i3 = T[o + 3] * 3;
    if (filter && !filter((x[i0] + x[i1] + x[i2] + x[i3]) * 0.25, (x[i0 + 1] + x[i1 + 1] + x[i2 + 1] + x[i3 + 1]) * 0.25, (x[i0 + 2] + x[i1 + 2] + x[i2 + 2] + x[i3 + 2]) * 0.25)) continue;
    const vs = tVS[t], sc = vs === 1 ? 1 : 1 / Math.cbrt(vs), bo = t * 9;
    const e1x = x[i1] - x[i0], e1y = x[i1 + 1] - x[i0 + 1], e1z = x[i1 + 2] - x[i0 + 2];
    const e2x = x[i2] - x[i0], e2y = x[i2 + 1] - x[i0 + 1], e2z = x[i2 + 2] - x[i0 + 2];
    const e3x = x[i3] - x[i0], e3y = x[i3 + 1] - x[i0 + 1], e3z = x[i3 + 2] - x[i0 + 2];
    const b00 = B[bo] * sc, b01 = B[bo + 1] * sc, b02 = B[bo + 2] * sc, b10 = B[bo + 3] * sc, b11 = B[bo + 4] * sc, b12 = B[bo + 5] * sc, b20 = B[bo + 6] * sc, b21 = B[bo + 7] * sc, b22 = B[bo + 8] * sc;
    const f00 = e1x * b00 + e2x * b10 + e3x * b20, f01 = e1x * b01 + e2x * b11 + e3x * b21, f02 = e1x * b02 + e2x * b12 + e3x * b22;
    const f10 = e1y * b00 + e2y * b10 + e3y * b20, f11 = e1y * b01 + e2y * b11 + e3y * b21, f12 = e1y * b02 + e2y * b12 + e3y * b22;
    const f20 = e1z * b00 + e2z * b10 + e3z * b20, f21 = e1z * b01 + e2z * b11 + e3z * b21, f22 = e1z * b02 + e2z * b12 + e3z * b22;
    // quick bound: ||F||_F^2 >= lambda_max^2 - skip tets that can't beat the best
    const fr = f00 * f00 + f01 * f01 + f02 * f02 + f10 * f10 + f11 * f11 + f12 * f12 + f20 * f20 + f21 * f21 + f22 * f22;
    if (fr <= best * best) continue;
    // C = F^T F
    const c00 = f00 * f00 + f10 * f10 + f20 * f20, c01 = f00 * f01 + f10 * f11 + f20 * f21, c02 = f00 * f02 + f10 * f12 + f20 * f22;
    const c11 = f01 * f01 + f11 * f11 + f21 * f21, c12 = f01 * f02 + f11 * f12 + f21 * f22, c22 = f02 * f02 + f12 * f12 + f22 * f22;
    let vx = 0.577, vy = 0.577, vz = 0.577;
    for (let it = 0; it < 6; it++) {
      const ux = c00 * vx + c01 * vy + c02 * vz, uy = c01 * vx + c11 * vy + c12 * vz, uz = c02 * vx + c12 * vy + c22 * vz;
      const l = Math.hypot(ux, uy, uz) || 1;
      vx = ux / l; vy = uy / l; vz = uz / l;
    }
    const lam2 = vx * (c00 * vx + c01 * vy + c02 * vz) + vy * (c01 * vx + c11 * vy + c12 * vz) + vz * (c02 * vx + c12 * vy + c22 * vz);
    const lam = Math.sqrt(Math.max(lam2, 0));
    if (lam > best) {
      best = lam;
      bt = t;
      // world direction it stretches along: F v
      bx = f00 * vx + f01 * vy + f02 * vz; by = f10 * vx + f11 * vy + f12 * vz; bz = f20 * vx + f21 * vy + f22 * vz;
    }
  }
  if (bt < 0) return null;
  const l = Math.hypot(bx, by, bz) || 1;
  return { s: best, t: bt, dir: [bx / l, by / l, bz / l] };
}
