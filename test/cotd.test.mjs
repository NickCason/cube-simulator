// the cube of the day: off the menu, the same for everyone, the days it's for
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubeOfTheDay, specialOn, specialCube, eventsOn } from '../src/cotd.js';
import { SPECIALS } from '../src/specials.js';
import { seeded } from '../src/namegen.js';
import { encodeCube, decodeCube } from '../src/cubecode.js';

test('every special makes a cube that survives its code, its name and all', () => {
  assert.equal(new Set(SPECIALS.map((s) => s.id)).size, SPECIALS.length);
  for (const sp of SPECIALS) {
    assert.ok(sp.names.length && sp.note && sp.mat, sp.id);
    for (const n of sp.names) assert.ok(n.length >= 3 && n.length <= 30, n);
    for (let k = 1; k <= 3; k++) {
      const c = specialCube(sp, seeded(k)), back = decodeCube(encodeCube(c));
      assert.ok(back, sp.id);
      assert.equal(back.name, c.name, sp.id);
      assert.equal(back.texture, c.texture, sp.id);
      if (c.flavor === 'layers') {
        assert.equal(back.layers.colors.length, c.layers.colors.length, sp.id);
        assert.equal(back.layers.shape || 'up', c.layers.shape || 'up', sp.id);
      }
    }
  }
});

test('the same day, the same cube; the next day, another', () => {
  const a = cubeOfTheDay(new Date(2027, 4, 12, 9)), b = cubeOfTheDay(new Date(2027, 4, 12, 21)), c = cubeOfTheDay(new Date(2027, 4, 13, 9));
  assert.equal(encodeCube(a), encodeCube(b));
  assert.equal(a.special, b.special);
  assert.notEqual(a.special, c.special);
  assert.ok(a.note && a.name);
});

test('a season goes through its whole menu before anything comes round again', () => {
  for (const [y, m] of [[2027, 2], [2027, 5], [2027, 8], [2027, 11]]) {
    const seen = new Set();
    for (let d = 1; d <= 28 * 3; d++) {
      const day = new Date(y, m, d, 12), sp = specialOn(day);
      if (sp.when) continue;
      assert.ok(!seen.has(sp.id), `${sp.id} twice by ${day.toDateString()}`);
      seen.add(sp.id);
    }
  }
});

test('the days that are for something get their own', () => {
  const on = (y, m, d) => specialOn(new Date(y, m - 1, d, 12));
  assert.equal(on(2027, 10, 31).when, 'halloween');
  assert.equal(on(2027, 12, 25).when, 'christmas');
  assert.equal(on(2028, 1, 1).when, 'newyear');
  assert.equal(on(2027, 3, 14).when, 'piday');
  assert.equal(on(2027, 4, 1).when, 'fools');
  assert.equal(on(2027, 3, 28).when, 'easter'); // (Easter 2027)
  assert.equal(on(2027, 2, 9).when, 'pancake'); // (47 days before)
  assert.equal(on(2027, 2, 6).when, 'lunar');
  assert.ok(eventsOn(new Date(2027, 7, 13)).some(([t]) => t === 'friday13'));
  // (an ordinary day: the season's menu)
  assert.ok(!on(2027, 5, 12).when || on(2027, 5, 12).when === 'spring');
});
