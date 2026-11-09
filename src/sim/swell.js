// Jelly swelling with what's poured into it (the gel gun's globs, gone in):
// its own rest shape grown round a spot - each tet near it given more rest
// volume (SoftBody's tVS), most at the spot and less further off, and more
// where there's more room left to swell, so a spot that's full spreads what
// comes next round it. What the reach can't take goes round wider; past the
// widest there's no room, and it's handed back.

export const SWELL_MAX = 4; // (how far a tet will swell: its rest volume, times)
export const SPREAD = 1.5, PASSES = 4; // (what a full reach can't take goes round it, this much wider each time)

// The tets' middles at rest: x y z a tet.
export function restCentres(sb) {
  const c = new Float64Array(sb.nT * 3), T = sb.T, X = sb.X;
  for (let t = 0; t < sb.nT; t++) {
    for (let k = 0; k < 4; k++) {
      const o = T[t * 4 + k] * 3;
      c[t * 3] += X[o] * 0.25;
      c[t * 3 + 1] += X[o + 1] * 0.25;
      c[t * 3 + 2] += X[o + 2] * 0.25;
    }
  }
  return c;
}

// The tets it can go into: of cube k with tag (0: the cube's own jelly; a
// blob's tag: that blob), within reach of P at rest - [t, distance, ...].
export function swellCandidates(sb, C, k, tag, P, R) {
  const far = R * Math.pow(SPREAD, PASSES - 1), T = sb.T, out = [];
  for (let t = 0; t < sb.nT; t++) {
    if (!(sb.vol0[t] > 0) || sb.tCube[t] !== k || (sb.vTag?.[T[t * 4]] ?? 0) !== tag) continue;
    const d = Math.hypot(C[t * 3] - P[0], C[t * 3 + 1] - P[1], C[t * 3 + 2] - P[2]);
    if (d < far) out.push(t, d);
  }
  return out;
}

// dV more rest volume into the candidates round a spot (reach R). What
// couldn't be placed - nowhere left in reach - is handed back.
export function swell(sb, cand, R, dV, max = SWELL_MAX) {
  const vs = sb.tVS, v0 = sb.vol0;
  if (!(dV > 0)) return 0;
  for (let pass = 0; pass < PASSES && dV > 1e-12; pass++, R *= SPREAD) {
    let sum = 0;
    for (let q = 0; q < cand.length; q += 2) {
      const t = cand[q], d = cand[q + 1], room = max - vs[t];
      if (d < R && room > 1e-4) sum += (0.5 + 0.5 * Math.cos((Math.PI * d) / R)) * room * v0[t];
    }
    if (!(sum > 0)) continue;
    let placed = 0;
    for (let q = 0; q < cand.length; q += 2) {
      const t = cand[q], d = cand[q + 1], room = max - vs[t];
      if (!(d < R && room > 1e-4)) continue;
      const w = (0.5 + 0.5 * Math.cos((Math.PI * d) / R)) * room * v0[t];
      const add = Math.min(room, (dV * w) / sum / v0[t]);
      vs[t] += add;
      placed += add * v0[t];
    }
    dV -= placed;
  }
  // (what's left over a rounding's worth: all placed)
  return dV > 1e-12 ? dV : 0;
}
