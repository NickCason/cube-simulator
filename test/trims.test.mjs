// edge trims: kept in a cube's code (and left out when plain), in the bake shader
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRIMS, TRIM, DEFAULT_STYLE } from '../src/styles.js';
import { SURF_BAKE_GLSL } from '../src/surfaces.js';
import { encodeCube, decodeCube } from '../src/cubecode.js';

test('every trim is listed once, plain first, each numbered by its place', () => {
  assert.equal(TRIMS[0].id, 'none');
  assert.equal(new Set(TRIMS.map((t) => t.id)).size, TRIMS.length);
  TRIMS.forEach((t, i) => assert.equal(TRIM[t.id].index, i, t.id));
  assert.equal(DEFAULT_STYLE.trim, 'none');
  assert.match(SURF_BAKE_GLSL, /float sfTrim\(/);
});

test('a trim goes round in a cube code; plain adds nothing; a strange one is plain', () => {
  const base = { name: 'Pie', flavor: DEFAULT_STYLE.flavor, texture: DEFAULT_STYLE.texture, edges: DEFAULT_STYLE.edges };
  for (const t of TRIMS) {
    const code = encodeCube({ ...base, trim: t.id });
    assert.equal(decodeCube(code).trim, t.id, code);
    if (t.id === 'none') assert.ok(!/~x/.test(code), code);
  }
  const odd = encodeCube({ ...base, trim: 'crimped' }).replace('~xcrimped', '~xwiggly');
  assert.equal(decodeCube(odd).trim, 'none');
});
