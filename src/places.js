// Places: where the cube is. Each has a light and a dark (glow mode) look -
// its sky (seen behind everything, refracted through the jelly, and what it
// reflects), its floor's pattern, its light. A look is the studio's (THEMES
// in app.js) with these on top. Colours are linear.
//
// sky: zen (overhead), hor (the horizon - the floor fades into it), gnd
//   (below the horizon, for reflections); sun: a disc and its glow (dir,
//   col, size in radians; stripes: a synthwave sun, banded down to col2);
//   stars, clouds (0..1)
// floor: pat (0 plain, 1 checker, 2 gingham, 3 marble, 4 neon grid, 5 sand,
//   6 moon dust), A and B (its two colours), scale (m), glow (the pattern's
//   own light: the grid's lines)
// ink: 'light' where the sky behind the wordmark is dark in the light look

const UP = [0, 1, 0];

export const PLACES = [
  {
    id: 'studio',
    name: 'Studio',
    light: {},
    dark: {},
  },
  {
    id: 'diner',
    name: 'Diner',
    light: {
      sky: { zen: [0.42, 0.72, 0.7], hor: [0.95, 0.84, 0.76], gnd: [0.55, 0.5, 0.45] },
      floor: { pat: 1, A: [0.035, 0.035, 0.04], B: [0.86, 0.85, 0.82], scale: 0.45 },
      rough: 0.32, key: 3.1, keyHex: 0xffeed8, keyCol: [1, 0.93, 0.82], refl: 0.34, css: '#f2d8c6',
    },
    dark: {
      sky: { zen: [0.006, 0.0, 0.02], hor: [0.12, 0.015, 0.1], gnd: [0.01, 0.0, 0.015] },
      floor: { pat: 1, A: [0.006, 0.006, 0.008], B: [0.12, 0.11, 0.14], scale: 0.45 },
      boxes: 'neon', rough: 0.16, key: 0.85, keyHex: 0xff9ad8, keyCol: [1, 0.6, 0.86], envJelly: 1.1, refl: 0.55, css: '#14020f',
    },
  },
  {
    id: 'picnic',
    name: 'Picnic',
    light: {
      sky: { zen: [0.14, 0.36, 0.82], hor: [0.72, 0.84, 0.95], gnd: [0.34, 0.46, 0.24], sun: { dir: 'key', col: [7, 6.3, 5.2], size: 0.045, glow: 0.35 }, clouds: 0.55 },
      floor: { pat: 2, A: [0.72, 0.035, 0.05], B: [0.93, 0.91, 0.87], scale: 0.2 },
      rough: 0.95, key: 3.4, keyHex: 0xfff2dc, keyCol: [1, 0.95, 0.86], css: '#b9d6f2',
    },
    dark: {
      sky: { zen: [0.003, 0.005, 0.022], hor: [0.025, 0.035, 0.085], gnd: [0.005, 0.008, 0.012], sun: { dir: [0.45, 0.42, -0.79], col: [1.6, 1.7, 1.9], size: 0.035, glow: 0.12 }, stars: 1 },
      floor: { pat: 2, A: [0.3, 0.014, 0.03], B: [0.16, 0.16, 0.2], scale: 0.2 },
      rough: 0.95, key: 0.9, keyHex: 0xb8c8ff, keyCol: [0.62, 0.72, 1], css: '#06091a',
    },
  },
  {
    id: 'marble',
    name: 'Marble',
    light: {
      sky: { zen: [0.56, 0.6, 0.66], hor: [0.9, 0.9, 0.91], gnd: [0.6, 0.6, 0.6] },
      floor: { pat: 3, A: [0.28, 0.29, 0.33], B: [0.86, 0.86, 0.85], scale: 1.4 },
      boxes: 'studio', rough: 0.16, refl: 0.46, reflLod: 0.6, css: '#e4e4e6',
    },
    dark: {
      sky: { zen: [0.002, 0.002, 0.003], hor: [0.03, 0.024, 0.016], gnd: [0.004, 0.003, 0.002] },
      floor: { pat: 3, A: [0.36, 0.25, 0.07], B: [0.01, 0.01, 0.012], scale: 1.4 },
      rough: 0.14, key: 0.95, keyHex: 0xffd9a8, keyCol: [1, 0.82, 0.58], refl: 0.6, reflLod: 0.8, css: '#080604',
    },
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    light: {
      sky: { zen: [0.5, 0.6, 0.95], hor: [1.0, 0.72, 0.84], gnd: [0.7, 0.6, 0.85], sun: { dir: [0, 0.17, -1], col: [1, 0.55, 0.12], col2: [0.9, 0.12, 0.45], size: 0.26, glow: 0.3, stripes: 1 } },
      floor: { pat: 4, A: [0.72, 0.66, 0.88], B: [0.98, 0.34, 0.72], scale: 0.55, glow: 0.35 },
      rough: 0.4, key: 3, keyHex: 0xffe6f2, keyCol: [1, 0.9, 0.95], css: '#f7c4da',
    },
    dark: {
      sky: { zen: [0.005, 0.0, 0.018], hor: [0.2, 0.02, 0.15], gnd: [0.01, 0.0, 0.02], sun: { dir: [0, 0.17, -1], col: [0.95, 0.5, 0.1], col2: [0.85, 0.06, 0.45], size: 0.26, glow: 0.35, stripes: 1 }, stars: 0.6 },
      floor: { pat: 4, A: [0.004, 0.0, 0.01], B: [0.9, 0.12, 1.0], scale: 0.55, glow: 0.7 },
      rough: 0.4, key: 0.8, keyHex: 0xd4a0ff, keyCol: [0.82, 0.55, 1], envJelly: 0.7, bloom: 0.3, refl: 0.45, css: '#12021a',
    },
  },
  {
    id: 'beach',
    name: 'Beach',
    light: {
      sky: { zen: [0.05, 0.38, 0.88], hor: [0.72, 0.88, 0.95], gnd: [0.6, 0.52, 0.38], sun: { dir: 'key', col: [8, 7.4, 6], size: 0.05, glow: 0.4 }, clouds: 0.22 },
      floor: { pat: 5, A: [0.7, 0.56, 0.36], B: [0.95, 0.86, 0.66], scale: 0.7 },
      rough: 0.96, key: 3.6, keyHex: 0xfff0d6, keyCol: [1, 0.94, 0.82], refl: 0.06, css: '#bfe2f2',
    },
    dark: {
      sky: { zen: [0.008, 0.01, 0.05], hor: [0.3, 0.085, 0.04], gnd: [0.05, 0.025, 0.02], sun: { dir: [0.28, 0.06, -1], col: [3.2, 1.2, 0.35], size: 0.07, glow: 0.45 }, clouds: 0.32, cloudCol: [0.32, 0.1, 0.08] },
      floor: { pat: 5, A: [0.1, 0.06, 0.04], B: [0.19, 0.12, 0.08], scale: 0.7 },
      rough: 0.95, key: 1.1, keyHex: 0xffa060, keyCol: [1, 0.62, 0.36], envJelly: 0.9, refl: 0.08, css: '#200a05',
    },
  },
  {
    id: 'moon',
    name: 'Moon',
    light: {
      sky: { zen: [0, 0, 0.002], hor: [0.035, 0.035, 0.042], gnd: [0.05, 0.05, 0.052], sun: { dir: [-0.5, 0.36, -0.79], col: [0.45, 0.8, 1.7], size: 0.085, glow: 0.18 }, stars: 0.75 },
      floor: { pat: 6, A: [0.32, 0.32, 0.33], B: [0.62, 0.62, 0.63], scale: 1.2 },
      rough: 1, key: 4.2, keyHex: 0xffffff, keyCol: [1, 1, 1], envI: 0.35, refl: 0.04, bloom: 0.08, vignette: 0.32, css: '#08080a', ink: 'light',
    },
    dark: {
      sky: { zen: [0, 0, 0.002], hor: [0.015, 0.015, 0.022], gnd: [0.02, 0.02, 0.022], sun: { dir: [-0.5, 0.36, -0.79], col: [0.35, 0.65, 1.4], size: 0.085, glow: 0.2 }, stars: 1 },
      floor: { pat: 6, A: [0.045, 0.045, 0.05], B: [0.13, 0.13, 0.14], scale: 1.2 },
      rough: 1, key: 0.7, keyHex: 0xc8d4ff, keyCol: [0.76, 0.82, 1], refl: 0.1, css: '#020204',
    },
  },
];

export const PLACE_BY_ID = Object.fromEntries(PLACES.map((p) => [p.id, p]));
export { UP };
