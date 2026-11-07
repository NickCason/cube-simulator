// Freeform gradients: colours at points on the cube (and, dyed in, inside
// it), blending between them - each point with a strength, how far its
// colour reaches. Points sit in the cube's rest shape, as shares of its side
// (-0.5..0.5 each way), so the colours ride its wobble, show where it's cut
// and come back with a Re-cube. The colour anywhere is the points' colours
// weighted by strength / (distance² + a little)^power: a patch of each
// point's own colour round it and smooth blends between, crisp or soft by
// the Blend. (The shaders read it baked into a little grid of colours per
// cube - see bakeFree, JellyView.setCubeLook.)

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export const FREE_N = 32; // (the grid a side, per cube)
const EPS = 0.0025; // (a point's patch isn't a spike: ~5 cm of give)
export const FREE_K_MIN = 0.25;
export const FREE_K_MAX = 4;

// (the Blend: soft, wide blends at 1, crisp patches at 0)
export const freePower = (blur) => 2.2 - 1.5 * clamp01(blur ?? 0.5);

// The cube unfolded, a cross four faces across and three down: each face's
// place (col, row) and how its (u, v) - 0..1 across and up, as drawn - land
// on the cube. Front faces you at first; the rest fold back from it.
export const NET = [
  { id: 'top', name: 'Top', col: 1, row: 0, p: (u, v) => [u - 0.5, 0.5, 0.5 - v] },
  { id: 'left', name: 'Left', col: 0, row: 1, p: (u, v) => [-0.5, v - 0.5, u - 0.5] },
  { id: 'front', name: 'Front', col: 1, row: 1, p: (u, v) => [u - 0.5, v - 0.5, 0.5] },
  { id: 'right', name: 'Right', col: 2, row: 1, p: (u, v) => [0.5, v - 0.5, 0.5 - u] },
  { id: 'back', name: 'Back', col: 3, row: 1, p: (u, v) => [0.5 - u, v - 0.5, -0.5] },
  { id: 'bottom', name: 'Bottom', col: 1, row: 2, p: (u, v) => [u - 0.5, -0.5, v - 0.5] },
];

// where a point on (or in) the cube shows on the net: the face it's nearest
// the middle of, and its (u, v) there
export function netOf(x, y, z) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let f, u, v;
  if (ay >= ax && ay >= az) {
    if (y > 0) [f, u, v] = [0, x + 0.5, 0.5 - z];
    else [f, u, v] = [5, x + 0.5, z + 0.5];
  } else if (az >= ax) {
    if (z > 0) [f, u, v] = [2, x + 0.5, y + 0.5];
    else [f, u, v] = [4, 0.5 - x, y + 0.5];
  } else if (x > 0) [f, u, v] = [3, 0.5 - z, y + 0.5];
  else [f, u, v] = [1, z + 0.5, y + 0.5];
  return { f, u: clamp01(u), v: clamp01(v) };
}

// n points spread evenly over the faces (a golden spiral from the top,
// pushed out onto the cube); strength 1
export function freeNodesDefault(n) {
  const out = [], ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * ga + 0.6;
    const d = [Math.cos(a) * r, y, Math.sin(a) * r], m = Math.max(...d.map(Math.abs));
    out.push({ x: (0.5 * d[0]) / m, y: (0.5 * d[1]) / m, z: (0.5 * d[2]) / m, k: 1 });
  }
  return out;
}

const okNode = (q) => q && Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.k);

// a freeform flavour's points (as set, if there's one a colour; else spread)
export function freeNodes(f) {
  const n = f.layers.length, s = f.nodes;
  if (Array.isArray(s) && s.length === n && s.every(okNode)) return s;
  return freeNodesDefault(n);
}

const rgbOf = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// What the field needs, worked out once: the points (their places,
// strengths and colours, side by side) and the weight by distance - the
// power's curve, tabled (Math.pow per point per sample was most of the time)
const DMAX = 1.8; // (further than any two points in the cube)
const TL = 2048;
function prep(f) {
  const nodes = freeNodes(f), n = nodes.length;
  const A = new Float64Array(n * 7); // x y z k r g b
  nodes.forEach((q, i) => {
    const c = rgbOf(f.layers[i]);
    A.set([q.x, q.y, q.z, q.k, c[0], c[1], c[2]], i * 7);
  });
  const g = freePower(f.blur), T = new Float64Array(TL + 2);
  for (let i = 0; i <= TL + 1; i++) {
    const d = (Math.min(i, TL) / TL) * DMAX;
    T[i] = Math.pow(d * d + EPS, -g);
  }
  return { n, A, T };
}

// its colour at a point (shares of the side), sRGB 0..255 into out
function colorAt(P, x, y, z, out) {
  const { n, A, T } = P, s = TL / DMAX;
  let r = 0, gg = 0, b = 0, W = 0;
  for (let i = 0, o = 0; i < n; i++, o += 7) {
    const dx = x - A[o], dy = y - A[o + 1], dz = z - A[o + 2];
    const t = Math.min(TL, Math.sqrt(dx * dx + dy * dy + dz * dz) * s), i0 = t | 0;
    const w = A[o + 3] * (T[i0] + (T[i0 + 1] - T[i0]) * (t - i0));
    r += A[o + 4] * w;
    gg += A[o + 5] * w;
    b += A[o + 6] * w;
    W += w;
  }
  out[0] = r / W;
  out[1] = gg / W;
  out[2] = b / W;
  return out;
}

const _c = [0, 0, 0];
// as a hex colour, at a rest point (from the cube's middle; size its side)
export function freeColorAt(f, x, y, z, size = 1) {
  colorAt(prep(f), x / size, y / size, z / size, _c);
  return '#' + ((1 << 24) | (Math.round(_c[0]) << 16) | (Math.round(_c[1]) << 8) | Math.round(_c[2])).toString(16).slice(1);
}

// Its grid of colours (FREE_N a side: sRGB bytes, RGBA, x fastest then y then
// z) - what the shaders sample, between the points of the grid
export function bakeFree(f, out = new Uint8Array(FREE_N ** 3 * 4)) {
  const P = prep(f), N = FREE_N, c = [0, 0, 0];
  let o = 0;
  for (let k = 0; k < N; k++) {
    const z = (k + 0.5) / N - 0.5;
    for (let j = 0; j < N; j++) {
      const y = (j + 0.5) / N - 0.5;
      for (let i = 0; i < N; i++) {
        colorAt(P, (i + 0.5) / N - 0.5, y, z, c);
        out[o] = c[0];
        out[o + 1] = c[1];
        out[o + 2] = c[2];
        out[o + 3] = 255;
        o += 4;
      }
    }
  }
  return out;
}

// Each face of the net as an image: px a side, RGBA (for the editor)
export function netImages(f, px) {
  const P = prep(f), c = [0, 0, 0];
  return NET.map((face) => {
    const img = new Uint8ClampedArray(px * px * 4);
    for (let j = 0; j < px; j++)
      for (let i = 0; i < px; i++) {
        const [x, y, z] = face.p((i + 0.5) / px, 1 - (j + 0.5) / px);
        colorAt(P, x, y, z, c);
        const o = (j * px + i) * 4;
        img[o] = c[0];
        img[o + 1] = c[1];
        img[o + 2] = c[2];
        img[o + 3] = 255;
      }
    return img;
  });
}

// a CSS picture of it (a dot, a chip): its front, roughly - each point a
// soft blob where it sits, over the colour they all make
export function freeCSS(f) {
  const nodes = freeNodes(f), blobs = [];
  nodes.forEach((q, i) => {
    const { f: face, u, v } = netOf(q.x, q.y, q.z);
    // (front-ish: the faces round it squashed in toward its edges)
    const at = face === 2 ? [u, 1 - v] : face === 0 ? [u, 0.12 * v] : face === 5 ? [u, 1 - 0.12 * (1 - v)] : face === 3 ? [1 - 0.12 * (1 - u), 1 - v] : face === 1 ? [0.12 * u, 1 - v] : [0.5, 0.5];
    blobs.push(`radial-gradient(circle at ${(at[0] * 100).toFixed(0)}% ${(at[1] * 100).toFixed(0)}%, ${f.layers[i]} 0, ${f.layers[i]}00 ${(48 * Math.sqrt(q.k)).toFixed(0)}%)`);
  });
  return `${blobs.join(', ')}, ${f.layers[0]}`;
}
