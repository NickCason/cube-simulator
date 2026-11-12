// CubeR codes: a whole cube - its look, its feel and its world - packed into
// one short line that travels in a link (…/cube-simulator/#cube=CODE), a QR
// code or a message, and that the Cubby keeps its saved cubes in.
//
// Version 1 reads    1~<field>~<field>~…
// where each field is a letter and then its value:
//   n  name (URI-encoded, spaces as _)
//   f  flavour id (cherry, lime, …, layers)       c  a custom colour instead (6 hex digits)
//   l  layer colours bottom to top, 6 hex digits each, run together
//   b  layer blend 0..100     r  layer repeat 1..6     i  layer bias -100..100
//   p  the layers' stops - where each colour sits, 0..255 along one round,
//      2 hex digits each, run together (missing: evenly spaced)
//   h  the layers' shape: across, corner, core, shell, rings, free (missing: up)
//   u  the layers subdivided: little cubes a side, 2..5, each with the whole gradient (missing: 1)
//   q  a freeform gradient's points, one a colour: x, y, z (0..255 across
//      the cube) and strength (0..255, 1/4 to 4 on a log scale), 2 hex
//      digits each, run together (missing: spread evenly)
//   m  material     e  edges     g  glitter     d  look (light, dark)
//   w  tearing: 0 when it's switched off
//   k  Rubik's (with f rubik): its scramble 0 solved, 1..65535 - or, turned,
//      its 54 stickers face by face, a digit (0..5) each
//   x  its edges' trim: scalloped, sawtooth, stitched, piped, beaded, crimped (missing: none)
//   t  tuned sliders, <code><value> joined by commas: the codes are in
//      TUNE_CODES, the values in each slider's own units
// A reader skips letters and slider codes it doesn't know, so a code made by a
// newer app still opens in an older one (without what's new), and old codes
// open forever. Never change what a letter or a slider code means: add new ones.

import { copyEyes, encodeEyes, decodeEyes, eyesWord } from './eyes.js';
import { SURFACE, surfaceWord } from './surfaces.js';
import { SETTINGS, resolveSettings } from './settings.js';
import { FLAVORS, TEXTURES, EDGES, TRIM, GLITTERS, MIN_LAYERS, MAX_LAYERS, MAX_REPEAT, DEFAULT_STYLE, GRAD_SHAPE_INDEX, copyLayers } from './styles.js';
import { FREE_K_MIN, FREE_K_MAX } from './freeform.js';

// (a freeform point's strength, 1/4..4, as 0..255 on a log scale)
const kToByte = (k) => Math.round((Math.log(Math.min(FREE_K_MAX, Math.max(FREE_K_MIN, k)) / FREE_K_MIN) / Math.log(FREE_K_MAX / FREE_K_MIN)) * 255);
const byteToK = (b) => FREE_K_MIN * Math.pow(FREE_K_MAX / FREE_K_MIN, b / 255);
const hex2 = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');

export const CODE_VERSION = 1;
export const SITE_URL = 'https://nickcason.github.io/cube-simulator/';

// Two letters per slider, fixed for good. (The sound sliders aren't shared:
// whoever opens a cube keeps their own levels.)
export const TUNE_CODES = {
  mu: 'fm', damping: 'vs', weight: 'dn', lambda: 'sq', bounce: 'bo', grip: 'gp', rigidity: 'rg', tough: 'tf', goo: 'go',
  opacity: 'op', glow: 'tl', depth: 'cd', rough: 'gl', ior: 'rf', irid: 'ir', metal: 'mt', opal: 'ol',
  bubbles: 'bc', bubbleSize: 'bs', glitterAmount: 'ga', glitterSize: 'gs', glitterSparkle: 'gk',
  liquid: 'lq', liqVisc: 'lx', liqSkin: 'lk', liqFill: 'lf',
  surfDepth: 'sd', surfScale: 'sk', trimSize: 'tz', trimDepth: 'td', faces: 'fc',
  gravity: 'gv', size: 'sz',
  grabSize: 'hs', handPull: 'hp', poke: 'pk',
  knifePush: 'kp', nailPower: 'nl', gunPower: 'gn', malletForce: 'ml', torchHeat: 'th', boilOff: 'bf', cryoCold: 'cc',
  bombPower: 'bm', syringePump: 'sy', magnetPull: 'mg', blowForce: 'bw',
  contactGrip: 'jj', airDrag: 'ad',
  dice: 'dc', holeSize: 'hz', autoRate: 'ar', flameSize: 'fz', acidStrength: 'as', acidPour: 'ap', pupilWiggle: 'pw',
  siftRate: 'sr', siftSpread: 'ss', ballSize: 'bz', cuberSize: 'cz', ladle: 'ld', mutation: 'mx', globSize: 'gz', globRate: 'gr', twistSpeed: 'tw', lively: 'lv',
};
const KEY_OF = Object.fromEntries(Object.entries(TUNE_CODES).map(([k, c]) => [c, k]));
const SETTING = Object.fromEntries(SETTINGS.map((s) => [s.key, s]));
export const SOUND_KEYS = ['volume', 'impacts', 'wobble', 'notes'];
const THEMES = ['light', 'dark'];
const NAME_MAX = 40;

const hex6 = (h) => (typeof h === 'string' && /^#?[0-9a-f]{6}$/i.test(h) ? h.replace('#', '').toLowerCase() : null);

// a number in 4 significant figures, without a leading zero
const num = (v) => String(+(+v).toPrecision(4)).replace(/^(-?)0\./, '$1.');

const encName = (s) =>
  encodeURIComponent(s.replace(/~/g, '-'))
    .replace(/[!'()*_]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '_');

function decName(s) {
  s = s.replace(/_/g, ' ');
  try {
    s = decodeURIComponent(s);
  } catch (e) {
    /* (a messenger already unescaped it) */
  }
  return cleanName(s);
}

export const cleanName = (s) =>
  String(s || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);

// The cube on show now (style, tuned sliders, tearing, look).
export function captureCube(app, name = '') {
  const s = app.style, L = s.layers;
  const tune = {};
  for (const k in app.tune) if (TUNE_CODES[k] && Number.isFinite(app.tune[k])) tune[k] = app.tune[k];
  return {
    name: cleanName(name),
    flavor: s.flavor,
    layers: copyLayers(L),
    texture: s.texture,
    edges: s.edges,
    glitter: s.glitter || 'off',
    rubik: Number.isFinite(s.rubik) ? s.rubik : 1,
    ...(typeof s.rubikState === 'string' && /^[0-5]{54}$/.test(s.rubikState) ? { rubikState: s.rubikState } : {}),
    trim: TRIM[s.trim] ? s.trim : 'none',
    tune,
    tear: app.tune.tear !== false,
    theme: app.theme,
    eyes: copyEyes(s.eyes),
    surface: SURFACE[s.surface] ? s.surface : 'none',
  };
}

export function encodeCube(c) {
  const f = [String(CODE_VERSION)];
  if (c.name) f.push('n' + encName(c.name));
  const custom = c.flavor && c.flavor.startsWith('#') ? hex6(c.flavor) : null;
  if (custom) f.push('c' + custom);
  else f.push('f' + c.flavor);
  if (c.flavor === 'layers') {
    const L = c.layers;
    f.push('l' + L.colors.map(hex6).join(''));
    if (L.blur) f.push('b' + Math.round(L.blur * 100));
    if (L.repeat > 1) f.push('r' + L.repeat);
    if (Math.round(L.bias * 100)) f.push('i' + Math.round(L.bias * 100));
    if (Array.isArray(L.stops) && L.stops.length === L.colors.length) f.push('p' + L.stops.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join(''));
    if (L.shape && L.shape !== 'up' && GRAD_SHAPE_INDEX[L.shape] !== undefined) f.push('h' + L.shape);
    if (L.tiles > 1) f.push('u' + Math.min(5, Math.round(L.tiles)));
    if (L.shape === 'free' && Array.isArray(L.nodes) && L.nodes.length === L.colors.length) f.push('q' + L.nodes.map((q) => hex2((q.x + 0.5) * 255) + hex2((q.y + 0.5) * 255) + hex2((q.z + 0.5) * 255) + hex2(kToByte(q.k))).join(''));
  }
  // (a Rubik's: as it's been turned - its 54 stickers - else its scramble)
  if (c.flavor === 'rubik') f.push('k' + (typeof c.rubikState === 'string' && /^[0-5]{54}$/.test(c.rubikState) ? c.rubikState : Math.max(0, Math.min(65535, Math.round(c.rubik ?? 1)))));
  f.push('m' + c.texture, 'e' + c.edges);
  if (c.glitter && c.glitter !== 'off') f.push('g' + c.glitter);
  if (c.theme) f.push('d' + c.theme);
  if (c.tear === false) f.push('w0');
  // (its googly eyes: see eyes.js)
  if (c.eyes && c.eyes.length) f.push('y' + encodeEyes(c.eyes));
  // (its surface map: see surfaces.js)
  if (c.surface && c.surface !== 'none' && SURFACE[c.surface]) f.push('s' + c.surface);
  // (its edges' trim: see styles.js TRIMS)
  if (c.trim && c.trim !== 'none' && TRIM[c.trim]) f.push('x' + c.trim);
  const t = Object.keys(c.tune || {})
    .filter((k) => TUNE_CODES[k] && Number.isFinite(c.tune[k]))
    .map((k) => TUNE_CODES[k] + num(c.tune[k]));
  if (t.length) f.push('t' + t.join(','));
  return f.join('~');
}

export const cubeLink = (c, base = SITE_URL) => `${base}#cube=${encodeCube(c)}`;

// The code out of a whole link, a #cube= fragment or the bare code (null if
// it isn't one).
export function findCode(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();
  const m = s.match(/[#?&]cube=([^&#\s]+)/);
  if (m) s = m[1];
  else if (/\s/.test(s)) return null;
  if (!s.includes('~')) s = s.replace(/%7e/gi, '~'); // (a messenger escaped the separators)
  s = s.replace(/%2c/gi, ',');
  return /^\d+~/.test(s) && s.length <= 4000 ? s : null;
}

// Read a CubeR code (or a link holding one) into a whole, valid cube; null if
// there's no code in it. Anything unknown or out of range falls back.
export function decodeCube(text) {
  const code = findCode(text);
  if (!code) return null;
  const parts = code.split('~');
  const version = parseInt(parts[0], 10);
  if (!(version >= 1)) return null;
  // (version 1 fields; later versions only ever add to them)
  const c = {
    version,
    name: '',
    flavor: DEFAULT_STYLE.flavor,
    layers: { colors: [...DEFAULT_STYLE.layers.colors], blur: 0, repeat: 1, bias: 0 },
    texture: DEFAULT_STYLE.texture,
    edges: DEFAULT_STYLE.edges,
    glitter: 'off',
    tune: {},
    tear: true,
    theme: null,
    rubik: 1,
    eyes: [],
    surface: 'none',
    trim: 'none',
  };
  let flavor = null, custom = null, stops = null, nodes = null;
  for (const p of parts.slice(1)) {
    const k = p[0], v = p.slice(1);
    if (!k) continue;
    if (k === 'n') c.name = decName(v);
    else if (k === 'f') flavor = v;
    else if (k === 'c') custom = hex6(v);
    else if (k === 'l') {
      const cols = (v.match(/[0-9a-f]{6}/gi) || []).map((h) => '#' + h.toLowerCase());
      if (cols.length >= MIN_LAYERS) c.layers.colors = cols.slice(0, MAX_LAYERS);
    } else if (k === 'b') c.layers.blur = clamp(+v / 100, 0, 1, 0);
    else if (k === 'r') c.layers.repeat = Math.round(clamp(+v, 1, MAX_REPEAT, 1));
    else if (k === 'i') c.layers.bias = clamp(+v / 100, -1, 1, 0);
    else if (k === 'p') stops = (v.match(/[0-9a-f]{2}/gi) || []).map((h) => parseInt(h, 16) / 255);
    else if (k === 'h' && GRAD_SHAPE_INDEX[v] !== undefined) c.layers.shape = v;
    else if (k === 'u') c.layers.tiles = Math.round(clamp(+v, 1, 5, 1));
    else if (k === 'q') nodes = (v.match(/[0-9a-f]{8}/gi) || []).map((h) => ({ x: parseInt(h.slice(0, 2), 16) / 255 - 0.5, y: parseInt(h.slice(2, 4), 16) / 255 - 0.5, z: parseInt(h.slice(4, 6), 16) / 255 - 0.5, k: byteToK(parseInt(h.slice(6, 8), 16)) }));
    else if (k === 'm') c.texture = TEXTURES[v] ? v : c.texture;
    else if (k === 'e') c.edges = EDGES[v] ? v : c.edges;
    else if (k === 'g') c.glitter = GLITTERS.some((g) => g.id === v) ? v : 'off';
    else if (k === 'd') c.theme = THEMES.includes(v) ? v : null;
    else if (k === 'w') c.tear = v !== '0';
    else if (k === 'k' && /^[0-5]{54}$/.test(v)) c.rubikState = v;
    else if (k === 'k') c.rubik = Math.round(clamp(parseInt(v, 10), 0, 65535, 1));
    else if (k === 'y') c.eyes = decodeEyes(v);
    else if (k === 's') c.surface = SURFACE[v] ? v : 'none';
    else if (k === 'x') c.trim = TRIM[v] ? v : 'none';
    else if (k === 't') {
      for (const pair of v.split(',')) {
        const m = pair.match(/^([a-z]{2})(-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?)$/);
        const key = m && KEY_OF[m[1]];
        const s = key && SETTING[key];
        if (!s) continue;
        let x = +m[2];
        if (!Number.isFinite(x)) continue;
        // (inside the slider's range)
        const t = s.from(x);
        if (!(t >= 0)) x = s.to(0);
        else if (t > 1) x = s.to(1);
        c.tune[key] = s.int ? Math.round(x) : x;
      }
    }
  }
  if (custom) c.flavor = '#' + custom;
  else if (flavor && FLAVORS.some((f) => f.id === flavor)) c.flavor = flavor;
  // (stops: one a colour, in order - else evenly spaced)
  if (stops && stops.length === c.layers.colors.length && stops.every((v, i) => !i || v >= stops[i - 1])) c.layers.stops = stops;
  // (freeform points: one a colour)
  if (nodes && nodes.length === c.layers.colors.length) c.layers.nodes = nodes;
  return c;
}

function clamp(x, a, b, fallback) {
  return Number.isFinite(x) ? Math.min(b, Math.max(a, x)) : fallback;
}

// "Gummy · Round · Holo" (and the look, if asked)
export function cubeSummary(c, withLook = false) {
  const bits = [TEXTURES[c.texture]?.name || c.texture, EDGES[c.edges]?.name || c.edges];
  if (surfaceWord(c.surface)) bits.push(surfaceWord(c.surface));
  if (c.glitter && c.glitter !== 'off') bits.push(`${GLITTERS.find((g) => g.id === c.glitter)?.name || c.glitter} glitter`);
  if (c.eyes && c.eyes.length) bits.push(eyesWord(c.eyes));
  if (withLook && c.theme === 'dark') bits.push('Glow mode');
  return bits.join(' · ');
}

// A cube's fighter stats, 0..100 each: how it plays, from its settings (its
// material's, where they aren't tuned).
export function cubeStats(c) {
  const st = resolveSettings(c.tune || {}, TEXTURES[c.texture] || TEXTURES.jello);
  const pos = (key) => Math.min(1, Math.max(0, SETTING[key].from(st[key])));
  const pct = (x) => Math.round(100 * Math.min(1, Math.max(0, x)));
  const rigid = Math.min(1, Math.max(0, st.rigidity || 0));
  return [
    ['Squish', pct((0.75 * (1 - pos('mu')) + 0.25 * pos('lambda')) * (1 - rigid))],
    ['Bounce', pct(pos('bounce'))],
    ['Wobble', pct((1 - pos('damping')) * (1 - rigid) * (1 - 0.5 * pos('mu')))],
    ['Goo', pct(pos('goo'))],
    ['Tough', pct(Math.max(pos('tough'), rigid))],
    ['Heft', pct(0.65 * pos('weight') + 0.35 * pos('size'))],
  ];
}
