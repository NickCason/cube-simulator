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

// Layered flavours (rainbow jelly): absorption/scatter vary with rest height.
// A ray crossing several layers integrates absorption over the heights it spans.
export const LAYER_GLSL = /* glsl */ `
  uniform int uLayers;
  uniform float uLayerY0;
  uniform float uLayerH;
  uniform vec3 uLayerAbs[8];
  uniform vec3 uLayerSc[8];
  int layerIndex(float y) {
    return clamp(int(floor((y - uLayerY0) / uLayerH)), 0, max(uLayers - 1, 0));
  }
  vec3 layerSigma(float ya, float yb, vec3 uniformSigma) {
    if (uLayers == 0) return uniformSigma;
    float lo = min(ya, yb), hi = max(ya, yb);
    if (hi - lo < 1e-3) return uLayerAbs[layerIndex(lo)];
    vec3 acc = vec3(0.0);
    for (int k = 0; k < 8; k++) {
      if (k >= uLayers) break;
      float a = k == 0 ? -1e3 : uLayerY0 + float(k) * uLayerH;
      float b = k == uLayers - 1 ? 1e3 : uLayerY0 + float(k + 1) * uLayerH;
      acc += uLayerAbs[k] * max(0.0, min(hi, b) - max(lo, a));
    }
    return acc / (hi - lo);
  }
  vec3 layerScatter(float y, vec3 uniformColor) {
    if (uLayers == 0) return uniformColor;
    // a whisker of blending at the seams, like real set gelatin layers
    float f = (y - uLayerY0) / uLayerH - 0.5;
    int i0 = clamp(int(floor(f)), 0, uLayers - 1);
    int i1 = clamp(i0 + 1, 0, uLayers - 1);
    float t = smoothstep(0.47, 0.53, fract(f));
    return mix(uLayerSc[i0], uLayerSc[i1], t);
  }
`;

export function createLayerUniforms() {
  return {
    uLayers: { value: 0 },
    uLayerY0: { value: -0.5 },
    uLayerH: { value: 1 / 6 },
    uLayerAbs: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
    uLayerSc: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
  };
}

const VERT = /* glsl */ `
  attribute vec3 aRest;
  attribute vec4 aData;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vViewPos;
  varying vec3 vRest;
  varying vec4 vData;
  void main() {
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
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec3 vViewPos;
      varying vec3 vRest;
      varying vec4 vData;
      ${NOISE}
      ${OCT}
      ${LAYER_GLSL}

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

        // molded-surface irregularity (breaks perfect-glass reflections)
        {
          vec3 q = vRest * 5.0;
          float e = 0.05;
          float n0 = vnoise(q) + 0.5 * vnoise(q * 2.1 + 7.0);
          vec3 g = vec3(vnoise(q + vec3(e, 0, 0)) + 0.5 * vnoise((q + vec3(e, 0, 0)) * 2.1 + 7.0) - n0,
                        vnoise(q + vec3(0, e, 0)) + 0.5 * vnoise((q + vec3(0, e, 0)) * 2.1 + 7.0) - n0,
                        vnoise(q + vec3(0, 0, e)) + 0.5 * vnoise((q + vec3(0, 0, e)) * 2.1 + 7.0) - n0) / e;
          N = normalize(N + (g - N * dot(g, N)) * 0.018);
        }
        // sugar coating (sour gummies): only on the moulded outside
        float coat = uSugar * (1.0 - fresh);
        float grain = 0.0;
        if (coat > 0.0) {
          vec3 q = vRest * 140.0;
          grain = vnoise(q) * 0.6 + vnoise(q * 2.3) * 0.4;
          float e = 0.12;
          vec3 g = vec3(vnoise(q + vec3(e, 0, 0)), vnoise(q + vec3(0, e, 0)), vnoise(q + vec3(0, 0, e))) - vnoise(q);
          N = normalize(N + (g / e - N * dot(g / e, N)) * 0.05 * coat);
        }
        // surface micro-structure: faint knife texture on cut faces, ice crystals when frozen
        if (fresh > 0.5 || frost > 0.01) {
          vec3 q = vRest * 38.0;
          float e = 0.02;
          float n0 = fbm3(q);
          vec3 g = vec3(fbm3(q + vec3(e, 0, 0)) - n0, fbm3(q + vec3(0, e, 0)) - n0, fbm3(q + vec3(0, 0, e)) - n0) / e;
          N = normalize(N + (g - N * dot(g, N)) * (0.012 * fresh + 0.09 * frost));
        }

        float NdV = dot(N, V);
        if (NdV < 0.02) { N = normalize(N + V * (0.02 - NdV)); NdV = max(dot(N, V), 0.02); }

        vec2 uv = gl_FragCoord.xy / resolution;
        vec4 back = texture(tBack, uv);
        float frontDepth = -vViewPos.z;
        float thick = back.r > 0.0 ? clamp(back.r - frontDepth, 0.0, 4.0) : 0.0;
        vec3 Nb = back.r > 0.0 ? normalize((vec4(octDecode(back.gb), 0.0) * viewMatrix).xyz) : -N;
        float exitY = back.r > 0.0 ? back.a : vRest.y;

        float rough = clamp(uRoughness + fresh * 0.02 + frost * 0.5 - melt * 0.02 + coat * 0.45, 0.015, 1.0);
        float lod = clamp(rough * 9.0 + frost * 2.5 + thick * 1.6, 0.0, uSceneLodMax);

        vec3 trans;
        trans.r = sampleThrough(vWorldPos, V, N, Nb, thick, uIor - uDispersion, lod, rough, 0).r;
        trans.g = sampleThrough(vWorldPos, V, N, Nb, thick, uIor, lod, rough, 1).g;
        trans.b = sampleThrough(vWorldPos, V, N, Nb, thick, uIor + uDispersion, lod, rough, 2).b;

        float pathLen = thick;
        // layered: lean toward the layer you look into, so bands stay crisp
        vec3 sigma = uLayers > 0 ? mix(layerSigma(vRest.y, vRest.y, uAbsorb), layerSigma(vRest.y, exitY, uAbsorb), 0.22) : uAbsorb;
        vec3 Tr = exp(-sigma * pathLen * (1.0 + melt * 0.35));
        float haze = 1.0 - exp(-(uScatter + uMilk * 7.0 + frost * 2.5) * pathLen);
        haze = max(haze, uMilk * 0.72);

        vec3 L = normalize(uLightDir);
        float NdL = dot(N, L);
        float wrap = max((NdL + 0.7) / 1.7, 0.0);
        vec3 irr = envLookup(N, 1.0);
        float backlit = pow(clamp(dot(V, -L), 0.0, 1.0), 3.0);
        vec3 baseSc = uLayers > 0 ? mix(layerScatter(vRest.y, uScatterColor), layerScatter(exitY, uScatterColor), 0.25) : uScatterColor;
        // creamy jelly: pastel, milky body colour
        baseSc = mix(baseSc, mix(baseSc, vec3(1.0), 0.45) * 1.05, uMilk);
        vec3 sc = mix(baseSc, vec3(0.92, 0.96, 1.0), frost * 0.85);
        // light that scattered inside the body (thin regions glow more brightly)
        vec3 scatterLight = sc * (irr * 0.55 + uLightColor * (wrap * 0.22 + backlit * 0.5)) * (0.55 + 0.45 * exp(-pathLen * 1.5));

        vec3 body = trans * Tr * (1.0 - haze) + scatterLight * haze;

        float F0 = pow((uIor - 1.0) / (uIor + 1.0), 2.0);
        float F = F0 + (1.0 - F0) * pow(1.0 - NdV, 5.0);
        vec3 refl = envLookup(reflect(-V, N), rough);

        vec3 H = normalize(L + V);
        float NdH = max(dot(N, H), 0.0);
        float a = max(rough * rough, 0.0012);
        float nl = max(NdL, 0.0);
        float Fh = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
        vec3 spec = uLightColor * D_GGX(NdH, a) * V_Smith(nl, NdV, a) * nl * Fh;

        vec3 col = body * (1.0 - F) + refl * F + spec;

        // dynamic point light (torch flame, explosion flash)
        if (uPLColor.r + uPLColor.g + uPLColor.b > 0.001) {
          vec3 Lp = uPLPos - vWorldPos;
          float dp = length(Lp);
          Lp /= dp;
          float fall = 1.0 / (1.0 + dp * dp * 9.0);
          float nlp = max(dot(N, Lp), 0.0);
          vec3 Hp = normalize(Lp + V);
          float specP = D_GGX(max(dot(N, Hp), 0.0), max(a, 0.004)) * V_Smith(nlp, NdV, max(a, 0.004)) * nlp * 0.06;
          col += uPLColor * fall * (specP + sc * (max((dot(N, Lp) + 0.6) / 1.6, 0.0) * 0.5 + 0.35));
        }

        // sugar crystals: frosty granular film with glints
        if (coat > 0.0) {
          float glint = pow(max(vnoise(vRest * 260.0), 0.0), 14.0) * 40.0 * nl;
          vec3 sugarCol = mix(vec3(1.0), sc, 0.28) * (irr * 0.7 + uLightColor * (nl * 0.45 + 0.12)) * (0.72 + 0.5 * grain);
          col = mix(col, sugarCol + glint, coat * (0.38 + 0.4 * grain));
        }

        // frost layer: white crystalline film with sparkles
        if (frost > 0.0) {
          float crystal = fbm3(vRest * 55.0);
          float sparkle = pow(max(vnoise(vRest * 160.0 + floor(uTime * 0.0)), 0.0), 18.0) * 30.0 * nl;
          vec3 frostCol = vec3(0.86, 0.92, 1.0) * (irr * 0.75 + uLightColor * (nl * 0.5 + 0.15)) * (0.7 + 0.5 * crystal);
          col = mix(col, frostCol + sparkle, frost * (0.35 + 0.4 * crystal));
        }

        // healing glow
        col += uGlowColor * glow * (0.25 + fresh * 0.75);
        if (uDebug == 1) col = refl * F + spec;
        else if (uDebug == 2) col = trans * Tr;
        else if (uDebug == 3) col = vec3(thick * 0.5);
        else if (uDebug == 4) col = scatterLight * haze;
        else if (uDebug == 5) col = refl;
        else if (uDebug == 6) col = N * 0.5 + 0.5;

        gl_FragColor = vec4(col, 1.0);
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
      varying float vRestY;
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
        vec2 uv = (newP.xz - uFloorRect.xy) * uFloorRect.zw;
        gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uAbsorb;
      uniform float uScatter;
      uniform float uIor;
      varying float vRestY;
      ${LAYER_GLSL}
      varying vec3 vOld;
      varying vec3 vNew;
      varying float vNdL;
      varying float vPath;
      void main() {
        if (vNdL <= 0.0) discard;
        float oldA = length(dFdx(vOld)) * length(dFdy(vOld));
        float newA = length(dFdx(vNew)) * length(dFdy(vNew));
        float ratio = clamp(oldA / max(newA, 1e-9), 0.0, 6.0);
        float F0 = pow((uIor - 1.0) / (uIor + 1.0), 2.0);
        float Ft = 1.0 - (F0 + (1.0 - F0) * pow(1.0 - vNdL, 5.0));
        vec3 sig = layerSigma(vRestY, uLayerY0, uAbsorb);
        vec3 T = exp(-sig * vPath) * exp(-uScatter * vPath * 0.7);
        gl_FragColor = vec4(T * ratio * Ft, 1.0);
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
