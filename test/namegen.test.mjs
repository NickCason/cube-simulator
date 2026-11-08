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

// ---- the namer reads everything (2026-11-07)
import { TEXTURES } from '../src/styles.js';

const many = (c, ctx, n = 300, seed = 11) => {
  const rnd = seeded(seed), taken = [], out = [];
  for (let i = 0; i < n; i++) {
    const x = nameCube(c, { rnd, taken, ...ctx });
    taken.push(x);
    out.push(x);
  }
  return out;
};
const share = (names, re) => names.filter((n) => re.test(n)).length / names.length;

test('the same cube, context and seed give the same names', () => {
  const c = decodeCube('1~flayers~lffc1ccfffdd07b3f00~mcreamy~ggold');
  const ctx = { place: 'diner', theme: 'dark', now: new Date(2026, 9, 30, 21), gen: 2, parentName: 'Cubert McCube', changes: [{ tier: 3, label: 'Chrome!' }] };
  assert.deepEqual(many(c, ctx, 40, 5), many(c, ctx, 40, 5));
});

test('a holiday shows: Halloween names at Halloween, not in May', () => {
  const c = decodeCube('1~forange~mjello');
  const spooky = /Spooky|Haunted|Ghoul|Eerie|Poltergeist|Jack-o|Trick-or-Treat/;
  assert.ok(share(many(c, { now: new Date(2026, 9, 31, 20) }), spooky) > 0.05);
  assert.equal(share(many(c, { now: new Date(2026, 4, 12, 12) }), spooky), 0);
});

test('a child carries its family; a twin pairs with its twin', () => {
  const c = decodeCube('1~fgrape~mgummy');
  const kid = many(c, { gen: 1, parentName: 'Cubert McCube' });
  assert.ok(share(kid, /McCube|Cubert/) > 0.08, kid.slice(0, 12).join(' / '));
  const twin = many(c, { gen: 1, parentName: 'Cubert McCube', twin: 'Wibble Jigglesworth' });
  assert.ok(share(twin, /Jigglesworth|Wobble|Wibble|Twin|Other/) > 0.06, twin.slice(0, 12).join(' / '));
});

test('a known palette is named for what it is', () => {
  assert.ok(share(many(decodeCube('1~flayers~lffc1ccfffdd07b3f00~mcreamy')), /Neapolitan|Triple Scoop/) > 0.05);
  assert.ok(share(many(decodeCube('1~flayers~le8102ef4f4f4~mcandy~r4')), /Candy Cane|Peppermint|Barber Pole/) > 0.05);
});

test('what mutated in it, when it was born, shows', () => {
  const names = many(decodeCube('1~fcherry~mchrome'), { gen: 1, parentName: 'Bounce Castle', changes: [{ tier: 3, label: 'Chrome!' }] });
  assert.ok(share(names, /Chrome|Mutant|Mutation|Changeling|Anomaly/) > 0.08);
});

test('every material, flavour, finish and context: tidy names', () => {
  const flavors = ['cherry', 'lime', 'cola', '#93c572', '#1b1b2f', '#fffdd0', 'rubik', 'layers'];
  let n = 0;
  for (const tex of Object.keys(TEXTURES))
    for (const f of flavors) {
      const c = decodeCube(`1~${f.startsWith('#') ? 'c' + f.slice(1) : 'f' + f}~m${tex}~esharp~gholo`);
      if (f === 'layers') c.layers.shape = ['up', 'free', 'core', 'shell', 'rings', 'corner', 'across'][n % 7];
      c.tune.size = [0.6, 1, 1.5][n % 3];
      c.tune.bubbles = n % 2;
      const names = many(c, { place: ['moon', 'diner', 'beach', 'studio'][n % 4], now: new Date(2026, n % 12, 1 + (n % 28)), gen: n % 3, parentName: n % 2 ? 'Gloopert von Wobble' : '', twin: n % 5 ? '' : 'Ping' }, 25, n);
      for (const x of names) {
        assert.ok(!/undefined|NaN|null|[{}]|\s\s|^\s|\s$/.test(x), x);
        assert.ok(x.length >= 3 && x.length <= 34, x);
      }
      n++;
    }
});

test('family names read right: numbers count on, articles stay put, no one named for its parent or twin', () => {
  const c = decodeCube('1~forange~mjello');
  const parents = ['Jellcube II', 'The Amazing Wobbly Cube', 'Elasticus caeruleus', 'Pip the Brave', 'Sir Wobbleton Jigglesworth', 'Defiant Cherry', 'Cubert McCube Jr.'];
  for (const p of parents)
    for (const twin of ['', 'The Fire Opal', 'Jiggle Physics', 'Gloopert von Wobble']) {
      const names = many(c, { gen: 2, parentName: p, twin }, 120, p.length + twin.length);
      for (const x of names) {
        assert.ok(x !== p && x !== twin, `${x} (parent ${p}, twin ${twin})`);
        assert.ok(!/\b(II|III|IV|Jr\.) (II|III|IV|V|Jr\.)\b|Little The|The Other The|Evil The|Not The|The Two|Physics’s/.test(x), x);
      }
    }
  // (the second of a name's child is its third)
  assert.ok(many(c, { gen: 2, parentName: 'Jellcube II' }).includes('Jellcube III'));
  assert.ok(many(c, { gen: 1, parentName: 'Jellcube' }).includes('Jellcube II'));
});

test('twins named as a pair: the first one half, its twin the other', () => {
  const firsts = many(decodeCube('1~fgrape~mgummy'), { gen: 1, parentName: 'Jellcube', pairing: true }, 400);
  assert.ok(firsts.some((x) => ['Wibble', 'Ping', 'Salt', 'Tick', 'Fizz', 'Sugar', 'Yin', 'Peanut Butter'].includes(x)), 'no pair started');
  for (const [a, b] of [['Wibble', 'Wobble'], ['Wobble', 'Wibble'], ['Salt', 'Pepper'], ['Thing One', 'Thing Two']]) {
    const names = many(decodeCube('1~flime~mrubber'), { gen: 1, parentName: 'Jellcube', twin: a }, 40, 3).filter((x) => x === b);
    assert.ok(names.length >= 1, `${a} -> ${b}`);
    // (and nearly always, from a fresh start)
    let hit = 0;
    for (let s = 0; s < 30; s++) hit += nameCube(decodeCube('1~flime~mrubber'), { rnd: seeded(s), gen: 1, parentName: 'Jellcube', twin: a }) === b ? 1 : 0;
    assert.ok(hit >= 24, `${a} -> ${b}: ${hit}/30`);
  }
});

test('holidays are where they are: Bonfire Night in Britain, Thanksgiving in the US, Easter when it falls', () => {
  const c = decodeCube('1~forange~mjello');
  const bonfire = /Bonfire|Sparkler|Firework|Toffee-Apple|Catherine Wheel|Roman Candle/;
  const thanks = /Thankful|Cranberry|Stuffed|Gravy-Boat|Second-Helping|Turkey|Pumpkin Pie|Wishbone|Leftovers/;
  assert.ok(share(many(c, { now: new Date(2026, 10, 5, 15), locale: 'en-GB' }), bonfire) > 0.05);
  assert.equal(share(many(c, { now: new Date(2026, 10, 5, 15), locale: 'en-US' }), /Sparkler|Firework|Toffee-Apple|Catherine Wheel|Roman Candle/), 0);
  assert.ok(share(many(c, { now: new Date(2026, 10, 26, 15), locale: 'en-US' }), thanks) > 0.05);
  assert.equal(share(many(c, { now: new Date(2026, 10, 26, 15), locale: 'en-GB' }), thanks), 0);
  // (Easter 2026: 5 April; 2027: 28 March)
  const egg = /Easter|Hot Cross|Egg-Hunt|Chocolate Bunny/;
  assert.ok(share(many(c, { now: new Date(2026, 3, 5, 12) }), egg) > 0.05);
  assert.ok(share(many(c, { now: new Date(2027, 2, 28, 12) }), egg) > 0.05);
  assert.equal(share(many(c, { now: new Date(2026, 3, 20, 12) }), egg), 0);
});
