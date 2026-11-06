import * as THREE from 'three';

const FS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export class FullScreen {
  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.mesh = new THREE.Mesh(g, null);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  render(renderer, material, target) {
    this.mesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }
}

// FXAA (Lottes' compact form) on the HDR scene in tDiffuse: colours
// compressed by their luma first, so a highlight can't swamp the average.
// (needs finite(), uFxaa, uPx, uSharp)
const FXAA_GLSL = /* glsl */ `
  float lw(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  vec3 squash(vec3 c) { return c / (1.0 + lw(c)); }
  vec3 unsquash(vec3 c) { return c / max(1.0 - lw(c), 1e-3); }
  vec3 tap(vec2 uv) { return squash(finite(texture2D(tDiffuse, uv).rgb)); }
  vec3 sceneAA(vec2 uv) {
    vec3 cM = finite(texture2D(tDiffuse, uv).rgb);
    if (uFxaa < 0.5) return cM;
    vec3 sM = squash(cM);
    float lNW = sqrt(lw(tap(uv + vec2(-1.0, -1.0) * uPx))), lNE = sqrt(lw(tap(uv + vec2(1.0, -1.0) * uPx)));
    float lSW = sqrt(lw(tap(uv + vec2(-1.0, 1.0) * uPx))), lSE = sqrt(lw(tap(uv + vec2(1.0, 1.0) * uPx)));
    float lM = sqrt(lw(sM));
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
    // no edge here: leave it - or, where the picture will be stretched to
    // the screen (phones), sharpen it a little first (AMD's contrast-adaptive
    // sharpening, from these same four taps)
    if (lMax - lMin < max(0.0312, lMax * 0.125)) {
      if (uSharp <= 0.0) return cM;
      vec3 t0 = tap(uv + vec2(-1.0, -1.0) * uPx), t1 = tap(uv + vec2(1.0, -1.0) * uPx);
      vec3 t2 = tap(uv + vec2(-1.0, 1.0) * uPx), t3 = tap(uv + vec2(1.0, 1.0) * uPx);
      vec3 mn = min(min(min(t0, t1), min(t2, t3)), sM), mx = max(max(max(t0, t1), max(t2, t3)), sM);
      vec3 w = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0)) * (-1.0 / mix(8.0, 5.0, uSharp));
      return unsquash(clamp((sM + (t0 + t1 + t2 + t3) * w) / (1.0 + 4.0 * w), 0.0, 0.999));
    }
    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
    float reduce = max((lNW + lNE + lSW + lSE) * (0.25 / 8.0), 1.0 / 128.0);
    dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), vec2(-8.0), vec2(8.0)) * uPx;
    vec3 a = 0.5 * (tap(uv - dir / 6.0) + tap(uv + dir / 6.0));
    vec3 b = a * 0.5 + 0.25 * (tap(uv - dir * 0.5) + tap(uv + dir * 0.5));
    float lB = sqrt(lw(b));
    return unsquash((lB < lMin || lB > lMax) ? a : b);
  }
`;

// AMD FidelityFX Super Resolution 1 - EASU, its edge-adaptive upscale (12
// taps: a Lanczos-like kernel stretched along the local edge, clamped to
// the 4 nearest texels so it can't ring), on the luma-compressed HDR scene.
// Phones render at ~1.75x and show at 3x: this upscales in the last pass
// rather than letting the browser stretch the canvas. (Opt-in, ?upscale:
// the last pass at the screen's full density roughly doubled the frame's
// GPU time on a laptop iGPU - see App.resize.)
const EASU_GLSL = /* glsl */ `
  uniform vec2 uInSize;
  uniform vec2 uOutSize;
  vec3 eFetch(ivec2 p) { return squash(finite(texelFetch(tDiffuse, clamp(p, ivec2(0), ivec2(uInSize) - 1), 0).rgb)); }
  float eL(vec3 c) { return c.g + 0.5 * (c.r + c.b); }
  void eSet(inout vec2 dir, inout float len, float w, float lA, float lB, float lC, float lD, float lE) {
    float lenX = max(abs(lD - lC), abs(lC - lB));
    float dirX = lD - lB;
    dir.x += dirX * w;
    lenX = clamp(abs(dirX) / max(lenX, 1e-5), 0.0, 1.0);
    len += lenX * lenX * w;
    float lenY = max(abs(lE - lC), abs(lC - lA));
    float dirY = lE - lA;
    dir.y += dirY * w;
    lenY = clamp(abs(dirY) / max(lenY, 1e-5), 0.0, 1.0);
    len += lenY * lenY * w;
  }
  void eTap(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len2, float lob, float clp, vec3 c) {
    vec2 v = vec2(dot(off, dir), dot(off, vec2(-dir.y, dir.x))) * len2;
    float d2 = min(dot(v, v), clp);
    float wB = 0.4 * d2 - 1.0, wA = lob * d2 - 1.0;
    wB *= wB;
    wA *= wA;
    float w = (1.5625 * wB - 0.5625) * wA;
    aC += c * w;
    aW += w;
  }
  vec3 easu(vec2 fragXY) {
    vec2 pp = fragXY * (uInSize / uOutSize) - 0.5;
    vec2 fp = floor(pp), fr = pp - fp;
    ivec2 f0 = ivec2(fp);
    //    b c
    //  e f g h
    //  i j k l
    //    n o
    vec3 bC = eFetch(f0 + ivec2(0, -1)), cC = eFetch(f0 + ivec2(1, -1));
    vec3 eC = eFetch(f0 + ivec2(-1, 0)), fC = eFetch(f0), gC = eFetch(f0 + ivec2(1, 0)), hC = eFetch(f0 + ivec2(2, 0));
    vec3 iC = eFetch(f0 + ivec2(-1, 1)), jC = eFetch(f0 + ivec2(0, 1)), kC = eFetch(f0 + ivec2(1, 1)), lC = eFetch(f0 + ivec2(2, 1));
    vec3 nC = eFetch(f0 + ivec2(0, 2)), oC = eFetch(f0 + ivec2(1, 2));
    float bL = eL(bC), cL = eL(cC), eLu = eL(eC), fL = eL(fC), gL = eL(gC), hL = eL(hC);
    float iL = eL(iC), jL = eL(jC), kL = eL(kC), lL = eL(lC), nL = eL(nC), oL = eL(oC);
    vec2 dir = vec2(0.0);
    float len = 0.0;
    eSet(dir, len, (1.0 - fr.x) * (1.0 - fr.y), bL, eLu, fL, gL, jL);
    eSet(dir, len, fr.x * (1.0 - fr.y), cL, fL, gL, hL, kL);
    eSet(dir, len, (1.0 - fr.x) * fr.y, fL, iL, jL, kL, nL);
    eSet(dir, len, fr.x * fr.y, gL, jL, kL, lL, oL);
    float dirR = dot(dir, dir);
    bool zro = dirR < 1.0 / 32768.0;
    dir = zro ? vec2(1.0, 0.0) : dir * inversesqrt(dirR);
    len = len * 0.5;
    len *= len;
    float stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
    vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
    float lob = 0.5 - 0.29 * len;
    float clp = 1.0 / lob;
    vec3 mn4 = min(min(fC, gC), min(jC, kC)), mx4 = max(max(fC, gC), max(jC, kC));
    vec3 aC = vec3(0.0);
    float aW = 0.0;
    eTap(aC, aW, vec2(0.0, -1.0) - fr, dir, len2, lob, clp, bC);
    eTap(aC, aW, vec2(1.0, -1.0) - fr, dir, len2, lob, clp, cC);
    eTap(aC, aW, vec2(-1.0, 1.0) - fr, dir, len2, lob, clp, iC);
    eTap(aC, aW, vec2(0.0, 1.0) - fr, dir, len2, lob, clp, jC);
    eTap(aC, aW, vec2(0.0, 0.0) - fr, dir, len2, lob, clp, fC);
    eTap(aC, aW, vec2(-1.0, 0.0) - fr, dir, len2, lob, clp, eC);
    eTap(aC, aW, vec2(1.0, 1.0) - fr, dir, len2, lob, clp, kC);
    eTap(aC, aW, vec2(2.0, 1.0) - fr, dir, len2, lob, clp, lC);
    eTap(aC, aW, vec2(2.0, 0.0) - fr, dir, len2, lob, clp, hC);
    eTap(aC, aW, vec2(1.0, 0.0) - fr, dir, len2, lob, clp, gC);
    eTap(aC, aW, vec2(1.0, 2.0) - fr, dir, len2, lob, clp, oC);
    eTap(aC, aW, vec2(0.0, 2.0) - fr, dir, len2, lob, clp, nC);
    return unsquash(min(mx4, max(mn4, aC / aW)));
  }
`;

const FINITE_GLSL = /* glsl */ `
  vec3 finite(vec3 c) {
    bvec3 bad = equal(floatBitsToUint(c) & uvec3(0x7f800000u), uvec3(0x7f800000u));
    return any(bad) ? vec3(0.0) : clamp(c, 0.0, 64.0);
  }
`;

export function makeCopyMaterial() {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: { tDiffuse: { value: null } },
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      ${FINITE_GLSL}
      // (what the jelly refracts, blurred through mip levels: a non-finite
      // texel would turn a whole block of it black)
      void main() { gl_FragColor = vec4(finite(texture2D(tDiffuse, vUv).rgb), 1.0); }`,
  });
}

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.fs = new FullScreen();
    this.levels = 6;
    this.rts = [];
    this.copyMat = makeCopyMaterial();
    this.preMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.1 }, uKnee: { value: 0.6 } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 uTexel;
        uniform float uThreshold;
        uniform float uKnee;
        varying vec2 vUv;
        // (a NaN or infinity anywhere in the picture would otherwise spread
        // through every bloom level: a white or black flash)
        vec3 finite(vec3 c) {
          bvec3 bad = equal(floatBitsToUint(c) & uvec3(0x7f800000u), uvec3(0x7f800000u));
          return any(bad) ? vec3(0.0) : clamp(c, 0.0, 64.0);
        }
        vec3 pre(vec3 c) {
          c = finite(c);
          float br = max(c.r, max(c.g, c.b));
          float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
          rq = rq * rq / (4.0 * uKnee + 1e-4);
          float w = max(rq, br - uThreshold) / max(br, 1e-4);
          return c * w;
        }
        void main() {
          vec3 a = texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
          vec3 b = texture2D(tDiffuse, vUv + uTexel * vec2(1.0, -1.0)).rgb;
          vec3 c = texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
          vec3 d = texture2D(tDiffuse, vUv + uTexel * vec2(1.0, 1.0)).rgb;
          vec3 col = (pre(a) + pre(b) + pre(c) + pre(d)) * 0.25;
          gl_FragColor = vec4(min(col, vec3(40.0)), 1.0);
        }`,
    });
    this.downMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 uTexel;
        varying vec2 vUv;
        vec3 s(vec2 o) { return texture2D(tDiffuse, vUv + o * uTexel).rgb; }
        void main() {
          vec3 c = s(vec2(0.0)) * 0.125;
          c += (s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0))) * 0.125;
          c += (s(vec2(-2.0, -2.0)) + s(vec2(2.0, -2.0)) + s(vec2(-2.0, 2.0)) + s(vec2(2.0, 2.0))) * 0.03125;
          c += (s(vec2(-2.0, 0.0)) + s(vec2(2.0, 0.0)) + s(vec2(0.0, -2.0)) + s(vec2(0.0, 2.0))) * 0.0625;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.upMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
      uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, uScale: { value: 1 } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 uTexel;
        uniform float uScale;
        varying vec2 vUv;
        vec3 s(vec2 o) { return texture2D(tDiffuse, vUv + o * uTexel).rgb; }
        void main() {
          vec3 c = s(vec2(0.0)) * 4.0;
          c += (s(vec2(-1.0, 0.0)) + s(vec2(1.0, 0.0)) + s(vec2(0.0, -1.0)) + s(vec2(0.0, 1.0))) * 2.0;
          c += s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0));
          gl_FragColor = vec4(c / 16.0 * uScale, 1.0);
        }`,
    });
    this.compositeMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: null },
        tBloom: { value: null },
        uBloom: { value: 0.045 },
        uTime: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uVignette: { value: 0.22 },
        uFlash: { value: 0 },
        // (switching looks: the room dims to black, or floods with light)
        uDim: { value: 1 },
        uWash: { value: 0 },
        // edge smoothing (FXAA) where the scene has no multisampling (phones)
        uFxaa: { value: 0 },
        uPx: { value: new THREE.Vector2(1, 1) },
        // upscaling to the screen (phones): see EASU_GLSL
        uEasu: { value: 0 },
        uSharp: { value: 0 },
        uInSize: { value: new THREE.Vector2(1, 1) },
        uOutSize: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tBloom;
        uniform float uBloom;
        uniform float uTime;
        uniform vec2 uRes;
        uniform float uVignette;
        uniform float uFlash;
        uniform float uDim;
        uniform float uWash;
        uniform float uFxaa;
        uniform vec2 uPx;
        uniform float uEasu;
        uniform float uSharp;
        varying vec2 vUv;
        float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        vec3 finite(vec3 c) {
          bvec3 bad = equal(floatBitsToUint(c) & uvec3(0x7f800000u), uvec3(0x7f800000u));
          return any(bad) ? vec3(0.0) : clamp(c, 0.0, 64.0);
        }
        ${FXAA_GLSL}
        ${EASU_GLSL}
        void main() {
          vec3 c = uEasu > 0.5 ? easu(gl_FragCoord.xy) : sceneAA(vUv);
          c += finite(texture2D(tBloom, vUv).rgb) * uBloom;
          c += vec3(1.0, 0.85, 0.6) * uFlash;
          vec2 d = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
          c *= 1.0 - uVignette * smoothstep(0.35, 1.25, length(d));
          c = mix(c * uDim, vec3(1.6, 1.55, 1.5), uWash);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          float n = h12(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) - 0.5;
          gl_FragColor.rgb += n * (1.5 / 255.0);
        }`,
    });
  }

  setSize(w, h) {
    for (const rt of this.rts) rt.dispose();
    this.rts = [];
    let cw = Math.max(1, Math.floor(w / 2)), ch = Math.max(1, Math.floor(h / 2));
    for (let i = 0; i < this.levels; i++) {
      this.rts.push(new THREE.WebGLRenderTarget(cw, ch, { type: THREE.HalfFloatType, depthBuffer: false }));
      cw = Math.max(1, Math.floor(cw / 2));
      ch = Math.max(1, Math.floor(ch / 2));
    }
    this.compositeMat.uniforms.uRes.value.set(w, h);
    this.compositeMat.uniforms.uPx.value.set(1 / w, 1 / h);
  }

  copy(src, dst) {
    this.copyMat.uniforms.tDiffuse.value = src;
    this.fs.render(this.renderer, this.copyMat, dst);
  }

  bloom(srcTex, srcW, srcH) {
    const r = this.renderer;
    this.preMat.uniforms.tDiffuse.value = srcTex;
    this.preMat.uniforms.uTexel.value.set(1 / srcW, 1 / srcH);
    this.fs.render(r, this.preMat, this.rts[0]);
    for (let i = 1; i < this.rts.length; i++) {
      const s = this.rts[i - 1];
      this.downMat.uniforms.tDiffuse.value = s.texture;
      this.downMat.uniforms.uTexel.value.set(1 / s.width, 1 / s.height);
      this.fs.render(r, this.downMat, this.rts[i]);
    }
    const auto = r.autoClear;
    r.autoClear = false;
    for (let i = this.rts.length - 1; i > 0; i--) {
      const s = this.rts[i];
      this.upMat.uniforms.tDiffuse.value = s.texture;
      this.upMat.uniforms.uTexel.value.set(1 / s.width, 1 / s.height);
      this.upMat.uniforms.uScale.value = 1.0;
      this.fs.render(r, this.upMat, this.rts[i - 1]);
    }
    r.autoClear = auto;
    return this.rts[0].texture;
  }

  // edge smoothing as a pass of its own (before an upscale)
  fxaa(src, dst) {
    if (!this.fxaaMat) {
      this.fxaaMat = new THREE.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        uniforms: { tDiffuse: { value: null }, uFxaa: { value: 1 }, uPx: this.compositeMat.uniforms.uPx, uSharp: { value: 0 } },
        vertexShader: FS_VERT,
        fragmentShader: /* glsl */ `
          uniform sampler2D tDiffuse;
          uniform float uFxaa;
          uniform vec2 uPx;
          uniform float uSharp;
          varying vec2 vUv;
          ${FINITE_GLSL}
          ${FXAA_GLSL}
          void main() { gl_FragColor = vec4(sceneAA(vUv), 1.0); }`,
      });
    }
    this.fxaaMat.uniforms.tDiffuse.value = src;
    this.fs.render(this.renderer, this.fxaaMat, dst);
  }

  composite(srcTex, bloomTex, time) {
    const u = this.compositeMat.uniforms;
    u.tDiffuse.value = srcTex;
    u.tBloom.value = bloomTex;
    u.uTime.value = time;
    this.fs.render(this.renderer, this.compositeMat, null);
  }
}
