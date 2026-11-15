// Cubiplication: a cube fed jelly (the ladle - tools/feed.js) swells; fed
// half again its size, it cubiplies - divides in two. Its rest shape is the thing that changes, and
// the jelly springs after it: grown, then stretched along its length into
// two smaller cubes joined by a neck that pinches in and draws out - the
// volume it was fed shared between them - until the neck snaps and two
// cubes spring apart, each built afresh at its new size, each different -
// drifted, mutated, now and then something else altogether (genetics.js) -
// named anew, and born into the family tree (family.js). A child that came
// out as something new arrives with a fanfare and sparkles; the two of them
// get a card side by side (ui/cubiplied.js).

import * as THREE from 'three';
import { REST_STEP, MAX_CUBES } from './sim/softbody.js';
import { resolveFlavor, flavorMainHex, copyGlitterMix, TEXTURES, EDGES, DEFAULT_STYLE } from './styles.js';
import { resolveSettings } from './settings.js';
import { nameCube } from './namegen.js';
import { mutate, topTier, TIER } from './genetics.js';
import { linOf, newId, recordBirth } from './family.js';
import { encodeCube } from './cubecode.js';

const SPLIT_AT = 1.5; // (fed to this much its volume, it divides)
const DIVIDE_T = 1.7; // s: from the first stretch to the snap
const MIN_CHILD = 0.38; // (smaller than this, a cube just grows)
const MAX_SIZE = 1.6; // (and no bigger than this)
const smooth = (x) => x * x * (3 - 2 * x);

export class Cubiplication {
  constructor(app) {
    this.app = app;
    this.m = null; // the cube being fed (one at a time)
    this.fx = []; // (children arriving as something new: sparkling a while)
  }

  get active() {
    return !!this.m;
  }

  get dividing() {
    return !!this.m?.dividing;
  }

  // Start (or carry on) feeding cube slot: false if it can't be (a hint says why).
  start(slot) {
    const app = this.app, sb = app.sb;
    if (app.healer.active || app.swapper.active) {
      app.ui?.hint('One sec - still re-cubing', 1400);
      return false;
    }
    if (this.m && this.m.slot !== slot) {
      if (this.m.dividing) return false;
      this._commit();
    }
    if (!this.m) {
      if (!app._whole(slot)) {
        app.ui?.hint('Re-cube it first - it only takes jelly whole', 1800);
        return false;
      }
      app._edgeMorphTick(0, true);
      // its rest shape as it is, about its middle (the morph works from it)
      const R = slot * REST_STEP, idx = [];
      for (let i = 0; i < sb.nV; i++) if (sb.vCube[i] === slot) idx.push(i);
      const G = new Float64Array(idx.length * 3);
      idx.forEach((i, j) => {
        G[j * 3] = sb.X[i * 3] - R;
        G[j * 3 + 1] = sb.X[i * 3 + 1];
        G[j * 3 + 2] = sb.X[i * 3 + 2];
      });
      this.m = { slot, R, idx, G, V: 1, g: 1, gW: 1, size0: sb.cSize[slot], bevel0: sb.cBevel[slot], h0: sb.cH[slot], topo: sb.topoVersion, feeding: false, dividing: false, u: 0, uW: -1, axis: 0, sing: 0, kids: null, pl: null, parent: null, mother: null, kB: -1, lookP: null, looks: null, eyeLinks: null };
      // (what it'll divide into, worked out as it's first fed: see _decide)
      this._decide(this.m);
    }
    this.m.feeding = true;
    return true;
  }

  // Released: it keeps what it was given (once it has settled to it).
  stop() {
    if (this.m) this.m.feeding = false;
  }

  // A blob of jelly into it: dv, a fraction of its starting volume.
  feed(dv, at) {
    const m = this.m, app = this.app;
    if (!m || m.dividing) return;
    const full = app.cubes.length >= MAX_CUBES, small = m.size0 * Math.cbrt(SPLIT_AT / 2) < MIN_CHILD;
    // (no room for another, or too small to split: it just grows - to a point)
    const cap = full || small ? Math.min((MAX_SIZE / m.size0) ** 3, small ? 3 : SPLIT_AT) : Infinity;
    if (m.V >= cap) {
      if (full && !m.toldFull) {
        m.toldFull = true;
        app.ui?.hint('The dish is full - eight cubes', 1800);
      }
      return;
    }
    m.V = Math.min(cap, m.V + dv);
    const sb = app.sb;
    // (a glorp, a jiggle and a glow where it went in)
    for (const i of m.idx) sb.glow[i] = Math.max(sb.glow[i], 0.18);
    if (at) sb.impulse(at.x, at.y, at.z, 0, -1, 0, 0.25 * m.size0, 0.6);
    app.audio?.drip(2.2, 0.03, app.audio?._panOf?.(at));
  }

  update(dt) {
    const m = this.m, app = this.app, sb = app.sb;
    if (this.fx.length) this._sparkle(dt);
    if (!m) return;
    // (cut, rebuilt or swapped meanwhile: what it was given, kept, as it is - drawn as one again)
    if (sb.topoVersion !== m.topo || app.healer.active || app.swapper.active) {
      this.m = null;
      if (sb.vLook) (sb.vLook = null), (app.jelly.topoVersion = -1), app.applyStyle();
      return;
    }
    m.g += (Math.cbrt(m.V) - m.g) * Math.min(1, dt * 5);
    // (dividing once it's grown to all it's been fed - its size then is what its eyes are put on: see _beginDivide)
    if (!m.dividing && m.V >= SPLIT_AT - 1e-9 && Math.abs(m.g - Math.cbrt(m.V)) < 0.004 && m.size0 * Math.cbrt(SPLIT_AT / 2) >= MIN_CHILD && app.cubes.length < MAX_CUBES) this._beginDivide();
    if (m.dividing) {
      m.u = Math.min(1, m.u + dt / DIVIDE_T);
      // (it strains, singing higher as the neck draws out)
      m.sing -= dt;
      if (m.sing <= 0) {
        m.sing = 0.22;
        app.audio?.ring(200 + 260 * m.u, 0.3 + 0.7 * m.u);
      }
      for (const i of m.idx) sb.glow[i] = Math.max(sb.glow[i], 0.25 + 0.5 * m.u * m.u);
    }
    // the rest shape (only when it changes) - and, in two, each half's look on its way to its child's
    if (Math.abs(m.g - m.gW) > 2e-5 || m.u !== m.uW) {
      m.gW = m.g;
      m.uW = m.u;
      this._shape();
      if (m.kB >= 0) this._looks(smooth(m.u));
    }
    if (m.dividing && m.u >= 1) this._split();
    else if (!m.dividing && !m.feeding && Math.abs(m.g - Math.cbrt(m.V)) < 1e-3) this._commit();
  }

  // Cubiplying: along the cube's axis that runs most across the screen (so
  // it's seen side on), lying flat
  _beginDivide() {
    const m = this.m, app = this.app, sb = app.sb;
    m.dividing = true;
    // (its size as it's grown: what its eyes are held on by, and its drawn skin's fit - see _twoLooks, _eyesOn. As
    // made, its eyes went on 7 cm under its grown skin, drawn faint through it)
    sb.cSize[m.slot] = m.size0 * m.g;
    sb.cBevel[m.slot] = m.bevel0 * m.g;
    sb.cH[m.slot] = m.h0 * m.g;
    m.u = 0;
    m.sing = 0;
    // (each rest axis's direction now: from where its two ends are)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(app.camera.quaternion);
    let best = 0, bestS = -1;
    for (const a of [0, 2]) {
      const lo = [0, 0, 0], hi = [0, 0, 0];
      let nl = 0, nh = 0;
      m.idx.forEach((i, j) => {
        const g = m.G[j * 3 + a];
        const t = g < 0 ? lo : hi;
        for (let k = 0; k < 3; k++) t[k] += sb.x[i * 3 + k];
        if (g < 0) nl++;
        else nh++;
      });
      const d = new THREE.Vector3(hi[0] / nh - lo[0] / nl, hi[1] / nh - lo[1] / nl, hi[2] / nh - lo[2] / nl).normalize();
      const s = Math.abs(d.dot(right)) - 0.8 * Math.abs(d.y);
      if (s > bestS) {
        bestS = s;
        best = a;
      }
    }
    m.axis = best;
    this._twoLooks(m);
    this._eyesOn(m);
    app.audio?.squish(0.9, 0.8);
    app.ui?.hint('Cubiplying…', 1600);
  }

  // Its two children, worked out as it's first fed - not as the neck snaps - so each half can turn into its own as it
  // divides: the parent's look and feel each drifted and mutated - wilder the further down its family it is - and
  // named anew (the second as the first's twin, for what mutated in them)
  _decide(m) {
    const app = this.app, cb = app.cubes.find((c) => c.slot === m.slot);
    if (!cb) return;
    // (a cube with no name yet gets one now: it's going in the family tree)
    if (!cb.name) cb.name = nameCube({ ...cb.style, tune: cb.tune }, { taken: app.cubes.map((x) => x.name || ''), ...app.nameCtx(), gen: cb.lin?.gen | 0 });
    const pl = { ...linOf(cb) }, rnd = Math.random;
    const kid = () => {
      const style = JSON.parse(JSON.stringify(cb.style)), tune = { ...cb.tune };
      const changes = mutate(style, tune, { rnd, gen: pl.gen, boost: this.boost ?? app.st?.mutation ?? 1 });
      return { style, tune, changes, name: '' };
    };
    const A = kid(), B = kid(), taken = app.cubes.map((x) => x.name || ''), ctx = { ...app.nameCtx(), gen: pl.gen + 1, parentName: cb.name };
    A.name = nameCube({ ...A.style, tune: A.tune }, { taken, ...ctx, changes: A.changes, pairing: true });
    B.name = nameCube({ ...B.style, tune: B.tune }, { taken: [...taken, A.name], ...ctx, changes: B.changes, twin: A.name });
    m.kids = [A, B];
    m.pl = pl;
    m.parent = this._as(cb);
    m.mother = { style: JSON.parse(JSON.stringify(cb.style)), tune: { ...cb.tune } };
  }

  // (a cube as its code has it)
  _as(x) {
    return { name: x.name, flavor: x.style.flavor, layers: x.style.layers, texture: x.style.texture, edges: x.style.edges, glitter: x.style.glitter || 'off', ...(x.style.glitter === 'custom' ? { glitterMix: copyGlitterMix(x.style.glitterMix) } : {}), rubik: x.style.rubik, ...(x.style.rubikState ? { rubikState: x.style.rubikState } : {}), trim: x.style.trim || 'none', tune: { ...x.tune }, tear: x.tune.tear !== false, theme: this.app.theme, eyes: x.style.eyes || [], surface: x.style.surface || 'none' };
  }

  // Drawn as two from here: its half past its middle along the axis with a look of its own - another cube's slot,
  // free, next to its own: its points' look is blended across the neck's tets, and a slot further off had the looks
  // of the ones between in a band there - and each half's turned into its child's as it divides (see _looks), till
  // the neck snaps. (One look till then, the two children came out of nowhere at the snap, all their differences at
  // once.) Not a cube full of liquid: its hollow's drawn by its own cube's
  _twoLooks(m) {
    const app = this.app, sb = app.sb, k = m.slot, a = m.axis;
    if (!m.kids || sb.cHollow[k]) return;
    const used = new Set(app.cubes.map((c) => c.slot)), kB = [k + 1, k - 1].find((q) => q >= 0 && q < MAX_CUBES && !used.has(q));
    if (kB === undefined) return;
    const L = sb.vCube.slice();
    m.idx.forEach((i, j) => {
      if (m.G[j * 3 + a] > 0) L[i] = kB;
    });
    // (its shape as its own cube's, for the drawn skin's fit to it - see JellyView.syncTopology)
    for (const A of [sb.cSize, sb.cBevel, sb.cH, sb.cBow, sb.cLobeA, sb.cLobeP, sb.cTrimK]) A[kB] = A[k];
    sb.cHollow[kB] = 0;
    sb.vLook = L;
    m.kB = kB;
    app.jelly.topoVersion = -1;
  }

  // Its eyes as its children's will be, from here: each half wearing its child's, where they'll be on it once it's
  // divided - an eye of the parent's already about there kept on, sliding over to it; another, popping on. (The
  // parent's own eyes rode the stretch into the neck and were drawn half sunk in it; and the children came out with
  // all their eyes at once, at the snap.) Each child's face toward its twin is the parent's middle - inside it - so
  // its eyes pop on at the snap
  _eyesOn(m) {
    const app = this.app, cb = app.cubes.find((c) => c.slot === m.slot);
    if (!cb || !m.kids) return;
    const a = m.axis, mine = (cb.style.eyes || []).slice(), used = new Set(), out = [], links = [[], []], now = performance.now();
    m.kids.forEach((K, h) => {
      const sg = h ? 1 : -1;
      (K.style.eyes || []).forEach((e, n) => {
        const p = [e.x, e.y, e.z];
        if (p[a] * sg < -0.45) return;
        // (its half of the parent: along the axis, half as far, out its side; across it, as it is)
        const q = p.slice();
        q[a] = (p[a] + sg * 0.5) / 2;
        let best = null, bd = 0.12 * 0.12;
        for (const o of mine) {
          if (used.has(o)) continue;
          const d = (o.x - q[0]) ** 2 + (o.y - q[1]) ** 2 + (o.z - q[2]) ** 2;
          if (d < bd) (bd = d), (best = o);
        }
        const o = best || {};
        if (best) used.add(best);
        else app.eyes?.born?.set(o, now);
        Object.assign(o, { x: q[0], y: q[1], z: q[2], r: e.r, s: e.s, p: e.p });
        out.push(o);
        links[h][n] = o;
      });
    });
    m.eyeLinks = links;
    cb.style.eyes = out;
  }

  // (a cube's look as App.applyStyle gives it: its flavour, and all it's set to)
  _lookOf(style, tune) {
    const ct = TEXTURES[style.texture] || TEXTURES[DEFAULT_STYLE.texture], cs = resolveSettings(tune, ct);
    return { f: resolveFlavor(style), o: { ...ct, ...cs, surface: style.surface, trim: style.trim, liqColor: style.liqColor || '', bevelRatio: (EDGES[style.edges] || EDGES[DEFAULT_STYLE.edges]).bevel } };
  }

  // Each half's look on its way from its parent's to its child's, w of the way: its colour, clarity, glow, gloss,
  // shine - all that blends, blended; what can't (its surface, its trim, a layered flavour) turned half way
  _looks(w) {
    const m = this.m, app = this.app, sb = app.sb;
    if (!(m?.kB >= 0) || !m.kids) return;
    const P = m.lookP || (m.lookP = this._lookOf(m.mother.style, m.mother.tune));
    m.looks ||= m.kids.map((K) => this._lookOf(K.style, K.tune));
    const mix = (a, b) => {
      const o = { ...(w < 0.5 ? a : b) };
      for (const key in a) if (typeof a[key] === 'number' && typeof b[key] === 'number') o[key] = a[key] + (b[key] - a[key]) * w;
      return o;
    };
    const flav = (fa, fb) => (fa.hex && fb.hex && !fa.layers && !fb.layers && fa.id !== 'rubik' && fb.id !== 'rubik' ? { ...(w < 0.5 ? fa : fb), hex: '#' + new THREE.Color(fa.hex).lerp(new THREE.Color(fb.hex), w).getHexString() } : w < 0.5 ? fa : fb);
    m.looks.forEach((L, j) => {
      const k = j ? m.kB : m.slot;
      app.jelly.setCubeLook(k, flav(P.f, L.f), mix(P.o, L.o), sb.cSize[k]);
    });
  }

  // The rest shape now: grown by g; dividing (u), drawn out into two cubes,
  // each half the volume, joined by a neck that pinches in and stretches.
  _shape() {
    const m = this.m, sb = this.app.sb, X = sb.X, G = m.G, a = m.axis;
    const h0 = m.size0 / 2, g = m.g, w = smooth(m.u);
    const c = m.size0 * g * Math.cbrt(0.5), hc = c / 2; // (a child's side)
    const gap = c * 0.42 * smooth(Math.min(1, m.u * 1.15));
    const pinch = 0.86 * smooth(Math.min(1, Math.max(0, (m.u - 0.15) / 0.75)));
    // (the neck pinched in near the middle only - in a third of each half either side, the eyes on its sides went in
    // with it, drawn half sunk)
    const neckW = 0.2 * h0;
    for (let j = 0; j < m.idx.length; j++) {
      const i = m.idx[j];
      const p0 = G[j * 3], p1 = G[j * 3 + 1], p2 = G[j * 3 + 2];
      let q0 = p0 * g, q1 = p1 * g, q2 = p2 * g;
      if (w > 0) {
        const pa = a === 0 ? p0 : p2, s = Math.sign(pa);
        // (its half, as one of two cubes - the neck pinched in near the middle)
        const ta = s * (gap / 2) + (pa / h0) * c;
        const k = 1 - pinch * Math.max(0, 1 - Math.abs(pa) / neckW) ** 2;
        const tp = (hc / h0) * k;
        const t1 = p1 * tp, tq = (a === 0 ? p2 : p0) * tp;
        q1 += (t1 - q1) * w;
        if (a === 0) {
          q0 += (ta - q0) * w;
          q2 += (tq - q2) * w;
        } else {
          q2 += (ta - q2) * w;
          q0 += (tq - q0) * w;
        }
      }
      X[i * 3] = q0 + m.R;
      X[i * 3 + 1] = q1;
      X[i * 3 + 2] = q2;
    }
    sb._computeRest();
    sb._computeMass();
    sb.wakeAll();
  }

  // Released without dividing: it's that much bigger now - its size, its
  // rounding, its cells, as built.
  _commit() {
    const m = this.m, app = this.app, sb = app.sb;
    this.m = null;
    if (!m || Math.abs(m.g - 1) < 1e-4) return;
    const k = m.slot, cb = app.cubes.find((c) => c.slot === k);
    sb.cSize[k] = m.size0 * m.g;
    sb.cBevel[k] = m.bevel0 * m.g;
    sb.cH[k] = m.h0 * m.g;
    if (cb) cb.tune.size = sb.cSize[k];
    sb._computeEscape();
    sb._rg = null;
    app._syncSel();
    app.jelly.topoVersion = -1; // (the render surface's true-shape fit, for the new size)
    app.applyStyle();
  }

  // The neck snaps: two cubes, built afresh at their new size where the two
  // halves are, flying apart, each a little different.
  _split() {
    const m = this.m, app = this.app, sb = app.sb, slot = m.slot;
    this.m = null;
    sb.vLook = null;
    const cb = app.cubes.find((c) => c.slot === slot);
    if (!cb) return;
    if (!m.kids) this._decide(m);
    // the two halves: where they are, how they move, how they're turned
    const side = [0, 0].map(() => ({ c: new THREE.Vector3(), v: new THREE.Vector3(), M: 0, verts: [] }));
    m.idx.forEach((i, j) => {
      const pa = m.G[j * 3 + m.axis];
      if (Math.abs(pa) < 1e-9) return;
      const S = side[pa < 0 ? 0 : 1], w = sb.m[i];
      S.verts.push(i);
      S.c.x += sb.x[i * 3] * w; S.c.y += sb.x[i * 3 + 1] * w; S.c.z += sb.x[i * 3 + 2] * w;
      S.v.x += sb.v[i * 3] * w; S.v.y += sb.v[i * 3 + 1] * w; S.v.z += sb.v[i * 3 + 2] * w;
      S.M += w;
    });
    for (const S of side) {
      S.c.multiplyScalar(1 / S.M);
      S.v.multiplyScalar(1 / S.M);
    }
    const axis = side[1].c.clone().sub(side[0].c).normalize();
    const mid = side[0].c.clone().add(side[1].c).multiplyScalar(0.5);
    // (each half's turn: its rest shape, a cube by now, fitted to where it is)
    for (const S of side) S.yaw = app.healer._yawOf({ verts: S.verts });
    // the twins, as worked out when it was first fed (see _decide), at their size now
    const c = Math.min(MAX_SIZE, m.size0 * m.g * Math.cbrt(0.5));
    const as = (x) => this._as(x), pl = m.pl, parent = m.parent, [A, B] = m.kids;
    A.tune.size = B.tune.size = c;
    // (their eyes: those each half wore, kept on - where they are on it now - and its face toward its twin's, popping on)
    const now = performance.now();
    m.kids.forEach((K, h) => {
      const L = m.eyeLinks?.[h] || [];
      K.style.eyes = (K.style.eyes || []).map((e, n) => {
        if (L[n]) return Object.assign(L[n], { x: e.x, y: e.y, z: e.z, r: e.r, s: e.s, p: e.p });
        const f = { ...e };
        app.eyes?.born?.set(f, now + 140);
        return f;
      });
    });
    // (the second where its half's look was drawn - else the first slot free)
    const used = new Set(app.cubes.map((x) => x.slot));
    let slotB = m.kB >= 0 && !used.has(m.kB) ? m.kB : 0;
    while (used.has(slotB)) slotB++;
    cb.style = A.style;
    cb.tune = A.tune;
    cb.name = A.name;
    cb.lin = { id: newId(), parent: pl.id, gen: pl.gen + 1 };
    const cbB = { slot: slotB, style: B.style, tune: B.tune, name: B.name, lin: { id: newId(), parent: pl.id, gen: pl.gen + 1 } };
    if (app.cube === cb) {
      app.style = cb.style;
      app.tune = cb.tune;
    }
    // (built afresh: the old body of it out, the two in)
    app.nails.clearAll();
    sb.removeCube(slot);
    app.cubes.push(cbB);
    app.stackOrder.push(slotB);
    app.cell = app.constructor.cellFor(app.cubes.map((x) => app.sizeOf(x)));
    // each where its half was - unless that's in another cube (a crowded
    // dish: the parent drawn out against its neighbours, or out past the
    // wall, and one was born inside another, the two stuck as one till a
    // re-cube): then the nearest clear spot, else on top of what's there.
    // The first set down before the second looks, so they keep clear of
    // each other too. (The dish a size for one more first: see _arena.)
    const lift = 0.02;
    app._arena();
    const put = (k, S, who) => {
      const [x, z, top] = app._clearSpot({ near: [S.c.x, S.c.z], size: c, gap: 1.12 });
      const moved = Math.hypot(x - S.c.x, z - S.c.z) > 1e-6;
      if (moved) S.c.set(x, top + c / 2, z);
      sb.addCube(k, x, moved ? top + lift : Math.max(0, S.c.y - c / 2) + lift, z, S.yaw, app.bevelOf(who), c, app.resOf(who));
    };
    put(slot, side[0], cb);
    put(slotB, side[1], cbB);
    sb.rebuild();
    app._resolution();
    app._arena();
    // flying apart, a little up
    const kick = 1.3;
    for (let i = 0; i < sb.nV; i++) {
      const k = sb.vCube[i];
      if (k !== slot && k !== slotB) continue;
      const S = side[k === slot ? 0 : 1], s = k === slot ? -1 : 1;
      sb.v[i * 3] = S.v.x + axis.x * kick * s;
      sb.v[i * 3 + 1] = S.v.y + 1.1;
      sb.v[i * 3 + 2] = S.v.z + axis.z * kick * s;
      sb.glow[i] = 0.7;
    }
    sb.wakeAll();
    app._syncSel();
    app.onTopologyChanged();
    app.applyStyle();
    app.ui?.cubesChanged?.();
    // the snap: a wet pop, a burst of light and glitter, a bright chord
    app.audio?.pop(1);
    app.audio?.squish(1, 1.2);
    app.audio?.resonate?.();
    app.shake(0.03);
    app.hitStop?.(0.06);
    app.flash = Math.max(app.flash || 0, 0.25);
    const col = new THREE.Color(flavorMainHex(resolveFlavor(cb.style)));
    app.particles?.flash(mid, 0.8 * c, [col.r * 3, col.g * 3, col.b * 3]);
    for (let k = 0; k < 30; k++) app.particles?.glitter(mid, 1, [0.6 + col.r * 0.4, 0.6 + col.g * 0.4, 0.6 + col.b * 0.4], 1.6);
    // (and the neck that held them: wet bits flung off it)
    for (let k = 0; k < 14; k++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 2.2, 1.2 + Math.random() * 2, (Math.random() - 0.5) * 2.2);
      app.droplets.spawn(mid.clone(), v, 0.012 + Math.random() * 0.02, flavorMainHex(resolveFlavor(Math.random() < 0.5 ? cb.style : cbB.style)));
    }
    // into the family: the parent as it was, the two as they're born
    const kids = [
      { cb, changes: A.changes, at: side[0].c },
      { cb: cbB, changes: B.changes, at: side[1].c },
    ];
    recordBirth(
      { ...pl, name: parent.name || '', code: encodeCube(parent) },
      kids.map((k) => ({ ...k.cb.lin, name: k.cb.name, code: encodeCube(as(k.cb)), changes: k.changes.filter((x) => x.tier > TIER.DRIFT).map(({ tier, label }) => ({ tier, label })) })),
    );
    // something new: a fanfare, and it sparkles a while
    const top = Math.max(...kids.map((k) => topTier(k.changes)));
    for (const k of kids) {
      const tier = topTier(k.changes);
      if (tier >= TIER.MAJOR) this.fx.push({ slot: k.cb.slot, t: 0, tier, col: flavorMainHex(resolveFlavor(k.cb.style)), life: () => (tier >= TIER.LEGENDARY ? 2.6 : 1.7) });
    }
    if (top >= TIER.MAJOR) setTimeout(() => app.audio?.fanfare?.(top), 260);
    const news = kids.flatMap((k) => k.changes.filter((x) => x.tier >= TIER.MAJOR).map((x) => `${k.cb.name}: ${x.label}`));
    app.ui?.hint(news.length ? `Cubiplied! ${news[0]}` : `Cubiplied! ${cb.name} & ${cbB.name}`, 3200);
    // the two of them, side by side (once they've landed)
    setTimeout(() => {
      app.ui?.cubiplied?.show({
        parent: { ...parent, gen: pl.gen },
        kids: kids.map((k) => ({ c: as(k.cb), changes: k.changes, lin: { ...k.cb.lin }, slot: k.cb.slot })),
      });
    }, 950);
    this.onSplit?.(cb, cbB);
  }

  // a child that came out as something new sparkles a while: glints off
  // it, in its colours (a legend's: every colour), and a glow through it
  _sparkle(dt) {
    const app = this.app, sb = app.sb;
    for (const f of this.fx) {
      f.t += dt;
      let cx = 0, cy = 0, cz = 0, n = 0, top = -1e9;
      for (let i = 0; i < sb.nV; i++) {
        if (sb.vCube[i] !== f.slot) continue;
        cx += sb.x[i * 3]; cy += sb.x[i * 3 + 1]; cz += sb.x[i * 3 + 2]; n++;
        if (sb.x[i * 3 + 1] > top) top = sb.x[i * 3 + 1];
        if (f.t < 1.2) sb.glow[i] = Math.max(sb.glow[i], 0.5 * (1 - f.t / 1.2));
      }
      if (!n) continue;
      const at = new THREE.Vector3(cx / n, Math.max(cy / n, top - 0.05), cz / n);
      const k = Math.max(0, Math.round((f.tier >= TIER.LEGENDARY ? 5 : 3) * (1 - f.t / f.life()) + 0.4));
      for (let q = 0; q < k; q++) {
        const c = f.tier >= TIER.LEGENDARY ? new THREE.Color().setHSL(Math.random(), 1, 0.6) : new THREE.Color(f.col).lerp(new THREE.Color(1, 1, 1), 0.35);
        app.particles?.glitter(at, 1, [c.r, c.g, c.b], 1.2 + Math.random());
      }
      if (f.t < dt * 1.5) app.particles?.flash(at, 0.9, f.tier >= TIER.LEGENDARY ? [3, 2.6, 3.2] : [2.4, 2.2, 1.8]);
    }
    this.fx = this.fx.filter((f) => f.t < f.life());
  }
}
