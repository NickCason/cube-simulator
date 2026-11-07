import * as THREE from 'three';

export const NAIL_LEN = 0.3;
const SHAFT_R = 0.0085;
const HEAD_R = 0.024;

function nailGeometry() {
  const L = NAIL_LEN;
  const pts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(SHAFT_R * 0.35, 0.006),
    new THREE.Vector2(SHAFT_R, 0.028),
    new THREE.Vector2(SHAFT_R, L - 0.012),
    new THREE.Vector2(SHAFT_R * 1.25, L - 0.007),
    new THREE.Vector2(HEAD_R, L - 0.006),
    new THREE.Vector2(HEAD_R, L - 0.002),
    new THREE.Vector2(HEAD_R * 0.9, L),
    new THREE.Vector2(0.0, L + 0.0005),
  ];
  const g = new THREE.LatheGeometry(pts, 14);
  g.computeVertexNormals();
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);

// Nails: flying projectiles, embedded in the jelly (barycentric anchors with
// a rigid distance constraint), ejected on heal, and free rigid rods that
// clatter on the floor.
export class NailSystem {
  constructor(app) {
    this.app = app;
    this.max = 180;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc9ccd2,
      metalness: 1.0,
      roughness: 0.3,
      envMap: app.env.texture,
      envMapIntensity: 1.2,
      transparent: false,
    });
    this.mesh = new THREE.InstancedMesh(nailGeometry(), mat, this.max);
    this.mesh.castShadow = true;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    app.scene.add(this.mesh);
    this.nails = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._p = [0, 0, 0];
    this._p2 = [0, 0, 0];
  }

  anchors() {
    const out = [];
    for (const n of this.nails) if (n.state === 'embedded') out.push(n.aTip, n.aBack);
    return out;
  }

  get embeddedCount() {
    let c = 0;
    for (const n of this.nails) if (n.state === 'embedded') c++;
    return c;
  }

  fire(origin, dir, speed = 34) {
    if (this.nails.length >= this.max) this._recycle();
    const n = {
      state: 'flying',
      tip: new THREE.Vector3().copy(origin),
      vel: new THREE.Vector3().copy(dir).multiplyScalar(speed),
      axis: new THREE.Vector3().copy(dir).negate(),
      life: 0,
      fade: 1,
    };
    this.nails.push(n);
    return n;
  }

  _recycle() {
    const i = this.nails.findIndex((n) => n.state === 'free');
    if (i >= 0) this.nails.splice(i, 1);
    else this.nails.shift();
  }

  _toFree(n, vel, spin = 0) {
    const L = NAIL_LEN;
    n.state = 'free';
    n.pull = 0;
    n.p0 = n.tip.clone();
    n.p1 = n.tip.clone().addScaledVector(n.axis, L);
    const vt = vel.clone();
    const vh = vel.clone();
    if (spin) {
      const side = new THREE.Vector3().crossVectors(n.axis, UP).normalize();
      if (side.lengthSq() < 0.1) side.set(1, 0, 0);
      vt.addScaledVector(side, spin);
      vh.addScaledVector(side, -spin);
    }
    // (its velocity goes in as the last step back - a substep's worth, set
    // at the first update: 1/60 s back, when the rod steps 3 substeps a
    // frame, sent freed nails off 3x too fast - 15x in slow motion)
    n.q0 = n.p0.clone();
    n.q1 = n.p1.clone();
    n.v0 = vt;
    n.v1 = vh;
    n.rest = 0;
  }

  removeEmbedConstraint(n) {
    const sb = this.app.sb;
    const i = sb.embeds.indexOf(n.embed);
    if (i >= 0) sb.embeds.splice(i, 1);
  }

  // Called by the heal sequence: slide nails out and pop them free. (cube:
  // just the ones in that cube - it re-cubes alone; the rest stay put)
  ejectAll(cube = -1) {
    let k = 0;
    const sb = this.app.sb;
    for (const n of this.nails) {
      if (cube >= 0 && !(n.state === 'embedded' && n.embed && sb.tCube[n.embed.a.tet] === cube)) continue;
      if (n.state === 'embedded') {
        this.removeEmbedConstraint(n);
        n.state = 'ejecting';
        n.ej = -0.06 * k++; // stagger
        n.ejDepth = n.depth - (n.pull || 0);
      } else if (n.state === 'free' || n.state === 'flying' || n.state === 'stuck') {
        if (n.state === 'stuck') this._toFree(n, new THREE.Vector3(0, -0.5, 0), 1);
        n.fadeOut = 2.5 + Math.random();
      }
    }
    return k;
  }

  update(dt) {
    const app = this.app;
    const sb = app.sb;
    const g = sb.p.gravity;
    for (let idx = this.nails.length - 1; idx >= 0; idx--) {
      const n = this.nails[idx];
      n.life += dt;
      if (n.fadeOut !== undefined) {
        n.fadeOut -= dt;
        if (n.fadeOut <= 0) {
          this.nails.splice(idx, 1);
          continue;
        }
      }
      if (n.state === 'flying') this._updateFlying(n, dt, g);
      else if (n.state === 'embedded') this._updateEmbedded(n);
      else if (n.state === 'ejecting') this._updateEjecting(n, dt);
      else if (n.state === 'free') this._updateFree(n, dt, g);
      if (n.dead) this.nails.splice(idx, 1);
    }
    this._writeInstances();
  }

  _updateFlying(n, dt, g) {
    const sb = this.app.sb;
    const prev = this._v.copy(n.tip);
    n.vel.y += g * 0.15 * dt;
    const step = n.vel.length() * dt;
    const dir = this._a.copy(n.vel).normalize();
    const hit = sb.raycast(prev.x, prev.y, prev.z, dir.x, dir.y, dir.z, step + 0.001);
    if (hit) {
      this._embed(n, hit, dir);
      return;
    }
    n.tip.addScaledVector(n.vel, dt);
    n.axis.copy(dir).negate();
    if (n.tip.y < 0) {
      // ricochet off the floor
      n.tip.y = 0.002;
      const v = n.vel.clone();
      v.y = Math.abs(v.y) * 0.25;
      v.x *= 0.35;
      v.z *= 0.35;
      this._toFree(n, v, 4 + Math.random() * 4);
      this.app.audio?.clink(0.9, n.tip);
      this.app.particles?.sparks(n.tip, 10);
    } else if (n.tip.lengthSq() > 80 || n.life > 2) n.dead = true;
  }

  _embed(n, hit, dir) {
    const sb = this.app.sb;
    const L = NAIL_LEN;
    const hp = new THREE.Vector3(...hit.point);
    const pen = L * (0.8 + Math.random() * 0.1);
    // sample along the shaft to find points that are inside the jelly
    const inside = [];
    for (let k = 0; k <= 8; k++) {
      const d = 0.012 + (pen - 0.012) * (k / 8);
      const p = hp.clone().addScaledVector(dir, d);
      const r = sb.locate(p.x, p.y, p.z, hit.piece);
      if (r && r.score > -0.02) inside.push({ d, r });
    }
    if (inside.length < 2) {
      // grazed a thin sliver: keep flying
      n.tip.copy(hp).addScaledVector(dir, 0.02);
      n.vel.multiplyScalar(0.6);
      return;
    }
    const first = inside[0], last = inside[inside.length - 1];
    const aTip = { tet: last.r.tet, b: last.r.bary.slice() };
    const aBack = { tet: first.r.tet, b: first.r.bary.slice() };
    n.state = 'embedded';
    n.aTip = aTip;
    n.aBack = aBack;
    n.tipOffset = pen - last.d; // tip beyond the last anchor
    n.depth = pen;
    n.embed = { a: aTip, b: aBack, len: last.d - first.d, compliance: 2e-7 };
    sb.embeds.push(n.embed);
    sb.impulse(hp.x, hp.y, hp.z, dir.x, dir.y, dir.z, 0.28, 2.6 * (this.app.st?.nailPower ?? 1), hit.piece);
    this.app.onNailHit?.(hp, dir, hit);
    this._updateEmbedded(n);
  }

  _updateEmbedded(n) {
    const sb = this.app.sb;
    if (n.aTip.tet < 0 || n.aBack.tet < 0 || n.aTip.tet >= sb.nT || n.aBack.tet >= sb.nT) {
      this.removeEmbedConstraint(n);
      this._toFree(n, new THREE.Vector3(0, 1, 0), 2);
      return;
    }
    this._place(n);
  }

  // Put an embedded nail where its anchors say, slid out by n.pull.
  _place(n) {
    const sb = this.app.sb;
    const a = sb.embedPoint(n.aTip.tet, n.aTip.b, this._p);
    const b = sb.embedPoint(n.aBack.tet, n.aBack.b, this._p2);
    const ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2];
    const l = Math.hypot(ax, ay, az) || 1;
    n.axis.set(ax / l, ay / l, az / l);
    n.tip.set(a[0], a[1], a[2]).addScaledVector(n.axis, (n.pull || 0) - n.tipOffset);
  }

  // Work an embedded nail out along its shaft by `dist`; once all of it is
  // out it pops free with velocity `vel` (the jelly snaps back). Returns
  // true when it popped.
  slideOut(n, dist, vel) {
    if (n.state !== 'embedded') return false;
    n.pull = Math.min(n.depth, (n.pull || 0) + dist);
    this._place(n);
    if (n.pull < n.depth - 0.012) return false;
    const sb = this.app.sb;
    this.removeEmbedConstraint(n);
    const exit = n.tip.clone().addScaledVector(n.axis, 0.012);
    sb.impulse(exit.x, exit.y, exit.z, -n.axis.x, -n.axis.y, -n.axis.z, 0.22, 1.4);
    this._toFree(n, vel, 2 + Math.random() * 3);
    n.pull = 0;
    // a couple of wet flecks follow it out
    for (let k = 0; k < 3; k++) {
      const v = n.axis.clone().multiplyScalar(1.2 + Math.random() * 1.5).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, Math.random() * 1.2, (Math.random() - 0.5) * 1.2));
      this.app.droplets?.spawn(exit, v, 0.006 + Math.random() * 0.008);
    }
    this.app.audio?.unplug?.(1, exit);
    return true;
  }

  _updateEjecting(n, dt) {
    const sb = this.app.sb;
    n.ej += dt;
    if (n.ej < 0) {
      this._updateEmbedded(n);
      return;
    }
    // follow the jelly while sliding out along the axis
    if (n.aTip.tet >= 0 && n.aTip.tet < sb.nT && n.aBack.tet >= 0 && n.aBack.tet < sb.nT) this._place(n);
    const T = 0.32;
    const u = Math.min(n.ej / T, 1);
    const ease = u * u * (3 - 2 * u);
    n.tip.addScaledVector(n.axis, (n.ejDepth + 0.02) * ease);
    if (u >= 1) {
      const v = n.axis.clone().multiplyScalar(3.2 + Math.random() * 1.5);
      v.y += 2.2;
      v.x += (Math.random() - 0.5) * 1.2;
      v.z += (Math.random() - 0.5) * 1.2;
      // reaction on the jelly
      sb.impulse(n.tip.x, n.tip.y, n.tip.z, -n.axis.x, -n.axis.y, -n.axis.z, 0.2, 0.8);
      this._toFree(n, v, 3 + Math.random() * 5);
      this.app.audio?.pop(0.6);
      n.fadeOut = 2.8 + Math.random() * 0.8;
    }
  }

  _updateFree(n, dt, g) {
    // two-particle rigid rod with floor + arena contact
    const L = NAIL_LEN;
    const R = this.app.sb.p.arenaRadius + 0.2;
    if (n.rest > 1.0) return;
    const sub = 3;
    const h = dt / sub;
    if (n.v0) {
      n.q0.copy(n.p0).addScaledVector(n.v0, -h);
      n.q1.copy(n.p1).addScaledVector(n.v1, -h);
      n.v0 = n.v1 = null;
    }
    for (let s = 0; s < sub; s++) {
      for (const [p, q] of [[n.p0, n.q0], [n.p1, n.q1]]) {
        const vx = (p.x - q.x) * 0.999, vy = (p.y - q.y) * 0.999, vz = (p.z - q.z) * 0.999;
        q.copy(p);
        p.x += vx;
        p.y += vy + g * h * h;
        p.z += vz;
      }
      // rod
      const d = this._v.subVectors(n.p1, n.p0);
      const len = d.length() || 1;
      const corr = (len - L) / len * 0.5;
      n.p0.addScaledVector(d, corr);
      n.p1.addScaledVector(d, -corr);
      for (const [p, q, rad] of [[n.p0, n.q0, 0.004], [n.p1, n.q1, HEAD_R]]) {
        if (p.y < rad) {
          const vy = p.y - q.y;
          p.y = rad;
          q.y = rad + vy * 0.35; // restitution
          // friction
          q.x += (p.x - q.x) * 0.25;
          q.z += (p.z - q.z) * 0.25;
          if (-vy / h > 2.2 && !n.quiet) {
            this.app.audio?.clink(Math.min(1, -vy / h / 6), p);
          }
        }
        if (this.app.sb.p.box) {
          // (the glass room: square, at the glass)
          const G = R - 0.22;
          if (Math.abs(p.x) > G) p.x = Math.sign(p.x) * G;
          if (Math.abs(p.z) > G) p.z = Math.sign(p.z) * G;
        } else {
          const r = Math.hypot(p.x, p.z);
          if (r > R) {
            p.x *= R / r;
            p.z *= R / r;
          }
        }
      }
    }
    const speed = n.p0.distanceTo(n.q0) / h + n.p1.distanceTo(n.q1) / h;
    n.rest = speed < 0.05 ? n.rest + dt : 0;
    n.tip.copy(n.p0);
    n.axis.subVectors(n.p1, n.p0).normalize();
  }

  _writeInstances() {
    let c = 0;
    for (const n of this.nails) {
      if (c >= this.max) break;
      this._q.setFromUnitVectors(UP, n.axis);
      let sc = 1;
      if (n.fadeOut !== undefined && n.fadeOut < 0.6) sc = Math.max(0.001, n.fadeOut / 0.6);
      this._s.set(sc, sc, sc);
      this._m.compose(n.tip, this._q, this._s);
      this.mesh.setMatrixAt(c++, this._m);
    }
    this.mesh.count = c;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clearAll() {
    for (const n of this.nails) if (n.state === 'embedded') this.removeEmbedConstraint(n);
    this.nails.length = 0;
    this._writeInstances();
  }
}
