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

test('freeform: a point is its own colour, between two they blend; the net maps both ways', async () => {
  const { freeColorAt, netOf, NET, bakeFree, FREE_N, freeNodesDefault } = await import('../src/freeform.js');
  const f = { layers: ['#ff0000', '#0000ff'], blur: 0.5, nodes: [{ x: 0, y: 0, z: 0.5, k: 1 }, { x: 0, y: 0, z: -0.5, k: 1 }] };
  assert.equal(freeColorAt(f, 0, 0, 0.5), '#ff0000');
  assert.equal(freeColorAt(f, 0, 0, -0.5), '#0000ff');
  assert.equal(freeColorAt(f, 0, 0, 0), '#800080');
  // (stronger: its colour reaches further)
  const g = { ...f, nodes: [{ ...f.nodes[0], k: 4 }, f.nodes[1]] };
  assert.ok(parseInt(freeColorAt(g, 0, 0, 0).slice(1, 3), 16) > 0xc0);
  for (let fi = 0; fi < 6; fi++)
    for (const [u, v] of [[0.2, 0.3], [0.5, 0.5], [0.9, 0.7]]) {
      const [x, y, z] = NET[fi].p(u, v), r = netOf(x, y, z);
      assert.deepEqual([r.f, +r.u.toFixed(9), +r.v.toFixed(9)], [fi, u, v]);
    }
  const grid = bakeFree(f);
  assert.equal(grid.length, FREE_N ** 3 * 4);
  assert.equal(freeNodesDefault(7).length, 7);
  for (const q of freeNodesDefault(9)) assert.ok(Math.abs(Math.max(Math.abs(q.x), Math.abs(q.y), Math.abs(q.z)) - 0.5) < 1e-9);
});

test('freeform points survive a CubeR code', async () => {
  const { encodeCube, decodeCube } = await import('../src/cubecode.js');
  const layers = { colors: ['#ff0000', '#00ff00', '#0000ff'], blur: 0.4, repeat: 1, bias: 0, shape: 'free', nodes: [{ x: -0.5, y: 0.1, z: 0.3, k: 1 }, { x: 0.2, y: 0.5, z: -0.2, k: 3.2 }, { x: 0, y: 0, z: 0, k: 0.25 }] };
  const code = encodeCube({ name: 'F', flavor: 'layers', layers, texture: 'jello', edges: 'round', glitter: 'off', tune: {} });
  assert.match(code, /~hfree~q[0-9a-f]{24}~/);
  const c = decodeCube(code);
  assert.equal(c.layers.shape, 'free');
  c.layers.nodes.forEach((q, i) => {
    for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(q[k] - layers.nodes[i][k]) <= 0.5 / 255 + 1e-9, `${k} ${q[k]}`);
    assert.ok(Math.abs(Math.log(q.k / layers.nodes[i].k)) < 0.02, `k ${q.k}`);
  });
});
