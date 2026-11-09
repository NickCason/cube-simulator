import test from 'node:test';
import assert from 'node:assert/strict';
import { SoftBody } from '../src/sim/softbody.js';
import { cutBody, planeField, removeTets } from '../src/sim/cutting.js';
import { weakMap, weakest, worldPlane } from '../src/sim/weak.js';

// The hand's tearing looks for where the jelly's already broken between the
// hands (sim/weak.js): the weakest way through a piece, on a body.
const find = (sb, k, A, B) => weakest(weakMap(sb, k), A, B);
function settled() {
  const sb = new SoftBody({ res: 11 });
  sb.loadCube(0, 0, 0);
  for (let i = 0; i < 60; i++) sb.step(1 / 60);
  return sb;
}
// (holds on the front face, below and above the middle - in the rest shape,
// where the cube is a unit one round the origin)
const A = [0, -0.36, 0.45], B = [0, 0.36, 0.45];
const restCentre = (sb, t) => {
  const c = [0, 0, 0];
  for (let j = 0; j < 4; j++) for (let q = 0; q < 3; q++) c[q] += sb.X[sb.T[t * 4 + j] * 3 + q] / 4;
  return c;
};

test('a whole cube has no weak way through it', () => {
  const sb = settled();
  const w = find(sb, 0, A, B);
  assert.ok(w.share > 0.97, `share ${w.share}`);
});

test('a row of holes through it is where it is weakest', () => {
  const sb = settled();
  const yh = -0.15;
  // five tunnels front to back, side by side at that height
  removeTets(sb, (t) => {
    const c = restCentre(sb, t);
    return [-0.36, -0.18, 0, 0.18, 0.36].some((x) => Math.hypot(c[0] - x, c[1] - yh) < 0.075);
  });
  const k = sb.pieces.reduce((m, p, i) => (p.volume > sb.pieces[m].volume ? i : m), 0);
  const w = find(sb, k, A, B);
  assert.ok(w.share < 0.8, `share ${w.share}`);
  assert.ok(!w.slit);
  // (a plane through the holes: across the cube at their height)
  assert.ok(Math.abs(w.n[1]) > 0.9, `normal ${w.n}`);
  assert.ok(Math.abs(w.d / w.n[1] - yh) < 0.06, `at ${w.d / w.n[1]} not ${yh}`);
});

test('a part cut is a slit to tear along, on its own plane', () => {
  const sb = settled();
  // (across 60% of the way, at the height it's cut - in the world, then where that is at rest)
  const y = 0.62;
  const r = cutBody(sb, planeField(0, 1, 0, y, (x) => x < 0.1), { separate: 0 });
  assert.ok(r.changed);
  assert.equal(sb.pieces.length, 1, 'still one piece');
  // the slit's rest height: its cut faces' (those facing up or down)
  let ys = 0, n = 0;
  for (let f = 0; f < sb.nF; f++) {
    if (sb.sTag[f] !== 0) continue;
    const [a, b, c] = [sb.sTri[f * 3], sb.sTri[f * 3 + 1], sb.sTri[f * 3 + 2]];
    ys += (sb.X[a * 3 + 1] + sb.X[b * 3 + 1] + sb.X[c * 3 + 1]) / 3;
    n++;
  }
  const ys0 = ys / n;
  const W = weakMap(sb, 0), w = weakest(W, A, B);
  assert.ok(w.share < 0.8, `share ${w.share}`);
  assert.ok(w.slit, 'found as a slit');
  assert.ok(Math.abs(w.n[1]) > 0.97, `normal ${w.n}`);
  assert.ok(Math.abs(w.d * Math.sign(w.n[1]) - ys0) < 0.01, `at ${w.d}, the slit at ${ys0}`);
  // ...and that plane carried into the world: through the slit as it is now
  const wp = worldPlane(sb, W, 0, w);
  assert.ok(wp && Math.abs(Math.abs(wp.n[1]) - 1) < 0.02, `world normal ${wp?.n}`);
  assert.ok(Math.abs(wp.o[1] - y) < 0.02, `world plane at ${wp.o[1]}, cut at ${y}`);
  // (no rippling right by the slit; full away from it)
  assert.equal(wp.calm(0.0, y, 0.0), 0);
  assert.equal(wp.calm(0.45, y, -0.45) > 0, true);
});

test('a hole on one side of both hands is not between them', () => {
  const sb = settled();
  // a pit near the top, above both holds
  removeTets(sb, (t) => {
    const c = restCentre(sb, t);
    return Math.hypot(c[0], c[1] - 0.42, c[2]) < 0.12;
  });
  const k = sb.pieces.reduce((m, p, i) => (p.volume > sb.pieces[m].volume ? i : m), 0);
  const w = find(sb, k, [0, -0.36, 0.45], [0, 0.1, 0.45]);
  assert.ok(w.share > 0.95, `share ${w.share}`);
});
