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
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vViewPos;
  varying vec3 vRest;
  varying vec4 vData;
  varying float vWeld;
  void main() {
    vWeld = aWeld;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
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
      void main() {
        vec3 vn = normalize((viewMatrix * vec4(normalize(vNormal), 0.0)).xyz);
        gl_FragColor = vec4(-vViewPos.z, octEncode(vn), vRest.y);
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

      float sq(float x) { return x * x; }
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
        float coat = uSugar * (1.0 - fresh) * (1.0 - cavity);
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
        float disp = uDispersion * (1.0 - rim);

        vec2 uv = gl_FragCoord.xy / resolution;
        vec4 back = texture(tBack, uv);
        float frontDepth = cavity > 0.5 ? -(viewMatrix * vec4(Pw, 1.0)).z : -vViewPos.z;
        float thick = back.r > 0.0 ? clamp(back.r - frontDepth, 0.0, 4.0) : 0.0;
        vec3 Nb = back.r > 0.0 ? normalize((vec4(octDecode(back.gb), 0.0) * viewMatrix).xyz) : -N;
        float exitY = back.r > 0.0 ? back.a : vRest.y;

        float rough = clamp(uRoughness + fresh * 0.02 + frost * 0.5 - melt * 0.02 + coat * 0.18, 0.015, 1.0);
        float lod = clamp(rough * 9.0 + frost * 2.5 + thick * 1.6, 0.0, uSceneLodMax);

        vec3 trans;
        trans.r = sampleThrough(Pw, V, N, Nb, thick, uIor - disp, lod, rough, 0).r;
        trans.g = sampleThrough(Pw, V, N, Nb, thick, uIor, lod, rough, 1).g;
        trans.b = sampleThrough(Pw, V, N, Nb, thick, uIor + disp, lod, rough, 2).b;

        float pathLen = thick + 0.2 * rim * rim;
        // layered: lean toward the layer you look into, so bands stay crisp
        vec3 sigma = uLayers > 0 ? mix(layerSigma(Rp.y, Rp.y, uAbsorb), layerSigma(Rp.y, exitY, uAbsorb), 0.22) : uAbsorb;
        vec3 Tr = exp(-sigma * pathLen * (1.0 + melt * 0.35));
        float haze = 1.0 - exp(-(uScatter + uMilk * 7.0 + frost * 2.5) * pathLen);
        haze = max(haze, max(uMilk * 0.72, uHazeMin));

        vec3 L = normalize(uLightDir);
        float NdL = dot(N, L);
        float wrap = max((NdL + 0.7) / 1.7, 0.0);
        vec3 irr = envLookup(N, 1.0);
        float backlit = pow(clamp(dot(V, -L), 0.0, 1.0), 3.0);
        vec3 baseSc = uLayers > 0 ? mix(layerScatter(Rp.y, uScatterColor), layerScatter(exitY, uScatterColor), 0.25) : uScatterColor;
        // creamy jelly: pastel, milky body colour
        baseSc = mix(baseSc, mix(baseSc, vec3(1.0), 0.45) * 1.05, uMilk);
        vec3 sc = mix(baseSc, vec3(0.92, 0.96, 1.0), frost * 0.85);
        // light that scattered inside the body (thin regions glow more brightly)
        // translucency: how much light glows through (and how deep it reaches)
        vec3 scatterLight = sc * (irr * 0.55 + uLightColor * (wrap * 0.22 + backlit * (0.25 + 0.5 * uGlow)))
          * (0.2 + 1.6 * uGlow) * (0.55 + 0.45 * exp(-pathLen * mix(3.0, 0.45, uGlow)));

        vec3 body = trans * Tr * (1.0 - haze) + scatterLight * haze;

        float F0 = pow((uIor - 1.0) / (uIor + 1.0), 2.0);
        float F = min(F0 + (1.0 - F0) * pow(clamp(1.0 - NdV, 0.0, 1.0), 5.0), 1.0 - 0.5 * rim);
        vec3 Rv = reflect(-V, N);
        vec3 refl = envLookup(Rv, rough);
        // (what it mirrors below the horizon is the floor beside it - lit
        // through the jelly, darker right where it sits - not the studio's
        // grey, which beside a strong colour reads as its opposite)
        float down = 1.0 - smoothstep(-0.45, 0.05, Rv.y);
        float nearFloor = exp(-max(Pw.y, 0.0) * 6.0);
        refl = mix(refl, refl * sc * (1.3 - 0.5 * nearFloor), down * (0.55 + 0.35 * nearFloor));

        vec3 H = normalize(L + V);
        float NdH = max(dot(N, H), 0.0);
        float a = max(rough * rough, 0.0012);
        float nl = max(NdL, 0.0);
        float Fh = F0 + (1.0 - F0) * pow(clamp(1.0 - dot(H, V), 0.0, 1.0), 5.0);
        // (capped: a glassy highlight seen dead on can top half-float range)
        vec3 spec = min(uLightColor * D_GGX(NdH, a) * V_Smith(nl, NdV, a) * nl * Fh, vec3(48.0));

        vec3 col = body * (1.0 - F) + refl * F + spec;

        // Glow mode: it gives off its own light, from all of its body -
        // brighter through more of it, towards a hotter, paler core. A knock
        // sends a ring of light racing out through it from where it landed.
        vec3 emLit = vec3(0.0);
        if (uEmit > 0.0) {
          float deep = 1.0 - exp(-pathLen * 1.8);
          // (light from deeper in has crossed more of it: a richer colour)
          vec3 rich = pow(max(sc, vec3(1e-3)), vec3(1.0 + 0.8 * deep));
          // slow currents of brighter light drifting about inside it, and a
          // slow breath
          vec3 q = vRest + refract(-V, N, 1.0 / uIor) * thick * 0.5;
          float cur = vnoise(q * 2.3 + vec3(0.0, uTime * 0.16, uTime * 0.07)) * 0.65
            + vnoise(q * 5.1 - vec3(uTime * 0.11, 0.0, uTime * 0.13)) * 0.35;
          float lvl = (0.78 + 0.5 * cur) * (0.95 + 0.05 * sin(uTime * 1.3));
          vec3 em = rich * (0.08 + 0.8 * deep) * lvl + mix(sc, vec3(1.0), 0.35) * 0.16 * smoothstep(0.7, 1.8, pathLen);
          float ring = 0.0;
          for (int i = 0; i < ${MAX_PULSES}; i++) {
            float age = uTime - uPulse[i].w;
            if (age < 0.0 || age > 1.6) continue;
            float x = (distance(Pw, uPulse[i].xyz) - age * 2.3) / (0.035 + 0.09 * age);
            ring += uPulseAmp[i] * exp(-x * x) * exp(-age * 2.4);
          }
          em += mix(sc, vec3(1.0), 0.22) * min(ring, 3.0) * 2.6;
          emLit = em * uEmit;
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
        col += uGlowColor * glow * (0.25 + fresh * 0.75);

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
            vec3 healC = mix(vec3(1.0, 0.94, 0.82), uGlowColor * vec3(1.15, 1.0, 0.85), smoothstep(0.0, 0.9, th));
            col += healC * band * (1.0 + 0.3 * vnoise(pr * 22.0 + vec3(0.0, th * 2.0, 0.0)));
          }
          // (and warmth through the body while the seams are hot)
          col += hotC * (1.0 - exp(-pathLen * 1.2)) * exp(-1.6 * t) * smoothstep(0.0, 0.2, t) * 0.2;
        }
        // the outline, anti-aliased: the last pixel is part jelly, part
        // whatever's behind (only where the jelly really is that thin)
        float silh = 1.0 - smoothstep(0.0, 0.03, thick);
        col = mix(textureLod(tScene, uv, 0.0).rgb, col, mix(1.0, cover, silh));
        if (uDebug == 1) col = refl * F + spec;
        else if (uDebug == 2) col = trans * Tr;
        else if (uDebug == 3) col = vec3(thick * 0.5);
        else if (uDebug == 4) col = scatterLight * haze;
        else if (uDebug == 5) col = refl;
        else if (uDebug == 6) col = N * 0.5 + 0.5;

        gl_FragColor = vec4(finite(col), 1.0);
      }
    `,
  });
}

// Caustic splatting from the key light onto the floor (Wallace-style
// area-ratio caustics). Rendered in floor space.
export function createCausticMaterial(layerUniforms) {
  return new THREE.ShaderMaterial({
    side: THREE.FrontSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    extensions: { derivatives: true },
    uniforms: {
      ...layerUniforms,
      uLightDir: { value: new THREE.Vector3(-0.45, 0.8, 0.4).normalize() },
      uIor: { value: 1.36 },
      uAbsorb: { value: new THREE.Vector3(0.2, 2.4, 2.0) },
      uScatter: { value: 0.35 },
      uFloorRect: { value: new THREE.Vector4(-3, -3, 1 / 6, 1 / 6) },
    },
    vertexShader: /* glsl */ `
      uniform vec3 uLightDir;
      uniform float uIor;
      uniform vec4 uFloorRect;
      attribute vec3 aRest;
      attribute vec4 aData;
      varying float vRestY;
      varying float vTemp;
      varying vec3 vOld;
      varying vec3 vNew;
      varying float vNdL;
      varying float vPath;
      void main() {
        vec3 P = position;
        vec3 N = normalize(normal);
        vec3 Ld = -normalize(uLightDir);
        vec3 oldP = P + Ld * (-P.y / Ld.y);
        vec3 r = refract(Ld, N, 1.0 / uIor);
        if (dot(r, r) < 1e-6) r = Ld;
        float ry = min(r.y, -0.08);
        float t = max(P.y, 0.0) / -ry;
        vec3 newP = P + r * t;
        vOld = oldP;
        vNew = newP;
        vNdL = dot(N, normalize(uLightDir));
        vPath = t;
        vRestY = aRest.y;
        vTemp = aData.x;
        vec2 uv = (newP.xz - uFloorRect.xy) * uFloorRect.zw;
        gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uAbsorb;
      uniform float uScatter;
      uniform float uIor;
      varying float vRestY;
      varying float vTemp;
      ${LAYER_GLSL}
      varying vec3 vOld;
      varying vec3 vNew;
      varying float vNdL;
      varying float vPath;
      void main() {
        if (vNdL <= 0.0) discard;
        float oldA = length(dFdx(vOld)) * length(dFdy(vOld));
        float newA = length(dFdx(vNew)) * length(dFdy(vNew));
        // focusing, capped so sliver faces can't streak
        float ratio = clamp(oldA / max(newA, 1e-9), 0.0, 3.2);
        float F0 = pow((uIor - 1.0) / (uIor + 1.0), 2.0);
        float Ft = 1.0 - (F0 + (1.0 - F0) * pow(clamp(1.0 - vNdL, 0.0, 1.0), 5.0));
        vec3 sig = layerSigma(vRestY, uLayerY0, uAbsorb);
        vec3 T = exp(-sig * vPath) * exp(-uScatter * vPath * 0.7);
        // frosted jelly scatters light: no sharp caustics
        T *= 1.0 - 0.9 * smoothstep(0.05, 0.6, -vTemp);
        gl_FragColor = vec4(T * ratio * Ft, 1.0);
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
        vN = normalize(mat3(modelMatrix) * normal);
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
      void main() {
        // (mirrored: -y is how high the real point is above the floor)
        float h = max(-vW.y, 0.0);
        float fade = exp(-h * uFade);
        vec3 sc = layerScatter(vRest.y, uScatterColor);
        sc = mix(sc, mix(sc, vec3(1.0), 0.45), uMilk);
        vec3 V = normalize(cameraPosition - vW);
        float rim = pow(1.0 - abs(dot(normalize(vN), V)), 2.0);
        vec3 c = sc * mix(0.42 + 0.3 * rim, 0.85 + 0.5 * rim, uEmit) + vec3(1.0, 0.9, 0.75) * vGlow * 0.6;
        gl_FragColor = vec4(c * fade, fade);
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
