import * as THREE from 'three';
import { cutBody, planeField, unglue, removeSmallPieces, removeTets } from '../sim/cutting.js';
import { maxStretch } from '../sim/strain.js';
import { polarRot } from '../sim/softbody.js';
import { makeNailGun, makeHoleGun } from '../world/models.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

// ------------------------------------------------------------------ hand
// How far each material stretches before it tears (frozen jelly: barely).
// (soft ones: what two hands can actually draw them to - they give for longer instead)
const TEAR = { jello: 1.75, gummy: 1.9, sour: 1.8, crystal: 1.6, creamy: 2.0, slime: 2.6, water: 2.2, syrup: 2.8, mochi: 2.6, marshmallow: 2.3, rubber: 2.5, glass: 1.3, tofu: 1.3, putty: 2.5, candy: 1.12 };

// Grab and drag; a quick tap pokes. Each finger holds on by itself - two on
// the jelly squish it between them or pull it apart - and pulled too far
// apart it tears between them (unless tearing's off: Settings). One hand
// never tears it: dragged however fast, the whole piece comes along.
export class HandTool {
  constructor(app) {
    this._ht = 0;
    this.app = app;
    this.id = 'hand';
    this.cursor = 'grab';
    this.multiTouch = true; // (a second finger on the jelly grabs too - see App._bindInput)
    this.drags = new Map(); // pointerId -> { grab, plane, t0, x0, y0, moved, hit, dir }
    this.tear = null; // a tear under way: { piece, ver, band (tets), prof (0..1 each), p (0..1 through), n (axis), creak }
    this._acc = 0; // (s) since the last look
    this._tick = 0;
    this._cool = 0;
  }

  // (the one drag, for single-pointer callers)
  get drag() {
    for (const d of this.drags.values()) return d;
    return null;
  }

  hover(e, ray) {
    if (!ray || this.drags.size) return;
    const now = performance.now();
    if (now - (this._ht || 0) < 40) return;
    this._ht = now;
    this.app.setCursor(this.app.pickJelly(ray) ? 'grab' : 'default');
  }

  down(e, ray, hit) {
    if (!hit) return false;
    const app = this.app;
    const p = hit.point;
    app.camera.getWorldDirection(_v);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(_v.negate(), _w.set(p[0], p[1], p[2]));
    const grab = app.sb.startGrab(hit, p[0], p[1], p[2], 0.2 * app.sb.p.size * (app.st?.grabSize ?? 1));
    if (!grab) return false;
    this.drags.set(e.pointerId ?? 0, { grab, plane, t0: performance.now(), x0: e.clientX, y0: e.clientY, moved: 0, hit, dir: ray.direction.clone(), pt: [p[0], p[1], p[2]], off: [0, 0, 0] });
    app.setCursor('grabbing');
    app.audio?.squish(0.35, this.drags.size > 1 ? 1.15 : 0.9);
    return true;
  }

  move(e, ray) {
    const d = this.drags.get(e.pointerId ?? 0);
    if (!d) return;
    d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.x0, e.clientY - d.y0));
    const pt = ray.intersectPlane(d.plane, _v);
    if (pt) {
      d.pt[0] = pt.x; d.pt[1] = pt.y; d.pt[2] = pt.z;
      this._aim(d);
    }
  }

  // Where the hand pulls: the finger, less what's left of an offset (after
  // a tear each half is held where it is, and eased back to the finger -
  // else it raced to catch up, 20 m/s); above the floor, inside the arena.
  _aim(d) {
    const g = d.grab;
    g.tx = d.pt[0] - d.off[0];
    g.ty = Math.max(d.pt[1] - d.off[1], 0.03);
    g.tz = d.pt[2] - d.off[2];
    const R = this.app.sb.p.arenaRadius - 0.05;
    const r = Math.hypot(g.tx, g.tz);
    if (r > R) {
      g.tx *= R / r;
      g.tz *= R / r;
    }
  }

  // A finger lifts (a pointer we don't know: all of them - the app taking
  // the gesture over for a pinch).
  up(e) {
    const id = e?.pointerId ?? 0;
    if (!this.drags.has(id)) {
      for (const k of [...this.drags.keys()]) this._release(k);
    } else this._release(id);
    if (!this.drags.size) this.app.setCursor(this.cursor);
  }

  _release(id) {
    const d = this.drags.get(id);
    if (!d) return;
    this.drags.delete(id);
    const app = this.app;
    const quick = performance.now() - d.t0 < 280 && d.moved < 8;
    app.sb.endGrab(d.grab);
    if (quick) {
      const [x, y, z] = d.hit.point;
      app.sb.impulse(x, y, z, d.dir.x, d.dir.y, d.dir.z, 0.34 * app.sb.p.size, 4.2 * (app.st?.poke ?? 1), d.grab.piece);
      app.audio?.poke(0.7);
      app.glowPulse?.(x, y, z, 0.9);
    } else if (!this.drags.size) {
      // throw: speed of the grabbed region
      const pc = app.sb.pieces[d.grab.piece];
      const sp = pc ? Math.hypot(...pc.vel) : 0;
      if (sp > 3) app.audio?.whoosh(Math.min(1, sp / 12));
    }
  }

  // Each frame (every other): two hands on one piece pulling it apart.
  // Stretched between them past its limit, it starts to give: a band across
  // the line between the hands, where it's stretched most, softens (see
  // SoftBody.tDmg) and draws out thin - as long as the pull's kept up, for
  // longer the softer the jelly (pulling harder hurries it) - then splits
  // there, a half in each. Eased off before then, it firms up again. Both
  // the stretch it takes and how long it gives first come from how stiff it
  // is (_tearLimit, _tearTime), times Settings > Toughness. (Torn wherever
  // the stretch peaked, a fingertip's shallow hold peeled thin flaps and
  // shredded them; a rip that ran on in steps cut one plane over and over -
  // each cut splits every tet on its plane anew: millions - so it's one cut,
  // at the end. One hand tore a ball out of anything dragged fast: one hand
  // never tears.) Bits under 5% of a cube don't tear again.
  update(sdt, dt = 1 / 60) {
    const app = this.app, sb = app.sb;
    // (the tear runs on the jelly's time: in slow motion it gives slowly too)
    this._acc += sdt;
    const ease = Math.exp(-dt * 6);
    for (const d of this.drags.values()) {
      if (d.off[0] === 0 && d.off[1] === 0 && d.off[2] === 0) continue;
      for (let c = 0; c < 3; c++) d.off[c] = Math.abs(d.off[c] * ease) < 1e-4 ? 0 : d.off[c] * ease;
      this._aim(d);
    }
    if (this.drags.size < 2 || app.healer.active || !app.tearing) {
      this._endTear();
      this._acc = 0;
      return;
    }
    this._cool -= sdt;
    if (++this._tick % 2 || this._cool > 0 || sb.nT > 30000) return;
    const step = this._acc;
    this._acc = 0;
    const tr = this.tear;
    if (tr && tr.ver !== sb.topoVersion) this._endTear(); // (cut by something else meanwhile)
    const G = sb._grabbedP;
    if (!G) return;
    const size = sb.p.size, minVol = 0.05 * size ** 3;
    // the hands on each piece, and where each holds (its held vertices' middle)
    const on = new Map();
    for (const d of this.drags.values()) {
      const g = d.grab, k = g.piece;
      const pc = sb.pieces[k];
      if (!pc || pc.volume < minVol) continue;
      const c = [0, 0, 0];
      for (let j = 0; j < g.n; j++) for (let q = 0; q < 3; q++) c[q] += sb.x[g.idx[j] * 3 + q] / g.n;
      if (!on.has(k)) on.set(k, []);
      on.get(k).push({ d, c });
    }
    let best = null;
    for (const [k, hands] of on) {
      if (hands.length < 2) continue;
      const mask = new Uint8Array(sb.pieces.length);
      mask[k] = 1;
      const [A, B] = hands, ax = B.c[0] - A.c[0], ay = B.c[1] - A.c[1], az = B.c[2] - A.c[2];
      const L2 = ax * ax + ay * ay + az * az;
      if (L2 < 1e-6) continue;
      const L = Math.sqrt(L2);
      // pulled apart - further than when they took hold - not squeezed
      // (squeezed, it bulges: stretched across the squeeze, which mustn't tear it)
      const P = B.d;
      if (P.pairWith !== A.d.grab) {
        P.pairWith = A.d.grab;
        P.d0 = L; // (how far apart they took hold)
      }
      if (L < P.d0 * 1.12) continue;
      // (the middle of the way between them, stretched along it)
      const m = maxStretch(sb, mask, (x, y, z) => {
        const u = ((x - A.c[0]) * ax + (y - A.c[1]) * ay + (z - A.c[2]) * az) / L2;
        return u > 0.2 && u < 0.8;
      });
      if (!m || Math.abs(m.dir[0] * ax + m.dir[1] * ay + m.dir[2] * az) / L < 0.7) continue;
      const lim = this._tearLimit(m), over = m.s / lim;
      if (!best || over > best.over) best = { over, m, k, n: [ax / L, ay / L, az / L] };
      this.lastStretch = m.s;
      this.lastLimit = lim;
    }
    const cur = this.tear;
    // (once it's giving, it goes on giving near its limit)
    if (!best || best.over <= (cur ? 0.92 : 1) || (cur && cur.piece !== best.k)) {
      // (not pulled hard enough - eased off: it firms up again)
      if (cur) {
        cur.p -= step * 0.8;
        // (a rip already open waits for the next pull, along the same seam)
        if (cur.p <= 0 && !cur.done) this._endTear();
        else {
          cur.p = Math.max(0, cur.p);
          this._damage(cur);
        }
      }
      return;
    }
    const t = cur || this._startTear(best);
    if (!t) return;
    t.p += (step * (1 + 1.5 * Math.min(0.5, Math.max(0, best.over - 1)))) / this._tearTime();
    t.n = best.n;
    // the rip runs along the seam as it gives: after the first sixth of the
    // way, so much of the seam open as it is through - a stage at a time
    // (each a rebuild), the last when it's all the way
    const N = t.seam.length, want = t.p >= 1 ? N : Math.floor(Math.max(0, (t.p - 0.15) / 0.85) * N);
    if (want > t.done && (want === N || want - t.done >= Math.max(4, Math.ceil(N * 0.12)))) {
      const pairs = [];
      const n = unglue(sb, t.seam.subarray(t.done, want), t.plus, pairs);
      if (n) this._strands(pairs);
      t.done = want;
      t.ver = sb.topoVersion;
      // (pieces are renumbered by the rebuild: it's the one its unopened seam is in)
      if (want < N) t.piece = sb.vPiece[t.seam[want]];
      if (n) {
        app.audio?.squish(0.35 + 0.3 * t.p, 0.7 + 0.25 * t.p);
        app.audio?.crack(0.08 + 0.1 * t.p);
        app.markDamaged();
      }
    }
    if (t.p < 1) {
      this._damage(t);
      // (a creak now and then as it gives)
      if ((t.creak -= step) <= 0) {
        t.creak = 0.18;
        app.audio?.squish(0.15 + 0.35 * t.p, 0.55 + 0.3 * t.p);
      }
      return;
    }
    // through: the seam's all open - where it ran, now
    const o = [0, 0, 0];
    let wsum = 0;
    for (let q = 0; q < t.band.length; q++) {
      const c = tetCentre(sb, t.band[q]), wq = t.prof[q];
      for (let e = 0; e < 3; e++) o[e] += c[e] * wq;
      wsum += wq;
    }
    for (let e = 0; e < 3; e++) o[e] /= wsum || 1;
    const [nx, ny, nz] = t.n, half = t.half;
    this.tear = null;
    // (if the seam didn't part it - a piece the plane crosses twice - the
    // slit stays and that's that)
    {
      const ps = new Set();
      for (const d of this.drags.values()) ps.add(sb.vPiece[d.grab.idx[0]]);
      if (ps.size < 2) {
        this._cool = 0.35;
        return;
      }
    }
    for (const d of this.drags.values()) {
      const g = d.grab;
      const c = [0, 0, 0];
      for (let j = 0; j < g.n; j++) for (let q = 0; q < 3; q++) c[q] += sb.x[g.idx[j] * 3 + q] / g.n;
      for (let q = 0; q < 3; q++) d.off[q] = d.pt[q] - c[q];
      this._aim(d);
    }
    // (the torn ends keep most of the shape they were drawn out to - see
    // _yield - on the halves, the pieces the hands hold now)
    const h2 = 2 * half;
    const halves = new Set();
    for (const d of this.drags.values()) halves.add(sb.vPiece[d.grab.idx[0]]);
    this._yield(o, t.n, h2, this._plastic(), halves);
    sb.calmT = 0.3;
    sb.rebuild();
    // (a crumb the seam cut off on its own: gone)
    removeSmallPieces(sb, 0.002 * size ** 3, app.allAnchors());
    // (the torn ends were drawn out soft: they stay soft and firm up over a
    // moment - given their full stiffness back at once, stretched as they
    // are, the halves sprang apart at 30+ m/s)
    const held = new Set();
    for (const d of this.drags.values()) held.add(sb.vPiece[d.grab.idx[0]]);
    for (let q = 0; q < sb.nT; q++) {
      if (sb.vol0[q] <= 0 || !held.has(sb.tPiece[q])) continue;
      const c = tetCentre(sb, q), d = Math.abs((c[0] - o[0]) * nx + (c[1] - o[1]) * ny + (c[2] - o[2]) * nz);
      if (d < h2) sb.tDmg[q] = 0.97 * (1 - (d / h2) * (d / h2));
    }
    sb.dmgHeal = 1;
    app.onTopologyChanged();
    app.markDamaged();
    this._cool = 0.35; // (let it snap back before looking again)
    app.audio?.squish(0.9, 0.65);
    app.audio?.crack(0.25);
    app.glowPulse?.(o[0], o[1], o[2], 0.8);
  }

  // A tear begins: one ragged cut across the line between the hands,
  // through the most stretched spot - but glued back all along (see
  // cutBody's glueAll): the seam it will run along, opened a stretch at a
  // time from the edge nearest that spot (see update, unglue). The tets on
  // the seam's far side are "plus"; the band of tets either side of it
  // softens as it gives. (Run along the mesh's own faces, the torn face came
  // out a regular egg-crate of facets.)
  _startTear(best) {
    const app = this.app, sb = app.sb, o = tetCentre(sb, best.m.t), [nx, ny, nz] = best.n;
    const field = ragged(planeField(nx, ny, nz, nx * o[0] + ny * o[1] + nz * o[2]), 0.035 * sb.p.size);
    const res = cutBody(sb, field, { glueAll: true, anchors: app.allAnchors(), pieces: [best.k] });
    if (!res.changed || !res.seam.length) return null;
    app.onTopologyChanged();
    const seam = res.seam.filter((i) => sb.alive[i]);
    if (!seam.length) return null;
    app.tally?.('tears');
    const k = sb.vPiece[seam[0]], pc = sb.pieces[k];
    const half = 1.5 * sb.hCell, band = [], prof = [];
    const plus = new Uint8Array(sb.nT);
    for (const t of pc.tets) {
      if (sb.vol0[t] <= 0) continue;
      const c = tetCentre(sb, t);
      if (field.value(c[0], c[1], c[2]) > 0) plus[t] = 1;
      const d = Math.abs((c[0] - o[0]) * nx + (c[1] - o[1]) * ny + (c[2] - o[2]) * nz);
      if (d >= half) continue;
      band.push(t);
      prof.push(1 - (d / half) * (d / half));
    }
    // (where it starts: the seam's surface vertex nearest the spot)
    const onS = new Uint8Array(sb.nV);
    for (let q = 0; q < sb.nF * 3; q++) onS[sb.sTri[q]] = 1;
    const d2o = (i) => (sb.x[i * 3] - o[0]) ** 2 + (sb.x[i * 3 + 1] - o[1]) ** 2 + (sb.x[i * 3 + 2] - o[2]) ** 2;
    let start = -1;
    for (const i of seam) if (onS[i] && (start < 0 || d2o(i) < d2o(start))) start = i;
    if (start < 0) start = seam[0];
    const sx = sb.x[start * 3], sy = sb.x[start * 3 + 1], sz = sb.x[start * 3 + 2];
    const d2s = (i) => (sb.x[i * 3] - sx) ** 2 + (sb.x[i * 3 + 1] - sy) ** 2 + (sb.x[i * 3 + 2] - sz) ** 2;
    seam.sort((p, q) => d2s(p) - d2s(q));
    this.tear = { piece: k, ver: sb.topoVersion, band: Int32Array.from(band), prof: Float32Array.from(prof), p: 0, n: best.n, creak: 0, half, plus, seam: Int32Array.from(seam), done: 0 };
    return this.tear;
  }

  // Plastic yield: near the tear (within h2 of the plane through o, normal
  // n), each piece's rest shape eased toward the shape it's in now, put back
  // in its rest frame (its rigid fit) - beta of the way at the plane, less
  // further off. Stretched 4-5x and let go, a neck sprang back at 15-25 m/s
  // even softened (each substep the solver takes back most of a stretch,
  // however soft); now the ends stay drawn out, as torn slime does. The
  // caller rebuilds (rest shapes, masses).
  _yield(o, n, h2, beta, only) {
    const sb = this.app.sb, x = sb.x, X = sb.X;
    const A = new Float64Array(9), R = new Float64Array(9);
    for (const pc of sb.pieces) {
      if (!only.has(pc.id)) continue;
      const vs = pc.verts;
      let near = false;
      for (const i of vs) if (Math.abs((x[i * 3] - o[0]) * n[0] + (x[i * 3 + 1] - o[1]) * n[1] + (x[i * 3 + 2] - o[2]) * n[2]) < h2) near = true;
      if (!near) continue;
      let M = 0, Cx = 0, Cy = 0, Cz = 0, cx = 0, cy = 0, cz = 0;
      for (const i of vs) {
        const o3 = i * 3, m = sb.m[i] || 1e-6;
        M += m;
        Cx += X[o3] * m; Cy += X[o3 + 1] * m; Cz += X[o3 + 2] * m;
        cx += x[o3] * m; cy += x[o3 + 1] * m; cz += x[o3 + 2] * m;
      }
      Cx /= M; Cy /= M; Cz /= M; cx /= M; cy /= M; cz /= M;
      A.fill(0);
      for (const i of vs) {
        const o3 = i * 3, m = sb.m[i] || 1e-6;
        const dx = (x[o3] - cx) * m, dy = (x[o3 + 1] - cy) * m, dz = (x[o3 + 2] - cz) * m;
        const rx = X[o3] - Cx, ry = X[o3 + 1] - Cy, rz = X[o3 + 2] - Cz;
        A[0] += dx * rx; A[1] += dx * ry; A[2] += dx * rz;
        A[3] += dy * rx; A[4] += dy * ry; A[5] += dy * rz;
        A[6] += dz * rx; A[7] += dz * ry; A[8] += dz * rz;
      }
      polarRot(new Float64Array([0, 0, 0, 1]), A, R, 24);
      for (const i of vs) {
        const o3 = i * 3, d = Math.abs((x[o3] - o[0]) * n[0] + (x[o3 + 1] - o[1]) * n[1] + (x[o3 + 2] - o[2]) * n[2]);
        if (d >= h2) continue;
        const w = beta * (1 - (d / h2) * (d / h2));
        // R^T (x - c) + C: where it is now, in the rest frame
        const ux = x[o3] - cx, uy = x[o3 + 1] - cy, uz = x[o3 + 2] - cz;
        const gx = Cx + R[0] * ux + R[3] * uy + R[6] * uz, gy = Cy + R[1] * ux + R[4] * uy + R[7] * uz, gz = Cz + R[2] * ux + R[5] * uy + R[8] * uz;
        X[o3] += w * (gx - X[o3]); X[o3 + 1] += w * (gy - X[o3 + 1]); X[o3 + 2] += w * (gz - X[o3 + 2]);
      }
    }
  }

  // Gummy jelly comes apart in strings: across the stretch of slit just
  // opened (pairs: [vertex, its copy, ...]), a few strands of goo, spaced
  // out - more, thicker and longer-drawn the gooier it is (see Strands).
  _strands(pairs) {
    const app = this.app, sb = app.sb, g = app.st?.goo ?? 0.35;
    if (!(g > 0.02) || !app.strands || !pairs.length) return;
    const want = Math.round(g * (1 + 2 * Math.random())), min2 = (0.1 * sb.p.size) ** 2, x = sb.x;
    const order = Array.from({ length: pairs.length / 2 }, (_, k) => k).sort(() => Math.random() - 0.5);
    const picked = [], col = new THREE.Color();
    for (const k of order) {
      if (picked.length >= want) break;
      const i = pairs[k * 2], j = pairs[k * 2 + 1];
      if (picked.some((p) => (x[i * 3] - x[p * 3]) ** 2 + (x[i * 3 + 1] - x[p * 3 + 1]) ** 2 + (x[i * 3 + 2] - x[p * 3 + 2]) ** 2 < min2)) continue;
      picked.push(i);
      col.set(app.flavorColorAtVertex(i));
      app.strands.add(i, j, g, [col.r, col.g, col.b]);
    }
  }

  // (0..1) how much it yields rather than springs back: goo all, jello some,
  // gummy and stiffer hardly or not at all
  _plastic() {
    return Math.max(0, Math.min(1, 1.1 - 1.6 * this._stiffness()));
  }

  // (how far through it is, as softness in the band: most in its middle)
  _damage(t) {
    const D = this.app.sb.tDmg, p = Math.min(1, t.p);
    for (let q = 0; q < t.band.length; q++) D[t.band[q]] = p * t.prof[q];
  }

  _endTear() {
    const t = this.tear;
    if (!t) return;
    this.tear = null;
    const sb = this.app.sb;
    if (t.ver !== sb.topoVersion) return; // (a rebuild cleared it already)
    for (let q = 0; q < t.band.length; q++) sb.tDmg[t.band[q]] = 0;
  }

  // How stiff the jelly is, 0 (pudding) .. 1 (rubber, or rigid)
  _stiffness() {
    const p = this.app.sb.p;
    return Math.max(Math.min(1, Math.max(0, Math.log(p.mu / 45) / Math.log(1000 / 45))), p.rigidity);
  }

  // The stretch it starts to tear at: its material's, more the softer it
  // is (stiff stuff can't be drawn out far), times the toughness; much less
  // where frozen, more where melting.
  _tearLimit(m) {
    const app = this.app, sb = app.sb;
    let lim = (TEAR[app.style?.texture] || 2) * (1.08 + 0.17 * (1 - this._stiffness())) * Math.sqrt(app.st?.tough ?? 1);
    if (m) {
      const T = sb.T, t4 = m.t * 4;
      const temp = (sb.temp[T[t4]] + sb.temp[T[t4 + 1]] + sb.temp[T[t4 + 2]] + sb.temp[T[t4 + 3]]) / 4;
      if (temp < -0.3) lim = Math.min(lim, 1.12);
      else if (temp > 0.4) lim *= 1.3; // (melting: gooier)
    }
    return lim;
  }

  // (s) how long it gives, pulled just past its limit, before it parts:
  // stiff stuff quickly, soft stuff draws out
  _tearTime() {
    return (0.6 + 1.6 * (1 - this._stiffness())) * (this.app.st?.tough ?? 1);
  }
}

// A torn surface, not a cut one: the field's zero set rippled by a few
// crossed waves (random each tear), amp high; the normal by differences.
function ragged(f, amp) {
  const W = [];
  for (let i = 0; i < 4; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    W.push([r * Math.cos(th), u, r * Math.sin(th), 5 + Math.random() * 9, Math.random() * 6.3]);
  }
  const wav = (x, y, z) => {
    let s = 0;
    for (const [a, b, c, k, ph] of W) s += Math.sin((a * x + b * y + c * z) * k + ph);
    return (s * amp) / 2;
  };
  const value = (x, y, z) => f.value(x, y, z) + wav(x, y, z);
  const e = 0.002;
  return {
    value,
    normal: (x, y, z, out) => {
      const gx = value(x + e, y, z) - value(x - e, y, z), gy = value(x, y + e, z) - value(x, y - e, z), gz = value(x, y, z + e) - value(x, y, z - e);
      const l = Math.hypot(gx, gy, gz) || 1;
      out[0] = gx / l; out[1] = gy / l; out[2] = gz / l;
      return out;
    },
    inRegion: f.inRegion,
  };
}

function tetCentre(sb, t) {
  const T = sb.T, x = sb.x, c = [0, 0, 0];
  for (let j = 0; j < 4; j++) for (let k = 0; k < 3; k++) c[k] += x[T[t * 4 + j] * 3 + k] / 4;
  return c;
}

// ------------------------------------------------------------------ knife
export class KnifeTool {
  constructor(app) {
    this.app = app;
    this.id = 'knife';
    this.cursor = 'crosshair';
    this.stroke = null;
  }

  down(e) {
    this.stroke = { ax: e.clientX, ay: e.clientY, bx: e.clientX, by: e.clientY, t0: performance.now() };
    this.app.overlay.setStroke(this.stroke);
    return true;
  }

  move(e) {
    if (!this.stroke) return;
    this.stroke.bx = e.clientX;
    this.stroke.by = e.clientY;
    this.app.overlay.setStroke(this.stroke);
  }

  up() {
    const s = this.stroke;
    this.stroke = null;
    this.app.overlay.setStroke(null);
    if (!s) return;
    const len = Math.hypot(s.bx - s.ax, s.by - s.ay);
    if (len < 18) return;
    this.app.overlay.slash(s);
    this.cut(s.ax, s.ay, s.bx, s.by);
  }

  // Cut with the plane through the eye and the screen-space stroke.
  cut(ax, ay, bx, by) {
    const app = this.app;
    if (app.sb.nT > 30000) {
      app.ui?.hint('That is a lot of jelly bits — hit Re-cube first');
      return false;
    }
    const cam = app.camera;
    const ra = app.rayFromClient(ax, ay).direction.clone();
    const rb = app.rayFromClient(bx, by).direction.clone();
    const n = new THREE.Vector3().crossVectors(ra, rb);
    if (n.lengthSq() < 1e-10) return false;
    n.normalize();
    const eye = cam.position.clone();
    const d = n.dot(eye);
    const rect = app.canvas.getBoundingClientRect();
    const sx = bx - ax, sy = by - ay;
    const L2 = sx * sx + sy * sy;
    const proj = new THREE.Vector3();
    const region = (x, y, z) => {
      proj.set(x, y, z).project(cam);
      const px = rect.left + (proj.x * 0.5 + 0.5) * rect.width;
      const py = rect.top + (-proj.y * 0.5 + 0.5) * rect.height;
      const t = ((px - ax) * sx + (py - ay) * sy) / L2;
      return t >= -0.015 && t <= 1.015;
    };
    const before = app.sb.pieces.length;
    const res = cutBody(app.sb, planeField(n.x, n.y, n.z, d, region), {
      separate: 0.35 * (this.app.st?.knifePush ?? 1),
      anchors: app.allAnchors(),
    });
    if (!res.changed) {
      app.audio?.swish(0.4);
      return false;
    }
    app.onTopologyChanged();
    app.audio?.slice(app.sb.pieces.length > before ? 1 : 0.6);
    app.markDamaged();
    app.tally?.('cuts');
    return true;
  }
}

// ------------------------------------------------------------------ nail gun
export class NailGunTool {
  constructor(app) {
    this.app = app;
    this.id = 'nailgun';
    this.cursor = 'crosshair';
    this.firing = false;
    this.cool = 0;
    this.ray = new THREE.Ray();
    this.model = makeNailGun(app.M);
    this.model.visible = false;
    this.model.traverse((o) => (o.castShadow = false));
    app.scene.add(this.model);
    this.recoil = 0;
    this.aim = new THREE.Vector3(0, 0.5, 0);
  }

  activate() {
    this.model.visible = true;
  }

  deactivate() {
    this.model.visible = false;
    this.firing = false;
  }

  hover(e, ray) {
    if (ray) this.ray.copy(ray);
  }

  // viewmodel: bottom-right of the screen, aimed at what's under the cursor
  _placeModel(dt) {
    const cam = this.app.camera;
    const hit = this.app.pickJelly(this.ray);
    const goal = hit ? new THREE.Vector3(...hit.point) : this.ray.origin.clone().addScaledVector(this.ray.direction, 4);
    this.aim.lerp(goal, 1 - Math.exp(-dt * 18));
    // anchor to a fixed spot on screen (bottom-right), whatever the aspect
    const D = 1.75;
    const ty = Math.tan((cam.fov * Math.PI) / 360);
    const off = new THREE.Vector3(0.74 * ty * cam.aspect * D, -0.6 * ty * D, -D).applyQuaternion(cam.quaternion);
    const pos = cam.position.clone().add(off);
    this.model.position.copy(pos);
    this.model.lookAt(this.aim);
    this.model.rotateY(Math.PI);
    this.recoil *= Math.exp(-dt * 14);
    this.model.translateZ(this.recoil * 0.08);
    this.model.rotateX(this.recoil * 0.25);
    this.model.updateMatrixWorld();
    return pos;
  }

  down(e, ray) {
    this.firing = true;
    this.ray.copy(ray);
    this.cool = 0;
    this.fire();
    return true;
  }

  move(e, ray) {
    this.ray.copy(ray);
  }

  up() {
    this.firing = false;
  }

  update(dt, rdt) {
    this._placeModel(rdt || dt);
    if (!this.firing) return;
    this.cool -= dt;
    if (this.cool <= 0) this.fire();
  }

  fire() {
    const app = this.app;
    this.cool = 0.16;
    app.tally?.('shots');
    const cam = app.camera;
    // muzzle sits just off-screen bottom-right, aimed at what's under the cursor
    const r = this.ray;
    // muzzle of the viewmodel
    const origin = this.model.localToWorld(new THREE.Vector3(0, 0, 0.06).multiplyScalar(-1));
    this.recoil = 1;
    this.app.particles.flash(origin, 0.05, [6, 5, 4]);
    const hit = app.pickJelly(r);
    let target;
    if (hit) target = new THREE.Vector3(...hit.point);
    else {
      const t = r.direction.y < -1e-3 ? -r.origin.y / r.direction.y : 6;
      target = r.origin.clone().addScaledVector(r.direction, Math.min(t, 8));
    }
    const dir = target.clone().sub(origin).normalize();
    // small spread
    dir.x += (Math.random() - 0.5) * 0.006;
    dir.y += (Math.random() - 0.5) * 0.006;
    dir.normalize();
    app.nails.fire(origin, dir, 34 * (app.st?.nailPower ?? 1));
    app.audio?.nailgun();
    app.shake(0.004);
  }
}

// ------------------------------------------------------------------ hole gun
// A pistol that punches a hole through the jelly - ballistic gel, more or
// less. Along the line of sight (from the eye, through what's under the
// cursor; the pistol on screen is for show):
// - the round bores a ragged tunnel - the permanent channel: the jelly in it
//   is crushed and sprayed out of the far side;
// - it throws the jelly round the path outward - the temporary cavity: it
//   balloons, and collapses into a wobble (SoftBody.cavity);
// - it slows as it goes: soft jelly it goes clean through, firm or rigid stuff
//   stops it inside (a blind hole);
// - frozen jelly shatters instead.
// Hold for a shot every 0.45 s.
export class HoleGunTool extends NailGunTool {
  constructor(app) {
    super(app);
    this.id = 'holegun';
    app.scene.remove(this.model);
    this.model = makeHoleGun(app.M);
    this.model.visible = false;
    this.model.traverse((o) => (o.castShadow = false));
    app.scene.add(this.model);
  }

  fire() {
    const app = this.app;
    this.cool = 0.45;
    app.tally?.('shots');
    const muzzle = this.model.localToWorld(new THREE.Vector3(0, 0.05, -0.09));
    this.recoil = 1.6;
    app.particles.flash(muzzle, 0.09, [9, 7, 4]);
    app.particles.smoke(muzzle, 3, 0.15, 0.6, 0.4, 0.15);
    app.shake(0.012);
    this.bore(this.ray.origin, this.ray.direction);
  }

  // A round along o + t d (d unit): its tunnel, spray and cavity. (light: a
  // full-auto round - a narrower tunnel, a smaller kick, no pause, no bang:
  // the gun makes its own.) True if it hit jelly.
  bore(o, d, light = false) {
    const app = this.app, sb = app.sb, p = sb.p, size = p.size;
    const segs = jellyAlong(sb, o, d);
    if (!segs.length || sb.nT > 30000) {
      if (!light) app.audio?.gunshot(0);
      return false;
    }
    const power = app.st?.gunPower ?? 1;
    const at = (t) => new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
    const entry = at(segs[0][0]);
    // frozen there: it shatters (as under the mallet)
    let cold = 0, n = 0;
    for (let i = 0; i < sb.nV; i++) {
      if (!sb.alive[i]) continue;
      const dx = sb.x[i * 3] - entry.x, dy = sb.x[i * 3 + 1] - entry.y, dz = sb.x[i * 3 + 2] - entry.z;
      if (dx * dx + dy * dy + dz * dz < 0.09) {
        cold += sb.temp[i];
        n++;
      }
    }
    if (n && cold / n < -0.4 && app.tools.mallet?.shatter) {
      app.tools.mallet.shatter({ tg: { point: entry, hit: { piece: segs[0][2] } }, d: d.clone() });
      if (!light) app.audio?.gunshot(0.5);
      return true;
    }
    // how far it gets: through soft jelly easily, firm much less, rigid hardly
    const firm = Math.min(1, Math.max(0, Math.log(p.mu / 45) / Math.log(1000 / 45)));
    let left = (2.4 - 1.7 * firm) * size * (1 - 0.6 * p.rigidity) * power / Math.sqrt(p.density), tEnd = null;
    for (const [t0, t1] of segs) {
      if (t1 - t0 >= left) {
        tEnd = t0 + left;
        break;
      }
      left -= t1 - t0;
    }
    const through = tEnd === null;
    const tA = segs[0][0] - 0.06, tB = through ? segs[segs.length - 1][1] + 0.06 : tEnd;
    // (at least ~3/4 of a cell across: the cut's inside and outside are told at
    // the mesh's vertices, and a thinner tunnel can slip between them all)
    const A = at(tA), B = at(tB), r = Math.max(0.045 * size * Math.pow(power, 0.35) * (light ? 0.75 : 1), 0.75 * sb.hCell);
    // the channel: a ragged tunnel, its plug crushed out
    const anchors = app.allAnchors();
    const res = cutBody(sb, ragged(capsuleField(A, B, r), 0.22 * r), { separate: 0, snap: 0.15, anchors });
    let vol = 0;
    if (res.changed) {
      const L = A.distanceTo(B), plug = new Set();
      for (const pc of sb.pieces) {
        if (pc.volume > Math.PI * r * r * L * 2.5) continue;
        let cx = 0, cy = 0, cz = 0, m = 0;
        for (const i of pc.verts) {
          cx += sb.x[i * 3] * sb.m[i]; cy += sb.x[i * 3 + 1] * sb.m[i]; cz += sb.x[i * 3 + 2] * sb.m[i];
          m += sb.m[i];
        }
        if (m > 0 && segDist(cx / m, cy / m, cz / m, A, B) < 1.6 * r) plug.add(pc.id);
      }
      if (plug.size)
        removeTets(sb, (t) => {
          if (!plug.has(sb.tPiece[t])) return false;
          vol += sb.vol0[t];
          return true;
        }, anchors);
      removeSmallPieces(sb, 0.0015 * size ** 3, anchors);
      app.onTopologyChanged();
      app.markDamaged();
    }
    // spray: what was crushed out flies on out of the far side (or back out
    // of a blind hole), a splash back out of the entry
    const out = through ? B : A, outDir = through ? d : d.clone().negate();
    let k = 0;
    for (let v = vol * 0.8; v > 0 && k < 26; k++) {
      const rr = 0.012 + Math.random() * 0.022;
      v -= (4 / 3) * Math.PI * rr ** 3;
      const dir = outDir.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).multiplyScalar(0.7)).normalize();
      app.droplets.spawn(out.clone().addScaledVector(dir, 0.03), dir.multiplyScalar((through ? 5 : 2.5) + Math.random() * 4), rr);
    }
    for (let j = 0; j < 3; j++) {
      const dir = d.clone().negate().add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(0.8)).normalize();
      app.droplets.spawn(entry.clone().addScaledVector(dir, 0.03), dir.multiplyScalar(1.5 + Math.random() * 2), 0.01 + Math.random() * 0.01);
    }
    // the temporary cavity: soft jelly balloons more and further; stiff
    // stuff hardly (it can't open far before it stops the round), rigid less
    const kick = (3 + 13 * (1 - firm) ** 1.5) * (1 - 0.7 * p.rigidity) * power * (light ? 0.45 : 1);
    // (not right at the tunnel's ends: kicked there, its mouth's thin wall
    // folds through itself)
    const t0 = segs[0][0], t1 = through ? segs[segs.length - 1][1] : tEnd, inset = 0.12 * (t1 - t0);
    const CA = at(t0 + inset), CB = at(t1 - inset);
    sb.cavity(CA.x, CA.y, CA.z, CB.x, CB.y, CB.z, (0.24 + 0.18 * (1 - firm)) * size * Math.pow(power, 0.4), kick, through ? 0.55 : 0.2, 1.8 * power * (1 - firm) * (1 - 0.7 * p.rigidity));
    app.glowPulse?.(entry.x, entry.y, entry.z, light ? 0.6 : 1);
    if (light) return true;
    app.hitStop?.(0.05);
    app.audio?.gunshot(through ? 1 : 0.7);
    return true;
  }
}

// Where a line (o + t d, d unit) runs through the jelly: [t0, t1, piece]
// runs, merged where they touch (within a cm). Each tet near the line is
// clipped against its four faces.
export function jellyAlong(sb, o, d) {
  const T = sb.T, x = sb.x, runs = [];
  const ox = o.x, oy = o.y, oz = o.z, dx = d.x, dy = d.y, dz = d.z;
  for (let t = 0; t < sb.nT; t++) {
    if (sb.vol0[t] <= 0) continue;
    const t4 = t * 4, v = [T[t4] * 3, T[t4 + 1] * 3, T[t4 + 2] * 3, T[t4 + 3] * 3];
    let cx = 0, cy = 0, cz = 0;
    for (const i of v) {
      cx += x[i] / 4; cy += x[i + 1] / 4; cz += x[i + 2] / 4;
    }
    let R2 = 0;
    for (const i of v) R2 = Math.max(R2, (x[i] - cx) ** 2 + (x[i + 1] - cy) ** 2 + (x[i + 2] - cz) ** 2);
    const qx = cx - ox, qy = cy - oy, qz = cz - oz, tq = qx * dx + qy * dy + qz * dz;
    if (qx * qx + qy * qy + qz * qz - tq * tq > R2 || tq < -Math.sqrt(R2)) continue;
    let t0 = -Infinity, t1 = Infinity;
    for (let f = 0; f < 4 && t0 < t1; f++) {
      const a = v[(f + 1) % 4], b = v[(f + 2) % 4], c = v[(f + 3) % 4], k = v[f];
      let nx = (x[b + 1] - x[a + 1]) * (x[c + 2] - x[a + 2]) - (x[b + 2] - x[a + 2]) * (x[c + 1] - x[a + 1]);
      let ny = (x[b + 2] - x[a + 2]) * (x[c] - x[a]) - (x[b] - x[a]) * (x[c + 2] - x[a + 2]);
      let nz = (x[b] - x[a]) * (x[c + 1] - x[a + 1]) - (x[b + 1] - x[a + 1]) * (x[c] - x[a]);
      // (outward: away from the corner it's opposite)
      if (nx * (x[k] - x[a]) + ny * (x[k + 1] - x[a + 1]) + nz * (x[k + 2] - x[a + 2]) > 0) {
        nx = -nx; ny = -ny; nz = -nz;
      }
      const num = nx * (x[a] - ox) + ny * (x[a + 1] - oy) + nz * (x[a + 2] - oz), den = nx * dx + ny * dy + nz * dz;
      if (Math.abs(den) < 1e-12) {
        if (num < 0) t0 = Infinity;
      } else if (den > 0) t1 = Math.min(t1, num / den);
      else t0 = Math.max(t0, num / den);
    }
    if (t0 < t1 && t1 > 0) runs.push([Math.max(0, t0), t1, sb.tPiece[t]]);
  }
  runs.sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 0.01) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1], r[2]]);
  }
  return out;
}

// A capsule round the segment a-b, radius r: distance to the segment, less r.
export function capsuleField(a, b, r) {
  return {
    value: (x, y, z) => segDist(x, y, z, a, b) - r,
    normal: (x, y, z, out) => out,
    inRegion: null,
  };
}

function segDist(x, y, z, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L2 = dx * dx + dy * dy + dz * dz;
  const s = L2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy + (z - a.z) * dz) / L2)) : 0;
  const px = x - a.x - dx * s, py = y - a.y - dy * s, pz = z - a.z - dz * s;
  return Math.sqrt(px * px + py * py + pz * pz);
}
