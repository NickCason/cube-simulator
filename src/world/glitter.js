import * as THREE from 'three';
import { CUBE_GLSL } from '../render/jellyMaterials.js';
import { roundBoxSDF } from '../sim/mesh.js';
import { REST_STEP } from '../sim/softbody.js';
import { frameOf } from '../tools/cubey.js';

const MAX = 9000;
export const GLITTER_MODES = { off: -1, silver: 0, gold: 1, holo: 2, rose: 3, cubic: 4, snow: 5 };
const SNOW = 5;
// A snow globe's flakes: loose in it (see Glitter._loose). How much of the
// pull they feel (gravity less the cube's own acceleration: they're barely
// heavier than the water they're in), how quickly the water drags them its
// way (s), how long it keeps turning once set turning (s), how long a stir
// lasts (s), and how fast it swirls them, stirred right up (a share of the
// cube's size, a second).
const SINK = 0.045, DRAG_T = 0.12, SPIN_T = 2.2, STIR_T = 1.7, SWIRL = 0.32;

// Glitter suspended in the jelly. Each flake is anchored barycentrically in a
// tet; the GPU reads the simulated vertex positions from a float texture, so
// thousands of flakes cost almost nothing on the CPU. A flake's normal turns
// with the local deformation (cofactor of the tet's edge matrix), so wobbling
// jelly twinkles. Drawn after the jelly with additive glints, tinted and
// dimmed by the jelly in front of it, depth pulled to the jelly surface.
export class Glitter {
  constructor(app) {
    this.app = app;
    this.mode = 'off';
    this.count = 2600;
    this.size = 1;
    this.sparkle = 1;
    this.topo = -1;
    this.anchoredFor = '';
    let seed = 1234567;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    this.u = new Float32Array(MAX * 3);
    this.n0 = new Float32Array(MAX * 3);
    // (a snow globe's flakes, loose: where each is in its cube at rest, how
    // it's moving there, which way it faces (they tumble), the way it turns,
    // and whether it's settled - and each globe's water: see _loose)
    this.lp = new Float32Array(MAX * 3);
    this.lv = new Float32Array(MAX * 3);
    this.ln = new Float32Array(MAX * 3);
    this.lw = new Float32Array(MAX * 3);
    this.lz = new Uint8Array(MAX);
    this.globes = new Map();
    this._lt = -1;
    // (what's been sent to the GPU: the jelly's positions as of this version of them - see JellyView.posVersion -
    // and whether a snow globe's flakes moved this tick)
    this._posV = -1;
    this._posN = -1;
    this._bbSig = NaN;
    this.looseMoved = false;
    this.seed = new Float32Array(MAX * 3);
    for (let i = 0; i < MAX; i++) {
      this.u[i * 3] = rnd() * 2 - 1;
      this.u[i * 3 + 1] = rnd() * 2 - 1;
      this.u[i * 3 + 2] = rnd() * 2 - 1;
      // random flake orientation
      const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      this.n0[i * 3] = r * Math.cos(a);
      this.n0[i * 3 + 1] = z;
      this.n0[i * 3 + 2] = r * Math.sin(a);
      this.seed[i * 3] = 0.55 + rnd() * 0.9; // size factor
      this.seed[i * 3 + 1] = rnd(); // hue (holo)
      this.seed[i * 3 + 2] = rnd(); // shimmer phase
      const wz = rnd() * 2 - 1, wa = rnd() * Math.PI * 2, wr = Math.sqrt(1 - wz * wz);
      this.lw[i * 3] = wr * Math.cos(wa);
      this.lw[i * 3 + 1] = wz;
      this.lw[i * 3 + 2] = wr * Math.sin(wa);
    }

    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const ia = (n) => new THREE.InstancedBufferAttribute(new Float32Array(MAX * n), n);
    this.aTet = ia(4);
    this.aBary = ia(4);
    this.aM = ia(3);
    this.aSeed = ia(3);
    this.aInfo = ia(2);
    this.aMode = ia(1); // (each flake its cube's glitter)
    this.aRestK = ia(4); // (where it sits in its cube at rest, and which cube: its tint by that cube's colours)
    g.setAttribute('aTet', this.aTet);
    g.setAttribute('aBary', this.aBary);
    g.setAttribute('aM', this.aM);
    g.setAttribute('aSeed', this.aSeed);
    g.setAttribute('aInfo', this.aInfo);
    g.setAttribute('aMode', this.aMode);
    g.setAttribute('aRestK', this.aRestK);
    g.instanceCount = 0;
    this.geo = g;
    // cubic zirconia: each flake a tiny cube (the same flakes, a box to draw)
    const box = new THREE.BoxGeometry(2, 2, 2);
    const gc = new THREE.InstancedBufferGeometry();
    for (const k of ['position', 'normal', 'uv']) gc.setAttribute(k, box.getAttribute(k));
    gc.setIndex(box.getIndex());
    for (const k of ['aTet', 'aBary', 'aM', 'aSeed', 'aInfo', 'aMode', 'aRestK']) gc.setAttribute(k, g.getAttribute(k));
    gc.instanceCount = 0;
    this.geoCube = gc;

    this.posW = 128;
    this._allocPosTex(4096);
    this._allocBBTex(64);
    const F = app.jelly.frontMat.uniforms;
    this.uniforms = {
      ...app.jelly.coverU,
      uCubeTex: { value: app.jelly.cubeTex },
      uGradTex: { value: app.jelly.gradTex },
      uFreeTex: { value: app.jelly.freeTex },
      uPos: { value: this.posTex },
      uPosW: { value: this.posW },
      uSize: { value: 0.0055 },
      uPxScale: { value: 800 },
      uMinPx: { value: 1.6 },
      uBB: { value: this.bbTex },
      uTime: { value: 0 },
      uLight: { value: app.lightDir },
      uLightColor: F.uLightColor,
      envMap: { value: app.env.texture },
      uMode: { value: 0 },
      uSparkle: { value: 1 },
      uShine: { value: 420 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform sampler2D uPos;
        uniform int uPosW;
        uniform float uSize;
        uniform float uPxScale;
        uniform float uMinPx;
        uniform highp sampler2D uBB; // (each piece's bounding box: its low corner, row 0; its high, row 1)
        uniform float uTime;
        ${CUBE_GLSL}
        attribute vec4 aTet;
        attribute vec4 aBary;
        attribute vec3 aM;
        attribute vec3 aSeed;
        attribute vec2 aInfo;
        attribute float aMode;
        attribute vec4 aRestK;
        varying float vMode;
        varying vec3 vN;
        varying vec3 vV;
        varying vec2 vUv;
        varying vec3 vTint;
        varying float vHue;
        varying float vBoost;
        vec3 P(float f) {
          int i = int(f + 0.5);
          return texelFetch(uPos, ivec2(i - (i / uPosW) * uPosW, i / uPosW), 0).xyz;
        }
        void main() {
          // (cubic flakes in the cube mesh, the rest in the flat one)
          #ifdef CUBE
          bool other = abs(aMode - 4.0) > 0.5;
          #else
          bool other = abs(aMode - 4.0) < 0.5;
          #endif
          if (aSeed.x <= 0.0 || other) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vMode = aMode;
          vec3 x0 = P(aTet.x), x1 = P(aTet.y), x2 = P(aTet.z), x3 = P(aTet.w);
          vec3 c = x0 * aBary.x + x1 * aBary.y + x2 * aBary.z + x3 * aBary.w;
          vec3 e1 = x1 - x0, e2 = x2 - x0, e3 = x3 - x0;
          // flake normal follows the deformation: cofactor(Ds) * (Dm^T n0)
          vec3 n = cross(e2, e3) * aM.x + cross(e3, e1) * aM.y + cross(e1, e2) * aM.z;
          n = normalize(n + 1e-9);
          // a whisper of shimmer so resting glitter still twinkles
          float ph = aSeed.z * 6.2831 + uTime * (0.5 + aSeed.z * 0.8);
          n = normalize(n + 0.03 * vec3(sin(ph), cos(ph * 1.3), sin(ph * 0.7 + 1.0)));
          vec3 t = normalize(abs(n.y) < 0.9 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
          vec3 b = cross(n, t);
          float r = uSize * aSeed.x;
          vec4 mvc = viewMatrix * vec4(c, 1.0);
          float px = r * uPxScale / max(-mvc.z, 0.05);
          float k = max(1.0, uMinPx / max(px, 1e-4));
          #ifdef CUBE
          // a little cube on the flake's own axes, turning with the jelly
          vec3 wp = c + (t * position.x + b * position.y + n * position.z) * r * k * 0.72;
          vN = t * normal.x + b * normal.y + n * normal.z;
          vUv = uv * 2.0 - 1.0;
          #else
          vec3 wp = c + (t * position.x + b * position.y) * r * k;
          vN = n;
          vUv = position.xy;
          #endif
          vV = cameraPosition - wp;
          vHue = aSeed.y;
          vBoost = 1.0 / sqrt(k);
          // how much jelly sits in front: enter the piece's bounding box
          vec3 o = cameraPosition;
          vec3 d = c - o;
          float len = length(d);
          d /= len;
          int pi = int(aInfo.y + 0.5);
          float tEntry = 0.0;
          if (pi < textureSize(uBB, 0).x) {
            vec3 dd = vec3(abs(d.x) < 1e-6 ? 1e-6 : d.x, abs(d.y) < 1e-6 ? 1e-6 : d.y, abs(d.z) < 1e-6 ? 1e-6 : d.z);
            vec3 ta = (texelFetch(uBB, ivec2(pi, 0), 0).xyz - o) / dd, tb = (texelFetch(uBB, ivec2(pi, 1), 0).xyz - o) / dd;
            vec3 tm = min(ta, tb);
            tEntry = clamp(max(max(tm.x, tm.y), tm.z), 0.0, len);
          }
          float L = len - tEntry;
          // (tinted by its own cube's colour where it sits - its gradient,
          // its Rubik sticker - and dimmed by its haze)
          useCube(aRestK.w);
          vec3 sig = cLayers > 0 ? cGradAt(aRestK.xyz, 0) : cLayers < 0 ? cubeT(7 + rubikAt(aRestK.xyz)).rgb : cubeT(0).rgb;
          vTint = exp(-sig * L) * exp(-(cubeT(0).a * 0.8 + cubeT(1).a * 8.0) * L);
          vec3 ep = o + d * tEntry;
          vec4 mve = viewMatrix * vec4(ep, 1.0);
          vec4 clip = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          vec4 sclip = projectionMatrix * vec4(mve.xy, min(mve.z + 0.02, -0.06), 1.0);
          clip.z = sclip.z / sclip.w * clip.w;
          gl_Position = clip;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uLight;
        uniform vec3 uLightColor;
        uniform samplerCube envMap;
        uniform float uSparkle;
        uniform sampler2D tCover;
        uniform float uCoverOn;
        uniform vec2 uCoverInv;
        varying float vMode;
        uniform float uShine;
        varying vec3 vN;
        varying vec3 vV;
        varying vec2 vUv;
        varying vec3 vTint;
        varying float vHue;
        varying float vBoost;
        vec3 hue(float h) {
          return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        }
        void main() {
          vec2 q = abs(vUv);
          #ifdef CUBE
          // cut-glass: each face's rim catches the light
          float rim = 1.0 + 1.6 * smoothstep(0.5, 1.0, max(q.x, q.y));
          #else
          if (max(q.x * 0.8660254 + q.y * 0.5, q.y) > 1.0) discard; // hexagonal flake
          float rim = 1.0;
          #endif
          if (dot(vN, vN) < 1e-20) discard; // (a flattened flake has no normal)
          vec3 n = normalize(vN);
          vec3 V = normalize(vV);
          float ndv = dot(n, V);
          if (ndv < 0.0) { n = -n; ndv = -ndv; }
          vec3 L = normalize(uLight);
          float glint = pow(max(dot(n, normalize(L + V)), 0.0), uShine) * step(0.0, dot(n, L));
          vec3 env = textureLod(envMap, reflect(-V, n), 0.6).rgb;
          env = env * env * 0.8; // keep the bright softboxes, drop the grey studio
          vec3 col;
          int uMode = int(vMode + 0.5);
          if (uMode == 1) col = vec3(1.0, 0.74, 0.32);
          else if (uMode == 2) col = mix(vec3(1.0), hue(fract(vHue + ndv * 1.8)), 0.85);
          else if (uMode == 3) col = vec3(1.0, 0.6, 0.56);
          else if (uMode == 4) col = mix(vec3(1.0), hue(fract(vHue + ndv * 2.6 + dot(n, L) * 0.7)), 0.55); // white, with fire
          else col = vec3(0.92, 0.95, 1.0);
          // (snow: white flakes, seen whichever way they face - a soft body of
          // their own - and a glint now and then as they tumble)
          float own = uMode == 5 ? 0.3 + 0.25 * max(dot(n, L), 0.0) : 0.03;
          vec3 c = col * (env * (uMode == 5 ? 0.5 : 1.0) + uLightColor * glint * (uMode == 5 ? 6.0 : 14.0)) * uSparkle * rim + col * own;
          // (under flour, sugar, frost on the skin in front: hidden, as much as it covers)
          if (uCoverOn > 0.5) { float cv = 1.0 - texture(tCover, gl_FragCoord.xy * uCoverInv).r; c *= cv * cv; }
          gl_FragColor = vec4(min(c * vTint * vBoost, vec3(64.0)), 1.0);
        }`,
    });
    this.mat = mat;
    // (the cubic flakes' own: made the same way - a clone of it copied the
    // uniforms, and the room's reflection, a render target's, can't be)
    this.matCube = new THREE.ShaderMaterial({ uniforms: this.uniforms, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, vertexShader: mat.vertexShader, fragmentShader: mat.fragmentShader, defines: { CUBE: '' } });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    app.fxScene.add(this.mesh);
    // (cubic flakes too when some cubes are flat-glittered and some cubic)
    this.meshCube = new THREE.Mesh(this.geoCube, this.matCube);
    this.meshCube.frustumCulled = false;
    this.meshCube.renderOrder = 4;
    this.meshCube.visible = false;
    app.fxScene.add(this.meshCube);
    this.groups = [];
  }

  _allocPosTex(nV) {
    const H = Math.ceil(nV / this.posW);
    if (this.posTex && this.posTex.image.height >= H) return;
    const h = Math.max(H, 32);
    if (this.posTex) this.posTex.dispose();
    this.posData = new Float32Array(this.posW * h * 4);
    this.posTex = new THREE.DataTexture(this.posData, this.posW, h, THREE.RGBAFormat, THREE.FloatType);
    this.posTex.minFilter = this.posTex.magFilter = THREE.NearestFilter;
    this.posTex.needsUpdate = true;
    if (this.uniforms) this.uniforms.uPos.value = this.posTex;
  }

  // (the pieces' bounding boxes, room for n of them)
  _allocBBTex(n) {
    if (this.bbTex && this.bbTex.image.width >= n) return;
    let w = 64;
    while (w < n) w *= 2;
    if (this.bbTex) this.bbTex.dispose();
    this.bbData = new Float32Array(w * 2 * 4);
    this.bbTex = new THREE.DataTexture(this.bbData, w, 2, THREE.RGBAFormat, THREE.FloatType);
    this.bbTex.minFilter = this.bbTex.magFilter = THREE.NearestFilter;
    this.bbTex.needsUpdate = true;
    if (this.uniforms) this.uniforms.uBB.value = this.bbTex;
  }

  configure({ mode, count, size, sparkle }) {
    if (mode !== undefined) this.mode = mode;
    if (count !== undefined) this.count = Math.max(0, Math.min(MAX, Math.round(count)));
    if (size !== undefined) this.size = size;
    if (sparkle !== undefined) this.sparkle = sparkle;
    this.uniforms.uSparkle.value = this.sparkle;
    // each cube's own glitter (several cubes: those with any share the flakes)
    const cubes = this.app.cubes || [{ slot: 0, style: { glitter: this.mode } }];
    this.groups = cubes.filter((c) => c.style.glitter && c.style.glitter !== 'off').map((c) => ({ slot: c.slot, mode: GLITTER_MODES[c.style.glitter] ?? 0 }));
    this.anyCubic = this.groups.some((g) => g.mode === 4);
    this.anySnow = this.groups.some((g) => g.mode === SNOW);
    this.anyFlat = this.groups.some((g) => g.mode !== 4);
    this.mesh.geometry = this.anyFlat ? this.geo : this.geoCube;
    this.mesh.material = this.anyFlat ? this.mat : this.matCube;
    this.meshCube.visible = false;
  }

  _key() {
    const sb = this.app.sb, B = this.app.bubbles;
    // (and where the bubbles are: the flakes keep out of them)
    return `${this.count}|${this.size.toFixed(3)}|${this.groups.map((g) => g.slot + ':' + g.mode + ':' + sb.cSize[g.slot].toFixed(4)).join(',')}|${B ? B.version : ''}`;
  }

  // The bubbles, cube by cube, in a grid of their rest places - for the
  // flakes to keep out of: { slot: { cell, map: Map(cell key -> [x, y, z, r]) } }
  _bubbleGrid() {
    const sb = this.app.sb, B = this.app.bubbles, out = {};
    if (!B) return out;
    for (const b of B.items) {
      const g = out[b.slot] || (out[b.slot] = { cell: 0.08 * sb.cSize[b.slot], map: new Map() });
      const [x, y, z] = b.c, r = b.R;
      const key = `${Math.floor(x / g.cell)},${Math.floor(y / g.cell)},${Math.floor(z / g.cell)}`;
      (g.map.get(key) || g.map.set(key, []).get(key)).push([x, y, z, r]);
    }
    return out;
  }

  // (Re)anchor flakes at their rest positions in the current mesh.
  _anchor() {
    const sb = this.app.sb;
    const X = sb.X, T = sb.T;
    const grid = this._bubbleGrid();
    const out = { tet: -1, b0: 0, b1: 0, b2: 0, b3: 0 };
    const n = this.count, G = this.groups.length ? this.groups : [{ slot: 0, mode: 0 }];
    for (let k = 0; k < n; k++) {
      // (shared out among the glittery cubes, each in its own rest space)
      const grp = G[k % G.length];
      // (each cube its own size)
      const half = sb.cSize[grp.slot] / 2, m = Math.min(0.03, half * 0.06);
      let px = this.u[k * 3] * (half - m), py = this.u[k * 3 + 1] * (half - m), pz = this.u[k * 3 + 2] * (half - m);
      // (not in a bubble, nor touching one: a flake that would be is moved -
      // to the first of a few other places, in its own sequence, clear of
      // them all - or, none clear, it's left out)
      const bg = grid[grp.slot];
      if (bg) {
        const fr = 0.0072 * this.size * sb.cSize[grp.slot] * this.seed[k * 3] * 1.4 + 0.004;
        const clear = (x, y, z) => {
          const ci = Math.floor(x / bg.cell), cj = Math.floor(y / bg.cell), ck = Math.floor(z / bg.cell);
          for (let di = -2; di <= 2; di++)
            for (let dj = -2; dj <= 2; dj++)
              for (let dk = -2; dk <= 2; dk++) {
                const L = bg.map.get(`${ci + di},${cj + dj},${ck + dk}`);
                if (!L) continue;
                for (const [bx, by, bz, br] of L) {
                  const rr = br + fr;
                  if ((x - bx) ** 2 + (y - by) ** 2 + (z - bz) ** 2 < rr * rr) return false;
                }
              }
          return true;
        };
        if (!clear(px, py, pz)) {
          let ok = false;
          for (let j = 1; j <= 6 && !ok; j++) {
            const qx = (((this.u[k * 3] + 1) / 2 + j * 0.6180339) % 1) * 2 - 1, qy = (((this.u[k * 3 + 1] + 1) / 2 + j * 0.4142135) % 1) * 2 - 1, qz = (((this.u[k * 3 + 2] + 1) / 2 + j * 0.7320508) % 1) * 2 - 1;
            const x = qx * (half - m), y = qy * (half - m), z = qz * (half - m);
            if (clear(x, y, z)) (px = x), (py = y), (pz = z), (ok = true);
          }
          if (!ok) {
            this.aSeed.array[k * 3] = 0;
            continue;
          }
        }
      }
      this.aMode.array[k] = grp.mode;
      let r = null;
      if (roundBoxSDF(px, py, pz, half, sb.cBevel[grp.slot]) < -m * 0.5) r = sb.locateRestFast(px + grp.slot * REST_STEP, py, pz, out);
      if (!r) {
        this.aSeed.array[k * 3] = 0;
        continue;
      }
      const t = r.tet;
      const a = T[t * 4], b = T[t * 4 + 1], c = T[t * 4 + 2], d = T[t * 4 + 3];
      this.aTet.array.set([a, b, c, d], k * 4);
      this.aBary.array.set([r.b0, r.b1, r.b2, r.b3], k * 4);
      const nx = this.n0[k * 3], ny = this.n0[k * 3 + 1], nz = this.n0[k * 3 + 2];
      const a3 = a * 3;
      const dot = (v) => (X[v * 3] - X[a3]) * nx + (X[v * 3 + 1] - X[a3 + 1]) * ny + (X[v * 3 + 2] - X[a3 + 2]) * nz;
      this.aM.array[k * 3] = dot(b);
      this.aM.array[k * 3 + 1] = dot(c);
      this.aM.array[k * 3 + 2] = dot(d);
      this.aSeed.array[k * 3] = this.seed[k * 3] * (grp.mode === SNOW ? 1.6 : 1);
      this.aSeed.array[k * 3 + 1] = this.seed[k * 3 + 1];
      this.aSeed.array[k * 3 + 2] = this.seed[k * 3 + 2];
      this.aInfo.array[k * 2] = py;
      this.aInfo.array[k * 2 + 1] = sb.tPiece[t];
      this.aRestK.array.set([px, py, pz, grp.slot], k * 4);
      if (grp.mode === SNOW) {
        this.lp[k * 3] = px; this.lp[k * 3 + 1] = py; this.lp[k * 3 + 2] = pz;
        this.lv[k * 3] = this.lv[k * 3 + 1] = this.lv[k * 3 + 2] = 0;
        this.ln[k * 3] = nx; this.ln[k * 3 + 1] = ny; this.ln[k * 3 + 2] = nz;
        this.lz[k] = 0;
      }
    }
    this.globes.clear();
    for (const at of [this.aTet, this.aBary, this.aM, this.aSeed, this.aInfo, this.aMode, this.aRestK]) at.needsUpdate = true;
    this.geo.instanceCount = n;
    this.geoCube.instanceCount = n;
    this.topo = sb.topoVersion;
    this.anchoredFor = this._key();
  }

  // A snow globe: its flakes loose in the water it's full of. Each one's
  // place in the cube at rest (the cube's own space: turned with it, carried
  // with it) moved a frame at a time - sinking slowly the way that's down
  // now, flung as the cube's shaken or knocked (its acceleration, felt the
  // other way), swirled by the water: set turning the other way as the cube
  // turns (and slowly catching up), stirred into eddies by a shake (dying
  // down) - stopped by the walls, tumbling as they go (they twinkle); found
  // again in the mesh, drawn there. Settled, they're left be till it moves.
  // Cut up, they're set where they are.
  _loose(dt, time) {
    const sb = this.app.sb, X = sb.X, T = sb.T, B = sb.B, out = this._out || (this._out = { tet: -1, b0: 0, b1: 0, b2: 0, b3: 0 });
    const gy = sb.p.gravity * (sb.gravityScale ?? 1);
    const A = this.aTet.array, Ba = this.aBary.array, M = this.aM.array, I = this.aInfo.array, RK = this.aRestK.array, S = this.aSeed.array, MD = this.aMode.array;
    // each globe: how it lies and moves now - the pull in its own space, its
    // water's turning and stir
    let any = false;
    for (const grp of this.groups) {
      if (grp.mode !== SNOW) continue;
      const slot = grp.slot;
      let pc = null, np = 0;
      for (const p of sb.pieces) if (p.cube === slot && ++np === 1) pc = p;
      let st = this.globes.get(slot);
      if (!st) this.globes.set(slot, (st = { vel: null, w: [0, 0, 0], spin: [0, 0, 0], stir: 0, down: [0, -1, 0], wake: true, on: false, ph: Math.random() * 6 }));
      st.on = np === 1;
      if (!st.on) continue;
      const F = frameOf(sb, pc.verts), ax = F.ax, v = pc.vel;
      const acc = st.vel ? [(v[0] - st.vel[0]) / dt, (v[1] - st.vel[1]) / dt, (v[2] - st.vel[2]) / dt] : [0, 0, 0];
      st.vel = [v[0], v[1], v[2]];
      const al = Math.hypot(acc[0], acc[1], acc[2]), ak = al > 400 ? 400 / al : 1;
      // (gravity less its acceleration, in its own space: the pull)
      const pw = [-acc[0] * ak, gy - acc[1] * ak, -acc[2] * ak];
      const pull = [0, 1, 2].map((i) => ax[i].x * pw[0] + ax[i].y * pw[1] + ax[i].z * pw[2]);
      const pl = Math.hypot(pull[0], pull[1], pull[2]) || 1, down = pull.map((c) => c / pl);
      // (turned since: the water lags it, turning the other way - and what's
      // settled slides off, the floor's not the floor any more)
      const w = [0, 1, 2].map((i) => ax[i].x * pc.omega[0] + ax[i].y * pc.omega[1] + ax[i].z * pc.omega[2]);
      const ks = Math.exp(-dt / SPIN_T);
      for (let i = 0; i < 3; i++) st.spin[i] = (st.spin[i] - 0.6 * (w[i] - st.w[i])) * ks;
      // (a water that spins no faster than a few turns a second: tumbled
      // end over end it was flung against the walls in a heap)
      const sl = Math.hypot(st.spin[0], st.spin[1], st.spin[2]);
      if (sl > 4) for (let i = 0; i < 3; i++) st.spin[i] *= 4 / sl;
      st.w = w;
      // (stirred by a shake, a knock, a turn - as against gravity, which a
      // re-cube turns off a while: 0/0, and the water's stir was NaN for good,
      // every flake set where it was - snow no more, just glitter)
      const shake = Math.max(0, (al * ak) / Math.max(4, Math.abs(gy)) - 0.25);
      st.stir = Math.min(2.5, st.stir * Math.exp(-dt / STIR_T) + dt * 0.9 * shake + 0.05 * Math.hypot(...st.spin) * dt);
      // (and anything not a number, however it came: the water calm again)
      if (!Number.isFinite(st.stir) || !st.spin.every(Number.isFinite)) {
        st.stir = 0;
        st.spin = [0, 0, 0];
        st.vel = null;
      }
      // (disturbed: stirred, spinning, or the way down's changed - what's
      // settled is lifted; else only what's still falling moves)
      st.stirred = st.stir > 0.03 || Math.hypot(...st.spin) > 0.2 || down[0] * st.down[0] + down[1] * st.down[1] + down[2] * st.down[2] < 0.996;
      if (st.stirred) st.wake = true;
      if (st.wake) st.down = down;
      st.pull = pull.map((c) => c * SINK);
      st.size = sb.cSize[slot];
      st.half = st.size / 2;
      st.b = sb.cBevel[slot];
      st.k = (2 * Math.PI * 0.9) / st.size;
      st.ph += dt * (0.4 + 0.6 * st.stir);
      if (st.wake) any = true;
    }
    if (!any) return;
    let moved = false;
    const n = this.count;
    for (let k = 0; k < n; k++) {
      if (MD[k] !== SNOW || S[k * 3] <= 0) continue;
      const slot = RK[k * 4 + 3], st = this.globes.get(slot);
      if (!st || !st.on || !st.wake || (this.lz[k] && !st.stirred)) continue;
      const k3 = k * 3;
      let x = this.lp[k3], y = this.lp[k3 + 1], z = this.lp[k3 + 2];
      let ux = this.lv[k3], uy = this.lv[k3 + 1], uz = this.lv[k3 + 2];
      if (!Number.isFinite(x + y + z + ux + uy + uz)) {
        x = RK[k * 4]; y = RK[k * 4 + 1]; z = RK[k * 4 + 2];
        ux = uy = uz = 0;
      }
      // the water here: turning, and stirred (Arnold-Beltrami-Childress
      // flow: eddies all through, nothing piling up anywhere)
      const sp = st.spin, kk = st.k, ph = st.ph, amp = st.stir * SWIRL * st.size;
      const fx = sp[1] * z - sp[2] * y + amp * (Math.sin(kk * z + ph) + Math.cos(kk * y + 1.3 * ph));
      const fy = sp[2] * x - sp[0] * z + amp * (Math.sin(kk * x + 0.7 * ph) + Math.cos(kk * z + ph));
      const fz = sp[0] * y - sp[1] * x + amp * (Math.sin(kk * y + 1.3 * ph) + Math.cos(kk * x + 0.7 * ph));
      // (each flake its own - big ones sink faster - and a drift of its own
      // while it's floating, so they don't all go the same way: a snowfall,
      // not a sheet)
      const own = 0.55 + 0.9 * this.seed[k3 + 2], free = this.lz[k] ? 0 : 0.035 * st.size;
      const id = 1 / (1 + dt / DRAG_T);
      ux = (ux + dt * ((fx + free * Math.sin(time * 1.7 + k)) / DRAG_T + st.pull[0] * own)) * id;
      uy = (uy + dt * ((fy + free * Math.sin(time * 1.3 + k * 1.7)) / DRAG_T + st.pull[1] * own)) * id;
      uz = (uz + dt * ((fz + free * Math.cos(time * 1.1 + k * 0.7)) / DRAG_T + st.pull[2] * own)) * id;
      x += ux * dt; y += uy * dt; z += uz * dt;
      // the walls: inside the rounded box, a flake's width in
      const m = Math.min(0.03, st.half * 0.06), core = st.half - Math.max(st.b, m), rad = Math.max(0, st.b - m);
      const cx = Math.max(-core, Math.min(core, x)), cy = Math.max(-core, Math.min(core, y)), cz = Math.max(-core, Math.min(core, z));
      const dx = x - cx, dy = y - cy, dz = z - cz, d = Math.hypot(dx, dy, dz);
      let wall = false;
      if (d > rad) {
        const f = rad / d, nx = dx / d, ny = dy / d, nz = dz / d;
        x = cx + dx * f; y = cy + dy * f; z = cz + dz * f;
        const un = ux * nx + uy * ny + uz * nz;
        if (un > 0) { ux -= un * nx; uy -= un * ny; uz -= un * nz; }
        // (lying on it - pulled into it - it stays put till the water's
        // moving fast enough to lift it; else slides, slowing)
        const into = st.pull[0] * nx + st.pull[1] * ny + st.pull[2] * nz, ut = Math.hypot(ux, uy, uz);
        if (into > 0 && ut < 0.14 * st.size) ux = uy = uz = 0;
        else { ux *= 0.85; uy *= 0.85; uz *= 0.85; }
        wall = true;
      }
      const sp2 = ux * ux + uy * uy + uz * uz;
      this.lv[k3] = ux; this.lv[k3 + 1] = uy; this.lv[k3 + 2] = uz;
      this.lp[k3] = x; this.lp[k3 + 1] = y; this.lp[k3 + 2] = z;
      // (tumbling as it goes)
      let nx = this.ln[k3], ny = this.ln[k3 + 1], nz = this.ln[k3 + 2];
      const ang = Math.sqrt(sp2) * dt * (14 / st.size), wx = this.lw[k3], wy = this.lw[k3 + 1], wz = this.lw[k3 + 2];
      if (ang > 1e-5) {
        nx += (wy * nz - wz * ny) * ang; ny += (wz * this.ln[k3] - wx * nz) * ang; nz += (wx * this.ln[k3 + 1] - wy * this.ln[k3]) * ang;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        this.ln[k3] = nx; this.ln[k3 + 1] = ny; this.ln[k3 + 2] = nz;
      }
      // found in the mesh: still in its tet (most frames), else looked up
      const RX = x + slot * REST_STEP;
      let t = -1, b0, b1, b2, b3;
      const t0 = this.lt?.[k] ?? -1;
      if (t0 >= 0 && t0 < sb.nT) {
        const a = T[t0 * 4] * 3, bo = t0 * 9, rx = RX - X[a], ry = y - X[a + 1], rz = z - X[a + 2];
        b1 = B[bo] * rx + B[bo + 1] * ry + B[bo + 2] * rz;
        b2 = B[bo + 3] * rx + B[bo + 4] * ry + B[bo + 5] * rz;
        b3 = B[bo + 6] * rx + B[bo + 7] * ry + B[bo + 8] * rz;
        b0 = 1 - b1 - b2 - b3;
        if (b0 >= -1e-6 && b1 >= -1e-6 && b2 >= -1e-6 && b3 >= -1e-6) t = t0;
      }
      if (t < 0) {
        const r = sb.locateRestFast(RX, y, z, out);
        if (r) { t = r.tet; b0 = r.b0; b1 = r.b1; b2 = r.b2; b3 = r.b3; }
      }
      if (t >= 0) {
        (this.lt || (this.lt = new Int32Array(MAX).fill(-1)))[k] = t;
        const a = T[t * 4], b = T[t * 4 + 1], c = T[t * 4 + 2], e = T[t * 4 + 3], a3 = a * 3;
        A[k * 4] = a; A[k * 4 + 1] = b; A[k * 4 + 2] = c; A[k * 4 + 3] = e;
        Ba[k * 4] = b0; Ba[k * 4 + 1] = b1; Ba[k * 4 + 2] = b2; Ba[k * 4 + 3] = b3;
        const dot = (q) => (X[q * 3] - X[a3]) * nx + (X[q * 3 + 1] - X[a3 + 1]) * ny + (X[q * 3 + 2] - X[a3 + 2]) * nz;
        M[k3] = dot(b); M[k3 + 1] = dot(c); M[k3 + 2] = dot(e);
        I[k * 2] = y;
        I[k * 2 + 1] = sb.tPiece[t];
        RK[k * 4] = x; RK[k * 4 + 1] = y; RK[k * 4 + 2] = z;
        moved = true;
      }
      // (settled: on the floor, still, the water calm)
      this.lz[k] = wall && sp2 < 1e-4 && st.stir < 0.03 ? 1 : 0;
    }
    if (moved) for (const at of [this.aTet, this.aBary, this.aM, this.aInfo, this.aRestK]) at.needsUpdate = true;
    this.looseMoved = moved;
    // (a globe gone quiet: every flake of it settled)
    for (const [slot, st] of this.globes) {
      if (!st.wake || !st.on) continue;
      let busy = false;
      for (let k = 0; k < n && !busy; k++) if (MD[k] === SNOW && RK[k * 4 + 3] === slot && S[k * 3] > 0 && !this.lz[k]) busy = true;
      if (!busy) st.wake = false;
    }
  }

  // The snow globes' flakes, a step of their own (App.frame: every tick, drawn or not - see App._drawNow)
  tick(time) {
    const on = this.groups.length > 0 && this.count > 0, app = this.app;
    const dt = this._lt < 0 ? 0 : Math.min(0.05, time - this._lt);
    this._lt = time;
    this.looseMoved = false;
    if (!on || !this.anySnow || !(dt > 0) || app.paused) return;
    const sb = app.sb;
    if (sb.topoVersion !== this.topo || this.anchoredFor !== this._key()) this._anchor();
    this._loose(dt * (app.timeScale ?? 1), time);
  }

  update(time) {
    const on = this.groups.length > 0 && this.count > 0;
    this.meshCube.visible = on && this.anyFlat && this.anyCubic;
    this.mesh.visible = on;
    if (!on) return;
    const app = this.app;
    const sb = app.sb;
    if (sb.topoVersion !== this.topo || this.anchoredFor !== this._key()) this._anchor();
    // simulated vertex positions -> texture: when they've moved (the jelly's own count of that), not every
    // frame - a still cube's every vertex copied and sent up again, sixty times a second
    const H0 = this.posTex?.image.height;
    this._allocPosTex(sb.nV);
    const pv = app.jelly.posVersion;
    if (pv !== this._posV || sb.nV !== this._posN || this.posTex.image.height !== H0) {
      this._posV = pv;
      this._posN = sb.nV;
      const P = this.posData, x = sb.x;
      for (let i = 0, n = sb.nV; i < n; i++) {
        P[i * 4] = x[i * 3];
        P[i * 4 + 1] = x[i * 3 + 1];
        P[i * 4 + 2] = x[i * 3 + 2];
      }
      this.posTex.needsUpdate = true;
    }
    const U = this.uniforms;
    U.uPosW.value = this.posW;
    // (every piece's: in a texture, not a uniform array - that held 24, and
    // a cube diced into 27 had three pieces whose glitter was seen through
    // all the way from the camera, as if it were all jelly: black)
    const W0 = this.bbTex?.image.width;
    this._allocBBTex(sb.pieces.length);
    const BB = this.bbData, W = this.bbTex.image.width;
    let bs = sb.pieces.length + W * 0.5;
    for (let k = 0; k < sb.pieces.length; k++) {
      const bb = sb.pieces[k].bbox;
      BB[k * 4] = bb[0]; BB[k * 4 + 1] = bb[1]; BB[k * 4 + 2] = bb[2];
      BB[(W + k) * 4] = bb[3]; BB[(W + k) * 4 + 1] = bb[4]; BB[(W + k) * 4 + 2] = bb[5];
      bs += (bb[0] + bb[1] * 1.3 + bb[2] * 1.7 + bb[3] * 2.1 + bb[4] * 2.3 + bb[5] * 2.9) * (1 + (k & 7) * 0.37);
    }
    if (bs !== this._bbSig || W !== W0) {
      this._bbSig = bs;
      this.bbTex.needsUpdate = true;
    }
    U.uTime.value = time;
    const cam = app.camera;
    U.uPxScale.value = app.size.ph / (2 * Math.tan((cam.fov * Math.PI) / 360));
    U.uMinPx.value = 1.5 * Math.max(1, app.pixelRatio * 0.9);
    U.uSize.value = 0.0072 * this.size * sb.p.size * (this.mode === 'cubic' ? 1.3 : 1);
  }
}
