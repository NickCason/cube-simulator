// Googly eyes: stick them on. Over a cube, the eye (or the pair: mirrored
// across the face, pushed apart if you're on its middle line) shows where
// it'll go; press, slide it where you want, let go and it's on - not on a
// cut face (only the outside), not over another eye. Drag one that's on to
// move it (its pair moves with it, mirrored); drag it off the cube and it
// peels off - held up under your finger: let go in the air and it falls,
// over another cube and it goes on that one (on its own; somewhere it can't
// go, it goes back), back over its own and it's back on. Tap one to pick it (ringed): the look, size and pairing
// below are then its (and its pair's: pairing off splits them, on gives a
// single one a twin); the wheel over one sizes it; Delete takes it off;
// Escape, or a tap off the cubes, lets it go. Undo, and Clear (the cube's).
// They're the cube's own: saved with it, in its code, its children's (see
// eyes.js).

import { REST_STEP, TAG_FRESH } from '../sim/softbody.js';
import { EYE_STYLES, EYE_SIZES, EYE_R_MIN, EYE_R_MAX, MAX_EYES, onSurface, mirrorEye, spread, copyEyes } from '../eyes.js';

const SAY = { cut: 'Eyes only go on the outside', glob: 'Not on a glob', full: `${MAX_EYES} eyes is plenty`, overlap: 'There’s an eye there' };

const store = (k, v) => {
  try {
    localStorage.setItem(k, String(v));
  } catch (e) {}
};
const stored = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v;
  } catch (e) {
    return d;
  }
};

export class EyesTool {
  constructor(app) {
    this.app = app;
    this.id = 'eyes';
    this.cursor = 'crosshair';
    this.style = Math.min(EYE_STYLES.length - 1, Math.max(0, +stored('cube-sim-eye-style', 0) || 0));
    this.size = Math.min(2, Math.max(0, +stored('cube-sim-eye-size', 1) || 0));
    this.pair = stored('cube-sim-eye-pair', '1') !== '0';
    this.undoStack = []; // [[{ slot, eyes }]] (the cubes' eyes before each change)
    this.drag = null;
    this.sel = null; // { slot, eyes: [the picked eye, its pair] }
    this._key = (e) => this._onKey(e);
  }

  activate() {
    window.addEventListener('keydown', this._key);
    const p = this._picked();
    this._select(p ? { slot: p.cb.slot, eyes: p.eyes } : null);
  }

  deactivate() {
    window.removeEventListener('keydown', this._key);
    const eyes = this.app.eyes;
    eyes.setGhosts([]);
    eyes.setPicked([]);
    // (one mid-peel: back on)
    if (this.drag?.kind === 'move' && this.drag.off) this._restore(this.drag);
    eyes.hold(null);
    this.drag = null;
  }

  opts() {
    return { style: this.style, size: this.size, pair: this.pair, undo: this.undoStack.length > 0, picked: this._picked()?.eyes.length || 0 };
  }

  // ------------------------------------------------------------ where it'd go
  // A line of sight onto a cube: which cube, and the eye(s) it'd put there -
  // { k, cb, b (its rounding), eyes: [e, its pair], ok, why } - or null (no
  // cube there). r, s: the eye's size and kind; pair: a pair; skip: eyes
  // already on it not to count (being moved).
  _where(ray, { hit = null, r = EYE_SIZES[this.size], s = this.style, pair = this.pair, skip = [] } = {}) {
    const app = this.app, sb = app.sb;
    hit = hit || app.pickJelly(ray);
    if (!hit) return null;
    const f = hit.face, k = sb.tCube[hit.tet];
    const cb = app.cubes.find((c) => c.slot === k);
    if (!cb) return null;
    const b = this._bevel(k);
    // (its rest place: where on the cube, as it was made)
    const X = sb.X, T = sb.sTri, w = hit.bary;
    const rp = [0, 0, 0];
    for (let i = 0; i < 3; i++) for (let c = 0; c < 3; c++) rp[c] += X[T[f * 3 + i] * 3 + c] * w[i];
    rp[0] -= k * REST_STEP;
    const local = rp.map((v) => v / (sb.cSize[k] || 1));
    let e = { ...onSurface(local, b).p.reduce((o, v, i) => ((o['xyz'[i]] = v), o), {}), r, s, p: 0 };
    let why = '';
    // (only on the outside: not a cut face, not a glob of the gel gun's)
    if (sb.sTag[f] === TAG_FRESH) why = 'cut';
    for (let i = 0; i < 3 && !why; i++) if (sb.vTag[T[f * 3 + i]]) why = 'glob';
    const eyes = [e];
    if (pair) {
      // (a pair: the other mirrored across the face - on the middle line, the
      // two pushed apart)
      e = spread(e, b, r * 1.3);
      eyes[0] = e;
      eyes.push(mirrorEye(e, b));
    }
    const have = (cb.style.eyes || []).filter((x) => !skip.includes(x));
    if (!why && have.length + eyes.length > MAX_EYES) why = 'full';
    if (!why && this._clash(have, eyes)) why = 'overlap';
    return { k, cb, b, eyes, ok: !why, why };
  }

  _bevel(k) {
    const sb = this.app.sb;
    return Math.min(0.45, (sb.cBevel[k] || 0) / (sb.cSize[k] || 1));
  }

  // (any of these over any of those)
  _clash(have, eyes) {
    return eyes.some((x) => have.some((h) => Math.hypot(h.x - x.x, h.y - x.y, h.z - x.z) < (h.r + x.r) * 1.02));
  }

  // the other of a pair (same number, same cube), if it has one
  _partner(cb, e) {
    return e.p ? (cb.style.eyes || []).find((x) => x !== e && x.p === e.p) || null : null;
  }

  // (a pair number not in use on the cube)
  _freePair(cb) {
    const used = new Set((cb.style.eyes || []).map((x) => x.p));
    for (let p = 1; p <= 15; p++) if (!used.has(p)) return p;
    return 0;
  }

  // (the cubes' eyes as they are, to undo back to)
  _snapshot(...cbs) {
    this.undoStack.push(cbs.map((cb) => ({ slot: cb.slot, eyes: copyEyes(cb.style.eyes) })));
    if (this.undoStack.length > 40) this.undoStack.shift();
  }

  // (the cubes' eyes changed: kept, and the look's saved with them)
  _commit() {
    this.app.applyStyle();
    this.app.ui?.setEyeOpts?.(this.opts());
  }

  // (these picked - ringed, the row theirs - or none)
  _select(sel) {
    this.sel = sel && sel.eyes.length ? sel : null;
    this.app.eyes.setPicked(this.sel ? this.sel.eyes : []);
    if (this.sel) {
      const e = this.sel.eyes[0];
      this.style = e.s;
      this.size = EYE_SIZES.reduce((bi, v, i) => (Math.abs(v - e.r) < Math.abs(EYE_SIZES[bi] - e.r) ? i : bi), 0);
      this.pair = this.sel.eyes.length > 1;
    }
    this.app.ui?.setEyeOpts?.(this.opts());
  }

  // (the picked one(s), if they're still on)
  _picked() {
    const s = this.sel, cb = s && this.app.cubes.find((c) => c.slot === s.slot);
    if (!cb) return null;
    const eyes = s.eyes.filter((x) => (cb.style.eyes || []).includes(x));
    return eyes.length ? { cb, eyes } : null;
  }

  // ------------------------------------------------------------ the pointer
  hover(e, ray) {
    if (this.drag) return;
    if (!ray) return this.app.eyes.setGhosts([]);
    // (over an eye that's on: it can be moved)
    if (this.app.eyes.pick(ray)) {
      this.app.setCursor('grab');
      return this.app.eyes.setGhosts([]);
    }
    this.app.setCursor('crosshair');
    const w = this._where(ray);
    this.app.eyes.setGhosts(w ? w.eyes.map((x) => ({ k: w.k, e: x, ok: w.ok })) : []);
  }

  down(e, ray, hit) {
    const app = this.app;
    if (app.healer.active) return false;
    const pk = app.eyes.pick(ray);
    if (pk && (!hit || pk.t <= hit.t + 0.08)) {
      // an eye that's on: picked, and dragged if it's moved
      const cb = pk.L.cb, eye = pk.L.e, mate = this._partner(cb, eye);
      this._select({ slot: cb.slot, eyes: mate ? [eye, mate] : [eye] });
      this.drag = {
        kind: 'move', cb, eye, mate, x0: e.clientX, y0: e.clientY, moved: false, off: false, over: null, bad: '',
        snap: copyEyes(cb.style.eyes), eye0: { x: eye.x, y: eye.y, z: eye.z }, mate0: mate && { x: mate.x, y: mate.y, z: mate.z },
      };
      app.eyes.setGhosts([]);
      app.setCursor('grabbing');
      return true;
    }
    const w = this._where(ray, { hit });
    if (!w) {
      // (off the cubes: the camera's - and the picked ones let go)
      if (this.sel) this._select(null);
      return false;
    }
    this.drag = { kind: 'place', w };
    app.eyes.setGhosts(w.eyes.map((x) => ({ k: w.k, e: x, ok: w.ok })));
    return true;
  }

  move(e, ray) {
    const d = this.drag, app = this.app;
    if (!d) return;
    if (d.kind === 'place') {
      // (the eye where it'll go, following along - on that cube)
      const w = ray && this._where(ray);
      if (w && w.k === d.w.k) d.w = w;
      else d.w = { ...d.w, ok: false, why: 'off' };
      app.eyes.setGhosts(d.w.eyes.map((x) => ({ k: d.w.k, e: x, ok: d.w.ok })));
      return;
    }
    // moving one that's on
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
    d.moved = true;
    const skip = [d.eye, d.mate].filter(Boolean);
    const w = ray && this._where(ray, { r: d.eye.r, s: d.eye.s, pair: false, skip });
    if (w && w.k === d.cb.slot) {
      // on its own cube: there (its pair mirrored to match, pushed apart on
      // the middle line) - unless that's a cut face, a glob or another eye
      if (d.off) this._putBack(d);
      d.over = null;
      let at = w.eyes[0];
      if (d.mate) at = spread(at, w.b, d.eye.r * 1.3);
      const m = d.mate && mirrorEye(at, w.b);
      const why = w.why === 'cut' || w.why === 'glob' ? w.why : this._clash((d.cb.style.eyes || []).filter((x) => !skip.includes(x)), m ? [at, m] : [at]) ? 'overlap' : '';
      d.bad = why;
      if (why) return app.eyes.setGhosts([{ k: w.k, e: { ...at, r: d.eye.r, s: d.eye.s }, ok: false }]);
      app.eyes.setGhosts([]);
      Object.assign(d.eye, { x: at.x, y: at.y, z: at.z });
      if (m) Object.assign(d.mate, { x: m.x, y: m.y, z: m.z });
      return;
    }
    // off it: peeled off - its pair back where it was (only this one's coming
    // off), and it held up in the air (over another cube: where it'd go on that)
    if (!d.off) {
      d.off = true;
      if (d.mate) Object.assign(d.mate, d.mate0);
      app.ui?.hint('Let go to take it off', 1100);
    }
    d.bad = '';
    d.over = w;
    app.eyes.hold(d.eye, ray, !w);
    app.eyes.setGhosts(w ? [{ k: w.k, e: { ...w.eyes[0], r: d.eye.r, s: d.eye.s }, ok: w.ok }] : []);
  }

  // (a peeled one back on its own cube: its pair following it again)
  _putBack(d) {
    d.off = false;
    this.app.eyes.hold(null);
    if (d.mate) {
      const m = mirrorEye(d.eye, this._bevel(d.cb.slot));
      Object.assign(d.mate, { x: m.x, y: m.y, z: m.z });
    }
  }

  // (one mid-move put back where it was, and its pair)
  _restore(d) {
    Object.assign(d.eye, d.eye0);
    if (d.mate) Object.assign(d.mate, d.mate0);
  }

  up(e, ray) {
    const d = this.drag, app = this.app;
    this.drag = null;
    app.setCursor('crosshair');
    if (!d) return;
    app.eyes.setGhosts([]);
    // (called off - a second finger down to pinch, the tool put away: nothing
    // placed, a moving one back where it was)
    if (!e || e.type === 'pointerdown' || e.type === 'pointercancel') {
      if (d.kind === 'move') {
        app.eyes.hold(null);
        this._restore(d);
      }
      return;
    }
    if (d.kind === 'place') {
      if (!d.w.ok) {
        if (SAY[d.w.why]) app.ui?.hint(SAY[d.w.why], 1300);
        return;
      }
      const cb = d.w.cb;
      this._snapshot(cb);
      const pid = d.w.eyes.length > 1 ? this._freePair(cb) : 0;
      const add = d.w.eyes.map((x) => ({ ...x, p: pid }));
      cb.style.eyes = [...(cb.style.eyes || []), ...add];
      for (const x of add) app.eyes.pop(x);
      app.audio?.eyeStick?.();
      app.tally?.('eyed');
      this._select({ slot: cb.slot, eyes: add });
      this._commit();
      return;
    }
    // moved (or tapped) one that's on
    if (d.off) {
      const to = d.over;
      if (to && to.ok) {
        // over another cube: it goes on that one, on its own
        app.eyes.hold(null);
        this.undoStack.push([{ slot: d.cb.slot, eyes: d.snap }, { slot: to.cb.slot, eyes: copyEyes(to.cb.style.eyes) }]);
        this._take(d.cb, [d.eye], false);
        const moved = { ...to.eyes[0], r: d.eye.r, s: d.eye.s, p: 0 };
        to.cb.style.eyes = [...(to.cb.style.eyes || []), moved];
        app.eyes.pop(moved);
        app.audio?.eyeStick?.();
        this._select({ slot: to.cb.slot, eyes: [moved] });
        this._commit();
        return;
      }
      // over a cube where it can't go: back where it was
      if (to) {
        if (SAY[to.why]) app.ui?.hint(SAY[to.why], 1300);
        app.eyes.hold(null);
        this._restore(d);
        return;
      }
      // in the air: it falls
      app.eyes.letGo();
      this.undoStack.push([{ slot: d.cb.slot, eyes: d.snap }]);
      this._take(d.cb, [d.eye], false);
      this._commit();
      return;
    }
    if (d.bad && SAY[d.bad]) app.ui?.hint(SAY[d.bad], 1300);
    if (d.moved && (d.eye.x !== d.eye0.x || d.eye.y !== d.eye0.y || d.eye.z !== d.eye0.z)) {
      this.undoStack.push([{ slot: d.cb.slot, eyes: d.snap }]);
      if (this.undoStack.length > 40) this.undoStack.shift();
      app.audio?.eyeStick?.(0.6);
      this._commit();
    }
  }

  // (eyes off a cube - falling, if drop - and any pair they leave split up)
  _take(cb, eyes, drop = true) {
    if (drop) for (const x of eyes) this.app.eyes.drop(x);
    const left = (cb.style.eyes || []).filter((x) => !eyes.includes(x));
    for (const x of left) if (x.p && !left.some((y) => y !== x && y.p === x.p)) x.p = 0;
    cb.style.eyes = left;
    const p = this._picked();
    this._select(p ? { slot: p.cb.slot, eyes: p.eyes } : null);
  }

  // The wheel over an eye: its size (and its pair's).
  wheel(e, ray) {
    const pk = ray && this.app.eyes.pick(ray);
    if (!pk) return false;
    const cb = pk.L.cb, eye = pk.L.e, mate = this._partner(cb, eye);
    if (!this._wheeling) this._snapshot(cb);
    clearTimeout(this._wheeling);
    this._wheeling = setTimeout(() => {
      this._wheeling = null;
      this._commit();
    }, 400);
    const r = Math.min(EYE_R_MAX, Math.max(EYE_R_MIN, eye.r * Math.exp(-e.deltaY * 0.0015)));
    for (const x of [eye, mate]) if (x) x.r = r;
    this._select({ slot: cb.slot, eyes: mate ? [eye, mate] : [eye] });
    return true;
  }

  // ------------------------------------------------------------ the row below
  setStyle(i) {
    this.style = i;
    store('cube-sim-eye-style', i);
    const p = this._picked();
    if (p && p.eyes.some((x) => x.s !== i)) {
      this._snapshot(p.cb);
      for (const x of p.eyes) x.s = i;
      this._commit();
    } else this.app.ui?.setEyeOpts?.(this.opts());
  }

  setSize(i) {
    this.size = i;
    store('cube-sim-eye-size', i);
    const p = this._picked();
    if (p) {
      this._snapshot(p.cb);
      for (const x of p.eyes) x.r = EYE_SIZES[i];
      this._commit();
    } else this.app.ui?.setEyeOpts?.(this.opts());
  }

  // Pairs or one at a time - for the ones to come; and, picked, for them: a
  // pair split up (both stay, each on its own), or a single one given a twin
  // across its face.
  setPair(on) {
    this.pair = !!on;
    store('cube-sim-eye-pair', on ? '1' : '0');
    const p = this._picked(), app = this.app;
    if (p && !on && p.eyes.length > 1) {
      this._snapshot(p.cb);
      for (const x of p.eyes) x.p = 0;
      this._select({ slot: p.cb.slot, eyes: [p.eyes[0]] });
      this.pair = false;
      this._commit();
      app.ui?.hint('Split up: each on its own now', 1200);
      return;
    }
    if (p && on && p.eyes.length === 1) {
      const cb = p.cb, e = p.eyes[0], b = this._bevel(cb.slot);
      const at = spread(e, b, e.r * 1.3), m = mirrorEye(at, b);
      const others = (cb.style.eyes || []).filter((x) => x !== e);
      if (others.length + 2 > MAX_EYES || this._clash(others, [at, m])) {
        app.ui?.hint(others.length + 2 > MAX_EYES ? SAY.full : 'No room for its twin', 1300);
        this._select({ slot: cb.slot, eyes: [e] });
        return;
      }
      this._snapshot(cb);
      const pid = this._freePair(cb);
      Object.assign(e, { x: at.x, y: at.y, z: at.z, p: pid });
      const twin = { ...m, p: pid };
      cb.style.eyes = [...cb.style.eyes, twin];
      app.eyes.pop(twin);
      app.audio?.eyeStick?.();
      this._select({ slot: cb.slot, eyes: [e, twin] });
      this._commit();
      return;
    }
    app.ui?.setEyeOpts?.(this.opts());
  }

  undo() {
    const u = this.undoStack.pop();
    if (!u) return;
    for (const { slot, eyes } of u) {
      const cb = this.app.cubes.find((c) => c.slot === slot);
      if (cb) cb.style.eyes = eyes;
    }
    this._select(null);
    this._commit();
  }

  // all the cube's eyes off (the one the panels edit)
  clear() {
    const cb = this.app.cube;
    if (!cb || !(cb.style.eyes || []).length) return;
    this._snapshot(cb);
    this._take(cb, [...cb.style.eyes]);
    this.app.audio?.eyePeel?.();
    this._commit();
  }

  _onKey(e) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const p = this._picked();
      if (!p) return;
      e.preventDefault();
      this._snapshot(p.cb);
      this._take(p.cb, p.eyes);
      this.app.audio?.eyePeel?.();
      this._commit();
    } else if (e.key === 'Escape') {
      if (this.sel) this._select(null);
    } else if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      this.undo();
    }
  }

  update() {}
}
