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
import { TAG_EXTERIOR } from '../sim/softbody.js';

const OVER = 1.2; // (how much closer drops stand settled in a hollow than laid out D apart: see _hollow)
// (how many drops a full cube's liquid is, at most - each as big as that takes: a full one's every drop lives
// as long as the cube does, and is worked out every frame it's moving - 900 took the liquid 20 ms a frame)
const FILL_N = 520;

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
    if (app.healer?.active || app.swapper?.active || app.cubiplication?.active || fl.rc || !sb.nT) return;
    for (const cb of app.cubes) if (sb.cLiq[cb.slot] && !sb.cHollow[cb.slot]) this._hollow(sb, cb.slot);
    if (sb.topoVersion !== this.ver || sb.cubeVersion !== this.cv) this._seal(sb);
  }

  // Cube k made a shell: its inside out, and its hollow filled from the bottom as full as it's to be.
  _hollow(sb, k) {
    const app = this.app, fl = app.fluid, col = this._c;
    if (sb._liqTopo !== sb.topoVersion || sb._liqDirty) sb._liquidTets();
    const skin = sb._skinT, on = sb._skinV, T = sb.T, x = sb.x, v = sb.v, tc = sb.tCube;
    if (!skin || !on) return;
    // its inside: its tets clear of its skin - a tet touching it stays, as its wall's inside (the skin's own
    // tets, those with a face on the outside, meet only at their edges: on their own, a field of pyramids)
    const inner = [], X = sb.X, hb = sb.cHole, h6 = k * 6;
    let V = 0;
    hb.fill(Infinity, h6, h6 + 3);
    hb.fill(-Infinity, h6 + 3, h6 + 6);
    for (let t = 0; t < sb.nT; t++) {
      if (tc[t] !== k || skin[t] || !(sb.vol0[t] > 0)) continue;
      const q = t * 4;
      if (on[T[q]] | on[T[q + 1]] | on[T[q + 2]] | on[T[q + 3]]) continue;
      inner.push(t);
      V += sb.vol0[t];
      // (where it is in the cube as made: its hollow's box - see Fluid._collide)
      for (let c = 0; c < 4; c++)
        for (let a = 0; a < 3; a++) {
          const r = X[T[q + c] * 3 + a];
          if (r < hb[h6 + a]) hb[h6 + a] = r;
          if (r > hb[h6 + 3 + a]) hb[h6 + 3 + a] = r;
        }
    }
    sb.cHollow[k] = 1;
    sb._liqDirty = true;
    if (!inner.length) return;
    // the drops' size: all its hollow's worth in FILL_N of them, or the pool's budget (set only while there's
    // none - else as they are, and as many as there's room for) - laid out a little closer than they sit (OVER:
    // settled, against its walls, they stand that much closer - laid out D apart, a full cube's settled a fifth
    // short)
    const room = Math.max(0, Math.floor(fl.max * 0.96) - fl.n);
    if (!fl.n) fl.setDrop(Math.max(0.065, Math.cbrt((OVER * V) / Math.max(1, Math.min(room, FILL_N)))));
    const d = fl.D / Math.cbrt(OVER), fill = Math.min(1, Math.max(0, sb.cFill[k]));
    // where they go: a lattice d apart through it as it is now - each point in one of its inside's tets, moving
    // as that is. (Laid through its rest shape, sagging as it stood they were a tenth too close: packed in from
    // the start, the column fell in on itself to half its height.)
    const seen = new Set(), P = [];
    for (const t of inner) {
      const q = t * 4, a = T[q] * 3, b = T[q + 1] * 3, c = T[q + 2] * 3, e = T[q + 3] * 3;
      const e1x = x[b] - x[a], e1y = x[b + 1] - x[a + 1], e1z = x[b + 2] - x[a + 2], e2x = x[c] - x[a], e2y = x[c + 1] - x[a + 1], e2z = x[c + 2] - x[a + 2];
      const e3x = x[e] - x[a], e3y = x[e + 1] - x[a + 1], e3z = x[e + 2] - x[a + 2];
      // (the inverse of [e1 e2 e3]: its rows, by cross products over the determinant)
      const c1x = e2y * e3z - e2z * e3y, c1y = e2z * e3x - e2x * e3z, c1z = e2x * e3y - e2y * e3x;
      const c2x = e3y * e1z - e3z * e1y, c2y = e3z * e1x - e3x * e1z, c2z = e3x * e1y - e3y * e1x;
      const c3x = e1y * e2z - e1z * e2y, c3y = e1z * e2x - e1x * e2z, c3z = e1x * e2y - e1y * e2x;
      const det = e1x * c1x + e1y * c1y + e1z * c1z;
      if (!(Math.abs(det) > 1e-15)) continue;
      const lo0 = Math.min(x[a], x[b], x[c], x[e]), lo1 = Math.min(x[a + 1], x[b + 1], x[c + 1], x[e + 1]), lo2 = Math.min(x[a + 2], x[b + 2], x[c + 2], x[e + 2]);
      const hi0 = Math.max(x[a], x[b], x[c], x[e]), hi1 = Math.max(x[a + 1], x[b + 1], x[c + 1], x[e + 1]), hi2 = Math.max(x[a + 2], x[b + 2], x[c + 2], x[e + 2]);
      for (let ix = Math.ceil(lo0 / d); ix * d <= hi0; ix++)
        for (let iy = Math.ceil(lo1 / d); iy * d <= hi1; iy++)
          for (let iz = Math.ceil(lo2 / d); iz * d <= hi2; iz++) {
            const rx = ix * d - x[a], ry = iy * d - x[a + 1], rz = iz * d - x[a + 2];
            const b1 = (c1x * rx + c1y * ry + c1z * rz) / det, b2 = (c2x * rx + c2y * ry + c2z * rz) / det, b3 = (c3x * rx + c3y * ry + c3z * rz) / det, b0 = 1 - b1 - b2 - b3;
            if (b0 < -1e-9 || b1 < -1e-9 || b2 < -1e-9 || b3 < -1e-9) continue;
            const key = ix + ',' + iy + ',' + iz;
            if (seen.has(key)) continue;
            seen.add(key);
            const vx = v[a] * b0 + v[b] * b1 + v[c] * b2 + v[e] * b3, vy = v[a + 1] * b0 + v[b + 1] * b1 + v[c + 1] * b2 + v[e + 1] * b3, vz = v[a + 2] * b0 + v[b + 2] * b1 + v[c + 2] * b2 + v[e + 2] * b3;
            P.push([ix * d, iy * d, iz * d, vx, vy, vz, t]);
          }
    }
    // as full as it's to be: its lowest share of them - of as many as its hollow holds as made (laid through it
    // stretched or squashed as it was just then, a few in ten more or less: re-cubed, it came out overfull)
    // - as many as there's room for
    P.sort((p, q) => p[1] - q[1]);
    const n = Math.min(room, P.length, Math.round(fill * ((OVER * V) / fl.D ** 3)));
    const visc = sb.cVisc[k], fv = 0.12 + 0.83 * Math.pow(visc, 1.2), ft = 30 * visc * visc, p0 = fl.n;
    for (let i = 0; i < n; i++) {
      const [px, py, pz, vx, vy, vz, t] = P[i];
      col.set(app.flavorColorAtTet(t));
      fl.add(px, py, pz, fl.vol * 1.000001, vx, vy, vz, col.r, col.g, col.b, 0.004, 0, fv, ft, 1);
    }
    // (settled liquid, not just made: the solver holds it up at full strength from the first - see Fluid's
    // GAIN - else the column fell in on itself before it could; and marked as this cube's)
    sb.cHid[k] = ++this.hid;
    for (let i = p0; i < fl.n; i++) (fl.age[i] = 1), (fl.own[i] = this.hid);
    this.drained += (fl.n - p0) * fl.vol;
    // (what's in it - the glitter, the bubbles - on the nearest of them)
    if (fl.n > p0) {
      app.glitter?.poolFrom(inner, p0, fl.n);
      app.bubbles?.poolFrom(new Set(inner), p0, fl.n, true);
    }
    const go = new Set(inner);
    removeTets(sb, (t) => go.has(t), app.allAnchors());
    app.onTopologyChanged();
    // (whole, it's a shell now: its vertices less those its hollow left in nothing - see App._whole; and what it
    // was filled to look like - App.applyStyle fills it again if that changes)
    let nv = 0;
    for (let i = 0; i < sb.nV; i++) if (sb.vCube[i] === k && sb.alive[i]) nv++;
    sb.cN[k] = nv;
    const cb = app.cubes.find((c) => c.slot === k);
    if (cb) cb.liqLook = app.liquidLook(cb);
    sb._liquidTets();
    this._seal(sb, k, V);
  }

  // Each hollow cube's hollow - its faces that aren't its outside, joined edge to edge, the part of them it is
  // (the most of them on its hollow as last seen; just made, the biggest) - to SoftBody (setCavity): sealed if
  // that's closed, every edge of it shared by two of its faces, and was sealed before. A cut into it joins
  // its faces to the outside's: open, for good (till it's made again). A nick in its skin that doesn't reach
  // it is its own - left be. fresh: the cube just made hollow, V its hollow's volume as made (what it holds).
  _seal(sb, fresh = -1, V = 0) {
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
      // (just made, its volume as made - not as it was just then, stretched or squashed: that held for good)
      const V0 = k === fresh ? V : null;
      sb.setCavity(k, tri, V0, sealed);
    }
  }
}
