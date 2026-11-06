import * as THREE from 'three';

// Little blobs of jelly blasted out of the cube (explosions, over-inflation).
// They fly ballistically, splat on the floor and wait for the heal, when they
// fly home and are absorbed.
export class Droplets {
  constructor(app) {
    this.app = app;
    this.max = 220;
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const n = 1 + 0.18 * Math.sin(x * 5.1 + y * 3.3) * Math.cos(z * 4.7 - y * 2.1);
      pos.setXYZ(i, x * n, y * n, z * n);
    }
    geo.computeVertexNormals();
    this.mat = new THREE.MeshPhysicalMaterial({
      color: 0xd4102a,
      roughness: 0.08,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      envMap: app.env.texture,
      envMapIntensity: 1.1,
      sheen: 0.4,
      sheenColor: new THREE.Color(1, 0.6, 0.6),
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, this.max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    app.scene.add(this.mesh);
    this.items = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
    app.onColor = app.onColor || [];
    app.onColor.push((hex) => this.setColor(hex));
  }

  setColor(hex) {
    const c = new THREE.Color(hex);
    // droplets are opaque; use a slightly deeper, more saturated tone
    this.mat.color.copy(c).multiplyScalar(0.75);
    this.mat.sheenColor.copy(c).lerp(new THREE.Color(1, 1, 1), 0.4);
  }

  spawn(p, v, r) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({
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

  heal(target) {
    for (const d of this.items) {
      d.home = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, Math.random() * 0.5, (Math.random() - 0.5) * 0.5));
      d.homeT = -Math.random() * 0.3;
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
        const u = Math.min(1, d.homeT / 0.8);
        const k = 1 - Math.exp(-dt * (2 + 14 * u));
        d.p.lerp(d.home, k);
        d.flat *= 0.9;
        d.r *= u > 0.6 ? Math.exp(-dt * 6) : 1;
        if (u >= 1 || d.r < 0.003) this.items.splice(i, 1);
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
          if (d.flat < 0.1) this.app.audio?.squish(Math.min(0.5, -d.v.y / 12), 1.6);
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
      this.mesh.setMatrixAt(c++, this._m);
    }
    this.mesh.count = c;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.items.length = 0;
  }
}
