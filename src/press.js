// Press - an exhibition mode: the cube under a hydraulic press. Its plate comes down at its speed till it's as far
// off the floor as asked (a share of the cube's side), pushing what's under it down to it and gripping it as the
// floor does (SoftBody.press - see _solveBounds): jelly squashed flat, spreading out under it and bulging out round
// its edges; brittle things - glass, candy, ice, sugar, frozen jelly - cracking under it, then crushed smaller as it
// keeps coming (see world/shatter.js). Its gauge reads how hard it's pushing, in tonnes; past STALL times the cube's
// weight it can't - stalled, held there. Then back up.

import * as THREE from 'three';
import { makePress } from './world/models.js';
import { polarRot } from './sim/softbody.js';
import { cutBody, planeField, removeTets } from './sim/cutting.js';
import { ragged } from './tools/basic.js';

const STORE = 'cube-sim-press';
export const PRESS_SPEED = [0.05, 0.8]; // (m/s: the plate coming down, slowest and fastest)
export const PRESS_DEPTH = [0.04, 0.6]; // (the gap it comes down to: a share of the cube's side)
const UP_V = 1.2; // (m/s: going back up)
const STALL = 80; // (its push, x the weight of what's under it: past this it can't - stalled)
const CRUSH = 4; // (its push, x that weight: a brittle thing under it this hard cracks - and again as it keeps coming)
// (its plate's grip on what it presses, x the floor's: slick steel - gripped as the floor grips, a jelly cube went
// down to a 4 cm pad the plate's size and no further, squeezed thin in place; let slide, it spreads out from under it)
const PLATE_GRIP = +(globalThis.__plateGrip ?? 0.1);
// (squashed under it to less than this of its own volume - as far as the jelly holds, pressed: past it, its tets
// were crushed through themselves, a cube flattened to a tenth of its height keeping a twentieth of its volume - it
// bursts: split in wedges from its middle and squirted out from under the plate. Not again for BURST_GAP s)
const BURST_AT = 0.85, BURST_GAP = 0.45;
// (squashed past YIELD of its height it gives: yielded - its strain measured against itself flattened that much more,
// as much jelly, wider - see SoftBody.cFlat - so it spreads out under the plate, a pancake, its squash kept at YIELD.
// Held to its shape as made, the jelly couldn't: past half its height its tets crushed inside out, and pressed to 4%
// it was a ball a third its width with 1% of its volume. Slid out over the floor and under the plate as it goes - its
// grip on both SLIP of what it was; sprung back up to a cube over BACK_T s once the plate's off it)
const YIELD = 0.3, FLAT_MIN = 0.04, SLIP = 0.05, BACK_T = 1.2;
// (the plate off it: held to the squash as it eases back - thicker, the rim drawn back in - RISE of its height a
// second at most, no faster than the plate lifts; let go at LET_GO of its height, to spring the rest of the way. Let go
// at once, its rim fell flat into a disc - and back up at once, it was squeezed out sideways from under the plate)
const RISE = 1.6, LET_GO = 0.92;
// (a cube full of liquid yielded this flat: it bursts, a water balloon)
const LIQ_BURST = 0.4;
// (squeezed out past the plate's edge, nothing on it: risen up beside it - as much of it as went out - to RIM of its
// height, once half a cube of it's out; up the plate's side over RIM_UP of a cube. Held to the gap out there too, a
// pancake 4 cm thin went on round the plate over the floor, nothing pressing it)
const RIM = 0.42, RIM_UP = 0.06;

export class PressMode {
  constructor(app) {
    this.app = app;
    this.on = false;
    this.phase = ''; // '' ready, 'down', 'hold', 'up'
    this.t = 0;
    this.speed = 0.25;
    this.depth = 0.12;
    try {
      const o = JSON.parse(localStorage.getItem(STORE) || '{}');
      if (o.speed >= PRESS_SPEED[0] && o.speed <= PRESS_SPEED[1]) this.speed = o.speed;
      if (o.depth >= PRESS_DEPTH[0] && o.depth <= PRESS_DEPTH[1]) this.depth = o.depth;
    } catch (e) {}
    this.slot = 0;
    this.s = 1; // (its cube's side)
    this.cx = 0; // (the plate's middle, over the cube)
    this.cz = 0;
    this.y0 = 1.5; // (the plate's bottom: up, as it starts - and now)
    this.y = 1.5;
    this.top = 2;
    this.turn = 0; // (which way it faces: square on to the view, the nearest way)
    this.model = null;
    this.plate = null;
    this.rod = null;
    this.force = 0; // (N: its push now, the most so far - and the weight of what's under it, for the stall)
    this.peak = 0;
    this.weight = 1;
    this.stalled = false;
    this.squash = 1; // (the gap now over the cube's height: 1 untouched)
    this.frameX = 0; // (where the camera looks - see App._updateCamera)
    this.frameY = null;
    this.frameZ = 0;
    this._goal = null;
    this._fit = { r: 6, rc: 3, y: 1 }; // (the view's distance: all of it, its plate close; and its height)
    this._burstT = -9; // (when it last burst something)
    this.massT = 1; // (t: what it presses weighs, as a cube of its size and stuff would)
    this.h0 = 1; // (its height as the plate came down on it; how flat it's yielded to - see YIELD - and if it can)
    this.flat = 1;
    this.gives = false;
    this._grip = null; // (its grip on the floor as it was, while it's slid out: { fric, tack })
    this._popped = false; // (full of liquid, burst already this press)
    this._R = null; // (its turn, as made to as it lies - see _upRest)
    this._grindT = -9; // (when shards under it were last ground to grit - see _grind)
    this.reach = 0; // (how far out from the plate's middle it's squeezed, squared off - see _targets)
    this._gt = new Float64Array(17); // (the rim's volume up its side, out from the plate's edge - see _targets)
    this.onChange = null; // (its bar: see ui/dropbar.js)
  }

  set(o) {
    if (o.speed !== undefined) this.speed = Math.min(PRESS_SPEED[1], Math.max(PRESS_SPEED[0], o.speed));
    if (o.depth !== undefined) this.depth = Math.min(PRESS_DEPTH[1], Math.max(PRESS_DEPTH[0], o.depth));
    try {
      localStorage.setItem(STORE, JSON.stringify({ speed: this.speed, depth: this.depth }));
    } catch (e) {}
  }

  enter() {
    if (this.on) return;
    this.on = true;
    this.phase = '';
    this.app.tool?.up?.();
    this.app.sb.endGrab();
    this._place();
    this._view(true);
    this._changed();
  }

  exit() {
    if (!this.on) return;
    this._unflat();
    this.app.sb.press = null;
    this.app.roomHold = null;
    this.app._arena();
    this.app.audio?.loop('press', false);
    if (this.model) {
      this.app.scene.remove(this.model);
      this.model.traverse((o) => o.geometry?.dispose?.());
    }
    this.model = this.plate = this.rod = null;
    this._view(false);
    this.on = false;
    this.phase = '';
    this.frameY = null;
    this._changed();
  }

  // (the press stood round the cube on show - turned square on to the view, the nearest way - its plate over it)
  _place() {
    const app = this.app, sb = app.sb;
    this.slot = app.cube?.slot ?? 0;
    const s = (this.s = sb.cSize[this.slot] || sb.p.size);
    let pc = null;
    for (const q of sb.pieces) if (q && q.cube === this.slot && (!pc || q.verts.length > pc.verts.length)) pc = q;
    this.cx = pc ? pc.com[0] : 0;
    this.cz = pc ? pc.com[2] : 0;
    const hi = pc ? pc.bbox[4] : s;
    this.y0 = this.y = hi + 0.45 * s;
    this.top = this.y0 + 0.32 * s;
    if (this.model) app.scene.remove(this.model);
    this.model = makePress(app.M, s, this.top);
    this.model.position.set(this.cx, 0, this.cz);
    this.turn = Math.round(app.orbitGoal.theta / (Math.PI / 2)) * (Math.PI / 2);
    this.model.rotation.y = this.turn;
    this.plate = this.model.getObjectByName('plate');
    this.rod = this.model.getObjectByName('rod');
    app.scene.add(this.model);
    // (how far back to see all of it - its height and its width, a phone held upright narrow - and to see its plate's
    // width, close)
    const vf = THREE.MathUtils.degToRad(app._fovBase || app.camera.fov), asp = app.camera.aspect || 1;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * asp), H = this.top + 1.35 * s, W = 2 * (this.model.userData.half + 0.6 * s);
    const r = Math.max((0.6 * H) / Math.tan(vf / 2), (0.55 * W) / Math.tan(hf / 2));
    this._fit = { r: Math.max(4, r), rc: Math.max(2.5 * s, (0.62 * 2 * this.model.userData.half) / Math.tan(hf / 2)), y: 0.45 * H };
    // (what's under it weighs: the whole of its cube, for the stall and the crush)
    let M = 0;
    for (let i = 0; i < sb.nV; i++) if (sb.vCube[i] === this.slot && sb.alive[i]) M += sb.m[i];
    this.weight = Math.max(1e-6, M * Math.abs(sb.p.gravity));
    // (its weight in tonnes, as a cube of its size and stuff would be: a metre of jelly, a tonne - for the gauge)
    this.massT = s * s * s * (sb.cDens?.[this.slot] || 1);
    // (room for it to spread: flattened to 4% it's five times as wide)
    app.roomHold = { arena: 3 * s + 2 };
    app._arena();
    this._plate();
  }

  // (its rest frame's up, as it lies now: which way it's squashed - the turn that best takes it as made to as it is)
  _upRest(pc) {
    const sb = this.app.sb, x = sb.x, X = sb.X, m = sb.m, A = new Float64Array(9), R = new Float64Array(9);
    let M = 0, cx = 0, cy = 0, cz = 0, Cx = 0, Cy = 0, Cz = 0;
    for (const i of pc.verts) {
      const o = i * 3, mi = m[i];
      M += mi;
      cx += x[o] * mi; cy += x[o + 1] * mi; cz += x[o + 2] * mi;
      Cx += X[o] * mi; Cy += X[o + 1] * mi; Cz += X[o + 2] * mi;
    }
    if (!(M > 0)) return [0, 1, 0];
    cx /= M; cy /= M; cz /= M; Cx /= M; Cy /= M; Cz /= M;
    for (const i of pc.verts) {
      const o = i * 3, mi = m[i], dx = (x[o] - cx) * mi, dy = (x[o + 1] - cy) * mi, dz = (x[o + 2] - cz) * mi;
      const rx = X[o] - Cx, ry = X[o + 1] - Cy, rz = X[o + 2] - Cz;
      A[0] += dx * rx; A[1] += dx * ry; A[2] += dx * rz;
      A[3] += dy * rx; A[4] += dy * ry; A[5] += dy * rz;
      A[6] += dz * rx; A[7] += dz * ry; A[8] += dz * rz;
    }
    polarRot(new Float64Array([0, 0, 0, 1]), A, R, 16);
    this._R = R;
    return [R[3], R[4], R[5]];
  }

  // (as the plate comes down on it: how tall it is, which way's up in it, whether it gives - brittle things crack)
  _yieldStart() {
    const app = this.app, sb = app.sb, k = this.slot;
    let pc = null;
    for (const q of sb.pieces) if (q && q.cube === k && (!pc || q.verts.length > pc.verts.length)) pc = q;
    this.gives = !!pc && !app.shatter?.brittleOf(pc);
    this.h0 = pc ? Math.max(0.05, pc.bbox[4] - pc.bbox[1]) : this.s;
    if (pc) sb.cFlatN.set(this._upRest(pc), k * 3);
    this.flat = sb.cFlat[k] = 1;
    this._popped = false;
  }

  // (yielded to f: and, flattened at all, slid out - its grip on the floor and the plate next to none - its layers kept
  // in order under the plate while it's pressed, see SoftBody._solveBounds: blended in over the first of it)
  _setFlat(f) {
    const sb = this.app.sb, k = this.slot, P = sb.press;
    this.flat = sb.cFlat[k] = f;
    if (f < 1 && !this._grip) {
      this._grip = { fric: sb.cFric[k], tack: sb.cTack[k] };
      sb.cFric[k] *= SLIP;
      sb.cTack[k] = 0;
      for (let i = 0; i < sb.nV; i++) if (sb.vCube[i] === k) sb.stick[i] = 0;
    }
    if (!P) return;
    P.grip = f < 1 ? 0 : PLATE_GRIP;
    const pressing = this.phase === 'down' || this.phase === 'hold';
    if (pressing && f < 1 && !P.lock) P.lock = this._lock();
    const L = P.lock;
    if (L && pressing) {
      // (as high as the gap, as wide as keeps all of it)
      L.g = Math.max(FLAT_MIN, this.y / L.H);
      L.L = 1 / Math.sqrt(L.g);
      L.b = Math.min(1, (1 - f) / 0.15);
    }
  }

  // (the squash it's held to - see SoftBody._solveBounds: its rest axes, up first (n), its rest bottom's middle, and
  // where those are now - the up straight up, the others level, about its middle on the floor)
  _lock() {
    const sb = this.app.sb, k = this.slot, X = sb.X, N = sb.cFlatN, R = this._R;
    let pc = null;
    for (const q of sb.pieces) if (q && q.cube === k && (!pc || q.verts.length > pc.verts.length)) pc = q;
    if (!pc || !R) return null;
    const n = [N[k * 3], N[k * 3 + 1], N[k * 3 + 2]], nl = Math.hypot(...n) || 1;
    n[0] /= nl; n[1] /= nl; n[2] /= nl;
    // (a rest axis across it: x, or z if x is near its up)
    let u = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
    const d = u[0] * n[0] + u[1] * n[1] + u[2] * n[2];
    u = [u[0] - d * n[0], u[1] - d * n[1], u[2] - d * n[2]];
    const ul = Math.hypot(...u);
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    const w = [u[1] * n[2] - u[2] * n[1], u[2] * n[0] - u[0] * n[2], u[0] * n[1] - u[1] * n[0]];
    // (u now, level; w now = U x up)
    let U = [R[0] * u[0] + R[1] * u[1] + R[2] * u[2], 0, R[6] * u[0] + R[7] * u[1] + R[8] * u[2]];
    const Ul = Math.hypot(U[0], U[2]) || 1;
    U = [U[0] / Ul, 0, U[2] / Ul];
    const W = [-U[2], 0, U[0]];
    // (its rest middle, and its lowest and highest along n)
    let M = 0, cx = 0, cy = 0, cz = 0, lo = Infinity, hi = -Infinity;
    for (let i = 0; i < sb.nV; i++) {
      if (sb.vCube[i] !== k || !sb.alive[i]) continue;
      const o = i * 3, r = X[o] * n[0] + X[o + 1] * n[1] + X[o + 2] * n[2];
      M++;
      cx += X[o]; cy += X[o + 1]; cz += X[o + 2];
      if (r < lo) lo = r;
      if (r > hi) hi = r;
    }
    if (!M || !(hi > lo)) return null;
    cx /= M; cy /= M; cz /= M;
    const mid = cx * n[0] + cy * n[1] + cz * n[2], C = [cx + (lo - mid) * n[0], cy + (lo - mid) * n[1], cz + (lo - mid) * n[2]];
    return { k, b: 0, C, u, n, w, c: [pc.com[0], 0, pc.com[2]], U, W, L: 1, g: 1, H: hi - lo, tgt: null, inner: null, nV: 0 };
  }

  // (where each point of it goes, squashed - see SoftBody._solveBounds. First evenly, as a slick press squashes it, as
  // thick as the gap and as wide as keeps all of it; then what that puts past the plate's edge - out from under it,
  // nothing on it - risen up beside it: along each line out from the plate's middle, as much jelly as was out there
  // in the gap's thickness, in RIM's. Squared off, as the plate is: a line out to its side gets a strip of rim as long
  // as it is far)
  _targets() {
    const sb = this.app.sb, L = sb.press?.lock;
    if (!L || !(L.b > 0)) return;
    const n = sb.nV, X = sb.X, vc = sb.vCube, alive = sb.alive, s = this.s;
    if (!L.tgt || L.tgt.length < n * 3) {
      L.tgt = new Float64Array(sb.vCap * 3);
      L.inner = new Uint8Array(sb.vCap);
    }
    const T = L.tgt, I = L.inner, P = this.model.userData.half, px = this.cx, pz = this.cz, H = L.H, gy = L.g * H;
    // (evenly: across, from its rest across; up, the share of the way up it it was - kept in y for now)
    let rmax = 0;
    for (let i = 0; i < n; i++) {
      if (vc[i] !== L.k || !alive[i]) continue;
      const o = i * 3, dx = X[o] - L.C[0], dy = X[o + 1] - L.C[1], dz = X[o + 2] - L.C[2];
      const a = (dx * L.u[0] + dy * L.u[1] + dz * L.u[2]) * L.L, c = (dx * L.w[0] + dy * L.w[1] + dz * L.w[2]) * L.L;
      const qx = L.c[0] + a * L.U[0] + c * L.W[0], qz = L.c[2] + a * L.U[2] + c * L.W[2];
      T[o] = qx;
      T[o + 1] = Math.min(1, Math.max(0, (dx * L.n[0] + dy * L.n[1] + dz * L.n[2]) / H));
      T[o + 2] = qz;
      rmax = Math.max(rmax, Math.abs(qx - px), Math.abs(qz - pz));
    }
    // (the rim: as high as RIM of it, once half a cube's out - less till then; up the plate's side over d)
    const ht = Math.max(gy, gy + (RIM * H - gy) * Math.min(1, Math.max(0, (rmax - P) / (0.5 * s)))), d = RIM_UP * s, NT = this._gt.length - 1, G = this._gt;
    const hAt = (u) => gy + (ht - gy) * u * u * (3 - 2 * u);
    // (its volume out to each step up the side, a line's worth: the height x 2r dr)
    G[0] = 0;
    for (let j = 1; j <= NT; j++) {
      const r0 = P + (d * (j - 1)) / NT, r1 = P + (d * j) / NT;
      G[j] = G[j - 1] + (hAt((j - 1) / NT) * r0 + hAt(j / NT) * r1) * (d / NT);
    }
    const Gd = G[NT], Pd = P + d;
    let reach = 0;
    for (let i = 0; i < n; i++) {
      if (vc[i] !== L.k || !alive[i]) continue;
      const o = i * 3, ex = T[o] - px, ez = T[o + 2] - pz, r = Math.max(Math.abs(ex), Math.abs(ez)), t = T[o + 1];
      if (r <= P) {
        T[o + 1] = t * gy;
        I[i] = 1;
        reach = Math.max(reach, r);
        continue;
      }
      I[i] = 0;
      // (as much out to it, in the rim, as was out to it in the gap)
      const V = gy * (r * r - P * P);
      let rp, hp;
      if (V >= Gd) {
        rp = Math.sqrt(Pd * Pd + (V - Gd) / ht);
        hp = ht;
      } else {
        let j = 0;
        while (j < NT - 1 && G[j + 1] <= V) j++;
        const f = G[j + 1] > G[j] ? (V - G[j]) / (G[j + 1] - G[j]) : 0, u = (j + f) / NT;
        rp = P + d * u;
        hp = hAt(u);
      }
      T[o] = px + (ex * rp) / r;
      T[o + 1] = t * hp;
      T[o + 2] = pz + (ez * rp) / r;
      reach = Math.max(reach, rp);
    }
    L.nV = n;
    this.reach = reach;
  }

  // (back as made: its shape, its grip)
  _unflat() {
    const sb = this.app.sb, k = this.slot;
    this.flat = sb.cFlat[k] = 1;
    if (sb.press) sb.press.lock = null;
    if (this._grip) {
      sb.cFric[k] = this._grip.fric;
      sb.cTack[k] = this._grip.tack;
      this._grip = null;
    }
    if (sb.press) sb.press.grip = PLATE_GRIP;
  }

  // (the plate where it is - in the jelly's world, and drawn)
  _plate() {
    const sb = this.app.sb, h = this.model.userData.half, s = this.s;
    if (!sb.press) sb.press = { y: this.y, th: 0.14 * s, x0: 0, x1: 0, z0: 0, z1: 0, grip: PLATE_GRIP, lock: null, _f: 0, _n: 0 };
    const P = sb.press;
    P.y = this.y;
    P.th = 0.14 * s;
    P.x0 = this.cx - h; P.x1 = this.cx + h;
    P.z0 = this.cz - h; P.z1 = this.cz + h;
    this.plate.position.y = this.y;
    const foot = this.y + 0.24 * s, len = Math.max(0.01, this.top - foot);
    this.rod.position.y = foot + len / 2;
    this.rod.scale.y = len;
  }

  // Press: down it comes
  start() {
    if (!this.on || (this.phase && this.phase !== 'hold')) return;
    if (this.phase === 'hold') return this.release();
    this._unflat();
    this._place();
    this._yieldStart();
    this.phase = 'down';
    this.t = 0;
    this.peak = 0;
    this.stalled = false;
    this.app.audio?.thud(0.5);
    this.app.audio?.loop('press', true, { type: 'lowpass', freq: 380, q: 0.9, gain: 0.22, lfo: 50, flicker: 0.35 });
    this.app.sb.wakeAll();
    this._changed();
  }

  // ...and back up
  release() {
    if (this.phase !== 'down' && this.phase !== 'hold') return;
    this.phase = 'up';
    this.t = 0;
    this.app.audio?.loop('press', false);
    this.app.audio?.whoosh(0.35);
    this.app.sb.wakeAll();
    this._changed();
  }

  update(dt) {
    if (!this.on || !this.model) return;
    const app = this.app, sb = app.sb, s = this.s, P = sb.press;
    this.t += dt;
    // (its push this frame: the plate's hold on what's under it, over its substeps)
    if (P) {
      // (none lifting off it - the squash still held as it eases back pushed against the hold, not the plate)
      this.force = P._n && (this.phase === 'down' || this.phase === 'hold') ? P._f / P._n : 0;
      P._f = P._n = 0;
      this.peak = Math.max(this.peak, this.force);
    }
    const low = this.depth * s;
    // (what's under it kept awake while it moves or holds: asleep - a cube at rest is - the plate went straight
    // through it)
    if (this.phase && P) for (let i = 0; i < sb.pieces.length; i++) {
      const pc = sb.pieces[i];
      if (pc && pc.asleep && pc.bbox[4] > this.y - 0.15 * s && pc.bbox[3] > P.x0 && pc.bbox[0] < P.x1 && pc.bbox[5] > P.z0 && pc.bbox[2] < P.z1) sb.wake(i);
    }
    if (this.phase === 'down') {
      // (stalled - not on jelly that's given way, see _lock: a cube full of liquid, burst, its liquid squeezed in it,
      // stalled the plate at 7%)
      if (this.force > STALL * this.weight && !sb.press?.lock) {
        this.stalled = true;
        this.phase = 'hold';
        this.t = 0;
        app.audio?.crack(0.3);
        this._changed();
      } else {
        this.y = Math.max(low, this.y - this.speed * dt);
        if (this.y <= low + 1e-4) {
          this.phase = 'hold';
          this.t = 0;
          this._changed();
        }
      }
      app.audio?.loopLevel('press', 0.55 + 0.45 * Math.min(1, this.force / (0.3 * STALL * this.weight)));
    } else if (this.phase === 'up') {
      this.y = Math.min(this.y0, this.y + UP_V * dt);
      if (this.y >= this.y0 - 1e-4) {
        this.phase = '';
        this._changed();
      }
    }
    // (squashed past what it gives: yielded, a pancake under it - and once it's off, sprung back up)
    if (this.gives && (this.phase === 'down' || this.phase === 'hold')) {
      const f = Math.min(1, Math.max(FLAT_MIN, this.y / (this.h0 * (1 - YIELD))));
      if (f < this.flat) this._setFlat(f);
      // (full of liquid, stretched this thin: it bursts)
      if (!this._popped && this.flat < LIQ_BURST && sb.cLiq[this.slot]) {
        this._popped = true;
        sb.pieces.forEach((pc, i) => {
          if (pc && pc.cube === this.slot && pc.volume > 0.2 * s * s * s) this._burst(pc, i);
        });
      }
    } else if (sb.press?.lock) {
      // (the plate off it: eased back up under it as it rises - see RISE - then let go)
      const L = sb.press.lock, up = this.phase === 'up' ? (this.y - 0.02 * s) / L.H : 1;
      L.g = Math.max(L.g, Math.min(up, L.g + dt * RISE));
      L.L = 1 / Math.sqrt(L.g);
      if (L.g >= LET_GO) this._unflat();
      else this._setFlat(Math.min(1, L.g / (1 - YIELD)));
    } else if (this.flat < 1) {
      // (no squash held - not given way enough for one: back as made, over BACK_T)
      const f = this.flat + dt / BACK_T;
      if (f >= 1) this._unflat();
      else this._setFlat(f);
    }
    // (pressing jelly past what it holds: it bursts - not what's squashed evenly, see _lock: all of it kept)
    if ((this.phase === 'down' || this.phase === 'hold') && !sb.press?.lock && this.t - this._burstT > BURST_GAP) this._squeezed();
    // (pressing hard on something brittle: it cracks - and cracks again, smaller, as it keeps coming)
    if ((this.phase === 'down' || this.phase === 'hold') && this.force > CRUSH * this.weight && app.shatter) {
      const h = this.model.userData.half;
      sb.pieces.forEach((pc, i) => {
        if (!pc || pc.bbox[4] < this.y - 0.03 * s) return;
        if (pc.com[0] < this.cx - h || pc.com[0] > this.cx + h || pc.com[2] < this.cz - h || pc.com[2] > this.cz + h) return;
        if (!app.shatter.brittleOf(pc)) return;
        app.shatter.blow(i, new THREE.Vector3(pc.com[0], this.y, pc.com[2]), new THREE.Vector3(0, -1, 0), Math.min(3, 1 + this.force / (12 * this.weight)), null, 'blow');
      });
    }
    // (shards under it thicker than the gap: ground to grit)
    if (this.phase === 'down' && app.shatter && this.t - this._grindT > 0.2) this._grind();
    this._targets();
    this._plate();
    // (the gap over the cube's height - for the gauge)
    this.squash = Math.min(1, this.y / Math.max(1e-6, s));
    // (the view: all of it as it starts; coming down, closer and lower - on the gap, the jelly squashed in it; given
    // way, up over it and back, looking down on it spread out round the plate - side on, a pancake's a line)
    const u = Math.min(1, Math.max(0, (this.y0 - this.y) / Math.max(1e-6, this.y0 - 0.5 * s))), e = u * u * (3 - 2 * u);
    const q = this.gives ? Math.min(1, Math.max(0, (0.85 - this.flat) / 0.5)) : 0, ep = q * q * (3 - 2 * q);
    this.frameX = this.cx;
    this.frameZ = this.cz;
    this.frameY = this._fit.y + (Math.max(0.06 * s, 0.5 * this.y) - this._fit.y) * e;
    this.frameY += (0.1 * s - this.frameY) * ep;
    if (this.phase === 'down') {
      const g = app.orbitGoal;
      g.radius = this._fit.r + (this._fit.rc - this._fit.r) * e;
      g.phi = 0.2 + (0.02 - 0.2) * e;
      if (ep > 0) {
        // (back far enough for it as wide as it'll go - a phone upright, narrow)
        const vf = THREE.MathUtils.degToRad(app._fovBase || app.camera.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * (app.camera.aspect || 1));
        const W = 2 * Math.max(this.model.userData.half, this.reach) + 0.4 * s, rp = (0.6 * W) / Math.tan(hf / 2);
        g.radius += (Math.max(this._fit.rc, rp) - g.radius) * ep;
        g.phi += (0.62 - g.phi) * ep;
      }
    } else if (this.phase === 'up') {
      // (back down side on as it rises: from over it, the plate hid it coming back)
      const g = app.orbitGoal;
      g.radius = this._fit.r;
      g.phi = 0.2;
    }
  }

  // (each piece under the plate - not brittle: those crack - squashed how far: its tets' volume now over as made.
  // The worst one past BURST_AT bursts)
  _squeezed() {
    const app = this.app, sb = app.sb, x = sb.x, T = sb.T, s = this.s, P = sb.press;
    let worst = null, wi = -1, wr = BURST_AT;
    sb.pieces.forEach((pc, i) => {
      if (!pc || pc.bbox[4] < this.y - 0.03 * s || pc.bbox[3] < P.x0 || pc.bbox[0] > P.x1 || pc.bbox[5] < P.z0 || pc.bbox[2] > P.z1) return;
      if (pc.volume < 0.08 * s * s * s || app.shatter?.brittleOf(pc)) return;
      let V = 0, V0 = 0;
      for (const t of pc.tets) {
        const o = t * 4, a = T[o] * 3, b = T[o + 1] * 3, c = T[o + 2] * 3, d = T[o + 3] * 3;
        const ax = x[b] - x[a], ay = x[b + 1] - x[a + 1], az = x[b + 2] - x[a + 2], bx = x[c] - x[a], by = x[c + 1] - x[a + 1], bz = x[c + 2] - x[a + 2];
        const cx = x[d] - x[a], cy = x[d + 1] - x[a + 1], cz = x[d + 2] - x[a + 2];
        V += Math.abs(ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
        V0 += sb.vol0[t];
      }
      const r = V0 > 0 ? V / V0 : 1;
      if (r < wr) (wr = r), (worst = pc), (wi = i);
    });
    if (worst) this._burst(worst, wi);
  }

  // A piece pressed past what it holds bursts: split in ragged wedges out from its middle - more, the bigger it is -
  // and squirted out from under the plate, its liquid (a cube full of it) out through the splits
  _burst(pc, i) {
    const app = this.app, sb = app.sb, s = this.s, b = pc.bbox.slice(), m = 0.03;
    const c = new THREE.Vector3(pc.com[0], 0.5 * (b[1] + b[4]), pc.com[2]);
    const inIt = (x, y, z) => x > b[0] - m && x < b[3] + m && y > b[1] - m && y < b[4] + m && z > b[2] - m && z < b[5] + m;
    const n = pc.volume > 0.4 * s * s * s ? 3 : 2, a0 = Math.random() * Math.PI, anchors = app.allAnchors();
    for (let k = 0; k < n; k++) {
      const th = a0 + (k + (Math.random() - 0.5) * 0.5) * (Math.PI / n), nx = Math.cos(th), nz = Math.sin(th);
      const f = ragged(planeField(nx, 0, nz, nx * c.x + nz * c.z + (Math.random() - 0.5) * 0.06 * s, inIt), 0.03 * s);
      f.inRegion = inIt;
      cutBody(sb, f, { separate: 0.01, anchors, pieces: [i], light: k < n - 1 });
    }
    if (sb.topoStale) sb.rebuild();
    app.onTopologyChanged();
    app.markDamaged();
    this._burstT = this.t;
    // (out from under it, along the floor)
    sb.radialImpulse(c.x, c.y, c.z, 2.6 * s, 4.5, 0.4);
    app.hitStop?.(0.06);
    app.shake(0.02);
    app.audio?.splat(0.9);
    app.audio?.thud(0.7);
    const col = app.flavorColorAtRest?.(0, 0, 0, pc.cube) ?? '#ff4fa3';
    for (let k = 0; k < 18; k++) {
      const th = Math.random() * Math.PI * 2, v = new THREE.Vector3(Math.cos(th) * (2 + Math.random() * 3), 0.6 + Math.random() * 1.6, Math.sin(th) * (2 + Math.random() * 3));
      app.droplets?.spawn(c.clone().add(new THREE.Vector3(Math.cos(th) * 0.4 * s, 0, Math.sin(th) * 0.4 * s)), v, 0.01 + Math.random() * 0.016, col);
    }
    app.tally?.('smashed');
  }

  // (brittle shards under the plate, the gap under half as thick as they are: ground to grit - gone, a puff of glinting
  // dust where each was. Pressed on down, a 4 cm gap, glass shards a third of a metre across were crushed through
  // themselves - 1700 tets inside out)
  _grind() {
    const app = this.app, sb = app.sb, s = this.s, h = this.model.userData.half, gone = new Set(), dust = [];
    sb.pieces.forEach((pc, i) => {
      if (!pc || pc.bbox[4] < this.y - 0.03 * s || this.y > 0.5 * Math.cbrt(pc.volume)) return;
      if (pc.com[0] < this.cx - h || pc.com[0] > this.cx + h || pc.com[2] < this.cz - h || pc.com[2] > this.cz + h) return;
      const B = app.shatter.brittleOf(pc);
      if (!B) return;
      gone.add(i);
      dust.push({ x: pc.com[0], z: pc.com[2], c: new THREE.Color(B.chip), n: Math.min(40, 8 + Math.round(400 * pc.volume)) });
    });
    if (!gone.size) return;
    this._grindT = this.t;
    removeTets(sb, (t) => gone.has(sb.tPiece[t]), app.allAnchors());
    app.onTopologyChanged();
    for (const d of dust) app.particles?.glitter(new THREE.Vector3(d.x, 0.5 * this.y, d.z), d.n, [d.c.r, d.c.g, d.c.b], 1.4);
    app.audio?.crack(0.4);
    app.shake(0.01);
  }

  // (tonnes, by the gauge: its push - as so many times its weight - and the most)
  get tonnes() {
    return (this.force / this.weight) * this.massT;
  }

  get peakTonnes() {
    return (this.peak / this.weight) * this.massT;
  }

  // (the view square on to it, back far enough to see all of it, a little above - and as it was, after)
  _view(on) {
    const app = this.app, g = app.orbitGoal;
    if (on && !this._goal) {
      this._goal = { theta: g.theta, phi: g.phi, radius: g.radius };
      g.theta = this.turn;
      g.phi = 0.2;
      g.radius = this._fit.r;
    } else if (!on && this._goal) {
      Object.assign(g, this._goal);
      this._goal = null;
    }
  }

  track() {
    if (!this.on) this.frameY = null;
  }

  _changed() {
    this.onChange?.(this.phase);
  }
}
