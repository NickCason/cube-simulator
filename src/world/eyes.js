// Googly eyes on the jelly: each a white disc, a black pupil loose under a
// clear dome - and, by its kind, a sleepy lid, a cross brow or lashes. Each
// is held on at three points in the jelly (its middle, a little way up it,
// a little way across - see eyes.js for where, on the cube's rest shape),
// so it rides the wobble, tips with the surface under it and squashes with
// it. The pupil's loose: it falls to the bottom of the eye, and jiggles and
// rattles round the rim as the jelly moves. Where its jelly's gone (cut
// away, melted, eaten - or cut through under it) the eye pops off and falls;
// a re-cube puts it back. One being peeled off (see EyesTool) is held up
// under the pointer, facing you, and falls where it's let go. A re-cube
// takes them off: they swirl round the cube coming back together, then -
// the cube made again - are sucked back on one after another, each to its
// own place, with a thwop and a rattle of the pupil.

import * as THREE from 'three';
import { REST_STEP } from '../sim/softbody.js';
import { EYE_STYLES, onSurface, eyeFrame } from '../eyes.js';
import { resolveFlavor, flavorMainHex } from '../styles.js';

const MAXI = 128; // (eye instances: on the cubes, and falling)
const SINKS = [0.004, 0.02, 0.05]; // (how far under the skin each hold is tried: shares of the side)
const LIFT = 0.004; // (and how far out of it the eye sits: the drawn surface is rounder than the jelly's)
const G = 9.8; // (the pupil's gravity)
const FLY_IN = 0.6; // (a re-cube: off the cube and out into the swirl, s)
const LAND = 0.3; // (sucked back on, s)
const LAND_GAP = 0.085; // (one after another, s)
const smooth01 = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Color();

export class Eyes {
  constructor(app) {
    this.app = app;
    const env = app.env.texture;
    const mk = (geo, mat, n = MAXI, scene = app.scene) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
      return m;
    };
    // (geometry along z: the eye faces +z, its up +y)
    const disc = new THREE.CylinderGeometry(1, 1, 1, 40);
    disc.rotateX(Math.PI / 2);
    const dome = new THREE.SphereGeometry(1, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.rotateX(Math.PI / 2);
    const half = new THREE.CircleGeometry(1, 36, 0, Math.PI);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const black = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.28, envMap: env, envMapIntensity: 0.7 });
    this.white = mk(disc, new THREE.MeshStandardMaterial({ color: 0xfbfaf6, roughness: 0.42, envMap: env, envMapIntensity: 0.85 }));
    this.pupil = mk(disc, black);
    // (the dome: clear plastic - only what it reflects, added on: a white one
    // greyed the pupil)
    this.dome = mk(dome, new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.05, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, envMap: env, envMapIntensity: 1.5, depthWrite: false }));
    this.dome.renderOrder = 2;
    // (a lid: its jelly's colour - and, in the dark, lit up with it: its
    // glow takes the colour too)
    const lidMat = new THREE.MeshStandardMaterial({ roughness: 0.45, envMap: env, envMapIntensity: 0.5, side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0 });
    lidMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n  totalEmissiveRadiance *= vColor.rgb;\n#endif');
    };
    this.lid = mk(half, lidMat);
    this.lid.setColorAt(0, new THREE.Color(1, 1, 1));
    this.brow = mk(box, black);
    this.lash = mk(box, black, MAXI * 5); // (five an eye)
    // (in a cube's portrait too: see Portraits)
    for (const m of [this.white, this.pupil, this.dome, this.lid, this.brow, this.lash]) m.userData.inPortrait = true;
    // (the ones being placed - see-through, red where they can't go - and a
    // ring round the picked ones: over the jelly, drawn after it, with the
    // effects; in the room's pass, the jelly drew over all that didn't write
    // its depth)
    const ghostMat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false });
    this.gWhite = mk(disc, ghostMat(0xffffff, 0.7), 4, app.fxScene);
    this.gWhite.setColorAt(0, new THREE.Color(1, 1, 1));
    this.gPupil = mk(disc, ghostMat(0x0a0a0c, 0.7), 4, app.fxScene);
    this.gPupil.renderOrder = 1;
    this.ring = mk(new THREE.RingGeometry(1.14, 1.3, 48), new THREE.MeshBasicMaterial({ color: 0x3b8cff, transparent: true, opacity: 0.95, depthWrite: false }), 16, app.fxScene);
    this.live = []; // (the eyes on the cubes: see _anchor)
    this.falling = [];
    this.ghosts = [];
    this.picked = new Set();
    this.held = null; // (one being peeled off: see hold)
    this.flights = new Map(); // (a re-cube: each eye flying, by the eye - see _healStart)
    this.landed = new WeakMap(); // (just sucked back on: when, for its squash)
    app.onHealStart.push(() => this._healStart());
    app.onHealEnd.push(() => this._healEnd());
    this.born = new WeakMap(); // (an eye's arrival, for its pop)
    this._sig = '';
    app.anchorProviders.push(() => this.live.flatMap((L) => L.anchors));
    this.setGlow(app.jelly.frontMat.uniforms.uEmit.value || 0);
  }

  // In the dark, the jelly lit up (glow 0..1): the whites a little lit too
  // (a touch, always: a white that reads white), the lids glowing with their
  // jelly - so they still read.
  setGlow(e) {
    this.white.material.emissive.setScalar(0.07 + 0.25 * e);
    this.lid.material.emissiveIntensity = 0.5 * e;
  }

  // An eye just put on: it pops in.
  pop(e) {
    this.born.set(e, performance.now());
  }

  // (each cube's eyes, held on in the jelly as it is now - their pupils kept
  // where they were, for eyes that were here before)
  _anchor(sb, cubes) {
    const old = new Map(this.live.map((L) => [L.e, L]));
    this.live = [];
    for (const cb of cubes) {
      const eyes = cb.style.eyes || [];
      eyes.forEach((e, i) => {
        const was = old.get(e);
        const L = this._hold(sb, cb.slot, e);
        L.cb = cb;
        L.i = i;
        L.pp = was ? was.pp : [0, -0.3];
        L.pv = was ? was.pv : [0, 0];
        if (was) {
          // (where it was: if it can't be held on now, it falls from there)
          L.ok = was.ok;
          for (const q of ['pos', 'u', 'v', 'n']) L[q].copy(was[q]);
          L.last = was.last;
          L.lastV = was.lastV;
        }
        this.live.push(L);
      });
    }
  }

  // (one eye's three holds in the jelly: its middle, up it, across it)
  _hold(sb, k, e) {
    const s = sb.cSize[k] || 1, b = Math.min(0.45, (sb.cBevel[k] || 0) / s);
    const { p, n } = onSurface([e.x, e.y, e.z], b), { up, right } = eyeFrame(n), d = Math.max(0.02, e.r * 0.55);
    const at = (o) => {
      for (const sink of SINKS) {
        const P = p.map((v, i) => (v - n[i] * sink + o[i]) * s);
        const r = sb.locateRest(P[0] + k * REST_STEP, P[1], P[2]);
        if (r) return { tet: r.tet, b: r.bary, lost: false, sink: sink * s };
      }
      return { tet: -1, b: [0, 0, 0, 0], lost: true, sink: 0 };
    };
    const a0 = at([0, 0, 0]), a1 = at(up.map((v) => v * d)), a2 = at(right.map((v) => v * d));
    return { e, k, anchors: [a0, a1, a2], arm: d * s, R: e.r * s, side: p[0] * right[0] + p[1] * right[1] + p[2] * right[2], pos: new THREE.Vector3(), u: new THREE.Vector3(), v: new THREE.Vector3(), n: new THREE.Vector3(), su: 1, sv: 1, ok: false, last: null, lastV: null };
  }

  // (where an eye is this frame, and which way it faces: from its holds)
  _place(sb, L) {
    const [a0, a1, a2] = L.anchors, P = [0, 0, 0], A = [0, 0, 0], B = [0, 0, 0];
    if (a0.lost || a1.lost || a2.lost || a0.tet < 0 || a1.tet < 0 || a2.tet < 0 || a0.tet >= sb.nT || a1.tet >= sb.nT || a2.tet >= sb.nT) return false;
    // (cut through under it: it can't hold on to both sides)
    const tp = sb.tPiece;
    if (tp && (tp[a0.tet] !== tp[a1.tet] || tp[a0.tet] !== tp[a2.tet])) return false;
    sb.embedPoint(a0.tet, a0.b, P);
    sb.embedPoint(a1.tet, a1.b, A);
    sb.embedPoint(a2.tet, a2.b, B);
    _v.set(A[0] - P[0], A[1] - P[1], A[2] - P[2]);
    _u.set(B[0] - P[0], B[1] - P[1], B[2] - P[2]);
    const lu = _u.length(), lv = _v.length();
    if (!(lu > 1e-6 && lv > 1e-6)) return false;
    // (squashed and stretched with the jelly under it, within reason)
    L.su = Math.min(1.5, Math.max(0.65, lu / L.arm));
    L.sv = Math.min(1.5, Math.max(0.65, lv / L.arm));
    L.u.copy(_u).multiplyScalar(1 / lu);
    L.v.copy(_v).addScaledVector(L.u, -L.u.dot(_v)).normalize();
    L.n.crossVectors(L.u, L.v);
    L.pos.set(P[0], P[1], P[2]).addScaledVector(L.n, a0.sink + LIFT * (sb.cSize[L.k] || 1));
    return true;
  }

  update(dt) {
    const app = this.app, sb = app.sb;
    // (cubes come and gone, rebuilt, re-cubed - or their eyes changed: held on afresh)
    let sig = sb.cubeVersion + '|';
    for (const cb of app.cubes) {
      sig += cb.slot + ':';
      for (const e of cb.style.eyes || []) sig += `${e.x.toFixed(3)},${e.y.toFixed(3)},${e.z.toFixed(3)},${e.r.toFixed(3)},${e.s};`;
    }
    if (sig !== this._sig) {
      this._sig = sig;
      this._anchor(sb, app.cubes);
    }
    const t = Math.min(dt, 1 / 30);
    const gy = (sb.p.gravity || -9.8) * (sb.gravityScale ?? 1) * (G / 9.8);
    for (const L of this.live) {
      const was = L.ok;
      L.ok = this._place(sb, L);
      // (its jelly gone: it pops off)
      if (was && !L.ok) this._drop(L, L.pos, L.u, L.v, L.n);
      if (!L.ok) {
        L.last = L.lastV = null;
        continue;
      }
      if (t > 0) this._pupil(L, t, gy);
    }
    if (this.held && t > 0) this._pupil(this.held, t, gy);
    if (this.flights.size) this._fly(t, gy);
    this._fall(t);
    this._draw(this.live.filter((L) => L.ok), true);
    this._ghosts(sb);
  }

  // The pupil: loose in the eye, falling to its bottom, thrown about by the
  // eye's own moves (in its frame: gravity less the eye's acceleration) and
  // bouncing off the rim.
  _pupil(L, t, gy) {
    const p = L.pos;
    let ax = 0, ay = 0, az = 0;
    if (L.last) {
      const vx = (p.x - L.last.x) / t, vy = (p.y - L.last.y) / t, vz = (p.z - L.last.z) / t;
      if (L.lastV) {
        ax = (vx - L.lastV.x) / t;
        ay = (vy - L.lastV.y) / t;
        az = (vz - L.lastV.z) / t;
        const am = Math.hypot(ax, ay, az), cap = 160;
        if (am > cap) (ax *= cap / am), (ay *= cap / am), (az *= cap / am);
        L.lastV.set(vx, vy, vz);
      } else L.lastV = new THREE.Vector3(vx, vy, vz);
      L.last.copy(p);
    } else L.last = p.clone();
    const fx = -ax, fy = gy - ay, fz = -az;
    const R = L.R * Math.min(L.su, L.sv), st = EYE_STYLES[L.e.s] || EYE_STYLES[0];
    const room = Math.max(0.02, 0.9 - st.pupil); // (how far the pupil can go: in eye radii)
    // (how loose they are: the Cubicle's pupil wiggle - thrown about more,
    // and settling slower)
    const wig = this.app.st?.pupilWiggle ?? 1, k = wig / Math.max(R, 1e-3);
    L.pv[0] += (fx * L.u.x + fy * L.u.y + fz * L.u.z) * k * t;
    L.pv[1] += (fx * L.v.x + fy * L.v.y + fz * L.v.z) * k * t;
    const damp = Math.exp((-2.6 * t) / wig);
    L.pv[0] *= damp;
    L.pv[1] *= damp;
    L.pp[0] += L.pv[0] * t;
    L.pp[1] += L.pv[1] * t;
    const r = Math.hypot(L.pp[0], L.pp[1]);
    if (r > room) {
      const nx = L.pp[0] / r, ny = L.pp[1] / r;
      L.pp[0] = nx * room;
      L.pp[1] = ny * room;
      const vn = L.pv[0] * nx + L.pv[1] * ny;
      if (vn > 0) {
        // (a rattle off the rim)
        L.pv[0] -= 1.45 * vn * nx;
        L.pv[1] -= 1.45 * vn * ny;
        if (vn > 4) this.app.audio?.eyeRattle?.(Math.min(1, vn / 25), p);
      }
    }
  }

  // (an eye off its jelly: it falls - popping off, or thrown, given vel -
  // bounces, lies looking up, and fades)
  _drop(L, pos, u, v, n, vel = null) {
    if (this.falling.length > 24) this.falling.shift();
    _m.makeBasis(u, v, n);
    this.falling.push({
      e: L.e, R: L.R, pos: pos.clone(), vel: vel ? vel.clone() : new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.9, (Math.random() - 0.5) * 0.8).addScaledVector(n, 1.2),
      q: new THREE.Quaternion().setFromRotationMatrix(_m), w: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12), life: 0, pp: [...L.pp],
      col: L.cb ? flavorMainHex(resolveFlavor(L.cb.style)) : '#ffffff', side: L.side >= 0 ? 1 : -1,
    });
    this.app.audio?.ui?.();
  }

  // An eye taken off by hand (see EyesTool): it falls from where it is.
  drop(e) {
    const L = this.live.find((x) => x.e === e && x.ok);
    if (L) this._drop(L, L.pos, L.u, L.v, L.n);
  }

  // One being peeled off (see EyesTool): held up in the air where the line
  // of sight crosses its distance, facing the camera (shown: not while it's
  // over another cube, where it'd go on that shown instead) - or (e null) put
  // back on (its own place on the cube showing again).
  hold(e, ray, show = true) {
    if (!e) return void (this.held = null);
    if (!this.held || this.held.e !== e) {
      const L = this.live.find((x) => x.e === e && x.ok);
      if (!L) return;
      this.held = { e, cb: L.cb, R: L.R, su: 1, sv: 1, side: L.side, dist: L.pos.distanceTo(ray.origin), pos: L.pos.clone(), u: new THREE.Vector3(), v: new THREE.Vector3(), n: new THREE.Vector3(), pp: [...L.pp], pv: [...L.pv], last: null, lastV: null };
      this.app.audio?.eyePeel?.(0.8);
    }
    const H = this.held, q = this.app.camera.quaternion;
    H.show = show;
    H.pos.copy(ray.origin).addScaledVector(ray.direction, H.dist);
    H.u.set(1, 0, 0).applyQuaternion(q);
    H.v.set(0, 1, 0).applyQuaternion(q);
    H.n.set(0, 0, 1).applyQuaternion(q);
  }

  // ...let go of: it falls from there (thrown, if it was moving)
  letGo() {
    const H = this.held;
    this.held = null;
    if (!H) return;
    const vel = H.lastV ? H.lastV.clone() : new THREE.Vector3();
    if (vel.length() > 5) vel.setLength(5);
    this._drop(H, H.pos, H.u, H.v, H.n, vel);
  }

  // A re-cube starting: the eyes of the cubes re-cubing come off - each from
  // where it is (one lying on the floor, from there) - and swirl round its
  // home, each on its own tilted circle.
  _healStart() {
    const H = this.app.healer, only = H.only;
    for (const L of this.live) {
      if (only >= 0 && L.k !== only) continue;
      const was = this.flights.get(L.e);
      const fi = this.falling.findIndex((f) => f.e === L.e);
      let from = was ? was.pos.clone() : L.ok ? L.pos.clone() : null;
      if (fi >= 0) {
        from = this.falling[fi].pos.clone();
        this.falling.splice(fi, 1);
      }
      const size = this.app.sb.cSize[L.k] || 1;
      if (!from) from = this._home(L.k).clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).setLength(0.5 * size));
      // (its circle: level, tipped up to 40 degrees about a level axis)
      const tilt = (Math.random() - 0.5) * 1.4, spin = Math.random() * Math.PI * 2;
      const ax = new THREE.Vector3(Math.cos(spin), 0, Math.sin(spin));
      const a1 = new THREE.Vector3(-ax.z, 0, ax.x).applyAxisAngle(ax, tilt), a2 = ax.clone();
      const q = was ? was.q.clone() : new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(L.u.lengthSq() ? L.u : _u.set(1, 0, 0), L.v.lengthSq() ? L.v : _v.set(0, 1, 0), L.n.lengthSq() ? L.n : _n.set(0, 0, 1)));
      this.flights.set(L.e, {
        e: L.e, k: L.k, cb: L.cb, R: L.R, side: L.side, start: from, out: L.ok && L.n.lengthSq() ? L.n.clone() : new THREE.Vector3(0, 1, 0),
        pos: from.clone(), q, u: new THREE.Vector3(), v: new THREE.Vector3(), n: new THREE.Vector3(), su: 1, sv: 1,
        t: 0, phase: Math.random() * Math.PI * 2, speed: (2.3 + Math.random() * 1.7) * (Math.random() < 0.5 ? -1 : 1),
        radius: (0.8 + Math.random() * 0.22) * size, bob: 2 + Math.random() * 2, a1, a2,
        landAt: -1, waitFrom: 0, landT: 0, landFrom: null, landQ: null, pp: was ? was.pp : [...L.pp], pv: was ? was.pv : [...L.pv], last: null, lastV: null,
      });
    }
    if (this.flights.size) this.app.audio?.eyePeel?.(0.6);
  }

  // ...and the cube made again: each sucked back on, one after another.
  _healEnd() {
    let i = 0;
    for (const F of this.flights.values()) F.landAt = F.t + 0.1 + i++ * LAND_GAP;
  }

  // (where a cube re-cubing comes back together)
  _home(k) {
    const H = this.app.healer, h = H.multi && H.homes ? H.homes.get(k) : null;
    return h ? h.cW : H.cW;
  }

  _fly(t, gy) {
    const H = this.app.healer, size0 = this.app.sb.p.size;
    for (const [e, F] of this.flights) {
      F.t += t;
      // (stopped part way - a swap: back on now)
      if (F.landAt < 0 && !H.active) F.landAt = F.t;
      const flying = F.landAt < 0 || F.t < F.landAt;
      const L = flying ? null : this.live.find((x) => x.e === e && x.ok);
      // (its cube gone, or wearing other eyes now - a swap - or still nowhere
      // to land a good while after: it drops)
      if (!flying && !L && (!this.app.cubes.some((cb) => (cb.style.eyes || []).includes(e)) || F.t > (F.waitFrom || F.landAt) + 2.5)) {
        this.flights.delete(e);
        this._drop(F, F.pos, F.u.lengthSq() ? F.u : _u.set(1, 0, 0), F.v.lengthSq() ? F.v : _v.set(0, 1, 0), F.n.lengthSq() ? F.n : _n.set(0, 0, 1));
        continue;
      }
      if (flying || !L) {
        // round its home on its circle, bobbing - out there off the cube
        // first, popping out along its face
        const c = this._home(F.k), size = this.app.sb.cSize[F.k] || size0;
        // (out past the pieces as they fly apart, in close as they come back)
        const r = F.radius * (1 + 0.55 * Math.sin(Math.PI * Math.min(1, Math.max(0, H.t / 2.4))));
        const a = F.phase + F.speed * F.t;
        _p.copy(F.a1).multiplyScalar(Math.cos(a) * r).addScaledVector(F.a2, Math.sin(a) * r).add(c);
        _p.y = Math.max(F.R * 1.3, _p.y + Math.sin(F.t * F.bob + F.phase) * 0.06 * size + 0.08 * size);
        const k = smooth01(F.t / FLY_IN);
        F.pos.lerpVectors(F.start, _p, k).addScaledVector(F.out, Math.sin(Math.PI * k) * 0.3 * size);
        // (facing mostly you, a little out from the cube, as it goes round:
        // straight out, at the sides of its circle it was seen edge on)
        _n.copy(F.pos).sub(c);
        if (_n.lengthSq() < 1e-8) _n.set(0, 0, 1);
        _n.normalize().multiplyScalar(0.3).add(_p.copy(this.app.camera.position).sub(F.pos).normalize().multiplyScalar(0.7)).normalize();
        _v.set(0, 1, 0).addScaledVector(_n, -_n.y);
        if (_v.lengthSq() < 1e-6) _v.set(0, 0, 1);
        _v.normalize();
        _u.crossVectors(_v, _n);
        _q.setFromRotationMatrix(_m.makeBasis(_u, _v, _n));
        F.q.slerp(_q, Math.min(1, t * 6));
        if (!flying && !F.waitFrom) F.waitFrom = F.landAt; // (nowhere to go yet: round again)
      } else {
        // sucked back on: faster and faster to its own place, turning to
        // lie on it
        if (!F.landFrom) {
          F.landFrom = F.pos.clone();
          F.landQ = F.q.clone();
          F.landT = 0;
        }
        F.landT += t;
        const u = Math.min(1, F.landT / LAND);
        F.pos.lerpVectors(F.landFrom, L.pos, u * u * u);
        _q.setFromRotationMatrix(_m.makeBasis(L.u, L.v, L.n));
        F.q.slerpQuaternions(F.landQ, _q, Math.min(1, u * 1.5));
        if (u >= 1) {
          // on: a squash, a thwop - and its pupil sent rattling
          this.flights.delete(e);
          this.landed.set(e, performance.now());
          const ang = Math.random() * Math.PI * 2, kick = 35 + Math.random() * 25;
          L.pp = [...F.pp];
          L.pv = [Math.cos(ang) * kick, Math.sin(ang) * kick];
          L.last = L.lastV = null;
          this.app.audio?.eyeSuck?.(0.8);
          continue;
        }
      }
      F.u.set(1, 0, 0).applyQuaternion(F.q);
      F.v.set(0, 1, 0).applyQuaternion(F.q);
      F.n.set(0, 0, 1).applyQuaternion(F.q);
      if (t > 0) this._pupil(F, t, gy);
    }
  }

  // The picked ones (see EyesTool): ringed.
  setPicked(list) {
    this.picked = new Set(list || []);
  }

  _fall(t) {
    const up = new THREE.Quaternion();
    for (const f of this.falling) {
      f.life += t;
      f.vel.y -= 9.8 * t;
      f.pos.addScaledVector(f.vel, t);
      const floor = f.R * 0.2;
      if (f.pos.y < floor) {
        f.pos.y = floor;
        if (f.vel.y < -0.5) this.app.audio?.eyeRattle?.(Math.min(1, -f.vel.y / 3), f.pos);
        if (f.vel.y < 0) f.vel.y *= -0.35;
        f.vel.x *= 0.8;
        f.vel.z *= 0.8;
        f.w.multiplyScalar(0.7);
        // (it settles looking up)
        up.setFromUnitVectors(new THREE.Vector3(0, 0, 1).applyQuaternion(f.q), new THREE.Vector3(0, 1, 0)).multiply(f.q);
        f.q.slerp(up, Math.min(1, t * 6));
      }
      const wl = f.w.length();
      if (wl > 1e-4) f.q.premultiply(_q.setFromAxisAngle(_p.copy(f.w).multiplyScalar(1 / wl), wl * t));
    }
    this.falling = this.falling.filter((f) => f.life < 4);
  }

  // Every eye's parts, posed: on the cubes (live) - and, in the room, the
  // falling ones, the one held, rings round the picked.
  _draw(live, room) {
    let n = 0, nl = 0, nb = 0, nlash = 0, nr = 0;
    const now = performance.now();
    const put = (mesh, i, M, x, y, z, sx, sy, sz, rot = 0) => {
      _m2.makeRotationZ(rot);
      _m2.premultiply(_m.makeTranslation(x, y, z));
      _m2.multiply(_m.makeScale(sx, sy, sz));
      mesh.setMatrixAt(i, _m2.premultiply(M));
    };
    const eye = (M, e, pp, scale, side, colorHex) => {
      const st = EYE_STYLES[e.s] || EYE_STYLES[0];
      const M2 = M.clone();
      if (scale !== 1) M2.multiply(_m.makeScale(scale, scale, scale));
      put(this.white, n, M2, 0, 0, 0.012, 1, 1, 0.024);
      put(this.pupil, n, M2, pp[0], pp[1], 0.032, st.pupil, st.pupil, 0.02);
      put(this.dome, n, M2, 0, 0, 0, 1.0, 1.0, 0.42);
      n++;
      if (st.lid) {
        put(this.lid, nl, M2, 0, -0.06, 0.05, 1.02, 1.0, 1);
        this.lid.setColorAt(nl, _c.set(colorHex).multiplyScalar(0.82));
        nl++;
      }
      if (st.brow) put(this.brow, nb++, M2, side * -0.05, 1.22, 0.03, 1.15, 0.22, 0.06, side > 0 ? 0.36 : -0.36);
      if (st.lashes) for (const a of [0.42, 0.9, 1.57, 2.24, 2.72]) put(this.lash, nlash++, M2, Math.cos(a) * 1.1, Math.sin(a) * 1.1, 0.02, 0.07, 0.34, 0.03, a - Math.PI / 2);
    };
    const H = room ? this.held : null;
    for (const L of live) {
      if (n >= MAXI - 1) break;
      if (H && H.e === L.e) continue;
      if (room && this.flights.has(L.e)) continue;
      _s.set(L.R * L.su, L.R * L.sv, L.R);
      const M = new THREE.Matrix4().makeBasis(L.u, L.v, L.n).scale(_s).setPosition(L.pos);
      // (just put on: it pops in, with a bounce)
      const b = this.born.get(L.e);
      let sc = 1;
      if (b !== undefined) {
        const a = (now - b) / 1000;
        if (a < 0.45) sc = 1 + Math.sin(a * 14) * Math.exp(-a * 9) * 0.35 - Math.exp(-a * 30) * 0.9;
        else this.born.delete(L.e);
      }
      // (just sucked back on: squashed flat, then a wobble)
      const ld = room ? this.landed.get(L.e) : undefined;
      if (ld !== undefined) {
        const a = (now - ld) / 1000;
        if (a < 0.6) sc *= 1 - 0.3 * Math.exp(-a * 14) * Math.cos(a * 26);
        else this.landed.delete(L.e);
      }
      const col = flavorMainHex(resolveFlavor(L.cb.style));
      eye(M, L.e, L.pp, Math.max(0.05, sc), L.side >= 0 ? 1 : -1, col);
      if (room && nr < 16 && this.picked.has(L.e)) put(this.ring, nr++, M, 0, 0, 0.05, 1 + Math.sin(now * 0.006) * 0.03, 1 + Math.sin(now * 0.006) * 0.03, 1);
    }
    // (a re-cube's: flying round it)
    if (room)
      for (const F of this.flights.values()) {
        if (n >= MAXI - 1) break;
        // (a touch bigger in the air, back to its size as it lands)
        const big = F.landFrom ? 1 + 0.15 * (1 - Math.min(1, F.landT / LAND)) : 1.15;
        const M = new THREE.Matrix4().compose(F.pos, F.q, _s.set(F.R * big, F.R * big, F.R * big));
        eye(M, F.e, F.pp, 1, F.side >= 0 ? 1 : -1, flavorMainHex(resolveFlavor(F.cb.style)));
      }
    if (H && H.show) {
      // (held up: a touch bigger, lifted off)
      _s.set(H.R * 1.08, H.R * 1.08, H.R * 1.08);
      const M = new THREE.Matrix4().makeBasis(H.u, H.v, H.n).scale(_s).setPosition(H.pos);
      eye(M, H.e, H.pp, 1, H.side >= 0 ? 1 : -1, flavorMainHex(resolveFlavor(H.cb.style)));
    }
    if (room)
      for (const f of this.falling) {
        if (n >= MAXI - 1) break;
        const fade = f.life > 3.4 ? Math.max(0.01, 1 - (f.life - 3.4) / 0.6) : 1;
        const M = new THREE.Matrix4().compose(f.pos, f.q, _s.set(f.R * fade, f.R * fade, f.R * fade));
        eye(M, f.e, f.pp, 1, f.side, f.col);
      }
    for (const [mesh, c] of [[this.white, n], [this.pupil, n], [this.dome, n], [this.lid, nl], [this.brow, nb], [this.lash, nlash], [this.ring, nr]]) {
      mesh.count = c;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  // The eyes being placed (see EyesTool): [{ k (the cube's slot), e, ok }]
  setGhosts(list) {
    this.ghosts = list || [];
  }

  _ghosts(sb) {
    let n = 0;
    for (const g of this.ghosts) {
      if (n >= 4) break;
      const L = this._hold(sb, g.k, g.e);
      if (!this._place(sb, L)) continue;
      _s.set(L.R * L.su, L.R * L.sv, L.R);
      const M = new THREE.Matrix4().makeBasis(L.u, L.v, L.n).scale(_s).setPosition(L.pos);
      const st = EYE_STYLES[g.e.s] || EYE_STYLES[0];
      _m2.makeTranslation(0, 0, 0.02).multiply(_m.makeScale(1, 1, 0.04)).premultiply(M);
      this.gWhite.setMatrixAt(n, _m2);
      this.gWhite.setColorAt(n, _c.set(g.ok ? 0xffffff : 0xff4d4d));
      _m2.makeTranslation(0, -0.25, 0.05).multiply(_m.makeScale(st.pupil, st.pupil, 0.03)).premultiply(M);
      this.gPupil.setMatrixAt(n, _m2);
      n++;
    }
    for (const m of [this.gWhite, this.gPupil]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  // The eye a line of sight hits first, if any: { L (its live record), t }
  pick(ray) {
    let best = null;
    for (const L of this.live) {
      if (!L.ok) continue;
      const R = L.R * 1.15, oc = _p.copy(ray.origin).sub(L.pos), b = oc.dot(ray.direction), c = oc.lengthSq() - R * R, h = b * b - c;
      if (h < 0) continue;
      const t = -b - Math.sqrt(h);
      if (t > 0 && (!best || t < best.t)) best = { L, t };
    }
    return best;
  }

  // For a portrait (a cube on its own, in its own jelly): its eyes, still -
  // pupils fallen to the bottom. The next frame puts the room's back.
  pose(sb, cubes) {
    const live = [];
    for (const cb of cubes)
      for (const e of cb.style.eyes || []) {
        const L = this._hold(sb, cb.slot, e);
        L.cb = cb;
        L.pp = [0, -(0.9 - (EYE_STYLES[e.s] || EYE_STYLES[0]).pupil) * 0.85];
        if (this._place(sb, L)) live.push(L);
      }
    this._draw(live, false);
    for (const m of [this.gWhite, this.gPupil]) m.count = 0;
  }
}
