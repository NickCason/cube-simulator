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
  // layered, listed bottom → top
  { id: 'rainbow', name: 'Rainbow', layers: ['#7b22d6', '#1572ff', '#2cc23a', '#ffc814', '#ff6a0d', '#e8102e'] },
];

// density: colour depth; scatter: cloudiness; rough: surface gloss;
// sugar: crystal coating; milk: creamy body; mu/damping: feel; bubbles: share shown
export const TEXTURES = {
  jello: { name: 'Jello', density: 1.25, scatter: 0.55, rough: 0.035, sugar: 0, milk: 0, mu: 170, damping: 1.7, bubbles: 1 },
  gummy: { name: 'Gummy', density: 1.5, scatter: 2.4, rough: 0.1, sugar: 0, milk: 0.12, mu: 430, damping: 3.4, bubbles: 0 },
  sour: { name: 'Sour', density: 1.5, scatter: 2.2, rough: 0.1, sugar: 1, milk: 0.08, mu: 430, damping: 3.4, bubbles: 0 },
  crystal: { name: 'Crystal', density: 0.42, scatter: 0.08, rough: 0.018, sugar: 0, milk: 0, mu: 140, damping: 1.2, bubbles: 1 },
  creamy: { name: 'Creamy', density: 1.0, scatter: 6, rough: 0.05, sugar: 0, milk: 1, mu: 115, damping: 2.2, bubbles: 0 },
};

export const EDGES = {
  sharp: { name: 'Sharp', bevel: 0.035 },
  soft: { name: 'Soft', bevel: 0.08 },
  round: { name: 'Round', bevel: 0.13 },
  pillow: { name: 'Pillow', bevel: 0.21 },
};

export const DEFAULT_STYLE = { flavor: 'cherry', texture: 'jello', edges: 'round' };

export function flavorById(id) {
  if (typeof id === 'string' && id.startsWith('#')) return { id, name: 'Custom', hex: id };
  return FLAVORS.find((f) => f.id === id) || FLAVORS[0];
}

export function flavorSwatchCSS(f) {
  if (f.layers) {
    const n = f.layers.length;
    const stops = [...f.layers].reverse().map((c, i) => `${c} ${(i / n) * 100}% ${((i + 1) / n) * 100}%`);
    return `linear-gradient(180deg, ${stops.join(', ')})`;
  }
  return f.hex;
}

// representative single colour (for UI dots, droplets, glow)
export function flavorMainHex(f) {
  return f.layers ? f.layers[Math.floor(f.layers.length / 2)] : f.hex;
}
