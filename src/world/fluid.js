import * as THREE from 'three';
import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';
import { removeTets } from '../sim/cutting.js';

// Molten jelly. The torch turns the hottest jelly to liquid (see
// TorchTool): its tets go, and particles carry their volume on - position-
// based fluids (Macklin & Mueller 2013: a density constraint per particle,
// pushing only - no pull, so no clumping to fix), thick with viscosity, running down the jelly that's
// left (pushed out of its tets along its escape field), pooling on the
// floor. It cools; the cryo spray cools it fast, and a clump of it cold
// enough sets: meshed back into jelly - a new piece in whatever shape the
// puddle had. Drawn as one smooth glossy surface: the particles splatted
// into a field on a grid round them, its level set by marching cubes.

const D = 0.065; // (m) particle spacing: each carries D^3 of jelly
const H = D * 1.75; // kernel radius
const R_P = D * 0.5; // collision radius
// marching cubes: corner offsets, edges' end corners
const MC_CX = [0, 1, 1, 0, 0, 1, 1, 0], MC_CY = [0, 0, 1, 1, 0, 0, 1, 1], MC_CZ = [0, 0, 0, 0, 1, 1, 1, 1];
const MC_EA = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3], MC_EB = [1, 2, 3, 0, 5, 6, 7, 4, 4, 5, 6, 7];
const SET_T = -0.25; // colder than this it sets
const SUB = 2; // substeps a frame
const ITER = 3; // solver rounds a substep
const MAXNB = 48; // neighbours kept per particle
const CELL_HASH = 1 << 14; // buckets for the jelly's tets near the liquid
const NB6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const VMAX = 7; // (m/s)
const GAIN = 0.8; // (m/s) the most the solver speeds a particle up a substep
const COH = 0.3; // cohesion: how hard thin parts pull together (vs packed parts pushing apart)
const EPS = +(globalThis.__fluidEps ?? 1); // constraint relaxation, x a full neighbourhood's gradient sum
const VISC = 0.25; // XSPH: how much each takes on its neighbours' velocity
// its surface: each particle a smooth bump out to SPLAT_R particles' spacing, the surface where they add up to
// SPLAT_ISO - wider bumps, a higher level: a smoother skin on it, a pool flat (at 1.6 and 0.55 it was lumpy,
// a heap of beads)
const SPLAT_R = +(globalThis.__splatR ?? 2.1), SPLAT_ISO = +(globalThis.__splatIso ?? 1.0);

export class Fluid {
  constructor(app) {
    this.app = app;
    const coarse = !!app.coarse;
    this.max = coarse ? 1000 : 1600; // (more than that boils off: see TorchTool._liquefy)
    const N = this.max;
    this.n = 0;
    this.x = new Float32Array(N * 3);
    this.q = new Float32Array(N * 3); // (predicted positions)
    this.v = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    this.temp = new Float32Array(N);
    // (acid: how strong it still is - 0, molten jelly - and the jelly's tet
    // it pressed into this frame, -1 none: see AcidTool)
    this.acid = new Float32Array(N);
    this.acidTet = new Int32Array(N).fill(-1);
    this.keepAwake = false; // (acid still working: the pool mustn't sleep)
    this.age = new Float32Array(N);
    this.lam = new Float32Array(N);
    this.dp = new Float32Array(N * 3);
    this.rho = new Float32Array(N);
    this.bank = 0; // (m^3) melted volume not yet a particle
    this.vol = D * D * D;
    // kernels
    this.K6 = 315 / (64 * Math.PI * H ** 9);
    this.KS = 45 / (Math.PI * H ** 6);
    // rest density: a particle inside a lattice at spacing D
    let rho0 = 0, g2 = 0;
    const r = Math.ceil(H / D);
    for (let i = -r; i <= r; i++)
      for (let j = -r; j <= r; j++)
        for (let k = -r; k <= r; k++) {
          const d2 = (i * i + j * j + k * k) * D * D;
          if (d2 >= H * H) continue;
          rho0 += this.K6 * (H * H - d2) ** 3;
          const d = Math.sqrt(d2);
          if (d > 1e-9) g2 += (this.KS * (H - d) ** 2) ** 2;
        }
    this.rho0 = rho0;
    this.eps = EPS * (g2 / (rho0 * rho0)); // (constraint relaxation, relative to a full neighbourhood's)
    // (with the pull, close pairs need a push of their own or they clump -
    // the tensile fix: as strong as a 25% squeeze at half the spacing)
    this.wDq = this.K6 * (H * H - (0.2 * H) ** 2) ** 3;
    const wHalf = this.K6 * (H * H - (0.5 * D) ** 2) ** 3;
    this.kCorr = 0.25 / ((g2 / (rho0 * rho0)) * (1 + EPS)) / (wHalf / this.wDq) ** 4;
    // neighbour grid (cells of H, counting sort into cellStart)
    this.cellOf = new Int32Array(N);
    this.order = new Int32Array(N);
    this.hashSize = 8192;
    this.cellStart = new Int32Array(this.hashSize + 1);
    this.seen = new Int32Array(N);
    this._stamp = 0;
    this.nb = new Int32Array(N * MAXNB);
    this.pw = new Float32Array(N * MAXNB); // (per neighbour, this round: the kernel's gradient factor)
    this.pc = new Float32Array(N * MAXNB); // (and the tensile push)
    this.coolT = 9; // (s) since the cryo last touched the liquid
    this.nbStart = new Int32Array(N + 1);
    this._g = new Float64Array(12);
    this._vv = new Float32Array(8);
    this._ex = new Float32Array(36);
    this._en = new Float32Array(36);
    this._ec = new Float32Array(36);
    this.asleep = false;
    this.stillT = 0;
    // the jelly's tets near the liquid (hashed by cells of 0.1 m)
    this.cStart = new Int32Array(CELL_HASH + 1);
    this._cFill = new Int32Array(CELL_HASH);
    this._cRange = new Int32Array(7 * 4096);
    this._tr = new Int32Array(6);
    this._cov = new Float64Array(6);
    this.cellsN = 0;
    this._cellVer = -1;
    // surface
    this.cell = coarse ? 0.045 : 0.035;
    this.maxV = coarse ? 54000 : 108000;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.maxV * 3);
    this.nrm = new Float32Array(this.maxV * 3);
    this.rgb = new Float32Array(this.maxV * 3);
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aNrm = new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.rgb, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('normal', this.aNrm);
    geo.setAttribute('color', this.aCol);
    geo.setDrawRange(0, 0);
    this.geo = geo;
    // Drawn as a liquid: what's behind it seen through it - the room, the floor, the jelly - bent by its
    // surface and tinted the deeper it is (the colours its jelly takes away, taken away more through more of
    // it: a thin film near clear, a pool rich), and on it the room's light, more of it edge-on, and a sharp
    // glint. (It was a glossy paint of its colour: lit, nearly opaque - no liquid in it.) Drawn on its own,
    // just after the room - what's behind it is the room's picture (App.render: tBg) - and before the jelly,
    // which sees it through itself. A copy of it, drawn only into the shadows, in the room for its shadow.
    const F = app.jelly.frontMat.uniforms;
    this.mat = new THREE.ShaderMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      uniforms: { tBg: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, envMap: { value: app.env.texture }, uLight: { value: app.lightDir }, uLightColor: F.uLightColor, uEmit: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        varying vec3 vN;
        varying vec3 vCol;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          vN = normalize(mat3(modelMatrix) * normal);
          vCol = color;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tBg;
        uniform vec2 uRes;
        uniform samplerCube envMap;
        uniform vec3 uLight;
        uniform vec3 uLightColor;
        uniform float uEmit;
        varying vec3 vW;
        varying vec3 vN;
        varying vec3 vCol;
        void main() {
          vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
          if (dot(N, V) < 0.0) N = -N;
          float ndv = clamp(dot(N, V), 0.0, 1.0);
          // how much of it the line of sight crosses: a pool on the floor as deep as its surface is high, a
          // run of it over the jelly a few cm - slanted through, more of it, seen edge-on
          float thick = vW.y < 0.15 ? max(vW.y, 0.004) : 0.035;
          float path = min(thick / max(ndv, 0.25), 0.3);
          // what's behind, bent by its surface - more the deeper
          vec3 Nv = normalize((viewMatrix * vec4(N, 0.0)).xyz);
          vec2 uv = gl_FragCoord.xy / uRes - Nv.xy * (0.012 + 0.07 * min(path / 0.12, 1.0));
          vec3 bg = texture2D(tBg, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
          // its colour: what its jelly lets through, the rest taken away along the way
          vec3 tint = max(vCol, vec3(0.015));
          vec3 through = bg * exp(log(tint) * (path * 7.0)) + vCol * 0.03;
          // the room's light off it, more edge-on; the light's glint
          float Fr = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
          vec3 R = reflect(-V, N);
          vec3 env = textureLod(envMap, R, 1.0).rgb;
          vec3 H = normalize(normalize(uLight) + V);
          float spec = pow(max(dot(N, H), 0.0), 260.0) * 7.0 * step(0.0, dot(N, uLight));
          vec3 c = through * (1.0 - Fr) + env * Fr * 0.9 + uLightColor * spec;
          // (glow mode: it shines in its own colours)
          c += vCol * uEmit * 1.2;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    // (its shadow: a copy in the room drawn only into the shadows - nothing of it on the screen)
    this.shadow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    this.shadow.frustumCulled = false;
    this.shadow.castShadow = true;
    this.shadow.visible = false;
    app.scene.add(this.shadow);
    this.drainT = 0; // (s) left of draining away (the heal)
    this._setClock = 0;
    app.onHealStart?.push(() => this._healStart());
    this.rc = null; // (called home by a heal: see recall)
  }

  setGlow(e) {
    this.mat.uniforms.uEmit.value = e;
  }

  // Melted jelly in: volume (m^3) at a point, moving at v, its colour (and
  // how strong an acid it is: see AcidTool). Volume collects until there's
  // a particle's worth.
  add(x, y, z, vol, vx, vy, vz, r, g, b, spread = 0.03, acid = 0) {
    this.bank += vol;
    spread = Math.max(spread, 0.004); // (never two in one spot)
    if (this.bank >= this.vol) this.wake();
    while (this.bank >= this.vol && this.n < this.max) {
      this.bank -= this.vol;
      const i = this.n++, o = i * 3;
      // (the best of a few spots: the one furthest from the liquid already there)
      let best = -1;
      for (let k = 0; k < 4; k++) {
        const cx = x + (Math.random() - 0.5) * spread, cy = Math.max(R_P, y + (Math.random() - 0.5) * spread), cz = z + (Math.random() - 0.5) * spread;
        let m = Infinity;
        for (let j = 0; j < i; j++) {
          const p = j * 3, dx = this.x[p] - cx, dy = this.x[p + 1] - cy, dz = this.x[p + 2] - cz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < m) m = d2;
        }
        if (m > best) {
          best = m;
          this.x[o] = cx; this.x[o + 1] = cy; this.x[o + 2] = cz;
        }
        if (m > D * D) break;
      }
      this.v[o] = vx; this.v[o + 1] = vy; this.v[o + 2] = vz;
      this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = b;
      this.temp[i] = acid > 0 ? 0 : 1;
      this.age[i] = 0;
      this.acid[i] = acid;
      this.acidTet[i] = -1;
    }
    if (this.n >= this.max) this.bank = 0;
    this.mesh.visible = this.n > 0;
  }

  // Where a ray first meets the liquid (each particle a ball of 0.06 m),
  // or null: { point, normal, distance }.
  pick(ray) {
    const o = ray.origin, d = ray.direction, r2 = 0.06 * 0.06, x = this.x;
    let best = Infinity, bi = -1;
    for (let i = 0; i < this.n; i++) {
      const px = x[i * 3] - o.x, py = x[i * 3 + 1] - o.y, pz = x[i * 3 + 2] - o.z;
      const t = px * d.x + py * d.y + pz * d.z;
      if (t <= 0) continue;
      const m2 = px * px + py * py + pz * pz - t * t;
      if (m2 >= r2) continue;
      const th = t - Math.sqrt(r2 - m2);
      if (th < best) {
        best = th;
        bi = i;
      }
    }
    if (bi < 0) return null;
    const point = ray.origin.clone().addScaledVector(d, best);
    const normal = point.clone().sub({ x: x[bi * 3], y: x[bi * 3 + 1], z: x[bi * 3 + 2] }).normalize();
    return { point, normal, distance: best };
  }

  // The cryo spray: cool what's within radius of p.
  cool(px, py, pz, radius, amount) {
    const r2 = radius * radius;
    let hit = false;
    for (let i = 0; i < this.n; i++) {
      const o = i * 3, dx = this.x[o] - px, dy = this.x[o + 1] - py, dz = this.x[o + 2] - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      this.temp[i] = Math.max(-1, this.temp[i] - amount * (1 - d2 / r2));
      hit = true;
    }
    if (hit) {
      this.coolT = 0;
      this.wake();
    }
    return hit;
  }

  drain() {
    if (this.n) this.drainT = 0.6;
  }

  // A re-cube: the jelly that set from it melted back into it first (a
  // re-cube makes the cube again from all it was, this included), then it
  // drains away - unless the heal calls it home (recall: a cube on its own).
  _healStart() {
    this._meltSet();
    this.drain();
  }

  // The jelly that set from it (_toJelly: its corners marked 2 in sb.melt)
  // as liquid again, where it lies.
  _meltSet() {
    const app = this.app, sb = app.sb, T = sb.T, pcs = new Set();
    for (const pc of sb.pieces) {
      let n2 = 0;
      for (const i of pc.verts) if (sb.melt[i] === 2) n2++;
      if (n2 >= 0.6 * pc.verts.length) pcs.add(pc.id);
    }
    if (!pcs.size) return;
    const set = new Set(), col = new THREE.Color();
    for (let t = 0; t < sb.nT; t++) {
      if (!(sb.vol0[t] > 0) || !pcs.has(sb.tPiece[t])) continue;
      set.add(t);
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 4; k++) {
        const o = T[t * 4 + k] * 3;
        cx += sb.x[o] / 4; cy += sb.x[o + 1] / 4; cz += sb.x[o + 2] / 4;
      }
      col.set(app.flavorColorAtVertex(T[t * 4]));
      this.add(cx, cy, cz, sb.vol0[t], 0, 0, 0, col.r, col.g, col.b, 0.01);
    }
    removeTets(sb, (t) => set.has(t), app.allAnchors());
    app.onTopologyChanged();
  }

  // The heal (see Healer.start): it flows home - each drop off on its own
  // arc, after a wait (delay, give or take - the nearest first), drawn as
  // it goes, gone into the cube as it gets there. target(out): somewhere to
  // go; retarget (the cube's holes known: see Healer._sendDroplets) sends
  // those still to go into them.
  recall(target, delay = 1) {
    this.drainT = 0;
    if (!this.n) return;
    const n = this.n, P = new THREE.Vector3(), x = this.x;
    this.rc = { t: 0, p0: Float32Array.from(x.subarray(0, n * 3)), p1: new Float32Array(this.max * 3), t0: new Float32Array(this.max), T: new Float32Array(this.max), h: new Float32Array(this.max) };
    for (let i = 0; i < n; i++) {
      target(P);
      this.rc.p1.set([P.x, P.y, P.z], i * 3);
      const d = Math.hypot(P.x - x[i * 3], P.z - x[i * 3 + 2]);
      this.rc.t0[i] = delay * (0.75 + 0.35 * Math.random()) + Math.min(0.5, d * 0.12);
      this.rc.T[i] = 0.7 + 0.25 * Math.random() + Math.min(0.5, d * 0.15);
      this.rc.h[i] = 0.15 + 0.25 * Math.min(1.5, d);
    }
    this.asleep = false;
    this.mesh.visible = true;
  }

  retarget(target) {
    if (!this.rc) return;
    const P = new THREE.Vector3();
    for (let i = 0; i < this.n; i++) {
      target(P);
      this.rc.p1.set([P.x, P.y, P.z], i * 3);
    }
  }

  // (a frame of it flowing home: along its arc, eased; there - gone)
  _recallStep(dt) {
    const R = this.rc, x = this.x;
    R.t += dt;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const u = (R.t - R.t0[i]) / R.T[i];
      if (u >= 1) continue;
      if (u > 0) {
        const e = u * u * (3 - 2 * u), lift = R.h[i] * 4 * u * (1 - u);
        for (let c = 0; c < 3; c++) x[i * 3 + c] = R.p0[i * 3 + c] + (R.p1[i * 3 + c] - R.p0[i * 3 + c]) * e + (c === 1 ? lift : 0);
      }
      if (w !== i) {
        for (let c = 0; c < 3; c++) {
          x[w * 3 + c] = x[i * 3 + c];
          this.col[w * 3 + c] = this.col[i * 3 + c];
          R.p0[w * 3 + c] = R.p0[i * 3 + c];
          R.p1[w * 3 + c] = R.p1[i * 3 + c];
        }
        this.temp[w] = this.temp[i];
        this.age[w] = this.age[i];
        this.acid[w] = this.acid[i];
        this.acidTet[w] = this.acidTet[i];
        R.t0[w] = R.t0[i];
        R.T[w] = R.T[i];
        R.h[w] = R.h[i];
      }
      w++;
    }
    this.n = w;
    this.v.fill(0, 0, w * 3);
    if (!w) {
      this.rc = null;
      this.clear();
      return;
    }
    this._remesh();
  }

  // Particles gone where drop(i) says (spent acid fuming off: see AcidTool).
  removeWhere(drop) {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      if (drop(i)) continue;
      if (w !== i) {
        for (let c = 0; c < 3; c++) {
          this.x[w * 3 + c] = this.x[i * 3 + c];
          this.v[w * 3 + c] = this.v[i * 3 + c];
          this.col[w * 3 + c] = this.col[i * 3 + c];
        }
        this.temp[w] = this.temp[i];
        this.age[w] = this.age[i];
        this.acid[w] = this.acid[i];
        this.acidTet[w] = this.acidTet[i];
      }
      w++;
    }
    if (w === this.n) return;
    this.n = w;
    this.mesh.visible = w > 0;
    if (!w) this.geo.setDrawRange(0, 0);
    this.wake();
  }

  clear() {
    this.n = 0;
    this.bank = 0;
    this.drainT = 0;
    this.rc = null;
    this.geo.setDrawRange(0, 0);
    this.mesh.visible = false;
  }

  update(dt) {
    if (!this.n) return;
    if (this.rc) return this._recallStep(dt);
    if (this.drainT > 0) {
      // (the heal: it sinks away into the floor)
      this.drainT -= dt;
      if (this.drainT <= 0) {
        this.clear();
        return;
      }
      for (let i = 0; i < this.n; i++) this.x[i * 3 + 1] -= dt * 0.25;
      this._remesh();
      return;
    }
    if (!(dt > 0)) return;
    // (a pool that's come to rest sleeps till jelly moves near it - or
    // while acid in it is still eating)
    if (this.asleep && (this.keepAwake || this._stirred())) this.wake();
    if (!this.asleep) {
      this._jellyCells();
      const h = Math.min(dt, 1 / 30) / SUB;
      for (let s = 0; s < SUB; s++) this._step(h);
      const v = this.v;
      let v2 = 0;
      for (let o = 0; o < this.n * 3; o += 3) v2 = Math.max(v2, v[o] * v[o] + v[o + 1] * v[o + 1] + v[o + 2] * v[o + 2]);
      this.stillT = v2 < 0.04 * 0.04 && !this.keepAwake ? this.stillT + dt : 0;
      if (this.stillT > 0.6) {
        this.asleep = true;
        v.fill(0, 0, this.n * 3);
      }
      // (a lot of it, creeping: its surface every other frame)
      if (this.asleep || this.n < 500 || v2 > 0.5 * 0.5 || (this._rmTick ^= 1)) this._remesh();
    }
    this.coolT += dt;
    // cooling to the room, and setting
    for (let i = 0; i < this.n; i++) {
      this.temp[i] += (0 - this.temp[i]) * Math.min(1, dt * 0.04);
      this.age[i] += dt;
    }
    this._setClock += dt;
    if (this._setClock > 0.3) {
      this._setClock = 0;
      this._setCold();
    }
  }

  wake() {
    this.asleep = false;
    this.stillT = 0;
  }

  // Jelly awake within reach of the (sleeping) pool?
  _stirred() {
    const x = this.x, m = 0.1;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let o = 0; o < this.n * 3; o += 3) {
      x0 = Math.min(x0, x[o]); x1 = Math.max(x1, x[o]);
      y0 = Math.min(y0, x[o + 1]); y1 = Math.max(y1, x[o + 1]);
      z0 = Math.min(z0, x[o + 2]); z1 = Math.max(z1, x[o + 2]);
    }
    for (const pc of this.app.sb.pieces) {
      const b = pc.bbox;
      if (pc.asleep || !(b[3] > b[0])) continue;
      if (b[0] > x1 + m || b[3] < x0 - m || b[1] > y1 + m || b[4] < y0 - m || b[2] > z1 + m || b[5] < z0 - m) continue;
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- sim
  _grid(P) {
    const n = this.n, iH = 1 / H, M = this.hashSize - 1;
    const cs = this.cellStart, cellOf = this.cellOf, order = this.order;
    cs.fill(0);
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const c = (Math.imul(Math.floor(P[o] * iH), 92837111) ^ Math.imul(Math.floor(P[o + 1] * iH), 689287499) ^ Math.imul(Math.floor(P[o + 2] * iH), 283923481)) & M;
      cellOf[i] = c;
      cs[c + 1]++;
    }
    for (let k = 0; k < this.hashSize; k++) cs[k + 1] += cs[k];
    const fill = this._fill && this._fill.length === this.hashSize ? this._fill : (this._fill = new Int32Array(this.hashSize));
    fill.set(cs.subarray(0, this.hashSize));
    for (let i = 0; i < n; i++) order[fill[cellOf[i]]++] = i;
  }

  // calls f(j, dx, dy, dz, d2) for the particles within H of particle i (at P)
  _near(P, i, f) {
    const o = i * 3, iH = 1 / H, M = this.hashSize - 1;
    const px = P[o], py = P[o + 1], pz = P[o + 2];
    const cx = Math.floor(px * iH), cy = Math.floor(py * iH), cz = Math.floor(pz * iH);
    if (++this._stamp > 2e9) {
      this._stamp = 1;
      this.seen.fill(0);
    }
    const cs = this.cellStart, order = this.order, seen = this.seen, stamp = this._stamp;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let c = -1; c <= 1; c++) {
          const hh = (Math.imul(cx + a, 92837111) ^ Math.imul(cy + b, 689287499) ^ Math.imul(cz + c, 283923481)) & M;
          for (let e = cs[hh]; e < cs[hh + 1]; e++) {
            const j = order[e];
            // (two of the cells can share a bucket: each particle once)
            if (j === i || seen[j] === stamp) continue;
            seen[j] = stamp;
            const q = j * 3, dx = px - P[q], dy = py - P[q + 1], dz = pz - P[q + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < H * H) f(j, dx, dy, dz, d2);
          }
        }
  }

  // Each particle's neighbours within H (this substep's: the solver's
  // rounds reuse them), into nb from nbStart[i].
  _neighbours(P) {
    const n = this.n, NB = this.nb, NS = this.nbStart, iH = 1 / H, M = this.hashSize - 1, H2 = H * H;
    const cs = this.cellStart, order = this.order, seen = this.seen;
    let w = 0;
    for (let i = 0; i < n; i++) {
      NS[i] = w;
      if (++this._stamp > 2e9) {
        this._stamp = 1;
        seen.fill(0);
      }
      const stamp = this._stamp, lim = w + MAXNB, o = i * 3, px = P[o], py = P[o + 1], pz = P[o + 2];
      const cx = Math.floor(px * iH), cy = Math.floor(py * iH), cz = Math.floor(pz * iH);
      for (let a = -1; a <= 1; a++) {
        const ha = Math.imul(cx + a, 92837111);
        for (let b = -1; b <= 1; b++) {
          const hb = ha ^ Math.imul(cy + b, 689287499);
          for (let c = -1; c <= 1; c++) {
            const hh = (hb ^ Math.imul(cz + c, 283923481)) & M;
            for (let e = cs[hh], e1 = cs[hh + 1]; e < e1; e++) {
              const j = order[e];
              // (two of the cells can share a bucket: each particle once)
              if (j === i || seen[j] === stamp) continue;
              seen[j] = stamp;
              const q = j * 3, dx = px - P[q], dy = py - P[q + 1], dz = pz - P[q + 2];
              if (dx * dx + dy * dy + dz * dz < H2 && w < lim) NB[w++] = j;
            }
          }
        }
      }
    }
    NS[n] = w;
  }

  // Position based fluids: predict, then a few rounds of pushing apart
  // where the liquid is packed denser than at rest (lambda: how much, per
  // particle; relaxed by eps so it settles rather than rings), out of the
  // floor and the jelly; velocity from how far it went, smoothed toward its
  // neighbours' (XSPH: thick).
  _step(h) {
    const n = this.n, x = this.x, q = this.q, v = this.v, g = this.app.sb.p.gravity ?? -22;
    for (let o = 0; o < n * 3; o += 3) {
      v[o + 1] += g * h;
      q[o] = x[o] + v[o] * h; q[o + 1] = x[o + 1] + v[o + 1] * h; q[o + 2] = x[o + 2] + v[o + 2] * h;
    }
    this._collide(q);
    this._grid(q);
    this._neighbours(q);
    const K6 = this.K6, KS = this.KS, irho = 1 / this.rho0, H2 = H * H, W0 = K6 * H2 * H2 * H2;
    const lam = this.lam, dp = this.dp, NB = this.nb, NS = this.nbStart, eps = this.eps, lim = 0.25 * D;
    const iDq = 1 / this.wDq, kC = this.kCorr, age = this.age, PW = this.pw, PC = this.pc;
    // (a lot of it: two rounds - it settles a little lower, but at a third less)
    const rounds = n > 900 ? 2 : ITER;
    for (let it = 0; it < rounds; it++) {
      for (let i = 0; i < n; i++) {
        const o = i * 3, px = q[o], py = q[o + 1], pz = q[o + 2];
        let r = W0, gx = 0, gy = 0, gz = 0, s2 = 0;
        for (let e = NS[i], e1 = NS[i + 1]; e < e1; e++) {
          const p = NB[e] * 3, dx = px - q[p], dy = py - q[p + 1], dz = pz - q[p + 2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= H2 || d2 < 1e-12) {
            PW[e] = 0;
            if (d2 < H2) r += W0;
            continue;
          }
          const u = H2 - d2, W = K6 * u * u * u;
          r += W;
          // (kept for the push below: positions don't change in between)
          const d = Math.sqrt(d2), hd = H - d, gf = (KS * hd * hd) / d, w = gf * irho;
          PW[e] = gf;
          const c = W * iDq, c2 = c * c;
          PC[e] = kC * c2 * c2;
          gx += dx * w; gy += dy * w; gz += dz * w;
          s2 += w * w * d2;
        }
        // (packed: push apart; thin - the surface - pull together, gently)
        const C = r * irho - 1;
        lam[i] = -(C > 0 ? C : COH * Math.max(C, -0.35)) / (s2 + gx * gx + gy * gy + gz * gz + eps);
      }
      for (let i = 0; i < n; i++) {
        const o = i * 3, px = q[o], py = q[o + 1], pz = q[o + 2], li = lam[i];
        let ax = 0, ay = 0, az = 0;
        for (let e = NS[i], e1 = NS[i + 1]; e < e1; e++) {
          const gf = PW[e];
          if (gf === 0) continue;
          const j = NB[e], p = j * 3;
          // (grad W points from i toward j: packed - lambda < 0 - pushes apart)
          const w = -(li + lam[j] - PC[e]) * gf;
          ax += (px - q[p]) * w; ay += (py - q[p + 1]) * w; az += (pz - q[p + 2]) * w;
        }
        ax *= irho; ay *= irho; az *= irho;
        const l2 = ax * ax + ay * ay + az * az;
        if (l2 > lim * lim) {
          const k = lim / Math.sqrt(l2);
          ax *= k; ay *= k; az *= k;
        }
        dp[o] = ax; dp[o + 1] = ay; dp[o + 2] = az;
      }
      for (let k = 0; k < n * 3; k++) q[k] += dp[k];
      this._collide(q);
    }
    // velocities, then the viscosity. (The solver may stop it dead, but
    // speeds it up only a little a substep - squeezed, it oozes rather than
    // squirts; a particle just made, hardly at all: sorting out where it
    // fits isn't a kick.)
    const ih = 1 / h;
    for (let o = 0; o < n * 3; o += 3) {
      let vx = (q[o] - x[o]) * ih, vy = (q[o + 1] - x[o + 1]) * ih, vz = (q[o + 2] - x[o + 2]) * ih;
      const s2 = vx * vx + vy * vy + vz * vz;
      const vm = Math.min(VMAX, Math.sqrt(v[o] * v[o] + v[o + 1] * v[o + 1] + v[o + 2] * v[o + 2]) + (age[o / 3] < 0.5 ? 0.15 : GAIN));
      if (s2 > vm * vm) {
        const k = vm / Math.sqrt(s2);
        vx *= k; vy *= k; vz *= k;
      }
      v[o] = vx; v[o + 1] = vy; v[o + 2] = vz;
    }
    const dv = this.dp;
    for (let i = 0; i < n; i++) {
      const o = i * 3, px = q[o], py = q[o + 1], pz = q[o + 2];
      let ax = 0, ay = 0, az = 0;
      for (let e = NS[i], e1 = NS[i + 1]; e < e1; e++) {
        const p = NB[e] * 3, dx = px - q[p], dy = py - q[p + 1], dz = pz - q[p + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= H2) continue;
        const u = H2 - d2, w = K6 * u * u * u * irho;
        ax += (v[p] - v[o]) * w; ay += (v[p + 1] - v[o + 1]) * w; az += (v[p + 2] - v[o + 2]) * w;
      }
      dv[o] = ax; dv[o + 1] = ay; dv[o + 2] = az;
    }
    const damp = Math.exp(-1.2 * h), fr = 1 - Math.min(1, 6 * h), slush = Math.exp(-14 * h), temp = this.temp;
    for (let o = 0; o < n * 3; o += 3) {
      // (cold enough to set: slush - it hardly flows)
      const dm = temp[o / 3] < SET_T ? slush : damp;
      v[o] = (v[o] + VISC * dv[o]) * dm; v[o + 1] = (v[o + 1] + VISC * dv[o + 1]) * (dm === slush ? damp : dm); v[o + 2] = (v[o + 2] + VISC * dv[o + 2]) * dm;
      // (floor friction: thick stuff drags)
      if (q[o + 1] <= R_P * 1.05) {
        v[o] *= fr;
        v[o + 2] *= fr;
      }
      x[o] = q[o]; x[o + 1] = q[o + 1]; x[o + 2] = q[o + 2];
    }
  }

  // The jelly's tets round the liquid, hashed by cells of 0.1 m (once a
  // frame; kept while the jelly near it sleeps and the liquid stays inside
  // what they cover); and which of each tet's faces are on the jelly's
  // surface (bit k: the face opposite its corner k).
  _jellyCells() {
    const sb = this.app.sb;
    // (mid-way through a run of cuts: no surface yet - nothing to hit)
    if (sb.topoStale || !sb.nT) {
      this.cellsN = 0;
      this._cellVer = -1;
      return;
    }
    if (this._maskVer !== sb.topoVersion || !this.faceMask || this.faceMask.length < sb.nT) {
      this._maskVer = sb.topoVersion;
      if (!this.faceMask || this.faceMask.length < sb.nT) this.faceMask = new Uint8Array(Math.ceil(sb.nT * 1.25));
      const fm = this.faceMask, T = sb.T, S = sb.sTri, ST = sb.sTet;
      fm.fill(0, 0, sb.nT);
      for (let f = 0; f < sb.nF; f++) {
        const t = ST[f], a = S[f * 3], b = S[f * 3 + 1], c = S[f * 3 + 2];
        for (let k = 0; k < 4; k++) {
          const u = T[t * 4 + k];
          if (u !== a && u !== b && u !== c) {
            fm[t] |= 1 << k;
            break;
          }
        }
      }
    }
    const n = this.n, x = this.x;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let o = 0; o < n * 3; o += 3) {
      x0 = Math.min(x0, x[o]); x1 = Math.max(x1, x[o]);
      y0 = Math.min(y0, x[o + 1]); y1 = Math.max(y1, x[o + 1]);
      z0 = Math.min(z0, x[o + 2]); z1 = Math.max(z1, x[o + 2]);
    }
    let moving = false;
    for (const pc of sb.pieces) {
      const b = pc.bbox;
      if (!pc.asleep && b[3] > b[0] && !(b[0] > x1 + 0.3 || b[3] < x0 - 0.3 || b[1] > y1 + 0.3 || b[4] < y0 - 0.3 || b[2] > z1 + 0.3 || b[5] < z0 - 0.3)) moving = true;
    }
    const cv = this._cov;
    if (!moving && this._cellVer === sb.topoVersion && x0 >= cv[0] && y0 >= cv[1] && z0 >= cv[2] && x1 <= cv[3] && y1 <= cv[4] && z1 <= cv[5]) return;
    this._cellVer = sb.topoVersion;
    const m = 0.25;
    x0 -= m; y0 -= m; z0 -= m; x1 += m; y1 += m; z1 += m;
    cv[0] = x0 + 0.1; cv[1] = y0 + 0.1; cv[2] = z0 + 0.1; cv[3] = x1 - 0.1; cv[4] = y1 - 0.1; cv[5] = z1 - 0.1;
    // each tet's cells (counted, then filled: a counting sort into buckets)
    const T = sb.T, X = sb.x, CM = CELL_HASH - 1;
    const cs = this.cStart;
    cs.fill(0);
    let nL = 0;
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1) {
        for (let k = 0; k < CELL_HASH; k++) cs[k + 1] += cs[k];
        if (!this.cTets || this.cTets.length < cs[CELL_HASH]) this.cTets = new Int32Array(Math.ceil(cs[CELL_HASH] * 1.5) + 64);
        this._cFill.set(cs.subarray(0, CELL_HASH));
      }
      const fill = this._cFill, out = this.cTets;
      for (let l = 0; l < (pass ? nL : sb.pieces.length); l++) {
        if (pass === 0) {
          const pc = sb.pieces[l], b = pc.bbox;
          if (!(b[3] > b[0]) || b[0] > x1 || b[3] < x0 || b[1] > y1 || b[4] < y0 || b[2] > z1 || b[5] < z0) continue;
          for (const t of pc.tets) {
            if (sb.vol0[t] <= 0) continue;
            if (this._near1(T, X, t, x0, y0, z0, x1, y1, z1)) {
              const r = this._tr;
              if (nL * 7 + 7 > this._cRange.length) {
                const g = new Int32Array(this._cRange.length * 2);
                g.set(this._cRange);
                this._cRange = g;
              }
              const R = this._cRange, o = nL * 7;
              R[o] = t; R[o + 1] = r[0]; R[o + 2] = r[1]; R[o + 3] = r[2]; R[o + 4] = r[3]; R[o + 5] = r[4]; R[o + 6] = r[5];
              nL++;
              for (let i = r[0]; i <= r[1]; i++)
                for (let j = r[2]; j <= r[3]; j++)
                  for (let k = r[4]; k <= r[5]; k++) cs[((Math.imul(i, 92837111) ^ Math.imul(j, 689287499) ^ Math.imul(k, 283923481)) & CM) + 1]++;
            }
          }
        } else {
          const R = this._cRange, o = l * 7, t = R[o];
          for (let i = R[o + 1]; i <= R[o + 2]; i++)
            for (let j = R[o + 3]; j <= R[o + 4]; j++)
              for (let k = R[o + 5]; k <= R[o + 6]; k++) out[fill[(Math.imul(i, 92837111) ^ Math.imul(j, 689287499) ^ Math.imul(k, 283923481)) & CM]++] = t;
        }
      }
    }
    this.cellsN = nL;
  }

  // Tet t's box overlaps (x0..x1, ...)? Its range of 0.1 m cells into this._tr.
  _near1(T, X, t, x0, y0, z0, x1, y1, z1) {
    const o = t * 4, a = T[o] * 3, b = T[o + 1] * 3, c = T[o + 2] * 3, d = T[o + 3] * 3;
    const tx0 = Math.min(X[a], X[b], X[c], X[d]), tx1 = Math.max(X[a], X[b], X[c], X[d]);
    if (tx0 > x1 || tx1 < x0) return false;
    const ty0 = Math.min(X[a + 1], X[b + 1], X[c + 1], X[d + 1]), ty1 = Math.max(X[a + 1], X[b + 1], X[c + 1], X[d + 1]);
    if (ty0 > y1 || ty1 < y0) return false;
    const tz0 = Math.min(X[a + 2], X[b + 2], X[c + 2], X[d + 2]), tz1 = Math.max(X[a + 2], X[b + 2], X[c + 2], X[d + 2]);
    if (tz0 > z1 || tz1 < z0) return false;
    // (a tet stretched past 8 cells a side is torn to bits: skip it)
    const r = this._tr;
    r[0] = Math.floor(tx0 * 10); r[1] = Math.floor(tx1 * 10);
    r[2] = Math.floor(ty0 * 10); r[3] = Math.floor(ty1 * 10);
    r[4] = Math.floor(tz0 * 10); r[5] = Math.floor(tz1 * 10);
    return r[1] - r[0] < 8 && r[3] - r[2] < 8 && r[5] - r[4] < 8;
  }

  // Floor, arena wall, and out of the jelly: through the nearest of the
  // tet's faces that's on the jelly's surface (so it runs down the sides
  // rather than climbing them), or - deeper in - along the escape field
  // (the way to the nearest outside, mapped from rest space by the tet's
  // deformation).
  _collide(q) {
    const sb = this.app.sb, R = sb.p.arenaRadius - R_P, CM = CELL_HASH - 1;
    const T = sb.T, X = sb.x, E = sb.esc, B = sb.B, ct = sb._ct, fm = this.faceMask, cs = this.cStart, ctl = this.cTets;
    for (let i = 0; i < this.n; i++) {
      const o = i * 3;
      if (q[o + 1] < R_P) q[o + 1] = R_P;
      if (sb.p.box) {
        // (the glass room: square)
        if (q[o] > R) q[o] = R;
        else if (q[o] < -R) q[o] = -R;
        if (q[o + 2] > R) q[o + 2] = R;
        else if (q[o + 2] < -R) q[o + 2] = -R;
      } else {
        const r2 = q[o] * q[o] + q[o + 2] * q[o + 2];
        if (r2 > R * R) {
          const r = Math.sqrt(r2);
          q[o] *= R / r;
          q[o + 2] *= R / r;
        }
      }
      if (!this.cellsN) continue;
      const hb = (Math.imul(Math.floor(q[o] * 10), 92837111) ^ Math.imul(Math.floor(q[o + 1] * 10), 689287499) ^ Math.imul(Math.floor(q[o + 2] * 10), 283923481)) & CM;
      for (let e = cs[hb], e1 = cs[hb + 1]; e < e1; e++) {
        const t = ctl[e];
        if (!(sb._tetGap(t, q[o], q[o + 1], q[o + 2]) < 0)) continue;
        if (this.acid[i] > 0) this.acidTet[i] = t;
        const t4 = t * 4, ia = T[t4], ib = T[t4 + 1], ic = T[t4 + 2], id = T[t4 + 3];
        const a3 = ia * 3, b3 = ib * 3, c3 = ic * 3, d3 = id * 3;
        let wx = 0, wy = 1, wz = 0, step = 0.004;
        const mk = fm[t];
        if (mk) {
          // barycentric gradients: -grad b_k leaves through the face opposite k, b_k/|grad b_k| away
          const e1x = X[b3] - X[a3], e1y = X[b3 + 1] - X[a3 + 1], e1z = X[b3 + 2] - X[a3 + 2];
          const e2x = X[c3] - X[a3], e2y = X[c3 + 1] - X[a3 + 1], e2z = X[c3 + 2] - X[a3 + 2];
          const e3x = X[d3] - X[a3], e3y = X[d3 + 1] - X[a3 + 1], e3z = X[d3 + 2] - X[a3 + 2];
          const g = this._g;
          g[3] = e2y * e3z - e2z * e3y; g[4] = e2z * e3x - e2x * e3z; g[5] = e2x * e3y - e2y * e3x;
          g[6] = e3y * e1z - e3z * e1y; g[7] = e3z * e1x - e3x * e1z; g[8] = e3x * e1y - e3y * e1x;
          g[9] = e1y * e2z - e1z * e2y; g[10] = e1z * e2x - e1x * e2z; g[11] = e1x * e2y - e1y * e2x;
          const det = e1x * g[3] + e1y * g[4] + e1z * g[5];
          g[0] = -(g[3] + g[6] + g[9]); g[1] = -(g[4] + g[7] + g[10]); g[2] = -(g[5] + g[8] + g[11]);
          const bs = [ct.b0, ct.b1, ct.b2, ct.b3];
          let best = Infinity;
          for (let k = 0; k < 4; k++) {
            if (!(mk & (1 << k))) continue;
            const gl = Math.sqrt(g[k * 3] * g[k * 3] + g[k * 3 + 1] * g[k * 3 + 1] + g[k * 3 + 2] * g[k * 3 + 2]) / det;
            const dist = bs[k] / gl;
            if (dist < best) {
              best = dist;
              const s = -1 / (gl * det);
              wx = g[k * 3] * s; wy = g[k * 3 + 1] * s; wz = g[k * 3 + 2] * s;
            }
          }
          step = Math.min(best, 0.03) + 0.002;
        } else {
          const b0 = ct.b0, b1 = ct.b1, b2 = ct.b2, b3w = ct.b3;
          const ex = E[a3] * b0 + E[b3] * b1 + E[c3] * b2 + E[d3] * b3w;
          const ey = E[a3 + 1] * b0 + E[b3 + 1] * b1 + E[c3 + 1] * b2 + E[d3 + 1] * b3w;
          const ez = E[a3 + 2] * b0 + E[b3 + 2] * b1 + E[c3 + 2] * b2 + E[d3 + 2] * b3w;
          if (ex * ex + ey * ey + ez * ez > 1e-8) {
            const bo = t * 9;
            const y0 = B[bo] * ex + B[bo + 1] * ey + B[bo + 2] * ez;
            const y1 = B[bo + 3] * ex + B[bo + 4] * ey + B[bo + 5] * ez;
            const y2 = B[bo + 6] * ex + B[bo + 7] * ey + B[bo + 8] * ez;
            wx = (X[b3] - X[a3]) * y0 + (X[c3] - X[a3]) * y1 + (X[d3] - X[a3]) * y2;
            wy = (X[b3 + 1] - X[a3 + 1]) * y0 + (X[c3 + 1] - X[a3 + 1]) * y1 + (X[d3 + 1] - X[a3 + 1]) * y2;
            wz = (X[b3 + 2] - X[a3 + 2]) * y0 + (X[c3 + 2] - X[a3 + 2]) * y1 + (X[d3 + 2] - X[a3 + 2]) * y2;
            const wl = Math.sqrt(wx * wx + wy * wy + wz * wz) || 1;
            wx /= wl; wy /= wl; wz /= wl;
            step = Math.min(wl, 0.03) + 0.003;
          }
        }
        q[o] += wx * step; q[o + 1] += wy * step; q[o + 2] += wz * step;
        break;
      }
    }
  }

  // Cold clumps set: particles colder than SET_T (slush), joined within
  // 1.4 D of each other, a dozen or more - meshed into jelly (see _toJelly)
  // once the spray's moved off them (0.45 s), the biggest first, one a look
  // (a rebuild each: spread out); a huge one doesn't wait. A few cold drops
  // on their own frost away.
  _setCold() {
    const n = this.n;
    let any = false;
    for (let i = 0; i < n; i++) if (this.temp[i] < SET_T && this.acid[i] === 0) any = true;
    if (!any) return;
    const released = this.coolT > 0.45;
    this._grid(this.x);
    const par = new Int32Array(n);
    for (let i = 0; i < n; i++) par[i] = i;
    const find = (a) => {
      while (par[a] !== a) a = par[a] = par[par[a]];
      return a;
    };
    const L2 = (1.4 * D) ** 2;
    for (let i = 0; i < n; i++) {
      if (this.temp[i] >= SET_T || this.acid[i] !== 0) continue;
      this._near(this.x, i, (j, dx, dy, dz, d2) => {
        if (d2 > L2 || this.temp[j] >= SET_T || this.acid[j] !== 0) return;
        const a = find(i), b = find(j);
        if (a !== b) par[b] = a;
      });
    }
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      if (this.temp[i] >= SET_T || this.acid[i] !== 0) continue;
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(i);
    }
    const gone = new Uint8Array(n);
    let made = false, dust = false;
    const big = [...groups.values()].filter((ids) => ids.length >= 12 && (released || ids.length > 700)).sort((p, q) => q.length - p.length);
    if (released) {
      for (const ids of groups.values()) {
        if (ids.length >= 12 || !ids.every((i) => this.temp[i] < SET_T * 2)) continue;
        for (const i of ids) {
          gone[i] = 1;
          this.app.particles?.glitter?.({ x: this.x[i * 3], y: this.x[i * 3 + 1], z: this.x[i * 3 + 2] }, 3, [0.85, 0.93, 1.0], 0.05);
        }
        dust = true;
      }
    }
    if (big.length) {
      this._cellVer = -1; // (the jelly as it is now: never inside it)
      this._jellyCells();
      // (the biggest that can be made; a clump that can't stays slush)
      for (const ids of big) {
        if (!this._toJelly(ids)) continue;
        for (const i of ids) gone[i] = 1;
        made = ids;
        const c = (this._setAt ||= [0, 0, 0]);
        c[0] = c[1] = c[2] = 0;
        for (const i of ids) for (let k = 0; k < 3; k++) c[k] += this.x[i * 3 + k] / ids.length;
        break;
      }
    }
    if (!made && !dust) return;
    // (compact what's left)
    let w = 0;
    for (let i = 0; i < n; i++) {
      if (gone[i]) continue;
      if (w !== i) {
        for (let c = 0; c < 3; c++) {
          this.x[w * 3 + c] = this.x[i * 3 + c];
          this.v[w * 3 + c] = this.v[i * 3 + c];
          this.col[w * 3 + c] = this.col[i * 3 + c];
        }
        this.temp[w] = this.temp[i];
        this.age[w] = this.age[i];
        this.acid[w] = this.acid[i];
        this.acidTet[w] = this.acidTet[i];
      }
      w++;
    }
    this.n = w;
    this.mesh.visible = w > 0;
    this.wake();
    if (!made) return;
    this.app.onTopologyChanged();
    this.app.audio?.frostCrackle?.(1);
    // (it sets with a crack and a beat's pause - a big one takes the
    // machine a moment to remake, and the pause takes it)
    const c = this._setAt;
    this.app.hitStop?.(made.length > 200 ? 0.14 : 0.06);
    this.app.glowPulse?.(c[0], c[1], c[2], 0.9);
  }

  // A clump into jelly: a grid of voxels (about the jelly's own cell size),
  // as many as the liquid's volume, where it's thickest - not where there's
  // jelly already - five tets each, the corners shared; the outline's
  // corners pulled in a little toward their neighbours, sideways (round in
  // plan, no stair steps; never thinner); rest shape = the shape it's in;
  // cold (freshly set: firm). Added to the body as a new piece.
  _toJelly(ids) {
    const sb = this.app.sb, x = this.x;
    const vs = Math.max(0.055, sb.hCell * 0.7);
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    let vx = 0, vy = 0, vz = 0;
    for (const i of ids) {
      const o = i * 3;
      x0 = Math.min(x0, x[o]); x1 = Math.max(x1, x[o]);
      y0 = Math.min(y0, x[o + 1]); y1 = Math.max(y1, x[o + 1]);
      z0 = Math.min(z0, x[o + 2]); z1 = Math.max(z1, x[o + 2]);
      vx += this.v[o]; vy += this.v[o + 1]; vz += this.v[o + 2];
    }
    vx /= ids.length; vy /= ids.length; vz /= ids.length;
    const pad = vs;
    x0 -= pad; z0 -= pad; x1 += pad; z1 += pad; y1 += pad;
    y0 = Math.max(0, y0 - pad);
    const nx = Math.max(1, Math.ceil((x1 - x0) / vs)), ny = Math.max(1, Math.ceil((y1 - y0) / vs)), nz = Math.max(1, Math.ceil((z1 - z0) / vs));
    if (nx * ny * nz > 40000) return false;
    const NV = nx * ny * nz;
    const vid = (i, j, k) => (k * ny + j) * nx + i;
    // how much liquid each voxel holds (each particle shared trilinearly)
    const occ = new Float32Array(NV);
    for (const p of ids) {
      const o = p * 3;
      const fx = (x[o] - x0) / vs - 0.5, fy = (x[o + 1] - y0) / vs - 0.5, fz = (x[o + 2] - z0) / vs - 0.5;
      const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz);
      for (let c = 0; c < 8; c++) {
        const i = i0 + (c & 1), j = j0 + ((c >> 1) & 1), k = k0 + (c >> 2);
        if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue;
        const w = (c & 1 ? fx - i0 : 1 - fx + i0) * ((c >> 1) & 1 ? fy - j0 : 1 - fy + j0) * (c >> 2 ? fz - k0 : 1 - fz + k0);
        occ[vid(i, j, k)] += w;
      }
    }
    // ranked by the liquid in and round them; not inside jelly already
    const score = new Float32Array(NV);
    const cand = [];
    const CM = CELL_HASH - 1, cs = this.cStart, ctl = this.cTets;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          let s = 0;
          for (let c = -1; c <= 1; c++)
            for (let b = -1; b <= 1; b++)
              for (let a = -1; a <= 1; a++) {
                const ii = i + a, jj = j + b, kk = k + c;
                if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
                s += occ[vid(ii, jj, kk)] * (a === 0 && b === 0 && c === 0 ? 1 : 0.15);
              }
          if (s < 0.3) continue;
          const px = x0 + (i + 0.5) * vs, py = y0 + (j + 0.5) * vs, pz = z0 + (k + 0.5) * vs;
          let inside = false;
          if (this.cellsN) {
            const hb = (Math.imul(Math.floor(px * 10), 92837111) ^ Math.imul(Math.floor(py * 10), 689287499) ^ Math.imul(Math.floor(pz * 10), 283923481)) & CM;
            for (let e = cs[hb]; e < cs[hb + 1] && !inside; e++) if (sb._tetGap(ctl[e], px, py, pz) < 0) inside = true;
          }
          if (inside) continue;
          const v = vid(i, j, k);
          score[v] = s;
          cand.push(v);
        }
    cand.sort((p, q) => score[q] - score[p]);
    // (a little over: rounding the outline takes some back)
    const want = Math.round((1.2 * ids.length * this.vol) / (vs * vs * vs));
    const full = new Uint8Array(NV);
    for (let c = 0; c < Math.min(want, cand.length); c++) full[cand[c]] = 1;
    // (bits a voxel or three on their own: dropped - too small to be jelly)
    const seen = new Uint8Array(NV);
    let count = 0;
    for (let v0 = 0; v0 < NV; v0++) {
      if (!full[v0] || seen[v0]) continue;
      const comp = [v0];
      seen[v0] = 1;
      for (let h = 0; h < comp.length; h++) {
        const v = comp[h], i = v % nx, j = Math.floor(v / nx) % ny, k = Math.floor(v / (nx * ny));
        for (const [a, b, c] of NB6) {
          const ii = i + a, jj = j + b, kk = k + c;
          if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
          const u = vid(ii, jj, kk);
          if (full[u] && !seen[u]) {
            seen[u] = 1;
            comp.push(u);
          }
        }
      }
      if (comp.length < 4) for (const v of comp) full[v] = 0;
      else count += comp.length;
    }
    if (count < 4) return false;
    // corners
    const cid = new Map();
    const corner = (i, j, k) => {
      const key = (k * (ny + 1) + j) * (nx + 1) + i;
      let id = cid.get(key);
      if (id === undefined) {
        id = sb.nV;
        sb.addVertex(x0 + i * vs, y0 + j * vs, z0 + k * vs, x0 + i * vs, y0 + j * vs, z0 + k * vs, vx, vy, vz, -0.7);
        cid.set(key, id);
      }
      return id;
    };
    const tets = [];
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          if (!full[vid(i, j, k)]) continue;
          const c = [corner(i, j, k), corner(i + 1, j, k), corner(i + 1, j + 1, k), corner(i, j + 1, k), corner(i, j, k + 1), corner(i + 1, j, k + 1), corner(i + 1, j + 1, k + 1), corner(i, j + 1, k + 1)];
          // five tets, mirrored on alternate cells so the faces match up
          const T5 = (i + j + k) & 1
            ? [[0, 1, 3, 4], [1, 2, 3, 6], [1, 4, 5, 6], [3, 4, 6, 7], [1, 3, 4, 6]]
            : [[0, 1, 2, 5], [0, 2, 3, 7], [0, 4, 5, 7], [2, 5, 6, 7], [0, 2, 5, 7]];
          for (const tt of T5) tets.push(c[tt[0]], c[tt[1]], c[tt[2]], c[tt[3]]);
        }
    // the outline's corners (on a side face: an empty voxel beside them, level) pulled in sideways
    const outside = new Set();
    for (const [key, id] of cid) {
      const i = key % (nx + 1), j = Math.floor(key / (nx + 1)) % (ny + 1), k = Math.floor(key / ((nx + 1) * (ny + 1)));
      for (let c = -1; c <= 0 && !outside.has(id); c++)
        for (let a = -1; a <= 0; a++) {
          const ii = i + a, kk = k + c;
          let side = false;
          for (let b = -1; b <= 0; b++) {
            const jj = j + b;
            if (jj < 0 || jj >= ny) continue;
            if (ii < 0 || kk < 0 || ii >= nx || kk >= nz || !full[vid(ii, jj, kk)]) side = true;
          }
          if (side) {
            outside.add(id);
            break;
          }
        }
    }
    const nb = new Map();
    for (let t = 0; t < tets.length; t += 4)
      for (let a = 0; a < 4; a++)
        for (let b = 0; b < 4; b++) {
          if (a === b) continue;
          const u = tets[t + a];
          if (!nb.has(u)) nb.set(u, new Set());
          nb.get(u).add(tets[t + b]);
        }
    for (let pass = 0; pass < 2; pass++) {
      const moved = [];
      for (const id of outside) {
        const ns = nb.get(id);
        if (!ns) continue;
        let ax = 0, az = 0, m = 0;
        for (const u of ns) {
          // (its neighbours on the same level)
          if (Math.abs(sb.X[u * 3 + 1] - sb.X[id * 3 + 1]) > vs * 0.5) continue;
          ax += sb.X[u * 3]; az += sb.X[u * 3 + 2];
          m++;
        }
        if (m) moved.push(id, ax / m, az / m);
      }
      for (let q = 0; q < moved.length; q += 3) {
        const o = moved[q] * 3;
        for (const [c, to] of [[0, moved[q + 1]], [2, moved[q + 2]]]) {
          const v = sb.X[o + c] + (to - sb.X[o + c]) * 0.35;
          sb.x[o + c] = sb.X[o + c] = sb.px[o + c] = v;
        }
      }
    }
    // the top's corners (open above, on a level) eased up or down toward
    // their neighbours on top: no terraces
    const top = new Set();
    for (const [key, id] of cid) {
      const i = key % (nx + 1), j = Math.floor(key / (nx + 1)) % (ny + 1), k = Math.floor(key / ((nx + 1) * (ny + 1)));
      if (j === 0) continue;
      let under = false, over = false;
      for (let c = -1; c <= 0; c++)
        for (let a = -1; a <= 0; a++) {
          const ii = i + a, kk = k + c;
          if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) continue;
          if (full[vid(ii, j - 1, kk)]) under = true;
          if (j < ny && full[vid(ii, j, kk)]) over = true;
        }
      if (under && !over) top.add(id);
    }
    for (let pass = 0; pass < 2; pass++) {
      const moved = [];
      for (const id of top) {
        let ay = 0, m = 0;
        for (const u of nb.get(id) || []) {
          if (!top.has(u)) continue;
          ay += sb.X[u * 3 + 1];
          m++;
        }
        if (m) moved.push(id, ay / m);
      }
      for (let q = 0; q < moved.length; q += 2) {
        const o = moved[q] * 3;
        // (never below the layer under it: half a voxel at most)
        const y = sb.X[o + 1] + Math.max(-0.5 * vs, (moved[q + 1] - sb.X[o + 1]) * 0.35);
        sb.x[o + 1] = sb.X[o + 1] = sb.px[o + 1] = y;
      }
    }
    // (a set puddle's a smooth thing: see TAG_MELT - and marked 2, as set
    // from the liquid: a re-cube melts it back - see _meltSet)
    for (const id of cid.values()) sb.melt[id] = 2;
    const nT0 = sb.nT, nT = nT0 + tets.length / 4;
    sb.ensureT(nT);
    sb.T.set(tets, nT0 * 4);
    for (let t = nT0; t < nT; t++) {
      sb.tVS[t] = 1;
      sb.tMu[t] = 1;
    }
    sb.nT = nT;
    sb.rebuild();
    return true;
  }

  // ---------------------------------------------------------------- surface
  // The particles splatted into a field on a grid round them (each a smooth
  // bump out to 1.6 D), colours carried along; its level set by marching
  // cubes, normals from the field's gradient.
  _remesh() {
    const n = this.n, x = this.x;
    if (!n) {
      this.geo.setDrawRange(0, 0);
      return;
    }
    const R = SPLAT_R * D, R2 = R * R;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      x0 = Math.min(x0, x[o]); x1 = Math.max(x1, x[o]);
      y0 = Math.min(y0, x[o + 1]); y1 = Math.max(y1, x[o + 1]);
      z0 = Math.min(z0, x[o + 2]); z1 = Math.max(z1, x[o + 2]);
    }
    // (a flood of it: coarser - a big flat pool needs no fine grid)
    let c = this.cell * Math.min(1.6, Math.max(1, Math.sqrt(n / 500)));
    // (two cells' margin past the splats; nothing below the floor - the
    // floor hides it, and while draining cuts it off)
    const pad = R + 2 * c;
    x0 -= pad; z0 -= pad; x1 += pad; z1 += pad; y1 += pad;
    y0 = Math.max(y0 - pad, 0);
    if (y1 <= y0 + c) {
      this.geo.setDrawRange(0, 0);
      this.mesh.visible = false;
      return;
    }
    const dims = () => [Math.ceil((x1 - x0) / c) + 1, Math.ceil((y1 - y0) / c) + 1, Math.ceil((z1 - z0) / c) + 1];
    let [gx, gy, gz] = dims();
    while (gx * gy * gz > 600000) {
      c *= 1.25;
      [gx, gy, gz] = dims();
    }
    const G = gx * gy * gz, gxy = gx * gy;
    if (!this.field || this.field.length < G) {
      const cap = Math.ceil(G * 1.5);
      this.field = new Float32Array(cap); // (all 0 between calls: what's touched is cleared after)
      this.fcol = new Float32Array(cap * 3);
      this.touch = new Uint8Array(cap);
      this.tList = new Int32Array(cap);
      this.cList = new Int32Array(cap);
    }
    const F = this.field, FC = this.fcol, touch = this.touch, tList = this.tList, cList = this.cList;
    // (only the grid points near a particle are filled, and only the cells
    // round the ones that come out inside are marched)
    let nt = 0;
    const ic = 1 / c, rr = Math.ceil(R * ic);
    for (let p = 0; p < n; p++) {
      const o = p * 3;
      const px = x[o], py = x[o + 1], pz = x[o + 2];
      const ci = Math.round((px - x0) * ic), cj = Math.round((py - y0) * ic), ck = Math.round((pz - z0) * ic);
      // (cold: frosting over, toward slush-white)
      const fz = this.temp[p] < 0 ? Math.min(0.75, -this.temp[p] * 1.2) : 0;
      const r = this.col[o] + (0.9 - this.col[o]) * fz, g = this.col[o + 1] + (0.94 - this.col[o + 1]) * fz, b = this.col[o + 2] + (1 - this.col[o + 2]) * fz;
      const i0 = Math.max(0, ci - rr), i1 = Math.min(gx - 1, ci + rr);
      for (let k = Math.max(0, ck - rr); k <= Math.min(gz - 1, ck + rr); k++) {
        const dz = z0 + k * c - pz;
        for (let j = Math.max(0, cj - rr); j <= Math.min(gy - 1, cj + rr); j++) {
          const dy = y0 + j * c - py, dyz = dy * dy + dz * dz;
          if (dyz >= R2) continue;
          const row = k * gxy + j * gx;
          for (let i = i0; i <= i1; i++) {
            const dx = x0 + i * c - px;
            const d2 = dx * dx + dyz;
            if (d2 >= R2) continue;
            const u = 1 - d2 / R2, w = u * u * u;
            const q = row + i;
            if (!touch[q]) {
              touch[q] = 1;
              tList[nt++] = q;
              FC[q * 3] = FC[q * 3 + 1] = FC[q * 3 + 2] = 0;
            }
            F[q] += w;
            FC[q * 3] += r * w; FC[q * 3 + 1] += g * w; FC[q * 3 + 2] += b * w;
          }
        }
      }
    }
    const iso = SPLAT_ISO;
    // the cells with an inside corner (the 8 round each inside point)
    let nc = 0;
    for (let a = 0; a < nt; a++) {
      const p = tList[a];
      if (F[p] <= iso) continue;
      const k = (p / gxy) | 0, j = ((p - k * gxy) / gx) | 0, i = p - k * gxy - j * gx;
      for (let dk = -1; dk <= 0; dk++) {
        const kk = k + dk;
        if (kk < 0 || kk >= gz - 1) continue;
        for (let dj = -1; dj <= 0; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= gy - 1) continue;
          for (let di = -1; di <= 0; di++) {
            const ii = i + di;
            if (ii < 0 || ii >= gx - 1) continue;
            const cell = kk * gxy + jj * gx + ii;
            if (touch[cell] & 2) continue;
            touch[cell] |= 2;
            cList[nc++] = cell;
          }
        }
      }
    }
    const OFF = this._off || (this._off = new Int32Array(8));
    OFF[0] = 0; OFF[1] = 1; OFF[2] = 1 + gx; OFF[3] = gx; OFF[4] = gxy; OFF[5] = 1 + gxy; OFF[6] = 1 + gx + gxy; OFF[7] = gx + gxy;
    const CX = MC_CX, CY = MC_CY, CZ = MC_CZ, EA = MC_EA, EB = MC_EB;
    const pos = this.pos, nrm = this.nrm, rgb = this.rgb, maxV = this.maxV;
    const vv = this._vv, ex = this._ex, en = this._en, ec = this._ec;
    let nv = 0;
    for (let a = 0; a < nc && nv + 15 <= maxV; a++) {
      const cell = cList[a];
      const k = (cell / gxy) | 0, j = ((cell - k * gxy) / gx) | 0, i = cell - k * gxy - j * gx;
      let ci = 0;
      for (let m = 0; m < 8; m++) {
        const f = F[cell + OFF[m]];
        vv[m] = f;
        // (the tables' winding: bit set where it's outside)
        if (!(f > iso)) ci |= 1 << m;
      }
      const em = edgeTable[ci];
      if (!em) continue;
      for (let e = 0; e < 12; e++) {
        if (!(em & (1 << e))) continue;
        const A = EA[e], B = EB[e], qa = cell + OFF[A], qb = cell + OFF[B];
        const t = (iso - vv[A]) / (vv[B] - vv[A] || 1e-9);
        const o = e * 3;
        ex[o] = x0 + (i + CX[A] + (CX[B] - CX[A]) * t) * c;
        ex[o + 1] = y0 + (j + CY[A] + (CY[B] - CY[A]) * t) * c;
        ex[o + 2] = z0 + (k + CZ[A] + (CZ[B] - CZ[A]) * t) * c;
        // normal: down the field's gradient (central differences; one-sided at the floor)
        const ja = j + CY[A], jb = j + CY[B];
        const ax = F[qa - 1] - F[qa + 1], ay = F[ja > 0 ? qa - gx : qa] - F[qa + gx], az = F[qa - gxy] - F[qa + gxy];
        const bx = F[qb - 1] - F[qb + 1], by = F[jb > 0 ? qb - gx : qb] - F[qb + gx], bz = F[qb - gxy] - F[qb + gxy];
        const nx = ax + (bx - ax) * t, ny = ay + (by - ay) * t, nz = az + (bz - az) * t;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        en[o] = nx / nl; en[o + 1] = ny / nl; en[o + 2] = nz / nl;
        // (a corner the splat never reached has no colour: take the other's)
        const ta = touch[qa] & 1, tb = touch[qb] & 1, wa = ta ? 1 / F[qa] : 0, wb = tb ? 1 / F[qb] : 0;
        for (let cc = 0; cc < 3; cc++) {
          const ca = FC[qa * 3 + cc] * wa, cb = FC[qb * 3 + cc] * wb;
          ec[o + cc] = !ta ? cb : !tb ? ca : ca + (cb - ca) * t;
        }
      }
      const base = ci * 16;
      for (let tIdx = 0; triTable[base + tIdx] !== -1; tIdx++) {
        const e3 = triTable[base + tIdx] * 3, o = nv * 3;
        pos[o] = ex[e3]; pos[o + 1] = ex[e3 + 1]; pos[o + 2] = ex[e3 + 2];
        nrm[o] = en[e3]; nrm[o + 1] = en[e3 + 1]; nrm[o + 2] = en[e3 + 2];
        rgb[o] = ec[e3]; rgb[o + 1] = ec[e3 + 1]; rgb[o + 2] = ec[e3 + 2];
        nv++;
      }
    }
    // (leave it all clean for next time)
    for (let a = 0; a < nc; a++) touch[cList[a]] &= 1;
    for (let a = 0; a < nt; a++) {
      const q = tList[a];
      touch[q] = 0;
      F[q] = 0;
    }
    this.geo.setDrawRange(0, nv);
    for (const a of [this.aPos, this.aNrm, this.aCol]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, nv * 3);
      a.needsUpdate = true;
    }
    this.mesh.visible = nv > 0;
  }
}
