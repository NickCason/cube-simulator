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
  // Full of liquid (the switch at the head of the group: see Ui), how thick that is, how thick its skin - its shell's
  // wall - and how full it is (see Spill): each cube its own, kept through a change of material
  { id: 'liquid', group: 'Liquid', label: 'Filled', key: 'liquid', def: 0, ...linMap(0, 1), hidden: true, words: ['Off', 'On'] },
  { id: 'liqVisc', group: 'Liquid', label: 'Viscosity', key: 'liqVisc', def: 0.15, ...linMap(0, 1), words: ['Water', 'Syrup', 'Glue', 'Gel', 'Near solid'] },
  { id: 'liqSkin', group: 'Liquid', label: 'Skin', key: 'liqSkin', def: 0.5, ...linMap(0, 1), release: true, words: ['Ultrathin', 'Thin', 'Medium', 'Thick'] },
  { id: 'liqFill', group: 'Liquid', label: 'Fill', key: 'liqFill', def: 1, ...linMap(0, 1), release: true, words: ['Empty', 'A quarter', 'Half', 'Three quarters', 'Full'] },
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
  // a rainbow film on it, a metal mirror of it, opal's flashes of colour in it
  {
    id: 'irid', group: 'Look', label: 'Iridescence', key: 'irid', mat: true, def: 0, ...linMap(0, 1),
    word: (v) => (v < 0.02 ? 'None' : v < 0.3 ? 'Hint' : v < 0.55 ? 'Sheen' : v < 0.8 ? 'Rainbow' : 'Holo'),
  },
  {
    id: 'metal', group: 'Look', label: 'Metallic', key: 'metal', mat: true, def: 0, ...linMap(0, 1),
    word: (v) => (v < 0.02 ? 'None' : v < 0.3 ? 'Satin' : v < 0.55 ? 'Lustre' : v < 0.8 ? 'Metal' : 'Chrome'),
  },
  {
    id: 'opal', group: 'Look', label: 'Opal fire', key: 'opal', mat: true, def: 0, ...linMap(0, 1),
    word: (v) => (v < 0.02 ? 'None' : v < 0.3 ? 'Glint' : v < 0.55 ? 'Flash' : v < 0.8 ? 'Fire' : 'Galaxy'),
  },
  { id: 'bubbles', group: 'Bubbles', label: 'Count', key: 'bubbles', def: 34, ...linMap(0, 240), int: true, noNum: true, word: (v) => String(Math.round(v)) },
  { id: 'bubbleSize', group: 'Bubbles', label: 'Size', key: 'bubbleSize', def: 1, ...logMap(0.3, 3.5), words: ['Fizz', 'Tiny', 'Medium', 'Big', 'Huge'] },
  { id: 'glitterAmount', group: 'Glitter', label: 'Amount', key: 'glitterAmount', def: 2600, ...logMap(300, 9000), word: (v) => (v < 900 ? 'Sprinkle' : v < 2200 ? 'Dusting' : v < 4500 ? 'Sparkly' : v < 7000 ? 'Loaded' : 'Galaxy') },
  { id: 'glitterSize', group: 'Glitter', label: 'Size', key: 'glitterSize', def: 1, ...logMap(0.4, 2.8), words: ['Dust', 'Fine', 'Classic', 'Chunky', 'Sequins'] },
  { id: 'glitterSparkle', group: 'Glitter', label: 'Sparkle', key: 'glitterSparkle', def: 1, ...logMap(0.3, 3), words: ['Subtle', 'Soft', 'Bright', 'Dazzling', 'Blinding'] },
  // its surface map's (see surfaces.js): how deep its relief, how big its cells
  { id: 'surfDepth', group: 'Surface', label: 'Depth', key: 'surfDepth', def: 1, ...logMap(0.25, 3), words: ['Faint', 'Soft', 'Moulded', 'Deep', 'Carved'] },
  { id: 'surfScale', group: 'Surface', label: 'Scale', key: 'surfScale', def: 1, ...logMap(0.4, 2.5), words: ['Fine', 'Small', 'Medium', 'Large', 'Bold'] },
  // its own shape: its faces dished in - each side pinched, its corners
  // standing out - or bulged out (see app.js shapeOf)
  { id: 'faces', group: 'Shape', label: 'Faces', key: 'faces', def: 0, ...linMap(-1, 1), words: ['Pinched', 'Dished', 'Flat', 'Rounded', 'Puffy'] },
  // its edges' trim's (see styles.js TRIMS): how big its repeats, how deep
  { id: 'trimSize', group: 'Trim', label: 'Size', key: 'trimSize', def: 1, ...logMap(0.5, 2), words: ['Fine', 'Small', 'Medium', 'Large', 'Bold'] },
  { id: 'trimDepth', group: 'Trim', label: 'Depth', key: 'trimDepth', def: 1, ...logMap(0.4, 2.5), words: ['Faint', 'Soft', 'Moulded', 'Deep', 'Carved'] },
  {
    id: 'gravity', group: 'World', label: 'Gravity', key: 'gravity', def: 22, ...logMap(4, 60),
    word: (g) => (g < 7 ? 'Moon' : g < 13 ? 'Mars' : g < 32 ? 'Earth' : g < 45 ? 'Heavy' : 'Jupiter'),
  },
  {
    id: 'size', group: 'World', label: 'Cube size', key: 'size', def: 1, ...linMap(0.35, 1.6), release: true,
    word: (v) => (v < 0.5 ? 'Tiny' : v < 0.72 ? 'Bite' : v < 0.9 ? 'Small' : v < 1.1 ? 'Regular' : v < 1.25 ? 'Big' : v < 1.45 ? 'Huge' : 'Giant'),
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
  {
    // a jelly xylophone: each piece rings its own note as it's tapped or knocked - the smaller, the higher (a
    // family of sizes is a scale; a cube cut in two, two notes), hard jelly a bell, soft a bonk (see
    // App.ringNote, Audio.note)
    id: 'notes', group: 'Sound', label: 'Notes', key: 'notes', def: 0, ...linMap(0, 1),
    word: (v) => (v < 0.02 ? 'Off' : v < 0.35 ? 'A hint' : v < 0.7 ? 'Tuned' : 'Xylophone'),
  },
  // ---- the Lab (Settings > Lab controls): the knobs inside each tool, 1 =
  // as it comes. See docs/physics-audit.md for what each one moves.
  // The Cubicle (lab controls): the knobs inside the hand and every tool, a
  // group a tool (tool: its id - the group's icon, and pinned on top while
  // it's in hand; see Ui), in the dock's order
  { id: 'grabSize', group: 'Hand', tool: 'hand', lab: true, label: 'Grab size', key: 'grabSize', def: 1, ...logMap(0.5, 2), words: ['Fingertip', 'Small', 'Hand', 'Big', 'Paw'] },
  { id: 'handPull', group: 'Hand', tool: 'hand', lab: true, label: 'Hand strength', key: 'handPull', def: 1, ...logMap(0.4, 2.5), words: ['Gentle', 'Light', 'Normal', 'Strong', 'Iron'] },
  { id: 'poke', group: 'Hand', tool: 'hand', lab: true, label: 'Poke', key: 'poke', def: 1, ...logMap(0.25, 4), words: ['Tap', 'Nudge', 'Poke', 'Jab', 'Punch'] },
  { id: 'knifePush', group: 'Knife', tool: 'knife', lab: true, label: 'Blade push', key: 'knifePush', def: 1, ...linMap(0, 2), words: ['None', 'Slight', 'Normal', 'Firm', 'Shove'] },
  { id: 'dice', group: 'Dicer', tool: 'dicer', lab: true, label: 'Dice a side', key: 'dice', def: 3, ...linMap(2, 5), int: true, step: 1 / 3, noNum: true, word: (v) => `${Math.round(v)} × ${Math.round(v)} × ${Math.round(v)}` },
  { id: 'nailPower', group: 'Nail gun', tool: 'nailgun', lab: true, label: 'Nail power', key: 'nailPower', def: 1, ...logMap(0.4, 2.5), words: ['Tack', 'Light', 'Normal', 'Heavy', 'Rivet'] },
  { id: 'gunPower', group: 'Hole gun', tool: 'holegun', lab: true, label: 'Power', key: 'gunPower', def: 1, ...logMap(0.4, 2.5), words: ['Pea', 'Light', 'Normal', 'Heavy', 'Cannon'] },
  { id: 'holeSize', group: 'Hole gun', tool: 'holegun', lab: true, label: 'Hole size', key: 'holeSize', def: 1, ...logMap(0.5, 2.2), words: ['Pin', 'Small', 'Normal', 'Wide', 'Tunnel'] },
  { id: 'autoRate', group: 'Full auto', tool: 'autogun', lab: true, label: 'Fire rate', key: 'autoRate', def: 1, ...logMap(0.4, 2.5), words: ['Plink', 'Steady', 'Normal', 'Rapid', 'Minigun'] },
  { id: 'malletForce', group: 'Mallet', tool: 'mallet', lab: true, label: 'Force', key: 'malletForce', def: 1, ...logMap(0.4, 2), words: ['Tap', 'Light', 'Normal', 'Hard', 'Sledge'] },
  { id: 'torchHeat', group: 'Torch', tool: 'torch', lab: true, label: 'Heat', key: 'torchHeat', def: 1, ...logMap(0.3, 3.3), words: ['Warm', 'Hot', 'Normal', 'Fierce', 'Inferno'] },
  { id: 'flameSize', group: 'Torch', tool: 'torch', lab: true, label: 'Flame size', key: 'flameSize', def: 1, ...logMap(0.5, 2), words: ['Pinpoint', 'Narrow', 'Normal', 'Wide', 'Blowtorch'] },
  { id: 'boilOff', group: 'Torch', tool: 'torch', lab: true, label: 'Boil-off', key: 'boilOff', def: 0.5, ...linMap(0, 0.9), noNum: true, word: (v) => `${Math.round(v * 100)}%` },
  { id: 'cryoCold', group: 'Cryo spray', tool: 'freeze', lab: true, label: 'Cold', key: 'cryoCold', def: 1, ...logMap(0.3, 3.3), words: ['Chill', 'Cold', 'Normal', 'Frigid', 'Absolute'] },
  { id: 'acidStrength', group: 'Acid', tool: 'acid', lab: true, label: 'Strength', key: 'acidStrength', def: 1, ...logMap(0.3, 3.3), words: ['Vinegar', 'Mild', 'Normal', 'Strong', 'Xenomorph'] },
  { id: 'acidPour', group: 'Acid', tool: 'acid', lab: true, label: 'Pour', key: 'acidPour', def: 1, ...logMap(0.4, 2.5), words: ['Drip', 'Trickle', 'Normal', 'Glug', 'Flood'] },
  { id: 'twistSpeed', group: 'Twist', tool: 'twist', lab: true, label: 'Turn speed', key: 'twistSpeed', def: 1, ...logMap(0.4, 3), words: ['Slow', 'Easy', 'Normal', 'Snappy', 'Speedcuber'] },
  { id: 'lively', group: 'Googly eyes', tool: 'eyes', lab: true, label: 'Liveliness', key: 'lively', def: 0.5, ...linMap(0, 1), words: ['Still', 'Sleepy', 'Lively', 'Bouncy', 'Hyper'] },
  { id: 'pupilWiggle', group: 'Googly eyes', tool: 'eyes', lab: true, label: 'Pupil wiggle', key: 'pupilWiggle', def: 1, ...logMap(0.3, 3), words: ['Sluggish', 'Calm', 'Googly', 'Rattly', 'Frantic'] },
  { id: 'siftRate', group: 'Sieve', tool: 'flour', lab: true, label: 'Sift', key: 'siftRate', def: 1, ...logMap(0.3, 3), words: ['Pinch', 'Light', 'Normal', 'Heavy', 'Avalanche'] },
  { id: 'siftSpread', group: 'Sieve', tool: 'flour', lab: true, label: 'Spread', key: 'siftSpread', def: 1, ...logMap(0.4, 2.5), words: ['Tight', 'Narrow', 'Normal', 'Wide', 'Snowfall'] },
  { id: 'ballSize', group: 'Melon baller', tool: 'baller', lab: true, label: 'Scoop size', key: 'ballSize', def: 1, ...logMap(0.5, 1.8), words: ['Pea', 'Small', 'Normal', 'Big', 'Ice cream'] },
  { id: 'cuberSize', group: 'Cube cuber', tool: 'cuber', lab: true, label: 'Scoop size', key: 'cuberSize', def: 1, ...logMap(0.6, 1.6), words: ['Dice', 'Small', 'Normal', 'Big', 'Chunk'] },
  { id: 'bombPower', group: 'Cherry bomb', tool: 'bomb', lab: true, label: 'Power', key: 'bombPower', def: 1, ...logMap(0.25, 4), words: ['Pop', 'Bang', 'Normal', 'Boom', 'Nuke'] },
  { id: 'syringePump', group: 'Syringe', tool: 'syringe', lab: true, label: 'Pump', key: 'syringePump', def: 1, ...logMap(0.3, 3.3), words: ['Trickle', 'Slow', 'Normal', 'Fast', 'Firehose'] },
  { id: 'ladle', group: 'Add jelly', tool: 'feed', lab: true, label: 'Ladle', key: 'ladle', def: 1, ...logMap(0.4, 3), words: ['Spoonful', 'Small', 'Normal', 'Big', 'Bucket'] },
  { id: 'mutation', group: 'Add jelly', tool: 'feed', lab: true, label: 'Mutation', key: 'mutation', def: 1, ...logMap(0.2, 4), words: ['Identical', 'Family', 'Normal', 'Weird', 'Chaos'] },
  { id: 'globSize', group: 'Gel gun', tool: 'gelgun', lab: true, label: 'Glob size', key: 'globSize', def: 1, ...logMap(0.6, 1.7), words: ['Dab', 'Small', 'Normal', 'Big', 'Splat'] },
  { id: 'globRate', group: 'Gel gun', tool: 'gelgun', lab: true, label: 'Fire rate', key: 'globRate', def: 1, ...logMap(0.4, 2.2), words: ['Lob', 'Steady', 'Normal', 'Rapid', 'Hose'] },
  { id: 'magnetPull', group: 'Magnet', tool: 'magnet', lab: true, label: 'Pull', key: 'magnetPull', def: 1, ...logMap(0.3, 3.3), words: ['Fridge', 'Weak', 'Normal', 'Strong', 'MRI'] },
  { id: 'blowForce', group: 'Blow', tool: 'blow', lab: true, label: 'Gust', key: 'blowForce', def: 1, ...logMap(0.3, 3.3), words: ['Breath', 'Breeze', 'Gust', 'Gale', 'Storm'] },
  // ...and the jelly against itself, and the air
  { id: 'contactGrip', group: 'Contact', lab: true, label: 'Jelly on jelly', key: 'contactGrip', def: 1, ...linMap(0, 2.5), words: ['Frictionless', 'Slippery', 'Normal', 'Grippy', 'Velcro'] },
  { id: 'airDrag', group: 'Contact', lab: true, label: 'Air drag', key: 'airDrag', def: 0.05, ...logMap(0.01, 4), words: ['Vacuum', 'Air', 'Breezy', 'Water', 'Honey'] },
];

export function settingWord(s, value) {
  if (s.word) return s.word(value);
  const t = Math.min(1, Math.max(0, s.from(value)));
  return s.words[Math.min(s.words.length - 1, Math.floor(t * s.words.length))];
}

// Where the slider sits, 0–100, shown beside the word (null where the word is already a number).
export function settingNum(s, value) {
  if (s.noNum) return null;
  return Math.round(100 * Math.min(1, Math.max(0, s.from(value))));
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
