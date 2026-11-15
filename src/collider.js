// Collider - an exhibition mode: two cubes fired at each other. The cube on show and another - a copy of it, or one
// out of the Cubby - floating in the air apart, face to face (their weight off: SoftBody.cGrav), fired head on at
// the speed asked, each. Time slows as they go and slows again hard as they meet: the collision in bullet time,
// seen from one camera after another - side on, head on, from above, round it close - then back to speed, its
// pieces falling. Jelly splats, smears and tears; brittle things shatter (see world/shatter.js); a cube full of
// liquid bursts.

import * as THREE from 'three';
import { captureCube, decodeCube } from './cubecode.js';
import { separateClusters } from './sim/cutting.js';
import { TEXTURES } from './styles.js';
import { resolveSettings } from './settings.js';

const STORE = 'cube-sim-collider';
export const COLLIDE_SPEED = [8, 60]; // (m/s: each cube's, as it's fired)
const SPEED_CAP = 70; // (m/s: the jelly's fastest - SoftBody.p.maxSpeed - raised for it: 45 as it is)
const FLY_SLOW = 0.2; // (time as they fly at each other)
// (and as they meet, for MEET_FOR s of it, then back up: slowed to MEET_SLOW - more, closing faster than MEET_V m/s,
// and for less of it, as long a show. That slow, a 60th of a second's 4 substeps have them a centimetre closer each at
// most - their contacts hold. A fifth of time, 10 cm: at 60 m/s each they went 85 cm into each other, and the frame
// after froze 25 s untangling them)
const MEET_SLOW = 0.04, MEET_FOR = 0.16, MEET_V = 60;
const CUT = 1.05; // (s, real: each camera's turn while they meet)
// (met faster than this, m/s closing - and squashed into each other a moment, ST_RUPTURE s of it - jelly ruptures:
// torn apart from where it was hit, more ways the harder. As it was, two jelly cubes met at 180 km/h, squashed to
// a lens and sprang apart whole. Firmer stuff takes more, as firm as it is over jelly - and as tough: rubber five
// times jelly's speed. Brittle ones shatter as they meet: see world/shatter.js)
const RUPTURE_V = 11, ST_RUPTURE = 0.022, JELLY_MU = 170;
// (time slowed to as they meet, closing at v m/s)
const meetSlow = (v) => MEET_SLOW * Math.min(1, MEET_V / Math.max(1e-6, v));

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
    this.meetFor = MEET_FOR; // (s, the sim's: as long as they meet - and till they rupture - at the speed they met)
    this.stRupture = ST_RUPTURE;
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
    app.roomHold = null;
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
    // (the room's edge far off: what's thrown off them flies on and comes down - kept in close, two glass cubes'
    // shards hit it at 60 m/s, broke again and flew back in)
    sb.p.arenaRadius = Math.max(this._was?.arena ?? 2.35, this.L + 3 * s, 30);
    sb.p.ceiling = Math.max(sb.p.ceiling, this.h + 3 * s);
    app.roomHold = { arena: sb.p.arenaRadius, ceiling: sb.p.ceiling };
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
      // (time slowed as they near - each frame closing no more than a third of the gap left - so they meet already as
      // slow as they'll be: looked for once a frame, at a fifth of time, a frame took them 40 cm at 60 m/s each - they
      // met that far into each other. This frame's step is taken at the time it's at now: the next's at what's set)
      const gap = this._gap(), cl = this._closingNow(), dF = cl * Math.max(dt, 1 / 40);
      if (cl > 0) this._slow(Math.min(FLY_SLOW, Math.max(meetSlow(cl), (gap - dF * app.timeScale) / (3 * dF))));
      // (met: the moment - flash, bang, time all but stopped)
      if (gap < 0.02 || this.t > 4) this._meet();
    } else if (this.phase === 'meet') {
      this.st += dt * app.timeScale;
      if (!this.ruptured && this.st > this.stRupture) this._rupture();
      // (each camera in turn)
      if (this.t - this.camT > CUT && this.cam < 3) this._cut(this.cam + 1);
      if (this.st > this.meetFor) {
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

  // (each - jelly, not brittle - torn apart at the height of it: into wedges round the line they met on, their edges
  // ragged, more of them the harder - and harder still, its middle on its own; out they fly in a ring, its spatter with
  // them. Torn along its tets' own faces, all at once: cut a plane at a time - ten planes, each through all of it - a
  // frame froze 2.4 s, and the tets those cuts made, twice as many, slowed every frame after)
  _rupture() {
    this.ruptured = true;
    const app = this.app, sb = app.sb;
    const lab = new Int32Array(sb.nT).fill(-1), x = sb.x, T = sb.T, TAU = 2 * Math.PI, at = { [this.a]: this._tearsAt(this.a), [this.b]: this._tearsAt(this.b) };
    const torn = new Set();
    let L = 0;
    sb.pieces.forEach((pc) => {
      if (!pc || (pc.cube !== this.a && pc.cube !== this.b) || this.closing < at[pc.cube]) return;
      const cb = app.cubes.find((c) => c.slot === pc.cube), s = cb ? app.sizeOf(cb) : 1;
      if (pc.volume < 0.06 * s * s * s || app.shatter?.brittleOf(pc)) return;
      const over = this.closing - at[pc.cube], n = Math.min(7, Math.max(3, Math.round(3 + over / 16))), core = over > 1.5 * RUPTURE_V;
      // (its edges wavy: two waves through it, any which way, a third of its side long)
      const c = pc.com, a0 = Math.random() * TAU, w = [];
      for (let j = 0; j < 2; j++) w.push([(Math.random() - 0.5) * 18 / s, (Math.random() - 0.5) * 18 / s, (Math.random() - 0.5) * 18 / s, Math.random() * TAU]);
      const amp = 0.45 / n * Math.PI, r2 = (0.24 * s) ** 2;
      for (const t of pc.tets) {
        const o = t * 4, a = T[o] * 3, b = T[o + 1] * 3, d = T[o + 2] * 3, e = T[o + 3] * 3;
        const px = (x[a] + x[b] + x[d] + x[e]) / 4, py = (x[a + 1] + x[b + 1] + x[d + 1] + x[e + 1]) / 4, pz = (x[a + 2] + x[b + 2] + x[d + 2] + x[e + 2]) / 4;
        const dy = py - c[1], dz = pz - c[2];
        let th = Math.atan2(dz, dy) - a0;
        for (const q of w) th += amp * Math.sin(q[0] * px + q[1] * py + q[2] * pz + q[3]);
        th = ((th % TAU) + TAU) % TAU;
        lab[t] = L + (core && dy * dy + dz * dz < r2 ? n : Math.floor(th / (TAU / n)) % n);
      }
      L += n + 1;
      torn.add(pc.cube);
    });
    if (!L) return;
    separateClusters(sb, lab, app.allAnchors());
    app.onTopologyChanged();
    app.markDamaged();
    // (out from where they met, in a ring round the line of it)
    const p = new THREE.Vector3(this.frameX, this.h, this.frameZ);
    sb.radialImpulse(p.x, p.y, p.z, 3 * this.L, Math.min(9, 0.12 * this.closing), 0, 0);
    for (const k of torn) {
      const col = app.flavorColorAtRest?.(k * 10, 0, 0, k) ?? '#ff4fa3';
      for (let j = 0; j < 26; j++) {
        const th = Math.random() * Math.PI * 2, sp = (0.15 + Math.random() * 0.25) * this.closing;
        app.droplets?.spawn(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.cos(th) * 0.3, Math.sin(th) * 0.3)), new THREE.Vector3((Math.random() - 0.5) * 2, Math.cos(th) * sp, Math.sin(th) * sp), 0.01 + Math.random() * 0.02, col);
      }
    }
    app.audio?.splat(1);
    app.hitStop?.(0.05);
  }

  // (the closing speed, m/s, cube k tears at: jelly's, x how firm it is over jelly, x how tough)
  _tearsAt(k) {
    const cb = this.app.cubes.find((c) => c.slot === k), tex = cb && TEXTURES[cb.style.texture];
    if (!tex) return RUPTURE_V;
    const S = resolveSettings(cb.tune || {}, tex);
    return RUPTURE_V * Math.max(0.3, (S.mu ?? JELLY_MU) / JELLY_MU) * (S.tough ?? 1);
  }

  // (how fast they're closing now, m/s: the biggest piece of each)
  _closingNow() {
    const sb = this.app.sb;
    let va = 0, vb = 0, na = 0, nb = 0;
    for (const pc of sb.pieces) {
      if (!pc) continue;
      if (pc.cube === this.a && pc.verts.length > na) (va = pc.vel[0]), (na = pc.verts.length);
      else if (pc.cube === this.b && pc.verts.length > nb) (vb = pc.vel[0]), (nb = pc.verts.length);
    }
    return Math.max(0, va - vb);
  }

  _meet() {
    const app = this.app, sb = app.sb;
    this.phase = 'meet';
    this.ruptured = false;
    this.t = 0;
    this.st = 0;
    // (how fast they met, how hard: closing speed, the energy of it - a metre of jelly a tonne)
    this.closing = this._closingNow();
    this._slow(meetSlow(this.closing));
    const fast = Math.min(1, MEET_V / Math.max(1e-6, this.closing));
    this.meetFor = MEET_FOR * fast;
    this.stRupture = ST_RUPTURE * fast;
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
