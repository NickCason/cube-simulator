import * as THREE from 'three';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
// C2-continuous ease in/out: gentle starts and landings
const smoother = (u) => {
  u = clamp01(u);
  return u * u * u * (u * (u * 6 - 15) + 10);
};

// Choreography (seconds): loosen & lift, expand into an exploded view while
// every fragment turns to its final orientation, hover, fly together, fuse,
// then lower gently onto the table.
const TL = {
  expandStart: 0.12,
  expandDur: 1.05,
  flyStart: 1.38,
  flyDur: 0.92,
  stagger: 0.16,
  settle: 0.75,
};
const LIFT_HOVER = 0.24; // how high the exploded view floats
const LIFT_FUSE = 0.12; // the reformed cube is lowered from here
const UP = new THREE.Vector3(0, 1, 0);

// Rotation that best maps rest offsets onto current offsets
// (Müller et al. 2016, "A robust method to extract the rotational part of
// deformations"). Columns: a_j = sum m (x - c) (X - C)_j.
function fitRotation(a0, a1, a2, q) {
  const m = new THREE.Matrix4();
  const r = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const om = new THREE.Vector3(), t = new THREE.Vector3(), dq = new THREE.Quaternion();
  for (let it = 0; it < 40; it++) {
    m.makeRotationFromQuaternion(q);
    m.extractBasis(r[0], r[1], r[2]);
    om.set(0, 0, 0);
    om.add(t.crossVectors(r[0], a0)).add(t.crossVectors(r[1], a1)).add(t.crossVectors(r[2], a2));
    const den = Math.abs(r[0].dot(a0) + r[1].dot(a1) + r[2].dot(a2)) + 1e-9;
    om.multiplyScalar(1 / den);
    const w = om.length();
    if (w < 1e-9) break;
    dq.setFromAxisAngle(om.multiplyScalar(1 / w), w);
    q.premultiply(dq).normalize();
  }
  return q;
}

// The heal sequence: eject foreign objects, cool/thaw, choreograph every
// fragment back into a levitating cube, then fuse the topology back into one
// pristine mesh with glowing seams.
export class Healer {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.t = 0;
  }

  start(opts = {}) {
    if (this.active) return;
    const app = this.app;
    const sb = app.sb;
    this.active = true;
    this.settling = false;
    this.t = 0;
    this.fused = false;
    this.gathered = false;
    this.ejected = app.nails.ejectAll();
    for (const f of app.onHealStart) f();
    sb.endGrab();
    this.scaleK = opts.scale || 1;
    if (!sb.pieces.length || sb.nT === 0) {
      // everything was blasted away: grow a fresh cube
      this.cx = 0;
      this.cz = 0;
      this.yaw = 0;
      this.plan = [];
      this._fuse();
      return;
    }
    // destination: upright cube under the centre of mass, yaw of the biggest piece
    let M = 0, cx = 0, cz = 0;
    for (const pc of sb.pieces) {
      M += pc.mass;
      cx += pc.com[0] * pc.mass;
      cz += pc.com[2] * pc.mass;
    }
    cx /= M || 1;
    cz /= M || 1;
    const R = sb.p.arenaRadius - 1.05;
    const r = Math.hypot(cx, cz);
    if (r > R) {
      cx *= Math.max(R, 0) / r;
      cz *= Math.max(R, 0) / r;
    }
    const main = sb.pieces.reduce((a, b) => (b.mass > a.mass ? b : a), sb.pieces[0]);
    let sxx = 0, sxz = 0, rx = 0, rz = 0, mm = 0;
    for (const i of main.verts) {
      rx += sb.X[i * 3] * sb.m[i];
      rz += sb.X[i * 3 + 2] * sb.m[i];
      mm += sb.m[i];
    }
    rx /= mm;
    rz /= mm;
    for (const i of main.verts) {
      const px = sb.x[i * 3] - main.com[0], pz = sb.x[i * 3 + 2] - main.com[2];
      const X = sb.X[i * 3] - rx, Z = sb.X[i * 3 + 2] - rz;
      sxx += sb.m[i] * (px * X + pz * Z);
      sxz += sb.m[i] * (px * Z - pz * X);
    }
    this.yaw = Math.atan2(sxz, sxx);
    this.cx = cx;
    this.cz = cz;
    this.qF = new THREE.Quaternion().setFromAxisAngle(UP, this.yaw);
    this._plan();
    sb.attract = { targets: this.targets, n: sb.nV, rate: 0 };
    sb.collisionsEnabled = false;
    // an immediate soft shimmer so the heal is felt the moment it starts
    for (let r = 0; r < sb.rCount; r++) {
      const i = sb.rSim[r];
      sb.glow[i] = Math.max(sb.glow[i], sb.rTag[r] === 0 ? 0.45 : 0.22);
    }
    // blasted-off blobs stream home to arrive as the pieces meet
    app.droplets.heal(this.cW.clone(), TL.flyStart - 0.35, 1.15);
    app.audio?.healStart();
  }

  // Per-piece keyframes: where it is now (fitted rigid transform), where it
  // hovers in the exploded view, where it belongs in the cube.
  _plan() {
    const sb = this.app.sb;
    const half = sb.p.size / 2;
    const k = this.scaleK;
    this.cW = new THREE.Vector3(this.cx, half + LIFT_FUSE, this.cz);
    const plan = [];
    let seed = 99991;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const a = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (const pc of sb.pieces) {
      const vs = pc.verts;
      let m = 0;
      const C = new THREE.Vector3(), c = new THREE.Vector3();
      for (const i of vs) {
        const w = sb.m[i];
        m += w;
        C.x += sb.X[i * 3] * w; C.y += sb.X[i * 3 + 1] * w; C.z += sb.X[i * 3 + 2] * w;
        c.x += sb.x[i * 3] * w; c.y += sb.x[i * 3 + 1] * w; c.z += sb.x[i * 3 + 2] * w;
      }
      if (m <= 0) continue;
      C.multiplyScalar(1 / m);
      c.multiplyScalar(1 / m);
      a[0].set(0, 0, 0); a[1].set(0, 0, 0); a[2].set(0, 0, 0);
      for (const i of vs) {
        const w = sb.m[i];
        const dx = (sb.x[i * 3] - c.x) * w, dy = (sb.x[i * 3 + 1] - c.y) * w, dz = (sb.x[i * 3 + 2] - c.z) * w;
        const X = sb.X[i * 3] - C.x, Y = sb.X[i * 3 + 1] - C.y, Z = sb.X[i * 3 + 2] - C.z;
        a[0].x += dx * X; a[0].y += dy * X; a[0].z += dz * X;
        a[1].x += dx * Y; a[1].y += dy * Y; a[1].z += dz * Y;
        a[2].x += dx * Z; a[2].y += dy * Z; a[2].z += dz * Z;
      }
      const q0 = fitRotation(a[0], a[1], a[2], this.qF.clone());
      // final place in the cube, and an exploded hover spot just outside it
      const off = C.clone().multiplyScalar(k).applyQuaternion(this.qF);
      const cF = this.cW.clone().add(off);
      const dist = off.length();
      // spread mostly sideways so the exploded view stays in frame
      const dir = dist > 1e-4 ? new THREE.Vector3(off.x, off.y * 0.45, off.z).normalize() : new THREE.Vector3();
      const spread = 0.38 * smooth(0.02, 0.32, dist / Math.max(k, 0.3));
      const cE = cF.clone().addScaledVector(dir, spread).addScaledVector(UP, LIFT_HOVER - LIFT_FUSE);
      plan.push({
        verts: vs,
        C,
        c0: c,
        q0,
        cE,
        cF,
        // a little ripple: pieces nearer the middle lead, the rest follow
        delay: TL.stagger * (0.35 * rnd() + 0.65 * Math.min(1, dist / 0.6)),
      });
    }
    this.plan = plan;
    this.planTopo = sb.topoVersion;
    if (!this.targets || this.targets.length < sb.nV * 3) this.targets = new Float64Array(sb.vCap * 3);
    // targets start where the vertices are (no jump on the first frame)
    this.targets.set(sb.x.subarray(0, sb.nV * 3));
  }

  // Animate the targets every frame along the keyframed paths.
  _updateTargets(t) {
    const sb = this.app.sb;
    const tg = this.targets, X = sb.X;
    const k = this.scaleK;
    const q = new THREE.Quaternion(), ctr = new THREE.Vector3(), v = new THREE.Vector3();
    for (const p of this.plan) {
      const uB = smoother((t - TL.expandStart - p.delay) / TL.expandDur);
      const uC = smoother((t - TL.flyStart - p.delay * 0.6) / TL.flyDur);
      // drift out on a gentle arc while turning to the final orientation
      ctr.lerpVectors(p.c0, p.cE, uB).addScaledVector(UP, 0.08 * Math.sin(Math.PI * uB));
      ctr.lerp(p.cF, uC);
      q.slerpQuaternions(p.q0, this.qF, uB);
      const s = 1 + (k - 1) * uB;
      for (const i of p.verts) {
        v.set((X[i * 3] - p.C.x) * s, (X[i * 3 + 1] - p.C.y) * s, (X[i * 3 + 2] - p.C.z) * s).applyQuaternion(q).add(ctr);
        tg[i * 3] = v.x;
        tg[i * 3 + 1] = v.y;
        tg[i * 3 + 2] = v.z;
      }
    }
  }

  update(dt) {
    const app = this.app;
    const sb = app.sb;
    if (this.settling) {
      // lower the reformed cube gently onto the table
      this.settleT += dt;
      const u = smooth(0, TL.settle, this.settleT);
      sb.gravityScale = u * u;
      app.healZoom = 0.1 * (1 - u);
      if (this.settleT >= TL.settle) {
        this.settling = false;
        sb.gravityScale = 1;
        app.healZoom = 0;
      }
    }
    if (!this.active) return;
    this.t += dt;
    const t = this.t;
    // thaw / cool / deflate
    const kk = Math.exp(-dt * 2.4);
    for (let i = 0; i < sb.nV; i++) sb.temp[i] *= kk;
    for (let t2 = 0; t2 < sb.nT; t2++) sb.tVS[t2] = 1 + (sb.tVS[t2] - 1) * kk;
    sb.heatActive = true;
    sb._heatResidual = 1;
    if (this.fused) return;
    // a tool effect landing mid-heal (e.g. a mallet strike) changes the
    // pieces: re-plan from wherever things are now and keep the timeline
    if (sb.topoVersion !== this.planTopo) {
      this._plan();
      sb.attract = { targets: this.targets, n: sb.nV, rate: sb.attract ? sb.attract.rate : 0 };
    }
    this._updateTargets(t);
    sb.attract.n = sb.nV;
    sb.attract.rate = 16 * smooth(0, 0.5, t);
    sb.gravityScale = 1 - smooth(0, 0.4, t);
    sb.dampBoost = 1 + 1.6 * smooth(0, 0.5, t);
    app.healZoom = 0.1 * smooth(0.1, 0.9, t);
    // seams light up as the pieces close in
    const g = smooth(TL.flyStart - 0.2, TL.flyStart + TL.flyDur, t);
    if (g > 0) {
      for (let r = 0; r < sb.rCount; r++) {
        if (sb.rTag[r] === 0) {
          const i = sb.rSim[r];
          sb.glow[i] = Math.max(sb.glow[i], 0.15 + 0.85 * g);
        }
      }
    }
    if (!this.gathered && t > TL.flyStart) {
      this.gathered = true;
      app.audio?.healGather?.();
    }
    if (Math.random() < 0.45 + 0.4 * g) {
      const p = this.plan[Math.floor(Math.random() * this.plan.length)];
      if (p) app.particles?.glitter(p.c0.clone().lerp(p.cF, g), 1);
    }
    const end = TL.flyStart + TL.flyDur + TL.stagger;
    if ((t > end && this._maxError() < 0.025) || t > end + 0.45) this._fuse();
  }

  _maxError() {
    const sb = this.app.sb;
    const tg = this.targets;
    let m = 0;
    for (let i = 0; i < sb.nV; i++) {
      if (!sb.alive[i]) continue;
      const dx = sb.x[i * 3] - tg[i * 3], dy = sb.x[i * 3 + 1] - tg[i * 3 + 1], dz = sb.x[i * 3 + 2] - tg[i * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d > m) m = d;
    }
    return Math.sqrt(m);
  }

  _fuse() {
    const app = this.app;
    const sb = app.sb;
    // remember where the seams were (rest space) so they can glow after fusing
    const seams = [];
    for (let r = 0; r < sb.rCount; r++) {
      if (sb.rTag[r] === 0) {
        const i = sb.rSim[r];
        seams.push(sb.X[i * 3], sb.X[i * 3 + 1], sb.X[i * 3 + 2]);
      }
    }
    sb.attract = null;
    sb.loadCube(this.cx, LIFT_FUSE, this.cz, this.yaw);
    sb.collisionsEnabled = true;
    sb.dampBoost = 1;
    sb.gravityScale = 0;
    if (seams.length) {
      const cell = 0.06 * this.scaleK;
      const grid = new Set();
      for (let k = 0; k < seams.length; k += 3) {
        grid.add(`${Math.floor((seams[k] * this.scaleK) / cell)},${Math.floor((seams[k + 1] * this.scaleK) / cell)},${Math.floor((seams[k + 2] * this.scaleK) / cell)}`);
      }
      for (let i = 0; i < sb.nV; i++) {
        const gx = Math.floor(sb.X[i * 3] / cell), gy = Math.floor(sb.X[i * 3 + 1] / cell), gz = Math.floor(sb.X[i * 3 + 2] / cell);
        let near = false;
        for (let a = -1; a <= 1 && !near; a++)
          for (let b = -1; b <= 1 && !near; b++)
            for (let c = -1; c <= 1 && !near; c++) if (grid.has(`${gx + a},${gy + b},${gz + c}`)) near = true;
        sb.glow[i] = near ? 1.0 : 0.12;
      }
    } else {
      sb.glow.fill(0.25, 0, sb.nV);
    }
    this.fused = true;
    this.active = false;
    this.settling = true;
    this.settleT = 0;
    for (const f of app.onHealEnd) f();
    app.onTopologyChanged();
    app.markHealed();
    app.audio?.healFuse();
    const ctr = new THREE.Vector3(this.cx, sb.p.size / 2 + LIFT_FUSE, this.cz);
    app.particles?.flash(ctr, 0.9 * sb.p.size, [2.4, 2.1, 1.7]);
    for (let k = 0; k < 28; k++) app.particles?.glitter(ctr, 1, [1, 0.92, 0.75], 1.2);
  }
}
