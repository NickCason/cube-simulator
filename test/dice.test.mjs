// dice: a die's faces, its bake, and the picture of what it rolled
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIE_FACES, SURFACE, surfaceBakeGLSL, surfaceHeight } from '../src/surfaces.js';
import { dieFaceSVG } from '../src/dice.js';

test('a die: one to six, opposite faces making seven', () => {
  assert.deepEqual([...DIE_FACES].sort(), [1, 2, 3, 4, 5, 6]);
  for (let a = 0; a < 3; a++) assert.equal(DIE_FACES[a * 2] + DIE_FACES[a * 2 + 1], 7);
  // (one to three anticlockwise round their corner: 1 +z, 2 +y, 3 -x)
  assert.equal(DIE_FACES[4], 1);
  assert.equal(DIE_FACES[2], 2);
  assert.equal(DIE_FACES[1], 3);
});

test('its surface: each face its own pips, inked; its swatch a five', () => {
  const s = SURFACE.dice;
  assert.equal(s.fam, 'face');
  assert.ok(s.ink);
  const g = surfaceBakeGLSL(s.kind);
  assert.match(g, /float sfPips\(int n, vec2 q\)/);
  assert.match(g, new RegExp(`if \\(k == ${s.kind}\\) return sfFace\\(k, f, `));
  // (the swatch: pits at the middle and the four corners, flat between)
  assert.ok(surfaceHeight('dice', 0.5, 0.5) < 0.1);
  assert.ok(surfaceHeight('dice', 0.25, 0.25) < 0.1);
  assert.equal(surfaceHeight('dice', 0.5, 0.25), 1);
});

test('what it rolled, as a little die', () => {
  for (let n = 1; n <= 6; n++) assert.equal((dieFaceSVG(n).match(/<circle/g) || []).length, n);
});
