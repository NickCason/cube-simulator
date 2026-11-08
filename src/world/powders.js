// What the sieve can have in it (see FlourTool, Flour): each powder's
// colour, and how it's made - sparkle (crystals and flakes that catch the
// light: sugar, glitter), multi (a grain each its own bright colour:
// sprinkles, glitter), rainbow (each pinch a bright colour of its own:
// holi powder) - what it's called on the cube's record, and its chip.
export const POWDERS = [
  { id: 'flour', name: 'Flour', col: [0.96, 0.95, 0.92], sparkle: 0, multi: 0, rec: 'floured', css: '#f4f1ea' },
  { id: 'sugar', name: 'Sugar', col: [0.97, 0.97, 0.96], sparkle: 0.85, multi: 0, rec: 'sugared', css: 'radial-gradient(circle at 35% 30%, #fff 0 18%, #e9eef3 19% 40%, #fff 41% 55%, #dfe6ee 56%)' },
  { id: 'cocoa', name: 'Cocoa', col: [0.3, 0.18, 0.11], sparkle: 0, multi: 0, rec: 'cocoa', css: '#5a3622' },
  { id: 'matcha', name: 'Matcha', col: [0.47, 0.57, 0.26], sparkle: 0, multi: 0, rec: 'matcha', css: '#87a64a' },
  { id: 'sprinkles', name: 'Sprinkles', col: [0.95, 0.92, 0.88], sparkle: 0, multi: 1, rec: 'sprinkled', css: 'conic-gradient(#ff4f9a 0 60deg, #ffd43b 0 120deg, #4dabf7 0 180deg, #69db7c 0 240deg, #fff 0 300deg, #b197fc 0)' },
  { id: 'glitter', name: 'Glitter', col: [0.9, 0.86, 0.8], sparkle: 1, multi: 1, rec: 'glittered', css: 'conic-gradient(from 30deg, #ffd6f5, #c3f0ff, #fff3bf, #d3f9d8, #e5dbff, #ffd6f5)' },
  { id: 'rainbow', name: 'Rainbow', col: [1, 1, 1], sparkle: 0, multi: 0, rainbow: true, rec: 'rainbowed', css: 'conic-gradient(#ff3b6b, #ffb000, #ffe03b, #3ddc84, #2fa8ff, #9b5cff, #ff3b6b)' },
];
// (the colours above are as they look - sRGB; the renderer's are linear)
export const toLinear = (c) => c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
for (const p of POWDERS) p.lin = toLinear(p.col);
export const POWDER_BY_ID = Object.fromEntries(POWDERS.map((p) => [p.id, p]));

// (rainbow powder: its colour going round the rainbow as it's sifted - a
// trail of every colour, not one muddy mix - at t seconds; linear)
export function rainbowAt(t) {
  const h = (t * 0.32) % 1, s = 0.82, k = (n) => (n + h * 6) % 6;
  const f = (n) => 1 - s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return toLinear([f(5), f(3), f(1)]);
}

// (holi colours: a pinch of rainbow powder is one of these)
export const RAINBOW = [[1, 0.2, 0.42], [1, 0.62, 0.05], [1, 0.88, 0.2], [0.22, 0.85, 0.45], [0.15, 0.62, 1], [0.6, 0.33, 1], [1, 0.36, 0.78]].map(toLinear);
// (a sprinkle's or a glitter flake's colours: the shaders' palettes match)
export const SPRINKLE = [[1, 0.31, 0.6], [1, 0.83, 0.23], [0.3, 0.67, 0.97], [0.41, 0.86, 0.49], [0.98, 0.98, 0.96], [0.69, 0.59, 0.99], [1, 0.55, 0.2]].map(toLinear);
