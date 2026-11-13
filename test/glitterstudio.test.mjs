import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCube, decodeCube, cubeSummary, encodeGlitterMix, decodeGlitterMix } from '../src/cubecode.js';
import { copyGlitterMix, glitterMain, glitterMixWords, GLITTER_SHAPES, MAX_GLITTER_MIX } from '../src/styles.js';

const mix = [
  { kind: 'gold', color: '#ff4fa3', iri: false, shape: 'heart', size: 2.4, share: 0.4 },
  { kind: 'holo', color: '#ff4fa3', iri: false, shape: 'star', size: 1.8, share: 0.3 },
  { kind: 'color', color: '#3fd0ff', iri: true, shape: 'sliver', size: 0.6, share: 0.2 },
  { kind: 'color', color: '#ff2f8e', iri: false, shape: 'sequin', size: 1, share: 0.1 },
];
const cube = { name: 'Studio', flavor: 'cherry', layers: { colors: ['#ff0000', '#00ff00', '#0000ff'], blur: 0, repeat: 1, bias: 0 }, texture: 'jello', edges: 'round', glitter: 'custom', glitterMix: mix, tune: {} };

test("a cube's own glitter survives the round trip", () => {
  const c = decodeCube(encodeCube(cube));
  assert.equal(c.glitter, 'custom');
  assert.equal(c.glitterMix.length, 4);
  c.glitterMix.forEach((g, i) => {
    const w = mix[i];
    assert.equal(g.kind, w.kind);
    assert.equal(g.shape, w.shape);
    assert.equal(g.iri, w.iri);
    if (w.kind === 'color') assert.equal(g.color, w.color);
    // (size on a log scale and share in 256ths: near enough to see no difference)
    assert.ok(Math.abs(g.size / w.size - 1) < 0.01, `size ${g.size} vs ${w.size}`);
    assert.ok(Math.abs(g.share - w.share) < 0.004, `share ${g.share} vs ${w.share}`);
  });
});

test("an older reader, not knowing j, gets the most of it", () => {
  const code = encodeCube(cube);
  assert.match(code, /~ggold~j/);
  // (as an older app reads it: j skipped)
  const old = decodeCube(code.replace(/~j[^~]*/, ''));
  assert.equal(old.glitter, 'gold');
  // (and 'custom' without its makings is nothing)
  assert.equal(decodeCube('1~fcherry~mjello~eround~gcustom').glitter, 'off');
});

test('a bad j is skipped, part by part', () => {
  assert.equal(decodeGlitterMix('zz.q9'), null);
  const m = decodeGlitterMix('g380ff.k2zzzzzzi80ff.h2c040');
  assert.deepEqual(
    m.map((g) => [g.kind, g.shape]),
    [
      ['gold', 'heart'],
      ['holo', 'star'],
    ],
  );
  // (a colour needs its colour; one of the six mustn't have one)
  assert.equal(decodeGlitterMix('k28080'), null);
  assert.equal(decodeGlitterMix('g3ff0000m8080'), null);
});

test('copyGlitterMix puts nonsense right, and never shares', () => {
  const junk = [{ kind: 'plutonium', color: 'red', shape: 'blob', size: 99, share: -3 }, null, { kind: 'cubic' }];
  const m = copyGlitterMix(junk);
  assert.deepEqual(m[0], { kind: 'silver', color: '#ff4fa3', iri: false, shape: 'hex', size: 2.8, share: 0.02 });
  assert.equal(m[1].shape, 'cube'); // (the cubic's its cubes)
  assert.equal(copyGlitterMix(null).length, 1);
  assert.equal(copyGlitterMix(Array(9).fill({ kind: 'gold' })).length, MAX_GLITTER_MIX);
  const again = copyGlitterMix(mix);
  again[0].kind = 'rose';
  assert.equal(mix[0].kind, 'gold');
  assert.equal(GLITTER_SHAPES[0].id, 'hex'); // (j's shape digits are places in this list: never reorder it)
});

test('what a mix is called', () => {
  assert.equal(glitterMain(mix), 'gold');
  assert.equal(glitterMain([{ kind: 'color', color: '#3fd0ff', iri: true, share: 1 }]), 'holo');
  assert.equal(glitterMixWords(mix), 'Gold hearts, holo stars and more');
  assert.match(cubeSummary({ ...cube }), /Gold hearts, holo stars and more glitter/);
  assert.equal(encodeGlitterMix(mix).split('.').length, 4);
});
