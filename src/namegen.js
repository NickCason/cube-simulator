// The name generator: needlessly thorough. A cube's name comes out of what
// it is - its stats (Squish, Bounce, Wobble, Goo, Tough, Heft), its flavour
// (or the colours of its layers, or the hue of a custom colour), its
// material, edges, glitter, size, gravity, glow, whether it tears - and
// what it's been through (its record: re-cubed, cut, shot, blown up...),
// put through one of a few dozen kinds of name: puns, titles, epithets,
// wrestlers, robots, bands, desserts, ships, racehorses, Latin binomials,
// and now and then a legendary one. The same cube and the same roll give
// the same name (seeded); the die rolls a new seed.

import { cubeStats } from './cubecode.js';
import { punsFor } from './puns.js';

// ---------------------------------------------------------------- random
// a small fast seeded generator (mulberry32) and a string hash for seeds
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// ---------------------------------------------------------------- words
// Each trait: adjectives, nouns (things to call it), verbs (what it does),
// epithets ("the ..."), Latin species, title leanings.
const TRAITS = {
  bouncy: {
    adj: ['Bouncy', 'Springy', 'Boingy', 'Hoppy', 'Rebounding', 'Pogo', 'Elastic', 'Spring-Loaded', 'Ricochet'],
    noun: ['Boinger', 'Bouncer', 'Pogo', 'Springer', 'Kangaroo', 'Rebound', 'Hopper', 'Superball'],
    verb: ['Bounce', 'Boing', 'Hop', 'Spring', 'Rebound'],
    epi: ['the Boing', 'Who Bounces Back', 'of the Endless Bounce', 'the Unflattenable', 'the Ricochet', 'Who Never Lands'],
    sp: ['saltatrix', 'bouncifera', 'resiliens'],
    titles: ['Captain', 'Agent', 'Coach'],
  },
  squishy: {
    adj: ['Squishy', 'Squashy', 'Smooshy', 'Cushy', 'Spongy', 'Pudgy', 'Plush', 'Yielding', 'Squeezable'],
    noun: ['Squish', 'Smoosh', 'Pudding', 'Cushion', 'Sponge', 'Squeezle', 'Marshmallow', 'Dumpling'],
    verb: ['Squish', 'Squash', 'Smoosh', 'Squeeze'],
    epi: ['the Squishable', 'Who Yields', 'the Soft-Hearted', 'the Very Squeezable', 'Who Gives a Little', 'the Huggable'],
    sp: ['mollis', 'squishii', 'pressibilis'],
    titles: ['Lil', 'Auntie', 'Uncle'],
  },
  wobbly: {
    adj: ['Wobbly', 'Jiggly', 'Wiggly', 'Jittery', 'Quivering', 'Shimmying', 'Trembling', 'Jelly-Legged', 'Shaky'],
    noun: ['Wobbler', 'Jiggler', 'Wiggles', 'Quiver', 'Shimmy', 'Jitterbug', 'Tremor', 'Wibble'],
    verb: ['Wobble', 'Jiggle', 'Wiggle', 'Shimmy', 'Quiver'],
    epi: ['the Wobbler', 'Who Never Stops Jiggling', 'of the Eternal Jiggle', 'the Quaking', 'the Unsteady', 'Who Dances Alone'],
    sp: ['tremulus', 'wobblensis', 'vibrans'],
    titles: ['DJ', 'MC', 'Professor'],
  },
  gooey: {
    adj: ['Gooey', 'Slimy', 'Oozy', 'Sticky', 'Gloopy', 'Drippy', 'Sloppy', 'Viscous', 'Gunky'],
    noun: ['Goo', 'Ooze', 'Gloop', 'Blob', 'Glorp', 'Splodge', 'Gunk', 'Sludge'],
    verb: ['Ooze', 'Drip', 'Gloop', 'Slurp', 'Stretch'],
    epi: ['the Oozing', 'Who Leaves a Trail', 'the Sticky-Fingered', 'the Unscrapeable', 'of the Long Strings', 'the Stringy'],
    sp: ['viscosus', 'gooeyensis', 'mucosus'],
    titles: ['Doctor', 'Count', 'Baron'],
  },
  tough: {
    adj: ['Tough', 'Stoic', 'Steadfast', 'Ironclad', 'Hardy', 'Rock-Solid', 'Gritty', 'Stalwart', 'Unbending'],
    noun: ['Brick', 'Block', 'Bulwark', 'Boulder', 'Tank', 'Fortress', 'Bastion', 'Anvil'],
    verb: ['Endure', 'Brace', 'Hold Fast', 'Stand Firm'],
    epi: ['the Unshakeable', 'the Unbreakable', 'Who Cannot Be Torn', 'the Indomitable', 'the Stubborn', 'Who Stands Firm'],
    sp: ['durissimus', 'robustus', 'invictus'],
    titles: ['General', 'Admiral', 'Sergeant', 'Commander'],
  },
  hefty: {
    adj: ['Hefty', 'Chonky', 'Weighty', 'Dense', 'Mighty', 'Massive', 'Burly', 'Beefy', 'Stout'],
    noun: ['Chonk', 'Unit', 'Heavyweight', 'Anchor', 'Lump', 'Boulder', 'Big Fella', 'Absolute Unit'],
    verb: ['Thud', 'Plonk', 'Flop', 'Stomp'],
    epi: ['the Heavy', 'the Immovable', 'Who Dents Floors', 'the Gravitational', 'of Considerable Mass', 'the Unliftable'],
    sp: ['ponderosus', 'gravis', 'maximus'],
    titles: ['Big', 'Lord', 'Chancellor', 'King', 'Queen'],
  },
  light: {
    adj: ['Featherweight', 'Airy', 'Floaty', 'Dainty', 'Breezy', 'Weightless'],
    noun: ['Feather', 'Puff', 'Cloud', 'Wisp', 'Balloon'],
    verb: ['Float', 'Drift', 'Glide'],
    epi: ['the Weightless', 'Who Floats', 'the Airborne', 'of the Breeze'],
    sp: ['levis', 'aerius'],
    titles: ['Little', 'Miss', 'Master'],
  },
  firm: {
    adj: ['Firm', 'Stern', 'Composed', 'Unflappable', 'Dignified', 'Serious', 'Poised', 'Stately'],
    noun: ['Gentleman', 'Diplomat', 'Butler', 'Statue', 'Monolith'],
    verb: ['Sit Still', 'Stay Put', 'Hold'],
    epi: ['the Composed', 'the Unflappable', 'Who Does Not Wobble', 'the Dignified', 'of Few Jiggles'],
    sp: ['firmus', 'stabilis'],
    titles: ['Sir', 'Dame', 'Mr.', 'Ms.', 'Butler'],
  },
};

const MATERIALS = {
  jello: { adj: ['Jellied', 'Wobbly', 'Classic'], noun: ['Jelly', 'Jello', 'Jiggler', 'Gelatin'], genus: 'Gelatinus', morph: 'Jell' },
  gummy: { adj: ['Gummy', 'Chewy', 'Bouncy'], noun: ['Gummy', 'Chewster', 'Gumdrop', 'Gummi'], genus: 'Gummius', morph: 'Gum' },
  sour: { adj: ['Sour', 'Tangy', 'Zesty', 'Puckered', 'Tart'], noun: ['Sourpuss', 'Zinger', 'Pucker', 'Tang'], genus: 'Acidulus', morph: 'Sour' },
  crystal: { adj: ['Crystal', 'Clear', 'Lucid', 'Pristine'], noun: ['Crystal', 'Gem', 'Jewel', 'Diamond'], genus: 'Crystallus', morph: 'Crystal' },
  creamy: { adj: ['Creamy', 'Velvet', 'Silken', 'Dreamy'], noun: ['Custard', 'Panna Cotta', 'Cream', 'Blancmange'], genus: 'Lacteus', morph: 'Cream' },
  slime: { adj: ['Slimy', 'Oozing', 'Toxic', 'Radioactive'], noun: ['Slime', 'Ooze', 'Glorp', 'Sludge'], genus: 'Muculentus', morph: 'Slime' },
  water: { adj: ['Splashy', 'Sloshy', 'Aqua', 'Soggy'], noun: ['Splash', 'Puddle', 'Tsunami', 'Wave'], genus: 'Aquosus', morph: 'Splash' },
  syrup: { adj: ['Syrupy', 'Treacly', 'Molten', 'Slow'], noun: ['Syrup', 'Molasses', 'Treacle', 'Honey'], genus: 'Siruposus', morph: 'Syrup' },
  mochi: { adj: ['Mochi', 'Pillowy', 'Stretchy'], noun: ['Mochi', 'Daifuku', 'Dumpling', 'Rice Cake'], genus: 'Oryzus', morph: 'Mochi' },
  marshmallow: { adj: ['Fluffy', 'Puffy', 'Toasty', 'Pillowy'], noun: ['Mallow', 'Puff', "S'more", 'Fluff'], genus: 'Malvaceus', morph: 'Mallow' },
  rubber: { adj: ['Rubbery', 'Elastic', 'Stretchy', 'Grippy'], noun: ['Superball', 'Bouncer', 'Eraser', 'Bounce House'], genus: 'Elasticus', morph: 'Rubber' },
  glass: { adj: ['Glassy', 'Clear', 'Fragile', 'Crystal'], noun: ['Pane', 'Window', 'Lens', 'Goblet'], genus: 'Vitreus', morph: 'Glass' },
  tofu: { adj: ['Silken', 'Firm', 'Soy', 'Humble'], noun: ['Tofu', 'Bean', 'Bean Curd', 'Block'], genus: 'Glycinus', morph: 'Tofu' },
  putty: { adj: ['Pliable', 'Mouldable', 'Silly', 'Slumpy'], noun: ['Putty', 'Blob', 'Lump', 'Dough'], genus: 'Plasticus', morph: 'Putty' },
  candy: { adj: ['Candied', 'Glossy', 'Sugary', 'Hard-Boiled'], noun: ['Jawbreaker', 'Lolly', 'Gobstopper', 'Bonbon', 'Boiled Sweet'], genus: 'Saccharus', morph: 'Candy' },
  sugar: { adj: ['Sugary', 'Sweet', 'Granulated', 'Sparkly'], noun: ['Sugarlump', 'Sugar Cube', 'Sweetie', 'Lump'], genus: 'Saccharum', morph: 'Sugar' },
  ice: { adj: ['Icy', 'Frosty', 'Frozen', 'Chilly', 'Glacial'], noun: ['Iceberg', 'Glacier', 'Frost', 'Icicle', 'Snowball'], genus: 'Glacialis', morph: 'Frost' },
  prism: { adj: ['Prismatic', 'Rainbow', 'Refracting', 'Spectral'], noun: ['Prism', 'Spectrum', 'Rainbow', 'Lightshow'], genus: 'Prismaticus', morph: 'Prism' },
  holo: { adj: ['Holographic', 'Shiny', 'Foil', 'Ultra-Rare'], noun: ['Hologram', 'Foil', 'Shiny', 'Rare Card'], genus: 'Hologrammus', morph: 'Holo' },
  pearl: { adj: ['Pearly', 'Lustrous', 'Nacreous', 'Gleaming'], noun: ['Pearl', 'Oyster', 'Nacre', 'Pearlie'], genus: 'Margaritus', morph: 'Pearl' },
  opal: { adj: ['Opaline', 'Galactic', 'Cosmic', 'Fiery'], noun: ['Opal', 'Nebula', 'Galaxy', 'Supernova'], genus: 'Opalinus', morph: 'Opal' },
  chrome: { adj: ['Chrome', 'Mirrored', 'Metallic', 'Polished', 'Liquid-Metal'], noun: ['Chrome', 'Mirror', 'Bot', 'Unit', 'Mech', 'Android'], genus: 'Chromius', morph: 'Chrome' },
};

// colour words by flavour (and by hue, for custom colours)
const FLAVOR_WORDS = {
  cherry: ['Cherry', 'Crimson', 'Scarlet', 'Ruby', 'Red'],
  lime: ['Lime', 'Emerald', 'Green', 'Verdant', 'Key Lime'],
  blue: ['Blue', 'Azure', 'Cobalt', 'Sapphire', 'Raspberry'],
  grape: ['Grape', 'Violet', 'Purple', 'Amethyst', 'Plum'],
  orange: ['Orange', 'Tangerine', 'Amber', 'Citrus', 'Marmalade'],
  lemon: ['Lemon', 'Golden', 'Sunny', 'Citron', 'Yellow'],
  watermelon: ['Watermelon', 'Pink', 'Rosy', 'Melon', 'Flamingo'],
  cola: ['Cola', 'Bronze', 'Caramel', 'Root Beer', 'Mahogany'],
};
const HUE_WORDS = [
  [0, ['Red', 'Scarlet', 'Ruby', 'Crimson']],
  [22, ['Orange', 'Tangerine', 'Copper', 'Ember']],
  [45, ['Golden', 'Amber', 'Honey', 'Mustard']],
  [60, ['Yellow', 'Lemon', 'Canary', 'Sunny']],
  [85, ['Lime', 'Chartreuse', 'Zesty']],
  [130, ['Green', 'Emerald', 'Jade', 'Mint']],
  [170, ['Teal', 'Turquoise', 'Lagoon', 'Aqua']],
  [200, ['Sky', 'Cerulean', 'Azure', 'Ice-Blue']],
  [225, ['Blue', 'Cobalt', 'Sapphire', 'Navy']],
  [260, ['Indigo', 'Violet', 'Ultraviolet']],
  [285, ['Purple', 'Amethyst', 'Plum', 'Grape']],
  [315, ['Magenta', 'Fuchsia', 'Orchid']],
  [340, ['Pink', 'Rose', 'Flamingo', 'Bubblegum']],
  [361, ['Red', 'Scarlet', 'Ruby', 'Crimson']],
];
const LAYER_WORDS = ['Rainbow', 'Striped', 'Layered', 'Kaleidoscope', 'Stratified', 'Technicolor', 'Multi-Storey', 'Parfait'];
const EDGE_WORDS = {
  sharp: ['Edgy', 'Sharp', 'Pointy', 'Crisp', 'Angular', 'Razor'],
  soft: ['Soft-Cornered', 'Gentle', 'Mellow'],
  round: ['Rounded', 'Smooth', 'Well-Rounded'],
  pillow: ['Puffy', 'Pillowy', 'Plump', 'Cushy', 'Marshmallowy'],
};
const GLITTER_WORDS = {
  silver: ['Sparkly', 'Glittering', 'Silvery', 'Twinkling'],
  gold: ['Golden', 'Gilded', 'Glam', 'Bling'],
  holo: ['Holo', 'Iridescent', 'Disco', 'Glimmering'],
  rose: ['Rosé', 'Blushing', 'Rose-Gold'],
  cubic: ['Zirconia', 'Bejewelled', 'Diamond-Studded', 'Bedazzled'],
};

// names to call it (first names, cube-ified) and surnames
const FIRST = [
  'Cubert', 'Cubella', 'Cubrina', 'Cubey', 'Cubby', 'Cubric', 'Cubelia', 'Cubastian', 'Cubrielle', 'Cubiana', 'Cubio',
  'Blockwell', 'Boxley', 'Hexley', 'Hexander', 'Tessa', 'Jiggles', 'Wobbleton', 'Jellington', 'Gelatina', 'Gelbert',
  'Gelvin', 'Jellyanne', 'Wobbelina', 'Squishley', 'Bouncelot', 'Boingsworth', 'Gloopert', 'Oozwald', 'Gooberta',
  'Jigsby', 'Jellybeth', 'Quiveria', 'Blobert', 'Blobette', 'Squarles', 'Gummo', 'Wibbles', 'Jellicoe', 'Wobbert',
];
const SURNAME = [
  'McCube', 'von Wobble', 'Jigglesworth', 'Cubington', 'de la Jelly', "O'Jiggle", 'Squishman', 'Bouncewell',
  'Gloopstein', 'Blockley', 'Cubeski', 'van Jello', 'Wobblebottom', 'Quiverton', 'Gelatinski', 'Boxworth',
  'Cubewell', 'Jellyfield', 'Wigglesby', 'Squarington', 'Hexworth', 'Gelderberg', 'Cubanovich', 'Jellinek',
];
const SURNAME_BY = {
  sharp: ['Edgerton', 'Sharpe', 'Cornersby'], pillow: ['Pillowby', 'Puffington', 'Cushman'],
  glass: ['Glassington', 'Paneworth'], ice: ['Frostington', 'Icelby'], sugar: ['Sugarby', 'Sweetwater'],
  chrome: ['Steele', 'Chromwell'], gold: ['Goldsworth', 'Gilderoy'], slime: ['Sludgeworth', 'Oozely'],
  rubber: ['Bounceby', 'Rebounder'], candy: ['Lollington', 'Bonbonne'], pearl: ['Pearlman', 'Oysterby'],
};
const TITLES = ['Sir', 'Dame', 'Lord', 'Lady', 'Captain', 'Professor', 'Doctor', 'Baron', 'Duchess', 'Count', 'Countess', 'Admiral', 'Señor', 'Madame', 'Agent', 'Detective', 'Chef', 'Saint', 'Prince', 'Princess'];
const FANCY_TITLES = ['Duke', 'Duchess', 'Baron', 'Baroness', 'Countess', 'Marquis', 'His Wobbliness', 'Her Jiggliness'];
const SUFFIX = ['II', 'III', 'IV', 'VII', 'IX', 'XII', 'Jr.', 'Sr.', 'the Third', 'Esq.', 'PhD', 'MBE', 'the Younger', 'the Elder'];
const GENERIC_EPI = ['the Magnificent', 'the Cube', 'of Many Sides', 'the Six-Sided', 'the Perfectly Square', 'Who Fits Any Box', 'the Right-Angled', 'the Gelatinous', 'the Great', 'the Bold', 'the Wobbleheart', 'of the Cubicle'];
const CUBE_MORPHS = ['cube', 'block', 'brick', 'hedron', 'box', 'bit'];
const ROBOT_NUMS = ['3000', '9000', '64', '128', '2000', 'XL', 'Mk II', 'X', '5000', 'Prime', 'Ultra', 'GT'];
const PLURALS = ['Cubes', 'Jigglers', 'Wobbles', 'Blocks', 'Squares', 'Gels', 'Hexahedrons', 'Cubettes'];

// legendary: what it's survived (by its record), or what it fears not
const LEGEND = [
  'Breaker of Spoons', 'Devourer of Forks', 'First of the Jiggle', 'Keeper of the Sacred Wobble', 'Last of the Jello Benders',
  'Who Was Promised', 'Dreamer of Electric Jelly', 'Heir to the Cubic Throne', 'Who Walks Between Plates',
];
const LEGEND_BY_REC = {
  cuts: ['Survivor of a Thousand Knives', 'Bane of Knives', 'Who Laughed at the Blade'],
  tears: ['the Twice-Torn', 'Who Was Torn and Rose Again'],
  diced: ['Who Survived the Dicer', 'Undiceable in Spirit'],
  shots: ['Who Took the Nails', 'Pincushion of Legend'],
  booms: ['Who Ate the Cherry Bomb', 'the Unexploded', 'Who Walks Away From Explosions'],
  healed: ['the Ever-Returning', 'the Re-Cubed', 'Who Always Comes Back'],
};

// phrase puns with slots: {V} verb, {A} adjective, {N} noun, {F} flavour word, {M} material noun
const PHRASES = [
  '{V} All the Way', 'Born to {V}', 'Cube Me Maybe', '{V} Like Nobody’s Watching', 'The Fast and the {A}', 'Mission: {A}',
  '{N} Force One', 'Ctrl+Alt+{V}', '404: {N} Not Found', '{F}geddon', 'Gone With the {N}', 'Livin’ la Vida {M}',
  'Don’t Stop Me {Ving}', 'Singin’ and {Ving}', '{Ving} on Sunshine', 'Return of the {N}', 'The {N} Strikes Back', 'Honey, I Cubed the {N}', '{F} Fields Forever',
  'Total {N} of the Heart', 'Eye of the {N}', 'Smells Like {F} Spirit', 'Close Encounters of the {N} Kind', 'Ghost in the {N}',
  '{A} and Proud', 'Keep Calm and {V} On', 'Shake, Rattle & {V}', 'Hello, {N}', 'Big {N} Energy', 'Main {N} Energy',
];
const DESSERTS = ['{F} {M} Supreme', '{F} Surprise', 'Chef’s {F} Special', '{F} à la Mode', 'Grand {F} Soufflé', '{F} {M} Deluxe', 'The {F} Sundae Best', 'Le {F} Flambé'];

// ---------------------------------------------------------------- helpers
const pick = (rnd, a) => a[Math.floor(rnd() * a.length)];
// bounce -> bouncing, hop -> hopping, squish -> squishing
const ing = (v) => {
  const w = v.split(' ')[0];
  if (/[^e]e$/.test(w)) return w.slice(0, -1) + 'ing' + v.slice(w.length);
  if (/^[^aeiou]*[aeiou][bdgmnprt]$/i.test(w) && w.length <= 4) return w + w.slice(-1) + 'ing' + v.slice(w.length);
  return w + 'ing' + v.slice(w.length);
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// weighted pick of [item, weight]
function choose(rnd, pairs) {
  let t = 0;
  for (const [, w] of pairs) t += Math.max(0, w);
  let r = rnd() * t;
  for (const [x, w] of pairs) {
    r -= Math.max(0, w);
    if (r <= 0) return x;
  }
  return pairs[pairs.length - 1][0];
}

function hueOf(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: mx > 0 ? d / mx : 0, v: mx };
}

function colourWords(hex) {
  const { h, s, v } = hueOf(hex);
  if (v < 0.18) return ['Midnight', 'Jet', 'Shadow', 'Obsidian'];
  if (s < 0.14) return v > 0.8 ? ['White', 'Snowy', 'Ghostly', 'Pale'] : ['Grey', 'Silver', 'Slate', 'Ashen'];
  for (let i = 0; i < HUE_WORDS.length - 1; i++) if (h < (HUE_WORDS[i][0] + HUE_WORDS[i + 1][0]) / 2) return HUE_WORDS[i][1];
  return HUE_WORDS[0][1];
}

// ---------------------------------------------------------------- traits
// What this cube is, as weights 0..1, and the words for its colour etc.
export function cubeTraits(c, rec = null) {
  const stats = Object.fromEntries(cubeStats(c).map(([k, v]) => [k, v / 100]));
  const T = {
    bouncy: stats.Bounce ** 1.5,
    squishy: stats.Squish ** 1.5,
    wobbly: stats.Wobble ** 1.5,
    gooey: stats.Goo ** 1.5,
    tough: stats.Tough ** 1.5,
    hefty: Math.max(0, stats.Heft - 0.45) * 1.8,
    light: Math.max(0, 0.4 - stats.Heft) * 2.5,
    firm: Math.max(0, 0.35 - stats.Wobble) * Math.max(0, 0.4 - stats.Squish) * 6,
  };
  const tune = c.tune || {};
  const size = tune.size ?? 1;
  const flavor = String(c.flavor || 'cherry');
  const colours = flavor === 'layers'
    ? LAYER_WORDS
    : flavor.startsWith('#') ? colourWords(flavor) : FLAVOR_WORDS[flavor] || ['Jelly'];
  const flavorWord = flavor === 'layers' ? 'Rainbow' : flavor.startsWith('#') ? colourWords(flavor)[0] : (FLAVOR_WORDS[flavor] || ['Jelly'])[0];
  return {
    flavor,
    stats,
    T,
    mat: MATERIALS[c.texture] || MATERIALS.jello,
    texture: c.texture || 'jello',
    colours,
    flavorWord,
    edges: EDGE_WORDS[c.edges] || [],
    edgeKey: c.edges,
    glitter: GLITTER_WORDS[c.glitter] || [],
    glitterKey: c.glitter,
    small: size < 0.85,
    big: size > 1.15,
    lowG: tune.gravity !== undefined && tune.gravity < 6,
    highG: tune.gravity !== undefined && tune.gravity > 14,
    dark: c.theme === 'dark',
    tearless: c.tear === false,
    rec: rec || null,
  };
}

// ---------------------------------------------------------------- the name
// (rnd: 0..1; taken: names not to use)
export function nameCube(c, { taken = [], rnd = Math.random, rec = null } = {}) {
  const tr = cubeTraits(c || { flavor: 'cherry', texture: 'jello' }, rec);
  const used = new Set(taken.map((n) => String(n).toLowerCase()));
  for (let tries = 0; tries < 40; tries++) {
    const name = tidy(compose(tr, rnd));
    if (name.length >= 3 && name.length <= 30 && !used.has(name.toLowerCase())) return name;
  }
  // (all taken: a sequel)
  const base = tidy(compose(tr, rnd)).slice(0, 26);
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

function tidy(s) {
  return s.replace(/\s+/g, ' ').replace(/\s([,.!?])/g, '$1').trim();
}

// one name, by one of the kinds
function compose(tr, rnd) {
  const T = tr.T;
  // its leading trait (weighted: the stronger, the likelier, but not always)
  const traitKey = choose(rnd, Object.entries(T).map(([k, w]) => [k, 0.03 + w * w * 3]));
  const trait = TRAITS[traitKey];
  const adjOf = () => choose(rnd, [
    [() => pick(rnd, trait.adj), 3],
    [() => pick(rnd, tr.mat.adj), 1.6],
    [() => pick(rnd, tr.colours), 1.8],
    [() => pick(rnd, tr.edges.length ? tr.edges : trait.adj), tr.edges.length && tr.edgeKey !== 'round' ? 1.2 : 0.2],
    [() => pick(rnd, tr.glitter.length ? tr.glitter : trait.adj), tr.glitter.length ? 1.3 : 0],
    [() => pick(rnd, ['Lil’', 'Tiny', 'Mini', 'Wee', 'Bitty']), tr.small ? 1.2 : 0],
    [() => pick(rnd, ['Big', 'Mega', 'Grand', 'Colossal', 'Jumbo']), tr.big ? 1.2 : 0],
    [() => pick(rnd, ['Lunar', 'Astro', 'Zero-G', 'Orbital']), tr.lowG ? 1.4 : 0],
    [() => pick(rnd, ['Midnight', 'Nocturnal', 'Neon', 'Glow-in-the-Dark']), tr.dark ? 0.9 : 0],
  ])();
  const nounOf = () => choose(rnd, [
    [() => pick(rnd, trait.noun), 2.5],
    [() => pick(rnd, tr.mat.noun), 2],
    [() => pick(rnd, ['Cube', 'Block', 'Brick', 'Square', 'Hexahedron', 'Cuboid']), 1.2],
  ])();
  const firstOf = () => pick(rnd, FIRST);
  const surnameOf = () => {
    const by = [...(SURNAME_BY[tr.texture] || []), ...(SURNAME_BY[tr.edgeKey] || []), ...(SURNAME_BY[tr.glitterKey] || [])];
    return by.length && rnd() < 0.45 ? pick(rnd, by) : pick(rnd, SURNAME);
  };
  const epiOf = () => (rnd() < 0.72 ? pick(rnd, trait.epi) : rnd() < 0.5 && tr.tearless ? 'the Untearable' : pick(rnd, GENERIC_EPI));
  const titleOf = () => {
    if ((tr.glitterKey === 'gold' || tr.texture === 'chrome' || tr.texture === 'pearl') && rnd() < 0.5) return pick(rnd, FANCY_TITLES);
    return rnd() < 0.55 ? pick(rnd, trait.titles) : pick(rnd, TITLES);
  };
  // alliteration, when it's on offer: a first name with the adjective's letter
  const allit = (word, list) => {
    const l = list.filter((x) => x[0] === word[0]);
    return l.length && rnd() < 0.6 ? pick(rnd, l) : pick(rnd, list);
  };

  // a legendary name, now and then (more for a storied cube)
  const storied = tr.rec ? Object.keys(LEGEND_BY_REC).filter((k) => (tr.rec[k] || 0) >= (k === 'healed' ? 10 : 5)) : [];
  if (rnd() < 0.025 + storied.length * 0.03) {
    const deeds = storied.flatMap((k) => LEGEND_BY_REC[k]);
    const deed = deeds.length && rnd() < 0.7 ? pick(rnd, deeds) : pick(rnd, LEGEND);
    return deed.startsWith('the ') ? `${firstOf()} ${deed}` : `${firstOf()}, ${deed}`;
  }

  const kinds = [
    // a pun on its flavour or material (the curated ones)
    ['pun', 2.2],
    ['adjNoun', 3],
    ['titleName', 2.4],
    ['nameEpithet', 2.2],
    ['fullName', 1.4],
    ['regal', 1.1],
    ['wrestler', 0.9],
    ['robot', tr.texture === 'chrome' || tr.texture === 'holo' ? 2.4 : 0.6],
    ['band', 0.8],
    ['latin', 0.9],
    ['dessert', ['creamy', 'syrup', 'candy', 'sugar', 'mochi', 'marshmallow', 'gummy', 'sour'].includes(tr.texture) ? 1.6 : 0.6],
    ['ship', 0.6],
    ['portmanteau', 1.4],
    ['phrase', 1.6],
    ['superhero', 1.0],
  ];
  const kind = choose(rnd, kinds);
  const A = adjOf(), N = nounOf();
  switch (kind) {
    case 'pun':
      return pick(rnd, punsFor({ flavor: tr.flavor, texture: tr.texture }));
    case 'adjNoun':
      return `${A} ${N}`;
    case 'titleName':
      return `${titleOf()} ${rnd() < 0.5 ? allit(A, FIRST) : firstOf()}`;
    case 'nameEpithet':
      return `${rnd() < 0.5 ? allit(A, FIRST) : firstOf()} ${epiOf()}`;
    case 'fullName':
      return `${firstOf()} ${surnameOf()}`;
    case 'regal':
      return `${rnd() < 0.5 ? titleOf() + ' ' : ''}${firstOf()} ${pick(rnd, SUFFIX)}`;
    case 'wrestler': {
      const nick = rnd() < 0.5 ? `The ${pick(rnd, trait.noun)}` : `${pick(rnd, trait.adj)}`;
      return `${firstOf()} “${nick}” ${rnd() < 0.5 ? pick(rnd, SURNAME) : ''}`;
    }
    case 'robot': {
      const m = rnd() < 0.5 ? tr.mat.morph : pick(rnd, trait.verb).split(' ')[0];
      return rnd() < 0.5 ? `${m}tron ${pick(rnd, ROBOT_NUMS)}` : `${cap(m)}-${pick(rnd, ['X', 'Z', 'Q', 'J', 'K'])}${Math.floor(rnd() * 90 + 10)}`;
    }
    case 'band':
      return rnd() < 0.5 ? `The ${A} ${pick(rnd, PLURALS)}` : `${firstOf()} & the ${pick(rnd, PLURALS)}`;
    case 'latin':
      return `${tr.mat.genus} ${pick(rnd, [...trait.sp, 'cubicus', 'quadratus', 'gelatinosus', tr.big ? 'maximus' : tr.small ? 'minimus' : 'vulgaris'])}`;
    case 'dessert':
      return pick(rnd, DESSERTS).replace('{F}', tr.flavorWord).replace('{M}', pick(rnd, tr.mat.noun));
    case 'ship':
      return `${pick(rnd, ['HMS', 'SS', 'USS'])} ${rnd() < 0.5 ? A : firstOf()}${rnd() < 0.4 ? ' ' + N : ''}`;
    case 'portmanteau': {
      const stem = rnd() < 0.6 ? pick(rnd, trait.verb).split(' ')[0] : tr.mat.morph;
      return `${cap(stem)}${pick(rnd, CUBE_MORPHS)}${rnd() < 0.3 ? ' ' + pick(rnd, ROBOT_NUMS) : ''}`;
    }
    case 'phrase': {
      // (one-word verbs: "Keep Calm and Stay Put On" didn't scan)
      const one = trait.verb.filter((w) => !w.includes(' '));
      const v = pick(rnd, one.length ? one : ['Jiggle', 'Wobble']);
      return pick(rnd, PHRASES).replace('{Ving}', ing(v)).replace('{V}', v).replace('{A}', A).replace('{N}', N).replace('{F}', tr.flavorWord).replace('{M}', pick(rnd, tr.mat.noun));
    }
    case 'superhero':
      return pick(rnd, [`Captain ${N}`, `The Incredible ${N}`, `Doctor ${cap(pick(rnd, trait.verb).split(' ')[0])}`, `The Amazing ${A} ${N}`, `${N} Kid`, `Mega${N.split(' ')[0].toLowerCase()}`]);
    default:
      return `${A} ${N}`;
  }
}
