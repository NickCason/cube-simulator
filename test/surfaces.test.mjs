// surface maps: kept in a cube's code, fitted to its faces, in the shader,
// handed down, and in its names
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SURFACES, SURFACE, SURF_GLSL, SURF_BAKE_GLSL, surfaceBakeGLSL, surfaceFit, surfaceHeight, surfaceWord, surfaceSites, unfoldInv } from '../src/surfaces.js';
import { encodeCube, decodeCube, cubeSummary } from '../src/cubecode.js';
import { mutate } from '../src/genetics.js';
import { nameCube, seeded } from '../src/namegen.js';
import { DEFAULT_STYLE } from '../src/styles.js';

test('every surface has what it needs, and a height that stays in range', () => {
  assert.equal(new Set(SURFACES.map((s) => s.id)).size, SURFACES.length);
  assert.equal(SURFACES[0].id, 'none');
  for (const s of SURFACES.slice(1)) {
    assert.ok(s.name && s.density > 0 && s.depth > 0 && s.glsl && s.js, s.id);
    assert.ok(s.words && s.words[0].length && s.words[1].length, s.id);
    for (let i = 0; i < 400; i++) {
      const h = surfaceHeight(s.id, (i % 20) * 0.137 + 0.01, Math.floor(i / 20) * 0.211 + 0.02);
      assert.ok(Number.isFinite(h) && h >= -0.01 && h <= 1.01, `${s.id} ${h}`);
    }
  }
});

test('the shaders have every surface, by its place in the list: face ones baked, holes worked out', () => {
  SURFACES.forEach((s, i) => {
    if (!s.glsl) return;
    // (a face one's own code is in the bake; a through one's, in the shaders that draw it)
    assert.ok((s.through ? SURF_GLSL : SURF_BAKE_GLSL).includes(`if (k == ${i}) {`), s.id);
  });
  for (const id of ['swiss', 'sponge']) assert.ok(SURF_GLSL.includes(`k == ${SURFACE[id].kind}`), id);
  for (const g of [SURF_GLSL, SURF_BAKE_GLSL]) assert.ok(!/\?[^:;]*atan\(/.test(g), 'no atan in a ternary (one GPU took the wrong side)');
});

test('each is laid on the cube one seamless way: its family, and what that needs', () => {
  for (const s of SURFACES.slice(1)) {
    assert.ok(['sites', 'grid', 'rings', 'noise', 'holes', 'face'].includes(s.fam), s.id);
    assert.equal(s.fam === 'holes', !!s.through, s.id);
    // (a grid or rings one: a form, whole repeats of it a face; a sites one: spread)
    if (s.fam === 'grid' || s.fam === 'rings') assert.ok(s.period, s.id);
    if (s.fam === 'sites') assert.ok(s.relax || s.minD > 0, s.id);
    // (the bake picks it out by family)
    if (s.fam !== 'holes') assert.match(SURF_BAKE_GLSL, new RegExp(`if \\(k == ${SURFACES.indexOf(s)}\\) return sf`), s.id);
  }
});

test('a cube’s bake has only its own pattern in it', () => {
  for (const s of SURFACES.filter((x) => x.fam && x.fam !== 'holes')) {
    const k = SURFACES.indexOf(s), g = surfaceBakeGLSL(k), ks = new Set((g.match(/k == (\d+)/g) || []).map((m) => +m.slice(5)));
    assert.deepEqual([...ks], [k], s.id);
    assert.ok(g.length < SURF_BAKE_GLSL.length * 0.75, s.id);
  }
});

test('a face unfolded: its middle out along its own axis, its edges round the bevel, its corners shared', () => {
  const hs = 0.5, b = 0.13, L = 2 * hs - b * (2 - Math.PI / 2), out = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let f = 0; f < 6; f++) {
    const p = unfoldInv(hs, b, f, 0, 0);
    assert.deepEqual(p.map((c) => Math.round(c * 1e6) / 1e6 + 0), out[f].map((c) => c * hs + 0), `face ${f}`);
    // (on the surface everywhere)
    for (const [u, v] of [[0.3, -0.2], [L / 2, 0.1], [-L / 2, L / 2], [0.47, -0.47]]) {
      const q = unfoldInv(hs, b, f, u, v), fl = hs - b, d = Math.hypot(...q.map((c) => c - Math.max(-fl, Math.min(fl, c))));
      assert.ok(Math.abs(d - b) < 1e-9, `face ${f} at ${u},${v}: ${d}`);
    }
  }
  // (a face's right edge is the front's neighbour's left: the same points)
  const a = unfoldInv(hs, b, 4, L / 2, 0.2), c = unfoldInv(hs, b, 0, -L / 2, 0.2);
  assert.ok(Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]) < 1e-9);
  // (the top's front edge, the front's top)
  const t = unfoldInv(hs, b, 2, 0.1, -L / 2), fr = unfoldInv(hs, b, 4, 0.1, L / 2);
  assert.ok(Math.hypot(t[0] - fr[0], t[1] - fr[1], t[2] - fr[2]) < 1e-9);
  // (a corner: three faces' corners, one point)
  const c1 = unfoldInv(hs, b, 4, L / 2, L / 2), c2 = unfoldInv(hs, b, 0, -L / 2, L / 2), c3 = unfoldInv(hs, b, 2, L / 2, -L / 2);
  assert.ok(Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]) < 1e-9 && Math.hypot(c1[0] - c3[0], c1[1] - c3[1], c1[2] - c3[2]) < 1e-9);
});

test('the sites: on the rounded cube, spread evenly, the same each time', () => {
  for (const [hs, b] of [[0.5, 0.065], [0.5, 0.225], [0.5, 0.005], [0.35, 0.1]]) {
    const fl = hs - b, sp = (2 * hs - b * (2 - Math.PI / 2)) / 6;
    for (const opt of [{ relax: true }, { minD: 0.45 }]) {
      const S = surfaceSites(hs, b, sp, { ...opt, seed: 3 }), n = S.length / 4;
      // (as many as the area holds)
      const area = 24 * fl * fl + 12 * Math.PI * b * fl + 4 * Math.PI * b * b;
      const want = area / (sp * sp * (opt.relax ? 0.866 : 1));
      // (relaxed: a lattice to start, a whole number of cells a face - near enough)
      assert.ok(opt.relax ? n > want * 0.85 && n < want * 1.12 : n > want * 0.8 && n <= want * 1.01, `${hs} ${b} ${n} of ${want}`);
      let near = Infinity, sum = 0, sum2 = 0;
      for (let i = 0; i < n; i++) {
        const p = [S[i * 4], S[i * 4 + 1], S[i * 4 + 2]];
        // (on the surface: as far from the core box as the rounding)
        const q = p.map((c) => c - Math.max(-fl, Math.min(fl, c))), d = Math.hypot(...q);
        assert.ok(Math.abs(d - b) < 1e-4 || (b < 0.01 && Math.max(...p.map(Math.abs)) > hs - 1e-4), `${p} off by ${d - b}`);
        assert.ok(S[i * 4 + 3] >= 0 && S[i * 4 + 3] < 1);
        let nn = Infinity;
        for (let j = 0; j < n; j++) if (j !== i) nn = Math.min(nn, Math.hypot(S[j * 4] - p[0], S[j * 4 + 1] - p[1], S[j * 4 + 2] - p[2]));
        near = Math.min(near, nn);
        sum += nn;
        sum2 += nn * nn;
      }
      const mean = sum / n, cv = Math.sqrt(Math.max(0, sum2 / n - mean * mean)) / mean;
      if (opt.relax) assert.ok(near > 0.5 * sp && cv < 0.12, `relaxed: nearest ${near / sp}, spread ${cv}`);
      else assert.ok(near >= 0.45 * sp * 0.999, `${near / sp}`);
      assert.deepEqual(surfaceSites(hs, b, sp, { ...opt, seed: 3 }), S);
    }
  }
});

test('a formed pattern fits a whole number of its repeats on a face', () => {
  for (const s of SURFACES.filter((x) => x.period)) {
    for (const scale of [0.4, 0.7, 1, 1.6, 2.5]) {
      const [nu, nv] = surfaceFit(s, s.density / scale), [pu, pv] = s.period;
      const whole = (n, p) => Math.abs(n / p - Math.round(n / p)) < 1e-9 && n >= p - 1e-9;
      assert.ok(whole(nu, pu), `${s.id} across ${nu}`);
      if (pv) assert.ok(whole(nv, pv), `${s.id} up ${nv}`);
      // (the same repeat both ways: the same count both ways, so it meets the top round every edge)
      if (pv === pu || !pv) assert.equal(nu, nv, s.id);
    }
  }
  // (the others: as asked)
  assert.deepEqual(surfaceFit(SURFACE.hammered, 6.3), [6.3, 6.3]);
});

test('a cube keeps its surface in its code; an unknown one is smooth', () => {
  const c = decodeCube('1~fcherry~mjello~eround');
  assert.equal(c.surface, 'none');
  c.surface = 'honeycomb';
  c.tune = { surfDepth: 1.8, surfScale: 0.7 };
  const code = encodeCube(c), back = decodeCube(code);
  assert.match(code, /~shoneycomb(~|$)/);
  assert.equal(back.surface, 'honeycomb');
  assert.ok(Math.abs(back.tune.surfDepth - 1.8) < 0.01 && Math.abs(back.tune.surfScale - 0.7) < 0.01);
  assert.match(cubeSummary(back), /Honeycomb/);
  assert.equal(decodeCube('1~fcherry~mjello~eround~snope').surface, 'none');
  assert.equal(surfaceWord('none'), '');
});

test('handed down, now and then changed', () => {
  const rnd = seeded(11), seen = new Set();
  let kept = 0;
  for (let k = 0; k < 3000; k++) {
    const style = { ...DEFAULT_STYLE, surface: k % 2 ? 'scales' : 'none' };
    const changes = mutate(style, {}, { rnd, gen: k % 7 });
    assert.ok(SURFACE[style.surface], style.surface);
    const ch = changes.filter((c) => c.kind === 'surface');
    for (const c of ch) seen.add(c.label.replace(/[^!]*!$/, 'X!'));
    if (k % 2 && !ch.length) kept += style.surface === 'scales' ? 1 : 0;
  }
  assert.ok(kept > 1300, 'a child mostly has its parent’s');
  assert.ok(seen.size >= 2, [...seen].join());
});

test('its names know what it’s moulded like', () => {
  const c = decodeCube('1~flime~mjello~eround~sswiss');
  const words = new Set(SURFACE.swiss.words.flat());
  const rnd = seeded(5);
  let hits = 0;
  for (let i = 0; i < 300; i++) if ([...words].some((w) => nameCube(c, { rnd }).includes(w))) hits++;
  assert.ok(hits >= 15, `surface words in ${hits} of 300`);
});
