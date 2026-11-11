// A cube full of liquid, cut open, spills. The liquid in it - its tets inside the skin (see
// SoftBody._liquidTets) - runs out through the opening into a pool (the torch's liquid: see Fluid), as
// fast as the opening, the head of liquid over it and its thickness let it: water all but at once, glue
// slowly, a near-solid gel not at all. It runs out down to the opening's lowest point and no further - a
// cup keeps what's below its rim; tipped, it pours - from the top down, so the skin, left empty, goes
// slack. A batch at a time (each one a rebuild), BATCH s apart.
// The opening: the faces a cut (or a hole, a melt...) laid bare - its rim, the vertices of each face that
// wasn't on the surface before and isn't the cube's own outside - so what the draining itself lays bare,
// the hollow it leaves inside, never counts as a way out: it did, and a cup ran dry through its own floor.
import * as THREE from 'three';
import { removeTets } from '../sim/cutting.js';
import { TAG_EXTERIOR } from '../sim/softbody.js';

const BATCH = 0.2; // (s) between drains
const KV = 0.13; // (water's discharge: the share of the opening's sqrt(2gh) that runs out)
const OFF = 0.035; // (m) out from the opening a drop is let go

export class Spill {
  constructor(app) {
    this.app = app;
    this.wait = 0;
    this.drained = 0; // (m^3, all told - for ?stats and the harnesses)
    this.rim = new Uint8Array(1024); // (per vertex: on an opening's rim)
    this.known = new Set(); // (the liquid cubes' surface faces as last seen)
    this.ver = -1; // (the topology they were seen at)
    this.cv = -1; // (and the cubes: a new cube, a fresh start)
    this._c = new THREE.Color();
    this._n = [0, 0, 0];
  }

  update(dt) {
    const app = this.app, sb = app.sb;
    if (app.healer?.active || app.swapper?.active || !sb.nT) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = BATCH;
    const liqC = sb.cLiq;
    let anyLiq = false;
    for (let k = 0; k < liqC.length; k++) if (liqC[k]) anyLiq = true;
    if (!anyLiq) {
      this.ver = -1;
      return;
    }
    if (sb._liqTopo !== sb.topoVersion || sb._liqDirty) sb._liquidTets();
    const skin = sb._skinT, onSkin = sb._skinV;
    if (!skin || !onSkin || !sb.sTri) return;
    if (sb.topoVersion !== this.ver) this._look(sb);
    const T = sb.T, x = sb.x, tc = sb.tCube, tp = sb.tPiece, vol0 = sb.vol0, rim = this.rim;
    // (what runs out: the liquid clear of the skin - a tet touching it stays, as the skin's inside: the
    // skin's own tets, those with a face on the outside, meet only at their edges, and emptied of all else
    // its inside was a field of bare tets, pyramids - the outer layer whole, it's a wall, flat inside)
    const isLiq = (t) => {
      if (!liqC[tc[t]] || skin[t] || !(vol0[t] > 0)) return false;
      const q = t * 4;
      return !(onSkin[T[q]] | onSkin[T[q + 1]] | onSkin[T[q + 2]] | onSkin[T[q + 3]]);
    };
    // each piece's rim's lowest point
    const NP = sb.pieces.length, lo = new Float64Array(NP).fill(Infinity);
    let anyRim = false;
    for (let i = 0; i < sb.nV; i++) {
      if (!rim[i] || !sb.alive[i]) continue;
      const k = sb.vPiece[i];
      if (k >= 0 && x[i * 3 + 1] < lo[k]) (lo[k] = x[i * 3 + 1]), (anyRim = true);
    }
    if (!anyRim) return;
    // where it runs out: the liquid's bare faces, not facing up (open to the sky, within 25° - a cup's top - it
    // stays), in the pieces with a rim - their areas and outward normals
    const byP = new Map(), n3 = this._n;
    for (let f = 0; f < sb.nF; f++) {
      const t = sb.sTet[f], k = tp[t];
      if (lo[k] === Infinity || !isLiq(t)) continue;
      const ar = this._faceOut(sb, f, n3);
      if (!(ar > 0) || n3[1] > 0.9) continue;
      let l = byP.get(k);
      if (!l) byP.set(k, (l = { faces: [], area: [], nrm: [], liq: [], top: -Infinity }));
      l.faces.push(f);
      l.area.push(ar);
      l.nrm.push(n3[0], n3[1], n3[2]);
    }
    if (!byP.size) return;
    // the liquid over each one's rim (a little over: the last film stays)
    for (let t = 0; t < sb.nT; t++) {
      const P = byP.get(tp[t]);
      if (!P || !isLiq(t)) continue;
      const y = (x[T[t * 4] * 3 + 1] + x[T[t * 4 + 1] * 3 + 1] + x[T[t * 4 + 2] * 3 + 1] + x[T[t * 4 + 3] * 3 + 1]) / 4;
      if (y < lo[tp[t]] + 0.15 * sb.cH[tc[t]]) continue;
      P.liq.push(t, y);
      if (y > P.top) P.top = y;
    }
    const g = Math.abs(sb.p.gravity ?? -22), drain = new Set(), out = [];
    for (const [k, P] of byP) {
      if (!P.liq.length) continue;
      const visc = sb.cVisc[tc[P.liq[0]]], kv = KV * Math.pow(Math.max(0, 1 - visc), 3);
      if (kv <= 0) continue;
      // (where on the opening it runs out: by area and the depth under the liquid's top)
      const F = P.faces, W = new Float64Array(F.length);
      let area = 0, wsum = 0;
      for (let q = 0; q < F.length; q++) {
        const f = F[q], fy = (x[sb.sTri[f * 3] * 3 + 1] + x[sb.sTri[f * 3 + 1] * 3 + 1] + x[sb.sTri[f * 3 + 2] * 3 + 1]) / 3;
        area += P.area[q];
        W[q] = P.area[q] * Math.sqrt(Math.max(0.02, P.top - fy));
        wsum += W[q];
      }
      if (!(wsum > 0)) continue;
      // Torricelli: what runs out this batch - from the top of it down
      const head = Math.max(0.02, P.top - lo[k]), vOut = Math.sqrt(2 * g * head);
      let want = area * kv * vOut * BATCH;
      const L = [];
      for (let n = 0; n < P.liq.length; n += 2) L.push(n);
      L.sort((p, q) => P.liq[q + 1] - P.liq[p + 1]);
      for (const n of L) {
        if (want <= 0) break;
        const t = P.liq[n];
        drain.add(t);
        want -= vol0[t];
        out.push(t, k);
      }
      P.W = W; P.wsum = wsum; P.vOut = Math.min(vOut * (1 - visc), 1.6);
    }
    if (!drain.size) return;
    // each drained tet's liquid out through the opening: at a spot on it (by the weights above), just
    // outside, moving as the piece there and out along it, in its colour - as runny as the cube says
    const fl = app.fluid, col = this._c, v = sb.v;
    for (let n = 0; n < out.length; n += 2) {
      const t = out[n], P = byP.get(out[n + 1]), visc = sb.cVisc[tc[t]];
      let r = Math.random() * P.wsum, q = 0;
      while (q < P.W.length - 1 && (r -= P.W[q]) > 0) q++;
      const f = P.faces[q], a = sb.sTri[f * 3] * 3, b = sb.sTri[f * 3 + 1] * 3, c = sb.sTri[f * 3 + 2] * 3;
      let u = Math.random(), w = Math.random();
      if (u + w > 1) (u = 1 - u), (w = 1 - w);
      const nx = P.nrm[q * 3], ny = P.nrm[q * 3 + 1], nz = P.nrm[q * 3 + 2];
      const px = x[a] + (x[b] - x[a]) * u + (x[c] - x[a]) * w + nx * OFF;
      const py = x[a + 1] + (x[b + 1] - x[a + 1]) * u + (x[c + 1] - x[a + 1]) * w + ny * OFF;
      const pz = x[a + 2] + (x[b + 2] - x[a + 2]) * u + (x[c + 2] - x[a + 2]) * w + nz * OFF;
      const vx = (v[a] + v[b] + v[c]) / 3 + nx * P.vOut, vy = (v[a + 1] + v[b + 1] + v[c + 1]) / 3 + ny * P.vOut, vz = (v[a + 2] + v[b + 2] + v[c + 2]) / 3 + nz * P.vOut;
      col.set(app.flavorColorAtTet(t)); // (as the torch's: see liquefy)
      fl.add(px, py, pz, vol0[t], vx, vy, vz, col.r, col.g, col.b, 0.03, 0, 0.03 + 0.92 * Math.pow(visc, 1.2), 30 * visc * visc);
      this.drained += vol0[t];
    }
    removeTets(sb, (t) => drain.has(t), app.allAnchors());
    app.onTopologyChanged();
    // (what that laid bare is the inside of it: seen, not a rim)
    this._look(sb, false);
  }

  // The liquid cubes' surface faces now: those new since the last look - a cut, a hole - that aren't the
  // cube's outside put their corners on the rim (unless mark is false: the draining's own). A new cube
  // (or its vertices renumbered) starts afresh.
  _look(sb, mark = true) {
    if (sb.cubeVersion !== this.cv) {
      this.cv = sb.cubeVersion;
      this.known.clear();
      this.rim.fill(0);
      mark = false;
    }
    if (this.rim.length < sb.nV) {
      const r = new Uint8Array(Math.max(sb.nV * 2, 1024));
      r.set(this.rim);
      this.rim = r;
    }
    const F = sb.sTri, nV = sb.nV, now = new Set(), tc = sb.tCube, liq = sb.cLiq;
    for (let f = 0; f < sb.nF; f++) {
      if (!liq[tc[sb.sTet[f]]]) continue;
      let a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
      if (a > b) [a, b] = [b, a];
      if (b > c) [b, c] = [c, b];
      if (a > b) [a, b] = [b, a];
      const key = (a * nV + b) * nV + c;
      now.add(key);
      if (mark && !this.known.has(key) && sb.sTag[f] !== TAG_EXTERIOR) this.rim[a] = this.rim[b] = this.rim[c] = 1;
    }
    this.known = now;
    this.ver = sb.topoVersion;
  }

  // Surface face f's area, its outward unit normal into n (away from its tet's middle)
  _faceOut(sb, f, n) {
    const x = sb.x, T = sb.T, a = sb.sTri[f * 3] * 3, b = sb.sTri[f * 3 + 1] * 3, c = sb.sTri[f * 3 + 2] * 3;
    const ux = x[b] - x[a], uy = x[b + 1] - x[a + 1], uz = x[b + 2] - x[a + 2];
    const wx = x[c] - x[a], wy = x[c + 1] - x[a + 1], wz = x[c + 2] - x[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) return 0;
    const t = sb.sTet[f];
    let mx = 0, my = 0, mz = 0;
    for (let j = 0; j < 4; j++) { const o = T[t * 4 + j] * 3; mx += x[o] / 4; my += x[o + 1] / 4; mz += x[o + 2] / 4; }
    const s = nx * ((x[a] + x[b] + x[c]) / 3 - mx) + ny * ((x[a + 1] + x[b + 1] + x[c + 1]) / 3 - my) + nz * ((x[a + 2] + x[b + 2] + x[c + 2]) / 3 - mz) < 0 ? -1 / l : 1 / l;
    n[0] = nx * s; n[1] = ny * s; n[2] = nz * s;
    return l / 2;
  }
}
