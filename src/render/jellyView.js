import * as THREE from 'three';
import { biasExp, RUBIK_COLORS, gradAt, gradSequence, GRAD_SHAPE_INDEX } from '../styles.js';
import { FREE_N, bakeFree } from '../freeform.js';
import { MAX_CUBES, REST_STEP } from '../sim/softbody.js';
import {
  createBackMaterial,
  createJellyMaterial,
  createCausticMaterial,
  createLightViewMaterial,
  createMaskMaterial,
  createTintMaterial,
  createHeightMaterial,
  createReflectMaterial,
  createGlowMaterial,
  createLayerUniforms,
  absorptionFromColor,
  MAX_PULSES,
  GRAD_N,
  GRAD_ROWS,
} from './jellyMaterials.js';

const FLOOR_SPAN = 6.4;
// (how milky jelly of that opacity looks: see setStyle)
// a row of the cube-look texture: 7 texels of looks, 10 + 10 of layers, the
// colour of its light, a freeform gradient's depth
export const CUBE_TEX_W = 30;

const hazeMinOf = (o) => 0.92 * Math.min(1, Math.max(0, (Math.min(1, Math.max(0, o)) - 0.45) / 0.55)) ** 2;

// One level of subdivision over an indexed triangle mesh: a midpoint per
// edge. geo[v] says where v is (split vertices along a crease share it). An
// edge whose two sides use the same vertices is smooth: one shared midpoint,
// Phong-tessellated. Otherwise each side gets its own, on the straight edge,
// so the surface stays watertight. Midpoints are numbered from `first`.
function splitEdges(index, geo, first, refine = null) {
  // pair up the half-edges by where their ends are: an open-addressing
  // table keyed on the (geo, geo) pair, chaining the half-edges per edge
  const nH = index.length;
  let cap = 16;
  while (cap < nH * 2) cap <<= 1;
  const ka = new Int32Array(cap).fill(-1), kb = new Int32Array(cap), head = new Int32Array(cap);
  const next = new Int32Array(nH);
  for (let h = 0; h < nH; h++) {
    const t3 = h - (h % 3);
    let ga = geo[index[h]], gb = geo[index[t3 + ((h - t3 + 1) % 3)]];
    if (ga > gb) {
      const tmp = ga;
      ga = gb;
      gb = tmp;
    }
    let slot = (Math.imul(ga, 0x9e3779b1) ^ Math.imul(gb, 0x85ebca6b)) & (cap - 1);
    while (ka[slot] !== -1 && (ka[slot] !== ga || kb[slot] !== gb)) slot = (slot + 1) & (cap - 1);
    if (ka[slot] === -1) {
      ka[slot] = ga;
      kb[slot] = gb;
      next[h] = -1;
    } else next[h] = head[slot];
    head[slot] = h;
  }
  // (the other end of half-edge h)
  const endB = (h) => index[h - (h % 3) + ((h % 3) + 1) % 3];
  const mids = new Int32Array(nH * 3), midGeo = new Int32Array(nH);
  let nm = 0;
  const triMid = new Int32Array(nH);
  let g = 0;
  // (with a refine mask, only edges of triangles being refined are split:
  // a smooth edge if either side is, a crease side if its own is)
  const wants = (h) => !refine || refine[(h - (h % 3)) / 3] === 1;
  triMid.fill(-1);
  for (let slot = 0; slot < cap; slot++) {
    if (ka[slot] === -1) continue;
    const h0 = head[slot], h1 = next[h0];
    const n = h1 === -1 ? 1 : next[h1] === -1 ? 2 : 3;
    let smooth = n === 1;
    if (n === 2) {
      const a0 = index[h0], b0 = endB(h0), a1 = index[h1], b1 = endB(h1);
      smooth = (a0 === a1 && b0 === b1) || (a0 === b1 && b0 === a1);
    }
    if (smooth) {
      if (wants(h0) || (n === 2 && wants(h1))) {
        const id = first + nm;
        mids[nm * 3] = index[h0]; mids[nm * 3 + 1] = endB(h0); mids[nm * 3 + 2] = 0;
        midGeo[nm++] = g;
        triMid[h0] = id;
        if (n === 2) triMid[h1] = id;
      }
    } else {
      for (let h = h0; h !== -1; h = next[h]) {
        if (!wants(h)) continue;
        mids[nm * 3] = index[h]; mids[nm * 3 + 1] = endB(h); mids[nm * 3 + 2] = 1;
        triMid[h] = first + nm;
        midGeo[nm++] = g;
      }
    }
    g++;
  }
  // each triangle split by how many of its edges were: 4 ways, 3, 2 or not
  // at all (so a refined patch meets the rest without cracks)
  const nTri = nH / 3;
  const out = new Uint32Array(nTri * 12);
  const start = new Int32Array(nTri + 1);
  let o = 0;
  const tri = (p, q, r) => {
    out[o] = p; out[o + 1] = q; out[o + 2] = r;
    o += 3;
  };
  for (let t = 0; t < nTri; t++) {
    start[t] = o;
    const a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2];
    const ab = triMid[t * 3], bc = triMid[t * 3 + 1], ca = triMid[t * 3 + 2];
    const k = (ab >= 0) + (bc >= 0) + (ca >= 0);
    if (k === 3) {
      tri(a, ab, ca); tri(ab, b, bc); tri(ca, bc, c); tri(ab, bc, ca);
    } else if (k === 0) tri(a, b, c);
    else if (k === 1) {
      if (ab >= 0) (tri(a, ab, c), tri(ab, b, c));
      else if (bc >= 0) (tri(a, b, bc), tri(a, bc, c));
      else (tri(a, b, ca), tri(ca, b, c));
    } else if (ca < 0) (tri(ab, b, bc), tri(a, ab, bc), tri(a, bc, c));
    else if (ab < 0) (tri(bc, c, ca), tri(b, bc, ca), tri(b, ca, a));
    else (tri(ca, a, ab), tri(c, ca, ab), tri(c, ab, b));
  }
  start[nTri] = o;
  return { mids: mids.slice(0, nm * 3), midGeo: midGeo.subarray(0, nm), nEdges: g, index: out.slice(0, o), start };
}

// Area-weighted vertex normals of the first n vertices.
function vertexNormals(index, pos, nrm, n) {
  nrm.fill(0, 0, n * 3);
  for (let k = 0; k < index.length; k += 3) {
    const a = index[k] * 3, b = index[k + 1] * 3, c = index[k + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz;
    nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz;
    nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
  }
  for (let o = 0; o < n * 3; o += 3) {
    const l = Math.hypot(nrm[o], nrm[o + 1], nrm[o + 2]) || 1;
    nrm[o] /= l; nrm[o + 1] /= l; nrm[o + 2] /= l;
  }
}

// The edge midpoints (see splitEdges), from their ends: Phong-tessellated
// on smooth edges, straight on creases, then pushed out along the normal by
// disp (to the true shape - see snapToShape). data (per-vertex extras) may
// be null.
const PHONG = 0.75;
function tessellate(pos, nrm, data, mids, first, disp) {
  for (let m = 0, k = first, j = 0; m < mids.length; m += 3, k++, j++) {
    const a = mids[m] * 3, b = mids[m + 1] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
    let qx = (ax + bx) * 0.5, qy = (ay + by) * 0.5, qz = (az + bz) * 0.5;
    const nax = nrm[a], nay = nrm[a + 1], naz = nrm[a + 2];
    const nbx = nrm[b], nby = nrm[b + 1], nbz = nrm[b + 2];
    if (!mids[m + 2]) {
      const da = (qx - ax) * nax + (qy - ay) * nay + (qz - az) * naz;
      const db = (qx - bx) * nbx + (qy - by) * nby + (qz - bz) * nbz;
      qx -= 0.5 * (da * nax + db * nbx) * PHONG;
      qy -= 0.5 * (da * nay + db * nby) * PHONG;
      qz -= 0.5 * (da * naz + db * nbz) * PHONG;
    }
    let nx = nax + nbx, ny = nay + nby, nz = naz + nbz;
    let l2 = nx * nx + ny * ny + nz * nz;
    // (ends facing opposite ways - an edge across a thin sliver - sum to
    // nothing: a zero normal turns every shader's normalize() into NaN, and
    // the mipmapped buffers spread that into black blocks. Take an end's.)
    if (!(l2 > 1e-12)) {
      nx = nax; ny = nay; nz = naz;
      l2 = nx * nx + ny * ny + nz * nz;
      if (!(l2 > 1e-12)) {
        nx = 0; ny = 1; nz = 0;
        l2 = 1;
      }
    }
    const il = 1 / Math.sqrt(l2); // (Math.hypot is slow in a loop this hot)
    nx *= il; ny *= il; nz *= il;
    const d = disp[j];
    const o = k * 3;
    pos[o] = qx + nx * d; pos[o + 1] = qy + ny * d; pos[o + 2] = qz + nz * d;
    nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz;
    if (data) {
      const da4 = mids[m] * 4, db4 = mids[m + 1] * 4, o4 = k * 4;
      data[o4] = (data[da4] + data[db4]) * 0.5;
      data[o4 + 1] = (data[da4 + 1] + data[db4 + 1]) * 0.5;
      data[o4 + 2] = Math.max(data[da4 + 2], data[db4 + 2]);
      data[o4 + 3] = (data[da4 + 3] + data[db4 + 3]) * 0.5; // (flour)
    }
  }
}

// At rest (pos/nrm the rest shape, the midpoints just tessellated with no
// push): how far each midpoint on the cube's original outside must move
// along its normal to sit on the true rounded box (half-size a + r, edge
// radius r), and moves it there. Only smooth edges whose ends are both on
// that surface and whose normal agrees with it - not cut faces, not seams.
const _cp = new Float64Array(6);
function roundedBox(px, py, pz, a, r) {
  const qx = Math.max(-a, Math.min(a, px)), qy = Math.max(-a, Math.min(a, py)), qz = Math.max(-a, Math.min(a, pz));
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len > 1e-9) {
    _cp[3] = dx / len; _cp[4] = dy / len; _cp[5] = dz / len;
    _cp[0] = qx + _cp[3] * r; _cp[1] = qy + _cp[4] * r; _cp[2] = qz + _cp[5] * r;
    return len - r;
  }
  // inside the core box: the nearest face
  _cp[0] = px; _cp[1] = py; _cp[2] = pz; _cp[3] = _cp[4] = _cp[5] = 0;
  let ax = 0, gap = Infinity;
  for (let c = 0; c < 3; c++) {
    const g = a + r - Math.abs(_cp[c]);
    if (g < gap) (gap = g), (ax = c);
  }
  const sg = _cp[ax] < 0 ? -1 : 1;
  _cp[ax] = sg * (a + r);
  _cp[3 + ax] = sg;
  return -gap;
}
// (shapes: each cube's { a, r }; cube: each render vertex's cube)
function snapToShape(pos, nrm, mids, first, disp, shapes, cube) {
  // (whether each vertex below `first` is on its cube's shape, worked out once)
  const on = new Int8Array(first);
  const onShape = (v) => {
    const s = shapes[cube[v]];
    if (!on[v]) on[v] = !(s.a > 0) || Math.abs(roundedBox(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], s.a, s.r)) > 4e-3 ? -1 : 1;
    return on[v] > 0;
  };
  for (let m = 0, k = first, j = 0; m < mids.length; m += 3, k++, j++) {
    if (mids[m + 2]) continue;
    if (!onShape(mids[m]) || !onShape(mids[m + 1])) continue;
    const { a, r } = shapes[cube[mids[m]]];
    const ia = mids[m] * 3, ib = mids[m + 1] * 3, o = k * 3;
    const ex = pos[ia] - pos[ib], ey = pos[ia + 1] - pos[ib + 1], ez = pos[ia + 2] - pos[ib + 2];
    const len = Math.sqrt(ex * ex + ey * ey + ez * ez);
    const sd = roundedBox(pos[o], pos[o + 1], pos[o + 2], a, r);
    const nx = nrm[o], ny = nrm[o + 1], nz = nrm[o + 2];
    if (sd < -0.35 * len || nx * _cp[3] + ny * _cp[4] + nz * _cp[5] < 0.9) continue;
    const d = (_cp[0] - pos[o]) * nx + (_cp[1] - pos[o + 1]) * ny + (_cp[2] - pos[o + 2]) * nz;
    if (Math.abs(d) > 0.25 * len) continue;
    disp[j] = d;
    pos[o] += nx * d; pos[o + 1] += ny * d; pos[o + 2] += nz * d;
  }
}

// (screen outlines, for the refraction layers: see renderPieces)
const SURF_N = 128, HULL_STEP = 2; // (a piece's surface points sampled; its outline from every HULL_STEP-th)
function convexHull(pts) {
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
    up.push(p);
  }
  up.pop();
  lo.pop();
  return lo.concat(up);
}
function polyArea(P) {
  let s = 0;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(s) / 2;
}
// (convex S clipped to convex C, both anticlockwise)
function clipConvex(S, C) {
  let out = S;
  for (let i = 0; i < C.length && out.length; i++) {
    const A = C[i], B = C[(i + 1) % C.length], inp = out;
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const P = inp[j], Q = inp[(j + 1) % inp.length];
      const sp = (B[0] - A[0]) * (P[1] - A[1]) - (B[1] - A[1]) * (P[0] - A[0]);
      const sq = (B[0] - A[0]) * (Q[1] - A[1]) - (B[1] - A[1]) * (Q[0] - A[0]);
      if (sp >= 0) out.push(P);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]);
      }
    }
  }
  return out;
}

// Owns the jelly GPU geometry and the multi-pass jelly rendering. The
// pieces share their vertex attributes and are drawn together: one mesh of
// them all (for the passes that draw every piece - the light's view, the
// floor's masks, the mirror) and one per refraction layer (see
// renderPieces), each a single draw call. (A mesh per piece cost ~8 draw
// calls per piece per frame: past a hundred pieces, 200 ms a frame.)
export class JellyView {
  constructor(renderer, env, lightDir) {
    this.maxLayers = 5; // (phones: fewer; see App)
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.allMesh = null; // every piece
    this.layerMeshes = []; // the pieces of each refraction layer
    this.pieceIdx = new Int32Array(0); // per piece: its run [start, end) of the index buffer
    this.fullIndex = null;
    this.layerOf = new Int8Array(0); // per piece: its layer last frame (-1: none)
    this.layerCount = new Int32Array(0); // per layer: indices in its mesh
    this.topoVersion = -1;
    this._vp = new THREE.Matrix4();
    this.layerUniforms = createLayerUniforms();
    this.backMat = createBackMaterial();
    // (a gradient across, corner to corner or out from the middle wants the
    // whole rest point where the line of sight leaves, in a second target:
    // only drawn while there's one - see needRest, setSize, renderPieces)
    this.backMatRest = createBackMaterial(true);
    this.needRest = false;
    this.rtBackRest = null;
    this.frontMat = createJellyMaterial(env, this.layerUniforms);
    // each cube's look, a row each (see setCubeLook; the front shader reads it)
    this.cubeData = new Float32Array(CUBE_TEX_W * MAX_CUBES * 4);
    this.cubeTex = new THREE.DataTexture(this.cubeData, CUBE_TEX_W, MAX_CUBES, THREE.RGBAFormat, THREE.FloatType);
    this.cubeTex.minFilter = this.cubeTex.magFilter = THREE.NearestFilter;
    this.cubeTex.generateMipmaps = false;
    this.cubeTex.needsUpdate = true;
    this.frontMat.uniforms.uCubeTex.value = this.cubeTex;
    // (the back faces read it too: what coat the line of sight leaves through)
    this.backMat.uniforms.uCubeTex.value = this.cubeTex;
    this.backMatRest.uniforms.uCubeTex.value = this.cubeTex;
    // each cube's gradient (layered), as a strip: its absorption and the
    // colour inside along it, two rows a cube (see setCubeLook, CUBE_GLSL)
    this.gradData = new Uint16Array(GRAD_N * GRAD_ROWS * 4);
    this.gradTex = new THREE.DataTexture(this.gradData, GRAD_N, GRAD_ROWS, THREE.RGBAFormat, THREE.HalfFloatType);
    this.gradTex.minFilter = this.gradTex.magFilter = THREE.LinearFilter;
    this.gradTex.generateMipmaps = false;
    this.gradTex.needsUpdate = true;
    this.frontMat.uniforms.uGradTex.value = this.gradTex;
    // ...and a freeform one's, as a grid of colours (sRGB): a slab FREE_N a
    // side for each cube (see setCubeLook, freeform.js bakeFree)
    this.freeSlab = FREE_N * FREE_N * FREE_N * 4;
    this.freeData = new Uint8Array(this.freeSlab * MAX_CUBES);
    this.freeTex = new THREE.Data3DTexture(this.freeData, FREE_N, FREE_N, FREE_N * MAX_CUBES);
    this.freeTex.colorSpace = THREE.SRGBColorSpace;
    this.freeTex.minFilter = this.freeTex.magFilter = THREE.LinearFilter;
    this.freeTex.unpackAlignment = 1;
    this.freeTex.needsUpdate = true;
    this.frontMat.uniforms.uFreeTex.value = this.freeTex;
    // (depth first, so the front shader - the heavy one - runs once a pixel:
    // a stepped, folded or many-sided piece seen low drew over itself 2-4x)
    this.depthMat = new THREE.ShaderMaterial({ vertexShader: this.frontMat.vertexShader, fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }', colorWrite: false });
    this.prepass = true;
    this.causticMat = createCausticMaterial();
    // the caustics' view from the key light (entry, normal, exit) and their
    // grid of rays (see createCausticMaterial); the grid's density
    const coarse = !!window.matchMedia?.('(pointer: coarse)').matches;
    const lvRes = coarse ? 384 : 512, gridN = coarse ? 192 : 256;
    const lvType = renderer.extensions.has('EXT_color_buffer_float') ? THREE.FloatType : THREE.HalfFloatType;
    const lvOpts = { type: lvType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true };
    // (entry and exit: a second target each, the rest point there - for
    // gradients out from the middle, the way through)
    this.lightView = [0, 1, 2].map((kind) => ({
      rt: new THREE.WebGLRenderTarget(lvRes, lvRes, kind === 1 ? { ...lvOpts, type: THREE.HalfFloatType } : { ...lvOpts, count: kind === 2 ? 3 : 2 }),
      mat: createLightViewMaterial(kind),
    }));
    this.causticMat.uniforms.tEntry.value = this.lightView[0].rt.texture;
    this.causticMat.uniforms.tNormal.value = this.lightView[1].rt.texture;
    this.causticMat.uniforms.tExit.value = this.lightView[2].rt.texture;
    this.causticMat.uniforms.tEntryRest.value = this.lightView[0].rt.textures[1];
    this.causticMat.uniforms.tExitRest.value = this.lightView[2].rt.textures[1];
    // (and the exit's a third: its normal, for the light bent again going out)
    this.causticMat.uniforms.tExitN.value = this.lightView[2].rt.textures[2];
    // (on a desktop, the caustics drawn a colour at a time, each bent its own
    // amount: their edges split into rainbows)
    this.disperse = !coarse;
    this.causticMat.uniforms.uDisperse.value = 1.5;
    // (and the jelly, for one cube's shadow on another - see cubeShadowAt)
    this.frontMat.uniforms.tLightEntry.value = this.lightView[0].rt.texture;
    this.frontMat.uniforms.tLightExit.value = this.lightView[2].rt.texture;
    this.multiCube = false; // (set by the app: several cubes)
    this.causticMat.uniforms.uGridN.value = gridN;
    this.lightCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40);
    this.lightOrigin = new THREE.Vector3();
    this.lightDir = new THREE.Vector3(0, 1, 0);
    this.gridScene = new THREE.Scene();
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, gridN - 1, gridN - 1), this.causticMat);
    grid.frustumCulled = false;
    this.gridScene.add(grid);
    this._corner = new THREE.Vector3();
    this.maskMat = createMaskMaterial();
    this.tintMat = createTintMaterial();
    this.heightMat = createHeightMaterial();
    this.reflectMat = createReflectMaterial();
    this.glowMat = createGlowMaterial();
    // (each cube's own colour in all of them)
    for (const m of [this.causticMat, this.tintMat, this.reflectMat, this.glowMat]) {
      m.uniforms.uCubeTex.value = this.cubeTex;
      m.uniforms.uGradTex.value = this.gradTex;
      m.uniforms.uFreeTex.value = this.freeTex;
    }
    // the pieces again, upside down below the floor (its reflection)
    this.reflScene = new THREE.Scene();
    this.mirror = null;
    this.fxCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // the floor's maps: glow mode's light pool over a fixed span (its blur is
    // its mip levels: their size must not change); the jelly's shadow and
    // contact fitted round it each frame (see _fitFloorFx) - over the whole
    // span a texel was 1.25 cm, and the shadow's edge showed it
    this.floorRect = new THREE.Vector4(-FLOOR_SPAN / 2, -FLOOR_SPAN / 2, 1 / FLOOR_SPAN, 1 / FLOOR_SPAN);
    this.fxRect = this.floorRect.clone();
    for (const m of [this.causticMat, this.glowMat]) {
      if (m.uniforms.uFloorRect) m.uniforms.uFloorRect.value = this.floorRect;
    }
    for (const m of [this.maskMat, this.heightMat, this.tintMat]) m.uniforms.uFloorRect.value = this.fxRect;
    this.setLightDir(lightDir);
    this.rtCaustic = new THREE.WebGLRenderTarget(768, 768, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      samples: 4,
    });
    // ...blurred, as the shadow's map is (a Gaussian ~3 mm, both ways), for
    // the floor and the jelly's view of it to read: read sharp with taps
    // centimetres apart, every caustic line was stamped over in copies - a
    // plaid. Mipmapped: blurred wider by mip level (the shadow's fill takes
    // its colour from it, wide; light through jelly up in the air lands soft)
    this.rtCausticT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtCausticB = new THREE.WebGLRenderTarget(512, 512, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    // (mipmapped: glow mode's light pool is its footprint, blurred wide)
    this.rtFloorFx = new THREE.WebGLRenderTarget(512, 512, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      samples: 4,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    // ...blurred (a Gaussian a couple of cm wide, both ways): the floor reads
    // its shadow edge from this - five taps on the raw map stamped the edge
    // four times over, in streaks
    this.rtFloorFxT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtFloorFxB = new THREE.WebGLRenderTarget(512, 512, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    this.blurMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: { tSrc: { value: null }, uStep: { value: new THREE.Vector2() } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc;
        uniform vec2 uStep;
        varying vec2 vUv;
        void main() {
          // 9 taps, sigma 2 steps
          vec4 c = textureLod(tSrc, vUv, 0.0) * 0.2042;
          c += (textureLod(tSrc, vUv + uStep, 0.0) + textureLod(tSrc, vUv - uStep, 0.0)) * 0.1802;
          c += (textureLod(tSrc, vUv + 2.0 * uStep, 0.0) + textureLod(tSrc, vUv - 2.0 * uStep, 0.0)) * 0.1238;
          c += (textureLod(tSrc, vUv + 3.0 * uStep, 0.0) + textureLod(tSrc, vUv - 3.0 * uStep, 0.0)) * 0.0663;
          c += (textureLod(tSrc, vUv + 4.0 * uStep, 0.0) + textureLod(tSrc, vUv - 4.0 * uStep, 0.0)) * 0.0276;
          gl_FragColor = c;
        }`,
    });
    this.blurScene = new THREE.Scene();
    const bq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMat);
    bq.frustumCulled = false;
    this.blurScene.add(bq);
    // each cube's shadow its own colour: the colour it gives the light, laid
    // where its shadow falls (see createTintMaterial; mipmapped, for the
    // wide fill round the shadow)
    this.rtFloorTint = new THREE.WebGLRenderTarget(256, 256, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    // glow mode: the light it casts on the floor, from above (see createGlowMaterial)
    this.rtGlow = new THREE.WebGLRenderTarget(256, 256, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    this.fxUniforms = {
      caustic: { value: this.rtCausticB.texture },
      floorFx: { value: this.rtFloorFxB.texture },
      floorTint: { value: this.rtFloorTint.texture },
      floorRect: { value: this.fxRect }, // (shadow and contact: fitted, see _fitFloorFx)
      glowRect: { value: this.floorRect },
      fxLodBias: { value: 0 }, // (log2 of how much finer than the whole span: keeps blurs by mip level the same size)
      bg: { value: new THREE.Color(0.86, 0.85, 0.83) },
      texel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
      causRect: { value: new THREE.Vector4(-3.2, -3.2, 1 / 6.4, 1 / 6.4) }, // (the caustics' texture: fitted round the jelly)
      causGain: { value: 1.5 }, // (how bright the caustic light lands)
      penumbra: { value: 0.06 }, // (the key light's softness: its shadow's edge widens this much a metre from what casts it)
      tint: { value: new THREE.Color(1, 0.2, 0.2) },
      refl: { value: null }, // the jelly mirrored in the floor (App's rtRefl)
      res: { value: new THREE.Vector2(1, 1) },
      reflAmount: { value: 0.22 },
      reflLod: { value: 1 }, // (how blurred: the floor's gloss)
      glowFloor: { value: 0 }, // glow mode: how brightly it lights the floor
      glowTex: { value: this.rtGlow.texture },
      pulseCol: { value: Array.from({ length: MAX_PULSES }, () => new THREE.Vector3(1, 0.2, 0.2)) }, // (each ring's colour)
      // (glow mode's rings of light, shared with the jelly)
      pulse: this.frontMat.uniforms.uPulse,
      pulseAmp: this.frontMat.uniforms.uPulseAmp,
      time: this.frontMat.uniforms.uTime,
      floorAlbedo: { value: new THREE.Color(0.8, 0.79, 0.77) }, // (set with the look)
      floorEnv: { value: 0.75 },
      tintLocal: { value: 0 }, // layered jelly: the shadow's fill takes each band's colour
      // (several cubes) the one the panels edit, ringed on the floor: centre
      // x, z, half its side, its turn; its colour and how much the ring
      // shows; seconds since it was picked (a ping goes out)
      // the place's floor pattern (see floorpattern.js)
      pat: { value: 0 },
      patA: { value: new THREE.Vector3(0.1, 0.1, 0.1) },
      patB: { value: new THREE.Vector3(0.9, 0.9, 0.9) },
      patScale: { value: 1 },
      patGlow: { value: 0 },
      patSun: { value: new THREE.Vector2(lightDir.x, lightDir.z).normalize() }, // (toward the key light)
      sel: { value: new THREE.Vector4(0, 0, 0.5, 0) },
      selCol: { value: new THREE.Vector4(1, 1, 1, 0) },
      selPing: { value: 9 },
      // flour on the floor (see Flour): how much, over a square of it
      flour: { value: null },
      flourRect: { value: new THREE.Vector4(-3.2, -3.2, 1 / 6.4, 1 / 6.4) },
    };
    // (the jelly mirrors the floor: it reads the same textures)
    const fx = this.fxUniforms;
    Object.assign(this.frontMat.uniforms, {
      tCaustic: fx.caustic, tFloorFx: fx.floorFx, tFloorTint: fx.floorTint, tGlowMap: fx.glowTex, uFloorRect: fx.floorRect, uGlowRect: fx.glowRect, uFxLodBias: fx.fxLodBias, uCausRect: fx.causRect, uCausGain: fx.causGain, uTint: fx.tint,
      uGlowFloor: fx.glowFloor, uBg: fx.bg, uFloorAlbedo: fx.floorAlbedo, uFloorEnv: fx.floorEnv,
      uPat: fx.pat, uPatA: fx.patA, uPatB: fx.patB, uPatScale: fx.patScale, uPatGlow: fx.patGlow, uPatSun: fx.patSun,
    });
    this.rtBack = null;
    this._v = new THREE.Vector3();
    // the weld's seam textures (and the placeholders they replace)
    this._weldTex = null;
    this._weldEmpty = [this.frontMat.uniforms.uWeldSegs.value, this.frontMat.uniforms.uWeldCells.value];
  }

  setLightDir(d) {
    this.lightDir.copy(d).normalize();
    this.frontMat.uniforms.uLightDir.value.copy(d);
    this.causticMat.uniforms.uLightDir.value.copy(d);
    this.maskMat.uniforms.uLightDir.value.copy(d);
    this.tintMat.uniforms.uLightDir.value.copy(d);
  }

  // flavor: { hex } or { layers: [hex bottom..top] }
  // m: resolved material {depth, opacity, glow, rough, ior, sugar, milk}
  setStyle(flavor, m, size = 1) {
    const ref = 0.55 / m.depth;
    const colors = (flavor.layers || [flavor.hex]).map((h) => new THREE.Color(h));
    const abs = colors.map((c) => absorptionFromColor(c, ref));
    const scs = colors.map((c) => {
      const s = c.clone();
      return s.multiplyScalar(1 / Math.max(s.r, s.g, s.b, 1e-3));
    });
    const avgAbs = abs.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / abs.length);
    const avgSc = scs.reduce((a, b) => a.add(b), new THREE.Color(0, 0, 0)).multiplyScalar(1 / scs.length);
    const L = this.layerUniforms;
    if (flavor.layers) {
      L.uLayers.value = flavor.layers.length;
      L.uLayerY0.value = -size / 2;
      L.uLayerSpan.value = size;
      L.uLayerRep.value = Math.max(1, Math.round(flavor.repeat || 1));
      L.uLayerExp.value = biasExp(flavor.bias);
      L.uLayerBlur.value = flavor.blur || 0;
      abs.forEach((a, k) => L.uLayerAbs.value[k].copy(a));
      scs.forEach((c, k) => L.uLayerSc.value[k].set(c.r, c.g, c.b));
    } else L.uLayers.value = 0;
    const F = this.frontMat.uniforms;
    F.uAbsorb.value.copy(avgAbs);
    F.uScatterColor.value.copy(flavor.layers ? avgSc : scs[0]);
    // opacity -> cloudiness; near the top end even thin parts go solid
    const o = Math.min(1, Math.max(0, m.opacity));
    const scatter = 9 * o * o;
    const hazeMin = 0.92 * Math.min(1, Math.max(0, (o - 0.45) / 0.55)) ** 2;
    // colour of light that has crossed ~0.35 units of jelly (tints the shadow)
    const tint = new THREE.Color(0, 0, 0);
    for (const a of abs) tint.r += Math.exp(-a.x * 0.35), tint.g += Math.exp(-a.y * 0.35), tint.b += Math.exp(-a.z * 0.35);
    tint.multiplyScalar(1 / abs.length);
    const cloud = Math.max(m.milk, hazeMin);
    if (cloud) tint.lerp(new THREE.Color(1, 1, 1), 0.35 * cloud).multiplyScalar(1 - 0.35 * cloud);
    this.fxUniforms.tint.value.copy(tint);
    this.fxUniforms.tintLocal.value = flavor.layers ? 1 : 0;
    // healing light: a luminous, lighter version of the jelly colour
    F.uGlowColor.value.copy(avgSc).lerp(new THREE.Color(1, 1, 1), 0.55).multiplyScalar(0.9);
    F.uScatter.value = scatter + (flavor.layers ? 1.6 * (1 - o) : 0);
    F.uHazeMin.value = hazeMin;
    F.uGlow.value = m.glow;
    F.uRoughness.value = m.rough;
    F.uSugar.value = m.sugar;
    F.uMilk.value = m.milk;
    F.uIrid.value = m.irid || 0;
    F.uMetal.value = m.metal || 0;
    F.uOpal.value = m.opal || 0;
    F.uIor.value = m.ior;
    F.uDispersion.value = 0.018 * Math.max(0, m.ior - 1) / 0.36;
  }

  // One cube's look (its slot k: flavour, material m) into its row of the
  // cube-look texture, as setStyle works it out for the whole jelly.
  setCubeLook(k, flavor, m, size = 1) {
    const ref = 0.55 / m.depth;
    // (Rubik: its six colours where layers keep theirs, and a flag)
    const rubik = flavor.id === 'rubik';
    const colors = (rubik ? RUBIK_COLORS : flavor.layers || [flavor.hex]).map((h) => new THREE.Color(h));
    const abs = colors.map((c) => absorptionFromColor(c, ref));
    const scs = colors.map((c) => c.clone().multiplyScalar(1 / Math.max(c.r, c.g, c.b, 1e-3)));
    const avgAbs = abs.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / abs.length);
    const avgSc = scs.reduce((a, b) => a.add(b), new THREE.Color(0, 0, 0)).multiplyScalar(1 / scs.length);
    const many = rubik || !!flavor.layers;
    const sc = many ? avgSc : scs[0];
    const o = Math.min(1, Math.max(0, m.opacity));
    const glowC = avgSc.clone().lerp(new THREE.Color(1, 1, 1), 0.55).multiplyScalar(0.9);
    const D = this.cubeData, r = k * CUBE_TEX_W * 4;
    const put = (x, a, b, c, d) => {
      const i = r + x * 4;
      D[i] = a; D[i + 1] = b; D[i + 2] = c; D[i + 3] = d;
    };
    put(0, avgAbs.x, avgAbs.y, avgAbs.z, 9 * o * o + (many ? 1.6 * (1 - o) : 0));
    put(1, sc.r, sc.g, sc.b, hazeMinOf(o));
    put(2, m.glow, m.rough, m.ior, (0.018 * Math.max(0, m.ior - 1)) / 0.36);
    put(3, m.sugar || 0, m.milk || 0, m.irid || 0, m.metal || 0);
    put(4, m.opal || 0, rubik ? -1 : flavor.layers ? flavor.layers.length : 0, -size / 2, size);
    put(5, Math.max(1, Math.round(flavor.repeat || 1)), biasExp(flavor.bias), flavor.blur || 0, rubik ? flavor.rubik : 0);
    put(6, glowC.r, glowC.g, glowC.b, flavor.layers ? GRAD_SHAPE_INDEX[flavor.shape] || 0 : 0);
    for (let j = 0; j < 10; j++) {
      const a = abs[Math.min(j, abs.length - 1)], c = scs[Math.min(j, scs.length - 1)];
      // (alpha: a Rubik's white sticker is milky, not clear)
      put(7 + j, a.x, a.y, a.z, rubik && j === 0 ? 0.7 : 0);
      put(17 + j, c.r, c.g, c.b, 0);
    }
    // the colour of light that's crossed ~0.35 units of it (its shadow's -
    // see createTintMaterial), and how much its caustics scatter
    const tint = new THREE.Color(0, 0, 0);
    for (const a of abs) tint.r += Math.exp(-a.x * 0.35), tint.g += Math.exp(-a.y * 0.35), tint.b += Math.exp(-a.z * 0.35);
    tint.multiplyScalar(1 / abs.length);
    const cloud = Math.max(m.milk || 0, hazeMinOf(o));
    if (cloud) tint.lerp(new THREE.Color(1, 1, 1), 0.35 * cloud).multiplyScalar(1 - 0.35 * cloud);
    put(27, tint.r, tint.g, tint.b, 9 * o * o + (m.milk || 0) * 3);
    put(28, 1 / ref, Math.max(1, Math.round(flavor.tiles || 1)), 0, 0);
    // its coats and skins: a dusting on the outside, iridescence and metal only
    // on the outside (a film, a foil), sugar all through
    put(29, m.dust || 0, m.skin || 0, m.through ? 1 : 0, 0);
    this.cubeTex.needsUpdate = true;
    if (flavor.layers && flavor.shape === 'free') {
      bakeFree(flavor, this.freeData.subarray(k * this.freeSlab, (k + 1) * this.freeSlab));
      this.freeTex.needsUpdate = true;
    } else if (flavor.layers) this._gradStrip(k, flavor, abs, scs);
  }

  // A layered cube's gradient as its strip: absorption (its first row) and
  // the colour of the light inside (its second) at GRAD_N steps along its
  // shape - the stops, blend, repeat and bias worked in (styles.js gradAt).
  _gradStrip(k, flavor, abs, scs) {
    const D = this.gradData, N = GRAD_N, seq = gradSequence(flavor), h = THREE.DataUtils.toHalfFloat;
    const r0 = k * 2 * N * 4, r1 = r0 + N * 4;
    for (let j = 0; j < N; j++) {
      const { a, b, s } = gradAt(flavor, j / (N - 1), seq), t = 1 - s, i = j * 4;
      const A = abs[a], B = abs[b], P = scs[a], Q = scs[b];
      D[r0 + i] = h(Math.min(6e4, A.x * t + B.x * s));
      D[r0 + i + 1] = h(Math.min(6e4, A.y * t + B.y * s));
      D[r0 + i + 2] = h(Math.min(6e4, A.z * t + B.z * s));
      D[r0 + i + 3] = h(1);
      D[r1 + i] = h(P.r * t + Q.r * s);
      D[r1 + i + 1] = h(P.g * t + Q.g * s);
      D[r1 + i + 2] = h(P.b * t + Q.b * s);
      D[r1 + i + 3] = h(1);
    }
    this.gradTex.needsUpdate = true;
  }

  _setWeldSeams(near) {
    const U = this.frontMat.uniforms;
    if (this._weldTex) for (const t of this._weldTex) t.dispose();
    this._weldTex = null;
    if (!near) {
      [U.uWeldSegs.value, U.uWeldCells.value] = this._weldEmpty;
      U.uWeldGridN.value = 0;
      return;
    }
    const tex = (data, h) => {
      const t = new THREE.DataTexture(data, 1024, h, THREE.RGBAFormat, THREE.FloatType);
      t.minFilter = t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      return t;
    };
    this._weldTex = [tex(near.segs, near.segH), tex(near.cells, near.cellH)];
    [U.uWeldSegs.value, U.uWeldCells.value] = this._weldTex;
    U.uWeldGrid.value.set(near.origin, near.origin, near.origin, near.invC);
    U.uWeldGridN.value = near.n;
    U.uWeldUnit.value = near.unit;
  }

  setSize(w, h) {
    if (this.rtBack) this.rtBack.dispose();
    this.rtBack = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true });
    this.rtBackRest?.dispose();
    this.rtBackRest = null;
    this.frontMat.uniforms.resolution.value.set(w, h);
  }

  syncTopology(sb) {
    if (sb.topoVersion === this.topoVersion) return false;
    this.topoVersion = sb.topoVersion;
    for (const m of [this.allMesh, ...this.layerMeshes]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.allMesh = null;
    this.layerMeshes = [];
    if (this.mirror) this.reflScene.remove(this.mirror);
    this.mirror = null;
    const nB = sb.rCount;
    const rIndex = sb.rIndex, rSim = sb.rSim;
    const nTri = rIndex.length / 3;
    // --- two levels of subdivision (16 triangles per simulated one). The
    // new points are Phong-tessellated from the moving surface; on the
    // cube's original outside each is also pushed out along its normal by
    // a fixed amount, measured at rest, that puts it exactly on the true
    // rounded-box shape there (the simulation's grid only gets ~2 segments
    // round a bevel).
    const L1 = splitEdges(rIndex, rSim, nB);
    const nL1 = nB + L1.mids.length / 3;
    const geo1 = new Int32Array(nL1);
    for (let r = 0; r < nB; r++) geo1[r] = rSim[r];
    for (let j = 0; j < L1.midGeo.length; j++) geo1[nB + j] = sb.nV + L1.midGeo[j];
    // the first level at rest, against the true shape
    const maxN = nL1 + L1.index.length; // (at most one more vertex per level-1 edge side)
    const rest = new Float32Array(maxN * 3);
    const restN = new Float32Array(maxN * 3);
    // (each cube's rest shape in its own frame: the offset that keeps them
    // apart in rest space taken off)
    for (let r = 0; r < nB; r++) {
      const i = rSim[r] * 3;
      rest[r * 3] = sb.X[i] - sb.vCube[rSim[r]] * REST_STEP; rest[r * 3 + 1] = sb.X[i + 1]; rest[r * 3 + 2] = sb.X[i + 2];
    }
    vertexNormals(rIndex, rest, restN, nB);
    // (each cube its own rounding; each render vertex knows its cube - the
    // new points their edge's)
    const shapes = Array.from(sb.cBevel, (b, k) => ({ a: sb.cSize[k] / 2 - b, r: b }));
    const cube = new Float32Array(maxN);
    for (let r = 0; r < nB; r++) cube[r] = sb.vCube[rSim[r]];
    for (let m = 0, k = nB; m < L1.mids.length; m += 3, k++) cube[k] = cube[L1.mids[m]];
    this.disp1 = new Float32Array(L1.mids.length / 3);
    tessellate(rest, restN, null, L1.mids, nB, this.disp1);
    snapToShape(rest, restN, L1.mids, nB, this.disp1, shapes, cube);
    // the second level only where the surface curves (bevels, corners): flat
    // faces - and the cut faces a burst leaves - gain nothing from it
    const t1 = L1.index.length / 3;
    const refine = new Uint8Array(t1);
    for (let t = 0; t < t1; t++) {
      const a = L1.index[t * 3] * 3, b = L1.index[t * 3 + 1] * 3, c = L1.index[t * 3 + 2] * 3;
      const ab = restN[a] * restN[b] + restN[a + 1] * restN[b + 1] + restN[a + 2] * restN[b + 2];
      const bc = restN[b] * restN[c] + restN[b + 1] * restN[c + 1] + restN[b + 2] * restN[c + 2];
      const ca = restN[c] * restN[a] + restN[c + 1] * restN[a + 1] + restN[c + 2] * restN[a + 2];
      refine[t] = Math.min(ab, bc, ca) < 0.996 ? 1 : 0; // (> ~5 degrees between normals)
    }
    const L2 = splitEdges(L1.index, geo1, nL1, refine);
    const n = nL1 + L2.mids.length / 3;
    this.mids1 = L1.mids;
    this.mids2 = L2.mids;
    this.nBase = nB;
    this.nL1 = nL1;
    this.nRender = n;
    this.pos = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    this.data = new Float32Array(n * 4);
    this.disp2 = new Float32Array(L2.mids.length / 3);
    for (let m = 0, k = nL1; m < L2.mids.length; m += 3, k++) cube[k] = cube[L2.mids[m]];
    tessellate(rest, restN, null, L2.mids, nL1, this.disp2);
    snapToShape(rest, restN, L2.mids, nL1, this.disp2, shapes, cube);
    const index = L2.index;
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aNrm = new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.BufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage);
    this.aRest = new THREE.BufferAttribute(rest.slice(0, n * 3), 3);
    this.aCube = new THREE.BufferAttribute(cube.slice(0, n), 1);
    // distance from the just-healed seams (see Healer._fuse, weldFieldJob)
    const weld = new Float32Array(n).fill(99);
    if (sb.weld && sb.weld.topo === sb.topoVersion) {
      const d = sb.weld.dist;
      for (let r = 0; r < nB; r++) weld[r] = d[rSim[r]];
      // the edge midpoints measure for themselves (a seam line often runs
      // between two vertices; averaging would blur it out)
      for (const [mids, first] of [[this.mids1, nB], [this.mids2, nL1]]) {
        for (let m = 0, k = first; m < mids.length; m += 3, k++) {
          const wa = weld[mids[m]], wb = weld[mids[m + 1]];
          weld[k] = Math.min(wa, wb) < 0.12 ? sb.weld.at(rest[k * 3], rest[k * 3 + 1], rest[k * 3 + 2]) : (wa + wb) * 0.5;
        }
      }
    }
    this.aWeld = new THREE.BufferAttribute(weld, 1);
    // and the seams themselves, for exact distances close to them per pixel
    this._setWeldSeams(sb.weld && sb.weld.topo === sb.topoVersion ? sb.weld.near : null);
    const geom = (idx) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', this.aPos);
      g.setAttribute('normal', this.aNrm);
      g.setAttribute('aData', this.aData);
      g.setAttribute('aRest', this.aRest);
      g.setAttribute('aWeld', this.aWeld);
      g.setAttribute('aCube', this.aCube);
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      return g;
    };
    // each piece's run of the final triangles (index sorted by piece: a
    // base triangle -> its level-1 ones, 4 each -> its final ones)
    const NP = sb.pieceRanges.length;
    this.pieceIdx = new Int32Array(NP * 2);
    sb.pieceRanges.forEach((rg, k) => {
      this.pieceIdx[k * 2] = L2.start[(rg.start / 3) * 4];
      this.pieceIdx[k * 2 + 1] = L2.start[((rg.start + rg.count) / 3) * 4];
    });
    const full = index.slice(0, this.pieceIdx[NP * 2 - 1] || 0);
    this.fullIndex = full;
    const all = geom(full);
    this.allMesh = new THREE.Mesh(all, this.frontMat);
    this.allMesh.frustumCulled = false;
    this.scene.add(this.allMesh);
    for (let L = 0; L < this.maxLayers; L++) {
      const m = new THREE.Mesh(geom(new full.constructor(full.length)), this.frontMat);
      m.frustumCulled = false;
      m.visible = false;
      this.scene.add(m);
      this.layerMeshes.push(m);
    }
    this.layerOf = new Int8Array(NP).fill(-1);
    this.layerCount = new Int32Array(this.maxLayers);
    this.mirror = new THREE.Mesh(all, this.reflectMat);
    this.mirror.frustumCulled = false;
    this.mirror.scale.y = -1;
    this.reflScene.add(this.mirror);
    return true;
  }

  // The pieces' render vertices (positions, normals, temperature and glow),
  // subdivided twice, up to the GPU - only when they've changed: a jelly at
  // rest sent every frame was ~2 MB a frame, a flood set into a sheet 6 MB
  // (the GPU choked on it). Thawing alone - temperatures creeping, nothing
  // moving - goes 5 times a second, and only its temperatures.
  update(sb) {
    const topo = this.syncTopology(sb);
    const n = sb.nV, x = sb.x, temp = sb.temp, glow = sb.glow, dust = sb.dust;
    let ps = 0, ts = 0, gs = 0, ds = 0;
    for (let i = 0; i < n; i++) {
      const w = 1 + (i & 7) * 0.37, o = i * 3;
      ps += (x[o] + x[o + 1] * 1.3 + x[o + 2] * 1.7) * w;
      ts += temp[i] * w;
      ds += dust[i] * w;
      gs += glow[i];
    }
    const fill = sb.fill && sb.fill.topo === sb.topoVersion;
    const moved = topo || fill || ps !== this._ps;
    const now = performance.now();
    const warmed = ts !== this._ts && now - (this._dataAt || 0) > 200;
    // (flour landing on it: as soon as it's there)
    const floured = ds !== this._ds;
    if (!moved && !warmed && !floured && !(gs > 0 || this._gs > 0)) return;
    this._ps = ps;
    this._ts = ts;
    this._gs = gs;
    this._ds = ds;
    this._dataAt = now;
    const pos = this.pos, nrm = this.nrm, data = this.data;
    sb.writeRender(pos, nrm, data);
    if (fill) this._fill(sb, sb.fill);
    tessellate(pos, nrm, data, this.mids1, this.nBase, this.disp1);
    tessellate(pos, nrm, data, this.mids2, this.nL1, this.disp2);
    if (moved) {
      this.aPos.needsUpdate = true;
      this.aNrm.needsUpdate = true;
    }
    this.aData.needsUpdate = true;
  }

  // The heal's liquid fill: what was missing rises from its holes' walls
  // to where it belongs, like a level rising at one speed everywhere (a
  // part twice as far from the wall takes twice as long), easing in at the
  // end. The surface's normals follow the moving shape.
  _fill(sb, F) {
    const pos = this.pos, nrm = this.nrm, rSim = sb.rSim, nB = this.nBase;
    let moved = false;
    for (let r = 0; r < nB; r++) {
      const i = rSim[r], d = F.d[i];
      if (d < 0) continue;
      const u = Math.min(1, F.t / Math.max(1e-3, (F.dur * d) / F.dmax));
      const g = 1 - (1 - u) * (1 - u);
      if (g >= 1) continue;
      const o = r * 3, k = (1 - g);
      pos[o] += F.off[i * 3] * k; pos[o + 1] += F.off[i * 3 + 1] * k; pos[o + 2] += F.off[i * 3 + 2] * k;
      moved = true;
    }
    if (!moved) return;
    nrm.fill(0, 0, nB * 3);
    const ix = sb.rIndex;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const q of [a, b, c]) {
        nrm[q] += nx; nrm[q + 1] += ny; nrm[q + 2] += nz;
      }
    }
    for (let r = 0; r < nB; r++) {
      const o = r * 3, l = Math.hypot(nrm[o], nrm[o + 1], nrm[o + 2]) || 1;
      nrm[o] /= l; nrm[o + 1] /= l; nrm[o + 2] /= l;
    }
  }

  // glow mode: how brightly it shines (0 off .. 1)
  setEmit(v) {
    this.frontMat.uniforms.uEmit.value = v;
    this.reflectMat.uniforms.uEmit.value = v;
  }

  // a ring of light racing out through it from (x, y, z), starting at time t
  // (glow mode); it takes the slot that's been running longest
  pulse(x, y, z, amp, t, col) {
    const P = this.frontMat.uniforms.uPulse.value, A = this.frontMat.uniforms.uPulseAmp.value;
    const C = this.fxUniforms.pulseCol.value;
    let k = 0;
    for (let i = 0; i < P.length; i++) {
      // (one just started close by: make that one stronger instead)
      if (t - P[i].w < 0.12 && (P[i].x - x) ** 2 + (P[i].y - y) ** 2 + (P[i].z - z) ** 2 < 0.04) {
        A[i] = Math.min(1.5, Math.max(A[i], amp) + 0.25 * amp);
        return;
      }
      if (P[i].w < P[k].w) k = i;
    }
    P[k].set(x, y, z, t);
    A[k] = amp;
    if (col) C[k].set(col.r, col.g, col.b);
  }

  // The jelly mirrored in the floor, into rt (the floor samples it).
  renderReflection(camera, rt) {
    const r = this.renderer;
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(this.reflScene, camera);
    r.setClearColor(prevClear, prevAlpha);
  }

  // The key light's view of the jelly, framed to fit the pieces.
  _fitLightView(sb) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const pc of sb.pieces) {
      let b = pc.bbox;
      if (!b) continue;
      // (not stepped yet - the warm-up's render, before the drop: from its
      // vertices, so the caustics' shaders compile then and not mid-drop)
      if (!(b[3] > b[0])) {
        b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (const i of pc.verts) {
          for (let c = 0; c < 3; c++) {
            b[c] = Math.min(b[c], sb.x[i * 3 + c]);
            b[c + 3] = Math.max(b[c + 3], sb.x[i * 3 + c]);
          }
        }
      }
      x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); z0 = Math.min(z0, b[2]);
      x1 = Math.max(x1, b[3]); y1 = Math.max(y1, b[4]); z1 = Math.max(z1, b[5]);
    }
    if (!(x1 > x0)) return false;
    const cam = this.lightCam, L = this.lightDir, c = this.lightOrigin.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    cam.position.copy(c).addScaledVector(L, 12);
    cam.up.set(0, Math.abs(L.y) > 0.98 ? 0 : 1, Math.abs(L.y) > 0.98 ? 1 : 0);
    cam.lookAt(c);
    cam.updateMatrixWorld();
    let u0 = Infinity, v0 = Infinity, w0 = Infinity, u1 = -Infinity, v1 = -Infinity, w1 = -Infinity;
    const p = this._corner;
    for (let k = 0; k < 8; k++) {
      p.set(k & 1 ? x1 : x0, k & 2 ? y1 : y0, k & 4 ? z1 : z0).applyMatrix4(cam.matrixWorldInverse);
      u0 = Math.min(u0, p.x); u1 = Math.max(u1, p.x);
      v0 = Math.min(v0, p.y); v1 = Math.max(v1, p.y);
      w0 = Math.min(w0, p.z); w1 = Math.max(w1, p.z);
    }
    const m = 0.03;
    cam.left = u0 - m; cam.right = u1 + m; cam.bottom = v0 - m; cam.top = v1 + m;
    cam.near = Math.max(0.01, -w1 - 0.5); cam.far = -w0 + 0.5;
    cam.updateProjectionMatrix();
    this.causticMat.uniforms.uLightVP.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.causticMat.uniforms.uLightInvVP.value.copy(this.causticMat.uniforms.uLightVP.value).invert();
    this.causticMat.uniforms.uOrigin.value.copy(c);
    // the caustics' texture: the pieces' footprint and their straight
    // shadow, squared up (where light bent through them can land) - ~3 mm a
    // texel for one cube, so a cell of focused light still covers a texel
    let fx0 = x0, fz0 = z0, fx1 = x1, fz1 = z1;
    const kx = -L.x / L.y, kz = -L.z / L.y;
    for (const yy of [y0, y1]) {
      fx0 = Math.min(fx0, x0 + kx * yy, x1 + kx * yy); fx1 = Math.max(fx1, x0 + kx * yy, x1 + kx * yy);
      fz0 = Math.min(fz0, z0 + kz * yy, z1 + kz * yy); fz1 = Math.max(fz1, z0 + kz * yy, z1 + kz * yy);
    }
    const size = Math.min(6.4, Math.max(1, fx1 - fx0, fz1 - fz0) + 0.4);
    const cx = (fx0 + fx1) / 2, cz = (fz0 + fz1) / 2;
    const CR = this.fxUniforms.causRect.value;
    CR.set(cx - size / 2, cz - size / 2, 1 / size, 1 / size);
    this.causticMat.uniforms.uCausRect.value.copy(CR);
    return true;
  }

  // The jelly's shadow-and-contact map, framed round the pieces, their
  // shadow along the key light and room for the floor's widest blur taps
  // (~40 cm). The floor's tap offsets and the jelly's blur levels are
  // rescaled so the blurs keep their size in the world.
  _fitFloorFx(sb) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    if (sb) {
      for (const pc of sb.pieces) {
        const b = pc.bbox;
        if (!b || !(b[3] > b[0])) continue;
        x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); z0 = Math.min(z0, b[2]);
        x1 = Math.max(x1, b[3]); y1 = Math.max(y1, b[4]); z1 = Math.max(z1, b[5]);
      }
    }
    let S = FLOOR_SPAN, cx = 0, cz = 0;
    if (x1 > x0) {
      const L = this.lightDir, kx = -L.x / L.y, kz = -L.z / L.y;
      let fx0 = x0, fz0 = z0, fx1 = x1, fz1 = z1;
      for (const yy of [Math.max(0, y0), Math.max(0, y1)]) {
        fx0 = Math.min(fx0, x0 + kx * yy, x1 + kx * yy); fx1 = Math.max(fx1, x0 + kx * yy, x1 + kx * yy);
        fz0 = Math.min(fz0, z0 + kz * yy, z1 + kz * yy); fz1 = Math.max(fz1, z0 + kz * yy, z1 + kz * yy);
      }
      // (in steps, so a moving piece doesn't make the texels crawl)
      S = Math.min(FLOOR_SPAN, Math.max(1.6, Math.ceil((Math.max(fx1 - fx0, fz1 - fz0) + 1.1) / 0.4) * 0.4));
      const g = S / 64;
      cx = Math.round((fx0 + fx1) / 2 / g) * g;
      cz = Math.round((fz0 + fz1) / 2 / g) * g;
    }
    this.fxRect.set(cx - S / 2, cz - S / 2, 1 / S, 1 / S);
    const k = FLOOR_SPAN / 512 / S;
    this.fxUniforms.texel.value.set(k, k);
    this.fxUniforms.fxLodBias.value = Math.log2(FLOOR_SPAN / S);
  }

  renderFloorFx(sb) {
    const r = this.renderer;
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    // caustics: the light's view of the jelly, then its grid of rays
    const lit = sb && this.allMesh && this._fitLightView(sb);
    if (lit) {
      for (const { rt, mat } of this.lightView) {
        mat.uniforms.uOrigin.value.copy(this.lightOrigin);
        r.setRenderTarget(rt);
        r.clear(true, true, false);
        this.scene.overrideMaterial = mat;
        r.render(this.scene, this.lightCam);
      }
      this.scene.overrideMaterial = null;
    }
    // (several cubes: the jelly looks up the light's view for their shadows on each other)
    const F = this.frontMat.uniforms;
    F.uCubeShadow.value = lit && this.multiCube ? 1 : 0;
    if (lit) {
      F.uLightVP.value.multiplyMatrices(this.lightCam.projectionMatrix, this.lightCam.matrixWorldInverse);
      F.uLightOrigin.value.copy(this.lightOrigin);
    }
    r.setRenderTarget(this.rtCaustic);
    r.clear(true, false, false);
    if (lit) {
      const ch = this.causticMat.uniforms.uChannel;
      if (this.disperse) {
        const auto = r.autoClear;
        r.autoClear = false;
        for (let c = 0; c < 3; c++) {
          ch.value = c;
          r.render(this.gridScene, this.fxCam);
        }
        r.autoClear = auto;
      } else {
        ch.value = -1;
        r.render(this.gridScene, this.fxCam);
      }
    }
    // (blurred: ~3 mm sigma in the world, 2 steps of 1.5 mm; nothing there, nothing to blur)
    const cst = 0.0015 * this.fxUniforms.causRect.value.z;
    this.blurMat.uniforms.tSrc.value = this.rtCaustic.texture;
    this.blurMat.uniforms.uStep.value.set(cst, 0);
    r.setRenderTarget(this.rtCausticT);
    if (lit) r.render(this.blurScene, this.fxCam);
    else r.clear(true, false, false);
    this.blurMat.uniforms.tSrc.value = this.rtCausticT.texture;
    this.blurMat.uniforms.uStep.value.set(0, cst);
    r.setRenderTarget(this.rtCausticB);
    if (lit) r.render(this.blurScene, this.fxCam);
    else r.clear(true, false, false);
    this._fitFloorFx(sb);
    r.setRenderTarget(this.rtFloorFx);
    r.clear(true, false, false);
    const auto = r.autoClear;
    r.autoClear = false;
    this.scene.overrideMaterial = this.maskMat;
    r.render(this.scene, this.fxCam);
    this.scene.overrideMaterial = this.heightMat;
    r.render(this.scene, this.fxCam);
    r.setRenderTarget(this.rtFloorTint);
    r.clear(true, false, false);
    this.scene.overrideMaterial = this.tintMat;
    r.render(this.scene, this.fxCam);
    this.scene.overrideMaterial = null;
    // blurred, ~1.2 cm sigma in the world (2 steps of 0.6 cm)
    const st = (0.006 * this.fxRect.z) || 1 / 512;
    this.blurMat.uniforms.tSrc.value = this.rtFloorFx.texture;
    this.blurMat.uniforms.uStep.value.set(st, 0);
    r.setRenderTarget(this.rtFloorFxT);
    r.render(this.blurScene, this.fxCam);
    this.blurMat.uniforms.tSrc.value = this.rtFloorFxT.texture;
    this.blurMat.uniforms.uStep.value.set(0, st);
    r.setRenderTarget(this.rtFloorFxB);
    r.render(this.blurScene, this.fxCam);
    if (this.fxUniforms.glowFloor.value > 0) {
      r.setRenderTarget(this.rtGlow);
      r.clear(true, false, false);
      this.scene.overrideMaterial = this.glowMat;
      r.render(this.scene, this.fxCam);
    }
    r.autoClear = auto;
    this.scene.overrideMaterial = null;
    r.setClearColor(prevClear, prevAlpha);
  }

  // Each piece's surface points (a sample, at most SURF_N), for telling which
  // of two overlapping on screen is in front - see renderPieces
  _surfacePoints(sb) {
    const c = this._surfPts;
    if (c && c.topo === sb.topoVersion && c.n === sb.pieces.length) return c.lists;
    const NP = sb.pieces.length, seen = new Uint8Array(sb.nV), per = Array.from({ length: NP }, () => []);
    for (let f = 0; f < sb.nF * 3; f++) {
      const vi = sb.sTri[f];
      if (seen[vi]) continue;
      seen[vi] = 1;
      const k = sb.vPiece[vi];
      if (k >= 0 && k < NP) per[k].push(vi);
    }
    const lists = per.map((l) => {
      if (l.length <= SURF_N) return Int32Array.from(l);
      const st = l.length / SURF_N, out = new Int32Array(SURF_N);
      for (let q = 0; q < SURF_N; q++) out[q] = l[Math.floor(q * st)];
      return out;
    });
    this._surfPts = { topo: sb.topoVersion, n: NP, lists };
    return lists;
  }

  // Render pieces back-to-front in layers: pieces that don't overlap on
  // screen share a pass; a piece that overlaps one behind it goes in a later
  // layer so it refracts that piece.
  renderPieces(camera, sb, rtScene, rtTrans, copyFn) {
    const r = this.renderer;
    const v = this._v;
    if (!this.allMesh) return;
    const NP = Math.min(sb.pieces.length, this.pieceIdx.length / 2);
    const maxL = Math.min(this.maxLayers, this.layerMeshes.length);
    // (the layers as last time, if nothing's changed: the camera still, the
    // body the same and all of it asleep - or, only it moving, every other
    // frame: telling who's in front costs a little, a piece)
    const sig = this._layerSig || (this._layerSig = new Float64Array(34));
    const me = camera.matrixWorld.elements, pe = camera.projectionMatrix.elements;
    let same = sig[32] === sb.topoVersion && sig[33] === NP && this._layerMaxL === maxL;
    this._layerMaxL = maxL;
    for (let q = 0; q < 16 && same; q++) same = sig[q] === me[q] && sig[16 + q] === pe[q];
    let awake = false;
    for (let k = 0; k < NP && !awake; k++) awake = !!sb.pieces[k] && !sb.pieces[k].asleep;
    this._layerTick = (this._layerTick || 0) + 1;
    // (all at rest: one last full look - then that, until something moves)
    let items = same && this._layerItems && ((!awake && this._layerItems.complete) || (awake && this._layerTick % 2)) ? this._layerItems : null;
    const settled = same && !awake;
    if (!items) {
    for (let q = 0; q < 16; q++) { sig[q] = me[q]; sig[16 + q] = pe[q]; }
    sig[32] = sb.topoVersion;
    sig[33] = NP;
    items = [];
    for (let k = 0; k < NP; k++) {
      const pc = sb.pieces[k];
      if (!pc || this.pieceIdx[k * 2 + 1] <= this.pieceIdx[k * 2]) continue;
      const b = pc.bbox, pts = [];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, behind = false;
      for (let c = 0; c < 8; c++) {
        v.set(c & 1 ? b[3] : b[0], c & 2 ? b[4] : b[1], c & 4 ? b[5] : b[2]).project(camera);
        if (v.z > 1) behind = true;
        pts.push([v.x, v.y]);
        if (v.x < x0) x0 = v.x;
        if (v.x > x1) x1 = v.x;
        if (v.y < y0) y0 = v.y;
        if (v.y > y1) y1 = v.y;
      }
      // (its outline on screen: the hull of its surface points, below - or,
      // a corner of its box behind the camera, the box round them)
      const hull = behind ? [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] : null;
      const d = v.set(pc.com[0], pc.com[1], pc.com[2]).distanceToSquared(camera.position);
      items.push({ k, d, x0, y0, x1, y1, hull, area: 0, layer: 0 });
    }
    // Pieces overlapping on screen go into successive layers, so the nearer
    // refracts the farther. Overlap is by their outlines - by the boxes
    // round them, cubes stacked side by side chained up layer after layer
    // just touching. Which of two is nearer is told where they overlap: by
    // whose surface there is nearer the eye - by their middles' distance, a
    // shard lying on a big slice was behind it seen from some angles, and
    // the slice beneath vanished. Each layer costs two passes and a
    // full-screen copy, so there are only so many (maxLayers); past that,
    // layers are merged where the least overlaps: a nearer and a farther
    // piece sharing a layer, the nearer can't show the farther (it vanishes
    // behind it - a cube behind a cube, gone at some angles), so that's kept
    // to the least screen.
    const N = items.length, edges = [];
    const surf = this._surfacePoints(sb), VP = this._vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
    // Each piece's outline on screen: the hull of (a third of) its surface
    // points - for a shard, a convex piece, its very silhouette.
    const x = sb.x;
    const proj = (vi, out, o) => {
      const X = x[vi * 3], Y = x[vi * 3 + 1], Z = x[vi * 3 + 2];
      const w = VP[3] * X + VP[7] * Y + VP[11] * Z + VP[15];
      if (!(w > 1e-4)) return false;
      out[o] = (VP[0] * X + VP[4] * Y + VP[8] * Z + VP[12]) / w;
      out[o + 1] = (VP[1] * X + VP[5] * Y + VP[9] * Z + VP[13]) / w;
      out[o + 2] = w;
      return true;
    };
    const tmp = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      const it = items[i];
      it.pi = i;
      it.n = -1;
      if (!it.hull) {
        const list = surf[it.k] || [], pts = [];
        for (let q = 0; q < list.length; q += HULL_STEP) if (proj(list[q], tmp, 0)) pts.push([tmp[0], tmp[1]]);
        if (pts.length >= 3) {
          it.hull = convexHull(pts);
          it.x0 = Infinity; it.y0 = Infinity; it.x1 = -Infinity; it.y1 = -Infinity;
          for (const p of it.hull) {
            if (p[0] < it.x0) it.x0 = p[0];
            if (p[0] > it.x1) it.x1 = p[0];
            if (p[1] < it.y0) it.y0 = p[1];
            if (p[1] > it.y1) it.y1 = p[1];
          }
        } else it.hull = [[it.x0, it.y0], [it.x1, it.y0], [it.x1, it.y1], [it.x0, it.y1]];
      }
      it.area = polyArea(it.hull);
    }
    // (all its surface points on screen - x, y, depth - when a vote wants them)
    const scr = this._scr || (this._scr = []);
    const pointsOf = (it) => {
      if (it.n >= 0) return scr[it.pi];
      const list = surf[it.k] || [];
      const P3 = scr[it.pi] && scr[it.pi].length >= list.length * 3 ? scr[it.pi] : (scr[it.pi] = new Float32Array(Math.max(list.length, 16) * 3));
      let n = 0;
      for (let q = 0; q < list.length; q++) if (proj(list[q], P3, n * 3)) n++;
      it.n = n;
      return P3;
    };
    // Which is in front where two overlap: each one's points there vote -
    // is it nearer the eye than the other's surface right beside it on
    // screen? (Two that don't pass through each other: every point of the
    // one in front is in front of the other there.) A's share of the votes,
    // -1 if none; the other's points looked up in a little grid of cells.
    const inP = (P, qx, qy) => {
      for (let e = 0; e < P.length; e++) {
        const A = P[e], B = P[(e + 1) % P.length];
        if ((B[0] - A[0]) * (qy - A[1]) - (B[1] - A[1]) * (qx - A[0]) < 0) return false;
      }
      return true;
    };
    const selA = this._selA || (this._selA = new Int32Array(512)), selB = this._selB || (this._selB = new Int32Array(512));
    const pick = (it, P, bx0, by0, bx1, by1, out) => {
      const S = pointsOf(it);
      let m = 0;
      for (let q = 0; q < it.n && m < out.length; q++) {
        const qx = S[q * 3], qy = S[q * 3 + 1];
        if (qx >= bx0 && qx <= bx1 && qy >= by0 && qy <= by1 && inP(P, qx, qy)) out[m++] = q;
      }
      return m;
    };
    const cellHead = this._cellHead || (this._cellHead = new Int32Array(16 * 16)), cellNext = this._cellNext || (this._cellNext = new Int32Array(512));
    const vote = (a, b, P, bx0, by0, bx1, by1, rad) => {
      const na = pick(a, P, bx0, by0, bx1, by1, selA), nb = pick(b, P, bx0, by0, bx1, by1, selB);
      if (!na || !nb) return -1;
      const SA = scr[a.pi], SB = scr[b.pi], r2 = rad * rad;
      const C = Math.max(1, Math.min(16, Math.floor(Math.max(bx1 - bx0, by1 - by0) / rad))), cw = Math.max(bx1 - bx0, 1e-6) / C, ch = Math.max(by1 - by0, 1e-6) / C;
      let forA = 0, n = 0;
      // (T's points into cells, then each of S's against T's in the cells round it)
      const tally = (S, sel, ns, T, tsel, nt, mine) => {
        cellHead.fill(-1, 0, C * C);
        for (let k = 0; k < nt; k++) {
          const q = tsel[k] * 3, c = Math.min(C - 1, Math.floor((T[q] - bx0) / cw)) + C * Math.min(C - 1, Math.floor((T[q + 1] - by0) / ch));
          cellNext[k] = cellHead[c];
          cellHead[c] = k;
        }
        const rx = Math.ceil(rad / cw), ry = Math.ceil(rad / ch);
        for (let k = 0; k < ns; k++) {
          const q = sel[k] * 3, sx = S[q], sy = S[q + 1];
          const cx = Math.min(C - 1, Math.floor((sx - bx0) / cw)), cy = Math.min(C - 1, Math.floor((sy - by0) / ch));
          let near = Infinity;
          for (let yy = Math.max(0, cy - ry); yy <= Math.min(C - 1, cy + ry); yy++)
            for (let xx = Math.max(0, cx - rx); xx <= Math.min(C - 1, cx + rx); xx++)
              for (let t = cellHead[xx + C * yy]; t >= 0; t = cellNext[t]) {
                const u = tsel[t] * 3, dx = T[u] - sx, dy = T[u + 1] - sy;
                if (dx * dx + dy * dy < r2 && T[u + 2] < near) near = T[u + 2];
              }
          if (near === Infinity) continue;
          n++;
          if (S[q + 2] < near === mine) forA++;
        }
      };
      tally(SA, selA, na, SB, selB, nb, true);
      tally(SB, selB, nb, SA, selA, na, false);
      return n ? forA / n : -1;
    };
    // (decisions kept from frame to frame, a few looked at again each frame
    // in turn - a turning view changes them slowly; a pair not yet decided
    // goes by their middles meanwhile)
    if (this._pairTopo !== sb.topoVersion || !this._pairs) {
      this._pairs = new Map();
      this._pairTopo = sb.topoVersion;
    }
    const pairs = this._pairs, tick = this._layerTick;
    let budget = settled ? Infinity : 24, complete = true;
    const into = new Int32Array(N), inW = new Float64Array(N), outE = Array.from({ length: N }, () => []);
    for (let i = 0; i < N; i++) {
      const a = items[i];
      for (let j = i + 1; j < N; j++) {
        const b = items[j];
        if (a.x0 > b.x1 || b.x0 > a.x1 || a.y0 > b.y1 || b.y0 > a.y1) continue;
        const P = clipConvex(a.hull, b.hull), ov = polyArea(P);
        // (a sliver - stacked neighbours, seen a little from above - is
        // left out: it would cost a layer for next to nothing)
        if (!(ov > 0.01 * Math.min(a.area, b.area))) continue;
        const key = Math.min(a.k, b.k) * 65536 + Math.max(a.k, b.k);
        let c = pairs.get(key);
        if (budget > 0 && (!c || tick - c.tick > 6)) {
          budget--;
          let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
          for (const p of P) {
            if (p[0] < bx0) bx0 = p[0];
            if (p[0] > bx1) bx1 = p[0];
            if (p[1] < by0) by0 = p[1];
            if (p[1] > by1) by1 = p[1];
          }
          // (beside: within a little of the overlap's size)
          const share = vote(a, b, P, bx0, by0, bx1, by1, 0.25 * Math.sqrt(ov) + 0.004);
          c = { tick, front: share >= 0 ? (share > 0.5 ? a.k : b.k) : -1, sure: share >= 0 ? Math.max(0.1, Math.abs(2 * share - 1)) : 0.1 };
          pairs.set(key, c);
        }
        if (!c || c.tick !== tick) complete = false;
        // (no say either way: their middles)
        const aFront = c && c.front >= 0 ? c.front === a.k : a.d < b.d;
        const back = aFront ? j : i, front = aFront ? i : j;
        edges.push(back, front, ov);
        outE[back].push(front);
        into[front]++;
        // (how much it'd cost to get wrong, to break a loop: the overlap, as
        // sure as the vote was)
        inW[front] += ov * (c ? c.sure : 0.1);
      }
    }
    // in order, behind before in front (the farthest first where it's free
    // to choose). A loop - each in front of the next, by a vote that got a
    // small overlap wrong - is broken where it costs least: the one whose
    // remaining "behind me" overlaps are fewest and least sure goes first.
    const done = new Uint8Array(N), order = [];
    const byFar = items.map((_, i) => i).sort((p, q) => items[q].d - items[p].d);
    while (order.length < N) {
      let pick = -1;
      for (const i of byFar) if (!done[i] && into[i] === 0) { pick = i; break; }
      if (pick < 0) {
        let best = Infinity;
        for (const i of byFar) if (!done[i] && inW[i] < best) { best = inW[i]; pick = i; }
      }
      done[pick] = 1;
      order.push(pick);
      for (const f of outE[pick]) into[f]--;
    }
    // each one's layer: one past the deepest of those behind it
    let depthN = 1;
    const depth = new Int32Array(N), inEdges = Array.from({ length: N }, () => []);
    for (let e = 0; e < edges.length; e += 3) inEdges[edges[e + 1]].push(edges[e]);
    const pos = new Int32Array(N);
    order.forEach((i, r) => (pos[i] = r));
    for (const i of order) {
      let dep = 0;
      for (const b of inEdges[i]) if (pos[b] < pos[i]) dep = Math.max(dep, depth[b] + 1);
      depth[i] = dep;
      depthN = Math.max(depthN, dep + 1);
    }
    for (let i = 0; i < N; i++) items[i].layer = depth[i];
    this._depthN = depthN; // (how many it'd take: ?stats, harnesses)
    if (depthN > maxL) {
      // merge the depths into maxL runs, in order, losing the least overlap:
      // W[x][y] = overlap between depth x (farther) and y; cost of a run =
      // what's inside it (a prefix sum over the square), a small DP over runs
      const D = depthN, W = new Float64Array(D * D);
      for (let e = 0; e < edges.length; e += 3) W[items[edges[e]].layer * D + items[edges[e + 1]].layer] += edges[e + 2];
      const S = new Float64Array((D + 1) * (D + 1));
      for (let x = 0; x < D; x++) for (let y = 0; y < D; y++) S[(x + 1) * (D + 1) + y + 1] = W[x * D + y] + S[x * (D + 1) + y + 1] + S[(x + 1) * (D + 1) + y] - S[x * (D + 1) + y];
      const run = (lo, hi) => S[(hi + 1) * (D + 1) + hi + 1] - S[lo * (D + 1) + hi + 1] - S[(hi + 1) * (D + 1) + lo] + S[lo * (D + 1) + lo];
      // best[g][e]: least lost with depths 0..e-1 in g runs; cut[g][e]: where the last run starts
      const best = [new Float64Array(D + 1).fill(Infinity)], cut = [new Int32Array(D + 1)];
      best[0][0] = 0;
      for (let g = 1; g <= maxL; g++) {
        best[g] = new Float64Array(D + 1).fill(Infinity);
        cut[g] = new Int32Array(D + 1);
        for (let e = 1; e <= D; e++)
          for (let st = g - 1; st < e; st++) {
            const c = best[g - 1][st] + run(st, e - 1);
            if (c < best[g][e]) {
              best[g][e] = c;
              cut[g][e] = st;
            }
          }
      }
      const group = new Int32Array(D);
      for (let g = maxL, e = D; g > 0; g--) {
        const st = cut[g][e];
        for (let x = st; x < e; x++) group[x] = g - 1;
        e = st;
      }
      for (const it of items) it.layer = group[it.layer];
      depthN = maxL;
    }
    items.depthN = depthN;
    items.complete = complete;
    this._layerItems = items;
    }
    let nLayers = items.depthN;
    // each layer's mesh: its pieces' runs of the index (rewritten only when
    // a piece changes layer)
    let changed = false;
    const layerOf = this.layerOf;
    const seen = new Uint8Array(NP);
    for (const it of items) {
      seen[it.k] = 1;
      if (layerOf[it.k] !== it.layer) changed = true;
      layerOf[it.k] = it.layer;
    }
    for (let k = 0; k < NP; k++) {
      if (!seen[k] && layerOf[k] !== -1) {
        layerOf[k] = -1;
        changed = true;
      }
    }
    if (changed) {
      const full = this.fullIndex, P = this.pieceIdx;
      for (let L = 0; L < maxL; L++) {
        const g = this.layerMeshes[L].geometry, idx = g.index;
        let n = 0;
        for (let k = 0; k < NP; k++) {
          if (layerOf[k] !== L) continue;
          idx.array.set(full.subarray(P[k * 2], P[k * 2 + 1]), n);
          n += P[k * 2 + 1] - P[k * 2];
        }
        if (n !== this.layerCount[L] || n) {
          idx.clearUpdateRanges();
          idx.addUpdateRange(0, n);
          idx.needsUpdate = true;
        }
        this.layerCount[L] = n;
        g.setDrawRange(0, n);
      }
    }
    const perLayer = this._perLayer || (this._perLayer = new Int32Array(16));
    perLayer.fill(0);
    for (const it of items) perLayer[it.layer]++;
    const auto = r.autoClear;
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    this.frontMat.uniforms.tScene.value = rtTrans.texture;
    // (the back: depth, normal and rest height where the line of sight
    // leaves - and, for a gradient that needs it, the whole rest point)
    const rest = this.needRest;
    if (rest && !this.rtBackRest) {
      const { width, height } = this.rtBack;
      this.rtBackRest = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: true, count: 2 });
    }
    const rtBack = rest ? this.rtBackRest : this.rtBack;
    this.frontMat.uniforms.tBack.value = rtBack.texture;
    this.frontMat.uniforms.tBackRest.value = rest ? rtBack.textures[1] : rtBack.texture;
    this.frontMat.uniforms.uBackRest.value = rest ? 1 : 0;
    this.layers = nLayers;
    this.allMesh.visible = false;
    for (let L = 0; L < nLayers; L++) {
      for (let q = 0; q < this.layerMeshes.length; q++) this.layerMeshes[q].visible = q === L && this.layerCount[q] > 0;
      r.autoClear = false;
      r.setClearColor(0x000000, 0);
      r.setRenderTarget(rtBack);
      r.clear(true, true, false);
      this.scene.overrideMaterial = rest ? this.backMatRest : this.backMat;
      r.render(this.scene, camera);
      r.setRenderTarget(rtScene);
      // (a big mesh, or several pieces sharing the layer: depth first)
      if (this.prepass && (this.layerCount[L] > 60000 || perLayer[L] > 1)) {
        this.scene.overrideMaterial = this.depthMat;
        r.render(this.scene, camera);
      }
      this.scene.overrideMaterial = null;
      r.render(this.scene, camera);
      if (L < nLayers - 1) copyFn();
    }
    for (const m of this.layerMeshes) m.visible = false;
    this.allMesh.visible = true;
    r.autoClear = auto;
    r.setClearColor(prevClear, prevAlpha);
  }

}
