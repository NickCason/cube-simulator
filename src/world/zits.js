// Zits on the jelly (a cube's acne: see acne.js) - each an angry red bump, a blush of red round it on the skin, a
// head at its top (whitehead, yellow, green, black) - held on at three points in the jelly like the googly eyes (see
// world/eyes.js): it rides the wobble, tips and squashes with the skin under it. Popped:
// - squeezed: a finger held on it (a hand's grab there - SQUEEZE s, it swelling and whitening as it goes), or the
//   jelly round it squashed (two fingers pinching it, the mallet, a cube landing on it): its pus comes out as a worm,
//   squirming out of it a blob at a time, sagging, then dropping off to lie in a squiggle on the floor
// - shot (the guns: see shot) - its pus bursts out in a spatter
// - cut through, or its jelly gone (melted, eaten, bored out): it oozes a little, and is gone
// ...and it's left a dark crater. The pus: thick, its own colour, creamy - blobs that fly slow (a gloopy drag) and
// splat flat where they land, and lie there a while. A re-cube brings them all back, unpopped; the pus is swept up.

import * as THREE from 'three';
import { REST_STEP } from '../sim/softbody.js';
import { eyeFrame } from '../eyes.js';
import { zitSpots } from '../acne.js';
import { LATE_LAYER } from './eyes.js';

const MAXZ = 160; // (zits drawn, each pass)
const BLOBS = 900; // (pus blobs, each pass)
const SINKS = [0.004, 0.02, 0.05]; // (how far under the skin each hold is tried: shares of the side)
const LIFT = 0.003; // (and how far out of it the zit sits)
const SQUEEZE = 0.55; // (s a finger held on one: popped)
const SQUASH = 0.8; // (the skin round it squashed to this of what it's been lately - pinched, struck: popped. Of its size as
// made, a pudding slumping at rest popped every zit on its sides)
const PUS_DRAG = 1.7; // (/s: its way through the air, slowed - it's gloopy)
const FLOOR_LIFE = 30; // (s a splat lies on the floor)

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _c = new THREE.Color();
const rnd = (a, b) => a + Math.random() * (b - a);

// a soft round blush: white in the middle, fading out (its colour: each instance's)
function blushTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,0.75)');
  r.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Zits {
  constructor(app) {
    this.app = app;
    const env = app.env.texture;
    const mk = (geo, mat, n, front) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      if (front) m.layers.set(LATE_LAYER);
      app.scene.add(m);
      return m;
    };
    // (the bump: a dome along +z, its foot at z 0)
    const dome = () => {
      const g = new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      g.rotateX(Math.PI / 2);
      g.setAttribute('aHead', new THREE.InstancedBufferAttribute(new Float32Array(MAXZ * 3), 3));
      g.setAttribute('aPop', new THREE.InstancedBufferAttribute(new Float32Array(MAXZ), 1));
      return g;
    };
    // its skin: red - instance colour - its top its head's colour; popped, a dark crater
    const domeMat = new THREE.MeshStandardMaterial({ roughness: 0.36, metalness: 0, envMap: env, envMapIntensity: 0.55 });
    domeMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aHead;\nattribute float aPop;\nvarying vec3 vHead;\nvarying float vPop;\nvarying float vH;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHead = aHead;\nvPop = aPop;\nvH = position.z;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vHead;\nvarying float vPop;\nvarying float vH;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          // (its head a small cap at the very top - a whitehead - and the skin round it ripening toward it)
          float hd = smoothstep(0.86, 0.965, vH) * (1.0 - vPop), rp = smoothstep(0.62, 0.9, vH) * (1.0 - vPop);
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb, vHead, 0.35), rp * 0.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, vHead, hd);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.4, 0.22, 0.2), vPop * smoothstep(0.15, 0.85, vH));`,
        );
    };
    this.domeMat = domeMat;
    const haloMat = new THREE.MeshBasicMaterial({ map: blushTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    // the pus: creamy, a little glossy
    const blobMat = new THREE.MeshStandardMaterial({ roughness: 0.26, metalness: 0, envMap: env, envMapIntensity: 0.7 });
    const blobGeo = new THREE.IcosahedronGeometry(1, 2);
    const halo = new THREE.CircleGeometry(1, 32);
    this.back = { dome: mk(dome(), domeMat, MAXZ, false), halo: mk(halo, haloMat, MAXZ, false), blob: mk(blobGeo, blobMat, BLOBS, false) };
    this.front = { dome: mk(dome(), domeMat, MAXZ, true), halo: mk(halo, haloMat, MAXZ, true), blob: mk(blobGeo, blobMat, BLOBS, true) };
    for (const P of [this.back, this.front]) {
      P.halo.renderOrder = 1;
      P.dome.renderOrder = 2;
    }
    this.live = []; // (the zits on the cubes)
    this.blobs = []; // (the pus: flying, lying, in a worm)
    this.worms = [];
    this._sig = '';
    app.anchorProviders.push(() => this.live.flatMap((L) => L.anchors));
    // (re-cubed: all back, unpopped, the pus swept up)
    app.onHealEnd.push(() => this.reset());
  }

  // (all of them back as they came up, the pus gone)
  reset() {
    this._sig = '';
    this.blobs.length = 0;
    this.worms.length = 0;
  }

  // (each cube's zits, held on in the jelly as it is now - popped or not, as they were, if they were here before)
  _anchor(sb, cubes) {
    const old = new Map(this.live.map((L) => [L.key, L]));
    this.live = [];
    for (const cb of cubes) {
      const a = cb.style.acne;
      if (!a) continue;
      const k = cb.slot, s = sb.cSize[k] || 1, b = Math.min(0.45, (sb.cBevel[k] || 0) / s);
      const avoid = (cb.style.eyes || []).map((e) => [e.x, e.y, e.z, e.r]);
      const spots = zitSpots(a, b, avoid);
      spots.forEach((z, i) => {
        const key = `${k}:${a.seed}:${i}`, was = old.get(key);
        const L = this._hold(sb, k, z, s);
        Object.assign(L, { key, cb, i, red: new THREE.Color(a.red), head: new THREE.Color(a.head), pus: new THREE.Color(a.pus) });
        if (was) (L.popped = was.popped), (L.popT = was.popT), (L.charge = was.charge), (L.ok = was.ok), L.pos.copy(was.pos), L.n.copy(was.n);
        this.live.push(L);
      });
    }
  }

  // (one zit's three holds in the jelly: its middle, up it, across it - as an eye's)
  _hold(sb, k, z, s) {
    const n = [0, 0, 0], p = [z.x, z.y, z.z];
    // (which way out it faces there: out of the rounded cube's inner box)
    const h = 0.5 - Math.min(0.45, (sb.cBevel[k] || 0) / s), q = p.map((v) => Math.min(h, Math.max(-h, v)));
    let l = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    if (l > 1e-6) for (let i = 0; i < 3; i++) n[i] = (p[i] - q[i]) / l;
    else n[1] = 1;
    const { up, right } = eyeFrame(n), d = Math.max(0.02, z.r * 0.55);
    const at = (o) => {
      for (const sink of SINKS) {
        const P = p.map((v, i) => (v - n[i] * sink + o[i]) * s);
        const r = sb.locateRest(P[0] + k * REST_STEP, P[1], P[2]);
        if (r) return { tet: r.tet, b: r.bary, lost: false, sink: sink * s };
      }
      return { tet: -1, b: [0, 0, 0, 0], lost: true, sink: 0 };
    };
    return {
      k, anchors: [at([0, 0, 0]), at(up.map((v) => v * d)), at(right.map((v) => v * d))], arm: d * s, R: z.r * s,
      pos: new THREE.Vector3(), u: new THREE.Vector3(), v: new THREE.Vector3(), n: new THREE.Vector3(), su: 1, sv: 1,
      ok: false, popped: false, popT: -1, charge: 0, swell: 0, base: 0, calm: 1.5, key: '', cb: null, i: 0, red: null, head: null, pus: null,
    };
  }

  // (where it is this frame, which way it faces, how squashed: from its holds - false, its jelly's gone or cut
  // through under it)
  _place(sb, L) {
    const [a0, a1, a2] = L.anchors, P = [0, 0, 0], A = [0, 0, 0], B = [0, 0, 0];
    if (a0.lost || a1.lost || a2.lost || a0.tet < 0 || a1.tet < 0 || a2.tet < 0 || a0.tet >= sb.nT || a1.tet >= sb.nT || a2.tet >= sb.nT) return false;
    const tp = sb.tPiece;
    if (tp && (tp[a0.tet] !== tp[a1.tet] || tp[a0.tet] !== tp[a2.tet])) return false;
    sb.embedPoint(a0.tet, a0.b, P);
    sb.embedPoint(a1.tet, a1.b, A);
    sb.embedPoint(a2.tet, a2.b, B);
    _v.set(A[0] - P[0], A[1] - P[1], A[2] - P[2]);
    _u.set(B[0] - P[0], B[1] - P[1], B[2] - P[2]);
    const lu = _u.length(), lv = _v.length();
    if (!(lu > 1e-6 && lv > 1e-6)) return false;
    L.su = lu / L.arm;
    L.sv = lv / L.arm;
    L.u.copy(_u).multiplyScalar(1 / lu);
    L.v.copy(_v).addScaledVector(L.u, -L.u.dot(_v)).normalize();
    L.n.crossVectors(L.u, L.v);
    L.pos.set(P[0], P[1], P[2]).addScaledVector(L.n, a0.sink + LIFT * (sb.cSize[L.k] || 1));
    return true;
  }

  update(dt) {
    const app = this.app, sb = app.sb;
    let sig = sb.cubeVersion + '|';
    for (const cb of app.cubes) if (cb.style.acne) sig += `${cb.slot}:${JSON.stringify(cb.style.acne)};` + (cb.style.eyes || []).length;
    if (sig !== this._sig) {
      const fresh = !this._sig;
      this._sig = sig;
      this._anchor(sb, app.cubes);
      // (new zits - or all back after a re-cube: unpopped)
      if (fresh) for (const L of this.live) (L.popped = false), (L.charge = 0), (L.popT = -1);
    }
    const t = Math.min(dt, 1 / 20);
    // (the hands on the jelly: where each grabs - its held points' middle)
    const grabs = [];
    for (const g of sb.grabs) {
      let x = 0, y = 0, z = 0, w = 0;
      for (let j = 0; j < g.n; j++) {
        const i = g.idx[j], wt = g.wt[j];
        x += sb.x[i * 3] * wt; y += sb.x[i * 3 + 1] * wt; z += sb.x[i * 3 + 2] * wt; w += wt;
      }
      if (w > 0) grabs.push(new THREE.Vector3(x / w, y / w, z / w));
    }
    for (const L of this.live) {
      const was = L.ok;
      L.ok = this._place(sb, L);
      if (!L.ok) {
        // (its jelly gone, or cut through under it: an ooze, and it's gone)
        if (was && !L.popped) this._pop(L, 'lost');
        continue;
      }
      if (L.popped) {
        L.swell = Math.max(0, L.swell - t * 6);
        continue;
      }
      // squeezed: a finger on it, or the skin round it squashed
      let on = false;
      for (const p of grabs) if (p.distanceTo(L.pos) < L.R * 1.9 + 0.03) on = true;
      // (its squash against what it's been lately - over a second or so: a slump, settled, isn't a pinch. Not for a
      // moment after it's come up - a cube made again, landing - nor while a cube's being made again)
      const squash = Math.min(L.su, L.sv);
      if (!(L.base > 0)) L.base = squash;
      L.calm = app.healer?.active || app.swapper?.active ? 1.5 : Math.max(0, L.calm - t);
      const pinched = squash < L.base * SQUASH && L.calm <= 0;
      L.base += (squash - L.base) * (1 - Math.exp(-t / 1.2));
      if (on) L.charge += t / SQUEEZE;
      else if (pinched) L.charge += t * 5;
      else L.charge = Math.max(0, L.charge - t * 1.6);
      L.swell += (Math.min(1, L.charge) - L.swell) * Math.min(1, t * 14);
      if (L.charge >= 1) this._pop(L, 'squeeze');
    }
    if (t > 0) {
      this._worms(t, sb);
      this._blobs(t);
    }
    this._draw();
  }

  // A shot along o + t d (d unit), t up to tMax, r round it: the zits it passes through, popped - burst. How many.
  shot(o, d, tMax = 30, r = 0.02) {
    let n = 0;
    for (const L of this.live) {
      if (!L.ok || L.popped) continue;
      const qx = L.pos.x - o.x, qy = L.pos.y - o.y, qz = L.pos.z - o.z, tq = qx * d.x + qy * d.y + qz * d.z;
      if (tq < -L.R || tq > tMax + L.R) continue;
      const d2 = qx * qx + qy * qy + qz * qz - tq * tq, rr = r + L.R * 1.1;
      if (d2 > rr * rr) continue;
      this._pop(L, 'shot', d);
      n++;
    }
    return n;
  }

  // ...a hit at p (a nail, a mallet's blow): the zits within r of it
  hitAt(p, r = 0.03, d = null) {
    for (const L of this.live) if (L.ok && !L.popped && L.pos.distanceTo(p) < r + L.R) this._pop(L, 'shot', d);
  }

  // Popped: its pus out - a worm squeezed out, a spatter shot out, an ooze cut - and its crater left
  _pop(L, how, d = null) {
    L.popped = true;
    L.charge = 0;
    L.popT = performance.now();
    const app = this.app, n = L.n.clone(), p = L.pos.clone().addScaledVector(n, L.R * 0.45);
    app.audio?.zitPop?.(how, app.audio?._panOf?.(p) ?? 0, L.R / (app.sb.cSize[L.k] || 1));
    const col = L.pus, br = L.R * 0.3;
    if (how === 'squeeze') {
      // (out as a worm, a blob at a time - more of it the bigger it was)
      this.worms.push({ L, links: [], left: Math.round(5 + L.R * 220), every: 0.028, t: 0, hold: rnd(0.5, 0.9), on: true, r: br, col });
      // (a little spurt first)
      for (let k = 0; k < 3; k++) this._blob(p, n.clone().multiplyScalar(rnd(1.2, 2.2)).add(new THREE.Vector3(rnd(-0.4, 0.4), rnd(0, 0.5), rnd(-0.4, 0.4))), br * rnd(0.5, 0.8), col, L.k);
    } else if (how === 'shot') {
      // (a spatter: out of it, and on along the round's way)
      const m = Math.round(8 + L.R * 260);
      for (let k = 0; k < m; k++) {
        const v = n.clone().multiplyScalar(rnd(1.5, 4.5)).add(new THREE.Vector3(rnd(-1.6, 1.6), rnd(-0.6, 1.8), rnd(-1.6, 1.6)));
        if (d) v.addScaledVector(d, rnd(0.5, 3));
        this._blob(p, v, br * rnd(0.35, 0.9), col, L.k);
      }
    } else {
      for (let k = 0; k < 4; k++) this._blob(p, n.clone().multiplyScalar(rnd(0.3, 0.8)), br * rnd(0.5, 0.9), col, L.k);
    }
  }

  // (a blob of pus, flying)
  _blob(p, v, r, col, k) {
    if (this.blobs.length >= BLOBS) {
      // (the oldest lying on the floor makes room)
      let j = this.blobs.findIndex((b) => b.st === 1);
      if (j < 0) j = 0;
      this.blobs.splice(j, 1);
    }
    const b = { p: p.clone(), v: v.clone(), r, col: col.clone().offsetHSL(0, 0, rnd(-0.04, 0.04)), st: 0, t: 0, k, flat: 0, sq: rnd(0.85, 1.15), prev: null, nx: null };
    this.blobs.push(b);
    return b;
  }

  // The worms: squirming out of their zits a blob at a time (each new one at its root, the rest pushed out ahead of
  // it), sagging; then let go of, falling, and lying on the floor where they land - each link a blob of pus held to
  // the next (a chain: see _blobs)
  _worms(t, sb) {
    const g = sb.p.gravity;
    for (let w = this.worms.length - 1; w >= 0; w--) {
      const W = this.worms[w], L = W.L;
      W.t += t;
      if (W.on && !L.ok) W.on = false;
      const root = W.on ? L.pos.clone().addScaledVector(L.n, L.R * 0.35) : null;
      if (W.on && W.left > 0) {
        while (W.t >= W.every && W.left > 0) {
          W.t -= W.every;
          W.left--;
          const b = this._blob(root, L.n.clone().multiplyScalar(0.9), W.r * rnd(0.9, 1.1), W.col, L.k);
          b.st = 2;
          b.prev = root.clone().addScaledVector(L.n, -0.9 * W.every);
          W.links.unshift(b);
        }
      } else if (W.on) {
        W.hold -= t;
        if (W.hold <= 0) W.on = false;
      }
      // (the chain: each link falls, slowed, and is held its length from the next - the first held at the zit)
      for (const b of W.links) {
        if (b.st !== 2) continue;
        const px = b.p.x, py = b.p.y, pz = b.p.z, damp = Math.exp(-PUS_DRAG * 0.6 * t);
        b.p.x += (b.p.x - b.prev.x) * damp;
        b.p.y += (b.p.y - b.prev.y) * damp + g * t * t;
        b.p.z += (b.p.z - b.prev.z) * damp;
        b.prev.set(px, py, pz);
      }
      for (let it = 0; it < 4; it++) {
        if (W.on && W.links[0]) W.links[0].p.copy(root);
        for (let i = 0; i + 1 < W.links.length; i++) {
          const a = W.links[i], c = W.links[i + 1], seg = (a.r + c.r) * 0.36;
          const dx = c.p.x - a.p.x, dy = c.p.y - a.p.y, dz = c.p.z - a.p.z, l = Math.hypot(dx, dy, dz) || 1e-6, e = (l - seg) / l;
          const fa = a.st === 2 && !(W.on && i === 0) ? 0.5 : 0, fc = c.st === 2 ? 0.5 : 0, s = fa + fc;
          if (!(s > 0)) continue;
          a.p.x += dx * e * (fa / s); a.p.y += dy * e * (fa / s); a.p.z += dz * e * (fa / s);
          c.p.x -= dx * e * (fc / s); c.p.y -= dy * e * (fc / s); c.p.z -= dz * e * (fc / s);
        }
      }
      // (a link on the floor: it stays there, flattened)
      for (const b of W.links) {
        if (b.st === 2 && b.p.y < b.r * 0.45) {
          b.p.y = b.r * 0.45;
          b.st = 1;
          b.t = 0;
        }
      }
      // (all down - or a while gone: the rest let go as they are, to fall)
      if (!W.on && (W.links.every((b) => b.st !== 2) || W.t > 8)) {
        for (const b of W.links) if (b.st === 2) (b.st = 0), b.v.set((b.p.x - b.prev.x) / t, (b.p.y - b.prev.y) / t, (b.p.z - b.prev.z) / t);
        this.worms.splice(w, 1);
      }
    }
  }

  // the blobs flying: slowed by their own gloopiness, landing - a splat - and lying a while, then gone
  _blobs(t) {
    const g = this.app.sb.p.gravity, drag = Math.exp(-PUS_DRAG * t);
    for (let i = this.blobs.length - 1; i >= 0; i--) {
      const b = this.blobs[i];
      b.t += t;
      if (b.st === 0) {
        b.v.y += g * t;
        b.v.multiplyScalar(drag);
        b.p.addScaledVector(b.v, t);
        if (b.p.y < b.r * 0.45) {
          b.p.y = b.r * 0.45;
          b.st = 1;
          b.t = 0;
          // (splat: spread out flat - more, the harder it came down)
          b.flat = Math.min(1, -b.v.y / 3 + 0.4);
          if (-b.v.y > 2.2 && Math.random() < 0.35) this.app.audio?.pusSplat?.(Math.min(1, -b.v.y / 6), b.p);
        }
      } else if (b.st === 1 && b.t > FLOOR_LIFE) this.blobs.splice(i, 1);
    }
  }

  _draw() {
    const cam = this.app.camera.position, now = performance.now();
    const N = { back: 0, front: 0 };
    for (const L of this.live) {
      if (!L.ok) continue;
      const front = (cam.x - L.pos.x) * L.n.x + (cam.y - L.pos.y) * L.n.y + (cam.z - L.pos.z) * L.n.z > 0;
      const P = front ? this.front : this.back, i = front ? N.front : N.back;
      if (i >= MAXZ) continue;
      // (squeezed: swelling, up to a third bigger; just popped: deflating to a crater)
      const age = L.popped ? (now - L.popT) / 1000 : 0, gone = L.popped ? Math.min(1, age / 0.22) : 0;
      const sw = 1 + 0.32 * L.swell, hgt = L.popped ? 0.62 - 0.44 * gone : 0.62 * (1 + 0.55 * L.swell);
      const su = Math.min(1.5, Math.max(0.6, L.su)), sv = Math.min(1.5, Math.max(0.6, L.sv));
      _m.makeBasis(L.u, L.v, L.n).scale(_s.set(L.R * su * sw, L.R * sv * sw, L.R * hgt)).setPosition(L.pos);
      P.dome.setMatrixAt(i, _m);
      P.dome.setColorAt(i, L.red);
      const ha = P.dome.geometry.attributes.aHead, pa = P.dome.geometry.attributes.aPop;
      // (squeezed, its head comes up whiter)
      _c.copy(L.head).lerp(new THREE.Color(1, 1, 0.94), 0.35 * L.swell);
      ha.setXYZ(i, _c.r, _c.g, _c.b);
      pa.setX(i, gone);
      _m.makeBasis(L.u, L.v, L.n).scale(_s.set(L.R * 1.9 * su * sw, L.R * 1.9 * sv * sw, 1)).setPosition(_p.copy(L.pos).addScaledVector(L.n, -0.0005));
      P.halo.setMatrixAt(i, _m);
      P.halo.setColorAt(i, L.red);
      if (front) N.front++;
      else N.back++;
    }
    for (const [key, P] of [['back', this.back], ['front', this.front]]) {
      P.dome.count = P.halo.count = N[key];
      for (const m of [P.dome, P.halo]) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
      P.dome.geometry.attributes.aHead.needsUpdate = true;
      P.dome.geometry.attributes.aPop.needsUpdate = true;
    }
    // the pus: in front of a cube (on the camera's side of its middle) drawn after its jelly, the rest with the room
    const sb = this.app.sb, mid = [];
    for (const pc of sb.pieces) if (pc && (!mid[pc.cube] || pc.verts.length > mid[pc.cube].n)) mid[pc.cube] = { c: pc.com, n: pc.verts.length };
    // (a worm's links: each stretched out toward the next - a rope of it, not beads on a string)
    for (const W of this.worms) for (let i = 0; i < W.links.length; i++) W.links[i].nx = W.links[i + 1] || W.links[i - 1] || null;
    const B = { back: 0, front: 0 };
    for (const b of this.blobs) {
      const m = mid[b.k];
      const front = !m || (cam.x - m.c[0]) * (b.p.x - m.c[0]) + (cam.y - m.c[1]) * (b.p.y - m.c[1]) + (cam.z - m.c[2]) * (b.p.z - m.c[2]) > 0;
      const P = front ? this.front : this.back, i = front ? B.front : B.back;
      if (i >= BLOBS) continue;
      // (lying: flattened out on the floor, more the harder it landed - and shrinking away at the end)
      const fade = b.st === 1 ? Math.min(1, Math.max(0, (FLOOR_LIFE - b.t) / 1.5)) : 1;
      const fl = b.st === 1 ? 0.3 + 0.25 * (1 - b.flat) : 1, wide = b.st === 1 ? 1.25 + 0.45 * b.flat : b.sq;
      _q.set(0, 0, 0, 1);
      let stretch = 1;
      if (b.st === 2 && b.nx) {
        _u.subVectors(b.nx.p, b.p);
        const l = _u.length();
        if (l > 1e-5) (_q.setFromUnitVectors(_v.set(0, 1, 0), _u.multiplyScalar(1 / l))), (stretch = Math.min(2.2, 1 + (0.9 * l) / b.r));
      }
      _m.compose(b.p, _q, _s.set(b.r * wide * fade, b.r * fl * fade * stretch, b.r * wide * fade));
      P.blob.setMatrixAt(i, _m);
      P.blob.setColorAt(i, b.col);
      if (front) B.front++;
      else B.back++;
    }
    for (const [key, P] of [['back', this.back], ['front', this.front]]) {
      P.blob.count = B[key];
      P.blob.instanceMatrix.needsUpdate = true;
      if (P.blob.instanceColor) P.blob.instanceColor.needsUpdate = true;
    }
  }

  // (all of it shown for App.warmUp's drawing - its shaders compiled then - and put back by what it returns)
  warmShow() {
    const was = [];
    for (const P of [this.back, this.front]) for (const m of [P.dome, P.halo, P.blob]) if (!m.count) (m.count = 1), was.push(m);
    return () => {
      for (const m of was) m.count = 0;
    };
  }
}
