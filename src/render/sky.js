import * as THREE from 'three';

// The sky: a gradient from the horizon up (and down, for what reflects it),
// a sun or a moon (a synthwave sun: banded), stars that twinkle, clouds that
// drift. One shader for the sky you see behind everything and for the one
// captured into the environment the jelly and the floor reflect.

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uZen, uHor, uGnd;
  uniform vec3 uSunDir, uSunCol, uSunCol2;
  uniform float uSunSize, uSunGlow, uStripes;
  uniform float uStars, uClouds;
  uniform vec3 uCloudCol;
  uniform float uTime;
  varying vec3 vDir;
  float sh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float sn(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(sh(i), sh(i + vec2(1.0, 0.0)), u.x), mix(sh(i + vec2(0.0, 1.0)), sh(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float sfbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * sn(p); p = p * 2.02 + 13.7; a *= 0.5; }
    return s;
  }
  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    vec3 c = y > 0.0 ? mix(uHor, uZen, pow(y, 0.55)) : mix(uHor, uGnd, pow(-y, 0.35));
    // clouds: a layer overhead, thinning out toward the horizon
    if (uClouds > 0.0 && y > 0.01) {
      vec2 p = d.xz / (y + 0.12) * 1.6 + vec2(uTime * 0.008, 0.0);
      float n = sfbm(p);
      float k = smoothstep(1.02 - uClouds, 1.18 - uClouds * 0.55, n) * smoothstep(0.01, 0.16, y);
      c = mix(c, uCloudCol * (0.85 + 0.3 * sn(p * 3.0)), k * 0.9);
    }
    // stars: a sprinkle in the dark, each twinkling to itself
    if (uStars > 0.0 && y > 0.0) {
      vec3 g = floor(d * 260.0);
      float h = fract(sin(dot(g, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      float s = step(0.9965, h) * (0.55 + 0.45 * sin(uTime * (1.5 + 3.0 * fract(h * 91.0)) + h * 60.0));
      c += vec3(0.85, 0.9, 1.0) * s * uStars * smoothstep(0.0, 0.25, y) * 2.2;
    }
    // the sun (or moon, or earth): a disc and a glow round it
    if (uSunSize > 0.0) {
      vec3 sd = normalize(uSunDir);
      float a = acos(clamp(dot(d, sd), -1.0, 1.0));
      float disc = 1.0 - smoothstep(uSunSize * 0.97, uSunSize, a);
      if (uStripes > 0.5 && disc > 0.0) {
        // (a synthwave sun: its lower half cut into bands that thin downward)
        float v = dot(d - sd, vec3(0.0, 1.0, 0.0)) / uSunSize;
        if (v < 0.1) disc *= step(0.18 + 0.55 * clamp(-v, 0.0, 1.0), fract(v * 5.0 + 0.5));
        c = mix(c, mix(uSunCol, uSunCol2, clamp(0.5 - v * 0.5, 0.0, 1.0)), disc);
      } else c = mix(c, uSunCol, disc);
      c += uSunCol * uSunGlow * (pow(max(dot(d, sd), 0.0), 60.0) * 0.6 + pow(max(dot(d, sd), 0.0), 6.0) * 0.08);
    }
    gl_FragColor = vec4(c, 1.0);
  }`;

export function skyUniforms() {
  return {
    uZen: { value: new THREE.Vector3(0.3, 0.31, 0.33) },
    uHor: { value: new THREE.Vector3(0.86, 0.85, 0.83) },
    uGnd: { value: new THREE.Vector3(0.62, 0.6, 0.58) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Vector3(1, 1, 1) },
    uSunCol2: { value: new THREE.Vector3(1, 1, 1) }, // (a synthwave sun's foot)
    uSunSize: { value: 0 },
    uSunGlow: { value: 0 },
    uStripes: { value: 0 },
    uStars: { value: 0 },
    uClouds: { value: 0 },
    uCloudCol: { value: new THREE.Vector3(1, 1, 1) },
    uTime: { value: 0 },
  };
}

export function makeSkyMaterial(uniforms = skyUniforms()) {
  return new THREE.ShaderMaterial({ uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false });
}

// a place's sky into the uniforms (sun dir 'key': where the key light is)
export function setSky(u, sky, lightDir) {
  u.uZen.value.set(...sky.zen);
  u.uHor.value.set(...sky.hor);
  u.uGnd.value.set(...(sky.gnd || sky.hor));
  const s = sky.sun;
  u.uSunSize.value = s ? s.size : 0;
  if (s) {
    if (s.dir === 'key') u.uSunDir.value.copy(lightDir).normalize();
    else u.uSunDir.value.set(...s.dir).normalize();
    u.uSunCol.value.set(...s.col);
    u.uSunCol2.value.set(...(s.col2 || s.col));
    u.uSunGlow.value = s.glow || 0;
    u.uStripes.value = s.stripes ? 1 : 0;
  }
  u.uStars.value = sky.stars || 0;
  u.uClouds.value = sky.clouds || 0;
  u.uCloudCol.value.set(...(sky.cloudCol || [1, 1, 1]));
}

// The sky you see: a big dome, drawn first, behind everything.
export function createSkyDome() {
  const u = skyUniforms();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(48, 64, 32), makeSkyMaterial(u));
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  mesh.userData.u = u;
  return mesh;
}
