// Surface maps: a relief moulded into the cube's skin - pits, treads, scales,
// studs, quilting. Not in the mesh: the jelly's shader bends its normal by
// the relief's slope at each pixel (see SURF_GLSL), so reflections, the room
// seen through it and the light on it all catch the pits and the ridges, and
// it rides every wobble. Each is a height over the cube's rest shape (0 the
// deepest, 1 the top), in cells (density of them across a face of the cube):
// a face pattern is laid on each face (up the cube on its sides) and blended
// round the edges; a through one (swiss cheese, sponge) is holes all through
// the jelly, so a cut shows them too.
//
// Each: id, name, density (cells across a face), depth (its relief, a share
// of the cube's size), ao (how much darker its hollows are - pits, not studs),
// rough (how much it scatters the light besides: frosted's mostly that),
// grip (how much better it holds on - the floor, other cubes: knurled and
// tread plate are made to - a share of the material's own),
// fam (how it's laid on the cube, seamless on every edge and corner, for
// every rounding: see SURF_BAKE_GLSL) - sites: round points spread over the
// cube's own surface (relax: evened out into near-hexagonal cells, as on a
// golf ball; else at random, minD apart, a share of their spacing); grid:
// each face a whole number of square cells, the same both ways (only a
// pattern as symmetric as a square's meets itself round every edge); rings:
// round the four sides as one band, over the top and bottom edges and mitred
// in to their middles; noise: in the jelly's own space; holes: all through
// it, not baked. period (a grid or rings one: repeats this often across and
// up, in cells: a face holds a whole number of them - see surfaceFit),
// through, glsl (its height at vec2 p
// - or, through, vec3 p), js (the same, for its swatch), holes (a through
// one's: its chance of a hole a cell, and their smallest and largest radius
// - real hollows, see SURF_GLSL), words (for names: adjectives, nouns).

const TAU = Math.PI * 2;
const SQRT3 = Math.sqrt(3);
const fract = (v) => v - Math.floor(v);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// (hashes: Dave Hoskins' - the swatches' needn't match the shader's exactly)
const h22 = (x, y) => {
  let a = fract(x * 0.1031), b = fract(y * 0.103), c = fract(x * 0.0973);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return [fract((a + a) * c), fract((a + b) * b)];
};
const h34 = (x, y, z) => {
  let a = fract(x * 0.1031), b = fract(y * 0.103), c = fract(z * 0.0973), d = fract(x * 0.1099);
  const s = a * (d + 33.33) + b * (c + 33.33) + c * (a + 33.33) + d * (b + 33.33);
  a += s; b += s; c += s; d += s;
  return [fract((a + b) * c), fract((a + c) * b), fract((b + c) * d), fract((c + d) * a)];
};
const hexOff = (x, y) => {
  const sy = Math.sqrt(3), m = (v, s) => v - s * Math.floor(v / s);
  const ax = m(x, 1) - 0.5, ay = m(y, sy) - sy / 2, bx = m(x - 0.5, 1) - 0.5, by = m(y - sy / 2, sy) - sy / 2;
  return ax * ax + ay * ay < bx * bx + by * by ? [ax, ay] : [bx, by];
};
const vor = (x, y) => {
  const cx = Math.floor(x), cy = Math.floor(y), fx = x - cx, fy = y - cy;
  let d1 = 8, d2 = 8;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const r = h22(cx + i, cy + j), qx = i + 0.15 + 0.7 * r[0] - fx, qy = j + 0.15 + 0.7 * r[1] - fy, d = qx * qx + qy * qy;
      if (d < d1) (d2 = d1), (d1 = d);
      else if (d < d2) d2 = d;
    }
  return [Math.sqrt(d1), Math.sqrt(d2)];
};
const vnoise = (x, y) => {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const n = (a, b) => h22(a, b)[0];
  return (n(ix, iy) * (1 - u) + n(ix + 1, iy) * u) * (1 - v) + (n(ix, iy + 1) * (1 - u) + n(ix + 1, iy + 1) * u) * v;
};
// (a five-pointed star's and a heart's signed distance - Inigo Quilez's)
const sdStar = (x, y, r, rf) => {
  const k1 = [0.809016994375, -0.587785252292], k2 = [-k1[0], k1[1]];
  x = Math.abs(x);
  let d = Math.max(k1[0] * x + k1[1] * y, 0);
  x -= 2 * d * k1[0]; y -= 2 * d * k1[1];
  d = Math.max(k2[0] * x + k2[1] * y, 0);
  x -= 2 * d * k2[0]; y -= 2 * d * k2[1];
  x = Math.abs(x);
  y -= r;
  const bx = rf * -k1[1], by = rf * k1[0] - 1, h = clamp((x * bx + y * by) / (bx * bx + by * by), 0, r);
  return Math.hypot(x - bx * h, y - by * h) * Math.sign(y * bx - x * by);
};
const sdHeart = (x, y) => {
  x = Math.abs(x);
  if (y + x > 1) return Math.hypot(x - 0.25, y - 0.75) - Math.SQRT2 / 4;
  const m = 0.5 * Math.max(x + y, 0);
  return Math.sqrt(Math.min(x * x + (y - 1) * (y - 1), (x - m) * (x - m) + (y - m) * (y - m))) * Math.sign(x - y);
};
const holes = (prob, r0, r1) => (x, y, z) => {
  const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z), fx = x - cx, fy = y - cy, fz = z - cz;
  const s = [fx < 0.5 ? -1 : 1, fy < 0.5 ? -1 : 1, fz < 0.5 ? -1 : 1];
  let h = 1;
  for (let n = 0; n < 8; n++) {
    const o = [(n & 1) * s[0], ((n >> 1) & 1) * s[1], ((n >> 2) & 1) * s[2]], r = h34(cx + o[0], cy + o[1], cz + o[2]);
    if (r[3] > prob) continue;
    const rad = r0 + (r1 - r0) * fract(r[3] * 7.13);
    const dx = fx - (o[0] + 0.22 + 0.56 * r[0]), dy = fy - (o[1] + 0.22 + 0.56 * r[1]), dz = fz - (o[2] + 0.22 + 0.56 * r[2]);
    const u2 = (dx * dx + dy * dy + dz * dz) / (rad * rad);
    if (u2 < 1) h = Math.min(h, 1 - Math.sqrt(1 - u2));
  }
  return h;
};

export const SURFACES = [
  { id: 'none', name: 'Smooth' },
  {
    id: 'swiss', name: 'Swiss cheese', density: 3.4, depth: 0.03, ao: 0.6, through: true, grip: 1.0, fam: 'holes',
    words: [['Holey', 'Swiss', 'Cheesy', 'Pitted'], ['Cheese', 'Emmental', 'Swiss', 'Holes']],
    glsl: 'return sfHoles(p, 0.72, 0.16, 0.46);',
    js: holes(0.72, 0.16, 0.46),
    holes: [0.72, 0.16, 0.46],
  },
  {
    id: 'diamond', name: 'Diamond plate', density: 6, depth: 0.01, rough: 0.04, period: [2, 2], grip: 1.45, fam: 'grid',
    words: [['Plated', 'Treaded', 'Industrial', 'Steel-Toed'], ['Treadplate', 'Plate', 'Deck', 'Tread']],
    glsl: `vec2 c = floor(p), f = fract(p) - 0.5;
      float s = mod(c.x + c.y, 2.0) < 0.5 ? 1.0 : -1.0;
      vec2 q = vec2(f.x + s * f.y, f.x - s * f.y) * 0.70710678;
      return smoothstep(1.0, 0.5, length(vec2(q.x / 0.36, q.y / 0.085)));`,
    js: (x, y) => {
      const cx = Math.floor(x), cy = Math.floor(y), fx = x - cx - 0.5, fy = y - cy - 0.5, s = (cx + cy) % 2 === 0 ? 1 : -1;
      const qx = (fx + s * fy) * Math.SQRT1_2, qy = (fx - s * fy) * Math.SQRT1_2;
      return sstep(1, 0.5, Math.hypot(qx / 0.36, qy / 0.085));
    },
  },
  {
    id: 'hammered', name: 'Hammered', density: 7, depth: 0.02, ao: 0.25, rough: 0.03, grip: 1.1, fam: 'sites', minD: 0.42,
    words: [['Hammered', 'Beaten', 'Dimpled', 'Forged'], ['Pewter', 'Anvil', 'Smithy', 'Tankard']],
    glsl: `return bowl;`,
    each: `float r = 0.55 + 0.4 * S.w, u = d / r; if (u < 1.0) bowl = min(bowl, 1.0 - 0.9 * (1.0 - u * u));`,
    js: (x, y) => Math.min(1, vor(x, y)[0] ** 2 * 2.4),
  },
  {
    id: 'waffle', name: 'Waffle', density: 5, depth: 0.012, ao: 0.45, period: [1, 1], grip: 1.25, fam: 'grid',
    words: [['Waffled', 'Gridded', 'Toasted', 'Syrupy'], ['Waffle', 'Griddle', 'Brunch', 'Grid']],
    glsl: 'vec2 f = abs(fract(p) - 0.5); return smoothstep(0.3, 0.4, max(f.x, f.y));',
    js: (x, y) => sstep(0.3, 0.4, Math.max(Math.abs(fract(x) - 0.5), Math.abs(fract(y) - 0.5))),
  },
  {
    id: 'bubblewrap', name: 'Bubble wrap', density: 6, depth: 0.016, grip: 1.15, fam: 'sites', relax: true,
    words: [['Poppable', 'Bubbly', 'Padded', 'Fragile'], ['Bubble Wrap', 'Popper', 'Parcel', 'Packing']],
    glsl: `float u = F1 / 0.38; return u < 1.0 ? sqrt(1.0 - u * u) : 0.0;`,
    js: (x, y) => {
      const d = Math.hypot(...hexOff(x, y)) / 0.36;
      return d < 1 ? Math.sqrt(1 - d * d) : 0;
    },
  },
  {
    id: 'scales', name: 'Scales', density: 6, depth: 0.014, ao: 0.3, period: [1, 4 / 3], grip: 0.92, fam: 'rings',
    words: [['Scaly', 'Draconic', 'Armoured', 'Fishy'], ['Dragon', 'Wyrm', 'Mermaid', 'Scales']],
    // (rows of discs, each covering the top of the row below - laid from the
    // bottom row up, so the highest one here is on top; its lower edge
    // stands proud, a steep step but not a sheer one, so it's smooth close up)
    glsl: `vec2 q = vec2(p.x, p.y * 1.5);
      float row = floor(q.y), h = 0.0;
      for (int r = -1; r <= 1; r++) {
        float j = row + float(r), sx = q.x + 0.5 * mod(j, 2.0), cx = floor(sx) + 0.5;
        float d = min(length(vec2(sx - cx, q.y - j - 1.05)), length(vec2(sx - cx - sign(sx - cx), q.y - j - 1.05)));
        h = mix(h, 0.25 + 0.75 * min(d, 0.72) / 0.72, smoothstep(0.72, 0.68, d));
      }
      return h;`,
    js: (x, y) => {
      const qy = y * 1.5, row = Math.floor(qy);
      let h = 0;
      for (let r = -1; r <= 1; r++) {
        const j = row + r, sx = x + 0.5 * (((j % 2) + 2) % 2), cx = Math.floor(sx) + 0.5;
        const d = Math.min(Math.hypot(sx - cx, qy - j - 1.05), Math.hypot(sx - cx - Math.sign(sx - cx), qy - j - 1.05));
        h += (0.25 + (0.75 * Math.min(d, 0.72)) / 0.72 - h) * sstep(0.72, 0.68, d);
      }
      return h;
    },
  },
  {
    id: 'honeycomb', name: 'Honeycomb', density: 5, depth: 0.01, ao: 0.4, grip: 1.2, fam: 'sites', relax: true,
    words: [['Honeycombed', 'Waxy', 'Hexed', 'Buzzing'], ['Hive', 'Honeycomb', 'Comb', 'Apiary']],
    glsl: `return 1.0 - smoothstep(0.05, 0.13, F2 - F1);`,
    js: (x, y) => {
      const [ox, oy] = hexOff(x, y).map(Math.abs);
      return sstep(0.4, 0.47, Math.max(ox * 0.5 + oy * 0.8660254, ox));
    },
  },
  {
    id: 'studs', name: 'Brick studs', density: 4, depth: 0.016, period: [1, 1], grip: 1.3, fam: 'grid',
    words: [['Studded', 'Snap-Together', 'Toy', 'Clicky'], ['Brick', 'Block', 'Studs', 'Builder']],
    glsl: 'return smoothstep(0.33, 0.3, length(fract(p) - 0.5));',
    js: (x, y) => sstep(0.33, 0.3, Math.hypot(fract(x) - 0.5, fract(y) - 0.5)),
  },
  {
    id: 'golf', name: 'Golf ball', density: 9, depth: 0.005, ao: 0.3, grip: 0.95, fam: 'sites', relax: true,
    words: [['Dimpled', 'Teed-Up', 'Fore', 'Clubhouse'], ['Golf Ball', 'Birdie', 'Tee', 'Hole-in-One']],
    glsl: `float u = F1 / 0.5; return u < 1.0 ? 1.0 - sqrt(1.0 - u * u) : 1.0;`,
    js: (x, y) => {
      const d = Math.hypot(...hexOff(x, y)) / 0.47;
      return d < 1 ? 1 - Math.sqrt(1 - d * d) : 1;
    },
  },
  {
    id: 'quilted', name: 'Quilted', density: 8, depth: 0.018, ao: 0.4, period: [2, 2], grip: 1.15, fam: 'grid',
    words: [['Quilted', 'Tufted', 'Puffy', 'Cosy'], ['Quilt', 'Duvet', 'Pillow', 'Eiderdown']],
    glsl: `vec2 f = fract(vec2(p.x + p.y, p.x - p.y) * 0.5);
      return sqrt(max(sin(3.14159265 * f.x) * sin(3.14159265 * f.y), 0.0));`,
    js: (x, y) => {
      const fx = fract((x + y) * 0.5), fy = fract((x - y) * 0.5);
      return Math.sqrt(Math.max(Math.sin(Math.PI * fx) * Math.sin(Math.PI * fy), 0));
    },
  },
  {
    id: 'ripples', name: 'Ripples', density: 2.5, depth: 0.035, grip: 1.0, fam: 'sites', minD: 0.7,
    words: [['Rippled', 'Rain-Dropped', 'Pond', 'Splashy'], ['Puddle', 'Pond', 'Raindrop', 'Ripple']],
    glsl: `return 0.5 + 0.22 * wave;`,
    each: `wave += sin(d * 25.0 - S.w * 6.2831853) * exp(-d * 2.6) * (0.5 + fract(S.w * 7.3));`,
    js: (x, y) => {
      const cx = Math.floor(x), cy = Math.floor(y), fx = x - cx, fy = y - cy;
      let h = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const r = h22(cx + i, cy + j), d = Math.hypot(i + r[0] - fx, j + r[1] - fy);
          h += Math.sin(d * 25 - r[0] * TAU) * Math.exp(-d * 2.6) * (0.5 + r[1]);
        }
      return 0.5 + 0.22 * h;
    },
  },
  {
    id: 'corrugated', name: 'Corrugated', density: 9, depth: 0.007, ao: 0.2, period: [1, 0], grip: 1.3, fam: 'rings',
    words: [['Corrugated', 'Ridged', 'Fluted', 'Sheet-Metal'], ['Shed', 'Roof', 'Washboard', 'Ridge']],
    // (a crest on every whole cell: mirrored about it, as the top's mitres need)
    glsl: 'return 0.5 + 0.5 * cos(6.2831853 * p.x);',
    js: (x) => 0.5 + 0.5 * Math.cos(TAU * x),
  },
  {
    id: 'knurled', name: 'Knurled', density: 14, depth: 0.004, ao: 0.25, rough: 0.05, period: [1, 1], grip: 1.6, fam: 'grid',
    words: [['Knurled', 'Grippy', 'Machined', 'Cross-Hatched'], ['Grip', 'Knurl', 'Handle', 'Dial']],
    glsl: 'return min(abs(fract(p.x + p.y) - 0.5), abs(fract(p.x - p.y) - 0.5)) * 2.0;',
    js: (x, y) => Math.min(Math.abs(fract(x + y) - 0.5), Math.abs(fract(x - y) - 0.5)) * 2,
  },
  {
    id: 'crackle', name: 'Crackle', density: 5, depth: 0.006, ao: 0.5, grip: 1.1, fam: 'sites', minD: 0.5,
    words: [['Crackled', 'Crazed', 'Parched', 'Antique'], ['Glaze', 'Mudflat', 'Desert', 'Relic']],
    glsl: `return smoothstep(0.0, 0.07, F2 - F1);`,
    js: (x, y) => {
      const v = vor(x, y);
      return sstep(0, 0.07, v[1] - v[0]);
    },
  },
  {
    id: 'pebbled', name: 'Pebbled', density: 8, depth: 0.009, ao: 0.35, rough: 0.06, grip: 1.35, fam: 'sites', minD: 0.55,
    words: [['Pebbled', 'Leathery', 'Gnarly', 'Swampy'], ['Croc', 'Gator', 'Pebble', 'Leather']],
    glsl: `return sqrt(clamp((F2 - F1) * 2.8, 0.0, 1.0));`,
    js: (x, y) => {
      const v = vor(x, y);
      return Math.sqrt(clamp((v[1] - v[0]) * 2.8, 0, 1));
    },
  },
  {
    id: 'craters', name: 'Moon craters', density: 4.5, depth: 0.016, ao: 0.4, rough: 0.06, grip: 1.2, fam: 'sites', minD: 0.6,
    words: [['Cratered', 'Lunar', 'Pockmarked', 'Asteroid'], ['Moon', 'Crater', 'Meteor', 'Luna']],
    glsl: `return clamp((bowl + 0.3 * min(rims, 1.0)) / 1.3, 0.0, 1.0);`,
    each: `if (S.w < 0.75) { float r = 0.2 + 0.3 * S.w / 0.75, u = d / r; if (u < 1.0) bowl = min(bowl, 0.12 + 0.88 * u * u); else rims += exp(-pow((u - 1.0) / 0.22, 2.0)); }`,
    js: (x, y) => {
      const cx = Math.floor(x), cy = Math.floor(y), fx = x - cx, fy = y - cy;
      let bowl = 1, rim = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const r = h22(cx + i + 7.3, cy + j + 7.3);
          if (r[1] > 0.75) continue;
          const q = h22(cx + i + 1.7, cy + j + 1.7), rad = 0.16 + (0.3 * r[1]) / 0.75, u = Math.hypot(i + 0.25 + 0.5 * q[0] - fx, j + 0.25 + 0.5 * q[1] - fy) / rad;
          if (u < 1) bowl = Math.min(bowl, 0.12 + 0.88 * u * u);
          else rim += Math.exp(-(((u - 1) / 0.22) ** 2));
        }
      return clamp((bowl + 0.3 * Math.min(rim, 1)) / 1.3, 0, 1);
    },
  },
  {
    id: 'woven', name: 'Basket weave', density: 4, depth: 0.008, ao: 0.35, period: [2, 2], grip: 1.25, fam: 'grid',
    words: [['Woven', 'Wicker', 'Plaited', 'Basketed'], ['Basket', 'Hamper', 'Wicker', 'Weave']],
    // (each strand dips at its ends, under the ones across it)
    glsl: `vec2 c = floor(p), f = fract(p);
      bool across = mod(c.x + c.y, 2.0) < 0.5;
      float t = across ? f.y : f.x, s = across ? f.x : f.y;
      return sin(3.14159265 * fract(t * 3.0)) * (0.7 + 0.3 * sin(3.14159265 * s)) * smoothstep(0.0, 0.07, min(s, 1.0 - s));`,
    js: (x, y) => {
      const across = (Math.floor(x) + Math.floor(y)) % 2 === 0, t = across ? fract(y) : fract(x), s = across ? fract(x) : fract(y);
      return Math.sin(Math.PI * fract(t * 3)) * (0.7 + 0.3 * Math.sin(Math.PI * s)) * sstep(0, 0.07, Math.min(s, 1 - s));
    },
  },
  {
    id: 'bricks', name: 'Bricks', density: 4, depth: 0.007, ao: 0.45, period: [1, 1], grip: 1.2, fam: 'rings',
    words: [['Bricked', 'Brick-Built', 'Mortared', 'Walled'], ['Wall', 'Brickwork', 'Chimney', 'Mason']],
    glsl: `vec2 q = vec2(p.x, p.y * 2.0);
      q.x += 0.5 * mod(floor(q.y), 2.0);
      vec2 f = fract(q);
      return smoothstep(0.03, 0.09, min(min(f.x, 1.0 - f.x) * 2.0, min(f.y, 1.0 - f.y)));`,
    js: (x, y) => {
      const qy = y * 2, qx = x + 0.5 * (((Math.floor(qy) % 2) + 2) % 2), fx = fract(qx), fy = fract(qy);
      return sstep(0.03, 0.09, Math.min(Math.min(fx, 1 - fx) * 2, Math.min(fy, 1 - fy)));
    },
  },
  {
    id: 'stars', name: 'Stars', density: 4, depth: 0.011, grip: 1.1, fam: 'sites', relax: true,
    words: [['Starry', 'Star-Spangled', 'Twinkly', 'Stellar'], ['Star', 'Starlight', 'Twinkle', 'Comet']],
    glsl: `vec3 nS = sfBoxN(S1.xyz), up, rt; sfFrame(nS, up, rt); vec3 dd = (P - S1.xyz) / uSp; vec2 q = vec2(dot(dd, rt), dot(dd, up)); return clamp(-sfStar(q, 0.36, 0.42) / 0.05, 0.0, 1.0);`,
    js: (x, y) => clamp(-sdStar(fract(x) - 0.5, fract(y) - 0.5, 0.36, 0.42) / 0.05, 0, 1),
  },
  {
    id: 'hearts', name: 'Hearts', density: 4, depth: 0.011, grip: 1.1, fam: 'sites', relax: true,
    words: [['Lovey', 'Sweetheart', 'Smitten', 'Adoring'], ['Heart', 'Sweetheart', 'Valentine', 'Crush']],
    glsl: `vec3 nS = sfBoxN(S1.xyz), up, rt; sfFrame(nS, up, rt); vec3 dd = (P - S1.xyz) / uSp; vec2 q = vec2(dot(dd, rt), dot(dd, up)); return clamp(-sfHeart((q + vec2(0.0, 0.3)) * 1.65) / 0.08, 0.0, 1.0);`,
    js: (x, y) => clamp(-sdHeart((fract(x) - 0.5) * 1.65, (fract(y) - 0.2) * 1.65) / 0.08, 0, 1),
  },
  {
    id: 'swirl', name: 'Swirls', density: 4, depth: 0.006, grip: 1.05, fam: 'sites', relax: true,
    words: [['Swirly', 'Whorled', 'Hypnotic', 'Spiralling'], ['Whorl', 'Swirl', 'Spiral', 'Fingerprint']],
    glsl: `vec3 nS = sfBoxN(S1.xyz), up, rt; sfFrame(nS, up, rt); vec3 dd = (P - S1.xyz) / uSp; vec2 q = vec2(dot(dd, rt), dot(dd, up)); float r = length(q); return 0.5 + 0.5 * sin(r * 40.0 + atan(q.y, q.x) * 2.0) * smoothstep(0.5, 0.36, r);`,
    js: (x, y) => {
      const ox = fract(x) - 0.5, oy = fract(y) - 0.5, d = Math.hypot(ox, oy);
      return 0.5 + 0.5 * Math.sin(d * 40 + Math.atan2(oy, ox) * 2) * sstep(0.5, 0.36, d);
    },
  },
  {
    id: 'frosted', name: 'Frosted', density: 22, depth: 0.004, rough: 0.28, grip: 1.2, fam: 'noise',
    words: [['Frosted', 'Sandblasted', 'Misty', 'Matte'], ['Frost', 'Mist', 'Sandglass', 'Haze']],
    glsl: `return sfNoise3(p) * 0.6 + sfNoise3(p * 2.0 + 7.0) * 0.4;`,
    js: (x, y) => vnoise(x, y) * 0.6 + vnoise(x * 2.3 + 9, y * 2.3 + 4) * 0.4,
  },
  {
    id: 'sponge', name: 'Sponge', density: 7, depth: 0.012, ao: 0.5, through: true, grip: 1.15, fam: 'holes',
    words: [['Spongy', 'Aerated', 'Porous', 'Bubbly'], ['Sponge', 'Aero', 'Pumice', 'Coral']],
    glsl: 'return sfHoles(p, 0.85, 0.12, 0.32);',
    js: holes(0.85, 0.12, 0.32),
    holes: [0.85, 0.12, 0.32],
  },
];
export const SURFACE = Object.fromEntries(SURFACES.map((s, i) => [s.id, { ...s, kind: i }]));
export const surfaceOf = (id) => SURFACE[id] || SURFACE.none;

// Its cells across a face and up it, for a density (cells across): a whole
// number of its repeats each way, if it has a form (one that's the same both
// ways - a grid - the same number both ways, so it meets the top round
// every edge too); else as asked.
export function surfaceFit(s, density) {
  const d = Math.max(0.5, density);
  if (!s.period) return [d, d];
  const [pu, pv] = s.period, fit = (p) => Math.max(p, Math.round(d / p) * p);
  const nu = fit(pu);
  return [nu, !pv ? nu : pv === pu ? nu : fit(pv)];
}

// ---------------------------------------------------------------- the sites
// Points spread over a rounded cube's own surface (half its size hs, its
// rounding b), spacing sp apart: thrown at random, evenly by area, no two
// nearer than minD of it; relaxed, pushed apart till they're evened out into
// cells all but every one six-sided, flat faces and rounded edges and
// corners alike: a honeycomb, a golf ball's dimples, a sheet of bubble wrap,
// all the way round. Seeded:
// the same cube, the same pattern. Float32Array [x, y, z, a random 0..1] a
// site.
function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// (a point on the surface, uniform by area; and the nearest point on it to p)
function boxSurface(hs, b) {
  const fl = hs - b, aF = 4 * fl * fl, aE = (Math.PI * b) / 2 * 2 * fl, aC = (Math.PI * b * b) / 2;
  const tot = 6 * aF + 12 * aE + 8 * aC;
  const sample = (rnd, o) => {
    let r = rnd() * tot;
    if (r < 6 * aF) {
      const f = Math.min(5, Math.floor(r / aF)), a = f >> 1, sg = f & 1 ? -1 : 1;
      o[a] = sg * hs;
      o[(a + 1) % 3] = (rnd() * 2 - 1) * fl;
      o[(a + 2) % 3] = (rnd() * 2 - 1) * fl;
      return o;
    }
    r -= 6 * aF;
    if (r < 12 * aE) {
      const e = Math.min(11, Math.floor(r / aE)), c = e % 3, q = e / 3 | 0, a = (c + 1) % 3, a2 = (c + 2) % 3;
      const th = rnd() * Math.PI * 0.5;
      o[a] = (q & 1 ? -1 : 1) * (fl + b * Math.cos(th));
      o[a2] = (q & 2 ? -1 : 1) * (fl + b * Math.sin(th));
      o[c] = (rnd() * 2 - 1) * fl;
      return o;
    }
    const k = Math.floor(rnd() * 8), z = rnd(), ph = rnd() * Math.PI * 0.5, rr = Math.sqrt(1 - z * z);
    const n = [rr * Math.cos(ph), rr * Math.sin(ph), z];
    for (let c = 0; c < 3; c++) o[c] = (k & (1 << c) ? -1 : 1) * (fl + b * n[c]);
    return o;
  };
  const project = (p, o) => {
    const q = [0, 1, 2].map((c) => Math.max(-fl, Math.min(fl, p[c])));
    const d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]], l = Math.hypot(...d);
    if (l > 1e-9 && b > 1e-9) {
      for (let c = 0; c < 3; c++) o[c] = q[c] + (d[c] / l) * b;
      return o;
    }
    // (inside the core: out the nearest face)
    let a = 0;
    for (let c = 1; c < 3; c++) if (Math.abs(p[c]) > Math.abs(p[a])) a = c;
    for (let c = 0; c < 3; c++) o[c] = c === a ? Math.sign(p[a] || 1) * hs : Math.max(-fl, Math.min(fl, p[c]));
    return o;
  };
  return { sample, project, area: tot };
}

// (the point of face f - 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z - at (u, v) on
// it, unfolded: as the bake's sfUnfoldInv has it)
export function unfoldInv(hs, b, f, u, v, o = [0, 0, 0]) {
  const fl = hs - b, eu = Math.abs(u) - fl, ev = Math.abs(v) - fl, bb = Math.max(b, 1e-6);
  const tu = eu > 0 ? Math.tan(Math.min(eu / bb, Math.PI / 4)) : 0, tv = ev > 0 ? Math.tan(Math.min(ev / bb, Math.PI / 4)) : 0;
  const nx = Math.sign(u) * tu, ny = Math.sign(v) * tv, l = Math.hypot(nx, ny, 1);
  const px = (eu > 0 ? Math.sign(u) * fl : u) + (b * nx) / l, py = (ev > 0 ? Math.sign(v) * fl : v) + (b * ny) / l, pz = fl + b / l;
  // (local: u, v, out - into the cube's own axes, face by face)
  if (f === 0) (o[0] = pz), (o[1] = py), (o[2] = -px);
  else if (f === 1) (o[0] = -pz), (o[1] = py), (o[2] = px);
  else if (f === 2) (o[0] = px), (o[1] = pz), (o[2] = -py);
  else if (f === 3) (o[0] = px), (o[1] = -pz), (o[2] = py);
  else if (f === 4) (o[0] = px), (o[1] = py), (o[2] = pz);
  else (o[0] = -px), (o[1] = py), (o[2] = -pz);
  return o;
}

const siteCache = new Map();
export function surfaceSites(hs, b, sp, { relax = false, minD = 0.5, seed = 1, iters = 24, step0 = 0.25, step1 = 0.04 } = {}) {
  const key = [hs, b, sp, relax, minD, seed, iters, step0, step1].map((v) => (typeof v === 'number' ? v.toFixed(5) : v)).join('|');
  if (siteCache.has(key)) return siteCache.get(key);
  const rnd = mulberry(seed * 9973 + 17), S = boxSurface(hs, Math.max(b, 1e-5));
  // (as many as there's room for: one to a hexagon of the spacing, or a square of it)
  const want = Math.max(4, Math.round(S.area / (sp * sp * (relax ? 0.866 : 1))));
  const md = (relax ? 0.72 : minD) * sp, md2 = md * md, cell = Math.max(md, 0.56 * sp);
  const grid = new Map(), key3 = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const pts = [], p = [0, 0, 0];
  const near = (x, y, z, r2) => {
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell), ck = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++)
          for (const q of grid.get(`${ci + i},${cj + j},${ck + k}`) || []) {
            const dx = pts[q * 4] - x, dy = pts[q * 4 + 1] - y, dz = pts[q * 4 + 2] - z;
            if (dx * dx + dy * dy + dz * dz < r2) return true;
          }
    return false;
  };
  const add = (p) => {
    const id = pts.length / 4, k = key3(p[0], p[1], p[2]);
    (grid.get(k) || grid.set(k, []).get(k)).push(id);
    pts.push(p[0], p[1], p[2], rnd());
  };
  if (relax) {
    // a honeycomb's start: each face a hexagonal lattice, a whole number of
    // cells across, in rows along it (the four sides one unbroken band of
    // it), and where faces meet, any too near one already there left out -
    // evened out below, so the cells carry on round every edge and corner
    const bb = Math.max(b, 1e-5), L = 2 * hs - bb * (2 - Math.PI / 2);
    const m = Math.max(1, Math.round(L / sp)), au = L / m, r = Math.max(1, Math.round(L / (au * SQRT3 * 0.5))), av = L / r;
    for (let f = 0; f < 6; f++)
      for (let j = 0; j < r; j++)
        for (let i = 0; i < m; i++) {
          unfoldInv(hs, bb, f, -L / 2 + (i + 0.5 + 0.5 * (j & 1)) * au, -L / 2 + (j + 0.5) * av, p);
          if (!near(p[0], p[1], p[2], 0.3 * sp * sp)) add(p);
        }
  } else
    for (let tries = 0; tries < want * 30 && pts.length / 4 < want; tries++) {
      S.sample(rnd, p);
      if (!near(p[0], p[1], p[2], md2)) add(p);
    }
  const n = pts.length / 4;
  if (relax && n > 3) {
    // evened out: each pushed off its neighbours a little at a time (only
    // the nearest ring reaches), back onto the surface, the pushes easing
    // off - settled into all but hexagons, the few that can't be (a cube's
    // corners need their pentagons, as a football's do) where they fall
    const R = 1.25 * sp, cell = R, g0 = -hs - cell, G = Math.ceil((2 * hs + 2 * cell) / cell) + 1, G3 = G * G * G;
    const start = new Int32Array(G3 + 1), idx = new Int32Array(n), cid = new Int32Array(n);
    const P = new Float64Array(n * 3), N = new Float64Array(n * 3), q3 = [0, 0, 0];
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) P[i * 3 + c] = pts[i * 4 + c];
    const cof = (x) => Math.min(G - 1, Math.max(0, Math.floor((x - g0) / cell)));
    for (let it = 0; it < iters; it++) {
      const step = sp * (step0 + ((step1 - step0) * it) / Math.max(1, iters - 1));
      start.fill(0);
      for (let i = 0; i < n; i++) start[(cid[i] = (cof(P[i * 3 + 2]) * G + cof(P[i * 3 + 1])) * G + cof(P[i * 3])) + 1]++;
      for (let c = 0; c < G3; c++) start[c + 1] += start[c];
      const at = start.slice(0, G3);
      for (let i = 0; i < n; i++) idx[at[cid[i]]++] = i;
      for (let i = 0; i < n; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], cx = cof(x), cy = cof(y), cz = cof(z);
        let fx = 0, fy = 0, fz = 0;
        for (let c = Math.max(0, cz - 1); c <= Math.min(G - 1, cz + 1); c++)
          for (let bb = Math.max(0, cy - 1); bb <= Math.min(G - 1, cy + 1); bb++)
            for (let a = Math.max(0, cx - 1); a <= Math.min(G - 1, cx + 1); a++) {
              const cc = (c * G + bb) * G + a;
              for (let t = start[cc]; t < start[cc + 1]; t++) {
                const q = idx[t];
                if (q === i) continue;
                const dx = x - P[q * 3], dy = y - P[q * 3 + 1], dz = z - P[q * 3 + 2], d2 = dx * dx + dy * dy + dz * dz;
                if (d2 >= R * R || d2 < 1e-18) continue;
                const d = Math.sqrt(d2), w = (1 - d / R) ** 2 / d;
                fx += dx * w; fy += dy * w; fz += dz * w;
              }
            }
        // (never more than a quarter of the spacing a step)
        const m = Math.hypot(fx, fy, fz) * step, k = m > 0.25 * sp ? (0.25 * sp) / m : 1;
        S.project([x + fx * step * k, y + fy * step * k, z + fz * step * k], q3);
        N[i * 3] = q3[0]; N[i * 3 + 1] = q3[1]; N[i * 3 + 2] = q3[2];
      }
      P.set(N);
    }
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) pts[i * 4 + c] = P[i * 3 + c];
  }
  const out = Float32Array.from(pts);
  siteCache.set(key, out);
  if (siteCache.size > 24) siteCache.delete(siteCache.keys().next().value);
  return out;
}

// ---------------------------------------------------------------- the bake
// Every surface map but the holes is baked, a cube at a time, onto that
// cube's own surface: six squares of it, a face each, each running from the
// middle of the rounded edge on one side to the middle of the one opposite
// (L across; see sfFaceUV) - its height at every point of it, worked out
// where that point really is on the rounded cube (P, its normal n). What's
// drawn reads it back: one look a height, seamless, whatever the rounding.
// (uniforms: see JellyView._bakeCube. A cube's bake has only its own
// pattern in it - surfaceBakeGLSL(its kind) - a small shader, quick to
// compile; SURF_BAKE_GLSL has them all.)
export function surfaceBakeGLSL(only = -1) {
  const has = (i) => only < 0 || i === only;
  return /* glsl */ `
  uniform int uKind;
  uniform float uHS, uB, uL, uSp;
  uniform int uTrim; // (its edges' trim: styles.js TRIMS - 0 none)
  uniform float uTrimN, uTrimW, uSfScale; // (its repeats an edge, its band's width; the surface's depth as a share of the map's)
  uniform vec2 uNN;
  uniform highp sampler2D uSites;
  uniform highp sampler2D uGrid;
  uniform int uSitesW, uGridW;
  uniform vec3 uGridMin;
  uniform float uGridCell;
  uniform ivec3 uGridDim;
  vec2 sfH22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }
  float sfH31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float sfNoise3(vec3 p) {
    vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(sfH31(i), sfH31(i + vec3(1, 0, 0)), u.x), mix(sfH31(i + vec3(0, 1, 0)), sfH31(i + vec3(1, 1, 0)), u.x), u.y),
               mix(mix(sfH31(i + vec3(0, 0, 1)), sfH31(i + vec3(1, 0, 1)), u.x), mix(sfH31(i + vec3(0, 1, 1)), sfH31(i + vec3(1, 1, 1)), u.x), u.y), u.z);
  }
  float sfStar(vec2 p, float r, float rf) {
    const vec2 k1 = vec2(0.809016994375, -0.587785252292), k2 = vec2(-0.809016994375, -0.587785252292);
    p.x = abs(p.x);
    p -= 2.0 * max(dot(k1, p), 0.0) * k1;
    p -= 2.0 * max(dot(k2, p), 0.0) * k2;
    p.x = abs(p.x);
    p.y -= r;
    vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
    float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
    return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
  }
  float sfHeart(vec2 p) {
    p.x = abs(p.x);
    if (p.y + p.x > 1.0) return length(p - vec2(0.25, 0.75)) - 0.35355339;
    vec2 m = p - 0.5 * max(p.x + p.y, 0.0);
    return sqrt(min(dot(p - vec2(0.0, 1.0), p - vec2(0.0, 1.0)), dot(m, m))) * sign(p.x - p.y);
  }
  // (the point of face f - 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z - at (u, v) on
  // it, unfolded, and the way out there: as sfFaceUV has them, the other way)
  void sfUnfoldInv(int f, vec2 uv, out vec3 P, out vec3 n) {
    float fl = uHS - uB;
    float eu = abs(uv.x) - fl, ev = abs(uv.y) - fl;
    float tu = eu > 0.0 ? tan(min(eu / max(uB, 1e-6), 0.785398)) : 0.0, tv = ev > 0.0 ? tan(min(ev / max(uB, 1e-6), 0.785398)) : 0.0;
    vec3 nl = normalize(vec3(sign(uv.x) * tu, sign(uv.y) * tv, 1.0));
    vec3 cl = vec3(eu > 0.0 ? sign(uv.x) * fl : uv.x, ev > 0.0 ? sign(uv.y) * fl : uv.y, fl);
    vec3 pl = cl + uB * nl;
    // (local: u, v, out - into the cube's own axes, face by face)
    if (f == 0) { P = vec3(pl.z, pl.y, -pl.x); n = vec3(nl.z, nl.y, -nl.x); }
    else if (f == 1) { P = vec3(-pl.z, pl.y, pl.x); n = vec3(-nl.z, nl.y, nl.x); }
    else if (f == 2) { P = vec3(pl.x, pl.z, -pl.y); n = vec3(nl.x, nl.z, -nl.y); }
    else if (f == 3) { P = vec3(pl.x, -pl.z, pl.y); n = vec3(nl.x, -nl.z, nl.y); }
    else if (f == 4) { P = vec3(pl.x, pl.y, pl.z); n = vec3(nl.x, nl.y, nl.z); }
    else { P = vec3(-pl.x, pl.y, -pl.z); n = vec3(-nl.x, nl.y, -nl.z); }
  }
  // (the rings' way round: s round the four sides - front, right, back,
  // left, 4L - and t up them; over the top and bottom edges t carries on in
  // to their middles, each quarter of them its own side's - mitred)
  vec2 sfRing(int f, vec2 uv) {
    float L = uL;
    if (f == 4) return uv;
    if (f == 0) return vec2(L + uv.x, uv.y);
    if (f == 5) return vec2(2.0 * L + uv.x, uv.y);
    if (f == 1) return vec2(3.0 * L + uv.x, uv.y);
    float m = max(abs(uv.x), abs(uv.y)), t = L - m, s;
    bool top = f == 2;
    if (abs(uv.y) >= abs(uv.x)) {
      bool front = top ? uv.y < 0.0 : uv.y > 0.0;
      s = front ? uv.x : 2.0 * L - uv.x;
    } else {
      bool right = uv.x > 0.0;
      s = right ? (top ? L + uv.y : L - uv.y) : (top ? 3.0 * L - uv.y : 3.0 * L + uv.y);
    }
    return vec2(s, top ? t : -t);
  }
  // (a site's own way up and across: up the cube on its sides, away from the
  // front on its top, toward it underneath - as a googly eye's)
  void sfFrame(vec3 n, out vec3 up, out vec3 right) {
    up = abs(n.y) > 0.8 ? vec3(0.0, 0.0, n.y > 0.0 ? -1.0 : 1.0) : vec3(0.0, 1.0, 0.0);
    up = normalize(up - n * dot(up, n));
    right = cross(up, n);
  }
  vec3 sfBoxN(vec3 p) {
    float fl = uHS - uB;
    vec3 d = p - clamp(p, -fl, fl);
    if (dot(d, d) > 1e-12) return normalize(d);
    vec3 a = abs(p);
    return a.x > a.y && a.x > a.z ? vec3(sign(p.x), 0.0, 0.0) : a.y > a.z ? vec3(0.0, sign(p.y), 0.0) : vec3(0.0, 0.0, sign(p.z));
  }
  float sfGrid(int k, vec2 p) {
    ${SURFACES.map((x, i) => (x.fam === 'grid' && has(i) ? `if (k == ${i}) { ${x.glsl} }` : '')).filter(Boolean).join('\n    ')}
    return 1.0;
  }
  float sfRings(int k, vec2 p) {
    ${SURFACES.map((x, i) => (x.fam === 'rings' && has(i) ? `if (k == ${i}) { ${x.glsl} }` : '')).filter(Boolean).join('\n    ')}
    return 1.0;
  }
  // The sites near P (the grid of them: a cell the spacing a side, up to 8
  // sites a cell) - the nearest two, and what each pattern makes of them
  float sfSites(int k, vec3 P) {
    vec3 g = (P - uGridMin) / uGridCell;
    ivec3 c0 = ivec3(floor(g));
    float F1 = 9.0, F2 = 9.0, bowl = 1.0, rims = 0.0, wave = 0.0;
    vec4 S1 = vec4(0.0);
    for (int dz = -1; dz <= 1; dz++)
      for (int dy = -1; dy <= 1; dy++)
        for (int dx = -1; dx <= 1; dx++) {
          ivec3 c = c0 + ivec3(dx, dy, dz);
          if (any(lessThan(c, ivec3(0))) || any(greaterThanEqual(c, uGridDim))) continue;
          int ci = ((c.z * uGridDim.y + c.y) * uGridDim.x + c.x) * 2;
          for (int t = 0; t < 2; t++) {
            int ti = ci + t;
            vec4 ids = texelFetch(uGrid, ivec2(ti % uGridW, ti / uGridW), 0);
            for (int q = 0; q < 4; q++) {
              float id = ids[q];
              if (id < 0.0) break;
              int si = int(id + 0.5);
              vec4 S = texelFetch(uSites, ivec2(si % uSitesW, si / uSitesW), 0);
              float d = length(P - S.xyz) / uSp;
              if (d < F1) { F2 = F1; F1 = d; S1 = S; } else if (d < F2) F2 = d;
              ${SURFACES.map((x, i) => (x.fam === 'sites' && x.each && has(i) ? `if (k == ${i}) { ${x.each} }` : '')).filter(Boolean).join('\n              ')}
            }
          }
        }
    ${SURFACES.map((x, i) => (x.fam === 'sites' && has(i) ? `if (k == ${i}) { ${x.glsl} }` : '')).filter(Boolean).join('\n    ')}
    return 1.0;
  }
  float sfNoiseK(int k, vec3 p) {
    ${SURFACES.map((x, i) => (x.fam === 'noise' && has(i) ? `if (k == ${i}) { ${x.glsl} }` : '')).filter(Boolean).join('\n    ')}
    return 1.0;
  }
  // An edge's trim at (u, v) of face f (P: where that is on the cube): how
  // far in from the edge's middle line (where two faces' maps meet), and
  // where along it - by the cube's own axis the edge runs along, so the two
  // faces on it agree - in repeats a whole number to an edge, so they meet
  // at its corners. 1: the surface; lower: cut away, pressed in.
  float sfTrim(int f, vec2 uv, vec3 P) {
    if (uTrim == 0) return 1.0;
    float e = 0.5 * uL - max(abs(uv.x), abs(uv.y));
    if (e > uTrimW * 1.3) return 1.0;
    bool uEdge = abs(uv.x) > abs(uv.y);
    // (the face's ways across and up, as the cube's axes - see sfUnfoldInv)
    int ua = f < 2 ? 2 : 0, va = f < 2 ? 1 : f < 4 ? 2 : 1;
    int ax = uEdge ? va : ua;
    float s = ax == 0 ? P.x : ax == 1 ? P.y : P.z;
    float p = 2.0 * uHS / uTrimN, x = (fract((s + uHS) / p) - 0.5) * p, w = uTrimW;
    if (uTrim == 1) {
      // scalloped: the edge in round lobes bulging out to it, bitten in
      // between (a lobe's round its middle, the bites' points inward)
      float R = 0.6 * p, d = length(vec2(x, e - R)) - R;
      return 1.0 - smoothstep(-0.004, 0.006, d) * step(e, R);
    }
    if (uTrim == 2) {
      // sawtooth: teeth, with v-notches between
      float D = 0.85 * w * (2.0 * abs(x) / p);
      return 1.0 - (1.0 - smoothstep(-0.004, 0.006, e - D)) * step(0.0, D - 0.002);
    }
    if (uTrim == 3) {
      // stitched: a seam pressed in along it, a running stitch either side
      float crease = 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.18 * w, e));
      float ps = p / 3.0, xs = fract((s + uHS) / ps);
      float dash = smoothstep(0.08, 0.16, xs) * (1.0 - smoothstep(0.62, 0.7, xs));
      float line = 1.0 - smoothstep(0.08 * w, 0.15 * w, abs(e - 0.62 * w));
      float hole = (1.0 - smoothstep(0.03 * w, 0.07 * w, length(vec2((xs - 0.08) * ps, e - 0.62 * w)))) + (1.0 - smoothstep(0.03 * w, 0.07 * w, length(vec2((xs - 0.7) * ps, e - 0.62 * w))));
      float band = 1.0 - smoothstep(0.85 * w, w, e);
      return min(crease, mix(1.0, 0.82 + 0.18 * dash * line, band)) - 0.4 * hole * band;
    }
    if (uTrim == 4) {
      // piped: a twisted cord of it along the edge
      float r = 0.55 * w, bead = sqrt(max(0.0, 1.0 - (e * e) / (r * r)));
      float twist = 0.5 + 0.5 * cos(6.2831853 * (x / (0.5 * p) + e / r * 0.7));
      return e < r ? 0.55 + 0.45 * bead * (0.72 + 0.28 * twist) : mix(0.55, 1.0, smoothstep(r, r + 0.25 * w, e));
    }
    if (uTrim == 5) {
      // beaded: a string of beads
      float rb = 0.48 * p, q = length(vec2(x, e)) / rb;
      return q < 1.0 ? 0.45 + 0.55 * sqrt(1.0 - q * q) : mix(0.45, 1.0, smoothstep(0.0, 0.3 * w, e - rb));
    }
    // crimped: a pie crust's flutes, across it
    float pc = p / 2.0, fl = 0.5 + 0.5 * cos(6.2831853 * x / pc);
    return 1.0 - 0.55 * (1.0 - fl) * (1.0 - smoothstep(0.55 * w, w, e));
  }
  // its height at (u, v) of face f
  float sfBake(int k, int f, vec2 uv) {
    vec3 P, n;
    sfUnfoldInv(f, uv, P, n);
    ${SURFACES.map((x, i) => (!has(i) ? '' : x.fam === 'grid' ? `if (k == ${i}) return sfGrid(k, (uv / uL + 0.5) * uNN);` : x.fam === 'rings' ? `if (k == ${i}) return sfRings(k, sfRing(f, uv) * (uNN.x / uL));` : x.fam === 'sites' ? `if (k == ${i}) return sfSites(k, P);` : x.fam === 'noise' ? `if (k == ${i}) return sfNoiseK(k, P * (uNN.x / uL));` : '')).filter(Boolean).join('\n    ')}
    return 1.0;
  }
`;
}
export const SURF_BAKE_GLSL = surfaceBakeGLSL();

export const SURF_GLSL = /* glsl */ `
  // (which kinds this shader draws: a face's baked map (SF_FACES), holes all
  // through (SF_HOLES) - a shader that picks defines SF_PICK and those it
  // wants first; else both. Each one's code, compiled in but not used, still
  // made the jelly's every pixel slower)
  #ifndef SF_PICK
  #define SF_FACES
  #define SF_HOLES
  #endif
  // (every cube's surface map, baked onto it: six layers a cube, a face each
  // - see JellyView._bakeCube)
  uniform highp sampler2DArray uSurfAtlas;
  #ifdef SF_HOLES
  vec4 sfH34(vec3 p) {
    vec4 p4 = fract(vec4(p.xyzx) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
    p4 += dot(p4, p4.wzxy + 33.33);
    return fract((p4.xxyz + p4.yzzw) * p4.zywx);
  }
  // holes all through: spheres, some cells without, each its own size (the
  // cell and its neighbours on this side are all that can reach here)
  float sfHoles(vec3 p, float prob, float r0, float r1) {
    vec3 c = floor(p), f = fract(p), s = step(0.5, f) * 2.0 - 1.0;
    float h = 1.0;
    for (int n = 0; n < 8; n++) {
      vec3 o = vec3(float(n & 1), float((n >> 1) & 1), float((n >> 2) & 1)) * s;
      vec4 r = sfH34(c + o);
      if (r.w > prob) continue;
      float rad = r0 + (r1 - r0) * fract(r.w * 7.13);
      vec3 d = f - (o + 0.22 + 0.56 * r.xyz);
      float u2 = dot(d, d) / (rad * rad);
      if (u2 < 1.0) h = min(h, 1.0 - sqrt(1.0 - u2));
    }
    return h;
  }
  #endif
  // A rest point's place on the cube unfolded: which face it's on, and how
  // far along that face each way - round a bevel by its arc - so a pattern
  // laid on it carries on round an edge onto the next face (a face's own
  // stretch runs to the middle of each bevel round it). hs: half the cube's
  // size; b: its rounding (m).
  float sfUnf(float c, float nc, float nf, float fl, float b) {
    float ac = abs(c), arc = fl + b * atan(abs(nc), max(abs(nf), 1e-6));
    return sign(c) * mix(ac, arc, step(fl, ac));
  }
  vec3 sfFaceUV(vec3 r, float hs, float b) {
    float fl = hs - b;
    vec3 n = sign(r) * max(abs(r) - fl, 0.0);
    if (dot(n, n) < 1e-14) {
      vec3 a = abs(r);
      n = a.x > a.y && a.x > a.z ? vec3(sign(r.x), 0.0, 0.0) : a.y > a.z ? vec3(0.0, sign(r.y), 0.0) : vec3(0.0, 0.0, sign(r.z));
    }
    vec3 an = abs(n);
    // (each face its own way up: up the cube on its sides, away from the
    // front on its top; faces 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z - the third)
    if (an.x >= an.y && an.x >= an.z) return vec3(-sign(n.x) * sfUnf(r.z, n.z, n.x, fl, b), sfUnf(r.y, n.y, n.x, fl, b), n.x > 0.0 ? 0.0 : 1.0);
    if (an.y >= an.z) return vec3(sfUnf(r.x, n.x, n.y, fl, b), -sign(n.y) * sfUnf(r.z, n.z, n.y, fl, b), n.y > 0.0 ? 2.0 : 3.0);
    return vec3(sign(n.z) * sfUnf(r.x, n.x, n.z, fl, b), sfUnf(r.y, n.y, n.z, fl, b), n.z > 0.0 ? 4.0 : 5.0);
  }
  #ifdef SF_HOLES
  float sfVolume(int k, vec3 p);
  #endif
  // Its height at rest point r: a through one in the jelly's own space;
  // else off the cube's baked map - the face it's on, and where on it (L: a
  // face's stretch, bevel middle to bevel middle)
  float sfHeightAt(int k, bool thru, vec3 r, float hs, float b, float L, vec2 NN) {
    #ifdef SF_HOLES
    if (thru) return sfVolume(k, r * (NN.x / (2.0 * hs)));
    #endif
    #ifdef SF_FACES
    vec3 f = sfFaceUV(r, hs, b);
    return textureLod(uSurfAtlas, vec3(f.xy / L + 0.5, float(gK * 6) + f.z), 0.0).r;
    #else
    return 1.0;
    #endif
  }
  #ifdef SF_HOLES
  float sfVolume(int k, vec3 p) {
    ${SURFACES.map((s, i) => (s.glsl && s.through ? `if (k == ${i}) { ${s.glsl} }` : '')).filter(Boolean).join('\n    ')}
    return 1.0;
  }
  #endif
  bool sfThrough(int k) {
    #if defined(SF_FACES) && defined(SF_HOLES)
    return ${SURFACES.map((s, i) => (s.through ? `k == ${i}` : '')).filter(Boolean).join(' || ') || 'false'};
    #elif defined(SF_HOLES)
    return true;
    #else
    return false;
    #endif
  }

  #ifdef SF_HOLES
  // A hole's sphere round rest point p (in cells), if it's in one: its
  // centre and radius (the one it's deepest in) - as sfHoles finds them.
  bool sfHoleSph(vec3 p, float prob, float r0, float r1, out vec4 sph) {
    vec3 c = floor(p), f = fract(p), s = step(0.5, f) * 2.0 - 1.0;
    float best = 1.0;
    bool any = false;
    sph = vec4(0.0);
    for (int n = 0; n < 8; n++) {
      vec3 o = vec3(float(n & 1), float((n >> 1) & 1), float((n >> 2) & 1)) * s;
      vec4 r = sfH34(c + o);
      if (r.w > prob) continue;
      float rad = r0 + (r1 - r0) * fract(r.w * 7.13);
      vec3 ctr = o + 0.22 + 0.56 * r.xyz;
      float u2 = dot(f - ctr, f - ctr) / (rad * rad);
      if (u2 < best) { best = u2; sph = vec4(c + ctr, rad); any = true; }
    }
    return any;
  }
  bool sfHole(int k, vec3 p, out vec4 sph) {
    sph = vec4(0.0);
    ${SURFACES.map((s, i) => (s.holes ? `if (k == ${i}) return sfHoleSph(p, ${s.holes.map((v) => v.toFixed(3)).join(', ')}, sph);` : '')).filter(Boolean).join('\n    ')}
    return false;
  }
  #endif

  // A cube's surface map, its numbers worked out (q31, q28: its rows 31 and
  // 28 of the cube looks; size: the cube's): its kind, whether it's holes all
  // through, half its size, its rounding, a face's stretch from bevel middle
  // to bevel middle, how deep, its cells across and up, a cell's size.
  struct SfInfo { int k; bool thru; float hs, b, L, depth, cell; vec2 NN; };
  SfInfo sfInfo(vec4 q31, vec4 q28, float size) {
    SfInfo s;
    s.k = int(q31.x + 0.5);
    s.thru = sfThrough(s.k);
    s.hs = 0.5 * size;
    s.b = q28.w * size;
    s.L = size - s.b * (2.0 - 1.5707963);
    s.depth = q31.y;
    s.NN = q31.zw;
    s.cell = (s.thru ? size : s.L) / max(max(s.NN.x, s.NN.y), 0.25);
    return s;
  }
  float sfH(SfInfo s, vec3 r) { return sfHeightAt(s.k, s.thru, r, s.hs, s.b, s.L, s.NN); }

  // The face rest point r is on (its index, its place on it) and that
  // face's own axes in the rest space - a march straight across a flat face
  // is one along them, so it finds its face just the once (it's only made
  // on the flat: across a rounded edge it fades out - see sfOnEdge)
  struct SfFace { vec3 f; };
  SfFace sfFaceAt(SfInfo s, vec3 r) { return SfFace(sfFaceUV(r, s.hs, s.b)); }
  // (its height a short way d from there, across that face: d along the
  // face's own two ways, as sfFaceUV lays them)
  float sfHf(SfInfo s, SfFace F, vec3 d) {
    float f = F.f.z;
    vec2 a = f < 1.5 ? vec2(f < 0.5 ? -d.z : d.z, d.y) : f < 3.5 ? vec2(d.x, f < 2.5 ? -d.z : d.z) : vec2(f < 4.5 ? d.x : -d.x, d.y);
    return textureLod(uSurfAtlas, vec3((F.f.xy + a) / s.L + 0.5, float(gK * 6) + f), 0.0).r;
  }

  // How the world and the rest shape run across this pixel (dP*, dR*: the
  // world point and the rest point, each way across it; N the surface's
  // normal), worked out the once: for a world direction as a rest one (see
  // sfToRestJ), and the surface gradient's axes (see sfBendH) - the rows of
  // the inverse of the world's (dPx, dPy, N), over its determinant.
  struct SfFrame { vec3 R1, R2, R3; float id, sN; };
  SfFrame sfFrame(vec3 dRx, vec3 dRy, vec3 dPx, vec3 dPy, vec3 N) {
    SfFrame J;
    J.R1 = cross(dPy, N);
    J.R2 = cross(N, dPx);
    J.R3 = cross(dPx, dPy);
    float det = dot(dPx, J.R1);
    J.id = abs(det) < 1e-24 ? 0.0 : 1.0 / det;
    J.sN = sqrt(length(cross(dRx, dRy)) / max(length(J.R3), 1e-24));
    return J;
  }
  vec3 sfToRestJ(SfFrame J, vec3 w, vec3 dRx, vec3 dRy, vec3 Nr) {
    vec3 c = vec3(dot(J.R1, w), dot(J.R2, w), dot(J.R3, w)) * J.id;
    return dRx * c.x + dRy * c.y + Nr * (c.z * J.sN);
  }
  // Its relief bent into normal N: how much it rises across this pixel, both
  // ways (its height here, h, and a pixel along each way, hx, hy), into the
  // world as it is now - Mikkelsen's surface gradient.
  vec3 sfBendH(SfInfo s, float h, float hx, float hy, SfFrame J, vec3 N, float amt) {
    vec3 sg = ((hx - h) * J.R1 + (hy - h) * J.R2) * (s.depth * amt * J.id);
    float sl = length(sg);
    if (sl > 1.5) sg *= 1.5 / sl;
    return normalize(N - sg);
  }
  // ...its heights here and a pixel along each way found afresh (r the rest
  // point, dR* how it runs across the pixel): h its height here.
  vec3 sfBend(SfInfo s, vec3 r, vec3 dRx, vec3 dRy, vec3 dPx, vec3 dPy, vec3 N, float amt, out float h) {
    h = sfH(s, r);
    return sfBendH(s, h, sfH(s, r + dRx), sfH(s, r + dRy), sfFrame(dRx, dRy, dPx, dPy, N), N, amt);
  }

  // The rest shape's own normal here, outward (the way the world's N is):
  // and a world direction w as a rest one - how the surface runs across the
  // pixel both ways, and along its normal, stretched as the surface is.
  vec3 sfRestN(vec3 dRx, vec3 dRy, vec3 dPx, vec3 dPy, vec3 N) {
    vec3 n = cross(dRx, dRy);
    float l = length(n);
    if (l < 1e-24) return vec3(0.0, 0.0, 1.0);
    return n / l * (dot(cross(dPx, dPy), N) < 0.0 ? -1.0 : 1.0);
  }
  vec3 sfToRest(vec3 w, vec3 dRx, vec3 dRy, vec3 dPx, vec3 dPy, vec3 N, vec3 Nr) {
    mat3 Mw = mat3(dPx, dPy, N);
    if (abs(determinant(Mw)) < 1e-24) return vec3(0.0);
    vec3 c = inverse(Mw) * w;
    float sN = sqrt(length(cross(dRx, dRy)) / max(length(cross(dPx, dPy)), 1e-24));
    return dRx * c.x + dRy * c.y + Nr * (c.z * sN);
  }

  // ...and a rest one (a short way, from here) as a world one
  vec3 sfToWorld(vec3 v, vec3 dRx, vec3 dRy, vec3 dPx, vec3 dPy, vec3 N, vec3 Nr) {
    mat3 Mr = mat3(dRx, dRy, Nr);
    if (abs(determinant(Mr)) < 1e-24) return v;
    vec3 c = inverse(Mr) * v;
    float sN = sqrt(length(cross(dRx, dRy)) / max(length(cross(dPx, dPy)), 1e-24));
    return dPx * c.x + dPy * c.y + N * (c.z / max(sN, 1e-6));
  }

  // Parallax: where the line of sight (Vr, toward the eye, rest space) really
  // meets the relief - its top's at the surface - marched down into it in
  // steps, and the crossing between the last two narrowed down; the rest
  // point there. (Too grazing to go far: held to four times its depth across.)
  vec3 sfParallax(SfInfo s, SfFace F, vec3 r, float h0, vec3 Vr, vec3 Nr, int steps) {
    if (h0 > 0.999) return r;
    float cv = max(dot(Vr, Nr), 0.25);
    vec3 dir = -(Vr - Nr * dot(Vr, Nr)) / cv - Nr;
    float dd = s.depth / float(steps);
    float prevGap = -(1.0 - h0) * s.depth;
    vec3 prev = r;
    for (int i = 1; i <= 16; i++) {
      if (i > steps) break;
      float z = dd * float(i);
      vec3 p = r + dir * z;
      float gap = z - (1.0 - sfHf(s, F, dir * z)) * s.depth;
      if (gap >= 0.0) return mix(prev, p, prevGap / (prevGap - gap));
      prev = p;
      prevGap = gap;
    }
    return prev;
  }

  // (whether r is on the flat of F's face, m clear of its rounded edges:
  // there the face's own two ways are its mapping - sfHf's look-ups are
  // exact, no need to find the face afresh)
  bool sfOnFlat(SfInfo s, SfFace F, vec3 r, float m) {
    vec3 q = step(s.hs - s.b - m, abs(r));
    float f = F.f.z, own = f < 1.5 ? q.x : f < 3.5 ? q.y : q.z;
    return q.x + q.y + q.z < 1.5 && own > 0.5;
  }

  // (how far onto a rounded edge r is, 0..1: out of its middle - round a
  // bevel the faces' mapping turns the corner, and the march into it with it)
  float sfOnEdge(SfInfo s, vec3 r) {
    vec3 q = max(abs(r) - (s.hs - s.b), 0.0);
    float mid = q.x + q.y + q.z - max(q.x, max(q.y, q.z)) - min(q.x, min(q.y, q.z));
    return smoothstep(0.0, 0.35 * s.b + 1e-5, mid);
  }

  // ...and whether the key light (Lr, rest space) reaches the point o from
  // where F was found, h its height, past the relief round it: 1 lit,
  // toward 0 in its shadow.
  float sfShadow(SfInfo s, SfFace F, vec3 o, float h, vec3 Lr, vec3 Nr) {
    float cl = dot(Lr, Nr), z0 = (1.0 - h) * s.depth;
    if (cl <= 0.02 || z0 < 1e-5) return 1.0;
    vec3 dir = (Lr - Nr * cl) / max(cl, 0.2);
    float lit = 1.0;
    for (int i = 1; i <= 4; i++) {
      float z = z0 * (1.0 - float(i) / 4.5);
      float gap = z - (1.0 - sfHf(s, F, o + dir * (z0 - z))) * s.depth;
      lit = min(lit, 1.0 - smoothstep(0.0, 0.25 * s.depth, gap));
    }
    return lit;
  }
`;

// Its height in a swatch's plane (a through one: a slice of it).
export function surfaceHeight(id, x, y) {
  const s = surfaceOf(id);
  if (!s.js) return 1;
  return s.through ? s.js(x, y, 0.37) : s.js(x, y);
}

// A swatch: a little square of it, lit from the top left, in the jelly's
// colour (an image URL; made once a surface and a colour).
const swatches = new Map();
export function surfaceSwatch(id, hex = '#d4102a', px = 76) {
  const key = id + hex + px;
  if (swatches.has(key)) return swatches.get(key);
  const s = surfaceOf(id);
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const g = cv.getContext('2d'), img = g.createImageData(px, px);
  const n = parseInt(hex.slice(1), 16), base = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((c) => 0.25 + 0.75 * c);
  // (about two cells across, the fine ones more)
  const span = Math.max(1.6, Math.min(5, (s.density || 4) / 2.4)), step = span / px, e = step;
  const k = (s.depth || 0.006) / (1 / (s.density || 4)) * 9; // (its slopes, made visible at this size)
  const L = [-0.5, 0.62, 0.6], ll = Math.hypot(...L);
  for (let j = 0; j < px; j++)
    for (let i = 0; i < px; i++) {
      const x = i * step + 0.13, y = (px - j) * step + 0.29;
      const h = surfaceHeight(id, x, y), hx = (surfaceHeight(id, x + e, y) - h) / e, hy = (surfaceHeight(id, x, y + e) - h) / e;
      let nx = -hx * k, ny = -hy * k, nz = 1;
      const nl = Math.hypot(nx, ny, nz);
      nx /= nl; ny /= nl; nz /= nl;
      const dif = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / ll);
      // (a highlight: the light bounced toward the eye, straight out)
      const rz = 2 * dif * nz - L[2] / ll, spec = Math.pow(Math.max(0, rz), 24) * 0.45;
      const ao = 1 - (s.ao || 0) * (1 - clamp(h, 0, 1)) * 0.8;
      const o = (j * px + i) * 4;
      for (let c = 0; c < 3; c++) img.data[o + c] = Math.round(255 * clamp((base[c] * (0.32 + 0.78 * dif) * ao + spec), 0, 1));
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const url = cv.toDataURL();
  swatches.set(key, url);
  return url;
}

// (a word for a cube's summary)
export const surfaceWord = (id) => (id && id !== 'none' && SURFACE[id] ? SURFACE[id].name : '');
