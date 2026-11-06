// Fine-tuning sliders. Material settings default to the current texture
// preset (and reset when the texture changes); the rest are global.
// Values are stored in physical units; sliders run 0..1 via to/from.

const logMap = (a, b) => ({
  to: (t) => a * Math.pow(b / a, t),
  from: (v) => Math.log(v / a) / Math.log(b / a),
});
const linMap = (a, b) => ({
  to: (t) => a + (b - a) * t,
  from: (v) => (v - a) / (b - a),
});

export const SETTINGS = [
  { id: 'firmness', group: 'Feel', label: 'Firmness', key: 'mu', mat: true, ...logMap(45, 1000), words: ['Pudding', 'Wobbly', 'Jiggly', 'Bouncy', 'Firm', 'Rubber'] },
  { id: 'viscosity', group: 'Feel', label: 'Viscosity', key: 'damping', mat: true, ...logMap(0.3, 14), words: ['Watery', 'Jiggly', 'Smooth', 'Syrupy', 'Doughy'] },
  { id: 'density', group: 'Feel', label: 'Density', key: 'weight', mat: true, ...logMap(0.3, 4), words: ['Airy', 'Light', 'Normal', 'Heavy', 'Lead'] },
  { id: 'squash', group: 'Feel', label: 'Squash', key: 'lambda', mat: true, ...logMap(40, 1.6), words: ['Solid', 'Squishy', 'Spongy', 'Foam'] },
  { id: 'bounce', group: 'Feel', label: 'Bounce', key: 'bounce', def: 0.55, ...linMap(0, 0.95), words: ['Splat', 'Thud', 'Jelly', 'Springy', 'Super ball'] },
  { id: 'grip', group: 'Feel', label: 'Grip', key: 'grip', def: 0.85, ...linMap(0.02, 1.5), words: ['Ice', 'Slippery', 'Normal', 'Grippy', 'Sticky'] },
  { id: 'opacity', group: 'Look', label: 'Opacity', key: 'opacity', mat: true, ...linMap(0, 1), words: ['Clear', 'Hazy', 'Cloudy', 'Milky', 'Solid'] },
  { id: 'translucency', group: 'Look', label: 'Translucency', key: 'glow', mat: true, ...linMap(0, 1), words: ['Dull', 'Soft', 'Glowing', 'Radiant'] },
  { id: 'depth', group: 'Look', label: 'Colour depth', key: 'depth', mat: true, ...logMap(0.15, 4), words: ['Pale', 'Light', 'Rich', 'Deep', 'Inky'] },
  {
    id: 'gloss', group: 'Look', label: 'Gloss', key: 'rough', mat: true,
    to: (t) => 0.012 + 0.45 * (1 - t) * (1 - t),
    from: (r) => 1 - Math.sqrt(Math.max(0, (r - 0.012) / 0.45)),
    words: ['Matte', 'Satin', 'Glossy', 'Wet', 'Glass'],
  },
  { id: 'refraction', group: 'Look', label: 'Refraction', key: 'ior', mat: true, ...linMap(1.0, 1.75), words: ['None', 'Water', 'Gel', 'Glass', 'Diamond'] },
  { id: 'bubbles', group: 'Bubbles', label: 'Count', key: 'bubbles', def: 34, ...linMap(0, 240), int: true, word: (v) => String(Math.round(v)) },
  { id: 'bubbleSize', group: 'Bubbles', label: 'Size', key: 'bubbleSize', def: 1, ...logMap(0.3, 3.5), words: ['Fizz', 'Tiny', 'Medium', 'Big', 'Huge'] },
  { id: 'glitterAmount', group: 'Glitter', label: 'Amount', key: 'glitterAmount', def: 2600, ...logMap(300, 9000), word: (v) => (v < 900 ? 'Sprinkle' : v < 2200 ? 'Dusting' : v < 4500 ? 'Sparkly' : v < 7000 ? 'Loaded' : 'Galaxy') },
  { id: 'glitterSize', group: 'Glitter', label: 'Size', key: 'glitterSize', def: 1, ...logMap(0.4, 2.8), words: ['Dust', 'Fine', 'Classic', 'Chunky', 'Sequins'] },
  { id: 'glitterSparkle', group: 'Glitter', label: 'Sparkle', key: 'glitterSparkle', def: 1, ...logMap(0.3, 3), words: ['Subtle', 'Soft', 'Bright', 'Dazzling', 'Blinding'] },
  {
    id: 'gravity', group: 'World', label: 'Gravity', key: 'gravity', def: 22, ...logMap(4, 60),
    word: (g) => (g < 7 ? 'Moon' : g < 13 ? 'Mars' : g < 32 ? 'Earth' : g < 45 ? 'Heavy' : 'Jupiter'),
  },
  {
    id: 'size', group: 'World', label: 'Cube size', key: 'size', def: 1, ...linMap(0.6, 1.35), release: true,
    word: (v) => (v < 0.72 ? 'Bite' : v < 0.9 ? 'Small' : v < 1.1 ? 'Regular' : v < 1.25 ? 'Big' : 'Huge'),
  },
  {
    id: 'volume', group: 'Sound', label: 'Volume', key: 'volume', def: 0.75, ...linMap(0, 1),
    word: (v) => (v < 0.02 ? 'Off' : v < 0.3 ? 'Quiet' : v < 0.62 ? 'Medium' : v < 0.88 ? 'Normal' : 'Loud'),
  },
  {
    id: 'impacts', group: 'Sound', label: 'Impacts', key: 'impacts', def: 0.55, ...linMap(0, 1),
    word: (v) => (v < 0.02 ? 'Off' : v < 0.3 ? 'Subtle' : v < 0.65 ? 'Soft' : v < 0.85 ? 'Lively' : 'Loud'),
  },
];

export function settingWord(s, value) {
  if (s.word) return s.word(value);
  const t = Math.min(1, Math.max(0, s.from(value)));
  return s.words[Math.min(s.words.length - 1, Math.floor(t * s.words.length))];
}

// Effective value of every setting: user overrides, else texture, else default.
export function resolveSettings(overrides, texture) {
  const out = {};
  for (const s of SETTINGS) {
    if (overrides[s.key] !== undefined) out[s.key] = overrides[s.key];
    else out[s.key] = s.mat ? texture[s.key] : s.def;
  }
  return out;
}
