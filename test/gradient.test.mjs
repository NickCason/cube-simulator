import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradAt, gradColorAt, gradT, gradStops, gradCSSStops, copyLayers, biasExp, resolveFlavor } from '../src/styles.js';

const rgb = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];

test('evenly spaced stops are the bands they always were', () => {
  // (the old maths: band k of n x repeat, by height crowded by the bias)
  const old = (t, f) => {
    const n = f.layers.length, m = n * (f.repeat || 1);
    const h = Math.pow(Math.min(1, Math.max(0, t)), biasExp(f.bias));
    return f.layers[Math.min(m - 1, Math.floor(h * m)) % n];
  };
  for (const repeat of [1, 3, 6])
    for (const bias of [0, 0.6, -0.8, 1]) {
      const f = { layers: rgb, blur: 0, repeat, bias };
      const m = rgb.length * repeat;
      for (let i = 1; i < 1000; i++) {
        const t = i / 1000, fr = (Math.pow(t, biasExp(bias)) * m) % 1;
        if (fr < 0.03 || fr > 0.97) continue; // (right on an edge: blended)
        assert.equal(gradColorAt(f, t), old(t, f), `repeat ${repeat} bias ${bias} t ${t}`);
      }
    }
});

test('stops: a colour is itself at its stop, blends toward the next, holds past the ends', () => {
  const f = { layers: rgb, blur: 1, stops: [0.1, 0.2, 0.6, 0.9] };
  assert.equal(gradColorAt(f, 0.02), '#ff0000');
  assert.equal(gradColorAt(f, 0.2), '#00ff00');
  assert.equal(gradColorAt(f, 0.97), '#ffff00');
  const mid = gradAt(f, 0.4);
  assert.deepEqual([mid.a, mid.b], [1, 2]);
  assert.ok(Math.abs(mid.s - 0.5) < 1e-9);
  // (two stops in one place: a hard edge there, whatever the blend)
  const e = { layers: rgb, blur: 1, stops: [0.2, 0.5, 0.5, 0.8] };
  assert.equal(gradColorAt(e, 0.499), gradColorAt({ ...e }, 0.499));
  assert.equal(gradAt(e, 0.51).a, 2);
});

test('shapes: where a rest point sits along each', () => {
  const s = 1;
  assert.equal(gradT('up', 0, -0.5, 0, s), 0);
  assert.equal(gradT('up', 0, 0.5, 0, s), 1);
  assert.equal(gradT('across', 0.5, 0, 0, s), 1);
  assert.equal(gradT('corner', -0.5, -0.5, -0.5, s), 0);
  assert.equal(gradT('corner', 0.5, 0.5, 0.5, s), 1);
  assert.equal(gradT('core', 0, 0, 0, s), 0);
  assert.equal(gradT('core', 0, 0, 0.5, s), 1); // (the middle of a face)
  assert.equal(gradT('shell', 0.25, -0.5, 0.1, s), 1); // (anywhere on the skin)
  assert.equal(gradT('rings', 0, 0.4, 0.25, s), 0.5); // (up the axis: no matter)
});

test('copies and resolving keep stops only when they fit; CSS is ordered', () => {
  const L = copyLayers({ colors: rgb, stops: [0.1, 0.2, 0.3], shape: 'shell' });
  assert.equal(L.stops, null);
  assert.equal(L.shape, 'shell');
  assert.equal(copyLayers({ colors: rgb, shape: 'nope' }).shape, 'up');
  const f = resolveFlavor({ flavor: 'layers', layers: { colors: rgb, stops: [0, 0.4, 0.5, 1] } });
  assert.deepEqual(gradStops(f), [0, 0.4, 0.5, 1]);
  const pcts = [...gradCSSStops({ ...f, blur: 0.3 }).matchAll(/ ([\d.]+)%/g)].map((m) => +m[1]);
  assert.ok(pcts.every((p, i) => !i || p >= pcts[i - 1] - 1e-9), pcts.join(' '));
});
