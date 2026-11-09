// Full auto: a little rotary gun. Hold and its six barrels whine up to speed,
// then it lets rip - fourteen rounds a second, along the line of sight with a
// little scatter. Every round: a tracer, a muzzle flash that lights the jelly,
// a smack and a spit of jelly where it hits, brass flung out of its side to
// bounce and clink across the floor. Every few rounds one bores right
// through, as the hole gun's does (narrower) - fewer on a device the boring
// costs more, so the frames keep coming. Let go and the barrels spin down.

import * as THREE from 'three';
import { HoleGunTool } from './basic.js';
import { makeAutoGun } from '../world/models.js';

const RATE = 14; // rounds a second, spun up
const SPIN_UP = 0.32; // s
const SPIN_DOWN = 0.85;
const MAX_CASINGS = 140;

export class AutoGunTool extends HoleGunTool {
  constructor(app) {
    super(app);
    this.id = 'autogun';
    app.scene.remove(this.model);
    this.model = makeAutoGun(app.M);
    this.model.visible = false;
    this.model.traverse((o) => (o.castShadow = false));
    app.scene.add(this.model);
    this.spinner = this.model.getObjectByName('spin');
    this.spin = 0;
    this.angle = 0;
    this.round = 0;
    this.boreEvery = 4;
    this.boreMs = 0; // (how long a tunnel takes here, smoothed)
    this.lastBore = 0;
    this.coarse = !!window.matchMedia?.('(pointer: coarse)').matches; // (a phone: lighter on the spray)
    // the brass
    this.casings = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.022, 8), app.M.brass, MAX_CASINGS);
    this.casings.count = 0;
    this.casings.frustumCulled = false;
    this.casings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    app.scene.add(this.casings);
    this.cs = [];
    // the tracers: a few thin bright streaks, reused
    const tg = new THREE.CylinderGeometry(0.0035, 0.0035, 1, 6);
    tg.translate(0, 0.5, 0);
    tg.rotateX(Math.PI / 2);
    this.tracers = [];
    for (let k = 0; k < 6; k++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffd38c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false;
      m.frustumCulled = false;
      m.life = 0;
      app.fxScene.add(m);
      this.tracers.push(m);
    }
    this.tk = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  deactivate() {
    super.deactivate();
    this.spin = 0;
    this.app.audio?.spin(0);
  }

  // (put down, its brass still falls, comes to rest and goes - it hung in
  // the air where it was, for good, when only the gun in hand moved it)
  get background() {
    return this.cs.length > 0;
  }

  // (no round till the barrels are up to speed)
  down(e, ray) {
    this.firing = true;
    this.ray.copy(ray);
    return true;
  }

  update(dt, rdt) {
    const t = rdt || dt;
    if (this.app.tool !== this) {
      this._brass(dt);
      this._fade(t);
      return;
    }
    this._placeModel(t);
    this.spin = this.firing ? Math.min(1, this.spin + t / SPIN_UP) : Math.max(0, this.spin - t / SPIN_DOWN);
    this.angle += this.spin * 38 * t;
    if (this.spinner) this.spinner.rotation.z = this.angle;
    this.app.audio?.spin(this.spin);
    if (this.firing && this.spin > 0.85) {
      // (by the wall clock: not the simulation's time - a busy phone slows
      // the jelly's time to keep up, and on that clock it fired a round a
      // second - nor the frame's, which stops at 1/30 s)
      this.cool -= Math.min(this.app._rawDt ?? t, 0.25);
      // (up to four a frame, so a slow phone still gets its fourteen a second)
      for (let n = 0; n < 4 && this.cool <= 0; n++) {
        this.fire();
        this.cool += 1 / (RATE * (this.app.st?.autoRate ?? 1));
      }
      if (this.cool < 0) this.cool = 0;
    } else this.cool = 0;
    this._brass(dt);
    this._fade(t);
  }

  fire() {
    const app = this.app, sb = app.sb;
    this.round++;
    app.tally?.('shots');
    const muzzle = this.model.localToWorld(new THREE.Vector3(0, 0, -0.33));
    this.recoil = Math.min(1.1, this.recoil + 0.4);
    app.particles.flash(muzzle, 0.06, [9, 7, 4]);
    if (this.round % 3 === 0) app.particles.smoke(muzzle, 1, 0.1, 0.5, 0.3, 0.12);
    app.fireAt(muzzle, 0.55);
    app.shake(0.004);
    // where it goes: from the eye through the cursor, scattering a little
    const o = this.ray.origin, d = this.ray.direction.clone();
    d.x += (Math.random() - 0.5) * 0.04;
    d.y += (Math.random() - 0.5) * 0.04;
    d.z += (Math.random() - 0.5) * 0.04;
    d.normalize();
    const hit = sb.raycast(o.x, o.y, o.z, d.x, d.y, d.z);
    let end;
    if (hit) end = new THREE.Vector3(hit.point[0], hit.point[1], hit.point[2]);
    else {
      const tf = d.y < -1e-3 ? -o.y / d.y : 8;
      end = o.clone().addScaledVector(d, Math.min(tf, 9));
    }
    this._tracer(muzzle, end);
    this._eject();
    const pan = app.audio?._panOf?.(end) ?? 0;
    if (!hit) {
      app.audio?.autoshot(0, pan);
      return;
    }
    // every few rounds one bores right through - as often as this device
    // can take it (the boring at most ~15% of the time); between, a smack
    // and a spit
    const now = performance.now();
    if (this.round % this.boreEvery === 0 && now - this.lastBore > Math.max(220, this.boreMs / 0.15)) {
      this.bore(o, d, true);
      const ms = performance.now() - now;
      this.boreMs = this.boreMs ? this.boreMs * 0.6 + ms * 0.4 : ms;
      this.lastBore = performance.now();
      this.boreEvery = ms > 30 ? 7 : ms > 18 ? 5 : 4;
    } else {
      sb.impulse(end.x, end.y, end.z, d.x, d.y, d.z, 0.16 * sb.p.size, 2.2, hit.piece);
      const col = app.flavorColorAt(end.x, end.y, end.z);
      for (let k = 0; k < (this.coarse ? (this.round & 1) : 2); k++) {
        const dir = d.clone().negate().add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(0.9)).normalize();
        app.droplets.spawn(end.clone().addScaledVector(dir, 0.02), dir.multiplyScalar(1.5 + Math.random() * 2.5), 0.008 + Math.random() * 0.01, col);
      }
      app.glowPulse?.(end.x, end.y, end.z, 0.35);
    }
    app.audio?.autoshot(1, pan);
  }

  // a streak from the muzzle to where the round went
  _tracer(a, b) {
    const T = this.tracers[this.tk++ % this.tracers.length];
    T.position.copy(a);
    T.lookAt(b);
    T.scale.set(1, 1, Math.max(0.01, a.distanceTo(b)));
    T.material.opacity = 0.9;
    T.life = 0.05;
    T.visible = true;
  }

  _fade(dt) {
    for (const T of this.tracers) {
      if (!T.visible) continue;
      T.life -= dt;
      T.material.opacity = Math.max(0, (T.life / 0.05) * 0.9);
      if (T.life <= 0) T.visible = false;
    }
  }

  // a spent case flung out of its side - up, a little right and on out
  // into the room, so the brass piles up where it's seen
  _eject() {
    if (this.cs.length >= MAX_CASINGS) this.cs.shift();
    const cam = this.app.camera;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    fwd.y = 0;
    fwd.normalize();
    const p = this.model.localToWorld(new THREE.Vector3(0.05, 0.03, 0.02));
    const v = right.multiplyScalar(0.5 + Math.random() * 0.7).addScaledVector(fwd, 1.6 + Math.random() * 1.2);
    v.y += 1.8 + Math.random() * 1.1;
    this.cs.push({ p, v, r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6), w: new THREE.Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30), t: 0 });
  }

  // the brass falling, bouncing (a clink each time) and coming to rest
  _brass(dt) {
    const app = this.app, g = app.sb.p.gravity;
    for (let k = this.cs.length - 1; k >= 0; k--) {
      const c = this.cs[k];
      c.t += dt;
      if (c.t > 14) {
        this.cs.splice(k, 1);
        continue;
      }
      if (c.rest) continue;
      c.v.y += g * dt;
      c.p.addScaledVector(c.v, dt);
      c.r.x += c.w.x * dt;
      c.r.y += c.w.y * dt;
      c.r.z += c.w.z * dt;
      if (c.p.y < 0.0055) {
        c.p.y = 0.0055;
        if (c.v.y < -0.6) app.audio?.clink(Math.min(0.5, -c.v.y * 0.08), c.p);
        c.v.y *= -0.35;
        c.v.x *= 0.6;
        c.v.z *= 0.6;
        c.w.multiplyScalar(0.5);
        // (lying on its side, at rest)
        if (Math.abs(c.v.y) < 0.3 && Math.hypot(c.v.x, c.v.z) < 0.15) {
          c.rest = true;
          c.r.x = Math.PI / 2;
          c.r.z = 0;
        }
      }
    }
    let n = 0;
    for (const c of this.cs) {
      this._q.setFromEuler(c.r);
      this._m.compose(c.p, this._q, this._s);
      this.casings.setMatrixAt(n++, this._m);
    }
    this.casings.count = n;
    this.casings.instanceMatrix.needsUpdate = true;
  }
}
