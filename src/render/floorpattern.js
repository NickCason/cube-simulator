// A place's floor pattern, worked out where it's drawn (no textures: sharp
// up close, no shimmer far off): for the floor itself and for the floor the
// jelly shows in its reflections (see floorAt). uPat: 0 plain, 1 checker,
// 2 gingham, 3 marble, 4 neon grid, 5 sand, 6 moon dust; A and B its two
// colours; uPatScale a repeat (m); uPatGlow how bright the grid's lines are;
// uPatSun which way the light is, along the floor (a crater's rim catches it).
export const FLOOR_PATTERN_GLSL = /* glsl */ `
  uniform float uPat;
  uniform vec3 uPatA;
  uniform vec3 uPatB;
  uniform float uPatScale;
  uniform float uPatGlow;
  uniform vec2 uPatSun;
  float fph(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float fpn(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(fph(i), fph(i + vec2(1.0, 0.0)), u.x), mix(fph(i + vec2(0.0, 1.0)), fph(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fpfbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) { s += a * fpn(p); p = p * 2.03 + 11.3; a *= 0.5; }
    return s;
  }
  // grain finer than a pixel: evened out to its average, or it crawls
  float fpgrain(vec2 p) {
    float w = max(fwidth(p.x), fwidth(p.y));
    return mix(fph(floor(p)), 0.5, smoothstep(0.3, 1.0, w));
  }
  // the floor at xz: its colour (base: the plain one) and the light of its own (glow)
  vec3 floorPattern(vec2 xz, vec3 base, out vec3 glow) {
    glow = vec3(0.0);
    int k = int(uPat + 0.5);
    if (k == 0) return base;
    vec2 q = xz / uPatScale;
    vec2 w = max(fwidth(q), vec2(1e-4));
    if (k == 1) {
      // checker, filtered (Quilez): no moire far off
      vec2 i = 2.0 * (abs(fract((q - 0.5 * w) * 0.5) - 0.5) - abs(fract((q + 0.5 * w) * 0.5) - 0.5)) / w;
      return mix(uPatA, uPatB, 0.5 - 0.5 * i.x * i.y);
    }
    if (k == 2) {
      // gingham: stripes both ways, darker where they cross, a little weave
      vec2 s = smoothstep(0.5 - w, 0.5 + w, fract(q));
      return mix(uPatB, uPatA, (s.x + s.y) * 0.5) * (0.93 + 0.07 * mix(fpn(xz * 260.0), 0.5, smoothstep(0.3, 1.0, max(fwidth(xz.x), fwidth(xz.y)) * 260.0)));
    }
    if (k == 3) {
      // marble: veins wandering through cloudy stone, long and mostly one
      // way - thin, strong here and faint there, a haze about them - and
      // finer ones crossing between (each evened out once finer than a pixel)
      vec2 p = q * 1.1;
      vec2 wq = p + vec2(fpfbm(p * 0.7 + 3.1), fpfbm(p * 0.7 + 8.7)) * 1.4;
      float n = fpfbm(wq * 1.6);
      float ph = (wq.x * 0.9 + wq.y * 0.5) * 2.2 + n * 6.0, s1 = abs(sin(ph));
      float aa = fwidth(ph) * 0.8, wv = 0.1 + 0.16 * fpn(p * 1.3);
      float v = (1.0 - smoothstep(wv * 0.3, max(wv, aa), s1)) * min(1.0, wv / max(aa, 1e-4)) * (0.5 + 0.5 * fpn(wq * 2.0));
      v += pow(1.0 - s1, 4.0) * 0.28;
      float ph2 = (wq.y * 1.3 - wq.x * 0.4) * 3.1 + fpfbm(wq * 2.7 + 5.0) * 5.0, s2 = abs(sin(ph2));
      float aa2 = fwidth(ph2) * 0.8;
      v += (1.0 - smoothstep(0.0, max(0.06, aa2), s2)) * min(1.0, 0.06 / max(aa2, 1e-4)) * 0.55 * fpn(wq * 1.4 + 2.0);
      return mix(uPatB * (0.95 + 0.07 * n), uPatA, clamp(v, 0.0, 1.0));
    }
    if (k == 4) {
      // neon grid: thin lines, lit - no thinner than a pixel far off, but
      // no brighter all told (or the distance glares), their halo evened out
      vec2 d = abs(fract(q + 0.5) - 0.5) * uPatScale;
      float m = min(d.x, d.y), aa = max(fwidth(xz.x), fwidth(xz.y));
      float lw = max(0.012, aa);
      float line = (1.0 - smoothstep(lw - aa * 0.5, lw + aa * 0.5, m)) * (0.012 / lw);
      float halo = mix(exp(-m / 0.05), 0.1 / uPatScale, smoothstep(0.02, 0.08, aa));
      glow = uPatB * (line + halo * 0.3);
      return mix(uPatA, uPatB, line * 0.8);
    }
    if (k == 5) {
      // sand: ripples blown across it (a long gentle rise, a short steep
      // fall - evened out far off, where they'd shimmer), and grain
      float n = fpfbm(q * 2.2);
      float ph = (q.x * 1.1 + q.y * 0.3) * 6.0 + fpfbm(q * 0.6) * 5.0, fr = fract(ph);
      float rip = mix(smoothstep(0.0, 0.8, fr) - smoothstep(0.8, 1.0, fr), 0.45, smoothstep(0.2, 0.7, fwidth(ph)));
      return mix(uPatA, uPatB, n * 0.6 + rip * 0.4) * (0.9 + 0.2 * fpgrain(xz * 500.0));
    }
    // moon dust: grey and lumpy, pocked with craters - some cells have one
    // (big ones few, small ones many), each a dished floor with a raised rim,
    // lit from the side the light comes from
    float n = fpfbm(q * 1.7), sh = 0.0;
    for (int o = 0; o < 2; o++) {
      float f0 = o == 0 ? 1.1 : 3.3;
      vec2 cq = q * f0 + float(o) * 17.0, cell = floor(cq), f = fract(cq);
      for (int j = -1; j <= 1; j++)
        for (int i = -1; i <= 1; i++) {
          vec2 g = vec2(float(i), float(j)), c = cell + g;
          if (fph(c + 1.9) > (o == 0 ? 0.45 : 0.6)) continue;
          vec2 off = g + vec2(fph(c), fph(c + 7.3)) - f;
          float r = 0.12 + 0.3 * pow(fph(c + 3.1), 2.0), dd = length(off) / r;
          if (dd > 1.5) continue;
          // (inside: the dish, dark on the near wall and bright on the far;
          // the rim: a ridge, bright facing the light)
          vec2 rd = -off / max(length(off), 1e-4);
          float side = dot(rd, uPatSun);
          float dish = dd < 1.0 ? (1.0 - dd * dd) : 0.0;
          float rim = exp(-pow((dd - 1.0) * 5.0, 2.0));
          sh += dish * (-0.18 - 0.3 * side) + rim * (0.12 + 0.3 * side);
        }
    }
    return mix(uPatA, uPatB, clamp(n * 0.9 + 0.05 + sh, 0.0, 1.0)) * (0.92 + 0.16 * fpgrain(xz * 400.0));
  }
`;
