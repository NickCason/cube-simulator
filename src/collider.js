// Collider - an exhibition mode: two cubes fired at each other. The cube on show and another - a copy of it, or one
// out of the Cubby - floating in the air apart, face to face (their weight off: SoftBody.cGrav), fired head on at
// the speed asked, each. Time slows as they go and slows again hard as they meet: the collision in bullet time,
// seen from one camera after another - side on, head on, from above, round it close - then back to speed, its
// pieces falling. Jelly splats, smears and tears; brittle things shatter (see world/shatter.js); a cube full of
// liquid bursts.

import * as THREE from 'three';
import { captureCube, decodeCube } from './cubecode.js';
import { cutBody, planeField } from './sim/cutting.js';
import { ragged } from './tools/basic.js';

const STORE = 'cube-sim-collider';
export const COLLIDE_SPEED = [8, 60]; // (m/s: each cube's, as it's fired)
const SPEED_CAP = 70; // (m/s: the jelly's fastest - SoftBody.p.maxSpeed - raised for it: 45 as it is)
const FLY_SLOW = 0.2; // (time as they fly at each other - and as they meet, for MEET_FOR s of it, then back up)
const MEET_SLOW = 0.04, MEET_FOR = 0.16;
const CUT = 1.05; // (s, real: each camera's turn while they meet)
// (met faster than this, m/s closing - and squashed into each other a moment, ST_RUPTURE s of it - jelly ruptures:
// torn apart from where it was hit, more ways the harder. As it was, two jelly cubes met at 180 km/h, squashed to
// a lens and sprang apart whole. Brittle ones shatter as they meet: see world/shatter.js)
const RUPTURE_V = 11, ST_RUPTURE = 0.022;

export class ColliderMode {
  constructor(app) {
    this.app = app;
    this.on = false;
    this.phase = ''; // '' ready, 'fly', 'meet', 'after'
    this.t = 0; // (s, real, in the phase)
    this.st = 0; // (s, the sim's, since they met)
    this.speed = 25;
    try {
      const v = +JSON.parse(localStorage.getItem(STORE) || '{}').speed;
      if (v >= COLLIDE_SPEED[0] && v <= COLLIDE_SPEED[1]) this.speed = v;
    } catch (e) {}
    this.a = -1; // (their slots: the cube on show, the other)
    this.b = -1;
    this.added = false; // (the other brought in for it - taken away after)
    this.bCode = null; // (the other's code, picked out of the Cubby - null, a copy of the first)
    this.L = 3; // (each one's middle this far out from the middle, along x)
    this.h = 1.4; // (its middle's height)
    this.cam = -1; // (the camera's turn: which, and when it came)
    this.camT = 0;
    this.closing = 0; // (m/s, km/h: how fast they met; the energy of it, MJ)
    this.energy = 0;
    this.frameX = 0; // (where the camera looks - see App._updateCamera)
    this.frameY = null;
    this.frameZ = 0;
    this._was = null; // (the room as it was: its reach, ceiling, top speed - and the view)
    this.ruptured = false; // (torn apart yet, as they meet)
    this._wide = 9; // (the view's distance, all of it)
    this.onChange = null; // (its bar: see ui/dropbar.js)
  }

  setSpeed(v) {
    this.speed = Math.min(COLLIDE_SPEED[1], Math.max(COLLIDE_SPEED[0], Math.round(v)));
    try {
      localStorage.setItem(STORE, JSON.stringify({ speed: this.speed }));
    } catch (e) {}
  }

  enter() {
    if (this.on) return;
    const app = this.app, sb = app.sb;
    this.on = true;
    this.phase = '';
    app.tool?.up?.();
    sb.endGrab();
    const g = app.orbitGoal;
    this._was = { arena: sb.p.arenaRadius, ceiling: sb.p.ceiling, vmax: sb.p.maxSpeed, view: { theta: g.theta, phi: g.phi, radius: g.radius } };
    this.a = app.cube?.slot ?? 0;
    this._other();
    this.place();
    this._changed();
  }

  exit() {
    if (!this.on) return;
    const app = this.app, sb = app.sb;
    this._slow(1);
    for (const k of [this.a, this.b]) if (k >= 0) sb.cGrav[k] = 1;
    if (this.added && this.b >= 0) app.removeCube(this.b);
    this.added = false;
    this.b = -1;
    if (this._was) {
      sb.p.arenaRadius = this._was.arena;
      sb.p.ceiling = this._was.ceiling;
      sb.p.maxSpeed = this._was.vmax;
      Object.assign(app.orbitGoal, this._was.view);
      this._was = null;
    }
    app._arena();
    // (the cubes back in the room whole, each where it stands - what was left of them lay metres out, past the room's
    // edge, shoved in by it as it closed back)
    const spots = app.stackLayout?.() || [];
    for (const cb of app.cubes) {
      const L = spots.find((q) => q.slot === cb.slot);
      sb.removeCube(cb.slot);
      sb.addCube(cb.slot, L ? L.x : 0, L ? L.y : 0, L ? L.z : 0, 0, app.bevelOf(cb), app.sizeOf(cb), app.resOf(cb));
    }
    sb.rebuild();
    app._syncSel?.();
    app.onTopologyChanged();
    app.markHealed?.();
    app.zits?.reset();
    sb.wakeAll();
    this.on = false;
    this.phase = '';
    this.frameY = null;
    this._changed();
  }

  // (the other one: another already in the room, or one brought in - a copy of the first, or the one picked)
  _other() {
    const app = this.app;
    if (this.added && this.b >= 0) app.removeCube(this.b);
    this.added = false;
    this.b = -1;
    const there = app.cubes.find((c) => c.slot !== this.a);
    if (there && !this.bCode) {
      this.b = there.slot;
      return;
    }
    const sel = app.cubes.find((c) => c.slot === this.a);
    const c = this.bCode ? decodeCube(this.bCode) : captureCube(app, sel?.name || '');
    if (!c) return;
    const slot = app.addCube(c, { drop: false });
    if (slot >= 0) (this.b = slot), (this.added = true);
    // (the first still the one the panels edit)
    const i = app.cubes.findIndex((cb) => cb.slot === this.a);
    if (i >= 0 && app.selectCube) app.selectCube(this.a);
  }

  // Pick the other: a code out of the Cubby - or null, a copy of the first
  pick(code) {
    if (!this.on || (this.phase && this.phase !== 'after')) return;
    this.bCode = code || null;
    this._other();
    this.place();
    this._changed();
  }

  // (the two made afresh - whole, unpopped - floating face to face, their weight off; the view side on to them)
  place() {
    const app = this.app, sb = app.sb;
    if (this.a < 0 || this.b < 0) return;
    const ca = app.cubes.find((c) => c.slot === this.a), cb = app.cubes.find((c) => c.slot === this.b);
    if (!ca || !cb) return;
    const sa = app.sizeOf(ca), sB = app.sizeOf(cb), s = Math.max(sa, sB);
    this.L = 1.6 * s + 1.4;
    this.h = Math.max(1.2, 0.9 * s + 0.6);
    sb.p.arenaRadius = Math.max(this._was?.arena ?? 2.35, this.L + 3 * s);
    sb.p.ceiling = Math.max(sb.p.ceiling, this.h + 3 * s);
    sb.p.maxSpeed = SPEED_CAP;
    app.nails?.clearAll?.();
    for (const [k, cube, x, yaw] of [[this.a, ca, -this.L, 0], [this.b, cb, this.L, Math.PI]]) {
      sb.removeCube(k);
      sb.addCube(k, x, this.h - 0.5 * app.sizeOf(cube), 0, yaw, app.bevelOf(cube), app.sizeOf(cube), app.resOf(cube));
      sb.cGrav[k] = 0;
    }
    sb.rebuild();
    app._syncSel?.();
    app.onTopologyChanged();
    app.markHealed?.();
    app.zits?.reset();
    sb.wakeAll();
    this.phase = '';
    this.cam = -1;
    this._slow(1);
    this.frameX = 0;
    this.frameZ = 0;
    this.frameY = this.h;
    // (the view: three-quarters on to them, far enough back for both - a phone held upright, narrow)
    const vf = THREE.MathUtils.degToRad(app._fovBase || app.camera.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * (app.camera.aspect || 1));
    const g = app.orbitGoal, span = (2 * this.L + 2 * s) * Math.cos(0.6);
    g.theta = 0.6;
    g.phi = 0.16;
    g.radius = Math.max(6, (0.55 * span) / Math.tan(hf / 2));
    this._wide = g.radius;
  }

  // Fire: both at each other, head on
  fire() {
    if (!this.on || this.phase) return;
    const app = this.app, sb = app.sb, v = this.speed;
    for (let i = 0; i < sb.nV; i++) {
      const k = sb.vCube[i];
      if (k !== this.a && k !== this.b) continue;
      sb.v[i * 3] = k === this.a ? v : -v;
      sb.v[i * 3 + 1] = 0;
      sb.v[i * 3 + 2] = 0;
    }
    sb.wakeAll();
    this.phase = 'fly';
    this.t = 0;
    this._slow(FLY_SLOW);
    app.audio?.whoosh(1);
    app.audio?.whoosh(0.7);
    this._changed();
  }

  // (their nearest faces: the gap between them along x, now)
  _gap() {
    const sb = this.app.sb;
    let ax = -Infinity, bx = Infinity;
    for (const pc of sb.pieces) {
      if (!pc) continue;
      if (pc.cube === this.a) ax = Math.max(ax, pc.bbox[3]);
      else if (pc.cube === this.b) bx = Math.min(bx, pc.bbox[0]);
    }
    return bx - ax;
  }

  update(dt) {
    if (!this.on) return;
    const app = this.app, sb = app.sb;
    this.t += dt;
    if (this.phase === 'fly') {
      // (met: the moment - flash, bang, time all but stopped)
      if (this._gap() < 0.02 || this.t > 4) this._meet();
    } else if (this.phase === 'meet') {
      this.st += dt * app.timeScale;
      if (!this.ruptured && this.st > ST_RUPTURE) this._rupture();
      // (each camera in turn)
      if (this.t - this.camT > CUT && this.cam < 3) this._cut(this.cam + 1);
      if (this.st > MEET_FOR) {
        this.phase = 'after';
        this.t = 0;
        this._slow(1);
        // (their weight back: what's left of them falls)
        for (const k of [this.a, this.b]) sb.cGrav[k] = 1;
        sb.wakeAll();
        this._cut(4);
        this._changed();
      }
    }
    // (the view on them: where the two of them are - their pieces' middle)
    if (this.phase === 'meet' || this.phase === 'after') {
      let M = 0, x = 0, y = 0, z = 0;
      for (const pc of sb.pieces) if (pc && (pc.cube === this.a || pc.cube === this.b)) (M += pc.volume), (x += pc.com[0] * pc.volume), (y += pc.com[1] * pc.volume), (z += pc.com[2] * pc.volume);
      if (M > 0) (this.frameX = x / M), (this.frameY = Math.max(0.3, y / M)), (this.frameZ = z / M);
      if (this.cam === 3) app.orbitGoal.theta += dt * 0.9;
    }
  }

  // (each - jelly, not brittle - torn apart at the height of it: ragged splits fanned out round the line they met
  // on, through its middle, more of them the harder; its spatter thrown out in a ring)
  _rupture() {
    this.ruptured = true;
    const app = this.app, sb = app.sb;
    if (this.closing < RUPTURE_V) return;
    const n = Math.min(6, Math.max(2, Math.round(2 + (this.closing - RUPTURE_V) / 14))), anchors = app.allAnchors();
    let any = false;
    for (const k of [this.a, this.b]) {
      let pi = -1;
      sb.pieces.forEach((pc, i) => {
        if (pc && pc.cube === k && (pi < 0 || pc.verts.length > sb.pieces[pi].verts.length)) pi = i;
      });
      const pc = sb.pieces[pi];
      if (!pc || app.shatter?.brittleOf(pc)) continue;
      const b = pc.bbox.slice(), m = 0.03, s = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
      const inIt = (x, y, z) => x > b[0] - m && x < b[3] + m && y > b[1] - m && y < b[4] + m && z > b[2] - m && z < b[5] + m;
      const c = pc.com.slice(), a0 = Math.random() * Math.PI;
      for (let j = 0; j < n; j++) {
        // (planes holding the line they met on - x - turned round it: wedges fanned out round it)
        const th = a0 + (j + (Math.random() - 0.5) * 0.6) * (Math.PI / n), ny = Math.cos(th), nz = Math.sin(th), nx = (Math.random() - 0.5) * 0.5;
        const l = Math.hypot(nx, ny, nz), N = [nx / l, ny / l, nz / l];
        const f = ragged(planeField(N[0], N[1], N[2], N[0] * c[0] + N[1] * c[1] + N[2] * c[2] + (Math.random() - 0.5) * 0.08 * s, inIt), 0.04 * s);
        f.inRegion = inIt;
        const ps = [];
        sb.pieces.forEach((q, i) => {
          if (q && q.cube === k) ps.push(i);
        });
        cutBody(sb, f, { separate: 0.01, anchors, pieces: ps, light: true });
      }
      any = true;
    }
    if (!any) return;
    sb.rebuild();
    app.onTopologyChanged();
    app.markDamaged();
    // (out from where they met, in a ring round the line of it)
    const p = new THREE.Vector3(this.frameX, this.h, this.frameZ);
    sb.radialImpulse(p.x, p.y, p.z, 3 * this.L, Math.min(9, 0.12 * this.closing), 0, 0);
    for (const k of [this.a, this.b]) {
      const col = app.flavorColorAtRest?.(k * 10, 0, 0, k) ?? '#ff4fa3';
      for (let j = 0; j < 26; j++) {
        const th = Math.random() * Math.PI * 2, sp = (0.15 + Math.random() * 0.25) * this.closing;
        app.droplets?.spawn(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.cos(th) * 0.3, Math.sin(th) * 0.3)), new THREE.Vector3((Math.random() - 0.5) * 2, Math.cos(th) * sp, Math.sin(th) * sp), 0.01 + Math.random() * 0.02, col);
      }
    }
    app.audio?.splat(1);
    app.hitStop?.(0.05);
  }

  _meet() {
    const app = this.app, sb = app.sb;
    this.phase = 'meet';
    this.ruptured = false;
    this.t = 0;
    this.st = 0;
    this._slow(MEET_SLOW);
    // (how fast they met, how hard: closing speed, the energy of it - a metre of jelly a tonne)
    let va = 0, vb = 0;
    for (const pc of sb.pieces) {
      if (pc?.cube === this.a) va = pc.vel[0];
      else if (pc?.cube === this.b) vb = pc.vel[0];
    }
    this.closing = Math.max(0, va - vb);
    const m = (k) => {
      const cb = app.cubes.find((c) => c.slot === k), s = cb ? app.sizeOf(cb) : 1;
      return s * s * s * (sb.cDens[k] || 1) * 1000;
    };
    const ma = m(this.a), mb = m(this.b), mu = (ma * mb) / Math.max(1e-6, ma + mb);
    this.energy = (0.5 * mu * this.closing * this.closing) / 1e6;
    // (the hit: a flash, a bang, the view shaken, sparks of it out from where they met)
    const p = new THREE.Vector3(0, this.h, 0);
    app.flash = Math.max(app.flash || 0, 0.35);
    app.shake(0.06);
    app.kick?.(0.05);
    app.audio?.boom(1);
    app.audio?.splat(1);
    app.audio?.thud(1);
    for (let k = 0; k < 40; k++) app.particles?.glitter(p, 1, [1, 0.95, 0.8], 2.6);
    app.particles?.mist(p, new THREE.Vector3(0, 0.4, 0), 18);
    app.tally?.('smashed');
    this._cut(0);
    this._changed();
  }

  // (the camera's turn - straight to it, a cut, not a swing: side on, head on, from above, close and round it -
  // then the whole of it, back to speed)
  _cut(n) {
    const app = this.app, g = app.orbitGoal, o = app.orbit, s = 1.1;
    this.cam = n;
    this.camT = this.t;
    const views = [
      { theta: 0.15, phi: 0.08, radius: 4.2 * s }, // side on
      { theta: -Math.PI / 2 + 0.22, phi: 0.12, radius: 4.6 * s }, // head on, behind the first
      { theta: 0.4, phi: 1.32, radius: 6 * s }, // from above
      { theta: 0.9, phi: 0.3, radius: 3.4 * s }, // close, round it
      { theta: 0.6, phi: 0.3, radius: Math.max(7, 0.7 * (this._wide || 9)) }, // all of it, after
    ];
    const v = views[n];
    if (!v) return;
    Object.assign(g, v);
    if (n < 4) Object.assign(o, v);
  }

  // (time slowed to k - at once, not eased: they'd have met before it got there)
  _slow(k) {
    const app = this.app;
    app.slowGoal = k;
    app.timeScale = k;
  }

  track() {
    if (!this.on) this.frameY = null;
  }

  _changed() {
    this.onChange?.(this.phase);
  }
}
