import * as THREE from 'three';
import { cutBody, sphereField, separateClusters, removeTets, removeSmallPieces } from '../sim/cutting.js';
import { makeMallet, makeTorch, makeSpray, makeBaller, makeBomb, makeSyringe, makeMagnet, orient } from '../world/models.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = [0, 0, 0];
const _p2 = [0, 0, 0];

// What is under the pointer: jelly, floor, or a point in mid-air.
function target(app, ray) {
  const hit = app.pickJelly(ray);
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
    const a = this.anim;
    if (!a) return;
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
      sb.impulse(p.x, p.y, p.z, d.x, d.y, d.z, 0.48, 7.5, a.tg.hit.piece);
      app.audio.thud(1);
      // a few wet flecks fly off
      const n = a.tg.normal;
      for (let k = 0; k < 5; k++) {
        const v = n.clone().multiplyScalar(1.5 + Math.random() * 2).add(new THREE.Vector3((Math.random() - 0.5) * 2.5, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 2.5));
        app.droplets.spawn(p.clone().addScaledVector(n, 0.03), v, 0.008 + Math.random() * 0.012);
      }
      app.markDamaged();
    } else {
      // whack the table: everything nearby hops
      const x = sb.x, v = sb.v;
      for (let i = 0; i < sb.nV; i++) {
        if (!sb.w[i] || x[i * 3 + 1] > 0.25) continue;
        const r = Math.hypot(x[i * 3] - p.x, x[i * 3 + 2] - p.z);
        if (r < 1.3) v[i * 3 + 1] += 3.6 * (1 - r / 1.3);
      }
      app.audio.thud(0.7);
      app.particles.smoke(p, 3, 0.4, 0.75, 0.1, 0.2);
    }
  }

  shatter(a) {
    const app = this.app;
    const sb = app.sb;
    const p = a.tg.point;
    const piece = a.tg.hit.piece;
    const pc = sb.pieces[piece];
    const seeds = [];
    const K = 9;
    for (let k = 0; k < K; k++) {
      const near = k < 5;
      const s = near ? 0.35 : 0.9;
      seeds.push(new THREE.Vector3(
        (near ? p.x : pc.com[0]) + (Math.random() - 0.5) * s,
        (near ? p.y : pc.com[1]) + (Math.random() - 0.5) * s,
        (near ? p.z : pc.com[2]) + (Math.random() - 0.5) * s,
      ));
    }
    const labels = new Int32Array(sb.nT);
    const T = sb.T, x = sb.x;
    for (let t = 0; t < sb.nT; t++) {
      if (sb.tPiece[t] !== piece) {
        labels[t] = 1000 + sb.tPiece[t];
        continue;
      }
      let cx = 0, cy = 0, cz = 0, tt = 0;
      for (let k = 0; k < 4; k++) {
        const i = T[t * 4 + k];
        cx += x[i * 3]; cy += x[i * 3 + 1]; cz += x[i * 3 + 2];
        tt += sb.temp[i];
      }
      cx /= 4; cy /= 4; cz /= 4;
      if (tt / 4 > -0.25) {
        labels[t] = 999;
        continue;
      }
      let best = 0, bd = Infinity;
      for (let k = 0; k < K; k++) {
        const s = seeds[k];
        const dd = (cx - s.x) ** 2 + (cy - s.y) ** 2 + (cz - s.z) ** 2;
        if (dd < bd) {
          bd = dd;
          best = k;
        }
      }
      labels[t] = best;
    }
    separateClusters(sb, labels, app.allAnchors());
    // wafer-thin crumbs become little ice chips instead of slivers
    const crumbs = removeSmallPieces(sb, 0.006 * sb.p.size ** 3, app.allAnchors());
    for (let k = 0; k < crumbs.length; k += 4) {
      const c = new THREE.Vector3(crumbs[k], crumbs[k + 1], crumbs[k + 2]);
      const v = c.clone().sub(p).normalize().multiplyScalar(2 + Math.random() * 2);
      v.y += 2;
      app.droplets.spawn(c, v, 0.012 + Math.cbrt(crumbs[k + 3]) * 0.35, '#dcefff');
    }
    app.onTopologyChanged();
    sb.radialImpulse(p.x, p.y, p.z, 1.4, 3.2, 1.5);
    sb.impulse(p.x, p.y, p.z, a.d.x, a.d.y, a.d.z, 0.6, 3.0);
    app.audio.crack(1);
    app.audio.thud(0.6);
    for (let k = 0; k < 40; k++) app.particles.glitter(p, 1, [0.85, 0.95, 1.0], 1.4);
    app.particles.mist(p, new THREE.Vector3(0, 0.6, 0), 8);
    app.markDamaged();
  }
}

// ------------------------------------------------------------------ torch & cryo
class NozzleTool {
  constructor(app, id, model) {
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
      // very hot jelly liquefies and runs off: the region slowly caves in
      const T = sb.T, x = sb.x, temp = sb.temp;
      for (let t = 0; t < sb.nT; t++) {
        const a = T[t * 4], b = T[t * 4 + 1], c = T[t * 4 + 2], d = T[t * 4 + 3];
        const tt = (temp[a] + temp[b] + temp[c] + temp[d]) * 0.25;
        if (tt < 1.05) continue;
        const dd = Math.hypot(x[a * 3] - tg.point.x, x[a * 3 + 1] - tg.point.y, x[a * 3 + 2] - tg.point.z);
        if (dd < 0.32) sb.tVS[t] = Math.max(0.4, sb.tVS[t] - 0.42 * dt);
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
      } else if (n.state === 'free') {
        n.rest = 0;
        for (const [pp, qq] of [[n.p0, n.q0], [n.p1, n.q1]]) {
          pp.addScaledVector(d, f * dt * dt * 0.6);
          void qq;
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
  }
}
