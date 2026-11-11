import * as THREE from 'three';
import { REST_STEP, MAX_CUBES } from '../sim/softbody.js';
import { CUBE_TEX_W } from '../render/jellyView.js';
import { TAG_FRESH } from '../sim/softbody.js';
import { MAX_CAVITIES } from '../render/jellyMaterials.js';
import { closestOnTriangle } from '../sim/geom.js';
import { roundBoxSDF, roundBoxNormal } from '../sim/mesh.js';
import { SWIRL } from './glitter.js';

const MAX = 240;
// Loose in a snow globe's water (see tick; the water's Glitter._loose): how hard a bubble's borne up (a share of
// the pull the flakes sink by, felt the other way - a big one more), how quickly the water drags it its way
// (s). Shut in, none of their air gets out: two that touch run together into one (MERGE: how often a second,
// the film between them drained - each as big as the cube's size times BIG at most), and the water churned
// up past CHURN breaks a big one in two (SPLIT: how often a second, for one twice SPLIT_R across).
const BUOY = 0.16, DRAG_T = 0.12, MERGE = 0.6, BIG = 0.1, CHURN = 0.6, SPLIT = 1.6, SPLIT_R = 0.016;

export class Bubbles {
  constructor(app) {
    this.app = app;
    const geo = new THREE.SphereGeometry(1, 14, 10);
    // Air bubbles in the jelly. An air bubble is a lens the other way round
    // from the jelly about it: what's behind, seen through one, is shrunk
    // and bent - the jelly behind it, small, in its middle (the room drawn
    // with the jelly in it, sampled pulled out from the middle: see tBg). Its
    // edge turns the light back inside it (total internal reflection) - a
    // bright rim of the jelly's own light, its colour (they read as white
    // beads on any colour, laid over it), a fine dark line where it bends
    // the view away, and the light's glint, a fainter one opposite. Drawn
    // after the jelly at their true positions, dimmed by the jelly in front,
    // depth pulled to the jelly surface so tools in front still hide them.
    const mat = new THREE.ShaderMaterial({
      uniforms: { uLight: { value: app.lightDir }, tBg: { value: null }, uBgOn: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, ...app.jelly.coverU },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      // (where the line of sight goes into its piece - the box round it -
      // worked out here, with the camera it's drawn with: worked out with the
      // frame before's, zooming in put that behind the jelly's skin and the
      // bubbles vanished till the camera stopped)
      vertexShader: /* glsl */ `
        attribute vec3 aBoxLo;
        attribute vec3 aBoxHi;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vTint;
        varying vec3 vNv;
        varying float vRad;
        void main() {
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          // (its normal in view space, and its radius on screen - a share of
          // the picture's height: how far to bend what's seen through it)
          vNv = normalize(mat3(viewMatrix) * mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          vec4 cv = viewMatrix * modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float R = length((modelMatrix * instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
          vRad = R * projectionMatrix[1][1] / max(-cv.z, 0.05) * 0.5;
          vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          vTint = instanceColor;
          vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, o = cameraPosition, d = c - o;
          float len = max(length(d), 1e-6);
          d /= len;
          vec3 dd = vec3(abs(d.x) < 1e-6 ? 1e-6 : d.x, abs(d.y) < 1e-6 ? 1e-6 : d.y, abs(d.z) < 1e-6 ? 1e-6 : d.z);
          vec3 tm = min((aBoxLo - o) / dd, (aBoxHi - o) / dd);
          float tEntry = clamp(max(max(tm.x, tm.y), tm.z), 0.0, len);
          float ez = (viewMatrix * vec4(o + d * tEntry, 1.0)).z + 0.02;
          vec4 mv = viewMatrix * wp;
          vec4 clip = projectionMatrix * mv;
          vec4 surf = projectionMatrix * vec4(mv.xy, min(max(mv.z, ez), -0.06), 1.0);
          clip.z = surf.z / surf.w * clip.w;
          gl_Position = clip;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uLight;
        uniform sampler2D tCover;
        uniform float uCoverOn;
        uniform vec2 uCoverInv;
        uniform sampler2D tBg;
        uniform float uBgOn;
        uniform vec2 uRes;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vTint;
        varying vec3 vNv;
        varying float vRad;
        void main() {
          vec3 N = normalize(vN);
          float ndv = clamp(dot(N, vV), 0.0, 1.0), edge = 1.0 - ndv;
          vec3 L = normalize(uLight);
          float silver = smoothstep(0.3, 0.95, edge), line = smoothstep(0.88, 0.995, edge);
          float spec = pow(max(dot(reflect(-L, N), vV), 0.0), 70.0);
          float spec2 = pow(max(dot(reflect(vec3(-L.x, L.y * 0.4, -L.z), N), vV), 0.0), 40.0) * 0.35;
          float lum = max(vTint.r, max(vTint.g, vTint.b));
          // its rim: the jelly's own light, turned back - its colour, brighter
          vec3 rim = vTint * (1.15 + 0.95 * silver) + 0.04;
          vec3 c;
          float a;
          if (uBgOn > 0.5) {
            // its middle: the jelly behind, shrunk and bent (sampled pulled
            // out from the middle - it's a lens that spreads light), a little
            // lighter (less jelly on the way through it)
            vec2 uv = gl_FragCoord.xy / uRes;
            vec2 bend = vNv.xy * vRad * vec2(uRes.y / uRes.x, 1.0) * 1.3;
            vec3 bg = texture(tBg, uv + bend).rgb;
            c = mix(bg * (1.0 + 0.25 * ndv) + vTint * 0.05, rim, silver * 0.85);
            c = mix(c, c * 0.25, line);
            a = clamp(lum * 3.0, 0.0, 1.0);
          } else {
            c = mix(rim, rim * 0.18, line);
            a = clamp(silver * 0.8, 0.0, 1.0) * clamp(lum * 2.5, 0.0, 1.0);
          }
          // the glints: the light seen through the jelly - a little of its colour
          vec3 gl = vec3(4.0) * (spec + spec2) * mix(vec3(1.0), vTint / max(lum, 1e-3), 0.35);
          c += gl;
          a = max(a, clamp((spec + spec2) * 2.0, 0.0, 1.0) * clamp(lum * 2.5, 0.0, 1.0));
          // (under flour, sugar, frost on the skin in front: hidden, as much as it covers)
          if (uCoverOn > 0.5) { float cv = 1.0 - texture(tCover, gl_FragCoord.xy * uCoverInv).r; a *= cv * cv; }
          gl_FragColor = vec4(c, a);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    // (each one's piece's box: see the vertex shader)
    this.boxLo = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.boxHi = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aBoxLo', this.boxLo);
    geo.setAttribute('aBoxHi', this.boxHi);
    this.mesh.renderOrder = 5; // (after the glitter: see above)
    this.mesh.userData.overlay = true; // (drawn over the scene as kept - see App._liteNow - moving or not)
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
    this.version = 0; // (bumped each reseed: the glitter keeps out of where they are)
    this._upSig = NaN; // (how it all was when last sent up: see update)
    this._shape = [];
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
    // (loose in a snow globe - see tick: the clock, a count of moves for update's signature, whether any moved
    // this tick, and a scratch for finding one in the mesh)
    this._lt = -1;
    this._looseV = 0;
    this.looseMoved = false;
    this._out = { tet: -1, b0: 0, b1: 0, b2: 0, b3: 0 };
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
      rMax = Math.max(rMax, b.R);
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
      if (bub.a.tet < 0 || bub.a.tet >= sb.nT || bub.a.lost || bub.gone) continue;
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
              const bub = items[n], r = bub.R;
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
  // Each bubble all of it inside its rounded cube - a box of places inset
  // from the faces put the ones by the rounded edges and corners outside it,
  // and a big one by a face stood out of it - and below its surface map's
  // relief (see setCubeLook: row 31), with a little to spare: moved in from
  // the skin as far as it needs, or, too big for where it fits, smaller.
  reseed() {
    const sb = this.app.sb, D = this.app.jelly?.cubeData, nrm = [0, 0, 0];
    this._cubeVer = sb.cubeVersion;
    this._cavTopo = -1;
    this.version++;
    this.items.length = 0;
    const total = this.want.reduce((t, w) => t + Math.max(0, Math.round(w.count)), 0);
    const f = total > MAX ? MAX / total : 1;
    for (const w of this.want) {
      const slot = w.slot, n = Math.floor(Math.max(0, Math.round(w.count)) * f);
      if (!(sb.cSize[slot] > 0)) continue;
      const size = sb.cSize[slot], half = size / 2, m = Math.min(0.07, half * 0.15), bev = sb.cBevel[slot];
      const relief = this._relief(slot);
      this._shape[slot] = `${bev}:${relief}`;
      const spare = relief + 0.006 * size;
      for (let j = 0; j < n; j++) {
        const P = this.pattern[(j + slot * 61) % MAX];
        let R = P.r * w.scale * size, x = P.u[0] * (half - m), y = P.u[1] * (half - m), z = P.u[2] * (half - m);
        for (let it = 0; it < 4; it++) {
          const d = roundBoxSDF(x, y, z, half, bev);
          if (d <= -(R + spare)) break;
          roundBoxNormal(x, y, z, half, bev, nrm);
          const mv = d + R + spare;
          x -= nrm[0] * mv; y -= nrm[1] * mv; z -= nrm[2] * mv;
        }
        const d = roundBoxSDF(x, y, z, half, bev);
        if (d > -(R + spare)) R = -d - spare;
        if (!(R > 0.0015 * size)) continue; // (no room for it)
        const r = sb.locateRest(x + slot * REST_STEP, y, z);
        // (and, loose: how it's moving, whether it's up against the top, how much of it's left - a burst's
        // shrinking - gone: run into another, or burst)
        this.items.push({ slot, u: P.u, r: P.r, scale: w.scale, R, c: [x, y, z], a: r ? { tet: r.tet, b: r.bary, lost: false } : { tet: -1, b: [0, 0, 0, 0], lost: false }, open: false, v: [0, 0, 0], top: false, life: 1, gone: false });
      }
    }
  }

  // A snow globe's bubbles, loose in its water (App.frame, just after the flakes' step - Glitter.tick, the
  // globe's water as it is this frame): borne up, carried by its swirl, kept off the walls - each one's place
  // at rest moved, as the flakes' are, and found again in the mesh. Shut in, none of their air gets out: they
  // gather under the top, crowd into a layer there and run together into bigger ones; a good shake breaks
  // the big ones up (see _crowd). (Cut up, they're left where they are - the water's gone with the globe.)
  tick(time) {
    const app = this.app, sb = app.sb, globes = app.glitter?.globes;
    const dt = this._lt < 0 ? 0 : Math.min(0.05, time - this._lt);
    this._lt = time;
    this.looseMoved = false;
    if (!(dt > 0) || app.paused || !globes?.size || !this.items.length) return;
    const h = dt * (app.timeScale ?? 1), id = 1 / (1 + h / DRAG_T);
    let moved = false;
    for (const b of this.items) {
      if (b.gone || b.open || b.a.lost || b.a.tet < 0) continue;
      const st = globes.get(b.slot);
      if (!st || !st.on || !st.pull || !(st.gmag > 0)) continue;
      const u = b.v;
      // (up at the top and still there, the water calm, up still up: left be)
      if (b.top && !st.stirred && !u[0] && !u[1] && !u[2]) continue;
      const c = b.c, ux = -st.down[0], uy = -st.down[1], uz = -st.down[2];
      let x = c[0], y = c[1], z = c[2];
      // the water here, as the flakes feel it (the turning, and the stir's eddies)
      const sp = st.spin, kk = st.k, ph = st.ph, amp = st.stir * SWIRL * st.size;
      let fx = sp[1] * z - sp[2] * y, fy = sp[2] * x - sp[0] * z, fz = sp[0] * y - sp[1] * x;
      if (amp > 0) {
        const k2 = kk * 2.6, a2 = amp * 0.55;
        fx += amp * (Math.sin(kk * z + ph) + Math.cos(kk * y + 1.3 * ph)) + a2 * (Math.sin(k2 * z - 1.7 * ph + 1) + Math.cos(k2 * y + 2.1 * ph));
        fy += amp * (Math.sin(kk * x + 0.7 * ph) + Math.cos(kk * z + ph)) + a2 * (Math.sin(k2 * x + 1.9 * ph + 2) + Math.cos(k2 * z - 1.3 * ph));
        fz += amp * (Math.sin(kk * y + 1.3 * ph) + Math.cos(kk * x + 0.7 * ph)) + a2 * (Math.sin(k2 * y - 2.3 * ph + 3) + Math.cos(k2 * x + 1.1 * ph));
      }
      // (the water churned up: the ones under the top pushed down off it, most so the nearer they are - as the
      // flakes on the bottom are lifted - and each, rising, rocking from side to side as a bubble does)
      if (st.stir > 0.15) {
        const hgt = (x * ux + y * uy + z * uz) / st.half, press = (st.stir - 0.15) * 1.1 * SWIRL * st.size * Math.max(0, 0.5 + 0.5 * hgt);
        fx -= ux * press; fy -= uy * press; fz -= uz * press;
      }
      if (!b.top) {
        const w = 0.012 * st.size, ph2 = time * (5 + b.r * 300) + b.u[0] * 9;
        fx += w * Math.sin(ph2); fz += w * Math.cos(ph2 * 0.83 + b.u[2] * 5);
      }
      // borne up - a big one faster - and dragged along with the water
      const rise = st.gmag * BUOY * (0.6 + 0.4 * Math.min(2.5, b.R / (0.008 * st.size))) * Math.exp(-4 * st.visc);
      u[0] = (u[0] + h * (fx / DRAG_T + ux * rise)) * id;
      u[1] = (u[1] + h * (fy / DRAG_T + uy * rise)) * id;
      u[2] = (u[2] + h * (fz / DRAG_T + uz * rise)) * id;
      x += u[0] * h; y += u[1] * h; z += u[2] * h;
      // the walls: inside the rounded box, its radius and a little in
      const m = b.R + 0.004 * st.size, core = st.half - Math.max(st.b, m), rad = Math.max(0, st.b - m);
      const cx = Math.max(-core, Math.min(core, x)), cy = Math.max(-core, Math.min(core, y)), cz = Math.max(-core, Math.min(core, z));
      const dx = x - cx, dy = y - cy, dz = z - cz, d2 = dx * dx + dy * dy + dz * dz;
      let top = false;
      if (d2 > rad * rad && d2 > 0) {
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d;
        x = cx + nx * rad; y = cy + ny * rad; z = cz + nz * rad;
        const un = u[0] * nx + u[1] * ny + u[2] * nz;
        if (un > 0) { u[0] -= un * nx; u[1] -= un * ny; u[2] -= un * nz; }
        // (borne up against the top: it slides up along it, slowing, to where it's highest - and there stays)
        if (nx * ux + ny * uy + nz * uz > 0.55) {
          top = true;
          u[0] *= 0.9; u[1] *= 0.9; u[2] *= 0.9;
          const lim = 0.02 * st.size;
          if (!st.stirred && u[0] * u[0] + u[1] * u[1] + u[2] * u[2] < lim * lim) u[0] = u[1] = u[2] = 0;
        }
      }
      b.top = top;
      c[0] = x; c[1] = y; c[2] = z;
      this._locate(b);
      moved = true;
    }
    if (this._crowd(h, globes)) moved = true;
    if (moved) this._looseV++;
    this.looseMoved = moved;
  }

  // found in the mesh where it is now: still in its tet (most frames), else looked up
  _locate(b) {
    const sb = this.app.sb, X = sb.X, T = sb.T, B = sb.B, c = b.c, RX = c[0] + b.slot * REST_STEP, y = c[1], z = c[2], a = b.a, t0 = a.tet;
    if (t0 >= 0 && t0 < sb.nT) {
      const i = T[t0 * 4] * 3, o = t0 * 9, rx = RX - X[i], ry = y - X[i + 1], rz = z - X[i + 2];
      const b1 = B[o] * rx + B[o + 1] * ry + B[o + 2] * rz, b2 = B[o + 3] * rx + B[o + 4] * ry + B[o + 5] * rz, b3 = B[o + 6] * rx + B[o + 7] * ry + B[o + 8] * rz, b0 = 1 - b1 - b2 - b3;
      if (b0 >= -1e-6 && b1 >= -1e-6 && b2 >= -1e-6 && b3 >= -1e-6) {
        a.b[0] = b0; a.b[1] = b1; a.b[2] = b2; a.b[3] = b3;
        return;
      }
    }
    const r = sb.locateRestFast(RX, y, z, this._out);
    if (r) {
      a.tet = r.tet;
      a.b[0] = r.b0; a.b[1] = r.b1; a.b[2] = r.b2; a.b[3] = r.b3;
    }
  }

  // Shut in, their air's all kept. Two touching run together into one - now and then, not at once: the film
  // between them has to drain - as much air as the two, where they were (the bigger's way); short of that,
  // they're kept apart, so a crowd under the top spreads into a layer. The water churned up hard breaks a big
  // one in two - each half its air - side by side. (Whether anything moved.)
  _crowd(h, globes) {
    const items = this.items, n = items.length, pm = 1 - Math.exp(-MERGE * h);
    let changed = false;
    for (let i = 0; i < n; i++) {
      const A = items[i];
      if (A.gone || A.open || A.a.lost || A.a.tet < 0) continue;
      const st = globes.get(A.slot);
      if (!st || !st.on || !st.pull) continue;
      // churned up: a big one in two
      const rs = SPLIT_R * st.size;
      if (st.stir > CHURN && A.R > rs && Math.random() < 1 - Math.exp(-SPLIT * (st.stir - CHURN) * (A.R / rs - 1) * h)) {
        const B = this._spare();
        if (B) {
          const R = A.R / Math.cbrt(2), z = Math.random() * 2 - 1, th = Math.random() * 6.2832, q = Math.sqrt(1 - z * z);
          const ox = q * Math.cos(th) * R, oy = z * R, oz = q * Math.sin(th) * R;
          B.slot = A.slot;
          B.u = [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1];
          B.r = A.r;
          B.scale = A.scale;
          B.R = A.R = R;
          B.c = [A.c[0] + ox, A.c[1] + oy, A.c[2] + oz];
          A.c[0] -= ox; A.c[1] -= oy; A.c[2] -= oz;
          B.a = { tet: A.a.tet, b: [...A.a.b], lost: false };
          B.open = false;
          B.v = [A.v[0], A.v[1], A.v[2]];
          B.top = A.top = false;
          B.life = 1;
          B.gone = false;
          this._locate(A);
          this._locate(B);
          changed = true;
        }
      }
      for (let j = i + 1; j < n; j++) {
        const B = items[j];
        if (B.gone || B.slot !== A.slot || B.open || B.a.lost || B.a.tet < 0) continue;
        const dx = B.c[0] - A.c[0], dy = B.c[1] - A.c[1], dz = B.c[2] - A.c[2], d2 = dx * dx + dy * dy + dz * dz, rr = A.R + B.R;
        if (d2 >= rr * rr) continue;
        // (touching: run together, now and then - into the bigger, where the two were, weighed by their air)
        const R = Math.cbrt(A.R * A.R * A.R + B.R * B.R * B.R);
        if (R < BIG * st.size && Math.random() < pm) {
          const [K, L] = A.R >= B.R ? [A, B] : [B, A], wk = K.R * K.R * K.R, wl = L.R * L.R * L.R, wt = wk + wl;
          for (let k = 0; k < 3; k++) {
            K.c[k] = (K.c[k] * wk + L.c[k] * wl) / wt;
            K.v[k] = (K.v[k] * wk + L.v[k] * wl) / wt;
          }
          K.R = R;
          K.top = false;
          L.gone = true;
          this._locate(K);
          changed = true;
          if (L === A) break;
          continue;
        }
        // (else kept apart: each moved off half of how far they're in each other - till they're nearly clear)
        const d = Math.sqrt(d2);
        if (d > 0.9 * rr) continue;
        const ux = d > 1e-6 ? dx / d : 1, uy = d > 1e-6 ? dy / d : 0, uz = d > 1e-6 ? dz / d : 0, push = (0.9 * rr - d) / 2;
        A.c[0] -= ux * push; A.c[1] -= uy * push; A.c[2] -= uz * push;
        B.c[0] += ux * push; B.c[1] += uy * push; B.c[2] += uz * push;
        A.top = B.top = false;
        changed = true;
      }
    }
    return changed;
  }

  // a bubble to break another into: one that's gone, else a new one, while there's room
  _spare() {
    for (const b of this.items) if (b.gone && !b.open) return b;
    if (this.items.length >= MAX) return null;
    const b = { slot: 0, u: [0, 0, 0], r: 0, scale: 1, R: 0, c: [0, 0, 0], a: { tet: -1, b: [0, 0, 0, 0], lost: false }, open: false, v: [0, 0, 0], top: false, life: 1, gone: true };
    this.items.push(b);
    return b;
  }

  // a bubble bursting where it meets the open air (a cut's spill - to come): a pinch of spray and a tiny 'plip'
  _burst(b) {
    const app = this.app, sb = app.sb, t = this._t;
    if (!(b.a.tet >= 0 && b.a.tet < sb.nT)) return;
    sb.embedPoint(b.a.tet, b.a.b, t);
    const P = app.particles?.add, r = b.R;
    for (let i = 0; P && i < 5; i++) {
      const z = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, q = Math.sqrt(1 - z * z), s = 0.25 + 0.35 * Math.random();
      P.spawn(t[0] + q * Math.cos(th) * r, t[1] + z * r, t[2] + q * Math.sin(th) * r, q * Math.cos(th) * s, z * s + 0.15, q * Math.sin(th) * s, 0.16 + 0.12 * Math.random(), 0.0035, 0.001, [1, 1, 1, 0.75], [1, 1, 1, 0], 4, 0);
    }
    app.audio?.bubble?.(r, app._pan ? app._pan(t[0], t[1], t[2]) : 0);
  }

  // (how deep a cube's surface map's hollows go, m)
  _relief(slot) {
    const D = this.app.jelly?.cubeData;
    return D ? Math.max(0, D[slot * CUBE_TEX_W * 4 + 31 * 4 + 1] || 0) : 0;
  }

  update() {
    const app = this.app;
    const sb = app.sb;
    const cam = app.camera;
    const F = app.jelly.frontMat.uniforms;
    // (cubes come or gone and the tets renumbered: every bubble re-finds
    // its place)
    if (this._cubeVer !== sb.cubeVersion) this.reseed();
    // (a cube's rounding or its surface map's depth changed - once its new
    // edges have finished forming: placed afresh, all inside it)
    else if (!app._edgeMorph)
      for (const w of this.want)
        if (sb.cSize[w.slot] > 0 && this._shape[w.slot] !== `${sb.cBevel[w.slot]}:${this._relief(w.slot)}`) {
          this.reseed();
          break;
        }
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
    // (all of it still and seen from where it was: as they were - not worked out and sent up again each frame)
    const J = app.jelly, sig = J.posVersion + ox * 1.31 + oy * 1.73 + oz * 2.07 + this.version * 3.1 + sb.topoVersion * 5.7 + J.cubeTex.version * 7.3 + this.items.length * 11.9 + this._looseV * 13.7;
    if (!sb.anyAwake && sig === this._upSig) return;
    this._upSig = sig;
    const tint = this._tint || (this._tint = new THREE.Color());
    let c = 0;
    for (const b of this.items) {
      if (b.a.tet < 0 || b.a.tet >= sb.nT || b.a.lost || b.open || b.gone) continue;
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
      const L = len - t0;
      const lo = this.boxLo.array, hi = this.boxHi.array;
      if (bb) {
        lo[c * 3] = bb[0]; lo[c * 3 + 1] = bb[1]; lo[c * 3 + 2] = bb[2];
        hi[c * 3] = bb[3]; hi[c * 3 + 1] = bb[4]; hi[c * 3 + 2] = bb[5];
      } else {
        lo[c * 3] = hi[c * 3] = px; lo[c * 3 + 1] = hi[c * 3 + 1] = py; lo[c * 3 + 2] = hi[c * 3 + 2] = pz;
      }
      const fade = vis * Math.exp(-D[row + 3] * L * 0.8) * b.life;
      tint.setRGB(
        (0.25 + 0.75 * D[row + 4]) * Math.exp(-D[row] * L) * fade,
        (0.25 + 0.75 * D[row + 5]) * Math.exp(-D[row + 1] * L) * fade,
        (0.25 + 0.75 * D[row + 6]) * Math.exp(-D[row + 2] * L) * fade,
      );
      this.mesh.setColorAt(c, tint);
      this._p.set(px, py, pz);
      this._s.setScalar(b.R * (1 + 0.35 * (1 - b.life)));
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(c++, this._m);
    }
    this.mesh.count = c;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.boxLo.needsUpdate = true;
    this.boxHi.needsUpdate = true;
  }
}
