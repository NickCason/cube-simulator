import * as THREE from 'three';
import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';
import { removeTets } from '../sim/cutting.js';
import { TAG_EXTERIOR, MAX_CUBES, REST_STEP, polarRot } from '../sim/softbody.js';
import { shapeSDF } from '../sim/mesh.js';

// Molten jelly. The torch turns the hottest jelly to liquid (see
// TorchTool): its tets go, and particles carry their volume on - position-
// based fluids (Macklin & Mueller 2013: a density constraint per particle,
// pushing only - no pull, so no clumping to fix), thick with viscosity, running down the jelly that's
// left (pushed out of its tets along its escape field), pooling on the
// floor. It cools; the cryo spray cools it fast, and a clump of it cold
// enough sets: meshed back into jelly - a new piece in whatever shape the
// puddle had. Drawn as one smooth glossy surface: the particles splatted
// into a field on a grid round them, its level set by marching cubes.

// (m) particle spacing: each carries D^3 of jelly - more, so a cube full of liquid's worth fits the pool's
// budget (see setDrop); its kernel's radius and its collision radius from it
let D = 0.065;
let H = D * 1.75;
let R_P = D * 0.5;
const CUT_R = 0.3; // (off a cut's faces, a drop's only this much of its radius wide: see _radius)
// marching cubes: corner offsets, edges' end corners
const MC_CX = [0, 1, 1, 0, 0, 1, 1, 0], MC_CY = [0, 0, 1, 1, 0, 0, 1, 1], MC_CZ = [0, 0, 0, 0, 1, 1, 1, 1];
const MC_EA = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3], MC_EB = [1, 2, 3, 0, 5, 6, 7, 4, 4, 5, 6, 7];
const SET_T = -0.25; // colder than this it sets
const STEP = 1 / 120; // (s) a substep, always (see _advance)
// (m) how far out from a drop caught in a cube full of liquid's jelly it looks for free space - see _free
const FREE_STEPS = [0.012, 0.025, 0.04, 0.06, 0.08, 0.1];
// (1/s) how hard drops in a narrow slit are held back - see _gaps
const GAP_DRAG = 18;
// A cube full of liquid, cut and squeezed: its liquid pressed out of its cuts (see _pressures, _squeeze) - the
// slits' hold on it gone at this much squeezed (a share of its hollow's volume), and how hard a drop at an opening
// is pushed out, m/s² a share
const PRESS_FREE = 0.06, PRESS_ACC = 80;
const ITER = 3; // solver rounds a substep
const MAXNB = 48; // neighbours kept per particle
const CELL_HASH = 1 << 14; // buckets for the jelly's tets near the liquid
const COL_HASH = 1024; // (columns, a splat wide, of the liquid in the cubes: its top in each - see _splatWalls)
const CUP_S = 6; // (a cup's hollow, looked at in so many points along each side: see _cups)
const NB6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const VMAX = 7; // (m/s)
const GAIN = 0.8; // (m/s) the most the solver speeds a particle up a substep
// (how much of the way off a cube full of liquid's shell a drop's pushed each substep, to its own width - see
// _radius: all of it at once, every drop against a wall chattered on it, and a cube's liquid never came to rest)
const RADIUS_K = 0.35;
const COH = 0.3; // cohesion: how hard thin parts pull together (vs packed parts pushing apart)
const EPS = +(globalThis.__fluidEps ?? 1); // constraint relaxation, x a full neighbourhood's gradient sum
const VISC = 0.25; // XSPH: how much each takes on its neighbours' velocity
// (thicker than this - slime, putty - it moves with what's round it, not through it, unless it's pushed hard: how
// hard, YIELD_K m/s for each unit of XSPH past it - see _step)
const YIELD_V = 0.6, YIELD_K = 4.0;

// A cube full of liquid's Viscosity (0..1, water to putty) as its drops have it: how much each takes on its
// neighbours' velocity (XSPH), and a drag on it (1/s). (It was set as a cube was filled, and kept: the slider did
// nothing to the liquid already in it; and it went from a syrupy 0.12 to glue - see Fluid.setVisc.)
// (Curved so the default, 0.15, is the liquid as it was - 0.205, 0.675/s: thinner there, a cube's liquid at rest
// kept on sloshing and never slept, 8 ms a frame for nothing. The drag held to 1/s: thickness is in how it moves
// against itself - a drag on all of it was slow motion, putty falling as on the moon.)
export function liquidVisc(v) {
  const c = Math.min(1, Math.max(0, v));
  return [0.04 + 0.91 * Math.pow(c, 0.9), Math.min(1, 60 * Math.pow(c, 2.37))];
}
// its surface: each particle a smooth bump out to SPLAT_R particles' spacing, the surface where they add up to
// SPLAT_ISO - wider bumps, a higher level: a smoother skin on it, a pool flat (at 1.6 and 0.55 it was lumpy,
// a heap of beads)
const SPLAT_R = +(globalThis.__splatR ?? 2.1), SPLAT_ISO = +(globalThis.__splatIso ?? 1.0);

export class Fluid {
  constructor(app) {
    this.app = app;
    const coarse = !!app.coarse;
    this.max = coarse ? 1000 : 1600; // (more than that boils off: see TorchTool._liquefy)
    const N = this.max;
    this.n = 0;
    this.x = new Float32Array(N * 3);
    this.q = new Float32Array(N * 3); // (predicted positions)
    this.v = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    this.temp = new Float32Array(N);
    // (acid: how strong it still is - 0, molten jelly - and the jelly's tet
    // it pressed into this frame, -1 none: see AcidTool)
    this.acid = new Float32Array(N);
    this.acidTet = new Int32Array(N).fill(-1);
    this.own = new Int32Array(N); // (the cube full of liquid it was filled into, by SoftBody.cHid - 0, none: see Spill)
    // (the cube full of liquid it's in, its slot + 1 - 0, none; 255, not looked yet: as of its surface last made,
    // see _splat - for the bubbles in it, see Bubbles.poolTick)
    this.dIn = new Uint8Array(N);
    // (each by an opening into its cube - a cut's faces near it, or in a slit - this frame: see _squeeze)
    this.atCut = new Uint8Array(N);
    // (each cube full of liquid: how hard it's squeezed - see _pressures - its middle; whether any is)
    this.press = new Float32Array(MAX_CUBES);
    this.pressC = new Float32Array(MAX_CUBES * 3);
    this.pressOn = 0;
    // (each cube's liquid drawn only up to this height - being put back into it, re-cubed: see Injector - and how
    // many are; Infinity, all of it)
    this.revealY = new Float32Array(MAX_CUBES).fill(Infinity);
    this.revealOn = 0;
    this.keepAwake = false; // (acid still working: the pool mustn't sleep)
    // (how runny each is: XSPH share of its neighbours' velocity, and a drag of its own - molten jelly
    // VISC and none; what spills from a cube full of liquid, water to glue: see Spill)
    this.onRemap = []; // (told of each compaction: map[old] = new, -1 gone - null, all gone; and how many there were)
    this._map = null;
    this.visc = new Float32Array(N).fill(VISC);
    this.thick = new Float32Array(N);
    // (how it clings - its cube's Surface tension, 0..1, water 0.5: to its walls as drawn, see _splatWall, and to
    // the bubbles at its top, see Bubbles.poolTick)
    this.tens = new Float32Array(N).fill(0.5);
    this._sw = new Float32Array(N); // (each drop's neighbours' weight, summed - their velocity's mean: see _step)
    // (thick stuff - slime, putty - at rest on what's under it: no gravity for it the next substep - see _step)
    this._rested = new Uint8Array(N);
    this._gw = new Float64Array(3);
    this._colTop = new Float32Array(COL_HASH);
    // (and how much of it each carries, in particles' worth - more than one, a spill bigger than the pool has
    // room for: they sit that much further apart, so it fills as much as it did - see Spill)
    this.mass = new Float32Array(N).fill(1);
    // (this substep's pushes out of the jelly, per particle, and the jelly's velocity where it pushed - summed,
    // and how many pushes: see _collide, _radius, _step - a push out of it isn't a kick, and it moves with what
    // it's against)
    this.cpush = new Float32Array(N * 3);
    this.cvel = new Float32Array(N * 3);
    this.cvn = new Float32Array(N);
    // (where each was last outside the jelly: out of it, it goes back that way - see _collide)
    this.lastOut = new Float32Array(N * 3);
    this._f3 = new Float64Array(3);
    this._carry = 0; // (s the jelly's moved on for since the liquid last looked: a frame's, at its first - see _collide)
    this._acc = 0; // (s of liquid time still to step: it's stepped in whole substeps of STEP - see _advance)
    // (a hollow's faces, or its outside's, in a grid over x, z - see _contain, _xzBuild - and how many drops it's
    // put back, all told; whether each was inside its cube's outside skin last time, 2 not known, and where)
    this._contained = 0;
    this._tri = new Int32Array(3 * 1024);
    this._cuts = new Float32Array(3 * 256);
    this._xzTri = this._tri;
    this._xzG = new Float64Array(6);
    this.envIn = new Uint8Array(N);
    this.envPrev = new Float32Array(N * 3);
    this._envN = -1;
    this._cgStart = new Int32Array(1024);
    this._cgList = new Int32Array(4096);
    // (going nowhere: where each was half a second ago, how long since, how many windows running it's stayed
    // put, how many there were - see update)
    this._nwX = new Float32Array(N * 3);
    this._nwT = 0;
    this._nwOK = 0;
    this._nwN = -1;
    this._gapSeen = new Uint8Array(N); // (dragged in a slit's crack since the last look - see update)
    this._flowT = 9; // (s since liquid was last seen running through a slit)
    this._gapVer = -1;
    this._anySlit = false;
    // (26 ways out, unit: see _free)
    const U = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) if (a || b || c) {
      const l = Math.hypot(a, b, c);
      U.push(a / l, b / l, c / l);
    }
    this._dirs26 = Float64Array.from(U);
    this.age = new Float32Array(N);
    this.lam = new Float32Array(N);
    this.dp = new Float32Array(N * 3);
    this.rho = new Float32Array(N);
    this.bank = 0; // (m^3) melted volume not yet a particle
    this._kernels();
    // neighbour grid (cells of H, counting sort into cellStart)
    this.cellOf = new Int32Array(N);
    this.order = new Int32Array(N);
    this.hashSize = 8192;
    this.cellStart = new Int32Array(this.hashSize + 1);
    this.seen = new Int32Array(N);
    this._stamp = 0;
    this.nb = new Int32Array(N * MAXNB);
    this.pw = new Float32Array(N * MAXNB); // (per neighbour, this round: the kernel's gradient factor)
    this.pc = new Float32Array(N * MAXNB); // (and the tensile push)
    this.coolT = 9; // (s) since the cryo last touched the liquid
    this.nbStart = new Int32Array(N + 1);
    this._g = new Float64Array(12);
    this._bs = new Float64Array(4);
    this._vv = new Float32Array(8);
    this._ex = new Float32Array(36);
    this._en = new Float32Array(36);
    this._ec = new Float32Array(36);
    this._ei = new Float32Array(12);
    this._grp = new Int32Array([0, -1, -1]); // (the sides a cell's corners are on: see _march)
    // (each cube full of liquid as it stands, for its liquid's surface against its wall - see _snapWalls: its turn
    // from its rest shape, last time - a warm start - and scratch)
    this._wq = new Float64Array(MAX_CUBES * 4);
    for (let k = 0; k < MAX_CUBES; k++) this._wq[k * 4 + 3] = 1;
    this._wqk = new Float64Array(4);
    this._wA = new Float64Array(9);
    this._wR = new Float64Array(9);
    this._wF = new Float64Array(6); // (its middle as it stands, and at rest: see _snapBox)
    // (each cube full of liquid as it stands this frame - its middle now, at rest, and the turn from rest to now -
    // and whether that's there: for its liquid's surface against its wall and what's carried in it, see _frames)
    this.frames = new Float64Array(MAX_CUBES * 15);
    this.frameOK = new Uint8Array(MAX_CUBES);
    this._bigN = this._totN = null; // (each cube's pieces of size, and its points: see _frames)
    // (the cups - pieces of a hollow cube cut open - holding air under the liquid this frame, and each piece's own
    // turn, hollow and air, kept from frame to frame: see _cups, _air)
    this.cups = [];
    this._cupOf = new WeakMap();
    this._cupN = new Int32Array(MAX_CUBES);
    this._cupY = new Float64Array(CUP_S * CUP_S * CUP_S);
    this._cupA = new Float64Array(9);
    this._cupR = new Float64Array(3);
    this._lvY = new Float64Array(N); // (the heights of a cube's liquid, sorted - its level: see _pressures)
    this.asleep = false;
    this.stillT = 0;
    // the jelly's tets near the liquid (hashed by cells of 0.1 m)
    this.cStart = new Int32Array(CELL_HASH + 1);
    this._cFill = new Int32Array(CELL_HASH);
    this._cRange = new Int32Array(7 * 4096);
    this._tr = new Int32Array(6);
    this.tBox = new Float32Array(6 * 4096); // (the boxes of the tets near it, by tet - see _jellyCells, _inTet)
    this._cov = new Float64Array(6);
    // (the tets' bare faces, and those not the cube's outside - see _jellyCells; the surface's grid, made as big
    // as it's needed - see _remesh)
    this.faceMask = null;
    this.innerMask = null;
    this.cutMask = null; // (each tet on a cut into a cube full of liquid's wall - a hole's, a slit's: see _radius)
    this.field = this.fcol = this.touch = this.tList = this.cList = this.fdep = this.fnew = this.fo = this.fmask = this.fmL = null;
    this._colN = new Int32Array(1024); // (the outside faces' crossings, column by column - see _envelope)
    this._colY = new Float32Array(4096);
    this.cellsN = 0;
    this._cellVer = -1;
    // surface
    this.cell = coarse ? 0.045 : 0.035;
    this.maxV = coarse ? 54000 : 108000;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.maxV * 3);
    this.nrm = new Float32Array(this.maxV * 3);
    this.rgb = new Float32Array(this.maxV * 3);
    // (each point of it in a cube full of liquid, or out - see the shadow, below)
    this.inn = new Float32Array(this.maxV);
    this.inN = 0; // (how many of them, last time)
    this.meshVer = 0; // (how many times it's been made - the light's view of it follows: see JellyView.renderFloorFx)
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aNrm = new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.rgb, 3).setUsage(THREE.DynamicDrawUsage);
    this.aIn = new THREE.BufferAttribute(this.inn, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aIn', this.aIn);
    geo.setAttribute('normal', this.aNrm);
    geo.setAttribute('color', this.aCol);
    geo.setDrawRange(0, 0);
    this.geo = geo;
    // Drawn as a liquid: what's behind it seen through it - the room, the floor, the jelly - bent by its
    // surface and tinted the deeper it is (the colours its jelly takes away, taken away more through more of
    // it: a thin film near clear, a pool rich), and on it the room's light, more of it edge-on, and a sharp
    // glint. (It was a glossy paint of its colour: lit, nearly opaque - no liquid in it.) Drawn on its own,
    // just after the room - what's behind it is the room's picture (App.render: tBg) - and before the jelly,
    // which sees it through itself. A copy of it, drawn only into the shadows, in the room for its shadow.
    const F = app.jelly.frontMat.uniforms;
    this.mat = new THREE.ShaderMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      uniforms: { tBg: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, envMap: { value: app.env.texture }, uLight: { value: app.lightDir }, uLightColor: F.uLightColor, uEmit: { value: 0 }, tFD: { value: null }, uFD: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        varying vec3 vN;
        varying vec3 vCol;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          vN = normalize(mat3(modelMatrix) * normal);
          vCol = color;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tBg;
        uniform vec2 uRes;
        uniform samplerCube envMap;
        uniform vec3 uLight;
        uniform vec3 uLightColor;
        uniform float uEmit;
        uniform sampler2D tFD;
        uniform float uFD;
        varying vec3 vW;
        varying vec3 vN;
        varying vec3 vCol;
        void main() {
          // (drawn in two, about the jelly - uFD 1: all but what's in front of it, before it; 2: only that, after
          // it - tFD, how far the jelly's nearest surface is: see App.render. Where it meets the jelly, it's as far
          // as it is: in front, it goes after, where the depth test tells the one from the other - drawn before,
          // what of it the jelly didn't cover showed the room through it, a pale fringe)
          if (uFD > 0.5) {
            float jd = texture2D(tFD, gl_FragCoord.xy / uRes).r;
            bool front = jd > 0.0 && length(vW - cameraPosition) < jd + 0.012;
            if (front != (uFD > 1.5)) discard;
          }
          vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
          if (dot(N, V) < 0.0) N = -N;
          float ndv = clamp(dot(N, V), 0.0, 1.0);
          // how much of it the line of sight crosses: a pool on the floor as deep as its surface is high, a
          // run of it over the jelly a few cm - slanted through, more of it, seen edge-on
          float thick = vW.y < 0.15 ? max(vW.y, 0.004) : 0.035;
          float path = min(thick / max(ndv, 0.25), 0.3);
          // what's behind, bent by its surface - more the deeper
          vec3 Nv = normalize((viewMatrix * vec4(N, 0.0)).xyz);
          vec2 uv = gl_FragCoord.xy / uRes - Nv.xy * (0.012 + 0.07 * min(path / 0.12, 1.0));
          vec3 bg = texture2D(tBg, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
          // its colour: what its jelly lets through, the rest taken away along the way
          vec3 tint = max(vCol, vec3(0.015));
          vec3 through = bg * exp(log(tint) * (path * 7.0)) + vCol * 0.03;
          // the room's light off it, more edge-on; the light's glint
          float Fr = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
          vec3 R = reflect(-V, N);
          vec3 env = textureLod(envMap, R, 1.0).rgb;
          vec3 H = normalize(normalize(uLight) + V);
          float spec = pow(max(dot(N, H), 0.0), 260.0) * 7.0 * step(0.0, dot(N, uLight));
          vec3 c = through * (1.0 - Fr) + env * Fr * 0.9 + uLightColor * spec;
          // (glow mode: it shines in its own colours)
          c += vCol * uEmit * 1.2;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    // (its shadow: a copy in the room drawn only into the shadows - nothing of it on the screen)
    this.shadow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    this.shadow.frustumCulled = false;
    this.shadow.castShadow = true;
    // (only what's out of its cube: what's in one has its shadow with it - the jelly's coloured shadow and the
    // light it bends, which see it as part of the cube; this hard grey one over the top of them blacked out
    // all the light under a cube full of liquid, so its shadow was a grey patch, no colour, no caustics)
    this.shadow.customDepthMaterial = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute float aIn;
        varying float vIn;
        void main() {
          vIn = aIn;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vIn;
        void main() {
          if (vIn > 0.5) discard;
          gl_FragColor = vec4(1.0);
        }`,
    });
    this.shadow.visible = false;
    app.scene.add(this.shadow);
    this.drainT = 0; // (s) left of draining away (the heal)
    this._setClock = 0;
    app.onHealStart?.push(() => this._healStart());
    this.rc = null; // (called home by a heal: see recall)
  }

  setGlow(e) {
    this.mat.uniforms.uEmit.value = e;
  }

  // The kernels and the rest density for drops D apart (see setDrop)
  _kernels() {
    this.vol = D * D * D;
    // kernels
    this.K6 = 315 / (64 * Math.PI * H ** 9);
    this.KS = 45 / (Math.PI * H ** 6);
    // rest density: a particle inside a lattice at spacing D
    let rho0 = 0, g2 = 0;
    const r = Math.ceil(H / D);
    for (let i = -r; i <= r; i++)
      for (let j = -r; j <= r; j++)
        for (let k = -r; k <= r; k++) {
          const d2 = (i * i + j * j + k * k) * D * D;
          if (d2 >= H * H) continue;
          rho0 += this.K6 * (H * H - d2) ** 3;
          const d = Math.sqrt(d2);
          if (d > 1e-9) g2 += (this.KS * (H - d) ** 2) ** 2;
        }
    this.rho0 = rho0;
    this.eps = EPS * (g2 / (rho0 * rho0)); // (constraint relaxation, relative to a full neighbourhood's)
    // (with the pull, close pairs need a push of their own or they clump -
    // the tensile fix: as strong as a 25% squeeze at half the spacing)
    this.wDq = this.K6 * (H * H - (0.2 * H) ** 2) ** 3;
    const wHalf = this.K6 * (H * H - (0.5 * D) ** 2) ** 3;
    this.kCorr = 0.25 / ((g2 / (rho0 * rho0)) * (1 + EPS)) / (wHalf / this.wDq) ** 4;
  }

  // Drops d apart (m): bigger, a cube full of liquid fits the pool - only while there's none (the drops there
  // are would be that size too); as now, when it is. True if they're d now.
  setDrop(d) {
    if (Math.abs(d - D) < 1e-6) return true;
    if (this.n) return false;
    D = d;
    H = D * 1.75;
    R_P = D * 0.5;
    this._kernels();
    return true;
  }

  get D() {
    return D;
  }

  // (cube slot's liquid drawn only up to y: see revealY)
  setReveal(slot, y) {
    const R = this.revealY, was = R[slot] < Infinity, now = y < Infinity;
    R[slot] = y;
    this.revealOn += (now ? 1 : 0) - (was ? 1 : 0);
  }

  // Melted jelly in: volume (m^3) at a point, moving at v, its colour (and
  // how strong an acid it is: see AcidTool). Volume collects until there's
  // a particle's worth.
  add(x, y, z, vol, vx, vy, vz, r, g, b, spread = 0.03, acid = 0, visc = VISC, thick = 0, mass = 1) {
    this.bank += vol;
    spread = Math.max(spread, 0.004); // (never two in one spot)
    const pv = this.vol * mass, sp2 = D * D * Math.cbrt(mass * mass);
    if (this.bank >= pv) this.wake();
    while (this.bank >= pv && this.n < this.max) {
      this.bank -= pv;
      const i = this.n++, o = i * 3;
      // (the best of a few spots: the one furthest from the liquid already there)
      let best = -1;
      for (let k = 0; k < 4; k++) {
        const cx = x + (Math.random() - 0.5) * spread, cy = Math.max(R_P, y + (Math.random() - 0.5) * spread), cz = z + (Math.random() - 0.5) * spread;
        let m = Infinity;
        for (let j = 0; j < i; j++) {
          const p = j * 3, dx = this.x[p] - cx, dy = this.x[p + 1] - cy, dz = this.x[p + 2] - cz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < m) m = d2;
        }
        if (m > best) {
          best = m;
          this.x[o] = cx; this.x[o + 1] = cy; this.x[o + 2] = cz;
        }
        if (m > sp2) break;
      }
      this.v[o] = vx; this.v[o + 1] = vy; this.v[o + 2] = vz;
      this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = b;
      this.temp[i] = acid > 0 ? 0 : 1;
      this.age[i] = 0;
      this.acid[i] = acid;
      this.acidTet[i] = -1;
      this.visc[i] = visc;
      this.thick[i] = thick;
      this.tens[i] = 0.5;
      this.own[i] = 0;
      this.dIn[i] = 255;
      this.mass[i] = mass;
      this.lastOut[o] = this.x[o]; this.lastOut[o + 1] = this.x[o + 1]; this.lastOut[o + 2] = this.x[o + 2];
    }
    if (this.n >= this.max) this.bank = 0;
    this.mesh.visible = this.n > 0;
  }

  // A cube full of liquid's Viscosity changed: its liquid - in it, and what was filled into it - as thick now
  setVisc(slot, v) {
    const sb = this.app.sb, id = sb.cHid[slot], DI = this.dIn, own = this.own, [fv, ft] = liquidVisc(v);
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (DI[i] !== slot + 1 && !(id && own[i] === id)) continue;
      this.visc[i] = fv;
      this.thick[i] = ft;
      any = true;
    }
    if (any) this.wake();
  }

  // ...and its Surface tension
  setTension(slot, t) {
    const sb = this.app.sb, id = sb.cHid[slot], DI = this.dIn, own = this.own;
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (DI[i] !== slot + 1 && !(id && own[i] === id)) continue;
      this.tens[i] = t;
      any = true;
    }
    if (any) this.wake();
  }

  // (the box round what's out of the cubes - a pool, a run down one - its surface too; null, none)
  looseBox(out) {
    const x = this.x, DI = this.dIn, own = this.own, pad = 1.6 * this.D;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let p = 0; p < this.n; p++) {
      const din = DI[p];
      if (din === 255 ? own[p] !== 0 : din !== 0) continue;
      const o = p * 3, px = x[o], py = x[o + 1], pz = x[o + 2];
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      if (pz < z0) z0 = pz;
      if (pz > z1) z1 = pz;
    }
    if (!(x1 >= x0)) return null;
    out[0] = x0 - pad; out[1] = y0 - pad; out[2] = z0 - pad; out[3] = x1 + pad; out[4] = y1 + pad; out[5] = z1 + pad;
    return out;
  }

  // Where a ray first meets the liquid (each particle a ball of 0.06 m),
  // or null: { point, normal, distance }.
  pick(ray) {
    const o = ray.origin, d = ray.direction, r2 = 0.06 * 0.06, x = this.x;
    let best = Infinity, bi = -1;
    for (let i = 0; i < this.n; i++) {
      const px = x[i * 3] - o.x, py = x[i * 3 + 1] - o.y, pz = x[i * 3 + 2] - o.z;
      const t = px * d.x + py * d.y + pz * d.z;
      if (t <= 0) continue;
      const m2 = px * px + py * py + pz * pz - t * t;
      if (m2 >= r2) continue;
      const th = t - Math.sqrt(r2 - m2);
      if (th < best) {
        best = th;
        bi = i;
      }
    }
    if (bi < 0) return null;
    const point = ray.origin.clone().addScaledVector(d, best);
    const normal = point.clone().sub({ x: x[bi * 3], y: x[bi * 3 + 1], z: x[bi * 3 + 2] }).normalize();
    return { point, normal, distance: best };
  }

  // The cryo spray: cool what's within radius of p.
  cool(px, py, pz, radius, amount) {
    const r2 = radius * radius;
    let hit = false;
    for (let i = 0; i < this.n; i++) {
      const o = i * 3, dx = this.x[o] - px, dy = this.x[o + 1] - py, dz = this.x[o + 2] - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      this.temp[i] = Math.max(-1, this.temp[i] - amount * (1 - d2 / r2));
      hit = true;
    }
    if (hit) {
      this.coolT = 0;
      this.wake();
    }
    return hit;
  }

  drain() {
    if (this.n) this.drainT = 0.6;
  }

  // A re-cube: the jelly that set from it melted back into it first (a
  // re-cube makes the cube again from all it was, this included), then it
  // drains away - unless the heal calls it home (recall: a cube on its own).
  _healStart() {
    this._meltSet();
    this.drain();
  }

  // The jelly that set from it (_toJelly: its corners marked 2 in sb.melt)
  // as liquid again, where it lies.
  _meltSet() {
    const app = this.app, sb = app.sb, T = sb.T, pcs = new Set();
    for (const pc of sb.pieces) {
      let n2 = 0;
      for (const i of pc.verts) if (sb.melt[i] === 2) n2++;
      if (n2 >= 0.6 * pc.verts.length) pcs.add(pc.id);
    }
    if (!pcs.size) return;
    const set = new Set(), col = new THREE.Color();
    for (let t = 0; t < sb.nT; t++) {
      if (!(sb.vol0[t] > 0) || !pcs.has(sb.tPiece[t])) continue;
      set.add(t);
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 4; k++) {
        const o = T[t * 4 + k] * 3;
        cx += sb.x[o] / 4; cy += sb.x[o + 1] / 4; cz += sb.x[o + 2] / 4;
      }
      col.set(app.flavorColorAtVertex(T[t * 4]));
      this.add(cx, cy, cz, sb.vol0[t], 0, 0, 0, col.r, col.g, col.b, 0.01);
    }
    removeTets(sb, (t) => set.has(t), app.allAnchors());
    app.onTopologyChanged();
  }

  // The heal (see Healer.start): it flows home - each drop off on its own
  // arc, after a wait (delay, give or take - the nearest first), drawn as
  // it goes, gone into the cube as it gets there. target(out): somewhere to
  // go; retarget (the cube's holes known: see Healer._sendDroplets) sends
  // those still to go into them.
  // (into: drawn up into a syringe's needle - see Injector - faster and faster, and smaller, as it goes in:
  // slowing to a stop there, they all piled up under its tip, a ball of it half the cube's size)
  // (pick(i): only those - the rest stay, and run on as ever: another cube's liquid still in it, while one's re-cubed)
  recall(target, delay = 1, into = false, pick = null) {
    this.drainT = 0;
    if (!this.n) return;
    const n = this.n, P = new THREE.Vector3(), x = this.x;
    this.rc = { t: 0, p0: Float32Array.from(x.subarray(0, n * 3)), p1: new Float32Array(this.max * 3), t0: new Float32Array(this.max), T: new Float32Array(this.max), h: new Float32Array(this.max), into, m0: Float32Array.from(this.mass.subarray(0, this.max)), partial: !!pick, left: 0 };
    for (let i = 0; i < n; i++) {
      if (pick && !pick(i)) {
        this.rc.t0[i] = Infinity;
        this.rc.T[i] = 1;
        continue;
      }
      this.rc.left++;
      target(P, i);
      this.rc.p1.set([P.x, P.y, P.z], i * 3);
      const d = Math.hypot(P.x - x[i * 3], P.z - x[i * 3 + 2]);
      this.rc.t0[i] = delay * (0.75 + 0.35 * Math.random()) + Math.min(0.5, d * 0.12);
      this.rc.T[i] = 0.7 + 0.25 * Math.random() + Math.min(0.5, d * 0.15);
      this.rc.h[i] = 0.15 + 0.25 * Math.min(1.5, d);
      // (on its way: no cube's - none to keep it in)
      if (pick) (this.own[i] = 0), (this.dIn[i] = 0);
    }
    if (!this.rc.left) {
      this.rc = null;
      return;
    }
    this.asleep = false;
    this.mesh.visible = true;
  }

  retarget(target) {
    if (!this.rc) return;
    const P = new THREE.Vector3();
    for (let i = 0; i < this.n; i++) {
      target(P);
      this.rc.p1.set([P.x, P.y, P.z], i * 3);
    }
  }

  // (a frame of it flowing home: along its arc, eased; there - gone)
  _recallStep(dt) {
    const R = this.rc, x = this.x, v = this.v;
    R.t += dt;
    let w = 0, left = 0;
    const map = this._mapFor(this.n);
    for (let i = 0; i < this.n; i++) {
      const u = (R.t - R.t0[i]) / R.T[i];
      if (u >= 1) continue;
      map[i] = w;
      if (R.t0[i] < Infinity) left++;
      if (u > 0) {
        v[i * 3] = v[i * 3 + 1] = v[i * 3 + 2] = 0;
        const e = R.into ? u * u : u * u * (3 - 2 * u), lift = R.h[i] * 4 * u * (1 - u);
        for (let c = 0; c < 3; c++) x[i * 3 + c] = R.p0[i * 3 + c] + (R.p1[i * 3 + c] - R.p0[i * 3 + c]) * e + (c === 1 ? lift : 0);
        if (R.into) {
          const s = Math.min(1, Math.max(0, (u - 0.45) / 0.55));
          this.mass[i] = R.m0[i] * Math.max(0.02, 1 - s * s * (3 - 2 * s));
        }
      }
      if (w !== i) {
        for (let c = 0; c < 3; c++) {
          x[w * 3 + c] = x[i * 3 + c];
          this.col[w * 3 + c] = this.col[i * 3 + c];
          R.p0[w * 3 + c] = R.p0[i * 3 + c];
          R.p1[w * 3 + c] = R.p1[i * 3 + c];
        }
        this.temp[w] = this.temp[i];
        this.age[w] = this.age[i];
        this.acid[w] = this.acid[i];
        this.acidTet[w] = this.acidTet[i];
        this.visc[w] = this.visc[i];
        this.thick[w] = this.thick[i];
        this.tens[w] = this.tens[i];
        this.own[w] = this.own[i];
        this.dIn[w] = this.dIn[i];
        this.mass[w] = this.mass[i];
        for (let c = 0; c < 3; c++) this.lastOut[w * 3 + c] = this.lastOut[i * 3 + c];
        R.t0[w] = R.t0[i];
        R.T[w] = R.T[i];
        R.h[w] = R.h[i];
        R.m0[w] = R.m0[i];
      }
      w++;
    }
    if (w !== this.n) {
      // (the rest of it, running on: its velocities with it)
      if (R.partial) for (let i = 0; i < this.n; i++) if (map[i] >= 0 && map[i] !== i) for (let c = 0; c < 3; c++) v[map[i] * 3 + c] = v[i * 3 + c];
      this._mapDone(map, this.n);
    }
    this.n = w;
    R.left = left;
    if (!R.partial) v.fill(0, 0, w * 3);
    if (!w) {
      this.rc = null;
      this.clear();
      return;
    }
    if (!left) this.rc = null;
    this._remesh();
  }

  // Particles gone where drop(i) says (spent acid fuming off: see AcidTool).
  removeWhere(drop) {
    let w = 0;
    const map = this._mapFor(this.n);
    for (let i = 0; i < this.n; i++) {
      if (drop(i)) continue;
      map[i] = w;
      if (w !== i) {
        for (let c = 0; c < 3; c++) {
          this.x[w * 3 + c] = this.x[i * 3 + c];
          this.v[w * 3 + c] = this.v[i * 3 + c];
          this.col[w * 3 + c] = this.col[i * 3 + c];
        }
        this.temp[w] = this.temp[i];
        this.age[w] = this.age[i];
        this.acid[w] = this.acid[i];
        this.acidTet[w] = this.acidTet[i];
        this.visc[w] = this.visc[i];
        this.thick[w] = this.thick[i];
        this.tens[w] = this.tens[i];
        this.own[w] = this.own[i];
        this.dIn[w] = this.dIn[i];
        this.mass[w] = this.mass[i];
        for (let c = 0; c < 3; c++) this.lastOut[w * 3 + c] = this.lastOut[i * 3 + c];
      }
      w++;
    }
    if (w === this.n) return;
    this._mapDone(map, this.n);
    this.n = w;
    this.mesh.visible = w > 0;
    if (!w) this.geo.setDrawRange(0, 0), (this.inN = 0);
    this.wake();
  }

  // (what became of each particle in a compaction: map[old] = new, -1 gone - for what rides on them, the
  // pool's glitter: see Glitter.toPool)
  _mapFor(n) {
    if (!this._map || this._map.length < n) this._map = new Int32Array(Math.max(n, this.max));
    this._map.fill(-1, 0, n);
    return this._map;
  }

  _mapDone(map, n) {
    for (const f of this.onRemap) f(map, n);
  }

  clear() {
    if (this.n) this._mapDone(null, this.n); // (all gone)
    this.frameOK.fill(0);
    if (this.pressOn) (this.pressOn = 0), this.press.fill(0), this.app.sb?.cPress?.fill(0);
    this.n = 0;
    this.bank = 0;
    this.drainT = 0;
    this.rc = null;
    this.geo.setDrawRange(0, 0);
    this.inN = 0;
    this.mesh.visible = false;
  }

  // A frame: dt long - the liquid moved on just its last part of it (phys: see App.frame, stepPart).
  update(dt, phys = dt) {
    if (!this.n) return;
    if (this.rc && !this.rc.partial) return this._recallStep(dt);
    if (this.drainT > 0) {
      // (the heal: it sinks away into the floor)
      this.drainT -= dt;
      if (this.drainT <= 0) {
        this.clear();
        return;
      }
      for (let i = 0; i < this.n; i++) this.x[i * 3 + 1] -= dt * 0.25;
      this._remesh();
      return;
    }
    if (!(dt > 0)) return;
    // (all of it still - liquid and jelly: as they were)
    if (!(this.asleep && !this.app.sb.anyAwake)) this._frames();
    // (a pool that's come to rest sleeps till jelly moves near it - or
    // while acid in it is still eating)
    if (this.asleep && (this.keepAwake || this._stirred())) this.wake();
    // (asleep, nothing's squeezing it)
    if (this.asleep && this.pressOn) (this.pressOn = 0), this.press.fill(0), this.app.sb.cPress.fill(0);
    if (!this.asleep) {
      this._jellyCells();
      this._pressures();
      this._advance(phys);
      this._contain();
      const v = this.v;
      let v2 = 0, nMove = 0;
      for (let o = 0; o < this.n * 3; o += 3) {
        const s2 = v[o] * v[o] + v[o + 1] * v[o + 1] + v[o + 2] * v[o + 2];
        if (s2 > v2) v2 = s2;
        if (s2 > 0.04 * 0.04) nMove++;
      }
      // (still: all but a few of it under 4 cm/s, none over half a metre - a big pool's edges kept creeping
      // for many seconds after the rest was still, and it never slept)
      this.stillT = v2 < 0.5 * 0.5 && nMove <= Math.max(2, this.n * 0.05) && !this.keepAwake ? this.stillT + dt : 0;
      // (or going nowhere: all but a few of it within 10 cm of where it was half a second ago, none 25 cm off -
      // nothing falling, nothing pouring - twice running, and no jelly moving by: a cube's liquid jostles in
      // it at rest, never quite still, and was worked out every frame for ever)
      this._nwT += dt;
      const x = this.x;
      const gs = this._gapSeen;
      if (this._nwN !== this.n) (this._nwN = this.n), (this._nwT = 0), (this._nwOK = 0), this._nwX.set(x.subarray(0, this.n * 3)), gs.fill(0);
      else if (this._nwT >= 0.5) {
        let far = 0, most = 0, flow = false;
        for (let i = 0, o = 0; i < this.n; i++, o += 3) {
          const dx = x[o] - this._nwX[o], dy = x[o + 1] - this._nwX[o + 1], dz = x[o + 2] - this._nwX[o + 2], d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > 0.1 * 0.1) far++;
          if (d2 > most) most = d2;
          if (gs[i] && d2 > 0.01 * 0.01) flow = true;
        }
        this._nwOK = far <= Math.max(2, this.n * 0.08) && most < 0.25 * 0.25 && !this.keepAwake ? this._nwOK + 1 : 0;
        this._flowT = flow ? 0 : this._flowT + this._nwT;
        this._nwT = 0;
        this._nwX.set(x.subarray(0, this.n * 3));
        gs.fill(0, 0, this.n);
        if (this._nwOK >= 2 && !this._stirred()) this.stillT = 1;
      }
      // (liquid seeping out through a slit - drops in its crack moving on, lately: awake, however slow the seep
      // - asleep, it'd have stopped dead, the level left above the slit)
      if (this._flowT < 1) this.stillT = 0;
      if (this.stillT > 0.6) {
        this.asleep = true;
        v.fill(0, 0, this.n * 3);
      }
      // (a lot of it, creeping: its surface every other frame)
      if (!this.rc && (this.revealOn || this.asleep || this.n < 500 || v2 > 0.5 * 0.5 || (this._rmTick ^= 1))) this._remesh();
    } else if (this.revealOn && !this.rc) this._remesh();
    // (some of it flying home, the rest running on: see recall's pick)
    if (this.rc) this._recallStep(dt);
    if (!this.n) return;
    this.coolT += dt;
    // cooling to the room, and setting
    for (let i = 0; i < this.n; i++) {
      this.temp[i] += (0 - this.temp[i]) * Math.min(1, dt * 0.04);
      this.age[i] += dt;
    }
    this._setClock += dt;
    if (this._setClock > 0.3) {
      this._setClock = 0;
      this._setCold();
    }
  }

  // A cube full of liquid's own drops stay inside it but where it's cut. Sealed, all of them: one found outside its
  // hollow - not in its walls, not in it - came out through a wall that wasn't cut (a few, at worst, in a hard
  // landing: its shell swept past them faster than they were looked at), and is put back just inside the nearest
  // of its hollow's faces, moving as that is; inside, a ray straight up crosses its hollow's faces an odd number of
  // times. Cut into but in one piece - slit, nicked - one that was inside its outside skin last time and isn't now,
  // and isn't by any cut, went out through a wall too, and is put back where it was. (A thin skin's walls let
  // dozens through, the cube dragged about with a slit in it.)
  _contain() {
    const sb = this.app.sb, own = this.own, x = this.x, v = this.v, X = sb.x, SV = sb.v, n = this.n, EI = this.envIn, EP = this.envPrev;
    if (this._envN !== n) (this._envN = n), EI.fill(2, 0, n);
    for (let k = 0; k < sb.cav.length; k++) {
      const c = sb.cav[k], id = sb.cHid[k];
      if (!c || !id) continue;
      let any = false;
      for (let i = 0; i < n && !any; i++) any = own[i] === id;
      if (!any) continue;
      if (c.sealed) {
        const VV = c.v, F = c.f, m = F.length / 3;
        if (this._tri.length < m * 3) this._tri = new Int32Array(m * 6);
        const tri = this._tri;
        for (let e = 0; e < m * 3; e++) tri[e] = VV[F[e]];
        this._xzBuild(tri, m);
        for (let i = 0; i < n; i++) {
          if (own[i] !== id) continue;
          const o = i * 3, px = x[o], py = x[o + 1], pz = x[o + 2];
          if (this._xzOdd(px, py, pz) || this._inTet(px, py, pz) >= 0) continue;
          // (out: back in, by the nearest of its faces)
          let best = -1, bd = Infinity;
          for (let f = 0; f < m; f++) {
            const a = tri[f * 3] * 3, b = tri[f * 3 + 1] * 3, d = tri[f * 3 + 2] * 3;
            const cx = (X[a] + X[b] + X[d]) / 3 - px, cy = (X[a + 1] + X[b + 1] + X[d + 1]) / 3 - py, cz = (X[a + 2] + X[b + 2] + X[d + 2]) / 3 - pz, d2 = cx * cx + cy * cy + cz * cz;
            if (d2 < bd) (bd = d2), (best = f);
          }
          if (best < 0) continue;
          const a = tri[best * 3] * 3, b = tri[best * 3 + 1] * 3, d = tri[best * 3 + 2] * 3;
          const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], wx = X[d] - X[a], wy = X[d + 1] - X[a + 1], wz = X[d + 2] - X[a + 2];
          let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
          const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1, r = R_P + 0.005;
          nx /= nl; ny /= nl; nz /= nl;
          x[o] = (X[a] + X[b] + X[d]) / 3 + nx * r; x[o + 1] = (X[a + 1] + X[b + 1] + X[d + 1]) / 3 + ny * r; x[o + 2] = (X[a + 2] + X[b + 2] + X[d + 2]) / 3 + nz * r;
          v[o] = (SV[a] + SV[b] + SV[d]) / 3; v[o + 1] = (SV[a + 1] + SV[b + 1] + SV[d + 1]) / 3; v[o + 2] = (SV[a + 2] + SV[b + 2] + SV[d + 2]) / 3;
          this.lastOut[o] = x[o]; this.lastOut[o + 1] = x[o + 1]; this.lastOut[o + 2] = x[o + 2];
          this._contained++;
        }
        continue;
      }
      // (cut into: only while it's in one piece - cut through, it's open, and pours)
      let pieces = 0;
      for (const pc of sb.pieces) if (pc.cube === k) pieces++;
      if (pieces !== 1) continue;
      // its outside skin, and its cuts' faces (not its outside, nor its hollow's - in its rest shape, out past the
      // hollow's box by more than a quarter of a cell) where they are now
      const S = sb.sTri, tag = sb.sTag, ST = sb.sTet, tc = sb.tCube, XR = sb.X, HB = sb.cHole, h6 = k * 6, q4 = 0.25 * sb.cH[k];
      let m = 0, nc = 0;
      if (this._tri.length < sb.nF * 3) this._tri = new Int32Array(sb.nF * 6);
      if (this._cuts.length < sb.nF * 3) this._cuts = new Float32Array(sb.nF * 6);
      const tri = this._tri, cuts = this._cuts;
      for (let f = 0; f < sb.nF; f++) {
        if (tc[ST[f]] !== k) continue;
        const a = S[f * 3], b = S[f * 3 + 1], d = S[f * 3 + 2];
        if (tag[f] === TAG_EXTERIOR) {
          tri[m * 3] = a; tri[m * 3 + 1] = b; tri[m * 3 + 2] = d;
          m++;
          continue;
        }
        let o2 = 0;
        for (let ax = 0; ax < 3; ax++) {
          const r = (XR[a * 3 + ax] + XR[b * 3 + ax] + XR[d * 3 + ax]) / 3, out = Math.max(HB[h6 + ax] - r, 0, r - HB[h6 + 3 + ax]);
          o2 += out * out;
        }
        if (o2 <= q4 * q4) continue;
        for (let ax = 0; ax < 3; ax++) cuts[nc * 3 + ax] = (X[a * 3 + ax] + X[b * 3 + ax] + X[d * 3 + ax]) / 3;
        nc++;
      }
      if (!m) continue;
      this._xzBuild(tri, m);
      const near2 = (0.9 * sb.cH[k]) ** 2;
      for (let i = 0; i < n; i++) {
        if (own[i] !== id) continue;
        const o = i * 3, px = x[o], py = x[o + 1], pz = x[o + 2], inside = this._xzOdd(px, py, pz), was = EI[i];
        EI[i] = inside ? 1 : 0;
        if (inside) {
          EP[o] = px; EP[o + 1] = py; EP[o + 2] = pz;
          continue;
        }
        if (was !== 1) continue;
        let near = false;
        for (let e = 0; e < nc && !near; e++) {
          const dx = cuts[e * 3] - px, dy = cuts[e * 3 + 1] - py, dz = cuts[e * 3 + 2] - pz;
          near = dx * dx + dy * dy + dz * dz < near2;
        }
        // (nor through a hole in its skin - out through a slit pulled wide, away from its sides - only through the
        // skin itself: kept so, held open, it never drained)
        if (near || !this._xzCrosses(EP[o], EP[o + 1], EP[o + 2], px, py, pz)) continue;
        // (out through a wall: back where it was, still)
        x[o] = EP[o]; x[o + 1] = EP[o + 1]; x[o + 2] = EP[o + 2];
        v[o] = v[o + 1] = v[o + 2] = 0;
        this.lastOut[o] = x[o]; this.lastOut[o + 1] = x[o + 1]; this.lastOut[o + 2] = x[o + 2];
        EI[i] = 1;
        this._contained++;
      }
    }
  }

  // (triangles - tri[0..m*3), their corners' vertex numbers - in a grid over x, z, for _xzOdd)
  _xzBuild(tri, m) {
    const X = this.app.sb.x;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let e = 0; e < m * 3; e++) {
      const a = tri[e] * 3;
      if (X[a] < x0) x0 = X[a];
      if (X[a] > x1) x1 = X[a];
      if (X[a + 2] < z0) z0 = X[a + 2];
      if (X[a + 2] > z1) z1 = X[a + 2];
    }
    const cell = Math.max(0.06, Math.max(x1 - x0, z1 - z0) / 24), gx = Math.floor((x1 - x0) / cell) + 1, gz = Math.floor((z1 - z0) / cell) + 1;
    if (this._cgStart.length < gx * gz + 1) this._cgStart = new Int32Array((gx * gz + 1) * 2);
    const cs = this._cgStart;
    cs.fill(0, 0, gx * gz + 1);
    for (let pass = 0; pass < 2; pass++) {
      if (pass) {
        for (let q = 0; q < gx * gz; q++) cs[q + 1] += cs[q];
        if (this._cgList.length < cs[gx * gz]) this._cgList = new Int32Array(cs[gx * gz] * 2);
        for (let q = gx * gz; q > 0; q--) cs[q] = cs[q - 1];
        cs[0] = 0;
      }
      for (let f = 0; f < m; f++) {
        const a = tri[f * 3] * 3, b = tri[f * 3 + 1] * 3, d = tri[f * 3 + 2] * 3;
        const i0 = Math.floor((Math.min(X[a], X[b], X[d]) - x0) / cell), i1 = Math.floor((Math.max(X[a], X[b], X[d]) - x0) / cell);
        const j0 = Math.floor((Math.min(X[a + 2], X[b + 2], X[d + 2]) - z0) / cell), j1 = Math.floor((Math.max(X[a + 2], X[b + 2], X[d + 2]) - z0) / cell);
        for (let jj = j0; jj <= j1; jj++)
          for (let ii = i0; ii <= i1; ii++) {
            const q = jj * gx + ii;
            if (pass) this._cgList[cs[q + 1]++] = f;
            else cs[q + 1]++;
          }
      }
    }
    this._xzTri = tri;
    this._xzG[0] = x0; this._xzG[1] = z0; this._xzG[2] = x1; this._xzG[3] = z1; this._xzG[4] = cell; this._xzG[5] = gx;
  }

  // (does the way from a to b cross any of _xzBuild's triangles?)
  _xzCrosses(ax0, ay0, az0, bx0, by0, bz0) {
    const G = this._xzG, X = this.app.sb.x, tri = this._xzTri, cs = this._cgStart, L = this._cgList, gx = G[5];
    const gz = cs.length, dx = bx0 - ax0, dy = by0 - ay0, dz = bz0 - az0;
    const i0 = Math.max(0, Math.floor((Math.min(ax0, bx0) - G[0]) / G[4])), i1 = Math.min(gx - 1, Math.floor((Math.max(ax0, bx0) - G[0]) / G[4]));
    const j0 = Math.max(0, Math.floor((Math.min(az0, bz0) - G[1]) / G[4])), j1 = Math.floor((Math.max(az0, bz0) - G[1]) / G[4]);
    for (let jj = j0; jj <= j1; jj++)
      for (let ii = i0; ii <= i1; ii++) {
        const q = jj * gx + ii;
        if (q + 1 >= gz) continue;
        for (let e = cs[q]; e < cs[q + 1]; e++) {
          const f = L[e], a = tri[f * 3] * 3, b = tri[f * 3 + 1] * 3, c = tri[f * 3 + 2] * 3;
          const e1x = X[b] - X[a], e1y = X[b + 1] - X[a + 1], e1z = X[b + 2] - X[a + 2], e2x = X[c] - X[a], e2y = X[c + 1] - X[a + 1], e2z = X[c + 2] - X[a + 2];
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
          if (Math.abs(det) < 1e-14) continue;
          const inv = 1 / det, tx = ax0 - X[a], ty = ay0 - X[a + 1], tz = az0 - X[a + 2], u = (tx * px + ty * py + tz * pz) * inv;
          if (u < 0 || u > 1) continue;
          const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, w = (dx * qx + dy * qy + dz * qz) * inv;
          if (w < 0 || u + w > 1) continue;
          const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (t >= 0 && t <= 1) return true;
        }
      }
    return false;
  }

  // (is (px, py, pz) under an odd number of _xzBuild's triangles? - nudged a hair, off their edges)
  _xzOdd(px, py, pz) {
    const G = this._xzG, X = this.app.sb.x, tri = this._xzTri, cs = this._cgStart, L = this._cgList;
    px += 1.234e-7; pz += 2.345e-7;
    if (px < G[0] || px > G[2] || pz < G[1] || pz > G[3]) return false;
    const q = Math.floor((pz - G[1]) / G[4]) * G[5] + Math.floor((px - G[0]) / G[4]);
    let cross = 0;
    for (let e = cs[q]; e < cs[q + 1]; e++) {
      const f = L[e], a = tri[f * 3] * 3, b = tri[f * 3 + 1] * 3, d = tri[f * 3 + 2] * 3;
      const ax = X[a] - px, az = X[a + 2] - pz, bx = X[b] - px, bz = X[b + 2] - pz, dx = X[d] - px, dz = X[d + 2] - pz;
      const wa = bx * dz - bz * dx, wb = dx * az - dz * ax, wd = ax * bz - az * bx, sum = wa + wb + wd;
      if (!(Math.abs(sum) > 1e-12) || !((wa >= 0 && wb >= 0 && wd >= 0) || (wa <= 0 && wb <= 0 && wd <= 0))) continue;
      if ((wa * X[a + 1] + wb * X[b + 1] + wd * X[d + 1]) / sum > py) cross++;
    }
    return (cross & 1) === 1;
  }

  // One part of a long frame (see App.frame): just the liquid moved on - none of update's looking after it.
  stepPart(dt) {
    if (!this.n || (this.rc && !this.rc.partial) || this.drainT > 0 || this.asleep || !(dt > 0)) return;
    this._jellyCells();
    this._advance(dt);
  }

  // The liquid moved on dt - as long as the jelly's just moved (up to a twentieth of a second, a slow phone's
  // frame: held to a 30th, behind it, a falling or swung cube left its liquid behind, its walls sweeping out
  // through it) - in whole substeps of STEP, what's over carried to the next. (Each frame in as many as fit it:
  // at 30 fps, twice as long, a full cube's liquid stood a seventh lower; at 90 or 120, shorter, it churned at a
  // metre a second for ever, never sleeping.)
  _advance(dt) {
    const F = Math.min(dt, 0.05);
    this._acc = Math.min(this._acc + F, 0.1);
    this._carry += F;
    const nS = Math.floor(this._acc / STEP + 1e-6);
    this._acc -= nS * STEP;
    this.atCut.fill(0, 0, this.n);
    this._cups();
    for (let s = 0; s < nS; s++) this._step(STEP);
    this._gaps(F);
    this._squeeze(F);
  }

  // A cup - a piece of a hollow cube cut open - holds air. Its rim under the liquid, that air can't get out, and
  // keeps the liquid out of it: upturned in a pool, it pushes the pool aside (it filled, as though there were
  // nothing in it). The air's what there was when its rim went under: tipped, all that's above its rim's highest
  // point stays and the rest bubbles out; out of the liquid, it's open to the room again. Each frame: each cup's
  // hollow (the hollow's rest box, clipped to the piece's), its turn (a fit, warm), where its rim's highest, how
  // much liquid's in it, whether it's under - and the level its air comes down to, below which the drops are kept
  // (_air, each substep).
  _cups() {
    const sb = this.app.sb, list = this.cups, N = this._cupN;
    list.length = 0;
    N.fill(0);
    let cut = false;
    for (const pc of sb.pieces) if (pc && sb.cHollow[pc.cube] && ++N[pc.cube] > 1) cut = true;
    if (!cut || !this.n) return;
    for (const pc of sb.pieces) if (pc && N[pc.cube] > 1) this._cup(sb, pc);
  }

  _cup(sb, pc) {
    let S = this._cupOf.get(pc);
    if (!S) {
      S = { q: new Float64Array([0, 0, 0, 1]), xm: new Float64Array(3), Xm: new Float64Array(3), R: new Float64Array(9), C: new Float64Array(6), rb: new Float64Array(6), rbTopo: -1, A: -1, Vc: 0, sealed: false, spill: 0, ya: 0, low: 0, top: new Float64Array(3), err: 0 };
      this._cupOf.set(pc, S);
    }
    const k = pc.cube, HB = sb.cHole, h6 = k * 6, X = sb.X, x = sb.x, vs = pc.verts, al = sb.alive, rb = S.rb, C = S.C, D = this.D;
    // (its rest box: once a cut)
    if (S.rbTopo !== sb.topoVersion) {
      S.rbTopo = sb.topoVersion;
      rb[0] = rb[1] = rb[2] = Infinity;
      rb[3] = rb[4] = rb[5] = -Infinity;
      for (const i of vs)
        for (let a = 0; a < 3 && al[i]; a++) {
          const r = X[i * 3 + a];
          if (r < rb[a]) rb[a] = r;
          if (r > rb[3 + a]) rb[3 + a] = r;
        }
    }
    // the hollow it has - and which of its sides are open (where the piece stops short of the hollow's own)
    const tol = 0.5 * sb.cH[k];
    let open = 0;
    for (let a = 0; a < 3; a++) {
      C[a] = Math.max(rb[a], HB[h6 + a]);
      C[3 + a] = Math.min(rb[3 + a], HB[h6 + 3 + a]);
      if (!(C[3 + a] - C[a] > 2 * D)) return;
      if (rb[a] > HB[h6 + a] + tol) open |= 1 << a;
      if (rb[3 + a] < HB[h6 + 3 + a] - tol) open |= 8 << a;
    }
    // (a cup: one side open - a half. More, and the air's away out of the side: a die off a diced one, a quarter)
    if (!open || (open & (open - 1))) return;
    // (no liquid near it: nothing to keep out - its air, as much as it holds, worked out once some comes)
    const bb = pc.bbox, pad = 1.5 * D, fx = this.x, n = this.n;
    let near = false;
    for (let p = 0; p < n && !near; p++) {
      const o = p * 3, px = fx[o], py = fx[o + 1], pz = fx[o + 2];
      near = px > bb[0] - pad && px < bb[3] + pad && py > bb[1] - pad && py < bb[4] + pad && pz > bb[2] - pad && pz < bb[5] + pad;
    }
    if (!near) {
      S.A = -1;
      return;
    }
    // its turn: rest to as it is now
    const xm = S.xm, Xm = S.Xm, A = this._cupA, R = S.R;
    xm[0] = xm[1] = xm[2] = Xm[0] = Xm[1] = Xm[2] = 0;
    let nv = 0;
    for (const i of vs) {
      if (!al[i]) continue;
      nv++;
      const o = i * 3;
      xm[0] += x[o]; xm[1] += x[o + 1]; xm[2] += x[o + 2];
      Xm[0] += X[o]; Xm[1] += X[o + 1]; Xm[2] += X[o + 2];
    }
    if (nv < 8) return;
    const iv = 1 / nv;
    for (let a = 0; a < 3; a++) (xm[a] *= iv), (Xm[a] *= iv);
    A.fill(0);
    for (const i of vs) {
      if (!al[i]) continue;
      const o = i * 3, a0 = x[o] - xm[0], a1 = x[o + 1] - xm[1], a2 = x[o + 2] - xm[2], b0 = X[o] - Xm[0], b1 = X[o + 1] - Xm[1], b2 = X[o + 2] - Xm[2];
      A[0] += a0 * b0; A[1] += a0 * b1; A[2] += a0 * b2;
      A[3] += a1 * b0; A[4] += a1 * b1; A[5] += a1 * b2;
      A[6] += a2 * b0; A[7] += a2 * b1; A[8] += a2 * b2;
    }
    polarRot(S.q, A, R, 8);
    // (crumpled - a quarter of its size from its shape as made, turned, on average: no telling which way its
    // hollow's facing, and no air kept. A shell carried by a corner sags an eighth.)
    let err = 0, ne = 0;
    for (let j = 0; j < vs.length; j += 4) {
      if (!al[vs[j]]) continue;
      const o = vs[j] * 3, b0 = X[o] - Xm[0], b1 = X[o + 1] - Xm[1], b2 = X[o + 2] - Xm[2];
      const ex = x[o] - xm[0] - (R[0] * b0 + R[1] * b1 + R[2] * b2), ey = x[o + 1] - xm[1] - (R[3] * b0 + R[4] * b1 + R[5] * b2), ez = x[o + 2] - xm[2] - (R[6] * b0 + R[7] * b1 + R[8] * b2);
      err += ex * ex + ey * ey + ez * ez;
      ne++;
    }
    S.err = Math.sqrt(err / Math.max(1, ne));
    if (!(err / Math.max(1, ne) < (0.25 * sb.cSize[k]) ** 2)) {
      S.A = -1;
      return;
    }
    // (a rest point's height now)
    const yOf = (r0, r1, r2) => xm[1] + R[3] * (r0 - Xm[0]) + R[4] * (r1 - Xm[1]) + R[5] * (r2 - Xm[2]);
    // its rim's highest point: the open sides' corners
    let spill = -Infinity, ta = 0, tb = 0, tc = 0;
    const r = this._cupR;
    for (let a = 0; a < 3; a++)
      for (let side = 0; side < 2; side++) {
        if (!(open & ((side ? 8 : 1) << a))) continue;
        const b = (a + 1) % 3, c = (a + 2) % 3;
        for (let m = 0; m < 4; m++) {
          r[a] = C[side ? 3 + a : a];
          r[b] = C[m & 1 ? 3 + b : b];
          r[c] = C[m & 2 ? 3 + c : c];
          const y = yOf(r[0], r[1], r[2]);
          if (y > spill) (spill = y), (ta = r[0]), (tb = r[1]), (tc = r[2]);
        }
      }
    S.spill = spill;
    // (and where that is: the air that gets out, out there)
    S.top[0] = xm[0] + R[0] * (ta - Xm[0]) + R[1] * (tb - Xm[1]) + R[2] * (tc - Xm[2]);
    S.top[1] = spill;
    S.top[2] = xm[2] + R[6] * (ta - Xm[0]) + R[7] * (tb - Xm[1]) + R[8] * (tc - Xm[2]);
    // the hollow's points' heights, sorted - how much of it's above a height
    const Y = this._cupY, ns = CUP_S;
    let m = 0;
    for (let i = 0; i < ns; i++)
      for (let j = 0; j < ns; j++)
        for (let l = 0; l < ns; l++) Y[m++] = yOf(C[0] + ((i + 0.5) / ns) * (C[3] - C[0]), C[1] + ((j + 0.5) / ns) * (C[4] - C[1]), C[2] + ((l + 0.5) / ns) * (C[5] - C[2]));
    Y.sort();
    const Vc = (C[3] - C[0]) * (C[4] - C[1]) * (C[5] - C[2]);
    S.Vc = Vc;
    // the liquid in it - and, out of it round it, any at its rim's highest point (not above: liquid on an upturned
    // cup's top doesn't close it): under, if there is
    const y0 = spill - 0.5 * D, y1 = spill + 1.5 * D, y2 = spill + 0.3 * D;
    let nIn = 0, under = false, deep = false;
    for (let p = 0; p < n; p++) {
      const o = p * 3, px = fx[o], py = fx[o + 1], pz = fx[o + 2];
      if (px < bb[0] - pad || px > bb[3] + pad || py < bb[1] - pad || py > bb[4] + pad || pz < bb[2] - pad || pz > bb[5] + pad) continue;
      const dx = px - xm[0], dy = py - xm[1], dz = pz - xm[2];
      const r0 = Xm[0] + R[0] * dx + R[3] * dy + R[6] * dz, r1 = Xm[1] + R[1] * dx + R[4] * dy + R[7] * dz, r2 = Xm[2] + R[2] * dx + R[5] * dy + R[8] * dz;
      if (r0 > C[0] && r0 < C[3] && r1 > C[1] && r1 < C[4] && r2 > C[2] && r2 < C[5]) nIn++;
      else if (py > y0 && py < y1) {
        under = true;
        if (py > y2) deep = true;
      }
    }
    S.sealed = under;
    // its air: open, all that isn't liquid; under, what it had - less what's above its rim's highest point, out
    let above = 0;
    while (above < m && Y[m - 1 - above] > spill) above++;
    const was = S.A;
    if (!S.sealed || was < 0) S.A = Math.max(0, Vc - nIn * this.vol);
    else S.A = Math.min(was, (Vc * above) / m);
    // (bubbling out only where its rim's top is under the liquid: an upright cup in a pool to its brim has none)
    if (deep && was > 0 && was - S.A > 0.02 * Vc) this._burp(S, was - S.A);
    if (!S.sealed || !(S.A > 0.02 * Vc)) return;
    // the air's level: the top A of the hollow - the drops kept under it
    const at = Math.min(m - 1, Math.max(0, Math.round((1 - S.A / Vc) * m)));
    S.ya = Y[at];
    S.low = Math.max(S.ya - 0.45 * D, R_P);
    this.cups.push(S);
  }

  // (the air that's got out of a cup, tipped: a few bubbles up out of the liquid at its rim's highest point, and
  // their sound)
  _burp(S, vol) {
    const app = this.app, P = app.particles?.add, t = S.top, n = Math.min(10, 2 + Math.round(vol * 400));
    for (let i = 0; P && i < n; i++) {
      const th = Math.random() * Math.PI * 2, r = 0.02 + Math.random() * 0.05, s = 0.15 + 0.25 * Math.random();
      P.spawn(t[0] + Math.cos(th) * r, t[1] + 0.06 + Math.random() * 0.08, t[2] + Math.sin(th) * r, Math.cos(th) * s * 0.4, 0.4 + s, Math.sin(th) * s * 0.4, 0.2 + 0.15 * Math.random(), 0.006, 0.002, [1, 1, 1, 0.7], [1, 1, 1, 0], 4, 0);
    }
    app.audio?.bubble?.(0.02 + Math.min(0.05, vol * 0.2), app._pan ? app._pan(t[0], t[1], t[2]) : 0);
  }

  // (each substep, after the jelly's pushed the liquid out of itself: what of it's up in a cup's air, pressed back
  // down toward the air's level - as against a wall, an eighth of a drop a substep at most: put straight there,
  // the liquid caught under an upturned cup on the floor packed into a layer too thick for itself and threw the
  // cup aside; pressed, it gives a little, as air does)
  _air(q) {
    const n = this.n, cp = this.cpush, step = 0.12 * this.D;
    for (const S of this.cups) {
      const xm = S.xm, Xm = S.Xm, R = S.R, C = S.C, low = S.low;
      for (let i = 0; i < n; i++) {
        const o = i * 3, py = q[o + 1];
        if (py <= low) continue;
        const dx = q[o] - xm[0], dy = py - xm[1], dz = q[o + 2] - xm[2];
        const r0 = Xm[0] + R[0] * dx + R[3] * dy + R[6] * dz;
        if (r0 <= C[0] || r0 >= C[3]) continue;
        const r1 = Xm[1] + R[1] * dx + R[4] * dy + R[7] * dz;
        if (r1 <= C[1] || r1 >= C[4]) continue;
        const r2 = Xm[2] + R[2] * dx + R[5] * dy + R[8] * dz;
        if (r2 <= C[2] || r2 >= C[5]) continue;
        const d = Math.min(py - low, step);
        q[o + 1] = py - d;
        cp[o + 1] -= d;
      }
    }
  }

  // How hard each cube full of liquid that's been cut into is squeezed - its hollow's volume short of what it
  // held as made (only its own faces: not a cut's), past a little give - and its middle. Its air takes it first,
  // as a spring: the less air over the liquid, the harder (squeezed by c, air a of it: as c / (a - c) - near full,
  // stiff; half full, it gives); and an opening into it over the liquid - a cut's, a slit's - lets the air out,
  // and most of the push with it. (It was as it was squeezed times how full it was, by its drops: Full - a fifth
  // of it air - pushed as hard as full to the brim. Sealed, its volume's held: see SoftBody._solveCavities.)
  _pressures() {
    const sb = this.app.sb, P = this.press, C = this.pressC, x = sb.x, X = sb.X, HB = sb.cHole;
    let on = 0;
    for (let k = 0; k < MAX_CUBES; k++) {
      P[k] = 0;
      const c = sb.cav[k];
      if (!c || c.sealed || !sb.cHid[k] || !(c.V0 > 0)) continue;
      const V = c.v, Fc = c.f, h6 = k * 6, q4 = 0.25 * sb.cH[k];
      let cx = 0, cy = 0, cz = 0;
      for (let n = 0; n < V.length; n++) {
        const o = V[n] * 3;
        cx += x[o]; cy += x[o + 1]; cz += x[o + 2];
      }
      cx /= V.length; cy /= V.length; cz /= V.length;
      C[k * 3] = cx; C[k * 3 + 1] = cy; C[k * 3 + 2] = cz;
      let vol = 0;
      for (let n = 0; n < Fc.length; n += 3) {
        const a = V[Fc[n]] * 3, b = V[Fc[n + 1]] * 3, d = V[Fc[n + 2]] * 3;
        // (a cut's face - out past the hollow's box, in its rest shape: not the hollow's)
        let o2 = 0;
        for (let ax = 0; ax < 3; ax++) {
          const r = (X[a + ax] + X[b + ax] + X[d + ax]) / 3, out = Math.max(HB[h6 + ax] - r, 0, r - HB[h6 + 3 + ax]);
          o2 += out * out;
        }
        if (o2 > q4 * q4) continue;
        const ax_ = x[a] - cx, ay = x[a + 1] - cy, az = x[a + 2] - cz, bx = x[b] - cx, by = x[b + 1] - cy, bz = x[b + 2] - cz, dx = x[d] - cx, dy = x[d + 1] - cy, dz = x[d + 2] - cz;
        vol -= (ax_ * (by * dz - bz * dy) + ay * (bz * dx - bx * dz) + az * (bx * dy - by * dx)) / 6;
      }
      // (a cut one stands a few in a hundred under what it was made, unsqueezed: past that)
      const cmp = Math.max(0, 1 - vol / c.V0 - 0.035);
      if (!(cmp > 0)) continue;
      const lv = this._level(k);
      if (!(lv > -Infinity)) continue;
      const a = this._airOver(k, lv);
      P[k] = Math.min(0.3, (0.1 * cmp) / Math.max(a - cmp, 0.05)) * (this._vented(k, lv + 0.5 * this.D) ? 0.4 : 1);
      if (P[k] > 0) on++;
    }
    this.pressOn = on;
    sb.cPress.set(P);
  }

  // (a cube's liquid's level: the 95th of its drops' heights, and half a drop over - its surface; -Infinity, none)
  _level(k) {
    const Y = this._lvY, DI = this.dIn, x = this.x;
    let m = 0;
    for (let i = 0; i < this.n; i++) if (DI[i] === k + 1) Y[m++] = x[i * 3 + 1];
    if (!m) return -Infinity;
    const L = Y.subarray(0, m);
    L.sort();
    return L[Math.min(m - 1, Math.floor(m * 0.95))] + 0.5 * this.D;
  }

  // (how much of cube k's hollow is over height y - its air: the hollow's rest box, 5 points a side, through the
  // cube's frame as it stands; not known, a fifth)
  _airOver(k, y) {
    if (!this.frameOK[k]) return 0.2;
    const HB = this.app.sb.cHole, h6 = k * 6, FR = this.frames, f = k * 15;
    let up = 0;
    for (let i = 0; i < 5; i++) {
      const r0 = HB[h6] + ((i + 0.5) / 5) * (HB[h6 + 3] - HB[h6]) - FR[f + 3];
      for (let j = 0; j < 5; j++) {
        const r1 = HB[h6 + 1] + ((j + 0.5) / 5) * (HB[h6 + 4] - HB[h6 + 1]) - FR[f + 4];
        for (let l = 0; l < 5; l++) {
          const r2 = HB[h6 + 2] + ((l + 0.5) / 5) * (HB[h6 + 5] - HB[h6 + 2]) - FR[f + 5];
          if (FR[f + 1] + FR[f + 9] * r0 + FR[f + 10] * r1 + FR[f + 11] * r2 > y) up++;
        }
      }
    }
    return up / 125;
  }

  // (an opening into cube k - a cut's, a slit's - over height y: its air let out there)
  _vented(k, y) {
    const sb = this.app.sb, cm = this.cutMask, T = sb.T, x = sb.x, tc = sb.tCube;
    if (!cm) return false;
    for (let t = 0; t < sb.nT; t++) {
      if (!cm[t] || tc[t] !== k) continue;
      const o = t * 4;
      if ((x[T[o] * 3 + 1] + x[T[o + 1] * 3 + 1] + x[T[o + 2] * 3 + 1] + x[T[o + 3] * 3 + 1]) * 0.25 > y) return true;
    }
    return false;
  }

  // Squeezed (see _pressures), what's at an opening into it - by a cut's faces, in a slit - is pressed out of it:
  // pushed straight out from its middle, the harder the more it's squeezed. (Only the walls pushed it before:
  // a cube squeezed a seventh smaller let five drops out of its slit in four seconds.)
  _squeeze(F) {
    if (!this.pressOn) return;
    const sb = this.app.sb, P = this.press, C = this.pressC, v = this.v, x = this.x, AC = this.atCut, own = this.own;
    for (let i = 0; i < this.n; i++) {
      if (!AC[i] || !own[i]) continue;
      let k = -1;
      for (let q = 0; q < MAX_CUBES; q++)
        if (sb.cHid[q] === own[i]) {
          k = q;
          break;
        }
      if (k < 0 || !(P[k] > 0)) continue;
      const o = i * 3, dx = x[o] - C[k * 3], dy = x[o + 1] - C[k * 3 + 1], dz = x[o + 2] - C[k * 3 + 2], l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!(l > 1e-6)) continue;
      const a = (PRESS_ACC * P[k] * F) / l;
      v[o] += dx * a; v[o + 1] += dy * a; v[o + 2] += dz * a;
    }
  }

  wake() {
    this.asleep = false;
    this.stillT = 0;
    this._acc = this._carry = 0;
  }

  // Jelly awake within reach of the (sleeping) pool?
  _stirred() {
    const x = this.x, m = 0.1;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let o = 0; o < this.n * 3; o += 3) {
      x0 = Math.min(x0, x[o]); x1 = Math.max(x1, x[o]);
      y0 = Math.min(y0, x[o + 1]); y1 = Math.max(y1, x[o + 1]);
      z0 = Math.min(z0, x[o + 2]); z1 = Math.max(z1, x[o + 2]);
    }
    for (const pc of this.app.sb.pieces) {
      const b = pc.bbox;
      if (pc.asleep || !(b[3] > b[0])) continue;
      if (b[0] > x1 + m || b[3] < x0 - m || b[1] > y1 + m || b[4] < y0 - m || b[2] > z1 + m || b[5] < z0 - m) continue;
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- sim
  _grid(P) {
    const n = this.n, iH = 1 / H, M = this.hashSize - 1;
    const cs = this.cellStart, cellOf = this.cellOf, order = this.order;
    cs.fill(0);
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const c = (Math.imul(Math.floor(P[o] * iH), 92837111) ^ Math.imul(Math.floor(P[o + 1] * iH), 689287499) ^ Math.imul(Math.floor(P[o + 2] * iH), 283923481)) & M;
      cellOf[i] = c;
      cs[c + 1]++;
    }
    for (let k = 0; k < this.hashSize; k++) cs[k + 1] += cs[k];
    const fill = this._fill && this._fill.length === this.hashSize ? this._fill : (this._fill = new Int32Array(this.hashSize));
    fill.set(cs.subarray(0, this.hashSize));
    for (let i = 0; i < n; i++) order[fill[cellOf[i]]++] = i;
  }

  // calls f(j, dx, dy, dz, d2) for the particles within H of particle i (at P)
  _near(P, i, f) {
    const o = i * 3, iH = 1 / H, M = this.hashSize - 1;
    const px = P[o], py = P[o + 1], pz = P[o + 2];
    const cx = Math.floor(px * iH), cy = Math.floor(py * iH), cz = Math.floor(pz * iH);
    if (++this._stamp > 2e9) {
      this._stamp = 1;
      this.seen.fill(0);
    }
    const cs = this.cellStart, order = this.order, seen = this.seen, stamp = this._stamp;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let c = -1; c <= 1; c++) {
          const hh = (Math.imul(cx + a, 92837111) ^ Math.imul(cy + b, 689287499) ^ Math.imul(cz + c, 283923481)) & M;
          for (let e = cs[hh]; e < cs[hh + 1]; e++) {
            const j = order[e];
            // (two of the cells can share a bucket: each particle once)
            if (j === i || seen[j] === stamp) continue;
            seen[j] = stamp;
            const q = j * 3, dx = px - P[q], dy = py - P[q + 1], dz = pz - P[q + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < H * H) f(j, dx, dy, dz, d2);
          }
        }
  }

  // Each particle's neighbours within H (this substep's: the solver's
  // rounds reuse them), into nb from nbStart[i].
  // (Not through a cube full of liquid's wall: one in it and one out of it - see dIn - with jelly between them
  // aren't neighbours. The reach is nearly two drops', more than a wall's thickness: what had run out, lying
  // against the wall, pulled what was in it out through it. Across an opening they are: the liquid going out of
  // it is all one - kept apart there, less ran out of a slit pulled open and more fell back in.)
  _neighbours(P) {
    const n = this.n, NB = this.nb, NS = this.nbStart, iH = 1 / H, M = this.hashSize - 1, H2 = H * H;
    const cs = this.cellStart, order = this.order, seen = this.seen, DI = this.dIn;
    let w = 0;
    for (let i = 0; i < n; i++) {
      NS[i] = w;
      if (++this._stamp > 2e9) {
        this._stamp = 1;
        seen.fill(0);
      }
      const stamp = this._stamp, lim = w + MAXNB, o = i * 3, px = P[o], py = P[o + 1], pz = P[o + 2], si = DI[i];
      const cx = Math.floor(px * iH), cy = Math.floor(py * iH), cz = Math.floor(pz * iH);
      for (let a = -1; a <= 1; a++) {
        const ha = Math.imul(cx + a, 92837111);
        for (let b = -1; b <= 1; b++) {
          const hb = ha ^ Math.imul(cy + b, 689287499);
          for (let c = -1; c <= 1; c++) {
            const hh = (hb ^ Math.imul(cz + c, 283923481)) & M;
            for (let e = cs[hh], e1 = cs[hh + 1]; e < e1; e++) {
              const j = order[e];
              // (two of the cells can share a bucket: each particle once)
              if (j === i || seen[j] === stamp) continue;
              seen[j] = stamp;
              const sj = DI[j];
              const q = j * 3, dx = px - P[q], dy = py - P[q + 1], dz = pz - P[q + 2];
              if (!(dx * dx + dy * dy + dz * dz < H2) || w >= lim) continue;
              if (si !== sj && si !== 255 && sj !== 255 && this._walled(px, py, pz, dx, dy, dz)) continue;
              NB[w++] = j;
            }
          }
        }
      }
    }
    NS[n] = w;
  }

  // (jelly on the way from p back along d: looked at a fifth of the way at a time - closer than the thinnest
  // wall, 5 cm, for two drops a reach apart)
  _walled(px, py, pz, dx, dy, dz) {
    for (let s = 1; s <= 4; s++) {
      const f = s * 0.2;
      if (this._inTet(px - dx * f, py - dy * f, pz - dz * f) >= 0) return true;
    }
    return false;
  }

  // Position based fluids: predict, then a few rounds of pushing apart
  // where the liquid is packed denser than at rest (lambda: how much, per
  // particle; relaxed by eps so it settles rather than rings), out of the
  // floor and the jelly; velocity from how far it went, smoothed toward its
  // neighbours' (XSPH: thick).
  _step(h) {
    const n = this.n, x = this.x, q = this.q, v = this.v, g = this.app.sb.p.gravity ?? -22;
    // (the table tipped - see Tilt: the liquid's pulled sideways as the jelly is; not, the jelly leaned into it
    // as it stood, rammed it through its walls)
    const tl = this.app.sb.tilt, tx = tl ? tl[0] || 0 : 0, tz = tl ? tl[1] || 0 : 0;
    // (thick stuff resting on something - see _onSome - only a little of its weight: putty creeps, slime slumps)
    const RS = this._rested, VS = this.visc;
    for (let o = 0; o < n * 3; o += 3) {
      const gs = RS[o / 3] ? 0.04 + (0.5 * Math.max(0, 0.95 - VS[o / 3])) / 0.35 : 1;
      v[o] += tx * h * gs;
      v[o + 1] += g * h * gs;
      v[o + 2] += tz * h * gs;
      q[o] = x[o] + v[o] * h; q[o + 1] = x[o + 1] + v[o + 1] * h; q[o + 2] = x[o + 2] + v[o + 2] * h;
    }
    this.cpush.fill(0, 0, n * 3);
    this.cvel.fill(0, 0, n * 3);
    this.cvn.fill(0, 0, n);
    this._collide(q);
    this._radius(q);
    this._grid(q);
    this._neighbours(q);
    const K6 = this.K6, KS = this.KS, irho = 1 / this.rho0, H2 = H * H, W0 = K6 * H2 * H2 * H2;
    const lam = this.lam, dp = this.dp, NB = this.nb, NS = this.nbStart, eps = this.eps, lim = 0.25 * D;
    const iDq = 1 / this.wDq, kC = this.kCorr, age = this.age, PW = this.pw, PC = this.pc, MS = this.mass;
    // (a lot of it: two rounds - it settles a little lower, but at a third less)
    const rounds = n > 900 ? 2 : ITER;
    for (let it = 0; it < rounds; it++) {
      for (let i = 0; i < n; i++) {
        const o = i * 3, px = q[o], py = q[o + 1], pz = q[o + 2];
        let r = W0, gx = 0, gy = 0, gz = 0, s2 = 0;
        for (let e = NS[i], e1 = NS[i + 1]; e < e1; e++) {
          const p = NB[e] * 3, dx = px - q[p], dy = py - q[p + 1], dz = pz - q[p + 2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= H2 || d2 < 1e-12) {
            PW[e] = 0;
            if (d2 < H2) r += W0;
            continue;
          }
          const u = H2 - d2, W = K6 * u * u * u;
          r += W;
          // (kept for the push below: positions don't change in between)
          const d = Math.sqrt(d2), hd = H - d, gf = (KS * hd * hd) / d, w = gf * irho;
          PW[e] = gf;
          const c = W * iDq, c2 = c * c;
          PC[e] = kC * c2 * c2;
          gx += dx * w; gy += dy * w; gz += dz * w;
          s2 += w * w * d2;
        }
        // (packed: push apart; thin - the surface - pull together, gently)
        // (one carrying more sits at a lower density - its target 1/mass of the rest's: scaling C by its mass
        // instead, not its gradient, over-corrected twice over, and flung drops about at metres a second)
        const C = r * irho - 1 / MS[i];
        lam[i] = -(C > 0 ? C : COH * Math.max(C, -0.35)) / (s2 + gx * gx + gy * gy + gz * gz + eps);
      }
      for (let i = 0; i < n; i++) {
        const o = i * 3, px = q[o], py = q[o + 1], pz = q[o + 2], li = lam[i];
        let ax = 0, ay = 0, az = 0;
        for (let e = NS[i], e1 = NS[i + 1]; e < e1; e++) {
          const gf = PW[e];
          if (gf === 0) continue;
          const j = NB[e], p = j * 3;
          // (grad W points from i toward j: packed - lambda < 0 - pushes apart)
          const w = -(li + lam[j] - PC[e]) * gf;
          ax += (px - q[p]) * w; ay += (py - q[p + 1]) * w; az += (pz - q[p + 2]) * w;
        }
        ax *= irho; ay *= irho; az *= irho;
        const l2 = ax * ax + ay * ay + az * az;
        if (l2 > lim * lim) {
          const k = lim / Math.sqrt(l2);
          ax *= k; ay *= k; az *= k;
        }
        dp[o] = ax; dp[o + 1] = ay; dp[o + 2] = az;
      }
      for (let k = 0; k < n * 3; k++) q[k] += dp[k];
      // (out of the jelly after the last round: after every one, it took a fifth of the liquid's time - a held
      // cube's, on a phone, its frame rate)
      if (it === rounds - 1) {
        this._collide(q);
        if (this.cups.length) this._air(q);
      }
    }
    // velocities, then the viscosity. (The solver may stop it dead, but
    // speeds it up only a little a substep - squeezed, it oozes rather than
    // squirts; a particle just made, hardly at all: sorting out where it
    // fits isn't a kick.)
    const ih = 1 / h;
    for (let o = 0; o < n * 3; o += 3) {
      let vx = (q[o] - x[o]) * ih, vy = (q[o + 1] - x[o + 1]) * ih, vz = (q[o + 2] - x[o + 2]) * ih;
      const s2 = vx * vx + vy * vy + vz * vz;
      const vm = Math.min(VMAX, Math.sqrt(v[o] * v[o] + v[o + 1] * v[o + 1] + v[o + 2] * v[o + 2]) + (age[o / 3] < 0.5 ? 0.15 : GAIN));
      if (s2 > vm * vm) {
        const k = vm / Math.sqrt(s2);
        vx *= k; vy *= k; vz *= k;
      }
      // (pushed out of the jelly this substep: no faster out of it than 0.3 m/s - pressed into a cut cube's wall
      // by the liquid behind, drops were shoved out through it at metres a second - and none into it - against a
      // wall, at rest, it stays at rest: else each substep it sank back into the wall and was pushed out again,
      // and a pool in a cut cube churned for ever - a little friction along it. All as against the jelly there,
      // moving as it is: held to a standstill, a falling cube's liquid fell at a third of its speed - its top
      // swept down through it - and a cube swung about left its liquid behind, out through its walls.)
      const cpx = this.cpush[o], cpy = this.cpush[o + 1], cpz = this.cpush[o + 2], cpl = Math.sqrt(cpx * cpx + cpy * cpy + cpz * cpz);
      if (cpl > 1e-7) {
        const nc = this.cvn[o / 3], cv = this.cvel, jx = nc ? cv[o] / nc : 0, jy = nc ? cv[o + 1] / nc : 0, jz = nc ? cv[o + 2] / nc : 0;
        let rx = vx - jx, ry = vy - jy, rz = vz - jz;
        const nx = cpx / cpl, ny = cpy / cpl, nz = cpz / cpl, vn = rx * nx + ry * ny + rz * nz;
        const k = vn > 0.3 ? vn - 0.3 : vn < 0 ? vn : 0;
        rx -= nx * k; ry -= ny * k; rz -= nz * k;
        const vn2 = vn - k, fr2 = 0.92;
        vx = jx + nx * vn2 + (rx - nx * vn2) * fr2; vy = jy + ny * vn2 + (ry - ny * vn2) * fr2; vz = jz + nz * vn2 + (rz - nz * vn2) * fr2;
        // (no faster than ever, though: carried off a cube's top springing back from a landing at 12 m/s, drops
        // went clean through it)
        const s3 = vx * vx + vy * vy + vz * vz;
        if (s3 > VMAX * VMAX) {
          const k3 = VMAX / Math.sqrt(s3);
          vx *= k3; vy *= k3; vz *= k3;
        }
      }
      v[o] = vx; v[o + 1] = vy; v[o + 2] = vz;
    }
    const dv = this.dp, SW = this._sw;
    for (let i = 0; i < n; i++) {
      const o = i * 3, px = q[o], py = q[o + 1], pz = q[o + 2];
      let ax = 0, ay = 0, az = 0, sw = 0;
      for (let e = NS[i], e1 = NS[i + 1]; e < e1; e++) {
        const p = NB[e] * 3, dx = px - q[p], dy = py - q[p + 1], dz = pz - q[p + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= H2) continue;
        const u = H2 - d2, w = K6 * u * u * u * irho;
        ax += (v[p] - v[o]) * w; ay += (v[p + 1] - v[o + 1]) * w; az += (v[p + 2] - v[o + 2]) * w;
        sw += w;
      }
      dv[o] = ax; dv[o + 1] = ay; dv[o + 2] = az;
      SW[i] = sw;
    }
    const damp = Math.exp(-1.2 * h), fr = 1 - Math.min(1, 6 * h), slush = Math.exp(-14 * h), settle = Math.exp(-5 * h), temp = this.temp, VI = this.visc, TK = this.thick;
    for (let o = 0; o < n * 3; o += 3) {
      // (cold enough to set: slush - it hardly flows; thick stuff - glue - drags too)
      const i = o / 3, vi = VI[i], tk = TK[i] > 0 ? Math.exp(-TK[i] * h) : 1;
      // (slow, it settles: a pool barely moving had a slow churn - drops sinking into the walls and floor and
      // pushed back - that never died away, and never slept; flowing, it's left be)
      const sp2 = v[o] * v[o] + v[o + 1] * v[o + 1] + v[o + 2] * v[o + 2];
      const dm = (temp[i] < SET_T ? slush : damp) * tk * (sp2 < 0.0625 ? settle : 1);
      // (slime, putty: moving against what's round it slower than it yields, it moves with it - its neighbours'
      // velocity, all of it: a lump falls as a lump, a heap holds, till it's pushed hard)
      let rx = vi * dv[o], ry = vi * dv[o + 1], rz = vi * dv[o + 2], rest = 0;
      if (vi > YIELD_V && SW[i] > 1e-6 && NS[i + 1] - NS[i] >= 4) {
        const s = 1 / SW[i], ax = dv[o] * s, ay = dv[o + 1] * s, az = dv[o + 2] * s, ys = (vi - YIELD_V) * YIELD_K;
        if (ax * ax + ay * ay + az * az < ys * ys) {
          rx = ax; ry = ay; rz = az;
          // (and resting on what's under it - the floor, the jelly, its own below it - slow: its weight on that,
          // not pressing it out sideways: the solver let a heap of it creep flat however its velocities were held)
          if (v[o] * v[o] + v[o + 1] * v[o + 1] + v[o + 2] * v[o + 2] < ys * ys && this._onSome(i, q, NS, NB)) rest = 1;
        }
      }
      this._rested[i] = rest;
      v[o] = (v[o] + rx) * dm; v[o + 1] = (v[o + 1] + ry) * (temp[i] < SET_T ? damp * tk : dm); v[o + 2] = (v[o + 2] + rz) * dm;
      // (floor friction: thick stuff drags)
      if (q[o + 1] <= R_P * 1.05) {
        v[o] *= fr;
        v[o + 2] *= fr;
      }
      x[o] = q[o]; x[o + 1] = q[o + 1]; x[o + 2] = q[o + 2];
    }
  }

  // (drop i on something: the floor, the jelly (pushed off it this substep), or one of its own under it that's
  // itself resting so - held up from the ground, not by each other: a lump in the air hung there)
  _onSome(i, q, NS, NB) {
    const o = i * 3, RS = this._rested;
    if (q[o + 1] <= R_P * 1.1 || this.cvn[i] > 0) return true;
    const px = q[o], py = q[o + 1] - 0.4 * D, pz = q[o + 2], r2 = 0.64 * D * D;
    for (let e = NS[i], e1 = NS[i + 1]; e < e1; e++) {
      if (!RS[NB[e]]) continue;
      const p = NB[e] * 3;
      if (q[p + 1] > py) continue;
      const dx = q[p] - px, dz = q[p + 2] - pz;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  }

  // The jelly's tets round the liquid, hashed by cells of 0.1 m (once a
  // frame; kept while the jelly near it sleeps and the liquid stays inside
  // what they cover); and which of each tet's faces are on the jelly's
  // surface (bit k: the face opposite its corner k).
  _jellyCells() {
    const sb = this.app.sb;
    // (mid-way through a run of cuts: no surface yet - nothing to hit)
    if (sb.topoStale || !sb.nT) {
      this.cellsN = 0;
      this._cellVer = -1;
      return;
    }
    if (this._maskVer !== sb.topoVersion || !this.faceMask || this.faceMask.length < sb.nT) {
      this._maskVer = sb.topoVersion;
      if (!this.faceMask || this.faceMask.length < sb.nT) (this.faceMask = new Uint8Array(Math.ceil(sb.nT * 1.25))), (this.innerMask = new Uint8Array(this.faceMask.length)), (this.cutMask = new Uint8Array(this.faceMask.length));
      // (and which of those aren't the cube's outside - a hollow's walls, a cut's faces: see _clip)
      const fm = this.faceMask, im = this.innerMask, cm = this.cutMask, T = sb.T, S = sb.sTri, ST = sb.sTet, tag = sb.sTag, XR = sb.X, HB = sb.cHole, so = sb.slitOf;
      fm.fill(0, 0, sb.nT);
      im.fill(0, 0, sb.nT);
      cm.fill(0, 0, sb.nT);
      for (let f = 0; f < sb.nF; f++) {
        const t = ST[f], a = S[f * 3], b = S[f * 3 + 1], c = S[f * 3 + 2];
        for (let k = 0; k < 4; k++) {
          const u = T[t * 4 + k];
          if (u !== a && u !== b && u !== c) {
            fm[t] |= 1 << k;
            if (tag[f] !== TAG_EXTERIOR) im[t] |= 1 << k;
            break;
          }
        }
        // (a cut's: not its outside, nor its hollow's - in its rest shape, out past the hollow's box by more than
        // a quarter of a cell - see _contain; and not a slit's: a slit seeps as it's meant to, see _gaps)
        const kc = sb.tCube[t];
        if (tag[f] === TAG_EXTERIOR || !sb.cHollow[kc]) continue;
        let slit = false;
        for (let k = 0; k < 4 && !slit; k++) {
          const u = T[t * 4 + k];
          slit = !!so[u] && so[u] - 1 !== u;
        }
        // (a slit's: 2 - only while it's squeezed open, see _radius)
        if (slit) {
          cm[t] = 2;
          continue;
        }
        const h6 = kc * 6, q4 = 0.25 * sb.cH[kc];
        let o2 = 0;
        for (let ax = 0; ax < 3; ax++) {
          const r = (XR[a * 3 + ax] + XR[b * 3 + ax] + XR[c * 3 + ax]) / 3, out = Math.max(HB[h6 + ax] - r, 0, r - HB[h6 + 3 + ax]);
          o2 += out * out;
        }
        if (o2 > q4 * q4) cm[t] = 1;
      }
    }
    const n = this.n, x = this.x;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let o = 0; o < n * 3; o += 3) {
      x0 = Math.min(x0, x[o]); x1 = Math.max(x1, x[o]);
      y0 = Math.min(y0, x[o + 1]); y1 = Math.max(y1, x[o + 1]);
      z0 = Math.min(z0, x[o + 2]); z1 = Math.max(z1, x[o + 2]);
    }
    let moving = false;
    for (const pc of sb.pieces) {
      const b = pc.bbox;
      if (!pc.asleep && b[3] > b[0] && !(b[0] > x1 + 0.3 || b[3] < x0 - 0.3 || b[1] > y1 + 0.3 || b[4] < y0 - 0.3 || b[2] > z1 + 0.3 || b[5] < z0 - 0.3)) moving = true;
    }
    const cv = this._cov;
    if (!moving && this._cellVer === sb.topoVersion && x0 >= cv[0] && y0 >= cv[1] && z0 >= cv[2] && x1 <= cv[3] && y1 <= cv[4] && z1 <= cv[5]) return;
    this._cellVer = sb.topoVersion;
    const m = 0.25;
    x0 -= m; y0 -= m; z0 -= m; x1 += m; y1 += m; z1 += m;
    cv[0] = x0 + 0.1; cv[1] = y0 + 0.1; cv[2] = z0 + 0.1; cv[3] = x1 - 0.1; cv[4] = y1 - 0.1; cv[5] = z1 - 0.1;
    // each tet's cells (counted, then filled: a counting sort into buckets) - and its box, for _inTet. (Each pass its
    // own method: all in one, Safari's engine took five times as long over it.)
    if (this.tBox.length < sb.nT * 6) this.tBox = new Float32Array(Math.ceil(sb.nT * 1.25) * 6);
    const cs = this.cStart;
    cs.fill(0);
    const nL = this._countCells(x0, y0, z0, x1, y1, z1);
    for (let k = 0; k < CELL_HASH; k++) cs[k + 1] += cs[k];
    if (!this.cTets || this.cTets.length < cs[CELL_HASH]) this.cTets = new Int32Array(Math.ceil(cs[CELL_HASH] * 1.5) + 64);
    this._cFill.set(cs.subarray(0, CELL_HASH));
    this._fillCells(nL);
    this.cellsN = nL;
  }

  // (the tets near (x0..x1, ...): each listed with its range of cells, its cells counted - how many)
  _countCells(x0, y0, z0, x1, y1, z1) {
    const sb = this.app.sb, T = sb.T, X = sb.x, CM = CELL_HASH - 1, cs = this.cStart, P = sb.pieces, v0 = sb.vol0;
    let nL = 0;
    for (let l = 0; l < P.length; l++) {
      const pc = P[l], b = pc.bbox, tets = pc.tets;
      if (!(b[3] > b[0]) || b[0] > x1 || b[3] < x0 || b[1] > y1 || b[4] < y0 || b[2] > z1 || b[5] < z0) continue;
      for (let m = 0; m < tets.length; m++) {
        const t = tets[m];
        if (v0[t] <= 0 || !this._near1(T, X, t, x0, y0, z0, x1, y1, z1)) continue;
        const r = this._tr;
        if (nL * 7 + 7 > this._cRange.length) {
          const g = new Int32Array(this._cRange.length * 2);
          g.set(this._cRange);
          this._cRange = g;
        }
        const R = this._cRange, o = nL * 7;
        R[o] = t; R[o + 1] = r[0]; R[o + 2] = r[1]; R[o + 3] = r[2]; R[o + 4] = r[3]; R[o + 5] = r[4]; R[o + 6] = r[5];
        nL++;
        for (let i = r[0]; i <= r[1]; i++)
          for (let j = r[2]; j <= r[3]; j++)
            for (let k = r[4]; k <= r[5]; k++) cs[((Math.imul(i, 92837111) ^ Math.imul(j, 689287499) ^ Math.imul(k, 283923481)) & CM) + 1]++;
      }
    }
    return nL;
  }

  // (and each listed tet into its cells' buckets)
  _fillCells(nL) {
    const CM = CELL_HASH - 1, fill = this._cFill, out = this.cTets, R = this._cRange;
    for (let l = 0; l < nL; l++) {
      const o = l * 7, t = R[o];
      for (let i = R[o + 1]; i <= R[o + 2]; i++)
        for (let j = R[o + 3]; j <= R[o + 4]; j++)
          for (let k = R[o + 5]; k <= R[o + 6]; k++) out[fill[(Math.imul(i, 92837111) ^ Math.imul(j, 689287499) ^ Math.imul(k, 283923481)) & CM]++] = t;
    }
  }

  // Tet t's box overlaps (x0..x1, ...)? Its range of 0.1 m cells into this._tr.
  _near1(T, X, t, x0, y0, z0, x1, y1, z1) {
    const o = t * 4, a = T[o] * 3, b = T[o + 1] * 3, c = T[o + 2] * 3, d = T[o + 3] * 3;
    const tx0 = Math.min(X[a], X[b], X[c], X[d]), tx1 = Math.max(X[a], X[b], X[c], X[d]);
    if (tx0 > x1 || tx1 < x0) return false;
    const ty0 = Math.min(X[a + 1], X[b + 1], X[c + 1], X[d + 1]), ty1 = Math.max(X[a + 1], X[b + 1], X[c + 1], X[d + 1]);
    if (ty0 > y1 || ty1 < y0) return false;
    const tz0 = Math.min(X[a + 2], X[b + 2], X[c + 2], X[d + 2]), tz1 = Math.max(X[a + 2], X[b + 2], X[c + 2], X[d + 2]);
    if (tz0 > z1 || tz1 < z0) return false;
    // (a tet stretched past 8 cells a side is torn to bits: skip it)
    const r = this._tr, B = this.tBox, b6 = t * 6;
    B[b6] = tx0; B[b6 + 1] = ty0; B[b6 + 2] = tz0; B[b6 + 3] = tx1; B[b6 + 4] = ty1; B[b6 + 5] = tz1;
    r[0] = Math.floor(tx0 * 10); r[1] = Math.floor(tx1 * 10);
    r[2] = Math.floor(ty0 * 10); r[3] = Math.floor(ty1 * 10);
    r[4] = Math.floor(tz0 * 10); r[5] = Math.floor(tz1 * 10);
    return r[1] - r[0] < 8 && r[3] - r[2] < 8 && r[5] - r[4] < 8;
  }

  // Floor, arena wall, and out of the jelly: through the nearest of the
  // tet's faces that's on the jelly's surface (so it runs down the sides
  // rather than climbing them), or - deeper in - along the escape field
  // (the way to the nearest outside, mapped from rest space by the tet's
  // deformation).
  _collide(q) {
    const sb = this.app.sb, R = sb.p.arenaRadius - R_P, CM = CELL_HASH - 1, carry = this._carry;
    this._carry = 0; // (the jelly moved before the frame's first look only - after the solver's rounds, not again)
    const T = sb.T, X = sb.x, E = sb.esc, B = sb.B, ct = sb._ct, fm = this.faceMask, cs = this.cStart, ctl = this.cTets;
    for (let i = 0; i < this.n; i++) {
      const o = i * 3;
      if (q[o + 1] < R_P) q[o + 1] = R_P;
      if (sb.p.box) {
        // (the glass room: square)
        if (q[o] > R) q[o] = R;
        else if (q[o] < -R) q[o] = -R;
        if (q[o + 2] > R) q[o + 2] = R;
        else if (q[o + 2] < -R) q[o + 2] = -R;
      } else {
        const r2 = q[o] * q[o] + q[o + 2] * q[o + 2];
        if (r2 > R * R) {
          const r = Math.sqrt(r2);
          q[o] *= R / r;
          q[o + 2] *= R / r;
        }
      }
      if (!this.cellsN) {
        this.lastOut[o] = q[o]; this.lastOut[o + 1] = q[o + 1]; this.lastOut[o + 2] = q[o + 2];
        continue;
      }
      // (moving further this substep than a wall's thinnest - 2 cm looks along its way, from where it was, clear
      // of the jelly: stopped short of the first that's in it - it can't pass clean through between looks)
      const x = this.x, ex = q[o] - x[o], ey = q[o + 1] - x[o + 1], ez = q[o + 2] - x[o + 2], e2 = ex * ex + ey * ey + ez * ez;
      if (e2 > 0.03 * 0.03 && this._inTet(x[o], x[o + 1], x[o + 2]) < 0) {
        const ns = Math.ceil(Math.sqrt(e2) / 0.02);
        for (let s = 1; s < ns; s++) {
          if (this._inTet(x[o] + (ex * s) / ns, x[o + 1] + (ey * s) / ns, x[o + 2] + (ez * s) / ns) < 0) continue;
          const u = (s - 1) / ns;
          q[o] = x[o] + ex * u; q[o + 1] = x[o + 1] + ey * u; q[o + 2] = x[o + 2] + ez * u;
          break;
        }
      }
      // In the jelly: out of it along one line, tet after tet, till it's clear - the line chosen once:
      // back toward where it was last outside the jelly, if that's outside it still; else, the jelly moving,
      // the way it's going (a wall swung onto it pushes it on ahead); else out its nearest bare face (or, in
      // a tet with none, its nearest face - and on). (Pushed out each tet's own way, a drop between two of a
      // wall's tets went back and forth between them for ever - and out the nearest face, one deep in a wall
      // came out its far side: the cube leaked all round.)
      // In a cube full of liquid's shell, never through it: back where it was last outside - carried on as the
      // jelly there's moved since - if that's near and clear still, else straight to the nearest free space
      // round it on that side; none, it stays put this substep. (Out along the way the jelly was moving, drops
      // just made in a cut cube, or a puddle a cube slid over, went 20-50 cm in a frame - out through its top,
      // its sides, its bottom: it leaked where it wasn't cut. And to the nearest free space whichever side, a
      // cube grabbed and shaken - its walls coming on further in a frame than half their thickness - shoved a
      // fifth of its liquid out through them.)
      let dirSet = false, dx = 0, dy = 0, dz = 0, went = 0, liq = false, cap = D;
      for (let pass = 0; pass < 8; pass++) {
        const t = this._inTet(q[o], q[o + 1], q[o + 2]);
        if (t < 0) {
          this.lastOut[o] = q[o]; this.lastOut[o + 1] = q[o + 1]; this.lastOut[o + 2] = q[o + 2];
          break;
        }
        if (this.acid[i] > 0) this.acidTet[i] = t;
        const t4 = t * 4, a3 = T[t4] * 3, b3 = T[t4 + 1] * 3, c3 = T[t4 + 2] * 3, d3 = T[t4 + 3] * 3;
        const g = this._g, bs = this._bs, det = this._grads(T, X, t, q[o], q[o + 1], q[o + 2]);
        if (!(Math.abs(det) > 1e-12)) break;
        if (!dirSet) {
          dirSet = true;
          liq = sb.cLiq[sb.tCube[t]] === 1;
          const Vx = sb.v[a3] + sb.v[b3] + sb.v[c3] + sb.v[d3], Vy = sb.v[a3 + 1] + sb.v[b3 + 1] + sb.v[c3 + 1] + sb.v[d3 + 1], Vz = sb.v[a3 + 2] + sb.v[b3 + 2] + sb.v[c3 + 2] + sb.v[d3 + 2];
          const Vl = Math.sqrt(Vx * Vx + Vy * Vy + Vz * Vz), cw = liq ? 0.25 * carry : 0;
          const LO = this.lastOut, Lx = LO[o] + Vx * cw, Ly = LO[o + 1] + Vy * cw, Lz = LO[o + 2] + Vz * cw;
          const lx = Lx - q[o], ly = Ly - q[o + 1], lz = Lz - q[o + 2], ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
          if (ll > 1e-5 && (!liq || ll < 2 * D) && this._inTet(Lx, Ly, Lz) < 0) {
            dx = lx / ll; dy = ly / ll; dz = lz / ll;
            // (and that's where it was last outside now - not back where the wall's since come over: the solver's
            // next round pushing it back into the wall, the way back from there was out the far side)
            if (cw > 0) (LO[o] = Lx), (LO[o + 1] = Ly), (LO[o + 2] = Lz);
          } else if (liq && this._inward(t, q[o], q[o + 1], q[o + 2], Lx, Ly, Lz)) {
            // (no clear way back - the wall's come on further than that, or turned: which side of it it belongs,
            // from the cube as made - see _inward - and through the wall the short way to it)
            const F = this._f3, fx = F[0] - q[o], fy = F[1] - q[o + 1], fz = F[2] - q[o + 2], fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
            this._grads(T, X, t, q[o], q[o + 1], q[o + 2]);
            dx = fx / fl; dy = fy / fl; dz = fz / fl;
            cap = 2 * D;
          } else if (liq) {
            // (out to the nearest free space round it on the side it came from - straight there. A wall that
            // came down on it - an emptied shell falling in on its liquid - pushes it back the way it's barely
            // in, not on through the wall.)
            this._grads(T, X, t, q[o], q[o + 1], q[o + 2]);
            const F = this._f3;
            if (this._free(q[o], q[o + 1], q[o + 2], F, lx, ly, lz)) {
              const cp = this.cpush, ex = F[0] - q[o], ey = F[1] - q[o + 1], ez = F[2] - q[o + 2];
              q[o] = F[0]; q[o + 1] = F[1]; q[o + 2] = F[2];
              // (out there, it's where it was last outside - pushed back into the wall by the solver's next round,
              // it's put back here, on this side: back where it was before, under a wall that had come on since,
              // it went on out the wall's far side)
              LO[o] = F[0]; LO[o + 1] = F[1]; LO[o + 2] = F[2];
              cp[o] += ex; cp[o + 1] += ey; cp[o + 2] += ez;
              const cv = this.cvel;
              cv[o] += 0.25 * Vx; cv[o + 1] += 0.25 * Vy; cv[o + 2] += 0.25 * Vz;
              this.cvn[i]++;
            }
            break;
          } else if (Vl > 4 * 0.02) {
            dx = Vx / Vl; dy = Vy / Vl; dz = Vz / Vl;
          } else {
            // (its nearest bare face - or, none bare, its nearest face)
            const mk = fm[t];
            let best = Infinity;
            for (let pick = 0; pick < 2 && best === Infinity; pick++)
              for (let k = 0; k < 4; k++) {
                if (pick === 0 && !(mk & (1 << k))) continue;
                const gx = g[k * 3] / det, gy = g[k * 3 + 1] / det, gz = g[k * 3 + 2] / det, gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
                const dist = bs[k] / gl;
                if (dist < best) (best = dist), (dx = -gx / gl), (dy = -gy / gl), (dz = -gz / gl);
              }
          }
        }
        // how far along the line to this tet's edge: the nearest face it's heading out of
        let sOut = Infinity;
        for (let k = 0; k < 4; k++) {
          const gx = g[k * 3] / det, gy = g[k * 3 + 1] / det, gz = g[k * 3 + 2] / det;
          const rate = -(gx * dx + gy * dy + gz * dz); // (how fast b_k falls along the line)
          if (rate > 1e-9) {
            const sk = bs[k] / rate;
            if (sk < sOut) sOut = sk;
          }
        }
        if (!(sOut < Infinity)) sOut = 0.004;
        const step = Math.min(sOut, 0.12) + 0.002;
        if (liq && (went += step) > cap) break;
        q[o] += dx * step; q[o + 1] += dy * step; q[o + 2] += dz * step;
        const cp = this.cpush, cv = this.cvel, sv = sb.v;
        cp[o] += dx * step; cp[o + 1] += dy * step; cp[o + 2] += dz * step;
        cv[o] += 0.25 * (sv[a3] + sv[b3] + sv[c3] + sv[d3]); cv[o + 1] += 0.25 * (sv[a3 + 1] + sv[b3 + 1] + sv[c3 + 1] + sv[d3 + 1]); cv[o + 2] += 0.25 * (sv[a3 + 2] + sv[b3 + 2] + sv[c3 + 2] + sv[d3 + 2]);
        this.cvn[i]++;
      }
    }
  }

  // A drop is a drop's width across: against a cube full of liquid's shell, its middle no nearer the jelly
  // than half that - looked for along each axis, just how far in worked out from the tet it's in (halved down
  // to a few mm instead, the push jittered, and the liquid in a cube at rest churned round and round), and
  // eased back off it (RADIUS_K a substep). (As points, drops pressed against the walls and floor were shoved
  // back to just clear of them - all onto the one sheet: they piled up there, half a drop apart, and a full
  // cube's liquid stood half as tall.)
  _radius(q) {
    if (!this.cellsN) return;
    const sb = this.app.sb, r = R_P, A = NB6, cp = this.cpush, cv = this.cvel, sv = sb.v, g = this._g, bs = this._bs, T = sb.T, X = sb.x, CM = this.cutMask;
    for (let i = 0; i < this.n; i++) {
      const o = i * 3;
      let px = q[o], py = q[o + 1], pz = q[o + 2], mx = 0, my = 0, mz = 0, jx = 0, jy = 0, jz = 0, nj = 0;
      for (let k = 0; k < 6; k++) {
        const [ax, ay, az] = A[k];
        // (half as far too: a wall thinner than a drop - a thin skin's - was looked right through, and its drops
        // pressed on into it and out the far side)
        let rr = r, t = this._inTet(px + ax * r, py + ay * r, pz + az * r);
        if (t < 0) (rr = 0.5 * r), (t = this._inTet(px + ax * rr, py + ay * rr, pz + az * rr));
        if (t < 0 || sb.cLiq[sb.tCube[t]] !== 1) continue;
        // (off a cut's faces - a hole's, a slit's - only a third as far: a drop's as wide as a bullet's hole, and
        // they jammed in its mouth, the liquid stood where it was over it; and one by them moving on keeps the
        // liquid awake, as in a slit - see _gaps: it trickles out slowly, and fell asleep part way down)
        let rc = r;
        if (CM[t] === 1 || (CM[t] === 2 && this.press[sb.tCube[t]] > 0)) {
          this._gapSeen[i] = 1;
          this.atCut[i] = 1;
          rc = rr = CUT_R * r;
          t = this._inTet(px + ax * rr, py + ay * rr, pz + az * rr);
          if (t < 0 || sb.cLiq[sb.tCube[t]] !== 1) continue;
        }
        // (how far in: back along the line from there to where it came into that tet - exactly)
        const det = this._grads(T, X, t, px + ax * rr, py + ay * rr, pz + az * rr);
        if (!(Math.abs(det) > 1e-15)) continue;
        let back = Infinity;
        for (let qq = 0; qq < 4; qq++) {
          const rate = (g[qq * 3] * ax + g[qq * 3 + 1] * ay + g[qq * 3 + 2] * az) / det;
          if (rate > 1e-9) back = Math.min(back, bs[qq] / rate);
        }
        const pen = Math.min(rc, rc - rr + back);
        if (!(pen > 0)) continue;
        mx -= ax * pen; my -= ay * pen; mz -= az * pen;
        // (and how that wall's moving)
        const t4 = t * 4, a3 = T[t4] * 3, b3 = T[t4 + 1] * 3, c3 = T[t4 + 2] * 3, d3 = T[t4 + 3] * 3;
        jx += 0.25 * (sv[a3] + sv[b3] + sv[c3] + sv[d3]); jy += 0.25 * (sv[a3 + 1] + sv[b3 + 1] + sv[c3 + 1] + sv[d3 + 1]); jz += 0.25 * (sv[a3 + 2] + sv[b3 + 2] + sv[c3 + 2] + sv[d3 + 2]);
        nj++;
      }
      if (mx === 0 && my === 0 && mz === 0) continue;
      mx *= RADIUS_K; my *= RADIUS_K; mz *= RADIUS_K;
      // (not into the jelly the other way, though: only if where it goes is clear)
      if (this._inTet(px + mx, py + my, pz + mz) >= 0) continue;
      q[o] = px + mx; q[o + 1] = py + my; q[o + 2] = pz + mz;
      cp[o] += mx; cp[o + 1] += my; cp[o + 2] += mz;
      cv[o] += jx; cv[o + 1] += jy; cv[o + 2] += jz;
      this.cvn[i] += nj;
    }
  }

  // A drop in tet t (at p) of a hollow cube's shell, last outside at L: if L's on its hollow's side - in the cube
  // as made (rest coordinates, through t: its hollow's box, cHole, give or take half a cell) - the nearest of the
  // hollow, back in the jelly as it is now, into _f3: true. (Its wall swung or squashed onto it further than
  // half its thickness in a frame - a cube grabbed and shaken - the nearest free space was out its far side:
  // where it was last outside, carried on as the wall had moved, was in the wall too - a wall turning, not
  // just moving - and a shake shoved one drop in forty out through it.) Clobbers _g, _bs.
  _inward(t, px, py, pz, Lx, Ly, Lz) {
    const sb = this.app.sb, k = sb.tCube[t], HB = sb.cHole, h6 = k * 6, T = sb.T, X = sb.x, XR = sb.X, bs = this._bs, t4 = t * 4;
    if (!sb.cHollow[k] || !(HB[h6 + 3] > HB[h6])) return false;
    // (L in the cube as made: inside its hollow's box, or not more than half a cell out of it)
    this._grads(T, X, t, Lx, Ly, Lz);
    const m = 0.5 * sb.cH[k];
    let rx = 0, ry = 0, rz = 0;
    for (let c = 0; c < 4; c++) {
      const v3 = T[t4 + c] * 3;
      rx += bs[c] * XR[v3]; ry += bs[c] * XR[v3 + 1]; rz += bs[c] * XR[v3 + 2];
    }
    if (rx < HB[h6] - m || rx > HB[h6 + 3] + m || ry < HB[h6 + 1] - m || ry > HB[h6 + 4] + m || rz < HB[h6 + 2] - m || rz > HB[h6 + 5] + m) return false;
    // (p in the cube as made, and the nearest of its hollow to that, a centimetre in)
    this._grads(T, X, t, px, py, pz);
    rx = ry = rz = 0;
    for (let c = 0; c < 4; c++) {
      const v3 = T[t4 + c] * 3;
      rx += bs[c] * XR[v3]; ry += bs[c] * XR[v3 + 1]; rz += bs[c] * XR[v3 + 2];
    }
    const e = 0.01, cx = Math.min(HB[h6 + 3] - e, Math.max(HB[h6] + e, rx)), cy = Math.min(HB[h6 + 4] - e, Math.max(HB[h6 + 1] + e, ry)), cz = Math.min(HB[h6 + 5] - e, Math.max(HB[h6 + 2] + e, rz));
    if ((cx - rx) ** 2 + (cy - ry) ** 2 + (cz - rz) ** 2 < 1e-8) return false;
    // (back into the jelly as it is now, through t)
    this._grads(T, XR, t, cx, cy, cz);
    const F = this._f3;
    F[0] = F[1] = F[2] = 0;
    for (let c = 0; c < 4; c++) {
      const v3 = T[t4 + c] * 3;
      F[0] += bs[c] * X[v3]; F[1] += bs[c] * X[v3 + 1]; F[2] += bs[c] * X[v3 + 2];
    }
    const fx = F[0] - px, fy = F[1] - py, fz = F[2] - pz;
    return fx * fx + fy * fy + fz * fz > 1e-10;
  }

  // The nearest free space round (px, py, pz) - out of the jelly, above the floor - within ten centimetres, 26
  // ways (straight, edgewise, cornerwise) a few steps out each, the nearest first; into out (x, y, z), true - or
  // false, none.
  // (first within 60 degrees of hx, hy, hz - the side it came from - if that's given: nearer, the far side of a
  // wall that had come most of the way over it)
  _free(px, py, pz, out, hx = 0, hy = 0, hz = 0) {
    const U = this._dirs26, hl = 0.5 * Math.sqrt(hx * hx + hy * hy + hz * hz);
    for (let pass = hl > 0 ? 0 : 1; pass < 2; pass++)
      for (const r of FREE_STEPS)
        for (let k = 0; k < U.length; k += 3) {
          if (pass === 0 && U[k] * hx + U[k + 1] * hy + U[k + 2] * hz < hl) continue;
          const cx = px + U[k] * r, cy = py + U[k + 1] * r, cz = pz + U[k + 2] * r;
          if (cy < R_P || this._inTet(cx, cy, cz) >= 0) continue;
          out[0] = cx + U[k] * 0.002; out[1] = cy + U[k + 1] * 0.002; out[2] = cz + U[k + 2] * 0.002;
          return true;
        }
    return false;
  }

  // Drops in a slit in a cube full of liquid's shell - its two sides either side of them, within a drop's
  // width - are dragged back hard: a crack that narrow lets liquid through, but slowly - a seep; pulled open
  // wider than that, it pours. (Let through freely, any cut, however fine, ran like an open tap.)
  _gaps(dt) {
    const sb = this.app.sb, x = this.x, v = this.v, r = 0.6 * D, T = sb.T, so = sb.slitOf, tp = sb.tPiece;
    if (!this.cellsN) return;
    // (no slit in a cube full of liquid: nothing to look for - as of its topology)
    if (this._gapVer !== sb.topoVersion) {
      this._gapVer = sb.topoVersion;
      this._anySlit = false;
      for (let u = 0; u < sb.nV; u++) if (so[u] && so[u] - 1 !== u && sb.cLiq[sb.vCube[u]]) (this._anySlit = true), (u = sb.nV);
    }
    if (!this._anySlit) return;
    const slit = (t) => {
      for (let k = 0; k < 4; k++) {
        const u = T[t * 4 + k];
        if (so[u] && so[u] - 1 !== u) return true;
      }
      return false;
    };
    const keep = Math.exp(-dt * GAP_DRAG);
    for (let i = 0; i < this.n; i++) {
      if (this.acid[i] !== 0) continue;
      const o = i * 3, px = x[o], py = x[o + 1], pz = x[o + 2];
      for (let ax = 0; ax < 3; ax += 2) {
        const ux = ax === 0 ? r : 0, uz = ax === 2 ? r : 0;
        const a = this._inTet(px + ux, py, pz + uz);
        if (a < 0 || sb.cLiq[sb.tCube[a]] !== 1) continue;
        const b = this._inTet(px - ux, py, pz - uz);
        if (b < 0 || tp[b] !== tp[a] || !(slit(a) || slit(b))) continue;
        // (squeezed, less: see _pressures)
        const kp = this.press[sb.tCube[a]], kk = kp > 0 ? Math.exp(-dt * GAP_DRAG * Math.max(0, 1 - kp / PRESS_FREE)) : keep;
        v[o] *= kk; v[o + 1] *= kk; v[o + 2] *= kk;
        this._gapSeen[i] = 1;
        this.atCut[i] = 1;
        break;
      }
    }
  }

  // One cell marched: its triangles in at nv - all its corners (grp -1), or only those of one side (grp: see
  // fmask - the rest as nothing); nv after them.
  _cell(F, FC, touch, cell, grp, nv, iso, x0, y0, z0, c, gx, gxy) {
    const OFF = this._off, CX = MC_CX, CY = MC_CY, CZ = MC_CZ, EA = MC_EA, EB = MC_EB, M = this.fmask, FO = this.fo;
    const pos = this.pos, nrm = this.nrm, rgb = this.rgb, vv = this._vv, ex = this._ex, en = this._en, ec = this._ec, ei = this._ei, inn = this.inn;
    const k = (cell / gxy) | 0, j = ((cell - k * gxy) / gx) | 0, i = cell - k * gxy - j * gx;
    let ci = 0;
    for (let m = 0; m < 8; m++) {
      const q = cell + OFF[m], f = grp < 0 || M[q] === grp ? F[q] : 0;
      vv[m] = f;
      // (the tables' winding: bit set where it's outside)
      if (!(f > iso)) ci |= 1 << m;
    }
    const em = edgeTable[ci];
    if (!em) return nv;
    for (let e = 0; e < 12; e++) {
      if (!(em & (1 << e))) continue;
      const A = EA[e], B = EB[e], qa = cell + OFF[A], qb = cell + OFF[B];
      const t = (iso - vv[A]) / (vv[B] - vv[A] || 1e-9);
      const o = e * 3;
      // (in a cube full of liquid, as its inside corner is: which, + 1)
      ei[e] = M[vv[A] > iso ? qa : qb] || 0;
      ex[o] = x0 + (i + CX[A] + (CX[B] - CX[A]) * t) * c;
      ex[o + 1] = y0 + (j + CY[A] + (CY[B] - CY[A]) * t) * c;
      ex[o + 2] = z0 + (k + CZ[A] + (CZ[B] - CZ[A]) * t) * c;
      // normal: down the field's gradient (central differences; one-sided at the floor) - one side's, of a side
      const ja = j + CY[A], jb = j + CY[B];
      let ax, ay, az, bx, by, bz;
      if (grp < 0) {
        ax = FO[qa - 1] - FO[qa + 1]; ay = FO[ja > 0 ? qa - gx : qa] - FO[qa + gx]; az = FO[qa - gxy] - FO[qa + gxy];
        bx = FO[qb - 1] - FO[qb + 1]; by = FO[jb > 0 ? qb - gx : qb] - FO[qb + gx]; bz = FO[qb - gxy] - FO[qb + gxy];
      } else {
        ax = this._fo(qa - 1, grp) - this._fo(qa + 1, grp); ay = this._fo(ja > 0 ? qa - gx : qa, grp) - this._fo(qa + gx, grp); az = this._fo(qa - gxy, grp) - this._fo(qa + gxy, grp);
        bx = this._fo(qb - 1, grp) - this._fo(qb + 1, grp); by = this._fo(jb > 0 ? qb - gx : qb, grp) - this._fo(qb + gx, grp); bz = this._fo(qb - gxy, grp) - this._fo(qb + gxy, grp);
      }
      const nx = ax + (bx - ax) * t, ny = ay + (by - ay) * t, nz = az + (bz - az) * t;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      en[o] = nx / nl; en[o + 1] = ny / nl; en[o + 2] = nz / nl;
      // (a corner the splat never reached - or the other side's - has no colour: take the other's)
      const ta = touch[qa] & 1 && Math.abs(vv[A]) > 1e-6, tb = touch[qb] & 1 && Math.abs(vv[B]) > 1e-6, wa = ta ? 1 / F[qa] : 0, wb = tb ? 1 / F[qb] : 0;
      for (let cc = 0; cc < 3; cc++) {
        const ca = FC[qa * 3 + cc] * wa, cb = FC[qb * 3 + cc] * wb;
        ec[o + cc] = !ta ? cb : !tb ? ca : ca + (cb - ca) * t;
      }
    }
    const base = ci * 16;
    for (let tIdx = 0; triTable[base + tIdx] !== -1; tIdx++) {
      const e3 = triTable[base + tIdx] * 3, o = nv * 3;
      pos[o] = ex[e3]; pos[o + 1] = ex[e3 + 1]; pos[o + 2] = ex[e3 + 2];
      nrm[o] = en[e3]; nrm[o + 1] = en[e3 + 1]; nrm[o + 2] = en[e3 + 2];
      rgb[o] = ec[e3]; rgb[o + 1] = ec[e3 + 1]; rgb[o + 2] = ec[e3 + 2];
      inn[nv] = ei[triTable[base + tIdx]];
      nv++;
    }
    return nv;
  }

  // (the field as splatted at q, of one side only: see _cell)
  _fo(q, grp) {
    return this.fmask[q] === grp ? this.fo[q] : 0;
  }

  // The liquid's surface in a cube full of it, out past its hollow by more than a centimetre - as the cube stands,
  // turned the way that fits it best (see Spill._hollow) - put back onto its wall there, facing into it. (A wall
  // thinner than the surface's grid - ultrathin's 5 cm, the grid's ~6.5 cm - left its edges a sawtooth: along
  // every edge, across every face once the cube turned, seen through the wall, worse the more it moved. The
  // centimetre: a wall bulging out a little, it follows.)
  _snapWalls(nv) {
    const sb = this.app.sb, inn = this.inn, FR = this.frames, F = this._wF, R = this._wR;
    let mask = 0;
    for (let v = 0; v < nv; v++) if (inn[v] > 0) mask |= 1 << (inn[v] - 1);
    for (let k = 0; k < MAX_CUBES; k++) {
      if (!(mask & (1 << k)) || !sb.cHollow[k] || !(sb.cSize[k] > 0) || !this.frameOK[k]) continue;
      // (the cube as it stands this frame: see _frames)
      const fo = k * 15;
      F[0] = FR[fo]; F[1] = FR[fo + 1]; F[2] = FR[fo + 2]; F[3] = FR[fo + 3] - k * REST_STEP; F[4] = FR[fo + 4]; F[5] = FR[fo + 5];
      for (let c = 0; c < 9; c++) R[c] = FR[fo + 6 + c];
      const size = sb.cSize[k], bev = sb.cBevel[k], shape = sb.shapeOf(k), sk = Math.min(1, Math.max(0, sb.cSkin[k]));
      const th = size * (sk <= 0.5 ? 0.05 + 0.08 * sk : 0.09 + 0.18 * (sk - 0.5)), tol = Math.min(0.01, 0.2 * th);
      // (and what's just short of the wall, as its liquid clings - drawn with its image past the wall, its surface
      // there lies about the wall: snapped only where it was past it, its sides were a patchwork of flat bits and
      // dints. Surface tension none: it's let be - beaded off the wall, as it is)
      const band = 0.5 * this.D * Math.min(1, 2 * sb.cTens[k]);
      // (a rounded box worked out here - most of the liquid's surface nowhere near the wall, and the rest
      // simply - else any shape: a call a point, and its slope from six more. In a function each, small: as
      // one, Safari's engine took a millisecond and a half over it half the time)
      if (!(shape && shape.bow)) this._snapBox(nv, k + 1, size / 2, bev, th, tol, band);
      else this._snapShape(nv, k + 1, size / 2, bev, shape, th, tol, band);
    }
  }

  // Each cube full of liquid as it stands, a frame: its middle now and at rest, and the turn from the one to the
  // other (fitted to all its points: Müller's polar fit, warm from last time) - for its liquid's surface against
  // its wall (_snapWalls) and what's carried in it (Bubbles.poolTick). (Once a surface - every other frame, a big
  // pool - and the bubbles carried by it stepped along a moving cube.)
  _frames() {
    const sb = this.app.sb, x = sb.x, X = sb.X, vc = sb.vCube, A = this._wA, R = this._wR, q = this._wqk, FR = this.frames;
    // (cut in two - or more, each of size - it has no one frame: fitted to all its points, its hollow stood
    // between its halves, the liquid in one snapped up onto its walls there and mirrored in them, a box of it
    // hanging in the air between a half lifted off and the other)
    const big = this._bigN || (this._bigN = new Int32Array(MAX_CUBES)), tot = this._totN || (this._totN = new Int32Array(MAX_CUBES));
    big.fill(0);
    tot.fill(0);
    for (const pc of sb.pieces) if (pc) tot[pc.cube] += pc.verts.length;
    for (const pc of sb.pieces) if (pc && pc.verts.length > 0.15 * tot[pc.cube]) big[pc.cube]++;
    for (let k = 0; k < MAX_CUBES; k++) {
      this.frameOK[k] = 0;
      if (!sb.cHollow[k] || !sb.cLiq[k] || !(sb.cSize[k] > 0) || big[k] > 1) continue;
      let n = 0, xm0 = 0, xm1 = 0, xm2 = 0, Xm0 = 0, Xm1 = 0, Xm2 = 0;
      for (let i = 0; i < sb.nV; i++) {
        if (vc[i] !== k || !sb.alive[i]) continue;
        const o = i * 3;
        xm0 += x[o]; xm1 += x[o + 1]; xm2 += x[o + 2];
        Xm0 += X[o]; Xm1 += X[o + 1]; Xm2 += X[o + 2];
        n++;
      }
      if (!n) continue;
      xm0 /= n; xm1 /= n; xm2 /= n; Xm0 /= n; Xm1 /= n; Xm2 /= n;
      A.fill(0);
      for (let i = 0; i < sb.nV; i++) {
        if (vc[i] !== k || !sb.alive[i]) continue;
        const o = i * 3, a0 = x[o] - xm0, a1 = x[o + 1] - xm1, a2 = x[o + 2] - xm2, b0 = X[o] - Xm0, b1 = X[o + 1] - Xm1, b2 = X[o + 2] - Xm2;
        A[0] += a0 * b0; A[1] += a0 * b1; A[2] += a0 * b2;
        A[3] += a1 * b0; A[4] += a1 * b1; A[5] += a1 * b2;
        A[6] += a2 * b0; A[7] += a2 * b1; A[8] += a2 * b2;
      }
      for (let c = 0; c < 4; c++) q[c] = this._wq[k * 4 + c];
      polarRot(q, A, R, 8);
      for (let c = 0; c < 4; c++) this._wq[k * 4 + c] = q[c];
      const fo = k * 15;
      FR[fo] = xm0; FR[fo + 1] = xm1; FR[fo + 2] = xm2; FR[fo + 3] = Xm0; FR[fo + 4] = Xm1; FR[fo + 5] = Xm2;
      for (let c = 0; c < 9; c++) FR[fo + 6 + c] = R[c];
      this.frameOK[k] = 1;
    }
  }

  // (cube k1 - 1's, a plain rounded box: its rest shape's distance and slope worked out here, those nowhere near
  // its wall passed over at a glance)
  _snapBox(nv, k1, half, bev, th, tol, band) {
    const inn = this.inn, pos = this.pos, nrm = this.nrm, R = this._wR, F = this._wF, bb = half - bev;
    const xm0 = F[0], xm1 = F[1], xm2 = F[2], Xm0 = F[3], Xm1 = F[4], Xm2 = F[5], lim = half - Math.max(bev, th - tol) - band;
    for (let v = 0; v < nv; v++) {
      if (inn[v] !== k1) continue;
      const o = v * 3, dx = pos[o] - xm0, dy = pos[o + 1] - xm1, dz = pos[o + 2] - xm2;
      // (back to its rest shape: R's transpose)
      const rx = Xm0 + R[0] * dx + R[3] * dy + R[6] * dz, ry = Xm1 + R[1] * dx + R[4] * dy + R[7] * dz, rz = Xm2 + R[2] * dx + R[5] * dy + R[8] * dz;
      const ax = rx < 0 ? -rx : rx, ay = ry < 0 ? -ry : ry, az = rz < 0 ? -rz : rz;
      if (ax < lim && ay < lim && az < lim) continue;
      const qx = ax - bb, qy = ay - bb, qz = az - bb, px = qx > 0 ? qx : 0, py = qy > 0 ? qy : 0, pz = qz > 0 ? qz : 0;
      const pl = Math.sqrt(px * px + py * py + pz * pz), mq = qx > qy ? (qx > qz ? qx : qz) : qy > qz ? qy : qz;
      const out = th + pl + (mq < 0 ? mq : 0) - bev - tol;
      if (!(out > -band)) continue;
      // (its slope: out of the inner box's nearest corner or edge, or square off the face it's nearest)
      const il = pl > 1e-9 ? 1 / pl : 0;
      let gx = px * il, gy = py * il, gz = pz * il;
      if (!(pl > 1e-9)) {
        gx = mq === qx ? 1 : 0;
        gy = mq !== qx && mq === qy ? 1 : 0;
        gz = mq !== qx && mq !== qy ? 1 : 0;
      }
      if (rx < 0) gx = -gx;
      if (ry < 0) gy = -gy;
      if (rz < 0) gz = -gz;
      const mx = -gx * out, my = -gy * out, mz = -gz * out;
      pos[o] += R[0] * mx + R[1] * my + R[2] * mz; pos[o + 1] += R[3] * mx + R[4] * my + R[5] * mz; pos[o + 2] += R[6] * mx + R[7] * my + R[8] * mz;
      nrm[o] = R[0] * gx + R[1] * gy + R[2] * gz; nrm[o + 1] = R[3] * gx + R[4] * gy + R[5] * gz; nrm[o + 2] = R[6] * gx + R[7] * gy + R[8] * gz;
    }
  }

  // (...any other shape - bowed faces: its distance, and its slope from either side along each axis)
  _snapShape(nv, k1, half, bev, shape, th, tol, band) {
    const inn = this.inn, pos = this.pos, nrm = this.nrm, R = this._wR, F = this._wF, e = 0.004;
    const xm0 = F[0], xm1 = F[1], xm2 = F[2], Xm0 = F[3], Xm1 = F[4], Xm2 = F[5];
    for (let v = 0; v < nv; v++) {
      if (inn[v] !== k1) continue;
      const o = v * 3, dx = pos[o] - xm0, dy = pos[o + 1] - xm1, dz = pos[o + 2] - xm2;
      const rx = Xm0 + R[0] * dx + R[3] * dy + R[6] * dz, ry = Xm1 + R[1] * dx + R[4] * dy + R[7] * dz, rz = Xm2 + R[2] * dx + R[5] * dy + R[8] * dz;
      const out = th + shapeSDF(rx, ry, rz, half, bev, shape) - tol;
      if (!(out > -band)) continue;
      let gx = shapeSDF(rx + e, ry, rz, half, bev, shape) - shapeSDF(rx - e, ry, rz, half, bev, shape);
      let gy = shapeSDF(rx, ry + e, rz, half, bev, shape) - shapeSDF(rx, ry - e, rz, half, bev, shape);
      let gz = shapeSDF(rx, ry, rz + e, half, bev, shape) - shapeSDF(rx, ry, rz - e, half, bev, shape);
      const gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
      if (!(gl > 1e-12)) continue;
      gx /= gl; gy /= gl; gz /= gl;
      const mx = -gx * out, my = -gy * out, mz = -gz * out;
      pos[o] += R[0] * mx + R[1] * my + R[2] * mz; pos[o + 1] += R[3] * mx + R[4] * my + R[5] * mz; pos[o + 2] += R[6] * mx + R[7] * my + R[8] * mz;
      nrm[o] = R[0] * gx + R[1] * gy + R[2] * gz; nrm[o + 1] = R[3] * gx + R[4] * gy + R[5] * gz; nrm[o + 2] = R[6] * gx + R[7] * gy + R[8] * gz;
    }
  }

  // The jelly's tet p is in (of those hashed near the liquid - see _jellyCells), or -1.
  // (each of its tets' boxes looked at first: tested whole, every one in a wall's cell, it took the drops' push off
  // the walls a quarter of the liquid's time)
  _inTet(px, py, pz) {
    const sb = this.app.sb, cs = this.cStart, ctl = this.cTets, CM = CELL_HASH - 1, TB = this.tBox;
    const hb = (Math.imul(Math.floor(px * 10), 92837111) ^ Math.imul(Math.floor(py * 10), 689287499) ^ Math.imul(Math.floor(pz * 10), 283923481)) & CM;
    for (let e = cs[hb], e1 = cs[hb + 1]; e < e1; e++) {
      const t = ctl[e], b = t * 6;
      if (px < TB[b] || py < TB[b + 1] || pz < TB[b + 2] || px > TB[b + 3] || py > TB[b + 4] || pz > TB[b + 5]) continue;
      if (sb._tetGap(t, px, py, pz) < 0) return t;
    }
    return -1;
  }

  // Tet t's barycentric gradients (x det: g[k*3..], each pointing into it, toward corner k) and p's
  // barycentric coordinates in it (this._bs); its determinant returned.
  _grads(T, X, t, px, py, pz) {
    const t4 = t * 4, a3 = T[t4] * 3, b3 = T[t4 + 1] * 3, c3 = T[t4 + 2] * 3, d3 = T[t4 + 3] * 3, g = this._g, bs = this._bs;
    const e1x = X[b3] - X[a3], e1y = X[b3 + 1] - X[a3 + 1], e1z = X[b3 + 2] - X[a3 + 2];
    const e2x = X[c3] - X[a3], e2y = X[c3 + 1] - X[a3 + 1], e2z = X[c3 + 2] - X[a3 + 2];
    const e3x = X[d3] - X[a3], e3y = X[d3 + 1] - X[a3 + 1], e3z = X[d3 + 2] - X[a3 + 2];
    g[3] = e2y * e3z - e2z * e3y; g[4] = e2z * e3x - e2x * e3z; g[5] = e2x * e3y - e2y * e3x;
    g[6] = e3y * e1z - e3z * e1y; g[7] = e3z * e1x - e3x * e1z; g[8] = e3x * e1y - e3y * e1x;
    g[9] = e1y * e2z - e1z * e2y; g[10] = e1z * e2x - e1x * e2z; g[11] = e1x * e2y - e1y * e2x;
    const det = e1x * g[3] + e1y * g[4] + e1z * g[5];
    g[0] = -(g[3] + g[6] + g[9]); g[1] = -(g[4] + g[7] + g[10]); g[2] = -(g[5] + g[8] + g[11]);
    const rx = px - X[a3], ry = py - X[a3 + 1], rz = pz - X[a3 + 2];
    bs[1] = (g[3] * rx + g[4] * ry + g[5] * rz) / det;
    bs[2] = (g[6] * rx + g[7] * ry + g[8] * rz) / det;
    bs[3] = (g[9] * rx + g[10] * ry + g[11] * rz) / det;
    bs[0] = 1 - bs[1] - bs[2] - bs[3];
    return det;
  }

  // Cold clumps set: particles colder than SET_T (slush), joined within
  // 1.4 D of each other, a dozen or more - meshed into jelly (see _toJelly)
  // once the spray's moved off them (0.45 s), the biggest first, one a look
  // (a rebuild each: spread out); a huge one doesn't wait. A few cold drops
  // on their own frost away.
  _setCold() {
    const n = this.n;
    let any = false;
    for (let i = 0; i < n; i++) if (this.temp[i] < SET_T && this.acid[i] === 0) any = true;
    if (!any) return;
    const released = this.coolT > 0.45;
    this._grid(this.x);
    const par = new Int32Array(n);
    for (let i = 0; i < n; i++) par[i] = i;
    const find = (a) => {
      while (par[a] !== a) a = par[a] = par[par[a]];
      return a;
    };
    const L2 = (1.4 * D) ** 2;
    for (let i = 0; i < n; i++) {
      if (this.temp[i] >= SET_T || this.acid[i] !== 0) continue;
      this._near(this.x, i, (j, dx, dy, dz, d2) => {
        if (d2 > L2 || this.temp[j] >= SET_T || this.acid[j] !== 0) return;
        const a = find(i), b = find(j);
        if (a !== b) par[b] = a;
      });
    }
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      if (this.temp[i] >= SET_T || this.acid[i] !== 0) continue;
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(i);
    }
    const gone = new Uint8Array(n);
    let made = false, dust = false;
    const big = [...groups.values()].filter((ids) => ids.length >= 12 && (released || ids.length > 700)).sort((p, q) => q.length - p.length);
    if (released) {
      for (const ids of groups.values()) {
        if (ids.length >= 12 || !ids.every((i) => this.temp[i] < SET_T * 2)) continue;
        for (const i of ids) {
          gone[i] = 1;
          this.app.particles?.glitter?.({ x: this.x[i * 3], y: this.x[i * 3 + 1], z: this.x[i * 3 + 2] }, 3, [0.85, 0.93, 1.0], 0.05);
        }
        dust = true;
      }
    }
    if (big.length) {
      this._cellVer = -1; // (the jelly as it is now: never inside it)
      this._jellyCells();
      // (the biggest that can be made; a clump that can't stays slush)
      for (const ids of big) {
        if (!this._toJelly(ids)) continue;
        for (const i of ids) gone[i] = 1;
        made = ids;
        const c = (this._setAt ||= [0, 0, 0]);
        c[0] = c[1] = c[2] = 0;
        for (const i of ids) for (let k = 0; k < 3; k++) c[k] += this.x[i * 3 + k] / ids.length;
        break;
      }
    }
    if (!made && !dust) return;
    // (compact what's left)
    let w = 0;
    const map = this._mapFor(n);
    for (let i = 0; i < n; i++) {
      if (gone[i]) continue;
      map[i] = w;
      if (w !== i) {
        for (let c = 0; c < 3; c++) {
          this.x[w * 3 + c] = this.x[i * 3 + c];
          this.v[w * 3 + c] = this.v[i * 3 + c];
          this.col[w * 3 + c] = this.col[i * 3 + c];
        }
        this.temp[w] = this.temp[i];
        this.age[w] = this.age[i];
        this.acid[w] = this.acid[i];
        this.acidTet[w] = this.acidTet[i];
        this.visc[w] = this.visc[i];
        this.thick[w] = this.thick[i];
        this.tens[w] = this.tens[i];
        this.own[w] = this.own[i];
        this.dIn[w] = this.dIn[i];
        this.mass[w] = this.mass[i];
        for (let c = 0; c < 3; c++) this.lastOut[w * 3 + c] = this.lastOut[i * 3 + c];
      }
      w++;
    }
    if (w !== n) this._mapDone(map, n);
    this.n = w;
    this.mesh.visible = w > 0;
    this.wake();
    if (!made) return;
    this.app.onTopologyChanged();
    this.app.audio?.frostCrackle?.(1);
    // (it sets with a crack and a beat's pause - a big one takes the
    // machine a moment to remake, and the pause takes it)
    const c = this._setAt;
    this.app.hitStop?.(made.length > 200 ? 0.14 : 0.06);
    this.app.glowPulse?.(c[0], c[1], c[2], 0.9);
  }

  // A clump into jelly: a grid of voxels (about the jelly's own cell size),
  // as many as the liquid's volume, where it's thickest - not where there's
  // jelly already - five tets each, the corners shared; the outline's
  // corners pulled in a little toward their neighbours, sideways (round in
  // plan, no stair steps; never thinner); rest shape = the shape it's in;
  // cold (freshly set: firm). Added to the body as a new piece.
  _toJelly(ids) {
    const sb = this.app.sb, x = this.x;
    const vs = Math.max(0.055, sb.hCell * 0.7);
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    let vx = 0, vy = 0, vz = 0;
    for (const i of ids) {
      const o = i * 3;
      x0 = Math.min(x0, x[o]); x1 = Math.max(x1, x[o]);
      y0 = Math.min(y0, x[o + 1]); y1 = Math.max(y1, x[o + 1]);
      z0 = Math.min(z0, x[o + 2]); z1 = Math.max(z1, x[o + 2]);
      vx += this.v[o]; vy += this.v[o + 1]; vz += this.v[o + 2];
    }
    vx /= ids.length; vy /= ids.length; vz /= ids.length;
    const pad = vs;
    x0 -= pad; z0 -= pad; x1 += pad; z1 += pad; y1 += pad;
    y0 = Math.max(0, y0 - pad);
    const nx = Math.max(1, Math.ceil((x1 - x0) / vs)), ny = Math.max(1, Math.ceil((y1 - y0) / vs)), nz = Math.max(1, Math.ceil((z1 - z0) / vs));
    if (nx * ny * nz > 40000) return false;
    const NV = nx * ny * nz;
    const vid = (i, j, k) => (k * ny + j) * nx + i;
    // how much liquid each voxel holds (each particle shared trilinearly)
    const occ = new Float32Array(NV);
    for (const p of ids) {
      const o = p * 3;
      const fx = (x[o] - x0) / vs - 0.5, fy = (x[o + 1] - y0) / vs - 0.5, fz = (x[o + 2] - z0) / vs - 0.5;
      const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz);
      for (let c = 0; c < 8; c++) {
        const i = i0 + (c & 1), j = j0 + ((c >> 1) & 1), k = k0 + (c >> 2);
        if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue;
        const w = (c & 1 ? fx - i0 : 1 - fx + i0) * ((c >> 1) & 1 ? fy - j0 : 1 - fy + j0) * (c >> 2 ? fz - k0 : 1 - fz + k0);
        occ[vid(i, j, k)] += w;
      }
    }
    // ranked by the liquid in and round them; not inside jelly already
    const score = new Float32Array(NV);
    const cand = [];
    const CM = CELL_HASH - 1, cs = this.cStart, ctl = this.cTets;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          let s = 0;
          for (let c = -1; c <= 1; c++)
            for (let b = -1; b <= 1; b++)
              for (let a = -1; a <= 1; a++) {
                const ii = i + a, jj = j + b, kk = k + c;
                if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
                s += occ[vid(ii, jj, kk)] * (a === 0 && b === 0 && c === 0 ? 1 : 0.15);
              }
          if (s < 0.3) continue;
          const px = x0 + (i + 0.5) * vs, py = y0 + (j + 0.5) * vs, pz = z0 + (k + 0.5) * vs;
          let inside = false;
          if (this.cellsN) {
            const hb = (Math.imul(Math.floor(px * 10), 92837111) ^ Math.imul(Math.floor(py * 10), 689287499) ^ Math.imul(Math.floor(pz * 10), 283923481)) & CM;
            for (let e = cs[hb]; e < cs[hb + 1] && !inside; e++) if (sb._tetGap(ctl[e], px, py, pz) < 0) inside = true;
          }
          if (inside) continue;
          const v = vid(i, j, k);
          score[v] = s;
          cand.push(v);
        }
    cand.sort((p, q) => score[q] - score[p]);
    // (a little over: rounding the outline takes some back)
    let mv = 0;
    for (const i of ids) mv += this.mass[i];
    const want = Math.round((1.2 * mv * this.vol) / (vs * vs * vs));
    const full = new Uint8Array(NV);
    for (let c = 0; c < Math.min(want, cand.length); c++) full[cand[c]] = 1;
    // (bits a voxel or three on their own: dropped - too small to be jelly)
    const seen = new Uint8Array(NV);
    let count = 0;
    for (let v0 = 0; v0 < NV; v0++) {
      if (!full[v0] || seen[v0]) continue;
      const comp = [v0];
      seen[v0] = 1;
      for (let h = 0; h < comp.length; h++) {
        const v = comp[h], i = v % nx, j = Math.floor(v / nx) % ny, k = Math.floor(v / (nx * ny));
        for (const [a, b, c] of NB6) {
          const ii = i + a, jj = j + b, kk = k + c;
          if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
          const u = vid(ii, jj, kk);
          if (full[u] && !seen[u]) {
            seen[u] = 1;
            comp.push(u);
          }
        }
      }
      if (comp.length < 4) for (const v of comp) full[v] = 0;
      else count += comp.length;
    }
    if (count < 4) return false;
    // corners
    const cid = new Map();
    const corner = (i, j, k) => {
      const key = (k * (ny + 1) + j) * (nx + 1) + i;
      let id = cid.get(key);
      if (id === undefined) {
        id = sb.nV;
        sb.addVertex(x0 + i * vs, y0 + j * vs, z0 + k * vs, x0 + i * vs, y0 + j * vs, z0 + k * vs, vx, vy, vz, -0.7);
        cid.set(key, id);
      }
      return id;
    };
    const tets = [];
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          if (!full[vid(i, j, k)]) continue;
          const c = [corner(i, j, k), corner(i + 1, j, k), corner(i + 1, j + 1, k), corner(i, j + 1, k), corner(i, j, k + 1), corner(i + 1, j, k + 1), corner(i + 1, j + 1, k + 1), corner(i, j + 1, k + 1)];
          // five tets, mirrored on alternate cells so the faces match up
          const T5 = (i + j + k) & 1
            ? [[0, 1, 3, 4], [1, 2, 3, 6], [1, 4, 5, 6], [3, 4, 6, 7], [1, 3, 4, 6]]
            : [[0, 1, 2, 5], [0, 2, 3, 7], [0, 4, 5, 7], [2, 5, 6, 7], [0, 2, 5, 7]];
          for (const tt of T5) tets.push(c[tt[0]], c[tt[1]], c[tt[2]], c[tt[3]]);
        }
    // the outline's corners (on a side face: an empty voxel beside them, level) pulled in sideways
    const outside = new Set();
    for (const [key, id] of cid) {
      const i = key % (nx + 1), j = Math.floor(key / (nx + 1)) % (ny + 1), k = Math.floor(key / ((nx + 1) * (ny + 1)));
      for (let c = -1; c <= 0 && !outside.has(id); c++)
        for (let a = -1; a <= 0; a++) {
          const ii = i + a, kk = k + c;
          let side = false;
          for (let b = -1; b <= 0; b++) {
            const jj = j + b;
            if (jj < 0 || jj >= ny) continue;
            if (ii < 0 || kk < 0 || ii >= nx || kk >= nz || !full[vid(ii, jj, kk)]) side = true;
          }
          if (side) {
            outside.add(id);
            break;
          }
        }
    }
    const nb = new Map();
    for (let t = 0; t < tets.length; t += 4)
      for (let a = 0; a < 4; a++)
        for (let b = 0; b < 4; b++) {
          if (a === b) continue;
          const u = tets[t + a];
          if (!nb.has(u)) nb.set(u, new Set());
          nb.get(u).add(tets[t + b]);
        }
    for (let pass = 0; pass < 2; pass++) {
      const moved = [];
      for (const id of outside) {
        const ns = nb.get(id);
        if (!ns) continue;
        let ax = 0, az = 0, m = 0;
        for (const u of ns) {
          // (its neighbours on the same level)
          if (Math.abs(sb.X[u * 3 + 1] - sb.X[id * 3 + 1]) > vs * 0.5) continue;
          ax += sb.X[u * 3]; az += sb.X[u * 3 + 2];
          m++;
        }
        if (m) moved.push(id, ax / m, az / m);
      }
      for (let q = 0; q < moved.length; q += 3) {
        const o = moved[q] * 3;
        for (const [c, to] of [[0, moved[q + 1]], [2, moved[q + 2]]]) {
          const v = sb.X[o + c] + (to - sb.X[o + c]) * 0.35;
          sb.x[o + c] = sb.X[o + c] = sb.px[o + c] = v;
        }
      }
    }
    // the top's corners (open above, on a level) eased up or down toward
    // their neighbours on top: no terraces
    const top = new Set();
    for (const [key, id] of cid) {
      const i = key % (nx + 1), j = Math.floor(key / (nx + 1)) % (ny + 1), k = Math.floor(key / ((nx + 1) * (ny + 1)));
      if (j === 0) continue;
      let under = false, over = false;
      for (let c = -1; c <= 0; c++)
        for (let a = -1; a <= 0; a++) {
          const ii = i + a, kk = k + c;
          if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) continue;
          if (full[vid(ii, j - 1, kk)]) under = true;
          if (j < ny && full[vid(ii, j, kk)]) over = true;
        }
      if (under && !over) top.add(id);
    }
    for (let pass = 0; pass < 2; pass++) {
      const moved = [];
      for (const id of top) {
        let ay = 0, m = 0;
        for (const u of nb.get(id) || []) {
          if (!top.has(u)) continue;
          ay += sb.X[u * 3 + 1];
          m++;
        }
        if (m) moved.push(id, ay / m);
      }
      for (let q = 0; q < moved.length; q += 2) {
        const o = moved[q] * 3;
        // (never below the layer under it: half a voxel at most)
        const y = sb.X[o + 1] + Math.max(-0.5 * vs, (moved[q + 1] - sb.X[o + 1]) * 0.35);
        sb.x[o + 1] = sb.X[o + 1] = sb.px[o + 1] = y;
      }
    }
    // (a set puddle's a smooth thing: see TAG_MELT - and marked 2, as set
    // from the liquid: a re-cube melts it back - see _meltSet)
    for (const id of cid.values()) sb.melt[id] = 2;
    const nT0 = sb.nT, nT = nT0 + tets.length / 4;
    sb.ensureT(nT);
    sb.T.set(tets, nT0 * 4);
    for (let t = nT0; t < nT; t++) {
      sb.tVS[t] = 1;
      sb.tMu[t] = 1;
    }
    sb.nT = nT;
    sb.rebuild();
    return true;
  }

  // ---------------------------------------------------------------- surface
  // Each hollow cube full of liquid's inside - inside its outside skin, its walls and all - over the surface's
  // grid: its points marked with its slot and 1 (see _splat), listed (fmL) to be cleared after; how many. Each
  // column of the grid crosses the cube's outside faces at heights: a point's inside if an odd number of those
  // are over it.
  _envelope(x0, y0, z0, c, gx, gy, gz) {
    const sb = this.app.sb, M = this.fmask, L = this.fmL, S = sb.sTri, X = sb.x, tag = sb.sTag, ST = sb.sTet, tc = sb.tCube, ic = 1 / c, gxy = gx * gy, NC = gx * gz;
    let nm = 0;
    for (let k = 0; k < sb.cHollow.length; k++) {
      if (!sb.cHollow[k] || !sb.cLiq[k]) continue;
      if (this._colN.length < NC + 1) this._colN = new Int32Array((NC + 1) * 2);
      const CN = this._colN;
      CN.fill(0, 0, NC + 1);
      // (each outside face, the columns under it: counted, then their heights in)
      let total = 0;
      for (let pass = 0; pass < 2; pass++) {
        if (pass) {
          for (let q = 0; q < NC; q++) CN[q + 1] += CN[q];
          total = CN[NC];
          if (!total) break;
          if (this._colY.length < total) this._colY = new Float32Array(total * 2);
          for (let q = NC; q > 0; q--) CN[q] = CN[q - 1];
          CN[0] = 0;
        }
        for (let f = 0; f < sb.nF; f++) {
          if (tag[f] !== TAG_EXTERIOR || tc[ST[f]] !== k) continue;
          const a = S[f * 3] * 3, b = S[f * 3 + 1] * 3, d = S[f * 3 + 2] * 3;
          const i0 = Math.max(0, Math.ceil((Math.min(X[a], X[b], X[d]) - x0) * ic)), i1 = Math.min(gx - 1, Math.floor((Math.max(X[a], X[b], X[d]) - x0) * ic));
          const k0 = Math.max(0, Math.ceil((Math.min(X[a + 2], X[b + 2], X[d + 2]) - z0) * ic)), k1 = Math.min(gz - 1, Math.floor((Math.max(X[a + 2], X[b + 2], X[d + 2]) - z0) * ic));
          for (let kk = k0; kk <= k1; kk++)
            for (let i = i0; i <= i1; i++) {
              const px = x0 + i * c + 1.234e-7, pz = z0 + kk * c + 2.345e-7;
              const ax = X[a] - px, az = X[a + 2] - pz, bx = X[b] - px, bz = X[b + 2] - pz, dx = X[d] - px, dz = X[d + 2] - pz;
              const wa = bx * dz - bz * dx, wb = dx * az - dz * ax, wd = ax * bz - az * bx, sum = wa + wb + wd;
              if (!(Math.abs(sum) > 1e-12) || !((wa >= 0 && wb >= 0 && wd >= 0) || (wa <= 0 && wb <= 0 && wd <= 0))) continue;
              const col = kk * gx + i;
              if (pass) this._colY[CN[col + 1]++] = (wa * X[a + 1] + wb * X[b + 1] + wd * X[d + 1]) / sum;
              else CN[col + 1]++;
            }
        }
      }
      if (!total) continue;
      // (each column's points: inside between an odd and an even crossing, counted down from the top)
      const CY = this._colY;
      for (let col = 0; col < NC; col++) {
        const e0 = CN[col], e1 = CN[col + 1];
        if (e1 - e0 < 2) continue;
        const ys = CY.subarray(e0, e1).sort();
        const i = col % gx, kk = (col / gx) | 0;
        for (let e = 0; e + 1 < ys.length; e += 2) {
          const j0 = Math.max(0, Math.ceil((ys[e] - y0) * ic)), j1 = Math.min(gy - 1, Math.floor((ys[e + 1] - y0) * ic));
          for (let j = j0; j <= j1; j++) {
            const q = kk * gxy + j * gx + i;
            if (!M[q]) (M[q] = k + 1), (L[nm++] = q);
          }
        }
      }
    }
    return nm;
  }

  // The liquid's surface field, none of it in the jelly: a point in the jelly - each tet near it over the grid
  // points in its box (a point at a time, each looked up, took twice as long; and kept in _remesh, the frame a
  // cut was made took twice as long) - takes the value that puts the surface just where the jelly starts, from
  // how deep in it it is (to the nearest of its tet's faces on the hollow's side - bare, not the cube's outside;
  // none, a whole cell) and its neighbours' values outside it. (Splatted on in, through the jelly in front of it
  // a full cube's liquid showed as a pale blotch; cut down to half wherever it was in the jelly, it stood in a
  // grid cell's staircase of shards and flecks all over a cube held up.)
  _clip(F, touch, tList, nt, iso, x0, y0, z0, c, gx, gy, gz) {
    const gxy = gx * gy, ic = 1 / c;
    const CR = this._cRange, T = this.app.sb.T, X = this.app.sb.x, IM = this.innerMask, DEP = this.fdep, FN = this.fnew;
    for (let l = 0; l < this.cellsN; l++) {
      const t = CR[l * 7], o = t * 4, a = T[o] * 3, b = T[o + 1] * 3, d = T[o + 2] * 3, e = T[o + 3] * 3;
      const i0 = Math.max(0, Math.ceil((Math.min(X[a], X[b], X[d], X[e]) - x0) * ic)), i1 = Math.min(gx - 1, Math.floor((Math.max(X[a], X[b], X[d], X[e]) - x0) * ic));
      const j0 = Math.max(0, Math.ceil((Math.min(X[a + 1], X[b + 1], X[d + 1], X[e + 1]) - y0) * ic)), j1 = Math.min(gy - 1, Math.floor((Math.max(X[a + 1], X[b + 1], X[d + 1], X[e + 1]) - y0) * ic));
      const k0 = Math.max(0, Math.ceil((Math.min(X[a + 2], X[b + 2], X[d + 2], X[e + 2]) - z0) * ic)), k1 = Math.min(gz - 1, Math.floor((Math.max(X[a + 2], X[b + 2], X[d + 2], X[e + 2]) - z0) * ic));
      if (i0 > i1 || j0 > j1 || k0 > k1) continue;
      const e1x = X[b] - X[a], e1y = X[b + 1] - X[a + 1], e1z = X[b + 2] - X[a + 2], e2x = X[d] - X[a], e2y = X[d + 1] - X[a + 1], e2z = X[d + 2] - X[a + 2], e3x = X[e] - X[a], e3y = X[e + 1] - X[a + 1], e3z = X[e + 2] - X[a + 2];
      const g1x = e2y * e3z - e2z * e3y, g1y = e2z * e3x - e2x * e3z, g1z = e2x * e3y - e2y * e3x;
      const g2x = e3y * e1z - e3z * e1y, g2y = e3z * e1x - e3x * e1z, g2z = e3x * e1y - e3y * e1x;
      const g3x = e1y * e2z - e1z * e2y, g3y = e1z * e2x - e1x * e2z, g3z = e1x * e2y - e1y * e2x;
      const det = e1x * g1x + e1y * g1y + e1z * g1z;
      if (!(Math.abs(det) > 1e-12)) continue;
      const id = 1 / det, mk = IM[t], ad = Math.abs(det);
      // (its heights over its faces on the hollow's side: how far in a point is, from its share of the corner
      // across from each)
      const h0 = mk & 1 ? ad / Math.hypot(g1x + g2x + g3x, g1y + g2y + g3y, g1z + g2z + g3z) : 0;
      const h1 = mk & 2 ? ad / Math.hypot(g1x, g1y, g1z) : 0, h2 = mk & 4 ? ad / Math.hypot(g2x, g2y, g2z) : 0, h3 = mk & 8 ? ad / Math.hypot(g3x, g3y, g3z) : 0;
      for (let k = k0; k <= k1; k++)
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const q = k * gxy + j * gx + i;
            if (!(touch[q] & 1)) continue;
            const rx = x0 + i * c - X[a], ry = y0 + j * c - X[a + 1], rz = z0 + k * c - X[a + 2];
            const b1 = (g1x * rx + g1y * ry + g1z * rz) * id, b2 = (g2x * rx + g2y * ry + g2z * rz) * id, b3 = (g3x * rx + g3y * ry + g3z * rz) * id, b0 = 1 - b1 - b2 - b3;
            if (b0 < 0 || b1 < 0 || b2 < 0 || b3 < 0) continue;
            let dp = c;
            if (mk & 1) dp = Math.min(dp, b0 * h0);
            if (mk & 2) dp = Math.min(dp, b1 * h1);
            if (mk & 4) dp = Math.min(dp, b2 * h2);
            if (mk & 8) dp = Math.min(dp, b3 * h3);
            if (!(touch[q] & 4)) (touch[q] |= 4), (DEP[q] = dp);
            else if (dp < DEP[q]) DEP[q] = dp;
          }
    }
    for (let n = 0; n < nt; n++) {
      const q = tList[n];
      if (!(touch[q] & 4)) continue;
      const k = (q / gxy) | 0, j = ((q - k * gxy) / gx) | 0, i = q - k * gxy - j * gx;
      let G = 0, ng = 0;
      if (i > 0 && (touch[q - 1] & 5) === 1 && F[q - 1] > iso) (G += F[q - 1] - iso), ng++;
      if (i < gx - 1 && (touch[q + 1] & 5) === 1 && F[q + 1] > iso) (G += F[q + 1] - iso), ng++;
      if (j > 0 && (touch[q - gx] & 5) === 1 && F[q - gx] > iso) (G += F[q - gx] - iso), ng++;
      if (j < gy - 1 && (touch[q + gx] & 5) === 1 && F[q + gx] > iso) (G += F[q + gx] - iso), ng++;
      if (k > 0 && (touch[q - gxy] & 5) === 1 && F[q - gxy] > iso) (G += F[q - gxy] - iso), ng++;
      if (k < gz - 1 && (touch[q + gxy] & 5) === 1 && F[q + gxy] > iso) (G += F[q + gxy] - iso), ng++;
      const dp = DEP[q];
      FN[n] = ng ? iso - ((G / ng) * dp) / Math.max(c - dp, 0.15 * c) : Math.min(F[q], 0.5 * iso);
    }
    // (its colour as it was: that's carried weighted by the field - see _remesh)
    const FC = this.fcol;
    for (let n = 0; n < nt; n++) {
      const q = tList[n];
      if (!(touch[q] & 4) || !(FN[n] < F[q])) continue;
      const k = F[q] > 1e-9 ? FN[n] / F[q] : 0;
      FC[q * 3] *= k; FC[q * 3 + 1] *= k; FC[q * 3 + 2] *= k;
      F[q] = FN[n];
    }
  }

  // The particles splatted into a field on a grid round them (each a smooth
  // bump out to 1.6 D), colours carried along; its level set by marching
  // cubes, normals from the field's gradient.
  _remesh() {
    const n = this.n, x = this.x;
    if (!n) {
      this.geo.setDrawRange(0, 0);
      this.inN = 0;
      return;
    }
    const R = SPLAT_R * D;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, mMax = 1;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      if (this.mass[i] > mMax) mMax = this.mass[i];
      x0 = Math.min(x0, x[o]); x1 = Math.max(x1, x[o]);
      y0 = Math.min(y0, x[o + 1]); y1 = Math.max(y1, x[o + 1]);
      z0 = Math.min(z0, x[o + 2]); z1 = Math.max(z1, x[o + 2]);
    }
    // (a flood of it: coarser - a big flat pool needs no fine grid)
    // (as fine as the drops are: bigger drops - a cube full of liquid's - on the grid for the small ones, each
    // splatted onto two and a half times as many points, and it took a third of the liquid's time)
    let c = this.cell * (D / 0.065) * Math.min(1.6, Math.max(1, Math.sqrt(n / 500)));
    // (two cells' margin past the splats; nothing below the floor - the
    // floor hides it, and while draining cuts it off)
    const pad = R * Math.cbrt(mMax) + 2 * c;
    x0 -= pad; z0 -= pad; x1 += pad; z1 += pad; y1 += pad;
    y0 = Math.max(y0 - pad, 0);
    if (y1 <= y0 + c) {
      this.geo.setDrawRange(0, 0);
      this.inN = 0;
      this.mesh.visible = false;
      return;
    }
    const dims = () => [Math.ceil((x1 - x0) / c) + 1, Math.ceil((y1 - y0) / c) + 1, Math.ceil((z1 - z0) / c) + 1];
    let [gx, gy, gz] = dims();
    while (gx * gy * gz > 600000) {
      c *= 1.25;
      [gx, gy, gz] = dims();
    }
    const G = gx * gy * gz, gxy = gx * gy;
    if (!this.field || this.field.length < G) {
      const cap = Math.ceil(G * 1.5);
      this.field = new Float32Array(cap); // (all 0 between calls: what's touched is cleared after)
      this.fdep = new Float32Array(cap); // (how deep in the jelly each point is - see _clip)
      this.fnew = new Float32Array(cap);
      this.fo = new Float32Array(cap); // (the field as splatted, for the normals - see _remesh)
      this.fmask = new Uint8Array(cap); // (which cube full of liquid's inside each point is in - see _envelope)
      this.fmL = new Int32Array(cap);
      this.fcol = new Float32Array(cap * 3);
      this.touch = new Uint8Array(cap);
      this.tList = new Int32Array(cap);
      this.cList = new Int32Array(cap);
    }
    const F = this.field, FC = this.fcol, touch = this.touch, tList = this.tList, cList = this.cList;
    // (only the grid points near a particle are filled, and only the cells round the ones that come out inside
    // are marched - each its own method: all in one, Safari's engine never made it fast, and it took four times as
    // long there)
    const nm = this.cellsN ? this._envelope(x0, y0, z0, c, gx, gy, gz) : 0;
    let nt = this._splat(F, FC, touch, tList, x0, y0, z0, c, gx, gy, gz, R, nm);
    if (nm) nt = this._splatWalls(F, FC, touch, tList, nt, x0, y0, z0, c, gx, gy, gz, R);
    nt = this._splatCling(F, FC, touch, tList, nt, x0, y0, z0, c, gx, gy, gz, nm);
    const iso = SPLAT_ISO;
    // (the field as splatted, kept for the surface's normals: brought down to meet the jelly, its slope's a
    // crumple of steps from tet to tet - lit so, a cube's liquid was crinkled foil all over)
    const FO = this.fo;
    for (let a = 0; a < nt; a++) FO[tList[a]] = F[tList[a]];
    if (this.cellsN) this._clip(F, touch, tList, nt, iso, x0, y0, z0, c, gx, gy, gz);
    this._march(F, FC, touch, tList, cList, nt, iso, x0, y0, z0, c, gx, gy, gz);
    // (on its own, not from _march: called from there, Safari's engine took it fifteen times as long)
    if (this.inN) this._snapWalls(this.geo.drawRange.count);
    for (let a = 0; a < nm; a++) this.fmask[this.fmL[a]] = 0;
  }

  // (the drops splatted into the field and its colour - the points touched, listed: how many)
  // (a drop inside a cube full of liquid - inside its outside skin - only onto points inside it too, and one
  // outside only onto points outside: a sealed one's own drops are inside it, the rest by the point they're at. A
  // wall thinner than the grid's cells is missed by it - ultrathin, thin, its liquid was drawn out through it.)
  _splat(F, FC, touch, tList, x0, y0, z0, c, gx, gy, gz, R, nm) {
    const n = this.n, x = this.x, gxy = gx * gy, M = this.fmask, sb = this.app.sb, own = this.own, DI = this.dIn, RY = this.revealY, RON = this.revealOn;
    let nt = 0;
    const ic = 1 / c;
    for (let p = 0; p < n; p++) {
      let mp = 0;
      if (nm) {
        const id = own[p];
        for (let k = 0; k < sb.cHid.length && id; k++) if (sb.cHid[k] === id && sb.cav[k]?.sealed) (mp = k + 1), (k = sb.cHid.length);
        if (!mp) {
          const i = Math.round((x[p * 3] - x0) * ic), j = Math.round((x[p * 3 + 1] - y0) * ic), kk = Math.round((x[p * 3 + 2] - z0) * ic);
          if (i >= 0 && j >= 0 && kk >= 0 && i < gx && j < gy && kk < gz) mp = M[kk * gxy + j * gx + i];
        }
      }
      DI[p] = mp;
      // (being put back, re-cubed: drawn as high as it's got to - those above it fading out over a drop's width)
      let sw = 1;
      if (RON && own[p]) {
        for (let k = 0; k < MAX_CUBES; k++)
          if (sb.cHid[k] === own[p]) {
            if (RY[k] < Infinity) sw = Math.min(1, (RY[k] - x[p * 3 + 1]) / D + 0.5);
            break;
          }
        if (!(sw > 0)) continue;
      }
      // (one carrying more: as much wider as it sits further from the rest - their splats meet as others' do)
      const Rp = R * Math.cbrt(this.mass[p]), R2 = Rp * Rp, rr = Math.ceil(Rp * ic);
      const o = p * 3;
      const px = x[o], py = x[o + 1], pz = x[o + 2];
      const ci = Math.round((px - x0) * ic), cj = Math.round((py - y0) * ic), ck = Math.round((pz - z0) * ic);
      // (cold: frosting over, toward slush-white)
      const fz = this.temp[p] < 0 ? Math.min(0.75, -this.temp[p] * 1.2) : 0;
      const r = this.col[o] + (0.9 - this.col[o]) * fz, g = this.col[o + 1] + (0.94 - this.col[o + 1]) * fz, b = this.col[o + 2] + (1 - this.col[o + 2]) * fz;
      const i0 = Math.max(0, ci - rr), i1 = Math.min(gx - 1, ci + rr);
      for (let k = Math.max(0, ck - rr); k <= Math.min(gz - 1, ck + rr); k++) {
        const dz = z0 + k * c - pz;
        for (let j = Math.max(0, cj - rr); j <= Math.min(gy - 1, cj + rr); j++) {
          const dy = y0 + j * c - py, dyz = dy * dy + dz * dz;
          if (dyz >= R2) continue;
          const row = k * gxy + j * gx;
          for (let i = i0; i <= i1; i++) {
            const dx = x0 + i * c - px;
            const d2 = dx * dx + dyz;
            if (d2 >= R2) continue;
            const u = 1 - d2 / R2, w = u * u * u * sw;
            const q = row + i;
            if (nm && M[q] !== mp) continue;
            if (!touch[q]) {
              touch[q] = 1;
              tList[nt++] = q;
              FC[q * 3] = FC[q * 3 + 1] = FC[q * 3 + 2] = 0;
            }
            F[q] += w;
            FC[q * 3] += r * w; FC[q * 3 + 1] += g * w; FC[q * 3 + 2] += b * w;
          }
        }
      }
    }
    return nt;
  }

  // In a cube full of liquid, each drop by its hollow's wall splatted again on the far side of it - its image in
  // the wall, as much as its Surface tension says (water: all of it) - into the hollow's points only. With nothing
  // past the wall, the surface rounded off a splat's width short of it: liquid in a part-full cube stood like a
  // pillow, a heap, its edges curled away from the walls (the drops themselves lay flat - only the drawing). With
  // its image there it meets the wall flat; less, it beads off it; more, it climbs it a little (a meniscus).
  _splatWalls(F, FC, touch, tList, nt, x0, y0, z0, c, gx, gy, gz, R) {
    const n = this.n, x = this.x, DI = this.dIn, FR = this.frames, HB = this.app.sb.cHole, RY = this.revealY, g = this._gw;
    // (only where its top is - a layer and a half down from the highest of it in its column, a splat wide: under
    // that the field's full anyway, and its images there cost a cube full of liquid half as much again to draw)
    const CT = this._colTop, CM = COL_HASH - 1, ir = 1 / R, col = (ix, iz) => (Math.imul(ix, 92837111) ^ Math.imul(iz, 283923481)) & CM;
    CT.fill(-Infinity);
    for (let p = 0; p < n; p++) {
      if (!DI[p]) continue;
      const o = p * 3, h = col(Math.floor(x[o] * ir), Math.floor(x[o + 2] * ir));
      if (x[o + 1] > CT[h]) CT[h] = x[o + 1];
    }
    for (let p = 0; p < n; p++) {
      const k1 = DI[p], k = k1 - 1;
      if (!k1 || !this.frameOK[k] || RY[k] < Infinity) continue;
      const o = p * 3, cx = Math.floor(x[o] * ir), cz = Math.floor(x[o + 2] * ir);
      let top = -Infinity;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) top = Math.max(top, CT[col(cx + a, cz + b)]);
      if (x[o + 1] < top - 1.5 * R) continue;
      const Rp = R * Math.cbrt(this.mass[p]), f = k * 15, h6 = k * 6;
      const dx = x[o] - FR[f], dy = x[o + 1] - FR[f + 1], dz = x[o + 2] - FR[f + 2];
      // (where it is in the cube as made)
      g[0] = FR[f + 3] + FR[f + 6] * dx + FR[f + 9] * dy + FR[f + 12] * dz;
      g[1] = FR[f + 4] + FR[f + 7] * dx + FR[f + 10] * dy + FR[f + 13] * dz;
      g[2] = FR[f + 5] + FR[f + 8] * dx + FR[f + 11] * dy + FR[f + 14] * dz;
      const w = 0.5 + this.tens[p];
      for (let a = 0; a < 3; a++) {
        const lo = g[a] - HB[h6 + a], hi = HB[h6 + 3 + a] - g[a];
        if (lo < Rp) nt = this._ghost(F, FC, touch, tList, nt, x0, y0, z0, c, gx, gy, gz, Rp, k1, p, a, HB[h6 + a] - lo, w);
        if (hi < Rp) nt = this._ghost(F, FC, touch, tList, nt, x0, y0, z0, c, gx, gy, gz, Rp, k1, p, a, HB[h6 + 3 + a] + hi, w);
      }
    }
    return nt;
  }

  // (drop p's image, mirrored along axis a of its cube's frame to there - rest coordinate v - splatted at weight w
  // into the points of the cube's own (k1) side; _gw holds where it is in the cube as made)
  _ghost(F, FC, touch, tList, nt, x0, y0, z0, c, gx, gy, gz, Rp, k1, p, a, v, w) {
    const g = this._gw, FR = this.frames, f = (k1 - 1) * 15;
    const r0 = (a === 0 ? v : g[0]) - FR[f + 3], r1 = (a === 1 ? v : g[1]) - FR[f + 4], r2 = (a === 2 ? v : g[2]) - FR[f + 5];
    const px = FR[f] + FR[f + 6] * r0 + FR[f + 7] * r1 + FR[f + 8] * r2;
    const py = FR[f + 1] + FR[f + 9] * r0 + FR[f + 10] * r1 + FR[f + 11] * r2;
    const pz = FR[f + 2] + FR[f + 12] * r0 + FR[f + 13] * r1 + FR[f + 14] * r2;
    const o = p * 3;
    return this._splatAt(F, FC, touch, tList, nt, x0, y0, z0, c, gx, gy, gz, px, py, pz, Rp, w, this.col[o], this.col[o + 1], this.col[o + 2], k1);
  }

  // The bubbles at the top of the liquid with the liquid drawn up round them - as much as its Surface tension
  // says - a lip clinging to each, not a bead sat on it. (mk: whether the grid's split by cube - see _splat)
  _splatCling(F, FC, touch, tList, nt, x0, y0, z0, c, gx, gy, gz, nm) {
    const B = this.app.bubbles?.items, DI = this.dIn, D = this.D;
    if (!B) return nt;
    for (const b of B) {
      if (b.gone || !b.pool) continue;
      const p = b.p;
      if (p < 0 || p >= this.n) continue;
      const t = this.tens[p], w = b.w;
      if (!(t > 0.02) || !(b.sy - w[1] < b.R + 0.6 * D)) continue;
      const o = p * 3, mk = nm ? (DI[p] === 255 ? 0 : DI[p]) : -1;
      nt = this._splatAt(F, FC, touch, tList, nt, x0, y0, z0, c, gx, gy, gz, w[0], w[1] - 0.25 * b.R, w[2], (1.1 + t) * b.R + 0.4 * D, 0.9 * t, this.col[o], this.col[o + 1], this.col[o + 2], mk);
    }
    return nt;
  }

  // (a splat of weight w and radius Rp at p, its colour cr cg cb, into the grid's points of side mk only - -1, any)
  _splatAt(F, FC, touch, tList, nt, x0, y0, z0, c, gx, gy, gz, px, py, pz, Rp, w, cr, cg, cb, mk) {
    const M = this.fmask, gxy = gx * gy, ic = 1 / c, R2 = Rp * Rp, rr = Math.ceil(Rp * ic), k1 = mk;
    const ci = Math.round((px - x0) * ic), cj = Math.round((py - y0) * ic), ck = Math.round((pz - z0) * ic);
    const i0 = Math.max(0, ci - rr), i1 = Math.min(gx - 1, ci + rr);
    for (let kk = Math.max(0, ck - rr); kk <= Math.min(gz - 1, ck + rr); kk++) {
      const ez = z0 + kk * c - pz;
      for (let j = Math.max(0, cj - rr); j <= Math.min(gy - 1, cj + rr); j++) {
        const ey = y0 + j * c - py, eyz = ey * ey + ez * ez;
        if (eyz >= R2) continue;
        const row = kk * gxy + j * gx;
        for (let i = i0; i <= i1; i++) {
          const ex = x0 + i * c - px, d2 = ex * ex + eyz;
          if (d2 >= R2) continue;
          const q = row + i;
          if (k1 >= 0 && M[q] !== k1) continue;
          const u = 1 - d2 / R2, ww = u * u * u * w;
          if (!touch[q]) {
            touch[q] = 1;
            tList[nt++] = q;
            FC[q * 3] = FC[q * 3 + 1] = FC[q * 3 + 2] = 0;
          }
          F[q] += ww;
          FC[q * 3] += cr * ww; FC[q * 3 + 1] += cg * ww; FC[q * 3 + 2] += cb * ww;
        }
      }
    }
    return nt;
  }

  // (the cells with a corner inside, marched: the surface's triangles, coloured; and the grid left clean)
  _march(F, FC, touch, tList, cList, nt, iso, x0, y0, z0, c, gx, gy, gz) {
    const gxy = gx * gy, FO = this.fo;
    // the cells with an inside corner (the 8 round each inside point)
    let nc = 0;
    for (let a = 0; a < nt; a++) {
      const p = tList[a];
      if (F[p] <= iso) continue;
      const k = (p / gxy) | 0, j = ((p - k * gxy) / gx) | 0, i = p - k * gxy - j * gx;
      for (let dk = -1; dk <= 0; dk++) {
        const kk = k + dk;
        if (kk < 0 || kk >= gz - 1) continue;
        for (let dj = -1; dj <= 0; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= gy - 1) continue;
          for (let di = -1; di <= 0; di++) {
            const ii = i + di;
            if (ii < 0 || ii >= gx - 1) continue;
            const cell = kk * gxy + jj * gx + ii;
            if (touch[cell] & 2) continue;
            touch[cell] |= 2;
            cList[nc++] = cell;
          }
        }
      }
    }
    const OFF = this._off || (this._off = new Int32Array(8));
    OFF[0] = 0; OFF[1] = 1; OFF[2] = 1 + gx; OFF[3] = gx; OFF[4] = gxy; OFF[5] = 1 + gxy; OFF[6] = 1 + gx + gxy; OFF[7] = gx + gxy;
    const inn = this.inn, M = this.fmask, maxV = this.maxV, gr = this._grp;
    let nv = 0, nIn = 0;
    for (let a = 0; a < nc && nv + 15 <= maxV; a++) {
      const cell = cList[a];
      // (corners in a cube full of liquid and out of it - or in two - each side's surface on its own, the
      // other's corners as nothing: as one, a wall thinner than a cell had none of the grid's points in it,
      // and the liquid in it and what had run out against it were drawn joined straight through it)
      const g0 = M[cell];
      let ng = 1;
      gr[0] = g0;
      for (let m = 1; m < 8; m++) {
        const g = M[cell + OFF[m]];
        if (g !== g0 && g !== gr[1] && g !== gr[2] && ng < 3) gr[ng++] = g;
      }
      if (ng === 1) nv = this._cell(F, FC, touch, cell, -1, nv, iso, x0, y0, z0, c, gx, gxy);
      else for (let q = 0; q < ng && nv + 15 <= maxV; q++) nv = this._cell(F, FC, touch, cell, gr[q], nv, iso, x0, y0, z0, c, gx, gxy);
      gr[1] = gr[2] = -1;
    }
    for (let v = 0; v < nv; v++) if (inn[v]) nIn++;
    // (leave it all clean for next time)
    for (let a = 0; a < nc; a++) touch[cList[a]] &= 1;
    for (let a = 0; a < nt; a++) {
      const q = tList[a];
      touch[q] = 0;
      F[q] = 0;
      FO[q] = 0;
    }
    this.geo.setDrawRange(0, nv);
    this.inN = nIn;
    this.meshVer++;
    for (const a of [this.aPos, this.aNrm, this.aCol, this.aIn]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, nv * a.itemSize);
      a.needsUpdate = true;
    }
    this.mesh.visible = nv > 0;
  }
}
