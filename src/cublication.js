// Cublication - an exhibition mode: a cube in a dish, fed and divided, again and again, as long as you like. A glass
// dish on the floor - the room's other cubes put away (back as they were when you leave) - and a ladle over it pouring
// jelly in: the cube swells to twice itself and divides (Cubiplication: its halves turning into its two children as
// the neck draws out - slowed at the snap) into two its own size, each a little different, as much as the Mutation
// slider says. One's kept - tap it, or, left to itself, the stranger of the two - the other lifts out of the dish and
// is gone, and the kept one's drawn back to the middle to be fed again. Every generation kept: gone back through on the
// Gen slider (its look eased into each), and the line gone on from any of them - a branch, the one it left kept in the
// family tree (see ui/cublibar.js).

import * as THREE from 'three';
import { makeDish, makeLadle } from './world/models.js';
import { resolveFlavor, flavorMainHex } from './styles.js';
import { SETTINGS } from './settings.js';
import { captureCube } from './cubecode.js';
import { TIER, topTier } from './genetics.js';
import { linOf } from './family.js';
import { nameCube } from './namegen.js';
import { lookOf, blendLook } from './cubiplication.js';

const STORE = 'cube-sim-cublication';
export const MUTATION = SETTINGS.find((s) => s.id === 'mutation'); // (the Cubicle's slider: its range and its words)
const SPLIT = 2; // (fed to twice itself: its two children each its own size)
const DIVIDE_T = 2.4; // s: from the first stretch to the snap (the Cubicle's 1.7 - here it's what you came for)
const BLOB = 0.024, DRIP = 0.06; // (a ladle's blob of jelly, one so often - see FeedTool)
const SLOW = 0.2, SLOW_FOR = 1.1; // (the snap in slow motion: this slow, held this long - real time - after it)
const PICK_T = 3.4; // s: the two of them on show before one's kept, going on by itself
const LIFT_T = 1.2; // s: the other lifting out of the dish
const TWEEN_T = 0.45; // s: a generation's look eased into
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export class CublicationMode {
  constructor(app) {
    this.app = app;
    this.on = false;
    this.phase = ''; // '' still, 'feed', 'divide', 'pick', 'part', 'settle', 'view' (a generation gone back to)
    this.running = false; // (going on by itself: fed, divided, one kept, fed again...)
    this.mutation = 1; // (as the Cubicle's: 0.2 all but identical ... 4 chaos)
    try {
      const o = JSON.parse(localStorage.getItem(STORE) || '{}');
      if (o.mutation >= MUTATION.to(0) && o.mutation <= MUTATION.to(1)) this.mutation = o.mutation;
    } catch (e) {}
    this.gens = []; // (the line: each generation kept - { id, parent, gen, name, c: as captureCube has it, changes, twin })
    this.nodes = new Map(); // (everyone born in the dish, by id - { id, parent, gen, name, c, changes, kept, kids: [ids] })
    this.rootId = null;
    this.view = 0; // (the generation on show)
    this.cube = null; // (the one in the dish)
    this.pick = null; // (the two of them, born: { kids, changes, born: as captured, t, pref })
    this.part = null; // (the other, lifting away: { cb, t, spin })
    this.lastKept = -1; // (which of the last two was kept: 0, where its parent was; 1)
    this.tw = null; // (a generation's look eased into: { from, to, t })
    this.t = 0; // (s in this phase)
    this.drip = 0;
    this.blobs = []; // (blobs of jelly on their way into it - droplets)
    this.slowT = 0; // (real time left of the snap's slow motion)
    this.push = 0; // (the view drawn in on it as it divides)
    this.flare = 0; // (the dish's ring lit up: a snap, a keep)
    this.waveT = -1; // (the ring sent out across the dish at a snap: how long since)
    this._hopT = 0;
    this.R = 2.4; // (the dish's reach)
    this.s = 1; // (the cube's size)
    this.model = null;
    this.ladle = null;
    this.lip = new THREE.Vector3();
    this.frameX = 0; // (where the camera looks - see App._updateCamera)
    this.frameY = null;
    this.frameZ = 0;
    this._was = null; // (the room as it was - its reach, ceiling, the view - and Cubiplication's ways)
    this._parked = []; // (the room's other cubes, put away: { c, lin })
    this._still = 0;
    this._busyT = 0;
    this.onChange = null; // (its bar: see ui/cublibar.js)
    this.onBirth = null; // (its card: the two of them, just born)
  }

  // (how wild: the Cubicle's mutation - as it changes, the children on their way worked out again)
  setMutation(v) {
    this.mutation = Math.min(MUTATION.to(1), Math.max(MUTATION.to(0), v));
    try {
      localStorage.setItem(STORE, JSON.stringify({ mutation: this.mutation }));
    } catch (e) {}
    const C = this.app.cubiplication;
    if (!this.on) return;
    C.boost = this.mutation;
    if (C.m && !C.m.dividing) C._decide(C.m);
  }

  // (feeding: how far to dividing, 0..1 - dividing, how far through)
  get progress() {
    const m = this.app.cubiplication.m;
    if (this.phase === 'feed') return m ? Math.min(1, Math.max(0, (m.V - 1) / (SPLIT - 1))) : 0;
    if (this.phase === 'divide') return 1;
    return 0;
  }

  get dividing() {
    return this.app.cubiplication.m?.dividing ? this.app.cubiplication.m.u : 0;
  }

  // (the generation on show)
  get shown() {
    return this.gens[this.view] || null;
  }

  enter() {
    if (this.on) return true;
    const app = this.app, sb = app.sb, C = app.cubiplication;
    if (app.healer.active || app.swapper.active || C.dividing) {
      app.ui?.hint(C.dividing ? 'One sec - it is cubiplying' : 'One sec - still re-cubing', 1400);
      return false;
    }
    // (a cube fed with the ladle and let go, still swelling to it: it keeps what it was given)
    if (C.m) {
      C.m.g = Math.cbrt(C.m.V);
      C._shape();
      C._commit();
    }
    app.tool?.up?.();
    sb.endGrab();
    const g = app.orbitGoal;
    this._was = { arena: sb.p.arenaRadius, ceiling: sb.p.ceiling, view: { theta: g.theta, phi: g.phi, radius: g.radius }, hooks: { splitAt: C.splitAt, divideT: C.divideT, boost: C.boost, quiet: C.quiet, onSplit: C.onSplit } };
    this.on = true;
    // the room's others put away, as they are
    const keep = app.cube, others = app.cubes.filter((x) => x !== keep);
    this._parked = others.map((o) => ({ c: this._capture(o), lin: o.lin ? { ...o.lin } : null }));
    for (const o of others) app.removeCube(o.slot);
    this.cube = keep;
    if (!keep.name) keep.name = nameCube({ ...keep.style, tune: keep.tune }, { taken: [], ...app.nameCtx(), gen: keep.lin?.gen | 0 });
    // the dish: room for two its size, flying apart, its wall what stops them (the room no smaller than it was)
    this.s = app.sizeOf(keep);
    this.R = Math.max(app._viewArena || sb.p.arenaRadius, 1.7 * this.s);
    app.roomHold = { arena: this.R, ceiling: Math.max(4.2, 4.5 * this.s) };
    app._arena();
    this.model = makeDish(app.M, this.R, this.s);
    app.scene.add(this.model);
    this.ladle = makeLadle(app.M);
    this.ladle.visible = false;
    app.scene.add(this.ladle);
    // Cubiplication its way: children its size, a slower division, the mutation here, no card nor word of its own
    C.splitAt = SPLIT;
    C.divideT = DIVIDE_T;
    C.boost = this.mutation;
    C.quiet = true;
    C.onSplit = (a, b, ca, cb) => this._born(a, b, ca, cb);
    // the line, from it
    this.gens = [this._gen(keep, [], null)];
    this.nodes.clear();
    this.rootId = this.gens[0].id;
    this.nodes.set(this.rootId, { ...this.gens[0], kept: true, kids: [] });
    this.view = 0;
    this.pick = this.part = this.tw = null;
    this.blobs.length = 0;
    this.running = false;
    this.push = 0;
    this.flare = 0;
    g.theta = 0.35;
    g.phi = 0.42;
    this.frameX = this.frameZ = 0;
    this.frameY = 0.5 * this.s;
    this._to('');
    return true;
  }

  exit() {
    if (!this.on) return;
    const app = this.app, sb = app.sb, C = app.cubiplication;
    this.running = false;
    // dividing: done now - the one it'd have kept, kept (the other gone with the dish); fed: called off
    if (C.m?.dividing) {
      C.m.u = 1;
      C._split();
    } else C.cancel();
    if (this.pick) this._keep(this.pick.pref, true);
    if (this.part) this._poof();
    for (const b of this.blobs) {
      const i = app.droplets.items.indexOf(b);
      if (i >= 0) app.droplets.items.splice(i, 1);
    }
    this.blobs.length = 0;
    Object.assign(C, this._was.hooks);
    if (this.model) app.scene.remove(this.model);
    if (this.ladle) app.scene.remove(this.ladle);
    this.model = this.ladle = null;
    sb.p.arenaRadius = this._was.arena;
    sb.p.ceiling = this._was.ceiling;
    Object.assign(app.orbitGoal, this._was.view);
    this._was = null;
    app.roomHold = null;
    app._arena();
    app.slowGoal = 1;
    // the others back, set down where there's room
    const mine = this.cube;
    for (const p of this._parked) {
      const slot = app.addCube(p.c, { drop: true });
      const cb = app.cubes.find((x) => x.slot === slot);
      if (cb && p.lin) cb.lin = p.lin;
    }
    this._parked = [];
    if (mine && app.cubes.includes(mine)) app.selectCube(mine.slot);
    this.on = false;
    this.phase = '';
    this.frameY = null;
    this.pick = this.part = this.tw = null;
    this.cube = null;
    this._changed();
  }

  // Go: on by itself - from the generation on show (gone back to: the line goes on from there, a branch)
  go() {
    if (!this.on || this.running) return;
    if (this.view < this.gens.length - 1) this.gens.length = this.view + 1;
    this.running = true;
    if (!this.phase || this.phase === 'view') this._to('settle');
    else this._changed();
  }

  // Pause: it stops where it is (fed so far, held; dividing, it finishes, and the two wait to be picked from)
  pause() {
    if (!this.on || !this.running) return;
    this.running = false;
    this._changed();
  }

  // Keep the i'th of the two just born (0: where its parent was)
  keep(i) {
    if (this.on && this.phase === 'pick') this._keep(i);
  }

  // A tap on the screen: on one of the two just born, that one kept
  tap(x, y) {
    if (!this.on || this.phase !== 'pick' || !this.pick) return false;
    const app = this.app, hit = app.pickJelly(app.rayFromClient(x, y)), k = hit ? app.sb.pieces[hit.piece]?.cube : -1;
    const i = this.pick.kids.findIndex((c) => c.slot === k);
    if (i < 0) return false;
    this._keep(i);
    return true;
  }

  // Generation i on show - its look eased into from the one there (not while one's being born)
  showGen(i) {
    if (!this.on || !this.gens.length || ['divide', 'pick', 'part'].includes(this.phase)) return false;
    i = Math.max(0, Math.min(this.gens.length - 1, Math.round(i)));
    const app = this.app, C = app.cubiplication, cb = this.cube;
    if (!cb || !app.cubes.includes(cb)) return false;
    this.running = false;
    C.cancel();
    this.ladle.visible = false;
    if (i !== this.view || this.phase === 'feed') {
      const G = this.gens[i], from = lookOf(cb.style, cb.tune);
      if (app.cube !== cb) app.selectCube(cb.slot);
      app.loadCube(JSON.parse(JSON.stringify(G.c)));
      cb.lin = { id: G.id, parent: G.parent, gen: G.gen };
      cb.name = G.name;
      this.tw = { from, to: lookOf(cb.style, cb.tune), t: 0 };
      this.view = i;
    }
    this._to(i < this.gens.length - 1 ? 'view' : '');
    return true;
  }

  // The family tree, as born here: { root, nodes, line: the ids of the generations on the line now }
  lineage() {
    return { root: this.rootId, nodes: this.nodes, line: new Set(this.gens.map((g) => g.id)) };
  }

  // Back on the line that went through id (a generation of another branch): it, and its kept line up to it, the line
  // now - shown
  toNode(id) {
    const n = this.nodes.get(id);
    if (!n || !this.on || ['divide', 'pick', 'part'].includes(this.phase)) return false;
    const path = [];
    for (let q = n; q; q = q.parent ? this.nodes.get(q.parent) : null) path.unshift(q);
    if (path[0]?.id !== this.rootId) return false;
    this.gens = path.map((q, j) => ({ id: q.id, parent: q.parent, gen: q.gen, name: q.name, c: q.c, changes: q.changes, twin: j ? this._twinOf(path[j - 1], q) : null }));
    this.view = -1;
    return this.showGen(this.gens.length - 1);
  }

  update(dt, rdt = dt) {
    if (!this.on) return;
    const app = this.app, C = app.cubiplication;
    if (this.cube && !app.cubes.includes(this.cube)) this.cube = app.cube;
    const cb = this.cube;
    this.t += rdt;
    // the snap's slow motion, by the real clock - and the division slowed with the jelly (it goes by the real clock)
    if (this.slowT > 0 && (this.slowT -= rdt) <= 0) app.slowGoal = 1;
    C.divideT = DIVIDE_T / Math.max(0.05, app.timeScale ?? 1);
    this._tween(rdt);
    this._feedBlobs();
    switch (this.phase) {
      case 'feed':
        if (C.dividing) {
          this._to('divide');
          break;
        }
        if (!C.m && !this._begin(rdt)) break;
        if (this.running) this._pour(rdt, cb);
        else this.ladle.visible = false;
        break;
      case 'divide': {
        this.ladle.visible = false;
        // (slowing as it comes to the snap)
        const u = C.m?.u ?? 1;
        if (u > 0.7 && app.slowGoal !== SLOW) app.slowGoal = 0.55;
        break;
      }
      case 'pick':
        // (the two of them on show; going on by itself, one's kept)
        if (this.pick) {
          this.pick.t += rdt;
          if (this.running && this.pick.t > PICK_T) this._keep(this.pick.pref);
        }
        break;
      case 'part': {
        this._lift(rdt);
        const d = this._guide(cb, dt);
        if (!this.part && d) this._to('settle');
        break;
      }
      case 'settle': {
        const d = this._guide(cb, dt);
        if (!d) break;
        this._still = d.d < 0.2 * this.s && d.sp < 0.35 && d.low ? this._still + rdt : 0;
        if (this._still > 0.35 || (this.t > 5 && d.sp < 0.6)) this._to(this.running ? 'feed' : '');
        break;
      }
      case '':
      case 'view':
        this._guide(cb, dt);
        break;
    }
    if (this.running && this.phase !== 'pick') app.orbitGoal.theta += 0.05 * rdt;
    this._dish(rdt);
    this._frame(rdt);
  }

  // ---------------------------------------------------------------- the cycle

  // (feeding begun: Cubiplication on it - whole first: re-cubed if it's not)
  _begin(dt) {
    const app = this.app, cb = this.cube;
    if (!cb || app.healer.active || app.swapper.active) return false;
    if ((this._busyT -= dt) > 0) return false;
    if (!app._whole(cb.slot)) {
      app.heal?.();
      this._busyT = 0.5;
      return false;
    }
    if (!app.cubiplication.start(cb.slot)) {
      this._busyT = 0.5;
      return false;
    }
    this.drip = 0;
    return true;
  }

  // (the ladle over it, tipped, bobbing - a blob of jelly from it every so often)
  _pour(dt, cb) {
    const app = this.app, C = this._box(cb.slot);
    if (!C) return;
    const L = this.ladle, t = this.t;
    L.visible = true;
    L.position.set(C.cx + 0.12, C.top + 0.24 + 0.02 * Math.sin(t * 7), C.cz);
    L.rotation.set(0, 0, 0.95 + 0.12 * Math.sin(t * 9));
    this.lip.set(C.cx, C.top + 0.13, C.cz);
    this.drip -= dt;
    const hex = flavorMainHex(resolveFlavor(cb.style));
    for (let k = 0; k < 3 && this.drip <= 0; k++) {
      this.drip += DRIP;
      const p = this.lip.clone();
      p.x += (Math.random() - 0.5) * 0.05;
      p.z += (Math.random() - 0.5) * 0.05;
      p.y += k * 0.04;
      app.droplets.spawn(p, new THREE.Vector3((Math.random() - 0.5) * 0.3, -1.4, (Math.random() - 0.5) * 0.3), 0.032 + Math.random() * 0.014, hex);
      const d = app.droplets.items[app.droplets.items.length - 1];
      if (d) this.blobs.push(d);
    }
    this.drip = Math.max(this.drip, -DRIP);
  }

  // (blobs on their way: in its top, fed to it - missed, or it's dividing, gone)
  _feedBlobs() {
    if (!this.blobs.length) return;
    const app = this.app, C = app.cubiplication, cb = this.cube, box = cb ? this._box(cb.slot) : null;
    for (let k = this.blobs.length - 1; k >= 0; k--) {
      const d = this.blobs[k], i = app.droplets.items.indexOf(d);
      if (i < 0 || !box) {
        this.blobs.splice(k, 1);
        continue;
      }
      const p = d.p;
      if (p.y <= box.top + d.r * 0.4 && p.x > box.x0 && p.x < box.x1 && p.z > box.z0 && p.z < box.z1) {
        app.droplets.items.splice(i, 1);
        this.blobs.splice(k, 1);
        C.feed(BLOB, p);
      } else if (d.t > 2) this.blobs.splice(k, 1);
    }
  }

  // The neck snapped: the two of them - into the tree, on show, slowed
  _born(a, b, ca, cb) {
    const app = this.app;
    // (left to itself, the one kept: the stranger of the two - its biggest change, then how many - else either)
    const score = (ch) => topTier(ch) * 10 + ch.filter((x) => x.tier > TIER.DRIFT).length;
    const sa = score(ca), sc = score(cb), pref = sa === sc ? (Math.random() < 0.5 ? 0 : 1) : sa > sc ? 0 : 1;
    const kids = [a, b], changes = [ca, cb].map((ch) => ch.map(({ tier, label, color }) => ({ tier, label, ...(color ? { color } : {}) })));
    const born = kids.map((k) => this._capture(k));
    // (the card's two in the order they're seen, left to right)
    const sx = kids.map((k) => {
      const b = this._box(k.slot);
      return b ? new THREE.Vector3(b.cx, b.cy, b.cz).project(app.camera).x : 0;
    });
    this.pick = { kids, changes, born, t: 0, pref, order: sx[0] <= sx[1] ? [0, 1] : [1, 0] };
    kids.forEach((k, i) => {
      const lin = linOf(k);
      this.nodes.set(lin.id, { id: lin.id, parent: lin.parent, gen: lin.gen, name: k.name, c: born[i], changes: changes[i], kept: false, kids: [] });
      this.nodes.get(lin.parent)?.kids.push(lin.id);
    });
    app.slowGoal = SLOW;
    this.slowT = SLOW_FOR;
    this.flare = 1;
    this.waveT = 0;
    this.push = 0;
    this._to('pick');
    this.onBirth?.(this.pick);
  }

  // (one of the two kept - the line a generation on; the other lifting away: now, gone at once)
  _keep(i, now = false) {
    const P = this.pick;
    if (!P) return;
    const app = this.app, kept = P.kids[i], other = P.kids[1 - i];
    this.pick = null;
    this.lastKept = i;
    if (app.cubes.includes(kept)) {
      this.cube = kept;
      if (app.cube !== kept) app.selectCube(kept.slot);
    }
    const lin = linOf(kept), node = this.nodes.get(lin.id);
    if (node) node.kept = true;
    this.gens.push({ id: lin.id, parent: lin.parent, gen: lin.gen, name: kept.name, c: P.born[i], changes: P.changes[i], twin: { id: other.lin?.id, name: other.name, c: P.born[1 - i], changes: P.changes[1 - i] } });
    this.view = this.gens.length - 1;
    this.flare = Math.max(this.flare, 0.6);
    app.audio?.ui?.();
    if (app.cubes.includes(other)) {
      this.part = { cb: other, t: 0, spin: Math.random() < 0.5 ? -1 : 1 };
      app.sb.cGrav[other.slot] = 0;
      app.audio?.whoosh?.(0.25);
      if (now) this._poof();
    }
    this._to('part');
  }

  // (the other lifting up out of the dish, turning, glowing - then gone)
  _lift(dt) {
    const P = this.part;
    if (!P) return;
    const app = this.app, sb = app.sb, k = P.cb.slot;
    if (!app.cubes.includes(P.cb)) return void (this.part = null);
    P.t += dt;
    const box = this._box(k), up = 0.4 + 2.2 * smooth(P.t / LIFT_T);
    for (let i = 0; i < sb.nV; i++) {
      if (sb.vCube[i] !== k) continue;
      const o = i * 3;
      // (up, a slow turn about its middle, drifting outward)
      const rx = box ? sb.x[o] - box.cx : 0, rz = box ? sb.x[o + 2] - box.cz : 0;
      sb.v[o] += (-rz * 1.2 * P.spin + (box?.cx ?? 0) * 0.3 - sb.v[o]) * Math.min(1, dt * 6);
      sb.v[o + 1] += (up - sb.v[o + 1]) * Math.min(1, dt * 6);
      sb.v[o + 2] += (rx * 1.2 * P.spin + (box?.cz ?? 0) * 0.3 - sb.v[o + 2]) * Math.min(1, dt * 6);
      sb.glow[i] = Math.max(sb.glow[i], 0.25 + 0.5 * smooth(P.t / LIFT_T));
    }
    sb.wakeAll();
    if (P.t > LIFT_T) this._poof();
  }

  // (gone: a puff of light and glitter in its colours)
  _poof() {
    const P = this.part;
    this.part = null;
    if (!P) return;
    const app = this.app, sb = app.sb, cb = P.cb;
    if (!app.cubes.includes(cb)) return;
    const box = this._box(cb.slot), at = box ? new THREE.Vector3(box.cx, box.cy, box.cz) : new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color(flavorMainHex(resolveFlavor(cb.style)));
    app.particles?.flash(at, 0.8 * this.s, [col.r * 2.6, col.g * 2.6, col.b * 2.6]);
    for (let k = 0; k < 28; k++) app.particles?.glitter(at, 1, [0.6 + col.r * 0.4, 0.6 + col.g * 0.4, 0.6 + col.b * 0.4], 1.5);
    app.audio?.pop?.(0.6);
    sb.cGrav[cb.slot] = 1;
    app.removeCube(cb.slot);
  }

  // (drawn back to the middle of the dish: far off it and down on the floor, a hop there; near, a gentle spring on how
  // it moves - its middle, how fast it's going, whether it's down; or null. The spring alone, against the floor's grip,
  // left it a third of a metre off in four seconds)
  _guide(cb, dt) {
    const sb = this.app.sb, s = this.s;
    if (!cb) return null;
    const k = cb.slot;
    let cx = 0, cz = 0, vx = 0, vy = 0, vz = 0, n = 0, bot = Infinity;
    for (let i = 0; i < sb.nV; i++) {
      if (sb.vCube[i] !== k) continue;
      const o = i * 3;
      cx += sb.x[o];
      cz += sb.x[o + 2];
      vx += sb.v[o];
      vy += sb.v[o + 1];
      vz += sb.v[o + 2];
      if (sb.x[o + 1] < bot) bot = sb.x[o + 1];
      n++;
    }
    if (!n) return null;
    (cx /= n), (cz /= n), (vx /= n), (vy /= n), (vz /= n);
    const d = Math.hypot(cx, cz), sp = Math.hypot(vx, vz), low = bot < 0.04 * s && Math.abs(vy) < 0.4;
    this._hopT -= dt;
    if (d > 0.2 * s && low && sp < 0.5 && this._hopT <= 0) {
      // (a hop: up and over to the middle, as one - landing there)
      const T = 0.42, g = Math.abs(sb.p.gravity * sb.gravityScale * (sb.cGrav[k] ?? 1)), up = 0.5 * g * T, ax = (-0.95 * cx) / T, az = (-0.95 * cz) / T;
      for (let i = 0; i < sb.nV; i++) {
        if (sb.vCube[i] !== k) continue;
        sb.v[i * 3] = ax;
        sb.v[i * 3 + 1] = up;
        sb.v[i * 3 + 2] = az;
      }
      sb.wakeAll();
      this._hopT = T + 0.55;
      this.app.audio?.squish?.(0.45, 1.4);
    } else if (d > 0.03 * s && low) {
      const w = 2.4, lim = 3;
      let ax = -w * w * cx - 2 * w * vx, az = -w * w * cz - 2 * w * vz;
      const al = Math.hypot(ax, az);
      if (al > lim) (ax *= lim / al), (az *= lim / al);
      for (let i = 0; i < sb.nV; i++) {
        if (sb.vCube[i] !== k) continue;
        sb.v[i * 3] += ax * dt;
        sb.v[i * 3 + 2] += az * dt;
      }
      if (al * dt > 1e-4) sb.wakeAll();
    }
    return { d, sp, cx, cz, low };
  }

  // (a generation's look eased into: its blend, a frame at a time - then as applyStyle has it)
  _tween(dt) {
    const T = this.tw, app = this.app, cb = this.cube;
    if (!T) return;
    if (!cb || !app.cubes.includes(cb)) return void (this.tw = null);
    T.t += dt;
    const w = smooth(T.t / TWEEN_T), B = blendLook(T.from, T.to, w);
    app.jelly.setCubeLook(cb.slot, B.f, B.o, app.sb.cSize[cb.slot]);
    if (w >= 1) {
      this.tw = null;
      app.applyStyle();
    }
  }

  // ---------------------------------------------------------------- the show

  // (the dish lit with it: its ring brighter as it's fed, beating faster, full on as it divides, flaring at a snap and
  // a keep; its agar glowing from under it; a ring sent out across it at the snap)
  _dish(dt) {
    if (!this.model) return;
    const halo = this.model.getObjectByName('halo'), glow = this.model.getObjectByName('glow'), wave = this.model.getObjectByName('wave');
    this.flare *= Math.exp(-dt * 2.2);
    const p = this.progress, u = this.dividing, beat = 0.5 + 0.5 * Math.sin(this.t * (3 + 6 * p));
    if (halo) halo.material.opacity = Math.min(1, 0.2 + 0.35 * p * (0.6 + 0.4 * beat) + 0.3 * u + 0.5 * this.flare);
    if (glow) glow.material.opacity = Math.min(1, 0.45 * p + 0.35 * u + 0.6 * this.flare);
    if (wave) {
      if (this.waveT >= 0) {
        const w = (this.waveT += dt) / 1.1, r = this.R * (0.12 + 0.88 * (1 - (1 - Math.min(1, w)) ** 3));
        wave.visible = w < 1;
        wave.scale.set(r, r, 1);
        wave.material.opacity = 0.85 * (1 - Math.min(1, w)) ** 1.5;
        if (w >= 1) this.waveT = -1;
      } else wave.visible = false;
    }
  }

  // (the view: across the dish from above it, eased in on it as it divides, out for the two of them; on it, where it
  // is - and turning slowly round it, going on by itself)
  _frame(dt) {
    const app = this.app, cam = app.camera, s = this.s, u = this.dividing;
    const vf = THREE.MathUtils.degToRad(app._fovBase || cam.fov), tv = Math.tan(vf / 2), th = tv * (cam.aspect || 1);
    this.push += ((this.phase === 'divide' ? smooth(u) : 0) - this.push) * (1 - Math.exp(-dt * 4));
    // (the dish across - or, a wide screen, as high as it's seen from up here, and a cube over it)
    const across = (0.5 * (2 * this.R + 0.3 * s)) / th, high = (0.5 * (0.9 * this.R + 1.8 * s)) / tv;
    app.orbitGoal.radius = Math.max(3.4 * s, across, high) * (1 - 0.18 * this.push);
    const box = this.cube && this.phase !== 'pick' ? this._box(this.cube.slot) : null, k = 1 - Math.exp(-dt * 2.5);
    this.frameX += ((box ? box.cx * 0.6 : 0) - this.frameX) * k;
    this.frameZ += ((box ? box.cz * 0.6 : 0) - this.frameZ) * k;
    this.frameY += ((box ? Math.max(0.45 * s, box.cy) : 0.5 * s) - this.frameY) * k;
  }

  // ---------------------------------------------------------------- helpers

  _to(phase) {
    this.phase = phase;
    this.t = 0;
    this._still = 0;
    this._changed();
  }

  _changed() {
    this.onChange?.(this.phase);
  }

  // (a cube as captureCube has it - any cube, not just the one the panels are on)
  _capture(cb) {
    const app = this.app, s0 = app.style, t0 = app.tune;
    app.style = cb.style;
    app.tune = cb.tune;
    try {
      return captureCube(app, cb.name || '');
    } finally {
      app.style = s0;
      app.tune = t0;
    }
  }

  // (a generation: the cube as it is, what it was born with - and its twin)
  _gen(cb, changes, twin) {
    const lin = linOf(cb);
    return { id: lin.id, parent: lin.parent, gen: lin.gen | 0, name: cb.name || '', c: this._capture(cb), changes, twin };
  }

  // (a generation's twin, as the tree has it: the other child of its parent)
  _twinOf(parent, q) {
    const id = parent.kids.find((x) => x !== q.id), t = id ? this.nodes.get(id) : null;
    return t ? { id: t.id, name: t.name, c: t.c, changes: t.changes } : null;
  }

  // (cube k now: its middle, its top, its footprint)
  _box(k) {
    const sb = this.app.sb;
    let cx = 0, cy = 0, cz = 0, n = 0, top = -Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < sb.nV; i++) {
      if (sb.vCube[i] !== k || !sb.alive[i]) continue;
      const o = i * 3, x = sb.x[o], y = sb.x[o + 1], z = sb.x[o + 2];
      cx += x;
      cy += y;
      cz += z;
      n++;
      if (y > top) top = y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    return n ? { cx: cx / n, cy: cy / n, cz: cz / n, top, x0, x1, z0, z1 } : null;
  }
}
