import * as THREE from 'three';

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
  attribute float aWeld;
  attribute float aCube;
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

// Back faces: linear view depth, packed view-space exit normal, exit rest height.
export function createBackMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec3 vViewPos;
      varying vec3 vRest;
      varying vec4 vData;
      ${OCT}
      ${SAFE_GLSL}
      void main() {
        vec3 vn = safeNormalize((viewMatrix * vec4(safeNormalize(vNormal), 0.0)).xyz);
        gl_FragColor = finite4(vec4(-vViewPos.z, octEncode(vn), vRest.y));
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
      uGlow: { value: 0.5 },
      uHazeMin: { value: 0 },
      tScene: { value: null },
      tBack: { value: null },
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
      varying float vWeld;
      ${NOISE}
      ${OCT}
      ${LAYER_GLSL}

      // Each cube's own look (several cubes: see JellyView.setCubeLook), a
      // row of uCubeTex per cube: its colour, haze, glow, gloss, refraction,
      // sugar, milk, finishes and its layers.
      uniform highp sampler2D uCubeTex;
      varying float vCube;
      int gK = 0;
      int cLayers = 0;
      float cLY0 = 0.0, cLSpan = 1.0, cLRep = 1.0, cLExp = 1.0, cLBlur = 0.0;
      vec4 cubeT(int x) { return texelFetch(uCubeTex, ivec2(x, gK), 0); }
      void cLayerPair(float y, out int a, out int b, out float s) {
        float n = float(cLayers), m = n * cLRep;
        float h = pow(max(clamp((y - cLY0) / cLSpan, 0.0, 1.0), 1e-6), cLExp);
        float f = h * m - 0.5;
        float i0 = floor(f);
        float w = max(cLBlur * 0.5, 0.012);
        s = smoothstep(0.5 - w, 0.5 + w, f - i0);
        a = int(mod(clamp(i0, 0.0, m - 1.0), n));
        b = int(mod(clamp(i0 + 1.0, 0.0, m - 1.0), n));
      }
      vec3 cSigmaAt(float y) {
        int a, b; float s;
        cLayerPair(y, a, b, s);
        return mix(cubeT(7 + a).rgb, cubeT(7 + b).rgb, s);
      }
      vec3 cLayerSigma(float ya, float yb, vec3 base) {
        if (cLayers == 0) return base;
        if (abs(yb - ya) < 1e-3) return cSigmaAt(ya);
        vec3 acc = vec3(0.0);
        for (int k = 0; k < 16; k++) acc += cSigmaAt(mix(ya, yb, (float(k) + 0.5) / 16.0));
        return acc * 0.0625;
      }
      vec3 cLayerScatter(float y, vec3 base) {
        if (cLayers == 0) return base;
        int a, b; float s;
        cLayerPair(y, a, b, s);
        return mix(cubeT(17 + a).rgb, cubeT(17 + b).rgb, s);
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
        vec3 caus = vec3(0.0), glowF = vec3(0.0);
        float lod = 1.0 + 4.0 * rough;
        if (all(greaterThan(fuv, vec2(0.0))) && all(lessThan(fuv, vec2(1.0)))) {
          vec2 cuv = (xz - uCausRect.xy) * uCausRect.zw;
          if (all(greaterThan(cuv, vec2(0.0))) && all(lessThan(cuv, vec2(1.0)))) caus = textureLod(tCaustic, cuv, lod + 1.0).rgb;
          vec4 fx = textureLod(tFloorFx, fuv, lod + uFxLodBias);
          mask = fx.r;
          contact = fx.g;
        }
        vec2 guv = (xz - uGlowRect.xy) * uGlowRect.zw;
        if (uGlowFloor > 0.0 && all(greaterThan(guv, vec2(0.0))) && all(lessThan(guv, vec2(1.0))))
          glowF = textureLod(tGlowMap, guv, 1.5).rgb * 0.7 + textureLod(tGlowMap, guv, 3.5).rgb * 0.9;
        vec3 transfer = vec3(1.0 - mask) + caus * uCausGain + uTint * mask * 0.22;
        vec3 direct = uLightColor * max(normalize(uLightDir).y, 0.0) * 0.3183 * transfer * (1.0 - contact * 0.2);
        vec3 sky = textureLod(envMap, vec3(0.0, 1.0, 0.0), envMaxLod).rgb * uFloorEnv
          * mix(vec3(1.0), uTint * 1.1, mask * 0.68) * (1.0 - contact * 0.35);
        vec3 c = uFloorAlbedo * (direct + sky) + glowF * uGlowFloor;
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
        // (this cube's look)
        gK = int(vCube + 0.5);
        vec4 cq0 = cubeT(0), cq1 = cubeT(1), cq2 = cubeT(2), cq3 = cubeT(3), cq4 = cubeT(4), cq5 = cubeT(5), cq6 = cubeT(6);
        vec3 cAbsorb = cq0.rgb, cScatterColor = cq1.rgb, cGlowColor = cq6.rgb;
        float cScatter = cq0.a, cHazeMin = cq1.a, cGlow = cq2.x, cRough = cq2.y, cIor = cq2.z, cDisp = cq2.w;
        float cSugar = cq3.x, cMilk = cq3.y, cIrid = cq3.z, cMetal = cq3.w, cOpal = cq4.x;
        cLayers = int(cq4.y + 0.5);
        cLY0 = cq4.z; cLSpan = cq4.w; cLRep = cq5.x; cLExp = cq5.y; cLBlur = cq5.z;
        float temp = vData.x;
        float glow = vData.y;
        float fresh = vData.z;
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
        // sugar coating (sour gummies): only on the moulded outside
        float coat = cSugar * (1.0 - fresh) * (1.0 - cavity);
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
        float exitY = back.r > 0.0 ? back.a : vRest.y;

        float rough = clamp(cRough + fresh * 0.02 + frost * 0.5 - melt * 0.02 + coat * 0.18, 0.015, 1.0);
        // (specular anti-aliasing: where the surface turns faster than a
        // pixel can show - bevels and corners, on a small or low-resolution
        // screen - its reflections blur as if it were rougher, instead of the
        // studio's softboxes breaking up into stair-stepped, pointy shards)
        vec3 dNx = dFdx(vNormal), dNy = dFdy(vNormal);
        float a2 = rough * rough * rough * rough + min(0.5 * (dot(dNx, dNx) + dot(dNy, dNy)), 0.18);
        rough = max(rough, sqrt(sqrt(min(a2, 1.0))));
        float lod = clamp(rough * 9.0 + frost * 2.5 + thick * 1.6, 0.0, uSceneLodMax);

        vec3 trans;
        trans.r = sampleThrough(Pw, V, N, Nb, thick, cIor - disp, lod, rough, 0).r;
        trans.g = sampleThrough(Pw, V, N, Nb, thick, cIor, lod, rough, 1).g;
        trans.b = sampleThrough(Pw, V, N, Nb, thick, cIor + disp, lod, rough, 2).b;

        float pathLen = thick + 0.2 * rim * rim;
        // layered: lean toward the layer you look into, so bands stay crisp
        vec3 sigma = cLayers > 0 ? mix(cLayerSigma(Rp.y, Rp.y, cAbsorb), cLayerSigma(Rp.y, exitY, cAbsorb), 0.22) : cAbsorb;
        vec3 Tr = exp(-sigma * pathLen * (1.0 + melt * 0.35));
        float haze = 1.0 - exp(-(cScatter + cMilk * 7.0 + frost * 2.5) * pathLen);
        haze = max(haze, max(cMilk * 0.72, cHazeMin));

        vec3 L = normalize(uLightDir);
        float NdL = dot(N, L);
        float wrap = max((NdL + 0.7) / 1.7, 0.0);
        vec3 irr = envLookup(N, 1.0);
        float backlit = pow(clamp(dot(V, -L), 0.0, 1.0), 3.0);
        vec3 baseSc = cLayers > 0 ? mix(cLayerScatter(Rp.y, cScatterColor), cLayerScatter(exitY, cScatterColor), 0.25) : cScatterColor;
        // creamy jelly: pastel, milky body colour
        baseSc = mix(baseSc, mix(baseSc, vec3(1.0), 0.45) * 1.05, cMilk);
        vec3 sc = mix(baseSc, vec3(0.92, 0.96, 1.0), frost * 0.85);
        // light that scattered inside the body (thin regions glow more brightly)
        // translucency: how much light glows through (and how deep it reaches)
        vec3 scatterLight = sc * (irr * 0.55 + uLightColor * (wrap * 0.22 + backlit * (0.25 + 0.5 * cGlow)))
          * (0.2 + 1.6 * cGlow) * (0.55 + 0.45 * exp(-pathLen * mix(3.0, 0.45, cGlow)));

        vec3 body = trans * Tr * (1.0 - haze) + scatterLight * haze;

        float F0 = pow((cIor - 1.0) / (cIor + 1.0), 2.0);
        float F = min(F0 + (1.0 - F0) * pow(clamp(1.0 - NdV, 0.0, 1.0), 5.0), 1.0 - 0.5 * rim);
        vec3 Rv = reflect(-V, N);
        vec3 refl = envLookup(Rv, rough);
        // below the horizon it mirrors the real floor where that ray lands -
        // the jelly's own coloured shadow and caustics, its glow pool - not
        // the studio map's flat grey (which beside a strong colour reads as
        // its opposite: red edges looked green)
        if (Rv.y < 0.0) {
          vec3 H = Pw + Rv * (max(Pw.y, 0.0) / max(-Rv.y, 1e-3));
          refl = mix(refl, floorAt(H.xz, rough) * envIntensity, 1.0 - smoothstep(-0.12, 0.0, Rv.y));
        }

        vec3 H = normalize(L + V);
        float NdH = max(dot(N, H), 0.0);
        float a = max(rough * rough, 0.0012);
        float nl = max(NdL, 0.0);
        float Fh = F0 + (1.0 - F0) * pow(clamp(1.0 - dot(H, V), 0.0, 1.0), 5.0);
        // (capped: a glassy highlight seen dead on can top half-float range)
        vec3 spec = min(uLightColor * D_GGX(NdH, a) * V_Smith(nl, NdV, a) * nl * Fh, vec3(48.0));

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

        vec3 col = body * (1.0 - F) + refl * F + spec;

        // Metal: a mirror tinted by its own colour (cherry: red chrome; lemon:
        // gold), no light through it, its edges going white (Schlick, with
        // the colour as F0) - iridescent too, for holographic foil
        if (cMetal > 0.0) {
          vec3 F0m = mix(baseSc * 0.92, vec3(0.94), 0.14);
          vec3 Fm = F0m + (vec3(1.0) - F0m) * pow(clamp(1.0 - NdV, 0.0, 1.0), 5.0);
          vec3 FmH = F0m + (vec3(1.0) - F0m) * pow(clamp(1.0 - dot(H, V), 0.0, 1.0), 5.0);
          vec3 specM = min(uLightColor * D_GGX(NdH, a) * V_Smith(nl, NdV, a) * nl * FmH, vec3(48.0)) * iriSpec;
          // (chrome reads by its contrast: the studio's bright boxes against a
          // darker room, the floor and the horizon below - a mirror in an
          // evenly lit room just looks white)
          float lumR = dot(refl, vec3(0.2126, 0.7152, 0.0722));
          vec3 reflC = mix(refl, refl * (0.2 + 1.4 * smoothstep(0.35, 1.6, lumR)) * (0.45 + 0.55 * smoothstep(-0.06, 0.3, Rv.y)), 1.0 - 0.75 * cIrid);
          vec3 colM = reflC * Fm * 1.1 + specM + irr * baseSc * 0.05 * rough;
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
          col += fire * (irr * 0.8 + uLightColor * (0.18 + 0.3 * nl) + cGlowColor * uEmit * 1.6) * cOpal * (1.0 - F) * 1.5;
        }

        // Glow mode: it gives off its own light, from all of its body -
        // brighter through more of it, towards a hotter, paler core. A knock
        // sends a ring of light racing out through it from where it landed.
        vec3 emLit = vec3(0.0);
        if (uEmit > 0.0) {
          float deep = 1.0 - exp(-pathLen * 1.8);
          // its colour just inside the surface: in layered jelly the light
          // from the layers further in is mostly absorbed on the way out
          // (mixing in theirs turns a rainbow's middle to white)
          vec3 scE = sc;
          if (cLayers > 0) {
            scE = cLayerScatter(mix(Rp.y, exitY, 0.12), cScatterColor);
            scE = mix(scE, mix(scE, vec3(1.0), 0.45) * 1.05, cMilk);
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
          vec3 sugarCol = mix(vec3(1.0), sc, 0.18) * (irr * 0.62 + uLightColor * (max(dot(cn, L), 0.0) * 0.45 + 0.1)) * (0.8 + 0.3 * w.y)
            + emLit * 0.6; // (in glow mode the grains scatter its light)
          col = mix(col, sugarCol + uLightColor * glint, grain * coat * 0.9);
          // fine dusting between the grains
          col = mix(col, mix(vec3(1.0), sc, 0.4) * (irr * 0.5 + uLightColor * nl * 0.3), coat * 0.14 * (1.0 - grain));
        }

        // frost layer: white crystalline film with sparkles
        if (frost > 0.0) {
          float crystal = fbm3(vRest * 55.0);
          float sparkle = pow(max(vnoise(vRest * 160.0 + floor(uTime * 0.0)), 0.0), 18.0) * 30.0 * nl;
          vec3 frostCol = vec3(0.86, 0.92, 1.0) * (irr * 0.75 + uLightColor * (nl * 0.5 + 0.15)) * (0.7 + 0.5 * crystal)
            + emLit * (0.4 + 0.25 * crystal); // (lit from inside, in glow mode)
          col = mix(col, frostCol + sparkle, frost * (0.35 + 0.4 * crystal));
        }

        // (deep in a hollow a little less of the room's light gets in; its
        // rim, a crisp edge, catches it)
        col *= 1.0 - 0.12 * cavity * cavDeep;
        col += (irr * 0.35 + uLightColor * 0.12) * cavity * smoothstep(0.82, 1.0, 1.0 - cavDeep) * 0.6;

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
            vec3 charCol = vec3(0.042, 0.017, 0.011) * (irr * 0.6 + uLightColor * nl * 0.45) + spec * 0.5;
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
      varying vec3 vW;
      varying vec3 vN;
      varying float vRestY;
      varying float vTemp;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vN = mat3(modelMatrix) * normal;
        vRestY = aRest.y;
        vTemp = aData.x;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uOrigin;
      varying vec3 vW;
      varying vec3 vN;
      varying float vRestY;
      varying float vTemp;
      ${SAFE_GLSL}
      void main() {
        ${kind === 1 ? 'gl_FragColor = finite4(vec4(safeNormalize(vN), vTemp));' : 'gl_FragColor = finite4(vec4(vW - uOrigin, vRestY + 10.0));'}
      }`,
  });
}

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
      ...layerUniforms,
      uLightDir: { value: new THREE.Vector3(-0.45, 0.8, 0.4).normalize() },
      uIor: { value: 1.36 },
      uAbsorb: { value: new THREE.Vector3(0.2, 2.4, 2.0) },
      uScatter: { value: 0.35 },
      uFloorRect: { value: new THREE.Vector4(-3, -3, 1 / 6, 1 / 6) },
      tEntry: { value: null },
      tNormal: { value: null },
      tExit: { value: null },
      uOrigin: { value: new THREE.Vector3() },
      uLightInvVP: { value: new THREE.Matrix4() },
      uGridN: { value: 256 },
      uCausRect: { value: new THREE.Vector4(-3, -3, 1 / 6, 1 / 6) },
    },
    vertexShader: /* glsl */ `
      uniform sampler2D tEntry;
      uniform sampler2D tNormal;
      uniform sampler2D tExit;
      uniform vec3 uOrigin;
      uniform mat4 uLightInvVP;
      uniform vec3 uLightDir;
      uniform float uIor;
      uniform vec4 uFloorRect;
      uniform float uGridN;
      uniform vec4 uCausRect;
      varying vec3 vOld;
      varying vec3 vNew;
      varying float vValid;
      varying float vRestA;
      varying float vRestB;
      varying float vPath;
      varying float vNdL;
      varying float vTemp;
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
          vRestA = 0.0;
          vRestB = 0.0;
          vPath = 0.0;
          vNdL = 1.0;
          vTemp = 0.0;
        } else {
          P = E.xyz + uOrigin;
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
          vec3 r = refract(Ld, N, 1.0 / uIor);
          if (dot(r, r) < 1e-6) r = Ld;
          float t = max(P.y, 0.0) / -min(r.y, -0.08);
          F = P + r * t;
          // (its colour deepens with the way from where it enters to the
          // floor, as before: the light leaving through a side isn't bent
          // again here, so a short way through would be pale in the wrong
          // place; the layers it crosses are the ones between where it
          // enters and where it leaves)
          vPath = t;
          // (light that only grazes the jelly's foot lands right where it
          // went in - in the contact shadow - not as a white spark)
          vValid = nl > 1e-12 ? smoothstep(0.0, 0.05, P.y) : 0.0;
          vOld = P + Ld * (-P.y / Ld.y);
          vNew = F;
          vRestA = E.w - 10.0;
          vRestB = X.w > 0.5 ? X.w - 10.0 : vRestA;
          vNdL = dot(N, normalize(uLightDir));
          vTemp = Nt.w;
        }
        vec2 cuv = (F.xz - uCausRect.xy) * uCausRect.zw;
        gl_Position = vec4(cuv * 2.0 - 1.0, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uAbsorb;
      uniform float uScatter;
      uniform float uIor;
      ${LAYER_GLSL}
      varying vec3 vOld;
      varying vec3 vNew;
      varying float vValid;
      varying float vRestA;
      varying float vRestB;
      varying float vPath;
      varying float vNdL;
      varying float vTemp;
      void main() {
        // (only cells whose rays all went through the jelly)
        if (!(vValid >= 0.01) || !(vNdL > 0.0)) discard; // (NaN-safe)
        float oldA = length(dFdx(vOld)) * length(dFdy(vOld));
        float newA = length(dFdx(vNew)) * length(dFdy(vNew));
        // focusing (capped: a cell squeezed to nothing would be a spike)
        float ratio = clamp(oldA / max(newA, 1e-9), 0.0, 3.5);
        float F0 = pow((uIor - 1.0) / (uIor + 1.0), 2.0);
        float Ft = 1.0 - (F0 + (1.0 - F0) * pow(clamp(1.0 - vNdL, 0.0, 1.0), 5.0));
        vec3 sig = layerSigma(vRestA, vRestB, uAbsorb);
        vec3 T = exp(-sig * vPath) * exp(-uScatter * vPath * 0.7);
        // frosted jelly scatters light: no sharp caustics
        T *= 1.0 - 0.9 * smoothstep(0.05, 0.6, -vTemp);
        vec3 c = T * ratio * Ft * vValid;
        bvec3 bad = equal(floatBitsToUint(c) & uvec3(0x7f800000u), uvec3(0x7f800000u));
        gl_FragColor = vec4(any(bad) ? vec3(0.0) : min(c, vec3(8.0)), 1.0);
      }`,
  });
}

// The jelly mirrored in the floor (drawn upside down below it, for the
// floor to sample - see JellyView.renderReflection): its colour as it looks
// (in glow mode, as it shines), the reflection fading with height above the
// floor. No refraction: it's soft and dim, nobody can tell.
export function createReflectMaterial(layerUniforms) {
  return new THREE.ShaderMaterial({
    side: THREE.FrontSide,
    uniforms: {
      ...layerUniforms,
      uScatterColor: { value: new THREE.Color(1, 0.3, 0.3) },
      uEmit: { value: 0 },
      uMilk: { value: 0 },
      uFade: { value: 2.6 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aRest;
      attribute vec4 aData;
      varying vec3 vRest;
      varying vec3 vN;
      varying vec3 vW;
      varying float vGlow;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vN = mat3(modelMatrix) * normal;
        vRest = aRest;
        vGlow = aData.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uScatterColor;
      uniform float uEmit;
      uniform float uMilk;
      uniform float uFade;
      varying vec3 vRest;
      varying vec3 vN;
      varying vec3 vW;
      varying float vGlow;
      ${LAYER_GLSL}
      ${SAFE_GLSL}
      void main() {
        // (mirrored: -y is how high the real point is above the floor)
        float h = max(-vW.y, 0.0);
        float fade = exp(-h * uFade);
        vec3 sc = layerScatter(vRest.y, uScatterColor);
        sc = mix(sc, mix(sc, vec3(1.0), 0.45), uMilk);
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
export function createGlowMaterial(layerUniforms, scatterColor, milk) {
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
      ...layerUniforms,
      uScatterColor: scatterColor,
      uMilk: milk,
      uFloorRect: { value: new THREE.Vector4(-3, -3, 1 / 6, 1 / 6) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aRest;
      uniform vec4 uFloorRect;
      varying float vH;
      varying vec3 vRest;
      void main() {
        vH = position.y;
        vRest = aRest;
        vec2 uv = (position.xz - uFloorRect.xy) * uFloorRect.zw;
        gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uScatterColor;
      uniform float uMilk;
      varying float vH;
      varying vec3 vRest;
      ${LAYER_GLSL}
      ${SAFE_GLSL}
      void main() {
        float w = exp(-max(vH, 0.0) * 5.0);
        vec3 sc = layerScatter(vRest.y, uScatterColor);
        sc = mix(sc, mix(sc, vec3(1.0), 0.45), uMilk);
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
      varying float vH;
      void main() {
        vec3 Ld = -normalize(uLightDir);
        vec3 P = position;
        vec3 oldP = P + Ld * (-P.y / Ld.y);
        vH = P.y;
        vec2 uv = (oldP.xz - uFloorRect.xy) * uFloorRect.zw;
        gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vH;
      void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }`,
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
