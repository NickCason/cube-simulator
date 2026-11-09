// Twist: a Rubik's cube, played. Drag across a face and the row your finger's
// on turns a quarter the way you dragged - its stickers going round (the
// jelly's colours: see CUBE_GLSL's rubikAt; the turn's maths: styles.js
// rubikTurn) - the outer rows and the middle ones. Hold still on it a moment
// and it scrambles itself, a blur of turns. Solved: a fanfare, and how many
// turns and how long it took. On a cube that isn't a Rubik's: a hint.

import * as THREE from 'three';
import { REST_STEP } from '../sim/softbody.js';
import { RUBIK_COLORS, rubikStateOf, rubikTurn, rubikSolved } from '../styles.js';
import { frameOf } from './cubey.js';

const TURN_T = 0.2; // (s) a quarter turn
const QUICK_T = 0.07; // (s) one of a scramble's
const DRAG = 12; // (px) dragged this far, it's a turn
const HOLD = 0.75; // (s) held this long without dragging, it scrambles
const SCRAMBLE = 22; // (turns)
const ease = (u) => u * u * (3 - 2 * u);

export class TwistTool {
  constructor(app) {
    this.app = app;
    this.id = 'twist';
    this.cursor = 'grab';
    this.press = null; // { slot, piece, c (its little cube), fa (its face's axis), fs (its side), x, y, t }
    this.turn = null; // { slot, a, at, dir, t, T }
    this.queue = [];
    this.background = true; // (a turn going on finishes after a change of tool)
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
  }

  deactivate() {
    this.press = null;
  }

  _cube(slot) {
    return this.app.cubes.find((c) => c.slot === slot);
  }

  down(e, ray, hit) {
    if (!hit) return false;
    const app = this.app, sb = app.sb, slot = sb.pieces[hit.piece]?.cube ?? 0, cb = this._cube(slot);
    if (!cb || cb.style.flavor !== 'rubik') {
      app.ui?.hint("Twisting's for a Rubik's cube - give it the Rubik flavour", 2000);
      return true;
    }
    // where it was touched, on the cube at rest (its middle at 0): the little
    // cube it's on, and which face
    const p = hit.point, r = sb.locate(p[0] - hit.normal[0] * 0.003, p[1] - hit.normal[1] * 0.003, p[2] - hit.normal[2] * 0.003, hit.piece);
    if (!r) return true;
    const b = r.bary.map((v) => Math.max(0, v)), bs = b[0] + b[1] + b[2] + b[3] || 1;
    const q = sb._restPoint(r.tet, b.map((v) => v / bs));
    q[0] -= slot * REST_STEP;
    const third = sb.cSize[slot] / 3;
    const c = q.map((v) => Math.max(-1, Math.min(1, Math.round(v / third))));
    const a = q.map(Math.abs), fa = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
    this.press = { slot, piece: hit.piece, c, fa, fs: Math.sign(q[fa]) || 1, x: e.clientX, y: e.clientY, t: performance.now() };
    app.audio?.ui?.();
    return true;
  }

  move(e) {
    const P = this.press;
    if (!P) return;
    const dx = e.clientX - P.x, dy = e.clientY - P.y;
    if (Math.hypot(dx, dy) < DRAG) return;
    this.press = null;
    const app = this.app, sb = app.sb, cam = app.camera;
    // its axes in the world, and which of the face's two the drag runs along
    // (as each looks on screen from where it was touched)
    const verts = [];
    for (const pc of sb.pieces) if (pc.cube === P.slot) for (const i of pc.verts) verts.push(i);
    const F = frameOf(sb, verts), h = sb.pieces[P.piece]?.com || [0, 0, 0];
    const at = this._v.set(h[0], h[1], h[2]).project(cam), sx = at.x, sy = at.y;
    let best = -1, bs = 0, sgn = 1;
    for (let u = 0; u < 3; u++) {
      if (u === P.fa) continue;
      const s = this._w.set(h[0], h[1], h[2]).addScaledVector(F.ax[u], 0.2).project(cam);
      // (on screen: y down; the projection's y up)
      const ux = s.x - sx, uy = -(s.y - sy), l = Math.hypot(ux, uy) || 1;
      const d = (dx * ux + dy * uy) / (l * Math.hypot(dx, dy));
      if (Math.abs(d) > bs) {
        bs = Math.abs(d);
        best = u;
        sgn = Math.sign(d) || 1;
      }
    }
    if (best < 0) return;
    // turned about the face's other way, the row the touch was in: whichever
    // way round moves the touched sticker the way it was dragged
    const A = 3 - P.fa - best, c = P.c.slice();
    c[P.fa] = P.fs;
    const moved = A === 0 ? [c[0], -c[2], c[1]] : A === 1 ? [c[2], c[1], -c[0]] : [-c[1], c[0], c[2]];
    const dir = (moved[best] - c[best]) * sgn > 0 ? 1 : -1;
    this._start(P.slot, A, P.c[A], dir, TURN_T);
  }

  up() {
    this.press = null;
  }

  _start(slot, a, at, dir, T) {
    if (this.turn) {
      this.queue.push({ slot, a, at, dir, T });
      return;
    }
    const cb = this._cube(slot);
    if (!cb) return;
    this.turn = { slot, a, at, dir, t: 0, T };
    const app = this.app;
    if (!cb.rubikT0) cb.rubikT0 = performance.now();
    app.audio?.diceShink?.(Math.floor(Math.random() * 5), 0);
    // (the jelly feels it: a little twist of a wobble)
    const sb = app.sb, k = sb.pieces.findIndex((p) => p.cube === slot);
    if (k >= 0) {
      const cm = sb.pieces[k].com;
      sb.impulse(cm[0], cm[1] + 0.3, cm[2], 0, -1, 0, sb.cSize[slot], T < 0.1 ? 0.15 : 0.45, k);
    }
  }

  update(dt, rdt) {
    const P = this.press, app = this.app;
    // held still on it a while: a scramble
    if (P && performance.now() - P.t > HOLD * 1000) {
      this.press = null;
      this._scramble(P.slot);
    }
    const T = this.turn, U = app.jelly.frontMat.uniforms.uTwist;
    if (!T) {
      if (U && U.value.z !== 0) U.value.set(0, 0, 0, 0);
      return;
    }
    T.t += rdt || dt;
    const u = Math.min(1, T.t / T.T);
    U?.value.set(T.a, T.at, T.dir * (Math.PI / 2) * ease(u), T.slot);
    if (u < 1) return;
    // done: the stickers where they've gone, drawn as they are (no turn now)
    this.turn = null;
    U?.value.set(0, 0, 0, 0);
    const cb = this._cube(T.slot);
    if (cb) {
      const st = rubikTurn(rubikStateOf(cb.style), T.a, T.at, T.dir);
      cb.style.rubikState = st.join('');
      cb.rubikMoves = (cb.rubikMoves || 0) + (cb.scrambling ? 0 : 1);
      app.applyStyle();
      if (!this.queue.length && cb.scrambling) {
        cb.scrambling = false;
        cb.rubikMoves = 0;
        cb.rubikT0 = 0;
        app.ui?.hint('Scrambled - drag across a face to turn it', 2000);
      } else if (!cb.scrambling && rubikSolved(st) && cb.rubikMoves > 0) this._solved(cb);
    }
    const n = this.queue.shift();
    if (n) this._start(n.slot, n.a, n.at, n.dir, n.T);
  }

  // a blur of turns, none undoing the last
  _scramble(slot) {
    const cb = this._cube(slot);
    if (!cb || this.turn) return;
    cb.scrambling = true;
    let last = -1;
    for (let k = 0; k < SCRAMBLE; k++) {
      let a;
      do a = Math.floor(Math.random() * 3);
      while (a === last);
      last = a;
      this._start(slot, a, Math.floor(Math.random() * 3) - 1, Math.random() < 0.5 ? -1 : 1, QUICK_T);
    }
    this.app.audio?.whoosh?.(0.6);
  }

  _solved(cb) {
    const app = this.app, sb = app.sb, s = Math.round((performance.now() - (cb.rubikT0 || performance.now())) / 1000);
    const k = sb.pieces.findIndex((p) => p.cube === cb.slot), cm = k >= 0 ? sb.pieces[k].com : [0, 0.5, 0];
    const at = new THREE.Vector3(cm[0], cm[1], cm[2]);
    app.audio?.fanfare?.(3);
    app.flash = Math.max(app.flash || 0, 0.3);
    for (let n = 0; n < 6; n++) {
      const h = parseInt(RUBIK_COLORS[n].slice(1), 16);
      app.particles?.glitter?.(at, 8, [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255], 1.5);
    }
    if (k >= 0) sb.impulse(cm[0], cm[1] - 0.4, cm[2], 0, 1, 0, sb.cSize[cb.slot] * 1.2, 2.2, k);
    app.ui?.hint(`Solved! ${cb.rubikMoves} turn${cb.rubikMoves === 1 ? '' : 's'}${s ? ` · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : ''}`, 4000);
    app.tally?.('solved');
    cb.rubikMoves = 0;
    cb.rubikT0 = 0;
  }
}
