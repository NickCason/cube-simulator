// A cube full of liquid re-cubed: a syringe over where it's to be draws its liquid up out of the room - every
// drop flying up into its needle (see Fluid.recall) - while its bits fly back together; made again, hollow, the
// needle goes in through its top and puts the liquid back, rising in it from the bottom (Fluid.revealY: it's
// all in it from the first, as a re-cube always made it - its weight, its slosh - only drawn as high as it's
// been put back so far), then it comes out and goes. One syringe a cube.
import * as THREE from 'three';
import { makeSyringe, orient } from './models.js';
import { REST_STEP, polarRot } from '../sim/softbody.js';

const HOVER = 0.32; // (its needle's tip over the cube's top, drawing the liquid up - a share of its size: higher, it
// was out of the picture, the liquid flying up off the top of the screen)
const SCALE = 1.25; // (the syringe's size, a share of the cube's)
const GROW = 0.3, DIVE = 0.45, RISE = 0.4, LEAVE = 0.35; // (s)

export class Injector {
  constructor(app) {
    this.app = app;
    this.jobs = [];
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this._A = new Float64Array(9);
    this._R = new Float64Array(9);
  }

  get active() {
    return this.jobs.length > 0;
  }

  // Cube `slot` re-forming, its top to be at (cx, top, cz): its syringe there, ready to draw the liquid up. Its
  // needle's tip: where the liquid's to fly to.
  // (draw: how many drops are flying up into it - none, it comes full)
  start(slot, cx, top, cz, size, draw = 0) {
    this._drop(slot);
    const app = this.app, fl = app.fluid;
    const g = makeSyringe(app.M), fm = g.userData.fluid;
    // (the liquid in its barrel: the colour of what it's drawing up - its own cube's, else any - or its jelly's)
    const col = new THREE.Color(), id = app.sb.cHid[slot];
    let r = 0, gg = 0, b = 0, n = 0;
    for (let pass = 0; pass < 2 && !n; pass++)
      for (let i = 0; i < fl.n; i++) {
        if (!pass && (!id || fl.own[i] !== id)) continue;
        r += fl.col[i * 3]; gg += fl.col[i * 3 + 1]; b += fl.col[i * 3 + 2];
        n++;
      }
    if (n) col.setRGB(r / n, gg / n, b / n);
    else col.set(app.flavorColorAtRest(slot * REST_STEP, 0, 0, slot));
    fm.material = new THREE.MeshStandardMaterial({ color: col, roughness: 0.12, transparent: true, opacity: 0.8, envMap: fm.material.envMap });
    const stream = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).translate(0, -0.5, 0), new THREE.MeshStandardMaterial({ color: col, roughness: 0.08, transparent: true, opacity: 0.92, envMap: fm.material.envMap, depthWrite: false }));
    stream.visible = false;
    stream.frustumCulled = false;
    g.scale.setScalar(0.001);
    app.scene.add(g, stream);
    const hover = new THREE.Vector3(cx, top + HOVER * size, cz);
    const J = { slot, phase: 'suck', t: 0, size, g, stream, col, hover, tip: hover.clone(), axis: new THREE.Vector3(0, 1, 0), from: hover.clone(), fromAxis: new THREE.Vector3(0, 1, 0), fill: draw ? 0 : 1, n0: draw, y0: 0, y1: 0, dur: 1, q: new Float64Array([0, 0, 0, 1]), cv: app.sb.cubeVersion, topo: -1, grow: 0, top: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), th: 0 };
    this.jobs.push(J);
    this._pose(J);
    return J;
  }

  // (where cube slot's syringe's needle is: for the liquid flying up into it)
  tip(slot) {
    return this.jobs.find((J) => J.slot === slot)?.hover ?? null;
  }

  // (a cube made hollow again - see Spill._hollow: is its liquid to be put back by syringe)
  wants(slot) {
    return this.jobs.some((J) => J.slot === slot && (J.phase === 'suck' || J.phase === 'wait'));
  }

  // Cube slot made hollow and filled (Spill._hollow): in through its top, and its liquid let in - drawn rising
  // from its bottom.
  begin(slot) {
    const J = this.jobs.find((q) => q.slot === slot);
    if (!J) return;
    const app = this.app, sb = app.sb, fl = app.fluid, id = sb.cHid[slot];
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < fl.n; i++) {
      if (!id || fl.own[i] !== id) continue;
      lo = Math.min(lo, fl.x[i * 3 + 1]);
      hi = Math.max(hi, fl.x[i * 3 + 1]);
    }
    J.cv = sb.cubeVersion;
    J.topo = sb.topoVersion;
    if (!(hi >= lo)) return this._go(J, 'leave');
    const D = fl.D;
    J.y0 = lo - 0.6 * D;
    J.y1 = hi + 0.6 * D;
    // (as long as it takes to fill it that full: a second and a half to two and a half)
    J.dur = 1.3 + 1.2 * Math.min(1, (hi - lo + D) / sb.cSize[slot]);
    fl.setReveal(slot, J.y0);
    J.fill = 1;
    this._go(J, 'dive');
  }

  // Everything as it was before (a heal stopped part way - a swap): gone, the liquid all drawn.
  cancel() {
    for (const J of [...this.jobs]) this._drop(J.slot);
  }

  update(dt) {
    if (!this.jobs.length) return;
    const app = this.app, sb = app.sb, fl = app.fluid;
    for (const J of [...this.jobs]) {
      J.t += dt;
      J.grow = J.phase === 'leave' ? Math.max(0, 1 - J.t / LEAVE) : Math.min(1, J.grow + dt / GROW);
      // (its cube gone, or another in its place: it goes)
      if (J.phase !== 'suck' && J.phase !== 'wait' && J.phase !== 'leave' && (sb.cubeVersion !== J.cv || !(sb.cSize[J.slot] > 0))) this._go(J, 'leave');
      if (J.phase === 'suck') {
        // drawing it up: as full as the liquid's gone into it
        J.fill = J.n0 ? Math.min(1, Math.max(J.fill, 1 - (fl.rc ? fl.rc.left : 0) / J.n0)) : 1;
        J.tip.copy(J.hover).y += 0.02 * Math.sin(J.t * 3.1);
        if (!fl.rc) this._go(J, 'wait');
      } else if (J.phase === 'wait') {
        J.fill = 1;
        J.tip.copy(J.hover).y += 0.02 * Math.sin(J.t * 3.1);
        // (made again, and not to be filled - made solid, or empty - or a long while and nothing: away)
        const h = app.healer;
        if ((!h.active && !(sb.cLiq[J.slot] && sb.cFill[J.slot] > 0) && J.t > 0.2) || J.t > 9) this._go(J, 'leave');
      } else if (J.phase === 'dive') {
        if (!this._frame(J)) {
          this._go(J, 'leave');
          continue;
        }
        const u = smooth(J.t / DIVE);
        this._w.copy(J.top).addScaledVector(J.up, -(J.th + 0.06 * J.size));
        J.tip.lerpVectors(J.from, this._w, u);
        J.axis.lerpVectors(J.fromAxis, J.up, u).normalize();
        if (J.t >= DIVE) this._go(J, 'inject');
      } else if (J.phase === 'inject') {
        if (!this._frame(J) || !sb.cav[J.slot]?.sealed) {
          // (cut open meanwhile: all of it at once)
          fl.setReveal(J.slot, Infinity);
          this._go(J, 'rise');
          continue;
        }
        J.tip.copy(J.top).addScaledVector(J.up, -(J.th + 0.06 * J.size));
        J.axis.copy(J.up);
        const u = Math.min(1, J.t / J.dur), e = u * (2 - u);
        // (the level: as high as it's been put back - and as high as the liquid's got, sloshing)
        const y = J.y0 + (J.y1 - J.y0) * e;
        fl.setReveal(J.slot, u >= 1 ? Infinity : y);
        J.fill = 1 - e;
        J.level = y;
        if (u >= 1) this._go(J, 'rise');
      } else if (J.phase === 'rise') {
        this._frame(J);
        const u = smooth(J.t / RISE);
        this._w.copy(J.top).addScaledVector(J.up, HOVER * J.size);
        J.tip.lerpVectors(J.from, this._w, u);
        J.fill = 0;
        if (J.t >= RISE) this._go(J, 'leave');
      } else if (J.phase === 'leave') {
        if (J.t >= LEAVE) {
          this._drop(J.slot);
          continue;
        }
      }
      this._pose(J);
    }
  }

  _go(J, phase) {
    if (J.phase === 'inject' && phase !== 'inject') this.app.fluid.setReveal(J.slot, Infinity);
    J.phase = phase;
    J.t = 0;
    J.from.copy(J.tip);
    J.fromAxis.copy(J.axis);
  }

  // (the syringe as it is now: its needle at tip along axis, its plunger and barrel as full as it is; the stream
  // from its tip down to the liquid's level, letting it in)
  _pose(J) {
    const g = J.g, s = SCALE * J.size * Math.max(0.001, J.grow * (2 - J.grow));
    orient(g, J.tip, J.axis);
    g.scale.setScalar(s);
    const f = Math.min(1, Math.max(0, J.fill)), fm = g.userData.fluid;
    g.userData.plunger.position.y = 0.06 + 0.24 * f;
    fm.scale.y = Math.max(0.04, f);
    fm.position.y = 0.26 + 0.15 * f;
    const st = J.stream, on = J.phase === 'inject' && J.level !== undefined;
    st.visible = on;
    if (on) {
      const bot = Math.min(J.tip.y - 0.01, Math.max(J.y0 + 0.6 * this.app.fluid.D, J.level - 0.3 * this.app.fluid.D)), r = 0.022 * J.size * (1 + 0.12 * Math.sin(J.t * 41));
      st.position.copy(J.tip);
      st.scale.set(r, Math.max(0.001, J.tip.y - bot), r);
    }
  }

  // (cube J.slot as it stands: its top's middle and its up, turned with it - the turn that fits it best, from
  // its rest shape - and its wall's thickness; false if it's gone)
  _frame(J) {
    const sb = this.app.sb, k = J.slot, x = sb.x, X = sb.X, vc = sb.vCube, A = this._A, R = this._R;
    let n = 0, xm0 = 0, xm1 = 0, xm2 = 0, Xm0 = 0, Xm1 = 0, Xm2 = 0;
    for (let i = 0; i < sb.nV; i++) {
      if (vc[i] !== k || !sb.alive[i]) continue;
      const o = i * 3;
      xm0 += x[o]; xm1 += x[o + 1]; xm2 += x[o + 2];
      Xm0 += X[o]; Xm1 += X[o + 1]; Xm2 += X[o + 2];
      n++;
    }
    if (!n) return false;
    xm0 /= n; xm1 /= n; xm2 /= n; Xm0 /= n; Xm1 /= n; Xm2 /= n;
    A.fill(0);
    for (let i = 0; i < sb.nV; i++) {
      if (vc[i] !== k || !sb.alive[i]) continue;
      const o = i * 3, a0 = x[o] - xm0, a1 = x[o + 1] - xm1, a2 = x[o + 2] - xm2, b0 = X[o] - Xm0, b1 = X[o + 1] - Xm1, b2 = X[o + 2] - Xm2;
      A[0] += a0 * b0; A[1] += a0 * b1; A[2] += a0 * b2;
      A[3] += a1 * b0; A[4] += a1 * b1; A[5] += a1 * b2;
      A[6] += a2 * b0; A[7] += a2 * b1; A[8] += a2 * b2;
    }
    polarRot(J.q, A, R, 12);
    const half = sb.cSize[k] / 2, d0 = k * REST_STEP - Xm0, d1 = half - Xm1, d2 = -Xm2;
    J.top.set(xm0 + R[0] * d0 + R[1] * d1 + R[2] * d2, xm1 + R[3] * d0 + R[4] * d1 + R[5] * d2, xm2 + R[6] * d0 + R[7] * d1 + R[8] * d2);
    J.up.set(R[1], R[4], R[7]).normalize();
    const sk = Math.min(1, Math.max(0, sb.cSkin[k])), size = sb.cSize[k];
    J.th = size * (sk <= 0.5 ? 0.05 + 0.08 * sk : 0.09 + 0.18 * (sk - 0.5));
    return true;
  }

  // (cube slot's syringe gone: its liquid all drawn)
  _drop(slot) {
    const i = this.jobs.findIndex((J) => J.slot === slot);
    if (i < 0) return;
    const J = this.jobs[i], app = this.app;
    this.jobs.splice(i, 1);
    app.fluid.setReveal(slot, Infinity);
    app.scene.remove(J.g, J.stream);
    J.stream.geometry.dispose();
    J.stream.material.dispose();
    J.g.userData.fluid.material.dispose();
    J.g.traverse((o) => o.geometry?.dispose());
  }
}

function smooth(u) {
  u = Math.min(1, Math.max(0, u));
  return u * u * (3 - 2 * u);
}
