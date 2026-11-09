import test from 'node:test';
import assert from 'node:assert/strict';
import { SoftBody } from '../src/sim/softbody.js';

// The dicer's clean way with a whole cube: built again a whole number of
// cells to a die, then pulled apart along that grid (remeshCube, splitCube).
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
function settled() {
  const sb = new SoftBody({ res: 11 });
  sb.loadCube(0, 0, 0);
  for (let i = 0; i < 60; i++) sb.step(1 / 60);
  return sb;
}
const bounds = (sb) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < sb.nV; i++) for (let q = 0; q < 3; q++) { lo[q] = Math.min(lo[q], sb.x[i * 3 + q]); hi[q] = Math.max(hi[q], sb.x[i * 3 + q]); }
  return [lo, hi];
};

test('a remeshed cube is just where and as it was, its nails at the same rest points', () => {
  const sb = settled();
  const [lo0, hi0] = bounds(sb);
  // a nail: its rest point
  const t0 = 1234, b = [0.25, 0.25, 0.25, 0.25];
  const E = { a: { tet: t0, b: [...b] }, b: { tet: t0 + 40, b: [...b] }, len: 0.01, compliance: 1e-3 };
  sb.embeds.push(E);
  const p0 = sb._restPoint(E.a.tet, E.a.b);
  sb.remeshCube(0, 9);
  assert.equal(sb.nT, 9 * 9 * 9 * 5);
  assert.equal(sb.pieces.length, 1);
  const [lo, hi] = bounds(sb);
  for (let q = 0; q < 3; q++) {
    assert.ok(Math.abs(lo[q] - lo0[q]) < 0.02 && Math.abs(hi[q] - hi0[q]) < 0.02, `bounds ${lo} ${hi} were ${lo0} ${hi0}`);
  }
  assert.ok(sb.embeds.includes(E));
  const p1 = sb._restPoint(E.a.tet, E.a.b);
  assert.ok(Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) < 1e-6, `moved from ${p0} to ${p1}`);
});

test('split along its grid: 27 dice the same size, no tet cut, settled clean', () => {
  const sb = settled();
  sb.remeshCube(0, 9);
  const nT = sb.nT;
  sb.splitCube(0, [0, 2], 3, I3, 0.004);
  assert.equal(sb.pieces.length, 9);
  sb.splitCube(0, [1], 3, I3, 0.004);
  assert.equal(sb.pieces.length, 27);
  assert.equal(sb.nT, nT);
  const vols = sb.pieces.map((p) => p.tets.length);
  assert.ok(vols.every((n) => n === 135), `tets a die ${[...new Set(vols)]}`);
  for (let i = 0; i < 240; i++) sb.step(1 / 60);
  let vmax = 0, bad = 0;
  for (let i = 0; i < sb.nV; i++) {
    const s = Math.hypot(sb.v[i * 3], sb.v[i * 3 + 1], sb.v[i * 3 + 2]);
    if (!Number.isFinite(s)) bad++;
    else vmax = Math.max(vmax, s);
  }
  assert.equal(bad, 0);
  assert.ok(vmax < 0.5, `still moving at ${vmax}`);
  // (none inverted)
  let inv = 0;
  for (let t = 0; t < sb.nT; t++) {
    const o = (k) => sb.T[t * 4 + k] * 3, x = sb.x;
    const a = o(0), b = o(1), c = o(2), d = o(3);
    const ux = x[b] - x[a], uy = x[b + 1] - x[a + 1], uz = x[b + 2] - x[a + 2];
    const vx = x[c] - x[a], vy = x[c + 1] - x[a + 1], vz = x[c + 2] - x[a + 2];
    const wx = x[d] - x[a], wy = x[d + 1] - x[a + 1], wz = x[d + 2] - x[a + 2];
    if (ux * (vy * wz - vz * wy) - uy * (vx * wz - vz * wx) + uz * (vx * wy - vy * wx) <= 0) inv++;
  }
  assert.equal(inv, 0);
});
