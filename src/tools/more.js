import * as THREE from 'three';
import { cutBody, sphereField, planeField, removeTets, removeSmallPieces } from '../sim/cutting.js';
import { makeMallet, makeTorch, makeSpray, makeBaller, makeBomb, makeSyringe, makeMagnet, orient } from '../world/models.js';
import { fitRotation } from '../heal.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = [0, 0, 0];
const _p2 = [0, 0, 0];

// What is under the pointer: jelly, floor, or a point in mid-air.
function target(app, ray) {
  const hit = app.pickJelly(ray);
  // (molten jelly in front of it - or on the floor - is what's aimed at)
  const wet = app.fluid.n ? app.fluid.pick(ray) : null;
  if (wet && (!hit || wet.distance < hit.t)) return { hit: null, point: wet.point, normal: wet.normal, fluid: true };
  if (hit) return { hit, point: V(hit.point), normal: V(hit.normal), jelly: true };
  if (ray.direction.y < -1e-3) {
    const t = -ray.origin.y / ray.direction.y;
    if (t < 12) return { hit: null, point: ray.origin.clone().addScaledVector(ray.direction, t), normal: new THREE.Vector3(0, 1, 0), floor: true };
  }
  return { hit: null, point: ray.origin.clone().addScaledVector(ray.direction, 4), normal: ray.direction.clone().negate() };
}

// Direction from a target point back toward where a hand-held tool sits:
// up and to the right of the target, a little toward the camera and off the
// surface, so the tool is seen in profile rather than end-on.
function sideApproach(app, normal, out = new THREE.Vector3()) {
  const cam = app.camera;
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
  const back = new THREE.Vector3(0, 0, 1).applyQuaternion(cam.quaternion);
  out.copy(right).multiplyScalar(0.8).addScaledVector(up, 0.42).addScaledVector(back, 0.3).addScaledVector(normal, 0.55).normalize();
  return out;
}

function avgTemp(sb, p, r) {
  let s = 0, n = 0;
  for (let i = 0; i < sb.nV; i++) {
    if (!sb.alive[i]) continue;
    const d = Math.hypot(sb.x[i * 3] - p.x, sb.x[i * 3 + 1] - p.y, sb.x[i * 3 + 2] - p.z);
    if (d < r) {
      s += sb.temp[i];
      n++;
    }
  }
  return n ? s / n : 0;
}

function anchorAt(sb, p, piece = -1) {
  const r = sb.locate(p.x, p.y, p.z, piece);
  if (!r || r.score < -0.3) return null;
  return { tet: r.tet, b: r.bary.slice() };
}

function anchorOk(sb, a) {
  return a && a.tet >= 0 && a.tet < sb.nT;
}

// ------------------------------------------------------------------ mallet
// Click to smack. Unfrozen jelly takes a big wet blow and rings. Hit it
// again on its beat - a whole number of its own wobble periods later, so a
// hand can keep up (~0.35-0.75 s) - and the resonance builds: each hit
// lands harder, the jelly rings longer, glows when the next beat is due and
// sings a rising note. Keep the beat for six hits and it bursts. Frozen
// jelly shatters instead.
const RES_HITS = 6;
const RES_NOTES = [392.0, 440.0, 523.25, 587.33, 659.25, 783.99];

// Move piece k `amount` of the way back to its rest shape - turned and
// sized to fit how it lies now, standing on the floor - and take the same
// share out of its wobble.
export function springBack(sb, k, amount) {
  const vs = sb.pieces[k].verts, x = sb.x, X = sb.X, v = sb.v, m = sb.m;
  const C = new THREE.Vector3(), c = new THREE.Vector3(), u = new THREE.Vector3();
  let M = 0;
  for (const i of vs) {
    const w = m[i];
    M += w;
    C.x += X[i * 3] * w; C.y += X[i * 3 + 1] * w; C.z += X[i * 3 + 2] * w;
    c.x += x[i * 3] * w; c.y += x[i * 3 + 1] * w; c.z += x[i * 3 + 2] * w;
    u.x += v[i * 3] * w; u.y += v[i * 3 + 1] * w; u.z += v[i * 3 + 2] * w;
  }
  if (M <= 0) return;
  C.multiplyScalar(1 / M); c.multiplyScalar(1 / M); u.multiplyScalar(1 / M);
  const a = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  let den = 0;
  for (const i of vs) {
    const w = m[i];
    const dx = (x[i * 3] - c.x) * w, dy = (x[i * 3 + 1] - c.y) * w, dz = (x[i * 3 + 2] - c.z) * w;
    const RX = X[i * 3] - C.x, RY = X[i * 3 + 1] - C.y, RZ = X[i * 3 + 2] - C.z;
    a[0].x += dx * RX; a[0].y += dy * RX; a[0].z += dz * RX;
    a[1].x += dx * RY; a[1].y += dy * RY; a[1].z += dz * RY;
    a[2].x += dx * RZ; a[2].y += dy * RZ; a[2].z += dz * RZ;
    den += w * (RX * RX + RY * RY + RZ * RZ);
  }
  if (den <= 0) return;
  const q = fitRotation(a[0], a[1], a[2], new THREE.Quaternion());
  const r = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  new THREE.Matrix4().makeRotationFromQuaternion(q).extractBasis(r[0], r[1], r[2]);
  const s = (r[0].dot(a[0]) + r[1].dot(a[1]) + r[2].dot(a[2])) / den;
  const tg = new Float64Array(vs.length * 3), t = new THREE.Vector3();
  let low = Infinity;
  for (let n = 0; n < vs.length; n++) {
    const i = vs[n];
    t.set(X[i * 3] - C.x, X[i * 3 + 1] - C.y, X[i * 3 + 2] - C.z).applyQuaternion(q).multiplyScalar(s).add(c);
    tg[n * 3] = t.x; tg[n * 3 + 1] = t.y; tg[n * 3 + 2] = t.z;
    if (t.y < low) low = t.y;
  }
  const lift = Math.max(0, -low);
  for (let n = 0; n < vs.length; n++) {
    const o = vs[n] * 3;
    x[o] += amount * (tg[n * 3] - x[o]);
    x[o + 1] += amount * (tg[n * 3 + 1] + lift - x[o + 1]);
    x[o + 2] += amount * (tg[n * 3 + 2] - x[o + 2]);
    v[o] = u.x + (1 - amount) * (v[o] - u.x);
    v[o + 1] = u.y + (1 - amount) * (v[o + 1] - u.y);
    v[o + 2] = u.z + (1 - amount) * (v[o + 2] - u.z);
  }
  // (its centre and box, for the cuts that follow)
  const pc = sb.pieces[k], bb = pc.bbox;
  bb[0] = bb[1] = bb[2] = Infinity;
  bb[3] = bb[4] = bb[5] = -Infinity;
  let cx = 0, cy = 0, cz = 0;
  for (const i of vs) {
    const o = i * 3, w = m[i];
    cx += x[o] * w; cy += x[o + 1] * w; cz += x[o + 2] * w;
    for (let j = 0; j < 3; j++) {
      if (x[o + j] < bb[j]) bb[j] = x[o + j];
      if (x[o + j] > bb[j + 3]) bb[j + 3] = x[o + j];
    }
  }
  pc.com[0] = cx / M; pc.com[1] = cy / M; pc.com[2] = cz / M;
}

export class MalletTool {
  constructor(app) {
    this.app = app;
    this.id = 'mallet';
    this.cursor = 'pointer';
    this.background = true;
    this.model = makeMallet(app.M);
    this.model.visible = false;
    app.scene.add(this.model);
    this.anim = null;
    this.res = null; // resonance streak: { piece, topo, hits, last, T }
    this.tear = null; // a burst under way: { seams left, c, half }
    this.shards = null; // a shatter under way: { cracks, verts, p, d, n done }
  }

  // The jelly's beat (s): its natural wobble period - stiffer, lighter or
  // smaller jelly rings faster - times a whole number.
  beat() {
    const p = this.app.sb.p;
    const fn = (6.7 * Math.sqrt(p.mu / 170 / p.density)) / p.size;
    const Tn = 1 / fn;
    let T = Tn * Math.max(1, Math.round(0.5 / Tn));
    while (T < 0.34) T += Tn;
    while (T > 0.78 && T - Tn >= 0.34) T -= Tn;
    return T;
  }

  down(e, ray) {
    if (this.anim && this.anim.t < 0.2) return true;
    const tg = target(this.app, ray);
    if (!tg.jelly && !tg.floor) return false;
    const cam = this.app.camera;
    const d = tg.normal.clone().multiplyScalar(-0.62).addScaledVector(ray.direction, 0.38).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const toCam = cam.position.clone().sub(tg.point).normalize();
    let h = right.clone().multiplyScalar(0.55).addScaledVector(up, -0.35).addScaledVector(toCam, 0.75);
    h.addScaledVector(d, -h.dot(d)).normalize();
    const z = new THREE.Vector3().crossVectors(d, h.clone().negate()).normalize();
    const basis = new THREE.Matrix4().makeBasis(d, h.clone().negate(), z);
    const q0 = new THREE.Quaternion().setFromRotationMatrix(basis);
    const c0 = tg.point.clone().addScaledVector(d, -0.16);
    const pivot = c0.clone().addScaledVector(h, 0.83);
    // choose rotation sign so a positive angle lifts the head off the surface
    let axis = z.clone();
    const test = c0.clone().sub(pivot).applyAxisAngle(axis, 0.3).add(pivot);
    if (test.sub(c0).dot(d) > 0) axis.negate();
    this.anim = { t: 0, tg, d, q0, c0, pivot, axis, struck: false };
    this.model.visible = true;
    this._pose(1.2);
    return true;
  }

  _pose(ang) {
    const a = this.anim;
    const q = new THREE.Quaternion().setFromAxisAngle(a.axis, ang);
    this.model.position.copy(a.c0).sub(a.pivot).applyQuaternion(q).add(a.pivot);
    this.model.quaternion.copy(q).multiply(a.q0);
  }

  update(dt) {
    if (this.tear) this._tear();
    if (this.shards) this._crack();
    this._resonance();
    const a = this.anim;
    if (!a) return;
    if (a.press) {
      this._press(a, dt);
      return;
    }
    a.t += dt;
    const T1 = 0.1, T2 = 0.5;
    let ang;
    if (a.t < T1) {
      const u = a.t / T1;
      ang = 1.2 * (1 - u * u);
    } else {
      const u = Math.min(1, (a.t - T1) / (T2 - T1));
      ang = Math.sin(u * Math.PI * 0.5) * 0.9;
    }
    if (!a.struck && a.t >= T1) {
      a.struck = true;
      this.strike(a);
    }
    this._pose(ang);
    if (a.t > T2) {
      this.model.visible = false;
      this.anim = null;
    }
  }

  strike(a) {
    const app = this.app;
    const sb = app.sb;
    const p = a.tg.point, d = a.d;
    app.shake(0.035);
    if (a.tg.jelly) {
      if (avgTemp(sb, p, 0.3) < -0.4) {
        this.shatter(a);
        return;
      }
      const piece = a.tg.hit.piece;
      // on the beat? (the swing is in real time, like the hand that clicks)
      const now = app.clock.t, T = this.beat();
      const r = this.res;
      const live = r && r.piece === piece && r.topo === sb.topoVersion && now - r.last < 2.6 * T;
      let onBeat = false;
      if (live) {
        const gap = now - r.last;
        onBeat = Math.abs(gap - T) < 0.2 * T || Math.abs(gap - 2 * T) < 0.24 * T;
      }
      const hits = onBeat ? r.hits + 1 : 1;
      this.res = { piece, topo: sb.topoVersion, hits, last: now, T };
      const lv = (hits - 1) / (RES_HITS - 1); // 0 .. 1
      const size = sb.p.size;
      // where the surface is now (it may have wobbled since the click)
      const back = 0.4 * size;
      const rh = sb.raycast(p.x - d.x * back, p.y - d.y * back, p.z - d.z * back, d.x, d.y, d.z, back * 2);
      if (rh && rh.piece === piece) p.set(rh.point[0], rh.point[1], rh.point[2]);
      // the blow: the head drives a dent into the jelly, the deeper and
      // faster the more of the beat it has caught (see _press)
      sb.wake(piece);
      const pusher = { c: [p.x, p.y, p.z], d: [d.x, d.y, d.z], r: 0.105, len: 0.34, s0: 0, s1: 0 };
      sb.pushers.push(pusher);
      a.press = { pusher, piece, s: 0, D: (0.13 + 0.13 * lv) * size, V: 4.5 + 1.8 * lv, phase: 'in', hold: 0, lv, p: p.clone(), n: a.tg.normal.clone() };
      // resonance: it rings longer the more of the beat it has caught
      if (!app.healer.active) sb.dampBoost = hits > 1 ? Math.max(0.3, 1 - 0.7 * lv) : 1;
      app.shake(0.012 + 0.025 * lv);
      app.audio.thud(0.8 + 0.2 * lv);
      app.glowPulse?.(p.x, p.y, p.z, 0.9 + 0.5 * lv);
      if (hits > 1) app.audio.ring(RES_NOTES[Math.min(hits, RES_NOTES.length) - 1], lv);
      app.markDamaged();
      if (hits === 3) app.ui?.hint('Resonance building - keep the beat', 1400);
    } else {
      // whack the table: everything nearby hops
      const x = sb.x, v = sb.v;
      for (let i = 0; i < sb.nV; i++) {
        if (!sb.w[i] || x[i * 3 + 1] > 0.25) continue;
        const r = Math.hypot(x[i * 3] - p.x, x[i * 3 + 2] - p.z);
        if (r < 1.3) {
          v[i * 3 + 1] += 3.6 * (1 - r / 1.3);
          sb.wake(sb.vPiece[i]); // (a sleeping piece wouldn't move)
        }
      }
      app.audio.thud(0.7);
      app.particles.smoke(p, 3, 0.4, 0.75, 0.1, 0.2);
    }
  }

  // The head sinks into the jelly to the blow's depth, holds for a moment
  // (the world all but freezes), then lets go and the jelly springs back.
  _press(a, dt) {
    const pr = a.press, app = this.app, sb = app.sb;
    const P = pr.pusher;
    P.s0 = pr.s;
    if (pr.phase === 'in') {
      pr.s = Math.min(pr.D, pr.s + pr.V * dt);
      if (pr.s >= pr.D) {
        pr.phase = 'hold';
        pr.hold = 0.018;
        app.hitStop(0.05 + 0.05 * pr.lv);
        // the splash comes out from round the dent
        const flecks = 7 + Math.round(12 * pr.lv);
        for (let k = 0; k < flecks; k++) {
          const v = pr.n.clone().multiplyScalar(1.6 + Math.random() * (2 + 2.5 * pr.lv)).add(new THREE.Vector3((Math.random() - 0.5) * 3.2, 1.5 + Math.random() * (2 + 2.5 * pr.lv), (Math.random() - 0.5) * 3.2));
          app.droplets.spawn(pr.p.clone().addScaledVector(pr.n, 0.03), v, 0.008 + Math.random() * 0.014);
        }
      }
    } else if ((pr.hold -= dt) <= 0) {
      const i = sb.pushers.indexOf(P);
      if (i >= 0) sb.pushers.splice(i, 1);
      a.press = null;
      if (this.res && this.res.hits >= RES_HITS && this.res.piece === pr.piece) this.burst(pr.piece, pr.p);
      return;
    }
    P.s1 = pr.s;
    this._pose(0);
    this.model.position.addScaledVector(a.d, pr.s);
  }

  // While a streak is alive the jelly glows as its next beat comes due
  // (brighter the further along it is); the streak and the extra ringing
  // fade once the beat is lost.
  _resonance() {
    const r = this.res;
    if (!r) return;
    const app = this.app, sb = app.sb;
    const now = app.clock.t;
    if (r.topo !== sb.topoVersion || now - r.last > 2.6 * r.T || !sb.pieces[r.piece]) {
      this.res = null;
      if (!app.healer.active) sb.dampBoost = 1;
      return;
    }
    const lv = (r.hits - 1) / (RES_HITS - 1);
    const u = (now - r.last) / r.T;
    // a soft swell peaking on the beat (and on the one after)
    const w = 0.13;
    const g = Math.max(Math.exp(-((u - 1) * (u - 1)) / (2 * w * w)), 0.6 * Math.exp(-((u - 2) * (u - 2)) / (2 * w * w)));
    const level = g * (0.1 + 0.32 * lv);
    if (level < 0.01) return;
    const vs = sb.pieces[r.piece].verts, G = sb.glow;
    for (let k = 0; k < vs.length; k++) if (G[vs[k]] < level) G[vs[k]] = level;
  }

  // Six on the beat: the jelly shakes itself apart into wet chunks - torn
  // along a few curved and flat seams through it, then flung outwards. The
  // tearing is spread over the first frames of the hit-stop (one seam a
  // frame, while the world all but stands still) and the fling comes the
  // frame after, so no single frame has to do it all.
  burst(piece, p) {
    const app = this.app;
    const sb = app.sb;
    const pc = sb.pieces[piece];
    if (!pc) return;
    this.res = null;
    if (!app.healer.active) sb.dampBoost = 1;
    // (no self-contact while it tears, nor while the chunks fly: see radialImpulse)
    sb.selfQuietUntil = sb.time + 0.5;
    // the dent's spring goes into the burst: the jelly pops most of the way
    // back into shape as it tears (left squashed, the chunks would start out
    // inside each other and spend their first moments shoving apart)
    springBack(sb, piece, 0.85);
    const [cx, cy, cz] = pc.com;
    const bb = pc.bbox.slice();
    const half = 0.5 * Math.max(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]);
    const inBox = (x, y, z) => x > bb[0] - 0.03 && x < bb[3] + 0.03 && y > bb[1] - 0.03 && y < bb[4] + 0.03 && z > bb[2] - 0.03 && z < bb[5] + 0.03;
    const rndDir = () => {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      return new THREE.Vector3(r * Math.cos(th), u, r * Math.sin(th));
    };
    // a curved seam (a big sphere whose rim runs through it)...
    const seams = [];
    {
      const dir = rndDir(), R = half * (1.1 + Math.random() * 0.5);
      const c = new THREE.Vector3(cx, cy, cz).addScaledVector(dir, R + half * (Math.random() - 0.5) * 0.5);
      const f = sphereField(c.x, c.y, c.z, R);
      f.inRegion = inBox;
      seams.push(f);
    }
    // ...and two flat ones near the middle
    for (let k = 0; k < 2; k++) {
      const n = rndDir();
      const q = new THREE.Vector3(cx, cy, cz).addScaledVector(rndDir(), half * 0.25 * Math.random());
      seams.push(planeField(n.x, n.y, n.z, n.dot(q), inBox));
    }
    this.tear = { seams, c: new THREE.Vector3(cx, cy, cz), half };
    const c = this.tear.c;
    for (let k = 0; k < 36; k++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize();
      const v = dir.clone().multiplyScalar(3 + Math.random() * 4);
      v.y += 1.5;
      app.droplets.spawn(c.clone().addScaledVector(dir, half * 0.9), v, 0.01 + Math.random() * 0.02);
    }
    app.shake(0.05);
    app.hitStop(0.12);
    app.audio.splat(1);
    app.audio.resonate();
    app.ui?.hint('Resonance!', 1600);
    app.markDamaged();
    this._tear();
  }

  // One step of a burst: the next seam, then the crumbs, then the fling.
  _tear() {
    const T = this.tear, app = this.app, sb = app.sb;
    if (app.healer.active) {
      this.tear = null;
      return;
    }
    const anchors = app.allAnchors();
    if (T.seams.length) {
      cutBody(sb, T.seams.shift(), { separate: 0.015, anchors });
      if (!T.seams.length) {
        // what's too small to be a chunk flies off as drops
        const crumbs = removeSmallPieces(sb, 0.004 * sb.p.size ** 3, anchors);
        for (let k = 0; k < crumbs.length; k += 4) {
          const q = new THREE.Vector3(crumbs[k], crumbs[k + 1], crumbs[k + 2]);
          const v = q.clone().sub(T.c).normalize().multiplyScalar(2.5 + Math.random() * 2.5);
          v.y += 2.5;
          app.droplets.spawn(q, v, 0.014 + Math.cbrt(crumbs[k + 3]) * 0.3);
        }
      }
      app.onTopologyChanged();
      return;
    }
    sb.radialImpulse(T.c.x, T.c.y, T.c.z, 2.2 * T.half + 0.4, 5.5, 2.2, 0.5);
    this.tear = null;
  }

  // Frozen jelly breaks like ice: cracks run out from the blow - a star of
  // radial ones round its line at uneven angles, each a little tilted; a
  // shallow, shell-curved crater of crushed shards round the hit; often a
  // wider shell further out, now and then a long split through the lot.
  // Every break is clean (flat, or curved like a shell) and only the frozen
  // part breaks. They open one a frame through the hit-stop, so they're seen
  // to run, then the shards fly. (It used to break along the mesh's own
  // tets round nine random points - the same jagged staircase every time.)
  shatter(a) {
    const app = this.app;
    const sb = app.sb;
    const p = a.tg.point.clone();
    const piece = a.tg.hit.piece;
    const pc = sb.pieces[piece];
    if (!pc) return;
    const d = a.d.clone().normalize();
    // a frame round the blow
    const u = new THREE.Vector3().crossVectors(d, Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    const v = new THREE.Vector3().crossVectors(d, u);
    const bb = pc.bbox.slice();
    const size = Math.max(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]);
    // where it's frozen: a coarse grid of the piece's mean temperature
    const cs = Math.max(0.05, size / 14), gx = Math.ceil((bb[3] - bb[0]) / cs) + 1, gy = Math.ceil((bb[4] - bb[1]) / cs) + 1, gz = Math.ceil((bb[5] - bb[2]) / cs) + 1;
    const tSum = new Float32Array(gx * gy * gz), tN = new Uint16Array(gx * gy * gz);
    let all = 0;
    const cell = (x, y, z) => {
      const i = Math.floor((x - bb[0]) / cs), j = Math.floor((y - bb[1]) / cs), k = Math.floor((z - bb[2]) / cs);
      return i < 0 || j < 0 || k < 0 || i >= gx || j >= gy || k >= gz ? -1 : (k * gy + j) * gx + i;
    };
    for (const i of pc.verts) {
      const c = cell(sb.x[i * 3], sb.x[i * 3 + 1], sb.x[i * 3 + 2]);
      if (c < 0) continue;
      tSum[c] += sb.temp[i];
      tN[c]++;
      all += sb.temp[i];
    }
    const allCold = all / Math.max(1, pc.verts.length) < -0.4;
    const m = 0.04;
    const ice = (x, y, z) => {
      if (x < bb[0] - m || x > bb[3] + m || y < bb[1] - m || y > bb[4] + m || z < bb[2] - m || z > bb[5] + m) return false;
      const c = cell(x, y, z);
      return c >= 0 && tN[c] ? tSum[c] / tN[c] < -0.25 : allCold;
    };
    const R = (lo, hi) => lo + Math.random() * (hi - lo);
    const cracks = [];
    // radial: a star of 2-3 breaks through the hit along the blow, at uneven
    // angles and each tilted a little off it (4-6 wedges)
    const N = Math.random() < 0.5 ? 2 : 3;
    const a0 = Math.random() * Math.PI;
    for (let k = 0; k < N; k++) {
      const th = a0 + (k + R(-0.28, 0.28)) * (Math.PI / N);
      const n = u.clone().multiplyScalar(Math.cos(th)).addScaledVector(v, Math.sin(th)).addScaledVector(d, R(-0.3, 0.3)).normalize();
      cracks.push(planeField(n.x, n.y, n.z, n.dot(p) + R(-0.02, 0.02) * size, ice));
    }
    // the crater: a shallow shell-shaped cap round the hit, its middle a
    // little off the hit (crushed into small shards by the star)
    {
      const r = R(0.3, 0.48) * size, dep = R(0.13, 0.22) * size;
      const c = p.clone().addScaledVector(d, dep - r).addScaledVector(u, R(-0.05, 0.05) * size).addScaledVector(v, R(-0.05, 0.05) * size);
      const f = sphereField(c.x, c.y, c.z, r);
      f.inRegion = ice;
      cracks.push(f);
    }
    // often a second, wider shell: the wedges break across further out
    if (Math.random() < 0.7) {
      const r = R(0.5, 0.75) * size;
      const c = p.clone().addScaledVector(d, R(0.05, 0.2) * size - r * 0.35).addScaledVector(u, R(-0.1, 0.1) * size).addScaledVector(v, R(-0.1, 0.1) * size);
      const f = sphereField(c.x, c.y, c.z, r);
      f.inRegion = ice;
      cracks.push(f);
    }
    // now and then a long split right through, off to one side of the hit
    if (Math.random() < 0.4) {
      const th = Math.random() * Math.PI * 2;
      const n = u.clone().multiplyScalar(Math.cos(th)).addScaledVector(v, Math.sin(th)).addScaledVector(d, R(-0.25, 0.25)).normalize();
      cracks.push(planeField(n.x, n.y, n.z, n.dot(p) + R(0.15, 0.32) * size * (Math.random() < 0.5 ? -1 : 1), ice));
    }
    // (the shards are the pieces holding the frozen piece's vertices; the
    // star breaks the first frame, the rest the next)
    this.shards = { cracks, batches: [N, cracks.length], verts: pc.verts.slice(), p, d, n: 0 };
    sb.selfQuietUntil = sb.time + 0.5;
    app.hitStop(0.1);
    app.audio.crack(1);
    app.audio.thud(0.6);
    for (let k = 0; k < 40; k++) app.particles.glitter(p, 1, [0.85, 0.95, 1.0], 1.4);
    app.particles.mist(p, new THREE.Vector3(0, 0.6, 0), 8);
    app.markDamaged();
    this._crack();
  }

  // One step of a shatter: the next batch of cracks (one rebuild for the
  // lot - see rebuildLight), and after the last the chips and the fling.
  _crack() {
    const S = this.shards, app = this.app, sb = app.sb;
    if (app.healer.active) {
      this.shards = null;
      return;
    }
    if (S.batches.length) {
      const end = S.batches.shift(), anchors = app.allAnchors();
      for (; S.n < end; S.n++) {
        const pieces = [];
        for (const i of S.verts) {
          const k = sb.vPiece[i];
          if (k >= 0 && !pieces.includes(k)) pieces.push(k);
        }
        cutBody(sb, S.cracks[S.n], { separate: 0.02, anchors, pieces, light: S.n < end - 1 });
      }
      // (a light rebuild left last: the next cut found nothing to break)
      if (sb.topoStale) sb.rebuild();
      app.onTopologyChanged();
      if (!S.batches.length) app.audio.crack(0.45);
      return;
    }
    this.shards = null;
    const p = S.p, d = S.d;
    // wafer-thin crumbs become little ice chips instead of slivers
    const crumbs = removeSmallPieces(sb, 0.006 * sb.p.size ** 3, app.allAnchors());
    for (let k = 0; k < crumbs.length; k += 4) {
      const c = new THREE.Vector3(crumbs[k], crumbs[k + 1], crumbs[k + 2]);
      const v = c.clone().sub(p).normalize().multiplyScalar(2 + Math.random() * 2);
      v.y += 2;
      app.droplets.spawn(c, v, 0.012 + Math.cbrt(crumbs[k + 3]) * 0.35, '#dcefff');
    }
    if (crumbs.length) app.onTopologyChanged();
    sb.radialImpulse(p.x, p.y, p.z, 1.4, 3.2, 1.5);
    sb.impulse(p.x, p.y, p.z, d.x, d.y, d.z, 0.6, 3.0);
  }
}

// ------------------------------------------------------------------ torch & cryo
class NozzleTool {
  constructor(app, id, model) {
    this.tg = null;
    this.app = app;
    this.id = id;
    this.cursor = 'none';
    this.model = model;
    this.model.visible = false;
    app.scene.add(this.model);
    this.on = false;
    this.hovering = false;
    this.ray = new THREE.Ray();
    this.tip = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.smoothTip = null;
  }

  activate() {
    this.hovering = false;
  }

  deactivate() {
    this.model.visible = false;
    this.up();
  }

  hover(e, ray) {
    if (!ray) {
      this.hovering = false;
      return;
    }
    this.hovering = true;
    this.ray.copy(ray);
  }

  down(e, ray) {
    this.on = true;
    this.hovering = true;
    this.ray.copy(ray);
    this.start();
    return true;
  }

  move(e, ray) {
    this.ray.copy(ray);
  }

  up() {
    if (this.on) this.stop();
    this.on = false;
    if (this.app.isTouch) this.hovering = false;
  }

  update(dt) {
    if (!this.on && !this.hovering) {
      this.model.visible = false;
      return;
    }
    const app = this.app;
    const tg = target(app, this.ray);
    const back = sideApproach(app, tg.normal, _a);
    const dir = this.dir.copy(back).negate();
    const stand = this.standoff;
    const tip = this.tip.copy(tg.point).addScaledVector(back, stand);
    if (!this.smoothTip) this.smoothTip = tip.clone();
    this.smoothTip.lerp(tip, 1 - Math.exp(-dt * 30));
    orient(this.model, this.smoothTip, dir.clone().negate());
    this.model.visible = true;
    this.tg = tg;
    if (this.on) this.emit(dt, tg, this.smoothTip, dir);
  }
}

export class TorchTool extends NozzleTool {
  constructor(app) {
    super(app, 'torch', makeTorch(app.M));
    this.standoff = 0.3;
    this.sizzle = 0;
  }

  start() {
    this.app.audio.loop('torch', true, { type: 'bandpass', freq: 520, q: 0.6, gain: 0.32, lfo: 13, flicker: 0.35 });
  }

  stop() {
    this.app.audio.loop('torch', false);
  }

  emit(dt, tg, tip, dir) {
    const app = this.app;
    app.particles.flame(tip, dir, 1);
    app.particles.flame(tip, dir, 1);
    app.fireAt(tip.clone().addScaledVector(dir, 0.12), 1.0);
    if (tg.jelly) {
      const sb = app.sb;
      sb.addHeat(tg.point.x, tg.point.y, tg.point.z, 0.3, 2.1 * dt, 1.6, -1.3);
      // very hot jelly slumps, then turns to liquid and runs off (see Fluid),
      // from the surface in: its tets go - a batch every 0.15 s, one rebuild
      // each - and their volume flows on as molten jelly, in its colour
      const T = sb.T, x = sb.x, temp = sb.temp;
      const melt = (this.melt ||= new Set());
      for (let t = 0; t < sb.nT; t++) {
        if (sb.vol0[t] <= 0) continue;
        const a = T[t * 4], b = T[t * 4 + 1], c = T[t * 4 + 2], d = T[t * 4 + 3];
        const tt = (temp[a] + temp[b] + temp[c] + temp[d]) * 0.25;
        if (tt < 1.05) continue;
        const dd = Math.hypot(x[a * 3] - tg.point.x, x[a * 3 + 1] - tg.point.y, x[a * 3 + 2] - tg.point.z);
        if (dd >= 0.32) continue;
        // (slumping no further than it melts: deeper, it puckers the surface into a star)
        sb.tVS[t] = Math.max(0.62, sb.tVS[t] - 0.42 * dt);
        // (it melts from the surface in: only what's bare runs off)
        if (sb.tVS[t] <= 0.7 && sb.tetBoundary[t] >= 0) melt.add(t);
      }
      this.meltClock = (this.meltClock || 0) + dt;
      if (melt.size && this.meltClock > 0.15) {
        this.meltClock = 0;
        this._liquefy(melt);
        melt.clear();
      }
      this.sizzle += dt;
      if (this.sizzle > 0.07) {
        this.sizzle = 0;
        app.audio.sizzle(0.7);
        const t = avgTemp(app.sb, tg.point, 0.2);
        if (t > 0.45) app.particles.smoke(tg.point.clone().addScaledVector(tg.normal, 0.03), 1, 0.12, 0.92, 0.7, 0.16);
        // molten jelly drips from the lowest hot spot
        if (t > 0.65 && Math.random() < 0.35) {
          const sb = app.sb;
          let best = -1, by = Infinity;
          for (let k = 0; k < sb.nF * 3; k += 7) {
            const i = sb.sTri[k];
            if (sb.temp[i] < 0.7) continue;
            const y = sb.x[i * 3 + 1];
            if (y < by && y > 0.05) {
              by = y;
              best = i;
            }
          }
          if (best >= 0) {
            const q = new THREE.Vector3(sb.x[best * 3], sb.x[best * 3 + 1] - 0.03, sb.x[best * 3 + 2]);
            app.droplets.spawn(q, new THREE.Vector3((Math.random() - 0.5) * 0.3, -0.4, (Math.random() - 0.5) * 0.3), 0.012 + Math.random() * 0.014);
          }
        }
      }
      app.markDamaged();
    }
  }
}

// The corners a melt leaves bare (in the tets going and the ones staying),
// eased toward the average of their bare neighbours - rest and current
// shape alike - twice, unless a tet round one would turn inside out or
// flatten: the hole's rim rounds off rather than standing in shards.
function smoothMelted(sb, gone) {
  const T = sb.T, X = sb.X, x = sb.x, px = sb.px;
  const rim = new Set(), keep = new Map();
  for (let t = 0; t < sb.nT; t++) {
    if (gone.has(t) || sb.vol0[t] <= 0) continue;
    for (let k = 0; k < 4; k++) {
      const i = T[t * 4 + k];
      if (!sb.melt[i]) continue;
      rim.add(i);
      if (!keep.has(i)) keep.set(i, []);
      keep.get(i).push(t);
    }
  }
  const vol = (t) => {
    const a = T[t * 4] * 3, b = T[t * 4 + 1] * 3, c = T[t * 4 + 2] * 3, d = T[t * 4 + 3] * 3;
    const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2];
    const vx = X[c] - X[a], vy = X[c + 1] - X[a + 1], vz = X[c + 2] - X[a + 2];
    const wx = X[d] - X[a], wy = X[d + 1] - X[a + 1], wz = X[d + 2] - X[a + 2];
    return ux * (vy * wz - vz * wy) - uy * (vx * wz - vz * wx) + uz * (vx * wy - vy * wx);
  };
  for (let pass = 0; pass < 2; pass++) {
    const moves = [];
    for (const i of rim) {
      const seen = new Set();
      let ax = 0, ay = 0, az = 0, m = 0;
      for (const t of keep.get(i))
        for (let k = 0; k < 4; k++) {
          const j = T[t * 4 + k];
          if (j === i || !rim.has(j) || seen.has(j)) continue;
          seen.add(j);
          ax += X[j * 3]; ay += X[j * 3 + 1]; az += X[j * 3 + 2];
          m++;
        }
      if (m < 2) continue;
      moves.push(i, (ax / m - X[i * 3]) * 0.4, (ay / m - X[i * 3 + 1]) * 0.4, (az / m - X[i * 3 + 2]) * 0.4);
    }
    for (let q = 0; q < moves.length; q += 4) {
      const i = moves[q], o = i * 3, ts = keep.get(i);
      const before = ts.map(vol);
      for (let c = 0; c < 3; c++) X[o + c] += moves[q + 1 + c];
      if (ts.some((t, n) => !(vol(t) > before[n] * 0.35))) {
        for (let c = 0; c < 3; c++) X[o + c] -= moves[q + 1 + c];
        continue;
      }
      for (let c = 0; c < 3; c++) {
        x[o + c] += moves[q + 1 + c];
        px[o + c] += moves[q + 1 + c];
      }
    }
  }
}

// (TorchTool) these tets to molten jelly: their volume (rest, times how
// swollen) into the liquid at their middles, moving as they were, coloured
// by their rest height; then they go.
TorchTool.prototype._liquefy = function (set) {
  const app = this.app, sb = app.sb, T = sb.T, x = sb.x, X = sb.X, v = sb.v;
  const col = new THREE.Color();
  // (a spike left standing - a hot tet with three of its faces bare, or
  // two where it's hottest - goes with them, twice over: the crater melts
  // round, not to shards)
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  const cen = (t, out) => {
    out[0] = out[1] = out[2] = 0;
    for (let k = 0; k < 4; k++) for (let c = 0; c < 3; c++) out[c] += x[T[t * 4 + k] * 3 + c] / 4;
    return out;
  };
  const c3 = [0, 0, 0];
  for (const t of set) {
    cen(t, c3);
    x0 = Math.min(x0, c3[0]); y0 = Math.min(y0, c3[1]); z0 = Math.min(z0, c3[2]);
    x1 = Math.max(x1, c3[0]); y1 = Math.max(y1, c3[1]); z1 = Math.max(z1, c3[2]);
  }
  const inner = [], faces = new Map(), nV = sb.nV;
  const key = (a, b, c) => {
    const lo = Math.min(a, b, c), hi = Math.max(a, b, c), mid = a + b + c - lo - hi;
    return (lo * nV + mid) * nV + hi;
  };
  const FACE = [[1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2]];
  for (let t = 0; t < sb.nT; t++) {
    if (sb.vol0[t] <= 0) continue;
    cen(t, c3);
    if (c3[0] < x0 - 0.2 || c3[0] > x1 + 0.2 || c3[1] < y0 - 0.2 || c3[1] > y1 + 0.2 || c3[2] < z0 - 0.2 || c3[2] > z1 + 0.2) continue;
    for (const f of FACE) {
      const k = key(T[t * 4 + f[0]], T[t * 4 + f[1]], T[t * 4 + f[2]]);
      const l = faces.get(k);
      if (l) l.push(t);
      else faces.set(k, [t]);
    }
    if (set.has(t) || c3[0] < x0 - 0.08 || c3[0] > x1 + 0.08 || c3[1] < y0 - 0.08 || c3[1] > y1 + 0.08 || c3[2] < z0 - 0.08 || c3[2] > z1 + 0.08) continue;
    const tt = (sb.temp[T[t * 4]] + sb.temp[T[t * 4 + 1]] + sb.temp[T[t * 4 + 2]] + sb.temp[T[t * 4 + 3]]) * 0.25;
    if (tt > 0.8) inner.push(t, tt > 0.95 ? 2 : 3);
  }
  for (let pass = 0; pass < 2; pass++) {
    const add = [];
    for (let n = 0; n < inner.length; n += 2) {
      const t = inner[n];
      if (set.has(t)) continue;
      let bare = 0;
      for (const f of FACE) {
        const l = faces.get(key(T[t * 4 + f[0]], T[t * 4 + f[1]], T[t * 4 + f[2]]));
        if (!l.some((u) => u !== t && !set.has(u))) bare++;
      }
      // (a fin - two bare faces - too, where it's hottest: edges melt first)
      if (bare >= inner[n + 1]) add.push(t);
    }
    if (!add.length) break;
    for (const t of add) set.add(t);
  }
  for (const t of set) {
    if (t >= sb.nT) continue;
    let cx = 0, cy = 0, cz = 0, ry = 0, vx = 0, vy = 0, vz = 0;
    for (let k = 0; k < 4; k++) {
      const i = T[t * 4 + k] * 3;
      cx += x[i] / 4; cy += x[i + 1] / 4; cz += x[i + 2] / 4;
      ry += X[i + 1] / 4;
      vx += v[i] / 4; vy += v[i + 1] / 4; vz += v[i + 2] / 4;
    }
    col.set(app.flavorColorAtRestY(ry));
    // (as much liquid as the space it leaves: slumped, it's shrunk)
    const vol = sb.vol0[t] * Math.min(1, sb.tVS[t]);
    app.fluid.add(cx, cy, cz, vol, vx, vy - 0.3, vz, col.r, col.g, col.b, Math.cbrt(sb.vol0[t]) * 1.5);
  }
  // (what's left round the hole is a melted surface - see TAG_MELT - and
  // it slumps smooth: each of its corners eased toward its neighbours on it)
  for (const t of set) for (let k = 0; k < 4; k++) sb.melt[T[t * 4 + k]] = 1;
  smoothMelted(sb, set);
  removeTets(sb, (t) => set.has(t), app.allAnchors());
  app.onTopologyChanged();
};

export class FreezeTool extends NozzleTool {
  constructor(app) {
    super(app, 'freeze', makeSpray(app.M));
    this.standoff = 0.34;
    this.crackle = 0;
  }

  start() {
    this.app.audio.loop('freeze', true, { type: 'highpass', freq: 3800, q: 0.5, gain: 0.22, lfo: 23, flicker: 0.12 });
  }

  stop() {
    this.app.audio.loop('freeze', false);
  }

  emit(dt, tg, tip, dir) {
    const app = this.app;
    app.particles.mist(tip, dir, 3);
    // molten jelly where it's aimed cools - cold enough, it sets (see Fluid)
    if (app.fluid.n && app.fluid.cool(tg.point.x, tg.point.y, tg.point.z, 0.45, 2.4 * dt)) {
      this.crackle += dt;
      if (this.crackle > 0.05) {
        this.crackle = 0;
        app.audio.frostCrackle(0.6);
      }
    }
    if (tg.jelly) {
      app.sb.addHeat(tg.point.x, tg.point.y, tg.point.z, 0.3, -1.5 * dt, 1.5, -1.3);
      this.crackle += dt;
      if (this.crackle > 0.05) {
        this.crackle = 0;
        app.audio.frostCrackle(0.8);
      }
      app.markDamaged();
    }
  }
}

// ------------------------------------------------------------------ melon baller
export class BallerTool {
  constructor(app) {
    this.app = app;
    this.id = 'baller';
    this.cursor = 'pointer';
    this.background = true;
    this.model = makeBaller(app.M);
    this.model.visible = false;
    app.scene.add(this.model);
    this.anim = null;
  }

  down(e, ray, hit) {
    if (!hit) return false;
    if (this.anim) return true;
    const r = 0.21;
    const n = V(hit.normal);
    const p = V(hit.point);
    const c = p.clone().addScaledVector(n, -r * 0.62);
    this.anim = { t: 0, p, n, c, r, cut: false, ball: -1 };
    this.model.visible = true;
    return true;
  }

  update(dt) {
    const a = this.anim;
    if (!a) return;
    const app = this.app;
    const sb = app.sb;
    a.t += dt;
    const T1 = 0.14, T2 = 0.5;
    let pos;
    if (a.t < T1) {
      const u = a.t / T1;
      pos = a.c.clone().addScaledVector(a.n, 0.45 * (1 - u * u));
    } else {
      if (!a.cut) {
        a.cut = true;
        this.scoop(a);
      }
      // follow the ball out
      const pc = a.ball >= 0 ? sb.pieces[a.ball] : null;
      const u = Math.min(1, (a.t - T1) / (T2 - T1));
      pos = pc && u < 0.6 ? V(pc.com) : a.c.clone().addScaledVector(a.n, 0.45 * u);
    }
    orient(this.model, pos, a.n);
    if (a.t > T2) {
      this.model.visible = false;
      this.anim = null;
    }
  }

  scoop(a) {
    const app = this.app;
    const sb = app.sb;
    if (sb.nT > 30000) {
      app.ui?.hint('That is a lot of jelly bits — hit Heal first');
      return;
    }
    const res = cutBody(sb, sphereField(a.c.x, a.c.y, a.c.z, a.r), { separate: 0, snap: 0.38, anchors: app.allAnchors() });
    if (!res.changed) return;
    app.onTopologyChanged();
    // the ball is the piece whose centre of mass sits inside the sphere
    let best = -1, bd = Infinity;
    for (const pc of sb.pieces) {
      let cx = 0, cy = 0, cz = 0, m = 0;
      for (const i of pc.verts) {
        cx += sb.x[i * 3] * sb.m[i]; cy += sb.x[i * 3 + 1] * sb.m[i]; cz += sb.x[i * 3 + 2] * sb.m[i];
        m += sb.m[i];
      }
      const d = Math.hypot(cx / m - a.c.x, cy / m - a.c.y, cz / m - a.c.z);
      if (d < a.r && pc.volume < 0.06 && d < bd) {
        bd = d;
        best = pc.id;
      }
    }
    if (best >= 0) {
      a.ball = best;
      const pc = sb.pieces[best];
      const v = a.n.clone().multiplyScalar(2.3);
      v.y += 2.4;
      for (const i of pc.verts) {
        sb.v[i * 3] += v.x;
        sb.v[i * 3 + 1] += v.y;
        sb.v[i * 3 + 2] += v.z;
      }
    }
    app.audio.schlorp(1);
    app.markDamaged();
  }
}

// ------------------------------------------------------------------ cherry bomb
export class BombTool {
  constructor(app) {
    this.app = app;
    this.id = 'bomb';
    this.cursor = 'pointer';
    this.background = true;
    this.bombs = [];
    app.anchorProviders.push(() => {
      const out = [];
      for (const b of this.bombs) if (b.a1) out.push(b.a1, b.a2);
      return out;
    });
    app.onHealStart.push(() => {
      for (const b of this.bombs) this._defuse(b);
      this.bombs.length = 0;
      this.app.audio.loop('fuse', false);
    });
  }

  down(e, ray) {
    const app = this.app;
    const tg = target(app, ray);
    if (!tg.jelly && !tg.floor) return false;
    if (this.bombs.length >= 6) return true;
    const model = makeBomb(app.M);
    app.scene.add(model);
    const b = { model, fuse: 1.9, n: tg.normal.clone(), pos: tg.point.clone(), a1: null, a2: null };
    if (tg.jelly) {
      const sb = app.sb;
      b.a1 = anchorAt(sb, tg.point.clone().addScaledVector(b.n, -0.03), tg.hit.piece);
      b.a2 = anchorAt(sb, tg.point.clone().addScaledVector(b.n, -0.13), tg.hit.piece);
      if (!b.a1 || !b.a2) b.a1 = b.a2 = null;
    }
    if (!b.a1) b.pos.y = Math.max(b.pos.y, 0.075);
    this.bombs.push(b);
    this._pose(b);
    app.audio.loop('fuse', true, { type: 'highpass', freq: 5000, q: 0.7, gain: 0.12, lfo: 31, flicker: 0.9 });
    app.audio.pop(0.3);
    return true;
  }

  _pose(b) {
    const sb = this.app.sb;
    if (b.a1 && anchorOk(sb, b.a1) && anchorOk(sb, b.a2)) {
      const p1 = sb.embedPoint(b.a1.tet, b.a1.b, _p);
      const p2 = sb.embedPoint(b.a2.tet, b.a2.b, _p2);
      b.n.set(p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]).normalize();
      b.pos.set(p1[0], p1[1], p1[2]).addScaledVector(b.n, 0.03 + 0.04);
    } else if (b.a1) {
      b.a1 = b.a2 = null;
    }
    orient(b.model, b.pos, b.n);
  }

  update(dt) {
    const app = this.app;
    for (let k = this.bombs.length - 1; k >= 0; k--) {
      const b = this.bombs[k];
      b.fuse -= dt;
      this._pose(b);
      const tip = b.model.userData.fuseTip.clone().multiplyScalar(Math.max(0.2, b.fuse / 1.9));
      tip.applyQuaternion(b.model.quaternion).add(b.model.position);
      app.particles.sparks(tip, 2, 1.2, [1, 0.7, 0.3]);
      if (b.fuse <= 0) {
        this.bombs.splice(k, 1);
        this.explode(b);
      }
    }
    if (!this.bombs.length) app.audio.loop('fuse', false);
  }

  _defuse(b) {
    this.app.scene.remove(b.model);
  }

  explode(b) {
    const app = this.app;
    const sb = app.sb;
    const p = b.pos.clone();
    app.scene.remove(b.model);
    app.particles.flash(p, 1.6);
    app.particles.flash(p, 0.6, [20, 16, 10]);
    app.particles.sparks(p, 50, 5);
    app.particles.smoke(p, 18, 0.9, 0.22, 0.6, 0.5);
    app.audio.boom(1);
    app.glowPulse?.(p.x, p.y, p.z, 1.5);
    app.shake(0.05);
    app.flash = 0.6;
    app.fireAt(p.clone().add(new THREE.Vector3(0, 0.15, 0)), 9);
    const anchors = app.allAnchors();
    // smooth spherical crater; the blasted-out jelly becomes flying blobs
    const R = 0.24;
    const res = cutBody(sb, sphereField(p.x, p.y, p.z, R), { separate: 0, snap: 0.4, anchors });
    if (res.changed) {
      const inside = new Set();
      for (const pc of sb.pieces) {
        let cx = 0, cy = 0, cz = 0, m = 0;
        for (const i of pc.verts) {
          cx += sb.x[i * 3] * sb.m[i]; cy += sb.x[i * 3 + 1] * sb.m[i]; cz += sb.x[i * 3 + 2] * sb.m[i];
          m += sb.m[i];
        }
        if (Math.hypot(cx / m - p.x, cy / m - p.y, cz / m - p.z) < R && pc.volume < 0.08) inside.add(pc.id);
      }
      let vol = 0;
      const removed = removeTets(sb, (t) => {
        if (!inside.has(sb.tPiece[t])) return false;
        vol += sb.vol0[t];
        return true;
      }, anchors);
      // blobs: total volume roughly matches what was blasted out
      let left = vol;
      let k = 0;
      while (left > 0 && k < 40) {
        const r = 0.02 + Math.random() * 0.035;
        left -= (4 / 3) * Math.PI * r * r * r;
        const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.1, Math.random() - 0.5).normalize();
        const c = p.clone().addScaledVector(dir, Math.random() * R * 0.6);
        const v = dir.multiplyScalar(3.5 + Math.random() * 5.5);
        v.y += 1.5 + Math.random() * 3;
        app.droplets.spawn(c, v, r);
        k++;
      }
      void removed;
    }
    app.onTopologyChanged();
    sb.radialImpulse(p.x, p.y, p.z, 1.7, 10, 2.5);
    app.markDamaged();
  }
}

// ------------------------------------------------------------------ syringe
export class SyringeTool {
  constructor(app) {
    this.app = app;
    this.id = 'syringe';
    this.cursor = 'pointer';
    this.model = makeSyringe(app.M);
    this.model.visible = false;
    app.scene.add(this.model);
    this.s = null;
    app.anchorProviders.push(() => (this.s ? [this.s.a1, this.s.a2] : []));
  }

  deactivate() {
    this.up();
  }

  down(e, ray, hit) {
    if (!hit) return false;
    const sb = this.app.sb;
    const n = sideApproach(this.app, V(hit.normal)).lerp(V(hit.normal), 0.35).normalize();
    const p = V(hit.point);
    const a1 = anchorAt(sb, p.clone().addScaledVector(n, -0.16), hit.piece);
    const a2 = anchorAt(sb, p.clone().addScaledVector(n, -0.02), hit.piece);
    if (!a1 || !a2) return false;
    this.s = { a1, a2, t: 0, pump: 0 };
    this.model.visible = true;
    this.app.audio.poke(0.4);
    this._pose();
    return true;
  }

  up() {
    if (!this.s) return;
    this.s = null;
    this.model.visible = false;
    this.app.audio.pop(0.3);
  }

  _pose() {
    const sb = this.app.sb;
    const s = this.s;
    if (!anchorOk(sb, s.a1) || !anchorOk(sb, s.a2)) {
      this.up();
      return false;
    }
    const tip = sb.embedPoint(s.a1.tet, s.a1.b, _p);
    const sp = sb.embedPoint(s.a2.tet, s.a2.b, _p2);
    const axis = _b.set(sp[0] - tip[0], sp[1] - tip[1], sp[2] - tip[2]).normalize();
    orient(this.model, _a.set(tip[0], tip[1], tip[2]).addScaledVector(axis, -0.02), axis);
    s.tip = new THREE.Vector3(tip[0], tip[1], tip[2]);
    return true;
  }

  update(dt) {
    const s = this.s;
    if (!s) return;
    if (!this._pose()) return;
    const app = this.app;
    const sb = app.sb;
    s.t += dt;
    const plunger = this.model.userData.plunger;
    const u = Math.min(1, s.t / 2.6);
    plunger.position.y = 0.3 - 0.24 * u;
    this.model.userData.fluid.scale.y = Math.max(0.05, 1 - u);
    this.model.userData.fluid.position.y = 0.41 - 0.15 * u;
    // inflate tets around the needle tip (smooth falloff -> round bulge)
    const R = 0.4;
    let maxVS = 1;
    const T = sb.T, x = sb.x;
    for (let t = 0; t < sb.nT; t++) {
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 4; k++) {
        const i = T[t * 4 + k] * 3;
        cx += x[i]; cy += x[i + 1]; cz += x[i + 2];
      }
      const d = Math.hypot(cx / 4 - s.tip.x, cy / 4 - s.tip.y, cz / 4 - s.tip.z);
      if (d > R) continue;
      const f = 0.5 + 0.5 * Math.cos((Math.PI * d) / R);
      sb.tVS[t] = Math.min(3.2, sb.tVS[t] + 1.25 * dt * f);
      if (sb.tVS[t] > maxVS) maxVS = sb.tVS[t];
    }
    sb.wake(sb.tPiece[s.a1.tet]);
    s.pump += dt;
    if (s.pump > 0.45) {
      s.pump = 0;
      app.audio.squeak(0.8);
    }
    app.markDamaged();
    if (maxVS >= 3.1) this.burst();
  }

  burst() {
    const app = this.app;
    const sb = app.sb;
    const p = this.s.tip.clone();
    this.s = null;
    this.model.visible = false;
    const anchors = app.allAnchors();
    const R = 0.2;
    const res = cutBody(sb, sphereField(p.x, p.y, p.z, R), { separate: 0, snap: 0.4, anchors });
    if (res.changed) {
      const inside = new Set();
      for (const pc of sb.pieces) {
        let cx = 0, cy = 0, cz = 0, m = 0;
        for (const i of pc.verts) {
          cx += sb.x[i * 3] * sb.m[i]; cy += sb.x[i * 3 + 1] * sb.m[i]; cz += sb.x[i * 3 + 2] * sb.m[i];
          m += sb.m[i];
        }
        if (Math.hypot(cx / m - p.x, cy / m - p.y, cz / m - p.z) < R * 1.2 && pc.volume < 0.12) inside.add(pc.id);
      }
      removeTets(sb, (t) => inside.has(sb.tPiece[t]), anchors);
      for (let k = 0; k < 18; k++) {
        const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize();
        const v = dir.clone().multiplyScalar(2.5 + Math.random() * 3.5);
        v.y += 1.5;
        app.droplets.spawn(p.clone().addScaledVector(dir, R * 0.5), v, 0.015 + Math.random() * 0.025);
      }
    }
    for (let t = 0; t < sb.nT; t++) sb.tVS[t] = 1 + (sb.tVS[t] - 1) * 0.3;
    app.onTopologyChanged();
    sb.radialImpulse(p.x, p.y, p.z, 1.0, 4.5, 1);
    app.audio.pop(1);
    app.audio.splat(1);
    app.shake(0.025);
    app.markDamaged();
  }
}

// ------------------------------------------------------------------ magnet
export class MagnetTool {
  constructor(app) {
    this.squeal = false;
    this.app = app;
    this.id = 'magnet';
    this.cursor = 'none';
    this.model = makeMagnet(app.M);
    this.model.visible = false;
    app.scene.add(this.model);
    this.on = false;
    this.hovering = false;
    this.ray = new THREE.Ray();
    this.pos = new THREE.Vector3(0, 1, 1);
    this.stuck = [];
  }

  deactivate() {
    this.up();
    this.model.visible = false;
    this.hovering = false;
  }

  hover(e, ray) {
    this.hovering = !!ray;
    if (ray) this.ray.copy(ray);
  }

  down(e, ray) {
    this.on = true;
    this.hovering = true;
    this.ray.copy(ray);
    this.app.audio.loop('magnet', true, { type: 'lowpass', freq: 180, q: 6, gain: 0.18, lfo: 50, flicker: 0.3 });
    return true;
  }

  move(e, ray) {
    this.ray.copy(ray);
  }

  up() {
    if (!this.on) return;
    this.on = false;
    this.app.audio.loop('magnet', false);
    if (this.squeal) this.app.audio.loop('extract', false);
    this.squeal = false;
    for (const n of this.stuck) {
      if (n.state === 'stuck') this.app.nails._toFree(n, new THREE.Vector3(0, -0.5, 0), 1);
    }
    this.stuck.length = 0;
    if (this.app.isTouch) this.hovering = false;
  }

  update(dt) {
    const app = this.app;
    if (!this.on && !this.hovering) {
      this.model.visible = false;
      return;
    }
    // the magnet hovers in a camera-facing plane in front of the jelly
    const cam = app.camera;
    const fwd = _a.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const main = app.sb.pieces.reduce((x, y) => (y.mass > x.mass ? y : x), app.sb.pieces[0]);
    const anchorPt = main ? V(main.com) : new THREE.Vector3(0, 0.5, 0);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(fwd.clone().negate(), anchorPt.addScaledVector(fwd, -0.65));
    const hit = this.ray.intersectPlane(plane, new THREE.Vector3());
    if (hit) {
      hit.y = Math.max(hit.y, 0.2);
      this.pos.lerp(hit, 1 - Math.exp(-dt * 25));
    }
    orient(this.model, this.pos, fwd.clone().negate());
    this.model.visible = true;
    if (!this.on) return;
    const poles = this.pos.clone().addScaledVector(fwd, 0.02);
    const sb = app.sb;
    let sliding = 0;
    for (const n of app.nails.nails) {
      if (n.state === 'stuck') {
        n.tip.copy(poles).add(n.stuckOff);
        n.axis.copy(n.stuckAxis);
        continue;
      }
      const c = n.tip.clone().addScaledVector(n.axis, 0.15);
      const d = poles.clone().sub(c);
      const dist = d.length();
      if (dist > 2.6) continue;
      const f = Math.min(60, 2.2 / (dist * dist + 0.02));
      d.normalize();
      if (n.state === 'embedded') {
        sb.pushAnchor(n.aTip, d.x * f, d.y * f, d.z * f, dt * 0.05);
        sb.pushAnchor(n.aBack, d.x * f, d.y * f, d.z * f, dt * 0.05);
        // the pull along the shaft (head first) works the nail loose; the
        // jelly round it gets tugged out with it until it lets go
        const fa = f * Math.max(0, d.dot(n.axis)) - 3;
        if (fa > 0) {
          sliding = Math.max(sliding, Math.min(1, fa / 20));
          sb.pushAnchor(n.aBack, n.axis.x * fa, n.axis.y * fa, n.axis.z * fa, dt * 0.06);
          const out = d.clone().multiplyScalar(3 + Math.min(4, f * 0.08)).addScaledVector(n.axis, 1.2);
          // once it's out it flies to the magnet
          if (app.nails.slideOut(n, fa * 0.03 * dt, out)) n.homing = 0.8;
        }
      } else if (n.state === 'free') {
        n.rest = 0;
        // just pulled out: straight to the magnet; lying about: a weaker tug
        let acc = f * 0.6;
        if (n.homing > 0) {
          n.homing -= dt;
          acc = Math.max(acc, 95);
        }
        for (const [pp, qq] of [[n.p0, n.q0], [n.p1, n.q1]]) {
          pp.addScaledVector(d, acc * dt * dt);
          if (n.homing > 0) qq.lerp(pp, 0.08); // a little drag so it doesn't orbit
        }
        if (dist < 0.1) {
          n.state = 'stuck';
          n.stuckOff = n.tip.clone().sub(poles);
          n.stuckAxis = n.axis.clone();
          this.stuck.push(n);
          app.audio.clink(0.9);
        }
      }
    }
    // a gritty squeal while a nail is being drawn out
    if (sliding > 0 && !this.squeal) app.audio.loop('extract', true, { type: 'bandpass', freq: 1300, q: 4, gain: 0.07, lfo: 31, flicker: 0.7 });
    if (sliding <= 0 && this.squeal) app.audio.loop('extract', false);
    this.squeal = sliding > 0;
    if (this.squeal) app.audio.loopLevel('extract', 0.4 + 0.6 * sliding);
  }
}
