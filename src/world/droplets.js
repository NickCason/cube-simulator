import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Little blobs of jelly blasted out of the cube (explosions, over-inflation).
// They fly ballistically, splat on the floor and wait for the heal, when they
// fly home and are absorbed.
export class Droplets {
  constructor(app) {
    this.app = app;
    this.max = 220;
    // (a soft, slightly lumpy blob: fine enough that it doesn't show facets)
    const geo = mergeVertices(new THREE.IcosahedronGeometry(1, 3));
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const n = 1 + 0.12 * Math.sin(x * 3.1 + y * 2.3) * Math.cos(z * 2.7 - y * 1.6);
      pos.setXYZ(i, x * n, y * n, z * n);
    }
    geo.computeVertexNormals();
    // jelly, not plastic: see-through and refracting what's behind it (the
    // colour tints the light coming through), glossy outside
    this.mat = new THREE.MeshPhysicalMaterial({
      color: 0xd4102a,
      roughness: 0.06,
      metalness: 0,
      transmission: 1,
      ior: 1.36,
      thickness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      envMap: app.env.texture,
      envMapIntensity: 1.1,
      sheen: 0.4,
      sheenColor: new THREE.Color(1, 0.6, 0.6),
    });
    // (glow mode: each shines in its own colour - emissive is set to the
    // glow level, times the droplet's colour)
    this.mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor.rgb * 1.2;\n#endif',
      );
    };
    this.mesh = new THREE.InstancedMesh(geo, this.mat, this.max);
    this.mesh.count = 0;
    this.mesh.visible = this.mesh.count > 0; // (see-through: three draws the scene behind it once more while it shows)
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    app.scene.add(this.mesh);
    this.items = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
    this.mat.color.set(0xffffff);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    app.onColor = app.onColor || [];
    app.onColor.push((hex) => this.setColor(hex));
    this._c = new THREE.Color();
  }

  setGlow(e) {
    this.mat.emissive.setScalar(e);
  }

  setColor(hex) {
    const c = new THREE.Color(hex);
    this.mat.sheenColor.copy(c).lerp(new THREE.Color(1, 1, 1), 0.4);
  }

  spawn(p, v, r, hex) {
    if (this.items.length >= this.max) this.items.shift();
    // droplets are opaque; use a slightly deeper tone of the local jelly colour
    const col = new THREE.Color(hex || this.app.flavorColorAt(p.x, p.y, p.z));
    const tex = this.app.style?.texture;
    if (tex === 'creamy') col.lerp(new THREE.Color(1, 1, 1), 0.35);
    this.items.push({
      col,
      p: p.clone(),
      v: v.clone(),
      r,
      rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      spin: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
      flat: 0,
      home: null,
      t: 0,
    });
  }

  // Fly home: wait `delay` seconds, then glide in over `travel` seconds.
  heal(target, delay = 0, travel = 0.8) {
    for (const d of this.items) {
      d.home = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.3) * 0.5, (Math.random() - 0.5) * 0.5));
      d.homeT = -(delay + Math.random() * 0.35);
      d.travel = travel;
      d.from = null;
    }
  }

  // New homes for the ones not yet on their way: home(out) writes one.
  retarget(home) {
    for (const d of this.items) {
      if (!d.home || d.homeT >= 0) continue;
      home(d.home);
    }
  }

  update(dt) {
    const g = this.app.sb.p.gravity;
    const R = this.app.sb.p.arenaRadius;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i];
      d.t += dt;
      if (d.home) {
        d.homeT += dt;
        if (d.homeT < 0) continue;
        if (!d.from) d.from = d.p.clone();
        // smooth arc home, un-squashing on the way, absorbed on arrival
        const u = Math.min(1, d.homeT / (d.travel || 0.8));
        const e = u * u * u * (u * (u * 6 - 15) + 10);
        d.p.lerpVectors(d.from, d.home, e);
        d.p.y += Math.sin(Math.PI * e) * 0.3;
        d.flat *= Math.exp(-dt * 8);
        d.rot.x += d.spin.x * dt * 0.3;
        d.rot.y += d.spin.y * dt * 0.3;
        if (u > 0.75) d.r *= Math.exp(-dt * 9);
        if (u >= 1 || d.r < 0.002) this.items.splice(i, 1);
        continue;
      }
      d.v.y += g * dt;
      d.p.addScaledVector(d.v, dt);
      d.rot.x += d.spin.x * dt;
      d.rot.y += d.spin.y * dt;
      d.rot.z += d.spin.z * dt;
      const floorY = d.r * (1 - d.flat * 0.55);
      if (d.p.y < floorY) {
        d.p.y = floorY;
        if (d.v.y < -1.5) {
          if (d.flat < 0.1) this.app.audio?.drip(-d.v.y, d.r, this.app.audio?._panOf(d.p));
          d.flat = Math.min(1, d.flat + 0.6);
        }
        d.v.y *= -0.15;
        d.v.x *= 0.7;
        d.v.z *= 0.7;
        d.spin.multiplyScalar(0.6);
      }
      const r = Math.hypot(d.p.x, d.p.z);
      if (r > R) {
        d.p.x *= R / r;
        d.p.z *= R / r;
        d.v.x *= -0.3;
        d.v.z *= -0.3;
      }
    }
    let c = 0;
    for (const d of this.items) {
      this._q.setFromEuler(d.flat > 0.5 ? this._e.set(0, d.rot.y, 0) : d.rot);
      const f = d.flat;
      this._s.set(d.r * (1 + f * 0.5), d.r * (1 - f * 0.55), d.r * (1 + f * 0.5));
      this._m.compose(d.p, this._q, this._s);
      this.mesh.setColorAt(c, d.col);
      this.mesh.setMatrixAt(c++, this._m);
    }
    this.mesh.count = c;
    this.mesh.visible = this.mesh.count > 0; // (see-through: three draws the scene behind it once more while it shows)
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.items.length = 0;
  }
}
