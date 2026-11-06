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

// Starting palettes for layered jelly, listed bottom → top.
export const LAYER_PRESETS = [
  { id: 'rainbow', name: 'Rainbow', colors: ['#7b22d6', '#1572ff', '#2cc23a', '#ffc814', '#ff6a0d', '#e8102e'] },
  { id: 'sunset', name: 'Sunset', colors: ['#3a0ca3', '#7209b7', '#f72585', '#ff6d00', '#ffbe0b'] },
  { id: 'ocean', name: 'Ocean', colors: ['#03045e', '#0077b6', '#00b4d8', '#90e0ef'] },
  { id: 'neon', name: 'Neon', colors: ['#ff00a8', '#00e5ff', '#76ff03', '#ffea00'] },
  { id: 'candy', name: 'Candy', colors: ['#e8102e', '#f4f4f4', '#e8102e', '#f4f4f4', '#e8102e', '#f4f4f4', '#e8102e'] },
  { id: 'duo', name: 'Duo', colors: ['#3a86ff', '#ff006e'] },
];

export const MIN_LAYERS = 2;
export const MAX_LAYERS = 10;

// Texture presets. Look: depth (colour), opacity, glow (translucency),
// rough, ior, sugar (crystal coating), milk (creamy body).
// Feel: mu (firmness), damping (viscosity), weight (density), lambda (volume keeping).
export const TEXTURES = {
  jello: { name: 'Jello', depth: 1.25, opacity: 0.25, glow: 0.5, rough: 0.035, ior: 1.36, sugar: 0, milk: 0, mu: 170, damping: 1.7, weight: 1, lambda: 24 },
  gummy: { name: 'Gummy', depth: 1.5, opacity: 0.52, glow: 0.45, rough: 0.1, ior: 1.38, sugar: 0, milk: 0.12, mu: 430, damping: 3.4, weight: 1.15, lambda: 24 },
  sour: { name: 'Sour', depth: 1.5, opacity: 0.5, glow: 0.45, rough: 0.1, ior: 1.38, sugar: 1, milk: 0.08, mu: 430, damping: 3.4, weight: 1.15, lambda: 24 },
  crystal: { name: 'Crystal', depth: 0.42, opacity: 0.1, glow: 0.5, rough: 0.018, ior: 1.4, sugar: 0, milk: 0, mu: 140, damping: 1.2, weight: 0.95, lambda: 30 },
  creamy: { name: 'Creamy', depth: 1.0, opacity: 0.82, glow: 0.62, rough: 0.05, ior: 1.36, sugar: 0, milk: 1, mu: 115, damping: 2.2, weight: 1, lambda: 24 },
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
  layers: { colors: [...LAYER_PRESETS[0].colors], blur: 0 },
};

export function flavorById(id) {
  if (typeof id === 'string' && id.startsWith('#')) return { id, name: 'Custom', hex: id };
  return FLAVORS.find((f) => f.id === id && !f.layered) || FLAVORS[0];
}

// Resolve the style's flavour into { hex } or { layers, blur }.
export function resolveFlavor(style) {
  if (style.flavor === 'layers' || style.flavor === 'rainbow') {
    const L = style.layers || DEFAULT_STYLE.layers;
    return { id: 'layers', name: 'Layers', layers: L.colors, blur: L.blur || 0 };
  }
  return flavorById(style.flavor);
}

export function flavorSwatchCSS(f) {
  if (f.layers) {
    const n = f.layers.length;
    const top = [...f.layers].reverse();
    if ((f.blur || 0) > 0.05) {
      // blended: colour stops at the layer centres
      return `linear-gradient(180deg, ${top.map((c, i) => `${c} ${((i + 0.5) / n) * 100}%`).join(', ')})`;
    }
    return `linear-gradient(180deg, ${top.map((c, i) => `${c} ${(i / n) * 100}% ${((i + 1) / n) * 100}%`).join(', ')})`;
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
