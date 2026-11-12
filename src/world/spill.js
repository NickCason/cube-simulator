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
// wasn't on the surface before and isn't the cube's own outside. A slit - a partial cut, a tear on its way
// through: its corners have partners across it (SoftBody.slitOf) - isn't one: it seeps (see _seepLook), out of
// the mouth that was seen as it was made, and the cube sags as it empties. Only its sides coming apart - torn
// through, cut off - make it an opening.
import * as THREE from 'three';
import { removeTets } from '../sim/cutting.js';
import { TAG_EXTERIOR, MAX_CUBES } from '../sim/softbody.js';

const LOOK = 0.25; // (s) between looks with nothing cut: a cup tipped pours
const UNDER = 0.6; // (cells) how far under the rim's lowest point it turns liquid too: its top
// (m) a slit's seep: as if open a few mm however close its sides lie (a cut's never quite shut), and as wide
// again as it gapes, choked by its own walls - the narrower, the much less - up to SEEP_OPEN, past which it
// runs freely (see _seepLook)
const SEEP_W0 = 0.005;
const SEEP_OPEN = 0.3;
const DRY = 0.45; // (its liquid let down to this share of what it was: spent - see _seepLook)
// (drops a second a slit lets out at the least, water: close enough, one after another, to be drawn as one
// stream - a short nick, one up near the liquid's top, let out a few a second, each lost in the puddle at its
// foot: it did nothing, it looked)
const SEEP_MIN = 10;
// (drops let go together, a bead: one on its own is too thin for the liquid's surface to be drawn round it -
// a slit's dribble fell unseen, and only the puddle it made showed)
const BEAD = 4;

export class Spill {
  constructor(app) {
    this.app = app;
    this.wait = 0;
    this.drained = 0; // (m^3, all told - for ?stats and the harnesses)
    this.rim = new Uint8Array(1024); // (per vertex: on an opening's rim)
    this.known = new Set(); // (the liquid cubes' surface faces as last seen)
    this.slits = []; // (a slit's faces, three vertices each: an opening once its sides are in two pieces)
    this.seen = new Uint8Array(1024); // (per vertex: on a slit's mouth that faced the eye as it was made)
    this.floor = new Set(); // (the faces its own running out bared, as in known: the top of what's left - see _look)
    this._on = new Uint8Array(1024); // (per vertex: on that top - 1 its floor, 2 the wall round the gap over it)
    this._tv = [];
    this._tf = [];
    // (the liquid cubes' faces that aren't their outside, as last looked at, in the rest shape: 9 floats each,
    // whether each was the floor, and a grid of them - see _onOld)
    this._old = new Float32Array(0);
    this._oldF = new Uint8Array(0);
    this._oldN = 0;
    this._grid = new Map();
    this._gh = 0.1;
    // (a slit's seep - see _seepLook: its mouth's pairs [vertex, partner, m^3/s, cube, m/s, share] - what's waiting to
    // come out, what's come out of each cube since it was last let down, and which are spent)
    this.seep = [];
    this.bank = 0;
    this.debt = new Float64Array(MAX_CUBES);
    this.spent = new Uint8Array(MAX_CUBES);
    this.ver = -1; // (the topology they were seen at)
    this.cv = -1; // (and the cubes: a new cube, a fresh start)
    this._c = new THREE.Color();
  }

  update(dt) {
    const app = this.app, sb = app.sb;
    if (app.healer?.active || app.swapper?.active || !sb.nT) {
      this.seep.length = 0;
      this.debt.fill(0);
      this.spent.fill(0); // (healed, it's full again)
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
    const rim = this.rim;
    // (a slit's sides in two pieces - torn through, the flap cut off - is an opening now)
    if (this.slits.length) {
      const S = this.slits, so = sb.slitOf, vp = sb.vPiece;
      let w = 0;
      for (let n = 0; n < S.length; n += 3) {
        let open = false, live = false;
        for (let j = 0; j < 3; j++) {
          const i = S[n + j], o2 = so[i] - 1;
          if (!sb.alive[i]) continue;
          live = true;
          if (o2 >= 0 && o2 !== i && sb.alive[o2] && vp[o2] !== vp[i]) open = true;
        }
        if (open) for (let j = 0; j < 3; j++) rim[S[n + j]] = 1;
        else if (live) (S[w++] = S[n]), (S[w++] = S[n + 1]), (S[w++] = S[n + 2]);
      }
      S.length = w;
    }
    // (what turns liquid: see _liq)
    const isLiq = (t) => this._liq(sb, t);
    // (an opening runs out: the mesh changed, looked at again next time - else slits under the liquid seep)
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
    const T = sb.T, x = sb.x, v = sb.v, tc = sb.tCube, tp = sb.tPiece, vol0 = sb.vol0, VS = sb.tVS;
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
        need += vol0[t] * VS[t];
      } else if (!skin[t] && vol0[t] > 0) keep.push(t); // (the skin's inside: what's settled in it, see below)
    }
    if (!go.size) return false;
    // as liquid, where each was, moving as it did, in its colour, as runny as the cube says - more than the
    // pool has room for (a big cube's is twice a phone's), each drop carrying more of it, so it fills as much
    // as it did (spread thinner, it settled to half: a cube cut across stood half empty); past that, thinner.
    // (As much as it holds now: a slit's let it down some - see _seepLook.)
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
      fl.add(cx, cy, cz, vol0[t] * VS[t] * scale, vx, vy, vz, col.r, col.g, col.b, 0.004, 0, 0.12 + 0.83 * Math.pow(visc, 1.2), 30 * visc * visc, mass);
      this.drained += vol0[t] * VS[t];
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
  // across it (see SoftBody.slitOf) - the mouth that faced the eye as it was made (the knife's plane runs
  // through the eye, and through the whole cube: what the hand sees edge-on is a slit in the face it cut, but
  // it came out the back and the bottom too - most of it, those being lower: out of everywhere but the slit,
  // it looked) - as fast as the head of liquid over it, how far it's open and how runny it is let it
  // (Torricelli, through a crack): a dribble down the side as it rests, a pour pulled open. Each mouth pair:
  // [vertex, partner, m^3/s, cube, how fast it comes out, its share of where it comes out]. And what's come
  // out, out of the cube: all its liquid let down a share (its tets' tVS - the cube sags as it empties; taken
  // off its top a few tets at a time, the liquid's top inside was a gap of jagged shards, and each bite a
  // rebuild), down to DRY: spent.
  _seepLook(sb, isLiq) {
    const x = sb.x, so = sb.slitOf, onSkin = sb._skinV, T = sb.T, tp = sb.tPiece, S = this.seep, VS = sb.tVS, seen = this.seen;
    // what's come out since the last look, out of each cube's liquid
    const D = this.debt;
    for (let c = 0; c < MAX_CUBES; c++) {
      if (!(D[c] > 0)) continue;
      let V = 0;
      for (let t = 0; t < sb.nT; t++) if (sb.tCube[t] === c && isLiq(t)) V += sb.vol0[t] * VS[t];
      if (V > 0) {
        const f = Math.max(0, 1 - D[c] / V);
        for (let t = 0; t < sb.nT; t++) if (sb.tCube[t] === c && isLiq(t)) VS[t] = Math.max(DRY, VS[t] * f);
        for (let k = 0; k < sb.pieces.length; k++) if (sb.pieces[k].cube === c) sb.wake(k);
      }
      D[c] = 0;
    }
    S.length = 0;
    let any = false;
    for (let i = 0; i < sb.nV; i++) if (seen[i] && so[i] && so[i] - 1 !== i) any = true;
    if (!any) return;
    // each piece's liquid's top (its highest liquid tet's middle), and each cube's liquid left (its tets' mean
    // share of what they held)
    const NP = sb.pieces.length, top = new Float64Array(NP).fill(-Infinity), vs = new Float64Array(MAX_CUBES), vn = new Float64Array(MAX_CUBES);
    for (let t = 0; t < sb.nT; t++) {
      if (!isLiq(t)) continue;
      const y = (x[T[t * 4] * 3 + 1] + x[T[t * 4 + 1] * 3 + 1] + x[T[t * 4 + 2] * 3 + 1] + x[T[t * 4 + 3] * 3 + 1]) / 4;
      if (y > top[tp[t]]) top[tp[t]] = y;
      vs[sb.tCube[t]] += VS[t];
      vn[sb.tCube[t]]++;
    }
    for (let c = 0; c < MAX_CUBES; c++) this.spent[c] = vn[c] > 0 && vs[c] / vn[c] < DRY + 0.02 ? 1 : 0;
    const g = Math.abs(sb.p.gravity ?? -22);
    for (let i = 0; i < sb.nV; i++) {
      const p = so[i] - 1;
      if (p <= i || !sb.alive[i] || !sb.alive[p] || !(onSkin[i] || onSkin[p]) || !(seen[i] || seen[p])) continue;
      const k = sb.vPiece[i], cube = sb.vCube[i];
      if (k < 0 || sb.vPiece[p] !== k || top[k] === -Infinity || !sb.cLiq[cube] || this.spent[cube]) continue;
      const head = top[k] - (x[i * 3 + 1] + x[p * 3 + 1]) / 2;
      if (!(head > 0)) continue;
      // (a strip of the mouth half a cell long, as wide as the slit runs - see SEEP_W0, SEEP_OPEN - its gap
      // counted no wider than a hand's: torn wide open, its pairs a metre apart, it emptied in half a second)
      const gap = Math.min(SEEP_OPEN, Math.hypot(x[i * 3] - x[p * 3], x[i * 3 + 1] - x[p * 3 + 1], x[i * 3 + 2] - x[p * 3 + 2]));
      const open = Math.min(1, gap / SEEP_OPEN), w = SEEP_W0 + gap * open, v = Math.sqrt(2 * g * head);
      const rate = 0.5 * sb.cH[cube] * w * v * 0.6 * thin(sb.cVisc[cube]);
      if (rate > 0) S.push(i, p, rate, cube, open * v, rate * head * head);
    }
    // (and each cube's slits at least SEEP_MIN drops a second, all told - less only just under its liquid's top,
    // less for thicker stuff - the pairs made up to it)
    const tot = new Float64Array(MAX_CUBES), deep = new Float64Array(MAX_CUBES);
    for (let n = 0; n < S.length; n += 6) {
      const c = S[n + 3], i = S[n], p = S[n + 1], k = sb.vPiece[i];
      tot[c] += S[n + 2];
      deep[c] = Math.max(deep[c], top[k] - (x[i * 3 + 1] + x[p * 3 + 1]) / 2);
    }
    for (let c = 0; c < MAX_CUBES; c++) {
      const want = SEEP_MIN * this.app.fluid.vol * thin(sb.cVisc[c]) * Math.min(1, deep[c] / 0.1);
      if (!(tot[c] > 0) || tot[c] >= want) continue;
      const f = want / tot[c];
      for (let n = 0; n < S.length; n += 6) if (S[n + 3] === c) S[n + 2] *= f;
    }
  }

  // A frame of the seep: its drops let go at the mouth, by each pair's rate - just outside it, moving as the
  // jelly there and out of it (a dribble's barely, pulled open a jet's), as runny as the cube says
  _seepTick(dt) {
    const sb = this.app.sb, x = sb.x, v = sb.v, fl = this.app.fluid, S = this.seep, col = this._c;
    if (sb.cubeVersion !== this.cv) {
      S.length = 0; // (a new cube: no slit)
      return;
    }
    // (how much, all told; where along the mouth, by its pairs' heads of liquid: down a slit's length it runs
    // out of its foot - let out anywhere along it, a few drops a second, each one alone, it read as nothing)
    let total = 0, wsum = 0;
    for (let n = 0; n < S.length; n += 6) (total += S[n + 2]), (wsum += S[n + 5]);
    this.bank = Math.min(this.bank + total * dt, fl.vol * BEAD * 4);
    while (this.bank >= fl.vol * BEAD && fl.n + BEAD <= fl.max && wsum > 0) {
      let r = Math.random() * wsum, n = 0;
      while (n < S.length - 6 && (r -= S[n + 5]) > 0) n += 6;
      const i = S[n], p = S[n + 1], cube = S[n + 3], jet = 0.5 * S[n + 4];
      this.bank -= fl.vol * BEAD;
      if (!sb.alive[i] || !sb.alive[p]) continue;
      // (out of the cube: away from its piece's middle, along the floor - just clear of its face, to run down it;
      // thrown clear of it, only as it's pulled open)
      const pc = sb.pieces[sb.vPiece[i]], mx = (x[i * 3] + x[p * 3]) / 2, my = (x[i * 3 + 1] + x[p * 3 + 1]) / 2, mz = (x[i * 3 + 2] + x[p * 3 + 2]) / 2;
      let ox = pc ? mx - pc.com[0] : 0, oz = pc ? mz - pc.com[2] : 0;
      const ol = Math.hypot(ox, oz) || 1;
      ox /= ol; oz /= ol;
      const visc = sb.cVisc[cube];
      col.set(this.app.flavorColorAtVertex(i));
      fl.add(mx + ox * 0.045, my, mz + oz * 0.045, fl.vol * BEAD, (v[i * 3] + v[p * 3]) / 2 + ox * jet, (v[i * 3 + 1] + v[p * 3 + 1]) / 2, (v[i * 3 + 2] + v[p * 3 + 2]) / 2 + oz * jet,
        col.r, col.g, col.b, 0.05, 0, 0.12 + 0.83 * Math.pow(visc, 1.2), 30 * visc * visc, 1);
      this.debt[cube] += fl.vol * BEAD;
      this.drained += fl.vol * BEAD;
    }
  }

  // The liquid cubes' surface faces now: those new since the last look - a cut, a hole - that aren't the
  // cube's outside put their corners on the rim (mark false: the spill's own - the top of what's left, its
  // floor) - unless they're a slit's (a corner with a partner across it: see SoftBody.slitOf), or they lie on
  // a face that was there before (_onOld: the old surface cut up again - a tear's plane through a slit, a
  // second cut across the first; taken for an opening, a tear started along a slit turned all the liquid at
  // once). A new cube (or its vertices renumbered) starts afresh. And the floor's vertices, the liquid's top,
  // for JellyView to draw flat (sb.liqTop: see JellyView._level) - SoftBody._liquidTets first.
  _look(sb, mark = true) {
    let own = !mark;
    if (sb.cubeVersion !== this.cv) {
      this.cv = sb.cubeVersion;
      this.known.clear();
      this.floor.clear();
      this.rim.fill(0);
      this.seen.fill(0);
      this.slits.length = 0;
      this._oldN = 0;
      this._grid.clear();
      this.debt.fill(0);
      this.spent.fill(0);
      mark = own = false;
    }
    if (this.rim.length < sb.nV) {
      const n = Math.max(sb.nV * 2, 1024), r = new Uint8Array(n), s = new Uint8Array(n);
      r.set(this.rim);
      s.set(this.seen);
      this.rim = r;
      this.seen = s;
    }
    if (this._on.length < sb.nV) this._on = new Uint8Array(Math.max(sb.nV * 2, 1024));
    const F = sb.sTri, nV = sb.nV, now = new Set(), tc = sb.tCube, liq = sb.cLiq, so = sb.slitOf, on = this._on, V = this._tv, FF = this._tf;
    on.fill(0, 0, nV);
    V.length = FF.length = 0;
    let mouth = null;
    for (let f = 0; f < sb.nF; f++) {
      if (!liq[tc[sb.sTet[f]]]) continue;
      let a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
      if (a > b) [a, b] = [b, a];
      if (b > c) [b, c] = [c, b];
      if (a > b) [a, b] = [b, a];
      const key = (a * nV + b) * nV + c;
      now.add(key);
      if (!this.known.has(key) && sb.sTag[f] !== TAG_EXTERIOR) {
        const was = this._onOld(sb, a, b, c);
        if (was) {
          if (was === 2) this.floor.add(key);
        } else if (own) this.floor.add(key);
        else if (mark) {
          // (a slit's - no way out but its seep, see _seepLook - till its sides come apart, see update)
          if (so[a] || so[b] || so[c]) {
            this.slits.push(a, b, c);
            mouth = mouth || new Set();
            mouth.add(a).add(b).add(c);
          } else this.rim[a] = this.rim[b] = this.rim[c] = 1;
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
    if (mouth) this._seeMouth(sb, mouth);
    this.known = now;
    this.ver = sb.topoVersion;
    this._keepOld(sb);
    sb.liqTop = FF.length ? { topo: sb.topoVersion, v: Int32Array.from(V), f: Int32Array.from(FF), on, h: sb.hCell } : null;
  }

  // A new slit's mouth - its corners on the cube's outside - as the eye sees it: those whose outside faces it
  // (the slit's other mouths, out of sight, stay shut)
  _seeMouth(sb, M) {
    const on = sb._skinV, F = sb.sTri, x = sb.x, e = this.app.camera.position, N = new Map();
    for (const i of M) if (on[i]) N.set(i, [0, 0, 0]);
    if (!N.size) return;
    for (let f = 0; f < sb.nF; f++) {
      if (sb.sTag[f] !== TAG_EXTERIOR) continue;
      const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
      if (!N.has(a) && !N.has(b) && !N.has(c)) continue;
      const ux = x[b * 3] - x[a * 3], uy = x[b * 3 + 1] - x[a * 3 + 1], uz = x[b * 3 + 2] - x[a * 3 + 2];
      const wx = x[c * 3] - x[a * 3], wy = x[c * 3 + 1] - x[a * 3 + 1], wz = x[c * 3 + 2] - x[a * 3 + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      for (const i of [a, b, c]) {
        const s = N.get(i);
        if (s) (s[0] += nx), (s[1] += ny), (s[2] += nz);
      }
    }
    for (const [i, n] of N) if (n[0] * (e.x - x[i * 3]) + n[1] * (e.y - x[i * 3 + 1]) + n[2] * (e.z - x[i * 3 + 2]) > 0) this.seen[i] = 1;
  }

  // (the liquid cubes' faces that aren't their outside, kept in the rest shape for the next look - see _onOld)
  _keepOld(sb) {
    const F = sb.sTri, X = sb.X, tc = sb.tCube, liq = sb.cLiq, nV = sb.nV;
    let n = 0;
    for (let f = 0; f < sb.nF; f++) if (liq[tc[sb.sTet[f]]] && sb.sTag[f] !== TAG_EXTERIOR) n++;
    if (this._old.length < n * 9) {
      this._old = new Float32Array(n * 18);
      this._oldF = new Uint8Array(n * 2);
    }
    const O = this._old, G = this._grid, h = (this._gh = sb.hCell);
    G.clear();
    n = 0;
    for (let f = 0; f < sb.nF; f++) {
      if (!liq[tc[sb.sTet[f]]] || sb.sTag[f] === TAG_EXTERIOR) continue;
      let lo0 = Infinity, lo1 = Infinity, lo2 = Infinity, hi0 = -Infinity, hi1 = -Infinity, hi2 = -Infinity;
      for (let j = 0; j < 3; j++) {
        const i = F[f * 3 + j] * 3, o = n * 9 + j * 3;
        O[o] = X[i]; O[o + 1] = X[i + 1]; O[o + 2] = X[i + 2];
        lo0 = Math.min(lo0, X[i]); lo1 = Math.min(lo1, X[i + 1]); lo2 = Math.min(lo2, X[i + 2]);
        hi0 = Math.max(hi0, X[i]); hi1 = Math.max(hi1, X[i + 1]); hi2 = Math.max(hi2, X[i + 2]);
      }
      let a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
      if (a > b) [a, b] = [b, a];
      if (b > c) [b, c] = [c, b];
      if (a > b) [a, b] = [b, a];
      this._oldF[n] = this.floor.has((a * nV + b) * nV + c) ? 2 : 1;
      const m = 0.05 * h;
      for (let ix = Math.floor((lo0 - m) / h); ix <= Math.floor((hi0 + m) / h); ix++)
        for (let iy = Math.floor((lo1 - m) / h); iy <= Math.floor((hi1 + m) / h); iy++)
          for (let iz = Math.floor((lo2 - m) / h); iz <= Math.floor((hi2 + m) / h); iz++) {
            const k = cellKey(ix, iy, iz), L = G.get(k);
            if (L) L.push(n);
            else G.set(k, [n]);
          }
      n++;
    }
    this._oldN = n;
  }

  // Whether the face a b c lies on one of the last look's faces, in the rest shape - its middle on it, a
  // twentieth of a cell either side - and so what it was: 2 the floor, 1 any other; 0 none.
  _onOld(sb, a, b, c) {
    if (!this._oldN) return 0;
    const X = sb.X, O = this._old, h = this._gh;
    const px = (X[a * 3] + X[b * 3] + X[c * 3]) / 3, py = (X[a * 3 + 1] + X[b * 3 + 1] + X[c * 3 + 1]) / 3, pz = (X[a * 3 + 2] + X[b * 3 + 2] + X[c * 3 + 2]) / 3;
    const L = this._grid.get(cellKey(Math.floor(px / h), Math.floor(py / h), Math.floor(pz / h)));
    if (!L) return 0;
    const tol = 0.05 * h;
    for (const n of L) {
      const o = n * 9;
      const ux = O[o + 3] - O[o], uy = O[o + 4] - O[o + 1], uz = O[o + 5] - O[o + 2];
      const vx = O[o + 6] - O[o], vy = O[o + 7] - O[o + 1], vz = O[o + 8] - O[o + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (!(nl > 1e-12)) continue;
      const wx = px - O[o], wy = py - O[o + 1], wz = pz - O[o + 2];
      if (Math.abs((wx * nx + wy * ny + wz * nz) / nl) > tol) continue;
      // (inside it: its barycentric coordinates, a little slack)
      const uu = ux * ux + uy * uy + uz * uz, uv = ux * vx + uy * vy + uz * vz, vv = vx * vx + vy * vy + vz * vz;
      const wu = wx * ux + wy * uy + wz * uz, wv = wx * vx + wy * vy + wz * vz, den = uu * vv - uv * uv;
      if (!(Math.abs(den) > 1e-18)) continue;
      const s = (vv * wu - uv * wv) / den, t = (uu * wv - uv * wu) / den;
      if (s >= -0.02 && t >= -0.02 && s + t <= 1.02) return this._oldF[n];
    }
    return 0;
  }
}

// (how freely it runs, by how thick it is: water all of it, syrup ~0.65, glue ~0.35, a gel a trickle, near
// solid none - the cube's own thickness cubed, glue's let out an eighth and looked shut)
function thin(visc) {
  return Math.pow(Math.max(0, 1 - visc), 1.5);
}

// (a grid cell's key: a hash - two cells sharing one only add a face to look at)
function cellKey(ix, iy, iz) {
  return Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791);
}
