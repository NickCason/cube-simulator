// Flour: what's on the floor - a dusting over a square of it, thicker where
// more fell (see FlourTool) - and what's stuck to the jelly (each vertex's
// dust: SoftBody.dust), and how it goes from one to the other. Jelly's
// tacky: resting or rolling on floured floor it takes it up where it
// touches (a clean print left behind); floured, on bare floor, it leaves
// prints of it. A knock on floured floor sends up a puff. A full re-cube,
// or another place, sweeps it away.

import * as THREE from 'three';
import { resolveFlavor } from '../styles.js';

const N = 384, SPAN = 6.4, HALF = SPAN / 2, CELL = SPAN / N; // (1.7 cm a texel)
const PICK = 7; // (1/s) how fast jelly takes up the flour it's on
const GAIN = 2.5; // (on the jelly, what it took from the floor shows this much thicker)
const PRINT = 0.05; // (m) a vertex's footprint, its share of what it's on (as far apart as they are, more or less)
const ON_FLOOR = 0.006; // (m) a vertex this low is on the floor
const rnd = (a, b) => a + Math.random() * (b - a);

export class Flour {
  constructor(app) {
    this.app = app;
    this.map = new Float32Array(N * N);
    this.bytes = new Uint8Array(N * N);
    this.tex = new THREE.DataTexture(this.bytes, N, N, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    const fx = app.jelly.fxUniforms;
    fx.flour.value = this.tex;
    fx.flourRect.value.set(-HALF, -HALF, 1 / SPAN, 1 / SPAN);
    this.any = false; // (any on the floor)
    this.dusty = false; // (any on the jelly)
    this.dirty = false;
    this._upT = 0;
    this.sweeping = 0;
    // (re-cubed, all of them: swept away - the floor too)
    app.onHealEnd.push(() => {
      if (!(app.healer.only >= 0)) this.sweep();
      for (const cb of app.cubes) cb.floured = false;
    });
  }

  // (texel of x, z: -1 off the square)
  _cell(x, z) {
    const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL);
    return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
  }

  at(x, z) {
    const c = this._cell(x, z);
    return c < 0 ? 0 : this.map[c];
  }

  // Flour onto the floor at x, z: amt at the middle, less out to r.
  add(x, z, amt, r = 0.02) {
    this._splat(x, z, amt, r);
    if (amt > 0) this.any = true;
  }

  _splat(x, z, amt, r) {
    const M = this.map, R = Math.max(1, Math.ceil(r / CELL)), ci = Math.floor((x + HALF) / CELL), cj = Math.floor((z + HALF) / CELL);
    const k = 1 / (r * r);
    for (let j = cj - R; j <= cj + R; j++) {
      if (j < 0 || j >= N) continue;
      for (let i = ci - R; i <= ci + R; i++) {
        if (i < 0 || i >= N) continue;
        const dx = (i + 0.5) * CELL - HALF - x, dz = (j + 0.5) * CELL - HALF - z, d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        const c = j * N + i;
        M[c] = Math.min(1.5, Math.max(0, M[c] + amt * Math.exp(-2.5 * d2 * k)));
      }
    }
    this.dirty = true;
  }

  // all of it away (it fades out over a moment)
  sweep() {
    if (this.any) this.sweeping = 1;
  }

  update(dt) {
    const app = this.app, sb = app.sb;
    if (this.sweeping > 0) {
      const k = Math.exp(-dt * 7), M = this.map;
      for (let c = 0; c < M.length; c++) M[c] *= k;
      this.sweeping -= dt * 1.6;
      if (this.sweeping <= 0) {
        M.fill(0);
        this.any = false;
        this.sweeping = 0;
      }
      this.dirty = true;
    }
    if (dt > 0 && (this.any || this.dusty)) this._exchange(dt, sb);
    if (this.any && dt > 0) this._puffs(sb);
    // (up to the GPU: 20 times a second at most, while it's changing)
    this._upT += dt;
    if (this.dirty && this._upT > 0.05) {
      this._upT = 0;
      this.dirty = false;
      const M = this.map, B = this.bytes;
      for (let c = 0; c < M.length; c++) B[c] = Math.min(255, (M[c] * 200) | 0);
      this.tex.needsUpdate = true;
    }
  }

  // Flour onto the jelly round a point on it (on piece k): the surface
  // vertices within r of it, more nearer - see FlourTool.
  coatAround(px, py, pz, k, amt, r) {
    const sb = this.app.sb, pc = sb.pieces[k];
    if (!pc) return;
    const surf = this._surf(sb), x = sb.x, r2 = r * r;
    for (const i of pc.verts) {
      if (!surf[i]) continue;
      const dx = x[i * 3] - px, dy = x[i * 3 + 1] - py, dz = x[i * 3 + 2] - pz, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < r2) this.coat(i, amt * Math.exp((-2.2 * d2) / r2));
    }
  }

  // (which vertices are on the surface)
  _surf(sb) {
    if (this._surfTopo !== sb.topoVersion || this._surfCv !== sb.cubeVersion || !this._surfM || this._surfM.length < sb.nV) {
      this._surfTopo = sb.topoVersion;
      this._surfCv = sb.cubeVersion;
      const M = (this._surfM = new Uint8Array(Math.max(sb.nV, 1)));
      for (let f = 0; f < sb.nF * 3; f++) M[sb.sTri[f]] = 1;
    }
    return this._surfM;
  }

  // Flour onto the jelly at vertex i.
  coat(i, amt) {
    const sb = this.app.sb, D = sb.dust;
    if (D[i] <= 0.002) this._floured(sb.vCube[i]);
    D[i] = Math.min(1, D[i] + amt);
    this.dusty = true;
  }

  // (a cube with flour on it now: a layered one's coat needs the rest
  // point in its own target, where the line of sight leaves it - see
  // App.applyStyle's needRest)
  _floured(slot) {
    const cb = this.app.cubes.find((c) => c.slot === slot);
    if (!cb || cb.floured) return;
    cb.floured = true;
    if (resolveFlavor(cb.style).layers) this.app.jelly.needRest = true;
    // (for its record: floured)
    if (cb === this.app.cube) this.app.tally?.('floured');
  }

  // Jelly on the floor. Tacky: it takes up the flour it's on (a clean
  // print left), as much as it holds. Floured, on bare floor, it leaves a
  // print of it - where it comes down, and again as it slides on.
  _exchange(dt, sb) {
    const x = sb.x, D = sb.dust, alive = sb.alive, pick = 1 - Math.exp(-PICK * dt);
    if (!this.touch || this.touch.length < sb.nV) {
      this.touch = new Uint8Array(sb.vCap);
      this.lastP = new Float32Array(sb.vCap * 2);
    }
    if (this._cv !== sb.cubeVersion || this._topo !== sb.topoVersion) {
      this._cv = sb.cubeVersion;
      this._topo = sb.topoVersion;
      this.touch.fill(0);
    }
    // (each cube's print: about as wide as its vertices are apart)
    const pr = this._pr || (this._pr = new Float32Array(8));
    for (const cb of this.app.cubes) pr[cb.slot] = (0.62 * sb.cSize[cb.slot]) / Math.max(1, sb.cRes[cb.slot] - 1);
    let dusty = false;
    for (let i = 0; i < sb.nV; i++) {
      const d = D[i];
      if (d > 0.002) dusty = true;
      if (!alive[i] || x[i * 3 + 1] > ON_FLOOR) {
        this.touch[i] = 0;
        continue;
      }
      const px = x[i * 3], pz = x[i * 3 + 2], f = this.at(px, pz), r = pr[sb.vCube[i]] || PRINT;
      if (f > 0.02 + 0.4 * d && d < 1) {
        // (the jelly holds it thicker than it lies: what's under a
        // vertex's print coats all its share of the surface)
        const t = Math.min(f, (1 - d) / GAIN) * pick;
        if (d <= 0.002) this._floured(sb.vCube[i]);
        D[i] = Math.min(1, d + t * GAIN);
        this._splat(px, pz, -t * 0.7, r);
        dusty = true;
      } else if (d > 0.12) {
        const o = i * 2;
        if (!this.touch[i] || Math.hypot(px - this.lastP[o], pz - this.lastP[o + 1]) > r) {
          const g = d * 0.18;
          D[i] = d - g * 0.4;
          this._splat(px, pz, g, r);
          this.lastP[o] = px;
          this.lastP[o + 1] = pz;
          this.any = true;
        }
      }
      this.touch[i] = 1;
    }
    this.dusty = dusty;
  }

  // A knock on floured floor: a puff of it goes up, and some's knocked
  // out from there.
  _puffs(sb) {
    for (const im of sb.impacts) {
      if (im.kind !== 'floor' || !(im.dv > 0.7)) continue;
      const f = this.at(im.x, im.z);
      if (f < 0.05) continue;
      const n = Math.min(14, Math.round(im.dv * f * 5));
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2, s = rnd(0.15, 0.5) * Math.min(2.5, im.dv);
        this.app.particles.alpha.spawn(im.x + Math.cos(a) * 0.03, 0.01, im.z + Math.sin(a) * 0.03, Math.cos(a) * s, rnd(0.25, 0.7) * Math.min(2, im.dv), Math.sin(a) * s,
          rnd(0.9, 1.8), rnd(0.03, 0.05), rnd(0.12, 0.22), [0.97, 0.96, 0.93, 0.5], [1, 1, 0.98, 0], 2.2, -0.15);
      }
      // (blown out from under it)
      const take = Math.min(f, 0.25 * Math.min(1, im.dv / 3));
      this._splat(im.x, im.z, -take, 0.06);
      for (let k = 0; k < 5; k++) {
        const a = Math.random() * Math.PI * 2, r = rnd(0.07, 0.16);
        this._splat(im.x + Math.cos(a) * r, im.z + Math.sin(a) * r, take * 0.3, 0.035);
      }
    }
  }
}
