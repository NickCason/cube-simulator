// JIT warm-up for the physics: runs everything the toys use (falling and
// landing, grabbing, a mallet dent, cuts and scoops, pieces colliding, the
// heal's pull and weld field) on a small throwaway body, one step per
// resume. Safari only compiles hot code into its fast tier after it has run
// a while, so doing this while the cube hangs at the start keeps the drop
// (and the first cut) from stuttering. What comes after 'ready' runs in the
// background a few ms a frame, so its steps are kept small (few substeps).

import { SoftBody } from './softbody.js';
import { cutBody, planeField, sphereField, separateClusters, removeTets, removeSmallPieces } from './cutting.js';
import { weldFieldJob } from '../heal.js';

export function* physicsWarmJob() {
  const sb = new SoftBody({ res: 7, bounce: 0.55 });
  sb.loadCube(0, 0.6, 0, 0.2);
  const step = function* (n, substeps = 12) {
    sb.p.substeps = substeps;
    for (let k = 0; k < n; k++) {
      sb.step(1 / 60);
      yield;
    }
  };
  // fall, land, wobble
  yield* step(16);
  // grab and drag
  sb.startGrab({ point: [0, 0.8, 0], piece: 0 }, 0, 0.8, 0, 0.3);
  for (let k = 0; k < 6; k++) {
    sb.grab.tx = Math.sin(k) * 0.3;
    sb.grab.ty = 0.9;
    yield* step(1);
  }
  sb.endGrab();
  // a first cut and its pieces touching: the coldest (slowest) runs of the
  // contact code, best had while the cube still hangs
  cutBody(sb, planeField(1, 0, 0, 0.03), { separate: 0.01 });
  yield;
  yield* step(3, 2);
  // (enough for the drop: the intro can let go of the cube now; the rest
  // carries on in the background)
  yield 'ready';
  // a mallet dent (ringing on, as on the beat)
  sb.wakeAll();
  sb.dampBoost = 0.6;
  // (numbers with fractions, as the mallet's are: see asFloat in softbody.js)
  const P = { c: [0.01, 1.02, 0.01], d: [0.1, -0.995, 0.01], r: 0.105, len: 0.34, s0: 0, s1: 0 };
  sb.pushers.push(P);
  for (let k = 0; k < 4; k++) {
    P.s0 = P.s1;
    P.s1 = Math.min(0.15, P.s1 + 0.06);
    yield* step(1, 2);
  }
  sb.pushers.length = 0;
  // a scooping cut: pieces collide and settle
  cutBody(sb, sphereField(0.2, 0.7, 0.2, 0.3), { separate: 0.01 });
  yield;
  // the chunks settle and fall asleep
  sb.dampBoost = 1;
  yield* step(80, 2);
  // a scoop, and the rest split into slabs
  removeTets(sb, (t, x, y) => y > 0.95 && x > 0.3);
  yield;
  const slab = new Int32Array(sb.nT);
  for (let t = 0; t < sb.nT; t++) slab[t] = Math.min(2, Math.max(0, Math.floor((sb.X[sb.T[t * 4] * 3 + 2] + 0.5) * 3)));
  separateClusters(sb, slab);
  removeSmallPieces(sb, 0.002);
  yield;
  yield* step(20, 2);
  // the heal: pulled together without collisions, then the weld field
  const targets = new Float64Array(sb.vCap * 3);
  for (let i = 0; i < sb.nV; i++) {
    targets[i * 3] = sb.X[i * 3];
    targets[i * 3 + 1] = sb.X[i * 3 + 1] + 0.62;
    targets[i * 3 + 2] = sb.X[i * 3 + 2];
  }
  sb.attract = { targets, n: sb.nV, rate: 12 };
  sb.collisionsEnabled = false;
  sb.gravityScale = 0.3;
  sb.dampBoost = 2;
  yield* step(6, 2);
  const weld = weldFieldJob([0, 0.2, 0, 0.3, 0.2, 0, 0, 0.2, 0.3, 0.45, -0.1, 0, 0.45, 0.2, 0, 0.45, -0.1, 0.3], 0.5, new Float64Array([0, 0.5, 0, 0.5, 0, 0.2, -0.5, 0.1, 0]));
  for (let r = weld.next(); !r.done; r = weld.next()) yield;
  return sb;
}
