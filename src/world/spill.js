// A cube full of liquid, cut open, spills. The moment it's opened its liquid - its tets inside the skin (see
// SoftBody._liquidTets) - down to the opening's lowest point turns to liquid where it is (the torch's: see
// Fluid), moving as it was, and runs out as it will: water all at once, glue in a slow ooze, a near-solid gel
// not at all. A little more than that goes too - a layer under the opening's lowest point, staying in it, the
// liquid's top: what's left in a cup, or under a hole shot through, is liquid on top, not the tets' jagged
// faces. Tipped, a cup pours: looked at again a few times a second.
// (It ran out a batch at a time, Torricelli's rate, each batch let go at the opening: the cut stood open a
// moment first, then it all came out of it as if under pressure, and what stayed showed the tets' faces.)
// The opening: the faces a cut (or a hole, a melt...) laid bare - its rim, the vertices of each face that
// wasn't on the surface before and isn't the cube's own outside - so what the spill itself lays bare, the
// hollow it leaves inside, never counts as a way out: it did, and a cup ran dry through its own floor.
import * as THREE from 'three';
import { removeTets } from '../sim/cutting.js';
import { TAG_EXTERIOR } from '../sim/softbody.js';

const LOOK = 0.25; // (s) between looks with nothing cut: a cup tipped pours
const UNDER = 0.6; // (cells) how far under the rim's lowest point it turns liquid too: its top

export class Spill {
  constructor(app) {
    this.app = app;
    this.wait = 0;
    this.drained = 0; // (m^3, all told - for ?stats and the harnesses)
    this.rim = new Uint8Array(1024); // (per vertex: on an opening's rim)
    this.known = new Set(); // (the liquid cubes' surface faces as last seen)
    this.slits = []; // (a partial cut's faces, three vertices each: no way out while their sides lie together)
    this.ver = -1; // (the topology they were seen at)
    this.cv = -1; // (and the cubes: a new cube, a fresh start)
    this._c = new THREE.Color();
  }

  update(dt) {
    const app = this.app, sb = app.sb;
    if (app.healer?.active || app.swapper?.active || !sb.nT) return;
    // (cut, shot, melted: at once - else now and then)
    this.wait -= dt;
    if (sb.topoVersion === this.ver && this.wait > 0) return;
    this.wait = LOOK;
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
    const T = sb.T, x = sb.x, v = sb.v, tc = sb.tCube, tp = sb.tPiece, vol0 = sb.vol0, rim = this.rim;
    // (a slit gaping - a flap fallen open - is a way out now)
    if (this.slits.length) {
      const S = this.slits, so = sb.slitOf, gap2 = 0.08 * 0.08;
      let w = 0;
      for (let n = 0; n < S.length; n += 3) {
        let open = false;
        for (let j = 0; j < 3; j++) {
          const i = S[n + j], o2 = so[i] - 1;
          if (!sb.alive[i] || o2 < 0 || !sb.alive[o2]) continue;
          const dx = x[i * 3] - x[o2 * 3], dy = x[i * 3 + 1] - x[o2 * 3 + 1], dz = x[i * 3 + 2] - x[o2 * 3 + 2];
          if (dx * dx + dy * dy + dz * dz > gap2) open = true;
        }
        if (open) for (let j = 0; j < 3; j++) rim[S[n + j]] = 1;
        else (S[w++] = S[n]), (S[w++] = S[n + 1]), (S[w++] = S[n + 2]);
      }
      S.length = w;
    }
    // (what turns liquid: the liquid clear of the skin - a tet touching it stays, as the skin's inside: the
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
    // the liquid over each one's rim, and a layer under it - all of it, now (a near-solid gel stays)
    const go = new Set(), keep = [];
    let need = 0;
    for (let t = 0; t < sb.nT; t++) {
      const k = tp[t];
      if (lo[k] === Infinity || !liqC[tc[t]] || sb.cVisc[tc[t]] >= 0.99) continue;
      const y = (x[T[t * 4] * 3 + 1] + x[T[t * 4 + 1] * 3 + 1] + x[T[t * 4 + 2] * 3 + 1] + x[T[t * 4 + 3] * 3 + 1]) / 4;
      if (y < lo[k] - UNDER * sb.cH[tc[t]]) continue;
      if (isLiq(t)) {
        go.add(t);
        need += vol0[t];
      } else if (!skin[t] && vol0[t] > 0) keep.push(t); // (the skin's inside: what's settled in it, see below)
    }
    if (!go.size) return;
    // as liquid, where each was, moving as it did, in its colour, as runny as the cube says - more than the
    // pool has room for (a big cube's is twice a phone's), each drop carrying more of it, so it fills as much
    // as it did (spread thinner, it settled to half: a cube cut across stood half empty); past that, thinner
    const fl = app.fluid, col = this._c, p0 = fl.n;
    const room = Math.max(0, fl.max - fl.n - 4) * fl.vol, mass = Math.min(2, Math.max(1, need / Math.max(room, 1e-9)));
    const scale = need > room * mass ? (room * mass) / need : 1;
    for (const t of go) {
      let cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
      for (let j = 0; j < 4; j++) {
        const o = T[t * 4 + j] * 3;
        cx += x[o] / 4; cy += x[o + 1] / 4; cz += x[o + 2] / 4;
        vx += v[o] / 4; vy += v[o + 1] / 4; vz += v[o + 2] / 4;
      }
      const visc = sb.cVisc[tc[t]];
      col.set(app.flavorColorAtTet(t)); // (as the torch's: see liquefy)
      // (close by its middle: further, some came out inside the skin's own layer, pushed out of it the wrong way -
      // drops clinging to the ceiling, sat on the cube's top)
      fl.add(cx, cy, cz, vol0[t] * scale, vx, vy, vz, col.r, col.g, col.b, Math.cbrt(vol0[t]) * 0.35, 0, 0.12 + 0.83 * Math.pow(visc, 1.2), 30 * visc * visc, mass);
      this.drained += vol0[t];
    }
    // (and what's in it - the glitter, the bubbles - with it, onto the nearest of it; what had settled on the
    // skin's inside, in the layer kept, too: see Glitter.poolFrom, Bubbles.poolFrom)
    const flush = new Set(go);
    for (const t of keep) flush.add(t);
    app.glitter?.poolFrom(flush, p0, fl.n);
    app.bubbles?.poolFrom(flush, p0, fl.n);
    removeTets(sb, (t) => go.has(t), app.allAnchors());
    app.onTopologyChanged();
    // (what that laid bare is the inside of it: seen, not a rim)
    this._look(sb, false);
  }

  // The liquid cubes' surface faces now: those new since the last look - a cut, a hole - that aren't the
  // cube's outside put their corners on the rim (unless mark is false: the spill's own). A new cube (or its
  // vertices renumbered) starts afresh.
  _look(sb, mark = true) {
    if (sb.cubeVersion !== this.cv) {
      this.cv = sb.cubeVersion;
      this.known.clear();
      this.rim.fill(0);
      this.slits.length = 0;
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
      if (mark && !this.known.has(key) && sb.sTag[f] !== TAG_EXTERIOR) {
        // (a slit's: no way out, too thin for the liquid - till it gapes, see update)
        if (sb.slitOf[a] && sb.slitOf[b] && sb.slitOf[c]) this.slits.push(a, b, c);
        else this.rim[a] = this.rim[b] = this.rim[c] = 1;
      }
    }
    this.known = now;
    this.ver = sb.topoVersion;
  }
}
