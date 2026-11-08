// Acid: a bottle of it. Hold it over the jelly and it tips and pours - thick,
// glowing green, running down whatever it lands on (it's liquid: see
// Fluid) - and where it touches jelly it fizzes and bubbles and eats in: the
// jelly it presses into shrinks as it dissolves, and from the surface in it
// melts away to liquid, molten jelly as the torch leaves (see liquefy). The
// acid weakens as it works, and fades to spent liquid; what's poured keeps
// eating after the bottle's put down.

import * as THREE from 'three';
import { target, liquefy } from './more.js';
import { makeAcidBottle } from '../world/models.js';

const POUR = 12; // particles of it a second, poured
const EAT = 2.2; // the jelly it's pressed into: its volume lost a second, at full strength (melts at 0.7 of it)
const SPEND = 0.2; // its strength lost a second while it eats
const CLING = 6; // (on the jelly it's thick: its speed there dies away at this rate)
const REACH = 0.07; // (m) how far round the spot it's on it eats, less further out
const FADE = 0.03; // ...and anyway (spent, the pool can sleep)
const FUME = 5; // (s) spent, it lingers this long, then fumes off
const ACID = [0.42, 1.0, 0.1], SPENT = [0.62, 0.7, 0.34];
const rnd = (a, b) => a + Math.random() * (b - a);

export class AcidTool {
  constructor(app) {
    this.app = app;
    this.id = 'acid';
    this.cursor = 'none';
    this.background = true; // (what's poured keeps eating after a change of tool)
    this.model = makeAcidBottle(app.M);
    this.model.visible = false;
    this.model.traverse((o) => (o.castShadow = false));
    app.scene.add(this.model);
    this.lipLocal = this.model.userData.lip;
    this.ray = new THREE.Ray();
    this.on = false;
    this.hovering = false;
    this.tilt = 0;
    this.pourT = 0;
    this.base = null;
    this.melt = new Set();
    this.meltClock = 0;
    this.bubbleT = 0;
    this.fizzing = false;
    this._axis = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
    this._lip = new THREE.Vector3();
    // the stream: a tube from the bottle's mouth down to where it lands
    // (drawn: a stream of particles this coarse falls apart into drips)
    this.streamMat = new THREE.MeshStandardMaterial({ color: 0x86ff2e, emissive: 0x3cbf00, emissiveIntensity: 0.8, roughness: 0.12, transparent: true, opacity: 0.92, envMap: app.env.texture });
    this.streamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 12, true);
    this.streamBase = Float32Array.from(this.streamGeo.attributes.position.array);
    this.stream = new THREE.Mesh(this.streamGeo, this.streamMat);
    this.stream.frustumCulled = false;
    this.stream.visible = false;
    app.scene.add(this.stream);
    this.flow = 0; // (0..1: how much is pouring - the stream thins in and out)
    this.land = new THREE.Vector3();
  }

  activate() {
    this.hovering = false;
  }

  deactivate() {
    this.model.visible = false;
    this.stream.visible = false;
    this.flow = 0;
    this.up();
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
    this.app.audio.loop('acid-pour', true, { type: 'lowpass', freq: 520, q: 5, gain: 0.22, lfo: 7, flicker: 0.7 });
    return true;
  }

  move(e, ray) {
    this.ray.copy(ray);
  }

  up() {
    if (this.on) this.app.audio.loop('acid-pour', false);
    this.on = false;
    if (this.app.isTouch) this.hovering = false;
  }

  update(dt, rdt) {
    const t = Math.min(rdt || dt, 1 / 20);
    this._react(t);
    if (!this.on && !this.hovering) {
      this.model.visible = false;
      this.stream.visible = false;
      this.tilt = 0;
      this.flow = 0;
      return;
    }
    // The bottle: up and to the side of the spot it pours on, seen side on;
    // tipped (when held down) till its mouth hangs over the spot, a little
    // above it - the acid falls the rest of the way. Pointed at a side of
    // the jelly, it pours on top, just in from that edge: straight down
    // from there.
    const app = this.app, tg = target(app, this.ray), cam = app.camera, sb = app.sb;
    const spot = tg.point.clone();
    if (tg.jelly) {
      // (a side: in from its edge, far enough that it pools on top)
      const hn = new THREE.Vector3(tg.normal.x, 0, tg.normal.z);
      if (hn.lengthSq() > 0.09) spot.addScaledVector(hn.normalize(), -0.22);
      const top = sb.raycast(spot.x, spot.y + 2, spot.z, 0, -1, 0, 4);
      if (top) spot.set(top.point[0], top.point[1], top.point[2]);
    }
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).setY(0).normalize();
    const mouth = spot.clone().addScaledVector(this._up, 0.42);
    const base = mouth.clone().addScaledVector(right, 0.2).addScaledVector(this._up, 0.16);
    if (!this.base) this.base = base.clone();
    this.base.lerp(base, 1 - Math.exp(-t * 18));
    this.tilt += ((this.on ? 1 : 0) - this.tilt) * (1 - Math.exp(-t * (this.on ? 5 : 8)));
    const pour = mouth.clone().sub(this.base).normalize();
    const axis = this._axis.copy(this._up).lerp(pour, this.tilt).normalize();
    this._q.setFromUnitVectors(this._up, axis);
    this.model.quaternion.copy(this._q);
    this.model.position.copy(this.base);
    this.model.visible = true;
    // pouring - once it's tipped far enough for the acid to reach the mouth:
    // the stream falls from the lip to whatever's under it, and the acid
    // comes down there into the pool (see Fluid)
    const lip = this._lip.copy(this.lipLocal).applyQuaternion(this._q).add(this.base);
    this.flow += ((this.on && this.tilt > 0.62 ? 1 : 0) - this.flow) * (1 - Math.exp(-t * 10));
    if (this.flow > 0.02) {
      const hit = sb.raycast(lip.x, lip.y, lip.z, 0, -1, 0, 3);
      const fl = app.fluid.n ? app.fluid.pick(new THREE.Ray(lip.clone(), new THREE.Vector3(0, -1, 0))) : null;
      let ly = hit ? hit.point[1] : 0;
      if (fl && fl.point.y > ly) ly = fl.point.y;
      this.land.set(lip.x, Math.max(0, ly), lip.z);
      this._stream(lip, this.land, t);
      if (this.on && this.tilt > 0.62) {
        const fl2 = app.fluid;
        this.pourT += t * POUR * this.flow;
        while (this.pourT >= 1) {
          this.pourT -= 1;
          fl2.add(this.land.x, this.land.y + 0.04, this.land.z, fl2.vol, rnd(-0.15, 0.15), -0.8, rnd(-0.15, 0.15), ACID[0], ACID[1], ACID[2], 0.05, 1);
        }
      }
    } else this.stream.visible = false;
  }

  // The stream from the lip down to where it lands: a tube, thinning as it
  // falls (it speeds up), wobbling a little; as thick as the flow.
  _stream(a, b, t) {
    const len = Math.max(0.01, a.y - b.y), P = this.streamGeo.attributes.position, S = this.streamBase;
    const tm = performance.now() * 0.001, r0 = 0.016 * Math.sqrt(this.flow);
    for (let i = 0; i < P.count; i++) {
      const y = S[i * 3 + 1] + 0.5; // (0 at the bottom, 1 at the lip)
      const r = r0 * (0.55 + 0.45 * y) * (1 + 0.12 * Math.sin(tm * 17 + y * 9));
      const wob = 0.006 * (1 - y) * Math.sin(tm * 11 + y * 6);
      P.setXYZ(i, S[i * 3] * r + wob, (y - 1) * len, S[i * 3 + 2] * r + wob * 0.7);
    }
    P.needsUpdate = true;
    this.streamGeo.computeVertexNormals();
    this.stream.position.copy(a);
    this.stream.visible = true;
  }

  // (one bit of acid at i, pressed into tet tt, eating this much)
  _eat(fl, sb, i, tt, amount) {
    const T = sb.T, x = sb.x, VS = sb.tVS, TB = sb.tetBoundary, X = fl.x, o = i * 3;
    const px = X[o], py = X[o + 1], pz = X[o + 2], R2 = REACH * REACH;
    // (shrinking as it goes, a little: shrunk far before it melts, the
    // jelly round it puckers into a crumpled star - as under the torch)
    const bite = (t, w) => {
      VS[t] = Math.max(0.68, VS[t] - amount * w);
      if (VS[t] <= 0.7 && TB[t] >= 0) this.melt.add(t);
    };
    bite(tt, 1);
    const cs = fl.cStart, ct = fl.cTets;
    if (!cs || !ct || !fl.cellsN) return;
    const CM = cs.length - 2, seen = this._seen || (this._seen = new Set());
    seen.clear();
    seen.add(tt);
    const hb = (Math.imul(Math.floor(px * 10), 92837111) ^ Math.imul(Math.floor(py * 10), 689287499) ^ Math.imul(Math.floor(pz * 10), 283923481)) & CM;
    for (let e = cs[hb], e1 = cs[hb + 1]; e < e1; e++) {
      const t = ct[e];
      if (seen.has(t) || t >= sb.nT || TB[t] < 0 || !(sb.vol0[t] > 0)) continue;
      seen.add(t);
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 4; k++) {
        const v = T[t * 4 + k] * 3;
        cx += x[v]; cy += x[v + 1]; cz += x[v + 2];
      }
      const dx = cx / 4 - px, dy = cy / 4 - py, dz = cz / 4 - pz, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < R2) bite(t, 1 - Math.sqrt(d2) / REACH);
    }
  }

  // The acid at work: each bit of it pressed into the jelly (this frame -
  // see Fluid._collide) dissolves it - the jelly there shrinks, from the
  // surface in it's marked to melt - and spends itself doing it; every
  // 0.15 s what's marked melts away to liquid (one rebuild). Bubbles and a
  // fizz where it's eating; its colour fades as it's spent.
  _react(dt) {
    const app = this.app, fl = app.fluid, sb = app.sb;
    let live = false, eating = 0;
    // (what's marked to melt, from before the body changed - a cut, a heal:
    // those tets aren't those any more)
    if (this.meltTopo !== sb.topoVersion) {
      this.melt.clear();
      this.meltTopo = sb.topoVersion;
    }
    if (fl.n) {
      const A = fl.acid, AT = fl.acidTet, X = fl.x, C = fl.col;
      let fumed = 0;
      for (let i = 0; i < fl.n; i++) {
        const s = A[i];
        // (spent - below 0, counting down - it fumes off in the end)
        if (s < 0) {
          A[i] = s - dt;
          if (A[i] < -FUME) {
            fumed++;
            if (Math.random() < 0.5) app.particles.smoke({ x: X[i * 3], y: X[i * 3 + 1] + 0.03, z: X[i * 3 + 2] }, 1, 0.1, 0.95, 0.3, 0.14);
          }
          continue;
        }
        if (!(s > 0)) continue;
        live = true;
        let left = s - FADE * dt;
        const tt = AT[i];
        AT[i] = -1;
        if (tt >= 0 && tt < sb.nT && sb.vol0[tt] > 0 && sb.alive[sb.T[tt * 4]]) {
          // the jelly round where it's pressed in (its outside: the
          // liquid's cells of the jelly near it - see Fluid._jellyCells)
          // dissolves, most right there: a round bite, not a ragged one
          this._eat(fl, sb, i, tt, EAT * s * dt);
          sb.wake(sb.tPiece[tt]);
          left -= SPEND * dt;
          eating++;
          // (thick: it clings to the jelly it's eating, it doesn't run off it)
          const V = fl.v, o = i * 3, k = Math.exp(-CLING * dt);
          V[o] *= k; V[o + 1] *= k; V[o + 2] *= k;
          // (a bubble now and then, from where it's eating)
          if (Math.random() < dt * 9) {
            const o = i * 3;
            app.particles.alpha.spawn(X[o] + rnd(-0.03, 0.03), X[o + 1] + rnd(0, 0.03), X[o + 2] + rnd(-0.03, 0.03), rnd(-0.08, 0.08), rnd(0.15, 0.4), rnd(-0.08, 0.08),
              rnd(0.35, 0.8), rnd(0.008, 0.014), rnd(0.02, 0.034), [0.85, 1.0, 0.7, 0.8], [0.95, 1.0, 0.9, 0], 2.5, 1.6);
          }
        }
        left = Math.max(0, left);
        A[i] = left > 0 ? left : -1e-4;
        // (green while it's strong, fading to spent)
        const k = 1 - Math.min(1, left);
        const o = i * 3;
        C[o] = ACID[0] + (SPENT[0] - ACID[0]) * k;
        C[o + 1] = ACID[1] + (SPENT[1] - ACID[1]) * k;
        C[o + 2] = ACID[2] + (SPENT[2] - ACID[2]) * k;
      }
      if (fumed) fl.removeWhere((i) => A[i] < -FUME);
    }
    fl.keepAwake = live;
    // the fizz, as loud as how much of it's eating
    if (eating && !this.fizzing) {
      app.audio.loop('acid-fizz', true, { type: 'highpass', freq: 3800, q: 0.8, gain: 0.2, lfo: 23, flicker: 0.6 });
      this.fizzing = true;
    }
    if (this.fizzing) {
      if (eating) app.audio.loopLevel('acid-fizz', Math.min(1, 0.3 + eating / 14));
      else {
        app.audio.loop('acid-fizz', false);
        this.fizzing = false;
      }
    }
    // (pale fumes off it now and then)
    if (eating && Math.random() < dt * 2.5) {
      let k = Math.floor(Math.random() * fl.n);
      for (let n = 0; n < 8 && !(fl.acid[k] > 0); n++) k = Math.floor(Math.random() * fl.n);
      app.particles.smoke({ x: fl.x[k * 3], y: fl.x[k * 3 + 1] + 0.05, z: fl.x[k * 3 + 2] }, 1, 0.12, 0.95, 0.35, 0.18);
    }
    this.meltClock += dt;
    if (this.melt.size && this.meltClock > 0.15) {
      this.meltClock = 0;
      // (no index past what's there: a cut or a heal since)
      for (const tt of this.melt) if (tt >= sb.nT || !(sb.vol0[tt] > 0)) this.melt.delete(tt);
      if (this.melt.size) {
        const VS = sb.tVS;
        liquefy(app, this.melt, {
          full: true,
          // (a sliver it's eaten round - two faces bare, mostly dissolved;
          // three, whatever it is - goes too)
          spike: (u) => (VS[u] < 0.8 ? 2 : 3),
        });
        app.markDamaged();
      }
      this.melt.clear();
    }
  }
}
