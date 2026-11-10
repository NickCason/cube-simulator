import { FLAVORS, TEXTURES, EDGES, TRIMS, GLITTERS, LAYER_PRESETS, MIN_LAYERS, MAX_LAYERS, MAX_REPEAT, MAX_TILES, flavorSwatchCSS, flavorMainHex, materialSwatchCSS } from '../styles.js';
import { SETTINGS, settingWord, settingNum } from '../settings.js';
import { Cubby } from './cubby.js';
import { Clips } from './clips.js';
import { StackPanel, STACK_ICON } from './stackpanel.js';
import { PlacesPanel, PLACE_ICON } from './places.js';
import { GradEditor } from './gradedit.js';
import { FreeEditor } from './freeedit.js';
import { CubipliedCard } from './cubiplied.js';
import { POWDERS } from '../world/powders.js';
import { EYE_STYLES } from '../eyes.js';
import { SURFACES, surfaceSwatch } from '../surfaces.js';

// (the googly eyes' chips: a little eye of each kind, its size, one or two)
const EYE_PUPIL = { classic: 4, big: 5.6, tiny: 2.3, lashes: 3.8, angry: 3.6, sleepy: 3.4 };
function eyeChip(id) {
  const lower = id === 'angry' ? 1.5 : 0, py = id === 'sleepy' ? 15.5 : 14;
  let extra = '';
  if (id === 'lashes') extra = '<path d="M7 5.6 5.4 3.6M12 3.6V1.4M17 5.6l1.6-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>';
  if (id === 'angry') extra = '<path d="M4.5 5.2 17 8.4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>';
  if (id === 'sleepy') extra = '<path d="M3.5 12.6a8.5 8.5 0 0 1 17 0z" fill="currentColor" opacity=".5"/><path d="M3.5 12.6h17" stroke="currentColor" stroke-width="1.6"/>';
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="${12.6 + lower}" r="8.4" fill="#fff" stroke="currentColor" stroke-width="1.6"/><circle cx="12.6" cy="${py + lower}" r="${EYE_PUPIL[id]}" fill="currentColor"/>${extra}</svg>`;
}
function eyeSizeChip(i) {
  const r = [4.6, 6.6, 9][i];
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="${r}" fill="#fff" stroke="currentColor" stroke-width="1.6"/><circle cx="12.4" cy="${12 + r * 0.25}" r="${r * 0.45}" fill="currentColor"/></svg>`;
}
function eyePairChip(two) {
  const e = (x) => `<circle cx="${x}" cy="12" r="4.6" fill="#fff" stroke="currentColor" stroke-width="1.5"/><circle cx="${x + 0.5}" cy="13.3" r="2" fill="currentColor"/>`;
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${two ? e(6.6) + e(17.4) : e(12)}</svg>`;
}

const RESET_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 4.5v4h4"/></svg>';

const svg = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const ICONS = {
  hand: svg(
    '<path d="M7 11.5V5.8a1.4 1.4 0 0 1 2.8 0V11"/><path d="M9.8 10.5V4.4a1.4 1.4 0 0 1 2.8 0v6.1"/><path d="M12.6 10.6V5.6a1.4 1.4 0 0 1 2.8 0v5.8"/><path d="M15.4 11.2V8.2a1.4 1.4 0 0 1 2.8 0v6.3c0 4-2.9 7-6.6 7h-.9c-2.2 0-3.7-.8-5-2.4L3.4 15.3a1.3 1.3 0 0 1 2-1.6L7 15.4V11"/>',
  ),
  knife: svg('<path d="M13 11 3 21c4.5-.4 9.2-2.6 13-7z"/><path d="m13 11 6.6-6.6a1.9 1.9 0 0 1 2.7 2.7L16 14"/>'),
  nailgun: svg(
    '<path d="M2.5 7.5h13a2 2 0 0 1 2 2V11a1 1 0 0 1-1 1H9l-1.4 7a1.2 1.2 0 0 1-1.2 1H4.6a1 1 0 0 1-1-1.2L5 12H2.5z"/><path d="M19.2 9.8h3.3"/><path d="M19.2 8.4v2.8"/><path d="M9.6 12v1.4a1 1 0 0 1-1 1"/>',
  ),
  holegun: svg(
    '<path d="M2.5 8h14.5a1.5 1.5 0 0 1 1.5 1.5V11H10l-1.6 7.6a1 1 0 0 1-1 .8H5a1 1 0 0 1-1-1.2L5.5 11h-3z"/><circle cx="21" cy="9.5" r="1.4"/>',
  ),
  mallet: svg('<g transform="rotate(-32 12 12)"><rect x="4.5" y="2.5" width="15" height="6.5" rx="1.8"/><rect x="10.8" y="9" width="2.4" height="13" rx="1.2"/></g>'),
  torch: svg(
    '<path d="M12 21.5c-3.6 0-6-2.4-6-5.7 0-3.6 2.8-5.4 3.6-8.9 1.6 1.2 2.4 3 2.3 4.6 1.4-.9 2.2-2.4 2.3-4.2 2.5 2 3.8 5.1 3.8 8.3 0 3.4-2.4 5.9-6 5.9z"/><path d="M12 21.5c-1.6 0-2.7-1.1-2.7-2.6 0-1.7 1.4-2.6 2.1-4.2 1.9 1.3 3.3 2.6 3.3 4.4 0 1.4-1.1 2.4-2.7 2.4z"/>',
  ),
  freeze: svg(
    '<path d="M12 2.5v19"/><path d="m3.8 7.25 16.4 9.5"/><path d="m3.8 16.75 16.4-9.5"/><path d="m9.6 4.2 2.4 1.8 2.4-1.8"/><path d="m9.6 19.8 2.4-1.8 2.4 1.8"/><path d="m4.1 10.4 2.8-1.2-.4-3"/><path d="m19.9 13.6-2.8 1.2.4 3"/><path d="m4.1 13.6 2.8 1.2-.4 3"/><path d="m19.9 10.4-2.8-1.2.4-3"/>',
  ),
  dicer: svg('<rect x="3.8" y="3.8" width="16.4" height="16.4" rx="3"/><path d="M9.3 3.8v16.4M14.7 3.8v16.4M3.8 9.3h16.4M3.8 14.7h16.4"/>'),
  autogun: svg('<path d="M9.5 9.2h11M9.5 12h11.5M9.5 14.8h11"/><rect x="3.4" y="8" width="6.6" height="8" rx="2"/><path d="M5.6 16v3.6"/>'),
  feed: svg('<path d="M3.5 10.5h12a6 6 0 0 1-12 0Z"/><path d="m15.5 10.5 5-6.2"/><path d="M8.4 6.6c0-1 .8-1.6.8-2.6M11.6 6.6c0-1 .8-1.6.8-2.6"/>'),
  eyes: svg('<circle cx="7.6" cy="12" r="5"/><circle cx="16.4" cy="12" r="5"/><circle cx="8.4" cy="13.7" r="1.9" fill="currentColor"/><circle cx="17.2" cy="13.7" r="1.9" fill="currentColor"/>'),
  flour: svg('<circle cx="10" cy="8.5" r="5.5"/><path d="M15.4 7.4 21 5.6"/><path d="M5.6 7h8.8M5.2 10h9.6M7.4 4.5h5.2M8 13h4"/><circle cx="7.6" cy="17.6" r=".7"/><circle cx="11" cy="19.4" r=".7"/><circle cx="13.4" cy="16.6" r=".7"/><circle cx="9.2" cy="21.2" r=".55"/>'),
  acid: svg('<path d="M9.5 3h5M10.5 3v5.2L5.2 18.4A1.8 1.8 0 0 0 6.8 21h10.4a1.8 1.8 0 0 0 1.6-2.6L13.5 8.2V3"/><path d="M7.4 15.4h9.2"/><circle cx="10.6" cy="18" r=".8"/><circle cx="13.6" cy="17.2" r=".6"/>'),
  twist: svg('<path d="M5 9a7 7 0 0 1 12.4-3.6M19 15a7 7 0 0 1-12.4 3.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.6 2.8v3.9h-3.9M5.4 21.2v-3.9h3.9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect x="8.6" y="8.6" width="6.8" height="6.8" rx="1.2"/>'),
  gelgun: svg('<path d="M3.5 11h10.5l2.6 1.4v2H11l-1.5 4.4H6.3l1.2-4.4h-4z"/><circle cx="8.6" cy="7.3" r="2.6"/><path d="M19.6 9.2c1.6.2 2.2 1.6 1.4 2.6-.7.9-2.4.8-2.8-.4-.3-1 .3-2.3 1.4-2.2Z"/>'),
  cuber: svg('<rect x="3.2" y="11.6" width="9" height="9" rx="2"/><path d="M5.6 15.6v-1.4h1.4"/><path d="m11.6 12.4 6.3-6.3a1.8 1.8 0 0 1 2.5 2.5l-6.3 6.3"/>'),
  baller: svg(
    '<circle cx="8" cy="16" r="4.8"/><path d="M5.6 15.2a2.6 2.6 0 0 1 2.9-1.9"/><path d="m11.5 12.5 6.4-6.4a1.8 1.8 0 0 1 2.5 2.5L14 15"/>',
  ),
  bomb: svg(
    '<circle cx="10.5" cy="14" r="6.5"/><path d="m14.6 9 1.6-1.6"/><path d="M16.2 7.4c.4-2.2 2-3.5 4-3.4"/><path d="M21.5 1.8v1.1"/><path d="M23 3.4h-1.1"/><path d="m22.4 2.2-.6.6"/><path d="M7.4 11.4a3.6 3.6 0 0 1 2.4-1.7"/>',
  ),
  syringe: svg(
    '<path d="m18.5 2.5 3 3"/><path d="m20 4-3.3 3.3"/><path d="M17.8 8.4 8.6 17.6a1.4 1.4 0 0 1-2 0l-2.2-2.2a1.4 1.4 0 0 1 0-2l9.2-9.2z"/><path d="m4.5 19.5-2 2"/><path d="m9.2 11.6 1.6 1.6"/><path d="m11.4 9.4 1.6 1.6"/>',
  ),
  magnet: svg('<path d="M6 3h3.6v8.2a2.4 2.4 0 0 0 4.8 0V3H18v8.2a6 6 0 0 1-12 0z"/><path d="M6 7.2h3.6"/><path d="M14.4 7.2H18"/>'),
  heal: svg(
    '<path d="M11 3.5 12.7 8l4.6 1.7-4.6 1.7L11 16l-1.7-4.6-4.6-1.7L9.3 8z"/><path d="m18.5 14.5.8 2.1 2.2.8-2.2.8-.8 2.3-.8-2.3-2.2-.8 2.2-.8z"/>',
  ),
  tune: svg('<path d="M4 7h9"/><path d="M17 7h3"/><path d="M4 17h3"/><path d="M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  sound: svg('<path d="M11 5 6.5 8.5H3.5v7h3L11 19z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6"/><path d="M18.4 6.2a8.4 8.4 0 0 1 0 11.6"/>'),
  mute: svg('<path d="M11 5 6.5 8.5H3.5v7h3L11 19z"/><path d="m16 9.5 5 5"/><path d="m21 9.5-5 5"/>'),
  moon: svg('<path d="M19.5 14.6A7.6 7.6 0 0 1 9.4 4.5a7.6 7.6 0 1 0 10.1 10.1z"/><path d="M16.6 3.6v2.6"/><path d="M15.3 4.9h2.6"/><path d="M20.4 8.2v1.6"/><path d="M19.6 9h1.6"/>'),
  sun: svg(
    '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2"/><path d="M12 19.2v2.2"/><path d="m5.35 5.35 1.55 1.55"/><path d="m17.1 17.1 1.55 1.55"/><path d="M2.6 12h2.2"/><path d="M19.2 12h2.2"/><path d="m5.35 18.65 1.55-1.55"/><path d="m17.1 6.9 1.55-1.55"/>',
  ),
};

export const TOOL_DEFS = [
  { id: 'hand', label: 'Hand', hint: 'Drag to grab & throw · tap to poke · two fingers: squish or pull it apart', key: '1' },
  { id: 'knife', label: 'Knife', hint: 'Swipe across the jelly to slice it', key: '2' },
  { id: 'dicer', label: 'Dicer', hint: 'Tap the jelly to dice it into little cubes', key: 'd' },
  { id: 'nailgun', label: 'Nail gun', hint: 'Click to fire · hold for auto', key: '3' },
  { id: 'holegun', label: 'Hole gun', hint: 'Click to shoot a hole through it', key: 'g' },
  { id: 'autogun', label: 'Full auto', hint: 'Hold to let it rip · the barrels spin up first', key: 'f' },
  { id: 'mallet', label: 'Mallet', hint: 'Click to smack · hit on its beat to build resonance · frozen, sugar and ice cubes shatter', key: '4' },
  { id: 'torch', label: 'Torch', hint: 'Hold over the jelly to melt it · it runs off as liquid', key: '5' },
  { id: 'freeze', label: 'Cryo spray', hint: 'Hold to freeze it solid · spray a puddle to set it back into jelly', key: '6' },
  { id: 'acid', label: 'Acid', hint: 'Hold over the jelly to pour acid · it fizzes and eats in, melting the jelly to liquid', key: 'a' },
  { id: 'eyes', label: 'Googly eyes', hint: 'Tap to stick on googly eyes · drag one to move it, off the cube to peel it off · tap one to change it below', key: 'y' },
  { id: 'flour', label: 'Sieve', hint: 'Hold to sift it on · roll a cube through it to coat it · Re-cube sweeps it up', key: 'u' },
  { id: 'baller', label: 'Melon baller', hint: 'Click to scoop out a ball', key: '7' },
  { id: 'cuber', label: 'Cube cuber', hint: 'Click to scoop out a cube', key: 'c' },
  { id: 'bomb', label: 'Cherry bomb', hint: 'Click to plant · stand back', key: '8' },
  { id: 'syringe', label: 'Syringe', hint: 'Hold to pump it up', key: '9' },
  { id: 'feed', label: 'Add jelly', hint: 'Hold on a cube to ladle jelly in · feed it enough and it cubiplies', key: 'j' },
  { id: 'gelgun', label: 'Gel gun', hint: 'Hold to lob globs of jelly at it · they sink in and build it up · Re-cube to shake it off', key: 'e' },
  { id: 'magnet', label: 'Magnet', hint: 'Hold near nails to pull them out (and drag the jelly with them)', key: '0' },
  { id: 'twist', label: 'Twist', hint: "A Rubik's cube: drag across a face to turn that row · hold still on it to scramble", key: 'r' },
];

const blendWord = (b) => (b < 0.12 ? 'Crisp' : b < 0.38 ? 'Soft' : b < 0.7 ? 'Blended' : 'Gradient');
const biasWord = (b) => (b < -0.6 ? 'Bottom' : b < -0.2 ? 'Low' : b <= 0.2 ? 'Even' : b <= 0.6 ? 'High' : 'Top');
const repeatWord = (r) => ['Once', 'Twice', 'Thrice', 'Banded', 'Stripy', 'Striped'][r - 1] || 'Striped';
// A slider's readout: its word, and beside it a number for where the slider sits.
const readout = (el, word, num) => {
  el.innerHTML = num == null ? word : `${word}<i class="num">${num}</i>`;
  // (a new word gives it a jiggle)
  if (el.dataset.w !== undefined && el.dataset.w !== word) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
  el.dataset.w = word;
};
const signed = (x) => (x > 0 ? `+${x}` : x < 0 ? `\u2212${-x}` : '0');

// A trim's tile: a square of jelly (currentColor) with that edge all round -
// clockwise from its top-left, each edge in N runs.
function trimTile(id) {
  const A = 5, B = 33, N = 5, L = B - A, s = L / N, f = (v) => +v.toFixed(2);
  // the corners, and each edge's way along and way out
  const C = [[A, A], [B, A], [B, B], [A, B]], D = [[1, 0], [0, 1], [-1, 0], [0, -1]], O = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const run = (each) => {
    let d = `M${A} ${A}`;
    for (let e = 0; e < 4; e++) for (let i = 0; i < N; i++) d += each(C[e], D[e], O[e], i);
    return d + 'Z';
  };
  const at = (c, dv, i, u) => [c[0] + dv[0] * s * (i + u), c[1] + dv[1] * s * (i + u)];
  const gloss = '<path d="M9 8h14a4 4 0 0 1-4 4H9z" fill="#fff" opacity="0.32"/>';
  const lite = 'rgba(255,255,255,0.6)', dark = 'rgba(0,0,0,0.28)';
  const sq = (inset, extra = '') => `<rect x="${A + inset}" y="${A + inset}" width="${L - 2 * inset}" height="${L - 2 * inset}" rx="${6 - inset * 0.6}" ${extra}/>`;
  if (id === 'scalloped' || id === 'crimped') {
    // lobes bulging out (a crimp's many and small, grooved between)
    const n = id === 'crimped' ? 2 : 1, r = (s / n) * 0.62;
    let d = `M${A} ${A}`, grooves = '';
    for (let e = 0; e < 4; e++)
      for (let i = 0; i < N * n; i++) {
        const q = [C[e][0] + D[e][0] * (s / n) * (i + 1), C[e][1] + D[e][1] * (s / n) * (i + 1)];
        d += `A${f(r)} ${f(r)} 0 0 1 ${f(q[0])} ${f(q[1])}`;
        if (n === 2 && i < N * n - 1) grooves += `M${f(q[0])} ${f(q[1])}l${f(-O[e][0] * 3.2)} ${f(-O[e][1] * 3.2)}`;
      }
    return `<svg viewBox="0 0 38 38" aria-hidden="true"><path d="${d}Z" fill="currentColor"/>${grooves ? `<path d="${grooves}" stroke="${dark}" stroke-width="0.9" stroke-linecap="round"/>` : ''}${gloss}</svg>`;
  }
  if (id === 'sawtooth') {
    const d = run((c, dv, o, i) => {
      const m = at(c, dv, i, 0.5), q = at(c, dv, i, 1);
      return `L${f(m[0] + o[0] * 2.6)} ${f(m[1] + o[1] * 2.6)}L${f(q[0])} ${f(q[1])}`;
    });
    return `<svg viewBox="0 0 38 38" aria-hidden="true"><path d="${d}" fill="currentColor" stroke="currentColor" stroke-width="0.6" stroke-linejoin="round"/>${gloss}</svg>`;
  }
  if (id === 'beaded') {
    let beads = '';
    for (let e = 0; e < 4; e++)
      for (let i = 0; i < N; i++) {
        const m = at(C[e], D[e], i, 0.5);
        beads += `<circle cx="${f(m[0])}" cy="${f(m[1])}" r="2.6" fill="currentColor"/><circle cx="${f(m[0] - 0.8)}" cy="${f(m[1] - 0.8)}" r="0.9" fill="${lite}"/>`;
      }
    return `<svg viewBox="0 0 38 38" aria-hidden="true">${sq(0.6, 'fill="currentColor"')}<g stroke="${dark}" stroke-width="0.5">${beads}</g>${gloss}</svg>`;
  }
  if (id === 'stitched')
    return `<svg viewBox="0 0 38 38" aria-hidden="true">${sq(0, 'fill="currentColor"')}${sq(3.6, `fill="none" stroke="${lite}" stroke-width="1.3" stroke-dasharray="2.4 1.9" stroke-linecap="round"`)}${sq(1.2, `fill="none" stroke="${dark}" stroke-width="0.7"`)}${gloss}</svg>`;
  if (id === 'piped')
    return `<svg viewBox="0 0 38 38" aria-hidden="true">${sq(0, 'fill="currentColor"')}${sq(1.6, `fill="none" stroke="${lite}" stroke-width="3"`)}${sq(1.6, `fill="none" stroke="${dark}" stroke-width="3" stroke-dasharray="0.9 1.6"`)}${gloss}</svg>`;
  return `<svg viewBox="0 0 38 38" aria-hidden="true">${sq(0, 'fill="currentColor"')}${gloss}</svg>`;
}

export class UI {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.root.innerHTML = `
      <header class="brand" aria-label="Cube Simulator">
        <svg class="mark" viewBox="4 3 56 58" aria-hidden="true">
          <path class="ft" d="M32 6 56 18 32 30 8 18Z" />
          <path class="fl" d="M8 18 32 30V58L8 46Z" />
          <path class="fr" d="M56 18 32 30V58L56 46Z" />
          <path class="gl" d="M16.5 17.6 32 9.8l11.6 5.8" />
        </svg>
        <svg class="word" viewBox="0 0 146 60" aria-hidden="true">
          <use href="#bl-c" /><use href="#bl-u" /><use href="#bl-b" /><use href="#bl-e" />
          <text x="0" y="58" textLength="146" lengthAdjust="spacing">SIMULATOR</text>
        </svg>
      </header>
      <button class="theme-btn" aria-label="Glow mode" title="Glow mode (L)"></button>
      <button class="place-btn" aria-label="Places" title="Places (P)">${PLACE_ICON}</button>
      <div class="hint" aria-live="polite"></div>
      <nav class="dock" role="toolbar" aria-label="Tools">
        <div class="tools"></div>
        <div class="sep"></div>
        <div class="colors">
          <button class="swatch-btn" aria-label="Jelly style" title="Flavor, material & edges"><span class="swatch"></span></button>

        </div>
        <button class="tune-btn" aria-label="Settings" title="Settings">${ICONS.tune}</button>
        <button class="stack-btn" hidden title="Stack the cubes (K)" aria-label="Stack the cubes">${STACK_ICON}</button>
        <button class="heal" title="Re-cube (H)" aria-label="Re-cube">${ICONS.heal}<span>Re-cube</span></button>
        <button class="mute" title="Sound (M)" aria-label="Toggle sound">${ICONS.sound}</button>
      </nav>
      <div class="palette style-panel" hidden>
        <div class="sec"><span class="lbl">Flavor</span><div class="chips"></div></div>
        <div class="sec layers-sec" hidden>
          <div class="lbl-row">
            <span class="lbl">Layers <em>drag or tap stops</em></span>
            <div class="lbl-acts">
              <button class="gdie" title="Roll a new one" aria-label="Roll a new gradient"><svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="14" height="14" rx="3.2"/><circle cx="7" cy="7" r="1.25" fill="currentColor" stroke="none"/><circle cx="13" cy="7" r="1.25" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.25" fill="currentColor" stroke="none"/><circle cx="7" cy="13" r="1.25" fill="currentColor" stroke="none"/><circle cx="13" cy="13" r="1.25" fill="currentColor" stroke="none"/></svg></button>
              <div class="stepper">
                <button class="minus" aria-label="Fewer layers">&minus;</button><span class="n"></span><button class="plus" aria-label="More layers">+</button>
              </div>
            </div>
          </div>
          <div class="seg gshape" role="group" aria-label="The gradient's shape"></div>
          <div class="grad" role="group" aria-label="The gradient's colours"><div class="grad-strip"></div><div class="grad-stops"></div></div>
          <div class="grad-ends"><span class="a"></span><button class="even" hidden>Even out</button><span class="b"></span></div>
          <div class="free" hidden>
            <div class="free-net" role="group" aria-label="The cube unfolded: its colours"><canvas></canvas><div class="free-nodes"></div></div>
            <div class="free-note" hidden></div>
            <div class="free-tool">
              <label class="free-col" title="Its colour"><i></i><input type="color" aria-label="The picked point's colour"></label>
              <span class="free-name"></span>
              <button class="free-del">Remove</button>
            </div>
            <label class="row free-k"><span class="name">Strength</span><input type="range" min="0" max="1" step="0.01" aria-label="How far the picked point's colour reaches"><span class="word"></span></label>
          </div>
          <div class="presets"></div>
          <label class="row blend"><span class="name">Blend</span><input type="range" min="0" max="1" step="0.01" aria-label="Blend between layers"><span class="word"></span></label>
          <label class="row repeat"><span class="name">Repeat</span><input type="range" min="1" max="${MAX_REPEAT}" step="1" aria-label="How many times the colours repeat up the cube"><span class="word"></span></label>
          <label class="row bias"><span class="name">Bias</span><input type="range" min="-1" max="1" step="0.01" aria-label="Bands crowd toward the bottom or the top"><span class="word"></span></label>
          <label class="row tiles"><span class="name">Subdivide</span><input type="range" min="1" max="${MAX_TILES}" step="1" aria-label="The cube as little cubes, each with the whole gradient"><span class="word"></span></label>
        </div>
        <div class="sec"><span class="lbl">Material</span><div class="mats" role="group" aria-label="Material"></div></div>
        <div class="sec"><span class="lbl">Glitter</span><div class="seg glit"></div></div>
        <div class="sec"><span class="lbl">Edges</span><div class="seg edges"></div></div>
        <div class="sec"><span class="lbl">Trim <em>size and depth in Settings</em></span><div class="mats trims" role="group" aria-label="Trim"></div></div>
        <div class="sec"><span class="lbl">Surface <em>depth and scale in Settings</em></span><div class="mats surfs" role="group" aria-label="Surface"></div></div>
      </div>
      <div class="palette tune" hidden>
        <div class="tune-scroll"></div>
        <div class="tune-foot"><button class="reset"></button></div>
      </div>`;
    this.toolsEl = root.querySelector('.tools');
    this.hintEl = root.querySelector('.hint');
    this.healEl = root.querySelector('.heal');
    this.muteEl = root.querySelector('.mute');
    this.themeEl = root.querySelector('.theme-btn');
    this.themeEl.addEventListener('click', () => this.toggleTheme());
    this.setTheme(app.theme || 'light');
    this.swatchBtn = root.querySelector('.swatch-btn');
    this.paletteEl = root.querySelector('.style-panel');
    this.buttons = {};
    for (const d of TOOL_DEFS) {
      const b = document.createElement('button');
      b.className = 'tool';
      b.dataset.tool = d.id;
      b.innerHTML = `${ICONS[d.id]}<span class="tip">${d.label}<kbd>${d.key}</kbd></span>`;
      b.setAttribute('aria-label', d.label);
      b.addEventListener('click', () => {
        app.audio.init();
        app.audio.ui();
        app.setTool(d.id);
      });
      this.toolsEl.appendChild(b);
      this.buttons[d.id] = b;
    }
    // the sieve's powders: a row over the dock while it's in hand
    this.powdersEl = document.createElement('div');
    this.powdersEl.className = 'powders';
    this.powdersEl.hidden = true;
    this.powdersEl.setAttribute('role', 'radiogroup');
    this.powdersEl.setAttribute('aria-label', 'In the sieve');
    for (const p of POWDERS) {
      const b = document.createElement('button');
      b.dataset.powder = p.id;
      b.title = p.name;
      b.setAttribute('aria-label', p.name);
      b.setAttribute('role', 'radio');
      b.style.setProperty('--c', p.css);
      b.innerHTML = '<span></span>';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        app.audio.ui();
        app.tools?.flour?.setPowder(p.id);
      });
      this.powdersEl.appendChild(b);
    }
    root.appendChild(this.powdersEl);
    // the googly eyes' row: their look, size, pairs or one at a time, undo, clear
    this.eyeRow = document.createElement('div');
    this.eyeRow.className = 'powders eye-row';
    this.eyeRow.hidden = true;
    this.eyeRow.setAttribute('aria-label', 'Googly eyes');
    const eyeBtn = (html, title, run) => {
      const b = document.createElement('button');
      b.innerHTML = html;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        app.audio.ui();
        run(app.tools?.eyes);
      });
      this.eyeRow.appendChild(b);
      return b;
    };
    this.eyeStyleBtns = EYE_STYLES.map((st, i) => eyeBtn(eyeChip(st.id), st.name, (t) => t?.setStyle(i)));
    this.eyeSizeBtn = eyeBtn(eyeSizeChip(1), 'Size', (t) => t && t.setSize((t.size + 1) % 3));
    this.eyePairBtn = eyeBtn(eyePairChip(true), 'Pairs', (t) => t && t.setPair(!t.pair));
    this.eyeUndoBtn = eyeBtn('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 7 4.5 11.5 9 16"/><path d="M5 11.5h9a5 5 0 0 1 0 10h-2"/></svg>', 'Undo', (t) => t?.undo());
    this.eyeClearBtn = eyeBtn('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 7h14M9.5 7V4.5h5V7M7 7l1 13h8l1-13"/></svg>', 'Take its eyes off', (t) => t?.clear());
    root.appendChild(this.eyeRow);
    const chips = this.paletteEl.querySelector('.chips');
    for (const f of FLAVORS) {
      const b = document.createElement('button');
      b.className = 'chip' + (f.layered ? ' layered' : '');
      b.dataset.flavor = f.id;
      b.style.setProperty('--c', flavorSwatchCSS(f));
      b.title = f.name;
      b.setAttribute('aria-label', f.name);
      b.addEventListener('click', () => {
        app.audio.ui();
        app.setFlavor(f.id);
      });
      chips.appendChild(b);
    }
    // ---- layer editor
    this.layersSec = this.paletteEl.querySelector('.layers-sec');
    this.grad = new GradEditor(app, this.layersSec);
    this.free = new FreeEditor(app, this.layersSec);
    this.layersHint = this.layersSec.querySelector('.lbl em');
    this.nEl = this.layersSec.querySelector('.n');
    this.minusEl = this.layersSec.querySelector('.minus');
    this.plusEl = this.layersSec.querySelector('.plus');
    this.blendEl = this.layersSec.querySelector('.blend input');
    this.blendWord = this.layersSec.querySelector('.blend .word');
    this.repeatEl = this.layersSec.querySelector('.repeat input');
    this.repeatWord = this.layersSec.querySelector('.repeat .word');
    this.biasEl = this.layersSec.querySelector('.bias input');
    this.biasWord = this.layersSec.querySelector('.bias .word');
    const die = this.layersSec.querySelector('.gdie');
    die.addEventListener('click', () => {
      app.audio.ui();
      app.audio.pop(0.35);
      die.classList.remove('roll');
      void die.offsetWidth;
      die.classList.add('roll');
      app.rollGradient();
    });
    this.minusEl.addEventListener('click', () => {
      app.audio.ui();
      app.setLayerCount(app.style.layers.colors.length - 1);
    });
    this.plusEl.addEventListener('click', () => {
      app.audio.ui();
      app.setLayerCount(app.style.layers.colors.length + 1);
    });
    this.blendEl.addEventListener('input', () => {
      readout(this.blendWord, blendWord(+this.blendEl.value), Math.round(this.blendEl.value * 100));
      this.blendEl.style.setProperty('--p', `${this.blendEl.value * 100}%`);
      app.setLayerBlur(+this.blendEl.value);
    });
    this.repeatEl.addEventListener('input', () => app.setLayerRepeat(+this.repeatEl.value));
    this.biasEl.addEventListener('input', () => app.setLayerBias(+this.biasEl.value));
    this.tilesEl = this.layersSec.querySelector('.tiles input');
    this.tilesWord = this.layersSec.querySelector('.tiles .word');
    this.tilesEl.addEventListener('input', () => app.setLayerTiles(+this.tilesEl.value));
    const presets = this.layersSec.querySelector('.presets');
    for (const p of LAYER_PRESETS) {
      const b = document.createElement('button');
      b.className = 'preset';
      b.dataset.preset = p.id;
      b.innerHTML = `<i style="background:${flavorSwatchCSS({ layers: p.colors, blur: p.blur, repeat: p.repeat, bias: p.bias, shape: p.shape })}"></i>${p.name}`;
      b.addEventListener('click', () => {
        app.audio.ui();
        app.setLayerPreset(p.id);
      });
      presets.appendChild(b);
    }

    const custom = document.createElement('label');
    custom.className = 'chip custom';
    custom.title = 'Custom colour';
    custom.innerHTML = '<input type="color" value="#d4102a" aria-label="Custom colour">';
    custom.querySelector('input').addEventListener('input', (e) => app.setFlavor(e.target.value));
    chips.appendChild(custom);
    this.matsEl = this.paletteEl.querySelector('.mats');
    for (const [id, t] of Object.entries(TEXTURES)) {
      const b = document.createElement('button');
      b.className = 'mat';
      b.dataset.tex = id;
      b.innerHTML = `<i class="msw"></i><span>${t.label || t.name}</span>`;
      b.setAttribute('aria-label', t.name);
      b.addEventListener('click', () => {
        app.audio.ui();
        app.setTexture(id);
      });
      this.matsEl.appendChild(b);
    }
    const glitSeg = this.paletteEl.querySelector('.seg.glit');
    for (const gl of GLITTERS) {
      const b = document.createElement('button');
      b.className = 'opt';
      b.dataset.glit = gl.id;
      b.innerHTML = gl.id === 'off' ? gl.name : `<i class="gdot" style="background:${gl.dot}"></i>${gl.name}`;
      b.addEventListener('click', () => {
        app.audio.ui();
        app.setGlitter(gl.id);
      });
      glitSeg.appendChild(b);
    }
    const edgeSeg = this.paletteEl.querySelector('.seg.edges');
    for (const [id, e] of Object.entries(EDGES)) {
      const b = document.createElement('button');
      b.className = 'opt';
      b.dataset.edges = id;
      const rx = Math.round(e.bevel * 36);
      b.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="2.5" width="15" height="15" rx="${rx}" fill="none" stroke="currentColor" stroke-width="1.7"/></svg><span>${e.name}</span>`;
      b.addEventListener('click', () => {
        app.audio.ui();
        app.setEdges(id);
      });
      edgeSeg.appendChild(b);
    }

    // its edges' trim: a tile of each - a square of the jelly with that edge
    // (in its colour: see _tintSurfaces)
    this.trimsEl = this.paletteEl.querySelector('.trims');
    for (const t of TRIMS) {
      const b = document.createElement('button');
      b.className = 'mat';
      b.dataset.trim = t.id;
      b.innerHTML = `<i class="msw">${trimTile(t.id)}</i><span>${t.name}</span>`;
      b.setAttribute('aria-label', `${t.name} trim`);
      b.addEventListener('click', () => {
        app.audio.ui();
        app.setTrim(t.id);
      });
      this.trimsEl.appendChild(b);
    }

    // its surface map: a tile of each (drawn when the panel first opens - see
    // _paintSurfaces)
    this.surfsEl = this.paletteEl.querySelector('.surfs');
    for (const sf of SURFACES) {
      const b = document.createElement('button');
      b.className = 'mat';
      b.dataset.surf = sf.id;
      b.innerHTML = `<i class="msw"></i><span>${sf.name}</span>`;
      b.setAttribute('aria-label', `${sf.name} surface`);
      b.addEventListener('click', () => {
        app.audio.ui();
        app.setSurface(sf.id);
      });
      this.surfsEl.appendChild(b);
    }

    // ---- settings panel
    this.tuneBtn = root.querySelector('.tune-btn');
    this.tuneEl = root.querySelector('.palette.tune');
    this.rows = {};
    const scroll = this.tuneEl.querySelector('.tune-scroll');
    let group = null, into = scroll;
    // (the Cubicle's: a box a tool - its icon and name, a reset for just its
    // knobs - which goes to the top while that tool's in hand)
    this.labGroups = {};
    for (const st of SETTINGS) {
      if (st.group !== group) {
        group = st.group;
        if (st.lab) {
          const box = document.createElement('div');
          box.className = 'lab-row lab-group';
          if (st.tool) box.dataset.tool = st.tool;
          box.innerHTML = `<div class="lbl lab-head">${st.tool && ICONS[st.tool] ? `<i class="lab-ico">${ICONS[st.tool]}</i>` : ''}<span>${group}</span><button class="lab-reset" title="${group}: back to normal" aria-label="${group}: back to normal">${RESET_ICON}</button></div>`;
          const keys = SETTINGS.filter((x) => x.lab && x.group === group).map((x) => x.key);
          box.querySelector('.lab-reset').addEventListener('click', (e) => {
            e.preventDefault();
            app.audio.ui();
            app.resetSettings(keys);
          });
          scroll.appendChild(box);
          this.labGroups[st.tool || group] = box;
          into = box;
        } else {
          const h = document.createElement('div');
          h.className = 'lbl';
          h.textContent = group;
          scroll.appendChild(h);
          into = scroll;
        }
      }
      const row = document.createElement('label');
      row.className = st.lab ? 'row' : 'row';
      row.innerHTML = `<span class="name">${st.label}</span><input type="range" min="0" max="1" step="${st.step ?? (st.int ? 1 / 240 : 0.001)}"><span class="word"></span>`;
      const input = row.querySelector('input');
      const word = row.querySelector('.word');
      const valueOf = () => {
        const v = st.to(+input.value);
        return st.int ? Math.round(v) : v;
      };
      input.addEventListener('input', () => {
        const v = valueOf();
        readout(word, settingWord(st, v), settingNum(st, v));
        input.style.setProperty('--p', `${input.value * 100}%`);
        app.setSetting(st.key, v, !st.release);
      });
      if (st.release) input.addEventListener('change', () => app.setSetting(st.key, valueOf(), true));
      into.appendChild(row);
      this.rows[st.key] = { st, input, word };
    }
    // tearing (two hands pulling it apart): a switch under Feel
    {
      const row = document.createElement('div');
      row.className = 'row toggle';
      row.innerHTML = '<span class="name">Tearing</span><button class="switch" role="switch" aria-checked="false" aria-label="Tearing"><i></i></button><span class="word">Off</span>';
      const sw = row.querySelector('.switch'), word = row.querySelector('.word');
      const show = (on) => {
        sw.setAttribute('aria-checked', String(on));
        sw.classList.toggle('on', on);
        word.textContent = on ? 'On' : 'Off';
      };
      show(app.tearing);
      this._showTear = show;
      sw.addEventListener('click', () => {
        app.audio.ui();
        app.setTearing(!app.tearing);
        show(app.tearing);
        this.hint(app.tearing ? 'Pull it apart with two fingers and it tears' : 'Two fingers squish and stretch it · it won\'t tear', 2600);
      });
      this.rows.tough.input.closest('.row').after(row);
    }
    // the glass room: a switch under World
    {
      const row = document.createElement('div');
      row.className = 'row toggle';
      row.innerHTML = '<span class="name">Glass room</span><button class="switch" role="switch" aria-checked="false" aria-label="Glass room"><i></i></button><span class="word">Off</span>';
      const sw = row.querySelector('.switch'), word = row.querySelector('.word');
      const show = (on) => {
        sw.setAttribute('aria-checked', String(on));
        sw.classList.toggle('on', on);
        word.textContent = on ? 'On' : 'Off';
      };
      show(!!app.room?.on);
      sw.addEventListener('click', () => {
        app.audio.ui();
        app.setGlassRoom(!app.room.on);
        show(app.room.on);
        this.hint(app.room.on ? 'A glass room: throw it at the walls' : 'Back to the open floor', 2200);
      });
      this.rows.size.input.closest('.row').after(row);
    }
    // tilt & shake (phones with motion sensors): a switch under World
    if (app.tilt.supported) {
      const row = document.createElement('div');
      row.className = 'row toggle';
      row.innerHTML = '<span class="name">Tilt &amp; shake</span><button class="switch" role="switch" aria-checked="false" aria-label="Tilt and shake"><i></i></button><span class="word">Off</span>';
      const sw = row.querySelector('.switch'), word = row.querySelector('.word');
      const show = (on) => {
        sw.setAttribute('aria-checked', String(on));
        sw.classList.toggle('on', on);
        word.textContent = on ? 'On' : 'Off';
      };
      sw.addEventListener('click', async () => {
        app.audio.ui();
        if (app.tilt.on) {
          app.tilt.disable();
          show(false);
          return;
        }
        const ok = await app.tilt.enable();
        show(ok);
        this.hint(ok ? 'Tilt your phone to slide the jelly · shake it to jiggle' : 'Motion access is off for this page', 3200);
      });
      this.rows.size.input.closest('.row').after(row);
    }
    // the Lab: the knobs inside each tool, behind a switch (kept on if left on)
    {
      const row = document.createElement('div');
      row.className = 'row toggle lab-switch';
      row.innerHTML = '<span class="name">The Cubicle</span><button class="switch" role="switch" aria-checked="false" aria-label="The Cubicle: lab controls"><i></i></button><span class="word">Off</span>';
      const sw = row.querySelector('.switch'), word = row.querySelector('.word');
      let on = false;
      try {
        on = localStorage.getItem('cube-sim-lab') === '1';
      } catch (e) {
        /* private mode */
      }
      const show = () => {
        sw.setAttribute('aria-checked', String(on));
        sw.classList.toggle('on', on);
        word.textContent = on ? 'On' : 'Off';
        this.tuneEl.classList.toggle('lab-on', on);
      };
      show();
      sw.addEventListener('click', () => {
        app.audio.ui();
        on = !on;
        show();
        try {
          localStorage.setItem('cube-sim-lab', on ? '1' : '0');
        } catch (e) {
          /* private mode */
        }
        if (on) this.hint('The Cubicle: the knobs inside the hand and every tool', 2400);
      });
      const first = scroll.querySelector('.lab-row');
      if (first) scroll.insertBefore(row, first);
      else scroll.appendChild(row);
      // ...and every tool at once: gentle, as made, or wild
      const pre = document.createElement('div');
      pre.className = 'lab-row lab-presets';
      pre.innerHTML = '<span class="name">Every tool</span><div class="seg"></div>';
      for (const [id, name, title] of [['gentle', 'Gentle', 'Every tool softer and slower'], ['normal', 'Normal', 'Every tool as it was made'], ['wild', 'Wild', 'Every tool turned right up']]) {
        const b = document.createElement('button');
        b.className = 'opt';
        b.textContent = name;
        b.title = title;
        b.addEventListener('click', () => {
          app.audio.ui();
          app.labPreset(id);
          this.hint({ gentle: 'Every tool gentler', normal: 'Every tool back to normal', wild: 'Every tool turned right up' }[id], 1400);
        });
        pre.querySelector('.seg').appendChild(b);
      }
      row.after(pre);
      this.labTop = pre;
      this._pinLab(app.tool?.id);
    }
    this.tuneEl.querySelector('.reset').addEventListener('click', () => {
      app.audio.ui();
      app.resetSettings();
    });
    this.tuneBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      app.audio.init();
      const open = this.tuneEl.hidden;
      this.closePalette();
      if (open) {
        this.cubby?.close();
        this.stack?.close();
      }
      this.tuneEl.hidden = !open;
      this.tuneBtn.classList.toggle('open', open);
    });

    this.swatchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      app.audio.init();
      if (this.paletteEl.hidden) this.openPalette();
      else this.closePalette();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.paletteEl.hidden && !this.paletteEl.contains(e.target) && !this.swatchBtn.contains(e.target)) this.closePalette();
      if (!this.tuneEl.hidden && !this.tuneEl.contains(e.target) && !this.tuneBtn.contains(e.target)) this.closeTune();
    });
    this.healEl.addEventListener('click', () => {
      app.audio.init();
      if (app.heal()) this.cubby?.tally('healed');
    });
    this.muteEl.addEventListener('click', () => {
      app.audio.init();
      this.setMuted(!app.audio.muted);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') app.setSlowMo(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) app.setSlowMo(true);
        return;
      }
      const d = TOOL_DEFS.find((t) => t.key === e.key);
      // (the sieve's key with it in hand: the next powder)
      if (d && d.id === 'flour' && app.tool === app.tools.flour) app.tools.flour.nextPowder();
      else if (d) app.setTool(d.id);
      else if (e.key === 'h' || e.key === 'H') {
        if (app.heal()) this.cubby?.tally('healed');
      }
      else if (e.key === 'm' || e.key === 'M') this.setMuted(!app.audio.muted);
      else if ((e.key === 'l' || e.key === 'L') && !e.repeat) this.toggleTheme();
    });
    this.cubby = new Cubby(this, app);
    // clips: record what's going on, to share (see clips.js)
    this.clips = new Clips(this, app);
    // the stack (several cubes): its button by Re-cube, its panel
    this.stackBtn = root.querySelector('.stack-btn');
    this.stack = new StackPanel(this, app, root);
    // places: where the cube is
    this.placeBtn = root.querySelector('.place-btn');
    this.cubiplied = new CubipliedCard(root, app); // (a cubiplication's two, side by side)
    this.places = new PlacesPanel(this, app, root);
    this.placeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      app.audio.init();
      app.audio.ui();
      this.places.toggle();
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === 'p' || e.key === 'P') && !e.repeat) this.places.toggle();
    });
    this.stackBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      app.audio.init();
      this.stack.toggle();
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === 'k' || e.key === 'K') && !e.repeat && app.cubes.length > 1) this.stack.toggle();
    });
    this.cubesChanged();
  }

  // cubes came or went: the stack's button and panel, the Cubby's ON tag
  cubesChanged() {
    const many = this.app.cubes.length > 1;
    this.stackBtn.hidden = !many;
    if (!many) this.stack.close();
    this.stack.render();
    this.cubby?.render();
  }

  cubeSelected() {
    this.stack.render();
    this.cubby?.render();
  }

  // The surface tiles: each drawn once, in grey relief, the first time
  // they're seen; the jelly's colour laid over in the page (a new colour
  // costs nothing).
  _paintSurfaces() {
    if (!this._surfsPainted) {
      this._surfsPainted = true;
      for (const b of this.surfsEl.children) if (b.dataset.surf !== 'none') b.firstChild.style.backgroundImage = `url(${surfaceSwatch(b.dataset.surf, '#ffffff')})`;
    }
    this._tintSurfaces();
  }

  _tintSurfaces() {
    for (const b of this.surfsEl.children) b.firstChild.style.backgroundColor = this._surfHex || '#d4102a';
    for (const b of this.trimsEl.children) b.firstChild.style.color = this._surfHex || '#d4102a';
  }

  openPalette() {
    this._paintSurfaces();
    this.closeTune();
    this.cubby?.close();
    this.stack?.close();
    this.paletteEl.hidden = false;
    this.swatchBtn.classList.add('open');
    // (the chosen material and layer preset in view, where they scroll sideways)
    for (const box of [this.matsEl, this.layersSec.querySelector('.presets')]) {
      const a = box.querySelector('.active');
      if (a && box.scrollWidth > box.clientWidth) box.scrollLeft += a.getBoundingClientRect().left - box.getBoundingClientRect().left - (box.clientWidth - a.offsetWidth) / 2;
    }
  }

  closeTune() {
    if (!this.tuneEl) return;
    this.tuneEl.hidden = true;
    this.tuneBtn.classList.remove('open');
  }

  // Fraction of the screen height covered by an open panel (bottom sheet on phones).
  // (asked every frame - the camera lifts the scene over it: the page's width from the app's own size, not
  // window.innerWidth, which made the browser lay out the page there and then whenever anything in it had
  // changed - and the panel's place only while one's open)
  get panelCover() {
    const S = this.app.size;
    if (!S || S.w > 720) return 0;
    const el = !this.tuneEl.hidden ? this.tuneEl : !this.paletteEl.hidden ? this.paletteEl : this.cubby && !this.cubby.el.hidden ? this.cubby.el : this.stack && !this.stack.el.hidden ? this.stack.el : null;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, (S.h - r.top) / S.h);
  }

  // switches that live outside the sliders, after a whole cube is put on
  syncSwitches() {
    this._showTear?.(this.app.tearing);
  }

  setSettings(st, tex) {
    for (const key in this.rows) {
      const { st: def, input, word } = this.rows[key];
      const v = st[key];
      const t = Math.min(1, Math.max(0, def.from(v)));
      if (document.activeElement !== input) input.value = t;
      input.style.setProperty('--p', `${t * 100}%`);
      readout(word, settingWord(def, v), settingNum(def, v));
    }
    const reset = this.tuneEl.querySelector('.reset');
    reset.textContent = 'Back to square one';
    reset.title = `Every slider back to ${tex.name}'s own`;
  }

  closePalette() {
    this.paletteEl.hidden = true;
    this.swatchBtn.classList.remove('open');
  }

  toggleTheme() {
    const dark = this.app.theme !== 'dark';
    this.app.setTheme(dark ? 'dark' : 'light');
    this.setTheme(this.app.theme);
    if (dark) this.hint('Glow mode · knock it to send light through it', 2600);
  }

  // (the button offers the other look)
  // (the place cards show each place in the look you're in)
  placeChanged() {
    this.places?.render();
  }

  setTheme(name) {
    const dark = name === 'dark';
    this.places?.render();
    this.themeEl.innerHTML = dark ? ICONS.sun : ICONS.moon;
    this.themeEl.title = dark ? 'Lights on (L)' : 'Glow mode (L)';
    this.themeEl.setAttribute('aria-label', dark ? 'Lights on' : 'Glow mode');
  }

  setMuted(m) {
    this.app.audio.setMuted(m);
    this.muteEl.innerHTML = m ? ICONS.mute : ICONS.sound;
    this.muteEl.classList.toggle('off', m);
  }

  // (the googly eyes' row, as the tool has it)
  setEyeOpts({ style, size, pair, undo, picked = 0 }) {
    this.eyeStyleBtns.forEach((b, i) => b.classList.toggle('on', i === style));
    this.eyeSizeBtn.innerHTML = eyeSizeChip(size);
    this.eyeSizeBtn.title = ['Small', 'Medium', 'Large'][size] + ' eyes';
    this.eyePairBtn.innerHTML = eyePairChip(pair);
    // (one picked: the pairing's theirs - split them, or give it a twin)
    this.eyePairBtn.title = picked ? (pair ? 'A pair (tap to split them up)' : 'On its own (tap to give it a twin)') : pair ? 'In pairs (tap for one at a time)' : 'One at a time (tap for pairs)';
    for (const b of [this.eyePairBtn, ...this.eyeStyleBtns, this.eyeSizeBtn]) b.setAttribute('aria-label', b.title);
    this.eyePairBtn.classList.toggle('on', pair);
    this.eyeUndoBtn.disabled = !undo;
  }

  // (what's in the sieve: its chip on)
  setPowder(id) {
    for (const b of this.powdersEl.children) {
      const on = b.dataset.powder === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  // (the Cubicle: the tool in hand's knobs at the top, marked)
  _pinLab(id) {
    const box = this.labGroups?.[id];
    for (const k in this.labGroups || {}) this.labGroups[k].classList.toggle('in-hand', k === id);
    if (box && this.labTop && this.labTop.nextElementSibling !== box) this.labTop.after(box);
  }

  setTool(id) {
    for (const k in this.buttons) this.buttons[k].classList.toggle('active', k === id);
    this._pinLab(id);
    // (the sieve in hand: what's in it, to pick from; the googly eyes: theirs)
    this.powdersEl.hidden = id !== 'flour';
    this.eyeRow.hidden = id !== 'eyes';
    document.body.classList.toggle('powders-on', id === 'flour' || id === 'eyes');
    const d = TOOL_DEFS.find((t) => t.id === id);
    const touch = this.app.isTouch || window.matchMedia?.('(pointer: coarse)').matches;
    if (!d) return;
    // (tearing off: two fingers only squish and stretch)
    const h = id === 'hand' && !this.app.tearing ? d.hint.replace('squish or pull it apart', 'squish or stretch it') : d.hint;
    this.hint(touch ? h.replace(/\bClick\b/g, 'Tap').replace(/\bclick\b/g, 'tap') : h);
  }

  // Layer editor: the gradient (see gradedit.js), how many colours, the sliders
  renderLayers(L) {
    const cols = L.colors;
    const n = cols.length;
    this.nEl.textContent = n;
    this.minusEl.disabled = n <= MIN_LAYERS;
    this.plusEl.disabled = n >= MAX_LAYERS;
    this.grad.render(L);
    // (freeform: the cube unfolded, not the strip; no repeat or bias)
    const free = L.shape === 'free';
    this.layersSec.classList.toggle('is-free', free);
    this.layersSec.querySelector('.free').hidden = !free;
    for (const sel of ['.grad', '.grad-ends', '.row.repeat', '.row.bias']) this.layersSec.querySelector(sel).hidden = free;
    this.layersHint.textContent = free ? 'tap a face to add' : 'drag or tap stops';
    if (free) this.free.render(L);
    if (document.activeElement !== this.blendEl) this.blendEl.value = L.blur;
    this.blendEl.style.setProperty('--p', `${L.blur * 100}%`);
    readout(this.blendWord, blendWord(L.blur), Math.round(L.blur * 100));
    const rep = L.repeat || 1, bias = L.bias || 0;
    if (document.activeElement !== this.repeatEl) this.repeatEl.value = rep;
    this.repeatEl.style.setProperty('--p', `${((rep - 1) / (MAX_REPEAT - 1)) * 100}%`);
    readout(this.repeatWord, repeatWord(rep), `${rep}×`);
    if (document.activeElement !== this.biasEl) this.biasEl.value = bias;
    this.biasEl.style.setProperty('--p', `${((bias + 1) / 2) * 100}%`);
    readout(this.biasWord, biasWord(bias), signed(Math.round(bias * 100)));
    const tiles = L.tiles || 1;
    if (document.activeElement !== this.tilesEl) this.tilesEl.value = tiles;
    this.tilesEl.style.setProperty('--p', `${((tiles - 1) / (MAX_TILES - 1)) * 100}%`);
    readout(this.tilesWord, tiles > 1 ? `${tiles} × ${tiles}` : 'Whole', null);
    const key = cols.join(',').toLowerCase();
    for (const b of this.layersSec.querySelectorAll('.preset')) {
      const p = LAYER_PRESETS.find((q) => q.id === b.dataset.preset);
      b.classList.toggle('active', p.colors.join(',').toLowerCase() === key && (p.repeat || 1) === rep && Math.abs((p.bias || 0) - bias) < 0.02 && !L.stops && (!p.shape || p.shape === L.shape));
    }
  }

  setStyle(style, flavor) {
    const css = flavorSwatchCSS(flavor);
    // (on the page, for the logotype's cube too)
    const jl = flavor.layers ? flavor.layers[flavor.layers.length - 1] : flavor.hex;
    if (jl !== this._jl && this._jl !== undefined) this.jiggleBrand();
    this._jl = jl;
    document.documentElement.style.setProperty('--jelly', jl);
    this.swatchBtn.querySelector('.swatch').style.background = css;
    const layerChip = this.paletteEl.querySelector('.chip.layered');
    if (layerChip) layerChip.style.setProperty('--c', flavorSwatchCSS({ layers: style.layers.colors, blur: style.layers.blur, repeat: style.layers.repeat, bias: style.layers.bias, stops: style.layers.stops, shape: style.layers.shape }));
    this.layersSec.hidden = !flavor.layers;
    if (flavor.layers) this.renderLayers(style.layers);
    for (const b of this.paletteEl.querySelectorAll('.chip[data-flavor]')) b.classList.toggle('active', b.dataset.flavor === style.flavor);
    this.paletteEl.querySelector('.chip.custom').classList.toggle('active', String(style.flavor).startsWith('#'));
    // material tiles in this flavour (layered: its middle colour)
    const hex = flavorMainHex(flavor);
    if (hex !== this._matHex) {
      this._matHex = hex;
      for (const b of this.matsEl.children) b.firstChild.style.background = materialSwatchCSS(TEXTURES[b.dataset.tex], hex);
    }
    for (const b of this.matsEl.children) b.classList.toggle('active', b.dataset.tex === style.texture);
    for (const b of this.paletteEl.querySelectorAll('.opt[data-edges]')) b.classList.toggle('active', b.dataset.edges === style.edges);
    for (const b of this.trimsEl.children) b.classList.toggle('active', b.dataset.trim === (style.trim || 'none'));
    for (const b of this.surfsEl.children) b.classList.toggle('active', b.dataset.surf === (style.surface || 'none'));
    this._surfHex = hex;
    if (this._surfsPainted) this._tintSurfaces();
    for (const b of this.paletteEl.querySelectorAll('.opt[data-glit]')) b.classList.toggle('active', b.dataset.glit === style.glitter);
  }

  // the logo gives a jiggle (a new jelly; the splash's name landing in it)
  jiggleBrand() {
    const b = this.root.querySelector('.brand');
    if (!b) return;
    b.classList.remove('jiggle');
    void b.offsetWidth;
    b.classList.add('jiggle');
  }

  setDamaged(d) {
    this.healEl.classList.toggle('pulse', d);
  }

  // The mallet's resonance: hits on the beat so far (pips), and where the
  // next beat is - a playhead running across the streak's life, through the
  // two windows a hit lands on the beat in (the next beat, and the one after).
  // null: none going (it fades); burst: it went.
  resonance(st) {
    let el = this.resEl;
    if (!el) {
      if (!st) return;
      el = this.resEl = document.createElement('div');
      el.className = 'res-meter';
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = `<span class="res-lbl">Resonance</span><span class="res-pips"></span><span class="res-track"><i class="res-win"></i><i class="res-win"></i><b class="res-head"></b></span>`;
      this.root.appendChild(el);
      this.resPips = el.querySelector('.res-pips');
      this.resHead = el.querySelector('.res-head');
      this.resWins = el.querySelectorAll('.res-win');
      this._resMax = 0;
    }
    const on = !!st && !st.burst;
    if (st?.burst) {
      el.classList.remove('burst');
      void el.offsetWidth;
      el.classList.add('burst');
      for (const p of this.resPips.children) p.classList.add('on');
      clearTimeout(this._resT);
      this._resT = setTimeout(() => {
        el.classList.remove('show', 'burst');
        document.body.classList.remove('res-on');
      }, 700);
      return;
    }
    if (!on) {
      if (el.classList.contains('show') && !el.classList.contains('burst')) {
        el.classList.remove('show', 'beat');
        document.body.classList.remove('res-on');
      }
      return;
    }
    clearTimeout(this._resT);
    el.classList.remove('burst');
    if (this._resMax !== st.max) {
      this._resMax = st.max;
      this.resPips.innerHTML = '<i></i>'.repeat(st.max);
      // (the windows: as the mallet takes a hit to be on its beat - see MalletTool.strike)
      const span = st.life;
      st.wins.forEach(([a, b], k) => {
        this.resWins[k].style.left = `${(a / span) * 100}%`;
        this.resWins[k].style.width = `${((b - a) / span) * 100}%`;
      });
    }
    const pips = this.resPips.children, lv = st.max > 1 ? (st.hits - 1) / (st.max - 1) : 0;
    for (let k = 0; k < pips.length; k++) {
      pips[k].classList.toggle('on', k < st.hits);
      pips[k].classList.toggle('next', k === st.hits);
    }
    const inWin = st.wins.some(([a, b]) => st.u >= a && st.u <= b);
    el.classList.toggle('beat', inWin);
    el.style.setProperty('--lv', lv.toFixed(3));
    this.resHead.style.left = `${Math.min(100, (st.u / st.life) * 100).toFixed(2)}%`;
    if (!el.classList.contains('show')) {
      el.classList.add('show');
      document.body.classList.add('res-on');
    }
  }

  hint(text, ms = 2600) {
    const el = this.hintEl;
    // (one already up: a jiggle for the new one)
    if (el.classList.contains('show') && el.textContent !== text) {
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._ht);
    this._ht = setTimeout(() => this.hintEl.classList.remove('show'), ms);
  }
}
