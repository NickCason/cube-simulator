import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCube, decodeCube, findCode, cubeLink, TUNE_CODES, SOUND_KEYS } from '../src/cubecode.js';
import { SETTINGS } from '../src/settings.js';
import { cubeName } from '../src/puns.js';
import { qrEncode, qrCapacity } from '../src/ui/qr.js';

const near = (a, b) => Math.abs(a - b) <= Math.abs(b) * 5e-4 + 1e-9;

const full = {
  name: 'Grape “Escape” ~ 100% é 🎲 _x_',
  flavor: 'layers',
  layers: { colors: ['#3a0ca3', '#7209b7', '#f72585', '#ff6d00', '#ffbe0b'], blur: 0.35, repeat: 2, bias: -0.3 },
  texture: 'gummy',
  edges: 'pillow',
  glitter: 'holo',
  tune: { mu: 432.123, damping: 3.4, goo: 0.8, bubbles: 120, gravity: 9.8, size: 1.2, airDrag: 0.05, rigidity: 0.333333 },
  tear: false,
  theme: 'dark',
};

test('a cube survives the round trip', () => {
  const c = decodeCube(encodeCube(full));
  assert.equal(c.name, 'Grape “Escape” - 100% é 🎲 _x_'); // (a ~ in a name becomes -)
  assert.equal(c.flavor, 'layers');
  assert.deepEqual(c.layers, full.layers);
  assert.equal(c.texture, 'gummy');
  assert.equal(c.edges, 'pillow');
  assert.equal(c.glitter, 'holo');
  assert.equal(c.tear, false);
  assert.equal(c.theme, 'dark');
  assert.deepEqual(Object.keys(c.tune).sort(), Object.keys(full.tune).sort());
  for (const k in full.tune) assert.ok(near(c.tune[k], full.tune[k]), `${k}: ${c.tune[k]} vs ${full.tune[k]}`);
});

// Version 1 codes must open the same way forever: never edit this fixture.
test('a frozen version-1 code still reads the same', () => {
  const v1 = '1~nSour_Power~cff3f7f~msour~esharp~gsilver~dlight~tfm250,vs2.5,go.9,sz.8,gv9.8,bc0';
  const c = decodeCube(v1);
  assert.equal(c.version, 1);
  assert.equal(c.name, 'Sour Power');
  assert.equal(c.flavor, '#ff3f7f');
  assert.equal(c.texture, 'sour');
  assert.equal(c.edges, 'sharp');
  assert.equal(c.glitter, 'silver');
  assert.equal(c.theme, 'light');
  assert.equal(c.tear, true);
  assert.deepEqual(c.tune, { mu: 250, damping: 2.5, goo: 0.9, size: 0.8, gravity: 9.8, bubbles: 0 });
  const l = decodeCube('1~flayers~l7b22d61572ff2cc23a~b45~r3~i-20~mjello~eround');
  assert.deepEqual(l.layers, { colors: ['#7b22d6', '#1572ff', '#2cc23a'], blur: 0.45, repeat: 3, bias: -0.2 });
});

test('unknown fields and slider codes are skipped (codes from newer apps)', () => {
  const c = decodeCube('7~fgrape~zwhatever~tzz12,fm300,qq.5~q9~mfuture-material~enew-edge');
  assert.equal(c.flavor, 'grape');
  assert.deepEqual(c.tune, { mu: 300 });
  assert.equal(c.texture, 'jello');
  assert.equal(c.edges, 'round');
});

test('out-of-range values are brought into range', () => {
  const c = decodeCube('1~fcherry~tfm99999,bc-5,sz7,gv-3,rgNaN');
  const s = Object.fromEntries(SETTINGS.map((x) => [x.key, x]));
  assert.ok(near(c.tune.mu, s.mu.to(1)));
  assert.equal(c.tune.bubbles, 0);
  assert.ok(near(c.tune.size, s.size.to(1)));
  assert.ok(near(c.tune.gravity, s.gravity.to(0)));
  assert.equal(c.tune.rigidity, undefined);
});

test('codes are found in links, fragments and messages', () => {
  const link = cubeLink(full);
  assert.ok(link.startsWith('https://nickcason.github.io/cube-simulator/#cube=1~'));
  assert.equal(decodeCube(link).texture, 'gummy');
  assert.equal(decodeCube(`Look at my cube!! ${link} :)`).edges, 'pillow');
  assert.equal(decodeCube(link.replace(/~/g, '%7E')).glitter, 'holo');
  assert.equal(decodeCube(link.replace(/,/g, '%2C')).tune.goo, 0.8);
  assert.equal(findCode('hello there'), null);
  assert.equal(decodeCube(''), null);
  assert.equal(decodeCube('cube'), null);
  assert.equal(decodeCube('https://example.com/#other=1'), null);
});

test('every slider but sound has a unique two-letter code', () => {
  const codes = Object.values(TUNE_CODES);
  assert.equal(new Set(codes).size, codes.length);
  for (const s of SETTINGS) if (!SOUND_KEYS.includes(s.key)) assert.ok(TUNE_CODES[s.key], s.key);
  for (const c of codes) assert.match(c, /^[a-z]{2}$/);
});

test('names: a pun not on the shelf yet', () => {
  const taken = [];
  for (let i = 0; i < 60; i++) taken.push(cubeName({ flavor: 'grape', texture: 'gummy' }, taken));
  assert.equal(new Set(taken.map((n) => n.toLowerCase())).size, 60);
});

test('QR capacities match the standard', () => {
  for (const [k, n] of Object.entries({ '1L': 17, '1M': 14, '1H': 7, '10M': 213, '20M': 666, '40L': 2953, '40H': 1273 })) assert.equal(qrCapacity(parseInt(k), k.slice(-1)), n, k);
  const q = qrEncode(cubeLink(full));
  assert.equal(q.size, q.version * 4 + 17);
});

test('fighter stats: six, 0..100, and they read like the material', async () => {
  const { cubeStats } = await import('../src/cubecode.js');
  const { TEXTURES } = await import('../src/styles.js');
  for (const t of Object.keys(TEXTURES)) {
    const s = cubeStats({ texture: t, tune: {} });
    assert.equal(s.length, 6);
    for (const [, v] of s) assert.ok(Number.isInteger(v) && v >= 0 && v <= 100, `${t}: ${v}`);
  }
  const stat = (t, name, tune = {}) => cubeStats({ texture: t, tune }).find(([n]) => n === name)[1];
  assert.ok(stat('rubber', 'Bounce') > 90 && stat('slime', 'Bounce') < 15);
  assert.ok(stat('water', 'Wobble') > 90 && stat('glass', 'Wobble') < 10);
  assert.ok(stat('candy', 'Tough') > 85 && stat('glass', 'Squish') === 0);
  assert.ok(stat('jello', 'Goo', { goo: 1 }) === 100); // (tuned sliders count)
});

test('gradients: stops and shape survive the round trip; codes without them read as before', () => {
  const g = { ...full, layers: { ...full.layers, stops: [0, 0.1, 0.5, 0.52, 1], shape: 'core' } };
  const code = encodeCube(g);
  assert.match(code, /~p001a8085ff~/);
  assert.match(code, /~hcore~/);
  const c = decodeCube(code);
  assert.equal(c.layers.shape, 'core');
  assert.equal(c.layers.stops.length, 5);
  c.layers.stops.forEach((v, i) => assert.ok(Math.abs(v - g.layers.stops[i]) < 0.5 / 255 + 1e-9, `stop ${i}: ${v}`));
  // (stops that don't fit the colours, or out of order, or a shape not known: as before)
  assert.equal(decodeCube('1~flayers~l7b22d61572ff2cc23a~p0080~mjello~eround').layers.stops, undefined);
  assert.equal(decodeCube('1~flayers~l7b22d61572ff2cc23a~p80ff00~mjello~eround').layers.stops, undefined);
  assert.equal(decodeCube('1~flayers~l7b22d61572ff2cc23a~hspiral~mjello~eround').layers.shape, undefined);
  // (up and evenly spaced aren't written: a code says only what's different)
  assert.doesNotMatch(encodeCube(full), /~[ph]/);
});
