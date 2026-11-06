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
