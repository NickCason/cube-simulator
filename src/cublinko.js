// Cublinko - an exhibition mode: Plinko, with your cubes. A tall board stood up in the room - a backboard, a glass
// front, pegs in staggered rows between them (as many rows as asked; each round its pegs a little off their places,
// a few missing) and slots at its bottom, each with its prize. The cubes are held at its top - all of the room's,
// spread across it, or the one where you've put it - and let go: down through the pegs they bounce (SoftBody.board:
// see _solveBoard), the camera on the one, or keeping them all in. Landed in a slot, what's on it is done to the cube:
// turned gold, frozen into an ice cube, given eyes, made two, glittered, given acne, blown up - or the jackpot.

import * as THREE from 'three';
import { makeBoard } from './world/models.js';
import { EYE_FACES, copyEyes } from './eyes.js';
import { copyAcne } from './acne.js';
import { captureCube } from './cubecode.js';
import { separateClusters } from './sim/cutting.js';

const STORE = 'cube-sim-cublinko';
export const PLINKO_ROWS = [6, 16];
// (pegs a row: the board this many gaps wide - five, a cube in, 2.25 cubes apart: a few pegs, far between, little of
// a Plinko board)
const COLS = 7;
const MISSING = 0.07; // (a peg's chance of not being there, each round)
const JITTER = 0.16; // (how far off its place each peg is, a share of the spacing)

// The prizes: what landing in its slot does to a cube
export const PRIZES = [
  { id: 'gold', label: 'GOLD', color: '#e8b923', ink: '#3a2600', text: 'Gold!', give: (M, cb) => Object.assign(cb.style, { texture: 'chrome', flavor: '#e8b923' }) },
  { id: 'ice', label: 'FREEZE', color: '#7fd6ff', ink: '#0b3550', text: 'Frozen solid - an ice cube', give: (M, cb) => (cb.style.texture = 'ice') },
  { id: 'eyes', label: 'EYES', color: '#ffffff', ink: '#111111', text: 'Googly eyes!', give: (M, cb) => (cb.style.eyes = copyEyes(EYE_FACES.pair)) },
  { id: 'double', label: 'x2', color: '#64d65a', ink: '#0d3b0a', text: 'Two of it!', give: (M, cb) => M._double(cb) },
  { id: 'glitter', label: 'GLITTER', color: '#ff7ce8', ink: '#4a0040', text: 'Glittered', give: (M, cb) => (cb.style.glitter = 'holo') },
  { id: 'acne', label: 'ACNE', color: '#d8323c', ink: '#ffffff', text: 'A breakout!', give: (M, cb) => (cb.style.acne = copyAcne({ n: 24, size: 2, seed: 1 + Math.floor(Math.random() * 65534), red: '#d8323c', head: '#fff6dc', pus: '#f4e8b8' })) },
  { id: 'bust', label: 'BUST', color: '#202024', ink: '#ff5a3c', text: 'Bust!', give: (M, cb, k) => M._bust(k) },
  { id: 'jackpot', label: 'JACKPOT', color: '#ffd23f', ink: '#5a1a8f', text: 'JACKPOT!', give: (M, cb) => Object.assign(cb.style, { flavor: 'rainbow', glitter: 'holo', eyes: copyEyes(EYE_FACES.pair) }) },
];

export class CublinkoMode {
  constructor(app) {
    this.app = app;
    this.on = false;
    this.phase = ''; // '' ready, 'fall', 'done'
    this.t = 0;
    this.rows = 10;
    this.at = 0; // (-1..1: where along its top the cube's let go - one cube)
    try {
      const o = JSON.parse(localStorage.getItem(STORE) || '{}');
      if (o.rows >= PLINKO_ROWS[0] && o.rows <= PLINKO_ROWS[1]) this.rows = o.rows;
    } catch (e) {}
    this.B = null; // (the board, as SoftBody.board has it, and its slots)
    this.slots = [];
    this.model = null;
    this.s = 1; // (its cubes' biggest side: the board's scale)
    this.trk = new Map(); // (each cube: { still, landed, prize, nudge })
    this.won = []; // (what was won this round: [{ name, prize }])
    this.frameX = 0; // (where the camera looks - see App._updateCamera)
    this.frameY = null;
    this.frameZ = 0;
    this._was = null; // (the room as it was: its reach, ceiling - and the view)
    this.onChange = null; // (its bar: see ui/dropbar.js)
  }

  set(o) {
    if (o.rows !== undefined) this.rows = Math.min(PLINKO_ROWS[1], Math.max(PLINKO_ROWS[0], Math.round(o.rows)));
    if (o.at !== undefined) this.at = Math.min(1, Math.max(-1, o.at));
    try {
      localStorage.setItem(STORE, JSON.stringify({ rows: this.rows }));
    } catch (e) {}
    if (this.on && !this.phase) this._layout();
  }

  enter() {
    if (this.on) return;
    const app = this.app, sb = app.sb, g = app.orbitGoal;
    this.on = true;
    app.tool?.up?.();
    sb.endGrab();
    this._was = { arena: sb.p.arenaRadius, ceiling: sb.p.ceiling, view: { theta: g.theta, phi: g.phi, radius: g.radius } };
    this._layout();
    // (a bust's flash lights the jelly: that set of its shader compiled now, not as one lands - see JellyView.prewarm)
    app.jelly?.prewarm?.(64, sb, app.camera);
    this._changed();
  }

  exit() {
    if (!this.on) return;
    const app = this.app, sb = app.sb;
    sb.board = null;
    if (this.model) app.scene.remove(this.model);
    this.model = null;
    for (const cb of app.cubes) sb.cGrav[cb.slot] = 1;
    // (the cubes back in the room as it is: each set down whole where there's room - the board's slots were wider
    // than the room)
    if (this._was) {
      sb.p.arenaRadius = this._was.arena;
      sb.p.ceiling = this._was.ceiling;
      Object.assign(app.orbitGoal, this._was.view);
      this._was = null;
    }
    app.roomHold = null;
    app._arena();
    const spots = app.stackLayout?.() || [];
    for (const cb of app.cubes) {
      const L = spots.find((q) => q.slot === cb.slot), size = app.sizeOf(cb);
      sb.removeCube(cb.slot);
      sb.addCube(cb.slot, L ? L.x : 0, L ? L.y : 0, L ? L.z : 0, 0, app.bevelOf(cb), size, app.resOf(cb));
    }
    sb.rebuild();
    app._syncSel?.();
    app.onTopologyChanged();
    app.markHealed?.();
    sb.wakeAll();
    this.on = false;
    this.phase = '';
    this.frameY = null;
    this._changed();
  }

  // (a new board - its pegs off their places afresh, its slots and their prizes dealt again - and the cubes held at
  // its top; model: built again too)
  _layout() {
    const app = this.app, sb = app.sb;
    const s = (this.s = Math.max(...app.cubes.map((cb) => app.sizeOf(cb)), 0.3));
    // (pegs 1.65 cubes apart - the gaps between them 1.4 cubes, any way - rows 1.5 apart; its sides out past the end
    // pegs enough for a cube, 1.3: 0.99 of a cube off the wall, one came down between, wedged there, and never fell)
    const dx = 1.65 * s, dy = 1.5 * s, W = COLS * dx, pad = 0.6 * s, xl = -W / 2 - pad, xr = W / 2 + pad, Wb = xr - xl, ht = 1.3 * s, r = 0.14 * s;
    const rows = this.rows, cols = COLS, top = ht + 1.6 * s + (rows - 1) * dy;
    const at = new Float32Array(rows * cols * 2), on = new Uint8Array(rows * cols);
    for (let q = 0; q < rows; q++)
      for (let c = 0; c < cols; c++) {
        const i = q * cols + c;
        // (an odd row's last one would be in the wall)
        on[i] = (q & 1) && c === cols - 1 ? 0 : Math.random() < MISSING ? 0 : 1;
        at[i * 2] = (Math.random() - 0.5) * JITTER * dx;
        at[i * 2 + 1] = (Math.random() - 0.5) * JITTER * dy;
      }
    // (its slots: 5 to 7, the prizes dealt out - the jackpot not always there, never twice)
    const K = 5 + Math.floor(Math.random() * 3), deck = PRIZES.filter((p) => p.id !== 'jackpot').sort(() => Math.random() - 0.5);
    const picks = deck.slice(0, K);
    if (Math.random() < 0.65) picks[Math.floor(Math.random() * K)] = PRIZES.find((p) => p.id === 'jackpot');
    this.slots = picks.map((p, i) => ({ x0: xl + (i * Wb) / K, x1: xl + ((i + 1) * Wb) / K, prize: p, label: p.label, color: p.color, ink: p.ink }));
    const divs = [];
    for (let i = 1; i < K; i++) divs.push([xl + (i * Wb) / K, 0.07 * s, ht]);
    this.B = { zb: -0.68 * s, zf: 0.68 * s, xl, xr, mu: 0.12, pegs: { top, dy, dx, x0: -W / 2 + 0.5 * dx, rows, cols, r, at, on }, divs };
    sb.board = this.B;
    sb.p.arenaRadius = Math.max(this._was?.arena ?? 2.35, W);
    sb.p.ceiling = Math.max(this._was?.ceiling ?? 4.2, top + 4 * s);
    app.roomHold = { arena: sb.p.arenaRadius, ceiling: sb.p.ceiling };
    if (this.model) app.scene.remove(this.model);
    this.model = makeBoard(app.M, this.B, this.slots, s);
    app.scene.add(this.model);
    this._hold();
  }

  // (the cubes held at the top, side by side - one, where it's to go in - their weight off till they're let go)
  _hold() {
    const app = this.app, sb = app.sb, s = this.s, B = this.B, n = app.cubes.length, span = B.xr - B.xl - 1.6 * s;
    app.nails?.clearAll?.();
    app.cubes.forEach((cb, i) => {
      const x = n === 1 ? this.at * (span / 2) : B.xl + 0.8 * s + (n > 1 ? (i * span) / (n - 1) : span / 2);
      const size = app.sizeOf(cb);
      sb.removeCube(cb.slot);
      sb.addCube(cb.slot, x, B.pegs.top + 0.9 * s, 0, (Math.random() - 0.5) * 0.4, app.bevelOf(cb), size, app.resOf(cb));
      sb.cGrav[cb.slot] = 0;
    });
    sb.rebuild();
    app._syncSel?.();
    app.onTopologyChanged();
    app.markHealed?.();
    app.zits?.reset();
    sb.wakeAll();
    this.phase = '';
    this.trk.clear();
    this.won = [];
    const g = app.orbitGoal;
    g.theta = 0;
    g.phi = 0.05;
    this.frameY = B.pegs.top;
    this._frame(B.pegs.top, B.pegs.top + s, 10);
  }

  // (the view: the whole board across, from in front - a phone held upright, its width - up and down with the cubes
  // still falling, all of them in, eased and kept on the board; none falling, on its slots. Panned after a cube across
  // the board as well, six cubes high, every peg it hit swung the view about)
  _frame(lo, hi, dt) {
    const app = this.app, s = this.s, B = this.B, cam = app.camera, vf = THREE.MathUtils.degToRad(app._fovBase || cam.fov);
    const tv = Math.tan(vf / 2), th = tv * (cam.aspect || 1), top = B.pegs.top + 2.8 * s;
    // (back far enough for its width - or, more falling far apart, for them all; never further than for all of it)
    const wide = (0.5 * (B.xr - B.xl + 1.2 * s)) / th, all = (0.5 * (top + 1.5 * s)) / tv;
    const R = Math.max(4, Math.min(Math.max(wide, (0.5 * (hi - lo + 4 * s)) / tv), Math.max(wide, all)));
    const half = R * tv, low = half - 0.5 * s, high = top - half + 0.3 * s;
    const want = high < low ? 0.5 * top : Math.min(high, Math.max(low, 0.5 * (lo + hi)));
    this.frameY += (want - this.frameY) * (1 - Math.exp(-dt * 3));
    this.frameX = 0.5 * (B.xl + B.xr);
    this.frameZ = 0;
    app.orbitGoal.radius = R;
  }

  // Drop: let go
  drop() {
    if (!this.on || this.phase) return;
    const app = this.app, sb = app.sb;
    for (const cb of app.cubes) sb.cGrav[cb.slot] = 1;
    // (a little sideways each, so no two runs are the same)
    for (const cb of app.cubes) {
      const k = cb.slot, v = (Math.random() - 0.5) * 0.8;
      for (let i = 0; i < sb.nV; i++) if (sb.vCube[i] === k) sb.v[i * 3] += v;
      this.trk.set(k, { still: 0, landed: false, prize: null, stuck: 0 });
    }
    sb.wakeAll();
    this.phase = 'fall';
    this.t = 0;
    app.audio?.whoosh(0.5);
    this._changed();
  }

  // Again: a new board, the cubes back at the top
  again() {
    if (!this.on || this.phase === 'fall') return;
    this._layout();
    this._changed();
  }

  update(dt) {
    if (!this.on || !this.B) return;
    const app = this.app, sb = app.sb, s = this.s, B = this.B;
    this.t += dt;
    if (this.phase === 'fall') {
      let left = 0, yl = Infinity, yh = -Infinity;
      for (const cb of app.cubes) {
        const T = this.trk.get(cb.slot);
        if (!T) continue;
        let pc = null, pi = -1;
        sb.pieces.forEach((q, i) => {
          if (q && q.cube === cb.slot && (!pc || q.verts.length > pc.verts.length)) (pc = q), (pi = i);
        });
        if (!pc) continue;
        const v = Math.hypot(pc.vel[0], pc.vel[1], pc.vel[2]);
        T.still = v < 0.35 ? T.still + dt : 0;
        if (!T.landed) {
          left++;
          yl = Math.min(yl, pc.com[1]);
          yh = Math.max(yh, pc.com[1]);
          // (on top of a slot's wall - it lands in neither: its nearest wall, and if it's on it)
          const ht = B.divs[0]?.[2] ?? 1.3 * s;
          let near = Infinity, wx = 0;
          for (const [dx] of B.divs) if (Math.abs(pc.com[0] - dx) < near) (near = Math.abs(pc.com[0] - dx)), (wx = dx);
          const onWall = pc.com[1] > 0.8 * ht && near < 0.45 * s;
          // (down in a slot, and still: its prize)
          if (pc.com[1] < ht + 0.9 * s && !onWall && T.still > 0.5) this._land(cb, pc, T);
          // (caught on a peg, or on a wall's top, balanced: nudged off it - off a wall, into the slot it's more over)
          else if (pc.com[1] > 0.8 * ht && T.still > (onWall ? 0.4 : 1.2)) {
            // (harder each time it's still stuck; by a side, toward the middle)
            const edge = Math.min(pc.com[0] - B.xl, B.xr - pc.com[0]) < 1.3 * s;
            const way = onWall && Math.abs(pc.com[0] - wx) > 0.02 * s ? Math.sign(pc.com[0] - wx) : edge ? -Math.sign(pc.com[0]) : Math.random() < 0.5 ? -1 : 1;
            const kick = way * Math.min(4, (onWall ? 1.2 : 1.6) + 0.8 * T.stuck), up = Math.min(4, (onWall ? 0.6 : 1) + 0.7 * T.stuck);
            for (let i = 0; i < sb.nV; i++) if (sb.vCube[i] === cb.slot) (sb.v[i * 3] += kick), (sb.v[i * 3 + 1] += up);
            sb.wake(pi);
            T.still = 0;
            T.stuck++;
          }
        }
      }
      // (the camera on those still falling - none, the slots)
      if (left) this._frame(yl, yh, dt);
      else this._frame(0, 0, dt);
      if (!left || this.t > 30) {
        this.phase = 'done';
        this._changed();
      }
    } else if (this.phase === 'done') this._frame(0, 0, dt);
  }

  // (in slot ... : what's there done to it)
  _land(cb, pc, T) {
    const app = this.app, S = this.slots.find((q) => pc.com[0] >= q.x0 && pc.com[0] < q.x1) || this.slots[this.slots.length - 1];
    T.landed = true;
    T.prize = S.prize;
    this.won.push({ name: cb.name || 'It', prize: S.prize });
    S.prize.give(this, cb, cb.slot);
    app.applyStyle();
    app.audio?.fanfare?.(S.prize.id === 'jackpot' ? 3 : 1);
    const p = new THREE.Vector3(pc.com[0], pc.com[1] + 0.6 * this.s, pc.com[2]), cc = new THREE.Color(S.prize.color);
    for (let k = 0; k < (S.prize.id === 'jackpot' ? 120 : 40); k++) app.particles?.glitter(p, 1, [cc.r, cc.g, cc.b], 2.2);
    app.ui?.hint(`${cb.name || 'It'}: ${S.prize.text}`, 2600);
    this._changed();
  }

  // (x2: another of it, dropped in on top of it - into its slot, not a spot on the room's floor in another one)
  _double(cb) {
    const app = this.app, sb = app.sb, s = this.s;
    if (app.cubes.length >= 8) return;
    const sel = app.cubes.findIndex((c) => c === cb);
    if (sel >= 0) app.selectCube?.(cb.slot);
    let pc = null;
    for (const q of sb.pieces) if (q && q.cube === cb.slot && (!pc || q.verts.length > pc.verts.length)) pc = q;
    const c = captureCube(app, cb.name || '');
    // (set down on it, not dropped: an ice cube's copy dropped on it from a cube's height broke it)
    const slot = app.addCube(c, { drop: !pc, at: pc ? [pc.com[0], pc.bbox[4] + 0.15 * s, 0] : null });
    if (slot >= 0) sb.cGrav[slot] = 1;
  }

  // (bust: blown up where it is - a bomb's bang on its top, and torn apart round a few points in it, along its tets' own
  // faces, all at once; its own bits flung out, the cubes round it left be. A bomb's crater and then four plane cuts
  // through it took 0.6 s - more with others in the room - and the bomb's blast threw its neighbours back up the board)
  _bust(k) {
    const app = this.app, sb = app.sb, s = this.s;
    let pc = null;
    for (const q of sb.pieces) if (q && q.cube === k && (!pc || q.verts.length > pc.verts.length)) pc = q;
    if (!pc) return;
    const b = pc.bbox.slice(), c = pc.com.slice(), top = new THREE.Vector3(c[0], b[4], c[2]);
    app.particles?.flash(top, 1.6);
    app.particles?.flash(top, 0.6, [20, 16, 10]);
    app.particles?.sparks(top, 50, 5);
    app.particles?.smoke(top, 18, 0.9, 0.22, 0.6, 0.5);
    app.audio?.boom(1);
    app.tally?.('booms');
    app.shake(0.05);
    app.flash = 0.6;
    app.fireAt(top.clone().add(new THREE.Vector3(0, 0.15, 0)), 9);
    // (its tets each to the nearest of six points through it)
    const seeds = [], x = sb.x, T = sb.T, lab = new Int32Array(sb.nT).fill(-1);
    for (let j = 0; j < 6; j++) seeds.push([0, 1, 2].map((a) => b[a] + (0.15 + 0.7 * Math.random()) * (b[a + 3] - b[a])));
    for (const t of pc.tets) {
      const o = t * 4, i0 = T[o] * 3, i1 = T[o + 1] * 3, i2 = T[o + 2] * 3, i3 = T[o + 3] * 3;
      const px = (x[i0] + x[i1] + x[i2] + x[i3]) / 4, py = (x[i0 + 1] + x[i1 + 1] + x[i2 + 1] + x[i3 + 1]) / 4, pz = (x[i0 + 2] + x[i1 + 2] + x[i2 + 2] + x[i3 + 2]) / 4;
      let best = 0, bd = Infinity;
      for (let j = 0; j < seeds.length; j++) {
        const q = seeds[j], d = (px - q[0]) ** 2 + (py - q[1]) ** 2 + (pz - q[2]) ** 2;
        if (d < bd) (bd = d), (best = j);
      }
      lab[t] = best;
    }
    separateClusters(sb, lab, app.allAnchors());
    app.onTopologyChanged();
    app.markDamaged();
    sb.radialImpulse(c[0], c[1], c[2], 2.5 * s, 6, 1.5, 0, k);
    const col = app.flavorColorAtRest?.(0, 0, 0, k) ?? '#ff4fa3';
    for (let j = 0; j < 22; j++) {
      const th = Math.random() * Math.PI * 2, v = new THREE.Vector3(Math.cos(th) * (1 + Math.random() * 3), 1 + Math.random() * 3, (Math.random() - 0.5) * 0.6);
      app.droplets?.spawn(new THREE.Vector3(c[0], c[1], c[2]), v, 0.01 + Math.random() * 0.02, col);
    }
  }

  _changed() {
    this.onChange?.(this.phase);
  }
}
