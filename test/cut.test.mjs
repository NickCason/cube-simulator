import test from 'node:test';
import assert from 'node:assert/strict';
import { SoftBody } from '../src/sim/softbody.js';
import { cutBody, planeField, sphereField, separateClusters, removeTets } from '../src/sim/cutting.js';

function manifoldReport(sb) {
  // every surface edge must be shared by exactly two surface faces with opposite direction
  const m = new Map();
  for (let f = 0; f < sb.nF; f++) for (let e = 0; e < 3; e++) {
    const a = sb.sTri[f * 3 + e], b = sb.sTri[f * 3 + (e + 1) % 3];
    const k = a + ',' + b;
    m.set(k, (m.get(k) || 0) + 1);
  }
  let bad = 0;
  for (const [k, c] of m) {
    const [a, b] = k.split(',');
    if (c !== 1 || m.get(b + ',' + a) !== 1) bad++;
  }
  return bad;
}
function finite(sb) { for (let i = 0; i < sb.nV * 3; i++) if (!Number.isFinite(sb.x[i])) return false; return true; }
function pieceVolumes(sb) { return sb.pieces.map(p => { let v = 0; for (const t of p.tets) v += sb.vol0[t]; return v; }); }
function minVol(sb) { let m = Infinity; for (let t = 0; t < sb.nT; t++) if (sb.vol0[t] < m) m = sb.vol0[t]; return m; }

function settled() { const sb = new SoftBody({ res: 11 }); sb.loadCube(0, 0, 0); for (let i = 0; i < 90; i++) sb.step(1 / 60); return sb; }

test('full plane cut splits into two closed pieces', () => {
  const sb = settled();
  const V = sb.totalVolume();
  const r = cutBody(sb, planeField(1, 0, 0, 0.037), { separate: 0.3 });
  assert.ok(r.changed);
  assert.equal(sb.pieces.length, 2);
  assert.equal(manifoldReport(sb), 0);
  const pv = pieceVolumes(sb);
  assert.ok(Math.abs(pv[0] + pv[1] - V) < 1e-3 * V, `vol ${pv} vs ${V}`);
  console.log('plane: nT', sb.nT, 'pieces', pv.map(v => v.toFixed(3)), 'minVol', minVol(sb).toExponential(2), 'rCount', sb.rCount);
  for (let i = 0; i < 180; i++) sb.step(1 / 60);
  assert.ok(finite(sb));
});

test('oblique deformed cut', () => {
  const sb = settled();
  sb.impulse(0, 1, 0, 1, 0, 0, 0.8, 3);
  for (let i = 0; i < 6; i++) sb.step(1 / 60);
  const n = [0.6, 0.7, 0.3]; const l = Math.hypot(...n);
  const r = cutBody(sb, planeField(n[0] / l, n[1] / l, n[2] / l, 0.55), { separate: 0.3 });
  assert.ok(r.changed);
  assert.equal(manifoldReport(sb), 0);
  console.log('oblique: pieces', sb.pieces.length, 'nT', sb.nT, 'minVol', minVol(sb).toExponential(2));
  for (let i = 0; i < 180; i++) sb.step(1 / 60);
  assert.ok(finite(sb));
});

test('partial cut (slit) keeps one piece and stays manifold', () => {
  const sb = settled();
  const r = cutBody(sb, planeField(0, 0, 1, 0.021, (x, y, z) => x < 0.1), { separate: 0.2 });
  assert.ok(r.changed);
  assert.equal(sb.pieces.length, 1);
  assert.equal(manifoldReport(sb), 0);
  let fresh = 0; for (let f = 0; f < sb.nF; f++) if (sb.sTag[f] === 0) fresh++;
  console.log('slit: nT', sb.nT, 'fresh faces', fresh);
  assert.ok(fresh > 20);
  for (let i = 0; i < 180; i++) sb.step(1 / 60);
  assert.ok(finite(sb));
});

test('two crossing cuts make four pieces', () => {
  const sb = settled();
  cutBody(sb, planeField(1, 0, 0, 0.02), { separate: 0.2 });
  for (let i = 0; i < 10; i++) sb.step(1 / 60);
  cutBody(sb, planeField(0, 0, 1, -0.03), { separate: 0.2 });
  assert.equal(sb.pieces.length, 4);
  assert.equal(manifoldReport(sb), 0);
  console.log('cross: nT', sb.nT);
  for (let i = 0; i < 180; i++) sb.step(1 / 60);
  assert.ok(finite(sb));
});

test('sphere scoop makes a ball', () => {
  const sb = settled();
  const top = sb.pieces[0].bbox[4];
  const r = cutBody(sb, sphereField(0.05, top, 0.02, 0.24), { separate: 0 });
  assert.ok(r.changed);
  assert.equal(sb.pieces.length, 2);
  assert.equal(manifoldReport(sb), 0);
  console.log('scoop: volumes', pieceVolumes(sb).map(v => v.toFixed(4)), 'nT', sb.nT);
  for (let i = 0; i < 120; i++) sb.step(1 / 60);
  assert.ok(finite(sb));
});

test('cluster fracture and tet removal', () => {
  const sb = settled();
  const labels = new Int32Array(sb.nT);
  for (let t = 0; t < sb.nT; t++) { const i = sb.T[t * 4] * 3; labels[t] = (sb.x[i] > 0 ? 1 : 0) + (sb.x[i + 2] > 0 ? 2 : 0); }
  separateClusters(sb, labels);
  assert.equal(sb.pieces.length, 4);
  assert.equal(manifoldReport(sb), 0);
  const removed = removeTets(sb, (t, x, y, z) => Math.hypot(x - 0.3, y - 0.5, z - 0.3) < 0.15);
  assert.ok(removed.length > 0);
  assert.equal(manifoldReport(sb), 0);
  for (let i = 0; i < 120; i++) sb.step(1 / 60);
  assert.ok(finite(sb));
});
