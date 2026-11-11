// A cube full of liquid, cut open, spills. The moment a cut or a hole reaches its liquid - its tets inside the
// skin (see SoftBody._liquidTets) - that piece's liquid down to the opening's lowest point (and a layer under
// it: the top of what's left) turns to liquid where it is (the torch's: see Fluid), moving as it was, and runs
// out as it will: water all at once, glue in a slow ooze, a near-solid gel not at all. Tipped, the opening's
// lower: more goes. The skin's own layer stays, firm, as the wall.
// (It ran out a batch at a time, Torricelli's rate, each batch let go at the opening: the cut stood open a
// moment first, then it all came out of it as if under pressure. Then only what lay over the opening went,
// the rest left as soft tets - and drops lying on those sank into them as they swayed, and came out through
// the walls.)
// The opening: the faces a cut (or a hole, a melt...) laid bare - its rim, the vertices of each face that
// wasn't on the surface before and isn't the cube's own outside; a slit (a partial cut, a blade's width)
// isn't one till it gapes.
import * as THREE from 'three';
import { removeTets } from '../sim/cutting.js';
import { TAG_EXTERIOR, polarRot } from '../sim/softbody.js';

const LOOK = 0.25; // (s) between looks with nothing cut: a cup tipped pours
const UNDER = 0.6; // (cells) how far under the rim's lowest point it turns liquid too: its top
// (m) a slit as wide open as a crack runs freely: narrower, choked by its own walls (see _seepLook) - and past
// FLAP, an opening (it's a cut, then: see update)
const SEEP_OPEN = 0.3;
const FLAP = 0.35;

export class Spill {
  constructor(app) {
    this.app = app;
    this.wait = 0;
    this.drained = 0; // (m^3, all told - for ?stats and the harnesses)
    this.rim = new Uint8Array(1024); // (per vertex: on an opening's rim)
    this.known = new Set(); // (the liquid cubes' surface faces as last seen)
    this.slits = []; // (a partial cut's faces, three vertices each: no way out while their sides lie together)
    this.floor = new Set(); // (the faces its own running out bared, as in known: the top of what's left - see _look)
    this._on = new Uint8Array(1024); // (per vertex: on that top - 1 its floor, 2 the wall round the gap over it)
    this._tv = [];
    this._tf = [];
    // (a slit's seep - see _seepLook: its mouth's pairs [vertex, partner, m^3/s, cube, m/s] - what's waiting to
    // come out, and what each cube owes its liquid for what has)
    this.seep = [];
    this.bank = 0;
    this.debt = new Float64Array(16);
    this._q = new Float64Array(4); // (scratch: a piece's turn, and as a matrix - see _heights)
    this._A = new Float64Array(9);
    this._R = new Float64Array(9);
    this.ver = -1; // (the topology they were seen at)
    this.cv = -1; // (and the cubes: a new cube, a fresh start)
    this._c = new THREE.Color();
  }

  update(dt) {
    const app = this.app, sb = app.sb;
    if (app.healer?.active || app.swapper?.active || !sb.nT) {
      this.seep.length = 0;
      this.debt.fill(0); // (healed, it's full again)
      return;
    }
    // (a slit's seep, a frame's worth - its rates looked at now and then, below)
    if (this.seep.length) this._seepTick(dt);
    // (cut, shot, melted: at once - else now and then)
    this.wait -= dt;
    if (sb.topoVersion === this.ver && this.wait > 0) return;
    this.wait = LOOK;
    const liqC = sb.cLiq;
    let anyLiq = false;
    for (let k = 0; k < liqC.length; k++) if (liqC[k]) anyLiq = true;
    if (!anyLiq) {
      this.ver = -1;
      this.seep.length = 0;
      sb.liqTop = null;
      return;
    }
    if (sb._liqTopo !== sb.topoVersion || sb._liqDirty) sb._liquidTets();
    if (!sb._skinT || !sb._skinV || !sb.sTri) return;
    if (sb.topoVersion !== this.ver) this._look(sb);
    const x = sb.x, rim = this.rim;
    // (a slit gaping - a flap fallen open - is a way out now)
    if (this.slits.length) {
      const S = this.slits, so = sb.slitOf, gap2 = FLAP * FLAP;
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
    // (what turns liquid: see _liq)
    const isLiq = (t) => this._liq(sb, t);
    // (an opening runs out: the mesh changed, looked at again next time - else slits under the liquid seep, and
    // what's come out of them is taken off its top. The other way round, a slit pulled wide open poured on
    // through the seep - and when it was let go, all of it ran out at once)
    if (this._open(sb, isLiq)) this.seep.length = 0;
    else this._seepLook(sb, isLiq);
  }

  // (the liquid clear of the skin - a tet touching it stays, as the skin's inside: the skin's own tets, those
  // with a face on the outside, meet only at their edges, and emptied of all else its inside was a field of
  // bare tets, pyramids - the outer layer whole, it's a wall, flat inside. SoftBody._liquidTets first.)
  _liq(sb, t) {
    if (!sb.cLiq[sb.tCube[t]] || sb._skinT[t] || !(sb.vol0[t] > 0)) return false;
    const T = sb.T, on = sb._skinV, q = t * 4;
    return !(on[T[q]] | on[T[q + 1]] | on[T[q + 2]] | on[T[q + 3]]);
  }

  // What's opened runs out: the liquid of each piece with an opening, down to (just under) its lowest point,
  // turned liquid where it is. True if any did (the mesh changed).
  _open(sb, isLiq) {
    const app = this.app, liqC = sb.cLiq, skin = sb._skinT, rim = this.rim;
    const T = sb.T, x = sb.x, v = sb.v, tc = sb.tCube, tp = sb.tPiece, vol0 = sb.vol0;
    // each piece's rim's lowest point
    const NP = sb.pieces.length, lo = new Float64Array(NP).fill(Infinity);
    let anyRim = false;
    for (let i = 0; i < sb.nV; i++) {
      if (!rim[i] || !sb.alive[i]) continue;
      const k = sb.vPiece[i];
      if (k >= 0 && x[i * 3 + 1] < lo[k]) (lo[k] = x[i * 3 + 1]), (anyRim = true);
    }
    if (!anyRim) return false;
    // opened: a piece whose liquid lies bare at its rim - a cut, a hole that reached it (not a nick in its skin,
    // not a slit, which seeps: see _seepLook). A near-solid gel stays.
    const opened = new Uint8Array(NP);
    for (let f = 0; f < sb.nF; f++) {
      const t = sb.sTet[f];
      if (lo[tp[t]] === Infinity || !isLiq(t)) continue;
      if (rim[sb.sTri[f * 3]] && rim[sb.sTri[f * 3 + 1]] && rim[sb.sTri[f * 3 + 2]]) opened[tp[t]] = 1;
    }
    // what goes: the liquid over the rim's lowest point, and a layer under it (so what's left has liquid on
    // top, not the tets' jagged faces). All of it went: a phone's pool holds half a cube's liquid, and spread
    // thinner the drops settled to half its height - a cube cut near its top stood half empty.
    const go = new Set(), keep = [];
    let need = 0;
    for (let t = 0; t < sb.nT; t++) {
      const k = tp[t];
      if (!opened[k] || !liqC[tc[t]] || sb.cVisc[tc[t]] >= 0.99) continue;
      const y = (x[T[t * 4] * 3 + 1] + x[T[t * 4 + 1] * 3 + 1] + x[T[t * 4 + 2] * 3 + 1] + x[T[t * 4 + 3] * 3 + 1]) / 4;
      if (y < lo[k] - UNDER * sb.cH[tc[t]]) continue;
      if (isLiq(t)) {
        go.add(t);
        need += vol0[t];
      } else if (!skin[t] && vol0[t] > 0) keep.push(t); // (the skin's inside: what's settled in it, see below)
    }
    if (!go.size) return false;
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
      // (at its middle - where nothing will be, once it's gone: let go further out, some came out inside the
      // skin's own layer, never having been out of the jelly, and found no way out of it but the wall's far side)
      fl.add(cx, cy, cz, vol0[t] * scale, vx, vy, vz, col.r, col.g, col.b, 0.004, 0, 0.12 + 0.83 * Math.pow(visc, 1.2), 30 * visc * visc, mass);
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
    // (what that laid bare is the inside of it - the top of what's left: seen, not a rim)
    sb._liquidTets();
    this._look(sb, false);
    return true;
  }

  // A slit under the liquid seeps: out of its mouth - its two sides' vertices on the cube's outside, partners
  // across it (see SoftBody.slitOf) - as fast as the gap between them, the head of liquid over them and its
  // thickness let it (Torricelli, through a crack): a blade's width, a dribble down the side; stretched open, a
  // pour (FLAP apart it's an opening: it runs out the way a cut does). Each mouth pair: [vertex, partner, m^3/s,
  // cube, how fast it comes out]. And what's come out, taken off the top of the liquid in, a few tets at a
  // time - true if it took any (the mesh is changed: looked at again next time).
  _seepLook(sb, isLiq) {
    const x = sb.x, so = sb.slitOf, onSkin = sb._skinV, T = sb.T, tp = sb.tPiece, S = this.seep;
    S.length = 0;
    const NP = sb.pieces.length, top = new Float64Array(NP).fill(-Infinity);
    let any = false;
    for (let i = 0; i < sb.nV; i++) if (so[i] && so[i] - 1 !== i) any = true;
    if (any) {
      // each piece's liquid's top: its highest liquid tet's middle
      for (let t = 0; t < sb.nT; t++) {
        if (!isLiq(t)) continue;
        const y = (x[T[t * 4] * 3 + 1] + x[T[t * 4 + 1] * 3 + 1] + x[T[t * 4 + 2] * 3 + 1] + x[T[t * 4 + 3] * 3 + 1]) / 4;
        if (y > top[tp[t]]) top[tp[t]] = y;
      }
      const g = Math.abs(sb.p.gravity ?? -22);
      for (let i = 0; i < sb.nV; i++) {
        const p = so[i] - 1;
        if (p <= i || !sb.alive[i] || !sb.alive[p] || !(onSkin[i] || onSkin[p])) continue;
        const k = sb.vPiece[i], cube = sb.vCube[i];
        if (k < 0 || top[k] === -Infinity || !sb.cLiq[cube]) continue;
        const head = top[k] - (x[i * 3 + 1] + x[p * 3 + 1]) / 2;
        if (!(head > 0)) continue;
        const gap = Math.hypot(x[i * 3] - x[p * 3], x[i * 3 + 1] - x[p * 3 + 1], x[i * 3 + 2] - x[p * 3 + 2]);
        // (a strip of the mouth half a cell long, the gap wide: what runs through it - choked by the crack's own
        // walls, the narrower the much less: the few centimetres a cut side sags open to, a dribble down it;
        // pulled open 10 cm, a pour)
        const open = Math.min(1, gap / SEEP_OPEN);
        const rate = 0.5 * sb.cH[cube] * gap * open * open * Math.sqrt(2 * g * head) * 0.6 * Math.pow(Math.max(0, 1 - sb.cVisc[cube]), 3);
        if (rate > 0) S.push(i, p, rate, cube, open * Math.sqrt(2 * g * head));
      }
    }
    // what's come out, off the top of the liquid: its highest tets, a few dozen at a time (each a rebuild, a
    // phone's ~20 ms: five litres at a time, a dribble's a bite every few seconds - its level a few mm behind)
    // - highest as the piece lies, turned but not bent (see _heights)
    const D = this.debt, go = new Set();
    let H = null;
    for (let c = 0; c < D.length; c++) {
      if (!(D[c] > 0.005)) continue;
      H = H || this._heights(sb);
      const L = [];
      for (let t = 0; t < sb.nT; t++) {
        if (sb.tCube[t] !== c || !isLiq(t)) continue;
        L.push(t, H[t]);
      }
      const ord = [];
      for (let n = 0; n < L.length; n += 2) ord.push(n);
      ord.sort((a, b) => L[b + 1] - L[a + 1]);
      for (const n of ord) {
        if (D[c] <= 0) break;
        go.add(L[n]);
        D[c] -= sb.vol0[L[n]];
      }
      if (!ord.length) D[c] = 0;
    }
    if (!go.size) return false;
    removeTets(sb, (t) => go.has(t), this.app.allAnchors());
    this.app.onTopologyChanged();
    sb._liquidTets();
    this._look(sb, false);
    return true;
  }

  // Each tet's height as its piece lies - turned as the piece is (its rest shape fitted to it now: see
  // polarRot), not bent: the top of a cube full of liquid dishes in once it's open, and ranked by where each
  // sits now, its liquid went from under the corners first - a pocket in each, of shards; as the piece lies,
  // from under all its top, a layer.
  _heights(sb) {
    const NP = sb.pieces.length, H = new Float64Array(sb.nT), F = new Float64Array(NP * 5), x = sb.x, X = sb.X, m = sb.m, T = sb.T;
    const A = this._A, R = this._R, q = this._q;
    // (per piece: its turn's middle row r, the height c - r.C its rest middle's put at, and that it's there:
    // a tet's height, c + r.(X - C) at its rest middle X)
    for (let k = 0; k < NP; k++) {
      const vs = sb.pieces[k].verts;
      let M = 0, Cx = 0, Cy = 0, Cz = 0, cx = 0, cy = 0, cz = 0;
      for (let n = 0; n < vs.length; n++) {
        const o = vs[n] * 3, w = m[vs[n]];
        M += w;
        Cx += X[o] * w; Cy += X[o + 1] * w; Cz += X[o + 2] * w;
        cx += x[o] * w; cy += x[o + 1] * w; cz += x[o + 2] * w;
      }
      if (!(M > 0)) continue;
      Cx /= M; Cy /= M; Cz /= M; cx /= M; cy /= M; cz /= M;
      A.fill(0);
      for (let n = 0; n < vs.length; n++) {
        const o = vs[n] * 3, w = m[vs[n]];
        const dx = (x[o] - cx) * w, dy = (x[o + 1] - cy) * w, dz = (x[o + 2] - cz) * w;
        const rx = X[o] - Cx, ry = X[o + 1] - Cy, rz = X[o + 2] - Cz;
        A[0] += dx * rx; A[1] += dx * ry; A[2] += dx * rz;
        A[3] += dy * rx; A[4] += dy * ry; A[5] += dy * rz;
        A[6] += dz * rx; A[7] += dz * ry; A[8] += dz * rz;
      }
      q[0] = q[1] = q[2] = 0;
      q[3] = 1;
      polarRot(q, A, R, 20);
      F[k * 5] = R[3]; F[k * 5 + 1] = R[4]; F[k * 5 + 2] = R[5];
      F[k * 5 + 3] = cy - (R[3] * Cx + R[4] * Cy + R[5] * Cz);
      F[k * 5 + 4] = 1;
    }
    for (let t = 0; t < sb.nT; t++) {
      const k = sb.tPiece[t];
      if (k < 0 || k >= NP || !F[k * 5 + 4]) continue;
      let rx = 0, ry = 0, rz = 0;
      for (let j = 0; j < 4; j++) {
        const o = T[t * 4 + j] * 3;
        rx += X[o]; ry += X[o + 1]; rz += X[o + 2];
      }
      H[t] = F[k * 5 + 3] + (F[k * 5] * rx + F[k * 5 + 1] * ry + F[k * 5 + 2] * rz) / 4;
    }
    return H;
  }

  // A frame of the seep: its drops let go at the mouth, by each pair's rate - just outside it, moving as the
  // jelly there and out of it (a dribble's barely, pulled open a jet's), as runny as the cube says
  _seepTick(dt) {
    const sb = this.app.sb, x = sb.x, v = sb.v, fl = this.app.fluid, S = this.seep, col = this._c;
    if (sb.cubeVersion !== this.cv) {
      S.length = 0; // (a new cube: no slit)
      return;
    }
    let total = 0;
    for (let n = 0; n < S.length; n += 5) total += S[n + 2];
    this.bank = Math.min(this.bank + total * dt, fl.vol * 8);
    while (this.bank >= fl.vol && fl.n < fl.max && total > 0) {
      let r = Math.random() * total, n = 0;
      while (n < S.length - 5 && (r -= S[n + 2]) > 0) n += 5;
      const i = S[n], p = S[n + 1], cube = S[n + 3], jet = 0.25 + 0.5 * S[n + 4];
      this.bank -= fl.vol;
      if (!sb.alive[i] || !sb.alive[p]) continue;
      // (out of the cube: away from its piece's middle, along the floor)
      const pc = sb.pieces[sb.vPiece[i]], mx = (x[i * 3] + x[p * 3]) / 2, my = (x[i * 3 + 1] + x[p * 3 + 1]) / 2, mz = (x[i * 3 + 2] + x[p * 3 + 2]) / 2;
      let ox = pc ? mx - pc.com[0] : 0, oz = pc ? mz - pc.com[2] : 0;
      const ol = Math.hypot(ox, oz) || 1;
      ox /= ol; oz /= ol;
      const visc = sb.cVisc[cube];
      col.set(this.app.flavorColorAtVertex(i));
      fl.add(mx + ox * 0.045, my, mz + oz * 0.045, fl.vol, (v[i * 3] + v[p * 3]) / 2 + ox * jet, (v[i * 3 + 1] + v[p * 3 + 1]) / 2, (v[i * 3 + 2] + v[p * 3 + 2]) / 2 + oz * jet,
        col.r, col.g, col.b, 0.004, 0, 0.12 + 0.83 * Math.pow(visc, 1.2), 30 * visc * visc, 1);
      this.debt[cube] += fl.vol;
      this.drained += fl.vol;
    }
  }

  // The liquid cubes' surface faces now: those new since the last look - a cut, a hole - that aren't the
  // cube's outside put their corners on the rim (mark false: the spill's own - the top of what's left, its
  // floor). A new cube (or its vertices renumbered) starts afresh. And the floor's vertices, the liquid's top,
  // for JellyView to draw flat (sb.liqTop: see JellyView._level) - SoftBody._liquidTets first.
  _look(sb, mark = true) {
    let own = !mark;
    if (sb.cubeVersion !== this.cv) {
      this.cv = sb.cubeVersion;
      this.known.clear();
      this.floor.clear();
      this.debt.fill(0);
      this.rim.fill(0);
      this.slits.length = 0;
      mark = own = false;
    }
    if (this.rim.length < sb.nV) {
      const r = new Uint8Array(Math.max(sb.nV * 2, 1024));
      r.set(this.rim);
      this.rim = r;
    }
    if (this._on.length < sb.nV) this._on = new Uint8Array(Math.max(sb.nV * 2, 1024));
    const F = sb.sTri, nV = sb.nV, now = new Set(), tc = sb.tCube, liq = sb.cLiq, so = sb.slitOf, on = this._on, V = this._tv, FF = this._tf;
    on.fill(0, 0, nV);
    V.length = FF.length = 0;
    for (let f = 0; f < sb.nF; f++) {
      if (!liq[tc[sb.sTet[f]]]) continue;
      let a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
      if (a > b) [a, b] = [b, a];
      if (b > c) [b, c] = [c, b];
      if (a > b) [a, b] = [b, a];
      const key = (a * nV + b) * nV + c;
      now.add(key);
      if (!this.known.has(key) && sb.sTag[f] !== TAG_EXTERIOR) {
        if (own) this.floor.add(key);
        else if (mark) {
          // (a slit's: no way out, too thin for the liquid - till it gapes, see update)
          if (so[a] && so[b] && so[c]) this.slits.push(a, b, c);
          else this.rim[a] = this.rim[b] = this.rim[c] = 1;
        }
      }
      // (the floor: its liquid's faces, not a slit's side - and the wall's over it, the gap's ceiling, wherever it
      // comes down near the floor: see JellyView._level. A slit's side: its corners all on it, not all of them
      // glued back - the cut's plane carried on past the slit, split and glued, is just more of the liquid: bared
      // on one side of it, it stood up from the floor in a fin)
      if (this.floor.has(key) && !(so[a] && so[b] && so[c] && (so[a] - 1 !== a || so[b] - 1 !== b || so[c] - 1 !== c))) {
        if (this._liq(sb, sb.sTet[f])) {
          FF.push(F[f * 3], F[f * 3 + 1], F[f * 3 + 2]);
          for (const i of [a, b, c]) if (on[i] !== 1) (on[i] || V.push(i)), (on[i] = 1);
        } else for (const i of [a, b, c]) if (!on[i]) (on[i] = 2), V.push(i);
      }
    }
    for (const k of this.floor) if (!now.has(k)) this.floor.delete(k);
    this.known = now;
    this.ver = sb.topoVersion;
    sb.liqTop = FF.length ? { topo: sb.topoVersion, v: Int32Array.from(V), f: Int32Array.from(FF), on, h: sb.hCell } : null;
  }
}
