// googly eyes: kept in a code, made good from anywhere, mirrored across their
// face, and handed down (changed now and then, never one over another)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EYE_STYLES, EYE_R_MIN, EYE_R_MAX, MAX_EYES, copyEyes, encodeEyes, decodeEyes, onSurface, eyeFrame, mirrorEye, spread, eyesWord } from '../src/eyes.js';
import { encodeCube, decodeCube, cubeSummary } from '../src/cubecode.js';
import { mutate } from '../src/genetics.js';
import { seeded } from '../src/namegen.js';
import { DEFAULT_STYLE } from '../src/styles.js';

const near = (a, b, tol = 0.004) => Math.abs(a - b) <= tol;
const pair = [
  { x: -0.2, y: 0.12, z: 0.5, r: 0.085, s: 0, p: 1 },
  { x: 0.2, y: 0.12, z: 0.5, r: 0.085, s: 0, p: 1 },
];

test('eyes survive their code, near enough', () => {
  const eyes = [...pair, { x: 0.5, y: -0.1, z: 0.05, r: 0.21, s: 5, p: 0 }, { x: 0.1, y: 0.5, z: -0.3, r: 0.031, s: 3, p: 2 }];
  const back = decodeEyes(encodeEyes(eyes));
  assert.equal(back.length, eyes.length);
  eyes.forEach((e, i) => {
    for (const k of ['x', 'y', 'z']) assert.ok(near(back[i][k], e[k]), `${k} ${back[i][k]} ${e[k]}`);
    assert.ok(near(back[i].r, e.r, 0.001), 'r');
    assert.equal(back[i].s, e.s);
    assert.equal(back[i].p, e.p);
  });
});

test('eyes made good: junk dropped, clamped, no more than the most', () => {
  assert.deepEqual(copyEyes(null), []);
  assert.deepEqual(copyEyes('eyes'), []);
  const out = copyEyes([null, { x: 'a' }, { x: 2, y: -3, z: 0.5, r: 9, s: 99, p: -4 }, ...Array.from({ length: 30 }, () => pair[0])]);
  assert.equal(out.length, MAX_EYES);
  assert.deepEqual(out[0], { x: 0.5, y: -0.5, z: 0.5, r: EYE_R_MAX, s: EYE_STYLES.length - 1, p: 0 });
  assert.ok(copyEyes([{ x: 0, y: 0, z: 0.5, r: 0 }])[0].r === EYE_R_MIN);
  assert.deepEqual(decodeEyes('zz'), []);
});

test('a cube code keeps its eyes; one without has none', () => {
  const c = decodeCube('1~fcherry~mjello~eround');
  assert.deepEqual(c.eyes, []);
  c.eyes = pair;
  const code = encodeCube(c), back = decodeCube(code);
  assert.match(code, /~y[0-9a-f]{20}(~|$)/);
  assert.equal(back.eyes.length, 2);
  assert.match(cubeSummary(back), /2 googly eyes/);
  assert.equal(eyesWord([pair[0]]), 'A cyclops eye');
});

test('on the surface: out the nearest face, round the edges', () => {
  const b = 0.1;
  const f = onSurface([0.1, 0.05, 0.3], b);
  assert.deepEqual(f.n, [0, 0, 1]);
  assert.ok(near(f.p[2], 0.5, 1e-9));
  const c = onSurface([0.6, 0.6, 0], b); // (an edge: rounded)
  assert.ok(near(c.n[0], Math.SQRT1_2, 1e-9) && near(c.n[1], Math.SQRT1_2, 1e-9));
  assert.ok(near(Math.hypot(c.p[0] - 0.4, c.p[1] - 0.4), b, 1e-9));
});

test('a pair mirrors across its face: front, top, side', () => {
  const b = 0.12;
  const front = mirrorEye({ x: -0.2, y: 0.1, z: 0.5, r: 0.08, s: 0, p: 1 }, b);
  assert.ok(near(front.x, 0.2) && near(front.y, 0.1) && near(front.z, 0.5));
  const top = mirrorEye({ x: -0.2, y: 0.5, z: 0.1, r: 0.08, s: 0, p: 1 }, b);
  assert.ok(near(top.x, 0.2) && near(top.z, 0.1));
  const side = mirrorEye({ x: 0.5, y: 0.1, z: -0.2, r: 0.08, s: 0, p: 1 }, b);
  assert.ok(near(side.z, 0.2) && near(side.x, 0.5));
  // (up the cube on its sides; away from the front on top)
  assert.deepEqual(eyeFrame([0, 0, 1]).up, [0, 1, 0]);
  assert.deepEqual(eyeFrame([0, 1, 0]).up.map((v) => v + 0), [0, 0, -1]);
  // (on the middle line: pushed apart, so the two don't sit on each other)
  const s = spread({ x: 0.01, y: 0, z: 0.5, r: 0.08, s: 0, p: 0 }, b, 0.1);
  assert.ok(near(s.x, 0.1));
});

test('handed down: always theirs, changed now and then, never one over another', () => {
  const rnd = seeded(7);
  const seen = new Set();
  for (let k = 0; k < 4000; k++) {
    const style = { ...DEFAULT_STYLE, eyes: copyEyes(k % 3 ? pair : []) };
    const changes = mutate(style, {}, { rnd, gen: k % 9 });
    const eyes = style.eyes;
    for (const c of changes) if (c.kind === 'eyes') seen.add(c.label);
    assert.ok(eyes.length <= MAX_EYES);
    if (k % 3 && !changes.some((c) => c.kind === 'eyes')) assert.equal(eyes.length, 2, 'a child has its parent’s eyes');
    for (let i = 0; i < eyes.length; i++)
      for (let j = i + 1; j < eyes.length; j++) {
        const a = eyes[i], o = eyes[j];
        assert.ok(Math.hypot(a.x - o.x, a.y - o.y, a.z - o.z) >= (a.r + o.r) * 1.02 - 1e-9, 'one over another');
      }
    for (const e of eyes) if (e.p) assert.equal(eyes.filter((o) => o.p === e.p).length, 2, 'a pair is two');
  }
  for (const l of ['A third eye!', 'Cyclops!', 'Bigger eyes', 'Smaller eyes', 'A wandering eye']) assert.ok(seen.has(l), l);
  assert.ok([...seen].every((l) => !/ eyes eyes|Lashes eyes|pupils eyes/.test(l)), [...seen].join());
});

test('a special with a face comes with it, kept in its code', async () => {
  const { SPECIALS } = await import('../src/specials.js');
  const { specialCube } = await import('../src/cotd.js');
  const { EYE_FACES } = await import('../src/eyes.js');
  const faced = SPECIALS.filter((s) => s.eyes);
  assert.ok(faced.length >= 5);
  for (const sp of faced) {
    assert.ok(EYE_FACES[sp.eyes], sp.id);
    const c = specialCube(sp, seeded(3)), back = decodeCube(encodeCube(c));
    assert.equal(back.eyes.length, EYE_FACES[sp.eyes].length, sp.id);
  }
  assert.deepEqual(specialCube(SPECIALS.find((s) => !s.eyes), seeded(3)).eyes, []);
  for (const [k, list] of Object.entries(EYE_FACES))
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) assert.ok(Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y) >= (list[i].r + list[j].r) * 1.02, k);
});
