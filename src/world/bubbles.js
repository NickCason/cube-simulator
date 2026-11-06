import * as THREE from 'three';

const MAX = 240;

// Tiny air bubbles trapped in the gelatin. Each is anchored barycentrically
// in a tet, so it rides along with every wobble, slice and squash. Positions
// are fixed per bubble (seeded) and scale with the cube size.
export class Bubbles {
  constructor(app) {
    this.app = app;
    const geo = new THREE.SphereGeometry(1, 14, 10);
    // Air bubbles read as bright rims and glints. They are drawn after the
    // jelly at their true positions (refracting them through the screen-space
    // approximation smears them), tinted/dimmed by the jelly in front, with
    // their depth pulled to the jelly surface so tools in front still hide them.
    const mat = new THREE.ShaderMaterial({
      uniforms: { uLight: { value: app.lightDir } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aEntryZ;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vTint;
        void main() {
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          vTint = instanceColor;
          vec4 mv = viewMatrix * wp;
          vec4 clip = projectionMatrix * mv;
          vec4 surf = projectionMatrix * vec4(mv.xy, max(mv.z, aEntryZ), 1.0);
          clip.z = surf.z / surf.w * clip.w;
          gl_Position = clip;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uLight;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vTint;
        void main() {
          vec3 N = normalize(vN);
          float ndv = clamp(dot(N, vV), 0.0, 1.0);
          float rim = pow(1.0 - ndv, 2.5);
          float spec = pow(max(dot(reflect(-normalize(uLight), N), vV), 0.0), 50.0);
          vec3 c = vTint * (rim * 1.6 + 0.06) + vec3(6.0) * spec * (vTint + 0.2);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.entryZ = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aEntryZ', this.entryZ);
    this.mesh.renderOrder = 3;
    app.fxScene.add(this.mesh);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    this.items = [];
    for (let i = 0; i < MAX; i++) {
      // most bubbles float up near the top while the jelly sets
      const uy = 1 - 2 * Math.pow(rnd(), 2.2);
      this.items.push({
        u: [rnd() * 2 - 1, uy, rnd() * 2 - 1],
        r: 0.004 + Math.pow(rnd(), 3) * 0.013,
        a: { tet: -1, b: [0, 0, 0, 0] },
      });
    }
    this.count = 34;
    this.scale = 1;
    this.reseed();
    app.anchorProviders.push(() => this.items.slice(0, this.count).map((b) => b.a));
    app.onHealEnd.push(() => this.reseed());
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._t = [0, 0, 0];
  }

  configure(count, scale) {
    const n = Math.max(0, Math.min(MAX, Math.round(count)));
    const grew = n > this.count;
    this.count = n;
    this.scale = scale;
    if (grew) this.reseed();
  }

  // (Re)anchor bubbles at their rest positions inside the current mesh.
  reseed() {
    const sb = this.app.sb;
    const half = sb.p.size / 2;
    const m = Math.min(0.07, half * 0.15);
    for (let k = 0; k < this.count; k++) {
      const b = this.items[k];
      const X = b.u[0] * (half - m), Y = b.u[1] * (half - m), Z = b.u[2] * (half - m);
      const r = sb.locateRest(X, Y, Z);
      if (r) {
        b.a.tet = r.tet;
        b.a.b = r.bary;
        b.a.lost = false;
      } else b.a.tet = -1;
    }
  }

  update() {
    const app = this.app;
    const sb = app.sb;
    const cam = app.camera;
    const F = app.jelly.frontMat.uniforms;
    const sig = F.uAbsorb.value;
    const sc = F.uScatterColor.value;
    const haze = F.uHazeMin.value, scatter = F.uScatter.value;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    const vm = cam.matrixWorldInverse.elements;
    const tint = this._tint || (this._tint = new THREE.Color());
    let c = 0;
    const vis = (1 - haze) * (1 - haze);
    for (let k = 0; k < this.count && vis > 0.01; k++) {
      const b = this.items[k];
      if (b.a.tet < 0 || b.a.tet >= sb.nT || b.a.lost) continue;
      sb.embedPoint(b.a.tet, b.a.b, this._t);
      const px = this._t[0], py = this._t[1], pz = this._t[2];
      // where the line of sight enters this piece's bounding box
      const bb = sb.pieces[sb.tPiece[b.a.tet]]?.bbox;
      let dx = px - ox, dy = py - oy, dz = pz - oz;
      const len = Math.hypot(dx, dy, dz);
      dx /= len; dy /= len; dz /= len;
      let t0 = 0;
      if (bb) {
        let tmin = -Infinity;
        const sl = (o, d, lo, hi) => {
          if (Math.abs(d) < 1e-9) return;
          let a = (lo - o) / d, bq = (hi - o) / d;
          if (a > bq) [a, bq] = [bq, a];
          if (a > tmin) tmin = a;
        };
        sl(ox, dx, bb[0], bb[3]);
        sl(oy, dy, bb[1], bb[4]);
        sl(oz, dz, bb[2], bb[5]);
        t0 = Math.min(Math.max(tmin, 0), len);
      }
      const ex = ox + dx * t0, ey = oy + dy * t0, ez = oz + dz * t0;
      const L = len - t0;
      // view-space z of the entry point (slightly in front of the surface)
      const vz = vm[2] * ex + vm[6] * ey + vm[10] * ez + vm[14] + 0.02;
      this.entryZ.array[c] = vz;
      const fade = vis * Math.exp(-scatter * L * 0.8);
      tint.setRGB(
        (0.25 + 0.75 * sc.r) * Math.exp(-sig.x * L) * fade,
        (0.25 + 0.75 * sc.g) * Math.exp(-sig.y * L) * fade,
        (0.25 + 0.75 * sc.b) * Math.exp(-sig.z * L) * fade,
      );
      this.mesh.setColorAt(c, tint);
      this._p.set(px, py, pz);
      this._s.setScalar(b.r * this.scale * sb.p.size);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(c++, this._m);
    }
    this.mesh.count = c;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.entryZ.needsUpdate = true;
  }
}
