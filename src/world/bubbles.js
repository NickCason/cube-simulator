import * as THREE from 'three';

// Tiny air bubbles trapped in the gelatin. Each is anchored barycentrically
// in a tet, so it rides along with every wobble, slice and squash.
export class Bubbles {
  constructor(app, count = 34) {
    this.app = app;
    const geo = new THREE.SphereGeometry(1, 14, 10);
    // air bubbles in a denser medium look silvery: bright rim from total
    // internal reflection, a hot specular dot, a clearer centre
    const mat = new THREE.ShaderMaterial({
      uniforms: { uLight: { value: app.lightDir } },
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uLight;
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vec3 N = normalize(vN);
          float ndv = clamp(dot(N, vV), 0.0, 1.0);
          float rim = pow(1.0 - ndv, 2.2);
          float spec = pow(max(dot(reflect(-normalize(uLight), N), vV), 0.0), 60.0);
          vec3 c = vec3(1.25, 1.27, 1.3) * (0.55 + 0.45 * ndv) + vec3(3.2) * rim + vec3(12.0) * spec;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    app.scene.add(this.mesh);
    const half = app.sb.p.size / 2;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    this.items = [];
    for (let i = 0; i < count; i++) {
      // most bubbles float up near the top while the jelly sets
      const y = half - 0.06 - Math.pow(rnd(), 2.2) * (half * 2 - 0.14);
      const r = 0.004 + Math.pow(rnd(), 3) * 0.013;
      this.items.push({
        X: [(rnd() - 0.5) * (half * 2 - 0.16), y, (rnd() - 0.5) * (half * 2 - 0.16)],
        r,
        a: { tet: -1, b: [0, 0, 0, 0] },
      });
    }
    this.reseed();
    app.anchorProviders.push(() => this.items.map((b) => b.a));
    app.onHealEnd.push(() => this.reseed());
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._t = [0, 0, 0];
  }

  reseed() {
    const sb = this.app.sb;
    for (const b of this.items) {
      const r = sb.locateRest(b.X[0], b.X[1], b.X[2]);
      if (r) {
        b.a.tet = r.tet;
        b.a.b = r.bary;
        b.a.lost = false;
      } else b.a.tet = -1;
    }
  }

  update() {
    const sb = this.app.sb;
    let c = 0;
    for (const b of this.items) {
      if (b.a.tet < 0 || b.a.tet >= sb.nT || b.a.lost) continue;
      sb.embedPoint(b.a.tet, b.a.b, this._t);
      this._p.set(this._t[0], this._t[1], this._t[2]);
      this._s.setScalar(b.r);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(c++, this._m);
    }
    this.mesh.count = c;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
