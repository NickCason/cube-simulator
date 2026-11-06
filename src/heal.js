import * as THREE from 'three';

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// The heal sequence: eject foreign objects, cool/thaw, pull every fragment
// back to where it belongs in a levitating cube, then fuse the topology
// back into one pristine mesh with glowing seams.
export class Healer {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.t = 0;
  }

  start() {
    if (this.active) return;
    const app = this.app;
    const sb = app.sb;
    this.active = true;
    this.t = 0;
    this.fused = false;
    this.ejected = app.nails.ejectAll();
    app.tools?.onHealStart?.();
    for (const f of app.onHealStart) f();
    sb.endGrab();
    // destination: upright cube under the centre of mass, yaw of the biggest piece
    let M = 0, cx = 0, cz = 0;
    for (const pc of sb.pieces) {
      M += pc.mass;
      cx += pc.com[0] * pc.mass;
      cz += pc.com[2] * pc.mass;
    }
    cx /= M || 1;
    cz /= M || 1;
    const R = sb.p.arenaRadius - 0.75;
    const r = Math.hypot(cx, cz);
    if (r > R) {
      cx *= R / r;
      cz *= R / r;
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
    this.lift = 0.14;
    const n = sb.nV;
    const tg = new Float64Array(n * 3);
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const half = sb.p.size / 2;
    for (let i = 0; i < n; i++) {
      const X = sb.X[i * 3], Y = sb.X[i * 3 + 1], Z = sb.X[i * 3 + 2];
      tg[i * 3] = cx + c * X + s * Z;
      tg[i * 3 + 1] = Y + half + this.lift;
      tg[i * 3 + 2] = cz - s * X + c * Z;
    }
    this.targets = tg;
    this.vStart = sb.temp.slice(0, n);
    this.vsStart = sb.tVS.slice(0, sb.nT);
    app.audio?.healStart();
  }

  update(dt) {
    if (this.settling) {
      const sb = this.app.sb;
      sb.gravityScale = Math.min(1, sb.gravityScale + dt * 6);
      if (sb.gravityScale >= 1) this.settling = false;
    }
    if (!this.active) return;
    const app = this.app;
    const sb = app.sb;
    this.t += dt;
    const t = this.t;
    // thaw / cool / deflate
    const k = Math.exp(-dt * 3.5);
    for (let i = 0; i < sb.nV; i++) sb.temp[i] *= k;
    for (let t2 = 0; t2 < sb.nT; t2++) sb.tVS[t2] = 1 + (sb.tVS[t2] - 1) * k;
    sb.heatActive = true;
    sb._heatResidual = 1;

    if (!this.fused) {
      const startPull = this.ejected ? 0.42 : 0.12;
      if (t > startPull) {
        const u = smooth(startPull, startPull + 0.9, t);
        sb.attract = { targets: this.targets, n: this.targets.length / 3, rate: 1.5 + 34 * u * u };
        sb.gravityScale = 1 - smooth(startPull, startPull + 0.25, t);
        sb.collisionsEnabled = false;
        sb.dampBoost = 1 + 4 * u;
        // seams light up as they close
        for (let r = 0; r < sb.rCount; r++) {
          if (sb.rTag[r] === 0) {
            const i = sb.rSim[r];
            sb.glow[i] = Math.min(1, sb.glow[i] + dt * 3 * u + 0.002);
          }
        }
        if (Math.random() < 0.5) {
          const pc = sb.pieces[Math.floor(Math.random() * sb.pieces.length)];
          if (pc) app.particles?.glitter(new THREE.Vector3(...pc.com), 1);
        }
        const err = this._maxError();
        if ((t > startPull + 0.7 && err < 0.03) || t > startPull + 1.35) this._fuse();
      }
    }
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
    sb.loadCube(this.cx, this.lift, this.cz, this.yaw);
    sb.collisionsEnabled = true;
    sb.dampBoost = 1;
    sb.gravityScale = 0.2;
    // seam glow: vertices near former cut surfaces
    if (seams.length) {
      const cell = 0.06;
      const grid = new Map();
      for (let k = 0; k < seams.length; k += 3) {
        const key = `${Math.floor(seams[k] / cell)},${Math.floor(seams[k + 1] / cell)},${Math.floor(seams[k + 2] / cell)}`;
        grid.set(key, true);
      }
      for (let i = 0; i < sb.nV; i++) {
        const gx = Math.floor(sb.X[i * 3] / cell), gy = Math.floor(sb.X[i * 3 + 1] / cell), gz = Math.floor(sb.X[i * 3 + 2] / cell);
        let near = false;
        for (let a = -1; a <= 1 && !near; a++)
          for (let b = -1; b <= 1 && !near; b++)
            for (let c = -1; c <= 1 && !near; c++) if (grid.has(`${gx + a},${gy + b},${gz + c}`)) near = true;
        sb.glow[i] = near ? 0.9 : 0;
      }
    } else {
      sb.glow.fill(0.25, 0, sb.nV);
    }
    // a little squash so it settles with a wobble
    for (let i = 0; i < sb.nV; i++) sb.v[i * 3 + 1] -= 0.8 + 0.6 * (sb.X[i * 3 + 1] + 0.5);
    this.fused = true;
    this.fuseT = this.t;
    this.active = false;
    this.settling = true;
    for (const f of app.onHealEnd) f();
    app.onTopologyChanged();
    app.markHealed();
    app.audio?.healFuse();
    app.particles?.flash(new THREE.Vector3(this.cx, 0.6, this.cz), 0.9, [3, 2.6, 2.0]);
    for (let k = 0; k < 24; k++) app.particles?.glitter(new THREE.Vector3(this.cx, 0.5 + this.lift, this.cz), 1, [1, 0.9, 0.7], 1.2);
  }
}
