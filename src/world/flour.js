// Powder - flour, sugar, cocoa, sprinkles, glitter... (see powders.js) -
// what's on the floor (over a square of it, thicker where more fell: see
// FlourTool) and what's stuck to the jelly (each vertex's: SoftBody.dust,
// how much, and SoftBody.coat, what), and how it goes from one to the
// other. Jelly's tacky: resting or rolling on powdered floor it takes it up
// where it touches (a clean print left behind); powdered, on bare floor,
// it leaves prints of it. A knock on powdered floor sends up a puff. A
// full re-cube, or another place, sweeps it away.
//
// What's where is kept as the amount and, each times the amount (so that
// mixed, they average by how much of each), its colour, sparkle and multi.

import * as THREE from 'three';
import { resolveFlavor } from '../styles.js';
import { POWDERS } from './powders.js';

const N = 384, SPAN = 6.4, HALF = SPAN / 2, CELL = SPAN / N; // (1.7 cm a texel)
const MAX = 1.5; // (as thick as it piles on the floor)
const BYTE = 255 / MAX;
const PICK = 7; // (1/s) how fast jelly takes up the powder it's on
const GAIN = 2.5; // (on the jelly, what it took from the floor shows this much thicker)
const PRINT = 0.05; // (m) a vertex's footprint, its share of what it's on (as far apart as they are, more or less)
const ON_FLOOR = 0.006; // (m) a vertex this low is on the floor
const rnd = (a, b) => a + Math.random() * (b - a);
const FLOUR = [...POWDERS[0].lin, POWDERS[0].sparkle, POWDERS[0].multi];

export class Flour {
  constructor(app) {
    this.app = app;
    // the floor: amount, and colour (r g b), sparkle, multi - each times it
    this.map = new Float32Array(N * N);
    this.look = new Float32Array(N * N * 5);
    // ...and to the GPU: (r g b times it, it) and (sparkle, multi times it)
    this.bytes = new Uint8Array(N * N * 4);
    this.bytes2 = new Uint8Array(N * N * 4);
    const tex = (b) => {
      const t = new THREE.DataTexture(b, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      return t;
    };
    this.tex = tex(this.bytes);
    this.tex2 = tex(this.bytes2);
    const fx = app.jelly.fxUniforms;
    fx.flour.value = this.tex;
    fx.flour2.value = this.tex2;
    fx.flourRect.value.set(-HALF, -HALF, 1 / SPAN, 1 / SPAN);
    this.any = false; // (any on the floor)
    this.dusty = false; // (any on the jelly)
    this._dirty = null; // (texels changed since they went up: i0, j0, i1, j1)
    this._upT = 0;
    this._lookT = 0;
    this.sweeping = 0;
    // (re-cubed, all of them: swept away - the floor too)
    app.onHealEnd.push(() => {
      if (!(app.healer.only >= 0)) this.sweep();
      for (const cb of app.cubes) {
        cb.floured = false;
        cb.coatRec = null;
      }
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

  // Powder onto the floor at x, z - look: [r, g, b, sparkle, multi] - amt
  // at the middle, less out to r.
  add(x, z, amt, r = 0.02, look = FLOUR) {
    this._splat(x, z, amt, r, look);
    if (amt > 0) this.any = true;
  }

  // (amt > 0: more of it, its look mixed in by how much; amt < 0: some of
  // what's there taken, its look as it was)
  _splat(x, z, amt, r, look = null) {
    const M = this.map, Lk = this.look, R = Math.max(1, Math.ceil(r / CELL)), ci = Math.floor((x + HALF) / CELL), cj = Math.floor((z + HALF) / CELL);
    const k = 1 / (r * r);
    const i0 = Math.max(0, ci - R), i1 = Math.min(N - 1, ci + R), j0 = Math.max(0, cj - R), j1 = Math.min(N - 1, cj + R);
    if (i0 > i1 || j0 > j1) return;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5) * CELL - HALF - x, dz = (j + 0.5) * CELL - HALF - z, d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        const c = j * N + i, a = amt * Math.exp(-2.5 * d2 * k), m = M[c], o = c * 5;
        if (a > 0) {
          const tot = m + a, f = Math.min(MAX, tot) / tot;
          for (let q = 0; q < 5; q++) Lk[o + q] = (Lk[o + q] + look[q] * a) * f;
          M[c] = Math.min(MAX, tot);
        } else if (m > 0) {
          const left = Math.max(0, m + a), f = left / m;
          for (let q = 0; q < 5; q++) Lk[o + q] *= f;
          M[c] = left;
        }
      }
    }
    const D = this._dirty;
    if (!D) this._dirty = [i0, j0, i1, j1];
    else {
      D[0] = Math.min(D[0], i0); D[1] = Math.min(D[1], j0);
      D[2] = Math.max(D[2], i1); D[3] = Math.max(D[3], j1);
    }
  }

  // (what's on the floor at texel c, taken: amount t of it - its look)
  _lookAt(c, out) {
    const m = this.map[c], o = c * 5;
    if (!(m > 1e-6)) return FLOUR;
    for (let q = 0; q < 5; q++) out[q] = this.look[o + q] / m;
    return out;
  }

  // all of it away (it fades out over a moment)
  sweep() {
    if (this.any) this.sweeping = 1;
  }

  update(dt) {
    const app = this.app, sb = app.sb;
    if (this.sweeping > 0) {
      const k = Math.exp(-dt * 7), M = this.map, Lk = this.look;
      for (let c = 0; c < M.length; c++) M[c] *= k;
      for (let c = 0; c < Lk.length; c++) Lk[c] *= k;
      this.sweeping -= dt * 1.6;
      if (this.sweeping <= 0) {
        M.fill(0);
        Lk.fill(0);
        this.any = false;
        this.sweeping = 0;
      }
      this._dirty = [0, 0, N - 1, N - 1];
    }
    if (dt > 0 && (this.any || this.dusty)) this._exchange(dt, sb);
    if (this.any && dt > 0) this._puffs(sb);
    // (up to the GPU: 20 times a second at most, while it's changing - just
    // the rows and columns that did)
    this._upT += dt;
    if (this._dirty && this._upT > 0.05) {
      this._upT = 0;
      this._upload(this._dirty);
      this._dirty = null;
    }
    // (each cube's powder, all told: its colour, for where the line of
    // sight leaves through it - see the jelly's exit coat)
    this._lookT += dt;
    if (this._lookT > 0.3) {
      this._lookT = 0;
      this._cubeLooks(sb);
    }
  }

  _upload([i0, j0, i1, j1]) {
    const M = this.map, Lk = this.look, B = this.bytes, B2 = this.bytes2;
    const full = (i1 - i0 + 1) * (j1 - j0 + 1) > (N * N) / 3;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * N + i, o = c * 4, l = c * 5;
        B[o] = Math.min(255, Lk[l] * BYTE + 0.5) | 0;
        B[o + 1] = Math.min(255, Lk[l + 1] * BYTE + 0.5) | 0;
        B[o + 2] = Math.min(255, Lk[l + 2] * BYTE + 0.5) | 0;
        B[o + 3] = Math.min(255, M[c] * BYTE + 0.5) | 0;
        B2[o] = Math.min(255, Lk[l + 3] * BYTE + 0.5) | 0;
        B2[o + 1] = Math.min(255, Lk[l + 4] * BYTE + 0.5) | 0;
      }
      if (!full) {
        this.tex.addUpdateRange((j * N + i0) * 4, (i1 - i0 + 1) * 4);
        this.tex2.addUpdateRange((j * N + i0) * 4, (i1 - i0 + 1) * 4);
      }
    }
    if (full) {
      this.tex.clearUpdateRanges();
      this.tex2.clearUpdateRanges();
    }
    this.tex.needsUpdate = true;
    this.tex2.needsUpdate = true;
  }

  // Powder onto the jelly round a point on it (on piece k): the surface
  // vertices within r of it, more nearer - see FlourTool.
  coatAround(px, py, pz, k, amt, r, look = FLOUR, rec = 'floured') {
    const sb = this.app.sb, pc = sb.pieces[k];
    if (!pc) return;
    const surf = this._surf(sb), x = sb.x, r2 = r * r;
    for (const i of pc.verts) {
      if (!surf[i]) continue;
      const dx = x[i * 3] - px, dy = x[i * 3 + 1] - py, dz = x[i * 3 + 2] - pz, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < r2) this.coat(i, amt * Math.exp((-2.2 * d2) / r2), look, rec);
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

  // Powder onto the jelly at vertex i (more than it holds: the newest
  // takes its share of what's there).
  coat(i, amt, look = FLOUR, rec = 'floured') {
    const sb = this.app.sb, D = sb.dust, C = sb.coat, d = D[i], o = i * 5;
    if (d <= 0.002) this._coated(sb.vCube[i], rec);
    const tot = d + amt, f = Math.min(1, tot) / tot;
    for (let q = 0; q < 5; q++) C[o + q] = (C[o + q] + look[q] * amt) * f;
    D[i] = Math.min(1, tot);
    this.dusty = true;
  }

  // (a cube with powder on it now: a layered one's coat needs the rest
  // point in its own target, where the line of sight leaves it - see
  // App.applyStyle's needRest - and its record has it)
  _coated(slot, rec) {
    const cb = this.app.cubes.find((c) => c.slot === slot);
    if (!cb) return;
    if (cb.coatRec !== rec && cb === this.app.cube) this.app.tally?.(rec);
    cb.coatRec = rec;
    if (cb.floured) return;
    cb.floured = true;
    if (resolveFlavor(cb.style).layers) this.app.jelly.needRest = true;
  }

  // Jelly on the floor. Tacky: it takes up the powder it's on (a clean
  // print left), as much as it holds. Powdered, on bare floor, it leaves a
  // print of it - where it comes down, and again as it slides on.
  _exchange(dt, sb) {
    const x = sb.x, D = sb.dust, C = sb.coat, alive = sb.alive, pick = 1 - Math.exp(-PICK * dt);
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
    const lk = this._lk || (this._lk = new Float32Array(5)), mine = this._mine || (this._mine = new Float32Array(5));
    let dusty = false;
    for (let i = 0; i < sb.nV; i++) {
      const d = D[i];
      if (d > 0.002) dusty = true;
      if (!alive[i] || x[i * 3 + 1] > ON_FLOOR) {
        this.touch[i] = 0;
        continue;
      }
      const px = x[i * 3], pz = x[i * 3 + 2], c = this._cell(px, pz), f = c < 0 ? 0 : this.map[c], r = pr[sb.vCube[i]] || PRINT;
      if (f > 0.02 + 0.4 * d && d < 1) {
        // (the jelly holds it thicker than it lies: what's under a
        // vertex's print coats all its share of the surface)
        const t = Math.min(f, (1 - d) / GAIN) * pick;
        this.coat(i, t * GAIN, this._lookAt(c, lk), this._recOf(lk));
        this._splat(px, pz, -t * 0.7, r);
        dusty = true;
      } else if (d > 0.12) {
        const o = i * 2;
        if (!this.touch[i] || Math.hypot(px - this.lastP[o], pz - this.lastP[o + 1]) > r) {
          const g = d * 0.18;
          for (let q = 0; q < 5; q++) mine[q] = C[i * 5 + q] / d;
          D[i] = d - g * 0.4;
          for (let q = 0; q < 5; q++) C[i * 5 + q] = mine[q] * D[i];
          this._splat(px, pz, g, r, mine);
          this.lastP[o] = px;
          this.lastP[o + 1] = pz;
          this.any = true;
        }
      }
      this.touch[i] = 1;
    }
    this.dusty = dusty;
  }

  // (the record a look goes down as: the powder it's nearest)
  _recOf(lk) {
    let best = POWDERS[0], bd = Infinity;
    for (const p of POWDERS) {
      if (p.rainbow) continue;
      const d = (p.lin[0] - lk[0]) ** 2 + (p.lin[1] - lk[1]) ** 2 + (p.lin[2] - lk[2]) ** 2 + (p.sparkle - lk[3]) ** 2 * 2 + (p.multi - lk[4]) ** 2 * 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    // (a bright colour none of them is: rainbow powder's)
    return bd > 0.08 ? 'rainbowed' : best.rec;
  }

  // Each cube's powder, all told - its colour, and how much it has - in its
  // row of the cube looks (JellyView's cubeData, column 30).
  _cubeLooks(sb) {
    const J = this.app.jelly, Dt = J.cubeData, W = Dt.length / 8; // (a row: CUBE_TEX_W * 4)
    const sum = this._sum || (this._sum = new Float64Array(8 * 4));
    sum.fill(0);
    if (this.dusty) {
      const D = sb.dust, C = sb.coat;
      for (let i = 0; i < sb.nV; i++) {
        const d = D[i];
        if (!(d > 0.002)) continue;
        const k = sb.vCube[i] * 4;
        sum[k] += C[i * 5]; sum[k + 1] += C[i * 5 + 1]; sum[k + 2] += C[i * 5 + 2]; sum[k + 3] += d;
      }
    }
    let changed = false;
    for (let k = 0; k < 8; k++) {
      const a = sum[k * 4 + 3], o = k * W + 30 * 4;
      const v = a > 0 ? [sum[k * 4] / a, sum[k * 4 + 1] / a, sum[k * 4 + 2] / a, Math.min(1, a / 6)] : [0, 0, 0, 0];
      for (let q = 0; q < 4; q++) {
        if (Math.abs(Dt[o + q] - v[q]) > 1e-3) changed = true;
        Dt[o + q] = v[q];
      }
    }
    if (changed) J.cubeTex.needsUpdate = true;
  }

  // A knock on powdered floor: a puff of it goes up (its colour), and
  // some's knocked out from there.
  _puffs(sb) {
    const lk = this._lk2 || (this._lk2 = new Float32Array(5));
    for (const im of sb.impacts) {
      if (im.kind !== 'floor' || !(im.dv > 0.7)) continue;
      const c = this._cell(im.x, im.z), f = c < 0 ? 0 : this.map[c];
      if (f < 0.05) continue;
      this._lookAt(c, lk);
      const n = Math.min(14, Math.round(im.dv * f * 5)), col = [lk[0], lk[1], lk[2], 0.5], col1 = [lk[0], lk[1], lk[2], 0];
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2, s = rnd(0.15, 0.5) * Math.min(2.5, im.dv);
        this.app.particles.alpha.spawn(im.x + Math.cos(a) * 0.03, 0.01, im.z + Math.sin(a) * 0.03, Math.cos(a) * s, rnd(0.25, 0.7) * Math.min(2, im.dv), Math.sin(a) * s,
          rnd(0.9, 1.8), rnd(0.03, 0.05), rnd(0.12, 0.22), col, col1, 2.2, -0.15);
      }
      // (blown out from under it)
      const take = Math.min(f, 0.25 * Math.min(1, im.dv / 3)), look = Float32Array.from(lk);
      this._splat(im.x, im.z, -take, 0.06);
      for (let k = 0; k < 5; k++) {
        const a = Math.random() * Math.PI * 2, r = rnd(0.07, 0.16);
        this._splat(im.x + Math.cos(a) * r, im.z + Math.sin(a) * r, take * 0.3, 0.035, look);
      }
      this.any = true;
    }
  }
}
