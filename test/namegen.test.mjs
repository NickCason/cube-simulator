import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameCube, seeded, cubeTraits } from '../src/namegen.js';
import { decodeCube } from '../src/cubecode.js';

const rubber = decodeCube('1~fblue~mrubber~esharp~ggold');
const slime = decodeCube('1~flime~mslime~epillow');

test('the same cube and seed give the same names', () => {
  const a = seeded(7), b = seeded(7);
  for (let i = 0; i < 50; i++) assert.equal(nameCube(rubber, { rnd: a }), nameCube(rubber, { rnd: b }));
});

test('names are tidy, the right length, and never repeat what is taken', () => {
  const rnd = seeded(123);
  for (const c of [rubber, slime, decodeCube('1~c19b5a8~mglass'), decodeCube('1~flayers~l7b22d61572ff~msyrup'), decodeCube('1~fcherry')]) {
    const taken = [];
    for (let i = 0; i < 300; i++) {
      const n = nameCube(c, { rnd, taken, rec: { healed: 20, booms: 9 } });
      assert.ok(!/undefined|NaN|[{}]|\s\s/.test(n), n);
      assert.ok(n.length >= 3 && n.length <= 34, n);
      assert.ok(!taken.map((t) => t.toLowerCase()).includes(n.toLowerCase()), n);
      taken.push(n);
    }
  }
});

test('a bouncy cube is named for bouncing more than a slimy one is', () => {
  const bouncy = /Bounc|Boing|Spring|Pogo|Hop|Rebound|Ricochet|Kangaroo|Superball/;
  const count = (c) => {
    const rnd = seeded(99);
    let n = 0;
    for (let i = 0; i < 600; i++) if (bouncy.test(nameCube(c, { rnd }))) n++;
    return n;
  };
  assert.ok(cubeTraits(rubber).T.bouncy > cubeTraits(slime).T.bouncy);
  assert.ok(count(rubber) > count(slime) * 2, `${count(rubber)} vs ${count(slime)}`);
});
