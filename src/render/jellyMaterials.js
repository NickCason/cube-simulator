import * as THREE from 'three';
import { FREE_N } from '../freeform.js';
import { FLOOR_PATTERN_GLSL } from './floorpattern.js';
import { SURF_GLSL } from '../surfaces.js';

const NOISE = /* glsl */ `
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash13(i), n100 = hash13(i + vec3(1,0,0)), n010 = hash13(i + vec3(0,1,0)), n110 = hash13(i + vec3(1,1,0));
    float n001 = hash13(i + vec3(0,0,1)), n101 = hash13(i + vec3(1,0,1)), n011 = hash13(i + vec3(0,1,1)), n111 = hash13(i + vec3(1,1,1));
    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
  }
  // cellular noise: (distance to nearest feature point, that cell's random id)
  vec2 worley(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    float d = 8.0, id = 0.0;
    for (int x = -1; x <= 1; x++)
      for (int y = -1; y <= 1; y++)
        for (int z = -1; z <= 1; z++) {
          vec3 g = vec3(float(x), float(y), float(z));
          vec3 c = i + g;
          vec3 o = vec3(hash13(c), hash13(c + 19.1), hash13(c + 47.7)) * 0.8 + 0.1;
          vec3 r = g + o - f;
          float dd = dot(r, r);
          if (dd < d) { d = dd; id = hash13(c + 3.3); }
        }
    return vec2(sqrt(d), id);
  }
  float fbm3(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
  }
`;

// Octahedral normal packing (frees a channel in the back-face target).
const OCT = /* glsl */ `
  vec2 octEncode(vec3 n) {
    n /= (abs(n.x) + abs(n.y) + abs(n.z));
    vec2 s = vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
    return n.z >= 0.0 ? n.xy : (1.0 - abs(n.yx)) * s;
  }
  vec3 octDecode(vec2 e) {
    vec3 n = vec3(e, 1.0 - abs(e.x) - abs(e.y));
    if (n.z < 0.0) {
      vec2 s = vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
      n.xy = (1.0 - abs(n.yx)) * s;
    }
    return normalize(n);
  }
`;

// Layered flavours: absorption/scatter vary with rest height. Up to 10
// layers; uLayerBlur widens the blend between neighbours from a crisp seam
// (0) to a smooth gradient between layer centres (1). A ray crossing several
// layers averages the profile over the heights it spans.
export const MAX_LAYERS = 10;
export const MAX_CAVITIES = 12;
// each cube's gradient strip: this many steps along it, two rows a cube
export const GRAD_N = 512;
export const GRAD_ROWS = 16;
// (and a freeform one's grid of colours: a slab of FREE_N a cube, this many)
export const FREE_SLABS = GRAD_ROWS / 2;
export const MAX_PULSES = 6;
export const LAYER_GLSL = /* glsl */ `
  uniform int uLayers;
  uniform float uLayerY0;
  uniform float uLayerSpan;
  uniform float uLayerRep;
  uniform float uLayerExp;
  uniform float uLayerBlur;
  uniform vec3 uLayerAbs[10];
  uniform vec3 uLayerSc[10];
  // neighbouring layers around height y and the blend between them: the
  // height (0..1 up the cube) crowded by the bias, the colours cycling
  // uLayerRep times over it
  void layerPair(float y, out int a, out int b, out float s) {
    float n = float(uLayers), m = n * uLayerRep;
    float h = pow(max(clamp((y - uLayerY0) / uLayerSpan, 0.0, 1.0), 1e-6), uLayerExp);
    float f = h * m - 0.5;
    float i0 = floor(f);
    float w = max(uLayerBlur * 0.5, 0.012);
    s = smoothstep(0.5 - w, 0.5 + w, f - i0);
    // (past the bottom and top bands: their own colour)
    a = int(mod(clamp(i0, 0.0, m - 1.0), n));
    b = int(mod(clamp(i0 + 1.0, 0.0, m - 1.0), n));
  }
  vec3 sigmaAt(float y) {
    int a, b; float s;
    layerPair(y, a, b, s);
    return mix(uLayerAbs[a], uLayerAbs[b], s);
  }
  vec3 layerSigma(float ya, float yb, vec3 uniformSigma) {
    if (uLayers == 0) return uniformSigma;
    if (abs(yb - ya) < 1e-3) return sigmaAt(ya);
    vec3 acc = vec3(0.0);
    for (int k = 0; k < 16; k++) acc += sigmaAt(mix(ya, yb, (float(k) + 0.5) / 16.0));
    return acc * 0.0625;
  }
  vec3 layerScatter(float y, vec3 uniformColor) {
    if (uLayers == 0) return uniformColor;
    int a, b; float s;
    layerPair(y, a, b, s);
    return mix(uLayerSc[a], uLayerSc[b], s);
  }
`;

// Each cube's own look (several cubes: see JellyView.setCubeLook), a row of
// uCubeTex per cube: its colour, haze, glow, gloss, refraction, sugar, milk,
// finishes, its layers, the colour it gives the light through it. useCube(k)
// picks the row (the front shader reads its own way, all at once).
export const CUBE_GLSL = /* glsl */ `
  uniform highp sampler2D uCubeTex;
  uniform highp sampler2D uGradTex;
  uniform highp sampler3D uFreeTex;
  int gK = 0;
  int cLayers = 0; // (-1: Rubik)
  int cShape = 0; // (its gradient's: up, across, corner, core, shell, rings, free - styles.js GRAD_SHAPES)
  float cFreeK = 1.0; // (free: its colours' depth - absorption = -log(colour) x this)
  float cTiles = 1.0; // (subdivided: little cubes a side, each with the whole gradient)
  float cLY0 = 0.0, cLSpan = 1.0, cLRep = 1.0, cLExp = 1.0, cLBlur = 0.0, cRubikSeed = 0.0;
  vec4 cubeT(int x) { return texelFetch(uCubeTex, ivec2(x, gK), 0); }
  void useCube(float k) {
    gK = int(k + 0.5);
    vec4 q4 = cubeT(4), q5 = cubeT(5);
    cLayers = int(floor(q4.y + 0.5));
    cLY0 = q4.z; cLSpan = q4.w; cLRep = q5.x; cLExp = q5.y; cLBlur = q5.z; cRubikSeed = q5.w;
    cShape = int(cubeT(6).w + 0.5);
    vec4 q28 = cLayers > 0 ? cubeT(28) : vec4(1.0);
    cFreeK = q28.x;
    cTiles = max(q28.y, 1.0);
  }
  // Rubik: the colour (0..5) at rest point p - each face a 3x3 of stickers
  // run in to the middle, centres their own face's colour, the rest
  // scrambled by the seed (the same hash as styles.js rubikIndex);
  // cRubikSeam: how near a seam between stickers, 0..1
  const int RUBIK_FACE[6] = int[6](2, 3, 0, 1, 5, 4);
  float cRubikSeam = 0.0;
  int rubikAt(vec3 p) {
    vec3 a = abs(p);
    int face; vec2 uv;
    if (a.x >= a.y && a.x >= a.z) { face = p.x > 0.0 ? 0 : 1; uv = p.zy; }
    else if (a.y >= a.z) { face = p.y > 0.0 ? 2 : 3; uv = p.xz; }
    else { face = p.z > 0.0 ? 4 : 5; uv = p.xy; }
    vec2 g = (uv / cLSpan + 0.5) * 3.0;
    vec2 d = min(abs(g - 1.0), abs(g - 2.0));
    cRubikSeam = 1.0 - smoothstep(0.035, 0.075, min(d.x, d.y));
    ivec2 ij = ivec2(clamp(floor(g), 0.0, 2.0));
    int cell = ij.x * 3 + ij.y;
    if (cRubikSeed < 0.5 || cell == 4) return RUBIK_FACE[face];
    uint h = uint(cRubikSeed + 0.5) * 747796405u + uint(face * 9 + cell) * 2891336453u;
    h ^= h >> 16u; h *= 2246822519u; h ^= h >> 13u; h *= 3266489917u; h ^= h >> 16u;
    return int(h % 6u);
  }
  // Its gradient (layered): a rest point's place along its shape, 0..1 (as
  // styles.js gradT); its absorption there (row 0) or the colour of the light
  // scattered inside (row 1), off its strip (worked out from the stops: see
  // JellyView.setCubeLook); the absorption averaged along a stretch of it
  float cGradT(vec3 p) {
    float h = 0.5 * cLSpan;
    if (cShape == 1) return p.x / cLSpan + 0.5;
    if (cShape == 2) return (p.x + p.y + p.z) / (3.0 * cLSpan) + 0.5;
    if (cShape == 3 || cShape == 4) {
      // (radial, cubial: round the middle of the face it's nearest - in
      // its two ways across that face - rings or squares on every face)
      vec3 a = abs(p);
      vec2 w = a.x >= a.y && a.x >= a.z ? p.yz : a.y >= a.z ? p.xz : p.xy;
      return (cShape == 3 ? length(w) : max(abs(w.x), abs(w.y))) / h;
    }
    if (cShape == 5) return length(p.xz) / h;
    return (p.y - cLY0) / cLSpan;
  }
  // (free: off its grid of colours - each cube a slab of the texture - into
  // absorption or the colour inside, as setCubeLook works them from a colour)
  vec3 cFreeAt(vec3 p) {
    vec3 q = clamp(p / cLSpan + 0.5, ${0.5 / FREE_N}, ${1 - 0.5 / FREE_N});
    return textureLod(uFreeTex, vec3(q.xy, (float(gK) + q.z) / ${FREE_SLABS}.0), 0.0).rgb;
  }
  // (subdivided: the little cube it's in, as though it were the whole one -
  // held off the very skin, or the skin's own little cube flips to its far
  // side)
  vec3 cTile(vec3 p) {
    if (cTiles < 1.5) return p;
    vec3 q = clamp(p / cLSpan + 0.5, 0.0005, 0.9995);
    return (fract(q * cTiles) - 0.5) * cLSpan;
  }
  vec3 cGradAt(vec3 p, int row) {
    p = cTile(p);
    if (cShape == 6) {
      vec3 c = cFreeAt(p);
      return row == 0 ? -log(clamp(c, 0.004, 0.995)) * cFreeK : c / max(max(c.r, c.g), max(c.b, 1e-3));
    }
    float t = clamp(cGradT(p), 0.0, 1.0);
    return textureLod(uGradTex, vec2((t * ${GRAD_N - 1}.0 + 0.5) / ${GRAD_N}.0, (float(gK * 2 + row) + 0.5) / ${GRAD_ROWS}.0), 0.0).rgb;
  }
  // both at once: its absorption (a) and the colour of its light scattered (s)
  void cGradBoth(vec3 p, out vec3 a, out vec3 s) {
    p = cTile(p);
    if (cShape == 6) {
      vec3 c = cFreeAt(p);
      a = -log(clamp(c, 0.004, 0.995)) * cFreeK;
      s = c / max(max(c.r, c.g), max(c.b, 1e-3));
      return;
    }
    float u = (clamp(cGradT(p), 0.0, 1.0) * ${GRAD_N - 1}.0 + 0.5) / ${GRAD_N}.0;
    a = textureLod(uGradTex, vec2(u, (float(gK * 2) + 0.5) / ${GRAD_ROWS}.0), 0.0).rgb;
    s = textureLod(uGradTex, vec2(u, (float(gK * 2 + 1) + 0.5) / ${GRAD_ROWS}.0), 0.0).rgb;
  }
  vec3 cGradPath(vec3 a, vec3 b, vec3 base) {
    if (cLayers <= 0) return base;
    if (dot(b - a, b - a) < 1e-6) return cGradAt(a, 0);
    vec3 acc = vec3(0.0);
    for (int k = 0; k < 16; k++) acc += cGradAt(mix(a, b, (float(k) + 0.5) / 16.0), 0);
    return acc * 0.0625;
  }
  // the colour of its light scattered inside, at rest point p (by its
  // gradient, or Rubik's sticker)
  vec3 cScatterAt(vec3 p, vec3 base) {
    if (cLayers < 0) return cubeT(17 + rubikAt(p)).rgb;
    if (cLayers == 0) return base;
    return cGradAt(p, 1);
  }
`;

// 1x1 float texture for samplers with nothing to show yet
function emptyFloatTexture() {
  const t = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// NaN-proofing for the shaders that write buffers others sample (mipmapped,
// some of them: one NaN texel spreads into a black block): normalize that
// leaves a zero vector zero, and a scrub that replaces non-finite values.
const SAFE_GLSL = /* glsl */ `
  vec3 safeNormalize(vec3 v) { return v * inversesqrt(max(dot(v, v), 1e-24)); }
  vec4 finite4(vec4 c) {
    bvec4 bad = equal(floatBitsToUint(c) & uvec4(0x7f800000u), uvec4(0x7f800000u));
    return any(bad) ? vec4(0.0) : c;
  }
`;

export function createLayerUniforms() {
  return {
    uLayers: { value: 0 },
    uLayerY0: { value: -0.5 },
    uLayerSpan: { value: 1 },
    uLayerRep: { value: 1 },
    uLayerExp: { value: 1 },
    uLayerBlur: { value: 0 },
    uLayerAbs: { value: Array.from({ length: MAX_LAYERS }, () => new THREE.Vector3()) },
    uLayerSc: { value: Array.from({ length: MAX_LAYERS }, () => new THREE.Vector3()) },
  };
}

const VERT = /* glsl */ `
  attribute vec3 aRest;
  attribute vec4 aData;
  attribute vec4 aCoat;
  attribute float aCoatM;
  attribute float aWeld;
  attribute float aCube;
  varying vec4 vCoat;
  varying float vCoatM;
  varying float vCube;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vViewPos;
  varying vec3 vRest;
  varying vec4 vData;
  varying float vWeld;
  void main() {
    vWeld = aWeld;
    vCube = aCube;
    vCoat = aCoat;
    vCoatM = aCoatM;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormal = mat3(modelMatrix) * normal;
    vNormal *= inversesqrt(max(dot(vNormal, vNormal), 1e-24));
    vec4 mv = viewMatrix * wp;
    vViewPos = mv.xyz;
    vRest = aRest;
    vData = aData;
    gl_Position = projectionMatrix * mv;
  }
`;

// Back faces: linear view depth, packed view-space exit normal, and what
// the line of sight leaves through - the coat on the outside there (sugar
// crystals, a dusting, flour it's picked up) or frost: 0 for bare jelly. (A
// gradient up its height takes its rest height there instead, unless the
// whole rest point goes in the second target.)
export function createBackMaterial(rest = false) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uCubeTex: { value: emptyFloatTexture() } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform highp sampler2D uCubeTex;
      varying float vCube;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec3 vViewPos;
      varying vec3 vRest;
      varying vec4 vData;
      ${OCT}
      ${SAFE_GLSL}
      ${rest ? 'layout(location = 1) out highp vec4 oRest;' : ''}
      void main() {
        vec3 vn = safeNormalize((viewMatrix * vec4(safeNormalize(vNormal), 0.0)).xyz);
        int k = int(vCube + 0.5);
        vec4 q3 = texelFetch(uCubeTex, ivec2(3, k), 0), q29 = texelFetch(uCubeTex, ivec2(29, k), 0);
        float fresh = vData.z;
        float coat = max(max(q3.x * (1.0 - fresh * (1.0 - q29.z)), q29.x * (1.0 - fresh)), vData.w);
        coat = max(coat, 0.8 * smoothstep(0.05, 0.7, -vData.x));
        ${rest ? 'float a = coat;' : 'float a = texelFetch(uCubeTex, ivec2(4, k), 0).y > 0.5 ? vRest.y : coat;'}
        gl_FragColor = finite4(vec4(-vViewPos.z, octEncode(vn), a));
        // (rest: and the whole rest point there, into a second target - for
        // a gradient across, corner to corner or out from the middle, the
        // way through from where it went in to here)
        ${rest ? 'oRest = finite4(vec4(vRest, 1.0));' : ''}
      }`,
  });
}

export function createJellyMaterial(env, layerUniforms) {
  return new THREE.ShaderMaterial({
    side: THREE.FrontSide,
    uniforms: {
      ...layerUniforms,
      uSugar: { value: 0 },
      uMilk: { value: 0 },
      uIrid: { value: 0 },
      uCubeTex: { value: emptyFloatTexture() },
      uMetal: { value: 0 },
      uOpal: { value: 0 },
      uMetalCeil: { value: new THREE.Color(0, 0, 0) }, // (the studio's overhead softbox, for metal to mirror: see the metal shading)
      uGlow: { value: 0.5 },
      uHazeMin: { value: 0 },
      tScene: { value: null },
      tBack: { value: null },
      tBackRest: { value: null }, // (where the line of sight leaves: its rest point - see createBackMaterial)
      uBackRest: { value: 0 }, // (whether that's there: else only its height is)
      uGradTex: { value: null },
      uFreeTex: { value: null },
      envMap: { value: env.texture },
      envMaxLod: { value: env.maxLod },
      envIntensity: { value: 1.0 },
      resolution: { value: new THREE.Vector2(1, 1) },
      uAbsorb: { value: new THREE.Vector3(0.2, 2.4, 2.0) },
      uScatterColor: { value: new THREE.Color(1, 0.3, 0.3) },
      uScatter: { value: 0.35 },
      uIor: { value: 1.36 },
      uRoughness: { value: 0.035 },
      uDispersion: { value: 0.018 },
      uLightDir: { value: new THREE.Vector3(-0.45, 0.8, 0.4).normalize() },
      uLightColor: { value: new THREE.Color(1, 0.97, 0.92).multiplyScalar(3.2) },
      // (several cubes) the key light's view of them, for one cube's shadow
      // on another (see cubeShadowAt; set by JellyView.renderFloorFx)
      tLightEntry: { value: null },
      tLightExit: { value: null },
      uLightVP: { value: new THREE.Matrix4() },
      uLightOrigin: { value: new THREE.Vector3() },
      uCubeShadow: { value: 0 },
      uGlowColor: { value: new THREE.Color(1.0, 0.9, 0.72) },
      uTime: { value: 0 },
      uSceneLodMax: { value: 6 },
      uDebug: { value: 0 },
      uPLPos: { value: new THREE.Vector3(0, 2, 0) },
      uPLColor: { value: new THREE.Color(0, 0, 0) },
      uWeldT: { value: 99 },
      // the healed seams near by, for exact distances per pixel (see
      // weldFieldJob; set by JellyView): segment ends, per-cell segment lists
      uWeldSegs: { value: emptyFloatTexture() },
      uWeldCells: { value: emptyFloatTexture() },
      uWeldGrid: { value: new THREE.Vector4(0, 0, 0, 1) },
      uWeldGridN: { value: 0 },
      uWeldUnit: { value: 1 },
      // bubbles a cut has opened: centre and radius (world), see Bubbles
      uCav: { value: Array.from({ length: MAX_CAVITIES }, () => new THREE.Vector4()) },
      uCavN: { value: 0 },
      // glow mode: how brightly it shines, and rings of light from knocks
      // (world centre + start time; strength)
      uEmit: { value: 0 },
      uPulse: { value: Array.from({ length: MAX_PULSES }, () => new THREE.Vector4(0, 0, 0, -99)) },
      uPulseAmp: { value: new Array(MAX_PULSES).fill(0) },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform mat4 projectionMatrix;
      uniform sampler2D tScene;
      uniform sampler2D tBack;
      uniform sampler2D tBackRest;
      uniform float uBackRest;
      uniform samplerCube envMap;
      uniform float envMaxLod;
      uniform float envIntensity;
      uniform vec2 resolution;
      uniform vec3 uAbsorb;
      uniform vec3 uScatterColor;
      uniform float uScatter;
      uniform float uIor;
      uniform float uRoughness;
      uniform float uDispersion;
      uniform vec3 uLightDir;
      uniform vec3 uLightColor;
      uniform vec3 uGlowColor;
      uniform float uTime;
      uniform float uSceneLodMax;
      uniform int uDebug;
      uniform vec3 uPLPos;
      uniform vec3 uPLColor;
      uniform float uSugar;
      uniform float uMilk;
      uniform float uIrid;
      uniform float uMetal;
      uniform vec3 uMetalCeil;
      uniform float uOpal;
      uniform float uGlow;
      uniform float uHazeMin;
      uniform float uWeldT;
      uniform highp sampler2D uWeldSegs;
      uniform highp sampler2D uWeldCells;
      uniform vec4 uWeldGrid;
      uniform float uWeldGridN;
      uniform float uWeldUnit;
      uniform vec4 uCav[${MAX_CAVITIES}];
      uniform int uCavN;
      uniform float uEmit;
      // the floor, for what the jelly mirrors below the horizon (shared with
      // the floor's own shader - see JellyView.fxUniforms)
      uniform sampler2D tCaustic;
      uniform sampler2D tFloorFx;
      uniform sampler2D tGlowMap;
      uniform vec4 uFloorRect;
      uniform vec4 uGlowRect;
      uniform float uFxLodBias;
      uniform vec4 uCausRect;
      uniform float uCausGain;
      uniform vec3 uTint;
      uniform sampler2D tFloorTint;
      uniform float uGlowFloor;
      uniform vec3 uBg;
      uniform vec3 uFloorAlbedo;
      uniform float uFloorEnv;
      uniform vec4 uPulse[${MAX_PULSES}];
      uniform float uPulseAmp[${MAX_PULSES}];
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec3 vViewPos;
      varying vec3 vRest;
      varying vec4 vData;
      varying vec4 vCoat;
      varying float vCoatM;
      varying float vWeld;
      ${NOISE}
      ${OCT}
      ${LAYER_GLSL}

      ${CUBE_GLSL}
      ${FLOOR_PATTERN_GLSL}
      ${SURF_GLSL}
      varying float vCube;
      uniform sampler2D tLightEntry;
      uniform sampler2D tLightExit;
      uniform mat4 uLightVP;
      uniform vec3 uLightOrigin;
      uniform float uCubeShadow;
      ${LIGHT_VIEW_GLSL}
      // The key light at P, dimmed and coloured by another cube between it and
      // the light (the light's own view of them: the first surface it meets
      // there, whose it is, how much of it the light crosses) - soft-edged,
      // five taps. Its own cube's shading is its own business, as before.
      float gShadowOcc = 0.0; // (how much of it another cube shades: its sky too)
      vec3 cubeShadowAt(vec3 P) {
        if (uCubeShadow < 0.5) return vec3(1.0);
        vec4 lp = uLightVP * vec4(P, 1.0);
        vec2 uv = lp.xy / lp.w * 0.5 + 0.5;
        if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec3(1.0);
        vec2 ts = 1.5 / vec2(textureSize(tLightEntry, 0));
        vec3 Lw = normalize(uLightDir);
        float occ = 0.0;
        vec4 E0 = vec4(0.0);
        vec2 uv0 = uv;
        for (int k = 0; k < 5; k++) {
          vec2 o = k == 0 ? vec2(0.0) : k == 1 ? vec2(1.0, 0.0) : k == 2 ? vec2(-1.0, 0.0) : k == 3 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
          vec2 u = uv + o * ts;
          vec4 E = texture(tLightEntry, u);
          if (E.w < 0.5 || int(lightViewCube(E.w)) == gK) continue;
          if (dot(E.xyz + uLightOrigin - P, Lw) < 0.03) continue;
          occ += 0.2;
          if (E0.w < 0.5) { E0 = E; uv0 = u; }
        }
        if (occ <= 0.0) return vec3(1.0);
        gShadowOcc = occ;
        int kc = int(lightViewCube(E0.w));
        vec4 X = texture(tLightExit, uv0);
        float t = X.w > 0.5 && int(lightViewCube(X.w)) == kc ? length(X.xyz - E0.xyz) : 0.4;
        vec4 q0 = texelFetch(uCubeTex, ivec2(0, kc), 0);
        vec3 T = exp(-(q0.rgb + q0.a * 0.7) * min(t, 1.5)) * 0.85 + 0.03;
        return mix(vec3(1.0), T, occ);
      }

      float sq(float x) { return x * x; }
      // a pure spectral colour, hue 0..1
      vec3 spectrum(float h) {
        return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
      }
      // thin-film interference, roughly: the colour a film reflects, by its
      // phase - pink and magenta seen square on, through purple, blue and
      // cyan to green and gold as the angle grazes (t: film + the angle)
      // (a holographic palette, not a plain rainbow: pink, violet, sky blue,
      // cyan, butter yellow, peach and round to pink - no muddy green)
      vec3 filmColor(float t) {
        float u = fract(t) * 6.0;
        vec3 c0 = vec3(1.0, 0.32, 0.8), c1 = vec3(0.72, 0.34, 1.0), c2 = vec3(0.36, 0.6, 1.0);
        vec3 c3 = vec3(0.32, 0.94, 1.0), c4 = vec3(1.0, 0.93, 0.45), c5 = vec3(1.0, 0.58, 0.42);
        float f = smoothstep(0.0, 1.0, fract(u));
        if (u < 1.0) return mix(c0, c1, f);
        if (u < 2.0) return mix(c1, c2, f);
        if (u < 3.0) return mix(c2, c3, f);
        if (u < 4.0) return mix(c3, c4, f);
        if (u < 5.0) return mix(c4, c5, f);
        return mix(c5, c0, f);
      }
      // A NaN or infinity here would be smeared over the whole screen by the
      // bloom (a white or black flash): replace it, and keep within range.
      vec3 finite(vec3 c) {
        bvec3 bad = equal(floatBitsToUint(c) & uvec3(0x7f800000u), uvec3(0x7f800000u));
        return any(bad) ? vec3(0.0) : clamp(c, 0.0, 64.0);
      }
      // The healed seams: exact distance from p to the seam segments listed
      // for its cell (1e3 if none come near).
      float weldSeg(vec3 p, float s) {
        int j = int(s) * 2;
        vec3 a = texelFetch(uWeldSegs, ivec2(j % 1024, j / 1024), 0).xyz;
        vec3 b = texelFetch(uWeldSegs, ivec2((j + 1) % 1024, (j + 1) / 1024), 0).xyz;
        vec3 ab = b - a, ap = p - a;
        float h = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0);
        return length(ap - ab * h);
      }
      float weldNear(vec3 p) {
        int n = int(uWeldGridN);
        ivec3 c = ivec3(floor((p - uWeldGrid.xyz) * uWeldGrid.w));
        if (n < 1 || any(lessThan(c, ivec3(0))) || any(greaterThanEqual(c, ivec3(n)))) return 1e3;
        int id = ((c.x * n + c.y) * n + c.z) * 2;
        vec4 s0 = texelFetch(uWeldCells, ivec2(id % 1024, id / 1024), 0);
        vec4 s1 = texelFetch(uWeldCells, ivec2((id + 1) % 1024, (id + 1) / 1024), 0);
        float d = 1e3;
        if (s0.x >= 0.0) d = weldSeg(p, s0.x);
        if (s0.y >= 0.0) d = min(d, weldSeg(p, s0.y));
        if (s0.z >= 0.0) d = min(d, weldSeg(p, s0.z));
        if (s0.w >= 0.0) d = min(d, weldSeg(p, s0.w));
        if (s1.x >= 0.0) d = min(d, weldSeg(p, s1.x));
        if (s1.y >= 0.0) d = min(d, weldSeg(p, s1.y));
        if (s1.z >= 0.0) d = min(d, weldSeg(p, s1.z));
        if (s1.w >= 0.0) d = min(d, weldSeg(p, s1.w));
        return d;
      }

      // The floor at xz as the camera would see it, roughly: its colour lit
      // by the key light through the jelly's shadow and caustics and by the
      // room, its glow pool in glow mode, fading into the backdrop.
      vec3 floorAt(vec2 xz, float rough) {
        vec2 fuv = (xz - uFloorRect.xy) * uFloorRect.zw;
        float mask = 0.0, contact = 0.0;
        vec3 caus = vec3(0.0), glowF = vec3(0.0), tint = uTint;
        // (as blurred as it's rough - and as the patch of floor one pixel
        // takes in: round an edge, a wide one; the shadow's edge was a line)
        vec2 fwF = fwidth(fuv) * vec2(textureSize(tFloorFx, 0));
        float lod = max(1.0 + 4.0 * rough, log2(max(max(fwF.x, fwF.y), 1.0)));
        if (all(greaterThan(fuv, vec2(0.0))) && all(lessThan(fuv, vec2(1.0)))) {
          vec2 cuv = (xz - uCausRect.xy) * uCausRect.zw;
          if (all(greaterThan(cuv, vec2(0.0))) && all(lessThan(cuv, vec2(1.0)))) caus = textureLod(tCaustic, cuv, lod + 0.4).rgb;
          vec4 fx = textureLod(tFloorFx, fuv, lod + uFxLodBias);
          mask = fx.r;
          contact = fx.g;
          // (whose shadow: its colour - see JellyView.renderFloorFx)
          vec4 tm = textureLod(tFloorTint, fuv, max(lod + uFxLodBias - 1.0, 0.0));
          if (tm.a > 1e-3) tint = tm.rgb / tm.a;
        }
        vec2 guv = (xz - uGlowRect.xy) * uGlowRect.zw;
        if (uGlowFloor > 0.0 && all(greaterThan(guv, vec2(0.0))) && all(lessThan(guv, vec2(1.0))))
          glowF = textureLod(tGlowMap, guv, 1.5).rgb * 0.7 + textureLod(tGlowMap, guv, 3.5).rgb * 0.9;
        vec3 transfer = vec3(1.0 - mask) + caus * uCausGain + tint * mask * 0.22;
        vec3 direct = uLightColor * max(normalize(uLightDir).y, 0.0) * 0.3183 * transfer * (1.0 - contact * 0.2);
        vec3 sky = textureLod(envMap, vec3(0.0, 1.0, 0.0), envMaxLod).rgb * uFloorEnv
          * mix(vec3(1.0), tint * 1.1, mask * 0.68) * (1.0 - contact * 0.35);
        // (the place's floor: its pattern, and the grid's own light)
        vec3 patG;
        vec3 alb = floorPattern(xz, uFloorAlbedo, patG);
        vec3 c = alb * (direct + sky) + glowF * uGlowFloor + patG * uPatGlow;
        return mix(c, uBg, smoothstep(3.2, 11.0, length(xz)));
      }

      vec3 envLookup(vec3 dir, float rough) {
        float lod = envMaxLod * rough * (2.0 - rough);
        return textureLod(envMap, dir, lod).rgb * envIntensity;
      }
      float D_GGX(float NdH, float a) {
        float a2 = a * a;
        float d = NdH * NdH * (a2 - 1.0) + 1.0;
        return a2 / (3.14159265 * d * d);
      }
      float V_Smith(float NdL, float NdV, float a) {
        float a2 = a * a;
        float gl = NdV * sqrt(NdL * NdL * (1.0 - a2) + a2);
        float gv = NdL * sqrt(NdV * NdV * (1.0 - a2) + a2);
        return 0.5 / max(gl + gv, 1e-5);
      }
      vec2 toScreen(vec3 p) {
        vec4 c = projectionMatrix * viewMatrix * vec4(p, 1.0);
        return clamp(c.xy / c.w * 0.5 + 0.5, vec2(0.001), vec2(0.999));
      }
      // Two-interface refraction: enter through N, exit through Nb.
      // a sprinkle's or a glitter flake's colour (one of powders.js SPRINKLE)
      vec3 sprinkleCol(float h) {
        int i = int(floor(h * 7.0));
        vec3 c = i == 0 ? vec3(1.0, 0.31, 0.6) : i == 1 ? vec3(1.0, 0.83, 0.23) : i == 2 ? vec3(0.3, 0.67, 0.97) : i == 3 ? vec3(0.41, 0.86, 0.49)
          : i == 4 ? vec3(0.98, 0.98, 0.96) : i == 5 ? vec3(0.69, 0.59, 0.99) : vec3(1.0, 0.55, 0.2);
        return pow(c, vec3(2.2)); // (as they look: linear for the light)
      }
      // Sprinkles at q (a point in the plane of the surface, rest space):
      // in each cell (as many cells as dens says) a rod lying its own way,
      // its own colour - (colour, how much of here a rod covers, how near
      // its middle line). (Rods reach under half a cell from their middles:
      // the two nearest cells each way are all that can touch here.)
      vec4 sprinkles(vec2 p, float dens, out float ridge) {
        vec2 q = p * 30.0, c0 = floor(q - 0.5);
        float best = 9.0, id = 0.0;
        for (int i = 0; i < 2; i++)
          for (int j = 0; j < 2; j++) {
            vec2 c = c0 + vec2(float(i), float(j));
            vec3 c3 = vec3(c, 7.0);
            if (hash13(c3 * 1.31 + 0.7) > dens) continue;
            vec2 o = c + 0.2 + 0.6 * vec2(hash13(c3 + 11.1), hash13(c3 + 23.7));
            float an = hash13(c3 + 5.3) * 6.2832;
            vec2 dir = vec2(cos(an), sin(an)), d = q - o;
            float t = clamp(dot(d, dir), -0.3, 0.3);
            float dist = length(d - dir * t);
            if (dist < best) { best = dist; id = hash13(c3 + 3.3); }
          }
        ridge = 1.0 - clamp(best / 0.1, 0.0, 1.0);
        return vec4(sprinkleCol(id), 1.0 - smoothstep(0.075, 0.1, best));
      }
      // Glitter at q (in the plane of the surface): a little hexagonal flake
      // a cell (as many as dens says) - (its id, how much of here it covers)
      vec2 flakes(vec2 p, float dens) {
        vec2 q = p * 110.0, c0 = floor(q - 0.5);
        float best = 9.0, id = 0.0;
        for (int i = 0; i < 2; i++)
          for (int j = 0; j < 2; j++) {
            vec2 c = c0 + vec2(float(i), float(j));
            vec3 c3 = vec3(c, 3.0);
            if (hash13(c3 * 1.17 + 0.3) > dens) continue;
            vec2 d = abs(q - (c + 0.3 + 0.4 * vec2(hash13(c3 + 13.1), hash13(c3 + 29.7))));
            float dist = max(d.x * 0.866 + d.y * 0.5, d.y);
            if (dist < best) { best = dist; id = hash13(c3 + 4.4); }
          }
        return vec2(id, 1.0 - smoothstep(0.24, 0.3, best));
      }

      // (where the line of sight through lands on the room behind - the
      // middle channel's, as sampleThrough finds it: for how big a patch of
      // the room one pixel sees through it)
      vec2 throughUV(vec3 P, vec3 V, vec3 N, vec3 Nb, float thick, float ior) {
        vec3 r1 = refract(-V, N, 1.0 / ior);
        vec3 Pexit = P + r1 * thick;
        vec3 r2 = refract(r1, -Nb, ior);
        float D = 1.2;
        if (r2.y < -0.02) D = min(D, max(Pexit.y, 0.0) / -r2.y);
        return toScreen(Pexit + r2 * D);
      }

      vec3 sampleThrough(vec3 P, vec3 V, vec3 N, vec3 Nb, float thick, float ior, float lod, float rough, int ch) {
        vec3 r1 = refract(-V, N, 1.0 / ior);
        vec3 Pexit = P + r1 * thick;
        // refraction out of the back surface; fade into total internal reflection near the critical angle
        float c = dot(r1, Nb);
        float disc = 1.0 - ior * ior * (1.0 - c * c);
        float tirMix = smoothstep(0.0, 0.18, disc);
        vec3 refl = envLookup(reflect(r1, -Nb), min(rough + 0.15, 1.0)) * 0.85;
        if (tirMix <= 0.0) return refl;
        vec3 r2 = refract(r1, -Nb, ior);
        float D = 1.2;
        if (r2.y < -0.02) D = min(D, max(Pexit.y, 0.0) / -r2.y);
        vec2 uv = toScreen(Pexit + r2 * D);
        return mix(refl, textureLod(tScene, uv, lod).rgb, tirMix);
      }

      void main() {
        // (how the rest shape and the world run across this pixel - here,
        // where every pixel works them out: in a branch some skip they're
        // garbage)
        vec3 dRx = dFdx(vRest), dRy = dFdy(vRest), dPx = dFdx(vWorldPos), dPy = dFdy(vWorldPos);
        // (this cube's look)
        gK = int(vCube + 0.5);
        vec4 cq0 = cubeT(0), cq1 = cubeT(1), cq2 = cubeT(2), cq3 = cubeT(3), cq4 = cubeT(4), cq5 = cubeT(5), cq6 = cubeT(6);
        vec3 cAbsorb = cq0.rgb, cScatterColor = cq1.rgb, cGlowColor = cq6.rgb;
        float cScatter = cq0.a, cHazeMin = cq1.a, cGlow = cq2.x, cRough = cq2.y, cIor = cq2.z, cDisp = cq2.w;
        float cSugar = cq3.x, cMilk = cq3.y, cIrid = cq3.z, cMetal = cq3.w, cOpal = cq4.x;
        cLayers = int(floor(cq4.y + 0.5));
        cLY0 = cq4.z; cLSpan = cq4.w; cLRep = cq5.x; cLExp = cq5.y; cLBlur = cq5.z; cRubikSeed = cq5.w;
        cShape = int(cq6.w + 0.5);
        vec4 cq28 = cLayers > 0 ? cubeT(28) : vec4(1.0);
        cFreeK = cq28.x;
        cTiles = max(cq28.y, 1.0);
        float temp = vData.x;
        float glow = vData.y;
        float fresh = vData.z;
        // its coats and skins: a dusting (starch, icing sugar), a film or
        // foil that's only on the outside (a cut face is bare), sugar all
        // through (a sugar cube's cut is grainy too)
        vec4 cq29 = cubeT(29);
        float cDust = cq29.x, cSkin = cq29.y, cThrough = cq29.z;
        cIrid *= 1.0 - cSkin * fresh;
        cMetal *= 1.0 - cSkin * fresh;
        float frost = smoothstep(0.05, 0.7, -temp);
        float melt = smoothstep(0.3, 1.1, temp);

        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);

        // A bubble a cut has run through: here the surface is air, and what
        // shows is the far wall of the hollow - the line of sight carried on
        // to it (its rest position follows near enough unrotated).
        vec3 Pw = vWorldPos, Rp = vRest;
        float cavity = 0.0, cavDeep = 0.0;
        for (int k = 0; k < ${MAX_CAVITIES}; k++) {
          if (k >= uCavN) break;
          vec3 d = Pw - uCav[k].xyz;
          float r = uCav[k].w, dd = dot(d, d);
          if (dd < r * r) {
            float b = dot(-V, d);
            float s = -b + sqrt(max(b * b - dd + r * r, 0.0));
            vec3 Nf = N;
            Pw += -V * s;
            Rp += Pw - vWorldPos;
            N = normalize(uCav[k].xyz - Pw);
            V = normalize(cameraPosition - Pw);
            cavity = 1.0;
            cavDeep = clamp(dot(vWorldPos - Pw, Nf) / r, 0.0, 1.0);
            fresh = 0.0; // (a bubble's wall is smooth)
            break;
          }
        }

        // molded-surface irregularity (breaks perfect-glass reflections)
        if (cavity < 0.5) {
          vec3 q = vRest * 5.0;
          float e = 0.05;
          float n0 = vnoise(q) + 0.5 * vnoise(q * 2.1 + 7.0);
          vec3 g = vec3(vnoise(q + vec3(e, 0, 0)) + 0.5 * vnoise((q + vec3(e, 0, 0)) * 2.1 + 7.0) - n0,
                        vnoise(q + vec3(0, e, 0)) + 0.5 * vnoise((q + vec3(0, e, 0)) * 2.1 + 7.0) - n0,
                        vnoise(q + vec3(0, 0, e)) + 0.5 * vnoise((q + vec3(0, 0, e)) * 2.1 + 7.0) - n0) / e;
          N = normalize(N + (g - N * dot(g, N)) * 0.018);
        }
        // Its surface map (surfaces.js): a relief in its skin - pits, treads,
        // scales - bent into the normal by its slope here, worked out exactly
        // across this pixel (Mikkelsen's surface gradient: no tangents
        // needed), and faded out where it's finer than a few pixels (else it
        // sparkles). A face one is moulded on the outside (a cut is bare);
        // a through one (holes) is all through, cut faces too.
        float surfAO = 1.0, surfRough = 0.0;
        vec4 cq31 = cubeT(31);
        int sK = int(cq31.x + 0.5);
        if (sK > 0 && cavity < 0.5) {
          bool thru = sfThrough(sK);
          if (thru || fresh < 0.5) {
            vec4 cq28s = cubeT(28);
            float size = cq4.w;
            // (its cells across a face and up it: whole repeats, each face
            // starting where the next one ends - see surfaceFit)
            vec2 NN = cq31.zw;
            float cell = (thru ? size : size - cq28s.w * size * 0.4292037) / max(max(NN.x, NN.y), 0.25);
            // (a pixel's patch of it, in cells - its geometric mean: seen at a
            // glance, a long thin patch, and by its length the relief faded
            // out of a whole face)
            float fpc = 2.0 * sqrt(length(dRx) * length(dRy)) / cell;
            float fade = 1.0 - smoothstep(0.1, 0.4, fpc);
            // (it scatters the light a little besides - and what's too fine to
            // show as relief shows as that: far off, knurling looks satin)
            surfRough = cq28s.z + (1.0 - fade) * min(0.3, 2.0 * cq31.y / cell);
            if (fade > 0.0) {
              // (its height here and a pixel along each way, as the rest shape
              // runs across the screen: how much it rises across this pixel,
              // exactly, whatever the mapping - round a bevel too)
              float hs = 0.5 * size, b = cq28s.w * size, L = size - b * (2.0 - 1.5707963);
              float h0 = sfHeightAt(sK, thru, vRest, hs, b, L, NN);
              float dBs = (sfHeightAt(sK, thru, vRest + dRx, hs, b, L, NN) - h0) * cq31.y * fade;
              float dBt = (sfHeightAt(sK, thru, vRest + dRy, hs, b, L, NN) - h0) * cq31.y * fade;
              // (into the world: Mikkelsen's surface gradient)
              vec3 R1 = cross(dPy, N), R2 = cross(N, dPx);
              float det = dot(dPx, R1);
              if (abs(det) > 1e-20) {
                vec3 sg = (dBs * R1 + dBt * R2) / det;
                float sl = length(sg);
                if (sl > 1.5) sg *= 1.5 / sl;
                N = normalize(N - sg);
              }
              // (its hollows a little darker: less of the room reaches in)
              surfAO = 1.0 - cq29.w * (1.0 - clamp(h0, 0.0, 1.0)) * fade;
            }
          }
        }
        // sugar coating (sour gummies): only on the moulded outside (a sugar
        // cube's all sugar: its cuts too)
        float coat = cSugar * (1.0 - fresh * (1.0 - cThrough)) * (1.0 - cavity);
        // a dusting: its own on the outside (mochi's starch), or flour it's
        // been rolled in - wherever that touched, cut faces too
        float dustOwn = cDust * (1.0 - fresh) * (1.0 - cavity), dustFlour = vData.w * (1.0 - cavity);
        float dust = max(dustOwn, dustFlour);
        // (sprinkles and glitter lie flat on it: drawn in the rest-space plane
        // the surface here is nearest - its normal from how the rest point
        // runs across the pixel)
        vec3 restN = abs(cross(dFdx(vRest), dFdy(vRest)));
        vec2 flat2 = restN.x > restN.y && restN.x > restN.z ? vRest.yz : restN.y > restN.z ? vRest.xz : vRest.xy;
        // surface micro-structure: faint knife texture on cut faces, ice crystals when frozen
        if (fresh > 0.5 || frost > 0.01) {
          vec3 q = vRest * 38.0;
          float e = 0.02;
          float n0 = fbm3(q);
          vec3 g = vec3(fbm3(q + vec3(e, 0, 0)) - n0, fbm3(q + vec3(0, e, 0)) - n0, fbm3(q + vec3(0, 0, e)) - n0) / e;
          N = normalize(N + (g - N * dot(g, N)) * (0.012 * fresh + 0.09 * frost));
        }

        float NdV = dot(N, V);
        // (the silhouette, from the mesh's own normal: how much of this
        // pixel the jelly covers - see the end)
        float NdVg = dot(normalize(vNormal), V);
        float cover = clamp(NdVg / max(fwidth(NdVg) * 1.3, 1e-4), 0.0, 1.0);
        if (NdV < 0.02) { N = normalize(N + V * (0.02 - NdV)); NdV = max(dot(N, V), 0.02); }
        // The rim, where the line of sight grazes the surface: jelly keeps
        // its colour right to the edge (light inside runs along it), but a
        // sliver this thin shows the room through almost unfiltered and reads
        // grey - which next to red looks green. So no colour split there, a
        // little more jelly in the way, and the room's reflection held back.
        float rim = smoothstep(0.45, 0.98, 1.0 - NdV);
        float disp = cDisp * (1.0 - rim);

        vec2 uv = gl_FragCoord.xy / resolution;
        vec4 back = texture(tBack, uv);
        float frontDepth = cavity > 0.5 ? -(viewMatrix * vec4(Pw, 1.0)).z : -vViewPos.z;
        float thick = back.r > 0.0 ? clamp(back.r - frontDepth, 0.0, 4.0) : 0.0;
        vec3 Nb = back.r > 0.0 ? normalize((vec4(octDecode(back.gb), 0.0) * viewMatrix).xyz) : -N;
        // (where the line of sight leaves, as a rest point: for a gradient -
        // else nothing's looked up for it, here or below)
        vec3 exitR = Rp;
        if (cLayers > 0 && back.r > 0.0) exitR = uBackRest > 0.5 ? textureLod(tBackRest, uv, 0.0).xyz : vec3(Rp.x, back.a, Rp.z);
        // (and what it leaves through: the far side's coat, if any - see
        // createBackMaterial)
        float exitCoat = back.r > 0.0 && (uBackRest > 0.5 || cLayers <= 0) ? clamp(back.a, 0.0, 1.0) : 0.0;

        float rough = clamp(cRough + fresh * 0.02 + frost * 0.5 - melt * 0.02 + coat * 0.18 + dust * 0.45 + surfRough, 0.015, 1.0);
        // (specular anti-aliasing: where the surface turns faster than a
        // pixel can show - bevels and corners, on a small or low-resolution
        // screen - its reflections blur as if it were rougher, instead of the
        // studio's softboxes breaking up into stair-stepped, pointy shards)
        vec3 dNx = dFdx(vNormal), dNy = dFdy(vNormal);
        float a2 = rough * rough * rough * rough + min(0.5 * (dot(dNx, dNx) + dot(dNy, dNy)), 0.18);
        rough = max(rough, sqrt(sqrt(min(a2, 1.0))));
        float lod = clamp(rough * 9.0 + frost * 2.5 + thick * 1.6 + exitCoat * 1.8, 0.0, uSceneLodMax);
        // (and no sharper than a pixel can show: where the surface bends the
        // view hard - its edges, its corners - one pixel sees a wide patch of
        // the room behind, and a point of it (a checker floor's lines)
        // aliased into jagged ribs; the room's taken blurred to the patch)
        vec2 uvT = throughUV(Pw, V, N, Nb, thick, cIor);
        vec2 duT = dFdx(uvT) * resolution, dvT = dFdy(uvT) * resolution;
        lod = clamp(max(lod, 0.5 * log2(max(max(dot(duT, duT), dot(dvT, dvT)), 1.0))), 0.0, uSceneLodMax);

        vec3 trans;
        trans.r = sampleThrough(Pw, V, N, Nb, thick, cIor - disp, lod, rough, 0).r;
        trans.g = sampleThrough(Pw, V, N, Nb, thick, cIor, lod, rough, 1).g;
        trans.b = sampleThrough(Pw, V, N, Nb, thick, cIor + disp, lod, rough, 2).b;
        // The far side's coat, seen from inside - a sour gummy cut open,
        // looked into: the room behind is seen through its sugar, not past
        // it - blurred, and whitened by the crystals (or the dusting, the
        // flour, the frost), lit from outside, in the way.
        if (exitCoat > 0.0) {
          vec3 Lx = normalize(uLightDir);
          vec3 coatLit = envLookup(Nb, 1.0) * 0.8 + uLightColor * (max(dot(Nb, Lx), 0.0) * 0.45 + 0.04);
          // (its grains, where the line of sight leaves - as a rest point:
          // the rest target's, or carried on unturned from where it went in)
          vec3 xr = uBackRest > 0.5 ? textureLod(tBackRest, uv, 0.0).xyz : Rp + refract(-V, N, 1.0 / cIor) * thick;
          float grain = 1.0 - smoothstep(0.38, 0.5, worley(xr * 56.0).x);
          vec3 frosted = coatLit * vec3(0.98, 0.97, 0.95) * (0.8 + 0.45 * grain);
          // (its colour: white crystals, frost - or, dusted, the powder's)
          vec4 cq30 = cubeT(30);
          frosted *= mix(vec3(1.0), cq30.rgb / 0.98, cq30.a);
          trans = mix(trans, frosted, clamp(exitCoat * (0.8 + 0.12 * grain), 0.0, 0.94));
        }

        float pathLen = thick + 0.2 * rim * rim;
        // Rubik: the sticker you look into (its seams dark, its white milky)
        int rk = cLayers < 0 ? rubikAt(Rp) : 0;
        float rkSeam = cLayers < 0 ? cRubikSeam : 0.0, rkMilk = cLayers < 0 ? cubeT(7 + rk).a : 0.0;
        // Gradients: what you see is all of it along the way, not just its
        // skin - blue in front of pink, you see the pink through the blue.
        // Stepped from where the line of sight goes in to where it comes
        // out: every band's absorption added up (the light from behind
        // crossed them all), and the light scattered inside from each, the
        // deeper the fainter - the colour you look into leads, what's behind
        // tints it - with some of the light that made it through all of it,
        // coloured by every band (blue then pink: purple). For the light
        // coming through, part of the skin's own (a sunburst's bright middle
        // stays bright, looked at from the side).
        // (glow mode: its own light from all of it - light from further in
        // comes out through what's in front, coloured by it: mixed in plain,
        // a rainbow's middle went white)
        vec3 sigma = cAbsorb, gradSc = cScatterColor, gradEm = cScatterColor;
        if (cLayers > 0) {
          float fade = 1.0 + (cScatter + cMilk * 7.0 + frost * 2.5) * 0.3, dl = pathLen / 12.0;
          vec3 tau = vec3(0.0), S = vec3(0.0), E = vec3(0.0);
          float W = 0.0;
          for (int k = 0; k < 12; k++) {
            vec3 ak, sk;
            cGradBoth(mix(Rp, exitR, (float(k) + 0.5) / 12.0), ak, sk);
            float w = exp(-fade * dl * (float(k) + 0.5));
            S += sk * w;
            W += w;
            vec3 Tk = exp(-(tau + ak * (0.5 * dl)));
            E += sk * Tk;
            tau += ak * dl;
          }
          float em = max(E.r, max(E.g, E.b));
          gradEm = em > 1e-5 ? E / em : cGradAt(Rp, 1);
          sigma = pathLen > 1e-4 ? tau / pathLen : cGradAt(Rp, 0);
          // (the skin you look into, and all that's behind it - as much as
          // that adds a colour: blue then pink, a purple, strongly; a jumble
          // of many bands averages to grey, and the skin's bands hold)
          vec3 deepSc = S / W;
          float dm = max(deepSc.r, max(deepSc.g, deepSc.b));
          float chroma = (dm - min(deepSc.r, min(deepSc.g, deepSc.b))) / max(dm, 1e-3);
          gradSc = mix(cGradAt(Rp, 1), deepSc, mix(0.25, 0.75, smoothstep(0.25, 0.7, chroma)));
          // (where nothing gets through, its mix of everything is only mud)
          vec3 Tall = exp(-tau);
          sigma = mix(sigma, cGradAt(Rp, 0), 0.35);
          float mt = max(Tall.r, max(Tall.g, Tall.b));
          gradSc = mix(gradSc, Tall / max(mt, 1e-4), 0.3 * smoothstep(0.0, 0.3, mt));
        }
        else if (cLayers < 0) sigma = cubeT(7 + rk).rgb;
        vec3 Tr = exp(-sigma * pathLen * (1.0 + melt * 0.35));
        float haze = 1.0 - exp(-(cScatter + (cMilk + rkMilk) * 7.0 + frost * 2.5) * pathLen);
        haze = max(haze, max((cMilk + rkMilk) * 0.72, cHazeMin));

        // (the key light here: another cube may be in its way)
        vec3 keyLight = uLightColor * cubeShadowAt(Pw);
        vec3 L = normalize(uLightDir);
        float NdL = dot(N, L);
        float wrap = max((NdL + 0.7) / 1.7, 0.0);
        vec3 irr = envLookup(N, 1.0) * (1.0 - 0.22 * gShadowOcc);
        float backlit = pow(clamp(dot(V, -L), 0.0, 1.0), 3.0);
        vec3 baseSc = gradSc;
        if (cLayers < 0) baseSc = cubeT(17 + rk).rgb;
        // creamy jelly: pastel, milky body colour
        baseSc = mix(baseSc, mix(baseSc, vec3(1.0), 0.45) * 1.05, cMilk);
        vec3 sc = mix(baseSc, vec3(0.92, 0.96, 1.0), frost * 0.85);
        // light that scattered inside the body (thin regions glow more brightly)
        // translucency: how much light glows through (and how deep it reaches)
        vec3 scatterLight = sc * (irr * 0.55 + keyLight * (wrap * 0.22 + backlit * (0.25 + 0.5 * cGlow)))
          * (0.2 + 1.6 * cGlow) * (0.55 + 0.45 * exp(-pathLen * mix(3.0, 0.45, cGlow)));

        vec3 body = trans * Tr * (1.0 - haze) + scatterLight * haze;
        // (the seams between stickers: dark, like the plastic between them)
        body = mix(body, body * 0.1, rkSeam * 0.9);

        float F0 = pow((cIor - 1.0) / (cIor + 1.0), 2.0);
        float F = min(F0 + (1.0 - F0) * pow(clamp(1.0 - NdV, 0.0, 1.0), 5.0), 1.0 - 0.5 * rim);
        vec3 Rv = reflect(-V, N);
        vec3 refl = envLookup(Rv, rough);
        // below the horizon it mirrors the real floor where that ray lands -
        // the jelly's own coloured shadow and caustics, its glow pool - not
        // the studio map's flat grey (which beside a strong colour reads as
        // its opposite: red edges looked green)
        // (Worked out at every pixel, not just those looking down: the floor's
        // pattern and its shadow are filtered by how fast the point moves
        // across the screen, and that's only known if the pixels round this
        // one work it out too - in a branch some skip, it's garbage, and a
        // checker floor reflected round an edge tore into jagged shards. And
        // the change from the room above to the floor below no sharper than
        // a couple of pixels: round an edge it was a hard line along it.)
        vec3 Hf = Pw + Rv * (max(Pw.y, 0.0) / max(-Rv.y, 0.02));
        vec3 flr = floorAt(Hf.xz, rough) * envIntensity;
        float hzw = clamp(2.0 * fwidth(Rv.y), 0.12, 0.6);
        refl = mix(refl, flr, 1.0 - smoothstep(-hzw, 0.0, Rv.y));

        vec3 H = normalize(L + V);
        float NdH = max(dot(N, H), 0.0);
        float a = max(rough * rough, 0.0012);
        float nl = max(NdL, 0.0);
        float Fh = F0 + (1.0 - F0) * pow(clamp(1.0 - dot(H, V), 0.0, 1.0), 5.0);
        // (capped: a glassy highlight seen dead on can top half-float range)
        vec3 spec = min(keyLight * D_GGX(NdH, a) * V_Smith(nl, NdV, a) * nl * Fh, vec3(48.0));

        // Thin-film iridescence (a soap bubble, holographic foil, pearl): a
        // film on the surface reflects a rainbow whose colours slide with the
        // angle you look from; its thickness wanders over the surface, so the
        // colours swirl. The film reflects more than bare jelly, all over the
        // face, and the light through it picks up its colours too.
        vec3 iriSpec = vec3(1.0), iriGlow = vec3(1.0);
        if (cIrid > 0.0) {
          // (the colour mostly by the angle - each face its own, the bevels
          // running through the rainbow - the film's thickness wandering a
          // little; on milky stuff a paler, pearly sheen)
          // (pink square on, sliding to purple and cyan across a face as the
          // film thickens, the rims running through the rainbow; foil busier)
          // (foil: busier, and banded by where its reflection points - the
          // bands sweep across it as it turns)
          vec3 Rf = reflect(-V, N);
          float film = 0.3 * vnoise(Rp * 1.1) + 0.06 * vnoise(Rp * 3.3 + 3.0) + 0.05 * (N.x - N.z)
            + cMetal * (0.3 * vnoise(Rp * 2.6 + 9.0) + 0.6 * (Rf.x * 0.7 + Rf.y * 0.5 + Rf.z * 0.3));
          float graze = 1.0 - NdV;
          vec3 iri = filmColor(film - 0.08 + 0.85 * graze);
          iri = mix(vec3(dot(iri, vec3(0.3333))), iri, 1.0 - 0.55 * cMilk);
          F = mix(F, max(F, 0.12 + 0.7 * sq(1.0 - NdV)), cIrid);
          refl *= mix(vec3(1.0), iri * 2.0, cIrid);
          iriSpec = mix(vec3(1.0), mix(vec3(1.0), iri, 0.7) * 1.3, cIrid);
          spec *= iriSpec;
          vec3 iri2 = filmColor(film - 0.07 + 0.62 * graze);
          iri2 = mix(vec3(dot(iri2, vec3(0.3333))), iri2, 1.0 - 0.6 * cMilk);
          // (deeper through the body than on the skin: the light crosses it)
          // (deeper still where more of it is crossed)
          // (a tint has to take its other colours away, like tinted glass, to
          // stay vivid: a pale one only went pastel under the tone mapping)
          vec3 deep2 = pow(iri2, vec3(3.0)) * 1.15 * mix(1.0, exp(-pathLen * 0.45), 0.7);
          iriGlow = mix(vec3(1.0), pow(iri2, vec3(1.6)) * 1.5, cIrid * 0.85);
          body = mix(body, body * mix(vec3(1.0), deep2, 0.95) + iri2 * irr * 0.06, cIrid * (1.0 - 0.6 * cMilk));
        }

        vec3 col = body * (1.0 - F) * (0.4 + 0.6 * surfAO) + (refl * F + spec) * surfAO;

        // Metal: a mirror tinted by its own colour (cherry: red chrome; lemon:
        // gold), no light through it, its edges going white (Schlick, with
        // the colour as F0) - iridescent too, for holographic foil
        if (cMetal > 0.0) {
          // (its colour right at the surface: a mirror shows nothing of what's
          // inside it - layered, the bands it's cut through where you look,
          // not the ones a line of sight through it would cross)
          vec3 skin = cScatterColor;
          if (cLayers > 0) skin = cGradAt(Rp, 1);
          else if (cLayers < 0) skin = cubeT(17 + rk).rgb;
          vec3 F0m = mix(skin * 0.92, vec3(0.94), 0.14);
          vec3 Fm = F0m + (vec3(1.0) - F0m) * pow(clamp(1.0 - NdV, 0.0, 1.0), 5.0);
          vec3 FmH = F0m + (vec3(1.0) - F0m) * pow(clamp(1.0 - dot(H, V), 0.0, 1.0), 5.0);
          vec3 specM = min(keyLight * D_GGX(NdH, a) * V_Smith(nl, NdV, a) * nl * FmH, vec3(48.0)) * iriSpec;
          // (and the studio's big softbox overhead, as only a mirror sees it:
          // the room's map is dim straight up, so a chrome top - which looks
          // up - showed a dark, flat face that read as tinted glass. Seen in a
          // mirror it's a bright panel with a crisp edge, sliding over the
          // face as it turns. A place has its own sky up there instead.)
          vec3 reflM = refl;
          if (Rv.y > 0.02 && uMetalCeil.r + uMetalCeil.g + uMetalCeil.b > 0.0) {
            vec2 q = Rv.xz / Rv.y;
            vec2 aa = fwidth(q) + 0.015;
            float box = (1.0 - smoothstep(1.5 - aa.x, 1.5 + aa.x, abs(q.x))) * (1.0 - smoothstep(1.2 - aa.y, 1.2 + aa.y, abs(q.y)));
            reflM = mix(reflM, uMetalCeil * (0.9 + 0.1 * smoothstep(1.6, 0.0, length(q))), box);
          }
          // (chrome reads by its contrast: the studio's bright boxes against a
          // darker room, the floor and the horizon below - a mirror in an
          // evenly lit room just looks white - but not so much that what's
          // only dim goes black)
          float lumR = dot(reflM, vec3(0.2126, 0.7152, 0.0722));
          vec3 reflC = mix(reflM, reflM * (0.42 + 1.05 * smoothstep(0.3, 1.8, lumR)) * (0.5 + 0.5 * smoothstep(-0.06, 0.3, Rv.y)), 1.0 - 0.75 * cIrid);
          vec3 colM = reflC * Fm * 1.1 + specM + irr * skin * 0.05 * rough;
          col = mix(col, colM, cMetal);
        }

        // Opal: in its milky body, little patches that flash pure spectral
        // colour as you move - each a tiny grating turned its own way
        if (cOpal > 0.0) {
          // (a mosaic of patches at two sizes, a little way inside, each lit
          // up by how square to you it's turned)
          // (small, saturated flecks - opal's pinfire - each winking on only
          // while it's turned square to you, so they come and go as it turns)
          vec3 qo = Rp * 6.0 + refract(-V, N, 1.0 / cIor) * min(thick, 0.5) * 2.0;
          qo += (vec3(vnoise(qo * 0.8), vnoise(qo * 0.8 + 5.0), vnoise(qo * 0.8 + 9.0)) - 0.5) * 0.9; // (ragged, not round)
          vec3 fire = vec3(0.0);
          for (int s = 0; s < 2; s++) {
            vec2 wo = worley(s == 0 ? qo : qo * 2.3 + 11.0);
            vec3 gd = normalize(vec3(hash13(vec3(wo.y * 91.0 + float(s) * 7.0)), hash13(vec3(wo.y * 37.0 + 5.0)), hash13(vec3(wo.y * 13.0 + 9.0))) - 0.5);
            float face = abs(dot(V, gd));
            float on = smoothstep(0.72, 0.98, face) * (1.0 - smoothstep(0.32, 0.5, wo.x));
            fire += spectrum(fract(wo.y * 5.3 + face * 1.3)) * on * (s == 0 ? 1.0 : 0.7);
          }
          col += fire * (irr * 0.8 + keyLight * (0.18 + 0.3 * nl) + cGlowColor * uEmit * 1.6) * cOpal * (1.0 - F) * 1.5;
        }

        // Glow mode: it gives off its own light, from all of its body -
        // brighter through more of it, towards a hotter, paler core. A knock
        // sends a ring of light racing out through it from where it landed.
        vec3 emLit = vec3(0.0);
        if (uEmit > 0.0) {
          float deep = 1.0 - exp(-pathLen * 1.8);
          // its colour (layered: see gradEm)
          vec3 scE = sc;
          if (cLayers > 0) {
            scE = mix(gradEm, mix(gradEm, vec3(1.0), 0.45) * 1.05, cMilk);
            scE = mix(scE, vec3(0.92, 0.96, 1.0), frost * 0.85);
          }
          // (light from deeper in has crossed more of it: a richer colour -
          // more saturated, but the same hue, so a rainbow keeps its yellow)
          float scL = dot(scE, vec3(0.2126, 0.7152, 0.0722));
          vec3 rich = max(mix(vec3(scL), scE, 1.0 + 0.25 * deep), 0.0);
          // slow currents of brighter light drifting about inside it, and a
          // slow breath
          vec3 q = vRest + refract(-V, N, 1.0 / cIor) * thick * 0.5;
          float cur = vnoise(q * 2.3 + vec3(0.0, uTime * 0.16, uTime * 0.07)) * 0.65
            + vnoise(q * 5.1 - vec3(uTime * 0.11, 0.0, uTime * 0.13)) * 0.35;
          float lvl = (0.78 + 0.5 * cur) * (0.95 + 0.05 * sin(uTime * 1.3));
          vec3 em = rich * (0.08 + 0.8 * deep) * lvl + scE * 0.16 * smoothstep(0.7, 1.8, pathLen);
          float ring = 0.0;
          for (int i = 0; i < ${MAX_PULSES}; i++) {
            float age = uTime - uPulse[i].w;
            if (age < 0.0 || age > 1.6) continue;
            float x = (distance(Pw, uPulse[i].xyz) - age * 2.3) / (0.035 + 0.09 * age);
            ring += uPulseAmp[i] * exp(-x * x) * exp(-age * 2.4);
          }
          em += mix(scE, vec3(1.0), 0.22) * min(ring, 3.0) * 2.6;
          // (a rainbow film colours its glow; metal barely glows - it's a
          // mirror in the dark, lit at its edges; opal's flecks stay seen)
          em *= iriGlow;
          emLit = em * uEmit * (1.0 - 0.7 * cMetal) * (1.0 - 0.35 * cOpal);
          col += emLit * (1.0 - 0.85 * F);
        }

        // dynamic point light (torch flame, explosion flash)
        if (uPLColor.r + uPLColor.g + uPLColor.b > 0.001) {
          vec3 Lp = uPLPos - Pw;
          float dp = length(Lp);
          Lp /= dp;
          float fall = 1.0 / (1.0 + dp * dp * 9.0);
          float nlp = max(dot(N, Lp), 0.0);
          vec3 Hp = normalize(Lp + V);
          float specP = D_GGX(max(dot(N, Hp), 0.0), max(a, 0.004)) * V_Smith(nlp, NdV, max(a, 0.004)) * nlp * 0.06;
          col += uPLColor * fall * (specP + sc * (max((dot(N, Lp) + 0.6) / 1.6, 0.0) * 0.5 + 0.35));
        }

        // sugar crystals: discrete grains with their own facets and glints,
        // the gummy colour showing between them
        if (coat > 0.0) {
          vec2 w = worley(vRest * 56.0);
          float grain = (1.0 - smoothstep(0.38, 0.5, w.x)) * step(0.12, w.y);
          vec3 cn = normalize(N + (vec3(hash13(vec3(w.y * 91.0)), hash13(vec3(w.y * 37.0 + 5.0)), hash13(vec3(w.y * 13.0 + 9.0))) - 0.5) * 1.4);
          float glint = pow(max(dot(reflect(-V, cn), L), 0.0), 70.0) * 22.0;
          vec3 sugarCol = mix(vec3(1.0), sc, 0.18) * (irr * 0.62 + keyLight * (max(dot(cn, L), 0.0) * 0.45 + 0.1)) * (0.8 + 0.3 * w.y)
            + emLit * 0.6; // (in glow mode the grains scatter its light)
          col = mix(col, sugarCol + keyLight * glint, grain * coat * 0.9);
          // fine dusting between the grains
          col = mix(col, mix(vec3(1.0), sc, 0.4) * (irr * 0.5 + keyLight * nl * 0.3), coat * 0.14 * (1.0 - grain));
        }

        // A dusting: its own (mochi's starch, a marshmallow's icing sugar -
        // even, mottled, white), or what it's been sifted on or rolled in
        // (see Flour) - as much as there is, that much of the surface under
        // it, so a patch thins out at its edge (not the shape of the mesh
        // it's kept on); its colour, and how it's made: fine powder,
        // crystals that glint (sugar), sprinkles each their own colour,
        // glitter flakes that flash as it turns.
        if (dust > 0.0) {
          vec3 lit = irr * 0.72 + keyLight * (max(dot(N, L), 0.0) * 0.55 + 0.08);
          if (dustOwn > 0.0) {
            float clump = fbm3(vRest * 64.0) * 0.65 + 0.35 * vnoise(vRest * 190.0);
            col = mix(col, vec3(0.97, 0.955, 0.925) * lit + emLit * 0.35, clamp(dustOwn * (0.72 + 0.75 * (clump - 0.5)), 0.0, 1.0) * 0.9);
          }
          if (dustFlour > 0.004) {
            float a = dustFlour, ia = 1.0 / max(vData.w, 1e-3);
            vec3 pc = clamp(vCoat.rgb * ia, 0.0, 1.0);
            float ps = clamp(vCoat.a * ia, 0.0, 1.0), pm = clamp(vCoatM * ia, 0.0, 1.0);
            float wP = (1.0 - ps) * (1.0 - pm), wC = ps * (1.0 - pm), wS = pm * (1.0 - ps), wG = ps * pm;
            if (wP > 0.02) {
              float n = fbm3(vRest * 46.0) * 0.6 + vnoise(vRest * 150.0) * 0.4;
              float cov = smoothstep(n - 0.1, n + 0.1, a * 1.15 - 0.06);
              col = mix(col, pc * lit + emLit * 0.3 * pc, cov * 0.92 * wP);
            }
            if (wC > 0.02) {
              vec2 w = worley(vRest * 64.0);
              float grain = (1.0 - smoothstep(0.34, 0.47, w.x)) * step(w.y, a * 1.1);
              vec3 cn = normalize(N + (vec3(hash13(vec3(w.y * 91.0)), hash13(vec3(w.y * 37.0 + 5.0)), hash13(vec3(w.y * 13.0 + 9.0))) - 0.5) * 1.4);
              float glint = pow(max(dot(reflect(-V, cn), L), 0.0), 70.0) * 22.0;
              vec3 cc = mix(vec3(1.0), pc, 0.5) * (irr * 0.6 + keyLight * (max(dot(cn, L), 0.0) * 0.45 + 0.1)) * (0.8 + 0.3 * w.y) + keyLight * glint + emLit * 0.5;
              col = mix(col, cc, grain * 0.9 * wC);
            }
            if (wS > 0.02) {
              float ridge;
              vec4 sp = sprinkles(flat2, clamp(a * 1.3, 0.0, 1.0), ridge);
              vec3 sc2 = sp.rgb * (lit * (0.75 + 0.45 * ridge) + 0.03) + keyLight * pow(max(dot(reflect(-V, N), L), 0.0), 40.0) * 0.4 * ridge + emLit * 0.3 * sp.rgb;
              col = mix(col, sc2, sp.a * wS);
            }
            if (wG > 0.02) {
              vec2 fl = flakes(flat2, clamp(a * 1.2, 0.0, 1.0));
              vec3 fn = normalize(N + (vec3(hash13(vec3(fl.x * 71.0)), hash13(vec3(fl.x * 29.0 + 3.0)), hash13(vec3(fl.x * 17.0 + 7.0))) - 0.5) * 1.2);
              vec3 hue = mix(sprinkleCol(fract(fl.x * 13.7)), pc, 0.2);
              float g = pow(max(dot(reflect(-V, fn), L), 0.0), 40.0) * 26.0;
              vec3 fc = hue * (envLookup(reflect(-V, fn), 0.15) * 0.9 + keyLight * (g + 0.15) + 0.04) + emLit * 0.4 * hue;
              col = mix(col, fc, fl.y * wG);
            }
          }
        }

        // frost layer: white crystalline film with sparkles
        if (frost > 0.0) {
          float crystal = fbm3(vRest * 55.0);
          float sparkle = pow(max(vnoise(vRest * 160.0 + floor(uTime * 0.0)), 0.0), 18.0) * 30.0 * nl;
          vec3 frostCol = vec3(0.86, 0.92, 1.0) * (irr * 0.75 + keyLight * (nl * 0.5 + 0.15)) * (0.7 + 0.5 * crystal)
            + emLit * (0.4 + 0.25 * crystal); // (lit from inside, in glow mode)
          col = mix(col, frostCol + sparkle, frost * (0.35 + 0.4 * crystal));
        }

        // (deep in a hollow a little less of the room's light gets in; its
        // rim, a crisp edge, catches it)
        col *= 1.0 - 0.12 * cavity * cavDeep;
        col += (irr * 0.35 + keyLight * 0.12) * cavity * smoothstep(0.82, 1.0, 1.0 - cavDeep) * 0.6;

        // healing glow
        col += cGlowColor * glow * (0.25 + fresh * 0.75);

        // The weld (uWeldT s after the pieces fuse): the seam lines flare
        // white-hot and the jelly round them scorches, a ragged ember edge
        // creeping outward; then a wave of healing light runs out from the
        // seams and wipes the scorch away, and the lines cool to nothing.
        // Seam distance: exact per pixel near a seam, per vertex further out.
        if (uWeldT < 5.0) {
          float t = uWeldT, U = uWeldUnit;
          vec3 pr = vRest / U;
          float d = min(weldNear(vRest), vWeld) / U;
          float px = clamp(fwidth(d), 2e-4, 0.02);
          // the healing front sets out from the seams at 0.8 s
          float th = max(t - 0.8, 0.0);
          float rh = th * (0.11 + 0.55 * th);
          float healed = th > 0.0 ? 1.0 - smoothstep(rh - 0.02, rh, d) : 0.0;
          if (d < 0.075 && healed < 1.0) {
            // the scorch creeps out 3-5 cm, ragged, darkest at the seam
            float ragged = fbm3(pr * 9.0);
            float fine = vnoise(pr * 70.0);
            float rb = (0.008 + 0.032 * smoothstep(0.0, 0.8, t)) * (0.72 + 0.56 * ragged) + 0.006 * (vnoise(pr * 32.0) - 0.5) + 0.003 * (fine - 0.5);
            float burnt = (1.0 - smoothstep(rb - px, rb + px, d)) * smoothstep(0.0, 0.25, t) * (1.0 - healed);
            float charA = burnt * (0.78 + 0.22 * (1.0 - d / max(rb, 1e-3))) * (0.88 + 0.22 * fine);
            vec3 charCol = vec3(0.042, 0.017, 0.011) * (irr * 0.6 + keyLight * nl * 0.45) + spec * 0.5;
            col = mix(col, charCol, clamp(charA, 0.0, 0.97));
            // embers: a glowing rim on the creeping edge, sparks in the char
            float flick = 0.62 + 0.38 * vnoise(pr * 26.0 + vec3(0.0, t * 5.0, t * 3.0));
            float rim = exp(-sq((d - rb) / max(0.003, 1.5 * px))) * (1.0 - healed) * smoothstep(0.03, 0.2, t);
            float spark = smoothstep(0.8, 0.93, vnoise(pr * 115.0 + vec3(t * 0.7))) * burnt;
            col += vec3(1.0, 0.32, 0.05) * flick * (rim * 2.3 + spark * 1.8);
          }
          // the seam line: crisp and white-hot, cooling through yellow and
          // orange to a faint scar; its heat bleeds out a little way
          float T = exp(-0.85 * t) * (1.0 - 0.6 * smoothstep(0.8, 1.6, t));
          vec3 hotC = mix(vec3(0.7, 0.07, 0.01), vec3(1.0, 0.42, 0.07), smoothstep(0.0, 0.3, T));
          hotC = mix(hotC, vec3(1.0, 0.82, 0.45), smoothstep(0.3, 0.65, T));
          hotC = mix(hotC, vec3(1.0, 0.98, 0.94), smoothstep(0.65, 1.0, T));
          float w = 0.0025 + 0.0015 * smoothstep(0.0, 0.6, t);
          float line = 1.0 - smoothstep(w - px, w + px, d);
          float halo = exp(-d / (0.0035 + 0.003 * t));
          col += hotC * (1.0 - smoothstep(3.2, 5.0, t)) * (line * (0.35 + 3.2 * T) + halo * (0.1 + 1.4 * T));
          // the healing light riding the front: narrow and bright at first,
          // widening and dimming as it runs out over the faces
          float wb = 0.005 + 0.038 * th;
          float xb = (d - rh) / wb;
          if (th > 0.0 && abs(xb) < 3.0) {
            float band = exp(-xb * xb) * smoothstep(0.0, 0.05, th) * exp(-1.5 * th) * 0.85;
            vec3 healC = mix(vec3(1.0, 0.94, 0.82), cGlowColor * vec3(1.15, 1.0, 0.85), smoothstep(0.0, 0.9, th));
            col += healC * band * (1.0 + 0.3 * vnoise(pr * 22.0 + vec3(0.0, th * 2.0, 0.0)));
          }
          // (and warmth through the body while the seams are hot)
          col += hotC * (1.0 - exp(-pathLen * 1.2)) * exp(-1.6 * t) * smoothstep(0.0, 0.2, t) * 0.2;
        }
        // the outline, anti-aliased: the last pixel is part jelly, part
        // whatever's behind - where the jelly really is that thin, or at the
        // outer edge (no jelly just past this pixel, out along the normal)
        float silh = 1.0 - smoothstep(0.0, 0.03, thick);
        if (cover < 1.0) {
          vec2 nS = (viewMatrix * vec4(normalize(vNormal), 0.0)).xy;
          if (dot(nS, nS) > 1e-6 && textureLod(tBack, uv + normalize(nS) * 1.5 / resolution, 0.0).r <= 0.0) silh = 1.0;
        }
        col = mix(textureLod(tScene, uv, 0.0).rgb, col, mix(1.0, cover, silh));
        if (uDebug == 1) col = refl * F + spec;
        else if (uDebug == 2) col = trans * Tr;
        else if (uDebug == 3) col = vec3(thick * 0.5);
        else if (uDebug == 4) col = scatterLight * haze;
        else if (uDebug == 5) col = refl;
        else if (uDebug == 6) col = N * 0.5 + 0.5;
        else if (uDebug == 7) col = body;
        else if (uDebug == 8) col = vec3(F);

        gl_FragColor = vec4(finite(col), 1.0);
      }
    `,
  });
}

// Caustics, step 1: the jelly seen from the key light. kind 0: where each
// ray first enters it (world position, relative to uOrigin for precision,
// and its rest height + 10, so 0 means "no jelly"); kind 1: the smooth
// surface normal there (and the temperature); kind 2: where it first
// leaves (as kind 0).
export function createLightViewMaterial(kind) {
  return new THREE.ShaderMaterial({
    side: kind === 2 ? THREE.BackSide : THREE.FrontSide,
    uniforms: { uOrigin: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */ `
      attribute vec3 aRest;
      attribute vec4 aData;
      attribute float aCube;
      varying vec3 vW;
      varying vec3 vN;
      varying float vRestY;
      varying vec3 vRest3;
      varying float vTemp;
      varying float vCubeK;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vN = mat3(modelMatrix) * normal;
        vRestY = aRest.y;
        vRest3 = aRest;
        vTemp = aData.x;
        vCubeK = aCube;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uOrigin;
      varying vec3 vW;
      varying vec3 vN;
      varying float vRestY;
      varying vec3 vRest3;
      varying float vTemp;
      varying float vCubeK;
      ${SAFE_GLSL}
      ${kind === 1 ? '' : 'layout(location = 1) out highp vec4 oRest;'}
      ${kind === 2 ? 'layout(location = 2) out highp vec4 oNrm;' : ''}
      void main() {
        // (w: the rest height, + 10 so 0 is "nothing here", + 4 a cube -
        // see lightViewCube; and the rest point, for the gradients)
        ${kind === 1 ? 'gl_FragColor = finite4(vec4(safeNormalize(vN), vTemp));' : 'gl_FragColor = finite4(vec4(vW - uOrigin, vRestY + 10.0 + 4.0 * floor(vCubeK + 0.5))); oRest = finite4(vec4(vRest3, 1.0));'}
        ${kind === 2 ? 'oNrm = finite4(vec4(safeNormalize(vN), 1.0)); // (the far side: its outward normal, for the light leaving)' : ''}
      }`,
  });
}

// the light view's w: 0 nothing; else 10 + 4 x its cube + its rest height
// (rest heights stay within +-1)
export const LIGHT_VIEW_GLSL = /* glsl */ `
  float lightViewCube(float w) { return floor((w - 8.0) * 0.25); }
  float lightViewRestY(float w) { return w - 10.0 - 4.0 * lightViewCube(w); }
`;

// Caustics, step 2 (caustics mapping, after Shah et al. / Wallace): a dense
// grid of the key light's rays, each looked up in the light's view of the
// jelly, bent by the smooth surface normal where it enters and carried to
// the floor; drawn there additively, each little cell's brightness the
// ratio of the area its light had to the area it lands on. Its colour is
// what survives the jelly along the way - through the layers the ray really
// crosses, from where it enters to where it leaves. The detail no longer
// depends on the size of the mesh's triangles.
export function createCausticMaterial(layerUniforms) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uCubeTex: { value: null },
      uLightDir: { value: new THREE.Vector3(-0.45, 0.8, 0.4).normalize() },
      uFloorRect: { value: new THREE.Vector4(-3, -3, 1 / 6, 1 / 6) },
      tEntry: { value: null },
      tNormal: { value: null },
      tExit: { value: null },
      tEntryRest: { value: null },
      tExitRest: { value: null },
      tExitN: { value: null },
      uGradTex: { value: null },
      uFreeTex: { value: null },
      uOrigin: { value: new THREE.Vector3() },
      uLightVP: { value: new THREE.Matrix4() },
      uChannel: { value: -1 }, // (dispersion: drawn once a colour, each bent its own amount; -1 all at once)
      uDisperse: { value: 0 },
      uLightInvVP: { value: new THREE.Matrix4() },
      uGridN: { value: 256 },
      uCausRect: { value: new THREE.Vector4(-3, -3, 1 / 6, 1 / 6) },
    },
    vertexShader: /* glsl */ `
      uniform sampler2D tEntry;
      uniform sampler2D tNormal;
      uniform sampler2D tExit;
      uniform sampler2D tEntryRest;
      uniform sampler2D tExitRest;
      uniform sampler2D tExitN;
      uniform highp sampler2D uCubeTex;
      uniform vec3 uOrigin;
      uniform mat4 uLightInvVP;
      uniform mat4 uLightVP;
      uniform float uChannel;
      uniform float uDisperse;
      uniform vec3 uLightDir;
      uniform vec4 uFloorRect;
      uniform float uGridN;
      uniform vec4 uCausRect;
      ${LIGHT_VIEW_GLSL}
      flat varying float vK;
      varying vec3 vOld;
      varying vec3 vNew;
      varying float vValid;
      varying vec3 vRestA;
      varying vec3 vRestB;
      varying float vPath;
      varying float vNdL;
      varying float vTemp;
      // where a world point sits in the light's view (its texture's uv)
      vec2 lightUV(vec3 q) {
        vec4 c = uLightVP * vec4(q, 1.0);
        return c.xy / c.w * 0.5 + 0.5;
      }
      // is q inside the jelly? between the near and far surfaces the light
      // sees along its line there (Ld: the way the light goes)
      bool inJelly(vec3 q, vec3 Ld) {
        vec2 u = lightUV(q);
        if (any(lessThan(u, vec2(0.0))) || any(greaterThan(u, vec2(1.0)))) return false;
        vec4 Eq = textureLod(tEntry, u, 0.0), Xq = textureLod(tExit, u, 0.0);
        if (Eq.w < 0.5 || Xq.w < 0.5) return false;
        float d = dot(q - uOrigin, Ld);
        return d >= dot(Eq.xyz, Ld) - 0.002 && d <= dot(Xq.xyz, Ld);
      }
      // where a ray inside, from p along d, comes out: stepped (len: about
      // how far it goes), then the crossing narrowed down
      vec3 marchOut(vec3 p, vec3 d, float len, vec3 Ld) {
        float ds = len / 8.0;
        vec3 a = p, b = p + d * (ds * 16.0);
        for (int s = 1; s <= 16; s++) {
          vec3 q = p + d * (ds * float(s));
          if (!inJelly(q, Ld)) { b = q; break; }
          a = q;
        }
        for (int s = 0; s < 6; s++) {
          vec3 q = (a + b) * 0.5;
          if (inJelly(q, Ld)) a = q; else b = q;
        }
        return (a + b) * 0.5;
      }
      // the far side's outward normal there (smoothed a little, as the
      // entry's: the mesh's facets shouldn't each draw a line of light)
      vec3 exitNormal(vec3 q) {
        vec2 u = lightUV(q), tx = 2.0 / vec2(textureSize(tExitN, 0));
        vec3 n = vec3(0.0);
        for (int dy = -1; dy <= 1; dy++)
          for (int dx = -1; dx <= 1; dx++) {
            vec4 t = textureLod(tExitN, u + vec2(dx, dy) * tx, 0.0);
            if (t.w > 0.5) n += t.xyz * (dx == 0 && dy == 0 ? 2.0 : 1.0);
          }
        return dot(n, n) > 1e-8 ? normalize(n) : vec3(0.0, -1.0, 0.0);
      }
      void main() {
        // (grid point i reads texel (i * step) exactly: an uneven pick of
        // texels shows up as stripes)
        ivec2 sz = textureSize(tEntry, 0);
        int stp = max(1, sz.x / int(uGridN));
        ivec2 ij = clamp(ivec2(floor(uv * (uGridN - 1.0) + 0.5)) * stp, ivec2(0), sz - 1);
        vec2 tuv = (vec2(ij) + 0.5) / vec2(sz);
        vec4 E = texelFetch(tEntry, ij, 0);
        vec3 Ld = -normalize(uLightDir);
        vec3 P, F;
        if (E.w < 0.5) {
          // (this ray misses the jelly: it lands on the floor unbent, and
          // adds nothing - it only keeps the grid's cells small)
          vec4 p0 = uLightInvVP * vec4(tuv * 2.0 - 1.0, -1.0, 1.0);
          P = p0.xyz / p0.w;
          F = P + Ld * (-P.y / Ld.y);
          vOld = F;
          vNew = F;
          vValid = 0.0;
          vRestA = vec3(0.0);
          vRestB = vec3(0.0);
          vPath = 0.0;
          vNdL = 1.0;
          vTemp = 0.0;
          vK = 0.0;
        } else {
          P = E.xyz + uOrigin;
          // (the cube it goes into: its own refraction, colour, haze)
          float kA = lightViewCube(E.w);
          vK = kA;
          float ior = max(1.0001, texelFetch(uCubeTex, ivec2(2, int(kA)), 0).z);
          // (dispersion: red bent least, blue most - the jelly's own spread, a
          // little more of it, so the caustics' edges split into colours)
          if (uChannel >= 0.0) ior += (uChannel - 1.0) * uDisperse * texelFetch(uCubeTex, ivec2(2, int(kA)), 0).w;
          vec4 Nt = texelFetch(tNormal, ij, 0);
          // the normal smoothed over ~2 cm (the mesh's normals bend only at
          // its triangle edges, and caustics are all about how the normal
          // bends: unsmoothed, every edge draws a line of light)
          vec3 Ns = vec3(0.0);
          for (int dy = -2; dy <= 2; dy++)
            for (int dx = -2; dx <= 2; dx++) {
              ivec2 q = clamp(ij + ivec2(dx, dy) * stp, ivec2(0), sz - 1);
              if (texelFetch(tEntry, q, 0).w > 0.5) Ns += texelFetch(tNormal, q, 0).xyz * (3.0 - 0.5 * float(abs(dx) + abs(dy)));
            }
          // (no usable normal: as if the ray missed)
          float nl = dot(Ns, Ns);
          vec3 N = nl > 1e-12 ? Ns * inversesqrt(nl) : vec3(0.0, 1.0, 0.0);
          vec4 X = texelFetch(tExit, ij, 0);
          vec3 r = refract(Ld, N, 1.0 / ior);
          if (dot(r, r) < 1e-6) r = Ld;
          // Through it, to where it comes out (marched along the bent ray in
          // the light's view: past the far side there, or off its edge, it's
          // out), and bent again there by the far side - out through the
          // bottom it goes back to the light's slant, out through a side
          // it's thrown wide (all the more so up in the air, or squashed).
          float th = X.w > 0.5 ? max(dot(X.xyz - E.xyz, Ld), 0.01) : 0.05;
          vec3 Q = marchOut(P, r, th / max(dot(r, Ld), 0.3), Ld);
          vec3 n1 = exitNormal(Q);
          if (dot(r, n1) < 0.0) n1 = -n1; // (a ray going out goes out through it)
          vec3 r2 = refract(r, -n1, ior);
          vec2 xuv = lightUV(Q);
          float tOut;
          if (dot(r2, r2) > 1e-6) {
            F = Q + r2 * (max(Q.y, 0.0) / -min(r2.y, -0.06));
            // (its colour deepens with the way through the jelly - only that)
            vPath = length(Q - P);
            // (what the far side lets out - none at all just short of the
            // angle that keeps it in - and light thrown upward never lands)
            float ct = max(dot(r2, n1), 0.0), F0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
            tOut = (1.0 - (F0 + (1.0 - F0) * pow(1.0 - ct, 5.0))) * (1.0 - smoothstep(-0.06, 0.0, r2.y));
          } else {
            // Too steep to get out there (total internal reflection - from
            // the top, at a side, nearly always): it bounces round inside and
            // gets out somewhere, the light of a soft, uneven, slightly hazy
            // jelly. Drawn going on as it was, to the floor - the glow
            // through the shadow - a little dimmer.
            float t = max(P.y, 0.0) / -min(r.y, -0.08);
            F = P + r * t;
            vPath = t;
            tOut = 0.85;
            xuv = tuv;
          }
          // (light that only grazes the jelly's foot lands right where it
          // went in - in the contact shadow - not as a white spark)
          vValid = (nl > 1e-12 ? smoothstep(0.0, 0.05, P.y) : 0.0) * tOut;
          vOld = P + Ld * (-P.y / Ld.y);
          vNew = F;
          vRestA = texelFetch(tEntryRest, ij, 0).xyz;
          vec4 RB = textureLod(tExitRest, xuv, 0.0);
          vRestB = RB.w > 0.5 ? RB.xyz : vRestA;
          vNdL = dot(N, normalize(uLightDir));
          vTemp = Nt.w;
        }
        vec2 cuv = (F.xz - uCausRect.xy) * uCausRect.zw;
        gl_Position = vec4(cuv * 2.0 - 1.0, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${CUBE_GLSL}
      uniform float uChannel;
      flat varying float vK;
      varying vec3 vOld;
      varying vec3 vNew;
      varying float vValid;
      varying vec3 vRestA;
      varying vec3 vRestB;
      varying float vPath;
      varying float vNdL;
      varying float vTemp;
      void main() {
        // (only cells whose rays all went through the jelly)
        if (!(vValid >= 0.01) || !(vNdL > 0.0)) discard; // (NaN-safe)
        useCube(vK);
        vec4 q0 = cubeT(0);
        float ior = max(1.0001, cubeT(2).z), scatter = cubeT(27).a;
        float oldA = length(dFdx(vOld)) * length(dFdy(vOld));
        float newA = length(dFdx(vNew)) * length(dFdy(vNew));
        // focusing (capped: a cell squeezed to nothing would be a spike)
        float ratio = clamp(oldA / max(newA, 1e-9), 0.0, 3.5);
        float F0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
        float Ft = 1.0 - (F0 + (1.0 - F0) * pow(clamp(1.0 - vNdL, 0.0, 1.0), 5.0));
        vec3 sig = cGradPath(vRestA, vRestB, q0.rgb);
        vec3 T = exp(-sig * vPath) * exp(-scatter * vPath * 0.7);
        // frosted jelly scatters light: no sharp caustics
        T *= 1.0 - 0.9 * smoothstep(0.05, 0.6, -vTemp);
        vec3 c = T * ratio * Ft * vValid;
        if (uChannel >= 0.0) c *= vec3(uChannel < 0.5 ? 1.0 : 0.0, abs(uChannel - 1.0) < 0.5 ? 1.0 : 0.0, uChannel > 1.5 ? 1.0 : 0.0);
        bvec3 bad = equal(floatBitsToUint(c) & uvec3(0x7f800000u), uvec3(0x7f800000u));
        // (alpha: this light came through layers - the floor takes its
        // shadow's colour from it there, band by band)
        gl_FragColor = vec4(any(bad) ? vec3(0.0) : min(c, vec3(8.0)), cLayers > 0 && (uChannel < 0.0 || abs(uChannel - 1.0) < 0.5) ? 1.0 : 0.0);
      }`,
  });
}

// The jelly mirrored in the floor (drawn upside down below it, for the
// floor to sample - see JellyView.renderReflection): its colour as it looks
// (in glow mode, as it shines), the reflection fading with height above the
// floor. No refraction: it's soft and dim, nobody can tell.
export function createReflectMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.FrontSide,
    uniforms: {
      uCubeTex: { value: null },
      uGradTex: { value: null },
      uFreeTex: { value: null },
      uEmit: { value: 0 },
      uFade: { value: 2.6 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aRest;
      attribute vec4 aData;
      attribute float aCube;
      varying vec3 vRest;
      varying vec3 vN;
      varying vec3 vW;
      varying float vGlow;
      varying float vCube;
      void main() {
        vCube = aCube;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vN = mat3(modelMatrix) * normal;
        vRest = aRest;
        vGlow = aData.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uEmit;
      uniform float uFade;
      varying vec3 vRest;
      varying vec3 vN;
      varying vec3 vW;
      varying float vGlow;
      varying float vCube;
      ${CUBE_GLSL}
      ${SAFE_GLSL}
      void main() {
        // (mirrored: -y is how high the real point is above the floor)
        float h = max(-vW.y, 0.0);
        float fade = exp(-h * uFade);
        useCube(vCube);
        vec4 q1 = cubeT(1);
        vec3 sc = cScatterAt(vRest, q1.rgb);
        sc = mix(sc, mix(sc, vec3(1.0), 0.45), max(cubeT(3).y, q1.a));
        vec3 V = safeNormalize(cameraPosition - vW);
        float rim = pow(clamp(1.0 - abs(dot(safeNormalize(vN), V)), 0.0, 1.0), 2.0);
        vec3 c = sc * mix(0.42 + 0.3 * rim, 0.85 + 0.5 * rim, uEmit) + vec3(1.0, 0.9, 0.75) * vGlow * 0.6;
        gl_FragColor = finite4(vec4(c * fade, fade));
      }`,
  });
}

// Glow mode: the light the jelly casts on the floor, seen from above - each
// bit of its surface in its own colour (a rainbow lying on its side lights
// the floor in bands), weighted by how near the floor it is. Summed, then
// blurred by the floor through the mip levels (see floor.js).
export function createGlowMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uCubeTex: { value: null },
      uGradTex: { value: null },
      uFreeTex: { value: null },
      uFloorRect: { value: new THREE.Vector4(-3, -3, 1 / 6, 1 / 6) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aRest;
      attribute float aCube;
      uniform vec4 uFloorRect;
      varying float vH;
      varying vec3 vRest;
      varying float vCube;
      void main() {
        vCube = aCube;
        vH = position.y;
        vRest = aRest;
        vec2 uv = (position.xz - uFloorRect.xy) * uFloorRect.zw;
        gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vH;
      varying vec3 vRest;
      varying float vCube;
      ${CUBE_GLSL}
      ${SAFE_GLSL}
      void main() {
        float w = exp(-max(vH, 0.0) * 5.0);
        useCube(vCube);
        vec4 q1 = cubeT(1);
        vec3 sc = cScatterAt(vRest, q1.rgb);
        sc = mix(sc, mix(sc, vec3(1.0), 0.45), max(cubeT(3).y, q1.a));
        gl_FragColor = finite4(vec4(sc * w, w));
      }`,
  });
}

// Straight shadow footprint along the light (where direct light is blocked).
export function createMaskMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uLightDir: { value: new THREE.Vector3(-0.45, 0.8, 0.4).normalize() },
      uFloorRect: { value: new THREE.Vector4(-3, -3, 1 / 6, 1 / 6) },
    },
    vertexShader: /* glsl */ `
      uniform vec3 uLightDir;
      uniform vec4 uFloorRect;
      varying float vD;
      void main() {
        vec3 Ld = -normalize(uLightDir);
        vec3 P = position;
        vec3 oldP = P + Ld * (-P.y / Ld.y);
        vD = max(P.y, 0.0) / max(-Ld.y, 0.05);
        vec2 uv = (oldP.xz - uFloorRect.xy) * uFloorRect.zw;
        gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vD;
      // r: shadow; b: how near the floor the jelly casting it is, along the
      // light (1 - distance / 4 m: MAX keeps the nearest, and it averages
      // straight - the floor blurs the shadow's edge by it, see floor.js)
      void main() { gl_FragColor = vec4(1.0, 0.0, 1.0 - clamp(vD * 0.25, 0.0, 1.0), 1.0); }`,
  });
}

// The colour each cube gives the light through it, laid on the floor where
// its shadow falls (along the light, like the mask). Added up with a weight
// (every surface over a spot: a cube's top and bottom both count), so the
// floor reads sum / weight - and where two shadows overlap, they mix.
export function createTintMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uCubeTex: { value: null },
      uGradTex: { value: null },
      uFreeTex: { value: null },
      uLightDir: { value: new THREE.Vector3(-0.45, 0.8, 0.4).normalize() },
      uFloorRect: { value: new THREE.Vector4(-3, -3, 1 / 6, 1 / 6) },
    },
    vertexShader: /* glsl */ `
      attribute float aCube;
      attribute vec3 aRest;
      uniform vec3 uLightDir;
      uniform vec4 uFloorRect;
      varying float vCube;
      varying vec3 vRest;
      void main() {
        vec3 Ld = -normalize(uLightDir);
        vec3 P = position;
        vec3 oldP = P + Ld * (-P.y / Ld.y);
        vCube = aCube;
        vRest = aRest;
        vec2 uv = (oldP.xz - uFloorRect.xy) * uFloorRect.zw;
        gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vCube;
      varying vec3 vRest;
      ${CUBE_GLSL}
      void main() {
        useCube(vCube);
        vec3 t = cubeT(27).rgb;
        // (Rubik: each sticker's own colour - a mosaic of a shadow)
        if (cLayers < 0) {
          int k = rubikAt(vRest);
          vec4 a = cubeT(7 + k);
          float cloud = max(cubeT(3).y + a.a, cubeT(1).a);
          t = mix(exp(-a.rgb * 0.35), vec3(1.0), 0.35 * cloud) * (1.0 - 0.35 * cloud);
        }
        gl_FragColor = vec4(t, 1.0);
      }`,
  });
}

// Height of the lowest jelly surface above each floor texel (contact AO).
export function createHeightMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uFloorRect: { value: new THREE.Vector4(-3, -3, 1 / 6, 1 / 6) },
    },
    vertexShader: /* glsl */ `
      uniform vec4 uFloorRect;
      varying float vH;
      void main() {
        vH = position.y;
        vec2 uv = (position.xz - uFloorRect.xy) * uFloorRect.zw;
        gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vH;
      // store "closeness" so MAX blending keeps the lowest surface
      void main() { gl_FragColor = vec4(0.0, exp(-max(vH, 0.0) * 9.0), 0.0, 1.0); }`,
  });
}

export function absorptionFromColor(color, refThickness = 0.9, out = new THREE.Vector3()) {
  const c = [color.r, color.g, color.b].map((v) => Math.min(Math.max(v, 0.004), 0.995));
  out.set(-Math.log(c[0]) / refThickness, -Math.log(c[1]) / refThickness, -Math.log(c[2]) / refThickness);
  return out;
}
