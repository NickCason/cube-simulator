import * as THREE from 'three';

// Tilt & shake: tip the phone and the table tips with it - the jelly leans,
// and slides once the pull beats its grip; shake the phone and the table
// jolts under it. Phones: motion sensors, switched on in Settings (iOS asks
// first); the angle it's held at then counts as level. Keyboard: the arrows
// tip the table, S shakes it.
const GAIN = 1.8; // sideways pull per (sine of) tilt, in g
const MAX_PULL = 1.1; // (g)
const DEAD = Math.sin((2 * Math.PI) / 180); // (a hand's tremor)

export class Tilt {
  constructor(app) {
    this.app = app;
    this.supported = 'DeviceOrientationEvent' in window && !!window.matchMedia?.('(pointer: coarse)').matches;
    this.on = false;
    this.base = null; // { beta, gamma } that counts as level
    this.sens = [0, 0]; // from the sensors: screen-right, into-the-screen (sine of the tilt)
    this.keys = { ArrowLeft: 0, ArrowRight: 0, ArrowUp: 0, ArrowDown: 0 };
    this.cur = [0, 0];
    this.woke = [0, 0];
    this.jolt = new THREE.Vector3(); // (m/s) a kick to give the jelly, from shakes
    this._r = new THREE.Vector3();
    this._f = new THREE.Vector3();
    this._orient = (e) => this._onOrient(e);
    this._motion = (e) => this._onMotion(e);
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key in this.keys) {
        this.keys[e.key] = 1;
        e.preventDefault();
      } else if ((e.key === 's' || e.key === 'S') && !e.repeat) this.shake();
    });
    window.addEventListener('keyup', (e) => {
      if (e.key in this.keys) this.keys[e.key] = 0;
    });
  }

  // (from a tap: iOS only lets a page ask for the sensors then)
  async enable() {
    try {
      for (const E of [window.DeviceOrientationEvent, window.DeviceMotionEvent]) {
        if (E && typeof E.requestPermission === 'function' && (await E.requestPermission()) !== 'granted') return false;
      }
    } catch (e) {
      return false;
    }
    this.base = null;
    this.on = true;
    window.addEventListener('deviceorientation', this._orient);
    window.addEventListener('devicemotion', this._motion);
    return true;
  }

  disable() {
    this.on = false;
    this.sens[0] = this.sens[1] = 0;
    window.removeEventListener('deviceorientation', this._orient);
    window.removeEventListener('devicemotion', this._motion);
  }

  // a jolt from below, as if the table were knocked
  shake(strength = 1) {
    const a = Math.random() * Math.PI * 2;
    this.jolt.x += Math.cos(a) * 1.4 * strength;
    this.jolt.z += Math.sin(a) * 1.4 * strength;
    this.jolt.y += 1.8 * strength;
  }

  _onOrient(e) {
    if (e.beta === null || e.gamma === null) return;
    if (!this.base) this.base = { beta: e.beta, gamma: e.gamma };
    // tilt in the device's own frame: right side down, top edge away
    const tx = Math.sin(((e.gamma - this.base.gamma) * Math.PI) / 180);
    const ty = -Math.sin(((e.beta - this.base.beta) * Math.PI) / 180);
    // ...turned to the screen's frame
    const a = (((screen.orientation && screen.orientation.angle) || window.orientation || 0) * Math.PI) / 180;
    this.sens[0] = tx * Math.cos(a) + ty * Math.sin(a);
    this.sens[1] = -tx * Math.sin(a) + ty * Math.cos(a);
  }

  _onMotion(e) {
    const acc = e.acceleration;
    if (!acc || acc.x === null) return;
    const ax = acc.x || 0, ay = acc.y || 0, az = acc.z || 0;
    const m = Math.hypot(ax, ay, az);
    if (m < 4) return;
    // the jelly lags behind the table: kicked opposite to how the phone
    // moved - its side to side as sideways, its up and down as up, toward
    // and away as into the screen
    const a = (((screen.orientation && screen.orientation.angle) || window.orientation || 0) * Math.PI) / 180;
    const sx = ax * Math.cos(a) + ay * Math.sin(a), sy = -ax * Math.sin(a) + ay * Math.cos(a);
    const k = (Math.min(m, 30) - 4) / m / 60;
    this._dirs();
    this.jolt.addScaledVector(this._r, -sx * k).addScaledVector(this._f, az * k);
    this.jolt.y -= sy * k;
  }

  // the camera's right and its forward, along the floor
  _dirs() {
    const e = this.app.camera.matrixWorld.elements;
    this._r.set(e[0], 0, e[2]).normalize();
    this._f.set(-e[8], 0, -e[10]).normalize();
  }

  update(dt) {
    const sb = this.app.sb;
    let gx = this.on ? this.sens[0] : 0, gy = this.on ? this.sens[1] : 0;
    if (Math.hypot(gx, gy) < DEAD) gx = gy = 0;
    const K = this.keys;
    gx += (K.ArrowRight - K.ArrowLeft) * 0.55;
    gy += (K.ArrowUp - K.ArrowDown) * 0.55;
    const s = 1 - Math.exp(-dt * 9);
    this.cur[0] += (gx - this.cur[0]) * s;
    this.cur[1] += (gy - this.cur[1]) * s;
    this._dirs();
    const g = Math.abs(sb.p.gravity);
    let px = g * GAIN * (this.cur[0] * this._r.x + this.cur[1] * this._f.x);
    let pz = g * GAIN * (this.cur[0] * this._r.z + this.cur[1] * this._f.z);
    const l = Math.hypot(px, pz);
    if (l > MAX_PULL * g) {
      px *= (MAX_PULL * g) / l;
      pz *= (MAX_PULL * g) / l;
    }
    if (l < 1e-3) px = pz = 0;
    sb.tilt[0] = px;
    sb.tilt[1] = pz;
    // (sleepers don't feel it: wake them when it changes)
    if (Math.hypot(px - this.woke[0], pz - this.woke[1]) > 0.4) {
      sb.wakeAll();
      this.woke[0] = px;
      this.woke[1] = pz;
    }
    // a jolt: everything kicked, the bottom of each piece most (the table
    // moves under it; the top lags behind, so it wobbles)
    const J = this.jolt;
    if (J.lengthSq() > 1e-4 && !this.app.healer.active) {
      const v = sb.v, x = sb.x;
      for (const pc of sb.pieces) {
        const y0 = pc.bbox[1], hgt = Math.max(1e-3, pc.bbox[4] - y0);
        for (const i of pc.verts) {
          if (!sb.w[i]) continue;
          const w = 1 - 0.65 * Math.min(1, (x[i * 3 + 1] - y0) / hgt);
          v[i * 3] += J.x * w;
          v[i * 3 + 1] += J.y * w;
          v[i * 3 + 2] += J.z * w;
        }
      }
      sb.wakeAll();
    }
    J.set(0, 0, 0);
  }
}
