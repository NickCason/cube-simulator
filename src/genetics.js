// Cubiplication's genetics: what a child takes from the cube it came out of,
// and how it's different. Every child drifts a little - its colours round
// the hue wheel, a slider or two, its gradient's stops or points, blend and
// bias. Some mutate: a colour jumps, a colour comes or goes, stripes double
// up, glitter, edges, a slider leaps. Now and then one turns into something
// else altogether - another material, a gradient out of one colour, a new
// shape of gradient - and once in a long while something legendary: chrome,
// holographic foil, a prism, a Rubik's cube. The further down a family a cube
// is, the wilder its children. Each change comes back as { tier, label, … }:
// tier 0 drift, 1 mutation, 2 major, 3 legendary (how much of an affair its
// arrival is - see Cubiplication._split and ui/cubiplied.js).

import { SETTINGS, resolveSettings, settingWord } from './settings.js';
import { TEXTURES, EDGES, GLITTERS, MIN_LAYERS, MAX_LAYERS, MAX_REPEAT, resolveFlavor, flavorMainHex, gradStops, copyLayers } from './styles.js';
import { freeNodes } from './freeform.js';
import { EYE_STYLES, EYE_SIZES, EYE_R_MIN, EYE_R_MAX, MAX_EYES, copyEyes, onSurface, eyeFrame, mirrorEye } from './eyes.js';
import { SURFACES, SURFACE } from './surfaces.js';

export const TIER = { DRIFT: 0, MUTATION: 1, MAJOR: 2, LEGENDARY: 3 };

const SETTING = Object.fromEntries(SETTINGS.map((s) => [s.key, s]));
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// a colour turned round the hue wheel (and its lightness nudged, l: -1..1)
export function hueShift(hex, deg, l = 0) {
  const n = parseInt(hex.slice(1), 16);
  let r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + deg + 720) % 360;
  const s = mx ? d / mx : 0, v = clamp01(mx * (1 + 0.25 * l)), c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (u) => Math.round(clamp01(u + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

// (a slider moved up, or down, in a word)
const MOVED = {
  mu: ['Firmer', 'Softer'],
  bounce: ['Bouncier', 'Less bouncy'],
  goo: ['Gooier', 'Cleaner'],
  damping: ['Slower wobble', 'Wobblier'],
  grip: ['Grippier', 'Slipperier'],
  glow: ['Glowier', 'Duller glow'],
  opacity: ['Cloudier', 'Clearer'],
  depth: ['Deeper colour', 'Paler'],
  rough: ['Glossier', 'Matter'],
  weight: ['Heavier', 'Lighter'],
  lambda: ['Squishier', 'More solid'],
};
const DRIFT_KEYS = ['mu', 'bounce', 'goo', 'damping', 'grip', 'glow', 'opacity', 'depth', 'rough'];

// materials it can turn into: everyday, rare, legendary
const COMMON = ['jello', 'gummy', 'sour', 'crystal', 'creamy', 'slime', 'water', 'syrup', 'mochi', 'marshmallow', 'rubber', 'tofu', 'putty', 'pearl', 'candy'];
const RARE = ['glass', 'ice', 'sugar', 'opal'];
const LEGEND = ['chrome', 'holo', 'prism'];
// a gradient's shapes, by how often one turns up
const SHAPES = [['up', 3], ['core', 2.4], ['shell', 1.8], ['free', 2.2], ['rings', 1.2], ['across', 1], ['corner', 1]];
const SHAPE_LABEL = { up: 'Stripes', across: 'Stripes across', corner: 'Corner to corner', core: 'Radial rings', shell: 'Cubial', rings: 'Tree rings', free: 'Freeform' };

const pick = (rnd, list) => list[Math.floor(rnd() * list.length) % list.length];
function pickWeighted(rnd, list) {
  const total = list.reduce((a, [, w]) => a + w, 0);
  let r = rnd() * total;
  for (const [v, w] of list) if ((r -= w) <= 0) return v;
  return list[0][0];
}

// a slider on its 0..1 track moved by dt (kept inside it): the change, or null
function moveSlider(style, tune, key, dt, tier) {
  const S = SETTING[key];
  if (!S) return null;
  const now = resolveSettings(tune, TEXTURES[style.texture] || TEXTURES.jello)[key];
  const t0 = clamp01(S.from(now)), t1 = Math.min(0.97, Math.max(0.03, t0 + dt));
  if (Math.abs(t1 - t0) < 0.02) return null;
  tune[key] = S.to(t1);
  const w0 = settingWord(S, now), w1 = settingWord(S, tune[key]);
  // (a big move that changes its word: the word; else which way)
  const label = tier > 0 && w0 !== w1 ? `${S.label}: ${w1}` : (MOVED[key] || [`More ${S.label.toLowerCase()}`, `Less ${S.label.toLowerCase()}`])[t1 > t0 ? 0 : 1];
  return { tier, label, kind: 'slider', key };
}

// a gradient for a cube that had one colour: a few round it, a shape
function gradientFrom(hex, rnd) {
  const n = 2 + Math.floor(rnd() * 3), spread = 25 + rnd() * 70, colors = [];
  // (neighbours on the wheel, now and then its opposite)
  const opp = rnd() < 0.35;
  for (let i = 0; i < n; i++) colors.push(i === 0 ? hex : hueShift(hex, opp && i === n - 1 ? 180 : (i * spread) / (n - 1) - spread / 2, (rnd() - 0.5) * 0.5));
  if (rnd() < 0.5) colors.reverse();
  const shape = pickWeighted(rnd, SHAPES);
  return { colors, blur: Math.round((0.15 + rnd() * 0.8) * 100) / 100, repeat: shape === 'up' && rnd() < 0.3 ? 2 : 1, bias: 0, stops: null, nodes: null, shape };
}

// Mutate a child's style and tune (both its own copies) in place. rnd: a
// 0..1 random source; gen: how far down its family it is. Returns its changes.
export function mutate(style, tune, { rnd = Math.random, gen = 0 } = {}) {
  const changes = [];
  const add = (c) => c && changes.push(c);
  const wild = Math.min(2, 1 + 0.12 * gen);
  const chance = (p) => rnd() < p * wild;

  // ---- the big ones first (what it is), then what it's like
  // a legend: chrome, holo, a prism - or a Rubik's cube
  if (chance(0.02)) {
    if (rnd() < 0.3 && style.flavor !== 'rubik') {
      style.flavor = 'rubik';
      style.rubik = 1 + Math.floor(rnd() * 65535);
      add({ tier: 3, label: "A Rubik's cube!", kind: 'flavor' });
    } else {
      const to = pick(rnd, LEGEND.filter((t) => t !== style.texture));
      style.texture = to;
      for (const k of Object.keys(tune)) if (SETTING[k]?.mat && k !== 'size') delete tune[k];
      add({ tier: 3, label: `${TEXTURES[to].name}!`, kind: 'material' });
    }
  } else if (chance(0.09)) {
    // another material altogether (its own look and feel: the parent's
    // tuning of the old one doesn't come with it)
    const pool = rnd() < 0.25 ? RARE : COMMON;
    const to = pick(rnd, pool.filter((t) => t !== style.texture));
    style.texture = to;
    for (const k of Object.keys(tune)) if (SETTING[k]?.mat && k !== 'size') delete tune[k];
    add({ tier: 2, label: `Turned to ${TEXTURES[to].name.toLowerCase()}`, kind: 'material' });
  }

  const f = resolveFlavor(style);
  if (style.flavor !== 'rubik' || !changes.some((c) => c.kind === 'flavor')) {
    if (!f.layers && f.id !== 'rubik' && chance(0.08)) {
      // one colour becomes several: a gradient (its shape a surprise)
      style.layers = gradientFrom(flavorMainHex(f), rnd);
      style.flavor = 'layers';
      add({ tier: 2, label: SHAPE_LABEL[style.layers.shape] + '!', kind: 'gradient' });
    } else if (f.layers && chance(0.08)) {
      // its gradient changes shape
      const to = pickWeighted(rnd, SHAPES.filter(([s]) => s !== style.layers.shape));
      style.layers.shape = to;
      add({ tier: 2, label: SHAPE_LABEL[to] + '!', kind: 'gradient' });
    } else if (f.layers && chance(0.025)) {
      // ...or melts back to one colour
      style.flavor = pick(rnd, f.layers);
      add({ tier: 1, label: 'Just one colour', kind: 'gradient' });
    }
  }

  // ---- mutations
  const L = style.flavor === 'layers' ? style.layers : null;
  if (chance(0.22)) {
    // a colour jumps a long way round the wheel
    const deg = (rnd() < 0.5 ? -1 : 1) * (60 + rnd() * 120);
    if (L) {
      const i = Math.floor(rnd() * L.colors.length);
      L.colors[i] = hueShift(L.colors[i], deg, (rnd() - 0.5) * 0.4);
      add({ tier: 1, label: 'A new colour', kind: 'color', color: L.colors[i] });
    } else if (style.flavor !== 'rubik') {
      style.flavor = hueShift(flavorMainHex(resolveFlavor(style)), deg, (rnd() - 0.5) * 0.4);
      add({ tier: 1, label: 'A new colour', kind: 'color', color: style.flavor });
    }
  }
  if (L && L.colors.length < MAX_LAYERS && chance(0.14)) {
    const at = Math.floor(rnd() * (L.colors.length + 1)), near = L.colors[Math.min(at, L.colors.length - 1)];
    L.colors.splice(at, 0, hueShift(near, (rnd() - 0.5) * 140, (rnd() - 0.5) * 0.5));
    if (L.stops) L.stops.splice(at, 0, at === 0 ? L.stops[0] / 2 : at >= L.stops.length ? (1 + L.stops[L.stops.length - 1]) / 2 : (L.stops[at - 1] + L.stops[at]) / 2);
    if (L.nodes) L.nodes.splice(at, 0, { x: (rnd() - 0.5) * 0.9, y: 0.5 * (rnd() < 0.5 ? -1 : 1), z: (rnd() - 0.5) * 0.9, k: 1 });
    add({ tier: 1, label: 'A colour more', kind: 'color', color: L.colors[at] });
  } else if (L && L.colors.length > MIN_LAYERS && chance(0.09)) {
    const i = Math.floor(rnd() * L.colors.length);
    L.colors.splice(i, 1);
    L.stops?.splice(i, 1);
    L.nodes?.splice(i, 1);
    add({ tier: 1, label: 'A colour less', kind: 'color' });
  }
  if (L && ['up', 'across', 'corner', 'core', 'shell', 'rings'].includes(L.shape) && chance(0.12)) {
    const was = L.repeat || 1, to = Math.min(MAX_REPEAT, Math.max(1, was + (rnd() < 0.6 ? 1 : -1)));
    if (to !== was) {
      L.repeat = to;
      add({ tier: 1, label: to > was ? 'More bands' : 'Fewer bands', kind: 'gradient' });
    }
  }
  if (L && chance(0.06)) {
    const was = L.tiles || 1, to = was > 1 && rnd() < 0.35 ? 1 : Math.min(5, was + 1);
    L.tiles = to;
    add(to > 1 ? { tier: was > 1 ? 1 : 2, label: `Subdivided ${to}×${to}`, kind: 'gradient' } : { tier: 1, label: 'Whole again', kind: 'gradient' });
  }
  if (chance(0.1)) {
    const now = style.glitter || 'off';
    const to = now === 'off' ? pick(rnd, GLITTERS.filter((g) => g.id !== 'off')).id : rnd() < 0.3 ? 'off' : pick(rnd, GLITTERS.filter((g) => g.id !== now && g.id !== 'off')).id;
    style.glitter = to;
    add(to === 'off' ? { tier: 1, label: 'Lost its glitter', kind: 'glitter' } : { tier: now === 'off' ? 2 : 1, label: `${GLITTERS.find((g) => g.id === to).name} glitter`, kind: 'glitter' });
  }
  if (chance(0.08)) {
    const to = pick(rnd, Object.keys(EDGES).filter((e) => e !== style.edges));
    style.edges = to;
    add({ tier: 1, label: `${EDGES[to].name} edges`, kind: 'edges' });
  }
  if (chance(0.1)) add(moveSlider(style, tune, pick(rnd, DRIFT_KEYS), (rnd() < 0.5 ? -1 : 1) * (0.28 + rnd() * 0.2), 1));

  // ---- drift: always
  if (style.flavor === 'rubik') {
    if (!changes.some((c) => c.kind === 'flavor')) style.rubik = 1 + Math.floor(rnd() * 65535);
    add({ tier: 0, label: 'Scrambled anew', kind: 'drift' });
  } else if (L) {
    L.colors = L.colors.map((h) => hueShift(h, (rnd() - 0.5) * 24, (rnd() - 0.5) * 0.12));
    // (its stops wander along it, its points over the cube; blend and bias slide)
    if (L.shape === 'free') {
      L.nodes = freeNodes({ layers: L.colors, nodes: L.nodes }).map((q) => {
        const d = (v) => Math.min(0.5, Math.max(-0.5, v + (rnd() - 0.5) * 0.18));
        const p = { x: d(q.x), y: d(q.y), z: d(q.z), k: Math.min(4, Math.max(0.25, q.k * (0.8 + rnd() * 0.45))) };
        // (back onto the skin: its biggest way out)
        const ax = ['x', 'y', 'z'].reduce((a, b) => (Math.abs(p[b]) > Math.abs(p[a]) ? b : a));
        p[ax] = p[ax] < 0 ? -0.5 : 0.5;
        return p;
      });
    } else if (rnd() < 0.6) {
      const s = gradStops({ layers: L.colors, stops: L.stops }).map((v) => clamp01(v + (rnd() - 0.5) * 0.12)).sort((a, b) => a - b);
      L.stops = s;
    }
    L.blur = Math.round(clamp01((L.blur || 0) + (rnd() - 0.5) * 0.3) * 100) / 100;
    if (rnd() < 0.5) L.bias = Math.round(Math.min(1, Math.max(-1, (L.bias || 0) + (rnd() - 0.5) * 0.4)) * 100) / 100;
    add({ tier: 0, label: 'Colours drifted', kind: 'drift' });
  } else {
    const deg = (rnd() - 0.5) * 34;
    style.flavor = hueShift(flavorMainHex(resolveFlavor(style)), deg, (rnd() - 0.5) * 0.15);
    add({ tier: 0, label: `Hue ${deg >= 0 ? '+' : '−'}${Math.round(Math.abs(deg))}°`, kind: 'drift' });
  }
  const nudges = 1 + (rnd() < 0.45 ? 1 : 0);
  for (let k = 0; k < nudges; k++) add(moveSlider(style, tune, pick(rnd, DRIFT_KEYS), (rnd() - 0.5) * 0.3, 0));
  if (style.layers) style.layers = copyLayers(style.layers);
  mutateEyes(style, rnd, chance, add);
  mutateSurface(style, rnd, chance, add);
  return changes;
}

// Its surface map (surfaces.js): handed down as it is - now and then another
// moulded into it, or worn smooth; one born smooth, once in a long while, has
// one of its own.
function mutateSurface(style, rnd, chance, add) {
  const cur = SURFACE[style.surface] ? style.surface : 'none';
  const others = SURFACES.map((s) => s.id).filter((id) => id !== 'none' && id !== cur);
  if (cur !== 'none' && chance(0.035)) {
    style.surface = pick(rnd, others);
    add({ tier: 2, label: `${SURFACE[style.surface].name}!`, kind: 'surface' });
  } else if (cur !== 'none' && chance(0.012)) {
    style.surface = 'none';
    add({ tier: 1, label: 'Worn smooth', kind: 'surface' });
  } else if (cur === 'none' && chance(0.008)) {
    style.surface = pick(rnd, others);
    add({ tier: 3, label: `Born ${SURFACE[style.surface].name.toLowerCase()}!`, kind: 'surface' });
  } else style.surface = cur;
}

// Its googly eyes (a family's: every child has its parent's): now and then a
// third one, two become one (a cyclops), they grow or shrink, change their
// look, one wanders - and once in a long while one born without grows a pair.
// (A change that'd put one over another doesn't happen; a pair one of them's
// left is two on their own.)
function mutateEyes(style, rnd, chance, add) {
  const b = EDGES[style.edges]?.bevel ?? 0.13;
  let eyes = copyEyes(style.eyes);
  const at = (p) => onSurface(p, b);
  const fits = (list) => list.every((e, i) => list.every((o, j) => j <= i || Math.hypot(e.x - o.x, e.y - o.y, e.z - o.z) >= (e.r + o.r) * 1.02));
  const tryIt = (list, change) => {
    if (!fits(list)) return false;
    eyes = list;
    add(change);
    return true;
  };
  if (eyes.length) {
    const mid = [0, 0, 0];
    for (const e of eyes) (mid[0] += e.x / eyes.length), (mid[1] += e.y / eyes.length), (mid[2] += e.z / eyes.length);
    if (eyes.length < MAX_EYES && chance(0.04)) {
      // (a third: above the middle of them, on the same face)
      const { p, n } = at(mid), { up } = eyeFrame(n), r = eyes[0].r;
      const q = at(p.map((v, i) => v + up[i] * r * 2.6)).p;
      tryIt([...eyes, { x: q[0], y: q[1], z: q[2], r, s: eyes[0].s, p: 0 }], { tier: 2, label: 'A third eye!', kind: 'eyes' });
    } else if (eyes.length >= 2 && chance(0.03)) {
      // (a pair become one, in the middle of them: a cyclops)
      const a = eyes[0], o = eyes.find((e) => e !== a && e.p && e.p === a.p) || eyes[1];
      const q = at([(a.x + o.x) / 2, (a.y + o.y) / 2, (a.z + o.z) / 2]).p;
      tryIt([{ x: q[0], y: q[1], z: q[2], r: Math.min(EYE_R_MAX, a.r * 1.6), s: a.s, p: 0 }, ...eyes.filter((e) => e !== a && e !== o)], { tier: 2, label: 'Cyclops!', kind: 'eyes' });
    } else if (chance(0.05)) {
      const up = rnd() < 0.5, k = up ? 1.3 : 0.76;
      tryIt(eyes.map((e) => ({ ...e, r: Math.min(EYE_R_MAX, Math.max(EYE_R_MIN, e.r * k)) })), { tier: 1, label: up ? 'Bigger eyes' : 'Smaller eyes', kind: 'eyes' });
    } else if (chance(0.05)) {
      const s = 1 + Math.floor(rnd() * (EYE_STYLES.length - 1)), to = (eyes[0].s + s) % EYE_STYLES.length;
      tryIt(eyes.map((e) => ({ ...e, s: to })), { tier: 1, label: EYE_STYLES[to].trait, kind: 'eyes' });
    } else if (chance(0.03)) {
      // (one of them wanders off a little - its pair no longer)
      const w = Math.floor(rnd() * eyes.length), e = eyes[w], q = at([e.x + (rnd() - 0.5) * 0.18, e.y + (rnd() - 0.5) * 0.18, e.z + (rnd() - 0.5) * 0.18]).p;
      tryIt(eyes.map((x, i) => (i === w ? { ...x, x: q[0], y: q[1], z: q[2], p: 0 } : x)), { tier: 1, label: 'A wandering eye', kind: 'eyes' });
    }
  } else if (chance(0.004)) {
    // (none: it's grown a pair, on its front)
    const e = { ...at([-0.16, 0.12, 0.5]).p.reduce((o, v, i) => ((o['xyz'[i]] = v), o), {}), r: EYE_SIZES[1], s: 0, p: 1 };
    tryIt([e, { ...mirrorEye(e, b) }], { tier: 3, label: 'Grew eyes!', kind: 'eyes' });
  }
  // (a pair one of them's left: two on their own)
  for (const e of eyes) if (e.p && eyes.filter((o) => o.p === e.p).length !== 2) e.p = 0;
  style.eyes = eyes;
}

// the biggest tier among a child's changes
export const topTier = (changes) => changes.reduce((a, c) => Math.max(a, c.tier), 0);

// ---- the die: a gradient no one's seen before
const hsvHex = (h, s, v) => {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (u) => Math.round(clamp01(u + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
};

// n colours that hang together: a scheme round the wheel from a random hue
// (neighbours, opposites, a triad, a split, a square, a rainbow, one hue in
// many shades), each a little off its place, now and then a dark or a pale one
export function randomPalette(n, rnd = Math.random) {
  const base = rnd() * 360;
  const schemes = [
    () => { const span = 50 + rnd() * 90; return (i) => (n > 1 ? -span / 2 + (span * i) / (n - 1) : 0); },
    () => (i) => (i % 2 ? 180 : 0) + (i >> 1) * 22,
    () => (i) => (i % 3) * 120 + Math.floor(i / 3) * 18,
    () => (i) => [0, 150, 210][i % 3] + Math.floor(i / 3) * 15,
    () => (i) => (i % 4) * 90 + Math.floor(i / 4) * 20,
    () => { const dir = rnd() < 0.5 ? 1 : -1, span = 200 + rnd() * 140; return (i) => (dir * span * i) / Math.max(1, n - 1); },
    () => () => 0,
  ];
  const which = Math.floor(rnd() * schemes.length), at = schemes[which](), mono = which === schemes.length - 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    let s = 0.62 + rnd() * 0.38, v = 0.6 + rnd() * 0.4;
    if (mono) v = 0.25 + (0.75 * (i + rnd() * 0.5)) / n;
    else if (rnd() < 0.14) v = 0.25 + rnd() * 0.2; // (a deep accent)
    else if (rnd() < 0.12) [s, v] = [0.25 + rnd() * 0.25, 0.95]; // (a pale one)
    out.push(hsvHex(base + at(i) + (rnd() - 0.5) * 16, s, v));
  }
  return out;
}

// A whole new gradient in this shape: its colours, and - freeform - its
// points spread over the faces (not too near each other) with strengths of
// their own, or - along a line - its stops, blend, repeat and bias
export function randomGradient(shape, rnd = Math.random) {
  if (shape === 'free') {
    const n = 3 + Math.floor(rnd() * 5), nodes = [];
    for (let i = 0; i < n; i++) {
      let best = null, bd = -1;
      for (let t = 0; t < 24; t++) {
        const f = Math.floor(rnd() * 6), u = 0.12 + rnd() * 0.76, v = 0.12 + rnd() * 0.76;
        const p = [[u - 0.5, 0.5, 0.5 - v], [-0.5, v - 0.5, u - 0.5], [u - 0.5, v - 0.5, 0.5], [0.5, v - 0.5, 0.5 - u], [0.5 - u, v - 0.5, -0.5], [u - 0.5, -0.5, v - 0.5]][f];
        const d = Math.min(9, ...nodes.map((q) => Math.hypot(q.x - p[0], q.y - p[1], q.z - p[2])));
        if (d > bd) [best, bd] = [p, d];
      }
      nodes.push({ x: best[0], y: best[1], z: best[2], k: Math.round(0.5 * Math.pow(5, rnd()) * 100) / 100 });
    }
    return { colors: randomPalette(n, rnd), blur: Math.round((0.25 + rnd() * 0.6) * 100) / 100, repeat: 1, bias: 0, stops: null, nodes, shape, tiles: rnd() < 0.2 ? 2 + Math.floor(rnd() * 2) : 1 };
  }
  const n = 2 + Math.floor(rnd() * 5);
  const stops = rnd() < 0.5 ? null : Array.from({ length: n }, () => rnd()).sort((a, b) => a - b);
  const repeat = rnd() < 0.6 ? 1 : rnd() < 0.7 ? 2 : 3;
  const bias = rnd() < 0.5 ? 0 : Math.round((rnd() - 0.5) * 1.2 * 100) / 100;
  const tiles = (shape === 'core' || shape === 'shell') && rnd() < 0.35 ? 2 + Math.floor(rnd() * 2) : 1;
  return { colors: randomPalette(n, rnd), blur: Math.round(rnd() * 100) / 100, repeat, bias, stops, nodes: null, shape, tiles };
}
