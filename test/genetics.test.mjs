import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mutate, topTier, randomGradient, randomPalette, TIER } from '../src/genetics.js';
import { TEXTURES, EDGES, GLITTERS, MIN_LAYERS, MAX_LAYERS, DEFAULT_STYLE, copyLayers } from '../src/styles.js';

// (a seeded random source - mulberry32: neighbouring seeds don't start alike)
function rng(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('children always come out valid cubes, and some come out as something new', () => {
  const tiers = [0, 0, 0, 0];
  for (let k = 0; k < 600; k++) {
    const style = { ...DEFAULT_STYLE, flavor: k % 3 ? 'cherry' : 'layers', layers: copyLayers(DEFAULT_STYLE.layers), glitter: 'off' };
    if (k % 5 === 0) style.layers.shape = 'free';
    const tune = { size: 1 };
    const changes = mutate(style, tune, { rnd: rng(k + 1), gen: k % 7 });
    tiers[topTier(changes)]++;
    assert.ok(changes.length >= 1, 'something drifts');
    assert.ok(TEXTURES[style.texture], style.texture);
    assert.ok(EDGES[style.edges], style.edges);
    assert.ok(GLITTERS.some((g) => g.id === style.glitter), style.glitter);
    if (style.flavor === 'layers') {
      const L = style.layers;
      assert.ok(L.colors.length >= MIN_LAYERS && L.colors.length <= MAX_LAYERS);
      assert.ok(L.colors.every((c) => /^#[0-9a-f]{6}$/.test(c)), L.colors.join());
      if (L.stops) assert.equal(L.stops.length, L.colors.length);
      if (L.nodes) assert.equal(L.nodes.length, L.colors.length);
    } else if (style.flavor !== 'rubik') assert.match(style.flavor, /^#[0-9a-f]{6}$/);
    for (const v of Object.values(tune)) assert.ok(Number.isFinite(v));
  }
  // (mostly drift and mutation; majors now and then; a legend rarely)
  assert.ok(tiers[TIER.MAJOR] > 20, `majors ${tiers}`);
  assert.ok(tiers[TIER.LEGENDARY] > 2 && tiers[TIER.LEGENDARY] < 60, `legends ${tiers}`);
});

test('the die: palettes and gradients in every shape', () => {
  for (const shape of ['up', 'across', 'corner', 'core', 'shell', 'rings', 'free']) {
    const g = copyLayers(randomGradient(shape, rng(shape.length * 7)));
    assert.equal(g.shape, shape);
    assert.ok(g.colors.length >= 2);
    if (shape === 'free') assert.equal(g.nodes.length, g.colors.length);
  }
  assert.equal(randomPalette(7, rng(3)).length, 7);
});
