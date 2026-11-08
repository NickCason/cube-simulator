// The sieve: flour in it - or sugar, cocoa, matcha, sprinkles, glitter,
// rainbow powder (see powders.js; pick from the row over the dock). Hold
// it over the jelly - or the floor - and it shakes: a fine fall of it
// sifts down and dusts whatever it lands on (the jelly where it lands - see
// Flour.coat - or the floor). Roll a cube through what's on the floor and
// it's coated where it touched (see Flour); a full re-cube sweeps it away.

import * as THREE from 'three';
import { target } from './more.js';
import { makeSieve } from '../world/models.js';
import { POWDERS, POWDER_BY_ID, SPRINKLE, rainbowAt } from '../world/powders.js';

const RATE = 420; // grains a second, shaken out (a wide sieve: a wide fall)
const GRAIN = 0.0055; // (each: how much it floured the jelly where it landed - a little, over a wide patch: it builds up)
const COAT_R = 0.2; // (...that patch's radius)
const FLOOR = 0.045; // ...and the floor
const FLOOR_R = 0.034;
const MAXG = 900;
const rnd = (a, b) => a + Math.random() * (b - a);

export class FlourTool {
  constructor(app) {
    this.app = app;
    this.id = 'flour';
    this.cursor = 'none';
    this.background = true; // (what's in the air still lands after a change of tool)
    this.model = makeSieve(app.M);
    this.model.rotation.order = 'YXZ';
    this.model.visible = false;
    this.model.traverse((o) => (o.castShadow = false));
    app.scene.add(this.model);
    this.heap = this.model.getObjectByName('heap');
    this.ray = new THREE.Ray();
    this.on = false;
    this.hovering = false;
    this.pos = null; // (where the sieve is, eased)
    this.shake = 0;
    this.siftT = 0;
    // the grains in the air: where, how fast, and the height each lands at
    // (what was under it when it fell: the jelly, or the floor)
    this.g = new Float32Array(MAXG * 3);
    this.gv = new Float32Array(MAXG * 3);
    this.gh = new Float32Array(MAXG);
    // (and each one's colour, as seen, and what it is: its look - see Flour)
    this.gc = new Float32Array(MAXG * 4);
    this.gl = new Float32Array(MAXG * 5);
    this.n = 0;
    const geo = new THREE.BufferGeometry();
    this.gAttr = new THREE.BufferAttribute(this.g, 3).setUsage(THREE.DynamicDrawUsage);
    this.cAttr = new THREE.BufferAttribute(this.gc, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.gAttr);
    geo.setAttribute('aCol', this.cAttr);
    geo.setDrawRange(0, 0);
    this.scaleU = { value: 600 };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: { uScale: this.scaleU },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute vec4 aCol;
        varying vec4 vCol;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(1.5, 0.0085 * aCol.a * uScale / max(-mv.z, 0.05));
          vCol = aCol;
        }`,
      fragmentShader: /* glsl */ `
        varying vec4 vCol;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r = dot(p, p);
          if (r > 1.0) discard;
          gl_FragColor = vec4(vCol.rgb, 0.88 * (1.0 - r * r));
        }`,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 1;
    app.particles.scene.add(this.points);
    // what's in it (as it was last left)
    let id = 'flour';
    try {
      id = localStorage.getItem('cube-sim-powder') || id;
    } catch (e) {}
    this.setPowder(POWDER_BY_ID[id] ? id : 'flour', false);
  }

  // What's in the sieve (see powders.js).
  setPowder(id, say = true) {
    const p = POWDER_BY_ID[id];
    if (!p) return;
    this.powder = p;
    try {
      localStorage.setItem('cube-sim-powder', id);
    } catch (e) {}
    const hc = p.rainbow ? [1, 0.55, 0.75] : p.multi ? [0.98, 0.9, 0.92] : p.col;
    this.heap?.material.color.setRGB(hc[0], hc[1], hc[2], THREE.SRGBColorSpace);
    if (this.heap) this.heap.material.roughness = p.sparkle ? 0.35 : 1;
    this.app.ui?.setPowder?.(id);
    if (say) this.app.ui?.hint(`${p.name} in the sieve`, 1200);
  }

  // (the next one along: the sieve's key again)
  nextPowder() {
    const i = POWDERS.indexOf(this.powder);
    this.setPowder(POWDERS[(i + 1) % POWDERS.length].id);
  }

  activate() {
    this.hovering = false;
  }

  deactivate() {
    this.model.visible = false;
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
    this.app.audio.loop('flour-sift', true, { type: 'bandpass', freq: 3400, q: 0.8, gain: 0.09, lfo: 8, flicker: 0.85 });
    return true;
  }

  move(e, ray) {
    this.ray.copy(ray);
  }

  up() {
    if (this.on) this.app.audio.loop('flour-sift', false);
    this.on = false;
    if (this.app.isTouch) this.hovering = false;
  }

  update(dt, rdt) {
    const t = Math.min(rdt || dt, 1 / 20);
    this._fall(dt);
    if (!this.on && !this.hovering) {
      this.model.visible = false;
      this.pos = null;
      this.shake = 0;
      return;
    }
    // The sieve: over the spot, a hand's height up - aimed at a side of
    // the jelly, over its top just in from that edge - its handle off to
    // the side you see; held down, shaken.
    const app = this.app, sb = app.sb, tg = target(app, this.ray);
    const spot = tg.point.clone();
    if (tg.jelly) {
      const hn = new THREE.Vector3(tg.normal.x, 0, tg.normal.z);
      if (hn.lengthSq() > 0.09) spot.addScaledVector(hn.normalize(), -0.1);
      const top = sb.raycast(spot.x, spot.y + 2, spot.z, 0, -1, 0, 4);
      if (top) spot.set(top.point[0], top.point[1], top.point[2]);
    }
    spot.y = Math.max(spot.y, 0) + 0.34;
    if (!this.pos) this.pos = spot.clone();
    this.pos.lerp(spot, 1 - Math.exp(-t * 14));
    this.shake += ((this.on ? 1 : 0) - this.shake) * (1 - Math.exp(-t * 12));
    const m = this.model, s = this.shake, tm = performance.now() * 0.001;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(app.camera.quaternion);
    m.position.copy(this.pos);
    m.position.x += Math.sin(tm * 46) * 0.011 * s;
    m.position.z += Math.cos(tm * 38) * 0.008 * s;
    m.rotation.set(Math.sin(tm * 41) * 0.05 * s, -Math.atan2(right.z, right.x) - 0.5, Math.cos(tm * 46) * 0.06 * s);
    m.visible = true;
    if (!this.on || !(dt > 0)) return;
    // sifting: grains out of the mesh, from all over it
    const R = m.userData.radius * 0.88;
    this.siftT = Math.min(this.siftT + dt * RATE, 8);
    while (this.siftT >= 1 && this.n < MAXG) {
      this.siftT -= 1;
      // (more through the middle of it, thinning out to the rim: the fall
      // lands soft-edged, a dusting, not a disc)
      const a = Math.random() * Math.PI * 2, r = R * Math.pow(Math.random(), 0.8);
      const x = m.position.x + Math.cos(a) * r, y = m.position.y - 0.004, z = m.position.z + Math.sin(a) * r;
      const i = this.n++, o = i * 3;
      this.g[o] = x; this.g[o + 1] = y; this.g[o + 2] = z;
      // (shaken out every which way a little: the fall spreads as it goes)
      this.gv[o] = rnd(-0.22, 0.22); this.gv[o + 1] = rnd(-0.3, -0.06); this.gv[o + 2] = rnd(-0.22, 0.22);
      // (where it'll land: what's under it now - near enough, as it spreads)
      const hit = sb.raycast(x, y, z, 0, -1, 0, y + 0.1);
      this.gh[i] = hit ? hit.point[1] : 0;
      // (what it is: a pinch of rainbow powder is one bright colour; a
      // sprinkle or a glitter flake is seen in its own as it falls)
      const P = this.powder, L = this.gl, C = this.gc, l = i * 5, c = i * 4;
      const col = P.rainbow ? rainbowAt(performance.now() / 1000) : P.lin;
      L[l] = col[0]; L[l + 1] = col[1]; L[l + 2] = col[2]; L[l + 3] = P.sparkle; L[l + 4] = P.multi;
      const seen = P.multi ? SPRINKLE[Math.floor(Math.random() * SPRINKLE.length)] : col;
      C[c] = seen[0]; C[c + 1] = seen[1]; C[c + 2] = seen[2];
      C[c + 3] = P.multi && !P.sparkle ? 1.5 : P.sparkle ? 1.1 : 1;
    }
    // (and a haze of the finest of it, drifting down with it - not of
    // sprinkles, or glitter)
    if (!this.powder.multi && Math.random() < dt * 26) {
      const a = Math.random() * Math.PI * 2, r = R * Math.sqrt(Math.random()), hc = this.powder.rainbow ? rainbowAt(performance.now() / 1000) : this.powder.lin;
      app.particles.alpha.spawn(m.position.x + Math.cos(a) * r, m.position.y - 0.01, m.position.z + Math.sin(a) * r, rnd(-0.06, 0.06), rnd(-0.4, -0.2), rnd(-0.06, 0.06),
        rnd(0.6, 1), rnd(0.03, 0.045), rnd(0.08, 0.13), [hc[0], hc[1], hc[2], 0.13], [hc[0], hc[1], hc[2], 0], 1.2, -0.4);
    }
  }

  // The grains in the air: falling, floating a little; each that reaches
  // where it was to land floured what's there - the jelly (what's under it
  // now: it may have moved), or the floor.
  _fall(dt) {
    const app = this.app, sb = app.sb, P = this.g, V = this.gv, H = this.gh;
    const cam = app.camera;
    this.scaleU.value = app.size.ph / (2 * Math.tan((cam.fov * Math.PI) / 360));
    if (this.n && dt > 0) {
      const k = Math.exp(-3.2 * dt);
      let i = 0;
      while (i < this.n) {
        const o = i * 3;
        V[o] = V[o] * k + rnd(-0.9, 0.9) * dt;
        V[o + 1] = V[o + 1] * k - 3 * dt;
        V[o + 2] = V[o + 2] * k + rnd(-0.9, 0.9) * dt;
        const x = P[o] + V[o] * dt, y = P[o + 1] + V[o + 1] * dt, z = P[o + 2] + V[o + 2] * dt;
        if (y > H[i]) {
          P[o] = x; P[o + 1] = y; P[o + 2] = z;
          i++;
          continue;
        }
        // landed: on the jelly (still there?), else on down to the floor
        let done = false;
        if (H[i] > 0.002) {
          const hit = sb.raycast(x, H[i] + 0.06, z, 0, -1, 0, 0.14);
          const look = this.gl.subarray(i * 5, i * 5 + 5);
          if (hit) {
            app.flour.coatAround(hit.point[0], hit.point[1], hit.point[2], hit.piece, GRAIN, COAT_R, look, this.powder.rec);
            this._puff(x, hit.point[1], z, look);
            done = true;
          } else H[i] = 0;
        } else {
          const look = this.gl.subarray(i * 5, i * 5 + 5);
          app.flour.add(x, z, FLOOR, FLOOR_R, look);
          this._puff(x, 0, z, look);
          done = true;
        }
        if (!done) {
          P[o] = x; P[o + 1] = y; P[o + 2] = z;
          i++;
          continue;
        }
        // (gone: the last one in its place)
        const j = --this.n;
        if (i !== j) {
          for (let c = 0; c < 3; c++) {
            P[o + c] = P[j * 3 + c];
            V[o + c] = V[j * 3 + c];
          }
          H[i] = H[j];
          this.gc.copyWithin(i * 4, j * 4, j * 4 + 4);
          this.gl.copyWithin(i * 5, j * 5, j * 5 + 5);
        }
      }
    }
    this.points.geometry.setDrawRange(0, this.n);
    if (this.n || this._shown) {
      this.gAttr.needsUpdate = true;
      this.cAttr.needsUpdate = true;
    }
    this._shown = this.n > 0;
    // (the heap in the sieve goes down a little as it sifts, back up after)
    if (this.heap) this.heap.scale.y = 0.28 - 0.06 * this.shake;
  }

  // (a wisp where a grain came down, now and then - not of sprinkles)
  _puff(x, y, z, look) {
    if (look[4] > 0.5 || Math.random() > 0.18) return;
    this.app.particles.alpha.spawn(x, y + 0.004, z, rnd(-0.05, 0.05), rnd(0.02, 0.08), rnd(-0.05, 0.05),
      rnd(0.4, 0.8), rnd(0.01, 0.016), rnd(0.03, 0.05), [look[0], look[1], look[2], 0.3], [look[0], look[1], look[2], 0], 2.5, 0);
  }
}
