// A cube full of liquid is a shell with real liquid in it. Made - loaded, added, re-cubed, its filling or its
// liquid's look changed - its inside (its tets clear of its skin) is taken out, and as much of the space that
// leaves as Settings > Liquid > Fill says (empty to full, from the bottom up) is filled with the Fluid's drops,
// in its colour, as runny as it is; its glitter and bubbles ride them (see Glitter.poolFrom, Bubbles.poolFrom).
// Gone - taken out, made again - its liquid goes with it, wherever it's got to (see update).
// Whole, its hollow is sealed - liquid and air shut in, its volume held (see SoftBody._solveCavities) - till
// it's cut into: then its walls stand as they can, and what's in it runs out of wherever it's open, as fast
// as the opening lets it (a fine crack holds it back: see Fluid._gaps). Nothing turns to liquid when it's
// cut, no rate's worked out for a slit: the liquid was liquid all along, its level real.
// (It was jelly before - soft tets, only looking like liquid - turned to liquid when cut open: its level
// never real, a slit's leak a sum, and the cube never emptied however long a slit was held open.)
import * as THREE from 'three';
import { removeTets } from '../sim/cutting.js';
import { TAG_EXTERIOR, REST_STEP, polarRot } from '../sim/softbody.js';
import { shapeSDF } from '../sim/mesh.js';
import { liquidVisc } from './fluid.js';

const OVER = 1.2; // (how much closer drops stand settled in a hollow than laid out D apart: see _hollow)
// (how many drops a full cube's liquid is, at most - each as big as that takes: a full one's every drop lives
// as long as the cube does, and is worked out every frame it's moving - 900 took the liquid 20 ms a frame)
const FILL_N = +(globalThis.__fillN ?? 520);

export class Spill {
  constructor(app) {
    this.app = app;
    this.drained = 0; // (m^3 of liquid made into drops, all told - for ?stats and the harnesses)
    this.ver = -1; // (the topology the hollows were last looked at)
    this.cv = -1; // (and the cubes)
    this.ocv = -1; // (the cubes as of the last look for liquid whose cube's gone)
    this.hid = 0; // (the last cube full of liquid's mark on its drops - see SoftBody.cHid)
    this._c = new THREE.Color();
  }

  update() {
    const app = this.app, sb = app.sb, fl = app.fluid;
    // (a cube full of liquid gone - taken out, swapped, re-cubed, made again - its liquid goes with it, wherever
    // it's got to; back, it's filled afresh. Not while the liquid's flowing home to a heal: that's going anyway.)
    if (sb.cubeVersion !== this.ocv && !fl.rc) {
      this.ocv = sb.cubeVersion;
      const live = new Set(), own = fl.own;
      for (let k = 0; k < sb.cHid.length; k++) if (sb.cHid[k]) live.add(sb.cHid[k]);
      let gone = false;
      for (let i = 0; i < fl.n && !gone; i++) gone = own[i] !== 0 && !live.has(own[i]);
      if (gone) fl.removeWhere((i) => own[i] !== 0 && !live.has(own[i]));
    }
    // (swapped: only while the old one's on its way out - the new one, dropping in, is made hollow at once: left
    // till it had landed and settled, a cube full of liquid came down solid and turned to liquid after)
    if (app.healer?.active || (app.swapper?.active && app.swapper.phase === 'exit') || app.cubiplication?.active || fl.rc || !sb.nT) return;
    for (const cb of app.cubes) if (sb.cLiq[cb.slot] && !sb.cHollow[cb.slot]) this._hollow(sb, cb.slot);
    if (sb.topoVersion !== this.ver || sb.cubeVersion !== this.cv) this._seal(sb);
  }

  // Cube k made a shell: its inside out, its wall as thick as its skin, and its hollow filled from the bottom as
  // full as it's to be.
  _hollow(sb, k) {
    const app = this.app, fl = app.fluid, col = this._c;
    if (sb._liqTopo !== sb.topoVersion || sb._liqDirty) sb._liquidTets();
    const skin = sb._skinT, on = sb._skinV, T = sb.T, x = sb.x, v = sb.v, tc = sb.tCube, X = sb.X, vc = sb.vCube;
    if (!skin || !on) return;
    // its wall as thick as its skin (Settings > Liquid > Skin): from 5 cm, ultrathin (a drop's width - any thinner,
    // its drops went through it), by 9, medium, to 18, thick (a 1 m cube's). (The wall was always the one cell it's
    // made of; the slider only how firm it was.) Its inside - its tets all deeper in than that, in its rest shape -
    // taken out; the rest, its wall, kept. (Always clear of its skin: the skin's own tets, those with a face on the
    // outside, meet only at their edges - on their own, a field of pyramids.)
    const size = sb.cSize[k], half = size / 2, bevel = sb.cBevel[k], shape = sb.shapeOf(k), ox = k * REST_STEP;
    const sk = Math.min(1, Math.max(0, sb.cSkin[k])), th = size * (sk <= 0.5 ? 0.05 + 0.08 * sk : 0.09 + 0.18 * (sk - 0.5));
    const deep = (rx, ry, rz) => -shapeSDF(rx - ox, ry, rz, half, bevel, shape);
    const dep = new Float32Array(sb.nV);
    for (let i = 0; i < sb.nV; i++) if (vc[i] === k) dep[i] = deep(X[i * 3], X[i * 3 + 1], X[i * 3 + 2]);
    const inner = [], keep = new Uint8Array(sb.nV), lim = Math.max(th, 0.5 * sb.cH[k]) - 1e-4;
    for (let t = 0; t < sb.nT; t++) {
      if (tc[t] !== k) continue;
      const q = t * 4, a = T[q], b = T[q + 1], c = T[q + 2], e = T[q + 3];
      if (!skin[t] && sb.vol0[t] > 0 && !(on[a] | on[b] | on[c] | on[e]) && dep[a] >= lim && dep[b] >= lim && dep[c] >= lim && dep[e] >= lim) inner.push(t);
      else keep[a] = keep[b] = keep[c] = keep[e] = 1;
    }
    sb.cHollow[k] = 1;
    sb._liqDirty = true;
    if (!inner.length) return;
    // as it stands: its rest shape turned (the turn that fits it best) about its middle, moving as a whole
    let n0 = 0;
    const xm = [0, 0, 0], Xm = [0, 0, 0], vm = [0, 0, 0];
    for (let i = 0; i < sb.nV; i++) {
      if (vc[i] !== k || !sb.alive[i]) continue;
      for (let a = 0; a < 3; a++) (xm[a] += x[i * 3 + a]), (Xm[a] += X[i * 3 + a]), (vm[a] += v[i * 3 + a]);
      n0++;
    }
    if (!n0) return;
    for (let a = 0; a < 3; a++) (xm[a] /= n0), (Xm[a] /= n0), (vm[a] /= n0);
    const A = new Float64Array(9), R = new Float64Array(9), qr = new Float64Array([0, 0, 0, 1]);
    for (let i = 0; i < sb.nV; i++) {
      if (vc[i] !== k || !sb.alive[i]) continue;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) A[r * 3 + c] += (x[i * 3 + r] - xm[r]) * (X[i * 3 + c] - Xm[c]);
    }
    polarRot(qr, A, R, 30);
    // its hollow's volume as made - what it holds: its rest shape sampled
    const sp = sb.cH[k] / 3;
    let cnt = 0;
    for (let a = -half + sp / 2; a < half; a += sp)
      for (let b = -half + sp / 2; b < half; b += sp)
        for (let c = -half + sp / 2; c < half; c += sp) if (-shapeSDF(a, b, c, half, bevel, shape) > th) cnt++;
    const V = cnt * sp * sp * sp;
    // the drops' size: all its hollow's worth in FILL_N of them, or the pool's budget (set only while there's
    // none - else as they are, and as many as there's room for) - laid out a little closer than they sit (OVER:
    // settled, against its walls, they stand that much closer - laid out D apart, a full cube's settled a fifth
    // short)
    const room = Math.max(0, Math.floor(fl.max * 0.96) - fl.n);
    if (!fl.n) fl.setDrop(Math.max(0.065, Math.cbrt((OVER * V) / Math.max(1, Math.min(room, FILL_N)))));
    const D = fl.D, d = D / Math.cbrt(OVER), fill = Math.min(1, Math.max(0, sb.cFill[k]));
    // where they go: a lattice d apart over it as it stands, each point taken back into its rest shape by the
    // turn and kept if it's that deep and half a spacing more. (Laid through its rest shape and carried out by
    // its sag as it stood, they were a tenth too close: packed in from the start, the column fell in on itself
    // to half its height.)
    let lo0 = Infinity, lo1 = Infinity, lo2 = Infinity, hi0 = -Infinity, hi1 = -Infinity, hi2 = -Infinity;
    for (let i = 0; i < sb.nV; i++) {
      if (vc[i] !== k || !sb.alive[i]) continue;
      const o = i * 3;
      lo0 = Math.min(lo0, x[o]); hi0 = Math.max(hi0, x[o]);
      lo1 = Math.min(lo1, x[o + 1]); hi1 = Math.max(hi1, x[o + 1]);
      lo2 = Math.min(lo2, x[o + 2]); hi2 = Math.max(hi2, x[o + 2]);
    }
    const P = [], need = th + 0.1 * d;
    for (let ix = Math.ceil(lo0 / d); ix * d <= hi0; ix++)
      for (let iy = Math.ceil(lo1 / d); iy * d <= hi1; iy++)
        for (let iz = Math.ceil(lo2 / d); iz * d <= hi2; iz++) {
          const px = ix * d - xm[0], py = iy * d - xm[1], pz = iz * d - xm[2];
          // (R's transpose: world back to rest)
          const rx = Xm[0] + R[0] * px + R[3] * py + R[6] * pz, ry = Xm[1] + R[1] * px + R[4] * py + R[7] * pz, rz = Xm[2] + R[2] * px + R[5] * py + R[8] * pz;
          if (deep(rx, ry, rz) > need) P.push([ix * d, iy * d, iz * d, rx, ry, rz]);
        }
    // as full as it's to be: its lowest share of them - of as many as its hollow holds as made (laid through it
    // stretched or squashed as it was just then, a few in ten more or less: re-cubed, it came out overfull)
    // - as many as there's room for
    P.sort((p, q) => p[1] - q[1]);
    const n = Math.min(room, P.length, Math.round(fill * ((OVER * V) / D ** 3)));
    const [fv, ft] = liquidVisc(sb.cVisc[k]), p0 = fl.n;
    // (its colour: its own, if it's been given one - else its jelly's, each drop the colour where it was poured from)
    const lc = app.cubes?.find((c) => c.slot === k)?.style?.liqColor || '';
    if (lc) col.set(lc);
    for (let i = 0; i < n; i++) {
      const [px, py, pz, rx, ry, rz] = P[i];
      if (!lc) col.set(app.flavorColorAtRest(rx, ry, rz, k));
      fl.add(px, py, pz, fl.vol * 1.000001, vm[0], vm[1], vm[2], col.r, col.g, col.b, 0.004, 0, fv, ft, 1);
    }
    // (settled liquid, not just made: the solver holds it up at full strength from the first - see Fluid's
    // GAIN - else the column fell in on itself before it could; and marked as this cube's)
    sb.cHid[k] = ++this.hid;
    for (let i = p0; i < fl.n; i++) (fl.age[i] = 1), (fl.own[i] = this.hid), (fl.tens[i] = sb.cTens[k]);
    this.drained += (fl.n - p0) * fl.vol;
    // (what's in it - the glitter on the nearest of them; its bubbles all through it, none left in its wall or
    // hollow: see Bubbles.intoLiquid)
    if (fl.n > p0) app.glitter?.poolFrom(inner, p0, fl.n);
    app.bubbles?.intoLiquid(k);
    // its wall thinned to that: each of its hollow's vertices (kept, off its skin) out to that depth - straight out
    // from each face it's on (along the line from its middle, its faces dished or bulged), but never shallower than
    // that under a rounded edge or corner - in its rest shape and as it stands (turned so); a vertex that would
    // squash a tet of the wall flat only part of the way; then its inside taken out.
    // (All out along the lines from its middle, an ultrathin wall's edges went flat and the cube fell in.) And its
    // hollow's box in its rest shape - see Fluid._collide.
    const cav = [];
    for (let i = 0; i < sb.nV; i++) if (keep[i] && !on[i] && vc[i] === k && dep[i] > th + 1e-4) cav.push(i);
    const DX = new Float64Array(cav.length * 3), U = new Float64Array(cav.length).fill(1), slot = new Int32Array(sb.nV).fill(-1);
    const band = th + 1.25 * sb.cH[k], bowed = !!(shape && shape.bow);
    for (let m = 0; m < cav.length; m++) {
      const i = cav[m], o = i * 3, ux = X[o] - ox, uy = X[o + 1], uz = X[o + 2];
      slot[i] = m;
      let tx = ux, ty = uy, tz = uz;
      if (bowed) {
        const r = Math.sqrt(ux * ux + uy * uy + uz * uz);
        if (r > 1e-9) {
          let lo = 0, hi = 2 * half;
          for (let it = 0; it < 26; it++) {
            const mid = (lo + hi) / 2;
            if (-shapeSDF((ux * mid) / r, (uy * mid) / r, (uz * mid) / r, half, bevel, shape) > th) lo = mid;
            else hi = mid;
          }
          tx = (ux * lo) / r; ty = (uy * lo) / r; tz = (uz * lo) / r;
        }
      } else {
        if (half - Math.abs(ux) < band) tx = Math.sign(ux) * (half - th);
        if (half - Math.abs(uy) < band) ty = Math.sign(uy) * (half - th);
        if (half - Math.abs(uz) < band) tz = Math.sign(uz) * (half - th);
        // (a rounded edge's or corner's: back in along the way till it's as deep as the wall is thick)
        if (-shapeSDF(tx, ty, tz, half, bevel, shape) < th) {
          let lo = 0, hi = 1;
          for (let it = 0; it < 24; it++) {
            const mid = (lo + hi) / 2;
            if (-shapeSDF(ux + (tx - ux) * mid, uy + (ty - uy) * mid, uz + (tz - uz) * mid, half, bevel, shape) >= th) lo = mid;
            else hi = mid;
          }
          tx = ux + (tx - ux) * lo; ty = uy + (ty - uy) * lo; tz = uz + (tz - uz) * lo;
        }
      }
      DX[m * 3] = tx - ux; DX[m * 3 + 1] = ty - uy; DX[m * 3 + 2] = tz - uz;
    }
    // (the wall's tets with a vertex moving: none squashed to under half what the wall's thinned by - flat)
    const wallT = [], flat = 0.5 * Math.min(1, th / sb.cH[k]);
    for (let t = 0; t < sb.nT; t++) {
      if (tc[t] !== k || !(sb.vol0[t] > 0)) continue;
      const q = t * 4;
      if (slot[T[q]] >= 0 || slot[T[q + 1]] >= 0 || slot[T[q + 2]] >= 0 || slot[T[q + 3]] >= 0) wallT.push(t);
    }
    const go = new Set(inner), Pt = (i, a) => X[i * 3 + a] + (slot[i] >= 0 ? DX[slot[i] * 3 + a] * U[slot[i]] : 0);
    for (let round = 0; round < 10; round++) {
      let bad = 0;
      for (const t of wallT) {
        if (go.has(t)) continue;
        const q = t * 4, a = T[q], b = T[q + 1], c = T[q + 2], e = T[q + 3];
        const ax = Pt(a, 0), ay = Pt(a, 1), az = Pt(a, 2);
        const e1x = Pt(b, 0) - ax, e1y = Pt(b, 1) - ay, e1z = Pt(b, 2) - az, e2x = Pt(c, 0) - ax, e2y = Pt(c, 1) - ay, e2z = Pt(c, 2) - az, e3x = Pt(e, 0) - ax, e3y = Pt(e, 1) - ay, e3z = Pt(e, 2) - az;
        const vol = (e1x * (e2y * e3z - e2z * e3y) + e1y * (e2z * e3x - e2x * e3z) + e1z * (e2x * e3y - e2y * e3x)) / 6;
        if (vol >= flat * sb.vol0[t]) continue;
        bad++;
        for (const i of [a, b, c, e]) if (slot[i] >= 0) U[slot[i]] *= 0.6;
      }
      if (!bad) break;
    }
    const hb = sb.cHole, h6 = k * 6;
    hb.fill(Infinity, h6, h6 + 3);
    hb.fill(-Infinity, h6 + 3, h6 + 6);
    for (let m = 0; m < cav.length; m++) {
      const o = cav[m] * 3, u = U[m], dx = DX[m * 3] * u, dy = DX[m * 3 + 1] * u, dz = DX[m * 3 + 2] * u;
      X[o] += dx; X[o + 1] += dy; X[o + 2] += dz;
      x[o] += R[0] * dx + R[1] * dy + R[2] * dz; x[o + 1] += R[3] * dx + R[4] * dy + R[5] * dz; x[o + 2] += R[6] * dx + R[7] * dy + R[8] * dz;
      for (let a = 0; a < 3; a++) {
        if (X[o + a] < hb[h6 + a]) hb[h6 + a] = X[o + a];
        if (X[o + a] > hb[h6 + 3 + a]) hb[h6 + 3 + a] = X[o + a];
      }
    }
    removeTets(sb, (t) => go.has(t), app.allAnchors());
    app.onTopologyChanged();
    // (whole, it's a shell now: its vertices less those its hollow left in nothing - see App._whole; and what it
    // was filled to look like - App.applyStyle fills it again if that changes)
    let nv = 0;
    for (let i = 0; i < sb.nV; i++) if (vc[i] === k && sb.alive[i]) nv++;
    sb.cN[k] = nv;
    const cb = app.cubes.find((c) => c.slot === k);
    if (cb) cb.liqLook = app.liquidLook(cb);
    sb._liquidTets();
    this._seal(sb, k);
    // (re-cubed: its liquid put back by the syringe that drew it up - see Injector)
    if (app.injector?.wants(k)) app.injector.begin(k);
  }

  // Each hollow cube's hollow - its faces that aren't its outside, joined edge to edge, the part of them it is
  // (the most of them on its hollow as last seen; just made, the biggest) - to SoftBody (setCavity): sealed if
  // that's closed, every edge of it shared by two of its faces, and was sealed before. A cut into it joins
  // its faces to the outside's: open, for good (till it's made again). A nick in its skin that doesn't reach
  // it is its own - left be. fresh: the cube just made hollow (its hollow's volume as made: what it holds).
  _seal(sb, fresh = -1) {
    this.ver = sb.topoVersion;
    this.cv = sb.cubeVersion;
    const F = sb.sTri, nV = sb.nV;
    for (const cb of this.app.cubes) {
      const k = cb.slot;
      if (!sb.cHollow[k] || !sb.cLiq[k]) {
        if (sb.cav[k]) sb.setCavity(k, null);
        continue;
      }
      const faces = [];
      for (let f = 0; f < sb.nF; f++) if (sb.tCube[sb.sTet[f]] === k && sb.sTag[f] !== TAG_EXTERIOR) faces.push(f);
      if (!faces.length) {
        sb.setCavity(k, null);
        continue;
      }
      // joined edge to edge
      const par = new Int32Array(faces.length).map((_, i) => i);
      const find = (a) => {
        while (par[a] !== a) a = par[a] = par[par[a]];
        return a;
      };
      const firstOf = new Map();
      for (let n = 0; n < faces.length; n++) {
        const f = faces[n];
        for (let e = 0; e < 3; e++) {
          const a = F[f * 3 + e], b = F[f * 3 + ((e + 1) % 3)], key = a < b ? a * nV + b : b * nV + a, m = firstOf.get(key);
          if (m === undefined) firstOf.set(key, n);
          else {
            const ra = find(m), rb = find(n);
            if (ra !== rb) par[rb] = ra;
          }
        }
      }
      // which is the hollow
      const old = sb.cav[k], mark = old && k !== fresh ? new Set(old.v) : null, score = new Map(), size = new Map();
      for (let n = 0; n < faces.length; n++) {
        const r = find(n), f = faces[n];
        size.set(r, (size.get(r) || 0) + 1);
        if (mark && (mark.has(F[f * 3]) || mark.has(F[f * 3 + 1]) || mark.has(F[f * 3 + 2]))) score.set(r, (score.get(r) || 0) + 1);
      }
      let best = -1, bs = -1;
      for (const [r, c] of mark ? score : size) if (c > bs) (bs = c), (best = r);
      if (best < 0) {
        sb.setCavity(k, null);
        continue;
      }
      // closed?
      const cnt = new Map(), tri = [];
      for (let n = 0; n < faces.length; n++) {
        if (find(n) !== best) continue;
        const f = faces[n];
        tri.push(F[f * 3], F[f * 3 + 1], F[f * 3 + 2]);
        for (let e = 0; e < 3; e++) {
          const a = F[f * 3 + e], b = F[f * 3 + ((e + 1) % 3)], key = a < b ? a * nV + b : b * nV + a;
          cnt.set(key, (cnt.get(key) || 0) + 1);
        }
      }
      let closed = true;
      for (const c of cnt.values()) if (c !== 2) closed = false;
      const sealed = closed && (k === fresh || old?.sealed !== false);
      // (just made, its volume as made - its rest shape's - not as it was just then, stretched or squashed: that
      // held for good)
      let V0 = null;
      if (k === fresh) {
        const X = sb.X;
        V0 = 0;
        for (let n = 0; n < tri.length; n += 3) {
          const a = tri[n] * 3, b = tri[n + 1] * 3, c = tri[n + 2] * 3;
          V0 -= (X[a] * (X[b + 1] * X[c + 2] - X[b + 2] * X[c + 1]) + X[a + 1] * (X[b + 2] * X[c] - X[b] * X[c + 2]) + X[a + 2] * (X[b] * X[c + 1] - X[b + 1] * X[c])) / 6;
        }
      }
      sb.setCavity(k, tri, V0, sealed);
    }
  }
}
