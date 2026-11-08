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
// period (one that has a form - a grid, hexes, rows - repeats this often
// across and up, in cells: a face holds a whole number of repeats, each
// face's start where the next one's ends, so a hex cut by an edge meets its
// other half round it - see surfaceFit), through, glsl (its height at vec2 p
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
    id: 'swiss', name: 'Swiss cheese', density: 3.4, depth: 0.03, ao: 0.6, through: true, grip: 1.0,
    words: [['Holey', 'Swiss', 'Cheesy', 'Pitted'], ['Cheese', 'Emmental', 'Swiss', 'Holes']],
    glsl: 'return sfHoles(p, 0.72, 0.16, 0.46);',
    js: holes(0.72, 0.16, 0.46),
    holes: [0.72, 0.16, 0.46],
  },
  {
    id: 'diamond', name: 'Diamond plate', density: 6, depth: 0.01, rough: 0.04, period: [2, 2], grip: 1.45,
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
    id: 'hammered', name: 'Hammered', density: 6, depth: 0.011, ao: 0.25, rough: 0.03, grip: 1.1,
    words: [['Hammered', 'Beaten', 'Dimpled', 'Forged'], ['Pewter', 'Anvil', 'Smithy', 'Tankard']],
    glsl: 'vec2 v = sfVor(p); return min(1.0, v.x * v.x * 2.4);',
    js: (x, y) => Math.min(1, vor(x, y)[0] ** 2 * 2.4),
  },
  {
    id: 'waffle', name: 'Waffle', density: 5, depth: 0.012, ao: 0.45, period: [1, 1], grip: 1.25,
    words: [['Waffled', 'Gridded', 'Toasted', 'Syrupy'], ['Waffle', 'Griddle', 'Brunch', 'Grid']],
    glsl: 'vec2 f = abs(fract(p) - 0.5); return smoothstep(0.3, 0.4, max(f.x, f.y));',
    js: (x, y) => sstep(0.3, 0.4, Math.max(Math.abs(fract(x) - 0.5), Math.abs(fract(y) - 0.5))),
  },
  {
    id: 'bubblewrap', name: 'Bubble wrap', density: 6, depth: 0.016, period: [1, SQRT3], grip: 1.15,
    words: [['Poppable', 'Bubbly', 'Padded', 'Fragile'], ['Bubble Wrap', 'Popper', 'Parcel', 'Packing']],
    glsl: 'float d = length(sfHex(p)) / 0.36; return d < 1.0 ? sqrt(1.0 - d * d) : 0.0;',
    js: (x, y) => {
      const d = Math.hypot(...hexOff(x, y)) / 0.36;
      return d < 1 ? Math.sqrt(1 - d * d) : 0;
    },
  },
  {
    id: 'scales', name: 'Scales', density: 6, depth: 0.014, ao: 0.3, period: [1, 4 / 3], grip: 0.92,
    words: [['Scaly', 'Draconic', 'Armoured', 'Fishy'], ['Dragon', 'Wyrm', 'Mermaid', 'Scales']],
    // (rows of discs, each covering the top of the row below: the highest one
    // here is on top; its lower edge stands proud)
    glsl: `vec2 q = vec2(p.x, p.y * 1.5);
      float row = floor(q.y);
      for (int r = 1; r >= -1; r--) {
        float j = row + float(r), sx = q.x + 0.5 * mod(j, 2.0), cx = floor(sx) + 0.5;
        float d = min(length(vec2(sx - cx, q.y - j - 1.05)), length(vec2(sx - cx - sign(sx - cx), q.y - j - 1.05)));
        if (d < 0.72) return 0.25 + 0.75 * d / 0.72;
      }
      return 0.0;`,
    js: (x, y) => {
      const qy = y * 1.5, row = Math.floor(qy);
      for (let r = 1; r >= -1; r--) {
        const j = row + r, sx = x + 0.5 * (((j % 2) + 2) % 2), cx = Math.floor(sx) + 0.5;
        const d = Math.min(Math.hypot(sx - cx, qy - j - 1.05), Math.hypot(sx - cx - Math.sign(sx - cx), qy - j - 1.05));
        if (d < 0.72) return 0.25 + (0.75 * d) / 0.72;
      }
      return 0;
    },
  },
  {
    id: 'honeycomb', name: 'Honeycomb', density: 5, depth: 0.01, ao: 0.4, period: [1, SQRT3], grip: 1.2,
    words: [['Honeycombed', 'Waxy', 'Hexed', 'Buzzing'], ['Hive', 'Honeycomb', 'Comb', 'Apiary']],
    glsl: 'vec2 o = abs(sfHex(p)); return smoothstep(0.4, 0.47, max(dot(o, vec2(0.5, 0.8660254)), o.x));',
    js: (x, y) => {
      const [ox, oy] = hexOff(x, y).map(Math.abs);
      return sstep(0.4, 0.47, Math.max(ox * 0.5 + oy * 0.8660254, ox));
    },
  },
  {
    id: 'studs', name: 'Brick studs', density: 4, depth: 0.016, period: [1, 1], grip: 1.3,
    words: [['Studded', 'Snap-Together', 'Toy', 'Clicky'], ['Brick', 'Block', 'Studs', 'Builder']],
    glsl: 'return smoothstep(0.33, 0.3, length(fract(p) - 0.5));',
    js: (x, y) => sstep(0.33, 0.3, Math.hypot(fract(x) - 0.5, fract(y) - 0.5)),
  },
  {
    id: 'golf', name: 'Golf ball', density: 9, depth: 0.005, ao: 0.3, period: [1, SQRT3], grip: 0.95,
    words: [['Dimpled', 'Teed-Up', 'Fore', 'Clubhouse'], ['Golf Ball', 'Birdie', 'Tee', 'Hole-in-One']],
    glsl: 'float d = length(sfHex(p)) / 0.47; return d < 1.0 ? 1.0 - sqrt(1.0 - d * d) : 1.0;',
    js: (x, y) => {
      const d = Math.hypot(...hexOff(x, y)) / 0.47;
      return d < 1 ? 1 - Math.sqrt(1 - d * d) : 1;
    },
  },
  {
    id: 'quilted', name: 'Quilted', density: 8, depth: 0.018, ao: 0.4, period: [2, 2], grip: 1.15,
    words: [['Quilted', 'Tufted', 'Puffy', 'Cosy'], ['Quilt', 'Duvet', 'Pillow', 'Eiderdown']],
    glsl: `vec2 f = fract(vec2(p.x + p.y, p.x - p.y) * 0.5);
      return sqrt(max(sin(3.14159265 * f.x) * sin(3.14159265 * f.y), 0.0));`,
    js: (x, y) => {
      const fx = fract((x + y) * 0.5), fy = fract((x - y) * 0.5);
      return Math.sqrt(Math.max(Math.sin(Math.PI * fx) * Math.sin(Math.PI * fy), 0));
    },
  },
  {
    id: 'ripples', name: 'Ripples', density: 2.5, depth: 0.035, grip: 1.0,
    words: [['Rippled', 'Rain-Dropped', 'Pond', 'Splashy'], ['Puddle', 'Pond', 'Raindrop', 'Ripple']],
    glsl: `vec2 c = floor(p), f = fract(p);
      float h = 0.0;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 o = vec2(float(i), float(j)), r = sfH22(sfW(c + o));
        float d = length(o + r - f);
        h += sin(d * 25.0 - r.x * 6.2831853) * exp(-d * 2.6) * (0.5 + r.y);
      }
      return 0.5 + 0.22 * h;`,
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
    id: 'corrugated', name: 'Corrugated', density: 9, depth: 0.007, ao: 0.2, period: [1, 0], grip: 1.3,
    words: [['Corrugated', 'Ridged', 'Fluted', 'Sheet-Metal'], ['Shed', 'Roof', 'Washboard', 'Ridge']],
    glsl: 'return 0.5 + 0.5 * sin(6.2831853 * p.x);',
    js: (x) => 0.5 + 0.5 * Math.sin(TAU * x),
  },
  {
    id: 'knurled', name: 'Knurled', density: 14, depth: 0.004, ao: 0.25, rough: 0.05, period: [1, 1], grip: 1.6,
    words: [['Knurled', 'Grippy', 'Machined', 'Cross-Hatched'], ['Grip', 'Knurl', 'Handle', 'Dial']],
    glsl: 'return min(abs(fract(p.x + p.y) - 0.5), abs(fract(p.x - p.y) - 0.5)) * 2.0;',
    js: (x, y) => Math.min(Math.abs(fract(x + y) - 0.5), Math.abs(fract(x - y) - 0.5)) * 2,
  },
  {
    id: 'crackle', name: 'Crackle', density: 5, depth: 0.006, ao: 0.5, grip: 1.1,
    words: [['Crackled', 'Crazed', 'Parched', 'Antique'], ['Glaze', 'Mudflat', 'Desert', 'Relic']],
    glsl: 'vec2 v = sfVor(p); return smoothstep(0.0, 0.07, v.y - v.x);',
    js: (x, y) => {
      const v = vor(x, y);
      return sstep(0, 0.07, v[1] - v[0]);
    },
  },
  {
    id: 'pebbled', name: 'Pebbled', density: 8, depth: 0.009, ao: 0.35, rough: 0.06, grip: 1.35,
    words: [['Pebbled', 'Leathery', 'Gnarly', 'Swampy'], ['Croc', 'Gator', 'Pebble', 'Leather']],
    glsl: 'vec2 v = sfVor(p); return sqrt(clamp((v.y - v.x) * 2.8, 0.0, 1.0));',
    js: (x, y) => {
      const v = vor(x, y);
      return Math.sqrt(clamp((v[1] - v[0]) * 2.8, 0, 1));
    },
  },
  {
    id: 'craters', name: 'Moon craters', density: 4.5, depth: 0.016, ao: 0.4, rough: 0.06, grip: 1.2,
    words: [['Cratered', 'Lunar', 'Pockmarked', 'Asteroid'], ['Moon', 'Crater', 'Meteor', 'Luna']],
    glsl: `vec2 c = floor(p), f = fract(p);
      float bowl = 1.0, rim = 0.0;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 o = vec2(float(i), float(j)), r = sfH22(sfW(c + o) + 7.3);
        if (r.y > 0.75) continue;
        float rad = 0.16 + 0.3 * r.y / 0.75, u = length(o + 0.25 + 0.5 * sfH22(sfW(c + o) + 1.7) - f) / rad;
        if (u < 1.0) bowl = min(bowl, 0.12 + 0.88 * u * u);
        else rim += exp(-pow((u - 1.0) / 0.22, 2.0));
      }
      return clamp((bowl + 0.3 * min(rim, 1.0)) / 1.3, 0.0, 1.0);`,
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
    id: 'woven', name: 'Basket weave', density: 4, depth: 0.008, ao: 0.35, period: [2, 2], grip: 1.25,
    words: [['Woven', 'Wicker', 'Plaited', 'Basketed'], ['Basket', 'Hamper', 'Wicker', 'Weave']],
    glsl: `vec2 c = floor(p), f = fract(p);
      bool across = mod(c.x + c.y, 2.0) < 0.5;
      float t = across ? f.y : f.x, s = across ? f.x : f.y;
      return sin(3.14159265 * fract(t * 3.0)) * (0.7 + 0.3 * sin(3.14159265 * s));`,
    js: (x, y) => {
      const across = (Math.floor(x) + Math.floor(y)) % 2 === 0, t = across ? fract(y) : fract(x), s = across ? fract(x) : fract(y);
      return Math.sin(Math.PI * fract(t * 3)) * (0.7 + 0.3 * Math.sin(Math.PI * s));
    },
  },
  {
    id: 'bricks', name: 'Bricks', density: 4, depth: 0.007, ao: 0.45, period: [1, 1], grip: 1.2,
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
    id: 'stars', name: 'Stars', density: 4, depth: 0.011, period: [1, 1], grip: 1.1,
    words: [['Starry', 'Star-Spangled', 'Twinkly', 'Stellar'], ['Star', 'Starlight', 'Twinkle', 'Comet']],
    glsl: 'return clamp(-sfStar(fract(p) - 0.5, 0.36, 0.42) / 0.05, 0.0, 1.0);',
    js: (x, y) => clamp(-sdStar(fract(x) - 0.5, fract(y) - 0.5, 0.36, 0.42) / 0.05, 0, 1),
  },
  {
    id: 'hearts', name: 'Hearts', density: 4, depth: 0.011, period: [1, 1], grip: 1.1,
    words: [['Lovey', 'Sweetheart', 'Smitten', 'Adoring'], ['Heart', 'Sweetheart', 'Valentine', 'Crush']],
    glsl: 'vec2 q = (fract(p) - vec2(0.5, 0.2)) * 1.65; return clamp(-sfHeart(q) / 0.08, 0.0, 1.0);',
    js: (x, y) => clamp(-sdHeart((fract(x) - 0.5) * 1.65, (fract(y) - 0.2) * 1.65) / 0.08, 0, 1),
  },
  {
    id: 'swirl', name: 'Swirls', density: 4, depth: 0.006, period: [1, 1], grip: 1.05,
    words: [['Swirly', 'Whorled', 'Hypnotic', 'Spiralling'], ['Whorl', 'Swirl', 'Spiral', 'Fingerprint']],
    glsl: `vec2 o = fract(p) - 0.5;
      float d = length(o);
      return 0.5 + 0.5 * sin(d * 40.0 + atan(o.y, o.x) * 2.0) * smoothstep(0.5, 0.36, d);`,
    js: (x, y) => {
      const ox = fract(x) - 0.5, oy = fract(y) - 0.5, d = Math.hypot(ox, oy);
      return 0.5 + 0.5 * Math.sin(d * 40 + Math.atan2(oy, ox) * 2) * sstep(0.5, 0.36, d);
    },
  },
  {
    id: 'frosted', name: 'Frosted', density: 22, depth: 0.004, rough: 0.28, grip: 1.2,
    words: [['Frosted', 'Sandblasted', 'Misty', 'Matte'], ['Frost', 'Mist', 'Sandglass', 'Haze']],
    glsl: 'return sfNoise(p) * 0.6 + sfNoise(p * 2.0 + 7.0) * 0.4;',
    js: (x, y) => vnoise(x, y) * 0.6 + vnoise(x * 2.3 + 9, y * 2.3 + 4) * 0.4,
  },
  {
    id: 'sponge', name: 'Sponge', density: 7, depth: 0.012, ao: 0.5, through: true, grip: 1.15,
    words: [['Spongy', 'Aerated', 'Porous', 'Bubbly'], ['Sponge', 'Aero', 'Pumice', 'Coral']],
    glsl: 'return sfHoles(p, 0.85, 0.12, 0.32);',
    js: holes(0.85, 0.12, 0.32),
    holes: [0.85, 0.12, 0.32],
  },
];
export const SURFACE = Object.fromEntries(SURFACES.map((s, i) => [s.id, { ...s, kind: i }]));
export const surfaceOf = (id) => SURFACE[id] || SURFACE.none;

// A face one's tile, baked (in cells, across and up): one repeat of a
// formed one; eight cells each way of a random one (its hashes wrapped).
export function surfaceTile(s) {
  if (!s || !s.glsl || s.through) return [1, 1];
  if (!s.period) return [8, 8];
  return [s.period[0], s.period[1] || s.period[0]];
}

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

// The shader's side: every surface's height, by its kind (its place in the
// list), the face ones and the through ones apart; and the helpers they share.
// The face ones' heights as their own GLSL, for baking (see JellyView: a
// tile of each, once - the shaders that draw them read the tile, one look-up
// a height, not every pattern's code inlined at every look). Their random
// ones' hashes wrapped (sfWrap: the tile, in cells), so a tile repeats
// seamlessly.
export const SURF_BAKE_GLSL = /* glsl */ `
  vec2 sfWrap = vec2(100000.0);
  vec2 sfW(vec2 c) { return mod(c, sfWrap); }
  vec2 sfH22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }
  // (smooth value noise, its own: the surface maps are drawn by shaders that
  // haven't the jelly's)
  float sfNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    float a = sfH22(sfW(i)).x, b = sfH22(sfW(i + vec2(1.0, 0.0))).x, c = sfH22(sfW(i + vec2(0.0, 1.0))).x, d = sfH22(sfW(i + 1.0)).x;
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  // (from the nearest centre of a hex grid, centres a cell apart)
  vec2 sfHex(vec2 p) {
    const vec2 s = vec2(1.0, 1.7320508);
    vec2 a = mod(p, s) - s * 0.5, b = mod(p - s * 0.5, s) - s * 0.5;
    return dot(a, a) < dot(b, b) ? a : b;
  }
  // (the nearest two of a point a cell, jittered: their distances)
  vec2 sfVor(vec2 p) {
    vec2 c = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j)), q = o + 0.15 + 0.7 * sfH22(sfW(c + o)) - f;
      float d = dot(q, q);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return sqrt(vec2(d1, d2));
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
  float sfFaceProc(int k, vec2 p) {
    ${SURFACES.map((s, i) => (s.glsl && !s.through ? `if (k == ${i}) { ${s.glsl} }` : '')).filter(Boolean).join('\n    ')}
    return 1.0;
  }
`;

export const SURF_GLSL = /* glsl */ `
  uniform highp sampler2DArray uSurfTex; // (each face one's height, baked: a tile of it a layer)
  const vec2 SF_TILE[${SURFACES.length}] = vec2[${SURFACES.length}](${SURFACES.map((x) => `vec2(${surfaceTile(x).map((v) => v.toFixed(6)).join(', ')})`).join(', ')});
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
  // A rest point's place on the cube unfolded: which face it's on, and how
  // far along that face each way - round a bevel by its arc - so a pattern
  // laid on it carries on round an edge onto the next face (a face's own
  // stretch runs to the middle of each bevel round it). hs: half the cube's
  // size; b: its rounding (m).
  float sfUnf(float c, float nc, float nf, float fl, float b) {
    float ac = abs(c), arc = fl + b * atan(abs(nc), max(abs(nf), 1e-6));
    return sign(c) * mix(ac, arc, step(fl, ac));
  }
  vec2 sfFaceUV(vec3 r, float hs, float b) {
    float fl = hs - b;
    vec3 n = sign(r) * max(abs(r) - fl, 0.0);
    if (dot(n, n) < 1e-14) {
      vec3 a = abs(r);
      n = a.x > a.y && a.x > a.z ? vec3(sign(r.x), 0.0, 0.0) : a.y > a.z ? vec3(0.0, sign(r.y), 0.0) : vec3(0.0, 0.0, sign(r.z));
    }
    vec3 an = abs(n);
    // (each face its own way up: up the cube on its sides, away from the
    // front on its top)
    if (an.x >= an.y && an.x >= an.z) return vec2(-sign(n.x) * sfUnf(r.z, n.z, n.x, fl, b), sfUnf(r.y, n.y, n.x, fl, b));
    if (an.y >= an.z) return vec2(sfUnf(r.x, n.x, n.y, fl, b), -sign(n.y) * sfUnf(r.z, n.z, n.y, fl, b));
    return vec2(sign(n.z) * sfUnf(r.x, n.x, n.z, fl, b), sfUnf(r.y, n.y, n.z, fl, b));
  }
  float sfFace(int k, vec2 p);
  float sfVolume(int k, vec3 p);
  // Its height at rest point r: a through one in the jelly's own space, a
  // face one on the cube unfolded - its cells (NN, across and up) counted
  // from the middle of one bevel to the middle of the next (L: that stretch).
  float sfHeightAt(int k, bool thru, vec3 r, float hs, float b, float L, vec2 NN) {
    if (thru) return sfVolume(k, r * (NN.x / (2.0 * hs)));
    return sfFace(k, (sfFaceUV(r, hs, b) / L + 0.5) * NN);
  }
  // (a face one: off its baked tile - see SURF_BAKE_GLSL)
  float sfFace(int k, vec2 p) {
    return textureLod(uSurfTex, vec3(p / SF_TILE[k], float(k)), 0.0).r;
  }
  float sfVolume(int k, vec3 p) {
    ${SURFACES.map((s, i) => (s.glsl && s.through ? `if (k == ${i}) { ${s.glsl} }` : '')).filter(Boolean).join('\n    ')}
    return 1.0;
  }
  bool sfThrough(int k) { return ${SURFACES.map((s, i) => (s.through ? `k == ${i}` : '')).filter(Boolean).join(' || ') || 'false'}; }

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

  // Its relief bent into normal N: how much it rises across this pixel, both
  // ways (its height here, and a pixel along each way - r the rest point, d*
  // how the rest point and the world point run across the pixel), into the
  // world as it is now - Mikkelsen's surface gradient. h: its height here.
  vec3 sfBend(SfInfo s, vec3 r, vec3 dRx, vec3 dRy, vec3 dPx, vec3 dPy, vec3 N, float amt, out float h) {
    h = sfH(s, r);
    float dBs = (sfH(s, r + dRx) - h) * s.depth * amt;
    float dBt = (sfH(s, r + dRy) - h) * s.depth * amt;
    vec3 R1 = cross(dPy, N), R2 = cross(N, dPx);
    float det = dot(dPx, R1);
    if (abs(det) < 1e-20) return N;
    vec3 sg = (dBs * R1 + dBt * R2) / det;
    float sl = length(sg);
    if (sl > 1.5) sg *= 1.5 / sl;
    return normalize(N - sg);
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
  vec3 sfParallax(SfInfo s, vec3 r, float h0, vec3 Vr, vec3 Nr, int steps) {
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
      float gap = z - (1.0 - sfH(s, p)) * s.depth;
      if (gap >= 0.0) return mix(prev, p, prevGap / (prevGap - gap));
      prev = p;
      prevGap = gap;
    }
    return prev;
  }

  // (how far onto a rounded edge r is, 0..1: out of its middle - round a
  // bevel the faces' mapping turns the corner, and the march into it with it)
  float sfOnEdge(SfInfo s, vec3 r) {
    vec3 q = max(abs(r) - (s.hs - s.b), 0.0);
    float mid = q.x + q.y + q.z - max(q.x, max(q.y, q.z)) - min(q.x, min(q.y, q.z));
    return smoothstep(0.0, 0.35 * s.b + 1e-5, mid);
  }

  // ...and whether the key light (Lr, rest space) reaches p there, h its
  // height, past the relief round it: 1 lit, toward 0 in its shadow.
  float sfShadow(SfInfo s, vec3 p, float h, vec3 Lr, vec3 Nr) {
    float cl = dot(Lr, Nr), z0 = (1.0 - h) * s.depth;
    if (cl <= 0.02 || z0 < 1e-5) return 1.0;
    vec3 dir = (Lr - Nr * cl) / max(cl, 0.2);
    float lit = 1.0;
    for (int i = 1; i <= 4; i++) {
      float z = z0 * (1.0 - float(i) / 4.5);
      float gap = z - (1.0 - sfH(s, p + dir * (z0 - z))) * s.depth;
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
