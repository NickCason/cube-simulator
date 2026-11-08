import * as THREE from 'three';

// Strings of goo. Where gummy jelly is torn apart, strands of it stretch
// across the opening; where it melts, it drips on a string. Each strand is
// a short rope of points:
// - its ends are held to the jelly (a vertex each) - or, for a drip, the far
//   end is a heavy blob, free to fall;
// - in between it sags under gravity;
// - it's viscous: its segments' rest lengths creep toward how long they
//   are, so it stays drawn out rather than springing back - more so the
//   gooier it is;
// - it keeps its volume, so it thins as it lengthens, most in the middle.
// Drawn out past its length it pinches off there:
// - the two stubs shrink back into the jelly;
// - a drip's blob falls on as molten jelly (see Fluid).
// Drawn as the jelly is: smooth tubes of it, after the jelly, the room and
// the jelly behind seen through them - bent by them, coloured as much as
// light crossing that much of it is (each end its own colour: the jelly's
// where it joins, gradients and all - thin strands pale, thick ones deep,
// as the jelly's thin edges are), milky for milky stuff; the room mirrored
// in their skin, the key light's glint. Each end swells into a meniscus
// where it joins - sunk a little into the jelly, so it rises out of it.

import { absorptionFromColor } from '../render/jellyMaterials.js';
import { CUBE_TEX_W } from '../render/jellyView.js';

const NODES = 9; // points along a strand
const RING = 12; // vertices round the tube
const SUBR = 4; // rings per segment (a smooth curve through the points)
const MAX = 64; // strands at once
const RINGS = (NODES - 1) * SUBR + 1;
// (how much more a strand's colour than light through that much jelly: a
// strand a few mm across all but vanished)
const DEEPEN = 2.5;

export class Strands {
  constructor(app) {
    this.app = app;
    this.list = [];
    const nv = MAX * RINGS * RING;
    this.pos = new Float32Array(nv * 3);
    this.nrm = new Float32Array(nv * 3);
    const idx = new Uint32Array(MAX * (RINGS - 1) * RING * 6);
    let w = 0;
    for (let s = 0; s < MAX; s++) {
      const base = s * RINGS * RING;
      for (let r = 0; r < RINGS - 1; r++)
        for (let k = 0; k < RING; k++) {
          const a = base + r * RING + k, b = base + r * RING + ((k + 1) % RING), c = a + RING, d = b + RING;
          // (wound so the outside faces out)
          idx[w++] = a; idx[w++] = b; idx[w++] = c;
          idx[w++] = b; idx[w++] = d; idx[w++] = c;
        }
    }
    const geo = new THREE.BufferGeometry();
    this.abs = new Float32Array(nv * 3); // (each ring's absorption, 1/m)
    this.scat = new Float32Array(nv * 4); // (its scattered colour, and how milky)
    this.thick = new Float32Array(nv); // (how thick it is there, m)
    this.fade = new Float32Array(nv); // (0 where it rises out of the jelly .. 1 clear of it)
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aNrm = new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage);
    this.aAbs = new THREE.BufferAttribute(this.abs, 3).setUsage(THREE.DynamicDrawUsage);
    this.aScat = new THREE.BufferAttribute(this.scat, 4).setUsage(THREE.DynamicDrawUsage);
    this.aThick = new THREE.BufferAttribute(this.thick, 1).setUsage(THREE.DynamicDrawUsage);
    this.aFade = new THREE.BufferAttribute(this.fade, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('normal', this.aNrm);
    geo.setAttribute('aAbs', this.aAbs);
    geo.setAttribute('aScat', this.aScat);
    geo.setAttribute('aThick', this.aThick);
    geo.setAttribute('aFade', this.aFade);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    // (the jelly's own room, light and glow)
    const F = app.jelly.frontMat.uniforms;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tBg: { value: null }, // (the room with the jelly in it: App's rtTrans, copied after the jelly)
        uInvRes: { value: new THREE.Vector2(1, 1) },
        envMap: F.envMap,
        envMaxLod: F.envMaxLod,
        envIntensity: F.envIntensity,
        uLightDir: F.uLightDir,
        uLightColor: F.uLightColor,
        uGlow: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aAbs;
        attribute vec4 aScat;
        attribute float aThick;
        attribute float aFade;
        varying vec3 vN;
        varying vec3 vW;
        varying vec3 vAbs;
        varying vec4 vScat;
        varying float vThick;
        varying float vFade;
        void main() {
          vFade = aFade;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          vN = mat3(modelMatrix) * normal;
          vAbs = aAbs;
          vScat = aScat;
          vThick = aThick;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tBg;
        uniform vec2 uInvRes;
        uniform samplerCube envMap;
        uniform float envMaxLod;
        uniform float envIntensity;
        uniform vec3 uLightDir;
        uniform vec3 uLightColor;
        uniform float uGlow;
        varying vec3 vN;
        varying vec3 vW;
        varying vec3 vAbs;
        varying vec4 vScat;
        varying float vThick;
        varying float vFade;
        void main() {
          vec3 V = normalize(cameraPosition - vW), N = normalize(vN);
          if (dot(N, V) < 0.0) N = -N;
          float ndv = clamp(dot(N, V), 0.0, 1.0);
          // the room through it - bent by it, a little lens; as much of the
          // jelly's colour as the light crosses (round: the most across its
          // middle, little at its edges)
          vec3 Nv = normalize((viewMatrix * vec4(N, 0.0)).xyz);
          vec2 uv = gl_FragCoord.xy * uInvRes - Nv.xy * (1.0 - ndv) * clamp(vThick * 0.5, 0.002, 0.012);
          vec3 bg = textureLod(tBg, clamp(uv, vec2(0.001), vec2(0.999)), 0.0).rgb;
          float path = vThick * (0.35 + 0.65 * ndv);
          vec3 T = exp(-vAbs * path);
          vec3 L = normalize(uLightDir);
          // (milky: the light scattered inside it, lit as the jelly is)
          vec3 amb = textureLod(envMap, N, envMaxLod * 0.8).rgb * envIntensity;
          vec3 milk = vScat.rgb * (amb * 0.7 + uLightColor * (max(dot(N, L), 0.0) * 0.35 + 0.08)) * mix(vec3(1.0), T, 0.5);
          // (a strand of it scatters a little more than the clear body: drawn
          // out, it clouds - as stretched gummy and torn slime do)
          vec3 body = mix(bg * T, milk, max(vScat.a, 0.18));
          // the skin: the room mirrored in it, wet - and the key light's glint
          float F = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
          vec3 refl = textureLod(envMap, reflect(-V, N), envMaxLod * 0.05).rgb * envIntensity;
          vec3 H = normalize(L + V);
          float spec = pow(max(dot(N, H), 0.0), 160.0) * 6.0 + pow(max(dot(N, H), 0.0), 24.0) * 0.12;
          vec3 col = body * (1.0 - F) + refl * F + uLightColor * spec;
          // (glow mode: it shines its colour, as the jelly does)
          col += vScat.rgb * uGlow * (0.6 + 0.4 * (1.0 - T.g));
          // (where it rises out of the jelly, it is the jelly: it melts into
          // the surface behind it, no edge where the two meet)
          col = mix(textureLod(tBg, gl_FragCoord.xy * uInvRes, 0.0).rgb, col, vFade);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // (drawn after the jelly, over what's behind it - it sees the jelly through itself)
    this.mesh.renderOrder = -2;
    app.fxScene.add(this.mesh);
    if (app.size?.pw) this.mat.uniforms.uInvRes.value.set(1 / app.size.pw, 1 / app.size.ph);
    this._c = new THREE.Vector3();
    app.onHealStart?.push(() => this.clear());
  }

  setGlow(e) {
    this.mat.uniforms.uGlow.value = e;
  }

  // (the jelly's look where vertex i is: its absorption (1/m, deepened -
  // see DEEPEN), the colour it scatters, how milky - from its cube's looks)
  _optics(i) {
    const app = this.app, sb = app.sb, k = sb.vCube[i] | 0, D = app.jelly.cubeData, r = k * CUBE_TEX_W * 4;
    const ref = 1 / Math.max(D[r + 28 * 4], 1e-3), c = this._col || (this._col = new THREE.Color());
    c.set(app.flavorColorAtVertex(i));
    const a = absorptionFromColor(c, ref, this._abs || (this._abs = new THREE.Vector3()));
    const haze = Math.max(D[r + 7], 0.8 * D[r + 3 * 4 + 1]);
    return [a.x * DEEPEN, a.y * DEEPEN, a.z * DEEPEN, D[r + 4], D[r + 5], D[r + 6], Math.min(0.92, haze)];
  }

  clear() {
    this.list.length = 0;
    this.geo.setDrawRange(0, 0);
    this.mesh.visible = false;
  }

  // A strand from jelly vertex a to jelly vertex b - or, b = -1, a drip
  // hanging from a with a blob of tipVol (m^3) of goo at its end - of goo
  // g (0..1: how stringy - see the setting), coloured col ([r, g, b]).
  add(a, b, g, col, tipVol = 0) {
    const sb = this.app.sb, x = sb.x, size = sb.p.size;
    if (this.list.length >= MAX) this.list.shift();
    const p = new Float32Array(NODES * 3), q = new Float32Array(NODES * 3);
    const ax = x[a * 3], ay = x[a * 3 + 1], az = x[a * 3 + 2];
    const bx = b >= 0 ? x[b * 3] : ax, by = b >= 0 ? x[b * 3 + 1] : ay - 0.02 * size, bz = b >= 0 ? x[b * 3 + 2] : az;
    for (let n = 0; n < NODES; n++) {
      const u = n / (NODES - 1);
      p[n * 3] = ax + (bx - ax) * u; p[n * 3 + 1] = ay + (by - ay) * u; p[n * 3 + 2] = az + (bz - az) * u;
    }
    q.set(p);
    const L0 = Math.hypot(bx - ax, by - ay, bz - az);
    const rest = new Float32Array(NODES - 1).fill(Math.max(1e-3, L0 / (NODES - 1)));
    // thickness: so much goo that it's r0 thick when 15% of the cube long
    const r0 = (0.012 + 0.03 * g) * size;
    const oa = this._optics(a), ob = b >= 0 ? this._optics(b) : oa;
    this.list.push({
      a, b, p, q, rest, col, oa, ob,
      vol: Math.PI * r0 * r0 * 0.15 * size,
      tip: tipVol, // (a drip's blob)
      flow: 0.5 + 4 * g, // (1/s) how fast it gives in to being stretched
      // drawn out past this, it pinches (a drip sooner: its blob's weight)
      maxL: (b >= 0 ? 0.08 + 0.45 * g : 0.1 + 0.3 * g) * size,
      fade: 0, // >0: a stub shrinking back (s left)
      age: 0,
    });
    this.mesh.visible = true;
  }

  update(dt) {
    if (!this.list.length || !(dt > 0)) return;
    const sb = this.app.sb, x = sb.x, alive = sb.alive, g = sb.p.gravity ?? -22, size = sb.p.size;
    const SUB = 3, h = dt / SUB, damp = Math.exp(-2.5 * h);
    const out = [];
    for (const s of this.list) {
      s.age += dt;
      const p = s.p, q = s.q, rest = s.rest;
      const holdA = s.a >= 0 && alive[s.a], holdB = s.b >= 0 && alive[s.b];
      // (a stub: its goo drains back, it shortens)
      if (s.fade > 0) {
        s.fade -= dt;
        const k = Math.exp(-dt * 9);
        for (let i = 0; i < NODES - 1; i++) rest[i] *= k;
        s.vol *= Math.exp(-dt * 2);
        if (s.fade <= 0) continue;
      } else {
        // viscous: the rest lengths creep toward the stretch
        const f = 1 - Math.exp(-dt * s.flow);
        let len = 0;
        for (let i = 0; i < NODES - 1; i++) {
          const o = i * 3, d = Math.hypot(p[o + 3] - p[o], p[o + 4] - p[o + 1], p[o + 5] - p[o + 2]);
          rest[i] += (d - rest[i]) * f;
          len += d;
        }
        // ...but a slack one - its ends come back together - draws itself in
        // (surface tension): shorter and thicker, back toward the jelly, not
        // hanging in a loop
        if (s.b >= 0 && holdA && holdB) {
          const o = (NODES - 1) * 3, chord = Math.hypot(p[o] - p[0], p[o + 1] - p[1], p[o + 2] - p[2]), slack = len / Math.max(chord, 1e-4);
          if (slack > 1.12) {
            const k = Math.exp(-dt * 3.5 * Math.min(3, slack - 1.12));
            for (let i = 0; i < NODES - 1; i++) rest[i] *= k;
          }
        }
      }
      // (a blob at a free end weighs more: it pulls the strand out)
      const wTip = s.b < 0 && s.tip > 0 ? 0.25 : 1;
      for (let st = 0; st < SUB; st++) {
        for (let n = 0; n < NODES; n++) {
          const o = n * 3;
          if ((n === 0 && holdA) || (n === NODES - 1 && holdB)) continue;
          const vx = (p[o] - q[o]) * damp, vy = (p[o + 1] - q[o + 1]) * damp, vz = (p[o + 2] - q[o + 2]) * damp;
          q[o] = p[o]; q[o + 1] = p[o + 1]; q[o + 2] = p[o + 2];
          p[o] += vx; p[o + 1] += vy + g * h * h; p[o + 2] += vz;
        }
        if (holdA) { p[0] = x[s.a * 3]; p[1] = x[s.a * 3 + 1]; p[2] = x[s.a * 3 + 2]; }
        if (holdB) { const o = (NODES - 1) * 3; p[o] = x[s.b * 3]; p[o + 1] = x[s.b * 3 + 1]; p[o + 2] = x[s.b * 3 + 2]; }
        for (let it = 0; it < 3; it++)
          for (let i = 0; i < NODES - 1; i++) {
            const o = i * 3;
            const w0 = i === 0 && holdA ? 0 : 1, w1 = i === NODES - 2 ? (holdB ? 0 : wTip) : 1;
            if (!(w0 + w1)) continue;
            const dx = p[o + 3] - p[o], dy = p[o + 4] - p[o + 1], dz = p[o + 5] - p[o + 2];
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
            const c = ((d - rest[i]) / d) * 0.7 / (w0 + w1);
            p[o] += dx * c * w0; p[o + 1] += dy * c * w0; p[o + 2] += dz * c * w0;
            p[o + 3] -= dx * c * w1; p[o + 4] -= dy * c * w1; p[o + 5] -= dz * c * w1;
          }
        // (the floor; nothing below it)
        for (let n = 0; n < NODES; n++) {
          const o = n * 3;
          if (p[o + 1] < 0.004) {
            p[o + 1] = 0.004;
            q[o] = p[o]; q[o + 2] = p[o + 2];
          }
        }
      }
      // its pull on the jelly it's joined to: each held end draws its vertex
      // out along it, the more the thicker and tauter it is - the surface
      // round it drawn up in a cone, the strand rising out of the jelly, not
      // stuck on it (capped: a gentle tug, never a spike)
      if (s.fade <= 0) {
        const thick2 = s.vol / Math.max(1e-4, s.len || 1e-4);
        for (const [hold, vi, n0, n1] of [[holdA, s.a, 0, 1], [holdB, s.b, NODES - 1, NODES - 2]]) {
          if (!hold) continue;
          const o0 = n0 * 3, o1 = n1 * 3, dx = p[o1] - p[o0], dy = p[o1 + 1] - p[o0 + 1], dz = p[o1 + 2] - p[o0 + 2];
          const d = Math.hypot(dx, dy, dz), rl = rest[Math.min(n0, n1)];
          if (!(d > rl)) continue;
          const pull = Math.min(1.2, (d / rl - 1) * 0.6) * Math.min(1, thick2 / (0.0015 * size * size)), dv = pull * dt * 16 * size;
          const v = sb.v;
          v[vi * 3] += (dx / d) * dv; v[vi * 3 + 1] += (dy / d) * dv; v[vi * 3 + 2] += (dz / d) * dv;
          sb.wake(sb.vPiece[vi]);
        }
      }
      // drawn out too far - or thinner than a hair - it pinches off in the middle
      let L = 0;
      for (let i = 0; i < NODES - 1; i++) {
        const o = i * 3;
        L += Math.hypot(p[o + 3] - p[o], p[o + 4] - p[o + 1], p[o + 5] - p[o + 2]);
      }
      s.len = L;
      // (a drip's blob that's landed lets go of its string)
      const landed = s.b < 0 && s.tip > 0 && p[(NODES - 1) * 3 + 1] < Math.cbrt((3 * s.tip) / (4 * Math.PI)) + 0.012;
      if (s.fade <= 0 && (L > s.maxL || landed || (!holdA && !holdB && s.b >= 0))) {
        this._pinch(s, out);
        continue;
      }
      // (a held end let go - its vertex gone: it shrinks away)
      if (s.fade <= 0 && s.a >= 0 && !holdA) s.fade = 0.3;
      out.push(s);
    }
    this.list = out;
    this._draw(size);
  }

  // Pinched off: two stubs, each drawing back into its end; a drip's blob
  // falls on, into the molten jelly.
  _pinch(s, out) {
    const m = (NODES - 1) >> 1, app = this.app;
    if (s.b < 0) {
      const o = (NODES - 1) * 3, p = s.p;
      if (s.tip > 0 && app.fluid) {
        const vx = (p[o] - s.q[o]) * 60, vy = (p[o + 1] - s.q[o + 1]) * 60, vz = (p[o + 2] - s.q[o + 2]) * 60;
        app.fluid.add(p[o], p[o + 1], p[o + 2], s.tip, vx * 0.3, vy * 0.3, vz * 0.3, s.col[0], s.col[1], s.col[2], 0.004);
      }
      s.fade = 0.35;
      s.b = -1;
      s.tip = 0;
      for (let i = 0; i < NODES - 1; i++) s.rest[i] = Math.min(s.rest[i], 0.3 * s.len / (NODES - 1));
      out.push(s);
      return;
    }
    // two stubs: the a end keeps the first half, the b end the second - each
    // a strand from its end out to a free tip, shrinking back
    const halfA = this._stub(s, 0, m), halfB = this._stub(s, NODES - 1, m);
    if (halfA) out.push(halfA);
    if (halfB) out.push(halfB);
    app.audio?.squish?.(0.12, 1.6);
  }

  // (a stub: the part of s from its end e to node m, as a strand of its own
  // - held at that end, free at the other)
  _stub(s, e, m) {
    const p = new Float32Array(NODES * 3), q = new Float32Array(NODES * 3);
    const from = e === 0 ? 0 : NODES - 1, to = m, end = e === 0 ? s.a : s.b;
    for (let n = 0; n < NODES; n++) {
      const u = n / (NODES - 1), f = from + (to - from) * u, i0 = Math.floor(f), i1 = Math.min(NODES - 1, i0 + 1), t = f - i0;
      for (let c = 0; c < 3; c++) {
        p[n * 3 + c] = s.p[i0 * 3 + c] + (s.p[i1 * 3 + c] - s.p[i0 * 3 + c]) * t;
        q[n * 3 + c] = s.q[i0 * 3 + c] + (s.q[i1 * 3 + c] - s.q[i0 * 3 + c]) * t;
      }
    }
    const half = (s.len || 0) / 2 / (NODES - 1);
    const o = e === 0 ? s.oa : s.ob;
    return { a: end, b: -1, p, q, rest: new Float32Array(NODES - 1).fill(half * 0.6), col: s.col, oa: o, ob: o, vol: s.vol / 2, tip: 0, flow: s.flow, maxL: Infinity, fade: 0.3, age: 0, len: s.len / 2 };
  }

  // The tubes: a smooth curve through each strand's points (Catmull-Rom),
  // rings round it: necked in the middle (volume kept: thinner the longer it
  // is), each held end swelling into a meniscus and sunk a little into the
  // jelly, so it rises out of it; a free end rounds off, or swells into its
  // blob. Each ring its look, from one end's to the other's.
  _draw(size) {
    const pos = this.pos, nrm = this.nrm, abs = this.abs, scat = this.scat, thick = this.thick;
    const P = new Float32Array(RINGS * 3), Tn = new Float32Array(RINGS * 3), Rr = new Float32Array(RINGS);
    let sIdx = 0;
    for (const s of this.list) {
      const p = s.p, L = Math.max(s.len || 0, 1e-3);
      // the curve
      for (let r = 0; r < RINGS; r++) {
        const seg = Math.min(NODES - 2, Math.floor(r / SUBR)), t = r / SUBR - seg;
        const i0 = Math.max(0, seg - 1), i1 = seg, i2 = seg + 1, i3 = Math.min(NODES - 1, seg + 2);
        for (let c = 0; c < 3; c++) {
          const a0 = p[i0 * 3 + c], a1 = p[i1 * 3 + c], a2 = p[i2 * 3 + c], a3 = p[i3 * 3 + c];
          P[r * 3 + c] = 0.5 * (2 * a1 + (-a0 + a2) * t + (2 * a0 - 5 * a1 + 4 * a2 - a3) * t * t + (-a0 + 3 * a1 - 3 * a2 + a3) * t * t * t);
        }
      }
      // tangents, and the radius along it
      // (as thick as its goo makes it - but just opened, a strand's short: a
      // fat bridge, no thicker than about its length, sunk in the gap)
      const freeB = s.b < 0, heldA = s.a >= 0, tipR = s.tip > 0 ? Math.cbrt((3 * s.tip) / (4 * Math.PI)) : 0;
      const rm = Math.min(Math.sqrt(s.vol / (Math.PI * L)), 0.35 * L + 0.002 * size);
      // (the meniscus: over a stretch a few times its own thickness; its
      // ends face the jelly they join, along the line from one to the other
      // - the curve's own slope there tipped them out sideways, collars)
      const fl = Math.min(0.32, (3 * rm) / L), flare = Math.min(0.5 * rm, 0.3 * L);
      let cx = P[(RINGS - 1) * 3] - P[0], cy = P[(RINGS - 1) * 3 + 1] - P[1], cz = P[(RINGS - 1) * 3 + 2] - P[2];
      const cl = Math.hypot(cx, cy, cz) || 1;
      cx /= cl; cy /= cl; cz /= cl;
      for (let r = 0; r < RINGS; r++) {
        const a = Math.max(0, r - 1), b = Math.min(RINGS - 1, r + 1);
        let tx = P[b * 3] - P[a * 3], ty = P[b * 3 + 1] - P[a * 3 + 1], tz = P[b * 3 + 2] - P[a * 3 + 2];
        const u = r / (RINGS - 1), e = Math.abs(2 * u - 1);
        const ma = heldA ? Math.max(0, 1 - u / fl) : 0, mb = freeB ? 0 : Math.max(0, 1 - (1 - u) / fl);
        const tl = Math.hypot(tx, ty, tz) || 1, wc = cl > 1e-4 ? Math.max(ma, mb) : 0;
        tx = tx / tl + (cx - tx / tl) * wc; ty = ty / tl + (cy - ty / tl) * wc; tz = tz / tl + (cz - tz / tl) * wc;
        const tl2 = Math.hypot(tx, ty, tz) || 1;
        Tn[r * 3] = tx / tl2; Tn[r * 3 + 1] = ty / tl2; Tn[r * 3 + 2] = tz / tl2;
        let rad = rm * (0.62 + 0.38 * e * e);
        rad += flare * (ma * ma + mb * mb);
        if (freeB) {
          // a free end: rounded off - or swelling into its blob
          const v = 1 - u;
          if (tipR > 0) rad = Math.max(rad * (0.4 + 0.6 * Math.min(1, v * 4)), tipR * Math.sqrt(Math.max(0, 1 - ((u - 0.9) / 0.1) ** 2)));
          else rad *= Math.sqrt(Math.min(1, v * 6));
        }
        if (s.fade > 0) rad *= Math.min(1, s.fade / 0.3) ** 0.5;
        // (never thinner than a few mm while it's whole: a hair reads as a wire)
        Rr[r] = Math.min(Math.max(rad, s.fade > 0 || freeB ? 0 : 0.003 * size), 0.07 * size);
      }
      // (held ends sunk well into the jelly - their thickness and more: the
      // strand rises out of it, from the cone its pull draws up - see update)
      const sink = 1.1 * rm + 0.012 * size;
      if (heldA) for (let c = 0; c < 3; c++) P[c] -= Tn[c] * sink;
      if (!freeB) {
        const o = (RINGS - 1) * 3;
        for (let c = 0; c < 3; c++) P[o + c] += Tn[o + c] * sink;
      }
      // rings (a frame carried along the curve, so the tube doesn't twist)
      let nx = 0, ny = 1, nz = 0;
      {
        const tx = Tn[0], ty = Tn[1], tz = Tn[2];
        if (Math.abs(ty) > 0.9) { nx = 1; ny = 0; }
        const dt = nx * tx + ny * ty + nz * tz;
        nx -= tx * dt; ny -= ty * dt; nz -= tz * dt;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
      }
      // (each ring's distance along it from each end, for where it leaves the jelly)
      const arc = this._arc || (this._arc = new Float32Array(RINGS));
      arc[0] = 0;
      for (let r = 1; r < RINGS; r++) arc[r] = arc[r - 1] + Math.hypot(P[r * 3] - P[r * 3 - 3], P[r * 3 + 1] - P[r * 3 - 2], P[r * 3 + 2] - P[r * 3 - 1]);
      const tot = arc[RINGS - 1], emerge = Math.min(0.6 * rm + 0.004 * size, 0.15 * tot);
      const base = sIdx * RINGS * RING, A = s.oa, B = s.ob;
      for (let r = 0; r < RINGS; r++) {
        const tx = Tn[r * 3], ty = Tn[r * 3 + 1], tz = Tn[r * 3 + 2];
        // (carry the normal along: take out its part along the new tangent)
        const dt = nx * tx + ny * ty + nz * tz;
        nx -= tx * dt; ny -= ty * dt; nz -= tz * dt;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
        // (its look here: one end's to the other's)
        const u = r / (RINGS - 1), w = u * u * (3 - 2 * u);
        const ar = A[0] + (B[0] - A[0]) * w, ag = A[1] + (B[1] - A[1]) * w, ab = A[2] + (B[2] - A[2]) * w;
        const sr = A[3] + (B[3] - A[3]) * w, sg = A[4] + (B[4] - A[4]) * w, sbb = A[5] + (B[5] - A[5]) * w, hz = A[6] + (B[6] - A[6]) * w;
        const fa = heldA ? Math.min(1, Math.max(0, (arc[r] - sink) / emerge)) : 1, fb = freeB ? 1 : Math.min(1, Math.max(0, (tot - arc[r] - sink) / emerge));
        // (never all the way: seen side on, against the room behind, a root
        // melted away left the strand hanging off nothing)
        const fd0 = Math.min(fa, fb), fd = 0.4 + 0.6 * fd0 * fd0 * (3 - 2 * fd0);
        // (the slope of its radius tilts its normals: a meniscus faces up out of the jelly)
        const rp = Rr[Math.min(RINGS - 1, r + 1)] - Rr[Math.max(0, r - 1)], sl = rp / Math.max(1e-6, (2 * L) / (RINGS - 1));
        for (let k = 0; k < RING; k++) {
          const th = (k / RING) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
          const ox = nx * c + bx * sn, oy = ny * c + by * sn, oz = nz * c + bz * sn;
          const v = base + r * RING + k, o = v * 3;
          pos[o] = P[r * 3] + ox * Rr[r]; pos[o + 1] = P[r * 3 + 1] + oy * Rr[r]; pos[o + 2] = P[r * 3 + 2] + oz * Rr[r];
          const qx = ox - tx * sl, qy = oy - ty * sl, qz = oz - tz * sl, ql = Math.hypot(qx, qy, qz) || 1;
          nrm[o] = qx / ql; nrm[o + 1] = qy / ql; nrm[o + 2] = qz / ql;
          abs[o] = ar; abs[o + 1] = ag; abs[o + 2] = ab;
          scat[v * 4] = sr; scat[v * 4 + 1] = sg; scat[v * 4 + 2] = sbb; scat[v * 4 + 3] = hz;
          thick[v] = 2 * Rr[r];
          this.fade[v] = fd;
        }
      }
      sIdx++;
    }
    this.geo.setDrawRange(0, sIdx * (RINGS - 1) * RING * 6);
    const nv = sIdx * RINGS * RING;
    for (const [a, n] of [[this.aPos, 3], [this.aNrm, 3], [this.aAbs, 3], [this.aScat, 4], [this.aThick, 1], [this.aFade, 1]]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, nv * n);
      a.needsUpdate = true;
    }
    this.mesh.visible = sIdx > 0;
  }
}
