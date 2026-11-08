// The name generator: needlessly, scarily thorough. A cube's name comes out
// of everything it is and everything round it:
//  - its colours, matched by eye against ~150 named colours (cherry,
//    coral, pistachio, periwinkle, oxblood...), and for layered jelly its
//    whole palette - recognised (Neapolitan, Fire & Ice, Candy Cane, a
//    preset...) or described (pastel, neon, earthy, jewel-toned, mono...);
//  - its pattern: stripes or ombré, bullseye, jawbreaker, tree rings,
//    tie-dye or marble, a diagonal, a two-tone split, checkerboard tiles;
//  - its material and every finish slider: clear or milky, glowing,
//    glossy or matte, brilliant, iridescent, metal, opal, fizzing with
//    bubbles, glitter (and how much, how big, how sparkly);
//  - its feel (Squish, Bounce, Wobble, Goo, Tough, Heft - and the extremes),
//    its grip and air drag, size, edges, gravity, whether it tears;
//  - where it is (the place), glow mode, the season and the day;
//  - its family: the parent it split from, its generation, its twin, what
//    mutated in it when it was born;
//  - what it's been through (its record: cut, shot, melted, eaten by acid...).
// Each of those weighs as much as it's remarkable in this cube. Dozens of
// kinds of name - puns, titles, epithets, paint chips, gemstones, jello
// shots, cocktails, wrestlers, robots, bands, ships, racehorses, Latin
// binomials, heirs and twins, legends - each draws on a few of them; a
// handful are made, scored by how much of what makes this cube itself they
// catch (and how well they read), and one is picked, the best likeliest.
// The same cube, context and roll give the same name (seeded); the die
// rolls a new seed.

import { cubeStats } from './cubecode.js';
import { punsFor } from './puns.js';
import { TEXTURES, LAYER_PRESETS } from './styles.js';

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

// ---------------------------------------------------------------- colour
// ~150 named colours (name : hex : family [: f - it's a food, so a noun])
const NAMED = `Cherry:d4102a:red:f Crimson:b0102c:red Scarlet:ff2400:red Ruby:9b111e:red Cardinal:c41e3a:red
Pillar-Box:ce2029:red Tomato:ff6347:red:f Raspberry:e30b5c:red:f Strawberry:fc5a8d:pink:f Oxblood:4a0000:red
Maroon:800000:red Burgundy:800020:red Wine:722f37:red Garnet:733635:red Brick:a23b2c:red Pomegranate:c0392b:red:f
Tangerine:f28500:orange:f Pumpkin:ff7518:orange:f Carrot:ed9121:orange:f Mango:ffb347:orange:f Apricot:fbceb1:orange:f
Peach:ffcba4:orange:f Coral:ff7f50:orange Salmon:fa8072:pink Amber:ffbf00:orange Marmalade:e8730a:orange:f
Copper:b87333:orange Rust:b7410e:orange Persimmon:ec5800:orange:f Clementine:e96e00:orange:f Cantaloupe:ffa62f:orange:f
Lemon:fff44f:yellow:f Canary:ffef00:yellow Banana:ffe135:yellow:f Butter:fff7a0:yellow:f Sunflower:ffda03:yellow
Gold:ffd700:yellow Honey:eba937:yellow:f Mustard:e1ad01:yellow:f Saffron:f4c430:yellow:f Daffodil:ffff31:yellow
Champagne:f7e7ce:yellow Ochre:cc7722:brown Custard:fffdd0:yellow:f Butterscotch:e09540:orange:f
Lime:32cd32:green:f Key-Lime:e8f48c:green:f Chartreuse:7fff00:green Pistachio:93c572:green:f Kiwi:8ee53f:green:f
Apple:8db600:green:f Pea:8bb174:green:f Emerald:50c878:green Jade:00a86b:green Mint:98ff98:green:f Seafoam:9fe2bf:teal
Sage:9caf88:green:f Olive:808000:green:f Moss:8a9a5b:green Fern:4f7942:green Forest:228b22:green Pine:01796f:green
Shamrock:009e60:green Basil:579229:green:f Avocado:568203:green:f Matcha:98b46b:green:f Slime-Green:65ff00:green
Teal:008080:teal Turquoise:40e0d0:teal Aqua:00ffff:teal Cyan:00b7eb:teal Lagoon:4cb7a5:teal Peacock:33a1c9:teal
Tiffany:81d8d0:teal Glacier:78b1bf:blue Ice:bfefff:blue Sky:87ceeb:blue Baby-Blue:89cff0:blue Cornflower:6495ed:blue
Azure:007fff:blue Cerulean:007ba7:blue Cobalt:0047ab:blue Sapphire:0f52ba:blue Royal-Blue:4169e1:blue Navy:000080:blue
Midnight:191970:blue Denim:1560bd:blue Steel-Blue:4682b4:blue Periwinkle:ccccff:blue Blueberry:4f86f7:blue:f
Ultramarine:3f00ff:blue Electric-Blue:7df9ff:teal Powder-Blue:b0e0e6:blue Indigo:4b0082:purple
Violet:8f00ff:purple Lavender:b57edc:purple Lilac:c8a2c8:purple Plum:8e4585:purple:f Grape:6f2da8:purple:f
Amethyst:9966cc:purple Orchid:da70d6:pink Mauve:e0b0ff:purple Eggplant:614051:purple:f Ube:8878c3:purple:f
Blackberry:4d0135:purple:f Royal-Purple:7851a9:purple Wisteria:c9a0dc:purple Heliotrope:df73ff:purple
Bubblegum:ffc1cc:pink:f Flamingo:fc8eac:pink Hot-Pink:ff69b4:pink Fuchsia:ff00ff:pink Magenta:ff0090:pink Rose:ff007f:pink
Blush:de5d83:pink Cotton-Candy:ffbcd9:pink:f Watermelon:fd4659:pink:f Taffy:fa86c4:pink:f Cerise:de3163:pink
Peony:e2aec0:pink Ballet-Pink:f2c4ce:pink Shrimp:ff8f87:pink:f
Cola:3c1a0e:brown:f Chocolate:7b3f00:brown:f Cocoa:875f42:brown:f Caramel:c68e17:brown:f Toffee:9c6a40:brown:f
Coffee:6f4e37:brown:f Mocha:967969:brown:f Cinnamon:d2691e:brown:f Chestnut:954535:brown:f Hazelnut:ae7c4f:brown:f
Walnut:773f1a:brown:f Bronze:cd7f32:brown Tan:d2b48c:brown Sand:c2b280:brown Biscuit:ffe4c4:yellow:f
Gingerbread:b06500:brown:f Root-Beer:290e05:brown:f Espresso:3c2218:brown:f Fudge:5d3a1a:brown:f
Snow:fffafa:white Ivory:fffff0:white Cream:fffdd0:white:f Pearl:eae0c8:white Bone:e3dac9:white Coconut:f4f0e6:white:f
Silver:c0c0c0:grey Ash:b2beb5:grey Slate:708090:grey Charcoal:36454f:grey Graphite:383838:black Jet:343434:black
Obsidian:0b1215:black Onyx:353839:black Smoke:738276:grey Ghost-White:f8f8ff:white Fog:d7d0c8:grey Pewter:8e9294:grey
Licorice:1a1110:black:f Ink:1b1b2f:black`
  .split(/\s+/)
  .filter(Boolean)
  .map((s) => {
    const [name, hex, fam, f] = s.split(':');
    return { name: name.replace(/-/g, ' '), hex: '#' + hex, fam, food: f === 'f', lab: labOf('#' + hex) };
  });

function rgbOf(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
// CIE Lab (D65) - colours compared as eyes see them
function labOf(hex) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgbOf(hex).map(lin);
  const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, Y = r * 0.2126 + g * 0.7152 + b * 0.0722, Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function hsvOf(hex) {
  const [r, g, b] = rgbOf(hex);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: mx > 0 ? d / mx : 0, v: mx };
}
// the named colours nearest a colour, nearest first
function nearest(hex, n = 3) {
  const L = labOf(hex);
  return NAMED.map((c) => ({ c, d: Math.hypot(c.lab[0] - L[0], c.lab[1] - L[1], c.lab[2] - L[2]) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n);
}
// one colour, read: its names (nearest first), family, and how it looks
function readColour(hex) {
  const near = nearest(hex, 3), { s, v } = hsvOf(hex), L = labOf(hex);
  const chroma = Math.hypot(L[1], L[2]);
  return {
    hex,
    names: near.map((x) => x.c.name),
    foods: near.filter((x) => x.c.food).map((x) => x.c.name),
    fam: near[0].c.fam,
    light: L[0],
    chroma,
    pastel: L[0] > 76 && chroma < 45 && chroma > 8,
    neon: s > 0.85 && v > 0.9 && chroma > 70,
    dark: L[0] < 28,
    muted: chroma < 22,
  };
}

// ---------------------------------------------------------------- palettes
// named palettes, by the families they're made of (all of need; at most
// `max` families in all; light: all of them light)
const PALETTES = [
  { name: 'Neapolitan', need: [['pink', 'red'], ['white', 'yellow'], ['brown']], max: 3, nouns: ['Neapolitan', 'Triple Scoop'] },
  { name: 'Candy Cane', need: [['red'], ['white']], max: 2, nouns: ['Candy Cane', 'Peppermint', 'Barber Pole'], striped: true },
  { name: 'Peppermint', need: [['red', 'pink'], ['white'], ['green']], max: 3, nouns: ['Peppermint Twist', 'Humbug'] },
  { name: 'Christmas', need: [['red'], ['green']], max: 3, nouns: ['Yule Log', 'Tinsel', 'Mistletoe', 'Stocking Filler'] },
  { name: 'Halloween', need: [['orange'], ['black', 'purple']], max: 3, nouns: ['Jack-o’-Lantern', 'Candy Corn', 'Trick-or-Treat'] },
  { name: 'Candy Corn', need: [['yellow'], ['orange'], ['white']], max: 3, nouns: ['Candy Corn'] },
  { name: 'Bumblebee', need: [['yellow'], ['black']], max: 2, nouns: ['Bumblebee', 'Hazard Tape', 'Wasp'] },
  { name: 'Watermelon', need: [['red', 'pink'], ['green']], max: 3, nouns: ['Watermelon', 'Melon Slice'] },
  { name: 'Fire & Ice', need: [['red', 'orange'], ['blue', 'teal']], max: 4, nouns: ['Fire & Ice', 'Hot & Cold', 'Frostbite'] },
  { name: 'Cotton Candy', need: [['pink'], ['blue', 'teal', 'purple']], max: 3, light: true, nouns: ['Cotton Candy', 'Candy Floss', 'Fairy Floss'] },
  { name: 'Mint Choc Chip', need: [['green', 'teal'], ['brown']], max: 2, nouns: ['Mint Choc Chip', 'After Eight'] },
  { name: 'Stars & Stripes', need: [['red'], ['white'], ['blue']], max: 3, nouns: ['Star-Spangled', 'Union Jack', 'Tricolour'] },
  { name: 'Royal', need: [['purple'], ['yellow']], max: 2, nouns: ['Crown Jewel', 'Royal Seal', 'Coronation'] },
  { name: 'Toxic', need: [['green'], ['purple', 'black']], max: 3, nouns: ['Toxic Waste', 'Nuclear Sludge', 'Biohazard'] },
  { name: 'Galaxy', need: [['blue', 'purple', 'black'], ['pink', 'purple'], ['blue', 'black']], max: 4, nouns: ['Nebula', 'Galaxy', 'Cosmos', 'Stardust'] },
  { name: 'Forest', need: [['green'], ['brown']], max: 3, nouns: ['Forest Floor', 'Woodland', 'Camo'] },
  { name: 'Sherbet', need: [['orange'], ['pink'], ['yellow', 'green']], max: 4, light: true, nouns: ['Sherbet', 'Rainbow Sherbet', 'Sorbet'] },
  { name: 'Lagoon', need: [['blue'], ['teal']], max: 3, nouns: ['Lagoon', 'Coral Reef', 'Tide Pool', 'Deep End'] },
  { name: 'Sunrise', need: [['yellow'], ['orange'], ['red', 'pink']], max: 4, nouns: ['Tequila Sunrise', 'Daybreak', 'Sunrise'] },
  { name: 'Berry', need: [['purple'], ['pink', 'red']], max: 3, nouns: ['Mixed Berry', 'Berry Crumble', 'Summer Pudding'] },
  { name: 'Seaside', need: [['blue', 'teal'], ['white'], ['yellow', 'brown']], max: 4, nouns: ['Seaside', 'Beach Towel', 'Deckchair'] },
  { name: 'Peaches & Cream', need: [['orange', 'pink'], ['white', 'yellow']], max: 2, light: true, nouns: ['Peaches & Cream'] },
  { name: 'Strawberries & Cream', need: [['red', 'pink'], ['white']], max: 2, nouns: ['Strawberries & Cream', 'Eton Mess'] },
  { name: 'Blueberry Lemon', need: [['blue'], ['yellow']], max: 2, nouns: ['Blueberry Lemonade', 'Blue Moon'] },
  { name: 'Oil Slick', need: [['purple'], ['teal', 'green'], ['black', 'blue']], max: 4, nouns: ['Oil Slick', 'Beetle Shell'] },
];
// the presets' names, by their colours
function presetOf(L) {
  const key = (L.colors || []).map((h) => String(h).toLowerCase()).join('');
  let best = null, bd = Infinity;
  for (const p of LAYER_PRESETS) {
    if (p.colors.join('').toLowerCase() !== key) continue;
    const d = Math.abs((p.blur || 0) - (L.blur || 0)) + Math.abs((p.repeat || 1) - (L.repeat || 1)) + ((p.shape || 'up') !== (L.shape || 'up') ? 1 : 0);
    if (d < bd) [best, bd] = [p, d];
  }
  return best;
}
const PRESET_WORDS = {
  rainbow: ['Rainbow', 'Technicolor', 'Over-the-Rainbow'], pastel: ['Pastel', 'Easter', 'Macaron'], spectrum: ['Spectrum', 'Full-Spectrum', 'Prismatic'],
  stripes: ['Stripy', 'Pinstriped', 'Banded'], sunset: ['Sunset', 'Dusk', 'Golden-Hour'], ocean: ['Ocean', 'Deep-Sea', 'Tidal'],
  aurora: ['Aurora', 'Northern-Lights', 'Borealis'], fire: ['Fire', 'Inferno', 'Molten'], berry: ['Berry', 'Bramble', 'Jammy'],
  tropic: ['Tropical', 'Tiki', 'Paradise'], neon: ['Neon', 'Highlighter', 'Rave'], candy: ['Candy-Striped', 'Peppermint', 'Barber-Pole'],
  duo: ['Two-Tone', 'Duet', 'Double-Act'], jawbreaker: ['Jawbreaker', 'Gobstopper', 'Everlasting'], hotcore: ['Sunburst', 'Molten-Core', 'Fireball'],
  agate: ['Agate', 'Geode', 'Banded'], prism: ['Prism', 'Refracted', 'Spectral'],
};
const RUBIK_WORDS = ['Rubik', 'Scrambled', 'Puzzling', 'Twisty', 'Speedcubed', 'Six-Colour', 'Unsolved', 'Shuffled'];
const RUBIK_NOUNS = ['Puzzle', 'Speedcube', 'Brain-Teaser', 'Twisty Puzzle', 'Enigma', 'Rubik'];

// ---------------------------------------------------------------- patterns
// a gradient's look, by its shape (and blend, repeats, tiles)
const PATTERN = {
  up: { adj: ['Layered', 'Stacked', 'Striped', 'Banded', 'Stratified'], noun: ['Parfait', 'Layer Cake', 'Trifle', 'Strata', 'Sediment', 'Jello Shot'] },
  upSoft: { adj: ['Ombré', 'Faded', 'Dip-Dyed', 'Gradient', 'Blended'], noun: ['Ombré', 'Sunrise', 'Fade', 'Horizon'] },
  across: { adj: ['Two-Faced', 'Split', 'Half-and-Half', 'Sideways', 'Lopsided'], noun: ['Split Personality', 'Half-and-Half', 'Mullet', 'Harlequin'] },
  corner: { adj: ['Diagonal', 'Slanted', 'Corner-to-Corner', 'Askew'], noun: ['Diagonal', 'Slant', 'Hypotenuse'] },
  core: { adj: ['Bullseye', 'Ringed', 'Haloed', 'Targeted'], noun: ['Bullseye', 'Target', 'Iris', 'Eye of the Storm', 'Halo'] },
  shell: { adj: ['Nested', 'Concentric', 'Onion-Skinned', 'Russian-Doll'], noun: ['Jawbreaker', 'Gobstopper', 'Matryoshka', 'Onion', 'Nesting Doll'] },
  rings: { adj: ['Ringed', 'Rippled', 'Contoured', 'Growth-Ringed'], noun: ['Tree Ring', 'Agate', 'Ripple', 'Contour Map', 'Fingerprint'] },
  free: { adj: ['Marbled', 'Swirled', 'Splotchy', 'Painted', 'Mottled'], noun: ['Marble', 'Swirl', 'Watercolour', 'Lava Lamp', 'Splodge'] },
  freeLoud: { adj: ['Tie-Dyed', 'Psychedelic', 'Groovy', 'Kaleidoscopic'], noun: ['Tie-Dye', 'Lava Lamp', 'Kaleidoscope', 'Woodstock'] },
  freeCamo: { adj: ['Camouflaged', 'Dappled'], noun: ['Camo', 'Ghillie Suit'] },
  tiles: { adj: ['Checkered', 'Tiled', 'Patchwork', 'Pixelated', 'Quilted'], noun: ['Checkerboard', 'Patchwork', 'Quilt', 'Mosaic', 'Pixel'] },
  gingham: { adj: ['Gingham', 'Picnic-Checked'], noun: ['Gingham', 'Tablecloth', 'Picnic Blanket'] },
  geode: { adj: ['Geode', 'Crystalline'], noun: ['Geode', 'Thunderegg', 'Agate Slice'] },
};

// ---------------------------------------------------------------- words
// Each trait: adjectives, nouns (things to call it), verbs (what it does),
// epithets ("the ..."), Latin species, title leanings, a paint-chip mood.
const TRAITS = {
  bouncy: {
    adj: ['Bouncy', 'Springy', 'Boingy', 'Hoppy', 'Rebounding', 'Pogo', 'Elastic', 'Spring-Loaded', 'Ricochet'],
    noun: ['Boinger', 'Bouncer', 'Pogo', 'Springer', 'Kangaroo', 'Rebound', 'Hopper', 'Superball'],
    verb: ['Bounce', 'Boing', 'Hop', 'Spring', 'Rebound'],
    epi: ['the Boing', 'Who Bounces Back', 'of the Endless Bounce', 'the Unflattenable', 'the Ricochet', 'Who Never Lands'],
    sp: ['saltatrix', 'bouncifera', 'resiliens'],
    titles: ['Captain', 'Agent', 'Coach'],
    mood: ['Giddy', 'Restless', 'Buoyant', 'Perky'],
  },
  squishy: {
    adj: ['Squishy', 'Squashy', 'Smooshy', 'Cushy', 'Spongy', 'Pudgy', 'Plush', 'Yielding', 'Squeezable'],
    noun: ['Squish', 'Smoosh', 'Pudding', 'Cushion', 'Sponge', 'Squeezle', 'Marshmallow', 'Dumpling'],
    verb: ['Squish', 'Squash', 'Smoosh', 'Squeeze'],
    epi: ['the Squishable', 'Who Yields', 'the Soft-Hearted', 'the Very Squeezable', 'Who Gives a Little', 'the Huggable'],
    sp: ['mollis', 'squishii', 'pressibilis'],
    titles: ['Lil', 'Auntie', 'Uncle'],
    mood: ['Tender', 'Gentle', 'Huggable', 'Soft-Spoken'],
  },
  wobbly: {
    adj: ['Wobbly', 'Jiggly', 'Wiggly', 'Jittery', 'Quivering', 'Shimmying', 'Trembling', 'Jelly-Legged', 'Shaky'],
    noun: ['Wobbler', 'Jiggler', 'Wiggles', 'Quiver', 'Shimmy', 'Jitterbug', 'Tremor', 'Wibble'],
    verb: ['Wobble', 'Jiggle', 'Wiggle', 'Shimmy', 'Quiver'],
    epi: ['the Wobbler', 'Who Never Stops Jiggling', 'of the Eternal Jiggle', 'the Quaking', 'the Unsteady', 'Who Dances Alone'],
    sp: ['tremulus', 'wobblensis', 'vibrans'],
    titles: ['DJ', 'MC', 'Professor'],
    mood: ['Nervous', 'Twitchy', 'Fidgety', 'Excitable'],
  },
  gooey: {
    adj: ['Gooey', 'Slimy', 'Oozy', 'Sticky', 'Gloopy', 'Drippy', 'Sloppy', 'Viscous', 'Gunky'],
    noun: ['Goo', 'Ooze', 'Gloop', 'Blob', 'Glorp', 'Splodge', 'Gunk', 'Sludge'],
    verb: ['Ooze', 'Drip', 'Gloop', 'Slurp', 'Stretch'],
    epi: ['the Oozing', 'Who Leaves a Trail', 'the Sticky-Fingered', 'the Unscrapeable', 'of the Long Strings', 'the Stringy'],
    sp: ['viscosus', 'gooeyensis', 'mucosus'],
    titles: ['Doctor', 'Count', 'Baron'],
    mood: ['Lazy', 'Languid', 'Drowsy', 'Slouching'],
  },
  tough: {
    adj: ['Tough', 'Stoic', 'Steadfast', 'Ironclad', 'Hardy', 'Rock-Solid', 'Gritty', 'Stalwart', 'Unbending'],
    noun: ['Brick', 'Block', 'Bulwark', 'Boulder', 'Tank', 'Fortress', 'Bastion', 'Anvil'],
    verb: ['Endure', 'Brace', 'Hold Fast', 'Stand Firm'],
    epi: ['the Unshakeable', 'the Unbreakable', 'Who Cannot Be Torn', 'the Indomitable', 'the Stubborn', 'Who Stands Firm'],
    sp: ['durissimus', 'robustus', 'invictus'],
    titles: ['General', 'Admiral', 'Sergeant', 'Commander'],
    mood: ['Stoic', 'Stubborn', 'Unbothered', 'Defiant'],
  },
  hefty: {
    adj: ['Hefty', 'Chonky', 'Weighty', 'Dense', 'Mighty', 'Massive', 'Burly', 'Beefy', 'Stout'],
    noun: ['Chonk', 'Unit', 'Heavyweight', 'Anchor', 'Lump', 'Boulder', 'Big Fella', 'Absolute Unit'],
    verb: ['Thud', 'Plonk', 'Flop', 'Stomp'],
    epi: ['the Heavy', 'the Immovable', 'Who Dents Floors', 'the Gravitational', 'of Considerable Mass', 'the Unliftable'],
    sp: ['ponderosus', 'gravis', 'maximus'],
    titles: ['Big', 'Lord', 'Chancellor', 'King', 'Queen'],
    mood: ['Brooding', 'Solemn', 'Grave', 'Monumental'],
  },
  light: {
    adj: ['Featherweight', 'Airy', 'Floaty', 'Dainty', 'Breezy', 'Weightless'],
    noun: ['Feather', 'Puff', 'Cloud', 'Wisp', 'Balloon'],
    verb: ['Float', 'Drift', 'Glide'],
    epi: ['the Weightless', 'Who Floats', 'the Airborne', 'of the Breeze'],
    sp: ['levis', 'aerius'],
    titles: ['Little', 'Miss', 'Master'],
    mood: ['Dreamy', 'Wistful', 'Whimsical', 'Daydreaming'],
  },
  firm: {
    adj: ['Firm', 'Stern', 'Composed', 'Unflappable', 'Dignified', 'Serious', 'Poised', 'Stately'],
    noun: ['Gentleman', 'Diplomat', 'Butler', 'Statue', 'Monolith'],
    verb: ['Sit Still', 'Stay Put', 'Hold'],
    epi: ['the Composed', 'the Unflappable', 'Who Does Not Wobble', 'the Dignified', 'of Few Jiggles'],
    sp: ['firmus', 'stabilis'],
    titles: ['Sir', 'Dame', 'Mr.', 'Ms.', 'Butler'],
    mood: ['Proper', 'Prim', 'Composed', 'Starched'],
  },
};

const MATERIALS = {
  jello: { adj: ['Jellied', 'Wobbly', 'Wobbling'], noun: ['Jelly', 'Jello', 'Jiggler', 'Gelatin'], genus: 'Gelatinus', morph: 'Jell', plain: true },
  gummy: { adj: ['Gummy', 'Chewy', 'Bouncy'], noun: ['Gummy', 'Chewster', 'Gumdrop', 'Gummi'], genus: 'Gummius', morph: 'Gum' },
  sour: { adj: ['Sour', 'Tangy', 'Zesty', 'Puckered', 'Tart'], noun: ['Sourpuss', 'Zinger', 'Pucker', 'Tang'], genus: 'Acidulus', morph: 'Sour' },
  crystal: { adj: ['Crystal', 'Clear', 'Lucid', 'Pristine'], noun: ['Crystal', 'Gem', 'Jewel', 'Diamond'], genus: 'Crystallus', morph: 'Crystal', gem: true },
  creamy: { adj: ['Creamy', 'Velvet', 'Silken', 'Dreamy'], noun: ['Custard', 'Panna Cotta', 'Cream', 'Blancmange'], genus: 'Lacteus', morph: 'Cream', sweet: true },
  slime: { adj: ['Slimy', 'Oozing', 'Toxic', 'Radioactive'], noun: ['Slime', 'Ooze', 'Glorp', 'Sludge'], genus: 'Muculentus', morph: 'Slime', monster: true },
  water: { adj: ['Splashy', 'Sloshy', 'Aqua', 'Soggy'], noun: ['Splash', 'Puddle', 'Tsunami', 'Wave'], genus: 'Aquosus', morph: 'Splash' },
  syrup: { adj: ['Syrupy', 'Treacly', 'Molten', 'Slow'], noun: ['Syrup', 'Molasses', 'Treacle', 'Honey'], genus: 'Siruposus', morph: 'Syrup', sweet: true },
  mochi: { adj: ['Mochi', 'Pillowy', 'Stretchy'], noun: ['Mochi', 'Daifuku', 'Dumpling', 'Rice Cake'], genus: 'Oryzus', morph: 'Mochi', sweet: true },
  marshmallow: { adj: ['Fluffy', 'Puffy', 'Toasty', 'Pillowy'], noun: ['Mallow', 'Puff', "S'more", 'Fluff'], genus: 'Malvaceus', morph: 'Mallow', sweet: true },
  rubber: { adj: ['Rubbery', 'Elastic', 'Stretchy', 'Grippy'], noun: ['Superball', 'Bouncer', 'Eraser', 'Bounce House'], genus: 'Elasticus', morph: 'Rubber' },
  glass: { adj: ['Glassy', 'Clear', 'Fragile', 'Crystal'], noun: ['Pane', 'Window', 'Lens', 'Goblet'], genus: 'Vitreus', morph: 'Glass', gem: true },
  tofu: { adj: ['Silken', 'Firm', 'Soy', 'Humble'], noun: ['Tofu', 'Bean', 'Bean Curd', 'Block'], genus: 'Glycinus', morph: 'Tofu' },
  putty: { adj: ['Pliable', 'Mouldable', 'Silly', 'Slumpy'], noun: ['Putty', 'Blob', 'Lump', 'Dough'], genus: 'Plasticus', morph: 'Putty' },
  candy: { adj: ['Candied', 'Glossy', 'Sugary', 'Hard-Boiled'], noun: ['Jawbreaker', 'Lolly', 'Gobstopper', 'Bonbon', 'Boiled Sweet'], genus: 'Saccharus', morph: 'Candy', sweet: true, gem: true },
  sugar: { adj: ['Sugary', 'Sweet', 'Granulated', 'Sparkly'], noun: ['Sugarlump', 'Sugar Cube', 'Sweetie', 'Lump'], genus: 'Saccharum', morph: 'Sugar', sweet: true },
  ice: { adj: ['Icy', 'Frosty', 'Frozen', 'Chilly', 'Glacial'], noun: ['Iceberg', 'Glacier', 'Frost', 'Icicle', 'Snowball'], genus: 'Glacialis', morph: 'Frost' },
  prism: { adj: ['Prismatic', 'Rainbow', 'Refracting', 'Spectral'], noun: ['Prism', 'Spectrum', 'Rainbow', 'Lightshow'], genus: 'Prismaticus', morph: 'Prism', legend: true, gem: true },
  holo: { adj: ['Holographic', 'Shiny', 'Foil', 'Ultra-Rare'], noun: ['Hologram', 'Foil', 'Shiny', 'Rare Card'], genus: 'Hologrammus', morph: 'Holo', legend: true },
  pearl: { adj: ['Pearly', 'Lustrous', 'Nacreous', 'Gleaming'], noun: ['Pearl', 'Oyster', 'Nacre', 'Pearlie'], genus: 'Margaritus', morph: 'Pearl', legend: true, gem: true },
  opal: { adj: ['Opaline', 'Galactic', 'Cosmic', 'Fiery'], noun: ['Opal', 'Nebula', 'Galaxy', 'Supernova'], genus: 'Opalinus', morph: 'Opal', legend: true, gem: true },
  chrome: { adj: ['Chrome', 'Mirrored', 'Metallic', 'Polished', 'Liquid-Metal'], noun: ['Chrome', 'Mirror', 'Bot', 'Unit', 'Mech', 'Android'], genus: 'Chromius', morph: 'Chrome', legend: true },
};

// colour words for the flavours (their own, ahead of what the eye matches)
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
  'Cubeline', 'Gelda', 'Jelliot', 'Wobbleweather', 'Squishelle', 'Boxanne', 'Cubethany', 'Gelliam', 'Jiggleby', 'Quadrilla',
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
  opal: ['Opalsworth', 'Stardustin'], holo: ['Shinewell', 'Foilsby'], prism: ['Spectrum', 'Rainbowe'],
  syrup: ['Treacleton', 'Molassey'], mochi: ['Mochizuki', 'Daifukuda'], creamy: ['Custardby', 'Creamwell'],
};
const TITLES = ['Sir', 'Dame', 'Lord', 'Lady', 'Captain', 'Professor', 'Doctor', 'Baron', 'Duchess', 'Count', 'Countess', 'Admiral', 'Señor', 'Madame', 'Agent', 'Detective', 'Chef', 'Saint', 'Prince', 'Princess'];
const FANCY_TITLES = ['Duke', 'Duchess', 'Baron', 'Baroness', 'Countess', 'Marquis', 'His Wobbliness', 'Her Jiggliness'];
const SUFFIX = ['II', 'III', 'IV', 'VII', 'IX', 'XII', 'Jr.', 'Sr.', 'the Third', 'Esq.', 'PhD', 'MBE', 'the Younger', 'the Elder'];
const GENERIC_EPI = ['the Magnificent', 'the Cube', 'of Many Sides', 'the Six-Sided', 'the Perfectly Square', 'Who Fits Any Box', 'the Right-Angled', 'the Gelatinous', 'the Great', 'the Bold', 'the Wobbleheart', 'of the Cubicle'];
const CUBE_MORPHS = ['cube', 'block', 'brick', 'hedron', 'box', 'bit'];
const ROBOT_NUMS = ['3000', '9000', '64', '128', '2000', 'XL', 'Mk II', 'X', '5000', 'Prime', 'Ultra', 'GT'];
const PLURALS = ['Cubes', 'Jigglers', 'Wobbles', 'Blocks', 'Squares', 'Gels', 'Hexahedrons', 'Cubettes'];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];
const ORDINAL = ['', 'the First', 'the Second', 'the Third', 'the Fourth', 'the Fifth', 'the Sixth', 'the Seventh', 'the Eighth', 'the Ninth', 'the Tenth'];
// twins named as a pair: the first gets one half, its twin the other (some
// halves suit a cube more than others - a wobbly one, a sweet one...)
const PAIRS = [
  ['Wibble', 'Wobble', 'wobbly'], ['Wiggle', 'Waggle', 'wobbly'], ['Jiggle', 'Jive', 'wobbly'], ['Ping', 'Pong', 'bouncy'], ['Zig', 'Zag', 'bouncy'],
  ['Squish', 'Squash', 'squishy'], ['Ooey', 'Gooey', 'gooey'], ['Splish', 'Splash', 'gooey'], ['Nuts', 'Bolts', 'tough'], ['Brick', 'Mortar', 'firm'],
  ['Thunder', 'Lightning', 'hefty'], ['Hurly', 'Burly', 'big'], ['Itsy', 'Bitsy', 'small'], ['Teeny', 'Weeny', 'small'],
  ['Sugar', 'Spice', 'sweet'], ['Cookies', 'Cream', 'sweet'], ['Peanut Butter', 'Jelly', 'jello'], ['Jelly', 'Custard', 'jello'],
  ['Razzle', 'Dazzle', 'glitter'], ['Sun', 'Moon', 'dark'], ['Night', 'Day', 'dark'],
  ['Tick', 'Tock'], ['Fizz', 'Pop'], ['Bubble', 'Squeak'], ['Salt', 'Pepper'], ['Yin', 'Yang'], ['Castor', 'Pollux'], ['Romulus', 'Remus'],
  ['Thing One', 'Thing Two'], ['Rock', 'Roll'], ['Topsy', 'Turvy'], ['Helter', 'Skelter'], ['Hocus', 'Pocus'], ['Higgledy', 'Piggledy'],
  ['Super', 'Duper'], ['Okey', 'Dokey'], ['Tweedledum', 'Tweedledee'], ['Fish', 'Chips'], ['Bangers', 'Mash'], ['Bread', 'Butter'], ['Flip', 'Flop'],
];
// (the other half of a pair, for a twin called one of them)
const pairOf = (name) => {
  const p = PAIRS.find(([a, b]) => name === a || name === b);
  return p ? (p[0] === name ? p[1] : p[0]) : null;
};
// a sequel's title, for a child named for its parent ({P}: the parent)
const SEQUELS = ['{P} Returns', '{P} Reloaded', '{P} Strikes Back', '{P} Forever', '{P}: The Sequel', '{P}: Next Gen', '{P} 2', 'Son of {P}', 'Return of {P}', 'Revenge of {P}', 'Bride of {P}', 'Spawn of {P}'];
// (words that aren't a name's own: articles, and the plain words for a cube)
const NOT_HEAD = new Set(['The', 'A', 'An', 'Of', 'And', 'Cube', 'Block', 'Brick', 'Square', 'Cuboid', 'Hexahedron', 'Jr.', 'Sr.']);

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
  melted: ['Who Walked Through Fire', 'the Twice-Molten', 'Forged in the Flame'],
  frozen: ['Who Came In From the Cold', 'the Thawed', 'of the Long Winter'],
  acid: ['Who Bathed in Acid', 'the Acid-Kissed', 'the Undissolved'],
  gelled: ['Wearer of Many Globs', 'the Gloriously Gelled', 'Who Grew a Second Self'],
  smashed: ['Who Took the Mallet', 'the Hammered', 'Anvil-Hearted'],
  scooped: ['Who Was Scooped and Lived', 'of the Missing Piece', 'the Hollowed'],
  floured: ['Who Rolled in Flour', 'the Dusted', 'the Well-Floured'],
};
const REC_ADJ = {
  cuts: ['Scarred', 'Battle-Scarred'], tears: ['Torn'], diced: ['Diced'], shots: ['Pierced', 'Bulletproof'], booms: ['Shellshocked', 'Blast-Proof'],
  healed: ['Reborn', 'Undying'], melted: ['Fireproof', 'Scorched'], frozen: ['Thawed', 'Frostbitten'], acid: ['Etched', 'Corroded'],
  gelled: ['Globby', 'Encrusted'], smashed: ['Dented', 'Hammered'], scooped: ['Hollow', 'Scooped'], floured: ['Floury', 'Dusted', 'Breaded'],
};

// phrase puns with slots: {V} verb, {Ving}, {A} adjective, {N} noun, {F} flavour word, {M} material noun, {C} colour word
const PHRASES = [
  '{V} All the Way', 'Born to {V}', 'Cube Me Maybe', '{V} Like Nobody’s Watching', 'The Fast and the {A}', 'Mission: {A}',
  '{N} Force One', 'Ctrl+Alt+{V}', '404: {N} Not Found', '{F}geddon', 'Gone With the {N}', 'Livin’ la Vida {M}',
  'Don’t Stop Me {Ving}', 'Singin’ and {Ving}', '{Ving} on Sunshine', 'Return of the {N}', 'The {N} Strikes Back', 'Honey, I Cubed the {N}', '{F} Fields Forever',
  'Total {N} of the Heart', 'Eye of the {N}', 'Smells Like {F} Spirit', 'Close Encounters of the {N} Kind', 'Ghost in the {N}',
  '{A} and Proud', 'Keep Calm and {V} On', 'Shake, Rattle & {V}', 'Hello, {N}', 'Big {N} Energy', 'Main {N} Energy',
  'Fifty Shades of {C}', 'Paint It {C}', 'The {C} Album', 'Once in a {C} Moon', 'Mood: {C}',
];
const DESSERTS = ['{F} {M} Supreme', '{F} Surprise', 'Chef’s {F} Special', '{F} à la Mode', 'Grand {F} Soufflé', '{F} {M} Deluxe', 'The {F} Sundae Best', 'Le {F} Flambé', '{F} Parfait', '{F} Crumble', 'Upside-Down {F} Cake'];
// paint chips: a mood and a colour ("Wistful Lavender", "Smoked Cherry")
const PAINT_MOOD = ['Wistful', 'Smoked', 'Whispering', 'Forgotten', 'Electric', 'Velvet', 'Hushed', 'Sunlit', 'Moonlit', 'Dusty', 'Secret', 'Distant', 'Restless', 'Midnight', 'Morning', 'Burnt', 'Faded', 'Wild', 'Polite', 'Sleepy'];
// gemstones, for what's gem-like ("Star Sapphire", "Fire Opal")
const GEM_BY_FAM = {
  red: ['Ruby', 'Garnet', 'Pigeon’s-Blood Ruby', 'Red Spinel'], orange: ['Fire Opal', 'Padparadscha', 'Sunstone', 'Carnelian'],
  yellow: ['Citrine', 'Topaz', 'Canary Diamond', 'Golden Beryl'], green: ['Emerald', 'Peridot', 'Jade', 'Tsavorite'],
  teal: ['Aquamarine', 'Paraíba', 'Turquoise', 'Amazonite'], blue: ['Sapphire', 'Star Sapphire', 'Lapis', 'Tanzanite'],
  purple: ['Amethyst', 'Tanzanite', 'Charoite', 'Purple Spinel'], pink: ['Rose Quartz', 'Pink Tourmaline', 'Morganite', 'Kunzite'],
  brown: ['Tiger’s Eye', 'Smoky Quartz', 'Amber', 'Chocolate Diamond'], white: ['Moonstone', 'Diamond', 'Opal', 'Pearl'],
  grey: ['Hematite', 'Labradorite', 'Grey Diamond'], black: ['Onyx', 'Obsidian', 'Black Diamond', 'Jet'],
};
// jello shots and layered drinks, for layered jelly
const SHOTS = ['{P} Jello Shot', '{C} Shooter', 'Pousse-Café', 'B-52', 'Layer Shot', '{C} Slammer', 'Rainbow Shot', '{P} Sunrise', '{C} Cosmo', 'Jelly Bomb', 'Tiki {C}', '{C} Daiquiri'];
// racehorse names (two words run together, often a pun)
const HORSE = ['{A}{N} Express', 'Wobble On By', 'Jiggle Me Timbers', '{F} Flyer', 'Gel Runner', 'Cubist Lad', 'Square Deal', '{A} Dancer', 'Nothing But {N}', 'Hold My {N}', 'Seabiscube', 'Wibbledon'];
// places: words and where it reigns
const PLACE = {
  diner: { adj: ['Diner', 'Short-Order', 'Blue-Plate', 'Bottomless', 'Jukebox'], of: ['of the Diner', 'of Booth Seven', 'of the Milkshake Bar', 'of the Jukebox'], noun: ['Milkshake', 'Jukebox', 'Blue Plate Special', 'Short Stack'] },
  picnic: { adj: ['Picnic', 'Meadow', 'Sunday', 'Hamper'], of: ['of the Picnic Blanket', 'of the Meadow', 'of the Hamper', 'of Sunday Afternoon'], noun: ['Picnic', 'Hamper', 'Sandwich', 'Meadow'] },
  marble: { adj: ['Marble', 'Classical', 'Renaissance', 'Gallery', 'Sculpted'], of: ['of the Marble Halls', 'of the Gallery', 'of the Palazzo', 'of the East Wing'], noun: ['Masterpiece', 'Bust', 'Statue', 'Fresco'] },
  synthwave: { adj: ['Synthwave', 'Retro', 'Outrun', 'Vapor', 'Arcade', 'Turbo', 'Laser'], of: ['of the Neon Grid', 'of 1984', 'of the Arcade', 'of the Endless Highway'], noun: ['Cassette', 'Synth', 'Arcade', 'Laser Disc'] },
  beach: { adj: ['Beach', 'Surf', 'Tidal', 'Seaside', 'Sunkissed', 'Boardwalk'], of: ['of the Boardwalk', 'of the Tide', 'of the Dunes', 'of Shell Beach'], noun: ['Sandcastle', 'Surfer', 'Beach Ball', 'Tide Pool'] },
  moon: { adj: ['Lunar', 'Moon', 'Apollo', 'Orbital', 'Astro', 'Crater'], of: ['of the Sea of Tranquility', 'of the Dark Side', 'of Crater Nine', 'of Moonbase Alpha'], noun: ['Moonwalker', 'Lander', 'Crater', 'Moonbeam'] },
};
// The holidays: a day each (some, a day that moves: Easter, Thanksgiving),
// the days before and after it they're in the air, and - for one that's
// only some places' - where (a region, as the browser's language has it).
const nthWeekday = (y, m, wd, k) => 1 + ((wd - new Date(y, m, 1).getDay() + 7) % 7) + (k - 1) * 7;
const easter = (y) => {
  // (the Gregorian computus)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31);
  return [mo - 1, ((h + l - 7 * m + 114) % 31) + 1];
};
const HOLIDAYS = [
  { name: 'Halloween', at: () => [9, 31], before: 10, after: 0, words: ['Spooky', 'Haunted', 'Ghoulish', 'Cursed', 'Eerie'], nouns: ['Ghoul', 'Phantom', 'Poltergeist', 'Jack-o’-Lantern', 'Trick-or-Treat'] },
  { name: 'Bonfire', at: () => [10, 5], before: 4, after: 2, where: /^(GB|UK)$/, words: ['Bonfire', 'Sparkler', 'Firework', 'Toffee-Apple'], nouns: ['Catherine Wheel', 'Sparkler', 'Roman Candle', 'Bonfire Toffee'] },
  { name: 'Thanksgiving', at: (y) => [10, nthWeekday(y, 10, 4, 4)], before: 6, after: 1, where: /^US$/, words: ['Thankful', 'Cranberry', 'Stuffed', 'Gravy-Boat', 'Second-Helping'], nouns: ['Turkey', 'Pumpkin Pie', 'Wishbone', 'Leftovers', 'Cranberry Sauce'] },
  { name: 'Thanksgiving', at: (y) => [9, nthWeekday(y, 9, 1, 2)], before: 4, after: 1, where: /^CA$/, words: ['Thankful', 'Cranberry', 'Stuffed', 'Harvest'], nouns: ['Turkey', 'Pumpkin Pie', 'Wishbone', 'Leftovers'] },
  { name: 'Christmas', at: () => [11, 25], before: 7, after: 1, words: ['Festive', 'Yuletide', 'Jingle', 'Merry', 'Tinsel'], nouns: ['Stocking Filler', 'Mince Pie', 'Snow Globe', 'Bauble', 'Figgy Pudding'] },
  { name: 'New Year', at: () => [0, 1], before: 2, after: 1, words: ['Auld-Lang-Syne', 'Countdown', 'Resolution'], nouns: ['Countdown', 'Resolution', 'Party Popper'] },
  { name: 'Valentine', at: () => [1, 14], before: 4, after: 1, words: ['Lovestruck', 'Sweetheart', 'Smitten'], nouns: ['Sweetheart', 'Valentine', 'Love Letter'] },
  { name: 'Paddy', at: () => [2, 17], before: 1, after: 1, words: ['Lucky', 'Shamrock', 'Clover'], nouns: ['Four-Leaf Clover', 'Pot o’ Gold'] },
  { name: 'Fools', at: () => [3, 1], before: 0, after: 0, words: ['Prankster', 'Joker', 'Fooling'], nouns: ['Whoopee Cushion', 'Prank', 'Jester'] },
  { name: 'Easter', at: easter, before: 3, after: 1, words: ['Hoppy', 'Egg-Hunt', 'Pastel', 'Bunny'], nouns: ['Easter Egg', 'Chocolate Bunny', 'Hot Cross Bun', 'Egg Hunt'] },
  { name: 'Fourth', at: () => [6, 4], before: 3, after: 0, where: /^US$/, words: ['Star-Spangled', 'Firecracker', 'Spangled', 'Liberty'], nouns: ['Firecracker', 'Fireworks', 'Hot Dog', 'Sparkler'] },
];
// (where the seasons run the other way round)
const SOUTH = /^(AU|NZ|ZA|AR|CL|UY|PY|BR|PE|BO)$/;

// The time of year (and its holiday, and how near it is: strength 0.5 at
// the edge of it, 1 on the day) and of day, and the day of the week - for
// a region (locale: a language tag, 'en-GB'), or anywhere.
function seasonOf(now, locale = '') {
  if (!now) return null;
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate(), h = now.getHours(), w = now.getDay();
  const region = ((String(locale || '').match(/[-_]([A-Za-z]{2})\b/) || [])[1] || '').toUpperCase();
  const out = { words: [], nouns: [], holiday: null, strength: 0, clock: null };
  const today = new Date(y, m, d);
  for (const H of HOLIDAYS) {
    if (H.where && !H.where.test(region)) continue;
    for (const yy of [y - 1, y, y + 1]) {
      const [hm, hd] = H.at(yy), diff = Math.round((today - new Date(yy, hm, hd)) / 86400000);
      if (diff < -H.before || diff > H.after) continue;
      const strength = 1 - (0.5 * Math.abs(diff)) / Math.max(1, diff < 0 ? H.before : H.after);
      if (strength > out.strength) {
        out.holiday = H;
        out.strength = strength;
      }
    }
  }
  const north = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'][m];
  const season = SOUTH.test(region) ? { winter: 'summer', spring: 'autumn', summer: 'winter', autumn: 'spring' }[north] : north;
  out.season = season;
  out.words = { winter: ['Frosty', 'Wintry', 'Snowbound', 'Fireside'], spring: ['Spring', 'Blossom', 'Budding', 'Springtime'], summer: ['Summer', 'Sunburnt', 'Solstice', 'Heatwave'], autumn: ['Autumn', 'Harvest', 'Pumpkin-Spice', 'Bonfire'] }[season];
  out.nouns = { winter: ['Snow Day', 'Hot Toddy', 'Snowdrift'], spring: ['Blossom', 'Spring Fling', 'Daffodil'], summer: ['Heatwave', 'Ice Lolly', 'Sunburn'], autumn: ['Harvest Moon', 'Conker', 'Leaf Pile'] }[season];
  // (the hour, and the day: the small hours, breakfast time, a Friday, a Sunday)
  if (h >= 23 || h < 5) out.clock = { words: ['Midnight', 'Moonlit', 'Insomniac', 'Wee-Hours', 'Night-Owl'], nouns: ['Night Owl', 'Midnight Snack', 'Insomniac', 'Sleepwalker'] };
  else if (h >= 5 && h < 9) out.clock = { words: ['Early-Bird', 'Dawn', 'Sunrise', 'Breakfast'], nouns: ['Early Bird', 'Breakfast Club', 'Alarm Clock', 'Morning Person'] };
  else if (w === 5 && h >= 16) out.clock = { words: ['Friday-Night', 'TGIF', 'Weekend-Ready'], nouns: ['Friday Feeling', 'Happy Hour', 'Weekender'] };
  else if (w === 0 || w === 6) out.clock = { words: ['Weekend', 'Lazy-Sunday', 'Lie-In', 'Brunch'], nouns: ['Weekender', 'Sunday Best', 'Lie-In', 'Brunch Club'] };
  else if (w === 1 && h < 12) out.clock = { words: ['Monday-Morning', 'Grumpy', 'Coffee-Fuelled'], nouns: ['Monday Blues', 'Coffee Break', 'Snooze Button'] };
  return out;
}

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
const unhyphen = (s) => s.replace(/-/g, ' ');

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

// ---------------------------------------------------------------- the read
// Everything about the cube - and round it - that a name could catch, each
// with how remarkable it is in this cube (salience, 0..1).
export function cubeTraits(c, rec = null, ctx = {}) {
  c = c || {};
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
  const texture = TEXTURES[c.texture] ? c.texture : 'jello';
  const tex = TEXTURES[texture];
  const val = (k, d = 0) => (Number.isFinite(tune[k]) ? tune[k] : Number.isFinite(tex[k]) ? tex[k] : d);
  const size = val('size', 1);
  const flavor = String(c.flavor || 'cherry');
  const L = c.layers || null;
  const sal = {};
  const words = {}; // (each feature's adjectives/nouns)
  // -- colour
  let colours = [], palette = null, pattern = null;
  if (flavor === 'rubik') {
    palette = { name: 'Rubik', adj: RUBIK_WORDS, noun: RUBIK_NOUNS, named: ['Red', 'Green', 'Blue', 'Yellow', 'Orange', 'White'], fams: ['red', 'green', 'blue', 'yellow', 'orange', 'white'], rainbow: true };
    sal.palette = 0.95;
  } else if (flavor === 'layers' && L && Array.isArray(L.colors) && L.colors.length) {
    colours = L.colors.map(readColour);
    palette = readPalette(colours, L);
    sal.palette = palette.preset ? 0.8 : palette.known ? 0.95 : 0.7;
    pattern = readPattern(colours, L, texture);
    if (pattern) sal.pattern = pattern.salience;
  } else {
    const hex = flavor.startsWith('#') ? flavor : null;
    const own = FLAVOR_WORDS[flavor];
    const rc = readColour(hex || ({ cherry: '#d4102a', lime: '#5fce1e', blue: '#0f8cff', grape: '#7a24d4', orange: '#ff7414', lemon: '#ffcc12', watermelon: '#ff3f7f', cola: '#7a2e0e' }[flavor] || '#d4102a'));
    if (own) rc.names = [...own.slice(0, 3), ...rc.names];
    colours = [rc];
    sal.colour = hex ? 0.6 : 0.45;
  }
  const main = palette ? null : colours[0] || null;
  words.colour = main ? main.names : palette ? palette.adj : ['Jelly'];
  const flavorWord = palette ? palette.adj[0] : main ? main.names[0] : 'Jelly';
  // -- material and its finish
  const mat = MATERIALS[texture];
  sal.material = mat.legend ? 0.95 : mat.plain ? 0.15 : 0.55;
  const finish = [];
  const op = val('opacity', 0.25), glow = val('glow', 0.5), rough = val('rough', 0.04), ior = val('ior', 1.36);
  const irid = val('irid'), metal = val('metal'), opal = val('opal'), milk = val('milk'), depth = val('depth', 1.2);
  if (op < 0.08 && !metal) finish.push([['Crystal-Clear', 'See-Through', 'Ghostly', 'Invisible'], ['Ghost', 'Phantom', 'Specter', 'Window'], 0.55]);
  if (glow > 0.85) finish.push([['Luminous', 'Glowing', 'Radiant', 'Lantern-Lit'], ['Lantern', 'Nightlight', 'Firefly', 'Glowworm'], 0.55]);
  if (rough > 0.4) finish.push([['Matte', 'Velvety', 'Frosted', 'Chalky'], ['Velvet', 'Suede', 'Chalk'], 0.4]);
  else if (rough < 0.012) finish.push([['Glossy', 'Polished', 'Lacquered', 'Glassy'], ['Mirror', 'Gloss', 'Lacquer'], 0.3]);
  if (ior > 1.48 && !metal) finish.push([['Brilliant', 'Diamond-Bright', 'Dazzling'], ['Diamond', 'Lens', 'Prism'], 0.45]);
  if (irid > 0.4) finish.push([['Iridescent', 'Oil-Slick', 'Pearlescent', 'Soap-Bubble'], ['Soap Bubble', 'Beetle', 'Oil Slick'], 0.6]);
  if (metal > 0.5) finish.push([['Metallic', 'Mercury', 'Liquid-Metal', 'Chrome-Plated'], ['Mercury', 'Terminator', 'Ball Bearing', 'Hubcap'], 0.6]);
  if (opal > 0.5) finish.push([['Opaline', 'Galactic', 'Fire-Opal', 'Nebulous'], ['Nebula', 'Fire Opal', 'Galaxy'], 0.6]);
  if (milk > 0.7 && !metal) finish.push([['Milky', 'Creamy', 'Moon-Milk', 'Cloudy'], ['Milkshake', 'Cloud', 'Moonmilk'], 0.35]);
  if (depth > 1.6) finish.push([['Deep', 'Inky', 'Saturated', 'Dark-Hearted'], ['Abyss', 'Ink', 'Deep End'], 0.3]);
  else if (depth < 0.3 && !metal) finish.push([['Pale', 'Washed-Out', 'Barely-There'], ['Whisper', 'Wash', 'Hint'], 0.3]);
  const bub = val('bubbles', 0), bubSize = val('bubbleSize', 1);
  if (bub > 0.35) finish.push([bubSize > 1.4 ? ['Frothy', 'Foaming', 'Sudsy'] : ['Fizzy', 'Bubbly', 'Sparkling', 'Effervescent'], ['Soda', 'Fizz', 'Champagne', 'Seltzer', 'Cream Soda'], 0.45 + Math.min(0.3, bub * 0.3)]);
  // glitter: its kind, and how much, how big, how sparkly
  const glitterKey = c.glitter && c.glitter !== 'off' ? c.glitter : null;
  if (glitterKey) {
    const ga = val('glitterAmount', 1), gs = val('glitterSize', 1), gk = val('glitterSparkle', 1);
    const adj = [...(GLITTER_WORDS[glitterKey] || [])];
    if (ga > 1.5) adj.push('Bedazzled', 'Glitter-Bombed', 'Encrusted');
    if (gs > 1.5) adj.push('Sequined', 'Confetti', 'Paillette');
    if (gk > 1.5) adj.push('Twinkling', 'Starry', 'Scintillating');
    words.glitter = adj;
    sal.glitter = 0.8;
  }
  // feel: grip, drag, gravity, size, edges, tearing
  const feel = [];
  const grip = val('grip', 0.85), drag = val('airDrag', 0), grav = Number.isFinite(tune.gravity) ? tune.gravity : null;
  if (grip > 1.35) feel.push([['Grippy', 'Sticky', 'Tacky', 'Velcro'], ['Limpet', 'Barnacle', 'Velcro'], 0.35]);
  else if (grip < 0.5) feel.push([['Slippery', 'Slick', 'Greased', 'Frictionless'], ['Eel', 'Banana Peel', 'Slip-n-Slide'], 0.45]);
  if (drag > 0.6) feel.push([['Floaty', 'Drifting', 'Parachuting'], ['Parachute', 'Dandelion', 'Kite'], 0.45]);
  if (grav !== null && grav < 6) feel.push([['Lunar', 'Astro', 'Zero-G', 'Orbital', 'Weightless'], ['Astronaut', 'Moonwalker', 'Satellite'], 0.8]);
  else if (grav !== null && grav > 30) feel.push([['Jupiter', 'Crushing', 'Heavy-Gravity', 'Neutron-Star'], ['Black Hole', 'Neutron Star', 'Gravity Well'], 0.7]);
  if (size < 0.7) feel.push([['Tiny', 'Micro', 'Pocket', 'Itty-Bitty', 'Teacup'], ['Speck', 'Crumb', 'Pip', 'Morsel'], 0.8]);
  else if (size < 0.88) feel.push([['Lil’', 'Mini', 'Wee', 'Bitty', 'Petite'], ['Bite', 'Nibble', 'Shortie'], 0.5]);
  else if (size > 1.4) feel.push([['Colossal', 'Giant', 'Titanic', 'Gargantuan', 'Mega'], ['Titan', 'Colossus', 'Behemoth', 'Leviathan'], 0.8]);
  else if (size > 1.12) feel.push([['Big', 'Jumbo', 'Grand', 'Hulking'], ['Whopper', 'Big Bopper', 'Jumbo'], 0.5]);
  const edgeKey = EDGE_WORDS[c.edges] ? c.edges : null;
  if (edgeKey === 'sharp' || edgeKey === 'pillow') feel.push([EDGE_WORDS[edgeKey], edgeKey === 'sharp' ? ['Edgelord', 'Razor', 'Corner'] : ['Pillow', 'Cushion', 'Beanbag'], 0.45]);
  const tearless = c.tear === false;
  if (tearless) feel.push([['Untearable', 'Indestructible', 'Rip-Proof'], ['Tank', 'Kevlar'], 0.5]);
  // the stats: how strongly it's each thing (an extreme, all the more)
  for (const [k, v] of Object.entries(T)) sal['trait:' + k] = Math.min(1, v * 0.85 + (v > 0.85 ? 0.15 : 0));
  // the room, glow mode, the time
  const placeKey = PLACE[ctx.place] ? ctx.place : null;
  if (placeKey) sal.place = 0.55;
  const dark = (ctx.theme || c.theme) === 'dark';
  if (dark) sal.dark = 0.45;
  const time = seasonOf(ctx.now || null, ctx.locale);
  if (time) sal.season = time.holiday ? 0.35 + 0.4 * time.strength : 0.22;
  if (time && time.clock) sal.clock = 0.3;
  // its family and what it's been through
  const gen = ctx.gen | 0;
  const parent = ctx.parentName ? String(ctx.parentName) : '';
  if (gen > 0) sal.family = Math.min(0.95, 0.68 + gen * 0.07) + (parent ? 0.05 : 0);
  const changes = (ctx.changes || []).filter((x) => x && x.tier >= 2);
  if (changes.length) sal.mutation = changes.some((x) => x.tier >= 3) ? 1 : 0.8;
  const storied = rec ? Object.keys(LEGEND_BY_REC).filter((k) => (rec[k] || 0) >= (k === 'healed' ? 10 : k === 'shots' ? 8 : 3)) : [];
  if (storied.length) sal.record = Math.min(1, 0.6 + storied.length * 0.15);
  finish.forEach(([, , s], i) => (sal['finish' + i] = s));
  feel.forEach(([, , s], i) => (sal['feel' + i] = s));
  return {
    flavor, stats, T, mat, texture, colours, main, palette, pattern, flavorWord, words, finish, feel,
    edges: EDGE_WORDS[c.edges] || [], edgeKey, glitterKey, glitter: words.glitter || [],
    small: size < 0.88, big: size > 1.12, lowG: grav !== null && grav < 6, highG: grav !== null && grav > 30,
    dark, tearless, rec: rec || null, storied, place: placeKey, time, gen, parent, twin: ctx.twin || '', pairing: !!ctx.pairing, changes, sal,
  };
}

// a layered cube's palette: a preset's, a named one's, or described
function readPalette(cols, L) {
  const fams = [...new Set(cols.map((c) => c.fam))];
  const preset = presetOf(L);
  const adj = [], noun = [];
  let name = null, known = false;
  if (preset) {
    name = preset.name;
    adj.push(...(PRESET_WORDS[preset.id] || [preset.name]).map(unhyphen));
    noun.push(preset.name);
  }
  // a named palette: all of its families there, not too many others
  const light = cols.every((c) => c.light > 70);
  for (const P of PALETTES) {
    if (fams.length > P.max || (P.light && !light)) continue;
    if (!P.need.every((alts) => alts.some((f) => fams.includes(f)))) continue;
    // (each colour accounted for by one of its families)
    const all = P.need.flat();
    if (!fams.every((f) => all.includes(f))) continue;
    if (!name) name = P.name;
    known = true;
    noun.push(...P.nouns);
    adj.push(P.name.replace(/ & /, '-and-'));
    break;
  }
  // described
  const pastel = cols.filter((c) => c.pastel).length >= cols.length * 0.6;
  const neon = cols.filter((c) => c.neon).length >= Math.max(1, cols.length * 0.5);
  const dark = cols.filter((c) => c.dark).length >= cols.length * 0.5;
  const earthy = cols.every((c) => ['brown', 'green', 'yellow', 'orange', 'grey'].includes(c.fam) && c.chroma < 60);
  const jewel = cols.every((c) => c.chroma > 45 && c.light > 25 && c.light < 60);
  const hues = new Set(cols.filter((c) => !['white', 'grey', 'black', 'brown'].includes(c.fam)).map((c) => c.fam));
  const rainbow = hues.size >= 5;
  if (fams.length === 1) adj.push('Monochrome', `All-${cols[0].names[0].split(' ')[0]}`, 'Tonal');
  if (rainbow) adj.push('Rainbow', 'Technicolor', 'Kaleidoscope', 'Prismatic');
  if (pastel) adj.push('Pastel', 'Sorbet', 'Sugared-Almond', 'Macaron');
  if (neon) adj.push('Neon', 'Highlighter', 'Fluorescent', 'Electric');
  if (dark) adj.push('Brooding', 'Gothic', 'Shadowy', 'Midnight');
  if (earthy) adj.push('Earthy', 'Rustic', 'Autumnal', 'Woodland');
  if (jewel) adj.push('Jewel-Toned', 'Regal', 'Gem-Bright');
  if (!adj.length) adj.push(cols.length > 2 ? 'Layered' : 'Two-Tone');
  // the colours, two of them by name ("Coral & Teal")
  const named = [...new Set(cols.map((c) => c.names[0]))];
  return { name, preset: preset ? preset.id : null, known, adj, noun, named, fams, rainbow, pastel, neon, dark, earthy, jewel };
}

// a gradient's pattern: its shape, blend, repeats, tiles
function readPattern(cols, L, texture) {
  const shape = L.shape || 'up', blur = L.blur || 0, rep = L.repeat || 1, tiles = L.tiles || 1;
  const parts = [];
  let salience = 0.4;
  if (tiles > 1) {
    const two = new Set(cols.map((c) => c.names[0])).size === 2;
    const white = cols.some((c) => c.fam === 'white');
    parts.push(two && white && blur < 0.3 ? PATTERN.gingham : PATTERN.tiles);
    salience = 0.85;
  }
  if (shape === 'free') {
    const loud = cols.filter((c) => c.chroma > 55).length >= 3;
    const camo = cols.every((c) => ['green', 'brown', 'yellow', 'grey', 'black'].includes(c.fam) && c.chroma < 55);
    parts.push(camo ? PATTERN.freeCamo : loud ? PATTERN.freeLoud : PATTERN.free);
    salience = Math.max(salience, 0.85);
  } else if (shape === 'rings' && (TEXTURES[texture]?.ior || 0) > 1.38) {
    parts.push(PATTERN.geode);
    salience = Math.max(salience, 0.85);
  } else if (shape !== 'up' && PATTERN[shape]) {
    parts.push(PATTERN[shape]);
    salience = Math.max(salience, 0.8);
  } else if (blur > 0.55) {
    parts.push(PATTERN.upSoft);
    salience = Math.max(salience, 0.55);
  } else {
    parts.push(PATTERN.up);
    if (rep >= 3) salience = Math.max(salience, 0.6);
  }
  const adj = parts.flatMap((p) => p.adj), noun = parts.flatMap((p) => p.noun);
  if (rep >= 3 && shape === 'up' && blur < 0.3) adj.push('Pinstriped', 'Many-Banded', 'Zebra');
  if (Math.abs(L.bias || 0) > 0.45) adj.push(L.bias > 0 ? 'Top-Heavy' : 'Bottom-Heavy');
  return { adj, noun, salience, shape };
}

// ---------------------------------------------------------------- the name
// (rnd: 0..1; taken: names not to use; rec: its record; ctx: what's round
// it - { place, theme, now (a Date), gen, parentName, twin, changes })
export function nameCube(c, { taken = [], rnd = Math.random, rec = null, ...ctx } = {}) {
  const tr = cubeTraits(c || { flavor: 'cherry', texture: 'jello' }, rec, ctx);
  const used = new Set([...taken, ctx.parentName || '', ctx.twin || ''].map((n) => String(n).toLowerCase()));
  // (its family's words: carried on in a family name, not echoes)
  const famWords = new Set(`${ctx.parentName || ''} ${ctx.twin || ''}`.toLowerCase().split(/[\s,&-]+/).filter((w) => w.length > 3));
  // (the words of the names already about, the latest counting most)
  const takenWords = new Map();
  taken.slice(-12).forEach((n, i, a) => {
    for (const w of String(n).toLowerCase().split(/[\s,&-]+/)) if (w.length > 3) takenWords.set(w, Math.max(takenWords.get(w) || 0, (i + 1) / a.length));
  });
  for (let tries = 0; tries < 6; tries++) {
    // a handful made; the best of them likeliest
    const cands = [];
    for (let k = 0; k < 14; k++) {
      const n = make(tr, rnd);
      if (!n) continue;
      const text = tidy(n.t);
      if (text.length < 3 || text.length > 30 || used.has(text.toLowerCase()) || /undefined|NaN|[{}]/.test(text)) continue;
      // (a word twice: "Bunny Chocolate Bunny" - not a name)
      const lw = text.toLowerCase().split(/[\s-]+/).map((x) => x.replace(/[^a-z]/g, '')).filter((x) => x.length > 2);
      if (new Set(lw).size < lw.length) continue;
      cands.push({ text, score: scoreName(text, n, tr) - echo(text, takenWords, famWords) });
    }
    if (cands.length) {
      const top = Math.max(...cands.map((x) => x.score));
      return choose(rnd, cands.map((x) => [x.text, Math.exp((x.score - top) / 0.28)]));
    }
  }
  // (all taken: a sequel)
  let base = '';
  for (let k = 0; k < 20 && !base; k++) {
    const n = make(tr, rnd);
    if (n) base = tidy(n.t).slice(0, 26);
  }
  base = base || 'Cube';
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

// (how much a name echoes those already about: their words in it)
function echo(text, words, skip) {
  if (!words.size) return 0;
  let e = 0;
  for (const w of text.toLowerCase().split(/[\s,&-]+/)) if (w.length > 3 && words.has(w) && !skip.has(w)) e += 0.45 * words.get(w);
  return e;
}

function tidy(s) {
  return s.replace(/\s+/g, ' ').replace(/\s([,.!?])/g, '$1').replace(/ ”/g, '”').trim();
}

// How good a name is: what of the cube it catches (each feature as
// remarkable as it is, once), its kind's charm, and how it reads.
function scoreName(text, n, tr) {
  let s = n.k || 0;
  const seen = new Set();
  for (const u of n.u) {
    if (seen.has(u)) continue;
    seen.add(u);
    s += tr.sal[u] || 0;
  }
  const w = text.split(/[\s-]+/).filter(Boolean);
  // (alliteration reads well)
  const firsts = w.filter((x) => /^[A-Z]/.test(x)).map((x) => x[0]);
  if (firsts.length >= 2 && firsts.some((ch, i) => firsts.indexOf(ch) !== i)) s += 0.22;
  // (too long reads badly; too short, a little)
  if (text.length > 24) s -= (text.length - 24) * 0.06;
  if (text.length < 7) s -= 0.15;
  return s;
}

// one name, of one kind, and what it used ({ t, u: [features], k: its charm })
function make(tr, rnd) {
  const T = tr.T, sal = tr.sal;
  // its leading trait (weighted: the stronger, the likelier, but not always)
  const traitKey = choose(rnd, Object.entries(T).map(([k, w]) => [k, 0.03 + w * w * 3]));
  const trait = TRAITS[traitKey], tu = 'trait:' + traitKey;
  // an adjective for it, from one of the things it is - which, by how
  // remarkable each is - and the feature it came from
  const adjFrom = () => {
    const opts = [
      [['trait', () => pick(rnd, trait.adj), tu], 1.6 + (sal[tu] || 0) * 2],
      [['material', () => pick(rnd, tr.mat.adj), 'material'], 0.6 + sal.material * 2],
      [['colour', () => pick(rnd, tr.words.colour), tr.palette ? 'palette' : 'colour'], 1.6],
    ];
    if (tr.pattern) opts.push([['pattern', () => pick(rnd, tr.pattern.adj), 'pattern'], tr.pattern.salience * 2.4]);
    if (tr.palette && tr.palette.adj.length) opts.push([['palette', () => pick(rnd, tr.palette.adj), 'palette'], sal.palette * 2]);
    if (tr.glitter.length) opts.push([['glitter', () => pick(rnd, tr.glitter), 'glitter'], 1.8]);
    tr.finish.forEach(([a, , s], i) => opts.push([['finish', () => pick(rnd, a), 'finish' + i], s * 2]));
    tr.feel.forEach(([a, , s], i) => opts.push([['feel', () => pick(rnd, a), 'feel' + i], s * 2]));
    if (tr.place) opts.push([['place', () => pick(rnd, PLACE[tr.place].adj), 'place'], 1]);
    if (tr.dark) opts.push([['dark', () => pick(rnd, ['Midnight', 'Nocturnal', 'Neon', 'Glow-in-the-Dark', 'After-Hours']), 'dark'], 0.8]);
    if (tr.time) opts.push([['season', () => pick(rnd, tr.time.holiday ? tr.time.holiday.words : tr.time.words), 'season'], tr.time.holiday ? 0.4 + 1.1 * tr.time.strength : 0.35]);
    if (tr.time && tr.time.clock) opts.push([['clock', () => pick(rnd, tr.time.clock.words), 'clock'], 0.6]);
    if (tr.storied.length) opts.push([['record', () => pick(rnd, tr.storied.flatMap((k) => REC_ADJ[k] || [])), 'record'], 1.2]);
    const [, f, u] = choose(rnd, opts);
    return { w: f(), u };
  };
  const nounFrom = () => {
    const opts = [
      [[() => pick(rnd, trait.noun), tu], 1.5 + (sal[tu] || 0) * 1.5],
      [[() => pick(rnd, tr.mat.noun), 'material'], 0.8 + sal.material * 2],
      [[() => pick(rnd, ['Cube', 'Block', 'Brick', 'Square', 'Hexahedron', 'Cuboid']), null], 0.9],
    ];
    if (tr.pattern) opts.push([[() => pick(rnd, tr.pattern.noun), 'pattern'], tr.pattern.salience * 2]);
    if (tr.palette && tr.palette.noun.length) opts.push([[() => pick(rnd, tr.palette.noun), 'palette'], sal.palette * 2]);
    tr.finish.forEach(([, nn, s], i) => opts.push([[() => pick(rnd, nn), 'finish' + i], s * 1.6]));
    tr.feel.forEach(([, nn, s], i) => opts.push([[() => pick(rnd, nn), 'feel' + i], s * 1.6]));
    if (tr.place) opts.push([[() => pick(rnd, PLACE[tr.place].noun), 'place'], 0.7]);
    if (tr.time && tr.time.holiday) opts.push([[() => pick(rnd, tr.time.holiday.nouns), 'season'], 0.3 + 0.9 * tr.time.strength]);
    if (tr.time && tr.time.clock) opts.push([[() => pick(rnd, tr.time.clock.nouns), 'clock'], 0.4]);
    const [f, u] = choose(rnd, opts);
    return { w: f(), u };
  };
  const colourWord = () => (tr.main ? pick(rnd, tr.main.names.slice(0, 3)) : tr.palette && tr.palette.named && tr.palette.named.length <= 2 ? pick(rnd, tr.palette.named) : null);
  const colourU = tr.palette ? 'palette' : 'colour';
  const firstOf = () => pick(rnd, FIRST);
  const surnameOf = () => {
    const by = [...(SURNAME_BY[tr.texture] || []), ...(SURNAME_BY[tr.edgeKey] || []), ...(SURNAME_BY[tr.glitterKey] || [])];
    return by.length && rnd() < 0.45 ? { w: pick(rnd, by), u: SURNAME_BY[tr.texture] ? 'material' : tr.glitterKey ? 'glitter' : null } : { w: pick(rnd, SURNAME), u: null };
  };
  const epiOf = () => {
    if (tr.storied.length && rnd() < 0.3) return { w: pick(rnd, tr.storied.flatMap((k) => LEGEND_BY_REC[k])), u: 'record' };
    if (tr.place && rnd() < 0.18) return { w: pick(rnd, PLACE[tr.place].of), u: 'place' };
    if (rnd() < 0.72) return { w: pick(rnd, trait.epi), u: tu };
    if (tr.tearless && rnd() < 0.5) return { w: 'the Untearable', u: 'feel0' };
    return { w: pick(rnd, GENERIC_EPI), u: null };
  };
  const titleOf = () => {
    if ((tr.glitterKey === 'gold' || tr.texture === 'chrome' || tr.texture === 'pearl') && rnd() < 0.5) return { w: pick(rnd, FANCY_TITLES), u: tr.glitterKey === 'gold' ? 'glitter' : 'material' };
    return rnd() < 0.55 ? { w: pick(rnd, trait.titles), u: tu } : { w: pick(rnd, TITLES), u: null };
  };
  // alliteration, when it's on offer: a first name with the adjective's letter
  const allit = (word, list) => {
    const l = list.filter((x) => x[0] === word[0]);
    return l.length && rnd() < 0.6 ? pick(rnd, l) : pick(rnd, list);
  };
  const U = (...xs) => xs.filter(Boolean);

  // a legendary name, now and then (more for a storied, or a legendary, cube)
  if (rnd() < 0.02 + tr.storied.length * 0.03 + (tr.mat.legend ? 0.02 : 0)) {
    const deeds = tr.storied.flatMap((k) => LEGEND_BY_REC[k]);
    const deed = deeds.length && rnd() < 0.7 ? pick(rnd, deeds) : pick(rnd, LEGEND);
    return { t: deed.startsWith('the ') ? `${firstOf()} ${deed}` : `${firstOf()}, ${deed}`, u: U(deeds.length ? 'record' : null), k: 0.6 };
  }

  const fam = tr.gen > 0;
  const gemlike = tr.mat.gem || tr.texture === 'ice';
  const kinds = [
    ['pun', 1.8], ['adjNoun', 3], ['adjAdjNoun', 0.9], ['titleName', 2], ['nameEpithet', 2], ['fullName', 1.2], ['regal', 0.9],
    ['wrestler', 0.8], ['robot', tr.texture === 'chrome' || tr.texture === 'holo' ? 2.4 : 0.5], ['band', 0.8], ['latin', 0.9],
    ['dessert', tr.mat.sweet ? 1.8 : 0.5], ['ship', 0.5], ['portmanteau', 1.2], ['phrase', 1.5], ['superhero', 0.9],
    ['paint', tr.main ? 1.6 : tr.palette && tr.palette.named && tr.palette.named.length <= 2 ? 1.2 : 0], ['gem', gemlike ? 2.2 : 0.2], ['combo', tr.palette && tr.palette.named && tr.palette.named.length >= 2 ? (tr.palette.named.length <= 3 ? 2.4 : 0.8) : 0],
    ['palette', tr.palette && tr.palette.noun.length ? 2.4 : 0], ['pattern', tr.pattern ? 2.4 : 0], ['shot', tr.palette && tr.flavor !== 'rubik' ? 1.2 : 0],
    ['horse', 0.6], ['place', tr.place ? 1.8 : 0], ['season', tr.time ? (tr.time.holiday ? 0.6 + 1.4 * tr.time.strength : 0.5) : 0],
    ['heir', fam ? 6 : 0], ['twin', tr.twin ? (pairOf(tr.twin) ? 60 : 5) : 0], ['pairHalf', tr.pairing ? 1 : 0], ['mutant', tr.changes.length ? 2.2 : 0], ['monster', tr.mat.monster || tr.dark ? 1 : 0.15],
  ];
  const kind = choose(rnd, kinds);
  const A = adjFrom(), N = nounFrom();
  switch (kind) {
    case 'pun':
      return { t: pick(rnd, punsFor({ flavor: tr.flavor, texture: tr.texture })), u: ['material'], k: 0.35 };
    case 'adjNoun':
      return { t: `${A.w} ${N.w}`, u: U(A.u, N.u) };
    case 'adjAdjNoun': {
      const B = adjFrom();
      return B.w === A.w || B.u === A.u ? null : { t: `${A.w} ${B.w} ${N.w}`, u: U(A.u, B.u, N.u), k: -0.3 };
    }
    case 'titleName': {
      const t = titleOf();
      return { t: `${t.w} ${rnd() < 0.5 ? allit(A.w, FIRST) : firstOf()}`, u: U(t.u) };
    }
    case 'nameEpithet': {
      const e = epiOf();
      return { t: `${rnd() < 0.5 ? allit(A.w, FIRST) : firstOf()} ${e.w}`, u: U(e.u), k: 0.1 };
    }
    case 'fullName': {
      const s = surnameOf();
      return { t: `${firstOf()} ${s.w}`, u: U(s.u) };
    }
    case 'regal': {
      const t = rnd() < 0.5 ? titleOf() : null;
      return { t: `${t ? t.w + ' ' : ''}${firstOf()} ${pick(rnd, SUFFIX)}`, u: U(t && t.u) };
    }
    case 'wrestler': {
      const nick = rnd() < 0.5 ? `The ${N.w}` : A.w;
      return { t: `${firstOf()} “${nick}” ${rnd() < 0.5 ? pick(rnd, SURNAME) : ''}`, u: U(rnd() < 0.5 ? N.u : A.u), k: 0.15 };
    }
    case 'robot': {
      const m = rnd() < 0.5 ? tr.mat.morph : pick(rnd, trait.verb).split(' ')[0];
      return { t: rnd() < 0.5 ? `${m}tron ${pick(rnd, ROBOT_NUMS)}` : `${cap(m)}-${pick(rnd, ['X', 'Z', 'Q', 'J', 'K'])}${Math.floor(rnd() * 90 + 10)}`, u: ['material'], k: 0.1 };
    }
    case 'band':
      return rnd() < 0.5 ? { t: `The ${A.w} ${pick(rnd, PLURALS)}`, u: U(A.u), k: 0.1 } : { t: `${firstOf()} & the ${pick(rnd, PLURALS)}`, u: [] };
    case 'latin': {
      const col = tr.main ? latinColour(tr.main.fam) : tr.palette ? (tr.palette.rainbow ? pick(rnd, ['iridis', 'versicolor', 'arcuatus']) : tr.palette.fams.length > 2 ? 'varius' : latinColour(tr.palette.fams[0])) : null;
      const sp = [...trait.sp, 'cubicus', 'quadratus', 'gelatinosus', tr.big ? 'maximus' : tr.small ? 'minimus' : 'vulgaris'];
      const useCol = col && rnd() < 0.45;
      return { t: `${tr.mat.genus} ${useCol ? col : pick(rnd, sp)}`, u: U('material', useCol ? colourU : tu), k: 0.15 };
    }
    case 'dessert': {
      const f = tr.main && tr.main.foods.length && rnd() < 0.6 ? tr.main.foods[0] : tr.flavorWord;
      return { t: pick(rnd, DESSERTS).replace('{F}', unhyphen(f)).replace('{M}', pick(rnd, tr.mat.noun)), u: [colourU, 'material'], k: 0.1 };
    }
    case 'ship':
      return { t: `${pick(rnd, ['HMS', 'SS', 'USS', 'RMS'])} ${rnd() < 0.5 ? A.w : firstOf()}${rnd() < 0.4 ? ' ' + N.w : ''}`, u: U(A.u) };
    case 'portmanteau': {
      const stem = rnd() < 0.6 ? pick(rnd, trait.verb).split(' ')[0] : tr.mat.morph;
      return { t: `${cap(stem)}${pick(rnd, CUBE_MORPHS)}${rnd() < 0.3 ? ' ' + pick(rnd, ROBOT_NUMS) : ''}`, u: [tu] };
    }
    case 'phrase': {
      // (one-word verbs: "Keep Calm and Stay Put On" didn't scan)
      const one = trait.verb.filter((w) => !w.includes(' '));
      const v = pick(rnd, one.length ? one : ['Jiggle', 'Wobble']);
      const C = colourWord();
      const p = pick(rnd, C ? PHRASES : PHRASES.filter((x) => !x.includes('{C}')));
      const t = p.replace('{Ving}', ing(v)).replace('{V}', v).replace('{A}', A.w).replace('{N}', N.w).replace('{F}', tr.flavorWord).replace('{M}', pick(rnd, tr.mat.noun)).replace('{C}', C || '');
      return { t, u: U(/{V|{Ving}/.test(p) ? tu : null, p.includes('{A}') ? A.u : null, p.includes('{N}') ? N.u : null, /{C}|{F}/.test(p) ? colourU : null, p.includes('{M}') ? 'material' : null), k: 0.3 };
    }
    case 'superhero':
      return { t: pick(rnd, [`Captain ${N.w}`, `The Incredible ${N.w}`, `Doctor ${pick(rnd, trait.noun).split(' ')[0]}`, `The Amazing ${A.w} ${N.w}`, `${N.w} Kid`, `Mega${N.w.split(' ')[0].toLowerCase()}`]), u: U(N.u, A.u), k: 0.1 };
    case 'paint': {
      // a paint chip: a mood (its own, from how it feels) and its colour
      const mood = rnd() < 0.55 ? { w: pick(rnd, trait.mood), u: tu } : { w: pick(rnd, PAINT_MOOD), u: null };
      const C = colourWord();
      return C ? { t: `${mood.w} ${C}`, u: U(mood.u, colourU), k: 0.3 } : null;
    }
    case 'gem': {
      const fam = tr.main ? tr.main.fam : tr.palette && tr.palette.fams[0];
      const g = pick(rnd, GEM_BY_FAM[fam] || GEM_BY_FAM.white);
      return { t: rnd() < 0.5 ? `The ${g}` : `${pick(rnd, ['Star', 'Fire', 'Crown', 'Cursed', 'Midnight', 'Flawless'])} ${g}`, u: ['material', colourU], k: 0.3 };
    }
    case 'combo': {
      const [a, b] = pickTwo(rnd, tr.palette.named);
      const tn = rnd() < 0.5 ? null : rnd() < 0.6 ? { w: pick(rnd, tr.mat.noun), u: 'material' } : tr.pattern ? { w: pick(rnd, tr.pattern.noun), u: 'pattern' } : null;
      return { t: `${a} & ${b}${tn ? ' ' + tn.w : ''}`, u: U('palette', tn && tn.u), k: 0.15 };
    }
    case 'palette':
      return { t: rnd() < 0.55 ? pick(rnd, tr.palette.noun) : `${pick(rnd, tr.palette.noun)} ${pick(rnd, tr.mat.noun)}`, u: ['palette', 'material'], k: 0.25 };
    case 'pattern': {
      const pn = pick(rnd, tr.pattern.noun);
      return rnd() < 0.5 ? { t: `${A.u === 'pattern' ? '' : A.w + ' '}${pn}`, u: U('pattern', A.u !== 'pattern' ? A.u : null), k: 0.15 } : { t: `${pick(rnd, tr.pattern.adj)} ${N.u === 'pattern' ? pick(rnd, tr.mat.noun) : N.w}`, u: U('pattern', N.u === 'pattern' ? 'material' : N.u) };
    }
    case 'shot': {
      const P = tr.palette.name || pick(rnd, tr.palette.adj);
      const C = colourWord() || pick(rnd, tr.palette.adj);
      return { t: pick(rnd, SHOTS).replace('{P}', P).replace('{C}', C), u: ['palette'], k: 0.2 };
    }
    case 'horse': {
      const h = pick(rnd, HORSE);
      return { t: h.replace('{A}', A.w).replace('{N}', N.w).replace('{F}', tr.flavorWord), u: U(h.includes('{A}') ? A.u : null, h.includes('{N}') ? N.u : null, h.includes('{F}') ? colourU : null), k: 0.15 };
    }
    case 'place': {
      const P = PLACE[tr.place];
      return pick(rnd, [
        { t: `${titleOf().w} ${firstOf()} ${pick(rnd, P.of)}`, u: ['place'], k: 0.1 },
        { t: `The ${pick(rnd, P.adj)} ${N.w}`, u: U('place', N.u) },
        { t: `${firstOf()} ${pick(rnd, P.of)}`, u: ['place'], k: 0.15 },
      ]);
    }
    case 'season': {
      const s = tr.time.holiday || tr.time;
      return rnd() < 0.5 ? { t: `${pick(rnd, s.words)} ${N.w}`, u: U('season', N.u) } : { t: `${A.w} ${pick(rnd, s.nouns)}`, u: U('season', A.u), k: 0.1 };
    }
    case 'heir': {
      // the family: its parent's name carried on, a generation down - its
      // surname, its number, its sequel; or the parent's noun, with an
      // adjective of the child's own ("Defiant Cherry" - "Wobbly Cherry")
      const P = parseName(tr.parent), g = tr.gen, opts = [];
      const add = (t, w, u = null, k = 0.3) => t && t.length <= 26 && opts.push([{ t, u: U('family', u), k }, w]);
      if (P.base) {
        const ofP = P.base.replace(/^The /, 'the ');
        const short = P.base.length <= 18, latin = !!P.genus;
        if (short || P.num) add(`${P.base} ${ROMAN[Math.max(2, P.num + 1)] || 'Jr.'}`, latin ? 0.4 : 2);
        if (short && !latin) {
          add(`${P.base} ${pick(rnd, ['Jr.', 'the Younger', 'Junior'])}`, 0.8);
          if (!/^(Little|Baby|Mini|Tiny) /.test(P.base)) add(`${pick(rnd, ['Little', 'Baby', 'Mini'])} ${P.base}`, 1);
          const q = pick(rnd, SEQUELS);
          add(q.replace('{P}', q.startsWith('{P}') ? P.base : ofP), 1.2, null, 0.35);
        }
        if (P.base.length <= 13) add(`${pick(rnd, ['Child', 'Heir'])} of ${ofP}`, 0.6);
      }
      if (P.given && P.surname) add(`${firstOf()} ${P.surname}`, 4, null, 0.4);
      if (P.given && P.given.length <= 9) {
        add(`${firstOf()} ${pick(rnd, [`${P.given}son`, `${P.given}son`, `${P.given}sdottir`, `Mac${P.given}`, `Fitz${P.given.toLowerCase()}`])}`, 1.4, null, 0.4);
        add(`${P.given}${pick(rnd, ['ling', 'ette', 'kin', 'let'])}`.replace(/e(ette)$/, '$1'), 0.8);
      }
      if (P.noun) {
        add(`${A.w} ${P.noun}`, 2, A.u, 0.2);
        add(`Little ${P.noun}`, 0.6);
      }
      if (P.genus) add(`${P.genus} ${pick(rnd, ['filius', 'minor', 'junior', 'novus'])}`, 3, null, 0.4);
      add(`Chip off the Old ${pick(rnd, ['Block', 'Cube', 'Brick'])}`, 0.2);
      add(`${firstOf()} ${g + 1 < ORDINAL.length ? ORDINAL[g + 1] : 'the Many-Times-Great'}`, 0.5);
      if (g >= 2) add(`${firstOf()} of the ${['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'][Math.min(8, g)]} Batch`, 0.4);
      return choose(rnd, opts);
    }
    case 'twin': {
      // the twin of one just named: the other half of its pair, its
      // surname, its noun or adjective with one of its own, its evil twin
      const t = tr.twin, half = pairOf(t);
      if (half) return { t: half, u: ['family'], k: 1.4 };
      const P = parseName(t), opts = [];
      const add = (x, w, u = null, k = 0.3) => x && x.length <= 26 && opts.push([{ t: x, u: U('family', u), k }, w]);
      if (P.given && P.surname) add(`${firstOf()} ${P.surname}`, 4, null, 0.4);
      if (P.given && !P.surname) {
        add(`The Other ${P.given}`, 1);
        add(`${P.given} Two`, 0.5);
      }
      if (P.noun) add(`${A.w} ${P.noun}`, 2, A.u, 0.2);
      if (P.adj) add(`${P.adj.replace(/^Evil /, '')} ${N.w}`, 1.2, N.u, 0.2);
      if (P.genus) add(`${P.genus} ${rnd() < 0.5 ? 'geminus' : 'alter'}`, 3, null, 0.4);
      const bare = P.base.replace(/^The /, '');
      if (bare && bare.length <= 18 && !/Evil/.test(bare)) add(`Evil ${bare}`, 1.2, null, 0.35);
      if (t.length <= 14) add(`Not ${t.replace(/^The /, 'the ')}`, 0.7);
      if (t.length <= 16) add(`${t}’${/s$/.test(t) ? '' : 's'} Twin`, 0.7);
      add(pick(rnd, ['The Spare', 'The Other One', 'Also a Cube']), 0.3);
      return choose(rnd, opts);
    }
    case 'pairHalf': {
      // the first of twins, named for a pair (its twin gets the other half)
      const fits = (h) => !h || (TRAITS[h] ? (tr.T[h] || 0) > 0.55 : h === 'sweet' ? !!tr.mat.sweet : h === 'jello' ? tr.texture === 'jello' : h === 'glitter' ? tr.glitter.length > 0 : h === 'small' ? tr.small : h === 'big' ? tr.big : h === 'dark' ? tr.dark : false);
      const [a, , h] = choose(rnd, PAIRS.map((p) => [p, !p[2] ? 1 : fits(p[2]) ? 6 : 0.15]));
      const hu = h && fits(h) ? (TRAITS[h] ? 'trait:' + h : h === 'sweet' || h === 'jello' ? 'material' : h === 'glitter' || h === 'dark' ? h : null) : null;
      return { t: a, u: U('family', hu), k: 0.5 };
    }
    case 'mutant': {
      const big = tr.changes.find((x) => x.tier >= 3) || tr.changes[0];
      // (what it turned into: "Turned to rubber" - Rubber; "Radial!" - Radial)
      const lab = String(big.label || '');
      const word = /^Subdivided/i.test(lab) ? 'Tiled' : cap((lab.replace(/^(Turned to|A)\s+/i, '').match(/[A-Za-z]+/g) || ['Strange']).filter((x) => !/^(cube|edges|glitter|s)$/i.test(x)).pop() || 'Strange');
      return pick(rnd, [
        { t: `${firstOf()} the ${word}-Born`, u: ['mutation'], k: 0.2 },
        { t: `Mutant ${N.w}`, u: U('mutation', N.u) },
        { t: `${firstOf()} the Changeling`, u: ['mutation'] },
        { t: `The ${word} Anomaly`, u: ['mutation'], k: 0.1 },
        { t: `${A.w} Mutation`, u: U('mutation', A.u) },
      ]);
    }
    case 'monster':
      return { t: pick(rnd, [`The ${N.w} From Beyond`, `It Came From the ${pick(rnd, ['Fridge', 'Lab', 'Bowl', 'Deep'])}`, `The ${A.w} Horror`, `Creature of the ${pick(rnd, ['Black Lagoon', 'Night', 'Jelly Mould'])}`, `${N.w}zilla`]), u: U(N.u, A.u, 'material'), k: 0.2 };
    default:
      return { t: `${A.w} ${N.w}`, u: U(A.u, N.u) };
  }
}

// A name taken apart the way a person's is - its title, given name,
// surname, epithet, number ("Sir Cubert McCube III", "Pip the Brave") - or,
// if it isn't a person's, its adjective and noun ("Defiant Cherry"), or a
// binomial's genus ("Elasticus caeruleus"); base: it without its number.
function parseName(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  const P = { title: '', given: '', surname: '', epithet: '', num: 0, base: '', adj: '', noun: '', genus: '' };
  // (its number, or letters after it)
  while (w.length > 1) {
    const last = w[w.length - 1], r = ROMAN.indexOf(last);
    if (r > 1 && !P.num) P.num = r;
    else if (/^(Jr\.|Junior)$/.test(last) && !P.num) P.num = 2;
    else if (!/^(Sr\.|Esq\.|PhD|MBE)$/.test(last)) break;
    w.pop();
  }
  P.base = w.join(' ');
  if (w.length === 2 && /^[A-Z][a-z]+(us|a|um|is|ix)$/.test(w[0]) && /^[a-z]+$/.test(w[1])) {
    P.genus = w[0];
    return P;
  }
  const v = [...w];
  if (v.length > 1 && (TITLES.includes(v[0]) || FANCY_TITLES.includes(v[0]))) P.title = v.shift();
  if (v.length && (FIRST.includes(v[0]) || (v.length === 1 && /^[A-Z][a-z]+$/.test(v[0]) && !NOT_HEAD.has(v[0])))) {
    P.given = v.shift();
    const ep = v.findIndex((x) => /^(the|of|who)$/i.test(x));
    if (ep >= 0) P.epithet = v.splice(ep).join(' ');
    P.surname = v.join(' ');
  } else if (!P.title && v.length >= 2 && v.length <= 4 && v.every((x) => /^[A-Z]/.test(x))) {
    // ("Defiant Cherry", "The Candy Cane Tofu": all words its own, the last a noun)
    const last = v[v.length - 1];
    if (/^[A-Z][a-z]{2,}$/.test(last) && !NOT_HEAD.has(last)) {
      P.noun = last;
      P.adj = v.slice(v[0] === 'The' ? 1 : 0, -1).join(' ');
    }
  }
  return P;
}

function latinColour(fam) {
  return { red: 'rubrum', orange: 'aurantiacus', yellow: 'flavus', green: 'viridis', teal: 'thalassinus', blue: 'caeruleus', purple: 'purpureus', pink: 'roseus', brown: 'fuscus', white: 'albus', grey: 'cinereus', black: 'niger' }[fam] || 'versicolor';
}

function pickTwo(rnd, list) {
  const a = pick(rnd, list);
  const rest = list.filter((x) => x !== a);
  return [a, rest.length ? pick(rnd, rest) : a];
}
