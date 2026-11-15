// Shatter: brittle things - glass, hard candy, an ice cube, a sugar cube - and frozen jelly break. Under the mallet,
// shot, and hit hard: landing from a height, thrown down, flung into another cube (SoftBody.impacts - the knock as
// the change in its speed). How badly goes with how hard, against what it stands (STANDS, x its Toughness): a knock
// just past it, a clean crack or two through it - big pieces; harder, a star of cracks round the hit and a crushed,
// shell-curved crater of shards; a fall from the sky, it bursts - cracks all through it, its shards thrown wide.
// The cracks open over a frame or two (through a hit-stop) - each batch one rebuild - then wafer-thin crumbs turn to
// chips and the shards fly. Its shards break again landing hard enough, while they're big enough. Only what's
// frozen of a frozen piece breaks; a brittle thing breaks all through.

import * as THREE from 'three';
import { cutBody, sphereField, planeField, removeSmallPieces } from '../sim/cutting.js';
import { TEXTURES, resolveFlavor, flavorMainHex } from '../styles.js';
import { resolveSettings } from '../settings.js';

// (m/s: the knock each stands - its speed changed that much by what it hit - before it breaks; frozen jelly's. A
// glass cube off a table's edge, a metre: 4.4)
const STANDS = { glass: 5, candy: 6.5, ice: 6, sugar: 4 }, FROZEN_STANDS = 5.5;
const MIN_SHARD = 0.05; // (a piece this share of its cube's volume or less: too small to break again)
const AGAIN = 0.35; // (s: a piece just broken - or broken off - isn't broken again so soon)
const FROZEN_AT = -0.4; // (a piece's mean temperature: this or colder, frozen)
// (pieces in the room: this many, nothing more breaks - two glass cubes met at 430 km/h, 41 shards; those flung out
// broke again on the room's edge, 161 of them, 22,000 tets, a second and more a frame)
const MAX_PIECES = 60;

const R = (lo, hi) => lo + Math.random() * (hi - lo);

export class Shatter {
  constructor(app) {
    this.app = app;
    this.cur = null; // (a break under way: { cracks, batches, verts, p, d, n, chip, glassy, e })
    this.queue = []; // (breaks waiting their turn - another cube's, hit in the same knock)
    this._u = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this.vT = null; // (s: when each point of the jelly last broke - see _breakable)
    this._vl = new WeakMap(); // (each piece's way the frame before - see impacts)
  }

  // What piece pc is that breaks: { chip, glassy, frozen, stands } - or null (rubber, jelly as it is)
  brittleOf(pc) {
    const app = this.app, sb = app.sb;
    if (!pc) return null;
    const cb = app.cubes.find((c) => c.slot === pc.cube) || app.cube;
    const tex = TEXTURES[cb.style.texture], tough = resolveSettings(cb.tune, tex).tough ?? 1;
    if (tex?.brittle) {
      const chip = tex.chip === 'flavor' ? flavorMainHex(resolveFlavor(cb.style)) : tex.chip;
      return { chip, glassy: !!tex.glassy, frozen: false, stands: (STANDS[cb.style.texture] ?? 5.5) * tough };
    }
    let t = 0;
    for (const i of pc.verts) t += sb.temp[i];
    if (pc.verts.length && t / pc.verts.length < FROZEN_AT) return { chip: '#dcefff', glassy: false, frozen: true, stands: FROZEN_STANDS * tough };
    return null;
  }

  // (piece pc big enough to break - not a shard of a shard of one - and not just broken: by when its points last
  // were - pieces are made anew with every cut, its points keep theirs)
  _breakable(pc) {
    const sb = this.app.sb, s = sb.cSize[pc.cube] || sb.p.size, V = pc.verts, T = this.vT;
    if (!(pc.volume > MIN_SHARD * s * s * s) || !V.length) return false;
    if (!T || T.length < sb.vCap) return true;
    return !(sb.time - Math.max(T[V[0]], T[V[V.length >> 1]], T[V[V.length - 1]]) < AGAIN);
  }

  // (points broken just now: when)
  _broke(verts) {
    const sb = this.app.sb;
    if (!this.vT || this.vT.length < sb.vCap) {
      const T = new Float64Array(Math.max(sb.vCap, 1024)).fill(-9);
      if (this.vT) T.set(this.vT.subarray(0, Math.min(this.vT.length, T.length)));
      this.vT = T;
    }
    for (const i of verts) if (i < this.vT.length) this.vT[i] = sb.time;
  }

  // The hard knocks this frame (see SoftBody.impacts): each brittle - or frozen - piece knocked harder than it
  // stands breaks, from where it was hit, as badly as it was knocked past that. How hard: the speed it came in at,
  // by its own way the frames before - not the knock the solver reports, which counts a stiff thing's push back off
  // the floor over and over (glass off 4 m, 13 m/s, came in at 57). And the smaller it is the more it stands -
  // a shard half its cube's width, twice the knock (as broken glass does: else every shard landing broke again, an
  // ice cube off 3 m in 26 bits)
  impacts(list) {
    const sb = this.app.sb, VL = this._vl;
    for (const e of list) {
      if (sb.pieces.length >= MAX_PIECES) break;
      const pc = sb.pieces[e.piece];
      if (!pc || !this._breakable(pc)) continue;
      const B = this.brittleOf(pc);
      if (!B) continue;
      // (the hardest it came in over its last three frames: the knock's reported a frame or two on, bounced)
      const vl = VL.get(pc);
      let sp = 0.5 * e.dv;
      if (vl) {
        const q = e.kind === 'piece' ? VL.get(sb.pieces[e.partner]) : null;
        sp = 0;
        for (let j = 0; j < 9; j += 3) {
          if (e.kind === 'floor') sp = Math.max(sp, -vl[j + 1]);
          else if (e.kind === 'wall') sp = Math.max(sp, Math.hypot(vl[j], vl[j + 2]));
          else if (q) sp = Math.max(sp, Math.hypot(vl[j] - q[j], vl[j + 1] - q[j + 1], vl[j + 2] - q[j + 2]));
          else sp = Math.max(sp, Math.hypot(vl[j], vl[j + 1], vl[j + 2]));
        }
      }
      sp = Math.min(sp, e.dv);
      const s = sb.cSize[pc.cube] || sb.p.size, stands = B.stands * Math.min(4, Math.cbrt((s * s * s) / Math.max(pc.volume, 1e-9)));
      if (sp < stands) continue;
      // (its way in: from where it was hit to its middle)
      const p = new THREE.Vector3(e.x, e.y, e.z), d = new THREE.Vector3(pc.com[0] - e.x, pc.com[1] - e.y, pc.com[2] - e.z);
      if (d.lengthSq() < 1e-8) d.set(0, 1, 0);
      this.blow(e.piece, p, d, sp / stands, B, e.kind);
    }
    // (each piece's way now - its last three frames', newest first: the next frames' 'before')
    for (const pc of sb.pieces) {
      if (!pc) continue;
      let v = VL.get(pc);
      if (!v) VL.set(pc, (v = new Float32Array(9)));
      v.copyWithin(3, 0, 6);
      v[0] = pc.vel[0]; v[1] = pc.vel[1]; v[2] = pc.vel[2];
    }
  }

  // A blow at p (where it was hit), d its way into the piece, energy how badly (1: just past what it stands - the
  // mallet's is 1.6): breaks it. False, it doesn't (not brittle, too small, just broken)
  blow(piece, p, d, energy = 1, B = null, kind = 'blow') {
    const sb = this.app.sb, pc = sb.pieces[piece];
    if (!pc || !this._breakable(pc) || sb.pieces.length >= MAX_PIECES) return false;
    B = B || this.brittleOf(pc);
    if (!B) return false;
    this._broke(pc.verts);
    const job = { verts: pc.verts.slice(), com: pc.com.slice(), p: p.clone(), d: d.clone().normalize(), e: Math.min(6, Math.max(1, energy)), B, kind };
    if (this.cur) this.queue.push(job);
    else this._start(job);
    return true;
  }

  // (its cracks laid out - a star through the hit along the blow, the crater, shells, splits, a burst all through,
  // as many as the blow's hard enough for - and the first batch of them opened now)
  _start(job) {
    const app = this.app, sb = app.sb;
    // (the piece it was: whichever holds most of its points now - moved since it was queued, the hit with it)
    const count = new Map();
    for (const i of job.verts) {
      const k = sb.vPiece[i];
      if (k >= 0) count.set(k, (count.get(k) || 0) + 1);
    }
    let piece = -1, best = 0;
    for (const [k, c] of count) if (c > best) (best = c), (piece = k);
    const pc = sb.pieces[piece];
    if (!pc) return;
    const p = job.p.add(new THREE.Vector3(pc.com[0] - job.com[0], pc.com[1] - job.com[1], pc.com[2] - job.com[2])), d = job.d, B = job.B, e = job.e;
    const u = this._u.crossVectors(d, Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize().clone();
    const v = this._v.crossVectors(d, u).clone();
    const bb = pc.bbox.slice(), size = Math.max(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]);
    // (where it's frozen: a coarse grid of the piece's mean temperature - a brittle thing breaks all through)
    const cs = Math.max(0.05, size / 14), gx = Math.ceil((bb[3] - bb[0]) / cs) + 1, gy = Math.ceil((bb[4] - bb[1]) / cs) + 1, gz = Math.ceil((bb[5] - bb[2]) / cs) + 1;
    const tSum = new Float32Array(gx * gy * gz), tN = new Uint16Array(gx * gy * gz);
    const cell = (x, y, z) => {
      const i = Math.floor((x - bb[0]) / cs), j = Math.floor((y - bb[1]) / cs), k = Math.floor((z - bb[2]) / cs);
      return i < 0 || j < 0 || k < 0 || i >= gx || j >= gy || k >= gz ? -1 : (k * gy + j) * gx + i;
    };
    if (B.frozen)
      for (const i of pc.verts) {
        const c = cell(sb.x[i * 3], sb.x[i * 3 + 1], sb.x[i * 3 + 2]);
        if (c >= 0) (tSum[c] += sb.temp[i]), tN[c]++;
      }
    const m = 0.04;
    const ice = (x, y, z) => {
      if (x < bb[0] - m || x > bb[3] + m || y < bb[1] - m || y > bb[4] + m || z < bb[2] - m || z > bb[5] + m) return false;
      if (!B.frozen) return true;
      const c = cell(x, y, z);
      return c >= 0 && tN[c] ? tSum[c] / tN[c] < -0.25 : true;
    };
    const cracks = [];
    const plane = (n, at) => cracks.push(planeField(n.x, n.y, n.z, n.dot(at), ice));
    const tilted = (th, lean) => u.clone().multiplyScalar(Math.cos(th)).addScaledVector(v, Math.sin(th)).addScaledVector(d, R(-lean, lean)).normalize();
    let first;
    if (e < 1.4) {
      // just past it: a crack or two right through, from the hit - big pieces
      const N = Math.random() < 0.55 ? 1 : 2, a0 = Math.random() * Math.PI;
      for (let k = 0; k < N; k++) plane(tilted(a0 + (k + R(-0.25, 0.25)) * (Math.PI / N), 0.35), p.clone().addScaledVector(u, R(-0.08, 0.08) * size));
      first = cracks.length;
    } else {
      // a star of breaks through the hit along the blow, at uneven angles and each tilted a little off it - more
      // wedges, the harder
      const N = Math.min(6, Math.max(2, Math.round(1.4 + e * 0.7))), a0 = Math.random() * Math.PI;
      for (let k = 0; k < N; k++) plane(tilted(a0 + (k + R(-0.28, 0.28)) * (Math.PI / N), 0.3), p.clone().addScaledVector(u, R(-0.02, 0.02) * size));
      first = cracks.length;
      // the crater: a shallow, shell-shaped cap round the hit, its middle a little off it (crushed into small shards)
      {
        const r = R(0.3, 0.48) * size, dep = R(0.13, 0.22) * size * Math.min(1.6, 0.8 + 0.2 * e);
        const c = p.clone().addScaledVector(d, dep - r).addScaledVector(u, R(-0.05, 0.05) * size).addScaledVector(v, R(-0.05, 0.05) * size);
        const f = sphereField(c.x, c.y, c.z, r);
        f.inRegion = ice;
        cracks.push(f);
      }
      // hit as hard as a fall from the sky it bursts (below) - cracks all through it - else a second, wider shell
      // further out, more often the harder
      const burst = e >= 3 ? Math.min(3, Math.floor(e - 1.5)) : 0;
      if (!burst && Math.random() < Math.min(1, 0.45 + 0.15 * e)) {
        const r = R(0.5, 0.75) * size;
        const c = p.clone().addScaledVector(d, R(0.05, 0.2) * size - r * 0.35).addScaledVector(u, R(-0.1, 0.1) * size).addScaledVector(v, R(-0.1, 0.1) * size);
        const f = sphereField(c.x, c.y, c.z, r);
        f.inRegion = ice;
        cracks.push(f);
      }
      // long splits right through, off to the side of the hit
      const splits = Math.min(3, Math.floor((e - 1) * 0.6) + (Math.random() < 0.4 ? 1 : 0));
      for (let k = 0; k < splits; k++) plane(tilted(Math.random() * Math.PI * 2, 0.25), p.clone().addScaledVector(u, R(0.15, 0.32) * size * (Math.random() < 0.5 ? -1 : 1)));
      // (the burst: cracks all through it, every way - five of them on top of the rest, a glass cube off 45 m was 154
      // pieces, a frame half a second)
      for (let k = 0; k < burst; k++) {
        const n = new THREE.Vector3(R(-1, 1), R(-1, 1), R(-1, 1)).normalize();
        plane(n, new THREE.Vector3(R(bb[0], bb[3]), R(bb[1], bb[4]), R(bb[2], bb[5])));
      }
    }
    // (three cracks this frame - the star's first - and two a frame after: a burst's eleven cuts in three frames made
    // each 0.4-0.55 s - a phone's twice that)
    const batches = [];
    for (let n = Math.min(first, 3); ; n = Math.min(cracks.length, n + 2)) {
      batches.push(n);
      if (n >= cracks.length) break;
    }
    const glassy = B.glassy;
    this.cur = { cracks, batches, verts: pc.verts.slice(), p, d, n: 0, chip: B.chip, glassy, e, size, kind: job.kind };
    sb.selfQuietUntil = sb.time + 0.5;
    app.hitStop((glassy ? 0.13 : 0.1) * Math.min(1.4, 0.7 + 0.15 * e));
    const loud = Math.min(1, 0.55 + 0.15 * e);
    if (glassy) app.audio?.shatterGlass(loud);
    else app.audio?.crack(loud);
    app.audio?.thud(0.6);
    // (a burst of glints in its own colour - glass and candy throw more, a hard knock more again)
    const cc = new THREE.Color(B.chip), gc = [0.55 + cc.r * 0.45, 0.55 + cc.g * 0.45, 0.55 + cc.b * 0.45];
    const glints = Math.round((glassy ? 70 : 40) * Math.min(2, 0.6 + 0.25 * e));
    for (let k = 0; k < glints; k++) app.particles?.glitter(p, 1, gc, (glassy ? 1.9 : 1.4) * Math.min(1.8, 0.8 + 0.2 * e));
    if (glassy) app.flash = Math.max(app.flash || 0, 0.12);
    app.particles?.mist(p, new THREE.Vector3(0, 0.6, 0), Math.round(8 * Math.min(2, 0.6 + 0.25 * e)));
    app.tally?.('shattered');
    app.markDamaged();
    this._step();
  }

  // One step of a break: the next batch of cracks (one rebuild for the lot); after the last, the chips and the fling
  _step() {
    const S = this.cur, app = this.app, sb = app.sb;
    if (app.healer?.active) {
      this.cur = null;
      this.queue.length = 0;
      return;
    }
    if (S.batches.length) {
      const end = S.batches.shift(), anchors = app.allAnchors();
      for (; S.n < end; S.n++) {
        const pieces = [];
        for (const i of S.verts) {
          const k = sb.vPiece[i];
          if (k >= 0 && !pieces.includes(k)) pieces.push(k);
        }
        cutBody(sb, S.cracks[S.n], { separate: 0.02, anchors, pieces, light: S.n < end - 1 });
      }
      if (sb.topoStale) sb.rebuild();
      // (every piece of it - the new points along its cracks too - just broken: not broken again at once)
      const ks = new Set();
      for (const i of S.verts) if (sb.vPiece[i] >= 0) ks.add(sb.vPiece[i]);
      for (const k of ks) if (sb.pieces[k]) this._broke(sb.pieces[k].verts);
      app.onTopologyChanged();
      if (!S.batches.length) {
        if (S.glassy) app.audio?.shatterGlass(0.5, 0.18, 'glass2');
        else app.audio?.crack(0.45);
      }
      return;
    }
    this.cur = null;
    const p = S.p, d = S.d, k = Math.min(2.6, 0.75 + 0.3 * S.e);
    // wafer-thin crumbs become little chips instead of slivers - more of them, the harder it went
    const crumbs = removeSmallPieces(sb, 0.006 * sb.p.size ** 3, app.allAnchors());
    for (let j = 0; j < crumbs.length; j += 4) {
      const c = new THREE.Vector3(crumbs[j], crumbs[j + 1], crumbs[j + 2]);
      const w = c.clone().sub(p).normalize().multiplyScalar((2 + Math.random() * 2) * k);
      w.y += 2;
      app.droplets?.spawn(c, w, 0.012 + Math.cbrt(crumbs[j + 3]) * 0.35, S.chip, { frozen: true });
    }
    if (crumbs.length) app.onTopologyChanged();
    // (and the shards thrown out from the hit - wider, the harder. Knocked down hard, hit by another: thrown as whole
    // shards, every one, out across the floor - by the blow's own reach, the far ones hardly moved, a glass cube
    // dropped 8 m broke into a heap)
    if (S.kind === 'blow') {
      sb.radialImpulse(p.x, p.y, p.z, 1.4 * Math.max(1, S.size), 3.2 * k, 1.5 * Math.min(1.5, k));
      sb.impulse(p.x, p.y, p.z, d.x, d.y, d.z, 0.6, 3.0 * Math.min(1.5, k));
    } else sb.radialImpulse(p.x, p.y, p.z, 2.4 * Math.max(0.6, S.size), Math.min(11, 2.2 * S.e), 1.1 * Math.min(2.2, S.e), 1);
    const next = this.queue.shift();
    if (next) this._start(next);
  }

  update() {
    if (this.cur) this._step();
  }

  // (re-cubed: whatever was under way, dropped)
  reset() {
    this.cur = null;
    this.queue.length = 0;
  }
}
