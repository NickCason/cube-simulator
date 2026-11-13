// In the page (injected by kit.mjs before the app loads): window.__kit - helpers and measurements, each
// called as k.probe(name, arg). Measurements return plain numbers; lengths in m unless named ...Cm.
window.__kit = (() => {
  const A = () => window.__app;
  const K = {};

  // ---- driving
  K.frames = (n = 1, dt = 1 / 30) => {
    const a = A();
    for (let i = 0; i < n; i++) a.frame(dt);
    a.render();
    return n;
  };
  K.load = async (code) => {
    const m = await import('/src/cubecode.js');
    A().loadCube(m.decodeCube(code));
    return true;
  };
  K.set = (s) => {
    const a = A();
    for (const [k, v] of Object.entries(s || {})) a.setSetting(k, v, true);
    return true;
  };
  K.style = (s) => {
    const a = A();
    if (s.texture) a.setTexture(s.texture);
    if (s.color) a.setColor(s.color);
    if (s.edges) a.setEdges(s.edges);
    if (s.trim) a.setTrim(s.trim);
    if (s.place) a.setPlace(s.place, false);
    return true;
  };
  K.skip = (s) => {
    const a = A();
    a.skip.liquid = !!s.liquid;
    a.skip.jelly = !!s.jelly;
    a.render();
    return true;
  };
  K.pointer = (type, id, x, y) => {
    A().canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerType: 'touch', isPrimary: id === 1, bubbles: true }));
    return true;
  };

  // ---- where things are on the screen (CSS px)
  K.screenOf = (p) => {
    const a = A(), V3 = a.camera.position.constructor, r = a.canvas.getBoundingClientRect(), v = new V3(p[0], p[1], p[2]).project(a.camera);
    return [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height];
  };
  K.screenBox = () => {
    const a = A(), sb = a.sb, V3 = a.camera.position.constructor, r = a.canvas.getBoundingClientRect(), v = new V3();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < sb.nV; i++) {
      if (!sb.alive[i]) continue;
      v.set(sb.x[i * 3], sb.x[i * 3 + 1], sb.x[i * 3 + 2]).project(a.camera);
      const px = r.left + (v.x * 0.5 + 0.5) * r.width, py = r.top + (-v.y * 0.5 + 0.5) * r.height;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    return { x0, x1, y0, y1 };
  };
  const pieceOf = (which) => {
    const ps = A().sb.pieces.filter(Boolean).sort((p, q) => p.verts.length - q.verts.length);
    if (which === 'top' || which === 'bottom') return ps.reduce((m, p) => (!m || (which === 'top' ? p.com[1] > m.com[1] : p.com[1] < m.com[1]) ? p : m), null);
    return which === 'small' ? ps[0] : which === 'big' ? ps[ps.length - 1] : A().sb.pieces[which];
  };
  K.pieceScreen = (which = 'small') => K.screenOf(pieceOf(which).com);
  K.pieces = () => {
    const sb = A().sb, ps = sb.pieces.filter(Boolean);
    return { n: ps.length, verts: ps.map((p) => p.verts.length).sort((p, q) => q - p), awake: ps.filter((p) => !p.asleep).length, tets: sb.nT };
  };

  // ---- the cube as it stands: its points' best rigid fit (cube k's, or its biggest piece's) - middle now (xm),
  // at rest (Xm), and the turn R (row-major, rest -> world)
  K.fit = async (k = 0) => {
    const { polarRot } = await import('/src/sim/softbody.js');
    const sb = A().sb, big = pieceOf('big'), vs = big ? big.verts : [];
    const xm = [0, 0, 0], Xm = [0, 0, 0];
    let n = 0;
    for (const i of vs) {
      if (!sb.alive[i] || sb.vCube[i] !== k) continue;
      for (let c = 0; c < 3; c++) (xm[c] += sb.x[i * 3 + c]), (Xm[c] += sb.X[i * 3 + c]);
      n++;
    }
    for (let c = 0; c < 3; c++) (xm[c] /= n), (Xm[c] /= n);
    const M = new Float64Array(9), R = new Float64Array(9);
    for (const i of vs) {
      if (!sb.alive[i] || sb.vCube[i] !== k) continue;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) M[r * 3 + c] += (sb.x[i * 3 + r] - xm[r]) * (sb.X[i * 3 + c] - Xm[c]);
    }
    polarRot(new Float64Array([0, 0, 0, 1]), M, R, 30);
    return { xm, Xm, R: Array.from(R) };
  };
  // the camera: { theta, phi, radius, target } or { face: '+z' | '-x' ..., phi, radius } - square on to that face
  K.camera = async (c) => {
    const a = A(), o = { theta: c.theta, phi: c.phi, radius: c.radius };
    let target = c.target;
    if (c.face) {
      const f = await K.fit(c.cube ?? 0), ax = 'xyz'.indexOf(c.face[1]), s = c.face[0] === '-' ? -1 : 1, R = f.R;
      const n = [R[ax] * s, R[3 + ax] * s, R[6 + ax] * s];
      o.theta = Math.atan2(n[0], n[2]);
      o.phi = c.phi ?? 0.05;
      o.radius = c.radius ?? 4;
      target = target || f.xm;
    }
    if (target) a.orbit.target.set(target[0], target[1], target[2]);
    for (const q of [a.orbit, a.orbitGoal]) for (const key of ['theta', 'phi', 'radius']) if (o[key] !== undefined) q[key] = o[key];
    K.frames(3);
    return true;
  };

  // ---- measurements
  // The liquid's drawn surface in the jelly as it's drawn (Fluid._jellyAt, else its tets), over n frames: points
  // 1 cm and 3 cm deep or more (the nearest way out of 26, to half a centimetre and two halvings, 8 cm at most) -
  // mean and worst a frame - and the deepest.
  K.depth = (o = {}) => {
    const a = A(), fl = a.fluid, NF = o.frames ?? 30, dt = o.dt ?? 1 / 30;
    const JA = fl._jellyAt ? (x, y, z) => fl._jellyAt(x, y, z) : (x, y, z) => fl._inTet(x, y, z);
    const DIRS = [];
    for (let p = -1; p <= 1; p++) for (let q = -1; q <= 1; q++) for (let r = -1; r <= 1; r++) if (p || q || r) { const l = Math.hypot(p, q, r); DIRS.push([p / l, q / l, r / l]); }
    const depth = (px, py, pz) => {
      let best = 0.08;
      for (const [dx, dy, dz] of DIRS) {
        let lo = 0, hi = -1;
        for (let s = 1; s <= 16 && s * 0.005 < best; s++) { const d = s * 0.005; if (JA(px + dx * d, py + dy * d, pz + dz * d) < 0) { hi = d; break; } lo = d; }
        if (hi < 0) continue;
        for (let b = 0; b < 2; b++) { const m = 0.5 * (lo + hi); if (JA(px + dx * m, py + dy * m, pz + dz * m) < 0) hi = m; else lo = m; }
        if (hi < best) best = hi;
      }
      return best;
    };
    let D1 = 0, D3 = 0, W1 = 0, W3 = 0, dmax = 0, at = null, pts = 0;
    for (let f = 0; f < NF; f++) {
      a.frame(dt);
      if (!fl.asleep) fl._remesh();
      fl._jellyCells();
      const pos = fl.geo.attributes.position.array, cnt = fl.geo.drawRange.count;
      let d1 = 0, d3 = 0;
      pts = cnt;
      for (let v = 0; v < cnt; v++) {
        const o3 = v * 3, px = pos[o3], py = pos[o3 + 1], pz = pos[o3 + 2], t = ((v / 3) | 0) * 9;
        if (pos[t] === pos[t + 3] && pos[t] === pos[t + 6] && pos[t + 1] === pos[t + 4] && pos[t + 1] === pos[t + 7] && pos[t + 2] === pos[t + 5] && pos[t + 2] === pos[t + 8]) continue;
        if (JA(px, py, pz) < 0) continue;
        const dd = depth(px, py, pz);
        if (dd >= 0.01) {
          d1++;
          if (dd >= 0.03) d3++;
          if (dd > dmax) (dmax = dd), (at = [px, py, pz].map((q) => +q.toFixed(2)));
        }
      }
      D1 += d1; D3 += d3; W1 = Math.max(W1, d1); W3 = Math.max(W3, d3);
    }
    return { frames: NF, surface: pts, d1mean: +(D1 / NF).toFixed(1), d1worst: W1, d3mean: +(D3 / NF).toFixed(1), d3worst: W3, deepestCm: +(100 * dmax).toFixed(1), at };
  };

  // The bubbles riding cube k's liquid: against the liquid's drawn surface (its own points - a middle out of it, or
  // its sphere reaching past it; those riding its top, as meant, aside) and against the hollow's walls (its shape
  // as drawn: sphere into the wall)
  K.bubbles = async (o = {}) => {
    const mesh = await import('/src/sim/mesh.js');
    const a = A(), sb = a.sb, fl = a.fluid, bu = a.bubbles, k = o.cube ?? 0, cnt = fl.geo.drawRange.count, P = fl.pos, N = fl.nrm;
    const h = 0.05, grid = new Map(), key = (x, y, z) => `${Math.floor(x / h)},${Math.floor(y / h)},${Math.floor(z / h)}`;
    let lvl = -Infinity;
    for (let v = 0; v < cnt; v++) {
      if (fl.inn[v] !== k + 1) continue;
      const kk = key(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      (grid.get(kk) || grid.set(kk, []).get(kk)).push(v);
      lvl = Math.max(lvl, P[v * 3 + 1]);
    }
    const near = (x, y, z) => {
      let best = -1, bd = Infinity;
      const i0 = Math.floor(x / h), j0 = Math.floor(y / h), k0 = Math.floor(z / h);
      for (let r = 1; r <= 3 && best < 0; r++)
        for (let i = i0 - r; i <= i0 + r; i++)
          for (let j = j0 - r; j <= j0 + r; j++)
            for (let q = k0 - r; q <= k0 + r; q++) {
              const l = grid.get(`${i},${j},${q}`);
              if (l) for (const v of l) { const d = (P[v * 3] - x) ** 2 + (P[v * 3 + 1] - y) ** 2 + (P[v * 3 + 2] - z) ** 2; if (d < bd) (bd = d), (best = v); }
            }
      return [best, Math.sqrt(bd)];
    };
    const half = sb.cSize[k] / 2, bh = sb.hollowBevel ? sb.hollowBevel(k) : sb.cBevel[k], th = sb.wallTh ? sb.wallTh(k) : 0.05, sh = sb.shapeOf(k);
    let n = 0, top = 0, poke = 0, out = 0, worst = 0, wall = 0, wallWorst = 0;
    for (const b of bu.items) {
      if (!b.pool || b.gone || !b.held || b.hk !== k) continue;
      n++;
      const into = mesh.shapeSDF(b.c[0] - k * 10, b.c[1], b.c[2], half, bh, sh) + th + b.R;
      if (into > 0.002) (wall++, (wallWorst = Math.max(wallWorst, into)));
      const [v, d] = near(b.w[0], b.w[1], b.w[2]);
      if (v < 0) continue; // (deep in it)
      if (N[v * 3 + 1] > 0.7 && b.w[1] > lvl - 2 * b.R) { top++; continue; }
      const side = (b.w[0] - P[v * 3]) * N[v * 3] + (b.w[1] - P[v * 3 + 1]) * N[v * 3 + 1] + (b.w[2] - P[v * 3 + 2]) * N[v * 3 + 2];
      const past = side > 0 ? d + b.R : b.R - d;
      if (side > 0) out++;
      if (past > 0.002) poke++;
      worst = Math.max(worst, past);
    }
    return { n, top, pokeOut: poke, middleOut: out, worstOutCm: +(100 * worst).toFixed(1), inWall: wall, wallWorstCm: +(100 * wallWorst).toFixed(1) };
  };

  // The jelly as drawn against the jelly as it is: each drawn point's distance from the nearest of the physics'
  // surface triangles (a hash of them, 5 cm cells, and ±1 cell round; past that, all of them). Smoothing and the
  // shapes' snapping move points a centimetre or two; a shard stretched out of it, far more. How many past 3 and
  // 6 cm, the worst, where, and which kind of point (base, first or second subdivision)
  K.spikes = () => {
    const a = A(), sb = a.sb, jv = a.jelly, P = jv.pos, n = jv.nRender, X = sb.x, S = sb.sTri, nF = sb.nF, h = 0.05;
    if (!P || !n || !nF) return { none: true };
    const cells = new Map(), key = (i, j, k) => i * 1000003 + j * 1009 + k;
    for (let f = 0; f < nF; f++) {
      const a3 = S[f * 3] * 3, b3 = S[f * 3 + 1] * 3, c3 = S[f * 3 + 2] * 3;
      const lo = [0, 1, 2].map((q) => Math.floor(Math.min(X[a3 + q], X[b3 + q], X[c3 + q]) / h)), hi = [0, 1, 2].map((q) => Math.floor(Math.max(X[a3 + q], X[b3 + q], X[c3 + q]) / h));
      for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) { const kk = key(i, j, k); let L = cells.get(kk); if (!L) cells.set(kk, (L = [])); L.push(f); }
    }
    // (closest point on a triangle: Ericson's)
    const dist = (px, py, pz, f) => {
      const a3 = S[f * 3] * 3, b3 = S[f * 3 + 1] * 3, c3 = S[f * 3 + 2] * 3;
      const ax = X[a3], ay = X[a3 + 1], az = X[a3 + 2], abx = X[b3] - ax, aby = X[b3 + 1] - ay, abz = X[b3 + 2] - az, acx = X[c3] - ax, acy = X[c3 + 1] - ay, acz = X[c3 + 2] - az;
      const apx = px - ax, apy = py - ay, apz = pz - az, d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
      let qx, qy, qz;
      if (d1 <= 0 && d2 <= 0) (qx = ax), (qy = ay), (qz = az);
      else {
        const bpx = px - X[b3], bpy = py - X[b3 + 1], bpz = pz - X[b3 + 2], d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
        const cpx = px - X[c3], cpy = py - X[c3 + 1], cpz = pz - X[c3 + 2], d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
        if (d3 >= 0 && d4 <= d3) (qx = X[b3]), (qy = X[b3 + 1]), (qz = X[b3 + 2]);
        else if (d6 >= 0 && d5 <= d6) (qx = X[c3]), (qy = X[c3 + 1]), (qz = X[c3 + 2]);
        else if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); (qx = ax + abx * v), (qy = ay + aby * v), (qz = az + abz * v); }
        else if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); (qx = ax + acx * w), (qy = ay + acy * w), (qz = az + acz * w); }
        else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); (qx = X[b3] + (X[c3] - X[b3]) * w), (qy = X[b3 + 1] + (X[c3 + 1] - X[b3 + 1]) * w), (qz = X[b3 + 2] + (X[c3 + 2] - X[b3 + 2]) * w); }
        else { const dn = 1 / (va + vb + vc), v = vb * dn, w = vc * dn; (qx = ax + abx * v + acx * w), (qy = ay + aby * v + acy * w), (qz = az + abz * v + acz * w); }
      }
      return Math.hypot(px - qx, py - qy, pz - qz);
    };
    let over3 = 0, over6 = 0, worst = 0, at = null;
    const kinds = { base: 0, l1: 0, l2: 0 };
    for (let v = 0; v < n; v++) {
      const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2], ci = Math.floor(px / h), cj = Math.floor(py / h), ck = Math.floor(pz / h);
      let best = Infinity;
      for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (let k = ck - 1; k <= ck + 1; k++) { const L = cells.get(key(i, j, k)); if (L) for (const f of L) best = Math.min(best, dist(px, py, pz, f)); }
      if (best > h) for (let f = 0; f < nF; f++) best = Math.min(best, dist(px, py, pz, f));
      if (best > 0.03) {
        over3++;
        kinds[v < jv.nBase ? 'base' : v < jv.nL1 ? 'l1' : 'l2']++;
      }
      if (best > 0.06) over6++;
      if (best > worst) (worst = best), (at = { v, p: [px, py, pz].map((q) => +q.toFixed(3)), kind: v < jv.nBase ? 'base' : v < jv.nL1 ? 'l1' : 'l2' });
    }
    return { drawn: n, over3, over6, worstCm: +(100 * worst).toFixed(1), at, kinds };
  };

  // The jelly itself stretched: each tet's longest edge against the same edge at rest - how many past 1.8x and 3x,
  // the worst, where, and its piece's size (verts)
  K.stretch = () => {
    const a = A(), sb = a.sb, T = sb.T, x = sb.x, X = sb.X;
    let n18 = 0, n3 = 0, worst = 0, at = null;
    const E = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
    for (let t = 0; t < sb.nT; t++) {
      if (!(sb.vol0[t] > 0)) continue;
      let r = 0, len = 0;
      for (const [i, j] of E) {
        const a3 = T[t * 4 + i] * 3, b3 = T[t * 4 + j] * 3;
        const l = Math.hypot(x[a3] - x[b3], x[a3 + 1] - x[b3 + 1], x[a3 + 2] - x[b3 + 2]), L = Math.hypot(X[a3] - X[b3], X[a3 + 1] - X[b3 + 1], X[a3 + 2] - X[b3 + 2]) || 1e-9;
        if (l / L > r) (r = l / L), (len = l);
      }
      if (r > 1.8) n18++;
      if (r > 3) n3++;
      if (r > worst) {
        worst = r;
        const v = T[t * 4] * 3, pc = sb.tPiece ? sb.pieces[sb.tPiece[t]] : null;
        at = { t, p: [x[v], x[v + 1], x[v + 2]].map((q) => +q.toFixed(2)), lenCm: +(100 * len).toFixed(1), pieceVerts: pc ? pc.verts.length : null };
      }
    }
    return { tets: sb.nT, over18: n18, over3: n3, worst: +worst.toFixed(2), at };
  };

  // The liquid's drawn surface out past the jelly's box (its biggest piece's points' bounds, +1 cm): how many
  // points and how far - liquid through its walls, or poured out
  K.outside = () => {
    const a = A(), sb = a.sb, fl = a.fluid, P = fl.pos, cnt = fl.geo.drawRange.count, big = pieceOf('big');
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const i of big.verts) for (let c = 0; c < 3; c++) (lo[c] = Math.min(lo[c], sb.x[i * 3 + c])), (hi[c] = Math.max(hi[c], sb.x[i * 3 + c]));
    let past = 0, worst = 0;
    for (let v = 0; v < cnt; v++) {
      const d = Math.max(lo[0] - P[v * 3], P[v * 3] - hi[0], lo[1] - P[v * 3 + 1], P[v * 3 + 1] - hi[1], lo[2] - P[v * 3 + 2], P[v * 3 + 2] - hi[2]);
      if (d > 0.01) (past++, (worst = Math.max(worst, d)));
    }
    return { surface: cnt, past, worstCm: +(100 * worst).toFixed(1) };
  };

  // Cube k's own liquid as drawn against its jelly as it is: its surface's points out of its outside skin (sticking out
  // of it), in its wall (in the skin, out of its hollow), and its drops out of its hollow - in its wall, out of it
  K.stickOut = (k = 0) => {
    const a = A(), sb = a.sb, fl = a.fluid, S = sb.sTri, tag = sb.sTag, ST = sb.sTet, tc = sb.tCube, c = sb.cav[k], id = sb.cHid[k];
    const P = fl.pos, cnt = fl.geo.drawRange.count, inn = fl.inn;
    const tri = new Int32Array(sb.nF * 3);
    let m = 0;
    for (let f = 0; f < sb.nF; f++) {
      if (tag[f] !== 1 || tc[ST[f]] !== k) continue;
      tri[m * 3] = S[f * 3]; tri[m * 3 + 1] = S[f * 3 + 1]; tri[m * 3 + 2] = S[f * 3 + 2];
      m++;
    }
    fl._xzBuild(tri, m);
    const outSkin = new Uint8Array(cnt), dOut = new Uint8Array(fl.n);
    let own = 0, sOut = 0, worstUp = 0;
    let top = -1e9;
    for (let i = 0; i < sb.nV; i++) if (sb.vCube[i] === k && sb.alive[i]) top = Math.max(top, sb.x[i * 3 + 1]);
    for (let v = 0; v < cnt; v++) {
      if (inn[v] !== k + 1) continue;
      own++;
      if (!fl._xzOdd(P[v * 3], P[v * 3 + 1], P[v * 3 + 2])) (outSkin[v] = 1), sOut++;
      worstUp = Math.max(worstUp, P[v * 3 + 1] - top);
    }
    // (how far out: to the nearest of its skin's triangles)
    const X = sb.x;
    const triD = (px, py, pz, a, b, c) => {
      // (Ericson's closest point on a triangle)
      const ax = X[a * 3], ay = X[a * 3 + 1], az = X[a * 3 + 2], bx = X[b * 3], by = X[b * 3 + 1], bz = X[b * 3 + 2], cx = X[c * 3], cy = X[c * 3 + 1], cz = X[c * 3 + 2];
      const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az, apx = px - ax, apy = py - ay, apz = pz - az;
      const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
      let qx, qy, qz;
      if (d1 <= 0 && d2 <= 0) (qx = ax), (qy = ay), (qz = az);
      else {
        const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
        if (d3 >= 0 && d4 <= d3) (qx = bx), (qy = by), (qz = bz);
        else if (d6 >= 0 && d5 <= d6) (qx = cx), (qy = cy), (qz = cz);
        else if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); qx = ax + abx * t; qy = ay + aby * t; qz = az + abz * t; }
        else if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); qx = ax + acx * t; qy = ay + acy * t; qz = az + acz * t; }
        else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / (d4 - d3 + (d5 - d6)); qx = bx + (cx - bx) * t; qy = by + (cy - by) * t; qz = bz + (cz - bz) * t; }
        else { const dn = 1 / (va + vb + vc), v = vb * dn, w = vc * dn; qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w; }
      }
      return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
    };
    let outW = 0, outSum = 0, outN = 0, out1 = 0, oy0 = 1e9, oy1 = -1e9;
    for (let v = 0; v < cnt; v++) {
      if (!outSkin[v]) continue;
      let best = 1e9;
      for (let f = 0; f < m; f++) best = Math.min(best, triD(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], tri[f * 3], tri[f * 3 + 1], tri[f * 3 + 2]));
      best = Math.sqrt(best);
      outW = Math.max(outW, best); outSum += best; outN++;
      if (best > 0.01) (oy0 = Math.min(oy0, P[v * 3 + 1])), (oy1 = Math.max(oy1, P[v * 3 + 1]));
      if (best > 0.01) out1++;
    }
    let drops = 0, dropsOutSkin = 0;
    for (let i = 0; i < fl.n; i++) {
      if (fl.own[i] !== id) continue;
      drops++;
      if (!fl._xzOdd(fl.x[i * 3], fl.x[i * 3 + 1], fl.x[i * 3 + 2])) dropsOutSkin++;
    }
    let sWall = 0, dropsWall = 0;
    if (c && c.sealed) {
      const VV = c.v, F = c.f, mh = F.length / 3, t2 = new Int32Array(mh * 3);
      for (let e = 0; e < mh * 3; e++) t2[e] = VV[F[e]];
      fl._xzBuild(t2, mh);
      for (let v = 0; v < cnt; v++) if (inn[v] === k + 1 && !outSkin[v] && !fl._xzOdd(P[v * 3], P[v * 3 + 1], P[v * 3 + 2])) sWall++;
      for (let i = 0; i < fl.n; i++) if (fl.own[i] === id && !fl._xzOdd(fl.x[i * 3], fl.x[i * 3 + 1], fl.x[i * 3 + 2])) dropsWall++;
      dropsWall -= dropsOutSkin;
    }
    return { surface: own, outSkin: sOut, outPast1cm: out1, outWorstCm: +(100 * outW).toFixed(1), outMeanCm: +(100 * outSum / Math.max(1, outN)).toFixed(1), outPast1cmY: out1 ? `${oy0.toFixed(2)}..${oy1.toFixed(2)}` : '', inWall: sWall, aboveTopCm: +(100 * worstUp).toFixed(1), drops, dropsOutSkin, dropsInWall: dropsWall, full: fl._full[k], frameOK: fl.frameOK[k], sealed: c?.sealed ? 1 : 0 };
  };

  // A cube full of liquid cut: its frame, its pieces' fits (walls: box, hollow box, open sides, cut plane), the
  // liquid's surface labels (0 the room's, k+1 its own) and drops by their side of their piece's walls
  K.cutDiag = () => {
    const a = A(), sb = a.sb, fl = a.fluid, cnt = fl.geo.drawRange.count, lab = {};
    for (let v = 0; v < cnt; v++) lab[fl.inn[v]] = (lab[fl.inn[v]] || 0) + 1;
    const tot = sb.pieces.filter(Boolean).reduce((t, p) => t + p.verts.length, 0);
    const walls = fl.walls.map((S) => {
      const sides = {};
      for (let p = 0; p < fl.n; p++) if (fl.wId[p] === S.id) sides[fl.wSide[p]] = (sides[fl.wSide[p]] || 0) + 1;
      return { id: S.id, open: S.open, cutOK: S.cutOK, errCm: +(100 * S.err).toFixed(1), rb: Array.from(S.rb).map((v) => +v.toFixed(2)), drops: sides };
    });
    return { bigN: fl._bigN ? fl._bigN[0] : null, frameOK: fl.frameOK[0], pieces: sb.pieces.filter(Boolean).map((p) => `${p.verts.length}${p.verts.length > 0.15 * tot ? '*' : ''}`), walls, labels: lab, surface: cnt, asleep: fl.asleep };
  };

  // The hollow as drawn against its shape as drawn (SoftBody.hollowRound/hollowBevel): its points' rest places as
  // JellyView draws them - worst off, how many past 5 mm, and the worst at each diagonal set of its corners
  K.hollowFit = async (o = {}) => {
    const mesh = await import('/src/sim/mesh.js');
    const a = A(), sb = a.sb, jv = a.jelly, k = o.cube ?? 0, P = jv.smRestP, K3 = jv.smK3;
    if (!P || !K3 || !sb.hollowBevel) return { none: true };
    const half = sb.cSize[k] / 2, th = sb.wallTh(k), bh = sb.hollowBevel(k), sh = sb.shapeOf(k), hb = half - th - sb.hollowRound(k) - 0.005;
    let n = 0, worst = 0, far = 0;
    const set = { even: 0, odd: 0 };
    for (let v = 0; v < sb.nV; v++) {
      if (!K3[v]) continue;
      n++;
      const x = P[v * 3] - k * 10, y = P[v * 3 + 1], z = P[v * 3 + 2], d = Math.abs(mesh.shapeSDF(x, y, z, half, bh, sh) + th);
      worst = Math.max(worst, d);
      if (d > 0.005) far++;
      if (Math.abs(x) > hb && Math.abs(y) > hb && Math.abs(z) > hb) { const s = ((x < 0) + (y < 0) + (z < 0)) % 2 ? 'odd' : 'even'; set[s] = Math.max(set[s], d); }
    }
    return { points: n, worstCm: +(100 * worst).toFixed(1), past5mm: far, evenCm: +(100 * set.even).toFixed(1), oddCm: +(100 * set.odd).toFixed(1), roundingCm: +(100 * sb.hollowRound(k)).toFixed(1) };
  };

  // The cut faces' points as JellyView draws them: kept flat (in a plane), a plane's edge, on the outside too (rim;
  // on a plane), or smoothed - and the planes found
  // (the cut faces' groups not taken for planes - as wide/long, flat, big as they are - the biggest first)
  K.cutRejects = (n = 12) => {
    const why = [];
    A().jelly._cutPlanes(A().sb, why);
    return why.sort((p, q) => q.areaCm2 - p.areaCm2).slice(0, n);
  };
  K.cutKinds = () => {
    // (a hollow's own skin - a cube full of liquid's inside, see SoftBody.sHollow - counted apart: drawn on its shape)
    const a = A(), sb = a.sb, pl = a.jelly._cutPlanes(sb), nV = sb.nV, fr = new Uint8Array(nV), ex = new Uint8Array(nV), HF = sb.sHollow, cf = new Uint8Array(nV), hw = new Uint8Array(nV);
    for (let f = 0; f < sb.nF; f++) for (let c = 0; c < 3; c++) { const v = sb.sTri[f * 3 + c]; if (sb.sTag[f] === 0) { fr[v] = 1; if (HF && HF[f] === 2) hw[v] = 1; else cf[v] = 1; } else if (sb.sTag[f] === 1) ex[v] = 1; }
    let flat = 0, edge = 0, rim = 0, rimFlat = 0, smooth = 0, n = 0, hollow = 0;
    for (let i = 0; i < nV; i++) {
      if (!fr[i]) continue;
      if (hw[i] && !cf[i]) {
        hollow++;
        continue;
      }
      n++;
      if (ex[i]) (rim++, pl.plane[i] >= 0 && rimFlat++);
      else if (pl.edge[i]) edge++;
      else if (pl.in[i]) flat++;
      else smooth++;
    }
    return { planes: pl.P.length / 4, points: n, flat, edge, rim, rimFlat, smooth, hollow };
  };

  // ---- time: each frame's, and its parts' (the sim's step, the liquid, glitter, bubbles, spill, particles, the
  // render and the jelly's drawing) - start, drive it, stop: per part mean/p50/p90/p99/max (ms) and the worst frames
  K.perfStart = () => {
    const a = A(), P = (K._perf = { recs: [], acc: {}, wrapped: [] });
    const wrap = (obj, m, label) => {
      if (!obj || typeof obj[m] !== 'function') return;
      const f = obj[m];
      P.wrapped.push([obj, m, f]);
      obj[m] = function (...args) {
        const t = performance.now(), r = f.apply(this, args);
        P.acc[label] = (P.acc[label] || 0) + performance.now() - t;
        return r;
      };
    };
    wrap(a.sb, 'step', 'sim');
    wrap(a.fluid, 'update', 'liquid');
    wrap(a.glitter, 'poolTick', 'glitterPool');
    wrap(a.glitter, 'tick', 'glitter');
    wrap(a.bubbles, 'poolTick', 'bubblesPool');
    wrap(a.bubbles, 'update', 'bubbles');
    wrap(a.spill, 'update', 'spill');
    wrap(a.particles, 'update', 'particles');
    wrap(a.jelly, 'update', 'jellyView');
    wrap(a, 'render', 'render');
    const frame = a.frame;
    P.wrapped.push([a, 'frame', frame]);
    a.frame = function (dt) {
      P.acc = {};
      const t = performance.now(), r = frame.call(this, dt);
      P.recs.push({ total: performance.now() - t, ...P.acc, pieces: a.sb.pieces.length, drops: a.fluid.n });
      return r;
    };
    return true;
  };
  K.perfStop = () => {
    const P = K._perf;
    if (!P) return null;
    for (const [obj, m, f] of P.wrapped.reverse()) obj[m] = f;
    K._perf = null;
    const R = P.recs, keys = new Set();
    for (const r of R) for (const q of Object.keys(r)) if (q !== 'pieces' && q !== 'drops') keys.add(q);
    const pc = (s, p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
    const parts = {};
    for (const q of keys) {
      const s = R.map((r) => r[q] || 0).sort((x, y) => x - y), mean = s.reduce((t, v) => t + v, 0) / Math.max(1, s.length);
      parts[q] = { mean: +mean.toFixed(2), p50: +pc(s, 0.5).toFixed(2), p90: +pc(s, 0.9).toFixed(2), p99: +pc(s, 0.99).toFixed(2), max: +pc(s, 1).toFixed(2) };
    }
    const worst = [...R].sort((x, y) => y.total - x.total).slice(0, 5).map((r) => Object.fromEntries(Object.entries(r).map(([q, v]) => [q, +(+v).toFixed(1)])));
    return { frames: R.length, parts, worst };
  };
  return K;
})();
