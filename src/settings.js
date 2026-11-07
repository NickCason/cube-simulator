// Fine-tuning sliders. Material settings default to the current material
// preset (and reset when the material changes); the rest are global.
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
  { id: 'bounce', group: 'Feel', label: 'Bounce', key: 'bounce', mat: true, def: 0.55, ...linMap(0, 0.95), words: ['Splat', 'Thud', 'Jelly', 'Springy', 'Super ball'] },
  { id: 'grip', group: 'Feel', label: 'Grip', key: 'grip', mat: true, def: 0.85, ...linMap(0.02, 1.5), words: ['Ice', 'Slippery', 'Normal', 'Grippy', 'Sticky'] },
  // how much it holds its shape as a whole (beyond firmness: see SoftBody._solveRigidity)
  { id: 'rigidity', group: 'Feel', label: 'Rigidity', key: 'rigidity', mat: true, def: 0, ...linMap(0, 1), words: ['Jelly', 'Firm', 'Stiff', 'Solid', 'Rigid'] },
  // how much stretch and how long a pull it takes to tear (scales both; see HandTool)
  { id: 'tough', group: 'Feel', label: 'Toughness', key: 'tough', mat: true, def: 1, ...logMap(0.4, 2.5), words: ['Brittle', 'Tender', 'Normal', 'Tough', 'Taffy'] },
  // how stringy it is torn or melted: strands of goo across a tear, drips on a string (see Strands)
  { id: 'goo', group: 'Feel', label: 'Goo', key: 'goo', mat: true, def: 0.35, ...linMap(0, 1), words: ['Clean', 'Tacky', 'Gooey', 'Stringy', 'Slimy'] },
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
  {
    // the jelly's own voice: a hum at its wobble, as loud as it jiggles
    id: 'wobble', group: 'Sound', label: 'Wobble', key: 'wobble', def: 0.5, ...linMap(0, 1),
    word: (v) => (v < 0.02 ? 'Off' : v < 0.3 ? 'Faint' : v < 0.65 ? 'Soft' : v < 0.85 ? 'Lively' : 'Loud'),
  },
  // ---- the Lab (Settings > Lab controls): the knobs inside each tool, 1 =
  // as it comes. See docs/physics-audit.md for what each one moves.
  { id: 'grabSize', group: 'Hand', lab: true, label: 'Grab size', key: 'grabSize', def: 1, ...logMap(0.5, 2), words: ['Fingertip', 'Small', 'Hand', 'Big', 'Paw'] },
  { id: 'handPull', group: 'Hand', lab: true, label: 'Hand strength', key: 'handPull', def: 1, ...logMap(0.4, 2.5), words: ['Gentle', 'Light', 'Normal', 'Strong', 'Iron'] },
  { id: 'poke', group: 'Hand', lab: true, label: 'Poke', key: 'poke', def: 1, ...logMap(0.25, 4), words: ['Tap', 'Nudge', 'Poke', 'Jab', 'Punch'] },
  { id: 'knifePush', group: 'Tools', lab: true, label: 'Knife push', key: 'knifePush', def: 1, ...linMap(0, 2), words: ['None', 'Slight', 'Normal', 'Firm', 'Shove'] },
  { id: 'nailPower', group: 'Tools', lab: true, label: 'Nail power', key: 'nailPower', def: 1, ...logMap(0.4, 2.5), words: ['Tack', 'Light', 'Normal', 'Heavy', 'Rivet'] },
  { id: 'malletForce', group: 'Tools', lab: true, label: 'Mallet force', key: 'malletForce', def: 1, ...logMap(0.4, 2), words: ['Tap', 'Light', 'Normal', 'Hard', 'Sledge'] },
  { id: 'torchHeat', group: 'Tools', lab: true, label: 'Torch heat', key: 'torchHeat', def: 1, ...logMap(0.3, 3.3), words: ['Warm', 'Hot', 'Normal', 'Fierce', 'Inferno'] },
  { id: 'boilOff', group: 'Tools', lab: true, label: 'Boil-off', key: 'boilOff', def: 0.5, ...linMap(0, 0.9), word: (v) => `${Math.round(v * 100)}%` },
  { id: 'cryoCold', group: 'Tools', lab: true, label: 'Cryo cold', key: 'cryoCold', def: 1, ...logMap(0.3, 3.3), words: ['Chill', 'Cold', 'Normal', 'Frigid', 'Absolute'] },
  { id: 'bombPower', group: 'Tools', lab: true, label: 'Bomb power', key: 'bombPower', def: 1, ...logMap(0.25, 4), words: ['Pop', 'Bang', 'Normal', 'Boom', 'Nuke'] },
  { id: 'syringePump', group: 'Tools', lab: true, label: 'Syringe pump', key: 'syringePump', def: 1, ...logMap(0.3, 3.3), words: ['Trickle', 'Slow', 'Normal', 'Fast', 'Firehose'] },
  { id: 'magnetPull', group: 'Tools', lab: true, label: 'Magnet pull', key: 'magnetPull', def: 1, ...logMap(0.3, 3.3), words: ['Fridge', 'Weak', 'Normal', 'Strong', 'MRI'] },
  { id: 'contactGrip', group: 'Contact', lab: true, label: 'Jelly on jelly', key: 'contactGrip', def: 1, ...linMap(0, 2.5), words: ['Frictionless', 'Slippery', 'Normal', 'Grippy', 'Velcro'] },
  { id: 'airDrag', group: 'Contact', lab: true, label: 'Air drag', key: 'airDrag', def: 0.05, ...logMap(0.01, 4), words: ['Vacuum', 'Air', 'Breezy', 'Water', 'Honey'] },
];

export function settingWord(s, value) {
  if (s.word) return s.word(value);
  const t = Math.min(1, Math.max(0, s.from(value)));
  return s.words[Math.min(s.words.length - 1, Math.floor(t * s.words.length))];
}

// Effective value of every setting: user overrides, else material, else default.
export function resolveSettings(overrides, texture) {
  const out = {};
  for (const s of SETTINGS) {
    if (overrides[s.key] !== undefined) out[s.key] = overrides[s.key];
    else out[s.key] = s.mat && texture[s.key] !== undefined ? texture[s.key] : s.def;
  }
  return out;
}
