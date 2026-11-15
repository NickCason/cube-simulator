// Replay - the jelly's last few seconds kept a frame at a time, to be gone back over: scrubbed through with a slider,
// played back, the view turned round it as it goes (see DropMode). Every point's place each frame - and the liquid's,
// when it's the same liquid all along - and, each time the jelly's cut up as it goes (a shatter), the mesh it was in
// till then: so frames from before a cut can be shown in the mesh it's in now - each of its points found in the old
// one by where it is in the cube as made, nudged a hair into its own side of any crack, and carried there - the
// cracks closed till they open.

const BUDGET = 24e6; // (bytes of frames kept, at most: the oldest go first)

export class Replay {
  constructor(app) {
    this.app = app;
    this.frames = []; // ({ t: sim time, e: its mesh, x: every point's place, f: the liquid's or null, fn: how many drops })
    this.epochs = []; // ({ topo, nV, nT, T, X: the mesh as it was, map: its points found for the mesh now - see _map })
    this.on = false; // (keeping frames)
    this.showing = false; // (a frame of it on show, the jelly stopped)
    this.i = 0; // (which, and - played - how far between it and the next)
    this.u = 0;
    this.playing = false;
    this._bytes = 0;
    this._live = null; // (the jelly as it was as the replay began, to go back to: { x, px, v, nV, topo })
  }

  // (from now on, frames kept - the last lot gone)
  start() {
    this.stopShow();
    this.frames.length = 0;
    this.epochs.length = 0;
    this._bytes = 0;
    this.on = true;
  }

  stop() {
    this.on = false;
  }

  get length() {
    return this.frames.length;
  }

  // (this frame: every point's place - in the mesh it's in now, a new one kept as it changes)
  record() {
    if (!this.on || this.showing) return;
    const sb = this.app.sb, fl = this.app.fluid;
    let E = this.epochs[this.epochs.length - 1];
    if (!E || E.topo !== sb.topoVersion || E.nV !== sb.nV) {
      E = { topo: sb.topoVersion, nV: sb.nV, nT: sb.nT, T: sb.T.slice(0, sb.nT * 4), X: Float32Array.from(sb.X.subarray(0, sb.nV * 3)), map: null };
      this.epochs.push(E);
      this._bytes += E.T.byteLength + E.X.byteLength;
    }
    const x = Float32Array.from(sb.x.subarray(0, sb.nV * 3)), f = fl?.n ? Float32Array.from(fl.x.subarray(0, fl.n * 3)) : null;
    this.frames.push({ t: sb.time, e: this.epochs.length - 1, x, f, fn: fl?.n || 0 });
    this._bytes += x.byteLength + (f ? f.byteLength : 0);
    while (this._bytes > BUDGET && this.frames.length > 2) {
      const o = this.frames.shift();
      this._bytes -= o.x.byteLength + (o.f ? o.f.byteLength : 0);
    }
  }

  // (frame i on show - u of the way on to the next: the jelly stopped where it was, as it was then)
  show(i, u = 0) {
    const N = this.frames.length;
    if (!N) return;
    const app = this.app, sb = app.sb;
    if (!this.showing) {
      const n3 = sb.nV * 3;
      this._live = { x: sb.x.slice(0, n3), px: sb.px.slice(0, n3), v: sb.v.slice(0, n3), nV: sb.nV, topo: sb.topoVersion, fx: app.fluid?.n ? app.fluid.x.slice(0, app.fluid.n * 3) : null, fn: app.fluid?.n || 0 };
      this.showing = true;
      app.paused = true;
    }
    i = Math.max(0, Math.min(N - 1, i));
    this.i = i;
    this.u = i < N - 1 ? Math.max(0, Math.min(1, u)) : 0;
    const A = this.frames[i], B = this.u > 0 ? this.frames[i + 1] : null, x = sb.x, n = sb.nV;
    this._place(A, x, 1 - this.u);
    if (B) this._place(B, x, this.u, true);
    sb.px.set(x.subarray(0, n * 3));
    sb.v.fill(0, 0, n * 3);
    sb.measurePieces?.();
    // (the liquid, if it's the same drops as now)
    const fl = app.fluid, F = this.u < 0.5 || !B ? A : B;
    if (fl && F.f && F.fn === fl.n && this._live.fn === fl.n) {
      fl.x.set(F.f);
      fl._remesh?.();
    }
    // (what rides on it - its eyes, its zits - put where it is)
    app.eyes?.update?.(0);
    app.zits?.update?.(0);
  }

  // (frame F's places, in the mesh as it is now, times w - added to what's there, or put)
  _place(F, x, w, add = false) {
    const sb = this.app.sb, n = sb.nV, E = this.epochs[F.e];
    if (E.topo === (this._live?.topo ?? sb.topoVersion) && E.nV === n) {
      const s = F.x;
      if (add) for (let k = 0; k < n * 3; k++) x[k] += s[k] * w;
      else for (let k = 0; k < n * 3; k++) x[k] = s[k] * w;
      return;
    }
    const M = E.map || (E.map = this._map(E)), s = F.x;
    for (let i = 0; i < n; i++) {
      const q = i * 4;
      let px = 0, py = 0, pz = 0;
      for (let j = 0; j < 4; j++) {
        const o = M.idx[q + j] * 3, b = M.b[q + j];
        px += s[o] * b; py += s[o + 1] * b; pz += s[o + 2] * b;
      }
      const o = i * 3;
      if (add) (x[o] += px * w), (x[o + 1] += py * w), (x[o + 2] += pz * w);
      else (x[o] = px * w), (x[o + 1] = py * w), (x[o + 2] = pz * w);
    }
  }

  // (each point of the mesh now, found in mesh E by where it is in the cube as made: the tet of E it's in - looked for
  // a hair into its own side of any crack, so the two sides of one go each with their own side - and its weights
  // there; outside them all, the nearest point of E)
  _map(E) {
    const sb = this.app.sb, n = sb.nV, X = sb.X, T = sb.T, vs = sb.vtStart, vl = sb.vtList;
    const idx = new Int32Array(n * 4), b = new Float32Array(n * 4), EX = E.X, ET = E.T;
    // (E's tets in a grid by their rest boxes)
    const h = Math.max(1e-3, (sb.hCell || 0.08) * 1.5), cells = new Map(), key = (i, j, k) => ((i + 2048) * 4096 + (j + 2048)) * 4096 + (k + 2048);
    for (let t = 0; t < E.nT; t++) {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let j = 0; j < 4; j++) {
        const o = ET[t * 4 + j] * 3;
        x0 = Math.min(x0, EX[o]); x1 = Math.max(x1, EX[o]);
        y0 = Math.min(y0, EX[o + 1]); y1 = Math.max(y1, EX[o + 1]);
        z0 = Math.min(z0, EX[o + 2]); z1 = Math.max(z1, EX[o + 2]);
      }
      for (let i = Math.floor(x0 / h); i <= Math.floor(x1 / h); i++)
        for (let j = Math.floor(y0 / h); j <= Math.floor(y1 / h); j++)
          for (let k = Math.floor(z0 / h); k <= Math.floor(z1 / h); k++) {
            const c = key(i, j, k), l = cells.get(c);
            if (l) l.push(t);
            else cells.set(c, [t]);
          }
    }
    const bary = (t, px, py, pz, out) => {
      const a = ET[t * 4] * 3, bb = ET[t * 4 + 1] * 3, c = ET[t * 4 + 2] * 3, d = ET[t * 4 + 3] * 3;
      const e1x = EX[bb] - EX[a], e1y = EX[bb + 1] - EX[a + 1], e1z = EX[bb + 2] - EX[a + 2];
      const e2x = EX[c] - EX[a], e2y = EX[c + 1] - EX[a + 1], e2z = EX[c + 2] - EX[a + 2];
      const e3x = EX[d] - EX[a], e3y = EX[d + 1] - EX[a + 1], e3z = EX[d + 2] - EX[a + 2];
      const det = e1x * (e2y * e3z - e2z * e3y) - e1y * (e2x * e3z - e2z * e3x) + e1z * (e2x * e3y - e2y * e3x);
      if (Math.abs(det) < 1e-18) return -Infinity;
      const rx = px - EX[a], ry = py - EX[a + 1], rz = pz - EX[a + 2];
      const b1 = (rx * (e2y * e3z - e2z * e3y) - ry * (e2x * e3z - e2z * e3x) + rz * (e2x * e3y - e2y * e3x)) / det;
      const b2 = (e1x * (ry * e3z - rz * e3y) - e1y * (rx * e3z - rz * e3x) + e1z * (rx * e3y - ry * e3x)) / det;
      const b3 = (e1x * (e2y * rz - e2z * ry) - e1y * (e2x * rz - e2z * rx) + e1z * (e2x * ry - e2y * rx)) / det;
      out[0] = 1 - b1 - b2 - b3; out[1] = b1; out[2] = b2; out[3] = b3;
      return Math.min(out[0], b1, b2, b3);
    };
    const tmp = new Float64Array(4);
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      let px = X[o], py = X[o + 1], pz = X[o + 2];
      // (a hair toward the middle of its own tets, into its own side)
      if (vs && vl && vs.length > i + 1 && vs[i + 1] > vs[i]) {
        let cx = 0, cy = 0, cz = 0, m = 0;
        for (let q = vs[i]; q < vs[i + 1]; q++) {
          const t4 = vl[q] * 4;
          for (let j = 0; j < 4; j++) {
            const w = T[t4 + j] * 3;
            cx += X[w]; cy += X[w + 1]; cz += X[w + 2];
          }
          m += 4;
        }
        const f = 0.06;
        px += (cx / m - px) * f; py += (cy / m - py) * f; pz += (cz / m - pz) * f;
      }
      const l = cells.get(key(Math.floor(px / h), Math.floor(py / h), Math.floor(pz / h)));
      let best = -1, bestS = -Infinity;
      if (l)
        for (const t of l) {
          const sc = bary(t, px, py, pz, tmp);
          if (sc > bestS) (bestS = sc), (best = t);
          if (sc >= 0) break;
        }
      const q = i * 4;
      if (best >= 0 && bestS > -0.25) {
        // (its weights there for where it really is, not the nudged point)
        bary(best, X[o], X[o + 1], X[o + 2], tmp);
        for (let j = 0; j < 4; j++) (idx[q + j] = ET[best * 4 + j]), (b[q + j] = tmp[j]);
        continue;
      }
      // (none: E's nearest point)
      let nb = 0, nd = Infinity;
      for (let j = 0; j < E.nV; j++) {
        const d = (EX[j * 3] - X[o]) ** 2 + (EX[j * 3 + 1] - X[o + 1]) ** 2 + (EX[j * 3 + 2] - X[o + 2]) ** 2;
        if (d < nd) (nd = d), (nb = j);
      }
      idx[q] = idx[q + 1] = idx[q + 2] = idx[q + 3] = nb;
      b[q] = 1; b[q + 1] = b[q + 2] = b[q + 3] = 0;
    }
    return { idx, b };
  }

  // (played on: a frame a frame, as it was kept - slowed where time was)
  tick() {
    if (!this.showing || !this.playing) return;
    if (this.i >= this.frames.length - 1) {
      this.playing = false;
      return;
    }
    this.show(this.i + 1);
  }

  // (back to the jelly as it was, going on)
  stopShow() {
    if (!this.showing) return;
    const app = this.app, sb = app.sb, L = this._live;
    if (L && L.nV === sb.nV && L.topo === sb.topoVersion) {
      sb.x.set(L.x);
      sb.px.set(L.px);
      sb.v.set(L.v);
      sb.measurePieces?.();
      const fl = app.fluid;
      if (fl && L.fx && L.fn === fl.n) {
        fl.x.set(L.fx);
        fl._remesh?.();
      }
    }
    this._live = null;
    this.showing = false;
    this.playing = false;
    app.paused = false;
    app.eyes?.update?.(0);
    app.zits?.update?.(0);
  }
}
