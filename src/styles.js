// Jelly presets: flavours (colour or layered), textures (look + feel) and
// edge rounding.

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
];

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

// Material presets. Look: depth (colour), opacity, glow (translucency),
// rough, ior, sugar (crystal coating), milk (creamy body).
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
  mochi: { name: 'Mochi', depth: 0.45, opacity: 0.86, glow: 0.62, rough: 0.3, ior: 1.32, sugar: 0, milk: 0.9, mu: 70, damping: 9, weight: 1.1, lambda: 18, bounce: 0.04, grip: 1.45, goo: 0.9 },
  marshmallow: { name: 'Marshmallow', label: 'Marsh\u00admallow', depth: 0.22, opacity: 0.95, glow: 0.85, rough: 0.45, ior: 1.3, sugar: 0, milk: 1, mu: 80, damping: 7, weight: 0.35, lambda: 1.8, bounce: 0.25, grip: 1, goo: 0.7 },
  rubber: { name: 'Rubber', depth: 1.25, opacity: 0.97, glow: 0.15, rough: 0.26, ior: 1.5, sugar: 0, milk: 0.4, mu: 900, damping: 1, weight: 1.2, lambda: 30, bounce: 0.9, grip: 1.3, goo: 0.15 },
  glass: { name: 'Glass', depth: 0.14, opacity: 0, glow: 0.22, rough: 0.008, ior: 1.52, sugar: 0, milk: 0, mu: 1000, damping: 2.5, weight: 1.6, lambda: 40, bounce: 0.25, grip: 0.4, rigidity: 0.85, goo: 0 },
  // firm and dead: barely gives, doesn't bounce, crumbles more than it stretches
  tofu: { name: 'Tofu', depth: 0.5, opacity: 0.94, glow: 0.4, rough: 0.38, ior: 1.33, sugar: 0, milk: 0.95, mu: 600, damping: 6, weight: 1.05, lambda: 12, bounce: 0.04, grip: 1.1, rigidity: 0.45, goo: 0.05 },
  // soft and dead: heavy, sticky, slumps and stays
  putty: { name: 'Putty', depth: 0.55, opacity: 0.97, glow: 0.3, rough: 0.5, ior: 1.3, sugar: 0, milk: 0.75, mu: 240, damping: 14, weight: 1.35, lambda: 20, bounce: 0, grip: 1.5, rigidity: 0.2, goo: 0.75 },
  // rigid: a boiled sweet - knocks about like a solid, won't tear in your hands
  candy: { name: 'Hard candy', label: 'Hard candy', depth: 1.1, opacity: 0.1, glow: 0.4, rough: 0.012, ior: 1.5, sugar: 0, milk: 0, mu: 1000, damping: 3, weight: 1.4, lambda: 40, bounce: 0.35, grip: 0.6, rigidity: 0.92, goo: 0 },
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
];

export const DEFAULT_STYLE = {
  flavor: 'cherry',
  texture: 'jello',
  edges: 'round',
  glitter: 'off',
  layers: { colors: [...LAYER_PRESETS[0].colors], blur: 0, repeat: 1, bias: 0 },
};

export function flavorById(id) {
  if (typeof id === 'string' && id.startsWith('#')) return { id, name: 'Custom', hex: id };
  return FLAVORS.find((f) => f.id === id && !f.layered) || FLAVORS[0];
}

// Resolve the style's flavour into { hex } or { layers, blur }.
export function resolveFlavor(style) {
  if (style.flavor === 'layers' || style.flavor === 'rainbow') {
    const L = style.layers || DEFAULT_STYLE.layers;
    return { id: 'layers', name: 'Layers', layers: L.colors, blur: L.blur || 0, repeat: L.repeat || 1, bias: L.bias || 0 };
  }
  return flavorById(style.flavor);
}

export function flavorSwatchCSS(f) {
  if (f.layers) {
    // top first (the gradient runs down)
    const bands = layerBands(f.layers, f.repeat, f.bias).reverse();
    const pct = (h) => `${((1 - h) * 100).toFixed(2)}%`;
    if ((f.blur || 0) > 0.05) {
      // blended: colour stops at the band centres
      return `linear-gradient(180deg, ${bands.map((b) => `${b.color} ${pct((b.h0 + b.h1) / 2)}`).join(', ')})`;
    }
    return `linear-gradient(180deg, ${bands.map((b) => `${b.color} ${pct(b.h1)} ${pct(b.h0)}`).join(', ')})`;
  }
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
  if (t.sugar > 0) {
    const a = 0.35 + 0.5 * Math.min(1, t.sugar);
    layers.push(`radial-gradient(circle, rgba(255, 255, 255, ${a}) 0 0.6px, transparent 1.1px) 1px 2px / 9px 8px`);
    layers.push(`radial-gradient(circle, rgba(255, 255, 255, ${a * 0.75}) 0 0.5px, transparent 1px) 5px 6px / 7px 9px`);
  }
  layers.push(`radial-gradient(ellipse 58% 34% at 36% 22%, rgba(255, 255, 255, ${ha}) 0%, rgba(255, 255, 255, ${ha * 0.85}) ${16 + 30 * (1 - s)}%, transparent ${30 + 42 * (1 - s)}%)`);
  layers.push(`radial-gradient(ellipse 80% 55% at 50% 100%, ${rgb(mix(c, W, 0.35), 0.55 * t.glow * (1 - 0.5 * o))}, transparent 70%)`);
  layers.push(`radial-gradient(circle at 50% 58%, ${rgb(mid)} 0%, ${rgb(body)} 55%, ${rgb(edge)} 100%)`);
  return layers.join(', ');
}
