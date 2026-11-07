import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Little blobs of jelly blasted out of the cube (explosions, over-inflation).
// They fly ballistically, splat on the floor and wait for the heal, when they
// fly home and are absorbed. Frozen (the cryo spray catches them, and the
// chips of anything brittle come out that way) they're little ice cubes
// instead: they clink, slide and settle flat on a face.

// (a cube as big as a blob of radius 1: the same volume)
const ICE_SIDE = Math.cbrt((4 / 3) * Math.PI);
const WHITE = new THREE.Color(1, 1, 1);
const smooth01 = (x) => x * x * (3 - 2 * x);
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
    // the frozen ones: little rounded ice cubes, frosted and see-through
    this.iceMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.16,
      metalness: 0,
      transmission: 0.94,
      ior: 1.31,
      thickness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      envMap: app.env.texture,
      envMapIntensity: 1.25,
      sheen: 0.5,
      sheenColor: new THREE.Color(0.85, 0.93, 1),
    });
    this.iceMat.onBeforeCompile = this.mat.onBeforeCompile;
    this.ice = new THREE.InstancedMesh(new RoundedBoxGeometry(ICE_SIDE, ICE_SIDE, ICE_SIDE, 2, ICE_SIDE * 0.16), this.iceMat, this.max);
    this.ice.count = 0;
    this.ice.visible = false;
    this.ice.frustumCulled = false;
    this.ice.castShadow = false;
    this.ice.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ice.setColorAt(0, new THREE.Color(1, 1, 1));
    app.scene.add(this.ice);
    this._ic = new THREE.Color();
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
    this.iceMat.emissive.setScalar(e * 0.6);
  }

  setColor(hex) {
    const c = new THREE.Color(hex);
    this.mat.sheenColor.copy(c).lerp(new THREE.Color(1, 1, 1), 0.4);
  }

  // (opts.frozen: a little ice cube from the start - brittle chips)
  spawn(p, v, r, hex, opts = null) {
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
      frozen: !!opts?.frozen,
      ice: opts?.frozen ? 1 : 0, // (0 a blob .. 1 an ice cube: it morphs)
      cold: 0,
    });
  }

  // The cryo spray from tip to where it's aimed: blobs in it (near its line,
  // or round where it lands) chill, and freeze into ice cubes. How many froze.
  freeze(tip, at, radius, dt) {
    let n = 0;
    const dx = at.x - tip.x, dy = at.y - tip.y, dz = at.z - tip.z, L2 = dx * dx + dy * dy + dz * dz || 1;
    for (const d of this.items) {
      if (d.frozen || d.home) continue;
      // nearest point of the spray's line to it
      const t = Math.min(1, Math.max(0, ((d.p.x - tip.x) * dx + (d.p.y - tip.y) * dy + (d.p.z - tip.z) * dz) / L2));
      const ex = tip.x + dx * t - d.p.x, ey = tip.y + dy * t - d.p.y, ez = tip.z + dz * t - d.p.z;
      const reach = radius * (0.35 + 0.65 * t);
      if (ex * ex + ey * ey + ez * ez > reach * reach) continue;
      d.cold += dt * 6;
      if (d.cold > 1) {
        d.frozen = true;
        d.flat = 0;
        d.spin.multiplyScalar(0.3);
        n++;
        this.app.particles?.mist(d.p, new THREE.Vector3(0, 0.4, 0), 2);
      }
    }
    return n;
  }

  // Fly home: wait `delay` seconds, then glide in over `travel` seconds.
  heal(target, delay = 0, travel = 0.8) {
    for (const d of this.items) {
      d.frozen = false; // (they thaw on the way home)
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
      d.ice = Math.min(1, Math.max(0, d.ice + (d.frozen ? dt / 0.22 : -dt / 0.4)));
      if (d.ice > 0.5) {
        // an ice cube: knocks and clinks, slides, comes to rest flat on a face
        const floorY = d.r * ICE_SIDE * 0.5;
        if (d.p.y < floorY) {
          d.p.y = floorY;
          if (d.v.y < -0.8) this.app.audio?.clink(Math.min(1, -d.v.y * 0.18) * Math.min(1, d.r * 40), d.p);
          d.v.y *= d.v.y < -0.8 ? -0.38 : 0;
          d.v.x *= 0.9;
          d.v.z *= 0.9;
          d.spin.x *= 0.5;
          d.spin.z *= 0.5;
        }
        if (d.p.y <= floorY + 1e-3) {
          // (sliding: ice hardly grips; tipping over onto the nearest face)
          const k = Math.exp(-dt * 0.9);
          d.v.x *= k;
          d.v.z *= k;
          d.spin.y *= Math.exp(-dt * 1.5);
          const q = Math.PI / 2, s = Math.min(1, dt * 10);
          d.rot.x += (Math.round(d.rot.x / q) * q - d.rot.x) * s;
          d.rot.z += (Math.round(d.rot.z / q) * q - d.rot.z) * s;
          d.spin.x *= 0.8;
          d.spin.z *= 0.8;
        }
      } else {
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
      }
      const r = Math.hypot(d.p.x, d.p.z);
      if (r > R) {
        d.p.x *= R / r;
        d.p.z *= R / r;
        d.v.x *= -0.3;
        d.v.z *= -0.3;
      }
    }
    let c = 0, ci = 0;
    for (const d of this.items) {
      // (in home flight a frozen one has thawed: see heal)
      if (d.home) d.ice = Math.max(0, d.ice - dt / 0.3);
      const blob = 1 - smooth01(d.ice), cube = smooth01(d.ice);
      if (blob > 0.02) {
        this._q.setFromEuler(d.flat > 0.5 ? this._e.set(0, d.rot.y, 0) : d.rot);
        const f = d.flat, r = d.r * blob;
        this._s.set(r * (1 + f * 0.5), r * (1 - f * 0.55), r * (1 + f * 0.5));
        this._m.compose(d.p, this._q, this._s);
        this.mesh.setColorAt(c, d.col);
        this.mesh.setMatrixAt(c++, this._m);
      }
      if (cube > 0.02) {
        this._q.setFromEuler(d.rot);
        this._s.setScalar(d.r * cube);
        this._m.compose(d.p, this._q, this._s);
        // (icy: its colour washed toward white)
        this.ice.setColorAt(ci, this._ic.copy(d.col).lerp(WHITE, 0.32));
        this.ice.setMatrixAt(ci++, this._m);
      }
    }
    this.mesh.count = c;
    this.mesh.visible = this.mesh.count > 0; // (see-through: three draws the scene behind it once more while it shows)
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.ice.count = ci;
    this.ice.visible = ci > 0;
    this.ice.instanceMatrix.needsUpdate = true;
    if (this.ice.instanceColor) this.ice.instanceColor.needsUpdate = true;
  }

  get n() {
    return this.items.length;
  }

  clear() {
    this.items.length = 0;
  }
}
