import * as THREE from 'three';
import { REST_STEP, MAX_CUBES } from '../sim/softbody.js';
import { CUBE_TEX_W } from '../render/jellyView.js';
import { TAG_FRESH } from '../sim/softbody.js';
import { MAX_CAVITIES } from '../render/jellyMaterials.js';
import { closestOnTriangle } from '../sim/geom.js';

const MAX = 240;

export class Bubbles {
  constructor(app) {
    this.app = app;
    const geo = new THREE.SphereGeometry(1, 14, 10);
    // Air bubbles read as bright rims and glints. They are drawn after the
    // jelly at their true positions (refracting them through the screen-space
    // approximation smears them), tinted/dimmed by the jelly in front, with
    // their depth pulled to the jelly surface so tools in front still hide them.
    const mat = new THREE.ShaderMaterial({
      uniforms: { uLight: { value: app.lightDir } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aEntryZ;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vTint;
        void main() {
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          vTint = instanceColor;
          vec4 mv = viewMatrix * wp;
          vec4 clip = projectionMatrix * mv;
          vec4 surf = projectionMatrix * vec4(mv.xy, max(mv.z, aEntryZ), 1.0);
          clip.z = surf.z / surf.w * clip.w;
          gl_Position = clip;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uLight;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vTint;
        void main() {
          vec3 N = normalize(vN);
          float ndv = clamp(dot(N, vV), 0.0, 1.0);
          float rim = pow(1.0 - ndv, 2.5);
          float spec = pow(max(dot(reflect(-normalize(uLight), N), vV), 0.0), 50.0);
          vec3 c = vTint * (rim * 1.6 + 0.06) + vec3(6.0) * spec * (vTint + 0.2);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.entryZ = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aEntryZ', this.entryZ);
    this.mesh.renderOrder = 3;
    app.fxScene.add(this.mesh);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // where bubbles sit (rest space, -1..1 a side) and how big: a pattern
    // each cube draws its own from (see reseed)
    this.pattern = [];
    for (let i = 0; i < MAX; i++) {
      // most bubbles float up near the top while the jelly sets
      const uy = 1 - 2 * Math.pow(rnd(), 2.2);
      this.pattern.push({ u: [rnd() * 2 - 1, uy, rnd() * 2 - 1], r: 0.004 + Math.pow(rnd(), 3) * 0.013 });
    }
    // the bubbles there are, each in its own cube: { slot, u, r, scale (its
    // cube's bubble size), a (its anchor), open (cut open: a hollow in the
    // surface, not a bubble) } - every cube its own count and size
    this.items = [];
    this.want = [{ slot: 0, count: 34, scale: 1 }];
    this._wantKey = '';
    this.reseed();
    app.anchorProviders.push(() => this.items.map((b) => b.a));
    app.onHealEnd.push(() => this.reseed());
    // bubbles cut open: per piece they show in, a tet near by and the
    // bubble's centre in its (extended) barycentric frame, and the radius
    this.cavities = [];
    this._cavTopo = -1;
    this._cavHead = null;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._t = [0, 0, 0];
  }

  // Each cube's bubbles: [{ slot, count, scale }].
  configure(list) {
    const key = list.map((w) => `${w.slot}:${Math.round(w.count)}:${(+w.scale).toFixed(3)}`).join(',');
    if (key === this._wantKey) return;
    this._wantKey = key;
    this.want = list;
    this.reseed();
  }

  // Which bubbles the cuts have run through: within a radius of a cut face
  // (rest space; nothing else exposes them - they sit clear of the moulded
  // faces). A bubble split between two pieces opens in both.
  findCavities() {
    const sb = this.app.sb;
    this._cavTopo = sb.topoVersion;
    this.cavities.length = 0;
    const items = this.items, nb = items.length;
    for (const b of items) b.open = false;
    if (!nb) return;
    const X = sb.X, T = sb.T, B = sb.B, sTri = sb.sTri, sTag = sb.sTag, sTet = sb.sTet;
    // the bubbles (rest centres) in a little grid, cube by cube (each in its
    // own rest space); then each cut face once against the ones in reach
    let rMax = 0, big = 0;
    for (const b of items) {
      rMax = Math.max(rMax, b.r * b.scale * sb.cSize[b.slot]);
      big = Math.max(big, sb.cSize[b.slot]);
    }
    const G = Math.max(0.05 * big, 2 * rMax), iG = 1 / G;
    // (a dense grid over a cube's rest shape and a margin round it)
    const lo = -big * 0.5 - 2 * G, N = Math.ceil((big + 4 * G) * iG) + 1, NC = N * N * N;
    const cell = (v) => Math.min(N - 1, Math.max(0, Math.floor((v - lo) * iG)));
    const head = this._cavHead && this._cavHead.length >= MAX_CUBES * NC ? this._cavHead : (this._cavHead = new Int32Array(MAX_CUBES * NC));
    head.fill(-1, 0, MAX_CUBES * NC);
    const next = new Int32Array(nb).fill(-1), ctr = new Float64Array(nb * 3);
    let any = false;
    for (let n = 0; n < nb; n++) {
      const bub = items[n];
      if (bub.a.tet < 0 || bub.a.tet >= sb.nT || bub.a.lost) continue;
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 4; k++) {
        const i = T[bub.a.tet * 4 + k] * 3, w = bub.a.b[k];
        cx += X[i] * w; cy += X[i + 1] * w; cz += X[i + 2] * w;
      }
      ctr[n * 3] = cx; ctr[n * 3 + 1] = cy; ctr[n * 3 + 2] = cz;
      const s = sb.tCube[bub.a.tet], h = s * NC + (cell(cx - s * REST_STEP) * N + cell(cy)) * N + cell(cz);
      next[n] = head[h];
      head[h] = n;
      any = true;
    }
    if (!any) return;
    const q = [0, 0, 0], done = new Set();
    for (let f = 0; f < sb.nF; f++) {
      if (sTag[f] !== TAG_FRESH) continue;
      const s = sb.tCube[sTet[f]], ox = s * REST_STEP;
      const ia = sTri[f * 3] * 3, ib = sTri[f * 3 + 1] * 3, ic = sTri[f * 3 + 2] * 3;
      const x0 = cell(Math.min(X[ia], X[ib], X[ic]) - ox - rMax), x1 = cell(Math.max(X[ia], X[ib], X[ic]) - ox + rMax);
      const y0 = cell(Math.min(X[ia + 1], X[ib + 1], X[ic + 1]) - rMax), y1 = cell(Math.max(X[ia + 1], X[ib + 1], X[ic + 1]) + rMax);
      const z0 = cell(Math.min(X[ia + 2], X[ib + 2], X[ic + 2]) - rMax), z1 = cell(Math.max(X[ia + 2], X[ib + 2], X[ic + 2]) + rMax);
      for (let i = x0; i <= x1; i++)
        for (let j = y0; j <= y1; j++)
          for (let k = z0; k <= z1; k++) {
            for (let n = head[s * NC + (i * N + j) * N + k]; n >= 0; n = next[n]) {
              const pc = sb.tPiece[sTet[f]];
              // (one hollow per bubble per piece it opens into)
              if (done.has(n * 4096 + pc)) continue;
              const bub = items[n], r = bub.r * bub.scale * sb.cSize[bub.slot];
              const cx = ctr[n * 3], cy = ctr[n * 3 + 1], cz = ctr[n * 3 + 2];
              if (closestOnTriangle(cx, cy, cz, X[ia], X[ia + 1], X[ia + 2], X[ib], X[ib + 1], X[ib + 2], X[ic], X[ic + 1], X[ic + 2], q) >= r * r) continue;
              done.add(n * 4096 + pc);
              bub.open = true;
              // the centre in that piece: barycentric in the cut face's tet
              // (past its sides is fine - the map is affine)
              const t = sTet[f], o = t * 9, a = T[t * 4] * 3;
              const rx = cx - X[a], ry = cy - X[a + 1], rz = cz - X[a + 2];
              const l1 = B[o] * rx + B[o + 1] * ry + B[o + 2] * rz;
              const l2 = B[o + 3] * rx + B[o + 4] * ry + B[o + 5] * rz;
              const l3 = B[o + 6] * rx + B[o + 7] * ry + B[o + 8] * rz;
              this.cavities.push({ tet: t, b: [1 - l1 - l2 - l3, l1, l2, l3], r });
            }
          }
    }
    // the biggest first, if there are more than the shader takes
    this.cavities.sort((p, q) => q.r - p.r);
  }

  // Every cube's bubbles anchored afresh at their rest places (in the mesh
  // as it is): each cube its own count of them, its own draw of the pattern
  // (more than there's room for: each fewer, in proportion).
  reseed() {
    const sb = this.app.sb;
    this._cubeVer = sb.cubeVersion;
    this._cavTopo = -1;
    this.items.length = 0;
    const total = this.want.reduce((t, w) => t + Math.max(0, Math.round(w.count)), 0);
    const f = total > MAX ? MAX / total : 1;
    for (const w of this.want) {
      const slot = w.slot, n = Math.floor(Math.max(0, Math.round(w.count)) * f);
      if (!(sb.cSize[slot] > 0)) continue;
      const half = sb.cSize[slot] / 2, m = Math.min(0.07, half * 0.15);
      for (let j = 0; j < n; j++) {
        const P = this.pattern[(j + slot * 61) % MAX];
        const r = sb.locateRest(P.u[0] * (half - m) + slot * REST_STEP, P.u[1] * (half - m), P.u[2] * (half - m));
        this.items.push({ slot, u: P.u, r: P.r, scale: w.scale, a: r ? { tet: r.tet, b: r.bary, lost: false } : { tet: -1, b: [0, 0, 0, 0] }, open: false });
      }
    }
  }

  update() {
    const app = this.app;
    const sb = app.sb;
    const cam = app.camera;
    const F = app.jelly.frontMat.uniforms;
    // (cubes come or gone and the tets renumbered: every bubble re-finds
    // its place)
    if (this._cubeVer !== sb.cubeVersion) this.reseed();
    // the cut-open ones are hollows in the jelly (its shader carves them)
    if (this._cavTopo !== sb.topoVersion) this.findCavities();
    let nc = 0;
    for (const cv of this.cavities) {
      if (nc >= MAX_CAVITIES) break;
      if (cv.tet >= sb.nT) continue;
      sb.embedPoint(cv.tet, cv.b, this._t);
      F.uCav.value[nc++].set(this._t[0], this._t[1], this._t[2], cv.r);
    }
    F.uCavN.value = nc;
    // (each bubble seen through its own cube: its colour, its cloudiness -
    // its row of the cube looks, see JellyView.setCubeLook)
    const D = app.jelly.cubeData;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    const vm = cam.matrixWorldInverse.elements;
    const tint = this._tint || (this._tint = new THREE.Color());
    let c = 0;
    for (const b of this.items) {
      if (b.a.tet < 0 || b.a.tet >= sb.nT || b.a.lost || b.open) continue;
      const k = sb.tCube[b.a.tet], row = k * CUBE_TEX_W * 4;
      const haze = D[row + 7], vis = (1 - haze) * (1 - haze);
      if (vis <= 0.01) continue;
      sb.embedPoint(b.a.tet, b.a.b, this._t);
      const px = this._t[0], py = this._t[1], pz = this._t[2];
      // where the line of sight enters this piece's bounding box
      const bb = sb.pieces[sb.tPiece[b.a.tet]]?.bbox;
      let dx = px - ox, dy = py - oy, dz = pz - oz;
      const len = Math.hypot(dx, dy, dz);
      dx /= len; dy /= len; dz /= len;
      let t0 = 0;
      if (bb) {
        let tmin = -Infinity;
        const sl = (o, d, lo, hi) => {
          if (Math.abs(d) < 1e-9) return;
          let a = (lo - o) / d, bq = (hi - o) / d;
          if (a > bq) [a, bq] = [bq, a];
          if (a > tmin) tmin = a;
        };
        sl(ox, dx, bb[0], bb[3]);
        sl(oy, dy, bb[1], bb[4]);
        sl(oz, dz, bb[2], bb[5]);
        t0 = Math.min(Math.max(tmin, 0), len);
      }
      const ex = ox + dx * t0, ey = oy + dy * t0, ez = oz + dz * t0;
      const L = len - t0;
      // view-space z of the entry point (slightly in front of the surface)
      const vz = vm[2] * ex + vm[6] * ey + vm[10] * ez + vm[14] + 0.02;
      this.entryZ.array[c] = vz;
      const fade = vis * Math.exp(-D[row + 3] * L * 0.8);
      tint.setRGB(
        (0.25 + 0.75 * D[row + 4]) * Math.exp(-D[row] * L) * fade,
        (0.25 + 0.75 * D[row + 5]) * Math.exp(-D[row + 1] * L) * fade,
        (0.25 + 0.75 * D[row + 6]) * Math.exp(-D[row + 2] * L) * fade,
      );
      this.mesh.setColorAt(c, tint);
      this._p.set(px, py, pz);
      this._s.setScalar(b.r * b.scale * sb.cSize[k]);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(c++, this._m);
    }
    this.mesh.count = c;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.entryZ.needsUpdate = true;
  }
}
