// Acne, as a cube's own (style.acne - in its code, field z): how many zits and how big, where they come up (a seed),
// and their colours - the angry skin round each (red), its head (head) and what's in it (pus) - or, as they come
// (blend), their bodies the cube's own colour where each comes up, a rainbow's band there, only their heads and pus
// their own. Where each one is: laid
// out from the seed over its top and sides (not its bottom - sat on, they'd pop), each its own size round the size
// asked, none on another (see zitSpots). They're popped by squeezing, shooting, cutting... (see world/zits.js); a
// re-cube brings them back.

import { onSurface } from './eyes.js';

export const ACNE_AMOUNTS = [
  { id: 'none', name: 'None', n: 0 },
  { id: 'few', name: 'A few', n: 5 },
  { id: 'some', name: 'Some', n: 12 },
  { id: 'lots', name: 'Lots', n: 24 },
  { id: 'breakout', name: 'Breakout', n: 40 },
];
// (each one's radius about this - a share of the cube's side - give or take 40%: big and small among them)
export const ACNE_SIZES = [
  { id: 'small', name: 'Small', r: 0.032 },
  { id: 'medium', name: 'Medium', r: 0.046 },
  { id: 'large', name: 'Large', r: 0.064 },
  { id: 'huge', name: 'Huge', r: 0.088 },
];
// (their looks, ready made: the skin round them, their heads, what comes out)
export const ACNE_LOOKS = [
  { id: 'classic', name: 'Classic', red: '#d8323c', head: '#fff6dc', pus: '#f4e8b8' },
  { id: 'angry', name: 'Angry', red: '#b8121e', head: '#f6d34a', pus: '#ecca4c' },
  { id: 'gnarly', name: 'Gnarly', red: '#8e2a6a', head: '#b6cf4e', pus: '#a9be46' },
  { id: 'bloody', name: 'Bloody', red: '#c41a24', head: '#fbe9d6', pus: '#c4524a' },
  { id: 'black', name: 'Blackheads', red: '#e2827e', head: '#2a221e', pus: '#cfc6a8' },
];
export const MAX_ZITS = 40;

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// A cube's acne, made good (from anywhere: a code, a saved room) - or null: none.
export function copyAcne(a) {
  if (!a || typeof a !== 'object') return null;
  const n = clamp(Math.round(+a.n || 0), 0, MAX_ZITS);
  if (!n) return null;
  const L = ACNE_LOOKS[0];
  return {
    n,
    size: clamp(Math.round(+a.size || 0), 0, ACNE_SIZES.length - 1),
    seed: clamp(Math.round(+a.seed || 0), 0, 65535),
    red: HEX.test(a.red) ? a.red.toLowerCase() : L.red,
    head: HEX.test(a.head) ? a.head.toLowerCase() : L.head,
    pus: HEX.test(a.pus) ? a.pus.toLowerCase() : L.pus,
    blend: a.blend === undefined ? true : !!a.blend, // (blended, unless it's said it isn't)
  };
}

// In a code: its count and size (two hex digits each - its size's top bit, blended), its seed (four), its three
// colours (six each)
const h2 = (v) => v.toString(16).padStart(2, '0');
export function encodeAcne(a) {
  const c = copyAcne(a);
  if (!c) return '';
  return h2(c.n) + h2(c.size | (c.blend ? 0x80 : 0)) + c.seed.toString(16).padStart(4, '0') + c.red.slice(1) + c.head.slice(1) + c.pus.slice(1);
}
export function decodeAcne(v) {
  const s = String(v || '');
  if (!/^[0-9a-f]{26}$/i.test(s)) return null;
  const sz = parseInt(s.slice(2, 4), 16);
  return copyAcne({ n: parseInt(s.slice(0, 2), 16), size: sz & 0x7f, blend: sz >= 0x80, seed: parseInt(s.slice(4, 8), 16), red: '#' + s.slice(8, 14), head: '#' + s.slice(14, 20), pus: '#' + s.slice(20, 26) });
}

// Where its zits come up (a cube of side 1, its edges rounded to b): [{ x, y, z, r }] - rest shape, from its middle,
// on its surface; r a share of the side. Laid out from its seed: the same every time. (avoid: [x, y, z, r] things
// already on it - its eyes - kept clear of)
export function zitSpots(a, b = 0.13, avoid = []) {
  const c = copyAcne(a);
  if (!c) return [];
  let s = (c.seed * 2654435761 + 12345) >>> 0;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const base = ACNE_SIZES[c.size].r, out = [];
  for (let tries = 0; out.length < c.n && tries < c.n * 40; tries++) {
    // (a point in the cube, out to its surface: its top and sides only)
    const p = [rand() - 0.5, rand() * 0.85 - 0.35, rand() - 0.5];
    const ax = Math.abs(p[0]) > Math.abs(p[2]) ? 0 : 2;
    if (p[1] < 0.3 && rand() < 0.75) p[ax] = p[ax] < 0 ? -0.5 : 0.5;
    else p[1] = 0.5;
    const q = onSurface(p, b);
    if (q.n[1] < -0.2) continue;
    const r = base * (0.6 + 0.8 * rand());
    const P = q.p;
    let ok = true;
    for (const o of out) if (Math.hypot(o.x - P[0], o.y - P[1], o.z - P[2]) < (o.r + r) * 1.35) ok = false;
    for (const e of avoid) if (Math.hypot(e[0] - P[0], e[1] - P[1], e[2] - P[2]) < (e[3] + r) * 1.2) ok = false;
    if (ok) out.push({ x: P[0], y: P[1], z: P[2], r });
  }
  return out;
}
