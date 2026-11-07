import * as THREE from 'three';
import { CUBE_GLSL } from '../render/jellyMaterials.js';
import { roundBoxSDF } from '../sim/mesh.js';
import { REST_STEP } from '../sim/softbody.js';

const MAX = 9000;
const MAXBB = 24;
export const GLITTER_MODES = { off: -1, silver: 0, gold: 1, holo: 2, rose: 3, cubic: 4 };

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
    const F = app.jelly.frontMat.uniforms;
    this.uniforms = {
      uCubeTex: { value: app.jelly.cubeTex },
      uGradTex: { value: app.jelly.gradTex },
      uFreeTex: { value: app.jelly.freeTex },
      uPos: { value: this.posTex },
      uPosW: { value: this.posW },
      uSize: { value: 0.0055 },
      uPxScale: { value: 800 },
      uMinPx: { value: 1.6 },
      uBBMin: { value: Array.from({ length: MAXBB }, () => new THREE.Vector3()) },
      uBBMax: { value: Array.from({ length: MAXBB }, () => new THREE.Vector3()) },
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
        #define MAXBB ${MAXBB}
        uniform sampler2D uPos;
        uniform int uPosW;
        uniform float uSize;
        uniform float uPxScale;
        uniform float uMinPx;
        uniform vec3 uBBMin[MAXBB];
        uniform vec3 uBBMax[MAXBB];
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
          bool other = aMode < 3.5;
          #else
          bool other = aMode > 3.5;
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
          if (pi < MAXBB) {
            vec3 dd = vec3(abs(d.x) < 1e-6 ? 1e-6 : d.x, abs(d.y) < 1e-6 ? 1e-6 : d.y, abs(d.z) < 1e-6 ? 1e-6 : d.z);
            vec3 ta = (uBBMin[pi] - o) / dd, tb = (uBBMax[pi] - o) / dd;
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
          vec3 c = col * (env + uLightColor * glint * 14.0) * uSparkle * rim + col * 0.03;
          gl_FragColor = vec4(min(c * vTint * vBoost, vec3(64.0)), 1.0);
        }`,
    });
    this.mat = mat;
    this.matCube = mat.clone();
    this.matCube.uniforms = this.uniforms;
    this.matCube.defines = { CUBE: '' };
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
    this.anyFlat = this.groups.some((g) => g.mode !== 4);
    this.mesh.geometry = this.anyFlat ? this.geo : this.geoCube;
    this.mesh.material = this.anyFlat ? this.mat : this.matCube;
    this.meshCube.visible = false;
  }

  _key() {
    const sb = this.app.sb;
    return `${this.count}|${this.groups.map((g) => g.slot + ':' + g.mode + ':' + sb.cSize[g.slot].toFixed(4)).join(',')}`;
  }

  // (Re)anchor flakes at their rest positions in the current mesh.
  _anchor() {
    const sb = this.app.sb;
    const X = sb.X, T = sb.T;
    const out = { tet: -1, b0: 0, b1: 0, b2: 0, b3: 0 };
    const n = this.count, G = this.groups.length ? this.groups : [{ slot: 0, mode: 0 }];
    for (let k = 0; k < n; k++) {
      // (shared out among the glittery cubes, each in its own rest space)
      const grp = G[k % G.length];
      // (each cube its own size)
      const half = sb.cSize[grp.slot] / 2, m = Math.min(0.03, half * 0.06);
      const px = this.u[k * 3] * (half - m), py = this.u[k * 3 + 1] * (half - m), pz = this.u[k * 3 + 2] * (half - m);
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
      this.aSeed.array[k * 3] = this.seed[k * 3];
      this.aSeed.array[k * 3 + 1] = this.seed[k * 3 + 1];
      this.aSeed.array[k * 3 + 2] = this.seed[k * 3 + 2];
      this.aInfo.array[k * 2] = py;
      this.aInfo.array[k * 2 + 1] = sb.tPiece[t];
      this.aRestK.array.set([px, py, pz, grp.slot], k * 4);
    }
    for (const at of [this.aTet, this.aBary, this.aM, this.aSeed, this.aInfo, this.aMode, this.aRestK]) at.needsUpdate = true;
    this.geo.instanceCount = n;
    this.geoCube.instanceCount = n;
    this.topo = sb.topoVersion;
    this.anchoredFor = this._key();
  }

  update(time) {
    const on = this.groups.length > 0 && this.count > 0;
    this.meshCube.visible = on && this.anyFlat && this.anyCubic;
    this.mesh.visible = on;
    if (!on) return;
    const app = this.app;
    const sb = app.sb;
    if (sb.topoVersion !== this.topo || this.anchoredFor !== this._key()) this._anchor();
    // simulated vertex positions -> texture
    this._allocPosTex(sb.nV);
    const P = this.posData, x = sb.x;
    for (let i = 0, n = sb.nV; i < n; i++) {
      P[i * 4] = x[i * 3];
      P[i * 4 + 1] = x[i * 3 + 1];
      P[i * 4 + 2] = x[i * 3 + 2];
    }
    this.posTex.needsUpdate = true;
    const U = this.uniforms;
    U.uPosW.value = this.posW;
    for (let k = 0; k < Math.min(MAXBB, sb.pieces.length); k++) {
      const bb = sb.pieces[k].bbox;
      U.uBBMin.value[k].set(bb[0], bb[1], bb[2]);
      U.uBBMax.value[k].set(bb[3], bb[4], bb[5]);
    }
    U.uTime.value = time;
    const cam = app.camera;
    U.uPxScale.value = app.size.ph / (2 * Math.tan((cam.fov * Math.PI) / 360));
    U.uMinPx.value = 1.5 * Math.max(1, app.pixelRatio * 0.9);
    U.uSize.value = 0.0072 * this.size * sb.p.size * (this.mode === 'cubic' ? 1.3 : 1);
  }
}
