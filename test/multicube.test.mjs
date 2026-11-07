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

test('each cube its own edges: its outside faces found on its own shape', () => {
  const sb = new SoftBody({ res: 7, size: 0.6, bevel: 0.02 });
  sb.loadCube(-0.6, 0, 0, 0);
  sb.addCube(1, 0.6, 0, 0, 0, 0.6 * 0.21); // (a pillow beside a sharp one)
  sb.rebuild();
  assert.equal(sb.cBevel[0], 0.02);
  assert.ok(Math.abs(sb.cBevel[1] - 0.126) < 1e-9);
  // every face of both, whole as they are, is outside
  const out = [0, 0], all = [0, 0];
  for (let f = 0; f < sb.nF; f++) {
    const k = sb.vCube[sb.sTri[f * 3]];
    all[k]++;
    if (sb.sTag[f] === 1) out[k]++;
  }
  assert.deepEqual(out, all);
  // the pillow's corners are rounder: its rest shape reaches less far out on the diagonal
  const far = (k) => { let m = 0; for (let i = 0; i < sb.nV; i++) if (sb.vCube[i] === k) m = Math.max(m, Math.hypot(sb.X[i * 3] - k * REST_STEP, sb.X[i * 3 + 1], sb.X[i * 3 + 2])); return m; };
  assert.ok(far(1) < far(0) - 0.03, `${far(1)} vs ${far(0)}`);
});

test('the last cube left moves back to slot 0, rest shape and all', () => {
  const sb = two();
  settle(sb, 0.5);
  sb.removeCube(0);
  const x0 = Array.from(sb.x.slice(0, sb.nV * 3));
  sb.moveCube(1, 0);
  sb.rebuild();
  assert.equal(sb.pieces.length, 1);
  assert.equal(sb.pieces[0].cube, 0);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < sb.nV; i++) {
    assert.equal(sb.vCube[i], 0);
    lo = Math.min(lo, sb.X[i * 3]);
    hi = Math.max(hi, sb.X[i * 3]);
  }
  assert.ok(lo > -0.31 && hi < 0.31, `rest x ${lo}..${hi}`);
  assert.equal(sb.cMu[0], 900); // (its stuff came with it)
  assert.deepEqual(Array.from(sb.x.slice(0, sb.nV * 3)), x0); // (and it stays where it is)
  settle(sb, 1);
  assert.ok(finite(sb));
});
