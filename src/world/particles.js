import * as THREE from 'three';

// CPU particles rendered as soft point sprites. Two layers: additive
// (fire, sparks, flashes) and alpha-blended (smoke, frost mist).
class Layer {
  constructor(max, additive) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.c0 = new Float32Array(max * 4);
    this.c1 = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.seed = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aSeed = new THREE.BufferAttribute(this.seed, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aCol', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aSeed', this.aSeed);
    this.uniforms = { uScale: { value: 600 }, uTime: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      vertexShader: /* glsl */ `
        attribute vec4 aCol;
        attribute float aSize;
        attribute float aSeed;
        uniform float uScale;
        varying vec4 vCol;
        varying float vSeed;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(-mv.z, 0.05);
          vCol = aCol;
          vSeed = aSeed;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec4 vCol;
        varying float vSeed;
        float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + vSeed * 17.0) * 43758.5453); }
        float n2(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
        }
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r = length(p);
          if (r > 1.0) discard;
          float a = 1.0 - smoothstep(0.0, 1.0, r);
          a *= a;
          ${additive ? '' : 'a *= 0.55 + 0.45 * n2(p * 2.5 + vSeed * 9.0);'}
          ${additive ? 'gl_FragColor = vec4(vCol.rgb, vCol.a * a);' : 'gl_FragColor = vec4(vCol.rgb * vCol.a * a, vCol.a * a);'}
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 2 : 1;
  }

  spawn(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, drag = 1, grav = 0) {
    let i;
    if (this.n < this.max) i = this.n++;
    else i = Math.floor(Math.random() * this.max);
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = 0;
    this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1;
    for (let k = 0; k < 4; k++) {
      this.c0[i * 4 + k] = c0[k];
      this.c1[i * 4 + k] = c1[k];
    }
    this.drag[i] = drag;
    this.grav[i] = grav;
    this.seed[i] = Math.random();
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) {
        const j = --this.n;
        if (i !== j) this._move(j, i);
        continue;
      }
      const u = this.life[i] / this.maxLife[i];
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.004) {
        this.pos[i * 3 + 1] = 0.004;
        this.vel[i * 3 + 1] *= -0.3;
      }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * u;
      const fade = u < 0.12 ? u / 0.12 : 1 - (u - 0.12) / 0.88;
      for (let k = 0; k < 3; k++) this.col[i * 4 + k] = this.c0[i * 4 + k] + (this.c1[i * 4 + k] - this.c0[i * 4 + k]) * u;
      this.col[i * 4 + 3] = (this.c0[i * 4 + 3] + (this.c1[i * 4 + 3] - this.c0[i * 4 + 3]) * u) * Math.max(fade, 0);
      i++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aSeed.needsUpdate = true;
  }

  _move(j, i) {
    for (let k = 0; k < 3; k++) {
      this.pos[i * 3 + k] = this.pos[j * 3 + k];
      this.vel[i * 3 + k] = this.vel[j * 3 + k];
    }
    for (let k = 0; k < 4; k++) {
      this.col[i * 4 + k] = this.col[j * 4 + k];
      this.c0[i * 4 + k] = this.c0[j * 4 + k];
      this.c1[i * 4 + k] = this.c1[j * 4 + k];
    }
    this.size[i] = this.size[j];
    this.s0[i] = this.s0[j];
    this.s1[i] = this.s1[j];
    this.life[i] = this.life[j];
    this.maxLife[i] = this.maxLife[j];
    this.drag[i] = this.drag[j];
    this.grav[i] = this.grav[j];
    this.seed[i] = this.seed[j];
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);

export class Particles {
  constructor(app) {
    this.app = app;
    this.add = new Layer(2500, true);
    this.alpha = new Layer(1500, false);
    this.scene = new THREE.Scene();
    this.scene.add(this.alpha.points, this.add.points);
  }

  update(dt) {
    const cam = this.app.camera;
    const scale = this.app.size.ph / (2 * Math.tan((cam.fov * Math.PI) / 360));
    this.add.uniforms.uScale.value = scale;
    this.alpha.uniforms.uScale.value = scale;
    this.add.update(dt);
    this.alpha.update(dt);
  }

  sparks(p, n = 12, speed = 2.5, color = [1.0, 0.75, 0.35]) {
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI * 0.5;
      const s = speed * rnd(0.4, 1);
      this.add.spawn(p.x, p.y, p.z, Math.cos(th) * Math.cos(ph) * s, Math.sin(ph) * s * 1.2, Math.sin(th) * Math.cos(ph) * s,
        rnd(0.18, 0.45), 0.018, 0.004, [color[0] * 6, color[1] * 6, color[2] * 6, 1], [color[0] * 2, color[1] * 0.8, color[2] * 0.3, 0.8], 2.0, -9);
    }
  }

  flame(p, dir, intensity = 1) {
    for (let i = 0; i < 4; i++) {
      const s = rnd(1.6, 2.6);
      const jx = rnd(-0.25, 0.25), jy = rnd(-0.25, 0.25), jz = rnd(-0.25, 0.25);
      const core = Math.random() < 0.5;
      if (core) {
        this.add.spawn(p.x, p.y, p.z, (dir.x + jx * 0.4) * s, (dir.y + jy * 0.4) * s, (dir.z + jz * 0.4) * s,
          rnd(0.06, 0.12), 0.02, 0.05, [0.25 * intensity, 0.4 * intensity, 2.4 * intensity, 1], [0.4, 0.35, 1.4, 0.4], 3.5, 0.5);
      } else {
        this.add.spawn(p.x, p.y, p.z, (dir.x + jx) * s, (dir.y + jy) * s, (dir.z + jz) * s,
          rnd(0.14, 0.32), 0.035, rnd(0.11, 0.2), [2.2 * intensity, 0.75 * intensity, 0.12 * intensity, 0.85], [1.1, 0.16, 0.02, 0.0], 3.6, 2.5);
      }
    }
  }

  smoke(p, n = 4, spread = 0.3, dark = 0.35, rise = 0.6, size = 0.25) {
    for (let i = 0; i < n; i++) {
      const c = dark * rnd(0.85, 1.15);
      this.alpha.spawn(p.x + rnd(-0.03, 0.03), p.y + rnd(-0.03, 0.03), p.z + rnd(-0.03, 0.03),
        rnd(-spread, spread), rnd(0.1, 0.5) + rise, rnd(-spread, spread),
        rnd(1.2, 2.2), size * 0.35, size * rnd(1.4, 2.2), [c, c, c, 0.55], [c * 1.1, c * 1.1, c * 1.1, 0.0], 1.4, 0.25);
    }
  }

  mist(p, dir, n = 3) {
    for (let i = 0; i < n; i++) {
      const s = rnd(1.4, 2.6);
      this.alpha.spawn(p.x, p.y, p.z, (dir.x + rnd(-0.25, 0.25)) * s, (dir.y + rnd(-0.25, 0.25)) * s, (dir.z + rnd(-0.25, 0.25)) * s,
        rnd(0.7, 1.5), 0.04, rnd(0.22, 0.4), [1.15, 1.2, 1.3, 0.7], [1.0, 1.02, 1.05, 0.0], 3.0, -0.3);
    }
    // icy glints in the jet
    if (Math.random() < 0.6) {
      this.add.spawn(p.x, p.y, p.z, dir.x * 2.2 + rnd(-0.4, 0.4), dir.y * 2.2 + rnd(-0.4, 0.4), dir.z * 2.2 + rnd(-0.4, 0.4),
        rnd(0.2, 0.4), 0.012, 0.004, [2.5, 3.0, 3.5, 1], [1.0, 1.3, 1.6, 0], 2.0, -1.0);
    }
  }

  flash(p, size = 1.2, color = [12, 8, 4]) {
    this.add.spawn(p.x, p.y, p.z, 0, 0, 0, 0.16, size, size * 1.6, [color[0], color[1], color[2], 1], [color[0] * 0.3, color[1] * 0.2, color[2] * 0.1, 0], 0, 0);
  }

  glitter(p, n = 2, color = [1.0, 0.85, 0.55], spread = 0.4) {
    for (let i = 0; i < n; i++) {
      this.add.spawn(p.x + rnd(-spread, spread) * 0.3, p.y + rnd(-spread, spread) * 0.3, p.z + rnd(-spread, spread) * 0.3,
        rnd(-spread, spread), rnd(0.2, 0.9), rnd(-spread, spread),
        rnd(0.5, 1.1), 0.02, 0.0, [color[0] * 5, color[1] * 5, color[2] * 5, 1], [color[0] * 2, color[1] * 2, color[2] * 2, 0], 1.5, -0.4);
    }
  }
}
