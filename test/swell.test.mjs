import test from 'node:test';
import assert from 'node:assert/strict';
import { SoftBody } from '../src/sim/softbody.js';
import { restCentres, swellCandidates, swell, SWELL_MAX } from '../src/sim/swell.js';

// The gel gun's globs go into the jelly they land on: its rest shape swells
// round the spot by as much as went in (sim/swell.js).
function cube() {
  const sb = new SoftBody({ res: 9 });
  sb.loadCube(0, 0, 0);
  return sb;
}
const added = (sb) => {
  let a = 0;
  for (let t = 0; t < sb.nT; t++) a += sb.vol0[t] * (sb.tVS[t] - 1);
  return a;
};
const volume = (sb) => {
  let v = 0;
  for (let t = 0; t < sb.nT; t++) v += sb.vol0[t];
  return v;
};
// (a spot on the front face, at rest: the cube's a unit one round the origin)
const P = [0.1, 0.05, 0.5];

test('it swells by just what went in, round the spot', () => {
  const sb = cube(), C = restCentres(sb), cand = swellCandidates(sb, C, 0, 0, P, 0.2);
  const dV = 0.008 * volume(sb);
  const left = swell(sb, cand, 0.2, dV);
  assert.equal(left, 0);
  assert.ok(Math.abs(added(sb) - dV) < 1e-9 * volume(sb), `added ${added(sb)} of ${dV}`);
  // (most of it near the spot: the far side untouched)
  let near = 0, far = 0;
  for (let t = 0; t < sb.nT; t++) {
    const d = Math.hypot(C[t * 3] - P[0], C[t * 3 + 1] - P[1], C[t * 3 + 2] - P[2]), a = sb.vol0[t] * (sb.tVS[t] - 1);
    if (d < 0.2) near += a;
    if (C[t * 3 + 2] < 0) far += a;
  }
  assert.ok(near > 0.6 * dV, `near ${near / dV}`);
  assert.equal(far, 0);
});

test('a spot that is full spreads what comes next round it, and hands back what has no room', () => {
  const sb = cube(), C = restCentres(sb), cand = swellCandidates(sb, C, 0, 0, P, 0.2);
  const V = volume(sb);
  let left = 0, put = 0;
  for (let n = 0; n < 400 && left === 0; n++) {
    left = swell(sb, cand, 0.2, 0.008 * V);
    put += 0.008 * V - left;
  }
  // (none past the most a tet will swell; it got full - something handed back)
  let max = 0;
  for (let t = 0; t < sb.nT; t++) max = Math.max(max, sb.tVS[t]);
  assert.ok(max <= SWELL_MAX + 1e-9, `max ${max}`);
  assert.ok(left > 0, 'never full');
  assert.ok(Math.abs(added(sb) - put) < 1e-6 * V);
  // (by then it's spread well past the first reach)
  let wide = 0;
  for (let t = 0; t < sb.nT; t++) {
    const d = Math.hypot(C[t * 3] - P[0], C[t * 3 + 1] - P[1], C[t * 3 + 2] - P[2]);
    if (d > 0.3 && sb.tVS[t] > 1.5) wide++;
  }
  assert.ok(wide > 10, `wide ${wide}`);
});

test('it stays a cube: a swollen one settles, nothing flies off', () => {
  const sb = cube(), C = restCentres(sb), cand = swellCandidates(sb, C, 0, 0, P, 0.2);
  for (let n = 0; n < 40; n++) swell(sb, cand, 0.2, 0.008 * volume(sb));
  for (let i = 0; i < 240; i++) sb.step(1 / 60);
  let vmax = 0, bad = 0;
  for (let i = 0; i < sb.nV; i++) {
    const s = Math.hypot(sb.v[i * 3], sb.v[i * 3 + 1], sb.v[i * 3 + 2]);
    if (!Number.isFinite(s)) bad++;
    else vmax = Math.max(vmax, s);
  }
  assert.equal(bad, 0);
  assert.ok(vmax < 0.5, `still moving at ${vmax}`);
  assert.equal(sb.pieces.length, 1);
});
