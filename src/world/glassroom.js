// The glass room: a see-through box the jelly bounces around in, instead of
// the open floor and its unseen round wall (Settings > World). Four panes of
// glass, open at the top - faintly tinted, reflecting the studio, their edges
// catching the light - drawn over the jelly where they're in front of it.
// The walls themselves are the physics' (SoftBody p.box): square, and going
// on up past the glass, unseen, as the round one did.

import * as THREE from 'three';

const VERT = /* glsl */ `
  varying vec3 vW;
  varying vec3 vN;
  varying vec2 vUv;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const FRAG = /* glsl */ `
  uniform vec2 uSize;     // the pane's width and height
  uniform vec3 uLightDir;
  uniform float uShow;    // 0..1: easing in and out
  uniform float uDark;    // the dark theme
  varying vec3 vW;
  varying vec3 vN;
  varying vec2 vUv;
  void main() {
    vec3 V = normalize(cameraPosition - vW);
    vec3 N = normalize(vN);
    if (dot(N, V) < 0.0) N = -N;
    float NdV = clamp(dot(N, V), 0.0, 1.0);
    // glass: ~4% reflected face on, much more at a glancing angle
    float F = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
    vec3 R = reflect(-V, N);
    // the studio in it: a bright sky, the softbox key light as a glint
    vec3 sky = mix(vec3(0.55, 0.57, 0.6), vec3(1.25, 1.27, 1.3), smoothstep(-0.15, 0.85, R.y));
    float box = pow(max(dot(R, normalize(uLightDir)), 0.0), 90.0) * 6.0;
    vec3 refl = (sky + vec3(box)) * mix(1.0, 0.55, uDark);
    // its edges: thicker glass seen end on - a bright line, a darker rim
    vec2 d = min(vUv, 1.0 - vUv) * uSize;
    float e = min(d.x, d.y);
    float glint = exp(-pow(e / 0.006, 2.0)) * 0.9 + exp(-pow(e / 0.03, 2.0)) * 0.18;
    // (where it stands on the floor: a thin dark line)
    float foot = exp(-pow(vUv.y * uSize.y / 0.008, 2.0));
    // a faint green-blue body, more where you see through more of it
    vec3 tint = mix(vec3(0.82, 0.93, 0.92), vec3(0.3, 0.45, 0.45), uDark);
    float a = (0.035 + 0.17 * F + 0.5 * glint + 0.25 * foot) * uShow;
    vec3 c = (refl * (F * 0.62 + glint * 0.8) + tint * 0.035 - vec3(0.25) * foot) * uShow;
    gl_FragColor = vec4(c, a);
  }`;

export class GlassRoom {
  constructor(app) {
    this.app = app;
    this.on = false;
    this.show = 0;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.panes = [];
    for (let k = 0; k < 4; k++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uSize: { value: new THREE.Vector2(1, 1) },
          uLightDir: { value: new THREE.Vector3(-0.45, 0.8, 0.4).normalize() },
          uShow: { value: 0 },
          uDark: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        // (premultiplied: it darkens a touch by its alpha and adds its light)
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      m.frustumCulled = false;
      m.renderOrder = 5;
      this.group.add(m);
      this.panes.push(m);
    }
    app.fxScene.add(this.group);
    this._R = -1;
    this._H = -1;
  }

  setOn(on) {
    this.on = !!on;
    this.app.sb.p.box = this.on;
  }

  update(dt) {
    const app = this.app, sb = app.sb;
    this.show += ((this.on ? 1 : 0) - this.show) * Math.min(1, dt * 6);
    if (this.show < 0.003 && !this.on) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    // (as wide as the room's walls; a little over a cube and a half tall)
    const R = sb.p.arenaRadius, H = Math.max(1.25, sb.p.size * 1.6);
    if (R !== this._R || H !== this._H) {
      this._R = R;
      this._H = H;
      const at = [[0, R, 0], [0, -R, Math.PI], [R, 0, Math.PI / 2], [-R, 0, -Math.PI / 2]];
      this.panes.forEach((m, k) => {
        const [x, z, ry] = at[k];
        m.position.set(x, H / 2, z);
        m.rotation.set(0, ry, 0);
        m.scale.set(2 * R, H, 1);
        m.material.uniforms.uSize.value.set(2 * R, H);
      });
    }
    const dark = app.theme === 'dark' ? 1 : 0;
    for (const m of this.panes) {
      m.material.uniforms.uShow.value = this.show;
      m.material.uniforms.uDark.value = dark;
    }
  }
}
