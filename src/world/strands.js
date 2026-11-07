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
// Drawn as smooth tubes, thick where they join the jelly (a fillet), glossy,
// the jelly's colour.

const NODES = 9; // points along a strand
const RING = 8; // vertices round the tube
const SUBR = 3; // rings per segment (a smooth curve through the points)
const MAX = 64; // strands at once
const RINGS = (NODES - 1) * SUBR + 1;

export class Strands {
  constructor(app) {
    this.app = app;
    this.list = [];
    const nv = MAX * RINGS * RING;
    this.pos = new Float32Array(nv * 3);
    this.nrm = new Float32Array(nv * 3);
    this.rgb = new Float32Array(nv * 3);
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
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aNrm = new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.rgb, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('normal', this.aNrm);
    geo.setAttribute('color', this.aCol);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.mat = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.07,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      transparent: true,
      opacity: 0.9,
      envMap: app.env.texture,
      envMapIntensity: 0.75,
    });
    // (as the molten jelly: deeper than its colour; in glow mode it shines)
    this.mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\n#ifdef USE_COLOR\ndiffuseColor.rgb *= sqrt(vColor.rgb);\n#endif')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor.rgb * 1.2;\n#endif');
    };
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.castShadow = true;
    app.scene.add(this.mesh);
    this._c = new THREE.Vector3();
    app.onHealStart?.push(() => this.clear());
  }

  setGlow(e) {
    this.mat.emissive.setScalar(e);
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
    this.list.push({
      a, b, p, q, rest, col,
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
        for (let i = 0; i < NODES - 1; i++) {
          const o = i * 3, d = Math.hypot(p[o + 3] - p[o], p[o + 4] - p[o + 1], p[o + 5] - p[o + 2]);
          rest[i] += (d - rest[i]) * f;
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
    return { a: end, b: -1, p, q, rest: new Float32Array(NODES - 1).fill(half * 0.6), col: s.col, vol: s.vol / 2, tip: 0, flow: s.flow, maxL: Infinity, fade: 0.3, age: 0, len: s.len / 2 };
  }

  // The tubes: a smooth curve through each strand's points (Catmull-Rom),
  // rings round it, thick where it joins the jelly and thin in the middle
  // (volume kept: thinner the longer it is); a free end rounds off, or
  // swells into its blob.
  _draw(size) {
    const pos = this.pos, nrm = this.nrm, rgb = this.rgb;
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
      const rm = Math.sqrt(s.vol / (Math.PI * L)), freeB = s.b < 0, tipR = s.tip > 0 ? Math.cbrt((3 * s.tip) / (4 * Math.PI)) : 0;
      for (let r = 0; r < RINGS; r++) {
        const a = Math.max(0, r - 1), b = Math.min(RINGS - 1, r + 1);
        let tx = P[b * 3] - P[a * 3], ty = P[b * 3 + 1] - P[a * 3 + 1], tz = P[b * 3 + 2] - P[a * 3 + 2];
        const tl = Math.hypot(tx, ty, tz) || 1;
        Tn[r * 3] = tx / tl; Tn[r * 3 + 1] = ty / tl; Tn[r * 3 + 2] = tz / tl;
        const u = r / (RINGS - 1), e = Math.abs(2 * u - 1);
        // (necked in the middle, a fillet where it joins the jelly)
        let rad = rm * (0.55 + 1.1 * e * e * e);
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
      const base = sIdx * RINGS * RING;
      const thin = Math.min(1, 0.004 * size / Math.max(rm, 1e-5));
      const cr = s.col[0] + (1 - s.col[0]) * 0.25 * thin, cg = s.col[1] + (1 - s.col[1]) * 0.25 * thin, cb = s.col[2] + (1 - s.col[2]) * 0.25 * thin;
      for (let r = 0; r < RINGS; r++) {
        const tx = Tn[r * 3], ty = Tn[r * 3 + 1], tz = Tn[r * 3 + 2];
        // (carry the normal along: take out its part along the new tangent)
        const dt = nx * tx + ny * ty + nz * tz;
        nx -= tx * dt; ny -= ty * dt; nz -= tz * dt;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
        for (let k = 0; k < RING; k++) {
          const th = (k / RING) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
          const ox = nx * c + bx * sn, oy = ny * c + by * sn, oz = nz * c + bz * sn;
          const o = (base + r * RING + k) * 3;
          pos[o] = P[r * 3] + ox * Rr[r]; pos[o + 1] = P[r * 3 + 1] + oy * Rr[r]; pos[o + 2] = P[r * 3 + 2] + oz * Rr[r];
          nrm[o] = ox; nrm[o + 1] = oy; nrm[o + 2] = oz;
          rgb[o] = cr; rgb[o + 1] = cg; rgb[o + 2] = cb;
        }
      }
      sIdx++;
    }
    this.geo.setDrawRange(0, sIdx * (RINGS - 1) * RING * 6);
    const nv = sIdx * RINGS * RING * 3;
    for (const a of [this.aPos, this.aNrm, this.aCol]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, nv);
      a.needsUpdate = true;
    }
    this.mesh.visible = sIdx > 0;
  }
}
