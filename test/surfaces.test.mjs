// surface maps: kept in a cube's code, fitted to its faces, in the shader,
// handed down, and in its names
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SURFACES, SURFACE, SURF_GLSL, surfaceFit, surfaceHeight, surfaceWord } from '../src/surfaces.js';
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

test('the shader has every surface, by its place in the list', () => {
  SURFACES.forEach((s, i) => {
    if (!s.glsl) return;
    assert.ok(SURF_GLSL.includes(`if (k == ${i}) {`), s.id);
  });
  for (const id of ['swiss', 'sponge']) assert.ok(SURF_GLSL.includes(`k == ${SURFACE[id].kind}`), id);
  assert.ok(!/\?[^:;]*atan\(/.test(SURF_GLSL), 'no atan in a ternary (one GPU took the wrong side)');
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
