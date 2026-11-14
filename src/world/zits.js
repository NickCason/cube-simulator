// Zits on the jelly (a cube's acne: see acne.js) - each a mound of its skin drawn up tight round an angry bump (its
// red - or, blended, the cube's own colour where it comes up), a head at its top (whitehead, yellow, green, black),
// its foot easing out into the jelly round it with no edge to it. Held on at three points in the jelly like the
// googly eyes (see world/eyes.js): it rides the wobble, tips and squashes with the skin under it - and on a rounded
// edge or corner it bends round it as the cube does (see MOUND_VERT). Popped:
// - squeezed: a finger held on it (a hand's grab there - SQUEEZE s, it swelling and whitening as it goes), or the
//   jelly round it squashed (two fingers pinching it, the mallet, a cube landing on it): its pus comes out as a worm,
//   squirming out of it a blob at a time, sagging, then dropping off
// - shot (the guns: see shot) - its pus bursts out in a spatter
// - cut through, or its jelly gone (melted, eaten, bored out): it oozes a little, and is gone
// ...and it's left a dark crater. A cube full of liquid squeezed (or struck) at one squirts some of its liquid out
// after the pus (see _squirt). The pus: thick, its own colour, creamy - blobs that fly slow (a gloopy drag); on a
// cube they stick, creep down its sides and drip off its bottom (see _land, _stuck); on the floor they splat flat -
// and lie there a while. A re-cube brings the zits all back, unpopped; the pus is swept up.

import * as THREE from 'three';
import { REST_STEP, MAX_CUBES, polarRot } from '../sim/softbody.js';
import { eyeFrame, onSurface } from '../eyes.js';
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
const FLOOR_LIFE = 30; // (s pus lies where it landed - the floor, a cube)
// Its mound: the skin drawn up round it out to RHO of its radii, its height exp(-(r/MW)^MP) of its peak's - a dome
// easing out into the skin round it. (A hemisphere stood on the skin, its edge hard, was a button stuck on - and flat
// across a rounded edge, its rim standing off it)
const RHO = 2.2, MW = 0.95, MP = 2.4;
const BODY_A = 0.9, BLEND_A = 0.78; // (its body's opacity: the jelly seen through it a little - more when blended)
const SHEEN = 0.7; // (its gloss out over its foot, where its colour's faded: the skin pulled tight there shines)
// Pus on a cube: creeping down its sides - m/s down a wall, slower the less steep - and dripping off where its skin
// faces down this much
const CREEP = 0.045, DRIP_Y = -0.45;
const PUS_SINKS = [0.006, 0.02, 0.05]; // (how far under the skin pus on it is held: shares of the side)
const SQUIRT_EVERY = 0.07; // (s: a cube full of liquid squeezed at a zit - a drop of its liquid out of it each)

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _c = new THREE.Color(), _w = new THREE.Color(1, 1, 0.94);
const UP = new THREE.Vector3(0, 1, 0);
const rnd = (a, b) => a + Math.random() * (b - a);
const g4 = (v) => v.toFixed(4);

// (x, y, z - a cube of side 1 from its middle, its edges rounded to b - onto its skin: out the point there, out.n its
// facing. As eyes.js onSurface, into out: pus creeping on a cube does it many times a second)
function onBox(x, y, z, b, out) {
  const h = 0.5 - b, qx = Math.min(h, Math.max(-h, x)), qy = Math.min(h, Math.max(-h, y)), qz = Math.min(h, Math.max(-h, z));
  let dx = x - qx, dy = y - qy, dz = z - qz;
  const l = Math.hypot(dx, dy, dz), n = out.n;
  if (l > 1e-6) (n[0] = dx / l), (n[1] = dy / l), (n[2] = dz / l);
  else {
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    n[0] = n[1] = n[2] = 0;
    if (ax >= ay && ax >= az) n[0] = x < 0 ? -1 : 1;
    else if (ay >= az) n[1] = y < 0 ? -1 : 1;
    else n[2] = z < 0 ? -1 : 1;
    dx = dy = dz = 0;
  }
  out[0] = (l > 1e-6 ? qx : n[0] ? n[0] * h : qx) + n[0] * b;
  out[1] = (l > 1e-6 ? qy : n[1] ? n[1] * h : qy) + n[1] * b;
  out[2] = (l > 1e-6 ? qz : n[2] ? n[2] * h : qz) + n[2] * b;
  return out;
}

// (its mound: a disc out to RHO of its radii - its rings closer in its middle, its head - each point of it put on
// the cube by MOUND_VERT)
function moundGeo() {
  const NR = 16, NS = 36, pos = [0, 0, 0], idx = [];
  for (let i = 1; i <= NR; i++) {
    const r = RHO * Math.pow(i / NR, 1.3);
    for (let j = 0; j < NS; j++) pos.push(r * Math.cos((j / NS) * Math.PI * 2), r * Math.sin((j / NS) * Math.PI * 2), 0);
  }
  for (let j = 0; j < NS; j++) idx.push(0, 1 + j, 1 + ((j + 1) % NS));
  for (let i = 1; i < NR; i++)
    for (let j = 0; j < NS; j++) {
      const a = 1 + (i - 1) * NS, b = 1 + i * NS, j1 = (j + 1) % NS;
      idx.push(a + j, b + j, b + j1, a + j, b + j1, a + j1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  g.setIndex(idx);
  for (const [name, n] of [['aC', 4], ['aRU', 4], ['aRV', 4], ['aFx', 4], ['aHead', 3]]) g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(MAXZ * n), n));
  return g;
}

const MOUND_HEAD = `
attribute vec4 aC;
attribute vec4 aRU;
attribute vec4 aRV;
attribute vec4 aFx;
attribute vec3 aHead;
varying vec3 vHead;
varying vec4 vFx;
varying float vRho;
float zitProf(float r) { return exp(-pow(r / ${g4(MW)}, ${g4(MP)})); }`;
// Each point of its mound - (x, y) on its disc, in its radii - on the cube as made (side 1, from its middle): walked
// out from its middle over the rounded skin, a fifth of the way at a time, each step on along the skin and turned as
// it turns (round an edge or a corner, it follows it round - over a sharp one too), then lifted off it by the mound's
// height there, its facing tipped back by its slope. In its own frame - across, up, out: aRU, aRV - for its matrix
// (the jelly's frame at it now) to place. aC: its middle (w: the edges' rounding); aRU.w: its radius; aRV.w: its
// height, in its radii; aFx: popped, its spread (swelling), its opacity
const MOUND_VERT = `
vec3 zRu = aRU.xyz, zRv = aRV.xyz, zRn = cross(zRu, zRv);
float zRb = aRU.w, zSw = aFx.y, zH = aRV.w, zB = max(aC.w, 0.004), zHc = 0.5 - zB;
float zRho = length(position.xy);
vec3 zS = aC.xyz, zN = zRn, zDir = zRho > 1e-6 ? (position.x * zRu + position.y * zRv) / zRho : zRu;
float zLeft = zRho * zRb * zSw;
for (int i = 0; i < 5; i++) {
  float st = zLeft / float(5 - i);
  vec3 T = zS + zDir * st, K = clamp(T, vec3(-zHc), vec3(zHc)), d = T - K;
  float dl = length(d);
  vec3 N2 = dl > 1e-7 ? d / dl : zN, S2 = K + N2 * zB, ax = cross(zN, N2);
  zLeft -= max(length(S2 - zS), st * 0.25);
  float c = dot(zN, N2), s2 = dot(ax, ax);
  zDir = zDir * c + cross(ax, zDir) + ax * (dot(ax, zDir) * (s2 > 1e-10 ? (1.0 - c) / s2 : 0.5));
  vec3 tD = zDir - N2 * dot(zDir, N2);
  float tl = length(tD);
  zDir = tl > 1e-6 ? tD / tl : normalize(cross(N2, zRu) + vec3(1e-6));
  zS = S2;
  zN = N2;
}
float zP = zitProf(zRho), zSl = zH * ${g4(MP / MW)} * pow(max(zRho, 1e-4) / ${g4(MW)}, ${g4(MP - 1)}) * zP / zSw;
vec3 zO = (zS + zN * (zH * zP * zRb) - aC.xyz) / zRb, zNr = normalize(zN + zDir * zSl);
vec3 zPos = vec3(dot(zO, zRu), dot(zO, zRv), dot(zO, zRn));
vec3 objectNormal = vec3(dot(zNr, zRu), dot(zNr, zRv), dot(zNr, zRn));
vRho = zRho;
vHead = aHead;
vFx = aFx;`;
const MOUND_FRAG_HEAD = `
varying vec3 vHead;
varying vec4 vFx;
varying float vRho;`;
// (its head a small cap at the very top - a whitehead - wider as it's squeezed, the skin round it ripening toward
// it, its dome paler up toward it, stretched thin; popped, a dark sore; its colour fading out over its foot into the
// jelly)
const MOUND_COLOR = `
float zHr = 0.28 + 0.3 * (vFx.y - 1.0), zHd = (1.0 - smoothstep(zHr * 0.7, zHr, vRho)) * (1.0 - vFx.x);
float zRp = (1.0 - smoothstep(zHr, zHr * 2.1, vRho)) * (1.0 - vFx.x);
vec3 zBody = diffuseColor.rgb;
diffuseColor.rgb = mix(zBody, min(zBody * 1.35 + 0.04, vec3(1.0)), 0.45 * (1.0 - smoothstep(0.2, 0.95, vRho)) * (1.0 - vFx.x));
diffuseColor.rgb = mix(diffuseColor.rgb, mix(zBody, vHead, 0.35), zRp * 0.6);
diffuseColor.rgb = mix(diffuseColor.rgb, vHead, zHd);
diffuseColor.rgb = mix(diffuseColor.rgb, zBody * vec3(0.4, 0.22, 0.2), vFx.x * (1.0 - smoothstep(0.2, 0.8, vRho)));
diffuseColor.a = mix(vFx.z, 1.0, zHd) * (1.0 - smoothstep(0.8, 1.6, vRho));`;
// (drawn premultiplied: its gloss kept on out over its foot, past where its colour's gone - see SHEEN)
const MOUND_OUT = `
float zSh = ${g4(SHEEN)} * (1.0 - smoothstep(1.2, ${g4(RHO)}, vRho));
gl_FragColor = vec4(totalDiffuse * diffuseColor.a + totalSpecular * max(diffuseColor.a, zSh), diffuseColor.a);`;

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
    // its mound: its colour - instance colour - over the jelly as much as its opacity says, its gloss over all of it
    const domeMat = new THREE.MeshStandardMaterial({
      roughness: 0.2, metalness: 0, envMap: env, envMapIntensity: 0.75, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    domeMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + MOUND_HEAD)
        .replace('#include <beginnormal_vertex>', MOUND_VERT)
        .replace('#include <begin_vertex>', 'vec3 transformed = zPos;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + MOUND_FRAG_HEAD)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + MOUND_COLOR)
        .replace('#include <opaque_fragment>', MOUND_OUT);
    };
    this.domeMat = domeMat;
    // the pus: creamy, a little glossy
    const blobMat = new THREE.MeshStandardMaterial({ roughness: 0.26, metalness: 0, envMap: env, envMapIntensity: 0.7 });
    const blobGeo = new THREE.IcosahedronGeometry(1, 2);
    this.back = { dome: mk(moundGeo(), domeMat, MAXZ, false), blob: mk(blobGeo, blobMat, BLOBS, false) };
    this.front = { dome: mk(moundGeo(), domeMat, MAXZ, true), blob: mk(blobGeo, blobMat, BLOBS, true) };
    for (const P of [this.back, this.front]) P.dome.renderOrder = 2;
    this.live = []; // (the zits on the cubes)
    this.blobs = []; // (the pus: flying, lying, in a worm, on a cube)
    this.worms = [];
    this._sig = '';
    this._recolor = false;
    // (each cube's fit - its turn and place now: see _fits)
    this._fr = new Float64Array(MAX_CUBES * 15);
    this._frOK = new Uint8Array(MAX_CUBES);
    this._fQ = new Float64Array(MAX_CUBES * 4);
    for (let k = 0; k < MAX_CUBES; k++) this._fQ[k * 4 + 3] = 1;
    this._fq = [];
    this._fA = new Float64Array(9);
    this._fR = new Float64Array(9);
    this._loc = { tet: -1, b0: 0, b1: 0, b2: 0, b3: 0 };
    this._tch = { k: -1, s: 1, bk: 0, out: 0, l: [0, 0, 0] };
    this._sp = Object.assign([0, 0, 0], { n: [0, 0, 0] });
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

  // (a cube's look changed: the blended ones take on its colours again - see App.applyStyle)
  restyled() {
    this._recolor = true;
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
        const L = this._hold(sb, k, z, s, b);
        Object.assign(L, { key, cb, i, red: new THREE.Color(a.red), head: new THREE.Color(a.head), pus: new THREE.Color(a.pus), blend: !!a.blend });
        L.body = this._bodyOf(L);
        if (was) (L.popped = was.popped), (L.popT = was.popT), (L.charge = was.charge), (L.ok = was.ok), L.pos.copy(was.pos), L.n.copy(was.n);
        this.live.push(L);
      });
    }
  }

  // (its body's colour: its red - or, blended, the cube's own where it comes up (a rainbow's band there), a shade
  // deeper: a bump of it)
  _bodyOf(L) {
    if (!L.blend) return L.red.clone();
    const s = this.app.sb.cSize[L.k] || 1, hex = this.app.flavorColorAtRest?.(L.rc[0] * s + L.k * REST_STEP, L.rc[1] * s, L.rc[2] * s, L.k);
    return new THREE.Color(hex ?? L.red).offsetHSL(0, 0.04, -0.05);
  }

  // (one zit's three holds in the jelly: its middle, up it, across it - as an eye's - and where it is on the cube as
  // made, for its mound to be laid over the skin there: see MOUND_VERT)
  _hold(sb, k, z, s, bev) {
    const n = [0, 0, 0], p = [z.x, z.y, z.z];
    // (which way out it faces there: out of the rounded cube's inner box)
    const h = 0.5 - bev, q = p.map((v) => Math.min(h, Math.max(-h, v)));
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
      rc: p, rb: bev, rr: z.r, ru: right, rv: up,
      ok: false, popped: false, popT: -1, charge: 0, swell: 0, base: 0, calm: 1.5, key: '', cb: null, i: 0, red: null, head: null, pus: null, body: null, blend: false,
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
      this._recolor = false;
      this._anchor(sb, app.cubes);
      // (new zits - or all back after a re-cube: unpopped)
      if (fresh) for (const L of this.live) (L.popped = false), (L.charge = 0), (L.popT = -1);
    } else if (this._recolor) {
      this._recolor = false;
      for (const L of this.live) L.body = this._bodyOf(L);
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
      // (pus in the air or on a cube: where the cubes are now, for it to land on and lie on)
      if (this.blobs.some((b) => b.st !== 1)) this._fits();
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

  // ...a hit at p (a nail, a mallet's blow): the zits within r of it - struck (squirt: a blow, a cube full of liquid's
  // squirted out of it too)
  hitAt(p, r = 0.03, d = null, squirt = false) {
    for (const L of this.live) if (L.ok && !L.popped && L.pos.distanceTo(p) < r + L.R) this._pop(L, 'shot', d, squirt);
  }

  // Popped: its pus out - a worm squeezed out, a spatter shot out, an ooze cut - and its crater left
  _pop(L, how, d = null, squirt = false) {
    L.popped = true;
    L.charge = 0;
    L.popT = performance.now();
    const app = this.app, n = L.n.clone(), p = L.pos.clone().addScaledVector(n, L.R * 0.45);
    app.audio?.zitPop?.(how, app.audio?._panOf?.(p) ?? 0, L.R / (app.sb.cSize[L.k] || 1));
    const col = L.pus, br = L.R * 0.3;
    // (a cube full of liquid's: so many drops of it to come out after the pus - more, the bigger it was)
    const wet = Math.max(1, Math.min(6, Math.round((L.R / (app.fluid?.D || 0.065)) * 4)));
    if (how === 'squeeze') {
      // (out as a worm, a blob at a time - more of it the bigger it was)
      this.worms.push({ L, links: [], left: Math.round(5 + L.R * 220), every: 0.028, t: 0, hold: rnd(0.5, 0.9), on: true, r: br, col, squirt: wet, sq: 0 });
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
      if (squirt) for (let k = 0; k < wet && this._squirt(L, 2, 3.4); k++);
    } else {
      for (let k = 0; k < 4; k++) this._blob(p, n.clone().multiplyScalar(rnd(0.3, 0.8)), br * rnd(0.5, 0.9), col, L.k);
    }
  }

  // A cube full of liquid squeezed at a zit, popped: a drop of its liquid - the one nearest the zit, in its hollow
  // under it - out through it, squirting, the pus's colour in it a little. (None near enough - its liquid lower
  // down, the zit over it in the air - none.) True: one came out.
  _squirt(L, v0, v1) {
    const app = this.app, fl = app.fluid, sb = app.sb, id = sb.cHid?.[L.k];
    if (!fl || !fl.n || !id) return false;
    const s = sb.cSize[L.k] || 1, reach = 0.3 * s + fl.D, x = fl.x, own = fl.own, px = L.pos.x, py = L.pos.y, pz = L.pos.z;
    let best = -1, bd = reach * reach;
    for (let i = 0; i < fl.n; i++) {
      if (own[i] !== id) continue;
      const dx = x[i * 3] - px, dy = x[i * 3 + 1] - py, dz = x[i * 3 + 2] - pz, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bd) (bd = d2), (best = i);
    }
    if (best < 0) return false;
    const o = best * 3, mass = fl.mass[best], visc = fl.visc[best], thick = fl.thick[best];
    _c.setRGB(fl.col[o], fl.col[o + 1], fl.col[o + 2]).lerp(L.pus, 0.3);
    fl.removeWhere((i) => i === best);
    const n = L.n, out = _p.copy(L.pos).addScaledVector(n, fl.D * 0.6 + 0.01), sp = rnd(v0, v1);
    fl.add(out.x, out.y, out.z, fl.vol * mass, n.x * sp + rnd(-0.3, 0.3), n.y * sp + rnd(0, 0.6), n.z * sp + rnd(-0.3, 0.3), _c.r, _c.g, _c.b, 0.01, 0, visc, thick, mass);
    return true;
  }

  // (a blob of pus, flying)
  _blob(p, v, r, col, k) {
    if (this.blobs.length >= BLOBS) {
      // (the oldest lying somewhere makes room)
      let j = this.blobs.findIndex((b) => b.st === 1 || b.st === 3);
      if (j < 0) j = 0;
      this.blobs.splice(j, 1);
    }
    const b = {
      p: p.clone(), v: v.clone(), r, col: col.clone().offsetHSL(0, 0, rnd(-0.04, 0.04)), st: 0, t: 0, k, flat: 0, sq: rnd(0.85, 1.15), prev: null, nx: null, w: 0, rope: 0,
      // (on a cube - st 3: its slot, the tet it's held in and where in it, where on the cube as made and which way
      // it faces there, how far under the skin it's held, the mesh it was held in - and its facing now)
      on: -1, tet: -1, w0: 0, w1: 0, w2: 0, w3: 0, rx: 0, ry: 0, rz: 0, qx: 0, qy: 0, qz: 0, sink: 0, topo: -1, ct: Math.random() * 0.1, nw: new THREE.Vector3(0, 1, 0),
    };
    this.blobs.push(b);
    return b;
  }

  // Each cube's turn and place now: its points' best fit to it as made (for the pus landing on it, lying on it: see
  // _land). One cut apart has none - its pieces no one fit - but a crumb off it's all right
  _fits() {
    const sb = this.app.sb, x = sb.x, X = sb.X, F = this._fr, A = this._fA, R = this._fR, Q = this._fQ;
    this._frOK.fill(0);
    for (const cb of this.app.cubes) {
      const k = cb.slot;
      let big = null, tot = 0;
      for (const pc of sb.pieces) if (pc && pc.cube === k) (tot += pc.verts.length), (big = !big || pc.verts.length > big.verts.length ? pc : big);
      if (!big || big.verts.length < 0.9 * tot) continue;
      // (a few hundred of its points are as good as all of them for that)
      const vs = big.verts, st = Math.max(1, Math.floor(vs.length / 300));
      let x0 = 0, x1 = 0, x2 = 0, X0 = 0, X1 = 0, X2 = 0, n = 0;
      for (let j = 0; j < vs.length; j += st) {
        const o = vs[j] * 3;
        x0 += x[o]; x1 += x[o + 1]; x2 += x[o + 2];
        X0 += X[o]; X1 += X[o + 1]; X2 += X[o + 2];
        n++;
      }
      x0 /= n; x1 /= n; x2 /= n; X0 /= n; X1 /= n; X2 /= n;
      A.fill(0);
      for (let j = 0; j < vs.length; j += st) {
        const o = vs[j] * 3, a0 = x[o] - x0, a1 = x[o + 1] - x1, a2 = x[o + 2] - x2, b0 = X[o] - X0, b1 = X[o + 1] - X1, b2 = X[o + 2] - X2;
        A[0] += a0 * b0; A[1] += a0 * b1; A[2] += a0 * b2;
        A[3] += a1 * b0; A[4] += a1 * b1; A[5] += a1 * b2;
        A[6] += a2 * b0; A[7] += a2 * b1; A[8] += a2 * b2;
      }
      const q = this._fq[k] || (this._fq[k] = Q.subarray(k * 4, k * 4 + 4));
      polarRot(q, A, R, 3);
      const f = k * 15;
      F[f] = x0; F[f + 1] = x1; F[f + 2] = x2; F[f + 3] = X0; F[f + 4] = X1; F[f + 5] = X2;
      for (let c = 0; c < 9; c++) F[f + 6 + c] = R[c];
      this._frOK[k] = 1;
    }
  }

  // (pus at b.p against the cubes: the one it's on - its slot, where on it as made (a share of its side from its
  // middle), how far out of its skin it is (m) - or null. A cube's skin as made, through its fit: a soft one's a
  // centimetre or two off it, near enough)
  _touch(b) {
    const app = this.app, sb = app.sb, F = this._fr, T = this._tch;
    for (const cb of app.cubes) {
      const k = cb.slot;
      if (!this._frOK[k]) continue;
      const f = k * 15, s = sb.cSize[k] || 1, bk = Math.min(0.45, (sb.cBevel[k] || 0) / s), h = 0.5 - bk;
      const dx = b.p.x - F[f], dy = b.p.y - F[f + 1], dz = b.p.z - F[f + 2];
      const lx = (F[f + 6] * dx + F[f + 9] * dy + F[f + 12] * dz + F[f + 3] - k * REST_STEP) / s;
      const ly = (F[f + 7] * dx + F[f + 10] * dy + F[f + 13] * dz + F[f + 4]) / s;
      const lz = (F[f + 8] * dx + F[f + 11] * dy + F[f + 14] * dz + F[f + 5]) / s;
      const qx = Math.abs(lx) - h, qy = Math.abs(ly) - h, qz = Math.abs(lz) - h;
      const out = (Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - bk) * s;
      if (out > b.r * 0.5) continue;
      T.k = k; T.s = s; T.bk = bk; T.out = out;
      T.l[0] = lx; T.l[1] = ly; T.l[2] = lz;
      return T;
    }
    return null;
  }

  // (pus at b.p: on a cube's skin? held on there, in the jelly under where it touched - st 3 - and true)
  _land(b) {
    const c = this._touch(b);
    if (!c) return false;
    const sp = onSurface(c.l, c.bk);
    if (!this._holdOn(b, c.k, sp.p, sp.n, c.s)) return false;
    b.flat = Math.min(1, b.v.length() / 3 + 0.3);
    b.v.set(0, 0, 0);
    b.st = 3;
    b.on = b.k = c.k;
    b.t = 0;
    return true;
  }

  // (a worm's link still coming out, against a cube: lying on its skin, not in it - not held on there, but sliding,
  // slowed, as the rest of the worm pushes it on: a worm on a cube's top coils out over it)
  _slide(b) {
    const c = this._touch(b);
    if (!c) return;
    const F = this._fr, f = c.k * 15, n = onSurface(c.l, c.bk).n, lie = b.r * 0.45 - c.out;
    const nx = F[f + 6] * n[0] + F[f + 7] * n[1] + F[f + 8] * n[2], ny = F[f + 9] * n[0] + F[f + 10] * n[1] + F[f + 11] * n[2], nz = F[f + 12] * n[0] + F[f + 13] * n[1] + F[f + 14] * n[2];
    if (lie > 0) (b.p.x += nx * lie), (b.p.y += ny * lie), (b.p.z += nz * lie);
    // (its way: none into the skin, a little lost along it)
    const vx = b.p.x - b.prev.x, vy = b.p.y - b.prev.y, vz = b.p.z - b.prev.z, vn = vx * nx + vy * ny + vz * nz;
    const tx = vx - nx * vn, ty = vy - ny * vn, tz = vz - nz * vn, kn = Math.max(vn, 0);
    b.prev.set(b.p.x - tx * 0.6 - nx * kn, b.p.y - ty * 0.6 - ny * kn, b.p.z - tz * 0.6 - nz * kn);
  }

  // (pus held in cube k's jelly just under the skin at P (as made, a share of its side from its middle), facing N
  // there: false, no jelly there - cut away)
  _holdOn(b, k, P, N, s) {
    const sb = this.app.sb;
    for (const sink of PUS_SINKS) {
      const r = sb.locateRestFast((P[0] - N[0] * sink) * s + k * REST_STEP, (P[1] - N[1] * sink) * s, (P[2] - N[2] * sink) * s, this._loc);
      if (!r) continue;
      b.tet = r.tet;
      b.w0 = r.b0; b.w1 = r.b1; b.w2 = r.b2; b.w3 = r.b3;
      b.rx = P[0]; b.ry = P[1]; b.rz = P[2];
      b.qx = N[0]; b.qy = N[1]; b.qz = N[2];
      b.sink = sink * s;
      b.topo = sb.topoVersion;
      return true;
    }
    return false;
  }

  // Pus on a cube: riding its jelly where it's held; creeping down where its skin's steep (not while it's in a worm
  // still coming out - the rope'd tear); dripping off where its skin faces down. False: let go of - the cube's gone,
  // cut away there, cut in two
  _stuck(b, t) {
    const sb = this.app.sb, k = b.on, F = this._fr, f = k * 15;
    if (k < 0 || !this._frOK[k]) return false;
    const s = sb.cSize[k] || 1, bk = Math.min(0.45, (sb.cBevel[k] || 0) / s);
    if (b.topo !== sb.topoVersion && !this._holdOn(b, k, [b.rx, b.ry, b.rz], [b.qx, b.qy, b.qz], s)) return false;
    b.ct += t;
    if (!b.w && b.ct > 0.1) {
      // (down, in the cube's frame as made: along its skin there, as steep as that is - a step every tenth of a
      // second, near enough)
      const gx = -F[f + 9], gy = -F[f + 10], gz = -F[f + 11], gn = gx * b.qx + gy * b.qy + gz * b.qz;
      const tx = gx - b.qx * gn, ty = gy - b.qy * gn, tz = gz - b.qz * gn, tl = Math.hypot(tx, ty, tz);
      if (tl > 0.2) {
        const step = (CREEP * tl * b.ct) / s, P = this._sp;
        onBox(b.rx + tx * step, b.ry + ty * step, b.rz + tz * step, bk, P);
        if (!this._holdOn(b, k, P, P.n, s)) return false;
      }
      b.ct = 0;
    }
    if (b.tet >= sb.nT) return false;
    const T = sb.T, x = sb.x, o = b.tet * 4, i0 = T[o] * 3, i1 = T[o + 1] * 3, i2 = T[o + 2] * 3, i3 = T[o + 3] * 3;
    const px = x[i0] * b.w0 + x[i1] * b.w1 + x[i2] * b.w2 + x[i3] * b.w3;
    const py = x[i0 + 1] * b.w0 + x[i1 + 1] * b.w1 + x[i2 + 1] * b.w2 + x[i3 + 1] * b.w3;
    const pz = x[i0 + 2] * b.w0 + x[i1 + 2] * b.w1 + x[i2 + 2] * b.w2 + x[i3 + 2] * b.w3;
    b.nw.set(F[f + 6] * b.qx + F[f + 7] * b.qy + F[f + 8] * b.qz, F[f + 9] * b.qx + F[f + 10] * b.qy + F[f + 11] * b.qz, F[f + 12] * b.qx + F[f + 13] * b.qy + F[f + 14] * b.qz);
    const out = b.sink + b.r * 0.4;
    b.p.set(px + b.nw.x * out, py + b.nw.y * out, pz + b.nw.z * out);
    // (dripping off its underside - going the jelly's way there)
    if (b.nw.y < DRIP_Y && !b.w) {
      const v = sb.v;
      b.v.set(v[i0] * b.w0 + v[i1] * b.w1 + v[i2] * b.w2 + v[i3] * b.w3, v[i0 + 1] * b.w0 + v[i1 + 1] * b.w1 + v[i2 + 1] * b.w2 + v[i3 + 1] * b.w3 - 0.3, v[i0 + 2] * b.w0 + v[i1 + 2] * b.w1 + v[i2 + 2] * b.w2 + v[i3 + 2] * b.w3);
      b.st = 0;
      b.on = -1;
    }
    return true;
  }

  // The worms: squirming out of their zits a blob at a time (each new one at its root, the rest pushed out ahead of
  // it), sagging; then let go of, falling, and lying where they land - the floor, a cube - each link a blob of pus
  // held to the next (a chain: see _blobs). A cube full of liquid: its liquid squirting out with it, a drop at a time
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
          b.w = b.rope = 1;
          b.prev = root.clone().addScaledVector(L.n, -0.9 * W.every);
          W.links.unshift(b);
        }
      } else if (W.on) {
        W.hold -= t;
        if (W.hold <= 0) W.on = false;
      }
      if (W.on && W.squirt > 0) {
        W.sq += t;
        while (W.sq >= SQUIRT_EVERY && W.squirt > 0) {
          W.sq -= SQUIRT_EVERY;
          W.squirt = this._squirt(L, 1.4, 2.4) ? W.squirt - 1 : 0;
        }
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
      // (rounds of it: a long one hanging off a cube's edge, held at the top, stretched out to beads at four)
      for (let it = 0; it < 12; it++) {
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
      // (and no longer than it is: each link kept within its length (and a little) of the one before it, out from the
      // zit - else one off a cube's top hung down a metre to the floor, stretched thin, a 40 cm worm. Held further off
      // than that by one lying somewhere - the floor, a cube: torn there, the rest let go)
      for (let i = 0; i + 1 < W.links.length; i++) {
        const a = W.links[i], c = W.links[i + 1], seg = (a.r + c.r) * 0.36 * 1.2;
        const dx = c.p.x - a.p.x, dy = c.p.y - a.p.y, dz = c.p.z - a.p.z, l = Math.hypot(dx, dy, dz);
        if (!(l > seg)) continue;
        if (c.st === 2) {
          const f = seg / l, mx = a.p.x + dx * f - c.p.x, my = a.p.y + dy * f - c.p.y, mz = a.p.z + dz * f - c.p.z;
          c.p.x += mx; c.p.y += my; c.p.z += mz;
          c.prev.x += mx * 0.5; c.prev.y += my * 0.5; c.prev.z += mz * 0.5;
        } else if (l > seg * 2.5) {
          for (const b of W.links.splice(i + 1)) {
            b.w = 0;
            if (b.st === 2) (b.st = 0), b.v.set(0, 0, 0);
          }
          break;
        }
      }
      // (a link on the floor: it stays there, flattened - on a cube: lying on it, slid on by the rest coming out; all
      // out, held on there, the rest of it hanging off it)
      for (let i = 0; i < W.links.length; i++) {
        const b = W.links[i];
        if (b.st !== 2 || (W.on && i === 0)) continue;
        if (b.p.y < b.r * 0.45) {
          b.p.y = b.r * 0.45;
          b.st = 1;
          b.t = 0;
        } else if (W.on) this._slide(b);
        else if (this._land(b)) b.flat = 0.25;
      }
      // (all down - or a while gone: the rest let go as they are, to fall)
      if (!W.on && (W.links.every((b) => b.st !== 2) || W.t > 8)) {
        for (const b of W.links) {
          b.w = 0;
          if (b.st === 2) (b.st = 0), b.v.set((b.p.x - b.prev.x) / t, (b.p.y - b.prev.y) / t, (b.p.z - b.prev.z) / t);
        }
        this.worms.splice(w, 1);
      }
    }
  }

  // the blobs flying: slowed by their own gloopiness, landing - on a cube, held on there; on the floor, a splat - and
  // lying a while, then gone
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
        } else if (this._land(b) && b.flat > 0.75 && Math.random() < 0.3) this.app.audio?.pusSplat?.(0.5 * b.flat, b.p);
      } else if (b.st === 3) {
        // (on a cube - down on the floor with it, lying there)
        if (!this._stuck(b, t)) (b.st = 0), (b.on = -1), b.v.set(0, 0, 0);
        else if (b.st === 3 && b.p.y < b.r * 0.45) (b.p.y = b.r * 0.45), (b.st = 1), (b.on = -1);
        if (b.t > FLOOR_LIFE) this.blobs.splice(i, 1);
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
      // (squeezed: swelling, spreading up to a third wider; just popped: deflating to a crater)
      const age = L.popped ? (now - L.popT) / 1000 : 0, gone = L.popped ? Math.min(1, age / 0.22) : 0;
      const sw = 1 + 0.32 * L.swell, hgt = L.popped ? 0.62 - 0.44 * gone : 0.62 * (1 + 0.55 * L.swell);
      const su = Math.min(1.5, Math.max(0.6, L.su)), sv = Math.min(1.5, Math.max(0.6, L.sv));
      _m.makeBasis(L.u, L.v, L.n).scale(_s.set(L.R * su, L.R * sv, L.R)).setPosition(L.pos);
      P.dome.setMatrixAt(i, _m);
      P.dome.setColorAt(i, L.body);
      const A = P.dome.geometry.attributes;
      A.aC.setXYZW(i, L.rc[0], L.rc[1], L.rc[2], L.rb);
      A.aRU.setXYZW(i, L.ru[0], L.ru[1], L.ru[2], L.rr);
      A.aRV.setXYZW(i, L.rv[0], L.rv[1], L.rv[2], hgt);
      A.aFx.setXYZW(i, gone, sw, L.blend ? BLEND_A : BODY_A, 0);
      // (squeezed, its head comes up whiter)
      _c.copy(L.head).lerp(_w, 0.35 * L.swell);
      A.aHead.setXYZ(i, _c.r, _c.g, _c.b);
      if (front) N.front++;
      else N.back++;
    }
    for (const [key, P] of [['back', this.back], ['front', this.front]]) {
      P.dome.count = N[key];
      P.dome.instanceMatrix.needsUpdate = true;
      if (P.dome.instanceColor) P.dome.instanceColor.needsUpdate = true;
      const A = P.dome.geometry.attributes;
      A.aC.needsUpdate = A.aRU.needsUpdate = A.aRV.needsUpdate = A.aFx.needsUpdate = A.aHead.needsUpdate = true;
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
      // (lying: flattened out on the floor or a cube's skin, more the harder it landed - and shrinking away at the end)
      const lying = b.st === 1 || b.st === 3;
      const fade = lying ? Math.min(1, Math.max(0, (FLOOR_LIFE - b.t) / 1.5)) : 1;
      let fl = lying ? 0.3 + 0.25 * (1 - b.flat) : 1, wide = lying ? 1.25 + 0.45 * b.flat : b.sq, stretch = 1;
      _q.set(0, 0, 0, 1);
      // (a worm's links - coming out, lying on a cube: a rope; lying on the floor, a squiggle of splats)
      if (b.rope && b.nx && (b.st === 2 || b.st === 3) && (b.nx.st === 2 || b.nx.st === 3)) {
        _u.subVectors(b.nx.p, b.p);
        const l = _u.length();
        if (l > 1e-5) (_q.setFromUnitVectors(UP, _u.multiplyScalar(1 / l))), (stretch = Math.min(2.2, 1 + (0.9 * l) / b.r));
        if (b.st === 3) (fl = 1), (wide = 1);
      } else if (b.st === 3) _q.setFromUnitVectors(UP, b.nw);
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
    for (const P of [this.back, this.front]) for (const m of [P.dome, P.blob]) if (!m.count) (m.count = 1), was.push(m);
    return () => {
      for (const m of was) m.count = 0;
    };
  }
}
