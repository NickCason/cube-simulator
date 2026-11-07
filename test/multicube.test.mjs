import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SoftBody, REST_STEP } from '../src/sim/softbody.js';
import { cutBody, planeField } from '../src/sim/cutting.js';

const settle = (sb, s) => { for (let t = 0; t < s * 60; t++) sb.step(1 / 60); };
const finite = (sb) => { for (let i = 0; i < sb.nV * 3; i++) if (!Number.isFinite(sb.x[i])) return false; return true; };
const box = (sb, k) => {
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < sb.nV; i++) if (sb.vCube[i] === k) { y0 = Math.min(y0, sb.x[i * 3 + 1]); y1 = Math.max(y1, sb.x[i * 3 + 1]); }
  return { y0, y1 };
};

function two() {
  const sb = new SoftBody({ res: 7, size: 0.6, bevel: 0.08, mu: 170, damping: 1.7, lambdaRatio: 24 });
  sb.loadCube(-0.6, 0, 0, 0);
  sb.addCube(1, 0.6, 0, 0, 0);
  // cube 0 soft and heavy, cube 1 stiff and light
  sb.setCube(0, { mu: 60, density: 2, damping: 1, friction: 0.85, bounce: 0.1, rigidity: 0, lambdaRatio: 24, airDrag: 0.05 });
  sb.setCube(1, { mu: 900, density: 0.5, damping: 2, friction: 0.85, bounce: 0.5, rigidity: 0.3, lambdaRatio: 30, airDrag: 0.05 });
  sb.rebuild();
  return sb;
}

test('two cubes of different stuff share the body, each its own piece and material', () => {
  const sb = two();
  assert.equal(sb.pieces.length, 2);
  assert.deepEqual(sb.pieces.map((p) => p.cube).sort(), [0, 1]);
  // rest shapes kept apart in rest space
  let maxX0 = -Infinity, minX1 = Infinity;
  for (let i = 0; i < sb.nV; i++) (sb.vCube[i] === 0 ? (maxX0 = Math.max(maxX0, sb.X[i * 3])) : (minX1 = Math.min(minX1, sb.X[i * 3])));
  assert.ok(minX1 - maxX0 > REST_STEP / 2);
  settle(sb, 2.5);
  assert.ok(finite(sb));
  // the soft heavy one sags more than the stiff light one
  const a = box(sb, 0), b = box(sb, 1);
  assert.ok(a.y1 - a.y0 < b.y1 - b.y0 - 0.005, `${a.y1 - a.y0} vs ${b.y1 - b.y0}`);
});

test('a cube set down on another stays on it, not through it', () => {
  const sb = new SoftBody({ res: 7, size: 0.6, bevel: 0.08 });
  sb.loadCube(0, 0, 0, 0);
  sb.addCube(1, 0.02, 0.63, 0, 0.05);
  sb.setCube(1, { mu: 300, density: 1.2 });
  sb.rebuild();
  settle(sb, 3);
  assert.ok(finite(sb));
  const lo = box(sb, 0), hi = box(sb, 1);
  assert.ok(hi.y0 > lo.y1 - 0.06, `top cube's bottom ${hi.y0} vs bottom cube's top ${lo.y1}`);
});

test('a cut through both keeps every vertex with its own cube', () => {
  const sb = two();
  settle(sb, 0.5);
  const r = cutBody(sb, planeField(0, 1, 0, 0.3), { separate: 0.05, anchors: [] });
  assert.ok(r.changed);
  sb.rebuild();
  assert.ok(sb.pieces.length >= 4);
  for (const pc of sb.pieces) for (const i of pc.verts) assert.equal(sb.vCube[i], pc.cube);
  settle(sb, 1);
  assert.ok(finite(sb));
});

test('taking a cube out leaves the other as it was', () => {
  const sb = two();
  settle(sb, 1);
  const before = box(sb, 1);
  sb.removeCube(0);
  sb.rebuild();
  assert.equal(sb.pieces.length, 1);
  assert.equal(sb.pieces[0].cube, 1);
  for (let i = 0; i < sb.nV; i++) assert.equal(sb.vCube[i], 1);
  settle(sb, 1);
  assert.ok(finite(sb));
  const after = box(sb, 1);
  assert.ok(Math.abs(after.y1 - before.y1) < 0.05);
});
