// Googly eyes, as a cube's own: kept with its look (style.eyes), in its code,
// in its family - its children get them too. Each eye: { x, y, z } where it
// sits on the cube (its rest shape: shares of the side from the middle, out
// on its surface), r how big (its radius, a share of the side), s what kind
// (EYE_STYLES), p its pair (0: on its own; the same number: a pair, mirrored
// across the face - they move together).

// (trait: what a child that's got them is said to have)
export const EYE_STYLES = [
  { id: 'classic', name: 'Googly', trait: 'Googly eyes', pupil: 0.47 },
  { id: 'big', name: 'Big pupils', trait: 'Big pupils', pupil: 0.64 },
  { id: 'tiny', name: 'Beady', trait: 'Beady eyes', pupil: 0.27 },
  { id: 'lashes', name: 'Lashes', trait: 'Eyelashes', pupil: 0.46, lashes: true },
  { id: 'angry', name: 'Cross', trait: 'Cross eyes', pupil: 0.44, brow: true },
  { id: 'sleepy', name: 'Sleepy', trait: 'Sleepy eyes', pupil: 0.42, lid: true },
];
export const EYE_SIZES = [0.055, 0.085, 0.125]; // (small, medium, large: radius, a share of the side)
export const EYE_R_MIN = 0.03, EYE_R_MAX = 0.22;
export const MAX_EYES = 12; // (a cube)

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// A cube's eyes, made good (from anywhere: a code, a saved room, a family).
export function copyEyes(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const e of list) {
    if (!e || ![e.x, e.y, e.z, e.r].every(Number.isFinite)) continue;
    out.push({ x: clamp(e.x, -0.5, 0.5), y: clamp(e.y, -0.5, 0.5), z: clamp(e.z, -0.5, 0.5), r: clamp(e.r, EYE_R_MIN, EYE_R_MAX), s: clamp(Math.round(e.s) || 0, 0, EYE_STYLES.length - 1), p: clamp(Math.round(e.p) || 0, 0, 15) });
    if (out.length >= MAX_EYES) break;
  }
  return out;
}

// In a code: ten hex digits an eye - where (three bytes), how big (one),
// what kind and its pair (a digit each).
const h2 = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
export function encodeEyes(eyes) {
  return copyEyes(eyes)
    .map((e) => h2((e.x + 0.5) * 255) + h2((e.y + 0.5) * 255) + h2((e.z + 0.5) * 255) + h2(((e.r - EYE_R_MIN) / (EYE_R_MAX - EYE_R_MIN)) * 255) + e.s.toString(16) + e.p.toString(16))
    .join('');
}
export function decodeEyes(v) {
  return copyEyes(
    (String(v).match(/[0-9a-f]{10}/gi) || []).map((h) => ({
      x: parseInt(h.slice(0, 2), 16) / 255 - 0.5,
      y: parseInt(h.slice(2, 4), 16) / 255 - 0.5,
      z: parseInt(h.slice(4, 6), 16) / 255 - 0.5,
      r: EYE_R_MIN + (parseInt(h.slice(6, 8), 16) / 255) * (EYE_R_MAX - EYE_R_MIN),
      s: parseInt(h[8], 16),
      p: parseInt(h[9], 16),
    })),
  );
}

// The outside of a cube of side 1 (its edges rounded to b) nearest p, and
// which way it faces there: { p, n } (rest shape, from its middle).
export function onSurface(p, b) {
  const h = 0.5 - b, q = p.map((v) => clamp(v, -h, h)), d = p.map((v, i) => v - q[i]);
  let l = Math.hypot(...d), n;
  if (l > 1e-6) n = d.map((v) => v / l);
  else {
    // (inside its inner box: out the nearest face)
    let a = 0;
    for (let i = 1; i < 3; i++) if (Math.abs(p[i]) > Math.abs(p[a])) a = i;
    n = [0, 0, 0];
    n[a] = p[a] < 0 ? -1 : 1;
    q[a] = n[a] * h;
  }
  return { p: q.map((v, i) => v + n[i] * b), n };
}

// An eye's way up and its right, on the cube where it faces n (rest shape):
// up the cube, on its sides; away from the front on the top (and toward it
// on the bottom), as you'd see them from the front.
export function eyeFrame(n) {
  let up = Math.abs(n[1]) > 0.8 ? [0, 0, n[1] > 0 ? -1 : 1] : [0, 1, 0];
  const k = up[0] * n[0] + up[1] * n[1] + up[2] * n[2];
  up = up.map((v, i) => v - k * n[i]);
  const ul = Math.hypot(...up) || 1;
  up = up.map((v) => v / ul);
  // right: up × n
  const right = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
  return { up, right };
}

// An eye's twin across its face: mirrored across the plane through the
// cube's middle that its face's way out and way up span.
export function mirrorEye(e, b) {
  const { n } = onSurface([e.x, e.y, e.z], b), { right } = eyeFrame(n);
  const p = [e.x, e.y, e.z], k = p[0] * right[0] + p[1] * right[1] + p[2] * right[2];
  const q = p.map((v, i) => v - 2 * k * right[i]);
  return { ...e, x: q[0], y: q[1], z: q[2] };
}

// (a pair placed on the middle line pushed apart to `gap` each side)
export function spread(e, b, gap) {
  const { n } = onSurface([e.x, e.y, e.z], b), { right } = eyeFrame(n);
  const p = [e.x, e.y, e.z], k = p[0] * right[0] + p[1] * right[1] + p[2] * right[2];
  if (Math.abs(k) >= gap) return e;
  const kk = (k < 0 ? -1 : 1) * gap, q = p.map((v, i) => v + (kk - k) * right[i]);
  const s = onSurface(q, b).p;
  return { ...e, x: s[0], y: s[1], z: s[2] };
}

// Faces, ready-made (a special's: see specials.js) - on the front, a little up.
const face = (r, s, ...at) => at.map(([x, y, p]) => ({ x, y, z: 0.5, r, s, p }));
export const EYE_FACES = {
  pair: face(0.09, 0, [-0.17, 0.12, 1], [0.17, 0.12, 1]),
  boo: face(0.12, 1, [-0.19, 0.1, 1], [0.19, 0.1, 1]),
  cross: face(0.09, 4, [-0.17, 0.12, 1], [0.17, 0.12, 1]),
  beady: face(0.06, 2, [-0.13, 0.14, 1], [0.13, 0.14, 1]),
  sleepy: face(0.1, 5, [-0.18, 0.1, 1], [0.18, 0.1, 1]),
  monster: [...face(0.12, 0, [-0.13, 0.08, 0]), ...face(0.07, 1, [0.17, 0.2, 0]), ...face(0.05, 2, [0.15, -0.06, 0])],
  cyclops: face(0.16, 0, [0, 0.1, 0]),
};

// A word for them (the cube's summary, its name): '2 googly eyes', 'a cyclops eye'
export function eyesWord(eyes) {
  const n = (eyes || []).length;
  return !n ? '' : n === 1 ? 'A cyclops eye' : `${n} googly eyes`;
}
