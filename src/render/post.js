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

export function makeCopyMaterial() {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: { tDiffuse: { value: null } },
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() { gl_FragColor = texture2D(tDiffuse, vUv); }`,
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
        varying vec2 vUv;
        float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        vec3 finite(vec3 c) {
          bvec3 bad = equal(floatBitsToUint(c) & uvec3(0x7f800000u), uvec3(0x7f800000u));
          return any(bad) ? vec3(0.0) : clamp(c, 0.0, 64.0);
        }
        void main() {
          vec3 c = finite(texture2D(tDiffuse, vUv).rgb);
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

  composite(srcTex, bloomTex, time) {
    const u = this.compositeMat.uniforms;
    u.tDiffuse.value = srcTex;
    u.tBloom.value = bloomTex;
    u.uTime.value = time;
    this.fs.render(this.renderer, this.compositeMat, null);
  }
}
