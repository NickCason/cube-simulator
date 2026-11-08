// Jelly presets: flavours (colour or layered), textures (look + feel) and
// edge rounding.

import { freeCSS } from './freeform.js';

export const FLAVORS = [
  { id: 'cherry', name: 'Cherry', hex: '#d4102a' },
  { id: 'lime', name: 'Lime', hex: '#5fce1e' },
  { id: 'blue', name: 'Blue raspberry', hex: '#0f8cff' },
  { id: 'grape', name: 'Grape', hex: '#7a24d4' },
  { id: 'orange', name: 'Orange', hex: '#ff7414' },
  { id: 'lemon', name: 'Lemon', hex: '#ffcc12' },
  { id: 'watermelon', name: 'Watermelon', hex: '#ff3f7f' },
  { id: 'cola', name: 'Cola', hex: '#7a2e0e' },
  // layered: colours come from the user's layer stack (style.layers)
  { id: 'layers', name: 'Layers', layered: true },
  // a 3x3 of stickers on every face, scrambled (style.rubik: its scramble)
  { id: 'rubik', name: 'Rubik', rubik: true },
];

// Rubik: six colours, and the stickers - each face a 3x3, run in to the
// middle (a point is in the face it's nearest), the centres their face's
// own colour, the rest scrambled by a seed (0: solved). The same hash runs in
// the shaders (CUBE_GLSL's rubikAt): they must agree, so never change it.
export const RUBIK_COLORS = ['#f4f2ec', '#ffcc12', '#e0102a', '#ff6a0d', '#1262ff', '#1cb84a']; // white yellow red orange blue green
export const RUBIK_FACE = [2, 3, 0, 1, 5, 4]; // the centre colour of +x, -x, +y, -y, +z, -z
export function rubikIndex(seed, face, cell) {
  if (!seed || cell === 4) return RUBIK_FACE[face];
  let h = (Math.imul(seed >>> 0, 747796405) + Math.imul(face * 9 + cell, 2891336453 | 0)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 2246822519 | 0) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 3266489917 | 0) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h % 6;
}
// the sticker a rest point (cube of side `size`, centred) is in: [face, cell]
export function rubikCellAt(x, y, z, size) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let face, u, v;
  if (ax >= ay && ax >= az) [face, u, v] = [x > 0 ? 0 : 1, z, y];
  else if (ay >= az) [face, u, v] = [y > 0 ? 2 : 3, x, z];
  else [face, u, v] = [z > 0 ? 4 : 5, x, y];
  const g = (w) => Math.min(2, Math.max(0, Math.floor(((w + size / 2) / size) * 3)));
  return [face, g(u) * 3 + g(v)];
}
export const RUBIK_SWATCH =
  'linear-gradient(90deg, transparent 31%, #1b1b1f 31% 36%, transparent 36% 64%, #1b1b1f 64% 69%, transparent 69%), ' +
  'linear-gradient(180deg, transparent 31%, #1b1b1f 31% 36%, transparent 36% 64%, #1b1b1f 64% 69%, transparent 69%), ' +
  'conic-gradient(from 20deg, #e0102a 0 17%, #1262ff 0 34%, #ffcc12 0 50%, #1cb84a 0 67%, #ff6a0d 0 84%, #f4f2ec 0)';

// Starting palettes for layered jelly, listed bottom → top. Optional: blur
// (blend between layers), repeat (the colours cycle this many times up the
// cube) and bias (-1..1: bands crowd toward the bottom or the top).
export const LAYER_PRESETS = [
  { id: 'rainbow', name: 'Rainbow', colors: ['#7b22d6', '#1572ff', '#2cc23a', '#ffc814', '#ff6a0d', '#e8102e'] },
  { id: 'pastel', name: 'Pastel', colors: ['#b39ddb', '#90caf9', '#a5d6a7', '#fff59d', '#ffcc80', '#f48fb1'], blur: 0.45 },
  { id: 'spectrum', name: 'Spectrum', colors: ['#ff1744', '#ff9100', '#ffea00', '#00e676', '#00e5ff', '#2979ff', '#651fff', '#d500f9'], blur: 1 },
  { id: 'stripes', name: 'Stripes', colors: ['#7b22d6', '#1572ff', '#2cc23a', '#ffc814', '#ff6a0d', '#e8102e'], blur: 0, repeat: 3 },
  { id: 'sunset', name: 'Sunset', colors: ['#3a0ca3', '#7209b7', '#f72585', '#ff6d00', '#ffbe0b'] },
  { id: 'ocean', name: 'Ocean', colors: ['#03045e', '#0077b6', '#00b4d8', '#90e0ef'] },
  { id: 'aurora', name: 'Aurora', colors: ['#0b1d51', '#0f5257', '#14a76c', '#9bf2a2', '#c77dff'], blur: 0.8, bias: -0.35 },
  { id: 'fire', name: 'Fire', colors: ['#fff3b0', '#ffd23f', '#ff8c42', '#e63946', '#7a0b1c'], blur: 0.9, bias: 0.4 },
  { id: 'berry', name: 'Berry', colors: ['#4a0e2b', '#9d174d', '#ec4899', '#f9a8d4'], blur: 0.35, repeat: 2 },
  { id: 'tropic', name: 'Tropic', colors: ['#00b4d8', '#90e0ef', '#ffd166', '#ef476f'], blur: 0.6, repeat: 2, bias: -0.3 },
  { id: 'neon', name: 'Neon', colors: ['#ff00a8', '#00e5ff', '#76ff03', '#ffea00'] },
  { id: 'candy', name: 'Candy', colors: ['#e8102e', '#f4f4f4', '#e8102e', '#f4f4f4', '#e8102e', '#f4f4f4', '#e8102e'] },
  { id: 'duo', name: 'Duo', colors: ['#3a86ff', '#ff006e'] },
  // (shaped: listed middle → outside)
  { id: 'jawbreaker', name: 'Jawbreaker', colors: ['#ffe14d', '#2ec5ff', '#ff2d6f', '#7cff4f', '#b04dff', '#ff8a1f'], shape: 'shell' },
  { id: 'hotcore', name: 'Sunburst', colors: ['#fff3b0', '#ffb703', '#fb5607', '#c1121f', '#4a0412'], blur: 1, shape: 'core' },
  { id: 'agate', name: 'Agate', colors: ['#f2e8cf', '#8ecae6', '#457b9d', '#e9c46a', '#264653'], blur: 0.3, repeat: 3, shape: 'rings' },
  { id: 'prism', name: 'Prism', colors: ['#ff1744', '#ffea00', '#00e676', '#2979ff', '#d500f9'], blur: 1, shape: 'corner' },
];

export const MAX_REPEAT = 6;
// height (0 bottom .. 1 top) -> position in the bands: bias crowds them
export const biasExp = (bias) => Math.pow(2, -1.5 * (bias || 0));

// The bands of a layered flavour, bottom → top: { color, h0, h1 } (heights 0..1).
export function layerBands(colors, repeat = 1, bias = 0) {
  const n = colors.length, m = n * Math.max(1, Math.round(repeat || 1)), e = biasExp(bias);
  const out = [];
  for (let k = 0; k < m; k++) out.push({ color: colors[k % n], h0: Math.pow(k / m, 1 / e), h1: Math.pow((k + 1) / m, 1 / e) });
  return out;
}

export const MIN_LAYERS = 2;
export const MAX_LAYERS = 10;

// ---- Gradients: a layered flavour's colours as stops along a line through
// the cube - up it (the bands they started as), across, corner to corner -
// or out from the middle of every face: radial rings or cubial squares -
// or rings round its upright axis, like a tree's. A stop is a colour at a place 0..1 along (stops
// null: evenly spaced, the bands' middles, as they always were). Blend runs
// from hard bands (each colour out to halfway to the next) to smooth fades;
// Repeat cycles them; Bias crowds them toward one end. All in the cube's
// rest shape, so they ride its wobble, show where it's cut and come back
// with a Re-cube. (The shaders read them as a strip worked out from these:
// see JellyView.setCubeLook.)
export const GRAD_SHAPES = [
  { id: 'up', name: 'Up', ends: ['Bottom', 'Top'] },
  { id: 'across', name: 'Across', ends: ['One side', 'Other side'] },
  { id: 'corner', name: 'Corner', ends: ['Corner', 'Corner'] },
  { id: 'core', name: 'Radial', ends: ['Face middle', 'Face edge'] },
  { id: 'shell', name: 'Cubial', ends: ['Face middle', 'Face edge'] },
  { id: 'rings', name: 'Rings', ends: ['Middle', 'Outside'] },
  // (freeform: its colours at points on the cube, each with a strength - see freeform.js)
  { id: 'free', name: 'Free', ends: ['', ''] },
];
export const GRAD_SHAPE_INDEX = Object.fromEntries(GRAD_SHAPES.map((g, i) => [g.id, i]));
// (out from the middle: drawn round, not along)
export const gradFromMiddle = (shape) => shape === 'core' || shape === 'shell' || shape === 'rings';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// the stops' places, one per colour, in order
export function gradStops(f) {
  const n = f.layers.length, s = f.stops;
  if (Array.isArray(s) && s.length === n && s.every(Number.isFinite)) return s.map(clamp01);
  return Array.from({ length: n }, (_, i) => (i + 0.5) / n);
}

// every stop over 0..1, the repeats in: { p, i } (i: which colour)
export function gradSequence(f) {
  const s = gradStops(f), r = Math.max(1, Math.round(f.repeat || 1)), out = [];
  for (let c = 0; c < r; c++) for (let i = 0; i < s.length; i++) out.push({ p: (c + s[i]) / r, i });
  return out;
}

// Where t (0..1 along the shape) falls: the colours either side (a, b) and
// how far it is from a to b (s), the bias and the blend taken in.
export function gradAt(f, t, seq = gradSequence(f)) {
  const h = Math.pow(Math.min(1, Math.max(1e-6, t)), biasExp(f.bias)), last = seq.length - 1;
  if (h <= seq[0].p) return { a: seq[0].i, b: seq[0].i, s: 0 };
  if (h >= seq[last].p) return { a: seq[last].i, b: seq[last].i, s: 0 };
  let k = 0;
  while (k < last - 1 && seq[k + 1].p <= h) k++;
  const A = seq[k], B = seq[k + 1], span = B.p - A.p;
  const u = span > 1e-6 ? (h - A.p) / span : 1;
  const w = Math.max((f.blur || 0) * 0.5, 0.012);
  return { a: A.i, b: B.i, s: smooth(0.5 - w, 0.5 + w, u) };
}

// A rest point's place along the shape, 0..1 (x, y, z from the cube's
// middle; size: its side). Out from the middle, 1 is the middle of a face
// (its corners and edges are past the end: the last colour).
export function gradT(shape, x, y, z, size) {
  const h = size / 2;
  if (shape === 'across') return x / size + 0.5;
  if (shape === 'corner') return (x + y + z) / (3 * size) + 0.5;
  if (shape === 'core' || shape === 'shell') {
    // (round the middle of the face it's nearest, in its two ways across it)
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    const [u, v] = ax >= ay && ax >= az ? [y, z] : ay >= az ? [x, z] : [x, y];
    return (shape === 'core' ? Math.hypot(u, v) : Math.max(Math.abs(u), Math.abs(v))) / h;
  }
  if (shape === 'rings') return Math.hypot(x, z) / h;
  return y / size + 0.5;
}

export function mixHex(a, b, s) {
  const p = parseInt(a.slice(1), 16), q = parseInt(b.slice(1), 16);
  const ch = (sh) => Math.round(((p >> sh) & 255) * (1 - s) + ((q >> sh) & 255) * s);
  return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}

// its colour at t
export function gradColorAt(f, t) {
  const { a, b, s } = gradAt(f, t);
  return s <= 0 ? f.layers[a] : s >= 1 ? f.layers[b] : mixHex(f.layers[a], f.layers[b], s);
}

// as CSS colour stops along 0..1 (hard edges kept hard)
export function gradCSSStops(f) {
  const C = f.layers, seq = gradSequence(f), e = biasExp(f.bias), w = Math.max((f.blur || 0) * 0.5, 0.012);
  const at = (h) => `${(Math.pow(clamp01(h), 1 / e) * 100).toFixed(2)}%`;
  const out = [`${C[seq[0].i]} 0%`];
  for (let k = 0; k + 1 < seq.length; k++) {
    const A = seq[k], B = seq[k + 1], span = B.p - A.p;
    out.push(`${C[A.i]} ${at(A.p + span * (0.5 - w))}`, `${C[B.i]} ${at(A.p + span * (0.5 + w))}`);
  }
  out.push(`${C[seq[seq.length - 1].i]} 100%`);
  return out.join(', ');
}

// a CSS picture of it: along its line (angle: forced, for a strip), or
// round, out from the middle (freeform: its points as soft blobs)
export function gradientCSS(f, angle = null) {
  if (f.shape === 'free' && angle === null) return freeCSS(f);
  const stops = gradCSSStops(f), shape = f.shape || 'up';
  if (angle === null && gradFromMiddle(shape)) return `radial-gradient(circle closest-side, ${stops})`;
  return `linear-gradient(${angle ?? (shape === 'across' ? 90 : shape === 'corner' ? 45 : 0)}deg, ${stops})`;
}

// a style's layers, copied whole (stops and freeform points kept only if
// there's one a colour)
export function copyLayers(L) {
  const D = DEFAULT_STYLE.layers;
  L = L || D;
  const colors = [...(Array.isArray(L.colors) && L.colors.length >= MIN_LAYERS ? L.colors : D.colors)];
  const stops = Array.isArray(L.stops) && L.stops.length === colors.length && L.stops.every(Number.isFinite) ? L.stops.map(clamp01) : null;
  const okN = (q) => q && ['x', 'y', 'z', 'k'].every((c) => Number.isFinite(q[c]));
  const nodes = Array.isArray(L.nodes) && L.nodes.length === colors.length && L.nodes.every(okN) ? L.nodes.map((q) => ({ x: q.x, y: q.y, z: q.z, k: q.k })) : null;
  const tiles = Math.min(MAX_TILES, Math.max(1, Math.round(L.tiles || 1)));
  return { colors, blur: L.blur || 0, repeat: L.repeat || 1, bias: L.bias || 0, stops, nodes, tiles, shape: GRAD_SHAPE_INDEX[L.shape] !== undefined ? L.shape : 'up' };
}

// (subdivided: the little cube a rest point's in, as though it were the
// whole one - see CUBE_GLSL cTile)
export const MAX_TILES = 5;
export function tileLocal(x, y, z, size, tiles) {
  if (!(tiles > 1)) return [x, y, z];
  const f = (v) => {
    const q = Math.min(0.9995, Math.max(0.0005, v / size + 0.5)) * tiles;
    return (q - Math.floor(q) - 0.5) * size;
  };
  return [f(x), f(y), f(z)];
}

// Material presets. Look: depth (colour), opacity, glow (translucency),
// rough, ior, sugar (crystal coating), milk (creamy body); dust (a powder
// on the outside: starch, icing sugar), skin (its iridescence and metal a
// film or foil on the outside only - cut, it's bare), through (its sugar
// all the way through, not a coat).
// Feel: mu (firmness), damping (viscosity), weight (density), lambda (volume
// keeping), bounce, grip. (Stored as style.texture: the first five were the
// original "textures", and saved styles and ?texture= links still name them.)
export const TEXTURES = {
  jello: { name: 'Jello', depth: 1.25, opacity: 0.25, glow: 0.5, rough: 0.035, ior: 1.36, sugar: 0, milk: 0, mu: 170, damping: 1.7, weight: 1, lambda: 24, bounce: 0.55, grip: 0.85, goo: 0.35 },
  gummy: { name: 'Gummy', depth: 1.5, opacity: 0.52, glow: 0.45, rough: 0.1, ior: 1.38, sugar: 0, milk: 0.12, mu: 430, damping: 3.4, weight: 1.15, lambda: 24, bounce: 0.55, grip: 0.85, goo: 0.45 },
  sour: { name: 'Sour', depth: 1.5, opacity: 0.5, glow: 0.45, rough: 0.1, ior: 1.38, sugar: 1, milk: 0.08, mu: 430, damping: 3.4, weight: 1.15, lambda: 24, bounce: 0.55, grip: 0.85, goo: 0.4 },
  crystal: { name: 'Crystal', depth: 0.42, opacity: 0.1, glow: 0.5, rough: 0.018, ior: 1.4, sugar: 0, milk: 0, mu: 140, damping: 1.2, weight: 0.95, lambda: 30, bounce: 0.55, grip: 0.85, goo: 0.25 },
  creamy: { name: 'Creamy', depth: 1.0, opacity: 0.82, glow: 0.62, rough: 0.05, ior: 1.36, sugar: 0, milk: 1, mu: 115, damping: 2.2, weight: 1, lambda: 24, bounce: 0.55, grip: 0.85, goo: 0.5 },
  slime: { name: 'Slime', depth: 0.8, opacity: 0.5, glow: 0.95, rough: 0.01, ior: 1.35, sugar: 0, milk: 0.2, mu: 52, damping: 5.5, weight: 1.05, lambda: 24, bounce: 0.08, grip: 1.4, goo: 1 },
  water: { name: 'Water balloon', depth: 0.45, opacity: 0.04, glow: 0.55, rough: 0.014, ior: 1.333, sugar: 0, milk: 0, mu: 46, damping: 0.32, weight: 1.5, lambda: 40, bounce: 0.3, grip: 0.8, goo: 0.15 },
  syrup: { name: 'Syrup', depth: 1.9, opacity: 0, glow: 0.72, rough: 0.013, ior: 1.49, sugar: 0, milk: 0, mu: 50, damping: 12, weight: 1.4, lambda: 30, bounce: 0.02, grip: 1.45, goo: 1 },
  mochi: { name: 'Mochi', depth: 0.45, opacity: 0.86, glow: 0.62, rough: 0.3, ior: 1.32, sugar: 0, milk: 0.9, mu: 70, damping: 9, weight: 1.1, lambda: 18, bounce: 0.04, grip: 1.45, goo: 0.9, dust: 0.38 },
  marshmallow: { name: 'Marshmallow', label: 'Marsh\u00admallow', depth: 0.22, opacity: 0.95, glow: 0.85, rough: 0.45, ior: 1.3, sugar: 0, milk: 1, mu: 80, damping: 7, weight: 0.35, lambda: 1.8, bounce: 0.25, grip: 1, goo: 0.7, dust: 0.42 },
  rubber: { name: 'Rubber', depth: 1.25, opacity: 0.97, glow: 0.15, rough: 0.26, ior: 1.5, sugar: 0, milk: 0.4, mu: 900, damping: 1, weight: 1.2, lambda: 30, bounce: 0.9, grip: 1.3, goo: 0.15 },
  glass: { name: 'Glass', depth: 0.14, opacity: 0, glow: 0.22, rough: 0.008, ior: 1.52, sugar: 0, milk: 0, mu: 1000, damping: 2.5, weight: 1.6, lambda: 40, bounce: 0.25, grip: 0.4, rigidity: 0.85, goo: 0, brittle: true, chip: '#eef8ff', glassy: true },
  // firm and dead: barely gives, doesn't bounce, crumbles more than it stretches
  tofu: { name: 'Tofu', depth: 0.5, opacity: 0.94, glow: 0.4, rough: 0.38, ior: 1.33, sugar: 0, milk: 0.95, mu: 600, damping: 6, weight: 1.05, lambda: 12, bounce: 0.04, grip: 1.1, rigidity: 0.45, goo: 0.05 },
  // soft and dead: heavy, sticky, slumps and stays
  putty: { name: 'Putty', depth: 0.55, opacity: 0.97, glow: 0.3, rough: 0.5, ior: 1.3, sugar: 0, milk: 0.75, mu: 240, damping: 14, weight: 1.35, lambda: 20, bounce: 0, grip: 1.5, rigidity: 0.2, goo: 0.75 },
  // rigid: a boiled sweet - knocks about like a solid, won't tear in your hands
  // (glass and hard candy are brittle too: they shatter like glass - candy
  // into chips of its own colour)
  candy: { name: 'Hard candy', label: 'Hard candy', depth: 1.1, opacity: 0.1, glow: 0.4, rough: 0.012, ior: 1.5, sugar: 0, milk: 0, mu: 1000, damping: 3, weight: 1.4, lambda: 40, bounce: 0.35, grip: 0.6, rigidity: 0.92, goo: 0, brittle: true, chip: 'flavor', glassy: true },
  // brittle (the mallet shatters it, chips fly - see MalletTool.strike):
  // a sugar cube - white, sparkly-grainy, firm and crumbly
  sugar: { name: 'Sugar cube', label: 'Sugar cube', depth: 0.32, opacity: 0.93, glow: 0.55, rough: 0.55, ior: 1.32, sugar: 1, milk: 1, mu: 760, damping: 8, weight: 1.15, lambda: 14, bounce: 0.03, grip: 1.35, rigidity: 0.6, tough: 0.45, goo: 0, brittle: true, chip: '#fffaf3', through: true },
  // an ice cube - clear, slippery, hard; the torch runs it to water, cryo sets it again
  ice: { name: 'Ice cube', label: 'Ice cube', depth: 0.2, opacity: 0.02, glow: 0.32, rough: 0.012, ior: 1.31, sugar: 0, milk: 0.06, mu: 1000, damping: 3, weight: 0.92, lambda: 40, bounce: 0.18, grip: 0.05, rigidity: 0.94, goo: 0, brittle: true, chip: '#dcefff' },
  // finishes: a rainbow film on glass (soap bubble), holographic foil, pearl, opal, chrome
  prism: { name: 'Prism', depth: 0.16, opacity: 0.02, glow: 0.62, rough: 0.01, ior: 1.5, sugar: 0, milk: 0, irid: 1, mu: 380, damping: 2.6, weight: 1.2, lambda: 30, bounce: 0.45, grip: 0.7, rigidity: 0.15, goo: 0.1, skin: 1 },
  holo: { name: 'Holo', depth: 0.8, opacity: 0.97, glow: 0.3, rough: 0.07, ior: 1.5, sugar: 0, milk: 0.1, irid: 1, metal: 0.72, mu: 420, damping: 3, weight: 1.3, lambda: 30, bounce: 0.5, grip: 0.8, rigidity: 0.1, goo: 0.1, skin: 1 },
  pearl: { name: 'Pearl', depth: 0.35, opacity: 0.9, glow: 0.7, rough: 0.12, ior: 1.45, sugar: 0, milk: 0.85, irid: 0.85, mu: 300, damping: 4, weight: 1.1, lambda: 26, bounce: 0.3, grip: 0.9, goo: 0.2 },
  opal: { name: 'Opal', depth: 0.3, opacity: 0.55, glow: 0.88, rough: 0.025, ior: 1.45, sugar: 0, milk: 0.72, irid: 0.18, opal: 1, mu: 260, damping: 3, weight: 1.05, lambda: 28, bounce: 0.4, grip: 0.85, goo: 0.2 },
  chrome: { name: 'Chrome', depth: 1, opacity: 1, glow: 0.1, rough: 0.045, ior: 1.6, sugar: 0, milk: 0, metal: 1, mu: 210, damping: 1.6, weight: 2.8, lambda: 30, bounce: 0.3, grip: 0.6, goo: 0.1 },
};

export const EDGES = {
  sharp: { name: 'Sharp', bevel: 0.035 },
  soft: { name: 'Soft', bevel: 0.08 },
  round: { name: 'Round', bevel: 0.13 },
  pillow: { name: 'Pillow', bevel: 0.21 },
};

export const GLITTERS = [
  { id: 'off', name: 'Off', dot: 'transparent' },
  { id: 'silver', name: 'Silver', dot: 'linear-gradient(135deg, #ffffff, #9aa3ad 55%, #eef2f6)' },
  { id: 'gold', name: 'Gold', dot: 'linear-gradient(135deg, #fff1b8, #d39a2c 55%, #ffe08a)' },
  { id: 'holo', name: 'Holo', dot: 'conic-gradient(#ff5f9e, #ffd25f, #6dffb0, #5fc8ff, #b28cff, #ff5f9e)' },
  { id: 'rose', name: 'Rose', dot: 'linear-gradient(135deg, #ffe0dc, #d9827a 55%, #ffd3cc)' },
  { id: 'cubic', name: 'Cubic', dot: 'conic-gradient(from 45deg, #ffffff, #cfe8ff, #ffd9f2, #fff3c4, #d6ffe9, #ffffff)' },
];

export const DEFAULT_STYLE = {
  flavor: 'cherry',
  texture: 'jello',
  edges: 'round',
  glitter: 'off',
  layers: { colors: [...LAYER_PRESETS[0].colors], blur: 0, repeat: 1, bias: 0, stops: null, shape: 'up' },
  rubik: 0, // (0: solved - picking Rubik scrambles it)
  eyes: [], // (googly eyes: see eyes.js - always a new array, never this one)
  surface: 'none', // (its surface map: see surfaces.js)
};

export function flavorById(id) {
  if (typeof id === 'string' && id.startsWith('#')) return { id, name: 'Custom', hex: id };
  return FLAVORS.find((f) => f.id === id && !f.layered && !f.rubik) || FLAVORS[0];
}

// Resolve the style's flavour into { hex } or { layers, blur, repeat, bias,
// stops, shape } (see gradAt).
export function resolveFlavor(style) {
  if (style.flavor === 'layers' || style.flavor === 'rainbow') {
    const L = style.layers || DEFAULT_STYLE.layers;
    const stops = Array.isArray(L.stops) && L.stops.length === L.colors.length ? L.stops : null;
    const nodes = Array.isArray(L.nodes) && L.nodes.length === L.colors.length ? L.nodes : null;
    return { id: 'layers', name: 'Layers', layers: L.colors, blur: L.blur ?? 0, repeat: L.repeat || 1, bias: L.bias || 0, stops, nodes, tiles: Math.max(1, Math.round(L.tiles || 1)), shape: GRAD_SHAPE_INDEX[L.shape] !== undefined ? L.shape : 'up' };
  }
  // (Rubik: its scramble, and red for where one colour has to stand for it)
  if (style.flavor === 'rubik') return { id: 'rubik', name: 'Rubik', rubik: Number.isFinite(style.rubik) ? style.rubik : 1, hex: RUBIK_COLORS[2] };
  return flavorById(style.flavor);
}

export function flavorSwatchCSS(f) {
  if (f.id === 'rubik') return RUBIK_SWATCH;
  if (f.layers) return gradientCSS(f);
  return f.hex;
}

// representative single colour (for UI dots, droplets, glow)
export function flavorMainHex(f) {
  return f.layers ? f.layers[Math.floor(f.layers.length / 2)] : f.hex;
}

// A fresh layer colour: the top colour turned around the hue wheel.
export function nextLayerColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  let r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360 + 47) % 360;
  const s2 = Math.max(0.65, mx ? d / mx : 0), v = Math.max(0.75, mx);
  const c = v * s2, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (u) => Math.round((u + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

// A material tile for the picker: the flavour colour as that material
// looks - clear or solid, glossy or matte, glowing, milky, sugared.
export function materialSwatchCSS(t, hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const rgb = (a, al = 1) => `rgba(${a[0]}, ${a[1]}, ${a[2]}, ${al})`;
  const W = [255, 255, 255], K = [0, 0, 0];
  const o = Math.min(1, t.opacity), clear = 1 - o;
  const body = mix(c, W, 0.5 * t.milk);
  const mid = mix(body, W, 0.42 * clear * Math.min(1, 1.2 / t.depth));
  const edge = mix(body, K, 0.18 + 0.14 * Math.min(1.5, t.depth) * clear);
  const s = Math.max(0, Math.min(1, 1 - t.rough / 0.45)); // gloss sharpness
  const ha = 0.4 + 0.55 * s;
  const layers = [];
  // opal: flecks of colour
  if (t.opal > 0) {
    for (const [x, y, col] of [[30, 34, '#ff5fa2'], [64, 28, '#5fe8ff'], [44, 62, '#9dff6b'], [70, 66, '#ffd25f'], [24, 72, '#b48cff']]) {
      layers.push(`radial-gradient(circle at ${x}% ${y}%, ${col} 0 7%, transparent 11%)`);
    }
  }
  if (t.sugar > 0) {
    const a = 0.35 + 0.5 * Math.min(1, t.sugar);
    layers.push(`radial-gradient(circle, rgba(255, 255, 255, ${a}) 0 0.6px, transparent 1.1px) 1px 2px / 9px 8px`);
    layers.push(`radial-gradient(circle, rgba(255, 255, 255, ${a * 0.75}) 0 0.5px, transparent 1px) 5px 6px / 7px 9px`);
  }
  layers.push(`radial-gradient(ellipse 58% 34% at 36% 22%, rgba(255, 255, 255, ${ha}) 0%, rgba(255, 255, 255, ${ha * 0.85}) ${16 + 30 * (1 - s)}%, transparent ${30 + 42 * (1 - s)}%)`);
  // a rainbow film (iridescence): over the body, under the highlight
  if (t.irid > 0) {
    const a = (0.32 + 0.4 * (t.metal || 0)) * t.irid;
    const k = (r, g, b) => `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
    layers.push(`conic-gradient(from 200deg at 50% 46%, ${k(255, 82, 205)}, ${k(170, 100, 255)}, ${k(80, 200, 255)}, ${k(255, 238, 120)}, ${k(255, 140, 110)}, ${k(255, 82, 205)})`);
  }
  layers.push(`radial-gradient(ellipse 80% 55% at 50% 100%, ${rgb(mix(c, W, 0.35), 0.55 * t.glow * (1 - 0.5 * o))}, transparent 70%)`);
  if (t.metal > 0.5) {
    // metal: bands of its own colour, bright and dark, as a mirror shows a room
    const lt = mix(c, W, 0.55), dk = mix(c, K, 0.55);
    layers.push(`linear-gradient(165deg, ${rgb(lt)} 0%, ${rgb(c)} 32%, ${rgb(dk)} 50%, ${rgb(mix(c, W, 0.15))} 62%, ${rgb(lt)} 86%)`);
  } else layers.push(`radial-gradient(circle at 50% 58%, ${rgb(mid)} 0%, ${rgb(body)} 55%, ${rgb(edge)} 100%)`);
  return layers.join(', ');
}
